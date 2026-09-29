import { useState, useEffect, useRef, useCallback } from 'react'
import { deepLink } from '../core/deeplink'
import { signOut } from '../supabase'
import { preloadCaps, canSync } from '../core/permisos'
import { FinConciliacion } from './FinConciliacion'
import { FinContabilidad } from './FinContabilidad'
import { FinComprasPagos } from './FinComprasPagos'
import { FinTesoreria } from './FinTesoreria'
import { FinPresupuesto } from './FinPresupuesto'
import { PresupuestoPro } from './PresupuestoPro'
import { EerrFormal } from './EerrFormal'
import { FinInicio } from './FinInicio'
import { AnalisisEjecutivo } from './AnalisisEjecutivo'
import { FlujoCajaTab } from './clasificar/FlujoCajaTab'
import { GmDashboard } from './gastos_menores/GmDashboard'
import { GmMovimientos } from './gastos_menores/GmMovimientos'
import { PmoGestion } from '../proyectos/ProyectosApp'
import { Toaster } from 'sonner'
import { MenuSuperior, MenuMovil, menuVisible, CAP_HOJA } from './FinMenu'

/* ═══════════════════════════════════════════════════════════════════════
   FINANZAS — Shell con menú superior tipo ERP (Laudus / Contaline) · 29-sep-2026
   · Barra de módulos arriba; al pasar el cursor se despliega el menú por grupos.
   · Cada opción abre la pantalla exacta: (hoja, sub). Los módulos reciben `sub`
     y avisan sus cambios internos con `onSub` (la ruta de navegación siempre coincide).
   · Las keys de hoja y capabilities se conservan idénticas a las históricas.
   ═══════════════════════════════════════════════════════════════════════ */

const FONDO = '#F4F5F7', NAVY = '#16213E'

const ROLES = [
  { k: "admin", l: "Administrador", c: "#B42318" }, { k: "dir_general", l: "Dirección general", c: "#B42318" },
  { k: "dir_finanzas", l: "Dirección de finanzas", c: "#6941C6" }, { k: "dir_negocios", l: "Dirección de negocios", c: "#175CD3" },
  { k: "dir_operaciones", l: "Dirección de operaciones", c: "#175CD3" }, { k: "jefe_admin_finanzas", l: "Jefatura de administración y finanzas", c: "#6941C6" },
  { k: "analista", l: "Analista", c: "#1E7A44" }, { k: "jefe_bodega", l: "Jefatura de bodega", c: "#B25E09" },
  { k: "jefe_operaciones", l: "Jefatura de operaciones", c: "#B25E09" }, { k: "directorio", l: "Directorio", c: "#6E6E73" },
]
const rl = u => ROLES.find(r => r.k === u?.rol) || { k: u?.rol, l: u?.rol ?? 'Usuario', c: '#6E6E73' }

const HOJAS = Object.keys(CAP_HOJA)
const LEGADO_HOJA = { gm_movs: 'gastos', gm_dashboard: 'gastos', dashboard: 'analisis' }

/* ─── Caja chica: Resumen + Movimientos (la pestaña la indica el menú) ─── */
function GastosShell({ cu, isMobile, sub, onSub, embebido }) {
  const subTabs = [
    { k: "dashboard", l: "Resumen", cap: "gm.dashboard" },
    { k: "movs", l: "Movimientos", cap: "gm.movimientos" }
  ].filter(t => canSync(cu, 'finanzas', t.cap) !== false)
  const [s, setS] = useState(() => {
    if (sub && subTabs.some(t => t.k === sub)) return sub
    try { return localStorage.getItem("fin_gastos_sub") || "dashboard" } catch (e) { return "dashboard" }
  })
  const primera = useRef(true)
  useEffect(() => { if (primera.current) { primera.current = false; return } if (sub && sub !== s) setS(sub) }, [sub]) // eslint-disable-line react-hooks/exhaustive-deps
  const valido = subTabs.find(t => t.k === s) ? s : (subTabs[0]?.k || "dashboard")
  useEffect(() => { try { localStorage.setItem("fin_gastos_sub", valido) } catch (e) { } onSub?.(valido) }, [valido]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      {!embebido && (
        <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid #E5E7EB', overflowX: 'auto' }}>
          {subTabs.map(t => (
            <button key={t.k} onClick={() => setS(t.k)} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', background: 'none', border: 'none', cursor: 'pointer', color: valido === t.k ? NAVY : '#6E6E73', borderBottom: valido === t.k ? `2px solid ${NAVY}` : '2px solid transparent' }}>{t.l}</button>
          ))}
        </div>
      )}
      {valido === "dashboard" && <GmDashboard cu={cu} isMobile={isMobile} />}
      {valido === "movs" && <GmMovimientos cu={cu} isMobile={isMobile} />}
    </div>
  )
}

export function FinanzasApp({ cu, setAppActual }) {
  const [hoja, setHoja] = useState(() => {
    try {
      if (deepLink?.app === 'finanzas' && deepLink.modulo && HOJAS.includes(deepLink.modulo)) return deepLink.modulo
      const saved = localStorage.getItem("fin_tab")
      return LEGADO_HOJA[saved] ?? (HOJAS.includes(saved) ? saved : "inicio")
    } catch (e) { return "inicio" }
  })
  // Pestaña recordada por módulo: { contabilidad: 'diario', tesoreria: 'cierre', ... }
  const [subs, setSubs] = useState(() => {
    let m = {}
    try { m = JSON.parse(localStorage.getItem('fin_subs') || '{}') || {} } catch (e) { m = {} }
    if (deepLink?.app === 'finanzas' && deepLink.modulo && deepLink.tab) m = { ...m, [deepLink.modulo]: deepLink.tab }
    return m
  })
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 900 : false)
  const [capsLoaded, setCapsLoaded] = useState(false)

  useEffect(() => { if (cu?.id) preloadCaps(cu, 'finanzas').then(() => setCapsLoaded(true)) }, [cu?.id])
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 900)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  useEffect(() => { try { localStorage.setItem("fin_tab", hoja) } catch (e) { } }, [hoja])
  useEffect(() => { try { localStorage.setItem("fin_subs", JSON.stringify(subs)) } catch (e) { } }, [subs])

  const r = rl(cu)
  /* RBAC: opción visible si su capability pasa (mismas reglas que antes) */
  const pasaCap = cap => !cap ? (capsLoaded || cu?.rol === 'admin') : capsLoaded
    ? canSync(cu, 'finanzas', cap) !== false
    : cu?.rol === 'admin'
  const menu = menuVisible(cu, pasaCap)
  const hojasVisibles = new Set(menu.flatMap(m => m.grupos.flatMap(g => g.items.map(i => i.hoja))))
  const primeraVisible = menu[0]?.grupos[0]?.items[0]
  const hojaValida = hojasVisibles.has(hoja) ? hoja : (primeraVisible?.hoja ?? 'inicio')
  const sub = subs[hojaValida]

  const ir = useCallback((h, s) => {
    setHoja(h)
    if (s !== undefined) setSubs(m => ({ ...m, [h]: s }))
    try { window.scrollTo({ top: 0 }) } catch (e) { }
  }, [])
  const setTab = useCallback(h => ir(h), [ir])   // compatibilidad: Inicio navega con setTab(hoja)
  const onSub = useCallback(s => setSubs(m => (s == null || m[hojaValida] === s) ? m : ({ ...m, [hojaValida]: s })), [hojaValida])

  const cambiarApp = () => { localStorage.removeItem("outlet_app_actual"); setAppActual(null) }
  const cerrarSesion = async () => {
    try { await signOut() } catch (e) { }
    localStorage.removeItem("erp_cu_id"); localStorage.removeItem("outlet_app_actual")
    window.location.reload()
  }

  const p = { cu, isMobile, sub, onSub, embebido: true }
  const contenido = (
    <>
      {hojaValida === "inicio" && <FinInicio cu={cu} setTab={setTab} />}
      {hojaValida === "conciliacion" && <FinConciliacion {...p} />}
      {hojaValida === "contabilidad" && <FinContabilidad {...p} />}
      {hojaValida === "compras_pagos" && <FinComprasPagos {...p} />}
      {hojaValida === "tesoreria" && <FinTesoreria {...p} rol={cu?.rol} />}
      {hojaValida === "presupuesto" && <PresupuestoPro {...p} />}
      {hojaValida === "presupuesto_ant" && <FinPresupuesto cu={cu} isMobile={isMobile} />}
      {hojaValida === "eerr" && <EerrFormal cu={cu} modoInicial="devengo" titulo="Estado de resultados — real del libro mayor contra presupuesto vigente" />}
      {hojaValida === "analisis" && <AnalisisEjecutivo cu={cu} />}
      {hojaValida === "flujocaja" && <FlujoCajaTab sub={sub} onSub={onSub} embebido />}
      {hojaValida === "gastos" && <GastosShell {...p} />}
      {hojaValida === "pmo_gestion" && <PmoGestion cu={cu} area="finanzas" />}
    </>
  )

  const propsMenu = { menu, hoja: hojaValida, sub, onIr: ir, usuario: cu, rolNombre: r.l, rolColor: r.c, onApps: cambiarApp, onSalir: cerrarSesion }

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif", margin: 0, padding: 0, background: FONDO, minHeight: "100vh", fontSize: 14 }}>
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
        @media (max-width:899px){
          body{font-size:13px}
          table{font-size:11px}
          th,td{padding:6px 8px!important}
          button{min-height:36px}
        }
      `}</style>
      {isMobile ? <MenuMovil {...propsMenu} /> : <MenuSuperior {...propsMenu} />}
      <main style={{ padding: isMobile ? '12px 10px 40px' : '18px 22px 40px', maxWidth: 1920, margin: '0 auto' }}>
        {contenido}
      </main>
      <Toaster richColors position="top-right" />
    </div>
  )
}
