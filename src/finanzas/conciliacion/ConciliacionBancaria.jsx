import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import { DataGrid } from './DataGrid'
import { fetchVinculados, fetchFacturasCandidatas, vincularRespaldo, desvincular } from './api_conciliar'
import { cargarMotor, sugerirClasificacion, aprenderClasificacion, aprenderEnMemoria, rutDeGlosa, nombreDeGlosa, UMBRAL_AUTO, historialDeRut, indicePalabras, segundaOpinion, extraerPatronDesc } from './motorClasificacion'
import { armarPlan, BuscadorSubcuenta, BuscadorCeco, normalizar } from './BuscadorCuenta'

/* ═══════════════════════════════════════════════════════════════════════
   CLASIFICAR Y CONCILIAR — banco de trabajo único (20-oct-2026)
   Reemplaza "Conciliar movimientos" y "Clasificación masiva", que trabajaban
   el mismo objeto con dos listas de centros de costo distintas.
     · Grilla de la cartola con estado por línea, selección múltiple y filtros
       por columna; panel de la línea a la derecha (patrón Xero / SAP FI-BL).
     · Un solo plan: cuenta madre › subcuenta (siempre con código) y centro de
       costo área · sede, obligatorio solo donde la cuenta madre lo exige
       (cuentas_madre.requiere_ceco). Se busca escribiendo código o nombre
       (BuscadorCuenta.jsx) y la línea se trabaja con teclado: "guardar y
       siguiente" (Ctrl+Enter) sigue el orden y los filtros de la grilla.
     · En masa: asignar a las marcadas, aceptar sugerencias, pedir a la IA,
       agrupar por RUT o glosa, aplicar automáticas (solo lo que acierta ≥97%
       medido en el historial) e importar/exportar Excel por código.
     · Cada clasificación deja su origen en clasif_origen (manual, lote, excel,
       factura, ia, motor:…, auto:…). clasif_ia vuelve a significar solo IA.
   Backend: movimientos_bancarios, conciliaciones, v_bandeja_conciliacion,
   v_tef_detalle, centros_costo (+ sede en cecos), edge clasificar-ia v2.
   ═══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', AZUL = '#1D4ED8'
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fF = f => f ? String(f).slice(0, 10) : ''
const fPct = v => String(v ?? '').replace('.', ',')
const MES_ACTUAL = new Date().toISOString().slice(0, 7)
// 'YYYY-MM' -> mes siguiente. Se usa para acotar rangos con [inicio, inicioMesSiguiente)
const mesSiguiente = m => { const [a, mm] = String(m).split('-').map(Number); return mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, '0')}` }
const MESES = (() => { const out = []; let m = '2026-01'; while (m <= MES_ACTUAL) { out.push(m); m = mesSiguiente(m) } return out })()
const MES_L = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_TXT = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mesLargo = f => { const [a, m] = String(f).slice(0, 7).split('-'); return `${(MESES_TXT[Number(m) - 1] ?? m).replace(/^./, c => c.toUpperCase())} ${a}` }

// La API entrega un máximo de filas por consulta (1.000 por defecto en Supabase). traerTodo pide
// páginas hasta que no quedan filas, avanzando por lo efectivamente recibido.
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

/* Qué necesita cada línea. Deriva del estado + tipo de respaldo + lo aplicado. */
const SITUACION = {
  sin_clasificar: { l: 'Sin clasificar', c: AMBAR,  bg: '#FFFBEB', d: 'Falta la subcuenta: no sabemos qué es' },
  por_conciliar:  { l: 'Por conciliar',  c: ROJO,   bg: '#FEF2F2', d: 'Es pago de factura y aún no tiene la factura vinculada' },
  parcial:        { l: 'Parcial',        c: AMBAR,  bg: '#FFFBEB', d: 'Tiene facturas vinculadas pero no cubren el monto' },
  conciliado:     { l: 'Conciliado',     c: VERDE,  bg: null,      d: 'Facturas vinculadas cubren el monto' },
  explicado:      { l: 'Explicado',      c: SLATE,  bg: null,      d: 'Clasificado con un respaldo que no es factura' },
  sin_tipo:       { l: 'Sin tipo',       c: AZUL,   bg: '#EFF6FF', d: 'Tiene subcuenta pero no se declaró tipo de respaldo' },
}
// Tolerancia de redondeo, la misma de v_estado_factura en la base
const TOL = 10
function situacionDe(r) {
  const monto = Math.abs(Number(r.monto) || 0)
  const aplicado = (r.conciliaciones ?? []).reduce((s, c) => s + (Number(c.monto_aplicado) || 0), 0)
  const resto = Math.max(0, monto - aplicado)
  const falta = aplicado > 0 && resto <= TOL ? 0 : resto
  if (!r.subcuenta_id) return { k: 'sin_clasificar', aplicado, pendiente: aplicado > 0 ? falta : monto, vinculada: aplicado > 0 }
  if (r.tipo_respaldo === 'factura_compra') {
    if (aplicado <= 0) return { k: 'por_conciliar', aplicado, pendiente: monto }
    if (falta === 0) return { k: 'conciliado', aplicado, pendiente: 0 }
    return { k: 'parcial', aplicado, pendiente: falta }
  }
  if (!r.tipo_respaldo) return { k: 'sin_tipo', aplicado, pendiente: 0 }
  return { k: 'explicado', aplicado, pendiente: 0 }
}

const TIPOS_RESPALDO = [
  ['factura_compra', 'Factura de compra (se concilia)'], ['liquidacion_sueldo', 'Liquidación de sueldo'], ['boleta_honorario', 'Boleta de honorarios'],
  ['credito', 'Crédito bancario'], ['arriendo', 'Arriendo'], ['gasto_bancario', 'Gasto bancario'], ['caja_chica', 'Caja chica'],
  ['caso_postventa', 'Caso postventa'], ['venta_transferencia', 'Venta por transferencia'], ['otro', 'Otro'], ['sin_respaldo', 'Sin respaldo'],
]

const CHIPS = [
  ['trabajo', 'Por trabajar'], ['sin_clasificar', 'Sin clasificar'], ['sin_ceco', 'Sin centro de costo'], ['por_conciliar', 'Por conciliar'],
  ['sugerencia', 'Con sugerencia'], ['revisar', 'A revisar'], ['conciliado', 'Conciliados'], ['todos', 'Todos'],
]
const ORIGEN_L = {
  manual: 'Manual', lote: 'En lote', excel: 'Excel', factura: 'Vínculo con factura', ia: 'IA', postventa: 'Postventa',
  'motor:regla': 'Regla', 'motor:historial_rut': 'Historial del RUT', 'motor:patron': 'Glosa parecida',
  'auto:regla': 'Regla · automática', 'auto:historial_rut': 'Historial RUT · automática', 'auto:patron': 'Glosa · automática',
}
const fuenteAOrigen = f => (f === 'regla' ? 'regla' : f === 'rut_historico' ? 'historial_rut' : f === 'patron_historico' ? 'patron' : null)

const Sec = ({ t, children, right }) => (
  <div style={{ borderTop: `1px solid ${BORDE}`, paddingTop: 10, marginTop: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.6, flex: 1 }}>{t}</div>
      {right}
    </div>
    {children}
  </div>
)
const BTN = (a, color = NAVY) => ({ fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${a ? color : BORDE}`, background: a ? color : '#fff', color: a ? '#fff' : INK, whiteSpace: 'nowrap' })
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff', width: '100%' }
const rotuloRespaldo = k => (TIPOS_RESPALDO.find(([v]) => v === k)?.[1] ?? k ?? '').replace(' (se concilia)', '')
// Tarjeta compacta de sugerencia (motor o IA): qué propone, con cuánta confianza y por qué.
const SugBox = ({ color, titulo, score, detalle, extra, onUsar, onUsarGuardar, activo }) => (
  <div style={{ fontSize: 11.5, background: '#F8FAFF', borderTop: `1px solid ${activo ? color : '#BFDBFE'}`, borderRight: `1px solid ${activo ? color : '#BFDBFE'}`,
    borderBottom: `1px solid ${activo ? color : '#BFDBFE'}`, borderLeft: `3px solid ${color}`, borderRadius: 6, padding: '6px 8px', marginBottom: 6 }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{titulo}</div>
      {score != null && <span style={{ fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{score}%</span>}
      <button onClick={onUsar} style={{ ...BTN(activo, color), padding: '1px 8px', fontSize: 10.5 }}>{activo ? 'En uso' : 'Usar'}</button>
      {onUsarGuardar && <button onClick={onUsarGuardar} title="Usa la sugerencia, guarda y pasa a la línea siguiente" style={{ ...BTN(true, color), padding: '1px 8px', fontSize: 10.5 }}>Usar y guardar</button>}
    </div>
    {detalle && <div style={{ color: SLATE, marginTop: 2 }}>{detalle}</div>}
    {extra}
  </div>
)

// El plan único (armarPlan) y los buscadores viven en BuscadorCuenta.jsx
const PLAN_VACIO = armarPlan([], [], [], [])
export { armarPlan }

/* Excel devuelto por el usuario → cambios a aplicar. Función pura (se prueba aparte). */
const normCodigo = v => { let s = String(v ?? '').trim().replace(',', '.'); if (/^\d{3}\.\d$/.test(s)) s += '0'; return s }
export function interpretarPlantilla(filasX, plan, movsPorId) {
  const items = [], errores = []
  ;(filasX ?? []).forEach((f, i) => {
    const fila = i + 2
    const id = String(f.id ?? '').trim()
    const subCod = normCodigo(f.subcuenta_codigo_nueva), ccCod = normCodigo(f.centro_costo_codigo_nuevo)
    const resp = String(f.respaldo_nuevo ?? '').trim(), mesN = String(f.mes_nominal_nuevo ?? '').trim()
    if (!id || (!subCod && !ccCod && !resp && !mesN)) return
    const mov = movsPorId?.get(id)
    if (movsPorId && !mov) { errores.push(`Fila ${fila}: el movimiento no está en la cartola cargada`); return }
    const upd = {}
    if (subCod) { const s = plan.subPorCodigo.get(subCod); if (!s) { errores.push(`Fila ${fila}: no existe la subcuenta ${subCod}`); return } upd.subcuenta_id = s.id }
    if (ccCod) { const c = plan.cecoPorCodigo.get(ccCod); if (!c) { errores.push(`Fila ${fila}: no existe el centro de costo ${ccCod}`); return } upd.ceco_id = c.id }
    if (resp) { if (!TIPOS_RESPALDO.some(([k]) => k === resp)) { errores.push(`Fila ${fila}: tipo de respaldo desconocido (${resp})`); return } upd.tipo_respaldo = resp }
    if (mesN) { const n = Number(mesN); if (!(n >= 1 && n <= 12)) { errores.push(`Fila ${fila}: el mes nominal va de 1 a 12`); return } upd.mes_nominal = n }
    const subFinal = upd.subcuenta_id ?? mov?.subcuenta_id, cecoFinal = upd.ceco_id ?? mov?.ceco_id
    if (subFinal && plan.requiereCeco(subFinal) && !cecoFinal) { errores.push(`Fila ${fila}: ${plan.nombreSub(subFinal)} exige centro de costo`); return }
    items.push({ id, upd })
  })
  return { items, errores }
}

/* Búsqueda de la barra superior: todas las palabras deben calzar, en cualquier orden y sin tildes.
   Cada palabra puede ser: monto (350000 · 350.000) o rango (300000-400000), RUT con puntos o guion,
   subcuenta (710.03) o cuenta madre (710), centro de costo (10204), mes (2026-05 · mayo) o texto de la
   glosa, motivo de la transferencia, beneficiario, subcuenta, centro de costo o respaldo. */
const montoCalza = (r, t) => {
  const n = Number(String(t).replace(/\./g, '').replace(',', '.')), m = Math.abs(Number(r.monto))
  return !isNaN(n) && (Math.abs(m - n) <= 1 || String(Math.round(m)).includes(String(Math.round(n))))
}
export function armarBuscador(texto, plan) {
  const toks = normalizar(texto).trim().split(/\s+/).filter(Boolean)
  if (!toks.length) return null
  const hay = r => r._hay ?? normalizar(`${r.descripcion ?? ''} ${plan.nombreSub(r.subcuenta_id)} ${plan.nombreCeco(r.ceco_id)}`)
  const pruebas = toks.map(t => {
    // mes y RUT con guion van antes que el rango: "2026-10" y "76.123.456-7" también tienen un guion
    if (/^\d{4}-\d{2}$/.test(t)) return r => String(r.fecha).startsWith(t)
    if (/^\d{1,2}\.?\d{3}\.?\d{3}-[\dk]$/.test(t)) { const rut = t.replace(/[.\-]/g, ''); return r => hay(r).includes(rut) }
    const rango = t.match(/^(\d[\d.]*)-(\d[\d.]*)$/)
    if (rango) {
      const a = Number(rango[1].replace(/\./g, '')), b = Number(rango[2].replace(/\./g, ''))
      return r => { const m = Math.abs(Number(r.monto)); return m >= Math.min(a, b) && m <= Math.max(a, b) }
    }
    if (/^\d{3}\.\d{2}$/.test(t) && plan.subPorCodigo.has(t)) { const id = plan.subPorCodigo.get(t).id; return r => r.subcuenta_id === id }
    if (/^\d{3}$/.test(t) && plan.madres.some(m => String(m.codigo) === t)) return r => String(plan.subMap.get(r.subcuenta_id)?.codigo ?? '').startsWith(t + '.') || montoCalza(r, t)
    if (/^\d{5}$/.test(t) && plan.cecoPorCodigo.has(t)) { const id = plan.cecoPorCodigo.get(t).id; return r => r.ceco_id === id || montoCalza(r, t) }
    const mesIdx = MESES_TXT.indexOf(t)
    if (mesIdx >= 0) return r => Number(String(r.fecha).slice(5, 7)) === mesIdx + 1
    const rut = t.replace(/[.\-]/g, '')
    if (/[.\-]/.test(t) && /^\d{7,8}[\dk]$/.test(rut)) return r => hay(r).includes(rut)
    if (/^[\d.,]+$/.test(t)) { const dig = t.replace(/[.,]/g, ''); return r => montoCalza(r, t) || hay(r).includes(dig) }
    return r => hay(r).includes(t)
  })
  return r => pruebas.every(p => p(r))
}
// Cambios de una línea (audit_log) en palabras
function describirCambios(c, plan) {
  const partes = []
  const par = (k, f) => { const v = c?.[k]; if (v) partes.push(f(v.old, v.new)) }
  par('subcuenta_id', (a, b) => `subcuenta ${plan.nombreSub(a) || 'sin subcuenta'} → ${plan.nombreSub(b) || 'sin subcuenta'}`)
  par('ceco_id', (a, b) => `centro de costo ${plan.nombreCeco(a) || '—'} → ${plan.nombreCeco(b) || '—'}`)
  par('tipo_respaldo', (a, b) => `respaldo ${a ?? '—'} → ${b ?? '—'}`)
  par('mes_nominal', (a, b) => `mes nominal ${a ? MES_L[a - 1] : '—'} → ${b ? MES_L[b - 1] : '—'}`)
  par('estado', (a, b) => `estado ${a ?? '—'} → ${b ?? '—'}`)
  par('clasif_origen', (a, b) => `origen: ${ORIGEN_L[b] ?? b ?? '—'}`)
  par('revisado', () => 'marcada como revisada')
  par('monto', (a, b) => `monto ${a} → ${b}`)
  par('fecha', (a, b) => `fecha ${a} → ${b}`)
  return partes.join(' · ') || 'cambio'
}

export function ConciliacionBancaria({ cu }) {
  const [cuenta, setCuenta] = useState('santander')
  const [mes, setMes] = useState(MESES[MESES.length - 1])
  const [anioCompleto, setAnioCompleto] = useState(false)
  const [chip, setChip] = useState('trabajo')
  const [texto, setTexto] = useState('')
  const [filas, setFilas] = useState([])
  const [sugMap, setSugMap] = useState(new Map())   // movimiento_id -> [sugerencias del agente]
  const [tefMap, setTefMap] = useState(new Map())   // movimiento_id -> transferencia (beneficiario y motivo)
  const [plan, setPlan] = useState(PLAN_VACIO)
  const [cargando, setCargando] = useState(false)
  const [selId, setSelId] = useState(null)
  const [motor, setMotor] = useState(null)          // motor de sugerencias (reglas + historial, confianza medida)
  const [marcados, setMarcados] = useState(() => new Set())
  const [iaMap, setIaMap] = useState(() => new Map()) // movimiento_id -> propuesta de la IA
  const [agrupar, setAgrupar] = useState(false)
  const [lote, setLote] = useState(null)             // formulario "asignar a las marcadas"
  const [trabajando, setTrabajando] = useState(null)
  const archivoRef = useRef(null)
  const [periodos, setPeriodos] = useState(() => new Map())   // 'YYYY-MM' → abierto/cerrado (cont_periodos)
  const [busquedaPrev, setBusquedaPrev] = useState(null)       // vista a la que se vuelve al salir de "buscar en todo 2026"
  const [parecidas, setParecidas] = useState(null)             // líneas parecidas a una recién reclasificada
  useEffect(() => {
    let vivo = true
    supabase.from('cont_periodos').select('periodo, estado').then(({ data }) => { if (vivo) setPeriodos(new Map((data ?? []).map(p => [p.periodo, p.estado]))) })
    return () => { vivo = false }
  }, [])
  const ordenRef = useRef([])   // ids en el orden y filtro que muestra la grilla ("guardar y siguiente")
  const alVerFilas = useCallback(f => { ordenRef.current = f.map(r => r.id) }, [])
  const irSiguiente = useCallback(id => { const o = ordenRef.current, i = o.indexOf(id); setSelId(o[i + 1] ?? o[i - 1] ?? null) }, [])
  const indice = useMemo(() => (motor ? indicePalabras(motor) : null), [motor])   // palabras de las glosas por subcuenta

  useEffect(() => {
    let vivo = true
    cargarMotor().then(m => { if (vivo) setMotor(m) }).catch(e => { if (vivo) toast.error('Sugerencias no disponibles: ' + (e?.message ?? e)) })
    return () => { vivo = false }
  }, [])
  useEffect(() => {
    let vivo = true
    Promise.all([
      traerTodo(() => supabase.from('subcuentas').select('id, codigo, nombre, activa, cuenta_madre_id').order('id')),
      supabase.from('cuentas_madre').select('id, codigo, nombre, tipo, requiere_ceco, activa').order('codigo'),
      supabase.from('centros_costo').select('id, codigo, nombre, area, ceco_id, activo').order('codigo'),
      supabase.from('cecos').select('id, nombre').order('id'),
    ]).then(([subs, m, c, s]) => {
      for (const r of [m, c, s]) if (r.error) throw r.error
      if (vivo) setPlan(armarPlan(subs, m.data ?? [], c.data ?? [], s.data ?? []))
    }).catch(e => { if (vivo) toast.error('Plan de cuentas: ' + (e?.message ?? e)) })
    return () => { vivo = false }
  }, [])

  /* ── carga de la cartola ── */
  const cargar = useCallback(async () => {
    setCargando(true)
    const desde = anioCompleto ? '2026-01-01' : mes + '-01'
    const hasta = anioCompleto ? '2100-01-01' : mesSiguiente(mes) + '-01'
    const armar = () => {
      const q = supabase.from('movimientos_bancarios')
        .select('id, fecha, tipo, monto, descripcion, referencia, n_documento, estado, subcuenta_id, ceco_id, tipo_respaldo, origen, saldo, mes_nominal, mes_cartola, clasif_origen, clasif_ia, clasificado_at, clasif_revisado_at, subcuenta:subcuentas(codigo, nombre), conciliaciones(monto_aplicado)')
        .gte('fecha', desde).lt('fecha', hasta).order('fecha', { ascending: false }).order('id', { ascending: false })
      return cuenta === 'global66' ? q.eq('origen', 'global66_sync') : q.or('origen.is.null,origen.neq.global66_sync')
    }
    let data, sugs, tefs
    try {
      [data, { data: sugs }, tefs] = await Promise.all([
        traerTodo(armar),
        supabase.from('v_bandeja_conciliacion').select('*'),
        traerTodo(() => supabase.from('v_tef_detalle').select('n_transaccion, movimiento_id, nombre_destino, motivo, relacion')
          .eq('relacion', 'directa').gte('fecha_contable', desde).lt('fecha_contable', hasta).order('n_transaccion')),
      ])
    } catch (e) { toast.error(e?.message ?? String(e)); setFilas([]); setSugMap(new Map()); setCargando(false); return }
    const m = new Map()
    for (const s of sugs ?? []) {
      const ids = [s.movimiento_id, ...(s.movimiento_ids ?? [])].filter(Boolean)
      for (const id of ids) { if (!m.has(id)) m.set(id, []); m.get(id).push(s) }
    }
    const t = new Map()
    for (const x of tefs ?? []) if (x.movimiento_id) t.set(x.movimiento_id, x)
    setSugMap(m); setTefMap(t); setFilas(data ?? []); setCargando(false)
    setMarcados(prev => { if (!prev.size) return prev; const ids = new Set((data ?? []).map(r => r.id)); return new Set([...prev].filter(id => ids.has(id))) })
  }, [mes, cuenta, anioCompleto])
  useEffect(() => { cargar() }, [cargar])

  /* ── derivar situación + filtrar ── */
  const enriquecidas = useMemo(() => filas.map(r => {
    // revisada: una persona la clasificó o confirmó después de la última clasificación
    const revisada = !!r.clasif_revisado_at && (!r.clasificado_at || r.clasif_revisado_at >= r.clasificado_at)
    const tef = tefMap.get(r.id) ?? null
    return {
      ...r, sit: situacionDe(r), nSug: (sugMap.get(r.id) ?? []).length,
      sinCeco: !!r.subcuenta_id && plan.requiereCeco(r.subcuenta_id) && !r.ceco_id,
      tef, ia: iaMap.get(r.id) ?? null,
      sugC: !r.subcuenta_id && motor ? sugerirClasificacion(r, motor) : null,
      revision: r.subcuenta_id && motor && !revisada ? segundaOpinion(r, motor) : null,
      cerrado: periodos.get(String(r.fecha).slice(0, 7)) === 'cerrado',
      _hay: normalizar(`${r.descripcion ?? ''} ${r.referencia ?? ''} ${r.n_documento ?? ''} ${plan.nombreSub(r.subcuenta_id)} ${plan.nombreCeco(r.ceco_id)} ${tef?.motivo ?? ''} ${tef?.nombre_destino ?? ''} ${r.tipo_respaldo ?? ''}`),
    }
  }), [filas, sugMap, tefMap, iaMap, motor, plan, periodos])
  const enTrabajo = r => ['sin_clasificar', 'por_conciliar', 'parcial'].includes(r.sit.k) || r.sinCeco
  const visibles = useMemo(() => {
    let out = enriquecidas
    if (chip === 'trabajo') out = out.filter(enTrabajo)
    else if (chip === 'sin_ceco') out = out.filter(r => r.sinCeco)
    else if (chip === 'sugerencia') out = out.filter(r => r.nSug > 0 || r.sugC || r.ia)
    else if (chip === 'revisar') out = out.filter(r => r.revision)
    else if (chip !== 'todos') out = out.filter(r => r.sit.k === chip)
    const coincide = armarBuscador(texto, plan)
    if (coincide) out = out.filter(coincide)
    return out
  }, [enriquecidas, chip, texto, plan]) // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = useMemo(() => {
    const k = { total: enriquecidas.length, sin_clasificar: 0, por_conciliar: 0, parcial: 0, conciliado: 0, explicado: 0, sin_tipo: 0, sug: 0, pend_monto: 0, sin_ceco: 0, auto: 0, trabajo: 0, revisar: 0 }
    for (const r of enriquecidas) {
      k[r.sit.k]++
      if (r.sit.k === 'por_conciliar' || r.sit.k === 'parcial') k.pend_monto += r.sit.pendiente
      if (r.nSug || r.sugC || r.ia) k.sug++
      if (r.sinCeco) k.sin_ceco++
      if (r.revision) k.revisar++
      if (enTrabajo(r)) k.trabajo++
      if (!r.subcuenta_id && r.sugC?.auto && r.sugC.subcuenta_id) k.auto++
    }
    return k
  }, [enriquecidas]) // eslint-disable-line react-hooks/exhaustive-deps

  const sel = useMemo(() => enriquecidas.find(r => r.id === selId) ?? null, [enriquecidas, selId])
  const marcadas = useMemo(() => enriquecidas.filter(r => marcados.has(r.id)), [enriquecidas, marcados])
  const todosMarcados = visibles.length > 0 && visibles.every(r => marcados.has(r.id))
  const togMarca = id => setMarcados(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const togTodos = () => setMarcados(s => { const n = new Set(s); if (todosMarcados) visibles.forEach(r => n.delete(r.id)); else visibles.forEach(r => n.add(r.id)); return n })

  /* ── escritura en lote (de a 10 en paralelo) ── */
  async function actualizarEnLote(items, titulo) {
    if (!items.length) return
    setTrabajando(`${titulo}: ${items.length} movimientos…`)
    const { data: sess } = await supabase.auth.getSession()
    const uid = sess?.session?.user?.id ?? null
    const ahora = new Date().toISOString()
    let ok = 0, err = 0, ultimo = ''
    for (let i = 0; i < items.length; i += 10) {
      const res = await Promise.all(items.slice(i, i + 10).map(({ id, upd }) => {
        const u = { ...upd }
        if (u.subcuenta_id) Object.assign(u, { estado: 'clasificado', clasificado_por: uid, clasificado_at: ahora, clasif_ia: u.clasif_origen === 'ia',
          ...(String(u.clasif_origen ?? '').startsWith('auto:') ? {} : { clasif_revisado_at: ahora, clasif_revisado_por: uid }) })
        return supabase.from('movimientos_bancarios').update(u).eq('id', id).select('id')
      }))
      for (const r of res) { if (r.error || !r.data?.length) { err++; ultimo = r.error?.message ?? 'sin permiso para modificar' } else ok++ }
    }
    setTrabajando(null)
    if (err) toast.error(`${titulo}: ${ok} guardados, ${err} con error (${ultimo})`)
    else toast.success(`${titulo}: ${ok} movimiento${ok === 1 ? '' : 's'} guardado${ok === 1 ? '' : 's'}`)
    setIaMap(m => { if (!m.size) return m; const n = new Map(m); for (const { id } of items) n.delete(id); return n })
    await cargar()
  }
  const updDeSugerencia = (s, modo) => ({
    subcuenta_id: s.subcuenta_id, clasif_origen: `${modo}:${fuenteAOrigen(s.fuente)}`,
    ...(s.ceco_id ? { ceco_id: s.ceco_id } : {}), ...(s.tipo_respaldo ? { tipo_respaldo: s.tipo_respaldo } : {}),
    ...(s.caso_postventa_id ? { caso_postventa_id: s.caso_postventa_id } : {}),
  })

  async function aplicarAutomaticas() {
    const cands = enriquecidas.filter(r => !r.subcuenta_id && r.sugC?.auto && r.sugC.subcuenta_id && fuenteAOrigen(r.sugC.fuente))
    if (!cands.length) { toast(`No hay sugerencias que acierten ${UMBRAL_AUTO}% o más en este período`); return }
    const sinCc = cands.filter(r => plan.requiereCeco(r.sugC.subcuenta_id) && !r.sugC.ceco_id).length
    if (!window.confirm(`Aplicar ${cands.length} clasificaciones automáticas.\nSolo entran las sugerencias que en el historial aciertan ${UMBRAL_AUTO}% o más.` +
      (sinCc ? `\n${sinCc} quedarán sin centro de costo y aparecerán en "Sin centro de costo".` : ''))) return
    await actualizarEnLote(cands.map(r => ({ id: r.id, upd: updDeSugerencia(r.sugC, 'auto') })), 'Automáticas')
  }
  async function aceptarMarcadas() {
    const items = []
    let sinSug = 0
    for (const r of marcadas) {
      if (r.ia?.subcuenta_id) items.push({ id: r.id, upd: { subcuenta_id: r.ia.subcuenta_id, clasif_origen: 'ia', ...(r.ia.ceco_id ? { ceco_id: r.ia.ceco_id } : {}), ...(r.ia.tipo_respaldo ? { tipo_respaldo: r.ia.tipo_respaldo } : {}) } })
      else if (!r.subcuenta_id && r.sugC?.subcuenta_id && fuenteAOrigen(r.sugC.fuente)) items.push({ id: r.id, upd: updDeSugerencia(r.sugC, 'motor') })
      else sinSug++
    }
    if (!items.length) { toast.error('Ninguna de las líneas marcadas tiene una sugerencia para aceptar'); return }
    await actualizarEnLote(items, 'Sugerencias aceptadas')
    if (sinSug) toast(`${sinSug} línea${sinSug === 1 ? '' : 's'} marcada${sinSug === 1 ? '' : 's'} sin sugerencia: quedan igual`)
  }
  async function pedirIAMarcadas() {
    const ids = marcadas.map(r => r.id)
    if (!ids.length) return
    if (ids.length > 60 && !window.confirm(`Vas a pedir ${ids.length} propuestas a la IA. ¿Seguir?`)) return
    let ok = 0, err = 0, ultimo = ''
    const nuevo = new Map()
    for (let i = 0; i < ids.length; i += 20) {
      setTrabajando(`Consultando a la IA: ${Math.min(i + 20, ids.length)} de ${ids.length}…`)
      const { data, error } = await supabase.functions.invoke('clasificar-ia', { body: { movimiento_ids: ids.slice(i, i + 20) } })
      if (error || data?.error) {
        let msg = data?.error ?? error?.message ?? 'error'
        try { const j = await error?.context?.json?.(); if (j?.error) msg = j.error } catch { /* sin cuerpo */ }
        err += Math.min(20, ids.length - i); ultimo = msg; continue
      }
      for (const x of data?.resultados ?? []) { if (x.ok) { nuevo.set(x.movimiento_id, x); ok++ } else { err++; ultimo = x.error } }
    }
    setTrabajando(null)
    setIaMap(m => { const n = new Map(m); for (const [k, v] of nuevo) n.set(k, v); return n })
    if (err) toast.error(`IA: ${ok} propuestas, ${err} sin respuesta (${ultimo})`)
    else toast.success(`IA: ${ok} propuesta${ok === 1 ? '' : 's'} en la columna Subcuenta. Acéptalas con "Aceptar sugerencias".`)
  }
  async function asignarMarcadas() {
    const f = lote ?? {}
    if (!f.sub && !f.ceco && !f.resp && !f.mes) { toast.error('Elige al menos un campo para asignar'); return }
    const items = []
    for (const r of marcadas) {
      const subFinal = f.sub || r.subcuenta_id, cecoFinal = f.ceco || r.ceco_id
      if (subFinal && plan.requiereCeco(subFinal) && !cecoFinal) { toast.error(`${plan.nombreSub(subFinal)} exige centro de costo: elige uno para aplicarlo a las marcadas`); return }
      const upd = {}
      if (f.sub) Object.assign(upd, { subcuenta_id: f.sub, clasif_origen: 'lote' })
      if (f.ceco) upd.ceco_id = f.ceco
      if (f.resp) upd.tipo_respaldo = f.resp
      if (f.mes) upd.mes_nominal = Number(f.mes)
      items.push({ id: r.id, upd })
    }
    await actualizarEnLote(items, 'Asignado a las marcadas')
    setLote(null)
  }

  /* ── buscar en todo 2026 (sin depender del mes elegido) ── */
  function buscarEnTodoElAnio(t = texto) {
    if (!String(t).trim()) return
    if (!busquedaPrev) setBusquedaPrev({ anioCompleto, chip })
    setAnioCompleto(true); setChip('todos')
  }
  function salirDeBusqueda() {
    if (busquedaPrev) { setAnioCompleto(busquedaPrev.anioCompleto); setChip(busquedaPrev.chip) }
    setBusquedaPrev(null); setTexto('')
  }
  /* ── tras reclasificar: otras líneas del mismo RUT (o la misma glosa) que siguen en la subcuenta anterior ── */
  async function buscarParecidas({ mov, desde, hacia, ceco }) {
    try {
      const rut = rutDeGlosa(mov.descripcion)
      const dig = rut ? rut.replace(/[^0-9Kk]/g, '') : null
      const pat = dig ? null : extraerPatronDesc(mov.descripcion)
      const palabra = pat ? pat.replace('MERCHANT:', '').split(' ')[0] : null
      if (!dig && !palabra) return
      const { data, error } = await supabase.from('movimientos_bancarios').select('id, fecha, monto, descripcion, tipo, subcuenta_id, ceco_id')
        .eq('subcuenta_id', desde).eq('tipo', mov.tipo).gte('fecha', '2026-01-01').neq('id', mov.id)
        .ilike('descripcion', `%${dig ?? palabra}%`).order('fecha', { ascending: false }).limit(500)
      if (error) throw error
      const lista = (data ?? []).filter(f => dig || extraerPatronDesc(f.descripcion) === pat)
      if (lista.length) setParecidas({ desde, hacia, ceco, rut, pat, filas: lista, etiqueta: dig ? `del RUT ${rut}` : `con la glosa «${pat.replace('MERCHANT:', '')}»` })
    } catch (e) { console.warn('parecidas', e) }
  }
  async function moverParecidas() {
    const p = parecidas
    if (!p) return
    const exige = plan.requiereCeco(p.hacia)
    const items = p.filas.map(f => ({ id: f.id, upd: { subcuenta_id: p.hacia, clasif_origen: 'lote', ...(exige && !f.ceco_id && p.ceco ? { ceco_id: p.ceco } : {}) } }))
    setParecidas(null)
    await actualizarEnLote(items, 'Parecidas reclasificadas')
  }
  function verParecidas() {
    const p = parecidas
    if (!p) return
    const t = p.rut ?? p.pat.replace('MERCHANT:', '')
    setTexto(t); buscarEnTodoElAnio(t); setParecidas(null)
  }

  /* ── grupos de líneas sin clasificar con la misma sugerencia ── */
  const grupos = useMemo(() => {
    if (!agrupar) return []
    const G = new Map()
    for (const r of enriquecidas) {
      const s = r.sugC
      if (r.subcuenta_id || !s?.subcuenta_id || !fuenteAOrigen(s.fuente)) continue
      const clave = s.fuente === 'rut_historico' || s.tipo_regla === 'rut' ? `RUT ${s.rut_extraido ?? ''}`
        : s.patron_match ? `Glosa "${String(s.patron_match).replace('MERCHANT:', '')}"` : 'Regla de texto'
      const k = `${clave}|${s.subcuenta_id}|${s.ceco_id ?? ''}`
      if (!G.has(k)) G.set(k, { k, clave, nombre: nombreDeGlosa(r.descripcion), sug: s, ids: [], monto: 0 })
      const g = G.get(k); g.ids.push(r.id); g.monto += Math.abs(Number(r.monto) || 0)
    }
    return [...G.values()].sort((a, b) => b.ids.length - a.ids.length || b.monto - a.monto)
  }, [agrupar, enriquecidas])
  async function aplicarGrupo(g) {
    if (!window.confirm(`Clasificar ${g.ids.length} movimiento${g.ids.length === 1 ? '' : 's'} (${g.clave}) en ${plan.nombreSub(g.sug.subcuenta_id)}?`)) return
    await actualizarEnLote(g.ids.map(id => ({ id, upd: updDeSugerencia(g.sug, 'motor') })), 'Grupo clasificado')
  }

  /* ── Excel: exportar para clasificar fuera e importar lo devuelto ── */
  function exportarPlantilla() {
    const fuente = marcadas.length ? marcadas : visibles
    const rows = fuente.map(r => ({
      id: r.id, fecha: fF(r.fecha), tipo: r.tipo, descripcion: r.descripcion, motivo_transferencia: r.tef?.motivo ?? '', monto: Math.abs(Number(r.monto) || 0),
      subcuenta_actual: r.subcuenta_id ? plan.nombreSub(r.subcuenta_id) : '', centro_costo_actual: r.ceco_id ? plan.nombreCeco(r.ceco_id) : '',
      respaldo_actual: r.tipo_respaldo ?? '', mes_nominal_actual: r.mes_nominal ?? '',
      sugerencia: r.ia?.subcuenta_codigo ? `${r.ia.subcuenta_codigo} (IA ${r.ia.confianza}%)` : r.sugC?.subcuenta_id ? `${plan.subMap.get(r.sugC.subcuenta_id)?.codigo ?? ''} (${fPct(r.sugC.score)}%)` : '',
      subcuenta_codigo_nueva: '', centro_costo_codigo_nuevo: '', respaldo_nuevo: '', mes_nominal_nuevo: '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Movimientos')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(plan.grupos.flatMap(({ m, subs }) => subs.map(s => ({
      codigo: s.codigo ?? '', subcuenta: s.nombre, cuenta_madre: `${m.codigo} ${m.nombre}`, exige_centro_costo: m.requiere_ceco === false ? 'no' : 'sí' })))), 'Subcuentas')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(plan.cecos.map(c => ({ codigo: c.codigo, centro_costo: c.nombre, sede: plan.sedeDeCeco(c.id) }))), 'Centros de costo')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(TIPOS_RESPALDO.map(([k, l]) => ({ codigo: k, respaldo: l.replace(' (se concilia)', '') }))), 'Respaldos')
    XLSX.writeFile(wb, `clasificar_${cuenta}_${anioCompleto ? '2026' : mes}.xlsx`)
    toast.success(`Planilla con ${rows.length} movimientos. Llena las columnas "…_nueva/o" con códigos y vuelve a importarla.`)
  }
  async function importarPlantilla(file) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const filasX = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const { items, errores } = interpretarPlantilla(filasX, plan, new Map(filas.map(r => [r.id, r])))
      if (!items.length) { toast.error(errores.length ? `No se aplicó nada. ${errores.slice(0, 3).join(' · ')}` : 'La planilla no trae cambios en las columnas "…_nueva/o"'); return }
      if (!window.confirm(`Aplicar ${items.length} cambios desde Excel.` + (errores.length ? `\n${errores.length} filas con error no se aplican:\n${errores.slice(0, 5).join('\n')}` : ''))) return
      await actualizarEnLote(items.map(({ id, upd }) => ({ id, upd: upd.subcuenta_id ? { ...upd, clasif_origen: 'excel' } : upd })), 'Excel')
    } catch (e) { toast.error('Excel: ' + (e?.message ?? e)) } finally { if (archivoRef.current) archivoRef.current.value = '' }
  }

  const cols = useMemo(() => [
    { key: 'fecha', label: 'Fecha', width: 86, value: r => fF(r.fecha) },
    { key: 'sit', label: 'Estado', width: 112, value: r => SITUACION[r.sit.k].l, render: r => <span style={{ fontSize: 10.5, fontWeight: 700, color: SITUACION[r.sit.k].c }}>{SITUACION[r.sit.k].l}{r.nSug ? <span title={`${r.nSug} sugerencia(s) del agente`} style={{ marginLeft: 5, color: AZUL }}>✦</span> : null}</span> },
    { key: 'descripcion', label: 'Descripción', width: 320, value: r => `${r.descripcion ?? ''}${r.tef?.motivo ? ` · ${r.tef.motivo}` : ''}`,
      render: r => <span title={r.tef ? `Transferencia a ${r.tef.nombre_destino}${r.tef.motivo ? ` · motivo: ${r.tef.motivo}` : ''}` : r.descripcion}>{r.descripcion}{r.tef?.motivo ? <span style={{ color: SLATE }}> · {r.tef.motivo}</span> : null}</span> },
    { key: 'monto', label: 'Monto', align: 'right', width: 112, value: r => Math.abs(Number(r.monto)), render: r => <b style={{ fontVariantNumeric: 'tabular-nums', color: r.tipo === 'CARGO' ? ROJO : VERDE }}>{r.tipo === 'CARGO' ? '−' : ''}{fmt(Math.abs(r.monto))}</b> },
    { key: 'aplicado', label: 'Aplicado', align: 'right', width: 100, value: r => r.sit.aplicado, render: r => r.sit.aplicado ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(r.sit.aplicado)}</span> : '' },
    { key: 'pendiente', label: 'Pendiente', align: 'right', width: 100, value: r => r.sit.pendiente, render: r => r.sit.pendiente ? <span style={{ fontVariantNumeric: 'tabular-nums', color: ROJO, fontWeight: 600 }}>{fmt(r.sit.pendiente)}</span> : '' },
    { key: 'subcuenta', label: 'Subcuenta', width: 240, value: r => r.subcuenta_id ? plan.nombreSub(r.subcuenta_id) : (r.ia?.subcuenta_codigo ?? plan.nombreSub(r.sugC?.subcuenta_id)),
      render: r => r.subcuenta_id ? <span>{plan.nombreSub(r.subcuenta_id) || r.subcuenta?.nombre}</span>
        : r.ia ? <span title={r.ia.razon} style={{ color: AZUL, fontStyle: 'italic' }}>IA ≈ {r.ia.subcuenta_codigo} {r.ia.subcuenta_nombre} · {r.ia.confianza}%</span>
        : r.sugC ? <span title={r.sugC.razon ?? ''} style={{ color: SLATE, fontStyle: 'italic' }}>≈ {plan.nombreSub(r.sugC.subcuenta_id) || 'devolución postventa'} · {fPct(r.sugC.score)}%{r.sugC.auto ? ' · auto' : ''}</span>
        : <span style={{ color: AMBAR }}>—</span> },
    { key: 'revision', label: '2ª opinión', width: 120, value: r => (r.revision ? plan.nombreSub(r.revision.subcuenta_id) : ''),
      render: r => r.revision ? <span title={`${plan.nombreSub(r.revision.subcuenta_id)} · ${r.revision.razon}`} style={{ color: AMBAR, fontWeight: 600 }}>¿{plan.subMap.get(r.revision.subcuenta_id)?.codigo ?? '?'}? · {fPct(r.revision.score)}%</span> : '' },
    { key: 'ceco', label: 'Centro de costo', width: 170, value: r => r.ceco_id ? plan.nombreCeco(r.ceco_id) : (r.sinCeco ? 'Falta' : ''),
      render: r => r.ceco_id ? <span>{plan.nombreCeco(r.ceco_id)}</span> : r.sinCeco ? <span style={{ color: AMBAR, fontWeight: 700 }}>Falta</span> : r.subcuenta_id ? <span style={{ color: SLATE }}>No aplica</span> : '' },
    { key: 'tipo_respaldo', label: 'Respaldo', width: 112, value: r => r.tipo_respaldo ?? '' },
    { key: 'mes_nominal', label: 'Mes nominal', width: 80, value: r => r.mes_nominal ?? 0, render: r => r.mes_nominal ? MES_L[r.mes_nominal - 1] : '' },
    { key: 'origen', label: 'Origen', width: 128, value: r => ORIGEN_L[r.clasif_origen] ?? '',
      render: r => <span style={{ fontSize: 11, color: SLATE }} title={r.clasif_origen ? '' : r.clasif_ia ? 'Clasificado antes del registro de origen; la marca IA antigua no distingue motor de IA' : ''}>{ORIGEN_L[r.clasif_origen] ?? (r.clasif_ia ? 'Motor o IA (antiguo)' : '')}</span> },
  ], [plan])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── barra superior: cuenta · mes · búsqueda · progreso ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '8px 12px', flexWrap: 'wrap' }}>
        <select value={cuenta} onChange={e => setCuenta(e.target.value)} style={{ ...INPUT, width: 'auto', fontWeight: 700, color: NAVY }}>
          <option value="santander">Santander CLP</option><option value="global66">Global66 USD</option>
        </select>
        <select value={mes} onChange={e => setMes(e.target.value)} disabled={anioCompleto} style={{ ...INPUT, width: 'auto', fontWeight: 600 }}>
          {[...MESES].reverse().map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <label style={{ fontSize: 11.5, color: SLATE, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={anioCompleto} onChange={e => setAnioCompleto(e.target.checked)} /> todo el año
        </label>
        <input value={texto} onChange={e => setTexto(e.target.value)} aria-label="Buscar movimientos"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscarEnTodoElAnio() } else if (e.key === 'Escape' && (texto || busquedaPrev)) { e.preventDefault(); salirDeBusqueda() } }}
          placeholder="Buscar: monto o rango (300000-400000), RUT, glosa, motivo, subcuenta (710.03), centro de costo, mes (mayo)… · Enter: todo 2026"
          style={{ ...INPUT, flex: 1, minWidth: 260, fontSize: 12.5 }} />
        {texto.trim() && !anioCompleto && <button onClick={() => buscarEnTodoElAnio()} style={BTN(true)}>Buscar en todo 2026</button>}
        <div style={{ display: 'flex', gap: 14, fontSize: 11.5, whiteSpace: 'nowrap' }}>
          <span><b style={{ color: AMBAR }}>{kpi.sin_clasificar}</b> sin clasificar</span>
          <span><b style={{ color: AMBAR }}>{kpi.sin_ceco}</b> sin c. costo</span>
          <span><b style={{ color: ROJO }}>{kpi.por_conciliar + kpi.parcial}</b> por conciliar · <b style={{ color: ROJO }}>{fmt(kpi.pend_monto)}</b></span>
          <span><b style={{ color: VERDE }}>{kpi.conciliado + kpi.explicado}</b> listos de {kpi.total}</span>
        </div>
      </div>

      {busquedaPrev && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '6px 12px', fontSize: 12, flexWrap: 'wrap' }}>
          <span>Buscando {texto.trim() ? <>«<b>{texto.trim()}</b>»</> : 'sin texto'} en <b>todo 2026</b>, en todas las situaciones: {visibles.length} línea{visibles.length === 1 ? '' : 's'}.</span>
          <span style={{ flex: 1 }} />
          <button onClick={salirDeBusqueda} style={BTN(false)}>Volver a {busquedaPrev.anioCompleto ? 'todo el año' : mes}</button>
        </div>
      )}

      {/* ── chips ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CHIPS.map(([k, l]) => (
          <button key={k} onClick={() => setChip(k)} style={{ ...BTN(chip === k), borderRadius: 999 }}>
            {l}{k === 'trabajo' ? ` · ${kpi.trabajo}` : k === 'sugerencia' ? ` · ${kpi.sug}` : k === 'sin_ceco' ? ` · ${kpi.sin_ceco}` : k === 'todos' ? ` · ${kpi.total}` : k in kpi ? ` · ${kpi[k]}` : ''}
          </button>
        ))}
      </div>

      {parecidas && (() => {
        const n = parecidas.filas.length
        const cerradas = parecidas.filas.filter(f => periodos.get(String(f.fecha).slice(0, 7)) === 'cerrado').length
        return (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: '7px 12px', fontSize: 12 }}>
            <span>Hay <b>{n}</b> línea{n === 1 ? '' : 's'} más {parecidas.etiqueta} en <b>{plan.nombreSub(parecidas.desde)}</b> (2026). ¿{n === 1 ? 'La mueves' : 'Las mueves'} también a <b>{plan.nombreSub(parecidas.hacia)}</b>?
              {cerradas ? <span style={{ color: '#78350F' }}> {cerradas} {cerradas === 1 ? 'es' : 'son'} de meses cerrados: cambian en el banco, no en el libro mayor.</span> : null}</span>
            <span style={{ flex: 1 }} />
            <button onClick={moverParecidas} disabled={!!trabajando} style={BTN(true)}>Moverlas también</button>
            <button onClick={verParecidas} style={BTN(false)}>Ver cuáles</button>
            <button onClick={() => setParecidas(null)} style={BTN(false)}>No</button>
          </div>
        )
      })()}

      {/* ── acciones en masa ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={aplicarAutomaticas} disabled={!!trabajando || !kpi.auto} style={BTN(kpi.auto > 0, VERDE)}
          title={`Clasifica solo las sugerencias que en el historial aciertan ${UMBRAL_AUTO}% o más, con al menos 30 casos`}>Aplicar automáticas · {kpi.auto}</button>
        <button onClick={() => setAgrupar(a => !a)} style={BTN(agrupar)}>{agrupar ? 'Ocultar grupos' : 'Agrupar por RUT o glosa'}</button>
        <button onClick={exportarPlantilla} style={BTN(false)} title="Exporta las marcadas (o lo visible) con columnas para clasificar por código">Exportar a Excel para clasificar</button>
        <button onClick={() => archivoRef.current?.click()} disabled={!!trabajando} style={BTN(false)}>Importar Excel</button>
        <input ref={archivoRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && importarPlantilla(e.target.files[0])} />
        {trabajando && <span style={{ fontSize: 11.5, color: SLATE }}>{trabajando}</span>}
      </div>

      {agrupar && (
        <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'auto', maxHeight: 300 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead><tr>{['Grupo', 'Líneas', 'Monto', 'Sugerencia', 'Acierto medido', ''].map((h, i) => (
              <th key={i} style={{ textAlign: i === 1 || i === 2 || i === 4 ? 'right' : 'left', fontSize: 10.5, color: SLATE, padding: '6px 8px', borderBottom: `1px solid ${NAVY}`, position: 'sticky', top: 0, background: '#fff' }}>{h}</th>))}</tr></thead>
            <tbody>
              {grupos.length === 0 && <tr><td colSpan={6} style={{ padding: 10, color: SLATE }}>No hay líneas sin clasificar con sugerencia en este período.</td></tr>}
              {grupos.map(g => (
                <tr key={g.k}>
                  <td style={{ padding: '5px 8px', borderBottom: '1px solid #F1F2F4' }}>{g.clave}<div style={{ fontSize: 10.5, color: SLATE }}>{g.nombre}</div></td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid #F1F2F4' }}>{g.ids.length}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid #F1F2F4' }}>{fmt(g.monto)}</td>
                  <td style={{ padding: '5px 8px', borderBottom: '1px solid #F1F2F4' }}>{plan.nombreSub(g.sug.subcuenta_id)}{g.sug.ceco_id ? <span style={{ color: SLATE }}> · {plan.nombreCeco(g.sug.ceco_id)}</span> : null}</td>
                  <td style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid #F1F2F4', color: g.sug.auto ? VERDE : INK, fontWeight: 600 }}>{fPct(g.sug.score)}%</td>
                  <td style={{ padding: '5px 8px', borderBottom: '1px solid #F1F2F4', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setMarcados(new Set(g.ids))} style={{ ...BTN(false), padding: '2px 8px', marginRight: 4 }}>Marcar</button>
                    <button onClick={() => aplicarGrupo(g)} disabled={!!trabajando} style={{ ...BTN(true), padding: '2px 8px' }}>Aplicar al grupo</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {marcados.size > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '7px 12px', position: 'sticky', top: 0, zIndex: 3 }}>
          <b style={{ fontSize: 12, color: NAVY }}>{marcados.size} marcada{marcados.size === 1 ? '' : 's'}</b>
          {lote ? (<>
            <div style={{ width: 290 }}><BuscadorSubcuenta plan={plan} value={lote.sub} onChange={v => setLote(l => ({ ...l, sub: v }))} vaciable="Subcuenta (sin cambio)"
              uso={motor?.uso} indice={indice} autoFocus ariaLabel="Subcuenta para las marcadas" placeholder="Subcuenta (sin cambio): código o nombre" /></div>
            <div style={{ width: 240 }}><BuscadorCeco plan={plan} value={lote.ceco} onChange={v => setLote(l => ({ ...l, ceco: v }))} vaciable="Centro de costo (sin cambio)"
              ariaLabel="Centro de costo para las marcadas" placeholder="Centro de costo (sin cambio)" /></div>
            <select value={lote.resp ?? ''} onChange={e => setLote(l => ({ ...l, resp: e.target.value }))} style={{ ...INPUT, width: 170 }}>
              <option value="">Respaldo (sin cambio)</option>{TIPOS_RESPALDO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select value={lote.mes ?? ''} onChange={e => setLote(l => ({ ...l, mes: e.target.value }))} style={{ ...INPUT, width: 160 }}>
              <option value="">Mes nominal (sin cambio)</option>{MES_L.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <button onClick={asignarMarcadas} disabled={!!trabajando} style={BTN(true)}>Aplicar a {marcados.size === 1 ? 'la marcada' : `las ${marcados.size}`}</button>
            <button onClick={() => setLote(null)} style={BTN(false)}>Cancelar</button>
          </>) : (<>
            <button onClick={() => setLote({})} style={BTN(false)}>Asignar…</button>
            <button onClick={aceptarMarcadas} disabled={!!trabajando} style={BTN(true, VERDE)}>Aceptar sugerencias</button>
            <button onClick={pedirIAMarcadas} disabled={!!trabajando} style={{ ...BTN(false, AZUL), color: AZUL }}>✦ Pedir a la IA</button>
            <button onClick={() => setMarcados(new Set())} style={BTN(false)}>Quitar marcas</button>
          </>)}
        </div>
      )}

      {/* ── grilla + panel ── */}
      <div style={{ display: 'grid', gridTemplateColumns: sel ? 'minmax(0, 1fr) 450px' : '1fr', gap: 10, alignItems: 'start' }}>
        <DataGrid title={`Cartola ${cuenta === 'santander' ? 'Santander' : 'Global66'} · ${anioCompleto ? '2026' : mes} · ${visibles.length} líneas`}
          exportName={`conciliacion_${cuenta}_${anioCompleto ? '2026' : mes}`}
          columns={cols} rows={visibles} getRowId={r => r.id} loading={cargando} onFilasVisibles={alVerFilas}
          selectedId={selId} onRowClick={r => setSelId(r.id === selId ? null : r.id)}
          leadingHeader={<input type="checkbox" aria-label="Marcar todas las visibles" checked={todosMarcados} onChange={togTodos} />}
          leadingCell={r => <input type="checkbox" aria-label={`Marcar ${fF(r.fecha)} ${r.descripcion ?? ''}`} checked={marcados.has(r.id)} onChange={() => togMarca(r.id)} />}
          rowStyle={r => r.id === selId ? { background: '#E0E7FF' } : marcados.has(r.id) ? { background: '#EEF2FF' } : SITUACION[r.sit.k].bg ? { background: SITUACION[r.sit.k].bg } : r.sinCeco ? { background: '#FFFBEB' } : null}
          emptyText="Nada que mostrar con estos filtros" />
        {sel && <PanelLinea mov={sel} cu={cu} plan={plan} motor={motor} indice={indice} onSiguiente={irSiguiente} onReclasificado={buscarParecidas} sugerencias={sugMap.get(sel.id) ?? []} sugC={sel.sugC} iaInicial={sel.ia}
          onIa={(id, data) => setIaMap(m => { const n = new Map(m); n.set(id, data); return n })}
          onAprendido={(dato, resRegla) => setMotor(m => aprenderEnMemoria(m, dato, resRegla))}
          onCambio={() => cargar()} onCerrar={() => setSelId(null)} />}
      </div>
      <div style={{ fontSize: 10.5, color: SLATE }}>
        Fuente: <code>movimientos_bancarios</code> · respaldos en <code>conciliaciones</code> · sugerencias del agente en <code>v_bandeja_conciliacion</code> · motivo de cada transferencia en <code>v_tef_detalle</code>.
        El porcentaje de cada sugerencia es lo que ese tipo de sugerencia acierta en el historial; "auto" marca las que se pueden aplicar sin revisión ({UMBRAL_AUTO}% o más).
        El centro de costo se exige solo en las cuentas madre que lo piden.
      </div>
    </div>
  )
}

/* ─────────────────────── PANEL DE LA LÍNEA SELECCIONADA ─────────────────── */
function PanelLinea({ mov, cu, plan, motor, indice, onSiguiente, onReclasificado, sugerencias, sugC, iaInicial, onIa, onAprendido, onCambio, onCerrar }) {
  const [vinc, setVinc] = useState([])
  const [cand, setCand] = useState([])
  const [candFuente, setCandFuente] = useState('')   // cómo se encontraron las facturas candidatas
  const [buscaF, setBuscaF] = useState('')
  const [sub, setSub] = useState(mov.subcuenta_id ?? '')
  const [ceco, setCeco] = useState(mov.ceco_id ?? '')
  const [tipoR, setTipoR] = useState(mov.tipo_respaldo ?? '')
  const [mesN, setMesN] = useState(mov.mes_nominal ?? '')
  const [origen, setOrigen] = useState('manual')     // manual | motor | ia → clasif_origen y refuerzo de reglas
  const [ia, setIa] = useState(iaInicial ?? null)    // propuesta de la IA para esta línea
  const [iaCargando, setIaCargando] = useState(false)
  const [montos, setMontos] = useState({})           // facturaId -> monto a aplicar
  const [ocupado, setOcupado] = useState(null)
  const S = SITUACION[mov.sit.k]
  const esCargo = mov.tipo === 'CARGO'
  // Con facturas ya vinculadas, lo que queda por vincular es el pendiente (puede ser 0).
  const cubierto = mov.sit.aplicado > 0 && mov.sit.pendiente <= 0
  const ctx = { ...mov, saldo_pendiente: mov.sit.aplicado > 0 ? mov.sit.pendiente : Math.abs(mov.monto) }
  const rutMov = rutDeGlosa(mov.descripcion ?? '')
  const exige = sub ? plan.requiereCeco(sub) : false
  const subRef = useRef(null), cecoRef = useRef(null), sigRef = useRef(null)
  const [cecoNota, setCecoNota] = useState('')
  const [hist, setHist] = useState([])   // cambios registrados de esta línea (audit_log)
  useEffect(() => {
    let vivo = true
    supabase.from('audit_log').select('id, created_at, usuario_nombre, cambios').eq('tabla', 'movimientos_bancarios').eq('registro_id', mov.id)
      .order('created_at', { ascending: false }).limit(15).then(({ data }) => { if (vivo) setHist(data ?? []) })
    return () => { vivo = false }
  }, [mov.id, mov.subcuenta_id, mov.ceco_id, mov.clasif_revisado_at])
  async function marcarRevisado() {
    const { data: sess } = await supabase.auth.getSession()
    const { error } = await supabase.from('movimientos_bancarios').update({ clasif_revisado_at: new Date().toISOString(), clasif_revisado_por: sess?.session?.user?.id ?? null }).eq('id', mov.id)
    if (error) { toast.error(error.message); return }
    toast.success('Marcada como revisada: ya no aparece en "A revisar"'); onCambio()
  }
  const histRut = useMemo(() => historialDeRut(motor, mov.tipo, mov.descripcion), [motor, mov.tipo, mov.descripcion])
  const subSugeridas = useMemo(() => {
    const out = []
    if (sugC?.subcuenta_id) out.push({ id: sugC.subcuenta_id, nota: `sugerida · acierta ${fPct(sugC.score)}%` })
    if (ia?.subcuenta_id) out.push({ id: ia.subcuenta_id, nota: `IA · ${ia.confianza}%` })
    for (const h of histRut.slice(0, 3)) out.push({ id: h.subcuenta_id, nota: `este RUT ${h.veces} ${h.veces === 1 ? 'vez' : 'veces'}` })
    return out
  }, [sugC, ia, histRut])
  // Centro de costo propuesto para una subcuenta: el de la sugerencia, el que usó este RUT con ella o el más usado con ella
  function cecoPropuesto(subId) {
    if (sugC?.subcuenta_id === subId && sugC.ceco_id) return { id: sugC.ceco_id, nota: 'Propuesto por la sugerencia' }
    if (ia?.subcuenta_id === subId && ia.ceco_id) return { id: ia.ceco_id, nota: 'Propuesto por la IA' }
    const h = histRut.find(x => x.subcuenta_id === subId && x.ceco_id)
    if (h) return { id: h.ceco_id, nota: 'Propuesto: el que usó este RUT con esa subcuenta' }
    let mejor = null, n = 0, tot = 0
    for (const [c, k] of motor?.uso?.get(subId)?.cecos ?? []) { tot += k; if (k > n) { mejor = c; n = k } }
    return mejor ? { id: mejor, nota: `Propuesto: el más usado con esa subcuenta (${n} de ${tot})` } : null
  }
  const propuestoActual = sub ? cecoPropuesto(sub) : null
  const cecoSugeridos = propuestoActual ? [{ id: propuestoActual.id, nota: propuestoActual.nota.replace(/^Propuesto:? (por )?/, '') }] : []
  // Al elegir subcuenta: si exige centro de costo, lo propone y salta a ese campo; si no, al botón de guardar
  function alElegirSub(id) {
    if (!id) return
    if (plan.requiereCeco(id)) {
      if (!ceco) { const p = cecoPropuesto(id); if (p) { setCeco(p.id); setCecoNota(p.nota) } }
      setTimeout(() => cecoRef.current?.focus(), 0)
    } else setTimeout(() => sigRef.current?.focus(), 0)
  }

  useEffect(() => {
    setSub(mov.subcuenta_id ?? ''); setCeco(mov.ceco_id ?? ''); setTipoR(mov.tipo_respaldo ?? ''); setMesN(mov.mes_nominal ?? '')
    setBuscaF(''); setMontos({}); setOrigen('manual'); setIa(iaInicial ?? null); setIaCargando(false); setCecoNota('')
    const t = setTimeout(() => subRef.current?.focus(), 0)   // listo para escribir la cuenta
    return () => clearTimeout(t)
  }, [mov.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (iaInicial) setIa(iaInicial) }, [iaInicial])
  useEffect(() => { fetchVinculados(mov.id).then(setVinc).catch(() => setVinc([])) }, [mov.id, mov.conciliaciones?.length])
  useEffect(() => {
    if (!esCargo || cubierto) { setCand([]); setCandFuente(''); return }
    // Búsqueda manual → tal cual. Si no: 1) por RUT de la glosa, 2) por nombre del tercero, 3) por monto parecido.
    let vivo = true
    const t = setTimeout(async () => {
      try {
        const base = { saldoObjetivo: ctx.saldo_pendiente, movimiento: ctx }
        const conSaldo = rows => (rows ?? []).some(f => Number(f.saldo) > 0)
        let rows = [], fuente = ''
        if (buscaF.trim()) { rows = await fetchFacturasCandidatas({ ...base, texto: buscaF, rutHint: null }); fuente = 'búsqueda' }
        else {
          if (rutMov) { rows = await fetchFacturasCandidatas({ ...base, texto: '', rutHint: rutMov }); fuente = `RUT ${rutMov}` }
          const nom = nombreDeGlosa(mov.descripcion)
          if (!conSaldo(rows) && nom.length >= 4) { rows = await fetchFacturasCandidatas({ ...base, texto: nom, rutHint: null }); fuente = `nombre "${nom}"` }
          if (!conSaldo(rows)) { rows = await fetchFacturasCandidatas({ ...base, texto: '', rutHint: null }); fuente = 'monto parecido' }
        }
        if (vivo) { setCand((rows ?? []).slice(0, 12)); setCandFuente(fuente) }
      } catch { if (vivo) { setCand([]); setCandFuente('') } }
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [mov.id, buscaF, mov.sit.pendiente, mov.sit.aplicado]) // eslint-disable-line react-hooks/exhaustive-deps

  function usarSugerencia(s, de) {
    if (s.subcuenta_id) setSub(s.subcuenta_id)
    if (s.ceco_id) setCeco(s.ceco_id)
    if (s.tipo_respaldo) setTipoR(s.tipo_respaldo)
    setOrigen(de)
  }
  async function pedirIA() {
    setIaCargando(true); setIa(null)
    try {
      const { data, error } = await supabase.functions.invoke('clasificar-ia', { body: { movimiento_id: mov.id } })
      if (error) {
        let msg = error.message
        try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* sin cuerpo */ }
        throw new Error(msg)
      }
      if (data?.error) throw new Error(data.error)
      setIa(data); onIa?.(mov.id, data)
    } catch (e) { toast.error('IA: ' + (e?.message ?? e)) } finally { setIaCargando(false) }
  }

  // v: valores que reemplazan los del formulario ("usar y guardar"); siguiente: pasar a la línea siguiente de la grilla
  async function guardarClasificacion(v = {}, siguiente = false) {
    if (ocupado === 'clasif') return
    const fSub = v.sub ?? sub, fCeco = v.ceco ?? ceco, fTipo = v.tipoR ?? tipoR, fMes = v.mesN ?? mesN, fOrigen = v.origen ?? origen
    if (!fSub) { toast.error('Elige una subcuenta'); subRef.current?.focus(); return }
    if (plan.requiereCeco(fSub) && !fCeco) {
      if (v.sub) { setSub(fSub); if (v.tipoR) setTipoR(v.tipoR); setOrigen(fOrigen) }
      toast.error(`${plan.nombreSub(fSub)} exige centro de costo`); cecoRef.current?.focus(); return
    }
    const ahora = new Date().toISOString()
    const reclasifica = !!mov.subcuenta_id && fSub !== mov.subcuenta_id
    if (reclasifica && mov.cerrado && !window.confirm(`${mesLargo(mov.fecha)} está cerrado.\nLa subcuenta cambia en el banco, pero el libro mayor de ese mes queda como está (queda anotado en la auditoría contable).\n¿Reclasificar igual?`)) return
    setOcupado('clasif')
    try {
      // clasificado_por es uuid → se guarda el id de Auth (sesión), NO usuarios.id ("USR-005")
      const { data: sess } = await supabase.auth.getSession()
      const uid = sess?.session?.user?.id ?? null
      const deIA = fOrigen === 'ia' && !!ia && ia.subcuenta_id === fSub
      const fuenteMotor = fOrigen === 'motor' && sugC && sugC.subcuenta_id === fSub ? fuenteAOrigen(sugC.fuente) : null
      const upd = {
        subcuenta_id: fSub, ceco_id: fCeco || null, tipo_respaldo: fTipo || null, mes_nominal: fMes ? Number(fMes) : null, estado: 'clasificado',
        clasificado_por: uid, clasificado_at: ahora, clasif_ia: deIA, clasif_revisado_at: ahora, clasif_revisado_por: uid,
        clasif_origen: deIA ? 'ia' : fuenteMotor ? `motor:${fuenteMotor}` : 'manual',
      }
      if (sugC?.fuente === 'caso_postventa' && sugC.caso_postventa_id && fTipo === 'caso_postventa') { upd.caso_postventa_id = sugC.caso_postventa_id; upd.clasif_origen = 'postventa' }
      const { data, error } = await supabase.from('movimientos_bancarios').update(upd).eq('id', mov.id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('No se guardó: sin permiso para modificar este movimiento')
      // Aprendizaje (reglas por RUT o glosa). Si falla no deshace la clasificación.
      const dato = { descripcion: mov.descripcion, tipo: mov.tipo, subcuenta_id: fSub, ceco_id: fCeco || null, tipo_respaldo: fTipo || null }
      let resRegla = null
      try { resRegla = await aprenderClasificacion(dato) } catch (e) { console.warn('aprendizaje', e) }
      onAprendido?.(dato, resRegla)
      toast.success(`${deIA ? 'Clasificado con la propuesta de la IA' : 'Clasificado'}: ${plan.nombreSub(fSub)}`)
      if (reclasifica) onReclasificado?.({ mov, desde: mov.subcuenta_id, hacia: fSub, ceco: fCeco || null })
      if (siguiente) onSiguiente?.(mov.id)
      onCambio()
    } catch (e) { toast.error(e?.message ?? String(e)) } finally { setOcupado(null) }
  }
  async function aceptarSug(s) {
    setOcupado('sug' + s.id)
    const fn = s.tipo === 'fraccionado' ? 'fn_aceptar_pago_fraccionado' : 'fn_aceptar_combo'
    const { data, error } = await supabase.rpc(fn, { p_id: s.id, p_usuario: cu?.id ?? 'ui' })
    setOcupado(null)
    if (error) return toast.error(error.message)
    toast.success(`Conciliado: ${data?.conciliaciones_creadas ?? data?.conciliadas ?? ''} vínculo(s)`); onCambio()
  }
  async function rechazarSug(s) {
    setOcupado('sug' + s.id)
    const { error } = await supabase.rpc('fn_rechazar_sugerencia', { p_tipo: s.tipo, p_id: s.id, p_usuario: cu?.id ?? 'ui', p_motivo: null })
    setOcupado(null)
    if (error) return toast.error(error.message)
    toast.success('Sugerencia descartada'); onCambio()
  }
  async function conciliarCon(f) {
    const monto = Number(montos[f.id] ?? Math.min(f.saldo, ctx.saldo_pendiente))
    if (!monto || monto <= 0) return toast.error('Monto inválido')
    if (monto > ctx.saldo_pendiente + TOL) return toast.error(`El monto supera lo que falta por vincular de este movimiento (${fmt(ctx.saldo_pendiente)})`)
    if (monto > Number(f.saldo) + TOL) return toast.error(`El monto supera el saldo de la factura (${fmt(f.saldo)})`)
    setOcupado('f' + f.id)
    try {
      await vincularRespaldo({ movimientoId: mov.id, tipoRespaldo: 'factura_compra', facturaId: f.id, monto, movimiento: ctx, proveedorNombre: f.razon_social })
      let msg = `Vinculada factura ${f.folio} por ${fmt(monto)}`
      const upd = mov.tipo_respaldo !== 'factura_compra' ? { tipo_respaldo: 'factura_compra' } : {}
      if (!mov.subcuenta_id) {
        // El pago de una factura toma la subcuenta habitual del proveedor (≥70% de sus pagos vinculados)
        // o la equivalente a la cuenta confirmada de la factura. Si no hay, se elige a mano.
        const { data: subId } = await supabase.rpc('fn_subcuenta_habitual_factura', { p_factura: f.id })
        if (subId) {
          const { data: sess } = await supabase.auth.getSession()
          Object.assign(upd, { subcuenta_id: subId, estado: 'clasificado', clasificado_por: sess?.session?.user?.id ?? null, clasificado_at: new Date().toISOString(), clasif_origen: 'factura', clasif_ia: false })
          msg += ` · clasificada en ${plan.nombreSub(subId) || 'la subcuenta habitual del proveedor'}`
          if (plan.requiereCeco(subId) && !mov.ceco_id) msg += ' · falta el centro de costo'
        } else msg += ' · elige la subcuenta: el proveedor no tiene una habitual'
      }
      if (Object.keys(upd).length) {
        const { error } = await supabase.from('movimientos_bancarios').update(upd).eq('id', mov.id)
        if (error) throw error
      }
      toast.success(msg); onCambio()
    } catch (e) { toast.error(e.message) } finally { setOcupado(null) }
  }
  async function quitar(v) {
    setOcupado('q' + v.id)
    try { await desvincular(v.id, mov.id); toast.success('Respaldo quitado'); onCambio() } catch (e) { toast.error(e.message) } finally { setOcupado(null) }
  }

  return (
    <div onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); guardarClasificacion({}, true) } }}
      style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: 12, position: 'sticky', top: 8, maxHeight: 'calc(100vh - 120px)', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: S.c, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {S.l} · {mov.sit.vinculada ? 'Ya tiene factura vinculada; falta la subcuenta' : S.d}{mov.sinCeco ? ' · falta el centro de costo' : ''}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: esCargo ? ROJO : VERDE, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{esCargo ? '−' : '+'}{fmt(Math.abs(mov.monto))}</div>
          <div style={{ fontSize: 12.5, color: INK, marginTop: 4, lineHeight: 1.4 }}>{mov.descripcion}</div>
          <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>{fF(mov.fecha)} · {mov.tipo}{mov.referencia ? ` · ref ${mov.referencia}` : ''}{mov.n_documento ? ` · doc ${mov.n_documento}` : ''}{mov.origen ? ` · ${mov.origen}` : ''}</div>
          {mov.tef && <div style={{ fontSize: 11.5, marginTop: 4, background: '#F8FAFC', border: `1px solid ${BORDE}`, borderRadius: 6, padding: '4px 7px' }}>
            Transferencia a <b>{mov.tef.nombre_destino}</b>{mov.tef.motivo ? <> · motivo: <b>{mov.tef.motivo}</b></> : ' · sin motivo'}
          </div>}
          {mov.sit.aplicado > 0 && <div style={{ fontSize: 11.5, marginTop: 4 }}>Aplicado <b>{fmt(mov.sit.aplicado)}</b>{mov.sit.pendiente > 0 && <> · pendiente <b style={{ color: ROJO }}>{fmt(mov.sit.pendiente)}</b></>}</div>}
          {mov.clasif_origen && <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>Clasificado por: {ORIGEN_L[mov.clasif_origen] ?? mov.clasif_origen}</div>}
          {mov.cerrado && <div style={{ fontSize: 11.5, marginTop: 6, background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 6, padding: '5px 8px', color: '#78350F' }}>
            <b>{mesLargo(mov.fecha)} está cerrado.</b> Si cambias la subcuenta, cambia la clasificación del banco, pero el libro mayor de ese mes queda como está (queda anotado en la auditoría contable). Para llevarlo al libro hay que reabrir el período.
          </div>}
        </div>
        <button onClick={onCerrar} title="Cerrar" style={{ ...BTN(false), padding: '2px 8px' }}>✕</button>
      </div>

      {/* 1 · Clasificación */}
      <Sec t="1 · Qué es (subcuenta, centro de costo y respaldo)" right={
        <button onClick={pedirIA} disabled={iaCargando} title="Propuesta de la IA con el historial, la transferencia, el libro de compras, RRHH y postventa"
          style={{ ...BTN(false, AZUL), color: AZUL, padding: '3px 9px' }}>{iaCargando ? 'Analizando…' : '✦ Sugerir con IA'}</button>
      }>
        {mov.revision && (
          <SugBox color={AMBAR}
            titulo={<>Segunda opinión · <b>{plan.nombreSub(mov.revision.subcuenta_id)}</b>{mov.revision.ceco_id ? <> · {plan.nombreCeco(mov.revision.ceco_id)}</> : null}</>}
            score={fPct(mov.revision.score)} detalle={mov.revision.razon}
            onUsar={() => { setSub(mov.revision.subcuenta_id); if (mov.revision.ceco_id) setCeco(mov.revision.ceco_id); setOrigen('manual'); setTimeout(() => sigRef.current?.focus(), 0) }}
            activo={sub === mov.revision.subcuenta_id}
            extra={<button onClick={marcarRevisado} style={{ ...BTN(false), marginTop: 5, padding: '1px 8px', fontSize: 10.5 }}>Está bien como está</button>} />
        )}
        {sugC && !mov.subcuenta_id && (
          <SugBox color={sugC.auto ? VERDE : sugC.nivel === 'alto' ? VERDE : sugC.nivel === 'medio' ? AMBAR : SLATE}
            titulo={<>Sugerencia · <b>{sugC.subcuenta_nombre ? plan.nombreSub(sugC.subcuenta_id) : 'Devolución a cliente (elige la subcuenta)'}</b>
              {sugC.ceco_id ? <> · {plan.nombreCeco(sugC.ceco_id)}</> : null}{sugC.tipo_respaldo ? <> · {rotuloRespaldo(sugC.tipo_respaldo)}</> : null}</>}
            score={fPct(sugC.score)} detalle={sugC.fuente === 'caso_postventa'
              ? `Caso postventa ${sugC.caso_postventa_cliente ?? ''}${sugC.caso_postventa_nc ? ` · NC ${sugC.caso_postventa_nc}` : ''}: mismo RUT y monto`
              : sugC.razon}
            onUsar={() => usarSugerencia(sugC, 'motor')} activo={origen === 'motor'}
            onUsarGuardar={sugC.subcuenta_id && (sugC.ceco_id || !plan.requiereCeco(sugC.subcuenta_id)) ? () => guardarClasificacion({ sub: sugC.subcuenta_id, ceco: sugC.ceco_id || '', tipoR: sugC.tipo_respaldo || tipoR, origen: 'motor' }, true) : null} />
        )}
        {ia && (
          <SugBox color={ia.nivel === 'alto' ? VERDE : ia.nivel === 'medio' ? AMBAR : SLATE}
            titulo={<>IA · <b>{ia.subcuenta_codigo ? `${ia.subcuenta_codigo} ` : ''}{ia.subcuenta_nombre}</b>{ia.ceco_codigo ? <> · {ia.ceco_codigo} {ia.ceco_nombre}</> : null} · {rotuloRespaldo(ia.tipo_respaldo)}</>}
            score={ia.confianza} detalle={ia.razon}
            extra={<>
              {ia.evidencia?.length > 0 && <ul style={{ margin: '3px 0 0 16px', padding: 0, color: SLATE }}>{ia.evidencia.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              {ia.ceco_codigo && ia.ceco_confianza != null && ia.ceco_confianza < 60 && <div style={{ marginTop: 3, color: AMBAR }}>Centro de costo con evidencia débil ({ia.ceco_confianza}%): revísalo.</div>}
              {ia.falta_para_confirmar && <div style={{ marginTop: 3, color: AMBAR }}>Para confirmar: {ia.falta_para_confirmar}</div>}
              {ia.alternativa && <div style={{ marginTop: 3, color: SLATE }}>Alternativa: {ia.alternativa.subcuenta_codigo} {ia.alternativa.subcuenta_nombre}
                <button onClick={() => { setSub(ia.alternativa.subcuenta_id); setOrigen('manual') }} style={{ ...BTN(false), marginLeft: 6, padding: '1px 7px', fontSize: 10.5 }}>Usar alternativa</button></div>}
            </>}
            onUsar={() => usarSugerencia(ia, 'ia')} activo={origen === 'ia'}
            onUsarGuardar={ia.subcuenta_id && (ia.ceco_id || !plan.requiereCeco(ia.subcuenta_id)) ? () => guardarClasificacion({ sub: ia.subcuenta_id, ceco: ia.ceco_id || '', tipoR: ia.tipo_respaldo || tipoR, origen: 'ia' }, true) : null} />
        )}
        {histRut.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginBottom: 6, fontSize: 11 }}>
            <span style={{ color: SLATE }}>Este RUT antes:</span>
            {histRut.slice(0, 4).map(h => (
              <button key={h.subcuenta_id} title={h.ceco_id ? `Centro de costo más usado: ${plan.nombreCeco(h.ceco_id)}` : ''}
                onClick={() => {
                  setSub(h.subcuenta_id); setOrigen('manual')
                  if (h.ceco_id && !ceco) { setCeco(h.ceco_id); setCecoNota('Propuesto: el que usó este RUT con esa subcuenta') }
                  const falta = plan.requiereCeco(h.subcuenta_id) && !(h.ceco_id || ceco)
                  setTimeout(() => (falta ? cecoRef : sigRef).current?.focus(), 0)
                }}
                style={{ ...BTN(sub === h.subcuenta_id), padding: '1px 7px', fontSize: 10.5 }}>
                {plan.nombreSub(h.subcuenta_id) || 'subcuenta'} ×{h.veces}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <BuscadorSubcuenta plan={plan} value={sub} inputRef={subRef} tipoMov={mov.tipo} sugeridas={subSugeridas} uso={motor?.uso} indice={indice}
            onChange={v => { setSub(v); setOrigen('manual'); setCecoNota('') }} onElegido={alElegirSub} />
          <div>
            <BuscadorCeco plan={plan} value={ceco} inputRef={cecoRef} sugeridas={cecoSugeridos} invalido={exige && !ceco}
              onChange={v => { setCeco(v); setCecoNota('') }} onElegido={() => sigRef.current?.focus()}
              placeholder={sub ? (exige ? 'Centro de costo (obligatorio): área o sede…' : 'Centro de costo (no aplica)') : 'Centro de costo: área o sede (ej. ops granja)'} />
            {cecoNota && <div style={{ fontSize: 10.5, color: SLATE, marginTop: 2 }}>{cecoNota}</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <select value={tipoR} onChange={e => setTipoR(e.target.value)} style={INPUT} aria-label="Tipo de respaldo">
              <option value="">Tipo de respaldo…</option>
              {TIPOS_RESPALDO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select value={mesN} onChange={e => setMesN(e.target.value)} style={INPUT} aria-label="Mes nominal" title="Mes al que corresponde el gasto o ingreso, si no es el de la fecha">
              <option value="">Mes nominal…</option>{MES_L.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => guardarClasificacion()} disabled={ocupado === 'clasif'} style={BTN(false)}>Guardar</button>
            <button ref={sigRef} onClick={() => guardarClasificacion({}, true)} disabled={ocupado === 'clasif'} style={BTN(true)}>Guardar y siguiente</button>
            <span style={{ fontSize: 10.5, color: SLATE }}>Ctrl+Enter guarda y pasa a la siguiente · ↑↓ y Enter eligen</span>
          </div>
        </div>
      </Sec>

      {/* 2 · Sugerencias del agente */}
      {sugerencias.length > 0 && (
        <Sec t={`2 · Sugerencias del agente (${sugerencias.length})`}>
          {sugerencias.map(s => (
            <div key={s.id} style={{ border: '1px solid #BFDBFE', background: '#EFF6FF', borderRadius: 6, padding: '8px 10px', marginBottom: 6, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <b style={{ color: NAVY }}>{s.descripcion_tipo ?? s.tipo}</b>
                <span style={{ color: SLATE, fontSize: 11 }}>confianza {s.confianza ?? '—'}</span>
              </div>
              <div style={{ marginTop: 3 }}>{s.proveedor} · {s.n_facturas} factura(s) · {fmt(s.monto_documentos)}{Number(s.diferencia) ? <span style={{ color: AMBAR }}> · dif {fmt(s.diferencia)}</span> : null}</div>
              {s.evidencia && <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>{s.evidencia}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={() => aceptarSug(s)} disabled={!!ocupado} style={BTN(true, VERDE)}>Aceptar</button>
                <button onClick={() => rechazarSug(s)} disabled={!!ocupado} style={BTN(false)}>Descartar</button>
              </div>
            </div>
          ))}
        </Sec>
      )}

      {/* 3 · Vincular factura */}
      {esCargo && (
        <Sec t="3 · Vincular con factura" right={<input value={buscaF} onChange={e => setBuscaF(e.target.value)} placeholder="folio · RUT · proveedor" style={{ ...INPUT, width: 180, fontSize: 11.5 }} />}>
          {candFuente && cand.length > 0 && <div style={{ fontSize: 10.5, color: SLATE, marginBottom: 2 }}>Candidatas por {candFuente}</div>}
          {cubierto
            ? <div style={{ fontSize: 11.5, color: VERDE }}>Las facturas vinculadas ya cubren el monto del movimiento. Para cambiarlas, quita un respaldo abajo.</div>
            : cand.length === 0 && <div style={{ fontSize: 11.5, color: SLATE }}>Sin facturas candidatas. Prueba buscando por folio, RUT o nombre del proveedor.</div>}
          {cand.map(f => {
            const sug = Math.min(Number(f.saldo) || 0, ctx.saldo_pendiente)
            const lvlColor = f.match_level === 'alto' ? VERDE : f.match_level === 'medio' ? AMBAR : SLATE
            return (
              <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px auto', gap: 6, alignItems: 'center', padding: '6px 0', borderBottom: `1px dashed ${BORDE}`, fontSize: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <b>F {f.folio}</b><span style={{ color: SLATE, fontSize: 11 }}>{fF(f.fecha_emision)}</span>
                    {f.match_score != null && <span style={{ fontSize: 10.5, fontWeight: 700, color: lvlColor }}>{f.match_score} pts</span>}
                    {f.estado_factura === 'pagada' && <span style={{ fontSize: 10, color: SLATE }}>pagada</span>}
                  </div>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.razon_social}>{f.razon_social}</div>
                  <div style={{ fontSize: 11, color: SLATE }}>total {fmt(f.monto_total)} · saldo <b style={{ color: INK }}>{fmt(f.saldo)}</b></div>
                </div>
                <input type="number" value={montos[f.id] ?? sug} onChange={e => setMontos(m => ({ ...m, [f.id]: e.target.value }))} style={{ ...INPUT, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
                <button onClick={() => conciliarCon(f)} disabled={!!ocupado || sug <= 0} style={BTN(true)}>Vincular</button>
              </div>
            )
          })}
        </Sec>
      )}

      {/* 4 · Respaldos ya vinculados */}
      {vinc.length > 0 && (
        <Sec t={`4 · Respaldos vinculados (${vinc.length})`}>
          {vinc.map(v => (
            <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px dashed ${BORDE}`, fontSize: 12 }}>
              <div style={{ minWidth: 0 }}>
                <b>{v.tipo_respaldo}</b>{v.folio ? <> · {v.tipo_respaldo === 'factura_compra' ? 'F ' : ''}{v.folio}</> : null}{v.proveedor ? <> · {v.proveedor}</> : null}
                {v.observaciones && <div style={{ fontSize: 11, color: SLATE }}>{v.observaciones}</div>}
              </div>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(v.monto_aplicado)}</span>
              <button onClick={() => quitar(v)} disabled={!!ocupado} style={{ ...BTN(false, ROJO), color: ROJO, padding: '2px 8px' }}>Quitar</button>
            </div>
          ))}
        </Sec>
      )}
      {/* 5 · Historial de la línea */}
      {(hist.length > 0 || mov.clasificado_at) && (
        <Sec t="5 · Historial">
          {mov.clasificado_at && <div style={{ fontSize: 11.5, color: SLATE, marginBottom: 4 }}>Última clasificación: {fF(mov.clasificado_at)}{mov.clasif_origen ? ` · ${ORIGEN_L[mov.clasif_origen] ?? mov.clasif_origen}` : ''}{mov.clasif_revisado_at ? ` · revisada ${fF(mov.clasif_revisado_at)}` : ''}</div>}
          {hist.map(h => (
            <div key={h.id} style={{ fontSize: 11.5, padding: '3px 0', borderBottom: `1px dashed ${BORDE}` }}>
              <span style={{ color: SLATE }}>{String(h.created_at).slice(0, 16).replace('T', ' ')} · {h.usuario_nombre ?? 'sistema'}:</span> {describirCambios(h.cambios, plan)}
            </div>
          ))}
          {hist.length === 0 && <div style={{ fontSize: 11.5, color: SLATE }}>Sin cambios registrados.</div>}
        </Sec>
      )}
    </div>
  )
}
