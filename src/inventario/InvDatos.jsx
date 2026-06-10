import { useState, useMemo } from 'react'
import { fN, fmtMM, pct, card, CL_VELOCIDAD, ClaseChip, EstadoChip, SectionTitle } from './ui'

const inputStyle = { padding: "8px 12px", borderRadius: 10, border: "1px solid #e5e5ea", fontSize: 13, background: "#fff", outline: "none" }

/* Columnas de la sábana: [clave, etiqueta, formato, alineación derecha, tooltip] */
const COLS = [
  ["clase",        "Cls",        null, false, "Clase ABCD (Pareto por monto)"],
  ["producto",     "Producto",   null, false, null],
  ["tipo",         "Tipo",       null, false, null],
  ["estado",       "Estado",     null, false, null],
  ["velocidad",    "Velocidad",  null, false, "Fast <30d · Medium 30-90 · Slow 90-180 · Very slow >180"],
  ["stockUnid",    "Stock",      fN,   true,  null],
  ["stockValor",   "Stock $",    fmtMM, true, "Valorizado al costo"],
  ["qtyVend",      "Vendido",    fN,   true,  "Unidades del período"],
  ["netoVend",     "Venta $",    fmtMM, true, null],
  ["margenVend",   "Margen $",   fmtMM, true, null],
  ["margenPct",    "Margen %",   pct,  true,  null],
  ["vtaDia",       "Vta/día",    v => v >= 1 ? fN(v) : (+v).toFixed(1), true, null],
  ["cobertura",    "Cobertura",  v => v >= 999 ? "∞" : v + "d", true, "Días de stock al ritmo actual"],
  ["puntoReorden", "Reorden",    fN,   true,  "Punto de reorden"],
  ["reposicion",   "Reponer",    v => v > 0 ? fN(v) : "—", true, "Unidades sugeridas"],
  ["costoRepo",    "Costo repo", v => v > 0 ? fmtMM(v) : "—", true, null],
  ["rotAnual",     "Rot",        v => v + "x", true, "Rotación anual"],
  ["dsi",          "DSI",        v => v >= 999 ? "∞" : v + "d", true, "Days Sales of Inventory"],
  ["gmroi",        "GMROI",      v => v >= 99 ? "∞" : (+v).toFixed(2), true, "Margen por $1 en stock (≥2 sano)"],
  ["sellThrough",  "Sell-thru",  pct, true,  "% vendido del disponible"],
  ["health",       "Health",     v => v || "—", true, "Salud integral 0-100"],
]

export function InvDatos({ data, sucursalFiltro, accent, isMobile }) {
  const { an } = data
  const [q, setQ] = useState("")
  const [fClase, setFClase] = useState("")
  const [fEstado, setFEstado] = useState("")
  const [sort, setSort] = useState({ col: "netoVend", dir: -1 })
  const [limite, setLimite] = useState(50)

  const filtrados = useMemo(() => {
    let r = an.items
    if (q) { const Q = q.toLowerCase(); r = r.filter(x => x.sku.toLowerCase().includes(Q) || (x.producto || "").toLowerCase().includes(Q) || (x.tipo || "").toLowerCase().includes(Q)) }
    if (fClase) r = r.filter(x => x.clase === fClase)
    if (fEstado) r = r.filter(x => x.estado === fEstado)
    return [...r].sort((a, b) => {
      const va = a[sort.col], vb = b[sort.col]
      if (typeof va === "string") return sort.dir * String(va).localeCompare(String(vb))
      return sort.dir * ((va || 0) - (vb || 0))
    })
  }, [an, q, fClase, fEstado, sort])

  const setSortCol = col => setSort(s => s.col === col ? { col, dir: -s.dir } : { col, dir: -1 })

  const descargarTodo = () => {
    const head = ["SKU", ...COLS.map(c => c[1])]
    const filas = [head, ...filtrados.map(x => [
      x.sku,
      ...COLS.map(([k]) => {
        const v = x[k]
        if (typeof v === "number") return String(v).replace(".", ",")
        return v ?? ""
      })
    ])]
    const csv = filas.map(f => f.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const suc = sucursalFiltro && sucursalFiltro !== "TODAS" ? "_" + sucursalFiltro.replace(/\s/g, "") : ""
    a.href = url; a.download = `sabana_stock${suc}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const sucLabel = sucursalFiltro && sucursalFiltro !== "TODAS" ? sucursalFiltro : "todas las sucursales"

  return (
    <div>
      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", flex: 1 }}>
          <input placeholder="🔍 Buscar SKU, producto o tipo…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, flex: "1 1 200px", minWidth: 140 }} />
          <select value={fClase} onChange={e => setFClase(e.target.value)} style={inputStyle}><option value="">Toda clase</option>{["A", "B", "C", "D"].map(c => <option key={c} value={c}>Clase {c}</option>)}</select>
          <select value={fEstado} onChange={e => setFEstado(e.target.value)} style={inputStyle}><option value="">Todo estado</option>{["Quiebre", "Reposicion", "Dead stock", "Sin movimiento", "Saludable"].map(e => <option key={e} value={e}>{e}</option>)}</select>
        </div>
        <button onClick={descargarTodo} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: accent, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
          ⬇ Descargar sábana ({fN(filtrados.length)} filas)
        </button>
      </div>

      <div style={{ fontSize: 12, color: "#636366", marginBottom: 8, padding: "0 4px" }}>
        <b style={{ color: accent }}>{fN(filtrados.length)}</b> SKU · {sucLabel} · todas las métricas del motor analítico. El CSV exporta el detalle completo con los filtros aplicados.
      </div>

      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ fontSize: 12 }}>
          <thead><tr style={{ borderBottom: "2px solid #F2F2F7" }}>
            {COLS.map(([k, l, , right, tip]) => (
              <th key={k} onClick={() => setSortCol(k)} title={tip || l} style={{ padding: "8px 7px", cursor: "pointer", textAlign: right ? "right" : "left", userSelect: "none", whiteSpace: "nowrap", color: sort.col === k ? accent : "#8E8E93", fontSize: 10.5, fontWeight: 700 }}>
                {l} {sort.col === k ? (sort.dir < 0 ? "▾" : "▴") : ""}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {filtrados.slice(0, limite).map(x => (
              <tr key={x.sku} style={{ borderTop: "1px solid #F7F7FA" }}>
                {COLS.map(([k, , fmt, right]) => {
                  if (k === "clase") return <td key={k} style={{ padding: "6px 7px" }}><ClaseChip c={x.clase} /></td>
                  if (k === "estado") return <td key={k} style={{ padding: "6px 7px" }}><EstadoChip e={x.estado} /></td>
                  if (k === "producto") return (
                    <td key={k} style={{ padding: "6px 7px", maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={x.producto}>
                      {x.producto}<div style={{ fontSize: 9.5, color: "#AEAEB2", fontFamily: "monospace" }}>{x.sku}</div>
                    </td>
                  )
                  if (k === "velocidad") return <td key={k} style={{ padding: "6px 7px", whiteSpace: "nowrap" }}><span style={{ fontSize: 10.5, fontWeight: 700, color: CL_VELOCIDAD[x.velocidad] }}>● {x.velocidad}</span></td>
                  const v = x[k]
                  return <td key={k} style={{ padding: "6px 7px", textAlign: right ? "right" : "left", whiteSpace: "nowrap" }}>{fmt ? fmt(v) : v}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {filtrados.length > limite && (
          <div style={{ padding: 12, textAlign: "center" }}>
            <button onClick={() => setLimite(l => l + 100)} style={{ padding: "8px 20px", borderRadius: 10, border: "none", background: accent + "15", color: accent, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Ver más ({fN(filtrados.length - limite)} restantes)</button>
          </div>
        )}
      </div>
    </div>
  )
}
