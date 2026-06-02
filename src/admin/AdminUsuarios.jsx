import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'

const ROLES_LEGADO = [
  // Roles ERP Compras
  { k: "admin",            l: "Admin",            c: "var(--danger)" },
  { k: "dir_general",      l: "Dir. General",     c: "var(--danger)" },
  { k: "dir_finanzas",     l: "Dir. Finanzas",    c: "var(--purple)" },
  { k: "dir_negocios",     l: "Dir. Negocios",    c: "var(--accent)" },
  { k: "dir_operaciones",  l: "Dir. Operaciones", c: "var(--info)" },
  { k: "analista",         l: "Analista",         c: "var(--success)" },
  { k: "jefe_bodega",      l: "Jefe Bodega",      c: "var(--warning)" },
  { k: "jefe_operaciones", l: "Jefe Operaciones", c: "var(--warning)" },
  { k: "directorio",       l: "Directorio",       c: "var(--text-muted)" },
  { k: "cajero",           l: "Cajero/Vendedor",  c: "var(--success)" },
  // Roles Finanzas
  { k: "tesorero",         l: "Tesorero",         c: "var(--purple)" },
  { k: "lector",           l: "Lector",           c: "var(--text-muted)" },
  // Roles compartidos
  { k: "jefe_tienda",      l: "Jefe de Tienda",   c: "var(--warning)" },
  { k: "gerencia",         l: "Gerencia",         c: "var(--danger)" },
  // Roles Postventa
  { k: "postventa",        l: "Ejecutivo PV",     c: "var(--accent)" },
  { k: "operaciones",      l: "Operaciones",      c: "var(--success)" },
  { k: "caja",             l: "Caja",             c: "var(--purple)" }
]

const rolInfo = k => ROLES_LEGADO.find(r => r.k === k) || { k, l: k, c: "var(--text-muted)" }

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function adminAction(accion, payload) {
  const res = await fetch(SUPABASE_URL + '/functions/v1/admin-actions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ accion, ...payload })
  })
  return res.json()
}

export function AdminUsuarios({ cu, isMobile }) {
  const [usuarios, setUsuarios] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState("")
  const [filtroRol, setFiltroRol] = useState("")
  const [filtroEstado, setFiltroEstado] = useState("activos")  // activos | inactivos | todos
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(formVacio())
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState(null)
  const [showReset, setShowReset] = useState(false)
  const [resetUser, setResetUser] = useState(null)
  const [resetPass, setResetPass] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [impersonando, setImpersonando] = useState(null)

  function formVacio() {
    return {
      id: "",
      nombre: "",
      correo: "",
      telefono: "",
      rol: "analista",
      firma_digital: "",
      activo: true,
      avatar: "",
      notificar: true
    }
  }

  const cargar = async () => {
    setLoading(true)
    setError(null)
    try {
      const [ru, rs] = await Promise.all([
        supabase.from('usuarios').select('*').order('nombre'),
        supabase.from('sucursales').select('id, nombre, codigo').order('orden')
      ])
      if (ru.error) throw ru.error
      setUsuarios(ru.data || [])
      setSucursales(rs.data || [])
    } catch (e) {
      setError(e.message || "Error al cargar usuarios")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  // Filtros
  const usuariosFiltrados = useMemo(() => {
    return usuarios.filter(u => {
      if (filtroEstado === "activos" && !u.activo) return false
      if (filtroEstado === "inactivos" && u.activo) return false
      if (filtroRol && u.rol !== filtroRol) return false
      if (busqueda) {
        const q = busqueda.toLowerCase().trim()
        return (u.nombre || "").toLowerCase().includes(q)
          || (u.correo || "").toLowerCase().includes(q)
          || (u.id || "").toLowerCase().includes(q)
      }
      return true
    })
  }, [usuarios, busqueda, filtroRol, filtroEstado])

  const nuevoUsuario = () => {
    setEditando(null)
    setForm(formVacio())
    setShowForm(true)
  }

  const editar = (u) => {
    setEditando(u.id)
    setForm({
      id: u.id || "",
      auth_uid: u.auth_uid || null,
      correo_original: u.correo || "",
      nombre: u.nombre || "",
      correo: u.correo || "",
      telefono: u.telefono || "",
      rol: u.rol || "analista",
      firma_digital: u.firma_digital || "",
      activo: u.activo !== false,
      avatar: u.avatar || "",
      notificar: u.notificar !== false
    })
    setShowForm(true)
  }

  const generarAvatar = (nombre) => {
    return (nombre || "").split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase()
  }

  const guardar = async () => {
    // Validaciones
    if (!form.nombre.trim()) { setMensaje({ tipo: "error", txt: "El nombre es obligatorio" }); return }
    if (!form.correo.trim()) { setMensaje({ tipo: "error", txt: "El correo es obligatorio" }); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo)) { setMensaje({ tipo: "error", txt: "Formato de correo inválido" }); return }

    // Duplicado de correo
    const otro = usuarios.find(u => u.correo.toLowerCase() === form.correo.toLowerCase() && u.id !== editando)
    if (otro) { setMensaje({ tipo: "error", txt: `El correo ya existe en otro usuario: ${otro.nombre}` }); return }

    setGuardando(true)
    setMensaje(null)
    try {
      const payload = {
        nombre: form.nombre.trim(),
        correo: form.correo.trim().toLowerCase(),
        telefono: form.telefono.trim() || null,
        rol: form.rol,
        firma_digital: form.firma_digital.trim() || null,
        activo: form.activo,
        avatar: form.avatar.trim() || generarAvatar(form.nombre),
        notificar: form.notificar
      }

      if (editando) {
        // Si cambió el correo, sincronizar primero con Auth
        const correoNuevo = form.correo.trim().toLowerCase()
        if (form.correo_original && correoNuevo !== form.correo_original.toLowerCase()) {
          if (!form.auth_uid) {
            setMensaje({ tipo: "error", txt: "Este usuario no tiene cuenta Auth. No se puede cambiar el correo de acceso." })
            setGuardando(false)
            return
          }
          const resEmail = await adminAction('set_email', { auth_uid: form.auth_uid, email: correoNuevo })
          if (!resEmail.ok) {
            setMensaje({ tipo: "error", txt: "Error al actualizar correo en Auth: " + (resEmail.error || "desconocido") })
            setGuardando(false)
            return
          }
        }
        const { error } = await supabase.from('usuarios').update(payload).eq('id', editando)
        if (error) throw error
        setMensaje({ tipo: "ok", txt: "Usuario actualizado" })
      } else {
        // Crear: generar ID único
        const nuevoId = "USR-" + Date.now().toString(36).toUpperCase().slice(-6)
        const { error } = await supabase.from('usuarios').insert({ id: nuevoId, ...payload })
        if (error) throw error
        setMensaje({ tipo: "ok", txt: "Usuario creado. Asigna sus accesos en el tab 'Accesos'." })
      }
      await cargar()
      setShowForm(false)
      setEditando(null)
    } catch (e) {
      setMensaje({ tipo: "error", txt: e.message || "Error al guardar" })
    } finally {
      setGuardando(false)
    }
  }

  const toggleActivo = async (u) => {
    if (u.id === cu.id) {
      setMensaje({ tipo: "error", txt: "No puedes desactivarte a ti mismo" })
      return
    }
    if (!confirm(`¿${u.activo ? 'Desactivar' : 'Activar'} a ${u.nombre}?\n\n${u.activo ? 'Perderá el acceso al ERP en su próximo login.' : 'Recuperará el acceso al ERP.'}`)) return
    try {
      const { error } = await supabase.from('usuarios').update({ activo: !u.activo }).eq('id', u.id)
      if (error) throw error
      await cargar()
      setMensaje({ tipo: "ok", txt: `Usuario ${u.activo ? 'desactivado' : 'activado'}` })
    } catch (e) {
      setMensaje({ tipo: "error", txt: e.message })
    }
  }

  // Resetear clave de un usuario
  const abrirReset = (u) => {
    setResetUser(u)
    setResetPass('')
    setShowReset(true)
  }

  const ejecutarReset = async () => {
    if (!resetUser?.auth_uid) {
      setMensaje({ tipo: 'error', txt: 'Este usuario no tiene cuenta Auth configurada' })
      setShowReset(false)
      return
    }
    if (resetPass.length < 8) {
      setMensaje({ tipo: 'error', txt: 'La clave debe tener al menos 8 caracteres' })
      return
    }
    setResetLoading(true)
    const res = await adminAction('set_password', { auth_uid: resetUser.auth_uid, password: resetPass })
    setResetLoading(false)
    if (res.ok) {
      setMensaje({ tipo: 'ok', txt: 'Clave actualizada para ' + resetUser.nombre + '. Comunícasela por canal seguro.' })
      setShowReset(false)
    } else {
      setMensaje({ tipo: 'error', txt: res.error || 'Error al actualizar clave' })
    }
  }

  // Ver como usuario (impersonación)
  const verComo = async (u) => {
    if (!u.auth_uid) {
      setMensaje({ tipo: 'error', txt: 'Este usuario no tiene cuenta Auth. Primero configúrala.' })
      return
    }
    if (!confirm()) return
    setImpersonando(u.id)
    const res = await adminAction('impersonate', { auth_uid: u.auth_uid, email: u.correo })
    setImpersonando(null)
    if (res.ok && res.link) {
      window.open(res.link, '_blank')
      setMensaje({ tipo: 'ok', txt: 'Link generado para ' + u.nombre + '. Se abrió en nueva pestaña. Expira en 60 min.' })
    } else {
      setMensaje({ tipo: 'error', txt: res.error || 'Error al generar link de impersonación' })
    }
  }

  // Estadísticas
  const stats = useMemo(() => {
    const activos = usuarios.filter(u => u.activo).length
    const inactivos = usuarios.filter(u => !u.activo).length
    const porRol = {}
    usuarios.filter(u => u.activo).forEach(u => { porRol[u.rol] = (porRol[u.rol] || 0) + 1 })
    return { total: usuarios.length, activos, inactivos, porRol }
  }, [usuarios])

  if (loading) {
    return <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Cargando usuarios...</div>
  }

  return (
    <div>
      {/* Mensaje flotante */}
      {mensaje && (
        <div style={{
          padding: "10px 14px",
          borderRadius: 10,
          marginBottom: 12,
          fontSize: 13,
          fontWeight: 500,
          background: mensaje.tipo === "error" ? "var(--danger-bg)" : "var(--success)10",
          color: mensaje.tipo === "error" ? "var(--danger)" : "var(--success)",
          border: `1px solid ${mensaje.tipo === "error" ? "var(--danger-bg)" : "var(--success-bg)"}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
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
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
        <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Total</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{stats.total}</div>
        </div>
        <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Activos</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--success)" }}>{stats.activos}</div>
        </div>
        <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Inactivos</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-muted)" }}>{stats.inactivos}</div>
        </div>
        {!isMobile && (
          <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Roles únicos</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{Object.keys(stats.porRol).length}</div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: 12, marginBottom: 12, border: "1px solid rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Buscar por nombre, correo o ID..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            style={{ flex: "1 1 240px", padding: "9px 14px", borderRadius: 10, border: "1px solid var(--border-2)", fontSize: 13, outline: "none" }}
          />
          <select value={filtroRol} onChange={e => setFiltroRol(e.target.value)} style={{ padding: "9px 14px", borderRadius: 10, border: "1px solid var(--border-2)", fontSize: 13, background: "var(--bg-surface)", cursor: "pointer" }}>
            <option value="">Todos los roles</option>
            {ROLES_LEGADO.map(r => <option key={r.k} value={r.k}>{r.l}</option>)}
          </select>
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={{ padding: "9px 14px", borderRadius: 10, border: "1px solid var(--border-2)", fontSize: 13, background: "var(--bg-surface)", cursor: "pointer" }}>
            <option value="activos">Solo activos</option>
            <option value="inactivos">Solo inactivos</option>
            <option value="todos">Todos</option>
          </select>
          <button onClick={nuevoUsuario} style={{ padding: "9px 16px", borderRadius: 10, background: "var(--text-primary)", color: "var(--bg-surface)", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <span>➕</span> Nuevo usuario
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
          Mostrando <strong>{usuariosFiltrados.length}</strong> de {usuarios.length} usuarios
        </div>
      </div>

      {/* Tabla */}
      <div style={{ background: "var(--bg-surface)", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(0,0,0,0.04)" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-surface-2)", borderBottom: "2px solid var(--border-2)" }}>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Usuario</th>
                {!isMobile && <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Correo</th>}
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Rol legado</th>
                {!isMobile && <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>ID</th>}
                <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Estado</th>
                <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuariosFiltrados.length === 0 ? (
                <tr><td colSpan={isMobile ? 4 : 6} style={{ padding: 32, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No hay usuarios que coincidan con los filtros</td></tr>
              ) : usuariosFiltrados.map(u => {
                const r = rolInfo(u.rol)
                return (
                  <tr key={u.id} style={{ borderBottom: "1px solid var(--bg-hover)", opacity: u.activo ? 1 : 0.5 }}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 16, background: r.c + "20", color: r.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                          {u.avatar || (u.nombre || "?").split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{u.nombre}</div>
                          {isMobile && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{u.correo}</div>}
                        </div>
                      </div>
                    </td>
                    {!isMobile && <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-secondary)" }}>{u.correo}</td>}
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, color: r.c, background: r.c + "15" }}>
                        {r.l}
                      </span>
                    </td>
                    {!isMobile && <td style={{ padding: "10px 14px", fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>{u.id}</td>}
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, color: u.activo ? "var(--success)" : "var(--text-muted)", background: u.activo ? "var(--success-bg)" : "var(--text-muted)15" }}>
                        {u.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        <button onClick={() => editar(u)} title="Editar" style={{ padding: "6px 10px", borderRadius: 8, background: "var(--bg-hover)", border: "none", cursor: "pointer", fontSize: 12 }}>✏️</button>
                        <button onClick={() => abrirReset(u)} title="Resetear clave" style={{ padding: "6px 10px", borderRadius: 8, background: "var(--accent-bg)", border: "none", cursor: "pointer", fontSize: 12 }}>🔑</button>
                        <button onClick={() => verComo(u)} title="Ver como este usuario" disabled={impersonando === u.id} style={{ padding: "6px 10px", borderRadius: 8, background: "var(--purple-bg)", border: "none", cursor: impersonando === u.id ? "default" : "pointer", fontSize: 12, opacity: impersonando === u.id ? 0.5 : 1 }}>👁</button>
                        <button onClick={() => toggleActivo(u)} title={u.activo ? "Desactivar" : "Activar"} style={{ padding: "6px 10px", borderRadius: 8, background: "var(--bg-hover)", border: "none", cursor: "pointer", fontSize: 12 }}>
                          {u.activo ? "🚫" : "✅"}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL RESET CLAVE */}
      {showReset && resetUser && (
        <ModalResetClave
          user={resetUser}
          pass={resetPass}
          setPass={setResetPass}
          loading={resetLoading}
          onGuardar={ejecutarReset}
          onClose={() => { setShowReset(false); setResetPass('') }}
        />
      )}

      {/* MODAL FORM */}
      {showForm && (
        <div onClick={() => setShowForm(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg-surface)", borderRadius: 20, padding: 28, width: "100%", maxWidth: 540, maxHeight: "90vh", overflow: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 700, color: "var(--text-primary)" }}>{editando ? "Editar usuario" : "Nuevo usuario"}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  {editando ? `ID: ${editando}` : "Se generará un ID único automáticamente"}
                </div>
              </div>
              <button onClick={() => setShowForm(false)} style={{ width: 32, height: 32, borderRadius: 16, background: "var(--bg-hover)", border: "none", cursor: "pointer", fontSize: 14 }}>×</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
              <Campo label="Nombre completo" req>
                <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Juan Pérez" style={css.input} />
              </Campo>
              <Campo label="Correo corporativo" req>
                <input type="email" value={form.correo} onChange={e => setForm({ ...form, correo: e.target.value })} placeholder="usuario@outletdepuertas.cl" style={css.input} />
              </Campo>
              <Campo label="Teléfono">
                <input value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} placeholder="+56 9 1234 5678" style={css.input} />
              </Campo>
              <Campo label="Rol legado" req>
                <select value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })} style={css.input}>
                  {ROLES_LEGADO.map(r => <option key={r.k} value={r.k}>{r.l}</option>)}
                </select>
              </Campo>
              <Campo label="Firma digital">
                <input value={form.firma_digital} onChange={e => setForm({ ...form, firma_digital: e.target.value })} placeholder="Para OC e informes" style={{ ...css.input, fontStyle: "italic" }} />
              </Campo>
              <Campo label="Avatar (iniciales)">
                <input value={form.avatar} onChange={e => setForm({ ...form, avatar: e.target.value.toUpperCase().slice(0, 3) })} placeholder="Auto desde nombre" maxLength={3} style={css.input} />
              </Campo>
            </div>

            <div style={{ marginTop: 14, padding: 12, background: "var(--bg-surface-2)", borderRadius: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                <input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} />
                <span><strong>Usuario activo</strong> — puede iniciar sesión en el ERP</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, marginTop: 8 }}>
                <input type="checkbox" checked={form.notificar} onChange={e => setForm({ ...form, notificar: e.target.checked })} />
                <span><strong>Recibe notificaciones</strong> — emails y alertas del sistema</span>
              </label>
            </div>

            <div style={{ padding: 12, background: "var(--warning-bg)", borderRadius: 10, marginTop: 12, fontSize: 12, color: "var(--warning-text)", border: "1px solid var(--warning-bg)" }}>
              <strong>ℹ️ Nota:</strong> El campo "Rol legado" es de compatibilidad. Los accesos reales se gestionan en el tab <strong>Accesos</strong>, donde cada usuario puede tener un rol distinto en cada app del ERP.
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => setShowForm(false)} style={{ padding: "10px 18px", borderRadius: 10, background: "var(--bg-hover)", color: "var(--text-secondary)", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Cancelar
              </button>
              <button disabled={guardando} onClick={guardar} style={{ padding: "10px 18px", borderRadius: 10, background: guardando ? "var(--text-muted)" : "var(--text-primary)", color: "var(--bg-surface)", border: "none", fontSize: 13, fontWeight: 600, cursor: guardando ? "default" : "pointer" }}>
                {guardando ? "Guardando..." : (editando ? "Guardar cambios" : "Crear usuario")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Modal resetear clave
function ModalResetClave({ user, pass, setPass, loading, onGuardar, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-surface)', borderRadius: 20, padding: 28, width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>🔑 Resetear clave</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{user?.nombre} · {user?.correo}</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 16, background: 'var(--bg-hover)', border: 'none', cursor: 'pointer', fontSize: 14 }}>×</button>
        </div>
        <div style={{ padding: 12, background: 'var(--warning-bg)', borderRadius: 10, marginBottom: 14, fontSize: 12, color: 'var(--warning-text)', border: '1px solid var(--warning-bg)' }}>
          ⚠️ Define una clave temporal y comunícasela al usuario por WhatsApp o en persona. El usuario podrá cambiarla desde el AppHub.
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Nueva clave temporal <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input
            type="text"
            value={pass}
            onChange={e => setPass(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border-2)', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }}
            autoFocus
          />
          {pass.length > 0 && pass.length < 8 && (
            <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>Mínimo 8 caracteres</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 18px', borderRadius: 10, background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          <button disabled={pass.length < 8 || loading} onClick={onGuardar} style={{ padding: '10px 18px', borderRadius: 10, background: (pass.length < 8 || loading) ? 'var(--text-muted)' : 'var(--accent)', color: 'var(--bg-surface)', border: 'none', fontSize: 13, fontWeight: 600, cursor: (pass.length < 8 || loading) ? 'default' : 'pointer' }}>
            {loading ? 'Guardando...' : 'Establecer clave'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Campo({ label, req, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 5 }}>
        {label}{req && <span style={{ color: "var(--danger)" }}> *</span>}
      </label>
      {children}
    </div>
  )
}

const css = {
  input: { width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border-2)", fontSize: 13, background: "var(--bg-surface)", outline: "none" }
}
