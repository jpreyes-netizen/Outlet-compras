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

/* ═══ Catálogo de apps disponibles (espejo de tabla apps en Supabase) ═══ */
const APPS_CATALOG = {
  compras:   { l: "ERP Compras",        desc: "Gestión de órdenes de compra, proveedores y logística", ic: "📦", c: "#007AFF", tabs: ["Monitor","Órdenes","Reposición","Forecast","Tránsito"] },
  finanzas:  { l: "Sistema Financiero", desc: "Tesorería, conciliación, presupuesto y reportes",       ic: "💰", c: "#34C759", tabs: ["Dashboard","Conciliación","Tesorería","Presupuesto"] },
  admin:     { l: "Administración",     desc: "Usuarios, matriz de acceso y configuración global",     ic: "🔑", c: "#1C1C1E", tabs: ["Usuarios","Accesos","Apps","Roles"] },
  logistica: { l: "Logística",          desc: "Despachos, retiros, devoluciones — próximamente",       ic: "🚚", c: "#FF9500", tabs: ["Próximamente"], soon: true },
  postventa: { l: "Postventa",          desc: "Reclamos, NC, casos de cliente — próximamente",         ic: "🛠", c: "#AF52DE", tabs: ["Próximamente"], soon: true },
  rrhh:      { l: "Gestión de Personas",desc: "Contratos, dotación, turnos — próximamente",            ic: "👥", c: "#FF3B30", tabs: ["Próximamente"], soon: true },
  comercial: { l: "Comercial",          desc: "Ventas, vendedores, comisiones — próximamente",          ic: "📈", c: "#5856D6", tabs: ["Próximamente"], soon: true }
}

/* ═══ Fallback legado: si no hay matriz, qué apps mostrar según usuarios.rol ═══ */
function appsLegado(rol) {
  if (rol === "admin" || rol === "dir_general") return ["compras","finanzas","admin"]
  if (rol === "dir_finanzas") return ["compras","finanzas"]
  if (rol === "cajero") return ["finanzas"]
  return ["compras"]
}

/* ═══ APP HUB — Selector de aplicación post-login ═══ */
export function AppHub({ cu, onSelect, onLogout }) {
  const r = rl(cu)
  const [appsDisp, setAppsDisp] = useState([])
  const [loading, setLoading] = useState(true)

  // Carga apps disponibles desde la matriz (con fallback legado)
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
          // Fallback: usa el rol legado
          setAppsDisp(appsLegado(cu.rol))
        } else {
          // Solo apps activas
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

  // Auto-seleccionar si solo hay 1 app
  useEffect(() => {
    if (!loading && appsDisp.length === 1) {
      const codigo = appsDisp[0]
      const app = APPS_CATALOG[codigo]
      if (app && !app.soon) onSelect(codigo)
    }
  }, [loading, appsDisp, onSelect])

  // Logout: usa onLogout si viene como prop, sino fallback al comportamiento histórico
  const handleLogout = async () => {
    if (typeof onLogout === 'function') {
      onLogout()
      return
    }
    try { await signOut() } catch (e) {}
    try { localStorage.removeItem("erp_cu_id") } catch (e) {}
    try { localStorage.removeItem("outlet_app_actual") } catch (e) {}
    window.location.reload()
  }

  // Loading state
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #F2F2F7 0%, #E5E5EA 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
          <div style={{ fontSize: 14, color: "#8E8E93" }}>Cargando aplicaciones...</div>
        </div>
      </div>
    )
  }

  const apps = appsDisp.map(k => ({ k, ...APPS_CATALOG[k] })).filter(a => a.l)

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #F2F2F7 0%, #E5E5EA 100%)",
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
      padding: "40px 20px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center"
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 40, maxWidth: 720 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🏢</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.03em" }}>
          Outlet de Puertas
        </div>
        <div style={{ fontSize: 14, color: "#8E8E93", marginTop: 4 }}>
          Hola, {cu.nombre} · <span style={{ color: r.c, fontWeight: 600 }}>{r.l}</span>
        </div>
        <div style={{ fontSize: 13, color: "#8E8E93", marginTop: 16 }}>
          Selecciona la aplicación que deseas usar
        </div>
      </div>

      {/* App cards */}
      <div style={{
        display: "grid",
        gridTemplateColumns: apps.length === 1 ? "1fr" : "repeat(auto-fit, minmax(280px, 360px))",
        gap: 20,
        maxWidth: 1100,
        width: "100%"
      }}>
        {apps.map(app => (
          <button
            key={app.k}
            disabled={app.soon}
            onClick={() => !app.soon && onSelect(app.k)}
            style={{
              background: "#fff",
              border: "1px solid rgba(0,0,0,0.06)",
              borderRadius: 20,
              padding: "32px 24px",
              cursor: app.soon ? "default" : "pointer",
              textAlign: "left",
              transition: "transform 0.2s, box-shadow 0.2s",
              boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              opacity: app.soon ? 0.55 : 1
            }}
            onMouseOver={e => { if (!app.soon) { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)" } }}
            onMouseOut={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)" }}
          >
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: app.c + "15",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28
            }}>{app.ic}</div>

            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#1C1C1E", letterSpacing: "-0.02em" }}>
                {app.l}
              </div>
              <div style={{ fontSize: 13, color: "#8E8E93", marginTop: 4, lineHeight: 1.4 }}>
                {app.desc}
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {app.tabs.map(t => (
                <span key={t} style={{
                  fontSize: 11, fontWeight: 600,
                  padding: "3px 9px", borderRadius: 100,
                  background: app.c + "10", color: app.c
                }}>{t}</span>
              ))}
            </div>

            <div style={{
              marginTop: 8, paddingTop: 12,
              borderTop: "1px solid #F2F2F7",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              fontSize: 13, fontWeight: 600, color: app.soon ? "#8E8E93" : app.c
            }}>
              {app.soon ? "Próximamente" : "Ingresar →"}
            </div>
          </button>
        ))}
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        style={{
          marginTop: 32,
          padding: "10px 20px",
          background: "transparent",
          border: "1px solid #E5E5EA",
          borderRadius: 10,
          fontSize: 13,
          color: "#8E8E93",
          cursor: "pointer"
        }}
      >
        Cerrar sesión
      </button>
    </div>
  )
}
