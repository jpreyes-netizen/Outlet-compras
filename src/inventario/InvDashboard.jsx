import { useMemo } from 'react'
import { fmt, fN, fmtMM, pct, KPI, card, CL_CLASE, CL_ESTADO, CL_VELOCIDAD, ClaseChip, EstadoChip, SectionTitle, Bar, Gauge, Lectura, MetricaExplicada, Semaforo } from './ui'

export function InvDashboard({ data, accent, isMobile }) {
  const { k, an } = data
  const filtro = an.sucursalFiltro || "todas las sucursales"
  const esFiltrado = !!an.sucursalFiltro

  const distClase = useMemo(() => {
    const d = { A: 0, B: 0, C: 0, D: 0 }, v = { A: 0, B: 0, C: 0, D: 0 }, mg = { A: 0, B: 0, C: 0, D: 0 }
    an.items.forEach(x => { d[x.clase]++; v[x.clase] += x.netoVend; mg[x.clase] += x.margenVend })
    return { d, v, mg }
  }, [an])

  const topUrgentes = useMemo(() =>
    an.items.filter(x => x.estado === "Quiebre" && (x.clase === "A" || x.clase === "B"))
      .sort((a, b) => b.margenVend - a.margenVend).slice(0, 8), [an])

  // Métricas accionables para jefe de tienda
  const quiebresA = an.items.filter(x => x.estado === "Quiebre" && x.clase === "A")
  const margenPerdidoMes = quiebresA.reduce((s, x) => s + x.margenVend, 0) / an.dias * 30
  const reponerUnidades = topUrgentes.reduce((s, x) => s + x.reposicion, 0)

  const BENCH = { gmroi: 2.0, rotacion: 3.0 }
  const gmroiColor = k.gmroiGlobal >= 2 ? "#34C759" : k.gmroiGlobal >= 1 ? "#FF9500" : "#FF3B30"
  const rotColor   = k.rotValorizada >= 3 ? "#34C759" : k.rotValorizada >= 1.5 ? "#FF9500" : "#FF3B30"
  const quiebreColor = k.tasaQuiebre > 0.3 ? "#FF3B30" : k.tasaQuiebre > 0.15 ? "#FF9500" : "#34C759"

  return (
    <div>
      {/* ═══ RESUMEN PARA JEFE DE TIENDA — lenguaje de acción ═══ */}
      <div style={{ ...card, background: "linear-gradient(135deg,#1a1a2e,#16213e)", color: "#fff" }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 3 }}>📋 Resumen — {filtro}</div>
        <div style={{ fontSize: 12.5, color: "#c7c7d9", marginBottom: 14, lineHeight: 1.5 }}>
          Lo que necesitas saber hoy, sin tecnicismos. {esFiltrado ? "Vista de tu sucursal." : "Vista consolidada de todas las sucursales."}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <div style={{ flex: "1 1 200px", background: "rgba(255,59,48,0.15)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(255,59,48,0.3)" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#FF453A" }}>{quiebresA.length}</div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>productos estrella sin stock</div>
            <div style={{ fontSize: 11, color: "#ff9a93", marginTop: 3 }}>Son tus más vendidos y están agotados. Estás perdiendo ~{fmtMM(margenPerdidoMes)}/mes de ganancia.</div>
          </div>
          <div style={{ flex: "1 1 200px", background: "rgba(255,149,0,0.15)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(255,149,0,0.3)" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#FF9500" }}>{fN(k.deadStock)}</div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>productos parados</div>
            <div style={{ fontSize: 11, color: "#ffd9a0", marginTop: 3 }}>Tienen stock pero no se venden. Hay {fmtMM(k.valorDeadStock)} en mercadería detenida.</div>
          </div>
          <div style={{ flex: "1 1 200px", background: "rgba(52,199,89,0.15)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(52,199,89,0.3)" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#34C759" }}>{fmtMM(k.ventaTotal)}</div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>venta del período</div>
            <div style={{ fontSize: 11, color: "#9ae6b4", marginTop: 3 }}>{an.meses.length} meses · ganancia {fmtMM(k.margenTotal)} (margen {pct(k.margenPctGlobal)}).</div>
          </div>
        </div>
        {quiebresA.length > 0 && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(255,255,255,0.08)", borderRadius: 10, fontSize: 13 }}>
            <b>🎯 Tu acción #1 hoy:</b> repón los {topUrgentes.length} productos estrella agotados (~{fN(reponerUnidades)} unidades). Míralos en el tab <b>Decisión</b>.
          </div>
        )}
      </div>

      {/* ═══ 3 PREGUNTAS CLAVE explicadas en lenguaje llano ═══ */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <MetricaExplicada
          icon="💰" titulo="¿El inventario genera ganancia?" valor={k.gmroiGlobal.toFixed(2)} color={gmroiColor}
          queEs={`Por cada $1 invertido en mercadería, ganas $${k.gmroiGlobal.toFixed(2)} de margen. (Esto se llama GMROI; lo sano es 2 o más.)`}
          queHacer={k.gmroiGlobal < 1 ? "Está bajo. Liquida lo que no rota y reponé lo que sí vende." : k.gmroiGlobal < 2 ? "Mejorable. Reduce productos parados." : "Vas bien, el capital rinde."}
          isMobile={isMobile} />
        <MetricaExplicada
          icon="🔄" titulo="¿Qué tan rápido vendes el stock?" valor={k.diasInvProm + " días"} color={rotColor}
          queEs={`Tardas ${k.diasInvProm} días en vender todo el stock actual al ritmo de venta. (Rotación ${k.rotValorizada.toFixed(1)} veces/año.)`}
          queHacer={k.diasInvProm > 120 ? "Es lento. Hay capital atrapado mucho tiempo." : "Ritmo razonable para productos durables."}
          isMobile={isMobile} />
        <MetricaExplicada
          icon="⚠️" titulo="¿Cuánto te falta en góndola?" valor={pct(k.tasaQuiebre)} color={quiebreColor}
          queEs={`${pct(k.tasaQuiebre)} de los productos que se venden hoy están sin stock (${fN(k.quiebre)} productos).`}
          queHacer={k.tasaQuiebre > 0.3 ? "Muy alto. Cada producto agotado es una venta que se va a la competencia." : "Bajo control."}
          isMobile={isMobile} />
      </div>

      {/* Pareto en lenguaje simple */}
      <div style={card}>
        <SectionTitle sub="Tus productos no valen lo mismo: unos pocos generan casi toda la venta">¿Cuáles son tus productos clave?</SectionTitle>
        <div style={{ fontSize: 13, color: "#3A3A3C", lineHeight: 1.6, marginBottom: 12 }}>
          El <b style={{ color: CL_CLASE.A }}>{pct(k.pctSkuA)}</b> de tus productos (los <b>clase A</b>) genera el <b>{pct(k.concentracionA)}</b> de toda la venta ({fmtMM(k.ventaClaseA)}). Estos son intocables: <b>nunca pueden faltar</b>. Los clase C y D casi no mueven la aguja.
        </div>
        {["A", "B", "C", "D"].map(c => {
          const maxV = Math.max(...Object.values(distClase.v))
          const etiq = { A: "Clave (no pueden faltar)", B: "Importantes", C: "Secundarios", D: "Cola larga / revisar" }[c]
          return (
            <div key={c} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 11 }}>
              <ClaseChip c={c} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600 }}>{etiq} · {distClase.d[c]} productos</span>
                  <span style={{ color: "#8E8E93" }}>{fmtMM(distClase.v[c])}</span>
                </div>
                <Bar value={distClase.v[c]} max={maxV} color={CL_CLASE[c]} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Top urgentes — lo más accionable */}
      <div style={card}>
        <SectionTitle sub="Tus productos más rentables que están agotados — repón estos primero">🔥 Lo que urge reponer</SectionTitle>
        {topUrgentes.length === 0 ? (
          <div style={{ fontSize: 13, color: "#34C759", padding: "8px 0" }}>✓ Ningún producto estrella está agotado. Tu góndola está bien abastecida.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr style={{ color: "#8E8E93", fontSize: 11, textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Cls</th><th style={{ padding: "6px 8px" }}>Producto</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Vendía/día</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Reponer</th><th style={{ padding: "6px 8px", textAlign: "right" }}>Ganancia perdida/mes</th>
              </tr></thead>
              <tbody>
                {topUrgentes.map(x => {
                  const margenMes = x.margenVend / an.dias * 30
                  return (
                    <tr key={x.sku} style={{ borderTop: "1px solid #F2F2F7" }}>
                      <td style={{ padding: "7px 8px" }}><ClaseChip c={x.clase} /></td>
                      <td style={{ padding: "7px 8px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }} title={x.producto}>
                        {x.producto}<div style={{ fontSize: 10, color: "#AEAEB2", fontFamily: "monospace" }}>{x.sku}</div>
                      </td>
                      <td style={{ padding: "7px 8px", textAlign: "right" }}>{x.vtaDia >= 1 ? fN(x.vtaDia) : x.vtaDia.toFixed(1)} u</td>
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

      {/* Detalle técnico colapsable para quien quiera más */}
      <details style={{ ...card, cursor: "pointer" }}>
        <summary style={{ fontSize: 13, fontWeight: 700, color: "#636366", outline: "none" }}>📊 Ver indicadores técnicos detallados</summary>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 14 }}>
          <Gauge value={k.gmroiGlobal} max={3} label="GMROI" sub={"objetivo ≥" + BENCH.gmroi.toFixed(1)} color={gmroiColor} benchmark={BENCH.gmroi} fmt={v => v.toFixed(2)} isMobile={isMobile} />
          <Gauge value={k.rotValorizada} max={6} label="Rotación anual" sub={"objetivo ≥" + BENCH.rotacion + "x"} color={rotColor} benchmark={BENCH.rotacion} fmt={v => v.toFixed(1) + "x"} isMobile={isMobile} />
          <Gauge value={k.sellThroughGlobal * 100} max={100} label="Sell-through" sub="vendido / disponible" color={k.sellThroughGlobal >= 0.6 ? "#34C759" : "#FF9500"} benchmark={60} fmt={v => Math.round(v) + "%"} isMobile={isMobile} />
          <Gauge value={k.healthProm} max={100} label="Health score" sub="salud integral SKU" color={k.healthProm >= 70 ? "#34C759" : k.healthProm >= 50 ? "#FF9500" : "#FF3B30"} benchmark={70} fmt={v => Math.round(v)} isMobile={isMobile} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          <KPI label="Valor inventario" value={fmtMM(k.valorInventario)} sub={fN(k.skusConStock) + " SKU con stock"} isMobile={isMobile} />
          <KPI label="Capital en riesgo" value={fmtMM(k.capitalRiesgo)} sub={fN(k.deadStock) + " dead + " + fN(k.sobreStock) + " sobre-stock"} color="#AF52DE" isMobile={isMobile} />
          <KPI label="Costo reposición" value={fmtMM(k.costoReposicion)} sub="cerrar quiebres" color={accent} isMobile={isMobile} />
        </div>
      </details>
    </div>
  )
}
