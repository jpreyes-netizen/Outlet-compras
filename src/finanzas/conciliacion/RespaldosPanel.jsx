import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, FileText, Ship, FileQuestion, Search, Sparkles, ClipboardList, Link2 } from 'lucide-react'
import { fetchVinculados, fetchFacturasCandidatas, fetchProvisionesAbiertas, vincularRespaldo, desvincular, crearProvision, cerrarProvision, fetchRendicion, agregarLineaRendicion, eliminarLineaRendicion, fetchFacturasAgente, netearFacturaConProvision, extraerRut, buscarAprendizaje } from './api_conciliar'
import { VincularFacturaModal, VincularProvisionModal, VincularOtroModal, NuevaProvisionModal } from './Modales'

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)

const TH = { padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B', background: '#F8FAFC' }
const TD = { padding: '6px 8px', fontSize: 12, color: '#334155', whiteSpace: 'nowrap', verticalAlign: 'middle' }

function TabBtn({ active, onClick, icon, children }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
      padding: '8px 4px', fontSize: 11, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer',
      color: active ? '#0284C7' : '#64748B',
      borderBottom: active ? '2px solid #0284C7' : '2px solid transparent',
    }}>
      {icon}{children}
    </button>
  )
}

function VinculadosSection({ movimientoId, onChanged }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  const cargar = () => {
    setLoading(true)
    fetchVinculados(movimientoId).then(setData).catch(() => setData([])).finally(() => setLoading(false))
  }

  useEffect(() => { cargar() }, [movimientoId])

  async function handleDel(id) {
    if (!confirm('¿Desvincular este respaldo?')) return
    try { await desvincular(id, movimientoId); toast.success('Respaldo desvinculado'); cargar(); onChanged() }
    catch (e) { toast.error('Error: ' + (e instanceof Error ? e.message : '?')) }
  }

  return (
    <div style={{ borderBottom: '1px solid #E2E8F0', padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B', marginBottom: 8 }}>
        Respaldos vinculados ({data.length})
      </div>
      {loading && <div style={{ textAlign: 'center', padding: '10px 0' }}><Loader2 size={14} style={{ display: 'inline-block', color: '#94A3B8' }} /></div>}
      {!loading && data.length === 0 && (
        <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '8px 12px', textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>Aún no hay respaldos vinculados.</div>
      )}
      {data.length > 0 && (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Tipo</th><th style={TH}>Folio/Ref</th><th style={TH}>Proveedor</th>
              <th style={{ ...TH, textAlign: 'right' }}>Aplicado</th><th style={TH}></th>
            </tr></thead>
            <tbody>
              {data.map(v => (
                <tr key={v.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                  <td style={TD}>{v.tipo_respaldo.replace('_', ' ')}</td>
                  <td style={{ ...TD, fontFamily: 'monospace' }}>{v.folio ?? '—'}</td>
                  <td style={{ ...TD, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.proveedor ?? ''}>{v.proveedor ?? '—'}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#16A34A' }}>{fmtCLP(v.monto_aplicado)}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    <button onClick={() => handleDel(v.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', padding: 4, borderRadius: 4 }}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Badge de match score (Capa 1: scoring multicriterio) ───────────────────
const MATCH_STYLES = {
  perfecto:   { bg: '#DCFCE7', color: '#166534', label: 'Match perfecto',  icon: '🟢' },
  probable:   { bg: '#FEF9C3', color: '#854D0E', label: 'Match probable',  icon: '🟡' },
  revisar:    { bg: '#FFEDD5', color: '#9A3412', label: 'Revisar',         icon: '🟠' },
  descartado: { bg: '#F1F5F9', color: '#64748B', label: 'Baja coincidencia', icon: '⚪' },
}

function MatchBadge({ score, level, reasons }) {
  if (score == null) return <span style={{ color: '#CBD5E1', fontSize: 10 }}>—</span>
  const st = MATCH_STYLES[level] ?? MATCH_STYLES.descartado
  const tooltip = (reasons ?? []).map(r => {
    const mark = r.ok === true ? '✓' : r.ok === false ? '✗' : '⚠'
    return `${mark} ${r.txt}`
  }).join('\n')
  return (
    <div title={tooltip} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 99, background: st.bg, color: st.color, fontSize: 10, fontWeight: 700, cursor: 'help' }}>
      <Sparkles size={10} />
      <span style={{ fontFamily: 'monospace' }}>{score}%</span>
    </div>
  )
}

function FacturasTab({ movimiento, onChanged }) {
  const [texto, setTexto] = useState('')
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)
  const rutHint = extraerRut(movimiento.descripcion)

  useEffect(() => {
    setLoading(true)
    fetchFacturasCandidatas({ texto, saldoObjetivo: movimiento.saldo_pendiente, rutHint, movimiento })
      .then(setData).catch(() => setData([])).finally(() => setLoading(false))
  }, [movimiento.movimiento_id, texto, movimiento.saldo_pendiente])

  return (
    <div style={{ padding: 12 }}>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }} />
        <input value={texto} onChange={e => setTexto(e.target.value)}
          placeholder={`Buscar RUT, razón social o folio${rutHint ? ` (sugerido: ${rutHint})` : ''}`}
          style={{ width: '100%', padding: '6px 8px 6px 26px', borderRadius: 7, border: '1px solid #E2E8F0', fontSize: 12, background: '#fff', outline: 'none', boxSizing: 'border-box' }} />
      </div>
      {loading && <div style={{ textAlign: 'center', padding: '20px 0' }}><Loader2 size={14} style={{ display: 'inline-block', color: '#94A3B8' }} /></div>}
      {!loading && data.length === 0 && <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>No hay facturas candidatas. Prueba ajustar el buscador.</div>}
      {data.length > 0 && (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...TH, width: 70 }}>Match</th>
              <th style={TH}>Fecha</th><th style={TH}>Folio</th><th style={TH}>RUT</th>
              <th style={TH}>Razón social</th><th style={{ ...TH, textAlign: 'right' }}>Total</th>
              <th style={{ ...TH, textAlign: 'right' }}>Saldo</th>
            </tr></thead>
            <tbody>
              {data.map(f => {
                const bg = f.match_level === 'perfecto' ? '#F0FDF4'
                  : f.match_level === 'probable' ? '#FEFCE8'
                  : 'transparent'
                return (
                <tr key={f.id} onClick={() => setSel(f)}
                  style={{ borderTop: '1px solid #F1F5F9', cursor: 'pointer', opacity: f.estado_factura === 'pagada' ? 0.5 : 1, background: bg }}
                  onMouseEnter={e => e.currentTarget.style.background = '#EFF6FF'}
                  onMouseLeave={e => e.currentTarget.style.background = bg}>
                  <td style={TD}><MatchBadge score={f.match_score} level={f.match_level} reasons={f.match_reasons} /></td>
                  <td style={TD}>{f.fecha_emision}</td>
                  <td style={{ ...TD, fontFamily: 'monospace' }}>{f.folio ?? '—'}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: '#64748B' }}>{f.rut_proveedor ?? '—'}</td>
                  <td style={{ ...TD, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.razon_social ?? ''}>{f.razon_social ?? '—'}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(f.monto_total)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#16A34A' }}>{fmtCLP(f.saldo)}</td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {sel && (
        <VincularFacturaModal factura={sel} saldoPendienteMov={movimiento.saldo_pendiente}
          onClose={() => setSel(null)}
          onConfirm={async (monto, obs) => {
            try {
              await vincularRespaldo({ movimientoId: movimiento.movimiento_id, tipoRespaldo: 'factura_compra', facturaId: sel.id, monto, observaciones: obs, movimiento, proveedorNombre: sel.razon_social ?? null })
              toast.success('Factura vinculada'); setSel(null)
              setData(prev => prev.map(f => f.id === sel.id ? { ...f, total_pagado: f.total_pagado + monto, saldo: f.saldo - monto } : f))
              onChanged()
            } catch (e) { toast.error('Error: ' + (e instanceof Error ? e.message : '?')) }
          }} />
      )}
    </div>
  )
}

// ═══ Provisiones de aduana ═══════════════════════════════════════════
// Anticipo a cta. cte. del agente. 1 provisión = 1 importación, N cargos.
function ProvisionesTab({ movimiento, onChanged }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)          // provision a vincular
  const [rendicionDe, setRendicionDe] = useState(null) // provision a rendir
  const [creando, setCreando] = useState(false)

  const cargar = () => {
    setLoading(true)
    fetchProvisionesAbiertas().then(setData).catch(e => { toast.error('Error: ' + (e?.message ?? '?')); setData([]) }).finally(() => setLoading(false))
  }
  useEffect(() => { cargar() }, [])

  async function handleCerrar(p) {
    const cta = Number(p.saldo_cta_cte) || 0
    const msg = Math.abs(cta) < 1
      ? `¿Cerrar la provisión ${p.folio_agencia ?? ''}? Cuenta corriente saldada.`
      : `La cta. cte. con el agente tiene saldo ${fmtCLP(cta)} (pagado − rendido). ¿Cerrar igual?`
    if (!confirm(msg)) return
    try { await cerrarProvision(p.id); toast.success('Provisión cerrada'); cargar() }
    catch (e) { toast.error('Error: ' + (e instanceof Error ? e.message : '?')) }
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#64748B' }}>{data.length} provisiones abiertas</div>
        <button onClick={() => setCreando(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: 'none', background: '#16A34A', fontSize: 11, fontWeight: 600, color: '#fff', cursor: 'pointer' }}>
          <Plus size={11} /> Nueva provisión
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#64748B', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>
        Los cargos bancarios se concilian contra la <strong>provisión</strong> (clic en la fila). La factura del agente se salda desde <strong>Rendición</strong>, nunca contra el banco.
      </div>
      {loading && <div style={{ textAlign: 'center', padding: '20px 0' }}><Loader2 size={14} style={{ display: 'inline-block', color: '#94A3B8' }} /></div>}
      {!loading && data.length === 0 && <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>No hay provisiones abiertas. Crea la primera con el botón verde.</div>}
      {data.length > 0 && (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Folio / OC</th><th style={TH}>Fecha</th>
              <th style={{ ...TH, textAlign: 'right' }}>Provisionado</th>
              <th style={{ ...TH, textAlign: 'right' }}>Pagado</th>
              <th style={{ ...TH, textAlign: 'right' }}>Por pagar</th>
              <th style={TH}></th>
            </tr></thead>
            <tbody>
              {data.map(p => {
                const porPagar = Number(p.saldo_por_pagar) || 0
                return (
                <tr key={p.id} onClick={() => setSel(p)}
                  style={{ borderTop: '1px solid #F1F5F9', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F0F9FF'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ ...TD, fontFamily: 'monospace' }} title={p.oc_id ?? ''}>{p.folio_agencia ?? p.oc_id ?? '—'}</td>
                  <td style={TD}>{p.fecha_solicitud ?? '—'}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(p.monto_provisionado)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#0284C7' }}>{fmtCLP(p.monto_pagado)} <span style={{ color: '#94A3B8', fontSize: 10 }}>({p.n_pagos})</span></td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: porPagar > 0.5 ? '#D97706' : '#16A34A' }}>{fmtCLP(porPagar)}</td>
                  <td style={{ ...TD, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                    <button title="Rendición" onClick={() => setRendicionDe(p)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0284C7', padding: 3 }}><ClipboardList size={13} /></button>
                    <button title="Cerrar provisión" onClick={() => handleCerrar(p)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 3, fontSize: 12, fontWeight: 700 }}>✓</button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {sel && (
        <VincularProvisionModal provision={sel} saldoPendienteMov={movimiento.saldo_pendiente}
          onClose={() => setSel(null)}
          onConfirm={async (monto, obs) => {
            try {
              await vincularRespaldo({ movimientoId: movimiento.movimiento_id, tipoRespaldo: 'provision_aduana', provisionId: sel.id, monto, observaciones: obs, movimiento, proveedorNombre: sel.agente_nombre ?? null })
              toast.success('Cargo conciliado contra la provisión'); setSel(null); cargar(); onChanged()
            } catch (e) { toast.error('Error: ' + (e instanceof Error ? e.message : '?')) }
          }} />
      )}
      {creando && (
        <NuevaProvisionModal onClose={() => setCreando(false)}
          onCreate={async payload => {
            try { await crearProvision(payload); toast.success('Provisión creada'); setCreando(false); cargar() }
            catch (e) { toast.error('Error: ' + (e instanceof Error ? e.message : '?')) }
          }} />
      )}
      {rendicionDe && (
        <RendicionModal provision={rendicionDe} onClose={() => { setRendicionDe(null); cargar() }} />
      )}
    </div>
  )
}

// ═══ Rendición: desglose por concepto + neteo de la factura del agente ═══
function RendicionModal({ provision, onClose }) {
  const [lineas, setLineas] = useState([])
  const [loading, setLoading] = useState(true)
  const [nuevo, setNuevo] = useState({ concepto: '', monto: '', esFactura: false })
  const [neteando, setNeteando] = useState(null)   // linea en proceso de vincular factura
  const [facturas, setFacturas] = useState([])
  const [facLoading, setFacLoading] = useState(false)

  const cargar = () => {
    setLoading(true)
    fetchRendicion(provision.id).then(setLineas).catch(() => setLineas([])).finally(() => setLoading(false))
  }
  useEffect(() => { cargar() }, [provision.id])

  const totalRendido = lineas.reduce((s, l) => s + (Number(l.monto) || 0), 0)
  const pagado = Number(provision.monto_pagado) || 0

  async function handleAgregar() {
    const m = Number(nuevo.monto)
    if (!nuevo.concepto.trim() || !m || m <= 0) { toast.error('Concepto y monto son obligatorios'); return }
    try {
      await agregarLineaRendicion({ provisionId: provision.id, concepto: nuevo.concepto.trim().toUpperCase(), monto: m, esFacturaAgente: nuevo.esFactura })
      setNuevo({ concepto: '', monto: '', esFactura: false }); cargar()
    } catch (e) { toast.error('Error: ' + (e instanceof Error ? e.message : '?')) }
  }

  async function handleEliminar(l) {
    if (!confirm(l.factura_compra_id ? 'Esta línea tiene una factura neteada. Al eliminarla, la factura volverá a figurar como pendiente. ¿Continuar?' : '¿Eliminar esta línea de rendición?')) return
    try { await eliminarLineaRendicion(l); toast.success('Línea eliminada'); cargar() }
    catch (e) { toast.error('Error: ' + (e instanceof Error ? e.message : '?')) }
  }

  async function abrirNeteo(l) {
    setNeteando(l); setFacLoading(true)
    try { setFacturas(await fetchFacturasAgente(provision.agente_rut)) }
    catch { setFacturas([]) } finally { setFacLoading(false) }
  }

  async function handleNetear(f) {
    try {
      await netearFacturaConProvision({ lineaId: neteando.id, facturaId: f.id, folioProvision: provision.folio_agencia ?? provision.oc_id })
      toast.success(`Factura ${f.folio ?? ''} saldada vía provisión`); setNeteando(null); cargar()
    } catch (e) { toast.error('Error: ' + (e instanceof Error ? e.message : '?')) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 680, background: '#fff', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #F3F4F6', padding: '12px 16px' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1E293B' }}>Rendición · {provision.folio_agencia ?? provision.oc_id ?? 'provisión'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        <div style={{ maxHeight: '75vh', overflowY: 'auto', padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div style={{ background: '#F8FAFC', borderRadius: 8, padding: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#94A3B8' }}>Pagado (banco)</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0284C7' }}>{fmtCLP(pagado)}</div>
            </div>
            <div style={{ background: '#F8FAFC', borderRadius: 8, padding: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#94A3B8' }}>Rendido</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#16A34A' }}>{fmtCLP(totalRendido)}</div>
            </div>
            <div style={{ background: '#F8FAFC', borderRadius: 8, padding: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#94A3B8' }}>Saldo cta. cte.</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: Math.abs(pagado - totalRendido) < 1 ? '#16A34A' : '#D97706' }}>{fmtCLP(pagado - totalRendido)}</div>
            </div>
          </div>

          {loading && <div style={{ textAlign: 'center', padding: '14px 0' }}><Loader2 size={14} style={{ display: 'inline-block', color: '#94A3B8' }} /></div>}
          {!loading && (
            <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={TH}>Concepto</th><th style={{ ...TH, textAlign: 'right' }}>Monto</th>
                  <th style={TH}>Factura agente</th><th style={TH}></th>
                </tr></thead>
                <tbody>
                  {lineas.length === 0 && <tr><td colSpan={4} style={{ ...TD, textAlign: 'center', color: '#94A3B8', padding: '14px 0' }}>Sin líneas. Copia el desglose del documento de provisión de la agencia.</td></tr>}
                  {lineas.map(l => (
                    <tr key={l.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                      <td style={TD}>{l.concepto}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(l.monto)}</td>
                      <td style={TD}>
                        {!l.es_factura_agente ? <span style={{ color: '#94A3B8', fontSize: 11 }}>costo directo</span>
                          : l.factura_compra_id
                            ? <span style={{ color: '#16A34A', fontSize: 11, fontWeight: 600 }}>✓ folio {l.factura?.folio ?? '—'} neteada</span>
                            : <button onClick={() => abrirNeteo(l)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 600, color: '#1D4ED8', cursor: 'pointer' }}><Link2 size={10} /> Vincular factura</button>}
                      </td>
                      <td style={{ ...TD, textAlign: 'right' }}>
                        <button onClick={() => handleEliminar(l)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', padding: 3 }}><Trash2 size={12} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Agregar línea */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto auto', gap: 6, alignItems: 'center' }}>
            <input placeholder="Concepto (ej. IVA ADUANERO, CAM…)" value={nuevo.concepto}
              onChange={e => setNuevo(n => ({ ...n, concepto: e.target.value }))}
              style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, outline: 'none' }} />
            <input type="number" placeholder="Monto" value={nuevo.monto}
              onChange={e => setNuevo(n => ({ ...n, monto: e.target.value }))}
              style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, textAlign: 'right', outline: 'none' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={nuevo.esFactura} onChange={e => setNuevo(n => ({ ...n, esFactura: e.target.checked }))} /> Factura agente
            </label>
            <button onClick={handleAgregar} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 7, border: 'none', background: '#1F4E79', fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer' }}><Plus size={12} /> Agregar</button>
          </div>
          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 6 }}>
            Marca "Factura agente" solo en honorarios + gastos + IVA servicios (lo que la agencia te factura). El IVA aduanero / TGR y cargos de puerto son costo directo, sin factura de Outlet.
          </div>

          {/* Selector de factura para neteo */}
          {neteando && (
            <div style={{ marginTop: 12, border: '1px solid #BFDBFE', background: '#F8FBFF', borderRadius: 10, padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1D4ED8' }}>Facturas del agente ({provision.agente_rut}) — elegir la que corresponde a "{neteando.concepto}"</div>
                <button onClick={() => setNeteando(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 14 }}>×</button>
              </div>
              {facLoading && <div style={{ textAlign: 'center', padding: '10px 0' }}><Loader2 size={13} style={{ display: 'inline-block', color: '#94A3B8' }} /></div>}
              {!facLoading && facturas.length === 0 && <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', padding: '8px 0' }}>No hay facturas de este RUT en libro_compras.</div>}
              {!facLoading && facturas.map(f => (
                <div key={f.id} onClick={() => !f.conciliable_banco && f.motivo_no_conciliable ? null : handleNetear(f)}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '5px 8px', borderRadius: 6, fontSize: 12, cursor: f.conciliable_banco === false ? 'not-allowed' : 'pointer', opacity: f.conciliable_banco === false ? 0.45 : 1, background: '#fff', border: '1px solid #E2E8F0', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'monospace' }}>{f.fecha_emision} · folio {f.folio ?? '—'}</span>
                  <span>{f.conciliable_banco === false ? <em style={{ fontSize: 10, color: '#94A3B8' }}>{f.motivo_no_conciliable ?? 'no conciliable'}</em> : null}</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmtCLP(f.monto_total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OtrosTab({ movimiento, onChanged }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ padding: 20, textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>Para gastos bancarios, comisiones e impuestos sin factura.</div>
      <button onClick={() => setOpen(true)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, border: 'none', background: 'linear-gradient(to bottom, #475569, #1E293B)', fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer' }}>
        <Plus size={12} /> Vincular sin respaldo tributario
      </button>
      {open && (
        <VincularOtroModal saldoPendienteMov={movimiento.saldo_pendiente} onClose={() => setOpen(false)}
          onConfirm={async (monto, obs, extra) => {
            try {
              await vincularRespaldo({ movimientoId: movimiento.movimiento_id, tipoRespaldo: 'otro', monto, observaciones: obs, subtipoOtro: extra?.subtipoOtro ?? null })
              toast.success('Movimiento marcado sin respaldo'); setOpen(false); onChanged()
            } catch (e) { toast.error('Error: ' + (e instanceof Error ? e.message : '?')) }
          }} />
      )}
    </div>
  )
}

export function RespaldosPanel({ movimiento, onAfterChange }) {
  const [tab, setTab] = useState('facturas')
  const [aprendizaje, setAprendizaje] = useState(null)
  const [aprendLoading, setAprendLoading] = useState(false)
  const [aprendDismissed, setAprendDismissed] = useState(false)

  // Buscar aprendizaje cada vez que cambia el movimiento
  useEffect(() => {
    if (!movimiento) { setAprendizaje(null); return }
    setAprendDismissed(false)
    setAprendLoading(true)
    buscarAprendizaje(movimiento)
      .then(setAprendizaje)
      .catch(() => setAprendizaje(null))
      .finally(() => setAprendLoading(false))
  }, [movimiento?.movimiento_id])

  if (!movimiento) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 14, border: '2px dashed #E2E8F0', background: 'rgba(255,255,255,0.6)', padding: 24, textAlign: 'center', fontSize: 13, color: '#94A3B8', height: '100%' }}>
        Selecciona un movimiento del panel izquierdo para ver respaldos vinculables.
      </div>
    )
  }

  const mostrarBanner = aprendizaje && !aprendDismissed && movimiento.estado_conciliacion === 'sin_conciliar'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 14, border: '1px solid #E2E8F0', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', height: '100%' }}>
      {/* Header movimiento seleccionado */}
      <div style={{ borderBottom: '1px solid #E2E8F0', background: 'linear-gradient(to bottom right, #F0F9FF, #EFF6FF)', padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B', marginBottom: 2 }}>Movimiento seleccionado</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={movimiento.descripcion}>{movimiento.descripcion}</div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{movimiento.fecha} · {movimiento.tipo}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' }}>Saldo pendiente</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#D97706' }}>{fmtCLP(movimiento.saldo_pendiente)}</div>
            <div style={{ fontSize: 10, color: '#94A3B8' }}>de {fmtCLP(movimiento.monto)}</div>
          </div>
        </div>

        {/* Banner sugerencia aprendida */}
        {aprendLoading && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#94A3B8' }}>
            <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Buscando sugerencia…
          </div>
        )}
        {mostrarBanner && (
          <div style={{ marginTop: 10, background: 'linear-gradient(135deg, #F0FDF4, #DCFCE7)', border: '1px solid #86EFAC', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Sparkles size={16} style={{ color: '#16A34A', flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', marginBottom: 2 }}>
                Sugerencia aprendida · {aprendizaje.aciertos} {aprendizaje.aciertos === 1 ? 'vez anterior' : 'veces anteriores'}
              </div>
              <div style={{ fontSize: 11, color: '#15803D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {aprendizaje.proveedor_nombre
                  ? <>Proveedor: <strong>{aprendizaje.proveedor_nombre}</strong> · {aprendizaje.tipo_respaldo.replace('_', ' ')}</>
                  : <>Tipo: <strong>{aprendizaje.tipo_respaldo.replace('_', ' ')}</strong></>
                }
              </div>
              <div style={{ fontSize: 10, color: '#4ADE80', marginTop: 2 }}>
                Patrón: "{aprendizaje.patron.slice(0, 60)}{aprendizaje.patron.length > 60 ? '…' : ''}"
              </div>
            </div>
            <button onClick={() => setAprendDismissed(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#86EFAC', fontSize: 16, lineHeight: 1, padding: 2, flexShrink: 0 }}>×</button>
          </div>
        )}
      </div>

      {/* Vinculados */}
      <VinculadosSection movimientoId={movimiento.movimiento_id} onChanged={onAfterChange} />

      {/* Tabs nuevo respaldo */}
      <div style={{ borderTop: '1px solid #E2E8F0', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
          <TabBtn active={tab === 'facturas'} onClick={() => setTab('facturas')} icon={<FileText size={12} />}>Facturas de compra</TabBtn>
          <TabBtn active={tab === 'provisiones'} onClick={() => setTab('provisiones')} icon={<Ship size={12} />}>Provisión aduana</TabBtn>
          <TabBtn active={tab === 'otros'} onClick={() => setTab('otros')} icon={<FileQuestion size={12} />}>Otros</TabBtn>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'facturas' && <FacturasTab movimiento={movimiento} onChanged={onAfterChange} />}
          {tab === 'provisiones' && <ProvisionesTab movimiento={movimiento} onChanged={onAfterChange} />}
          {tab === 'otros' && <OtrosTab movimiento={movimiento} onChanged={onAfterChange} />}
        </div>
      </div>
    </div>
  )
}
