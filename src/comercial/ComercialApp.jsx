import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase, signOut } from '../supabase'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'

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
  en_despacho: { label: 'En proceso de despacho', c: '#5856D6', bg: '#5856D615', ic: '🚚' },
  convertida: { label: 'Convertida', c: '#34C759', bg: '#34C75915', ic: '✅' },
  perdida: { label: 'Perdida', c: '#8E8E93', bg: '#8E8E9315', ic: '❌' },
  descartada: { label: 'Descartada', c: '#B0B0B8', bg: '#B0B0B815', ic: '🗑️' },
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
  const [cotVista, setCotVista] = useState('lista')   // 'lista' | 'radar' dentro de Cotizaciones
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
  const [delegs, setDelegs] = useState([])
  useEffect(() => {
    supabase.from('com_delegaciones').select('*').eq('activo', true)
      .then(({ data }) => setDelegs(data || []), () => {})
  }, [])
  const perfilNav = resolverPerfil(cu, vendedores, esGerente)
  const normD = t => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const miDelegacion = useMemo(() => {
    const nn = normD(cu?.nombre), cc = normD(cu?.correo)
    if (!nn && !cc) return null
    return delegs.find(d => {
      const dn = normD(d.nombre)
      if (!dn) return false
      // si lo registraron con el correo, se compara como correo (exacto)
      if (dn.includes('@')) return !!cc && dn === cc
      return !!nn && (dn === nn || dn.includes(nn) || nn.includes(dn))
    }) || null
  }, [delegs, cu])
  useEffect(() => {
    if (perfilNav.rol === 'vendedor' && ['dashboard', 'reportes', 'incidencias', 'vambe'].includes(tab)) setTab('midia')
    if (perfilNav.rol === 'vendedor' && tab === 'bitacora' && !miDelegacion) setTab('midia')
  }, [perfilNav.verTodo, tab])
  const TABS = [
    { k: 'midia', l: 'Mi Día', ic: '☀️' },
    { k: 'dashboard', l: 'Dashboard', ic: '📊' },
    { k: 'metas', l: 'Metas de venta', ic: '🎯' },
    { k: 'cotizaciones', l: 'Cotizaciones', ic: '📋' },
    { k: 'despachos', l: 'Despachos', ic: '🚚' },
    { k: 'vendedores', l: 'Vendedores', ic: '👤' },
    { k: 'turnos', l: 'Turnos', ic: '🗓' },
    { k: 'bitacora', l: 'Bitácora', ic: '📓' },
    { k: 'incidencias', l: 'Incidencias', ic: '🚨' },
    { k: 'reportes', l: 'Reportes', ic: '📝' },
    ...(perfilNav.rol !== 'vendedor' ? [{ k: 'vambe', l: 'Vambe', ic: '💬' }] : []),
    ...(esGerente ? [{ k: 'config', l: 'Configuración', ic: '⚙️' }] : []),
  ].filter(tb => perfilNav.rol !== 'vendedor' || (miDelegacion && tb.k === 'bitacora') || !['dashboard', 'reportes', 'bitacora', 'incidencias'].includes(tb.k))

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif", background: '#f4f4fb', minHeight: '100vh', fontSize: 14, color: '#1c1c1e' }}>
      <style>{`
        *{box-sizing:border-box}
        .com-tab:hover{background:rgba(255,255,255,.08)}
        table.com{border-collapse:collapse;width:100%;font-size:12.5px}
        table.com th{text-align:left;padding:7px 10px;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#8b88a8;font-weight:700;border-bottom:1px solid #e7e5f2;white-space:nowrap;position:sticky;top:0;background:#faf9ff;z-index:1}
        table.com td{padding:8px 10px;border-bottom:1px solid #f0eff7;vertical-align:middle}
        table.com tr.click:hover{background:#f7f6ff;cursor:pointer}
        .com-amplio table.com{font-size:13.5px}
        .com-amplio table.com th{font-size:11.5px;padding:9px 12px}
        .com-amplio table.com td{padding:10px 12px}
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
      <div style={{ padding: isMobile ? '12px 12px 40px' : '18px 28px 48px', maxWidth: ['vambe', 'midia', 'dashboard', 'metas', 'cotizaciones'].includes(tab) ? 'none' : 1280, margin: '0 auto' }} className={['vambe', 'midia', 'dashboard', 'metas', 'cotizaciones'].includes(tab) ? 'com-amplio' : undefined}>
        {loadingBase ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#8b88a8' }}>Cargando módulo…</div>
        ) : errBase ? (
          <div style={{ padding: 16, background: '#FF3B3010', color: '#FF3B30', borderRadius: 10, fontSize: 13 }}>
            Error cargando datos: {errBase}. Verifica que las tablas com_* existan (correr comercial_fase1.sql).
          </div>
        ) : (
          <>
            {tab === 'midia' && <TabMiDia {...{ sucursales, vendedores, metas, seg, setSeg, cu, esGerente, isMobile, onVerRadar: () => { setCotVista('radar'); setTab('cotizaciones') }, onVerVambe: perfilNav.rol !== 'vendedor' ? () => setTab('vambe') : null }} />}
            {tab === 'dashboard' && perfilNav.rol !== 'vendedor' && <TabDashboard {...{ onIr: t => setTab(t), sucursales, vendedores, metas, seg, cu, esGerente, anio, setAnio, mes, setMes, feriados, isMobile }} />}
            {tab === 'metas' && <TabMetas {...{ sucursales, vendedores, feriados, metas, cu, esGerente, anio, setAnio, mes, setMes, isMobile }} />}
            {tab === 'cotizaciones' && <TabCotizaciones {...{ sucursales, vendedores, sucSel, setSucSel, seg, setSeg, cu, esGerente, isMobile, vista: cotVista, setVista: setCotVista }} />}
            {tab === 'despachos' && <TabDespachos {...{ sucursales, vendedores, sucSel, setSucSel, cu, esGerente, isMobile }} />}
            {tab === 'vendedores' && <TabVendedores {...{ sucursales, vendedores, seg, cu, esGerente, anio, setAnio, mes, setMes, isMobile }} />}
            {tab === 'turnos' && <TabTurnos {...{ sucursales, vendedores, sucSel, setSucSel, anio, setAnio, mes, setMes, cu, esGerente, isMobile }} />}
            {tab === 'bitacora' && (perfilNav.rol !== 'vendedor' || miDelegacion) && <TabBitacora {...{ sucursales, vendedores, metas, feriados, cu, esGerente, delegacion: miDelegacion, sucSel, setSucSel, anio, setAnio, mes, setMes, isMobile }} />}
            {tab === 'reportes' && perfilNav.rol !== 'vendedor' && <TabReportes {...{ vendedores, esGerente, sucursales, metas, feriados, cu, anio, setAnio, mes, setMes, isMobile }} />}
            {tab === 'incidencias' && perfilNav.rol !== 'vendedor' && <TabIncidencias {...{ sucursales, sucSel, cu, isMobile }} />}
            {tab === 'vambe' && perfilNav.rol !== 'vendedor' && <TabVambeMonitor {...{ sucursales, vendedores, cu, esGerente, isMobile, anio, setAnio, mes, setMes }} />}
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
  if (yo.rol === 'coordinador') return { rol: 'coordinador', vendedor: yo, sucursal: yo.sucursal_id, verTodo: false }
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

  const [recal, setRecal] = useState('')
  const recalcularMes = async () => {
    if (recal || loading) return
    const finMesD = new Date(anio, mes, 0).getDate()
    const hoyD = new Date()
    const esMesActual = hoyD.getFullYear() === anio && (hoyD.getMonth() + 1) === mes
    const esPasado = new Date(anio, mes - 1, finMesD) < hoyD
    const ultimo = esMesActual ? hoyD.getDate() : (esPasado ? finMesD : 0)
    if (!ultimo) return
    const traerDia = async (s, f) => {
      const r = await callBsale('ventas_dia', { office_id: s.bsale_office_id, fecha: f })
      if (!r || r.success === false) throw new Error(r?.error || 'sin datos')
      await supabase.from('com_ventas_dia').upsert({
        fecha: f, sucursal_id: s.sucursal_id, venta: r.total || 0, docs: r.docs || 0,
        ventas_vendedor: r.ventas || [], actualizado_at: new Date().toISOString(),
      }, { onConflict: 'fecha,sucursal_id' })
    }
    const fallidos = []
    try {
      for (const s of activas) {
        for (let d = 1; d <= ultimo; d++) {
          const f = `${anio}-${MM}-${String(d).padStart(2, '0')}`
          setRecal(`${s.nombre} ${d}/${ultimo}`)
          await new Promise(res => setTimeout(res, 280))   // ritmo anti-429
          try { await traerDia(s, f) } catch (e) { fallidos.push({ s, f }) }
        }
      }
      // segunda pasada sobre lo que falló (el rate limit suele ceder)
      const persistentes = []
      for (const it of fallidos) {
        setRecal(`reintentando ${it.s.nombre} ${it.f.slice(8)}…`)
        await new Promise(res => setTimeout(res, 900))
        try { await traerDia(it.s, it.f) } catch (e) { persistentes.push(it) }
      }
      await cargarMes()
      if (persistentes.length) {
        setErr(`⚠ ${persistentes.length} día(s) no se pudieron traer de BSALE: ${persistentes.slice(0, 8).map(x => `${x.s.nombre.split(' ')[0]} ${x.f.slice(8)}`).join(', ')}${persistentes.length > 8 ? '…' : ''}. Vuelve a apretar Recalcular para completarlos.`)
      } else { setErr('') }
    } finally { setRecal('') }
  }

  const cargarVentas = async () => {
    setLoading(true); setErr('')
    const out = {}
    try {
      // secuencial a propósito: BSALE castiga las llamadas en paralelo (429)
      await (async () => { for (const s of activas) {
        try {
          const r = await callBsale('ventas_dia', { office_id: s.bsale_office_id, fecha })
          out[s.sucursal_id] = { total: r.total || 0, docs: r.docs || 0, ventas: r.ventas || [] }
        } catch (e) { out[s.sucursal_id] = { error: String(e?.message || e), total: 0, docs: 0, ventas: [] } }
      } })()
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
      <button onClick={recalcularMes} disabled={!!recal || loading} title="Trae desde BSALE la venta final de cada día del mes y corrige el acumulado" style={{ background: '#fff', color: C2, border: '1px solid #e0def0', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: recal ? 'default' : 'pointer' }}>{recal ? `Recalculando ${recal}…` : '🧮 Recalcular mes (BSALE)'}</button>
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
      <PacingMes gen={gen} resumenes={resumenes} activas={activas} isMobile={isMobile} />
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

      {/* Desglose: venta por día por sucursal */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : (activas.length > 1 ? 'repeat(auto-fill,minmax(420px,1fr))' : '1fr'), gap: 12, marginBottom: 16 }}>
        {activas.map(s => {
          const serie = diaBranch.filter(d => d.suc === s.sucursal_id && (d.venta > 0 || d.meta > 0)).sort((a, b) => b.fecha.localeCompare(a.fecha))
          if (serie.length === 0) return null
          const totV = serie.reduce((a, d) => a + d.venta, 0)
          const totD = serie.reduce((a, d) => a + d.docs, 0)
          return (
            <div key={s.sucursal_id} style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <div style={{ ...cardT, padding: '12px 14px 0' }}>📅 Venta por día · {s.nombre}</div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="com">
                  <thead><tr><th>Fecha</th><th style={{ textAlign: 'right' }}>Venta</th><th style={{ textAlign: 'right' }}>Meta día</th><th style={{ textAlign: 'right' }}>Cumpl.</th><th style={{ textAlign: 'right' }}>Docs</th><th style={{ textAlign: 'right' }}>Ticket</th></tr></thead>
                  <tbody>
                    {serie.map(d => {
                      const p2 = d.meta > 0 ? pct(d.venta, d.meta) : null
                      return (
                        <tr key={d.fecha}>
                          <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtFecha(d.fecha)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(d.venta)}</td>
                          <td style={{ textAlign: 'right', color: '#8b88a8' }}>{d.meta > 0 ? fmtK(d.meta) : '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 800, color: p2 === null ? '#c9c7dd' : colorCump(p2) }}>{p2 === null ? '—' : p2 + '%'}</td>
                          <td style={{ textAlign: 'right', color: '#8b88a8' }}>{fN(d.docs)}</td>
                          <td style={{ textAlign: 'right', color: '#5a5a6e' }}>{d.docs > 0 ? fmtK(d.venta / d.docs) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot><tr style={{ borderTop: '2px solid #eceaf6' }}>
                    <td style={{ fontWeight: 800 }}>Total</td>
                    <td style={{ textAlign: 'right', fontWeight: 800 }}>{fmt(totV)}</td>
                    <td /><td />
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#8b88a8' }}>{fN(totD)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#5a5a6e' }}>{totD > 0 ? fmtK(totV / totD) : '—'}</td>
                  </tr></tfoot>
                </table>
              </div>
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
function TabCotizaciones({ sucursales, vendedores, sucSel, setSucSel, seg, setSeg, cu, esGerente, isMobile, vista = 'lista', setVista = () => {} }) {
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
  const [verDescartadas, setVerDescartadas] = useState(false)
  // Base de clientes: dato sensible. Solo jefes, coordinadores y gerencia.
  const puedeDescargarClientes = perfilC.rol !== 'vendedor'
  // Descartar saca la cotización del registro y de las métricas: solo jefatura
  // y coordinación. El vendedor declara "perdida" con motivo, no descarta.
  const puedeDescartar = perfilC.rol !== 'vendedor'
  const descargarClientes = async () => {
    if (!puedeDescargarClientes) return
    const datos = filtradas.map(r => ({
      'N° cotización': r.number,
      'Fecha': r.date ? fmtFecha(r.date) : '',
      'Cliente': r.cliente?.name || '',
      'Teléfono': r.cliente?.phone || '',
      'Email': r.cliente?.email || '',
      'Monto': Number(r.total || 0),
      'Vendedor': r.seller?.name || '',
      'Sucursal': sucursales.find(s => s.sucursal_id === r.sucursal_id)?.nombre || r.sucursal_id || '',
      'Estado': ESTADOS[r.estado]?.label || r.estado,
      'Próximo contacto': r.fecha_proximo ? fmtFecha(r.fecha_proximo) : '',
      'Fecha despacho': r.fecha_despacho ? fmtFecha(r.fecha_despacho) : '',
      'Motivo de pérdida': r.motivo || '',
      'Días': daysAgo(r.date),
    }))
    if (!datos.length) return
    const ws = XLSX.utils.json_to_sheet(datos)
    ws['!cols'] = [{ wch: 12 }, { wch: 11 }, { wch: 30 }, { wch: 15 }, { wch: 26 }, { wch: 13 }, { wch: 20 }, { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 7 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes')
    const hoyF = new Date().toLocaleDateString('en-CA')
    XLSX.writeFile(wb, `Clientes_Cotizaciones_${hoyF}.xlsx`)
    // registro de auditoría (silencioso si la tabla aún no existe)
    try {
      await supabase.from('com_exportaciones').insert({
        usuario: cu?.nombre || cu?.correo || null, rol: perfilC.rol,
        sucursal_id: perfilC.verTodo ? (fSuc || 'todas') : perfilC.sucursal,
        tipo: 'clientes_cotizaciones', registros: datos.length,
        filtros: `${d1}→${d2}${fEstado ? ' · ' + fEstado : ''}${fVend ? ' · vend ' + fVend : ''}`,
      })
    } catch (e) { /* auditoría opcional */ }
  }
  const cambiarEstadoRapido = async (r, nuevo) => {
    const row = {
      doc_id: r.id, bsale_number: String(r.number), estado: nuevo,
      fecha_proximo_contacto: r.fecha_proximo || null, observaciones: r.obs || null,
      motivo_perdida: r.motivo || null, vendedor_bsale_id: r.seller?.id ? parseInt(r.seller.id) : null,
      sucursal_id: r.sucursal_id || null, updated_at: new Date().toISOString(),
      updated_by: cu?.nombre || cu?.correo || null,
    }
    const { error } = await supabase.from('com_seguimiento').upsert(row, { onConflict: 'doc_id' })
    if (!error) {
      setSeg(prev => { const o = prev.filter(x => x.doc_id !== row.doc_id); return [...o, row] })
      try {
        await supabase.from('com_seguimiento_historial').insert({
          doc_id: String(r.id), bsale_number: String(r.number), estado: nuevo,
          nota: nuevo === 'descartada' ? 'Descartada del registro (botón rápido)' : 'Restaurada al registro',
          autor: cu?.nombre || cu?.correo || null,
        })
      } catch (e) { /* la bitácora no debe bloquear el cambio de estado */ }
    }
  }
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
      fecha_despacho: s?.fecha_despacho || '',
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

  // Alcance de datos. Un vendedor sin ficha en com_vendedores NO tiene identidad
  // comercial resoluble: se cierra el acceso (antes veía TODO por caer al else).
  const sinFicha = esVendC && !miIdC
  const rowsV = esVendC
    ? (miIdC ? rows.filter(r => String(r.seller?.id) === miIdC) : [])
    : (!perfilC.verTodo && perfilC.sucursal ? rows.filter(r => r.sucursal_id === perfilC.sucursal) : rows)
  // Salud por cotización desde el motor único (misma verdad que el Radar y el correo)
  const [saludMap, setSaludMap] = useState({})
  useEffect(() => {
    (async () => {
      try {
        let q = supabase.from('v_com_pipeline').select('id,salud,nivel,atraso_dias,dias_sin_gestion,edad_dias')
        if (esVendC) q = q.eq('vendedor_bsale_id', String(miIdC || '__sin_ficha__'))
        else if (!perfilC.verTodo && perfilC.sucursal) q = q.eq('sucursal_id', perfilC.sucursal)
        const { data } = await q.limit(6000)
        const m = {}; (data || []).forEach(x => { m[x.id] = x }); setSaludMap(m)
      } catch (e) { /* sin salud: la lista funciona igual */ }
    })()
    // eslint-disable-next-line
  }, [perfilC.sucursal, miIdC, seg])
  const filtradas = rowsV.filter(r => {
    if (!verDescartadas && fEstado !== 'descartada' && r.estado === 'descartada') return false
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
  let base = rowsV.filter(r => !fSuc || r.sucursal_id === fSuc)
  /* Descartadas fuera de todas las métricas del registro (reversible) */
  const baseAll = base
  base = base.filter(r => r.estado !== 'descartada')
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

  const selectorVista = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'inline-flex', background: '#eceaf6', borderRadius: 10, padding: 3 }}>
        {[['lista', '📋 Cotizaciones'], ['radar', esVendC ? '📡 Mi radar' : '📡 Radar']].map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)}
            style={{ background: vista === k ? '#fff' : 'transparent', color: vista === k ? C2 : '#8b88a8', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>{l}</button>
        ))}
      </div>
      {vista === 'radar' && <span style={{ fontSize: 11, color: '#8b88a8' }}>{esVendC ? 'Tus cotizaciones abiertas ordenadas por valor y urgencia.' : 'Salud del pipeline: vencidas, estancadas, escaladas y cierre asistido.'}</span>}
    </div>
  )
  if (vista === 'radar') return (
    <div>
      {selectorVista}
      <TabRadar {...{ sucursales, vendedores, cu, esGerente, isMobile }} soloVendedor={esVendC ? (miIdC || '__sin_ficha__') : null} />
    </div>
  )
  return (
    <div>
      {selectorVista}
      {sinFicha && (
        <div style={{ background: '#FFF4E5', border: '1px solid #FFD9A8', borderLeft: '4px solid #FF9500', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#B25000', marginBottom: 3 }}>Tu perfil de vendedor aún no está configurado</div>
          <div style={{ fontSize: 12, color: '#8a6a3a' }}>Tu usuario todavía no está vinculado a un vendedor de BSALE, así que no se pueden mostrar tus cotizaciones. Avísale a tu jefe de tienda para que lo active.</div>
        </div>
      )}
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
      <EtapasPipeline rows={base} fEstado={fEstado} setFEstado={setFEstado} isMobile={isMobile} />
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
        {(() => { const nDesc = baseAll.filter(r => r.estado === 'descartada').length; return nDesc > 0 && puedeDescartar ? (
          <button onClick={() => setVerDescartadas(v => !v)} title="Las descartadas se ocultan del registro y las métricas" style={{ background: verDescartadas ? '#B0B0B825' : '#fff', color: '#8b88a8', border: '1px solid #e0def0', borderRadius: 8, padding: '7px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>🗑️ {verDescartadas ? 'Ocultar' : 'Ver'} descartadas ({nDesc})</button>
        ) : null })()}
        {puedeDescargarClientes && (
          <button onClick={descargarClientes} title="Exporta a Excel los clientes de las cotizaciones filtradas. Disponible solo para jefatura y coordinación."
            style={{ background: '#248A3D12', color: '#248A3D', border: '1px solid #cfe8d7', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            ⬇️ Descargar clientes ({filtradas.length})
          </button>
        )}
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
              <th style={{ textAlign: 'right' }}>Monto</th><th>Estado</th><th>Próx. / Despacho</th><th>Alerta</th><th>Días</th><th style={{ textAlign: 'center' }}></th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 ? (
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: 40, color: '#8b88a8' }}>{loading ? 'Cargando…' : 'Sin cotizaciones para el filtro actual.'}</td></tr>
            ) : filtradas.map(r => {
              const d = daysAgo(r.date)
              const alerta = r.estado === 'sin_contactar' && d >= 3
              return (
                <tr key={r.id} className="click" onClick={() => setSel(r)}>
                  <td style={{ fontWeight: 700, color: C2 }}>#{r.number}</td>
                  <td>{fmtFecha(r.date)}</td>
                  <td style={{ fontSize: 11, color: '#5a5a6e' }}>{r.sucursal_id ? shortKey(r.sucursal_id).toUpperCase() : (r.office?.name || '—')}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cliente?.name}</td>
                  <td style={{ color: '#5a5a6e' }}>{r.seller?.name}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.total)}</td>
                  <td><Chip estado={r.estado} /></td>
                  <td style={{ color: '#5856D6', fontWeight: r.estado === 'en_despacho' ? 700 : 400 }}>{r.estado === 'en_despacho' && r.fecha_despacho ? '🚚 ' + fmtFecha(r.fecha_despacho) : (r.fecha_proximo && daysAgo(r.fecha_proximo) > 0 ? <span style={{ color: '#FF3B30' }}>{fmtFecha(r.fecha_proximo)}</span> : (r.fecha_proximo ? <span style={{ color: '#5a5a6e' }}>{fmtFecha(r.fecha_proximo)}</span> : <span style={{ color: '#8b88a8' }}>—</span>))}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{(() => {
                    const sl = saludMap[r.id]; const sv = sl && SALUD_R[sl.salud]
                    if (!sv) return <span style={{ color: '#c9c7dd' }}>—</span>
                    if (sl.salud === 'al_dia') return <span style={{ fontSize: 11, color: '#248A3D', fontWeight: 700 }}>✅ al día</span>
                    return (<><span style={{ fontSize: 11, fontWeight: 800, color: sv.c, background: sv.c + '14', borderRadius: 6, padding: '2px 7px' }}>{sv.ic} {sv.l}</span>
                      <div style={{ fontSize: 10.5, color: '#8b88a8', marginTop: 2 }}>{detalleSaludR(sl)}{sl.nivel === 'jefe' ? ' · escalada' : ''}</div></>)
                  })()}</td>
                  <td>{alerta ? <span style={{ color: '#FF3B30', fontWeight: 700 }}>{d}d ⚠️</span> : <span style={{ color: '#8b88a8' }}>{d}d</span>}</td>
                  <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    {!puedeDescartar ? null : r.estado === 'descartada'
                      ? <button onClick={() => cambiarEstadoRapido(r, 'sin_contactar')} title="Restaurar al registro" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#8b88a8' }}>↩︎</button>
                      : <button onClick={() => { if (confirm(`¿Descartar la cotización #${r.number} de ${r.cliente?.name || ''}? Saldrá del registro y las métricas (reversible).`)) cambiarEstadoRapido(r, 'descartada') }} title="Descartar del registro" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, opacity: .55 }}>🗑️</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {sel && <SheetSeguimiento cot={sel} onClose={() => setSel(null)} cu={cu} sucSel={sel.sucursal_id || sucSel} puedeDescartar={puedeDescartar}
        onSaved={(row) => { setSeg(prev => { const o = prev.filter(x => x.doc_id !== row.doc_id); return [...o, row] }); setSel(null) }} />}
    </div>
  )
}

/* Sheet de seguimiento */
function SheetSeguimiento({ cot, onClose, cu, sucSel, onSaved, puedeDescartar = false }) {
  const [estado, setEstado] = useState(cot.estado || 'sin_contactar')
  const [fechaProx, setFechaProx] = useState(cot.fecha_proximo || '')
  const [fechaDesp, setFechaDesp] = useState(cot.fecha_despacho || '')
  const [obs, setObs] = useState('')
  const [hist, setHist] = useState([])
  const MIN_NOTA = 10
  const notaLimpia = (obs || '').trim()
  const notaOk = notaLimpia.length >= MIN_NOTA
  useEffect(() => {
    supabase.from('com_seguimiento_historial').select('*').eq('doc_id', String(cot.id))
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setHist(data || []), () => {})
  }, [cot.id])
  const [motivo, setMotivo] = useState(cot.motivo || '')
  const [nroBoleta, setNroBoleta] = useState('')
  const [montoReal, setMontoReal] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const guardar = async () => {
    setErr('')
    // Regla de pipeline: "Sin contactar" es el estado inicial automático, no un resultado.
    // Toda gestión registra en qué quedó el cliente (estándar Pipedrive / HubSpot).
    if (estado === 'sin_contactar') {
      setErr('Elige el resultado de esta gestión. Si no lograste hablar con el cliente, márcala como "Contactado" con la nota del intento (ej. "no contesta") y agenda el próximo contacto.'); return
    }
    // Regla de método: toda gestión queda registrada. Sin nota no se guarda.
    if (!notaOk) {
      setErr(`Escribe la nota de esta gestión: mínimo ${MIN_NOTA} caracteres (llevas ${notaLimpia.length}). Es lo que queda en la bitácora de la cotización.`); return
    }
    // Reglas de método: sin próximo paso no hay negociación; sin motivo no hay pérdida
    if ((estado === 'contactado' || estado === 'en_negociacion') && !fechaProx) {
      setErr('Define la fecha del próximo contacto: una cotización en gestión sin próximo paso no se puede guardar.'); return
    }
    if (estado === 'perdida' && !motivo) {
      setErr('Selecciona el motivo de pérdida — es lo que permite aprender de las cotizaciones que se caen.'); return
    }
    if (estado === 'en_despacho' && !fechaDesp) {
      setErr('Define la fecha de despacho comprometida.'); return
    }
    setSaving(true)
    const now = new Date().toISOString()
    const row = {
      doc_id: cot.id,
      bsale_number: String(cot.number),
      estado,
      fecha_proximo_contacto: fechaProx || null,
      observaciones: (obs || '').trim() ? obs.trim() : (cot.obs || null),
      motivo_perdida: estado === 'perdida' ? (motivo || null) : null,
      fecha_despacho: estado === 'en_despacho' ? (fechaDesp || null) : null,
      vendedor_bsale_id: cot.seller?.id ? parseInt(cot.seller.id) : null,
      sucursal_id: sucSel || null,
      nro_boleta: estado === 'convertida' ? (nroBoleta || null) : null,
      monto_real: estado === 'convertida' && montoReal ? Number(montoReal) : null,
      updated_at: now,
      updated_by: cu?.nombre || cu?.correo || null,
    }
    try {
      const { error } = await supabase.from('com_seguimiento').upsert(row, { onConflict: 'doc_id' })
      if (!error) {
        try {
          await supabase.from('com_seguimiento_historial').insert({
            doc_id: String(cot.id), bsale_number: String(cot.number), estado,
            nota: (obs || '').trim() || null, autor: cu?.nombre || cu?.correo || null,
          })
        } catch (e) { /* la bitácora no debe bloquear el guardado del seguimiento */ }
        setHist(h => [{ id: 'tmp' + Date.now(), estado, nota: (obs || '').trim() || null, autor: cu?.nombre || cu?.correo, created_at: new Date().toISOString() }, ...h])
      }
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
        <div style={{ fontSize: 12, color: '#5a5a6e', marginBottom: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {cot.cliente?.phone ? (() => {
            const dig = String(cot.cliente.phone).replace(/\D/g, '')
            const wa = dig.startsWith('56') ? dig : dig.length === 9 ? '56' + dig : dig.length === 8 ? '569' + dig : dig
            return (
              <>
                <a href={`tel:${cot.cliente.phone}`} style={{ color: '#1c1c1e', fontWeight: 700, textDecoration: 'none' }}>📞 {cot.cliente.phone}</a>
                <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer"
                  style={{ background: '#25D36618', color: '#128C4B', fontWeight: 800, textDecoration: 'none', borderRadius: 7, padding: '3px 10px', fontSize: 11.5 }}>💬 WhatsApp</a>
              </>
            )
          })() : <span style={{ color: '#B25000', fontWeight: 600 }}>📵 sin teléfono registrado en BSALE</span>}
          {cot.cliente?.email && <span>✉️ {cot.cliente.email}</span>}
          <span style={{ color: '#8b88a8' }}>👤 {cot.seller?.name}</span>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#3a3a3c', display: 'block', marginBottom: 6 }}>Resultado de la gestión</label>
          {estado === 'sin_contactar' && <div style={{ fontSize: 12, color: '#B25E09', background: '#FFF4E5', borderRadius: 8, padding: '7px 10px', marginBottom: 8, fontWeight: 600 }}>Esta cotización aún no tiene gestión. Elige en qué quedó el cliente para poder guardar.</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(ESTADOS).filter(([k]) => k !== 'sin_contactar').filter(([k]) => k !== 'descartada' || puedeDescartar || estado === 'descartada').map(([k, v]) => (
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
        {estado === 'en_despacho' && (
          <Field l="Fecha de despacho comprometida">
            <input type="date" className="com-inp" value={fechaDesp} onChange={e => setFechaDesp(e.target.value)} />
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
        <Field l="Nota de esta gestión · obligatoria (queda en la bitácora)">
          <textarea className="com-inp" rows={3} value={obs} onChange={e => setObs(e.target.value)}
            placeholder="Qué se habló o acordó con el cliente…"
            style={{ resize: 'vertical', border: notaOk ? '1px solid #e0def0' : '1px solid #FFD9A8', background: notaOk ? '#fff' : '#FFFCF7' }} />
          <div style={{ fontSize: 10.5, marginTop: 3, fontWeight: 700, color: notaOk ? '#248A3D' : '#B25000' }}>
            {notaOk ? `✓ ${notaLimpia.length} caracteres` : `Faltan ${MIN_NOTA - notaLimpia.length} caracteres (mínimo ${MIN_NOTA})`}
          </div>
        </Field>

        {hist.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.03em', color: '#8b88a8', marginBottom: 6 }}>📓 Bitácora de la cotización ({hist.length})</div>
            <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid #f0eff7', borderRadius: 10 }}>
              {hist.map(h => {
                const eh = ESTADOS[h.estado] || {}
                return (
                  <div key={h.id} style={{ padding: '8px 12px', borderBottom: '1px solid #f7f7fb' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: eh.c || '#8b88a8' }}>{eh.ic || ''} {eh.label || h.estado}</span>
                      <span style={{ fontSize: 10.5, color: '#a6a3bd', marginLeft: 'auto' }}>{h.autor || '—'} · {new Date(h.created_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {h.nota && <div style={{ fontSize: 12.5, color: '#3a3a3c', marginTop: 3 }}>{h.nota}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {err && <div style={{ padding: 10, background: '#FF3B3010', color: '#FF3B30', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: 9, background: '#f2f2f7', color: '#3a3a3c', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={guardar} disabled={saving || !notaOk || estado === 'sin_contactar'}
            title={notaOk ? '' : `Escribe la nota de esta gestión (mínimo ${MIN_NOTA} caracteres)`}
            style={{ padding: '10px 18px', borderRadius: 9, background: (saving || !notaOk) ? '#c7c5e0' : `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: (saving || !notaOk) ? 'default' : 'pointer' }}>{saving ? 'Guardando…' : 'Guardar seguimiento'}</button>
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
   TAB — DESPACHOS Y RETIROS PROGRAMADOS
   Vincula Comercial con log_picking_ordenes (Logística/Picking). El vendedor
   completa datos de despacho para boletas que BSALE ya marcó "por despachar"
   (línea de flete detectada por picking-motor), y puede promover cualquier
   boleta 'inmediata' a despacho programado o retiro en tienda buscándola por
   folio o cliente. No requiere columnas nuevas: reutiliza tipo_entrega /
   modalidad_entrega / fecha_programada / despacho_* ya usadas por el modal
   "Programar entrega" de LogisticaApp.
   ═══════════════════════════════════════════════════════════════════════════ */
function TabDespachos({ sucursales, vendedores, sucSel, setSucSel, cu, esGerente, isMobile }) {
  const perfilD = resolverPerfil(cu, vendedores, esGerente)
  const activas = sucursales.filter(s => s.activa)
  const nCols = (perfilD.verTodo && !sucSel) ? 7 : 6

  const [pendientes, setPendientes] = useState([])
  const [loadingP, setLoadingP] = useState(true)
  const [termino, setTermino] = useState('')
  const [resultados, setResultados] = useState(null)   // null = sin buscar aún
  const [buscando, setBuscando] = useState(false)
  const [errB, setErrB] = useState('')
  const [sel, setSel] = useState(null)
  const [msg, setMsg] = useState('')

  const flash = t => { setMsg(t); setTimeout(() => setMsg(m => (m === t ? '' : m)), 4000) }

  const CAMPOS = 'id,folio,bsale_doc_type,cliente_nombre,cliente_rut,sucursal_codigo,vendedor_nombre,' +
    'fecha_programada,despacho_direccion,despacho_comuna,despacho_contacto,despacho_telefono,despacho_telefono2,despacho_obs,' +
    'despacho_pago,despacho_doc_tipo,despacho_doc_numero,despacho_doc_valor,despacho_doc_emitir,despacho_valor,' +
    'despacho_registrado_at,despacho_registrado_por,total_items,total_unidades,emitida_at,urgente,estado,' +
    'tipo_entrega,modalidad_entrega'

  const cargarPendientes = async () => {
    setLoadingP(true)
    let q = supabase.from('log_picking_ordenes').select(CAMPOS)
      .eq('tipo_entrega', 'programada').eq('modalidad_entrega', 'despacho')
      .is('despacho_registrado_at', null)
      .not('estado', 'in', '(entregada,anulada)')
      .order('emitida_at', { ascending: true })
    if (!perfilD.verTodo) q = q.eq('sucursal_codigo', perfilD.sucursal)
    else if (sucSel) q = q.eq('sucursal_codigo', sucSel)
    const { data, error } = await q
    if (!error) setPendientes(data || [])
    setLoadingP(false)
  }
  useEffect(() => { cargarPendientes() /* eslint-disable-next-line */ }, [sucSel, perfilD.sucursal, perfilD.verTodo])

  const buscar = async () => {
    const t = termino.trim()
    if (!t) { setResultados(null); return }
    setBuscando(true); setErrB('')
    let q = supabase.from('log_picking_ordenes').select(CAMPOS)
      .not('estado', 'in', '(entregada,anulada)')
      .or(`folio.ilike.%${t}%,cliente_nombre.ilike.%${t}%`)
      .order('emitida_at', { ascending: false }).limit(20)
    if (!perfilD.verTodo) q = q.eq('sucursal_codigo', perfilD.sucursal)
    else if (sucSel) q = q.eq('sucursal_codigo', sucSel)
    const { data, error } = await q
    if (error) setErrB(error.message)
    setResultados(data || [])
    setBuscando(false)
  }

  const guardar = async payload => {
    const { error } = await supabase.from('log_picking_ordenes').update(payload).eq('id', sel.id)
    if (error) { flash('⚠️ ' + error.message); return }
    flash('✅ Datos guardados')
    setSel(null)
    cargarPendientes()
    if (resultados !== null) buscar()
  }

  const renderFila = (o, destacar) => (
    <tr key={o.id} className="click" onClick={() => setSel(o)}>
      <td style={{ fontFamily: 'monospace', fontWeight: 800 }}>{o.urgente ? '⚡' : ''}#{o.folio}</td>
      {(perfilD.verTodo && !sucSel) && <td style={{ fontSize: 11, color: '#8b88a8' }}>{activas.find(s => s.sucursal_id === o.sucursal_codigo)?.nombre || o.sucursal_codigo}</td>}
      <td>{o.cliente_nombre || <span style={{ color: '#c7c5db' }}>—</span>}</td>
      <td style={{ fontSize: 11.5, color: '#5a5a6e' }}>{o.vendedor_nombre || '—'}</td>
      <td style={{ fontSize: 11.5, color: '#8b88a8' }}>{o.emitida_at ? fmtFecha(o.emitida_at.slice(0, 10)) : '—'}</td>
      <td>
        {o.tipo_entrega === 'programada'
          ? <span style={{ fontSize: 10, fontWeight: 800, color: o.modalidad_entrega === 'despacho' ? C1 : '#248A3D', background: o.modalidad_entrega === 'despacho' ? C1 + '15' : '#34C75915', padding: '3px 9px', borderRadius: 10 }}>
              {o.modalidad_entrega === 'despacho' ? '🚚 Despacho' : '🏪 Retiro prog.'}
            </span>
          : <span style={{ fontSize: 10, fontWeight: 700, color: '#8b88a8' }}>Inmediata</span>}
        {o.despacho_pago && <span style={{ fontSize: 9, fontWeight: 800, display: 'block', marginTop: 2, color: o.despacho_pago === 'pagado' ? '#248A3D' : '#C93400' }}>{o.despacho_pago === 'pagado' ? '💰 pagado' : '⏳ por pagar'}</span>}
      </td>
      <td style={{ textAlign: 'right' }}>
        {destacar
          ? <span style={{ fontSize: 10, fontWeight: 800, color: '#C93400' }}>⏳ completar</span>
          : <span style={{ fontSize: 11, color: C1, fontWeight: 700 }}>{o.despacho_registrado_at ? 'Editar →' : 'Completar →'}</span>}
      </td>
    </tr>
  )

  return (
    <div style={{ padding: isMobile ? 12 : 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>🚚 Despachos y retiros programados</div>
        {perfilD.verTodo && (
          <select className="com-inp" style={{ width: 170 }} value={sucSel} onChange={e => setSucSel(e.target.value)}>
            <option value="">Todas las sucursales</option>
            {activas.map(s => <option key={s.sucursal_id} value={s.sucursal_id}>{s.nombre}</option>)}
          </select>
        )}
      </div>

      {msg && <div style={{ padding: '7px 12px', borderRadius: 8, background: msg.startsWith('✅') ? '#34C75915' : '#FF950015', color: msg.startsWith('✅') ? '#248A3D' : '#C93400', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <input className="com-inp" placeholder="Buscar por folio o cliente…" value={termino}
          onChange={e => setTermino(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscar()}
          style={{ maxWidth: 320 }} />
        <button onClick={buscar} disabled={buscando}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: C1, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          {buscando ? '…' : '🔍 Buscar'}
        </button>
        {resultados !== null && (
          <button onClick={() => { setTermino(''); setResultados(null) }}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e0def0', background: '#fff', color: '#6D6D72', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>✕ Limpiar</button>
        )}
      </div>
      {errB && <div style={{ color: '#C93400', fontSize: 12, marginBottom: 10 }}>{errB}</div>}

      {resultados !== null && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8b88a8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Resultados ({resultados.length})</div>
          <table className="com">
            <thead><tr><th>Folio</th>{(perfilD.verTodo && !sucSel) && <th>Sucursal</th>}<th>Cliente</th><th>Vendedor</th><th>Emitida</th><th>Entrega</th><th></th></tr></thead>
            <tbody>
              {resultados.length === 0
                ? <tr><td colSpan={nCols} style={{ textAlign: 'center', padding: 24, color: '#8b88a8' }}>Sin resultados.</td></tr>
                : resultados.map(o => renderFila(o, false))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 700, color: '#8b88a8', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Pendientes de datos de despacho ({pendientes.length})</div>
      <table className="com">
        <thead><tr><th>Folio</th>{(perfilD.verTodo && !sucSel) && <th>Sucursal</th>}<th>Cliente</th><th>Vendedor</th><th>Emitida</th><th>Entrega</th><th></th></tr></thead>
        <tbody>
          {loadingP
            ? <tr><td colSpan={nCols} style={{ textAlign: 'center', padding: 24, color: '#8b88a8' }}>Cargando…</td></tr>
            : pendientes.length === 0
              ? <tr><td colSpan={nCols} style={{ textAlign: 'center', padding: 24, color: '#8b88a8' }}>Sin pendientes 🎉</td></tr>
              : pendientes.map(o => renderFila(o, true))}
        </tbody>
      </table>

      {sel && <SheetDespacho orden={sel} cu={cu} onClose={() => setSel(null)} onGuardar={guardar} />}
    </div>
  )
}

function SheetDespacho({ orden, cu, onClose, onGuardar }) {
  const [modalidad, setModalidad] = useState(orden.modalidad_entrega || 'despacho')
  const [fecha, setFecha] = useState(orden.fecha_programada || hoy())
  const [direccion, setDireccion] = useState(orden.despacho_direccion || '')
  const [comuna, setComuna] = useState(orden.despacho_comuna || '')
  const [contacto, setContacto] = useState(orden.despacho_contacto || '')
  const [telefono, setTelefono] = useState(orden.despacho_telefono || '')
  const [telefono2, setTelefono2] = useState(orden.despacho_telefono2 || '')
  const [pago, setPago] = useState(orden.despacho_pago || '')
  const [docTipo, setDocTipo] = useState(orden.despacho_doc_tipo || '')
  const [docNumero, setDocNumero] = useState(orden.despacho_doc_numero || '')
  const [docValor, setDocValor] = useState(orden.despacho_doc_valor ?? '')
  const [valorDespacho, setValorDespacho] = useState(orden.despacho_valor ?? '')
  const [docEmitir, setDocEmitir] = useState(orden.despacho_doc_emitir || '')
  const [obs, setObs] = useState(orden.despacho_obs || '')
  const [busy, setBusy] = useState(false)

  const esDesp = modalidad === 'despacho'
  // Pagado: solo documentos que acreditan pago. Por pagar: incluye cotización.
  const tiposDoc = pago === 'pagado'
    ? [['boleta', 'Boleta'], ['factura', 'Factura']]
    : [['cotizacion', 'Cotización'], ['boleta', 'Boleta'], ['factura', 'Factura']]

  const setPagoSafe = p => { setPago(p); if (p === 'pagado' && docTipo === 'cotizacion') { setDocTipo(''); setDocEmitir('') } }

  const lbl = { fontSize: 11, fontWeight: 700, color: '#6D6D72', marginBottom: 4 }
  const pill = (activo) => ({ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: activo ? '#1a1a2e' : '#F2F2F7', color: activo ? '#fff' : '#6D6D72' })

  const guardar = async () => {
    if (!fecha) { alert('Indica la fecha de despacho'); return }
    if (esDesp) {
      if (!direccion.trim() || !comuna.trim()) { alert('Dirección y comuna son obligatorias para despacho a domicilio'); return }
      if (!telefono.trim()) { alert('Teléfono 1 es obligatorio para despacho'); return }
      if (!pago) { alert('Indica si el despacho está pagado o por pagar'); return }
      if (valorDespacho === '' || isNaN(Number(valorDespacho)) || Number(valorDespacho) < 0) { alert('Indica el valor del despacho'); return }
      if (!docTipo) { alert('Indica el documento del despacho (cotización, boleta o factura)'); return }
      if (!docNumero.trim()) { alert('Indica el número del documento'); return }
      if (docValor === '' || isNaN(Number(docValor)) || Number(docValor) < 0) { alert('Indica el valor del documento'); return }
      if (docTipo === 'cotizacion' && !docEmitir) { alert('Indica qué documento se emitirá una vez cobrado el despacho'); return }
    }
    setBusy(true)
    const payload = {
      tipo_entrega: 'programada', modalidad_entrega: modalidad, fecha_programada: fecha,
      despacho_registrado_por: cu?.nombre || cu?.correo || 'Comercial',
      despacho_registrado_at: new Date().toISOString(),
      despacho_obs: obs || null,
      despacho_direccion: esDesp ? direccion.trim() : null,
      despacho_comuna: esDesp ? comuna.trim() : null,
      despacho_contacto: esDesp ? (contacto.trim() || null) : null,
      despacho_telefono: esDesp ? telefono.trim() : null,
      despacho_telefono2: esDesp ? (telefono2.trim() || null) : null,
      despacho_pago: esDesp ? pago : null,
      despacho_valor: esDesp ? Number(valorDespacho) : null,
      despacho_doc_tipo: esDesp ? docTipo : null,
      despacho_doc_numero: esDesp ? docNumero.trim() : null,
      despacho_doc_valor: esDesp ? Number(docValor) : null,
      despacho_doc_emitir: esDesp && docTipo === 'cotizacion' ? docEmitir : null,
    }
    await onGuardar(payload)
    setBusy(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 460, maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>#{orden.folio} · {orden.cliente_nombre || 'Sin cliente'}</div>
        <div style={{ fontSize: 11.5, color: '#8b88a8', marginBottom: 14 }}>Vendedor: <b style={{ color: '#5a5a6e' }}>{orden.vendedor_nombre || '—'}</b> · {orden.bsale_doc_type === 'factura' ? 'Factura' : orden.bsale_doc_type === 'cotizacion' ? 'Cotización' : 'Boleta'}{orden.bsale_doc_type === 'cotizacion' ? ' (por cobrar)' : ' de venta'}</div>

        <div style={lbl}>Modalidad de entrega</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[['retiro', '🏪 Retiro en tienda'], ['despacho', '🚚 Despacho a domicilio']].map(([m, l]) => (
            <button key={m} onClick={() => setModalidad(m)} style={pill(modalidad === m)}>{l}</button>
          ))}
        </div>

        <div style={lbl}>Fecha de despacho</div>
        <input type="date" className="com-inp" value={fecha} min={hoy()} onChange={e => setFecha(e.target.value)} style={{ marginBottom: 14 }} />

        {esDesp && (<>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1.4 }}>
              <div style={lbl}>Tipo de despacho</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[['pagado', '💰 Pagado'], ['por_pagar', '⏳ Por pagar']].map(([p, l]) => (
                  <button key={p} onClick={() => setPagoSafe(p)} style={pill(pago === p)}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={lbl}>Valor despacho ($)</div>
              <input className="com-inp" type="number" min="0" value={valorDespacho} onChange={e => setValorDespacho(e.target.value)} placeholder="0" />
            </div>
          </div>

          <div style={lbl}>Documento del despacho</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {tiposDoc.map(([t, l]) => (
              <button key={t} onClick={() => { setDocTipo(t); if (t !== 'cotizacion') setDocEmitir('') }} style={pill(docTipo === t)}>{l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={lbl}>N° documento</div>
              <input className="com-inp" value={docNumero} onChange={e => setDocNumero(e.target.value)} placeholder="Folio del documento" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={lbl}>Valor documento ($)</div>
              <input className="com-inp" type="number" min="0" value={docValor} onChange={e => setDocValor(e.target.value)} placeholder="0" />
            </div>
          </div>

          {docTipo === 'cotizacion' && (<>
            <div style={lbl}>Documento a emitir una vez cobrado el despacho</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {[['boleta', 'Boleta'], ['factura', 'Factura']].map(([t, l]) => (
                <button key={t} onClick={() => setDocEmitir(t)} style={pill(docEmitir === t)}>{l}</button>
              ))}
            </div>
          </>)}

          <div style={lbl}>Dirección</div>
          <input className="com-inp" value={direccion} onChange={e => setDireccion(e.target.value)} style={{ marginBottom: 10 }} />
          <div style={lbl}>Comuna</div>
          <input className="com-inp" value={comuna} onChange={e => setComuna(e.target.value)} style={{ marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={lbl}>Teléfono 1</div>
              <input className="com-inp" value={telefono} onChange={e => setTelefono(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={lbl}>Teléfono 2 (opcional)</div>
              <input className="com-inp" value={telefono2} onChange={e => setTelefono2(e.target.value)} />
            </div>
          </div>
          <div style={lbl}>Contacto (quien recibe, opcional)</div>
          <input className="com-inp" value={contacto} onChange={e => setContacto(e.target.value)} style={{ marginBottom: 10 }} />
        </>)}

        <div style={lbl}>Observaciones {modalidad === 'retiro' ? '' : '(opcional)'}</div>
        <textarea className="com-inp" value={obs} onChange={e => setObs(e.target.value)} rows={2} style={{ marginBottom: 16, resize: 'vertical', width: '100%' }} />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #e0def0', background: '#fff', color: '#6D6D72', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
          <button onClick={guardar} disabled={busy}
            style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: C1, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

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
          {sucursales.filter(s => s.activa).map(s => (
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
function TabDashboard({ sucursales, vendedores, metas, seg, cu, esGerente, anio, setAnio, mes, setMes, feriados, isMobile, onIr }) {
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
        const [ci, vdq, inc, cot, msj, cv] = await Promise.all([
          supabase.from('com_cierres').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha'),
          supabase.from('com_ventas_dia').select('fecha,sucursal_id,venta,docs,ventas_vendedor').gte('fecha', desde).lte('fecha', hasta),
          supabase.from('com_incidencias').select('id', { count: 'exact', head: true }).neq('estado', 'cerrada'),
          supabase.from('com_cotizaciones').select('id,total,fecha,office_id').gte('fecha', desde).lte('fecha', hasta),
          supabase.from('vambe_mensajes').select('ai_contact_id,direction,user_id,assistant_id,created_at')
            .gte('created_at', desde).lte('created_at', hasta + ' 23:59:59').order('created_at', { ascending: true }).limit(20000),
          supabase.from('vambe_contactos').select('contact_id,agent_principal'),
        ])
        if (cancel) return
        // snapshot BSALE (com_ventas_dia) manda sobre el cierre: venta final del día
        const mapa = {}
        ;(ci.data || []).forEach(r => { mapa[`${r.fecha}|${r.sucursal_id}`] = r })
        ;(vdq.data || []).forEach(x => {
          const k = `${x.fecha}|${x.sucursal_id}`
          const prev = mapa[k]
          const arr = Array.isArray(x.ventas_vendedor) ? x.ventas_vendedor : []
          const vv = {}
          arr.forEach(v => {
            const sid = String(v.seller_id)
            vv[sid] = { name: v.seller_name, compromiso: Number(prev?.ventas_vendedor?.[sid]?.compromiso || 0), venta: Number(v.total || 0), docs: Number(v.count || 0) }
          })
          if (prev?.ventas_vendedor) Object.entries(prev.ventas_vendedor).forEach(([sid, pv]) => { if (!vv[sid]) vv[sid] = { ...pv, venta: 0, docs: 0 } })
          mapa[k] = {
            ...(prev || { fecha: x.fecha, sucursal_id: x.sucursal_id, meta_dia: 0, cot_convertidas: 0 }),
            venta_dia: Number(x.venta || 0), transacciones: Number(x.docs || 0),
            ventas_vendedor: Object.keys(vv).length ? vv : (prev?.ventas_vendedor || {}),
          }
        })
        setCierres(Object.values(mapa).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')))
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

      <PanelInteligencia {...{ sucursales, vendedores, fSuc, anio, mes, isMobile, onIr }} />

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
/* ═══ RADAR DE SEGUIMIENTO · pipeline estilo CRM (motor: vista v_com_pipeline) ═══ */
const SALUD_R = {
  sla_vencido:     { l: 'Sin contactar +24h', ic: '⏰', c: '#FF3B30' },
  vencida:         { l: 'Seguimiento vencido', ic: '🔴', c: '#FF3B30' },
  estancada:       { l: 'Estancada', ic: '🧊', c: '#B25000' },
  dia7:            { l: 'Día 7 sin decisión', ic: '⏳', c: '#B25000' },
  cierre_sugerido: { l: 'Cierre sugerido', ic: '🗂', c: '#8E3A9D' },
  vence_hoy:       { l: 'Vence hoy', ic: '📅', c: '#007ACC' },
  al_dia:          { l: 'Al día', ic: '✅', c: '#248A3D' },
}
const ETAPAS_R = [['sin_contactar', 'Sin contactar'], ['contactado', 'Contactado'], ['en_negociacion', 'En negociación']]
const BUCKETS_R = [[0, 2, '0–2 días'], [3, 6, '3–6 días'], [7, 13, '7–13 días'], [14, 20, '14–20 días'], [21, 99999, '21+ días']]
const BUCKET_BG = ['#EAF6EE', '#FFF8E6', '#FFEFD9', '#FFE3DE', '#F6D9EC']
const normNom = s => String(s || '—').replace(/\s+/g, ' ').trim().toLowerCase().split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ')
const dd = n => `${n} ${n === 1 ? 'día' : 'días'}`
const detalleSaludR = r =>
  r.salud === 'vencida' ? `vencido hace ${dd(r.atraso_dias)}`
  : r.salud === 'sla_vencido' ? `sin contactar hace ${dd(r.edad_dias)}`
  : r.salud === 'estancada' ? `${dd(r.dias_sin_gestion)} sin gestión`
  : r.salud === 'dia7' ? `día ${r.edad_dias} sin decisión`
  : r.salud === 'cierre_sugerido' ? `${dd(r.edad_dias)} abierta`
  : r.salud === 'vence_hoy' ? 'contactar hoy' : '—'
const aCotR = r => ({
  id: r.id, number: r.numero, date: r.fecha, total: Number(r.total || 0),
  cliente: { name: r.cliente_nombre || 'Sin cliente', phone: r.cliente_fono || '', email: r.cliente_email || '' },
  seller: { id: r.vendedor_bsale_id, name: r.vendedor_nombre || '—' },
  sucursal_id: r.sucursal_id, estado: r.estado, fecha_proximo: r.fecha_proximo || '',
  fecha_despacho: r.fecha_despacho || '', obs: r.observaciones || '', motivo: r.motivo_perdida || '',
})

function TabRadar({ sucursales, vendedores, cu, esGerente, isMobile, soloVendedor = null }) {
  const selStyle = { padding: '7px 10px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 13, background: '#fff' }
  const card = { background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }
  const perfilR = resolverPerfil(cu, vendedores, esGerente)
  const modoV = soloVendedor != null   // vista de un vendedor: solo lo suyo, sin cierre asistido
  const [fSuc, setFSuc] = useState(perfilR.verTodo ? '' : (perfilR.sucursal || ''))
  const sucVista = perfilR.verTodo ? fSuc : perfilR.sucursal
  const [rows, setRows] = useState([])
  const [reglas, setReglas] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [fSalud, setFSalud] = useState('riesgo')
  const [fVend, setFVend] = useState('')
  const [sel, setSel] = useState(null)
  const [marcadas, setMarcadas] = useState({})
  const [motivoCierre, setMotivoCierre] = useState('No responde / sin contacto')
  const [cerrando, setCerrando] = useState(false)
  const [msg, setMsg] = useState('')

  const cargar = async () => {
    if (!modoV && !perfilR.verTodo && !perfilR.sucursal) return
    setLoading(true); setErr('')
    try {
      let q = supabase.from('v_com_pipeline').select('id,numero,fecha,total,cliente_nombre,cliente_fono,cliente_email,vendedor_bsale_id,vendedor_nombre,sucursal_id,estado,fecha_proximo,fecha_despacho,motivo_perdida,observaciones,toques,ultimo_toque,edad_dias,dias_sin_gestion,atraso_dias,abierta,salud,nivel,en_riesgo,valor_ponderado,prioridad')
      if (modoV) q = q.eq('vendedor_bsale_id', String(soloVendedor))
      else if (sucVista) q = q.eq('sucursal_id', sucVista)
      const [pr, rg] = await Promise.all([q.limit(6000), supabase.from('com_pipeline_reglas').select('*').eq('id', 1).maybeSingle()])
      if (pr.error) throw pr.error
      setRows(pr.data || []); setReglas(rg.data || null); setMarcadas({})
    } catch (e) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }
  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [sucVista, soloVendedor])

  const base = fVend ? rows.filter(r => String(r.vendedor_bsale_id) === fVend) : rows
  const ab = base.filter(r => r.abierta)
  const riesgo = ab.filter(r => r.en_riesgo)
  const sumT = a => a.reduce((s, r) => s + Number(r.total || 0), 0)
  const kPipe = sumT(ab), kRiesgo = sumT(riesgo)
  const kPond = ab.reduce((s, r) => s + Number(r.valor_ponderado || 0), 0)
  const kSalud = ab.length ? Math.round((ab.length - riesgo.length) / ab.length * 100) : 100
  const nConv = base.filter(r => r.estado === 'convertida').length
  const nPerd = base.filter(r => r.estado === 'perdida').length
  const tasaConv = nConv + nPerd > 0 ? Math.round(nConv / (nConv + nPerd) * 100) : null
  const inflado = nConv + nPerd >= 20 && nPerd / (nConv + nPerd) < 0.05

  const conteo = useMemo(() => {
    const m = {}
    ab.forEach(r => { const o = m[r.salud] || (m[r.salud] = { n: 0, t: 0 }); o.n++; o.t += Number(r.total || 0) })
    return m
  }, [ab])

  const matriz = useMemo(() => ETAPAS_R.map(([k, l]) => ({
    k, l, celdas: BUCKETS_R.map(([a, b]) => {
      const xs = ab.filter(r => r.estado === k && r.edad_dias >= a && r.edad_dias <= b)
      return { n: xs.length, t: sumT(xs) }
    }),
  })), [ab])

  const porVend = useMemo(() => {
    const m = {}
    rows.forEach(r => {
      const k = String(r.vendedor_bsale_id || '—')
      const o = m[k] || (m[k] = { id: k, nombre: normNom(r.vendedor_nombre), ab: 0, pipe: 0, riesgo: 0, nr: 0, venc: 0, atr: 0, est: 0, cierre: 0, conv: 0, perd: 0 })
      if (r.abierta) { o.ab++; o.pipe += Number(r.total || 0); if (r.en_riesgo) { o.riesgo += Number(r.total || 0); o.nr++ } }
      if (r.salud === 'vencida') { o.venc++; o.atr += r.atraso_dias || 0 }
      if (r.salud === 'estancada') o.est++
      if (r.salud === 'cierre_sugerido') o.cierre++
      if (r.estado === 'convertida') o.conv++
      if (r.estado === 'perdida') o.perd++
    })
    return Object.values(m).filter(o => o.ab > 0 || o.conv + o.perd > 0).sort((a, b) => b.riesgo - a.riesgo || b.pipe - a.pipe)
  }, [rows])

  const cola = useMemo(() => {
    let xs = ab
    if (fSalud === 'riesgo') xs = xs.filter(r => r.en_riesgo)
    else if (fSalud === 'jefe') xs = xs.filter(r => r.nivel === 'jefe' || r.nivel === 'cierre')
    else if (fSalud !== 'todas') xs = xs.filter(r => r.salud === fSalud)
    return xs.slice().sort((a, b) => Number(b.prioridad || 0) - Number(a.prioridad || 0)).slice(0, 80)
  }, [ab, fSalud])

  const paraCierre = ab.filter(r => r.salud === 'cierre_sugerido').sort((a, b) => b.edad_dias - a.edad_dias)
  const nMarc = paraCierre.filter(r => marcadas[r.id]).length
  const cerrarSeleccion = async () => {
    const lista = paraCierre.filter(r => marcadas[r.id])
    if (!lista.length || cerrando) return
    if (!window.confirm(`Vas a cerrar ${lista.length} cotización(es) como PERDIDAS (motivo: ${motivoCierre}).\n\nQueda registrado con tu nombre en la bitácora de cada una. ¿Continuar?`)) return
    setCerrando(true); setErr('')
    const now = new Date().toISOString(), autor = cu?.nombre || cu?.correo || null
    try {
      const filas = lista.map(r => ({
        doc_id: r.id, bsale_number: String(r.numero), estado: 'perdida', fecha_proximo_contacto: null,
        observaciones: r.observaciones || null, motivo_perdida: motivoCierre, fecha_despacho: null,
        vendedor_bsale_id: r.vendedor_bsale_id ? parseInt(r.vendedor_bsale_id) : null,
        sucursal_id: r.sucursal_id, nro_boleta: null, monto_real: null, updated_at: now, updated_by: autor,
      }))
      const { error } = await supabase.from('com_seguimiento').upsert(filas, { onConflict: 'doc_id' })
      if (error) throw error
      try {
        await supabase.from('com_seguimiento_historial').insert(lista.map(r => ({
          doc_id: r.id, bsale_number: String(r.numero), estado: 'perdida', autor,
          nota: `Cierre asistido por jefatura: ${dd(r.edad_dias)} sin decisión. Motivo: ${motivoCierre}.`,
        })))
      } catch (e) { /* la bitácora no bloquea el cierre */ }
      setMsg(`✓ ${lista.length} cotización(es) cerrada(s) como perdidas`); setTimeout(() => setMsg(''), 3500)
      await cargar()
    } catch (e) { setErr('No se pudo cerrar: ' + (e?.message || e)) } finally { setCerrando(false) }
  }

  const kpi = (l, v, sub, color) => (
    <div style={{ ...card, padding: '12px 14px' }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>{l}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: color || '#1c1c1e' }}>{v}</div>
      {sub && <div style={{ fontSize: 10.5, color: '#8b88a8' }}>{sub}</div>}
    </div>
  )
  const chipR = (k, l, n, t, c) => (
    <button key={k} onClick={() => setFSalud(k)}
      style={{ border: fSalud === k ? `2px solid ${c}` : '1px solid #e0def0', background: fSalud === k ? c + '14' : '#fff', color: '#1c1c1e', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', textAlign: 'left', minWidth: 132 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: c }}>{l}</div>
      <div style={{ fontSize: 16, fontWeight: 800 }}>{fN(n)} <span style={{ fontSize: 11, color: '#8b88a8', fontWeight: 700 }}>{fmtK(t)}</span></div>
    </button>
  )
  const maxCelda = Math.max(1, ...matriz.flatMap(f => f.celdas.map(c2 => c2.n)))
  const vendSuc = vendedores.filter(v => v.activo !== false && (!sucVista || v.sucursal_id === sucVista))

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        {!modoV && <select value={perfilR.verTodo ? fSuc : (perfilR.sucursal || '')} disabled={!perfilR.verTodo} onChange={e => setFSuc(e.target.value)} style={{ ...selStyle, opacity: perfilR.verTodo ? 1 : 0.75 }}>
          {perfilR.verTodo && <option value="">Todas las tiendas</option>}
          {sucursales.filter(s => s.activa && s.bsale_office_id && (perfilR.verTodo || s.sucursal_id === perfilR.sucursal)).map(s => <option key={s.sucursal_id} value={s.sucursal_id}>{s.nombre}</option>)}
        </select>}
        {!modoV && <select value={fVend} onChange={e => setFVend(e.target.value)} style={selStyle}>
          <option value="">Todo el equipo</option>
          {vendSuc.map(v => <option key={v.bsale_user_id} value={String(v.bsale_user_id)}>{v.nombre}</option>)}
        </select>}
        <button onClick={cargar} disabled={loading} style={{ background: '#f0eff7', color: C2, border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{loading ? 'Cargando…' : '⟳ Actualizar'}</button>
        {msg && <span style={{ fontSize: 12, fontWeight: 700, color: '#248A3D' }}>{msg}</span>}
        {err && <span style={{ fontSize: 12, fontWeight: 700, color: '#FF3B30' }}>{err}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6,1fr)', gap: 10, marginBottom: 12 }}>
        {kpi('Pipeline abierto', fmtK(kPipe), `${fN(ab.length)} cotizaciones`, C1)}
        {kpi('Pronóstico ponderado', fmtK(kPond), 'monto × probabilidad por etapa')}
        {kpi('En riesgo', fmtK(kRiesgo), `${fN(riesgo.length)} cotiz. · ${pct(kRiesgo, kPipe)}% del pipeline`, riesgo.length ? '#FF3B30' : '#248A3D')}
        {kpi('Salud del pipeline', `${kSalud}%`, 'abiertas sin alerta', kSalud >= 80 ? '#248A3D' : kSalud >= 50 ? '#B25000' : '#FF3B30')}
        {kpi('Conversión 90 días', tasaConv === null ? '—' : `${tasaConv}%`, `${fN(nConv)} ganadas · ${fN(nPerd)} perdidas`)}
        {kpi('Cierre sugerido', fN(paraCierre.length), `${fmtK(sumT(paraCierre))} · 21+ días`, paraCierre.length ? '#8E3A9D' : '#248A3D')}
      </div>

      {inflado && (
        <div style={{ background: '#FFF4E5', border: '1px solid #FFD9A8', borderLeft: '4px solid #FF9500', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: '#8a5a1a' }}>
          <b>⚠ Pipeline probablemente inflado:</b> solo {nPerd} pérdida(s) declarada(s) contra {nConv} ventas en 90 días. Las cotizaciones muertas que no se cierran hacen ver un embudo más grande del que es y esconden la conversión real. Usa el cierre asistido de abajo.
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {chipR('riesgo', '⚠ En riesgo', riesgo.length, kRiesgo, '#FF3B30')}
        {chipR('jefe', '👔 Escalado a jefatura', ab.filter(r => r.nivel === 'jefe' || r.nivel === 'cierre').length, sumT(ab.filter(r => r.nivel === 'jefe' || r.nivel === 'cierre')), '#5856D6')}
        {Object.entries(SALUD_R).map(([k, v]) => chipR(k, `${v.ic} ${v.l}`, conteo[k]?.n || 0, conteo[k]?.t || 0, v.c))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: (isMobile || modoV) ? '1fr' : '1.15fr 1fr', gap: 12, marginBottom: 14 }}>
        <div style={{ ...card, padding: 14, overflowX: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#8b88a8', marginBottom: 8 }}>Antigüedad del pipeline · etapa × días desde la cotización</div>
          <table className="com" style={{ width: '100%' }}>
            <thead><tr><th>Etapa</th>{BUCKETS_R.map(b => <th key={b[2]} style={{ textAlign: 'center' }}>{b[2]}</th>)}</tr></thead>
            <tbody>
              {matriz.map(f => (
                <tr key={f.k}>
                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{f.l}</td>
                  {f.celdas.map((c2, i) => (
                    <td key={i} style={{ textAlign: 'center', background: c2.n ? BUCKET_BG[i] : 'transparent', opacity: c2.n ? 0.55 + 0.45 * c2.n / maxCelda : 1 }}>
                      {c2.n ? <><div style={{ fontWeight: 800 }}>{c2.n}</div><div style={{ fontSize: 10.5, color: '#5a5a6e' }}>{fmtK(c2.t)}</div></> : <span style={{ color: '#c9c7dd' }}>—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 10.5, color: '#a6a3bd', marginTop: 6 }}>Lo sano se concentra a la izquierda. Todo lo que se acumula a la derecha es venta que se está enfriando.</div>
        </div>

        {!modoV && <div style={{ ...card, padding: 14, overflowX: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#8b88a8', marginBottom: 8 }}>Por vendedor</div>
          <table className="com" style={{ width: '100%' }}>
            <thead><tr><th>Vendedor</th><th style={{ textAlign: 'right' }}>Pipeline</th><th style={{ textAlign: 'right' }}>En riesgo</th><th style={{ textAlign: 'center' }}>Venc.</th><th style={{ textAlign: 'center' }}>Estanc.</th><th style={{ textAlign: 'center' }}>Cierre</th><th style={{ textAlign: 'center' }}>Conv.</th></tr></thead>
            <tbody>
              {porVend.map(o => {
                const cv = o.conv + o.perd > 0 ? Math.round(o.conv / (o.conv + o.perd) * 100) : null
                const sinPerdidas = o.conv >= 10 && o.perd === 0
                return (
                  <tr key={o.id} className="click" onClick={() => setFVend(fVend === o.id ? '' : o.id)} style={fVend === o.id ? { background: '#f6f5ff' } : undefined}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{o.nombre}{sinPerdidas && <span title="Tiene ventas pero ninguna pérdida declarada: revisar si hay cotizaciones muertas sin cerrar" style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, color: '#B25000' }}>⚠ 0 pérdidas</span>}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtK(o.pipe)} <span style={{ color: '#a6a3bd', fontSize: 10.5 }}>({o.ab})</span></td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: o.riesgo ? '#FF3B30' : '#248A3D', fontVariantNumeric: 'tabular-nums' }}>{o.riesgo ? fmtK(o.riesgo) : '—'}</td>
                    <td style={{ textAlign: 'center' }}>{o.venc ? <span title={`atraso promedio ${Math.round(o.atr / o.venc)} días`}>{o.venc}</span> : '—'}</td>
                    <td style={{ textAlign: 'center' }}>{o.est || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{o.cierre || '—'}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{cv === null ? '—' : cv + '%'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 10.5, color: '#a6a3bd', marginTop: 6 }}>Clic en un vendedor para filtrar todo el Radar por él.</div>
        </div>}
      </div>

      <div style={{ ...card, padding: 14, marginBottom: 14, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#8b88a8' }}>Cola priorizada · valor × urgencia</div>
          <div style={{ fontSize: 11, color: '#a6a3bd' }}>{cola.length} cotización(es) · clic para gestionar</div>
        </div>
        <table className="com" style={{ width: '100%' }}>
          <thead><tr><th>N°</th><th>Cliente</th><th style={{ textAlign: 'right' }}>Monto</th><th>Vendedor</th><th>Etapa</th><th>Alerta</th><th>Próx. contacto</th><th style={{ textAlign: 'center' }}>Gestiones</th></tr></thead>
          <tbody>
            {cola.map(r => {
              const sv = SALUD_R[r.salud] || { l: r.salud, c: '#8b88a8', ic: '' }
              const et = ESTADOS[r.estado] || {}
              return (
                <tr key={r.id} className="click" onClick={() => setSel(aCotR(r))}>
                  <td style={{ fontWeight: 700 }}>#{r.numero}</td>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{normNom(r.cliente_nombre)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.total)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{normNom(r.vendedor_nombre).split(' ')[0]}</td>
                  <td style={{ whiteSpace: 'nowrap', color: et.c || '#3a3a3c', fontWeight: 700, fontSize: 12 }}>{et.ic || ''} {et.label || r.estado}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: sv.c, background: sv.c + '14', borderRadius: 6, padding: '2px 7px' }}>{sv.ic} {sv.l}</span>
                    <div style={{ fontSize: 10.5, color: '#8b88a8', marginTop: 2 }}>{detalleSaludR(r)}{r.nivel === 'jefe' ? ' · escalada' : ''}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.fecha_proximo ? fmtFecha(r.fecha_proximo) : '—'}</td>
                  <td style={{ textAlign: 'center' }}>{r.toques || 0}</td>
                </tr>
              )
            })}
            {!cola.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#248A3D', fontWeight: 700, padding: 18 }}>✓ Nada en esta categoría</td></tr>}
          </tbody>
        </table>
      </div>

      {paraCierre.length > 0 && !modoV && (
        <div style={{ ...card, padding: 14, marginBottom: 14, borderLeft: '4px solid #8E3A9D', overflowX: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#8E3A9D', marginBottom: 4 }}>🗂 Cierre asistido · {paraCierre.length} cotizaciones con {reglas?.dias_cierre_sugerido || 21}+ días sin decisión</div>
          <div style={{ fontSize: 12, color: '#5a5a6e', marginBottom: 10 }}>Revisa la lista: las que ya no tienen opción, márcalas y ciérralas como perdidas en un solo paso. Si alguna sigue viva, ábrela y agenda un próximo contacto concreto — así sale de esta lista.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button onClick={() => { const all = paraCierre.every(r => marcadas[r.id]); const m = {}; if (!all) paraCierre.forEach(r => { m[r.id] = true }); setMarcadas(m) }}
              style={{ background: '#f0eff7', color: C2, border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {paraCierre.every(r => marcadas[r.id]) ? 'Desmarcar todas' : 'Marcar todas'}
            </button>
            <select value={motivoCierre} onChange={e => setMotivoCierre(e.target.value)} style={{ ...selStyle, width: 230 }}>
              {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button onClick={cerrarSeleccion} disabled={!nMarc || cerrando}
              style={{ background: nMarc && !cerrando ? '#8E3A9D' : '#c9c7dd', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12.5, fontWeight: 800, cursor: nMarc && !cerrando ? 'pointer' : 'default' }}>
              {cerrando ? 'Cerrando…' : `Cerrar ${nMarc || ''} como perdidas`}
            </button>
          </div>
          <table className="com" style={{ width: '100%' }}>
            <thead><tr><th style={{ width: 30 }}></th><th>N°</th><th>Cliente</th><th style={{ textAlign: 'right' }}>Monto</th><th>Vendedor</th><th>Etapa</th><th style={{ textAlign: 'center' }}>Días</th><th>Última nota</th></tr></thead>
            <tbody>
              {paraCierre.map(r => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={!!marcadas[r.id]} onChange={e => setMarcadas(m => ({ ...m, [r.id]: e.target.checked }))} /></td>
                  <td className="click" onClick={() => setSel(aCotR(r))} style={{ fontWeight: 700 }}>#{r.numero}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{normNom(r.cliente_nombre)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.total)}</td>
                  <td>{normNom(r.vendedor_nombre).split(' ')[0]}</td>
                  <td style={{ fontSize: 12 }}>{(ESTADOS[r.estado] || {}).label || r.estado}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.edad_dias}</td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#5a5a6e', fontSize: 12 }}>{r.observaciones || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reglas && (
        <div style={{ fontSize: 10.5, color: '#a6a3bd' }}>
          Reglas vigentes: estancada con {reglas.dias_estancada}+ días sin gestión · decisión al día {reglas.dias_decision} · escala a jefatura con {reglas.dias_escala_jefe}+ días de atraso · cierre sugerido desde {reglas.dias_cierre_sugerido} días · pronóstico ponderado {reglas.prob_sin_contactar}% / {reglas.prob_contactado}% / {reglas.prob_negociacion}% (sin contactar / contactado / negociación) · ventana {reglas.ventana_dias} días.
        </div>
      )}

      {sel && (
        <SheetSeguimiento cot={sel} onClose={() => setSel(null)} cu={cu} sucSel={sel.sucursal_id} puedeDescartar={perfilR.rol !== 'vendedor'}
          onSaved={() => { setSel(null); cargar() }} />
      )}
    </div>
  )
}

/* ═══ RADAR EN MI DÍA · franja compacta (vendedor: lo suyo · jefe en modo tienda: su tienda) ═══ */
function RadarMiDia({ cu, vendedores, esGerente, sucursalId, vendedorId, modoTienda, isMobile, onVerRadar }) {
  const card = { background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }
  const perfilX = resolverPerfil(cu, vendedores, esGerente)
  const [rows, setRows] = useState([])
  const [cargado, setCargado] = useState(false)
  const [sel, setSel] = useState(null)
  const cargar = async () => {
    if (modoTienda ? !sucursalId : !vendedorId) { setRows([]); setCargado(true); return }
    try {
      let q = supabase.from('v_com_pipeline')
        .select('id,numero,fecha,total,cliente_nombre,cliente_fono,cliente_email,vendedor_bsale_id,vendedor_nombre,sucursal_id,estado,fecha_proximo,fecha_despacho,motivo_perdida,observaciones,edad_dias,dias_sin_gestion,atraso_dias,salud,nivel,en_riesgo,valor_ponderado,prioridad')
        .eq('abierta', true)
      q = modoTienda ? q.eq('sucursal_id', sucursalId) : q.eq('vendedor_bsale_id', String(vendedorId))
      const { data } = await q.limit(3000)
      setRows(data || [])
    } catch (e) { setRows([]) } finally { setCargado(true) }
  }
  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [sucursalId, vendedorId, modoTienda])
  if (!cargado) return null

  const sumT = a => a.reduce((s, r) => s + Number(r.total || 0), 0)
  const riesgo = rows.filter(r => r.en_riesgo)
  const cnt = k => rows.filter(r => r.salud === k).length
  const escal = rows.filter(r => r.nivel === 'jefe' || r.nivel === 'cierre')
  const top = riesgo.slice().sort((a, b) => Number(b.prioridad || 0) - Number(a.prioridad || 0)).slice(0, 5)
  const porV = (() => {
    const m = {}
    riesgo.forEach(r => { const k = normNom(r.vendedor_nombre); m[k] = m[k] || { n: 0, t: 0 }; m[k].n++; m[k].t += Number(r.total || 0) })
    return Object.entries(m).sort((a, b) => b[1].t - a[1].t).slice(0, 4)
  })()
  const pill = (l, v, c2, sub) => (
    <div style={{ background: c2 + '10', borderRadius: 9, padding: '7px 11px', minWidth: 96 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: c2, textTransform: 'uppercase', letterSpacing: '.03em' }}>{l}</div>
      <div style={{ fontSize: 15.5, fontWeight: 800, color: '#1c1c1e' }}>{v}{sub && <span style={{ fontSize: 10.5, color: '#8b88a8', fontWeight: 700 }}> {sub}</span>}</div>
    </div>
  )
  const ok = riesgo.length === 0
  return (
    <div style={{ ...card, marginBottom: 12, borderLeft: `4px solid ${ok ? '#248A3D' : '#FF3B30'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8' }}>
          📡 {modoTienda ? 'Radar de la tienda' : 'Mi radar de cotizaciones'}
        </div>
        {onVerRadar && <button onClick={onVerRadar} style={{ marginLeft: 'auto', background: '#f0eff7', color: C2, border: 'none', borderRadius: 7, padding: '5px 11px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>Ver radar completo →</button>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: ok ? 0 : 12 }}>
        {pill('Pipeline abierto', fmtK(sumT(rows)), C1, `(${rows.length})`)}
        {pill('En riesgo', fmtK(sumT(riesgo)), ok ? '#248A3D' : '#FF3B30', `(${riesgo.length})`)}
        {pill('Vencidas', cnt('vencida'), '#FF3B30')}
        {pill('Estancadas', cnt('estancada'), '#B25000')}
        {pill('Día 7', cnt('dia7'), '#B25000')}
        {pill('Para cierre', cnt('cierre_sugerido'), '#8E3A9D')}
        {modoTienda && pill('Escaladas a ti', escal.length, '#5856D6')}
      </div>
      {ok ? (
        <div style={{ fontSize: 12.5, color: '#248A3D', fontWeight: 700, marginTop: 8 }}>✓ {modoTienda ? 'Todo el pipeline de la tienda está al día.' : 'Todo tu pipeline está al día. Así se hace.'}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: (isMobile || !modoTienda) ? '1fr' : '1.6fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: '#8b88a8', textTransform: 'uppercase', marginBottom: 4 }}>Prioridad de hoy · valor × urgencia</div>
            {top.map(r => {
              const sv = SALUD_R[r.salud] || { c: '#8b88a8', ic: '' }
              return (
                <div key={r.id} className="click" onClick={() => setSel(aCotR(r))}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderBottom: '1px solid #f4f3fa', cursor: 'pointer' }}>
                  <span style={{ fontSize: 13 }}>{sv.ic}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{r.numero} · {normNom(r.cliente_nombre)}</div>
                    <div style={{ fontSize: 10.5, color: sv.c, fontWeight: 700 }}>{detalleSaludR(r)}{modoTienda ? ` · ${normNom(r.vendedor_nombre).split(' ')[0]}` : ''}</div>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.total)}</div>
                </div>
              )
            })}
          </div>
          {modoTienda && (
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: '#8b88a8', textTransform: 'uppercase', marginBottom: 4 }}>Vendedores con más riesgo</div>
              {porV.map(([n, o]) => (
                <div key={n} style={{ display: 'flex', fontSize: 12.5, padding: '6px 4px', borderBottom: '1px solid #f4f3fa' }}>
                  <span style={{ fontWeight: 600 }}>{n}</span>
                  <span style={{ marginLeft: 'auto', color: '#FF3B30', fontWeight: 800 }}>{fmtK(o.t)}</span>
                  <span style={{ color: '#a6a3bd', fontSize: 11, marginLeft: 6 }}>({o.n})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {sel && (
        <SheetSeguimiento cot={sel} onClose={() => setSel(null)} cu={cu} sucSel={sel.sucursal_id} puedeDescartar={perfilX.rol !== 'vendedor'}
          onSaved={() => { setSel(null); cargar() }} />
      )}
    </div>
  )
}

/* ═══ MONITOR VAMBE · lectura directa cada 15 min (vambe-monitor → tablas vambe_*) ═══ */
const tipoEtapa = n => /\bIA\b|SDR/i.test(n || '') ? ['🤖', 'IA', '#8b88a8'] : /ganad|perdid/i.test(n || '') ? ['🏁', 'Cierre', '#248A3D'] : ['👤', 'Humana', C1]
const haceTxt = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días` }

function TabVambeMonitor({ sucursales, vendedores, cu, esGerente, isMobile, anio, setAnio, mes, setMes }) {
  const selStyle = { padding: '7px 10px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 13, background: '#fff' }
  const card = { background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }
  const perfilV = resolverPerfil(cu, vendedores, esGerente)
  const [vistaV, setVistaV] = useState('monitor')
  const [fSuc, setFSuc] = useState(perfilV.verTodo ? '' : (perfilV.sucursal || ''))
  const sucVista = perfilV.verTodo ? fSuc : perfilV.sucursal
  const [d, setD] = useState(globalThis.__VM__ || { pipes: [], carga: [], agentes: [], etapas: [], metr: [], log: [], gd: [], esp: [], ag: [] })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [perGd, setPerGd] = useState('hoy')   // 'hoy' | '7d' en la gestión de mensajes

  const cargar = async () => {
    setLoading(true); setErr('')
    try {
      const desde = new Date(Date.now() - 9 * 86400000).toLocaleDateString('en-CA')
      const [pp, cg, ag, et, mt, lg, gd, es, ags] = await Promise.all([
        supabase.from('vambe_pipelines').select('*').eq('activo', true),
        supabase.from('vambe_carga').select('pipeline_id,capturado_at,open_total,unassigned_total').order('capturado_at', { ascending: false }).limit(400),
        supabase.from('v_vambe_agentes_hoy').select('*'),
        supabase.from('vambe_etapas').select('*').order('orden'),
        supabase.from('vambe_metricas_dia').select('*').gte('fecha', desde).order('fecha', { ascending: false }),
        supabase.from('vambe_sync_log').select('id,inicio,fin,modo,ok,duracion_s,error,pasos').order('inicio', { ascending: false }).limit(12),
        supabase.from('v_vambe_gestion_dia').select('*').gte('dia', new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA')),
        supabase.from('v_vambe_esperando').select('*').order('minutos_esperando', { ascending: false }).limit(200),
        supabase.from('vambe_agentes').select('agent_id,nombre,bsale_user_id,sucursal_id'),
      ])
      const e1 = [pp, cg, ag, et, mt, lg].find(x => x.error)
      if (e1) throw e1.error
      setD({ pipes: pp.data || [], carga: cg.data || [], agentes: ag.data || [], etapas: et.data || [], metr: mt.data || [], log: lg.data || [],
        gd: gd.data || [], esp: es.data || [], ag: ags.data || [] })
    } catch (e) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }
  useEffect(() => { cargar(); const t = setInterval(cargar, 2 * 60000); return () => clearInterval(t) /* eslint-disable-next-line */ }, [])

  // ── alcance: pipelines de la tienda visible ──
  const pipesV = d.pipes.filter(p => !sucVista || p.sucursal_id === sucVista)
  const idsV = new Set(pipesV.map(p => p.pipeline_id))
  const sucDe = id => d.pipes.find(p => p.pipeline_id === id)?.sucursal_id
  const nomSuc = sid => sucursales.find(s => s.sucursal_id === sid)?.nombre || sid || '—'

  // frescura: última corrida correcta
  const ultOk = d.log.find(l => l.ok)
  const edadMs = ultOk ? Date.now() - new Date(ultOk.fin || ultOk.inicio).getTime() : Infinity
  const fres = edadMs < 30 * 60000 ? ['#248A3D', '✓'] : edadMs < 2 * 3600000 ? ['#B25000', '⏱'] : ['#FF3B30', '⚠']

  // carga vigente y hace ~24 h por pipeline
  const ultimaDe = id => d.carga.find(c => c.pipeline_id === id)
  const ayerDe = id => d.carga.find(c => c.pipeline_id === id && Date.now() - new Date(c.capturado_at).getTime() >= 23 * 3600000)
  const sumC = (f, sel) => pipesV.reduce((s, p) => s + Number(f(p.pipeline_id)?.[sel] || 0), 0)
  const abiertos = sumC(ultimaDe, 'open_total'), sinAsig = sumC(ultimaDe, 'unassigned_total')
  const hayAyer = pipesV.some(p => ayerDe(p.pipeline_id))
  const sinAsigAyer = sumC(ayerDe, 'unassigned_total')

  const etapasV = d.etapas.filter(e => idsV.has(e.pipeline_id))
  const humanas = etapasV.filter(e => tipoEtapa(e.stage_name)[1] === 'Humana')
  const humAb = humanas.reduce((s, e) => s + (e.open_count || 0), 0)
  const humStale = humanas.reduce((s, e) => s + (e.stale_count || 0), 0)

  const agentesV = d.agentes.filter(a => idsV.has(a.pipeline_id))
  const asigHoy = agentesV.reduce((s, a) => s + (a.asignadas_hoy || 0), 0)
  const promCarga = agentesV.length ? agentesV.reduce((s, a) => s + (a.abiertos || 0), 0) / agentesV.length : 0

  const hoyF = new Date().toLocaleDateString('en-CA')
  const metrV = d.metr.filter(m => idsV.has(m.pipeline_id))
  const leadsHoy = metrV.filter(m => m.fecha === hoyF).reduce((s, m) => s + (m.creados || 0), 0)
  const fechasM = [...new Set(metrV.map(m => m.fecha))].sort().reverse().slice(0, 8)
  const leads7 = metrV.filter(m => fechasM.slice(0, 7).includes(m.fecha)).reduce((s, m) => s + (m.creados || 0), 0)

  const kpi = (l, v, sub, color) => (
    <div style={{ ...card, padding: '12px 14px' }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>{l}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: color || '#1c1c1e' }}>{v}</div>
      {sub && <div style={{ fontSize: 10.5, color: '#8b88a8' }}>{sub}</div>}
    </div>
  )

  if (vistaV === 'historico' && esGerente) return (
    <div>
      <div style={{ display: 'inline-flex', background: '#eceaf6', borderRadius: 10, padding: 3, marginBottom: 12 }}>
        {[['monitor', '📡 Monitor'], ['historico', '🗄 Mensajería (histórico)']].map(([k, l]) => (
          <button key={k} onClick={() => setVistaV(k)} style={{ background: vistaV === k ? '#fff' : 'transparent', color: vistaV === k ? C2 : '#8b88a8', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>{l}</button>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: '#B25000', marginBottom: 10 }}>Vista histórica: los mensajes dejaron de sincronizarse el 08-07-2026. Para el estado actual usa el Monitor.</div>
      <TabVambe {...{ cu, isMobile, vendedores, anio, setAnio, mes, setMes }} />
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        {esGerente && (
          <div style={{ display: 'inline-flex', background: '#eceaf6', borderRadius: 10, padding: 3 }}>
            {[['monitor', '📡 Monitor'], ['historico', '🗄 Mensajería (histórico)']].map(([k, l]) => (
              <button key={k} onClick={() => setVistaV(k)} style={{ background: vistaV === k ? '#fff' : 'transparent', color: vistaV === k ? C2 : '#8b88a8', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>{l}</button>
            ))}
          </div>
        )}
        <select value={perfilV.verTodo ? fSuc : (perfilV.sucursal || '')} disabled={!perfilV.verTodo} onChange={e => setFSuc(e.target.value)} style={{ ...selStyle, opacity: perfilV.verTodo ? 1 : 0.75 }}>
          {perfilV.verTodo && <option value="">Todas las tiendas</option>}
          {d.pipes.filter(p => perfilV.verTodo || p.sucursal_id === perfilV.sucursal).map(p => <option key={p.pipeline_id} value={p.sucursal_id}>{nomSuc(p.sucursal_id)}</option>)}
        </select>
        <span style={{ fontSize: 12, fontWeight: 800, color: fres[0], background: fres[0] + '14', borderRadius: 8, padding: '5px 10px' }}>
          {fres[1]} {ultOk ? `Vambe actualizado ${haceTxt(edadMs)}` : 'Sin lecturas de Vambe todavía'}
        </span>
        <button onClick={cargar} disabled={loading} style={{ background: '#f0eff7', color: C2, border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{loading ? 'Cargando…' : '⟳'}</button>
        {err && <span style={{ fontSize: 12, fontWeight: 700, color: '#FF3B30' }}>{err}</span>}
      </div>

      {edadMs >= 2 * 3600000 && (
        <div style={{ background: '#FFEDEB', border: '1px solid #FFC7C1', borderLeft: '4px solid #FF3B30', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: '#9a2a1f' }}>
          <b>⚠ La lectura automática de Vambe no se ha completado en las últimas 2 horas.</b> Las cifras pueden estar desactualizadas{ultOk ? ` (último dato correcto: ${new Date(ultOk.fin || ultOk.inicio).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})` : ''}. Avisa a gerencia.
        </div>
      )}

      <CentroConversaciones {...{ sucursales, sucVista, isMobile }} />

      <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6E6E73', margin: '4px 0 10px' }}>Carga y embudo de Vambe</div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6,1fr)', gap: 10, marginBottom: 12 }}>
        {kpi('Conversaciones abiertas', fN(abiertos), `${pipesV.length} ${pipesV.length === 1 ? 'tienda' : 'tiendas'}`, C1)}
        {kpi('Sin ejecutivo', fN(sinAsig), `${pct(sinAsig, abiertos)}% de las abiertas${hayAyer ? ` · ${sinAsig - sinAsigAyer >= 0 ? '+' : ''}${fN(sinAsig - sinAsigAyer)} vs ayer` : ''}`, sinAsig ? '#B25000' : '#248A3D')}
        {kpi('Humanas sin actividad', fN(humStale), `${pct(humStale, humAb)}% de ${fN(humAb)} en etapa de vendedor`, pct(humStale, humAb) >= 50 ? '#FF3B30' : pct(humStale, humAb) >= 25 ? '#B25000' : '#248A3D')}
        {kpi('Asignadas hoy', fN(asigHoy), 'conversaciones a vendedores')}
        {kpi('Leads hoy', fN(leadsHoy), 'contactos nuevos en Vambe')}
        {kpi('Leads 7 días', fN(leads7), fechasM.length ? `prom. ${fN(leads7 / Math.max(1, Math.min(7, fechasM.length)))} diarios` : '')}
      </div>


      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div style={{ ...card, overflowX: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#8b88a8', marginBottom: 8 }}>Embudo por etapa · dónde se frena la conversación</div>
          <table className="com" style={{ width: '100%' }}>
            <thead><tr><th>Etapa</th><th style={{ textAlign: 'right' }}>Abiertas</th><th style={{ textAlign: 'right' }}>Prom. días</th><th style={{ textAlign: 'right' }}>Máx.</th><th>Sin actividad {etapasV[0]?.stale_threshold || 3}+ días</th></tr></thead>
            <tbody>
              {pipesV.map(p => d.etapas.filter(e => e.pipeline_id === p.pipeline_id).map((e, i) => {
                const [ic, tl, tc] = tipoEtapa(e.stage_name)
                const ps = pct(e.stale_count, e.open_count)
                return (
                  <tr key={e.pipeline_id + e.stage_id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {!sucVista && i === 0 && <div style={{ fontSize: 10, fontWeight: 800, color: '#8b88a8', textTransform: 'uppercase' }}>{nomSuc(p.sucursal_id)}</div>}
                      <span title={tl} style={{ color: tc }}>{ic}</span> <b>{e.stage_name?.trim()}</b>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fN(e.open_count)}</td>
                    <td style={{ textAlign: 'right' }}>{e.avg_days ?? '—'}</td>
                    <td style={{ textAlign: 'right', color: '#8b88a8' }}>{e.max_days ?? '—'}</td>
                    <td style={{ minWidth: 140 }}>
                      {e.open_count ? <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 7, background: '#f0eff7', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${ps}%`, height: '100%', background: tl === 'Humana' ? (ps >= 50 ? '#FF3B30' : ps >= 25 ? '#FF9500' : '#34C759') : '#c9c7dd' }} />
                          </div>
                          <span style={{ fontSize: 11.5, fontWeight: 800, color: tl === 'Humana' && ps >= 50 ? '#FF3B30' : '#3a3a3c' }}>{fN(e.stale_count)} · {ps}%</span>
                        </div>
                      </> : <span style={{ color: '#c9c7dd' }}>—</span>}
                    </td>
                  </tr>
                )
              }))}
              {!etapasV.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: '#8b88a8', padding: 16 }}>Sin datos de embudo todavía</td></tr>}
            </tbody>
          </table>
          <div style={{ fontSize: 10.5, color: '#a6a3bd', marginTop: 6 }}>🤖 etapa que atiende la IA · 👤 etapa de vendedor · la barra roja en etapas 👤 son clientes esperando a una persona.</div>
        </div>

        <div style={{ ...card, overflowX: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#8b88a8', marginBottom: 8 }}>Por vendedor · carga y asignaciones</div>
          <table className="com" style={{ width: '100%' }}>
            <thead><tr><th>Vendedor</th>{!sucVista && <th>Tienda</th>}<th style={{ textAlign: 'right' }}>Abiertas</th><th style={{ textAlign: 'right' }}>Hoy</th><th style={{ textAlign: 'right' }}>7 días</th><th style={{ textAlign: 'right' }}>Manual 7d</th></tr></thead>
            <tbody>
              {agentesV.slice().sort((a, b) => (b.abiertos || 0) - (a.abiertos || 0)).map(a => {
                const sobre = promCarga > 0 && a.abiertos >= promCarga * 1.5
                return (
                  <tr key={a.pipeline_id + a.agent_id}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{normNom(a.nombre)}{!a.bsale_user_id && <span title="Agente de Vambe sin ficha de vendedor en el ERP" style={{ marginLeft: 6, fontSize: 10.5, color: '#a6a3bd' }}>sin ficha</span>}</td>
                    {!sucVista && <td style={{ fontSize: 11.5, color: '#8b88a8' }}>{nomSuc(a.sucursal_id)}</td>}
                    <td style={{ textAlign: 'right', fontWeight: 800, color: sobre ? '#FF3B30' : '#1c1c1e' }} title={sobre ? `Sobre 1,5× el promedio (${Math.round(promCarga)})` : ''}>{fN(a.abiertos)}{sobre ? ' ⚠' : ''}</td>
                    <td style={{ textAlign: 'right' }}>{a.asignadas_hoy || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{a.asignadas_7d || '—'}</td>
                    <td style={{ textAlign: 'right', color: '#8b88a8' }}>{a.manuales_7d || '—'}</td>
                  </tr>
                )
              })}
              {!agentesV.length && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#8b88a8', padding: 16 }}>Sin datos de carga todavía</td></tr>}
            </tbody>
          </table>
          <div style={{ fontSize: 10.5, color: '#a6a3bd', marginTop: 6 }}>Abiertas: conversaciones a cargo de cada vendedor ahora. ⚠ = sobre 1,5× el promedio del equipo. El historial de 7 días se completa a medida que el monitor acumula datos.</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile || !esGerente ? '1fr' : '1.3fr 1fr', gap: 12, marginBottom: 14 }}>
        <div style={{ ...card, overflowX: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#8b88a8', marginBottom: 8 }}>Leads nuevos por día</div>
          <table className="com" style={{ width: '100%' }}>
            <thead><tr><th>Día</th>{pipesV.map(p => <th key={p.pipeline_id} style={{ textAlign: 'right' }}>{nomSuc(p.sucursal_id)}</th>)}{pipesV.length > 1 && <th style={{ textAlign: 'right' }}>Total</th>}</tr></thead>
            <tbody>
              {fechasM.map(f => {
                const val = pid => metrV.find(m => m.fecha === f && m.pipeline_id === pid)?.creados || 0
                return (
                  <tr key={f}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtFecha(f)}{f === hoyF ? ' · hoy' : ''}</td>
                    {pipesV.map(p => <td key={p.pipeline_id} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fN(val(p.pipeline_id))}</td>)}
                    {pipesV.length > 1 && <td style={{ textAlign: 'right', fontWeight: 800 }}>{fN(pipesV.reduce((s, p) => s + val(p.pipeline_id), 0))}</td>}
                  </tr>
                )
              })}
              {!fechasM.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: '#8b88a8', padding: 16 }}>Sin métricas todavía (se cargan cada noche)</td></tr>}
            </tbody>
          </table>
          <div style={{ fontSize: 10.5, color: '#a6a3bd', marginTop: 6 }}>Los "ganados/perdidos" de Vambe no se usan: las ventas se cierran en BSALE y se miden en Metas y Cotizaciones.</div>
        </div>

        {esGerente && (
          <div style={{ ...card, overflowX: 'auto' }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#8b88a8', marginBottom: 8 }}>Salud de la lectura automática</div>
            {d.log.map(l => {
              const fallas = (l.pasos || []).filter(p => !p.ok)
              return (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #f4f3fa', fontSize: 12 }}>
                  <span>{l.ok ? '✅' : '❌'}</span>
                  <span style={{ color: '#5a5a6e', whiteSpace: 'nowrap' }}>{new Date(l.inicio).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C2 }}>{l.modo}</span>
                  <span style={{ color: '#8b88a8' }}>{l.duracion_s}s</span>
                  {!l.ok && <span style={{ color: '#FF3B30', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.error || fallas.map(p => `${p.paso}: ${p.error}`).join(' · ')}</span>}
                </div>
              )
            })}
            {!d.log.length && <div style={{ fontSize: 12, color: '#8b88a8' }}>Sin corridas registradas.</div>}
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══ CENTRO DE CONVERSACIONES · WhatsApp por vendedor en tiempo real (vambe_mensajes_live) ═══ */
const TRAMOS_V = ['≤ 5 min', '5–15 min', '15–60 min', '1–4 h', '> 4 h']
const TRAMO_COL = ['#1E7A44', '#34C759', '#FF9F0A', '#FF6B3D', '#D92D20']
const minTxt = m => m == null ? '—' : m < 1 ? '< 1 min' : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1).replace('.', ',')} h` : `${(m / 1440).toFixed(1).replace('.', ',')} d`
const colResp = (m, sla) => m == null ? '#8b88a8' : m <= sla ? '#1E7A44' : m <= sla * 4 ? '#B25E09' : '#D92D20'
const diaCL = (off = 0) => new Date(Date.now() - off * 86400000).toLocaleDateString('en-CA')
const rangoPer = p => p === 'hoy' ? [diaCL(0), diaCL(0), diaCL(1), diaCL(1)]
  : p === 'ayer' ? [diaCL(1), diaCL(1), diaCL(2), diaCL(2)]
  : p === '7d' ? [diaCL(6), diaCL(0), diaCL(13), diaCL(7)] : [diaCL(29), diaCL(0), diaCL(59), diaCL(30)]
const PER_TXT = { hoy: 'vs ayer', ayer: 'vs anteayer', '7d': 'vs 7 días previos', '30d': 'vs 30 días previos' }
const haceCorto = t => { if (!t) return '—'; const m = (Date.now() - new Date(t).getTime()) / 60000; return m < 1 ? 'ahora' : m < 60 ? `hace ${Math.round(m)} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d` }
const chatUrl = id => `https://app.vambeai.com/chat?chatContactId=${id}`
const sumK = (a, k) => a.reduce((s, x) => s + Number(x?.[k] || 0), 0)

function Delta({ v, prev, invert = false }) {
  if (prev == null || !isFinite(prev) || prev === 0 || v == null) return null
  const d = Math.round((v - prev) / prev * 100)
  if (d === 0) return <span style={{ fontSize: 11, color: '#8b88a8', fontWeight: 700 }}>= </span>
  const bueno = invert ? d < 0 : d > 0
  return <span style={{ fontSize: 11.5, fontWeight: 800, color: bueno ? '#1E7A44' : '#D92D20' }}>{d > 0 ? '▲' : '▼'} {Math.abs(d)}%</span>
}

function BarraTramos({ tramos, alto = 8 }) {
  const tot = tramos.reduce((s, x) => s + x, 0)
  if (!tot) return <span style={{ color: '#c9c7dd' }}>—</span>
  return (
    <div title={tramos.map((n, i) => `${TRAMOS_V[i]}: ${n}`).join(' · ')} style={{ display: 'flex', height: alto, borderRadius: 4, overflow: 'hidden', minWidth: 90, background: '#f0eff7' }}>
      {tramos.map((n, i) => n ? <div key={i} style={{ width: `${n / tot * 100}%`, background: TRAMO_COL[i] }} /> : null)}
    </div>
  )
}

function EnVivo({ act }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 15000); return () => clearInterval(t) }, [])
  const s = act ? Math.round((Date.now() - act.getTime()) / 1000) : null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#1E7A44' }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: '#34C759', boxShadow: '0 0 0 3px #34C75933' }} />
      En vivo{s != null ? ` · actualizado ${s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`}` : ''}
    </span>
  )
}

function CentroConversaciones({ sucursales, sucVista, isMobile }) {
  const card = { background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(22,33,62,.06)', border: '1px solid #eeedf5' }
  const H = t => <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6E6E73', marginBottom: 12 }}>{t}</div>
  const pre = globalThis.__CC__ || {}
  const [per, setPer] = useState('hoy')
  const [g, setG] = useState(pre.g || [])
  const [gPrev, setGPrev] = useState(pre.gPrev || [])
  const [res, setRes] = useState(pre.res || [])
  const [resPrev, setResPrev] = useState(pre.resPrev || [])
  const [dist, setDist] = useState(pre.dist || [])
  const [horas, setHoras] = useState(pre.horas || [])
  const [band, setBand] = useState(pre.band || [])
  const [act, setAct] = useState(pre.band ? new Date() : null)
  const [orden, setOrden] = useState(['mensajes', -1])
  const [fAg, setFAg] = useState('')
  const [err, setErr] = useState('')
  const nomSuc = sid => sucursales.find(s => s.sucursal_id === sid)?.nombre || sid || '—'

  const cargar = async () => {
    const [d1, d2, p1, p2] = rangoPer(per)
    try {
      const rs = await Promise.all([
        supabase.rpc('fn_vambe_gestion', { p_desde: d1, p_hasta: d2 }),
        supabase.rpc('fn_vambe_gestion', { p_desde: p1, p_hasta: p2 }),
        supabase.rpc('fn_vambe_resumen', { p_desde: d1, p_hasta: d2 }),
        supabase.rpc('fn_vambe_resumen', { p_desde: p1, p_hasta: p2 }),
        supabase.rpc('fn_vambe_distribucion', { p_desde: d1, p_hasta: d2 }),
        supabase.rpc('fn_vambe_horas', { p_dia: per === 'ayer' ? diaCL(1) : diaCL(0) }),
        supabase.from('v_vambe_bandeja').select('*').order('ultimo_at', { ascending: false }).limit(600),
      ])
      const e1 = rs.find(x => x.error); if (e1) throw e1.error
      setG(rs[0].data || []); setGPrev(rs[1].data || []); setRes(rs[2].data || []); setResPrev(rs[3].data || [])
      setDist(rs[4].data || []); setHoras(rs[5].data || []); setBand(rs[6].data || []); setAct(new Date()); setErr('')
    } catch (x) { setErr(String(x?.message || x)) }
  }
  useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t) /* eslint-disable-next-line */ }, [per])

  const enSuc = x => !sucVista || x.sucursal_id === sucVista
  const gV = g.filter(enSuc), gPV = gPrev.filter(enSuc)
  const clave = sucVista || 'TODAS'
  const rs0 = res.find(r => r.sucursal_id === clave) || {}, rsP = resPrev.find(r => r.sucursal_id === clave) || {}
  const sla = Number(rs0.sla_min || gV[0]?.sla_min || 15)
  const bandV = band.filter(enSuc)
  const esperando = bandV.filter(b => b.estado === 'esperando')
  const sobreMeta = esperando.filter(b => Number(b.minutos_habiles_esperando || 0) > sla)
  const masLarga = esperando.reduce((m, b) => Math.max(m, Number(b.minutos_esperando || 0)), 0)
  const masLargaH = esperando.reduce((m, b) => Math.max(m, Number(b.minutos_habiles_esperando || 0)), 0)
  const msj = sumK(gV, 'mensajes'), msjP = sumK(gPV, 'mensajes')
  const cli = sumK(gV, 'contactos'), cliP = sumK(gPV, 'contactos')
  const leid = sumK(gV, 'leidos')
  const pctMeta = rs0.respuestas ? Math.round(rs0.sla_ok / rs0.respuestas * 100) : null
  const pctMetaP = rsP.respuestas ? Math.round(rsP.sla_ok / rsP.respuestas * 100) : null
  const tramosDe = aid => { const t = [0, 0, 0, 0, 0]; dist.filter(x => (aid ? x.agent_id === aid : enSuc(x))).forEach(x => { t[x.tramo] += Number(x.respuestas || 0) }); return t }
  const tramosAll = tramosDe(null)
  const esperandoDe = bsale => esperando.filter(b => (b.asignado_bsale || []).map(String).includes(String(bsale)))

  const filas = gV.map(r => ({ ...r, esperando: r.bsale_user_id ? esperandoDe(r.bsale_user_id).length : 0,
    meta: r.respuestas ? Math.round(r.sla_ok / r.respuestas * 100) : null, lect: r.mensajes ? Math.round(r.leidos / r.mensajes * 100) : null }))
  const [oc, od] = orden
  filas.sort((a, b) => { const x = a[oc], y = b[oc]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * od })
  const maxMsj = Math.max(1, ...filas.map(f => f.mensajes || 0))
  const th = (k, l, align = 'right') => (
    <th onClick={() => setOrden(o => [k, o[0] === k ? -o[1] : -1])} style={{ textAlign: align, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none', fontSize: 11.5 }}>
      {l}{oc === k ? (od < 0 ? ' ▾' : ' ▴') : ''}
    </th>
  )

  const cola = esperando.filter(b => !fAg || (b.asignado_bsale || []).map(String).includes(fAg))
    .sort((a, b) => Number(b.minutos_habiles_esperando || 0) - Number(a.minutos_habiles_esperando || 0) || Number(b.minutos_esperando || 0) - Number(a.minutos_esperando || 0))

  // actividad por hora
  const hs = {}
  horas.filter(enSuc).forEach(h => { const o = hs[h.hora] || (hs[h.hora] = { c: 0, v: 0, ia: 0 }); o.c += h.clientes || 0; o.v += h.vendedores || 0; o.ia += h.ia || 0 })
  const rangoH = Array.from({ length: 16 }, (_, i) => i + 8)
  const maxH = Math.max(1, ...rangoH.map(h => Math.max(hs[h]?.c || 0, hs[h]?.v || 0, hs[h]?.ia || 0)))
  const horaAhora = new Date().getHours()

  const kpi = (l, v, sub, color, delta) => (
    <div style={{ ...card, padding: '16px 18px' }}>
      <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6E6E73', fontWeight: 800 }}>{l}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
        <div style={{ fontSize: 30, fontWeight: 800, color: color || '#1C1C1E', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
        {delta}
      </div>
      {sub && <div style={{ fontSize: 12, color: '#6E6E73', marginTop: 3 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: '#16213E' }}>Centro de conversaciones</div>
        <EnVivo act={act} />
        <div style={{ display: 'inline-flex', background: '#eceaf6', borderRadius: 10, padding: 3, marginLeft: isMobile ? 0 : 'auto' }}>
          {[['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7d', '7 días'], ['30d', '30 días']].map(([k, l]) => (
            <button key={k} onClick={() => setPer(k)} style={{ background: per === k ? '#fff' : 'transparent', color: per === k ? '#16213E' : '#6E6E73', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', boxShadow: per === k ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize: 12, color: '#6E6E73', fontWeight: 700 }}>Meta: responder en ≤ {sla} min hábiles</span>
        {err && <span style={{ fontSize: 12, color: '#D92D20', fontWeight: 700 }}>{err}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(7, minmax(0,1fr))', gap: 12, marginBottom: 14 }}>
        {kpi('Esperando respuesta', fN(esperando.length), sobreMeta.length ? `${sobreMeta.length} fuera de meta` : 'todos dentro de meta', esperando.length ? (sobreMeta.length ? '#D92D20' : '#B25E09') : '#1E7A44')}
        {kpi('Espera más larga', minTxt(masLarga || null), masLarga ? `${minTxt(masLargaH)} en horario hábil` : 'sin clientes esperando', masLargaH > sla ? '#D92D20' : '#1C1C1E')}
        {kpi('1ª respuesta · mediana', minTxt(rs0.mediana_habil == null ? null : Number(rs0.mediana_habil)), `hábil · p90 ${minTxt(rs0.p90_habil == null ? null : Number(rs0.p90_habil))} · reloj ${minTxt(rs0.mediana_reloj == null ? null : Number(rs0.mediana_reloj))}`, colResp(rs0.mediana_habil == null ? null : Number(rs0.mediana_habil), sla),
          <Delta v={Number(rs0.mediana_habil)} prev={Number(rsP.mediana_habil)} invert />)}
        {kpi('Cumplimiento de meta', pctMeta == null ? '—' : `${pctMeta}%`, rs0.respuestas ? `${fN(rs0.sla_ok)} de ${fN(rs0.respuestas)} respuestas ≤ ${sla} min` : 'sin respuestas en el período', pctMeta == null ? '#8b88a8' : pctMeta >= 80 ? '#1E7A44' : pctMeta >= 60 ? '#B25E09' : '#D92D20',
          <Delta v={pctMeta} prev={pctMetaP} />)}
        {kpi('Mensajes de vendedores', fN(msj), PER_TXT[per], C1, <Delta v={msj} prev={msjP} />)}
        {kpi('Clientes atendidos', fN(cli), `${fN(gV.length)} vendedores activos`, '#1C1C1E', <Delta v={cli} prev={cliP} />)}
        {kpi('Tasa de lectura', msj ? `${Math.round(leid / msj * 100)}%` : '—', 'mensajes leídos por el cliente', '#1C1C1E')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1.7fr) minmax(0,1fr)', gap: 14, marginBottom: 14 }}>
        <div style={{ ...card, overflowX: 'auto' }}>
          {H('Rendimiento por vendedor')}
          <table className="com" style={{ width: '100%', fontSize: 13.5 }}>
            <thead><tr>
              {th('nombre', 'Vendedor', 'left')}{!sucVista && th('sucursal_id', 'Tienda', 'left')}
              {th('esperando', 'Esperando')}{th('mensajes', 'Mensajes')}{th('contactos', 'Clientes')}{th('respuestas', 'Respuestas')}
              {th('mediana_habil', '1ª resp. mediana')}{th('p90_habil', 'P90')}{th('meta', 'Meta')}
              <th style={{ textAlign: 'left', fontSize: 11.5 }}>Velocidad</th>{th('lect', 'Leídos')}{th('ultima_at', 'Último msj')}
            </tr></thead>
            <tbody>
              {filas.map(f => {
                const act2 = f.ultima_at ? (Date.now() - new Date(f.ultima_at).getTime()) / 60000 : 9999
                const sel = fAg && fAg === String(f.bsale_user_id)
                const med = f.mediana_habil == null ? null : Number(f.mediana_habil)
                return (
                  <tr key={f.agent_id} className="click" onClick={() => setFAg(sel ? '' : String(f.bsale_user_id || ''))} style={sel ? { background: '#f4f3ff' } : undefined}>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
                      <span title={act2 < 15 ? 'Activo en los últimos 15 min' : act2 < 60 ? 'Activo en la última hora' : 'Sin actividad reciente'}
                        style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 7, background: act2 < 15 ? '#34C759' : act2 < 60 ? '#FF9F0A' : '#C7C7CC' }} />
                      {normNom(f.nombre)}
                    </td>
                    {!sucVista && <td style={{ color: '#6E6E73', whiteSpace: 'nowrap' }}>{nomSuc(f.sucursal_id)}</td>}
                    <td style={{ textAlign: 'right', fontWeight: 800, color: f.esperando ? '#D92D20' : '#C7C7CC' }}>{f.esperando || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                        <div style={{ width: 60, height: 6, background: '#f0eff7', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: `${f.mensajes / maxMsj * 100}%`, height: '100%', background: C1 }} /></div>
                        <b style={{ minWidth: 28, fontVariantNumeric: 'tabular-nums' }}>{fN(f.mensajes)}</b>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fN(f.contactos)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fN(f.respuestas)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: colResp(med, sla) }}>{minTxt(med)}</td>
                    <td style={{ textAlign: 'right', color: '#6E6E73' }}>{minTxt(f.p90_habil == null ? null : Number(f.p90_habil))}</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, color: f.meta == null ? '#C7C7CC' : f.meta >= 80 ? '#1E7A44' : f.meta >= 60 ? '#B25E09' : '#D92D20' }}>{f.meta == null ? '—' : f.meta + '%'}</td>
                    <td style={{ minWidth: 110 }}><BarraTramos tramos={tramosDe(f.agent_id)} /></td>
                    <td style={{ textAlign: 'right', color: '#6E6E73' }}>{f.lect == null ? '—' : f.lect + '%'}</td>
                    <td style={{ textAlign: 'right', color: '#6E6E73', whiteSpace: 'nowrap' }}>{haceCorto(f.ultima_at)}</td>
                  </tr>
                )
              })}
              {!filas.length && <tr><td colSpan={12} style={{ textAlign: 'center', color: '#8b88a8', padding: 20 }}>Sin mensajes de vendedores en el período</td></tr>}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 11.5, color: '#6E6E73', alignItems: 'center' }}>
            <span style={{ fontWeight: 800 }}>Velocidad de respuesta:</span>
            {TRAMOS_V.map((t, i) => <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: TRAMO_COL[i] }} />{t}</span>)}
            <span style={{ marginLeft: 'auto' }}>Clic en un vendedor para filtrar su cola · horario hábil L-V 09:30–18:00, Sáb 09:30–13:30</span>
          </div>
        </div>

        <div style={{ ...card, borderTop: `4px solid ${cola.length ? '#D92D20' : '#1E7A44'}`, display: 'flex', flexDirection: 'column', maxHeight: isMobile ? 'none' : 640 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {H(`Cola en vivo · ${cola.length} esperando`)}
            {fAg && <button onClick={() => setFAg('')} style={{ marginLeft: 'auto', marginBottom: 12, background: '#f0eff7', color: '#16213E', border: 'none', borderRadius: 7, padding: '4px 10px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>Ver toda la tienda ✕</button>}
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {cola.map(b => {
              const mh = Number(b.minutos_habiles_esperando || 0), mr = Number(b.minutos_esperando || 0)
              const c2 = mh > sla * 4 ? '#D92D20' : mh > sla ? '#FF6B3D' : '#B25E09'
              return (
                <div key={b.ai_contact_id} style={{ display: 'flex', gap: 12, padding: '11px 4px', borderBottom: '1px solid #f2f1f8', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 70, textAlign: 'center', background: c2 + '14', borderRadius: 8, padding: '6px 4px' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: c2, lineHeight: 1.1 }}>{minTxt(mr)}</div>
                    <div style={{ fontSize: 10, color: '#6E6E73', fontWeight: 700 }}>{minTxt(mh)} háb.</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{normNom(b.nombre || b.telefono)}</div>
                    <div style={{ fontSize: 12, color: '#6E6E73', marginTop: 1 }}>{[!sucVista && nomSuc(b.sucursal_id), b.etapa].filter(Boolean).join(' · ')}</div>
                    <div style={{ fontSize: 12.5, color: '#3a3a3c', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{b.ultimo_texto || '…'}”</div>
                    <div style={{ marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(b.asignados || []).length ? (b.asignados || []).map(n => <span key={n} style={{ fontSize: 11, fontWeight: 800, color: '#16213E', background: '#eceaf6', borderRadius: 6, padding: '2px 8px' }}>{normNom(n)}</span>)
                        : <span style={{ fontSize: 11, fontWeight: 800, color: '#D92D20', background: '#D92D2012', borderRadius: 6, padding: '2px 8px' }}>Sin vendedor asignado</span>}
                    </div>
                  </div>
                  <a href={chatUrl(b.ai_contact_id)} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: '#16213E', borderRadius: 8, padding: '7px 12px', textDecoration: 'none', whiteSpace: 'nowrap' }}>Responder ↗</a>
                </div>
              )
            })}
            {!cola.length && <div style={{ fontSize: 14, color: '#1E7A44', fontWeight: 800, padding: '18px 4px' }}>✓ Ningún cliente esperando respuesta{fAg ? ' de este vendedor' : ''}</div>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1.7fr) minmax(0,1fr)', gap: 14 }}>
        <div style={card}>
          {H(`Demanda vs atención por hora · ${per === 'ayer' ? 'ayer' : 'hoy'}`)}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 150, padding: '0 2px' }}>
            {rangoH.map(h => {
              const o = hs[h] || { c: 0, v: 0, ia: 0 }
              return (
                <div key={h} title={`${h}:00 · clientes ${o.c} · vendedores ${o.v} · IA ${o.ia}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: per === 'hoy' && h > horaAhora ? 0.35 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 124, width: '100%', justifyContent: 'center' }}>
                    <div style={{ width: '30%', height: `${o.c / maxH * 100}%`, background: '#C7C5E0', borderRadius: '3px 3px 0 0', minHeight: o.c ? 2 : 0 }} />
                    <div style={{ width: '30%', height: `${o.v / maxH * 100}%`, background: '#16213E', borderRadius: '3px 3px 0 0', minHeight: o.v ? 2 : 0 }} />
                    <div style={{ width: '30%', height: `${o.ia / maxH * 100}%`, background: '#9FD7B0', borderRadius: '3px 3px 0 0', minHeight: o.ia ? 2 : 0 }} />
                  </div>
                  <div style={{ fontSize: 11, color: h === horaAhora && per === 'hoy' ? '#16213E' : '#8b88a8', fontWeight: h === horaAhora && per === 'hoy' ? 800 : 600 }}>{h}</div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: '#6E6E73' }}>
            {[['#C7C5E0', 'Mensajes de clientes'], ['#16213E', 'Respuestas de vendedores'], ['#9FD7B0', 'Respuestas de la IA']].map(([c3, l]) => (
              <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 11, height: 11, borderRadius: 2, background: c3 }} />{l}</span>
            ))}
          </div>
        </div>
        <div style={card}>
          {H('Velocidad de respuesta de la tienda')}
          <BarraTramos tramos={tramosAll} alto={18} />
          <div style={{ marginTop: 14 }}>
            {TRAMOS_V.map((t, i) => {
              const tot = tramosAll.reduce((s, x) => s + x, 0)
              return (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 13.5 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: TRAMO_COL[i] }} />
                  <span style={{ flex: 1 }}>{t}</span>
                  <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fN(tramosAll[i])}</b>
                  <span style={{ width: 44, textAlign: 'right', color: '#6E6E73' }}>{tot ? Math.round(tramosAll[i] / tot * 100) : 0}%</span>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: 11.5, color: '#8b88a8', marginTop: 8 }}>Tiempo hábil entre el primer mensaje del cliente sin respuesta y la respuesta del vendedor. Excluye IA y respuestas automáticas.</div>
        </div>
      </div>
    </div>
  )
}

/* ═══ MIS CHATS · bandeja de WhatsApp en Mi Día (vendedor: los suyos · jefe: su tienda con asignados) ═══ */
function ChatsVambeMiDia({ modoTienda, sucursalId, vendedorBsaleId, isMobile, onCount, onVerTodo }) {
  const card = { background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(22,33,62,.06)', border: '1px solid #eeedf5' }
  const pre = globalThis.__CV__ || null
  const [band, setBand] = useState(pre?.band || [])
  const [g, setG] = useState(pre?.g || [])
  const [res, setRes] = useState(pre?.res || [])
  const [act, setAct] = useState(pre ? new Date() : null)
  const [verTodos, setVerTodos] = useState(false)
  const cargar = async () => {
    if (modoTienda ? !sucursalId : !vendedorBsaleId) return
    try {
      let q = supabase.from('v_vambe_bandeja').select('*').order('ultimo_at', { ascending: false }).limit(300)
      q = modoTienda ? q.eq('sucursal_id', sucursalId) : q.contains('asignado_bsale', [Number(vendedorBsaleId)])
      const hoy = diaCL(0)
      const [a, b, c3] = await Promise.all([q, supabase.rpc('fn_vambe_gestion', { p_desde: hoy, p_hasta: hoy }), supabase.rpc('fn_vambe_resumen', { p_desde: hoy, p_hasta: hoy })])
      setBand(a.data || []); setG(b.data || []); setRes(c3.data || []); setAct(new Date())
    } catch (e) { /* sin datos: la franja se oculta */ }
  }
  useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t) /* eslint-disable-next-line */ }, [modoTienda, sucursalId, vendedorBsaleId])

  const esperando = band.filter(b => b.estado === 'esperando').sort((a, b) => Number(b.minutos_habiles_esperando || 0) - Number(a.minutos_habiles_esperando || 0) || Number(b.minutos_esperando || 0) - Number(a.minutos_esperando || 0))
  useEffect(() => { if (onCount) onCount(esperando.length) /* eslint-disable-next-line */ }, [esperando.length])
  const hoyD = diaCL(0)
  const recientes = band.filter(b => b.estado !== 'esperando' && b.ultimo_at && new Date(b.ultimo_at).toLocaleDateString('en-CA') === hoyD)
  const mio = !modoTienda ? g.find(x => String(x.bsale_user_id) === String(vendedorBsaleId)) : null
  const equipo = modoTienda ? g.filter(x => x.sucursal_id === sucursalId).sort((a, b) => b.mensajes - a.mensajes) : []
  const rsT = modoTienda ? (res.find(r => r.sucursal_id === sucursalId) || {}) : null
  const sla = Number(mio?.sla_min || rsT?.sla_min || res[0]?.sla_min || 15)
  const med = modoTienda ? (rsT?.mediana_habil == null ? null : Number(rsT.mediana_habil)) : (mio?.mediana_habil == null ? null : Number(mio.mediana_habil))
  const meta = modoTienda ? (rsT?.respuestas ? Math.round(rsT.sla_ok / rsT.respuestas * 100) : null) : (mio?.respuestas ? Math.round(mio.sla_ok / mio.respuestas * 100) : null)
  const msjHoy = modoTienda ? sumK(equipo, 'mensajes') : Number(mio?.mensajes || 0)
  const cliHoy = modoTienda ? sumK(equipo, 'contactos') : Number(mio?.contactos || 0)
  const sobre = esperando.filter(b => Number(b.minutos_habiles_esperando || 0) > sla).length
  const esperDe = bs => esperando.filter(b => (b.asignado_bsale || []).map(String).includes(String(bs))).length

  const pill = (l, v, c2, sub) => (
    <div style={{ background: c2 + '0f', border: `1px solid ${c2}22`, borderRadius: 12, padding: '10px 14px', minWidth: 118, flex: '1 1 118px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: c2, textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#1C1C1E', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
      {sub && <div style={{ fontSize: 11, color: '#6E6E73' }}>{sub}</div>}
    </div>
  )
  const fila = (b, conAsignado) => {
    const esp = b.estado === 'esperando'
    const mh = Number(b.minutos_habiles_esperando || 0), mr = Number(b.minutos_esperando || 0)
    const c2 = !esp ? '#8b88a8' : mh > sla * 4 ? '#D92D20' : mh > sla ? '#FF6B3D' : '#B25E09'
    const est = esp ? null : b.estado === 'ia' ? ['IA atendiendo', '#1E7A44'] : b.estado === 'respondido' ? ['Respondido', '#16213E'] : ['Sin acción', '#8b88a8']
    return (
      <div key={b.ai_contact_id} style={{ display: 'flex', gap: 12, padding: '10px 4px', borderBottom: '1px solid #f2f1f8', alignItems: 'center' }}>
        <div style={{ minWidth: 76, textAlign: 'center', background: c2 + '14', borderRadius: 8, padding: '6px 4px' }}>
          {esp ? <><div style={{ fontSize: 15, fontWeight: 800, color: c2, lineHeight: 1.1 }}>{minTxt(mr)}</div><div style={{ fontSize: 10, color: '#6E6E73', fontWeight: 700 }}>esperando</div></>
            : <div style={{ fontSize: 11, fontWeight: 800, color: est[1] }}>{est[0]}</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{normNom(b.nombre || b.telefono)}
            <span style={{ fontSize: 11.5, color: '#8b88a8', fontWeight: 600 }}> · {b.etapa || 'sin etapa'} · {haceCorto(b.ultimo_at)}</span></div>
          <div style={{ fontSize: 12.5, color: '#3a3a3c', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ color: '#8b88a8', fontWeight: 700 }}>{b.ultimo_autor === 'cliente' ? 'Cliente' : b.ultimo_autor === 'humano' ? 'Vendedor' : b.ultimo_autor === 'ia' ? 'IA' : 'Automático'}: </span>{b.ultimo_texto || '…'}
          </div>
          {conAsignado && <div style={{ marginTop: 4 }}>{(b.asignados || []).length ? (b.asignados || []).map(n => <span key={n} style={{ fontSize: 11, fontWeight: 800, color: '#16213E', background: '#eceaf6', borderRadius: 6, padding: '2px 8px', marginRight: 5 }}>{normNom(n)}</span>)
            : <span style={{ fontSize: 11, fontWeight: 800, color: '#D92D20', background: '#D92D2012', borderRadius: 6, padding: '2px 8px' }}>Sin vendedor asignado</span>}</div>}
        </div>
        <a href={chatUrl(b.ai_contact_id)} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 800, color: esp ? '#fff' : '#16213E', background: esp ? '#16213E' : '#eceaf6', borderRadius: 8, padding: '7px 12px', textDecoration: 'none', whiteSpace: 'nowrap' }}>{esp ? 'Responder ↗' : 'Abrir ↗'}</a>
      </div>
    )
  }
  if (!act && !pre) return null
  const lista = [...esperando, ...(verTodos ? recientes : recientes.slice(0, modoTienda ? 3 : 5))]
  return (
    <div style={{ ...card, marginBottom: 12, borderLeft: `5px solid ${esperando.length ? (sobre ? '#D92D20' : '#FF9F0A') : '#1E7A44'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16.5, fontWeight: 800, color: '#16213E' }}>💬 {modoTienda ? 'Chats de WhatsApp de la tienda' : 'Mis chats de WhatsApp'}</div>
        <EnVivo act={act} />
        {onVerTodo && <button onClick={onVerTodo} style={{ marginLeft: 'auto', background: '#eceaf6', color: '#16213E', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Centro de conversaciones →</button>}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {pill(modoTienda ? 'Esperando respuesta' : 'Esperándote', fN(esperando.length), esperando.length ? '#D92D20' : '#1E7A44', sobre ? `${sobre} fuera de meta` : 'dentro de meta')}
        {pill(modoTienda ? '1ª respuesta tienda' : 'Tu 1ª respuesta', minTxt(med), colResp(med, sla), 'mediana hábil hoy')}
        {pill('Meta ≤ ' + sla + ' min', meta == null ? '—' : meta + '%', meta == null ? '#8b88a8' : meta >= 80 ? '#1E7A44' : meta >= 60 ? '#B25E09' : '#D92D20', 'respuestas a tiempo')}
        {pill(modoTienda ? 'Mensajes del equipo' : 'Tus mensajes', fN(msjHoy), '#16213E', 'hoy')}
        {pill('Clientes atendidos', fN(cliHoy), '#16213E', 'hoy')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: (!modoTienda || isMobile) ? '1fr' : 'minmax(0,1.6fr) minmax(0,1fr)', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#6E6E73', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{esperando.length ? `Esperando respuesta (${esperando.length})` : 'Conversaciones de hoy'}</div>
          {lista.map(b => fila(b, modoTienda))}
          {!lista.length && <div style={{ fontSize: 13.5, color: '#1E7A44', fontWeight: 800, padding: '10px 4px' }}>✓ {modoTienda ? 'Sin chats pendientes en la tienda' : 'No tienes clientes esperando. Buen trabajo.'}</div>}
          {recientes.length > (modoTienda ? 3 : 5) && <button onClick={() => setVerTodos(v => !v)} style={{ marginTop: 8, background: 'none', border: 'none', color: C2, fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>{verTodos ? 'Ver menos' : `Ver las ${recientes.length} conversaciones de hoy`}</button>}
        </div>
        {modoTienda && (
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: '#6E6E73', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Equipo hoy</div>
            <table className="com" style={{ width: '100%', fontSize: 13 }}>
              <thead><tr><th>Vendedor</th><th style={{ textAlign: 'right' }}>Esperando</th><th style={{ textAlign: 'right' }}>Msj</th><th style={{ textAlign: 'right' }}>1ª resp.</th><th style={{ textAlign: 'right' }}>Meta</th></tr></thead>
              <tbody>
                {equipo.map(x => {
                  const m2 = x.mediana_habil == null ? null : Number(x.mediana_habil), mt = x.respuestas ? Math.round(x.sla_ok / x.respuestas * 100) : null, ne = esperDe(x.bsale_user_id)
                  return (
                    <tr key={x.agent_id}>
                      <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{normNom(x.nombre)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: ne ? '#D92D20' : '#C7C7CC' }}>{ne || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{fN(x.mensajes)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: colResp(m2, sla) }}>{minTxt(m2)}</td>
                      <td style={{ textAlign: 'right', color: mt == null ? '#C7C7CC' : mt >= 80 ? '#1E7A44' : mt >= 60 ? '#B25E09' : '#D92D20', fontWeight: 800 }}>{mt == null ? '—' : mt + '%'}</td>
                    </tr>
                  )
                })}
                {!equipo.length && <tr><td colSpan={5} style={{ color: '#8b88a8', textAlign: 'center', padding: 12 }}>Sin mensajes del equipo hoy</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══ DASHBOARD · INTELIGENCIA COMERCIAL EN VIVO (v_com_pipeline + Vambe live + snapshots BSALE) ═══ */
function PanelInteligencia({ sucursales, vendedores, fSuc, anio, mes, isMobile, onIr }) {
  const card = { background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(22,33,62,.06)', border: '1px solid #eeedf5' }
  const H = t => <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6E6E73', marginBottom: 12 }}>{t}</div>
  const pre = globalThis.__PI__ || null
  const [pipe, setPipe] = useState(pre?.pipe || [])
  const [band, setBand] = useState(pre?.band || [])
  const [resH, setResH] = useState(pre?.resH || [])
  const [gMes, setGMes] = useState(pre?.gMes || [])
  const [vdm, setVdm] = useState(pre?.vdm || [])
  const [act, setAct] = useState(pre ? new Date() : null)
  const mesIni = `${anio}-${String(mes).padStart(2, '0')}-01`
  const mesFin = new Date(anio, mes, 0).toLocaleDateString('en-CA')
  const hoy = diaCL(0)
  const hastaMes = mesFin < hoy ? mesFin : hoy
  const cargar = async () => {
    try {
      let q1 = supabase.from('v_com_pipeline').select('id,total,estado,salud,nivel,en_riesgo,abierta,valor_ponderado,sucursal_id,vendedor_bsale_id,edad_dias')
      if (fSuc) q1 = q1.eq('sucursal_id', fSuc)
      let q2 = supabase.from('v_vambe_bandeja').select('ai_contact_id,estado,sucursal_id,asignado_bsale,minutos_habiles_esperando,minutos_esperando').eq('estado', 'esperando')
      if (fSuc) q2 = q2.eq('sucursal_id', fSuc)
      let q5 = supabase.from('com_ventas_dia').select('fecha,sucursal_id,venta,ventas_vendedor').gte('fecha', mesIni).lte('fecha', mesFin)
      if (fSuc) q5 = q5.eq('sucursal_id', fSuc)
      const rs = await Promise.all([q1.limit(6000), q2.limit(500), supabase.rpc('fn_vambe_resumen', { p_desde: hoy, p_hasta: hoy }),
        supabase.rpc('fn_vambe_gestion', { p_desde: mesIni, p_hasta: hastaMes }), q5])
      setPipe(rs[0].data || []); setBand(rs[1].data || []); setResH(rs[2].data || []); setGMes(rs[3].data || []); setVdm(rs[4].data || []); setAct(new Date())
    } catch (e) { /* el panel se muestra con lo disponible */ }
  }
  useEffect(() => { cargar(); const t = setInterval(cargar, 120000); return () => clearInterval(t) /* eslint-disable-next-line */ }, [fSuc, anio, mes])

  const sum = (a, f) => a.reduce((s, x) => s + Number(f(x) || 0), 0)
  const ab = pipe.filter(r => r.abierta)
  const porSalud = k => pipe.filter(r => r.salud === k)
  const riesgo = ab.filter(r => r.en_riesgo)
  const conv = pipe.filter(r => r.estado === 'convertida').length, perd = pipe.filter(r => r.estado === 'perdida').length
  const tasa = conv + perd ? Math.round(conv / (conv + perd) * 100) : null
  const sla = Number(resH[0]?.sla_min || 15)
  const rh = resH.find(r => r.sucursal_id === (fSuc || 'TODAS')) || {}
  const fuera = band.filter(b => Number(b.minutos_habiles_esperando || 0) > sla).length
  const sinDueño = band.filter(b => !(b.asignado_bsale || []).length).length
  const metaPct = rh.respuestas ? Math.round(rh.sla_ok / rh.respuestas * 100) : null

  const alerta = (l, v, sub, color, destino) => (
    <div onClick={destino && onIr ? () => onIr(destino) : undefined} style={{ ...card, padding: '14px 16px', borderTop: `4px solid ${color}`, cursor: destino && onIr ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6E6E73', fontWeight: 800 }}>{l}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
      <div style={{ fontSize: 12, color: '#6E6E73' }}>{sub}</div>
    </div>
  )
  const semaf = (n, amarillo = 1) => n === 0 ? '#1E7A44' : n >= amarillo * 5 ? '#D92D20' : '#B25E09'

  // embudo por etapa (cotizaciones de la ventana del motor, 90 días)
  const ETAPAS = [['sin_contactar', 'Sin contactar', '#D92D20'], ['contactado', 'Contactado', '#FF9F0A'], ['en_negociacion', 'En negociación', '#5856D6'],
    ['en_despacho', 'En despacho', '#0A84FF'], ['convertida', 'Convertida', '#1E7A44'], ['perdida', 'Perdida', '#8E8E93']]
  const et = ETAPAS.map(([k, l, c2]) => { const xs = pipe.filter(r => r.estado === k); return { k, l, c2, n: xs.length, m: sum(xs, x => x.total) } })
  const maxEt = Math.max(1, ...et.map(e => e.m))

  // scorecard: venta del mes (snapshots BSALE) + pipeline + conversaciones
  const ventaV = {}
  vdm.forEach(d => (Array.isArray(d.ventas_vendedor) ? d.ventas_vendedor : []).forEach(v => {
    const k = String(v.seller_id); const o = ventaV[k] || (ventaV[k] = { venta: 0, docs: 0 }); o.venta += Number(v.total || 0); o.docs += Number(v.count || 0)
  }))
  const vendV = vendedores.filter(v => v.activo !== false && (!fSuc || v.sucursal_id === fSuc))
  const score = vendV.map(v => {
    const k = String(v.bsale_user_id)
    const pv = pipe.filter(r => String(r.vendedor_bsale_id) === k)
    const abV = pv.filter(r => r.abierta)
    const cv = pv.filter(r => r.estado === 'convertida').length, pe = pv.filter(r => r.estado === 'perdida').length
    const gm = gMes.find(x => String(x.bsale_user_id) === k)
    return {
      k, nombre: v.nombre, suc: v.sucursal_id, rol: v.rol,
      venta: ventaV[k]?.venta || 0, docs: ventaV[k]?.docs || 0,
      pipe: sum(abV, x => x.total), riesgo: sum(abV.filter(r => r.en_riesgo), x => x.total),
      conv: cv + pe ? Math.round(cv / (cv + pe) * 100) : null,
      esperando: band.filter(b => (b.asignado_bsale || []).map(String).includes(k)).length,
      resp: gm?.mediana_habil == null ? null : Number(gm.mediana_habil),
      meta: gm?.respuestas ? Math.round(gm.sla_ok / gm.respuestas * 100) : null,
      msj: gm?.mensajes || 0,
    }
  }).filter(s => s.venta || s.pipe || s.msj).sort((a, b) => b.venta - a.venta)
  const maxVenta = Math.max(1, ...score.map(s => s.venta))
  const nomSuc = sid => sucursales.find(s => s.sucursal_id === sid)?.nombre || sid || '—'

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#16213E' }}>Gestión comercial en vivo</div>
        <EnVivo act={act} />
        <span style={{ fontSize: 12, color: '#6E6E73' }}>Cotizaciones (motor del Radar) · WhatsApp (Vambe cada 5 min) · Venta (BSALE)</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6, minmax(0,1fr))', gap: 12, marginBottom: 14 }}>
        {alerta('Sin contactar +24 h', fN(porSalud('sla_vencido').length), `${fmtK(sum(porSalud('sla_vencido'), x => x.total))} esperando primer contacto`, semaf(porSalud('sla_vencido').length), 'cotizaciones')}
        {alerta('Seguimientos vencidos', fN(porSalud('vencida').length), `${fmtK(sum(porSalud('vencida'), x => x.total))} con compromiso atrasado`, semaf(porSalud('vencida').length), 'cotizaciones')}
        {alerta('Estancadas', fN(porSalud('estancada').length), '5+ días sin gestión', semaf(porSalud('estancada').length), 'cotizaciones')}
        {alerta('Para cierre (21+ días)', fN(porSalud('cierre_sugerido').length), `${fmtK(sum(porSalud('cierre_sugerido'), x => x.total))} a depurar`, semaf(porSalud('cierre_sugerido').length), 'cotizaciones')}
        {alerta('Chats esperando', fN(band.length), fuera ? `${fuera} fuera de meta (${sla} min)` : 'todos dentro de meta', band.length ? (fuera ? '#D92D20' : '#B25E09') : '#1E7A44', 'vambe')}
        {alerta('Chats sin vendedor', fN(sinDueño), 'esperando sin asignar', sinDueño ? '#D92D20' : '#1E7A44', 'vambe')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1.35fr) minmax(0,1fr)', gap: 14, marginBottom: 14 }}>
        <div style={card}>
          {H('Pipeline de cotizaciones · 90 días')}
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 14 }}>
            {[['Abierto', fmtK(sum(ab, x => x.total)), `${fN(ab.length)} cotizaciones`, C1],
              ['Pronóstico ponderado', fmtK(sum(ab, x => x.valor_ponderado)), 'monto × probabilidad', '#16213E'],
              ['En riesgo', fmtK(sum(riesgo, x => x.total)), `${pct(sum(riesgo, x => x.total), sum(ab, x => x.total))}% del abierto`, riesgo.length ? '#D92D20' : '#1E7A44'],
              ['Conversión', tasa == null ? '—' : tasa + '%', `${fN(conv)} ganadas · ${fN(perd)} perdidas`, '#1C1C1E']].map(([l, v, s2, c2]) => (
              <div key={l}><div style={{ fontSize: 11, color: '#6E6E73', fontWeight: 800, textTransform: 'uppercase' }}>{l}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: c2, fontVariantNumeric: 'tabular-nums' }}>{v}</div><div style={{ fontSize: 11.5, color: '#6E6E73' }}>{s2}</div></div>
            ))}
          </div>
          {et.map(e => (
            <div key={e.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
              <div style={{ width: 118, fontSize: 13, fontWeight: 700 }}>{e.l}</div>
              <div style={{ flex: 1, height: 14, background: '#f2f1f8', borderRadius: 7, overflow: 'hidden' }}><div style={{ width: `${e.m / maxEt * 100}%`, height: '100%', background: e.c2, borderRadius: 7 }} /></div>
              <div style={{ width: 70, textAlign: 'right', fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtK(e.m)}</div>
              <div style={{ width: 44, textAlign: 'right', fontSize: 12.5, color: '#6E6E73' }}>{fN(e.n)}</div>
            </div>
          ))}
        </div>
        <div style={card}>
          {H('Conversaciones de WhatsApp · hoy')}
          {[['Clientes esperando', fN(band.length), band.length ? (fuera ? '#D92D20' : '#B25E09') : '#1E7A44'],
            ['1ª respuesta (mediana hábil)', minTxt(rh.mediana_habil == null ? null : Number(rh.mediana_habil)), colResp(rh.mediana_habil == null ? null : Number(rh.mediana_habil), sla)],
            [`Respuestas dentro de ${sla} min`, metaPct == null ? '—' : metaPct + '%', metaPct == null ? '#8b88a8' : metaPct >= 80 ? '#1E7A44' : metaPct >= 60 ? '#B25E09' : '#D92D20'],
            ['Respuestas de vendedores', fN(rh.respuestas || 0), '#16213E'],
            ['P90 de respuesta', minTxt(rh.p90_habil == null ? null : Number(rh.p90_habil)), '#6E6E73']].map(([l, v, c2]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f2f1f8' }}>
              <span style={{ fontSize: 13.5, color: '#3a3a3c' }}>{l}</span><b style={{ fontSize: 20, color: c2, fontVariantNumeric: 'tabular-nums' }}>{v}</b>
            </div>
          ))}
          {onIr && <button onClick={() => onIr('vambe')} style={{ marginTop: 12, background: '#16213E', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>Abrir centro de conversaciones →</button>}
        </div>
      </div>

      <div style={{ ...card, overflowX: 'auto' }}>
        {H('Scorecard por vendedor · mes en curso')}
        <table className="com" style={{ width: '100%', fontSize: 13.5 }}>
          <thead><tr>
            <th>Vendedor</th>{!fSuc && <th>Tienda</th>}<th style={{ textAlign: 'right' }}>Venta mes</th><th style={{ textAlign: 'right' }}>Docs</th><th style={{ textAlign: 'right' }}>Ticket</th>
            <th style={{ textAlign: 'right' }}>Pipeline abierto</th><th style={{ textAlign: 'right' }}>En riesgo</th><th style={{ textAlign: 'right' }}>Conversión</th>
            <th style={{ textAlign: 'right' }}>Chats esperando</th><th style={{ textAlign: 'right' }}>1ª resp. mes</th><th style={{ textAlign: 'right' }}>Meta resp.</th>
          </tr></thead>
          <tbody>
            {score.map(s => (
              <tr key={s.k}>
                <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{normNom(s.nombre)}{s.rol && s.rol !== 'vendedor' && <span style={{ marginLeft: 6, fontSize: 10.5, color: '#6E6E73', fontWeight: 700 }}>{s.rol}</span>}</td>
                {!fSuc && <td style={{ color: '#6E6E73' }}>{nomSuc(s.suc)}</td>}
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                    <div style={{ width: 70, height: 6, background: '#f0eff7', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: `${s.venta / maxVenta * 100}%`, height: '100%', background: C1 }} /></div>
                    <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtK(s.venta)}</b>
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>{fN(s.docs)}</td>
                <td style={{ textAlign: 'right', color: '#6E6E73' }}>{s.docs ? fmtK(s.venta / s.docs) : '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtK(s.pipe)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: s.riesgo ? '#D92D20' : '#C7C7CC' }}>{s.riesgo ? fmtK(s.riesgo) : '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 800 }}>{s.conv == null ? '—' : s.conv + '%'}</td>
                <td style={{ textAlign: 'right', fontWeight: 800, color: s.esperando ? '#D92D20' : '#C7C7CC' }}>{s.esperando || '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 800, color: colResp(s.resp, sla) }}>{minTxt(s.resp)}</td>
                <td style={{ textAlign: 'right', color: s.meta == null ? '#C7C7CC' : s.meta >= 80 ? '#1E7A44' : s.meta >= 60 ? '#B25E09' : '#D92D20', fontWeight: 800 }}>{s.meta == null ? '—' : s.meta + '%'}</td>
              </tr>
            ))}
            {!score.length && <tr><td colSpan={11} style={{ textAlign: 'center', color: '#8b88a8', padding: 20 }}>Sin actividad de vendedores en el período</td></tr>}
          </tbody>
        </table>
        <div style={{ fontSize: 11.5, color: '#8b88a8', marginTop: 8 }}>Venta: snapshots BSALE del mes. Pipeline y conversión: cotizaciones de los últimos 90 días. Respuesta: WhatsApp en horario hábil (el historial de conversaciones parte el 22-09-2026).</div>
      </div>
    </div>
  )
}

/* ═══ COTIZACIONES · barra de etapas del pipeline (filtra la lista al hacer clic) ═══ */
function EtapasPipeline({ rows, fEstado, setFEstado, isMobile }) {
  const ETAPAS = [['sin_contactar', 'Sin contactar', '#D92D20'], ['contactado', 'Contactado', '#FF9F0A'], ['en_negociacion', 'En negociación', '#5856D6'],
    ['en_despacho', 'En despacho', '#0A84FF'], ['convertida', 'Convertida', '#1E7A44'], ['perdida', 'Perdida', '#8E8E93']]
  const tot = rows.length, totM = rows.reduce((s, r) => s + Number(r.total || 0), 0)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(6, minmax(0,1fr))', gap: 8, marginBottom: 12 }}>
      {ETAPAS.map(([k, l, c2], i) => {
        const xs = rows.filter(r => r.estado === k), m = xs.reduce((s, r) => s + Number(r.total || 0), 0)
        const on = fEstado === k
        return (
          <button key={k} onClick={() => setFEstado(on ? '' : k)} title={on ? 'Quitar filtro' : `Ver solo ${l.toLowerCase()}`}
            style={{ textAlign: 'left', cursor: 'pointer', border: on ? `2px solid ${c2}` : '1px solid #e7e5f2', background: on ? c2 + '10' : '#fff', borderRadius: 12,
              padding: '10px 14px', position: 'relative', boxShadow: '0 1px 2px rgba(22,33,62,.04)' }}>
            <div style={{ height: 4, background: c2, borderRadius: 2, marginBottom: 8, opacity: .85 }} />
            <div style={{ fontSize: 11.5, fontWeight: 800, color: '#6E6E73', textTransform: 'uppercase', letterSpacing: '.03em' }}>{i + 1}. {l}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#1C1C1E', fontVariantNumeric: 'tabular-nums' }}>{fN(xs.length)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#6E6E73' }}>{tot ? Math.round(xs.length / tot * 100) : 0}%</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: c2, fontVariantNumeric: 'tabular-nums' }}>{fmtK(m)}</div>
            <div style={{ fontSize: 10.5, color: '#8b88a8' }}>{totM ? Math.round(m / totM * 100) : 0}% del monto</div>
          </button>
        )
      })}
    </div>
  )
}

/* ═══ METAS · barra de ritmo del mes (dónde vamos vs dónde deberíamos ir hoy) ═══ */
function PacingMes({ gen, resumenes, activas, isMobile }) {
  const card = { background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 3px rgba(22,33,62,.06)', border: '1px solid #eeedf5' }
  if (!gen || !(gen.meta > 0)) return null
  const barra = (venta, meta, metaFecha, proy, alto = 22) => {
    const pV = Math.min(100, venta / meta * 100), pF = Math.min(100, metaFecha / meta * 100), pP = Math.min(100, proy / meta * 100)
    const bien = venta >= metaFecha
    return (
      <div style={{ position: 'relative', height: alto, background: '#f0eff7', borderRadius: alto / 2, overflow: 'visible' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pP}%`, background: bien ? '#1E7A4418' : '#D92D2014', borderRadius: alto / 2 }} title={`Proyección: ${fmtK(proy)}`} />
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pV}%`, background: bien ? 'linear-gradient(90deg,#1E7A44,#34C759)' : 'linear-gradient(90deg,#B25E09,#FF9F0A)', borderRadius: alto / 2 }} />
        <div title={`Meta a la fecha: ${fmtK(metaFecha)}`} style={{ position: 'absolute', left: `calc(${pF}% - 1px)`, top: -5, bottom: -5, width: 3, background: '#16213E', borderRadius: 2 }} />
      </div>
    )
  }
  const nom = sid => activas.find(a => a.sucursal_id === sid)?.nombre || sid
  const ritmoAct = gen.dhRest != null && resumenes[0] ? gen.venta / Math.max(1, Math.max(...resumenes.map(r => r.dhTr || 0))) : 0
  return (
    <div style={{ ...card, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#16213E' }}>Ritmo del mes</div>
        <span style={{ fontSize: 12.5, color: '#6E6E73' }}>La marca oscura es dónde deberíamos ir hoy · la zona clara es la proyección de cierre</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6, minmax(0,1fr))', gap: 16, marginBottom: 14 }}>
        {[['Venta del mes', fmtK(gen.venta), `${gen.cumpMes}% de la meta`, C1],
          ['Meta a la fecha', fmtK(gen.metaFecha), `${gen.cumpFecha}% cumplido`, colorCump(gen.cumpFecha)],
          ['Proyección de cierre', fmtK(gen.proy), `${gen.cumpProy}% de la meta`, colorCump(gen.cumpProy)],
          ['Falta para la meta', gen.gap > 0 ? fmtK(gen.gap) : '✓ cumplida', `${gen.dhRest} días hábiles restantes`, gen.gap > 0 ? '#D92D20' : '#1E7A44'],
          ['Ritmo requerido / día', fmtK(gen.ritmoReq), `actual ${fmtK(ritmoAct)} / día`, gen.ritmoReq > ritmoAct ? '#D92D20' : '#1E7A44'],
          ['Meta del mes', fmtK(gen.meta), `${fN(gen.docs)} documentos`, '#16213E']].map(([l, v, s2, c2]) => (
          <div key={l}><div style={{ fontSize: 11, fontWeight: 800, color: '#6E6E73', textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: c2, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{v}</div>
            <div style={{ fontSize: 12, color: '#6E6E73' }}>{s2}</div></div>
        ))}
      </div>
      {barra(gen.venta, gen.meta, gen.metaFecha, gen.proy, 24)}
      {resumenes.length > 1 && (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {resumenes.filter(r => r.meta > 0).map(r => (
            <div key={r.sid} style={{ display: 'grid', gridTemplateColumns: isMobile ? '90px 1fr 70px' : '150px 1fr 110px 110px', gap: 12, alignItems: 'center' }}>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>{nom(r.sid)}</div>
              {barra(r.venta, r.meta, r.metaFecha, r.proy, 14)}
              <div style={{ fontSize: 13.5, fontWeight: 800, textAlign: 'right', color: colorCump(pct(r.venta, r.metaFecha)) }}>{pct(r.venta, r.meta)}%</div>
              {!isMobile && <div style={{ fontSize: 12.5, color: '#6E6E73', textAlign: 'right' }}>{fmtK(r.venta)} / {fmtK(r.meta)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TabTurnos({ sucursales, vendedores, sucSel, setSucSel, anio, setAnio, mes, setMes, cu, esGerente, isMobile }) {
  // Perfilamiento: jefe/coordinador editan SU tienda; el vendedor solo mira su parrilla.
  const perfilT = resolverPerfil(cu, vendedores, esGerente)
  const sucEff = perfilT.verTodo ? sucSel : (perfilT.sucursal || sucSel)
  const puedeEditar = perfilT.rol !== 'vendedor'
  const miBid = perfilT.vendedor?.bsale_user_id ?? null
  const [turnos, setTurnos] = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const semanas = useMemo(() => semanasDelMes(anio, mes), [anio, mes])
  const vends = vendedores.filter(v => v.sucursal_id === sucEff && v.activo !== false)

  const cargar = async () => {
    if (!sucEff) return
    setLoading(true)
    try {
      const { data } = await supabase.from('com_turnos').select('*')
        .eq('sucursal_id', sucEff).eq('anio', anio)
        .in('semana', semanas.map(s => s.w))
      setTurnos(data || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { cargar() }, [sucEff, anio, mes])

  const valorDe = (bid, w) => turnos.find(t => t.bsale_user_id === bid && t.semana === w)?.turno || ''

  const guardar = async (bid, w, turno) => {
    if (!puedeEditar) return
    setMsg('')
    try {
      if (!turno) {
        await supabase.from('com_turnos').delete()
          .eq('sucursal_id', sucEff).eq('bsale_user_id', bid).eq('anio', anio).eq('semana', w)
      } else {
        const { error } = await supabase.from('com_turnos').upsert({
          sucursal_id: sucEff, bsale_user_id: bid, anio, mes, semana: w,
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
        <select value={perfilT.verTodo ? sucSel : sucEff} onChange={e => setSucSel(e.target.value)} disabled={!perfilT.verTodo} style={{ ...selStyle, opacity: perfilT.verTodo ? 1 : 0.75 }}>
          {sucursales.filter(s => s.activa && (perfilT.verTodo || s.sucursal_id === sucEff)).map(s => <option key={s.sucursal_id} value={s.sucursal_id}>{s.nombre}</option>)}
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
        {puedeEditar
          ? <>Planificación <strong>referencial</strong> de turnos por semana ISO — la parrilla que ve cada vendedor de tu tienda. No se vincula con Asistencia (Workera).</>
          : <>Tu parrilla de turnos programada del mes — la define tu jefe de tienda. Tu fila aparece destacada.</>}
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
              <tr key={v.bsale_user_id} style={String(v.bsale_user_id) === String(miBid) ? { background: '#f6f5ff' } : undefined}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{String(v.bsale_user_id) === String(miBid) ? '⭐ ' : ''}{v.nombre}<div style={{ fontSize: 10.5, color: '#8b88a8' }}>{v.rol}</div></td>
                {semanas.map(s => {
                  const val = valorDe(v.bsale_user_id, s.w)
                  return (
                    <td key={s.w} style={{ textAlign: 'center' }}>
                      {puedeEditar ? (
                        <select value={val} onChange={e => guardar(v.bsale_user_id, s.w, e.target.value)}
                          style={{ padding: '5px 8px', border: '1px solid #e0def0', borderRadius: 7, fontSize: 12, fontWeight: 700, background: '#fff', color: TURNO_COLOR[val] || '#8b88a8' }}>
                          {TURNOS_OPC.map(t => <option key={t} value={t}>{t || '—'}</option>)}
                        </select>
                      ) : (
                        val
                          ? <span style={{ fontSize: 11.5, fontWeight: 800, color: TURNO_COLOR[val] || '#3a3a3c', background: (TURNO_COLOR[val] || '#8b88a8') + '18', borderRadius: 7, padding: '4px 10px', textTransform: 'capitalize' }}>{val}</span>
                          : <span style={{ color: '#c9c7dd' }}>—</span>
                      )}
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
function TabBitacora({ sucursales, vendedores, metas, feriados, cu, esGerente, delegacion, sucSel, setSucSel, anio, setAnio, mes, setMes, isMobile }) {
  const perfilB = resolverPerfil(cu, vendedores, esGerente)
  const esDelegado = perfilB.rol === 'vendedor' && !!delegacion
  const sucEff = perfilB.verTodo ? sucSel : (esDelegado ? delegacion.sucursal_id : (perfilB.sucursal || sucSel))
  const permDeleg = String(delegacion?.permiso || 'cierre').toLowerCase()
  const puedeAperturar = perfilB.rol !== 'vendedor' || (esDelegado && (permDeleg === 'apertura' || permDeleg === 'ambos'))
  const puedeCerrar = perfilB.rol !== 'vendedor' || (esDelegado && (permDeleg === 'cierre' || permDeleg === 'ambos'))
  const puedeDelegar = perfilB.rol === 'jefe' || perfilB.verTodo
  const [delegPanel, setDelegPanel] = useState(false)
  const [delegList, setDelegList] = useState([])
  const [delegNuevo, setDelegNuevo] = useState('')
  const [delegPerm, setDelegPerm] = useState('ambos')
  const [usuariosApp, setUsuariosApp] = useState([])
  const cargarDelegs = async () => {
    const { data } = await supabase.from('com_delegaciones').select('*').eq('sucursal_id', sucEff).eq('activo', true).order('id')
    setDelegList(data || [])
    // usuarios reales con acceso a Comercial en esta sucursal (evita tipear mal el nombre)
    const { data: ua } = await supabase.from('usuario_acceso')
      .select('usuario_id, usuarios(id, nombre, correo, activo)')
      .eq('app_codigo', 'comercial').eq('sucursal_id', sucEff).eq('activo', true)
    const lst = (ua || []).map(x => x.usuarios).filter(u => u && u.activo !== false)
    lst.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
    setUsuariosApp(lst)
  }
  useEffect(() => { if (delegPanel) cargarDelegs() /* eslint-disable-next-line */ }, [delegPanel, sucEff])
  const agregarDeleg = async () => {
    const u = usuariosApp.find(x => x.id === delegNuevo)
    if (!u) return
    await supabase.from('com_delegaciones').insert({
      sucursal_id: sucEff, nombre: u.nombre, permiso: delegPerm,
      otorgado_por: cu?.nombre || cu?.correo || null,
    })
    setDelegNuevo(''); cargarDelegs()
  }
  const quitarDeleg = async (id) => {
    await supabase.from('com_delegaciones').update({ activo: false }).eq('id', id)
    cargarDelegs()
  }
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
              {puedeDelegar && (
              <button onClick={() => setDelegPanel(v => !v)}
                style={{ background: '#fff', color: C2, border: '1px solid #e0def0', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                ⚙ Delegados
              </button>)}
              {puedeAperturar && (
              <button onClick={() => setAbrirAp(true)}
                style={{ background: hoyAp ? '#f0eff7' : `linear-gradient(135deg,${C1},${C2})`, color: hoyAp ? C2 : '#fff', border: 'none', borderRadius: 9, padding: '8px 15px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                🌅 {hoyAp ? 'Apertura ✓' : 'Apertura de hoy'}
              </button>)}
              {puedeCerrar && (
              <button onClick={() => setAbrirCi(true)}
                style={{ background: hoyCi ? '#f0eff7' : `linear-gradient(135deg,${C1},${C2})`, color: hoyCi ? C2 : '#fff', border: 'none', borderRadius: 9, padding: '8px 15px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
                🌙 {hoyCi ? 'Cierre ✓' : 'Cierre de hoy'}
              </button>)}
            </div>
          )
        })()}
      </div>

      {delegPanel && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', marginBottom: 8 }}>Delegados de cierre · {sucursales.find(s => s.sucursal_id === sucEff)?.nombre}</div>
          {delegList.length === 0 && <div style={{ fontSize: 12, color: '#8b88a8', marginBottom: 8 }}>Nadie tiene el cierre delegado en esta sucursal.</div>}
          {delegList.map(d => {
            const pl = String(d.permiso || 'cierre').toLowerCase()
            const et = pl === 'ambos' ? '🌅🌙 apertura y cierre' : pl === 'apertura' ? '🌅 solo apertura' : '🌙 solo cierre'
            const noCalza = String(d.nombre || '').includes('@') === false && !usuariosApp.some(u => (u.nombre || '').toLowerCase().trim() === String(d.nombre || '').toLowerCase().trim())
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{d.nombre}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: C2, background: '#f0eff7', borderRadius: 6, padding: '2px 7px' }}>{et}</span>
                {noCalza && <span title="Este nombre no coincide con ningún usuario de esta sucursal: la delegación no se aplicará." style={{ fontSize: 11, fontWeight: 700, color: '#B25000' }}>⚠ no calza con un usuario</span>}
                <span style={{ fontSize: 10.5, color: '#8b88a8' }}>{d.otorgado_por ? `otorgado por ${d.otorgado_por}` : ''}</span>
                <button onClick={() => quitarDeleg(d.id)} style={{ marginLeft: 'auto', background: '#FF3B3012', color: '#FF3B30', border: 'none', borderRadius: 7, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Quitar</button>
              </div>
            )
          })}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <select className="com-inp" style={{ flex: 1, minWidth: 220, maxWidth: 320 }} value={delegNuevo} onChange={e => setDelegNuevo(e.target.value)}>
              <option value="">Elige a la persona…</option>
              {usuariosApp.map(u => <option key={u.id} value={u.id}>{u.nombre} — {u.correo}</option>)}
            </select>
            <select className="com-inp" style={{ width: 190 }} value={delegPerm} onChange={e => setDelegPerm(e.target.value)}>
              <option value="ambos">Apertura y cierre</option>
              <option value="cierre">Solo cierre</option>
              <option value="apertura">Solo apertura</option>
            </select>
            <button onClick={agregarDeleg} disabled={!delegNuevo} style={{ background: delegNuevo ? `linear-gradient(135deg,${C1},${C2})` : '#c9c7dd', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12.5, fontWeight: 700, cursor: delegNuevo ? 'pointer' : 'default' }}>+ Delegar</button>
          </div>
          <div style={{ fontSize: 10.5, color: '#a6a3bd', marginTop: 8 }}>La persona delegada verá la pestaña Bitácora anclada a esta sucursal, solo con los botones que le autorices. La lista muestra únicamente usuarios con acceso a Comercial en esta sucursal.</div>
        </div>
      )}
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
  const [vambeStats, setVambeStats] = useState({ asig: {}, pend: {} })
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
        const desdeMsj = new Date(Date.now() - 10 * 86400000).toISOString()
        const [ci, vdq, vc, mg] = await Promise.all([
          supabase.from('com_cierres').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha'),
          supabase.from('com_ventas_dia').select('fecha,sucursal_id,venta,docs,ventas_vendedor').gte('fecha', desde).lte('fecha', hasta),
          supabase.from('vambe_contactos').select('contact_id,agent_principal'),
          supabase.from('vambe_mensajes').select('ai_contact_id,direction,user_id,assistant_id,created_at').gte('created_at', desdeMsj).order('created_at', { ascending: true }).limit(20000),
        ])
        if (cancel) return
        // snapshot BSALE manda sobre el cierre (venta final del día, todos los vendedores)
        const mapa = {}
        ;(ci.data || []).forEach(r => { mapa[`${r.fecha}|${r.sucursal_id}`] = r })
        ;(vdq.data || []).forEach(x => {
          const k = `${x.fecha}|${x.sucursal_id}`
          const prev = mapa[k]
          const arr = Array.isArray(x.ventas_vendedor) ? x.ventas_vendedor : []
          const vv = {}
          arr.forEach(v => {
            const sid = String(v.seller_id)
            vv[sid] = { name: v.seller_name, compromiso: Number(prev?.ventas_vendedor?.[sid]?.compromiso || 0), venta: Number(v.total || 0), docs: Number(v.count || 0) }
          })
          if (prev?.ventas_vendedor) Object.entries(prev.ventas_vendedor).forEach(([sid, pv]) => { if (!vv[sid]) vv[sid] = { ...pv, venta: 0, docs: 0 } })
          mapa[k] = { ...(prev || { fecha: x.fecha, sucursal_id: x.sucursal_id }), ventas_vendedor: Object.keys(vv).length ? vv : (prev?.ventas_vendedor || {}) }
        })
        setCierres(Object.values(mapa).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')))
        // Vambe: contactos asignados + chats sin responder por agente
        const agenteDe = {}
        ;(vc.data || []).forEach(x => { if (x.contact_id && x.agent_principal) agenteDe[x.contact_id] = x.agent_principal })
        const asig = {}
        Object.values(agenteDe).forEach(a => { asig[a] = (asig[a] || 0) + 1 })
        const em = m => m.direction === 'inbound' ? 'cliente' : m.assistant_id ? 'bot' : m.user_id === VAMBE_WORKSPACE ? 'auto' : 'humano'
        const porC = {}
        ;(mg.data || []).forEach(m => { (porC[m.ai_contact_id] = porC[m.ai_contact_id] || []).push(m) })
        const pend = {}
        Object.entries(porC).forEach(([cid, list]) => {
          const ag = agenteDe[cid]
          if (!ag) return
          let lastHum = 0, espera = false
          list.forEach(m => { const e = em(m); const t = new Date(m.created_at).getTime(); if (e === 'humano' || e === 'bot') lastHum = Math.max(lastHum, t) })
          list.forEach(m => { if (em(m) === 'cliente' && new Date(m.created_at).getTime() > lastHum) espera = true })
          if (espera) pend[ag] = (pend[ag] || 0) + 1
        })
        setVambeStats({ asig, pend })
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
    // Vambe por nombre (agente Vambe ↔ vendedor)
    const normV = t => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const buscarAgente = (nombre, mapa) => {
      const nn = normV(nombre)
      let tot = 0
      Object.entries(mapa).forEach(([ag, val]) => { const an = normV(ag); if (an === nn || an.includes(nn) || nn.includes(an)) tot += val })
      return tot
    }
    arr.forEach(r => { r.vambe_asig = buscarAgente(r.name, vambeStats.asig); r.vambe_pend = buscarAgente(r.name, vambeStats.pend) })
    // descartar vendedores sin ninguna actividad en el período
    arr = arr.filter(r => r.venta > 0 || r.docs > 0 || r.cot_gest > 0 || r.vambe_asig > 0)
    const sucVista = perfilV.verTodo ? fSuc : perfilV.sucursal
    if (sucVista) arr = arr.filter(r => r.sucursal_id === sucVista)
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => (Number(a[sortBy] || 0) - Number(b[sortBy] || 0)) * dir)
    return arr
  }, [cierres, seg, vendedores, fSuc, sortBy, sortDir, ym, vambeStats])

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
              {th('vambe_asig', '💬 Chats')}
              {th('vambe_pend', 'Sin resp.')}
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={13} style={{ textAlign: 'center', padding: 30, color: '#8b88a8' }}>Sin actividad de vendedores en el período.</td></tr>}
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
                <td style={{ textAlign: 'right', color: '#5a5a6e' }}>{r.vambe_asig || '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: r.vambe_pend > 0 ? 800 : 400, color: r.vambe_pend > 0 ? '#FF3B30' : '#8b88a8' }}>{r.vambe_pend || '—'}</td>
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

// Minutos hábiles entre dos timestamps: el reloj solo corre en horario Outlet
// (L-V 09:30-18:00, Sáb 09:30-13:30). Un mensaje de las 19:00 respondido al
// día siguiente a las 09:35 cuenta 5 min, no 875.
function minutosHabiles(t0, t1) {
  if (t1 <= t0) return 0
  let min = 0
  const d = new Date(t0)
  d.setSeconds(0, 0)
  const fin = new Date(t1)
  let guard = 0
  while (d < fin && guard < 60 * 24 * 30) {
    if (enHorarioOutlet(d)) min++
    d.setMinutes(d.getMinutes() + 1)
    guard++
  }
  return min
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
  const [filasCola, setFilasCola] = useState([])
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
  // bordes del rango en hora Chile: un 'Hoy' chileno, no un 'Hoy' UTC
  const desde = `${d1}T00:00:00-04:00`
  const hasta = `${d2}T23:59:59-04:00`

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
      // dataset de estado actual (últimos 30 días) para la cola sin responder:
      // la cola es una foto de HOY y no debe depender del rango elegido
      const desde30 = new Date(Date.now() - 30 * 86400000).toISOString()
      let cAll = [], cFrom = 0
      while (true) {
        const { data: cd, error: ce } = await supabase.from('vambe_mensajes')
          .select('ai_contact_id,direction,user_id,assistant_id,created_at,body_preview')
          .gte('created_at', desde30)
          .order('created_at', { ascending: true })
          .range(cFrom, cFrom + 999)
        if (ce) break
        cAll = cAll.concat(cd || [])
        if (!cd || cd.length < 1000) break
        cFrom += 1000
        if (cFrom > 40000) break
      }
      setFilasCola(cAll)
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
      // Petición "simple" (sin headers custom, Content-Type text/plain): el
      // navegador NO hace preflight OPTIONS, así que es inmune al bloqueo
      // CORS/JWT del gateway que rompía functions.invoke.
      const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vambe-mensajes-sync`
      for (let i = 0; i < 40; i++) {
        let data = null
        for (let intento = 0; intento < 2; intento++) {
          try {
            const resp = await fetch(FN_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'sync', offset, batch: 20 }) })
            if (resp.status === 401) throw new Error("La función respondió 401: 'Verify JWT' sigue ACTIVO en vambe-mensajes-sync. Desactívalo y vuelve a hacer DEPLOY (el cambio del toggle solo se aplica al redesplegar).")
            if (!resp.ok) throw new Error(`vambe-mensajes-sync respondió HTTP ${resp.status} — revisa los Logs de la función en Supabase.`)
            data = await resp.json()
            break
          } catch (e) {
            if (intento === 1) throw e
            await new Promise(r => setTimeout(r, 1500))
          }
        }
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
  const porContactoCola = useMemo(() => {
    const m = {}
    filasCola.forEach(f => { (m[f.ai_contact_id] = m[f.ai_contact_id] || []).push(f) })
    return m
  }, [filasCola])

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
            if (min >= 0 && min < 60 * 24 * 21) eps.push({ min, minHab: minutosHabiles(pendiente, t), uid: m.user_id, enHor: enHorarioOutlet(new Date(pendiente)) })
            pendiente = null
          }
        }
      })
    })
    return eps
  }, [porContacto])
  const medGlobal = medianaDe(episodios.map(e => e.minHab))
  const medHorario = medianaDe(episodios.filter(e => e.enHor).map(e => e.min))

  // ── MOTOR: cola sin responder (último no-auto es del cliente) ──
  const cola = useMemo(() => {
    const out = []
    Object.entries(porContactoCola).forEach(([cid, list]) => {
      const rs = String(infoContacto[cid]?.resolution_status || '').toLowerCase()
      if (rs.includes('resol') || rs.includes('clos') || rs.includes('cerr')) return  // ticket ya resuelto: no es cola
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
  }, [porContactoCola, infoContacto])
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
        <span style={{ fontSize: 11.5, color: '#8b88a8', marginLeft: 'auto' }}>
          {fN(filas.length)} mensajes en el rango
          {filasCola.length > 0 && (() => { const ult = filasCola[filasCola.length - 1]?.created_at; return ult ? <> · <b>último msj sincronizado: {new Date(ult).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</b></> : null })()}
          {' '}· horario L-V 09:30–18:00 · Sáb 09:30–13:30
        </span>
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
              ['1ª resp. (min hábiles)', fmtMin(medGlobal), medGlobal !== null && medGlobal > 30 ? '#FF3B30' : '#34C759'],
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
/* ═══ INFORME DIARIO DE CUMPLIMIENTO ═══ */
function InformeDiario({ sucursales, feriados, vendedores, cu, esGerente, isMobile }) {
  const selStyle = { padding: '7px 10px', border: '1px solid #e0def0', borderRadius: 8, fontSize: 13, background: '#fff' }
  const card = { background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,.05)' }
  const perfilR = resolverPerfil(cu, vendedores, esGerente)
  const hoyIso = new Date().toLocaleDateString('en-CA')
  const [fecha, setFecha] = useState(hoyIso)
  const [snapsMes, setSnapsMes] = useState([])
  const [cierresMes, setCierresMes] = useState([])
  const [metasMes, setMetasMes] = useState([])
  const [loading, setLoading] = useState(false)
  const [refrescando, setRefrescando] = useState(false)
  const [msg, setMsg] = useState('')
  const anioF = Number(fecha.slice(0, 4)), mesF = Number(fecha.slice(5, 7))
  const mesIniF = fecha.slice(0, 8) + '01'
  const activasR = sucursales.filter(s => s.bsale_office_id && s.activa && (perfilR.verTodo || s.sucursal_id === perfilR.sucursal))

  const cargar = async () => {
    setLoading(true)
    try {
      const [vd, ci, mt] = await Promise.all([
        supabase.from('com_ventas_dia').select('fecha,sucursal_id,venta,docs,ventas_vendedor').gte('fecha', mesIniF).lte('fecha', fecha),
        supabase.from('com_cierres').select('fecha,sucursal_id,venta_dia,transacciones').gte('fecha', mesIniF).lte('fecha', fecha),
        supabase.from('com_metas').select('*').eq('anio', anioF).eq('mes', mesF),
      ])
      setSnapsMes(vd.data || []); setCierresMes(ci.data || []); setMetasMes(mt.data || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [fecha])

  const actualizarDia = async () => {
    if (refrescando) return
    setRefrescando(true)
    try {
      for (const s of activasR) {
        try {
          const r = await callBsale('ventas_dia', { office_id: s.bsale_office_id, fecha })
          await supabase.from('com_ventas_dia').upsert({
            fecha, sucursal_id: s.sucursal_id, venta: r.total || 0, docs: r.docs || 0,
            ventas_vendedor: r.ventas || [], actualizado_at: new Date().toISOString(),
          }, { onConflict: 'fecha,sucursal_id' })
        } catch (e) { /* seguir con la siguiente */ }
      }
      await cargar()
      setMsg('Venta del día actualizada desde BSALE'); setTimeout(() => setMsg(''), 2500)
    } finally { setRefrescando(false) }
  }

  // merge por fecha|sucursal: snapshot manda, cierre respalda
  const porDia = useMemo(() => {
    const m = {}
    cierresMes.forEach(c2 => { m[`${c2.fecha}|${c2.sucursal_id}`] = { venta: Number(c2.venta_dia || 0), docs: Number(c2.transacciones || 0), vv: null } })
    snapsMes.forEach(x => { m[`${x.fecha}|${x.sucursal_id}`] = { venta: Number(x.venta || 0), docs: Number(x.docs || 0), vv: Array.isArray(x.ventas_vendedor) ? x.ventas_vendedor : null } })
    return m
  }, [snapsMes, cierresMes])

  const filas = useMemo(() => activasR.map(s => {
    const sid = s.sucursal_id, key = shortKey(sid)
    const metaMes = Number(metasMes.find(m => m.sucursal_id === sid)?.meta_clp || 0)
    const dhMes = diasHabiles(anioF, mesF, key, feriados)
    let dhTrans = 0
    { const d = new Date(anioF, mesF - 1, 1); const lim = new Date(fecha + 'T12:00:00')
      while (d.getMonth() === mesF - 1 && d <= lim) {
        const dow = d.getDay()
        if (dow >= 1 && dow <= 6) {
          const iso = d.toLocaleDateString('en-CA')
          const fer = feriados.find(f => f.fecha === iso)
          if (!fer || fer['trabaja_' + key]) dhTrans++
        }
        d.setDate(d.getDate() + 1)
      } }
    const dia = porDia[`${fecha}|${sid}`] || { venta: 0, docs: 0, vv: null }
    const metaDia = dhMes > 0 ? metaMes / dhMes : 0
    let acum = 0, docsAcum = 0, sobreMeta = 0, diasConDato = 0
    Object.entries(porDia).forEach(([k, v]) => {
      const sep = k.lastIndexOf('|'); const f2 = k.slice(0, sep), s2 = k.slice(sep + 1)
      if (s2 === sid && f2 <= fecha) {
        acum += v.venta; docsAcum += v.docs
        if (v.venta > 0 || v.docs > 0) diasConDato++
        if (metaDia > 0 && v.venta >= metaDia) sobreMeta++
      }
    })
    const metaFecha = dhMes > 0 ? metaMes * dhTrans / dhMes : 0
    const proy = dhTrans > 0 ? acum / dhTrans * dhMes : 0
    const top = (dia.vv || []).slice().sort((a, b) => Number(b.total || 0) - Number(a.total || 0)).filter(v => Number(v.total || 0) > 0)
    return { s, sid, metaMes, dhMes, dhTrans, dia, metaDia, acum, docsAcum, sobreMeta, diasConDato, metaFecha, proy, top }
  }), [activasR, metasMes, porDia, fecha, feriados, anioF, mesF])

  const tot = filas.length > 1 ? {
    venta: filas.reduce((a, f) => a + f.dia.venta, 0), metaDia: filas.reduce((a, f) => a + f.metaDia, 0),
    acum: filas.reduce((a, f) => a + f.acum, 0), metaFecha: filas.reduce((a, f) => a + f.metaFecha, 0),
    metaMes: filas.reduce((a, f) => a + f.metaMes, 0), proy: filas.reduce((a, f) => a + f.proy, 0),
  } : null

  const pctS = (v, m) => m > 0 ? pct(v, m) : null
  const pctTxt = (v, m) => { const x = pctS(v, m); return x === null ? '—' : x + '%' }

  const textoInforme = () => {
    const L = []
    L.push(`📊 INFORME DIARIO COMERCIAL · ${fmtFecha(fecha)}`)
    L.push('Outlet de Puertas SpA')
    L.push('')
    filas.forEach(f => {
      L.push(`🏬 ${f.s.nombre.toUpperCase()}`)
      L.push(`· Venta del día: ${fmt(f.dia.venta)} (meta ${fmtK(f.metaDia)} · ${pctTxt(f.dia.venta, f.metaDia)})`)
      L.push(`· Acumulado mes: ${fmt(f.acum)} de ${fmtK(f.metaFecha)} a la fecha (${pctTxt(f.acum, f.metaFecha)})`)
      L.push(`· Meta mes: ${fmtK(f.metaMes)} · proyección de cierre ${fmtK(f.proy)} (${pctTxt(f.proy, f.metaMes)})`)
      L.push(`· Días sobre meta: ${f.sobreMeta}/${f.dhTrans} · día hábil ${f.dhTrans}/${f.dhMes}`)
      if (f.top.length) L.push(`· Top del día: ${f.top.slice(0, 3).map((v, i2) => `${i2 + 1}) ${v.seller_name} ${fmtK(Number(v.total || 0))}`).join(' · ')}`)
      L.push('')
    })
    if (tot) {
      L.push('Σ TOTAL GENERAL')
      L.push(`· Venta del día: ${fmt(tot.venta)} (meta ${fmtK(tot.metaDia)} · ${pctTxt(tot.venta, tot.metaDia)})`)
      L.push(`· Acumulado mes: ${fmt(tot.acum)} de ${fmtK(tot.metaFecha)} a la fecha (${pctTxt(tot.acum, tot.metaFecha)})`)
      L.push(`· Meta mes: ${fmtK(tot.metaMes)} · proyección ${fmtK(tot.proy)} (${pctTxt(tot.proy, tot.metaMes)})`)
      L.push('')
    }
    L.push(`Generado desde el ERP Comercial · ${new Date().toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`)
    return L.join('\n')
  }
  const copiar = () => { navigator.clipboard.writeText(textoInforme()); setMsg('Informe copiado — pégalo en WhatsApp o correo'); setTimeout(() => setMsg(''), 2500) }

  const descargarPdf = () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const W = doc.internal.pageSize.getWidth()
    doc.setFillColor(22, 33, 62); doc.rect(0, 0, W, 26, 'F')
    doc.setTextColor(255, 255, 255); doc.setFontSize(14); doc.setFont(undefined, 'bold')
    doc.text('INFORME DIARIO DE CUMPLIMIENTO COMERCIAL', 12, 11)
    doc.setFontSize(9.5); doc.setFont(undefined, 'normal'); doc.setTextColor(201, 199, 221)
    doc.text(`Outlet de Puertas SpA · ${fmtFecha(fecha)} · generado ${new Date().toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} por ${cu?.nombre || ''}`, 12, 18)
    const body = filas.map(f => [
      f.s.nombre, fmt(f.dia.venta), fmtK(f.metaDia), pctTxt(f.dia.venta, f.metaDia),
      fmt(f.acum), fmtK(f.metaFecha), pctTxt(f.acum, f.metaFecha),
      fmtK(f.metaMes), `${fmtK(f.proy)} (${pctTxt(f.proy, f.metaMes)})`, `${f.sobreMeta}/${f.dhTrans}`,
    ])
    if (tot) body.push(['TOTAL GENERAL', fmt(tot.venta), fmtK(tot.metaDia), pctTxt(tot.venta, tot.metaDia),
      fmt(tot.acum), fmtK(tot.metaFecha), pctTxt(tot.acum, tot.metaFecha),
      fmtK(tot.metaMes), `${fmtK(tot.proy)} (${pctTxt(tot.proy, tot.metaMes)})`, ''])
    autoTable(doc, {
      startY: 32,
      head: [['Sucursal', 'Venta día', 'Meta día', 'Cumpl.', 'Acum. mes', 'Meta a la fecha', 'Avance', 'Meta mes', 'Proyección cierre', 'Días s/meta']],
      body,
      styles: { fontSize: 7.4, cellPadding: 1.8 },
      headStyles: { fillColor: [22, 33, 62], fontSize: 7.2 },
      columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'center' } },
      didParseCell: d => { if (tot && d.section === 'body' && d.row.index === body.length - 1) d.cell.styles.fontStyle = 'bold' },
    })
    const detalle = []
    filas.forEach(f => f.top.forEach(v => detalle.push([
      f.s.nombre, v.seller_name, fmt(Number(v.total || 0)), String(v.count || 0),
      Number(v.count || 0) > 0 ? fmtK(Number(v.total || 0) / Number(v.count)) : '—',
    ])))
    if (detalle.length) {
      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 7,
        head: [['Sucursal', 'Vendedor — venta del día', 'Venta', 'Docs', 'Ticket']],
        body: detalle,
        styles: { fontSize: 7.4, cellPadding: 1.6 },
        headStyles: { fillColor: [88, 86, 214], fontSize: 7.2 },
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'center' }, 4: { halign: 'right' } },
      })
    }
    const pages = doc.internal.getNumberOfPages()
    for (let p2 = 1; p2 <= pages; p2++) {
      doc.setPage(p2); doc.setFontSize(7); doc.setTextColor(139, 136, 168)
      doc.text('Documento generado automáticamente por el ERP Comercial · Outlet de Puertas SpA', 12, doc.internal.pageSize.getHeight() - 7)
      doc.text(`${p2}/${pages}`, W - 16, doc.internal.pageSize.getHeight() - 7)
    }
    doc.save(`Informe_Diario_Comercial_${fecha}.pdf`)
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: '#8b88a8', fontWeight: 700 }}>DÍA</span>
        <input type="date" value={fecha} max={hoyIso} onChange={e => setFecha(e.target.value)} style={{ ...selStyle, width: 145 }} />
        <button onClick={actualizarDia} disabled={refrescando}
          style={{ background: `linear-gradient(135deg,${C1},${C2})`, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: refrescando ? 'default' : 'pointer' }}>
          {refrescando ? 'Consultando BSALE…' : '⟳ Actualizar día (BSALE)'}
        </button>
        <button onClick={copiar} style={{ background: '#f0eff7', color: C2, border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>📋 Copiar para enviar</button>
        <button onClick={descargarPdf} style={{ background: '#fff', color: C2, border: '1px solid #e0def0', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>📄 Descargar PDF</button>
        {msg && <span style={{ fontSize: 12, fontWeight: 700, color: '#248A3D' }}>{msg}</span>}
        {loading && <span style={{ fontSize: 12, color: '#8b88a8' }}>Cargando…</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(340px,1fr))', gap: 12, marginBottom: 14 }}>
        {filas.map(f => {
          const pDia = pctS(f.dia.venta, f.metaDia), pAc = pctS(f.acum, f.metaFecha), pPr = pctS(f.proy, f.metaMes)
          return (
            <div key={f.sid} style={{ ...card, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800 }}>{f.s.nombre}</div>
                <div style={{ fontSize: 10.5, color: '#8b88a8', marginLeft: 'auto' }}>día hábil {f.dhTrans}/{f.dhMes}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>Venta del día</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C1 }}>{fmt(f.dia.venta)}</div>
                  <div style={{ fontSize: 10.5, color: '#8b88a8' }}>meta {fmtK(f.metaDia)} · <b style={{ color: pDia === null ? '#c9c7dd' : colorCump(pDia) }}>{pctTxt(f.dia.venta, f.metaDia)}</b> · {fN(f.dia.docs)} docs</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>Acumulado mes</div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{fmtK(f.acum)}</div>
                  <div style={{ fontSize: 10.5, color: '#8b88a8' }}>a la fecha {fmtK(f.metaFecha)} · <b style={{ color: pAc === null ? '#c9c7dd' : colorCump(pAc) }}>{pctTxt(f.acum, f.metaFecha)}</b></div>
                </div>
                <div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>Proyección cierre</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: pPr === null ? '#c9c7dd' : colorCump(pPr) }}>{fmtK(f.proy)} <span style={{ fontSize: 11 }}>({pctTxt(f.proy, f.metaMes)})</span></div>
                  <div style={{ fontSize: 10.5, color: '#8b88a8' }}>meta mes {fmtK(f.metaMes)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700 }}>Días sobre meta</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: f.sobreMeta >= f.dhTrans * 0.5 ? '#248A3D' : '#B25000' }}>{f.sobreMeta}/{f.dhTrans}</div>
                  <div style={{ fontSize: 10.5, color: '#8b88a8' }}>{f.diasConDato} días con datos</div>
                </div>
              </div>
              {f.top.length > 0 && (
                <div style={{ marginTop: 10, borderTop: '1px solid #f0eff7', paddingTop: 8 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#8b88a8', fontWeight: 700, marginBottom: 4 }}>Top del día</div>
                  {f.top.slice(0, 3).map((v, i2) => (
                    <div key={i2} style={{ display: 'flex', fontSize: 12, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600 }}>{i2 + 1}. {v.seller_name}</span>
                      <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(Number(v.total || 0))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {tot && (
        <div style={{ ...card, padding: 14, borderLeft: `4px solid ${C1}`, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: '#8b88a8', marginBottom: 8 }}>Σ Total general · {fmtFecha(fecha)}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
            <div><div style={{ fontSize: 10, color: '#8b88a8', fontWeight: 700 }}>VENTA DÍA</div><div style={{ fontSize: 18, fontWeight: 800, color: C1 }}>{fmt(tot.venta)}</div><div style={{ fontSize: 10.5, color: '#8b88a8' }}>meta {fmtK(tot.metaDia)} · {pctTxt(tot.venta, tot.metaDia)}</div></div>
            <div><div style={{ fontSize: 10, color: '#8b88a8', fontWeight: 700 }}>ACUMULADO MES</div><div style={{ fontSize: 18, fontWeight: 800 }}>{fmtK(tot.acum)}</div><div style={{ fontSize: 10.5, color: '#8b88a8' }}>a la fecha {fmtK(tot.metaFecha)} · {pctTxt(tot.acum, tot.metaFecha)}</div></div>
            <div><div style={{ fontSize: 10, color: '#8b88a8', fontWeight: 700 }}>PROYECCIÓN</div><div style={{ fontSize: 18, fontWeight: 800, color: (pctS(tot.proy, tot.metaMes) ?? 0) >= 100 ? '#248A3D' : '#B25000' }}>{fmtK(tot.proy)}</div><div style={{ fontSize: 10.5, color: '#8b88a8' }}>meta mes {fmtK(tot.metaMes)} · {pctTxt(tot.proy, tot.metaMes)}</div></div>
          </div>
        </div>
      )}
      <div style={{ fontSize: 10.5, color: '#a6a3bd' }}>Fuente: snapshots BSALE de venta final por día (com_ventas_dia), con respaldo de cierres de Bitácora. "Actualizar día" trae la cifra en línea desde BSALE para la fecha elegida.</div>
    </div>
  )
}

function TabReportes({ sucursales, metas, feriados, vendedores, cu, esGerente, anio, setAnio, mes, setMes, isMobile }) {
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
  const botonesTipo = [['diario', '📄 Diario'], ['semanal', '📅 Semanal'], ['mensual', '🗓 Mensual']]
  if (tipo === 'diario') return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'inline-flex', background: '#eceaf6', borderRadius: 10, padding: 3 }}>
          {botonesTipo.map(([k, l]) => (
            <button key={k} onClick={() => setTipo(k)}
              style={{ background: tipo === k ? '#fff' : 'transparent', color: tipo === k ? C2 : '#8b88a8', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>{l}</button>
          ))}
        </div>
      </div>
      <InformeDiario {...{ sucursales, feriados, vendedores, cu, esGerente, isMobile }} />
    </div>
  )
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'inline-flex', background: '#eceaf6', borderRadius: 10, padding: 3 }}>
          {botonesTipo.map(([k, l]) => (
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
function TabMiDia({ sucursales, vendedores, metas, seg, setSeg, cu, esGerente, isMobile, onVerRadar, onVerVambe }) {
  const [chatsLive, setChatsLive] = useState(0)
  const perfilMi = resolverPerfil(cu, vendedores, esGerente)
  const normN = t => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const propio = useMemo(() =>
    vendedores.find(v => v.usuario_id && v.usuario_id === cu?.id) ||
    vendedores.find(v => normN(v.nombre) === normN(cu?.nombre)) || null,
  [vendedores, cu])
  const [vendSel, setVendSel] = useState(null)
  useEffect(() => {
    if (vendSel) return
    if (perfilMi.rol === 'jefe' || perfilMi.rol === 'coordinador') { setVendSel('__tienda__'); return }
    // Un vendedor sin ficha en com_vendedores NO adopta la identidad de otro:
    // antes caía al primero de la lista y veía sus datos (fuga de información).
    if (propio) { setVendSel(propio.bsale_user_id); return }
    if (perfilMi.rol === 'vendedor') return   // sin ficha → sin selección
    setVendSel(vendedores.filter(v => v.activo !== false)[0]?.bsale_user_id)
  }, [propio, vendedores, perfilMi.rol])
  const vend = vendedores.find(v => String(v.bsale_user_id) === String(vendSel))
  const bloqueado = perfilMi.rol === 'vendedor'   // solo gestión (gerente/jefe) puede ver a otros
  const sinFichaMi = perfilMi.rol === 'vendedor' && !propio
  const esJefe = perfilMi.rol === 'jefe' || perfilMi.rol === 'coordinador'
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
        supabase.from('com_cierres').select('ventas_vendedor,venta_dia,fecha').eq('sucursal_id', sucId).gte('fecha', mesIni).lte('fecha', hoyIso),
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
        const { data: vdm } = await supabase.from('com_ventas_dia').select('fecha,venta,docs').eq('sucursal_id', sucId).gte('fecha', mesIni).lte('fecha', hoyIso)
        const byF = {}
        ;(cm.data || []).forEach(cc => { byF[cc.fecha] = { v: Number(cc.venta_dia || 0), d: 0 } })
        ;(vdm || []).forEach(x => { byF[x.fecha] = { v: Number(x.venta || 0), d: Number(x.docs || 0) } })
        setVentaMes({ venta: Object.values(byF).reduce((a, b) => a + b.v, 0), docs: Object.values(byF).reduce((a, b) => a + b.d, 0) })
      } else {
        // por día: manda el snapshot BSALE (venta final del día por vendedor);
        // el cierre (congelado a la hora del cierre) es solo respaldo
        const sid = String(vend.bsale_user_id)
        const { data: vdm } = await supabase.from('com_ventas_dia').select('fecha,ventas_vendedor').eq('sucursal_id', sucId).gte('fecha', mesIni).lte('fecha', hoyIso)
        const byF = {}
        ;(cm.data || []).forEach(cc => { const me = (cc.ventas_vendedor || {})[sid]; if (me) byF[cc.fecha] = { v: Number(me.venta || 0), d: Number(me.docs || 0) } })
        ;(vdm || []).forEach(x => {
          const arr = Array.isArray(x.ventas_vendedor) ? x.ventas_vendedor : []
          if (!arr.length) return
          const me = arr.find(v => String(v.seller_id) === sid)
          byF[x.fecha] = me ? { v: Number(me.total || 0), d: Number(me.count || 0) } : { v: 0, d: 0 }
        })
        setVentaMes({ venta: Object.values(byF).reduce((a, b) => a + b.v, 0), docs: Object.values(byF).reduce((a, b) => a + b.d, 0) })
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
  const pendTotal = sinContacto.length + agendaHoy.length + chatsLive

  if (!vend && !modoTienda) return <div style={{ padding: 20, color: '#8b88a8', fontSize: 13 }}>No hay vendedores configurados.</div>
  return (
    <div>
      {sinFichaMi && (
        <div style={{ background: '#FFF4E5', border: '1px solid #FFD9A8', borderLeft: '4px solid #FF9500', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#B25000', marginBottom: 3 }}>Tu perfil de vendedor aún no está configurado</div>
          <div style={{ fontSize: 12, color: '#8a6a3a' }}>Tu usuario todavía no está vinculado a tu ficha de vendedor de BSALE, así que no se pueden mostrar tus ventas ni tus cotizaciones. Avísale a tu jefe de tienda para que lo active.</div>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        {bloqueado ? (
          <div style={{ fontSize: 15, fontWeight: 800 }}>☀️ Hola, {((vend?.nombre || cu?.nombre || '').split(' ')[0])} — {fmtFecha(hoyIso)}</div>
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

      {!sinFichaMi && (modoTienda || vend) && (
        <RadarMiDia key={modoTienda ? 't-' + sucTienda : 'v-' + vend?.bsale_user_id}
          {...{ cu, vendedores, esGerente, isMobile, onVerRadar, modoTienda }}
          sucursalId={modoTienda ? sucTienda : vend?.sucursal_id} vendedorId={modoTienda ? null : vend?.bsale_user_id} />
      )}

      {!sinFichaMi && (modoTienda || vend) && (
        <ChatsVambeMiDia key={modoTienda ? 'ct-' + sucTienda : 'cv-' + vend?.bsale_user_id}
          modoTienda={modoTienda} sucursalId={modoTienda ? sucTienda : vend?.sucursal_id}
          vendedorBsaleId={modoTienda ? null : vend?.bsale_user_id} isMobile={isMobile}
          onCount={n => setChatsLive(modoTienda ? 0 : n)} onVerTodo={onVerVambe} />
      )}

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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 12 }}>
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
