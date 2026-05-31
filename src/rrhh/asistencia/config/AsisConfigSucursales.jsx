// src/rrhh/asistencia/config/AsisConfigSucursales.jsx
// Editor de mapeo ERP ↔ Workera para sucursales.
// Muestra catálogo Workera (read-only) y permite editar workera_code de cada sucursal ERP.

import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'

export function AsisConfigSucursales({ cu }) {
  const [mapeo, setMapeo] = useState([])
  const [catalogo, setCatalogo] = useState([])
  const [cargando, setCargando] = useState(true)
  const [editandoId, setEditandoId] = useState(null)
  const [edit, setEdit] = useState({})
  const [msg, setMsg] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCargando(true)
    try {
      const [m, c] = await Promise.all([
        supabase.from('asis_mapeo_sucursales')
          .select('*, sucursales!asis_mapeo_sucursales_sucursal_id_fkey(id, codigo, nombre, activo)')
          .order('sucursal_id'),
        supabase.from('asis_workera_sucursales')
          .select('workera_id, workera_code, workera_name, status, employees_count')
          .order('workera_code')
      ])
      if (m.error) throw m.error
      if (c.error) throw c.error
      setMapeo(m.data || [])
      setCatalogo(c.data || [])
    } catch (e) {
      setMsg({ tipo:'error', txt: e.message })
    } finally {
      setCargando(false)
    }
  }

  function iniciarEdit(row) {
    setEditandoId(row.sucursal_id)
    setEdit({
      workera_code: row.workera_code || '',
      workera_name: row.workera_name || '',
      activo: row.activo,
      notas: row.notas || ''
    })
  }

  function cancelarEdit() {
    setEditandoId(null)
    setEdit({})
  }

  async function guardar(sucursal_id) {
    try {
      const { error } = await supabase
        .from('asis_mapeo_sucursales')
        .update({
          workera_code: edit.workera_code.trim(),
          workera_name: edit.workera_name.trim(),
          activo:       !!edit.activo,
          notas:        edit.notas.trim() || null,
          updated_at:   new Date().toISOString()
        })
        .eq('sucursal_id', sucursal_id)
      if (error) throw error
      setMsg({ tipo:'ok', txt:'Mapeo actualizado' })
      setTimeout(() => setMsg(null), 3000)
      cancelarEdit()
      cargar()
    } catch (e) {
      setMsg({ tipo:'error', txt:'Error: ' + e.message })
    }
  }

  if (cargando) return <div style={{padding:40,textAlign:"center",color:"var(--text-muted)"}}>Cargando...</div>

  return (
    <div>
      <h2 style={{fontSize:22, fontWeight:700, margin:"0 0 4px 0"}}>Mapeo de Sucursales</h2>
      <p style={{color:"var(--text-muted)", fontSize:13, margin:"0 0 20px 0"}}>
        Relaciona las sucursales del ERP con las sucursales de Workera.
        Workera tiene <strong>{catalogo.length}</strong> sucursales sincronizadas en el catálogo local.
      </p>

      {msg && (
        <div style={{
          marginBottom:14, padding:"10px 14px", borderRadius:8,
          background: msg.tipo === 'ok' ? "var(--success)15" : "var(--danger)15",
          color: msg.tipo === 'ok' ? "var(--success)" : "var(--danger)",
          fontSize:13, fontWeight:500
        }}>{msg.txt}</div>
      )}

      {/* Catálogo Workera (referencia) */}
      <details style={{marginBottom:20}}>
        <summary style={{cursor:"pointer", fontSize:13, fontWeight:600, color:"var(--text-muted)", padding:"8px 0"}}>
          Ver catálogo Workera ({catalogo.length})
        </summary>
        <div style={{
          marginTop:8, border:"1px solid var(--border)", borderRadius:8,
          overflow:"hidden", background:"var(--bg-surface)"
        }}>
          <table style={tbl}>
            <thead>
              <tr style={trHead}>
                <th style={th}>Código</th>
                <th style={th}>Nombre</th>
                <th style={th}>Estado</th>
                <th style={{...th, textAlign:"right"}}>Empleados</th>
              </tr>
            </thead>
            <tbody>
              {catalogo.map(c => (
                <tr key={c.workera_id}>
                  <td style={{...td, fontWeight:600, fontFamily:"monospace"}}>{c.workera_code}</td>
                  <td style={td}>{c.workera_name}</td>
                  <td style={td}>
                    <span style={{
                      fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:100,
                      background: c.status === 'ACTIVO' ? "var(--success)15" : "var(--text-muted)15",
                      color: c.status === 'ACTIVO' ? "var(--success)" : "var(--text-muted)"
                    }}>{c.status}</span>
                  </td>
                  <td style={{...td, textAlign:"right"}}>{c.employees_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* Mapeo editable */}
      <div style={{border:"1px solid var(--border)", borderRadius:10, overflow:"hidden", background:"var(--bg-surface)"}}>
        <table style={tbl}>
          <thead>
            <tr style={trHead}>
              <th style={th}>ERP Sucursal</th>
              <th style={th}>Workera Code</th>
              <th style={th}>Workera Name</th>
              <th style={th}>Activo</th>
              <th style={th}>Notas</th>
              <th style={{...th, textAlign:"right"}}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {mapeo.map(row => {
              const editando = editandoId === row.sucursal_id
              const erp = row.sucursales
              return (
                <tr key={row.sucursal_id}>
                  <td style={td}>
                    <div style={{fontWeight:600}}>{erp?.nombre || row.sucursal_id}</div>
                    <div style={{fontSize:11, color:"var(--text-muted)"}}>{row.sucursal_id} · {erp?.codigo}</div>
                  </td>
                  <td style={td}>
                    {editando ? (
                      <select value={edit.workera_code} onChange={e => setEdit({...edit, workera_code: e.target.value})} style={selectSmall}>
                        <option value="">(sin mapear)</option>
                        {catalogo.map(c => (
                          <option key={c.workera_id} value={c.workera_code}>
                            {c.workera_code} — {c.workera_name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <code style={{fontFamily:"monospace", fontSize:13}}>{row.workera_code || <em style={{color:"var(--text-muted)"}}>—</em>}</code>
                    )}
                  </td>
                  <td style={td}>
                    {editando ? (
                      <input value={edit.workera_name} onChange={e => setEdit({...edit, workera_name: e.target.value})} style={inputSmall} />
                    ) : (row.workera_name || <em style={{color:"var(--text-muted)"}}>—</em>)}
                  </td>
                  <td style={td}>
                    {editando ? (
                      <input type="checkbox" checked={!!edit.activo} onChange={e => setEdit({...edit, activo: e.target.checked})} />
                    ) : (
                      <span style={{
                        fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:100,
                        background: row.activo ? "var(--success)15" : "var(--text-muted)15",
                        color: row.activo ? "var(--success)" : "var(--text-muted)"
                      }}>{row.activo ? "Activo" : "Inactivo"}</span>
                    )}
                  </td>
                  <td style={{...td, color:"var(--text-muted)", fontSize:12}}>
                    {editando ? (
                      <input value={edit.notas} onChange={e => setEdit({...edit, notas: e.target.value})} style={inputSmall} />
                    ) : (row.notas || '—')}
                  </td>
                  <td style={{...td, textAlign:"right"}}>
                    {editando ? (
                      <div style={{display:"flex", gap:6, justifyContent:"flex-end"}}>
                        <button onClick={() => guardar(row.sucursal_id)} style={btnPriSmall}>Guardar</button>
                        <button onClick={cancelarEdit} style={btnSecSmall}>Cancelar</button>
                      </div>
                    ) : (
                      <button onClick={() => iniciarEdit(row)} style={btnSecSmall}>Editar</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const tbl = { width:"100%", borderCollapse:"collapse", fontSize:13 }
const trHead = { background:"var(--bg-app)" }
const th = { padding:"10px 12px", textAlign:"left", fontWeight:600, fontSize:11, textTransform:"uppercase", letterSpacing:"0.04em", color:"var(--text-muted)", borderBottom:"1px solid var(--border)" }
const td = { padding:"10px 12px", borderBottom:"1px solid var(--border)", verticalAlign:"middle" }
const inputSmall = { padding:"6px 10px", border:"1px solid var(--border)", borderRadius:6, fontSize:13, background:"var(--bg-app)", color:"var(--text)", width:"100%", boxSizing:"border-box" }
const selectSmall = { ...inputSmall }
const btnPriSmall = { padding:"6px 12px", background:"var(--accent)", color:"white", border:"none", borderRadius:6, cursor:"pointer", fontSize:12, fontWeight:600 }
const btnSecSmall = { padding:"6px 12px", background:"var(--bg-card)", color:"var(--text)", border:"1px solid var(--border)", borderRadius:6, cursor:"pointer", fontSize:12 }
