import { useState, useEffect } from 'react'
import { supabase, signOut } from '../supabase'
import { preloadCaps, canSync } from '../core/permisos'
import { FinDashboard } from './FinDashboard'
import { FinConciliacion } from './FinConciliacion'
import { FinContabilidad } from './FinContabilidad'
import { FinTesoreria } from './FinTesoreria'
import { FinPresupuesto } from './FinPresupuesto'
import { FinEerr } from './FinEerr'
import { EerrFormal } from './EerrFormal'
import { FinAnalisis } from './FinAnalisis'
import { FlujoCajaTab } from './clasificar/FlujoCajaTab'
import { GmDashboard } from './gastos_menores/GmDashboard'
import { GmMovimientos } from './gastos_menores/GmMovimientos'
import { Toaster } from 'sonner'
import { LayoutDashboard, BookOpenCheck, Landmark, ArrowLeftRight, LineChart, LayoutGrid, LogOut } from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════════
   FINANZAS — Shell de navegación por DOMINIOS (arquitectura ERP)
   Visión · Contabilidad · Tesorería · Conciliación · Gestión
   Cada dominio agrupa módulos (hojas). Las keys de hoja se conservan
   idénticas a las históricas → localStorage y RBAC intactos.
   Estética: navy institucional #16213E, densidad profesional, sin emojis.
   ═══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', NAVY_HOVER = '#1E2B50', NAVY_ACTIVE = '#25355F'
const INK = '#1C1C1E', SLATE = '#6E6E73', FONDO = '#F4F5F7', BORDE = '#E5E7EB'

const ROLES = [
  { k: "admin", l: "Admin", c: "#B42318" }, { k: "dir_general", l: "Dir. General", c: "#B42318" },
  { k: "dir_finanzas", l: "Dir. Finanzas", c: "#6941C6" }, { k: "dir_negocios", l: "Dir. Negocios", c: "#175CD3" },
  { k: "dir_operaciones", l: "Dir. Operaciones", c: "#175CD3" }, { k: "analista", l: "Analista", c: "#1E7A44" },
  { k: "jefe_bodega", l: "Jefe Bodega", c: "#B25E09" }, { k: "jefe_operaciones", l: "Jefe Operaciones", c: "#B25E09" },
  { k: "directorio", l: "Directorio", c: "#6E6E73" }
]
const rl = u => ROLES.find(r => r.k === u?.rol) || ROLES[5]

/* ─── Arquitectura de dominios ───
   Cada hoja conserva su key y capability históricas (compatibilidad total).
   Un dominio es visible si al menos una de sus hojas pasa el RBAC. */
const DOMINIOS = [
  { k: 'vision', l: 'Visión General', Icono: LayoutDashboard, hojas: [
    { k: 'dashboard', l: 'Dashboard ejecutivo', cap: 'fin.dashboard' },
  ]},
  { k: 'dom_contab', l: 'Contabilidad', Icono: BookOpenCheck, hojas: [
    { k: 'contabilidad', l: 'Libros y estados', cap: 'fin.conciliacion' },
  ]},
  { k: 'dom_teso', l: 'Tesorería', Icono: Landmark, hojas: [
    { k: 'tesoreria', l: 'Cierres de caja', cap: 'fin.tesoreria' },
    { k: 'flujocaja', l: 'Flujo de caja', cap: 'fin.conciliacion' },
    { k: 'gastos', l: 'Caja chica', cap: 'gm.dashboard' },
  ]},
  { k: 'dom_conc', l: 'Conciliación', Icono: ArrowLeftRight, hojas: [
    { k: 'conciliacion', l: 'Conciliación bancaria', cap: 'fin.conciliacion' },
  ]},
  { k: 'dom_gestion', l: 'Gestión', Icono: LineChart, hojas: [
    { k: 'eerr', l: 'EERR Gestión (caja)', cap: 'fin.presupuesto' },
    { k: 'eerr_legado', l: 'EERR Gestión (legado)', cap: 'fin.presupuesto' },
    { k: 'presupuesto', l: 'Presupuesto', cap: 'fin.presupuesto' },
    { k: 'analisis', l: 'Análisis ejecutivo', cap: 'fin.presupuesto' },
  ]},
]

/* ─── Shell de Caja chica (ex Gastos): Dashboard + Movimientos ─── */
function GastosShell({ cu, isMobile }) {
  const subTabs = [
    { k: "dashboard", l: "Dashboard", cap: "gm.dashboard" },
    { k: "movs", l: "Movimientos", cap: "gm.movimientos" }
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
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: `1px solid ${BORDE}`, overflowX: 'auto' }}>
        {subTabs.map(t => (
          <button key={t.k} onClick={() => setSub(t.k)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            background: 'none', border: 'none', cursor: 'pointer',
            color: subValido === t.k ? NAVY : SLATE,
            borderBottom: subValido === t.k ? `2px solid ${NAVY}` : '2px solid transparent',
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
      if (saved === "gm_movs" || saved === "gm_dashboard") return "gastos"
      return saved || "dashboard"
    } catch (e) { return "dashboard" }
  })
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  )
  const [capsLoaded, setCapsLoaded] = useState(false)

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

  /* RBAC: hoja visible si su capability pasa; dominio visible si tiene ≥1 hoja */
  const pasaCap = t => capsLoaded
    ? canSync(cu, 'finanzas', t.cap) !== false
    : cu?.rol === 'admin'
  const dominios = DOMINIOS
    .map(d => ({ ...d, hojas: d.hojas.filter(pasaCap) }))
    .filter(d => d.hojas.length > 0)
  const hojasVisibles = dominios.flatMap(d => d.hojas)

  const tabValido = hojasVisibles.find(t => t.k === tab) ? tab : (hojasVisibles[0]?.k || "tesoreria")
  const dominioActivo = dominios.find(d => d.hojas.some(h => h.k === tabValido)) || dominios[0]
  const hojaActiva = hojasVisibles.find(h => h.k === tabValido)

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

  const SIDEBAR_W = 232

  const contenido = (
    <>
      {tabValido === "dashboard" && <FinDashboard cu={cu} isMobile={isMobile} />}
      {tabValido === "conciliacion" && <FinConciliacion cu={cu} isMobile={isMobile} />}
      {tabValido === "contabilidad" && <FinContabilidad cu={cu} isMobile={isMobile} />}
      {tabValido === "tesoreria" && <FinTesoreria cu={cu} isMobile={isMobile} rol={cu?.rol} />}
      {tabValido === "presupuesto" && <FinPresupuesto cu={cu} isMobile={isMobile} />}
      {tabValido === "eerr" && <EerrFormal modoInicial="caja" titulo="EERR Gestión — lectura de caja (espejo del EERR contable, mismo maestro y mismas fuentes)" />}
      {tabValido === "eerr_legado" && <FinEerr cu={cu} isMobile={isMobile} />}
      {tabValido === "analisis" && <FinAnalisis cu={cu} isMobile={isMobile} />}
      {tabValido === "flujocaja" && <FlujoCajaTab />}
      {tabValido === "gastos" && <GastosShell cu={cu} isMobile={isMobile} />}
    </>
  )

  return (
    <div style={{
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
      margin: 0,
      padding: 0,
      background: FONDO,
      minHeight: "100vh",
      fontSize: 14
    }}>
      <style>{`
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:${FONDO};overflow-x:hidden}
        input:focus,select:focus,textarea:focus{border-color:${NAVY}!important;box-shadow:0 0 0 3px rgba(22,33,62,0.08)}
        ::selection{background:${NAVY};color:#fff}
        ::-webkit-scrollbar{width:10px;height:10px}
        ::-webkit-scrollbar-track{background:${FONDO};border-radius:5px}
        ::-webkit-scrollbar-thumb{background:#C7C7CC;border-radius:5px;border:2px solid ${FONDO}}
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

      {isMobile ? (
        /* ═══ MÓVIL: header compacto + sub-tabs de dominio + bottom bar de dominios ═══ */
        <div style={{ padding: "0 10px calc(90px + env(safe-area-inset-bottom))" }}>
          <div style={{
            position: "sticky", top: 0, zIndex: 50,
            background: NAVY, margin: "0 -10px 10px", padding: "10px 14px 8px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
                  Finanzas <span style={{ fontWeight: 400, opacity: 0.55 }}>· {hojaActiva?.l}</span>
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontWeight: 600 }}>
                  {r.l} — {cu.nombre}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={cambiarApp} title="Apps" style={{
                  width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.12)",
                  border: "none", cursor: "pointer", color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}><LayoutGrid size={15} /></button>
                <button onClick={cerrarSesion} title="Cerrar sesión" style={{
                  width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.12)",
                  border: "none", cursor: "pointer", color: "#FCA5A5",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}><LogOut size={15} /></button>
              </div>
            </div>
          </div>

          {/* Sub-tabs del dominio activo (si tiene más de una hoja) */}
          {dominioActivo && dominioActivo.hojas.length > 1 && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
              {dominioActivo.hojas.map(h => (
                <button key={h.k} onClick={() => setTab(h.k)} style={{
                  padding: "6px 12px", borderRadius: 999, whiteSpace: "nowrap",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  background: tabValido === h.k ? NAVY : "#fff",
                  color: tabValido === h.k ? "#fff" : SLATE,
                  border: `1px solid ${tabValido === h.k ? NAVY : BORDE}`,
                }}>{h.l}</button>
              ))}
            </div>
          )}

          {contenido}

          {/* Bottom bar: DOMINIOS */}
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0,
            background: "#fff", borderTop: `1px solid ${BORDE}`,
            display: "flex", justifyContent: "center",
            padding: "6px 0 env(safe-area-inset-bottom,6px)", zIndex: 50,
            boxShadow: "0 -2px 10px rgba(0,0,0,0.04)"
          }}>
            <div style={{ display: "flex", gap: 0, maxWidth: 700, width: "100%" }}>
              {dominios.map(d => {
                const activo = dominioActivo?.k === d.k
                const Ic = d.Icono
                return (
                  <button key={d.k} onClick={() => setTab(d.hojas[0].k)} style={{
                    flex: 1, display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 3,
                    padding: "5px 2px", background: "none", border: "none", cursor: "pointer"
                  }}>
                    <Ic size={19} color={activo ? NAVY : "#9CA3AF"} strokeWidth={activo ? 2.4 : 2} />
                    <span style={{
                      fontSize: 9, fontWeight: activo ? 800 : 600,
                      color: activo ? NAVY : "#9CA3AF", letterSpacing: "0.01em"
                    }}>{d.l.split(' ')[0]}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        /* ═══ DESKTOP: sidebar navy tipo ERP + área de trabajo ═══ */
        <div style={{ display: "flex", minHeight: "100vh" }}>
          {/* SIDEBAR — navegación por dominios */}
          <div style={{
            width: SIDEBAR_W, flexShrink: 0, background: NAVY,
            position: "sticky", top: 0, height: "100vh", overflowY: "auto",
            display: "flex", flexDirection: "column"
          }}>
            {/* Marca */}
            <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
                OUTLET DE PUERTAS
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)",
                letterSpacing: "0.14em", marginTop: 2 }}>ERP · FINANZAS</div>
            </div>

            {/* Dominios y hojas */}
            <div style={{ flex: 1, padding: "10px 8px" }}>
              {dominios.map(d => {
                const domActivo = dominioActivo?.k === d.k
                const Ic = d.Icono
                const unaHoja = d.hojas.length === 1
                return (
                  <div key={d.k} style={{ marginBottom: 2 }}>
                    <button
                      onClick={() => setTab(d.hojas[0].k)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "9px 10px", borderRadius: 8, cursor: "pointer",
                        background: domActivo && unaHoja ? NAVY_ACTIVE : "transparent",
                        border: "none", textAlign: "left",
                        borderLeft: domActivo && unaHoja ? "3px solid #fff" : "3px solid transparent",
                      }}
                      onMouseEnter={e => { if (!(domActivo && unaHoja)) e.currentTarget.style.background = NAVY_HOVER }}
                      onMouseLeave={e => { if (!(domActivo && unaHoja)) e.currentTarget.style.background = "transparent" }}
                    >
                      <Ic size={16} color={domActivo ? "#fff" : "rgba(255,255,255,0.55)"} strokeWidth={domActivo ? 2.4 : 2} />
                      <span style={{
                        fontSize: 13, fontWeight: domActivo ? 700 : 500,
                        color: domActivo ? "#fff" : "rgba(255,255,255,0.75)", letterSpacing: "-0.01em"
                      }}>{d.l}</span>
                    </button>
                    {/* Hojas del dominio (solo si tiene más de una) */}
                    {!unaHoja && d.hojas.map(h => {
                      const activa = tabValido === h.k
                      return (
                        <button key={h.k} onClick={() => setTab(h.k)} style={{
                          display: "block", width: "100%", textAlign: "left",
                          padding: "7px 10px 7px 36px", borderRadius: 8, cursor: "pointer",
                          background: activa ? NAVY_ACTIVE : "transparent",
                          border: "none",
                          borderLeft: activa ? "3px solid #fff" : "3px solid transparent",
                          fontSize: 12.5, fontWeight: activa ? 700 : 400,
                          color: activa ? "#fff" : "rgba(255,255,255,0.6)",
                        }}
                          onMouseEnter={e => { if (!activa) e.currentTarget.style.background = NAVY_HOVER }}
                          onMouseLeave={e => { if (!activa) e.currentTarget.style.background = "transparent" }}
                        >{h.l}</button>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            {/* Usuario + acciones */}
            <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cu.nombre}</div>
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)", fontWeight: 600, marginBottom: 10 }}>{r.l}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={cambiarApp} style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "7px 0", borderRadius: 8, background: "rgba(255,255,255,0.1)",
                  border: "none", cursor: "pointer", color: "#fff", fontSize: 11.5, fontWeight: 600
                }}><LayoutGrid size={13} /> Apps</button>
                <button onClick={cerrarSesion} title="Cerrar sesión" style={{
                  width: 34, borderRadius: 8, background: "rgba(255,255,255,0.1)",
                  border: "none", cursor: "pointer", color: "#FCA5A5",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}><LogOut size={13} /></button>
              </div>
            </div>
          </div>

          {/* ÁREA DE TRABAJO */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            {/* Barra superior: breadcrumb del dominio + hoja */}
            <div style={{
              position: "sticky", top: 0, zIndex: 50, background: "#fff",
              borderBottom: `1px solid ${BORDE}`, padding: "12px 22px",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: INK, letterSpacing: "-0.02em" }}>
                  {dominioActivo?.l}
                </span>
                {dominioActivo && dominioActivo.hojas.length > 1 && (
                  <span style={{ fontSize: 12.5, color: SLATE, fontWeight: 500 }}>
                    / {hojaActiva?.l}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: r.c, fontWeight: 700, flexShrink: 0 }}>
                {r.l} · {cu.nombre}
              </div>
            </div>

            <div style={{ padding: "18px 22px 40px" }}>
              {contenido}
            </div>
          </div>
        </div>
      )}

      <Toaster richColors position="top-right" />
    </div>
  )
}
