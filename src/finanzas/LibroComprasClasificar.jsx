import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabase'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

/* ══════════════════════════════════════════════════════════════════════
   LIBRO DE COMPRAS — IMPUTACIÓN CONTABLE
   Etapa 1 del ciclo: cada factura recibe su cuenta contable ANTES de pagarse.
   Clasificar aquí genera el asiento de reclasificación y aprende el proveedor.
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73'
const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', FONDO = '#F9FAFB'
const fmt = n => (n == null || n === '' ? '' : new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n))))
const TH = { padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase',
  letterSpacing: 0.4, borderBottom: `1px solid ${BORDE}`, background: FONDO, position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap' }
const TD = { padding: '5px 8px', fontSize: 12, color: INK, borderBottom: '1px solid #F3F4F6' }
const TDNUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }
const INPUT = { fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: INK }

const ORIGEN = {
  pendiente:        { l: 'Sin clasificar',      c: ROJO,  desc: 'Cayó en 1810101 Pendientes. Asignar cuenta.' },
  regla_automatica: { l: 'Regla automática',    c: AMBAR, desc: 'Cuenta derivada de OC o pagos históricos. Revisar y confirmar.' },
  por_oc:           { l: 'Mercadería (OC)',      c: SLATE, desc: 'Factura con OC → inventario por defecto.' },
  din:              { l: 'DIN importación',      c: SLATE, desc: 'Mercadería en tránsito.' },
  regla_manual:     { l: 'Confirmada',           c: VERDE, desc: 'Regla fijada manualmente. Las próximas facturas van solas.' },
  clasificada:      { l: 'Clasificada',          c: VERDE, desc: '' },
  sin_asiento:      { l: 'Sin asiento',          c: SLATE, desc: 'Aún no contabilizada (motor nocturno).' },
}
const PAGO = {
  pagada: { l: 'Pagada', c: VERDE }, parcial: { l: 'Parcial', c: AMBAR }, pendiente: { l: 'Por pagar', c: ROJO },
  no_conciliable: { l: 'No conciliable', c: SLATE }, nc: { l: 'Nota de crédito', c: SLATE },
}

function Kpi({ label, valor, detalle, color }) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 140, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color || INK, fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>{valor}</div>
      {detalle && <div style={{ fontSize: 10, color: SLATE, marginTop: 2 }}>{detalle}</div>}
    </div>
  )
}

export function LibroComprasClasificar({ cu }) {
  const [filas, setFilas] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [cecos, setCecos] = useState([])
  const [filtros, setFiltros] = useState({ periodo: 'todos', origen: 'todos', pago: 'todos', texto: '' })
  const [sel, setSel] = useState({})           // factura_id → cuenta elegida
  const [marcadas, setMarcadas] = useState(new Set())   // selección masiva
  const [cuentaMasiva, setCuentaMasiva] = useState('')
  const [aplicarProv, setAplicarProv] = useState(true)
  const [procesando, setProcesando] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [agrupar, setAgrupar] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
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
    finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const periodos = useMemo(() => [...new Set(filas.map(f => f.periodo))].sort().reverse(), [filas])

  const visibles = useMemo(() => {
    const t = filtros.texto.trim().toLowerCase()
    return filas.filter(f =>
      (filtros.periodo === 'todos' || f.periodo === filtros.periodo) &&
      (filtros.origen === 'todos' || f.origen_clasificacion === filtros.origen) &&
      (filtros.pago === 'todos' || f.estado_pago === filtros.pago) &&
      (!t || (f.razon_social || '').toLowerCase().includes(t) || (f.rut || '').includes(t) || String(f.folio || '').includes(t)))
  }, [filas, filtros])

  // Agrupación por proveedor (la unidad natural de imputación)
  const grupos = useMemo(() => {
    const m = new Map()
    visibles.forEach(f => {
      const g = m.get(f.rut) || { rut: f.rut, nombre: f.razon_social, facturas: [], monto: 0, cuentas: new Set(), origenes: new Set() }
      g.facturas.push(f); g.monto += Number(f.monto_total); if (f.cuenta) g.cuentas.add(f.cuenta + ' ' + (f.cuenta_nombre || '')); g.origenes.add(f.origen_clasificacion)
      m.set(f.rut, g)
    })
    return [...m.values()].sort((a, b) => b.monto - a.monto)
  }, [visibles])

  const kpi = useMemo(() => ({
    total: filas.length, monto: filas.reduce((s, f) => s + Number(f.monto_total), 0),
    pend: filas.filter(f => f.origen_clasificacion === 'pendiente').length,
    auto: filas.filter(f => f.origen_clasificacion === 'regla_automatica').length,
    autoMonto: filas.filter(f => f.origen_clasificacion === 'regla_automatica').reduce((s, f) => s + Number(f.monto_total), 0),
    porPagar: filas.filter(f => ['pendiente', 'parcial'].includes(f.estado_pago)).reduce((s, f) => s + Number(f.saldo), 0),
    confirmadas: filas.filter(f => f.origen_clasificacion === 'regla_manual').length,
  }), [filas])

  async function clasificar(f) {
    const cuenta = sel[f.id]
    if (!cuenta) { toast.warning('Elija la cuenta'); return }
    setProcesando(f.id)
    try {
      if (aplicarProv) {
        const { data, error } = await supabase.rpc('fn_clasificar_proveedor', { p_rut: f.rut, p_cuenta: cuenta, p_usuario: cu?.id ?? 'ui' })
        if (error) throw error
        toast.success(`${f.razon_social}: regla confirmada · ${data.facturas_reclasificadas} facturas reclasificadas`)
      } else {
        const { data, error } = await supabase.rpc('fn_clasificar_factura', { p_factura_id: f.id, p_cuenta: cuenta, p_usuario: cu?.id ?? 'ui', p_aplicar_regla: false })
        if (error) throw error
        toast.success(data.reclasificado ? `Factura ${f.folio} reclasificada` : 'Sin cambios (ya estaba en esa cuenta)')
      }
      setSel(s => { const n = { ...s }; delete n[f.id]; return n })
      cargar()
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  const toggleMarca = id => setMarcadas(m => { const n = new Set(m); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleGrupo = g => setMarcadas(m => {
    const n = new Set(m); const ids = g.facturas.map(f => f.id)
    const todas = ids.every(id => n.has(id))
    ids.forEach(id => todas ? n.delete(id) : n.add(id)); return n
  })
  const toggleTodas = () => setMarcadas(m => m.size === visibles.length ? new Set() : new Set(visibles.map(f => f.id)))

  async function clasificarMasivo() {
    if (!cuentaMasiva) { toast.warning('Elija la cuenta destino para la selección'); return }
    const facturas = visibles.filter(f => marcadas.has(f.id))
    if (!facturas.length) return
    if (!window.confirm(`Clasificar ${facturas.length} facturas en la cuenta ${cuentaMasiva}?${aplicarProv ? ' Se fijará la regla para cada proveedor involucrado.' : ''}`)) return
    setProcesando('masivo')
    let ok = 0, err = 0
    try {
      if (aplicarProv) {
        // Por proveedor: una llamada masiva por RUT (fija regla + reclasifica todo el proveedor)
        const ruts = [...new Set(facturas.map(f => f.rut))]
        for (const rut of ruts) {
          const { data, error } = await supabase.rpc('fn_clasificar_proveedor', { p_rut: rut, p_cuenta: cuentaMasiva, p_usuario: cu?.id ?? 'ui' })
          if (error) { err++ } else { ok += data?.facturas_reclasificadas ?? 0 }
        }
        toast.success(`${ruts.length} proveedores procesados · ${ok} facturas reclasificadas${err ? ` · ${err} errores` : ''}`)
      } else {
        // Factura a factura, sin tocar reglas
        for (const f of facturas) {
          const { error } = await supabase.rpc('fn_clasificar_factura', { p_factura_id: f.id, p_cuenta: cuentaMasiva, p_usuario: cu?.id ?? 'ui', p_aplicar_regla: false })
          error ? err++ : ok++
        }
        toast.success(`${ok} facturas clasificadas${err ? ` · ${err} errores` : ''}`)
      }
      setMarcadas(new Set()); setCuentaMasiva('')
      cargar()
    } finally { setProcesando(null) }
  }

  async function asignarCeco(g, ceco) {
    if (!ceco) return
    setProcesando(g.rut)
    try {
      const { data, error } = await supabase.rpc('fn_asignar_ceco_proveedor', { p_rut: g.rut, p_ceco: ceco, p_usuario: cu?.id ?? 'ui' })
      if (error) throw error
      toast.success(`${g.nombre}: centro de costo ${data.ceco} (${data.facturas} facturas)`)
      cargar()
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  async function confirmarProveedor(g) {
    // Confirma la cuenta actual como regla manual (sin cambiar cuenta)
    const cuentaActual = g.facturas.find(f => f.cuenta && f.cuenta !== '1810101')?.cuenta
    if (!cuentaActual) { toast.warning('Elija una cuenta en alguna factura del proveedor'); return }
    setProcesando(g.rut)
    try {
      const { data, error } = await supabase.rpc('fn_clasificar_proveedor', { p_rut: g.rut, p_cuenta: cuentaActual, p_usuario: cu?.id ?? 'ui' })
      if (error) throw error
      toast.success(`${g.nombre}: cuenta ${cuentaActual} confirmada (${data.facturas_reclasificadas} ajustadas)`)
      cargar()
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  function exportar() {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visibles.map(f => ({
      Período: f.periodo, Fecha: f.fecha_emision, 'Tipo doc': f.codigo_sii, Folio: f.folio, RUT: f.rut, Proveedor: f.razon_social,
      Neto: f.neto, IVA: f.iva, Total: f.monto_total, Cuenta: f.cuenta, 'Cuenta nombre': f.cuenta_nombre,
      Clasificación: ORIGEN[f.origen_clasificacion]?.l, 'Estado pago': PAGO[f.estado_pago]?.l, Saldo: f.saldo, Días: f.dias, Asiento: f.asiento_numero,
    }))), 'Libro compras')
    XLSX.writeFile(wb, 'libro_compras_imputacion.xlsx'); toast.success(`${visibles.length} facturas exportadas`)
  }

  const SelCuenta = ({ value, onChange, style }) => (
    <select value={value || ''} onChange={e => onChange(e.target.value)} style={{ ...INPUT, ...style }}>
      <option value="">— cambiar cuenta —</option>
      {cuentas.map(c => <option key={c.codigo} value={c.codigo} title={c.descripcion_uso || ''}>{c.codigo} · {c.nombre}</option>)}
    </select>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '8px 12px', fontSize: 11.5, color: '#1E3A8A', lineHeight: 1.5 }}>
        <b>Etapa 1 · Imputación.</b> Cada factura del libro de compras debe tener su cuenta contable (mercadería, arriendo, servicio…)
        <b> antes</b> de pagarse: la factura define el gasto o el activo; el pago después solo cancela la deuda.
        La <b>regla automática</b> es una propuesta del sistema derivada de tus OC y pagos históricos — revisala por proveedor y confirmala.
        Con "aplicar al proveedor" activo, una sola confirmación fija la regla y ajusta todas sus facturas.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Kpi label="Facturas 2026" valor={kpi.total} detalle={fmt(kpi.monto)} />
        <Kpi label="Sin clasificar" valor={kpi.pend} color={kpi.pend ? ROJO : VERDE} detalle="en 1810101 Pendientes" />
        <Kpi label="Regla automática por revisar" valor={kpi.auto} color={AMBAR} detalle={fmt(kpi.autoMonto)} />
        <Kpi label="Confirmadas" valor={kpi.confirmadas} color={VERDE} detalle="regla manual" />
        <Kpi label="Saldo por pagar" valor={fmt(kpi.porPagar)} detalle="facturas pendientes o parciales" />
      </div>

      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${BORDE}`, background: FONDO, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginRight: 8 }}>Libro de compras — imputación</div>
          <select value={filtros.periodo} onChange={e => setFiltros({ ...filtros, periodo: e.target.value })} style={INPUT}>
            <option value="todos">Todos los períodos</option>{periodos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={filtros.origen} onChange={e => setFiltros({ ...filtros, origen: e.target.value })} style={INPUT}>
            <option value="todos">Toda clasificación</option>
            {Object.entries(ORIGEN).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
          </select>
          <select value={filtros.pago} onChange={e => setFiltros({ ...filtros, pago: e.target.value })} style={INPUT}>
            <option value="todos">Todo estado de pago</option>
            {Object.entries(PAGO).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
          </select>
          <input value={filtros.texto} onChange={e => setFiltros({ ...filtros, texto: e.target.value })} placeholder="Proveedor, RUT o folio…" style={{ ...INPUT, width: 170 }} />
          <label style={{ ...INPUT, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: agrupar ? NAVY : SLATE }}>
            <input type="checkbox" checked={agrupar} onChange={e => setAgrupar(e.target.checked)} style={{ width: 12, height: 12 }} /> Por proveedor
          </label>
          <label style={{ ...INPUT, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: aplicarProv ? NAVY : SLATE }} title="Al clasificar, fija la regla y ajusta todas las facturas del proveedor">
            <input type="checkbox" checked={aplicarProv} onChange={e => setAplicarProv(e.target.checked)} style={{ width: 12, height: 12 }} /> Aplicar al proveedor
          </label>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: SLATE }}>{visibles.length} facturas</div>
          <button onClick={exportar} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Exportar</button>
        </div>

        {marcadas.size > 0 && (
          <div style={{ padding: '8px 12px', background: NAVY, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
              {aplicarProv ? 'Fijará la regla de cada proveedor y ajustará todas sus facturas' : 'Solo las facturas marcadas, sin tocar reglas'}
            </span>
            <button onClick={() => setMarcadas(new Set())} style={{ ...INPUT, cursor: 'pointer', marginLeft: 'auto', fontSize: 11 }}>Limpiar</button>
          </div>
        )}
        {cargando ? <div style={{ padding: 28, textAlign: 'center', color: SLATE, fontSize: 12 }}>Cargando…</div> : (
          <div style={{ maxHeight: '64vh', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...TH, width: 30 }}><input type="checkbox" checked={visibles.length > 0 && marcadas.size === visibles.length} onChange={toggleTodas} style={{ width: 13, height: 13, cursor: 'pointer' }} /></th>
                <th style={TH}>Fecha</th><th style={TH}>Documento</th><th style={TH}>Proveedor</th>
                <th style={{ ...TH, textAlign: 'right' }}>Total</th><th style={TH}>Cuenta contable</th><th style={TH}>Clasificación</th>
                <th style={TH}>Pago</th><th style={TH}>Acción</th>
              </tr></thead>
              <tbody>
                {agrupar ? grupos.map(g => {
                  const cuentasG = [...g.cuentas]
                  const origen = g.origenes.has('pendiente') ? 'pendiente' : g.origenes.has('regla_automatica') ? 'regla_automatica' : g.origenes.has('regla_manual') ? 'regla_manual' : [...g.origenes][0]
                  const o = ORIGEN[origen] || {}
                  return (
                    <>
                      <tr key={g.rut} style={{ background: '#F5F7FB' }}>
                        <td style={TD}><input type="checkbox" checked={g.facturas.every(f => marcadas.has(f.id))} onChange={() => toggleGrupo(g)} style={{ width: 13, height: 13, cursor: 'pointer' }} /></td>
                        <td colSpan={2} style={{ ...TD, fontWeight: 700, color: NAVY }}>{g.facturas.length} facturas</td>
                        <td style={{ ...TD, fontWeight: 700 }}>{g.nombre} <span style={{ color: SLATE, fontSize: 10, fontWeight: 400 }}>{g.rut}</span></td>
                        <td style={{ ...TDNUM, fontWeight: 700 }}>{fmt(g.monto)}</td>
                        <td style={{ ...TD, fontSize: 11 }}>{cuentasG.length === 1 ? cuentasG[0] : cuentasG.length > 1 ? <span style={{ color: AMBAR }}>{cuentasG.length} cuentas distintas</span> : '—'}</td>
                        <td style={{ ...TD, fontSize: 11, fontWeight: 600, color: o.c }} title={o.desc}>{o.l}</td>
                        <td style={TD}>
                          <select value={g.facturas[0]?.ceco_id || ''} onChange={e => asignarCeco(g, e.target.value)} disabled={procesando === g.rut}
                            style={{ ...INPUT, fontSize: 11, padding: '3px 6px', color: g.facturas[0]?.ceco_id ? NAVY : SLATE }} title="Centro de costo del proveedor">
                            <option value="">— centro de costo —</option>
                            {cecos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                          </select>
                        </td>
                        <td style={TD}>
                          {origen !== 'regla_manual' && cuentasG.length === 1 && (
                            <button onClick={() => confirmarProveedor(g)} disabled={procesando === g.rut}
                              style={{ ...INPUT, cursor: 'pointer', color: VERDE, fontWeight: 600, fontSize: 11 }} title="Fijar la cuenta actual como regla del proveedor">Confirmar cuenta</button>
                          )}
                        </td>
                      </tr>
                      {g.facturas.map(f => <Fila key={f.id} f={f} sel={sel} setSel={setSel} clasificar={clasificar} procesando={procesando} SelCuenta={SelCuenta} marcada={marcadas.has(f.id)} onMarca={() => toggleMarca(f.id)} indent />)}
                    </>
                  )
                }) : visibles.map(f => <Fila key={f.id} f={f} sel={sel} setSel={setSel} clasificar={clasificar} procesando={procesando} SelCuenta={SelCuenta} marcada={marcadas.has(f.id)} onMarca={() => toggleMarca(f.id)} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Fila({ f, sel, setSel, clasificar, procesando, SelCuenta, indent, marcada, onMarca }) {
  const o = ORIGEN[f.origen_clasificacion] || {}, p = PAGO[f.estado_pago] || {}
  return (
    <tr style={{ background: marcada ? '#EEF2FF' : undefined }}>
      <td style={TD}><input type="checkbox" checked={!!marcada} onChange={onMarca} style={{ width: 13, height: 13, cursor: 'pointer' }} /></td>
      <td style={{ ...TD, whiteSpace: 'nowrap', paddingLeft: indent ? 24 : 8 }}>{f.fecha_emision}</td>
      <td style={{ ...TD, whiteSpace: 'nowrap', fontSize: 11 }}>{f.codigo_sii === '61' ? 'NC' : f.codigo_sii === '914' ? 'DIN' : 'Fact'} {f.folio}</td>
      <td style={{ ...TD, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: indent ? SLATE : INK }} title={f.razon_social}>{indent ? '' : f.razon_social}</td>
      <td style={TDNUM}>{fmt(f.monto_total)}</td>
      <td style={{ ...TD, fontSize: 11 }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', color: f.cuenta === '1810101' ? ROJO : SLATE }}>{f.cuenta || '—'}</span> {f.cuenta_nombre}
      </td>
      <td style={{ ...TD, fontSize: 11, fontWeight: 600, color: o.c }} title={o.desc}>{o.l}</td>
      <td style={{ ...TD, fontSize: 11, fontWeight: 600, color: p.c }}>{p.l}{f.saldo > 1 && f.estado_pago !== 'pagada' ? <span style={{ color: SLATE, fontWeight: 400 }}> · {fmt(f.saldo)} · {f.dias}d</span> : ''}</td>
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <SelCuenta value={sel[f.id]} onChange={v => setSel(s => ({ ...s, [f.id]: v }))} style={{ width: 230 }} />
          <button onClick={() => clasificar(f)} disabled={procesando === f.id || !sel[f.id]}
            style={{ ...INPUT, cursor: sel[f.id] ? 'pointer' : 'default', color: '#fff', background: sel[f.id] ? VERDE : '#C7CBD1', border: 'none', fontWeight: 600 }}>OK</button>
        </div>
      </td>
    </tr>
  )
}

export default LibroComprasClasificar
