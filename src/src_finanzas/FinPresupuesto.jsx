import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { fmt } from '../lib/constants'

/* ═══ FIN PRESUPUESTO ═══ */

const MESES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
const MESES_L = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

export function FinPresupuesto({ cu, isMobile }) {
  const [subTab, setSubTab] = useState("ventas")
  const [controlVentas, setControlVentas] = useState([])
  const [forecast, setForecast] = useState([])
  const [semaforo, setSemaforo] = useState(null)
  const [eerr, setEerr] = useState([])
  const [metas, setMetas] = useState([])
  const [mesPpto, setMesPpto] = useState(new Date().getMonth())
  const [loading, setLoading] = useState(true)
  const [editandoMeta, setEditandoMeta] = useState(null)
  const [toast, setToast] = useState(null)

  const esAdmin = cu.rol === "admin"
  const anio = new Date().getFullYear()

  useEffect(() => { cargarDatos() }, [])

  async function cargarDatos() {
    setLoading(true)
    const [cv, fc, sm, er, mt] = await Promise.all([
      supabase.from("v_control_ventas").select("*").eq("anio", anio).order("sucursal_bsale").order("mes_numero"),
      supabase.from("v_forecast_ventas").select("*"),
      supabase.from("v_semaforo_presupuesto").select("*").single(),
      supabase.from("v_eerr_control").select("*").eq("anio", anio).order("orden").order("mes_num"),
      supabase.from("metas_mensuales").select("*").eq("anio", anio).order("sucursal_bsale").order("mes_numero")
    ])
    setControlVentas(cv.data || [])
    setForecast(fc.data || [])
    setSemaforo(sm.data)
    setEerr(er.data || [])
    setMetas(mt.data || [])
    setLoading(false)
  }

  const showToast = (msg, tipo = "ok") => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  async function guardarMeta(id, nuevaMeta) {
    const { error } = await supabase.from("metas_mensuales").update({ meta_venta: Number(nuevaMeta) }).eq("id", id)
    if (error) { showToast("Error: " + error.message, "err"); return }
    setMetas(prev => prev.map(m => m.id === id ? { ...m, meta_venta: Number(nuevaMeta) } : m))
    setEditandoMeta(null)
    showToast("Meta actualizada")
  }

  // Datos EERR para el mes seleccionado
  const eerrMes = eerr.filter(r => r.mes_num === mesPpto)

  if (loading) return <LoadingState label="Cargando presupuesto..." />

  return (
    <div>
      {/* TABS */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        {[["ventas", "Control ventas"], ["eerr", "EERR control"], ["metas", "Editar metas"]].map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: 600,
            background: "none", border: "none", cursor: "pointer",
            color: subTab === k ? "#34C759" : "#8E8E93",
            borderBottom: subTab === k ? "2px solid #34C759" : "2px solid transparent"
          }}>{l}</button>
        ))}
      </div>

      {subTab === "ventas" && (
        <>
          {/* KPIs YTD */}
          {semaforo && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8, marginBottom: 16 }}>
              <KpiSm l="Venta real YTD" v={fmtM(semaforo.venta_real_ytd)} c="#007AFF" />
              <KpiSm l="Meta YTD" v={fmtM(semaforo.meta_venta_ytd)} />
              <KpiSm l="Avance meta" v={fmtPct(semaforo.avance_meta_pct)}
                c={semaforoC(semaforo.semaforo_venta)} />
              <KpiSm l="Gasto compras" v={fmtM(semaforo.gasto_real_ytd)} c="#FF9500" />
            </div>
          )}

          {/* Forecast por sucursal */}
          <div style={{ marginBottom: 16 }}>
            <SectionLabel>Forecast anual por sucursal</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
              {forecast.filter(f => Number(f.meses_reales) >= 2).map(f => (
                <div key={f.sucursal_bsale} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", border: "1px solid rgba(0,0,0,0.04)" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#1C1C1E", marginBottom: 6 }}>{f.sucursal_bsale}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "#8E8E93" }}>Ppto anual</span>
                    <span style={{ fontSize: 11 }}>{fmtM(f.ppto_anual)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "#8E8E93" }}>Real YTD</span>
                    <span style={{ fontSize: 11 }}>{fmtM(f.real_ytd)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: "#8E8E93" }}>Forecast</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: semaforoC(f.semaforo) }}>
                      {fmtM(f.forecast_anual)}
                    </span>
                  </div>
                  <ProgressBar value={Math.min(Number(f.forecast_pct) || 0, 150)} max={150} color={semaforoC(f.semaforo)} />
                  <div style={{ fontSize: 10, color: "#8E8E93", marginTop: 4, textAlign: "right" }}>
                    {fmtPct(f.forecast_pct)} del presupuesto
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabla control ventas */}
          <SectionLabel>Control ventas vs meta por mes y sucursal</SectionLabel>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.04)", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#F2F2F7" }}>
                  <th style={thSt}>Sucursal</th>
                  <th style={thSt}>Mes</th>
                  <th style={{ ...thSt, textAlign: "right" }}>Meta</th>
                  <th style={{ ...thSt, textAlign: "right" }}>Real</th>
                  <th style={{ ...thSt, textAlign: "right" }}>Variación</th>
                  <th style={{ ...thSt, textAlign: "right" }}>Avance %</th>
                  <th style={{ ...thSt, textAlign: "center" }}>Semáforo</th>
                </tr>
              </thead>
              <tbody>
                {controlVentas
                  .filter(r => r.mes_numero <= new Date().getMonth() + 1 && Number(r.venta_real) > 0)
                  .map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #F2F2F7" }}>
                      <td style={{ ...tdSt, fontSize: 11, color: "#8E8E93", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.sucursal_bsale}
                      </td>
                      <td style={tdSt}>{MESES_L[r.mes_numero]}</td>
                      <td style={{ ...tdSt, textAlign: "right" }}>{fmtM(r.ppto_venta)}</td>
                      <td style={{ ...tdSt, textAlign: "right", fontWeight: 600 }}>{fmtM(r.venta_real)}</td>
                      <td style={{ ...tdSt, textAlign: "right", color: Number(r.variacion) >= 0 ? "#34C759" : "#FF3B30", fontWeight: 600 }}>
                        {Number(r.variacion) >= 0 ? "+" : ""}{fmtM(r.variacion)}
                      </td>
                      <td style={{ ...tdSt, textAlign: "right", fontWeight: 600, color: semaforoC(r.semaforo) }}>
                        {fmtPct(r.avance_pct)}
                      </td>
                      <td style={{ ...tdSt, textAlign: "center" }}>
                        <span style={{
                          fontSize: 16,
                          color: semaforoC(r.semaforo)
                        }}>●</span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {subTab === "eerr" && (
        <>
          {/* Selector de mes */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {[1, 2, 3, 4].map(m => (
              <button key={m} onClick={() => setMesPpto(m)} style={{
                padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                border: "none", cursor: "pointer",
                background: mesPpto === m ? "#34C759" : "#F2F2F7",
                color: mesPpto === m ? "#fff" : "#8E8E93"
              }}>{MESES[m]}</button>
            ))}
          </div>

          {/* Tabla EERR */}
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.04)", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#F2F2F7" }}>
                  <th style={{ ...thSt, minWidth: 200 }}>Ítem</th>
                  <th style={{ ...thSt, textAlign: "right" }}>Presupuesto</th>
                  <th style={{ ...thSt, textAlign: "right" }}>Real</th>
                  <th style={{ ...thSt, textAlign: "right" }}>Variación</th>
                  <th style={{ ...thSt, textAlign: "right" }}>% Ejec.</th>
                </tr>
              </thead>
              <tbody>
                {eerrMes.map((r, i) => {
                  const esSubtotal = r.es_subtotal
                  const esResultado = r.tipo === "RESULTADO"
                  const varFav = r.variacion != null && (
                    (r.tipo === "INGRESOS" && r.variacion > 0) ||
                    (r.tipo === "EGRESOS" && r.variacion < 0)
                  )
                  return (
                    <tr key={i} style={{
                      borderBottom: "1px solid #F2F2F7",
                      background: esResultado ? "#F2F2F7" : esSubtotal ? "#FAFAFA" : "#fff"
                    }}>
                      <td style={{
                        ...tdSt,
                        fontWeight: esSubtotal || esResultado ? 700 : 400,
                        paddingLeft: esSubtotal || esResultado ? 12 : 20,
                        color: esResultado ? "#007AFF" : "#1C1C1E",
                        borderTop: esResultado ? "2px solid #E5E5EA" : "none"
                      }}>{r.item}</td>
                      <td style={{ ...tdSt, textAlign: "right" }}>
                        {r.ppto_mes != null ? fmtM(r.ppto_mes) : "—"}
                      </td>
                      <td style={{ ...tdSt, textAlign: "right", fontWeight: r.real_mes != null ? 600 : 400 }}>
                        {r.real_mes != null ? fmtM(r.real_mes) : "—"}
                      </td>
                      <td style={{
                        ...tdSt, textAlign: "right", fontWeight: 600,
                        color: r.variacion == null ? "#AEAEB2" : varFav ? "#34C759" : "#FF3B30"
                      }}>
                        {r.variacion != null ? (r.variacion > 0 ? "+" : "") + fmtM(r.variacion) : "—"}
                      </td>
                      <td style={{ ...tdSt, textAlign: "right", color: "#8E8E93" }}>
                        {r.ejecucion_pct != null ? fmtPct(r.ejecucion_pct) : "—"}
                      </td>
                    </tr>
                  )
                })}
                {eerrMes.length === 0 && (
                  <tr><td colSpan={5} style={{ ...tdSt, textAlign: "center", color: "#AEAEB2", padding: 24 }}>
                    Sin datos para este mes
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {subTab === "metas" && (
        <>
          {!esAdmin ? (
            <div style={{ padding: 20, textAlign: "center", color: "#8E8E93", fontSize: 13 }}>
              Solo el administrador puede editar metas
            </div>
          ) : (
            <>
              <SectionLabel>Metas de venta {anio} — edición inline</SectionLabel>
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.04)", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#F2F2F7" }}>
                      <th style={thSt}>Sucursal</th>
                      <th style={thSt}>Mes</th>
                      <th style={{ ...thSt, textAlign: "right" }}>Meta actual</th>
                      <th style={{ ...thSt, textAlign: "right" }}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metas.map(m => (
                      <tr key={m.id} style={{ borderBottom: "1px solid #F2F2F7" }}>
                        <td style={{ ...tdSt, fontSize: 11, color: "#8E8E93" }}>{m.sucursal_bsale}</td>
                        <td style={tdSt}>{MESES_L[m.mes_numero]}</td>
                        <td style={{ ...tdSt, textAlign: "right" }}>
                          {editandoMeta === m.id ? (
                            <InputMeta
                              value={m.meta_venta}
                              onSave={v => guardarMeta(m.id, v)}
                              onCancel={() => setEditandoMeta(null)}
                            />
                          ) : (
                            <span style={{ fontWeight: 600 }}>{fmtM(m.meta_venta)}</span>
                          )}
                        </td>
                        <td style={{ ...tdSt, textAlign: "right" }}>
                          {editandoMeta !== m.id && (
                            <button onClick={() => setEditandoMeta(m.id)} style={{ ...btnSm, color: "#007AFF" }}>
                              Editar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {metas.length === 0 && (
                      <tr><td colSpan={4} style={{ ...tdSt, textAlign: "center", color: "#AEAEB2", padding: 24 }}>
                        Sin metas cargadas
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 100, right: 20, zIndex: 200,
          background: toast.tipo === "err" ? "#FF3B30" : "#34C759",
          color: "#fff", borderRadius: 10, padding: "10px 16px",
          fontSize: 13, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.15)"
        }}>{toast.msg}</div>
      )}
    </div>
  )
}

function InputMeta({ value, onSave, onCancel }) {
  const [v, setV] = useState(value || "")
  return (
    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
      <input
        type="number"
        value={v}
        onChange={e => setV(e.target.value)}
        style={{ width: 140, padding: "4px 8px", borderRadius: 6, border: "1px solid #E5E5EA", fontSize: 12 }}
      />
      <button onClick={() => onSave(v)} style={{ ...btnSm, background: "#34C759", color: "#fff" }}>✓</button>
      <button onClick={onCancel} style={btnSm}>✕</button>
    </div>
  )
}

/* UI helpers */
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
      textTransform: "uppercase", color: "#8E8E93",
      marginBottom: 8, paddingBottom: 4, borderBottom: "1px solid rgba(0,0,0,0.06)"
    }}>{children}</div>
  )
}
function KpiSm({ l, v, c }) {
  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: "10px 12px", border: "1px solid rgba(0,0,0,0.04)" }}>
      <div style={{ fontSize: 10, color: "#8E8E93", fontWeight: 500, marginBottom: 2 }}>{l}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: c || "#1C1C1E" }}>{v}</div>
    </div>
  )
}
function ProgressBar({ value, max = 100, color = "#34C759" }) {
  return (
    <div style={{ height: 5, background: "#F2F2F7", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ height: "100%", width: Math.min((value / max) * 100, 100) + "%", background: color, borderRadius: 3 }} />
    </div>
  )
}
function LoadingState({ label }) {
  return (
    <div style={{ minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 28, marginBottom: 8 }}>📈</div>
        <div style={{ fontSize: 13, color: "#8E8E93" }}>{label}</div></div>
    </div>
  )
}

const fmtM = v => { if (v == null) return "—"; const m = Math.abs(v) / 1e6; return (v < 0 ? "-" : "") + "$" + (m >= 1 ? m.toFixed(1) + "M" : Math.round(v).toLocaleString("es-CL")) }
const fmtPct = v => v == null ? "—" : Number(v).toFixed(1) + "%"
const semaforoC = s => ({ verde: "#34C759", amarillo: "#FF9500", rojo: "#FF3B30" }[s] || "#8E8E93")
const thSt = { padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#8E8E93", letterSpacing: "0.02em" }
const tdSt = { padding: "8px 12px", color: "#1C1C1E", verticalAlign: "middle" }
const btnSm = { padding: "5px 10px", borderRadius: 7, border: "1px solid #E5E5EA", background: "#F2F2F7", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "#1C1C1E" }
