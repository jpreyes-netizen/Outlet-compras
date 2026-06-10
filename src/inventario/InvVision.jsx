import { useState } from 'react'
import { InvDashboard } from './InvDashboard'
import { InvSucursales } from './InvSucursales'
import { InvTendencias } from './InvTendencias'
import { InvEstacionalidad } from './InvEstacionalidad'

const VISTAS = [
  { k: "hoy",        l: "📊 Hoy",            d: "Estado actual del inventario" },
  { k: "sucursales", l: "🏬 Sucursales",     d: "Comparativa entre locales" },
  { k: "tendencias", l: "📈 Tendencias",     d: "Evolución día a día" },
  { k: "estacional", l: "📅 Estacionalidad", d: "Temporadas por categoría" },
]

export function InvVision({ data, sucursalFiltro, accent, isMobile, irA }) {
  const [vista, setVista] = useState(() => {
    try { return localStorage.getItem("inv_vision") || "hoy" } catch { return "hoy" }
  })
  const set = (k) => { setVista(k); try { localStorage.setItem("inv_vision", k) } catch {} }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto" }}>
        {VISTAS.map(v => (
          <button key={v.k} onClick={() => set(v.k)} title={v.d} style={{
            flex: isMobile ? "0 0 auto" : 1, padding: "10px 14px", borderRadius: 12, border: "none",
            cursor: "pointer", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", transition: "all .2s",
            background: vista === v.k ? accent : "#fff",
            color: vista === v.k ? "#fff" : "#3A3A3C",
            boxShadow: vista === v.k ? "0 3px 10px " + accent + "55" : "0 1px 2px rgba(0,0,0,0.04)",
          }}>{v.l}</button>
        ))}
      </div>
      {vista === "hoy"        && <InvDashboard data={data} accent={accent} isMobile={isMobile} irA={irA} />}
      {vista === "sucursales" && <InvSucursales data={data} accent={accent} isMobile={isMobile} />}
      {vista === "tendencias" && <InvTendencias sucursalFiltro={sucursalFiltro} accent={accent} isMobile={isMobile} />}
      {vista === "estacional" && <InvEstacionalidad data={data} accent={accent} isMobile={isMobile} />}
    </div>
  )
}
