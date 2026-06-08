import { useMemo } from 'react'
import { fN, fmtMM, fmt, card, ClaseChip, SectionTitle, Lectura } from './ui'
import { transferenciasCD } from './engine'

const SUC_COLOR = { "La Granja": "#34C759", "Los Angeles": "#007AFF" }

export function InvTransferencias({ data, accent, isMobile }) {
  // Siempre usa el análisis GLOBAL (necesita ver las 3 sucursales)
  const cd = useMemo(() => transferenciasCD(data.an), [data.an])
  const { transferencias, resumen, porDestino } = cd

  const descargarCSV = () => {
    const filas = [
      ["SKU", "Producto", "Tipo", "Clase", "Destino", "Estado destino", "Stock destino", "Punto reorden", "Venta/día", "Transferir (u)", "Valor transferencia"],
      ...transferencias.map(t => [
        t.sku, t.producto, t.tipo, t.clase, t.destino, t.estadoDestino,
        t.stockDestino, t.puntoReordenDestino, t.ventaDiaDestino, t.transferir, Math.round(t.valorTransfer)
      ])
    ]
    const csv = filas.map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `transferencias_CD_maipu_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const imprimir = () => window.print()

  if (transferencias.length === 0) {
    return (
      <div style={{ ...card, textAlign: "center", padding: "40px 20px" }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>✓</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#34C759", marginBottom: 6 }}>Sin transferencias necesarias</div>
        <div style={{ fontSize: 13, color: "#8E8E93", lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
          Ninguna sucursal necesita un producto que Maipú tenga en stock para ceder. Puede ser porque las sucursales están bien abastecidas, o porque los productos que faltan tampoco están en el CD (hay que comprarlos).
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Encabezado del informe */}
      <div style={{ ...card, background: "linear-gradient(135deg,#FF9500,#cc7700)", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 3 }}>🚚 Transferencias desde Maipú (CD)</div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.9)", lineHeight: 1.5, maxWidth: 560 }}>
              Productos que La Granja o Los Ángeles necesitan (quiebre o bajo punto de reorden) y que Maipú tiene en stock. Transferir desde el CD evita comprar y resuelve el faltante de inmediato.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={descargarCSV} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: "#fff", color: "#cc7700", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>⬇ Descargar CSV</button>
            <button onClick={imprimir} style={{ padding: "9px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.15)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>🖨 Imprimir</button>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          <div style={{ flex: "1 1 130px", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{resumen.total}</div>
            <div style={{ fontSize: 11 }}>transferencias sugeridas</div>
          </div>
          <div style={{ flex: "1 1 130px", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{fN(resumen.unidadesTotal)}</div>
            <div style={{ fontSize: 11 }}>unidades a mover</div>
          </div>
          <div style={{ flex: "1 1 130px", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{resumen.quiebresResueltos}</div>
            <div style={{ fontSize: 11 }}>quiebres que resuelve</div>
          </div>
          <div style={{ flex: "1 1 130px", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtMM(resumen.margenProtegidoTotal)}</div>
            <div style={{ fontSize: 11 }}>margen/mes protegido</div>
          </div>
        </div>
      </div>

      {/* Resumen por destino */}
      <div style={{ display: isMobile ? "block" : "flex", gap: 12 }}>
        {Object.entries(porDestino).filter(([, v]) => v.items > 0).map(([dest, v]) => (
          <div key={dest} style={{ ...card, flex: 1, borderLeft: "4px solid " + (SUC_COLOR[dest] || "#8E8E93") }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: SUC_COLOR[dest] || "#1C1C1E", marginBottom: 8 }}>🏬 {dest}</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span style={{ color: "#8E8E93" }}>Productos a recibir</span><b>{v.items}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span style={{ color: "#8E8E93" }}>Unidades</span><b>{fN(v.unidades)}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span style={{ color: "#8E8E93" }}>Valor mercadería</span><b>{fmtMM(v.valor)}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}><span style={{ color: "#8E8E93" }}>Quiebres a resolver</span><b style={{ color: v.quiebres > 0 ? "#FF3B30" : "#34C759" }}>{v.quiebres}</b></div>
          </div>
        ))}
      </div>

      {/* Tabla detallada */}
      <div style={card}>
        <SectionTitle sub={transferencias.length + " líneas de transferencia · clase A primero, luego por margen protegido"}>Detalle de transferencias</SectionTitle>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr style={{ color: "#8E8E93", fontSize: 11, textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>Cls</th>
              <th style={{ padding: "6px 8px" }}>Producto</th>
              <th style={{ padding: "6px 8px" }}>Destino</th>
              <th style={{ padding: "6px 8px" }}>Situación</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Stock dest.</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>En Maipú</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Transferir</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Valor</th>
            </tr></thead>
            <tbody>
              {transferencias.map((t, i) => (
                <tr key={t.sku + t.destino + i} style={{ borderTop: "1px solid #F7F7FA" }}>
                  <td style={{ padding: "7px 8px" }}><ClaseChip c={t.clase} /></td>
                  <td style={{ padding: "7px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.producto}>
                    {t.producto}<div style={{ fontSize: 10, color: "#AEAEB2", fontFamily: "monospace" }}>{t.sku} · {t.tipo}</div>
                  </td>
                  <td style={{ padding: "7px 8px" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: SUC_COLOR[t.destino] || "#1C1C1E" }}>{t.destino}</span>
                  </td>
                  <td style={{ padding: "7px 8px" }}>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, color: t.estadoDestino === "Quiebre" ? "#FF3B30" : "#FF9500", background: t.estadoDestino === "Quiebre" ? "#FF3B3015" : "#FF950015" }}>{t.estadoDestino}</span>
                  </td>
                  <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(t.stockDestino)}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", color: "#8E8E93" }}>{fN(t.stockCD)}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 800, color: accent }}>{fN(t.transferir)} u</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", color: "#636366" }}>{fmtMM(t.valorTransfer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11, color: "#AEAEB2", textAlign: "center", padding: "4px 0 8px", lineHeight: 1.6 }}>
        La cantidad sugerida lleva a cada sucursal hasta su punto de reorden. Maipú reserva su propio punto de reorden antes de ceder. Cuando un mismo producto lo necesitan dos sucursales, se reparte según stock disponible en el CD, priorizando clase A.
      </div>
    </div>
  )
}
