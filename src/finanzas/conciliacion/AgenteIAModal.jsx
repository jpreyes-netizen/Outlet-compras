import { useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { X, Sparkles, ChevronDown, ChevronRight, Check, RefreshCw, Loader2, Search, ArrowRight, Link2, AlertCircle } from 'lucide-react'
import { supabase } from '../../supabase'

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n ?? 0)
const fmtCLPshort = n => {
  const v = Math.abs(n ?? 0)
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'k'
  return fmtCLP(n)
}
const fmtFecha = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y.slice(2)}` }

const REGLA_INFO = {
  R1: { color: '#15803D', bg: '#DCFCE7', label: 'Match exacto' },
  R2: { color: '#0284C7', bg: '#E0F2FE', label: 'Cierre parcial' },
  R3: { color: '#7C3AED', bg: '#EDE9FE', label: 'Único candidato' },
  R4: { color: '#D97706', bg: '#FEF3C7', label: 'FIFO N→1' },
  R5: { color: '#DB2777', bg: '#FCE7F3', label: 'FIFO 1→N' },
}

export function AgenteIAModal({ onClose, onAfterApprove }) {
  const [tab, setTab] = useState('sugerencias') // sugerencias | sin_match | aprobadas
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [approving, setApproving] = useState(false)
  const [sugerencias, setSugerencias] = useState([])
  const [aprobadas, setAprobadas] = useState([])
  const [sinMatch, setSinMatch] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [expanded, setExpanded] = useState(new Set())
  const [filtroTexto, setFiltroTexto] = useState('')
  const [vincularModalOpen, setVincularModalOpen] = useState(false)
  const [vincularCargo, setVincularCargo] = useState(null)

  async function cargarSugerencias() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('ai_match_sugerencias')
        .select('*')
        .eq('estado', 'pendiente')
        .order('razon_social')
        .order('fecha_cargo')
        .limit(5000)
      if (error) throw error
      setSugerencias(data ?? [])
      setSelected(new Set())
    } catch (e) {
      toast.error('Error: ' + e.message)
    } finally { setLoading(false) }
  }

  async function cargarAprobadas() {
    try {
      const { data } = await supabase
        .from('ai_match_sugerencias')
        .select('*')
        .eq('estado', 'aprobada')
        .order('decidido_at', { ascending: false })
        .limit(200)
      setAprobadas(data ?? [])
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  async function cargarSinMatch() {
    setLoading(true)
    try {
      // Cargos pendientes (factura_compra) que NO tienen sugerencia ni conciliación
      const { data: movs, error } = await supabase
        .from('movimientos_bancarios')
        .select('id, fecha, monto, descripcion')
        .eq('tipo', 'CARGO')
        .eq('tipo_respaldo', 'factura_compra')
        .order('fecha', { ascending: false })
        .limit(2000)
      if (error) throw error

      // Quitar los ya conciliados o con sugerencia pendiente
      const movIds = (movs ?? []).map(m => m.id)
      const [{ data: conc }, { data: sug }] = await Promise.all([
        supabase.from('conciliaciones').select('movimiento_id').in('movimiento_id', movIds),
        supabase.from('ai_match_sugerencias').select('movimiento_id').eq('estado', 'pendiente').in('movimiento_id', movIds),
      ])
      const excluir = new Set([
        ...(conc ?? []).map(c => c.movimiento_id),
        ...(sug ?? []).map(s => s.movimiento_id),
      ])
      setSinMatch((movs ?? []).filter(m => !excluir.has(m.id)))
    } catch (e) {
      toast.error('Error: ' + e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (tab === 'sugerencias') cargarSugerencias()
    else if (tab === 'aprobadas') cargarAprobadas()
    else if (tab === 'sin_match') cargarSinMatch()
  }, [tab])

  async function regenerar() {
    setGenerating(true)
    const tid = toast.loading('Regenerando sugerencias…')
    try {
      const { data, error } = await supabase.rpc('fn_agente_generar_sugerencias')
      if (error) throw error
      toast.success(`${data.total} sugerencias generadas (R1:${data.r1} R3:${data.r3} R4:${data.r4} R5:${data.r5})`, { id: tid })
      cargarSugerencias()
    } catch (e) {
      toast.error('Error: ' + e.message, { id: tid })
    } finally { setGenerating(false) }
  }

  async function aprobarSeleccionadas() {
    if (selected.size === 0) return
    setApproving(true)
    const tid = toast.loading(`Aprobando ${selected.size}…`)
    let ok = 0, err = 0
    try {
      const { data: { user } } = await supabase.auth.getUser()
      for (const sugId of selected) {
        try {
          await supabase.rpc('fn_agente_aprobar_sugerencia', { p_sugerencia_id: sugId, p_user_id: user?.id ?? null })
          ok++
        } catch { err++ }
      }
      toast.success(`Aprobadas ${ok}${err > 0 ? ` · ${err} con error` : ''}`, { id: tid })
      await cargarSugerencias()
      onAfterApprove?.()
    } catch (e) {
      toast.error('Error: ' + e.message, { id: tid })
    } finally { setApproving(false) }
  }

  async function rechazarSeleccionadas() {
    if (selected.size === 0) return
    if (!confirm(`¿Rechazar ${selected.size} sugerencias?`)) return
    setApproving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      for (const sugId of selected) {
        await supabase.rpc('fn_agente_rechazar_sugerencia', { p_sugerencia_id: sugId, p_user_id: user?.id ?? null })
      }
      toast.success(`${selected.size} rechazadas`)
      cargarSugerencias()
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setApproving(false) }
  }

  // Agrupar sugerencias por proveedor (razón social)
  const porProveedor = useMemo(() => {
    const m = {}
    for (const s of sugerencias) {
      const key = s.razon_social || '(sin proveedor)'
      if (!m[key]) m[key] = []
      m[key].push(s)
    }
    // Filtrar por texto
    if (filtroTexto.trim()) {
      const q = filtroTexto.toLowerCase()
      const f = {}
      for (const [k, items] of Object.entries(m)) {
        if (k.toLowerCase().includes(q) || items.some(i => 
          (i.descripcion_cargo || '').toLowerCase().includes(q) ||
          (i.folio_factura || '').toLowerCase().includes(q)
        )) f[k] = items
      }
      return f
    }
    return m
  }, [sugerencias, filtroTexto])

  const proveedoresOrdenados = useMemo(() => 
    Object.entries(porProveedor).sort((a, b) => {
      const sumA = a[1].reduce((s, i) => s + Number(i.monto_aplicar || 0), 0)
      const sumB = b[1].reduce((s, i) => s + Number(i.monto_aplicar || 0), 0)
      return sumB - sumA
    }), [porProveedor])

  const totales = useMemo(() => {
    const monto = sugerencias.reduce((a, s) => a + Number(s.monto_aplicar || 0), 0)
    const selMonto = sugerencias.filter(s => selected.has(s.id)).reduce((a, s) => a + Number(s.monto_aplicar || 0), 0)
    return { total: sugerencias.length, monto, selMonto }
  }, [sugerencias, selected])

  function toggleSel(id) {
    setSelected(prev => { const ns = new Set(prev); ns.has(id) ? ns.delete(id) : ns.add(id); return ns })
  }
  function toggleSelProveedor(items, target) {
    setSelected(prev => {
      const ns = new Set(prev)
      if (target === 'all') items.forEach(i => ns.add(i.id))
      else if (target === 'none') items.forEach(i => ns.delete(i.id))
      else {
        const allSel = items.every(i => ns.has(i.id))
        items.forEach(i => allSel ? ns.delete(i.id) : ns.add(i.id))
      }
      return ns
    })
  }
  function toggleExp(prov) {
    setExpanded(prev => { const ns = new Set(prev); ns.has(prov) ? ns.delete(prov) : ns.add(prov); return ns })
  }

  // ─── Vínculo manual ────────────────────────────────────────────
  function abrirVincularManual(cargo) {
    setVincularCargo(cargo)
    setVincularModalOpen(true)
  }

  async function ejecutarVinculoManual({ facturaId, monto, observaciones }) {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('conciliaciones').insert({
        movimiento_id: vincularCargo.id,
        tipo_respaldo: 'factura_compra',
        factura_compra_id: facturaId,
        monto_aplicado: monto,
        observaciones: '[Vínculo manual] ' + (observaciones || ''),
        created_by: user?.id ?? null,
      })
      if (error) throw error
      toast.success('Vínculo creado')
      setVincularModalOpen(false)
      setVincularCargo(null)
      cargarSinMatch()
      onAfterApprove?.()
    } catch (e) {
      toast.error('Error: ' + e.message)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, width: '95vw', maxWidth: 1400,
        height: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Sparkles size={20} color="#7C3AED" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1E293B' }}>Agente IA — Conciliación</div>
            <div style={{ fontSize: 11, color: '#64748B' }}>Sugerencias automáticas agrupadas por proveedor + vínculo manual para casos sin match</div>
          </div>
          <button onClick={regenerar} disabled={generating}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer', opacity: generating ? 0.5 : 1 }}>
            {generating ? <Loader2 size={12} /> : <RefreshCw size={12} />} Regenerar
          </button>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 99, background: '#F1F5F9', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '0 20px', borderBottom: '1px solid #E2E8F0' }}>
          {[
            { k: 'sugerencias', l: `📋 Sugerencias (${tab === 'sugerencias' ? sugerencias.length : '...'})` },
            { k: 'sin_match', l: `🔍 Sin match (${tab === 'sin_match' ? sinMatch.length : '...'})` },
            { k: 'aprobadas', l: `✓ Aprobadas` },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              padding: '10px 14px', fontSize: 12, fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t.k ? '#7C3AED' : '#64748B',
              borderBottom: tab === t.k ? '2px solid #7C3AED' : '2px solid transparent',
            }}>{t.l}</button>
          ))}
        </div>

        {/* Resumen + filtros */}
        {tab === 'sugerencias' && (
          <div style={{ padding: '10px 20px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 9, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Total</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1E293B' }}>{totales.total} · {fmtCLPshort(totales.monto)}</div>
            </div>
            <div style={{ width: 1, height: 32, background: '#E2E8F0' }} />
            <div>
              <div style={{ fontSize: 9, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Seleccionado</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#7C3AED' }}>{selected.size} · {fmtCLPshort(totales.selMonto)}</div>
            </div>
            <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
              <input value={filtroTexto} onChange={e => setFiltroTexto(e.target.value)}
                placeholder="Buscar proveedor, descripción, folio…"
                style={{ width: '100%', padding: '7px 10px 7px 26px', fontSize: 12, borderRadius: 7, border: '1px solid #E2E8F0', boxSizing: 'border-box' }} />
            </div>
            <button onClick={rechazarSeleccionadas} disabled={selected.size === 0 || approving}
              style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #FCA5A5', background: '#fff', fontSize: 12, fontWeight: 600, color: '#B91C1C', cursor: 'pointer', opacity: selected.size === 0 || approving ? 0.4 : 1 }}>
              Rechazar
            </button>
            <button onClick={aprobarSeleccionadas} disabled={selected.size === 0 || approving}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(to bottom, #16A34A, #15803D)', fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer', opacity: selected.size === 0 || approving ? 0.5 : 1 }}>
              {approving ? <Loader2 size={12} /> : <Check size={12} />}
              Aprobar ({selected.size})
            </button>
          </div>
        )}

        {/* Contenido */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 14, background: '#FAFBFC' }}>
          {loading && <div style={{ padding: '60px 0', textAlign: 'center', color: '#94A3B8' }}><Loader2 size={20} /></div>}

          {/* TAB: SUGERENCIAS */}
          {!loading && tab === 'sugerencias' && totales.total === 0 && (
            <div style={{ padding: '60px 0', textAlign: 'center', color: '#94A3B8' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No hay sugerencias pendientes</div>
              <div style={{ fontSize: 12 }}>Presiona "Regenerar" para que el agente analice los cargos sin conciliar</div>
            </div>
          )}
          {!loading && tab === 'sugerencias' && proveedoresOrdenados.map(([prov, items]) => (
            <ProveedorCard key={prov}
              proveedor={prov}
              items={items}
              expanded={expanded.has(prov)}
              selected={selected}
              onToggleExp={() => toggleExp(prov)}
              onToggleSel={toggleSel}
              onToggleSelProv={(target) => toggleSelProveedor(items, target)}
            />
          ))}

          {/* TAB: SIN MATCH */}
          {!loading && tab === 'sin_match' && (
            <SinMatchView movs={sinMatch} onVincular={abrirVincularManual} />
          )}

          {/* TAB: APROBADAS */}
          {!loading && tab === 'aprobadas' && (
            <AprobadasView items={aprobadas} />
          )}
        </div>
      </div>

      {/* Modal de vínculo manual */}
      {vincularModalOpen && vincularCargo && (
        <VincularManualModal
          cargo={vincularCargo}
          onClose={() => { setVincularModalOpen(false); setVincularCargo(null) }}
          onConfirm={ejecutarVinculoManual}
        />
      )}
    </div>
  )
}

// ═══════ TARJETA DE PROVEEDOR ═══════════════════════════════════════════
function ProveedorCard({ proveedor, items, expanded, selected, onToggleExp, onToggleSel, onToggleSelProv }) {
  const totalMonto = items.reduce((a, i) => a + Number(i.monto_aplicar || 0), 0)
  const todosSel = items.every(i => selected.has(i.id))
  const algunoSel = items.some(i => selected.has(i.id))
  const reglas = [...new Set(items.map(i => i.regla))].sort()
  const rut = items[0]?.descripcion_cargo
    ? null  // RUT no está en la sugerencia, se puede agregar después
    : null

  return (
    <div style={{ marginBottom: 10, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
      {/* Header del proveedor */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#F8FAFC', cursor: 'pointer', borderBottom: expanded ? '1px solid #E2E8F0' : 'none' }} onClick={onToggleExp}>
        <input type="checkbox" checked={todosSel} ref={el => el && (el.indeterminate = !todosSel && algunoSel)}
          onClick={e => e.stopPropagation()} onChange={() => onToggleSelProv()}
          style={{ width: 14, height: 14, cursor: 'pointer' }} />
        {expanded ? <ChevronDown size={14} color="#475569" /> : <ChevronRight size={14} color="#475569" />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1E293B' }}>{proveedor}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 2, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#64748B' }}>{items.length} {items.length === 1 ? 'sugerencia' : 'sugerencias'}</span>
            {reglas.map(r => (
              <span key={r} style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 99, fontSize: 9, fontWeight: 700, background: REGLA_INFO[r]?.bg, color: REGLA_INFO[r]?.color }}>{r}</span>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#15803D' }}>{fmtCLP(totalMonto)}</div>
      </div>

      {/* Detalles: lado a lado cargos vs facturas */}
      {expanded && (
        <div style={{ padding: 12 }}>
          {/* Botones acción del grupo */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, fontSize: 11 }}>
            <button onClick={() => onToggleSelProv('all')} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #C7D2FE', background: '#EEF2FF', color: '#4338CA', fontWeight: 600, cursor: 'pointer' }}>Seleccionar todo el proveedor</button>
            <button onClick={() => onToggleSelProv('none')} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', fontWeight: 600, cursor: 'pointer' }}>Limpiar</button>
          </div>

          {/* Filas: cada sugerencia = 1 cargo ↔ 1 factura */}
          {items.map(s => {
            const sel = selected.has(s.id)
            const info = REGLA_INFO[s.regla] ?? { color: '#475569', bg: '#F1F5F9' }
            return (
              <div key={s.id} onClick={() => onToggleSel(s.id)}
                title={`${s.regla}: ${s.observacion ?? ''}\nFactura: ${s.razon_social} · folio ${s.folio_factura} · ${fmtFecha(s.fecha_factura)}\nSaldo factura: ${fmtCLP(s.saldo_factura)}\nMonto a aplicar: ${fmtCLP(s.monto_aplicar)}`}
                style={{
                  display: 'grid', gridTemplateColumns: '24px 1fr 30px 1fr 30px',
                  alignItems: 'center', gap: 8, padding: '8px 10px',
                  background: sel ? '#FEF3C7' : '#fff',
                  border: sel ? '1px solid #FCD34D' : '1px solid #F1F5F9',
                  borderRadius: 7, marginBottom: 4, cursor: 'pointer', fontSize: 11,
                }}>
                <input type="checkbox" checked={sel} onChange={e => { e.stopPropagation(); onToggleSel(s.id) }} style={{ width: 13, height: 13, cursor: 'pointer' }} />
                {/* CARGO */}
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>{fmtFecha(s.fecha_cargo)}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#B91C1C', fontFamily: 'monospace' }}>{fmtCLP(s.monto_cargo)}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.descripcion_cargo}
                  </div>
                </div>
                {/* Flecha */}
                <ArrowRight size={14} color={info.color} />
                {/* FACTURA */}
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>Folio {s.folio_factura}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#15803D', fontFamily: 'monospace' }}>{fmtCLP(s.monto_aplicar)}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#94A3B8' }}>
                    {fmtFecha(s.fecha_factura)} · saldo factura {fmtCLP(s.saldo_factura)}
                  </div>
                </div>
                {/* Regla */}
                <span style={{ justifySelf: 'end', display: 'inline-block', padding: '2px 7px', borderRadius: 99, fontSize: 9, fontWeight: 700, background: info.bg, color: info.color }}>{s.regla}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ═══════ VISTA "SIN MATCH" ═════════════════════════════════════════════
function SinMatchView({ movs, onVincular }) {
  const [filtro, setFiltro] = useState('')
  const filtered = useMemo(() => {
    if (!filtro.trim()) return movs
    const q = filtro.toLowerCase()
    return movs.filter(m => (m.descripcion || '').toLowerCase().includes(q))
  }, [movs, filtro])

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar descripción…"
            style={{ width: '100%', padding: '7px 10px 7px 26px', fontSize: 12, borderRadius: 7, border: '1px solid #E2E8F0', boxSizing: 'border-box' }} />
        </div>
        <span style={{ fontSize: 11, color: '#64748B' }}>{filtered.length} cargos sin match · ${fmtCLPshort(filtered.reduce((a, m) => a + Math.abs(Number(m.monto)||0), 0))}</span>
      </div>
      {filtered.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>Todos los cargos tienen match o están vinculados.</div>}
      {filtered.map(m => (
        <div key={m.id} style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
          background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8,
          marginBottom: 6, fontSize: 12,
        }}>
          <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, width: 70 }}>{fmtFecha(m.fecha)}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#B91C1C', fontFamily: 'monospace', width: 130 }}>{fmtCLP(m.monto)}</div>
          <div style={{ flex: 1, fontSize: 11, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.descripcion}</div>
          <button onClick={() => onVincular(m)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 7, border: '1px solid #C7D2FE', background: '#EEF2FF', color: '#4338CA', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            <Link2 size={11} /> Vincular factura
          </button>
        </div>
      ))}
    </div>
  )
}

// ═══════ VISTA "APROBADAS" ═════════════════════════════════════════════
function AprobadasView({ items }) {
  if (items.length === 0) return <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>Aún no hay sugerencias aprobadas.</div>
  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8 }}>Últimas 200 aprobaciones del agente</div>
      {items.map(s => {
        const info = REGLA_INFO[s.regla] ?? { color: '#475569', bg: '#F1F5F9' }
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 7, marginBottom: 4, fontSize: 11 }}>
            <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 99, fontSize: 9, fontWeight: 700, background: info.bg, color: info.color }}>{s.regla}</span>
            <span style={{ fontSize: 10, color: '#64748B' }}>{fmtFecha(s.fecha_cargo)}</span>
            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#15803D' }}>{fmtCLP(s.monto_aplicar)}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.razon_social} · folio {s.folio_factura}
            </span>
            <span style={{ fontSize: 10, color: '#94A3B8' }}>{new Date(s.decidido_at).toLocaleDateString('es-CL')}</span>
          </div>
        )
      })}
    </div>
  )
}

// ═══════ MODAL DE VÍNCULO MANUAL ═══════════════════════════════════════
function VincularManualModal({ cargo, onClose, onConfirm }) {
  const [searchProv, setSearchProv] = useState('')
  const [searchMonto, setSearchMonto] = useState('')
  const [facturas, setFacturas] = useState([])
  const [selFacturas, setSelFacturas] = useState(new Set())  // permite N facturas
  const [loading, setLoading] = useState(false)
  const [observaciones, setObservaciones] = useState('')

  const cargoMonto = Math.abs(Number(cargo.monto) || 0)

  async function buscar() {
    setLoading(true)
    try {
      let query = supabase.from('libro_compras')
        .select('id, fecha_emision, folio, rut_proveedor, razon_social, monto_total')
        .order('fecha_emision', { ascending: false })
        .limit(50)
      if (searchProv.trim()) {
        const t = searchProv.trim()
        query = query.or(`razon_social.ilike.%${t}%,rut_proveedor.ilike.%${t}%,folio.ilike.%${t}%`)
      }
      const { data, error } = await query
      if (error) throw error
      // Enriquecer con saldo desde v_estado_factura
      const ids = (data ?? []).map(f => f.id)
      const { data: estados } = await supabase.from('v_estado_factura').select('factura_id, saldo, estado_factura').in('factura_id', ids)
      const eMap = new Map((estados ?? []).map(e => [e.factura_id, e]))
      let result = (data ?? []).map(f => ({
        ...f,
        saldo: eMap.get(f.id)?.saldo ?? f.monto_total,
        estado_factura: eMap.get(f.id)?.estado_factura ?? 'sin_pagar',
      })).filter(f => f.estado_factura !== 'pagada')
      // Filtrar por monto si se indicó
      if (searchMonto) {
        const target = Number(searchMonto.replace(/[^\d]/g, ''))
        if (target > 0) {
          result = result.filter(f => Math.abs(Number(f.saldo) - target) <= 100)
        }
      }
      setFacturas(result)
    } catch (e) {
      toast.error('Error buscando: ' + e.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { buscar() }, [])

  const sumaSeleccionada = useMemo(() =>
    facturas.filter(f => selFacturas.has(f.id)).reduce((a, f) => a + Number(f.saldo || 0), 0)
  , [facturas, selFacturas])

  const diferencia = cargoMonto - sumaSeleccionada

  function toggleFac(id) {
    setSelFacturas(prev => { const ns = new Set(prev); ns.has(id) ? ns.delete(id) : ns.add(id); return ns })
  }

  async function confirmar() {
    if (selFacturas.size === 0) { toast.error('Selecciona al menos una factura'); return }
    // Aplicar el cargo a las facturas seleccionadas (FIFO de saldo)
    let restante = cargoMonto
    for (const fid of selFacturas) {
      const fac = facturas.find(f => f.id === fid)
      if (!fac) continue
      const aplicar = Math.min(restante, Number(fac.saldo))
      if (aplicar <= 0) break
      await onConfirm({ facturaId: fid, monto: aplicar, observaciones })
      restante -= aplicar
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '90vw', maxWidth: 1100, height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link2 size={18} color="#4338CA" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1E293B' }}>Vincular cargo manualmente</div>
            <div style={{ fontSize: 11, color: '#64748B' }}>Selecciona una o varias facturas para aplicar este cargo</div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 99, background: '#F1F5F9', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>
        </div>

        {/* Info del cargo */}
        <div style={{ padding: '12px 20px', background: '#FEF2F2', borderBottom: '1px solid #FECACA' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#991B1B', textTransform: 'uppercase' }}>Cargo a vincular</div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#7F1D1D', fontWeight: 600 }}>{fmtFecha(cargo.fecha)}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#B91C1C', fontFamily: 'monospace' }}>{fmtCLP(cargo.monto)}</span>
            <span style={{ fontSize: 11, color: '#7F1D1D' }}>{cargo.descripcion}</span>
          </div>
        </div>

        {/* Buscador */}
        <div style={{ padding: '12px 20px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid #E2E8F0' }}>
          <input value={searchProv} onChange={e => setSearchProv(e.target.value)}
            placeholder="Proveedor / RUT / Folio"
            style={{ flex: 1, padding: '7px 10px', fontSize: 12, borderRadius: 7, border: '1px solid #E2E8F0' }} />
          <input value={searchMonto} onChange={e => setSearchMonto(e.target.value)}
            placeholder="Monto exacto (opcional)"
            style={{ width: 160, padding: '7px 10px', fontSize: 12, borderRadius: 7, border: '1px solid #E2E8F0' }} />
          <button onClick={buscar} disabled={loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 7, border: 'none', background: '#4338CA', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {loading ? <Loader2 size={12} /> : <Search size={12} />} Buscar
          </button>
        </div>

        {/* Lista de facturas */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {loading && <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}><Loader2 /></div>}
          {!loading && facturas.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>Sin resultados</div>}
          {!loading && facturas.map(f => {
            const sel = selFacturas.has(f.id)
            return (
              <div key={f.id} onClick={() => toggleFac(f.id)} style={{
                display: 'grid', gridTemplateColumns: '24px 80px 1fr 140px 130px 90px',
                alignItems: 'center', gap: 8, padding: '8px 10px',
                background: sel ? '#EEF2FF' : '#fff',
                border: sel ? '1px solid #6366F1' : '1px solid #E2E8F0',
                borderRadius: 7, marginBottom: 4, cursor: 'pointer', fontSize: 11,
              }}>
                <input type="checkbox" checked={sel} onChange={e => { e.stopPropagation(); toggleFac(f.id) }} style={{ width: 13, height: 13 }} />
                <span style={{ color: '#64748B', fontWeight: 600 }}>{fmtFecha(f.fecha_emision)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.razon_social}>{f.razon_social}</span>
                <span style={{ color: '#64748B' }}>{f.rut_proveedor} · folio {f.folio}</span>
                <span style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#15803D' }}>{fmtCLP(f.saldo)}</span>
                <span style={{ textAlign: 'right', fontSize: 9, color: f.estado_factura === 'parcial' ? '#0284C7' : '#94A3B8', textTransform: 'uppercase', fontWeight: 600 }}>{f.estado_factura}</span>
              </div>
            )
          })}
        </div>

        {/* Footer con totales y confirmar */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: 14, alignItems: 'center', background: '#F8FAFC' }}>
          <div>
            <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Cargo</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#B91C1C', fontFamily: 'monospace' }}>{fmtCLP(cargoMonto)}</div>
          </div>
          <ArrowRight size={16} color="#94A3B8" />
          <div>
            <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Facturas seleccionadas ({selFacturas.size})</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#15803D', fontFamily: 'monospace' }}>{fmtCLP(sumaSeleccionada)}</div>
          </div>
          <div style={{ width: 1, height: 36, background: '#E2E8F0' }} />
          <div>
            <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Diferencia</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: Math.abs(diferencia) <= 100 ? '#15803D' : '#D97706', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 4 }}>
              {Math.abs(diferencia) > 100 && <AlertCircle size={12} />}
              {fmtCLP(diferencia)}
            </div>
          </div>
          <input value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Observación (opcional)"
            style={{ flex: 1, minWidth: 120, padding: '7px 10px', fontSize: 11, borderRadius: 7, border: '1px solid #E2E8F0' }} />
          <button onClick={confirmar} disabled={selFacturas.size === 0}
            style={{ padding: '8px 16px', borderRadius: 7, border: 'none', background: 'linear-gradient(to bottom, #4338CA, #3730A3)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: selFacturas.size === 0 ? 0.5 : 1 }}>
            Confirmar vínculo
          </button>
        </div>
      </div>
    </div>
  )
}
