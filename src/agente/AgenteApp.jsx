import { useState, useEffect, useRef } from 'react'
import { supabase, signOut } from '../supabase'

/* ═══ ROLES (mismo patrón que las demás apps) ═══ */
const ROLES = [
  { k: "admin", l: "Admin", c: "#FF3B30" },
  { k: "dir_general", l: "Dir. General", c: "#FF3B30" },
  { k: "dir_finanzas", l: "Dir. Finanzas", c: "#AF52DE" },
  { k: "dir_negocios", l: "Dir. Negocios", c: "#007AFF" },
  { k: "dir_operaciones", l: "Dir. Operaciones", c: "#5AC8FA" },
  { k: "analista", l: "Analista", c: "#34C759" },
  { k: "directorio", l: "Directorio", c: "#8E8E93" }
]
const rl = u => ROLES.find(r => r.k === u?.rol) || ROLES[5]

/* Color del agente: índigo, distinto a las demás apps */
const C1 = "#6366F1"
const C2 = "#4338CA"

/* Preguntas sugeridas de arranque */
const SUGERENCIAS = [
  "¿Cuántos SKU tengo en quiebre de stock ahora?",
  "Resumen del EERR de mayo 2026",
  "¿Cuánto me falta por conciliar?",
  "¿Cuánto me deben los clientes (CxC)?",
  "Estado de los controles financieros",
  "Próximas cuotas de crédito de 2026"
]

export function AgenteApp({ cu, setAppActual }) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  )
  const [msgs, setMsgs] = useState([])        // [{rol:'user'|'asis', txt, tools?}]
  const [input, setInput] = useState("")
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState("")
  const scrollRef = useRef(null)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // Auto-scroll al último mensaje
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs, cargando])

  const r = rl(cu)

  const cambiarApp = () => {
    localStorage.removeItem("outlet_app_actual")
    setAppActual(null)
  }
  const cerrarSesion = async () => {
    try { await signOut() } catch (e) { }
    localStorage.removeItem("erp_cu_id")
    localStorage.removeItem("outlet_app_actual")
    window.location.reload()
  }

  // Construye historial para la API (formato Anthropic messages)
  const construirHistorial = () => {
    const h = []
    for (const m of msgs) {
      if (m.rol === 'user') h.push({ role: 'user', content: m.txt })
      else if (m.rol === 'asis') h.push({ role: 'assistant', content: m.txt })
    }
    return h
  }

  const enviar = async (texto) => {
    const pregunta = (texto ?? input).trim()
    if (!pregunta || cargando) return
    setError("")
    setInput("")
    const historial = construirHistorial()
    setMsgs(prev => [...prev, { rol: 'user', txt: pregunta }])
    setCargando(true)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('agente-admin', {
        body: { pregunta, historial }
      })
      if (fnErr) throw fnErr
      if (data?.error) throw new Error(data.error)
      setMsgs(prev => [...prev, {
        rol: 'asis',
        txt: data?.respuesta || "Sin respuesta.",
        tools: data?.tools_usadas || []
      }])
    } catch (e) {
      setError(String(e?.message || e))
      setMsgs(prev => [...prev, {
        rol: 'asis',
        txt: "⚠️ Hubo un problema al consultar. Revisa que el edge function esté desplegado y el secret ANTHROPIC_API_KEY configurado.",
        tools: []
      }])
    } finally {
      setCargando(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  return (
    <div style={{
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
      margin: 0,
      padding: isMobile ? "0 10px calc(20px + env(safe-area-inset-bottom))" : "0 20px 24px",
      background: "#F2F2F7",
      minHeight: "100vh",
      fontSize: 14
    }}>
      <style>{`
        *{box-sizing:border-box}
        @keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}
        .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:${C1};margin:0 2px;animation:blink 1.4s infinite both}
        .dot:nth-child(2){animation-delay:.2s}
        .dot:nth-child(3){animation-delay:.4s}
        .ag-input:focus{border-color:${C1}!important;box-shadow:0 0 0 3px rgba(99,102,241,0.12)}
      `}</style>

      {/* HEADER */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(242,242,247,0.9)", backdropFilter: "blur(20px)",
        padding: isMobile ? "10px 0 8px" : "14px 0 10px",
        marginBottom: 10, borderBottom: "1px solid rgba(0,0,0,0.06)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: isMobile ? 16 : 20 }}>🤖</span>
              <span style={{
                fontSize: isMobile ? 16 : 22, fontWeight: 800,
                color: "#1C1C1E", letterSpacing: "-0.03em",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}>Agente IA</span>
            </div>
            <div style={{ fontSize: isMobile ? 11 : 12, color: r.c, fontWeight: 600 }}>
              {r.l} — {cu.nombre}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button onClick={cambiarApp} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
              padding: "6px 10px", borderRadius: 10, background: "#007AFF15",
              border: "none", cursor: "pointer", color: "#007AFF", minWidth: isMobile ? 42 : 56
            }} title="Volver al selector de apps">
              <span style={{ fontSize: isMobile ? 13 : 14, lineHeight: 1 }}>⇄</span>
              <span style={{ fontSize: 9, fontWeight: 700 }}>Apps</span>
            </button>
            <button onClick={cerrarSesion} style={{
              width: isMobile ? 34 : 36, height: isMobile ? 34 : 36,
              borderRadius: 10, background: "#FF3B3015", border: "none",
              cursor: "pointer", fontSize: 13, color: "#FF3B30"
            }} title="Cerrar sesión">⏻</button>
          </div>
        </div>
      </div>

      {/* CONTENEDOR CHAT */}
      <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", flexDirection: "column", height: isMobile ? "calc(100vh - 140px)" : "calc(100vh - 120px)" }}>

        {/* MENSAJES */}
        <div ref={scrollRef} style={{
          flex: 1, overflowY: "auto", padding: "8px 2px",
          display: "flex", flexDirection: "column", gap: 12
        }}>
          {msgs.length === 0 && (
            <div style={{ textAlign: "center", padding: isMobile ? "24px 8px" : "48px 16px" }}>
              <div style={{
                width: 64, height: 64, borderRadius: 18, margin: "0 auto 16px",
                background: `linear-gradient(135deg,${C1},${C2})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 30, boxShadow: "0 8px 24px rgba(99,102,241,0.35)"
              }}>🤖</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1C1C1E", marginBottom: 6 }}>
                Hola {(cu.nombre || "").split(" ")[0]}
              </div>
              <div style={{ fontSize: 14, color: "#8E8E93", marginBottom: 20 }}>
                Pregúntame sobre compras, finanzas, reposición o el estado del negocio.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 560, margin: "0 auto" }}>
                {SUGERENCIAS.map((s, i) => (
                  <button key={i} onClick={() => enviar(s)} style={{
                    padding: "8px 14px", borderRadius: 20, fontSize: 13,
                    background: "#fff", border: "1px solid rgba(99,102,241,0.25)",
                    color: C2, cursor: "pointer", fontWeight: 500
                  }}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {msgs.map((m, i) => (
            <div key={i} style={{
              display: "flex",
              justifyContent: m.rol === 'user' ? "flex-end" : "flex-start"
            }}>
              <div style={{
                maxWidth: "82%",
                padding: "10px 14px", borderRadius: 16,
                background: m.rol === 'user' ? `linear-gradient(135deg,${C1},${C2})` : "#fff",
                color: m.rol === 'user' ? "#fff" : "#1C1C1E",
                boxShadow: m.rol === 'user' ? "0 2px 8px rgba(99,102,241,0.25)" : "0 1px 3px rgba(0,0,0,0.08)",
                whiteSpace: "pre-wrap", lineHeight: 1.5, fontSize: 14
              }}>
                {m.txt}
                {m.rol === 'asis' && m.tools && m.tools.length > 0 && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(0,0,0,0.06)", fontSize: 11, color: "#8E8E93" }}>
                    🔍 Consultó: {[...new Set(m.tools)].join(", ")}
                  </div>
                )}
              </div>
            </div>
          ))}

          {cargando && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{
                padding: "12px 16px", borderRadius: 16, background: "#fff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.08)"
              }}>
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div style={{ fontSize: 12, color: "#FF3B30", padding: "4px 8px" }}>{error}</div>
        )}

        {/* INPUT */}
        <div style={{
          display: "flex", gap: 8, alignItems: "flex-end",
          padding: "10px 0 4px", background: "#F2F2F7"
        }}>
          <textarea
            className="ag-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Escribe tu pregunta…"
            rows={1}
            style={{
              flex: 1, resize: "none", maxHeight: 120,
              padding: "12px 16px", borderRadius: 22, fontSize: 14,
              border: "1px solid #D1D1D6", outline: "none",
              fontFamily: "inherit", lineHeight: 1.4, background: "#fff"
            }}
          />
          <button
            onClick={() => enviar()}
            disabled={cargando || !input.trim()}
            style={{
              width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
              background: (cargando || !input.trim()) ? "#C7C7CC" : `linear-gradient(135deg,${C1},${C2})`,
              border: "none", cursor: (cargando || !input.trim()) ? "default" : "pointer",
              color: "#fff", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center"
            }}
            title="Enviar"
          >↑</button>
        </div>
        <div style={{ fontSize: 10, color: "#C7C7CC", textAlign: "center", paddingBottom: 4 }}>
          Agente de solo lectura · puede equivocarse, valida cifras críticas
        </div>
      </div>
    </div>
  )
}
