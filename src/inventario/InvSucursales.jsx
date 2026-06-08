import { useMemo, useState } from 'react'
import { fN, fmtMM, pct, card, CL_ESTADO, CL_VELOCIDAD, EstadoChip, ClaseChip, SectionTitle, Bar, Lectura } from './ui'
import { SUCURSALES } from './engine'

const SUC_COLOR = { "La Granja": "#34C759", "Los Angeles": "#007AFF", "Maipu": "#FF9500" }

export function InvSucursales({ data, accent, isMobile }) {
  const { kSuc, an } = data
  const [sucSel, setSucSel] = useState("La Granja")
  const [filtro, setFiltro] = useState("Quiebre")

  const maxVenta = Math.max(...SUCURSALES.map(s => kSuc[s].venta))

  // Líder y rezagado por GMROI para lectura comparativa
  const ranking = useMemo(() => {
    const arr = SUCURSALES.map(s => ({ s, ...kSuc[s] })).filter(x => x.venta > 0)
    arr.sort((a, b) => b.venta - a.venta)
    return arr
  }, [kSuc])

  const skusSuc = useMemo(() => {
    let r = an.items.map(x => ({ ...x.porSuc[sucSel], sku: x.sku, producto: x.producto, clase: x.clase, tipo: x.tipo }))
    if (filtro === "Quiebre") r = r.filter(x => x.estado === "Quiebre")
    else if (filtro === "Dead stock") r = r.filter(x => x.estado === "Dead stock")
    else if (filtro === "ConStock") r = r.filter(x => x.stockUnid > 0)
    return r.sort((a, b) => b.netoVend - a.netoVend || b.stockValor - a.stockValor).slice(0, 60)
  }, [an, sucSel, filtro])

  return (
    <div>
      {/* Cards comparativas con GMROI y rotación */}
      <div style={{ display: isMobile ? "block" : "flex", gap: 12, marginBottom: 4 }}>
        {SUCURSALES.map(s => {
          const x = kSuc[s]
          return (
            <div key={s} onClick={() => setSucSel(s)} style={{ ...card, flex: 1, cursor: "pointer", borderLeft: "4px solid " + SUC_COLOR[s], boxShadow: sucSel === s ? "0 3px 14px " + SUC_COLOR[s] + "44" : card.boxShadow }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: SUC_COLOR[s] }}>{s}</div>
                {sucSel === s && <span style={{ fontSize: 11, color: SUC_COLOR[s], fontWeight: 700 }}>● activa</span>}
              </div>
              <div style={{ fontSize: 11, color: "#8E8E93" }}>Venta período · margen {pct(x.margenPct)}</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>{fmtMM(x.venta)}</div>
              <Bar value={x.venta} max={maxVenta} color={SUC_COLOR[s]} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 12 }}>
                <div><div style={{ color: "#8E8E93", fontSize: 10 }}>GMROI</div><b style={{ color: x.gmroi >= 2 ? "#34C759" : x.gmroi >= 1 ? "#FF9500" : "#FF3B30" }}>{x.gmroi.toFixed(2)}</b></div>
                <div><div style={{ color: "#8E8E93", fontSize: 10 }}>Rotación</div><b>{x.rotValorizada.toFixed(1)}x</b></div>
                <div><div style={{ color: "#8E8E93", fontSize: 10 }}>Quiebre</div><b style={{ color: CL_ESTADO["Quiebre"] }}>{x.quiebre}</b></div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#8E8E93" }}>Inventario <b>{fmtMM(x.valorInventario)}</b> · tasa quiebre <b style={{ color: x.tasaQuiebre > 0.3 ? "#FF3B30" : "#FF9500" }}>{pct(x.tasaQuiebre)}</b></div>
            </div>
          )
        })}
      </div>

      {/* Lectura comparativa */}
      {ranking.length >= 2 && (
        <div style={card}>
          <SectionTitle sub="Cómo se comparan tus sucursales en eficiencia de inventario">📊 Lectura comparativa</SectionTitle>
          <Lectura icon="🏆" titulo={ranking[0].s + ":"} color="#34C759">
            es la sucursal que mejor vende — {fmtMM(ranking[0].venta)} en el período con margen {pct(ranking[0].margenPct)}.
            {ranking[0].gmroi > 0 && ` Por cada $1 en mercadería genera $${ranking[0].gmroi.toFixed(2)} de ganancia.`}
          </Lectura>
          {ranking.length >= 2 && ranking[ranking.length - 1].venta < ranking[0].venta * 0.7 && (
            <Lectura icon="📉" titulo={ranking[ranking.length - 1].s + ":"} color="#FF9500">
              es la que menos vende ({fmtMM(ranking[ranking.length - 1].venta)}). Revisar si es por menos tráfico, peor surtido, o más quiebres ({ranking[ranking.length - 1].quiebre} productos agotados).
            </Lectura>
          )}
          {kSuc["Maipu"] && kSuc["Maipu"].venta < (kSuc["La Granja"]?.venta || 0) * 0.5 && kSuc["Maipu"].valorInventario > 0 && (
            <Lectura icon="📍" titulo="Maipú:" color="#FF9500">
              vende poco pero concentra mucho inventario. Probablemente funciona como centro de distribución (CD) que abastece a las otras sucursales — no la juzgues como punto de venta tradicional.
            </Lectura>
          )}
          {ranking.every(r => r.quiebre > r.skusConStock * 0.3) && (
            <Lectura icon="🚨" titulo="Alerta general:" color="#FF3B30">
              todas las sucursales tienen alta tasa de quiebre. Esto suele indicar un problema de abastecimiento central, no de cada tienda. Revisar el flujo de compras y la redistribución desde el CD.
            </Lectura>
          )}
        </div>
      )}

      {/* Detalle sucursal */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <SectionTitle sub={"SKU de " + sucSel}>Detalle — {sucSel}</SectionTitle>
          <div style={{ display: "flex", gap: 6 }}>
            {[["Quiebre", "Quiebres"], ["Dead stock", "Dead stock"], ["ConStock", "Con stock"]].map(([key, l]) => (
              <button key={key} onClick={() => setFiltro(key)} style={{ padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: filtro === key ? accent : "#F2F2F7", color: filtro === key ? "#fff" : "#636366" }}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table>
            <thead><tr style={{ color: "#8E8E93", fontSize: 11, textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>Cls</th><th style={{ padding: "6px 8px" }}>Producto</th><th style={{ padding: "6px 8px" }}>Estado</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Stock</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Vendido</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Cobertura</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Venta $</th>
            </tr></thead>
            <tbody>
              {skusSuc.map(x => (
                <tr key={x.sku} style={{ borderTop: "1px solid #F7F7FA" }}>
                  <td style={{ padding: "7px 8px" }}><ClaseChip c={x.clase} /></td>
                  <td style={{ padding: "7px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={x.producto}>{x.producto}<div style={{ fontSize: 10, color: "#AEAEB2", fontFamily: "monospace" }}>{x.sku}</div></td>
                  <td style={{ padding: "7px 8px" }}><EstadoChip e={x.estado === "OK" ? "Saludable" : x.estado} /></td>
                  <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(x.stockUnid)}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(x.qtyVend)}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", color: x.cobertura < 15 ? "#FF3B30" : "#1C1C1E" }}>{x.cobertura >= 999 ? "∞" : x.cobertura + "d"}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", color: "#636366" }}>{fmtMM(x.netoVend)}</td>
                </tr>
              ))}
              {skusSuc.length === 0 && <tr><td colSpan={7} style={{ padding: 16, textAlign: "center", color: "#8E8E93" }}>Sin SKU en esta vista</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
