/* ═══ HELPERS ═══ */
export const fmt = n => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n || 0)
export const fN = n => new Intl.NumberFormat("es-CL").format(Math.round(n || 0))
export const fU = n => "USD " + new Intl.NumberFormat("en-US").format(Math.round(n || 0))
export const hoy = () => new Date().toISOString().slice(0, 10)
export const hora = () => new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })
export const uid = () => "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

/* ═══ CLASIFICACIÓN ABCD ═══ */
export const CL = {
  A: { c: "#FF3B30", bg: "#FF3B3015", t: "Crítico" },
  B: { c: "#007AFF", bg: "#007AFF15", t: "Importante" },
  C: { c: "#34C759", bg: "#34C75915", t: "Regular" },
  D: { c: "#8E8E93", bg: "#8E8E9315", t: "Bajo" }
}

/* ═══ ESTADOS OC ═══ */
export const STS = {
  "Pend. Dir. Negocios": { c: "#007AFF", bg: "#007AFF15", ic: "⏳" },
  "Pend. Dir. Finanzas": { c: "#AF52DE", bg: "#AF52DE15", ic: "⏳" },
  "Pend. proveedor": { c: "#FF9500", bg: "#FF950015", ic: "🔄" },
  "Proforma OK": { c: "#34C759", bg: "#34C75915", ic: "✓" },
  "Pago fabricación": { c: "#FF9500", bg: "#FF950015", ic: "💰" },
  "En fabricación": { c: "#AF52DE", bg: "#AF52DE15", ic: "🏭" },
  "Pago embarque": { c: "#FF9500", bg: "#FF950015", ic: "💰" },
  "Naviera": { c: "#007AFF", bg: "#007AFF15", ic: "🚢" },
  "Aduana": { c: "#FF3B30", bg: "#FF3B3015", ic: "🏛" },
  "Pago puerto": { c: "#FF9500", bg: "#FF950015", ic: "💰" },
  "Internación": { c: "#FF3B30", bg: "#FF3B3015", ic: "📋" },
  "Transporte": { c: "#AF52DE", bg: "#AF52DE15", ic: "🚛" },
  "Confirmada prov.": { c: "#34C759", bg: "#34C75915", ic: "✓" },
  "Despacho nac.": { c: "#AF52DE", bg: "#AF52DE15", ic: "🚚" },
  "Recibida parcial": { c: "#FF9500", bg: "#FF950015", ic: "◐" },
  "Recibida OK": { c: "#34C759", bg: "#34C75915", ic: "✓" },
  "Cerrada": { c: "#8E8E93", bg: "#8E8E9315", ic: "■" },
  "Rechazada": { c: "#FF3B30", bg: "#FF3B3015", ic: "✕" },
  "Pago pend.": { c: "#FF9500", bg: "#FF950015", ic: "$" }
}

/* ═══ FASES ═══ */
export const FN = [
  { n: "Solicitud" }, { n: "Negocios" }, { n: "Finanzas" },
  { n: "Proveedor" }, { n: "Despacho" }, { n: "Recepción" }, { n: "Cierre" }
]
export const FI = [
  { n: "Solicitud" }, { n: "Negocios" }, { n: "Finanzas" }, { n: "Proforma" },
  { n: "Pago fab." }, { n: "Fabricación" }, { n: "Pago emb." }, { n: "Naviera" },
  { n: "Aduana" }, { n: "Pago pto." }, { n: "Internación" }, { n: "Transporte" },
  { n: "Recepción" }, { n: "Cierre" }
]

/* ═══ ROLES ═══ */
export const ROLES = [
  { k: "admin", l: "Admin", c: "#FF3B30", p: ["todo"] },
  { k: "dir_general", l: "Dir. General", c: "#FF3B30", p: ["aprobar_ilimitado", "ver_dash", "ver_fin"] },
  { k: "dir_finanzas", l: "Dir. Finanzas", c: "#AF52DE", p: ["aprobar_fin", "ver_dash", "ver_fin", "reg_pago"] },
  { k: "dir_negocios", l: "Dir. Negocios", c: "#007AFF", p: ["aprobar_neg", "crear_oc", "ver_dash", "gest_prov", "valid_prov"] },
  { k: "analista", l: "Analista", c: "#34C759", p: ["crear_oc", "ver_dash", "cerrar_oc", "gest_prov", "config", "seguim", "gest_imp"] },
  { k: "jefe_bodega", l: "Jefe Bodega", c: "#FF9500", p: ["recibir", "ver_dash"] },
  { k: "directorio", l: "Directorio", c: "#8E8E93", p: ["ver_dash", "ver_fin"] }
]

export const rl = u => ROLES.find(r => r.k === u?.rol) || ROLES[4]
export const hp = (u, p) => { const r = rl(u); return r.p.includes("todo") || r.p.includes(p) }

/* ═══ TABS ═══ */
export const TABS = [
  { k: "monitor", l: "Monitor", ic: "📊" },
  { k: "repo", l: "Reposición", ic: "📦" },
  { k: "nueva", l: "Nueva OC", ic: "➕" },
  { k: "ordenes", l: "Órdenes", ic: "📋" },
  { k: "config", l: "Config", ic: "⚙️" }
]
