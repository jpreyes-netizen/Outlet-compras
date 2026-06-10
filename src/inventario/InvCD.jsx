import { useMemo } from 'react'
import { fN, fmtMM, pct, card, ClaseChip, SectionTitle, Lectura } from './ui'
import { metricasCD } from './engine'
import { InvTransferencias } from './InvTransferencias'

export function InvCD({ data, destinoFiltro, accent, isMobile, irA }) {
  // Siempre análisis global: el CD se mide contra la red completa
  const m = useMemo(() => metricasCD(data.an), [data.an])

  const descargarInmovilizado = () => {
    const filas = [["SKU", "Producto", "Tipo", "Clase", "Stock CD", "Valor"], ...m.inmovilizado.map(i => [i.sku, i.producto, i.tipo, i.clase, i.stock, Math.round(i.valor)])]
    const csv = filas.map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob); const a = document.createElement("a")
    a.href = url; a.download = `inmovilizado_CD_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  const fillColor = m.fillRate >= 0.7 ? "#34C759" : m.fillRate >= 0.4 ? "#FF9500" : "#FF3B30"
  const inmovColor = m.pctInmovilizado > 0.5 ? "#FF3B30" : m.pctInmovilizado > 0.25 ? "#FF9500" : "#34C759"

  return (
    <div>
      {/* Header CD */}
      <div style={{ ...card, background: "linear-gradient(135deg,#FF9500,#cc7700)", color: "#fff" }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>📦 Centro de Distribución — Maipú</div>
        <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.9)", marginTop: 3, lineHeight: 1.5, maxWidth: 620 }}>
          El CD no se mide como tienda: su trabajo es abastecer la red. Aquí se evalúa si su stock está sirviendo a La Granja y Los Ángeles, o solo acumulando polvo.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          <div style={{ flex: "1 1 140px", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "11px 13px" }}>
            <div style={{ fontSize: 21, fontWeight: 800 }}>{fmtMM(m.valorCD)}</div>
            <div style={{ fontSize: 11 }}>stock total ({fN(m.unidCD)} u · {fN(m.skusCD)} SKU)</div>
          </div>
          <div style={{ flex: "1 1 140px", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "11px 13px" }}>
            <div style={{ fontSize: 21, fontWeight: 800 }}>{m.coberturaRed >= 999 ? "∞" : m.coberturaRed + " días"}</div>
            <div style={{ fontSize: 11 }}>cobertura de red (cuánto sostiene la demanda de tiendas)</div>
          </div>
          <div style={{ flex: "1 1 140px", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "11px 13px" }}>
            <div style={{ fontSize: 21, fontWeight: 800 }}>{pct(m.fillRate)}</div>
            <div style={{ fontSize: 11 }}>fill rate (de lo que las tiendas necesitan hoy, el CD cubre esto)</div>
          </div>
          <div style={{ flex: "1 1 140px", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "11px 13px" }}>
            <div style={{ fontSize: 21, fontWeight: 800 }}>{fmtMM(m.valorInmovilizado)}</div>
            <div style={{ fontSize: 11 }}>inmovilizado — {pct(m.pctInmovilizado)} del CD sin demanda en la red</div>
          </div>
        </div>
      </div>

      {/* Lecturas */}
      <div style={card}>
        <SectionTitle>🔎 Lectura del CD</SectionTitle>
        <Lectura icon={m.fillRate >= 0.7 ? "✅" : "⚠️"} titulo="Capacidad de abastecimiento:" color={fillColor}>
          de las <b>{fN(m.unidNecesarias)}</b> unidades que las tiendas necesitan hoy, el CD puede despachar <b>{fN(m.unidCubribles)}</b> ({pct(m.fillRate)}).
          {m.fillRate < 0.7 ? " El resto hay que comprarlo — el CD no está stockeado en lo que la red demanda." : " Buen nivel: la mayoría de la necesidad se resuelve con transferencias internas."}
          {" "}El detalle está abajo en las transferencias sugeridas.
        </Lectura>
        <Lectura icon={m.pctInmovilizado > 0.25 ? "🧊" : "✅"} titulo="Capital acumulando polvo:" color={inmovColor}>
          <b>{fmtMM(m.valorInmovilizado)}</b> ({fN(m.nInmovilizado)} SKU, {pct(m.pctInmovilizado)} del valor del CD) está en productos que <b>ninguna sucursal vende</b>. Ese stock no va a salir solo: candidatos a liquidación central, devolución a proveedor o canal web.
        </Lectura>
        <Lectura icon="🔄" titulo="Rotación del CD:" color={accent}>
          el stock activo del CD ({fmtMM(m.valorActivo)}) cubre <b>{m.coberturaRed >= 999 ? "∞" : m.coberturaRed + " días"}</b> de la demanda conjunta de la red. {m.coberturaRed > 120 && m.coberturaRed < 999 ? "Está sobre-stockeado para el ritmo actual — frenar compras de lo que ya abunda." : m.coberturaRed < 30 ? "Cobertura corta: el CD necesita reabastecerse pronto para seguir surtiendo." : "Nivel razonable para operar la red."}
        </Lectura>
      </div>

      {/* Inmovilizado */}
      <div style={{ ...card, borderLeft: "4px solid " + inmovColor }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <SectionTitle sub="Stock del CD sin venta en ninguna sucursal — ordenado por capital">🧊 Acumulando polvo ({fN(m.nInmovilizado)})</SectionTitle>
          {m.nInmovilizado > 0 && <button onClick={descargarInmovilizado} style={{ padding: "8px 14px", borderRadius: 10, border: "1.5px solid " + inmovColor, background: "#fff", color: inmovColor, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>⬇ Descargar lista</button>}
        </div>
        {m.nInmovilizado === 0 ? (
          <div style={{ fontSize: 13, color: "#34C759", padding: "6px 0" }}>✓ Todo el stock del CD tiene demanda en la red.</div>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 6 }}>
            <table>
              <thead><tr style={{ color: "#8E8E93", fontSize: 11, textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Cls</th><th style={{ padding: "6px 8px" }}>Producto</th><th style={{ padding: "6px 8px" }}>Tipo</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Stock</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Capital parado</th>
              </tr></thead>
              <tbody>
                {m.inmovilizado.slice(0, 15).map(i => (
                  <tr key={i.sku} style={{ borderTop: "1px solid #F7F7FA" }}>
                    <td style={{ padding: "7px 8px" }}><ClaseChip c={i.clase} /></td>
                    <td style={{ padding: "7px 8px", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.producto}>
                      {i.producto}<div style={{ fontSize: 10, color: "#AEAEB2", fontFamily: "monospace" }}>{i.sku}</div>
                    </td>
                    <td style={{ padding: "7px 8px", fontSize: 11.5, color: "#636366" }}>{i.tipo}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(i.stock)}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, color: inmovColor }}>{fmtMM(i.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {m.nInmovilizado > 15 && <div style={{ fontSize: 11, color: "#AEAEB2", padding: "6px 8px" }}>… y {fN(m.nInmovilizado - 15)} más en el CSV.</div>}
          </div>
        )}
      </div>

      {/* Transferencias sugeridas — el trabajo activo del CD */}
      <SectionTitle sub="Lo que el CD debe despachar hoy según la necesidad de cada tienda">🚚 Despachos sugeridos</SectionTitle>
      <InvTransferencias data={data} destinoFiltro={destinoFiltro} accent={accent} isMobile={isMobile} />
    </div>
  )
}
