import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'

// Diccionario de permisos legibles
const PERMISOS_LEGIBLES = {
  "todo": "Acceso total (todos los permisos)",
  "aprobar_ilimitado": "Aprobar OC sin límite de monto",
  "aprobar_neg": "Aprobar OC en etapa Negocios",
  "aprobar_fin": "Aprobar OC en etapa Finanzas",
  "aprobar_ops": "Aprobar OC en etapa Operaciones",
  "crear_oc": "Crear órdenes de compra",
  "cerrar_oc": "Cerrar OC tras recepción",
  "recibir": "Registrar recepciones en bodega",
  "reg_pago": "Registrar pagos",
  "ver_dash": "Ver dashboards y KPIs",
  "ver_fin": "Ver información financiera",
  "ver_finanzas_app": "Acceder a la app de Finanzas",
  "gest_prov": "Gestionar proveedores",
  "valid_prov": "Validar proveedores",
  "gest_imp": "Gestionar parámetros de importación",
  "config": "Editar configuración del sistema",
  "seguim": "Seguimiento de OC",
  "declarar_cierre": "Declarar cierres de caja propios",
  "ver_propios": "Ver solo sus propios registros",
  "corroborar": "Corroborar cierres de cualquier vendedor",
  "registrar_deposito": "Registrar depósitos bancarios",
  "importar_getnet": "Importar archivos Getnet",
  "ver_analisis": "Ver análisis cruzados de medios de pago"
}

export function AdminRoles({ cu, isMobile }) {
  const [roles, setRoles] = useState([])
  const [apps, setApps] = useState([])
  const [usuariosPorRol, setUsuariosPorRol] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filtroApp, setFiltroApp] = useState("")
  const [rolExpandido, setRolExpandido] = useState(null)

  const cargar = async () => {
    setLoading(true)
    setError(null)
    try {
      const [rr, ra, rua] = await Promise.all([
        supabase.from('roles_app').select('*').order('app_codigo').order('orden'),
        supabase.from('apps').select('codigo, nombre, icono, color').order('orden'),
        supabase.from('usuario_acceso').select('rol_id').eq('activo', true)
      ])
      if (rr.error) throw rr.error
      if (ra.error) throw ra.error
      setRoles(rr.data || [])
      setApps(ra.data || [])

      const map = {}
      ;(rua.data || []).forEach(a => { map[a.rol_id] = (map[a.rol_id] || 0) + 1 })
      setUsuariosPorRol(map)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const rolesFiltrados = useMemo(() => {
    if (!filtroApp) return roles
    return roles.filter(r => r.app_codigo === filtroApp)
  }, [roles, filtroApp])

  const appInfo = (codigo) => apps.find(a => a.codigo === codigo) || { codigo, nombre: codigo, icono: "📱", color: "var(--text-muted)" }

  if (loading) {
    return <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Cargando roles...</div>
  }

  return (
    <div>
      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--danger-bg)", color: "var(--danger)", marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
        <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Total roles</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{roles.length}</div>
        </div>
        <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Apps con roles</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{new Set(roles.map(r => r.app_codigo)).size}</div>
        </div>
        <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Roles en uso</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--success)" }}>{Object.keys(usuariosPorRol).length}</div>
        </div>
      </div>

      {/* Aviso */}
      <div style={{ padding: 12, background: "var(--warning-bg)", borderRadius: 10, marginBottom: 14, fontSize: 12, color: "var(--warning-text)", border: "1px solid var(--warning-bg)" }}>
        <strong>ℹ️ Solo lectura:</strong> La edición de permisos requiere coordinación con el código. Si necesitas modificar permisos de un rol, contacta al desarrollador.
      </div>

      {/* Filtro por app */}
      <div style={{ background: "var(--bg-surface)", borderRadius: 12, padding: 12, marginBottom: 12, border: "1px solid rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginRight: 4 }}>Filtrar:</span>
          <button
            onClick={() => setFiltroApp("")}
            style={{
              padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: "1px solid " + (filtroApp === "" ? "var(--text-primary)" : "var(--border-2)"),
              background: filtroApp === "" ? "var(--text-primary)" : "var(--bg-surface)",
              color: filtroApp === "" ? "var(--bg-surface)" : "var(--text-secondary)"
            }}
          >
            Todas
          </button>
          {apps.map(a => (
            <button
              key={a.codigo}
              onClick={() => setFiltroApp(a.codigo)}
              style={{
                padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: "1px solid " + (filtroApp === a.codigo ? a.color : "var(--border-2)"),
                background: filtroApp === a.codigo ? a.color : "var(--bg-surface)",
                color: filtroApp === a.codigo ? "var(--bg-surface)" : "var(--text-secondary)",
                display: "inline-flex", alignItems: "center", gap: 5
              }}
            >
              <span>{a.icono}</span>
              <span>{a.nombre}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Lista de roles */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rolesFiltrados.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 13, background: "var(--bg-surface)", borderRadius: 12 }}>
            No hay roles para esta app
          </div>
        ) : rolesFiltrados.map(r => {
          const app = appInfo(r.app_codigo)
          const numUsuarios = usuariosPorRol[r.id] || 0
          const expandido = rolExpandido === r.id
          const permisos = Array.isArray(r.permisos) ? r.permisos : []
          return (
            <div key={r.id} style={{ background: "var(--bg-surface)", borderRadius: 12, border: "1px solid rgba(0,0,0,0.04)", overflow: "hidden" }}>
              <button
                onClick={() => setRolExpandido(expandido ? null : r.id)}
                style={{ width: "100%", padding: 14, background: "none", border: "none", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 12 }}
              >
                {/* Color tag */}
                <div style={{ width: 4, height: 36, borderRadius: 2, background: r.color, flexShrink: 0 }} />

                {/* Icono app */}
                <div style={{ width: 36, height: 36, borderRadius: 10, background: app.color + "15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                  {app.icono}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{r.nombre}</span>
                    <span style={{ fontSize: 11, color: app.color, fontWeight: 600 }}>· {app.nombre}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>ID: <code style={{ background: "var(--bg-hover)", padding: "1px 5px", borderRadius: 3, fontFamily: "monospace" }}>{r.id}</code></span>
                    <span><strong>{permisos.length}</strong> permiso(s)</span>
                    <span><strong>{numUsuarios}</strong> usuario(s)</span>
                  </div>
                </div>

                {/* Toggle */}
                <div style={{ fontSize: 18, color: "var(--text-muted)", flexShrink: 0 }}>{expandido ? "−" : "+"}</div>
              </button>

              {/* Permisos */}
              {expandido && (
                <div style={{ borderTop: "1px solid var(--bg-hover)", padding: 14, background: "var(--bg-surface-2)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                    Permisos del rol
                  </div>
                  {permisos.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>Este rol no tiene permisos asignados.</div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 6 }}>
                      {permisos.map(p => (
                        <div key={p} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", background: "var(--bg-surface)", borderRadius: 8, fontSize: 12 }}>
                          <span style={{ color: "var(--success)", fontSize: 14, lineHeight: 1 }}>✓</span>
                          <div>
                            <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                              <code style={{ background: "var(--bg-hover)", padding: "1px 5px", borderRadius: 3, fontFamily: "monospace", fontSize: 11 }}>{p}</code>
                            </div>
                            <div style={{ color: "var(--text-muted)", marginTop: 2, fontSize: 11 }}>
                              {PERMISOS_LEGIBLES[p] || "(sin descripción)"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
