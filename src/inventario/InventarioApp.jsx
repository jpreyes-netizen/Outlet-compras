import { useState, useEffect, useMemo } from 'react'
import { signOut } from '../supabase'
import * as XLSX from 'xlsx'
import {
  parseVentas, parseStock, filtrarMesesConfiables,
  analizar, kpis, kpisPorSucursal, estacionalidad, sugerencias
} from './engine'
import { InvDashboard } from './InvDashboard'
import { InvAnalisis } from './InvAnalisis'
import { InvEstacionalidad } from './InvEstacionalidad'
import { InvDecision } from './InvDecision'
import { InvSync } from './InvSync'
import { InvSucursales } from './InvSucursales'

const ROLES = [
  { k: "admin", l: "Admin", c: "#FF3B30" }, { k: "dir_general", l: "Dir. General", c: "#FF3B30" },
  { k: "dir_finanzas", l: "Dir. Finanzas", c: "#AF52DE" }, { k: "dir_negocios", l: "Dir. Negocios", c: "#007AFF" },
  { k: "dir_operaciones", l: "Dir. Operaciones", c: "#5AC8FA" }, { k: "analista", l: "Analista", c: "#34C759" },
  { k: "jefe_bodega", l: "Jefe Bodega", c: "#FF9500" }, { k: "directorio", l: "Directorio", c: "#8E8E93" }
]
const rl = u => ROLES.find(r => r.k === u?.rol) || ROLES[5]

const TABS = [
  { k: "dashboard", l: "Dashboard", ic: "📊" },
  { k: "analisis", l: "Análisis SKU", ic: "🔎" },
  { k: "estacional", l: "Estacionalidad", ic: "📅" },
  { k: "sucursal", l: "Por Sucursal", ic: "🏬" },
  { k: "decision", l: "Decisión", ic: "🎯" },
  { k: "sync", l: "Sync BSALE", ic: "🔄" },
]

const ACCENT = "#5856D6" // índigo — color identitario de la app de inventario

export function InventarioApp({ cu, setAppActual }) {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem("inv_tab") || "dashboard" } catch { return "dashboard" } })
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 768 : false)
  const [raw, setRaw] = useState(null)       // { ventas, stock }
  const [cargando, setCargando] = useState(false)
  const [err, setErr] = useState("")
  const [fechaCarga, setFechaCarga] = useState(null)

  useEffect(() => { const o = () => setIsMobile(window.innerWidth < 768); window.addEventListener("resize", o); return () => window.removeEventListener("resize", o) }, [])
  useEffect(() => { try { localStorage.setItem("inv_tab", tab) } catch {} }, [tab])

  const r = rl(cu)

  // ── Procesamiento (memoizado) ──
  const data = useMemo(() => {
    if (!raw) return null
    try {
      let ventas = parseVentas(raw.ventasRows)
      ventas = filtrarMesesConfiables(ventas)
      const stock = parseStock(raw.stockRows)
      const an = analizar(ventas, stock)
      const k = kpis(an)
      const kSuc = kpisPorSucursal(an)
      const est = estacionalidad(ventas)
      const sug = sugerencias(an, est)
      return { ventas, stock, an, k, kSuc, est, sug }
    } catch (e) {
      setErr("Error procesando datos: " + e.message)
      return null
    }
  }, [raw])

  const leerExcel = (file) => new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        res(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }))
      } catch (er) { rej(er) }
    }
    fr.onerror = () => rej(new Error("No se pudo leer " + file.name))
    fr.readAsArrayBuffer(file)
  })

  const onUpload = async (e) => {
    const files = [...e.target.files]
    if (!files.length) return
    setCargando(true); setErr("")
    try {
      let ventasRows = null, stockRows = null
      for (const f of files) {
        const rows = await leerExcel(f)
        const flat = (rows[0] || []).join(" ").toUpperCase()
        const isStock = files.length === 1
          ? rows.some(rw => (rw || []).some(c => String(c).trim() === "Stock") )
          : /STOCK/.test(f.name.toUpperCase()) || rows.slice(0, 12).some(rw => (rw || []).some(c => String(c).trim() === "Stock"))
        const isVentas = flat.includes("TIPO MOVIMIENTO") || /VENTA|DETALLE/.test(f.name.toUpperCase())
        if (isVentas && !isStock) ventasRows = rows
        else if (isStock) stockRows = rows
        else if (!ventasRows) ventasRows = rows
        else stockRows = rows
      }
      if (!ventasRows || !stockRows) {
        setErr("Sube ambos archivos: Detalle de ventas + Stock actual.")
        setCargando(false); return
      }
      setRaw({ ventasRows, stockRows })
      setFechaCarga(new Date())
    } catch (er) {
      setErr("Error leyendo archivos: " + er.message)
    }
    setCargando(false)
    e.target.value = ""
  }

  const cambiarApp = () => { localStorage.removeItem("outlet_app_actual"); setAppActual(null) }
  const cerrarSesion = async () => { try { await signOut() } catch {} ;["erp_cu_id", "outlet_app_actual"].forEach(k => localStorage.removeItem(k)); window.location.reload() }

  return (
    <div style={{
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
      margin: 0, padding: isMobile ? "0 10px calc(90px + env(safe-area-inset-bottom))" : "0 20px calc(100px + env(safe-area-inset-bottom))",
      background: "#F2F2F7", minHeight: "100vh", fontSize: 14
    }}>
      <style>{`
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#F2F2F7;overflow-x:hidden}
        input:focus,select:focus{border-color:${ACCENT}!important;box-shadow:0 0 0 3px ${ACCENT}1a}
        ::selection{background:${ACCENT};color:#fff}
        ::-webkit-scrollbar{width:10px;height:10px}
        ::-webkit-scrollbar-track{background:#F2F2F7;border-radius:5px}
        ::-webkit-scrollbar-thumb{background:#C7C7CC;border-radius:5px;border:2px solid #F2F2F7}
        table{font-size:13px;border-collapse:collapse;width:100%}
        th,td{white-space:nowrap}
        .inv-fade{animation:fadeIn .35s ease}
        @media (max-width:767px){body{font-size:13px}table{font-size:11px}th,td{padding:6px 8px!important}}
      `}</style>

      {/* HEADER */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(242,242,247,0.9)", backdropFilter: "blur(20px)", padding: isMobile ? "10px 0 8px" : "14px 0 10px", marginBottom: 10, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: isMobile ? 16 : 20 }}>📦</span>
              <span style={{ fontSize: isMobile ? 16 : 22, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Análisis de Stock</span>
            </div>
            <div style={{ fontSize: isMobile ? 11 : 12, color: r.c, fontWeight: 600 }}>{r.l} — {cu.nombre}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <HdrBtn onClick={cambiarApp} color="#007AFF" icon="⊞" label="Apps" isMobile={isMobile} />
            <HdrBtn onClick={cerrarSesion} color="#FF3B30" icon="power" label="Salir" isMobile={isMobile} />
          </div>
        </div>

        {/* TABS */}
        <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 2 }}>
            {TABS.filter(t => data || t.k === 'sync').map(t => (
              <button key={t.k} onClick={() => setTab(t.k)} style={{
                padding: isMobile ? "7px 12px" : "8px 16px", borderRadius: 12, border: "none", cursor: "pointer",
                fontSize: isMobile ? 12 : 13, fontWeight: 600, whiteSpace: "nowrap",
                background: tab === t.k ? ACCENT : "#fff", color: tab === t.k ? "#fff" : "#3A3A3C",
                boxShadow: tab === t.k ? "0 2px 8px " + ACCENT + "55" : "0 1px 2px rgba(0,0,0,0.04)", transition: "all .2s"
              }}>{t.ic} {t.l}</button>
            ))}
          </div>
      </div>

      {/* CONTENIDO */}
      {!data && tab !== "sync" ? (
        <Carga onUpload={onUpload} cargando={cargando} err={err} isMobile={isMobile} accent={ACCENT} />
      ) : tab === "sync" ? (
        <InvSync accent={ACCENT} isMobile={isMobile} />
      ) : (
        <div className="inv-fade">
          <BarraDatos data={data} fechaCarga={fechaCarga} onReset={() => { setRaw(null); setFechaCarga(null) }} accent={ACCENT} />
          {tab === "dashboard" && <InvDashboard data={data} accent={ACCENT} isMobile={isMobile} />}
          {tab === "analisis" && <InvAnalisis data={data} accent={ACCENT} isMobile={isMobile} />}
          {tab === "estacional" && <InvEstacionalidad data={data} accent={ACCENT} isMobile={isMobile} />}
          {tab === "sucursal" && <InvSucursales data={data} accent={ACCENT} isMobile={isMobile} />}
          {tab === "decision" && <InvDecision data={data} accent={ACCENT} isMobile={isMobile} />}
          {tab === "sync" && <InvSync accent={ACCENT} isMobile={isMobile} />}
        </div>
      )}
    </div>
  )
}

function HdrBtn({ onClick, color, icon, label, isMobile }) {
  return (
    <button onClick={onClick} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: "6px 10px", borderRadius: 10, background: color + "15", border: "none", cursor: "pointer", color, minWidth: isMobile ? 42 : 56 }}>
      <span style={{ fontSize: 14, lineHeight: 1 }}>{icon === "power" ? "⏻" : icon}</span>
      <span style={{ fontSize: 9, fontWeight: 700 }}>{label}</span>
    </button>
  )
}

function Carga({ onUpload, cargando, err, isMobile, accent }) {
  return (
    <div style={{ maxWidth: 560, margin: "40px auto", textAlign: "center" }}>
      <div style={{ background: "#fff", borderRadius: 20, padding: isMobile ? "28px 20px" : "40px 36px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>📦</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1C1C1E", marginBottom: 6, letterSpacing: "-0.02em" }}>Cargar datos BSALE</h2>
        <p style={{ fontSize: 13, color: "#8E8E93", marginBottom: 24, lineHeight: 1.5 }}>
          Sube los dos reportes de BSALE: <b>Detalle de ventas</b> y <b>Stock actual todas las sucursales</b>. Puedes seleccionarlos juntos.
        </p>
        <label style={{ display: "inline-block", padding: "14px 28px", borderRadius: 14, background: accent, color: "#fff", fontWeight: 700, fontSize: 15, cursor: cargando ? "wait" : "pointer", boxShadow: "0 4px 14px " + accent + "55" }}>
          {cargando ? "Procesando…" : "Seleccionar archivos"}
          <input type="file" accept=".xlsx,.xls" multiple onChange={onUpload} disabled={cargando} style={{ display: "none" }} />
        </label>
        <div style={{ marginTop: 18, fontSize: 11, color: "#AEAEB2", lineHeight: 1.6 }}>
          Se analizan automáticamente los meses completos disponibles.<br/>El procesamiento es local en tu navegador.
        </div>
        {err && <div style={{ marginTop: 16, padding: "10px 14px", background: "#FF3B3015", borderRadius: 10, color: "#FF3B30", fontSize: 12, fontWeight: 600 }}>{err}</div>}
      </div>
    </div>
  )
}

function BarraDatos({ data, fechaCarga, onReset, accent }) {
  const meses = data.ventas.meses
  const lbl = (m) => { const [y, mm] = m.split("-"); return ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][+mm] + " " + y.slice(2) }
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, background: "#fff", borderRadius: 12, padding: "10px 14px", marginBottom: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
      <div style={{ fontSize: 12, color: "#3A3A3C" }}>
        <b style={{ color: accent }}>{data.an.items.length}</b> SKU · período <b>{lbl(meses[0])} → {lbl(meses[meses.length - 1])}</b> ({data.an.dias} días) · stock al {fechaCarga ? fechaCarga.toLocaleDateString("es-CL") : "hoy"}
      </div>
      <button onClick={onReset} style={{ padding: "6px 14px", borderRadius: 10, border: "none", background: "#F2F2F7", color: "#636366", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>↻ Cambiar archivos</button>
    </div>
  )
}
