import { useState, useMemo } from 'react'
import { fmt, fN, fmtMM, pct, card, CL_CLASE, ClaseChip, EstadoChip, SectionTitle } from './ui'

const inputStyle = { padding: "8px 12px", borderRadius: 10, border: "1px solid #e5e5ea", fontSize: 13, background: "#fff", outline: "none" }

export function InvAnalisis({ data, accent, isMobile }) {
  const { an } = data
  const [q, setQ] = useState("")
  const [fClase, setFClase] = useState("")
  const [fEstado, setFEstado] = useState("")
  const [fTipo, setFTipo] = useState("")
  const [sort, setSort] = useState({ col: "netoVend", dir: -1 })
  const [limite, setLimite] = useState(50)

  const tipos = useMemo(() => [...new Set(an.items.map(x => x.tipo))].sort(), [an])
  const estados = ["Quiebre", "Reposicion", "Dead stock", "Sin movimiento", "Saludable"]

  const filtrados = useMemo(() => {
    let r = an.items
    if (q) { const Q = q.toLowerCase(); r = r.filter(x => x.sku.toLowerCase().includes(Q) || (x.producto || "").toLowerCase().includes(Q) || (x.marca || "").toLowerCase().includes(Q)) }
    if (fClase) r = r.filter(x => x.clase === fClase)
    if (fEstado) r = r.filter(x => x.estado === fEstado)
    if (fTipo) r = r.filter(x => x.tipo === fTipo)
    r = [...r].sort((a, b) => {
      const va = a[sort.col], vb = b[sort.col]
      if (typeof va === "string") return sort.dir * va.localeCompare(vb)
      return sort.dir * ((va || 0) - (vb || 0))
    })
    return r
  }, [an, q, fClase, fEstado, fTipo, sort])

  const setSortCol = (col) => setSort(s => s.col === col ? { col, dir: -s.dir } : { col, dir: -1 })
  const Th = ({ col, children, right }) => (
    <th onClick={() => setSortCol(col)} style={{ padding: "8px 8px", cursor: "pointer", textAlign: right ? "right" : "left", userSelect: "none", color: sort.col === col ? accent : "#8E8E93", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {children} {sort.col === col ? (sort.dir < 0 ? "▾" : "▴") : ""}
    </th>
  )

  const totalVenta = filtrados.reduce((s, x) => s + x.netoVend, 0)
  const totalStock = filtrados.reduce((s, x) => s + x.stockValor, 0)

  return (
    <div>
      {/* Filtros */}
      <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input placeholder="🔍 Buscar SKU, producto o marca…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, flex: "1 1 240px", minWidth: 160 }} />
        <select value={fClase} onChange={e => setFClase(e.target.value)} style={inputStyle}><option value="">Toda clase</option>{["A", "B", "C", "D"].map(c => <option key={c} value={c}>Clase {c}</option>)}</select>
        <select value={fEstado} onChange={e => setFEstado(e.target.value)} style={inputStyle}><option value="">Todo estado</option>{estados.map(e => <option key={e} value={e}>{e}</option>)}</select>
        <select value={fTipo} onChange={e => setFTipo(e.target.value)} style={{ ...inputStyle, maxWidth: 180 }}><option value="">Todo tipo</option>{tipos.map(t => <option key={t} value={t}>{t}</option>)}</select>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6, fontSize: 12, color: "#636366", marginBottom: 8, padding: "0 4px" }}>
        <span><b style={{ color: accent }}>{fN(filtrados.length)}</b> SKU · venta {fmtMM(totalVenta)} · stock {fmtMM(totalStock)}</span>
        <span>Mostrando {Math.min(limite, filtrados.length)}</span>
      </div>

      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table>
          <thead><tr style={{ borderBottom: "2px solid #F2F2F7" }}>
            <Th col="clase">Cls</Th><Th col="sku">SKU</Th><Th col="producto">Producto</Th><Th col="estado">Estado</Th>
            <Th col="stockUnid" right>Stock</Th><Th col="qtyVend" right>Vendido</Th><Th col="vtaDia" right>Vta/día</Th>
            <Th col="cobertura" right>Cobertura</Th><Th col="rotAnual" right>Rotación</Th><Th col="margenPct" right>Margen</Th>
            <Th col="reposicion" right>Reponer</Th><Th col="netoVend" right>Venta $</Th>
          </tr></thead>
          <tbody>
            {filtrados.slice(0, limite).map(x => (
              <tr key={x.sku} style={{ borderTop: "1px solid #F7F7FA" }}>
                <td style={{ padding: "7px 8px" }}><ClaseChip c={x.clase} /></td>
                <td style={{ padding: "7px 8px", fontFamily: "monospace", fontSize: 11.5 }}>{x.sku}</td>
                <td style={{ padding: "7px 8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={x.producto}>{x.producto}</td>
                <td style={{ padding: "7px 8px" }}><EstadoChip e={x.estado} /></td>
                <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(x.stockUnid)}</td>
                <td style={{ padding: "7px 8px", textAlign: "right" }}>{fN(x.qtyVend)}</td>
                <td style={{ padding: "7px 8px", textAlign: "right" }}>{x.vtaDia >= 1 ? fN(x.vtaDia) : x.vtaDia.toFixed(1)}</td>
                <td style={{ padding: "7px 8px", textAlign: "right", color: x.cobertura < 15 ? "#FF3B30" : x.cobertura > 200 ? "#AF52DE" : "#1C1C1E", fontWeight: x.cobertura < 15 ? 700 : 400 }}>{x.cobertura >= 999 ? "∞" : x.cobertura + "d"}</td>
                <td style={{ padding: "7px 8px", textAlign: "right" }}>{x.rotAnual}x</td>
                <td style={{ padding: "7px 8px", textAlign: "right", color: x.margenPct < 0.2 ? "#FF9500" : "#34C759" }}>{pct(x.margenPct)}</td>
                <td style={{ padding: "7px 8px", textAlign: "right", fontWeight: x.reposicion > 0 ? 700 : 400, color: x.reposicion > 0 ? accent : "#C7C7CC" }}>{x.reposicion > 0 ? fN(x.reposicion) : "—"}</td>
                <td style={{ padding: "7px 8px", textAlign: "right", color: "#636366" }}>{fmtMM(x.netoVend)}</td>
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
