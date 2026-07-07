import { useState, useEffect, useMemo } from 'react'
import { supabase, signOut } from '../supabase'

/* ═══════════════════════════════════════════════════════════════════════════
   COMERCIAL — Fase 1
   Metas de venta diaria por sucursal + seguimiento de cotizaciones (gestión del
   vendedor). Emula la app de gestión comercial (Apps Script + Sheets) sobre
   Supabase. La extracción BSALE vive en el edge function `bsale-comercial`.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Paleta del módulo (índigo, distinta a las demás apps) ── */
const C1 = '#5856D6'
const C2 = '#3d3ba3'

/* ── Helpers ── */
const fmt = n => '$' + Math.round(n || 0).toLocaleString('es-CL')
const fmtK = n => {
  const v = Math.abs(n || 0)
  if (v >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K'
  return '$' + Math.round(n || 0).toLocaleString('es-CL')
}
const fN = n => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)
const daysAgo = d => (d ? Math.floor((Date.now() - new Date(d + 'T12:00:00').getTime()) / 86400000) : 0)
const shortKey = sid => (sid || '').replace('suc-', '')
const fmtFecha = d => { if (!d) return '—'; const p = String(d).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d }

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const ESTADOS = {
  sin_contactar: { label: 'Sin contactar', c: '#FF3B30', bg: '#FF3B3015', ic: '⚠️' },
  contactado: { label: 'Contactado', c: '#FF9500', bg: '#FF950015', ic: '📞' },
  en_negociacion: { label: 'En negociación', c: '#007AFF', bg: '#007AFF15', ic: '🤝' },
  convertida: { label: 'Convertida', c: '#34C759', bg: '#34C75915', ic: '✅' },
  perdida: { label: 'Perdida', c: '#8E8E93', bg: '#8E8E9315', ic: '❌' },
}
const MOTIVOS = ['Precio alto', 'Compró en competencia', 'No responde / sin contacto', 'Decidió no comprar', 'Plazo de entrega', 'Otro']

/* Días hábiles del mes (lun–sáb) menos feriados no trabajados en la sucursal */
function diasHabiles(anio, mes, sucKey, feriados) {
  const flag = 'trabaja_' + sucKey
  let n = 0
  const d = new Date(anio, mes - 1, 1)
  while (d.getMonth() === mes - 1) {
    const dow = d.getDay()
    if (dow >= 1 && dow <= 6) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const fer = feriados.find(f => f.fecha === iso)
      if (!fer || fer[flag]) n++
    }
    d.setDate(d.getDate() + 1)
  }
  return n
}

/* Llamada al edge function bsale-comercial */
async function callBsale(action, params) {
  const { data, error } = await supabase.functions.invoke('bsale-comercial', {
    body: { action, ...params },
  })
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Error BSALE')
  return data
}

/* ═══ COMPONENTES CHICOS ═══ */
const Bar = ({ v, color }) => (
  <div style={{ height: 6, background: '#eceaf6', borderRadius: 3, overflow: 'hidden' }}>
    <div style={{ height: '100%', width: `${Math.min(100, v)}%`, background: color, borderRadius: 3, transition: 'width .4s' }} />
  </div>
)
const Chip = ({ estado }) => {
  const s = ESTADOS[estado] || ESTADOS.sin_contactar
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, color: s.c, background: s.bg, whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 10 }}>{s.ic}</span>{s.label}
    </span>
  )
}
const Dot = ({ c }) => <span style={{ width: 7, height: 7, borderRadius: 4, background: c, display: 'inline-block' }} />

/* ═══ APP ═══ */
export function ComercialApp({ cu, setAppActual }) {
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false))
  useEffect(() => {
    const on = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  const [tab, setTab] = useState('metas')
  const [esGerente, setEsGerente] = useState(['admin', 'dir_general'].includes(cu?.rol))

  /* Base */
  const [sucursales, setSucursales] = useState([])   // com_bsale_config
  const [vendedores, setVendedores] = useState([])   // com_vendedores
  const [feriados, setFeriados] = useState([])        // com_feriados (año actual)
  const [metas, setMetas] = useState([])              // com_metas (anio/mes)
  const [seg, setSeg] = useState([])                  // com_seguimiento
  const [loadingBase, setLoadingBase] = useState(true)
  const [errBase, setErrBase] = useState('')

  const [anio, setAnio] = useState(new Date().getFullYear())
  const [mes, setMes] = useState(new Date().getMonth() + 1)
  const [sucSel, setSucSel] = useState('')

  /* ── Carga base ── */
  useEffect(() => {
    let cancel = false
    const cargar = async () => {
      setLoadingBase(true); setErrBase('')
      try {
        const [cfg, vend, fer, sg, acc] = await Promise.all([
          supabase.from('com_bsale_config').select('*').order('orden'),
          supabase.from('com_vendedores').select('*').order('nombre'),
          supabase.from('com_feriados').select('*').gte('fecha', `${anio}-01-01`).lte('fecha', `${anio}-12-31`),
          supabase.from('com_seguimiento').select('*'),
          supabase.from('usuario_acceso').select('rol_id').eq('usuario_id', cu?.id).eq('app_codigo', 'comercial').eq('activo', true).maybeSingle(),
        ])
        if (cancel) return
        const sucs = cfg.data || []
        setSucursales(sucs)
        setVendedores(vend.data || [])
        setFeriados(fer.data || [])
        setSeg(sg.data || [])
        if (acc.data?.rol_id) setEsGerente(acc.data.rol_id === 'comercial.gerente' || ['admin', 'dir_general'].includes(cu?.rol))
        // Sucursal por defecto: primera con oficina BSALE
        const firstOff = sucs.find(s => s.bsale_office_id && s.activa)
        if (firstOff && !sucSel) setSucSel(firstOff.sucursal_id)
      } catch (e) {
        if (!cancel) setErrBase(String(e?.message || e))
      } finally {
        if (!cancel) setLoadingBase(false)
      }
    }
    cargar()
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cu?.id])

  /* Recarga metas + feriados al cambiar mes/año */
  useEffect(() => {
    let cancel = false
    const cargar = async () => {
      const [m, f] = await Promise.all([
        supabase.from('com_metas').select('*').eq('anio', anio).eq('mes', mes),
        supabase.from('com_feriados').select('*').gte('fecha', `${anio}-01-01`).lte('fecha', `${anio}-12-31`),
      ])
      if (cancel) return
      setMetas(m.data || [])
      setFeriados(f.data || [])
    }
    cargar()
    return () => { cancel = true }
  }, [anio, mes])

  const cambiarApp = () => { try { localStorage.removeItem('outlet_app_actual') } catch (e) {} ; setAppActual(null) }
  const cerrarSesion = async () => { try { await signOut() } catch (e) {} ; try { localStorage.removeItem('erp_cu_id'); localStorage.removeItem('outlet_app_actual') } catch (e) {} ; window.location.reload() }

  const iniciales = (cu?.nombre || cu?.correo || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const TABS = [
    { k: 'metas', l: 'Metas de venta', ic: '🎯' },
    { k: 'cotizaciones', l: 'Cotizaciones', ic: '📋' },
    ...(esGerente ? [{ k: 'config', l: 'Configuración', ic: '⚙️' }] : []),
  ]

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif", background: '#f4f4fb', minHeight: '100vh', fontSize: 14, color: '#1c1c1e' }}>
      <style>{`
        *{box-sizing:border-box}
        .com-tab:hover{background:rgba(255,255,255,.08)}
        table.com{border-collapse:collapse;width:100%;font-size:12.5px}
        table.com th{text-align:left;padding:7px 10px;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#8b88a8;font-weight:700;border-bottom:1px solid #e7e5f2;white-space:nowrap;position:sticky;top:0;background:#faf9ff;z-index:1}
        table.com td{padding:8px 10px;border-bottom:1px solid #f0eff7;vertical-align:middle}
        table.com tr.click:hover{background:#f7f6ff;cursor:pointer}
        .com-inp{width:100%;padding:8px 10px;border:1px solid #e0def0;border-radius:8px;font-size:13px;outline:none;background:#fff}
        .com-inp:focus{border-color:${C1};box-shadow:0 0 0 3px rgba(88,86,214,.12)}
      `}</style>

      {/* ═══ HEADER navy SAP-dense ═══ */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'linear-gradient(135deg,#1a1a2e,#16213e)', color: '#fff', padding: isMobile ? '10px 14px' : '12px 22px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 2px 10px rgba(0,0,0,.15)' }}>
        <button onClick={cambiarApp} style={{ background: 'rgba(255,255,255,.1)', border: 'none', color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>← Apps</button>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg,${C1},${C2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>📈</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>Comercial</div>
          {!isMobile && <div style={{ fontSize: 10.5, color: '#9aa0c0' }}>Metas de venta diaria · seguimiento de cotizaciones</div>}
        </div>
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 15, background: `${C1}30`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{iniciales}</div>
            <div style={{ fontSize: 11.5 }}>{(cu?.nombre || '').split(' ')[0]}</div>
          </div>
        )}
        <button onClick={cerrarSesion} style={{ background: 'rgba(255,255,255,.1)', border: 'none', color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>↩</button>
      </div>

      {/* ═══ TABS ═══ */}
      <div style={{ background: '#20203a', display: 'flex', gap: 2, padding: '0 8px', overflowX: 'auto', position: 'sticky', top: isMobile ? 52 : 56, zIndex: 19 }}>
        {TABS.map(t => (
          <button key={t.k} className="com-tab" onClick={() => setTab(t.k)}
            style={{ background: tab === t.k ? '#f4f4fb' : 'transparent', color: tab === t.k ? C2 : '#b9bce0', border: 'none', padding: '10px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', borderRadius: '8px 8px 0 0', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{t.ic}</span>{t.l}
          </button>
        ))}
      </div>

      {/* ═══ CONTENIDO ═══ */}
      <div style={{ padding: isMobile ? '12px 12px 40px' : '18px 22px 48px', maxWidth: 1280, margin: '0 auto' }}>
        {loadingBase ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#8b88a8' }}>Cargando módulo…</div>
        ) : errBase ? (
          <div style={{ padding: 16, background: '#FF3B3010', color: '#FF3B30', borderRadius: 10, fontSize: 13 }}>
            Error cargando datos: {errBase}. Verifica que las tablas com_* existan (correr comercial_fase1.sql).
          </div>
        ) : (
          <>
            {tab === 'metas' && <TabMetas {...{ sucursales, vendedores, feriados, metas, anio, setAnio, mes, setMes, isMobile }} />}
            {tab === 'cotizaciones' && <TabCotizaciones {...{ sucursales, vendedores, sucSel, setSucSel, seg, setSeg, cu, isMobile }} />}
            {tab === 'config' && esGerente && <TabConfig {...{ sucursales, setSucursales, vendedores, setVendedores, metas, setMetas, anio, setAnio, mes, setMes, cu }} />}
          </>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB 1 — METAS DE VENTA DIARIA
   ═══════════════════════════════════════════════════════════════════════════ */
function TabMetas({ sucursales, vendedores, feriados, metas, anio, setAnio, mes, setMes, isMobile }) {
  const [fecha, setFecha] = useState(hoy())
  const [ventas, setVentas] = useState({})   // { sucursal_id: {total, docs, ventas:[...]} }
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const activas = sucursales.filter(s => s.bsale_office_id && s.activa)

  const cargarVentas = async () => {
    setLoading(true); setErr('')
    const out = {}
    try {
      await Promise.all(activas.map(async s => {
        try {
          const r = await callBsale('ventas_dia', { office_id: s.bsale_office_id, fecha })
          out[s.sucursal_id] = { total: r.total || 0, docs: r.docs || 0, ventas: r.ventas || [] }
        } catch (e) {
          out[s.sucursal_id] = { error: String(e?.message || e), total: 0, docs: 0, ventas: [] }
        }
      }))
      setVentas(out)
    } catch (e) { setErr(String(e?.message || e)) }
    setLoading(false)
  }

  useEffect(() => { if (activas.length) cargarVentas() /* eslint-disable-next-line */ }, [fecha, anio, mes])

  const metaMes = sid => Number(metas.find(m => m.sucursal_id === sid)?.meta_clp || 0)
  const dh = sid => diasHabiles(anio, mes, shortKey(sid), feriados)
  const metaDia = sid => { const d = dh(sid); return d > 0 ? metaMes(sid) / d : 0 }
  const nombreVend = bsaleId => vendedores.find(v => String(v.bsale_user_id) === String(bsaleId))?.nombre

  const totalRealHoy = activas.reduce((s, x) => s + (ventas[x.sucursal_id]?.total || 0), 0)
  const totalMetaDia = activas.reduce((s, x) => s + metaDia(x.sucursal_id), 0)

  const anios = [anio - 1, anio, anio + 1]

  return (
    <div>
      {/* Controles */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#8b88a8', fontWeight: 600 }}>DÍA</span>
          <input type="date" className="com-inp" style={{ width: 150 }} value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select className="com-inp" style={{ width: 130 }} value={mes} onChange={e => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select className="com-inp" style={{ width: 90 }} value={anio} onChange={e => setAnio(Number(e.target.value))}>
            {anios.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button onClick={cargarVentas} disabled={loading} style={{ background: loading ? '#c7c5e0' : `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12.5, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'Consultando BSALE…' : '↻ Actualizar ventas'}
        </button>
      </div>

      {/* Resumen global */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        <KPI l="Venta del día" v={fmtK(totalRealHoy)} c={C2} />
        <KPI l="Meta del día" v={fmtK(totalMetaDia)} c="#8b88a8" />
        <KPI l="Cumplimiento" v={pct(totalRealHoy, totalMetaDia) + '%'} c={pct(totalRealHoy, totalMetaDia) >= 100 ? '#34C759' : pct(totalRealHoy, totalMetaDia) >= 70 ? '#FF9500' : '#FF3B30'} />
        <KPI l="Sucursales activas" v={fN(activas.length)} c="#007AFF" />
      </div>

      {err && <div style={{ padding: 12, background: '#FF3B3010', color: '#FF3B30', borderRadius: 10, fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      {/* Tarjeta por sucursal */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(360px,1fr))', gap: 14 }}>
        {activas.map(s => {
          const vv = ventas[s.sucursal_id] || {}
          const real = vv.total || 0
          const md = metaDia(s.sucursal_id)
          const p = pct(real, md)
          const color = p >= 100 ? '#34C759' : p >= 70 ? '#FF9500' : '#FF3B30'
          const filas = (vv.ventas || []).filter(v => v.total !== 0).sort((a, b) => b.total - a.total)
          return (
            <div key={s.sucursal_id} style={{ background: '#fff', borderRadius: 14, border: '1px solid #eceaf6', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0eff7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{s.nombre}</div>
                  <div style={{ fontSize: 10.5, color: '#8b88a8' }}>Meta mes {fmtK(metaMes(s.sucursal_id))} · {dh(s.sucursal_id)} días hábiles</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color }}>{p}%</div>
                  <div style={{ fontSize: 10, color: '#8b88a8' }}>del día</div>
                </div>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                  <span style={{ color: '#3a3a3c', fontWeight: 700 }}>{fmt(real)}</span>
                  <span style={{ color: '#8b88a8' }}>meta {fmt(md)}</span>
                </div>
                <Bar v={p} color={color} />
                {vv.error ? (
                  <div style={{ fontSize: 11, color: '#FF3B30', marginTop: 10 }}>⚠️ {vv.error}</div>
                ) : filas.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: '#8b88a8', marginTop: 10 }}>Sin ventas registradas este día.</div>
                ) : (
                  <table className="com" style={{ marginTop: 10 }}>
                    <thead><tr><th>Vendedor</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Docs</th></tr></thead>
                    <tbody>
                      {filas.map((v, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{nombreVend(v.seller_id) || v.seller_name}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: v.total < 0 ? '#FF3B30' : '#1c1c1e' }}>{fmt(v.total)}</td>
                          <td style={{ textAlign: 'right', color: '#8b88a8' }}>{v.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Sucursales sin oficina BSALE */}
      {sucursales.filter(s => !s.bsale_office_id).map(s => (
        <div key={s.sucursal_id} style={{ marginTop: 12, padding: '10px 16px', background: '#fff', border: '1px dashed #e0def0', borderRadius: 12, fontSize: 12, color: '#8b88a8' }}>
          <strong>{s.nombre}</strong> — sin oficina BSALE configurada. Asigna su <code>bsale_office_id</code> en Configuración cuando abra.
        </div>
      ))}
    </div>
  )
}

const KPI = ({ l, v, c }) => (
  <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #eceaf6', padding: '12px 14px' }}>
    <div style={{ fontSize: 10.5, color: '#8b88a8', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>{l}</div>
    <div style={{ fontSize: 22, fontWeight: 800, color: c, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
  </div>
)

/* ═══════════════════════════════════════════════════════════════════════════
   TAB 2 — COTIZACIONES (seguimiento del vendedor)
   ═══════════════════════════════════════════════════════════════════════════ */
function TabCotizaciones({ sucursales, vendedores, sucSel, setSucSel, seg, setSeg, cu, isMobile }) {
  const [dias, setDias] = useState(30)
  const [cots, setCots] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [fEstado, setFEstado] = useState('')
  const [fVend, setFVend] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)   // cotización en edición

  const activas = sucursales.filter(s => s.bsale_office_id && s.activa)
  const office = sucursales.find(s => s.sucursal_id === sucSel)?.bsale_office_id

  const cargar = async () => {
    if (!office) { setErr('Selecciona una sucursal con oficina BSALE.'); return }
    setLoading(true); setErr('')
    try {
      const r = await callBsale('cotizaciones', { office_id: office, days: dias })
      setCots(r.cotizaciones || [])
    } catch (e) { setErr(String(e?.message || e)) }
    setLoading(false)
  }
  useEffect(() => { if (office) cargar() /* eslint-disable-next-line */ }, [sucSel, dias])

  const segMap = useMemo(() => {
    const m = {}; seg.forEach(s => { m[s.doc_id] = s }); return m
  }, [seg])

  const rows = useMemo(() => {
    return cots.map(c => {
      const s = segMap[c.id]
      return {
        ...c,
        estado: s?.estado || 'sin_contactar',
        fecha_proximo: s?.fecha_proximo_contacto || '',
        obs: s?.observaciones || '',
        motivo: s?.motivo_perdida || '',
        updated_at: s?.updated_at || '',
      }
    })
  }, [cots, segMap])

  const filtradas = rows.filter(r => {
    if (fEstado && r.estado !== fEstado) return false
    if (fVend && String(r.seller?.id) !== String(fVend)) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(String(r.number).includes(t) || (r.cliente?.name || '').toLowerCase().includes(t))) return false
    }
    return true
  }).sort((a, b) => (b.date_ts || 0) - (a.date_ts || 0))

  /* KPIs */
  const total = rows.length
  const sinContactar = rows.filter(r => r.estado === 'sin_contactar').length
  const pipeline = rows.filter(r => r.estado === 'contactado' || r.estado === 'en_negociacion').length
  const convertidas = rows.filter(r => r.estado === 'convertida').length
  const montoRiesgo = rows.filter(r => r.estado === 'sin_contactar').reduce((s, r) => s + (r.total || 0), 0)
  const tasa = pct(convertidas, total)

  const vendsSuc = vendedores.filter(v => v.sucursal_id === sucSel)

  return (
    <div>
      {/* Controles */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <select className="com-inp" style={{ width: 170 }} value={sucSel} onChange={e => setSucSel(e.target.value)}>
          {activas.map(s => <option key={s.sucursal_id} value={s.sucursal_id}>{s.nombre}</option>)}
        </select>
        <select className="com-inp" style={{ width: 130 }} value={dias} onChange={e => setDias(Number(e.target.value))}>
          <option value={7}>Últimos 7 días</option>
          <option value={15}>Últimos 15 días</option>
          <option value={30}>Últimos 30 días</option>
          <option value={60}>Últimos 60 días</option>
        </select>
        <button onClick={cargar} disabled={loading} style={{ background: loading ? '#c7c5e0' : `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12.5, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'Consultando BSALE…' : '↻ Actualizar'}
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5,1fr)', gap: 10, marginBottom: 14 }}>
        <KPI l="Cotizaciones" v={fN(total)} c={C2} />
        <KPI l="Sin contactar" v={fN(sinContactar)} c="#FF3B30" />
        <KPI l="En pipeline" v={fN(pipeline)} c="#007AFF" />
        <KPI l="Convertidas" v={fN(convertidas)} c="#34C759" />
        <KPI l="Tasa conversión" v={tasa + '%'} c={tasa >= 30 ? '#34C759' : '#FF9500'} />
      </div>
      {montoRiesgo > 0 && (
        <div style={{ padding: '9px 14px', background: '#FF3B3010', color: '#FF3B30', borderRadius: 10, fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>
          ⚠️ {fmt(montoRiesgo)} en {sinContactar} cotizaciones sin contactar
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <select className="com-inp" style={{ width: 160 }} value={fEstado} onChange={e => setFEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="com-inp" style={{ width: 170 }} value={fVend} onChange={e => setFVend(e.target.value)}>
          <option value="">Todos los vendedores</option>
          {vendsSuc.map(v => <option key={v.bsale_user_id} value={v.bsale_user_id}>{v.nombre}</option>)}
        </select>
        <input className="com-inp" style={{ flex: 1, minWidth: 160 }} placeholder="Buscar cliente o N° cotización…" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {err && <div style={{ padding: 12, background: '#FF3B3010', color: '#FF3B30', borderRadius: 10, fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      {/* Tabla */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eceaf6', overflow: 'auto', maxHeight: '62vh' }}>
        <table className="com">
          <thead>
            <tr>
              <th>N°</th><th>Fecha</th><th>Cliente</th><th>Vendedor</th>
              <th style={{ textAlign: 'right' }}>Monto</th><th>Estado</th><th>Próx. contacto</th><th>Días</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#8b88a8' }}>{loading ? 'Cargando…' : 'Sin cotizaciones para el filtro actual.'}</td></tr>
            ) : filtradas.map(r => {
              const d = daysAgo(r.date)
              const alerta = r.estado === 'sin_contactar' && d >= 2
              return (
                <tr key={r.id} className="click" onClick={() => setSel(r)}>
                  <td style={{ fontWeight: 700, color: C2 }}>#{r.number}</td>
                  <td>{fmtFecha(r.date)}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cliente?.name}</td>
                  <td style={{ color: '#5a5a6e' }}>{r.seller?.name}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.total)}</td>
                  <td><Chip estado={r.estado} /></td>
                  <td style={{ color: r.fecha_proximo && daysAgo(r.fecha_proximo) > 0 ? '#FF3B30' : '#5a5a6e' }}>{r.fecha_proximo ? fmtFecha(r.fecha_proximo) : '—'}</td>
                  <td>{alerta ? <span style={{ color: '#FF3B30', fontWeight: 700 }}>{d}d ⚠️</span> : <span style={{ color: '#8b88a8' }}>{d}d</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {sel && <SheetSeguimiento cot={sel} onClose={() => setSel(null)} cu={cu} sucSel={sucSel}
        onSaved={(row) => { setSeg(prev => { const o = prev.filter(x => x.doc_id !== row.doc_id); return [...o, row] }); setSel(null) }} />}
    </div>
  )
}

/* Sheet de seguimiento */
function SheetSeguimiento({ cot, onClose, cu, sucSel, onSaved }) {
  const [estado, setEstado] = useState(cot.estado || 'sin_contactar')
  const [fechaProx, setFechaProx] = useState(cot.fecha_proximo || '')
  const [obs, setObs] = useState(cot.obs || '')
  const [motivo, setMotivo] = useState(cot.motivo || '')
  const [nroBoleta, setNroBoleta] = useState('')
  const [montoReal, setMontoReal] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const guardar = async () => {
    setSaving(true); setErr('')
    const now = new Date().toISOString()
    const row = {
      doc_id: cot.id,
      bsale_number: String(cot.number),
      estado,
      fecha_proximo_contacto: fechaProx || null,
      observaciones: obs || null,
      motivo_perdida: estado === 'perdida' ? (motivo || null) : null,
      vendedor_bsale_id: cot.seller?.id ? parseInt(cot.seller.id) : null,
      sucursal_id: sucSel || null,
      nro_boleta: estado === 'convertida' ? (nroBoleta || null) : null,
      monto_real: estado === 'convertida' && montoReal ? Number(montoReal) : null,
      updated_at: now,
      updated_by: cu?.nombre || cu?.correo || null,
    }
    try {
      const { error } = await supabase.from('com_seguimiento').upsert(row, { onConflict: 'doc_id' })
      if (error) throw error
      await supabase.from('com_seguimiento_log').insert({
        doc_id: cot.id, estado, observaciones: obs || null, motivo_perdida: row.motivo_perdida,
        nro_boleta: row.nro_boleta, monto_real: row.monto_real, usuario: row.updated_by,
      })
      onSaved(row)
    } catch (e) { setErr(String(e?.message || e)); setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,30,.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '18px 18px 0 0', padding: '10px 20px 28px', width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#e5e5ea', margin: '0 auto 12px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Cotización #{cot.number}</div>
            <div style={{ fontSize: 12, color: '#8b88a8', marginTop: 1 }}>{cot.cliente?.name} · {fmt(cot.total)} · {fmtFecha(cot.date)}</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 15, background: '#f2f2f7', border: 'none', fontSize: 14, cursor: 'pointer', color: '#8b88a8' }}>✕</button>
        </div>
        {(cot.cliente?.phone || cot.cliente?.email) && (
          <div style={{ fontSize: 12, color: '#5a5a6e', marginBottom: 14, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {cot.cliente?.phone && <span>📞 {cot.cliente.phone}</span>}
            {cot.cliente?.email && <span>✉️ {cot.cliente.email}</span>}
            <span>👤 {cot.seller?.name}</span>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#3a3a3c', display: 'block', marginBottom: 6 }}>Estado del seguimiento</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(ESTADOS).map(([k, v]) => (
              <button key={k} onClick={() => setEstado(k)}
                style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: estado === k ? `2px solid ${v.c}` : '1px solid #e0def0', background: estado === k ? v.bg : '#fff', color: estado === k ? v.c : '#5a5a6e' }}>
                {v.ic} {v.label}
              </button>
            ))}
          </div>
        </div>

        {(estado === 'sin_contactar' || estado === 'contactado' || estado === 'en_negociacion') && (
          <Field l="Próximo contacto">
            <input type="date" className="com-inp" value={fechaProx} onChange={e => setFechaProx(e.target.value)} />
          </Field>
        )}
        {estado === 'perdida' && (
          <Field l="Motivo de pérdida">
            <select className="com-inp" value={motivo} onChange={e => setMotivo(e.target.value)}>
              <option value="">Selecciona…</option>
              {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        )}
        {estado === 'convertida' && (
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><Field l="N° boleta/factura"><input className="com-inp" value={nroBoleta} onChange={e => setNroBoleta(e.target.value)} /></Field></div>
            <div style={{ flex: 1 }}><Field l="Monto real"><input className="com-inp" type="number" value={montoReal} onChange={e => setMontoReal(e.target.value)} placeholder={String(cot.total)} /></Field></div>
          </div>
        )}
        <Field l="Observaciones">
          <textarea className="com-inp" rows={3} value={obs} onChange={e => setObs(e.target.value)} placeholder="Notas de la gestión…" style={{ resize: 'vertical' }} />
        </Field>

        {err && <div style={{ padding: 10, background: '#FF3B3010', color: '#FF3B30', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: 9, background: '#f2f2f7', color: '#3a3a3c', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={{ padding: '10px 18px', borderRadius: 9, background: saving ? '#c7c5e0' : `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>{saving ? 'Guardando…' : 'Guardar seguimiento'}</button>
        </div>
      </div>
    </div>
  )
}

const Field = ({ l, children }) => (
  <div style={{ marginBottom: 12 }}>
    <label style={{ fontSize: 12, fontWeight: 700, color: '#3a3a3c', display: 'block', marginBottom: 5 }}>{l}</label>
    {children}
  </div>
)

/* ═══════════════════════════════════════════════════════════════════════════
   TAB 3 — CONFIGURACIÓN (gerente)
   ═══════════════════════════════════════════════════════════════════════════ */
function TabConfig({ sucursales, setSucursales, vendedores, setVendedores, metas, setMetas, anio, setAnio, mes, setMes, cu }) {
  const [msg, setMsg] = useState('')
  const [metaDraft, setMetaDraft] = useState({})   // sucursal_id -> valor

  useEffect(() => {
    const d = {}; sucursales.forEach(s => { d[s.sucursal_id] = String(metas.find(m => m.sucursal_id === s.sucursal_id)?.meta_clp || 0) }); setMetaDraft(d)
  }, [metas, sucursales])

  const flash = t => { setMsg(t); setTimeout(() => setMsg(''), 2500) }

  const guardarMeta = async (sid) => {
    const val = Number(metaDraft[sid] || 0)
    const { error } = await supabase.from('com_metas').upsert(
      { anio, mes, sucursal_id: sid, meta_clp: val, updated_at: new Date().toISOString(), updated_by: cu?.nombre || cu?.correo },
      { onConflict: 'anio,mes,sucursal_id' }
    )
    if (error) { flash('Error: ' + error.message); return }
    setMetas(prev => { const o = prev.filter(m => m.sucursal_id !== sid); return [...o, { anio, mes, sucursal_id: sid, meta_clp: val }] })
    flash(`Meta guardada: ${sucursales.find(s => s.sucursal_id === sid)?.nombre}`)
  }

  const guardarOffice = async (sid, campo, valor) => {
    const patch = { [campo]: valor, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('com_bsale_config').update(patch).eq('sucursal_id', sid)
    if (error) { flash('Error: ' + error.message); return }
    setSucursales(prev => prev.map(s => s.sucursal_id === sid ? { ...s, ...patch } : s))
    flash('Configuración actualizada')
  }

  const toggleVend = async (id, activo) => {
    const { error } = await supabase.from('com_vendedores').update({ activo, updated_at: new Date().toISOString() }).eq('bsale_user_id', id)
    if (error) { flash('Error: ' + error.message); return }
    setVendedores(prev => prev.map(v => v.bsale_user_id === id ? { ...v, activo } : v))
  }

  const anios = [anio - 1, anio, anio + 1]

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {msg && <div style={{ padding: '9px 14px', background: '#34C75915', color: '#1f6e54', borderRadius: 10, fontSize: 12.5, fontWeight: 600 }}>{msg}</div>}

      {/* Metas por sucursal */}
      <section style={{ background: '#fff', borderRadius: 14, border: '1px solid #eceaf6', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>🎯 Metas de venta mensuales</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <select className="com-inp" style={{ width: 130 }} value={mes} onChange={e => setMes(Number(e.target.value))}>
              {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select className="com-inp" style={{ width: 90 }} value={anio} onChange={e => setAnio(Number(e.target.value))}>
              {anios.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {sucursales.map(s => (
            <div key={s.sucursal_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 130, fontSize: 13, fontWeight: 600 }}>{s.nombre}</div>
              <input className="com-inp" type="number" style={{ flex: 1, maxWidth: 240 }} value={metaDraft[s.sucursal_id] ?? ''} onChange={e => setMetaDraft(d => ({ ...d, [s.sucursal_id]: e.target.value }))} placeholder="Meta mensual CLP" />
              <span style={{ fontSize: 11.5, color: '#8b88a8', minWidth: 100 }}>{fmtK(Number(metaDraft[s.sucursal_id] || 0))}</span>
              <button onClick={() => guardarMeta(s.sucursal_id)} style={{ background: `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Guardar</button>
            </div>
          ))}
        </div>
      </section>

      {/* Mapeo BSALE */}
      <section style={{ background: '#fff', borderRadius: 14, border: '1px solid #eceaf6', padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>🔌 Mapeo de oficinas BSALE</div>
        <div style={{ fontSize: 11.5, color: '#8b88a8', marginBottom: 12 }}>El <code>office_id</code> de BSALE por sucursal. Sin él, no se consultan ventas ni cotizaciones.</div>
        <table className="com">
          <thead><tr><th>Sucursal</th><th>ID interno</th><th>Office ID BSALE</th><th>Activa</th></tr></thead>
          <tbody>
            {sucursales.map(s => (
              <tr key={s.sucursal_id}>
                <td style={{ fontWeight: 600 }}>{s.nombre}</td>
                <td style={{ color: '#8b88a8', fontFamily: 'monospace' }}>{s.sucursal_id}</td>
                <td>
                  <input className="com-inp" type="number" style={{ width: 90 }} defaultValue={s.bsale_office_id ?? ''}
                    onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== s.bsale_office_id) guardarOffice(s.sucursal_id, 'bsale_office_id', v) }} />
                </td>
                <td>
                  <button onClick={() => guardarOffice(s.sucursal_id, 'activa', !s.activa)}
                    style={{ padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', color: s.activa ? '#1f6e54' : '#8b88a8', background: s.activa ? '#34C75915' : '#f2f2f7' }}>
                    {s.activa ? '● Activa' : '○ Inactiva'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Vendedores */}
      <section style={{ background: '#fff', borderRadius: 14, border: '1px solid #eceaf6', padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>👥 Vendedores ({vendedores.filter(v => v.activo).length} activos)</div>
        <table className="com">
          <thead><tr><th>ID BSALE</th><th>Nombre</th><th>Sucursal</th><th>Rol</th><th>Estado</th></tr></thead>
          <tbody>
            {vendedores.map(v => (
              <tr key={v.bsale_user_id}>
                <td style={{ fontFamily: 'monospace', color: '#8b88a8' }}>{v.bsale_user_id}</td>
                <td style={{ fontWeight: 600 }}>{v.nombre}</td>
                <td>{sucursales.find(s => s.sucursal_id === v.sucursal_id)?.nombre || v.sucursal_id || '—'}</td>
                <td><span style={{ fontSize: 11, color: '#5a5a6e' }}>{v.rol}</span></td>
                <td>
                  <button onClick={() => toggleVend(v.bsale_user_id, !v.activo)}
                    style={{ padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', color: v.activo ? '#1f6e54' : '#8b88a8', background: v.activo ? '#34C75915' : '#f2f2f7' }}>
                    {v.activo ? '● Activo' : '○ Inactivo'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
