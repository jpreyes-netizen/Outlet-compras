import { useState, useEffect } from 'react'
import { supabase, signOut } from '../supabase'
import { preloadCaps, canSync } from '../core/permisos'
import { FinDashboard } from './FinDashboard'
import { FinConciliacion } from './FinConciliacion'
import { FinTesoreria } from './FinTesoreria'
import { FinPresupuesto } from './FinPresupuesto'
import { FinEerr } from './FinEerr'
import { FinAnalisis } from './FinAnalisis'
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

// RBAC-4: tabs vinculados a capabilities en vez de roles hardcodeados.
// NOTA Fase 0: "gm_movs" (Movimientos) dejó de ser tab principal — ahora vive
// como sub-tab dentro de "gastos" (ver GastosShell). Su capability gm.movimientos
// se sigue respetando dentro del shell.
const ALL_FIN_TABS = [
  { k: "dashboard",    l: "Dashboard",    ic: "📊", cap: "fin.dashboard" },
  { k: "conciliacion", l: "Conciliación", ic: "🔄", cap: "fin.conciliacion" },
  { k: "tesoreria",    l: "Tesorería",    ic: "💵", cap: "fin.tesoreria" },
  { k: "presupuesto",  l: "Presupuesto",  ic: "📈", cap: "fin.presupuesto" },
  { k: "eerr",         l: "EERR",         ic: "📑", cap: "fin.presupuesto" },
  { k: "analisis",     l: "Análisis",     ic: "🧠", cap: "fin.presupuesto" },
  { k: "gastos",       l: "Gastos",       ic: "💸", cap: "gm.dashboard" }
]

/* ─── Shell de Gastos: agrupa Dashboard + Movimientos como sub-tabs ─── */
function GastosShell({ cu, isMobile }) {
  // Sub-tabs internos. Movimientos solo aparece si el rol tiene gm.movimientos.
  const subTabs = [
    { k: "dashboard", l: "Dashboard",   cap: "gm.dashboard" },
    { k: "movs",      l: "Movimientos", cap: "gm.movimientos" }
  ].filter(t => canSync(cu, 'finanzas', t.cap) !== false)

  const [sub, setSub] = useState(() => {
    try { return localStorage.getItem("fin_gastos_sub") || "dashboard" } catch (e) { return "dashboard" }
  })
  const subValido = subTabs.find(t => t.k === sub) ? sub : (subTabs[0]?.k || "dashboard")

  useEffect(() => {
    try { localStorage.setItem("fin_gastos_sub", subValido) } catch (e) { }
  }, [subValido])

  return (
    <div>
      {/* Sub-tabs Gastos */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.06)', overflowX: 'auto' }}>
        {subTabs.map(t => (
          <button key={t.k} onClick={() => setSub(t.k)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            background: 'none', border: 'none', cursor: 'pointer',
            color: subValido === t.k ? '#34C759' : '#8E8E93',
            borderBottom: subValido === t.k ? '2px solid #34C759' : '2px solid transparent',
          }}>{t.l}</button>
        ))}
      </div>

      {subValido === "dashboard" && <GmDashboard cu={cu} isMobile={isMobile} />}
      {subValido === "movs" && <GmMovimientos cu={cu} isMobile={isMobile} />}
    </div>
  )
}

export function FinanzasApp({ cu, setAppActual }) {
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem("fin_tab")
      // Migración Fase 0: si quedó guardado el tab viejo "gm_movs"/"gm_dashboard",
      // mapear a "gastos" para no dejar al usuario en un tab inexistente.
      if (saved === "gm_movs" || saved === "gm_dashboard") return "gastos"
      return saved || "dashboard"
    } catch (e) { return "dashboard" }
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

  const SIDEBAR_W = 220

  /* ─── Contenido principal (común a desktop y móvil) ─── */
  const contenido = (
    <>
      {tabValido === "dashboard" && <FinDashboard cu={cu} isMobile={isMobile} />}
      {tabValido === "conciliacion" && <FinConciliacion cu={cu} isMobile={isMobile} />}
      {tabValido === "tesoreria" && <FinTesoreria cu={cu} isMobile={isMobile} rol={cu?.rol} />}
      {tabValido === "presupuesto" && <FinPresupuesto cu={cu} isMobile={isMobile} />}
      {tabValido === "eerr" && <FinEerr cu={cu} isMobile={isMobile} />}
      {tabValido === "analisis" && <FinAnalisis cu={cu} isMobile={isMobile} />}
      {tabValido === "gastos" && <GastosShell cu={cu} isMobile={isMobile} />}
    </>
  )

  return (
    <div style={{
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
      margin: 0,
      padding: isMobile
        ? "0 10px calc(90px + env(safe-area-inset-bottom))"
        : "0 20px 40px",
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

      {/* LAYOUT: sidebar lateral (desktop) o contenido full (móvil) */}
      {isMobile ? (
        <>
          {/* CONTENT móvil */}
          {contenido}

          {/* BOTTOM TAB BAR — solo móvil */}
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
                  <span style={{ fontSize: 20, opacity: tabValido === t.k ? 1 : 0.4 }}>{t.ic}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600,
                    color: tabValido === t.k ? "#34C759" : "#8E8E93"
                  }}>{t.l}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
          {/* SIDEBAR LATERAL — desktop */}
          <div style={{
            position: "sticky", top: 70, alignSelf: "flex-start",
            width: SIDEBAR_W, flexShrink: 0,
            display: "flex", flexDirection: "column", gap: 4
          }}>
            {finTabs.map(t => {
              const activo = tabValido === t.k
              return (
                <button
                  key={t.k}
                  onClick={() => setTab(t.k)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "11px 14px", borderRadius: 12,
                    background: activo ? "#fff" : "transparent",
                    border: "none", cursor: "pointer", textAlign: "left", width: "100%",
                    boxShadow: activo ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                    transition: "background 0.15s"
                  }}
                >
                  <span style={{ fontSize: 19, opacity: activo ? 1 : 0.5 }}>{t.ic}</span>
                  <span style={{
                    fontSize: 14, fontWeight: activo ? 700 : 500,
                    color: activo ? "#34C759" : "#3C3C43", letterSpacing: "-0.01em"
                  }}>{t.l}</span>
                </button>
              )
            })}
          </div>

          {/* CONTENT desktop */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {contenido}
          </div>
        </div>
      )}

      {/* TOASTER */}
      <Toaster richColors position="top-right" />
    </div>
  )
}
