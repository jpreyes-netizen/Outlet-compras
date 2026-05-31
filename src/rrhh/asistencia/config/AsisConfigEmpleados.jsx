// src/rrhh/asistencia/config/AsisConfigEmpleados.jsx
// Mapeo manual de empleados Workera ↔ rrhh_empleados.
// Patrón Gmail-like: lista a la izquierda, detalle a la derecha.
//
// Features:
//  - Pre-match automático por nombre normalizado al cargar
//  - Sugerencias adicionales por match flojo (80% palabras) vía RPC
//  - Filtros: estado_mapeo (mapeado/pendiente/inactivo_sin_mapear), sucursal Workera, búsqueda
//  - Al confirmar: crea registro en asis_mapeo_empleados y UPDATE rrhh_empleados.rut

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabase'

export function AsisConfigEmpleados({ cu }) {
  const [staging, setStaging] = useState([])         // de v_asis_staging_empleados
  const [empleadosErp, setEmpleadosErp] = useState([]) // rrhh_empleados activos
  const [cargando, setCargando] = useState(true)
  const [seleccionado, setSeleccionado] = useState(null)  // workera_code
  const [candidatos, setCandidatos] = useState([])        // sugerencias del seleccionado
  const [cargandoCand, setCargandoCand] = useState(false)
  const [filtro, setFiltro] = useState({
    estado: 'todos',     // todos | pendiente | mapeado | inactivo_sin_mapear
    sucursal: 'todas',   // 'todas' | workera_branch_code
    mostrarInactivos: false,
    busqueda: ''
  })
  const [msg, setMsg] = useState(null)
  const [autoMatchActivo, setAutoMatchActivo] = useState(false)
  const [autoMatchPropuestos, setAutoMatchPropuestos] = useState([]) // [{workera_code, cod_contaline, nombre_erp}]

  useEffect(() => { cargarTodo() }, [])
  useEffect(() => { if (seleccionado) cargarCandidatos(seleccionado) }, [seleccionado])

  async function cargarTodo() {
    setCargando(true)
    try {
      const [stg, erp] = await Promise.all([
        supabase.from('v_asis_staging_empleados').select('*').order('nombre_completo'),
        supabase.from('rrhh_empleados').select('cod_contaline, nombre, rut, sucursal_id, cargo')
          .eq('activo', true).order('nombre')
      ])
      if (stg.error) throw stg.error
      if (erp.error) throw erp.error
      setStaging(stg.data || [])
      setEmpleadosErp(erp.data || [])

      // Pre-calcular auto-match propuestos (exactos por nombre normalizado)
      await calcularAutoMatch(stg.data || [])
    } catch (e) {
      setMsg({ tipo:'error', txt:'Error: ' + e.message })
    } finally {
      setCargando(false)
    }
  }

  async function calcularAutoMatch(stagingData) {
    const pendientes = stagingData.filter(s => s.estado_mapeo === 'pendiente' && s.employee_status === 'ACTIVO')
    const propuestas = []
    for (const s of pendientes) {
      try {
        const { data, error } = await supabase.rpc('asis_buscar_candidatos_match', {
          p_workera_nombre: s.nombre_completo,
          p_limit: 1
        })
        if (!error && data && data.length > 0 && data[0].metodo === 'exacto' && data[0].score >= 0.95) {
          // Verificar que ese cod_contaline no esté propuesto ya para otro Workera
          const yaPropuesto = propuestas.find(p => p.cod_contaline === data[0].cod_contaline)
          if (!yaPropuesto) {
            propuestas.push({
              workera_code: s.workera_code,
              workera_nombre: s.nombre_completo,
              cod_contaline: data[0].cod_contaline,
              nombre_erp: data[0].nombre,
              identification: s.identification
            })
          }
        }
      } catch {}
    }
    setAutoMatchPropuestos(propuestas)
  }

  async function cargarCandidatos(workera_code) {
    setCargandoCand(true)
    setCandidatos([])
    try {
      const emp = staging.find(s => s.workera_code === workera_code)
      if (!emp) return
      const { data, error } = await supabase.rpc('asis_buscar_candidatos_match', {
        p_workera_nombre: emp.nombre_completo,
        p_limit: 8
      })
      if (error) throw error
      setCandidatos(data || [])
    } catch (e) {
      console.error('Error candidatos:', e)
    } finally {
      setCargandoCand(false)
    }
  }

  async function confirmarMapeo(workera_code, cod_contaline, metodo, confianza) {
    try {
      const emp = staging.find(s => s.workera_code === workera_code)
      if (!emp) return

      // 1) Crear/actualizar mapeo
      const { error: errMap } = await supabase
        .from('asis_mapeo_empleados')
        .upsert({
          cod_contaline,
          workera_code,
          workera_device_code: emp.raw?.deviceCode ?? null,
          workera_dept_code:   emp.workera_dept_code,
          workera_branch_code: emp.workera_branch_code,
          match_metodo: metodo,
          rut_normalizado: emp.identification,
          nombre_normalizado: emp.nombre_completo,
          confianza,
          updated_at: new Date().toISOString()
        }, { onConflict: 'cod_contaline' })
      if (errMap) throw errMap

      // 2) Actualizar RUT en rrhh_empleados si está vacío
      const empErp = empleadosErp.find(e => e.cod_contaline === cod_contaline)
      if (empErp && !empErp.rut && emp.identification) {
        const { error: errRut } = await supabase
          .from('rrhh_empleados')
          .update({ rut: emp.identification, updated_at: new Date().toISOString() })
          .eq('cod_contaline', cod_contaline)
        if (errRut) console.warn('No se pudo actualizar RUT:', errRut.message)
      }

      setMsg({ tipo:'ok', txt: `Mapeado: ${emp.nombre_completo}` })
      setTimeout(() => setMsg(null), 3000)
      cargarTodo()
    } catch (e) {
      setMsg({ tipo:'error', txt:'Error: ' + e.message })
    }
  }

  async function quitarMapeo(workera_code) {
    if (!confirm('¿Quitar mapeo de este empleado?')) return
    try {
      const emp = staging.find(s => s.workera_code === workera_code)
      if (!emp || !emp.mapeo_cod_contaline) return
      const { error } = await supabase
        .from('asis_mapeo_empleados')
        .delete()
        .eq('cod_contaline', emp.mapeo_cod_contaline)
      if (error) throw error
      setMsg({ tipo:'ok', txt:'Mapeo eliminado' })
      setTimeout(() => setMsg(null), 3000)
      cargarTodo()
    } catch (e) {
      setMsg({ tipo:'error', txt:'Error: ' + e.message })
    }
  }

  async function aplicarAutoMatchTodos() {
    if (!confirm(`Confirmar ${autoMatchPropuestos.length} mapeos automáticos?`)) return
    setAutoMatchActivo(true)
    try {
      for (const p of autoMatchPropuestos) {
        await confirmarMapeo(p.workera_code, p.cod_contaline, 'exacto', 1.00)
      }
      setMsg({ tipo:'ok', txt: `${autoMatchPropuestos.length} mapeos aplicados` })
      setAutoMatchPropuestos([])
    } catch (e) {
      setMsg({ tipo:'error', txt: 'Error aplicando: ' + e.message })
    } finally {
      setAutoMatchActivo(false)
    }
  }

  // Lista filtrada
  const sucursalesWorkera = useMemo(() => {
    const set = new Map()
    staging.forEach(s => {
      if (s.workera_branch_code) set.set(s.workera_branch_code, s.workera_branch_name)
    })
    return Array.from(set.entries())
  }, [staging])

  const listaFiltrada = useMemo(() => {
    return staging.filter(s => {
      if (filtro.estado !== 'todos' && s.estado_mapeo !== filtro.estado) return false
      if (filtro.sucursal !== 'todas' && s.workera_branch_code !== filtro.sucursal) return false
      if (!filtro.mostrarInactivos && s.employee_status === 'INACTIVO') return false
      if (filtro.busqueda) {
        const b = filtro.busqueda.toLowerCase()
        if (!s.nombre_completo?.toLowerCase().includes(b) &&
            !s.identification?.toLowerCase().includes(b) &&
            !s.workera_code?.toLowerCase().includes(b)) return false
      }
      return true
    })
  }, [staging, filtro])

  const empSeleccionado = staging.find(s => s.workera_code === seleccionado)

  // Métricas
  const metricas = useMemo(() => {
    const total = staging.length
    const mapeados = staging.filter(s => s.estado_mapeo === 'mapeado').length
    const pendientes = staging.filter(s => s.estado_mapeo === 'pendiente').length
    const inactivos = staging.filter(s => s.employee_status === 'INACTIVO').length
    return { total, mapeados, pendientes, inactivos }
  }, [staging])

  if (cargando) return <div style={{padding:40,textAlign:"center",color:"var(--text-muted)"}}>Cargando empleados...</div>

  return (
    <div>
      <h2 style={{fontSize:22, fontWeight:700, margin:"0 0 4px 0"}}>Mapeo de Empleados</h2>
      <p style={{color:"var(--text-muted)", fontSize:13, margin:"0 0 16px 0"}}>
        Relaciona los empleados de Workera con los empleados del ERP.
        El sistema sugiere matches automáticos por nombre normalizado.
      </p>

      {/* Métricas */}
      <div style={{display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:10, marginBottom:16}}>
        <Metric label="Total Workera" v={metricas.total} c="var(--text)" />
        <Metric label="Mapeados" v={metricas.mapeados} c="var(--success)" />
        <Metric label="Pendientes" v={metricas.pendientes} c="var(--warning)" />
        <Metric label="Inactivos" v={metricas.inactivos} c="var(--text-muted)" />
      </div>

      {/* Banner auto-match */}
      {autoMatchPropuestos.length > 0 && (
        <div style={{
          padding:"14px 16px", marginBottom:16,
          background:"var(--accent)10",
          border:"1px solid var(--accent)40",
          borderRadius:10,
          display:"flex", alignItems:"center", justifyContent:"space-between", gap:14
        }}>
          <div>
            <div style={{fontSize:14, fontWeight:700, color:"var(--accent)"}}>
              ⚡ {autoMatchPropuestos.length} matches automáticos detectados
            </div>
            <div style={{fontSize:12, color:"var(--text-muted)", marginTop:2}}>
              Coincidencia exacta por nombre normalizado. Confirma todos en un click.
            </div>
          </div>
          <button onClick={aplicarAutoMatchTodos} disabled={autoMatchActivo} style={{
            padding:"10px 18px", background:"var(--accent)", color:"white",
            border:"none", borderRadius:8, cursor: autoMatchActivo ? "wait" : "pointer",
            fontSize:13, fontWeight:600
          }}>
            {autoMatchActivo ? "Aplicando..." : `Confirmar ${autoMatchPropuestos.length} matches`}
          </button>
        </div>
      )}

      {msg && (
        <div style={{
          marginBottom:14, padding:"10px 14px", borderRadius:8,
          background: msg.tipo === 'ok' ? "var(--success)15" : "var(--danger)15",
          color: msg.tipo === 'ok' ? "var(--success)" : "var(--danger)",
          fontSize:13, fontWeight:500
        }}>{msg.txt}</div>
      )}

      {/* Layout Gmail-like */}
      <div style={{display:"flex", gap:14, height:"calc(100vh - 380px)", minHeight:500}}>

        {/* COLUMNA IZQ: filtros + lista */}
        <div style={{
          width:380, flexShrink:0,
          display:"flex", flexDirection:"column", gap:8,
          background:"var(--bg-surface)", border:"1px solid var(--border)",
          borderRadius:10, padding:10
        }}>
          {/* Búsqueda */}
          <input
            type="search"
            placeholder="🔍 Buscar nombre, RUT o código..."
            value={filtro.busqueda}
            onChange={e => setFiltro({...filtro, busqueda: e.target.value})}
            style={{
              padding:"8px 12px", border:"1px solid var(--border)", borderRadius:8,
              fontSize:13, background:"var(--bg-app)", color:"var(--text)",
              fontFamily:"inherit", outline:"none"
            }}
          />

          {/* Filtros chips */}
          <div style={{display:"flex", gap:4, flexWrap:"wrap"}}>
            {[
              { k:'todos',      l:'Todos',      n: metricas.total },
              { k:'pendiente',  l:'Pendientes', n: metricas.pendientes },
              { k:'mapeado',    l:'Mapeados',   n: metricas.mapeados }
            ].map(f => (
              <button key={f.k} onClick={() => setFiltro({...filtro, estado: f.k})}
                style={{
                  padding:"4px 10px", borderRadius:100, fontSize:11, fontWeight:600,
                  border:"1px solid var(--border)",
                  background: filtro.estado === f.k ? "var(--accent)" : "transparent",
                  color: filtro.estado === f.k ? "white" : "var(--text)",
                  cursor:"pointer"
                }}>
                {f.l} ({f.n})
              </button>
            ))}
          </div>

          {/* Filtros adicionales */}
          <div style={{display:"flex", gap:6, alignItems:"center"}}>
            <select value={filtro.sucursal} onChange={e => setFiltro({...filtro, sucursal: e.target.value})}
              style={{flex:1, padding:"6px 10px", borderRadius:6, fontSize:12, border:"1px solid var(--border)", background:"var(--bg-app)", color:"var(--text)"}}>
              <option value="todas">Todas las sucursales</option>
              {sucursalesWorkera.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
            <label style={{fontSize:11, display:"flex", alignItems:"center", gap:4, cursor:"pointer"}}>
              <input type="checkbox" checked={filtro.mostrarInactivos}
                onChange={e => setFiltro({...filtro, mostrarInactivos: e.target.checked})} />
              Inactivos
            </label>
          </div>

          {/* Lista */}
          <div style={{flex:1, overflow:"auto", marginTop:6, display:"flex", flexDirection:"column", gap:4}}>
            {listaFiltrada.length === 0 ? (
              <div style={{padding:30, textAlign:"center", color:"var(--text-muted)", fontSize:13}}>
                Sin resultados
              </div>
            ) : listaFiltrada.map(s => {
              const isSel = seleccionado === s.workera_code
              const isInactivo = s.employee_status === 'INACTIVO'
              const isMapeado = s.estado_mapeo === 'mapeado'
              return (
                <button key={s.workera_code} onClick={() => setSeleccionado(s.workera_code)}
                  style={{
                    textAlign:"left", padding:"10px 12px", borderRadius:8,
                    border:`1px solid ${isSel ? "var(--accent)" : "transparent"}`,
                    background: isSel ? "var(--accent)10" : isInactivo ? "var(--text-muted)05" : "transparent",
                    cursor:"pointer", display:"flex", flexDirection:"column", gap:3,
                    opacity: isInactivo ? 0.75 : 1
                  }}>
                  <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:8}}>
                    <div style={{fontWeight:600, fontSize:13, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                      {s.nombre_completo}
                    </div>
                    {isMapeado && <span title="Mapeado" style={{fontSize:14}}>✅</span>}
                    {isInactivo && <span style={{fontSize:9, fontWeight:700, padding:"1px 6px", borderRadius:100, background:"var(--text-muted)20", color:"var(--text-muted)"}}>INACTIVO</span>}
                  </div>
                  <div style={{fontSize:11, color:"var(--text-muted)", display:"flex", gap:8}}>
                    <span>{s.identification || 'sin RUT'}</span>
                    <span>·</span>
                    <span>{s.workera_branch_name}</span>
                  </div>
                </button>
              )
            })}
          </div>
          <div style={{fontSize:11, color:"var(--text-muted)", textAlign:"center", padding:"6px 0"}}>
            {listaFiltrada.length} de {staging.length}
          </div>
        </div>

        {/* COLUMNA DER: detalle */}
        <div style={{
          flex:1, minWidth:0,
          background:"var(--bg-surface)", border:"1px solid var(--border)",
          borderRadius:10, padding:20, overflow:"auto"
        }}>
          {!empSeleccionado ? (
            <div style={{padding:60, textAlign:"center", color:"var(--text-muted)"}}>
              <div style={{fontSize:48, marginBottom:12}}>👥</div>
              Selecciona un empleado para mapear
            </div>
          ) : (
            <DetalleEmpleado
              emp={empSeleccionado}
              candidatos={candidatos}
              cargandoCand={cargandoCand}
              empleadosErp={empleadosErp}
              onConfirmar={confirmarMapeo}
              onQuitar={quitarMapeo}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function DetalleEmpleado({ emp, candidatos, cargandoCand, empleadosErp, onConfirmar, onQuitar }) {
  const [manual, setManual] = useState('')
  const isMapeado = emp.estado_mapeo === 'mapeado'

  return (
    <div>
      {/* Header con datos Workera */}
      <div style={{marginBottom:20}}>
        <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:6}}>
          <h3 style={{margin:0, fontSize:18, fontWeight:700}}>{emp.nombre_completo}</h3>
          {emp.employee_status === 'INACTIVO' && (
            <span style={{fontSize:11, fontWeight:700, padding:"2px 10px", borderRadius:100, background:"var(--text-muted)20", color:"var(--text-muted)"}}>
              INACTIVO
            </span>
          )}
        </div>
        <div style={{display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:"6px 16px", fontSize:13}}>
          <div><span style={{color:"var(--text-muted)"}}>RUT Workera:</span> <strong>{emp.identification || '—'}</strong></div>
          <div><span style={{color:"var(--text-muted)"}}>Código:</span> <code>{emp.workera_code}</code></div>
          <div><span style={{color:"var(--text-muted)"}}>Sucursal Workera:</span> {emp.workera_branch_name}</div>
          <div><span style={{color:"var(--text-muted)"}}>Departamento:</span> {emp.workera_dept_name}</div>
        </div>
      </div>

      {/* Estado actual */}
      {isMapeado ? (
        <div style={{
          padding:"14px 16px", borderRadius:10, marginBottom:16,
          background:"var(--success)10", border:"1px solid var(--success)40"
        }}>
          <div style={{fontSize:13, fontWeight:700, color:"var(--success)", marginBottom:6}}>
            ✅ Mapeado a empleado ERP
          </div>
          <div style={{fontSize:14, marginBottom:8}}><strong>{emp.mapeo_nombre_erp}</strong></div>
          <div style={{fontSize:12, color:"var(--text-muted)", marginBottom:10}}>
            cod_contaline: <code>{emp.mapeo_cod_contaline}</code> · método: {emp.mapeo_metodo} · confianza: {emp.mapeo_confianza}
          </div>
          <button onClick={() => onQuitar(emp.workera_code)} style={btnDanger}>
            🗑 Quitar mapeo
          </button>
        </div>
      ) : (
        <>
          {/* Candidatos sugeridos */}
          <div style={{marginBottom:20}}>
            <h4 style={{margin:"0 0 10px 0", fontSize:13, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.04em"}}>
              Candidatos sugeridos
            </h4>
            {cargandoCand ? (
              <div style={{color:"var(--text-muted)", fontSize:13}}>Buscando...</div>
            ) : candidatos.length === 0 ? (
              <div style={{color:"var(--text-muted)", fontSize:13, fontStyle:"italic"}}>
                Sin candidatos sugeridos (puedes seleccionar manualmente abajo)
              </div>
            ) : (
              <div style={{display:"flex", flexDirection:"column", gap:6}}>
                {candidatos.map(c => (
                  <div key={c.cod_contaline} style={{
                    padding:"10px 14px", borderRadius:8,
                    background:"var(--bg-app)", border:"1px solid var(--border)",
                    display:"flex", alignItems:"center", gap:12
                  }}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600, fontSize:13}}>{c.nombre}</div>
                      <div style={{fontSize:11, color:"var(--text-muted)"}}>
                        cod_contaline: <code>{c.cod_contaline}</code> · sucursal: {c.sucursal_id}
                      </div>
                    </div>
                    <span style={{
                      fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:100,
                      background: c.metodo === 'exacto' ? "var(--success)20" :
                                  c.metodo === 'fuerte' ? "var(--accent)20" : "var(--warning)20",
                      color: c.metodo === 'exacto' ? "var(--success)" :
                             c.metodo === 'fuerte' ? "var(--accent)" : "var(--warning)"
                    }}>
                      {c.metodo} · {(c.score * 100).toFixed(0)}%
                    </span>
                    <button onClick={() => onConfirmar(emp.workera_code, c.cod_contaline, c.metodo, c.score)} style={btnPriSmall}>
                      Mapear
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Selección manual */}
          <div>
            <h4 style={{margin:"0 0 10px 0", fontSize:13, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.04em"}}>
              O buscar manualmente
            </h4>
            <select value={manual} onChange={e => setManual(e.target.value)} style={{
              width:"100%", padding:"10px 12px", borderRadius:8, fontSize:13,
              border:"1px solid var(--border)", background:"var(--bg-app)", color:"var(--text)"
            }}>
              <option value="">Selecciona un empleado ERP...</option>
              {empleadosErp.map(e => (
                <option key={e.cod_contaline} value={e.cod_contaline}>
                  {e.nombre} ({e.sucursal_id} · {e.cod_contaline})
                </option>
              ))}
            </select>
            {manual && (
              <button onClick={() => onConfirmar(emp.workera_code, parseInt(manual), 'manual', 1.00)}
                style={{...btnPriSmall, marginTop:10}}>
                Confirmar mapeo manual
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Metric({ label, v, c }) {
  return (
    <div style={{
      background:"var(--bg-surface)", border:"1px solid var(--border)",
      borderRadius:10, padding:"12px 14px"
    }}>
      <div style={{fontSize:11, color:"var(--text-muted)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.04em"}}>{label}</div>
      <div style={{fontSize:24, fontWeight:800, color: c, marginTop:2}}>{v}</div>
    </div>
  )
}

const btnPriSmall = { padding:"8px 14px", background:"var(--accent)", color:"white", border:"none", borderRadius:6, cursor:"pointer", fontSize:12, fontWeight:600 }
const btnDanger   = { padding:"8px 14px", background:"var(--danger)15", color:"var(--danger)", border:"1px solid var(--danger)40", borderRadius:6, cursor:"pointer", fontSize:12, fontWeight:600 }
