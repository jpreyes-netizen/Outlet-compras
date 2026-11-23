// src/rrhh/remuneraciones/remDatos.js
// ─────────────────────────────────────────────────────────────────────────────
// Capa de datos única de los reportes de Remuneraciones: el Panel de dotación y
// costo y el Informe mensual leen y calculan aquí, así ambas pantallas muestran
// exactamente las mismas cifras.
//
// Criterios (definidos con JP, nov-2026):
//  · Costo de personal oficial = libro mayor (v_informe_resultado_mensual, el
//    mismo EERR que va al directorio). La nómina entrega el detalle.
//  · El centro de cada mes sale de la liquidación de ese mes (centro_costo_texto
//    → ceco_alias), igual que Finanzas. La ficha actual del empleado reescribía
//    la historia de quien cambió de sucursal.
//  · Dotación = liquidaciones emitidas en el mes. FTE = días trabajados ÷ 30.
//  · Socios (cuenta madre 761) incluidos por defecto. Quien no tiene permiso no
//    los recibe: se excluyen en la consulta, no solo en pantalla.
//  · Todas las lecturas paginan de a 1.000 filas para no depender del límite de
//    filas de la API (los reportes anteriores hacían un solo select('*')).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '../../supabase'
import { canSync, preloadCaps } from '../../core/permisos'

// ─── Formatos (es-CL) ───────────────────────────────────────────────────────
const NF = [0, 1, 2].map(d => new Intl.NumberFormat('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d }))
const esNum = n => typeof n === 'number' && Number.isFinite(n)
const signo = n => (n > 0 ? '+' : n < 0 ? '−' : '')
export const fN = (n, d = 0) => (esNum(n) ? NF[Math.min(d, 2)].format(n) : '—')
export const fmt = n => (esNum(n) ? `${n < 0 ? '−' : ''}$${NF[0].format(Math.abs(Math.round(n)))}` : '—')
export const fM = n => {
  if (!esNum(n)) return '—'
  const a = Math.abs(n), s = n < 0 ? '−' : ''
  if (a >= 1e6) return `${s}$${NF[1].format(a / 1e6)}M`
  if (a >= 1e3) return `${s}$${NF[0].format(a / 1e3)}k`
  return `${s}$${NF[0].format(a)}`
}
export const fP = (n, d = 1) => (esNum(n) ? `${NF[Math.min(d, 2)].format(n * 100)}%` : '—')
export const fVar = (n, d = 1) => (esNum(n) ? `${signo(n)}${NF[Math.min(d, 2)].format(Math.abs(n) * 100)}%` : '—')
export const fPts = n => (esNum(n) ? `${signo(n)}${NF[1].format(Math.abs(n) * 100)} pts` : '—')
export const fDelta = (n, f = fM) => (esNum(n) ? `${signo(n)}${f(Math.abs(n))}` : '—')
export const fEnt = n => (esNum(n) ? `${signo(n)}${NF[0].format(Math.abs(n))}` : '—')
export const fPesos = n => (esNum(n) ? `$${NF[2].format(n)}` : '—')
export const div = (a, b) => (esNum(a) && esNum(b) && b !== 0 ? a / b : null)
export const variacion = (a, b) => (esNum(a) && esNum(b) && a !== 0 ? (b - a) / Math.abs(a) : null)
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// ─── Meses ──────────────────────────────────────────────────────────────────
export const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const mesSolo = p => (p ? MESES[+p.slice(5, 7) - 1] : '—')
export const mesCorto = p => (p ? `${MESES[+p.slice(5, 7) - 1]} ${p.slice(2, 4)}` : '—')
export const mesTexto = p => (p ? `${MESES_L[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}` : '—')
export const mesLargo = p => { const t = mesTexto(p); return t === '—' ? t : t[0].toUpperCase() + t.slice(1) }
export const perAnterior = p => { let y = +p.slice(0, 4), mm = +p.slice(5, 7) - 1; if (mm === 0) { y -= 1; mm = 12 } return `${y}-${String(mm).padStart(2, '0')}` }
export const perAnioAnterior = p => `${+p.slice(0, 4) - 1}${p.slice(4)}`

// ─── Catálogos ──────────────────────────────────────────────────────────────
export const FUNCIONES = { 600: 'Operación', 610: 'Venta', 760: 'Administración', 761: 'Socios' }
const ORDEN_FUNCION = ['Venta', 'Operación', 'Administración', 'Socios', 'Sin función']
export const PARTIDA = {
  sueldo_base: { l: 'Sueldo base', c: 'fijo' },
  gratificacion: { l: 'Gratificación', c: 'fijo' },
  colacion: { l: 'Colación', c: 'fijo' },
  movilizacion: { l: 'Movilización', c: 'fijo' },
  viatico: { l: 'Viáticos', c: 'fijo' },
  comision: { l: 'Comisiones', c: 'variable' },
  hora_extra: { l: 'Horas extra', c: 'variable' },
  bono: { l: 'Bonos', c: 'variable' },
  ajuste: { l: 'Ajustes de sueldo', c: 'otro' },
  otros: { l: 'Otros haberes', c: 'otro' },
  sin_detalle: { l: 'Liquidación sin detalle', c: 'otro' },
  aporte: { l: 'Aportes patronales (est.)', c: 'aporte' },
  honorario: { l: 'Honorarios', c: 'honorario' },
}
const PARTIDA_HABER = new Set(['sueldo_base', 'gratificacion', 'colacion', 'movilizacion', 'viatico', 'comision', 'hora_extra', 'bono', 'ajuste'])
export const partidaL = k => PARTIDA[k]?.l || k
export const claseDe = k => PARTIDA[k]?.c || 'otro'
export const CLASES = [
  { k: 'fijo', l: 'Fijo', c: '#16213E' },
  { k: 'variable', l: 'Variable', c: '#B25E09' },
  { k: 'otro', l: 'Otros haberes', c: '#AEB4BE' },
  { k: 'aporte', l: 'Aportes patronales', c: '#175CD3' },
  { k: 'honorario', l: 'Honorarios', c: '#6941C6' },
]
export const TIPOS_HHEE = [
  { k: 'normal', l: 'Normal (2 primeras horas)', c: '#175CD3' },
  { k: 'especial', l: 'Especial (desde la 3ª hora)', c: '#16213E' },
  { k: 'feriado', l: 'Feriado trabajado', c: '#B25E09' },
  { k: 'pactada', l: 'Pactadas', c: '#6941C6' },
  { k: 'mes_anterior', l: 'Rezagadas del mes anterior', c: '#8E96A3' },
  { k: 'ajuste', l: 'Ajustes y otras', c: '#C9CED6' },
]
export const tipoHheeL = k => TIPOS_HHEE.find(t => t.k === k)?.l || k || '—'
const NOMBRE_CENTRO = { 'suc-lg': 'La Granja', 'suc-la': 'Los Ángeles', 'suc-maipu': 'Tienda Maipú', 'suc-web': 'Canal web', 'suc-mp': 'CD Maipú', ADM: 'Administración central' }
const ORDEN_CENTRO = ['suc-lg', 'suc-la', 'suc-maipu', 'suc-web', 'suc-mp', 'ADM']
// CD y administración central no venden: se miden por costo, no por ROI.
export const esApoyo = c => c === 'suc-mp' || c === 'ADM'

// Clase de una glosa de horas extra. Usa rrhh_hhee_glosa_clase y, si falta, el nombre.
function tipoHhee(l, clases) {
  const nom = String(l.glosa_nombre || '').toUpperCase()
  if (nom.startsWith('AJUSTE')) return 'ajuste'
  const cl = clases.get(Number(l.glosa_codigo))
  if (cl === 'feriado' || nom.includes('FERIADO')) return 'feriado'
  if (cl === 'pactada' || nom.includes('PACTAD')) return 'pactada'
  if (cl === 'ajuste_anterior' || nom.includes('ANTERIOR')) return 'mes_anterior'
  if (nom.includes('ESPEC')) return 'especial'
  if (cl === 'variable' || nom.includes('EXTRA')) return 'normal'
  return 'ajuste'
}

// ─── Lectura ────────────────────────────────────────────────────────────────
async function traerTodo(armar, orden) {
  const out = []
  for (let desde = 0, vuelta = 0; vuelta < 400; vuelta++) {
    let q = armar()
    for (const o of orden) q = q.order(o, { ascending: true })
    const { data, error } = await q.range(desde, desde + 999)
    if (error) throw new Error(error.message || String(error))
    if (!data || !data.length) break
    out.push(...data)
    desde += data.length
  }
  return out
}
const opcional = async fn => {
  try { return { ok: true, data: await fn(), error: null } } catch (e) { return { ok: false, data: [], error: e?.message || String(e) } }
}

export async function cargarDatos(cu) {
  try { await preloadCaps(cu, 'rrhh') } catch { /* sin capabilities: decide la BD */ }
  // La BD es la autoridad: fn_puede_ver_socios() es la misma regla que filtra v_rrhh_master.
  let verSocios = null
  try {
    const { data, error } = await supabase.rpc('fn_puede_ver_socios')
    if (!error && typeof data === 'boolean') verSocios = data
  } catch { /* función no disponible */ }
  if (verSocios == null) { try { verSocios = !!canSync(cu, 'rrhh', 'rrhh.rem.ver_socios') } catch { verSocios = false } }

  const emp = await traerTodo(() => supabase.from('rrhh_empleados')
    .select('cod_contaline,nombre,cargo,cuenta_madre_codigo,fecha_ingreso,fecha_egreso'), ['cod_contaline'])
  const socios = emp.filter(e => String(e.cuenta_madre_codigo) === '761' && e.cod_contaline != null).map(e => e.cod_contaline)
  const sinSocios = q => (!verSocios && socios.length ? q.not('cod_contaline', 'in', `(${socios.join(',')})`) : q)

  const [liq, lin, apo, hon, libro, clases, alias, cecos, eerr, suc] = await Promise.all([
    traerTodo(() => sinSocios(supabase.from('rrhh_liquidaciones')
      .select('id,periodo,cod_contaline,nombre,cargo,centro_costo_texto,dias_trabajados,total_haberes,fecha_ingreso')), ['id']),
    traerTodo(() => sinSocios(supabase.from('rrhh_liquidacion_lineas')
      .select('liquidacion_id,periodo,cod_contaline,glosa_codigo,glosa_nombre,tipo_glosa,naturaleza,monto')), ['id']),
    opcional(() => traerTodo(() => sinSocios(supabase.from('v_rrhh_aportes_patronales')
      .select('periodo,cod_contaline,aporte_codigo,monto_aporte')), ['periodo', 'cod_contaline', 'aporte_codigo'])),
    opcional(() => traerTodo(() => supabase.from('v_rrhh_master')
      .select('periodo,trabajador,cargo,cuenta_madre_codigo,glosa_nombre,monto').eq('naturaleza', 'honorario'), ['periodo', 'trabajador', 'monto'])),
    verSocios
      ? opcional(() => traerTodo(() => supabase.from('rrhh_libro_resumen').select('*'), ['periodo']))
      : Promise.resolve({ ok: true, data: [], error: null }),
    opcional(() => traerTodo(() => supabase.from('rrhh_hhee_glosa_clase').select('glosa_codigo,clase'), ['glosa_codigo'])),
    opcional(() => traerTodo(() => supabase.from('ceco_alias').select('alias,ceco_id'), ['alias'])),
    opcional(() => traerTodo(() => supabase.from('cecos').select('id,nombre'), ['id'])),
    opcional(() => traerTodo(() => supabase.from('v_informe_resultado_mensual')
      .select('periodo,venta,costo,margen_bruto,remuneraciones,ebitda,resultado,mes_en_curso'), ['periodo'])),
    opcional(() => traerTodo(() => supabase.from('v_eerr_sucursal')
      .select('periodo,ceco,ingresos,margen_bruto,remuneraciones'), ['periodo', 'ceco'])),
  ])
  const hh = { ok: true, data: [], error: null, pendiente: true }
  return { verSocios, emp, liq, lin, apo, hon, libro, clases, alias, cecos, eerr, suc, hh, cargadoAt: new Date() }
}

// Workera es la lectura más lenta (≈2,5 s por página en producción, nov-2026): se carga
// aparte, después de mostrar el panel, para no demorar la primera vista.
export async function cargarWorkera() {
  return opcional(() => traerTodo(() => supabase.from('v_asis_costo_hhee')
    .select('periodo,fecha,cod_contaline,empleado,sucursal_nombre,minutos_extra,estado,excede_tope_legal,workshift_name'),
  ['fecha', 'cod_contaline', 'workshift_name', 'minutos_extra', 'estado']))
}

// ─── Modelo ─────────────────────────────────────────────────────────────────
function aggVacio() {
  return {
    dot: 0, pagados: 0, fte: 0, prest: new Set(), haberes: 0, aportes: 0, honorario: 0, costo: 0, sueldoBase: 0,
    hhee: 0, hheeTipo: {}, conHhee: 0, partidas: {}, clases: {}, descLegal: 0, descInterno: 0, cods: new Set(), sinLineas: 0,
  }
}
function sumarReg(a, r) {
  if (r.tipo === 'liq') { a.dot += 1; a.fte += r.fte; a.cods.add(r.cod); if (r.haberes > 0) a.pagados += 1; if (r.sinLineas) a.sinLineas += 1 } else a.prest.add(r.nombre)
  a.haberes += r.haberes; a.aportes += r.aportes; a.honorario += r.honorario; a.costo += r.costo
  a.sueldoBase += r.sueldoBase; a.descLegal += r.descLegal; a.descInterno += r.descInterno
  a.hhee += r.hheeTotal; if (r.hheeTotal > 0) a.conHhee += 1
  for (const k in r.hhee) a.hheeTipo[k] = (a.hheeTipo[k] || 0) + r.hhee[k]
  for (const k in r.partidas) { const v = r.partidas[k]; a.partidas[k] = (a.partidas[k] || 0) + v; const c = claseDe(k); a.clases[c] = (a.clases[c] || 0) + v }
  return a
}
// Suma varios meses. dotProm/fteProm son promedios mensuales; fte queda en FTE-mes.
export function combinar(aggs) {
  const t = aggVacio()
  for (const a of aggs) {
    t.dot += a.dot; t.pagados += a.pagados; t.fte += a.fte; a.prest.forEach(x => t.prest.add(x))
    t.haberes += a.haberes; t.aportes += a.aportes; t.honorario += a.honorario; t.costo += a.costo; t.sueldoBase += a.sueldoBase
    t.hhee += a.hhee; t.conHhee += a.conHhee; t.descLegal += a.descLegal; t.descInterno += a.descInterno; t.sinLineas += a.sinLineas
    for (const k in a.hheeTipo) t.hheeTipo[k] = (t.hheeTipo[k] || 0) + a.hheeTipo[k]
    for (const k in a.partidas) t.partidas[k] = (t.partidas[k] || 0) + a.partidas[k]
    for (const k in a.clases) t.clases[k] = (t.clases[k] || 0) + a.clases[k]
    a.cods.forEach(c => t.cods.add(c))
  }
  const n = aggs.length
  t.meses = n; t.dotProm = n ? t.dot / n : 0; t.fteProm = n ? t.fte / n : 0
  return t
}

export function construirModelo(raw, incluirSocios = true) {
  const conSocios = !!raw.verSocios && incluirSocios !== false
  const empMap = new Map((raw.emp || []).map(e => [e.cod_contaline, e]))
  const cmDe = cod => String(empMap.get(cod)?.cuenta_madre_codigo ?? '')
  const aliasMap = new Map((raw.alias?.data || []).map(a => [a.alias, a.ceco_id]))
  const nomCecos = new Map((raw.cecos?.data || []).map(c => [c.id, c.nombre]))
  const nombreCentro = id => NOMBRE_CENTRO[id] || nomCecos.get(id) || id || 'Sin centro'
  const clases = new Map((raw.clases?.data || []).map(g => [Number(g.glosa_codigo), g.clase]))
  const apoMap = new Map()
  for (const a of raw.apo?.data || []) { const k = `${a.periodo}|${a.cod_contaline}`; apoMap.set(k, (apoMap.get(k) || 0) + num(a.monto_aporte)) }
  const linPorLiq = new Map()
  for (const l of raw.lin || []) { const arr = linPorLiq.get(l.liquidacion_id); if (arr) arr.push(l); else linPorLiq.set(l.liquidacion_id, [l]) }

  const regs = [], lineas = []
  const calidad = { sinMapeo: new Map(), sinLineas: new Map(), sinFuncion: 0 }
  const linea = (r, extra) => lineas.push({ periodo: r.periodo, cod: r.cod, trabajador: r.nombre, cargo: r.cargo, ceco: r.ceco, funcion: r.funcion, tipoHhee: null, ...extra })

  for (const q of raw.liq || []) {
    const cm = cmDe(q.cod_contaline)
    if (!conSocios && cm === '761') continue
    const e = empMap.get(q.cod_contaline)
    let ceco = aliasMap.get(q.centro_costo_texto)
    if (!ceco) { ceco = 'ADM'; const t = q.centro_costo_texto || '(sin centro)'; calidad.sinMapeo.set(t, (calidad.sinMapeo.get(t) || 0) + 1) }
    const ls = linPorLiq.get(q.id) || []
    const dias = q.dias_trabajados == null ? (num(q.total_haberes) > 0 ? 30 : 0) : Math.max(0, Math.min(30, num(q.dias_trabajados)))
    const r = {
      tipo: 'liq', periodo: q.periodo, cod: q.cod_contaline,
      nombre: q.nombre || e?.nombre || `Trabajador ${q.cod_contaline}`,
      cargo: String(q.cargo || e?.cargo || 'Sin cargo').trim(), ceco,
      funcion: FUNCIONES[cm] || 'Sin función', socio: cm === '761',
      dias, fte: dias / 30, haberes: 0, aportes: apoMap.get(`${q.periodo}|${q.cod_contaline}`) || 0, honorario: 0,
      sueldoBase: 0, descLegal: 0, descInterno: 0, hhee: {}, hheeTotal: 0, partidas: {},
      sinLineas: ls.length === 0, fechaIngreso: q.fecha_ingreso || e?.fecha_ingreso || null,
    }
    if (r.funcion === 'Sin función') calidad.sinFuncion += 1
    for (const l of ls) {
      const mto = num(l.monto), nat = l.naturaleza
      if (nat === 'haber_imponible' || nat === 'haber_no_imponible') {
        const p = PARTIDA_HABER.has(l.tipo_glosa) ? l.tipo_glosa : 'otros'
        r.partidas[p] = (r.partidas[p] || 0) + mto
        r.haberes += mto
        if (p === 'sueldo_base') r.sueldoBase += mto
        let t = null
        if (p === 'hora_extra') { t = tipoHhee(l, clases); r.hhee[t] = (r.hhee[t] || 0) + mto; r.hheeTotal += mto }
        linea(r, { glosa: l.glosa_nombre || '—', naturaleza: nat, partida: p, monto: mto, tipoHhee: t })
      } else if (nat === 'descuento_legal' || nat === 'descuento_interno') {
        if (nat === 'descuento_legal') r.descLegal += mto; else r.descInterno += mto
        linea(r, { glosa: l.glosa_nombre || '—', naturaleza: nat, partida: l.tipo_glosa || 'descuento', monto: mto })
      }
    }
    if (!ls.length && num(q.total_haberes) > 0) {
      const v = num(q.total_haberes)
      r.partidas.sin_detalle = v; r.haberes = v
      linea(r, { glosa: 'Total haberes (liquidación sin detalle)', naturaleza: 'haber_imponible', partida: 'sin_detalle', monto: v })
    }
    if (r.sinLineas) calidad.sinLineas.set(r.periodo, (calidad.sinLineas.get(r.periodo) || 0) + 1)
    if (r.aportes) { r.partidas.aporte = r.aportes; linea(r, { glosa: 'Aportes patronales (estimado)', naturaleza: 'aporte', partida: 'aporte', monto: r.aportes }) }
    r.costo = r.haberes + r.aportes
    regs.push(r)
  }
  // Boletas: v_rrhh_master ya excluye socios para quien no tiene permiso.
  for (const h of raw.hon?.data || []) {
    const cm = String(h.cuenta_madre_codigo ?? '')
    if (!conSocios && cm === '761') continue
    const mto = num(h.monto)
    const r = {
      tipo: 'hon', periodo: h.periodo, cod: null, nombre: h.trabajador || 'Prestador', cargo: h.cargo || 'Honorarios', ceco: 'ADM',
      funcion: FUNCIONES[cm] || 'Sin función', socio: cm === '761', dias: 0, fte: 0, haberes: 0, aportes: 0, honorario: mto, costo: mto,
      sueldoBase: 0, descLegal: 0, descInterno: 0, hhee: {}, hheeTotal: 0, partidas: { honorario: mto }, sinLineas: false, fechaIngreso: null,
    }
    regs.push(r)
    linea(r, { glosa: h.glosa_nombre || 'Boleta de honorarios', naturaleza: 'honorario', partida: 'honorario', monto: mto })
  }

  const tot = new Map(), centro = new Map(), funcion = new Map()
  const tomar = (mapa, p) => { let a = mapa.get(p); if (!a) { a = aggVacio(); mapa.set(p, a) } return a }
  const tomarSub = (mapa, p, k) => { let mm = mapa.get(p); if (!mm) { mm = new Map(); mapa.set(p, mm) } let a = mm.get(k); if (!a) { a = aggVacio(); mm.set(k, a) } return a }
  for (const r of regs) { sumarReg(tomar(tot, r.periodo), r); sumarReg(tomarSub(centro, r.periodo, r.ceco), r); sumarReg(tomarSub(funcion, r.periodo, r.funcion), r) }
  const periodos = [...tot.keys()].sort()
  const regPC = new Map(regs.filter(r => r.tipo === 'liq').map(r => [`${r.periodo}|${r.cod}`, r]))

  // Ingresos: en el mes y no en el anterior. Salidas: en el mes y no en el siguiente
  // (último mes trabajado). Sin mes siguiente cargado se usa la fecha de egreso de la ficha.
  const flujos = new Map()
  periodos.forEach((p, i) => {
    const prev = periodos[i - 1], next = periodos[i + 1]
    const B = tot.get(p).cods
    const A = prev && prev === perAnterior(p) ? tot.get(prev).cods : null
    const N = next && perAnterior(next) === p ? tot.get(next).cods : null
    const ingresos = A ? [...B].filter(c => !A.has(c)) : null
    const salidas = N ? [...B].filter(c => !N.has(c)) : [...B].filter(c => String(empMap.get(c)?.fecha_egreso || '').slice(0, 7) === p)
    flujos.set(p, { ingresos, salidas, salidasFicha: !N })
  })

  const eerr = new Map()
  for (const x of raw.eerr?.data || []) {
    eerr.set(x.periodo, { venta: num(x.venta), costoVenta: num(x.costo), mb: num(x.margen_bruto), cp: num(x.remuneraciones), ebitda: num(x.ebitda), resultado: num(x.resultado), enCurso: !!x.mes_en_curso })
  }
  const suc = new Map()
  for (const x of raw.suc?.data || []) {
    if (!x.ceco || x.ceco === 'suc-ajuste-jun') continue
    let mm = suc.get(x.periodo); if (!mm) { mm = new Map(); suc.set(x.periodo, mm) }
    mm.set(x.ceco, { ingresos: num(x.ingresos), mb: num(x.margen_bruto), rem: num(x.remuneraciones) })
  }
  const APORTES_LIBRO = ['aporte_mutual', 'aporte_cesantia', 'aporte_sis', 'aporte_capitalizacion', 'aporte_expectativa_vida', 'aporte_rentabilidad_protegida']
  const libro = new Map()
  for (const x of raw.libro?.data || []) libro.set(x.periodo, { aportes: APORTES_LIBRO.reduce((s, k) => s + num(x[k]), 0), haberes: num(x.total_haberes), n: num(x.n_empleados) })

  const setC = new Set()
  centro.forEach(mm => mm.forEach((_, k) => setC.add(k)))
  suc.forEach(mm => mm.forEach((v, k) => { if (v.ingresos || v.rem) setC.add(k) }))
  const posC = c => { const i = ORDEN_CENTRO.indexOf(c); return i < 0 ? 99 : i }
  const centros = [...setC].sort((a, b) => posC(a) - posC(b) || String(a).localeCompare(String(b)))
  const setF = new Set(); funcion.forEach(mm => mm.forEach((_, k) => setF.add(k)))
  const posF = f => { const i = ORDEN_FUNCION.indexOf(f); return i < 0 ? 99 : i }
  const funciones = [...setF].sort((a, b) => posF(a) - posF(b))
  const hh = (raw.hh?.data || []).map(x => ({ periodo: x.periodo, cod: x.cod_contaline, nombre: x.empleado, sucursal: x.sucursal_nombre || 'Sin sucursal', min: num(x.minutos_extra), estado: x.estado || 'pendiente', sobreTope: !!x.excede_tope_legal }))

  const FUENTES = { apo: 'aportes patronales', hon: 'honorarios', libro: 'libro de remuneraciones', clases: 'clases de horas extra', alias: 'centros de costo', cecos: 'centros', eerr: 'libro mayor (venta y costo oficial)', suc: 'resultado por centro', hh: 'horas de Workera' }
  calidad.errores = Object.keys(FUENTES).filter(k => raw[k]?.ok === false && raw[k]?.error).map(k => ({ fuente: FUENTES[k], error: raw[k].error }))
  calidad.aportesReales = conSocios ? periodos.filter(p => libro.has(p)) : []
  calidad.workeraDesde = hh.length ? hh.reduce((mn, x) => (x.periodo < mn ? x.periodo : mn), hh[0].periodo) : null
  calidad.workeraPendiente = !!raw.hh?.pendiente

  return {
    verSocios: !!raw.verSocios, conSocios, regs, lineas, tot, centro, funcion, flujos, eerr, suc, libro, hh, centros, funciones,
    periodos, regPC, nombreCentro, empMap, calidad, cargadoAt: raw.cargadoAt || null, _vacio: aggVacio(),
  }
}

// ─── Accesos ────────────────────────────────────────────────────────────────
export const agg = (m, p) => (p && m.tot.get(p)) || m._vacio
export const aggCentro = (m, p, c) => (p && m.centro.get(p)?.get(c)) || m._vacio
export const aggFuncion = (m, p, f) => (p && m.funcion.get(p)?.get(f)) || m._vacio
export const mesesNomina = (m, anio) => m.periodos.filter(p => p.startsWith(String(anio)))
export const costoNomina = a => a.haberes + a.aportes + a.honorario
export const costoPorFte = a => div(a.haberes + a.aportes, a.fte)
export function mm3(arr) {
  return arr.map((v, i) => { const w = arr.slice(Math.max(0, i - 2), i + 1).filter(esNum); return i >= 2 && w.length === 3 ? (w[0] + w[1] + w[2]) / 3 : null })
}
export function periodoBase(m, anio, mes, base) {
  if (!mes) return null
  if (base === 'anterior') { const p = perAnterior(mes); return m.tot.has(p) ? p : null }
  if (base === 'anio_ant') { const p = perAnioAnterior(mes); return m.tot.has(p) || m.eerr.has(p) ? p : null }
  const ps = mesesNomina(m, anio)
  return ps[0] && ps[0] !== mes ? ps[0] : null
}

// Ingresos y salidas de un conjunto de meses, agrupados por la clave que se indique.
export function movimientos(m, ps, claveReg) {
  const porGrupo = new Map()
  const tomar = k => { let x = porGrupo.get(k); if (!x) { x = { ing: 0, sal: 0 }; porGrupo.set(k, x) } return x }
  let ing = 0, sal = 0, salFicha = 0
  for (const p of ps) {
    const f = m.flujos.get(p); if (!f) continue
    for (const c of f.ingresos || []) { const r = m.regPC.get(`${p}|${c}`); if (r) { tomar(claveReg(r)).ing += 1; ing += 1 } }
    for (const c of f.salidas || []) { const r = m.regPC.get(`${p}|${c}`); if (r) { tomar(claveReg(r)).sal += 1; sal += 1; if (f.salidasFicha) salFicha += 1 } }
  }
  return { porGrupo, ing, sal, salFicha }
}

// ─── Serie mensual (libro mayor + nómina) ───────────────────────────────────
export function filasMensuales(m, anio) {
  const meses = [...new Set([...mesesNomina(m, anio), ...[...m.eerr.keys()].filter(p => p.startsWith(String(anio)))])].sort()
  const rows = meses.map(p => {
    const e = m.eerr.get(p), a = agg(m, p), tieneN = m.tot.has(p)
    const valido = !!e && !e.enCurso
    return {
      p, enCurso: !!e?.enCurso, sinNomina: !tieneN, sinEerr: !e,
      venta: e ? e.venta : null, mb: e ? e.mb : null, cp: e ? e.cp : null, ebitda: e ? e.ebitda : null,
      pct: valido ? div(e.cp, e.venta) : null, veces: valido ? div(e.venta, e.cp) : null,
      gmrol: valido ? div(e.mb, e.cp) : null, roi: valido ? div(e.mb - e.cp, e.cp) : null,
      dot: tieneN ? a.dot : null, fte: tieneN ? a.fte : null, sb: tieneN ? a.sueldoBase : null,
      costoNomina: tieneN ? costoNomina(a) : null, costoBase: tieneN ? a.haberes + a.aportes : null, costoFte: tieneN ? costoPorFte(a) : null,
      ventaFte: valido && tieneN ? div(e.venta, a.fte) : null,
      hhee: tieneN ? a.hhee : null, hheePctSB: tieneN ? div(a.hhee, a.sueldoBase) : null, conHhee: tieneN ? a.conHhee : null,
    }
  })
  const pm = mm3(rows.map(r => r.pct))
  rows.forEach((r, i) => { r.pctMm3 = pm[i] })
  return rows
}
export function acumulado(rows) {
  const s = (arr, k) => arr.reduce((t, r) => t + (r[k] || 0), 0)
  const cerr = rows.filter(r => !r.enCurso && !r.sinEerr)
  const nom = rows.filter(r => !r.sinNomina)
  const ambos = cerr.filter(r => !r.sinNomina)
  const venta = s(cerr, 'venta'), mb = s(cerr, 'mb'), cp = s(cerr, 'cp')
  const fte = s(nom, 'fte'), sb = s(nom, 'sb'), hhee = s(nom, 'hhee')
  return {
    meses: cerr.length, mesesNomina: nom.length, venta, mb, cp, ebitda: s(cerr, 'ebitda'),
    pct: div(cp, venta), veces: div(venta, cp), gmrol: div(mb, cp), roi: div(mb - cp, cp),
    hhee, sb, hheePctSB: div(hhee, sb), costoNomina: s(nom, 'costoNomina'), costoFte: div(s(nom, 'costoBase'), fte),
    ventaFte: div(s(ambos, 'venta'), s(ambos, 'fte')),
    ftePromedio: nom.length ? fte / nom.length : null, dotPromedio: nom.length ? s(nom, 'dot') / nom.length : null,
  }
}
export function retornoIncremental(m, pA, pB) {
  const a = m.eerr.get(pA), b = m.eerr.get(pB)
  if (!a || !b || a.enCurso || b.enCurso || pA === pB) return null
  const dVenta = b.venta - a.venta, dMb = b.mb - a.mb, dCp = b.cp - a.cp
  return { pA, pB, dVenta, dMb, dCp, retorno: dCp !== 0 ? dMb / dCp : null }
}

// Por centro: venta, margen y costo de personal oficial prorrateado (v_eerr_sucursal,
// el mismo de Finanzas) + FTE y nómina de las liquidaciones del centro.
export function filasCentros(m, periodos) {
  const n = periodos.length
  return m.centros.map(c => {
    let ingresos = 0, mb = 0, rem = 0, fteMeses = 0, costoN = 0, hhee = 0
    for (const p of periodos) {
      const s = m.suc.get(p)?.get(c)
      if (s) { ingresos += s.ingresos; mb += s.mb; rem += s.rem }
      const a = aggCentro(m, p, c); fteMeses += a.fte; costoN += costoNomina(a); hhee += a.hhee
    }
    const apoyo = esApoyo(c) || ingresos <= 0
    const sinPersonal = rem <= 0 && fteMeses <= 0
    const mide = !apoyo && !sinPersonal
    return {
      c, nombre: m.nombreCentro(c), apoyo, sinPersonal, ingresos, mb, rem, fteMeses, fte: n ? fteMeses / n : 0,
      dot: aggCentro(m, periodos[periodos.length - 1], c).dot, costoNomina: costoN, hhee,
      pct: mide ? div(rem, ingresos) : null, gmrol: mide ? div(mb, rem) : null, roi: mide ? div(mb - rem, rem) : null,
      ventaFte: mide ? div(ingresos, fteMeses) : null, costoFte: div(rem, fteMeses),
    }
  }).filter(f => f.ingresos || f.rem || f.fteMeses)
}

// ─── Horas extra ────────────────────────────────────────────────────────────
export function analisisHhee(m, anio) {
  const meses = mesesNomina(m, anio)
  const serie = meses.map(p => {
    const a = agg(m, p), e = m.eerr.get(p)
    return {
      p, total: a.hhee, porTipo: a.hheeTipo, pctSB: div(a.hhee, a.sueldoBase), porFte: div(a.hhee, a.fte),
      personas: a.conHhee, dot: a.dot, pctDot: div(a.conHhee, a.dot), pctVenta: e && !e.enCurso ? div(a.hhee, e.venta) : null,
      sb: a.sueldoBase, fte: a.fte, venta: e && !e.enCurso ? e.venta : null,
    }
  })
  const mv = mm3(serie.map(s => s.total)); serie.forEach((s, i) => { s.mm3 = mv[i] })
  const ytd = serie.reduce((t, s) => t + s.total, 0)
  const n = serie.length
  const prom = (arr, k) => (arr.length ? arr.reduce((t, s) => t + (s[k] || 0), 0) / arr.length : null)
  const prim = serie.slice(0, 3), ult = serie.slice(-3)
  const tend = n >= 6 ? {
    primeros: prom(prim, 'total'), ultimos: prom(ult, 'total'), var: variacion(prom(prim, 'total'), prom(ult, 'total')),
    varFte: variacion(prom(prim, 'porFte'), prom(ult, 'porFte')), varSB: variacion(prom(prim, 'pctSB'), prom(ult, 'pctSB')),
  } : null
  const ultimoMes = n ? +meses[n - 1].slice(5, 7) : 0
  const proyeccion = n ? (ultimoMes < 12 ? ytd + prom(ult, 'total') * (12 - ultimoMes) : ytd) : null
  const per = new Map()
  for (const r of m.regs) {
    if (r.tipo !== 'liq' || !r.periodo.startsWith(String(anio))) continue
    let x = per.get(r.cod)
    if (!x) { x = { cod: r.cod, nombre: r.nombre, cargo: r.cargo, ceco: r.ceco, meses: 0, mesesHhee: 0, hhee: 0, sb: 0, ultimo: '' }; per.set(r.cod, x) }
    x.meses += 1; x.sb += r.sueldoBase; x.hhee += r.hheeTotal; if (r.hheeTotal > 0) x.mesesHhee += 1
    if (r.periodo >= x.ultimo) { x.ultimo = r.periodo; x.cargo = r.cargo; x.ceco = r.ceco; x.nombre = r.nombre }
  }
  const personas = [...per.values()].filter(x => x.hhee > 0).map(x => ({
    ...x, _k: x.cod, centro: m.nombreCentro(x.ceco), pctSB: div(x.hhee, x.sb), promMes: x.mesesHhee ? x.hhee / x.mesesHhee : 0,
    recurrente: x.mesesHhee >= 3 && x.mesesHhee / x.meses >= 0.75,
  })).sort((a, b) => b.hhee - a.hhee)
  const top10 = personas.slice(0, 10).reduce((t, x) => t + x.hhee, 0)
  return { meses, serie, ytd, prom: n ? ytd / n : null, tend, proyeccion, ultimoMes, personas, top10Share: div(top10, ytd), recurrentes: personas.filter(x => x.recurrente).length }
}

function resumirHoras(rows) {
  const a = { min: 0, aut: 0, rech: 0, pend: 0, pers: new Set(), dias: 0, sobreTope: 0 }
  for (const x of rows) {
    a.min += x.min; a.dias += 1; a.pers.add(x.cod); if (x.sobreTope) a.sobreTope += 1
    if (x.estado === 'autorizada') a.aut += x.min; else if (x.estado === 'rechazada') a.rech += x.min; else a.pend += x.min
  }
  return { horas: a.min / 60, aut: a.aut / 60, rech: a.rech / 60, pend: a.pend / 60, personas: a.pers.size, horasPersona: a.pers.size ? a.min / 60 / a.pers.size : null, dias: a.dias, sobreTope: a.sobreTope }
}
// Workera: minutos sobre la jornada por día, mes calendario (no el corte 26–25 de pago).
export function analisisWorkera(m, anio) {
  const porMes = new Map()
  for (const x of m.hh) { if (!String(x.periodo).startsWith(String(anio))) continue; const arr = porMes.get(x.periodo); if (arr) arr.push(x); else porMes.set(x.periodo, [x]) }
  return [...porMes.keys()].sort().map(p => ({ p, _k: p, ...resumirHoras(porMes.get(p)) }))
}
export function workeraPorSucursal(m, p) {
  const g = new Map()
  for (const x of m.hh) { if (x.periodo !== p) continue; const arr = g.get(x.sucursal); if (arr) arr.push(x); else g.set(x.sucursal, [x]) }
  return [...g.entries()].map(([s, rows]) => ({ _k: s, sucursal: s, ...resumirHoras(rows) })).sort((a, b) => b.horas - a.horas)
}

// ─── Puente de costo: efecto dotación vs efecto costo por FTE ───────────────
export function puenteCosto(A, B) {
  const NA = A.fte, NB = B.fte
  const cA = NA ? (A.haberes + A.aportes) / NA : 0, cB = NB ? (B.haberes + B.aportes) / NB : 0
  const efDot = (NB - NA) * cA
  const efCosto = NB * (cB - cA)
  const efHon = B.honorario - A.honorario
  const keys = [...new Set([...Object.keys(A.partidas), ...Object.keys(B.partidas)])].filter(k => k !== 'honorario')
  const detalle = keys.map(k => {
    const a = A.partidas[k] || 0, b = B.partidas[k] || 0
    return { k, l: partidaL(k), porFteA: NA ? a / NA : null, porFteB: NB ? b / NB : null, ef: NB * ((NB ? b / NB : 0) - (NA ? a / NA : 0)) }
  }).sort((x, y) => Math.abs(y.ef) - Math.abs(x.ef))
  const ini = costoNomina(A), fin = costoNomina(B)
  return { ini, fin, efDot, efCosto, efHon, cA, cB, NA, NB, detalle, residuo: fin - (ini + efDot + efCosto + efHon) }
}

// ─── Lectura automática: por dónde partir ───────────────────────────────────
export function hallazgos(m, anio, mes, pBase) {
  const out = []
  const ok = x => x && !x.enCurso && x.venta > 0
  const e = m.eerr.get(mes), eb = pBase ? m.eerr.get(pBase) : null
  if (pBase && pBase !== mes && ok(e) && ok(eb)) {
    const pa = eb.cp / eb.venta, pb = e.cp / e.venta, d = pb - pa
    if (Math.abs(d) >= 0.005) out.push({ nivel: d >= 0.02 ? 'alto' : d > 0 ? 'medio' : 'bien', vista: 'roi', texto: `El costo de personal pasó de ${fP(pa)} de la venta neta en ${mesTexto(pBase)} a ${fP(pb)} en ${mesTexto(mes)} (${fPts(d)}).` })
    const inc = retornoIncremental(m, pBase, mes)
    if (inc && inc.dCp > 0 && inc.retorno != null) {
      out.push({ nivel: inc.retorno < 1 ? 'alto' : 'bien', vista: 'roi', texto: `Desde ${mesTexto(pBase)} el costo mensual de personal subió ${fM(inc.dCp)} y el margen bruto ${fDelta(inc.dMb)}: cada $1 adicional de personal devolvió ${fPesos(inc.retorno)} de margen. Efecto en el margen después de personal: ${fDelta(inc.dMb - inc.dCp)} al mes.` })
    }
  }
  if (pBase && pBase !== mes) {
    const t = []
    for (const c of m.centros) {
      if (esApoyo(c)) continue
      const s = m.suc.get(mes)?.get(c), sb = m.suc.get(pBase)?.get(c)
      if (!s || !sb || s.ingresos <= 0 || sb.ingresos <= 0 || s.rem <= 0 || sb.rem <= 0) continue
      t.push({ c, pa: sb.rem / sb.ingresos, pb: s.rem / s.ingresos, vV: variacion(sb.ingresos, s.ingresos), vC: variacion(sb.rem, s.rem) })
    }
    t.sort((x, y) => (y.pb - y.pa) - (x.pb - x.pa))
    t.filter(w => w.pb - w.pa >= 0.015).slice(0, 2).forEach(w => out.push({
      nivel: w.pb - w.pa >= 0.03 ? 'alto' : 'medio', vista: 'roi',
      texto: `${m.nombreCentro(w.c)}: el costo de personal es ${fP(w.pb)} de su venta (${mesTexto(pBase)}: ${fP(w.pa)}). Venta ${fVar(w.vV)} y costo de personal ${fVar(w.vC)}.`,
    }))
  }
  const h = analisisHhee(m, anio)
  const a = agg(m, mes)
  const s = h.serie.find(x => x.p === mes)
  if (a.hhee > 0 && s) {
    const promSB = div(h.ytd, h.serie.reduce((t, x) => t + x.sb, 0))
    const proy = h.ultimoMes < 12 ? ` Proyección ${anio} al ritmo de los últimos 3 meses: ${fM(h.proyeccion)}.` : ''
    out.push({ nivel: s.pctSB > 0.12 ? 'medio' : 'info', vista: 'hhee', texto: `Horas extra de ${mesTexto(mes)}: ${fM(a.hhee)}, ${fP(s.pctSB)} del sueldo base (promedio del año ${fP(promSB)}), pagadas a ${a.conHhee} de ${a.dot} personas.${proy}` })
  }
  if (h.tend && h.tend.varFte != null && Math.abs(h.tend.varFte) >= 0.15) {
    out.push({ nivel: h.tend.varFte > 0 ? 'medio' : 'bien', vista: 'hhee', texto: `Horas extra por FTE: ${fVar(h.tend.varFte)} al comparar el promedio de los últimos 3 meses con los primeros 3 del año.` })
  }
  if (h.recurrentes >= 5) out.push({ nivel: 'medio', vista: 'hhee', texto: `${h.recurrentes} personas tienen horas extra en 3 de cada 4 meses o más: es carga estructural del puesto, no un peak puntual.` })
  if (h.top10Share != null && h.top10Share >= 0.4 && h.personas.length > 15) out.push({ nivel: 'info', vista: 'hhee', texto: `10 personas concentran ${fP(h.top10Share, 0)} de las horas extra pagadas en ${anio}.` })
  const ab = agg(m, pBase)
  if (pBase && pBase !== mes && ab.dot) {
    out.push({ nivel: 'info', vista: 'dotacion', texto: `Dotación: de ${ab.dot} a ${a.dot} liquidaciones (${fEnt(a.dot - ab.dot)}) y de ${fN(ab.fte, 1)} a ${fN(a.fte, 1)} FTE entre ${mesTexto(pBase)} y ${mesTexto(mes)}. Costo de nómina por FTE: ${fVar(variacion(costoPorFte(ab), costoPorFte(a)))}.` })
  }
  const w = analisisWorkera(m, anio).find(x => x.p === mes)
  if (w && w.sobreTope > 0) out.push({ nivel: 'medio', vista: 'hhee', texto: `Workera registra ${w.sobreTope} días con más de 2 horas extra en ${mesTexto(mes)}; el tope diario legal es de 2 horas (art. 31).` })
  const orden = { alto: 0, medio: 1, info: 2, bien: 3 }
  return out.sort((x, y) => orden[x.nivel] - orden[y.nivel])
}
