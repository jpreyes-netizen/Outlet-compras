// src/rrhh/asistencia/AsistenciaApp.jsx
// Sub-app de Control de Asistencia - integracion con Workera
// Fase 3 completa: Dashboard, Marcaciones, Permisos, HHEE, Jornadas, Sync, Config

import { useState, useEffect } from 'react'
import { AsisConfig }       from './config/AsisConfig'
import { AsisDashboard }    from './tabs/AsisDashboard'
import { AsisMarcaciones }  from './tabs/AsisMarcaciones'
import { AsisPermisos }     from './tabs/AsisPermisos'
import { AsisHHEE }         from './tabs/AsisHHEE'
import { AsisJornadas }     from './tabs/AsisJornadas'

const ROLES = [
  { k:"admin",           l:"Admin",           c:"var(--danger)"  },
  { k:"dir_general",     l:"Dir. General",    c:"var(--danger)"  },
  { k:"dir_finanzas",    l:"Dir. Finanzas",   c:"var(--purple)"  },
  { k:"dir_negocios",    l:"Dir. Negocios",   c:"var(--accent)"  },
  { k:"dir_operaciones", l:"Dir. Operaciones",c:"var(--info)"    },
  { k:"analista",        l:"Analista",        c:"var(--success)" },
  { k:"directorio",      l:"Directorio",      c:"var(--text-muted)" }
]
const rl = u => ROLES.find(r => r.k === u?.rol) || ROLES[5]

const TABS = [
  { k:"dashboard",   l:"Dashboard",    ic:"📊" },
  { k:"marcaciones", l:"Marcaciones",  ic:"🕐" },
  { k:"permisos",    l:"Permisos",     ic:"📋" },
  { k:"hhee",        l:"Horas Extras", ic:"⏱"  },
  { k:"jornadas",    l:"Jornadas",     ic:"📅" },
  { k:"sync",        l:"Sync",         ic:"🔄" },
  { k:"config",      l:"Config",       ic:"⚙"  }
]

export function AsistenciaApp({ cu, onVolverHubRrhh, onCerrarSesion }) {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem("asis_tab") || "dashboard" } catch { return "dashboard" }
  })

  useEffect(() => {
    try { localStorage.setItem("asis_tab", tab) } catch {}
  }, [tab])

  // Navegacion directa a Config > Sync desde los estados vacios
  function irASync() {
    setTab('config')
    try { localStorage.setItem("asis_config_sub", "sync") } catch {}
  }

  return (
    <div style={{minHeight:"100vh",background:"var(--bg-app)"}}>
      {/* HEADER */}
      <header style={{
        background:"var(--bg-surface)",borderBottom:"1px solid var(--border)",
        padding:"14px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",
        position:"sticky",top:0,zIndex:50
      }}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <button onClick={onVolverHubRrhh} style={btnSec}>
            &larr; Gestion de Personas
          </button>
          <div style={{fontSize:24}}>🕐</div>
          <div>
            <div style={{fontSize:18,fontWeight:600}}>Control de Asistencia</div>
            <div style={{fontSize:12,color:"var(--text-muted)"}}>
              Integracion Workera · Outlet de Puertas
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
        {tab === "dashboard"   && <AsisDashboard   cu={cu} onIrASync={irASync} />}
        {tab === "marcaciones" && <AsisMarcaciones  cu={cu} onIrASync={irASync} />}
        {tab === "permisos"    && <AsisPermisos     cu={cu} onIrASync={irASync} />}
        {tab === "hhee"        && <AsisHHEE         cu={cu} onIrASync={irASync} />}
        {tab === "jornadas"    && <AsisJornadas     cu={cu} onIrASync={irASync} />}
        {tab === "sync"        && <AsisConfig       cu={cu} subInicial="sync" />}
        {tab === "config"      && <AsisConfig       cu={cu} />}
      </main>
    </div>
  )
}

const btnSec   = {padding:"8px 12px",background:"var(--bg-card)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:500}
const btnGhost = {padding:"8px 14px",background:"transparent",color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13}
