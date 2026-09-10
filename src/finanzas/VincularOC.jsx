import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabase'
import { toast } from 'sonner'

/* ══════════════════════════════════════════════════════════════════════
   VINCULAR OC — etapa 1 · Documentos
   OC recibidas sin factura vinculada × facturas candidatas del proveedor
   (mismo RUT, ventana de fechas). El usuario elige qué facturas pertenecen
   a la OC; la relación real es N:M, por eso decide un humano con evidencia:
   diferencia %, recepciones de logística, folios y montos a la vista.
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73'
const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', FONDO = '#F9FAFB'
const fmt = n => (n == null || n === '' ? '' : new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n))))
const TD = { padding: '6px 8px', fontSize: 12, color: INK, borderBottom: '1px solid #F3F4F6' }
const INPUT = { fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: INK }

export function VincularOC({ cu }) {
  const [sugerencias, setSugerencias] = useState([])
  const [detalle, setDetalle] = useState({})     // oc_id → facturas [{id, folio, fecha, monto, marcada}]
  const [abierta, setAbierta] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase.from('v_oc_vinculo_sugerencias').select('*').order('total_clp', { ascending: false }).limit(200)
    if (error) toast.error(error.message)
    setSugerencias(data ?? []); setCargando(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function abrir(s) {
    if (abierta === s.oc_id) { setAbierta(null); return }
    setAbierta(s.oc_id)
    if (!detalle[s.oc_id]) {
      const { data } = await supabase.from('libro_compras')
        .select('id, folio, fecha_emision, monto_total')
        .in('id', s.factura_ids).order('fecha_emision').limit(100)
      setDetalle(d => ({ ...d, [s.oc_id]: (data ?? []).map(f => ({ ...f, marcada: true })) }))
    }
  }

  const toggleFactura = (ocId, fid) => setDetalle(d => ({
    ...d, [ocId]: d[ocId].map(f => f.id === fid ? { ...f, marcada: !f.marcada } : f)
  }))

  async function vincular(s) {
    const facturas = (detalle[s.oc_id] ?? []).filter(f => f.marcada)
    if (!facturas.length) { toast.warning('Marque al menos una factura'); return }
    const suma = facturas.reduce((t, f) => t + Number(f.monto_total), 0)
    const dif = ((suma - Number(s.total_clp)) / Number(s.total_clp) * 100).toFixed(1)
    if (!window.confirm(`Vincular ${facturas.length} facturas ($${fmt(suma)}) a la ${s.oc_id} ($${fmt(s.total_clp)})?\nDiferencia: ${dif}%`)) return
    setProcesando(s.oc_id)
    try {
      const { data, error } = await supabase.rpc('fn_vincular_facturas_oc', {
        p_oc_id: s.oc_id, p_factura_ids: facturas.map(f => f.id), p_usuario: cu?.id ?? 'ui',
      })
      if (error) throw error
      toast.success(`${data.vinculadas} facturas vinculadas a ${s.oc_id}`)
      setAbierta(null); cargar()
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  const kpi = useMemo(() => ({
    n: sugerencias.length,
    monto: sugerencias.reduce((t, s) => t + Number(s.total_clp), 0),
    exactas: sugerencias.filter(s => Math.abs(Number(s.dif_pct)) <= 2).length,
  }), [sugerencias])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '8px 12px', fontSize: 11.5, color: '#1E3A8A', lineHeight: 1.5 }}>
        <b>Vincular OC.</b> Órdenes recibidas o cerradas que aún no tienen su factura asociada, con las facturas candidatas del
        mismo proveedor en la ventana de fechas. La relación puede ser N facturas por OC (despachos parciales) — por eso elegís
        vos cuáles pertenecen, con la diferencia % y las recepciones de bodega como evidencia. Las DIN de importación ya se
        vinculan solas por recepción.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { l: 'OC con candidatas', v: kpi.n, d: fmt(kpi.monto) + ' en OC' },
          { l: 'Cuadran al ±2%', v: kpi.exactas, c: VERDE, d: 'vínculo directo seguro' },
        ].map(k => (
          <div key={k.l} style={{ flex: '1 1 160px', minWidth: 150, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4 }}>{k.l}</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: k.c || INK, fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>{k.v}</div>
            <div style={{ fontSize: 10, color: SLATE, marginTop: 2 }}>{k.d}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${BORDE}`, background: FONDO }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>OC nacionales recibidas sin factura vinculada</div>
        </div>
        {cargando ? <div style={{ padding: 28, textAlign: 'center', color: SLATE, fontSize: 12 }}>Cargando…</div>
          : !sugerencias.length ? <div style={{ padding: 28, textAlign: 'center', color: VERDE, fontSize: 12, fontWeight: 600 }}>Todas las OC recibidas tienen factura vinculada</div>
          : sugerencias.map(s => {
            const dif = Number(s.dif_pct)
            const facts = detalle[s.oc_id] ?? []
            const sumaSel = facts.filter(f => f.marcada).reduce((t, f) => t + Number(f.monto_total), 0)
            return (
              <div key={s.oc_id} style={{ borderBottom: `1px solid ${BORDE}` }}>
                <div onClick={() => abrir(s)} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px',
                  cursor: 'pointer', background: abierta === s.oc_id ? '#EEF2FF' : '#fff', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: NAVY, fontSize: 12 }}>{s.oc_id}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 160 }}>{s.proveedor}</span>
                  <span style={{ fontSize: 11, color: SLATE }}>{s.estado}</span>
                  <span style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>OC {fmt(s.total_clp)}</span>
                  <span style={{ fontSize: 11, color: SLATE }}>{s.n_facturas} fact. candidatas {fmt(s.suma_facturas)}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: Math.abs(dif) <= 2 ? VERDE : Math.abs(dif) <= 15 ? AMBAR : ROJO }}>
                    {dif > 0 ? '+' : ''}{dif}%</span>
                  <span style={{ fontSize: 10.5, color: SLATE }}>{s.recepciones_logistica} recepciones bodega</span>
                </div>
                {abierta === s.oc_id && (
                  <div style={{ padding: '4px 12px 12px', background: '#FAFBFF' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {facts.map(f => (
                          <tr key={f.id}>
                            <td style={{ ...TD, width: 30 }}>
                              <input type="checkbox" checked={f.marcada} onChange={() => toggleFactura(s.oc_id, f.id)} style={{ width: 13, height: 13, cursor: 'pointer' }} />
                            </td>
                            <td style={{ ...TD, width: 110, color: SLATE }}>{f.fecha_emision}</td>
                            <td style={TD}>Factura {f.folio}</td>
                            <td style={{ ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{fmt(f.monto_total)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: FONDO }}>
                          <td colSpan={3} style={{ ...TD, fontWeight: 700, textAlign: 'right' }}>
                            Seleccionado vs OC:
                          </td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700,
                            color: Math.abs(sumaSel - Number(s.total_clp)) / Number(s.total_clp) <= 0.02 ? VERDE : AMBAR }}>
                            {fmt(sumaSel)} / {fmt(s.total_clp)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <button onClick={() => vincular(s)} disabled={procesando === s.oc_id}
                        style={{ ...INPUT, cursor: 'pointer', color: '#fff', background: VERDE, border: 'none', fontWeight: 700 }}>
                        {procesando === s.oc_id ? 'Vinculando…' : 'Vincular seleccionadas a la OC'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

export default VincularOC
