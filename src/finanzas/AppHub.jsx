import { useState, useEffect } from 'react'
import { supabase, signOut } from '../supabase'

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

const saludoHora = h => h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'

const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const fmtFecha = d => `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`
const semanaDelAnio = d => {
  const t = new Date(d.getFullYear(), 0, 1)
  return Math.ceil((((d - t) / 86400000) + t.getDay() + 1) / 7)
}

/* ═══ Paleta corporativa por app ═══ */
const APPS_CATALOG = {
  compras: {
    l: "ERP Compras", desc: "Órdenes, proveedores, reposición",
    ic: "ti-package", c1: "#d28a4a", c2: "#a8551b",
    bg: "#faf6ef", bgBadge: "#fcecde", txt: "#a8551b",
    tabs: ["Monitor","Órdenes","Reposición","Forecast","Tránsito"]
  },
  finanzas: {
    l: "Finanzas", desc: "Tesorería, conciliación, EERR",
    ic: "ti-coin", c1: "#5dcaa5", c2: "#1f6e54",
    bg: "#f3faf7", bgBadge: "#dff3ec", txt: "#1f6e54",
    tabs: ["Dashboard","Conciliación","Tesorería","Presupuesto"]
  },
  postventa: {
    l: "Postventa", desc: "Reclamos, NC, escalados",
    ic: "ti-tool", c1: "#9d7fff", c2: "#5847a3",
    bg: "#f8f5ff", bgBadge: "#f0e8ff", txt: "#5847a3",
    tabs: ["Dashboard","Casos","Escalados","Finanzas"]
  },
  rrhh: {
    l: "Personas", desc: "Remuneraciones, asistencia",
    ic: "ti-users", c1: "#e8728c", c2: "#a32d3f",
    bg: "#fcf5f6", bgBadge: "#fde8ec", txt: "#a32d3f",
    tabs: ["Remuneraciones","Asistencia"]
  },
  admin: {
    l: "Administración", desc: "Usuarios, accesos, apps, roles",
    ic: "ti-key", c1: "#a8a39a", c2: "#5a544b",
    bg: "#f7f5f1", bgBadge: "#ebe7e0", txt: "#5a544b",
    tabs: ["Usuarios","Accesos","Apps","Roles"]
  },
  inventario: {
    l: "Análisis de Stock", desc: "Rotación, estacionalidad, decisión",
    ic: "ti-chart-bar", c1: "#5856D6", c2: "#3d3ba3",
    bg: "#f3f3fc", bgBadge: "#e5e4f7", txt: "#3d3ba3",
    tabs: ["Dashboard","Análisis SKU","Estacionalidad","Por Sucursal","Decisión"]
  },
  logistica: {
    l: "Logística", desc: "Despachos, retiros, devoluciones",
    ic: "ti-truck", c1: "#FF9500", c2: "#cc7700",
    bg: "#fff5e6", bgBadge: "#ffe8c2", txt: "#cc7700",
    tabs: ["Próximamente"], soon: true
  },
  comercial: {
    l: "Comercial", desc: "Ventas, vendedores, comisiones",
    ic: "ti-chart-bar", c1: "#5856D6", c2: "#3d3ba3",
    bg: "#f3f3fc", bgBadge: "#e5e4f7", txt: "#3d3ba3",
    tabs: ["Próximamente"], soon: true
  }
}

function appsLegado(rol) {
  if (rol === "admin" || rol === "dir_general") return ["compras","finanzas","postventa","rrhh","admin","inventario"]
  if (rol === "dir_finanzas") return ["compras","finanzas","rrhh"]
  if (rol === "cajero") return ["finanzas"]
  return ["compras"]
}

/* ═══ APP HUB ═══ */
export function AppHub({ cu, onSelect, onLogout }) {
  const r = rl(cu)
  const [appsDisp, setAppsDisp] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())
  const [sistemaOK, setSistemaOK] = useState(true)
  const [kpis, setKpis] = useState({})
  const [showCambioPass, setShowCambioPass] = useState(false)
  const [pass, setPass] = useState("")
  const [pass2, setPass2] = useState("")
  const [passLoading, setPassLoading] = useState(false)
  const [passErr, setPassErr] = useState("")
  const [passOk, setPassOk] = useState(false)

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
          if (codigos.length === 0) setAppsDisp(appsLegado(cu.rol))
          else setAppsDisp(codigos)
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

  /* Carga KPIs de cada módulo en paralelo, con fallback silencioso */
  useEffect(() => {
    let cancel = false
    const cargarKPIs = async () => {
      const k = {}

      // ─── COMPRAS ───
      try {
        const [{ data: ocs }, { count: quiebres }, { data: ocsTransito }] = await Promise.all([
          supabase.from('ordenes_compra').select('id,estado,total_clp').not('estado','in','("Recibida OK","Anulada","Cerrada")'),
          supabase.from('productos').select('sku', { count: 'exact', head: true }).eq('stock_actual', 0).gt('vta_prom_diaria', 0),
          supabase.from('ordenes_compra').select('total_clp,estado').in('estado', ['En tránsito','En producción','Pago realizado'])
        ])
        const sumTransito = (ocsTransito || []).reduce((s, o) => s + (o.total_clp || 0), 0)
        const pendientes = (ocs || []).filter(o => /Pend/.test(o.estado || '')).length
        k.compras = {
          ocActivas: (ocs || []).length,
          ocPendientes: pendientes,
          quiebres: quiebres ?? null,
          montoTransito: sumTransito
        }
      } catch (e) { k.compras = {} }

      // ─── FINANZAS ───
      try {
        const hoyStr = new Date().toISOString().slice(0,10)
        const [{ data: cierresHoy }, { data: sucursales }, { data: movPend }] = await Promise.all([
          supabase.from('cierres_caja').select('id,fecha').eq('fecha', hoyStr),
          supabase.from('sucursales').select('id').not('codigo','is',null),
          supabase.from('movimientos_bancarios').select('monto,estado').eq('estado', 'pendiente')
        ])
        const totalSucs = (sucursales || []).length || 3
        const cierresCnt = (cierresHoy || []).length
        const sumPend = (movPend || []).reduce((s, m) => s + Math.abs(Number(m.monto) || 0), 0)
        const cntPend = (movPend || []).length
        // % match: si hay conciliados totales lo calculamos; aprox simple
        k.finanzas = {
          cierresHoy: cierresCnt,
          totalSucs,
          montoPorConciliar: sumPend,
          movPendientes: cntPend
        }
      } catch (e) { k.finanzas = {} }

      // ─── POSTVENTA ───
      try {
        const { data: casos } = await supabase
          .from('casos_postventa')
          .select('id,estado,prioridad,deleted_at,created_at')
          .is('deleted_at', null)
        const abiertos = (casos || []).filter(c => c.estado !== 'cerrado').length
        const urgentes = (casos || []).filter(c => c.estado === 'escalado' || c.prioridad === 'alta').length
        // SLA promedio en días (casos abiertos: días desde creación)
        const dias = (casos || []).filter(c => c.estado !== 'cerrado').map(c => {
          const ms = Date.now() - new Date(c.created_at).getTime()
          return ms / 86400000
        })
        const slaProm = dias.length ? (dias.reduce((s,v) => s+v, 0) / dias.length) : null
        k.postventa = { abiertos, urgentes, slaProm }
      } catch (e) { k.postventa = {} }

      // ─── RRHH ───
      try {
        const [{ data: emps }, { data: metricas }] = await Promise.all([
          supabase.from('rrhh_empleados').select('cod_contaline,activo'),
          supabase.from('v_rrhh_metricas').select('*')
        ])
        const activos = (emps || []).filter(e => e.activo !== false).length
        const periodos = [...new Set((metricas || []).map(m => m.periodo))].sort()
        const ultimo = periodos[periodos.length - 1]
        const mUlt = (metricas || []).find(m => m.periodo === ultimo) || {}
        k.rrhh = {
          empleados: activos,
          liquidUltimo: mUlt.total_haberes || mUlt.total_costo_empresa || null,
          periodoUlt: ultimo || null
        }
      } catch (e) { k.rrhh = {} }

      // ─── ADMIN ───
      try {
        const [{ count: usrCnt }, { count: rolCnt }] = await Promise.all([
          supabase.from('usuarios').select('id', { count: 'exact', head: true }).eq('activo', true),
          supabase.from('roles_app').select('id', { count: 'exact', head: true })
        ])
        k.admin = { usuarios: usrCnt ?? null, roles: rolCnt ?? null }
      } catch (e) { k.admin = {} }

      // ─── Ping sistema ───
      try {
        const { error } = await supabase.from('apps').select('codigo', { head: true, count: 'exact' }).limit(1)
        if (!cancel) setSistemaOK(!error)
      } catch (e) { if (!cancel) setSistemaOK(false) }

      if (!cancel) setKpis(k)
    }
    cargarKPIs()
    return () => { cancel = true }
  }, [cu.id])

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

  // Auto-seleccionar si solo hay 1 app
  useEffect(() => {
    if (!loading && appsDisp.length === 1) {
      const codigo = appsDisp[0]
      const app = APPS_CATALOG[codigo]
      if (app && !app.soon) onSelect(codigo)
    }
  }, [loading, appsDisp, onSelect])

  const handleLogout = async () => {
    if (typeof onLogout === 'function') { onLogout(); return }
    try { await signOut() } catch (e) {}
    try { localStorage.removeItem("erp_cu_id") } catch (e) {}
    try { localStorage.removeItem("outlet_app_actual") } catch (e) {}
    window.location.reload()
  }

  /* Loading state */
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5efe4", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width:48, height:48, borderRadius:12, background:"linear-gradient(135deg,#d28a4a,#a8551b)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 12px" }}>
            <span style={{ fontSize:24, color:"#fff" }}>🚪</span>
          </div>
          <div style={{ fontSize: 13, color: "#8b7355" }}>Cargando aplicaciones...</div>
        </div>
      </div>
    )
  }

  const apps = appsDisp.map(k => ({ k, ...APPS_CATALOG[k] })).filter(a => a.l)
  const iniciales = (cu.nombre || cu.correo || 'U').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')

  /* KPIs por card */
  const kpisByApp = {
    compras: [
      { v: fmtNum(kpis.compras?.ocActivas), l: 'OC activas', highlight: true },
      { v: fmtNum(kpis.compras?.quiebres), l: 'Quiebres', danger: kpis.compras?.quiebres > 0 },
      { v: fmtCLP(kpis.compras?.montoTransito), l: 'En tránsito' }
    ],
    finanzas: [
      { v: kpis.finanzas?.cierresHoy != null ? `${kpis.finanzas.cierresHoy}/${kpis.finanzas.totalSucs}` : '—', l: 'Cajas hoy', highlight: true },
      { v: fmtCLP(kpis.finanzas?.montoPorConciliar), l: 'x conciliar' },
      { v: fmtNum(kpis.finanzas?.movPendientes), l: 'Mov. pend.' }
    ],
    postventa: [
      { v: fmtNum(kpis.postventa?.abiertos), l: 'Abiertos', highlight: true },
      { v: fmtNum(kpis.postventa?.urgentes), l: 'Urgentes', danger: kpis.postventa?.urgentes > 0 },
      { v: kpis.postventa?.slaProm != null ? kpis.postventa.slaProm.toFixed(1) + 'd' : '—', l: 'SLA prom' }
    ],
    rrhh: [
      { v: fmtNum(kpis.rrhh?.empleados), l: 'Empleados', highlight: true },
      { v: fmtCLP(kpis.rrhh?.liquidUltimo), l: 'Líquido' },
      { v: kpis.rrhh?.periodoUlt || '—', l: 'Periodo' }
    ],
    admin: [
      { v: fmtNum(kpis.admin?.usuarios), l: 'Usuarios', highlight: true },
      { v: fmtNum(kpis.admin?.roles), l: 'Roles' }
    ],
    inventario: [
      { v: '—', l: 'SKU analizados' },
      { v: '—', l: 'Quiebres' },
      { v: '—', l: 'Dead stock' }
    ]
  }

  /* Badge dinámico por card */
  const badgeForApp = (k) => {
    if (k === 'compras') {
      const p = kpis.compras?.ocPendientes
      if (p > 0) return { txt: `${p} pendientes`, dot: true }
      return { txt: 'Al día', dot: true }
    }
    if (k === 'finanzas') {
      const c = kpis.finanzas?.cierresHoy
      const t = kpis.finanzas?.totalSucs
      if (c != null && t && c >= t) return { txt: 'Al día', dot: true }
      if (c != null && t) return { txt: `${t - c} pend.`, dot: true }
      return { txt: 'Tesorería', dot: false }
    }
    if (k === 'postventa') {
      const u = kpis.postventa?.urgentes
      if (u > 0) return { txt: `${u} urgentes`, dot: true }
      return { txt: 'Sin urgencias', dot: true }
    }
    if (k === 'rrhh') {
      return { txt: kpis.rrhh?.periodoUlt ? `Periodo ${kpis.rrhh.periodoUlt}` : 'RRHH', dot: false }
    }
    if (k === 'admin') return { txt: 'Solo Admin', dot: false }
    return null
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f5efe4",
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
      display: "flex"
    }}>
      {/* ═══ SIDEBAR ═══ */}
      <aside style={{
        width: 260,
        background: "linear-gradient(180deg,#2a1f15 0%,#1a1410 100%)",
        padding: "22px 16px",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        minHeight: "100vh",
        position: "sticky",
        top: 0
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 38, height: 38, borderRadius: 9, background: "linear-gradient(135deg,#d28a4a,#a8551b)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(168,85,27,0.4)", fontSize: 20 }}>
            🚪
          </div>
          <div>
            <div style={{ color: "#f4e9d8", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>Outlet</div>
            <div style={{ color: "#a08b6f", fontSize: 10, letterSpacing: "0.05em" }}>de Puertas SpA</div>
          </div>
        </div>

        {/* Reloj en vivo */}
        <div style={{ background: "#241a13", borderRadius: 12, padding: 14, marginBottom: 14, border: "1px solid #3a2d1f" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#a08b6f", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5dcaa5", boxShadow: "0 0 6px #5dcaa5" }} /> Ahora
          </div>
          <div style={{ color: "#f4e9d8", fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
            {hh}:{mm}<span style={{ color: "#5f4a35", fontSize: 18 }}>:{ss}</span>
          </div>
          <div style={{ color: "#c97b3a", fontSize: 11, marginTop: 2, textTransform: "capitalize" }}>{fmtFecha(now)}</div>
          <div style={{ color: "#5f4a35", fontSize: 10, marginTop: 1 }}>Semana {semanaDelAnio(now)} · {now.getFullYear()}</div>
        </div>

        {/* Usuario */}
        <div style={{ background: "#241a13", borderRadius: 12, padding: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#d28a4a,#a8551b)", color: "#1a1410", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {iniciales}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#f4e9d8", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cu.nombre || 'Usuario'}</div>
            <div style={{ color: r.c, fontSize: 10, fontWeight: 600 }}>{r.l}</div>
          </div>
        </div>

        {/* KPIs ejecutivos */}
        <div style={{ color: "#5f4a35", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: sistemaOK ? "#5dcaa5" : "#e24b4a" }} /> Estado hoy
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <KPIRow label="OC activas" value={fmtNum(kpis.compras?.ocActivas)} color="#c97b3a" />
          <KPIRow label="Quiebres SKU" value={fmtNum(kpis.compras?.quiebres)} color="#e24b4a" />
          <KPIRow label="Cierres caja" value={kpis.finanzas?.cierresHoy != null ? `${kpis.finanzas.cierresHoy}/${kpis.finanzas.totalSucs}` : '—'} color="#5dcaa5" />
          <KPIRow label="Casos PV" value={fmtNum(kpis.postventa?.abiertos)} color="#9d7fff" />
        </div>

        {/* Acciones */}
        <div style={{ marginTop: "auto", paddingTop: 16, display: "flex", gap: 6 }}>
          <button onClick={() => { setShowCambioPass(true); setPass(""); setPass2(""); setPassErr(""); setPassOk(false) }}
            style={{ flex: 1, background: "transparent", border: "1px solid #3a2d1f", borderRadius: 9, padding: 8, color: "#a08b6f", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
            🔑 Clave
          </button>
          <button onClick={handleLogout}
            style={{ flex: 1, background: "transparent", border: "1px solid #3a2d1f", borderRadius: 9, padding: 8, color: "#a08b6f", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
            ↩ Salir
          </button>
        </div>
      </aside>

      {/* ═══ ÁREA APPS ═══ */}
      <main style={{ flex: 1, padding: 28, overflow: "hidden" }}>

        {/* Header saludo */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24, maxWidth: 1100 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#2a1f15", letterSpacing: "-0.02em" }}>
              {saludoHora(now.getHours())} {(cu.nombre || '').split(' ')[0]}
            </div>
            <div style={{ color: "#8b7355", fontSize: 12, marginTop: 3 }}>
              {apps.length} aplicaciones disponibles · personalizado por tu rol
            </div>
          </div>
          <div style={{ background: "#fff", border: "1px solid #ebe2d0", borderRadius: 20, padding: "5px 12px", fontSize: 11, color: "#5a4a35", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: sistemaOK ? "#5dcaa5" : "#e24b4a", boxShadow: sistemaOK ? "0 0 6px #5dcaa5" : "0 0 6px #e24b4a" }} />
            {sistemaOK ? "Sistema operativo" : "Sistema sin conexión"}
          </div>
        </div>

        {/* Grid apps con KPIs ricos */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, maxWidth: 1100 }}>
          {apps.map(app => (
            <AppCard
              key={app.k}
              app={app}
              kpis={kpisByApp[app.k] || []}
              badge={badgeForApp(app.k)}
              onSelect={() => !app.soon && onSelect(app.k)}
            />
          ))}
        </div>
      </main>

      {/* Modal cambio password */}
      {showCambioPass && (
        <div onClick={() => setShowCambioPass(false)} style={{ position: "fixed", inset: 0, background: "rgba(26,20,16,0.6)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, width: "100%", maxWidth: 420, boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: "#2a1f15" }}>Cambiar contraseña</div>
                <div style={{ fontSize: 11, color: "#8b7355", marginTop: 2 }}>{cu.correo}</div>
              </div>
              <button onClick={() => setShowCambioPass(false)} style={{ width: 30, height: 30, borderRadius: 15, background: "#f5efe4", border: "none", cursor: "pointer", fontSize: 14, color: "#8b7355" }}>×</button>
            </div>
            {passOk ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ width: 48, height: 48, borderRadius: 24, background: "#dff3ec", color: "#1f6e54", margin: "0 auto 8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>✓</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1f6e54" }}>Contraseña actualizada</div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#5a4a35", marginBottom: 5 }}>Nueva contraseña</label>
                  <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="Mínimo 8 caracteres"
                    style={{ width: "100%", padding: "10px 13px", borderRadius: 9, border: "1px solid #ebe2d0", fontSize: 13, outline: "none", boxSizing: "border-box", background: "#faf6ef" }} autoFocus />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#5a4a35", marginBottom: 5 }}>Confirmar</label>
                  <input type="password" value={pass2} onChange={e => setPass2(e.target.value)} placeholder="Repite la contraseña"
                    style={{ width: "100%", padding: "10px 13px", borderRadius: 9, border: "1px solid #ebe2d0", fontSize: 13, outline: "none", boxSizing: "border-box", background: "#faf6ef" }}
                    onKeyDown={e => e.key === "Enter" && guardarPassword()} />
                </div>
                {pass.length > 0 && pass2.length > 0 && pass === pass2 && (
                  <div style={{ color: "#1f6e54", fontSize: 11, marginBottom: 10 }}>✓ Las contraseñas coinciden</div>
                )}
                {passErr && (
                  <div style={{ color: "#a32d3f", fontSize: 12, marginBottom: 10, padding: "8px 12px", background: "#fde8ec", borderRadius: 8 }}>{passErr}</div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
                  <button onClick={() => setShowCambioPass(false)} style={{ padding: "9px 16px", borderRadius: 9, background: "#f5efe4", color: "#5a4a35", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
                  <button disabled={!pass || !pass2 || passLoading} onClick={guardarPassword}
                    style={{ padding: "9px 16px", borderRadius: 9, background: (!pass || !pass2 || passLoading) ? "#a08b6f" : "linear-gradient(135deg,#d28a4a,#a8551b)", color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: (!pass || !pass2 || passLoading) ? "default" : "pointer" }}>
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

/* ═══ Componentes internos ═══ */

function KPIRow({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 11px", background: "#241a13", borderRadius: 9, borderLeft: `2px solid ${color}` }}>
      <span style={{ color: "#a08b6f", fontSize: 11 }}>{label}</span>
      <span style={{ color, fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  )
}

function AppCard({ app, kpis, badge, onSelect }) {
  const [hover, setHover] = useState(false)
  const fullWidth = app.k === 'admin'

  if (fullWidth) {
    return (
      <button onClick={onSelect}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{
          background: "#fff", borderRadius: 14, padding: "14px 16px", border: "1px solid #ebe2d0",
          cursor: app.soon ? "default" : "pointer", gridColumn: "span 2",
          display: "flex", alignItems: "center", gap: 14, position: "relative", overflow: "hidden",
          opacity: app.soon ? 0.55 : 1, textAlign: "left",
          transform: hover && !app.soon ? "translateY(-2px)" : "none",
          boxShadow: hover && !app.soon ? "0 8px 20px rgba(168,85,27,0.12)" : "0 1px 3px rgba(0,0,0,0.03)",
          transition: "all 0.2s"
        }}>
        <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, background: `linear-gradient(180deg,${app.c1},${app.c2})` }} />
        <div style={{ width: 40, height: 40, borderRadius: 11, background: `linear-gradient(135deg,${app.c1},${app.c2})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 20 }}>
          {iconFor(app.ic)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#2a1f15" }}>{app.l}</div>
          <div style={{ fontSize: 10, color: "#8b7355", marginTop: 1 }}>{app.desc}</div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {kpis.map((k, i) => (
            <div key={i} style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: app.txt, fontVariantNumeric: "tabular-nums" }}>{k.v}</div>
              <div style={{ fontSize: 9, color: "#8b7355" }}>{k.l}</div>
            </div>
          ))}
        </div>
        <span style={{ fontSize: 16, color: app.txt }}>→</span>
      </button>
    )
  }

  return (
    <button onClick={onSelect} disabled={app.soon}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #ebe2d0",
        cursor: app.soon ? "default" : "pointer", position: "relative", overflow: "hidden",
        opacity: app.soon ? 0.55 : 1, textAlign: "left", display: "block",
        transform: hover && !app.soon ? "translateY(-3px)" : "none",
        boxShadow: hover && !app.soon ? `0 12px 24px ${app.c1}25` : "0 1px 3px rgba(0,0,0,0.03)",
        transition: "all 0.2s"
      }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${app.c1},${app.c2})` }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: `linear-gradient(135deg,${app.c1},${app.c2})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 22, boxShadow: `0 4px 10px ${app.c1}30` }}>
          {iconFor(app.ic)}
        </div>
        {badge && (
          <div style={{ background: app.bgBadge, color: app.txt, fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4 }}>
            {badge.dot && <span style={{ width: 4, height: 4, borderRadius: "50%", background: app.txt }} />}
            {badge.txt}
          </div>
        )}
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, color: "#2a1f15" }}>{app.l}</div>
      <div style={{ fontSize: 10, color: "#8b7355", marginTop: 2, marginBottom: 11 }}>{app.desc}</div>

      {!app.soon && kpis.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${kpis.length}, 1fr)`, gap: 6, padding: 9, background: app.bg, borderRadius: 8 }}>
          {kpis.map((k, i) => (
            <div key={i}>
              <div style={{ fontSize: 14, fontWeight: 700, color: k.danger ? "#e24b4a" : (k.highlight ? app.txt : "#2a1f15"), fontVariantNumeric: "tabular-nums" }}>{k.v}</div>
              <div style={{ fontSize: 9, color: "#8b7355" }}>{k.l}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 11, display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: "1px dashed #ebe2d0" }}>
        <div style={{ fontSize: 10, color: "#5f4a35", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "60%" }}>
          {app.tabs.slice(0, 3).join(" · ")}
        </div>
        <div style={{ fontSize: 11, color: app.soon ? "#8b7355" : app.txt, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
          {app.soon ? "Próximamente" : <>Ingresar <span>→</span></>}
        </div>
      </div>
    </button>
  )
}

/* Mapeo simple de iconos a emoji corporativo */
function iconFor(ic) {
  const map = {
    'ti-package': '📦',
    'ti-coin': '💰',
    'ti-tool': '🛠',
    'ti-users': '👥',
    'ti-key': '🔑',
    'ti-truck': '🚚',
    'ti-chart-bar': '📈'
  }
  return map[ic] || '•'
}
