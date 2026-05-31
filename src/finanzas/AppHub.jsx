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
  admin:     { l: "Administración",     desc: "Usuarios, matriz de acceso y gestión del ERP",          ic: "🔑", c: "#1C1C1E", tabs: ["Usuarios","Accesos","Apps","Roles"] },
  logistica: { l: "Logística",          desc: "Despachos, retiros, devoluciones — próximamente",       ic: "🚚", c: "#FF9500", tabs: ["Próximamente"], soon: true },
  postventa: { l: "Postventa",          desc: "Reclamos, NC, casos y seguimiento de cliente",           ic: "🛠", c: "#AF52DE", tabs: ["Dashboard","Casos","Escalados","Finanzas"] },
  rrhh:      { l: "Gestión de Personas",desc: "Remuneraciones y control de asistencia",                ic: "👥", c: "#FF3B30", tabs: ["Remuneraciones","Asistencia"] },
  comercial: { l: "Comercial",          desc: "Ventas, vendedores, comisiones — próximamente",          ic: "📈", c: "#5856D6", tabs: ["Próximamente"], soon: true }
}

/* ═══ Fallback legado: si no hay matriz, qué apps mostrar según usuarios.rol ═══ */
function appsLegado(rol) {
  if (rol === "admin" || rol === "dir_general") return ["compras","finanzas","admin","rrhh"]
  if (rol === "dir_finanzas") return ["compras","finanzas","rrhh"]
  if (rol === "cajero") return ["finanzas"]
  return ["compras"]
}

/* ═══ APP HUB — Selector de aplicación post-login ═══ */
export function AppHub({ cu, onSelect, onLogout }) {
  const r = rl(cu)
  const [appsDisp, setAppsDisp] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCambioPass, setShowCambioPass] = useState(false)
  const [pass, setPass] = useState("")
  const [pass2, setPass2] = useState("")
  const [passLoading, setPassLoading] = useState(false)
  const [passErr, setPassErr] = useState("")
  const [passOk, setPassOk] = useState(false)

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

  const guardarPassword = async () => {
    if (pass.length < 8) { setPassErr('Minimo 8 caracteres'); return }
    if (pass !== pass2) { setPassErr('Las contrasenas no coinciden'); return }
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
      {/* Acciones footer */}
      <div style={{ marginTop: 32, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <button onClick={() => { setShowCambioPass(true); setPass(""); setPass2(""); setPassErr(""); setPassOk(false) }} style={{ padding: "10px 20px", background: "transparent", border: "1px solid #E5E5EA", borderRadius: 10, fontSize: 13, color: "#3A3A3C", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <span>🔑</span> Cambiar contraseña
        </button>
        <button onClick={handleLogout} style={{ padding: "10px 20px", background: "transparent", border: "1px solid #E5E5EA", borderRadius: 10, fontSize: 13, color: "#8E8E93", cursor: "pointer" }}>
          Cerrar sesión
        </button>
      </div>

      {/* Modal cambio de password */}
      {showCambioPass && (
        <div onClick={() => setShowCambioPass(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, padding: 32, width: "100%", maxWidth: 420, boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 700, color: "#1C1C1E" }}>Cambiar contraseña</div>
                <div style={{ fontSize: 12, color: "#8E8E93", marginTop: 2 }}>{cu.correo}</div>
              </div>
              <button onClick={() => setShowCambioPass(false)} style={{ width: 32, height: 32, borderRadius: 16, background: "#F2F2F7", border: "none", cursor: "pointer", fontSize: 14 }}>×</button>
            </div>
            {passOk ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#34C759" }}>Contraseña actualizada</div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#3A3A3C", marginBottom: 6 }}>Nueva contraseña</label>
                  <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="Mínimo 8 caracteres" style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #E5E5EA", fontSize: 14, outline: "none", boxSizing: "border-box" }} autoFocus />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#3A3A3C", marginBottom: 6 }}>Confirmar contraseña</label>
                  <input type="password" value={pass2} onChange={e => setPass2(e.target.value)} placeholder="Repite la contraseña" style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid #E5E5EA", fontSize: 14, outline: "none", boxSizing: "border-box" }} onKeyDown={e => e.key === "Enter" && guardarPassword()} />
                </div>
                {pass.length > 0 && pass2.length > 0 && pass === pass2 && (
                  <div style={{ color: "#34C759", fontSize: 12, marginBottom: 10 }}>✓ Las contraseñas coinciden</div>
                )}
                {passErr && (
                  <div style={{ color: "#FF3B30", fontSize: 13, marginBottom: 12, padding: "10px 14px", background: "#FF3B3008", borderRadius: 10, border: "1px solid #FF3B3020" }}>{passErr}</div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                  <button onClick={() => setShowCambioPass(false)} style={{ padding: "10px 18px", borderRadius: 10, background: "#F2F2F7", color: "#3A3A3C", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
                  <button disabled={!pass || !pass2 || passLoading} onClick={guardarPassword} style={{ padding: "10px 18px", borderRadius: 10, background: (!pass || !pass2 || passLoading) ? "#8E8E93" : "#1C1C1E", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: (!pass || !pass2 || passLoading) ? "default" : "pointer" }}>{passLoading ? "Guardando..." : "Guardar"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
