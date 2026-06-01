import { useState, useEffect } from 'react'
import { supabase, signOut } from '../supabase'
import { preloadCaps, canSync } from '../core/permisos'
import { FinDashboard } from './FinDashboard'
import { FinConciliacion } from './FinConciliacion'
import { FinTesoreria } from './FinTesoreria'
import { FinPresupuesto } from './FinPresupuesto'
import { GmDashboard } from './gastos_menores/GmDashboard'
import { GmMovimientos } from './gastos_menores/GmMovimientos'
import { Toaster } from 'sonner'

const ROLES=[
  {k:"admin",l:"Admin",c:"#FF3B30"},{k:"dir_general",l:"Dir. General",c:"#FF3B30"},
  {k:"dir_finanzas",l:"Dir. Finanzas",c:"#AF52DE"},{k:"dir_negocios",l:"Dir. Negocios",c:"#007AFF"},
  {k:"dir_operaciones",l:"Dir. Operaciones",c:"#5AC8FA"},{k:"analista",l:"Analista",c:"#34C759"},
  {k:"jefe_bodega",l:"Jefe Bodega",c:"#FF9500"},{k:"jefe_operaciones",l:"Jefe Operaciones",c:"#FF9500"},
  {k:"directorio",l:"Directorio",c:"#8E8E93"}
]
const rl = u => ROLES.find(r => r.k === u?.rol) || ROLES[5]

/* ═══ FINANZAS APP — Componente raíz del sistema financiero ═══ */

// RBAC-4: tabs vinculados a capabilities en vez de roles hardcodeados
const ALL_FIN_TABS = [
  { k: "dashboard",    l: "Dashboard",    ic: "📊", cap: "fin.dashboard" },
  { k: "conciliacion", l: "Conciliación", ic: "🔄", cap: "fin.conciliacion" },
  { k: "tesoreria",    l: "Tesorería",    ic: "💵", cap: "fin.tesoreria" },
  { k: "presupuesto",  l: "Presupuesto",  ic: "📈", cap: "fin.presupuesto" }
  { k: "gm_dashboard", l: "Gastos",       ic: "💸", cap: "gm.dashboard" },
  { k: "gm_movs",      l: "Movimientos",  ic: "📒", cap: "gm.movimientos" }
]

export function FinanzasApp({ cu, setAppActual }) {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem("fin_tab") || "dashboard" } catch (e) { return "dashboard" }
  })
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  )
  const [capsLoaded, setCapsLoaded] = useState(false)

  // Precargar capabilities al montar — permite usar canSync() en el render
  useEffect(() => {
    if (cu?.id) preloadCaps(cu, 'finanzas').then(() => setCapsLoaded(true))
  }, [cu?.id])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    try { localStorage.setItem("fin_tab", tab) } catch (e) { }
  }, [tab])

  const r = rl(cu)
  // RBAC-4: filtrar tabs por capabilities dinámicas
  const finTabs = capsLoaded
    ? ALL_FIN_TABS.filter(t => canSync(cu, 'finanzas', t.cap) !== false)
    : ALL_FIN_TABS.filter(t => cu?.rol === 'admin')  // fallback mientras carga

  // Si el tab actual no está disponible para este rol, ir al primero disponible
  const tabValido = finTabs.find(t => t.k === tab) ? tab : (finTabs[0]?.k || "tesoreria")

  const cambiarApp = () => {
    localStorage.removeItem("outlet_app_actual")
    setAppActual(null)
  }

  const cerrarSesion = async () => {
    try { await signOut() } catch (e) { }
    localStorage.removeItem("erp_cu_id")
    localStorage.removeItem("outlet_app_actual")
    window.location.reload()
  }

  return (
    <div style={{
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
      margin: 0,
      padding: isMobile ? "0 10px calc(90px + env(safe-area-inset-bottom))" : "0 20px calc(100px + env(safe-area-inset-bottom))",
      background: "#F2F2F7",
      minHeight: "100vh",
      fontSize: 14
    }}>
      <style>{`
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#F2F2F7;overflow-x:hidden}
        input:focus,select:focus,textarea:focus{border-color:#34C759!important;box-shadow:0 0 0 3px rgba(52,199,89,0.1)}
        ::selection{background:#34C759;color:#fff}
        ::-webkit-scrollbar{width:10px;height:10px}
        ::-webkit-scrollbar-track{background:#F2F2F7;border-radius:5px}
        ::-webkit-scrollbar-thumb{background:#C7C7CC;border-radius:5px;border:2px solid #F2F2F7}
        ::-webkit-scrollbar-thumb:hover{background:#8E8E93}
        table{font-size:13px}
        th,td{white-space:nowrap}
        @media (max-width:767px){
          body{font-size:13px}
          table{font-size:11px}
          th,td{padding:6px 8px!important}
          button{min-height:36px}
        }
      `}</style>

      {/* HEADER */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(242,242,247,0.9)", backdropFilter: "blur(20px)",
        padding: isMobile ? "10px 0 8px" : "14px 0 10px",
        marginBottom: 10, borderBottom: "1px solid rgba(0,0,0,0.06)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 2
            }}>
              <span style={{ fontSize: isMobile ? 16 : 20 }}>💰</span>
              <span style={{
                fontSize: isMobile ? 16 : 22, fontWeight: 800,
                color: "#1C1C1E", letterSpacing: "-0.03em",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}>Sistema Financiero</span>
            </div>
            <div style={{ fontSize: isMobile ? 11 : 12, color: r.c, fontWeight: 600 }}>
              {r.l} — {cu.nombre}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button
              onClick={cambiarApp}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
                padding: "6px 10px", borderRadius: 10,
                background: "#007AFF15", border: "none",
                cursor: "pointer", color: "#007AFF",
                minWidth: isMobile ? 42 : 56
              }}
              title="Volver al selector de apps"
            >
              <span style={{ fontSize: isMobile ? 13 : 14, lineHeight: 1 }}>⇄</span>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.02em" }}>Apps</span>
            </button>

            <button
              onClick={cerrarSesion}
              style={{
                width: isMobile ? 34 : 36, height: isMobile ? 34 : 36,
                borderRadius: 10, background: "#FF3B3015",
                border: "none", cursor: "pointer",
                fontSize: 13, color: "#FF3B30"
              }}
              title="Cerrar sesión"
            >⏻</button>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      {tabValido === "dashboard" && <FinDashboard cu={cu} isMobile={isMobile} />}
      {tabValido === "conciliacion" && <FinConciliacion cu={cu} isMobile={isMobile} />}
      {tabValido === "tesoreria" && <FinTesoreria cu={cu} isMobile={isMobile} rol={cu?.rol} />}
      {tabValido === "presupuesto" && <FinPresupuesto cu={cu} isMobile={isMobile} />}
      {tabValido === "gm_dashboard" && <GmDashboard cu={cu} isMobile={isMobile} />}
      {tabValido === "gm_movs" && <GmMovimientos cu={cu} isMobile={isMobile} />}

      {/* TOASTER */}
      <Toaster richColors position="top-right" />

      {/* BOTTOM TAB BAR */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "rgba(255,255,255,0.97)", backdropFilter: "blur(20px)",
        borderTop: "1px solid rgba(0,0,0,0.08)",
        display: "flex", justifyContent: "center",
        padding: "8px 0 env(safe-area-inset-bottom,8px)", zIndex: 50
      }}>
        <div style={{ display: "flex", gap: 0, maxWidth: 700, width: "100%" }}>
          {finTabs.map(t => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", gap: 2,
                padding: "6px 4px", background: "none", border: "none", cursor: "pointer"
              }}
            >
              <span style={{ fontSize: isMobile ? 20 : 22, opacity: tab === t.k ? 1 : 0.4 }}>{t.ic}</span>
              <span style={{
                fontSize: isMobile ? 10 : 11, fontWeight: 600,
                color: tab === t.k ? "#34C759" : "#8E8E93"
              }}>{t.l}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
