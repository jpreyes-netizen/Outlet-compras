import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../supabase'
import { toast } from 'sonner'
import { DataGrid } from './conciliacion/DataGrid'

/* ══════════════════════════════════════════════════════════════════════
   LIBRO DE COMPRAS — IMPUTACIÓN CONTABLE (v2, grilla tipo Excel)
   Patrón AP invoice coding (Xero / SAP FB60 / Dynamics 365):
     · worklist plana con 3 estados: sin codificar → sugerida → confirmada
     · la cuenta se edita EN la celda y se guarda al elegir (sin botón OK)
     · sugerencia del sistema se confirma con 1 clic (✓)
     · regla por proveedor como default de codificación
     · aging de saldos por buckets 0-30 / 31-60 / 61+
   Backend: el existente (fn_clasificar_factura, fn_clasificar_proveedor,
   fn_asignar_ceco_proveedor, v_libro_compras_clasificacion). Cero lógica nueva.
   ══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73'
const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', FONDO = '#F9FAFB'
const fmt = n => (n == null || n === '' ? '' : new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n))))
const INPUT = { fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: INK }

const ORIGEN = {
  pendiente:        { l: 'Sin clasificar',   c: ROJO,  bg: '#FEF2F2', desc: 'Cayó en 1810101 Pendientes. Asignar cuenta.' },
  regla_automatica: { l: 'Sugerida',         c: AMBAR, bg: '#FFFBEB', desc: 'Cuenta propuesta por el sistema (OC / historial). Confirmar con ✓ o cambiarla.' },
  por_oc:           { l: 'Mercadería (OC)',  c: SLATE, bg: null,      desc: 'Factura con OC → inventario por defecto.' },
  din:              { l: 'DIN importación',  c: SLATE, bg: null,      desc: 'Mercadería en tránsito.' },
  regla_manual:     { l: 'Confirmada',       c: VERDE, bg: null,      desc: 'Regla fijada manualmente. Las próximas facturas van solas.' },
  clasificada:      { l: 'Clasificada',      c: VERDE, bg: null,      desc: 'Cuenta asignada a esta factura.' },
  sin_asiento:      { l: 'Sin asiento',      c: SLATE, bg: null,      desc: 'Aún no contabilizada (motor nocturno).' },
}
const PAGO = {
  pagada: { l: 'Pagada', c: VERDE }, parcial: { l: 'Parcial', c: AMBAR }, pendiente: { l: 'Por pagar', c: ROJO },
  no_conciliable: { l: 'No conciliable', c: SLATE }, nc: { l: 'Nota de crédito', c: SLATE },
}
const CHIPS = [
  ['trabajo', 'Por trabajar'], ['pendiente', 'Sin clasificar'], ['regla_automatica', 'Sugeridas'],
  ['regla_manual', 'Confirmadas'], ['todos', 'Todas'],
]
const TIPO_DOC = c => (c === '61' ? 'NC' : c === '914' ? 'DIN' : 'Fact')

function Kpi({ label, valor, detalle, color }) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 140, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color || INK, fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>{valor}</div>
      {detalle && <div style={{ fontSize: 10, color: SLATE, marginTop: 2 }}>{detalle}</div>}
    </div>
  )
}

const Badge = ({ l, c, title }) => (
  <span title={title} style={{ fontSize: 10.5, fontWeight: 700, color: c, whiteSpace: 'nowrap' }}>{l}</span>
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
  const [filas, setFilas] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [cecos, setCecos] = useState([])
  const [periodo, setPeriodo] = useState('todos')
  const [pago, setPago] = useState('todos')
  const [chip, setChip] = useState('trabajo')
  const [reglaProv, setReglaProv] = useState(true)     // al codificar, fija la regla del proveedor
  const [marcadas, setMarcadas] = useState(new Set())
  const [cuentaMasiva, setCuentaMasiva] = useState('')
  const [procesando, setProcesando] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [editor, setEditor] = useState(null)           // { tipo:'cuenta'|'ceco', fila, rect }

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    try {
      const [{ data: f, error }, { data: c }, { data: cc }] = await Promise.all([
        supabase.from('v_libro_compras_clasificacion').select('*').order('fecha_emision', { ascending: false }).limit(5000),
        supabase.from('plan_cuentas').select('codigo, nombre, tipo_eeff, descripcion_uso').eq('acepta_movimientos', true).eq('activa', true)
          .in('tipo_eeff', ['activo', 'gasto', 'costo', 'financiero', 'pasivo']).order('codigo').limit(500),
        supabase.from('cecos').select('id, nombre').eq('activo', true).order('tipo').order('nombre'),
      ])
      if (error) throw error
      setFilas(f ?? []); setCuentas(c ?? []); setCecos(cc ?? [])
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { if (!silencioso) setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const periodos = useMemo(() => [...new Set(filas.map(f => f.periodo))].sort().reverse(), [filas])
  const cuentaOpts = useMemo(() => cuentas.map(c => ({ value: c.codigo, label: `${c.codigo} · ${c.nombre}` })), [cuentas])
  const cecoOpts = useMemo(() => cecos.map(c => ({ value: String(c.id), label: c.nombre })), [cecos])
  const cecoNombre = useMemo(() => new Map(cecos.map(c => [String(c.id), c.nombre])), [cecos])
  const cuentaNom = useMemo(() => new Map(cuentas.map(c => [c.codigo, c.nombre])), [cuentas])

  // Universo = período + estado de pago; los chips cortan sobre esto
  const universo = useMemo(() => filas.filter(f =>
    (periodo === 'todos' || f.periodo === periodo) &&
    (pago === 'todos' || f.estado_pago === pago)), [filas, periodo, pago])

  const nChip = useMemo(() => ({
    trabajo: universo.filter(f => ['pendiente', 'regla_automatica'].includes(f.origen_clasificacion)).length,
    pendiente: universo.filter(f => f.origen_clasificacion === 'pendiente').length,
    regla_automatica: universo.filter(f => f.origen_clasificacion === 'regla_automatica').length,
    regla_manual: universo.filter(f => f.origen_clasificacion === 'regla_manual').length,
    todos: universo.length,
  }), [universo])

  const visibles = useMemo(() => {
    if (chip === 'trabajo') return universo.filter(f => ['pendiente', 'regla_automatica'].includes(f.origen_clasificacion))
    if (chip === 'todos') return universo
    return universo.filter(f => f.origen_clasificacion === chip)
  }, [universo, chip])

  const kpi = useMemo(() => ({
    total: filas.length, monto: filas.reduce((s, f) => s + Number(f.monto_total), 0),
    pend: filas.filter(f => f.origen_clasificacion === 'pendiente').length,
    auto: filas.filter(f => f.origen_clasificacion === 'regla_automatica').length,
    autoMonto: filas.filter(f => f.origen_clasificacion === 'regla_automatica').reduce((s, f) => s + Number(f.monto_total), 0),
    porPagar: filas.filter(f => ['pendiente', 'parcial'].includes(f.estado_pago)).reduce((s, f) => s + Number(f.saldo), 0),
    confirmadas: filas.filter(f => f.origen_clasificacion === 'regla_manual').length,
  }), [filas])

  /* ── acciones ── */
  function patchLocal(pred, cambios) {
    setFilas(prev => prev.map(x => pred(x) ? { ...x, ...cambios } : x))
  }

  async function guardarCuenta(f, cuenta) {
    setEditor(null); setProcesando(f.id)
    try {
      if (reglaProv) {
        const { data, error } = await supabase.rpc('fn_clasificar_proveedor', { p_rut: f.rut, p_cuenta: cuenta, p_usuario: cu?.id ?? 'ui' })
        if (error) throw error
        patchLocal(x => x.rut === f.rut, { cuenta, cuenta_nombre: cuentaNom.get(cuenta) || '', origen_clasificacion: 'regla_manual' })
        toast.success(`${f.razon_social}: regla ${cuenta} · ${data.facturas_reclasificadas} facturas ajustadas`)
      } else {
        const { data, error } = await supabase.rpc('fn_clasificar_factura', { p_factura_id: f.id, p_cuenta: cuenta, p_usuario: cu?.id ?? 'ui', p_aplicar_regla: false })
        if (error) throw error
        patchLocal(x => x.id === f.id, { cuenta, cuenta_nombre: cuentaNom.get(cuenta) || '', origen_clasificacion: 'clasificada' })
        toast.success(data.reclasificado ? `Factura ${f.folio} → ${cuenta}` : 'Sin cambios (ya estaba en esa cuenta)')
      }
      cargar(true)
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  async function confirmarSugerida(f) {
    if (!f.cuenta || f.cuenta === '1810101') { toast.warning('La factura no tiene cuenta sugerida'); return }
    setProcesando(f.id)
    try {
      const { data, error } = await supabase.rpc('fn_clasificar_proveedor', { p_rut: f.rut, p_cuenta: f.cuenta, p_usuario: cu?.id ?? 'ui' })
      if (error) throw error
      patchLocal(x => x.rut === f.rut, { origen_clasificacion: 'regla_manual' })
      toast.success(`${f.razon_social}: cuenta ${f.cuenta} confirmada (${data.facturas_reclasificadas} ajustadas)`)
      cargar(true)
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  async function guardarCeco(f, cecoId) {
    setEditor(null); setProcesando(f.id)
    try {
      const { data, error } = await supabase.rpc('fn_asignar_ceco_proveedor', { p_rut: f.rut, p_ceco: cecoId, p_usuario: cu?.id ?? 'ui' })
      if (error) throw error
      patchLocal(x => x.rut === f.rut, { ceco_id: cecoId })
      toast.success(`${f.razon_social}: centro de costo ${data.ceco} (${data.facturas} facturas)`)
      cargar(true)
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  const toggleMarca = id => setMarcadas(m => { const n = new Set(m); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleTodas = () => setMarcadas(m => m.size === visibles.length ? new Set() : new Set(visibles.map(f => f.id)))

  async function clasificarMasivo() {
    if (!cuentaMasiva) { toast.warning('Elija la cuenta destino para la selección'); return }
    const facturas = visibles.filter(f => marcadas.has(f.id))
    if (!facturas.length) return
    if (!window.confirm(`Clasificar ${facturas.length} facturas en la cuenta ${cuentaMasiva}?${reglaProv ? ' Se fijará la regla para cada proveedor involucrado.' : ''}`)) return
    setProcesando('masivo')
    let ok = 0, err = 0
    try {
      if (reglaProv) {
        const ruts = [...new Set(facturas.map(f => f.rut))]
        for (const rut of ruts) {
          const { data, error } = await supabase.rpc('fn_clasificar_proveedor', { p_rut: rut, p_cuenta: cuentaMasiva, p_usuario: cu?.id ?? 'ui' })
          if (error) { err++ } else { ok += data?.facturas_reclasificadas ?? 0 }
        }
        toast.success(`${ruts.length} proveedores procesados · ${ok} facturas reclasificadas${err ? ` · ${err} errores` : ''}`)
      } else {
        for (const f of facturas) {
          const { error } = await supabase.rpc('fn_clasificar_factura', { p_factura_id: f.id, p_cuenta: cuentaMasiva, p_usuario: cu?.id ?? 'ui', p_aplicar_regla: false })
          error ? err++ : ok++
        }
        toast.success(`${ok} facturas clasificadas${err ? ` · ${err} errores` : ''}`)
      }
      setMarcadas(new Set()); setCuentaMasiva('')
      cargar(true)
    } finally { setProcesando(null) }
  }

  /* ── columnas de la grilla ── */
  const columns = useMemo(() => [
    { key: 'fecha_emision', label: 'Fecha', width: 84 },
    { key: 'doc', label: 'Doc', width: 82, value: f => `${TIPO_DOC(f.codigo_sii)} ${f.folio ?? ''}`,
      render: f => <span style={{ fontSize: 11 }}>{TIPO_DOC(f.codigo_sii)} <b>{f.folio}</b></span> },
    { key: 'razon_social', label: 'Proveedor', width: 230, value: f => `${f.razon_social ?? ''} ${f.rut ?? ''}`,
      render: f => <span title={`${f.razon_social} · ${f.rut}`}>{f.razon_social} <span style={{ color: SLATE, fontSize: 10 }}>{f.rut}</span></span> },
    { key: 'neto', label: 'Neto', width: 90, align: 'right', value: f => Number(f.neto) || 0, render: f => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{fmt(f.neto)}</span>, exportValue: f => Number(f.neto) || 0 },
    { key: 'iva', label: 'IVA', width: 80, align: 'right', value: f => Number(f.iva) || 0, render: f => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{fmt(f.iva)}</span>, exportValue: f => Number(f.iva) || 0 },
    { key: 'monto_total', label: 'Total', width: 100, align: 'right', value: f => Number(f.monto_total) || 0,
      render: f => <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{fmt(f.monto_total)}</span>, exportValue: f => Number(f.monto_total) || 0 },
    { key: 'cuenta', label: 'Cuenta contable', width: 220, value: f => `${f.cuenta ?? ''} ${f.cuenta_nombre ?? ''}`,
      render: f => (
        <span onClick={e => { e.stopPropagation(); setEditor({ tipo: 'cuenta', fila: f, rect: e.currentTarget.getBoundingClientRect() }) }}
          title="Clic para cambiar la cuenta"
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, borderBottom: '1px dashed #C7CBD1', opacity: procesando === f.id ? 0.4 : 1 }}>
          {f.cuenta && f.cuenta !== '1810101'
            ? <><span style={{ fontFamily: 'ui-monospace, monospace', color: SLATE, fontSize: 11 }}>{f.cuenta}</span> <span style={{ fontSize: 11 }}>{f.cuenta_nombre}</span></>
            : <span style={{ color: ROJO, fontSize: 11, fontWeight: 600 }}>— asignar cuenta —</span>}
        </span>
      ) },
    { key: 'ceco_id', label: 'Centro de costo', width: 140, value: f => cecoNombre.get(String(f.ceco_id ?? '')) ?? '',
      render: f => (
        <span onClick={e => { e.stopPropagation(); setEditor({ tipo: 'ceco', fila: f, rect: e.currentTarget.getBoundingClientRect() }) }}
          title="Clic para asignar el centro de costo del proveedor (aplica a todas sus facturas)"
          style={{ cursor: 'pointer', fontSize: 11, color: f.ceco_id ? INK : SLATE, borderBottom: '1px dashed #C7CBD1' }}>
          {cecoNombre.get(String(f.ceco_id ?? '')) ?? '—'}
        </span>
      ) },
    { key: 'origen_clasificacion', label: 'Clasificación', width: 130, value: f => ORIGEN[f.origen_clasificacion]?.l ?? f.origen_clasificacion,
      render: f => {
        const o = ORIGEN[f.origen_clasificacion] || {}
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Badge l={o.l} c={o.c} title={o.desc} />
            {f.origen_clasificacion === 'regla_automatica' && (
              <button onClick={e => { e.stopPropagation(); confirmarSugerida(f) }} disabled={procesando === f.id}
                title={`Confirmar ${f.cuenta} como regla del proveedor`}
                style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: VERDE, border: 'none', borderRadius: 5, padding: '2px 7px', cursor: 'pointer' }}>✓</button>
            )}
          </span>
        )
      } },
    { key: 'estado_pago', label: 'Pago', width: 100, value: f => PAGO[f.estado_pago]?.l ?? f.estado_pago,
      render: f => { const p = PAGO[f.estado_pago] || {}; return <Badge l={p.l} c={p.c} /> } },
    { key: 'saldo', label: 'Saldo', width: 95, align: 'right', value: f => Number(f.saldo) || 0,
      render: f => Number(f.saldo) > 1 && f.estado_pago !== 'pagada' ? <span style={{ fontFamily: 'ui-monospace, monospace', color: ROJO }}>{fmt(f.saldo)}</span> : '', exportValue: f => Number(f.saldo) || 0 },
    { key: 'dias', label: 'Días', width: 78, align: 'right', value: f => Number(f.dias) || 0,
      render: f => {
        if (!(Number(f.saldo) > 1 && f.estado_pago !== 'pagada')) return ''
        const d = Number(f.dias) || 0
        const [c, bg] = d > 60 ? [ROJO, '#FEF2F2'] : d > 30 ? [AMBAR, '#FFFBEB'] : [SLATE, '#F1F5F9']
        return <span style={{ fontSize: 10.5, fontWeight: 700, color: c, background: bg, borderRadius: 5, padding: '1px 6px' }}>{d}d</span>
      } },
    { key: 'asiento_numero', label: 'Asiento', width: 80, render: f => <span style={{ fontSize: 11, color: SLATE }}>{f.asiento_numero ?? ''}</span> },
  ], [cecoNombre, procesando, cuentaNom])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '8px 12px', fontSize: 11.5, color: '#1E3A8A', lineHeight: 1.5 }}>
        <b>Etapa 1 · Imputación.</b> Cada factura recibe su cuenta contable <b>antes</b> de pagarse. Clic en la celda <b>Cuenta contable</b> para asignarla
        (se guarda al elegir). Las <b>sugeridas</b> se confirman con el botón ✓. Con "fijar regla del proveedor" activo, una asignación ajusta todas las facturas del proveedor y las próximas llegan clasificadas solas.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Kpi label="Facturas 2026" valor={kpi.total} detalle={fmt(kpi.monto)} />
        <Kpi label="Sin clasificar" valor={kpi.pend} color={kpi.pend ? ROJO : VERDE} detalle="en 1810101 Pendientes" />
        <Kpi label="Sugeridas por revisar" valor={kpi.auto} color={AMBAR} detalle={fmt(kpi.autoMonto)} />
        <Kpi label="Confirmadas" valor={kpi.confirmadas} color={VERDE} detalle="regla manual" />
        <Kpi label="Saldo por pagar" valor={fmt(kpi.porPagar)} detalle="facturas pendientes o parciales" />
      </div>

      {/* chips de trabajo + filtros de universo */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {CHIPS.map(([k, l]) => (
          <button key={k} onClick={() => setChip(k)} style={{
            fontSize: 11.5, fontWeight: chip === k ? 700 : 500, padding: '5px 12px', borderRadius: 16, cursor: 'pointer',
            border: `1px solid ${chip === k ? NAVY : BORDE}`, background: chip === k ? NAVY : '#fff', color: chip === k ? '#fff' : INK,
          }}>{l} · {nChip[k]}</button>
        ))}
        <div style={{ flex: 1 }} />
        <select value={periodo} onChange={e => setPeriodo(e.target.value)} style={INPUT}>
          <option value="todos">Todos los períodos</option>{periodos.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={pago} onChange={e => setPago(e.target.value)} style={INPUT}>
          <option value="todos">Todo estado de pago</option>
          {Object.entries(PAGO).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </select>
      </div>

      {marcadas.size > 0 && (
        <div style={{ padding: '8px 12px', background: NAVY, borderRadius: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{marcadas.size} seleccionadas</span>
          <select value={cuentaMasiva} onChange={e => setCuentaMasiva(e.target.value)} style={{ ...INPUT, minWidth: 260 }}>
            <option value="">— cuenta destino —</option>
            {cuentas.map(c => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
          </select>
          <button onClick={clasificarMasivo} disabled={procesando === 'masivo' || !cuentaMasiva}
            style={{ ...INPUT, cursor: 'pointer', fontWeight: 700, color: NAVY, background: '#fff', border: 'none', opacity: cuentaMasiva ? 1 : 0.5 }}>
            {procesando === 'masivo' ? 'Clasificando…' : 'Clasificar selección'}
          </button>
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.7)' }}>
            {reglaProv ? 'Fijará la regla de cada proveedor y ajustará todas sus facturas' : 'Solo las facturas marcadas, sin tocar reglas'}
          </span>
          <button onClick={() => setMarcadas(new Set())} style={{ ...INPUT, cursor: 'pointer', marginLeft: 'auto', fontSize: 11 }}>Limpiar</button>
        </div>
      )}

      <div style={{ height: '68vh', minHeight: 380 }}>
        <DataGrid
          title="Libro de compras — imputación"
          exportName="libro_compras_imputacion"
          loading={cargando}
          emptyText="Sin facturas con estos filtros"
          rows={visibles}
          columns={columns}
          getRowId={f => f.id}
          rowStyle={f => {
            const bg = ORIGEN[f.origen_clasificacion]?.bg
            return marcadas.has(f.id) ? { background: '#EEF2FF' } : bg ? { background: bg } : {}
          }}
          leadingHeader={<input type="checkbox" checked={visibles.length > 0 && marcadas.size === visibles.length} onChange={toggleTodas} style={{ width: 13, height: 13, cursor: 'pointer' }} />}
          leadingCell={f => <input type="checkbox" checked={marcadas.has(f.id)} onChange={() => toggleMarca(f.id)} style={{ width: 13, height: 13, cursor: 'pointer' }} />}
          toolbar={
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: reglaProv ? NAVY : SLATE }}
              title="Al asignar una cuenta, fija la regla y ajusta todas las facturas del proveedor">
              <input type="checkbox" checked={reglaProv} onChange={e => setReglaProv(e.target.checked)} style={{ width: 12, height: 12 }} /> Fijar regla del proveedor
            </label>
          }
        />
      </div>

      {editor?.tipo === 'cuenta' && (
        <ComboPopup rect={editor.rect} options={cuentaOpts} placeholder="Buscar cuenta por código o nombre…"
          onPick={v => guardarCuenta(editor.fila, v)} onClose={() => setEditor(null)} />
      )}
      {editor?.tipo === 'ceco' && (
        <ComboPopup rect={editor.rect} options={cecoOpts} placeholder="Buscar centro de costo…"
          onPick={v => guardarCeco(editor.fila, v)} onClose={() => setEditor(null)} />
      )}
    </div>
  )
}

export default LibroComprasClasificar
