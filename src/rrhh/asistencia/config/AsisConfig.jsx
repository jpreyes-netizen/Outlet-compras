// src/rrhh/asistencia/config/AsisConfig.jsx
// Orquestador del Tab Config en AsistenciaApp.
// Sub-secciones: Credenciales, Sucursales, Sync Manual, Empleados.

import { useState, useEffect } from 'react'
import { AsisConfigCredenciales } from './AsisConfigCredenciales'
import { AsisConfigSucursales }   from './AsisConfigSucursales'
import { AsisConfigSync }         from './AsisConfigSync'
import { AsisConfigEmpleados }    from './AsisConfigEmpleados'

const SUBSECCIONES = [
  { k: "credenciales", l: "Credenciales", ic: "🔐", desc: "API Workera + test conexión" },
  { k: "sucursales",   l: "Sucursales",   ic: "🏬", desc: "Mapeo ERP ↔ Workera" },
  { k: "empleados",    l: "Empleados",    ic: "👥", desc: "Mapeo manual de empleados" },
  { k: "sync",         l: "Sincronización", ic: "🔄", desc: "Sync manual + log de corridas" }
]

export function AsisConfig({ cu, subInicial }) {
  const [sub, setSub] = useState(() => {
    if (subInicial) return subInicial
    try { return localStorage.getItem("asis_config_sub") || "credenciales" } catch { return "credenciales" }
  })

  useEffect(() => {
    try { localStorage.setItem("asis_config_sub", sub) } catch {}
  }, [sub])

  return (
    <div style={{display:"flex", gap:24, minHeight:"calc(100vh - 200px)"}}>
      {/* Sidebar de sub-secciones */}
      <aside style={{
        width: 240, flexShrink: 0,
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 12, padding: 12,
        alignSelf: "flex-start"
      }}>
        <div style={{
          fontSize:11, fontWeight:700, color:"var(--text-muted)",
          textTransform:"uppercase", letterSpacing:"0.05em",
          padding: "6px 8px"
        }}>
          Configuración Asistencia
        </div>
        <nav style={{display:"flex", flexDirection:"column", gap:2, marginTop:4}}>
          {SUBSECCIONES.map(s => {
            const active = sub === s.k
            return (
              <button key={s.k} onClick={() => setSub(s.k)}
                style={{
                  display:"flex", alignItems:"center", gap:10,
                  padding:"10px 12px",
                  background: active ? "var(--accent)15" : "transparent",
                  border: "none",
                  borderRadius: 8,
                  cursor:"pointer",
                  textAlign:"left",
                  fontSize:13,
                  color: active ? "var(--accent)" : "var(--text)",
                  fontWeight: active ? 600 : 400,
                  transition: "background 0.15s"
                }}
                onMouseOver={e => { if (!active) e.currentTarget.style.background = "var(--bg-card)" }}
                onMouseOut={e =>  { if (!active) e.currentTarget.style.background = "transparent" }}
              >
                <span style={{fontSize:16}}>{s.ic}</span>
                <div style={{flex:1, minWidth:0}}>
                  <div>{s.l}</div>
                  <div style={{
                    fontSize:11, color:"var(--text-muted)",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"
                  }}>
                    {s.desc}
                  </div>
                </div>
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Contenido */}
      <section style={{flex:1, minWidth:0}}>
        {sub === "credenciales" && <AsisConfigCredenciales cu={cu} />}
        {sub === "sucursales"   && <AsisConfigSucursales cu={cu} />}
        {sub === "empleados"    && <AsisConfigEmpleados cu={cu} />}
        {sub === "sync"         && <AsisConfigSync cu={cu} />}
      </section>
    </div>
  )
}
