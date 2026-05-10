import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { fmt, fN } from '../lib/constants'

/* ═══ FIN DASHBOARD — KPIs de ventas y financiero ═══ */

const fmtPct = v => (v == null || isNaN(v)) ? "—" : Number(v).toFixed(1) + "%"
const fmtM = v => {
  if (v == null || isNaN(v)) return "—"
  const m = Math.abs(v) / 1e6
  const sign = v < 0 ? "-" : ""
  if (m >= 1000) return sign + "$" + (m / 1000).toFixed(1) + "B"
  if (m >= 1) return sign + "$" + m.toFixed(1) + "M"
  return fmt(v)
}

const semaforoColor = s => ({ verde: "#34C759", amarillo: "#FF9500", rojo: "#FF3B30" }[s] || "#8E8E93")
const semaforoBg = s => ({ verde: "#34C75915", amarillo: "#FF950015", rojo: "#FF3B3015" }[s] || "#F2F2F7")

export function FinDashboard({ cu, isMobile }) {
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState({})
  const [data, setData] = useState({
    semaforo: null,
    controlVentas: [],
    forecast: [],
    ventasMes: [],
    topProveedores: [],
    rankingVendedores: [],
    eerrControl: [],
    libroCompras: { mes: 0, facturas: 0 }
  })

  useEffect(() => {
    cargarDatos()
  }, [])

  async function cargarDatos() {
    setLoading(true)
    const errs = {}
    const out = { ...data }

    const mesActual = new Date().getMonth() + 1
    const anioActual = new Date().getFullYear()
    const inicioMes = `${anioActual}-${String(mesActual).padStart(2, '0')}-01`
    const finMes = new Date(anioActual, mesActual, 0).toISOString().split('T')[0]

    // Semáforo presupuesto YTD
    try {
      const { data: r } = await supabase.from('v_semaforo_presupuesto').select('*').single()
      out.semaforo = r
    } catch (e) { errs.semaforo = e.message }

    // Control ventas vs metas
    try {
      const { data: r } = await supabase.from('v_control_ventas')
        .select('*')
        .lte('mes_numero', mesActual)
        .eq('anio', anioActual)
        .order('sucursal_bsale')
        .order('mes_numero')
      out.controlVentas = r || []
    } catch (e) { errs.controlVentas = e.message }

    // Forecast anual
    try {
      const { data: r } = await supabase.from('v_forecast_ventas').select('*')
      out.forecast = r || []
    } catch (e) { errs.forecast = e.message }

    // Venta mensual 2026
    try {
      const { data: r } = await supabase.from('ventas_bsale')
        .select('fecha,total_venta,num_documentos')
        .gte('fecha', `${anioActual}-01-01`)
        .lte('fecha', `${anioActual}-12-31`)
      // Agrupar por mes en cliente
      const porMes = {}
      ;(r || []).forEach(v => {
        const m = new Date(v.fecha).getMonth() + 1
        if (!porMes[m]) porMes[m] = { mes: m, total: 0, docs: 0 }
        porMes[m].total += Number(v.total_venta) || 0
        porMes[m].docs += Number(v.num_documentos) || 0
      })
      out.ventasMes = Object.values(porMes).sort((a, b) => a.mes - b.mes)
    } catch (e) { errs.ventasMes = e.message }

    // Top 5 proveedores mes actual
    try {
      const { data: r } = await supabase.from('libro_compras')
        .select('razon_social,monto_total')
        .neq('anulado', true)
        .gte('fecha_emision', inicioMes)
        .lte('fecha_emision', finMes)
      const porProv = {}
      ;(r || []).forEach(f => {
        const k = f.razon_social || "Sin nombre"
        if (!porProv[k]) porProv[k] = { nombre: k, total: 0, n: 0 }
        porProv[k].total += Number(f.monto_total) || 0
        porProv[k].n += 1
      })
      out.topProveedores = Object.values(porProv)
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
      out.libroCompras.mes = (r || []).reduce((s, f) => s + (Number(f.monto_total) || 0), 0)
      out.libroCompras.facturas = (r || []).length
    } catch (e) { errs.topProveedores = e.message }

    // Ranking vendedores mes actual
    try {
      const { data: r } = await supabase.from('ventas_bsale')
        .select('vendedor_bsale,sucursal_bsale,total_venta,num_documentos')
        .gte('fecha', inicioMes)
        .lte('fecha', finMes)
      const porVendedor = {}
      ;(r || []).forEach(v => {
        const k = `${v.vendedor_bsale}|${v.sucursal_bsale}`
        if (!porVendedor[k]) porVendedor[k] = {
          nombre: v.vendedor_bsale, sucursal: v.sucursal_bsale, total: 0, docs: 0
        }
        porVendedor[k].total += Number(v.total_venta) || 0
        porVendedor[k].docs += Number(v.num_documentos) || 0
      })
      out.rankingVendedores = Object.values(porVendedor)
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
    } catch (e) { errs.rankingVendedores = e.message }

    setData(out)
    setErrors(errs)
    setLoading(false)
  }

  // Cálculos derivados
  const margenPct = useMemo(() => {
    if (!data.semaforo) return null
    const venta = Number(data.semaforo.venta_real_ytd) || 0
    const gasto = Number(data.semaforo.gasto_real_ytd) || 0
    if (venta === 0) return null
    return ((venta - gasto) / venta) * 100
  }, [data.semaforo])

  if (loading) return (
    <div style={{ minHeight: 400, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
        <div style={{ fontSize: 14, color: "#8E8E93" }}>Cargando indicadores...</div>
      </div>
    </div>
  )

  return (
    <div>
      {/* === KPIs MACRO YTD === */}
      <div style={{ marginBottom: 18 }}>
        <SectionLabel>Resumen YTD · {data.semaforo?.mes_actual ? `enero a mes ${data.semaforo.mes_actual}` : "año en curso"}</SectionLabel>
        <div className="kpi-grid" style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(auto-fit,minmax(150px,1fr))",
          gap: 10
        }}>
          <KpiCard
            label="Venta real YTD"
            value={fmtM(data.semaforo?.venta_real_ytd)}
            sub={`Meta: ${fmtM(data.semaforo?.meta_venta_ytd)}`}
            color="#34C759"
          />
          <KpiCard
            label="Avance meta"
            value={fmtPct(data.semaforo?.avance_meta_pct)}
            sub={data.semaforo?.semaforo_venta || "—"}
            color={semaforoColor(data.semaforo?.semaforo_venta)}
            bg={semaforoBg(data.semaforo?.semaforo_venta)}
          />
          <KpiCard
            label="Gasto compras"
            value={fmtM(data.semaforo?.gasto_real_ytd)}
            sub={`${fN(data.libroCompras.facturas)} facturas`}
            color="#FF9500"
          />
          <KpiCard
            label="Margen bruto"
            value={fmtPct(margenPct)}
            sub={fmtM(data.semaforo?.margen_real_ytd)}
            color={margenPct >= 50 ? "#34C759" : margenPct >= 30 ? "#FF9500" : "#FF3B30"}
          />
        </div>
      </div>

      {/* === FORECAST POR SUCURSAL === */}
      {data.forecast.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <SectionLabel>Forecast anual por sucursal</SectionLabel>
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(240px,1fr))",
            gap: 10
          }}>
            {data.forecast
              .filter(f => Number(f.meses_reales) >= 2)
              .map(f => (
                <Card key={f.sucursal_bsale}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E", marginBottom: 8 }}>
                    {f.sucursal_bsale}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "#8E8E93" }}>Real YTD</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtM(f.real_ytd)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, color: "#8E8E93" }}>Forecast anual</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: semaforoColor(f.semaforo) }}>
                      {fmtM(f.forecast_anual)}
                    </span>
                  </div>
                  <ProgressBar
                    value={Math.min(Number(f.forecast_pct) || 0, 150)}
                    max={150}
                    color={semaforoColor(f.semaforo)}
                  />
                  <div style={{ fontSize: 10, color: "#8E8E93", marginTop: 4, textAlign: "right" }}>
                    {fmtPct(f.forecast_pct)} del ppto · ppto {fmtM(f.ppto_anual)}
                  </div>
                </Card>
              ))}
          </div>
        </div>
      )}

      {/* === VENTA MENSUAL === */}
      {data.ventasMes.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <SectionLabel>Venta mensual {new Date().getFullYear()}</SectionLabel>
          <Card>
            <BarChart data={data.ventasMes} isMobile={isMobile} />
          </Card>
        </div>
      )}

      {/* === TOP PROVEEDORES + RANKING VENDEDORES === */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
        gap: 10,
        marginBottom: 18
      }}>
        {/* Top proveedores */}
        <div>
          <SectionLabel>Top 5 proveedores · mes actual</SectionLabel>
          <Card>
            {data.topProveedores.length === 0 ? (
              <EmptyState text="Sin datos del mes actual" />
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {data.topProveedores.map((p, i) => (
                    <tr key={i} style={{ borderBottom: i < 4 ? "1px solid #F2F2F7" : "none" }}>
                      <td style={{ padding: "8px 0", color: "#1C1C1E", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.nombre}>
                        {p.nombre}
                      </td>
                      <td style={{ padding: "8px 0", textAlign: "right", color: "#8E8E93", fontSize: 11 }}>
                        {p.n} fact.
                      </td>
                      <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 600 }}>
                        {fmtM(p.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {/* Ranking vendedores */}
        <div>
          <SectionLabel>Ranking vendedores · mes actual</SectionLabel>
          <Card>
            {data.rankingVendedores.length === 0 ? (
              <EmptyState text="Sin ventas del mes actual" />
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {data.rankingVendedores.slice(0, 8).map((v, i) => (
                    <tr key={i} style={{ borderBottom: i < 7 ? "1px solid #F2F2F7" : "none" }}>
                      <td style={{ padding: "8px 0", width: 24, color: "#8E8E93", fontSize: 11, fontWeight: 600 }}>
                        #{i + 1}
                      </td>
                      <td style={{ padding: "8px 0", color: "#1C1C1E" }} title={v.nombre}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                          {v.nombre}
                        </div>
                        <div style={{ fontSize: 10, color: "#AEAEB2", marginTop: 1 }}>
                          {v.sucursal}
                        </div>
                      </td>
                      <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 600 }}>
                        {fmtM(v.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>

      {/* === Errores si hay === */}
      {Object.keys(errors).length > 0 && (
        <div style={{
          background: "#FF3B3015", border: "1px solid #FF3B3030",
          borderRadius: 12, padding: 12, marginBottom: 18, fontSize: 12, color: "#FF3B30"
        }}>
          <strong>Algunos datos no cargaron:</strong>
          <ul style={{ marginLeft: 18, marginTop: 4 }}>
            {Object.entries(errors).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ═══ Sub-componentes ═══ */

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
      textTransform: "uppercase", color: "#8E8E93",
      marginBottom: 8, paddingBottom: 4, borderBottom: "1px solid rgba(0,0,0,0.06)"
    }}>{children}</div>
  )
}

function KpiCard({ label, value, sub, color, bg }) {
  return (
    <div style={{
      background: bg || "#fff",
      borderRadius: 14,
      padding: "14px 16px",
      border: "1px solid rgba(0,0,0,0.04)",
      boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
    }}>
      <div style={{ fontSize: 11, color: "#8E8E93", fontWeight: 500, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "#1C1C1E", letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Card({ children }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 14, padding: "14px 16px",
      border: "1px solid rgba(0,0,0,0.04)",
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
    }}>{children}</div>
  )
}

function ProgressBar({ value, max = 100, color = "#34C759" }) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div style={{ height: 6, background: "#F2F2F7", borderRadius: 3, overflow: "hidden" }}>
      <div style={{
        height: "100%", width: pct + "%",
        background: color, borderRadius: 3, transition: "width 0.4s"
      }} />
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div style={{ padding: "20px 0", textAlign: "center", color: "#AEAEB2", fontSize: 12 }}>
      {text}
    </div>
  )
}

function BarChart({ data, isMobile }) {
  const max = Math.max(...data.map(d => d.total), 1)
  const meses = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
  const altura = 140

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: isMobile ? 4 : 8, height: altura + 30, paddingTop: 8 }}>
      {data.map(d => {
        const h = (d.total / max) * altura
        return (
          <div key={d.mes} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{
              fontSize: 9, color: "#8E8E93", fontWeight: 600, marginBottom: 2,
              opacity: d.total > 0 ? 1 : 0.3
            }}>{fmtM(d.total)}</div>
            <div style={{
              width: "100%", height: h, minHeight: d.total > 0 ? 2 : 0,
              background: "#34C759", borderRadius: "4px 4px 0 0",
              transition: "height 0.4s"
            }} />
            <div style={{ fontSize: 10, color: "#8E8E93", fontWeight: 500 }}>{meses[d.mes]}</div>
          </div>
        )
      })}
    </div>
  )
}
