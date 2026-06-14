import { useState, useEffect, useMemo } from 'react'
import { supabase, signOut } from '../supabase'
import * as XLSX from 'xlsx'
import {
  parseVentas, parseStock, filtrarMesesConfiables,
  analizar, kpis, kpisPorSucursal, estacionalidad, sugerencias,
  filtrarPorSucursal, estacionalidadPorSucursal, SUCURSALES,
  filtrarPorTipo, tiposDeProducto, filtrarPorClase, transferenciasCD, normSuc
} from './engine'
import { scopeIn, roleIn } from '../core/permisos'
import { InvVision } from './InvVision'
import { InvDatos } from './InvDatos'
import { InvCD } from './InvCD'
import { InvDecision } from './InvDecision'
import { InvAyuda } from './InvAyuda'
import { InvSync } from './InvSync'
import { InvMiTienda } from './InvMiTienda'

const ROLES = [
  { k: "admin", l: "Admin", c: "#FF3B30" }, { k: "dir_general", l: "Dir. General", c: "#FF3B30" },
  { k: "dir_finanzas", l: "Dir. Finanzas", c: "#AF52DE" }, { k: "dir_negocios", l: "Dir. Negocios", c: "#007AFF" },
  { k: "dir_operaciones", l: "Dir. Operaciones", c: "#5AC8FA" }, { k: "analista", l: "Analista", c: "#34C759" },
  { k: "jefe_bodega", l: "Jefe Bodega", c: "#FF9500" }, { k: "jefe_tienda", l: "Jefe Tienda", c: "#FF9500" },
  { k: "cajero", l: "Cajero", c: "#34C759" }, { k: "directorio", l: "Directorio", c: "#8E8E93" }
]
const rl = u => ROLES.find(r => r.k === u?.rol) || ROLES[5]

const TABS = [
  { k: "mitienda", l: "Mi Tienda",      ic: "🏬" },
  { k: "vision",   l: "Visión General", ic: "📊" },
  { k: "datos",    l: "Datos",          ic: "🗂️" },
  { k: "cd",       l: "CD Maipú",       ic: "📦" },
  { k: "decision", l: "Decisión",       ic: "🎯" },
  { k: "sync",     l: "Sync BSALE",     ic: "🔄" },
  { k: "ayuda",    l: "Ayuda",          ic: "❓" },
]
// Migración de tabs antiguos guardados en localStorage
const TAB_MIGRA = { dashboard: "vision", analisis: "datos", estacional: "vision", sucursal: "vision", transfer: "cd", tendencias: "vision" }

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
const CL_CLASE_SEL = { A: "#34C759", B: "#007AFF", C: "#FF9500", D: "#8E8E93" }

// Patrón ilike para filtrar la sucursal en SQL cubriendo variantes:
// "La Granja", "LA GRANJA", "la granja"... "Los Angeles", "Los Ángeles"... "Maipu", "Maipú"...
// ilike es case-insensitive en Postgres; % es comodín. Usa palabra clave única por sucursal.
function buildSucPattern(suc) {
  if (!suc) return null
  if (suc === "La Granja") return "%granja%"
  if (suc === "Los Angeles") return "%ngeles%"  // matchea "Angeles" y "Ángeles"
  if (suc === "Maipu") return "%maip%"
  return suc
}

export function InventarioApp({ cu, setAppActual }) {
  const [tab, setTab]       = useState(() => { try { const t = localStorage.getItem("inv_tab") || "vision"; return TAB_MIGRA[t] || t } catch { return "vision" } })
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
  const [tipoFiltro, setTipoFiltro] = useState("TODOS")
  const [claseFiltro, setClaseFiltro] = useState("TODAS")
  const [scopeUsuario, setScopeUsuario] = useState(null) // sucursal asignada al usuario
  const [rolApp, setRolApp] = useState(null) // rol real en la app inventario (no usuarios.rol legado)

  useEffect(() => { const o = () => setIsMobile(window.innerWidth < 768); window.addEventListener("resize", o); return () => window.removeEventListener("resize", o) }, [])

  // Estado para saber si ya se resolvió el rol/scope (evita race condition con la carga)
  const [scopeResuelto, setScopeResuelto] = useState(false)

  // Auto-detect sucursal del usuario según su scope en cualquier app
  useEffect(() => {
    if (!cu) return
    const detectar = async () => {
      try {
        // Rol real en la app inventario (fallback finanzas/compras)
        let rol = await roleIn(cu, 'inventario')
        if (!rol) rol = await roleIn(cu, 'finanzas')
        if (!rol) rol = await roleIn(cu, 'compras')
        if (rol) setRolApp(rol)

        // Intenta primero scope de la app inventario, luego finanzas (compartido)
        let s = await scopeIn(cu, 'inventario')
        if (!s) s = await scopeIn(cu, 'finanzas')
        if (!s) s = await scopeIn(cu, 'compras')
        const mapped = MAP_SUCURSAL_ID[s]
        if (mapped) {
          setScopeUsuario(mapped)
          // Si tiene scope, SIEMPRE arranca en su sucursal (ignorar localStorage para evitar fugas)
          setSucursalFiltro(mapped)
        }
      } catch {}
      setScopeResuelto(true)
    }
    detectar()
  }, [cu])
  useEffect(() => { try { localStorage.setItem("inv_tab", tab) } catch {} }, [tab])

  // Si el rol no permite el tab actual (ej: jefe_tienda con tab="cd" guardado), redirigir
  useEffect(() => {
    if (!rolApp) return
    const restringido = ["jefe_tienda","jefe_bodega","cajero"].includes(rolApp)
    if (restringido && ["cd","sync"].includes(tab)) {
      setTab("mitienda")
    }
  }, [rolApp, tab])
  useEffect(() => { try { localStorage.setItem("inv_suc", sucursalFiltro) } catch {} }, [sucursalFiltro])

  // Carga automática desde Supabase al montar (espera a que el scope esté resuelto)
  useEffect(() => {
    if (!scopeResuelto) return  // no cargar hasta saber el scope del usuario
    const cargarDesdeSupabase = async () => {
      setCargandoSB(true)
      try {
        // ── DEFENSA EN PROFUNDIDAD ──
        // Si el usuario tiene scope, las queries traen SOLO su sucursal.
        // El nombre de la sucursal en BD puede variar (con/sin tilde, mayúsculas).
        // Construimos un patrón ilike que cubre las variantes comunes.
        const sucPattern = scopeUsuario ? buildSucPattern(scopeUsuario) : null

        // Leer ventas por mes
        let qVentas = supabase
          .from("inv_ventas_mes")
          .select("sku,periodo,sucursal,office_id,qty_neta,neto_neto,margen_neto,n_documentos")
          .order("periodo", { ascending: true })
          .limit(50000)
        if (sucPattern) qVentas = qVentas.ilike("sucursal", sucPattern)
        const { data: ventas, error: ev } = await qVentas
        if (ev || !ventas?.length) { setCargandoSB(false); return }

        // Leer último snapshot de stock
        let qStocks = supabase
          .from("v_inv_stock_actual")
          .select("sku,sucursal,office_id,snap_date,qty,costo_unit,valor_total")
          .limit(50000)
        if (sucPattern) qStocks = qStocks.ilike("sucursal", sucPattern)
        const { data: stocks, error: es } = await qStocks
        if (es) { setCargandoSB(false); return }

        // ── ENRIQUECIMIENTO desde tabla productos del ERP (nombre, tipo, costo) ──
        // La API BSALE de stocks no trae costo; productos sí lo tiene sincronizado.
        const { data: prods } = await supabase
          .from("productos")
          .select("sku,producto,tipo_producto,costo_unitario,clasif_abcd")
          .limit(50000)

        // Fallback: metadata sincronizada desde BSALE (botón "Sincronizar nombres")
        const { data: metaBsale } = await supabase
          .from("inv_sku_meta")
          .select("sku,producto,tipo_producto,costo_unit")
          .limit(50000)

        const normKey = (s) => String(s ?? "").trim().toUpperCase()
        const prodMap = {}
        // Primero BSALE meta (menor prioridad)…
        ;(metaBsale || []).forEach(m => {
          if (m.sku != null) prodMap[normKey(m.sku)] = {
            producto: m.producto || "",
            tipo: m.tipo_producto || "",
            costo: Number(m.costo_unit) || 0,
          }
        })
        // …luego productos del ERP sobreescribe (mayor prioridad: tiene costo y tipo curados)
        ;(prods || []).forEach(p => {
          if (p.sku != null) {
            const prev = prodMap[normKey(p.sku)] || {}
            prodMap[normKey(p.sku)] = {
              producto: p.producto || prev.producto || "",
              tipo: p.tipo_producto || prev.tipo || "",
              costo: Number(p.costo_unitario) || prev.costo || 0,
            }
          }
        })

        // Helper: busca metadata con clave normalizada (trim + mayúsculas)
        const enrich = (sku) => prodMap[normKey(sku)] || { producto: "", tipo: "", costo: 0 }

        // porSku con margen RECALCULADO usando costo real (neto - qty*costo)
        const porSku = new Map()
        const mesesSet = new Set()
        for (const v of ventas) {
          if (!v.sku || !v.periodo) continue
          mesesSet.add(v.periodo)
          const suc = normSuc(v.sucursal)
          const key = suc + "|" + v.periodo
          const info = enrich(v.sku)
          let e = porSku.get(v.sku)
          if (!e) {
            e = { sku: v.sku,
              meta: { producto: info.producto || v.sku, tipo: info.tipo || "Sin clasificar", marca: "" },
              totalQty: 0, totalNeto: 0, totalMargen: 0, porSucMes: new Map(),
              _costo: info.costo,
            }
            porSku.set(v.sku, e)
          }
          const q = v.qty_neta || 0
          const neto = v.neto_neto || 0
          // margen real = venta neta - costo de lo vendido
          const margen = info.costo > 0 ? neto - (q * info.costo) : (v.margen_neto || 0)
          e.totalQty    += q
          e.totalNeto   += neto
          e.totalMargen += margen
          const cell = e.porSucMes.get(key) || { q: 0, neto: 0, margen: 0 }
          cell.q      += q
          cell.neto   += neto
          cell.margen += margen
          e.porSucMes.set(key, cell)
        }

        const meses = [...mesesSet].sort()
        const ventasObj = { meses, mesesAll: meses, porSku }

        // stockMap con valor RECALCULADO usando costo real (unid * costo)
        const stockMap = new Map()
        for (const s of (stocks || [])) {
          if (!s.sku) continue
          const info = enrich(s.sku)
          const costoU = info.costo > 0 ? info.costo : (s.costo_unit || 0)
          let e = stockMap.get(s.sku)
          if (!e) {
            e = { sku: s.sku,
              meta: { tipo: info.tipo || "Sin clasificar", producto: info.producto || s.sku, marca: "", precio: 0 },
              total: { unid: 0, valor: 0, porRecibir: 0 }, porSuc: new Map()
            }
            stockMap.set(s.sku, e)
          }
          const unid = s.qty || 0
          const valor = unid * costoU
          const suc = normSuc(s.sucursal)
          e.total.unid  += unid
          e.total.valor += valor
          e.porSuc.set(suc, { unid, costoU, valor, porRecibir: 0 })
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
        setSbData({ ventas: ventasObj, stock: stockMap, an, k, kSuc, est, sug })
      } catch (e) {
        console.error("Error cargando desde Supabase:", e)
      }
      setCargandoSB(false)
    }
    cargarDesdeSupabase()
  }, [scopeResuelto, scopeUsuario])

  const [sbData, setSbData] = useState(null)

  // Rol que se muestra en el header: prioriza el rol específico de la app sobre el legado
  const r = useMemo(() => {
    const rolReal = rolApp || cu?.rol
    return ROLES.find(x => x.k === rolReal) || ROLES.find(x => x.k === "directorio")
  }, [rolApp, cu])

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

  // data: aplica filtro de sucursal + tipo + clase sobre dataGlobal — todos los tabs lo usan
  const data = useMemo(() => {
    if (!dataGlobal) return null
    let an = dataGlobal.an
    let ventas = dataGlobal.ventas
    const sucActiva = sucursalFiltro !== "TODAS"
    const tipoActivo = tipoFiltro !== "TODOS"
    const claseActiva = claseFiltro !== "TODAS"

    // Orden: sucursal (recalcula clase local) → tipo (reclasifica dentro del tipo) → clase (filtra)
    if (sucActiva) an = filtrarPorSucursal(an, sucursalFiltro)
    if (tipoActivo) an = filtrarPorTipo(an, tipoFiltro)
    if (claseActiva) an = filtrarPorClase(an, claseFiltro)

    if (!sucActiva && !tipoActivo && !claseActiva) return dataGlobal

    const est = sucActiva
      ? estacionalidadPorSucursal(ventas, sucursalFiltro)
      : dataGlobal.est
    return {
      ...dataGlobal,
      an,
      k: kpis(an),
      est,
      sug: sugerencias(an, est),
      kSuc: dataGlobal.kSuc, // siempre global para comparativa
    }
  }, [dataGlobal, sucursalFiltro, tipoFiltro, claseFiltro])

  // Sucursal efectiva para Mi Tienda: filtro si es de venta, sino scope del usuario
  const sucursalMiTienda = useMemo(() => {
    if (sucursalFiltro === "La Granja" || sucursalFiltro === "Los Angeles") return sucursalFiltro
    if (scopeUsuario === "La Granja" || scopeUsuario === "Los Angeles") return scopeUsuario
    return sucursalFiltro // "TODAS" o "Maipu" → la vista mostrará el selector
  }, [sucursalFiltro, scopeUsuario])

  // dataTransfer: para el tab Transferencias — IGNORA sucursal (necesita las 3),
  // pero SÍ respeta tipo y clase
  const dataTransfer = useMemo(() => {
    if (!dataGlobal) return null
    let an = dataGlobal.an
    if (tipoFiltro !== "TODOS") an = filtrarPorTipo(an, tipoFiltro)
    if (claseFiltro !== "TODAS") an = filtrarPorClase(an, claseFiltro)
    return { ...dataGlobal, an }
  }, [dataGlobal, tipoFiltro, claseFiltro])

  // distribución ABCD del dataset actual (para la barra de prioridad)
  const distABCD = useMemo(() => {
    if (!dataGlobal) return null
    // usar el análisis con sucursal+tipo aplicados (sin filtro de clase, para ver toda la distribución)
    let an = dataGlobal.an
    if (sucursalFiltro !== "TODAS") an = filtrarPorSucursal(an, sucursalFiltro)
    if (tipoFiltro !== "TODOS") an = filtrarPorTipo(an, tipoFiltro)
    const d = { A: 0, B: 0, C: 0, D: 0 }, v = { A: 0, B: 0, C: 0, D: 0 }
    an.items.forEach(x => { d[x.clase]++; v[x.clase] += x.netoVend })
    const totalV = v.A + v.B + v.C + v.D || 1
    return { d, v, totalV }
  }, [dataGlobal, sucursalFiltro, tipoFiltro])

  // lista de tipos para el selector
  const tiposDisponibles = useMemo(() => dataGlobal ? tiposDeProducto(dataGlobal.an) : [], [dataGlobal])

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

        {/* TABS — filtrados según el rol del usuario */}
        <div style={{ display:"flex", gap:4, overflowX:"auto", paddingBottom:10 }}>
          {TABS.filter(t => {
            // Roles con acceso restringido a tienda — NO ven CD Maipú ni Sync
            if (["jefe_tienda","jefe_bodega","cajero"].includes(rolApp)) {
              return !["cd","sync"].includes(t.k)
            }
            return true
          }).map(t => {
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
        {data && tab !== "sync" && tab !== "ayuda" && (
          <div style={{ display:"flex", gap:6, alignItems:"center", paddingBottom:10, overflowX:"auto", flexWrap:"wrap" }}>
            <span style={{ fontSize:11, color:"#8E8E93", fontWeight:600, flexShrink:0 }}>
              {scopeUsuario ? "Tu sucursal:" : "Filtrar análisis por sucursal:"}
            </span>
            {/* Botón "Todas" solo para usuarios sin scope restringido */}
            {!scopeUsuario && (
              <SucBtn label="🌐 Todas las sucursales" sucKey="TODAS" activo={sucursalFiltro==="TODAS"} onClick={()=>setSucursalFiltro("TODAS")} color="#1C1C1E" />
            )}
            {SUCURSALES.map(s => {
              // Si el usuario tiene scope, solo muestra SU sucursal
              if (scopeUsuario && s !== scopeUsuario) return null
              return <SucBtn key={s} label={"🏬 "+s} sucKey={s} activo={sucursalFiltro===s} onClick={()=>setSucursalFiltro(s)} color={SUC_COLOR[s]} />
            })}
          </div>
        )}

        {/* SELECTOR GLOBAL DE TIPO DE PRODUCTO */}
        {data && ["vision","datos","decision","cd"].includes(tab) && tiposDisponibles.length > 1 && (
          <div style={{ display:"flex", gap:6, alignItems:"center", paddingBottom:10 }}>
            <span style={{ fontSize:11, color:"#8E8E93", fontWeight:600, flexShrink:0 }}>Tipo de producto:</span>
            <select value={tipoFiltro} onChange={e=>setTipoFiltro(e.target.value)} style={{ padding:"7px 12px", borderRadius:18, border:"1.5px solid "+(tipoFiltro!=="TODOS"?ACCENT:"#E5E5EA"), background:tipoFiltro!=="TODOS"?ACCENT:"#fff", color:tipoFiltro!=="TODOS"?"#fff":"#3A3A3C", fontSize:11.5, fontWeight:600, cursor:"pointer", outline:"none", maxWidth:280 }}>
              <option value="TODOS">📦 Todos los tipos ({tiposDisponibles.length})</option>
              {tiposDisponibles.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {tipoFiltro !== "TODOS" && (
              <button onClick={()=>setTipoFiltro("TODOS")} style={{ padding:"5px 10px", borderRadius:8, border:"none", background:"#F2F2F7", color:"#636366", fontSize:11, fontWeight:600, cursor:"pointer", flexShrink:0 }}>✕ Quitar</button>
            )}
          </div>
        )}

        {/* SELECTOR + VISUALIZACIÓN PARETO ABCD — priorización */}
        {data && ["vision","datos","decision"].includes(tab) && distABCD && (
          <div style={{ paddingBottom:10 }}>
            <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:8, flexWrap:"wrap" }}>
              <span style={{ fontSize:11, color:"#8E8E93", fontWeight:600, flexShrink:0 }}>Prioridad (clase ABCD):</span>
              <ClaseFiltroBtn label="Todas" claseKey="TODAS" activo={claseFiltro==="TODAS"} onClick={()=>setClaseFiltro("TODAS")} color="#1C1C1E" n={distABCD.d.A+distABCD.d.B+distABCD.d.C+distABCD.d.D} />
              {["A","B","C","D"].map(c => (
                <ClaseFiltroBtn key={c} label={"Clase "+c} claseKey={c} activo={claseFiltro===c} onClick={()=>setClaseFiltro(claseFiltro===c?"TODAS":c)} color={CL_CLASE_SEL[c]} n={distABCD.d[c]} />
              ))}
            </div>
            {/* Barra de distribución Pareto */}
            <div style={{ display:"flex", height:10, borderRadius:6, overflow:"hidden", background:"#F2F2F7" }}>
              {["A","B","C","D"].map(c => {
                const w = distABCD.totalV ? (distABCD.v[c] / distABCD.totalV) * 100 : 0
                if (w < 0.5) return null
                return <div key={c} title={`Clase ${c}: ${distABCD.d[c]} SKU · ${w.toFixed(0)}% de la venta`} onClick={()=>setClaseFiltro(claseFiltro===c?"TODAS":c)} style={{ width:w+"%", background:CL_CLASE_SEL[c], cursor:"pointer", opacity: claseFiltro==="TODAS"||claseFiltro===c?1:0.35, transition:"opacity .2s" }} />
              })}
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#AEAEB2", marginTop:3 }}>
              <span>← más venta concentra</span>
              <span>cola larga →</span>
            </div>
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
        {tab === "sync" && <InvSync dataGlobal={dataGlobal} accent={ACCENT} isMobile={isMobile} />}
        {tab === "ayuda" && <InvAyuda accent={ACCENT} isMobile={isMobile} irA={setTab} />}

        {/* Tab VISIÓN — muestra skeleton si no hay datos */}
        {tab === "vision" && (data
          ? <InvVision data={data} sucursalFiltro={sucursalFiltro} accent={ACCENT} isMobile={isMobile} irA={setTab} />
          : <DashboardVacio onUpload={onUpload} cargando={cargando} err={err} accent={ACCENT} isMobile={isMobile} setTab={setTab} />
        )}

        {/* Tabs analíticos — piden datos */}
        {tab !== "sync" && tab !== "vision" && tab !== "ayuda" && !data && (
          <EmptyTab tab={tab} onUpload={onUpload} cargando={cargando} accent={ACCENT} setTab={setTab} />
        )}

        {tab === "mitienda" && data && <InvMiTienda data={dataGlobal} sucursal={sucursalMiTienda} onPickSucursal={setSucursalFiltro} accent={ACCENT} isMobile={isMobile} irA={setTab} />}
        {tab === "datos"    && data && <InvDatos    data={data} sucursalFiltro={sucursalFiltro} accent={ACCENT} isMobile={isMobile} />}
        {tab === "cd"       && data && <InvCD       data={dataTransfer} destinoFiltro={sucursalFiltro} accent={ACCENT} isMobile={isMobile} irA={setTab} />}
        {tab === "decision" && data && <InvDecision data={data} accent={ACCENT} isMobile={isMobile} />}
      </div>
    </div>
  )
}

/* ── ClaseFiltroBtn ── pildora para filtro de clase ABCD */
function ClaseFiltroBtn({ label, claseKey, activo, onClick, color, n }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 11px", borderRadius: 16, border: "1.5px solid " + (activo ? color : "#E5E5EA"),
      background: activo ? color : "#fff", color: activo ? "#fff" : "#3A3A3C",
      fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
      display: "inline-flex", alignItems: "center", gap: 5, transition: "all .15s",
    }}>
      {label}
      <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, background: activo ? "rgba(255,255,255,0.25)" : "#F2F2F7", borderRadius: 8, padding: "0 5px" }}>{n}</span>
    </button>
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
    mitienda: { ic:"🏬", l:"Mi Tienda",       desc:"Centro de mando: qué pedir a Maipú, qué comprar y qué liquidar." },
    datos:    { ic:"🗂️", l:"Datos",           desc:"Sábana completa con todas las métricas por SKU, exportable." },
    cd:       { ic:"📦", l:"CD Maipú",        desc:"Fill rate, cobertura de red, inmovilizado y despachos sugeridos." },
    decision: { ic:"🎯", l:"Decisión",        desc:"Motor de sugerencias priorizadas con impacto en $." },
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
