/* ═════════════════════════════════════════════════════════════════════
   v2 (20-oct-2026) — Clasificar y conciliar
     · El historial y las reglas se leen completos por páginas: la API corta
       cada consulta en 1.000 filas y el motor aprendía de menos de un cuarto
       de lo clasificado, en orden arbitrario.
     · El centro de costo sugerido es el más usado con esa subcuenta (antes,
       el de la primera fila que apareciera).
     · La confianza es MEDIDA: para cada tramo (veces × consistencia) se prueba
       el historial dejando cada movimiento fuera y se cuenta cuántas veces la
       sugerencia acierta. Solo se aplica en automático lo que acierta ≥97% con
       al menos 30 casos (antes: puntaje fijo ≥85, que en el tramo de 88 erraba
       1 de cada 9).
   ═════════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════════
   MOTOR DE SUGERENCIAS DE CLASIFICACIÓN — movimientos bancarios
   Fuente ÚNICA de sugerencias para Bancos › Conciliar movimientos
   (ConciliacionBancaria) y Clasificación masiva (ClasificarTab).
   Es el algoritmo que tenía ClasificarTab, portado sin cambios de criterio,
   más 3 correcciones:
     1. RUT del formato Santander ("0180883711 Transf a…", "012900861K …"):
        el extractor anterior no lo leía, así que las reglas por RUT nunca
        calzaban en esta pantalla.
     2. Dirección: el historial se aprende por CARGO/ABONO por separado y las
        reglas no proponen una cuenta de gasto a un abono ni de ingreso a un
        cargo (antes "Transf de ELECTROLUZ" heredaba la cuenta de los pagos
        "Transf a ELECTROLUZ").
     3. Fuente nueva "mismo RUT ya clasificado" (el nombre cambia entre
        transferencias —"Gerardo Cavieres Bravo" / "Gerardo Cavier"— el RUT no).
   Orden de fuentes: caso postventa → reglas aprendidas → mismo RUT → patrón.
   ═══════════════════════════════════════════════════════════════════════ */
import { supabase } from '../../supabase'
import { extraerRut, normalizarPatron, calcularScoreSugerencia } from '../clasificar/types'

// Pide páginas hasta que no quedan filas (avanza por lo recibido: sirve con cualquier tope de la API).
async function traerTodo(armar, tope = 200000) {
  const out = []
  while (out.length < tope) {
    const { data, error } = await armar().range(out.length, out.length + 999)
    if (error) throw error
    if (!data?.length) break
    out.push(...data)
  }
  return out
}
export const UMBRAL_AUTO = 97   // % de aciertos medidos para aplicar sin revisión
export const MIN_AUTO = 30      // casos mínimos del tramo para confiar en ese %
const MIN_TRAMO = 15            // bajo esto, se usa el % de toda la fuente

// ── Stop words para extracción de patrones (compartido entre carga y refresh) ──
// Incluye palabras vacías + terminaciones empresariales que no aportan especificidad
const STOP_PAT = new Set(['DE','DEL','LA','EL','LOS','LAS','Y','A','AL','EN','POR','PARA','CON','SIN','TRANSF','TRANSFERENCIA','PAGO','ABONO','CARGO','COMPRA','SPA','LTDA','SOCIEDAD','LIMITADA','LIMITADAS','EIRL','RUT','CHEQUE','RECIBIDO','OTRO','BANCO','CIA','MP'])

// Detecta "merchant tokens": nombre comercial pegado a un identificador único variable.
// Ej: "Compra MP *CABIFY2616HFF" → "CABIFY", "Compra FACEBK *XXX" → "FACEBK"
// El sufijo cambia en cada transacción pero el merchant siempre es el mismo.
function extraerMerchantToken(desc) {
  if (!desc) return null
  const up = desc.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  // Patrón 1: "*MERCHANT123XXX" o "MERCHANT *XXX" o "MERCHANT 123XXX"
  // Captura letras de 4+ chars seguidas (o precedidas) por dígito/asterisco
  const m1 = [...up.matchAll(/(?:[*\s])([A-Z]{4,})(?=[\s*]*[\d*])/g)]
  for (const m of m1) { const t = m[1]; if (!STOP_PAT.has(t)) return t }
  // Patrón 2: dígitos seguidos de letras "1234MERCHANT"
  const m2 = [...up.matchAll(/\d+\*?([A-Z]{4,})/g)]
  for (const m of m2) { const t = m[1]; if (!STOP_PAT.has(t)) return t }
  return null
}

function extraerPatronDesc(desc) {
  if (!desc) return null
  // INTENTO 1: merchant token (proveedores con id único por transacción)
  // Devuelve patrón especial con prefijo "MERCHANT:" para distinguir del algoritmo viejo
  const merchant = extraerMerchantToken(desc)
  if (merchant) return 'MERCHANT:' + merchant
  // INTENTO 2: algoritmo original (2 primeras palabras significativas)
  const limpia = desc.toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\d+/g, ' ')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_PAT.has(w))
    .slice(0, 2)
  return limpia.length > 0 ? limpia.join(' ') : null
}

export { extraerPatronDesc }

/* ── RUT ──────────────────────────────────────────────────────────────── */
// Formato banco Santander: cero(s) adelante, sin guion, DV pegado → "18088371-1"
export function rutDeGlosa(desc) {
  if (!desc) return null
  const m = String(desc).match(/^0*(\d{7,8})([0-9kK])\s/)
  if (m) return `${m[1]}-${m[2].toUpperCase()}`
  return extraerRut(desc)
}
// Clave que usaba el clasificador anterior al guardar reglas por RUT. Para RUT
// terminados en K en formato banco producía un RUT corrido ("012900861K" →
// "1290086-1"). Se acepta igual al buscar reglas para no perder lo aprendido.
const rutLegado = desc => extraerRut(desc)

// Nombre del tercero sin RUT ni palabras de relleno, apto para buscar en el
// libro de compras (sin caracteres que rompen el filtro .or() de PostgREST).
export function nombreDeGlosa(desc) {
  if (!desc) return ''
  return String(desc)
    .replace(/^0*\d{7,8}[0-9kK]\s*/i, '')
    .replace(/\b(transf(erencia)?|pago|a|de|por|abono|cargo|compra|internet)\b\.?/gi, ' ')
    .replace(/[^0-9A-Za-zÁÉÍÓÚÑáéíóúñ&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ── Signo: no proponer gasto a un abono ni ingreso a un cargo ─────────── */
function signoCompatible(sub, tipoMov) {
  const t = sub?.tipo_cuenta
  if (!t || !tipoMov) return true
  if (t === 'gasto' && tipoMov === 'ABONO') return false
  if (t === 'ingreso' && tipoMov === 'CARGO') return false
  return true
}

/* ── Aprendizaje desde el historial (mismos criterios estrictos que ClasificarTab) ── */
function acumular(mapa, clave, row) {
  if (!mapa.has(clave)) mapa.set(clave, new Map())
  const subs = mapa.get(clave)
  if (!subs.has(row.subcuenta_id)) subs.set(row.subcuenta_id, { ceco_id: null, tipo_respaldo: row.tipo_respaldo, veces: 0, cecos: new Map() })
  const info = subs.get(row.subcuenta_id)
  info.veces += 1
  if (row.ceco_id) {
    info.cecos.set(row.ceco_id, (info.cecos.get(row.ceco_id) ?? 0) + 1)
    let mejor = null, n = 0
    for (const [c, k] of info.cecos) if (k > n) { mejor = c; n = k }
    info.ceco_id = mejor
  }
}
function ganadores(conteo, { minTotal, exigir2Palabras }) {
  const out = new Map()
  for (const [clave, subs] of conteo) {
    const pat = clave.slice(clave.indexOf('|') + 1)
    if (exigir2Palabras && !pat.startsWith('MERCHANT:') && pat.split(' ').filter(Boolean).length < 2) continue
    let mejor = null, total = 0
    for (const [subId, info] of subs) { total += info.veces; if (!mejor || info.veces > mejor.veces) mejor = { subcuenta_id: subId, ...info } }
    if (!mejor || total < minTotal) continue
    const consistencia = mejor.veces / total
    if (consistencia < 0.6) continue
    out.set(clave, { subcuenta_id: mejor.subcuenta_id, ceco_id: mejor.ceco_id, tipo_respaldo: mejor.tipo_respaldo, veces: mejor.veces, total, consistencia })
  }
  return out
}
/* ── Calibración: cuánto acierta cada tramo, medido en el propio historial ──
   Para cada movimiento ya clasificado se quita su propio voto y se mira si la
   subcuenta ganadora de los demás es la que tiene ("dejar uno fuera"). */
export const tramoDe = (veces, cons) => `${veces >= 5 ? '5+' : veces >= 3 ? '3-4' : veces >= 2 ? '2' : '1'}|${cons >= 0.9 ? '90' : cons >= 0.8 ? '80' : '60'}`
function calibrar(conteo, filas, claveDe, { minTotal }) {
  const est = new Map()
  for (const row of filas ?? []) {
    if (!row?.subcuenta_id) continue
    const k = claveDe(row); if (!k) continue
    const subs = conteo.get(k); if (!subs) continue
    let mejor = null, total = 0
    for (const [subId, info] of subs) {
      const v = info.veces - (subId === row.subcuenta_id ? 1 : 0)
      if (v <= 0) continue
      total += v
      if (!mejor || v > mejor.v) mejor = { subId, v }
    }
    if (!mejor || total < minTotal) continue
    const cons = mejor.v / total
    if (cons < 0.6) continue
    for (const t of [tramoDe(mejor.v, cons), 'TODOS']) {
      const e = est.get(t) ?? { n: 0, ok: 0 }
      e.n += 1; if (mejor.subId === row.subcuenta_id) e.ok += 1
      est.set(t, e)
    }
  }
  return est
}
const pctDe = e => Math.floor((1000 * e.ok) / e.n) / 10
function medidoDe(est, clave) {
  if (!est) return null
  const t = est.get(clave)
  const base = t && t.n >= MIN_TRAMO ? t : est.get('TODOS')
  return base?.n ? { score: pctDe(base), n: base.n } : null
}
function coincideRegla(tipoRegla, patron, DESC, palabras, rut, rutOld) {
  if (tipoRegla === 'descripcion_exacta') return DESC === patron
  if (tipoRegla === 'descripcion_contiene') return DESC.includes(patron)
  if (tipoRegla === 'palabra_clave') {
    const esc = patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|\\W)${esc}(\\W|$)`, 'i').test(DESC) || palabras.includes(patron)
  }
  if (tipoRegla === 'rut') return (!!rut && rut.toUpperCase() === patron) || (!!rutOld && rutOld.toUpperCase() === patron)
  return false
}
// Precisión de las reglas sobre el historial (primera regla que calza, igual que al sugerir).
function calibrarReglas(reglas, subById, filas) {
  const est = new Map()
  const prep = (reglas ?? []).filter(r => r.subcuenta_id && subById.has(r.subcuenta_id) && String(r.patron ?? '').trim())
    .map(r => ({ r, P: String(r.patron).toUpperCase().trim(), sub: subById.get(r.subcuenta_id) }))
  for (const row of filas ?? []) {
    if (!row?.subcuenta_id) continue
    const desc = String(row.descripcion ?? ''), DESC = desc.toUpperCase(), palabras = DESC.split(/\s+/).filter(Boolean)
    const rut = rutDeGlosa(desc), rutOld = rutLegado(desc)
    const hit = prep.find(({ r, P, sub }) => signoCompatible(sub, row.tipo) && coincideRegla(r.tipo_regla, P, DESC, palabras, rut, rutOld))
    if (!hit) continue
    for (const t of [hit.r.tipo_regla, 'TODOS']) {
      const e = est.get(t) ?? { n: 0, ok: 0 }
      e.n += 1; if (hit.r.subcuenta_id === row.subcuenta_id) e.ok += 1
      est.set(t, e)
    }
  }
  return est
}
// Puntaje final de una sugerencia: % de aciertos medido de su fuente y tramo.
function puntuar(found, ctx) {
  if (found.fuente === 'caso_postventa') return { ...calcularScoreSugerencia(found), auto: false, n_medido: null }
  const med = found.fuente === 'regla' ? medidoDe(ctx.calibReglas, found.tipo_regla)
    : medidoDe(ctx.calib?.[found.fuente], tramoDe(found.aciertos ?? 0, found.consistencia ?? 1))
  if (!med) return { ...(found.score != null ? {} : calcularScoreSugerencia(found)), auto: false, n_medido: null }
  const veces = found.aciertos ?? 0
  const base = found.fuente === 'regla' ? `Regla por ${found.tipo_regla === 'rut' ? 'RUT' : 'texto de la glosa'}`
    : found.fuente === 'rut_historico' ? `Mismo RUT clasificado así ${veces} ${veces === 1 ? 'vez' : 'veces'}`
    : `Glosa parecida clasificada así ${veces} ${veces === 1 ? 'vez' : 'veces'}`
  return {
    score: med.score, n_medido: med.n,
    nivel: med.score >= UMBRAL_AUTO ? 'alto' : med.score >= 85 ? 'medio' : 'bajo',
    auto: med.score >= UMBRAL_AUTO && med.n >= MIN_AUTO && !!found.subcuenta_id,
    razon: `${base}. Sugerencias como esta aciertan el ${med.score.toLocaleString('es-CL')}% de las veces (${med.n} casos del historial).`,
  }
}
export function construirAprendizaje(histRows) {
  const porPatron = new Map(), porRut = new Map()
  for (const row of histRows ?? []) {
    if (!row?.subcuenta_id) continue
    const tipo = row.tipo ?? ''
    const pat = extraerPatronDesc(row.descripcion)
    if (pat) acumular(porPatron, `${tipo}|${pat}`, row)
    const rut = rutDeGlosa(row.descripcion)
    if (rut) acumular(porRut, `${tipo}|${rut}`, row)
  }
  // Uso de cada subcuenta (por sentido) y sus centros de costo: "más usadas" y centro de costo propuesto en el buscador
  const uso = new Map()
  for (const row of histRows ?? []) {
    if (!row?.subcuenta_id) continue
    const u = uso.get(row.subcuenta_id) ?? { total: 0, CARGO: 0, ABONO: 0, cecos: new Map() }
    u.total += 1
    if (row.tipo === 'CARGO' || row.tipo === 'ABONO') u[row.tipo] += 1
    if (row.ceco_id) u.cecos.set(row.ceco_id, (u.cecos.get(row.ceco_id) ?? 0) + 1)
    uso.set(row.subcuenta_id, u)
  }
  const clavePatron = r => { const p = extraerPatronDesc(r.descripcion); return p && (p.startsWith('MERCHANT:') || p.split(' ').filter(Boolean).length >= 2) ? `${r.tipo ?? ''}|${p}` : null }
  const claveRut = r => { const rut = rutDeGlosa(r.descripcion); return rut ? `${r.tipo ?? ''}|${rut}` : null }
  return {
    patrones: ganadores(porPatron, { minTotal: 2, exigir2Palabras: true }),
    ruts: ganadores(porRut, { minTotal: 1, exigir2Palabras: false }),
    _conteoPatron: porPatron, _conteoRut: porRut, uso,
    _hist: new Map((histRows ?? []).filter(r => r?.id).map(r => [r.id, r.subcuenta_id])),   // con qué subcuenta entró cada línea al historial
    calib: {
      rut_historico: calibrar(porRut, histRows, claveRut, { minTotal: 1 }),
      patron_historico: calibrar(porPatron, histRows, clavePatron, { minTotal: 2 }),
    },
  }
}

function scoreRutHistorico(veces, cons) {
  const pct = Math.round(cons * 100)
  if (veces >= 5 && cons >= 0.9) return { score: 95, nivel: 'alto', razon: `Mismo RUT clasificado así ${veces} veces (${pct}% consistente)` }
  if (veces >= 3 && cons >= 0.8) return { score: 88, nivel: 'alto', razon: `Mismo RUT clasificado así ${veces} veces (${pct}% consistente)` }
  if (veces >= 2) return { score: 75, nivel: 'medio', razon: `Mismo RUT clasificado así ${veces} veces (${pct}% consistente)` }
  return { score: 60, nivel: 'medio', razon: 'Mismo RUT clasificado así 1 vez — verificar' }
}

/* ── Carga del contexto del motor (una vez por pantalla) ───────────────── */
export async function cargarMotor() {
  const hace90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const pagina = armar => traerTodo(armar).then(data => ({ data, error: null }), error => ({ data: null, error }))
  const [rg, sc, hi, pv] = await Promise.all([
    pagina(() => supabase.from('reglas_clasificacion').select('id, tipo_regla, patron, subcuenta_id, ceco_id, tipo_respaldo, aciertos').order('id')),
    pagina(() => supabase.from('subcuentas').select('id, codigo, nombre, activa, cuenta_madre:cuentas_madre(tipo, codigo, requiere_ceco)').order('id')),
    pagina(() => supabase.from('movimientos_bancarios').select('id, descripcion, tipo, subcuenta_id, ceco_id, tipo_respaldo')
      .eq('estado', 'clasificado').not('subcuenta_id', 'is', null).order('id')),
    supabase.from('caso_form3_resolucion').select('caso_id, monto, rut_titular, nombre_titular, bsale_doc_numero, fecha_resolucion')
      .eq('tipo_resolucion', 'nc_transfer').gte('fecha_resolucion', hace90),
  ])
  if (rg.error) throw rg.error
  if (sc.error) throw sc.error
  if (hi.error) throw hi.error
  const subById = new Map((sc.data ?? []).filter(s => s.activa !== false).map(s => [s.id, { ...s, tipo_cuenta: s.cuenta_madre?.tipo ?? null }]))
  const normRut = r => String(r || '').replace(/[.-]/g, '').replace(/^0+/, '').toUpperCase()
  // Número y cliente del caso (los muestra Clasificación masiva en el badge y el panel)
  const casoIds = [...new Set((pv.data ?? []).map(f => f.caso_id).filter(Boolean))]
  const casoMap = new Map()
  if (casoIds.length) {
    const { data: casos } = await supabase.from('casos_postventa').select('id, numero, cliente_nombre, cliente_rut').in('id', casoIds)
    for (const c of casos ?? []) casoMap.set(c.id, c)
  }
  const pvPorRut = new Map()
  for (const f3raw of pv.data ?? []) {
    const f3 = { ...f3raw, caso: casoMap.get(f3raw.caso_id) ?? null }
    if (!f3.caso) continue   // igual que antes: solo resoluciones de casos existentes
    const k = normRut(f3.rut_titular || f3.caso?.cliente_rut); if (!k) continue
    if (!pvPorRut.has(k)) pvPorRut.set(k, [])
    pvPorRut.get(k).push(f3)
  }
  const reglas = rg.data ?? []
  return { reglas, subById, pvPorRut, normRut, ...construirAprendizaje(hi.data), calibReglas: calibrarReglas(reglas, subById, hi.data) }
}

/* ── Sugerencia para un movimiento ─────────────────────────────────────── */
export function sugerirClasificacion(m, ctx) {
  if (!m || !ctx) return null
  const { reglas, subById, pvPorRut, normRut, patrones, ruts } = ctx
  const desc = String(m.descripcion ?? '')
  const rut = rutDeGlosa(desc)
  const rutOld = rutLegado(desc)
  const nombre = id => subById.get(id)?.nombre
  let found = null

  // FUENTE 0: devolución de caso postventa (CARGO + RUT + monto exacto ±$1 + fecha ≤30 días)
  if (m.tipo === 'CARGO' && rut) {
    const montoMov = Math.abs(Number(m.monto) || 0)
    const t = (pvPorRut.get(normRut(rut)) ?? []).find(f3 => {
      if (Math.abs((Number(f3.monto) || 0) - montoMov) > 1) return false
      const dias = (new Date(m.fecha) - new Date(f3.fecha_resolucion)) / 86400000
      return dias >= -1 && dias <= 30
    })
    if (t) found = { subcuenta_id: null, subcuenta_nombre: null, ceco_id: null, tipo_respaldo: 'caso_postventa', fuente: 'caso_postventa',
      regla_id: null, tipo_regla: null, aciertos: 0,
      caso_postventa_id: t.caso_id, caso_postventa_numero: t.caso?.numero, caso_postventa_nc: t.bsale_doc_numero,
      caso_postventa_cliente: t.caso?.cliente_nombre || t.nombre_titular, caso_postventa_monto: t.monto, caso_postventa_fecha: t.fecha_resolucion }
  }

  // FUENTE 1: reglas aprendidas (por RUT o por texto)
  if (!found) {
    const DESC = desc.toUpperCase(); const palabras = DESC.split(/\s+/).filter(Boolean)
    for (const r of reglas) {
      const sub = subById.get(r.subcuenta_id)
      if (!r.subcuenta_id || !sub || !signoCompatible(sub, m.tipo)) continue
      const patron = String(r.patron ?? '').toUpperCase().trim(); if (!patron) continue
      let match = false
      if (r.tipo_regla === 'descripcion_exacta') match = DESC === patron
      else if (r.tipo_regla === 'descripcion_contiene') match = DESC.includes(patron)
      else if (r.tipo_regla === 'palabra_clave') { const esc = patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); match = new RegExp(`(^|\\W)${esc}(\\W|$)`, 'i').test(DESC) || palabras.includes(patron) }
      else if (r.tipo_regla === 'rut') match = (!!rut && rut.toUpperCase() === patron) || (!!rutOld && rutOld.toUpperCase() === patron)
      if (match) { found = { subcuenta_id: r.subcuenta_id, subcuenta_nombre: sub.nombre, ceco_id: r.ceco_id, tipo_respaldo: r.tipo_respaldo, fuente: 'regla', regla_id: r.id, tipo_regla: r.tipo_regla, aciertos: r.aciertos ?? 0 }; break }
    }
  }

  // FUENTE 2: mismo RUT ya clasificado (mismo sentido CARGO/ABONO)
  if (!found && rut) {
    const h = ruts.get(`${m.tipo ?? ''}|${rut}`)
    if (h && subById.has(h.subcuenta_id)) {
      found = { subcuenta_id: h.subcuenta_id, subcuenta_nombre: nombre(h.subcuenta_id), ceco_id: h.ceco_id, tipo_respaldo: h.tipo_respaldo,
        fuente: 'rut_historico', aciertos: h.veces, consistencia: h.consistencia, ...scoreRutHistorico(h.veces, h.consistencia) }
    }
  }

  // FUENTE 3: patrón de glosa aprendido (mismo sentido CARGO/ABONO)
  if (!found) {
    const pat = extraerPatronDesc(desc)
    const h = pat ? patrones.get(`${m.tipo ?? ''}|${pat}`) : null
    if (h && subById.has(h.subcuenta_id)) {
      found = { subcuenta_id: h.subcuenta_id, subcuenta_nombre: nombre(h.subcuenta_id), ceco_id: h.ceco_id, tipo_respaldo: h.tipo_respaldo,
        fuente: 'patron_historico', aciertos: h.veces, consistencia: h.consistencia, patron_match: pat }
    }
  }

  if (found) Object.assign(found, puntuar(found, ctx))
  if (found) found.rut_extraido = rut
  return found
}

/* ── Aprendizaje al guardar ────────────────────────────────────────────── */
// Igual que el panel de Clasificación masiva: regla por RUT si la glosa trae
// RUT; si no, patrón de texto estricto (≥15 caracteres y ≥2 palabras).
// Si ya existe la misma regla (también con la clave RUT antigua) suma acierto.
export async function aprenderClasificacion({ descripcion, subcuenta_id, ceco_id, tipo_respaldo }) {
  if (!subcuenta_id) return null
  const rut = rutDeGlosa(descripcion), rutOld = rutLegado(descripcion)
  let tipo_regla = null, patrones = []
  if (rut) { tipo_regla = 'rut'; patrones = [...new Set([rut, rutOld].filter(Boolean))] }
  else {
    const pat = normalizarPatron(descripcion)
    if (pat && pat.length >= 15 && pat.split(/\s+/).length >= 2) { tipo_regla = 'descripcion_contiene'; patrones = [pat] }
  }
  if (!tipo_regla) return null
  // Una sola regla por patrón y manda la última decisión (índice único en la base). Antes, corregir creaba
  // otra regla y la antigua, por ser más vieja, seguía ganando: la corrección nunca prendía.
  const { data: existentes, error } = await supabase.from('reglas_clasificacion').select('id, aciertos, patron, subcuenta_id')
    .eq('tipo_regla', tipo_regla).in('patron', patrones).order('id')
  if (error) throw error
  const misma = (existentes ?? []).find(r => r.subcuenta_id === subcuenta_id)
  const otras = (existentes ?? []).filter(r => r !== misma)
  const borrar = async ids => { if (!ids.length) return; const { error: eb } = await supabase.from('reglas_clasificacion').delete().in('id', ids); if (eb) throw eb }
  if (misma) {
    const { error: e2 } = await supabase.from('reglas_clasificacion').update({ aciertos: (misma.aciertos ?? 0) + 1, ...(ceco_id ? { ceco_id } : {}) }).eq('id', misma.id)
    if (e2) throw e2
    await borrar(otras.map(r => r.id))
    return { accion: 'refuerza', id: misma.id, eliminadas: otras.map(r => r.id) }
  }
  if (otras.length) {
    const [principal, ...resto] = otras
    const { data: corregida, error: e4 } = await supabase.from('reglas_clasificacion')
      .update({ subcuenta_id, ceco_id: ceco_id || null, tipo_respaldo: tipo_respaldo || null, aciertos: 1 }).eq('id', principal.id)
      .select('id, tipo_regla, patron, subcuenta_id, ceco_id, tipo_respaldo, aciertos').single()
    if (e4) throw e4
    await borrar(resto.map(r => r.id))
    return { accion: 'corrige', regla: corregida, eliminadas: resto.map(r => r.id) }
  }
  const { data: nueva, error: e3 } = await supabase.from('reglas_clasificacion')
    .insert({ tipo_regla, patron: patrones[0], subcuenta_id, ceco_id: ceco_id || null, tipo_respaldo: tipo_respaldo || null, aciertos: 1 })
    .select('id, tipo_regla, patron, subcuenta_id, ceco_id, tipo_respaldo, aciertos').single()
  if (e3) throw e3
  return { accion: 'nueva', regla: nueva }
}

// Refleja en memoria una clasificación recién guardada, para que las líneas
// siguientes de la misma sesión ya la usen sin recargar todo el historial.
export function aprenderEnMemoria(ctx, { descripcion, tipo, subcuenta_id, ceco_id, tipo_respaldo }, resultadoRegla) {
  if (!ctx || !subcuenta_id) return ctx
  const row = { descripcion, tipo, subcuenta_id, ceco_id, tipo_respaldo }
  const pat = extraerPatronDesc(descripcion); if (pat) acumular(ctx._conteoPatron, `${tipo ?? ''}|${pat}`, row)
  const rut = rutDeGlosa(descripcion); if (rut) acumular(ctx._conteoRut, `${tipo ?? ''}|${rut}`, row)
  let reglas = ctx.reglas
  if (resultadoRegla?.eliminadas?.length) reglas = reglas.filter(r => !resultadoRegla.eliminadas.includes(r.id))
  if (resultadoRegla?.accion === 'nueva' && resultadoRegla.regla) reglas = [...reglas, resultadoRegla.regla]
  if (resultadoRegla?.accion === 'corrige' && resultadoRegla.regla) reglas = reglas.map(r => r.id === resultadoRegla.regla.id ? resultadoRegla.regla : r)
  if (resultadoRegla?.accion === 'refuerza') reglas = reglas.map(r => r.id === resultadoRegla.id ? { ...r, aciertos: (r.aciertos ?? 0) + 1 } : r)
  return {
    ...ctx, reglas,
    patrones: ganadores(ctx._conteoPatron, { minTotal: 2, exigir2Palabras: true }),
    ruts: ganadores(ctx._conteoRut, { minTotal: 1, exigir2Palabras: false }),
  }
}

/* ── Ayudas para el buscador de cuentas (Clasificar y conciliar) ───────── */
// Cómo se clasificó antes este RUT (mismo sentido): subcuentas, veces y su centro de costo más usado.
export function historialDeRut(ctx, tipo, descripcion) {
  const rut = rutDeGlosa(descripcion)
  const subs = ctx && rut ? ctx._conteoRut?.get(`${tipo ?? ''}|${rut}`) : null
  if (!subs) return []
  return [...subs.entries()].map(([subcuenta_id, info]) => ({ subcuenta_id, veces: info.veces, ceco_id: info.ceco_id ?? null }))
    .sort((a, b) => b.veces - a.veces)
}
// Palabras de las glosas clasificadas en cada subcuenta ("copec" → la subcuenta de las compras COPEC).
export function indicePalabras(ctx) {
  const acc = new Map()
  for (const [clave, subs] of ctx?._conteoPatron ?? []) {
    const palabras = clave.slice(clave.indexOf('|') + 1).replace(/^MERCHANT:/, '').split(/\s+/).filter(w => w.length >= 3)
    for (const [subId, info] of subs) {
      if (!acc.has(subId)) acc.set(subId, new Map())
      const m = acc.get(subId)
      for (const w of palabras) m.set(w, (m.get(w) ?? 0) + info.veces)
    }
  }
  const out = new Map()
  for (const [subId, m] of acc) out.set(subId, [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([palabra, veces]) => ({ palabra: palabra.toLowerCase(), veces })))
  return out
}

/* ── Segunda opinión para lo YA clasificado ("A revisar") ─────────────────
   Con el historial del mismo RUT (o de la misma glosa), quitando el voto de la
   propia línea: si la subcuenta que el historial pone es otra y ese tipo de
   sugerencia acierta ≥90% medido, la línea queda para revisar. */
export const UMBRAL_REVISION = 90
export function segundaOpinion(row, ctx) {
  if (!ctx || !row?.subcuenta_id) return null
  const propio = ctx._hist?.get(row.id) ?? null
  const prueba = (conteo, clave, fuente, minTotal) => {
    const subs = clave ? conteo?.get(clave) : null
    if (!subs) return null
    let mejor = null, total = 0
    for (const [subId, info] of subs) {
      const v = info.veces - (subId === propio ? 1 : 0)
      if (v <= 0) continue
      total += v
      if (!mejor || v > mejor.v) mejor = { subId, v, ceco: info.ceco_id ?? null }
    }
    if (!mejor || total < minTotal) return null
    const cons = mejor.v / total
    if (cons < 0.6) return null
    const med = medidoDe(ctx.calib?.[fuente], tramoDe(mejor.v, cons))
    return med ? { subcuenta_id: mejor.subId, ceco_id: mejor.ceco, veces: mejor.v, total, score: med.score, n: med.n, fuente } : null
  }
  const tipo = row.tipo ?? ''
  const rut = rutDeGlosa(row.descripcion)
  let o = rut ? prueba(ctx._conteoRut, `${tipo}|${rut}`, 'rut_historico', 1) : null
  if (!o) {
    const p = extraerPatronDesc(row.descripcion)
    if (p && (p.startsWith('MERCHANT:') || p.split(' ').filter(Boolean).length >= 2)) o = prueba(ctx._conteoPatron, `${tipo}|${p}`, 'patron_historico', 2)
  }
  if (!o || o.subcuenta_id === row.subcuenta_id || o.score < UMBRAL_REVISION) return null
  const quien = o.fuente === 'rut_historico' ? 'Este RUT' : 'Esta glosa'
  return { ...o, razon: `${quien} se clasificó ${o.veces} de ${o.total} veces en esa subcuenta; sugerencias así aciertan el ${o.score.toLocaleString('es-CL')}%.` }
}
