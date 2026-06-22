import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'

// ════════════════════════════════════════════════════════════════════════
// CostosRealesTab — pestaña del CosteoImpView
// Vincula facturas del libro de compras a una OC de importación.
// Cada factura tiene un rol (producto/flete/seguro/aduana/almacenaje/transporte/otro).
// Backend: tabla costos_oc_factura + vista v_costos_oc.
// Estilo App.jsx: helpers propios, mensajes inline, sin librerías externas.
// ════════════════════════════════════════════════════════════════════════

const fmt = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const fFecha = s => { if (!s) return ''; const p = String(s).slice(0,10).split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0].slice(2)}`:s }
const normRut = r => String(r||'').replace(/\./g,'').replace(/-/g,'').replace(/^0+/,'').toUpperCase()

// Catálogo de roles (debe coincidir con el CHECK del backend)
const ROLES = [
  { k: 'producto',         l: 'Producto',     c: '#34C759', bg: '#34C75915' },
  { k: 'flete',            l: 'Flete',        c: '#FF9500', bg: '#FF950015' },
  { k: 'seguro',           l: 'Seguro',       c: '#5856D6', bg: '#5856D615' },
  { k: 'aduana',           l: 'Aduana',       c: '#AF52DE', bg: '#AF52DE15' },
  { k: 'almacenaje',       l: 'Almacenaje',   c: '#FF3B30', bg: '#FF3B3015' },
  { k: 'transporte_local', l: 'Transporte',   c: '#007AFF', bg: '#007AFF15' },
  { k: 'otro_costo_imp',   l: 'Otro',         c: '#8E8E93', bg: '#8E8E9315' },
]
const rolMeta = k => ROLES.find(r => r.k === k) ?? ROLES[ROLES.length-1]

export function CostosRealesTab({ ocId, cu }) {
  const [loading, setLoading] = useState(true)
  const [vinculadas, setVinculadas] = useState([])  // facturas vinculadas (con su rol)
  const [resumen, setResumen] = useState(null)       // fila de v_costos_oc
  const [msg, setMsg] = useState('')
  const [showBuscar, setShowBuscar] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const recargar = useCallback(() => setReloadKey(k => k+1), [])

  useEffect(() => {
    if (!ocId) { setLoading(false); return }
    let cancel = false
    ;(async () => {
      setLoading(true); setMsg('')
      try {
        // 1) Vínculos + datos de la factura + estado de conciliación con banco
        const { data: vinc, error: e1 } = await supabase
          .from('costos_oc_factura')
          .select('id, factura_id, rol, created_at')
          .eq('oc_id', ocId)
        if (e1) throw e1
        const lista = vinc ?? []

        // 2) Hidratar con libro_compras (folio, monto, etc.) y v_estado_factura (pago)
        const ids = lista.map(v => v.factura_id)
        let facMap = new Map(), estMap = new Map()
        if (ids.length) {
          const [{ data: facs }, { data: est }] = await Promise.all([
            supabase.from('libro_compras').select('id, folio, fecha_emision, razon_social, monto_total').in('id', ids),
            supabase.from('v_estado_factura').select('factura_id, total_pagado, saldo, estado_factura').in('factura_id', ids),
          ])
          ;(facs ?? []).forEach(f => facMap.set(f.id, f))
          ;(est ?? []).forEach(e => estMap.set(e.factura_id, e))
        }
        const enriched = lista.map(v => ({
          ...v,
          factura: facMap.get(v.factura_id) ?? null,
          estado: estMap.get(v.factura_id) ?? null,
        })).sort((a,b) => (b.factura?.fecha_emision || '').localeCompare(a.factura?.fecha_emision || ''))

        // 3) Resumen desde v_costos_oc (incluye comparación vs proyectado)
        const { data: res, error: e3 } = await supabase
          .from('v_costos_oc').select('*').eq('oc_id', ocId).maybeSingle()
        if (e3) throw e3

        if (!cancel) { setVinculadas(enriched); setResumen(res) }
      } catch (e) {
        if (!cancel) setMsg('Error: ' + e.message)
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [ocId, reloadKey])

  if (!ocId) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#8E8E93', fontSize: 13, background: '#fff', borderRadius: 12 }}>
      Seleccioná una OC de importación arriba para ver sus costos reales.
    </div>
  }
  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: '#8E8E93' }}>Cargando…</div>

  async function actualizarRol(id, nuevoRol) {
    setMsg('')
    try {
      const { error } = await supabase.from('costos_oc_factura').update({ rol: nuevoRol }).eq('id', id)
      if (error) throw error
      recargar()
    } catch (e) { setMsg('Error: ' + e.message) }
  }

  async function desvincular(id) {
    if (!window.confirm('¿Quitar esta factura de los costos de la OC?')) return
    setMsg('')
    try {
      const { error } = await supabase.from('costos_oc_factura').delete().eq('id', id)
      if (error) throw error
      recargar()
    } catch (e) { setMsg('Error: ' + e.message) }
  }

  const totalReal = resumen?.costo_real_total ?? 0
  const totalProy = resumen?.total_proyectado ?? 0
  const dif = totalReal - totalProy
  const pctDif = totalProy > 0 ? (dif / totalProy) * 100 : 0

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#1C1C1E' }}>💰 Costos reales de la importación</div>
        <button onClick={() => setShowBuscar(true)} style={{
          padding: '8px 14px', borderRadius: 8, border: 'none', background: '#5856D6', color: '#fff',
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>+ Vincular factura del libro</button>
      </div>

      {/* Resumen 3 columnas: proyectado / real / diferencia */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        <Tarjeta label="Costo proyectado" valor={fmt(totalProy)} sub="del simulador" color="#007AFF" />
        <Tarjeta label="Costo real facturado" valor={fmt(totalReal)} sub={`${vinculadas.length} factura(s) vinculada(s)`} color="#34C759" />
        <Tarjeta
          label="Diferencia"
          valor={(dif >= 0 ? '+' : '') + fmt(dif)}
          sub={totalProy > 0 ? `${pctDif >= 0 ? '+' : ''}${pctDif.toFixed(1)}% vs proyectado` : 'aún sin proyección'}
          color={Math.abs(dif) < totalProy * 0.05 ? '#34C759' : dif > 0 ? '#FF3B30' : '#FF9500'}
        />
      </div>

      {/* Desglose por rol (si hay datos) */}
      {resumen && vinculadas.length > 0 && (
        <div style={{ background: '#F9FAFB', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {ROLES.map(r => {
            const val = Number(resumen[`costo_${r.k === 'transporte_local' ? 'transporte' : r.k === 'otro_costo_imp' ? 'otro' : r.k}`] ?? 0)
            if (val <= 0) return null
            return (
              <div key={r.k} style={{ fontSize: 11 }}>
                <span style={{ padding: '2px 8px', borderRadius: 99, background: r.bg, color: r.c, fontWeight: 600, marginRight: 4 }}>{r.l}</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1C1C1E' }}>{fmt(val)}</span>
              </div>
            )
          })}
        </div>
      )}

      {msg && <div style={{ fontSize: 12, color: msg.startsWith('Error') ? '#FF3B30' : '#34C759', marginBottom: 8 }}>{msg}</div>}

      {/* Lista de facturas vinculadas */}
      {vinculadas.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#8E8E93', fontSize: 12, background: '#F9FAFB', borderRadius: 10 }}>
          Sin facturas de costo vinculadas todavía.<br/>
          Usá "+ Vincular factura del libro" para asociar facturas de Maersk, agencia de aduana, transporte, etc.
        </div>
      ) : (
        <div style={{ border: '1px solid #E5E5EA', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F9FAFB', fontSize: 10, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px' }}>Rol</th>
                <th style={{ textAlign: 'left', padding: '8px 10px' }}>Folio · Proveedor</th>
                <th style={{ textAlign: 'left', padding: '8px 10px' }}>Fecha</th>
                <th style={{ textAlign: 'right', padding: '8px 10px' }}>Monto</th>
                <th style={{ textAlign: 'center', padding: '8px 10px' }}>Pago</th>
                <th style={{ padding: '8px 10px' }}></th>
              </tr>
            </thead>
            <tbody>
              {vinculadas.map(v => {
                const meta = rolMeta(v.rol)
                const f = v.factura
                const e = v.estado
                const pagada = e?.estado_factura === 'pagada'
                const parcial = e?.estado_factura === 'parcial'
                return (
                  <tr key={v.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '7px 10px' }}>
                      <select value={v.rol} onChange={ev => actualizarRol(v.id, ev.target.value)} style={{
                        fontSize: 11, padding: '3px 6px', borderRadius: 6,
                        border: `1px solid ${meta.c}`, background: meta.bg, color: meta.c,
                        fontWeight: 700, cursor: 'pointer',
                      }}>
                        {ROLES.map(r => <option key={r.k} value={r.k}>{r.l}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '7px 10px' }}>
                      <div style={{ fontWeight: 600, color: '#1C1C1E' }}>{f?.folio ?? '—'}</div>
                      <div style={{ fontSize: 10, color: '#8E8E93', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f?.razon_social ?? ''}</div>
                    </td>
                    <td style={{ padding: '7px 10px', color: '#475569' }}>{fFecha(f?.fecha_emision)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(f?.monto_total)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 99, fontWeight: 600,
                        background: pagada ? '#34C75915' : parcial ? '#FF950015' : '#F2F2F7',
                        color: pagada ? '#34C759' : parcial ? '#FF9500' : '#8E8E93',
                      }}>{pagada ? '✓ pagada' : parcial ? '◐ parcial' : '— sin pagar'}</span>
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                      <button onClick={() => desvincular(v.id)} title="Quitar vínculo" style={{
                        padding: '4px 8px', borderRadius: 6, border: 'none', background: '#FFE5E5', color: '#FF3B30',
                        fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      }}>✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showBuscar && (
        <BuscarFacturaCostoModal
          ocId={ocId} cu={cu}
          yaVinculadas={vinculadas.map(v => v.factura_id)}
          onClose={() => setShowBuscar(false)}
          onVinculado={() => { setShowBuscar(false); recargar() }}
        />
      )}
    </div>
  )
}

function Tarjeta({ label, valor, sub, color }) {
  return (
    <div style={{ background: '#F9FAFB', borderRadius: 10, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 4 }}>{valor}</div>
      <div style={{ fontSize: 10, color: '#8E8E93', marginTop: 2 }}>{sub}</div>
    </div>
  )
}

// ─── Modal: buscar y vincular factura del libro como costo de la OC ─────
function BuscarFacturaCostoModal({ ocId, cu, yaVinculadas, onClose, onVinculado }) {
  const [cands, setCands] = useState([])
  const [loading, setLoading] = useState(true)
  const [texto, setTexto] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [rolesSugeridos, setRolesSugeridos] = useState(new Map())  // rut → rol_sugerido

  const cargar = useCallback(async (q) => {
    setLoading(true); setMsg('')
    try {
      // Traer roles sugeridos (mapa rut normalizado → rol)
      const { data: rs } = await supabase.from('costos_oc_rol_proveedor').select('rut_proveedor, rol_sugerido')
      const mapaRoles = new Map()
      ;(rs ?? []).forEach(r => mapaRoles.set(normRut(r.rut_proveedor), r.rol_sugerido))
      setRolesSugeridos(mapaRoles)

      // Buscar facturas del libro 2026 que no estén ya vinculadas a esta OC
      let query = supabase.from('libro_compras')
        .select('id, folio, fecha_emision, razon_social, rut_proveedor, monto_total')
        .eq('anulado', false)
        .gte('fecha_emision', '2026-01-01')
        .order('fecha_emision', { ascending: false })
        .limit(200)
      if (q && q.trim()) {
        query = query.or(`razon_social.ilike.%${q.trim()}%,folio.ilike.%${q.trim()}%,rut_proveedor.ilike.%${q.trim()}%`)
      }
      const { data, error } = await query
      if (error) throw error

      // Excluir las que ya tienen vínculo con esta OC
      const lista = (data ?? []).filter(f => !yaVinculadas.includes(f.id))
      setCands(lista)
    } catch (e) { setMsg('Error: ' + e.message) }
    finally { setLoading(false) }
  }, [yaVinculadas])

  useEffect(() => { cargar('') }, [cargar])

  async function vincular(factura, rol) {
    setSaving(true); setMsg('')
    try {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess?.session?.user?.id ?? cu?.id ?? null
      const { error } = await supabase.from('costos_oc_factura').insert({
        oc_id: ocId,
        factura_id: factura.id,
        rol,
        created_by: userId,
      })
      if (error) {
        // El UNIQUE(factura_id) puede rechazar si ya está vinculada a otra OC
        if (error.code === '23505') throw new Error('Esta factura ya está vinculada a otra OC de importación')
        throw error
      }
      onVinculado()
    } catch (e) { setMsg('Error: ' + e.message); setSaving(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 720, maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Vincular factura como costo de {ocId}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 14, background: '#F2F2F7', border: 'none', cursor: 'pointer', color: '#8E8E93' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: '#8E8E93', marginBottom: 10 }}>
          Buscá la factura del libro (Maersk, agencia, seguro, transporte…). El rol se sugiere automáticamente, podés cambiarlo al vincular.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargar(texto)}
            placeholder="Buscar por proveedor, folio o RUT…"
            style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: '1px solid #E5E5EA', fontSize: 13 }} />
          <button onClick={() => cargar(texto)} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: '#F2F2F7', color: '#3A3A3C', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Buscar</button>
        </div>

        {msg && <div style={{ fontSize: 12, color: '#FF3B30', marginBottom: 8 }}>{msg}</div>}
        {loading && <div style={{ fontSize: 12, color: '#8E8E93', padding: 14, textAlign: 'center' }}>Cargando…</div>}
        {!loading && cands.length === 0 && <div style={{ fontSize: 12, color: '#8E8E93', padding: 14, textAlign: 'center' }}>Sin resultados. Buscá por proveedor o folio.</div>}

        {!loading && cands.map(f => {
          const rolSug = rolesSugeridos.get(normRut(f.rut_proveedor)) ?? 'otro_costo_imp'
          const meta = rolMeta(rolSug)
          return (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', marginBottom: 6, borderRadius: 10, border: '1px solid #E5E5EA' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Folio {f.folio} · {fmt(f.monto_total)}
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, marginLeft: 6, background: meta.bg, color: meta.c, fontWeight: 700 }}>sugerido: {meta.l}</span>
                </div>
                <div style={{ fontSize: 11, color: '#8E8E93' }}>{fFecha(f.fecha_emision)} · {f.razon_social}</div>
              </div>
              <select defaultValue={rolSug} id={`rol-${f.id}`} style={{
                fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #E5E5EA', background: '#fff', cursor: 'pointer',
              }}>
                {ROLES.map(r => <option key={r.k} value={r.k}>{r.l}</option>)}
              </select>
              <button
                onClick={() => vincular(f, document.getElementById(`rol-${f.id}`).value)}
                disabled={saving}
                style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#5856D6', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.5 : 1 }}
              >Vincular</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
