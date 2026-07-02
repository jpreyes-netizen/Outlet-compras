import { useMemo, useState } from 'react'
import { Search, RefreshCw, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../supabase'

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)
const fmtFecha = s => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y.slice(2)}` }

const ESTADO_ST = {
  sin_conciliar: { bg: '#FFFBEB', pill: { bg: '#FEF3C7', color: '#92400E' }, label: 'Sin conciliar' },
  parcial: { bg: '#F0F9FF', pill: { bg: '#E0F2FE', color: '#075985' }, label: 'Parcial' },
  completo: { bg: '#F0FDF4', pill: { bg: '#DCFCE7', color: '#166534' }, label: 'Conciliado' },
  sobre_conciliado: { bg: '#FFF1F2', pill: { bg: '#FFE4E6', color: '#9F1239' }, label: 'Revisar: aplicado de más' },
}

const inputSt = { padding: '6px 10px', borderRadius: 7, border: '1px solid #E2E8F0', fontSize: 12, background: '#fff', outline: 'none' }

function Metric({ label, value, color }) {
  return (
    <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '8px', textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color ?? '#334155', marginTop: 2 }}>{value}</div>
    </div>
  )
}

export function MovimientosPanel({ movimientos, loading, selectedId, onSelect, filtros, onFiltrosChange, onReload, onAutoMatch, autoRunning, multiSel = [], onMultiSelChange }) {
  const [generando, setGenerando] = useState(false)

  function toggleMulti(id, e) {
    e.stopPropagation()
    const next = multiSel.includes(id) ? multiSel.filter(x => x !== id) : [...multiSel, id]
    onMultiSelChange?.(next)
  }
  const sumaMulti = movimientos.filter(m => multiSel.includes(m.movimiento_id))
    .reduce((a, m) => a + Math.abs(Number(m.monto) || 0), 0)

  async function generarSugerencias() {
    setGenerando(true)
    const tid = toast.loading('El agente está analizando los cargos…')
    try {
      const { data, error } = await supabase.rpc('fn_agente_generar_sugerencias')
      if (error) throw error
      toast.success(`${data.total} sugerencias generadas · selecciona un movimiento para verlas`, { id: tid })
      onReload?.()
    } catch (e) {
      toast.error('Error: ' + e.message, { id: tid })
    } finally { setGenerando(false) }
  }

  const totales = useMemo(() => {
    const total = movimientos.length
    const completo = movimientos.filter(m => m.estado_conciliacion === 'completo').length
    const parcial = movimientos.filter(m => m.estado_conciliacion === 'parcial').length
    const sin = movimientos.filter(m => m.estado_conciliacion === 'sin_conciliar').length
    const pct = total ? Math.round((completo / total) * 100) : 0
    return { total, completo, parcial, sin, pct }
  }, [movimientos])

  const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B', background: '#F8FAFC', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
  const TD = { padding: '8px 10px', fontSize: 12, color: '#334155', whiteSpace: 'nowrap', verticalAlign: 'middle' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 14, border: '1px solid #E2E8F0', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', height: '100%' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #E2E8F0', padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>Movimientos bancarios</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={generarSugerencias} disabled={generando || loading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 10, border: 'none', background: 'linear-gradient(to bottom, #A855F7, #7C3AED)', fontSize: 11, fontWeight: 600, color: '#fff', cursor: 'pointer', opacity: generando || loading ? 0.5 : 1 }}>
              {generando ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={11} />} {generando ? 'Analizando…' : 'Generar sugerencias'}
            </button>
            <button onClick={onReload} disabled={loading}
              style={{ width: 28, height: 28, borderRadius: 99, background: '#F1F5F9', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', opacity: loading ? 0.5 : 1 }}>
              <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            </button>
          </div>
        </div>

        {/* Métricas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
          <Metric label="Total" value={totales.total} />
          <Metric label="Completo" value={totales.completo} color="#16A34A" />
          <Metric label="Parcial" value={totales.parcial} color="#0284C7" />
          <Metric label="Sin conc." value={totales.sin} color="#D97706" />
        </div>

        {/* Barra progreso */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748B', marginBottom: 4 }}>
            <span>Avance del período</span>
            <span style={{ fontWeight: 600, color: '#334155' }}>{totales.pct}%</span>
          </div>
          <div style={{ height: 6, background: '#F1F5F9', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${totales.pct}%`, background: 'linear-gradient(to right, #34D399, #10B981)', borderRadius: 99, transition: 'width 0.4s ease' }} />
          </div>
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }} />
            <input value={filtros.texto} onChange={e => onFiltrosChange({ ...filtros, texto: e.target.value })}
              placeholder="Buscar descripción o referencia…" style={{ ...inputSt, width: '100%', paddingLeft: 24, boxSizing: 'border-box' }} />
          </div>
          <select value={filtros.estado} onChange={e => onFiltrosChange({ ...filtros, estado: e.target.value })} style={inputSt}>
            <option value="todos">Todos</option>
            <option value="sin_conciliar">Sin conciliar</option>
            <option value="parcial">Parcial</option>
            <option value="completo">Completo</option>
          </select>
          <input type="date" value={filtros.desde ?? ''} onChange={e => onFiltrosChange({ ...filtros, desde: e.target.value || null })} style={inputSt} />
          <input type="date" value={filtros.hasta ?? ''} onChange={e => onFiltrosChange({ ...filtros, hasta: e.target.value || null })} style={inputSt} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#475569', border: '1px solid #E2E8F0', borderRadius: 7, padding: '4px 8px', cursor: 'pointer', background: '#fff' }}>
            <input type="checkbox" checked={filtros.soloCargo} onChange={e => onFiltrosChange({ ...filtros, soloCargo: e.target.checked })} style={{ width: 12, height: 12 }} />
            Solo CARGO
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: filtros.soloSugerencia ? '#7C3AED' : '#475569', border: `1px solid ${filtros.soloSugerencia ? '#C4B5FD' : '#E2E8F0'}`, borderRadius: 7, padding: '4px 8px', cursor: 'pointer', background: filtros.soloSugerencia ? '#F5F3FF' : '#fff', fontWeight: filtros.soloSugerencia ? 700 : 400 }}>
            <input type="checkbox" checked={!!filtros.soloSugerencia} onChange={e => onFiltrosChange({ ...filtros, soloSugerencia: e.target.checked })} style={{ width: 12, height: 12 }} />
            <Sparkles size={11} /> Con sugerencia
          </label>
          <label title="Oculta pagos ya documentados por otra vía: remuneraciones, traspasos, impuestos, crédito, importaciones" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: filtros.soloConciliables ? '#0F766E' : '#475569', border: `1px solid ${filtros.soloConciliables ? '#99F6E4' : '#E2E8F0'}`, borderRadius: 7, padding: '4px 8px', cursor: 'pointer', background: filtros.soloConciliables ? '#F0FDFA' : '#fff', fontWeight: filtros.soloConciliables ? 700 : 400 }}>
            <input type="checkbox" checked={!!filtros.soloConciliables} onChange={e => onFiltrosChange({ ...filtros, soloConciliables: e.target.checked })} style={{ width: 12, height: 12 }} />
            Solo conciliables
          </label>
        </div>
      </div>

      {/* Barra de acción: pago múltiple (varios cargos → 1 factura) */}
      {multiSel.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: '#EEF2FF', borderBottom: '1px solid #C7D2FE' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#4338CA' }}>{multiSel.length} cargo{multiSel.length > 1 ? 's' : ''} · {fmtCLP(sumaMulti)}</span>
          <span style={{ fontSize: 11, color: '#6366F1', flex: 1 }}>→ se aplicarán juntos a la factura que elijas a la derecha</span>
          <button onClick={() => onMultiSelChange?.([])} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #C7D2FE', background: '#fff', fontSize: 11, fontWeight: 600, color: '#64748B', cursor: 'pointer' }}>Limpiar</button>
        </div>
      )}

      {/* Tabla */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 28 }}></th>
              <th style={TH}>Fecha</th>
              <th style={TH}>Tipo</th>
              <th style={{ ...TH, textAlign: 'right' }}>Monto</th>
              <th style={TH}>Descripción</th>
              <th style={TH}>Estado</th>
              <th style={{ ...TH, textAlign: 'right' }}>Saldo pend.</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} style={{ padding: '40px 0', textAlign: 'center', color: '#94A3B8' }}><Loader2 size={16} style={{ display: 'inline-block' }} /></td></tr>}
            {!loading && movimientos.length === 0 && <tr><td colSpan={7} style={{ padding: '40px 0', textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>No hay movimientos clasificados que coincidan.</td></tr>}
            {!loading && movimientos.map(m => {
              const st = ESTADO_ST[m.estado_conciliacion] ?? ESTADO_ST.sin_conciliar
              const sel = m.movimiento_id === selectedId
              return (
                <tr key={m.movimiento_id} onClick={() => onSelect(m)}
                  style={{ background: sel ? '#EFF6FF' : st.bg, cursor: 'pointer', borderTop: '1px solid #F1F5F9', outline: sel ? '2px solid #3B82F6' : 'none', outlineOffset: -2 }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.filter = 'brightness(0.97)' }}
                  onMouseLeave={e => { e.currentTarget.style.filter = 'none' }}>
                  <td style={{ ...TD, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    {m.tipo === 'CARGO' && m.estado_conciliacion !== 'completo' && (
                      <input type="checkbox" checked={multiSel.includes(m.movimiento_id)}
                        onChange={e => toggleMulti(m.movimiento_id, e)}
                        style={{ width: 13, height: 13, cursor: 'pointer' }} />
                    )}
                  </td>
                  <td style={{ ...TD }}>{fmtFecha(m.fecha)}</td>
                  <td style={TD}>
                    <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: m.tipo === 'CARGO' ? '#FFE4E6' : '#DCFCE7', color: m.tipo === 'CARGO' ? '#9F1239' : '#166534' }}>{m.tipo}</span>
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 500 }}>{fmtCLP(m.monto)}</td>
                  <td style={{ ...TD, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.descripcion}>
                    {m.tiene_sugerencia && <Sparkles size={11} color="#7C3AED" style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />}
                    {m.categoria && !m.requiere_conciliacion && (
                      <span title={`Documentado por otra vía (${m.via_clasificacion === 'patron' ? 'patrón de glosa' : 'clasificación por RUT'})`}
                        style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 99, fontSize: 9, fontWeight: 700, marginRight: 5, verticalAlign: 'middle', background: (m.categoria_color || '#64748B') + '18', color: m.categoria_color || '#64748B', border: `1px solid ${(m.categoria_color || '#64748B')}40` }}>
                        {m.categoria_label || m.categoria}
                      </span>
                    )}
                    {m.descripcion}
                  </td>
                  <td style={TD}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 600, background: st.pill.bg, color: st.pill.color }}>{st.label}</span>
                      {m.estado_conciliacion === 'parcial' && (
                        <div style={{ height: 4, width: 60, background: '#E0F2FE', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, m.porcentaje)}%`, background: '#0284C7', borderRadius: 99 }} />
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(Math.max(0, m.saldo_pendiente))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
