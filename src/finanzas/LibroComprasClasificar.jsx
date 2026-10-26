import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ResumenImputacion } from './ResumenImputacion'
import { supabase } from '../supabase'
import { toast } from 'sonner'
import { FileText } from 'lucide-react'
import { DataGrid } from './conciliacion/DataGrid'

/* ══════════════════════════════════════════════════════════════════════
   LIBRO DE COMPRAS — IMPUTACIÓN CONTABLE (v3, dos niveles)
   Patrón AP estándar (SAP FI-AP / Oracle Payables / Dynamics 365):
   el objeto maestro es el PROVEEDOR; la factura hereda.
     · Nivel 1 · Proveedores: una fila por proveedor con su regla (cuenta,
       CECO, plazo). Confirmar aquí ajusta todas sus facturas en cascada.
     · Nivel 2 · Facturas: detalle línea a línea para excepciones, con
       aging por VENCIMIENTO real (emisión + plazo del proveedor).
   Backend: fn_clasificar_proveedor, fn_clasificar_factura,
   fn_asignar_ceco_proveedor, v_libro_compras_clasificacion,
   v_libro_compras_proveedores, cont_reglas_proveedor.plazo_credito_dias.
   ══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73'
const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const fmt = n => (n == null || n === '' ? '' : new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n))))
const fmtRut = r => { const s = String(r || ''); return s.length > 1 ? s.slice(0, -1) + '-' + s.slice(-1) : s }
const INPUT = { fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: INK }
const MONO = { fontFamily: 'ui-monospace, monospace' }
const hoyMs = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) }
const diasVencida = (fechaEmision, plazo) => {
  if (!fechaEmision) return null
  const [a, m, d] = String(fechaEmision).slice(0, 10).split('-').map(Number)
  return Math.round((hoyMs() - Date.UTC(a, m - 1, d + (plazo ?? 30))) / 86400000)
}

const ORIGEN = {
  pendiente:        { l: 'Sin clasificar',  c: ROJO,  bg: '#FEF2F2', desc: 'Cayó en 1810101 Pendientes. Asignar cuenta.' },
  regla_automatica: { l: 'Sugerida',        c: AMBAR, bg: '#FFFBEB', desc: 'Cuenta propuesta por el sistema. Confirmar en el nivel Proveedores.' },
  por_oc:           { l: 'Mercadería (OC)', c: SLATE, bg: null,      desc: 'Factura con OC → inventario por defecto.' },
  din:              { l: 'DIN importación', c: SLATE, bg: null,      desc: 'Mercadería en tránsito.' },
  regla_manual:     { l: 'Confirmada',      c: VERDE, bg: null,      desc: 'Regla del proveedor fijada. Las próximas facturas van solas.' },
  clasificada:      { l: 'Clasificada',     c: VERDE, bg: null,      desc: 'Cuenta asignada a esta factura.' },
  sin_asiento:      { l: 'Sin asiento',     c: SLATE, bg: null,      desc: 'Aún no contabilizada (motor nocturno).' },
}
const PAGO = {
  pagada: { l: 'Pagada', c: VERDE }, parcial: { l: 'Parcial', c: AMBAR }, pendiente: { l: 'Por pagar', c: ROJO },
  no_conciliable: { l: 'No conciliable', c: SLATE }, nc: { l: 'Nota de crédito', c: SLATE },
}
const REGLA = {
  sin_regla:  { l: 'Sin regla',  c: ROJO,  bg: '#FEF2F2', desc: 'El proveedor no tiene cuenta definida. Asignarla aquí clasifica todas sus facturas.' },
  sugerida:   { l: 'Sugerida',   c: AMBAR, bg: '#FFFBEB', desc: 'Cuenta propuesta por el sistema (OC / pagos históricos). Confirmar con ✓ o cambiarla.' },
  confirmada: { l: 'Confirmada', c: VERDE, bg: null,      desc: 'Regla fijada manualmente. Las próximas facturas llegan clasificadas.' },
}
const PLAZOS = [[0, 'Contado'], [7, '7 días'], [15, '15 días'], [30, '30 días'], [45, '45 días'], [60, '60 días'], [90, '90 días']]
const TIPO_DOC = c => (c === '61' ? 'NC' : c === '914' ? 'DIN' : 'Fact')

const CHIPS_PROV = [['trabajo', 'Por trabajar'], ['sin_regla', 'Sin regla'], ['sugerida', 'Sugeridos'], ['confirmada', 'Confirmados'], ['todos', 'Todos']]
const CHIPS_FACT = [['trabajo', 'Por trabajar'], ['sugerencia', '✦ Con sugerencia'], ['pendiente', 'Sin clasificar'], ['regla_automatica', 'Sugeridas'], ['regla_manual', 'Confirmadas'], ['todos', 'Todas']]

function Kpi({ label, valor, detalle, color }) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 140, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color || INK, ...MONO, marginTop: 3 }}>{valor}</div>
      {detalle && <div style={{ fontSize: 10, color: SLATE, marginTop: 2 }}>{detalle}</div>}
    </div>
  )
}
const Badge = ({ l, c, title }) => <span title={title} style={{ fontSize: 10.5, fontWeight: 700, color: c, whiteSpace: 'nowrap' }}>{l}</span>
// Cuenta del plan único (misma subcuenta que el banco) y, en gris, la cuenta contable formal a la que lleva
const CuentaPlan = ({ sc, sn, c, cn }) => sc
  ? <span title={`Cuenta contable ${c ?? ''} ${cn ?? ''}`}><span style={{ ...MONO, fontSize: 11, fontWeight: 700, color: NAVY }}>{sc}</span> <span style={{ fontSize: 11 }}>{sn}</span> <span style={{ ...MONO, fontSize: 9.5, color: SLATE }}>→ {c}</span></span>
  : <span title={c ? `Hoy en la cuenta contable ${c} ${cn ?? ''}: elige la subcuenta del plan único` : ''}><span style={{ fontSize: 11, color: AMBAR, fontWeight: 600 }}>elegir subcuenta</span>{c ? <span style={{ ...MONO, fontSize: 9.5, color: SLATE }}> · hoy {c} {cn}</span> : null}</span>
// Centro de costo del plan único (los mismos 15 del banco: área · sede). La sede contable se deriva del centro.
const confColor = c => (c >= 85 ? VERDE : c >= 70 ? AMBAR : SLATE)
const ORIGEN_CENTRO = {
  banco_pago: 'Tomado del pago bancario de esta factura',
  banco_pago_cambia_sede: 'Tomado del pago bancario de esta factura (se corrigió la sede para que coincida con el banco)',
  banco_habitual: 'Centro habitual del proveedor en el banco',
  habitual_banco: 'Centro habitual del proveedor en el banco',
  derivado_banco: 'Centro de los pagos del proveedor en el banco',
  sugerido_subcuenta: 'Sugerido: el centro que más usas en el banco para esta subcuenta en esta sede. Confírmalo o cámbialo',
  sugerido_area: 'Sugerido: el área que más usas en el banco para esta cuenta, en la sede de la factura. Confírmalo o cámbialo',
  sugerido_sede: 'Sugerido: el centro que más usas en el banco en esta sede. Confírmalo o cámbialo',
  sugerido: 'Sugerido a partir de sus facturas. Confírmalo o cámbialo',
}
// Centro de costo del plan único (los mismos 15 del banco: área · sede). "sug." = sugerido por el banco; "≠ banco" = el pago está en otro centro
const CentroPlan = ({ cc, cn, sede, requiere, origen, bc, bn }) => {
  const o = String(origen ?? '').replace(/^proveedor:/, '')
  const sug = o.startsWith('sugerido')
  const distinto = !!bc && bc !== cc
  return (
    <span>
      {cc
        ? <span title={`${ORIGEN_CENTRO[o] ?? 'Asignado a mano'} · sede contable ${sede ?? ''}`}><span style={{ ...MONO, fontSize: 11, fontWeight: 700, color: NAVY }}>{cc}</span> <span style={{ fontSize: 11 }}>{cn}</span>{sug && <span style={{ fontSize: 9.5, fontWeight: 700, color: AMBAR, marginLeft: 4 }}>sug.</span>}</span>
        : !requiere
          ? <span style={{ fontSize: 11, color: SLATE }} title="La cuenta madre de esta subcuenta no lleva centro de costo">no aplica{sede ? ` · ${sede}` : ''}</span>
          : <span title={sede ? `Hoy en la sede ${sede}: elige el centro (área · sede) igual que en el banco` : 'Sin centro de costo'}><span style={{ fontSize: 11, color: AMBAR, fontWeight: 600 }}>elegir centro</span>{sede ? <span style={{ fontSize: 9.5, color: SLATE }}> · hoy {sede}</span> : null}</span>}
      {distinto && <span title={`El pago de esta factura está clasificado en el banco en ${bc} ${bn ?? ''}`} style={{ fontSize: 9.5, fontWeight: 700, color: ROJO, marginLeft: 5 }}>≠ banco {bc}</span>}
    </span>
  )
}
const CeldaEdit = ({ vacio, children, onOpen, title }) => (
  <span onClick={e => { e.stopPropagation(); onOpen(e.currentTarget.getBoundingClientRect()) }} title={title}
    style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, borderBottom: '1px dashed #C7CBD1' }}>
    {vacio ? <span style={{ color: ROJO, fontSize: 11, fontWeight: 600 }}>{vacio}</span> : children}
  </span>
)

/* ── Combobox flotante (position:fixed → no lo recorta el overflow de la grilla) ── */
function ComboPopup({ rect, options, placeholder, onPick, onClose }) {
  const [q, setQ] = useState('')
  const ref = useRef(null)
  useEffect(() => {
    const fuera = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const esc = e => { if (e.key === 'Escape') onClose() }
    const scroll = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const sinTilde = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const palabras = sinTilde(q).trim().split(/\s+/).filter(Boolean)   // código o nombre, sin tildes, palabras en cualquier orden
  const lista = (palabras.length ? options.filter(o => { const h = sinTilde(`${o.label} ${o.sub ?? ''}`); return palabras.every(p => h.includes(p)) }) : options).slice(0, 60)
  const abajo = rect.bottom + 300 < window.innerHeight
  const pos = abajo ? { top: rect.bottom + 2 } : { bottom: window.innerHeight - rect.top + 2 }
  return (
    <div ref={ref} style={{
      position: 'fixed', left: Math.min(rect.left, window.innerWidth - 410), ...pos, width: 400, zIndex: 300,
      background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.18)', overflow: 'hidden',
    }}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder}
        onKeyDown={e => { if (e.key === 'Enter' && lista.length) onPick(lista[0].value) }}
        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 12, border: 'none', borderBottom: `1px solid ${BORDE}`, outline: 'none' }} />
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {lista.length === 0 && <div style={{ padding: 10, fontSize: 11, color: SLATE }}>Sin coincidencias</div>}
        {lista.map(o => (
          <div key={o.value} onClick={() => onPick(o.value)}
            style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: INK, borderBottom: '1px solid #F8FAFC' }}
            onMouseEnter={e => e.currentTarget.style.background = '#F0F4FF'}
            onMouseLeave={e => e.currentTarget.style.background = ''}>
            {o.label}
            {o.sub && <div style={{ fontSize: 10.5, color: SLATE, marginTop: 1 }}>{o.sub}</div>}
          </div>
        ))}
        {options.length > 60 && lista.length === 60 && <div style={{ padding: '5px 10px', fontSize: 10, color: SLATE }}>Escriba para afinar ({options.length} en total)</div>}
      </div>
    </div>
  )
}

export function LibroComprasClasificar({ cu }) {
  const [nivel, setNivel] = useState('proveedores')     // 'proveedores' | 'facturas'
  const [provs, setProvs] = useState([])
  const [filas, setFilas] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [centros, setCentros] = useState([])   // los 15 centros de costo del banco (área · sede)
  const [cecos, setCecos] = useState([])
  const [chipP, setChipP] = useState('trabajo')
  const [chipF, setChipF] = useState('trabajo')
  const [periodo, setPeriodo] = useState('todos')
  const [pago, setPago] = useState('todos')
  const [marcados, setMarcados] = useState(new Set())   // ruts (nivel proveedores)
  const [marcadosF, setMarcadosF] = useState(new Set())  // ids (nivel facturas)
  const [sugs, setSugs] = useState(new Map())             // sugerencias del motor por factura
  const [iaProg, setIaProg] = useState(null)              // avance de la consulta a la IA
  useEffect(() => { if (nivel === 'facturas') cargarSugs() }, [nivel]) // eslint-disable-line react-hooks/exhaustive-deps
  const [procesando, setProcesando] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [editor, setEditor] = useState(null)            // { tipo, fila, rect }

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      const [{ data: p, error: e1 }, { data: f, error: e2 }, { data: c }, { data: cc }, { data: cen }] = await Promise.all([
        supabase.from('v_lc_proveedores_imputacion').select('*').order('monto_ytd', { ascending: false }).limit(2000),
        supabase.from('v_lc_imputacion').select('*').order('fecha_emision', { ascending: false }).limit(5000),
        supabase.from('v_plan_unico_facturas').select('*').order('codigo').limit(1000),   // mismas subcuentas que el banco
        supabase.from('cecos').select('id, nombre').eq('activo', true).order('tipo').order('nombre'),
        supabase.from('centros_costo').select('id, codigo, nombre, area, ceco_id').eq('activo', true).order('codigo'),   // mismos centros que el banco
      ])
      if (e1) throw e1
      if (e2) throw e2
      setProvs(p ?? []); setFilas(f ?? []); setCuentas(c ?? []); setCecos(cc ?? []); setCentros(cen ?? [])
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { if (!silencioso) setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const cuentaOpts = useMemo(() => cuentas.map(c => ({ value: c.id, label: `${c.codigo} · ${c.nombre}`, sub: `${c.madre_codigo} ${c.madre_nombre} · cuenta ${c.plan_cuenta_factura} ${c.plan_nombre}` })), [cuentas])
  const cecoOpts = useMemo(() => cecos.map(c => ({ value: String(c.id), label: c.nombre })), [cecos])
  const plazoOpts = useMemo(() => PLAZOS.map(([v, l]) => ({ value: String(v), label: l })), [])
  const cecoOptsFactura = useMemo(() => [{ value: '__null__', label: '— sin centro de costo —' }, ...cecoOpts], [cecoOpts])
  const cuentaNom = useMemo(() => new Map(cuentas.map(c => [c.id, c])), [cuentas])   // subcuenta del plan único por id
  const cecoNom = useMemo(() => new Map(cecos.map(c => [String(c.id), c.nombre])), [cecos])
  const centroOpts = useMemo(() => centros.map(c => ({ value: c.id, label: `${c.codigo} · ${c.nombre}`, sub: `sede ${cecoNom.get(String(c.ceco_id)) ?? c.ceco_id} · área ${c.area}` })), [centros, cecoNom])
  const centroOptsFactura = useMemo(() => [{ value: '__null__', label: '— sin centro de costo —' }, ...centroOpts], [centroOpts])
  const plazoByRut = useMemo(() => new Map(provs.map(p => [p.rut, p.plazo_efectivo ?? 30])), [provs])
  const periodos = useMemo(() => [...new Set(filas.map(f => f.periodo))].sort().reverse(), [filas])

  /* ═══ NIVEL 1 · PROVEEDORES ═══ */
  const nChipP = useMemo(() => ({
    trabajo: provs.filter(p => p.estado_regla !== 'confirmada').length,
    sin_regla: provs.filter(p => p.estado_regla === 'sin_regla').length,
    sugerida: provs.filter(p => p.estado_regla === 'sugerida').length,
    confirmada: provs.filter(p => p.estado_regla === 'confirmada').length,
    todos: provs.length,
  }), [provs])
  const provVisibles = useMemo(() => {
    if (chipP === 'trabajo') return provs.filter(p => p.estado_regla !== 'confirmada')
    if (chipP === 'todos') return provs
    return provs.filter(p => p.estado_regla === chipP)
  }, [provs, chipP])

  const kpiP = useMemo(() => ({
    sinRegla: provs.filter(p => p.estado_regla === 'sin_regla').length,
    sugeridos: provs.filter(p => p.estado_regla === 'sugerida').length,
    confirmados: provs.filter(p => p.estado_regla === 'confirmada').length,
    abierto: provs.reduce((s, p) => s + Number(p.saldo_abierto || 0), 0),
    nc: provs.reduce((s, p) => s + Number(p.nc_por_aplicar || 0), 0),
    vencido: provs.reduce((s, p) => s + Number(p.saldo_vencido || 0), 0),
  }), [provs])

  function patchProv(rut, cambios) { setProvs(prev => prev.map(x => x.rut === rut ? { ...x, ...cambios } : x)) }
  function patchFacts(pred, cambios) { setFilas(prev => prev.map(x => pred(x) ? { ...x, ...cambios } : x)) }

  async function reglaCuenta(p, subId) {
    setEditor(null); setProcesando(p.rut)
    const s = cuentaNom.get(subId)
    try {
      const { data, error } = await supabase.rpc('fn_imputar_proveedor_subcuenta', { p_rut: p.rut, p_subcuenta: subId, p_usuario: cu?.id ?? 'ui' })
      if (error) throw error
      const cambios = { cuenta: data.cuenta, cuenta_nombre: s?.plan_nombre ?? '', subcuenta_id: subId, subcuenta_codigo: s?.codigo, subcuenta_nombre: s?.nombre }
      patchProv(p.rut, { ...cambios, estado_regla: 'confirmada', fuente: 'manual' })
      patchFacts(x => x.rut === p.rut && x.codigo_sii !== '914', { ...cambios, subcuenta_origen: 'proveedor', origen_clasificacion: 'regla_manual' })
      toast.success(`${p.razon_social}: ${s?.codigo ?? ''} ${s?.nombre ?? ''} · ${data.facturas_reclasificadas ?? 0} facturas ajustadas`)
      refrescar({ ruts: [p.rut] })
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  async function confirmarProv(p) {
    if (!p.cuenta) { toast.warning('El proveedor no tiene cuenta sugerida: asígnela en la celda Cuenta'); return }
    return reglaCuenta(p, p.cuenta)
  }

  async function reglaCeco(p, centroId) {
    setEditor(null); setProcesando(p.rut)
    const c = centros.find(x => x.id === centroId)
    try {
      const { data, error } = await supabase.rpc('fn_imputar_centro_proveedor', { p_rut: p.rut, p_centro: centroId, p_usuario: cu?.id ?? 'ui' })
      if (error) throw error
      const cambios = { ceco_id: data.ceco, ceco_nombre: cecoNom.get(String(data.ceco)) ?? '', centro_costo_id: centroId, centro_codigo: c?.codigo, centro_nombre: c?.nombre }
      patchProv(p.rut, { ...cambios, centro_origen: 'manual' })
      patchFacts(x => x.rut === p.rut && String(x.fecha_emision) >= '2026-01-01', { ...cambios, centro_origen: 'proveedor:manual' })
      toast.success(`${p.razon_social}: centro ${c?.codigo ?? ''} ${c?.nombre ?? ''} · ${data.facturas ?? 0} facturas`)
      refrescar({ ruts: [p.rut] })
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  async function reglaPlazo(p, plazo) {
    setEditor(null); setProcesando(p.rut)
    try {
      const { error } = await supabase.from('cont_reglas_proveedor')
        .upsert({ rut_norm: p.rut, nombre: p.razon_social, plazo_credito_dias: Number(plazo) }, { onConflict: 'rut_norm' })
      if (error) throw error
      patchProv(p.rut, { plazo_credito_dias: Number(plazo), plazo_efectivo: Number(plazo) })
      toast.success(`${p.razon_social}: plazo ${PLAZOS.find(x => x[0] === Number(plazo))?.[1] ?? plazo + ' días'}`)
      cargar(true)
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  async function cargarSugs(aviso = false) {
    const { data, error } = await supabase.rpc('fn_sugerencias_imputacion', { p_desde: '2026-01-01' })
    if (error) { toast.error(`Sugerencias: ${error.message}`); return }
    setSugs(new Map((data ?? []).map(g => [g.factura_id, g])))
    if (aviso) toast.success(`${(data ?? []).length} facturas con sugerencia`)
  }

  /* Refresco dirigido (23-oct-2026): después de guardar se traen solo las filas tocadas
     (≈50 ms para 40 facturas; ≈200 ms para 5 proveedores) en vez de recargar todo
     (la vista de proveedores completa tarda ≈1,8 s y las sugerencias ≈0,5 s). */
  async function refrescar({ ids = [], ruts = [] } = {}) {
    const idsU = [...new Set(ids)], rutsU = [...new Set(ruts)]
    const tareas = []
    for (let i = 0; i < idsU.length; i += 150) tareas.push(supabase.from('v_lc_imputacion').select('*').in('id', idsU.slice(i, i + 150)).then(r => ({ t: 'f', ...r })))
    if (rutsU.length) {
      tareas.push(supabase.from('v_lc_imputacion').select('*').in('rut', rutsU).then(r => ({ t: 'f', ...r })))
      tareas.push(supabase.from('v_lc_proveedores_imputacion').select('*').in('rut', rutsU).then(r => ({ t: 'p', ...r })))
    }
    if (!tareas.length) return
    const res = await Promise.all(tareas)
    if (res.some(r => r.error)) { cargar(true); return }
    const porId = new Map(), vistas = new Set()
    for (const f of res.filter(r => r.t === 'f').flatMap(r => r.data ?? [])) {
      const k = `${f.id}|${f.linea_destino_id ?? ''}|${f.cuenta ?? ''}`
      if (vistas.has(k)) continue
      vistas.add(k)
      if (!porId.has(f.id)) porId.set(f.id, [])
      porId.get(f.id).push(f)
    }
    const tocadas = new Set([...idsU, ...porId.keys()])
    if (tocadas.size) setFilas(prev => {
      const usados = new Set(), out = []
      for (const f of prev) {
        if (!tocadas.has(f.id)) { out.push(f); continue }
        if (usados.has(f.id)) continue
        usados.add(f.id)
        out.push(...(porId.get(f.id) ?? []))
      }
      for (const [id, rows] of porId) if (!usados.has(id)) out.push(...rows)
      return out
    })
    const provs = res.filter(r => r.t === 'p').flatMap(r => r.data ?? [])
    if (provs.length) { const m = new Map(provs.map(p => [p.rut, p])); setProvs(prev => prev.map(p => m.get(p.rut) ?? p)) }
    // la sugerencia ya aplicada desaparece sin recalcular el motor
    setSugs(prev => {
      let cambio = false
      const n = new Map(prev)
      for (const id of tocadas) {
        const g = n.get(id), row = (porId.get(id) ?? [])[0]
        if (!g || !row) continue
        const subOk = !g.sub_id || g.sub_id === row.subcuenta_id
        const cenOk = !g.centro_id || (g.centro_id === row.centro_costo_id && !String(row.centro_origen ?? '').includes('sugerido'))
        if (subOk && cenOk) { n.delete(id); cambio = true }
      }
      return cambio ? n : prev
    })
  }

  const necesitaIA = f => !f.subcuenta_id || (f.requiere_centro !== false && !f.centro_costo_id)
  // Combina dos sugerencias de la misma factura: en cada parte (subcuenta / centro) gana la de mayor confianza
  const mezclarSug = (a, b) => {
    if (!a) return b
    const S = b.sub_id && (!a.sub_id || (b.sub_conf ?? 0) >= (a.sub_conf ?? 0)) ? b : a
    const C = b.centro_id && (!a.centro_id || (b.centro_conf ?? 0) >= (a.centro_conf ?? 0)) ? b : a
    return {
      factura_id: a.factura_id,
      sub_id: S.sub_id, sub_codigo: S.sub_codigo, sub_nombre: S.sub_nombre, sub_conf: S.sub_conf, sub_fuente: S.sub_fuente, sub_motivo: S.sub_motivo, sub_cambia_cuenta: S.sub_cambia_cuenta,
      centro_id: C.centro_id, centro_codigo: C.centro_codigo, centro_nombre: C.centro_nombre, centro_conf: C.centro_conf, centro_fuente: C.centro_fuente, centro_motivo: C.centro_motivo, centro_cambia_sede: C.centro_cambia_sede,
    }
  }

  // IA (Edge Function sugerir-imputacion-ia): lotes de 20, hasta 100 facturas por consulta
  async function pedirIA(ids) {
    const lista = [...new Set(ids)].slice(0, 100)
    if (!lista.length) { toast.info('No hay facturas para consultar a la IA'); return }
    setProcesando('ia')
    const filaDe = new Map()
    for (const f of filas) if (!filaDe.has(f.id)) filaDe.set(f.id, f)
    let ok = 0, err = 0, ultimo = ''
    const nuevas = []
    for (let i = 0; i < lista.length; i += 20) {
      setIaProg(`IA ${Math.min(i + 20, lista.length)} de ${lista.length}…`)
      const parte = lista.slice(i, i + 20)
      const { data, error } = await supabase.functions.invoke('sugerir-imputacion-ia', { body: { factura_ids: parte } })
      if (error) {
        let m = error.message
        try { const b = await error.context?.json?.(); if (b?.error) m = b.error } catch { /* sin detalle */ }
        err += parte.length; ultimo = m; continue
      }
      for (const r of data?.resultados ?? []) {
        if (!r.ok) { err++; ultimo = r.error; continue }
        ok++
        const fila = filaDe.get(r.factura_id) ?? {}
        nuevas.push({
          factura_id: r.factura_id,
          sub_id: r.subcuenta_id && r.subcuenta_id !== fila.subcuenta_id ? r.subcuenta_id : null,
          sub_codigo: r.subcuenta_codigo, sub_nombre: r.subcuenta_nombre, sub_conf: Math.min(r.confianza ?? 0, 90), sub_fuente: 'ia', sub_motivo: `IA: ${r.razon}`, sub_cambia_cuenta: !!r.cambia_cuenta,
          centro_id: r.ceco_id && r.ceco_id !== fila.centro_costo_id ? r.ceco_id : null,
          centro_codigo: r.ceco_codigo, centro_nombre: r.ceco_nombre, centro_conf: Math.min(r.ceco_confianza ?? r.confianza ?? 0, 90), centro_fuente: 'ia', centro_motivo: `IA: ${r.razon}`, centro_cambia_sede: !!r.cambia_sede,
        })
      }
    }
    setIaProg(null); setProcesando(null)
    setSugs(prev => {
      const n = new Map(prev)
      for (const g of nuevas) if (g.sub_id || g.centro_id) n.set(g.factura_id, mezclarSug(n.get(g.factura_id), g))
      return n
    })
    const conPropuesta = nuevas.filter(g => g.sub_id || g.centro_id).length
    if (err) toast.error(`IA: ${ok} respondidas, ${err} con error (${ultimo})`)
    else toast.success(`IA: ${ok} factura${ok === 1 ? '' : 's'} analizada${ok === 1 ? '' : 's'} · ${conPropuesta} con propuesta${ok - conPropuesta ? ` · ${ok - conPropuesta} ya estaban bien` : ''}`)
  }

  // Aplica ítems {factura_id, subcuenta_id?, centro_costo_id?} por lotes de 40; uno que falle no frena a los demás
  async function loteFacturas(items, titulo) {
    if (!items.length) return
    setProcesando('masivoF')
    let ok = 0, err = 0, ultimo = ''
    for (let i = 0; i < items.length; i += 40) {
      const parte = items.slice(i, i + 40)
      const { data, error } = await supabase.rpc('fn_imputar_facturas_lote', { p_items: parte, p_usuario: cu?.id ?? 'ui' })
      if (error) { err += parte.length; ultimo = error.message } else { ok += data?.ok ?? 0; err += data?.errores ?? 0; if (data?.detalle?.length) ultimo = data.detalle[0].error }
    }
    setProcesando(null)
    if (err) toast.error(`${titulo}: ${ok} aplicadas, ${err} con error (${ultimo})`)
    else toast.success(`${titulo}: ${ok} factura${ok === 1 ? '' : 's'}`)
    setMarcadosF(new Set())
    await refrescar({ ids: items.map(x => x.factura_id) })
  }

  function aplicarSugerencias(ids) {
    const lista = ids.map(id => sugs.get(id)).filter(Boolean)
    const items = lista.map(g => ({ factura_id: g.factura_id, ...(g.sub_id ? { subcuenta_id: g.sub_id } : {}), ...(g.centro_id ? { centro_costo_id: g.centro_id } : {}) }))
    if (!items.length) { toast.warning('La selección no tiene sugerencias'); return }
    const cambian = lista.filter(g => g.sub_cambia_cuenta || g.centro_cambia_sede).length
    if ((items.length > 1 || cambian) && !window.confirm(`¿Aceptar ${items.length} sugerencia${items.length === 1 ? '' : 's'}?${cambian ? `\n${cambian} cambian la cuenta contable o la sede de la factura.` : ''}`)) return
    return loteFacturas(items, 'Sugerencias aceptadas')
  }

  function asignarMasivoF(tipo, valor) {
    setEditor(null)
    const ids = [...marcadosF]
    const nombre = tipo === 'sub' ? (cuentaNom.get(valor)?.codigo ?? '') + ' ' + (cuentaNom.get(valor)?.nombre ?? '') : (valor === '__null__' ? 'sin centro de costo' : centros.find(c => c.id === valor)?.nombre ?? '')
    if (!window.confirm(`¿Asignar ${nombre.trim()} a ${ids.length} factura${ids.length === 1 ? '' : 's'}?`)) return
    const items = ids.map(id => (tipo === 'sub' ? { factura_id: id, subcuenta_id: valor } : { factura_id: id, centro_costo_id: valor === '__null__' ? null : valor }))
    return loteFacturas(items, tipo === 'sub' ? 'Subcuenta asignada' : 'Centro asignado')
  }

  async function asignarMasivoP(tipo, valor) {
    setEditor(null)
    const ruts = [...marcados]
    const nombre = tipo === 'sub' ? `${cuentaNom.get(valor)?.codigo ?? ''} ${cuentaNom.get(valor)?.nombre ?? ''}` : `${centros.find(c => c.id === valor)?.codigo ?? ''} ${centros.find(c => c.id === valor)?.nombre ?? ''}`
    if (!window.confirm(`¿Asignar ${nombre.trim()} a ${ruts.length} proveedor${ruts.length === 1 ? '' : 'es'}? Se ajustan todas sus facturas.`)) return
    setProcesando('masivo')
    let ok = 0, err = 0, facts = 0, ultimo = ''
    for (let i = 0; i < ruts.length; i += 5) {
      const items = ruts.slice(i, i + 5).map(rut => (tipo === 'sub' ? { rut, subcuenta_id: valor } : { rut, centro_costo_id: valor }))
      const { data, error } = await supabase.rpc('fn_imputar_proveedores_lote', { p_items: items, p_usuario: cu?.id ?? 'ui' })
      if (error) { err += items.length; ultimo = error.message } else { ok += data?.ok ?? 0; err += data?.errores ?? 0; facts += data?.facturas ?? 0; if (data?.detalle?.length) ultimo = data.detalle[0].error }
    }
    setProcesando(null)
    if (err) toast.error(`${ok} proveedores ajustados, ${err} con error (${ultimo})`)
    else toast.success(`${ok} proveedores · ${facts} facturas ajustadas`)
    setMarcados(new Set())
    refrescar({ ruts })
  }

  async function confirmarMasivo() {
    const lista = provVisibles.filter(p => marcados.has(p.rut) && p.estado_regla === 'sugerida' && p.cuenta)
    if (!lista.length) { toast.warning('La selección no tiene proveedores sugeridos con cuenta'); return }
    if (!window.confirm(`Confirmar la cuenta sugerida de ${lista.length} proveedores? Se ajustarán todas sus facturas.`)) return
    setProcesando('masivo')
    let ok = 0, err = 0, facts = 0
    for (const p of lista) {
      const { data, error } = await supabase.rpc('fn_clasificar_proveedor', { p_rut: p.rut, p_cuenta: p.cuenta, p_usuario: cu?.id ?? 'ui' })
      if (error) err++
      else { ok++; facts += data?.facturas_reclasificadas ?? 0; patchProv(p.rut, { estado_regla: 'confirmada', fuente: 'manual' }) }
    }
    toast.success(`${ok} proveedores confirmados · ${facts} facturas ajustadas${err ? ` · ${err} errores` : ''}`)
    setMarcados(new Set()); setProcesando(null); refrescar({ ruts: lista.map(p => p.rut) })
  }

  const colsProv = useMemo(() => [
    { key: 'razon_social', label: 'Proveedor', width: 250, value: p => `${p.razon_social ?? ''} ${p.rut ?? ''}`,
      render: p => <span title={`${p.razon_social} · ${fmtRut(p.rut)}`}>{p.razon_social} <span style={{ color: SLATE, fontSize: 10 }}>{fmtRut(p.rut)}</span></span> },
    { key: 'n_facturas', label: 'Facts', width: 62, align: 'right', value: p => Number(p.n_facturas) || 0,
      render: p => <span style={MONO}>{p.n_facturas}{Number(p.n_nc) > 0 ? <span style={{ color: SLATE, fontSize: 10 }}> +{p.n_nc}NC</span> : ''}</span> },
    { key: 'monto_ytd', label: 'Monto 2026', width: 110, align: 'right', value: p => Number(p.monto_ytd) || 0,
      render: p => <span style={{ ...MONO, fontWeight: 600 }}>{fmt(p.monto_ytd)}</span>, exportValue: p => Number(p.monto_ytd) || 0 },
    { key: 'ultima_fecha', label: 'Última', width: 84 },
    { key: 'cuenta', label: 'Cuenta (plan único)', width: 290, value: p => `${p.subcuenta_codigo ?? ''} ${p.subcuenta_nombre ?? ''} ${p.cuenta ?? ''} ${p.cuenta_nombre ?? ''}`,
      render: p => (
        <span style={{ opacity: procesando === p.rut ? 0.4 : 1 }}>
          <CeldaEdit vacio={!p.cuenta ? '— asignar subcuenta —' : ''} title="Clic para definir la subcuenta del proveedor (la misma del banco; ajusta todas sus facturas)"
            onOpen={rect => setEditor({ tipo: 'prov_cuenta', fila: p, rect })}>
            <CuentaPlan sc={p.subcuenta_codigo} sn={p.subcuenta_nombre} c={p.cuenta} cn={p.cuenta_nombre} />
          </CeldaEdit>
        </span>
      ) },
    { key: 'ceco_id', label: 'Centro de costo', width: 200, value: p => `${p.centro_codigo ?? ''} ${p.centro_nombre ?? ''} ${p.ceco_nombre ?? ''}`,
      render: p => (
        <CeldaEdit title="Clic para asignar el centro de costo del proveedor (el mismo del banco; ajusta todas sus facturas)" onOpen={rect => setEditor({ tipo: 'prov_ceco', fila: p, rect })}>
          <CentroPlan cc={p.centro_codigo} cn={p.centro_nombre} sede={p.ceco_nombre} requiere={p.requiere_centro !== false} origen={p.centro_origen} />
        </CeldaEdit>
      ) },
    { key: 'plazo_efectivo', label: 'Plazo', width: 84, align: 'right', value: p => Number(p.plazo_efectivo) || 30,
      render: p => (
        <CeldaEdit title="Plazo de crédito del proveedor: define el vencimiento de sus facturas" onOpen={rect => setEditor({ tipo: 'prov_plazo', fila: p, rect })}>
          <span style={{ fontSize: 11, color: p.plazo_credito_dias == null ? SLATE : INK }}>
            {Number(p.plazo_efectivo) === 0 ? 'Contado' : `${p.plazo_efectivo}d`}{p.plazo_credito_dias == null ? ' *' : ''}
          </span>
        </CeldaEdit>
      ) },
    { key: 'estado_regla', label: 'Regla', width: 132, value: p => REGLA[p.estado_regla]?.l ?? p.estado_regla,
      render: p => {
        const r = REGLA[p.estado_regla] || {}
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Badge l={r.l} c={r.c} title={r.desc} />
            {p.estado_regla === 'sugerida' && (
              <button onClick={e => { e.stopPropagation(); confirmarProv(p) }} disabled={procesando === p.rut}
                title={`Confirmar ${p.cuenta} como regla del proveedor`}
                style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: VERDE, border: 'none', borderRadius: 5, padding: '2px 7px', cursor: 'pointer' }}>✓</button>
            )}
          </span>
        )
      } },
    { key: 'n_sugeridas', label: 'Por revisar', width: 86, align: 'right', value: p => Number(p.n_sin_cuenta || 0) + Number(p.n_sugeridas || 0),
      render: p => { const n = Number(p.n_sin_cuenta || 0) + Number(p.n_sugeridas || 0); return n ? <span style={{ ...MONO, color: AMBAR, fontWeight: 600 }}>{n}</span> : '' } },
    { key: 'nc_por_aplicar', label: 'NC por aplicar', width: 105, align: 'right', value: p => Number(p.nc_por_aplicar) || 0,
      render: p => Number(p.nc_por_aplicar) > 1
        ? <span style={{ ...MONO, color: AMBAR }} title="Notas de crédito aún no imputadas a una factura. Ya están descontadas del saldo abierto.">−{fmt(p.nc_por_aplicar)}</span>
        : '', exportValue: p => Number(p.nc_por_aplicar) || 0 },
    { key: 'saldo_abierto', label: 'Saldo abierto', width: 110, align: 'right', value: p => Number(p.saldo_abierto) || 0,
      render: p => {
        const v = Number(p.saldo_abierto) || 0
        if (v > 1) return <span style={MONO}>{fmt(v)}</span>
        if (v < -1) return <span style={{ ...MONO, color: VERDE }} title="Las notas de crédito superan la deuda: hay saldo a favor con este proveedor">{fmt(v)}</span>
        return ''
      }, exportValue: p => Number(p.saldo_abierto) || 0 },
    { key: 'saldo_vencido', label: 'Vencido', width: 105, align: 'right', value: p => Number(p.saldo_vencido) || 0,
      render: p => Number(p.saldo_vencido) > 1 ? <span style={{ ...MONO, color: ROJO, fontWeight: 600 }}>{fmt(p.saldo_vencido)}</span> : '', exportValue: p => Number(p.saldo_vencido) || 0 },
  ], [procesando, cuentaNom, cecoNom])

  /* ═══ NIVEL 2 · FACTURAS ═══ */
  const universo = useMemo(() => filas.filter(f =>
    (periodo === 'todos' || f.periodo === periodo) &&
    (pago === 'todos' || f.estado_pago === pago)), [filas, periodo, pago])
  const nChipF = useMemo(() => ({
    trabajo: universo.filter(f => ['pendiente', 'regla_automatica'].includes(f.origen_clasificacion)).length,
    pendiente: universo.filter(f => f.origen_clasificacion === 'pendiente').length,
    regla_automatica: universo.filter(f => f.origen_clasificacion === 'regla_automatica').length,
    regla_manual: universo.filter(f => f.origen_clasificacion === 'regla_manual').length,
    todos: universo.length,
    sugerencia: universo.filter(f => sugs.has(f.id)).length,
  }), [universo, sugs])
  const factVisibles = useMemo(() => {
    if (chipF === 'trabajo') return universo.filter(f => ['pendiente', 'regla_automatica'].includes(f.origen_clasificacion))
    if (chipF === 'sugerencia') return universo.filter(f => sugs.has(f.id))
    if (chipF === 'todos') return universo
    return universo.filter(f => f.origen_clasificacion === chipF)
  }, [universo, chipF, sugs])
  // candidatas a IA: les falta subcuenta o centro y no tienen sugerencia, o la que tienen es débil (< 70%) y no viene de la IA
  const candidatasIA = useMemo(() => [...new Set(factVisibles.filter(f => necesitaIA(f) && (() => { const g = sugs.get(f.id); return !g || (g.sub_fuente !== 'ia' && (g.sub_conf ?? 0) < 70) })()).map(f => f.id))], [factVisibles, sugs]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Abre el DTE oficial (visor BSALE) en pestaña nueva. La URL se busca al
     momento del clic — nunca en la carga de la grilla — y la ventana se abre
     de forma síncrona para que el bloqueador de popups no la mate. */
  async function abrirDte(f) {
    // La pestaña se abre de forma SÍNCRONA con el clic: si se abriera después
    // del await, el bloqueador de ventanas emergentes la descartaría.
    // OJO: no se debe pasar 'noopener' en las features — con esa bandera
    // window.open devuelve null por especificación y queda una pestaña en blanco.
    const win = window.open('', '_blank')
    if (!win || win.closed) {
      toast.error('El navegador bloqueó la ventana. Permita las ventanas emergentes de este sitio.')
      return
    }
    try { win.opener = null } catch { /* algunos navegadores no permiten escribirlo */ }
    try {
      win.document.write('<!doctype html><meta charset="utf-8"><title>Abriendo documento…</title>'
        + '<body style="margin:0;font:14px system-ui,-apple-system,sans-serif;color:#475569;padding:28px">Abriendo el documento…</body>')
      win.document.close()
    } catch { /* si no se puede escribir, se navega igual */ }
    try {
      const { data, error } = await supabase.from('libro_compras').select('url_pdf').eq('id', f.id).single()
      if (error) throw error
      const url = data?.url_pdf
      if (url) {
        win.location.replace(url)
      } else {
        try { win.close() } catch { /* ya cerrada */ }
        toast.info(`${TIPO_DOC(f.codigo_sii)} ${f.folio}: sin documento digital (no vino de BSALE)`)
      }
    } catch (e) {
      try { win.close() } catch { /* ya cerrada */ }
      toast.error(e?.message || 'No se pudo abrir el documento')
    }
  }

  async function cecoFactura(f, centroId) {
    setEditor(null); setProcesando(f.id)
    const c = centroId ? centros.find(x => x.id === centroId) : null
    try {
      const { data, error } = await supabase.rpc('fn_imputar_centro_factura', { p_factura_id: f.id, p_centro: centroId, p_usuario: cu?.id ?? 'ui' })
      if (error) throw error
      patchFacts(x => x.id === f.id, { ceco_id: data.ceco ?? null, ceco_nombre: data.ceco ? (cecoNom.get(String(data.ceco)) ?? '') : null, centro_costo_id: centroId, centro_codigo: c?.codigo ?? null, centro_nombre: c?.nombre ?? null, centro_origen: centroId ? 'manual' : null })
      toast.success(centroId ? `Factura ${f.folio} → ${c?.codigo ?? ''} ${c?.nombre ?? ''} (solo esta factura)` : `Factura ${f.folio}: sin centro de costo`)
      refrescar({ ids: [f.id] })
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  async function cuentaFactura(f, subId) {
    setEditor(null); setProcesando(f.id)
    const s = cuentaNom.get(subId)
    try {
      const { data, error } = await supabase.rpc('fn_imputar_factura_subcuenta', { p_factura_id: f.id, p_subcuenta: subId, p_usuario: cu?.id ?? 'ui' })
      if (error) throw error
      patchFacts(x => x.id === f.id, { cuenta: data.cuenta, cuenta_nombre: s?.plan_nombre ?? '', subcuenta_id: subId, subcuenta_codigo: s?.codigo, subcuenta_nombre: s?.nombre, subcuenta_origen: 'factura', ...(data.reclasificado ? { origen_clasificacion: 'clasificada' } : {}) })
      toast.success(`Factura ${f.folio} → ${s?.codigo ?? ''} ${s?.nombre ?? ''}${data.reclasificado ? ` (cuenta contable ${data.cuenta})` : ''} · solo esta factura`)
      refrescar({ ids: [f.id] })
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  const colsFact = useMemo(() => [
    { key: 'fecha_emision', label: 'Fecha', width: 84 },
    { key: 'doc', label: 'Doc', width: 92, value: f => `${TIPO_DOC(f.codigo_sii)} ${f.folio ?? ''}`,
      render: f => (
        <span onClick={e => { e.stopPropagation(); abrirDte(f) }} title="Ver el documento (DTE) en pestaña nueva"
          style={{ fontSize: 11, cursor: 'pointer', color: '#1D4ED8', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <FileText size={12} /> {TIPO_DOC(f.codigo_sii)} <b>{f.folio}</b>
        </span>
      ) },
    { key: 'razon_social', label: 'Proveedor', width: 230, value: f => `${f.razon_social ?? ''} ${f.rut ?? ''}`,
      render: f => <span title={`${f.razon_social} · ${fmtRut(f.rut)}`}>{f.razon_social} <span style={{ color: SLATE, fontSize: 10 }}>{fmtRut(f.rut)}</span></span> },
    { key: 'monto_libro', label: 'Total', width: 100, align: 'right', value: f => Number(f.monto_libro ?? f.monto_total) || 0,
      render: f => { const v = Number(f.monto_libro ?? f.monto_total) || 0
        return <span style={{ ...MONO, fontWeight: 600, color: v < 0 ? AMBAR : INK }}>{fmt(v)}</span> },
      exportValue: f => Number(f.monto_libro ?? f.monto_total) || 0 },
    { key: 'cuenta', label: 'Cuenta (plan único)', width: 290, value: f => `${f.subcuenta_codigo ?? ''} ${f.subcuenta_nombre ?? ''} ${f.cuenta ?? ''} ${f.cuenta_nombre ?? ''}`,
      render: f => (
        <span style={{ opacity: procesando === f.id ? 0.4 : 1 }}>
          <CeldaEdit vacio={!f.cuenta || f.cuenta === '1810101' ? '— asignar subcuenta —' : ''}
            title="Clic para cambiar la subcuenta de ESTA factura (excepción puntual, no toca la regla del proveedor)"
            onOpen={rect => setEditor({ tipo: 'fact_cuenta', fila: f, rect })}>
            <CuentaPlan sc={f.subcuenta_codigo} sn={f.subcuenta_nombre} c={f.cuenta} cn={f.cuenta_nombre} />
          </CeldaEdit>
        </span>
      ) },
    { key: 'ceco_nombre', label: 'Centro de costo', width: 200, value: f => `${f.centro_codigo ?? ''} ${f.centro_nombre ?? ''} ${f.ceco_nombre ?? (cecoNom.get(String(f.ceco_id ?? '')) ?? '')}`,
      render: f => {
        const sede = f.ceco_nombre ?? cecoNom.get(String(f.ceco_id ?? '')) ?? null
        return (
          <span style={{ opacity: procesando === f.id ? 0.4 : 1 }}>
            <CeldaEdit title="Clic para cambiar el centro de costo de ESTA factura (excepción; no toca la regla del proveedor)"
              onOpen={rect => setEditor({ tipo: 'fact_ceco', fila: f, rect })}>
              <CentroPlan cc={f.centro_codigo} cn={f.centro_nombre} sede={sede} requiere={f.requiere_centro !== false} origen={f.centro_origen} bc={f.centro_banco_codigo} bn={f.centro_banco_nombre} />
            </CeldaEdit>
          </span>
        )
      } },
    { key: 'sugerencia', label: '✦ Sugerencia', width: 280,
      value: f => { const g = sugs.get(f.id); return g ? `${g.sub_codigo ?? ''} ${g.sub_nombre ?? ''} ${g.centro_codigo ?? ''} ${g.centro_nombre ?? ''}` : '' },
      render: f => {
        const g = sugs.get(f.id)
        if (!g) return necesitaIA(f)
          ? <button onClick={e => { e.stopPropagation(); pedirIA([f.id]) }} disabled={!!procesando} title="Pedir a la IA una propuesta para esta factura"
              style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', border: '1px solid #DDD6FE', borderRadius: 5, background: '#F5F3FF', color: '#6D28D9', cursor: 'pointer' }}>✦ IA</button>
          : null
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
              {g.sub_id && <span title={g.sub_motivo + (g.sub_cambia_cuenta ? ' · cambia la cuenta contable de la factura' : '')} style={{ display: 'block', fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <b style={{ ...MONO, color: NAVY }}>{g.sub_codigo}</b> {g.sub_nombre} <b style={{ color: confColor(g.sub_conf) }}>{g.sub_conf}%</b>{g.sub_fuente === 'ia' && <b style={{ color: '#6D28D9', marginLeft: 3 }}>IA</b>}</span>}
              {g.centro_id && <span title={g.centro_motivo + (g.centro_cambia_sede ? ' · cambia la sede de la factura' : '')} style={{ display: 'block', fontSize: 10.5, color: SLATE, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <b style={MONO}>{g.centro_codigo}</b> {g.centro_nombre} <b style={{ color: confColor(g.centro_conf) }}>{g.centro_conf}%</b>{g.centro_fuente === 'ia' && <b style={{ color: '#6D28D9', marginLeft: 3 }}>IA</b>}</span>}
            </span>
            <button onClick={e => { e.stopPropagation(); aplicarSugerencias([f.id]) }} title="Aceptar esta sugerencia" disabled={!!procesando}
              style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', border: `1px solid ${BORDE}`, borderRadius: 5, background: '#fff', color: VERDE, cursor: 'pointer' }}>✓</button>
          </span>
        )
      } },
    { key: 'origen_clasificacion', label: 'Clasificación', width: 110, value: f => ORIGEN[f.origen_clasificacion]?.l ?? f.origen_clasificacion,
      render: f => { const o = ORIGEN[f.origen_clasificacion] || {}; return <Badge l={o.l} c={o.c} title={o.desc} /> } },
    { key: 'estado_pago', label: 'Pago', width: 96, value: f => PAGO[f.estado_pago]?.l ?? f.estado_pago,
      render: f => { const p = PAGO[f.estado_pago] || {}; return <Badge l={p.l} c={p.c} /> } },
    { key: 'saldo', label: 'Saldo', width: 95, align: 'right', value: f => Number(f.saldo) || 0,
      render: f => Number(f.saldo) > 1 && !['pagada', 'nc'].includes(f.estado_pago) ? <span style={{ ...MONO, color: ROJO }}>{fmt(f.saldo)}</span> : '', exportValue: f => Number(f.saldo) || 0 },
    { key: 'vencimiento', label: 'Vencimiento', width: 100, align: 'right',
      value: f => diasVencida(f.fecha_emision, plazoByRut.get(f.rut)) ?? 0,
      exportValue: f => diasVencida(f.fecha_emision, plazoByRut.get(f.rut)) ?? '',
      render: f => {
        if (!(Number(f.saldo) > 1 && ['pendiente', 'parcial'].includes(f.estado_pago))) return ''
        const d = diasVencida(f.fecha_emision, plazoByRut.get(f.rut))
        if (d == null) return ''
        if (d <= 0) return <span style={{ fontSize: 10.5, fontWeight: 700, color: VERDE, background: '#ECFDF5', borderRadius: 5, padding: '1px 6px' }}>al día</span>
        const [c, bg] = d > 60 ? [ROJO, '#FEF2F2'] : [AMBAR, '#FFFBEB']
        return <span style={{ fontSize: 10.5, fontWeight: 700, color: c, background: bg, borderRadius: 5, padding: '1px 6px' }}>vencida {d}d</span>
      } },
    { key: 'asiento_numero', label: 'Asiento', width: 76, render: f => <span style={{ fontSize: 11, color: SLATE }}>{f.asiento_numero ?? ''}</span> },
  ], [procesando, cecoNom, plazoByRut, sugs])

  /* ═══ render ═══ */
  const esProv = nivel === 'proveedores'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, padding: 4, background: '#F3F4F6', borderRadius: 8, width: 'fit-content' }}>
          {[['proveedores', 'Proveedores'], ['facturas', 'Facturas'], ['resumen', 'Resumen']].map(([k, l]) => (
            <button key={k} onClick={() => setNivel(k)} style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 6,
              background: nivel === k ? '#fff' : 'transparent', color: nivel === k ? NAVY : SLATE,
              boxShadow: nivel === k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 280, background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '7px 12px', fontSize: 11.5, color: '#1E3A8A', lineHeight: 1.5 }}>
          {nivel === 'resumen'
            ? <><b>Resumen de la clasificación.</b> Tabla dinámica por mes, cuenta del plan único y centro de costo, con las mismas subcuentas y centros del banco. Clic en una celda para ver sus facturas.</>
            : esProv
            ? <><b>La regla vive en el proveedor.</b> Defina aquí su cuenta, centro de costo y plazo: una confirmación ajusta todas sus facturas y las próximas llegan clasificadas solas.</>
            : <><b>Excepciones por factura.</b> Cambiar la cuenta o el centro de costo aquí afecta solo a esa factura; las reglas del proveedor se administran en el nivel Proveedores. Vencimiento = emisión + plazo del proveedor; las notas de crédito se muestran en negativo.</>}
        </div>
      </div>

      {nivel === 'resumen' ? <ResumenImputacion filas={filas} /> : (<>
      {esProv ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Kpi label="Sin regla" valor={kpiP.sinRegla} color={kpiP.sinRegla ? ROJO : VERDE} detalle="proveedores sin cuenta definida" />
          <Kpi label="Sugeridos por confirmar" valor={kpiP.sugeridos} color={kpiP.sugeridos ? AMBAR : VERDE} detalle="✓ confirma en cascada" />
          <Kpi label="Confirmados" valor={kpiP.confirmados} color={VERDE} detalle="regla manual vigente" />
          <Kpi label="Saldo abierto" valor={fmt(kpiP.abierto)} detalle="facturas por pagar, ya neto de NC" />
          <Kpi label="NC por aplicar" valor={fmt(kpiP.nc)} color={kpiP.nc ? AMBAR : VERDE} detalle="sin imputar a factura de origen" />
          <Kpi label="Vencido" valor={fmt(kpiP.vencido)} color={kpiP.vencido ? ROJO : VERDE} detalle="según plazo por proveedor" />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={periodo} onChange={e => setPeriodo(e.target.value)} style={INPUT}>
            <option value="todos">Todos los períodos</option>{periodos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={pago} onChange={e => setPago(e.target.value)} style={INPUT}>
            <option value="todos">Todo estado de pago</option>
            {Object.entries(PAGO).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
          </select>
          <button onClick={() => cargarSugs(true)} disabled={!!procesando} title="Recalcula las sugerencias del motor" style={{ ...INPUT, cursor: 'pointer' }}>↻ Sugerencias</button>
          <button onClick={() => { const n = Math.min(candidatasIA.length, 100); if (n && (n <= 20 || window.confirm(`Se consultarán ${n} facturas a la IA (unos ${Math.ceil(n / 20) * 15} segundos). ¿Seguir?`))) pedirIA(candidatasIA) }}
            disabled={!!procesando || !candidatasIA.length} title="Facturas visibles sin subcuenta o centro que no tienen sugerencia o la tienen bajo 70%"
            style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, color: '#6D28D9', background: '#F5F3FF', borderColor: '#DDD6FE' }}>✦ IA para {candidatasIA.length} sin sugerencia o con baja confianza</button>
          {iaProg && <span style={{ fontSize: 11.5, color: SLATE }}>{iaProg}</span>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {(esProv ? CHIPS_PROV : CHIPS_FACT).map(([k, l]) => {
          const activo = (esProv ? chipP : chipF) === k
          const n = esProv ? nChipP[k] : nChipF[k]
          return (
            <button key={k} onClick={() => esProv ? setChipP(k) : setChipF(k)} style={{
              fontSize: 11.5, fontWeight: activo ? 700 : 500, padding: '5px 12px', borderRadius: 16, cursor: 'pointer',
              border: `1px solid ${activo ? NAVY : BORDE}`, background: activo ? NAVY : '#fff', color: activo ? '#fff' : INK,
            }}>{l} · {n}</button>
          )
        })}
      </div>

      {esProv && marcados.size > 0 && (
        <div style={{ padding: '8px 12px', background: NAVY, borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{marcados.size} proveedores seleccionados</span>
          <button onClick={confirmarMasivo} disabled={procesando === 'masivo'}
            style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, color: NAVY, background: '#fff', border: 'none' }}>
            {procesando === 'masivo' ? 'Confirmando…' : 'Confirmar cuentas sugeridas'}
          </button>
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.7)' }}>Fija como regla la cuenta sugerida de cada uno y ajusta sus facturas</span>
          <button onClick={e => setEditor({ tipo: 'masivo_p_sub', rect: e.currentTarget.getBoundingClientRect() })} disabled={!!procesando} style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, color: NAVY, background: '#fff', border: 'none' }}>Asignar subcuenta…</button>
          <button onClick={e => setEditor({ tipo: 'masivo_p_centro', rect: e.currentTarget.getBoundingClientRect() })} disabled={!!procesando} style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, color: NAVY, background: '#fff', border: 'none' }}>Asignar centro…</button>
          <button onClick={() => setMarcados(new Set())} style={{ ...INPUT, cursor: 'pointer', marginLeft: 'auto', fontSize: 11 }}>Limpiar</button>
        </div>
      )}

      {!esProv && marcadosF.size > 0 && (
        <div style={{ padding: '8px 12px', background: NAVY, borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{marcadosF.size} factura{marcadosF.size === 1 ? '' : 's'} seleccionada{marcadosF.size === 1 ? '' : 's'}</span>
          <button onClick={e => setEditor({ tipo: 'masivo_f_sub', rect: e.currentTarget.getBoundingClientRect() })} disabled={!!procesando} style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, color: NAVY, background: '#fff', border: 'none' }}>Asignar subcuenta…</button>
          <button onClick={e => setEditor({ tipo: 'masivo_f_centro', rect: e.currentTarget.getBoundingClientRect() })} disabled={!!procesando} style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, color: NAVY, background: '#fff', border: 'none' }}>Asignar centro…</button>
          <button onClick={() => aplicarSugerencias([...marcadosF])} disabled={!!procesando} style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, color: NAVY, background: '#fff', border: 'none' }}>✦ Aceptar sugerencias ({[...marcadosF].filter(id => sugs.has(id)).length})</button>
          <button onClick={() => pedirIA([...marcadosF])} disabled={!!procesando} style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, color: '#6D28D9', background: '#F5F3FF', border: 'none' }}>✦ Pedir a la IA</button>
          {iaProg && <span style={{ fontSize: 11, color: '#fff' }}>{iaProg}</span>}
          {procesando === 'masivoF' && <span style={{ fontSize: 11, color: '#fff' }}>Aplicando…</span>}
          <button onClick={() => setMarcadosF(new Set())} style={{ ...INPUT, cursor: 'pointer', marginLeft: 'auto', fontSize: 11 }}>Limpiar</button>
        </div>
      )}

      <div style={{ height: '66vh', minHeight: 380 }}>
        {esProv ? (
          <DataGrid
            key="proveedores"
            title="Proveedores del libro de compras"
            exportName="libro_compras_proveedores"
            loading={cargando}
            emptyText="Sin proveedores con estos filtros"
            rows={provVisibles}
            columns={colsProv}
            getRowId={p => p.rut}
            rowStyle={p => marcados.has(p.rut) ? { background: '#EEF2FF' } : (REGLA[p.estado_regla]?.bg ? { background: REGLA[p.estado_regla].bg } : {})}
            leadingHeader={<input type="checkbox" checked={provVisibles.length > 0 && marcados.size === provVisibles.length}
              onChange={() => setMarcados(m => m.size === provVisibles.length ? new Set() : new Set(provVisibles.map(p => p.rut)))} style={{ width: 13, height: 13, cursor: 'pointer' }} />}
            leadingCell={p => <input type="checkbox" checked={marcados.has(p.rut)}
              onChange={() => setMarcados(m => { const n = new Set(m); n.has(p.rut) ? n.delete(p.rut) : n.add(p.rut); return n })} style={{ width: 13, height: 13, cursor: 'pointer' }} />}
            toolbar={<span style={{ fontSize: 10.5, color: SLATE }}>* plazo por defecto 30d (sin definir)</span>}
          />
        ) : (
          <DataGrid
            key="facturas"
            title="Facturas del libro de compras"
            exportName="libro_compras_facturas"
            loading={cargando}
            emptyText="Sin facturas con estos filtros"
            rows={factVisibles}
            columns={colsFact}
            getRowId={f => f.id}
            rowStyle={f => marcadosF.has(f.id) ? { background: '#EEF2FF' } : (ORIGEN[f.origen_clasificacion]?.bg ? { background: ORIGEN[f.origen_clasificacion].bg } : {})}
            leadingHeader={<input type="checkbox" aria-label="Marcar todas las facturas visibles" checked={factVisibles.length > 0 && factVisibles.every(f => marcadosF.has(f.id))}
              onChange={() => setMarcadosF(m => factVisibles.every(f => m.has(f.id)) ? new Set() : new Set(factVisibles.map(f => f.id)))} style={{ width: 13, height: 13, cursor: 'pointer' }} />}
            leadingCell={f => <input type="checkbox" aria-label={`Marcar factura ${f.folio}`} checked={marcadosF.has(f.id)}
              onChange={() => setMarcadosF(m => { const n = new Set(m); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })} style={{ width: 13, height: 13, cursor: 'pointer' }} />}
          />
        )}
      </div>

      {editor?.tipo === 'prov_cuenta' && (
        <ComboPopup rect={editor.rect} options={cuentaOpts} placeholder="Buscar subcuenta por código o nombre (ej. 710 o papelería)…"
          onPick={v => reglaCuenta(editor.fila, v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'prov_ceco' && (
        <ComboPopup rect={editor.rect} options={centroOpts} placeholder="Buscar centro de costo por código, área o sede (ej. ops maipu)…"
          onPick={v => reglaCeco(editor.fila, v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'prov_plazo' && (
        <ComboPopup rect={editor.rect} options={plazoOpts} placeholder="Plazo de crédito…"
          onPick={v => reglaPlazo(editor.fila, v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'fact_ceco' && (
        <ComboPopup rect={editor.rect} options={centroOptsFactura} placeholder="Centro de costo (solo esta factura)…"
          onPick={v => cecoFactura(editor.fila, v === '__null__' ? null : v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'fact_cuenta' && (
        <ComboPopup rect={editor.rect} options={cuentaOpts} placeholder="Buscar subcuenta (solo esta factura)…"
          onPick={v => cuentaFactura(editor.fila, v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'masivo_f_sub' && (
        <ComboPopup rect={editor.rect} options={cuentaOpts} placeholder={`Subcuenta para ${marcadosF.size} facturas…`}
          onPick={v => asignarMasivoF('sub', v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'masivo_f_centro' && (
        <ComboPopup rect={editor.rect} options={centroOptsFactura} placeholder={`Centro de costo para ${marcadosF.size} facturas…`}
          onPick={v => asignarMasivoF('centro', v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'masivo_p_sub' && (
        <ComboPopup rect={editor.rect} options={cuentaOpts} placeholder={`Subcuenta para ${marcados.size} proveedores…`}
          onPick={v => asignarMasivoP('sub', v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'masivo_p_centro' && (
        <ComboPopup rect={editor.rect} options={centroOpts} placeholder={`Centro de costo para ${marcados.size} proveedores…`}
          onPick={v => asignarMasivoP('centro', v)} onClose={() => setEditor(null)} />
      )}
      </>)}
    </div>
  )
}

export default LibroComprasClasificar
