// src/rrhh/remuneraciones/RemuneracionesApp.jsx
// Sub-app de Remuneraciones — contiene los 6 tabs originales del RrhhApp
// Recibe onVolverHubRrhh (vuelve al selector de sub-apps) y onCerrarSesion

import { useState, useEffect } from 'react'
import { RemuneracionesDashboard } from '../RemuneracionesDashboard'
import { RemuneracionesCarga }     from '../RemuneracionesCargaLiquidaciones'
import { RemuneracionesInforme }   from '../RemuneracionesInforme'
import { RemuneracionesHonorarios } from '../RemuneracionesHonorarios'
import { RemuneracionesEmpleados } from '../RemuneracionesEmpleados'
import { RemuneracionesAnalisis }  from '../RemuneracionesAnalisis'

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
  { k: "dashboard",  l: "Dashboard",            ic: "📊" },
  { k: "cargar",     l: "Cargar Liquidaciones", ic: "📤" },
  { k: "honorarios", l: "Honorarios",           ic: "💼" },
  { k: "informe",    l: "Informe",              ic: "📄" },
  { k: "empleados",  l: "Empleados",            ic: "👥" },
  { k: "analisis",   l: "Análisis",             ic: "📈" }
]

export function RemuneracionesApp({ cu, onVolverHubRrhh, onCerrarSesion }) {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem("rrhh_tab") || "dashboard" } catch { return "dashboard" }
  })

  useEffect(() => {
    try { localStorage.setItem("rrhh_tab", tab) } catch {}
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
          <div style={{fontSize:24}}>💰</div>
          <div>
            <div style={{fontSize:18,fontWeight:600}}>Remuneraciones</div>
            <div style={{fontSize:12,color:"var(--text-muted)"}}>
              Liquidaciones, honorarios y análisis · Outlet de Puertas
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

      {/* CONTENT */}
      <main style={{padding:24}}>
        {tab === "dashboard"  && <RemuneracionesDashboard cu={cu} />}
        {tab === "cargar"     && <RemuneracionesCarga cu={cu} onCargado={() => setTab("informe")} />}
        {tab === "honorarios" && <RemuneracionesHonorarios cu={cu} />}
        {tab === "informe"    && <RemuneracionesInforme cu={cu} />}
        {tab === "empleados"  && <RemuneracionesEmpleados cu={cu} />}
        {tab === "analisis"   && <RemuneracionesAnalisis cu={cu} />}
      </main>
    </div>
  )
}

const btnSec   = {padding:"10px 16px",background:"var(--bg-card)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:500}
const btnGhost = {padding:"8px 14px",background:"transparent",color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13}
