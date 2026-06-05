import { useState, useMemo } from 'react'
import { fN, fmtMM, card, KPI, ClaseChip, SectionTitle } from './ui'

const ACCION_META = {
  COMPRAR_URGENTE: { l: "Comprar urgente", ic: "🔥", c: "#FF3B30", desc: "Quiebres en clases de alta rotación. Cada día sin stock es venta perdida." },
  RIESGO_QUIEBRE:  { l: "Riesgo de quiebre", ic: "⏳", c: "#FF9500", desc: "Cobertura menor al lead time del proveedor. Reponer antes de quebrar." },
  REBALANCEAR:     { l: "Rebalancear sucursales", ic: "🔀", c: "#007AFF", desc: "Quiebre en una sucursal con sobrante en otra. Transferir sin comprar." },
  LIQUIDAR:        { l: "Liquidar / promocionar", ic: "🏷️", c: "#AF52DE", desc: "Stock sin venta en el período. Capital inmovilizado a liberar." },
  SOBRESTOCK:      { l: "Frenar compras", ic: "🛑", c: "#5856D6", desc: "Cobertura muy por encima del objetivo. No recomprar todavía." },
}
const ORDEN = ["COMPRAR_URGENTE", "RIESGO_QUIEBRE", "REBALANCEAR", "LIQUIDAR", "SOBRESTOCK"]

export function InvDecision({ data, accent, isMobile }) {
  const { sug } = data
  const [filtro, setFiltro] = useState("COMPRAR_URGENTE")

  const resumen = useMemo(() => ORDEN.map(t => {
    const arr = sug.acciones.filter(a => a.tipo === t)
    return { t, n: arr.length, impacto: arr.reduce((s, a) => s + a.impacto, 0) }
  }), [sug])

  const lista = useMemo(() => sug.acciones.filter(a => a.tipo === filtro), [sug, filtro])

  return (
    <div>
      {/* Resumen ejecutivo */}
      <div style={{ ...card, background: "linear-gradient(135deg,#1a1a2e,#16213e)", color: "#fff" }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>🎯 Plan de acción comercial</div>
        <div style={{ fontSize: 13, color: "#c7c7d9", marginBottom: 14 }}>{sug.acciones.length} decisiones priorizadas a partir del cruce ventas × stock × clasificación ABCD.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {resumen.map(({ t, n, impacto }) => {
            const m = ACCION_META[t]
            return (
              <div key={t} onClick={() => setFiltro(t)} style={{ flex: "1 1 140px", background: filtro === t ? m.c : "rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 14px", cursor: "pointer", transition: "all .2s", border: filtro === t ? "1px solid " + m.c : "1px solid rgba(255,255,255,0.1)" }}>
                <div style={{ fontSize: 18 }}>{m.ic}</div>
                <div style={{ fontSize: 12, fontWeight: 600, margin: "4px 0 2px" }}>{m.l}</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{n}</div>
                <div style={{ fontSize: 11, color: filtro === t ? "rgba(255,255,255,0.85)" : "#9a9ab0" }}>{fmtMM(impacto)}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Descripción del grupo seleccionado */}
      <div style={{ ...card, borderLeft: "4px solid " + ACCION_META[filtro].c, display: "flex", gap: 12, alignItems: "center" }}>
        <span style={{ fontSize: 26 }}>{ACCION_META[filtro].ic}</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: ACCION_META[filtro].c }}>{ACCION_META[filtro].l}</div>
          <div style={{ fontSize: 13, color: "#636366", marginTop: 2 }}>{ACCION_META[filtro].desc}</div>
        </div>
      </div>

      {/* Lista de acciones */}
      <div style={card}>
        <SectionTitle sub={lista.length + " acciones · ordenadas por impacto"}>Detalle de acciones</SectionTitle>
        {lista.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", color: "#34C759", fontWeight: 600 }}>✓ Sin acciones de este tipo. Todo bajo control aquí.</div>
        ) : lista.map((a, i) => (
          <div key={a.sku + i} style={{ display: "flex", gap: 12, padding: "12px 0", borderTop: i ? "1px solid #F2F2F7" : "none", alignItems: "flex-start" }}>
            <ClaseChip c={a.clase} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: "#1C1C1E" }}>{a.producto}</div>
              <div style={{ fontSize: 11.5, color: "#8E8E93", fontFamily: "monospace", marginBottom: 3 }}>{a.sku} · {a.tipo_prod}</div>
              <div style={{ fontSize: 12.5, color: "#3A3A3C" }}>{a.detalle}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: ACCION_META[filtro].c }}>{fmtMM(a.impacto)}</div>
              <div style={{ fontSize: 10.5, color: "#AEAEB2", maxWidth: 110 }}>{a.impactoLabel}</div>
              {a.reposicion ? <div style={{ fontSize: 11, color: accent, fontWeight: 700, marginTop: 3 }}>reponer {fN(a.reposicion)} u</div> : null}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: "#AEAEB2", textAlign: "center", padding: "4px 0 8px" }}>
        Impactos estimados a partir del ritmo de venta del período. Las cantidades a reponer usan los parámetros oficiales de lead time y cobertura por tipo de producto.
      </div>
    </div>
  )
}
