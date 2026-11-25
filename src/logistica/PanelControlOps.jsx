// ═══════════════════════════════════════════════════════════════════════════
// PanelControlOps — Panel de control de operaciones · Logística › Control
// 25-nov-2026 · Gate 1 aprobado por JP ("Continuar" con las 4 recomendaciones):
//   1) metas iguales para todas las ubicaciones · 2) jefe de bodega del CD ve su
//   CD (local) y su rol de origen en reposición · 3) lo que hoy no se puede medir
//   se muestra como "sin dato" con lo que falta · 4) las órdenes abiertas se
//   muestran tal cual (la depuración va aparte).
//
// Interfaz v2 (25-nov-2026): gráfica; cada dato se explica al pasar el mouse y al
// hacer clic abre un popup con su fuente (cálculo, tablas y registros).
//
// Audiencias:
//   · Global (rol admin = dirección y gerencia): matriz ubicación × área y
//     "Por dónde partir" (los desvíos más grandes frente a la meta).
//   · Local (solo jefaturas: jefe de bodega y jefes de sucursal):
//     su ubicación (sala + bodega auxiliar) con volumen · efectividad · respaldo
//     por área y la bandeja de pendientes, con salto al módulo que los resuelve.
//
// SOLO LECTURA. Usa las vistas oficiales para que las cifras sean las mismas que
// muestra cada módulo (una sola información oficial):
//   Recepciones  log_recepciones + log_recepcion_adjuntos (slots obligatorios)
//   Picking      v_log_otif_diario (OTIF oficial, igual que BI › Despacho)
//                + log_picking_ordenes (firma de entrega y órdenes abiertas)
//   Reposición   v_cd_cumplimiento_semanal (fill rate y SLA del Cumplimiento CD)
//                + log_solicitudes_reposicion + log_sol_despachos (guía real)
//   Mermas       v_log_merma_respaldo
//   Inventarios  v_inv_ajuste_pendiente + v_inv_resumen + v_log_cat_riesgo
//   Bitácora     v_log_bit_cumplimiento (regla de días obligatorios y plazo de config_sistema)
//
// Metas: valores por defecto en KPIS. Se ajustan sin tocar código con
// config_sistema.clave = 'panel_ops_metas' → JSON {"inv_eri":{"meta":90,"tol":10}, ...}
// Fechas: días de negocio en hora de Chile (America/Santiago), nunca UTC.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback, createContext, useContext } from 'react'
import { supabase } from '../supabase'
import { FONT } from './ui_compartida.jsx'
import { DataGrid } from '../finanzas/conciliacion/DataGrid'

// ── Paleta (la misma del menú de Logística) ─────────────────────────────────
const C = {
  navy: '#16213E', ink: '#1C1C1E', slate: '#6E6E73', borde: '#E5E7EB', tinte: '#EEF1F7',
  fondo: '#F4F5F7', verde: '#1E7A44', ambar: '#B25E09', rojo: '#B42318', gris: '#9AA0A6',
}
export const EST = {
  ok:   { c: C.verde, l: 'En meta' },
  warn: { c: C.ambar, l: 'Bajo meta' },
  bad:  { c: C.rojo,  l: 'Crítico' },
  bajo: { c: C.gris,  l: 'Volumen bajo, no se evalúa' },
  nd:   { c: C.gris,  l: 'Sin dato' },
}
const PESO = { bad: 3, warn: 2, ok: 1, bajo: 0, nd: 0 }
const MIN_N = 5   // con menos de 5 casos un porcentaje se muestra, pero no se pinta ni se rankea

// ── Áreas y destino en el menú de Logística (hoja, sub) ─────────────────────
export const AREAS = [
  { k: 'rec',  l: 'Recepciones',        mod: 'Recepción',  ir: ['rec', 'lista'] },
  { k: 'pick', l: 'Picking y despacho', mod: 'Picking',    ir: ['pick', 'cola'] },
  { k: 'repo', l: 'Reposición',         mod: 'Reposición', ir: ['repo', 'solicitudes'] },
  { k: 'mer',  l: 'Mermas',             mod: 'Mermas',     ir: ['mermas', 'pendientes'] },
  { k: 'inv',  l: 'Inventarios',        mod: 'Inventario', ir: ['inv', 'operacion'] },
  { k: 'bit',  l: 'Bitácora',           mod: 'Bitácora',   ir: ['bitacora', 'cumpl'] },
]
const AREA = Object.fromEntries(AREAS.map(a => [a.k, a]))

// ── Catálogo de indicadores ──────────────────────────────────────────────────
// tipo 'pct': mayor es mejor (meta = mínimo aceptable; amarillo hasta meta − tol)
// tipo 'n'  : conteo, menor es mejor (meta = máximo aceptable; amarillo hasta meta + tol)
// rol 'efect' y 'resp' van en la matriz; 'ctrl' son controles (atrasos, calidad del dato)
// foto: true → se mide al momento (no depende del mes ni tiene comparación)
export const KPIS = [
  { k: 'rec_bsale', area: 'rec', rol: 'efect', tipo: 'pct', meta: 95, tol: 5,
    l: 'Ingreso a BSALE en 1 día o menos', c: 'BSALE ≤ 1 día', falta: 'ingresos a BSALE tardíos',
    def: 'Recepciones ingresadas a BSALE con 1 día de demora o menos / recepciones con demora registrada.' },
  { k: 'rec_resp', area: 'rec', rol: 'resp', tipo: 'pct', meta: 100, tol: 5,
    l: 'Respaldo completo', c: 'Respaldo', falta: 'recepciones con respaldo incompleto',
    def: 'Recepciones con documento del proveedor, formulario de recepción y comprobante BSALE (más foto si hubo bultos dañados) / recepciones.' },
  { k: 'pick_otif', area: 'pick', rol: 'efect', tipo: 'pct', meta: 98, tol: 3,
    l: 'OTIF retiro inmediato', c: 'OTIF retiro', falta: 'retiros fuera de plazo o incompletos',
    def: 'Retiros inmediatos entregados completos en menos de 30 minutos / retiros medibles (vista oficial v_log_otif_diario, la misma de BI › Despacho).' },
  { k: 'pick_resp', area: 'pick', rol: 'resp', tipo: 'pct', meta: 100, tol: 3,
    l: 'Entregas con respaldo firmado', c: 'Con firma', falta: 'entregas sin firma',
    def: 'Órdenes entregadas con respaldo firmado / órdenes entregadas (por día de llegada de la orden, igual que el OTIF).' },
  { k: 'pick_fecha', area: 'pick', rol: 'ctrl', tipo: 'pct', meta: 100, tol: 10,
    l: 'Despachos con fecha comprometida', c: 'Despachos con fecha', falta: 'despachos sin fecha comprometida',
    def: 'Despachos no anulados con fecha comprometida / despachos no anulados. Sin esta fecha no se puede medir el OTIF de despacho.' },
  { k: 'pick_otifd', area: 'pick', rol: 'ctrl', tipo: 'pct', meta: 95, tol: 5,
    l: 'OTIF despacho', c: 'OTIF despacho', falta: 'despachos fuera de plazo o incompletos', sinDato: 'falta la fecha comprometida',
    def: 'Despachos entregados completos y a tiempo / despachos medibles. Hoy casi no hay medibles porque falta la fecha comprometida.' },
  { k: 'pick_back', area: 'pick', rol: 'ctrl', tipo: 'n', meta: 0, tol: 10, foto: true,
    l: 'Órdenes abiertas hace más de 7 días', c: 'Abiertas > 7 días', falta: 'órdenes abiertas',
    def: 'Órdenes sin entregar, anular ni archivar, emitidas hace más de 7 días. Se mide al momento; incluye las que nunca se cerraron en el sistema.' },
  { k: 'repo_fill', area: 'repo', rol: 'efect', tipo: 'pct', meta: 95, tol: 5,
    l: 'Fill rate', c: 'Fill rate', falta: 'unidades pedidas sin despachar',
    def: 'Unidades despachadas (hasta lo pedido) / unidades pedidas, en las semanas que parten dentro del período (vista oficial del Cumplimiento del CD).' },
  { k: 'repo_guia', area: 'repo', rol: 'resp', tipo: 'pct', meta: 100, tol: 5,
    l: 'Despachos con guía real', c: 'Guía real', falta: 'despachos con guía provisional o sin guía',
    def: 'Solicitudes despachadas o recibidas cuyos despachos tienen guía registrada y no provisional / solicitudes despachadas o recibidas (sin traspasos internos ni venta directa).' },
  { k: 'repo_sla', area: 'repo', rol: 'ctrl', tipo: 'pct', meta: 90, tol: 10,
    l: 'Puntualidad SLA', c: 'SLA', falta: 'solicitudes despachadas fuera de SLA',
    def: 'Solicitudes despachadas dentro del SLA / solicitudes ya despachadas (vista oficial del Cumplimiento del CD).' },
  { k: 'repo_pend', area: 'repo', rol: 'ctrl', tipo: 'n', meta: 0, tol: 2, foto: true,
    l: 'Solicitudes fuera de plazo', c: 'Fuera de plazo', falta: 'solicitudes fuera de plazo',
    def: 'Tienda: despachadas hace más de 24 h sin confirmar recepción, o por confirmar hace más de 12 h. CD: sin despachar fuera de su SLA (urgente 24 h, normal 48 h). Se mide al momento.' },
  { k: 'mer_clas', area: 'mer', rol: 'efect', tipo: 'pct', meta: 100, tol: 5,
    l: 'Bajas clasificadas', c: 'Clasificadas', falta: 'bajas sin clasificar',
    def: 'Bajas del período con tipo asignado (distinto de "sin clasificar") / bajas del período.' },
  { k: 'mer_resp', area: 'mer', rol: 'resp', tipo: 'pct', meta: 100, tol: 5,
    l: 'Bajas respaldadas', c: 'Respaldadas', falta: 'bajas sin respaldo',
    def: 'Bajas del período en estado respaldado / bajas del período. Regla del negocio: ninguna baja sin respaldo.' },
  { k: 'mer_back', area: 'mer', rol: 'ctrl', tipo: 'n', meta: 0, tol: 3, foto: true,
    l: 'Bajas pendientes con más de 3 días', c: 'Pendientes > 3 días', falta: 'con más de 3 días sin respaldo',
    def: 'Bajas pendientes de respaldo con más de 3 días, de cualquier fecha. Se mide al momento.' },
  { k: 'inv_eri', area: 'inv', rol: 'efect', tipo: 'pct', meta: 95, tol: 10,
    l: 'Exactitud de inventario', c: 'Exactitud', falta: 'líneas con diferencia',
    def: 'Líneas contadas sin diferencia / líneas contadas, en inventarios cerrados con fecha de conteo en el período.' },
  { k: 'inv_resp', area: 'inv', rol: 'resp', tipo: 'pct', meta: 100, tol: 10,
    l: 'Ajustes BSALE respaldados', c: 'Ajustes respaldados', falta: 'inventarios con ajuste sin respaldo',
    def: 'Inventarios del período con diferencias cuyo ajuste o consumo en BSALE está respaldado / inventarios del período con diferencias.' },
  { k: 'inv_back', area: 'inv', rol: 'ctrl', tipo: 'n', meta: 0, tol: 2, foto: true,
    l: 'Ajustes sin respaldo (acumulado)', c: 'Ajustes sin respaldo', falta: 'inventarios sin respaldo',
    def: 'Inventarios cerrados con diferencias sin ajuste o consumo respaldado en BSALE, de cualquier fecha. Se mide al momento.' },
  { k: 'inv_cob', area: 'inv', rol: 'ctrl', tipo: 'n', meta: 0, tol: 2, foto: true,
    l: 'Categorías sin contar hace más de 90 días', c: 'Categorías > 90 días', falta: 'categorías sin contar',
    def: 'Categorías cuyo último inventario tiene más de 90 días o que nunca se han contado. Se mide al momento.' },
  { k: 'bit_tiempo', area: 'bit', rol: 'efect', tipo: 'pct', meta: 100, tol: 10,
    l: 'Bitácora enviada a tiempo', c: 'A tiempo', falta: 'días sin bitácora a tiempo',
    def: 'Días obligatorios con bitácora enviada antes del plazo / días obligatorios ya vencidos. Regla del sistema (config_sistema): lunes a sábado, plazo 09:00 del día siguiente, descontando las excepciones cargadas.' },
  { k: 'bit_valid', area: 'bit', rol: 'resp', tipo: 'pct', meta: 100, tol: 10,
    l: 'Bitácoras validadas por jefatura', c: 'Validadas', falta: 'bitácoras sin validar',
    def: 'Bitácoras enviadas con validación de la jefatura / bitácoras enviadas.' },
  { k: 'bit_falt', area: 'bit', rol: 'ctrl', tipo: 'n', meta: 0, tol: 1,
    l: 'Días sin bitácora', c: 'Días sin bitácora', falta: 'días sin bitácora',
    def: 'Días obligatorios vencidos del período sin bitácora enviada.' },
]
export const KPI = Object.fromEntries(KPIS.map(k => [k.k, k]))

// Metas efectivas: las del catálogo, ajustables con config_sistema.panel_ops_metas
export function metasDe(config) {
  const m = Object.fromEntries(KPIS.map(k => [k.k, { meta: k.meta, tol: k.tol }]))
  try {
    const raw = config?.panel_ops_metas
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => {
      if (!m[k] || !v || typeof v !== 'object') return
      if (v.meta != null && Number.isFinite(Number(v.meta))) m[k].meta = Number(v.meta)
      if (v.tol != null && Number.isFinite(Number(v.tol))) m[k].tol = Math.max(0, Number(v.tol))
    })
  } catch { /* JSON inválido en config: quedan los valores por defecto */ }
  return m
}

// ── Formato ──────────────────────────────────────────────────────────────────
const nf0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 })
const nfM = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const fN = n => nf0.format(Math.round(Number(n) || 0))
export const fP = v => {
  if (v == null) return '—'
  const r = Math.round(v * 10) / 10
  return `${nf1.format(v < 100 && r >= 100 ? 99.9 : r)}%`   // 99,96% no se muestra como 100%
}
export const fM = n => {
  const x = Number(n) || 0, a = Math.abs(x), sg = x < 0 ? '−' : ''
  return a >= 1e6 ? `${sg}$${nfM.format(a / 1e6)}M` : `${sg}$${fN(a)}`
}
const pl = (n, uno, varios) => `${fN(n)} ${Math.round(Number(n) || 0) === 1 ? uno : varios}`
const fDelta = d => `${d > 0 ? '+' : d < 0 ? '−' : ''}${nf1.format(Math.abs(Math.round(d * 10) / 10))}`

// ── Fechas en hora de Chile ──────────────────────────────────────────────────
const TZ = 'America/Santiago'
export const hoyCL = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
export const fechaCL = ts => ts ? new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ }) : null
function offCL(f) {
  try {
    const s = new Date(`${f}T12:00:00Z`).toLocaleString('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    const m = s.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/)
    if (m) { const h = parseInt(m[1], 10); return `${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:${m[2] || '00'}` }
  } catch { /* navegador sin shortOffset */ }
  return '-03:00'
}
export const tsCL = f => `${f}T00:00:00${offCL(f)}`                 // inicio del día f en Chile
export const sumDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const diasEntre = (a, b) => (a && b) ? Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 864e5) : null
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mesLargo = ym => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
const rangoTxt = (d, h) => `${Number(d.slice(8, 10))} al ${Number(h.slice(8, 10))} de ${MESES[Number(h.slice(5, 7)) - 1]}`

// Período: mes elegido hasta hoy (o completo si ya cerró) y el mes anterior al mismo día
export function periodoDe(ym, hoy = hoyCL()) {
  const [y, m] = ym.split('-').map(Number)
  const fin = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const enCurso = hoy.slice(0, 7) === ym
  const hasta = enCurso ? hoy : `${ym}-${String(fin).padStart(2, '0')}`
  const yA = m === 1 ? y - 1 : y, mA = m === 1 ? 12 : m - 1
  const ymA = `${yA}-${String(mA).padStart(2, '0')}`
  const finA = new Date(Date.UTC(yA, mA, 0)).getUTCDate()
  const diaA = enCurso ? Math.min(Number(hoy.slice(8, 10)), finA) : finA
  return { ym, desde: `${ym}-01`, hasta, enCurso,
    ant: { ym: ymA, desde: `${ymA}-01`, hasta: `${ymA}-${String(diaA).padStart(2, '0')}` } }
}
function mesesOpc(hoy = hoyCL()) {
  let y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7))
  const out = []
  for (let i = 0; i < 12; i++) { out.push(`${y}-${String(m).padStart(2, '0')}`); m -= 1; if (!m) { m = 12; y -= 1 } }
  return out
}

// ── Ubicaciones: sala + bodega auxiliar = una sola unidad (R6-TOTAL) ─────────
const ORDEN_FAM = ['cd_mp', 'lg', 'mp', 'la']
const NOMBRE_CORTO = { cd_mp: 'CD Maipú', lg: 'La Granja', mp: 'Tienda Maipú', la: 'Los Ángeles' }
export function armarFamilias(sucs) {
  const fams = {}
  ;(sucs || []).filter(s => s && s.codigo && s.activa !== false).forEach(s => {
    const cod = s.codigo_padre || s.codigo
    if (!fams[cod]) fams[cod] = { cod, nombre: NOMBRE_CORTO[cod] || null, codigos: [], esCD: false, chica: false }
    const f = fams[cod]
    if (!f.codigos.includes(s.codigo)) f.codigos.push(s.codigo)
    if (!s.codigo_padre) {
      f.nombre = f.nombre || s.nombre
      f.esCD = !!s.es_centro_distribucion || s.tipo_ubicacion === 'cd'
      f.chica = s.tipo_sucursal === 'chica'
    }
  })
  return Object.values(fams).filter(f => f.nombre).sort((a, b) => {
    const ia = ORDEN_FAM.indexOf(a.cod), ib = ORDEN_FAM.indexOf(b.cod)
    return ((ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)) || a.nombre.localeCompare(b.nombre)
  })
}

// ── Reglas compartidas ───────────────────────────────────────────────────────
const SLOTS_REQ = ['doc_proveedor', 'formulario_rec', 'comp_bsale']
const SLOT_L = { doc_proveedor: 'documento del proveedor', formulario_rec: 'formulario de recepción', comp_bsale: 'comprobante BSALE', foto_danados: 'foto de daños' }
export function faltanSlots(r) {
  const s = new Set(r.slots || [])
  const f = SLOTS_REQ.filter(k => !s.has(k))
  if ((Number(r.bultos_danados) || 0) > 0 && !s.has('foto_danados')) f.push('foto_danados')
  return f
}
const PICK_ABIERTOS = ['pendiente', 'asignada', 'en_picking', 'lista', 'despachada']
const SLA_H = { extraordinaria: 24, normal: 48 }
const esFlujoCD = s => (s.tipo_sol === 'normal' || s.tipo_sol === 'extraordinaria') && !s.es_flujo_inverso
// perspectiva 'tienda': la tienda debe confirmar · 'cd': el CD debe despachar
export function repoFueraDePlazo(s, perspectiva, ahora = Date.now()) {
  const horas = t => t ? (ahora - new Date(t).getTime()) / 36e5 : 0
  if (perspectiva === 'tienda') {
    if (s.etapa === 'despachado') return horas(s.hora_inicio_etapa || (s.fecha_despacho && tsCL(s.fecha_despacho))) > 24
    if (s.etapa === 'suc_confirma') return horas(s.hora_inicio_etapa || s.created_at) > 12
    return false
  }
  return esFlujoCD(s) && ['solicitado', 'analisis', 'cd_valida'].includes(s.etapa) && horas(s.created_at) > (SLA_H[s.tipo_sol] || 48)
}

// ═══════════════════════════════════════════════════════════════════════════
// CARGA DE DATOS (solo lectura)
// ═══════════════════════════════════════════════════════════════════════════
const trozos = (arr, n = 100) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o }
// Pagina de a 1.000 (límite de la API) hasta traer todo
async function traerTodo(armar, pag = 1000, tope = 50000) {
  let out = [], desde = 0
  for (;;) {
    const { data, error } = await armar().range(desde, desde + pag - 1)
    if (error) throw error
    const filas = data || []
    out = out.concat(filas)
    if (filas.length < pag || out.length >= tope) break
    desde += pag
  }
  return out
}
async function traerPorIds(armar, ids) {
  if (!ids.length) return []
  const res = await Promise.all(trozos([...new Set(ids)]).map(async t => {
    const { data, error } = await armar(t)
    if (error) throw error
    return data || []
  }))
  return res.flat()
}
async function contar(q) {
  const { count, error } = await q
  if (error) throw error
  return count || 0
}
const enSuc = (q, codigos) => codigos ? q.in('sucursal_codigo', codigos) : q
async function correr(tareas) {
  const claves = Object.keys(tareas)
  const res = await Promise.allSettled(claves.map(k => tareas[k]()))
  const datos = {}, errores = {}
  res.forEach((r, i) => {
    if (r.status === 'fulfilled') datos[claves[i]] = r.value
    else errores[claves[i]] = r.reason?.message || String(r.reason)
  })
  return { datos, errores }
}

// Datos del período (se cargan para el período actual y para el de comparación).
// codigos = null → todas las ubicaciones; reposición del CD necesita todas las tiendas.
export async function cargarPeriodo(p, fams, codigos, conRepoTotal) {
  const t1 = tsCL(p.desde), t2 = tsCL(sumDias(p.hasta, 1))
  return correr({
    rec: async () => {
      const rows = await traerTodo(() => enSuc(supabase.from('log_recepciones')
        .select('id,sucursal_codigo,fecha_recepcion,cantidad_total,dias_demora,bultos_danados,estado,proveedor,tipo_documento,numero_documento')
        .gte('fecha_recepcion', p.desde).lte('fecha_recepcion', p.hasta), codigos).order('fecha_recepcion').order('id'))
      const adj = await traerPorIds(t => supabase.from('log_recepcion_adjuntos').select('recepcion_id,slot').in('recepcion_id', t), rows.map(r => r.id))
      const slots = {}
      adj.forEach(a => { (slots[a.recepcion_id] = slots[a.recepcion_id] || []).push(a.slot) })
      return rows.map(r => ({ ...r, slots: slots[r.id] || [] }))
    },
    otif: () => traerTodo(() => enSuc(supabase.from('v_log_otif_diario')
      .select('dia,sucursal_codigo,modalidad,n_total,n_anuladas,n_medibles,n_otif,n_sin_fecha_comprometida')
      .gte('dia', p.desde).lte('dia', p.hasta), codigos).order('dia').order('sucursal_codigo').order('modalidad')),
    firmas: async () => {
      const out = {}
      await Promise.all(fams.map(async f => {
        const base = () => supabase.from('log_picking_ordenes').select('id', { count: 'exact', head: true })
          .eq('estado', 'entregada').in('sucursal_codigo', f.codigos).gte('recibida_at', t1).lt('recibida_at', t2)
        const [ent, firm] = await Promise.all([contar(base()), contar(base().not('respaldo_firmado_at', 'is', null))])
        out[f.cod] = { ent, firm }
      }))
      return out
    },
    repo: async () => {
      const sols = await traerTodo(() => enSuc(supabase.from('log_solicitudes_reposicion')
        .select('id,folio,sucursal_codigo,etapa,tipo_sol,es_flujo_inverso,created_at')
        .neq('etapa', 'anulado').gte('created_at', t1).lt('created_at', t2), conRepoTotal ? null : codigos).order('created_at').order('id'))
      const ids = sols.filter(s => s.etapa === 'despachado' || s.etapa === 'recibido').map(s => s.id)
      const desp = await traerPorIds(t => supabase.from('log_sol_despachos').select('sol_id,guia_despacho,guia_provisional').in('sol_id', t), ids)
      const g = {}
      desp.forEach(d => {
        const x = g[d.sol_id] = g[d.sol_id] || { n: 0, ok: 0 }
        x.n += 1
        if (String(d.guia_despacho || '').trim() && !d.guia_provisional) x.ok += 1
      })
      return sols.map(s => ({ ...s, guiaReal: !!g[s.id] && g[s.id].ok === g[s.id].n }))
    },
    sem: () => traerTodo(() => enSuc(supabase.from('v_cd_cumplimiento_semanal')
      .select('semana,sucursal_codigo,solicitudes,u_pedidas,u_despachadas,despachadas_sla,pendientes_cd')
      .gte('semana', p.desde).lte('semana', p.hasta), conRepoTotal ? null : codigos).order('semana').order('sucursal_codigo')),
    mer: () => traerTodo(() => enSuc(supabase.from('v_log_merma_respaldo')
      .select('id,sucursal_codigo,fecha,tipo,total_unidades,costo_total,estado')
      .gte('fecha', p.desde).lte('fecha', p.hasta), codigos).order('fecha').order('id')),
    inv: async () => {
      const aj = await traerTodo(() => enSuc(supabase.from('v_inv_ajuste_pendiente')
        .select('id,sucursal_codigo,tipo_inventario,fecha,estado_respaldo,dif_neta_clp,dif_abs_clp')
        .gte('fecha', p.desde).lte('fecha', p.hasta), codigos).order('fecha').order('id'))
      const res = await traerPorIds(t => supabase.from('v_inv_resumen').select('inventario_id,lineas_conciliadas,lineas_cuadran').in('inventario_id', t), aj.map(r => r.id))
      const m = Object.fromEntries(res.map(r => [r.inventario_id, r]))
      return aj.map(r => ({ ...r, conc: Number(m[r.id]?.lineas_conciliadas) || 0, cuad: Number(m[r.id]?.lineas_cuadran) || 0 }))
    },
    bit: () => traerTodo(() => enSuc(supabase.from('v_log_bit_cumplimiento')
      .select('sucursal_codigo,fecha,obligatorio,estado_registro,validado_at,responsable_nombre')
      .gte('fecha', p.desde).lte('fecha', p.hasta), codigos).order('fecha').order('sucursal_codigo')),
  })
}

// Foto al momento (no depende del mes)
export async function cargarFoto(fams, codigos) {
  const hace7 = new Date(Date.now() - 7 * 864e5).toISOString()
  return correr({
    abiertas: async () => {
      const out = {}
      await Promise.all(fams.map(async f => {
        out[f.cod] = await contar(supabase.from('log_picking_ordenes').select('id', { count: 'exact', head: true })
          .in('estado', PICK_ABIERTOS).in('sucursal_codigo', f.codigos).lt('emitida_at', hace7)
          .or('archivada.is.null,archivada.eq.false'))
      }))
      return out
    },
    merPend: () => traerTodo(() => enSuc(supabase.from('v_log_merma_respaldo')
      .select('id,sucursal_codigo,fecha,tipo,total_unidades,costo_total,nota').eq('estado', 'pendiente'), codigos).order('fecha').order('id')),
    ajPend: () => traerTodo(() => enSuc(supabase.from('v_inv_ajuste_pendiente')
      .select('id,sucursal_codigo,tipo_inventario,fecha,estado_respaldo,falta,dif_abs_clp')
      .in('estado_respaldo', ['SIN_RESPALDO', 'FOLIO_SIN_DOCUMENTO']), codigos).order('fecha').order('id')),
    cat: () => traerTodo(() => enSuc(supabase.from('v_log_cat_riesgo')
      .select('sucursal_codigo,categoria,ultimo_inv,dias_sin_inventario'), codigos).order('sucursal_codigo').order('categoria')),
    repPend: () => traerTodo(() => supabase.from('log_solicitudes_reposicion')
      .select('id,folio,sucursal_codigo,sucursal_nombre,etapa,tipo_sol,es_flujo_inverso,created_at,hora_inicio_etapa,fecha_despacho')
      .in('etapa', ['solicitado', 'analisis', 'cd_valida', 'suc_confirma', 'despachado']).order('created_at').order('id')),
  })
}

// Listas para la bandeja de pendientes de una ubicación
export async function cargarDetalle(fam, p) {
  const hace7 = new Date(Date.now() - 7 * 864e5).toISOString()
  const t1 = tsCL(p.desde), t2 = tsCL(sumDias(p.hasta, 1))
  return correr({
    abiertas: () => traerTodo(() => supabase.from('log_picking_ordenes')
      .select('id,folio,sucursal_codigo,estado,modalidad_entrega,tipo_entrega,emitida_at,cliente_nombre,monto_total')
      .in('estado', PICK_ABIERTOS).in('sucursal_codigo', fam.codigos).lt('emitida_at', hace7)
      .or('archivada.is.null,archivada.eq.false').order('emitida_at').order('id'), 1000, 10000),
    sinFirma: () => traerTodo(() => supabase.from('log_picking_ordenes')
      .select('id,folio,sucursal_codigo,modalidad_entrega,tipo_entrega,recibida_at,entregada_at,cliente_nombre,entregado_por,monto_total')
      .eq('estado', 'entregada').is('respaldo_firmado_at', null).in('sucursal_codigo', fam.codigos)
      .gte('recibida_at', t1).lt('recibida_at', t2).order('recibida_at').order('id'), 1000, 10000),
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// CÁLCULO (funciones puras: se prueban sin base de datos)
// ═══════════════════════════════════════════════════════════════════════════
const S = (rows, k) => (rows || []).reduce((a, r) => a + (Number(typeof k === 'function' ? k(r) : r[k]) || 0), 0)
const P = (num, den, extra) => ({ num, den, v: den > 0 ? 100 * num / den : null, ...extra })
const N = (v, extra) => ({ v, ...extra })
const SIN_FUENTE = { v: null, err: true }

// f: { cod, codigos, esCD, total } · per: datos del período (null si no cargó) · foto: null en el período de comparación
export function calcularUbicacion(f, per, foto, { hoy = hoyCL(), ahora = Date.now(), fams = [] } = {}) {
  const d = per?.datos || {}, eP = per?.errores || {}
  const ft = foto?.datos || null, eF = foto?.errores || {}
  const enF = r => f.codigos.includes(r.sucursal_codigo)
  const persp = f.total ? 'total' : f.esCD ? 'cd' : 'tienda'
  const cods = f.total ? fams.map(x => x.cod) : [f.cod]
  const sumaFam = (obj, campo) => cods.reduce((a, c) => a + (Number(campo ? obj?.[c]?.[campo] : obj?.[c]) || 0), 0)
  const fotoN = (clave, calc) => !ft ? { v: null, sinComparar: true } : (eF[clave] || !ft[clave]) ? SIN_FUENTE : calc(ft[clave])
  const out = {}

  // Recepciones
  if (d.rec) {
    const rows = d.rec.filter(enF)
    const med = rows.filter(r => r.dias_demora != null)
    const incompletas = rows.filter(r => faltanSlots(r).length > 0)
    out.rec = {
      vol: { n: rows.length, txt: `${pl(rows.length, 'recepción', 'recepciones')} · ${fN(S(rows, 'cantidad_total'))} u.` },
      kpis: { rec_bsale: P(med.filter(r => Number(r.dias_demora) <= 1).length, med.length),
              rec_resp: P(rows.length - incompletas.length, rows.length) },
    }
  } else out.rec = { error: eP.rec || 'sin datos' }

  // Picking y despacho
  if (d.otif) {
    const rows = d.otif.filter(enF)
    const ri = rows.filter(r => r.modalidad === 'retiro_inmediato'), de = rows.filter(r => r.modalidad === 'despacho')
    const ordenes = S(rows, 'n_total') - S(rows, 'n_anuladas')
    const desp = S(de, 'n_total') - S(de, 'n_anuladas')
    const firmas = d.firmas ? { ent: sumaFam(d.firmas, 'ent'), firm: sumaFam(d.firmas, 'firm') } : null
    out.pick = {
      vol: { n: ordenes, txt: `${pl(ordenes, 'orden', 'órdenes')} · ${pl(desp, 'despacho', 'despachos')}` },
      kpis: {
        pick_otif: P(S(ri, 'n_otif'), S(ri, 'n_medibles')),
        pick_resp: firmas ? P(firmas.firm, firmas.ent) : SIN_FUENTE,
        pick_fecha: P(desp - S(de, 'n_sin_fecha_comprometida'), desp),
        pick_otifd: P(S(de, 'n_otif'), S(de, 'n_medibles')),
        pick_back: fotoN('abiertas', ab => N(sumaFam(ab))),
      },
    }
  } else out.pick = { error: eP.otif || 'sin datos' }

  // Reposición — tienda: lo que le llega · CD y total: lo que sale del CD
  if (d.repo && d.sem) {
    const sols = d.repo.filter(s => persp === 'tienda' ? enF(s) : esFlujoCD(s))
    const sem = d.sem.filter(r => persp === 'tienda' ? enF(r) : true)
    const base = sols.filter(s => (s.etapa === 'despachado' || s.etapa === 'recibido') && s.tipo_sol !== 'traspaso_interno' && s.tipo_sol !== 'venta_directa')
    out.repo = {
      vol: { n: sols.length, txt: persp === 'tienda'
        ? `${pl(sols.length, 'solicitud', 'solicitudes')} · ${fN(S(sem, 'u_pedidas'))} u. pedidas`
        : `${pl(sols.length, 'solicitud atendida', 'solicitudes atendidas')} · ${fN(S(sem, 'u_despachadas'))} u. despachadas` },
      kpis: {
        repo_fill: P(S(sem, r => Math.min(Number(r.u_despachadas) || 0, Number(r.u_pedidas) || 0)), S(sem, 'u_pedidas')),
        repo_guia: P(base.filter(s => s.guiaReal).length, base.length),
        repo_sla: P(S(sem, 'despachadas_sla'), S(sem, 'solicitudes') - S(sem, 'pendientes_cd')),
        repo_pend: fotoN('repPend', rows => N(rows.filter(s => {
          if (persp === 'tienda') return enF(s) && repoFueraDePlazo(s, 'tienda', ahora)
          if (persp === 'cd') return repoFueraDePlazo(s, 'cd', ahora)
          return repoFueraDePlazo(s, 'tienda', ahora) || repoFueraDePlazo(s, 'cd', ahora)
        }).length)),
      },
    }
  } else out.repo = { error: eP.repo || eP.sem || 'sin datos' }

  // Mermas
  if (d.mer) {
    const rows = d.mer.filter(enF)
    out.mer = {
      vol: { n: rows.length, txt: `${pl(rows.length, 'baja', 'bajas')} · ${fM(S(rows, 'costo_total'))}` },
      kpis: {
        mer_clas: P(rows.filter(r => r.tipo && r.tipo !== 'sin_clasificar').length, rows.length),
        mer_resp: P(rows.filter(r => r.estado === 'respaldado').length, rows.length),
        mer_back: fotoN('merPend', pend => {
          const pf = pend.filter(enF)
          return N(pf.filter(r => diasEntre(r.fecha, hoy) > 3).length, { acum: `${pl(pf.length, 'pendiente', 'pendientes')} por ${fM(S(pf, 'costo_total'))}`, monto: S(pf, 'costo_total') })
        }),
      },
    }
  } else out.mer = { error: eP.mer || 'sin datos' }

  // Inventarios
  if (d.inv) {
    const rows = d.inv.filter(enF)
    const conDif = rows.filter(r => r.estado_respaldo && r.estado_respaldo !== 'SIN_AJUSTE')
    out.inv = {
      vol: { n: rows.length, txt: `${pl(rows.length, 'conteo', 'conteos')} · ${pl(S(rows, 'conc'), 'línea', 'líneas')}` },
      kpis: {
        inv_eri: P(S(rows, 'cuad'), S(rows, 'conc')),
        inv_resp: P(conDif.filter(r => r.estado_respaldo === 'RESPALDADO').length, conDif.length),
        inv_back: fotoN('ajPend', aj => {
          const af = aj.filter(enF)
          return N(af.length, { acum: af.length ? `diferencia absoluta ${fM(S(af, 'dif_abs_clp'))}` : '', monto: S(af, 'dif_abs_clp') })
        }),
        inv_cob: fotoN('cat', cat => N(cat.filter(enF).filter(c => c.dias_sin_inventario == null || Number(c.dias_sin_inventario) > 90).length)),
      },
      difNeta: S(rows, 'dif_neta_clp'), difAbs: S(rows, 'dif_abs_clp'),
    }
  } else out.inv = { error: eP.inv || 'sin datos' }

  // Bitácora (EN_PLAZO = hoy, todavía no vence)
  if (d.bit) {
    const rows = d.bit.filter(enF)
    const venc = rows.filter(r => r.obligatorio && r.estado_registro !== 'EN_PLAZO')
    const env = venc.filter(r => r.estado_registro === 'A_TIEMPO' || r.estado_registro === 'TARDIO')
    const falt = venc.filter(r => r.estado_registro === 'FALTANTE' || r.estado_registro === 'SIN_ENVIAR')
    out.bit = {
      vol: { n: venc.length, txt: `${pl(venc.length, 'día obligatorio', 'días obligatorios')} · ${pl(env.length, 'enviada', 'enviadas')}` },
      kpis: {
        bit_tiempo: P(venc.filter(r => r.estado_registro === 'A_TIEMPO').length, venc.length),
        bit_valid: P(env.filter(r => r.validado_at).length, env.length),
        bit_falt: venc.length ? N(falt.length) : N(null),
      },
    }
  } else out.bit = { error: eP.bit || 'sin datos' }

  return out
}

export function calcularTodo(per, foto, fams, opts = {}) {
  const res = {}
  fams.forEach(f => { res[f.cod] = calcularUbicacion(f, per, foto, { ...opts, fams }) })
  if (fams.length > 1) {
    const total = { cod: '__total', nombre: 'Total empresa', total: true, codigos: fams.flatMap(f => f.codigos) }
    res.__total = calcularUbicacion(total, per, foto, { ...opts, fams })
  }
  return res
}

export function evaluar(def, x, metas) {
  if (!x || x.err || x.v == null) return 'nd'
  const m = metas?.[def.k] || def
  if (def.tipo === 'pct') {
    if ((x.den || 0) < MIN_N) return 'bajo'
    return x.v >= m.meta - 1e-9 ? 'ok' : x.v >= m.meta - m.tol - 1e-9 ? 'warn' : 'bad'
  }
  return x.v <= m.meta ? 'ok' : x.v <= m.meta + m.tol ? 'warn' : 'bad'
}
export function estadoArea(areaK, ar, metas) {
  if (!ar || ar.error) return 'nd'
  let peor = 'nd'
  KPIS.filter(k => k.area === areaK).forEach(d => {
    const e = evaluar(d, ar.kpis?.[d.k], metas)
    if (PESO[e] > PESO[peor]) peor = e
  })
  return peor
}
// Brecha frente a la meta en una escala 0–100 comparable entre indicadores
function brecha(def, x, m) {
  if (def.tipo === 'pct') return Math.max(0, m.meta - x.v)
  const exceso = x.v - m.meta
  return exceso <= 0 ? 0 : Math.min(100, 100 * exceso / (exceso + 2 * Math.max(1, m.tol)))
}
// "Por dónde partir": un desvío por ubicación y área; si el mismo indicador es
// crítico en 3 o más ubicaciones se muestra una sola vez como problema transversal.
export function prioridades(res, fams, metas, max = 6) {
  // 1) todos los desvíos (ámbar o rojo) de cada ubicación
  const todos = []
  fams.forEach(f => AREAS.forEach(a => {
    const ar = res?.[f.cod]?.[a.k]
    if (!ar || ar.error) return
    KPIS.filter(k => k.area === a.k).forEach(def => {
      const x = ar.kpis?.[def.k]
      const e = evaluar(def, x, metas)
      if (e === 'bad' || e === 'warn') todos.push({ fam: f.cod, famNom: f.nombre, area: a.k, kpi: def.k, est: e, brecha: brecha(def, x, metas[def.k]), x, monto: Number(x.monto) || 0, ar })
    })
  }))
  // 2) transversales: el mismo indicador en rojo en 3 o más ubicaciones va una sola vez
  const out = [], transversal = new Set()
  const porKpi = {}
  todos.filter(i => i.est === 'bad').forEach(i => { (porKpi[i.kpi] = porKpi[i.kpi] || []).push(i) })
  Object.entries(porKpi).forEach(([k, crit]) => {
    if (crit.length < 3) return
    transversal.add(k)
    const peor = [...crit].sort((a, b) => b.brecha - a.brecha)[0]
    out.push({ ...peor, famNom: `${crit.length} ubicaciones`, grupo: crit,
      brecha: crit.reduce((a, i) => a + i.brecha, 0) / crit.length, monto: crit.reduce((a, i) => a + i.monto, 0) })
  })
  // 3) por ubicación y área, el peor desvío que no sea transversal
  const mejor = {}
  todos.filter(i => !transversal.has(i.kpi)).forEach(i => {
    const k = `${i.fam}|${i.area}`, m = mejor[k]
    if (!m || PESO[i.est] > PESO[m.est] || (i.est === m.est && i.brecha > m.brecha)) mejor[k] = i
  })
  out.push(...Object.values(mejor))
  out.sort((a, b) => (PESO[b.est] - PESO[a.est]) || (b.brecha - a.brecha) || (b.monto - a.monto))
  return out.slice(0, max)
}

export const valorKpi = (def, x) => (!x || x.err) ? 'sin conexión' : x.v == null ? (x.sinComparar ? '—' : 'sin dato') : def.tipo === 'pct' ? fP(x.v) : fN(x.v)
export const detalleKpi = (def, x) => (def.tipo === 'pct' && x && !x.err && x.den > 0) ? `${fN(x.num)} de ${fN(x.den)}` : ''
const metaTxt = (def, m) => def.tipo === 'pct' ? `≥ ${fP(m.meta)}` : (m.meta === 0 ? '0' : `≤ ${fN(m.meta)}`)
export function pendienteTxt(it) {
  const def = KPI[it.kpi], x = it.x
  const base = def.tipo === 'pct' ? `${fN(x.den - x.num)} ${def.falta}` : `${fN(x.v)} ${def.falta}`
  const acum = it.ar?.kpis?.[it.area === 'mer' ? 'mer_back' : it.area === 'inv' ? 'inv_back' : '']?.acum
  return acum && !base.includes(acum) ? `${base} · ${acum}` : base
}
function tendencia(def, x, xa) {
  if (def.foto || !x || !xa || x.err || xa.err || x.v == null || xa.v == null) return null
  if (def.tipo === 'pct' && ((x.den || 0) < MIN_N || (xa.den || 0) < MIN_N)) return null
  const dif = x.v - xa.v
  if (Math.abs(dif) < 0.05) return { txt: '=', bueno: null, dif: 0 }
  const mejora = def.tipo === 'pct' ? dif > 0 : dif < 0
  return { txt: `${dif > 0 ? '▲' : '▼'}${nf1.format(Math.abs(Math.round(dif * 10) / 10))}`, bueno: mejora, dif }
}

// Bandeja de pendientes de una ubicación
const TIPO_MERMA = { segunda_seleccion: 'Segunda selección', destruccion: 'Destrucción', perdida: 'Pérdida', conversion: 'Conversión',
  correccion_sku: 'Corrección SKU', ajuste_inventario: 'Ajuste inventario', uso_interno: 'Uso interno', traslado: 'Traslado', ajuste: 'Ajuste', sin_clasificar: 'Sin clasificar' }
const ESTADO_PICK = { pendiente: 'Pendiente', asignada: 'Asignada', en_picking: 'En picking', lista: 'Lista', despachada: 'En ruta' }
const ETAPA_REPO = { solicitado: 'Solicitada', analisis: 'En preparación', cd_valida: 'Validación CD', suc_confirma: 'Por confirmar tienda', despachado: 'Despachada' }
const TIPO_SOL = { normal: 'Normal', extraordinaria: 'Urgente', lateral: 'Lateral', lateral_directo: 'Lateral directa', traspaso_interno: 'Traspaso interno', venta_directa: 'Venta directa' }
const modalidadTxt = o => o.modalidad_entrega === 'despacho' ? 'Despacho' : o.tipo_entrega === 'programada' ? 'Retiro programado' : 'Retiro inmediato'
const ORDEN_BANDEJA = ['mer', 'inv', 'bit', 'rec', 'repo', 'pick']

export function armarPendientes({ fam, per, foto, det, hoy = hoyCL(), ahora = Date.now() }) {
  const d = per?.datos || {}, ft = foto?.datos || {}, dt = det?.datos || {}
  const enF = r => fam.codigos.includes(r.sucursal_codigo)
  const out = []
  const add = o => out.push({ ...o, id: `${o.area}|${o.ref}` })
  ;(ft.merPend || []).filter(enF).forEach(r => add({ area: 'mer', tipo: 'Baja sin respaldo', fecha: r.fecha,
    doc: TIPO_MERMA[r.tipo] || r.tipo || '—', detalle: r.nota || '', dias: diasEntre(r.fecha, hoy), monto: Number(r.costo_total) || 0, ref: r.id, ir: ['mermas', 'pendientes'] }))
  ;(ft.ajPend || []).filter(enF).forEach(r => add({ area: 'inv', tipo: 'Ajuste de inventario sin respaldo', fecha: r.fecha, doc: r.id,
    detalle: `Falta ${r.falta || (r.estado_respaldo === 'FOLIO_SIN_DOCUMENTO' ? 'el documento del folio' : 'el respaldo')} · inventario ${r.tipo_inventario === 'GENERAL' ? 'general' : 'cíclico'}`,
    dias: diasEntre(r.fecha, hoy), monto: Number(r.dif_abs_clp) || 0, ref: r.id, ir: ['inv', 'operacion'] }))
  ;(ft.cat || []).filter(enF).filter(c => c.dias_sin_inventario == null || Number(c.dias_sin_inventario) > 90).forEach(c => add({ area: 'inv',
    tipo: 'Categoría sin contar hace más de 90 días', fecha: c.ultimo_inv || null, doc: c.categoria || '—',
    detalle: c.ultimo_inv ? `Último conteo hace ${fN(c.dias_sin_inventario)} días` : 'Nunca contada', dias: c.dias_sin_inventario ?? null, monto: null,
    ref: `${c.sucursal_codigo}-${c.categoria}`, ir: ['inv', 'planificacion'] }))
  ;(d.bit || []).filter(enF).filter(b => b.obligatorio && (b.estado_registro === 'FALTANTE' || b.estado_registro === 'SIN_ENVIAR')).forEach(b => add({ area: 'bit',
    tipo: b.estado_registro === 'SIN_ENVIAR' ? 'Bitácora creada sin enviar' : 'Día sin bitácora', fecha: b.fecha, doc: '—',
    detalle: b.responsable_nombre ? `Responsable: ${b.responsable_nombre}` : '', dias: diasEntre(b.fecha, hoy), monto: null,
    ref: `${b.sucursal_codigo}-${b.fecha}`, ir: ['bitacora', 'cumpl'] }))
  ;(d.rec || []).filter(enF).forEach(r => {
    const f = faltanSlots(r)
    if (f.length) add({ area: 'rec', tipo: 'Recepción con respaldo incompleto', fecha: r.fecha_recepcion,
      doc: [r.tipo_documento, r.numero_documento].filter(Boolean).join(' ') || '—',
      detalle: `Falta ${f.map(k => SLOT_L[k]).join(', ')}${r.proveedor ? ` · ${r.proveedor}` : ''}`,
      dias: diasEntre(r.fecha_recepcion, hoy), monto: null, ref: r.id, ir: ['rec', 'lista'] })
  })
  ;(ft.repPend || []).filter(s => fam.esCD ? repoFueraDePlazo(s, 'cd', ahora) : (enF(s) && repoFueraDePlazo(s, 'tienda', ahora))).forEach(s => {
    const f0 = fechaCL(s.hora_inicio_etapa || s.created_at)
    add({ area: 'repo', tipo: fam.esCD ? 'Solicitud fuera de SLA en el CD' : s.etapa === 'despachado' ? 'Reposición despachada sin confirmar recepción' : 'Solicitud por confirmar por la tienda',
      fecha: f0, doc: s.folio || '—',
      detalle: `${ETAPA_REPO[s.etapa] || s.etapa} · ${TIPO_SOL[s.tipo_sol] || s.tipo_sol || ''}${fam.esCD && s.sucursal_nombre ? ` · ${s.sucursal_nombre}` : ''}`,
      dias: diasEntre(f0, hoy), monto: null, ref: s.id, ir: ['repo', 'solicitudes'] })
  })
  ;(dt.sinFirma || []).forEach(o => {
    const f0 = fechaCL(o.entregada_at || o.recibida_at)
    add({ area: 'pick', tipo: 'Entrega sin respaldo firmado', fecha: f0, doc: o.folio || '—',
      detalle: `${modalidadTxt(o)} · ${o.cliente_nombre || 'sin nombre de cliente'}${o.entregado_por ? ` · entregó ${o.entregado_por}` : ''}`,
      dias: diasEntre(f0, hoy), monto: Number(o.monto_total) || 0, ref: o.id, ir: ['pick', 'respaldos'] })
  })
  ;(dt.abiertas || []).forEach(o => {
    const f0 = fechaCL(o.emitida_at)
    add({ area: 'pick', tipo: 'Orden abierta hace más de 7 días', fecha: f0, doc: o.folio || '—',
      detalle: `${ESTADO_PICK[o.estado] || o.estado} · ${modalidadTxt(o)} · ${o.cliente_nombre || 'sin nombre de cliente'}`,
      dias: diasEntre(f0, hoy), monto: Number(o.monto_total) || 0, ref: o.id, ir: ['pick', 'cola'] })
  })
  const oa = Object.fromEntries(ORDEN_BANDEJA.map((k, i) => [k, i]))
  return out.sort((a, b) => (oa[a.area] - oa[b.area]) || ((b.dias ?? -1) - (a.dias ?? -1)))
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERFAZ v2 (25-nov-2026, pedido de JP): gráfica, cada dato se explica al pasar
// el mouse y al hacer clic abre un popup con la fuente (cálculo, tablas, registros).
// ═══════════════════════════════════════════════════════════════════════════

// Lo que dice cada dato, en palabras ("1.737 de 2.014 …")
const DICE = {
  rec_bsale: 'recepciones entraron a BSALE en 1 día o menos', rec_resp: 'recepciones tienen todos sus documentos de respaldo',
  pick_otif: 'retiros inmediatos se entregaron completos en menos de 30 minutos', pick_resp: 'entregas tienen respaldo firmado',
  pick_fecha: 'despachos tienen fecha comprometida', pick_otifd: 'despachos medibles llegaron completos y a tiempo',
  pick_back: 'órdenes siguen abiertas después de 7 días',
  repo_fill: 'unidades pedidas fueron despachadas', repo_guia: 'despachos de reposición llevan guía real', repo_sla: 'solicitudes se despacharon dentro del SLA',
  repo_pend: 'solicitudes están fuera de plazo',
  mer_clas: 'bajas tienen tipo asignado', mer_resp: 'bajas tienen respaldo', mer_back: 'bajas llevan más de 3 días sin respaldo',
  inv_eri: 'líneas contadas cuadraron con el sistema', inv_resp: 'inventarios con diferencias tienen su ajuste respaldado',
  inv_back: 'inventarios siguen sin respaldo de su ajuste', inv_cob: 'categorías llevan más de 90 días sin contarse',
  bit_tiempo: 'días obligatorios tuvieron bitácora a tiempo', bit_valid: 'bitácoras enviadas están validadas por la jefatura', bit_falt: 'días obligatorios quedaron sin bitácora',
}
// De dónde sale cada dato (se muestra en el popup)
const SRC = {
  rec_bsale: ['log_recepciones', 'Recepciones con fecha de recepción en el período; cuenta las que tienen días de demora ≤ 1.'],
  rec_resp: ['log_recepciones + log_recepcion_adjuntos', 'Recepciones del período y sus adjuntos por tipo (documento proveedor, formulario, comprobante BSALE, foto de daños).'],
  pick_otif: ['v_log_otif_diario', 'Vista oficial de OTIF por día y modalidad (retiro inmediato). Es la misma de BI › Despacho.'],
  pick_resp: ['log_picking_ordenes', 'Órdenes en estado entregada que llegaron en el período; con firma = tienen respaldo firmado.'],
  pick_fecha: ['v_log_otif_diario', 'Despachos no anulados del período y cuántos no tienen fecha comprometida.'],
  pick_otifd: ['v_log_otif_diario', 'Despachos medibles (con fecha comprometida ya vencida) y cuántos cumplieron.'],
  pick_back: ['log_picking_ordenes', 'Órdenes pendientes, asignadas, en picking, listas o en ruta, sin archivar, emitidas hace más de 7 días. Foto al momento.'],
  repo_fill: ['v_cd_cumplimiento_semanal', 'Vista oficial del Cumplimiento del CD; semanas que parten dentro del período.'],
  repo_guia: ['log_solicitudes_reposicion + log_sol_despachos', 'Solicitudes del período despachadas o recibidas y la guía de cada despacho (no provisional).'],
  repo_sla: ['v_cd_cumplimiento_semanal', 'Vista oficial del Cumplimiento del CD; solicitudes despachadas dentro de su SLA.'],
  repo_pend: ['log_solicitudes_reposicion', 'Solicitudes abiertas que superaron su plazo. Foto al momento.'],
  mer_clas: ['v_log_merma_respaldo', 'Bajas de stock de BSALE con fecha en el período y su tipo.'],
  mer_resp: ['v_log_merma_respaldo', 'Bajas de stock de BSALE con fecha en el período y su estado de respaldo.'],
  mer_back: ['v_log_merma_respaldo', 'Todas las bajas en estado pendiente, de cualquier fecha. Foto al momento.'],
  inv_eri: ['v_inv_ajuste_pendiente + v_inv_resumen', 'Inventarios cerrados con fecha de conteo en el período; líneas conciliadas y líneas sin diferencia.'],
  inv_resp: ['v_inv_ajuste_pendiente', 'Inventarios cerrados del período con diferencias y el estado del respaldo de su ajuste en BSALE.'],
  inv_back: ['v_inv_ajuste_pendiente', 'Inventarios cerrados sin respaldo o con folio sin documento, de cualquier fecha. Foto al momento.'],
  inv_cob: ['v_log_cat_riesgo', 'Categorías de la bodega y días desde su último inventario. Foto al momento.'],
  bit_tiempo: ['v_log_bit_cumplimiento', 'Un registro por bodega y día obligatorio, con su estado frente al plazo.'],
  bit_valid: ['v_log_bit_cumplimiento', 'Bitácoras enviadas del período y si tienen validación de jefatura.'],
  bit_falt: ['v_log_bit_cumplimiento', 'Días obligatorios vencidos sin bitácora enviada.'],
}
const NOM_SUC = { ...NOMBRE_CORTO, la_bodega: 'Los Ángeles (bodega)' }
const nomSuc = c => NOM_SUC[c] || c || '—'
const ESTADO_BIT = { A_TIEMPO: 'Enviada a tiempo', TARDIO: 'Enviada tarde', FALTANTE: 'Sin bitácora', SIN_ENVIAR: 'Creada sin enviar', EN_PLAZO: 'Aún en plazo', EXCUSADO: 'Día exceptuado' }
const RESP_INV = { RESPALDADO: 'Respaldado', SIN_RESPALDO: 'Sin respaldo', SIN_AJUSTE: 'Sin diferencias', FOLIO_SIN_DOCUMENTO: 'Folio sin documento' }

export const frase = (def, x) => (!x || x.err) ? 'No se pudo leer la fuente.'
  : x.v == null ? (x.sinComparar ? 'Se mide al momento; no tiene comparación.' : def.sinDato ? `Sin dato: ${def.sinDato}.` : 'Sin casos en el período.')
  : def.tipo === 'pct' ? `${fN(x.num)} de ${fN(x.den)} ${DICE[def.k]}.` : `${fN(x.v)} ${DICE[def.k]}.`

// Cumplimiento de la meta, 0–100 (null si no se puede evaluar)
export function cumplimiento(def, x, metas) {
  const e = evaluar(def, x, metas)
  if (e === 'nd' || e === 'bajo') return null
  const m = metas[def.k]
  if (def.tipo === 'pct') return m.meta > 0 ? Math.max(0, Math.min(100, 100 * x.v / m.meta)) : 100
  return 100 - brecha(def, x, m)
}
// Índice de control: promedio del cumplimiento de meta de los indicadores evaluables
export function indice(r, metas, areaK) {
  let s = 0, n = 0, ok = 0, warn = 0, bad = 0
  KPIS.filter(k => !areaK || k.area === areaK).forEach(def => {
    const ar = r?.[def.area]
    if (!ar || ar.error) return
    const x = ar.kpis?.[def.k], c = cumplimiento(def, x, metas)
    if (c == null) return
    s += c; n += 1
    const e = evaluar(def, x, metas)
    if (e === 'ok') ok += 1; else if (e === 'warn') warn += 1; else bad += 1
  })
  return { v: n ? s / n : null, n, ok, warn, bad }
}
const estIndice = v => v == null ? 'nd' : v >= 90 ? 'ok' : v >= 70 ? 'warn' : 'bad'

// Registros que respaldan un dato (para el popup "Fuente")
export function fuenteDe(k, fam, per, foto, det, { hoy = hoyCL(), ahora = Date.now() } = {}) {
  const d = per?.datos || {}, ft = foto?.datos || {}, dt = det?.datos || {}
  const enF = r => fam.codigos.includes(r.sucursal_codigo)
  const persp = fam.total ? 'total' : fam.esCD ? 'cd' : 'tienda'
  const C_ = (key, label, width, extra) => ({ key, label, width, ...extra })
  const num = { align: 'right' }
  const plata = key => ({ align: 'right', render: r => `$${fN(r[key])}` })
  const cant = key => ({ align: 'right', render: r => fN(r[key]) })
  const si = b => b == null ? 'Sin dato' : b ? 'Sí' : 'No'
  const noPrimero = rows => [...rows].sort((a, b) => (a.cumple === 'No' ? 0 : 1) - (b.cumple === 'No' ? 0 : 1))
  let cols = [], rows = [], nota = '', falta = null
  switch (k) {
    case 'rec_bsale': case 'rec_resp':
      if (!d.rec) { falta = 'rec'; break }
      rows = d.rec.filter(enF).map(r => { const f = faltanSlots(r); return { id: r.id, fecha: r.fecha_recepcion, suc: nomSuc(r.sucursal_codigo),
        doc: [r.tipo_documento, r.numero_documento].filter(Boolean).join(' ') || '—', prov: r.proveedor || '—', uds: Number(r.cantidad_total) || 0,
        demora: r.dias_demora ?? '', resp: f.length ? `Falta ${f.map(s => SLOT_L[s]).join(', ')}` : 'Completo',
        cumple: k === 'rec_bsale' ? si(r.dias_demora == null ? null : Number(r.dias_demora) <= 1) : si(!f.length) } })
      cols = [C_('fecha', 'Fecha', 92, { fecha: true }), C_('suc', 'Ubicación', 120), C_('doc', 'Documento', 130), C_('prov', 'Proveedor', 210), C_('uds', 'Unidades', 84, cant('uds')),
        C_('demora', 'Días a BSALE', 96, num), C_('resp', 'Respaldo', 250), C_('cumple', 'Cumple', 76)]
      rows = noPrimero(rows); break
    case 'pick_otif': case 'pick_fecha': case 'pick_otifd': {
      if (!d.otif) { falta = 'otif'; break }
      const mod = k === 'pick_otif' ? 'retiro_inmediato' : 'despacho'
      rows = d.otif.filter(enF).filter(r => r.modalidad === mod).map((r, i) => ({ id: `${r.dia}-${r.sucursal_codigo}-${i}`, fecha: r.dia, suc: nomSuc(r.sucursal_codigo),
        total: Number(r.n_total) || 0, anul: Number(r.n_anuladas) || 0, med: Number(r.n_medibles) || 0, otif: Number(r.n_otif) || 0, sinf: Number(r.n_sin_fecha_comprometida) || 0 }))
      cols = [C_('fecha', 'Día', 92, { fecha: true }), C_('suc', 'Ubicación', 130), C_('total', 'Órdenes', 84, cant('total')), C_('anul', 'Anuladas', 84, num), C_('med', 'Medibles', 84, num),
        C_('otif', 'Completas y a tiempo', 150, num), C_('sinf', 'Sin fecha comprometida', 160, num)]
      nota = 'La vista entrega el consolidado por día; el detalle orden por orden está en BI › Despacho.'; break }
    case 'pick_resp':
      if (!dt.sinFirma) { falta = 'detalle'; break }
      rows = dt.sinFirma.map(o => ({ id: o.id, fecha: fechaCL(o.entregada_at || o.recibida_at), suc: nomSuc(o.sucursal_codigo), folio: o.folio || '—', mod: modalidadTxt(o),
        cli: o.cliente_nombre || '—', quien: o.entregado_por || '—', monto: Number(o.monto_total) || 0, cumple: 'No' }))
      cols = [C_('fecha', 'Entrega', 92, { fecha: true }), C_('suc', 'Ubicación', 120), C_('folio', 'Folio', 90), C_('mod', 'Modalidad', 130), C_('cli', 'Cliente', 220), C_('quien', 'Entregó', 150), C_('monto', 'Monto', 100, plata('monto')), C_('cumple', 'Con firma', 84)]
      nota = 'Se listan las entregas sin firma, que son las que restan al indicador.'; break
    case 'pick_back':
      if (!dt.abiertas) { falta = 'detalle'; break }
      rows = dt.abiertas.map(o => ({ id: o.id, fecha: fechaCL(o.emitida_at), suc: nomSuc(o.sucursal_codigo), folio: o.folio || '—', est: ESTADO_PICK[o.estado] || o.estado, mod: modalidadTxt(o),
        cli: o.cliente_nombre || '—', dias: diasEntre(fechaCL(o.emitida_at), hoy), monto: Number(o.monto_total) || 0 }))
      cols = [C_('fecha', 'Emitida', 92, { fecha: true }), C_('suc', 'Ubicación', 120), C_('folio', 'Folio', 90), C_('est', 'Estado', 100), C_('mod', 'Modalidad', 130), C_('cli', 'Cliente', 220), C_('dias', 'Días abierta', 96, num), C_('monto', 'Monto', 100, plata('monto'))]
      break
    case 'repo_fill': case 'repo_sla':
      if (!d.sem) { falta = 'sem'; break }
      rows = d.sem.filter(r => persp === 'tienda' ? enF(r) : true).map((r, i) => ({ id: `${r.semana}-${r.sucursal_codigo}-${i}`, fecha: r.semana, suc: nomSuc(r.sucursal_codigo), sol: Number(r.solicitudes) || 0,
        up: Number(r.u_pedidas) || 0, ud: Number(r.u_despachadas) || 0, sla: Number(r.despachadas_sla) || 0, pend: Number(r.pendientes_cd) || 0 }))
      cols = [C_('fecha', 'Semana del', 96, { fecha: true }), C_('suc', 'Destino', 130), C_('sol', 'Solicitudes', 96, num), C_('up', 'U. pedidas', 100, cant('up')), C_('ud', 'U. despachadas', 120, cant('ud')), C_('sla', 'Dentro de SLA', 110, num), C_('pend', 'Pendientes en CD', 130, num)]
      break
    case 'repo_guia':
      if (!d.repo) { falta = 'repo'; break }
      rows = d.repo.filter(s => persp === 'tienda' ? enF(s) : esFlujoCD(s)).filter(s => (s.etapa === 'despachado' || s.etapa === 'recibido') && s.tipo_sol !== 'traspaso_interno' && s.tipo_sol !== 'venta_directa')
        .map(s => ({ id: s.id, fecha: fechaCL(s.created_at), suc: nomSuc(s.sucursal_codigo), folio: s.folio || '—', etapa: s.etapa === 'recibido' ? 'Recibida' : 'Despachada', tipo: TIPO_SOL[s.tipo_sol] || s.tipo_sol || '—', cumple: si(s.guiaReal) }))
      cols = [C_('fecha', 'Creada', 92, { fecha: true }), C_('suc', 'Destino', 130), C_('folio', 'Folio', 130), C_('etapa', 'Etapa', 110), C_('tipo', 'Tipo', 110), C_('cumple', 'Guía real', 90)]
      rows = noPrimero(rows); break
    case 'repo_pend':
      if (!ft.repPend) { falta = 'repPend'; break }
      rows = ft.repPend.filter(s => persp === 'tienda' ? (enF(s) && repoFueraDePlazo(s, 'tienda', ahora)) : persp === 'cd' ? repoFueraDePlazo(s, 'cd', ahora) : (repoFueraDePlazo(s, 'tienda', ahora) || repoFueraDePlazo(s, 'cd', ahora)))
        .map(s => { const t0 = s.etapa === 'despachado' || s.etapa === 'suc_confirma' ? (s.hora_inicio_etapa || s.created_at) : s.created_at
          return { id: s.id, fecha: fechaCL(t0), suc: nomSuc(s.sucursal_codigo), folio: s.folio || '—', etapa: ETAPA_REPO[s.etapa] || s.etapa, tipo: TIPO_SOL[s.tipo_sol] || s.tipo_sol || '—', horas: Math.round((ahora - new Date(t0).getTime()) / 36e5) } })
      cols = [C_('fecha', 'Desde', 92, { fecha: true }), C_('suc', 'Destino', 130), C_('folio', 'Folio', 130), C_('etapa', 'Etapa', 150), C_('tipo', 'Tipo', 110), C_('horas', 'Horas esperando', 120, num)]
      break
    case 'mer_clas': case 'mer_resp':
      if (!d.mer) { falta = 'mer'; break }
      rows = d.mer.filter(enF).map(r => ({ id: r.id, fecha: r.fecha, suc: nomSuc(r.sucursal_codigo), tipo: TIPO_MERMA[r.tipo] || r.tipo || '—', uds: Number(r.total_unidades) || 0, costo: Number(r.costo_total) || 0,
        est: r.estado === 'respaldado' ? 'Respaldada' : 'Pendiente', cumple: k === 'mer_clas' ? si(!!r.tipo && r.tipo !== 'sin_clasificar') : si(r.estado === 'respaldado') }))
      cols = [C_('fecha', 'Fecha', 92, { fecha: true }), C_('suc', 'Ubicación', 130), C_('tipo', 'Tipo de baja', 150), C_('uds', 'Unidades', 84, cant('uds')), C_('costo', 'Costo', 110, plata('costo')), C_('est', 'Respaldo', 110), C_('cumple', 'Cumple', 76)]
      rows = noPrimero(rows); break
    case 'mer_back':
      if (!ft.merPend) { falta = 'merPend'; break }
      rows = ft.merPend.filter(enF).map(r => { const dias = diasEntre(r.fecha, hoy); return { id: r.id, fecha: r.fecha, suc: nomSuc(r.sucursal_codigo), tipo: TIPO_MERMA[r.tipo] || r.tipo || '—',
        costo: Number(r.costo_total) || 0, dias, nota: r.nota || '', cuenta: dias > 3 ? 'Sí' : 'No, aún en plazo' } }).sort((a, b) => b.dias - a.dias)
      cols = [C_('fecha', 'Fecha', 92, { fecha: true }), C_('suc', 'Ubicación', 130), C_('tipo', 'Tipo de baja', 150), C_('costo', 'Costo', 110, plata('costo')), C_('dias', 'Días pendiente', 110, num), C_('nota', 'Nota en BSALE', 260), C_('cuenta', 'Cuenta en el dato', 130)]
      break
    case 'inv_eri': case 'inv_resp':
      if (!d.inv) { falta = 'inv'; break }
      rows = d.inv.filter(enF).map(r => ({ id: r.id, fecha: r.fecha, suc: nomSuc(r.sucursal_codigo), inv: r.id, tipo: r.tipo_inventario === 'GENERAL' ? 'General' : 'Cíclico', conc: r.conc, cuad: r.cuad,
        eri: r.conc ? fP(100 * r.cuad / r.conc) : '—', resp: RESP_INV[r.estado_respaldo] || r.estado_respaldo || '—', abs: Number(r.dif_abs_clp) || 0 }))
      cols = [C_('fecha', 'Conteo', 92, { fecha: true }), C_('suc', 'Ubicación', 130), C_('inv', 'Inventario', 170), C_('tipo', 'Tipo', 84), C_('conc', 'Líneas contadas', 116, num), C_('cuad', 'Sin diferencia', 110, num), C_('eri', 'Exactitud', 90, num), C_('resp', 'Ajuste en BSALE', 150), C_('abs', 'Dif. absoluta $', 120, plata('abs'))]
      break
    case 'inv_back':
      if (!ft.ajPend) { falta = 'ajPend'; break }
      rows = ft.ajPend.filter(enF).map(r => ({ id: r.id, fecha: r.fecha, suc: nomSuc(r.sucursal_codigo), inv: r.id, tipo: r.tipo_inventario === 'GENERAL' ? 'General' : 'Cíclico',
        falta: r.falta ? `Falta ${r.falta}` : (RESP_INV[r.estado_respaldo] || ''), dias: diasEntre(r.fecha, hoy), abs: Number(r.dif_abs_clp) || 0 })).sort((a, b) => (b.dias || 0) - (a.dias || 0))
      cols = [C_('fecha', 'Conteo', 92, { fecha: true }), C_('suc', 'Ubicación', 130), C_('inv', 'Inventario', 170), C_('tipo', 'Tipo', 84), C_('falta', 'Qué falta', 190), C_('dias', 'Días desde el conteo', 140, num), C_('abs', 'Dif. absoluta $', 120, plata('abs'))]
      break
    case 'inv_cob':
      if (!ft.cat) { falta = 'cat'; break }
      rows = ft.cat.filter(enF).map((c, i) => ({ id: `${c.sucursal_codigo}-${c.categoria}-${i}`, suc: nomSuc(c.sucursal_codigo), cat: c.categoria || '—', fecha: c.ultimo_inv || null,
        dias: c.dias_sin_inventario ?? '', cuenta: (c.dias_sin_inventario == null || Number(c.dias_sin_inventario) > 90) ? 'Sí' : 'No' })).sort((a, b) => (a.cuenta === 'Sí' ? 0 : 1) - (b.cuenta === 'Sí' ? 0 : 1) || (Number(b.dias) || 9999) - (Number(a.dias) || 9999))
      cols = [C_('suc', 'Ubicación', 130), C_('cat', 'Categoría', 260), C_('fecha', 'Último conteo', 110, { fecha: true }), C_('dias', 'Días sin contar', 120, num), C_('cuenta', 'Cuenta en el dato', 130)]
      break
    default: // bitácora
      if (!d.bit) { falta = 'bit'; break }
      rows = d.bit.filter(enF).filter(b => b.obligatorio).map((b, i) => ({ id: `${b.sucursal_codigo}-${b.fecha}-${i}`, fecha: b.fecha, suc: nomSuc(b.sucursal_codigo), est: ESTADO_BIT[b.estado_registro] || b.estado_registro,
        resp: b.responsable_nombre || '—', val: b.validado_at ? 'Sí' : (b.estado_registro === 'A_TIEMPO' || b.estado_registro === 'TARDIO') ? 'No' : '—' }))
      cols = [C_('fecha', 'Día', 92, { fecha: true }), C_('suc', 'Bodega', 130), C_('est', 'Estado frente al plazo', 180), C_('resp', 'Responsable', 200), C_('val', 'Validada', 84)]
  }
  return { tablas: SRC[k]?.[0] || '', como: SRC[k]?.[1] || '', cols, rows, nota, falta }
}

// Series por día para los gráficos de la vista local
export function seriesDe(fam, per, p) {
  const d = per?.datos || {}
  const enF = r => fam.codigos.includes(r.sucursal_codigo)
  const dias = []
  for (let f = p.desde; f <= p.hasta; f = sumDias(f, 1)) dias.push(f)
  const por = (rows, campoF, val) => { const m = {}; (rows || []).filter(enF).forEach(r => { m[r[campoF]] = (m[r[campoF]] || 0) + val(r) }); return dias.map(f => ({ f, v: m[f] || 0 })) }
  const bit = {}; (d.bit || []).filter(enF).filter(b => b.obligatorio).forEach(b => { bit[b.fecha] = b.estado_registro })
  return {
    ordenes: por(d.otif, 'dia', r => (Number(r.n_total) || 0) - (Number(r.n_anuladas) || 0)),
    mermas: por(d.mer, 'fecha', r => Number(r.costo_total) || 0),
    bit: dias.map(f => ({ f, e: bit[f] || null })),
  }
}

// ── Estilos base ─────────────────────────────────────────────────────────────
const EST_OSC = { ok: '#3DDC84', warn: '#FFB547', bad: '#FF6B5E', nd: '#8A93A6', bajo: '#8A93A6' }
const HERO = 'linear-gradient(135deg,#101A33 0%,#16213E 45%,#243561 100%)'
const caja = { background: '#fff', border: `1px solid ${C.borde}`, borderRadius: 12, marginBottom: 14 }
const cabCaja = { display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 16px 8px', flexWrap: 'wrap' }
const tituloCaja = { fontSize: 15, fontWeight: 800, color: C.navy, letterSpacing: -0.2 }
const notaCaja = { fontSize: 12, color: C.slate }
const sub = { fontSize: 11.5, color: C.slate, fontWeight: 400 }
const btnLink = { border: 'none', background: 'none', color: '#175CD3', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: 0, minHeight: 0, fontFamily: FONT }
const selectCh = { fontSize: 12.5, fontWeight: 600, color: C.navy, border: `1px solid ${C.borde}`, borderRadius: 8, padding: '5px 9px', background: '#fff', minHeight: 0, fontFamily: FONT, cursor: 'pointer' }
const tabla = { width: '100%', borderCollapse: 'collapse' }
const th = { padding: '7px 10px', fontSize: 11.5, fontWeight: 600, color: C.slate, textAlign: 'left', borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }
const td = { padding: '7px 10px', fontSize: 12.5, color: C.ink, borderBottom: '1px solid #F1F2F4', verticalAlign: 'top', wordBreak: 'break-word' }
const tdR = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

const Ctx = createContext(null)

function Punto({ est, size = 9, osc }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size, borderRadius: 3, background: (osc ? EST_OSC : Object.fromEntries(Object.entries(EST).map(([k, v]) => [k, v.c])))[est] || C.gris, flexShrink: 0 }} />
}

// Todo dato interactivo pasa por aquí: mouse encima = explicación; clic = fuente
function Dato({ info, children, style, block }) {
  const { tipOn, tipOff, abrir } = useContext(Ctx)
  const Tag = block ? 'div' : 'span'
  return (
    <Tag role="button" tabIndex={0} className="pco-dato" style={style}
      aria-label={info.tipo === 'indice' ? `Índice de control de ${info.fam.nombre}: ver cómo se calcula` : `${KPI[info.k].l} de ${info.fam.nombre}: ver la fuente`}
      onMouseEnter={e => tipOn(e, info)} onMouseMove={e => tipOn(e, info)} onMouseLeave={tipOff}
      onFocus={e => { const r = e.currentTarget.getBoundingClientRect(); tipOn({ clientX: r.left + 20, clientY: r.bottom }, info) }} onBlur={tipOff}
      onClick={e => { e.stopPropagation(); tipOff(); abrir(info) }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); tipOff(); abrir(info) } }}>
      {children}
    </Tag>
  )
}

function Anillo({ v, size = 120, grosor = 11, osc, etiqueta }) {
  const r = (size - grosor) / 2, c = 2 * Math.PI * r, e = estIndice(v)
  const col = osc ? EST_OSC[e] : EST[e].c
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Índice de control ${v == null ? 'sin dato' : Math.round(v)} de 100`} style={{ display: 'block', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={osc ? 'rgba(255,255,255,0.14)' : '#EDEFF3'} strokeWidth={grosor} />
      {v != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={grosor} strokeLinecap="round"
        strokeDasharray={`${c * Math.max(0.5, v) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      <text x="50%" y={etiqueta ? '47%' : '52%'} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.3} fontWeight="800" fill={osc ? '#fff' : C.navy} fontFamily={FONT}>{v == null ? '—' : Math.round(v)}</text>
      {etiqueta && <text x="50%" y="68%" textAnchor="middle" fontSize={size * 0.095} fill={osc ? 'rgba(255,255,255,0.7)' : C.slate} fontFamily={FONT}>{etiqueta}</text>}
    </svg>
  )
}

// Barra con marca de meta: se ve cuánto falta sin leer el número
function Barra({ def, x, metas, alto = 7, osc }) {
  const e = evaluar(def, x, metas), m = metas[def.k]
  const col = (osc ? EST_OSC[e] : EST[e].c)
  const fondo = osc ? 'rgba(255,255,255,0.14)' : '#EDEFF3'
  if (def.tipo !== 'pct') {
    const exc = x && x.v != null ? Math.min(100, brecha(def, x, m)) : 0
    return <div style={{ height: alto, borderRadius: alto, background: fondo, overflow: 'hidden' }}><div style={{ width: `${exc}%`, height: '100%', background: col, borderRadius: alto }} /></div>
  }
  const v = x && x.v != null ? Math.max(0, Math.min(100, x.v)) : 0
  return (
    <div style={{ position: 'relative', height: alto, borderRadius: alto, background: fondo }}>
      <div style={{ width: `${v}%`, height: '100%', background: col, borderRadius: alto, minWidth: x && x.v != null ? 3 : 0 }} />
      <div title="" style={{ position: 'absolute', top: -3, bottom: -3, left: `calc(${Math.min(100, m.meta)}% - 1px)`, width: 2, background: osc ? '#fff' : C.navy, borderRadius: 1, opacity: 0.75 }} />
    </div>
  )
}

function Tend({ t, def }) {
  if (!t) return null
  if (t.dif === 0) return <span style={{ fontSize: 11, color: C.gris }}>= igual que el mes anterior</span>
  return <span style={{ fontSize: 11, fontWeight: 700, color: t.bueno ? C.verde : C.rojo }}>{t.dif > 0 ? '▲' : '▼'} {nf1.format(Math.abs(Math.round(t.dif * 10) / 10))}{def.tipo === 'pct' ? ' pts' : ''}</span>
}

// Una línea de indicador: punto, nombre, valor, barra y frase que lo explica
function FilaKpi({ def, fam, ar, ara, metas, compacta }) {
  const x = ar?.kpis?.[def.k], xa = ara?.kpis?.[def.k]
  const e = evaluar(def, x, metas), t = tendencia(def, x, xa)
  return (
    <Dato block info={{ tipo: 'kpi', k: def.k, fam, x, xa }} style={{ padding: compacta ? '5px 8px' : '9px 12px', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: compacta ? 12 : 13, color: C.ink, fontWeight: 600, flex: 1, minWidth: 0 }}>{compacta ? def.c : def.l}</span>
        {!compacta && <Tend t={t} def={def} />}
        <span style={{ fontSize: compacta ? 14 : 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: e === 'nd' || e === 'bajo' ? C.gris : EST[e].c, whiteSpace: 'nowrap' }}>{valorKpi(def, x)}</span>
      </div>
      <div style={{ margin: compacta ? '4px 0 0' : '6px 0 5px' }}><Barra def={def} x={x} metas={metas} alto={compacta ? 5 : 7} /></div>
      {!compacta && <div style={{ fontSize: 11.5, color: C.slate, lineHeight: 1.45 }}>
        {e === 'bajo' ? `${frase(def, x)} Son muy pocos casos para evaluar.` : frase(def, x)}{x?.acum ? ` En total: ${x.acum}.` : ''} <span style={{ color: C.gris }}>Meta {metaTxt(def, metas[def.k])}.</span>
      </div>}
    </Dato>
  )
}

// ── Explicación flotante ─────────────────────────────────────────────────────
function Tip({ tip, metas }) {
  if (!tip) return null
  const { x, y, info } = tip
  const W = typeof window !== 'undefined' ? window.innerWidth : 1600, H = typeof window !== 'undefined' ? window.innerHeight : 900
  const pos = { left: Math.max(8, Math.min(x + 16, W - 348)), ...(y > H * 0.62 ? { bottom: H - y + 14 } : { top: y + 18 }) }
  const base = { position: 'fixed', zIndex: 4000, width: 332, pointerEvents: 'none', background: '#0F1830', color: '#fff', borderRadius: 12, padding: '12px 14px', boxShadow: '0 12px 36px rgba(10,16,34,0.35)', fontFamily: FONT, ...pos }
  const fila = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '3px 0', color: 'rgba(255,255,255,0.78)' }
  if (info.tipo === 'indice') {
    const i = info.ind
    return (
      <div style={base} role="tooltip">
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.65)' }}>{info.fam.nombre}{info.area ? ` · ${AREA[info.area].l}` : ''}</div>
        <div style={{ fontSize: 14, fontWeight: 800, margin: '2px 0 6px' }}>Índice de control: {i.v == null ? 'sin dato' : `${Math.round(i.v)} de 100`}</div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: 'rgba(255,255,255,0.85)' }}>Resume qué tan cerca de su meta están los indicadores{info.area ? ' de esta área' : ''}. 100 significa todo en meta.</div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', margin: '8px 0 4px' }} />
        <div style={fila}><span>Indicadores evaluados</span><b style={{ color: '#fff' }}>{i.n}</b></div>
        <div style={fila}><span><Punto est="ok" osc /> En meta</span><b style={{ color: '#fff' }}>{i.ok}</b></div>
        <div style={fila}><span><Punto est="warn" osc /> Bajo meta</span><b style={{ color: '#fff' }}>{i.warn}</b></div>
        <div style={fila}><span><Punto est="bad" osc /> Críticos</span><b style={{ color: '#fff' }}>{i.bad}</b></div>
        <div style={{ fontSize: 11, color: '#9DB4FF', marginTop: 6 }}>Clic para ver indicador por indicador</div>
      </div>
    )
  }
  const def = KPI[info.k], xx = info.x, e = evaluar(def, xx, metas), t = tendencia(def, xx, info.xa)
  return (
    <div style={base} role="tooltip">
      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.65)' }}>{info.fam.nombre} · {AREA[def.area].l}</div>
      <div style={{ fontSize: 14, fontWeight: 800, margin: '2px 0 2px' }}>{def.l}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '2px 0 6px' }}>
        <span style={{ fontSize: 26, fontWeight: 800, color: EST_OSC[e], fontVariantNumeric: 'tabular-nums' }}>{valorKpi(def, xx)}</span>
        <span style={{ fontSize: 12, color: EST_OSC[e], fontWeight: 700 }}>{EST[e].l}</span>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{frase(def, xx)}{xx?.acum ? ` En total: ${xx.acum}.` : ''}</div>
      <div style={{ margin: '8px 0 6px' }}><Barra def={def} x={xx} metas={metas} osc /></div>
      <div style={fila}><span>Meta</span><b style={{ color: '#fff' }}>{metaTxt(def, metas[def.k])}</b></div>
      {t && <div style={fila}><span>Mismo corte del mes anterior</span><b style={{ color: t.bueno == null ? '#fff' : t.bueno ? EST_OSC.ok : EST_OSC.bad }}>{valorKpi(def, info.xa)} ({t.dif === 0 ? 'igual' : `${fDelta(t.dif)}${def.tipo === 'pct' ? ' pts' : ''}`})</b></div>}
      <div style={{ fontSize: 11.5, lineHeight: 1.45, color: 'rgba(255,255,255,0.7)', marginTop: 6 }}>{def.def}</div>
      <div style={{ fontSize: 11, color: '#9DB4FF', marginTop: 6 }}>Clic para ver la fuente y los registros</div>
    </div>
  )
}

// ── Popup "Fuente del dato" ──────────────────────────────────────────────────
function Fuente({ sel, onCerrar, onCambiar, res, resAnt, metas, alcance, per, foto, p, onIr, esGlobal }) {
  const { fam } = sel
  const [det, setDet] = useState(null)
  const necesitaDet = sel.tipo === 'kpi' && (sel.k === 'pick_resp' || sel.k === 'pick_back')
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCerrar])
  useEffect(() => {
    if (!necesitaDet) return undefined
    let vivo = true
    setDet(null)
    cargarDetalle(fam, p).then(r => { if (vivo) setDet(r) }).catch(() => { if (vivo) setDet({ datos: {}, errores: { detalle: 'no respondió' } }) })
    return () => { vivo = false }
  }, [necesitaDet, fam.cod, p.desde, p.hasta]) // eslint-disable-line react-hooks/exhaustive-deps
  const r = res?.[fam.cod], ra = resAnt?.[fam.cod]
  const fondo = { position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(12,18,36,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto', fontFamily: FONT }
  const panel = { background: '#fff', borderRadius: 16, width: 'min(1120px, 100%)', boxShadow: '0 24px 64px rgba(10,16,34,0.4)', overflow: 'hidden' }
  const cerrar = <button onClick={onCerrar} aria-label="Cerrar" style={{ border: 'none', background: 'rgba(255,255,255,0.14)', color: '#fff', borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: 'pointer', minHeight: 0 }}>✕</button>
  const dato = { fontSize: 11.5, color: C.slate }, datoV = { fontSize: 13, color: C.ink, fontWeight: 600, marginTop: 2, lineHeight: 1.45 }

  if (sel.tipo === 'indice') {
    const ind = indice(r, metas, sel.area)
    const defs = KPIS.filter(k => !sel.area || k.area === sel.area)
    return (
      <div style={fondo} onClick={onCerrar} role="dialog" aria-modal="true" aria-label="Cómo se calcula el índice de control">
        <div style={panel} onClick={e => e.stopPropagation()}>
          <div style={{ background: HERO, color: '#fff', padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 18 }}>
            <Anillo v={ind.v} size={92} grosor={9} osc />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{fam.nombre}{sel.area ? ` · ${AREA[sel.area].l}` : ''}</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>Índice de control</div>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.82)', marginTop: 3, lineHeight: 1.5 }}>Promedio del cumplimiento de meta de {ind.n} indicadores evaluables: {ind.ok} en meta, {ind.warn} bajo meta y {ind.bad} críticos. Un porcentaje cumple en proporción a su meta; un conteo baja a medida que se aleja de cero.</div>
            </div>
            {cerrar}
          </div>
          <div style={{ padding: '6px 14px 16px', overflowX: 'auto' }}>
            <table style={tabla}>
              <thead><tr><th style={th}>Área</th><th style={th}>Indicador</th><th style={{ ...th, textAlign: 'right' }}>Valor</th><th style={{ ...th, textAlign: 'right' }}>Meta</th><th style={{ ...th, width: 220 }}>Cumplimiento de la meta</th><th style={th}></th></tr></thead>
              <tbody>{defs.map(def => {
                const x = r?.[def.area]?.kpis?.[def.k], e = evaluar(def, x, metas), c = cumplimiento(def, x, metas)
                return (
                  <tr key={def.k}>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: C.slate }}>{AREA[def.area].l}</td>
                    <td style={td}><span style={{ display: 'inline-flex', gap: 7, alignItems: 'center' }}><Punto est={e} /><b>{def.l}</b></span><div style={{ ...sub, paddingLeft: 16 }}>{frase(def, x)}</div></td>
                    <td style={{ ...tdR, fontWeight: 800, color: e === 'nd' || e === 'bajo' ? C.gris : EST[e].c }}>{valorKpi(def, x)}</td>
                    <td style={{ ...tdR, color: C.slate }}>{metaTxt(def, metas[def.k])}</td>
                    <td style={td}>{c == null ? <span style={sub}>No entra al índice ({e === 'bajo' ? 'pocos casos' : 'sin dato'})</span>
                      : <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ flex: 1, height: 7, borderRadius: 7, background: '#EDEFF3' }}><div style={{ width: `${c}%`, height: '100%', borderRadius: 7, background: EST[e].c, minWidth: 3 }} /></div><b style={{ fontSize: 12, width: 30, textAlign: 'right' }}>{Math.round(c)}</b></div>}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}><button style={btnLink} onClick={() => onCambiar({ tipo: 'kpi', k: def.k, fam, x, xa: ra?.[def.area]?.kpis?.[def.k] })}>Ver fuente</button></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  const def = KPI[sel.k]
  const x = r?.[def.area]?.kpis?.[def.k] ?? sel.x, xa = ra?.[def.area]?.kpis?.[def.k] ?? sel.xa
  const e = evaluar(def, x, metas), t = tendencia(def, x, xa)
  const f = fuenteDe(sel.k, fam, per, foto, det)
  const cargandoDet = necesitaDet && !det
  const comp = alcance.length > 1 ? alcance.map(a => ({ a, x: res?.[a.cod]?.[def.area]?.kpis?.[def.k] })) : []
  const maxN = Math.max(1, ...comp.map(c => (def.tipo === 'n' && c.x?.v) || 0))
  return (
    <div style={fondo} onClick={onCerrar} role="dialog" aria-modal="true" aria-label={`Fuente del dato: ${def.l}`}>
      <div style={panel} onClick={ev => ev.stopPropagation()}>
        <div style={{ background: HERO, color: '#fff', padding: '18px 22px', display: 'flex', alignItems: 'flex-start', gap: 18 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>Fuente del dato · {fam.nombre} · {AREA[def.area].l}</div>
            <div style={{ fontSize: 20, fontWeight: 800, margin: '2px 0 6px' }}>{def.l}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, color: EST_OSC[e], fontVariantNumeric: 'tabular-nums' }}>{valorKpi(def, x)}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: EST_OSC[e] }}>{EST[e].l}</span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>{frase(def, x)}</span>
            </div>
            <div style={{ maxWidth: 520, marginTop: 10 }}><Barra def={def} x={x} metas={metas} osc alto={8} /></div>
          </div>
          {cerrar}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '14px 22px', padding: '16px 22px 6px' }}>
          <div><div style={dato}>Cómo se calcula</div><div style={datoV}>{def.def}</div></div>
          <div><div style={dato}>De dónde sale</div><div style={datoV}><code style={{ fontSize: 12, background: C.tinte, padding: '1px 5px', borderRadius: 4 }}>{f.tablas}</code><div style={{ fontWeight: 400, color: C.slate, fontSize: 12, marginTop: 4 }}>{f.como}</div></div></div>
          <div><div style={dato}>Período y alcance</div><div style={datoV}>{def.foto ? `Foto al momento (${fDMA(hoyCL())})` : `${fDMA(p.desde)} al ${fDMA(p.hasta)}`}<div style={{ fontWeight: 400, color: C.slate, fontSize: 12, marginTop: 4 }}>{fam.total ? 'Todas las ubicaciones' : fam.codigos.map(nomSuc).join(' + ')}</div></div></div>
          <div><div style={dato}>Meta y comparación</div><div style={datoV}>Meta {metaTxt(def, metas[def.k])} · tolerancia {def.tipo === 'pct' ? `${fN(metas[def.k].tol)} pts` : fN(metas[def.k].tol)}
            <div style={{ fontWeight: 400, color: C.slate, fontSize: 12, marginTop: 4 }}>{def.foto ? 'Sin comparación: es una foto.' : t ? <>Mes anterior al mismo corte: {valorKpi(def, xa)} <Tend t={t} def={def} /></> : 'Sin comparación disponible.'}</div></div></div>
        </div>
        {comp.length > 0 && !fam.total && (
          <div style={{ padding: '10px 22px 4px' }}>
            <div style={dato}>Comparación entre ubicaciones</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr max-content', gap: '6px 12px', alignItems: 'center', marginTop: 6 }}>
              {comp.map(({ a, x: cx }) => { const ce = evaluar(def, cx, metas); const w = cx?.v == null ? 0 : def.tipo === 'pct' ? Math.min(100, cx.v) : 100 * cx.v / maxN
                return [
                  <span key={`${a.cod}n`} style={{ fontSize: 12.5, fontWeight: a.cod === fam.cod ? 800 : 500, color: a.cod === fam.cod ? C.navy : C.ink }}>{a.nombre}</span>,
                  <div key={`${a.cod}b`} style={{ height: 10, borderRadius: 10, background: '#EDEFF3' }}><div style={{ width: `${w}%`, height: '100%', borderRadius: 10, background: EST[ce].c, minWidth: cx?.v != null ? 3 : 0, opacity: a.cod === fam.cod ? 1 : 0.55 }} /></div>,
                  <b key={`${a.cod}v`} style={{ fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{valorKpi(def, cx)}</b>,
                ] })}
            </div>
          </div>
        )}
        <div style={{ padding: '12px 22px 20px' }}>
          {f.falta && !cargandoDet ? <div style={{ fontSize: 12.5, color: C.rojo }}>No se pudieron leer los registros de esta fuente. Usa Actualizar e inténtalo de nuevo.</div> : (
            <div style={{ height: 360 }}>
              <DataGrid title="Registros que respaldan el dato" columns={f.cols.length ? f.cols : [{ key: 'id', label: 'Registro' }]} rows={cargandoDet ? [] : f.rows} getRowId={row => row.id}
                loading={cargandoDet} exportName={`fuente_${sel.k}_${fam.cod}_${p.ym}`} emptyText="Sin registros en el período." />
            </div>
          )}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            {f.nota && <span style={sub}>{f.nota}</span>}
            {onIr && <button style={{ ...btnLink, marginLeft: 'auto' }} onClick={() => { onCerrar(); onIr(...AREA[def.area].ir) }}>Ir a {AREA[def.area].mod} para gestionarlo</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
const fDMA = f => f ? `${f.slice(8, 10)}-${f.slice(5, 7)}-${f.slice(0, 4)}` : ''

// ── Gráficos por día (vista local) ───────────────────────────────────────────
function BarrasDia({ serie, color, fmt, titulo, total }) {
  const { tipTxt, tipOff } = useContext(Ctx)
  const max = Math.max(1, ...serie.map(s => s.v)), n = serie.length || 1
  return (
    <div style={{ flex: '1 1 220px', minWidth: 200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>{titulo}</span><b style={{ fontSize: 15, color: '#fff' }}>{total}</b>
      </div>
      <svg viewBox={`0 0 ${n * 10} 46`} preserveAspectRatio="none" style={{ width: '100%', height: 54, display: 'block' }} role="img" aria-label={titulo}>
        {serie.map((s, i) => { const h = Math.max(s.v > 0 ? 2 : 0.6, 44 * s.v / max)
          return <rect key={s.f} x={i * 10 + 1.5} y={45 - h} width={7} height={h} rx={1.5} fill={s.v > 0 ? color : 'rgba(255,255,255,0.18)'}
            onMouseEnter={e => tipTxt(e, `${fDMA(s.f)}`, fmt(s.v))} onMouseMove={e => tipTxt(e, `${fDMA(s.f)}`, fmt(s.v))} onMouseLeave={tipOff} /> })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}><span>{serie[0] ? Number(serie[0].f.slice(8)) : ''}</span><span>{serie[n - 1] ? Number(serie[n - 1].f.slice(8)) : ''}</span></div>
    </div>
  )
}
function CalBitacora({ serie }) {
  const { tipTxt, tipOff } = useContext(Ctx)
  const col = { A_TIEMPO: EST_OSC.ok, TARDIO: EST_OSC.warn, FALTANTE: EST_OSC.bad, SIN_ENVIAR: EST_OSC.bad, EN_PLAZO: 'rgba(255,255,255,0.45)' }
  const aT = serie.filter(s => s.e === 'A_TIEMPO').length, ob = serie.filter(s => s.e && s.e !== 'EN_PLAZO').length
  return (
    <div style={{ flex: '1 1 240px', minWidth: 220 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>Bitácora día por día</span><b style={{ fontSize: 15, color: '#fff' }}>{ob ? `${aT} de ${ob} a tiempo` : 'sin días'}</b>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {serie.map(s => <span key={s.f} onMouseEnter={e => tipTxt(e, fDMA(s.f), s.e ? ESTADO_BIT[s.e] : 'Día no obligatorio')} onMouseMove={e => tipTxt(e, fDMA(s.f), s.e ? ESTADO_BIT[s.e] : 'Día no obligatorio')} onMouseLeave={tipOff}
          style={{ width: 19, height: 19, borderRadius: 5, fontSize: 9.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: s.e ? col[s.e] : 'transparent', border: s.e ? 'none' : '1px dashed rgba(255,255,255,0.25)', color: s.e ? '#0F1830' : 'rgba(255,255,255,0.4)' }}>{Number(s.f.slice(8))}</span>)}
      </div>
    </div>
  )
}

// ── Vista global ─────────────────────────────────────────────────────────────
function HeroGlobal({ res, resAnt, fams, metas, onAbrir }) {
  const total = { cod: '__total', nombre: 'Total empresa', total: true, codigos: fams.flatMap(f => f.codigos) }
  const it = indice(res.__total, metas), ita = resAnt ? indice(resAnt.__total, metas) : null
  return (
    <section style={{ background: HERO, borderRadius: 16, padding: '22px 24px', marginBottom: 14, color: '#fff', display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: '1 1 340px', minWidth: 300 }}>
        <Dato info={{ tipo: 'indice', fam: total, ind: it }} style={{ borderRadius: 999 }}><Anillo v={it.v} size={148} grosor={13} osc etiqueta="de 100" /></Dato>
        <div>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)' }}>Índice de control · toda la operación</div>
          <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: -0.4, lineHeight: 1.15, margin: '4px 0 8px' }}>{it.bad} {it.bad === 1 ? 'indicador crítico' : 'indicadores críticos'} de {it.n}</div>
          <div style={{ display: 'flex', gap: 14, fontSize: 12.5, color: 'rgba(255,255,255,0.85)', flexWrap: 'wrap' }}>
            <span><Punto est="ok" osc /> {it.ok} en meta</span><span><Punto est="warn" osc /> {it.warn} bajo meta</span><span><Punto est="bad" osc /> {it.bad} críticos</span>
          </div>
          {ita && ita.v != null && it.v != null && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 8 }}>Sin las fotos al momento, el mes anterior al mismo corte iba en {Math.round(ita.v)}.</div>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(4, fams.length)}, minmax(170px, 1fr))`, gap: 12, flex: '3 1 720px' }} className="pco-ubics">
        {fams.map(f => { const i = indice(res[f.cod], metas)
          return (
            <div key={f.cod} style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: '14px 14px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Dato info={{ tipo: 'indice', fam: f, ind: i }} style={{ borderRadius: 999 }}><Anillo v={i.v} size={66} grosor={7} osc /></Dato>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{f.nombre}</div>
                  <div style={{ fontSize: 12, color: i.bad ? EST_OSC.bad : EST_OSC.ok, fontWeight: 700 }}>{i.bad ? `${i.bad} ${i.bad === 1 ? 'crítico' : 'críticos'}` : 'Sin críticos'}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, margin: '12px 0 10px' }}>
                {AREAS.map(a => { const ia = indice(res[f.cod], metas, a.k); const e = estIndice(ia.v)
                  return <Dato key={a.k} info={{ tipo: 'indice', fam: f, ind: ia, area: a.k }} style={{ borderRadius: 6, display: 'block' }}>
                    <span style={{ display: 'block', height: 26, borderRadius: 6, background: e === 'nd' ? 'rgba(255,255,255,0.12)' : EST_OSC[e], opacity: e === 'nd' ? 1 : 0.92 }} />
                    <span style={{ display: 'block', fontSize: 9.5, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 3 }}>{a.l.slice(0, 4)}.</span>
                  </Dato> })}
              </div>
              <button onClick={() => onAbrir(f.cod)} style={{ width: '100%', border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#fff', borderRadius: 8, padding: '6px 0', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', minHeight: 0, fontFamily: FONT }}>Ver {f.nombre}</button>
            </div>
          ) })}
      </div>
    </section>
  )
}

function Prioridades({ items, metas, fams, onAbrir }) {
  if (!items.length) return <section style={{ ...caja, padding: '14px 16px', fontSize: 13, color: C.slate }}>Todos los indicadores están en meta en el período.</section>
  return (
    <section style={caja}>
      <div style={cabCaja}><span style={tituloCaja}>Por dónde partir</span><span style={notaCaja}>Los desvíos más grandes frente a la meta. Pasa el mouse para la explicación; clic en el número para ver la fuente.</span></div>
      <div className="pco-prios" style={{ padding: '4px 14px 14px' }}>
        {items.map((it, i) => {
          const def = KPI[it.kpi], fam = fams.find(f => f.cod === it.fam)
          return (
            <div key={`${it.fam}-${it.kpi}-${i}`} style={{ border: `1px solid ${C.borde}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, borderTop: `3px solid ${EST[it.est].c}` }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#C9CDD4', lineHeight: 1, width: 22 }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: C.slate }}>{it.famNom} · {AREA[it.area].l}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.navy, margin: '1px 0 6px' }}>{def.l}</div>
                {it.grupo ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {it.grupo.map(g => { const gf = fams.find(f => f.cod === g.fam)
                      return <Dato key={g.fam} info={{ tipo: 'kpi', k: g.kpi, fam: gf, x: g.x }} style={{ border: `1px solid ${C.borde}`, borderRadius: 8, padding: '4px 9px', display: 'inline-flex', gap: 7, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 11.5, color: C.slate }}>{g.famNom}</span><b style={{ fontSize: 15, color: EST[g.est].c }}>{valorKpi(def, g.x)}</b></Dato> })}
                  </div>
                ) : (
                  <Dato block info={{ tipo: 'kpi', k: it.kpi, fam, x: it.x }} style={{ borderRadius: 8, padding: '2px 4px', margin: '0 -4px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 28, fontWeight: 800, color: EST[it.est].c, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{valorKpi(def, it.x)}</span>
                      <span style={{ fontSize: 12, color: C.slate }}>meta {metaTxt(def, metas[def.k])}</span>
                    </div>
                    <div style={{ margin: '7px 0 0' }}><Barra def={def} x={it.x} metas={metas} /></div>
                  </Dato>
                )}
                <div style={{ fontSize: 12, color: C.ink, margin: '8px 0 6px', lineHeight: 1.45 }}>{it.grupo ? `Se repite en ${it.grupo.length} ubicaciones: es un problema del proceso, no de una bodega.` : `Pendiente: ${pendienteTxt(it)}.`}</div>
                <button style={btnLink} onClick={() => onAbrir(it.fam, it.area)}>Ver {it.grupo ? 'la más afectada' : it.famNom}</button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Mapa({ res, resAnt, fams, metas, onAbrir }) {
  const filas = fams.map(f => ({ f, r: res[f.cod], ra: resAnt?.[f.cod] }))
  if (res.__total) filas.push({ f: { cod: '__total', nombre: 'Total empresa', total: true, codigos: fams.flatMap(x => x.codigos) }, r: res.__total, ra: resAnt?.__total })
  return (
    <section style={caja}>
      <div style={cabCaja}><span style={tituloCaja}>Mapa de control</span><span style={notaCaja}>Cada barra muestra el valor y la raya marca la meta. Arriba, efectividad; abajo, respaldo; en la etiqueta, el control que más se desvía.</span></div>
      <div style={{ overflowX: 'auto', padding: '0 8px 10px' }}>
        <table style={{ ...tabla, minWidth: 1180 }}>
          <thead><tr><th style={{ ...th, width: 150 }}>Ubicación</th>{AREAS.map(a => <th key={a.k} style={th}>{a.l}</th>)}</tr></thead>
          <tbody>{filas.map(({ f, r, ra }) => {
            const i = indice(r, metas)
            return (
              <tr key={f.cod} style={f.total ? { background: '#FAFBFC' } : undefined}>
                <td style={{ ...td, verticalAlign: 'middle' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Dato info={{ tipo: 'indice', fam: f, ind: i }} style={{ borderRadius: 999 }}><Anillo v={i.v} size={46} grosor={5} /></Dato>
                    <div><div style={{ fontSize: 13.5, fontWeight: 800, color: C.navy }}>{f.nombre}</div>
                      {!f.total && <button style={{ ...btnLink, fontSize: 11.5 }} onClick={() => onAbrir(f.cod)}>Ver ubicación</button>}</div>
                  </div>
                </td>
                {AREAS.map(a => {
                  const ar = r?.[a.k]
                  if (!ar || ar.error) return <td key={a.k} style={{ ...td, minWidth: 170 }}><span style={{ fontSize: 12, color: C.gris }}>Sin conexión con la fuente</span></td>
                  const defs = KPIS.filter(k => k.area === a.k)
                  const flag = defs.filter(k => k.rol === 'ctrl').map(k => ({ k, e: evaluar(k, ar.kpis[k.k], metas) })).filter(z => z.e === 'bad' || z.e === 'warn').sort((p1, p2) => PESO[p2.e] - PESO[p1.e])[0]
                  return (
                    <td key={a.k} style={{ ...td, minWidth: 170, padding: '6px 4px' }}>
                      {defs.filter(k => k.rol !== 'ctrl').map(k => <FilaKpi key={k.k} def={k} fam={f} ar={ar} ara={ra?.[a.k]} metas={metas} compacta />)}
                      <div style={{ padding: '2px 8px 0', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, color: C.slate }}>{ar.vol?.txt}</span>
                        {flag && <Dato info={{ tipo: 'kpi', k: flag.k.k, fam: f, x: ar.kpis[flag.k.k], xa: ra?.[a.k]?.kpis?.[flag.k.k] }}
                          style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: EST[flag.e].c, borderRadius: 6, padding: '1px 7px' }}>{flag.k.c}: {valorKpi(flag.k, ar.kpis[flag.k.k])}</Dato>}
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </section>
  )
}

// ── Vista local ──────────────────────────────────────────────────────────────
function HeroLocal({ fam, r, ra, metas, per, p }) {
  const i = indice(r, metas), s = useMemo(() => seriesDe(fam, per, p), [fam, per, p])
  const totOrd = s.ordenes.reduce((a, x) => a + x.v, 0), totMer = s.mermas.reduce((a, x) => a + x.v, 0)
  return (
    <section style={{ background: HERO, borderRadius: 16, padding: '20px 24px', marginBottom: 14, color: '#fff', display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: '1 1 300px' }}>
        <Dato info={{ tipo: 'indice', fam, ind: i }} style={{ borderRadius: 999 }}><Anillo v={i.v} size={128} grosor={12} osc etiqueta="de 100" /></Dato>
        <div>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)' }}>Índice de control · {fam.nombre}</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1.2, margin: '4px 0 8px' }}>{i.bad ? `${i.bad} ${i.bad === 1 ? 'indicador crítico' : 'indicadores críticos'} de ${i.n}` : `Sin indicadores críticos en ${i.n}`}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {AREAS.map(a => { const ia = indice(r, metas, a.k), e = estIndice(ia.v)
              return <Dato key={a.k} info={{ tipo: 'indice', fam, ind: ia, area: a.k }} style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '3px 10px', background: 'rgba(255,255,255,0.1)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <Punto est={e} osc size={8} />{a.l}{ia.v != null ? ` ${Math.round(ia.v)}` : ''}</Dato> })}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 26, flex: '2 1 620px', flexWrap: 'wrap' }}>
        <BarrasDia serie={s.ordenes} color="#7FB2FF" titulo="Órdenes de picking por día" total={fN(totOrd)} fmt={v => `${fN(v)} órdenes`} />
        <BarrasDia serie={s.mermas} color="#FFB547" titulo="Costo de bajas por día" total={fM(totMer)} fmt={v => `${fM(v)} en bajas`} />
        <CalBitacora serie={s.bit} />
      </div>
    </section>
  )
}

function Bloque({ area, fam, ar, ara, metas, foco, onIr }) {
  const r1 = { [area.k]: ar }, ia = indice(r1, metas, area.k)
  return (
    <section id={`pco-${area.k}`} style={{ ...caja, marginBottom: 0, display: 'flex', flexDirection: 'column', boxShadow: foco ? `0 0 0 2px ${C.navy}` : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px 6px' }}>
        <Dato info={{ tipo: 'indice', fam, ind: ia, area: area.k }} style={{ borderRadius: 999 }}><Anillo v={ia.v} size={46} grosor={5} /></Dato>
        <div style={{ flex: 1, minWidth: 0 }}><div style={tituloCaja}>{area.l}</div><div style={sub}>{ar?.vol?.txt || ''}</div></div>
        {onIr && <button style={btnLink} onClick={() => onIr(...area.ir)}>Abrir {area.mod}</button>}
      </div>
      {!ar || ar.error
        ? <div style={{ padding: '10px 14px 14px', fontSize: 12.5, color: C.rojo }}>No se pudo leer la fuente{ar?.error ? `: ${ar.error}` : ''}.</div>
        : <div style={{ padding: '0 4px 8px' }}>{KPIS.filter(k => k.area === area.k).map(k => <FilaKpi key={k.k} def={k} fam={fam} ar={ar} ara={ara} metas={metas} />)}</div>}
      {area.k === 'inv' && ar && !ar.error && (ar.difNeta || ar.difAbs) ? <div style={{ ...sub, padding: '0 16px 12px', marginTop: 'auto' }}>Diferencias del período: neta {fM(ar.difNeta)} · absoluta {fM(ar.difAbs)}</div> : null}
    </section>
  )
}

function Bandeja({ filas, cargando, onIr, nombre, ym }) {
  const [filtro, setFiltro] = useState('todas')
  const cuenta = useMemo(() => { const m = {}; filas.forEach(f => { m[f.area] = (m[f.area] || 0) + 1 }); return m }, [filas])
  const vis = filtro === 'todas' ? filas : filas.filter(f => f.area === filtro)
  const cols = useMemo(() => [
    { key: 'area', label: 'Área', width: 120, value: r => AREA[r.area]?.l || r.area },
    { key: 'tipo', label: 'Pendiente', width: 260 },
    { key: 'fecha', label: 'Fecha', width: 92, fecha: true },
    { key: 'doc', label: 'Documento', width: 150 },
    { key: 'detalle', label: 'Detalle', width: 340 },
    { key: 'dias', label: 'Días', width: 64, align: 'right', value: r => r.dias ?? '' },
    { key: 'monto', label: 'Monto', width: 110, align: 'right', value: r => r.monto ?? '', render: r => r.monto ? `$${fN(r.monto)}` : '' },
  ], [])
  const chip = (k, l, n) => (
    <button key={k} onClick={() => setFiltro(k)} aria-pressed={filtro === k}
      style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '3px 11px', cursor: 'pointer', minHeight: 0, fontFamily: FONT,
        border: `1px solid ${filtro === k ? C.navy : C.borde}`, background: filtro === k ? C.navy : '#fff', color: filtro === k ? '#fff' : C.navy }}>{l} {fN(n)}</button>
  )
  return (
    <div style={{ height: 470, marginTop: 14 }}>
      <DataGrid title={`Pendientes por resolver · ${nombre}`} columns={cols} rows={vis} getRowId={r => r.id} loading={cargando}
        onRowClick={onIr ? r => onIr(...r.ir) : undefined} exportName={`pendientes_${nombre.replace(/\s+/g, '_')}_${ym}`}
        emptyText={filtro === 'todas' ? 'Sin pendientes: todo al día.' : 'Sin pendientes en esta área.'}
        toolbar={<div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{chip('todas', 'Todas', filas.length)}{ORDEN_BANDEJA.filter(k => cuenta[k]).map(k => chip(k, AREA[k].l, cuenta[k]))}</div>} />
    </div>
  )
}

function Metodo({ metas }) {
  return (
    <details style={{ ...caja, padding: '10px 16px' }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, color: C.navy, listStyle: 'none' }}>Ver cómo se calcula cada indicador y sus metas</summary>
      <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.6, margin: '8px 0' }}>
        Verde: en meta. Ámbar: bajo la meta dentro de la tolerancia. Rojo: más allá de la tolerancia. Gris: sin dato o menos de {MIN_N} casos.
        El índice de control es el promedio del cumplimiento de meta de los indicadores evaluables. Las metas se ajustan en config_sistema, clave panel_ops_metas.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={tabla}>
          <thead><tr><th style={th}>Área</th><th style={th}>Indicador</th><th style={th}>Cómo se mide</th><th style={th}>Fuente</th><th style={{ ...th, textAlign: 'right' }}>Meta</th><th style={{ ...th, textAlign: 'right' }}>Tolerancia</th></tr></thead>
          <tbody>{KPIS.map(k => (
            <tr key={k.k}>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{AREA[k.area].l}</td><td style={{ ...td, fontWeight: 600 }}>{k.l}</td><td style={{ ...td, color: C.slate }}>{k.def}</td>
              <td style={{ ...td, color: C.slate, fontSize: 11.5 }}>{SRC[k.k][0]}</td><td style={tdR}>{metaTxt(k, metas[k.k])}</td><td style={{ ...tdR, color: C.slate }}>{k.tipo === 'pct' ? `${fN(metas[k.k].tol)} pts` : fN(metas[k.k].tol)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  )
}

function VistaLocal({ fam, res, resAnt, metas, foco, per, foto, det, cargandoDet, onIr, ym, cargando, p }) {
  const r = res?.[fam.cod], ra = resAnt?.[fam.cod]
  const filas = useMemo(() => (per && foto) ? armarPendientes({ fam, per, foto, det }) : [], [fam, per, foto, det])
  useEffect(() => {
    if (!foco) return undefined
    const t = setTimeout(() => { try { document.getElementById(`pco-${foco}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* sin DOM */ } }, 80)
    return () => clearTimeout(t)
  }, [foco, fam.cod])
  if (!r) return <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: C.slate }}>{cargando ? 'Cargando indicadores…' : 'Sin datos.'}</div>
  return (
    <>
      <HeroLocal fam={fam} r={r} ra={ra} metas={metas} per={per} p={p} />
      <div className="pco-grid">{AREAS.map(a => <Bloque key={a.k} area={a} fam={fam} ar={r[a.k]} ara={ra?.[a.k]} metas={metas} foco={foco === a.k} onIr={onIr} />)}</div>
      <Bandeja filas={filas} cargando={cargando || cargandoDet} onIr={onIr} nombre={fam.nombre} ym={ym} />
    </>
  )
}

// ── Contenedor ───────────────────────────────────────────────────────────────
export function PanelControlOps({ cu, sucs = [], config = {}, onIr }) {
  const fams = useMemo(() => armarFamilias(sucs), [sucs])
  const famsKey = fams.map(f => `${f.cod}:${f.codigos.join('+')}`).join('|')
  const metas = useMemo(() => metasDe(config), [config])
  const esGlobal = cu?.rol === 'admin'
  const ctx = cu?.contexto_activo_sesion || cu?.sucursal_codigo || null
  const famPropia = fams.find(f => f.codigos.includes(ctx)) || null
  const puede = !!cu && ['admin', 'jefe_bodega', 'jefe_sucursal'].includes(cu.rol)   // solo jefaturas (decisión JP 25-nov-2026)
  const alcance = esGlobal ? fams : (famPropia ? [famPropia] : [])
  const alcanceKey = alcance.map(f => f.cod).join('|')

  const [ym, setYm] = useState(() => hoyCL().slice(0, 7))
  const [vista, setVista] = useState(esGlobal ? 'global' : famPropia?.cod || null)
  const [foco, setFoco] = useState(null)
  const [tick, setTick] = useState(0)
  const [st, setSt] = useState({ cargando: true })
  const [det, setDet] = useState({ cargando: false })
  const [tip, setTip] = useState(null)
  const [sel, setSel] = useState(null)

  useEffect(() => { setVista(esGlobal ? 'global' : famPropia?.cod || null); setFoco(null); setSel(null) }, [esGlobal, famPropia?.cod])

  useEffect(() => {
    if (!puede || !alcance.length) return undefined
    let vivo = true
    const p = periodoDe(ym)
    const codigos = esGlobal ? null : alcance.flatMap(f => f.codigos)
    const repoTotal = esGlobal || alcance.some(f => f.esCD)
    setSt({ cargando: true, p })
    ;(async () => {
      const [act, foto] = await Promise.all([cargarPeriodo(p, alcance, codigos, repoTotal), cargarFoto(alcance, codigos)])
      if (!vivo) return
      setSt({ cargando: false, p, act, foto, ts: new Date() })
      const ant = await cargarPeriodo(p.ant, alcance, codigos, repoTotal)
      if (vivo) setSt(s => (s.p === p ? { ...s, ant } : s))
    })().catch(e => { if (vivo) setSt({ cargando: false, p, error: e?.message || String(e) }) })
    return () => { vivo = false }
  }, [ym, famsKey, alcanceKey, tick, puede, esGlobal]) // eslint-disable-line react-hooks/exhaustive-deps

  const famVista = vista && vista !== 'global' ? fams.find(f => f.cod === vista) : null
  useEffect(() => {
    if (!famVista || !st.p) return undefined
    let vivo = true
    setDet({ cargando: true })
    cargarDetalle(famVista, st.p)
      .then(r => { if (vivo) setDet({ cargando: false, ...r }) })
      .catch(e => { if (vivo) setDet({ cargando: false, errores: { detalle: e?.message || String(e) } }) })
    return () => { vivo = false }
  }, [famVista?.cod, st.p?.desde, st.p?.hasta, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const opts = useMemo(() => ({ hoy: hoyCL(), ahora: Date.now() }), [st.ts]) // eslint-disable-line react-hooks/exhaustive-deps
  const res = useMemo(() => st.act ? calcularTodo(st.act, st.foto, alcance, opts) : null, [st.act, st.foto, alcanceKey, opts]) // eslint-disable-line react-hooks/exhaustive-deps
  const resAnt = useMemo(() => st.ant ? calcularTodo(st.ant, null, alcance, opts) : null, [st.ant, alcanceKey, opts]) // eslint-disable-line react-hooks/exhaustive-deps
  const prios = useMemo(() => (res && esGlobal) ? prioridades(res, alcance, metas) : [], [res, metas, esGlobal, alcanceKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const errores = { ...(st.act?.errores || {}), ...(st.foto?.errores || {}), ...(det.errores || {}) }
  const nErr = Object.keys(errores).length

  const api = useMemo(() => ({
    tipOn: (e, info) => setTip({ x: e.clientX, y: e.clientY, info }),
    tipTxt: (e, titulo, texto) => setTip({ x: e.clientX, y: e.clientY, simple: { titulo, texto } }),
    tipOff: () => setTip(null),
    abrir: info => setSel(info),
  }), [])
  const cerrarSel = useCallback(() => setSel(null), [])

  if (!cu) return <div style={{ padding: 40, textAlign: 'center', color: C.slate, fontFamily: FONT }}>Cargando…</div>
  if (!puede) return (
    <div style={{ padding: '60px 24px', textAlign: 'center', fontFamily: FONT }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Este panel es solo para las jefaturas de Logística y la dirección</div>
      <div style={{ fontSize: 13, color: C.slate }}>Si necesitas verlo, pide a un administrador que revise tu acceso a Logística.</div>
    </div>
  )
  if (!alcance.length) return (
    <div style={{ padding: '60px 24px', textAlign: 'center', fontFamily: FONT, fontSize: 13, color: C.slate }}>
      Tu acceso no tiene una ubicación asignada. Pide a un administrador que la asigne en Administración › Accesos.
    </div>
  )

  const p = st.p || periodoDe(ym)
  const comparaTxt = rangoTxt(p.ant.desde, p.ant.hasta)
  const abrir = (cod, area) => { setVista(cod); setFoco(area || null); setTip(null); try { window.scrollTo({ top: 0 }) } catch { /* sin DOM */ } }
  const H = typeof window !== 'undefined' ? window.innerHeight : 900, W = typeof window !== 'undefined' ? window.innerWidth : 1600

  return (
    <Ctx.Provider value={api}>
      <div style={{ padding: '16px 22px 40px', fontFamily: FONT, color: C.ink }}>
        <style>{`
          .pco-dato{cursor:pointer;transition:background .12s,box-shadow .12s;outline:none}
          .pco-dato:hover{background:rgba(23,92,211,0.07);box-shadow:0 0 0 1px rgba(23,92,211,0.25)}
          .pco-dato:focus-visible{box-shadow:0 0 0 2px #9DB4FF}
          .pco-grid{display:grid;gap:14px;grid-template-columns:repeat(3,minmax(0,1fr))}
          .pco-prios{display:grid;gap:12px;grid-template-columns:repeat(3,minmax(0,1fr))}
          @media(max-width:1200px){.pco-grid,.pco-prios{grid-template-columns:repeat(2,minmax(0,1fr))}.pco-ubics{grid-template-columns:repeat(2,minmax(150px,1fr))!important}}
          @media(max-width:760px){.pco-grid,.pco-prios{grid-template-columns:1fr}}
          @media(prefers-reduced-motion:reduce){.pco-dato{transition:none}}
          details > summary::-webkit-details-marker{display:none}
        `}</style>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <h1 style={{ fontSize: 19, fontWeight: 800, color: C.navy, margin: 0, letterSpacing: -0.3 }}>Panel de control de operaciones</h1>
          {esGlobal ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.slate }}>Vista
              <select value={vista || 'global'} onChange={e => abrir(e.target.value)} style={selectCh}>
                <option value="global">Global (todas las ubicaciones)</option>
                {fams.map(f => <option key={f.cod} value={f.cod}>{f.nombre}</option>)}
              </select>
            </label>
          ) : <span style={{ fontSize: 13, color: C.slate }}>Ubicación <b style={{ color: C.navy }}>{famPropia?.nombre}</b></span>}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.slate }}>Mes
            <select value={ym} onChange={e => setYm(e.target.value)} style={selectCh}>{mesesOpc().map(m => <option key={m} value={m}>{mesLargo(m)}</option>)}</select>
          </label>
          <span style={{ fontSize: 12, color: C.slate }}>{rangoTxt(p.desde, p.hasta)} · comparado con {comparaTxt}{st.ant ? '' : st.act ? ' (calculando)' : ''}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {st.ts && <span style={{ fontSize: 11.5, color: C.gris }}>Actualizado {st.ts.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>}
            {onIr && <button onClick={() => onIr('home')} style={selectCh}>Qué hacer hoy</button>}
            <button onClick={() => setTick(t => t + 1)} disabled={st.cargando} style={{ ...selectCh, cursor: st.cargando ? 'wait' : 'pointer' }}>{st.cargando ? 'Cargando…' : 'Actualizar'}</button>
          </span>
        </div>

        {esGlobal && vista !== 'global' && famVista && (
          <div style={{ marginBottom: 10 }}>
            <button style={btnLink} onClick={() => { setVista('global'); setFoco(null) }}>← Volver a la vista global</button>
            <span style={{ ...sub, marginLeft: 10 }}>Estás viendo {famVista.nombre} como la ve su jefatura.</span>
          </div>
        )}
        {st.error && <div style={{ ...caja, padding: '10px 14px', color: C.rojo, fontSize: 12.5 }}>No se pudo cargar el panel: {st.error}</div>}
        {nErr > 0 && !st.error && (
          <div style={{ ...caja, padding: '8px 14px', fontSize: 12, color: C.ambar }}>Algunas fuentes no respondieron ({Object.keys(errores).join(', ')}). Sus áreas se muestran sin dato; usa Actualizar para reintentar.</div>
        )}

        {vista === 'global' && esGlobal ? (
          res ? (<>
            <HeroGlobal res={res} resAnt={resAnt} fams={alcance} metas={metas} onAbrir={abrir} />
            <Prioridades items={prios} metas={metas} fams={alcance} onAbrir={abrir} />
            <Mapa res={res} resAnt={resAnt} fams={alcance} metas={metas} onAbrir={abrir} />
          </>) : <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: C.slate }}>{st.cargando ? 'Cargando indicadores…' : ''}</div>
        ) : famVista ? (
          <VistaLocal fam={famVista} res={res} resAnt={resAnt} metas={metas} foco={foco} per={st.act} foto={st.foto}
            det={det} cargandoDet={det.cargando} onIr={onIr} ym={ym} cargando={st.cargando} p={p} />
        ) : null}

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 10px', fontSize: 12, color: C.slate }}>
          {['ok', 'warn', 'bad', 'nd'].map(k => <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Punto est={k} />{EST[k].l}</span>)}
          <span>Raya oscura en cada barra: la meta.</span>
        </div>
        <Metodo metas={metas} />

        {tip && tip.simple && (
          <div role="tooltip" style={{ position: 'fixed', zIndex: 4000, pointerEvents: 'none', background: '#0F1830', color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontFamily: FONT,
            left: Math.max(8, Math.min(tip.x + 14, W - 200)), ...(tip.y > H * 0.7 ? { bottom: H - tip.y + 12 } : { top: tip.y + 16 }) }}>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11 }}>{tip.simple.titulo}</div><b>{tip.simple.texto}</b>
          </div>
        )}
        {tip && tip.info && !sel && <Tip tip={tip} metas={metas} />}
        {sel && res && <Fuente sel={sel} onCerrar={cerrarSel} onCambiar={setSel} res={res} resAnt={resAnt} metas={metas} alcance={alcance}
          per={st.act} foto={st.foto} p={p} onIr={onIr} esGlobal={esGlobal} />}
      </div>
    </Ctx.Provider>
  )
}

export default PanelControlOps
