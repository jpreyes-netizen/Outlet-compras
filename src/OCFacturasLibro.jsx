import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

// ════════════════════════════════════════════════════════════════════════
// OCFacturasLibro — bloque para el detalle de OC (OCDetView)
// Conecta la OC con: (1) facturas del libro de compras y (2) el pago en banco.
// - Lista facturas vinculadas a esta OC + su estado de conciliación
// - Permite vincular facturas candidatas del proveedor (fn_vincular_factura_oc)
// - Permite conciliar una factura con un cargo del banco (tabla conciliaciones,
//   protegida por el trigger trg_validar_conciliacion — mismo riel que Finanzas)
// Estilo App.jsx: helpers propios, mensajes inline, sin librerías externas.
// ════════════════════════════════════════════════════════════════════════

const fmt = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const fFecha = s => { if (!s) return ''; const p = String(s).slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0].slice(2)}` : s }
const normRut = r => String(r || '').replace(/\./g, '').replace(/-/g, '').replace(/^0+/, '').toUpperCase()

export function OCFacturasLibro({ oc, prov, cu }) {
  const [loading, setLoading] = useState(true)
  const [vinculadas, setVinculadas] = useState([])   // facturas con oc_id = esta OC
  const [estadoConc, setEstadoConc] = useState({})    // factura_id -> {aplicado, saldo}
  const [msg, setMsg] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [showBuscar, setShowBuscar] = useState(false)
  const [concFactura, setConcFactura] = useState(null)  // factura a conciliar con banco

  const recargar = useCallback(() => setReloadKey(k => k + 1), [])
  const rutOC = normRut(prov?.rut)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      setLoading(true)
      try {
        // Facturas del libro vinculadas a esta OC
        const { data: facs } = await supabase
          .from('libro_compras')
          .select('id, folio, fecha_emision, razon_social, monto_total, oc_match')
          .eq('oc_id', oc.id)
          .eq('anulado', false)
          .limit(500)
        const lista = facs ?? []

        // Estado de conciliación de cada factura (desde v_estado_factura)
        const ids = lista.map(f => f.id)
        const estado = {}
        if (ids.length) {
          const { data: ev } = await supabase
            .from('v_estado_factura')
            .select('factura_id, total_pagado, saldo, estado_factura')
            .in('factura_id', ids)
          ;(ev ?? []).forEach(e => { estado[e.factura_id] = e })
        }
        if (!cancel) { setVinculadas(lista); setEstadoConc(estado) }
      } catch (e) {
        if (!cancel) setMsg('Error: ' + e.message)
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [oc.id, reloadKey])

  const totalFacturado = vinculadas.reduce((a, f) => a + (Number(f.monto_total) || 0), 0)
  const totalOC = Number(oc.total_clp) || 0
  const saldoSinFacturar = totalOC - totalFacturado
  const totalConciliado = vinculadas.reduce((a, f) => a + (Number(estadoConc[f.id]?.total_pagado) || 0), 0)

  async function desvincular(facturaId) {
    if (!window.confirm('¿Quitar el vínculo de esta factura con la OC?')) return
    setMsg('')
    try {
      const { error } = await supabase.rpc('fn_desvincular_factura_oc', { p_factura_id: facturaId })
      if (error) throw error
      recargar()
    } catch (e) { setMsg('Error: ' + e.message) }
  }

  return (
    <div style={{ marginTop: 16, borderTop: '2px solid #E5E5EA', paddingTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>🧾 Facturas del libro de compras</div>
        <button onClick={() => setShowBuscar(true)} style={{
          padding: '7px 14px', borderRadius: 10, border: 'none', background: '#5856D6', color: '#fff',
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>+ Vincular factura</button>
      </div>

      {/* Resumen de facturación */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
        <Resumen label="Facturado" valor={fmt(totalFacturado)} color="#007AFF" />
        <Resumen label="Sin facturar" valor={fmt(saldoSinFacturar)} color={saldoSinFacturar > 1 ? '#FF9500' : '#34C759'} />
        <Resumen label="Conciliado con banco" valor={fmt(totalConciliado)} color="#34C759" />
      </div>

      {msg && <div style={{ fontSize: 12, color: msg.startsWith('Error') ? '#FF3B30' : '#34C759', marginBottom: 8 }}>{msg}</div>}

      {loading && <div style={{ fontSize: 12, color: '#8E8E93', padding: 12 }}>Cargando…</div>}
      {!loading && vinculadas.length === 0 && (
        <div style={{ fontSize: 12, color: '#8E8E93', padding: 14, background: '#F9FAFB', borderRadius: 10, textAlign: 'center' }}>
          Sin facturas vinculadas. Usá "+ Vincular factura" para asociar las facturas de este proveedor.
        </div>
      )}

      {!loading && vinculadas.map(f => {
        const est = estadoConc[f.id] || {}
        const saldo = Number(est.saldo ?? f.monto_total) || 0
        const conciliada = est.estado_factura === 'pagada'
        const parcial = est.estado_factura === 'parcial'
        return (
          <div key={f.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', marginBottom: 6, borderRadius: 10,
            background: conciliada ? '#34C75908' : '#fff',
            border: `1px solid ${conciliada ? '#34C75930' : '#E5E5EA'}`,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Folio {f.folio} · {fmt(f.monto_total)}</div>
              <div style={{ fontSize: 11, color: '#8E8E93' }}>{fFecha(f.fecha_emision)} · {f.razon_social}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                background: conciliada ? '#34C75915' : parcial ? '#FF950015' : '#FF950015',
                color: conciliada ? '#34C759' : '#FF9500',
              }}>
                {conciliada ? 'Conciliada' : parcial ? `Parcial · falta ${fmt(saldo)}` : 'Sin conciliar'}
              </span>
              {!conciliada && (
                <button onClick={() => setConcFactura(f)} style={{
                  padding: '5px 10px', borderRadius: 8, border: 'none', background: '#007AFF', color: '#fff',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}>🔗 Conciliar</button>
              )}
              <button onClick={() => desvincular(f.id)} title="Quitar vínculo" style={{
                padding: '5px 8px', borderRadius: 8, border: 'none', background: '#FFE5E5', color: '#FF3B30',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}>✕</button>
            </div>
          </div>
        )
      })}

      {showBuscar && (
        <BuscarFacturasModal oc={oc} rutOC={rutOC} onClose={() => setShowBuscar(false)}
          onVinculado={() => { setShowBuscar(false); recargar() }} yaVinculadas={vinculadas.map(f => f.id)} />
      )}
      {concFactura && (
        <ConciliarFacturaBancoModal factura={concFactura} saldoFactura={Number(estadoConc[concFactura.id]?.saldo ?? concFactura.monto_total) || 0}
          rutOC={rutOC} cu={cu} onClose={() => setConcFactura(null)}
          onConciliado={() => { setConcFactura(null); recargar() }} />
      )}
    </div>
  )
}

function Resumen({ label, valor, color }) {
  return (
    <div style={{ background: '#F9FAFB', borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color, marginTop: 2 }}>{valor}</div>
    </div>
  )
}

// ─── Modal: buscar y vincular facturas candidatas del proveedor ──────────
function BuscarFacturasModal({ oc, rutOC, onClose, onVinculado, yaVinculadas }) {
  const [cands, setCands] = useState([])
  const [loading, setLoading] = useState(true)
  const [texto, setTexto] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const cargar = useCallback(async (q) => {
    setLoading(true); setMsg('')
    try {
      let query = supabase.from('libro_compras')
        .select('id, folio, fecha_emision, razon_social, rut_proveedor, monto_total, oc_id')
        .eq('anulado', false)
        .gte('fecha_emision', '2026-01-01')
        .order('fecha_emision', { ascending: false })
        .limit(300)
      if (q && q.trim()) {
        query = query.or(`razon_social.ilike.%${q.trim()}%,folio.ilike.%${q.trim()}%`)
      } else if (rutOC && rutOC.length >= 6) {
        // Buscar por RUT del proveedor de la OC (formato normalizado contra columna)
        query = query.ilike('rut_proveedor', `%${rutOC.slice(0, -1)}%`)
      }
      const { data, error } = await query
      if (error) throw error
      const totalOC = Number(oc.total_clp) || 0
      const lista = (data ?? []).map(f => {
        const m = Number(f.monto_total) || 0
        const dif = Math.abs(m - totalOC)
        let cal = 'posible'
        if (dif === 0) cal = 'exacto'
        else if (dif <= totalOC * 0.02) cal = 'cercano'
        return { ...f, calidad: cal }
      })
      setCands(lista)
    } catch (e) { setMsg('Error: ' + e.message) }
    finally { setLoading(false) }
  }, [oc.total_clp, rutOC])

  useEffect(() => { cargar('') }, [cargar])

  async function vincular(facturaId) {
    setSaving(true); setMsg('')
    try {
      const { error } = await supabase.rpc('fn_vincular_factura_oc', { p_factura_id: facturaId, p_oc_id: oc.id })
      if (error) throw error
      onVinculado()
    } catch (e) { setMsg('Error: ' + e.message); setSaving(false) }
  }

  const calColor = { exacto: { bg: '#34C75915', c: '#34C759' }, cercano: { bg: '#FF950015', c: '#FF9500' }, posible: { bg: '#F2F2F7', c: '#8E8E93' } }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 560, maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Vincular factura a {oc.id}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 14, background: '#F2F2F7', border: 'none', cursor: 'pointer', color: '#8E8E93' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: '#8E8E93', marginBottom: 10 }}>
          OC por {fmt(oc.total_clp)}. Seleccioná la(s) factura(s) que correspondan. Un proveedor puede facturar en parcialidades.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargar(texto)}
            placeholder="Buscar por proveedor o folio…"
            style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: '1px solid #E5E5EA', fontSize: 13 }} />
          <button onClick={() => cargar(texto)} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: '#F2F2F7', color: '#3A3A3C', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Buscar</button>
        </div>

        {msg && <div style={{ fontSize: 12, color: '#FF3B30', marginBottom: 8 }}>{msg}</div>}
        {loading && <div style={{ fontSize: 12, color: '#8E8E93', padding: 14, textAlign: 'center' }}>Cargando…</div>}
        {!loading && cands.length === 0 && <div style={{ fontSize: 12, color: '#8E8E93', padding: 14, textAlign: 'center' }}>Sin facturas candidatas. Buscá por proveedor o folio.</div>}

        {!loading && cands.map(f => {
          const ya = yaVinculadas.includes(f.id)
          const otra = f.oc_id && f.oc_id !== oc.id
          const cc = calColor[f.calidad]
          return (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', marginBottom: 6, borderRadius: 10, border: '1px solid #E5E5EA', background: ya ? '#F9FAFB' : '#fff' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Folio {f.folio} · {fmt(f.monto_total)}
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, marginLeft: 6, background: cc.bg, color: cc.c }}>{f.calidad}</span>
                </div>
                <div style={{ fontSize: 11, color: '#8E8E93' }}>
                  {fFecha(f.fecha_emision)} · {f.razon_social}
                  {otra && <span style={{ color: '#FF9500' }}> · ⚠ ya en {f.oc_id}</span>}
                </div>
              </div>
              {ya
                ? <span style={{ fontSize: 11, color: '#34C759', fontWeight: 600 }}>✓ vinculada</span>
                : <button onClick={() => vincular(f.id)} disabled={saving} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#5856D6', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>Vincular</button>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Modal: conciliar una factura con un cargo del banco ─────────────────
// Inserta en la tabla conciliaciones (mismo riel que Finanzas). El trigger
// trg_validar_conciliacion bloquea sobre-conciliación a nivel BD.
function ConciliarFacturaBancoModal({ factura, saldoFactura, rutOC, cu, onClose, onConciliado }) {
  const [cands, setCands] = useState([])
  const [loading, setLoading] = useState(true)
  const [texto, setTexto] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const cargar = useCallback(async (q) => {
    setLoading(true); setMsg('')
    try {
      let query = supabase.from('movimientos_bancarios')
        .select('id, fecha, monto, descripcion, conciliaciones(monto_aplicado)')
        .eq('tipo', 'CARGO')
        .eq('estado', 'clasificado')
        .order('fecha', { ascending: false })
        .limit(300)
      if (q && q.trim()) query = query.ilike('descripcion', `%${q.trim()}%`)
      else if (rutOC && rutOC.length >= 6) query = query.ilike('descripcion', `%${rutOC.slice(0, -1)}%`)
      else { setCands([]); setLoading(false); return }
      const { data, error } = await query
      if (error) throw error
      const lista = (data ?? []).map(m => {
        const aplicado = (m.conciliaciones ?? []).reduce((a, c) => a + (Number(c.monto_aplicado) || 0), 0)
        const montoAbs = Math.abs(Number(m.monto) || 0)
        return { id: m.id, fecha: m.fecha, descripcion: m.descripcion || '', montoAbs, saldoDisp: montoAbs - aplicado }
      }).filter(m => m.saldoDisp > 0.5)
        .sort((a, b) => Math.abs(a.saldoDisp - saldoFactura) - Math.abs(b.saldoDisp - saldoFactura))
      setCands(lista)
    } catch (e) { setMsg('Error: ' + e.message) }
    finally { setLoading(false) }
  }, [rutOC, saldoFactura])

  useEffect(() => { cargar('') }, [cargar])

  async function conciliar(mov) {
    const aplica = Math.min(saldoFactura, mov.saldoDisp)  // tope duro anti-sobreconciliación
    if (aplica <= 0) return
    setSaving(true); setMsg('')
    try {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess?.session?.user?.id ?? null
      const { error } = await supabase.from('conciliaciones').insert({
        movimiento_id: mov.id,
        tipo_respaldo: 'factura_compra',
        factura_compra_id: factura.id,
        monto_aplicado: Math.round(aplica),
        observaciones: `Conciliado desde OC · folio ${factura.folio}`,
        created_by: userId,
      })
      if (error) throw error  // el trigger trg_validar_conciliacion puede rechazar si sobrepasa
      // Actualizar estado del movimiento (igual que el módulo Finanzas)
      try {
        const { data: mv } = await supabase.from('movimientos_bancarios')
          .select('id, monto, conciliaciones(monto_aplicado)').eq('id', mov.id).maybeSingle()
        if (mv) {
          const apl = (mv.conciliaciones ?? []).reduce((a, c) => a + (Number(c.monto_aplicado) || 0), 0)
          const mt = Number(mv.monto) || 0
          const nuevo = mt > 0 && apl >= mt - 0.5 ? 'conciliado' : 'clasificado'
          await supabase.from('movimientos_bancarios').update({ estado: nuevo }).eq('id', mov.id)
        }
      } catch { /* no bloquea */ }
      onConciliado()
    } catch (e) { setMsg('Error: ' + e.message); setSaving(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 560, maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Conciliar folio {factura.folio}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 14, background: '#F2F2F7', border: 'none', cursor: 'pointer', color: '#8E8E93' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: '#8E8E93', marginBottom: 12 }}>
          Saldo por conciliar: <strong style={{ color: '#FF9500' }}>{fmt(saldoFactura)}</strong>. Elegí el cargo del banco que la pagó. El monto se topa al saldo.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargar(texto)}
            placeholder="Buscar en descripción del banco…"
            style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: '1px solid #E5E5EA', fontSize: 13 }} />
          <button onClick={() => cargar(texto)} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: '#F2F2F7', color: '#3A3A3C', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Buscar</button>
        </div>

        {msg && <div style={{ fontSize: 12, color: '#FF3B30', marginBottom: 8 }}>{msg}</div>}
        {loading && <div style={{ fontSize: 12, color: '#8E8E93', padding: 14, textAlign: 'center' }}>Cargando…</div>}
        {!loading && cands.length === 0 && <div style={{ fontSize: 12, color: '#8E8E93', padding: 14, textAlign: 'center' }}>Sin cargos candidatos. Buscá por descripción.</div>}

        {!loading && cands.map(m => {
          const aplica = Math.min(saldoFactura, m.saldoDisp)
          return (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', marginBottom: 6, borderRadius: 10, border: '1px solid #E5E5EA' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{fmt(m.saldoDisp)} disponible</div>
                <div style={{ fontSize: 11, color: '#8E8E93', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fFecha(m.fecha)} · {m.descripcion}</div>
              </div>
              <button onClick={() => conciliar(m)} disabled={saving} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#34C759', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                Aplicar {fmt(aplica)}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
