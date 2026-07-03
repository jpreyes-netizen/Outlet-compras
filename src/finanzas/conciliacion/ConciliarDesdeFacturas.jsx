import { useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { Search, Loader2, Check, Sparkles, FileText, AlertCircle, RefreshCw, Archive, Undo2, X } from 'lucide-react'
import { supabase } from '../../supabase'
import { fetchFacturas, fetchSugerenciasDeFactura, fetchCargosCandidatos, vincularRespaldo, fetchMotivosNoConciliable, marcarNoConciliableMasivo, revertirNoConciliableMasivo } from './api_conciliar'

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n ?? 0)
const fmtFecha = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y.slice(2)}` }

const EST_FACT = {
  sin_pagar: { bg: '#FFFBEB', pill: { bg: '#FEF3C7', c: '#92400E' }, label: 'Sin conciliar' },
  parcial: { bg: '#F0F9FF', pill: { bg: '#E0F2FE', c: '#075985' }, label: 'Parcial' },
  pagada: { bg: '#F0FDF4', pill: { bg: '#DCFCE7', c: '#166534' }, label: 'Conciliada' },
}
// Pseudo-estado: no viene de v_estado_factura, viene de la marca conciliable_banco.
// Comisiones automáticas (Getnet, Transbank) que nunca aparecerán en la cartola.
const NO_CONCILIABLE_META = { bg: '#F8FAFC', pill: { bg: '#E2E8F0', c: '#475569' }, label: 'No aplica' }

// ════════════════════════════════════════════════════════════════════════
// FLUJO DESDE FACTURAS — contenedor de 2 paneles
// ════════════════════════════════════════════════════════════════════════
export function ConciliarDesdeFacturasFlow({ ampliado = false }) {
  const [filtros, setFiltros] = useState({ desde: null, hasta: null, estado: 'sin_pagar', texto: '', montoMin: '', montoMax: '', diasMin: '', diasMax: '' })
  const [facturas, setFacturas] = useState([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [marcadas, setMarcadas] = useState(new Set())   // selección múltiple para acción masiva
  const [motivos, setMotivos] = useState([])

  useEffect(() => {
    setLoading(true)
    fetchFacturas(filtros).then(setFacturas).catch(e => toast.error(e.message)).finally(() => setLoading(false))
  }, [filtros, reloadKey])

  useEffect(() => { fetchMotivosNoConciliable().then(setMotivos).catch(() => setMotivos([])) }, [])

  useEffect(() => {
    if (selId && !facturas.some(f => f.id === selId)) setSelId(null)
  }, [facturas, selId])

  // Al cambiar el conjunto de facturas (filtro/recarga), limpiar selección de las que ya no están
  useEffect(() => {
    setMarcadas(prev => {
      const ids = new Set(facturas.map(f => f.id))
      const next = new Set([...prev].filter(id => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [facturas])

  const selected = facturas.find(f => f.id === selId) ?? null
  function refrescar() { setReloadKey(k => k + 1) }

  function toggleMarcada(id) {
    setMarcadas(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleTodas(ids, on) {
    setMarcadas(prev => { const n = new Set(prev); ids.forEach(id => on ? n.add(id) : n.delete(id)); return n })
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 16, height: ampliado ? 'calc(100vh - 120px)' : 'calc(100vh - 260px)', minHeight: 520 }}>
      <FacturasPanel facturas={facturas} loading={loading} selId={selId} onSelect={setSelId} filtros={filtros} onFiltrosChange={setFiltros} onReload={refrescar}
        marcadas={marcadas} onToggleMarcada={toggleMarcada} onToggleTodas={toggleTodas} motivos={motivos}
        onLimpiarMarcadas={() => setMarcadas(new Set())} onAfterBulk={() => { setMarcadas(new Set()); refrescar() }} />
      <ConciliarDesdeFactura key={selId} factura={selected} onAfterChange={refrescar} />
    </div>
  )
}

// ─── Panel izquierdo: lista de facturas ──────────────────────────────────
function FacturasPanel({ facturas, loading, selId, onSelect, filtros, onFiltrosChange, onReload, marcadas, onToggleMarcada, onToggleTodas, motivos, onLimpiarMarcadas, onAfterBulk }) {
  const totales = useMemo(() => {
    const total = facturas.length
    const pagadas = facturas.filter(f => f.estado_factura === 'pagada').length
    const parciales = facturas.filter(f => f.estado_factura === 'parcial').length
    const sin = facturas.filter(f => f.estado_factura === 'sin_pagar').length
    const saldoPend = facturas.filter(f => f.estado_factura !== 'pagada').reduce((a, f) => a + f.saldo, 0)
    return { total, pagadas, parciales, sin, saldoPend }
  }, [facturas])

  const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B', background: '#F8FAFC', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
  const TD = { padding: '8px 10px', fontSize: 12, color: '#334155', whiteSpace: 'nowrap', verticalAlign: 'middle' }
  const inputSt = { padding: '6px 10px', borderRadius: 7, border: '1px solid #E2E8F0', fontSize: 12, background: '#fff', outline: 'none' }

  // Facturas seleccionables en masa: las que NO están conciliadas ni ya en la bolsa
  const idsMarcables = useMemo(() => facturas.filter(f => f.conciliable_banco !== false && f.estado_factura !== 'pagada').map(f => f.id), [facturas])
  const nMarcadas = marcadas.size
  const todasMarcadas = idsMarcables.length > 0 && idsMarcables.every(id => marcadas.has(id))
  // Si la vista actual es la bolsa (no_conciliable), la acción masiva es REVERTIR
  const enBolsa = filtros.estado === 'no_conciliable'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 14, border: '1px solid #E2E8F0', background: '#fff', height: '100%' }}>
      <div style={{ borderBottom: '1px solid #E2E8F0', padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: '#1E293B' }}>
            <FileText size={15} color="#7C3AED" /> Libro de compras
          </div>
          <button onClick={onReload} disabled={loading} style={{ width: 28, height: 28, borderRadius: 99, background: '#F1F5F9', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
            <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>

        {/* Métricas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
          <Metric label="Total" value={totales.total} />
          <Metric label="Conciliadas" value={totales.pagadas} color="#16A34A" />
          <Metric label="Parciales" value={totales.parciales} color="#0284C7" />
          <Metric label="Sin conc." value={totales.sin} color="#D97706" />
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginBottom: 10, textAlign: 'right' }}>
          Saldo pendiente: <b style={{ color: '#D97706' }}>{fmtCLP(totales.saldoPend)}</b>
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 150 }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
            <input value={filtros.texto} onChange={e => onFiltrosChange({ ...filtros, texto: e.target.value })}
              placeholder="Proveedor, RUT o folio…" style={{ ...inputSt, width: '100%', paddingLeft: 24, boxSizing: 'border-box' }} />
          </div>
          <select value={filtros.estado} onChange={e => onFiltrosChange({ ...filtros, estado: e.target.value })} style={inputSt}>
            <option value="todos">Todas</option>
            <option value="sin_pagar">Sin conciliar</option>
            <option value="parcial">Parciales</option>
            <option value="pagada">Conciliadas</option>
            <option value="no_conciliable">No conciliables (comisiones)</option>
          </select>
          <input type="date" value={filtros.desde ?? ''} onChange={e => onFiltrosChange({ ...filtros, desde: e.target.value || null })} style={inputSt} />
          <input type="date" value={filtros.hasta ?? ''} onChange={e => onFiltrosChange({ ...filtros, hasta: e.target.value || null })} style={inputSt} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          <input type="number" value={filtros.montoMin ?? ''} onChange={e => onFiltrosChange({ ...filtros, montoMin: e.target.value })}
            placeholder="Saldo min" style={{ ...inputSt, width: 100 }} />
          <input type="number" value={filtros.montoMax ?? ''} onChange={e => onFiltrosChange({ ...filtros, montoMax: e.target.value })}
            placeholder="Saldo max" style={{ ...inputSt, width: 100 }} />
          <input type="number" value={filtros.diasMin ?? ''} onChange={e => onFiltrosChange({ ...filtros, diasMin: e.target.value })}
            placeholder="Días min" style={{ ...inputSt, width: 90 }} title="Antigüedad mínima desde emisión" />
          <input type="number" value={filtros.diasMax ?? ''} onChange={e => onFiltrosChange({ ...filtros, diasMax: e.target.value })}
            placeholder="Días max" style={{ ...inputSt, width: 90 }} title="Antigüedad máxima desde emisión" />
          {(filtros.montoMin || filtros.montoMax || filtros.diasMin || filtros.diasMax) && (
            <button onClick={() => onFiltrosChange({ ...filtros, montoMin: '', montoMax: '', diasMin: '', diasMax: '' })}
              style={{ ...inputSt, cursor: 'pointer', color: '#DC2626', fontWeight: 600 }}>✕ Limpiar</button>
          )}
        </div>
      </div>

      {/* Barra de acción masiva */}
      {nMarcadas > 0 && (
        <BulkBar nMarcadas={nMarcadas} enBolsa={enBolsa} motivos={motivos}
          idsSeleccionados={[...marcadas]} onLimpiar={onLimpiarMarcadas} onAfterBulk={onAfterBulk} />
      )}

      {/* Tabla de facturas */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 32, textAlign: 'center' }}>
                <input type="checkbox" checked={todasMarcadas} disabled={idsMarcables.length === 0}
                  onChange={e => onToggleTodas(idsMarcables, e.target.checked)}
                  title="Seleccionar todas las conciliables visibles" style={{ cursor: 'pointer' }} />
              </th>
              <th style={TH}>Fecha</th>
              <th style={TH}>Folio</th>
              <th style={TH}>Proveedor</th>
              <th style={{ ...TH, textAlign: 'right' }}>Saldo</th>
              <th style={TH}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}><Loader2 size={16} /></td></tr>}
            {!loading && facturas.length === 0 && <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>No hay facturas que coincidan.</td></tr>}
            {!loading && facturas.map(f => {
              const st = f.conciliable_banco === false ? NO_CONCILIABLE_META : (EST_FACT[f.estado_factura] ?? EST_FACT.sin_pagar)
              const sel = f.id === selId
              const marcable = f.conciliable_banco !== false && f.estado_factura !== 'pagada'
              const chk = marcadas.has(f.id)
              return (
                <tr key={f.id} onClick={() => onSelect(f.id)}
                  style={{ background: chk ? '#FEF9C3' : sel ? '#EFF6FF' : st.bg, cursor: 'pointer', borderTop: '1px solid #F1F5F9', outline: sel ? '2px solid #3B82F6' : 'none', outlineOffset: -2 }}>
                  <td style={{ ...TD, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    {(marcable || (enBolsa && f.conciliable_banco === false)) && (
                      <input type="checkbox" checked={chk} onChange={() => onToggleMarcada(f.id)} style={{ cursor: 'pointer' }} />
                    )}
                  </td>
                  <td style={TD}>{fmtFecha(f.fecha_emision)}</td>
                  <td style={TD}>
                    {f.tiene_sugerencia && <Sparkles size={11} color="#7C3AED" style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />}
                    {f.folio}
                  </td>
                  <td style={{ ...TD, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.razon_social}>{f.razon_social}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtCLP(f.saldo)}</td>
                  <td style={TD}>
                    <span title={f.motivo_no_conciliable ?? ''} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 600, background: st.pill.bg, color: st.pill.c }}>{st.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Metric({ label, value, color }) {
  return (
    <div style={{ background: '#F8FAFC', borderRadius: 10, padding: 8, textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color ?? '#334155', marginTop: 2 }}>{value}</div>
    </div>
  )
}

// ─── Barra de acción masiva sobre facturas seleccionadas ────────────────
function BulkBar({ nMarcadas, enBolsa, motivos, idsSeleccionados, onLimpiar, onAfterBulk }) {
  const [motivo, setMotivo] = useState(motivos[0]?.motivo ?? '')
  const [nota, setNota] = useState('')
  const [procesando, setProcesando] = useState(false)

  useEffect(() => { if (!motivo && motivos.length) setMotivo(motivos[0].motivo) }, [motivos])

  async function marcar() {
    if (!motivo) { toast.error('Elige un motivo'); return }
    setProcesando(true)
    const tid = toast.loading(`Marcando ${nMarcadas} factura(s)…`)
    try {
      const n = await marcarNoConciliableMasivo(idsSeleccionados, motivo, nota || null)
      toast.success(`${n} factura(s) enviada(s) a la bolsa de no conciliables`, { id: tid })
      setNota(''); onAfterBulk()
    } catch (e) { toast.error('Error: ' + (e?.message ?? '?'), { id: tid }) }
    finally { setProcesando(false) }
  }

  async function revertir() {
    setProcesando(true)
    const tid = toast.loading(`Devolviendo ${nMarcadas} factura(s)…`)
    try {
      const n = await revertirNoConciliableMasivo(idsSeleccionados)
      toast.success(`${n} factura(s) devuelta(s) a conciliables`, { id: tid })
      onAfterBulk()
    } catch (e) { toast.error('Error: ' + (e?.message ?? '?'), { id: tid }) }
    finally { setProcesando(false) }
  }

  const selSt = { padding: '6px 10px', borderRadius: 7, border: '1px solid #CBD5E1', fontSize: 12, background: '#fff', outline: 'none' }

  return (
    <div style={{ padding: '10px 14px', background: enBolsa ? '#F0F9FF' : '#FEFCE8', borderBottom: `1px solid ${enBolsa ? '#BAE6FD' : '#FDE68A'}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: enBolsa ? '#075985' : '#92400E' }}>{nMarcadas} seleccionada(s)</span>
      {enBolsa ? (
        <button onClick={revertir} disabled={procesando}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(to bottom, #0EA5E9, #0284C7)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: procesando ? 0.5 : 1 }}>
          {procesando ? <Loader2 size={13} /> : <Undo2 size={13} />} Devolver a conciliables
        </button>
      ) : (
        <>
          <span style={{ fontSize: 11, color: '#78716C' }}>Marcar como no conciliable →</span>
          <select value={motivo} onChange={e => setMotivo(e.target.value)} style={selSt}>
            {motivos.map(m => <option key={m.motivo} value={m.motivo}>{m.label}</option>)}
          </select>
          <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Nota (opcional)"
            style={{ ...selSt, flex: 1, minWidth: 120 }} />
          <button onClick={marcar} disabled={procesando}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(to bottom, #F59E0B, #D97706)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: procesando ? 0.5 : 1, whiteSpace: 'nowrap' }}>
            {procesando ? <Loader2 size={13} /> : <Archive size={13} />} Enviar a la bolsa
          </button>
        </>
      )}
      <button onClick={onLimpiar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', display: 'flex', padding: 4, marginLeft: 'auto' }}><X size={15} /></button>
    </div>
  )
}

// ─── Panel derecho: cargos candidatos para la factura ────────────────────
function ConciliarDesdeFactura({ factura, onAfterChange }) {
  const [texto, setTexto] = useState('')
  const [cargos, setCargos] = useState([])
  const [loadingCargos, setLoadingCargos] = useState(false)
  const [sugerencias, setSugerencias] = useState([])
  const [selOrden, setSelOrden] = useState([])   // movimiento_ids en orden FIFO
  const [observaciones, setObservaciones] = useState('')
  const [confirmando, setConfirmando] = useState(false)

  const saldoFactura = Number(factura?.saldo) || 0

  function cargarCargos(q) {
    if (!factura) return
    setLoadingCargos(true)
    fetchCargosCandidatos({ factura, texto: q })
      .then(setCargos)
      .catch(e => toast.error(e.message))
      .finally(() => setLoadingCargos(false))
  }

  function cargarSugerencias() {
    if (!factura) return
    fetchSugerenciasDeFactura(factura.id).then(setSugerencias).catch(() => {})
  }

  useEffect(() => {
    if (!factura) return
    setSelOrden([]); setObservaciones(''); setTexto('')
    cargarCargos('')
    cargarSugerencias()
  }, [factura?.id])

  // Reparto FIFO de los cargos seleccionados sobre el saldo de la factura
  const plan = useMemo(() => {
    let restante = saldoFactura
    const filas = []
    for (const id of selOrden) {
      const c = cargos.find(x => x.movimiento_id === id)
      if (!c) continue
      const aplica = Math.max(0, Math.min(restante, c.saldoDisponible))
      filas.push({ ...c, aplica })
      restante -= aplica
    }
    return { filas, totalAplica: saldoFactura - restante, saldoRestante: restante }
  }, [selOrden, cargos, saldoFactura])

  function toggleCargo(id) {
    setSelOrden(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function conciliar() {
    const aAplicar = plan.filas.filter(f => f.aplica > 0)
    if (aAplicar.length === 0 || !factura) return
    setConfirmando(true)
    const tid = toast.loading(`Conciliando ${aAplicar.length} pago(s)…`)
    try {
      for (const c of aAplicar) {
        await vincularRespaldo({
          movimientoId: c.movimiento_id,
          tipoRespaldo: 'factura_compra',
          facturaId: factura.id,
          monto: c.aplica,
          observaciones: observaciones || `Pago de factura folio ${factura.folio}`,
          movimiento: { movimiento_id: c.movimiento_id, descripcion: c.descripcion, monto: c.monto },
          proveedorNombre: factura.razon_social ?? null,
        })
      }
      toast.success(`Conciliado ${fmtCLP(plan.totalAplica)}`, { id: tid })
      setSelOrden([]); setObservaciones('')
      onAfterChange?.()
    } catch (e) {
      toast.error('Error: ' + e.message, { id: tid })
    } finally { setConfirmando(false) }
  }

  // Aceptar sugerencia del agente (1 clic)
  async function aceptarSugerencia() {
    if (!sugerencias.length) return
    setConfirmando(true)
    const tid = toast.loading('Aplicando sugerencia…')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      for (const s of sugerencias) {
        await supabase.rpc('fn_agente_aprobar_sugerencia', { p_sugerencia_id: s.id, p_user_id: user?.id ?? null })
      }
      toast.success('Sugerencia aplicada', { id: tid })
      onAfterChange?.()
    } catch (e) {
      toast.error('Error: ' + e.message, { id: tid })
    } finally { setConfirmando(false) }
  }

  if (!factura) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', padding: 40, textAlign: 'center', border: '1px solid #E2E8F0', borderRadius: 14, background: '#fff' }}>
        <FileText size={28} style={{ marginBottom: 12, opacity: 0.4 }} />
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#64748B' }}>Selecciona una factura</div>
        <div style={{ fontSize: 12 }}>Elige una factura del libro a la izquierda para asociarle su pago</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', border: '1px solid #E2E8F0', borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
      {/* Factura destacada */}
      <div style={{ padding: '14px 16px', background: '#F5F3FF', borderBottom: '1px solid #DDD6FE' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#5B21B6', textTransform: 'uppercase' }}>Factura folio {factura.folio}</span>
          <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: '#5B21B6' }}>{fmtCLP(saldoFactura)}</span>
        </div>
        <div style={{ fontSize: 11, color: '#7C3AED', marginTop: 2 }}>{factura.razon_social} · {factura.rut_proveedor}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: '#7C3AED' }}>
          <span>Total: {fmtCLP(factura.monto_total)}</span>
          <span>Ya pagado: {fmtCLP(factura.total_pagado)}</span>
          <span>Saldo por conciliar: <b>{fmtCLP(saldoFactura)}</b></span>
        </div>
      </div>

      {/* Sugerencia del agente */}
      {sugerencias.length > 0 && (
        <div style={{ margin: 12, padding: '10px 12px', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sparkles size={16} color="#D97706" />
          <div style={{ flex: 1, fontSize: 11 }}>
            <div style={{ fontWeight: 700, color: '#92400E' }}>El agente sugiere {sugerencias.length === 1 ? 'este pago' : `${sugerencias.length} pagos`}</div>
            <div style={{ color: '#B45309' }}>
              {sugerencias.map(s => `${fmtFecha(s.fecha_cargo)} · ${fmtCLP(s.monto_cargo)}`).join(' · ')}
            </div>
          </div>
          <button onClick={aceptarSugerencia} disabled={confirmando}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: 'none', background: 'linear-gradient(to bottom, #F59E0B, #D97706)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: confirmando ? 0.5 : 1 }}>
            {confirmando ? <Loader2 size={12} /> : <Check size={12} />} Aceptar
          </button>
        </div>
      )}

      {/* Buscador de cargos */}
      <div style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargarCargos(texto)}
            placeholder="Buscar pago por descripción del banco"
            style={{ width: '100%', padding: '7px 10px 7px 26px', fontSize: 12, borderRadius: 7, border: '1px solid #E2E8F0', boxSizing: 'border-box' }} />
        </div>
        <button onClick={() => cargarCargos(texto)} style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #E2E8F0', background: '#fff', fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>Buscar</button>
      </div>

      {/* Lista de cargos candidatos */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
        {loadingCargos && <div style={{ padding: 30, textAlign: 'center', color: '#94A3B8' }}><Loader2 size={16} /></div>}
        {!loadingCargos && cargos.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>Busqué por RUT y por nombre del proveedor sin resultados. Puede ser un pago masivo o estar en otra glosa — probá el buscador manual.</div>}
        {!loadingCargos && cargos.map(c => {
          const idx = selOrden.indexOf(c.movimiento_id)
          const sel = idx >= 0
          const planC = plan.filas.find(p => p.movimiento_id === c.movimiento_id)
          return (
            <div key={c.movimiento_id} onClick={() => toggleCargo(c.movimiento_id)} style={{
              padding: '9px 10px', marginBottom: 5, cursor: 'pointer',
              background: sel ? '#EFF6FF' : '#fff',
              border: sel ? '1px solid #3B82F6' : '1px solid #E2E8F0', borderRadius: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {sel
                  ? <span style={{ width: 18, height: 18, borderRadius: 4, background: '#3B82F6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{idx + 1}</span>
                  : <span style={{ width: 18, height: 18, borderRadius: 4, border: '2px solid #CBD5E1', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.descripcion}</div>
                  <div style={{ fontSize: 10, color: '#94A3B8' }}>{fmtFecha(c.fecha)}</div>
                </div>
                {typeof c.score === 'number' && c.score > 0 && (
                  <span title="Relevancia estimada: exactitud de monto + coherencia de fechas"
                    style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 99, flexShrink: 0,
                      background: c.score >= 90 ? '#DCFCE7' : c.score >= 60 ? '#FEF3C7' : '#F1F5F9',
                      color: c.score >= 90 ? '#166534' : c.score >= 60 ? '#92400E' : '#94A3B8' }}>
                    {c.score >= 90 ? '★ ' : ''}{c.score}%
                  </span>
                )}
                <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#B91C1C' }}>{fmtCLP(c.saldoDisponible)}</div>
              </div>
              {sel && planC && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #BFDBFE', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <span style={{ color: '#1D4ED8', whiteSpace: 'nowrap' }}>Aplica <b style={{ fontFamily: 'monospace' }}>{fmtCLP(planC.aplica)}</b></span>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: planC.aplica <= 0 ? '#F1F5F9' : '#DBEAFE', color: planC.aplica <= 0 ? '#94A3B8' : '#1D4ED8' }}>
                    {planC.aplica <= 0 ? 'factura ya cubierta' : 'a esta factura'}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: 12, borderTop: '1px solid #E2E8F0', background: '#F8FAFC' }}>
        {plan.totalAplica > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 8, color: '#475569' }}>
            <span>Se aplicará: <b style={{ color: '#16A34A', fontFamily: 'monospace' }}>{fmtCLP(plan.totalAplica)}</b></span>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: plan.saldoRestante <= 0.5 ? '#DCFCE7' : '#E0F2FE', color: plan.saldoRestante <= 0.5 ? '#15803D' : '#075985' }}>
              {plan.saldoRestante <= 0.5 ? 'quedará conciliada' : `quedará parcial · ${fmtCLP(plan.saldoRestante)}`}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Observación (opcional)"
            style={{ flex: 1, padding: '8px 10px', fontSize: 11, borderRadius: 7, border: '1px solid #E2E8F0' }} />
          <button onClick={conciliar} disabled={plan.totalAplica <= 0 || confirmando}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 7, border: 'none', background: 'linear-gradient(to bottom, #16A34A, #15803D)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: plan.totalAplica <= 0 || confirmando ? 0.5 : 1, whiteSpace: 'nowrap' }}>
            {confirmando ? <Loader2 size={13} /> : <Check size={13} />} Conciliar {fmtCLP(plan.totalAplica)}
          </button>
        </div>
      </div>
    </div>
  )
}
