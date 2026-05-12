import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, FileText, Ship, FileQuestion, Search } from 'lucide-react'
import { fetchVinculados, fetchFacturasCandidatas, fetchImportacionesAbiertas, vincularRespaldo, desvincular, crearImportacion, extraerRut } from './api_conciliar'
import { VincularFacturaModal, VincularImportacionModal, VincularOtroModal, NuevaImportacionModal } from './Modales'

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

function FacturasTab({ movimiento, onChanged }) {
  const [texto, setTexto] = useState('')
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)
  const rutHint = extraerRut(movimiento.descripcion)

  useEffect(() => {
    setLoading(true)
    fetchFacturasCandidatas({ texto, saldoObjetivo: movimiento.saldo_pendiente, rutHint })
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
              <th style={TH}>Fecha</th><th style={TH}>Folio</th><th style={TH}>RUT</th>
              <th style={TH}>Razón social</th><th style={{ ...TH, textAlign: 'right' }}>Total</th>
              <th style={{ ...TH, textAlign: 'right' }}>Saldo</th>
            </tr></thead>
            <tbody>
              {data.map(f => (
                <tr key={f.id} onClick={() => setSel(f)}
                  style={{ borderTop: '1px solid #F1F5F9', cursor: 'pointer', opacity: f.estado_factura === 'pagada' ? 0.5 : 1 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F0F9FF'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={TD}>{f.fecha_emision}</td>
                  <td style={{ ...TD, fontFamily: 'monospace' }}>{f.folio ?? '—'}</td>
                  <td style={{ ...TD, fontFamily: 'monospace', color: '#64748B' }}>{f.rut_proveedor ?? '—'}</td>
                  <td style={{ ...TD, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.razon_social ?? ''}>{f.razon_social ?? '—'}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(f.monto_total)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#16A34A' }}>{fmtCLP(f.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel && (
        <VincularFacturaModal factura={sel} saldoPendienteMov={movimiento.saldo_pendiente}
          onClose={() => setSel(null)}
          onConfirm={async (monto, obs) => {
            try {
              await vincularRespaldo({ movimientoId: movimiento.movimiento_id, tipoRespaldo: 'factura_compra', facturaId: sel.id, monto, observaciones: obs })
              toast.success('Factura vinculada'); setSel(null)
              setData(prev => prev.map(f => f.id === sel.id ? { ...f, total_pagado: f.total_pagado + monto, saldo: f.saldo - monto } : f))
              onChanged()
            } catch (e) { toast.error('Error: ' + (e instanceof Error ? e.message : '?')) }
          }} />
      )}
    </div>
  )
}

function ImportacionesTab({ movimiento, onChanged }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)
  const [creando, setCreando] = useState(false)

  const cargar = () => {
    setLoading(true)
    fetchImportacionesAbiertas().then(setData).catch(() => setData([])).finally(() => setLoading(false))
  }
  useEffect(() => { cargar() }, [])

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#64748B' }}>{data.length} carpetas abiertas / parciales</div>
        <button onClick={() => setCreando(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: 'none', background: '#16A34A', fontSize: 11, fontWeight: 600, color: '#fff', cursor: 'pointer' }}>
          <Plus size={11} /> Nueva carpeta
        </button>
      </div>
      {loading && <div style={{ textAlign: 'center', padding: '20px 0' }}><Loader2 size={14} style={{ display: 'inline-block', color: '#94A3B8' }} /></div>}
      {!loading && data.length === 0 && <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>No hay carpetas de importación abiertas.</div>}
      {data.length > 0 && (
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>N° DIN</th><th style={TH}>Descripción</th>
              <th style={TH}>Proveedor</th><th style={{ ...TH, textAlign: 'right' }}>Valor CLP</th>
            </tr></thead>
            <tbody>
              {data.map(c => (
                <tr key={c.id} onClick={() => setSel(c)}
                  style={{ borderTop: '1px solid #F1F5F9', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F0F9FF'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ ...TD, fontFamily: 'monospace' }}>{c.numero_din ?? '—'}</td>
                  <td style={{ ...TD, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.descripcion ?? ''}>{c.descripcion ?? '—'}</td>
                  <td style={TD}>{c.proveedor_exterior ?? '—'}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{c.valor_clp ? fmtCLP(c.valor_clp) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel && (
        <VincularImportacionModal carpeta={sel} saldoPendienteMov={movimiento.saldo_pendiente}
          onClose={() => setSel(null)}
          onConfirm={async (monto, obs) => {
            try {
              await vincularRespaldo({ movimientoId: movimiento.movimiento_id, tipoRespaldo: 'importacion', carpetaId: sel.id, monto, observaciones: obs })
              toast.success('Importación vinculada'); setSel(null); onChanged()
            } catch (e) { toast.error('Error: ' + (e instanceof Error ? e.message : '?')) }
          }} />
      )}
      {creando && (
        <NuevaImportacionModal onClose={() => setCreando(false)}
          onCreate={async payload => {
            try { await crearImportacion(payload); toast.success('Carpeta creada'); setCreando(false); cargar() }
            catch (e) { toast.error('Error: ' + (e instanceof Error ? e.message : '?')) }
          }} />
      )}
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

  if (!movimiento) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 14, border: '2px dashed #E2E8F0', background: 'rgba(255,255,255,0.6)', padding: 24, textAlign: 'center', fontSize: 13, color: '#94A3B8', height: '100%' }}>
        Selecciona un movimiento del panel izquierdo para ver respaldos vinculables.
      </div>
    )
  }

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
      </div>

      {/* Vinculados */}
      <VinculadosSection movimientoId={movimiento.movimiento_id} onChanged={onAfterChange} />

      {/* Tabs nuevo respaldo */}
      <div style={{ borderTop: '1px solid #E2E8F0', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
          <TabBtn active={tab === 'facturas'} onClick={() => setTab('facturas')} icon={<FileText size={12} />}>Facturas de compra</TabBtn>
          <TabBtn active={tab === 'importaciones'} onClick={() => setTab('importaciones')} icon={<Ship size={12} />}>Importaciones</TabBtn>
          <TabBtn active={tab === 'otros'} onClick={() => setTab('otros')} icon={<FileQuestion size={12} />}>Otros</TabBtn>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'facturas' && <FacturasTab movimiento={movimiento} onChanged={onAfterChange} />}
          {tab === 'importaciones' && <ImportacionesTab movimiento={movimiento} onChanged={onAfterChange} />}
          {tab === 'otros' && <OtrosTab movimiento={movimiento} onChanged={onAfterChange} />}
        </div>
      </div>
    </div>
  )
}
