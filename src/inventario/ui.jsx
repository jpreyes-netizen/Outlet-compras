/* Helpers UI compartidos — app Inventario */

export const fmt = n => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n || 0)
export const fN = n => new Intl.NumberFormat("es-CL").format(Math.round(n || 0))
export const fmtMM = n => {
  const v = n || 0
  if (Math.abs(v) >= 1e9) return "$" + (v / 1e9).toFixed(1) + "MM"
  if (Math.abs(v) >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M"
  if (Math.abs(v) >= 1e3) return "$" + Math.round(v / 1e3) + "k"
  return "$" + Math.round(v)
}
export const pct = n => (n * 100).toFixed(0) + "%"

/* Colores por clase ABCD */
export const CL_CLASE = { A: "#34C759", B: "#007AFF", C: "#FF9500", D: "#8E8E93" }
/* Colores por estado */
export const CL_ESTADO = {
  "Quiebre": "#FF3B30", "Reposicion": "#FF9500", "Dead stock": "#AF52DE",
  "Sin movimiento": "#8E8E93", "Saludable": "#34C759",
}

export const card = {
  background: "#fff", borderRadius: 16, padding: "16px 18px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)", marginBottom: 12, border: "1px solid rgba(0,0,0,0.04)"
}

export function KPI({ label, value, sub, color, icon, isMobile }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: isMobile ? "12px 10px" : "16px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", flex: "1 1 130px", minWidth: 0 }}>
      {icon && <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>}
      <div style={{ fontSize: 11, color: "#8E8E93", fontWeight: 500, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: isMobile ? 19 : 23, fontWeight: 800, color: color || "#1C1C1E", letterSpacing: "-0.02em", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "#AEAEB2", marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

export function Chip({ children, color, bg }) {
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, color: color || "#fff", background: bg || color + "22" || "#8E8E93" }}>{children}</span>
}

export function ClaseChip({ c }) {
  return <span style={{ display: "inline-flex", width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", background: CL_CLASE[c] || "#8E8E93" }}>{c}</span>
}

export function EstadoChip({ e }) {
  const c = CL_ESTADO[e] || "#8E8E93"
  return <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, color: c, background: c + "1a" }}>{e}</span>
}

export function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.02em" }}>{children}</h3>
      {sub && <div style={{ fontSize: 12, color: "#8E8E93", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

/* Mini barra horizontal */
export function Bar({ value, max, color, h = 8 }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ background: "#F2F2F7", borderRadius: h, height: h, overflow: "hidden", flex: 1 }}>
      <div style={{ width: w + "%", height: "100%", background: color, borderRadius: h, transition: "width .4s" }} />
    </div>
  )
}

export const MES_LBL = (m) => { const [y, mm] = m.split("-"); return ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][+mm] + " " + y.slice(2) }
