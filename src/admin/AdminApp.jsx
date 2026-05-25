import { useState, useEffect } from 'react'
import { supabase, signOut } from '../supabase'
import { AdminUsuarios } from './AdminUsuarios'
import { AdminAccesos } from './AdminAccesos'
import { AdminApps } from './AdminApps'
import { AdminRoles } from './AdminRoles'
import { AdminPermisos } from './AdminPermisos'

const ROLES = [
  { k: "admin",            l: "Admin",            c: "var(--danger)" },
  { k: "dir_general",      l: "Dir. General",     c: "var(--danger)" },
  { k: "dir_finanzas",     l: "Dir. Finanzas",    c: "var(--purple)" },
  { k: "dir_negocios",     l: "Dir. Negocios",    c: "var(--accent)" },
  { k: "dir_operaciones",  l: "Dir. Operaciones", c: "var(--info)" },
  { k: "analista",         l: "Analista",         c: "var(--success)" },
  { k: "jefe_bodega",      l: "Jefe Bodega",      c: "var(--warning)" },
  { k: "jefe_operaciones", l: "Jefe Operaciones", c: "var(--warning)" },
  { k: "directorio",       l: "Directorio",       c: "var(--text-muted)" },
  { k: "cajero",           l: "Cajero/Vendedor",  c: "var(--success)" }
]
const rl = u => ROLES.find(r => r.k === u?.rol) || ROLES[5]

const ADMIN_TABS = [
  { k: "usuarios", l: "Usuarios", ic: "👥", desc: "Crear, editar y desactivar usuarios" },
  { k: "accesos",  l: "Accesos",  ic: "🔐", desc: "Matriz de acceso usuario × aplicación" },
  { k: "apps",     l: "Apps",     ic: "📱", desc: "Activar o desactivar aplicaciones" },
  { k: "roles",    l: "Roles",    ic: "🎭", desc: "Catálogo de roles y permisos por app" },
  { k: "permisos", l: "Permisos",  ic: "🔑", desc: "Gestionar capabilities por rol" }
]

/* ═══ ADMIN APP — Componente raíz del módulo de administración ═══ */
export function AdminApp({ cu, setAppActual }) {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem("admin_tab") || "usuarios" } catch (e) { return "usuarios" }
  })
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  )
  const [verificandoAcceso, setVerificandoAcceso] = useState(true)
  const [tieneAcceso, setTieneAcceso] = useState(false)

  // Verificación de acceso al cargar
  useEffect(() => {
    let cancel = false
    const verificar = async () => {
      try {
        const { data, error } = await supabase
          .from('usuario_acceso')
          .select('app_codigo')
          .eq('usuario_id', cu.id)
          .eq('app_codigo', 'admin')
          .eq('activo', true)
          .maybeSingle()
        if (cancel) return
        if (error || !data) {
          // Fallback legado: admin y dir_general pueden entrar
          setTieneAcceso(cu.rol === 'admin' || cu.rol === 'dir_general')
        } else {
          setTieneAcceso(true)
        }
      } catch (e) {
        if (!cancel) setTieneAcceso(cu.rol === 'admin' || cu.rol === 'dir_general')
      } finally {
        if (!cancel) setVerificandoAcceso(false)
      }
    }
    verificar()
    return () => { cancel = true }
  }, [cu.id, cu.rol])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    try { localStorage.setItem("admin_tab", tab) } catch (e) { }
  }, [tab])

  const r = rl(cu)

  const cambiarApp = () => {
    try { localStorage.removeItem("outlet_app_actual") } catch (e) { }
    setAppActual(null)
  }

  const cerrarSesion = async () => {
    try { await signOut() } catch (e) { }
    try { localStorage.removeItem("erp_cu_id") } catch (e) { }
    try { localStorage.removeItem("outlet_app_actual") } catch (e) { }
    window.location.reload()
  }

  // Loading mientras verifica acceso
  if (verificandoAcceso) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-hover)", fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔑</div>
          <div style={{ fontSize: 14, color: "var(--text-muted)" }}>Verificando acceso...</div>
        </div>
      </div>
    )
  }

  // Bloqueo: no tiene acceso
  if (!tieneAcceso) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-hover)", fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif", padding: 20 }}>
        <div style={{ textAlign: "center", maxWidth: 420, background: "var(--bg-surface)", padding: 40, borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Acceso denegado</div>
          <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 24, lineHeight: 1.5 }}>
            No tienes permiso para acceder al módulo de Administración. Solo administradores autorizados pueden ingresar aquí.
          </div>
          <button onClick={cambiarApp} style={{ padding: "10px 20px", borderRadius: 12, background: "var(--accent)", color: "var(--bg-surface)", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            ← Volver al inicio
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
      margin: 0,
      padding: isMobile ? "0 10px calc(90px + env(safe-area-inset-bottom))" : "0 20px calc(100px + env(safe-area-inset-bottom))",
      background: "var(--bg-hover)",
      minHeight: "100vh",
      fontSize: 14
    }}>
      <style>{`
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:var(--bg-hover);overflow-x:hidden}
        input:focus,select:focus,textarea:focus{border-color:var(--text-primary)!important;box-shadow:0 0 0 3px rgba(28,28,30,0.1)}
        ::selection{background:var(--text-primary);color:var(--bg-surface)}
        ::-webkit-scrollbar{width:10px;height:10px}
        ::-webkit-scrollbar-track{background:var(--bg-hover);border-radius:5px}
        ::-webkit-scrollbar-thumb{background:var(--border-3);border-radius:5px;border:2px solid var(--bg-hover)}
        ::-webkit-scrollbar-thumb:hover{background:var(--text-muted)}
        table{font-size:13px}
        th,td{white-space:nowrap}
      `}</style>

      {/* HEADER */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(242,242,247,0.92)", backdropFilter: "blur(20px)", padding: "14px 0 10px", marginBottom: 10, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🔑</div>
              <div>
                <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>Administración</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Gestión de usuarios y accesos ERP</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {!isMobile && <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, background: "var(--bg-surface)", border: "1px solid var(--border-2)" }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: r.c }} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{cu?.nombre}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· {r.l}</span>
            </div>}
            <button onClick={cambiarApp} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: isMobile ? "6px 8px" : "6px 10px", borderRadius: 10, background: "var(--purple-bg)", border: "none", cursor: "pointer", color: "var(--purple)", minWidth: isMobile ? 42 : 56 }} title="Cambiar de aplicación">
              <span style={{ fontSize: isMobile ? 13 : 14, lineHeight: 1 }}>⊞</span>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.02em" }}>Apps</span>
            </button>
            <button onClick={cerrarSesion} style={{ width: isMobile ? 34 : 36, height: isMobile ? 34 : 36, borderRadius: 10, background: "var(--danger-bg)", border: "none", cursor: "pointer", fontSize: 13, color: "var(--danger)" }} title="Cerrar sesión">⏻</button>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, background: "var(--border-2)", borderRadius: 10, padding: 3, overflowX: "auto" }}>
        {ADMIN_TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            flex: isMobile ? "0 0 auto" : 1,
            padding: isMobile ? "10px 14px" : "10px 12px",
            borderRadius: 8,
            fontSize: isMobile ? 13 : 13,
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
            background: tab === t.k ? "var(--bg-surface)" : "transparent",
            color: tab === t.k ? "var(--text-primary)" : "var(--text-muted)",
            boxShadow: tab === t.k ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6
          }}>
            <span>{t.ic}</span>
            <span>{t.l}</span>
          </button>
        ))}
      </div>

      {/* CONTENT */}
      {tab === "usuarios" && <AdminUsuarios cu={cu} isMobile={isMobile} />}
      {tab === "accesos"  && <AdminAccesos cu={cu} isMobile={isMobile} />}
      {tab === "apps"     && <AdminApps cu={cu} isMobile={isMobile} />}
      {tab === "roles"    && <AdminRoles cu={cu} isMobile={isMobile} />}
      {tab === "permisos" && <AdminPermisos cu={cu} isMobile={isMobile} />}
    </div>
  )
}
