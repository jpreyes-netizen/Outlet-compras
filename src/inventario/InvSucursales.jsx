import { useMemo, useState } from 'react'
import { fN, fmtMM, pct, card, KPI, CL_ESTADO, EstadoChip, ClaseChip, SectionTitle, Bar } from './ui'
import { SUCURSALES } from './engine'

const SUC_COLOR = { "La Granja": "#34C759", "Los Angeles": "#007AFF", "Maipu": "#FF9500" }

export function InvSucursales({ data, accent, isMobile }) {
  const { kSuc, an } = data
  const [sucSel, setSucSel] = useState("La Granja")
  const [filtro, setFiltro] = useState("Quiebre")

  const maxInv = Math.max(...SUCURSALES.map(s => kSuc[s].valorInventario))
  const maxVenta = Math.max(...SUCURSALES.map(s => kSuc[s].venta))

  // SKU de la sucursal seleccionada según filtro
  const skusSuc = useMemo(() => {
    let r = an.items.map(x => ({ ...x.porSuc[sucSel], sku: x.sku, producto: x.producto, clase: x.clase, tipo: x.tipo }))
    if (filtro === "Quiebre") r = r.filter(x => x.estado === "Quiebre")
    else if (filtro === "Dead stock") r = r.filter(x => x.estado === "Dead stock")
    else if (filtro === "ConStock") r = r.filter(x => x.stockUnid > 0)
    return r.sort((a, b) => b.netoVend - a.netoVend || b.stockValor - a.stockValor).slice(0, 60)
  }, [an, sucSel, filtro])

  return (
    <div>
      {/* Comparativa de sucursales */}
      <div style={{ display: isMobile ? "block" : "flex", gap: 12, marginBottom: 4 }}>
        {SUCURSALES.map(s => {
          const x = kSuc[s]
          return (
            <div key={s} onClick={() => setSucSel(s)} style={{ ...card, flex: 1, cursor: "pointer", borderLeft: "4px solid " + SUC_COLOR[s], borderColor: sucSel === s ? SUC_COLOR[s] : undefined, boxShadow: sucSel === s ? "0 3px 14px " + SUC_COLOR[s] + "44" : card.boxShadow }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: SUC_COLOR[s] }}>{s}</div>
                {sucSel === s && <span style={{ fontSize: 11, color: SUC_COLOR[s], fontWeight: 700 }}>● activa</span>}
              </div>
              <div style={{ fontSize: 11, color: "#8E8E93" }}>Venta período</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>{fmtMM(x.venta)}</div>
              <Bar value={x.venta} max={maxVenta} color={SUC_COLOR[s]} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 12 }}>
                <div><div style={{ color: "#8E8E93", fontSize: 10 }}>Inventario</div><b>{fmtMM(x.valorInventario)}</b></div>
                <div><div style={{ color: "#8E8E93", fontSize: 10 }}>Quiebre</div><b style={{ color: CL_ESTADO["Quiebre"] }}>{x.quiebre}</b></div>
                <div><div style={{ color: "#8E8E93", fontSize: 10 }}>Dead stock</div><b style={{ color: CL_ESTADO["Dead stock"] }}>{x.deadStock}</b></div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#8E8E93" }}>Tasa quiebre <b style={{ color: x.tasaQuiebre > 0.4 ? "#FF3B30" : "#FF9500" }}>{pct(x.tasaQuiebre)}</b> · {fN(x.skusConStock)} SKU c/stock</div>
            </div>
          )
        })}
      </div>

      {/* Nota Maipú */}
      {kSuc["Maipu"].venta < kSuc["La Granja"].venta * 0.1 && (
        <div style={{ ...card, background: "#FF950010", border: "1px solid #FF950040", fontSize: 13 }}>
          <b style={{ color: "#FF9500" }}>📍 Maipú en apertura:</b> concentra <b>{fmtMM(kSuc["Maipu"].valorInventario)}</b> de inventario (CD central) pero aún baja venta. Buena parte de ese stock es para redistribuir a las otras sucursales, no venta directa — interprétalo como centro de distribución, no como punto de venta maduro.
        </div>
      )}

      {/* Detalle sucursal */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <SectionTitle sub={"SKU de " + sucSel}>Detalle — {sucSel}</SectionTitle>
          <div style={{ display: "flex", gap: 6 }}>
            {[["Quiebre", "Quiebres"], ["Dead stock", "Dead stock"], ["ConStock", "Con stock"]].map(([k, l]) => (
              <button key={k} onClick={() => setFiltro(k)} style={{ padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: filtro === k ? accent : "#F2F2F7", color: filtro === k ? "#fff" : "#636366" }}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table>
            <thead><tr style={{ color: "#8E8E93", fontSize: 11, textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>Cls</th><th style={{ padding: "6px 8px" }}>SKU</th><th style={{ padding: "6px 8px" }}>Producto</th><th style={{ padding: "6px 8px" }}>Estado</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Stock</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Vendido</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Cobertura</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Venta $</th>
            </tr></thead>
            <tbody>
              {skusSuc.map(x => (
                <tr key={x.sku} style={{ borderTop: "1px solid #F7F7FA" }}>
                  <td style={{ padding: "7px 8px" }}><ClaseChip c={x.clase} /></td>
                  <td style={{ padding: "7px 8px", fontFamily: "monospace", fontSize: 11.5 }}>{x.sku}</td>
                  <td style={{ padding: "7px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={x.producto}>{x.producto}</td>
                  <td style={{ padding: "7px 8px" }}><EstadoChip e={x.estado === "OK" ? "Saludable" : x.estado} /></td>
                  <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(x.stockUnid)}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(x.qtyVend)}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", color: x.cobertura < 15 ? "#FF3B30" : "#1C1C1E" }}>{x.cobertura >= 999 ? "∞" : x.cobertura + "d"}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", color: "#636366" }}>{fmtMM(x.netoVend)}</td>
                </tr>
              ))}
              {skusSuc.length === 0 && <tr><td colSpan={8} style={{ padding: 16, textAlign: "center", color: "#8E8E93" }}>Sin SKU en esta vista</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
