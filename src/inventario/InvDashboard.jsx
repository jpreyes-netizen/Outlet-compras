import { useMemo } from 'react'
import { fmt, fN, fmtMM, pct, KPI, card, CL_CLASE, CL_ESTADO, CL_VELOCIDAD, ClaseChip, EstadoChip, SectionTitle, Bar, Gauge, Lectura } from './ui'

export function InvDashboard({ data, accent, isMobile }) {
  const { k, an } = data

  const distClase = useMemo(() => {
    const d = { A: 0, B: 0, C: 0, D: 0 }, v = { A: 0, B: 0, C: 0, D: 0 }, mg = { A: 0, B: 0, C: 0, D: 0 }
    an.items.forEach(x => { d[x.clase]++; v[x.clase] += x.netoVend; mg[x.clase] += x.margenVend })
    return { d, v, mg }
  }, [an])

  const topUrgentes = useMemo(() =>
    an.items.filter(x => x.estado === "Quiebre" && (x.clase === "A" || x.clase === "B"))
      .sort((a, b) => b.margenVend - a.margenVend).slice(0, 8), [an])

  const BENCH = { gmroi: 2.0, rotacion: 3.0, sellThrough: 0.6, tasaQuiebre: 0.15 }
  const alertaCritica = k.quiebreClaseA / Math.max(1, k.skusClaseA) > 0.3
  const gmroiColor = k.gmroiGlobal >= 2 ? "#34C759" : k.gmroiGlobal >= 1 ? "#FF9500" : "#FF3B30"
  const rotColor   = k.rotValorizada >= 3 ? "#34C759" : k.rotValorizada >= 1.5 ? "#FF9500" : "#FF3B30"

  return (
    <div>
      {/* FILA 1: salud financiera */}
      <div style={card}>
        <SectionTitle sub="Indicadores que miden si el capital invertido en stock está rindiendo">💼 Salud financiera del inventario</SectionTitle>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <Gauge value={k.gmroiGlobal} max={3} label="GMROI" sub={"objetivo ≥" + BENCH.gmroi.toFixed(1)} color={gmroiColor} benchmark={BENCH.gmroi} fmt={v => v.toFixed(2)} isMobile={isMobile} />
          <Gauge value={k.rotValorizada} max={6} label="Rotación anual" sub={"objetivo ≥" + BENCH.rotacion + "x"} color={rotColor} benchmark={BENCH.rotacion} fmt={v => v.toFixed(1) + "x"} isMobile={isMobile} />
          <Gauge value={k.sellThroughGlobal * 100} max={100} label="Sell-through" sub="vendido / disponible" color={k.sellThroughGlobal >= 0.6 ? "#34C759" : "#FF9500"} benchmark={60} fmt={v => Math.round(v) + "%"} isMobile={isMobile} />
          <Gauge value={k.healthProm} max={100} label="Health score" sub="salud integral SKU" color={k.healthProm >= 70 ? "#34C759" : k.healthProm >= 50 ? "#FF9500" : "#FF3B30"} benchmark={70} fmt={v => Math.round(v)} isMobile={isMobile} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Lectura icon="💰" titulo="GMROI:" color={gmroiColor}>
            cada $1 invertido en inventario genera <b>${k.gmroiGlobal.toFixed(2)}</b> de margen bruto en el período. {k.gmroiGlobal >= 2
              ? "Está sobre el umbral saludable de bienes durables — el capital trabaja bien."
              : k.gmroiGlobal >= 1
                ? "Está bajo el objetivo de 2.0: el inventario rinde, pero hay capital sub-utilizado. Foco en reducir dead stock y mejorar margen de clase A."
                : "Está críticamente bajo: demasiado capital inmovilizado frente al margen que genera. Prioridad #1 liberar dead stock y sobre-stock."}
          </Lectura>
          <Lectura icon="🔄" titulo="Rotación:" color={rotColor}>
            el inventario se renueva <b>{k.rotValorizada.toFixed(1)} veces al año</b> ({k.diasInvProm} días para vender el stock completo). {k.rotValorizada >= 3
              ? "Buen ritmo para productos durables."
              : "Para bienes durables de especialidad lo esperable es 2-4x. " + (k.diasInvProm > 120 ? "Con " + k.diasInvProm + " días de inventario hay capital tardando demasiado en convertirse en venta." : "")}
          </Lectura>
          <Lectura icon="📦" titulo="Concentración Pareto:" color={accent}>
            el <b>{pct(k.pctSkuA)}</b> de los SKU (clase A) concentra el <b>{pct(k.concentracionA)}</b> de la venta por monto ({fmtMM(k.ventaClaseA)}). Estos productos nunca pueden quebrar — cada quiebre acá es venta de alto valor perdida.
          </Lectura>
        </div>
      </div>

      {/* FILA 2: KPIs operativos */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <KPI label="Valor inventario" value={fmtMM(k.valorInventario)} sub={fN(k.skusConStock) + " SKU con stock"} icon="📦" isMobile={isMobile} />
        <KPI label="Venta período" value={fmtMM(k.ventaTotal)} sub={"margen " + pct(k.margenPctGlobal) + " · " + fmtMM(k.margenTotal)} color={accent} icon="📈" isMobile={isMobile} />
        <KPI label="Tasa de quiebre" value={pct(k.tasaQuiebre)} sub={fN(k.quiebre) + " SKU sin stock"} color={k.tasaQuiebre > BENCH.tasaQuiebre ? "#FF3B30" : "#34C759"} icon="⚠️" isMobile={isMobile} />
        <KPI label="Capital en riesgo" value={fmtMM(k.capitalRiesgo)} sub={fN(k.deadStock) + " dead + " + fN(k.sobreStock) + " sobre-stock"} color="#AF52DE" icon="🔒" isMobile={isMobile} />
      </div>

      {alertaCritica && (
        <div style={{ ...card, background: "#FF3B3010", border: "1px solid #FF3B3040", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span style={{ fontSize: 22 }}>🚨</span>
          <div>
            <div style={{ fontWeight: 800, color: "#FF3B30", fontSize: 14 }}>Alerta crítica de abastecimiento</div>
            <div style={{ fontSize: 13, color: "#3A3A3C", marginTop: 3 }}>
              <b>{k.quiebreClaseA} de {k.skusClaseA}</b> SKU clase A en quiebre ({pct(k.quiebreClaseA / k.skusClaseA)}). La clase A concentra {pct(k.concentracionA)} de la venta — estás perdiendo venta de tus productos más valiosos. Resuélvelo en el tab Decisión.
            </div>
          </div>
        </div>
      )}

      {/* FILA 3: Pareto + Velocidad */}
      <div style={{ display: isMobile ? "block" : "flex", gap: 12 }}>
        <div style={{ ...card, flex: 1.3 }}>
          <SectionTitle sub="Por monto de venta (Pareto) — y el margen que aporta cada clase">Clasificación ABCD</SectionTitle>
          {["A", "B", "C", "D"].map(c => {
            const maxV = Math.max(...Object.values(distClase.v))
            const mgPct = distClase.v[c] > 0 ? distClase.mg[c] / distClase.v[c] : 0
            return (
              <div key={c} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 11 }}>
                <ClaseChip c={c} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600 }}>{distClase.d[c]} SKU · margen {pct(mgPct)}</span>
                    <span style={{ color: "#8E8E93" }}>{fmtMM(distClase.v[c])}</span>
                  </div>
                  <Bar value={distClase.v[c]} max={maxV} color={CL_CLASE[c]} />
                </div>
              </div>
            )
          })}
          <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 6, lineHeight: 1.5 }}>
            A = hasta 80% de venta acumulada · B = 80-95% · C = 95-99% · D = cola + sin venta. El margen % muestra cuán rentable es cada segmento.
          </div>
        </div>

        <div style={{ ...card, flex: 1 }}>
          <SectionTitle sub="Cuán rápido rota cada SKU (días de inventario)">Velocidad de rotación</SectionTitle>
          {["Fast mover", "Medium mover", "Slow mover", "Very slow", "Sin movimiento"].map(vk => {
            const n = k.velocidad[vk] || 0
            const maxN = Math.max(...Object.values(k.velocidad))
            const desc = { "Fast mover": "<30d", "Medium mover": "30-90d", "Slow mover": "90-180d", "Very slow": ">180d", "Sin movimiento": "sin venta" }[vk]
            return (
              <div key={vk} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: CL_VELOCIDAD[vk], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600 }}>{vk}</span><span style={{ color: "#8E8E93", fontSize: 11 }}>{desc}</span>
                  </div>
                  <Bar value={n} max={maxN} color={CL_VELOCIDAD[vk]} h={6} />
                </div>
                <span style={{ width: 30, textAlign: "right", fontWeight: 700, fontSize: 13 }}>{n}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* FILA 4: Top urgentes */}
      <div style={card}>
        <SectionTitle sub="Quiebres de clase A/B ordenados por margen mensual perdido">🔥 Top urgentes — pérdida de margen activa</SectionTitle>
        {topUrgentes.length === 0 ? (
          <div style={{ fontSize: 13, color: "#34C759", padding: "8px 0" }}>✓ Sin quiebres en clases A/B. El abastecimiento de tus productos clave está sano.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr style={{ color: "#8E8E93", fontSize: 11, textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Cls</th><th style={{ padding: "6px 8px" }}>Producto</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Vta/día</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Margen %</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Reponer</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Margen/mes perdido</th>
              </tr></thead>
              <tbody>
                {topUrgentes.map(x => {
                  const margenMes = x.margenVend / an.dias * 30
                  return (
                    <tr key={x.sku} style={{ borderTop: "1px solid #F2F2F7" }}>
                      <td style={{ padding: "7px 8px" }}><ClaseChip c={x.clase} /></td>
                      <td style={{ padding: "7px 8px", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }} title={x.producto}>
                        {x.producto}<div style={{ fontSize: 10, color: "#AEAEB2", fontFamily: "monospace" }}>{x.sku}</div>
                      </td>
                      <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(x.vtaDia)}</td>
                      <td style={{ padding: "7px 8px", textAlign: "right", color: x.margenPct >= 0.3 ? "#34C759" : "#FF9500" }}>{pct(x.margenPct)}</td>
                      <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, color: accent }}>{fN(x.reposicion)} u</td>
                      <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, color: "#FF3B30" }}>{fmtMM(margenMes)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
