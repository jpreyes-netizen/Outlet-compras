import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
const CHIPS_FACT = [['trabajo', 'Por trabajar'], ['pendiente', 'Sin clasificar'], ['regla_automatica', 'Sugeridas'], ['regla_manual', 'Confirmadas'], ['todos', 'Todas']]

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

  const t = q.trim().toLowerCase()
  const lista = (t ? options.filter(o => o.label.toLowerCase().includes(t)) : options).slice(0, 40)
  const abajo = rect.bottom + 300 < window.innerHeight
  const pos = abajo ? { top: rect.bottom + 2 } : { bottom: window.innerHeight - rect.top + 2 }
  return (
    <div ref={ref} style={{
      position: 'fixed', left: Math.min(rect.left, window.innerWidth - 340), ...pos, width: 330, zIndex: 300,
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
          </div>
        ))}
        {options.length > 40 && lista.length === 40 && <div style={{ padding: '5px 10px', fontSize: 10, color: SLATE }}>Escriba para afinar ({options.length} en total)</div>}
      </div>
    </div>
  )
}

export function LibroComprasClasificar({ cu }) {
  const [nivel, setNivel] = useState('proveedores')     // 'proveedores' | 'facturas'
  const [provs, setProvs] = useState([])
  const [filas, setFilas] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [cecos, setCecos] = useState([])
  const [chipP, setChipP] = useState('trabajo')
  const [chipF, setChipF] = useState('trabajo')
  const [periodo, setPeriodo] = useState('todos')
  const [pago, setPago] = useState('todos')
  const [marcados, setMarcados] = useState(new Set())   // ruts (nivel proveedores)
  const [procesando, setProcesando] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [editor, setEditor] = useState(null)            // { tipo, fila, rect }

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      const [{ data: p, error: e1 }, { data: f, error: e2 }, { data: c }, { data: cc }] = await Promise.all([
        supabase.from('v_libro_compras_proveedores').select('*').order('monto_ytd', { ascending: false }).limit(2000),
        supabase.from('v_libro_compras_clasificacion').select('*').order('fecha_emision', { ascending: false }).limit(5000),
        supabase.from('plan_cuentas').select('codigo, nombre, tipo_eeff, descripcion_uso').eq('acepta_movimientos', true).eq('activa', true)
          .in('tipo_eeff', ['activo', 'gasto', 'costo', 'financiero', 'pasivo']).order('codigo').limit(500),
        supabase.from('cecos').select('id, nombre').eq('activo', true).order('tipo').order('nombre'),
      ])
      if (e1) throw e1
      if (e2) throw e2
      setProvs(p ?? []); setFilas(f ?? []); setCuentas(c ?? []); setCecos(cc ?? [])
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { if (!silencioso) setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const cuentaOpts = useMemo(() => cuentas.map(c => ({ value: c.codigo, label: `${c.codigo} · ${c.nombre}` })), [cuentas])
  const cecoOpts = useMemo(() => cecos.map(c => ({ value: String(c.id), label: c.nombre })), [cecos])
  const plazoOpts = useMemo(() => PLAZOS.map(([v, l]) => ({ value: String(v), label: l })), [])
  const cecoOptsFactura = useMemo(() => [{ value: '__null__', label: '— sin centro de costo —' }, ...cecoOpts], [cecoOpts])
  const cuentaNom = useMemo(() => new Map(cuentas.map(c => [c.codigo, c.nombre])), [cuentas])
  const cecoNom = useMemo(() => new Map(cecos.map(c => [String(c.id), c.nombre])), [cecos])
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

  async function reglaCuenta(p, cuenta) {
    setEditor(null); setProcesando(p.rut)
    try {
      const { data, error } = await supabase.rpc('fn_clasificar_proveedor', { p_rut: p.rut, p_cuenta: cuenta, p_usuario: cu?.id ?? 'ui' })
      if (error) throw error
      patchProv(p.rut, { cuenta, cuenta_nombre: cuentaNom.get(cuenta) || '', estado_regla: 'confirmada', fuente: 'manual' })
      patchFacts(x => x.rut === p.rut, { cuenta, cuenta_nombre: cuentaNom.get(cuenta) || '', origen_clasificacion: 'regla_manual' })
      toast.success(`${p.razon_social}: regla ${cuenta} · ${data.facturas_reclasificadas} facturas ajustadas`)
      cargar(true)
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  async function confirmarProv(p) {
    if (!p.cuenta) { toast.warning('El proveedor no tiene cuenta sugerida: asígnela en la celda Cuenta'); return }
    return reglaCuenta(p, p.cuenta)
  }

  async function reglaCeco(p, cecoId) {
    setEditor(null); setProcesando(p.rut)
    try {
      const { data, error } = await supabase.rpc('fn_asignar_ceco_proveedor', { p_rut: p.rut, p_ceco: cecoId, p_usuario: cu?.id ?? 'ui' })
      if (error) throw error
      patchProv(p.rut, { ceco_id: cecoId, ceco_nombre: cecoNom.get(String(cecoId)) || '' })
      patchFacts(x => x.rut === p.rut, { ceco_id: cecoId })
      toast.success(`${p.razon_social}: centro de costo ${data.ceco} (${data.facturas} facturas)`)
      cargar(true)
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
    setMarcados(new Set()); setProcesando(null); cargar(true)
  }

  const colsProv = useMemo(() => [
    { key: 'razon_social', label: 'Proveedor', width: 250, value: p => `${p.razon_social ?? ''} ${p.rut ?? ''}`,
      render: p => <span title={`${p.razon_social} · ${fmtRut(p.rut)}`}>{p.razon_social} <span style={{ color: SLATE, fontSize: 10 }}>{fmtRut(p.rut)}</span></span> },
    { key: 'n_facturas', label: 'Facts', width: 62, align: 'right', value: p => Number(p.n_facturas) || 0,
      render: p => <span style={MONO}>{p.n_facturas}{Number(p.n_nc) > 0 ? <span style={{ color: SLATE, fontSize: 10 }}> +{p.n_nc}NC</span> : ''}</span> },
    { key: 'monto_ytd', label: 'Monto 2026', width: 110, align: 'right', value: p => Number(p.monto_ytd) || 0,
      render: p => <span style={{ ...MONO, fontWeight: 600 }}>{fmt(p.monto_ytd)}</span>, exportValue: p => Number(p.monto_ytd) || 0 },
    { key: 'ultima_fecha', label: 'Última', width: 84 },
    { key: 'cuenta', label: 'Cuenta contable (regla)', width: 230, value: p => `${p.cuenta ?? ''} ${p.cuenta_nombre ?? ''}`,
      render: p => (
        <span style={{ opacity: procesando === p.rut ? 0.4 : 1 }}>
          <CeldaEdit vacio={!p.cuenta ? '— asignar cuenta —' : ''} title="Clic para definir la cuenta del proveedor (ajusta todas sus facturas)"
            onOpen={rect => setEditor({ tipo: 'prov_cuenta', fila: p, rect })}>
            <span style={{ ...MONO, color: SLATE, fontSize: 11 }}>{p.cuenta}</span> <span style={{ fontSize: 11 }}>{p.cuenta_nombre}</span>
          </CeldaEdit>
        </span>
      ) },
    { key: 'ceco_id', label: 'Centro de costo', width: 130, value: p => p.ceco_nombre ?? '',
      render: p => (
        <CeldaEdit title="Clic para asignar el centro de costo del proveedor" onOpen={rect => setEditor({ tipo: 'prov_ceco', fila: p, rect })}>
          <span style={{ fontSize: 11, color: p.ceco_id ? INK : SLATE }}>{p.ceco_nombre ?? '—'}</span>
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
  }), [universo])
  const factVisibles = useMemo(() => {
    if (chipF === 'trabajo') return universo.filter(f => ['pendiente', 'regla_automatica'].includes(f.origen_clasificacion))
    if (chipF === 'todos') return universo
    return universo.filter(f => f.origen_clasificacion === chipF)
  }, [universo, chipF])

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

  async function cecoFactura(f, cecoId) {
    setEditor(null); setProcesando(f.id)
    try {
      const { data, error } = await supabase.rpc('fn_asignar_ceco_factura', { p_factura_id: String(f.id), p_ceco: cecoId, p_usuario: cu?.id ?? 'ui' })
      if (error) throw error
      if (data?.ok === false) { toast.warning(data.error); return }
      patchFacts(x => x.id === f.id, { ceco_id: cecoId, ceco_nombre: cecoNom.get(String(cecoId)) || '' })
      toast.success(data?.cambio ? `Factura ${f.folio} → ${data.ceco} (solo esta factura)` : 'Sin cambios (ya tenía ese centro de costo)')
      cargar(true)
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  async function cuentaFactura(f, cuenta) {
    setEditor(null); setProcesando(f.id)
    try {
      const { data, error } = await supabase.rpc('fn_clasificar_factura', { p_factura_id: f.id, p_cuenta: cuenta, p_usuario: cu?.id ?? 'ui', p_aplicar_regla: false })
      if (error) throw error
      patchFacts(x => x.id === f.id, { cuenta, cuenta_nombre: cuentaNom.get(cuenta) || '', origen_clasificacion: 'clasificada' })
      toast.success(data.reclasificado ? `Factura ${f.folio} → ${cuenta} (solo esta factura)` : 'Sin cambios (ya estaba en esa cuenta)')
      cargar(true)
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
    { key: 'cuenta', label: 'Cuenta contable', width: 220, value: f => `${f.cuenta ?? ''} ${f.cuenta_nombre ?? ''}`,
      render: f => (
        <span style={{ opacity: procesando === f.id ? 0.4 : 1 }}>
          <CeldaEdit vacio={!f.cuenta || f.cuenta === '1810101' ? '— asignar cuenta —' : ''}
            title="Clic para cambiar la cuenta de ESTA factura (excepción puntual, no toca la regla del proveedor)"
            onOpen={rect => setEditor({ tipo: 'fact_cuenta', fila: f, rect })}>
            <span style={{ ...MONO, color: SLATE, fontSize: 11 }}>{f.cuenta}</span> <span style={{ fontSize: 11 }}>{f.cuenta_nombre}</span>
          </CeldaEdit>
        </span>
      ) },
    { key: 'ceco_nombre', label: 'Centro de costo', width: 145, value: f => f.ceco_nombre ?? (cecoNom.get(String(f.ceco_id ?? '')) ?? ''),
      render: f => {
        const nombre = f.ceco_nombre ?? cecoNom.get(String(f.ceco_id ?? '')) ?? null
        return (
          <span style={{ opacity: procesando === f.id ? 0.4 : 1 }}>
            <CeldaEdit vacio={!nombre ? '— asignar CECO —' : ''}
              title="Clic para cambiar el centro de costo de ESTA factura (excepción; no toca la regla del proveedor)"
              onOpen={rect => setEditor({ tipo: 'fact_ceco', fila: f, rect })}>
              <span style={{ fontSize: 11 }}>{nombre}</span>
            </CeldaEdit>
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
  ], [procesando, cecoNom, plazoByRut])

  /* ═══ render ═══ */
  const esProv = nivel === 'proveedores'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, padding: 4, background: '#F3F4F6', borderRadius: 8, width: 'fit-content' }}>
          {[['proveedores', 'Proveedores'], ['facturas', 'Facturas']].map(([k, l]) => (
            <button key={k} onClick={() => setNivel(k)} style={{
              padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 6,
              background: nivel === k ? '#fff' : 'transparent', color: nivel === k ? NAVY : SLATE,
              boxShadow: nivel === k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 280, background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '7px 12px', fontSize: 11.5, color: '#1E3A8A', lineHeight: 1.5 }}>
          {esProv
            ? <><b>La regla vive en el proveedor.</b> Defina aquí su cuenta, centro de costo y plazo: una confirmación ajusta todas sus facturas y las próximas llegan clasificadas solas.</>
            : <><b>Excepciones por factura.</b> Cambiar la cuenta o el centro de costo aquí afecta solo a esa factura; las reglas del proveedor se administran en el nivel Proveedores. Vencimiento = emisión + plazo del proveedor; las notas de crédito se muestran en negativo.</>}
        </div>
      </div>

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
          <button onClick={() => setMarcados(new Set())} style={{ ...INPUT, cursor: 'pointer', marginLeft: 'auto', fontSize: 11 }}>Limpiar</button>
        </div>
      )}

      <div style={{ height: '66vh', minHeight: 380 }}>
        {esProv ? (
          <DataGrid
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
            title="Facturas del libro de compras"
            exportName="libro_compras_facturas"
            loading={cargando}
            emptyText="Sin facturas con estos filtros"
            rows={factVisibles}
            columns={colsFact}
            getRowId={f => f.id}
            rowStyle={f => ORIGEN[f.origen_clasificacion]?.bg ? { background: ORIGEN[f.origen_clasificacion].bg } : {}}
          />
        )}
      </div>

      {editor?.tipo === 'prov_cuenta' && (
        <ComboPopup rect={editor.rect} options={cuentaOpts} placeholder="Buscar cuenta por código o nombre…"
          onPick={v => reglaCuenta(editor.fila, v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'prov_ceco' && (
        <ComboPopup rect={editor.rect} options={cecoOpts} placeholder="Buscar centro de costo…"
          onPick={v => reglaCeco(editor.fila, v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'prov_plazo' && (
        <ComboPopup rect={editor.rect} options={plazoOpts} placeholder="Plazo de crédito…"
          onPick={v => reglaPlazo(editor.fila, v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'fact_ceco' && (
        <ComboPopup rect={editor.rect} options={cecoOptsFactura} placeholder="Centro de costo (solo esta factura)…"
          onPick={v => cecoFactura(editor.fila, v === '__null__' ? null : v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'fact_cuenta' && (
        <ComboPopup rect={editor.rect} options={cuentaOpts} placeholder="Buscar cuenta (solo esta factura)…"
          onPick={v => cuentaFactura(editor.fila, v)} onClose={() => setEditor(null)} />
      )}
    </div>
  )
}

export default LibroComprasClasificar
