import { rl, hp } from '../lib/constants'
import { signOut } from '../supabase'

/* ═══ APP HUB — Selector de aplicación post-login ═══ */
export function AppHub({ cu, onSelect }) {
  const r = rl(cu)
  const verCompras = true // todos los roles pueden ver el ERP
  const verFinanzas = hp(cu, "ver_finanzas_app") || cu.rol === "admin"

  const apps = [
    {
      k: "compras",
      l: "ERP Compras",
      desc: "Gestión de órdenes de compra, proveedores y logística",
      ic: "📦",
      c: "#007AFF",
      bg: "#007AFF",
      visible: verCompras,
      tabs: ["Monitor", "Órdenes", "Reposición", "Forecast", "Tránsito"]
    },
    {
      k: "finanzas",
      l: "Sistema Financiero",
      desc: "Tesorería, conciliación, presupuesto y reportes",
      ic: "💰",
      c: "#34C759",
      bg: "#34C759",
      visible: verFinanzas,
      tabs: ["Dashboard", "Conciliación", "Tesorería", "Presupuesto"]
    }
  ].filter(a => a.visible)

  // Auto-seleccionar si solo hay 1 app disponible
  if (apps.length === 1) {
    onSelect(apps[0].k)
    return null
  }

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
        maxWidth: 800,
        width: "100%"
      }}>
        {apps.map(app => (
          <button
            key={app.k}
            onClick={() => onSelect(app.k)}
            style={{
              background: "#fff",
              border: "1px solid rgba(0,0,0,0.06)",
              borderRadius: 20,
              padding: "32px 24px",
              cursor: "pointer",
              textAlign: "left",
              transition: "transform 0.2s, box-shadow 0.2s",
              boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              display: "flex",
              flexDirection: "column",
              gap: 12
            }}
            onMouseOver={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)" }}
            onMouseOut={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)" }}
          >
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: app.bg + "15",
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
                  background: app.bg + "10", color: app.c
                }}>{t}</span>
              ))}
            </div>

            <div style={{
              marginTop: 8, paddingTop: 12,
              borderTop: "1px solid #F2F2F7",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              fontSize: 13, fontWeight: 600, color: app.c
            }}>
              Ingresar →
            </div>
          </button>
        ))}
      </div>

      {/* Logout */}
      <button
        onClick={async () => {
          try { await signOut() } catch (e) { }
          localStorage.removeItem("erp_cu_id")
          localStorage.removeItem("outlet_app_actual")
          window.location.reload()
        }}
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
