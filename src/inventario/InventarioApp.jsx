import { useState, useEffect, useMemo } from 'react'
import { supabase, signOut } from '../supabase'
import * as XLSX from 'xlsx'
import {
  parseVentas, parseStock, filtrarMesesConfiables,
  analizar, kpis, kpisPorSucursal, estacionalidad, sugerencias,
  filtrarPorSucursal, estacionalidadPorSucursal, SUCURSALES
} from './engine'
import { scopeIn } from '../core/permisos'
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
  { k: "dashboard",  l: "Dashboard",      ic: "📊" },
  { k: "analisis",   l: "Análisis SKU",   ic: "🔎" },
  { k: "estacional", l: "Estacionalidad", ic: "📅" },
  { k: "sucursal",   l: "Por Sucursal",   ic: "🏬" },
  { k: "decision",   l: "Decisión",       ic: "🎯" },
  { k: "sync",       l: "Sync BSALE",     ic: "🔄" },
]

const ACCENT = "#5856D6"

// Mapeo sucursal_id (sistema interno) → nombre normalizado del engine
const MAP_SUCURSAL_ID = {
  "suc-lg": "La Granja",
  "suc-la": "Los Angeles",
  "suc-mp": "Maipu",
  "com-lg": "La Granja",
  "ops-lg": "La Granja",
}
const SUC_COLOR  = { "La Granja": "#34C759", "Los Angeles": "#007AFF", "Maipu": "#FF9500" }

export function InventarioApp({ cu, setAppActual }) {
  const [tab, setTab]       = useState(() => { try { return localStorage.getItem("inv_tab") || "dashboard" } catch { return "dashboard" } })
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" ? window.innerWidth < 768 : false)
  const [raw, setRaw]           = useState(null)
  const [cargando, setCargando] = useState(false)
  const [cargandoSB, setCargandoSB] = useState(true)   // carga inicial Supabase
  const [fuenteDatos, setFuenteDatos] = useState(null)  // 'supabase' | 'excel'
  const [err, setErr]           = useState("")
  const [fechaCarga, setFechaCarga] = useState(null)
  const [sucursalFiltro, setSucursalFiltro] = useState(() => {
    try { return localStorage.getItem("inv_suc") || "TODAS" } catch { return "TODAS" }
  })
  const [scopeUsuario, setScopeUsuario] = useState(null) // sucursal asignada al usuario

  useEffect(() => { const o = () => setIsMobile(window.innerWidth < 768); window.addEventListener("resize", o); return () => window.removeEventListener("resize", o) }, [])

  // Auto-detect sucursal del usuario según su scope en cualquier app
  useEffect(() => {
    if (!cu) return
    const detectar = async () => {
      try {
        // Intenta primero scope de la app inventario, luego finanzas (compartido)
        let s = await scopeIn(cu, 'inventario')
        if (!s) s = await scopeIn(cu, 'finanzas')
        if (!s) s = await scopeIn(cu, 'compras')
        const mapped = MAP_SUCURSAL_ID[s]
        if (mapped) {
          setScopeUsuario(mapped)
          // Si el usuario tiene scope asignado y nunca eligió manualmente, forzar a su sucursal
          try {
            if (!localStorage.getItem("inv_suc")) setSucursalFiltro(mapped)
          } catch {}
        }
      } catch {}
    }
    detectar()
  }, [cu])
  useEffect(() => { try { localStorage.setItem("inv_tab", tab) } catch {} }, [tab])
  useEffect(() => { try { localStorage.setItem("inv_suc", sucursalFiltro) } catch {} }, [sucursalFiltro])

  // Carga automática desde Supabase al montar
  useEffect(() => {
    const cargarDesdeSupabase = async () => {
      setCargandoSB(true)
      try {
        // Leer ventas por mes
        const { data: ventas, error: ev } = await supabase
          .from("inv_ventas_mes")
          .select("sku,periodo,sucursal,office_id,qty_neta,neto_neto,margen_neto,n_documentos")
          .order("periodo", { ascending: true })
        if (ev || !ventas?.length) { setCargandoSB(false); return }

        // Leer último snapshot de stock
        const { data: stocks, error: es } = await supabase
          .from("v_inv_stock_actual")
          .select("sku,sucursal,office_id,snap_date,qty,costo_unit,valor_total")
        if (es) { setCargandoSB(false); return }

        // Leer metadata de SKUs
        const { data: meta } = await supabase
          .from("inv_sku_meta")
          .select("sku,producto,tipo_producto,marca,precio_venta,costo_unit")

        // Construir estructuras compatibles con el engine
        const metaMap = {}
        ;(meta || []).forEach(m => { metaMap[m.sku] = m })

        // porSku: Map(sku -> { meta, totalQty, totalNeto, totalMargen, porSucMes })
        const porSku = new Map()
        const mesesSet = new Set()
        for (const v of ventas) {
          if (!v.sku || !v.periodo) continue
          mesesSet.add(v.periodo)
          const suc = v.sucursal || "?"
          const key = suc + "|" + v.periodo
          let e = porSku.get(v.sku)
          if (!e) {
            const m = metaMap[v.sku] || {}
            e = { sku: v.sku,
              meta: { producto: m.producto || v.sku, tipo: m.tipo_producto || "Sin Tipo", marca: m.marca || "" },
              totalQty: 0, totalNeto: 0, totalMargen: 0, porSucMes: new Map()
            }
            porSku.set(v.sku, e)
          }
          e.totalQty    += (v.qty_neta   || 0)
          e.totalNeto   += (v.neto_neto  || 0)
          e.totalMargen += (v.margen_neto || 0)
          const cell = e.porSucMes.get(key) || { q: 0, neto: 0, margen: 0 }
          cell.q     += (v.qty_neta    || 0)
          cell.neto  += (v.neto_neto   || 0)
          cell.margen += (v.margen_neto || 0)
          e.porSucMes.set(key, cell)
        }

        const meses = [...mesesSet].sort()
        const ventasObj = { meses, mesesAll: meses, porSku }

        // stockMap: Map(sku -> { meta, total, porSuc })
        const stockMap = new Map()
        for (const s of (stocks || [])) {
          if (!s.sku) continue
          const m = metaMap[s.sku] || {}
          let e = stockMap.get(s.sku)
          if (!e) {
            e = { sku: s.sku,
              meta: { tipo: m.tipo_producto || "", producto: m.producto || s.sku, marca: m.marca || "", precio: m.precio_venta || 0 },
              total: { unid: 0, valor: 0, porRecibir: 0 }, porSuc: new Map()
            }
            stockMap.set(s.sku, e)
          }
          const suc = s.sucursal || "?"
          e.total.unid  += (s.qty || 0)
          e.total.valor += (s.valor_total || 0)
          e.porSuc.set(suc, { unid: s.qty || 0, costoU: s.costo_unit || 0, valor: s.valor_total || 0, porRecibir: 0 })
        }

        // Analizar
        const { analizar: _an, kpis: _k, kpisPorSucursal: _ks, estacionalidad: _est, sugerencias: _sug } = await import('./engine')
        const an   = _an(ventasObj, stockMap)
        const k    = _k(an)
        const kSuc = _ks(an)
        const est  = _est(ventasObj)
        const sug  = _sug(an, est)

        setRaw({ _fromSupabase: true })
        setFechaCarga(stocks?.[0]?.snap_date ? new Date(stocks[0].snap_date) : new Date())
        setFuenteDatos("supabase")
        // Guardamos la data procesada directamente en un ref para el useMemo
        setSbData({ ventas: ventasObj, stock: stockMap, an, k, kSuc, est, sug })
      } catch (e) {
        console.error("Error cargando desde Supabase:", e)
      }
      setCargandoSB(false)
    }
    cargarDesdeSupabase()
  }, [])

  const [sbData, setSbData] = useState(null)

  const r = rl(cu)

  // dataGlobal: análisis completo sin filtro (siempre se mantiene para comparativas)
  const dataGlobal = useMemo(() => {
    if (sbData && raw?._fromSupabase) return sbData
    if (!raw || raw._fromSupabase) return null
    try {
      let ventas = parseVentas(raw.ventasRows)
      ventas = filtrarMesesConfiables(ventas)
      const stock = parseStock(raw.stockRows)
      const an  = analizar(ventas, stock)
      const k   = kpis(an)
      const kSuc = kpisPorSucursal(an)
      const est = estacionalidad(ventas)
      const sug = sugerencias(an, est)
      setFuenteDatos("excel")
      return { ventas, stock, an, k, kSuc, est, sug }
    } catch (e) { setErr("Error procesando datos: " + e.message); return null }
  }, [raw, sbData])

  // data: aplica filtro de sucursal sobre dataGlobal — todos los tabs lo usan
  const data = useMemo(() => {
    if (!dataGlobal) return null
    if (sucursalFiltro === "TODAS") return dataGlobal
    const anF = filtrarPorSucursal(dataGlobal.an, sucursalFiltro)
    const estF = estacionalidadPorSucursal(dataGlobal.ventas, sucursalFiltro)
    return {
      ...dataGlobal,
      an: anF,
      k: kpis(anF),
      est: estF,
      sug: sugerencias(anF, estF),
      // kSuc se mantiene global para el tab "Por Sucursal" (comparativa)
      kSuc: dataGlobal.kSuc,
    }
  }, [dataGlobal, sucursalFiltro])

  const leerExcel = f => new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: true })
        res(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }))
      } catch (er) { rej(er) }
    }
    fr.onerror = () => rej(new Error("No se pudo leer " + f.name))
    fr.readAsArrayBuffer(f)
  })

  const onUpload = async e => {
    const files = [...e.target.files]; if (!files.length) return
    setCargando(true); setErr("")
    try {
      let ventasRows = null, stockRows = null
      for (const f of files) {
        const rows = await leerExcel(f)
        const flat = (rows[0] || []).join(" ").toUpperCase()
        const isStock  = /STOCK/.test(f.name.toUpperCase()) || rows.slice(0, 12).some(rw => (rw || []).some(c => String(c).trim() === "Stock"))
        const isVentas = flat.includes("TIPO MOVIMIENTO") || /VENTA|DETALLE/.test(f.name.toUpperCase())
        if (isVentas && !isStock) ventasRows = rows
        else if (isStock) stockRows = rows
        else if (!ventasRows) ventasRows = rows
        else stockRows = rows
      }
      if (!ventasRows || !stockRows) { setErr("Sube ambos archivos: Detalle de ventas + Stock actual."); setCargando(false); return }
      setRaw({ ventasRows, stockRows }); setFechaCarga(new Date())
    } catch (er) { setErr("Error leyendo archivos: " + er.message) }
    setCargando(false); e.target.value = ""
  }

  const cambiarApp   = () => { localStorage.removeItem("outlet_app_actual"); setAppActual(null) }
  const cerrarSesion = async () => { try { await signOut() } catch {} ;["erp_cu_id","outlet_app_actual"].forEach(k => localStorage.removeItem(k)); window.location.reload() }

  return (
    <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif", margin:0, padding: isMobile?"0 10px calc(90px + env(safe-area-inset-bottom))":"0 20px calc(80px + env(safe-area-inset-bottom))", background:"#F2F2F7", minHeight:"100vh", fontSize:14 }}>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#F2F2F7;overflow-x:hidden}
        input:focus,select:focus{border-color:${ACCENT}!important;box-shadow:0 0 0 3px ${ACCENT}1a}
        ::selection{background:${ACCENT};color:#fff}
        ::-webkit-scrollbar{width:8px;height:8px}
        ::-webkit-scrollbar-track{background:#F2F2F7}
        ::-webkit-scrollbar-thumb{background:#C7C7CC;border-radius:4px}
        table{font-size:13px;border-collapse:collapse;width:100%}
        th,td{white-space:nowrap}
        .inv-fade{animation:fadeIn .3s ease}
        .sk{background:linear-gradient(90deg,#E5E5EA 25%,#F2F2F7 50%,#E5E5EA 75%);background-size:800px 100%;animation:shimmer 1.4s infinite;border-radius:6px}
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ position:"sticky", top:0, zIndex:50, background:"rgba(242,242,247,0.92)", backdropFilter:"blur(20px)", padding: isMobile?"10px 0 0":"14px 0 0", marginBottom:12, borderBottom:"1px solid rgba(0,0,0,0.06)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, paddingBottom:10 }}>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
              <div style={{ width:32, height:32, borderRadius:9, background:`linear-gradient(135deg,${ACCENT},#3d3ba3)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 }}>📦</div>
              <div>
                <div style={{ fontSize: isMobile?16:20, fontWeight:800, color:"#1C1C1E", letterSpacing:"-0.03em" }}>Análisis de Stock</div>
                <div style={{ fontSize:11, color:r.c, fontWeight:600 }}>{r.l} — {cu.nombre}</div>
              </div>
            </div>
          </div>
          <div style={{ display:"flex", gap:5, flexShrink:0 }}>
            <HdrBtn onClick={cambiarApp}   color="#007AFF" icon="⊞"  label="Apps"  isMobile={isMobile} />
            <HdrBtn onClick={cerrarSesion} color="#FF3B30" icon="⏻"  label="Salir" isMobile={isMobile} />
          </div>
        </div>

        {/* TABS — siempre visibles */}
        <div style={{ display:"flex", gap:4, overflowX:"auto", paddingBottom:10 }}>
          {TABS.map(t => {
            const activo = tab === t.k
            const tieneData = !!data
            const bloqueado = !tieneData && t.k !== "sync" && t.k !== "dashboard"
            return (
              <button key={t.k} onClick={() => setTab(t.k)}
                style={{ padding: isMobile?"7px 11px":"8px 16px", borderRadius:12, border:"none", cursor: bloqueado?"default":"pointer",
                  fontSize: isMobile?11.5:13, fontWeight:600, whiteSpace:"nowrap", flexShrink:0,
                  background: activo ? ACCENT : bloqueado ? "#F2F2F7" : "#fff",
                  color: activo ? "#fff" : bloqueado ? "#C7C7CC" : "#3A3A3C",
                  boxShadow: activo ? `0 2px 8px ${ACCENT}55` : "0 1px 2px rgba(0,0,0,0.04)",
                  transition:"all .2s", opacity: bloqueado ? 0.6 : 1
                }}>{t.ic} {t.l}
              </button>
            )
          })}
        </div>

        {/* SELECTOR GLOBAL DE SUCURSAL — aplica a todos los tabs analíticos */}
        {data && tab !== "sync" && (
          <div style={{ display:"flex", gap:6, alignItems:"center", paddingBottom:10, overflowX:"auto", flexWrap:"wrap" }}>
            <span style={{ fontSize:11, color:"#8E8E93", fontWeight:600, flexShrink:0 }}>Filtrar análisis por sucursal:</span>
            <SucBtn label="🌐 Todas las sucursales" sucKey="TODAS" activo={sucursalFiltro==="TODAS"} onClick={()=>setSucursalFiltro("TODAS")} color="#1C1C1E" />
            {SUCURSALES.map(s => (
              <SucBtn key={s} label={"🏬 "+s} sucKey={s} activo={sucursalFiltro===s} onClick={()=>setSucursalFiltro(s)} color={SUC_COLOR[s]} />
            ))}
            {scopeUsuario && sucursalFiltro !== scopeUsuario && (
              <button onClick={()=>setSucursalFiltro(scopeUsuario)} style={{ padding:"5px 10px", borderRadius:8, border:`1px dashed ${SUC_COLOR[scopeUsuario]}`, background:"transparent", color:SUC_COLOR[scopeUsuario], fontSize:11, fontWeight:600, cursor:"pointer", flexShrink:0 }}>
                Volver a mi sucursal ({scopeUsuario})
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── CONTENIDO ── */}
      {cargandoSB && !data && (
        <div style={{ textAlign:"center", padding:"60px 20px", color:"#8E8E93" }}>
          <div style={{ fontSize:36, marginBottom:12 }}>⏳</div>
          <div style={{ fontSize:14, fontWeight:600 }}>Cargando datos desde Supabase...</div>
          <div style={{ fontSize:12, marginTop:4 }}>Esto toma solo unos segundos</div>
        </div>
      )}
      <div className="inv-fade" style={{ display: cargandoSB && !data ? "none" : "block" }}>
        {/* Barra datos cargados */}
        {data && tab !== "sync" && <BarraDatos data={data} fechaCarga={fechaCarga} fuenteDatos={fuenteDatos} sucursalFiltro={sucursalFiltro} onReset={() => { setRaw(null); setFechaCarga(null); setSbData(null) }} accent={ACCENT} />}

        {/* Tab SYNC — siempre funciona */}
        {tab === "sync" && <InvSync accent={ACCENT} isMobile={isMobile} />}

        {/* Tab DASHBOARD — muestra skeleton si no hay datos */}
        {tab === "dashboard" && (data
          ? <InvDashboard data={data} accent={ACCENT} isMobile={isMobile} />
          : <DashboardVacio onUpload={onUpload} cargando={cargando} err={err} accent={ACCENT} isMobile={isMobile} setTab={setTab} />
        )}

        {/* Tabs analíticos — piden datos */}
        {tab !== "sync" && tab !== "dashboard" && !data && (
          <EmptyTab tab={tab} onUpload={onUpload} cargando={cargando} accent={ACCENT} setTab={setTab} />
        )}

        {tab === "analisis"   && data && <InvAnalisis      data={data} accent={ACCENT} isMobile={isMobile} />}
        {tab === "estacional" && data && <InvEstacionalidad data={data} accent={ACCENT} isMobile={isMobile} />}
        {tab === "sucursal"   && data && <InvSucursales     data={data} accent={ACCENT} isMobile={isMobile} />}
        {tab === "decision"   && data && <InvDecision       data={data} accent={ACCENT} isMobile={isMobile} />}
      </div>
    </div>
  )
}

/* ── SucBtn ── pildora para selector de sucursal */
function SucBtn({ label, sucKey, activo, onClick, color }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 12px", borderRadius: 18, border: "1.5px solid " + (activo ? color : "#E5E5EA"),
      background: activo ? color : "#fff", color: activo ? "#fff" : "#3A3A3C",
      fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
      flexShrink: 0, transition: "all .15s",
      boxShadow: activo ? "0 2px 6px " + color + "44" : "none",
    }}>{label}</button>
  )
}

/* ── HdrBtn ── */
function HdrBtn({ onClick, color, icon, label, isMobile }) {
  return (
    <button onClick={onClick} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1, padding:"6px 10px", borderRadius:10, background:color+"15", border:"none", cursor:"pointer", color, minWidth: isMobile?40:52 }}>
      <span style={{ fontSize:14, lineHeight:1 }}>{icon}</span>
      <span style={{ fontSize:9, fontWeight:700 }}>{label}</span>
    </button>
  )
}

/* ── BarraDatos ── */
function BarraDatos({ data, fechaCarga, fuenteDatos, sucursalFiltro, onReset, accent }) {
  const meses = data.ventas.meses
  const ML = ["","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]
  const lbl = m => { const [y,mm]=m.split("-"); return ML[+mm]+" "+y.slice(2) }
  const filtroActivo = sucursalFiltro && sucursalFiltro !== "TODAS"
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, background:"#fff", borderRadius:12, padding:"9px 14px", marginBottom:12, boxShadow:"0 1px 2px rgba(0,0,0,0.04)", fontSize:12, color:"#3A3A3C" }}>
      <span>
        {fuenteDatos==="supabase" ? "🔄" : "📂"} <b style={{ color:accent }}>{data.an.items.length}</b> SKU · <b>{lbl(meses[0])} → {lbl(meses[meses.length-1])}</b> ({data.an.dias}d) · stock {fechaCarga?.toLocaleDateString("es-CL")} {fuenteDatos==="supabase" ? "· desde Supabase" : "· desde Excel"}
        {filtroActivo && <span style={{ marginLeft:8, padding:"2px 8px", borderRadius:10, background:accent+"15", color:accent, fontWeight:700, fontSize:11 }}>📍 {sucursalFiltro}</span>}
      </span>
      <button onClick={onReset} style={{ padding:"5px 12px", borderRadius:8, border:"none", background:"#F2F2F7", color:"#636366", fontSize:11, fontWeight:600, cursor:"pointer" }}>↻ Cambiar archivos</button>
    </div>
  )
}

/* ── Dashboard vacío con skeleton + CTA ── */
function DashboardVacio({ onUpload, cargando, err, accent, isMobile, setTab }) {
  const fmtMM = () => "—"
  return (
    <div>
      {/* CTA banner */}
      <div style={{ background:`linear-gradient(135deg,${accent},#3d3ba3)`, borderRadius:18, padding: isMobile?"18px 16px":"22px 24px", marginBottom:16, color:"#fff", display:"flex", flexWrap:"wrap", gap:16, alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize: isMobile?15:18, fontWeight:800, marginBottom:4 }}>📊 Sin datos cargados aún</div>
          <div style={{ fontSize:13, opacity:0.85, lineHeight:1.5 }}>Sube los 2 reportes BSALE para ver el análisis completo,<br/>o usa Sync BSALE para conectar directo desde la API.</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <label style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"10px 18px", borderRadius:12, background:"rgba(255,255,255,0.2)", border:"1px solid rgba(255,255,255,0.3)", color:"#fff", fontWeight:700, fontSize:13, cursor: cargando?"wait":"pointer" }}>
            📂 {cargando ? "Procesando…" : "Subir Excel"}
            <input type="file" accept=".xlsx,.xls" multiple onChange={onUpload} disabled={cargando} style={{ display:"none" }} />
          </label>
          <button onClick={() => setTab("sync")} style={{ padding:"10px 18px", borderRadius:12, background:"#fff", border:"none", color:accent, fontWeight:700, fontSize:13, cursor:"pointer" }}>🔄 Sync BSALE</button>
        </div>
      </div>
      {err && <div style={{ padding:"10px 14px", background:"#FF3B3015", borderRadius:10, color:"#FF3B30", fontSize:12, fontWeight:600, marginBottom:12 }}>{err}</div>}

      {/* KPIs skeleton */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:14 }}>
        {[["Valor inventario","💰"],["Venta período","📈"],["Rotación anual","🔄"],["Tasa de quiebre","⚠️"]].map(([l,ic]) => (
          <div key={l} style={{ background:"#fff", borderRadius:14, padding: isMobile?"12px 10px":"16px 14px", flex:"1 1 130px", minWidth:0 }}>
            <div style={{ fontSize:18, marginBottom:4 }}>{ic}</div>
            <div style={{ fontSize:11, color:"#8E8E93", marginBottom:5 }}>{l}</div>
            <div className="sk" style={{ height:28, width:"70%", marginBottom:4 }} />
            <div className="sk" style={{ height:11, width:"50%" }} />
          </div>
        ))}
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:16 }}>
        {[["En quiebre",""],["Por reponer",""],["Dead stock",""],["Inv. reposición",""]].map(([l]) => (
          <div key={l} style={{ background:"#fff", borderRadius:14, padding: isMobile?"12px 10px":"16px 14px", flex:"1 1 130px" }}>
            <div style={{ fontSize:11, color:"#8E8E93", marginBottom:5 }}>{l}</div>
            <div className="sk" style={{ height:26, width:"60%", marginBottom:4 }} />
            <div className="sk" style={{ height:10, width:"40%" }} />
          </div>
        ))}
      </div>

      {/* Sucursales skeleton */}
      <div style={{ display: isMobile?"block":"flex", gap:12, marginBottom:14 }}>
        {["La Granja","Los Angeles","Maipu"].map(s => (
          <div key={s} style={{ background:"#fff", borderRadius:16, padding:"16px 18px", flex:1, marginBottom: isMobile?12:0, borderLeft:`4px solid ${SUC_COLOR[s]}40` }}>
            <div style={{ fontWeight:800, fontSize:14, color:SUC_COLOR[s], marginBottom:10 }}>🏬 {s}</div>
            {[["Inventario",""],["Venta período",""],["Quiebre",""],["Dead stock",""]].map(([l]) => (
              <div key={l} style={{ display:"flex", justifyContent:"space-between", fontSize:12, padding:"5px 0", borderBottom:"1px solid #F7F7FA" }}>
                <span style={{ color:"#8E8E93" }}>{l}</span>
                <div className="sk" style={{ height:14, width:60 }} />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Distribución ABCD skeleton */}
      <div style={{ display: isMobile?"block":"flex", gap:12 }}>
        <div style={{ background:"#fff", borderRadius:16, padding:"16px 18px", flex:1, marginBottom: isMobile?12:0 }}>
          <div style={{ fontWeight:800, fontSize:15, marginBottom:12 }}>Clasificación ABCD</div>
          {["A","B","C","D"].map(c => (
            <div key={c} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
              <span style={{ width:20, height:20, borderRadius:6, background: c==="A"?"#34C759":c==="B"?"#007AFF":c==="C"?"#FF9500":"#8E8E93", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:800, flexShrink:0 }}>{c}</span>
              <div style={{ flex:1 }}>
                <div className="sk" style={{ height:8, borderRadius:4, width: c==="A"?"80%":c==="B"?"55%":c==="C"?"35%":"20%" }} />
              </div>
              <div className="sk" style={{ height:14, width:30 }} />
            </div>
          ))}
        </div>
        <div style={{ background:"#fff", borderRadius:16, padding:"16px 18px", flex:1 }}>
          <div style={{ fontWeight:800, fontSize:15, marginBottom:12 }}>Salud del inventario</div>
          {["Saludable","Reposicion","Quiebre","Dead stock"].map(e => (
            <div key={e} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
              <span style={{ fontSize:12, width:90, color:"#8E8E93" }}>{e}</span>
              <div style={{ flex:1 }}><div className="sk" style={{ height:8, borderRadius:4, width: e==="Saludable"?"60%":e==="Reposicion"?"40%":e==="Quiebre"?"55%":"25%" }} /></div>
              <div className="sk" style={{ height:14, width:24 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Pantalla genérica tabs analíticos sin datos ── */
function EmptyTab({ tab, onUpload, cargando, accent, setTab }) {
  const INFO = {
    analisis:   { ic:"🔎", l:"Análisis SKU",    desc:"Tabla con rotación, cobertura y margen por cada SKU." },
    estacional: { ic:"📅", l:"Estacionalidad",  desc:"Índices de estacionalidad y heatmap mensual por categoría." },
    sucursal:   { ic:"🏬", l:"Por Sucursal",    desc:"KPIs comparativos y detalle de stock por cada sucursal." },
    decision:   { ic:"🎯", l:"Decisión",        desc:"Motor de 150+ sugerencias priorizadas con impacto en $." },
  }
  const info = INFO[tab] || {}
  return (
    <div style={{ maxWidth:500, margin:"40px auto", textAlign:"center" }}>
      <div style={{ background:"#fff", borderRadius:20, padding:"36px 28px", boxShadow:"0 2px 12px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize:44, marginBottom:10 }}>{info.ic}</div>
        <div style={{ fontSize:18, fontWeight:800, color:"#1C1C1E", marginBottom:6 }}>{info.l}</div>
        <div style={{ fontSize:13, color:"#8E8E93", marginBottom:24, lineHeight:1.6 }}>{info.desc}<br/>Carga los datos para activar este análisis.</div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
          <label style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"10px 20px", borderRadius:12, background:accent, color:"#fff", fontWeight:700, fontSize:13, cursor: cargando?"wait":"pointer", boxShadow:`0 4px 12px ${accent}44` }}>
            📂 {cargando?"Procesando…":"Subir Excel"}
            <input type="file" accept=".xlsx,.xls" multiple onChange={onUpload} disabled={cargando} style={{ display:"none" }} />
          </label>
          <button onClick={() => setTab("sync")} style={{ padding:"10px 20px", borderRadius:12, border:`1px solid ${accent}`, background:"#fff", color:accent, fontWeight:700, fontSize:13, cursor:"pointer" }}>🔄 Sync BSALE</button>
        </div>
      </div>
    </div>
  )
}
