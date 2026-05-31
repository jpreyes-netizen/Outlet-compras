// src/rrhh/asistencia/config/AsisConfigSync.jsx
// Panel de sync manual: catálogos, empleados, marcaciones, permisos, hhee.
// Muestra log de las últimas corridas.

import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'
import { callWorkera, ymd, rangoUltimosNDias } from '../lib/workeraApi'

const RANGOS_PRESET = [
  { k: 7,  l: "Últimos 7 días" },
  { k: 14, l: "Últimos 14 días" },
  { k: 30, l: "Últimos 30 días" },
  { k: 90, l: "Últimos 90 días" }
]

export function AsisConfigSync({ cu }) {
  const [log, setLog] = useState([])
  const [cargandoLog, setCargandoLog] = useState(true)
  const [accionActiva, setAccionActiva] = useState(null) // 'catalogos' | 'empleados' | 'marcaciones' | ...
  const [resultado, setResultado] = useState(null)
  const [rango, setRango] = useState(() => rangoUltimosNDias(7))
  const [rangoPreset, setRangoPreset] = useState(7)

  useEffect(() => { cargarLog() }, [])

  async function cargarLog() {
    setCargandoLog(true)
    try {
      const { data, error } = await supabase
        .from('asis_sync_log')
        .select('*')
        .order('inicio', { ascending: false })
        .limit(15)
      if (error) throw error
      setLog(data || [])
    } catch (e) {
      console.error('Error cargando log:', e)
    } finally {
      setCargandoLog(false)
    }
  }

  function aplicarPreset(n) {
    setRangoPreset(n)
    setRango(rangoUltimosNDias(n))
  }

  async function ejecutar(action, params = {}) {
    setAccionActiva(action)
    setResultado(null)
    try {
      const r = await callWorkera(action, params)
      setResultado({ ok: true, action, data: r })
      cargarLog()
    } catch (e) {
      setResultado({ ok: false, action, error: e.message })
      cargarLog()
    } finally {
      setAccionActiva(null)
    }
  }

  return (
    <div>
      <h2 style={{fontSize:22, fontWeight:700, margin:"0 0 4px 0"}}>Sincronización Manual</h2>
      <p style={{color:"var(--text-muted)", fontSize:13, margin:"0 0 24px 0"}}>
        Ejecuta sincronizaciones puntuales con Workera. Las acciones quedan registradas en el log de abajo.
      </p>

      {/* Sync sin rango */}
      <section style={{marginBottom:24}}>
        <h3 style={h3}>Catálogos y empleados</h3>
        <div style={cardGrid}>
          <SyncBtn
            label="Catálogos"
            ic="🏬"
            desc="Sucursales, departamentos y tipos de permiso"
            loading={accionActiva === 'sync_catalogos'}
            onClick={() => ejecutar('sync_catalogos')}
          />
          <SyncBtn
            label="Empleados"
            ic="👥"
            desc="Trae empleados Workera a staging para mapeo manual"
            loading={accionActiva === 'sync_empleados'}
            onClick={() => ejecutar('sync_empleados')}
          />
        </div>
      </section>

      {/* Selector de rango */}
      <section style={{marginBottom:24}}>
        <h3 style={h3}>Rango de sincronización</h3>
        <div style={{display:"flex", gap:8, marginBottom:12, flexWrap:"wrap"}}>
          {RANGOS_PRESET.map(r => (
            <button key={r.k} onClick={() => aplicarPreset(r.k)}
              style={{
                ...presetBtn,
                background: rangoPreset === r.k ? "var(--accent)15" : "transparent",
                color: rangoPreset === r.k ? "var(--accent)" : "var(--text)",
                borderColor: rangoPreset === r.k ? "var(--accent)" : "var(--border)"
              }}>
              {r.l}
            </button>
          ))}
        </div>
        <div style={{display:"flex", gap:12, alignItems:"center"}}>
          <div>
            <label style={lbl}>Desde</label>
            <input type="date" value={rango.desde}
              onChange={e => { setRango({...rango, desde: e.target.value}); setRangoPreset(null) }}
              style={input} />
          </div>
          <div>
            <label style={lbl}>Hasta</label>
            <input type="date" value={rango.hasta}
              onChange={e => { setRango({...rango, hasta: e.target.value}); setRangoPreset(null) }}
              style={input} />
          </div>
        </div>
      </section>

      {/* Sync con rango */}
      <section style={{marginBottom:24}}>
        <h3 style={h3}>Datos transaccionales</h3>
        <div style={cardGrid}>
          <SyncBtn label="Marcaciones" ic="🕐"
            desc={`Marcaciones desde ${rango.desde} a ${rango.hasta}`}
            loading={accionActiva === 'sync_marcaciones'}
            onClick={() => ejecutar('sync_marcaciones', rango)}
          />
          <SyncBtn label="Permisos" ic="📋"
            desc={`Licencias, vacaciones, etc. en el rango`}
            loading={accionActiva === 'sync_permisos'}
            onClick={() => ejecutar('sync_permisos', rango)}
          />
         <SyncBtn label="Horas Extras (autorizadas)" ic="⏱"
            desc={`Autorizaciones formales de HHEE en el rango`}
            loading={accionActiva === 'sync_hhee'}
            onClick={() => ejecutar('sync_hhee', rango)}
          />
         <SyncBtn label="Horas Fuera de Turno" ic="⏰"
            desc={`Horas trabajadas fuera de turno sin autorización formal`}
            loading={accionActiva === 'sync_hhee_trabajadas'}
            onClick={() => ejecutar('sync_hhee_trabajadas', rango)}
          />
          <SyncBtn label="Horarios esperados" ic="📅"
            desc={`Turnos asignados desde Workera (máx 60 días)`}
            loading={accionActiva === 'sync_horarios'}
            onClick={() => ejecutar('sync_horarios', rango)}
          />
        </div>
      </section>

      {/* Resultado última acción */}
      {resultado && (
        <div style={{
          marginBottom:24, padding:"16px 18px", borderRadius:12,
          background: resultado.ok ? "var(--success)10" : "var(--danger)10",
          border: `1px solid ${resultado.ok ? "var(--success)" : "var(--danger)"}40`
        }}>
          <div style={{fontSize:14, fontWeight:700, marginBottom:8, color: resultado.ok ? "var(--success)" : "var(--danger)"}}>
            {resultado.ok ? "✅" : "❌"} {resultado.action}
          </div>
          <pre style={{
            margin:0, fontSize:12, fontFamily:"monospace",
            background:"var(--bg-app)", padding:12, borderRadius:6,
            overflow:"auto", maxHeight:200, color:"var(--text)"
          }}>
            {JSON.stringify(resultado.data || { error: resultado.error }, null, 2)}
          </pre>
        </div>
      )}

      {/* Log de sincronizaciones */}
      <section>
        <h3 style={h3}>Últimas sincronizaciones</h3>
        <div style={{border:"1px solid var(--border)", borderRadius:10, overflow:"hidden", background:"var(--bg-surface)"}}>
          <table style={tbl}>
            <thead>
              <tr style={trHead}>
                <th style={th}>Tipo</th>
                <th style={th}>Inicio</th>
                <th style={th}>Duración</th>
                <th style={th}>Rango</th>
                <th style={{...th, textAlign:"right"}}>Consultados</th>
                <th style={{...th, textAlign:"right"}}>Nuevos</th>
                <th style={th}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {cargandoLog ? (
                <tr><td colSpan={7} style={{padding:24, textAlign:"center", color:"var(--text-muted)"}}>Cargando...</td></tr>
              ) : log.length === 0 ? (
                <tr><td colSpan={7} style={{padding:24, textAlign:"center", color:"var(--text-muted)"}}>Sin sincronizaciones aún</td></tr>
              ) : log.map(l => (
                <tr key={l.id}>
                  <td style={{...td, fontWeight:600}}>{l.tipo}</td>
                  <td style={td}>{new Date(l.inicio).toLocaleString('es-CL')}</td>
                  <td style={td}>{l.duracion_ms ? `${(l.duracion_ms/1000).toFixed(1)}s` : '—'}</td>
                  <td style={{...td, fontSize:11, color:"var(--text-muted)"}}>
                    {l.rango_desde && l.rango_hasta ? `${l.rango_desde} → ${l.rango_hasta}` : '—'}
                  </td>
                  <td style={{...td, textAlign:"right"}}>{l.registros_consultados ?? 0}</td>
                  <td style={{...td, textAlign:"right", fontWeight:600}}>{l.registros_nuevos ?? 0}</td>
                  <td style={td}>
                    <span style={{
                      fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:100,
                      background:
                        l.estado === 'ok'      ? "var(--success)15" :
                        l.estado === 'parcial' ? "var(--warning)15" :
                        l.estado === 'error'   ? "var(--danger)15"  : "var(--text-muted)15",
                      color:
                        l.estado === 'ok'      ? "var(--success)" :
                        l.estado === 'parcial' ? "var(--warning)" :
                        l.estado === 'error'   ? "var(--danger)"  : "var(--text-muted)"
                    }}>{l.estado}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{marginTop:8}}>
          <button onClick={cargarLog} style={btnSec}>🔄 Refrescar log</button>
        </div>
      </section>
    </div>
  )
}

function SyncBtn({ label, ic, desc, loading, onClick }) {
  return (
    <button onClick={onClick} disabled={loading} style={{
      background:"var(--bg-surface)", border:"1px solid var(--border)",
      borderRadius:12, padding:"16px 18px",
      cursor: loading ? "wait" : "pointer", textAlign:"left",
      opacity: loading ? 0.6 : 1,
      display:"flex", flexDirection:"column", gap:6,
      transition:"transform 0.15s, box-shadow 0.15s"
    }}
    onMouseOver={e => { if (!loading) { e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,0.08)" } }}
    onMouseOut={e =>  { e.currentTarget.style.transform="translateY(0)"; e.currentTarget.style.boxShadow="none" }}>
      <div style={{display:"flex", alignItems:"center", gap:10}}>
        <span style={{fontSize:22}}>{ic}</span>
        <div style={{fontWeight:700, fontSize:14}}>{label}</div>
        {loading && <span style={{fontSize:11, color:"var(--accent)", fontWeight:600, marginLeft:"auto"}}>Sincronizando...</span>}
      </div>
      <div style={{fontSize:12, color:"var(--text-muted)"}}>{desc}</div>
    </button>
  )
}

const h3 = { fontSize:14, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.05em", margin:"0 0 12px 0" }
const cardGrid = { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))", gap:10 }
const lbl = { display:"block", fontSize:11, fontWeight:600, color:"var(--text-muted)", marginBottom:4, textTransform:"uppercase", letterSpacing:"0.04em" }
const input = { padding:"8px 12px", border:"1px solid var(--border)", borderRadius:8, fontSize:13, background:"var(--bg-app)", color:"var(--text)", fontFamily:"inherit" }
const presetBtn = { padding:"6px 12px", border:"1px solid var(--border)", borderRadius:100, cursor:"pointer", fontSize:12, fontWeight:500, background:"transparent", transition:"all 0.15s" }
const btnSec = { padding:"8px 14px", background:"var(--bg-card)", color:"var(--text)", border:"1px solid var(--border)", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:500 }
const tbl = { width:"100%", borderCollapse:"collapse", fontSize:12 }
const trHead = { background:"var(--bg-app)" }
const th = { padding:"10px 12px", textAlign:"left", fontWeight:600, fontSize:10, textTransform:"uppercase", letterSpacing:"0.04em", color:"var(--text-muted)", borderBottom:"1px solid var(--border)" }
const td = { padding:"8px 12px", borderBottom:"1px solid var(--border)", verticalAlign:"middle" }
