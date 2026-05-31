// src/rrhh/asistencia/AsistenciaApp.jsx
// Sub-app de Control de Asistencia — integración con Workera
// FASE 0: shell vacío con tabs placeholder
// FASE 3A: Tab Config implementado (credenciales, sucursales, sync, empleados)

import { useState, useEffect } from 'react'
import { AsisConfig } from './config/AsisConfig'

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

const TABS = [
  { k: "dashboard",   l: "Dashboard",   ic: "📊" },
  { k: "marcaciones", l: "Marcaciones", ic: "🕐" },
  { k: "permisos",    l: "Permisos",    ic: "📋" },
  { k: "hhee",        l: "Horas Extras",ic: "⏱" },
  { k: "sync",        l: "Sync",        ic: "🔄" },
  { k: "config",      l: "Config",      ic: "⚙" }
]

export function AsistenciaApp({ cu, onVolverHubRrhh, onCerrarSesion }) {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem("asis_tab") || "dashboard" } catch { return "dashboard" }
  })

  useEffect(() => {
    try { localStorage.setItem("asis_tab", tab) } catch {}
  }, [tab])

  return (
    <div style={{minHeight:"100vh",background:"var(--bg-app)"}}>
      {/* HEADER */}
      <header style={{
        background:"var(--bg-surface)",borderBottom:"1px solid var(--border)",
        padding:"14px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",
        position:"sticky",top:0,zIndex:50
      }}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <button onClick={onVolverHubRrhh} style={{...btnSec,padding:"8px 12px"}}>
            ← Gestión de Personas
          </button>
          <div style={{fontSize:24}}>🕐</div>
          <div>
            <div style={{fontSize:18,fontWeight:600}}>Control de Asistencia</div>
            <div style={{fontSize:12,color:"var(--text-muted)"}}>
              Integración Workera · Outlet de Puertas
            </div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:13,fontWeight:600}}>{cu.nombre}</div>
            <div style={{fontSize:11,color:rl(cu).c,fontWeight:600}}>{rl(cu).l}</div>
          </div>
          <button onClick={onCerrarSesion} style={btnGhost}>Salir</button>
        </div>
      </header>

      {/* TABS */}
      <nav style={{
        background:"var(--bg-surface)",borderBottom:"1px solid var(--border)",
        padding:"0 24px",display:"flex",gap:4,overflowX:"auto"
      }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            style={{
              padding:"14px 18px",border:"none",background:"transparent",
              borderBottom:`3px solid ${tab===t.k?"var(--accent)":"transparent"}`,
              color: tab===t.k?"var(--accent)":"var(--text)",
              fontWeight: tab===t.k?600:400,fontSize:14,cursor:"pointer",
              display:"flex",alignItems:"center",gap:8,whiteSpace:"nowrap"
            }}>
            <span>{t.ic}</span>{t.l}
          </button>
        ))}
      </nav>

      {/* CONTENT — placeholders Fase 0 (excepto config que ya está implementado en Fase 3A) */}
      <main style={{padding:24}}>
        {tab === 'config' ? <AsisConfig cu={cu} /> : <Placeholder tab={tab} />}
      </main>
    </div>
  )
}

function Placeholder({ tab }) {
  const labels = {
    dashboard:   { ic:"📊", title:"Dashboard de Asistencia",   desc:"KPIs de marcaciones, % asistencia, atrasos y permisos vigentes." },
    marcaciones: { ic:"🕐", title:"Marcaciones",               desc:"Tabla de marcaciones sincronizadas desde Workera con filtros por sucursal/empleado/fecha." },
    permisos:    { ic:"📋", title:"Permisos y Vacaciones",     desc:"Licencias médicas, vacaciones, permisos sin goce y otros tipos de salida especial." },
    hhee:        { ic:"⏱",  title:"Horas Extras Autorizadas",  desc:"Autorizaciones de horas extras por empleado y período." },
    sync:        { ic:"🔄", title:"Sincronización con Workera",desc:"Sync manual on-demand y log de corridas automáticas diarias." },
    config:      { ic:"⚙",  title:"Configuración",             desc:"Mapeo sucursales ERP↔Workera, credenciales API y test de conexión." }
  }
  const c = labels[tab] || labels.dashboard
  return (
    <div style={{
      maxWidth: 640, margin: "60px auto", textAlign: "center",
      background: "var(--bg-surface)", border: "1px solid var(--border)",
      borderRadius: 16, padding: "48px 32px"
    }}>
      <div style={{fontSize:56, marginBottom:16}}>{c.ic}</div>
      <h2 style={{margin:"0 0 8px 0", fontSize:22, fontWeight:700, color:"var(--text)"}}>
        {c.title}
      </h2>
      <p style={{margin:"0 0 24px 0", color:"var(--text-muted)", fontSize:14, lineHeight:1.5}}>
        {c.desc}
      </p>
      <div style={{
        display:"inline-flex", alignItems:"center", gap:8,
        padding:"8px 14px", borderRadius:100,
        background:"var(--accent)15", color:"var(--accent)",
        fontSize:12, fontWeight:600
      }}>
        🚧 En construcción — Fase 1: integración Workera
      </div>
    </div>
  )
}

const btnSec   = {padding:"10px 16px",background:"var(--bg-card)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:500}
const btnGhost = {padding:"8px 14px",background:"transparent",color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13}
