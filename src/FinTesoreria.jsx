import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { fmt, hp } from '../lib/constants'

/* ═══ FIN TESORERÍA ═══ */

const SUCURSALES_BSALE = ["SUCURSAL LA GRANJA", "LOS ÁNGELES", "Maipu"]

export function FinTesoreria({ cu, isMobile }) {
  const [subTab, setSubTab] = useState("resumen")
  const [cierres, setCierres] = useState([])
  const [depositos, setDepositos] = useState([])
  const [ventasBsale, setVentasBsale] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroFecha, setFiltroFecha] = useState(hoy())
  const [toast, setToast] = useState(null)

  const esAdmin = cu.rol === "admin" || hp(cu, "aprobar_fin")

  useEffect(() => { cargarDatos() }, [filtroFecha])

  async function cargarDatos() {
    setLoading(true)
    const inicio = filtroFecha.slice(0, 7) + "-01"
    const [c, d, v, s] = await Promise.all([
      supabase.from("cierres_caja").select("*").gte("fecha", inicio).order("fecha", { ascending: false }),
      supabase.from("depositos_efectivo").select("*").gte("fecha", inicio).order("fecha", { ascending: false }),
      supabase.from("ventas_bsale").select("fecha,sucursal_bsale,total_venta,num_documentos").gte("fecha", inicio),
      supabase.from("sucursales").select("id,nombre")
    ])
    setCierres(c.data || [])
    setDepositos(d.data || [])
    setVentasBsale(v.data || [])
    setSucursales(s.data || [])
    setLoading(false)
  }

  const showToast = (msg, tipo = "ok") => {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  // Agrupar ventas BSALE por fecha y sucursal
  const ventasMap = {}
  ventasBsale.forEach(v => {
    const k = `${v.fecha}|${v.sucursal_bsale}`
    if (!ventasMap[k]) ventasMap[k] = 0
    ventasMap[k] += Number(v.total_venta) || 0
  })

  // Resumen del período
  const totalVentaBsale = ventasBsale.reduce((s, v) => s + (Number(v.total_venta) || 0), 0)
  const totalDeclarado = cierres.reduce((s, c) => s + (Number(c.total_declarado) || 0), 0)
  const totalCorroborado = cierres.reduce((s, c) => s + (Number(c.total_corroborado) || 0), 0)
  const totalDepositado = depositos.reduce((s, d) => s + (Number(d.monto_depositado) || 0), 0)
  const brecha = totalVentaBsale - totalDeclarado
  const cierresPendientes = cierres.filter(c => c.estado === "declarado").length

  if (loading) return <LoadingState label="Cargando tesorería..." />

  return (
    <div>
      {/* TABS */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        {[["resumen", "Resumen"], ["cierres", "Cierres"], ["depositos", "Depósitos"]].map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k)} style={{
            padding: "8px 16px", fontSize: 13, fontWeight: 600,
            background: "none", border: "none", cursor: "pointer",
            color: subTab === k ? "#34C759" : "#8E8E93",
            borderBottom: subTab === k ? "2px solid #34C759" : "2px solid transparent"
          }}>{l}</button>
        ))}
      </div>

      {/* Selector de mes */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: "#8E8E93" }}>Período:</span>
        <input type="month" value={filtroFecha.slice(0, 7)}
          onChange={e => setFiltroFecha(e.target.value + "-01")}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #E5E5EA", fontSize: 12 }} />
      </div>

      {/* KPIs resumen */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8, marginBottom: 16 }}>
        <KpiSm l="Venta BSALE" v={fmtM(totalVentaBsale)} c="#007AFF" />
        <KpiSm l="Total declarado" v={fmtM(totalDeclarado)} c="#1C1C1E" />
        <KpiSm l="Brecha" v={fmtM(Math.abs(brecha))}
          c={Math.abs(brecha) > 50000 ? "#FF3B30" : "#34C759"}
          sub={brecha > 0 ? "Venta > declarado" : brecha < 0 ? "Declarado > venta" : "Cuadra"} />
        <KpiSm l="Depositado" v={fmtM(totalDepositado)} c="#34C759" />
        <KpiSm l="Pendientes" v={cierresPendientes} c={cierresPendientes > 0 ? "#FF9500" : "#34C759"} />
      </div>

      {subTab === "resumen" && (
        <ResumenCuadratura
          cierres={cierres}
          ventasMap={ventasMap}
          sucursales={sucursales}
          esAdmin={esAdmin}
          onCorroborar={async (id, datos) => {
            const { error } = await supabase.from("cierres_caja")
              .update({ ...datos, estado: "corroborado", admin_id: cu.id, corroborado_at: new Date().toISOString() })
              .eq("id", id)
            if (error) { showToast("Error: " + error.message, "err"); return }
            showToast("Cierre corroborado")
            cargarDatos()
          }}
        />
      )}

      {subTab === "cierres" && (
        <TablaCierres cierres={cierres} ventasMap={ventasMap} />
      )}

      {subTab === "depositos" && (
        <TablaDepositos depositos={depositos} />
      )}

      {toast && <Toast msg={toast.msg} tipo={toast.tipo} />}
    </div>
  )
}

function ResumenCuadratura({ cierres, ventasMap, esAdmin, onCorroborar }) {
  // Agrupar por fecha y sucursal
  const dias = {}
  cierres.forEach(c => {
    const k = c.fecha
    if (!dias[k]) dias[k] = []
    dias[k].push(c)
  })

  return (
    <div>
      {Object.entries(dias).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 15).map(([fecha, cs]) => (
        <div key={fecha} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", marginBottom: 10, border: "1px solid rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E", marginBottom: 10 }}>
            {new Date(fecha + "T12:00:00").toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })}
          </div>
          {cs.map(c => {
            const ventaBsale = Object.entries(ventasMap)
              .filter(([k]) => k.startsWith(fecha))
              .reduce((s, [, v]) => s + v, 0)
            const brecha = Number(c.total_declarado) - ventaBsale
            const ok = Math.abs(brecha) <= 2000
            return (
              <div key={c.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 0", borderBottom: "1px solid #F2F2F7", flexWrap: "wrap", gap: 8
              }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Sucursal {c.sucursal_id}</div>
                  <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 2 }}>
                    Declarado: {fmt(Number(c.total_declarado))} · Estado: {c.estado}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 100,
                    background: ok ? "#34C75915" : "#FF3B3015",
                    color: ok ? "#34C759" : "#FF3B30"
                  }}>{ok ? "Cuadra" : `Brecha ${fmt(Math.abs(brecha))}`}</span>
                  {c.estado === "declarado" && esAdmin && (
                    <button
                      onClick={() => onCorroborar(c.id, { total_corroborado: c.total_declarado })}
                      style={{ ...btnSm, background: "#34C75915", color: "#34C759", border: "1px solid #34C75930" }}
                    >Corroborar</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
      {Object.keys(dias).length === 0 && (
        <EmptyState text="Sin cierres registrados en este período" />
      )}
    </div>
  )
}

function TablaCierres({ cierres }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.04)", overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#F2F2F7" }}>
            <th style={thSt}>Fecha</th>
            <th style={thSt}>Sucursal</th>
            <th style={{ ...thSt, textAlign: "right" }}>Efectivo</th>
            <th style={{ ...thSt, textAlign: "right" }}>Tarjeta</th>
            <th style={{ ...thSt, textAlign: "right" }}>Webpay</th>
            <th style={{ ...thSt, textAlign: "right" }}>Total</th>
            <th style={thSt}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {cierres.slice(0, 100).map(c => (
            <tr key={c.id} style={{ borderBottom: "1px solid #F2F2F7" }}>
              <td style={tdSt}>{c.fecha}</td>
              <td style={{ ...tdSt, color: "#8E8E93" }}>{c.sucursal_id}</td>
              <td style={{ ...tdSt, textAlign: "right" }}>{fmt(c.efectivo)}</td>
              <td style={{ ...tdSt, textAlign: "right" }}>{fmt(Number(c.t_credito) + Number(c.t_debito))}</td>
              <td style={{ ...tdSt, textAlign: "right" }}>{fmt(c.webpay)}</td>
              <td style={{ ...tdSt, textAlign: "right", fontWeight: 600 }}>{fmt(c.total_declarado)}</td>
              <td style={tdSt}>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 100,
                  background: c.estado === "corroborado" ? "#34C75915" : c.estado === "declarado" ? "#FF950015" : "#F2F2F7",
                  color: c.estado === "corroborado" ? "#34C759" : c.estado === "declarado" ? "#FF9500" : "#8E8E93"
                }}>{c.estado}</span>
              </td>
            </tr>
          ))}
          {cierres.length === 0 && (
            <tr><td colSpan={7} style={{ ...tdSt, textAlign: "center", color: "#AEAEB2", padding: 24 }}>Sin cierres</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function TablaDepositos({ depositos }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.04)", overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#F2F2F7" }}>
            <th style={thSt}>Fecha depósito</th>
            <th style={thSt}>Sucursal</th>
            <th style={{ ...thSt, textAlign: "right" }}>Monto depositado</th>
            <th style={{ ...thSt, textAlign: "right" }}>No depositado</th>
            <th style={thSt}>Estado</th>
            <th style={thSt}>Comprobante</th>
          </tr>
        </thead>
        <tbody>
          {depositos.slice(0, 100).map(d => (
            <tr key={d.id} style={{ borderBottom: "1px solid #F2F2F7" }}>
              <td style={tdSt}>{d.fecha_deposito || d.fecha}</td>
              <td style={{ ...tdSt, color: "#8E8E93" }}>{d.sucursal_id}</td>
              <td style={{ ...tdSt, textAlign: "right", fontWeight: 600, color: "#34C759" }}>{fmt(d.monto_depositado)}</td>
              <td style={{ ...tdSt, textAlign: "right", color: Number(d.total_no_depositado) > 0 ? "#FF9500" : "#8E8E93" }}>
                {fmt(d.total_no_depositado || 0)}
              </td>
              <td style={tdSt}>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 100,
                  background: d.estado === "confirmado" ? "#34C75915" : "#FF950015",
                  color: d.estado === "confirmado" ? "#34C759" : "#FF9500"
                }}>{d.estado || "pendiente"}</span>
              </td>
              <td style={tdSt}>
                {d.comprobante_url ? (
                  <a href={d.comprobante_url} target="_blank" rel="noopener" style={{ color: "#007AFF", fontSize: 11 }}>Ver ✓</a>
                ) : <span style={{ color: "#AEAEB2", fontSize: 11 }}>Sin archivo</span>}
              </td>
            </tr>
          ))}
          {depositos.length === 0 && (
            <tr><td colSpan={6} style={{ ...tdSt, textAlign: "center", color: "#AEAEB2", padding: 24 }}>Sin depósitos</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/* Helpers */
function KpiSm({ l, v, c, sub }) {
  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: "10px 12px", border: "1px solid rgba(0,0,0,0.04)" }}>
      <div style={{ fontSize: 10, color: "#8E8E93", fontWeight: 500, marginBottom: 2 }}>{l}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: c || "#1C1C1E" }}>{v}</div>
      {sub && <div style={{ fontSize: 10, color: "#8E8E93", marginTop: 1 }}>{sub}</div>}
    </div>
  )
}
function EmptyState({ text }) {
  return <div style={{ padding: "30px 0", textAlign: "center", color: "#AEAEB2", fontSize: 13 }}>{text}</div>
}
function LoadingState({ label }) {
  return (
    <div style={{ minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 28, marginBottom: 8 }}>💵</div>
        <div style={{ fontSize: 13, color: "#8E8E93" }}>{label}</div></div>
    </div>
  )
}
function Toast({ msg, tipo }) {
  return (
    <div style={{
      position: "fixed", bottom: 100, right: 20, zIndex: 200,
      background: tipo === "err" ? "#FF3B30" : "#34C759",
      color: "#fff", borderRadius: 10, padding: "10px 16px",
      fontSize: 13, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.15)"
    }}>{msg}</div>
  )
}

const fmt = n => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n || 0)
const fmtM = v => { if (!v) return "—"; const m = Math.abs(v) / 1e6; return (v < 0 ? "-" : "") + "$" + (m >= 1 ? m.toFixed(1) + "M" : Math.round(v).toLocaleString("es-CL")) }
const hoy = () => new Date().toISOString().slice(0, 10)
const btnSm = { padding: "6px 12px", borderRadius: 8, border: "1px solid #E5E5EA", background: "#F2F2F7", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#1C1C1E" }
const thSt = { padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#8E8E93", letterSpacing: "0.02em" }
const tdSt = { padding: "8px 12px", color: "#1C1C1E", verticalAlign: "middle" }
