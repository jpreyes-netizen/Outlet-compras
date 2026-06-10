import { useMemo, useState, useEffect } from 'react'
import { fN, fmtMM, fmt, pct, card, ClaseChip, SectionTitle, Lectura } from './ui'
import { planTienda, simuladorTienda, SUCURSALES } from './engine'

const SUC_COLOR = { "La Granja": "#34C759", "Los Angeles": "#007AFF", "Maipu": "#FF9500" }
const RETAIL = ["La Granja", "Los Angeles"]

export function InvMiTienda({ data, sucursal, accent, isMobile, onPickSucursal }) {
  // data es el análisis GLOBAL (necesita ver Maipú). sucursal = local del jefe.
  const plan = useMemo(() => sucursal && RETAIL.includes(sucursal) ? planTienda(data.an, sucursal) : null, [data.an, sucursal])

  // ── Parámetros del simulador (persistidos por sucursal) ──
  const keyParams = "inv_sim_" + (sucursal || "")
  const [simParams, setSimParams] = useState(() => {
    try { const s = localStorage.getItem(keyParams); if (s) return JSON.parse(s) } catch {}
    return { crecimiento: 0, leadTime: null, cobertura: null, seguridad: 1.0 }
  })
  useEffect(() => {
    try { const s = localStorage.getItem(keyParams); setSimParams(s ? JSON.parse(s) : { crecimiento: 0, leadTime: null, cobertura: null, seguridad: 1.0 }) } catch {}
  }, [sucursal])
  useEffect(() => { try { localStorage.setItem(keyParams, JSON.stringify(simParams)) } catch {} }, [simParams, keyParams])

  const sim = useMemo(() => sucursal && RETAIL.includes(sucursal) ? simuladorTienda(data.an, sucursal, simParams) : null, [data.an, sucursal, simParams])

  // Resumen rápido por sucursal para el caso "Todas" o sin selección
  const resumenSucs = useMemo(() => {
    return RETAIL.map(s => {
      const p = planTienda(data.an, s)
      return { s, ...p.resumen }
    })
  }, [data.an])

  // Sin sucursal de venta seleccionada → pantalla de selección
  if (!plan) {
    return (
      <div>
        <div style={{ ...card, textAlign: "center", padding: "30px 20px" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🏬</div>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Centro de mando por sucursal</div>
          <div style={{ fontSize: 13, color: "#8E8E93", lineHeight: 1.6, maxWidth: 480, margin: "0 auto 6px" }}>
            {sucursal === "Maipu"
              ? "Maipú es el centro de distribución, no un punto de venta. Para ver qué despachar, usa el tab Transferencias CD."
              : "Selecciona tu sucursal para ver qué pedir a Maipú, qué solicitar comprar y qué liquidar."}
          </div>
        </div>
        <div style={{ display: isMobile ? "block" : "flex", gap: 12 }}>
          {resumenSucs.map(r => (
            <div key={r.s} onClick={() => onPickSucursal?.(r.s)} style={{ ...card, flex: 1, cursor: "pointer", borderTop: "3px solid " + SUC_COLOR[r.s] }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: SUC_COLOR[r.s], marginBottom: 10 }}>🏬 {r.s}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid #F2F2F7" }}>
                <span>🚚 Pedir a Maipú</span><b style={{ color: "#FF9500" }}>{r.nPedir}</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid #F2F2F7" }}>
                <span>🛒 Solicitar compra</span><b style={{ color: "#FF3B30" }}>{r.nComprar}</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0" }}>
                <span>🏷️ Liquidar</span><b style={{ color: "#AF52DE" }}>{r.nLiquidar}</b>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: accent, fontWeight: 600 }}>Ver detalle →</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const { pedirAMaipu, solicitarCompra, liquidar, porTipo, resumen } = plan
  const color = SUC_COLOR[sucursal]

  // Veredicto narrativo: qué tipos fallan, qué tipos sobran
  const tiposFalla = porTipo.filter(t => t.veredicto === "Falta stock").slice(0, 3)
  const tiposExceso = porTipo.filter(t => t.veredicto === "Exceso / liquidar").slice(0, 3)

  const descargar = () => {
    const filas = [["ACCIÓN", "SKU", "Producto", "Tipo", "Clase", "Estado", "Stock actual", "Cantidad", "Stock Maipú", "Detalle"]]
    pedirAMaipu.forEach(t => filas.push(["PEDIR A MAIPU", t.sku, t.producto, t.tipo, t.clase, t.estado, t.stockActual, t.transferir, t.stockCD, "Transferir desde CD"]))
    solicitarCompra.forEach(t => filas.push(["COMPRAR", t.sku, t.producto, t.tipo, t.clase, t.estado, t.stockActual, t.comprar, t.stockCD, t.motivo]))
    liquidar.forEach(t => filas.push(["LIQUIDAR", t.sku, t.producto, t.tipo, t.clase, "Exceso", t.stockActual, "", "", t.motivo]))
    const csv = filas.map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `plan_${sucursal.replace(/\s/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div>
      {/* Encabezado + veredicto */}
      <div style={{ ...card, background: "linear-gradient(135deg," + color + "," + color + "bb)", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>🏬 Centro de mando — {sucursal}</div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.9)", marginTop: 2 }}>Qué hacer hoy con tu inventario, en orden de prioridad.</div>
          </div>
          <button onClick={descargar} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: "#fff", color: color, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>⬇ Descargar plan</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          <div style={{ flex: "1 1 150px", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "11px 13px" }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{resumen.nPedir}</div>
            <div style={{ fontSize: 11.5 }}>🚚 pedir a Maipú ({fN(resumen.unidadesPedir)} u)</div>
          </div>
          <div style={{ flex: "1 1 150px", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "11px 13px" }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{resumen.nComprar}</div>
            <div style={{ fontSize: 11.5 }}>🛒 comprar ({fmtMM(resumen.inversionCompra)})</div>
          </div>
          <div style={{ flex: "1 1 150px", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "11px 13px" }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{resumen.nLiquidar}</div>
            <div style={{ fontSize: 11.5 }}>🏷️ liquidar ({fmtMM(resumen.capitalLiquidar)})</div>
          </div>
          <div style={{ flex: "1 1 150px", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "11px 13px" }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtMM(resumen.margenProtegido)}</div>
            <div style={{ fontSize: 11.5 }}>💰 margen/mes en juego</div>
          </div>
        </div>
        {(tiposFalla.length > 0 || tiposExceso.length > 0) && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 13, lineHeight: 1.6 }}>
            {tiposFalla.length > 0 && <div>⚠️ <b>Te falta stock en:</b> {tiposFalla.map(t => t.tipo).join(", ")}.</div>}
            {tiposExceso.length > 0 && <div>📦 <b>Te sobra en:</b> {tiposExceso.map(t => `${t.tipo} (${fmtMM(t.valorExceso)})`).join(", ")}.</div>}
          </div>
        )}
      </div>

      {/* ─── ACCIÓN 1: PEDIR A MAIPÚ ─── */}
      <div style={{ ...card, borderLeft: "4px solid #FF9500" }}>
        <SectionTitle sub="Maipú tiene stock — pídelo, no esperes a comprar">🚚 Pedir a Maipú ahora ({pedirAMaipu.length})</SectionTitle>
        {pedirAMaipu.length === 0 ? (
          <div style={{ fontSize: 13, color: "#8E8E93", padding: "6px 0" }}>Nada por pedir a Maipú en este momento.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr style={{ color: "#8E8E93", fontSize: 11, textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Cls</th><th style={{ padding: "6px 8px" }}>Producto</th>
                <th style={{ padding: "6px 8px" }}>Situación</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Tu stock</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Pedir</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>En Maipú</th>
              </tr></thead>
              <tbody>
                {pedirAMaipu.map((t, i) => (
                  <tr key={t.sku + i} style={{ borderTop: "1px solid #F7F7FA" }}>
                    <td style={{ padding: "7px 8px" }}><ClaseChip c={t.clase} /></td>
                    <td style={{ padding: "7px 8px", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.producto}>
                      {t.producto}<div style={{ fontSize: 10, color: "#AEAEB2", fontFamily: "monospace" }}>{t.sku} · {t.tipo}</div>
                    </td>
                    <td style={{ padding: "7px 8px" }}><EstadoPill estado={t.estado} /></td>
                    <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(t.stockActual)}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 800, color: "#FF9500" }}>{fN(t.transferir)} u</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", color: "#8E8E93" }}>{fN(t.stockCD)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── ACCIÓN 2: SOLICITAR COMPRA ─── */}
      <div style={{ ...card, borderLeft: "4px solid #FF3B30" }}>
        <SectionTitle sub="Maipú no puede surtir — insiste en que se compre">🛒 Solicitar compra ({solicitarCompra.length})</SectionTitle>
        {solicitarCompra.length === 0 ? (
          <div style={{ fontSize: 13, color: "#34C759", padding: "6px 0" }}>✓ Todo lo que necesitas lo puede surtir Maipú. No hay que comprar nada urgente.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr style={{ color: "#8E8E93", fontSize: 11, textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Cls</th><th style={{ padding: "6px 8px" }}>Producto</th>
                <th style={{ padding: "6px 8px" }}>Por qué comprar</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Tu stock</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Comprar</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Margen/mes</th>
              </tr></thead>
              <tbody>
                {solicitarCompra.map((t, i) => (
                  <tr key={t.sku + i} style={{ borderTop: "1px solid #F7F7FA" }}>
                    <td style={{ padding: "7px 8px" }}><ClaseChip c={t.clase} /></td>
                    <td style={{ padding: "7px 8px", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.producto}>
                      {t.producto}<div style={{ fontSize: 10, color: "#AEAEB2", fontFamily: "monospace" }}>{t.sku} · {t.tipo}</div>
                    </td>
                    <td style={{ padding: "7px 8px", fontSize: 11.5, color: "#636366" }}>{t.motivo}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(t.stockActual)}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 800, color: "#FF3B30" }}>{fN(t.comprar)} u</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", color: "#636366" }}>{fmtMM(t.margenMes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── ACCIÓN 3: LIQUIDAR ─── */}
      <div style={{ ...card, borderLeft: "4px solid #AF52DE" }}>
        <SectionTitle sub="Stock parado o con sobre-cobertura — planifica liquidación o promoción">🏷️ Liquidar / promocionar ({liquidar.length})</SectionTitle>
        {liquidar.length === 0 ? (
          <div style={{ fontSize: 13, color: "#34C759", padding: "6px 0" }}>✓ No tienes stock parado relevante. Tu inventario rota bien.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr style={{ color: "#8E8E93", fontSize: 11, textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Cls</th><th style={{ padding: "6px 8px" }}>Producto</th>
                <th style={{ padding: "6px 8px" }}>Por qué liquidar</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Stock</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Cobertura</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Capital parado</th>
              </tr></thead>
              <tbody>
                {liquidar.map((t, i) => (
                  <tr key={t.sku + i} style={{ borderTop: "1px solid #F7F7FA" }}>
                    <td style={{ padding: "7px 8px" }}><ClaseChip c={t.clase} /></td>
                    <td style={{ padding: "7px 8px", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.producto}>
                      {t.producto}<div style={{ fontSize: 10, color: "#AEAEB2", fontFamily: "monospace" }}>{t.sku} · {t.tipo}</div>
                    </td>
                    <td style={{ padding: "7px 8px", fontSize: 11.5, color: "#636366" }}>{t.motivo}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(t.stockActual)}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", color: t.cobertura >= 9999 ? "#AF52DE" : "#636366" }}>{t.cobertura >= 9999 ? "∞" : t.cobertura + "d"}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700, color: "#AF52DE" }}>{fmtMM(t.valorStock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── SIMULADOR DE STOCK IDEAL — parametrizable ─── */}
      {sim && (
        <div style={{ ...card, border: "1.5px solid " + accent + "44" }}>
          <SectionTitle sub="Define tus parámetros comerciales y proyecta cuánto stock necesitas para tu meta de venta">🎛️ Simulador de stock ideal</SectionTitle>

          {/* Controles */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14, background: "#FAFAFC", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ flex: "1 1 170px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#3A3A3C", marginBottom: 4 }}>📈 Meta de crecimiento: <b style={{ color: accent }}>{simParams.crecimiento > 0 ? "+" : ""}{simParams.crecimiento}%</b></div>
              <input type="range" min="-20" max="50" step="5" value={simParams.crecimiento} onChange={e => setSimParams(p => ({ ...p, crecimiento: +e.target.value }))} style={{ width: "100%" }} />
              <div style={{ fontSize: 10, color: "#AEAEB2" }}>Cuánto quieres crecer la venta vs hoy</div>
            </div>
            <div style={{ flex: "1 1 170px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#3A3A3C", marginBottom: 4 }}>🚛 Lead time: <b style={{ color: accent }}>{simParams.leadTime == null ? "por tipo" : simParams.leadTime + " días"}</b></div>
              <input type="range" min="0" max="60" step="1" value={simParams.leadTime ?? 0} onChange={e => setSimParams(p => ({ ...p, leadTime: +e.target.value === 0 ? null : +e.target.value }))} style={{ width: "100%" }} />
              <div style={{ fontSize: 10, color: "#AEAEB2" }}>Días que tarda en llegar lo pedido (0 = usar estándar por tipo)</div>
            </div>
            <div style={{ flex: "1 1 170px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#3A3A3C", marginBottom: 4 }}>📅 Cobertura: <b style={{ color: accent }}>{simParams.cobertura == null ? "por tipo" : simParams.cobertura + " días"}</b></div>
              <input type="range" min="0" max="120" step="5" value={simParams.cobertura ?? 0} onChange={e => setSimParams(p => ({ ...p, cobertura: +e.target.value === 0 ? null : +e.target.value }))} style={{ width: "100%" }} />
              <div style={{ fontSize: 10, color: "#AEAEB2" }}>Días de venta que quieres en góndola (0 = estándar)</div>
            </div>
            <div style={{ flex: "1 1 170px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#3A3A3C", marginBottom: 4 }}>🛡️ Colchón seguridad: <b style={{ color: accent }}>×{simParams.seguridad.toFixed(1)}</b></div>
              <input type="range" min="1" max="2" step="0.1" value={simParams.seguridad} onChange={e => setSimParams(p => ({ ...p, seguridad: +e.target.value }))} style={{ width: "100%" }} />
              <div style={{ fontSize: 10, color: "#AEAEB2" }}>×1.0 = justo · ×1.5 = +50% para picos o temporada alta</div>
            </div>
          </div>

          {/* Resultados de la proyección */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <div style={{ flex: "1 1 160px", borderRadius: 12, padding: "12px 14px", background: accent + "0d", border: "1px solid " + accent + "33" }}>
              <div style={{ fontSize: 11, color: "#8E8E93" }}>Venta proyectada/mes</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: accent }}>{fmtMM(sim.resumen.ventaProyectadaMes)}</div>
              <div style={{ fontSize: 10.5, color: sim.resumen.ventaIncremental > 0 ? "#34C759" : "#8E8E93" }}>{sim.resumen.ventaIncremental > 0 ? "+" + fmtMM(sim.resumen.ventaIncremental) + " vs hoy" : "igual a hoy"}</div>
            </div>
            <div style={{ flex: "1 1 160px", borderRadius: 12, padding: "12px 14px", background: "#FF950010", border: "1px solid #FF950033" }}>
              <div style={{ fontSize: 11, color: "#8E8E93" }}>Stock a conseguir</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#FF9500" }}>{fN(sim.resumen.unidadesNecesarias)} u</div>
              <div style={{ fontSize: 10.5, color: "#8E8E93" }}>{sim.resumen.nNecesidades} productos con gap</div>
            </div>
            <div style={{ flex: "1 1 160px", borderRadius: 12, padding: "12px 14px", background: "#FF3B3010", border: "1px solid #FF3B3033" }}>
              <div style={{ fontSize: 11, color: "#8E8E93" }}>Inversión necesaria</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#FF3B30" }}>{fmtMM(sim.resumen.inversionTotal)}</div>
              <div style={{ fontSize: 10.5, color: "#8E8E93" }}>al costo, para cerrar el gap</div>
            </div>
            <div style={{ flex: "1 1 160px", borderRadius: 12, padding: "12px 14px", background: "#AF52DE10", border: "1px solid #AF52DE33" }}>
              <div style={{ fontSize: 11, color: "#8E8E93" }}>Riesgo inmediato</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#AF52DE" }}>{sim.resumen.nRiesgoInmediato}</div>
              <div style={{ fontSize: 10.5, color: "#8E8E93" }}>se agotan antes de que llegue reposición</div>
            </div>
          </div>

          {/* Top gaps de la simulación */}
          {sim.necesidades.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr style={{ color: "#8E8E93", fontSize: 11, textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Cls</th><th style={{ padding: "6px 8px" }}>Producto</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Stock hoy</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Stock ideal</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Conseguir</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Inversión</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Se agota en</th>
                </tr></thead>
                <tbody>
                  {sim.necesidades.slice(0, 10).map((t, i) => (
                    <tr key={t.sku + i} style={{ borderTop: "1px solid #F7F7FA" }}>
                      <td style={{ padding: "7px 8px" }}><ClaseChip c={t.clase} /></td>
                      <td style={{ padding: "7px 8px", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.producto}>
                        {t.producto}<div style={{ fontSize: 10, color: "#AEAEB2", fontFamily: "monospace" }}>{t.sku}</div>
                      </td>
                      <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(t.stockActual)}</td>
                      <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 700 }}>{fN(t.stockIdeal)}</td>
                      <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: 800, color: accent }}>{fN(t.gap)} u</td>
                      <td style={{ padding: "7px 8px", textAlign: "right", color: "#636366" }}>{fmtMM(t.inversionGap)}</td>
                      <td style={{ padding: "7px 8px", textAlign: "right", color: t.quiebraAntesDeReponer ? "#FF3B30" : "#636366", fontWeight: t.quiebraAntesDeReponer ? 700 : 400 }}>{t.diasHastaQuiebre >= 999 ? "—" : t.diasHastaQuiebre + "d"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sim.necesidades.length > 10 && <div style={{ fontSize: 11, color: "#AEAEB2", padding: "6px 8px" }}>… y {sim.necesidades.length - 10} más (descarga el plan para verlos todos)</div>}
            </div>
          )}
          <div style={{ fontSize: 11, color: "#AEAEB2", marginTop: 8, lineHeight: 1.5 }}>
            <b>Fórmula:</b> stock ideal = venta diaria proyectada × (lead time + cobertura) × colchón. "Se agota en" usa tu venta proyectada — si es menor al lead time, vas a quebrar antes de que llegue lo pedido.
          </div>
        </div>
      )}

      {/* ─── OPORTUNIDADES COMERCIALES ─── */}
      {sim && (
        <div style={{ display: isMobile ? "block" : "flex", gap: 12 }}>
          {/* Protege tus caballos de carrera */}
          <div style={{ ...card, flex: 1, borderTop: "3px solid #34C759" }}>
            <SectionTitle sub="Tus productos más vendidos por día — que nunca falten">🏇 Protege tu venta</SectionTitle>
            {sim.topVelocidad.slice(0, 6).map((t, i) => (
              <div key={t.sku} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: i ? "1px solid #F7F7FA" : "none" }}>
                <ClaseChip c={t.clase} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.producto}>{t.producto}</div>
                  <div style={{ fontSize: 10.5, color: "#8E8E93" }}>{t.vtaDia} u/día · stock {fN(t.stockActual)}</div>
                </div>
                {t.diasHastaQuiebre < 999 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: t.diasHastaQuiebre <= t.leadTime ? "#FF3B30" : t.diasHastaQuiebre <= t.leadTime * 2 ? "#FF9500" : "#34C759", flexShrink: 0 }}>
                    {t.diasHastaQuiebre}d
                  </span>
                )}
              </div>
            ))}
            <div style={{ fontSize: 10.5, color: "#AEAEB2", marginTop: 6 }}>El número es en cuántos días se agota. Rojo = antes de que llegue reposición.</div>
          </div>

          {/* Margen oculto */}
          <div style={{ ...card, flex: 1, borderTop: "3px solid #AF52DE" }}>
            <SectionTitle sub="Alta ganancia y stock disponible — dale exhibición o empuje comercial">💎 Margen escondido</SectionTitle>
            {sim.margenOculto.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "#8E8E93", padding: "6px 0" }}>Sin candidatos claros ahora.</div>
            ) : sim.margenOculto.slice(0, 6).map((t, i) => (
              <div key={t.sku} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: i ? "1px solid #F7F7FA" : "none" }}>
                <ClaseChip c={t.clase} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.producto}>{t.producto}</div>
                  <div style={{ fontSize: 10.5, color: "#8E8E93" }}>margen {pct(t.margenMesProy / (t.ventaMesProy || 1))} · stock {fN(t.stockActual)} disponible</div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#AF52DE", flexShrink: 0 }}>{fmtMM(t.margenMesProy)}/mes</span>
              </div>
            ))}
            <div style={{ fontSize: 10.5, color: "#AEAEB2", marginTop: 6 }}>Productos con margen sobre el promedio y stock para vender más: ponlos a la vista, ofrécelos primero.</div>
          </div>
        </div>
      )}

      {/* ─── COMPOSICIÓN POR TIPO ─── */}
      <div style={card}>
        <SectionTitle sub="Cómo se compone tu inventario y qué categoría necesita atención">📊 Tu inventario por tipo de producto</SectionTitle>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr style={{ color: "#8E8E93", fontSize: 11, textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>Tipo</th>
              <th style={{ padding: "6px 8px" }}>Veredicto</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Valor stock</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Quiebre</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Urgentes</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Exceso</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Margen/mes riesgo</th>
            </tr></thead>
            <tbody>
              {porTipo.map(T => (
                <tr key={T.tipo} style={{ borderTop: "1px solid #F7F7FA" }}>
                  <td style={{ padding: "7px 8px", fontWeight: 600, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={T.tipo}>{T.tipo}</td>
                  <td style={{ padding: "7px 8px" }}>
                    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, color: T.vColor, background: T.vColor + "1a" }}>{T.veredicto}</span>
                  </td>
                  <td style={{ padding: "7px 8px", textAlign: "right" }}>{fmtMM(T.valorStock)}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", color: T.quiebrePct > 0.3 ? "#FF3B30" : "#636366" }}>{pct(T.quiebrePct)}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", color: T.nUrgente > 0 ? "#FF9500" : "#C7C7CC", fontWeight: T.nUrgente > 0 ? 700 : 400 }}>{T.nUrgente || "—"}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", color: T.nExceso > 0 ? "#AF52DE" : "#C7C7CC", fontWeight: T.nExceso > 0 ? 700 : 400 }}>{T.nExceso || "—"}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", color: "#636366" }}>{T.margenRiesgo > 0 ? fmtMM(T.margenRiesgo) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: "#AEAEB2", marginTop: 8, lineHeight: 1.5 }}>
          <b>Veredicto:</b> "Falta stock" = quiebre alto o muchos urgentes · "Exceso / liquidar" = capital parado · "Reponer pronto" = algunos bajo reorden · "Saludable" = ok.
        </div>
      </div>
    </div>
  )
}

function EstadoPill({ estado }) {
  const c = estado === "Quiebre" ? "#FF3B30" : "#FF9500"
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, color: c, background: c + "15" }}>{estado}</span>
}
