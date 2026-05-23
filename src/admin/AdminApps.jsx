import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'

export function AdminApps({ cu, isMobile }) {
  const [apps, setApps] = useState([])
  const [usuariosPorApp, setUsuariosPorApp] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [mensaje, setMensaje] = useState(null)
  const [actualizando, setActualizando] = useState(null)

  const cargar = async () => {
    setLoading(true)
    setError(null)
    try {
      const [ra, rua] = await Promise.all([
        supabase.from('apps').select('*').order('orden'),
        supabase.from('usuario_acceso').select('app_codigo').eq('activo', true)
      ])
      if (ra.error) throw ra.error
      setApps(ra.data || [])

      // Contar usuarios por app
      const map = {}
      ;(rua.data || []).forEach(a => { map[a.app_codigo] = (map[a.app_codigo] || 0) + 1 })
      setUsuariosPorApp(map)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const toggleActiva = async (app) => {
    const usuariosAfectados = usuariosPorApp[app.codigo] || 0
    if (app.activa && usuariosAfectados > 0) {
      if (!confirm(`Vas a DESACTIVAR la app "${app.nombre}".\n\n${usuariosAfectados} usuario(s) tienen acceso asignado y perderán la visibilidad de la app (sus accesos NO se eliminan, solo se ocultan).\n\n¿Continuar?`)) return
    }
    if (!app.activa) {
      if (!confirm(`¿Activar la app "${app.nombre}"?\n\nLos usuarios con acceso asignado podrán verla en el AppHub.`)) return
    }

    setActualizando(app.codigo)
    setMensaje(null)
    try {
      const { error } = await supabase.from('apps').update({ activa: !app.activa }).eq('codigo', app.codigo)
      if (error) throw error
      setMensaje({ tipo: "ok", txt: `App ${app.activa ? 'desactivada' : 'activada'}: ${app.nombre}` })
      await cargar()
    } catch (e) {
      setMensaje({ tipo: "error", txt: e.message })
    } finally {
      setActualizando(null)
    }
  }

  const cambiarOrden = async (app, direccion) => {
    const idx = apps.findIndex(a => a.codigo === app.codigo)
    const targetIdx = direccion === "up" ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= apps.length) return
    if (apps[targetIdx].codigo === "admin") return  // admin siempre al final
    if (app.codigo === "admin") return

    setActualizando(app.codigo)
    setMensaje(null)
    try {
      const otra = apps[targetIdx]
      await Promise.all([
        supabase.from('apps').update({ orden: otra.orden }).eq('codigo', app.codigo),
        supabase.from('apps').update({ orden: app.orden }).eq('codigo', otra.codigo)
      ])
      await cargar()
    } catch (e) {
      setMensaje({ tipo: "error", txt: e.message })
    } finally {
      setActualizando(null)
    }
  }

  if (loading) {
    return <div style={{ textAlign: "center", padding: 40, color: "#8E8E93" }}>Cargando apps...</div>
  }

  const activas = apps.filter(a => a.activa).length
  const inactivas = apps.filter(a => !a.activa).length

  return (
    <div>
      {mensaje && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, marginBottom: 12, fontSize: 13, fontWeight: 500,
          background: mensaje.tipo === "error" ? "#FF3B3010" : "#34C75910",
          color: mensaje.tipo === "error" ? "#FF3B30" : "#34C759",
          border: `1px solid ${mensaje.tipo === "error" ? "#FF3B3030" : "#34C75930"}`,
          display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <span>{mensaje.tipo === "error" ? "⚠️" : "✓"} {mensaje.txt}</span>
          <button onClick={() => setMensaje(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
      )}

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "#FF3B3010", color: "#FF3B30", marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "#8E8E93", fontWeight: 500 }}>Total apps</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1C1C1E" }}>{apps.length}</div>
        </div>
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "#8E8E93", fontWeight: 500 }}>Activas</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#34C759" }}>{activas}</div>
        </div>
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "#8E8E93", fontWeight: 500 }}>En construcción</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#8E8E93" }}>{inactivas}</div>
        </div>
      </div>

      {/* Aviso */}
      <div style={{ padding: 12, background: "#FFF8E1", borderRadius: 10, marginBottom: 14, fontSize: 12, color: "#8B6914", border: "1px solid #FFE082" }}>
        <strong>ℹ️ Nota:</strong> Crear nuevas apps requiere coordinar código + SQL. Esta vista solo permite activar/desactivar apps existentes y cambiar su orden en el AppHub.
      </div>

      {/* Lista de apps */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {apps.map((app, idx) => {
          const numUsuarios = usuariosPorApp[app.codigo] || 0
          const esAdmin = app.codigo === "admin"
          return (
            <div key={app.codigo} style={{
              background: "#fff",
              borderRadius: 12,
              padding: 16,
              border: "1px solid rgba(0,0,0,0.04)",
              display: "flex",
              alignItems: "center",
              gap: 14,
              opacity: app.activa ? 1 : 0.65,
              transition: "opacity 0.2s"
            }}>
              {/* Icono */}
              <div style={{ width: 52, height: 52, borderRadius: 12, background: app.color + "15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0 }}>
                {app.icono}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1C1C1E" }}>{app.nombre}</div>
                  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 600, color: app.activa ? "#34C759" : "#8E8E93", background: app.activa ? "#34C75915" : "#8E8E9315" }}>
                    {app.activa ? "Activa" : "Inactiva"}
                  </span>
                  {esAdmin && (
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 600, color: "#FF3B30", background: "#FF3B3015" }}>
                      Sistema
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#8E8E93", marginTop: 3 }}>{app.descripcion}</div>
                <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span><strong>{numUsuarios}</strong> usuario(s) con acceso</span>
                  <span>Código: <code style={{ background: "#F2F2F7", padding: "1px 6px", borderRadius: 4, fontFamily: "monospace" }}>{app.codigo}</code></span>
                  <span>Orden: <strong>{app.orden}</strong></span>
                </div>
              </div>

              {/* Acciones */}
              <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 4, flexShrink: 0 }}>
                {!esAdmin && (
                  <>
                    <button
                      disabled={idx === 0 || actualizando === app.codigo}
                      onClick={() => cambiarOrden(app, "up")}
                      title="Subir"
                      style={{ width: 32, height: 32, borderRadius: 8, background: "#F2F2F7", border: "none", cursor: idx === 0 ? "default" : "pointer", fontSize: 12, opacity: idx === 0 ? 0.3 : 1 }}
                    >↑</button>
                    <button
                      disabled={idx >= apps.length - 2 || actualizando === app.codigo}
                      onClick={() => cambiarOrden(app, "down")}
                      title="Bajar"
                      style={{ width: 32, height: 32, borderRadius: 8, background: "#F2F2F7", border: "none", cursor: idx >= apps.length - 2 ? "default" : "pointer", fontSize: 12, opacity: idx >= apps.length - 2 ? 0.3 : 1 }}
                    >↓</button>
                  </>
                )}
                <button
                  disabled={actualizando === app.codigo || esAdmin}
                  onClick={() => toggleActiva(app)}
                  title={esAdmin ? "La app de Administración no puede desactivarse" : (app.activa ? "Desactivar" : "Activar")}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    background: esAdmin ? "#F2F2F7" : (app.activa ? "#FF3B3015" : "#34C75915"),
                    color: esAdmin ? "#C7C7CC" : (app.activa ? "#FF3B30" : "#34C759"),
                    border: "none",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: esAdmin ? "default" : "pointer",
                    minWidth: 90
                  }}
                >
                  {actualizando === app.codigo ? "..." : (app.activa ? "Desactivar" : "Activar")}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
