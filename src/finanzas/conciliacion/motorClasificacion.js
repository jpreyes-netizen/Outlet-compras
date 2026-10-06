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
  if (!subs.has(row.subcuenta_id)) subs.set(row.subcuenta_id, { ceco_id: row.ceco_id, tipo_respaldo: row.tipo_respaldo, veces: 0 })
  subs.get(row.subcuenta_id).veces += 1
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
  return {
    patrones: ganadores(porPatron, { minTotal: 2, exigir2Palabras: true }),
    ruts: ganadores(porRut, { minTotal: 1, exigir2Palabras: false }),
    _conteoPatron: porPatron, _conteoRut: porRut,
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
  const [rg, sc, hi, pv] = await Promise.all([
    supabase.from('reglas_clasificacion').select('id, tipo_regla, patron, subcuenta_id, ceco_id, tipo_respaldo, aciertos'),
    supabase.from('subcuentas').select('id, codigo, nombre, activa, cuenta_madre:cuentas_madre(tipo)'),
    supabase.from('movimientos_bancarios').select('descripcion, tipo, subcuenta_id, ceco_id, tipo_respaldo')
      .eq('estado', 'clasificado').not('subcuenta_id', 'is', null).limit(10000),
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
  return { reglas: rg.data ?? [], subById, pvPorRut, normRut, ...construirAprendizaje(hi.data) }
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

  if (found && found.score == null) Object.assign(found, calcularScoreSugerencia(found))
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
  const { data: existentes, error } = await supabase.from('reglas_clasificacion').select('id, aciertos, patron')
    .eq('tipo_regla', tipo_regla).in('patron', patrones).eq('subcuenta_id', subcuenta_id).limit(1)
  if (error) throw error
  const ex = existentes?.[0]
  if (ex) {
    const { error: e2 } = await supabase.from('reglas_clasificacion').update({ aciertos: (ex.aciertos ?? 0) + 1 }).eq('id', ex.id)
    if (e2) throw e2
    return { accion: 'refuerza', id: ex.id }
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
  if (resultadoRegla?.accion === 'nueva' && resultadoRegla.regla) reglas = [...reglas, resultadoRegla.regla]
  if (resultadoRegla?.accion === 'refuerza') reglas = reglas.map(r => r.id === resultadoRegla.id ? { ...r, aciertos: (r.aciertos ?? 0) + 1 } : r)
  return {
    ...ctx, reglas,
    patrones: ganadores(ctx._conteoPatron, { minTotal: 2, exigir2Palabras: true }),
    ruts: ganadores(ctx._conteoRut, { minTotal: 1, exigir2Palabras: false }),
  }
}
