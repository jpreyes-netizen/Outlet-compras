import { useMemo } from 'react'
import { fmt, fN, fmtMM, pct, KPI, card, CL_CLASE, CL_ESTADO, ClaseChip, EstadoChip, SectionTitle, Bar } from './ui'

export function InvDashboard({ data, accent, isMobile }) {
  const { k, an } = data

  const distClase = useMemo(() => {
    const d = { A: 0, B: 0, C: 0, D: 0 }
    const v = { A: 0, B: 0, C: 0, D: 0 }
    an.items.forEach(x => { d[x.clase]++; v[x.clase] += x.netoVend })
    return { d, v }
  }, [an])

  const distEstado = useMemo(() => {
    const e = {}
    an.items.forEach(x => { e[x.estado] = (e[x.estado] || 0) + 1 })
    return e
  }, [an])

  // top urgentes (quiebre clase A/B por venta)
  const topUrgentes = useMemo(() =>
    an.items.filter(x => x.estado === "Quiebre" && (x.clase === "A" || x.clase === "B"))
      .sort((a, b) => b.netoVend - a.netoVend).slice(0, 8), [an])

  const alertaCritica = k.quiebreClaseA / Math.max(1, k.skusClaseA) > 0.3

  return (
    <div>
      {/* KPIs principales */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <KPI label="Valor inventario" value={fmtMM(k.valorInventario)} sub={fN(k.skusConStock) + " SKU con stock"} icon="💰" isMobile={isMobile} />
        <KPI label="Venta período" value={fmtMM(k.ventaTotal)} sub={"margen " + pct(k.margenPctGlobal)} color={accent} icon="📈" isMobile={isMobile} />
        <KPI label="Rotación anual" value={k.rotValorizada + "x"} sub={k.diasInvProm + " días de inventario"} icon="🔄" isMobile={isMobile} />
        <KPI label="Tasa de quiebre" value={pct(k.tasaQuiebre)} sub={fN(k.quiebre) + " SKU sin stock"} color={k.tasaQuiebre > 0.4 ? "#FF3B30" : "#FF9500"} icon="⚠️" isMobile={isMobile} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <KPI label="En quiebre" value={fN(k.quiebre)} sub="vende, stock 0" color={CL_ESTADO["Quiebre"]} isMobile={isMobile} />
        <KPI label="Por reponer" value={fN(k.reposicion)} sub="bajo punto reorden" color={CL_ESTADO["Reposicion"]} isMobile={isMobile} />
        <KPI label="Dead stock" value={fmtMM(k.valorDeadStock)} sub={fN(k.deadStock) + " SKU inmovilizados"} color={CL_ESTADO["Dead stock"]} isMobile={isMobile} />
        <KPI label="Inversión repo." value={fmtMM(k.costoReposicion)} sub="para cerrar quiebres" color={accent} isMobile={isMobile} />
      </div>

      {/* Alerta */}
      {alertaCritica && (
        <div style={{ ...card, background: "#FF3B3010", border: "1px solid #FF3B3040", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span style={{ fontSize: 22 }}>🚨</span>
          <div>
            <div style={{ fontWeight: 800, color: "#FF3B30", fontSize: 14 }}>Alerta crítica de abastecimiento</div>
            <div style={{ fontSize: 13, color: "#3A3A3C", marginTop: 3 }}>
              {k.quiebreClaseA} de {k.skusClaseA} SKU clase A están en quiebre ({pct(k.quiebreClaseA / k.skusClaseA)}). La clase A concentra el 80% de las ventas — cada día de quiebre es venta perdida directa. Prioriza estas reposiciones.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: isMobile ? "block" : "flex", gap: 12 }}>
        {/* Distribución ABCD */}
        <div style={{ ...card, flex: 1 }}>
          <SectionTitle sub="Pareto por participación de ventas">Clasificación ABCD</SectionTitle>
          {["A", "B", "C", "D"].map(c => {
            const maxV = Math.max(...Object.values(distClase.v))
            return (
              <div key={c} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <ClaseChip c={c} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600 }}>{distClase.d[c]} SKU</span>
                    <span style={{ color: "#8E8E93" }}>{fmtMM(distClase.v[c])}</span>
                  </div>
                  <Bar value={distClase.v[c]} max={maxV} color={CL_CLASE[c]} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Estados */}
        <div style={{ ...card, flex: 1 }}>
          <SectionTitle sub="Distribución por estado de stock">Salud del inventario</SectionTitle>
          {Object.entries(distEstado).sort((a, b) => b[1] - a[1]).map(([e, n]) => {
            const maxN = Math.max(...Object.values(distEstado))
            return (
              <div key={e} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ width: 90, fontSize: 12 }}><EstadoChip e={e} /></span>
                <div style={{ flex: 1 }}><Bar value={n} max={maxN} color={CL_ESTADO[e]} /></div>
                <span style={{ width: 36, textAlign: "right", fontWeight: 700, fontSize: 13 }}>{n}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Top urgentes */}
      <div style={card}>
        <SectionTitle sub="Quiebres de clase A/B ordenados por venta perdida">🔥 Top urgentes — comprar ya</SectionTitle>
        {topUrgentes.length === 0 ? (
          <div style={{ fontSize: 13, color: "#34C759", padding: "8px 0" }}>✓ Sin quiebres en clases A/B. Buen estado.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr style={{ color: "#8E8E93", fontSize: 11, textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Cls</th><th style={{ padding: "6px 8px" }}>SKU</th><th style={{ padding: "6px 8px" }}>Producto</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Venta/día</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Reponer</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Venta período</th>
              </tr></thead>
              <tbody>
                {topUrgentes.map(x => (
                  <tr key={x.sku} style={{ borderTop: "1px solid #F2F2F7" }}>
                    <td style={{ padding: "7px 8px" }}><ClaseChip c={x.clase} /></td>
                    <td style={{ padding: "7px 8px", fontFamily: "monospace", fontSize: 12 }}>{x.sku}</td>
                    <td style={{ padding: "7px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{x.producto}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(x.vtaDia)}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, color: accent }}>{fN(x.reposicion)} u</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", color: "#8E8E93" }}>{fmtMM(x.netoVend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
