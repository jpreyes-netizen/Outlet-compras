import { useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { X, Sparkles, ChevronDown, ChevronRight, Check, RefreshCw, Loader2 } from 'lucide-react'
import { supabase } from '../../supabase'

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)
const fmtFecha = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y.slice(2)}` }

// Color por regla
const REGLA_INFO = {
  R1: { label: 'Match exacto', color: '#15803D', bg: '#DCFCE7', desc: 'RUT + monto coinciden con factura única abierta. Sugerencias más confiables.' },
  R2: { label: 'Cierre parcial', color: '#0284C7', bg: '#E0F2FE', desc: 'Monto = saldo restante de factura ya parcialmente pagada.' },
  R3: { label: 'Único candidato', color: '#7C3AED', bg: '#EDE9FE', desc: 'El proveedor tiene UNA sola factura abierta y el cargo cabe en su saldo.' },
  R4: { label: 'FIFO N→1', color: '#D97706', bg: '#FEF3C7', desc: 'Varios cargos del mismo proveedor suman exacto el saldo de la factura más antigua.' },
  R5: { label: 'FIFO 1→N', color: '#DB2777', bg: '#FCE7F3', desc: 'Un cargo grande cubre exactamente la suma de N facturas antiguas FIFO.' },
}

export function AgenteIAModal({ onClose, onAfterApprove }) {
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [approving, setApproving] = useState(false)
  const [sugerencias, setSugerencias] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [expanded, setExpanded] = useState(new Set(['R1'])) // R1 abierto por defecto
  const [ultimaGeneracion, setUltimaGeneracion] = useState(null)

  // Cargar sugerencias pendientes
  async function cargar() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('ai_match_sugerencias')
        .select('*')
        .eq('estado', 'pendiente')
        .order('regla')
        .order('monto_cargo', { ascending: false })
        .limit(2000)
      if (error) throw error
      setSugerencias(data ?? [])
      setSelected(new Set())  // limpiar selección al recargar
    } catch (e) {
      toast.error('Error cargando sugerencias: ' + e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { cargar() }, [])

  // Generar nuevas sugerencias (re-correr agente)
  async function regenerar() {
    setGenerating(true)
    const tid = toast.loading('Generando sugerencias del agente IA…')
    try {
      const { data, error } = await supabase.rpc('fn_agente_generar_sugerencias')
      if (error) throw error
      toast.success(`Generadas: ${data.total} sugerencias (R1:${data.r1} R2:${data.r2} R3:${data.r3} R4:${data.r4} R5:${data.r5})`, { id: tid })
      setUltimaGeneracion(data)
      await cargar()
    } catch (e) {
      toast.error('Error generando: ' + e.message, { id: tid })
    } finally { setGenerating(false) }
  }

  // Aprobar las seleccionadas
  async function aprobarSeleccionadas() {
    if (selected.size === 0) return
    setApproving(true)
    const tid = toast.loading(`Aprobando ${selected.size} sugerencias…`)
    let ok = 0, err = 0
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const userId = user?.id ?? null
      for (const sugId of selected) {
        try {
          const { error } = await supabase.rpc('fn_agente_aprobar_sugerencia', { 
            p_sugerencia_id: sugId, 
            p_user_id: userId 
          })
          if (error) throw error
          ok++
        } catch { err++ }
      }
      toast.success(`Aprobadas ${ok}${err > 0 ? ` · ${err} con error` : ''}`, { id: tid })
      await cargar()
      onAfterApprove?.()
    } catch (e) {
      toast.error('Error aprobando: ' + e.message, { id: tid })
    } finally { setApproving(false) }
  }

  // Rechazar las seleccionadas
  async function rechazarSeleccionadas() {
    if (selected.size === 0) return
    if (!confirm(`¿Rechazar ${selected.size} sugerencias? (no se conciliarán)`)) return
    setApproving(true)
    const tid = toast.loading(`Rechazando…`)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const userId = user?.id ?? null
      for (const sugId of selected) {
        await supabase.rpc('fn_agente_rechazar_sugerencia', { 
          p_sugerencia_id: sugId, 
          p_user_id: userId 
        })
      }
      toast.success(`${selected.size} rechazadas`, { id: tid })
      await cargar()
    } catch (e) {
      toast.error('Error: ' + e.message, { id: tid })
    } finally { setApproving(false) }
  }

  // Agrupar por regla
  const porRegla = useMemo(() => {
    const m = {}
    for (const s of sugerencias) {
      if (!m[s.regla]) m[s.regla] = []
      m[s.regla].push(s)
    }
    return m
  }, [sugerencias])

  const totales = useMemo(() => {
    const total = sugerencias.length
    const monto = sugerencias.reduce((a, s) => a + Number(s.monto_aplicar || 0), 0)
    const selMonto = sugerencias.filter(s => selected.has(s.id)).reduce((a, s) => a + Number(s.monto_aplicar || 0), 0)
    return { total, monto, selMonto }
  }, [sugerencias, selected])

  // Toggle selección individual
  function toggleSel(id) {
    setSelected(prev => {
      const ns = new Set(prev)
      if (ns.has(id)) ns.delete(id); else ns.add(id)
      return ns
    })
  }

  // Toggle todo el grupo de una regla
  function toggleGrupo(regla) {
    const ids = (porRegla[regla] ?? []).map(s => s.id)
    setSelected(prev => {
      const ns = new Set(prev)
      const todosSel = ids.every(id => ns.has(id))
      if (todosSel) ids.forEach(id => ns.delete(id))
      else ids.forEach(id => ns.add(id))
      return ns
    })
  }

  function toggleExp(regla) {
    setExpanded(prev => {
      const ns = new Set(prev)
      if (ns.has(regla)) ns.delete(regla); else ns.add(regla)
      return ns
    })
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, width: '95vw', maxWidth: 1200,
        height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <Sparkles size={20} color="#7C3AED" />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1E293B' }}>Agente IA — Sugerencias de conciliación</div>
              <div style={{ fontSize: 11, color: '#64748B' }}>Revisa y aprueba los matches propuestos por las 5 reglas en cascada</div>
            </div>
          </div>
          <button onClick={regenerar} disabled={generating || approving} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px',
            borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff',
            fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer',
            opacity: generating || approving ? 0.5 : 1,
          }}>
            {generating ? <Loader2 size={12} /> : <RefreshCw size={12} />}
            Regenerar
          </button>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 99, background: '#F1F5F9', border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569',
          }}><X size={16} /></button>
        </div>

        {/* Resumen */}
        <div style={{ padding: '12px 20px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', display: 'flex', gap: 16, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Total sugerencias</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1E293B' }}>{totales.total}</div>
          </div>
          <div style={{ width: 1, height: 34, background: '#E2E8F0' }} />
          <div>
            <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Monto total</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1E293B' }}>{fmtCLP(totales.monto)}</div>
          </div>
          <div style={{ width: 1, height: 34, background: '#E2E8F0' }} />
          <div>
            <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Seleccionadas</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#7C3AED' }}>{selected.size} · {fmtCLP(totales.selMonto)}</div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={rechazarSeleccionadas} disabled={selected.size === 0 || approving} style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #FCA5A5', background: '#fff',
            fontSize: 12, fontWeight: 600, color: '#B91C1C', cursor: 'pointer',
            opacity: selected.size === 0 || approving ? 0.4 : 1,
          }}>Rechazar ({selected.size})</button>
          <button onClick={aprobarSeleccionadas} disabled={selected.size === 0 || approving} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '8px 14px', borderRadius: 8, border: 'none',
            background: 'linear-gradient(to bottom, #16A34A, #15803D)',
            fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer',
            opacity: selected.size === 0 || approving ? 0.5 : 1,
          }}>
            {approving ? <Loader2 size={12} /> : <Check size={12} />}
            Aprobar ({selected.size})
          </button>
        </div>

        {/* Lista de sugerencias agrupadas por regla */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {loading && (
            <div style={{ padding: '60px 0', textAlign: 'center', color: '#94A3B8' }}>
              <Loader2 size={20} style={{ display: 'inline-block' }} />
            </div>
          )}
          {!loading && totales.total === 0 && (
            <div style={{ padding: '60px 0', textAlign: 'center', color: '#94A3B8' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No hay sugerencias pendientes</div>
              <div style={{ fontSize: 12 }}>Presiona "Regenerar" para que el agente analice los cargos sin conciliar</div>
            </div>
          )}
          {!loading && Object.entries(porRegla).map(([regla, items]) => {
            const info = REGLA_INFO[regla] ?? { label: regla, color: '#475569', bg: '#F1F5F9', desc: '' }
            const isExp = expanded.has(regla)
            const ids = items.map(i => i.id)
            const todosSel = ids.every(id => selected.has(id))
            const algunoSel = ids.some(id => selected.has(id))
            const sumaGrupo = items.reduce((a, s) => a + Number(s.monto_aplicar || 0), 0)
            return (
              <div key={regla} style={{ marginBottom: 10, border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
                {/* Header del grupo */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: info.bg, cursor: 'pointer' }} onClick={() => toggleExp(regla)}>
                  <input type="checkbox" checked={todosSel} ref={el => el && (el.indeterminate = !todosSel && algunoSel)}
                    onClick={e => e.stopPropagation()}
                    onChange={() => toggleGrupo(regla)}
                    style={{ width: 14, height: 14, cursor: 'pointer' }} />
                  {isExp ? <ChevronDown size={14} color={info.color} /> : <ChevronRight size={14} color={info.color} />}
                  <span style={{ fontSize: 12, fontWeight: 700, color: info.color }}>{regla}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>{info.label}</span>
                  <span style={{ fontSize: 11, color: '#64748B', flex: 1 }}>{info.desc}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{items.length}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: info.color }}>{fmtCLP(sumaGrupo)}</span>
                </div>
                {/* Detalles */}
                {isExp && (
                  <div style={{ background: '#fff' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th style={{ ...thSt, width: 30 }}></th>
                          <th style={thSt}>Fecha cargo</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Monto cargo</th>
                          <th style={thSt}>Descripción banco</th>
                          <th style={thSt}>Folio</th>
                          <th style={thSt}>Proveedor</th>
                          <th style={{ ...thSt, textAlign: 'right' }}>Aplica</th>
                          <th style={{ ...thSt, textAlign: 'center' }}>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(s => {
                          const sel = selected.has(s.id)
                          return (
                            <tr key={s.id} onClick={() => toggleSel(s.id)}
                              style={{ borderTop: '1px solid #F1F5F9', cursor: 'pointer', background: sel ? '#FEF3C7' : '#fff' }}>
                              <td style={{ ...tdSt, textAlign: 'center' }}>
                                <input type="checkbox" checked={sel} onChange={e => { e.stopPropagation(); toggleSel(s.id) }} style={{ width: 13, height: 13, cursor: 'pointer' }} />
                              </td>
                              <td style={tdSt}>{fmtFecha(s.fecha_cargo)}</td>
                              <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(s.monto_cargo)}</td>
                              <td style={{ ...tdSt, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.descripcion_cargo}>{s.descripcion_cargo}</td>
                              <td style={tdSt}>{s.folio_factura}</td>
                              <td style={{ ...tdSt, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.razon_social}>{s.razon_social}</td>
                              <td style={{ ...tdSt, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtCLP(s.monto_aplicar)}</td>
                              <td style={{ ...tdSt, textAlign: 'center' }}>
                                <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: info.bg, color: info.color }}>{s.score}</span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const thSt = { padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B', background: '#F8FAFC', whiteSpace: 'nowrap' }
const tdSt = { padding: '6px 10px', fontSize: 11, color: '#334155', whiteSpace: 'nowrap', verticalAlign: 'middle' }
