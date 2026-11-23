// src/rrhh/remuneraciones/remDatos.js
// ─────────────────────────────────────────────────────────────────────────────
// Capa de datos única de los reportes de Remuneraciones: el Panel de dotación y
// costo y el Informe mensual leen y calculan aquí, así ambas pantallas muestran
// exactamente las mismas cifras.
//
// Criterios (definidos con JP, nov-2026):
//  · Costo de personal oficial = libro mayor (v_informe_resultado_mensual, el
//    mismo EERR que va al directorio). La nómina entrega el detalle.
//  · Por centro: venta, margen, costo de personal prorrateado, gastos directos y
//    contribución de v_eerr_sucursal (el mismo resultado por sucursal de Finanzas).
//  · El centro de cada mes sale de la liquidación de ese mes (centro_costo_texto
//    → ceco_alias). Un cambio de centro es un TRASLADO, no un ingreso ni una salida.
//  · Dotación = liquidaciones emitidas en el mes. FTE = días trabajados ÷ 30.
//  · Socios (cuenta madre 761) incluidos por defecto. Quien no tiene permiso no
//    los recibe: se excluyen en la consulta, no solo en pantalla.
//  · Todas las lecturas paginan de a 1.000 filas para no depender del límite de
//    filas de la API.
// v2 (nov-2026): filtro global por centro, traslados, matrices cruzadas por
// indicador, ficha por centro y por persona, contribución por centro.
// v3 (nov-2026): gerencia y área del organigrama de Personas como dimensión y filtro;
// cruce de la nómina por gerencia con su línea del EERR (cuenta madre).
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
export const perSiguiente = p => { let y = +p.slice(0, 4), mm = +p.slice(5, 7) + 1; if (mm === 13) { y += 1; mm = 1 } return `${y}-${String(mm).padStart(2, '0')}` }
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
export const ORDEN_PARTIDA = ['sueldo_base', 'gratificacion', 'comision', 'bono', 'hora_extra', 'colacion', 'movilizacion', 'viatico', 'ajuste', 'otros', 'sin_detalle', 'aporte', 'honorario']
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

// ─── Organigrama: gerencia y área ───────────────────────────────────────────
const ORDEN_GERENCIA = ['Comercial', 'Operaciones', 'Adm. y Finanzas', 'Desarrollo de Negocios', 'Dirección', 'Sin gerencia']
const ORDEN_AREA = ['Comercial', 'Marketing', 'Operaciones', 'Finanzas', 'Personas', 'Negocios', 'Gobierno', 'Sin área']
const ordenarCon = orden => s => [...s].sort((a, b) => { const ia = orden.indexOf(a), ib = orden.indexOf(b); return (ia < 0 ? 98 : ia) - (ib < 0 ? 98 : ib) || String(a).localeCompare(String(b)) })
export const ordenGerencias = ordenarCon(ORDEN_GERENCIA)
export const ordenAreas = ordenarCon(ORDEN_AREA)
// Línea del EERR (cuenta madre) que corresponde a cada gerencia.
export const FUNCION_ESPERADA = { Comercial: 'Venta', Operaciones: 'Operación', 'Adm. y Finanzas': 'Administración', 'Desarrollo de Negocios': 'Administración' }
// La línea correcta se decide por área: una bodega de tienda depende de la Gerencia Comercial
// pero es del área Operaciones y va en remuneración de operación.
export const FUNCION_ESPERADA_AREA = { Comercial: 'Venta', Marketing: 'Venta', Operaciones: 'Operación', Finanzas: 'Administración', Personas: 'Administración', Negocios: 'Administración' }
// Último respaldo, si la persona nunca tuvo cargo en el organigrama ni hay otros con su cargo: su cuenta madre.
const AREA_CM = { 600: { area: 'Operaciones', gerencia: 'Operaciones' }, 610: { area: 'Comercial', gerencia: 'Comercial' }, 760: { area: 'Finanzas', gerencia: 'Adm. y Finanzas' }, 761: { area: 'Gobierno', gerencia: 'Dirección' } }
const GERENCIA_LARGA = { Comercial: 'Gerencia Comercial', Operaciones: 'Gerencia de Operaciones', 'Adm. y Finanzas': 'Gerencia de Adm. y Finanzas', 'Desarrollo de Negocios': 'Gerencia de Desarrollo de Negocios' }
export const nombreGerencia = g => GERENCIA_LARGA[g] || g
export const predicadoArea = f => (!f || f === 'todas' ? null : f.startsWith('g:') ? (x => x.gerencia === f.slice(2)) : f.startsWith('a:') ? (x => x.area === f.slice(2)) : null)
export const nombreArea = f => (!f || f === 'todas' ? 'Todas las áreas' : f.startsWith('g:') ? nombreGerencia(f.slice(2)) : `Área ${f.slice(2)}`)
const normNombre = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

function armarOrg(cargos, asigs) {
  const cMap = new Map(cargos.map(c => [Number(c.id), c]))
  const nivel = new Map(), ger = new Map()
  const nivelDe = id => {
    if (nivel.has(id)) return nivel.get(id)
    let n = 0, cur = cMap.get(id), guard = 0
    while (cur && cur.cargo_padre_id != null && guard++ < 30) { n += 1; cur = cMap.get(Number(cur.cargo_padre_id)) }
    nivel.set(id, n); return n
  }
  // Gerencia = ancestro de nivel 2 (hijo del Gerente General). Directorio y gerencia general: Dirección.
  const gerenciaDe = id => {
    if (ger.has(id)) return ger.get(id)
    let cur = cMap.get(id), guard = 0, g = null
    while (cur && guard++ < 30) { if (nivelDe(Number(cur.id)) === 2) { g = cur; break } cur = cur.cargo_padre_id != null ? cMap.get(Number(cur.cargo_padre_id)) : null }
    const nom = g ? (String(g.nombre || '').replace(/^Gerencia\s+(de\s+)?/i, '').trim() || 'Sin gerencia') : 'Dirección'
    ger.set(id, nom); return nom
  }
  const porCod = new Map()
  for (const a of asigs) {
    if (a.cod_contaline == null) continue
    const arr = porCod.get(a.cod_contaline); if (arr) arr.push(a); else porCod.set(a.cod_contaline, [a])
  }
  porCod.forEach(arr => arr.sort((x, y) => String(x.desde || '').localeCompare(String(y.desde || ''))))
  const info = a => { const c = cMap.get(Number(a.cargo_id)); return c ? { area: c.area || 'Sin área', gerencia: gerenciaDe(Number(c.id)), cargoOrg: c.nombre } : null }
  const elegir = l => l.slice().sort((x, y) => (y.es_principal ? 1 : 0) - (x.es_principal ? 1 : 0) || String(y.desde || '').localeCompare(String(x.desde || '')))[0]
  // Asignación vigente en el mes; si no hay, la más cercana (primero la siguiente, luego la última anterior).
  const directa = (cod, p) => {
    const arr = porCod.get(cod)
    if (!arr || !arr.length) return null
    const ini = `${p}-01`, fin = `${p}-31`
    const vig = arr.filter(a => (!a.desde || a.desde <= fin) && (!a.hasta || a.hasta >= ini))
    if (vig.length) { const i = info(elegir(vig)); if (i) return { ...i, metodoArea: 'vigente' } }
    const desp = arr.filter(a => a.desde && a.desde > fin)
    const cand = desp.length ? elegir(desp.filter(a => a.desde === desp[0].desde)) : arr[arr.length - 1]
    const i = cand ? info(cand) : null
    return i ? { ...i, metodoArea: 'cercana' } : null
  }
  return { directa, hay: cargos.length > 0 && asigs.length > 0 }
}

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

  const [liq, lin, apo, hon, libro, clases, alias, cecos, eerr, suc, orgC, orgA] = await Promise.all([
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
      .select('periodo,ceco,ingresos,margen_bruto,remuneraciones,mermas,ajuste_inventario,gastos_directos,contribucion'), ['periodo', 'ceco'])),
    opcional(() => traerTodo(() => supabase.from('org_cargos').select('id,nombre,area,cargo_padre_id,activo'), ['id'])),
    opcional(() => traerTodo(() => supabase.from('org_asignaciones').select('id,cargo_id,cod_contaline,desde,hasta,activo,es_principal'), ['id'])),
  ])
  const hh = { ok: true, data: [], error: null, pendiente: true }
  return { verSocios, emp, liq, lin, apo, hon, libro, clases, alias, cecos, eerr, suc, orgC, orgA, hh, cargadoAt: new Date() }
}

// Workera es la lectura más lenta (≈2,5 s por página en producción): se carga aparte,
// después de mostrar el panel, para no demorar la primera vista.
export async function cargarWorkera() {
  return opcional(() => traerTodo(() => supabase.from('v_asis_costo_hhee')
    .select('periodo,fecha,cod_contaline,empleado,sucursal_nombre,minutos_extra,estado,excede_tope_legal,workshift_name'),
  ['fecha', 'cod_contaline', 'workshift_name', 'minutos_extra', 'estado']))
}

// ─── Agregados ──────────────────────────────────────────────────────────────
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

// Ingresos: en el mes y no en el anterior. Salidas: en el mes y no en el siguiente (último
// mes trabajado). Si la persona sigue en la empresa en el otro mes, es un traslado entre
// grupos. Sin mes siguiente cargado, la salida sale de la fecha de egreso de la ficha.
const SIN = new Set()
function flujosDesde(cods, codsEmp, empMap) {
  const out = new Map()
  cods.forEach((B, p) => {
    const EP = codsEmp.get(perAnterior(p)), EN = codsEmp.get(perSiguiente(p))
    const A = cods.get(perAnterior(p)) || SIN, N = cods.get(perSiguiente(p)) || SIN
    const ingresos = EP ? [...B].filter(c => !A.has(c)) : null
    const salidas = EN ? [...B].filter(c => !N.has(c)) : [...B].filter(c => String(empMap.get(c)?.fecha_egreso || '').slice(0, 7) === p)
    out.set(p, {
      ingresos, salidas, salidasFicha: !EN,
      ingTraslado: ingresos ? ingresos.filter(c => EP.has(c)) : null,
      salTraslado: EN ? salidas.filter(c => EN.has(c)) : [],
    })
  })
  return out
}
function flujosPorClave(regs, codsEmp, empMap, claveFn) {
  const porClave = new Map()
  for (const r of regs) {
    if (r.tipo !== 'liq') continue
    const k = claveFn(r)
    let mm = porClave.get(k); if (!mm) { mm = new Map(); porClave.set(k, mm) }
    let s = mm.get(r.periodo); if (!s) { s = new Set(); mm.set(r.periodo, s) }
    s.add(r.cod)
  }
  const out = new Map()
  porClave.forEach((mm, k) => out.set(k, flujosDesde(mm, codsEmp, empMap)))
  return out
}

function agregar(regs) {
  const tot = new Map(), centro = new Map(), funcion = new Map(), area = new Map(), gerencia = new Map()
  const tomar = (mapa, p) => { let a = mapa.get(p); if (!a) { a = aggVacio(); mapa.set(p, a) } return a }
  const tomarSub = (mapa, p, k) => { let mm = mapa.get(p); if (!mm) { mm = new Map(); mapa.set(p, mm) } let a = mm.get(k); if (!a) { a = aggVacio(); mm.set(k, a) } return a }
  for (const r of regs) {
    sumarReg(tomar(tot, r.periodo), r); sumarReg(tomarSub(centro, r.periodo, r.ceco), r); sumarReg(tomarSub(funcion, r.periodo, r.funcion), r)
    sumarReg(tomarSub(area, r.periodo, r.area || 'Sin área'), r); sumarReg(tomarSub(gerencia, r.periodo, r.gerencia || 'Sin gerencia'), r)
  }
  return { tot, centro, funcion, area, gerencia, periodos: [...tot.keys()].sort() }
}
const posC = c => { const i = ORDEN_CENTRO.indexOf(c); return i < 0 ? 99 : i }
const ordenCentros = arr => [...arr].sort((a, b) => posC(a) - posC(b) || String(a).localeCompare(String(b)))
const posF = f => { const i = ORDEN_FUNCION.indexOf(f); return i < 0 ? 99 : i }

// ─── Modelo base (empresa completa) ─────────────────────────────────────────
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
  const linea = (r, extra) => lineas.push({ periodo: r.periodo, cod: r.cod, trabajador: r.nombre, cargo: r.cargo, ceco: r.ceco, funcion: r.funcion, area: r.area, gerencia: r.gerencia, tipoHhee: null, ...extra })
  // Gerencia y área: organigrama (cargo vigente en el mes o asignación más cercana); si la
  // persona nunca tuvo cargo, el área más frecuente de su cargo de liquidación; si no, su cuenta madre.
  const org = armarOrg(raw.orgC?.data || [], raw.orgA?.data || [])
  const porCargo = new Map()
  for (const q of raw.liq || []) {
    const a = org.directa(q.cod_contaline, q.periodo); if (!a) continue
    const k = String(q.cargo || '').trim(), kk = `${a.area}|${a.gerencia}`
    let mm = porCargo.get(k); if (!mm) { mm = new Map(); porCargo.set(k, mm) }
    mm.set(kk, (mm.get(kk) || 0) + 1)
  }
  const areaDe = (cod, periodo, cargoTxt, cm) => {
    const a = cod != null ? org.directa(cod, periodo) : null
    if (a) return { area: a.area, gerencia: a.gerencia, metodoArea: a.metodoArea }
    const mm = porCargo.get(String(cargoTxt || '').trim())
    if (mm && mm.size) { const [kk] = [...mm.entries()].sort((x, y) => y[1] - x[1])[0]; const [area, gerencia] = kk.split('|'); return { area, gerencia, metodoArea: 'cargo' } }
    const d = AREA_CM[cm] || { area: 'Sin área', gerencia: 'Sin gerencia' }
    return { area: d.area, gerencia: d.gerencia, metodoArea: 'cuenta' }
  }
  const codPorNombre = new Map((raw.emp || []).map(e => [normNombre(e.nombre), e.cod_contaline]))

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
      funcion: FUNCIONES[cm] || 'Sin función', socio: cm === '761', ...areaDe(q.cod_contaline, q.periodo, q.cargo || e?.cargo, cm),
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
      funcion: FUNCIONES[cm] || 'Sin función', socio: cm === '761', ...areaDe(codPorNombre.get(normNombre(h.trabajador)) ?? null, h.periodo, h.cargo, cm), dias: 0, fte: 0, haberes: 0, aportes: 0, honorario: mto, costo: mto,
      sueldoBase: 0, descLegal: 0, descInterno: 0, hhee: {}, hheeTotal: 0, partidas: { honorario: mto }, sinLineas: false, fechaIngreso: null,
    }
    regs.push(r)
    linea(r, { glosa: h.glosa_nombre || 'Boleta de honorarios', naturaleza: 'honorario', partida: 'honorario', monto: mto })
  }

  const ag = agregar(regs)
  const regPC = new Map(regs.filter(r => r.tipo === 'liq').map(r => [`${r.periodo}|${r.cod}`, r]))
  const codsEmpresa = new Map(ag.periodos.map(p => [p, ag.tot.get(p).cods]))
  const flujos = flujosDesde(codsEmpresa, codsEmpresa, empMap)

  const eerr = new Map()
  for (const x of raw.eerr?.data || []) {
    eerr.set(x.periodo, { venta: num(x.venta), costoVenta: num(x.costo), mb: num(x.margen_bruto), cp: num(x.remuneraciones), ebitda: num(x.ebitda), resultado: num(x.resultado), contrib: null, enCurso: !!x.mes_en_curso })
  }
  const suc = new Map()
  for (const x of raw.suc?.data || []) {
    if (!x.ceco || x.ceco === 'suc-ajuste-jun') continue
    let mm = suc.get(x.periodo); if (!mm) { mm = new Map(); suc.set(x.periodo, mm) }
    mm.set(x.ceco, { ingresos: num(x.ingresos), mb: num(x.margen_bruto), rem: num(x.remuneraciones), mermas: num(x.mermas) + num(x.ajuste_inventario), gastos: num(x.gastos_directos), contrib: num(x.contribucion) })
  }
  // El margen por centro debe cuadrar con el libro mayor (tolerancia 2%). Si no cuadra
  // (p. ej. costo de venta por centro aún no cargado, oct-2026), margen y contribución por
  // centro de ese mes quedan sin dato en vez de mostrar un 100% de margen.
  calidad.ventaSinCentro = new Map(); calidad.margenSinCuadre = new Map()
  suc.forEach((mm, p) => {
    let ing = 0, mb = 0, con = 0
    mm.forEach(v => { ing += v.ingresos; mb += v.mb; con += v.contrib })
    const e = eerr.get(p)
    const okMb = !!e && !e.enCurso && e.mb !== 0 && Math.abs(mb - e.mb) / Math.abs(e.mb) <= 0.02
    if (!okMb) { mm.forEach(v => { v.mb = null; v.contrib = null }); if (e && !e.enCurso) calidad.margenSinCuadre.set(p, { centros: mb, oficial: e.mb }) }
    if (e) { e.contrib = okMb ? con : null; if (!e.enCurso && e.venta > 0 && Math.abs(e.venta - ing) / e.venta > 0.01) calidad.ventaSinCentro.set(p, { oficial: e.venta, centros: ing }) }
  })
  const APORTES_LIBRO = ['aporte_mutual', 'aporte_cesantia', 'aporte_sis', 'aporte_capitalizacion', 'aporte_expectativa_vida', 'aporte_rentabilidad_protegida']
  const libro = new Map()
  for (const x of raw.libro?.data || []) libro.set(x.periodo, { aportes: APORTES_LIBRO.reduce((s, k) => s + num(x[k]), 0), haberes: num(x.total_haberes), n: num(x.n_empleados) })

  const setC = new Set()
  ag.centro.forEach(mm => mm.forEach((_, k) => setC.add(k)))
  suc.forEach(mm => mm.forEach((v, k) => { if (v.ingresos || v.rem) setC.add(k) }))
  const centros = ordenCentros(setC)
  const setF = new Set(); ag.funcion.forEach(mm => mm.forEach((_, k) => setF.add(k)))
  const funciones = [...setF].sort((a, b) => posF(a) - posF(b))

  // Workera: cada persona-mes va al centro de su liquidación del mismo mes; si aún no
  // hay liquidación (mes en curso), al último centro conocido.
  const ultimoCentro = new Map()
  for (const r of regs) if (r.tipo === 'liq') { const u = ultimoCentro.get(r.cod); if (!u || r.periodo >= u.p) ultimoCentro.set(r.cod, { p: r.periodo, c: r.ceco }) }
  const hh = (raw.hh?.data || []).map(x => ({
    periodo: x.periodo, cod: x.cod_contaline, nombre: x.empleado, sucursal: x.sucursal_nombre || 'Sin sucursal', min: num(x.minutos_extra),
    estado: x.estado || 'pendiente', sobreTope: !!x.excede_tope_legal,
    ceco: regPC.get(`${x.periodo}|${x.cod_contaline}`)?.ceco || ultimoCentro.get(x.cod_contaline)?.c || null,
  }))

  const FUENTES = { apo: 'aportes patronales', hon: 'honorarios', libro: 'libro de remuneraciones', clases: 'clases de horas extra', alias: 'centros de costo', cecos: 'centros', eerr: 'libro mayor (venta y costo oficial)', suc: 'resultado por centro', hh: 'horas de Workera', orgC: 'organigrama (cargos)', orgA: 'organigrama (asignaciones)' }
  calidad.errores = Object.keys(FUENTES).filter(k => raw[k]?.ok === false && raw[k]?.error).map(k => ({ fuente: FUENTES[k], error: raw[k].error }))
  calidad.aportesReales = conSocios ? ag.periodos.filter(p => libro.has(p)) : []
  calidad.workeraDesde = hh.length ? hh.reduce((mn, x) => (x.periodo < mn ? x.periodo : mn), hh[0].periodo) : null
  calidad.workeraPendiente = !!raw.hh?.pendiente

  const base = {
    verSocios: !!raw.verSocios, conSocios, filtrado: false, filtroNombre: 'Todos los centros', regs, lineas,
    tot: ag.tot, centro: ag.centro, funcion: ag.funcion, periodos: ag.periodos, flujos, eerr, suc, libro, hh, centros, funciones,
    regPC, regPCEmpresa: regPC, codsEmpresa, totEmpresa: ag.tot, eerrEmpresa: eerr, empMap, nombreCentro, calidad,
    cargadoAt: raw.cargadoAt || null, _vacio: aggVacio(),
  }
  base.flCentro = flujosPorClave(regs, codsEmpresa, empMap, r => r.ceco)
  base.flFuncion = flujosPorClave(regs, codsEmpresa, empMap, r => r.funcion)
  base.centrosTodos = centros
  base.area = ag.area; base.gerencia = ag.gerencia
  const listar = (mapa, orden) => { const s = new Set(); mapa.forEach(mm => mm.forEach((_, k) => s.add(k))); return orden(s) }
  base.areas = listar(ag.area, ordenAreas); base.gerencias = listar(ag.gerencia, ordenGerencias)
  base.flArea = flujosPorClave(regs, codsEmpresa, empMap, r => r.area)
  base.flGerencia = flujosPorClave(regs, codsEmpresa, empMap, r => r.gerencia)
  base.porArea = false; base.fuenteCosto = 'libro'; base.filtro = 'todos'; base.filtroArea = 'todas'
  base.orgDisponible = org.hay
  calidad.metodoArea = regs.reduce((t, r) => { t[r.metodoArea] = (t[r.metodoArea] || 0) + r.costo; return t }, {})
  return base
}

// ─── Filtro por centro: mismo modelo, solo los centros elegidos ─────────────
// La venta, el margen y el costo oficial pasan a ser los del resultado por centro.
export function centrosDeFiltro(base, filtro) {
  if (!filtro || filtro === 'todos') return null
  if (filtro === 'tiendas') return base.centros.filter(c => !esApoyo(c))
  if (filtro === 'apoyo') return base.centros.filter(c => esApoyo(c))
  return [filtro]
}
export function nombreFiltro(base, filtro) {
  if (!filtro || filtro === 'todos') return 'Todos los centros'
  if (filtro === 'tiendas') return 'Tiendas'
  if (filtro === 'apoyo') return 'CD y administración central'
  return base.nombreCentro(filtro)
}
// Filtros globales: centro y/o gerencia o área. Con filtro de área, el costo es la nómina del
// área (el libro mayor no reparte por área) y la venta del alcance queda como referencia.
export function filtrarModelo(base, filtro, filtroArea) {
  const lista = centrosDeFiltro(base, filtro)
  const predA = predicadoArea(filtroArea)
  if (!lista && !predA) return base
  const sel = lista ? new Set(lista) : null
  const enAlcance = r => (!sel || sel.has(r.ceco)) && (!predA || predA(r))
  const regs = base.regs.filter(enAlcance)
  const ag = agregar(regs)
  const cods = new Map(ag.periodos.map(p => [p, ag.tot.get(p).cods]))
  const porArea = !!predA
  const suc = new Map()
  base.suc.forEach((mm, p) => {
    const f = new Map()
    mm.forEach((v, c) => {
      if (sel && !sel.has(c)) return
      f.set(c, porArea ? { ingresos: v.ingresos, rem: costoNomina(ag.centro.get(p)?.get(c) || aggVacio()), mb: null, contrib: null, gastos: null, mermas: null } : v)
    })
    suc.set(p, f)
  })
  const eerr = new Map()
  new Set([...base.eerrEmpresa.keys(), ...suc.keys()]).forEach(p => {
    const mm = suc.get(p), eb = base.eerrEmpresa.get(p)
    if (porArea) {
      const venta = sel ? (mm && mm.size ? [...mm.values()].reduce((t, v) => t + v.ingresos, 0) : null) : (eb ? eb.venta : null)
      if (venta == null && !ag.tot.has(p)) return
      eerr.set(p, { venta, mb: null, cp: costoNomina(ag.tot.get(p) || aggVacio()), contrib: null, gastos: null, mermas: null, costoVenta: null, ebitda: null, resultado: null, enCurso: !!eb?.enCurso, porArea: true })
      return
    }
    if (!mm || !mm.size) return
    const t = { venta: 0, mb: 0, cp: 0, contrib: 0, gastos: 0, mermas: 0 }
    let na = false
    mm.forEach(v => { t.venta += v.ingresos; t.cp += v.rem; t.gastos += v.gastos; t.mermas += v.mermas; if (esNum(v.mb)) { t.mb += v.mb; t.contrib += v.contrib } else na = true })
    if (na) { t.mb = null; t.contrib = null }
    eerr.set(p, { ...t, costoVenta: t.mb == null ? null : t.venta - t.mb, ebitda: null, resultado: null, enCurso: !!eb?.enCurso, porCentro: true })
  })
  const listar = (mapa, orden) => { const s = new Set(); mapa.forEach(mm => mm.forEach((_, k) => s.add(k))); return orden(s) }
  const nombre = [predA ? nombreArea(filtroArea) : null, sel ? nombreFiltro(base, filtro) : null].filter(Boolean).join(' · ')
  const m = {
    ...base, filtrado: true, porArea, filtro: filtro || 'todos', filtroArea: filtroArea || 'todas', filtroNombre: nombre, regs,
    fuenteCosto: porArea ? 'nomina' : 'prorrateado',
    lineas: base.lineas.filter(enAlcance),
    hh: base.hh.filter(x => { if (!x.ceco || (sel && !sel.has(x.ceco))) return false; if (!predA) return true; const r = base.regPCEmpresa.get(`${x.periodo}|${x.cod}`); return r ? predA(r) : false }),
    tot: ag.tot, centro: ag.centro, funcion: ag.funcion, area: ag.area, gerencia: ag.gerencia, periodos: ag.periodos,
    flujos: flujosDesde(cods, base.codsEmpresa, base.empMap), eerr, suc, libro: new Map(),
    centros: base.centros.filter(c => (!sel || sel.has(c)) && (!porArea || ag.periodos.some(p => ag.centro.get(p)?.has(c)))),
    funciones: listar(ag.funcion, s => [...s].sort((a, b) => posF(a) - posF(b))),
    areas: listar(ag.area, ordenAreas), gerencias: listar(ag.gerencia, ordenGerencias),
    regPC: new Map(regs.filter(r => r.tipo === 'liq').map(r => [`${r.periodo}|${r.cod}`, r])),
    _vacio: aggVacio(),
  }
  m.flCentro = flujosPorClave(regs, base.codsEmpresa, base.empMap, r => r.ceco)
  m.flFuncion = flujosPorClave(regs, base.codsEmpresa, base.empMap, r => r.funcion)
  m.flArea = flujosPorClave(regs, base.codsEmpresa, base.empMap, r => r.area)
  m.flGerencia = flujosPorClave(regs, base.codsEmpresa, base.empMap, r => r.gerencia)
  return m
}

// ─── Accesos ────────────────────────────────────────────────────────────────
export const agg = (m, p) => (p && m.tot.get(p)) || m._vacio
export const aggCentro = (m, p, c) => (p && m.centro.get(p)?.get(c)) || m._vacio
export const aggFuncion = (m, p, f) => (p && m.funcion.get(p)?.get(f)) || m._vacio
export const aggArea = (m, p, k) => (p && m.area?.get(p)?.get(k)) || m._vacio
export const aggGerencia = (m, p, k) => (p && m.gerencia?.get(p)?.get(k)) || m._vacio
export const mesesNomina = (m, anio) => m.periodos.filter(p => p.startsWith(String(anio)))
export const costoNomina = a => a.haberes + a.aportes + a.honorario
export const costoPorFte = a => div(a.haberes + a.aportes, a.fte)
export function mm3(arr) {
  return arr.map((v, i) => { const w = arr.slice(Math.max(0, i - 2), i + 1).filter(esNum); return i >= 2 && w.length === 3 ? (w[0] + w[1] + w[2]) / 3 : null })
}
// Pendiente de mínimos cuadrados expresada como % del promedio por mes.
export function tendencia(vals) {
  const pts = vals.map((v, i) => [i, v]).filter(([, v]) => esNum(v))
  if (pts.length < 3) return null
  const n = pts.length, sx = pts.reduce((t, [x]) => t + x, 0), sy = pts.reduce((t, [, y]) => t + y, 0)
  const sxx = pts.reduce((t, [x]) => t + x * x, 0), sxy = pts.reduce((t, [x, y]) => t + x * y, 0)
  const den = n * sxx - sx * sx
  if (!den) return null
  const pend = (n * sxy - sx * sy) / den, prom = sy / n
  return prom ? pend / Math.abs(prom) : null
}
export function periodoBase(m, anio, mes, base) {
  if (!mes) return null
  if (base === 'anterior') { const p = perAnterior(mes); return m.tot.has(p) ? p : null }
  if (base === 'anio_ant') { const p = perAnioAnterior(mes); return m.tot.has(p) || m.eerr.has(p) ? p : null }
  const ps = mesesNomina(m, anio)
  return ps[0] && ps[0] !== mes ? ps[0] : null
}

// Movimientos de un conjunto de meses. Por centro o función usa los flujos del grupo
// (con traslados); para el alcance completo, los del alcance.
export function movimientos(m, ps, claveReg) {
  const porGrupo = new Map()
  const tomar = k => { let x = porGrupo.get(k); if (!x) { x = { ing: 0, sal: 0, ingT: 0, salT: 0 }; porGrupo.set(k, x) } return x }
  let ing = 0, sal = 0, ingT = 0, salT = 0, salFicha = 0
  for (const p of ps) {
    const f = m.flujos.get(p); if (!f) continue
    ing += (f.ingresos || []).length; ingT += (f.ingTraslado || []).length
    sal += (f.salidas || []).length; salT += (f.salTraslado || []).length
    if (f.salidasFicha) salFicha += (f.salidas || []).length
  }
  const fuente = claveReg === 'centro' ? m.flCentro : claveReg === 'funcion' ? m.flFuncion : claveReg === 'area' ? m.flArea : claveReg === 'gerencia' ? m.flGerencia : null
  if (fuente) {
    fuente.forEach((porMes, k) => {
      for (const p of ps) {
        const f = porMes.get(p); if (!f) continue
        const x = tomar(k)
        x.ing += (f.ingresos || []).length; x.ingT += (f.ingTraslado || []).length
        x.sal += (f.salidas || []).length; x.salT += (f.salTraslado || []).length
      }
    })
  }
  return { porGrupo, ing, sal, ingT, salT, salFicha }
}

// ─── Serie mensual (libro mayor o resultado por centro + nómina) ────────────
export function filasMensuales(m, anio) {
  const meses = [...new Set([...mesesNomina(m, anio), ...[...m.eerr.keys()].filter(p => p.startsWith(String(anio)))])].sort()
  const rows = meses.map(p => {
    const e = m.eerr.get(p), a = agg(m, p), tieneN = m.tot.has(p)
    const valido = !!e && !e.enCurso
    return {
      p, enCurso: !!e?.enCurso, sinNomina: !tieneN, sinEerr: !e,
      venta: e ? e.venta : null, mb: e ? e.mb : null, cp: e ? e.cp : null, ebitda: e ? e.ebitda : null, contrib: e ? e.contrib : null,
      pct: valido ? div(e.cp, e.venta) : null, veces: valido ? div(e.venta, e.cp) : null,
      gmrol: valido && esNum(e.mb) ? div(e.mb, e.cp) : null, roi: valido && esNum(e.mb) ? div(e.mb - e.cp, e.cp) : null,
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
  const venta = s(cerr, 'venta'), cp = s(cerr, 'cp'), cMb = cerr.filter(r => esNum(r.mb)), mb = cMb.length ? s(cMb, 'mb') : null, cpMb = s(cMb, 'cp')
  const fte = s(nom, 'fte'), sb = s(nom, 'sb'), hhee = s(nom, 'hhee')
  return {
    meses: cerr.length, mesesNomina: nom.length, venta, mb, cp,
    ebitda: cerr.some(r => r.ebitda != null) ? s(cerr, 'ebitda') : null, contrib: cerr.some(r => r.contrib != null) ? s(cerr, 'contrib') : null,
    pct: div(cp, venta), veces: div(venta, cp), gmrol: div(mb, cpMb), roi: mb == null ? null : div(mb - cpMb, cpMb), mbParcial: cMb.length < cerr.length,
    hhee, sb, hheePctSB: div(hhee, sb), costoNomina: s(nom, 'costoNomina'), costoFte: div(s(nom, 'costoBase'), fte),
    ventaFte: div(s(ambos, 'venta'), s(ambos, 'fte')),
    ftePromedio: nom.length ? fte / nom.length : null, dotPromedio: nom.length ? s(nom, 'dot') / nom.length : null,
  }
}
export function retornoIncremental(m, pA, pB) {
  const a = m.eerr.get(pA), b = m.eerr.get(pB)
  if (!a || !b || a.enCurso || b.enCurso || pA === pB || !esNum(a.mb) || !esNum(b.mb)) return null
  const dVenta = b.venta - a.venta, dMb = b.mb - a.mb, dCp = b.cp - a.cp
  return { pA, pB, dVenta, dMb, dCp, retorno: dCp !== 0 ? dMb / dCp : null }
}
const sumSuc = (m, c, ps) => {
  const t = ps.reduce((acc, p) => {
    const s = m.suc.get(p)?.get(c)
    if (s) { acc.venta += s.ingresos; acc.rem += s.rem; acc.gastos += s.gastos; acc.mermas += s.mermas; acc.n += 1; if (esNum(s.mb)) { acc.mb += s.mb; acc.contrib += s.contrib } else acc.na = true }
    return acc
  }, { venta: 0, mb: 0, rem: 0, gastos: 0, mermas: 0, contrib: 0, n: 0, na: false })
  if (t.na) { t.mb = null; t.contrib = null }
  return t
}

// Por centro (usado por el Informe): venta, margen y costo oficial prorrateado + nómina.
export function filasCentros(m, periodos) {
  const n = periodos.length
  return m.centros.map(c => {
    const x = sumSuc(m, c, periodos)
    let fteMeses = 0, costoN = 0, hhee = 0
    for (const p of periodos) { const a = aggCentro(m, p, c); fteMeses += a.fte; costoN += costoNomina(a); hhee += a.hhee }
    const apoyo = esApoyo(c) || x.venta <= 0
    const sinPersonal = x.rem <= 0 && fteMeses <= 0
    const mide = !apoyo && !sinPersonal
    return {
      c, nombre: m.nombreCentro(c), apoyo, sinPersonal, ingresos: x.venta, mb: x.mb, rem: x.rem, gastos: x.gastos, contrib: x.contrib, fteMeses, fte: n ? fteMeses / n : 0,
      dot: aggCentro(m, periodos[periodos.length - 1], c).dot, costoNomina: costoN, hhee,
      pct: mide ? div(x.rem, x.venta) : null, gmrol: mide && esNum(x.mb) ? div(x.mb, x.rem) : null, roi: mide && esNum(x.mb) ? div(x.mb - x.rem, x.rem) : null,
      ventaFte: mide ? div(x.venta, fteMeses) : null, costoFte: div(x.rem, fteMeses), contribPct: mide ? div(x.contrib, x.venta) : null,
    }
  }).filter(f => f.ingresos || f.rem || f.fteMeses)
}

// ─── Indicadores para matrices cruzadas ─────────────────────────────────────
// anual: 'suma' (se suma), 'prom' (promedio mensual) o 'ratio' (se recalcula con los
// componentes del año). s: +1 si subir es malo, −1 si bajar es malo, 0 neutro.
// soloCentro: necesita la venta del centro (no existe por función, cargo o persona).
export const INDICADORES = [
  { g: 'Dotación', k: 'dot', l: 'Dotación (liquidaciones)', f: 'n0', anual: 'prom', s: 0, v: a => a.dot },
  { g: 'Dotación', k: 'fte', l: 'FTE', f: 'n1', anual: 'prom', s: 0, v: a => a.fte },
  { g: 'Dotación', k: 'jornada', l: '% de jornada completa', f: 'p0', anual: 'ratio', s: -1, v: a => div(a.fte, a.dot) },
  { g: 'Dotación', k: 'ing', l: 'Ingresos (incluye traslados)', f: 'n0', anual: 'suma', s: 0, v: (a, x) => x.ing },
  { g: 'Dotación', k: 'sal', l: 'Salidas (incluye traslados)', f: 'n0', anual: 'suma', s: 1, v: (a, x) => x.sal },
  { g: 'Nómina', k: 'costo', l: 'Costo de nómina', f: 'm', anual: 'suma', s: 1, v: a => costoNomina(a) },
  { g: 'Nómina', k: 'haberes', l: 'Haberes', f: 'm', anual: 'suma', s: 1, v: a => a.haberes },
  { g: 'Nómina', k: 'sb', l: 'Sueldo base', f: 'm', anual: 'suma', s: 1, v: a => a.sueldoBase },
  { g: 'Nómina', k: 'comision', l: 'Comisiones', f: 'm', anual: 'suma', s: 0, v: a => a.partidas.comision || 0 },
  { g: 'Nómina', k: 'bono', l: 'Bonos', f: 'm', anual: 'suma', s: 1, v: a => a.partidas.bono || 0 },
  { g: 'Nómina', k: 'variable', l: '% variable de los haberes', f: 'p1', anual: 'ratio', s: 0, v: a => div(a.clases.variable || 0, a.haberes) },
  { g: 'Nómina', k: 'costoFte', l: 'Nómina por FTE', f: 'pesos', anual: 'ratio', s: 1, v: a => costoPorFte(a) },
  { g: 'Nómina', k: 'costoPers', l: 'Costo medio por persona', f: 'pesos', anual: 'ratio', s: 1, v: a => div(a.haberes + a.aportes, a.dot) },
  { g: 'Nómina', k: 'sbFte', l: 'Sueldo base por FTE', f: 'pesos', anual: 'ratio', s: 1, v: a => div(a.sueldoBase, a.fte) },
  { g: 'Horas extra', k: 'hhee', l: 'Horas extra', f: 'm', anual: 'suma', s: 1, v: a => a.hhee },
  { g: 'Horas extra', k: 'hheeSB', l: 'Horas extra sobre sueldo base', f: 'p1', anual: 'ratio', s: 1, v: a => div(a.hhee, a.sueldoBase) },
  { g: 'Horas extra', k: 'hheeFte', l: 'Horas extra por FTE', f: 'pesos', anual: 'ratio', s: 1, v: a => div(a.hhee, a.fte) },
  { g: 'Horas extra', k: 'conHhee', l: '% de personas con horas extra', f: 'p0', anual: 'ratio', s: 1, v: a => div(a.conHhee, a.dot) },
  { g: 'Horas extra', k: 'especial', l: 'Horas extra especiales (3ª hora en adelante)', f: 'm', anual: 'suma', s: 1, v: a => a.hheeTipo.especial || 0 },
  { g: 'Horas extra', k: 'feriado', l: 'Feriados trabajados', f: 'm', anual: 'suma', s: 0, v: a => a.hheeTipo.feriado || 0 },
  { g: 'Horas extra', k: 'rezagadas', l: 'Horas extra rezagadas del mes anterior', f: 'm', anual: 'suma', s: 1, v: a => a.hheeTipo.mes_anterior || 0 },
  { g: 'Venta y resultado', k: 'venta', l: 'Venta neta', f: 'm', anual: 'suma', s: -1, soloCentro: true, v: (a, x) => x.venta },
  { g: 'Venta y resultado', k: 'rem', l: 'Costo de personal oficial (prorrateado)', f: 'm', anual: 'suma', s: 1, soloCentro: true, v: (a, x) => x.rem },
  { g: 'Venta y resultado', k: 'pctVenta', l: 'Costo de personal sobre venta', f: 'p1', anual: 'ratio', s: 1, soloCentro: true, v: (a, x) => (x.venta > 0 && x.rem > 0 ? x.rem / x.venta : null) },
  { g: 'Venta y resultado', k: 'ventaFte', l: 'Venta por FTE', f: 'm', anual: 'ratio', s: -1, soloCentro: true, v: (a, x) => (x.venta > 0 ? div(x.venta, a.fte) : null) },
  { g: 'Venta y resultado', k: 'gmrol', l: 'Margen bruto por $1 de personal', f: 'x2', anual: 'ratio', s: -1, soloCentro: true, v: (a, x) => (x.venta > 0 ? div(x.mb, x.rem) : null) },
  { g: 'Venta y resultado', k: 'roi', l: 'ROI de personal', f: 'p0', anual: 'ratio', s: -1, soloCentro: true, v: (a, x) => (x.venta > 0 && esNum(x.mb) ? div(x.mb - x.rem, x.rem) : null) },
  { g: 'Venta y resultado', k: 'gastos', l: 'Gastos directos del centro', f: 'm', anual: 'suma', s: 1, soloCentro: true, v: (a, x) => x.gastos },
  { g: 'Venta y resultado', k: 'contrib', l: 'Contribución del centro', f: 'm', anual: 'suma', s: -1, soloCentro: true, v: (a, x) => x.contrib },
  { g: 'Venta y resultado', k: 'contribPct', l: 'Contribución sobre venta', f: 'p1', anual: 'ratio', s: -1, soloCentro: true, v: (a, x) => (x.venta > 0 ? div(x.contrib, x.venta) : null) },
  { g: 'Venta y resultado', k: 'pctVentaTot', l: 'Costo de nómina sobre la venta total', f: 'p1', anual: 'ratio', s: 1, v: (a, x) => (x.ventaTot > 0 ? costoNomina(a) / x.ventaTot : null) },
  { g: 'Nómina', k: 'pctCosto', l: 'Participación en el costo de nómina', f: 'p1', anual: 'ratio', s: 0, v: (a, x) => div(costoNomina(a), x.costoTot) },
]
const FMT = { n0: v => fN(v), n1: v => fN(v, 1), m: fM, p0: v => fP(v, 0), p1: v => fP(v), pesos: fmt, x2: v => (esNum(v) ? `$${NF[2].format(v)}` : '—') }
export const formatoDe = ind => FMT[ind.f] || fN
export const esPct = ind => ind.f === 'p0' || ind.f === 'p1'
export const DIMS_MATRIZ = [['gerencia', 'Gerencia'], ['area', 'Área'], ['centro', 'Centro'], ['gerenciaCentro', 'Gerencia y centro'], ['funcion', 'Función (cuenta madre)'], ['centroFuncion', 'Centro y función'], ['cargo', 'Cargo'], ['persona', 'Persona']]
const CLAVE_DIM = {
  centro: r => r.ceco, funcion: r => r.funcion, centroFuncion: r => `${r.ceco}|${r.funcion}`, cargo: r => r.cargo,
  gerencia: r => r.gerencia || 'Sin gerencia', area: r => r.area || 'Sin área', gerenciaCentro: r => `${r.gerencia || 'Sin gerencia'}|${r.ceco}`,
  persona: r => (r.tipo === 'liq' ? `p${r.cod}` : `h${r.nombre}`),
}
const ctxVacio = () => ({ venta: null, mb: null, rem: null, gastos: null, contrib: null, ing: null, sal: null, ventaTot: null, costoTot: null })
function ctxSuma(lista) {
  const t = { venta: 0, mb: 0, rem: 0, gastos: 0, contrib: 0, ing: 0, sal: 0, ventaTot: 0, costoTot: 0 }, hay = {}, falta = {}
  for (const x of lista) for (const k in t) { if (esNum(x[k])) { t[k] += x[k]; hay[k] = true } else falta[k] = true }
  // Un año con algún mes sin margen por centro no tiene margen anual comparable.
  for (const k in t) if (!hay[k] || ((k === 'mb' || k === 'contrib') && falta[k])) t[k] = null
  return t
}
// Valores mensuales y anual de un indicador para un grupo.
function serieInd(ind, meses, aggDe, ctxDe) {
  const vals = meses.map(p => { const a = aggDe(p), x = ctxDe(p); return a || esNum(x.venta) ? ind.v(a || aggVacio(), x) : null })
  let anual = null
  const presentes = meses.filter(p => aggDe(p) || esNum(ctxDe(p).venta))
  if (ind.anual === 'suma') { const v = vals.filter(esNum); anual = v.length ? v.reduce((t, x) => t + x, 0) : null }
  else if (ind.anual === 'prom') { const v = vals.filter(esNum); anual = v.length ? v.reduce((t, x) => t + x, 0) / v.length : null }
  else if (presentes.length) anual = ind.v(combinar(presentes.map(p => aggDe(p) || aggVacio())), ctxSuma(presentes.map(ctxDe)))
  return { vals, anual }
}

// Matriz indicador × (centro | función | centro y función | cargo | persona) × mes.
export function matrizIndicador(m, anio, dim, indK) {
  const ind = INDICADORES.find(i => i.k === indK) || INDICADORES[0]
  const meses = mesesNomina(m, anio)
  const kf = CLAVE_DIM[dim] || CLAVE_DIM.centro
  const grupos = new Map()
  for (const r of m.regs) {
    if (!r.periodo.startsWith(String(anio))) continue
    const k = kf(r)
    let g = grupos.get(k)
    if (!g) { g = { k, aggs: new Map(), info: null }; grupos.set(k, g) }
    let a = g.aggs.get(r.periodo); if (!a) { a = aggVacio(); g.aggs.set(r.periodo, a) }
    sumarReg(a, r)
    if (!g.info || r.periodo >= g.info.periodo) g.info = { periodo: r.periodo, nombre: r.nombre, cargo: r.cargo, ceco: r.ceco, funcion: r.funcion, cod: r.cod, area: r.area, gerencia: r.gerencia }
  }
  if (dim === 'centro') m.centros.forEach(c => { if (!grupos.has(c) && meses.some(p => m.suc.get(p)?.get(c)?.ingresos)) grupos.set(c, { k: c, aggs: new Map(), info: null }) })
  const fl = dim === 'persona' ? null : flujosPorClave(m.regs, m.codsEmpresa, m.empMap, kf)
  const ctxDe = k => p => {
    const x = ctxVacio()
    const f = fl?.get(k)?.get(p)
    if (f) { x.ing = f.ingresos ? f.ingresos.length : null; x.sal = f.salidas ? f.salidas.length : null }
    if (dim === 'centro') { const s = m.suc.get(p)?.get(k); if (s) { x.venta = s.ingresos; x.mb = s.mb; x.rem = s.rem; x.gastos = s.gastos; x.contrib = s.contrib } }
    x.ventaTot = m.eerr.get(p)?.venta ?? null; x.costoTot = m.tot.has(p) ? costoNomina(m.tot.get(p)) : null
    return x
  }
  const nombreDe = g => {
    if (dim === 'centro') return m.nombreCentro(g.k)
    if (dim === 'centroFuncion') { const [c, f] = String(g.k).split('|'); return `${m.nombreCentro(c)} · ${f}` }
    if (dim === 'gerenciaCentro') { const [ge, c] = String(g.k).split('|'); return `${ge} · ${m.nombreCentro(c)}` }
    if (dim === 'persona') return g.info?.nombre || String(g.k)
    return g.k
  }
  const filas = [...grupos.values()].map(g => {
    const { vals, anual } = serieInd(ind, meses, p => g.aggs.get(p) || null, ctxDe(g.k))
    const nums = vals.filter(esNum)
    const prom = nums.length ? nums.reduce((t, x) => t + x, 0) / nums.length : null
    const o = { _k: g.k, k: g.k, nombre: nombreDe(g), anio: anual, serie: vals, prom, primero: nums[0] ?? null, tend: tendencia(vals) }
    meses.forEach((p, i) => { o[p] = vals[i] })
    if (dim === 'persona' && g.info) Object.assign(o, { cod: g.info.cod, cargo: g.info.cargo, centro: m.nombreCentro(g.info.ceco), funcion: g.info.funcion, area: g.info.area, gerencia: g.info.gerencia })
    if (dim === 'cargo' && g.info) o.funcion = g.info.funcion
    return o
  }).filter(o => o.serie.some(esNum))
  // Total del alcance: componentes sumados (no suma de ratios).
  const ctxTot = p => {
    const x = ctxVacio(), f = m.flujos.get(p)
    if (f) { x.ing = f.ingresos ? f.ingresos.length : null; x.sal = f.salidas ? f.salidas.length : null }
    const mm = m.suc.get(p)
    if (mm && mm.size) { const t = { venta: 0, mb: 0, rem: 0, gastos: 0, contrib: 0 }; let na = false; mm.forEach(v => { t.venta += v.ingresos; t.rem += v.rem; t.gastos += v.gastos; if (esNum(v.mb)) { t.mb += v.mb; t.contrib += v.contrib } else na = true }); if (na) { t.mb = null; t.contrib = null } Object.assign(x, t) }
    x.ventaTot = m.eerr.get(p)?.venta ?? null; x.costoTot = m.tot.has(p) ? costoNomina(m.tot.get(p)) : null
    return x
  }
  const st = serieInd(ind, meses, p => m.tot.get(p) || null, ctxTot)
  const total = { _k: 'total', nombre: m.filtrado ? `Total ${m.filtroNombre.toLowerCase()}` : 'Total empresa', anio: st.anual, serie: st.vals, tend: tendencia(st.vals) }
  meses.forEach((p, i) => { total[p] = st.vals[i] })
  const disponible = !(ind.soloCentro && dim !== 'centro')
  return { ind, meses, filas, total, disponible }
}

// ─── Tablero por centro ─────────────────────────────────────────────────────
export function tableroCentros(m, ps, pBase) {
  const totA = combinar(ps.map(p => (m.totEmpresa.get(p) || aggVacio())))
  const cfEmp = costoPorFte(totA), hfEmp = div(totA.hhee, totA.fte)
  const mov = movimientos(m, ps, 'centro')
  return m.centros.map(c => {
    const A = combinar(ps.map(p => aggCentro(m, p, c)))
    const B = pBase ? aggCentro(m, pBase, c) : null
    const x = sumSuc(m, c, ps), xb = pBase ? sumSuc(m, c, [pBase]) : null
    const mv = mov.porGrupo.get(c) || { ing: 0, sal: 0, ingT: 0, salT: 0 }
    const apoyo = esApoyo(c) || x.venta <= 0
    const mide = !apoyo && x.rem > 0
    const pz = pBase && ps.length === 1 && pBase !== ps[0] && B ? puenteCosto(B, A) : null
    return {
      _k: c, c, nombre: m.nombreCentro(c), tipo: apoyo ? 'Apoyo' : 'Tienda', apoyo,
      dot: A.dotProm, fte: A.fteProm, contrat: mv.ing - mv.ingT, trasIn: mv.ingT, desv: mv.sal - mv.salT, trasOut: mv.salT,
      rot: A.dotProm ? ((mv.sal - mv.salT) / A.dotProm) * (12 / Math.max(ps.length, 1)) : null,
      costo: costoNomina(A), costoFte: costoPorFte(A), idxCostoFte: div(costoPorFte(A), cfEmp),
      variable: div(A.clases.variable || 0, A.haberes), hhee: A.hhee, hheeSB: div(A.hhee, A.sueldoBase), hheeFte: div(A.hhee, A.fte), idxHhee: div(div(A.hhee, A.fte), hfEmp),
      venta: x.venta, mb: x.mb, rem: x.rem, gastos: x.gastos, contrib: x.contrib,
      pctVenta: mide ? x.rem / x.venta : null, gmrol: mide && esNum(x.mb) ? div(x.mb, x.rem) : null, roi: mide && esNum(x.mb) ? div(x.mb - x.rem, x.rem) : null,
      ventaFte: apoyo ? null : div(x.venta, A.fte), contribPct: apoyo ? null : div(x.contrib, x.venta),
      dCosto: B ? variacion(costoNomina(B), costoNomina(A)) : null,
      dPct: mide && xb && xb.venta > 0 && xb.rem > 0 ? x.rem / x.venta - xb.rem / xb.venta : null,
      dVenta: xb ? variacion(xb.venta, x.venta) : null, dRem: xb ? variacion(xb.rem, x.rem) : null, dFte: B ? variacion(B.fte, A.fte) : null,
      efDot: pz ? pz.efDot : null, efCosto: pz ? pz.efCosto : null, efHon: pz ? pz.efHon : null,
    }
  }).filter(f => f.dot || f.venta || f.rem)
}

// Ficha de un centro: todos los indicadores × mes.
export function fichaCentro(m, anio, c) {
  const meses = mesesNomina(m, anio)
  const fl = m.flCentro.get(c)
  const ctx = p => {
    const x = ctxVacio(), f = fl?.get(p), s = m.suc.get(p)?.get(c)
    if (f) { x.ing = f.ingresos ? f.ingresos.length : null; x.sal = f.salidas ? f.salidas.length : null }
    if (s) { x.venta = s.ingresos; x.mb = s.mb; x.rem = s.rem; x.gastos = s.gastos; x.contrib = s.contrib }
    x.ventaTot = m.eerr.get(p)?.venta ?? null; x.costoTot = m.tot.has(p) ? costoNomina(m.tot.get(p)) : null
    return x
  }
  const filas = INDICADORES.filter(ind => !(ind.soloCentro && esApoyo(c) && !['rem', 'gastos', 'contrib'].includes(ind.k))).map(ind => {
    const { vals, anual } = serieInd(ind, meses, p => m.centro.get(p)?.get(c) || null, ctx)
    const o = { _k: ind.k, ind, g: ind.g, nombre: ind.l, anio: anual, serie: vals, tend: tendencia(vals) }
    meses.forEach((p, i) => { o[p] = vals[i] })
    return o
  }).filter(o => o.serie.some(esNum))
  return { meses, filas }
}

// ─── Personas ───────────────────────────────────────────────────────────────
export const MEDIDAS_PERSONA = [
  ['costo', 'Costo empresa', r => r.haberes + r.aportes + r.honorario, 'm'],
  ['haberes', 'Haberes', r => r.haberes, 'm'],
  ['sb', 'Sueldo base', r => r.sueldoBase, 'm'],
  ['comision', 'Comisiones', r => r.partidas.comision || 0, 'm'],
  ['hhee', 'Horas extra', r => r.hheeTotal, 'm'],
  ['dias', 'Días trabajados', r => r.dias, 'n0'],
]
export function matrizPersonas(m, anio, medidaK, pBase, mes) {
  const med = MEDIDAS_PERSONA.find(x => x[0] === medidaK) || MEDIDAS_PERSONA[0]
  const meses = mesesNomina(m, anio)
  const g = new Map()
  for (const r of m.regs) {
    if (!r.periodo.startsWith(String(anio)) && r.periodo !== pBase) continue
    const k = r.tipo === 'liq' ? `p${r.cod}` : `h${r.nombre}`
    let o = g.get(k)
    if (!o) { o = { _k: k, cod: r.cod, tipo: r.tipo, nombre: r.nombre, cargo: r.cargo, ceco: r.ceco, funcion: r.funcion, area: r.area, gerencia: r.gerencia, ult: '', vals: {}, centros: new Set(), meses: 0 }; g.set(k, o) }
    const v = med[2](r)
    o.vals[r.periodo] = (o.vals[r.periodo] || 0) + v
    if (r.periodo.startsWith(String(anio))) { o.centros.add(r.ceco); if (!o.vals[`_c${r.periodo}`]) { o.meses += 1; o.vals[`_c${r.periodo}`] = 1 } }
    if (r.periodo >= o.ult) { o.ult = r.periodo; o.cargo = r.cargo; o.ceco = r.ceco; o.funcion = r.funcion; o.area = r.area; o.gerencia = r.gerencia }
  }
  const filas = [...g.values()].filter(o => o.meses > 0).map(o => {
    const f = { _k: o._k, cod: o.cod, tipo: o.tipo, nombre: o.nombre, cargo: o.cargo, centro: m.nombreCentro(o.ceco), ceco: o.ceco, funcion: o.funcion, area: o.area, gerencia: o.gerencia, meses: o.meses, traslados: o.centros.size > 1 ? o.centros.size - 1 : 0 }
    let t = 0
    meses.forEach(p => { const v = o.vals[p]; f[p] = v ?? null; if (esNum(v)) t += v })
    f.anio = med[0] === 'dias' ? (o.meses ? t / o.meses : null) : t
    f.prom = o.meses ? t / o.meses : null
    f.dBase = pBase && mes && esNum(o.vals[pBase]) && esNum(o.vals[mes]) ? o.vals[mes] - o.vals[pBase] : null
    f.serie = meses.map(p => o.vals[p] ?? null)
    return f
  }).sort((a, b) => (b.anio || 0) - (a.anio || 0))
  return { meses, filas, medida: med }
}

// Ficha de una persona: glosas × mes, resumen, días, centro, cargo y horas Workera.
export function fichaPersona(m, cod, anio) {
  const regs = m.regs.filter(r => r.tipo === 'liq' && r.cod === cod).sort((a, b) => a.periodo.localeCompare(b.periodo))
  const regsA = regs.filter(r => r.periodo.startsWith(String(anio)))
  const meses = regsA.map(r => r.periodo)
  if (!regsA.length) return null
  const ult = regsA[regsA.length - 1]
  const g = new Map()
  for (const l of m.lineas) {
    if (l.cod !== cod || !meses.includes(l.periodo) || !String(l.naturaleza).startsWith('haber')) continue
    const k = `${l.partida}|${l.glosa}`
    let o = g.get(k)
    if (!o) { o = { _k: k, partida: l.partida, partidaL: partidaL(l.partida), glosa: l.glosa, tipoHhee: l.tipoHhee }; g.set(k, o) }
    o[l.periodo] = (o[l.periodo] || 0) + l.monto
  }
  const posP = p => { const i = ORDEN_PARTIDA.indexOf(p); return i < 0 ? 99 : i }
  const haberes = [...g.values()].map(o => ({ ...o, anio: meses.reduce((t, p) => t + (o[p] || 0), 0) }))
    .sort((a, b) => posP(a.partida) - posP(b.partida) || b.anio - a.anio)
  const fila = (k, l, fn, fmtK = 'm') => { const o = { _k: k, nombre: l, fmtK }; let t = 0; regsA.forEach(r => { const v = fn(r); o[r.periodo] = v; if (esNum(v)) t += v }); o.anio = fmtK === 'n0' ? null : t; return o }
  const resumen = [
    fila('hab', 'Total haberes', r => r.haberes),
    fila('apo', 'Aportes patronales (est.)', r => r.aportes),
    fila('costo', 'Costo empresa', r => r.haberes + r.aportes),
    fila('dl', 'Descuentos legales', r => r.descLegal),
    fila('di', 'Descuentos internos y anticipos', r => r.descInterno),
    fila('liq', 'Líquido aproximado', r => r.haberes - r.descLegal - r.descInterno),
    fila('he', 'Horas extra sobre sueldo base', r => div(r.hheeTotal, r.sueldoBase), 'p1'),
  ]
  resumen[resumen.length - 1].anio = div(regsA.reduce((t, r) => t + r.hheeTotal, 0), regsA.reduce((t, r) => t + r.sueldoBase, 0))
  const info = [{ _k: 'dias', nombre: 'Días trabajados' }, { _k: 'centro', nombre: 'Centro' }, { _k: 'cargo', nombre: 'Cargo' }, { _k: 'gerencia', nombre: 'Gerencia (organigrama)' }, { _k: 'area', nombre: 'Área (organigrama)' }]
  regsA.forEach(r => { info[0][r.periodo] = r.dias; info[1][r.periodo] = m.nombreCentro(r.ceco); info[2][r.periodo] = r.cargo; info[3][r.periodo] = r.gerencia; info[4][r.periodo] = r.area })
  const w = m.hh.filter(x => x.cod === cod && meses.includes(x.periodo))
  const workera = w.length ? [
    { _k: 'wreg', nombre: 'Horas sobre la jornada (Workera)' }, { _k: 'waut', nombre: 'Autorizadas' }, { _k: 'wtope', nombre: 'Días con más de 2 h' },
  ] : []
  if (workera.length) {
    for (const x of w) { workera[0][x.periodo] = (workera[0][x.periodo] || 0) + x.min / 60; if (x.estado === 'autorizada') workera[1][x.periodo] = (workera[1][x.periodo] || 0) + x.min / 60; if (x.sobreTope) workera[2][x.periodo] = (workera[2][x.periodo] || 0) + 1 }
  }
  const centros = [...new Set(regsA.map(r => r.ceco))]
  return {
    cod, nombre: ult.nombre, cargo: ult.cargo, centro: m.nombreCentro(ult.ceco), funcion: ult.funcion, area: ult.area, gerencia: ult.gerencia, metodoArea: ult.metodoArea, fechaIngreso: ult.fechaIngreso,
    meses, haberes, resumen, info, workera, centros: centros.map(m.nombreCentro), socio: ult.socio,
  }
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
    if (!x) { x = { cod: r.cod, nombre: r.nombre, cargo: r.cargo, ceco: r.ceco, meses: 0, mesesHhee: 0, hhee: 0, sb: 0, ultimo: '', porMes: {} }; per.set(r.cod, x) }
    x.meses += 1; x.sb += r.sueldoBase; x.hhee += r.hheeTotal; if (r.hheeTotal > 0) x.mesesHhee += 1
    x.porMes[r.periodo] = (x.porMes[r.periodo] || 0) + r.hheeTotal
    if (r.periodo >= x.ultimo) { x.ultimo = r.periodo; x.cargo = r.cargo; x.ceco = r.ceco; x.nombre = r.nombre }
  }
  const personas = [...per.values()].filter(x => x.hhee > 0).map(x => ({
    ...x, _k: x.cod, centro: m.nombreCentro(x.ceco), pctSB: div(x.hhee, x.sb), promMes: x.mesesHhee ? x.hhee / x.mesesHhee : 0,
    recurrente: x.mesesHhee >= 3 && x.mesesHhee / x.meses >= 0.75, ...x.porMes,
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
// Horas Workera por centro (centro de la liquidación) × mes.
export function workeraCentroMes(m, anio) {
  const meses = [...new Set(m.hh.filter(x => String(x.periodo).startsWith(String(anio))).map(x => x.periodo))].sort()
  const g = new Map()
  for (const x of m.hh) {
    if (!String(x.periodo).startsWith(String(anio))) continue
    const k = x.ceco || 'sin'
    let o = g.get(k); if (!o) { o = { _k: k, nombre: k === 'sin' ? 'Sin centro' : m.nombreCentro(k), total: 0, aut: 0, tope: 0 }; g.set(k, o) }
    o[x.periodo] = (o[x.periodo] || 0) + x.min / 60; o.total += x.min / 60; if (x.estado === 'autorizada') o.aut += x.min / 60; if (x.sobreTope) o.tope += 1
  }
  return { meses, filas: [...g.values()].sort((a, b) => b.total - a.total) }
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
      nivel: w.pb - w.pa >= 0.03 ? 'alto' : 'medio', vista: 'centros',
      texto: `${m.nombreCentro(w.c)}: el costo de personal es ${fP(w.pb)} de su venta (${mesTexto(pBase)}: ${fP(w.pa)}). Venta ${fVar(w.vV)} y costo de personal ${fVar(w.vC)}.`,
    }))
  }
  for (const c of m.centros) {
    if (esApoyo(c)) continue
    const s = m.suc.get(mes)?.get(c)
    if (s && s.ingresos > 0 && s.contrib < 0) out.push({ nivel: 'alto', vista: 'centros', texto: `${m.nombreCentro(c)} tuvo contribución negativa en ${mesTexto(mes)} (${fM(s.contrib)}): su margen no cubre su personal y sus gastos directos.` })
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
    const pz = puenteCosto(ab, a), d = pz.fin - pz.ini
    if (d > 0 && pz.efDot > 0) out.push({ nivel: 'info', vista: 'costo', texto: `Del aumento de ${fM(d)} en la nómina, ${fM(pz.efDot)} (${fP(div(pz.efDot, d), 0)}) se explica por más FTE y ${fDelta(pz.efCosto)} por el costo por FTE.` })
  }
  if (pBase && pBase !== mes && m.gerencias && m.gerencias.length > 1) {
    const d = costoNomina(a) - costoNomina(ab)
    const top = m.gerencias.map(k => ({ k, d: costoNomina(aggGerencia(m, mes, k)) - costoNomina(aggGerencia(m, pBase, k)) })).sort((x, y) => y.d - x.d)[0]
    if (top && d > 0 && top.d > 0) out.push({ nivel: 'info', vista: 'costo', texto: `${nombreGerencia(top.k)} explica ${fM(top.d)} (${fP(div(top.d, d), 0)}) del aumento de ${fM(d)} en la nómina entre ${mesTexto(pBase)} y ${mesTexto(mes)}.` })
  }
  if (!m.porArea) {
    const fuera = new Map()
    for (const r of m.regs) {
      if (r.periodo !== mes) continue
      const esp = FUNCION_ESPERADA_AREA[r.area]
      if (esp && r.funcion !== esp && r.funcion !== 'Socios') { const k = `${r.area}|${r.funcion}`; fuera.set(k, (fuera.get(k) || 0) + r.costo) }
    }
    const totFuera = [...fuera.values()].reduce((s, x) => s + x, 0)
    const top = [...fuera.entries()].sort((x, y) => y[1] - x[1])[0]
    if (top && top[1] > 0) { const [ar, fu] = top[0].split('|'); out.push({ nivel: 'medio', vista: 'costo', texto: `En ${mesTexto(mes)}, ${fM(top[1])} de nómina del área ${ar} se registra en el EERR como remuneración de ${String(fu).toLowerCase()}, por la cuenta madre del maestro de empleados${totFuera > top[1] ? ` (en total, ${fM(totFuera)} fuera de su línea)` : ''}.` }) }
  }
  const w = analisisWorkera(m, anio).find(x => x.p === mes)
  if (w && w.sobreTope > 0) out.push({ nivel: 'medio', vista: 'hhee', texto: `Workera registra ${w.sobreTope} días con más de 2 horas extra en ${mesTexto(mes)}; el tope diario legal es de 2 horas (art. 31).` })
  const orden = { alto: 0, medio: 1, info: 2, bien: 3 }
  return out.sort((x, y) => orden[x.nivel] - orden[y.nivel])
}

// Sub-modelo para el detalle de una fila de la matriz (centro, función o cargo).
export function subModelo(m, pred, nombre) {
  const regs = m.regs.filter(pred)
  const ag = agregar(regs)
  const cods = new Map(ag.periodos.map(p => [p, ag.tot.get(p).cods]))
  return {
    ...m, regs, lineas: m.lineas.filter(pred), tot: ag.tot, centro: ag.centro, funcion: ag.funcion, area: ag.area, gerencia: ag.gerencia, periodos: ag.periodos,
    flujos: flujosDesde(cods, m.codsEmpresa, m.empMap), filtrado: true, filtroNombre: nombre || 'Selección', suc: new Map(), eerr: new Map(), _vacio: aggVacio(),
  }
}
