import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Loader2, Check, X, HelpCircle, Sparkles } from 'lucide-react'
import { supabase } from '../../supabase'

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n ?? 0)
const fFecha = s => { if (!s) return ''; const p = String(s).slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0].slice(2)}` : s }

// ════════════════════════════════════════════════════════════════════════
// ConciliarCombosTab — sugerencias de combinaciones pago ↔ facturas
// Backend: ai_match_combo + v_combos_sugeridos (Etapa 6 v3).
// Modelo: para cada pago sin conciliar se guardan TODAS las combinaciones
// candidatas (1-4 facturas) que cuadran en monto. Si hay una sola, es un
// match limpio (aceptar con un clic). Si hay varias (mismo monto repetido
// en distintas facturas), el humano elige cuál — el sistema no adivina.
// ════════════════════════════════════════════════════════════════════════
export function ConciliarCombosTab() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [aceptando, setAceptando] = useState(null)

  const cargar = useCallback(() => {
    setLoading(true)
    supabase.from('v_combos_sugeridos').select('*')
      .then(({ data, error }) => { if (error) throw error; setRows(data ?? []) })
      .catch(e => toast.error('Error: ' + e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Agrupar candidatas por pago (movimiento_id)
  const porPago = {}
  rows.forEach(r => {
    if (!porPago[r.movimiento_id]) porPago[r.movimiento_id] = []
    porPago[r.movimiento_id].push(r)
  })
  const pagos = Object.values(porPago)
  const unicos = pagos.filter(p => p[0].n_candidatas_del_pago === 1)
  const conEmpate = pagos.filter(p => p[0].n_candidatas_del_pago > 1)

  async function aceptar(combo) {
    setAceptando(combo.combo_id)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess?.session?.user?.id ?? null
      const montoAplica = Math.min(combo.monto_pago, combo.monto_facturas)
      const porFactura = Math.round(montoAplica / combo.factura_ids.length)

      // Una fila de conciliación por cada factura de la combinación (mismo riel que Finanzas)
      const inserts = combo.factura_ids.map((facturaId, i) => ({
        movimiento_id: combo.movimiento_id,
        tipo_respaldo: 'factura_compra',
        factura_compra_id: facturaId,
        monto_aplicado: i === combo.factura_ids.length - 1
          ? montoAplica - porFactura * (combo.factura_ids.length - 1)  // ajuste de redondeo en la última
          : porFactura,
        observaciones: `Sugerido por agente combinaciones · score ${combo.score}%`,
        created_by: userId,
      }))
      const { error } = await supabase.from('conciliaciones').insert(inserts)
      if (error) throw error

      // Actualizar estado del movimiento (igual que otros flujos de conciliación)
      const { data: mv } = await supabase.from('movimientos_bancarios')
        .select('id, monto, conciliaciones(monto_aplicado)').eq('id', combo.movimiento_id).maybeSingle()
      if (mv) {
        const apl = (mv.conciliaciones ?? []).reduce((a, c) => a + (Number(c.monto_aplicado) || 0), 0)
        const mt = Number(mv.monto) || 0
        const nuevo = mt > 0 && apl >= mt - 0.5 ? 'conciliado' : 'clasificado'
        await supabase.from('movimientos_bancarios').update({ estado: nuevo }).eq('id', combo.movimiento_id)
      }

      // Marcar TODAS las candidatas de este pago como resueltas (la aceptada y las descartadas)
      await supabase.from('ai_match_combo').update({ estado: 'descartada' }).eq('movimiento_id', combo.movimiento_id)
      await supabase.from('ai_match_combo').update({ estado: 'aceptada' }).eq('id', combo.combo_id)

      toast.success('Conciliado correctamente')
      cargar()
    } catch (e) {
      toast.error('Error: ' + e.message)
    } finally {
      setAceptando(null)
    }
  }

  async function descartarPago(movimientoId) {
    try {
      await supabase.from('ai_match_combo').update({ estado: 'descartada' }).eq('movimiento_id', movimientoId)
      toast.success('Descartado')
      cargar()
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}><Loader2 size={22} style={{ animation: 'spin 1s linear infinite' }} /></div>

  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#64748B', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={14} color="#7C3AED" /> Sugerencias de combinaciones pago ↔ facturas
        </div>
        <div style={{ fontSize: 11, color: '#94A3B8' }}>
          Para pagos que no calzan 1 a 1, el agente busca combinaciones de hasta 4 facturas del mismo proveedor.
          Cuando hay más de una opción posible (mismo monto en varias facturas), elegís cuál.
        </div>
      </div>

      {pagos.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 13, background: '#F9FAFB', borderRadius: 12 }}>
          Sin sugerencias pendientes. Ejecutá el generador de combinaciones para buscar nuevas.
        </div>
      )}

      {/* ─── Sección: match único (aceptar con un clic) ─── */}
      {unicos.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#166534', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={16} /> Match único ({unicos.length})
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {unicos.map(grupo => {
              const c = grupo[0]
              return (
                <div key={c.combo_id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                  background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#166534' }}>
                      {fmtCLP(c.monto_pago)} · {fFecha(c.fecha_pago)}
                    </div>
                    <div style={{ fontSize: 11, color: '#15803D', opacity: 0.8 }}>
                      {c.glosa_pago} — {c.n_facturas} factura{c.n_facturas > 1 ? 's' : ''} · score {c.score}%
                    </div>
                  </div>
                  <button onClick={() => aceptar(c)} disabled={aceptando === c.combo_id} style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none', background: '#16A34A', color: '#fff',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: aceptando === c.combo_id ? 0.5 : 1,
                  }}>{aceptando === c.combo_id ? '...' : 'Aceptar'}</button>
                  <button onClick={() => descartarPago(c.movimiento_id)} title="Descartar" style={{
                    padding: '8px 10px', borderRadius: 8, border: 'none', background: '#FEE2E2', color: '#DC2626',
                    fontSize: 12, cursor: 'pointer',
                  }}><X size={14} /></button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── Sección: elegí cuál (empate a resolver) ─── */}
      {conEmpate.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <HelpCircle size={16} /> Elegí cuál factura ({conEmpate.length} pagos)
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {conEmpate.map(grupo => {
              const primero = grupo[0]
              return (
                <div key={primero.movimiento_id} style={{
                  background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 16px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>{fmtCLP(primero.monto_pago)} · {fFecha(primero.fecha_pago)}</div>
                      <div style={{ fontSize: 11, color: '#B45309', opacity: 0.8 }}>{primero.glosa_pago}</div>
                    </div>
                    <span style={{ fontSize: 11, color: '#92400E', fontWeight: 600 }}>{grupo.length} opciones</span>
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {grupo.map(c => (
                      <div key={c.combo_id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                        background: '#fff', borderRadius: 8, border: '1px solid #FEF3C7',
                      }}>
                        <div style={{ flex: 1, fontSize: 12, color: '#374151' }}>
                          {c.n_facturas} factura{c.n_facturas > 1 ? 's' : ''} · {fmtCLP(c.monto_facturas)}
                          {c.diferencia > 0 && <span style={{ color: '#94A3B8' }}> (dif. {fmtCLP(c.diferencia)})</span>}
                        </div>
                        <button onClick={() => aceptar(c)} disabled={aceptando === c.combo_id} style={{
                          padding: '5px 12px', borderRadius: 7, border: 'none', background: '#D97706', color: '#fff',
                          fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: aceptando === c.combo_id ? 0.5 : 1,
                        }}>{aceptando === c.combo_id ? '...' : 'Elegir esta'}</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => descartarPago(primero.movimiento_id)} style={{
                    marginTop: 8, padding: '5px 10px', borderRadius: 7, border: 'none', background: 'transparent',
                    color: '#B45309', fontSize: 11, cursor: 'pointer', textDecoration: 'underline',
                  }}>Ninguna es correcta, descartar</button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
