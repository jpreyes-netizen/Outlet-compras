import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'

export function AdminAccesos({ cu, isMobile }) {
  const [usuarios, setUsuarios] = useState([])
  const [apps, setApps] = useState([])
  const [roles, setRoles] = useState([])
  const [accesos, setAccesos] = useState([])  // [{ usuario_id, app_codigo, rol_id, sucursal_id, activo }]
  const [sucursales, setSucursales] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [mensaje, setMensaje] = useState(null)
  const [busqueda, setBusqueda] = useState("")
  const [filtroApp, setFiltroApp] = useState("")
  const [filtroSinAcceso, setFiltroSinAcceso] = useState(false)

  // Edición de celda
  const [editando, setEditando] = useState(null)  // { usuario, app }
  const [rolElegido, setRolElegido] = useState("")
  const [sucursalElegida, setSucursalElegida] = useState("")
  const [guardando, setGuardando] = useState(false)

  const cargar = async () => {
    setLoading(true)
    setError(null)
    try {
      const [ru, ra, rr, rua, rs] = await Promise.all([
        supabase.from('usuarios').select('id, nombre, correo, rol, activo, avatar').eq('activo', true).order('nombre'),
        supabase.from('apps').select('codigo, nombre, icono, color, activa, orden').order('orden'),
        supabase.from('roles_app').select('id, app_codigo, codigo_rol, nombre, color').eq('activo', true).order('orden'),
        supabase.from('usuario_acceso').select('*').eq('activo', true),
        supabase.from('sucursales').select('id, nombre, codigo').order('orden')
      ])
      if (ru.error) throw ru.error
      if (ra.error) throw ra.error
      if (rr.error) throw rr.error
      if (rua.error) throw rua.error

      setUsuarios(ru.data || [])
      setApps(ra.data || [])
      setRoles(rr.data || [])
      setAccesos(rua.data || [])
      setSucursales(rs.data || [])
    } catch (e) {
      setError(e.message || "Error al cargar matriz")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  // Lookup rápido: { "user_id|app_codigo": acceso }
  const accesoMap = useMemo(() => {
    const m = {}
    accesos.forEach(a => { m[`${a.usuario_id}|${a.app_codigo}`] = a })
    return m
  }, [accesos])

  // Apps a mostrar (solo activas)
  const appsActivas = useMemo(() => apps.filter(a => a.activa), [apps])

  // Roles por app (lookup)
  const rolesPorApp = useMemo(() => {
    const m = {}
    roles.forEach(r => {
      if (!m[r.app_codigo]) m[r.app_codigo] = []
      m[r.app_codigo].push(r)
    })
    return m
  }, [roles])

  // Usuarios filtrados
  const usuariosFiltrados = useMemo(() => {
    return usuarios.filter(u => {
      if (busqueda) {
        const q = busqueda.toLowerCase().trim()
        if (!(u.nombre || "").toLowerCase().includes(q) && !(u.correo || "").toLowerCase().includes(q)) return false
      }
      if (filtroSinAcceso) {
        const tieneAlguno = appsActivas.some(a => accesoMap[`${u.id}|${a.codigo}`])
        if (tieneAlguno) return false
      }
      return true
    })
  }, [usuarios, busqueda, filtroSinAcceso, appsActivas, accesoMap])

  // Click en celda → abre editor
  const abrirEditor = (usuario, app) => {
    const acceso = accesoMap[`${usuario.id}|${app.codigo}`]
    setEditando({ usuario, app })
    setRolElegido(acceso?.rol_id || "")
    setSucursalElegida(acceso?.sucursal_id || "")
  }

  const cerrarEditor = () => {
    setEditando(null)
    setRolElegido("")
    setSucursalElegida("")
  }

  const guardarAcceso = async () => {
    if (!editando) return
    setGuardando(true)
    setMensaje(null)
    try {
      const { usuario, app } = editando
      const accesoActual = accesoMap[`${usuario.id}|${app.codigo}`]

      // Caso 1: Sin rol elegido → eliminar acceso si existe
      if (!rolElegido) {
        if (accesoActual) {
          const { error } = await supabase.from('usuario_acceso').delete()
            .eq('usuario_id', usuario.id).eq('app_codigo', app.codigo)
          if (error) throw error
          setMensaje({ tipo: "ok", txt: `Acceso revocado: ${usuario.nombre} → ${app.nombre}` })
        }
      } else {
        // Caso 2: Hay rol → upsert
        const payload = {
          usuario_id: usuario.id,
          app_codigo: app.codigo,
          rol_id: rolElegido,
          sucursal_id: sucursalElegida || null,
          activo: true,
          asignado_por: cu.id,
          asignado_at: new Date().toISOString()
        }
        const { error } = await supabase.from('usuario_acceso').upsert(payload, { onConflict: 'usuario_id,app_codigo' })
        if (error) throw error
        setMensaje({ tipo: "ok", txt: `Acceso ${accesoActual ? 'actualizado' : 'asignado'}: ${usuario.nombre} → ${app.nombre}` })
      }
      await cargar()
      cerrarEditor()
    } catch (e) {
      setMensaje({ tipo: "error", txt: e.message })
    } finally {
      setGuardando(false)
    }
  }

  // Estadísticas
  const stats = useMemo(() => {
    const total = usuarios.length * appsActivas.length
    const asignados = accesos.filter(a => appsActivas.some(ap => ap.codigo === a.app_codigo)).length
    const sinAcceso = usuarios.filter(u => !appsActivas.some(a => accesoMap[`${u.id}|${a.codigo}`])).length
    return { total, asignados, sinAcceso, cobertura: total > 0 ? Math.round((asignados / total) * 100) : 0 }
  }, [usuarios, appsActivas, accesos, accesoMap])

  if (loading) {
    return <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Cargando matriz...</div>
  }

  return (
    <div>
      {/* Mensaje */}
      {mensaje && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, marginBottom: 12, fontSize: 13, fontWeight: 500,
          background: mensaje.tipo === "error" ? "var(--danger-bg)" : "var(--success)10",
          color: mensaje.tipo === "error" ? "var(--danger)" : "var(--success)",
          border: `1px solid ${mensaje.tipo === "error" ? "var(--danger-bg)" : "var(--success-bg)"}`,
          display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <span>{mensaje.tipo === "error" ? "⚠️" : "✓"} {mensaje.txt}</span>
          <button onClick={() => setMensaje(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
      )}

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--danger-bg)", color: "var(--danger)", marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
        <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Usuarios activos</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{usuarios.length}</div>
        </div>
        <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Apps activas</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{appsActivas.length}</div>
        </div>
        <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Accesos asignados</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--success)" }}>{stats.asignados}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{stats.cobertura}% cobertura</div>
        </div>
        <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Sin acceso a nada</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: stats.sinAcceso > 0 ? "var(--warning)" : "var(--text-muted)" }}>{stats.sinAcceso}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: 12, marginBottom: 12, border: "1px solid rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Buscar usuario..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            style={{ flex: "1 1 240px", padding: "9px 14px", borderRadius: 10, border: "1px solid var(--border-2)", fontSize: 13, outline: "none" }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, background: filtroSinAcceso ? "var(--warning-bg)" : "var(--bg-surface-2)", border: "1px solid " + (filtroSinAcceso ? "var(--warning)30" : "var(--border-2)"), cursor: "pointer", fontSize: 13, fontWeight: 600, color: filtroSinAcceso ? "var(--warning)" : "var(--text-secondary)" }}>
            <input type="checkbox" checked={filtroSinAcceso} onChange={e => setFiltroSinAcceso(e.target.checked)} style={{ cursor: "pointer" }} />
            Solo sin acceso
          </label>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
          Mostrando <strong>{usuariosFiltrados.length}</strong> usuarios. Click en una celda para asignar, cambiar o quitar acceso.
        </div>
      </div>

      {/* MATRIZ */}
      <div style={{ background: "var(--bg-surface)", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(0,0,0,0.04)" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead>
              <tr style={{ background: "var(--bg-surface-2)", borderBottom: "2px solid var(--border-2)" }}>
                <th style={{ padding: "12px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", position: "sticky", left: 0, background: "var(--bg-surface-2)", zIndex: 2 }}>
                  Usuario
                </th>
                {appsActivas.map(app => (
                  <th key={app.codigo} style={{ padding: "12px 10px", textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", minWidth: 110 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <span style={{ fontSize: 16 }}>{app.icono}</span>
                      <span>{app.nombre}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usuariosFiltrados.length === 0 ? (
                <tr><td colSpan={appsActivas.length + 1} style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                  No hay usuarios que coincidan con los filtros
                </td></tr>
              ) : usuariosFiltrados.map(u => (
                <tr key={u.id} style={{ borderBottom: "1px solid var(--bg-hover)" }}>
                  <td style={{ padding: "8px 14px", position: "sticky", left: 0, background: "var(--bg-surface)", zIndex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 14, background: "var(--text-primary)20", color: "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                        {u.avatar || (u.nombre || "?").split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{u.nombre}</div>
                        {!isMobile && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{u.correo}</div>}
                      </div>
                    </div>
                  </td>
                  {appsActivas.map(app => {
                    const acceso = accesoMap[`${u.id}|${app.codigo}`]
                    const rol = acceso ? roles.find(r => r.id === acceso.rol_id) : null
                    return (
                      <td key={app.codigo} style={{ padding: "8px 6px", textAlign: "center" }}>
                        <button
                          onClick={() => abrirEditor(u, app)}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 8,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            border: "1px solid " + (rol ? rol.color + "40" : "var(--border-2)"),
                            background: rol ? rol.color + "15" : "var(--bg-surface-2)",
                            color: rol ? rol.color : "var(--border-3)",
                            minWidth: 90,
                            transition: "all 0.15s"
                          }}
                          title={acceso ? `Click para cambiar (asignado: ${new Date(acceso.asignado_at).toLocaleDateString('es-CL')})` : "Click para asignar"}
                        >
                          {rol ? rol.nombre : "— sin acceso —"}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL EDITOR */}
      {editando && (
        <div onClick={cerrarEditor} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg-surface)", borderRadius: 20, padding: 28, width: "100%", maxWidth: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Editar acceso</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginTop: 4 }}>{editando.usuario.nombre}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{editando.usuario.correo}</div>
                <div style={{ marginTop: 10, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, background: editando.app.color + "15", borderRadius: 8, color: editando.app.color, fontSize: 13, fontWeight: 600 }}>
                  <span>{editando.app.icono}</span>
                  <span>{editando.app.nombre}</span>
                </div>
              </div>
              <button onClick={cerrarEditor} style={{ width: 32, height: 32, borderRadius: 16, background: "var(--bg-hover)", border: "none", cursor: "pointer", fontSize: 14 }}>×</button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>
                Rol en esta app
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: "1px solid " + (rolElegido === "" ? "var(--danger)" : "var(--border-2)"), background: rolElegido === "" ? "var(--danger)08" : "var(--bg-surface)", cursor: "pointer" }}>
                  <input type="radio" name="rol" checked={rolElegido === ""} onChange={() => setRolElegido("")} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--danger)" }}>Sin acceso (revocar)</span>
                </label>
                {(rolesPorApp[editando.app.codigo] || []).map(r => (
                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: "1px solid " + (rolElegido === r.id ? r.color : "var(--border-2)"), background: rolElegido === r.id ? r.color + "10" : "var(--bg-surface)", cursor: "pointer" }}>
                    <input type="radio" name="rol" checked={rolElegido === r.id} onChange={() => setRolElegido(r.id)} />
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: r.color }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: rolElegido === r.id ? r.color : "var(--text-primary)" }}>{r.nombre}</span>
                  </label>
                ))}
              </div>
            </div>

            {rolElegido && sucursales.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                  Sucursal asignada (opcional)
                </label>
                <select value={sucursalElegida} onChange={e => setSucursalElegida(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border-2)", fontSize: 13, background: "var(--bg-surface)" }}>
                  <option value="">Todas las sucursales (sin restricción)</option>
                  {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre} ({s.codigo})</option>)}
                </select>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Si seleccionas una sucursal, el usuario solo verá datos de esa sucursal en esta app.
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={cerrarEditor} style={{ padding: "10px 18px", borderRadius: 10, background: "var(--bg-hover)", color: "var(--text-secondary)", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Cancelar
              </button>
              <button disabled={guardando} onClick={guardarAcceso} style={{ padding: "10px 18px", borderRadius: 10, background: guardando ? "var(--text-muted)" : "var(--text-primary)", color: "var(--bg-surface)", border: "none", fontSize: 13, fontWeight: 600, cursor: guardando ? "default" : "pointer" }}>
                {guardando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
