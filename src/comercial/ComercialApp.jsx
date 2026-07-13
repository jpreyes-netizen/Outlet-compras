import { useState, useEffect, useMemo, Fragment } from 'react'
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
// Catálogo cerrado de motivos de pérdida: permite distinguir problemas de
// stock/precio (se arreglan con gestión de compras) de problemas de venta.
const MOTIVOS = ['Precio alto', 'Sin stock / quiebre', 'Plazo de entrega', 'Compró en competencia', 'No responde / sin contacto', 'Solo cotizaba / comparando', 'Decidió no comprar', 'Otro']

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

/* Días hábiles dentro de un rango [d1, d2] (ISO), mismo criterio lun–sáb menos
   feriados no trabajados. topeHoy=true limita al día de hoy (transcurridos). */
function diasHabilesRango(d1, d2, sucKey, feriados, topeHoy = false) {
  if (!d1 || !d2) return 0
  const flag = 'trabaja_' + sucKey
  const hoyIso = new Date().toLocaleDateString('en-CA')
  const fin = topeHoy && d2 > hoyIso ? hoyIso : d2
  let n = 0
  const [y, m, dd] = d1.split('-').map(Number)
  const d = new Date(y, m - 1, dd)
  while (true) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (iso > fin) break
    const dow = d.getDay()
    if (dow >= 1 && dow <= 6) {
      const fer = feriados.find(f => f.fecha === iso)
      if (!fer || fer[flag]) n++
    }
    d.setDate(d.getDate() + 1)
    if (n > 400) break
  }
  return n
}
function diasHabilesTranscurridos(anio, mes, sucKey, feriados) {
  const hoy = new Date()
  const yA = hoy.getFullYear(), mA = hoy.getMonth() + 1
  if (anio > yA || (anio === yA && mes > mA)) return 0
  const esActual = anio === yA && mes === mA
  const diaTope = esActual ? hoy.getDate() : new Date(anio, mes, 0).getDate()
  const flag = 'trabaja_' + sucKey
  let n = 0
  for (let dd = 1; dd <= diaTope; dd++) {
    const d = new Date(anio, mes - 1, dd)
    const dow = d.getDay()
    if (dow >= 1 && dow <= 6) {
      const iso = `${anio}-${String(mes).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
      const fer = feriados.find(f => f.fecha === iso)
      if (!fer || fer[flag]) n++
    }
  }
  return n
}

/* Semáforo de cumplimiento */
const colorCump = p => p >= 100 ? '#34C759' : p >= 80 ? '#FF9500' : '#FF3B30'

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

  const [tab, setTab] = useState('dashboard')
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
  const perfilNav = resolverPerfil(cu, vendedores, esGerente)
  useEffect(() => {
    if (perfilNav.rol === 'vendedor' && ['dashboard', 'reportes', 'turnos', 'bitacora', 'incidencias'].includes(tab)) setTab('midia')
  }, [perfilNav.verTodo, tab])
  const TABS = [
    { k: 'midia', l: 'Mi Día', ic: '☀️' },
    { k: 'dashboard', l: 'Dashboard', ic: '📊' },
    { k: 'metas', l: 'Metas de venta', ic: '🎯' },
    { k: 'cotizaciones', l: 'Cotizaciones', ic: '📋' },
    { k: 'vendedores', l: 'Vendedores', ic: '👤' },
    { k: 'turnos', l: 'Turnos', ic: '🗓' },
    { k: 'bitacora', l: 'Bitácora', ic: '📓' },
    { k: 'incidencias', l: 'Incidencias', ic: '🚨' },
    { k: 'reportes', l: 'Reportes', ic: '📝' },
    ...(esGerente ? [{ k: 'vambe', l: 'Vambe', ic: '💬' }] : []),
    ...(esGerente ? [{ k: 'config', l: 'Configuración', ic: '⚙️' }] : []),
  ].filter(tb => perfilNav.rol !== 'vendedor' || !['dashboard', 'reportes', 'turnos', 'bitacora', 'incidencias'].includes(tb.k))

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
          {!isMobile && <div style={{ fontSize: 10.5, color: '#9aa0c0' }}>Dashboard · metas · cotizaciones · vendedores · turnos · bitácora · incidencias</div>}
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
            {tab === 'midia' && <TabMiDia {...{ sucursales, vendedores, metas, seg, setSeg, cu, esGerente, isMobile }} />}
            {tab === 'dashboard' && perfilNav.rol !== 'vendedor' && <TabDashboard {...{ sucursales, vendedores, metas, seg, cu, esGerente, anio, setAnio, mes, setMes, feriados, isMobile }} />}
            {tab === 'metas' && <TabMetas {...{ sucursales, vendedores, feriados, metas, cu, esGerente, anio, setAnio, mes, setMes, isMobile }} />}
            {tab === 'cotizaciones' && <TabCotizaciones {...{ sucursales, vendedores, sucSel, setSucSel, seg, setSeg, cu, esGerente, isMobile }} />}
            {tab === 'vendedores' && <TabVendedores {...{ sucursales, vendedores, seg, cu, esGerente, anio, setAnio, mes, setMes, isMobile }} />}
            {tab === 'turnos' && perfilNav.rol !== 'vendedor' && <TabTurnos {...{ sucursales, vendedores, sucSel, setSucSel, anio, setAnio, mes, setMes, cu, isMobile }} />}
            {tab === 'bitacora' && perfilNav.rol !== 'vendedor' && <TabBitacora {...{ sucursales, vendedores, metas, feriados, cu, esGerente, sucSel, setSucSel, anio, setAnio, mes, setMes, isMobile }} />}
            {tab === 'reportes' && perfilNav.rol !== 'vendedor' && <TabReportes {...{ sucursales, metas, feriados, cu, anio, setAnio, mes, setMes, isMobile }} />}
            {tab === 'incidencias' && perfilNav.rol !== 'vendedor' && <TabIncidencias {...{ sucursales, sucSel, cu, isMobile }} />}
            {tab === 'vambe' && esGerente && <TabVambe {...{ cu, isMobile, vendedores, anio, setAnio, mes, setMes }} />}
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
// Perfil comercial del usuario: define qué datos puede ver en Metas.
//   gerente  → todas las sucursales
//   jefe     → su sucursal (equipo completo)
//   vendedor → solo sus propios datos
function resolverPerfil(cu, vendedores, esGerente) {
  const norm = t => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  if (esGerente) return { rol: 'gerente', vendedor: null, sucursal: null, verTodo: true }
  const nn = norm(cu?.nombre)
  const yo = vendedores.find(v => v.usuario_id && v.usuario_id === cu?.id)
    || vendedores.find(v => nn && norm(v.nombre) === nn)
    || vendedores.find(v => nn && (norm(v.nombre).includes(nn) || nn.includes(norm(v.nombre))))
  if (!yo) return { rol: 'vendedor', vendedor: null, sucursal: null, verTodo: false }
  if (yo.rol === 'jefe' || yo.rol === 'gerencia') return { rol: 'jefe', vendedor: yo, sucursal: yo.sucursal_id, verTodo: false }
  return { rol: 'vendedor', vendedor: yo, sucursal: yo.sucursal_id, verTodo: false }
}

function TabMetas({ sucursales, vendedores, feriados, metas, cu, esGerente, anio, setAnio, mes, setMes, isMobile }) {
  const [fecha, setFecha] = useState(hoy())
  const [ventas, setVentas] = useState({})   // BSALE live del día: { sucursal_id: {total, docs, ventas:[...]} }
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [vdMes, setVdMes] = useState([])      // com_ventas_dia del mes
  const [ciMes, setCiMes] = useState([])      // com_cierres del mes
  const [compMes, setCompMes] = useState([])  // com_compromisos del mes

  const perfil = useMemo(() => resolverPerfil(cu, vendedores, esGerente), [cu, vendedores, esGerente])
  const esVend = perfil.rol === 'vendedor'
  const miId = perfil.vendedor ? String(perfil.vendedor.bsale_user_id) : null

  // sucursales visibles según perfil
  const activas = useMemo(() => {
    const base = sucursales.filter(s => s.bsale_office_id && s.activa)
    if (perfil.verTodo) return base
    return base.filter(s => s.sucursal_id === perfil.sucursal)
  }, [sucursales, perfil])

  const MM = String(mes).padStart(2, '0')
  const desdeM = `${anio}-${MM}-01`
  const hastaM = `${anio}-${MM}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`

  const cargarMes = async () => {
    const [vd, ci, cp] = await Promise.all([
      supabase.from('com_ventas_dia').select('fecha,sucursal_id,venta,docs,ventas_vendedor').gte('fecha', desdeM).lte('fecha', hastaM),
      supabase.from('com_cierres').select('fecha,sucursal_id,venta_dia,meta_dia,transacciones,ventas_vendedor').gte('fecha', desdeM).lte('fecha', hastaM),
      supabase.from('com_compromisos').select('fecha,sucursal_id,bsale_user_id,vendedor,compromiso').gte('fecha', desdeM).lte('fecha', hastaM),
    ])
    setVdMes(vd.data || []); setCiMes(ci.data || []); setCompMes(cp.data || [])
  }
  useEffect(() => { cargarMes() /* eslint-disable-next-line */ }, [anio, mes])

  const cargarVentas = async () => {
    setLoading(true); setErr('')
    const out = {}
    try {
      await Promise.all(activas.map(async s => {
        try {
          const r = await callBsale('ventas_dia', { office_id: s.bsale_office_id, fecha })
          out[s.sucursal_id] = { total: r.total || 0, docs: r.docs || 0, ventas: r.ventas || [] }
        } catch (e) { out[s.sucursal_id] = { error: String(e?.message || e), total: 0, docs: 0, ventas: [] } }
      }))
      setVentas(out)
      const filas = activas.filter(s => !out[s.sucursal_id]?.error).map(s => ({
        fecha, sucursal_id: s.sucursal_id, venta: out[s.sucursal_id]?.total || 0,
        docs: out[s.sucursal_id]?.docs || 0, ventas_vendedor: out[s.sucursal_id]?.ventas || [],
        actualizado_at: new Date().toISOString(),
      }))
      if (filas.length) { const { error } = await supabase.from('com_ventas_dia').upsert(filas, { onConflict: 'fecha,sucursal_id' }); if (!error) cargarMes() }
    } catch (e) { setErr(String(e?.message || e)) }
    setLoading(false)
  }
  useEffect(() => { if (activas.length) cargarVentas() /* eslint-disable-next-line */ }, [fecha, anio, mes, perfil.rol])

  // meta mensual CORRECTA (filtrada por año+mes) y días hábiles
  const metaMes = sid => Number(metas.find(m => m.anio === anio && m.mes === mes && m.sucursal_id === sid)?.meta_clp || 0)
  const dh = sid => diasHabiles(anio, mes, shortKey(sid), feriados)
  const dhTrans = sid => diasHabilesTranscurridos(anio, mes, sid ? shortKey(sid) : 'lg', feriados)
  const metaDia = sid => { const d = dh(sid); return d > 0 ? metaMes(sid) / d : 0 }
  const nombreVend = bid => vendedores.find(v => String(v.bsale_user_id) === String(bid))?.nombre

  // ── modelo diario por sucursal (snapshot manda sobre cierre para el total) ──
  const diaBranch = useMemo(() => {
    const m = {}
    ciMes.forEach(c => { m[`${c.fecha}|${c.sucursal_id}`] = { fecha: c.fecha, suc: c.sucursal_id, venta: Number(c.venta_dia || 0), meta: Number(c.meta_dia || 0), docs: Number(c.transacciones || 0) } })
    vdMes.forEach(v => { const k = `${v.fecha}|${v.sucursal_id}`; const p = m[k] || {}; m[k] = { fecha: v.fecha, suc: v.sucursal_id, venta: Number(v.venta || 0), meta: p.meta || 0, docs: Number(v.docs || 0) || p.docs || 0 } })
    return Object.values(m)
  }, [vdMes, ciMes])

  // ── por vendedor del mes: venta/docs (cierre→snapshot) + compromiso (com_compromisos) ──
  const porVendMes = useMemo(() => {
    const ds = {}  // fecha|sid → {venta,docs,name}
    ciMes.forEach(c => Object.entries(c.ventas_vendedor || {}).forEach(([bid, v]) => { ds[`${c.fecha}|${bid}`] = { sid: String(bid), name: v.name, venta: Number(v.venta || 0), docs: Number(v.docs || 0), suc: c.sucursal_id } }))
    vdMes.forEach(v => (Array.isArray(v.ventas_vendedor) ? v.ventas_vendedor : []).forEach(x => { const k = `${v.fecha}|${x.seller_id}`; if (!ds[k]) ds[k] = { sid: String(x.seller_id), name: x.seller_name, venta: Number(x.total || 0), docs: Number(x.count || 0), suc: v.sucursal_id } }))
    const comp = {}  // fecha|sid → compromiso
    compMes.forEach(c => { comp[`${c.fecha}|${c.bsale_user_id}`] = Number(c.compromiso || 0) })
    const acc = {}
    Object.entries(ds).forEach(([k, d]) => {
      if (!acc[d.sid]) acc[d.sid] = { sid: d.sid, name: d.name || nombreVend(d.sid) || d.sid, suc: d.suc, venta: 0, docs: 0, compromiso: 0 }
      acc[d.sid].venta += d.venta; acc[d.sid].docs += d.docs; acc[d.sid].compromiso += comp[k] || 0
    })
    // compromisos de días sin venta registrada
    Object.entries(comp).forEach(([k, v]) => { const sid = k.split('|')[1]; if (!acc[sid]) { const cRow = compMes.find(x => String(x.bsale_user_id) === sid); acc[sid] = { sid, name: cRow?.vendedor || nombreVend(sid) || sid, suc: cRow?.sucursal_id, venta: 0, docs: 0, compromiso: 0 } } })
    return acc
  }, [vdMes, ciMes, compMes, vendedores])

  // resumen mensual por sucursal (métricas enriquecidas)
  const resumenSuc = sid => {
    const dias = diaBranch.filter(d => d.suc === sid)
    const venta = dias.reduce((a, d) => a + d.venta, 0)
    const docs = dias.reduce((a, d) => a + d.docs, 0)
    const meta = metaMes(sid)
    const dhT = dh(sid), dhTr = dhTrans(sid), dhRest = Math.max(0, dhT - dhTr)
    const metaFecha = dhT > 0 ? meta * (dhTr / dhT) : 0
    const gap = meta - venta
    const ritmoAct = dhTr > 0 ? venta / dhTr : 0
    const ritmoReq = dhRest > 0 ? Math.max(0, gap) / dhRest : 0
    const proy = dhTr > 0 ? (venta / dhTr) * dhT : 0
    const conVenta = dias.filter(d => d.venta > 0)
    const mejor = conVenta.length ? conVenta.reduce((a, b) => b.venta > a.venta ? b : a) : null
    const peor = conVenta.length ? conVenta.reduce((a, b) => b.venta < a.venta ? b : a) : null
    const sobreMeta = dias.filter(d => d.meta > 0 && d.venta >= d.meta).length
    const conMeta = dias.filter(d => d.meta > 0).length
    return { sid, venta, docs, meta, metaFecha, gap, ritmoAct, ritmoReq, proy, dhT, dhTr, dhRest, mejor, peor, sobreMeta, conMeta, dias: conVenta.length, ticket: docs > 0 ? venta / docs : 0, cumpFecha: pct(venta, metaFecha), cumpMes: pct(venta, meta), cumpProy: meta > 0 ? Math.round((proy / meta) * 100) : 0 }
  }

  const selStyle = { padding: '7px 10px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 13, background: '#fff' }
  const card = { background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }
  const cardT = { fontWeight: 800, fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8' }
  const anios = [anio - 1, anio, anio + 1]

  const Controles = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#8b88a8', fontWeight: 600 }}>DÍA</span>
        <input type="date" className="com-inp" style={{ width: 150 }} value={fecha} onChange={e => setFecha(e.target.value)} />
      </div>
      <select className="com-inp" style={{ width: 130 }} value={mes} onChange={e => setMes(Number(e.target.value))}>{MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
      <select className="com-inp" style={{ width: 90 }} value={anio} onChange={e => setAnio(Number(e.target.value))}>{anios.map(a => <option key={a} value={a}>{a}</option>)}</select>
      <button onClick={cargarVentas} disabled={loading} style={{ background: loading ? '#c7c5e0' : `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12.5, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>{loading ? 'Consultando BSALE…' : '↻ Actualizar ventas'}</button>
      {!perfil.verTodo && perfil.sucursal && <span style={{ fontSize: 11.5, fontWeight: 700, color: C2, background: '#f0eff7', borderRadius: 7, padding: '5px 11px' }}>{esVend ? '👤 Solo mis datos' : '🏬 Mi equipo'} · {activas[0]?.nombre || ''}</span>}
    </div>
  )

  // ═══════════════ VISTA VENDEDOR (solo sus datos) ═══════════════
  if (esVend) {
    if (!perfil.vendedor) return (<div>{Controles}<div style={{ padding: 16, background: '#FF950012', color: '#B25000', borderRadius: 10, fontSize: 12.5, fontWeight: 600 }}>No pudimos identificar tu ficha de vendedor. Pídele a tu jefe que vincule tu usuario en la pestaña Vendedores.</div></div>)
    const suc = perfil.sucursal
    const vLive = ventas[suc]?.ventas || []
    const miHoy = vLive.find(x => String(x.seller_id) === miId)
    const ventaHoy = Number(miHoy?.total || 0), docsHoy = Number(miHoy?.count || 0)
    const compHoy = Number(compMes.find(c => c.fecha === fecha && String(c.bsale_user_id) === miId)?.compromiso || 0)
    const mio = porVendMes[miId] || { venta: 0, docs: 0, compromiso: 0 }
    // trayectoria diaria (mi venta por día del mes)
    const serie = (() => {
      const m = {}
      ciMes.forEach(c => { const v = (c.ventas_vendedor || {})[miId]; if (v) m[c.fecha] = { fecha: c.fecha, venta: Number(v.venta || 0) } })
      vdMes.forEach(vd => { const x = (Array.isArray(vd.ventas_vendedor) ? vd.ventas_vendedor : []).find(y => String(y.seller_id) === miId); if (x && !m[vd.fecha]) m[vd.fecha] = { fecha: vd.fecha, venta: Number(x.total || 0) } })
      compMes.filter(c => String(c.bsale_user_id) === miId).forEach(c => { if (!m[c.fecha]) m[c.fecha] = { fecha: c.fecha, venta: 0 }; m[c.fecha].comp = Number(c.compromiso || 0) })
      return Object.values(m).sort((a, b) => a.fecha.localeCompare(b.fecha))
    })()
    const maxS = Math.max(1, ...serie.map(s => Math.max(s.venta, s.comp || 0)))
    const cumpHoy = compHoy > 0 ? pct(ventaHoy, compHoy) : null
    const cumpMesV = mio.compromiso > 0 ? pct(mio.venta, mio.compromiso) : null
    return (
      <div>
        {Controles}
        {err && <div style={{ padding: 12, background: '#FF3B3010', color: '#FF3B30', borderRadius: 10, fontSize: 12.5, marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
          <div style={{ ...card, padding: '12px 14px', borderTop: `3px solid ${cumpHoy === null ? '#c9c7dd' : colorCump(cumpHoy)}` }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>Mi venta de hoy</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{fmtK(ventaHoy)}</div>
            <div style={{ fontSize: 10.5, color: '#8b88a8' }}>{compHoy ? `compromiso ${fmtK(compHoy)} · ${cumpHoy}%` : 'sin compromiso hoy'} · {docsHoy} docs</div>
          </div>
          <KPI l="Mi venta del mes" v={fmtK(mio.venta)} c={C1} />
          <div style={{ ...card, padding: '12px 14px' }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>Cumpl. compromiso mes</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: cumpMesV === null ? '#c9c7dd' : colorCump(cumpMesV) }}>{cumpMesV === null ? '—' : cumpMesV + '%'}</div>
            <div style={{ fontSize: 10.5, color: '#8b88a8' }}>meta acumulada {fmtK(mio.compromiso)}</div>
          </div>
          <KPI l="Mi ticket promedio" v={mio.docs > 0 ? fmtK(mio.venta / mio.docs) : '—'} c="#1c1c1e" />
        </div>
        <div style={card}>
          <div style={cardT}>Mi trayectoria de {MESES[mes - 1]} <span style={{ fontWeight: 600, textTransform: 'none' }}>· <Dot c={C1} /> mi venta · <Dot c='#c9c7dd' /> mi compromiso</span></div>
          {serie.length === 0 ? <div style={{ fontSize: 12, color: '#8b88a8' }}>Sin datos del mes todavía.</div> : (
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {serie.map(s => (
                <div key={s.fecha} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 42, fontSize: 10.5, color: '#8b88a8', fontFamily: 'ui-monospace,monospace' }}>{s.fecha.slice(5)}</div>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <Bar v={(s.venta / maxS) * 100} color={s.comp && s.venta >= s.comp ? '#34C759' : C1} />
                    {s.comp > 0 && <div style={{ position: 'absolute', top: -1, bottom: -1, left: `${(s.comp / maxS) * 100}%`, width: 2, background: '#8b88a8' }} />}
                  </div>
                  <div style={{ width: 92, textAlign: 'right', fontSize: 10.5, color: '#5a5a6e', fontFamily: 'ui-monospace,monospace' }}>{fmtK(s.venta)}{s.comp ? ` / ${fmtK(s.comp)}` : ''}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: '#a6a3bd', marginTop: 8 }}>La barra se pone verde el día que superaste tu compromiso. La línea gris marca tu compromiso del día.</div>
        </div>
      </div>
    )
  }

  // ═══════════════ VISTA GERENTE / JEFE (equipo) ═══════════════
  const totalRealHoy = activas.reduce((s, x) => s + (ventas[x.sucursal_id]?.total || 0), 0)
  const totalDocsHoy = activas.reduce((s, x) => s + (ventas[x.sucursal_id]?.docs || 0), 0)
  const totalMetaDia = activas.reduce((s, x) => s + metaDia(x.sucursal_id), 0)
  const resumenes = activas.map(s => resumenSuc(s.sucursal_id))
  const gen = {
    venta: resumenes.reduce((a, r) => a + r.venta, 0), meta: resumenes.reduce((a, r) => a + r.meta, 0),
    metaFecha: resumenes.reduce((a, r) => a + r.metaFecha, 0), proy: resumenes.reduce((a, r) => a + r.proy, 0),
    docs: resumenes.reduce((a, r) => a + r.docs, 0),
  }
  gen.gap = gen.meta - gen.venta
  gen.dhRest = Math.max(0, ...resumenes.map(r => r.dhRest))
  gen.ritmoReq = gen.dhRest > 0 ? Math.max(0, gen.gap) / gen.dhRest : 0
  gen.cumpFecha = pct(gen.venta, gen.metaFecha); gen.cumpMes = pct(gen.venta, gen.meta)
  gen.cumpProy = gen.meta > 0 ? Math.round((gen.proy / gen.meta) * 100) : 0

  const rankVend = Object.values(porVendMes)
    .filter(v => !esVend)
    .filter(v => perfil.verTodo || v.suc === perfil.sucursal)
    .map(v => ({ ...v, ticket: v.docs > 0 ? v.venta / v.docs : 0, cump: v.compromiso > 0 ? pct(v.venta, v.compromiso) : null }))
    .sort((a, b) => b.venta - a.venta)

  return (
    <div>
      {Controles}
      {/* KPIs del día */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        <KPI l="Venta del día" v={fmtK(totalRealHoy)} c={C2} />
        <KPI l="Meta del día" v={fmtK(totalMetaDia)} c="#8b88a8" />
        <div style={{ ...card, padding: '12px 14px' }}>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>Cumplimiento día</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: colorCump(pct(totalRealHoy, totalMetaDia)) }}>{pct(totalRealHoy, totalMetaDia)}%</div>
        </div>
        <KPI l="Ticket promedio hoy" v={totalDocsHoy > 0 ? fmtK(totalRealHoy / totalDocsHoy) : '—'} c="#1c1c1e" />
      </div>
      {err && <div style={{ padding: 12, background: '#FF3B3010', color: '#FF3B30', borderRadius: 10, fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      {/* Panel mensual enriquecido por sucursal */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : (activas.length > 1 ? 'repeat(auto-fill,minmax(420px,1fr))' : '1fr'), gap: 12, marginBottom: 16 }}>
        {resumenes.map(r => {
          const s = activas.find(a => a.sucursal_id === r.sid)
          const serie = diaBranch.filter(d => d.suc === r.sid).sort((a, b) => a.fecha.localeCompare(b.fecha))
          const maxV = Math.max(1, ...serie.map(d => d.venta))
          return (
            <div key={r.sid} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{s?.nombre}</div>
                <div style={{ fontSize: 11, color: '#8b88a8' }}>día hábil {r.dhTr}/{r.dhT} · {r.dhRest} restantes</div>
              </div>
              {/* barras cumplimiento */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                  <span style={{ fontWeight: 700 }}>Avance a la fecha</span>
                  <span style={{ fontWeight: 800, color: colorCump(r.cumpFecha) }}>{r.cumpFecha}%</span>
                </div>
                <Bar v={r.cumpFecha} color={colorCump(r.cumpFecha)} />
                <div style={{ fontSize: 10.5, color: '#8b88a8', marginTop: 3 }}>{fmtK(r.venta)} de {fmtK(r.metaFecha)} esperado · meta mes {fmtK(r.meta)} ({r.cumpMes}%)</div>
              </div>
              {/* grilla de métricas de valor */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 10 }}>
                {[
                  ['Falta para la meta', r.gap > 0 ? fmtK(r.gap) : 'cumplida ✓', r.gap > 0 ? '#FF3B30' : '#248A3D'],
                  ['Ritmo actual/día', fmtK(r.ritmoAct), '#1c1c1e'],
                  ['Ritmo requerido/día', r.ritmoReq > 0 ? fmtK(r.ritmoReq) : '—', r.ritmoReq > r.ritmoAct * 1.15 ? '#FF3B30' : '#248A3D'],
                  ['Proyección cierre', fmtK(r.proy), colorCump(r.cumpProy)],
                  ['Días sobre meta', `${r.sobreMeta}/${r.conMeta}`, r.conMeta && r.sobreMeta / r.conMeta >= .5 ? '#248A3D' : '#FF9500'],
                  ['Ticket promedio mes', fmtK(r.ticket), '#1c1c1e'],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ background: '#faf9fd', borderRadius: 8, padding: '7px 9px' }}>
                    <div style={{ fontSize: 9.5, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700, lineHeight: 1.2 }}>{l}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: c }}>{v}</div>
                  </div>
                ))}
              </div>
              {(r.mejor || r.peor) && (
                <div style={{ fontSize: 11, color: '#5a5a6e', marginBottom: 8 }}>
                  {r.mejor && <>🔝 Mejor día: <b>{fmtFecha(r.mejor.fecha)}</b> {fmtK(r.mejor.venta)}</>}
                  {r.peor && r.peor.fecha !== r.mejor?.fecha && <> · 🔻 Más bajo: <b>{fmtFecha(r.peor.fecha)}</b> {fmtK(r.peor.venta)}</>}
                </div>
              )}
              {/* mini trayectoria */}
              {serie.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40, borderTop: '1px solid #f0eff7', paddingTop: 6 }}>
                  {serie.map(d => (
                    <div key={d.fecha} title={`${fmtFecha(d.fecha)}: ${fmt(d.venta)}`}
                      style={{ flex: 1, minWidth: 3, height: `${Math.max(3, (d.venta / maxV) * 100)}%`, background: d.meta > 0 && d.venta >= d.meta ? '#34C759' : C1, borderRadius: 2 }} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Total general (solo gerente con >1 sucursal) */}
      {perfil.verTodo && activas.length > 1 && (
        <div style={{ ...card, marginBottom: 16, borderLeft: `4px solid ${C1}` }}>
          <div style={cardT}>Total general · {MESES[mes - 1]}</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5,1fr)', gap: 10 }}>
            <KPI l="Venta acumulada" v={fmtK(gen.venta)} c={C1} />
            <div style={{ ...card, padding: '10px 12px' }}><div style={{ fontSize: 10, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>Avance a la fecha</div><div style={{ fontSize: 18, fontWeight: 800, color: colorCump(gen.cumpFecha) }}>{gen.cumpFecha}%</div></div>
            <KPI l="Falta para la meta" v={gen.gap > 0 ? fmtK(gen.gap) : '✓'} c={gen.gap > 0 ? '#FF3B30' : '#248A3D'} />
            <KPI l="Ritmo requerido/día" v={gen.ritmoReq > 0 ? fmtK(gen.ritmoReq) : '—'} c="#1c1c1e" />
            <div style={{ ...card, padding: '10px 12px' }}><div style={{ fontSize: 10, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>Proyección cierre</div><div style={{ fontSize: 18, fontWeight: 800, color: colorCump(gen.cumpProy) }}>{fmtK(gen.proy)}</div><div style={{ fontSize: 10, color: '#8b88a8' }}>{gen.cumpProy}% de meta</div></div>
          </div>
        </div>
      )}

      {/* Ranking de vendedores del mes (equipo) */}
      <div style={{ ...card, padding: 0, overflowX: 'auto', marginBottom: 16 }}>
        <div style={{ ...cardT, padding: '12px 14px 0' }}>Ranking del equipo · {MESES[mes - 1]} <span style={{ fontWeight: 600, textTransform: 'none' }}>· venta y cumplimiento de compromiso</span></div>
        <table className="com">
          <thead><tr><th style={{ textAlign: 'center' }}>#</th><th>Vendedor</th>{perfil.verTodo && <th>Sucursal</th>}<th style={{ textAlign: 'right' }}>Venta mes</th><th style={{ textAlign: 'right' }}>Docs</th><th style={{ textAlign: 'right' }}>Ticket</th><th style={{ textAlign: 'right' }}>Compromiso</th><th>Cumplimiento</th></tr></thead>
          <tbody>
            {rankVend.length === 0 ? <tr><td colSpan={perfil.verTodo ? 8 : 7} style={{ textAlign: 'center', padding: 30, color: '#8b88a8' }}>Sin ventas registradas este mes.</td></tr> : rankVend.map((v, i) => (
              <tr key={v.sid}>
                <td style={{ textAlign: 'center', fontWeight: 800, color: i < 3 ? C1 : '#8b88a8' }}>{i + 1}</td>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{v.name}</td>
                {perfil.verTodo && <td style={{ fontSize: 11.5, color: '#5a5a6e' }}>{v.suc ? shortKey(v.suc).toUpperCase() : '—'}</td>}
                <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(v.venta)}</td>
                <td style={{ textAlign: 'right', color: '#8b88a8' }}>{fN(v.docs)}</td>
                <td style={{ textAlign: 'right', color: '#5a5a6e' }}>{v.ticket > 0 ? fmtK(v.ticket) : '—'}</td>
                <td style={{ textAlign: 'right', color: '#8b88a8' }}>{v.compromiso > 0 ? fmt(v.compromiso) : '—'}</td>
                <td style={{ minWidth: 110 }}>
                  {v.cump === null ? <span style={{ fontSize: 11, color: '#c9c7dd' }}>sin compromiso</span> : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ flex: 1 }}><Bar v={v.cump} color={colorCump(v.cump)} /></div><span style={{ fontSize: 11, fontWeight: 800, color: colorCump(v.cump) }}>{v.cump}%</span></div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detalle del día por sucursal */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(360px,1fr))', gap: 14 }}>
        {activas.map(s => {
          const vv = ventas[s.sucursal_id] || {}
          const real = vv.total || 0, md = metaDia(s.sucursal_id), p = pct(real, md)
          const filas = (vv.ventas || []).filter(v => v.total !== 0).sort((a, b) => b.total - a.total)
          return (
            <div key={s.sucursal_id} style={{ background: '#fff', borderRadius: 14, border: '1px solid #eceaf6', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,.04)' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0eff7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: 13, fontWeight: 700 }}>{s.nombre} · hoy</div><div style={{ fontSize: 10.5, color: '#8b88a8' }}>meta día {fmt(md)}</div></div>
                <div style={{ fontSize: 18, fontWeight: 800, color: colorCump(p) }}>{p}%</div>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <Bar v={p} color={colorCump(p)} />
                {vv.error ? <div style={{ fontSize: 11, color: '#FF3B30', marginTop: 10 }}>⚠️ {vv.error}</div>
                  : filas.length === 0 ? <div style={{ fontSize: 11.5, color: '#8b88a8', marginTop: 10 }}>Sin ventas registradas este día.</div>
                    : (
                      <table className="com" style={{ marginTop: 10 }}>
                        <thead><tr><th>Vendedor</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Docs</th></tr></thead>
                        <tbody>{filas.map((v, i) => (<tr key={i}><td style={{ fontWeight: 600 }}>{nombreVend(v.seller_id) || v.seller_name}</td><td style={{ textAlign: 'right', fontWeight: 700, color: v.total < 0 ? '#FF3B30' : '#1c1c1e' }}>{fmt(v.total)}</td><td style={{ textAlign: 'right', color: '#8b88a8' }}>{v.count}</td></tr>))}</tbody>
                      </table>
                    )}
              </div>
            </div>
          )
        })}
      </div>

      {perfil.verTodo && sucursales.filter(s => !s.bsale_office_id).map(s => (
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
function TabCotizaciones({ sucursales, vendedores, sucSel, setSucSel, seg, setSeg, cu, esGerente, isMobile }) {
  const perfilC = resolverPerfil(cu, vendedores, esGerente)
  const esVendC = perfilC.rol === 'vendedor'
  const miIdC = perfilC.vendedor ? String(perfilC.vendedor.bsale_user_id) : null
  const hoyStr = new Date().toLocaleDateString('en-CA')
  const hace30 = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA')
  const [d1, setD1] = useState(hace30)
  const [d2, setD2] = useState(hoyStr)
  const [cots, setCots] = useState([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState('')
  const [err, setErr] = useState('')
  const [fSuc, setFSuc] = useState('')       // '' = todas
  const [fEstado, setFEstado] = useState('')
  const [fVend, setFVend] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)
  const [slaMap, setSlaMap] = useState({})   // doc_id → fecha primera gestión

  const activas = sucursales.filter(s => s.bsale_office_id && s.activa)
  // mapa office_id BSALE → sucursal
  const officeMap = useMemo(() => {
    const m = {}
    sucursales.forEach(s => { if (s.bsale_office_id) m[String(s.bsale_office_id)] = s })
    return m
  }, [sucursales])

  // ── leer desde Supabase (ya no consulta BSALE en cada carga) ──
  const cargar = async () => {
    setLoading(true); setErr('')
    try {
      let all = [], from = 0
      while (true) {
        const { data, error } = await supabase.from('com_cotizaciones').select('*')
          .gte('fecha', d1).lte('fecha', d2)
          .order('fecha_ts', { ascending: false })
          .range(from, from + 999)
        if (error) { setErr(error.message); break }
        all = all.concat(data || [])
        if (!data || data.length < 1000) break
        from += 1000
        if (from > 20000) break
      }
      setCots(all)
      // primera gestión por cotización (bitácora): base del SLA de contacto
      const ids = all.map(x => x.id)
      const sm = {}
      for (let i = 0; i < ids.length; i += 150) {
        const { data: lg } = await supabase.from('com_seguimiento_log')
          .select('doc_id,created_at,estado').in('doc_id', ids.slice(i, i + 150))
        ;(lg || []).forEach(l => {
          if (l.estado === 'sin_contactar') return
          const f = (l.created_at || '').slice(0, 10)
          if (!sm[l.doc_id] || f < sm[l.doc_id]) sm[l.doc_id] = f
        })
      }
      setSlaMap(sm)
    } finally { setLoading(false) }
  }
  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [d1, d2])

  // ── sync incremental: desde max(fecha) guardada - 3 días hasta hoy ──
  const sincronizar = async () => {
    setErr(''); setSyncing('…')
    try {
      const { data: maxRow } = await supabase.from('com_cotizaciones')
        .select('fecha').order('fecha', { ascending: false }).limit(1)
      const maxF = maxRow?.[0]?.fecha || null
      // primera vez: backfill 60 días en tramos de 15 (tope BSALE 500 docs/llamada)
      const tramos = []
      if (!maxF) {
        for (let i = 4; i >= 1; i--) {
          const a = new Date(Date.now() - i * 15 * 86400000).toLocaleDateString('en-CA')
          const b = new Date(Date.now() - (i - 1) * 15 * 86400000).toLocaleDateString('en-CA')
          tramos.push([a, b])
        }
      } else {
        const desde = new Date(new Date(maxF).getTime() - 3 * 86400000).toLocaleDateString('en-CA')
        tramos.push([desde, hoyStr])
      }
      let tot = 0
      for (let i = 0; i < tramos.length; i++) {
        setSyncing(`${i + 1}/${tramos.length}…`)
        const r = await callBsale('sync_cotizaciones', { date_from: tramos[i][0], date_to: tramos[i][1] })
        tot += r.sincronizadas || 0
        if (r.parcial) setErr(`Aviso: el tramo ${tramos[i][0]}→${tramos[i][1]} alcanzó el tope de 500 docs; sincroniza un rango más corto para completarlo.`)
      }
      setSyncing('')
      await cargar()
      if (!err) setErr('')
      return tot
    } catch (e) { setErr(String(e?.message || e)); setSyncing('') }
  }

  const segMap = useMemo(() => {
    const m = {}; seg.forEach(s => { m[s.doc_id] = s }); return m
  }, [seg])

  // shape compatible con SheetSeguimiento y la tabla
  const rows = useMemo(() => cots.map(c => {
    const s = segMap[c.id]
    const suc = officeMap[String(c.office_id)]
    return {
      id: c.id, number: c.numero, date: c.fecha, date_ts: Number(c.fecha_ts || 0), total: Number(c.total || 0),
      cliente: { name: c.cliente_nombre || 'Sin cliente', phone: c.cliente_fono || '', email: c.cliente_email || '' },
      seller: { id: c.vendedor_bsale_id, name: c.vendedor_nombre || '—' },
      office: { id: c.office_id, name: c.office_nombre || '—' },
      sucursal_id: suc?.sucursal_id || null,
      estado: s?.estado || 'sin_contactar',
      fecha_proximo: s?.fecha_proximo_contacto || '',
      obs: s?.observaciones || '',
      motivo: s?.motivo_perdida || '',
      updated_at: s?.updated_at || '',
      // SLA: días entre emisión y primera gestión (log; fallback: updated_at del seguimiento)
      dias_contacto: (() => {
        const est = s?.estado || 'sin_contactar'
        const pri = slaMap[c.id] || (est !== 'sin_contactar' && s?.updated_at ? s.updated_at.slice(0, 10) : null)
        if (!pri || !c.fecha) return null
        const [y1, m1, dd1] = c.fecha.split('-').map(Number)
        const [y2, m2, dd2] = pri.split('-').map(Number)
        return Math.round((Date.UTC(y2, m2 - 1, dd2) - Date.UTC(y1, m1 - 1, dd1)) / 86400000)
      })(),
    }
  }), [cots, segMap, officeMap, slaMap])

  const rowsV = esVendC && miIdC ? rows.filter(r => String(r.seller?.id) === miIdC) : (!perfilC.verTodo && perfilC.sucursal ? rows.filter(r => r.sucursal_id === perfilC.sucursal) : rows)
  const filtradas = rowsV.filter(r => {
    if (fSuc && r.sucursal_id !== fSuc) return false
    if (fEstado && r.estado !== fEstado) return false
    if (fVend && String(r.seller?.id) !== String(fVend)) return false
    if (q) {
      const t = q.toLowerCase()
      if (!(String(r.number).includes(t) || (r.cliente?.name || '').toLowerCase().includes(t))) return false
    }
    return true
  }).sort((a, b) => (b.date_ts || 0) - (a.date_ts || 0))

  /* KPIs sobre lo filtrado por sucursal (no por estado/búsqueda) */
  const base = rowsV.filter(r => !fSuc || r.sucursal_id === fSuc)
  const total = base.length
  const montoCotizado = base.reduce((s, r) => s + r.total, 0)
  const sinContactar = base.filter(r => r.estado === 'sin_contactar')
  const pipeline = base.filter(r => r.estado === 'contactado' || r.estado === 'en_negociacion').length
  const convertidas = base.filter(r => r.estado === 'convertida')
  const montoConvertido = convertidas.reduce((s, r) => s + r.total, 0)
  const montoRiesgo = sinContactar.reduce((s, r) => s + r.total, 0)
  const tasa = pct(convertidas.length, total)
  const abandonadas = sinContactar.filter(r => daysAgo(r.date) >= 1).length
  const vencidas = base.filter(r => r.fecha_proximo && daysAgo(r.fecha_proximo) > 0 && r.estado !== 'convertida' && r.estado !== 'perdida').length

  const vendsFiltro = esVendC ? vendedores.filter(v => String(v.bsale_user_id) === miIdC) : (!perfilC.verTodo && perfilC.sucursal ? vendedores.filter(v => v.sucursal_id === perfilC.sucursal) : (fSuc ? vendedores.filter(v => v.sucursal_id === fSuc) : vendedores))
  const preset = (dias) => { setD1(new Date(Date.now() - dias * 86400000).toLocaleDateString('en-CA')); setD2(hoyStr) }
  const chip = (label, onClick) => (
    <button key={label} onClick={onClick} style={{ background: '#f0eff7', color: C2, border: 'none', borderRadius: 7, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
  )

  return (
    <div>
      {/* Controles: rango + sync */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input type="date" className="com-inp" style={{ width: 140 }} value={d1} onChange={e => setD1(e.target.value)} />
        <span style={{ color: '#8b88a8', fontSize: 12 }}>→</span>
        <input type="date" className="com-inp" style={{ width: 140 }} value={d2} onChange={e => setD2(e.target.value)} />
        {chip('Hoy', () => { setD1(hoyStr); setD2(hoyStr) })}
        {chip('7 días', () => preset(7))}
        {chip('30 días', () => preset(30))}
        {chip('Este mes', () => { const h = new Date(); setD1(`${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-01`); setD2(hoyStr) })}
        <button onClick={sincronizar} disabled={!!syncing || loading}
          style={{ background: syncing ? '#c7c5e0' : `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12.5, fontWeight: 700, cursor: syncing ? 'default' : 'pointer', marginLeft: 'auto' }}>
          {syncing ? `Sincronizando ${syncing}` : '⟳ Sincronizar BSALE'}
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6,1fr)', gap: 10, marginBottom: 10 }}>
        <KPI l="Cotizaciones" v={fN(total)} c={C2} />
        <KPI l="Monto cotizado" v={fmtK(montoCotizado)} c={C2} />
        <KPI l="Sin contactar" v={fN(sinContactar.length)} c="#FF3B30" />
        <KPI l="En pipeline" v={fN(pipeline)} c="#007AFF" />
        <KPI l="Convertidas" v={`${fN(convertidas.length)} · ${fmtK(montoConvertido)}`} c="#34C759" />
        <KPI l="Tasa conversión" v={tasa + '%'} c={tasa >= 30 ? '#34C759' : '#FF9500'} />
      </div>
      {/* SLA de contacto 24/72/7 */}
      {(() => {
        const evaluables = base.filter(r => r.estado !== 'sin_contactar' || daysAgo(r.date) >= 1)
        const con24 = base.filter(r => r.dias_contacto !== null && r.dias_contacto <= 1).length
        const con72 = base.filter(r => r.dias_contacto !== null && r.dias_contacto <= 3).length
        const denom = evaluables.length || 1
        const p24 = Math.round((con24 / denom) * 100)
        const p72 = Math.round((con72 / denom) * 100)
        const sinDecidir7 = base.filter(r => (r.estado === 'sin_contactar' || r.estado === 'contactado' || r.estado === 'en_negociacion') && daysAgo(r.date) >= 7).length
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10, padding: '9px 14px', background: '#fff', border: '1px solid #eceaf6', borderRadius: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8' }}>SLA de contacto 24/72/7:</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: p24 >= 80 ? '#248A3D' : p24 >= 50 ? '#B25000' : '#FF3B30' }}>≤24h {p24}%</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: p72 >= 90 ? '#248A3D' : '#B25000' }}>≤72h {p72}%</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: sinDecidir7 > 0 ? '#FF3B30' : '#248A3D' }}>día 7 sin decisión: {sinDecidir7}</span>
            <span style={{ fontSize: 10.5, color: '#a6a3bd' }}>regla: contactar en 24h · 2° toque a las 72h · al día 7 se convierte, se agenda o se declara perdida</span>
          </div>
        )
      })()}
      {(montoRiesgo > 0 || vencidas > 0 || abandonadas > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {montoRiesgo > 0 && <div style={{ padding: '8px 12px', background: '#FF3B3010', color: '#FF3B30', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>⚠️ {fmt(montoRiesgo)} sin contactar ({sinContactar.length})</div>}
          {abandonadas > 0 && <div style={{ padding: '8px 12px', background: '#FF950012', color: '#B25000', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>⏰ {abandonadas} fuera de SLA (24h+ sin contacto)</div>}
          {vencidas > 0 && <div style={{ padding: '8px 12px', background: '#FF3B3010', color: '#FF3B30', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>📅 {vencidas} con próximo contacto VENCIDO</div>}
        </div>
      )}

      {/* Resumen dinámico por vendedor (responde a rango + sucursal) */}
      {!esVendC && (
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eceaf6', overflow: 'auto', marginBottom: 12 }}>
        <div style={{ padding: '10px 14px 0', fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8' }}>
          Resumen por vendedor · {fmtFecha(d1)} → {fmtFecha(d2)} <span style={{ fontWeight: 600, textTransform: 'none' }}>(clic en una fila para filtrar la lista)</span>
        </div>
        <table className="com">
          <thead><tr><th>Vendedor</th><th style={{ textAlign: 'right' }}>Cotiz.</th><th style={{ textAlign: 'right' }}>Monto cotizado</th><th style={{ textAlign: 'right' }}>Sin contactar</th><th style={{ textAlign: 'right' }}>Pipeline</th><th style={{ textAlign: 'right' }}>Convertidas</th><th style={{ textAlign: 'right' }}>Monto conv.</th><th style={{ textAlign: 'right' }}>SLA 24h</th><th>Conversión</th></tr></thead>
          <tbody>
            {(() => {
              const acc = {}
              base.forEach(r => {
                const k = String(r.seller?.id || 's/n')
                if (!acc[k]) acc[k] = { k, nombre: r.seller?.name || '—', n: 0, monto: 0, sin: 0, pipe: 0, conv: 0, montoConv: 0, sla: 0, slaDen: 0 }
                acc[k].n++; acc[k].monto += r.total
                if (r.estado !== 'sin_contactar' || daysAgo(r.date) >= 1) {
                  acc[k].slaDen++
                  if (r.dias_contacto !== null && r.dias_contacto <= 1) acc[k].sla++
                }
                if (r.estado === 'sin_contactar') acc[k].sin++
                else if (r.estado === 'contactado' || r.estado === 'en_negociacion') acc[k].pipe++
                else if (r.estado === 'convertida') { acc[k].conv++; acc[k].montoConv += r.total }
              })
              const list = Object.values(acc).map(v => ({ ...v, tasa: pct(v.conv, v.n) })).sort((a, b) => b.monto - a.monto)
              return list.map(v => (
                <tr key={v.k} className="click" onClick={() => setFVend(fVend === v.k ? '' : v.k)}
                  style={{ background: fVend === v.k ? '#5856D610' : 'transparent' }}>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{fVend === v.k ? '▸ ' : ''}{v.nombre}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fN(v.n)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(v.monto)}</td>
                  <td style={{ textAlign: 'right', color: v.sin > 0 ? '#FF3B30' : '#8b88a8', fontWeight: v.sin > 0 ? 800 : 400 }}>{v.sin || '—'}</td>
                  <td style={{ textAlign: 'right', color: '#007AFF' }}>{v.pipe || '—'}</td>
                  <td style={{ textAlign: 'right', color: '#248A3D', fontWeight: 700 }}>{v.conv || '—'}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#248A3D' }}>{v.montoConv > 0 ? fmt(v.montoConv) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: v.slaDen === 0 ? '#c9c7dd' : (v.sla / v.slaDen) >= .8 ? '#248A3D' : (v.sla / v.slaDen) >= .5 ? '#B25000' : '#FF3B30' }}>{v.slaDen === 0 ? '—' : Math.round((v.sla / v.slaDen) * 100) + '%'}</td>
                  <td style={{ minWidth: 100 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1 }}><Bar v={v.tasa} color={colorCump(v.tasa)} /></div>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{v.tasa}%</span>
                    </div>
                  </td>
                </tr>
              ))
            })()}
          </tbody>
        </table>
      </div>

      )}
      {/* Reporte: oportunidades de conversión perdidas */}
      {(() => {
        const hoyLocal = new Date().toLocaleDateString('en-CA')
        const muertas = base.filter(r => r.estado === 'sin_contactar' && daysAgo(r.date) >= 7)
        const perdidas = base.filter(r => r.estado === 'perdida')
        const vencidasL = base.filter(r => r.fecha_proximo && r.fecha_proximo < hoyLocal && r.estado !== 'convertida' && r.estado !== 'perdida')
        const mMuertas = muertas.reduce((s, r) => s + r.total, 0)
        const mPerdidas = perdidas.reduce((s, r) => s + r.total, 0)
        const mVencidas = vencidasL.reduce((s, r) => s + r.total, 0)
        if (muertas.length + perdidas.length + vencidasL.length === 0) return null
        const porVend = arr => {
          const m = {}
          arr.forEach(r => { const k = r.seller?.name || '—'; if (!m[k]) m[k] = { n: 0, monto: 0 }; m[k].n++; m[k].monto += r.total })
          return Object.entries(m).sort((a, b) => b[1].monto - a[1].monto)
        }
        const motivos = {}
        perdidas.forEach(r => { const k = r.motivo || 'sin motivo registrado'; motivos[k] = (motivos[k] || 0) + 1 })
        const copiar = () => {
          const lineas = [
            `OPORTUNIDADES DE CONVERSIÓN PERDIDAS — ${fmtFecha(d1)} a ${fmtFecha(d2)}${fSuc ? ' · ' + (activas.find(s => s.sucursal_id === fSuc)?.nombre || fSuc) : ''}`,
            ``,
            `1) SLA VENCIDO — 7+ días sin contactar (decidir hoy): ${muertas.length} por ${fmt(mMuertas)}`,
            ...porVend(muertas).slice(0, 6).map(([v, x]) => `   · ${v}: ${x.n} cotiz. — ${fmt(x.monto)}`),
            ``,
            `2) SEGUIMIENTOS VENCIDOS (compromiso de contacto incumplido): ${vencidasL.length} por ${fmt(mVencidas)}`,
            ``,
            `3) PERDIDAS DECLARADAS: ${perdidas.length} por ${fmt(mPerdidas)}`,
            ...Object.entries(motivos).sort((a, b) => b[1] - a[1]).map(([k, n]) => `   · ${k}: ${n}`),
            ``,
            `TOTAL OPORTUNIDAD EN JUEGO: ${fmt(mMuertas + mVencidas)} recuperable + ${fmt(mPerdidas)} perdido`,
          ]
          navigator.clipboard?.writeText(lineas.join('\n'))
        }
        return (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #FF3B3030', padding: '12px 16px', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#FF3B30' }}>⚠ Oportunidades de conversión perdidas</div>
              <button onClick={copiar} style={{ background: '#f0eff7', color: C2, border: 'none', borderRadius: 7, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>📋 Copiar reporte</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#FF3B30', marginBottom: 4 }}>SLA VENCIDO (7+ días sin contacto) · {muertas.length} · {fmtK(mMuertas)}</div>
                {porVend(muertas).slice(0, 5).map(([v, x]) => (
                  <div key={v} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600 }}>{v}</span><span style={{ color: '#FF3B30', fontWeight: 700 }}>{x.n} · {fmtK(x.monto)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#B25000', marginBottom: 4 }}>SEGUIMIENTOS VENCIDOS · {vencidasL.length} · {fmtK(mVencidas)}</div>
                {porVend(vencidasL).slice(0, 5).map(([v, x]) => (
                  <div key={v} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600 }}>{v}</span><span style={{ color: '#B25000', fontWeight: 700 }}>{x.n} · {fmtK(x.monto)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#8b88a8', marginBottom: 4 }}>PERDIDAS DECLARADAS · {perdidas.length} · {fmtK(mPerdidas)}</div>
                {Object.entries(motivos).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{k}</span><span style={{ fontWeight: 700 }}>{n}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 10.5, color: '#a6a3bd', marginTop: 8 }}>
              Recuperable: {fmt(mMuertas + mVencidas)} (muertas + vencidas aún abiertas) · Perdido declarado: {fmt(mPerdidas)}. "Copiar reporte" deja el resumen en el portapapeles para pegarlo en correo o WhatsApp.
            </div>
          </div>
        )
      })()}

      {/* Filtros */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {!esVendC && (
        <select className="com-inp" style={{ width: 170 }} value={perfilC.verTodo ? fSuc : (perfilC.sucursal || '')} onChange={e => { setFSuc(e.target.value); setFVend('') }} disabled={!perfilC.verTodo}>
          {perfilC.verTodo && <option value="">Todas las sucursales</option>}
          {activas.filter(s => perfilC.verTodo || s.sucursal_id === perfilC.sucursal).map(s => <option key={s.sucursal_id} value={s.sucursal_id}>{s.nombre}</option>)}
        </select>)}
        <select className="com-inp" style={{ width: 160 }} value={fEstado} onChange={e => setFEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="com-inp" style={{ width: 170 }} value={fVend} onChange={e => setFVend(e.target.value)}>
          <option value="">Todos los vendedores</option>
          {vendsFiltro.map(v => <option key={v.bsale_user_id} value={v.bsale_user_id}>{v.nombre}</option>)}
        </select>
        <input className="com-inp" style={{ flex: 1, minWidth: 160 }} placeholder="Buscar cliente o N° cotización…" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {err && <div style={{ padding: 12, background: '#FF3B3010', color: '#FF3B30', borderRadius: 10, fontSize: 12.5, marginBottom: 12 }}>{err}</div>}
      {cots.length === 0 && !loading && (
        <div style={{ padding: 12, background: '#FF950012', color: '#B25000', borderRadius: 10, fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>
          No hay cotizaciones guardadas para este rango. Usa "⟳ Sincronizar BSALE" (la primera vez trae los últimos 60 días).
        </div>
      )}

      {/* Tabla */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #eceaf6', overflow: 'auto', maxHeight: '62vh' }}>
        <table className="com">
          <thead>
            <tr>
              <th>N°</th><th>Fecha</th><th>Sucursal</th><th>Cliente</th><th>Vendedor</th>
              <th style={{ textAlign: 'right' }}>Monto</th><th>Estado</th><th>Próx. contacto</th><th>Días</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: '#8b88a8' }}>{loading ? 'Cargando…' : 'Sin cotizaciones para el filtro actual.'}</td></tr>
            ) : filtradas.map(r => {
              const d = daysAgo(r.date)
              const alerta = r.estado === 'sin_contactar' && d >= 2
              return (
                <tr key={r.id} className="click" onClick={() => setSel(r)}>
                  <td style={{ fontWeight: 700, color: C2 }}>#{r.number}</td>
                  <td>{fmtFecha(r.date)}</td>
                  <td style={{ fontSize: 11, color: '#5a5a6e' }}>{r.sucursal_id ? shortKey(r.sucursal_id).toUpperCase() : (r.office?.name || '—')}</td>
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

      {sel && <SheetSeguimiento cot={sel} onClose={() => setSel(null)} cu={cu} sucSel={sel.sucursal_id || sucSel}
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
    setErr('')
    // Reglas de método: sin próximo paso no hay negociación; sin motivo no hay pérdida
    if ((estado === 'contactado' || estado === 'en_negociacion') && !fechaProx) {
      setErr('Define la fecha del próximo contacto: una cotización en gestión sin próximo paso no se puede guardar.'); return
    }
    if (estado === 'perdida' && !motivo) {
      setErr('Selecciona el motivo de pérdida — es lo que permite aprender de las cotizaciones que se caen.'); return
    }
    setSaving(true)
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

/* ═══════════════════════════════════════════════════════════════════════════
   FASE 2 — Dashboard gerencial · Turnos referenciales · Bitácora · Incidencias
   Fuentes: com_cierres / com_aperturas / com_compromisos (histórico migrado y
   operación futura), com_turnos, com_incidencias(+log). Todo Supabase directo.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Helpers de semanas ISO (mismas semanas que usaba la app origen) ── */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil((((t - y0) / 86400000) + 1) / 7)
}
function semanasDelMes(anio, mes) {
  const out = []
  const seen = new Set()
  const last = new Date(anio, mes, 0).getDate()
  for (let d = 1; d <= last; d++) {
    const dt = new Date(anio, mes - 1, d)
    const w = isoWeek(dt)
    if (!seen.has(w)) {
      seen.add(w)
      // lunes de esa semana
      const lun = new Date(dt)
      lun.setDate(dt.getDate() - ((dt.getDay() + 6) % 7))
      out.push({ w, desde: lun.toLocaleDateString('en-CA') })
    }
  }
  return out
}
const TURNOS_OPC = ['', 'mañana', 'tarde', 'full', 'libre']
const TURNO_COLOR = { 'mañana': '#FF9500', tarde: '#5856D6', full: '#34C759', libre: '#8E8E93' }

/* ═══ TAB 0 — DASHBOARD GERENCIAL ═══ */
function TabDashboard({ sucursales, vendedores, metas, seg, cu, esGerente, anio, setAnio, mes, setMes, feriados, isMobile }) {
  const perfilD = resolverPerfil(cu, vendedores, esGerente)
  const [cierres, setCierres] = useState([])
  const [loading, setLoading] = useState(false)
  const [incAbiertas, setIncAbiertas] = useState(0)
  const [cotMes, setCotMes] = useState([])
  const [msjMes, setMsjMes] = useState([])
  const [contactosV, setContactosV] = useState([])
  const [fSuc, setFSuc] = useState(perfilD.verTodo ? '' : (perfilD.sucursal || ''))
  const mesD1 = `${anio}-${String(mes).padStart(2, '0')}-01`
  const mesD2 = new Date(anio, mes, 0).toLocaleDateString('en-CA')
  const [d1, setD1] = useState(mesD1)
  const [d2, setD2] = useState(mesD2)
  useEffect(() => { setD1(mesD1); setD2(mesD2) }, [anio, mes])
  const rangoEsMes = d1 === mesD1 && d2 === mesD2
  const desde = d1
  const hasta = d2

  useEffect(() => {
    let cancel = false
    const cargar = async () => {
      setLoading(true)
      try {
        const [ci, inc, cot, msj, cv] = await Promise.all([
          supabase.from('com_cierres').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha'),
          supabase.from('com_incidencias').select('id', { count: 'exact', head: true }).neq('estado', 'cerrada'),
          supabase.from('com_cotizaciones').select('id,total,fecha,office_id').gte('fecha', desde).lte('fecha', hasta),
          supabase.from('vambe_mensajes').select('ai_contact_id,direction,user_id,assistant_id,created_at')
            .gte('created_at', desde).lte('created_at', hasta + ' 23:59:59').order('created_at', { ascending: true }).limit(20000),
          supabase.from('vambe_contactos').select('contact_id,agent_principal'),
        ])
        if (cancel) return
        setCierres(ci.data || [])
        setIncAbiertas(inc.count || 0)
        setCotMes(cot.data || [])
        setMsjMes(msj.data || [])
        setContactosV(cv.data || [])
      } finally { if (!cancel) setLoading(false) }
    }
    cargar()
    return () => { cancel = true }
  }, [d1, d2])

  const activas = sucursales.filter(s => s.activa && (!fSuc || s.sucursal_id === fSuc))

  /* ── alertas de gestión: cotizaciones + mensajería (respetan filtro de sucursal) ── */
  const alertas = useMemo(() => {
    const segMap = {}
    seg.forEach(s => { segMap[s.doc_id] = s })
    // mapa office BSALE → sucursal, y contacto Vambe → sucursal (vía vendedor asignado)
    const officeSuc = {}
    sucursales.forEach(s => { if (s.bsale_office_id) officeSuc[String(s.bsale_office_id)] = s.sucursal_id })
    const norm = t => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const vendSuc = (vendedores || []).map(v => ({ n: norm(v.nombre), suc: v.sucursal_id }))
    const contactoSuc = {}
    contactosV.forEach(c => {
      if (!c.contact_id || !c.agent_principal) return
      const nn = norm(c.agent_principal)
      const hit = vendSuc.find(v => v.n === nn || v.n.includes(nn) || nn.includes(v.n))
      if (hit) contactoSuc[c.contact_id] = hit.suc
    })
    let cotSin = 0, cotSinMonto = 0, segVencidos = 0
    const hoyLocal = new Date().toLocaleDateString('en-CA')
    cotMes.forEach(c => {
      if (fSuc && officeSuc[String(c.office_id)] !== fSuc) return
      const s = segMap[c.id]
      const estado = s?.estado || 'sin_contactar'
      if (estado === 'sin_contactar') { cotSin++; cotSinMonto += Number(c.total || 0) }
      if (s?.fecha_proximo_contacto && s.fecha_proximo_contacto < hoyLocal && estado !== 'convertida' && estado !== 'perdida') segVencidos++
    })
    // cola de mensajería: último mensaje relevante es del cliente
    const em = m => m.direction === 'inbound' ? 'cliente' : m.assistant_id ? 'bot' : m.user_id === VAMBE_WORKSPACE ? 'auto' : 'humano'
    const porC = {}
    msjMes.forEach(m => { (porC[m.ai_contact_id] = porC[m.ai_contact_id] || []).push(m) })
    let cola = 0, nunca = 0
    Object.entries(porC).forEach(([cid, list]) => {
      if (fSuc && contactoSuc[cid] && contactoSuc[cid] !== fSuc) return
      if (fSuc && !contactoSuc[cid]) return  // sin sucursal identificable: fuera del filtro
      let lastHum = 0, lastIn = 0
      list.forEach(m => {
        const t = new Date(m.created_at).getTime()
        const e = em(m)
        if (e === 'humano' || e === 'bot') { if (t > lastHum) lastHum = t }
        else if (e === 'cliente') { if (t > lastIn) lastIn = t }
      })
      if (lastIn > lastHum) { cola++; if (!lastHum) nunca++ }
    })
    return { cotSin, cotSinMonto, segVencidos, cola, nunca }
  }, [cotMes, msjMes, seg, contactosV, fSuc, sucursales, vendedores])
  const metaMes = suc => Number(metas.find(m => m.anio === anio && m.mes === mes && m.sucursal_id === suc)?.meta_clp || 0)
  const hoy = new Date()
  const esMesFuturo = anio > hoy.getFullYear() || (anio === hoy.getFullYear() && mes > hoy.getMonth() + 1)

  const porSuc = useMemo(() => activas.map(s => {
    const cs = cierres.filter(c => c.sucursal_id === s.sucursal_id)
    const venta = cs.reduce((a, c) => a + Number(c.venta_dia || 0), 0)
    const trans = cs.reduce((a, c) => a + Number(c.transacciones || 0), 0)
    const meta = metaMes(s.sucursal_id)
    const sk = shortKey(s.sucursal_id)
    const dhTot = diasHabiles(anio, mes, sk, feriados)
    // días hábiles "transcurridos" del período: mes hasta hoy, o el rango elegido (topado a hoy)
    const dhTrans = rangoEsMes
      ? diasHabilesTranscurridos(anio, mes, sk, feriados)
      : diasHabilesRango(d1, d2, sk, feriados, true)
    const dhRest = Math.max(0, dhTot - diasHabilesTranscurridos(anio, mes, sk, feriados))
    const metaFecha = dhTot > 0 ? meta * (dhTrans / dhTot) : 0        // meta prorrateada al período
    const proy = dhTrans > 0 ? (venta / dhTrans) * dhTot : (esMesFuturo ? 0 : venta) // run-rate del período → mes
    const gap = meta - venta                                          // >0 = falta; <0 = sobre-cumple
    const ritmoActual = dhTrans > 0 ? venta / dhTrans : 0
    const ritmoReq = dhRest > 0 ? Math.max(0, gap) / dhRest : 0       // por día hábil restante
    const diasSobre = cs.filter(c => Number(c.meta_dia || 0) > 0 && Number(c.venta_dia || 0) >= Number(c.meta_dia || 0)).length
    return {
      ...s, venta, trans, meta, dias: cs.length, ticket: trans > 0 ? venta / trans : 0,
      dhTot, dhTrans, dhRest, metaFecha, proy, gap, ritmoActual, ritmoReq, diasSobre,
      cumpFecha: metaFecha > 0 ? (venta / metaFecha) * 100 : 0,
      cumpProy: meta > 0 ? (proy / meta) * 100 : 0,
    }
  }), [cierres, metas, anio, mes, sucursales, feriados, fSuc, d1, d2])

  const tot = useMemo(() => {
    const venta = porSuc.reduce((a, s) => a + s.venta, 0)
    const meta = porSuc.reduce((a, s) => a + s.meta, 0)
    const trans = porSuc.reduce((a, s) => a + s.trans, 0)
    const metaFecha = porSuc.reduce((a, s) => a + s.metaFecha, 0)
    const proy = porSuc.reduce((a, s) => a + s.proy, 0)
    const gap = meta - venta
    const dhTot = Math.max(0, ...porSuc.map(s => s.dhTot))
    const dhTrans = Math.max(0, ...porSuc.map(s => s.dhTrans))
    const dhRest = Math.max(0, dhTot - dhTrans)
    const diasConCierre = new Set(cierres.map(c => c.fecha)).size
    const diasSobre = porSuc.reduce((a, s) => a + s.diasSobre, 0)
    return {
      venta, meta, trans, metaFecha, proy, gap, dhTot, dhTrans, dhRest, diasConCierre, diasSobre,
      ritmoActual: dhTrans > 0 ? venta / dhTrans : 0,
      ritmoReq: dhRest > 0 ? Math.max(0, gap) / dhRest : 0,
      cumpFecha: metaFecha > 0 ? (venta / metaFecha) * 100 : 0,
      cumpProy: meta > 0 ? (proy / meta) * 100 : 0,
      cumpNominal: meta > 0 ? (venta / meta) * 100 : 0,
    }
  }, [porSuc, cierres])

  const totVenta = tot.venta, totMeta = tot.meta, totTrans = tot.trans

  /* ranking vendedores: agregar ventas_vendedor jsonb de todos los cierres del mes */
  const ranking = useMemo(() => {
    const acc = {}
    cierres.filter(c => !fSuc || c.sucursal_id === fSuc).forEach(c => {
      const vv = c.ventas_vendedor || {}
      Object.entries(vv).forEach(([bid, v]) => {
        if (!acc[bid]) acc[bid] = { bid, name: v.name || bid, venta: 0, docs: 0, compromiso: 0, dias: 0 }
        acc[bid].venta += Number(v.venta || 0)
        acc[bid].docs += Number(v.docs || 0)
        acc[bid].compromiso += Number(v.compromiso || 0)
        acc[bid].dias += 1
      })
    })
    return Object.values(acc).sort((a, b) => b.venta - a.venta)
  }, [cierres, fSuc])

  /* pipeline de cotizaciones del mes (por updated_at) */
  const funnel = useMemo(() => {
    const f = { sin_contactar: 0, contactado: 0, en_negociacion: 0, convertida: 0, perdida: 0, montoConv: 0 }
    seg.forEach(s => {
      const u = (s.updated_at || '').slice(0, 7)
      if (u === `${anio}-${String(mes).padStart(2, '0')}`) {
        if (f[s.estado] !== undefined) f[s.estado] += 1
        if (s.estado === 'convertida') f.montoConv += Number(s.monto_real || 0)
      }
    })
    return f
  }, [seg, anio, mes])
  const gestTot = funnel.sin_contactar + funnel.contactado + funnel.en_negociacion + funnel.convertida + funnel.perdida
  const tasaConv = gestTot > 0 ? Math.round((funnel.convertida / gestTot) * 100) : 0

  /* barras diarias */
  const porDia = useMemo(() => {
    const m = {}
    cierres.forEach(c => { m[c.fecha] = (m[c.fecha] || 0) + Number(c.venta_dia || 0) })
    return Object.entries(m).sort((a, b) => a[0] < b[0] ? -1 : 1)
  }, [cierres])
  const maxDia = Math.max(1, ...porDia.map(([, v]) => v))

  const selStyle = { padding: '7px 10px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 13, background: '#fff' }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={mes} onChange={e => setMes(Number(e.target.value))} style={selStyle}>
          {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={e => setAnio(Number(e.target.value))} style={selStyle}>
          {[anio - 1, anio, anio + 1].filter((v, i, a) => a.indexOf(v) === i).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={fSuc} onChange={e => setFSuc(e.target.value)} style={selStyle} disabled={!perfilD.verTodo}>
          {perfilD.verTodo && <option value="">Todas las sucursales</option>}
          {sucursales.filter(s => s.activa && (perfilD.verTodo || s.sucursal_id === perfilD.sucursal)).map(s => <option key={s.sucursal_id} value={s.sucursal_id}>{s.nombre}</option>)}
        </select>
        <input type="date" value={d1} onChange={e => setD1(e.target.value)} style={{ ...selStyle, width: 138 }} />
        <span style={{ color: '#8b88a8', fontSize: 12 }}>→</span>
        <input type="date" value={d2} onChange={e => setD2(e.target.value)} style={{ ...selStyle, width: 138 }} />
        {[['Hoy', 0], ['7 días', 6], ['Mes', -1]].map(([l, n]) => (
          <button key={l} onClick={() => { if (n === -1) { setD1(mesD1); setD2(mesD2) } else { const h = new Date().toLocaleDateString('en-CA'); setD1(new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA')); setD2(h) } }}
            style={{ background: '#f0eff7', color: C2, border: 'none', borderRadius: 7, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{l}</button>
        ))}
        {loading && <span style={{ fontSize: 12, color: '#8b88a8' }}>Cargando…</span>}
        {!rangoEsMes && <span style={{ fontSize: 11, color: '#B25000', fontWeight: 700 }}>Período: {d1} → {d2} (metas prorrateadas al rango)</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          ['Venta mes', fmtK(totVenta), C1],
          ['Meta mes', fmtK(totMeta), '#8b88a8'],
          ['Cumplimiento', totMeta > 0 ? pct(totVenta, totMeta) + '%' : '—', totMeta > 0 ? colorCump(tot.cumpNominal) : '#c9c7dd'],
          ['Transacciones', fN(totTrans), '#1c1c1e'],
          ['Ticket prom.', totTrans > 0 ? fmtK(totVenta / totTrans) : '—', '#1c1c1e'],
          ['Incidencias abiertas', String(incAbiertas), incAbiertas > 0 ? '#FF3B30' : '#34C759'],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', fontWeight: 700 }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* ═══ ANÁLISIS DE CUMPLIMIENTO ═══ */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8' }}>Análisis de cumplimiento</div>
          <div style={{ fontSize: 11.5, color: '#8b88a8' }}>
            {tot.dhTrans} de {tot.dhTot} días hábiles transcurridos · {tot.diasConCierre} con cierre
            {tot.dhTrans > tot.diasConCierre && <span style={{ color: '#FF9500', fontWeight: 700 }}> · {tot.dhTrans - tot.diasConCierre} día(s) hábil(es) sin cierre</span>}
          </div>
        </div>

        {totMeta === 0 ? (
          <div style={{ padding: 14, background: '#FF950012', color: '#B25000', borderRadius: 10, fontSize: 12.5, fontWeight: 600 }}>
            No hay meta cargada para {MESES[mes - 1]} {anio}. Cárgala en <strong>Metas de venta</strong> o <strong>Configuración</strong> para activar el análisis de cumplimiento (prorrateo, proyección y ritmo). Los meses con meta cargada (ej. abril/mayo) muestran el análisis completo.
          </div>
        ) : (
          <>
            {/* progreso a la fecha + proyección */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 14 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 11.5, color: '#5a5a6e', fontWeight: 700 }}>Cumplimiento a la fecha</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: colorCump(tot.cumpFecha) }}>{Math.round(tot.cumpFecha)}%</span>
                </div>
                <Bar v={tot.cumpFecha} color={colorCump(tot.cumpFecha)} />
                <div style={{ fontSize: 11, color: '#8b88a8', marginTop: 4 }}>venta {fmtK(tot.venta)} vs meta a hoy {fmtK(tot.metaFecha)}</div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <span style={{ fontSize: 11.5, color: '#5a5a6e', fontWeight: 700 }}>Proyección de cierre de mes</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: colorCump(tot.cumpProy) }}>{Math.round(tot.cumpProy)}%</span>
                </div>
                <Bar v={tot.cumpProy} color={colorCump(tot.cumpProy)} />
                <div style={{ fontSize: 11, color: '#8b88a8', marginTop: 4 }}>al ritmo actual cerraría en {fmtK(tot.proy)} vs meta {fmtK(tot.meta)}</div>
              </div>
            </div>

            {/* métricas duras */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 10 }}>
              {[
                ['Falta para la meta', tot.gap > 0 ? fmtK(tot.gap) : 'Cumplida', tot.gap > 0 ? '#FF3B30' : '#34C759', tot.gap > 0 ? `${tot.dhRest} días hábiles restantes` : `sobre-cumple ${fmtK(-tot.gap)}`],
                ['Ritmo diario actual', fmtK(tot.ritmoActual), C2, `${fmtK(tot.metaFecha / Math.max(1, tot.dhTrans))}/día requerido a hoy`],
                ['Ritmo diario requerido', tot.dhRest > 0 ? fmtK(tot.ritmoReq) : '—', tot.ritmoReq > tot.ritmoActual ? '#FF3B30' : '#34C759', tot.dhRest > 0 ? (tot.ritmoReq > tot.ritmoActual ? 'sobre el ritmo actual' : 'bajo el ritmo actual') : 'mes cerrado'],
                ['Días sobre meta', `${tot.diasSobre}/${tot.diasConCierre}`, tot.diasConCierre > 0 && tot.diasSobre / tot.diasConCierre >= 0.5 ? '#34C759' : '#FF9500', 'días que alcanzaron su meta diaria'],
              ].map(([l, v, c, sub]) => (
                <div key={l} style={{ background: '#faf9ff', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.03em', color: '#8b88a8', fontWeight: 700 }}>{l}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: c, margin: '2px 0' }}>{v}</div>
                  <div style={{ fontSize: 10, color: '#a6a3bd' }}>{sub}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${Math.max(1, porSuc.length)},1fr)`, gap: 12, marginBottom: 16 }}>
        {porSuc.map(s => (
          <div key={s.sucursal_id} style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5 }}>{s.nombre}</div>
              <div style={{ fontSize: 11, color: '#8b88a8' }}>{s.dias}/{s.dhTrans} días · ticket {s.ticket ? fmtK(s.ticket) : '—'}</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C2 }}>{fmtK(s.venta)}</div>
            <div style={{ fontSize: 11.5, color: '#8b88a8', marginBottom: 6 }}>
              {s.meta > 0 ? <>meta {fmtK(s.meta)} · a hoy {fmtK(s.metaFecha)}</> : 'sin meta cargada'}
            </div>
            <Bar v={s.cumpFecha} color={s.meta > 0 ? colorCump(s.cumpFecha) : '#e0def0'} />
            {s.meta > 0 ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, marginTop: 4 }}>
                  <span style={{ color: colorCump(s.cumpFecha) }}>{Math.round(s.cumpFecha)}% a la fecha</span>
                  <span style={{ color: colorCump(s.cumpProy) }}>proy. {Math.round(s.cumpProy)}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#8b88a8', marginTop: 4, paddingTop: 6, borderTop: '1px solid #f0eff7' }}>
                  <span>{s.gap > 0 ? <>falta <strong style={{ color: '#FF3B30' }}>{fmtK(s.gap)}</strong></> : <strong style={{ color: '#34C759' }}>meta cumplida</strong>}</span>
                  <span>ritmo {fmtK(s.ritmoActual)}{s.dhRest > 0 && <> · req {fmtK(s.ritmoReq)}</>}</span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: '#a6a3bd', marginTop: 4 }}>carga la meta para ver cumplimiento</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 12, marginBottom: 16 }}>
        {/* Venta diaria */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
          <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8' }}>Venta diaria consolidada</div>
          {porDia.length === 0 ? (
            <div style={{ color: '#8b88a8', fontSize: 12.5, padding: 20, textAlign: 'center' }}>Sin cierres registrados este mes.</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 110, overflowX: 'auto', paddingBottom: 4 }}>
              {porDia.map(([f, v]) => (
                <div key={f} title={`${fmtFecha(f)}: ${fmt(v)}`} style={{ flex: '1 0 10px', minWidth: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: '100%', height: Math.max(3, (v / maxDia) * 90), background: `linear-gradient(180deg,${C1},${C2})`, borderRadius: 3 }} />
                  <div style={{ fontSize: 8.5, color: '#b9b6d0' }}>{f.slice(8)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Alertas de gestión: cotizaciones + mensajería */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 10 }}>
          {[
            ['Cotizaciones sin contactar', `${fN(alertas.cotSin)} · ${fmtK(alertas.cotSinMonto)}`, alertas.cotSin > 0 ? '#FF3B30' : '#34C759', 'cotizaciones'],
            ['Seguimientos vencidos', fN(alertas.segVencidos), alertas.segVencidos > 0 ? '#FF9500' : '#34C759', 'cotizaciones'],
            ['Chats sin responder', fN(alertas.cola), alertas.cola > 20 ? '#FF3B30' : alertas.cola > 0 ? '#FF9500' : '#34C759', 'vambe'],
            ['Leads nunca atendidos', fN(alertas.nunca), alertas.nunca > 0 ? '#FF3B30' : '#34C759', 'vambe'],
          ].map(([l, v, c, origen]) => (
            <div key={l} style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', boxShadow: '0 1px 3px rgba(0,0,0,.05)', borderTop: `3px solid ${c}` }}>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', fontWeight: 700 }}>{l}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: c, marginTop: 2 }}>{v}</div>
              <div style={{ fontSize: 9.5, color: '#c9c7dd', marginTop: 2 }}>{origen === 'vambe' ? 'Vambe · Mensajería' : 'Cotizaciones'}</div>
            </div>
          ))}
        </div>

        {/* Funnel cotizaciones */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
          <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8' }}>Cotizaciones gestionadas en el mes</div>
          {[['sin_contactar', 'Sin contactar', '#FF3B30'], ['contactado', 'Contactadas', '#FF9500'], ['en_negociacion', 'En negociación', '#5856D6'], ['convertida', 'Convertidas', '#34C759'], ['perdida', 'Perdidas', '#8E8E93']].map(([k, l, c]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 100, fontSize: 11.5, color: '#5a5a6e' }}>{l}</div>
              <div style={{ flex: 1 }}><Bar v={gestTot > 0 ? (funnel[k] / gestTot) * 100 : 0} color={c} /></div>
              <div style={{ width: 30, textAlign: 'right', fontSize: 12, fontWeight: 700 }}>{funnel[k]}</div>
            </div>
          ))}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0eff7', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span>Tasa conversión: <strong style={{ color: '#34C759' }}>{tasaConv}%</strong></span>
            <span>Convertido: <strong>{fmtK(funnel.montoConv)}</strong></span>
          </div>
        </div>
      </div>

      {/* Ranking vendedores */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
        <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8' }}>Ranking de vendedores del mes (según cierres de tienda)</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="com">
            <thead><tr><th>#</th><th>Vendedor</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Docs</th><th style={{ textAlign: 'right' }}>Ticket</th><th style={{ textAlign: 'right' }}>Compromiso acum.</th><th>Cumpl. compromiso</th></tr></thead>
            <tbody>
              {ranking.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30, color: '#8b88a8' }}>Sin datos de vendedores este mes.</td></tr>}
              {ranking.map((v, i) => (
                <tr key={v.bid}>
                  <td style={{ fontWeight: 800, color: i < 3 ? C1 : '#8b88a8' }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{v.name}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(v.venta)}</td>
                  <td style={{ textAlign: 'right' }}>{fN(v.docs)}</td>
                  <td style={{ textAlign: 'right' }}>{v.docs > 0 ? fmtK(v.venta / v.docs) : '—'}</td>
                  <td style={{ textAlign: 'right', color: '#8b88a8' }}>{fmtK(v.compromiso)}</td>
                  <td style={{ minWidth: 120 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1 }}><Bar v={pct(v.venta, v.compromiso)} color={pct(v.venta, v.compromiso) >= 100 ? '#34C759' : '#FF9500'} /></div>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{v.compromiso > 0 ? pct(v.venta, v.compromiso) + '%' : '—'}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ═══ TAB TURNOS — matriz semanal REFERENCIAL (no vinculada a Asistencia) ═══ */
function TabTurnos({ sucursales, vendedores, sucSel, setSucSel, anio, setAnio, mes, setMes, cu, isMobile }) {
  const [turnos, setTurnos] = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const semanas = useMemo(() => semanasDelMes(anio, mes), [anio, mes])
  const vends = vendedores.filter(v => v.sucursal_id === sucSel && v.activo)

  const cargar = async () => {
    if (!sucSel) return
    setLoading(true)
    try {
      const { data } = await supabase.from('com_turnos').select('*')
        .eq('sucursal_id', sucSel).eq('anio', anio)
        .in('semana', semanas.map(s => s.w))
      setTurnos(data || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { cargar() }, [sucSel, anio, mes])

  const valorDe = (bid, w) => turnos.find(t => t.bsale_user_id === bid && t.semana === w)?.turno || ''

  const guardar = async (bid, w, turno) => {
    setMsg('')
    try {
      if (!turno) {
        await supabase.from('com_turnos').delete()
          .eq('sucursal_id', sucSel).eq('bsale_user_id', bid).eq('anio', anio).eq('semana', w)
      } else {
        const { error } = await supabase.from('com_turnos').upsert({
          sucursal_id: sucSel, bsale_user_id: bid, anio, mes, semana: w,
          turno, updated_at: new Date().toISOString(), updated_by: cu?.nombre || cu?.correo || '',
        }, { onConflict: 'sucursal_id,bsale_user_id,anio,semana' })
        if (error) throw error
      }
      await cargar()
      setMsg('Guardado ✓'); setTimeout(() => setMsg(''), 1500)
    } catch (e) { setMsg('Error: ' + (e.message || e)) }
  }

  const selStyle = { padding: '7px 10px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 13, background: '#fff' }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
        <select value={sucSel} onChange={e => setSucSel(e.target.value)} style={selStyle}>
          {sucursales.filter(s => s.activa).map(s => <option key={s.sucursal_id} value={s.sucursal_id}>{s.nombre}</option>)}
        </select>
        <select value={mes} onChange={e => setMes(Number(e.target.value))} style={selStyle}>
          {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={e => setAnio(Number(e.target.value))} style={selStyle}>
          {[anio - 1, anio, anio + 1].filter((v, i, a) => a.indexOf(v) === i).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        {loading && <span style={{ fontSize: 12, color: '#8b88a8' }}>Cargando…</span>}
        {msg && <span style={{ fontSize: 12, color: msg.startsWith('Error') ? '#FF3B30' : '#34C759', fontWeight: 700 }}>{msg}</span>}
      </div>
      <div style={{ fontSize: 11.5, color: '#8b88a8', marginBottom: 12 }}>
        Planificación <strong>referencial</strong> de turnos por semana ISO — no se vincula con el registro de Asistencia (Workera).
      </div>
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.05)', overflowX: 'auto' }}>
        <table className="com">
          <thead>
            <tr>
              <th>Vendedor</th>
              {semanas.map(s => <th key={s.w} style={{ textAlign: 'center' }}>S{s.w}<div style={{ fontWeight: 400, textTransform: 'none', fontSize: 10 }}>{fmtFecha(s.desde)}</div></th>)}
            </tr>
          </thead>
          <tbody>
            {vends.length === 0 && <tr><td colSpan={1 + semanas.length} style={{ textAlign: 'center', padding: 30, color: '#8b88a8' }}>Sin vendedores activos en esta sucursal (Configuración).</td></tr>}
            {vends.map(v => (
              <tr key={v.bsale_user_id}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{v.nombre}<div style={{ fontSize: 10.5, color: '#8b88a8' }}>{v.rol}</div></td>
                {semanas.map(s => {
                  const val = valorDe(v.bsale_user_id, s.w)
                  return (
                    <td key={s.w} style={{ textAlign: 'center' }}>
                      <select value={val} onChange={e => guardar(v.bsale_user_id, s.w, e.target.value)}
                        style={{ padding: '5px 6px', borderRadius: 7, fontSize: 12, fontWeight: 700, border: '1px solid #e0def0', background: val ? `${TURNO_COLOR[val]}18` : '#fff', color: val ? TURNO_COLOR[val] : '#8b88a8' }}>
                        {TURNOS_OPC.map(t => <option key={t} value={t}>{t || '—'}</option>)}
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ═══ TAB BITÁCORA — aperturas y cierres históricos ═══ */
function TabBitacora({ sucursales, vendedores, metas, feriados, cu, esGerente, sucSel, setSucSel, anio, setAnio, mes, setMes, isMobile }) {
  const perfilB = resolverPerfil(cu, vendedores, esGerente)
  const sucEff = perfilB.verTodo ? sucSel : (perfilB.sucursal || sucSel)
  const [aperturas, setAperturas] = useState([])
  const [cierres, setCierres] = useState([])
  const [loading, setLoading] = useState(false)
  const [det, setDet] = useState(null) // { ap, ci }
  const [abrirAp, setAbrirAp] = useState(false)
  const [abrirCi, setAbrirCi] = useState(false)
  const [reload, setReload] = useState(0)
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
  const hasta = new Date(anio, mes, 0).toLocaleDateString('en-CA')

  useEffect(() => {
    let cancel = false
    const cargar = async () => {
      if (!sucEff) return
      setLoading(true)
      try {
        const [ap, ci] = await Promise.all([
          supabase.from('com_aperturas').select('*').eq('sucursal_id', sucEff).gte('fecha', desde).lte('fecha', hasta),
          supabase.from('com_cierres').select('*').eq('sucursal_id', sucEff).gte('fecha', desde).lte('fecha', hasta),
        ])
        if (cancel) return
        setAperturas(ap.data || [])
        setCierres(ci.data || [])
      } finally { if (!cancel) setLoading(false) }
    }
    cargar()
    return () => { cancel = true }
  }, [sucEff, anio, mes, reload])

  const dias = useMemo(() => {
    const m = {}
    aperturas.forEach(a => { m[a.fecha] = { ...(m[a.fecha] || {}), ap: a } })
    cierres.forEach(c => { m[c.fecha] = { ...(m[c.fecha] || {}), ci: c } })
    return Object.entries(m).sort((a, b) => a[0] < b[0] ? 1 : -1)
  }, [aperturas, cierres])

  const selStyle = { padding: '7px 10px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 13, background: '#fff' }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={sucEff} onChange={e => setSucSel(e.target.value)} style={selStyle} disabled={!perfilB.verTodo}>
          {sucursales.filter(s => s.activa && (perfilB.verTodo || s.sucursal_id === perfilB.sucursal)).map(s => <option key={s.sucursal_id} value={s.sucursal_id}>{s.nombre}</option>)}
        </select>
        <select value={mes} onChange={e => setMes(Number(e.target.value))} style={selStyle}>
          {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={e => setAnio(Number(e.target.value))} style={selStyle}>
          {[anio - 1, anio, anio + 1].filter((v, i, a) => a.indexOf(v) === i).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        {loading && <span style={{ fontSize: 12, color: '#8b88a8' }}>Cargando…</span>}
        {(() => {
          const hoyIso = new Date().toLocaleDateString('en-CA')
          const hoyAp = aperturas.find(a => a.fecha === hoyIso)
          const hoyCi = cierres.find(x => x.fecha === hoyIso)
          return (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={() => setAbrirAp(true)}
                style={{ background: hoyAp ? '#f0eff7' : `linear-gradient(135deg,${C1},${C2})`, color: hoyAp ? C2 : '#fff', border: 'none', borderRadius: 9, padding: '8px 15px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                🌅 {hoyAp ? 'Apertura ✓' : 'Apertura de hoy'}
              </button>
              <button onClick={() => setAbrirCi(true)}
                style={{ background: hoyCi ? '#f0eff7' : `linear-gradient(135deg,${C1},${C2})`, color: hoyCi ? C2 : '#fff', border: 'none', borderRadius: 9, padding: '8px 15px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                🌙 {hoyCi ? 'Cierre ✓' : 'Cierre de hoy'}
              </button>
            </div>
          )
        })()}
      </div>

      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.05)', overflowX: 'auto' }}>
        <table className="com">
          <thead><tr><th>Fecha</th><th>Apertura</th><th>Cierre</th><th style={{ textAlign: 'right' }}>Venta día</th><th style={{ textAlign: 'right' }}>Meta día</th><th>Cumpl.</th><th style={{ textAlign: 'right' }}>Trans.</th><th style={{ textAlign: 'right' }}>Ticket</th><th style={{ textAlign: 'right' }}>Cot. conv.</th></tr></thead>
          <tbody>
            {dias.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 30, color: '#8b88a8' }}>Sin registros de apertura/cierre este mes.</td></tr>}
            {dias.map(([f, d]) => {
              const cump = d.ci ? pct(Number(d.ci.venta_dia || 0), Number(d.ci.meta_dia || 0)) : null
              return (
                <tr key={f} className="click" onClick={() => setDet(d)}>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtFecha(f)}</td>
                  <td>{d.ap ? <span style={{ fontSize: 11.5 }}><Dot c={d.ap.apertura_tardia ? '#FF9500' : '#34C759'} /> {d.ap.hora || '—'} · {d.ap.user_name || ''}</span> : <span style={{ color: '#FF3B30', fontSize: 11.5 }}>Sin apertura</span>}</td>
                  <td>{d.ci ? <span style={{ fontSize: 11.5 }}><Dot c="#34C759" /> {d.ci.hora || '—'} · {d.ci.user_name || ''}</span> : <span style={{ color: '#FF9500', fontSize: 11.5 }}>Sin cierre</span>}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{d.ci ? fmt(d.ci.venta_dia) : '—'}</td>
                  <td style={{ textAlign: 'right', color: '#8b88a8' }}>{d.ci ? fmtK(d.ci.meta_dia) : (d.ap ? fmtK(d.ap.meta_dia) : '—')}</td>
                  <td>{cump !== null ? <span style={{ fontWeight: 800, color: cump >= 100 ? '#34C759' : cump >= 80 ? '#FF9500' : '#FF3B30' }}>{cump}%</span> : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{d.ci ? fN(d.ci.transacciones) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{d.ci ? fmtK(d.ci.ticket) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{d.ci ? fN(d.ci.cot_convertidas) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {det && <SheetDia dia={det} onClose={() => setDet(null)} isMobile={isMobile} />}
    {abrirAp && (() => {
      const suc = sucursales.find(s => s.sucursal_id === sucEff)
      const hoyIso = new Date().toLocaleDateString('en-CA')
      return <SheetApertura suc={suc} vendedores={vendedores} metas={metas} feriados={feriados} cu={cu}
        hoyAp={aperturas.find(a => a.fecha === hoyIso)}
        onClose={() => setAbrirAp(false)}
        onSaved={() => { setAbrirAp(false); setReload(r => r + 1) }} />
    })()}
    {abrirCi && (() => {
      const suc = sucursales.find(s => s.sucursal_id === sucEff)
      const hoyIso = new Date().toLocaleDateString('en-CA')
      return <SheetCierre suc={suc} vendedores={vendedores} cu={cu}
        hoyAp={aperturas.find(a => a.fecha === hoyIso)}
        hoyCi={cierres.find(x => x.fecha === hoyIso)}
        onClose={() => setAbrirCi(false)}
        onSaved={() => { setAbrirCi(false); setReload(r => r + 1) }} />
    })()}
    </div>
  )
}

/* Bottom sheet con el detalle del día (checklist + ventas por vendedor) */
function SheetDia({ dia, onClose, isMobile }) {
  const { ap, ci } = dia
  const vv = ci?.ventas_vendedor || {}
  const vends = Object.entries(vv).map(([bid, v]) => ({ bid, ...v })).sort((a, b) => (b.venta || 0) - (a.venta || 0))
  const CHECK_LBL = {
    equipo: 'Equipo completo', briefing: 'Briefing realizado', meta_com: 'Meta comunicada', exhibicion: 'Exhibición OK',
    precios: 'Precios OK', pop: 'Material POP', danados: 'Productos dañados', bsale: 'BSALE operativo',
    vambe: 'Vambe operativo', caja: 'Caja OK', ilum: 'Iluminación', bodega: 'Bodega orden',
    intervenciones: 'Intervenciones', incidencias: 'Incidencias', quiebres: 'Quiebres', reposicion: 'Reposición',
    alertas_ops: 'Alertas operativas', cierre_caja: 'Cierre de caja', tienda_orden: 'Tienda en orden', desp_completados: 'Despachos completados',
  }
  const rowChk = obj => Object.entries(obj || {}).filter(([k, v]) => CHECK_LBL[k] && (v === 'si' || v === 'no')).map(([k, v]) => (
    <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '3px 8px', borderRadius: 6, background: v === 'si' ? '#34C75915' : '#FF3B3012', color: v === 'si' ? '#248A3D' : '#D70015', fontWeight: 600, margin: '0 4px 4px 0' }}>
      {v === 'si' ? '✓' : '✗'} {CHECK_LBL[k]}
    </span>
  ))
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,40,.45)', zIndex: 50, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: isMobile ? '16px 16px 0 0' : 16, width: isMobile ? '100%' : 720, maxHeight: '85vh', overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Bitácora del {fmtFecha(ap?.fecha || ci?.fecha)}</div>
          <button onClick={onClose} style={{ background: '#f0eff7', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>

        {ap && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', fontWeight: 800, marginBottom: 6 }}>Apertura · {ap.hora || ''} · {ap.user_name || ''}{ap.apertura_tardia ? ' · ⚠️ tardía' : ''}</div>
            <div style={{ fontSize: 12, marginBottom: 6 }}>Meta día: <strong>{fmtK(ap.meta_dia)}</strong> · Piso mínimo: {fmtK(ap.piso_minimo)} · Compromisos: <strong>{fmtK(ap.suma_compromisos)}</strong></div>
            <div>{rowChk(ap.checklist)}</div>
            {ap.obs && <div style={{ fontSize: 12, background: '#faf9ff', borderRadius: 8, padding: 8, marginTop: 6 }}>📝 {ap.obs}</div>}
          </div>
        )}

        {ci && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', fontWeight: 800, marginBottom: 6 }}>Cierre · {ci.hora || ''} · {ci.user_name || ''}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 8 }}>
              {[['Venta', fmt(ci.venta_dia)], ['Cumplimiento', pct(Number(ci.venta_dia || 0), Number(ci.meta_dia || 0)) + '%'], ['Transacciones', fN(ci.transacciones)], ['Ticket', fmtK(ci.ticket)]].map(([l, v]) => (
                <div key={l} style={{ background: '#faf9ff', borderRadius: 8, padding: 8 }}>
                  <div style={{ fontSize: 10, color: '#8b88a8', fontWeight: 700 }}>{l}</div>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{v}</div>
                </div>
              ))}
            </div>
            <div>{rowChk(ci.checklist)}</div>
            {ci.obs && <div style={{ fontSize: 12, background: '#faf9ff', borderRadius: 8, padding: 8, marginTop: 6 }}>📝 {ci.obs}</div>}
          </div>
        )}

        {vends.length > 0 && (
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', fontWeight: 800, marginBottom: 6 }}>Venta por vendedor (BSALE al cierre)</div>
            <table className="com">
              <thead><tr><th>Vendedor</th><th style={{ textAlign: 'right' }}>Compromiso</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Docs</th><th>Cumpl.</th></tr></thead>
              <tbody>
                {vends.map(v => {
                  const c = pct(Number(v.venta || 0), Number(v.compromiso || 0))
                  return (
                    <tr key={v.bid}>
                      <td style={{ fontWeight: 600 }}>{v.name}</td>
                      <td style={{ textAlign: 'right', color: '#8b88a8' }}>{fmtK(v.compromiso)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(v.venta)}</td>
                      <td style={{ textAlign: 'right' }}>{fN(v.docs)}</td>
                      <td><span style={{ fontWeight: 800, color: c >= 100 ? '#34C759' : c >= 80 ? '#FF9500' : '#FF3B30' }}>{v.compromiso > 0 ? c + '%' : '—'}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══ TAB INCIDENCIAS — registro + bitácora de estados ═══ */
const INC_ESTADOS = { abierta: ['#FF3B30', 'Abierta'], en_proceso: ['#FF9500', 'En proceso'], escalada: ['#5856D6', 'Escalada'], cerrada: ['#34C759', 'Cerrada'] }
const INC_TIPOS = ['caja', 'infra', 'stock', 'personal', 'cliente', 'seguridad', 'otro']
const INC_GRAV = ['baja', 'media', 'alta']

function TabIncidencias({ sucursales, sucSel, cu, isMobile }) {
  const [incs, setIncs] = useState([])
  const [loading, setLoading] = useState(false)
  const [fEstado, setFEstado] = useState('')
  const [fSuc, setFSuc] = useState('')
  const [nueva, setNueva] = useState(null)   // objeto form o null
  const [det, setDet] = useState(null)       // incidencia seleccionada

  const cargar = async () => {
    setLoading(true)
    try {
      const { data } = await supabase.from('com_incidencias').select('*').order('created_at', { ascending: false })
      setIncs(data || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { cargar() }, [])

  const filtradas = incs.filter(i => (!fEstado || i.estado === fEstado) && (!fSuc || i.sucursal_id === fSuc))

  const crear = async () => {
    if (!nueva.titulo || !nueva.sucursal_id) return
    const pref = shortKey(nueva.sucursal_id).toUpperCase()
    const nums = incs.filter(i => i.id?.startsWith(`INC-${pref}-`)).map(i => parseInt(i.id.split('-')[2]) || 0)
    const id = `INC-${pref}-${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`
    const now = new Date()
    const { error } = await supabase.from('com_incidencias').insert({
      id, sucursal_id: nueva.sucursal_id, tipo: nueva.tipo, gravedad: nueva.gravedad,
      titulo: nueva.titulo, descripcion: nueva.descripcion || null, personas: nueva.personas || null,
      accion_tomada: nueva.accion_tomada || null, escalar: nueva.gravedad === 'alta',
      estado: 'abierta', user_name: cu?.nombre || cu?.correo || '',
      fecha: now.toLocaleDateString('en-CA'), hora: now.toTimeString().slice(0, 5),
    })
    if (!error) {
      await supabase.from('com_incidencias_log').insert({ incidencia_id: id, estado: 'abierta', nota: 'Incidencia registrada.', user_name: cu?.nombre || cu?.correo || '' })
      setNueva(null); await cargar()
    }
  }

  const selStyle = { padding: '7px 10px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 13, background: '#fff' }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={fSuc} onChange={e => setFSuc(e.target.value)} style={selStyle}>
          <option value="">Todas las sucursales</option>
          {sucursales.map(s => <option key={s.sucursal_id} value={s.sucursal_id}>{s.nombre}</option>)}
        </select>
        <select value={fEstado} onChange={e => setFEstado(e.target.value)} style={selStyle}>
          <option value="">Todos los estados</option>
          {Object.entries(INC_ESTADOS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={() => setNueva({ sucursal_id: sucSel || sucursales[0]?.sucursal_id, tipo: 'otro', gravedad: 'media', titulo: '' })}
          style={{ background: `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>+ Nueva incidencia</button>
        {loading && <span style={{ fontSize: 12, color: '#8b88a8' }}>Cargando…</span>}
      </div>

      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.05)', overflowX: 'auto' }}>
        <table className="com">
          <thead><tr><th>ID</th><th>Fecha</th><th>Sucursal</th><th>Tipo</th><th>Gravedad</th><th>Título</th><th>Estado</th><th>Reportó</th></tr></thead>
          <tbody>
            {filtradas.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 30, color: '#8b88a8' }}>Sin incidencias para el filtro.</td></tr>}
            {filtradas.map(i => {
              const [c, l] = INC_ESTADOS[i.estado] || INC_ESTADOS.abierta
              return (
                <tr key={i.id} className="click" onClick={() => setDet(i)}>
                  <td style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11.5, fontWeight: 700 }}>{i.id}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtFecha(i.fecha)}</td>
                  <td>{shortKey(i.sucursal_id).toUpperCase()}</td>
                  <td>{i.tipo}</td>
                  <td><span style={{ fontWeight: 700, color: i.gravedad === 'alta' ? '#FF3B30' : i.gravedad === 'media' ? '#FF9500' : '#8E8E93' }}>{i.gravedad}</span></td>
                  <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.titulo}</td>
                  <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: c }}><Dot c={c} />{l}</span></td>
                  <td style={{ fontSize: 11.5, color: '#5a5a6e' }}>{i.user_name}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {nueva && (
        <div onClick={() => setNueva(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,40,.45)', zIndex: 50, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: isMobile ? '16px 16px 0 0' : 16, width: isMobile ? '100%' : 540, maxHeight: '85vh', overflowY: 'auto', padding: 18 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Nueva incidencia</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
              <select className="com-inp" value={nueva.sucursal_id} onChange={e => setNueva(p => ({ ...p, sucursal_id: e.target.value }))}>
                {sucursales.map(s => <option key={s.sucursal_id} value={s.sucursal_id}>{s.nombre}</option>)}
              </select>
              <select className="com-inp" value={nueva.tipo} onChange={e => setNueva(p => ({ ...p, tipo: e.target.value }))}>
                {INC_TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="com-inp" value={nueva.gravedad} onChange={e => setNueva(p => ({ ...p, gravedad: e.target.value }))}>
                {INC_GRAV.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <input className="com-inp" placeholder="Título *" value={nueva.titulo} onChange={e => setNueva(p => ({ ...p, titulo: e.target.value }))} style={{ marginBottom: 8 }} />
            <textarea className="com-inp" placeholder="Descripción" rows={3} value={nueva.descripcion || ''} onChange={e => setNueva(p => ({ ...p, descripcion: e.target.value }))} style={{ marginBottom: 8, resize: 'vertical' }} />
            <input className="com-inp" placeholder="Personas involucradas" value={nueva.personas || ''} onChange={e => setNueva(p => ({ ...p, personas: e.target.value }))} style={{ marginBottom: 8 }} />
            <textarea className="com-inp" placeholder="Acción tomada" rows={2} value={nueva.accion_tomada || ''} onChange={e => setNueva(p => ({ ...p, accion_tomada: e.target.value }))} style={{ marginBottom: 12, resize: 'vertical' }} />
            {nueva.gravedad === 'alta' && <div style={{ fontSize: 11.5, color: '#FF3B30', fontWeight: 700, marginBottom: 10 }}>⚠️ Gravedad alta escala automáticamente a gerencia.</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setNueva(null)} style={{ background: '#f0eff7', border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={crear} disabled={!nueva.titulo}
                style={{ background: nueva.titulo ? `linear-gradient(135deg,${C1},${C2})` : '#c9c7dd', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 12.5, fontWeight: 800, cursor: nueva.titulo ? 'pointer' : 'default' }}>Registrar</button>
            </div>
          </div>
        </div>
      )}

      {det && <SheetIncidencia inc={det} cu={cu} onClose={() => setDet(null)} onSaved={async () => { await cargar(); setDet(null) }} isMobile={isMobile} />}
    </div>
  )
}

/* Detalle de incidencia + cambio de estado + bitácora */
function SheetIncidencia({ inc, cu, onClose, onSaved, isMobile }) {
  const [log, setLog] = useState([])
  const [nuevoEstado, setNuevoEstado] = useState(inc.estado)
  const [nota, setNota] = useState('')
  const [resolucion, setResolucion] = useState(inc.resolucion || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('com_incidencias_log').select('*').eq('incidencia_id', inc.id).order('created_at')
      .then(({ data }) => setLog(data || []))
  }, [inc.id])

  const guardar = async () => {
    setSaving(true); setErr('')
    try {
      const upd = { estado: nuevoEstado }
      if (nuevoEstado === 'cerrada') { upd.closed_at = new Date().toISOString(); upd.resolucion = resolucion || null }
      const { error } = await supabase.from('com_incidencias').update(upd).eq('id', inc.id)
      if (error) throw error
      const { error: e2 } = await supabase.from('com_incidencias_log').insert({
        incidencia_id: inc.id, estado: nuevoEstado, nota: nota || (nuevoEstado === 'cerrada' ? 'Incidencia cerrada.' : 'Cambio de estado.'),
        user_name: cu?.nombre || cu?.correo || '',
      })
      if (e2) throw e2
      onSaved()
    } catch (e) { setErr(e.message || String(e)) } finally { setSaving(false) }
  }

  const [c, l] = INC_ESTADOS[inc.estado] || INC_ESTADOS.abierta
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,40,.45)', zIndex: 50, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: isMobile ? '16px 16px 0 0' : 16, width: isMobile ? '100%' : 620, maxHeight: '88vh', overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 800, fontSize: 14 }}>{inc.id}</div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 800, color: c }}><Dot c={c} />{l}</span>
        </div>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{inc.titulo}</div>
        <div style={{ fontSize: 11.5, color: '#8b88a8', marginBottom: 10 }}>
          {shortKey(inc.sucursal_id).toUpperCase()} · {inc.tipo} · gravedad {inc.gravedad} · {fmtFecha(inc.fecha)} {inc.hora || ''} · por {inc.user_name}
        </div>
        {inc.descripcion && <div style={{ fontSize: 12.5, background: '#faf9ff', borderRadius: 8, padding: 10, marginBottom: 8 }}>{inc.descripcion}</div>}
        {inc.personas && <div style={{ fontSize: 12, marginBottom: 4 }}><strong>Involucrados:</strong> {inc.personas}</div>}
        {inc.accion_tomada && <div style={{ fontSize: 12, marginBottom: 8 }}><strong>Acción tomada:</strong> {inc.accion_tomada}</div>}
        {inc.resolucion && <div style={{ fontSize: 12, background: '#34C75912', borderRadius: 8, padding: 8, marginBottom: 8 }}><strong>Resolución:</strong> {inc.resolucion}</div>}

        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', fontWeight: 800, margin: '12px 0 6px' }}>Bitácora</div>
        {log.map(e => (
          <div key={e.id} style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 5 }}>
            <Dot c={(INC_ESTADOS[e.estado] || ['#8E8E93'])[0]} />
            <div><strong>{(INC_ESTADOS[e.estado] || [, e.estado])[1]}</strong> — {e.nota} <span style={{ color: '#8b88a8' }}>· {e.user_name} · {(e.created_at || '').slice(0, 16).replace('T', ' ')}</span></div>
          </div>
        ))}

        {inc.estado !== 'cerrada' && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f0eff7' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginBottom: 8 }}>
              <select className="com-inp" value={nuevoEstado} onChange={e => setNuevoEstado(e.target.value)}>
                {Object.entries(INC_ESTADOS).map(([k, [, lb]]) => <option key={k} value={k}>{lb}</option>)}
              </select>
              <input className="com-inp" placeholder="Nota del cambio" value={nota} onChange={e => setNota(e.target.value)} />
            </div>
            {nuevoEstado === 'cerrada' && (
              <textarea className="com-inp" placeholder="Resolución (obligatoria para cerrar)" rows={2} value={resolucion} onChange={e => setResolucion(e.target.value)} style={{ marginBottom: 8, resize: 'vertical' }} />
            )}
            {err && <div style={{ fontSize: 12, color: '#FF3B30', marginBottom: 8 }}>{err}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={onClose} style={{ background: '#f0eff7', border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={guardar} disabled={saving || (nuevoEstado === 'cerrada' && !resolucion)}
                style={{ background: (saving || (nuevoEstado === 'cerrada' && !resolucion)) ? '#c9c7dd' : `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                {saving ? 'Guardando…' : 'Guardar cambio'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   FASE 2B — CONTROL POR VENDEDOR
   Ranking multimétrica (venta, meta individual, cumplimiento, tickets,
   cotizaciones gestionadas, conversión) + panel individual al hacer clic.
   Fuentes: com_cierres.ventas_vendedor (venta/docs/compromiso por día) +
   com_seguimiento (pipeline de cotizaciones por vendedor_bsale_id).
   Meta individual = compromiso acumulado declarado en las aperturas.
   ═══════════════════════════════════════════════════════════════════════════ */
function TabVendedores({ sucursales, vendedores, seg, cu, esGerente, anio, setAnio, mes, setMes, isMobile }) {
  const perfilV = resolverPerfil(cu, vendedores, esGerente)
  const [cierres, setCierres] = useState([])
  const [loading, setLoading] = useState(false)
  const [fSuc, setFSuc] = useState(perfilV.verTodo ? '' : (perfilV.sucursal || ''))
  const [sortBy, setSortBy] = useState('venta')
  const [sortDir, setSortDir] = useState('desc')
  const [sel, setSel] = useState(null)
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
  const hasta = new Date(anio, mes, 0).toLocaleDateString('en-CA')
  const ym = `${anio}-${String(mes).padStart(2, '0')}`

  useEffect(() => {
    let cancel = false
    const cargar = async () => {
      setLoading(true)
      try {
        const { data } = await supabase.from('com_cierres').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha')
        if (!cancel) setCierres(data || [])
      } finally { if (!cancel) setLoading(false) }
    }
    cargar()
    return () => { cancel = true }
  }, [anio, mes])

  /* Universo de vendedores: seed ∪ ids presentes en cierres ∪ ids en seguimiento */
  const filas = useMemo(() => {
    const map = {}   // bid -> agregado
    const ensure = (bid, name, suc) => {
      const k = String(bid)
      if (!map[k]) map[k] = {
        bid: k, name: name || `Vendedor ${bid}`, sucursal_id: suc || null,
        venta: 0, docs: 0, compromiso: 0, dias: 0,
        cot_gest: 0, cot_conv: 0, cot_activas: 0, cot_perdidas: 0, montoConv: 0,
        porEstado: { sin_contactar: 0, contactado: 0, en_negociacion: 0, convertida: 0, perdida: 0 },
      }
      if (name && (!map[k].name || map[k].name.startsWith('Vendedor '))) map[k].name = name
      if (suc && !map[k].sucursal_id) map[k].sucursal_id = suc
      return map[k]
    }
    // seed
    vendedores.forEach(v => ensure(v.bsale_user_id, v.nombre, v.sucursal_id))
    // ventas + tickets desde cierres
    cierres.forEach(c => {
      const vv = c.ventas_vendedor || {}
      Object.entries(vv).forEach(([bid, v]) => {
        const row = ensure(bid, v.name, c.sucursal_id)
        row.venta += Number(v.venta || 0)
        row.docs += Number(v.docs || 0)
        row.compromiso += Number(v.compromiso || 0)
        row.dias += 1
      })
    })
    // cotizaciones gestionadas en el mes (por updated_at)
    seg.forEach(s => {
      if ((s.updated_at || '').slice(0, 7) !== ym) return
      if (s.vendedor_bsale_id == null) return
      const row = ensure(s.vendedor_bsale_id, null, s.sucursal_id)
      row.cot_gest += 1
      if (row.porEstado[s.estado] !== undefined) row.porEstado[s.estado] += 1
      if (s.estado === 'convertida') { row.cot_conv += 1; row.montoConv += Number(s.monto_real || 0) }
      else if (s.estado === 'perdida') row.cot_perdidas += 1
      else row.cot_activas += 1
    })
    let arr = Object.values(map).map(r => ({
      ...r,
      cumpl: r.compromiso > 0 ? (r.venta / r.compromiso) * 100 : 0,
      ticketProm: r.docs > 0 ? r.venta / r.docs : 0,
      tasaConv: r.cot_gest > 0 ? (r.cot_conv / r.cot_gest) * 100 : 0,
    }))
    // descartar vendedores sin ninguna actividad en el período
    arr = arr.filter(r => r.venta > 0 || r.docs > 0 || r.cot_gest > 0)
    const sucVista = perfilV.verTodo ? fSuc : perfilV.sucursal
    if (sucVista) arr = arr.filter(r => r.sucursal_id === sucVista)
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => (Number(a[sortBy] || 0) - Number(b[sortBy] || 0)) * dir)
    return arr
  }, [cierres, seg, vendedores, fSuc, sortBy, sortDir, ym])

  const nombreSuc = sid => sucursales.find(s => s.sucursal_id === sid)?.nombre || (sid ? shortKey(sid).toUpperCase() : '—')
  const th = (key, label, align = 'right') => (
    <th onClick={() => { if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy(key); setSortDir('desc') } }}
      style={{ textAlign: align, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {label}{sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )
  const selStyle = { padding: '7px 10px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 13, background: '#fff' }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={perfilV.verTodo ? fSuc : (perfilV.sucursal || '')} onChange={e => setFSuc(e.target.value)} style={selStyle} disabled={!perfilV.verTodo}>
          {perfilV.verTodo && <option value="">Todas las sucursales</option>}
          {sucursales.filter(s => s.activa && (perfilV.verTodo || s.sucursal_id === perfilV.sucursal)).map(s => <option key={s.sucursal_id} value={s.sucursal_id}>{s.nombre}</option>)}
        </select>
        <select value={mes} onChange={e => setMes(Number(e.target.value))} style={selStyle}>
          {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={e => setAnio(Number(e.target.value))} style={selStyle}>
          {[anio - 1, anio, anio + 1].filter((v, i, a) => a.indexOf(v) === i).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        {loading && <span style={{ fontSize: 12, color: '#8b88a8' }}>Cargando…</span>}
        <span style={{ fontSize: 11.5, color: '#8b88a8', marginLeft: 'auto' }}>{filas.length} vendedores con actividad</span>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.05)', overflowX: 'auto' }}>
        <table className="com">
          <thead>
            <tr>
              <th style={{ textAlign: 'center' }}>#</th>
              {th('name', 'Vendedor', 'left')}
              <th style={{ textAlign: 'left' }}>Sucursal</th>
              {th('venta', 'Venta')}
              {th('compromiso', 'Meta ind.')}
              {th('cumpl', 'Cumpl.')}
              {th('docs', 'Tickets')}
              {th('ticketProm', 'Ticket prom.')}
              {th('cot_gest', 'Cotiz. gest.')}
              {th('cot_conv', 'Convert.')}
              {th('tasaConv', 'Conv.')}
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', padding: 30, color: '#8b88a8' }}>Sin actividad de vendedores en el período.</td></tr>}
            {filas.map((r, i) => (
              <tr key={r.bid} className="click" onClick={() => setSel(r)}>
                <td style={{ textAlign: 'center', fontWeight: 800, color: i < 3 && sortBy === 'venta' ? C1 : '#8b88a8' }}>{i + 1}</td>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</td>
                <td style={{ fontSize: 11.5, color: '#5a5a6e' }}>{nombreSuc(r.sucursal_id)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.venta)}</td>
                <td style={{ textAlign: 'right', color: '#8b88a8' }}>{r.compromiso > 0 ? fmtK(r.compromiso) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{r.compromiso > 0 ? <span style={{ fontWeight: 800, color: colorCump(r.cumpl) }}>{Math.round(r.cumpl)}%</span> : '—'}</td>
                <td style={{ textAlign: 'right' }}>{fN(r.docs)}</td>
                <td style={{ textAlign: 'right' }}>{r.docs > 0 ? fmtK(r.ticketProm) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{r.cot_gest || '—'}</td>
                <td style={{ textAlign: 'right', color: r.cot_conv > 0 ? '#248A3D' : '#8b88a8', fontWeight: r.cot_conv > 0 ? 700 : 400 }}>{r.cot_conv || '—'}</td>
                <td style={{ textAlign: 'right' }}>{r.cot_gest > 0 ? <span style={{ fontWeight: 700, color: colorCump(r.tasaConv) }}>{Math.round(r.tasaConv)}%</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: '#a6a3bd', marginTop: 8 }}>
        Meta individual = compromiso acumulado declarado en las aperturas. Tickets = boletas/facturas emitidas (docs BSALE al cierre). Clic en un vendedor para ver el detalle.
      </div>

      {sel && <SheetVendedor v={sel} cierres={cierres} nombreSuc={nombreSuc} onClose={() => setSel(null)} isMobile={isMobile} />}
    </div>
  )
}

/* Panel individual de control del vendedor */
function SheetVendedor({ v, cierres, nombreSuc, onClose, isMobile }) {
  /* venta diaria del vendedor desde los cierres */
  const serie = useMemo(() => {
    const out = []
    cierres.forEach(c => {
      const d = (c.ventas_vendedor || {})[v.bid]
      if (d) out.push({ fecha: c.fecha, venta: Number(d.venta || 0), docs: Number(d.docs || 0) })
    })
    return out.sort((a, b) => a.fecha < b.fecha ? -1 : 1)
  }, [cierres, v])
  const maxV = Math.max(1, ...serie.map(s => s.venta))

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,40,.45)', zIndex: 50, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: isMobile ? '16px 16px 0 0' : 16, width: isMobile ? '100%' : 760, maxHeight: '88vh', overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{v.name}</div>
            <div style={{ fontSize: 11.5, color: '#8b88a8' }}>{nombreSuc(v.sucursal_id)} · {v.dias} días con venta</div>
          </div>
          <button onClick={onClose} style={{ background: '#f0eff7', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>

        {/* Resumen */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5,1fr)', gap: 8, margin: '12px 0' }}>
          {[
            ['Venta del mes', fmtK(v.venta), C2],
            ['Meta individual', v.compromiso > 0 ? fmtK(v.compromiso) : '—', '#8b88a8'],
            ['Cumplimiento', v.compromiso > 0 ? Math.round(v.cumpl) + '%' : '—', v.compromiso > 0 ? colorCump(v.cumpl) : '#c9c7dd'],
            ['Tickets', fN(v.docs), '#1c1c1e'],
            ['Ticket prom.', v.docs > 0 ? fmtK(v.ticketProm) : '—', '#1c1c1e'],
          ].map(([l, val, c]) => (
            <div key={l} style={{ background: '#faf9ff', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.03em', color: '#8b88a8', fontWeight: 700 }}>{l}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: c, marginTop: 2 }}>{val}</div>
            </div>
          ))}
        </div>
        {v.compromiso > 0 && (
          <div style={{ marginBottom: 14 }}>
            <Bar v={v.cumpl} color={colorCump(v.cumpl)} />
            <div style={{ fontSize: 11, color: '#8b88a8', marginTop: 3 }}>{fmtK(v.venta)} de {fmtK(v.compromiso)} comprometido</div>
          </div>
        )}

        {/* Pipeline de cotizaciones */}
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', fontWeight: 800, margin: '4px 0 8px' }}>Gestión de cotizaciones del mes</div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: 14, marginBottom: 12 }}>
          <div>
            {['sin_contactar', 'contactado', 'en_negociacion', 'convertida', 'perdida'].map(k => {
              const s = ESTADOS[k]
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 110, fontSize: 11.5, color: '#5a5a6e' }}>{s.ic} {s.label}</div>
                  <div style={{ flex: 1 }}><Bar v={v.cot_gest > 0 ? (v.porEstado[k] / v.cot_gest) * 100 : 0} color={s.c} /></div>
                  <div style={{ width: 26, textAlign: 'right', fontSize: 12, fontWeight: 700 }}>{v.porEstado[k]}</div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
            <div style={{ background: '#faf9ff', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>Gestionadas / Convertidas</div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{v.cot_gest} / <span style={{ color: '#248A3D' }}>{v.cot_conv}</span></div>
              <div style={{ fontSize: 11, color: '#8b88a8' }}>tasa {Math.round(v.tasaConv)}% · activas {v.cot_activas}</div>
            </div>
            <div style={{ background: '#34C75910', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#248A3D', fontWeight: 700 }}>Monto convertido</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#248A3D' }}>{fmtK(v.montoConv)}</div>
            </div>
          </div>
        </div>

        {/* Venta diaria */}
        {serie.length > 0 && (
          <>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', fontWeight: 800, margin: '4px 0 8px' }}>Venta diaria</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 90, overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
              {serie.map(s => (
                <div key={s.fecha} title={`${fmtFecha(s.fecha)}: ${fmt(s.venta)} · ${s.docs} tickets`} style={{ flex: '1 0 12px', minWidth: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: '100%', height: Math.max(3, (s.venta / maxV) * 72), background: `linear-gradient(180deg,${C1},${C2})`, borderRadius: 3 }} />
                  <div style={{ fontSize: 8.5, color: '#b9b6d0' }}>{s.fecha.slice(8)}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Producto por categoría — Parte B (pendiente de fuente BSALE) */}
        <div style={{ background: '#f7f6ff', border: '1px dashed #d4d1ec', borderRadius: 10, padding: 12, fontSize: 11.5, color: '#6a679a' }}>
          <strong>Producto por categoría</strong> — próximamente. Requiere procesar las líneas de venta (details) de BSALE por vendedor y cruzar con las categorías del catálogo de productos.
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   FASE 2C — PUENTE VAMBE (descubrimiento)
   Consola que corre en el navegador (sin terminal): descubre las tools MCP que
   expone Vambe y permite ejecutar una para ver su JSON real. Con esa estructura
   se construyen luego las métricas de mensajería por vendedor.
   Llama a la edge function 'vambe-comercial' (puente con los secrets de Vambe).
   ═══════════════════════════════════════════════════════════════════════════ */
function VambeExplorador({ cu, isMobile }) {
  const [conn, setConn] = useState(null)
  const [tools, setTools] = useState([])
  const [selName, setSelName] = useState('')
  const [argsText, setArgsText] = useState('{}')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState('')
  const [err, setErr] = useState('')

  const call = async (payload) => {
    const { data, error } = await supabase.functions.invoke('vambe-comercial', { body: payload })
    if (error) throw new Error(error.message || 'Error invocando la función')
    if (data && data.success === false) throw new Error(data.error || 'Error Vambe')
    return data
  }
  const verificar = async () => {
    setErr(''); setLoading('ping')
    try { setConn(await call({ action: 'ping' })) }
    catch (e) { setErr(String(e.message || e)); setConn(null) }
    finally { setLoading('') }
  }
  const descubrir = async () => {
    setErr(''); setLoading('tools')
    try { const d = await call({ action: 'tools_list' }); setTools(d.tools || []); if (!d.tools?.length) setErr('Vambe respondió sin tools. Revisa API key / workspace.') }
    catch (e) { setErr(String(e.message || e)) }
    finally { setLoading('') }
  }
  const usar = (t) => {
    setSelName(t.name)
    const props = (t.inputSchema || t.input_schema || {}).properties || {}
    const tmpl = {}
    Object.keys(props).forEach(k => { tmpl[k] = props[k]?.default ?? '' })
    setArgsText(JSON.stringify(tmpl, null, 2))
    setResult(null); setErr('')
  }
  const ejecutar = async () => {
    setErr(''); setResult(null)
    let args = {}
    try { args = argsText.trim() ? JSON.parse(argsText) : {} }
    catch { setErr('Los argumentos no son JSON válido'); return }
    setLoading('call')
    try { setResult(await call({ action: 'call', name: selName, arguments: args })) }
    catch (e) { setErr(String(e.message || e)) }
    finally { setLoading('') }
  }

  // Si el resultado es una lista de objetos, se muestra como tabla
  const cd = result?.content_data
  const rows = Array.isArray(cd) ? cd
    : Array.isArray(cd?.data) ? cd.data
    : Array.isArray(cd?.items) ? cd.items
    : Array.isArray(cd?.contacts) ? cd.contacts
    : Array.isArray(cd?.results) ? cd.results : null
  const cols = rows && rows.length && rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]).slice(0, 8) : null

  const btn = (label, onClick, busy, primary) => (
    <button onClick={onClick} disabled={!!loading}
      style={{ background: primary ? `linear-gradient(135deg,${C1},${C2})` : '#fff', color: primary ? '#fff' : C2, border: primary ? 'none' : `1px solid ${C1}40`, borderRadius: 9, padding: '9px 16px', fontSize: 12.5, fontWeight: 800, cursor: loading ? 'default' : 'pointer', opacity: loading && !busy ? .5 : 1 }}>
      {busy && loading === busy ? '…' : label}
    </button>
  )

  return (
    <div>
      <div style={{ background: '#f7f6ff', border: '1px solid #e0def0', borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 4 }}>Puente Vambe · modo exploración</div>
        <div style={{ fontSize: 12, color: '#6a679a', marginBottom: 10 }}>
          Descubre las herramientas que expone Vambe y ejecútalas para inspeccionar su respuesta real. Con esa estructura se arma el dashboard de métricas de mensajería por vendedor.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {btn('Verificar conexión', verificar, 'ping')}
          {btn('Descubrir tools', descubrir, 'tools', true)}
        </div>
        {conn && (
          <div style={{ fontSize: 11.5, marginTop: 8, color: conn.secrets_ok ? '#248A3D' : '#FF3B30', fontWeight: 700 }}>
            {conn.secrets_ok ? '✓ Secrets configurados' : '✗ Faltan secrets VAMBE_API_KEY / VAMBE_WORKSPACE_ID en la edge function'} · {conn.url}
          </div>
        )}
        {err && <div style={{ fontSize: 12, marginTop: 8, color: '#FF3B30', fontWeight: 600 }}>{err}</div>}
      </div>

      {tools.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, marginBottom: 14 }}>
          {tools.map(t => (
            <div key={t.name} style={{ background: '#fff', borderRadius: 10, padding: 12, boxShadow: '0 1px 3px rgba(0,0,0,.05)', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'ui-monospace,monospace', fontWeight: 800, fontSize: 12.5, color: C2 }}>{t.name}</div>
                <div style={{ fontSize: 11.5, color: '#6a679a', marginTop: 2 }}>{t.description || '—'}</div>
                {(t.inputSchema || t.input_schema)?.properties && (
                  <div style={{ fontSize: 10.5, color: '#a6a3bd', marginTop: 4 }}>args: {Object.keys((t.inputSchema || t.input_schema).properties).join(', ') || '—'}</div>
                )}
              </div>
              <button onClick={() => usar(t)} style={{ background: selName === t.name ? C1 : '#f0eff7', color: selName === t.name ? '#fff' : C2, border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Usar</button>
            </div>
          ))}
        </div>
      )}

      {selName && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>Ejecutar <span style={{ fontFamily: 'ui-monospace,monospace', color: C2 }}>{selName}</span></div>
            {btn(loading === 'call' ? 'Ejecutando…' : 'Ejecutar', ejecutar, 'call', true)}
          </div>
          <div style={{ fontSize: 11, color: '#8b88a8', marginBottom: 4 }}>Argumentos (JSON):</div>
          <textarea value={argsText} onChange={e => setArgsText(e.target.value)} rows={4}
            style={{ width: '100%', fontFamily: 'ui-monospace,monospace', fontSize: 12, border: '1px solid #e0def0', borderRadius: 8, padding: 10, resize: 'vertical' }} />
        </div>
      )}

      {result && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
          <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8' }}>
            Respuesta {cols ? `· ${rows.length} registros` : ''}
          </div>
          {cols ? (
            <div style={{ overflowX: 'auto', maxHeight: 420 }}>
              <table className="com">
                <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={i}>{cols.map(c => <td key={c} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c] ?? '')}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, overflowX: 'auto', maxHeight: 420, background: '#faf9ff', borderRadius: 8, padding: 12 }}>
              {result.content_text || JSON.stringify(result.content_data ?? result.result, null, 2)}
            </pre>
          )}
          <div style={{ fontSize: 10.5, color: '#a6a3bd', marginTop: 8 }}>
            Copia esta respuesta (o una captura) para construir las métricas por vendedor: contactos gestionados, conversaciones, tasa de conversión, tiempos de respuesta.
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   VAMBE — Rendimiento por vendedor (lee vambe_eventos, cruza con vambe_agent_id)
   Métricas disponibles según los eventos que los Workflows estén capturando.
   Hoy: asignaciones por vendedor. Escala solo al activar más workflows
   (ticket cerrado, ingreso a etapa, etc.).
   ═══════════════════════════════════════════════════════════════════════════ */
function TabVambe({ cu, isMobile, vendedores, anio, setAnio, mes, setMes }) {
  const [modo, setModo] = useState('rendimiento')
  return (
    <div>
      <div style={{ display: 'inline-flex', background: '#eceaf6', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        {[['rendimiento', '📊 Rendimiento'], ['mensajeria', '💬 Mensajería'], ['explorar', '🔧 Explorar']].map(([k, l]) => (
          <button key={k} onClick={() => setModo(k)}
            style={{ background: modo === k ? '#fff' : 'transparent', color: modo === k ? C2 : '#8b88a8', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', boxShadow: modo === k ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}>{l}</button>
        ))}
      </div>
      {modo === 'rendimiento' && <VambeRendimiento {...{ vendedores, anio, setAnio, mes, setMes, isMobile }} />}
      {modo === 'mensajeria' && <VambeMensajeria {...{ vendedores, anio, setAnio, mes, setMes, isMobile }} />}
      {modo === 'explorar' && <VambeExplorador {...{ cu, isMobile }} />}
    </div>
  )
}

function VambeRendimiento({ vendedores, anio, setAnio, mes, setMes, isMobile }) {
  const [filas, setFilas] = useState([])
  const [loading, setLoading] = useState(false)
  const [ancla, setAncla] = useState('created')   // created = ingreso del lead · resolved = cierre
  const campoFecha = ancla === 'created' ? 'created_at' : 'resolved_at'
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
  const hastaD = new Date(anio, mes, 0)
  const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(hastaD.getDate()).padStart(2, '0')} 23:59:59`

  useEffect(() => {
    let cancel = false
    const cargar = async () => {
      setLoading(true)
      try {
        // paginación defensiva (Supabase corta en 1000 por request)
        let all = [], from = 0
        while (true) {
          const { data, error } = await supabase.from('vambe_contactos')
            .select('id,contact_id,agent_principal,pipeline,stage,channel,resolution_status,amount,created_at,resolved_at')
            .gte(campoFecha, desde).lte(campoFecha, hasta)
            .order(campoFecha, { ascending: false })
            .range(from, from + 999)
          if (error) break
          all = all.concat(data || [])
          if (!data || data.length < 1000) break
          from += 1000
          if (from > 30000) break
        }
        if (!cancel) setFilas(all)
      } finally { if (!cancel) setLoading(false) }
    }
    cargar()
    return () => { cancel = true }
  }, [anio, mes, ancla])

  // cruce nombre Vambe -> sucursal del ERP (normalizado sin tildes)
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const sucDe = useMemo(() => {
    const idx = vendedores.map(v => ({ n: norm(v.nombre), suc: v.sucursal_id }))
    return nombre => {
      const nn = norm(nombre)
      const hit = idx.find(v => v.n === nn || v.n.includes(nn) || nn.includes(v.n))
      return hit?.suc || null
    }
  }, [vendedores])

  const num = x => { const n = Number(x); return isNaN(n) ? 0 : n }

  const ranking = useMemo(() => {
    const acc = {}
    filas.forEach(r => {
      const v = r.agent_principal || 'Sin identificar'
      if (!acc[v]) acc[v] = { v, tickets: 0, won: 0, lost: 0, pending: 0, monto: 0, contactos: new Set() }
      acc[v].tickets += 1
      if (r.contact_id) acc[v].contactos.add(r.contact_id)
      const st = (r.resolution_status || '').toLowerCase()
      if (st === 'won') { acc[v].won += 1; acc[v].monto += num(r.amount) }
      else if (st === 'lost') acc[v].lost += 1
      else acc[v].pending += 1
    })
    return Object.values(acc).map(r => ({
      ...r, nContactos: r.contactos.size,
      tasa: (r.won + r.lost) > 0 ? (r.won / (r.won + r.lost)) * 100 : 0,
    })).sort((a, b) => b.tickets - a.tickets)
  }, [filas])

  const tot = useMemo(() => {
    const won = filas.filter(r => (r.resolution_status || '').toLowerCase() === 'won')
    const lost = filas.filter(r => (r.resolution_status || '').toLowerCase() === 'lost').length
    const monto = won.reduce((a, r) => a + num(r.amount), 0)
    return {
      tickets: filas.length, won: won.length, lost, monto,
      tasa: (won.length + lost) > 0 ? Math.round((won.length / (won.length + lost)) * 100) : 0,
    }
  }, [filas])

  const porClave = campo => {
    const m = {}
    filas.forEach(r => { const k = r[campo] || '—'; m[k] = (m[k] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }
  const porCanal = useMemo(() => porClave('channel').map(([k, n]) => [canalLabel(k), n]), [filas])
  const porPipe = useMemo(() => porClave('pipeline'), [filas])

  const selStyle = { padding: '7px 10px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 13, background: '#fff' }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={mes} onChange={e => setMes(Number(e.target.value))} style={selStyle}>
          {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={e => setAnio(Number(e.target.value))} style={selStyle}>
          {[anio - 1, anio, anio + 1].filter((v, i, a) => a.indexOf(v) === i).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={ancla} onChange={e => setAncla(e.target.value)} style={selStyle} title="Con qué fecha se filtra el período">
          <option value="created">Por ingreso del lead</option>
          <option value="resolved">Por fecha de cierre</option>
        </select>
        {loading && <span style={{ fontSize: 12, color: '#8b88a8' }}>Cargando…</span>}
        <span style={{ fontSize: 11.5, color: '#8b88a8', marginLeft: 'auto' }}>{filas.length} tickets en el período</span>
      </div>

      {filas.length === 0 ? (
        <div style={{ padding: 16, background: '#FF950012', color: '#B25000', borderRadius: 10, fontSize: 12.5, fontWeight: 600 }}>
          No hay tickets de Vambe en {MESES[mes - 1]} {anio} (según {ancla === 'created' ? 'fecha de ingreso' : 'fecha de cierre'}). El histórico proviene del export de Vambe; si falta un período, vuelve a exportar e importar el CSV más reciente.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
            {[
              ['Tickets', fN(tot.tickets), C1],
              ['Ganados', fN(tot.won), '#34C759'],
              ['Perdidos', fN(tot.lost), '#FF3B30'],
              ['Tasa conversión', tot.tasa + '%', colorCump(tot.tasa)],
              ['Monto ganado', fmtK(tot.monto), C2],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
                <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', fontWeight: 700 }}>{l}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: c, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,.05)', overflowX: 'auto', marginBottom: 16 }}>
            <table className="com">
              <thead><tr><th style={{ textAlign: 'center' }}>#</th><th>Vendedor</th><th>Sucursal</th><th style={{ textAlign: 'right' }}>Tickets</th><th style={{ textAlign: 'right' }}>Contactos</th><th style={{ textAlign: 'right' }}>Ganados</th><th style={{ textAlign: 'right' }}>Perdidos</th><th style={{ textAlign: 'right' }}>En curso</th><th>Conversión</th><th style={{ textAlign: 'right' }}>Monto ganado</th></tr></thead>
              <tbody>
                {ranking.map((r, i) => {
                  const suc = sucDe(r.v)
                  return (
                    <tr key={r.v}>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: i < 3 ? C1 : '#8b88a8' }}>{i + 1}</td>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.v}</td>
                      <td style={{ fontSize: 11.5, color: '#5a5a6e' }}>{suc ? shortKey(suc).toUpperCase() : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fN(r.tickets)}</td>
                      <td style={{ textAlign: 'right' }}>{fN(r.nContactos)}</td>
                      <td style={{ textAlign: 'right', color: '#248A3D', fontWeight: 700 }}>{r.won || '—'}</td>
                      <td style={{ textAlign: 'right', color: '#8b88a8' }}>{r.lost || '—'}</td>
                      <td style={{ textAlign: 'right', color: '#8b88a8' }}>{r.pending || '—'}</td>
                      <td style={{ minWidth: 110 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1 }}><Bar v={r.tasa} color={colorCump(r.tasa)} /></div>
                          <span style={{ fontSize: 11, fontWeight: 700 }}>{(r.won + r.lost) > 0 ? Math.round(r.tasa) + '%' : '—'}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.monto > 0 ? fmt(r.monto) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
            {[['Por canal', porCanal], ['Por embudo', porPipe]].map(([titulo, datos]) => (
              <div key={titulo} style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
                <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8' }}>{titulo}</div>
                {datos.map(([k, n]) => {
                  const max = Math.max(1, ...datos.map(d => d[1]))
                  return (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 150, fontSize: 11.5, color: '#5a5a6e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</div>
                      <div style={{ flex: 1 }}><Bar v={(n / max) * 100} color={C1} /></div>
                      <div style={{ width: 34, textAlign: 'right', fontSize: 12, fontWeight: 700 }}>{n}</div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, color: '#a6a3bd', marginTop: 12 }}>
            Histórico desde el export de Vambe (estado actual de cada ticket). El monto ganado sale del campo <em>amount</em> de los tickets marcados won. Para actualizar, vuelve a exportar el CSV de Vambe y re-importa; las asignaciones en vivo del workflow se ven en el modo Explorar.
          </div>
        </>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   VAMBE — Mensajería (lee vambe_mensajes)
   Métricas de mensajes entrantes/salientes: volumen diario, distribución por
   hora, humano vs automático vs bot, ranking por vendedor. Incluye botón
   "Sincronizar" que barre todos los contactos vía la edge function
   vambe-mensajes-sync (loop automático hasta done=true).
   Clasificación del emisor (verificada con datos reales):
     inbound → cliente · assistant_id → bot IA ·
     user_id = WORKSPACE → mensaje automático · resto → humano (vendedor)
   ═══════════════════════════════════════════════════════════════════════════ */
const VAMBE_WORKSPACE = '2192bb4b-026b-4f28-9da9-0bfe532666c1'

// Etiqueta legible para canales (los WhatsApp llegan como número pelado)
function canalLabel(k) {
  if (/^\d{8,}$/.test(String(k))) return `WhatsApp +${k}`
  return k
}

// Horario real Outlet: L-V 09:30–18:00 · Sáb 09:30–13:30 · Dom cerrado
function enHorarioOutlet(d) {
  const dow = d.getDay()
  const h = d.getHours() + d.getMinutes() / 60
  if (dow === 0) return false
  if (dow === 6) return h >= 9.5 && h < 13.5
  return h >= 9.5 && h < 18
}

const medianaDe = arr => {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const fmtMin = m => m === null ? '—' : m < 60 ? `${Math.round(m)} min` : m < 60 * 24 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`
const fmtHrs = h => h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`

function VambeMensajeria({ vendedores, anio, setAnio, mes, setMes, isMobile }) {
  const [filas, setFilas] = useState([])
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(false)
  const [sync, setSync] = useState(null)
  const [syncErr, setSyncErr] = useState('')
  // rango de fechas: por defecto el mes seleccionado; editable a día o rango libre
  const mesD1 = `${anio}-${String(mes).padStart(2, '0')}-01`
  const mesD2 = `${anio}-${String(mes).padStart(2, '0')}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`
  const [d1, setD1] = useState(mesD1)
  const [d2, setD2] = useState(mesD2)
  useEffect(() => { setD1(mesD1); setD2(mesD2) }, [anio, mes])
  const desde = d1
  const hasta = `${d2} 23:59:59`

  const cargar = async () => {
    setLoading(true)
    try {
      let all = [], from = 0
      while (true) {
        const { data, error } = await supabase.from('vambe_mensajes')
          .select('ai_contact_id,direction,user_id,assistant_id,created_at,body_preview')
          .gte('created_at', desde).lte('created_at', hasta)
          .order('created_at', { ascending: true })
          .range(from, from + 999)
        if (error) break
        all = all.concat(data || [])
        if (!data || data.length < 1000) break
        from += 1000
        if (from > 60000) break
      }
      setFilas(all)
      const { data: tks } = await supabase.from('vambe_contactos')
        .select('contact_id,contact_name,phone,agent_principal,resolution_status,created_at,last_message_at')
      setTickets(tks || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { cargar() }, [d1, d2])

  const sincronizar = async () => {
    setSyncErr(''); setSync({ offset: 0, total: null, mensajes: 0 })
    let offset = 0, mensajes = 0
    try {
      for (let i = 0; i < 40; i++) {
        const { data, error } = await supabase.functions.invoke('vambe-mensajes-sync', {
          body: { action: 'sync', offset, batch: 20 },
        })
        if (error) throw new Error(error.message || 'Error invocando sync')
        if (!data?.ok) throw new Error(data?.error || 'Respuesta inválida del sync')
        mensajes += data.mensajes || 0
        offset = data.siguiente_offset
        setSync({ offset, total: data.total_contactos, mensajes })
        if (data.errores?.length) setSyncErr('Avisos: ' + data.errores.join(' · '))
        if (data.done) break
      }
      await cargar()
    } catch (e) { setSyncErr(String(e.message || e)) }
    finally { setSync(null) }
  }

  const emisor = m => m.direction === 'inbound' ? 'cliente'
    : m.assistant_id ? 'bot'
    : m.user_id === VAMBE_WORKSPACE ? 'automatico' : 'humano'

  // info del contacto (nombre/teléfono/vendedor/estado del ticket más reciente)
  const infoContacto = useMemo(() => {
    const m = {}
    tickets.forEach(t => {
      if (!t.contact_id) return
      const prev = m[t.contact_id]
      if (!prev || (t.created_at || '') > (prev.created_at || '')) m[t.contact_id] = t
    })
    return m
  }, [tickets])

  const vmap = useMemo(() => {
    const m = {}
    vendedores.forEach(v => { if (v.vambe_agent_id) m[v.vambe_agent_id] = v })
    return m
  }, [vendedores])

  // conversaciones agrupadas (filas ya vienen ordenadas asc)
  const porContacto = useMemo(() => {
    const m = {}
    filas.forEach(f => { (m[f.ai_contact_id] = m[f.ai_contact_id] || []).push(f) })
    return m
  }, [filas])

  // ── MOTOR: episodios de primera respuesta ──
  // Un episodio abre con el primer mensaje del cliente sin responder y cierra
  // cuando un HUMANO (o el bot) contesta. El mensaje automático NO cierra.
  const episodios = useMemo(() => {
    const eps = []
    Object.values(porContacto).forEach(list => {
      let pendiente = null
      list.forEach(m => {
        const e = emisor(m)
        const t = new Date(m.created_at).getTime()
        if (e === 'cliente') { if (pendiente === null) pendiente = t }
        else if (e === 'humano' || e === 'bot') {
          if (pendiente !== null) {
            const min = (t - pendiente) / 60000
            if (min >= 0 && min < 60 * 24 * 21) eps.push({ min, uid: m.user_id, enHor: enHorarioOutlet(new Date(pendiente)) })
            pendiente = null
          }
        }
      })
    })
    return eps
  }, [porContacto])
  const medGlobal = medianaDe(episodios.map(e => e.min))
  const medHorario = medianaDe(episodios.filter(e => e.enHor).map(e => e.min))

  // ── MOTOR: cola sin responder (último no-auto es del cliente) ──
  const cola = useMemo(() => {
    const out = []
    Object.entries(porContacto).forEach(([cid, list]) => {
      let lastHum = null
      list.forEach(m => { const e = emisor(m); if (e === 'humano' || e === 'bot') lastHum = new Date(m.created_at).getTime() })
      let primeraEspera = null, preview = '', lastIn = null, nIn = 0
      list.forEach(m => {
        if (emisor(m) !== 'cliente') return
        const t = new Date(m.created_at).getTime()
        nIn++
        if (t > (lastHum || 0)) { if (primeraEspera === null) primeraEspera = t; lastIn = t; preview = m.body_preview || preview }
      })
      if (primeraEspera !== null) {
        const info = infoContacto[cid] || {}
        out.push({
          cid, nombre: info.contact_name || info.phone || cid.slice(0, 8) + '…',
          vend: info.agent_principal || '—', estado: info.resolution_status || '—',
          espera: (Date.now() - primeraEspera) / 3600000, nunca: lastHum === null, nIn, preview,
        })
      }
    })
    return out.sort((a, b) => b.espera - a.espera)
  }, [porContacto, infoContacto])
  const nuncaAtendidos = cola.filter(c => c.nunca)

  // ── MOTOR: ausencia enviada EN horario laboral (el hallazgo) ──
  const autoEnHorario = useMemo(() =>
    filas.filter(m => emisor(m) === 'automatico' && enHorarioOutlet(new Date(m.created_at))).length, [filas])

  // ── stats generales ──
  const stats = useMemo(() => {
    const s = { entrantes: 0, humano: 0, automatico: 0, bot: 0, contactos: new Set(), fuera: 0 }
    filas.forEach(m => {
      const e = emisor(m)
      if (e === 'cliente') { s.entrantes++; if (!enHorarioOutlet(new Date(m.created_at))) s.fuera++ }
      else s[e]++
      if (m.ai_contact_id) s.contactos.add(m.ai_contact_id)
    })
    const salientes = s.humano + s.automatico + s.bot
    return { ...s, salientes, nContactos: s.contactos.size,
      pctAusencia: salientes ? Math.round((s.automatico / salientes) * 100) : 0,
      pctFuera: s.entrantes ? Math.round((s.fuera / s.entrantes) * 100) : 0 }
  }, [filas])

  // ── aging de tickets pending ──
  const aging = useMemo(() => {
    const b = { '0-2 días': 0, '3-6 días': 0, '7-13 días': 0, '14+ días': 0 }
    const peores = []
    tickets.forEach(t => {
      if (t.resolution_status !== 'pending') return
      const ref = t.last_message_at || t.created_at
      if (!ref) return
      const dias = (Date.now() - new Date(ref).getTime()) / 86400000
      if (dias < 3) b['0-2 días']++
      else if (dias < 7) b['3-6 días']++
      else if (dias < 14) b['7-13 días']++
      else { b['14+ días']++; peores.push({ nombre: t.contact_name || t.phone || '—', vend: t.agent_principal || '—', dias: Math.floor(dias) }) }
    })
    return { buckets: Object.entries(b), peores: peores.sort((a, b2) => b2.dias - a.dias) }
  }, [tickets])

  // ── serie diaria y por hora ──
  const porDia = useMemo(() => {
    const m = {}
    filas.forEach(f => {
      const d = (f.created_at || '').slice(0, 10)
      if (!d) return
      if (!m[d]) m[d] = { d, ent: 0, sal: 0 }
      if (f.direction === 'inbound') m[d].ent++; else m[d].sal++
    })
    return Object.values(m).sort((a, b) => a.d.localeCompare(b.d))
  }, [filas])
  const porHora = useMemo(() => {
    const h = Array.from({ length: 24 }, (_, i) => ({ h: i, ent: 0, fuera: i < 9 || i >= 18 }))
    filas.forEach(f => {
      if (f.direction !== 'inbound' || !f.created_at) return
      const hr = new Date(f.created_at).getHours()
      if (h[hr]) h[hr].ent++
    })
    return h
  }, [filas])

  // ── ranking por vendedor + su mediana de 1ª respuesta ──
  const ranking = useMemo(() => {
    const acc = {}
    filas.forEach(m => {
      if (emisor(m) !== 'humano') return
      const k = m.user_id || 'sin'
      if (!acc[k]) acc[k] = { k, nombre: vmap[k]?.nombre || '(sin cruce)', suc: vmap[k]?.sucursal_id || null, msgs: 0, contactos: new Set() }
      acc[k].msgs++
      if (m.ai_contact_id) acc[k].contactos.add(m.ai_contact_id)
    })
    return Object.values(acc).map(r => ({ ...r, nCont: r.contactos.size,
      porCont: r.contactos.size ? (r.msgs / r.contactos.size) : 0,
      med1r: medianaDe(episodios.filter(e => e.uid === r.k).map(e => e.min)) }))
      .sort((a, b) => b.msgs - a.msgs)
  }, [filas, vmap, episodios])

  const selStyle = { padding: '7px 10px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 13, background: '#fff' }
  const maxDia = Math.max(1, ...porDia.map(x => Math.max(x.ent, x.sal)))
  const maxHora = Math.max(1, ...porHora.map(x => x.ent))
  const maxBucket = Math.max(1, ...aging.buckets.map(([, n]) => n))
  const cardT = { fontWeight: 800, fontSize: 12.5, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8' }
  const card = { background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={mes} onChange={e => setMes(Number(e.target.value))} style={selStyle}>
          {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select value={anio} onChange={e => setAnio(Number(e.target.value))} style={selStyle}>
          {[anio - 1, anio, anio + 1].filter((v, i, a) => a.indexOf(v) === i).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="date" value={d1} onChange={e => setD1(e.target.value)} style={{ ...selStyle, width: 138 }} />
        <span style={{ color: '#8b88a8', fontSize: 12 }}>→</span>
        <input type="date" value={d2} onChange={e => setD2(e.target.value)} style={{ ...selStyle, width: 138 }} />
        {[['Hoy', 0], ['7 días', 6], ['14 días', 13]].map(([l, n]) => (
          <button key={l} onClick={() => { const h = new Date().toLocaleDateString('en-CA'); setD1(new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA')); setD2(h) }}
            style={{ background: '#f0eff7', color: C2, border: 'none', borderRadius: 7, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>{l}</button>
        ))}
        <button onClick={sincronizar} disabled={!!sync || loading}
          style={{ background: sync ? '#eceaf6' : `linear-gradient(135deg,${C1},${C2})`, color: sync ? C2 : '#fff', border: 'none', borderRadius: 9, padding: '8px 16px', fontSize: 12.5, fontWeight: 800, cursor: sync ? 'default' : 'pointer' }}>
          {sync ? `Sincronizando… ${sync.offset}${sync.total ? '/' + sync.total : ''} (${fN(sync.mensajes)} msgs)` : '⟳ Sincronizar con Vambe'}
        </button>
        {loading && <span style={{ fontSize: 12, color: '#8b88a8' }}>Cargando…</span>}
        <span style={{ fontSize: 11.5, color: '#8b88a8', marginLeft: 'auto' }}>{fN(filas.length)} mensajes · horario L-V 09:30–18:00 · Sáb 09:30–13:30</span>
      </div>
      {syncErr && <div style={{ fontSize: 11.5, color: '#B25000', marginBottom: 10, fontWeight: 600 }}>{syncErr}</div>}

      {filas.length === 0 && !loading ? (
        <div style={{ padding: 16, background: '#FF950012', color: '#B25000', borderRadius: 10, fontSize: 12.5, fontWeight: 600 }}>
          No hay mensajes en {MESES[mes - 1]} {anio}. Usa "Sincronizar con Vambe" para traer las conversaciones más recientes.
        </div>
      ) : (
        <>
          {/* KPIs volumen */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5,1fr)', gap: 10, marginBottom: 10 }}>
            {[
              ['Entrantes (clientes)', fN(stats.entrantes), C1],
              ['Respuestas humanas', fN(stats.humano), '#34C759'],
              ['Resp. de ausencia', fN(stats.automatico), '#FF9500'],
              ['% resp. ausencia', stats.pctAusencia + '%', stats.pctAusencia > 50 ? '#FF9500' : '#1c1c1e'],
              ['Contactos activos', fN(stats.nContactos), '#1c1c1e'],
            ].map(([l, v, c]) => (
              <div key={l} style={{ ...card, padding: '12px 14px' }}>
                <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', fontWeight: 700 }}>{l}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: c, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* KPIs gestión */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
            {[
              ['1ª respuesta (mediana)', fmtMin(medGlobal), '#1c1c1e'],
              ['1ª resp. en horario', fmtMin(medHorario), medHorario !== null && medHorario > 30 ? '#FF3B30' : '#34C759'],
              ['Sin responder ahora', fN(cola.length), cola.length > 20 ? '#FF3B30' : cola.length > 0 ? '#FF9500' : '#34C759'],
              ['Nunca atendidos', fN(nuncaAtendidos.length), nuncaAtendidos.length > 0 ? '#FF3B30' : '#34C759'],
              ['Ausencia EN horario ⚠', fN(autoEnHorario), autoEnHorario > 0 ? '#FF3B30' : '#34C759'],
            ].map(([l, v, c]) => (
              <div key={l} style={{ ...card, padding: '12px 14px', borderTop: `3px solid ${c}` }}>
                <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', fontWeight: 700 }}>{l}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: c, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* GESTIÓN: cola + aging */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={card}>
              <div style={cardT}>Cola sin responder · el último mensaje es del cliente ({cola.length})</div>
              {cola.length === 0 ? (
                <div style={{ fontSize: 12.5, color: '#248A3D', fontWeight: 700 }}>✓ Sin pendientes — todo respondido</div>
              ) : (
                <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                  <table className="com">
                    <thead><tr><th>Cliente</th><th>Vendedor</th><th>Estado</th><th style={{ textAlign: 'right' }}>Esperando</th><th>Último mensaje</th></tr></thead>
                    <tbody>
                      {cola.slice(0, 40).map(c => (
                        <tr key={c.cid}>
                          <td style={{ fontWeight: 600, whiteSpace: 'nowrap', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {c.nombre}{c.nunca && <span style={{ marginLeft: 6, fontSize: 9, background: '#FF3B3018', color: '#FF3B30', borderRadius: 4, padding: '1px 5px', fontWeight: 800 }}>NUNCA ATENDIDO</span>}
                          </td>
                          <td style={{ fontSize: 11.5, color: '#5a5a6e', whiteSpace: 'nowrap' }}>{c.vend}</td>
                          <td style={{ fontSize: 10.5 }}>
                            <span style={{ padding: '2px 7px', borderRadius: 5, fontWeight: 800, fontSize: 10,
                              color: c.estado === 'won' ? '#248A3D' : c.estado === 'lost' ? '#8b88a8' : '#B25000',
                              background: c.estado === 'won' ? '#34C75918' : c.estado === 'lost' ? '#8b88a818' : '#FF950018' }}>
                              {c.estado === 'won' ? 'GANADO' : c.estado === 'lost' ? 'PERDIDO' : c.estado === 'pending' ? 'EN CURSO' : c.estado.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 800, color: c.espera > 24 ? '#FF3B30' : c.espera > 4 ? '#FF9500' : '#1c1c1e', whiteSpace: 'nowrap' }}>{fmtHrs(c.espera)}</td>
                          <td style={{ fontSize: 11, color: '#8b88a8', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.preview}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={card}>
              <div style={cardT}>Tickets "en curso" sin movimiento (aging)</div>
              {aging.buckets.map(([b, n]) => (
                <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 70, fontSize: 11.5, color: b === '14+ días' ? '#FF3B30' : '#5a5a6e', fontWeight: b === '14+ días' ? 800 : 400 }}>{b}</div>
                  <div style={{ flex: 1 }}><Bar v={(n / maxBucket) * 100} color={b === '14+ días' ? '#FF3B30' : b === '7-13 días' ? '#FF9500' : C1} /></div>
                  <div style={{ width: 40, textAlign: 'right', fontSize: 12, fontWeight: 700 }}>{n}</div>
                </div>
              ))}
              {aging.peores.length > 0 && (
                <>
                  <div style={{ ...cardT, marginTop: 12 }}>Los más abandonados</div>
                  {aging.peores.slice(0, 8).map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nombre}</span>
                      <span style={{ color: '#8b88a8', whiteSpace: 'nowrap' }}>{p.vend}</span>
                      <span style={{ color: '#FF3B30', fontWeight: 800, whiteSpace: 'nowrap' }}>{p.dias} d</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Volumen: día + hora */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={card}>
              <div style={cardT}>Mensajes por día <span style={{ fontWeight: 600, textTransform: 'none' }}>· <Dot c={C1} /> entrantes · <Dot c='#c9c7dd' /> salientes</span></div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {porDia.map(x => (
                  <div key={x.d} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 44, fontSize: 10.5, color: '#8b88a8', fontFamily: 'ui-monospace,monospace' }}>{x.d.slice(5)}</div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Bar v={(x.ent / maxDia) * 100} color={C1} />
                      <Bar v={(x.sal / maxDia) * 100} color='#c9c7dd' />
                    </div>
                    <div style={{ width: 70, textAlign: 'right', fontSize: 10.5, color: '#5a5a6e', fontFamily: 'ui-monospace,monospace' }}>{x.ent} / {x.sal}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={card}>
              <div style={cardT}>Entrantes por hora</div>
              <div style={{ fontSize: 11.5, color: stats.pctFuera > 30 ? '#B25000' : '#5a5a6e', fontWeight: 700, marginBottom: 10 }}>
                {stats.pctFuera}% llega fuera del horario real ({fN(stats.fuera)} mensajes, incluye sáb. tarde y domingos)
              </div>
              {porHora.map(x => (
                <div key={x.h} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <div style={{ width: 30, fontSize: 10.5, color: x.fuera ? '#B25000' : '#8b88a8', fontFamily: 'ui-monospace,monospace', fontWeight: x.fuera ? 700 : 400 }}>{String(x.h).padStart(2, '0')}h</div>
                  <div style={{ flex: 1 }}><Bar v={(x.ent / maxHora) * 100} color={x.fuera ? '#FF9500' : C1} /></div>
                  <div style={{ width: 40, textAlign: 'right', fontSize: 10.5, color: '#5a5a6e' }}>{x.ent}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Ranking por vendedor */}
          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table className="com">
              <thead><tr><th style={{ textAlign: 'center' }}>#</th><th>Vendedor</th><th>Sucursal</th><th style={{ textAlign: 'right' }}>Mensajes enviados</th><th style={{ textAlign: 'right' }}>Contactos atendidos</th><th style={{ textAlign: 'right' }}>Msgs / contacto</th><th style={{ textAlign: 'right' }}>1ª resp. mediana</th></tr></thead>
              <tbody>
                {ranking.map((r, i) => (
                  <tr key={r.k}>
                    <td style={{ textAlign: 'center', fontWeight: 800, color: i < 3 ? C1 : '#8b88a8' }}>{i + 1}</td>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.nombre}</td>
                    <td style={{ fontSize: 11.5, color: '#5a5a6e' }}>{r.suc ? shortKey(r.suc).toUpperCase() : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fN(r.msgs)}</td>
                    <td style={{ textAlign: 'right' }}>{fN(r.nCont)}</td>
                    <td style={{ textAlign: 'right', color: '#5a5a6e' }}>{r.porCont.toFixed(1)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: r.med1r === null ? '#c9c7dd' : r.med1r > 60 ? '#FF3B30' : r.med1r > 30 ? '#FF9500' : '#34C759' }}>{fmtMin(r.med1r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#a6a3bd', marginTop: 10 }}>
            1ª respuesta = tiempo entre el primer mensaje del cliente sin responder y la respuesta de un humano (la respuesta de ausencia no cuenta como atención). "Ausencia EN horario" son avisos de fuera-de-horario enviados dentro del horario laboral real — revisa la configuración del auto-mensaje en Vambe si es mayor que 0. La cola se calcula con los mensajes del período seleccionado.
          </div>
        </>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB REPORTES — cierre de gestión semanal y mensual del jefe de tienda
   (funcionalidad de la app anterior: M3_Semanales / M3_Mensuales).
   Tablas: com_reportes_semanales / com_reportes_mensuales (ya migradas).
   Las métricas "auto" se calculan al guardar desde com_cierres / com_aperturas /
   com_incidencias y quedan congeladas en el jsonb `auto` (foto del momento).
   ═══════════════════════════════════════════════════════════════════════════ */
function lunesDe(fechaIso) {
  const [y, m, d] = fechaIso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = dt.getDay() === 0 ? 7 : dt.getDay()
  dt.setDate(dt.getDate() - (dow - 1))
  return dt.toLocaleDateString('en-CA')
}
function TabReportes({ sucursales, metas, feriados, cu, anio, setAnio, mes, setMes, isMobile }) {
  const [tipo, setTipo] = useState('semanal')
  const [sucSel, setSucSel] = useState(sucursales.find(s => s.activa)?.sucursal_id || 'suc-lg')
  const [semana, setSemana] = useState(lunesDe(new Date().toLocaleDateString('en-CA')))
  const [previos, setPrevios] = useState([])
  const [auto, setAuto] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const activas = sucursales.filter(s => s.activa)
  const sk = shortKey(sucSel)

  // ── período según tipo ──
  const finSemana = (() => { const [y, m, d] = semana.split('-').map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + 5); return dt.toLocaleDateString('en-CA') })()
  const p1 = tipo === 'semanal' ? semana : `${anio}-${String(mes).padStart(2, '0')}-01`
  const p2 = tipo === 'semanal' ? finSemana : `${anio}-${String(mes).padStart(2, '0')}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`
  const keyRep = tipo === 'semanal' ? `${semana}_${sk}` : `${anio}-${String(mes).padStart(2, '0')}_${sk}`
  const tabla = tipo === 'semanal' ? 'com_reportes_semanales' : 'com_reportes_mensuales'

  // ── auto-métricas del período (misma batería que la app anterior) ──
  const calcularAuto = async () => {
    setAuto(null)
    const [ci, ap, inc] = await Promise.all([
      supabase.from('com_cierres').select('venta_dia,meta_dia,cot_abiertas,cot_contactadas,cot_convertidas,checklist').eq('sucursal_id', sucSel).gte('fecha', p1).lte('fecha', p2),
      supabase.from('com_aperturas').select('checklist').eq('sucursal_id', sucSel).gte('fecha', p1).lte('fecha', p2),
      supabase.from('com_incidencias').select('id').eq('sucursal_id', sucSel).gte('fecha', p1).lte('fecha', p2),
    ])
    const cs = ci.data || [], as = ap.data || []
    const venta = cs.reduce((a, c) => a + Number(c.venta_dia || 0), 0)
    const meta = cs.reduce((a, c) => a + Number(c.meta_dia || 0), 0)
    const quiebres = cs.filter(c => (c.checklist?.quiebres || '') === 'si').length
    // % checklist: proporción de ítems si/no marcados "si" en aperturas del período
    let siN = 0, totN = 0
    as.forEach(a => Object.values(a.checklist || {}).forEach(v => { if (v === 'si' || v === 'no') { totN++; if (v === 'si') siN++ } }))
    setAuto({
      venta, meta, pct: pct(venta, meta),
      pctCk: totN ? Math.round((siN / totN) * 100) : null,
      diasAp: as.length, diasCi: cs.length,
      incidencias: (inc.data || []).length, quiebres,
      cotAb: cs.reduce((a, c) => a + Number(c.cot_abiertas || 0), 0),
      cotCont: cs.reduce((a, c) => a + Number(c.cot_contactadas || 0), 0),
      cotConv: cs.reduce((a, c) => a + Number(c.cot_convertidas || 0), 0),
    })
  }
  const cargarPrevios = async () => {
    const { data } = await supabase.from(tabla).select('*').eq('sucursal_id', sucSel)
      .order(tipo === 'semanal' ? 'semana_inicio' : 'mes_inicio', { ascending: false }).limit(12)
    setPrevios(data || [])
    const ex = (data || []).find(r => r.key === keyRep)
    setForm(ex ? { ...ex } : {})
  }
  useEffect(() => { calcularAuto(); cargarPrevios() /* eslint-disable-next-line */ }, [tipo, sucSel, semana, anio, mes])

  const CAMPOS = tipo === 'semanal'
    ? [['observaciones', 'Observaciones de la semana'], ['acciones_correctivas', 'Acciones correctivas'], ['compromisos', 'Compromisos para la próxima semana'], ['evaluacion_equipo', 'Evaluación del equipo'], ['solicitudes_gerencia', 'Solicitudes a gerencia']]
    : [['resumen_mes', 'Resumen del mes'], ['logros', 'Logros'], ['problemas', 'Problemas'], ['plan_siguiente', 'Plan para el próximo mes'], ['solicitudes', 'Solicitudes a gerencia']]

  const guardar = async () => {
    setSaving(true); setMsg('')
    const base = tipo === 'semanal'
      ? { key: keyRep, semana_inicio: p1, semana_fin: p2, sucursal_id: sucSel }
      : { key: keyRep, mes_inicio: p1, mes_fin: p2, mes, anio, sucursal_id: sucSel }
    const row = { ...base, user_name: cu?.nombre || cu?.correo || null, auto, created_at: new Date().toISOString() }
    CAMPOS.forEach(([k]) => { row[k] = form[k] || null })
    const { error } = await supabase.from(tabla).upsert(row, { onConflict: 'key' })
    setMsg(error ? '⚠ ' + error.message : '✓ Reporte guardado')
    if (!error) cargarPrevios()
    setSaving(false)
  }

  const copiar = () => {
    const s = activas.find(x => x.sucursal_id === sucSel)?.nombre || sucSel
    const lineas = [
      `REPORTE ${tipo.toUpperCase()} — ${s} · ${fmtFecha(p1)} a ${fmtFecha(p2)}`,
      auto ? `Venta ${fmt(auto.venta)} / meta ${fmt(auto.meta)} (${auto.pct}%) · Checklist ${auto.pctCk ?? '—'}% · Aperturas ${auto.diasAp} · Cierres ${auto.diasCi} · Incidencias ${auto.incidencias} · Quiebres ${auto.quiebres} · Cotiz ${auto.cotAb} ab/${auto.cotCont} cont/${auto.cotConv} conv` : '',
      '',
      ...CAMPOS.flatMap(([k, l]) => form[k] ? [`${l.toUpperCase()}:`, form[k], ''] : []),
    ]
    navigator.clipboard?.writeText(lineas.join('\n'))
    setMsg('✓ Copiado al portapapeles')
  }

  const selStyle = { padding: '7px 10px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 13, background: '#fff' }
  const card = { background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'inline-flex', background: '#eceaf6', borderRadius: 10, padding: 3 }}>
          {[['semanal', '📅 Semanal'], ['mensual', '🗓 Mensual']].map(([k, l]) => (
            <button key={k} onClick={() => setTipo(k)}
              style={{ background: tipo === k ? '#fff' : 'transparent', color: tipo === k ? C2 : '#8b88a8', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>{l}</button>
          ))}
        </div>
        <select value={sucSel} onChange={e => setSucSel(e.target.value)} style={selStyle}>
          {activas.map(s => <option key={s.sucursal_id} value={s.sucursal_id}>{s.nombre}</option>)}
        </select>
        {tipo === 'semanal' ? (
          <>
            <span style={{ fontSize: 11, color: '#8b88a8', fontWeight: 700 }}>SEMANA DEL</span>
            <input type="date" value={semana} onChange={e => setSemana(lunesDe(e.target.value))} style={{ ...selStyle, width: 145 }} />
            <span style={{ fontSize: 11.5, color: '#8b88a8' }}>→ {fmtFecha(finSemana)}</span>
          </>
        ) : (
          <>
            <select value={mes} onChange={e => setMes(Number(e.target.value))} style={selStyle}>
              {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select value={anio} onChange={e => setAnio(Number(e.target.value))} style={selStyle}>
              {[anio - 1, anio, anio + 1].filter((v, i, a) => a.indexOf(v) === i).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </>
        )}
      </div>

      {/* Auto-métricas del período */}
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', marginBottom: 8 }}>
          Métricas del período (se congelan en el reporte al guardar)
        </div>
        {!auto ? <span style={{ fontSize: 12, color: '#8b88a8' }}>Calculando…</span> : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5,1fr)', gap: 10 }}>
            {[
              ['Venta / Meta', `${fmtK(auto.venta)} / ${fmtK(auto.meta)}`, colorCump(auto.pct)],
              ['Cumplimiento', auto.pct + '%', colorCump(auto.pct)],
              ['Checklist apertura', auto.pctCk === null ? '—' : auto.pctCk + '%', auto.pctCk >= 90 ? '#34C759' : '#FF9500'],
              ['Aperturas / Cierres', `${auto.diasAp} / ${auto.diasCi}`, '#1c1c1e'],
              ['Incid. / Quiebres', `${auto.incidencias} / ${auto.quiebres}`, (auto.incidencias + auto.quiebres) > 0 ? '#FF9500' : '#34C759'],
            ].map(([l, v, c]) => (
              <div key={l}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>{l}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: c }}>{v}</div>
              </div>
            ))}
          </div>
        )}
        {auto && <div style={{ fontSize: 11, color: '#8b88a8', marginTop: 8 }}>Cotizaciones del período: {auto.cotAb} abiertas · {auto.cotCont} contactadas · {auto.cotConv} convertidas</div>}
      </div>

      {/* Formulario */}
      <div style={{ ...card, marginBottom: 12 }}>
        {CAMPOS.map(([k, l]) => (
          <div key={k} style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#3a3a3c', display: 'block', marginBottom: 4 }}>{l}</label>
            <textarea className="com-inp" rows={2} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              value={form[k] || ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={guardar} disabled={saving}
            style={{ background: saving ? '#c7c5e0' : `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
            {saving ? 'Guardando…' : '💾 Guardar reporte'}
          </button>
          <button onClick={copiar} style={{ background: '#f0eff7', color: C2, border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>📋 Copiar para enviar</button>
          {msg && <span style={{ fontSize: 12.5, fontWeight: 700, color: msg.startsWith('✓') ? '#248A3D' : '#FF3B30' }}>{msg}</span>}
        </div>
      </div>

      {/* Historial */}
      <div style={{ ...card }}>
        <div style={{ fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', marginBottom: 8 }}>Reportes anteriores · {activas.find(s => s.sucursal_id === sucSel)?.nombre}</div>
        {previos.length === 0 ? <span style={{ fontSize: 12, color: '#8b88a8' }}>Sin reportes guardados aún.</span> : (
          <table className="com">
            <thead><tr><th>Período</th><th>Autor</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Cumpl.</th><th>{tipo === 'semanal' ? 'Observaciones' : 'Resumen'}</th></tr></thead>
            <tbody>
              {previos.map(r => {
                const a = r.auto || {}
                return (
                  <tr key={r.key} className="click" onClick={() => { setForm({ ...r }); if (tipo === 'semanal' && r.semana_inicio) setSemana(r.semana_inicio); }}>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtFecha(r.semana_inicio || r.mes_inicio)} → {fmtFecha(r.semana_fin || r.mes_fin)}</td>
                    <td style={{ color: '#5a5a6e', fontSize: 11.5 }}>{r.user_name || '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.venta ? fmtK(a.venta) : (a.auto_venta ? fmtK(a.auto_venta) : '—')}</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: colorCump(a.pct ?? pct(a.auto_venta || a.venta || 0, a.auto_meta || a.meta || 0)) }}>{a.pct ?? pct(a.auto_venta || a.venta || 0, a.auto_meta || a.meta || 0)}%</td>
                    <td style={{ fontSize: 11.5, color: '#5a5a6e', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.observaciones || r.resumen_mes || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div style={{ fontSize: 10.5, color: '#a6a3bd', marginTop: 8 }}>Clic en un reporte anterior lo carga para revisarlo o editarlo. La rutina: el jefe de tienda cierra la semana el sábado y el mes el último día hábil.</div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB MI DÍA — cockpit diario personal del vendedor
   El vendedor ve SU día: venta vs compromiso, cotizaciones que debe atender
   hoy (SLA + agenda), chats esperando respuesta, y su acumulado del mes.
   Identidad: com_vendedores.usuario_id === cu.id → fijo a su ficha;
   fallback por nombre; gerente/jefe pueden elegir a cualquiera.
   ═══════════════════════════════════════════════════════════════════════════ */
function TabMiDia({ sucursales, vendedores, metas, seg, setSeg, cu, esGerente, isMobile }) {
  const perfilMi = resolverPerfil(cu, vendedores, esGerente)
  const normN = t => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const propio = useMemo(() =>
    vendedores.find(v => v.usuario_id && v.usuario_id === cu?.id) ||
    vendedores.find(v => normN(v.nombre) === normN(cu?.nombre)) || null,
  [vendedores, cu])
  const [vendSel, setVendSel] = useState(null)
  useEffect(() => {
    if (vendSel) return
    if (perfilMi.rol === 'jefe') { setVendSel('__tienda__'); return }
    setVendSel(propio?.bsale_user_id ?? vendedores.filter(v => v.activo !== false)[0]?.bsale_user_id)
  }, [propio, vendedores, perfilMi.rol])
  const vend = vendedores.find(v => String(v.bsale_user_id) === String(vendSel))
  const bloqueado = perfilMi.rol === 'vendedor'   // solo gestión (gerente/jefe) puede ver a otros
  const esJefe = perfilMi.rol === 'jefe'
  const sucTienda = perfilMi.sucursal
  const modoTienda = vendSel === '__tienda__'

  const hoyIso = new Date().toLocaleDateString('en-CA')
  const hace45 = new Date(Date.now() - 45 * 86400000).toLocaleDateString('en-CA')
  const mesIni = hoyIso.slice(0, 8) + '01'
  const [compHoy, setCompHoy] = useState(null)
  const [ventaHoy, setVentaHoy] = useState(null)     // {venta, docs, actualizado}
  const [cots, setCots] = useState([])
  const [slaMapMi, setSlaMapMi] = useState({})
  const [chats, setChats] = useState([])
  const [ventaMes, setVentaMes] = useState({ venta: 0, docs: 0 })
  const [loading, setLoading] = useState(false)
  const [refrescando, setRefrescando] = useState(false)
  const [sel, setSel] = useState(null)

  const officeMap = useMemo(() => {
    const m = {}; sucursales.forEach(s => { if (s.bsale_office_id) m[String(s.bsale_office_id)] = s }); return m
  }, [sucursales])

  const cargar = async () => {
    if (modoTienda ? !sucTienda : !vend) return
    setLoading(true)
    try {
      const sucId = modoTienda ? sucTienda : vend.sucursal_id
      const suc = sucursales.find(s => s.sucursal_id === sucId)
      const office = suc?.bsale_office_id ? String(suc.bsale_office_id) : null
      const [cp, vd, cq, cm, vc] = await Promise.all([
        modoTienda
          ? supabase.from('com_compromisos').select('compromiso').eq('fecha', hoyIso).eq('sucursal_id', sucId)
          : supabase.from('com_compromisos').select('compromiso').eq('fecha', hoyIso).eq('bsale_user_id', vend.bsale_user_id).maybeSingle(),
        supabase.from('com_ventas_dia').select('venta,docs,ventas_vendedor,actualizado_at').eq('fecha', hoyIso).eq('sucursal_id', sucId).maybeSingle(),
        modoTienda
          ? (office ? supabase.from('com_cotizaciones').select('*').eq('office_id', office).gte('fecha', hace45).order('fecha_ts', { ascending: false }) : Promise.resolve({ data: [] }))
          : supabase.from('com_cotizaciones').select('*').eq('vendedor_bsale_id', String(vend.bsale_user_id)).gte('fecha', hace45).order('fecha_ts', { ascending: false }),
        supabase.from('com_cierres').select('ventas_vendedor,venta_dia').eq('sucursal_id', sucId).gte('fecha', mesIni).lte('fecha', hoyIso),
        supabase.from('vambe_contactos').select('contact_id,contact_name,phone,agent_principal,resolution_status'),
      ])
      if (modoTienda) setCompHoy((cp.data || []).reduce((a, x) => a + Number(x.compromiso || 0), 0) || null)
      else setCompHoy(Number(cp.data?.compromiso || 0) || null)
      if (modoTienda) {
        setVentaHoy(vd.data ? { venta: Number(vd.data.venta || 0), docs: Number(vd.data.docs || 0), actualizado: vd.data.actualizado_at } : null)
      } else {
        const arr = vd.data?.ventas_vendedor || []
        const mia = (Array.isArray(arr) ? arr : []).find(x => String(x.seller_id) === String(vend.bsale_user_id))
        setVentaHoy(vd.data ? { venta: Number(mia?.total || 0), docs: Number(mia?.count || 0), actualizado: vd.data.actualizado_at } : null)
      }
      setCots(cq.data || [])
      const ids = (cq.data || []).map(x => x.id)
      const sm = {}
      for (let i = 0; i < ids.length; i += 150) {
        const { data: lg } = await supabase.from('com_seguimiento_log').select('doc_id,created_at,estado').in('doc_id', ids.slice(i, i + 150))
        ;(lg || []).forEach(l => { if (l.estado === 'sin_contactar') return; const f = (l.created_at || '').slice(0, 10); if (!sm[l.doc_id] || f < sm[l.doc_id]) sm[l.doc_id] = f })
      }
      setSlaMapMi(sm)
      if (modoTienda) {
        setVentaMes({ venta: (cm.data || []).reduce((a, cc) => a + Number(cc.venta_dia || 0), 0), docs: 0 })
      } else {
        let vAc = 0, dAc = 0
        ;(cm.data || []).forEach(cc => { const me = (cc.ventas_vendedor || {})[String(vend.bsale_user_id)]; if (me) { vAc += Number(me.venta || 0); dAc += Number(me.docs || 0) } })
        setVentaMes({ venta: vAc, docs: dAc })
      }
      const nn = modoTienda ? null : normN(vend.nombre)
      const nombresSuc = modoTienda ? vendedores.filter(v => v.sucursal_id === sucId).map(v => normN(v.nombre)) : null
      const mios = (vc.data || []).filter(x => {
        if (!x.agent_principal) return false
        const a = normN(x.agent_principal)
        if (modoTienda) return nombresSuc.some(s => s === a || a.includes(s) || s.includes(a))
        return a === nn || a.includes(nn) || nn.includes(a)
      })
      const infoC = {}; mios.forEach(x => { if (x.contact_id) infoC[x.contact_id] = x })
      const cids = Object.keys(infoC)
      const desdeM = new Date(Date.now() - 10 * 86400000).toISOString()
      let msgs = []
      for (let i = 0; i < cids.length; i += 100) {
        const { data: mg } = await supabase.from('vambe_mensajes').select('ai_contact_id,direction,user_id,assistant_id,created_at,body_preview').in('ai_contact_id', cids.slice(i, i + 100)).gte('created_at', desdeM).order('created_at', { ascending: true })
        msgs = msgs.concat(mg || [])
      }
      const em = m => m.direction === 'inbound' ? 'cliente' : m.assistant_id ? 'bot' : m.user_id === VAMBE_WORKSPACE ? 'auto' : 'humano'
      const porC = {}; msgs.forEach(m => { (porC[m.ai_contact_id] = porC[m.ai_contact_id] || []).push(m) })
      const cola = []
      Object.entries(porC).forEach(([cid, list]) => {
        let lastHum = 0, primeraEspera = null, preview = ''
        list.forEach(m => { const e = em(m); const t = new Date(m.created_at).getTime(); if (e === 'humano' || e === 'bot') lastHum = Math.max(lastHum, t) })
        list.forEach(m => { if (em(m) !== 'cliente') return; const t = new Date(m.created_at).getTime(); if (t > lastHum) { if (primeraEspera === null) primeraEspera = t; preview = m.body_preview || preview } })
        if (primeraEspera !== null) { const inf = infoC[cid] || {}; cola.push({ cid, nombre: inf.contact_name || inf.phone || '—', fono: (inf.phone || '').replace(/[^\d]/g, ''), espera: (Date.now() - primeraEspera) / 3600000, preview }) }
      })
      setChats(cola.sort((a, b) => b.espera - a.espera))
    } finally { setLoading(false) }
  }
  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [vendSel])

  // refrescar venta del día desde BSALE (mismo upsert que Metas)
  const refrescar = async () => {
    const suc = sucursales.find(s => s.sucursal_id === (modoTienda ? sucTienda : vend?.sucursal_id))
    if (!suc?.bsale_office_id) return
    setRefrescando(true)
    try {
      const r = await callBsale('ventas_dia', { office_id: suc.bsale_office_id, fecha: hoyIso })
      await supabase.from('com_ventas_dia').upsert({
        fecha: hoyIso, sucursal_id: suc.sucursal_id, venta: r.total || 0, docs: r.docs || 0,
        ventas_vendedor: r.ventas || [], actualizado_at: new Date().toISOString(),
      }, { onConflict: 'fecha,sucursal_id' })
      await cargar()
    } finally { setRefrescando(false) }
  }

  // ── derivadas de cotizaciones (con overlay de seguimiento) ──
  const segMapMi = useMemo(() => { const m = {}; seg.forEach(s => { m[s.doc_id] = s }); return m }, [seg])
  const rowsMi = useMemo(() => cots.map(c => {
    const s = segMapMi[c.id]
    const suc = officeMap[String(c.office_id)]
    return {
      id: c.id, number: c.numero, date: c.fecha, total: Number(c.total || 0),
      cliente: { name: c.cliente_nombre || 'Sin cliente', phone: c.cliente_fono || '', email: c.cliente_email || '' },
      seller: { id: c.vendedor_bsale_id, name: c.vendedor_nombre || vend?.nombre || '—' },
      sucursal_id: suc?.sucursal_id || null,
      estado: s?.estado || 'sin_contactar',
      fecha_proximo: s?.fecha_proximo_contacto || '',
      obs: s?.observaciones || '', motivo: s?.motivo_perdida || '',
    }
  }), [cots, segMapMi, officeMap, vend])
  const abiertas = r => r.estado === 'sin_contactar' || r.estado === 'contactado' || r.estado === 'en_negociacion'
  const sinContacto = rowsMi.filter(r => r.estado === 'sin_contactar').sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  const agendaHoy = rowsMi.filter(r => abiertas(r) && r.fecha_proximo && r.fecha_proximo <= hoyIso)
  const dia7 = rowsMi.filter(r => abiertas(r) && daysAgo(r.date) >= 7)
  const mesRows = rowsMi.filter(r => (r.date || '') >= mesIni)
  const convMes = mesRows.filter(r => r.estado === 'convertida').length
  const gestMes = mesRows.filter(r => r.estado !== 'sin_contactar').length
  const sla24 = (() => {
    const ev = mesRows.filter(r => r.estado !== 'sin_contactar' || daysAgo(r.date) >= 1)
    if (!ev.length) return null
    const ok = mesRows.filter(r => {
      const pri = slaMapMi[r.id] || (r.estado !== 'sin_contactar' && segMapMi[r.id]?.updated_at ? segMapMi[r.id].updated_at.slice(0, 10) : null)
      if (!pri || !r.date) return false
      const [y1, m1, d1] = r.date.split('-').map(Number); const [y2, m2, d2] = pri.split('-').map(Number)
      return (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000 <= 1
    }).length
    return Math.round((ok / ev.length) * 100)
  })()

  const cump = compHoy && ventaHoy ? pct(ventaHoy.venta, compHoy) : null
  const card = { background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }
  const cardT = { fontWeight: 800, fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8' }
  const pendTotal = sinContacto.length + agendaHoy.length + chats.length

  if (!vend && !modoTienda) return <div style={{ padding: 20, color: '#8b88a8', fontSize: 13 }}>No hay vendedores configurados.</div>
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        {bloqueado ? (
          <div style={{ fontSize: 15, fontWeight: 800 }}>☀️ Hola, {(vend?.nombre || '').split(' ')[0]} — {fmtFecha(hoyIso)}</div>
        ) : (
          <>
            <select className="com-inp" style={{ width: 210 }} value={vendSel || ''} onChange={e => setVendSel(e.target.value)}>
              {esJefe && <option value="__tienda__">🏬 Toda mi tienda</option>}
              {(esJefe ? vendedores.filter(v => v.activo !== false && v.sucursal_id === perfilMi.sucursal) : vendedores.filter(v => v.activo !== false)).map(v => <option key={v.bsale_user_id} value={v.bsale_user_id}>{v.nombre}</option>)}
            </select>
            <span style={{ fontSize: 12, color: '#8b88a8' }}>{fmtFecha(hoyIso)}{modoTienda ? ' · operación de tu tienda' : ' · vista de un vendedor'}</span>
          </>
        )}
        {loading && <span style={{ fontSize: 12, color: '#8b88a8' }}>Cargando…</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 800, color: pendTotal > 0 ? '#B25000' : '#248A3D' }}>
          {pendTotal > 0 ? `${pendTotal} pendientes hoy` : '✓ Al día'}
        </span>
      </div>

      {/* KPIs del día + mes */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5,1fr)', gap: 10, marginBottom: 14 }}>
        <div style={{ ...card, padding: '12px 14px', borderTop: `3px solid ${cump === null ? '#c9c7dd' : colorCump(cump)}` }}>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>{modoTienda ? 'Venta de la tienda hoy' : 'Mi venta de hoy'}</div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{ventaHoy ? fmtK(ventaHoy.venta) : '—'}</div>
          <div style={{ fontSize: 10.5, color: '#8b88a8' }}>{compHoy ? `${modoTienda ? 'meta' : 'compromiso'} ${fmtK(compHoy)} · ${cump ?? '—'}%` : (modoTienda ? 'sin meta del día' : 'sin compromiso registrado')}</div>
        </div>
        {[
          ['Docs hoy', ventaHoy ? fN(ventaHoy.docs) : '—', '#1c1c1e', ''],
          [modoTienda ? 'Venta del mes (tienda)' : 'Venta del mes', fmtK(ventaMes.venta), C1, modoTienda ? '' : `${fN(ventaMes.docs)} docs`],
          ['Conversión mes', gestMes ? pct(convMes, mesRows.length) + '%' : '—', '#248A3D', `${convMes} de ${mesRows.length} cotiz.`],
          [modoTienda ? 'SLA 24h tienda' : 'Mi SLA 24h', sla24 === null ? '—' : sla24 + '%', sla24 === null ? '#c9c7dd' : sla24 >= 80 ? '#248A3D' : sla24 >= 50 ? '#B25000' : '#FF3B30', 'contacto en 24h'],
        ].map(([l, v, c2, sub]) => (
          <div key={l} style={{ ...card, padding: '12px 14px' }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>{l}</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: c2 }}>{v}</div>
            {sub && <div style={{ fontSize: 10.5, color: '#8b88a8' }}>{sub}</div>}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10.5, color: '#a6a3bd', marginTop: -8, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        {ventaHoy?.actualizado && <span>venta actualizada {new Date(ventaHoy.actualizado).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>}
        <button onClick={refrescar} disabled={refrescando} style={{ background: '#f0eff7', color: C2, border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>
          {refrescando ? 'Consultando BSALE…' : '⟳ Actualizar venta'}
        </button>
      </div>

      {/* Trabajo del día */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {/* Cotizaciones por contactar (SLA) */}
        <div style={card}>
          <div style={cardT}>📋 Por contactar — SLA 24h ({sinContacto.length})</div>
          {sinContacto.length === 0 ? <div style={{ fontSize: 12.5, color: '#248A3D', fontWeight: 700 }}>✓ Nada sin contactar</div> : (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {sinContacto.slice(0, 20).map(r => {
                const d = daysAgo(r.date)
                return (
                  <div key={r.id} className="click" onClick={() => setSel(r)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderBottom: '1px solid #f5f4fa', cursor: 'pointer' }}>
                    <span style={{ fontWeight: 800, color: d >= 7 ? '#FF3B30' : d >= 1 ? '#B25000' : '#248A3D', fontSize: 11.5, width: 34 }}>{d}d</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{r.number} · {r.cliente.name}</div>
                      <div style={{ fontSize: 10.5, color: '#8b88a8' }}>{fmtFecha(r.date)}{d >= 7 ? ' · DECIDIR HOY' : ''}</div>
                    </div>
                    <span style={{ fontWeight: 800, fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmt(r.total)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Agenda de hoy: próximos contactos comprometidos */}
        <div style={card}>
          <div style={cardT}>📅 Mi agenda de seguimiento ({agendaHoy.length})</div>
          {agendaHoy.length === 0 ? <div style={{ fontSize: 12.5, color: '#248A3D', fontWeight: 700 }}>✓ Sin contactos comprometidos para hoy</div> : (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {agendaHoy.slice(0, 20).map(r => (
                <div key={r.id} className="click" onClick={() => setSel(r)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderBottom: '1px solid #f5f4fa', cursor: 'pointer' }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: r.fecha_proximo < hoyIso ? '#FF3B30' : '#B25000', width: 52 }}>{r.fecha_proximo < hoyIso ? 'VENCIDO' : 'HOY'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{r.number} · {r.cliente.name}</div>
                    <div style={{ fontSize: 10.5, color: '#8b88a8' }}>{ESTADOS[r.estado]?.label} · comprometido {fmtFecha(r.fecha_proximo)}</div>
                  </div>
                  <span style={{ fontWeight: 800, fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmt(r.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chats esperando + decisión día 7 */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={card}>
          <div style={cardT}>💬 Chats esperando mi respuesta ({chats.length})</div>
          {chats.length === 0 ? <div style={{ fontSize: 12.5, color: '#248A3D', fontWeight: 700 }}>✓ Sin chats pendientes</div> : (
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {chats.slice(0, 15).map(ch => (
                <div key={ch.cid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderBottom: '1px solid #f5f4fa' }}>
                  <span style={{ fontWeight: 800, fontSize: 11.5, color: ch.espera > 24 ? '#FF3B30' : '#B25000', width: 48 }}>{fmtHrs(ch.espera)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.nombre}</div>
                    <div style={{ fontSize: 10.5, color: '#8b88a8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.preview}</div>
                  </div>
                  {ch.fono && <a href={`https://wa.me/${ch.fono}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 800, color: '#248A3D', textDecoration: 'none', background: '#34C75915', padding: '4px 9px', borderRadius: 7 }}>Responder ↗</a>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={card}>
          <div style={cardT}>⏳ Día 7 — decidir hoy ({dia7.length})</div>
          {dia7.length === 0 ? <div style={{ fontSize: 12.5, color: '#248A3D', fontWeight: 700 }}>✓ Sin cotizaciones vencidas de decisión</div> : (
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {dia7.slice(0, 15).map(r => (
                <div key={r.id} className="click" onClick={() => setSel(r)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderBottom: '1px solid #f5f4fa', cursor: 'pointer' }}>
                  <span style={{ fontWeight: 800, fontSize: 11.5, color: '#FF3B30', width: 34 }}>{daysAgo(r.date)}d</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{r.number} · {r.cliente.name}</div>
                    <div style={{ fontSize: 10.5, color: '#8b88a8' }}>{ESTADOS[r.estado]?.label} · convertir, agendar o declarar perdida</div>
                  </div>
                  <span style={{ fontWeight: 800, fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmt(r.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: '#a6a3bd' }}>Toca una cotización para gestionarla aquí mismo. La regla del día: contactar lo nuevo en 24h, cumplir la agenda comprometida y decidir lo que llegó al día 7.</div>

      {sel && <SheetSeguimiento cot={sel} onClose={() => setSel(null)} cu={cu} sucSel={sel.sucursal_id || vend.sucursal_id}
        onSaved={(row) => { setSeg(prev => { const o = prev.filter(x => x.doc_id !== row.doc_id); return [...o, row] }); setSel(null) }} />}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   APERTURA Y CIERRE DEL DÍA — el ritual diario del jefe de tienda.
   Escribe en com_aperturas / com_cierres / com_compromisos con exactamente el
   mismo shape del histórico migrado, por lo que Dashboard, Mi Día, Reportes y
   el acumulado de Metas se alimentan sin cambios.
   El cierre trae la venta desde BSALE e incluye a TODOS los vendedores que
   vendieron ese día (aunque no estén en com_vendedores), guardando además el
   snapshot en com_ventas_dia.
   ═══════════════════════════════════════════════════════════════════════════ */
const CK_APERTURA = [
  ['equipo', 'Equipo completo y presentable'], ['briefing', 'Briefing realizado'],
  ['meta_com', 'Meta del día comunicada'], ['exhibicion', 'Exhibición en orden'],
  ['precios', 'Precios visibles y correctos'], ['pop', 'Material POP en su lugar'],
  ['danados', 'Sin productos dañados a la vista'], ['bsale', 'BSALE operativo'],
  ['vambe', 'Vambe/WhatsApp operativo'], ['caja', 'Caja cuadrada al abrir'],
  ['ilum', 'Iluminación funcionando'], ['bodega', 'Bodega en orden'],
  ['desp_pend', 'Despachos pendientes revisados'], ['orden_bod', 'Orden de bodega verificado'],
]
const CK_CIERRE = [
  ['cierre_caja', 'Cierre de caja realizado'], ['tienda_orden', 'Tienda ordenada'],
  ['desp_completados', 'Despachos del día completados'], ['recep_merc', 'Recepción de mercadería revisada'],
  ['incidencias', '¿Hubo incidencias?'], ['quiebres', '¿Hubo quiebres de stock?'],
  ['reposicion', '¿Se requiere reposición?'], ['alertas_ops', '¿Alertas operacionales?'],
]
const SiNo = ({ v, onChange }) => (
  <div style={{ display: 'inline-flex', gap: 4 }}>
    {['si', 'no'].map(k => (
      <button key={k} onClick={() => onChange(k)}
        style={{ padding: '4px 12px', borderRadius: 7, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', border: 'none', background: v === k ? (k === 'si' ? '#34C75920' : '#FF3B3018') : '#f2f2f7', color: v === k ? (k === 'si' ? '#248A3D' : '#FF3B30') : '#8b88a8' }}>
        {k.toUpperCase()}
      </button>
    ))}
  </div>
)

function SheetApertura({ suc, vendedores, metas, feriados, cu, hoyAp, onClose, onSaved }) {
  const hoyIso = new Date().toLocaleDateString('en-CA')
  const sk = shortKey(suc.sucursal_id)
  const anioH = Number(hoyIso.slice(0, 4)), mesH = Number(hoyIso.slice(5, 7))
  const metaMesV = Number(metas.find(m => m.anio === anioH && m.mes === mesH && m.sucursal_id === suc.sucursal_id)?.meta_clp || 0)
  const dhTot = diasHabiles(anioH, mesH, sk, feriados)
  const metaDiaDef = dhTot > 0 ? Math.round(metaMesV / dhTot) : 0
  const equipo = vendedores.filter(v => v.sucursal_id === suc.sucursal_id && v.activo !== false)

  const [ck, setCk] = useState(hoyAp?.checklist || {})
  const [metaDia, setMetaDia] = useState(hoyAp?.meta_dia ?? metaDiaDef)
  const [obs, setObs] = useState(hoyAp?.obs || '')
  const [presentes, setPresentes] = useState(() => {
    const prev = hoyAp?.vendedores || []
    const m = {}
    equipo.forEach(v => {
      const p = prev.find(x => String(x.bsaleId) === String(v.bsale_user_id))
      m[v.bsale_user_id] = { on: prev.length ? !!p : true, compromiso: p?.compromiso ?? '' }
    })
    return m
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const nPres = Object.values(presentes).filter(p => p.on).length
  const sugerido = nPres > 0 ? Math.round(Number(metaDia || 0) / nPres) : 0
  const sumaComp = Object.values(presentes).filter(p => p.on).reduce((a, p) => a + Number(p.compromiso || 0), 0)

  const guardar = async () => {
    setErr('')
    const sinCk = CK_APERTURA.filter(([k]) => !ck[k])
    if (sinCk.length) { setErr(`Faltan ${sinCk.length} ítems del checklist por marcar.`); return }
    if (nPres === 0) { setErr('Marca al menos un vendedor presente.'); return }
    setSaving(true)
    const id = hoyAp?.id || `AP-${sk.toUpperCase()}-${Date.now()}`
    const vend = equipo.filter(v => presentes[v.bsale_user_id]?.on).map(v => ({
      bsaleId: v.bsale_user_id, name: v.nombre,
      compromiso: Number(presentes[v.bsale_user_id]?.compromiso || 0) || sugerido,
    }))
    const row = {
      id, fecha: hoyIso, hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
      sucursal_id: suc.sucursal_id, user_name: cu?.nombre || cu?.correo || null,
      meta_dia: Number(metaDia || 0), piso_minimo: null, suma_compromisos: vend.reduce((a, x) => a + x.compromiso, 0),
      checklist: ck, vendedores: vend, obs: obs || null, apertura_tardia: false,
    }
    try {
      const { error } = await supabase.from('com_aperturas').upsert(row, { onConflict: 'id' })
      if (error) throw error
      const comps = vend.map(v => ({ apertura_id: id, fecha: hoyIso, sucursal_id: suc.sucursal_id, bsale_user_id: v.bsaleId, vendedor: v.name, compromiso: v.compromiso }))
      const { error: e2 } = await supabase.from('com_compromisos').upsert(comps, { onConflict: 'apertura_id,bsale_user_id' })
      if (e2) throw e2
      onSaved(row)
    } catch (e) { setErr(String(e?.message || e)); setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,30,.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '18px 18px 0 0', padding: '10px 20px 28px', width: '100%', maxWidth: 640, maxHeight: '92vh', overflow: 'auto' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#e5e5ea', margin: '0 auto 12px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>🌅 Apertura · {suc.nombre} · {fmtFecha(hoyIso)}</div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 15, background: '#f2f2f7', border: 'none', fontSize: 14, cursor: 'pointer', color: '#8b88a8' }}>✕</button>
        </div>
        {hoyAp && <div style={{ fontSize: 11.5, color: '#B25000', fontWeight: 700, marginBottom: 8 }}>Ya existe apertura de hoy ({hoyAp.hora}) — al guardar la actualizas.</div>}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, fontWeight: 700 }}>Meta del día</label>
          <input className="com-inp" type="number" style={{ width: 150 }} value={metaDia} onChange={e => setMetaDia(e.target.value)} />
          <span style={{ fontSize: 11, color: '#8b88a8' }}>sugerida: {fmt(metaDiaDef)} (meta mes / {dhTot} días hábiles)</span>
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', marginBottom: 6 }}>Checklist de apertura</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', alignItems: 'center', marginBottom: 6 }}>
          {CK_APERTURA.map(([k, l]) => (
            <Fragment key={k}>
              <span style={{ fontSize: 12.5 }}>{l}</span>
              <SiNo v={ck[k]} onChange={v => setCk(c => ({ ...c, [k]: v }))} />
            </Fragment>
          ))}
        </div>
        {(ck.danados === 'no') && (
          <input className="com-inp" style={{ width: '100%', marginBottom: 8 }} placeholder="Detalle productos dañados…" value={ck.danados_obs || ''} onChange={e => setCk(c => ({ ...c, danados_obs: e.target.value }))} />
        )}
        {(ck.desp_pend === 'si') && (
          <input className="com-inp" type="number" style={{ width: 220, marginBottom: 8 }} placeholder="¿Cuántos despachos pendientes?" value={ck.desp_cant || ''} onChange={e => setCk(c => ({ ...c, desp_cant: e.target.value }))} />
        )}

        <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', margin: '10px 0 6px' }}>
          Presentes y compromisos <span style={{ fontWeight: 600, textTransform: 'none' }}>· sugerido {fmt(sugerido)} c/u · suma {fmt(sumaComp)} {sumaComp > 0 && Number(metaDia) > 0 && sumaComp < Number(metaDia) ? '⚠ bajo la meta' : ''}</span>
        </div>
        {equipo.map(v => (
          <div key={v.bsale_user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, width: 180, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              <input type="checkbox" checked={presentes[v.bsale_user_id]?.on || false}
                onChange={e => setPresentes(p => ({ ...p, [v.bsale_user_id]: { ...p[v.bsale_user_id], on: e.target.checked } }))} />
              {v.nombre}
            </label>
            {presentes[v.bsale_user_id]?.on && (
              <input className="com-inp" type="number" style={{ width: 140 }} placeholder={String(sugerido)}
                value={presentes[v.bsale_user_id]?.compromiso ?? ''}
                onChange={e => setPresentes(p => ({ ...p, [v.bsale_user_id]: { ...p[v.bsale_user_id], compromiso: e.target.value } }))} />
            )}
          </div>
        ))}

        <div style={{ margin: '10px 0' }}>
          <textarea className="com-inp" rows={2} style={{ width: '100%', resize: 'vertical' }} placeholder="Observaciones de la apertura…" value={obs} onChange={e => setObs(e.target.value)} />
        </div>

        {err && <div style={{ padding: 10, background: '#FF3B3010', color: '#FF3B30', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <button onClick={guardar} disabled={saving} style={{ width: '100%', padding: '12px', borderRadius: 10, background: saving ? '#c7c5e0' : `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
          {saving ? 'Guardando…' : '🌅 Guardar apertura del día'}
        </button>
      </div>
    </div>
  )
}

function SheetCierre({ suc, vendedores, cu, hoyAp, hoyCi, onClose, onSaved }) {
  const hoyIso = new Date().toLocaleDateString('en-CA')
  const sk = shortKey(suc.sucursal_id)
  const [ck, setCk] = useState(hoyCi?.checklist || {})
  const [obs, setObs] = useState(hoyCi?.obs || '')
  const [venta, setVenta] = useState(null)   // { total, docs, ventas:[...] }
  const [cargandoVenta, setCargandoVenta] = useState(false)
  const [cots, setCots] = useState({ ab: hoyCi?.cot_abiertas ?? '', co: hoyCi?.cot_contactadas ?? '', cv: hoyCi?.cot_convertidas ?? '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const traerVenta = async () => {
    setCargandoVenta(true); setErr('')
    try {
      const r = await callBsale('ventas_dia', { office_id: suc.bsale_office_id, fecha: hoyIso })
      setVenta({ total: r.total || 0, docs: r.docs || 0, ventas: r.ventas || [] })
      // conteo automático de gestión de cotizaciones de hoy (editable)
      const { data: cot } = await supabase.from('com_cotizaciones').select('id').eq('fecha', hoyIso).eq('office_id', String(suc.bsale_office_id))
      const { data: sg } = await supabase.from('com_seguimiento').select('doc_id,estado,updated_at').gte('updated_at', hoyIso).eq('sucursal_id', suc.sucursal_id)
      setCots(c => ({
        ab: c.ab === '' ? (cot || []).length : c.ab,
        co: c.co === '' ? (sg || []).filter(x => x.estado !== 'sin_contactar').length : c.co,
        cv: c.cv === '' ? (sg || []).filter(x => x.estado === 'convertida').length : c.cv,
      }))
    } catch (e) { setErr(String(e?.message || e)) }
    setCargandoVenta(false)
  }
  useEffect(() => { traerVenta() /* eslint-disable-next-line */ }, [])

  const compromisos = useMemo(() => {
    const m = {}
    ;(hoyAp?.vendedores || []).forEach(v => { m[String(v.bsaleId)] = Number(v.compromiso || 0) })
    return m
  }, [hoyAp])

  const guardar = async () => {
    setErr('')
    if (!venta) { setErr('Primero trae la venta desde BSALE.'); return }
    const sinCk = CK_CIERRE.filter(([k]) => !ck[k])
    if (sinCk.length) { setErr(`Faltan ${sinCk.length} ítems del checklist por marcar.`); return }
    setSaving(true)
    const id = hoyCi?.id || `CI-${sk.toUpperCase()}-${Date.now()}`
    const metaDia = Number(hoyAp?.meta_dia || 0)
    // TODOS los vendedores que vendieron hoy según BSALE (estén o no en el maestro)
    const vv = {}
    ;(venta.ventas || []).forEach(x => {
      const bid = String(x.seller_id)
      vv[bid] = { name: x.seller_name, compromiso: compromisos[bid] || 0, venta: Number(x.total || 0), docs: Number(x.count || 0) }
    })
    const row = {
      id, apertura_id: hoyAp?.id || null, fecha: hoyIso,
      hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
      sucursal_id: suc.sucursal_id, user_name: cu?.nombre || cu?.correo || null,
      venta_dia: venta.total, meta_dia: metaDia, transacciones: venta.docs,
      cumplimiento: metaDia > 0 ? Math.round((venta.total / metaDia) * 100) : null,
      ticket: venta.docs > 0 ? Math.round(venta.total / venta.docs) : null,
      cot_abiertas: Number(cots.ab || 0), cot_contactadas: Number(cots.co || 0), cot_convertidas: Number(cots.cv || 0),
      checklist: ck, ventas_vendedor: vv, obs: obs || null,
    }
    try {
      const { error } = await supabase.from('com_cierres').upsert(row, { onConflict: 'id' })
      if (error) throw error
      // snapshot del día como respaldo (misma fuente que Metas)
      await supabase.from('com_ventas_dia').upsert({
        fecha: hoyIso, sucursal_id: suc.sucursal_id, venta: venta.total, docs: venta.docs,
        ventas_vendedor: venta.ventas, actualizado_at: new Date().toISOString(),
      }, { onConflict: 'fecha,sucursal_id' })
      onSaved(row)
    } catch (e) { setErr(String(e?.message || e)); setSaving(false) }
  }

  const metaDia = Number(hoyAp?.meta_dia || 0)
  const cump = venta && metaDia > 0 ? pct(venta.total, metaDia) : null
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,30,.5)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '18px 18px 0 0', padding: '10px 20px 28px', width: '100%', maxWidth: 640, maxHeight: '92vh', overflow: 'auto' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#e5e5ea', margin: '0 auto 12px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>🌙 Cierre · {suc.nombre} · {fmtFecha(hoyIso)}</div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 15, background: '#f2f2f7', border: 'none', fontSize: 14, cursor: 'pointer', color: '#8b88a8' }}>✕</button>
        </div>
        {!hoyAp && <div style={{ fontSize: 11.5, color: '#B25000', fontWeight: 700, marginBottom: 8 }}>⚠ Hoy no hay apertura registrada — el cierre se guardará sin meta ni compromisos del día.</div>}
        {hoyCi && <div style={{ fontSize: 11.5, color: '#B25000', fontWeight: 700, marginBottom: 8 }}>Ya existe cierre de hoy ({hoyCi.hora}) — al guardar lo actualizas.</div>}

        {/* Venta BSALE */}
        <div style={{ background: '#f8f7fc', borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: '#8b88a8' }}>Venta del día (BSALE)</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: cump === null ? '#1c1c1e' : colorCump(cump) }}>
                {cargandoVenta ? 'Consultando…' : venta ? fmt(venta.total) : '—'}
                {venta && metaDia > 0 && <span style={{ fontSize: 13, marginLeft: 8 }}>({cump}% de {fmtK(metaDia)})</span>}
              </div>
              {venta && <div style={{ fontSize: 11, color: '#8b88a8' }}>{venta.docs} documentos · ticket {venta.docs > 0 ? fmt(Math.round(venta.total / venta.docs)) : '—'}</div>}
            </div>
            <button onClick={traerVenta} disabled={cargandoVenta} style={{ background: '#fff', color: C2, border: '1px solid #e0def0', borderRadius: 8, padding: '7px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>⟳ Actualizar</button>
          </div>
          {venta && venta.ventas.filter(x => x.total !== 0).length > 0 && (
            <table className="com" style={{ marginTop: 8 }}>
              <thead><tr><th>Vendedor</th><th style={{ textAlign: 'right' }}>Compromiso</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
              <tbody>
                {venta.ventas.filter(x => x.total !== 0).sort((a, b) => b.total - a.total).map(x => {
                  const comp = compromisos[String(x.seller_id)] || 0
                  const p = comp > 0 ? pct(x.total, comp) : null
                  return (
                    <tr key={x.seller_id}>
                      <td style={{ fontWeight: 600 }}>{x.seller_name}</td>
                      <td style={{ textAlign: 'right', color: '#8b88a8' }}>{comp ? fmt(comp) : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(x.total)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: p === null ? '#c9c7dd' : colorCump(p) }}>{p === null ? '—' : p + '%'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Gestión de cotizaciones del día */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Cotizaciones hoy:</span>
          {[['ab', 'abiertas'], ['co', 'contactadas'], ['cv', 'convertidas']].map(([k, l]) => (
            <label key={k} style={{ fontSize: 11.5, color: '#8b88a8', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input className="com-inp" type="number" style={{ width: 64 }} value={cots[k]} onChange={e => setCots(c => ({ ...c, [k]: e.target.value }))} />{l}
            </label>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', marginBottom: 6 }}>Checklist de cierre</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', alignItems: 'center', marginBottom: 6 }}>
          {CK_CIERRE.map(([k, l]) => (
            <Fragment key={k}>
              <span style={{ fontSize: 12.5 }}>{l}</span>
              <SiNo v={ck[k]} onChange={v => setCk(c => ({ ...c, [k]: v }))} />
            </Fragment>
          ))}
        </div>
        {ck.quiebres === 'si' && <input className="com-inp" style={{ width: '100%', marginBottom: 6 }} placeholder="Detalle de quiebres (productos)…" value={ck.quiebres_det || ''} onChange={e => setCk(c => ({ ...c, quiebres_det: e.target.value }))} />}
        {ck.reposicion === 'si' && <input className="com-inp" style={{ width: '100%', marginBottom: 6 }} placeholder="Detalle de reposición requerida…" value={ck.reposicion_det || ''} onChange={e => setCk(c => ({ ...c, reposicion_det: e.target.value }))} />}
        {ck.alertas_ops === 'si' && <input className="com-inp" style={{ width: '100%', marginBottom: 6 }} placeholder="Detalle de alertas operacionales…" value={ck.alertas_ops_det || ''} onChange={e => setCk(c => ({ ...c, alertas_ops_det: e.target.value }))} />}
        {ck.recep_merc === 'si' && <input className="com-inp" style={{ width: '100%', marginBottom: 6 }} placeholder="Detalle recepción de mercadería…" value={ck.recep_det || ''} onChange={e => setCk(c => ({ ...c, recep_det: e.target.value }))} />}
        {ck.desp_completados === 'no' && <input className="com-inp" type="number" style={{ width: 240, marginBottom: 6 }} placeholder="¿Cuántos despachos pendientes?" value={ck.desp_pendientes || ''} onChange={e => setCk(c => ({ ...c, desp_pendientes: e.target.value }))} />}

        <div style={{ margin: '8px 0' }}>
          <textarea className="com-inp" rows={2} style={{ width: '100%', resize: 'vertical' }} placeholder="Observaciones del cierre…" value={obs} onChange={e => setObs(e.target.value)} />
        </div>

        {err && <div style={{ padding: 10, background: '#FF3B3010', color: '#FF3B30', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <button onClick={guardar} disabled={saving || cargandoVenta} style={{ width: '100%', padding: '12px', borderRadius: 10, background: saving ? '#c7c5e0' : `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
          {saving ? 'Guardando…' : '🌙 Guardar cierre del día'}
        </button>
      </div>
    </div>
  )
}
