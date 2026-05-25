import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'

const css = {
  card:   { background:'#fff', borderRadius:16, padding:'16px 18px', boxShadow:'0 1px 3px rgba(0,0,0,0.06)', border:'1px solid rgba(0,0,0,0.04)' },
  input:  { width:'100%', padding:'10px 14px', borderRadius:12, border:'1px solid #e5e5ea', fontSize:14, background:'#fff', outline:'none', boxSizing:'border-box' },
  select: { width:'100%', padding:'10px 14px', borderRadius:12, border:'1px solid #e5e5ea', fontSize:14, background:'#fff', boxSizing:'border-box' },
  btn:    { padding:'10px 18px', borderRadius:10, fontSize:13, fontWeight:600, border:'none', cursor:'pointer' },
}

const SCOPE_LABELS = { all:'Sin restricción', sucursal:'Solo su sucursal', propio:'Solo sus registros' }
const SCOPE_COLORS = { all:'#34C759', sucursal:'#FF9500', propio:'#007AFF' }

export function AdminPermisos({ cu, isMobile }) {
  const [apps, setApps]             = useState([])
  const [roles, setRoles]           = useState([])
  const [caps, setCaps]             = useState([])
  const [rolCaps, setRolCaps]       = useState([])  // { rol_id, capability_id, scope_filter }
  const [loading, setLoading]       = useState(true)
  const [guardando, setGuardando]   = useState(false)
  const [mensaje, setMensaje]       = useState(null)

  // Selección
  const [appSel, setAppSel]         = useState('')
  const [rolSel, setRolSel]         = useState('')

  // Modal nuevo rol
  const [showNuevoRol, setShowNuevoRol] = useState(false)
  const [nuevoRol, setNuevoRol]     = useState({ codigo_rol:'', nombre:'', color:'#007AFF' })
  const [creandoRol, setCreandoRol] = useState(false)

  // Modal editar scope de una capability
  const [editScope, setEditScope]   = useState(null)  // { capability_id, scope_filter }

  const cargar = async () => {
    setLoading(true)
    try {
      const [ra, rr, rc, rrc] = await Promise.all([
        supabase.from('apps').select('codigo,nombre,icono,color').eq('activa', true).order('orden'),
        supabase.from('roles_app').select('id,app_codigo,codigo_rol,nombre,color,orden').order('app_codigo').order('orden'),
        supabase.from('capabilities').select('*').order('app_codigo').order('orden'),
        supabase.from('rol_capabilities').select('rol_id,capability_id,scope_filter'),
      ])
      setApps(ra.data || [])
      setRoles(rr.data || [])
      setCaps(rc.data || [])
      setRolCaps(rrc.data || [])
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { cargar() }, [])

  // Roles filtrados por app seleccionada
  const rolesFiltrados = useMemo(() =>
    roles.filter(r => !appSel || r.app_codigo === appSel)
  , [roles, appSel])

  // Capabilities del rol seleccionado (IDs como Set)
  const capsDelRol = useMemo(() => {
    const map = {}
    rolCaps.filter(rc => rc.rol_id === rolSel).forEach(rc => {
      map[rc.capability_id] = rc.scope_filter || 'all'
    })
    return map
  }, [rolCaps, rolSel])

  // Capabilities agrupadas por area para la app del rol seleccionado
  const rolObj = roles.find(r => r.id === rolSel)
  const capsApp = useMemo(() => {
    if (!rolObj) return {}
    const appCaps = caps.filter(c => c.app_codigo === rolObj.app_codigo)
    const grupos = {}
    appCaps.forEach(c => {
      const g = c.area || 'General'
      if (!grupos[g]) grupos[g] = []
      grupos[g].push(c)
    })
    return grupos
  }, [caps, rolObj])

  // Toggle capability del rol
  const toggleCap = async (capId, currentScope) => {
    if (!rolSel) return
    setGuardando(true)
    try {
      if (currentScope !== undefined) {
        // Quitar
        await supabase.from('rol_capabilities')
          .delete()
          .eq('rol_id', rolSel)
          .eq('capability_id', capId)
        setRolCaps(p => p.filter(rc => !(rc.rol_id === rolSel && rc.capability_id === capId)))
      } else {
        // Agregar con scope 'all' por defecto
        await supabase.from('rol_capabilities')
          .insert({ rol_id: rolSel, capability_id: capId, scope_filter: 'all', asignado_por: cu.id })
        setRolCaps(p => [...p, { rol_id: rolSel, capability_id: capId, scope_filter: 'all' }])
      }
    } catch(e) { setMensaje({ tipo:'error', txt: e.message }) }
    finally { setGuardando(false) }
  }

  // Cambiar scope de una capability
  const cambiarScope = async (capId, nuevoScope) => {
    setGuardando(true)
    try {
      await supabase.from('rol_capabilities')
        .update({ scope_filter: nuevoScope })
        .eq('rol_id', rolSel)
        .eq('capability_id', capId)
      setRolCaps(p => p.map(rc =>
        rc.rol_id === rolSel && rc.capability_id === capId
          ? { ...rc, scope_filter: nuevoScope }
          : rc
      ))
      setEditScope(null)
    } catch(e) { setMensaje({ tipo:'error', txt: e.message }) }
    finally { setGuardando(false) }
  }

  // Crear rol nuevo
  const crearRol = async () => {
    if (!appSel || !nuevoRol.codigo_rol || !nuevoRol.nombre) return
    setCreandoRol(true)
    try {
      const id = `${appSel}.${nuevoRol.codigo_rol}`
      const { error } = await supabase.from('roles_app').insert({
        id, app_codigo: appSel, codigo_rol: nuevoRol.codigo_rol,
        nombre: nuevoRol.nombre, color: nuevoRol.color,
        permisos: [], orden: 99
      })
      if (error) throw error
      setMensaje({ tipo:'ok', txt: `Rol ${id} creado correctamente` })
      setShowNuevoRol(false)
      setNuevoRol({ codigo_rol:'', nombre:'', color:'#007AFF' })
      await cargar()
    } catch(e) { setMensaje({ tipo:'error', txt: e.message }) }
    finally { setCreandoRol(false) }
  }

  if (loading) return (
    <div style={{ textAlign:'center', padding:60, color:'#8E8E93' }}>
      Cargando permisos...
    </div>
  )

  return (
    <div style={{ maxWidth:1100, margin:'0 auto', padding: isMobile ? '0 0 80px' : '0 0 40px' }}>

      {/* Header */}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:20, fontWeight:700, color:'#1C1C1E', marginBottom:4 }}>
          🔑 Gestión de Permisos
        </div>
        <div style={{ fontSize:13, color:'#8E8E93' }}>
          Selecciona un rol para ver y editar sus capabilities. Los cambios se aplican inmediatamente.
        </div>
      </div>

      {/* Mensaje */}
      {mensaje && (
        <div onClick={() => setMensaje(null)} style={{
          marginBottom:14, padding:'12px 16px', borderRadius:12, cursor:'pointer',
          background: mensaje.tipo === 'ok' ? '#34C75910' : '#FF3B3010',
          border: `1px solid ${mensaje.tipo === 'ok' ? '#34C75940' : '#FF3B3040'}`,
          color: mensaje.tipo === 'ok' ? '#34C759' : '#FF3B30', fontSize:13
        }}>
          {mensaje.tipo === 'ok' ? '✅' : '⚠️'} {mensaje.txt}
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '280px 1fr', gap:16 }}>

        {/* Panel izquierdo — selector */}
        <div>
          <div style={{ ...css.card, marginBottom:12 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'#8E8E93', marginBottom:10 }}>APLICACIÓN</div>
            <select style={css.select} value={appSel} onChange={e => { setAppSel(e.target.value); setRolSel('') }}>
              <option value=''>Todas las apps</option>
              {apps.map(a => <option key={a.codigo} value={a.codigo}>{a.icono} {a.nombre}</option>)}
            </select>
          </div>

          <div style={{ ...css.card, marginBottom:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#8E8E93' }}>ROL</div>
              {appSel && (
                <button onClick={() => setShowNuevoRol(true)} style={{
                  ...css.btn, padding:'4px 10px', fontSize:11,
                  background:'#007AFF15', color:'#007AFF'
                }}>+ Nuevo</button>
              )}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {rolesFiltrados.length === 0 && (
                <div style={{ fontSize:13, color:'#AEAEB2', textAlign:'center', padding:'12px 0' }}>
                  {appSel ? 'No hay roles para esta app' : 'Selecciona una app'}
                </div>
              )}
              {rolesFiltrados.map(r => (
                <button key={r.id} onClick={() => setRolSel(r.id)} style={{
                  padding:'10px 14px', borderRadius:10, border:'none', cursor:'pointer',
                  textAlign:'left', display:'flex', alignItems:'center', gap:10,
                  background: rolSel === r.id ? '#1C1C1E' : '#F2F2F7',
                  color: rolSel === r.id ? '#fff' : '#1C1C1E',
                  transition:'all 0.15s'
                }}>
                  <div style={{
                    width:10, height:10, borderRadius:5,
                    background: rolSel === r.id ? '#fff' : (r.color || '#8E8E93'),
                    flexShrink:0
                  }}/>
                  <div>
                    <div style={{ fontSize:13, fontWeight:600 }}>{r.nombre}</div>
                    <div style={{ fontSize:10, opacity:0.6 }}>{r.id}</div>
                  </div>
                  {rolSel === r.id && (
                    <div style={{ marginLeft:'auto', fontSize:11, background:'rgba(255,255,255,0.2)', padding:'2px 8px', borderRadius:10 }}>
                      {Object.keys(capsDelRol).length} caps
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Panel derecho — capabilities */}
        <div>
          {!rolSel ? (
            <div style={{ ...css.card, textAlign:'center', padding:60 }}>
              <div style={{ fontSize:40, marginBottom:12 }}>🎭</div>
              <div style={{ fontSize:16, fontWeight:600, color:'#1C1C1E', marginBottom:6 }}>
                Selecciona un rol
              </div>
              <div style={{ fontSize:13, color:'#8E8E93' }}>
                Elige una app y un rol para gestionar sus permisos
              </div>
            </div>
          ) : (
            <div style={{ ...css.card }}>
              {/* Header del rol */}
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20, paddingBottom:16, borderBottom:'1px solid #F2F2F7' }}>
                <div style={{ width:40, height:40, borderRadius:12, background: rolObj?.color || '#8E8E93', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize:16 }}>
                  {rolObj?.nombre?.[0] || '?'}
                </div>
                <div>
                  <div style={{ fontSize:17, fontWeight:700, color:'#1C1C1E' }}>{rolObj?.nombre}</div>
                  <div style={{ fontSize:12, color:'#8E8E93' }}>{rolSel} · {Object.keys(capsDelRol).length} capabilities asignadas</div>
                </div>
                {guardando && <div style={{ marginLeft:'auto', fontSize:12, color:'#8E8E93' }}>Guardando...</div>}
              </div>

              {/* Capabilities por grupo */}
              {Object.keys(capsApp).length === 0 ? (
                <div style={{ textAlign:'center', padding:40, color:'#8E8E93', fontSize:13 }}>
                  No hay capabilities definidas para esta app
                </div>
              ) : (
                Object.entries(capsApp).map(([grupo, grupoCaps]) => (
                  <div key={grupo} style={{ marginBottom:20 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#8E8E93', letterSpacing:'0.05em', marginBottom:10, textTransform:'uppercase' }}>
                      {grupo}
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      {grupoCaps.map(cap => {
                        const scope = capsDelRol[cap.id]
                        const asignada = scope !== undefined
                        return (
                          <div key={cap.id} style={{
                            display:'flex', alignItems:'center', gap:12,
                            padding:'10px 14px', borderRadius:10,
                            background: asignada ? '#34C75908' : '#F9F9F9',
                            border: `1px solid ${asignada ? '#34C75930' : '#F2F2F7'}`,
                            transition:'all 0.15s'
                          }}>
                            {/* Checkbox */}
                            <div onClick={() => toggleCap(cap.id, scope)} style={{
                              width:20, height:20, borderRadius:6, flexShrink:0,
                              background: asignada ? '#34C759' : '#fff',
                              border: `2px solid ${asignada ? '#34C759' : '#C7C7CC'}`,
                              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                              transition:'all 0.15s'
                            }}>
                              {asignada && <span style={{ color:'#fff', fontSize:12, fontWeight:700 }}>✓</span>}
                            </div>

                            {/* Info */}
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:13, fontWeight:600, color: asignada ? '#1C1C1E' : '#8E8E93' }}>
                                {cap.nombre}
                              </div>
                              {cap.descripcion && (
                                <div style={{ fontSize:11, color:'#AEAEB2', marginTop:2 }}>{cap.descripcion}</div>
                              )}
                              <div style={{ fontSize:10, color:'#C7C7CC', marginTop:1, fontFamily:'monospace' }}>{cap.id}</div>
                            </div>

                            {/* Scope badge — solo si está asignada */}
                            {asignada && (
                              <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                                <button onClick={() => setEditScope({ capId: cap.id, scope })} style={{
                                  padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600,
                                  border:'none', cursor:'pointer',
                                  background: (SCOPE_COLORS[scope] || '#8E8E93') + '20',
                                  color: SCOPE_COLORS[scope] || '#8E8E93'
                                }}>
                                  {SCOPE_LABELS[scope] || scope} ▾
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal editar scope */}
      {editScope && (
        <div onClick={() => setEditScope(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:20, padding:28, width:'100%', maxWidth:380 }}>
            <div style={{ fontSize:17, fontWeight:700, marginBottom:6 }}>Cambiar alcance</div>
            <div style={{ fontSize:12, color:'#8E8E93', marginBottom:20 }}>
              Define si este permiso aplica a todos los registros o solo a los de la sucursal del usuario.
            </div>
            {Object.entries(SCOPE_LABELS).map(([key, label]) => (
              <button key={key} onClick={() => cambiarScope(editScope.capId, key)} style={{
                width:'100%', padding:'12px 16px', borderRadius:12, marginBottom:8,
                border: `2px solid ${editScope.scope === key ? SCOPE_COLORS[key] : '#E5E5EA'}`,
                background: editScope.scope === key ? SCOPE_COLORS[key] + '15' : '#fff',
                cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:10
              }}>
                <div style={{ width:12, height:12, borderRadius:6, background: SCOPE_COLORS[key] || '#8E8E93', flexShrink:0 }}/>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'#1C1C1E' }}>{label}</div>
                  <div style={{ fontSize:11, color:'#8E8E93' }}>
                    {key === 'all' ? 'Ve y opera todos los registros sin filtro' :
                     key === 'sucursal' ? 'Solo ve registros de su sucursal asignada' :
                     'Solo ve sus propios registros'}
                  </div>
                </div>
                {editScope.scope === key && <span style={{ marginLeft:'auto', color: SCOPE_COLORS[key], fontWeight:700 }}>✓</span>}
              </button>
            ))}
            <button onClick={() => setEditScope(null)} style={{ ...css.btn, width:'100%', marginTop:4, background:'#F2F2F7', color:'#3A3A3C' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Modal nuevo rol */}
      {showNuevoRol && (
        <div onClick={() => setShowNuevoRol(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:20, padding:28, width:'100%', maxWidth:420 }}>
            <div style={{ fontSize:17, fontWeight:700, marginBottom:4 }}>Nuevo rol</div>
            <div style={{ fontSize:12, color:'#8E8E93', marginBottom:20 }}>
              App: <strong>{apps.find(a => a.codigo === appSel)?.nombre}</strong>
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#3A3A3C', marginBottom:6 }}>
                Código del rol <span style={{ color:'#FF3B30' }}>*</span>
              </label>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <div style={{ fontSize:13, color:'#8E8E93', whiteSpace:'nowrap' }}>{appSel}.</div>
                <input
                  style={css.input}
                  placeholder='ej: jefe_tienda'
                  value={nuevoRol.codigo_rol}
                  onChange={e => setNuevoRol(p => ({ ...p, codigo_rol: e.target.value.toLowerCase().replace(/\s/g,'_') }))}
                />
              </div>
              <div style={{ fontSize:11, color:'#AEAEB2', marginTop:4 }}>
                ID final: <code>{appSel}.{nuevoRol.codigo_rol || 'codigo'}</code>
              </div>
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#3A3A3C', marginBottom:6 }}>
                Nombre visible <span style={{ color:'#FF3B30' }}>*</span>
              </label>
              <input
                style={css.input}
                placeholder='ej: Jefe de Tienda'
                value={nuevoRol.nombre}
                onChange={e => setNuevoRol(p => ({ ...p, nombre: e.target.value }))}
              />
            </div>

            <div style={{ marginBottom:20 }}>
              <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#3A3A3C', marginBottom:6 }}>Color</label>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {['#FF3B30','#FF9500','#007AFF','#34C759','#AF52DE','#5AC8FA','#8E8E93'].map(c => (
                  <div key={c} onClick={() => setNuevoRol(p => ({ ...p, color: c }))} style={{
                    width:32, height:32, borderRadius:16, background:c, cursor:'pointer',
                    border: nuevoRol.color === c ? '3px solid #1C1C1E' : '3px solid transparent',
                    transition:'all 0.15s'
                  }}/>
                ))}
              </div>
            </div>

            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setShowNuevoRol(false)} style={{ ...css.btn, flex:1, background:'#F2F2F7', color:'#3A3A3C' }}>
                Cancelar
              </button>
              <button
                disabled={!nuevoRol.codigo_rol || !nuevoRol.nombre || creandoRol}
                onClick={crearRol}
                style={{ ...css.btn, flex:2, background: (!nuevoRol.codigo_rol || !nuevoRol.nombre) ? '#8E8E93' : '#1C1C1E', color:'#fff' }}
              >
                {creandoRol ? 'Creando...' : 'Crear rol'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
