import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, signOut } from '../supabase'
import { useResponsive } from '../core/responsive'

/* ═══════════════════════════════════════════════════════════════
   APP HUB v2 — Resumen en vivo + responsive
   · KPIs se cargan SOLO para las apps a las que el usuario tiene acceso
   · Refresco automático cada 60s (solo con pestaña visible) + al volver a la pestaña
   · Fecha "hoy" en zona America/Santiago (antes usaba UTC)
   ═══════════════════════════════════════════════════════════════ */

const REFRESH_MS = 60000
const TZ = 'America/Santiago'

/* ═══ ROLES legados (fallback si usuario_acceso no tiene registros) ═══ */
const ROLES = [
  { k: "admin",            l: "Admin",             c: "#FF3B30" },
  { k: "dir_general",      l: "Dir. General",      c: "#FF3B30" },
  { k: "dir_finanzas",     l: "Dir. Finanzas",     c: "#AF52DE" },
  { k: "dir_negocios",     l: "Dir. Negocios",     c: "#007AFF" },
  { k: "dir_operaciones",  l: "Dir. Operaciones",  c: "#5AC8FA" },
  { k: "analista",         l: "Analista",          c: "#34C759" },
  { k: "jefe_bodega",      l: "Jefe Bodega",       c: "#FF9500" },
  { k: "jefe_operaciones", l: "Jefe Operaciones",  c: "#FF9500" },
  { k: "directorio",       l: "Directorio",        c: "#8E8E93" },
  { k: "cajero",           l: "Cajero/Vendedor",   c: "#34C759" }
]
const rl = u => ROLES.find(r => r.k === u?.rol) || ROLES[5]

/* ═══ Estados OC (alineados con STS de App.jsx) ═══ */
const OC_INACTIVAS = ["Recibida OK", "Anulada", "Cerrada", "Rechazada", "Dividida", "Fusionada"]
const OC_TRANSITO = ["Despacho nac.", "Transporte", "Internación", "Validar costeo final", "Pago fabricación", "Pago embarque"]
const PV_CERRADOS = ["cerrado", "rechazado"]
const SUC_NOMBRE = { 'suc-lg': 'La Granja', 'suc-la': 'Los Ángeles', 'suc-maipu': 'Tienda Maipú', 'suc-mp': 'CD Maipú', 'suc-web': 'Web' }
const SUC_ORDEN = ['suc-lg', 'suc-maipu', 'suc-la', 'suc-web', 'suc-mp']

/* ═══ Helpers ═══ */
const fmtCLP = n => {
  if (n == null || isNaN(n)) return '—'
  const v = Math.abs(n)
  if (v >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K'
  return '$' + Math.round(n).toLocaleString('es-CL')
}
const fmtNum = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('es-CL')
const fechaCL = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const fmtDiaCorto = iso => { if (!iso) return ''; const [, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}` }
const haceTxt = ts => {
  if (!ts) return '—'
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000))
  if (s < 60) return `hace ${s}s`
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`
  return `hace ${Math.floor(s / 3600)} h`
}
const saludoHora = h => h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'
const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const fmtFecha = d => `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`
const semanaDelAnio = d => {
  const t = new Date(d.getFullYear(), 0, 1)
  return Math.ceil((((d - t) / 86400000) + t.getDay() + 1) / 7)
}
const chk = r => { if (r?.error) throw r.error; return r }

/* ═══ Paleta corporativa por app ═══ */
const APPS_CATALOG = {
  compras:    { l: "Abastecimiento", desc: "Planificación, reposición, OC e importaciones", ic: "ti-package", c1: "#d28a4a", c2: "#a8551b", bg: "#faf6ef", bgBadge: "#fcecde", txt: "#a8551b", tabs: ["Monitor","Órdenes","Reposición","Forecast","Tránsito"] },
  compras_op: { l: "Compras Operación", desc: "Insumos, herramientas, aseo y servicios", ic: "ti-tools", c1: "#14b8a6", c2: "#0f766e", bg: "#f0fdfa", bgBadge: "#ccfbf1", txt: "#0f766e", tabs: ["Solicitudes","Aprobar","Gestión","Recepción","Panel"] },
  finanzas:   { l: "Finanzas", desc: "Tesorería, conciliación, EERR", ic: "ti-coin", c1: "#5dcaa5", c2: "#1f6e54", bg: "#f3faf7", bgBadge: "#dff3ec", txt: "#1f6e54", tabs: ["Dashboard","Conciliación","Tesorería","Presupuesto"] },
  postventa:  { l: "Postventa", desc: "Reclamos, NC, escalados", ic: "ti-tool", c1: "#9d7fff", c2: "#5847a3", bg: "#f8f5ff", bgBadge: "#f0e8ff", txt: "#5847a3", tabs: ["Dashboard","Casos","Escalados","Finanzas"] },
  rrhh:       { l: "Personas", desc: "Remuneraciones, asistencia", ic: "ti-users", c1: "#e8728c", c2: "#a32d3f", bg: "#fcf5f6", bgBadge: "#fde8ec", txt: "#a32d3f", tabs: ["Remuneraciones","Asistencia"] },
  admin:      { l: "Administración", desc: "Usuarios, accesos, apps, roles", ic: "ti-key", c1: "#a8a39a", c2: "#5a544b", bg: "#f7f5f1", bgBadge: "#ebe7e0", txt: "#5a544b", tabs: ["Usuarios","Accesos","Apps","Roles"] },
  inventario: { l: "Análisis de Stock", desc: "Rotación, estacionalidad, decisión", ic: "ti-chart-bar", c1: "#5856D6", c2: "#3d3ba3", bg: "#f3f3fc", bgBadge: "#e5e4f7", txt: "#3d3ba3", tabs: ["Dashboard","Análisis SKU","Estacionalidad","Por Sucursal","Decisión"] },
  logistica:  { l: "Logística", desc: "WMS — picking, recepción, inventarios", ic: "ti-truck", c1: "#FF9500", c2: "#cc7700", bg: "#fff5e6", bgBadge: "#ffe8c2", txt: "#cc7700", tabs: ["Picking","Recepción","Inventario","Bitácora"] },
  comercial:  { l: "Comercial", desc: "Pipeline de cotizaciones y metas", ic: "ti-trending", c1: "#3b82f6", c2: "#1d4ed8", bg: "#f2f6fe", bgBadge: "#e0eafd", txt: "#1d4ed8", tabs: ["Pipeline","Conversaciones","Metas"] },
  agente:     { l: "Agente IA", desc: "Pregunta sobre compras, finanzas y negocio", ic: "ti-robot", c1: "#6366F1", c2: "#4338CA", bg: "#f4f4fd", bgBadge: "#e6e6fb", txt: "#4338CA", tabs: ["Chat"] },
  proyectos:  { l: "Proyectos", desc: "Proyectos, tareas y control de gestión", ic: "ti-checklist", c1: "#3b4a7a", c2: "#16213e", bg: "#f4f5f9", bgBadge: "#e6e8f2", txt: "#16213e", tabs: ["Panel","Proyectos","Carta Gantt","Derivación"] },
  procesos:   { l: "Procesos", desc: "Matriz de procesos, SOP oficiales y flujogramas", ic: "ti-compass", c1: "#3aa99a", c2: "#0f6e62", bg: "#f2faf8", bgBadge: "#dcf2ee", txt: "#0f6e62", tabs: ["Dashboard","Matriz","Comités","Repositorio"] }
}

function appsLegado(rol) {
  if (rol === "admin" || rol === "dir_general") return ["compras","compras_op","finanzas","postventa","rrhh","admin","inventario","agente","proyectos","comercial","procesos"]
  if (rol === "dir_finanzas") return ["compras","finanzas","rrhh"]
  if (rol === "cajero") return ["finanzas"]
  // Sin matriz de acceso y sin rol conocido → ninguna app (antes caía a Abastecimiento y entraba solo)
  return []
}

/* ═══ LOADERS — uno por app. Cada uno lanza error si su query falla ═══ */
const LOADERS = {
  // Compras Operación: RLS ya limita a lo que el usuario puede ver
  compras_op: async () => {
    const r = await supabase.from('cop_solicitudes').select('estado').is('deleted_at', null)
      .in('estado', ['Pend. aprobación', 'Aprobada', 'OC emitida', 'Recibida', 'Recibida con obs.']).limit(5000).then(chk)
    const e = (r.data || []).map(x => x.estado)
    return { pend: e.filter(x => x === 'Pend. aprobación').length, porComprar: e.filter(x => x === 'Aprobada').length,
      enCurso: e.filter(x => x === 'OC emitida').length, sinFactura: e.filter(x => x.startsWith('Recibida')).length }
  },

  compras: async () => {
    const [oc, q] = await Promise.all([
      supabase.from('ordenes_compra').select('estado,total_clp').not('estado', 'in', `(${OC_INACTIVAS.map(e => `"${e}"`).join(',')})`).limit(5000),
      supabase.from('productos').select('sku', { count: 'exact', head: true }).eq('stock_actual', 0).gt('vta_prom_diaria', 0)
    ].map(p => p.then(chk)))
    const ocs = oc.data || []
    const trans = ocs.filter(o => OC_TRANSITO.includes(o.estado))
    return {
      ocActivas: ocs.length,
      porAprobar: ocs.filter(o => (o.estado || '').startsWith('Pend. Dir')).length,
      quiebres: q.count ?? null,
      montoTransito: trans.reduce((s, o) => s + (Number(o.total_clp) || 0), 0),
      ocTransito: trans.length
    }
  },

  finanzas: async () => {
    const hoy = fechaCL()
    const [mov, vtas, desc] = await Promise.all([
      supabase.from('movimientos_bancarios').select('monto').eq('estado', 'pendiente').limit(10000),
      supabase.from('ventas_bsale_dia').select('fecha,sucursal_id,total_venta').lt('fecha', hoy).gte('fecha', sumarDias(hoy, -10)).limit(200),
      supabase.from('cierres_caja').select('id', { count: 'exact', head: true }).eq('estado', 'descuadre').gte('fecha', sumarDias(hoy, -7))
    ].map(p => p.then(chk)))
    // Último día hábil con venta (excluye web: no cierra caja física)
    const conVenta = (vtas.data || []).filter(v => Number(v.total_venta) > 0 && v.sucursal_id !== 'suc-web')
    const ultFecha = conVenta.map(v => v.fecha).sort().pop() || null
    const sucsEsperadas = [...new Set(conVenta.filter(v => v.fecha === ultFecha).map(v => v.sucursal_id))]
    let sucsCerradas = []
    if (ultFecha) {
      const c = chk(await supabase.from('cierres_caja').select('sucursal_id').eq('fecha', ultFecha).limit(500))
      sucsCerradas = [...new Set((c.data || []).map(x => x.sucursal_id))].filter(s => sucsEsperadas.includes(s))
    }
    const movs = mov.data || []
    return {
      fechaCierre: ultFecha,
      cierresOk: sucsCerradas.length,
      cierresEsp: sucsEsperadas.length,
      sucsSinCierre: sucsEsperadas.filter(s => !sucsCerradas.includes(s)),
      montoPorConciliar: movs.reduce((s, m) => s + Math.abs(Number(m.monto) || 0), 0),
      movPendientes: movs.length,
      descuadres7d: desc.count ?? 0
    }
  },

  postventa: async () => {
    const r = chk(await supabase.from('casos_postventa')
      .select('estado,es_critico,escalado_a,created_at')
      .is('deleted_at', null)
      .not('estado', 'in', `(${PV_CERRADOS.join(',')})`)
      .limit(5000))
    const casos = r.data || []
    const dias = casos.map(c => (Date.now() - new Date(c.created_at).getTime()) / 86400000)
    return {
      abiertos: casos.length,
      criticos: casos.filter(c => c.es_critico || c.escalado_a).length,
      edadProm: dias.length ? dias.reduce((s, v) => s + v, 0) / dias.length : null
    }
  },

  rrhh: async () => {
    const [emp, dot, met] = await Promise.all([
      supabase.from('rrhh_empleados').select('cod_contaline', { count: 'exact', head: true }).eq('activo', true),
      supabase.from('v_asis_dotacion_estado').select('estado_actual').eq('activo', true).limit(2000),
      supabase.from('v_rrhh_metricas').select('periodo,costo_fijo,costo_variable').order('periodo', { ascending: false }).limit(1)
    ].map(p => p.then(chk)))
    const m = (met.data || [])[0]
    return {
      empleados: emp.count ?? null,
      ausentes: (dot.data || []).filter(d => d.estado_actual && d.estado_actual !== 'activo').length,
      costoPlanilla: m ? (Number(m.costo_fijo) || 0) + (Number(m.costo_variable) || 0) : null,
      periodoUlt: m?.periodo || null
    }
  },

  admin: async () => {
    const [u, r] = await Promise.all([
      supabase.from('usuarios').select('id', { count: 'exact', head: true }).eq('activo', true),
      supabase.from('roles_app').select('id', { count: 'exact', head: true })
    ].map(p => p.then(chk)))
    return { usuarios: u.count ?? null, roles: r.count ?? null }
  },

  inventario: async () => {
    const [t, q, d] = await Promise.all([
      supabase.from('productos').select('sku', { count: 'exact', head: true }),
      supabase.from('productos').select('sku', { count: 'exact', head: true }).eq('stock_actual', 0).gt('vta_prom_diaria', 0),
      supabase.from('productos').select('sku', { count: 'exact', head: true }).gt('stock_actual', 0).or('venta_total.is.null,venta_total.eq.0')
    ].map(p => p.then(chk)))
    return { skus: t.count ?? null, quiebres: q.count ?? null, deadStock: d.count ?? null }
  },

  logistica: async () => {
    // Usa índice parcial idx_picking_estado (no hace seq-scan)
    const r = chk(await supabase.from('log_picking_ordenes').select('id', { count: 'exact', head: true }).in('estado', ['asignada', 'en_picking']))
    return { enPreparacion: r.count ?? null }
  },

  comercial: async () => {
    const r = chk(await supabase.from('v_com_pipeline').select('total,en_riesgo').eq('abierta', true).limit(10000))
    const rows = r.data || []
    return {
      abiertas: rows.length,
      enRiesgo: rows.filter(x => x.en_riesgo).length,
      montoPipeline: rows.reduce((s, x) => s + (Number(x.total) || 0), 0)
    }
  },

  proyectos: async (cu) => {
    const hoy = fechaCL()
    const r = chk(await supabase.from('pmo_tareas').select('estado,fecha_vencimiento')
      .is('eliminado_en', null).eq('responsable_id', cu.id).neq('estado', 'completada').limit(2000))
    const t = r.data || []
    return {
      misAbiertas: t.length,
      vencidas: t.filter(x => x.fecha_vencimiento && x.fecha_vencimiento < hoy).length,
      bloqueadas: t.filter(x => x.estado === 'bloqueada').length
    }
  },

  procesos: async () => {
    const r = chk(await supabase.from('v_prc_dashboard').select('*').limit(1))
    const d = (r.data || [])[0] || {}
    return { total: d.total_procesos ?? null, enRiesgo: d.en_riesgo ?? null, avance: d.avance_ponderado ?? null, implementados: d.implementados ?? null }
  },

  // Pulso de ventas del día (no es una app; se habilita según rol)
  ventas: async () => {
    const r = chk(await supabase.from('ventas_bsale_dia').select('sucursal_id,total_venta,total_nc,docs_venta,sincronizado_at').eq('fecha', fechaCL()).limit(50))
    const rows = r.data || []
    return {
      total: rows.reduce((s, x) => s + (Number(x.total_venta) || 0), 0),
      nc: rows.reduce((s, x) => s + (Number(x.total_nc) || 0), 0),
      docs: rows.reduce((s, x) => s + (Number(x.docs_venta) || 0), 0),
      sync: rows.map(x => x.sincronizado_at).filter(Boolean).sort().pop() || null,
      porSuc: rows
        .map(x => ({ id: x.sucursal_id, venta: Number(x.total_venta) || 0, nc: Number(x.total_nc) || 0, docs: Number(x.docs_venta) || 0 }))
        .sort((a, b) => SUC_ORDEN.indexOf(a.id) - SUC_ORDEN.indexOf(b.id))
    }
  }
}

const ROLES_VENTAS = ['admin', 'dir_general', 'dir_finanzas', 'dir_negocios', 'dir_operaciones', 'directorio']

/* ═══ CSS global (animaciones + responsive) — se inyecta una vez ═══ */
const HUB_CSS = `
@keyframes hubShimmer { 0% { background-position: -200px 0 } 100% { background-position: 200px 0 } }
@keyframes hubFlash { 0% { background: rgba(93,202,165,.35) } 100% { background: transparent } }
@keyframes hubPulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
@keyframes hubSpin { to { transform: rotate(360deg) } }
.hub-skel { display:inline-block; height:14px; width:44px; border-radius:4px; background: linear-gradient(90deg,#efe7da 0,#f8f3ea 60px,#efe7da 120px); background-size: 400px 100%; animation: hubShimmer 1.2s infinite linear }
.hub-flash { animation: hubFlash 1.4s ease-out; border-radius: 4px }
.hub-live { animation: hubPulse 2s infinite }
.hub-spin { animation: hubSpin .8s linear infinite; display:inline-block }
.hub-scroll-x { overflow-x:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none }
.hub-scroll-x::-webkit-scrollbar { display:none }
.hub-card:active { transform: scale(.985) !important }
`
function useHubCss() {
  useEffect(() => {
    if (document.getElementById('hub-css')) return
    const s = document.createElement('style'); s.id = 'hub-css'; s.textContent = HUB_CSS
    document.head.appendChild(s)
  }, [])
}

/* ═══ APP HUB ═══ */
export function AppHub({ cu, onSelect, onLogout }) {
  useHubCss()
  const { isMobile, isTablet } = useResponsive()
  const compact = isMobile || isTablet
  const r = rl(cu)
  const [appsDisp, setAppsDisp] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())
  const [sistemaOK, setSistemaOK] = useState(true)
  const [kpis, setKpis] = useState({})
  const [errs, setErrs] = useState({})
  const [lastUpd, setLastUpd] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showCambioPass, setShowCambioPass] = useState(false)
  const [pass, setPass] = useState("")
  const [pass2, setPass2] = useState("")
  const [passLoading, setPassLoading] = useState(false)
  const [passErr, setPassErr] = useState("")
  const [passOk, setPassOk] = useState(false)
  const inFlight = useRef(false)

  /* Reloj en vivo */
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(i)
  }, [])

  /* Carga apps disponibles */
  useEffect(() => {
    let cancel = false
    const cargar = async () => {
      try {
        const { data, error } = await supabase
          .from('usuario_acceso')
          .select('app_codigo, apps(activa)')
          .eq('usuario_id', cu.id)
          .eq('activo', true)
        if (cancel) return
        if (error || !data || data.length === 0) {
          setAppsDisp(appsLegado(cu.rol))
        } else {
          const codigos = data.filter(a => a.apps?.activa).map(a => a.app_codigo)
          setAppsDisp(codigos.length === 0 ? appsLegado(cu.rol) : codigos)
        }
      } catch (e) {
        if (!cancel) setAppsDisp(appsLegado(cu.rol))
      } finally {
        if (!cancel) setLoading(false)
      }
    }
    cargar()
    return () => { cancel = true }
  }, [cu.id, cu.rol])

  const verVentas = ROLES_VENTAS.includes(cu.rol) || appsDisp.includes('comercial')

  /* Carga KPIs: solo de apps con acceso, en paralelo, errores aislados por módulo */
  const cargarKPIs = useCallback(async () => {
    if (inFlight.current || appsDisp.length === 0) return
    inFlight.current = true
    setRefreshing(true)
    const claves = appsDisp.filter(k => LOADERS[k])
    if (verVentas) claves.push('ventas')
    const res = await Promise.allSettled(claves.map(k => LOADERS[k](cu)))
    const k = {}, e = {}
    res.forEach((x, i) => {
      if (x.status === 'fulfilled') k[claves[i]] = x.value
      else { e[claves[i]] = x.reason?.message || 'Error'; console.warn('[AppHub] KPI', claves[i], x.reason) }
    })
    setKpis(prev => {
      const n = { ...prev, ...k }
      Object.keys(e).forEach(c => { if (!(c in k) && !(c in prev)) n[c] = null })
      return n
    })
    setErrs(e)
    setSistemaOK(claves.length === 0 || Object.keys(e).length < claves.length)
    setLastUpd(new Date())
    setRefreshing(false)
    inFlight.current = false
  }, [appsDisp, verVentas, cu])

  /* Primera carga + refresco periódico (solo pestaña visible) + al volver a la pestaña */
  useEffect(() => {
    if (loading) return
    cargarKPIs()
    const i = setInterval(() => { if (!document.hidden) cargarKPIs() }, REFRESH_MS)
    const onVis = () => { if (!document.hidden) cargarKPIs() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', onVis) }
  }, [loading, cargarKPIs])

  const guardarPassword = async () => {
    if (pass.length < 8) { setPassErr('Mínimo 8 caracteres'); return }
    if (pass !== pass2) { setPassErr('Las contraseñas no coinciden'); return }
    setPassLoading(true); setPassErr('')
    const { error } = await supabase.auth.updateUser({ password: pass })
    setPassLoading(false)
    if (error) { setPassErr('Error: ' + error.message); return }
    setPassOk(true)
    setTimeout(() => {
      setShowCambioPass(false)
      setPass(''); setPass2(''); setPassErr(''); setPassOk(false)
    }, 2000)
  }
  const abrirCambioPass = () => { setMenuOpen(false); setShowCambioPass(true); setPass(""); setPass2(""); setPassErr(""); setPassOk(false) }

  // Auto-seleccionar si solo hay 1 app
  useEffect(() => {
    if (!loading && appsDisp.length === 1) {
      const app = APPS_CATALOG[appsDisp[0]]
      if (app && !app.soon) onSelect(appsDisp[0])
    }
  }, [loading, appsDisp, onSelect])

  const handleLogout = async () => {
    if (typeof onLogout === 'function') { onLogout(); return }
    try { await signOut() } catch (e) {}
    try { localStorage.removeItem("erp_cu_id") } catch (e) {}
    try { localStorage.removeItem("outlet_app_actual") } catch (e) {}
    window.location.reload()
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5efe4", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "linear-gradient(135deg,#d28a4a,#a8551b)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
            <span style={{ fontSize: 24, color: "#fff" }}>🚪</span>
          </div>
          <div style={{ fontSize: 13, color: "#8b7355" }}>Cargando aplicaciones...</div>
        </div>
      </div>
    )
  }

  const apps = appsDisp.map(k => ({ k, ...APPS_CATALOG[k] })).filter(a => a.l)
  const iniciales = (cu.nombre || cu.correo || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')

  /* undefined = cargando (skeleton) · null = error · valor = dato */
  const V = (mod, fn) => kpis[mod] === undefined ? undefined : kpis[mod] === null ? '—' : fn(kpis[mod])
  const C = kpis.compras, F = kpis.finanzas, P = kpis.postventa, R = kpis.rrhh, I = kpis.inventario, CO = kpis.comercial, PR = kpis.proyectos, PC = kpis.procesos, L = kpis.logistica

  const CO2 = kpis.compras_op
  const kpisByApp = {
    compras_op: [
      { v: V('compras_op', c => fmtNum(c.pend)), l: 'Por aprobar', highlight: true, danger: CO2?.pend > 0 },
      { v: V('compras_op', c => fmtNum(c.porComprar)), l: 'Por comprar' },
      { v: V('compras_op', c => fmtNum(c.enCurso)), l: 'OC en curso' }
    ],
    compras: [
      { v: V('compras', c => fmtNum(c.ocActivas)), l: 'OC activas', highlight: true },
      { v: V('compras', c => fmtNum(c.quiebres)), l: 'Quiebres SKU', danger: C?.quiebres > 0 },
      { v: V('compras', c => fmtCLP(c.montoTransito)), l: C ? `En tránsito (${C.ocTransito})` : 'En tránsito' }
    ],
    finanzas: [
      { v: V('finanzas', f => f.cierresEsp ? `${f.cierresOk}/${f.cierresEsp}` : '—'), l: F?.fechaCierre ? `Cierres ${fmtDiaCorto(F.fechaCierre)}` : 'Cierres', highlight: true, danger: F && F.cierresOk < F.cierresEsp },
      { v: V('finanzas', f => fmtCLP(f.montoPorConciliar)), l: F ? `${fmtNum(F.movPendientes)} mov. x conciliar` : 'x conciliar' },
      { v: V('finanzas', f => fmtNum(f.descuadres7d)), l: 'Descuadres 7d', danger: F?.descuadres7d > 0 }
    ],
    postventa: [
      { v: V('postventa', p => fmtNum(p.abiertos)), l: 'Abiertos', highlight: true },
      { v: V('postventa', p => fmtNum(p.criticos)), l: 'Críticos/escal.', danger: P?.criticos > 0 },
      { v: V('postventa', p => p.edadProm != null ? p.edadProm.toFixed(1) + 'd' : '—'), l: 'Antigüedad prom' }
    ],
    rrhh: [
      { v: V('rrhh', x => fmtNum(x.empleados)), l: 'Activos', highlight: true },
      { v: V('rrhh', x => fmtNum(x.ausentes)), l: 'Licencia/novedad', danger: R?.ausentes > 0 },
      { v: V('rrhh', x => fmtCLP(x.costoPlanilla)), l: R?.periodoUlt ? `Planilla ${R.periodoUlt}` : 'Planilla' }
    ],
    admin: [
      { v: V('admin', a => fmtNum(a.usuarios)), l: 'Usuarios', highlight: true },
      { v: V('admin', a => fmtNum(a.roles)), l: 'Roles' }
    ],
    inventario: [
      { v: V('inventario', x => fmtNum(x.skus)), l: 'SKU', highlight: true },
      { v: V('inventario', x => fmtNum(x.quiebres)), l: 'Quiebres', danger: I?.quiebres > 0 },
      { v: V('inventario', x => fmtNum(x.deadStock)), l: 'Sin venta c/stock' }
    ],
    logistica: [
      { v: V('logistica', x => fmtNum(x.enPreparacion)), l: 'En preparación', highlight: true }
    ],
    comercial: [
      { v: V('comercial', x => fmtNum(x.abiertas)), l: 'Cotiz. abiertas', highlight: true },
      { v: V('comercial', x => fmtNum(x.enRiesgo)), l: 'En riesgo', danger: CO?.enRiesgo > 0 },
      { v: V('comercial', x => fmtCLP(x.montoPipeline)), l: 'Pipeline' }
    ],
    proyectos: [
      { v: V('proyectos', x => fmtNum(x.misAbiertas)), l: 'Mis tareas', highlight: true },
      { v: V('proyectos', x => fmtNum(x.vencidas)), l: 'Vencidas', danger: PR?.vencidas > 0 },
      { v: V('proyectos', x => fmtNum(x.bloqueadas)), l: 'Bloqueadas', danger: PR?.bloqueadas > 0 }
    ],
    procesos: [
      { v: V('procesos', x => x.avance != null ? x.avance + '%' : '—'), l: 'Avance', highlight: true },
      { v: V('procesos', x => fmtNum(x.enRiesgo)), l: 'En riesgo', danger: PC?.enRiesgo > 0 },
      { v: V('procesos', x => x.total != null ? `${x.implementados ?? 0}/${x.total}` : '—'), l: 'Implementados' }
    ]
  }

  const badgeForApp = (k) => {
    if (errs[k]) return { txt: 'Sin datos', dot: true, warn: true }
    if (kpis[k] === undefined) return null
    if (k === 'compras_op') return CO2?.pend > 0 ? { txt: `${CO2.pend} por aprobar`, dot: true, warn: true } : { txt: 'Al día', dot: true }
    if (k === 'compras') return C?.porAprobar > 0 ? { txt: `${C.porAprobar} por aprobar`, dot: true, warn: true } : { txt: 'Al día', dot: true }
    if (k === 'finanzas') {
      if (!F?.cierresEsp) return { txt: 'Tesorería', dot: false }
      return F.cierresOk >= F.cierresEsp ? { txt: 'Cierres al día', dot: true } : { txt: `${F.cierresEsp - F.cierresOk} caja${F.cierresEsp - F.cierresOk > 1 ? 's' : ''} sin cerrar`, dot: true, warn: true }
    }
    if (k === 'postventa') return P?.criticos > 0 ? { txt: `${P.criticos} críticos`, dot: true, warn: true } : { txt: 'Sin urgencias', dot: true }
    if (k === 'rrhh') return { txt: R?.periodoUlt ? `Periodo ${R.periodoUlt}` : 'RRHH', dot: false }
    if (k === 'admin') return { txt: 'Solo Admin', dot: false }
    if (k === 'comercial') return CO?.enRiesgo > 0 ? { txt: `${Math.round(CO.enRiesgo / Math.max(1, CO.abiertas) * 100)}% en riesgo`, dot: true, warn: true } : { txt: 'Pipeline sano', dot: true }
    if (k === 'proyectos') return PR?.vencidas > 0 ? { txt: `${PR.vencidas} vencidas`, dot: true, warn: true } : { txt: 'Al día', dot: true }
    if (k === 'procesos') return PC?.enRiesgo > 0 ? { txt: `${PC.enRiesgo} en riesgo`, dot: true, warn: true } : { txt: 'Matriz', dot: false }
    if (k === 'logistica') return L?.enPreparacion > 0 ? { txt: 'Picking activo', dot: true, live: true } : { txt: 'Cola vacía', dot: true }
    return null
  }

  /* KPIs ejecutivos (sidebar desktop / chips mobile) — solo de apps con acceso */
  const resumen = [
    appsDisp.includes('compras') && { label: 'OC activas', value: V('compras', c => fmtNum(c.ocActivas)), color: '#c97b3a', app: 'compras' },
    appsDisp.includes('compras') && { label: 'Quiebres SKU', value: V('compras', c => fmtNum(c.quiebres)), color: '#e24b4a', app: 'compras' },
    appsDisp.includes('finanzas') && { label: F?.fechaCierre ? `Cierres ${fmtDiaCorto(F.fechaCierre)}` : 'Cierres caja', value: V('finanzas', f => f.cierresEsp ? `${f.cierresOk}/${f.cierresEsp}` : '—'), color: '#5dcaa5', app: 'finanzas' },
    appsDisp.includes('postventa') && { label: 'Casos PV', value: V('postventa', p => fmtNum(p.abiertos)), color: '#9d7fff', app: 'postventa' },
    appsDisp.includes('comercial') && { label: 'Cotiz. riesgo', value: V('comercial', x => fmtNum(x.enRiesgo)), color: '#3b82f6', app: 'comercial' },
    appsDisp.includes('proyectos') && { label: 'Tareas vencidas', value: V('proyectos', x => fmtNum(x.vencidas)), color: '#7c8bc4', app: 'proyectos' }
  ].filter(Boolean)

  const liveInfo = (
    <LiveIndicator ok={sistemaOK} lastUpd={lastUpd} refreshing={refreshing} onRefresh={cargarKPIs} errCount={Object.keys(errs).length} now={now} compact={isMobile} />
  )

  const cols = isMobile ? '1fr' : isTablet ? 'repeat(2, minmax(0,1fr))' : 'repeat(auto-fill, minmax(330px, 1fr))'

  return (
    <div style={{ minHeight: "100vh", background: "#f5efe4", fontFamily: FONT, display: "flex", flexDirection: compact ? "column" : "row" }}>

      {/* ═══ SIDEBAR (desktop) ═══ */}
      {!compact && (
        <aside style={{ width: 250, background: "linear-gradient(180deg,#2a1f15 0%,#1a1410 100%)", padding: "22px 16px", display: "flex", flexDirection: "column", flexShrink: 0, height: "100vh", position: "sticky", top: 0, overflowY: "auto" }}>
          <Logo />
          <div style={{ background: "#241a13", borderRadius: 12, padding: 14, marginBottom: 14, border: "1px solid #3a2d1f" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#a08b6f", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
              <span className="hub-live" style={{ width: 6, height: 6, borderRadius: "50%", background: "#5dcaa5", boxShadow: "0 0 6px #5dcaa5" }} /> Ahora
            </div>
            <div style={{ color: "#f4e9d8", fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
              {hh}:{mm}<span style={{ color: "#5f4a35", fontSize: 18 }}>:{ss}</span>
            </div>
            <div style={{ color: "#c97b3a", fontSize: 11, marginTop: 2, textTransform: "capitalize" }}>{fmtFecha(now)}</div>
            <div style={{ color: "#5f4a35", fontSize: 10, marginTop: 1 }}>Semana {semanaDelAnio(now)} · {now.getFullYear()}</div>
          </div>
          <div style={{ background: "#241a13", borderRadius: 12, padding: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar ini={iniciales} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#f4e9d8", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cu.nombre || 'Usuario'}</div>
              <div style={{ color: r.c, fontSize: 10, fontWeight: 600 }}>{r.l}</div>
            </div>
          </div>
          <div style={{ color: "#5f4a35", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: sistemaOK ? "#5dcaa5" : "#e24b4a" }} /> Estado hoy
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {resumen.map(x => <KPIRow key={x.label} {...x} onClick={() => onSelect(x.app)} />)}
          </div>
          <div style={{ marginTop: "auto", paddingTop: 16, display: "flex", gap: 6 }}>
            <SideBtn onClick={abrirCambioPass}>🔑 Clave</SideBtn>
            <SideBtn onClick={handleLogout}>↩ Salir</SideBtn>
          </div>
        </aside>
      )}

      {/* ═══ HEADER (tablet/mobile) ═══ */}
      {compact && (
        <header style={{ position: "sticky", top: 0, zIndex: 50, background: "linear-gradient(180deg,#2a1f15 0%,#1f1812 100%)", padding: isMobile ? "10px 14px" : "12px 20px", paddingTop: `calc(${isMobile ? 10 : 12}px + env(safe-area-inset-top, 0px))`, boxShadow: "0 2px 10px rgba(0,0,0,.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#d28a4a,#a8551b)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🚪</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#f4e9d8", fontSize: 13, fontWeight: 600 }}>Outlet de Puertas</div>
              <div style={{ color: "#a08b6f", fontSize: 10, textTransform: "capitalize", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fmtFecha(now)} · {hh}:{mm}</div>
            </div>
            <div style={{ position: "relative" }}>
              <button onClick={() => setMenuOpen(o => !o)} aria-label="Menú usuario" style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Avatar ini={iniciales} size={36} />
              </button>
              {menuOpen && (
                <>
                  <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                  <div style={{ position: "absolute", right: 0, top: 48, zIndex: 61, background: "#fff", borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,.25)", minWidth: 210, overflow: "hidden" }}>
                    <div style={{ padding: "12px 14px", borderBottom: "1px solid #f0e8da" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#2a1f15" }}>{cu.nombre || 'Usuario'}</div>
                      <div style={{ fontSize: 11, color: r.c, fontWeight: 600 }}>{r.l}</div>
                    </div>
                    <MenuItem onClick={abrirCambioPass}>🔑 Cambiar contraseña</MenuItem>
                    <MenuItem onClick={handleLogout}>↩ Cerrar sesión</MenuItem>
                  </div>
                </>
              )}
            </div>
          </div>
          {resumen.length > 0 && (
            <div className="hub-scroll-x" style={{ display: "flex", gap: 6, marginTop: 10, marginLeft: isMobile ? -14 : 0, marginRight: isMobile ? -14 : 0, paddingLeft: isMobile ? 14 : 0, paddingRight: isMobile ? 14 : 0 }}>
              {resumen.map(x => <KPIChip key={x.label} {...x} onClick={() => onSelect(x.app)} />)}
            </div>
          )}
        </header>
      )}

      {/* ═══ ÁREA APPS ═══ */}
      <main style={{ flex: 1, minWidth: 0, padding: isMobile ? "14px 12px 28px" : isTablet ? "18px 20px 32px" : 28, paddingBottom: isMobile ? "calc(28px + env(safe-area-inset-bottom, 0px))" : undefined }}>
        <div style={{ maxWidth: 1280, margin: compact ? "0 auto" : 0 }}>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "flex-end", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 8 : 12, marginBottom: isMobile ? 14 : 20 }}>
            <div>
              <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 700, color: "#2a1f15", letterSpacing: "-0.02em" }}>
                {saludoHora(now.getHours())} {(cu.nombre || '').split(' ')[0]}
              </div>
              <div style={{ color: "#8b7355", fontSize: 12, marginTop: 3 }}>
                {apps.length} aplicaciones · datos en vivo
              </div>
            </div>
            {liveInfo}
          </div>

          {verVentas && <VentasPulse data={kpis.ventas} err={errs.ventas} isMobile={isMobile} />}

          {!loading && apps.length === 0 && (
            <div style={{ background: "#fff", border: "1px solid #eadfce", borderRadius: 12, padding: "22px 20px", marginBottom: 12, textAlign: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#2a1f15" }}>No tienes aplicaciones asignadas</div>
              <div style={{ fontSize: 13, color: "#8a7a66", marginTop: 6 }}>Pide a Administración que configure tu acceso. Si ya lo hicieron, recarga la página.</div>
              <button onClick={() => window.location.reload()} style={{ marginTop: 12, padding: "8px 18px", borderRadius: 8, border: "none", background: "#a8551b", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Recargar</button>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: cols, gap: isMobile ? 10 : 12 }}>
            {apps.map(app => (
              <AppCard key={app.k} app={app} kpis={kpisByApp[app.k] || []} badge={badgeForApp(app.k)}
                isMobile={isMobile} fullRow={app.k === 'admin' && !isMobile}
                onSelect={() => !app.soon && onSelect(app.k)} />
            ))}
          </div>
        </div>
      </main>

      {/* Modal cambio password */}
      {showCambioPass && (
        <div onClick={() => setShowCambioPass(false)} style={{ position: "fixed", inset: 0, background: "rgba(26,20,16,0.6)", backdropFilter: "blur(8px)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 100, padding: isMobile ? 0 : 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: isMobile ? "18px 18px 0 0" : 16, padding: isMobile ? "22px 18px calc(22px + env(safe-area-inset-bottom, 0px))" : 28, width: "100%", maxWidth: isMobile ? "100%" : 420, boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#2a1f15" }}>Cambiar contraseña</div>
                <div style={{ fontSize: 11, color: "#8b7355", marginTop: 2 }}>{cu.correo}</div>
              </div>
              <button onClick={() => setShowCambioPass(false)} style={{ width: 36, height: 36, borderRadius: 18, background: "#f5efe4", border: "none", cursor: "pointer", fontSize: 16, color: "#8b7355" }}>×</button>
            </div>
            {passOk ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ width: 48, height: 48, borderRadius: 24, background: "#dff3ec", color: "#1f6e54", margin: "0 auto 8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>✓</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1f6e54" }}>Contraseña actualizada</div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={LBL}>Nueva contraseña</label>
                  <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="Mínimo 8 caracteres" style={INP} autoFocus={!isMobile} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={LBL}>Confirmar</label>
                  <input type="password" value={pass2} onChange={e => setPass2(e.target.value)} placeholder="Repite la contraseña" style={INP} onKeyDown={e => e.key === "Enter" && guardarPassword()} />
                </div>
                {pass.length > 0 && pass2.length > 0 && pass === pass2 && (
                  <div style={{ color: "#1f6e54", fontSize: 11, marginBottom: 10 }}>✓ Las contraseñas coinciden</div>
                )}
                {passErr && (
                  <div style={{ color: "#a32d3f", fontSize: 12, marginBottom: 10, padding: "8px 12px", background: "#fde8ec", borderRadius: 8 }}>{passErr}</div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
                  <button onClick={() => setShowCambioPass(false)} style={{ padding: "11px 16px", borderRadius: 9, background: "#f5efe4", color: "#5a4a35", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", flex: isMobile ? 1 : undefined }}>Cancelar</button>
                  <button disabled={!pass || !pass2 || passLoading} onClick={guardarPassword}
                    style={{ padding: "11px 16px", borderRadius: 9, background: (!pass || !pass2 || passLoading) ? "#a08b6f" : "linear-gradient(135deg,#d28a4a,#a8551b)", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: (!pass || !pass2 || passLoading) ? "default" : "pointer", flex: isMobile ? 1 : undefined }}>
                    {passLoading ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══ Constantes de estilo ═══ */
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif"
const LBL = { display: "block", fontSize: 11, fontWeight: 600, color: "#5a4a35", marginBottom: 5 }
const INP = { width: "100%", padding: "12px 13px", borderRadius: 9, border: "1px solid #ebe2d0", fontSize: 16, outline: "none", boxSizing: "border-box", background: "#faf6ef" }

/* ═══ Componentes internos ═══ */

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
      <div style={{ width: 38, height: 38, borderRadius: 9, background: "linear-gradient(135deg,#d28a4a,#a8551b)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(168,85,27,0.4)", fontSize: 20 }}>🚪</div>
      <div>
        <div style={{ color: "#f4e9d8", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>Outlet</div>
        <div style={{ color: "#a08b6f", fontSize: 10, letterSpacing: "0.05em" }}>de Puertas SpA</div>
      </div>
    </div>
  )
}

function Avatar({ ini, size }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "linear-gradient(135deg,#d28a4a,#a8551b)", color: "#1a1410", fontSize: size * 0.36, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{ini}</div>
  )
}

function SideBtn({ onClick, children }) {
  return (
    <button onClick={onClick} style={{ flex: 1, background: "transparent", border: "1px solid #3a2d1f", borderRadius: 9, padding: 8, color: "#a08b6f", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>{children}</button>
  )
}

function MenuItem({ onClick, children }) {
  return (
    <button onClick={onClick} style={{ display: "block", width: "100%", textAlign: "left", padding: "13px 14px", background: "#fff", border: "none", borderBottom: "1px solid #f7f1e6", fontSize: 13, color: "#2a1f15", cursor: "pointer" }}>{children}</button>
  )
}

/* Valor animado: skeleton si undefined, flash verde cuando cambia */
function LiveVal({ v, style }) {
  const prev = useRef(v)
  const [flash, setFlash] = useState(0)
  useEffect(() => {
    if (prev.current !== undefined && v !== undefined && prev.current !== v) setFlash(f => f + 1)
    prev.current = v
  }, [v])
  if (v === undefined) return <span className="hub-skel" />
  return <span key={flash} className={flash ? 'hub-flash' : undefined} style={style}>{v}</span>
}

function LiveIndicator({ ok, lastUpd, refreshing, onRefresh, errCount, now, compact }) {
  void now // fuerza re-render por segundo para "hace Xs"
  const color = !ok ? "#e24b4a" : errCount > 0 ? "#e8a33d" : "#5dcaa5"
  const txt = !ok ? "Sin conexión" : errCount > 0 ? `${errCount} módulo${errCount > 1 ? 's' : ''} sin datos` : "En vivo"
  return (
    <button onClick={onRefresh} title="Actualizar ahora" style={{ background: "#fff", border: "1px solid #ebe2d0", borderRadius: 20, padding: compact ? "8px 12px" : "5px 12px", fontSize: 11, color: "#5a4a35", display: "flex", alignItems: "center", gap: 7, cursor: "pointer", whiteSpace: "nowrap" }}>
      <span className={ok ? "hub-live" : undefined} style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}` }} />
      <b style={{ fontWeight: 600 }}>{txt}</b>
      <span style={{ color: "#a08b6f" }}>· {lastUpd ? haceTxt(lastUpd) : 'cargando'}</span>
      <span className={refreshing ? "hub-spin" : undefined} style={{ color: "#a08b6f", fontSize: 12 }}>↻</span>
    </button>
  )
}

function KPIRow({ label, value, color, onClick }) {
  return (
    <button onClick={onClick} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", background: "#241a13", borderRadius: 9, border: "none", borderLeft: `2px solid ${color}`, cursor: "pointer", width: "100%", textAlign: "left" }}>
      <span style={{ color: "#a08b6f", fontSize: 11 }}>{label}</span>
      <span style={{ color, fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}><LiveVal v={value} /></span>
    </button>
  )
}

function KPIChip({ label, value, color, onClick }) {
  return (
    <button onClick={onClick} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 7, padding: "7px 11px", background: "#2f241a", border: "1px solid #3a2d1f", borderLeft: `3px solid ${color}`, borderRadius: 9, cursor: "pointer", minHeight: 36 }}>
      <span style={{ color, fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}><LiveVal v={value} /></span>
      <span style={{ color: "#b8a385", fontSize: 11, whiteSpace: "nowrap" }}>{label}</span>
    </button>
  )
}

/* Pulso de ventas del día por sucursal (BSALE sync) */
function VentasPulse({ data, err, isMobile }) {
  const cargando = data === undefined
  const sucs = (data?.porSuc || []).filter(s => s.venta > 0 || s.nc > 0 || s.docs > 0)
  const max = Math.max(1, ...sucs.map(s => s.venta))
  const minSync = data?.sync ? (Date.now() - new Date(data.sync).getTime()) / 60000 : null
  const syncColor = minSync == null ? "#a08b6f" : minSync <= 15 ? "#1f6e54" : minSync <= 60 ? "#b7791f" : "#a32d3f"
  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #ebe2d0", padding: isMobile ? 14 : 16, marginBottom: isMobile ? 10 : 12, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#d28a4a,#5dcaa5)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: "#8b7355", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>Pulso de ventas · hoy</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: isMobile ? 26 : 28, fontWeight: 800, color: "#2a1f15", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
              <LiveVal v={cargando ? undefined : data === null ? '—' : fmtCLP(data.total)} />
            </span>
            {data && <span style={{ fontSize: 11, color: "#8b7355" }}>bruto BSALE · {fmtNum(data.docs)} docs</span>}
            {data?.nc > 0 && <span style={{ fontSize: 11, color: "#a32d3f", fontWeight: 600 }}>NC {fmtCLP(data.nc)}</span>}
          </div>
        </div>
        <div style={{ fontSize: 10, color: syncColor, display: "flex", alignItems: "center", gap: 5, background: "#faf6ef", padding: "4px 9px", borderRadius: 20 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: syncColor }} />
          {err ? 'Error al leer ventas' : data?.sync ? `Sync BSALE ${haceTxt(data.sync)}` : cargando ? 'Leyendo…' : 'Sin sync hoy'}
        </div>
      </div>
      {cargando ? (
        <div style={{ display: "grid", gap: 8 }}>{[0, 1, 2].map(i => <span key={i} className="hub-skel" style={{ width: "100%", height: 10 }} />)}</div>
      ) : sucs.length === 0 ? (
        <div style={{ fontSize: 12, color: "#8b7355" }}>Aún no hay ventas registradas hoy.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${Math.min(sucs.length, 4)}, minmax(0,1fr))`, gap: isMobile ? 9 : 14 }}>
          {sucs.map(s => (
            <div key={s.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "#5a4a35", fontWeight: 600 }}>{SUC_NOMBRE[s.id] || s.id}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#2a1f15", fontVariantNumeric: "tabular-nums" }}><LiveVal v={fmtCLP(s.venta)} /></span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "#f3ece0", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.max(2, s.venta / max * 100)}%`, background: "linear-gradient(90deg,#d28a4a,#a8551b)", borderRadius: 3, transition: "width .6s ease" }} />
              </div>
              <div style={{ fontSize: 9, color: "#a08b6f", marginTop: 3 }}>
                {fmtNum(s.docs)} docs{s.nc > 0 && <span style={{ color: "#a32d3f" }}> · NC {fmtCLP(s.nc)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Badge({ app, badge }) {
  if (!badge) return null
  const warn = badge.warn
  return (
    <div style={{ background: warn ? "#fdecea" : app.bgBadge, color: warn ? "#b3261e" : app.txt, fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
      {badge.dot && <span className={badge.live ? "hub-live" : undefined} style={{ width: 5, height: 5, borderRadius: "50%", background: warn ? "#b3261e" : app.txt }} />}
      {badge.txt}
    </div>
  )
}

function AppCard({ app, kpis, badge, onSelect, isMobile, fullRow }) {
  const [hover, setHover] = useState(false)
  const lift = hover && !app.soon && !isMobile

  /* Fila completa (Admin en desktop/tablet) */
  if (fullRow) {
    return (
      <button className="hub-card" onClick={onSelect} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{ background: "#fff", borderRadius: 14, padding: "14px 16px", border: "1px solid #ebe2d0", cursor: "pointer", gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 14, position: "relative", overflow: "hidden", textAlign: "left", transform: lift ? "translateY(-2px)" : "none", boxShadow: lift ? "0 8px 20px rgba(168,85,27,0.12)" : "0 1px 3px rgba(0,0,0,0.03)", transition: "all 0.2s" }}>
        <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, background: `linear-gradient(180deg,${app.c1},${app.c2})` }} />
        <IconBox app={app} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#2a1f15" }}>{app.l}</div>
          <div style={{ fontSize: 10, color: "#8b7355", marginTop: 1 }}>{app.desc}</div>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {kpis.map((k, i) => (
            <div key={i} style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: app.txt, fontVariantNumeric: "tabular-nums" }}><LiveVal v={k.v} /></div>
              <div style={{ fontSize: 9, color: "#8b7355" }}>{k.l}</div>
            </div>
          ))}
        </div>
        <span style={{ fontSize: 16, color: app.txt }}>→</span>
      </button>
    )
  }

  const hasKpis = !app.soon && kpis.length > 0
  return (
    <button className="hub-card" onClick={onSelect} disabled={app.soon} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background: "#fff", borderRadius: 14, padding: isMobile ? 14 : 16, border: "1px solid #ebe2d0", cursor: app.soon ? "default" : "pointer", position: "relative", overflow: "hidden", opacity: app.soon ? 0.55 : 1, textAlign: "left", display: "flex", flexDirection: "column", width: "100%", transform: lift ? "translateY(-3px)" : "none", boxShadow: lift ? `0 12px 24px ${app.c1}25` : "0 1px 3px rgba(0,0,0,0.03)", transition: "all 0.2s" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${app.c1},${app.c2})` }} />

      {isMobile ? (
        /* Mobile: icono + título en una línea */
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: hasKpis ? 11 : 4 }}>
          <IconBox app={app} size={38} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#2a1f15" }}>{app.l}</div>
            <div style={{ fontSize: 11, color: "#8b7355", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{app.desc}</div>
          </div>
          <Badge app={app} badge={badge} />
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <IconBox app={app} size={42} shadow />
            <Badge app={app} badge={badge} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#2a1f15" }}>{app.l}</div>
          <div style={{ fontSize: 10, color: "#8b7355", marginTop: 2, marginBottom: 11 }}>{app.desc}</div>
        </>
      )}

      {hasKpis && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${kpis.length}, minmax(0,1fr))`, gap: 6, padding: isMobile ? "9px 10px" : 9, background: app.bg, borderRadius: 8 }}>
          {kpis.map((k, i) => (
            <div key={i} style={{ minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? 16 : 15, fontWeight: 700, color: k.danger ? "#e24b4a" : (k.highlight ? app.txt : "#2a1f15"), fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><LiveVal v={k.v} /></div>
              <div style={{ fontSize: isMobile ? 10 : 9, color: "#8b7355", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.l}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: "auto", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: hasKpis || !isMobile ? "1px dashed #ebe2d0" : "none", ...(hasKpis ? { marginTop: 11 } : {}) }}>
        <div style={{ fontSize: 10, color: "#5f4a35", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "62%" }}>
          {app.tabs.slice(0, 3).join(" · ")}
        </div>
        <div style={{ fontSize: 12, color: app.soon ? "#8b7355" : app.txt, fontWeight: 700, display: "flex", alignItems: "center", gap: 4, minHeight: isMobile ? 28 : undefined }}>
          {app.soon ? "Próximamente" : <>Ingresar <span>→</span></>}
        </div>
      </div>
    </button>
  )
}

function IconBox({ app, size, shadow }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 11, background: `linear-gradient(135deg,${app.c1},${app.c2})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: size * 0.5, flexShrink: 0, boxShadow: shadow ? `0 4px 10px ${app.c1}30` : undefined }}>
      {iconFor(app.ic)}
    </div>
  )
}

function iconFor(ic) {
  const map = { 'ti-package': '📦', 'ti-coin': '💰', 'ti-tool': '🛠', 'ti-users': '👥', 'ti-key': '🔑', 'ti-truck': '🚚', 'ti-chart-bar': '📊', 'ti-trending': '📈', 'ti-checklist': '📋', 'ti-compass': '🧭', 'ti-robot': '🤖' }
  return map[ic] || '•'
}
