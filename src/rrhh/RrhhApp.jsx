import { useState, useEffect } from 'react'
import { supabase, signOut } from '../supabase'
import { preloadCaps, canSync } from '../core/permisos'
import { RemuneracionesApp } from './remuneraciones/RemuneracionesApp'
import { AsistenciaApp } from './asistencia/AsistenciaApp'
import { OrganigramaApp } from './organigrama/OrganigramaApp'
import { DesempenoApp }   from './desempeno/DesempenoApp'

const ROLES = [
  { k: "admin",            l: "Admin",            c: "var(--danger)" },
  { k: "dir_general",      l: "Dir. General",     c: "var(--danger)" },
  { k: "dir_finanzas",     l: "Dir. Finanzas",    c: "var(--purple)" },
  { k: "dir_negocios",     l: "Dir. Negocios",    c: "var(--accent)" },
  { k: "dir_operaciones",  l: "Dir. Operaciones", c: "var(--info)" },
  { k: "analista",         l: "Analista",         c: "var(--success)" },
  { k: "directorio",       l: "Directorio",       c: "var(--text-muted)" }
]
const rl = u => ROLES.find(r => r.k === u?.rol) || ROLES[5]

// ═══ Catálogo de sub-apps del módulo RRHH ═══
const SUBAPPS = [
  {
    k: "remuneraciones",
    l: "Remuneraciones",
    ic: "💰",
    c: "#34C759",
    desc: "Liquidaciones, honorarios, dotación y análisis de costo empresa",
    tabs: ["Dashboard","Cargar","Honorarios","Informe","Empleados","Análisis"],
    cap: "rrhh.remuneraciones"
  },
  {
    k: "asistencia",
    l: "Control de Asistencia",
    ic: "🕐",
    c: "#007AFF",
    desc: "Marcaciones, permisos, vacaciones y horas extras (integración Workera)",
    tabs: ["Dashboard","Marcaciones","Permisos","HHEE","Sync","Config"],
    cap: "rrhh.asistencia"
  },
  {
    k: "organigrama",
    l: "Organigrama",
    ic: "🏛️",
    c: "#FF9500",
    desc: "Estructura de cargos: árbol jerárquico, estados y asignación de personas",
    tabs: ["Árbol de cargos","Asignaciones"],
    cap: "rrhh.organigrama"
  },
  {
    k: "desempeno",
    l: "Evaluación de Desempeño",
    ic: "📋",
    c: "#AF52DE",
    desc: "Procesos de evaluación: 3 dimensiones ponderadas, control de sesgo e informes",
    tabs: ["Procesos","Evaluaciones","Informes"],
    cap: "rrhh.desempeno"
  }
]

// Fallback legado por rol (cuando no hay capabilities cargadas)
const ROLES_LEGADO_RRHH = ['admin','dir_general','dir_finanzas']

export function RrhhApp({ cu, setAppActual }) {
  const [subapp, setSubapp] = useState(() => {
    try { return localStorage.getItem("rrhh_subapp") || null } catch { return null }
  })
  const [verificando, setVerificando] = useState(true)
  const [accesos, setAccesos] = useState({ remuneraciones: false, asistencia: false, organigrama: false, desempeno: false })

  // Precarga capabilities y resuelve qué sub-apps puede ver
  useEffect(() => {
    let cancel = false
    const verificar = async () => {
      // PRIMERO: acceso garantizado para admin y roles legados (no depende de capabilities)
      const esAdmin = cu?.rol === 'admin'
      if (esAdmin || ROLES_LEGADO_RRHH.includes(cu?.rol)) {
        setAccesos({ remuneraciones: true, asistencia: true, organigrama: true, desempeno: true })
        setVerificando(false)
        return
      }

      // SEGUNDO: para otros roles, intentar resolver vía capabilities
      try {
        await preloadCaps(cu, 'rrhh')
        if (cancel) return
        const accRem = !!canSync(cu, 'rrhh', 'rrhh.remuneraciones')
        const accAsi = !!canSync(cu, 'rrhh', 'rrhh.asistencia')
        const accOrg = !!canSync(cu, 'rrhh', 'rrhh.organigrama')
        const accDes = !!canSync(cu, 'rrhh', 'rrhh.desempeno')
        setAccesos({ remuneraciones: accRem, asistencia: accAsi, organigrama: accOrg, desempeno: accDes })
      } catch (e) {
        if (!cancel) setAccesos({ remuneraciones: false, asistencia: false, organigrama: false, desempeno: false })
      } finally {
        if (!cancel) setVerificando(false)
      }
    }
    verificar()
    return () => { cancel = true }
  }, [cu?.id, cu?.rol])

  // Persistir sub-app activa
  useEffect(() => {
    try {
      if (subapp) localStorage.setItem("rrhh_subapp", subapp)
      else localStorage.removeItem("rrhh_subapp")
    } catch {}
  }, [subapp])

  // Si el usuario llega con sub-app guardada en localStorage pero ya no tiene acceso, limpiar
  useEffect(() => {
    if (verificando) return
    if (subapp === 'remuneraciones' && !accesos.remuneraciones) setSubapp(null)
    if (subapp === 'asistencia'    && !accesos.asistencia)    setSubapp(null)
    if (subapp === 'organigrama'   && !accesos.organigrama)   setSubapp(null)
    if (subapp === 'desempeno'     && !accesos.desempeno)     setSubapp(null)
  }, [verificando, accesos, subapp])

  const cerrarSesion = async () => {
    try { await signOut() } catch {}
    try { localStorage.removeItem("erp_cu_id") } catch {}
    try { localStorage.removeItem("outlet_app_actual") } catch {}
    try { localStorage.removeItem("rrhh_subapp") } catch {}
    window.location.reload()
  }

  // ─── Estados de carga / sin acceso ─────────────────────────────
  if (verificando) {
    return <div style={{padding:80,textAlign:"center",color:"var(--text-muted)"}}>
      Verificando acceso al módulo...
    </div>
  }

  const ningunAcceso = !accesos.remuneraciones && !accesos.asistencia && !accesos.organigrama && !accesos.desempeno
  if (ningunAcceso) {
    return (
      <div style={{padding:60,textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:16}}>🔒</div>
        <h2 style={{margin:"0 0 8px 0"}}>Sin acceso al módulo Gestión de Personas</h2>
        <p style={{color:"var(--text-muted)",margin:"0 0 24px 0"}}>
          Solicita acceso al administrador del sistema.
        </p>
        <button onClick={() => setAppActual(null)} style={btnSec}>← Volver al Hub</button>
      </div>
    )
  }

  // ─── Render de sub-apps ────────────────────────────────────────
  // Pasamos onVolverHub para que la sub-app vuelva al selector RRHH (no al AppHub global)
  if (subapp === 'remuneraciones' && accesos.remuneraciones) {
    return <RemuneracionesApp
      cu={cu}
      onVolverHubRrhh={() => setSubapp(null)}
      onCerrarSesion={cerrarSesion}
    />
  }
  if (subapp === 'asistencia' && accesos.asistencia) {
    return <AsistenciaApp
      cu={cu}
      onVolverHubRrhh={() => setSubapp(null)}
      onCerrarSesion={cerrarSesion}
    />
  }
  if (subapp === 'organigrama' && accesos.organigrama) {
    return <OrganigramaApp
      cu={cu}
      onVolverHubRrhh={() => setSubapp(null)}
      onCerrarSesion={cerrarSesion}
    />
  }
  if (subapp === 'desempeno' && accesos.desempeno) {
    return <DesempenoApp
      cu={cu}
      onVolverHubRrhh={() => setSubapp(null)}
      onCerrarSesion={cerrarSesion}
    />
  }

  // ─── Selector de sub-apps (hub intermedio) ─────────────────────
  const subappsDisponibles = SUBAPPS.filter(s => accesos[s.k])

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg-app)",
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
      padding: "40px 20px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center"
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 40, maxWidth: 720 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>👥</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.03em" }}>
          Gestión de Personas
        </div>
        <div style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 4 }}>
          Hola, {cu.nombre} · <span style={{ color: rl(cu).c, fontWeight: 600 }}>{rl(cu).l}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 16 }}>
          Selecciona el módulo que deseas usar
        </div>
      </div>

      {/* Cards */}
      <div style={{
        display: "grid",
        gridTemplateColumns: subappsDisponibles.length === 1 ? "1fr" : "repeat(auto-fit, minmax(280px, 360px))",
        gap: 20,
        maxWidth: 1100,
        width: "100%"
      }}>
        {subappsDisponibles.map(app => (
          <button
            key={app.k}
            onClick={() => setSubapp(app.k)}
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
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
              background: app.c + "15",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28
            }}>{app.ic}</div>

            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>
                {app.l}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.4 }}>
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
              borderTop: "1px solid var(--border)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              fontSize: 13, fontWeight: 600, color: app.c
            }}>
              Ingresar →
            </div>
          </button>
        ))}
      </div>

      {/* Acciones footer */}
      <div style={{ marginTop: 32, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <button onClick={() => setAppActual(null)} style={btnSec}>
          ← Volver al Hub de Apps
        </button>
        <button onClick={cerrarSesion} style={btnGhost}>
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

const btnSec   = {padding:"10px 16px",background:"var(--bg-card)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:500}
const btnGhost = {padding:"8px 14px",background:"transparent",color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13}
