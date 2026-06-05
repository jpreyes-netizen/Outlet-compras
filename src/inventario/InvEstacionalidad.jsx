import { useMemo, useState } from 'react'
import { fN, fmtMM, card, SectionTitle, MES_LBL } from './ui'

/* Color de celda heatmap según índice (1.0 = neutro) */
function heatColor(idx) {
  if (idx === 0) return "#F2F2F7"
  if (idx >= 1.3) return "#34C759"
  if (idx >= 1.1) return "#9BDFA8"
  if (idx >= 0.9) return "#F2F2F7"
  if (idx >= 0.7) return "#FFD8A8"
  return "#FFB3AE"
}

export function InvEstacionalidad({ data, accent, isMobile }) {
  const { est, an } = data
  const meses = est.meses
  const [orden, setOrden] = useState("volumen")

  // armar filas tipo, ordenadas por volumen total
  const filas = useMemo(() => {
    const arr = Object.entries(est.indice).map(([tipo, row]) => ({
      tipo, totalQty: row._totalQty || 0,
      idx: meses.map(m => row[m] || 0),
      pico: meses[meses.reduce((bi, m, i) => (row[m] || 0) > (row[meses[bi]] || 0) ? i : bi, 0)],
      valle: meses[meses.reduce((bi, m, i) => (row[m] || 0) < (row[meses[bi]] || 0) ? i : bi, 0)],
    }))
    if (orden === "volumen") arr.sort((a, b) => b.totalQty - a.totalQty)
    else arr.sort((a, b) => Math.max(...b.idx) - Math.min(...b.idx) - (Math.max(...a.idx) - Math.min(...a.idx)))
    return arr.filter(f => f.totalQty > 0)
  }, [est, meses, orden])

  // venta total por mes (todas categorías)
  const ventaMes = useMemo(() => {
    const v = {}
    for (const e of data.ventas.porSku.values())
      for (const [key, c] of e.porSucMes) { const m = key.split("|")[1]; v[m] = (v[m] || 0) + c.neto }
    return v
  }, [data])
  const maxVentaMes = Math.max(...meses.map(m => ventaMes[m] || 0))

  return (
    <div>
      {/* Venta global por mes */}
      <div style={card}>
        <SectionTitle sub="Venta neta mensual del período analizado">Tendencia mensual global</SectionTitle>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 140, padding: "8px 0" }}>
          {meses.map(m => {
            const v = ventaMes[m] || 0
            const h = maxVentaMes > 0 ? (v / maxVentaMes) * 100 : 0
            return (
              <div key={m} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ fontSize: 10, color: "#636366", fontWeight: 600 }}>{fmtMM(v)}</div>
                <div style={{ width: "70%", height: h + "%", minHeight: 4, background: "linear-gradient(180deg," + accent + "," + accent + "aa)", borderRadius: "6px 6px 0 0", transition: "height .4s" }} />
                <div style={{ fontSize: 11, color: "#8E8E93", fontWeight: 600 }}>{MES_LBL(m)}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Heatmap por tipo */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <SectionTitle sub="Índice mensual por tipo · 1.0 = mes promedio · verde sobre-venta, rojo bajo-venta">Estacionalidad por categoría</SectionTitle>
          <select value={orden} onChange={e => setOrden(e.target.value)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e5ea", fontSize: 12 }}>
            <option value="volumen">Ordenar por volumen</option>
            <option value="variacion">Ordenar por variación estacional</option>
          </select>
        </div>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table>
            <thead><tr style={{ color: "#8E8E93", fontSize: 11 }}>
              <th style={{ padding: "6px 8px", textAlign: "left", position: "sticky", left: 0, background: "#fff" }}>Categoría</th>
              {meses.map(m => <th key={m} style={{ padding: "6px 6px", textAlign: "center" }}>{MES_LBL(m).split(" ")[0]}</th>)}
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Volumen</th>
            </tr></thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.tipo} style={{ borderTop: "1px solid #F7F7FA" }}>
                  <td style={{ padding: "6px 8px", fontSize: 12, fontWeight: 600, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", position: "sticky", left: 0, background: "#fff" }} title={f.tipo}>{f.tipo}</td>
                  {f.idx.map((v, i) => (
                    <td key={i} style={{ padding: "5px 6px", textAlign: "center" }}>
                      <div style={{ background: heatColor(v), borderRadius: 6, padding: "5px 2px", fontSize: 11, fontWeight: 700, color: v >= 1.3 || v < 0.7 ? "#fff" : "#3A3A3C", minWidth: 38 }} title={"Índice " + v.toFixed(2)}>
                        {v ? v.toFixed(2) : "—"}
                      </div>
                    </td>
                  ))}
                  <td style={{ padding: "6px 8px", textAlign: "right", fontSize: 12, color: "#636366" }}>{fN(f.totalQty)} u</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, fontSize: 11.5, color: "#8E8E93", lineHeight: 1.6 }}>
          <b>Cómo leerlo:</b> un índice de 1.30 significa que esa categoría vendió 30% sobre su promedio mensual — es su temporada alta. Usa los picos para anticipar compras (con el lead time del proveedor) y los valles para liquidar antes de que baje la demanda.
        </div>
      </div>

      {/* Insights automáticos */}
      <div style={card}>
        <SectionTitle>📌 Lecturas de estacionalidad</SectionTitle>
        {filas.slice(0, 6).map(f => {
          const picoIdx = Math.max(...f.idx)
          const valleIdx = Math.min(...f.idx.filter(v => v > 0))
          if (picoIdx < 1.2) return null
          return (
            <div key={f.tipo} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid #F7F7FA", fontSize: 13 }}>
              <span style={{ fontSize: 16 }}>📈</span>
              <div>
                <b>{f.tipo}</b> peak en <b style={{ color: "#34C759" }}>{MES_LBL(f.pico)}</b> ({picoIdx.toFixed(2)}x) y piso en <b style={{ color: "#FF3B30" }}>{MES_LBL(f.valle)}</b> ({valleIdx.toFixed(2)}x).
                <span style={{ color: "#8E8E93" }}> Asegura stock antes del peak considerando el lead time del proveedor.</span>
              </div>
            </div>
          )
        })}
        <div style={{ fontSize: 11, color: "#AEAEB2", marginTop: 8 }}>Nota: con {meses.length} meses de historia los índices son preliminares. Se afinan con más temporadas cargadas.</div>
      </div>
    </div>
  )
}
