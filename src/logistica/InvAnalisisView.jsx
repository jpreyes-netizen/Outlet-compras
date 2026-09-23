// ═══════════════════════════════════════════════════════════════════════════
// InvAnalisisView.jsx — Análisis de Inventario
// Outlet de Puertas · Módulo Logística
//
// Reemplaza a InvAnalisis (monolito) e InvAnalisisHistorico (tab Mensual).
// Un solo juego de filtros, un solo motor de métricas y un solo estándar
// visual para todas las pestañas.
//
//   RESUMEN         Entrada: KPIs del período, diagnóstico automático,
//                   comparativo por bodega y acceso a cada perspectiva
//   INVENTARIOS     Lista de conteos con su calificación (A–E) y la FICHA de
//                   cada uno: resultado, cruces, historia y qué hacer
//   EXACTITUD       ERI estricto y con tolerancia ABC, distribución del error,
//                   sesgo, por bodega / categoría / inventario
//   RESULTADO       El inventario como estado de resultados: pérdida,
//                   ganancia y balance a costo o a precio de venta; puente,
//                   mariposa, resultado mensual, matriz de control, Pareto,
//                   merma conocida vs desconocida y merma sobre venta
//   COBERTURA       Qué se contó y qué no: antigüedad del último conteo por
//                   categoría y bodega
//   TENDENCIA       Mes a mes por categoría y por bodega; SKUs reincidentes
//   CLASE ABC       Clasificación por valor y exactitud por clase
//   COMPARAR        Dos conteos del mismo alcance, SKU a SKU
//   BONO TRIMESTRAL Cálculo del bono por bodega y trimestre
//
// Métricas (definición única, usada en todas las pestañas):
//   ERI estricto      líneas con diferencia 0 / líneas contadas
//   ERI tolerancia    admite ±0% (A), ±2% (B), ±5% (C) del stock sistema
//   Exactitud valor.  100 − descuadre bruto %
//   Pérdida neta %    (faltantes − sobrantes) valorizados / valor sistema
//   Descuadre bruto % (faltantes + sobrantes) valorizados / valor sistema
//   Sesgo             faltantes / (faltantes + sobrantes), en líneas
//   Balance           sobrantes − faltantes valorizados (negativo = pérdida)
//   Compensación      sobrantes / faltantes valorizados
//   Merma s/ venta    pérdida neta / venta neta del período (solo tiendas)
//   Cruce de código   faltante de un SKU que aparece como sobrante de un SKU
//                     hermano en el mismo conteo: error de registro, no pérdida
//   Pérdida no expl.  pérdida − la parte explicada por cruces de código
//
// Reglas de datos:
//   · Solo inventarios CERRADOS y no marcados es_prueba
//   · Fecha efectiva = fecha_ejecucion_real, si no fecha_planificada
//   · Costo = costo_unitario, si no precio_costo_ref; costos ≤ 0 quedan
//     "sin costo" y costos > $1.000.000 se excluyen como dato corrupto.
//     Ninguno de los dos entra en la valorización, pero sí en el ERI.
//   · Los detalles se leen paginados (PostgREST corta en 1.000 filas)
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { css } from './ui_compartida.jsx'

// ── Tokens institucionales ──────────────────────────────────────────────────
export const IV = {
  navy:'#16213E', ink:'#1C1C1E', slate:'#6E6E73', line:'#DADADF', lineSoft:'#ECECEF',
  rojo:'#B42318', verde:'#1E7A44', ambar:'#B25E09', azul:'#175CD3',
  bgHead:'#F4F4F6', bgHover:'#F7F7F9', bgSoft:'#FAFAFB',
  tVerde:'#E8F2EC', tAmbar:'#F7EEE3', tRojo:'#FCE9E6', tAzul:'#EAF1FB',
}
const COSTO_MAX = 1000000
const MES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
// Códigos del ERP (ventas BSALE) → códigos de Logística
const ERP2LOG = {'suc-lg':'lg', 'suc-la':'la', 'suc-maipu':'mp', 'suc-mp':'cd_mp'}
const COLS_DET = 'id,inventario_id,sku,producto,tipo_producto,stock_sistema,stock_fisico,' +
                 'diferencia,costo_unitario,precio_costo_ref,cruce_confirmado_con,contador1_cantidad,contador2_cantidad'

// ── Formato ─────────────────────────────────────────────────────────────────
const vacio = n => n === null || n === undefined || Number.isNaN(Number(n))
export const fmtCLP = n => vacio(n) ? '—' : new Intl.NumberFormat('es-CL',
  {style:'currency', currency:'CLP', maximumFractionDigits:0}).format(Math.round(Number(n)))
export const fmtN = n => vacio(n) ? '—' : new Intl.NumberFormat('es-CL').format(Math.round(Number(n)))
export const fmtP = (n, d = 1) => vacio(n) ? '—' : `${Number(n).toFixed(d).replace('.', ',')}%`
export const fmtM = n => {
  if (vacio(n)) return '—'
  const v = Number(n), a = Math.abs(v), s = v < 0 ? '−' : ''
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1).replace('.', ',').replace(/,0$/, '')}M`
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}k`
  return `${s}$${Math.round(a)}`
}

// ── Fechas y período ────────────────────────────────────────────────────────
export const fechaEf = c => c?.fecha_ejecucion_real || c?.fecha_planificada || null
const anioDe = f => f ? Number(String(f).slice(0, 4)) : null
const mesDe  = f => f ? Number(String(f).slice(5, 7)) : null
const qDe    = f => f ? Math.ceil(mesDe(f) / 3) : null
const pad2   = n => String(n).padStart(2, '0')
const finDeMes = (a, m) => new Date(a, m, 0).getDate()      // corrige el 30/31 fijo del módulo anterior
export const enPeriodo = (f, per) => {
  if (!f) return false
  if (per === 'anio') return true
  if (per[0] === 'Q') return qDe(f) === Number(per.slice(1))
  if (per[0] === 'M') return mesDe(f) === Number(per.slice(1))
  return true
}
const periodoAnterior = per => {
  if (per === 'anio') return null
  const n = Number(per.slice(1))
  return n > 1 ? `${per[0]}${n - 1}` : null
}
const labelPeriodo = per => per === 'anio' ? 'Año completo'
  : per[0] === 'Q' ? `Q${per.slice(1)} · ${MES[(Number(per.slice(1)) - 1) * 3]}–${MES[Number(per.slice(1)) * 3 - 1]}`
  : MES[Number(per.slice(1)) - 1]

// ── Costos ──────────────────────────────────────────────────────────────────
const costoBruto = d => Number(d.costo_unitario) > 0 ? Number(d.costo_unitario) : (Number(d.precio_costo_ref) || 0)
export const costoDe = d => { const c = costoBruto(d); return c > 0 && c <= COSTO_MAX ? c : null }

// ── Semáforos ───────────────────────────────────────────────────────────────
export const semERI   = v => vacio(v) ? IV.slate : v >= 90 ? IV.verde : v >= 70 ? IV.ambar : IV.rojo
export const semPerd  = v => vacio(v) ? IV.slate : v <= 0.5 ? IV.verde : v <= 1 ? IV.ambar : IV.rojo
export const semDesc  = v => vacio(v) ? IV.slate : v <= 2 ? IV.verde : v <= 5 ? IV.ambar : IV.rojo
export const semDias  = v => vacio(v) ? IV.rojo : v <= 90 ? IV.verde : v <= 180 ? IV.ambar : IV.rojo
const tinte = c => c === IV.verde ? IV.tVerde : c === IV.ambar ? IV.tAmbar : c === IV.rojo ? IV.tRojo : IV.bgHead

// ═══════════════════════════════════════════════════════════════════════════
// Motor de métricas — una sola definición para todo el módulo
// ═══════════════════════════════════════════════════════════════════════════
export function calcular(ds, abc, cabIdx, precioDe) {
  const o = {lineas:ds.length, contadas:0, cuadran:0, dentroTol:0, faltN:0, sobrN:0,
    faltUds:0, sobrUds:0, valorSis:0, valorFis:0, faltVal:0, sobrVal:0,
    faltVenta:0, sobrVenta:0, lineasDif:0, conPrecio:0,
    lineasCosto:0, sinCosto:0, outliers:0, cruces:0}
  for (const d of ds) {
    if (d.stock_fisico === null || d.stock_fisico === undefined) continue
    o.contadas++
    const dif = Number(d.diferencia) || 0
    const sis = Number(d.stock_sistema) || 0
    const exacto = Math.round(dif) === 0
    if (exacto) o.cuadran++
    const cls = abc?.get(`${cabIdx?.[d.inventario_id]?.sucursal_codigo}|${d.sku}`) || 'C'
    const tol = cls === 'A' ? 0 : cls === 'B' ? 0.02 : 0.05
    if (exacto || Math.abs(dif) <= tol * Math.max(sis, 1)) o.dentroTol++
    if (dif < 0) { o.faltN++; o.faltUds += -dif } else if (dif > 0) { o.sobrN++; o.sobrUds += dif }
    if (d.cruce_confirmado_con) o.cruces++
    const c = costoDe(d)
    if (dif !== 0) {
      o.lineasDif++
      const pv = precioDe ? precioDe(d) : null
      if (pv !== null && pv !== undefined) o.conPrecio++
      const base = (pv !== null && pv !== undefined) ? pv : c     // sin precio de venta → costo
      if (base !== null) { if (dif < 0) o.faltVenta += -dif * base; else o.sobrVenta += dif * base }
    }
    if (c === null) { if (costoBruto(d) > COSTO_MAX) o.outliers++; else o.sinCosto++; continue }
    o.lineasCosto++
    o.valorSis += sis * c
    o.valorFis += (Number(d.stock_fisico) || 0) * c
    if (dif < 0) o.faltVal += -dif * c; else if (dif > 0) o.sobrVal += dif * c
  }
  o.eri       = o.contadas ? o.cuadran / o.contadas * 100 : null
  o.eriTol    = o.contadas ? o.dentroTol / o.contadas * 100 : null
  o.perdNeta  = o.faltVal - o.sobrVal
  o.balance   = o.sobrVal - o.faltVal
  o.descuadre = o.faltVal + o.sobrVal
  o.pctPerd   = o.valorSis > 0 ? o.perdNeta / o.valorSis * 100 : null
  o.pctDesc   = o.valorSis > 0 ? o.descuadre / o.valorSis * 100 : null
  o.exactVal  = o.pctDesc === null ? null : Math.max(0, 100 - o.pctDesc)
  o.varAbsUds = o.faltUds + o.sobrUds
  o.sesgo     = (o.faltN + o.sobrN) ? o.faltN / (o.faltN + o.sobrN) * 100 : null
  o.compens   = o.faltVal > 0 ? o.sobrVal / o.faltVal * 100 : null
  o.cobPrecio = o.lineasDif ? o.conPrecio / o.lineasDif * 100 : null
  return o
}

// ABC por valor, por bodega, usando el último conteo de cada SKU (sin duplicar).
// Límite con participación ACUMULADA ANTERIOR: el SKU más valioso siempre es A.
export function clasificarABC(ds, cabIdx) {
  const ult = new Map()
  for (const d of ds) {
    const cab = cabIdx[d.inventario_id]; if (!cab) continue
    const k = `${cab.sucursal_codigo}|${d.sku}`
    const f = fechaEf(cab) || ''
    const v = (Number(d.stock_sistema) || 0) * (costoDe(d) || 0)
    const p = ult.get(k)
    if (!p || f > p.f) ult.set(k, {f, v, suc:cab.sucursal_codigo})
  }
  const porSuc = {}
  ult.forEach((x, k) => { (porSuc[x.suc] = porSuc[x.suc] || []).push([k, x.v]) })
  const out = new Map()
  Object.values(porSuc).forEach(arr => {
    arr.sort((a, b) => b[1] - a[1])
    const tot = arr.reduce((s, a) => s + a[1], 0)
    let acc = 0
    arr.forEach(([k, v]) => {
      if (tot <= 0 || v <= 0) { out.set(k, 'C'); return }
      const prev = acc / tot; acc += v
      out.set(k, prev < 0.80 ? 'A' : prev < 0.95 ? 'B' : 'C')
    })
  })
  return out
}
// Conjunto A+B de un solo inventario (para la cobertura del bono)
export function skusAB(dets) {
  const arr = dets.map(d => [d.sku, (Number(d.stock_sistema) || 0) * (costoDe(d) || 0)])
    .filter(x => x[1] > 0).sort((a, b) => b[1] - a[1])
  const tot = arr.reduce((s, a) => s + a[1], 0)
  const set = new Set(); let acc = 0
  arr.forEach(([sku, v]) => { const prev = tot ? acc / tot : 1; acc += v; if (prev < 0.95) set.add(sku) })
  return set
}

const agrupar = (ds, fk) => { const g = {}; for (const d of ds) { const k = fk(d); (g[k] = g[k] || []).push(d) } return g }

// Lectura paginada de detalles (PostgREST devuelve máximo 1.000 filas por consulta)
export async function fetchDetalles(ids) {
  let all = []
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20)
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('log_inv_detalles').select(COLS_DET)
        .in('inventario_id', lote).order('id').range(from, from + 999)
      if (error) throw error
      all = all.concat(data || [])
      if (!data || data.length < 1000) break
    }
  }
  return all
}

// ═══════════════════════════════════════════════════════════════════════════
// Primitivas visuales
// ═══════════════════════════════════════════════════════════════════════════
const th = (num, x = {}) => ({padding:'8px 12px', textAlign:num ? 'right' : 'left', fontSize:10,
  fontWeight:700, letterSpacing:0.6, color:IV.slate, textTransform:'uppercase', whiteSpace:'nowrap',
  borderBottom:`1px solid ${IV.line}`, background:IV.bgHead, ...x})
const td = (num, x = {}) => ({padding:'8px 12px', textAlign:num ? 'right' : 'left', fontSize:12.5,
  color:IV.ink, borderBottom:`1px solid ${IV.lineSoft}`, verticalAlign:'middle',
  fontVariantNumeric:num ? 'tabular-nums' : 'normal', ...x})
const inp = w => ({fontFamily:'inherit', fontSize:12, color:IV.ink, background:'#fff',
  border:`1px solid ${IV.line}`, borderRadius:3, padding:'6px 9px', width:w, outline:'none', cursor:'pointer'})
const btn = (v = 'outline') => ({fontFamily:'inherit', fontSize:11, fontWeight:700, letterSpacing:0.6,
  cursor:'pointer', padding:'7px 13px', borderRadius:3, whiteSpace:'nowrap',
  ...(v === 'solid' ? {background:IV.navy, color:'#fff', border:`1px solid ${IV.navy}`}
    : v === 'ghost' ? {background:'transparent', color:IV.slate, border:'1px solid transparent'}
    : {background:'#fff', color:IV.navy, border:`1px solid ${IV.line}`})})

function Delta({v, inv = false, unidad = 'pts'}) {
  if (vacio(v) || Math.abs(v) < 0.05) return null
  const bueno = inv ? v < 0 : v > 0
  return (
    <span style={{fontSize:10.5, fontWeight:700, marginLeft:6, color:bueno ? IV.verde : IV.rojo}}>
      {v > 0 ? '▲' : '▼'} {Math.abs(v).toFixed(1).replace('.', ',')} {unidad}
    </span>
  )
}
function Kpi({l, v, c = IV.ink, s, delta, inv, onClick}) {
  return (
    <div onClick={onClick} style={{padding:'11px 18px', borderRight:`1px solid ${IV.lineSoft}`,
      minWidth:132, flex:'1 0 auto', cursor:onClick ? 'pointer' : 'default'}}>
      <div style={{fontSize:10, fontWeight:700, letterSpacing:0.7, color:IV.slate, textTransform:'uppercase'}}>{l}</div>
      <div style={{fontSize:21, fontWeight:800, color:c, letterSpacing:-0.3, marginTop:2,
        fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap'}}>
        {v}<Delta v={delta} inv={inv}/>
      </div>
      {s ? <div style={{fontSize:10.5, color:IV.slate, marginTop:1}}>{s}</div> : null}
    </div>
  )
}
const Strip = ({children, mb = 14}) => (
  <div style={{display:'flex', flexWrap:'wrap', border:`1px solid ${IV.line}`, borderRadius:4,
    background:'#fff', marginBottom:mb, overflow:'hidden'}}>{children}</div>
)
function Seccion({titulo, sub, accion, onAccion, children, mb = 20}) {
  return (
    <div style={{marginBottom:mb}}>
      <div style={{display:'flex', alignItems:'baseline', gap:10, marginBottom:8, flexWrap:'wrap'}}>
        <div style={{fontSize:10.5, fontWeight:700, letterSpacing:0.8, color:IV.slate,
          textTransform:'uppercase'}}>{titulo}</div>
        {sub && <div style={{fontSize:11, color:IV.slate}}>{sub}</div>}
        {accion && (
          <div onClick={onAccion} style={{marginLeft:'auto', fontSize:10.5, fontWeight:700,
            letterSpacing:0.5, color:IV.azul, cursor:'pointer', userSelect:'none'}}>{accion} →</div>
        )}
      </div>
      {children}
    </div>
  )
}
const Caja = ({children, pad = 0, x = {}}) => (
  <div style={{border:`1px solid ${IV.line}`, borderRadius:4, background:'#fff',
    overflowX:'auto', padding:pad, ...x}}>{children}</div>
)
function Barra({pct, c, w = 70, h = 5}) {
  return (
    <div style={{width:w, height:h, background:IV.lineSoft, borderRadius:2, overflow:'hidden', display:'inline-block'}}>
      <div style={{width:`${Math.max(0, Math.min(100, pct || 0))}%`, height:'100%', background:c}}/>
    </div>
  )
}
function Punto({c, children}) {
  return (
    <span style={{display:'inline-flex', alignItems:'center', gap:6, fontSize:10.5, fontWeight:700,
      letterSpacing:0.3, color:c, whiteSpace:'nowrap'}}>
      <span style={{width:7, height:7, borderRadius:'50%', background:c, flexShrink:0}}/>{children}
    </span>
  )
}
function Guia({titulo = 'CÓMO LEER ESTA PESTAÑA', children}) {
  const [a, setA] = useState(false)
  return (
    <div style={{marginBottom:12}}>
      <div onClick={() => setA(v => !v)} style={{display:'inline-flex', alignItems:'center', gap:6,
        cursor:'pointer', fontSize:10.5, fontWeight:700, letterSpacing:0.6, color:IV.azul, userSelect:'none'}}>
        <span style={{display:'inline-flex', alignItems:'center', justifyContent:'center', width:14, height:14,
          borderRadius:'50%', border:`1.5px solid ${IV.azul}`, fontSize:9, fontWeight:800}}>?</span>
        {a ? 'OCULTAR' : titulo}
      </div>
      {a && (
        <div style={{marginTop:8, padding:'12px 14px', background:'#F7F9FC', border:`1px solid ${IV.line}`,
          borderLeft:`3px solid ${IV.azul}`, borderRadius:3, fontSize:11.5, lineHeight:1.65, color:IV.ink}}>
          {children}
        </div>
      )}
    </div>
  )
}
const Vacio = ({t, s}) => (
  <div style={{padding:'34px 16px', textAlign:'center', border:`1px dashed ${IV.line}`, borderRadius:4, background:'#fff'}}>
    <div style={{fontSize:13, fontWeight:700, color:IV.ink}}>{t}</div>
    {s && <div style={{fontSize:12, color:IV.slate, marginTop:5}}>{s}</div>}
  </div>
)
function Seg({opciones, valor, onChange}) {
  return (
    <div style={{display:'inline-flex', border:`1px solid ${IV.line}`, borderRadius:3, overflow:'hidden', background:'#fff'}}>
      {opciones.map((o, i) => (
        <div key={o.k} onClick={() => onChange(o.k)} style={{padding:'6px 12px', fontSize:11, fontWeight:700,
          letterSpacing:0.4, cursor:'pointer', userSelect:'none', whiteSpace:'nowrap',
          borderLeft:i ? `1px solid ${IV.lineSoft}` : 'none',
          background:valor === o.k ? IV.navy : '#fff', color:valor === o.k ? '#fff' : IV.slate}}>{o.l}</div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Componente principal
// ═══════════════════════════════════════════════════════════════════════════
export default function InvAnalisisView({cu, sucs = [], soloSuc = null, embedded = false, onBack, onPdfTrimestral}) {
  const rol = cu?.rol || ''
  const puedeVerCostos = ['admin','dir_general','dir_finanzas'].includes(rol)
  const puedeVerBono   = ['admin','dir_general','dir_finanzas','jefe_logistica'].includes(rol)
  const scope = Array.isArray(soloSuc) ? soloSuc : null
  const scopeKey = scope ? scope.join(',') : '*'

  const [tab, setTab]         = useState('resumen')
  const [ficha, setFicha]     = useState(null)        // id del inventario abierto en su ficha
  const [suc, setSuc]         = useState('todas')
  const [anio, setAnio]       = useState(new Date().getFullYear())
  const [periodo, setPeriodo] = useState('anio')
  const [tipo, setTipo]       = useState('todos')
  const [cabs, setCabs]       = useState(null)
  const [cache, setCache]     = useState({})         // anio → detalles
  const [cargando, setCarg]   = useState(false)
  const [riesgo, setRiesgo]   = useState([])
  const [ventas, setVentas]   = useState({})         // anio → filas de inv_ventas_mes
  const [err, setErr]         = useState('')

  // Cabeceras (todas las cerradas reales del alcance) + riesgo por categoría
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        let q = supabase.from('log_inv_cabeceras')
          .select('id,sucursal_codigo,sucursal_nombre,tipo_inventario,fecha_planificada,fecha_ejecucion_real,' +
                  'categoria_asignada,categorias_asignadas,supervisor_nombre')
          .eq('estado', 'CERRADO').eq('es_prueba', false).order('fecha_planificada')
        if (scope) q = q.in('sucursal_codigo', scope)
        const { data, error } = await q
        if (error) throw error
        if (!vivo) return
        const rows = data || []
        setCabs(rows)
        const anios = [...new Set(rows.map(c => anioDe(fechaEf(c))).filter(Boolean))]
        if (anios.length && !anios.includes(new Date().getFullYear())) setAnio(Math.max(...anios))
        if (scope && scope.length === 1) setSuc(scope[0])
        let qr = supabase.from('v_log_cat_riesgo').select('*')
        if (scope) qr = qr.in('sucursal_codigo', scope)
        const r = await qr
        if (vivo) setRiesgo(r.data || [])
      } catch (e) { if (vivo) { setErr(e.message); setCabs([]) } }
    })()
    return () => { vivo = false }
    // eslint-disable-next-line
  }, [scopeKey])

  // Detalles del año seleccionado (se guardan en caché por año)
  useEffect(() => {
    if (!cabs || cache[anio]) return
    const ids = cabs.filter(c => anioDe(fechaEf(c)) === anio).map(c => c.id)
    if (!ids.length) { setCache(p => ({...p, [anio]:[]})); return }
    setCarg(true)
    fetchDetalles(ids)
      .then(d => setCache(p => ({...p, [anio]:d})))
      .catch(e => setErr(e.message))
      .finally(() => setCarg(false))
    // eslint-disable-next-line
  }, [cabs, anio])

  // Ventas netas del año por SKU y tienda (para precio de venta y merma sobre venta)
  useEffect(() => {
    if (!puedeVerCostos || ventas[anio]) return
    let vivo = true
    ;(async () => {
      let all = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('inv_ventas_mes')
          .select('sku,sucursal_id,periodo,qty_neta,neto_neto').like('periodo', `${anio}-%`)
          .order('id').range(from, from + 999)
        if (error) break
        all = all.concat(data || [])
        if (!data || data.length < 1000) break
      }
      if (vivo) setVentas(p => ({...p, [anio]:all}))
    })()
    return () => { vivo = false }
    // eslint-disable-next-line
  }, [anio, puedeVerCostos])

  const cabIdx = useMemo(() => Object.fromEntries((cabs || []).map(c => [c.id, c])), [cabs])
  const padreDe = s => sucs.find(x => x.codigo === s)?.codigo_padre || s
  const ventasAnio = ventas[anio] || []
  const precios = useMemo(() => {
    const porSuc = {}, glob = {}
    ventasAnio.forEach(r => {
      const s = ERP2LOG[r.sucursal_id], q = Number(r.qty_neta) || 0, n = Number(r.neto_neto) || 0
      if (!s || q <= 0 || n <= 0) return
      const k = `${s}|${r.sku}`
      ;(porSuc[k] = porSuc[k] || {q:0, n:0}); porSuc[k].q += q; porSuc[k].n += n
      ;(glob[r.sku] = glob[r.sku] || {q:0, n:0}); glob[r.sku].q += q; glob[r.sku].n += n
    })
    const m = new Map(), g = new Map()
    Object.entries(porSuc).forEach(([k, x]) => m.set(k, x.n / x.q))
    Object.entries(glob).forEach(([k, x]) => g.set(k, x.n / x.q))
    return {m, g}
  }, [ventasAnio])
  // Precio de venta de una línea: el de su tienda; si no lo vendió, el promedio de las demás
  const precioDe = d => {
    const s = padreDe(cabIdx[d.inventario_id]?.sucursal_codigo)
    const p = precios.m.get(`${s}|${d.sku}`) ?? precios.g.get(d.sku)
    return p === undefined ? null : p
  }
  const hayVentas = puedeVerCostos && precios.g.size > 0
  const nombreSuc = k => sucs.find(s => s.codigo === k)?.nombre || cabs?.find(c => c.sucursal_codigo === k)?.sucursal_nombre || k
  const sucsDisp = useMemo(() => [...new Set((cabs || []).map(c => c.sucursal_codigo))]
    .map(k => ({k, l:nombreSuc(k)})).sort((a, b) => a.l.localeCompare(b.l)),
    // eslint-disable-next-line
    [cabs, sucs])
  const aniosDisp = useMemo(() => [...new Set((cabs || []).map(c => anioDe(fechaEf(c))).filter(Boolean))]
    .sort((a, b) => b - a), [cabs])

  const detsAnio = cache[anio] || []
  const sig = `${anio}|${suc}|${tipo}|${periodo}|${detsAnio.length}|${(cabs || []).length}|${ventasAnio.length}`

  // Todo el cómputo del período en un solo lugar
  const D = useMemo(() => {
    const base = c => anioDe(fechaEf(c)) === anio && (suc === 'todas' || c.sucursal_codigo === suc) &&
                      (tipo === 'todos' || c.tipo_inventario === tipo)
    const cabsA = (cabs || []).filter(base)
    const cabsP = cabsA.filter(c => enPeriodo(fechaEf(c), periodo))
    const pPrev = periodoAnterior(periodo)
    const cabsPrev = pPrev ? cabsA.filter(c => enPeriodo(fechaEf(c), pPrev)) : []
    const setA = new Set(cabsA.map(c => c.id)), setP = new Set(cabsP.map(c => c.id)), setPr = new Set(cabsPrev.map(c => c.id))
    const detsA = detsAnio.filter(d => setA.has(d.inventario_id))
    const detsP = detsA.filter(d => setP.has(d.inventario_id))
    const detsPr = detsA.filter(d => setPr.has(d.inventario_id))
    const abc = clasificarABC(detsAnio, cabIdx)
    const M = calcular(detsP, abc, cabIdx, precioDe)
    const Mprev = pPrev && detsPr.length ? calcular(detsPr, abc, cabIdx, precioDe) : null
    const sucOf = d => cabIdx[d.inventario_id]?.sucursal_codigo
    const porSuc = Object.entries(agrupar(detsP, sucOf)).map(([k, ds]) => ({k, ...calcular(ds, abc, cabIdx, precioDe),
      invs:cabsP.filter(c => c.sucursal_codigo === k).length,
      ultimo:(cabs || []).filter(c => c.sucursal_codigo === k).map(fechaEf).sort().pop()}))
    const porCat = Object.entries(agrupar(detsP, d => d.tipo_producto || 'Sin categoría'))
      .map(([k, ds]) => ({k, ...calcular(ds, abc, cabIdx, precioDe)}))
    const cruces = detectarCruces(detsP)
    const crPorInv = agrupar(cruces.grupos, g => g.inv)
    const porInv = cabsP.map(c => {
      const ds = detsP.filter(d => d.inventario_id === c.id)
      const m = calcular(ds, abc, cabIdx, precioDe)
      const cr = crPorInv[c.id] || []
      return {cab:c, ...m, nota:calificar(m, acuerdoContadores(ds)), crucesN:cr.length,
              crucesVal:cr.reduce((s, g) => s + g.valFalt, 0)}
    }).sort((a, b) => (fechaEf(b.cab) || '').localeCompare(fechaEf(a.cab) || ''))
    // Impacto por SKU en el período
    const skuImp = {}
    detsP.forEach(d => {
      if (d.stock_fisico === null || d.stock_fisico === undefined) return
      const dif = Number(d.diferencia) || 0; if (!dif) return
      const k = `${sucOf(d)}|${d.sku}`
      const c = costoDe(d)
      const s = skuImp[k] || (skuImp[k] = {k, sku:d.sku, producto:d.producto, cat:d.tipo_producto, suc:sucOf(d),
        dif:0, abs:0, imp:0, impAbs:0, impVentaAbs:0, veces:0, costo:c})
      s.dif += dif; s.abs += Math.abs(dif); s.veces++
      if (c !== null) { s.imp += dif * c; s.impAbs += Math.abs(dif * c) }
      const pv = precioDe(d) ?? c
      if (pv !== null) s.impVentaAbs += Math.abs(dif * pv)
    })
    const topSku = Object.values(skuImp).sort((a, b) => b.impAbs - a.impAbs)
    const top10Share = M.descuadre > 0 ? topSku.slice(0, 10).reduce((s, x) => s + x.impAbs, 0) / M.descuadre * 100 : null
    // Reincidentes en el año (misma bodega, dos o más conteos con diferencia)
    const reinc = {}
    detsA.forEach(d => {
      if (d.stock_fisico === null || d.stock_fisico === undefined) return
      if (Math.round(Number(d.diferencia) || 0) === 0) return
      const k = `${sucOf(d)}|${d.sku}`
      const r = reinc[k] || (reinc[k] = {k, sku:d.sku, producto:d.producto, cat:d.tipo_producto, suc:sucOf(d),
        invs:new Set(), abs:0, neto:0, impAbs:0})
      r.invs.add(d.inventario_id); r.abs += Math.abs(Number(d.diferencia)); r.neto += Number(d.diferencia)
      const c = costoDe(d); if (c !== null) r.impAbs += Math.abs(Number(d.diferencia) * c)
    })
    const reincidentes = Object.values(reinc).filter(r => r.invs.size >= 2)
      .map(r => ({...r, veces:r.invs.size})).sort((a, b) => b.veces - a.veces || b.impAbs - a.impAbs)
    // Series mensuales del año
    const mesOf = d => mesDe(fechaEf(cabIdx[d.inventario_id]))
    const porMes = {}
    Object.entries(agrupar(detsA, mesOf)).forEach(([m, ds]) => { porMes[m] = calcular(ds, abc, cabIdx, precioDe) })
    // Distribución del error relativo
    const buckets = [
      {k:'exacto', l:'Exacto (0)', n:0, c:IV.verde},
      {k:'b2',  l:'Hasta 2%',   n:0, c:IV.verde},
      {k:'b5',  l:'2% a 5%',    n:0, c:IV.ambar},
      {k:'b10', l:'5% a 10%',   n:0, c:IV.ambar},
      {k:'b25', l:'10% a 25%',  n:0, c:IV.rojo},
      {k:'bmx', l:'Más de 25%', n:0, c:IV.rojo},
    ]
    detsP.forEach(d => {
      if (d.stock_fisico === null || d.stock_fisico === undefined) return
      const dif = Math.abs(Number(d.diferencia) || 0)
      if (Math.round(dif) === 0) { buckets[0].n++; return }
      const r = dif / Math.max(Number(d.stock_sistema) || 0, 1)
      buckets[r <= 0.02 ? 1 : r <= 0.05 ? 2 : r <= 0.10 ? 3 : r <= 0.25 ? 4 : 5].n++
    })
    const ventaSuc = {}
    ventasAnio.forEach(r => {
      const s = ERP2LOG[r.sucursal_id]; if (!s) return
      if (!enPeriodo(`${r.periodo}-01`, periodo)) return
      if (suc !== 'todas' && padreDe(suc) !== s) return
      if (scope && !scope.some(x => padreDe(x) === s)) return
      ventaSuc[s] = (ventaSuc[s] || 0) + (Number(r.neto_neto) || 0)
    })
    return {cabsA, cabsP, detsA, detsP, abc, M, Mprev, pPrev, ventaSuc, cruces, porSuc, porCat, porInv, topSku, top10Share,
            reincidentes, porMes, buckets}
    // eslint-disable-next-line
  }, [sig, cabIdx])

  const cobRiesgo = useMemo(() => riesgo.filter(r => suc === 'todas' || r.sucursal_codigo === suc), [riesgo, suc])

  const TABS = [
    {k:'resumen',   l:'RESUMEN'},
    {k:'valor',     l:'RESULTADO',    r:!puedeVerCostos},
    {k:'inventarios', l:'INVENTARIOS'},
    {k:'exactitud', l:'EXACTITUD'},
    {k:'cobertura', l:'COBERTURA'},
    {k:'tendencia', l:'TENDENCIA'},
    {k:'abc',       l:'CLASE ABC',    r:!puedeVerCostos},
    {k:'comparar',  l:'COMPARAR'},
    {k:'bono',      l:'BONO TRIMESTRAL', r:!puedeVerBono},
  ].filter(t => !t.r)

  const ctx = {D, cabs:cabs || [], cabIdx, nombreSuc, sucsDisp, puedeVerCostos, setTab, setSuc, setPeriodo,
               anio, suc, periodo, tipo, riesgo:cobRiesgo, detsAnio, onPdfTrimestral, scope,
               ventaSuc:D.ventaSuc, padreDe, hayVentas, cu, sucs, ficha, setFicha,
               abrirFicha:id => { setFicha(id); setTab('inventarios') }}

  const sinFiltrosPropios = !['comparar','bono'].includes(tab) && !(tab === 'inventarios' && ficha)
  const contexto = `${suc === 'todas' ? (scope ? 'Mi alcance' : 'Todas las bodegas') : nombreSuc(suc)} · ${anio} · ` +
    `${labelPeriodo(periodo)} · ${tipo === 'todos' ? 'Cíclicos y generales' : tipo === 'CICLICO' ? 'Cíclicos' : 'Generales'}`

  return (
    <div style={embedded ? {padding:0} : css.body}>
      {!embedded && (
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:12}}>
          <div>
            <div style={{fontSize:10.5, fontWeight:700, letterSpacing:1.2, color:IV.slate, textTransform:'uppercase'}}>
              Logística · Inventario</div>
            <div style={{fontSize:21, fontWeight:800, color:IV.ink, letterSpacing:-0.3, marginTop:2}}>Análisis de inventario</div>
          </div>
          {onBack && <button onClick={onBack} style={btn('ghost')}>← VOLVER</button>}
        </div>
      )}

      {/* ── Filtros globales ── */}
      {sinFiltrosPropios && (
        <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:10}}>
          {!(scope && scope.length === 1) && (
            <select style={inp(170)} value={suc} onChange={e => setSuc(e.target.value)}>
              <option value="todas">{scope ? 'Todas mis bodegas' : 'Todas las bodegas'}</option>
              {sucsDisp.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
            </select>
          )}
          <select style={inp(90)} value={anio} onChange={e => { setAnio(Number(e.target.value)); setPeriodo('anio') }}>
            {(aniosDisp.length ? aniosDisp : [anio]).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select style={inp(150)} value={periodo} onChange={e => setPeriodo(e.target.value)}>
            <option value="anio">Año completo</option>
            <optgroup label="Trimestre">
              {[1,2,3,4].map(q => <option key={q} value={`Q${q}`}>{labelPeriodo(`Q${q}`)}</option>)}
            </optgroup>
            <optgroup label="Mes">
              {MES.map((m, i) => <option key={m} value={`M${i + 1}`}>{m}</option>)}
            </optgroup>
          </select>
          <Seg valor={tipo} onChange={setTipo} opciones={[
            {k:'todos', l:'TODOS'}, {k:'CICLICO', l:'CÍCLICOS'}, {k:'GENERAL', l:'GENERALES'}]}/>
          <div style={{marginLeft:'auto', fontSize:11, color:IV.slate, textAlign:'right'}}>
            {cargando ? 'Cargando detalle…' : <>
              <strong style={{color:IV.ink}}>{fmtN(D.cabsP.length)}</strong> inventarios ·{' '}
              <strong style={{color:IV.ink}}>{fmtN(D.M.contadas)}</strong> líneas contadas
            </>}
          </div>
        </div>
      )}
      {sinFiltrosPropios && (
        <div style={{fontSize:11, color:IV.slate, marginBottom:12}}>
          {contexto} · <span style={{color:IV.verde, fontWeight:700}}>excluye inventarios de prueba</span>
        </div>
      )}

      {/* ── Pestañas ── */}
      <div style={{display:'flex', gap:22, borderBottom:`1px solid ${IV.line}`, marginBottom:16, flexWrap:'wrap'}}>
        {TABS.map(t => (
          <div key={t.k} onClick={() => { setTab(t.k); if (t.k !== 'inventarios') setFicha(null) }} style={{padding:'7px 2px 8px', cursor:'pointer', fontSize:11,
            fontWeight:700, letterSpacing:0.7, whiteSpace:'nowrap', userSelect:'none',
            color:tab === t.k ? IV.ink : IV.slate, marginBottom:-1,
            borderBottom:tab === t.k ? `2px solid ${IV.navy}` : '2px solid transparent'}}>{t.l}</div>
        ))}
      </div>

      {err && (
        <div style={{padding:'8px 12px', marginBottom:12, borderRadius:3, background:IV.tRojo,
          borderLeft:`3px solid ${IV.rojo}`, fontSize:12, color:IV.rojo, fontWeight:600}}>{err}</div>
      )}

      {cabs === null ? <Vacio t="Cargando análisis…"/>
        : cabs.length === 0 ? <Vacio t="Sin inventarios cerrados" s="Cierra al menos un inventario para ver el análisis."/>
        : (<>
          {tab === 'resumen'   && <TabResumen   {...ctx}/>}
          {tab === 'inventarios' && <TabInventarios {...ctx}/>}
          {tab === 'exactitud' && <TabExactitud {...ctx}/>}
          {tab === 'valor'     && <TabResultado {...ctx}/>}
          {tab === 'cobertura' && <TabCobertura {...ctx}/>}
          {tab === 'tendencia' && <TabTendencia {...ctx}/>}
          {tab === 'abc'       && <TabABC       {...ctx}/>}
          {tab === 'comparar'  && <TabComparar  {...ctx}/>}
          {tab === 'bono'      && <TabBono      {...ctx}/>}
        </>)}
    </div>
  )
}

// Merma sobre venta: solo tiendas (el CD no tiene venta propia comparable)
export function mermaSobreVenta(D, padreDe) {
  const t = D.porSuc.filter(s => padreDe(s.k) !== 'cd_mp')
  const venta = [...new Set(t.map(s => padreDe(s.k)))].reduce((s, k) => s + (D.ventaSuc?.[k] || 0), 0)
  const perd = t.reduce((s, x) => s + x.perdNeta, 0)
  return venta > 0 ? {pct:perd / venta * 100, venta, perd} : null
}

// ═══════════════════════════════════════════════════════════════════════════
// Diagnóstico automático
// ═══════════════════════════════════════════════════════════════════════════
export function diagnosticar(D, riesgo, puedeVerCostos, nombreSuc, extra = {}) {
  const H = [], M = D.M
  if (M.eri !== null) {
    const sev = M.eri < 70 ? 'rojo' : M.eri < 90 ? 'ambar' : 'verde'
    H.push({sev, tab:'exactitud',
      t: sev === 'verde' ? `Exactitud sobre la meta: ${fmtP(M.eri)} de las líneas cuadran`
       : `Exactitud ${sev === 'rojo' ? 'crítica' : 'bajo la meta'}: ${fmtP(M.eri)} de las líneas cuadran`,
      d: `Meta 90% · clase mundial 95%. Con tolerancia ABC sube a ${fmtP(M.eriTol)}.`})
  }
  const cats = D.porCat.filter(c => c.contadas >= 15 && c.eri !== null).sort((a, b) => a.eri - b.eri)
  if (cats.length >= 2 && M.eri !== null && cats[0].eri < M.eri - 10)
    H.push({sev:cats[0].eri < 70 ? 'rojo' : 'ambar', tab:'exactitud',
      t:`Categoría más débil: ${cats[0].k} (${fmtP(cats[0].eri)})`,
      d:`${fmtN(cats[0].contadas - cats[0].cuadran)} de ${fmtN(cats[0].contadas)} líneas con diferencia.`})
  const sucsOk = D.porSuc.filter(s => s.contadas >= 15 && s.eri !== null).sort((a, b) => a.eri - b.eri)
  if (sucsOk.length >= 2 && sucsOk[sucsOk.length - 1].eri - sucsOk[0].eri >= 10)
    H.push({sev:'ambar', tab:'exactitud',
      t:`Brecha entre bodegas: ${nombreSuc(sucsOk[0].k)} ${fmtP(sucsOk[0].eri)} vs ${nombreSuc(sucsOk[sucsOk.length - 1].k)} ${fmtP(sucsOk[sucsOk.length - 1].eri)}`,
      d:'Misma empresa, mismo sistema: la diferencia es de proceso.'})
  if (M.faltN + M.sobrN >= 20 && M.sesgo !== null) {
    if (M.sesgo >= 70)
      H.push({sev:'rojo', tab:'exactitud', t:`Predominan faltantes (${fmtP(M.sesgo, 0)} de las diferencias)`,
        d:'Patrón de pérdida real, no de error de registro. Revisar mermas no declaradas y despachos sin documento.'})
    else if (M.sesgo >= 40 && M.sesgo <= 60)
      H.push({sev:'ambar', tab:'exactitud', t:'Faltantes y sobrantes se compensan',
        d:'Indica producto registrado en el SKU equivocado más que pérdida. El neto puede verse bien con el registro desordenado.'})
  }
  if (puedeVerCostos && M.pctPerd !== null && M.pctPerd > 1)
    H.push({sev:'rojo', tab:'valor', t:`Pérdida neta de ${fmtP(M.pctPerd, 2)} del valor contado`,
      d:`${fmtCLP(M.perdNeta)}. Supera el 1% que bloquea el bono.`})
  if (D.cruces && D.cruces.grupos.length) {
    const pct = M.faltVal > 0 ? D.cruces.valFalt / M.faltVal * 100 : null
    H.push({sev:pct !== null && pct >= 20 ? 'rojo' : 'ambar', tab:'valor',
      t: puedeVerCostos && pct !== null
        ? `${fmtP(pct, 0)} de la pérdida no es pérdida: ${D.cruces.grupos.length} cruces de código`
        : `${D.cruces.grupos.length} cruces de código detectados en los conteos`,
      d:`${fmtN(D.cruces.uds)} unidades faltantes aparecen como sobrantes de productos hermanos${puedeVerCostos ? ` (${fmtCLP(D.cruces.valFalt)})` : ''}. Se corrige reclasificando en BSALE, no ajustando.`})
  }
  if (puedeVerCostos && extra.mv && extra.mv.pct > 1)
    H.push({sev:extra.mv.pct > 1.6 ? 'rojo' : 'ambar', tab:'valor',
      t:`Merma sobre venta de ${fmtP(extra.mv.pct, 2)} en tiendas`,
      d:`${fmtCLP(extra.mv.perd)} perdidos sobre ${fmtM(extra.mv.venta)} vendidos. La referencia retail es 1,4–1,6%.`})
  if (puedeVerCostos && extra.hayVentas && M.faltVal > 0 && M.faltVenta / M.faltVal >= 1.3)
    H.push({sev:'info', tab:'valor',
      t:`A precio de venta la pérdida sube a ${fmtM(M.faltVenta)}`,
      d:`${(M.faltVenta / M.faltVal).toFixed(1).replace('.', ',')} veces lo que se pierde a costo: es lo que se deja de vender.`})
  if (puedeVerCostos && M.compens !== null && M.compens >= 70 && M.faltVal > 0)
    H.push({sev:'ambar', tab:'valor',
      t:`La ganancia compensa el ${fmtP(M.compens, 0)} de la pérdida`,
      d:'El balance se ve sano porque el producto está, pero en otro código o ubicación. El costo real es de control, no de plata.'})
  if (puedeVerCostos && D.top10Share !== null && D.top10Share >= 50)
    H.push({sev:'ambar', tab:'valor', t:`10 SKUs explican el ${fmtP(D.top10Share, 0)} del descuadre valorizado`,
      d:'El problema está concentrado: atacar esos productos mueve el indicador completo.'})
  if (D.reincidentes.length >= 5)
    H.push({sev:'ambar', tab:'tendencia', t:`${fmtN(D.reincidentes.length)} SKUs con diferencia en dos o más conteos del año`,
      d:'Cuando un error se repite no es de conteo: es de ubicación, de unidad de medida o de proceso.'})
  const viejas = riesgo.filter(r => r.dias_sin_inventario === null || r.dias_sin_inventario > 180).length
  if (viejas > 0)
    H.push({sev:'ambar', tab:'cobertura', t:`${fmtN(viejas)} categorías sin contar hace más de 180 días o nunca`,
      d:'Sin conteo reciente no hay forma de saber si el stock del sistema es real.'})
  if (puedeVerCostos && (M.sinCosto + M.outliers) > 0)
    H.push({sev:'info', tab:'valor', t:`${fmtN(M.sinCosto + M.outliers)} líneas sin costo válido`,
      d:`${fmtN(M.sinCosto)} sin costo y ${fmtN(M.outliers)} con costo corrupto (> $1M) quedan fuera de la valorización.`})
  const orden = {rojo:0, ambar:1, info:2, verde:3}
  return H.sort((a, b) => orden[a.sev] - orden[b.sev]).slice(0, 7)
}

// ═══════════════════════════════════════════════════════════════════════════
// RESUMEN
// ═══════════════════════════════════════════════════════════════════════════
export function TabResumen({D, riesgo, puedeVerCostos, nombreSuc, setTab, setSuc, setPeriodo, anio, suc, periodo, padreDe, hayVentas}) {
  const M = D.M, P = D.Mprev
  if (!D.cabsP.length) return <Vacio t="Sin inventarios en el período" s="Ajusta bodega, año, período o tipo."/>
  const mv = puedeVerCostos && padreDe ? mermaSobreVenta(D, padreDe) : null
  const hall = diagnosticar(D, riesgo, puedeVerCostos, nombreSuc, {mv, hayVentas})
  const noCuadran = M.eri === null ? null : Math.round((100 - M.eri) / 10)
  const titular = puedeVerCostos && M.valorSis > 0
    ? `${labelPeriodo(periodo)} ${anio}: se contaron ${fmtM(M.valorSis)} de inventario en ${D.cabsP.length} inventarios. Se perdieron ${fmtM(M.faltVal)}, aparecieron ${fmtM(M.sobrVal)}, balance ${fmtSM(M.balance)}.`
    : `${labelPeriodo(periodo)} ${anio}: se contaron ${fmtN(M.contadas)} líneas en ${D.cabsP.length} inventarios.`
  const bajada = M.eri === null ? '' :
    `${fmtP(M.eri, 0)} de las líneas cuadra exacto${noCuadran ? `: ${noCuadran} de cada 10 no` : ''}. ` +
    (puedeVerCostos && M.compens !== null && M.compens >= 70 ? 'La pérdida y la ganancia casi se anulan, así que el problema es de registro más que de plata.'
      : puedeVerCostos && M.compens !== null && M.compens < 35 ? 'Predomina la pérdida real sobre el error de registro.'
      : M.eri >= 90 ? 'El registro está sobre la meta.' : 'El registro está bajo la meta del 90%.')
  const cSev = {rojo:IV.rojo, ambar:IV.ambar, verde:IV.verde, info:IV.azul}
  const viejas = riesgo.filter(r => r.dias_sin_inventario === null || r.dias_sin_inventario > 180).length
  const maxMesL = Math.max(1, ...Object.values(D.porMes).map(m => m.contadas))
  const puertas = [
    ...(puedeVerCostos ? [{k:'valor', t:'Resultado', d:'Pérdida, ganancia y balance, a costo y a venta', v:fmtSM(M.balance), c:M.balance < 0 ? IV.rojo : IV.verde}] : []),
    {k:'inventarios', t:'Inventarios', d:'La ficha de cada conteo, con su calificación', v:`${fmtN(D.porInv.length)} conteos`, c:IV.navy},
    {k:'exactitud', t:'Exactitud', d:'ERI, distribución del error y sesgo', v:fmtP(M.eri), c:semERI(M.eri)},
    {k:'cobertura', t:'Cobertura', d:'Qué categorías llevan tiempo sin contarse', v:`${fmtN(viejas)} críticas`, c:viejas ? IV.ambar : IV.verde},
    {k:'tendencia', t:'Tendencia', d:'Evolución mensual y SKUs reincidentes', v:`${fmtN(D.reincidentes.length)} reincid.`, c:D.reincidentes.length ? IV.ambar : IV.verde},
    ...(puedeVerCostos ? [{k:'abc', t:'Clase ABC', d:'Exactitud en lo que más vale', v:'A · B · C', c:IV.navy}] : []),
    {k:'comparar', t:'Comparar', d:'Dos conteos del mismo alcance, SKU a SKU', v:'2 conteos', c:IV.navy},
  ]
  const maxRes = Math.max(1, M.faltVal, M.sobrVal, Math.abs(M.balance))
  return (<>
    <div style={{border:`1px solid ${IV.line}`, borderLeft:`4px solid ${IV.navy}`, borderRadius:4, background:'#fff',
      padding:'14px 18px', marginBottom:14}}>
      <div style={{fontSize:17, fontWeight:800, color:IV.ink, letterSpacing:-0.3, lineHeight:1.35}}>{titular}</div>
      {bajada && <div style={{fontSize:12.5, color:IV.slate, marginTop:6, lineHeight:1.55}}>{bajada}</div>}
    </div>
    <Strip>
      <Kpi l="ERI estricto" v={fmtP(M.eri)} c={semERI(M.eri)} s="meta ≥ 90%"
        delta={P && M.eri !== null && P.eri !== null ? M.eri - P.eri : null} onClick={() => setTab('exactitud')}/>
      <Kpi l="ERI con tolerancia" v={fmtP(M.eriTol)} c={semERI(M.eriTol)} s="A ±0 · B ±2% · C ±5%"/>
      {puedeVerCostos && <Kpi l="Exactitud valorizada" v={fmtP(M.exactVal)} c={semERI(M.exactVal)} s="100 − descuadre bruto"/>}
      {puedeVerCostos && <Kpi l="Pérdida neta" v={fmtP(M.pctPerd, 2)} c={semPerd(M.pctPerd)} s={fmtCLP(M.perdNeta)} inv
        delta={P && M.pctPerd !== null && P.pctPerd !== null ? M.pctPerd - P.pctPerd : null} onClick={() => setTab('valor')}/>}
      {puedeVerCostos && <Kpi l="Descuadre bruto" v={fmtP(M.pctDesc, 2)} c={semDesc(M.pctDesc)} s={fmtCLP(M.descuadre)}/>}
      {mv && <Kpi l="Merma sobre venta" v={fmtP(mv.pct, 2)} c={semPerd(mv.pct)} s="tiendas · retail 1,4–1,6%" onClick={() => setTab('valor')}/>}
      <Kpi l="Sesgo" v={fmtP(M.sesgo, 0)} c={IV.ink} s="de las diferencias son faltantes"/>
    </Strip>
    {D.pPrev && P && <div style={{fontSize:11, color:IV.slate, margin:'-8px 0 14px'}}>Variación contra {labelPeriodo(D.pPrev)}.</div>}

    <div style={{display:'grid', gridTemplateColumns:'minmax(0,1.25fr) minmax(0,1fr)', gap:18, alignItems:'start'}}>
      <div>
        <Seccion titulo="Diagnóstico del período" sub="generado a partir de los datos">
          <Caja>
            {hall.length === 0 ? <div style={{padding:16, fontSize:12.5, color:IV.slate}}>Sin hallazgos relevantes.</div>
              : hall.map((h, i) => (
              <div key={i} onClick={() => setTab(h.tab)} style={{display:'flex', gap:12, padding:'10px 14px',
                cursor:'pointer', borderBottom:i < hall.length - 1 ? `1px solid ${IV.lineSoft}` : 'none',
                boxShadow:`inset 3px 0 0 ${cSev[h.sev]}`}}>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:12.5, fontWeight:700, color:h.sev === 'info' ? IV.ink : cSev[h.sev]}}>{h.t}</div>
                  <div style={{fontSize:11.5, color:IV.slate, marginTop:2, lineHeight:1.5}}>{h.d}</div>
                </div>
                <div style={{fontSize:10.5, fontWeight:700, color:IV.azul, alignSelf:'center', whiteSpace:'nowrap'}}>VER →</div>
              </div>
            ))}
          </Caja>
        </Seccion>

        {D.porSuc.length > 0 && (
          <Seccion titulo="Por bodega" sub={suc === 'todas' ? 'clic para filtrar' : null}>
            <Caja>
              <table style={{width:'100%', borderCollapse:'collapse', minWidth:560}}>
                <thead><tr>
                  <th style={th()}>Bodega</th><th style={th(true)}>Inv.</th><th style={th(true)}>Líneas</th>
                  <th style={th(true)}>ERI</th>{puedeVerCostos && <th style={th(true)}>Pérdida neta</th>}
                  <th style={th(true)}>Último conteo</th>
                </tr></thead>
                <tbody>{D.porSuc.sort((a, b) => (a.eri ?? 0) - (b.eri ?? 0)).map(s => (
                  <tr key={s.k} onClick={() => setSuc(s.k)} style={{cursor:'pointer'}}>
                    <td style={td(false, {fontWeight:700})}>{nombreSuc(s.k)}</td>
                    <td style={td(true)}>{s.invs}</td>
                    <td style={td(true)}>{fmtN(s.contadas)}</td>
                    <td style={td(true)}>
                      <span style={{display:'inline-flex', alignItems:'center', gap:8}}>
                        <Barra pct={s.eri} c={semERI(s.eri)} w={50}/>
                        <strong style={{color:semERI(s.eri), minWidth:44, textAlign:'right'}}>{fmtP(s.eri)}</strong>
                      </span>
                    </td>
                    {puedeVerCostos && <td style={td(true, {color:semPerd(s.pctPerd), fontWeight:700})}>{fmtP(s.pctPerd, 2)}</td>}
                    <td style={td(true, {color:IV.slate})}>{s.ultimo || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Caja>
          </Seccion>
        )}
      </div>

      <div>
        {puedeVerCostos && M.valorSis > 0 && (
          <Seccion titulo="Resultado del período" sub="a costo" accion="ABRIR" onAccion={() => setTab('valor')}>
            <Caja pad="12px 14px">
              {[['Pérdida', -M.faltVal, IV.rojo], ['Ganancia', M.sobrVal, IV.verde], ['Balance', M.balance, M.balance < 0 ? IV.rojo : IV.verde]].map(([l, v, c]) => (
                <div key={l} style={{display:'flex', alignItems:'center', gap:10, padding:'4px 0'}}>
                  <div style={{fontSize:12, minWidth:64, fontWeight:l === 'Balance' ? 800 : 600, color:IV.ink}}>{l}</div>
                  <div style={{flex:1, height:l === 'Balance' ? 14 : 11, background:IV.lineSoft, borderRadius:2, overflow:'hidden'}}>
                    <div style={{width:`${Math.abs(v) / maxRes * 100}%`, height:'100%', background:c, opacity:l === 'Balance' ? 1 : 0.82}}/>
                  </div>
                  <div style={{fontSize:12.5, fontWeight:800, color:c, minWidth:78, textAlign:'right', fontVariantNumeric:'tabular-nums'}}>{fmtSM(v)}</div>
                </div>
              ))}
              {hayVentas && M.faltVal > 0 && (
                <div style={{fontSize:11, color:IV.slate, marginTop:6}}>
                  A precio de venta la pérdida es {fmtM(M.faltVenta)} ({(M.faltVenta / M.faltVal).toFixed(1).replace('.', ',')}× el costo).
                </div>
              )}
            </Caja>
          </Seccion>
        )}
        <Seccion titulo={`Exactitud mes a mes · ${anio}`} sub="clic en un mes para verlo">
          <Caja pad="14px 14px 10px">
            <div style={{display:'flex', alignItems:'flex-end', gap:6, height:130}}>
              {MES.map((m, i) => {
                const x = D.porMes[i + 1]
                const h = x?.eri !== null && x?.eri !== undefined ? Math.max(4, x.eri * 1.1) : 0
                return (
                  <div key={m} onClick={() => x && setPeriodo(`M${i + 1}`)} title={x ? `${m}: ERI ${fmtP(x.eri)} · ${fmtN(x.contadas)} líneas` : `${m}: sin conteos`}
                    style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3,
                      cursor:x ? 'pointer' : 'default', height:'100%', justifyContent:'flex-end'}}>
                    {x && <div style={{fontSize:9.5, fontWeight:700, color:semERI(x.eri)}}>{Math.round(x.eri)}</div>}
                    <div style={{width:'100%', maxWidth:26, height:h, background:x ? semERI(x.eri) : 'transparent',
                      borderRadius:'2px 2px 0 0', opacity:x ? 0.85 : 1}}/>
                    <div style={{width:'100%', maxWidth:26, height:3, background:IV.navy,
                      opacity:x ? Math.max(0.15, x.contadas / maxMesL) : 0.06}}/>
                  </div>
                )
              })}
            </div>
            <div style={{display:'flex', gap:6, marginTop:4}}>
              {MES.map(m => <div key={m} style={{flex:1, textAlign:'center', fontSize:9.5, color:IV.slate}}>{m}</div>)}
            </div>
            <div style={{fontSize:10.5, color:IV.slate, marginTop:8}}>
              Barra: ERI del mes. Línea inferior: intensidad = líneas contadas.
            </div>
          </Caja>
        </Seccion>

        <Seccion titulo="Profundizar">
          <div style={{display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:8}}>
            {puertas.map(p => (
              <div key={p.k} onClick={() => setTab(p.k)} style={{border:`1px solid ${IV.line}`, borderRadius:4,
                background:'#fff', padding:'11px 13px', cursor:'pointer', boxShadow:`inset 0 3px 0 ${p.c}`}}>
                <div style={{display:'flex', alignItems:'baseline', gap:6}}>
                  <div style={{fontSize:12.5, fontWeight:800, color:IV.ink}}>{p.t}</div>
                  <div style={{marginLeft:'auto', fontSize:11.5, fontWeight:800, color:p.c, whiteSpace:'nowrap'}}>{p.v}</div>
                </div>
                <div style={{fontSize:11, color:IV.slate, marginTop:3, lineHeight:1.45}}>{p.d}</div>
              </div>
            ))}
          </div>
        </Seccion>
      </div>
    </div>

    <Guia titulo="METODOLOGÍA Y DEFINICIONES">
      <strong>Todas las pestañas usan las mismas definiciones</strong>, así que un número significa lo mismo donde aparezca.
      <div style={{marginTop:8}}><strong>ERI estricto</strong> (Exactitud del Registro de Inventario): líneas cuya diferencia es cero sobre líneas contadas. Meta 90%; clase mundial 95%.</div>
      <div style={{marginTop:6}}><strong>ERI con tolerancia ABC</strong>: acepta como correcta una diferencia pequeña según el valor del producto — cero en clase A, hasta 2% del stock en B y hasta 5% en C. Es la forma estándar de medir conteo cíclico, porque no todas las diferencias pesan lo mismo.</div>
      <div style={{marginTop:6}}><strong>Pérdida neta %</strong>: faltantes menos sobrantes, valorizados, sobre el valor del sistema. Es el número que importa para resultados.</div>
      <div style={{marginTop:6}}><strong>Descuadre bruto %</strong>: faltantes más sobrantes, sin compensar. Mide el desorden del registro: la pérdida neta puede dar cero con la mitad del stock mal anotado.</div>
      <div style={{marginTop:6}}><strong>Exactitud valorizada</strong>: 100 menos el descuadre bruto. Es el ERI ponderado por plata.</div>
      <div style={{marginTop:6}}><strong>Sesgo</strong>: qué parte de las diferencias son faltantes. Cerca de 50% indica error de identificación; sobre 70%, pérdida real.</div>
      <div style={{marginTop:6}}><strong>Pérdida, ganancia y balance</strong>: faltantes valorizados, sobrantes valorizados y la diferencia entre ambos. El balance negativo es plata que salió del inventario sin registro.</div>
      <div style={{marginTop:6}}><strong>Compensación</strong>: qué parte de la pérdida la cubre la ganancia. Alta significa error de registro; baja, pérdida real.</div>
      <div style={{marginTop:6}}><strong>Merma sobre venta</strong>: pérdida neta sobre venta neta del período, solo tiendas. Es el indicador con que se compara el retail en el mundo (referencia 1,4–1,6%).</div>
      <div style={{marginTop:6}}><strong>A precio de venta</strong>: la misma pérdida valorizada al precio neto promedio con que se vendió cada SKU en el año. Es lo que se deja de vender.</div>
      <div style={{marginTop:8, paddingTop:8, borderTop:`1px solid ${IV.line}`}}>
        Solo inventarios cerrados y no marcados como prueba. La fecha usada es la de ejecución real, o la planificada si no existe. Las líneas sin costo o con costo sobre $1.000.000 cuentan para el ERI pero no para la valorización.
      </div>
    </Guia>
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// EXACTITUD
// ═══════════════════════════════════════════════════════════════════════════
export function TabExactitud({D, nombreSuc, setSuc, abrirFicha}) {
  const M = D.M
  const [vista, setVista] = useState('categoria')
  if (!M.contadas) return <Vacio t="Sin líneas contadas en el período"/>
  const tot = D.buckets.reduce((s, b) => s + b.n, 0) || 1
  const filas = vista === 'categoria' ? D.porCat.map(c => ({...c, label:c.k}))
    : vista === 'bodega' ? D.porSuc.map(s => ({...s, label:nombreSuc(s.k)}))
    : D.porInv.map(x => ({...x, k:x.cab.id,
        label:x.cab.id, sub:`${nombreSuc(x.cab.sucursal_codigo)} · ${fechaEf(x.cab)} · ${x.cab.tipo_inventario === 'GENERAL' ? 'General' : 'Cíclico'}`}))
  if (vista !== 'inventario') filas.sort((a, b) => (a.eri ?? 999) - (b.eri ?? 999))
  return (<>
    <Strip>
      <Kpi l="ERI estricto" v={fmtP(M.eri)} c={semERI(M.eri)} s={`${fmtN(M.cuadran)} de ${fmtN(M.contadas)} cuadran`}/>
      <Kpi l="ERI con tolerancia" v={fmtP(M.eriTol)} c={semERI(M.eriTol)} s={`${fmtN(M.dentroTol)} dentro de tolerancia`}/>
      <Kpi l="Faltantes" v={fmtN(M.faltN)} c={IV.rojo} s={`${fmtN(M.faltUds)} unidades`}/>
      <Kpi l="Sobrantes" v={fmtN(M.sobrN)} c={IV.ambar} s={`${fmtN(M.sobrUds)} unidades`}/>
      <Kpi l="Varianza absoluta" v={fmtN(M.varAbsUds)} s="unidades, sin compensar"/>
      <Kpi l="Sesgo" v={fmtP(M.sesgo, 0)} s="faltantes sobre diferencias"/>
      {M.cruces > 0 && <Kpi l="Cruces confirmados" v={fmtN(M.cruces)} c={IV.azul} s="error de identificación"/>}
    </Strip>

    <Guia>
      El <strong>ERI estricto</strong> no perdona ni una unidad; el <strong>ERI con tolerancia</strong> acepta diferencias chicas en productos de menor valor. Mira los dos: si el estricto es bajo pero el tolerante es alto, el problema son diferencias menores en productos baratos; si ambos son bajos, el error es grande o está en lo que más vale.
      <div style={{marginTop:6}}>La <strong>distribución</strong> dice qué tan grandes son los errores relativos al stock. Muchas líneas en "más de 25%" suelen ser producto en otra ubicación o una unidad de medida mal cargada, no pérdida.</div>
      <div style={{marginTop:6}}>El <strong>sesgo</strong> separa los dos problemas: si faltantes y sobrantes se equilibran, el producto está, pero registrado en otro SKU.</div>
    </Guia>

    <div style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:18, marginBottom:20}}>
      <Seccion titulo="Tamaño del error" sub="diferencia relativa al stock sistema" mb={0}>
        <Caja pad="12px 14px">
          {D.buckets.map(b => (
            <div key={b.k} style={{display:'flex', alignItems:'center', gap:10, padding:'4px 0'}}>
              <div style={{fontSize:12, minWidth:92, color:IV.ink}}>{b.l}</div>
              <div style={{flex:1, height:14, background:IV.lineSoft, borderRadius:2, overflow:'hidden'}}>
                <div style={{width:`${b.n / tot * 100}%`, height:'100%', background:b.c}}/>
              </div>
              <div style={{fontSize:12, fontWeight:700, minWidth:86, textAlign:'right', fontVariantNumeric:'tabular-nums'}}>
                {fmtN(b.n)} <span style={{color:IV.slate, fontWeight:600}}>· {fmtP(b.n / tot * 100, 0)}</span>
              </div>
            </div>
          ))}
        </Caja>
      </Seccion>
      <Seccion titulo="Dirección del error" sub="líneas con diferencia" mb={0}>
        <Caja pad="12px 14px">
          <div style={{display:'flex', height:22, borderRadius:2, overflow:'hidden', marginBottom:10}}>
            <div style={{width:`${M.sesgo ?? 0}%`, background:IV.rojo}}/>
            <div style={{flex:1, background:IV.ambar}}/>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:12}}>
            <span><Punto c={IV.rojo}>FALTANTES</Punto> <strong>{fmtN(M.faltN)}</strong> · {fmtN(M.faltUds)} uds</span>
            <span><Punto c={IV.ambar}>SOBRANTES</Punto> <strong>{fmtN(M.sobrN)}</strong> · {fmtN(M.sobrUds)} uds</span>
          </div>
          <div style={{fontSize:11.5, color:IV.slate, marginTop:10, lineHeight:1.55}}>
            {M.sesgo === null ? 'Sin diferencias en el período.'
              : M.sesgo >= 70 ? 'Predominan los faltantes: patrón de pérdida real.'
              : M.sesgo <= 30 ? 'Predominan los sobrantes: mercadería que entra sin registrarse (recepciones, devoluciones).'
              : 'Faltantes y sobrantes equilibrados: el producto existe, pero está registrado en otro código o ubicación.'}
          </div>
        </Caja>
      </Seccion>
    </div>

    <Seccion titulo="Exactitud por" sub=" ">
      <div style={{marginBottom:10}}>
        <Seg valor={vista} onChange={setVista} opciones={[
          {k:'categoria', l:'CATEGORÍA'}, {k:'bodega', l:'BODEGA'}, {k:'inventario', l:'INVENTARIO'}]}/>
      </div>
      <Caja>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:760}}>
          <thead><tr>
            <th style={th()}>{vista === 'categoria' ? 'Categoría' : vista === 'bodega' ? 'Bodega' : 'Inventario'}</th>
            <th style={th(true)}>Contadas</th><th style={th(true)}>ERI estricto</th><th style={th(true)}>ERI tolerancia</th>
            <th style={th(true)}>Faltantes</th><th style={th(true)}>Sobrantes</th><th style={th(true)}>Var. abs. uds</th>
          </tr></thead>
          <tbody>{filas.map(f => (
            <tr key={f.k} onClick={vista === 'bodega' ? () => setSuc(f.k) : vista === 'inventario' && abrirFicha ? () => abrirFicha(f.k) : undefined}
              style={{cursor:vista === 'categoria' ? 'default' : 'pointer'}}>
              <td style={td(false, {fontWeight:700})}>
                {f.label}
                {f.sub && <div style={{fontSize:10.5, color:IV.slate, fontWeight:400, marginTop:1}}>{f.sub}</div>}
              </td>
              <td style={td(true)}>{fmtN(f.contadas)}</td>
              <td style={td(true)}>
                <span style={{display:'inline-flex', alignItems:'center', gap:8}}>
                  <Barra pct={f.eri} c={semERI(f.eri)} w={46}/>
                  <strong style={{color:semERI(f.eri), minWidth:44, textAlign:'right'}}>{fmtP(f.eri)}</strong>
                </span>
              </td>
              <td style={td(true, {color:semERI(f.eriTol), fontWeight:600})}>{fmtP(f.eriTol)}</td>
              <td style={td(true, {color:f.faltN ? IV.rojo : IV.slate})}>{fmtN(f.faltN)}</td>
              <td style={td(true, {color:f.sobrN ? IV.ambar : IV.slate})}>{fmtN(f.sobrN)}</td>
              <td style={td(true)}>{fmtN(f.varAbsUds)}</td>
            </tr>
          ))}</tbody>
        </table>
      </Caja>
    </Seccion>
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// GRÁFICOS — SVG propios con la paleta institucional (sin librerías externas)
// Todos responden al ancho del contenedor y muestran el detalle al pasar el mouse.
// ═══════════════════════════════════════════════════════════════════════════
const GW = 760
const trunc = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t }
export const fmtSM = n => vacio(n) ? '—' : (Number(n) > 0 ? '+' : '') + fmtM(n)   // compacto con signo
const tick = (mn, mx, n = 4) => { const s = (mx - mn) / n; return Array.from({length:n + 1}, (_, i) => mn + s * i) }
// Marcas "redondas" (1, 2, 2,5 o 5 × 10ⁿ) que siempre incluyen el cero si el rango lo cruza
const pasoLindo = raw => { const p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p }
export const niceTicks = (mn, mx, n = 4) => {
  if (!(mx > mn)) return [mn, mn + 1]
  const st = pasoLindo((mx - mn) / n), a = Math.floor(mn / st) * st, b = Math.ceil(mx / st) * st
  const out = []; for (let v = a; v <= b + st / 2; v += st) out.push(Math.round(v / st) * st)
  return out
}

function TxtHalo({x, y, children, anchor = 'middle', size = 10, weight = 700, fill = IV.ink}) {
  const p = {x, y, textAnchor:anchor, fontSize:size, fontWeight:weight}
  return (<>
    <text {...p} fill="#fff" stroke="#fff" strokeWidth="3.2" strokeLinejoin="round">{children}</text>
    <text {...p} fill={fill}>{children}</text>
  </>)
}

// Puente del balance: parte en cero, cada grupo suma o resta, termina en el balance total
export function GrafPuente({items, total, fmt = fmtSM}) {
  const rows = [...items, {label:'Balance total', v:total, total:true}]
  let run = 0
  const segs = rows.map(r => { if (r.total) return {...r, a:0, b:r.v}; const a = run; run += r.v; return {...r, a, b:run} })
  const vals = segs.flatMap(s => [s.a, s.b, 0])
  const mn = Math.min(...vals), mx = Math.max(...vals), span = (mx - mn) || 1
  const LW = 214, RW = 92, CW = GW - LW - RW, RH = 27, H = segs.length * RH + 14
  const x = v => LW + (v - mn) / span * CW
  return (
    <svg viewBox={`0 0 ${GW} ${H}`} width="100%" role="img" style={{display:'block'}}>
      <line x1={x(0)} x2={x(0)} y1={2} y2={H - 4} stroke={IV.slate} strokeWidth="1"/>
      {segs.map((s, i) => {
        const y = 6 + i * RH, c = s.v < 0 ? IV.rojo : IV.verde
        const x1 = Math.min(x(s.a), x(s.b)), w = Math.max(2, Math.abs(x(s.b) - x(s.a)))
        return (
          <g key={i}>
            <title>{`${s.label}: ${fmt(s.v)}${s.total ? '' : ` · acumulado ${fmt(s.b)}`}`}</title>
            {s.total && <line x1={4} x2={GW - 4} y1={y - 3} y2={y - 3} stroke={IV.line}/>}
            <text x={LW - 12} y={y + RH / 2 - 1} textAnchor="end" dominantBaseline="middle" fontSize="11.5"
              fontWeight={s.total ? 800 : 600} fill={IV.ink}>{trunc(s.label, 26)}</text>
            <rect x={x1} y={y + 4} width={w} height={RH - 11} fill={s.total ? (s.v < 0 ? IV.rojo : IV.verde) : c}
              opacity={s.total ? 1 : 0.82} rx="1.5"/>
            {i < segs.length - 2 && (
              <line x1={x(s.b)} x2={x(s.b)} y1={y + RH - 7} y2={y + RH + 4} stroke={IV.slate} strokeDasharray="2 2"/>
            )}
            <text x={GW - RW + 10} y={y + RH / 2 - 1} dominantBaseline="middle" fontSize="11.5"
              fontWeight={s.total ? 800 : 700} fill={c}>{fmt(s.v)}</text>
          </g>
        )
      })}
    </svg>
  )
}

// Mariposa: pérdida a la izquierda, ganancia a la derecha, rombo en el balance
export function GrafMariposa({rows}) {
  const mx = Math.max(1, ...rows.flatMap(r => [r.perd, r.gan]))
  const LW = 200, VW = 64, CW = (GW - LW - 2 * VW) / 2, cx = LW + VW + CW, RH = 25, H = rows.length * RH + 28
  const L = v => v / mx * CW
  return (
    <svg viewBox={`0 0 ${GW} ${H}`} width="100%" role="img" style={{display:'block'}}>
      <text x={cx - 8} y={12} textAnchor="end" fontSize="10" fontWeight="700" letterSpacing="0.6" fill={IV.rojo}>PÉRDIDA</text>
      <text x={cx + 8} y={12} fontSize="10" fontWeight="700" letterSpacing="0.6" fill={IV.verde}>GANANCIA</text>
      <line x1={cx} x2={cx} y1={18} y2={H - 4} stroke={IV.slate}/>
      {rows.map((r, i) => {
        const y = 22 + i * RH, bal = r.gan - r.perd
        return (
          <g key={r.label}>
            <title>{`${r.label}\nPérdida ${fmtCLP(r.perd)} · Ganancia ${fmtCLP(r.gan)} · Balance ${fmtCLP(bal)}`}</title>
            <text x={LW - 10} y={y + RH / 2} textAnchor="end" dominantBaseline="middle" fontSize="11.5" fontWeight="600" fill={IV.ink}>{trunc(r.label, 24)}</text>
            <text x={LW + VW - 8} y={y + RH / 2} textAnchor="end" dominantBaseline="middle" fontSize="11" fontWeight="700" fill={IV.rojo}>{r.perd ? fmtM(r.perd) : '—'}</text>
            <rect x={cx - L(r.perd)} y={y + 5} width={L(r.perd)} height={RH - 10} fill={IV.rojo} opacity="0.82" rx="1.5"/>
            <rect x={cx} y={y + 5} width={L(r.gan)} height={RH - 10} fill={IV.verde} opacity="0.82" rx="1.5"/>
            <text x={cx + CW + 8} y={y + RH / 2} dominantBaseline="middle" fontSize="11" fontWeight="700" fill={IV.verde}>{r.gan ? fmtM(r.gan) : '—'}</text>
            <path d={`M ${cx + L(bal)} ${y + 5} l 5 ${(RH - 10) / 2} l -5 ${(RH - 10) / 2} l -5 ${-(RH - 10) / 2} z`}
              fill={IV.navy} stroke="#fff" strokeWidth="1.2"/>
          </g>
        )
      })}
    </svg>
  )
}

// Resultado mes a mes: ganancia hacia arriba, pérdida hacia abajo, balance acumulado en línea
export function GrafMensual({meses}) {
  const H = 250, pl = 64, pr = 16, pt = 14, pb = 30, cw = GW - pl - pr, ch = H - pt - pb
  const data = MES.map((m, i) => ({m, x:meses[i + 1] || null}))
  let acc = 0
  const pts = data.map(d => { if (d.x) acc += d.x.gan - d.x.perd; return {...d, cum:d.x ? acc : null} })
  const ult = pts.reduce((u, p, i) => p.x ? i : u, -1)
  const vals = [0, ...pts.flatMap(p => p.x ? [p.x.gan, -p.x.perd, p.cum] : [])]
  const tk = niceTicks(Math.min(...vals), Math.max(...vals), 5)
  const mn = tk[0], mx = tk[tk.length - 1]
  const y = v => pt + (mx - v) / (mx - mn) * ch
  const band = cw / 12, bw = band * 0.5
  const cumPath = pts.slice(0, ult + 1).map((p, i) => {
    const v = p.cum ?? pts.slice(0, i).reverse().find(q => q.cum !== null)?.cum ?? 0
    return `${i ? 'L' : 'M'} ${pl + band * i + band / 2} ${y(v)}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${GW} ${H}`} width="100%" role="img" style={{display:'block'}}>
      {tk.map((t, i) => (
        <g key={i}>
          <line x1={pl} x2={GW - pr} y1={y(t)} y2={y(t)} stroke={IV.lineSoft}/>
          <text x={pl - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill={IV.slate}>{fmtM(t)}</text>
        </g>
      ))}
      <line x1={pl} x2={GW - pr} y1={y(0)} y2={y(0)} stroke={IV.ink} strokeWidth="1"/>
      {pts.map((p, i) => {
        const cx = pl + band * i + band / 2
        return (
          <g key={p.m}>
            {p.x && (<>
              <title>{`${p.m}: pérdida ${fmtCLP(p.x.perd)} · ganancia ${fmtCLP(p.x.gan)} · balance ${fmtCLP(p.x.gan - p.x.perd)} · acumulado ${fmtCLP(p.cum)}`}</title>
              <rect x={cx - bw / 2} y={y(p.x.gan)} width={bw} height={Math.max(0.5, y(0) - y(p.x.gan))} fill={IV.verde} opacity="0.8" rx="1"/>
              <rect x={cx - bw / 2} y={y(0)} width={bw} height={Math.max(0.5, y(-p.x.perd) - y(0))} fill={IV.rojo} opacity="0.8" rx="1"/>
            </>)}
            <text x={cx} y={H - 10} textAnchor="middle" fontSize="10.5" fill={p.x ? IV.ink : IV.line} fontWeight={p.x ? 600 : 400}>{p.m}</text>
          </g>
        )
      })}
      {ult >= 0 && <path d={cumPath} fill="none" stroke={IV.navy} strokeWidth="2.2"/>}
      {pts.slice(0, ult + 1).map((p, i) => p.cum !== null && (
        <circle key={i} cx={pl + band * i + band / 2} cy={y(p.cum)} r="3.6" fill="#fff" stroke={IV.navy} strokeWidth="2"/>
      ))}
    </svg>
  )
}

// Matriz de control: exactitud (x) contra pérdida neta (y), burbuja = valor contado.
// El eje vertical se acota entre −5% y +8% para que los casos normales se lean;
// lo que queda fuera se dibuja en el borde con línea punteada y su valor real.
export function GrafMatriz({pts}) {
  const H = 340, pl = 52, pr = 18, pt = 26, pb = 38, cw = GW - pl - pr, ch = H - pt - pb
  const xs = pts.map(p => p.eri), ys = pts.map(p => p.perd)
  const x0 = Math.max(0, Math.floor((Math.min(90, ...xs) - 6) / 10) * 10)
  const tk = niceTicks(Math.max(-5, Math.min(-1, ...ys)), Math.min(8, Math.max(2, ...ys)), 5)
  const y0 = tk[0], y1 = tk[tk.length - 1]
  const X = v => pl + (v - x0) / (100 - x0) * cw
  const Y = v => pt + (y1 - v) / (y1 - y0) * ch
  const vmax = Math.max(1, ...pts.map(p => p.valor))
  const R = v => 5 + 20 * Math.sqrt(v / vmax)
  const cuad = p => p.eri >= 90 ? (p.perd <= 1 ? IV.verde : IV.ambar) : (p.perd <= 1 ? IV.ambar : IV.rojo)
  const pos = pts.map(p => {
    const fuera = p.perd > y1 || p.perd < y0
    const yv = Math.min(y1, Math.max(y0, p.perd))
    return {...p, fuera, cx:X(p.eri), cy:Y(yv), r:R(p.valor)}
  }).sort((a, b) => b.valor - a.valor)
  // Etiquetas: primero las fuera de escala y las de mayor valor. Se prueban cuatro
  // posiciones (arriba, abajo, derecha, izquierda) y se usa la primera libre.
  const ocupado = [
    {x:X(x0) + 8 + 30, y:Y(y1) + 10, w:64, sello:true}, {x:X(100) - 8 - 56, y:Y(y1) + 10, w:116, sello:true},
    {x:X(x0) + 8 + 78, y:Y(y0) - 12, w:160, sello:true}, {x:X(100) - 8 - 48, y:Y(y0) - 12, w:100, sello:true},
    {x:pl + cw - 30, y:Y(1) - 8, w:64, sello:true},
  ]
  const libre = (x, y, w) => ocupado.every(q => Math.abs(q.x - x) > (q.w + w) / 2 + 3 || Math.abs(q.y - y) > 13)
  const puestas = []
  const candidatos = [...pos.filter(p => p.fuera), ...pos.filter(p => !p.fuera).slice(0, 7)]
  candidatos.forEach(p => {
    const txt = p.fuera ? `${trunc(p.label, 16)} ${fmtP(p.perd, 0)}` : trunc(p.label, 18)
    const w = txt.length * 6.1
    const opciones = [[p.cx, p.cy - p.r - 5], [p.cx, p.cy + p.r + 12],
      [p.cx + p.r + w / 2 + 5, p.cy + 4], [p.cx - p.r - w / 2 - 5, p.cy + 4]]
    for (const [ox, oy] of opciones) {
      const lx = Math.min(GW - pr - w / 2, Math.max(pl + w / 2, ox))
      const ly = Math.min(pt + ch - 3, Math.max(pt + 10, oy))
      if (libre(lx, ly, w)) { const e = {x:lx, y:ly, w, txt, fuera:p.fuera}; ocupado.push(e); puestas.push(e); break }
    }
  })
  return (
    <svg viewBox={`0 0 ${GW} ${H}`} width="100%" role="img" style={{display:'block'}}>
      <rect x={X(90)} y={Y(1)} width={X(100) - X(90)} height={Y(y0) - Y(1)} fill={IV.tVerde}/>
      <rect x={X(x0)} y={Y(y1)} width={X(90) - X(x0)} height={Y(1) - Y(y1)} fill={IV.tRojo}/>
      <rect x={X(x0)} y={Y(1)} width={X(90) - X(x0)} height={Y(y0) - Y(1)} fill={IV.tAmbar} opacity="0.55"/>
      <rect x={X(90)} y={Y(y1)} width={X(100) - X(90)} height={Y(1) - Y(y1)} fill={IV.tAmbar} opacity="0.55"/>
      {[['CRÍTICO', X(x0) + 8, Y(y1) + 14, 'start', IV.rojo], ['PÉRDIDA PUNTUAL', X(100) - 8, Y(y1) + 14, 'end', IV.ambar],
        ['REGISTRO DESORDENADO', X(x0) + 8, Y(y0) - 8, 'start', IV.ambar], ['BAJO CONTROL', X(100) - 8, Y(y0) - 8, 'end', IV.verde]]
        .map(([t, x, yy, a, c]) => <text key={t} x={x} y={yy} textAnchor={a} fontSize="10" fontWeight="800" letterSpacing="0.8" fill={c} opacity="0.9">{t}</text>)}
      {tk.map(t => <line key={t} x1={pl} x2={pl + cw} y1={Y(t)} y2={Y(t)} stroke="#fff" strokeOpacity="0.7"/>)}
      <line x1={X(90)} x2={X(90)} y1={pt} y2={pt + ch} stroke={IV.slate} strokeDasharray="4 3"/>
      <line x1={pl} x2={pl + cw} y1={Y(1)} y2={Y(1)} stroke={IV.slate} strokeDasharray="4 3"/>
      <line x1={pl} x2={pl + cw} y1={Y(0)} y2={Y(0)} stroke={IV.slate} strokeOpacity="0.5"/>
      <text x={pl + cw - 4} y={Y(1) - 4} textAnchor="end" fontSize="9.5" fontWeight="700" fill={IV.slate}>límite 1%</text>
      {tick(x0, 100, (100 - x0) / 10).map(t => (
        <text key={t} x={X(t)} y={pt + ch + 14} textAnchor="middle" fontSize="10" fill={IV.slate}>{Math.round(t)}%</text>
      ))}
      {tk.map(t => (
        <text key={t} x={pl - 8} y={Y(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill={IV.slate}>{fmtP(t, Math.abs(t) < 10 && t % 1 ? 1 : 0)}</text>
      ))}
      <text x={pl} y={12} fontSize="10.5" fontWeight="700" fill={IV.ink}>↑ Pérdida neta % del valor contado</text>
      <text x={pl + cw} y={H - 4} textAnchor="end" fontSize="10.5" fontWeight="700" fill={IV.ink}>ERI estricto →</text>
      {pos.map(p => (
        <g key={p.label}>
          <title>{`${p.label}\nERI ${fmtP(p.eri)} · pérdida neta ${fmtP(p.perd, 2)} · valor ${fmtCLP(p.valor)}${p.fuera ? ' · fuera de escala' : ''}`}</title>
          <circle cx={p.cx} cy={p.cy} r={p.r} fill={cuad(p)} fillOpacity="0.62" stroke={p.fuera ? IV.ink : '#fff'}
            strokeWidth={p.fuera ? 1.4 : 1.5} strokeDasharray={p.fuera ? '3 2' : 'none'}/>
        </g>
      ))}
      {puestas.map((l, i) => <TxtHalo key={i} x={l.x} y={l.y} fill={l.fuera ? IV.rojo : IV.ink}>{l.txt}</TxtHalo>)}
    </svg>
  )
}

// Pareto: impacto por SKU con curva acumulada y línea del 80%
export function GrafPareto({items, total}) {
  const H = 240, pl = 58, pr = 46, pt = 14, pb = 28, cw = GW - pl - pr, ch = H - pt - pb
  const top = items.slice(0, 20), tk = niceTicks(0, Math.max(1, ...top.map(i => i.v)), 4), vmx = tk[tk.length - 1]
  const band = cw / Math.max(top.length, 1), bw = band * 0.62
  let acc = 0
  const cum = top.map(i => { acc += i.v; return total ? acc / total * 100 : 0 })
  const Yv = v => pt + ch - v / vmx * ch, Yp = p => pt + ch - p / 100 * ch
  return (
    <svg viewBox={`0 0 ${GW} ${H}`} width="100%" role="img" style={{display:'block'}}>
      {[0, 25, 50, 75, 100].map(p => (
        <g key={p}>
          <line x1={pl} x2={pl + cw} y1={Yp(p)} y2={Yp(p)} stroke={IV.lineSoft}/>
          <text x={pl + cw + 6} y={Yp(p)} dominantBaseline="middle" fontSize="10" fill={IV.slate}>{p}%</text>
        </g>
      ))}
      {tk.map((t, i) => (
        <text key={i} x={pl - 8} y={Yv(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill={IV.slate}>{fmtM(t)}</text>
      ))}
      <line x1={pl} x2={pl + cw} y1={Yp(80)} y2={Yp(80)} stroke={IV.ambar} strokeDasharray="5 3" strokeWidth="1.3"/>
      <TxtHalo x={pl + cw - 4} y={Yp(80) - 5} anchor="end" fill={IV.ambar}>80% del impacto</TxtHalo>
      {top.map((it, i) => (
        <g key={it.k}>
          <title>{`${i + 1}. ${it.label}\n${fmtCLP(it.v)} · acumulado ${fmtP(cum[i], 0)}`}</title>
          <rect x={pl + band * i + (band - bw) / 2} y={Yv(it.v)} width={bw} height={pt + ch - Yv(it.v)}
            fill={it.falt ? IV.rojo : IV.verde} opacity="0.8" rx="1"/>
          <text x={pl + band * i + band / 2} y={H - 10} textAnchor="middle" fontSize="10" fill={IV.slate}>{i + 1}</text>
        </g>
      ))}
      <path d={cum.map((c, i) => `${i ? 'L' : 'M'} ${pl + band * i + band / 2} ${Yp(c)}`).join(' ')}
        fill="none" stroke={IV.navy} strokeWidth="2"/>
      {cum.map((c, i) => <circle key={i} cx={pl + band * i + band / 2} cy={Yp(c)} r="2.8" fill={IV.navy}/>)}
    </svg>
  )
}

const Leyenda = ({items}) => (
  <div style={{display:'flex', gap:14, flexWrap:'wrap', padding:'8px 14px 10px', borderTop:`1px solid ${IV.lineSoft}`}}>
    {items.map(([c, l, forma]) => (
      <span key={l} style={{display:'inline-flex', alignItems:'center', gap:6, fontSize:10.5, color:IV.slate}}>
        <span style={{width:forma === 'linea' ? 16 : 9, height:forma === 'linea' ? 2.5 : 9, background:c,
          borderRadius:forma === 'rombo' ? 0 : 1, transform:forma === 'rombo' ? 'rotate(45deg)' : 'none'}}/>{l}
      </span>
    ))}
  </div>
)

// Título de sección con lectura: primero la conclusión, después el método
function Titular({t, s}) {
  return (
    <div style={{marginBottom:8}}>
      <div style={{fontSize:14, fontWeight:800, color:IV.ink, letterSpacing:-0.2, lineHeight:1.35}}>{t}</div>
      {s && <div style={{fontSize:11, color:IV.slate, marginTop:2}}>{s}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// RESULTADO — el inventario como estado de resultados
//   Pérdida  = faltantes valorizados   Ganancia = sobrantes valorizados
//   Balance  = ganancia − pérdida      Compensación = ganancia / pérdida
//   Base a costo (default) o a precio de venta (precio neto promedio del año
//   por SKU y tienda desde inv_ventas_mes; si la tienda no lo vendió, el
//   promedio de las demás; si nadie lo vendió, el costo)
// ═══════════════════════════════════════════════════════════════════════════
export function TabResultado({D, nombreSuc, anio, periodo, suc, scope, ventaSuc, padreDe, hayVentas}) {
  const M = D.M
  const [base, setBase] = useState('costo')
  const [eje, setEje]   = useState('categoria')
  const [bajas, setBajas] = useState(null)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const ini = periodo === 'anio' ? `${anio}-01-01`
        : periodo[0] === 'Q' ? `${anio}-${pad2((Number(periodo.slice(1)) - 1) * 3 + 1)}-01` : `${anio}-${pad2(periodo.slice(1))}-01`
      const mFin = periodo === 'anio' ? 12 : periodo[0] === 'Q' ? Number(periodo.slice(1)) * 3 : Number(periodo.slice(1))
      const fin = `${anio}-${pad2(mFin)}-${pad2(finDeMes(anio, mFin))}`
      let q = supabase.from('log_mermas').select('sucursal_codigo,costo_total,tipo').gte('fecha', ini).lte('fecha', fin).limit(5000)
      if (suc !== 'todas') q = q.eq('sucursal_codigo', suc); else if (scope) q = q.in('sucursal_codigo', scope)
      const { data } = await q
      if (vivo) setBajas(data || [])
    })()
    return () => { vivo = false }
  }, [anio, periodo, suc, scope])
  if (!M.lineasCosto) return <Vacio t="Sin líneas valorizables en el período" s="Las líneas no tienen costo registrado."/>

  const aV = base === 'venta'
  const P = x => aV ? x.faltVenta : x.faltVal
  const G = x => aV ? x.sobrVenta : x.sobrVal
  const B = x => G(x) - P(x)
  const grupos = (eje === 'categoria' ? D.porCat.map(c => ({...c, label:c.k}))
    : D.porSuc.map(s => ({...s, label:nombreSuc(s.k)}))).filter(g => P(g) || G(g))

  // Puente: los 10 de mayor efecto en cualquier sentido; primero lo que resta, después lo que suma
  const porEfecto = [...grupos].sort((a, b) => Math.abs(B(b)) - Math.abs(B(a)))
  const cabeza = porEfecto.slice(0, 10), cola = porEfecto.slice(10)
  const itemsPuente = [
    ...cabeza.filter(g => B(g) < 0).sort((a, b) => B(a) - B(b)),
    ...cabeza.filter(g => B(g) >= 0).sort((a, b) => B(b) - B(a)),
  ].map(g => ({label:g.label, v:B(g)}))
    .concat(cola.length ? [{label:`Resto (${cola.length})`, v:cola.reduce((s, g) => s + B(g), 0)}] : [])
  const peorPuente = itemsPuente.filter(i => !i.label.startsWith('Resto')).sort((a, b) => a.v - b.v)[0]
  const filasMariposa = [...grupos].sort((a, b) => (P(b) + G(b)) - (P(a) + G(a))).slice(0, 12)
    .map(g => ({label:g.label, perd:P(g), gan:G(g)}))
  const meses = {}
  Object.entries(D.porMes).forEach(([m, x]) => { meses[m] = {perd:P(x), gan:G(x)} })
  const matriz = grupos.filter(g => g.contadas >= 5 && g.eri !== null && g.valorSis > 0)
    .map(g => ({label:g.label, eri:g.eri, perd:g.pctPerd ?? 0, valor:g.valorSis}))
  const pareto = [...D.topSku].map(s => ({k:s.k, label:`${s.producto || s.sku} · ${nombreSuc(s.suc)}`,
    v:aV ? s.impVentaAbs : s.impAbs, falt:s.dif < 0})).sort((a, b) => b.v - a.v)
  const totPareto = pareto.reduce((s, x) => s + x.v, 0)
  const acc10 = totPareto ? pareto.slice(0, 10).reduce((s, x) => s + x.v, 0) / totPareto * 100 : null
  const n80 = (() => { let a = 0; for (let i = 0; i < pareto.length; i++) { a += pareto[i].v; if (a >= totPareto * 0.8) return i + 1 } return pareto.length })()

  // Merma conocida (bajas registradas como pérdida real) vs desconocida (detectada en el conteo)
  const bajasSuc = {}
  ;(bajas || []).forEach(b => {
    const s = bajasSuc[b.sucursal_codigo] || (bajasSuc[b.sucursal_codigo] = {tot:0, real:0})
    s.tot += Number(b.costo_total) || 0
    if (['destruccion','perdida'].includes(b.tipo)) s.real += Number(b.costo_total) || 0
  })
  const esTienda = k => padreDe(k) !== 'cd_mp'
  const tiendas = D.porSuc.filter(s => esTienda(s.k))
  const ventaTiendas = [...new Set(tiendas.map(s => padreDe(s.k)))].reduce((s, k) => s + (ventaSuc[k] || 0), 0)
  const perdTiendas = tiendas.reduce((s, x) => s + x.perdNeta, 0)
  const mermaVenta = hayVentas && ventaTiendas > 0 ? perdTiendas / ventaTiendas * 100 : null
  const cr = D.cruces || {grupos:[], valFalt:0, valSobr:0, uds:0}
  const perdNoExpl = Math.max(0, M.faltVal - cr.valFalt)
  const multVenta = M.faltVal > 0 ? M.faltVenta / M.faltVal : null
  const comp = M.faltVal > 0 ? M.sobrVal / M.faltVal * 100 : null
  const conocida = D.porSuc.reduce((s, x) => s + ((bajasSuc[x.k] || {}).real || 0), 0)
  const desconocida = Math.max(0, M.perdNeta)
  const totalMerma = conocida + desconocida

  // Titular: la conclusión primero
  const bal = B(M)
  const titular = bal < 0
    ? `Se perdieron ${fmtM(P(M))} y aparecieron ${fmtM(G(M))}: el inventario cierra con un balance de ${fmtSM(bal)}${aV ? ' a precio de venta' : ''}.`
    : `Aparecieron ${fmtM(G(M))} y se perdieron ${fmtM(P(M))}: el inventario cierra con un balance favorable de ${fmtSM(bal)}${aV ? ' a precio de venta' : ''}.`
  const bajada = comp === null ? '' : comp >= 70
    ? `La ganancia compensa el ${fmtP(comp, 0)} de la pérdida: el producto casi siempre está, pero registrado en otro código o ubicación. El problema es de registro, no de robo.`
    : comp >= 35 ? `La ganancia compensa el ${fmtP(comp, 0)} de la pérdida: conviven errores de registro con pérdida real.`
    : `La ganancia compensa solo el ${fmtP(comp, 0)} de la pérdida: predomina la pérdida real de mercadería.`

  return (<>
    <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:12}}>
      <Seg valor={base} onChange={setBase} opciones={[{k:'costo', l:'A COSTO'}, ...(hayVentas ? [{k:'venta', l:'A PRECIO DE VENTA'}] : [])]}/>
      <Seg valor={eje} onChange={setEje} opciones={[{k:'categoria', l:'POR CATEGORÍA'}, {k:'bodega', l:'POR BODEGA'}]}/>
      {aV && M.cobPrecio !== null && (
        <span style={{fontSize:11, color:IV.slate}}>
          Precio de venta real para el {fmtP(M.cobPrecio, 0)} de las líneas con diferencia; el resto se valoriza a costo.
        </span>
      )}
    </div>

    <div style={{border:`1px solid ${IV.line}`, borderLeft:`4px solid ${bal < 0 ? IV.rojo : IV.verde}`, borderRadius:4,
      background:'#fff', padding:'14px 18px', marginBottom:14}}>
      <div style={{fontSize:17, fontWeight:800, color:IV.ink, letterSpacing:-0.3, lineHeight:1.35}}>{titular}</div>
      {bajada && <div style={{fontSize:12.5, color:IV.slate, marginTop:6, lineHeight:1.55}}>{bajada}</div>}
    </div>

    <Strip>
      <Kpi l="Pérdida" v={fmtM(P(M))} c={IV.rojo} s={`${fmtN(M.faltN)} líneas · ${fmtN(M.faltUds)} uds`}/>
      <Kpi l="Ganancia" v={fmtM(G(M))} c={IV.verde} s={`${fmtN(M.sobrN)} líneas · ${fmtN(M.sobrUds)} uds`}/>
      <Kpi l="Balance" v={fmtSM(bal)} c={bal < 0 ? IV.rojo : IV.verde} s={aV ? 'a precio de venta' : `${fmtP(-M.pctPerd, 2)} del valor contado`}/>
      <Kpi l="Compensación" v={fmtP(comp, 0)} s="ganancia sobre pérdida"/>
      {!aV && multVenta !== null && hayVentas && <Kpi l="Pérdida a venta" v={fmtM(M.faltVenta)} c={IV.rojo} s={`${multVenta.toFixed(1).replace('.', ',')}× el costo perdido`}/>}
      {mermaVenta !== null && <Kpi l="Merma sobre venta" v={fmtP(mermaVenta, 2)} c={semPerd(mermaVenta)} s="tiendas · referencia retail 1,4–1,6%"/>}
      {cr.grupos.length > 0 && <Kpi l="Explicado por cruces" v={fmtM(cr.valFalt)} c={IV.navy} s={`${cr.grupos.length} cruces · no es pérdida`}/>}
      {cr.grupos.length > 0 && <Kpi l="Pérdida no explicada" v={fmtM(perdNoExpl)} c={IV.rojo} s="lo que realmente falta"/>}
    </Strip>

    {cr.grupos.length > 0 && M.faltVal > 0 && (
      <div style={{marginBottom:20}}>
        <Titular t={`De ${fmtM(M.faltVal)} faltantes, ${fmtM(cr.valFalt)} son productos registrados con el código equivocado`}
          s="La pérdida se separa en lo que se explica por cruces de código y lo que realmente falta · a costo"/>
        <div style={{display:'flex', height:30, borderRadius:3, overflow:'hidden', marginBottom:12, border:`1px solid ${IV.line}`}}>
          <div title={`Explicado por cruces ${fmtCLP(cr.valFalt)}`} style={{width:`${Math.min(100, cr.valFalt / M.faltVal * 100)}%`, background:IV.navy,
            display:'flex', alignItems:'center', paddingLeft:10, color:'#fff', fontSize:11, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden'}}>
            CRUCES DE CÓDIGO {fmtP(cr.valFalt / M.faltVal * 100, 0)}</div>
          <div title={`No explicada ${fmtCLP(perdNoExpl)}`} style={{flex:1, background:IV.rojo,
            display:'flex', alignItems:'center', paddingLeft:10, color:'#fff', fontSize:11, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden'}}>
            PÉRDIDA NO EXPLICADA {fmtP(perdNoExpl / M.faltVal * 100, 0)}</div>
        </div>
        <BloqueCruces cr={cr} puedeVerCostos nombreInv={id => { const c = D.cabsP.find(x => x.id === id); return c ? `${nombreSuc(c.sucursal_codigo)} · ${fechaEf(c)}` : id }}/>
      </div>
    )}

    <Guia titulo="CÓMO SE CONSTRUYE ESTE RESULTADO">
      Cada diferencia de conteo es un movimiento de plata. Un <strong>faltante</strong> es pérdida: el sistema dice que el producto está y no está. Un <strong>sobrante</strong> es ganancia: aparece producto que el sistema no registraba. El <strong>balance</strong> es la suma de ambos, y la <strong>compensación</strong> dice qué parte de la pérdida la cubre la ganancia.
      <div style={{marginTop:6}}>Una compensación alta no es buena noticia: significa que el producto existe pero está registrado en otro código o lugar. El balance se ve sano mientras el registro está desordenado, y eso termina en quiebres de stock y ventas perdidas.</div>
      <div style={{marginTop:6}}><strong>A precio de venta</strong> muestra lo que realmente se deja de ganar: una puerta perdida no cuesta su costo, cuesta la venta que ya no se hace. Se usa el precio neto promedio del año por SKU y tienda. El CD no vende, así que sus productos toman el precio promedio de las tiendas.</div>
      <div style={{marginTop:6}}><strong>Merma sobre venta</strong> es el indicador estándar del retail: pérdida neta sobre venta neta del período. Los estudios de la industria la ubican entre 1,4% y 1,6% en retail. Solo aplica a tiendas; ojo, aquí se mide solo lo detectado en los conteos, no toda la merma de la empresa.</div>
      <div style={{marginTop:6}}><strong>Merma conocida y desconocida</strong>: la conocida es la que se registró como baja (destrucción, pérdida); la desconocida es la que apareció recién al contar. Las mejores operaciones apuntan a que la desconocida sea la menor parte.</div>
    </Guia>

    <div style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:18, marginBottom:20}}>
      <div>
        <Titular t={peorPuente && peorPuente.v < 0 ? `${peorPuente.label} es la que más resta: ${fmtSM(peorPuente.v)}` : 'Puente del balance'}
          s={`Cómo se llega al balance total, ${eje === 'categoria' ? 'categoría' : 'bodega'} por ${eje === 'categoria' ? 'categoría' : 'bodega'}`}/>
        <Caja><div style={{padding:'10px 8px 4px'}}><GrafPuente items={itemsPuente} total={bal}/></div>
          <Leyenda items={[[IV.rojo, 'resta al balance'], [IV.verde, 'suma al balance']]}/></Caja>
      </div>
      <div>
        <Titular t="Pérdida y ganancia lado a lado"
          s={`Las ${filasMariposa.length} ${eje === 'categoria' ? 'categorías' : 'bodegas'} con más movimiento · el rombo marca el balance`}/>
        <Caja><div style={{padding:'10px 8px 4px'}}><GrafMariposa rows={filasMariposa}/></div>
          <Leyenda items={[[IV.rojo, 'pérdida'], [IV.verde, 'ganancia'], [IV.navy, 'balance', 'rombo']]}/></Caja>
      </div>
    </div>

    <div style={{marginBottom:20}}>
      <Titular t={(() => {
        const ms = Object.entries(meses).filter(([, x]) => x.perd || x.gan)
        if (!ms.length) return 'Resultado mes a mes'
        const peor = ms.sort((a, b) => (a[1].gan - a[1].perd) - (b[1].gan - b[1].perd))[0]
        return `${MES[Number(peor[0]) - 1]} fue el mes de mayor pérdida neta: ${fmtSM(peor[1].gan - peor[1].perd)}`
      })()} s={`Resultado de ${anio} mes a mes · la línea es el balance acumulado · ignora el filtro de período`}/>
      <Caja><div style={{padding:'10px 8px 4px'}}><GrafMensual meses={meses}/></div>
        <Leyenda items={[[IV.verde, 'ganancia del mes'], [IV.rojo, 'pérdida del mes'], [IV.navy, 'balance acumulado', 'linea']]}/></Caja>
    </div>

    <div style={{display:'grid', gridTemplateColumns:'minmax(0,1.15fr) minmax(0,1fr)', gap:18, marginBottom:20}}>
      <div>
        <Titular t={(() => {
          const crit = matriz.filter(p => p.eri < 90 && p.perd > 1)
          const des = matriz.filter(p => p.eri < 90 && p.perd <= 1)
          return crit.length ? `${crit.length} ${eje === 'categoria' ? 'categorías' : 'bodegas'} en zona crítica: baja exactitud y pérdida sobre 1%`
            : des.length ? `${des.length} de ${matriz.length} con registro desordenado: no pierden plata, pierden control`
            : 'Todo bajo control'
        })()} s="Exactitud contra pérdida neta · el tamaño es el valor contado · líneas de meta en 90% y 1%"/>
        <Caja><div style={{padding:'10px 8px 4px'}}>{matriz.length ? <GrafMatriz pts={matriz}/> : <Vacio t="Sin datos suficientes"/>}</div></Caja>
      </div>
      <div>
        <Titular t={acc10 !== null ? `${n80} SKUs concentran el 80% del impacto; los 10 primeros, el ${fmtP(acc10, 0)}` : 'Concentración del impacto'}
          s={`Pareto del impacto por SKU ${aV ? 'a precio de venta' : 'a costo'} · barras rojas faltantes, verdes sobrantes`}/>
        <Caja><div style={{padding:'10px 8px 4px'}}><GrafPareto items={pareto} total={totPareto}/></div>
          <Leyenda items={[[IV.rojo, 'faltante'], [IV.verde, 'sobrante'], [IV.navy, 'acumulado', 'linea'], [IV.ambar, '80%', 'linea']]}/></Caja>
      </div>
    </div>

    <Seccion titulo="Los 15 SKUs de mayor impacto" sub="detalle del Pareto">
      <Caja>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:820}}>
          <thead><tr>
            <th style={th(true, {width:34})}>#</th><th style={th()}>Producto</th><th style={th()}>Bodega</th>
            <th style={th(true)}>Diferencia</th><th style={th(true)}>A costo</th>{hayVentas && <th style={th(true)}>A venta</th>}<th style={th(true)}>% acum.</th>
          </tr></thead>
          <tbody>{(() => { let a = 0; const src = [...D.topSku].sort((x, y) => (aV ? y.impVentaAbs - x.impVentaAbs : y.impAbs - x.impAbs)); return src.slice(0, 15).map((s, i) => {
            a += aV ? s.impVentaAbs : s.impAbs
            return (
              <tr key={s.k}>
                <td style={td(true, {color:IV.slate})}>{i + 1}</td>
                <td style={td()}><div style={{fontWeight:700, fontSize:12}}>{s.producto || s.sku}</div>
                  <div style={{fontSize:10.5, color:IV.slate}}>{s.sku} · {s.cat}{s.veces > 1 ? ` · ${s.veces} conteos` : ''}</div></td>
                <td style={td(false, {color:IV.slate, fontSize:11.5})}>{nombreSuc(s.suc)}</td>
                <td style={td(true, {fontWeight:700, color:s.dif < 0 ? IV.rojo : IV.verde})}>{s.dif > 0 ? '+' : ''}{fmtN(s.dif)}</td>
                <td style={td(true, {fontWeight:aV ? 400 : 700})}>{fmtCLP(s.impAbs)}</td>
                {hayVentas && <td style={td(true, {fontWeight:aV ? 700 : 400, color:IV.slate})}>{fmtCLP(s.impVentaAbs)}</td>}
                <td style={td(true, {color:IV.slate})}>{totPareto ? fmtP(a / totPareto * 100, 0) : '—'}</td>
              </tr>
            )
          }) })()}</tbody>
        </table>
      </Caja>
    </Seccion>

    <Seccion titulo="Merma conocida y desconocida" sub="lo registrado como baja contra lo que apareció recién al contar · a costo">
      {bajas === null ? <Caja pad={16}><span style={{fontSize:12, color:IV.slate}}>Cargando bajas…</span></Caja> : (<>
        {totalMerma > 0 && (
          <div style={{display:'flex', height:26, borderRadius:3, overflow:'hidden', marginBottom:10, border:`1px solid ${IV.line}`}}>
            <div title={`Conocida ${fmtCLP(conocida)}`} style={{width:`${conocida / totalMerma * 100}%`, background:IV.navy,
              display:'flex', alignItems:'center', paddingLeft:8, color:'#fff', fontSize:10.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden'}}>
              CONOCIDA {fmtP(conocida / totalMerma * 100, 0)}</div>
            <div title={`Desconocida ${fmtCLP(desconocida)}`} style={{flex:1, background:IV.rojo,
              display:'flex', alignItems:'center', paddingLeft:8, color:'#fff', fontSize:10.5, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden'}}>
              DESCONOCIDA {fmtP(desconocida / totalMerma * 100, 0)}</div>
          </div>
        )}
        <Caja>
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:760}}>
            <thead><tr>
              <th style={th()}>Bodega</th><th style={th(true)}>Conocida (bajas de merma real)</th>
              <th style={th(true)}>Desconocida (detectada al contar)</th><th style={th(true)}>% desconocida</th>
              {hayVentas && <th style={th(true)}>Merma sobre venta</th>}<th style={th(true)}>Bajas totales</th>
            </tr></thead>
            <tbody>{D.porSuc.map(s => {
              const b = bajasSuc[s.k] || {tot:0, real:0}
              const des = Math.max(0, s.perdNeta), tot = b.real + des
              const v = ventaSuc[padreDe(s.k)] || 0
              return (
                <tr key={s.k}>
                  <td style={td(false, {fontWeight:700})}>{nombreSuc(s.k)}</td>
                  <td style={td(true)}>{fmtCLP(b.real)}</td>
                  <td style={td(true, {fontWeight:700, color:des ? IV.rojo : IV.slate})}>{des ? fmtCLP(des) : '—'}</td>
                  <td style={td(true, {fontWeight:700, color:tot ? (des / tot > 0.5 ? IV.rojo : IV.ambar) : IV.slate})}>{tot ? fmtP(des / tot * 100, 0) : '—'}</td>
                  {hayVentas && <td style={td(true, {color:IV.slate})}>{!esTienda(s.k) ? 'no aplica (CD)' : v ? fmtP(s.perdNeta / v * 100, 2) : '—'}</td>}
                  <td style={td(true, {color:IV.slate})}>{fmtCLP(b.tot)}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </Caja>
      </>)}
    </Seccion>

    <Seccion titulo={`Estado de resultados por ${eje === 'categoria' ? 'categoría' : 'bodega'}`} sub={aV ? 'a precio de venta' : 'a costo'}>
      <Caja>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:860}}>
          <thead><tr>
            <th style={th()}>{eje === 'categoria' ? 'Categoría' : 'Bodega'}</th><th style={th(true)}>Valor contado</th>
            <th style={th(true)}>Pérdida</th><th style={th(true)}>Ganancia</th><th style={th(true)}>Balance</th>
            <th style={th(true)}>Balance %</th><th style={th(true)}>Compensación</th><th style={th(true)}>ERI</th>
          </tr></thead>
          <tbody>{[...grupos].sort((a, b) => B(a) - B(b)).map(g => {
            const bg = B(g), cp = P(g) > 0 ? G(g) / P(g) * 100 : null
            return (
              <tr key={g.k}>
                <td style={td(false, {fontWeight:700})}>{g.label}</td>
                <td style={td(true, {color:IV.slate})}>{fmtCLP(g.valorSis)}</td>
                <td style={td(true, {color:IV.rojo})}>{P(g) ? fmtCLP(P(g)) : '—'}</td>
                <td style={td(true, {color:IV.verde})}>{G(g) ? fmtCLP(G(g)) : '—'}</td>
                <td style={td(true, {fontWeight:800, color:bg < 0 ? IV.rojo : bg > 0 ? IV.verde : IV.slate})}>{fmtSM(bg)}</td>
                <td style={td(true, {color:semPerd(g.pctPerd)})}>{fmtP(-g.pctPerd, 2)}</td>
                <td style={td(true, {color:IV.slate})}>{fmtP(cp, 0)}</td>
                <td style={td(true, {color:semERI(g.eri)})}>{fmtP(g.eri)}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </Caja>
    </Seccion>

    {(M.sinCosto + M.outliers) > 0 && (
      <div style={{fontSize:11.5, color:IV.slate, lineHeight:1.55}}>
        <strong style={{color:IV.ink}}>Calidad del dato:</strong> {fmtN(M.sinCosto)} líneas sin costo y {fmtN(M.outliers)} con costo sobre $1.000.000 quedaron fuera de la valorización. Cuentan para el ERI.
      </div>
    )}
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// COBERTURA
// ═══════════════════════════════════════════════════════════════════════════
export function TabCobertura({D, riesgo, nombreSuc, puedeVerCostos}) {
  const [orden, setOrden] = useState('dias')
  const filas = [...riesgo].sort((a, b) => orden === 'dias'
    ? (b.dias_sin_inventario ?? 99999) - (a.dias_sin_inventario ?? 99999)
    : (b.indice_riesgo || 0) - (a.indice_riesgo || 0))
  const nunca = riesgo.filter(r => r.dias_sin_inventario === null).length
  const m180  = riesgo.filter(r => r.dias_sin_inventario !== null && r.dias_sin_inventario > 180).length
  const m90   = riesgo.filter(r => r.dias_sin_inventario !== null && r.dias_sin_inventario > 90 && r.dias_sin_inventario <= 180).length
  const aldia = riesgo.filter(r => r.dias_sin_inventario !== null && r.dias_sin_inventario <= 90).length
  const catsPer = new Set(D.detsP.map(d => `${D.cabsP.find(c => c.id === d.inventario_id)?.sucursal_codigo}|${d.tipo_producto}`))
  return (<>
    <Strip>
      <Kpi l="Categorías" v={fmtN(riesgo.length)} s="registradas por bodega"/>
      <Kpi l="Al día" v={fmtN(aldia)} c={IV.verde} s="contadas en 90 días"/>
      <Kpi l="91 a 180 días" v={fmtN(m90)} c={m90 ? IV.ambar : IV.slate}/>
      <Kpi l="Más de 180 días" v={fmtN(m180)} c={m180 ? IV.rojo : IV.slate}/>
      <Kpi l="Nunca contadas" v={fmtN(nunca)} c={nunca ? IV.rojo : IV.slate}/>
      <Kpi l="Cubiertas en el período" v={fmtN(catsPer.size)} s="bodega × categoría"/>
    </Strip>
    <Guia>
      Mide <strong>qué parte del inventario tiene respaldo reciente</strong>. Un ERI alto sobre pocas categorías no dice nada de las que no se contaron. La antigüedad se calcula sobre todo el historial, no solo el período filtrado.
      <div style={{marginTop:6}}>El <strong>índice de riesgo</strong> (0 a 100) combina desorden observado en el cierre de bodega, días sin contar y exactitud histórica de la categoría. Úsalo para decidir el próximo cíclico.</div>
    </Guia>
    <Seccion titulo="Antigüedad del último conteo">
      <div style={{marginBottom:10}}>
        <Seg valor={orden} onChange={setOrden} opciones={[{k:'dias', l:'MÁS ANTIGUAS'}, {k:'riesgo', l:'MAYOR RIESGO'}]}/>
      </div>
      <Caja>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:760}}>
          <thead><tr>
            <th style={th()}>Bodega</th><th style={th()}>Categoría</th><th style={th(true)}>Último conteo</th>
            <th style={th(true)}>Días</th><th style={th(true)}>ERI histórico</th>
            {puedeVerCostos && <th style={th(true)}>Descuadre acum.</th>}<th style={th(true)}>Riesgo</th>
          </tr></thead>
          <tbody>{filas.map(r => (
            <tr key={r.sucursal_codigo + r.categoria}>
              <td style={td(false, {color:IV.slate})}>{nombreSuc(r.sucursal_codigo)}</td>
              <td style={td(false, {fontWeight:700})}>{r.categoria}</td>
              <td style={td(true, {color:IV.slate})}>{r.ultimo_inv || '—'}</td>
              <td style={td(true, {fontWeight:700, color:semDias(r.dias_sin_inventario)})}>
                {r.dias_sin_inventario === null ? 'nunca' : fmtN(r.dias_sin_inventario)}</td>
              <td style={td(true, {color:semERI(r.eri_historico === null ? null : Number(r.eri_historico))})}>
                {r.eri_historico === null ? '—' : fmtP(Number(r.eri_historico))}</td>
              {puedeVerCostos && <td style={td(true)}>{Number(r.descuadre_hist_clp) ? fmtCLP(r.descuadre_hist_clp) : '—'}</td>}
              <td style={td(true)}>
                <span style={{display:'inline-flex', alignItems:'center', gap:7}}>
                  <Barra pct={r.indice_riesgo} c={r.indice_riesgo >= 60 ? IV.rojo : r.indice_riesgo >= 40 ? IV.ambar : IV.slate} w={40}/>
                  <strong style={{minWidth:22, textAlign:'right'}}>{r.indice_riesgo}</strong>
                </span>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Caja>
    </Seccion>
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// TENDENCIA
// ═══════════════════════════════════════════════════════════════════════════
export function TabTendencia({D, cabIdx, nombreSuc, puedeVerCostos, anio}) {
  const [met, setMet] = useState('eri')
  const [eje, setEje] = useState('categoria')
  const METS = [
    {k:'eri', l:'ERI %'},
    ...(puedeVerCostos ? [{k:'perd', l:'PÉRDIDA NETA %'}, {k:'desc', l:'DESCUADRE %'}] : []),
    {k:'lineas', l:'LÍNEAS CONTADAS'},
  ]
  const mesOf = d => mesDe(fechaEf(cabIdx[d.inventario_id]))
  const keyOf = eje === 'categoria' ? (d => d.tipo_producto || 'Sin categoría') : (d => cabIdx[d.inventario_id]?.sucursal_codigo)
  const grupos = agrupar(D.detsA, keyOf)
  const filas = Object.entries(grupos).map(([k, ds]) => {
    const pm = {}
    Object.entries(agrupar(ds, mesOf)).forEach(([m, x]) => { pm[m] = calcular(x, D.abc, cabIdx) })
    return {k, label:eje === 'categoria' ? k : nombreSuc(k), total:calcular(ds, D.abc, cabIdx), pm}
  }).sort((a, b) => b.total.contadas - a.total.contadas)
  const maxL = Math.max(1, ...filas.flatMap(f => Object.values(f.pm).map(x => x.contadas)))
  const valor = x => met === 'eri' ? x.eri : met === 'perd' ? x.pctPerd : met === 'desc' ? x.pctDesc : x.contadas
  const color = x => met === 'eri' ? semERI(x.eri) : met === 'perd' ? semPerd(x.pctPerd) : met === 'desc' ? semDesc(x.pctDesc) : IV.navy
  const texto = x => met === 'lineas' ? fmtN(x.contadas) : vacio(valor(x)) ? '·' : met === 'eri' ? Math.round(valor(x)) : Number(valor(x)).toFixed(1).replace('.', ',')
  return (<>
    <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:12}}>
      <Seg valor={met} onChange={setMet} opciones={METS}/>
      <Seg valor={eje} onChange={setEje} opciones={[{k:'categoria', l:'POR CATEGORÍA'}, {k:'bodega', l:'POR BODEGA'}]}/>
    </div>
    <Guia>
      Cada celda es un mes. Sirve para ver si una categoría <strong>mejora o se mantiene mal</strong> a lo largo del año, y si una mejora es real o fue un mes bueno. Esta vista ignora el filtro de período: siempre muestra el año completo.
      <div style={{marginTop:6}}>Los <strong>reincidentes</strong> son SKUs con diferencia en dos o más conteos. Cuando el mismo producto falla una y otra vez, no es un error de conteo: es de ubicación, de unidad de medida o de cómo se recibe.</div>
    </Guia>
    <Seccion titulo={`${METS.find(m => m.k === met)?.l} · ${anio}`}>
      <Caja>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:900}}>
          <thead><tr>
            <th style={th()}>{eje === 'categoria' ? 'Categoría' : 'Bodega'}</th>
            {MES.map(m => <th key={m} style={th(true, {textAlign:'center', padding:'8px 4px'})}>{m}</th>)}
            <th style={th(true)}>Año</th>
          </tr></thead>
          <tbody>{filas.map(f => (
            <tr key={f.k}>
              <td style={td(false, {fontWeight:700, whiteSpace:'nowrap'})}>{f.label}</td>
              {MES.map((m, i) => {
                const x = f.pm[i + 1]
                if (!x) return <td key={m} style={td(true, {textAlign:'center', color:IV.line, padding:'8px 4px'})}>·</td>
                const c = color(x)
                const bg = met === 'lineas' ? `rgba(22,33,62,${0.06 + 0.5 * x.contadas / maxL})` : tinte(c)
                return (
                  <td key={m} title={`${f.label} · ${m}: ERI ${fmtP(x.eri)} · ${fmtN(x.contadas)} líneas`}
                    style={td(true, {textAlign:'center', background:bg, padding:'8px 4px', fontWeight:700, fontSize:11.5,
                      color:met === 'lineas' ? (x.contadas / maxL > 0.55 ? '#fff' : IV.ink) : c,
                      borderLeft:`1px solid #fff`})}>{texto(x)}</td>
                )
              })}
              <td style={td(true, {fontWeight:800, color:color(f.total)})}>{texto(f.total)}</td>
            </tr>
          ))}</tbody>
        </table>
      </Caja>
    </Seccion>
    <Seccion titulo="SKUs reincidentes" sub={`${fmtN(D.reincidentes.length)} con diferencia en dos o más conteos del año`}>
      {D.reincidentes.length === 0 ? <Vacio t="Sin reincidentes en el año"/> : (
        <Caja>
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:760}}>
            <thead><tr>
              <th style={th()}>Producto</th><th style={th()}>Bodega</th><th style={th(true)}>Conteos con dif.</th>
              <th style={th(true)}>Dif. acumulada</th><th style={th(true)}>Neto</th>{puedeVerCostos && <th style={th(true)}>Impacto</th>}
            </tr></thead>
            <tbody>{D.reincidentes.slice(0, 40).map(r => (
              <tr key={r.k}>
                <td style={td()}>
                  <div style={{fontWeight:700, fontSize:12}}>{r.producto || r.sku}</div>
                  <div style={{fontSize:10.5, color:IV.slate}}>{r.sku} · {r.cat}</div>
                </td>
                <td style={td(false, {color:IV.slate, fontSize:11.5})}>{nombreSuc(r.suc)}</td>
                <td style={td(true, {fontWeight:800, color:r.veces >= 3 ? IV.rojo : IV.ambar})}>{r.veces}</td>
                <td style={td(true)}>{fmtN(r.abs)} uds</td>
                <td style={td(true, {color:r.neto < 0 ? IV.rojo : r.neto > 0 ? IV.ambar : IV.slate})}>{r.neto > 0 ? '+' : ''}{fmtN(r.neto)}</td>
                {puedeVerCostos && <td style={td(true)}>{fmtCLP(r.impAbs)}</td>}
              </tr>
            ))}</tbody>
          </table>
        </Caja>
      )}
    </Seccion>
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASE ABC
// ═══════════════════════════════════════════════════════════════════════════
export function TabABC({D, cabIdx, nombreSuc}) {
  const clases = {A:[], B:[], C:[]}
  D.detsP.forEach(d => {
    const k = `${cabIdx[d.inventario_id]?.sucursal_codigo}|${d.sku}`
    clases[D.abc.get(k) || 'C'].push(d)
  })
  const R = Object.fromEntries(Object.entries(clases).map(([k, ds]) => [k, {...calcular(ds, D.abc, cabIdx),
    skus:new Set(ds.map(d => `${cabIdx[d.inventario_id]?.sucursal_codigo}|${d.sku}`)).size}]))
  const totV = (R.A.valorSis + R.B.valorSis + R.C.valorSis) || 1
  const cfg = {A:{c:IV.navy, d:'80% del valor'}, B:{c:IV.azul, d:'siguiente 15%'}, C:{c:IV.slate, d:'último 5%'}}
  const errA = D.topSku.filter(s => D.abc.get(s.k) === 'A').slice(0, 15)
  return (<>
    <Guia>
      La clase se calcula <strong>por valor dentro de cada bodega</strong> (stock × costo del último conteo de cada SKU): los productos que suman el 80% del valor son A, el siguiente 15% es B y el resto C.
      <div style={{marginTop:6}}>La lectura clave es <strong>la exactitud por clase</strong>: en una operación sana la clase A es la más exacta, porque es donde más duele equivocarse. Si A tiene peor ERI que C, el esfuerzo de control está puesto donde no corresponde.</div>
      <div style={{marginTop:6, color:IV.slate}}>El maestro de productos no tiene la clasificación ABC cargada (el campo viene vacío y los detalles traen todos "D"), por eso se calcula acá a partir del valor.</div>
    </Guia>
    <div style={{display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:10, marginBottom:20}}>
      {['A','B','C'].map(k => (
        <div key={k} style={{border:`1px solid ${IV.line}`, borderRadius:4, background:'#fff',
          padding:'12px 14px', boxShadow:`inset 0 3px 0 ${cfg[k].c}`}}>
          <div style={{display:'flex', alignItems:'baseline', gap:8}}>
            <div style={{fontSize:22, fontWeight:900, color:cfg[k].c}}>{k}</div>
            <div style={{fontSize:11, color:IV.slate}}>{cfg[k].d}</div>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 12px', marginTop:10}}>
            {[
              ['SKUs', fmtN(R[k].skus), IV.ink],
              ['Valor', fmtP(R[k].valorSis / totV * 100, 0), IV.ink],
              ['ERI estricto', fmtP(R[k].eri), semERI(R[k].eri)],
              ['Descuadre', fmtP(R[k].pctDesc, 1), semDesc(R[k].pctDesc)],
            ].map(([l, v, c]) => (
              <div key={l}>
                <div style={{fontSize:9.5, fontWeight:700, letterSpacing:0.6, color:IV.slate, textTransform:'uppercase'}}>{l}</div>
                <div style={{fontSize:15, fontWeight:800, color:c, fontVariantNumeric:'tabular-nums'}}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
    {R.A.eri !== null && R.C.eri !== null && (
      <div style={{padding:'9px 13px', marginBottom:20, borderRadius:3, fontSize:12, lineHeight:1.55,
        background:R.A.eri >= R.C.eri ? IV.tVerde : IV.tRojo,
        borderLeft:`3px solid ${R.A.eri >= R.C.eri ? IV.verde : IV.rojo}`,
        color:R.A.eri >= R.C.eri ? IV.verde : IV.rojo, fontWeight:600}}>
        {R.A.eri >= R.C.eri
          ? `La clase A es la más controlada (${fmtP(R.A.eri)} contra ${fmtP(R.C.eri)} en C). El esfuerzo está bien puesto.`
          : `La clase A tiene peor exactitud (${fmtP(R.A.eri)}) que la C (${fmtP(R.C.eri)}): el control está puesto en lo que menos vale.`}
      </div>
    )}
    <Seccion titulo="Clase A con diferencias" sub="mayor impacto en el período">
      {errA.length === 0 ? <Vacio t="Sin diferencias en clase A"/> : (
        <Caja>
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:720}}>
            <thead><tr>
              <th style={th()}>Producto</th><th style={th()}>Bodega</th><th style={th(true)}>Diferencia</th><th style={th(true)}>Impacto</th>
            </tr></thead>
            <tbody>{errA.map(s => (
              <tr key={s.k}>
                <td style={td()}>
                  <div style={{fontWeight:700, fontSize:12}}>{s.producto || s.sku}</div>
                  <div style={{fontSize:10.5, color:IV.slate}}>{s.sku} · {s.cat}</div>
                </td>
                <td style={td(false, {color:IV.slate, fontSize:11.5})}>{nombreSuc(s.suc)}</td>
                <td style={td(true, {fontWeight:700, color:s.dif < 0 ? IV.rojo : IV.ambar})}>{s.dif > 0 ? '+' : ''}{fmtN(s.dif)}</td>
                <td style={td(true, {fontWeight:700})}>{fmtCLP(s.impAbs)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Caja>
      )}
    </Seccion>
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPARAR
// ═══════════════════════════════════════════════════════════════════════════
export function TabComparar({cabs, nombreSuc, sucsDisp, puedeVerCostos, suc}) {
  const [sucC, setSucC] = useState(suc !== 'todas' ? suc : (sucsDisp[0]?.k || ''))
  const lista = cabs.filter(c => c.sucursal_codigo === sucC).sort((a, b) => (fechaEf(b) || '').localeCompare(fechaEf(a) || ''))
  const [idA, setIdA] = useState(''); const [idB, setIdB] = useState('')
  const [dA, setDA] = useState([]); const [dB, setDB] = useState([])
  const [carg, setCarg] = useState(false)
  useEffect(() => { setIdB(lista[0]?.id || ''); setIdA(lista[1]?.id || '') /* eslint-disable-next-line */ }, [sucC])
  useEffect(() => {
    let vivo = true
    if (!idA || !idB) { setDA([]); setDB([]); return }
    setCarg(true)
    Promise.all([fetchDetalles([idA]), fetchDetalles([idB])])
      .then(([a, b]) => { if (vivo) { setDA(a); setDB(b) } })
      .finally(() => vivo && setCarg(false))
    return () => { vivo = false }
  }, [idA, idB])
  const lbl = c => `${fechaEf(c)} · ${c.tipo_inventario === 'GENERAL' ? 'General' : (c.categoria_asignada || 'Cíclico')} · ${c.id}`
  const mA = Object.fromEntries(dA.filter(d => d.stock_fisico !== null).map(d => [d.sku, d]))
  const mB = Object.fromEntries(dB.filter(d => d.stock_fisico !== null).map(d => [d.sku, d]))
  const comunes = Object.keys(mA).filter(k => mB[k])
  // Mejora = reducción del error ABSOLUTO. El módulo anterior restaba diferencias con
  // signo, y un sobrante que bajaba de +10 a +2 figuraba como "empeoró".
  const filas = comunes.map(sku => {
    const a = mA[sku], b = mB[sku]
    const eA = Math.abs(Number(a.diferencia) || 0), eB = Math.abs(Number(b.diferencia) || 0)
    const c = costoDe(b) ?? costoDe(a)
    return {sku, producto:b.producto || a.producto, cat:b.tipo_producto, difA:Number(a.diferencia) || 0,
      difB:Number(b.diferencia) || 0, mejora:eA - eB, imp:c !== null ? (eA - eB) * c : 0}
  }).filter(f => f.difA !== 0 || f.difB !== 0).sort((x, y) => Math.abs(y.imp) - Math.abs(x.imp) || Math.abs(y.mejora) - Math.abs(x.mejora))
  const ca = calcular(dA, null, null), cb = calcular(dB, null, null)
  const mej = filas.filter(f => f.mejora > 0).length, emp = filas.filter(f => f.mejora < 0).length
  const imp = filas.reduce((s, f) => s + f.imp, 0)
  return (<>
    <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12}}>
      <select style={inp(170)} value={sucC} onChange={e => setSucC(e.target.value)}>
        {sucsDisp.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
      </select>
      <span style={{fontSize:10.5, fontWeight:700, color:IV.slate, letterSpacing:0.5}}>ANTES</span>
      <select style={inp(290)} value={idA} onChange={e => setIdA(e.target.value)}>
        <option value="">— elegir —</option>
        {lista.map(c => <option key={c.id} value={c.id}>{lbl(c)}</option>)}
      </select>
      <span style={{fontSize:10.5, fontWeight:700, color:IV.slate, letterSpacing:0.5}}>DESPUÉS</span>
      <select style={inp(290)} value={idB} onChange={e => setIdB(e.target.value)}>
        <option value="">— elegir —</option>
        {lista.map(c => <option key={c.id} value={c.id}>{lbl(c)}</option>)}
      </select>
    </div>
    <Guia>
      Compara dos conteos de la misma bodega. Tiene sentido cuando cubren las mismas categorías: por ejemplo el cíclico de Pisos de marzo contra el de junio. Se consideran solo los SKUs contados en ambos.
      <div style={{marginTop:6}}>Un SKU <strong>mejora</strong> cuando su error absoluto baja, sin importar si era faltante o sobrante: pasar de sobrar 10 a sobrar 2 es mejora.</div>
    </Guia>
    {!idA || !idB ? <Vacio t="Elige dos inventarios" s="La bodega necesita al menos dos conteos cerrados."/>
      : carg ? <Vacio t="Cargando los dos conteos…"/>
      : comunes.length === 0 ? <Vacio t="No hay SKUs en común" s="Los inventarios elegidos no comparten productos."/>
      : (<>
        <Strip>
          <Kpi l="SKUs en común" v={fmtN(comunes.length)}/>
          <Kpi l="ERI antes" v={fmtP(ca.eri)} c={semERI(ca.eri)}/>
          <Kpi l="ERI después" v={fmtP(cb.eri)} c={semERI(cb.eri)} delta={ca.eri !== null && cb.eri !== null ? cb.eri - ca.eri : null}/>
          <Kpi l="Mejoraron" v={fmtN(mej)} c={IV.verde}/>
          <Kpi l="Empeoraron" v={fmtN(emp)} c={IV.rojo}/>
          {puedeVerCostos && <Kpi l="Impacto de la mejora" v={fmtCLP(imp)} c={imp >= 0 ? IV.verde : IV.rojo} s="error absoluto evitado"/>}
        </Strip>
        <Caja>
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:760}}>
            <thead><tr>
              <th style={th()}>Producto</th><th style={th(true)}>Antes</th><th style={th(true)}>Después</th>
              <th style={th(true)}>Cambio</th>{puedeVerCostos && <th style={th(true)}>Impacto</th>}
            </tr></thead>
            <tbody>{filas.slice(0, 60).map(f => (
              <tr key={f.sku}>
                <td style={td()}>
                  <div style={{fontWeight:700, fontSize:12}}>{f.producto || f.sku}</div>
                  <div style={{fontSize:10.5, color:IV.slate}}>{f.sku} · {f.cat}</div>
                </td>
                <td style={td(true, {color:f.difA ? IV.ink : IV.slate})}>{f.difA > 0 ? '+' : ''}{fmtN(f.difA)}</td>
                <td style={td(true, {color:f.difB ? IV.ink : IV.slate})}>{f.difB > 0 ? '+' : ''}{fmtN(f.difB)}</td>
                <td style={td(true)}>
                  {f.mejora === 0 ? <span style={{color:IV.slate}}>igual</span>
                    : <Punto c={f.mejora > 0 ? IV.verde : IV.rojo}>{f.mejora > 0 ? 'MEJORA' : 'EMPEORA'} {fmtN(Math.abs(f.mejora))}</Punto>}
                </td>
                {puedeVerCostos && <td style={td(true, {fontWeight:700, color:f.imp > 0 ? IV.verde : f.imp < 0 ? IV.rojo : IV.slate})}>{f.imp ? fmtCLP(f.imp) : '—'}</td>}
              </tr>
            ))}</tbody>
          </table>
        </Caja>
      </>)}
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// BONO TRIMESTRAL — fórmula idéntica a la anterior, con tres correcciones:
//   · usa solo inventarios no marcados como prueba
//   · el inventario general de referencia es el de la misma bodega
//   · la clase A+B se calcula por valor (el campo cat_abcd viene vacío)
// ═══════════════════════════════════════════════════════════════════════════
export function calcularBono(trimDets, genDets) {
  const conC = trimDets.filter(d => d.stock_fisico !== null && d.stock_fisico !== undefined)
  const cuad = conC.filter(d => Math.round(Number(d.diferencia) || 0) === 0)
  const eriTrim = conC.length ? Math.round(cuad.length / conC.length * 100) : 0
  const cv = d => (Number(d.stock_sistema) || 0) * (costoDe(d) || 0)
  const valorGenTotal = genDets.reduce((s, d) => s + cv(d), 0)
  const skusCont = new Set(conC.map(d => d.sku))
  const valorCubierto = genDets.filter(d => skusCont.has(d.sku)).reduce((s, d) => s + cv(d), 0)
  const pctCobertura = valorGenTotal > 0 ? Math.round(valorCubierto / valorGenTotal * 100) : null
  const valorSisTrim = conC.reduce((s, d) => s + cv(d), 0)
  const perdidaTrim = conC.filter(d => (Number(d.diferencia) || 0) < 0)
    .reduce((s, d) => s + Math.abs(Number(d.diferencia)) * (costoDe(d) || 0), 0)
  const pctPerdidaTrim = valorSisTrim > 0 ? perdidaTrim / valorSisTrim * 100 : 0
  const cumpleFiltroTrim = pctPerdidaTrim <= 1.0
  const totalUndTrim = conC.reduce((s, d) => s + (Number(d.stock_fisico) || 0), 0)
  const faltT = conC.filter(d => (Number(d.diferencia) || 0) < 0).reduce((s, d) => s + Math.abs(Number(d.diferencia)), 0)
  const sobrT = conC.filter(d => (Number(d.diferencia) || 0) > 0).reduce((s, d) => s + Number(d.diferencia), 0)
  const difNetaTrim = Math.max(0, faltT - sobrT)
  const pctDifTrim = totalUndTrim > 0 ? difNetaTrim / totalUndTrim * 100 : 0
  const ab = skusAB(genDets)
  const abCont = [...ab].filter(s => skusCont.has(s)).length
  const pctCobAB = ab.size > 0 ? abCont / ab.size * 100 : null
  const cumpleCobAB = pctCobAB === null || pctCobAB >= 80
  const bonoTrim = !cumpleFiltroTrim || !cumpleCobAB ? 0
    : pctDifTrim <= 0.5 ? 300000 : pctDifTrim <= 1.0 ? 200000 : pctDifTrim <= 1.5 ? 100000 : 0
  const errSku = {}, errCat = {}
  conC.forEach(d => {
    const c = d.tipo_producto || 'Sin categoría'
    const x = errCat[c] || (errCat[c] = {cat:c, errores:0, total:0}); x.total++
    if (Math.round(Number(d.diferencia) || 0) !== 0) {
      x.errores++
      const e = errSku[d.sku] || (errSku[d.sku] = {sku:d.sku, producto:d.producto, veces:0, difTotal:0})
      e.veces++; e.difTotal += Number(d.diferencia) || 0
    }
  })
  const topErrores = Object.values(errSku).sort((a, b) => b.veces - a.veces || Math.abs(b.difTotal) - Math.abs(a.difTotal)).slice(0, 10)
  const catErrRows = Object.values(errCat).map(c => ({...c, pct:c.total ? Math.round(c.errores / c.total * 100) : 0}))
    .sort((a, b) => b.errores - a.errores)
  return {eriTrim, pctCobertura, valorSisTrim, perdidaTrim, pctPerdidaTrim, cumpleFiltroTrim, totalUndTrim,
    difNetaTrim, pctDifTrim, pctCobAB, abTotal:ab.size, abCont, cumpleCobAB, bonoTrim, topErrores, catErrRows}
}

export function TabBono({cabs, detsAnio, anio, suc, periodo, sucsDisp, nombreSuc, onPdfTrimestral}) {
  const qIni = periodo[0] === 'Q' ? periodo.slice(1) : String(Math.ceil((new Date().getMonth() + 1) / 3))
  const [q, setQ] = useState(qIni)
  const [sucB, setSucB] = useState(suc !== 'todas' ? suc : '')
  const [genDets, setGenDets] = useState(null)
  const [pdf, setPdf] = useState(false)
  const mFin = Number(q) * 3
  const fin = `${anio}-${pad2(mFin)}-${pad2(finDeMes(anio, mFin))}`
  const cics = cabs.filter(c => c.sucursal_codigo === sucB && c.tipo_inventario === 'CICLICO' &&
    anioDe(fechaEf(c)) === anio && qDe(fechaEf(c)) === Number(q))
  const ids = new Set(cics.map(c => c.id))
  const trimDets = detsAnio.filter(d => ids.has(d.inventario_id))
  const genInv = cabs.filter(c => c.sucursal_codigo === sucB && c.tipo_inventario === 'GENERAL' && (fechaEf(c) || '') <= fin)
    .sort((a, b) => (fechaEf(b) || '').localeCompare(fechaEf(a) || ''))[0] || null
  useEffect(() => {
    let vivo = true
    if (!genInv) { setGenDets([]); return }
    setGenDets(null)
    fetchDetalles([genInv.id]).then(d => vivo && setGenDets(d)).catch(() => vivo && setGenDets([]))
    return () => { vivo = false }
  }, [genInv?.id])
  if (!sucB) return (
    <div>
      <div style={{marginBottom:12}}>
        <select style={inp(200)} value={sucB} onChange={e => setSucB(e.target.value)}>
          <option value="">— elegir bodega —</option>
          {sucsDisp.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
        </select>
      </div>
      <Vacio t="El bono se calcula por bodega" s="Elige la bodega a evaluar."/>
    </div>
  )
  const B = calcularBono(trimDets, genDets || [])
  const colorBono = !B.cumpleFiltroTrim || !B.cumpleCobAB ? IV.rojo : B.bonoTrim >= 300000 ? IV.verde : B.bonoTrim > 0 ? IV.ambar : IV.rojo
  const colorCob = B.pctCobertura === null ? IV.slate : B.pctCobertura >= 80 ? IV.verde : B.pctCobertura >= 60 ? IV.ambar : IV.rojo
  const labelCob = B.pctCobertura === null ? 'Sin inventario general de referencia'
    : B.pctCobertura >= 80 ? 'Meta cumplida (80% o más)' : B.pctCobertura >= 60 ? 'Bajo la meta (60 a 79%)' : 'Cobertura insuficiente (menos de 60%)'
  const cond = [
    {t:'Pérdida valorizada ≤ 1%', ok:B.cumpleFiltroTrim, v:fmtP(B.pctPerdidaTrim, 2), d:`${fmtCLP(B.perdidaTrim)} de ${fmtCLP(B.valorSisTrim)} contado`, bloquea:true},
    {t:'Cobertura A+B ≥ 80%', ok:B.cumpleCobAB, v:B.pctCobAB === null ? 'sin referencia' : fmtP(B.pctCobAB, 0),
      d:B.pctCobAB === null ? 'No hay inventario general previo' : `${fmtN(B.abCont)} de ${fmtN(B.abTotal)} SKUs A+B del general contados`, bloquea:true},
    {t:'Diferencia neta en cantidad', ok:B.pctDifTrim <= 1.5, v:fmtP(B.pctDifTrim, 2),
      d:`${fmtN(B.difNetaTrim)} uds netas de ${fmtN(B.totalUndTrim)} · tramo ${B.pctDifTrim <= 0.5 ? '0–0,5%' : B.pctDifTrim <= 1 ? '0,6–1%' : B.pctDifTrim <= 1.5 ? '1,1–1,5%' : 'sobre 1,5%'}`},
  ]
  return (<>
    <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12}}>
      <select style={inp(190)} value={sucB} onChange={e => setSucB(e.target.value)}>
        {sucsDisp.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
      </select>
      <Seg valor={q} onChange={setQ} opciones={[1,2,3,4].map(n => ({k:String(n), l:`Q${n} ${anio}`}))}/>
      {onPdfTrimestral && cics.length > 0 && genDets !== null && (
        <button style={{...btn('outline'), marginLeft:'auto'}} disabled={pdf} onClick={async () => {
          setPdf(true)
          try {
            await onPdfTrimestral({q, anio:String(anio), sucNombre:nombreSuc(sucB), invs:cics, dets:trimDets,
              genInv, genDets:genDets || [], pctCobertura:B.pctCobertura, colorCob, labelCob,
              eriTrim:B.eriTrim, colorEriT:semERI(B.eriTrim), bonoTrim:B.bonoTrim, colorBonoTrim:colorBono,
              cumpleFiltroTrim:B.cumpleFiltroTrim, pctPerdidaTrim:B.pctPerdidaTrim, cumpleCobAB:B.cumpleCobAB,
              pctCobAB:B.pctCobAB, pctDifTrim:B.pctDifTrim, difNetaTrim:B.difNetaTrim, topErrores:B.topErrores,
              catErrRows:B.catErrRows, perdidaTrim:B.perdidaTrim, valorSisTrim:B.valorSisTrim})
          } catch (e) { console.error(e) } finally { setPdf(false) }
        }}>{pdf ? 'GENERANDO…' : 'DESCARGAR PDF'}</button>
      )}
    </div>
    <Guia titulo="CÓMO SE CALCULA EL BONO">
      Se evalúan <strong>los inventarios cíclicos del trimestre</strong> de una sola bodega. Dos condiciones son eliminatorias: si la pérdida valorizada supera el 1% del valor contado, o si los cíclicos no alcanzaron a cubrir el 80% de los SKUs de clase A y B, el bono es cero. Si se cumplen ambas, el monto depende del tramo de diferencia neta en unidades (los sobrantes compensan faltantes): hasta 0,5% $300.000, hasta 1% $200.000, hasta 1,5% $100.000.
      <div style={{marginTop:6}}>La referencia es el <strong>último inventario general cerrado de la misma bodega</strong> antes del cierre del trimestre. La clase A+B se calcula por valor sobre ese general.</div>
      <div style={{marginTop:8, paddingTop:8, borderTop:`1px solid ${IV.line}`, color:IV.ambar}}>
        <strong>Cambio respecto de la versión anterior:</strong> la condición de cobertura A+B no se estaba aplicando, porque la clasificación ABC viene vacía en la base y el sistema la daba por cumplida. Ahora se calcula. Además se excluyen los inventarios marcados como prueba y se toma el general de la misma bodega. Un trimestre ya evaluado puede cambiar de resultado.
      </div>
    </Guia>
    {cics.length === 0 ? <Vacio t={`Sin cíclicos en Q${q} ${anio} para ${nombreSuc(sucB)}`}/> : (<>
      <div style={{display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr)) minmax(0,1.1fr)', gap:10, marginBottom:20}}>
        {cond.map(c => {
          const col = c.ok ? IV.verde : IV.rojo
          return (
            <div key={c.t} style={{border:`1px solid ${IV.line}`, borderRadius:4, background:'#fff', padding:'12px 14px',
              boxShadow:`inset 0 3px 0 ${col}`}}>
              <div style={{fontSize:10, fontWeight:700, letterSpacing:0.6, color:IV.slate, textTransform:'uppercase'}}>{c.t}</div>
              <div style={{fontSize:21, fontWeight:800, color:col, marginTop:3, fontVariantNumeric:'tabular-nums'}}>{c.v}</div>
              <div style={{fontSize:11, color:IV.slate, marginTop:3, lineHeight:1.45}}>{c.d}</div>
              <div style={{marginTop:7}}><Punto c={col}>{c.ok ? 'CUMPLE' : c.bloquea ? 'BLOQUEA EL BONO' : 'SIN TRAMO'}</Punto></div>
            </div>
          )
        })}
        <div style={{border:`1px solid ${colorBono}55`, borderRadius:4, background:tinte(colorBono), padding:'12px 14px'}}>
          <div style={{fontSize:10, fontWeight:700, letterSpacing:0.6, color:IV.slate, textTransform:'uppercase'}}>Bono bruto del trimestre</div>
          <div style={{fontSize:28, fontWeight:900, color:colorBono, marginTop:2, fontVariantNumeric:'tabular-nums'}}>{fmtCLP(B.bonoTrim)}</div>
          <div style={{fontSize:11, color:IV.ink, marginTop:3}}>
            {!B.cumpleFiltroTrim ? 'Bloqueado por pérdida sobre 1%' : !B.cumpleCobAB ? 'Bloqueado por cobertura A+B bajo 80%'
              : B.bonoTrim ? 'Condiciones cumplidas' : 'Diferencia neta sobre 1,5%'}
          </div>
          <div style={{fontSize:10.5, color:IV.slate, marginTop:6}}>ERI del trimestre {fmtP(B.eriTrim, 0)} · cobertura por valor {B.pctCobertura === null ? '—' : fmtP(B.pctCobertura, 0)}</div>
        </div>
      </div>
      <div style={{fontSize:11.5, color:IV.slate, marginBottom:16}}>
        Referencia: {genInv ? <><strong style={{color:IV.ink}}>{genInv.id}</strong> del {fechaEf(genInv)}{genDets === null ? ' · cargando…' : ` · ${fmtN(genDets.length)} líneas`}</> : 'sin inventario general previo'}
      </div>
      <div style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:18}}>
        <Seccion titulo={`Cíclicos del trimestre (${cics.length})`}>
          <Caja>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead><tr><th style={th()}>Fecha</th><th style={th()}>Categorías</th><th style={th(true)}>Líneas</th><th style={th(true)}>ERI</th></tr></thead>
              <tbody>{cics.map(c => {
                const m = calcular(trimDets.filter(d => d.inventario_id === c.id), null, null)
                const cats = Array.isArray(c.categorias_asignadas) && c.categorias_asignadas.length ? c.categorias_asignadas.join(', ') : (c.categoria_asignada || '—')
                return (
                  <tr key={c.id}>
                    <td style={td(false, {whiteSpace:'nowrap', color:IV.slate})}>{fechaEf(c)}</td>
                    <td style={td(false, {fontSize:11.5})}>{cats}</td>
                    <td style={td(true)}>{fmtN(m.contadas)}</td>
                    <td style={td(true, {fontWeight:700, color:semERI(m.eri)})}>{fmtP(m.eri, 0)}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </Caja>
        </Seccion>
        <Seccion titulo="SKUs con más errores">
          {B.topErrores.length === 0 ? <Vacio t="Sin errores en el trimestre"/> : (
            <Caja>
              <table style={{width:'100%', borderCollapse:'collapse'}}>
                <thead><tr><th style={th()}>Producto</th><th style={th(true)}>Veces</th><th style={th(true)}>Dif. neta</th></tr></thead>
                <tbody>{B.topErrores.map(e => (
                  <tr key={e.sku}>
                    <td style={td()}><div style={{fontWeight:700, fontSize:12}}>{e.producto || e.sku}</div>
                      <div style={{fontSize:10.5, color:IV.slate}}>{e.sku}</div></td>
                    <td style={td(true, {fontWeight:700})}>{e.veces}</td>
                    <td style={td(true, {color:e.difTotal < 0 ? IV.rojo : IV.ambar})}>{e.difTotal > 0 ? '+' : ''}{fmtN(e.difTotal)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </Caja>
          )}
        </Seccion>
      </div>
    </>)}
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUCES DE CÓDIGO — el faltante de un SKU que aparece como sobrante de otro
//
// En un mismo conteo, un producto que falta y un producto hermano que sobra
// casi en la misma cantidad no es pérdida: es mercadería registrada con el
// código equivocado (segunda como primera, genérico en vez de por medida,
// modelo o medida cruzados). Ajustarlo como pérdida y ganancia infla ambos
// lados y deja el error vivo; lo correcto es reclasificar en BSALE.
//
// Criterio (dentro del mismo inventario):
//   · misma familia de producto (las dos primeras palabras del nombre)
//   · similitud del nombre, medida (70x200, 80x200…) y costo
//   · un faltante puede explicarse con varios sobrantes (1 → N)
//   · confianza ALTA: cubre ≥ 80% del faltante con similitud ≥ 0,45
//     confianza MEDIA: cubre ≥ 50% con similitud ≥ 0,42. Por debajo no es cruce:
//     dos modelos distintos que solo comparten el precio son coincidencia.
// ═══════════════════════════════════════════════════════════════════════════
const STOP = new Set(['de','la','el','y','con','para','del','los','las','un','una','en','al'])
const normTxt = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const tokensDe = s => normTxt(s).replace(/(\d)\s*x\s*(\d)/g, '$1x$2').split(' ')
  .filter(t => t && !STOP.has(t) && (t.length >= 2 || /^\d/.test(t)))
// Palabras de calidad: en un outlet, "2da", "segunda" y "descontinuada" son la señal
// más fuerte de un cruce (la mercadería de segunda se registra en el código genérico
// o en el de otra calidad). Si ambos productos las tienen, el cruce es más probable.
const CALIDAD = new Set(['2da','segunda','seleccion','selec','descontinuada','descontinuado','descont','1era','1ra','primera','outlet','saldo'])
const tieneCalidad = tk => [...tk].some(t => CALIDAD.has(t))
const medidaDe = tk => tk.find(t => /^\d{2,3}x\d{2,3}$/.test(t)) || null
const familiaDe = tk => tk.filter(t => !/^\d/.test(t)).slice(0, 2).join(' ')
const esContada = d => d.stock_fisico !== null && d.stock_fisico !== undefined

export function detectarCruces(ds) {
  const porInv = agrupar(ds.filter(d => esContada(d) && Math.round(Number(d.diferencia) || 0) !== 0), d => d.inventario_id)
  const grupos = []
  Object.entries(porInv).forEach(([inv, lineas]) => {
    const prep = lineas.map(d => {
      const tk = tokensDe(d.producto)
      return {d, dif:Number(d.diferencia), tk:new Set(tk), fam:familiaDe(tk), med:medidaDe(tk), c:costoDe(d), cal:tieneCalidad(tk)}
    })
    const falt = prep.filter(x => x.dif < 0).sort((a, b) => Math.abs(b.dif) * (b.c || 1) - Math.abs(a.dif) * (a.c || 1))
    const sobr = prep.filter(x => x.dif > 0).map(x => ({...x, resto:x.dif}))
    for (const f of falt) {
      if (!f.fam || f.fam.indexOf(' ') < 0) continue
      let resto = -f.dif
      const cand = sobr.filter(s => s.resto > 0 && s.fam === f.fam && s.d.sku !== f.d.sku).map(s => {
        const inter = [...f.tk].filter(t => s.tk.has(t)).length
        const jac = inter / ((f.tk.size + s.tk.size - inter) || 1)
        const med = f.med && s.med ? (f.med === s.med ? 1 : 0) : 0.5
        const cst = f.c && s.c ? Math.min(f.c, s.c) / Math.max(f.c, s.c) : 0.7
        const cal = f.cal && s.cal ? 0.15 : 0
        return {s, score:0.5 * jac + 0.3 * med + 0.2 * cst + cal}
      }).filter(x => x.score >= 0.35).sort((a, b) => b.score - a.score || b.s.resto - a.s.resto)
      const usos = []
      for (const {s, score} of cand) {
        if (resto <= 0) break
        const q = Math.min(resto, s.resto); if (q <= 0) continue
        usos.push({s, q, score}); resto -= q; s.resto -= q
      }
      const q = usos.reduce((a, u) => a + u.q, 0)
      if (!q) continue
      const cob = q / -f.dif
      const sc = usos.reduce((a, u) => a + u.score * u.q, 0) / q
      const conf = cob >= 0.8 && sc >= 0.45 ? 'ALTA' : cob >= 0.5 && sc >= 0.42 ? 'MEDIA' : null
      if (!conf) { usos.forEach(u => { u.s.resto += u.q }); continue }     // no alcanza: se devuelve
      grupos.push({inv, falt:f.d, faltUds:-f.dif, uds:q, cob, conf, score:sc,
        valFalt:q * (f.c || 0), valSobr:usos.reduce((a, u) => a + u.q * (u.s.c || 0), 0),
        sobrantes:usos.map(u => ({d:u.s.d, q:u.q, total:u.s.dif, score:u.score}))})
    }
  })
  grupos.sort((a, b) => b.valFalt - a.valFalt || b.uds - a.uds)
  return {grupos, valFalt:grupos.reduce((s, g) => s + g.valFalt, 0),
    valSobr:grupos.reduce((s, g) => s + g.valSobr, 0), uds:grupos.reduce((s, g) => s + g.uds, 0)}
}

// Acuerdo entre contadores: líneas donde el conteo 1 y el 2 coincidieron
export function acuerdoContadores(ds) {
  const b = ds.filter(d => d.contador1_cantidad !== null && d.contador1_cantidad !== undefined &&
                           d.contador2_cantidad !== null && d.contador2_cantidad !== undefined)
  if (!b.length) return null
  return b.filter(d => Number(d.contador1_cantidad) === Number(d.contador2_cantidad)).length / b.length * 100
}

// Calificación del conteo: exactitud (50%), exactitud valorizada (30%), acuerdo de contadores (20%).
// Si falta un componente, su peso se reparte entre los demás.
export function calificar(M, acuerdo) {
  const comps = [['Exactitud del registro', M.eri, 50], ['Exactitud valorizada', M.exactVal, 30], ['Acuerdo entre contadores', acuerdo, 20]]
    .filter(c => !vacio(c[1]))
  const w = comps.reduce((s, c) => s + c[2], 0)
  if (!w) return null
  const score = comps.reduce((s, c) => s + c[1] * c[2], 0) / w
  const nota = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'E'
  return {score, nota, comps:comps.map(([l, v, p]) => ({l, v, p:p / w * 100}))}
}
export const colorNota = n => n === 'A' ? IV.verde : n === 'B' ? '#3F8F5A' : n === 'C' ? IV.ambar : n === 'D' ? '#C2410C' : IV.rojo
const LEYENDA_NOTA = {A:'Conteo de clase mundial', B:'Conteo sólido', C:'Aceptable, con errores relevantes',
  D:'Débil: el registro no es confiable', E:'Crítico: rehacer o revisar a fondo'}

function Nota({n, size = 44}) {
  if (!n) return null
  return (
    <div style={{width:size, height:size, borderRadius:4, background:colorNota(n), color:'#fff',
      display:'flex', alignItems:'center', justifyContent:'center', fontSize:size * 0.56, fontWeight:900,
      letterSpacing:-0.5, flexShrink:0}}>{n}</div>
  )
}

// Diagrama de un cruce: el faltante a la izquierda, sus sobrantes a la derecha.
// El faltante es una sola barra de la que salen bandas en abanico; cada banda es
// la cantidad que probablemente quedó registrada en ese otro código.
const sinPrefijoComun = (a, b) => {                 // "PUERTA EXTERIOR DESCONTINUADA 80X200" → "DESCONTINUADA 80X200"
  const pa = String(a || '').split(/\s+/), pb = String(b || '').split(/\s+/)
  let i = 0; while (i < pa.length - 1 && i < pb.length && normTxt(pa[i]) === normTxt(pb[i])) i++
  return i >= 2 ? pa.slice(i).join(' ') : String(a || '')
}
export function GrafCruce({g}) {
  const n = g.sobrantes.length, gap = 10
  const H = Math.max(110, n * 40 + 24), top = 12, alto = H - 24
  const xL = 280, wN = 13, xR = GW - 236
  const sc = (alto - gap * Math.max(0, n - 1)) / Math.max(g.faltUds, g.uds)
  const hL = Math.max(3, g.faltUds * sc)
  const yL = top + (alto - hL) / 2
  let ya = yL, yb = top
  const orden = [...g.sobrantes].sort((a, b) => String(a.d.producto).localeCompare(String(b.d.producto), 'es', {numeric:true}))
  const bandas = orden.map(s => {
    const h = Math.max(2, s.q * sc)
    const b = {s, y1:ya, y2:ya + h, r1:yb, r2:yb + h}
    ya += h; yb += h + gap
    return b
  })
  const mx = (xL + wN + xR) / 2
  return (
    <svg viewBox={`0 0 ${GW} ${H}`} width="100%" role="img" style={{display:'block'}}>
      {bandas.map((b, i) => (
        <path key={'p' + i} d={`M ${xL + wN} ${b.y1} C ${mx} ${b.y1}, ${mx} ${b.r1}, ${xR} ${b.r1} L ${xR} ${b.r2} C ${mx} ${b.r2}, ${mx} ${b.y2}, ${xL + wN} ${b.y2} Z`}
          fill={IV.navy} fillOpacity="0.13" stroke={IV.navy} strokeOpacity="0.22">
          <title>{`${fmtN(b.s.q)} uds de ${g.falt.producto} probablemente registradas como ${b.s.d.producto}`}</title>
        </path>
      ))}
      <rect x={xL} y={yL} width={wN} height={hL} fill={IV.rojo} rx="1.5"/>
      <TxtHalo x={xL - 12} y={yL + hL / 2 - 4} anchor="end" size={11.5} weight={800}>{trunc(g.falt.producto || g.falt.sku, 36)}</TxtHalo>
      <text x={xL - 12} y={yL + hL / 2 + 12} textAnchor="end" fontSize="11" fontWeight="700" fill={IV.rojo}>
        {`faltan ${fmtN(g.faltUds)} uds${g.valFalt ? ` · ${fmtM(g.valFalt)}` : ''}`}</text>
      {bandas.map((b, i) => {
        const cy = (b.r1 + b.r2) / 2
        return (
          <g key={'n' + i}>
            <rect x={xR} y={b.r1} width={wN} height={b.r2 - b.r1} fill={IV.verde} rx="1.5"/>
            <text x={xR + wN + 10} y={cy - 2} fontSize="11.5" fontWeight="700" fill={IV.ink}>{trunc(sinPrefijoComun(b.s.d.producto, g.falt.producto), 26)}</text>
            <text x={xR + wN + 10} y={cy + 12} fontSize="10.5" fontWeight="700" fill={IV.verde}>
              {`sobran ${fmtN(b.s.total)}${b.s.q < b.s.total ? ` · ${fmtN(b.s.q)} del cruce` : ''}`}</text>
          </g>
        )
      })}
    </svg>
  )
}

// Bloque reutilizable: lista de cruces con sus diagramas
function BloqueCruces({cr, nombreInv, puedeVerCostos, max = 3}) {
  if (!cr.grupos.length) return null
  return (<>
    {cr.grupos.slice(0, max).map((g, i) => (
      <Caja key={i} x={{marginBottom:10}}>
        <div style={{display:'flex', alignItems:'center', gap:10, padding:'9px 14px', borderBottom:`1px solid ${IV.lineSoft}`, flexWrap:'wrap'}}>
          <Punto c={g.conf === 'ALTA' ? IV.navy : IV.slate}>CONFIANZA {g.conf}</Punto>
          <span style={{fontSize:11.5, color:IV.slate}}>
            {fmtN(g.uds)} de {fmtN(g.faltUds)} uds explicadas ({fmtP(g.cob * 100, 0)})
            {nombreInv ? ` · ${nombreInv(g.inv)}` : ''}
          </span>
          {puedeVerCostos && g.valFalt > 0 && (
            <span style={{marginLeft:'auto', fontSize:11.5, fontWeight:700, color:IV.navy}}>
              {fmtCLP(g.valFalt)} no son pérdida
            </span>
          )}
        </div>
        <div style={{padding:'8px 8px 4px'}}><GrafCruce g={g}/></div>
      </Caja>
    ))}
    {cr.grupos.length > max && (
      <Caja>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:760}}>
          <thead><tr>
            <th style={th()}>Faltante</th><th style={th()}>Probablemente registrado como</th>
            <th style={th(true)}>Uds</th><th style={th(true)}>Cobertura</th>{puedeVerCostos && <th style={th(true)}>Valor</th>}<th style={th()}>Confianza</th>
          </tr></thead>
          <tbody>{cr.grupos.slice(max, max + 25).map((g, i) => (
            <tr key={i}>
              <td style={td(false, {fontWeight:700, fontSize:12})}>{g.falt.producto || g.falt.sku}</td>
              <td style={td(false, {fontSize:11.5, color:IV.slate})}>{g.sobrantes.map(s => trunc(s.d.producto || s.d.sku, 34)).join(' · ')}</td>
              <td style={td(true)}>{fmtN(g.uds)}</td>
              <td style={td(true)}>{fmtP(g.cob * 100, 0)}</td>
              {puedeVerCostos && <td style={td(true, {fontWeight:700})}>{fmtCLP(g.valFalt)}</td>}
              <td style={td(false)}><Punto c={g.conf === 'ALTA' ? IV.navy : IV.slate}>{g.conf}</Punto></td>
            </tr>
          ))}</tbody>
        </table>
      </Caja>
    )}
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// FICHA DEL INVENTARIO — los resultados de un conteo, contra su propia historia
// ═══════════════════════════════════════════════════════════════════════════
const COLS_CAB_FICHA = 'id,sucursal_codigo,sucursal_nombre,tipo_inventario,estado,fecha_planificada,fecha_ejecucion_real,' +
  'categoria_asignada,categorias_asignadas,supervisor_nombre,contador_a_nombre,contador_b_nombre,' +
  'ajuste_folio_bsale,ajuste_fecha,ajuste_sin_movimiento,es_prueba,notas'

export function InvFicha({invId, cu, sucs = [], soloSuc = null, onBack}) {
  const rol = cu?.rol || ''
  const puedeVerCostos = ['admin','dir_general','dir_finanzas'].includes(rol)
  const [inv, setInv]     = useState(null)
  const [dets, setDets]   = useState(null)
  const [prev, setPrev]   = useState({cabs:[], dets:[]})
  const [ventas, setVen]  = useState([])
  const [err, setErr]     = useState('')
  const [copiado, setCop] = useState(false)

  useEffect(() => {
    let vivo = true
    setInv(null); setDets(null); setErr('')
    ;(async () => {
      try {
        const { data:cab, error } = await supabase.from('log_inv_cabeceras').select(COLS_CAB_FICHA).eq('id', invId).maybeSingle()
        if (error) throw error
        if (!cab) throw new Error('Inventario no encontrado')
        const ds = await fetchDetalles([invId])
        const f = fechaEf(cab)
        const { data:pc } = await supabase.from('log_inv_cabeceras')
          .select('id,sucursal_codigo,tipo_inventario,fecha_planificada,fecha_ejecucion_real,categoria_asignada,categorias_asignadas')
          .eq('sucursal_codigo', cab.sucursal_codigo).eq('estado', 'CERRADO').eq('es_prueba', false)
          .lt('fecha_planificada', f).order('fecha_planificada', {ascending:false}).limit(8)
        const pcs = (pc || []).filter(c => c.id !== invId)
        const pds = pcs.length ? await fetchDetalles(pcs.map(c => c.id)) : []
        let vs = []
        if (puedeVerCostos) {
          for (let from = 0; ; from += 1000) {
            const { data, error:ev } = await supabase.from('inv_ventas_mes')
              .select('sku,sucursal_id,periodo,qty_neta,neto_neto').like('periodo', `${anioDe(f)}-%`)
              .order('id').range(from, from + 999)
            if (ev) break
            vs = vs.concat(data || [])
            if (!data || data.length < 1000) break
          }
        }
        if (vivo) { setInv(cab); setDets(ds); setPrev({cabs:pcs, dets:pds}); setVen(vs) }
      } catch (e) { if (vivo) setErr(e.message) }
    })()
    return () => { vivo = false }
    // eslint-disable-next-line
  }, [invId])

  const R = useMemo(() => {
    if (!inv || !dets) return null
    const cabIdx = {[inv.id]:inv, ...Object.fromEntries(prev.cabs.map(c => [c.id, c]))}
    const padreDe = s => sucs.find(x => x.codigo === s)?.codigo_padre || s
    const pm = {}, pg = {}
    ventas.forEach(r => {
      const s = ERP2LOG[r.sucursal_id], q = Number(r.qty_neta) || 0, n = Number(r.neto_neto) || 0
      if (!s || q <= 0 || n <= 0) return
      const k = `${s}|${r.sku}`
      ;(pm[k] = pm[k] || {q:0, n:0}); pm[k].q += q; pm[k].n += n
      ;(pg[r.sku] = pg[r.sku] || {q:0, n:0}); pg[r.sku].q += q; pg[r.sku].n += n
    })
    const precioDe = ventas.length ? d => {
      const k = `${padreDe(cabIdx[d.inventario_id]?.sucursal_codigo)}|${d.sku}`
      const x = pm[k] || pg[d.sku]
      return x ? x.n / x.q : null
    } : null
    const abc = clasificarABC([...dets, ...prev.dets], cabIdx)
    const M = calcular(dets, abc, cabIdx, precioDe)
    const cruces = detectarCruces(dets)
    const acuerdo = acuerdoContadores(dets)
    const nota = calificar(M, acuerdo)
    const contadas = dets.filter(esContada)
    const skus = new Set(contadas.map(d => d.sku))
    const prevPorInv = agrupar(prev.dets, d => d.inventario_id)
    const comparable = prev.cabs.map(c => {
      const ds = (prevPorInv[c.id] || []).filter(esContada)
      const inter = ds.filter(d => skus.has(d.sku)).length
      return {cab:c, ds, overlap:skus.size ? inter / skus.size : 0}
    }).find(x => x.overlap >= 0.3 && x.ds.length) || null
    const Mc = comparable ? calcular(comparable.ds, abc, cabIdx, precioDe) : null
    const hist = prev.cabs.map(c => ({cab:c, ...calcular(prevPorInv[c.id] || [], abc, cabIdx, null)})).filter(x => x.contadas > 0)
    const eriProm = hist.length ? hist.reduce((s, x) => s + x.eri, 0) / hist.length : null
    const difAntes = new Map((comparable?.ds || []).filter(d => Math.round(Number(d.diferencia) || 0) !== 0)
      .map(d => [d.sku, Number(d.diferencia)]))
    const reinc = contadas.filter(d => Math.round(Number(d.diferencia) || 0) !== 0 && difAntes.has(d.sku))
    const enCruce = new Set(cruces.grupos.flatMap(g => [g.falt.sku, ...g.sobrantes.map(s => s.d.sku)]))
    const cats = [...new Set(contadas.map(d => d.tipo_producto || 'Sin categoría'))]
    const valorOk = puedeVerCostos && M.lineasCosto > 0
    const bal = d => valorOk ? (costoDe(d) === null ? 0 : (Number(d.diferencia) || 0) * costoDe(d)) : (Number(d.diferencia) || 0)
    let puente
    if (cats.length >= 2) {
      const g = agrupar(contadas, d => d.tipo_producto || 'Sin categoría')
      puente = Object.entries(g).map(([k, ds]) => ({label:k, v:ds.reduce((s, d) => s + bal(d), 0)}))
    } else {
      puente = contadas.filter(d => Math.round(Number(d.diferencia) || 0) !== 0)
        .map(d => ({label:d.producto || d.sku, v:bal(d)}))
    }
    const orden = puente.filter(x => x.v).sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    const cab10 = orden.slice(0, 10), cola = orden.slice(10)
    const itemsPuente = [...cab10.filter(x => x.v < 0).sort((a, b) => a.v - b.v), ...cab10.filter(x => x.v >= 0).sort((a, b) => b.v - a.v)]
      .concat(cola.length ? [{label:`Resto (${cola.length})`, v:cola.reduce((s, x) => s + x.v, 0)}] : [])
    const totalPuente = orden.reduce((s, x) => s + x.v, 0)
    const buckets = [0, 0, 0, 0, 0, 0]
    contadas.forEach(d => {
      const dif = Math.abs(Number(d.diferencia) || 0)
      if (Math.round(dif) === 0) { buckets[0]++; return }
      const r = dif / Math.max(Number(d.stock_sistema) || 0, 1)
      buckets[r <= 0.02 ? 1 : r <= 0.05 ? 2 : r <= 0.10 ? 3 : r <= 0.25 ? 4 : 5]++
    })
    const detalle = contadas.filter(d => Math.round(Number(d.diferencia) || 0) !== 0).map(d => {
      const c = costoDe(d), pv = precioDe ? precioDe(d) : null
      return {d, dif:Number(d.diferencia), c, imp:c !== null ? Math.abs(Number(d.diferencia) * c) : 0,
        impV:Math.abs(Number(d.diferencia) * (pv ?? c ?? 0)), reinc:difAntes.has(d.sku), antes:difAntes.get(d.sku), cruce:enCruce.has(d.sku)}
    }).sort((a, b) => (b.imp - a.imp) || (Math.abs(b.dif) - Math.abs(a.dif)))
    // Recomendaciones: qué hacer, en orden
    const rec = []
    if (cruces.grupos.length) rec.push({sev:'ambar', t:`Reclasificar en BSALE los ${cruces.grupos.length} cruces de código detectados antes de ajustar`,
      d:`${fmtN(cruces.uds)} unidades${valorOk ? ` por ${fmtCLP(cruces.valFalt)}` : ''} no son pérdida: son producto registrado con el código equivocado. Ajustarlas como pérdida y ganancia deja el error vivo para el próximo conteo.`})
    const pendienteAjuste = !inv.ajuste_folio_bsale && !inv.ajuste_sin_movimiento && (M.faltN + M.sobrN) > 0
    if (pendienteAjuste) rec.push({sev:'rojo', t:'Registrar el comprobante del ajuste en BSALE',
      d:'El inventario tiene diferencias y no hay folio ni documento de ajuste respaldado.'})
    if (reinc.length >= 3) rec.push({sev:'ambar', t:`${fmtN(reinc.length)} productos repiten diferencia respecto del conteo anterior`,
      d:'Cuando el error se repite no es de conteo: revisar ubicación física, unidad de medida y cómo se recibe ese producto.'})
    if (acuerdo !== null && acuerdo < 85) rec.push({sev:'ambar', t:`Los contadores discreparon en el ${fmtP(100 - acuerdo, 0)} de las líneas`,
      d:'Reforzar el conteo ciego: los dos contadores no deben ver el número del otro ni el del sistema.'})
    if (valorOk && M.pctPerd !== null && M.pctPerd > 1) rec.push({sev:'rojo', t:`Pérdida neta de ${fmtP(M.pctPerd, 2)}: sobre el límite del 1%`,
      d:'Si el conteo es cíclico del trimestre, esta diferencia bloquea el bono de la bodega.'})
    if (M.eri !== null && M.eri < 70) {
      const peores = Object.entries(agrupar(contadas, d => d.tipo_producto || 'Sin categoría'))
        .map(([k, ds]) => ({k, e:ds.filter(d => Math.round(Number(d.diferencia) || 0) === 0).length / ds.length * 100, n:ds.length}))
        .filter(x => x.n >= 5).sort((a, b) => a.e - b.e).slice(0, 2)
      rec.push({sev:'rojo', t:'Exactitud bajo 70%: programar reconteo dirigido',
        d:peores.length ? `Partir por ${peores.map(p => `${p.k} (${fmtP(p.e, 0)})`).join(' y ')}.` : 'Priorizar los productos de mayor impacto de la tabla.'})
    }
    if (!rec.length) rec.push({sev:'verde', t:'Conteo limpio', d:'Sin cruces, sin reincidencias relevantes y con el ajuste respaldado.'})
    return {M, Mc, comparable, hist, eriProm, cruces, acuerdo, nota, reinc, cats, itemsPuente, totalPuente, valorOk,
      buckets, detalle, rec, hayPrecio:!!precioDe, padreDe}
    // eslint-disable-next-line
  }, [inv, dets, prev, ventas])

  if (err) return <Vacio t="No se pudo abrir el inventario" s={err}/>
  if (!R) return <Vacio t="Analizando el conteo…"/>
  if (Array.isArray(soloSuc) && !soloSuc.includes(inv.sucursal_codigo))
    return <Vacio t="Sin acceso a esta bodega"/>

  const {M, Mc, nota, cruces} = R
  const nomSuc = sucs.find(s => s.codigo === inv.sucursal_codigo)?.nombre || inv.sucursal_nombre || inv.sucursal_codigo
  const cats = Array.isArray(inv.categorias_asignadas) && inv.categorias_asignadas.length ? inv.categorias_asignadas.join(', ') : (inv.categoria_asignada || 'Todas las categorías')
  const pctExpl = M.faltVal > 0 ? cruces.valFalt / M.faltVal * 100 : null
  const titular = R.valorOk
    ? `Se contaron ${fmtN(M.contadas)} líneas por ${fmtM(M.valorSis)}: el ${fmtP(M.eri, 0)} cuadró exacto y el balance fue ${fmtSM(M.balance)}.`
    : `Se contaron ${fmtN(M.contadas)} líneas: el ${fmtP(M.eri, 0)} cuadró exacto, con ${fmtN(M.faltN)} faltantes y ${fmtN(M.sobrN)} sobrantes.`
  const bajada = [
    cruces.grupos.length ? `${cruces.grupos.length} cruce${cruces.grupos.length === 1 ? '' : 's'} de código explica${cruces.grupos.length === 1 ? '' : 'n'} ${R.valorOk && pctExpl !== null ? `el ${fmtP(pctExpl, 0)} de la pérdida` : `${fmtN(cruces.uds)} unidades faltantes`}: no es mercadería perdida.` : null,
    Mc && Mc.eri !== null ? `Contra el conteo anterior del mismo alcance (${fechaEf(R.comparable.cab)}), la exactitud ${M.eri >= Mc.eri ? 'subió' : 'bajó'} de ${fmtP(Mc.eri, 0)} a ${fmtP(M.eri, 0)}.` : null,
  ].filter(Boolean).join(' ')

  async function copiar() {
    const L = []
    L.push(`INVENTARIO ${inv.id}`)
    L.push(`${nomSuc} · ${fechaEf(inv)} · ${inv.tipo_inventario === 'GENERAL' ? 'General' : 'Cíclico'} · ${cats}`)
    if (nota) L.push(`Calificación ${nota.nota} (${Math.round(nota.score)}/100) — ${LEYENDA_NOTA[nota.nota]}`)
    L.push('', titular)
    if (bajada) L.push(bajada)
    L.push('', `Líneas contadas ${fmtN(M.contadas)} · ERI ${fmtP(M.eri)} · con tolerancia ${fmtP(M.eriTol)}`)
    if (R.valorOk) L.push(`Pérdida ${fmtCLP(M.faltVal)} · Ganancia ${fmtCLP(M.sobrVal)} · Balance ${fmtCLP(M.balance)} (${fmtP(-M.pctPerd, 2)})`)
    if (cruces.grupos.length) {
      L.push('', 'CRUCES DE CÓDIGO')
      cruces.grupos.slice(0, 6).forEach(g => L.push(`· ${g.falt.producto}: −${fmtN(g.faltUds)} → ${g.sobrantes.map(s => `${s.d.producto} +${fmtN(s.q)}`).join(', ')} (${g.conf})`))
    }
    L.push('', 'QUÉ HACER')
    R.rec.forEach(r => L.push(`· ${r.t}`))
    try { await navigator.clipboard.writeText(L.join('\n')); setCop(true); setTimeout(() => setCop(false), 2500) } catch (e) { /* sin portapapeles */ }
  }

  const tot = R.buckets.reduce((s, n) => s + n, 0) || 1
  const BK = [['Exacto (0)', IV.verde], ['Hasta 2%', IV.verde], ['2% a 5%', IV.ambar], ['5% a 10%', IV.ambar], ['10% a 25%', IV.rojo], ['Más de 25%', IV.rojo]]
  const sevC = {rojo:IV.rojo, ambar:IV.ambar, verde:IV.verde}

  return (<>
    {/* Cabecera del documento */}
    <div style={{display:'flex', alignItems:'flex-start', gap:14, marginBottom:14, flexWrap:'wrap'}}>
      <div style={{flex:1, minWidth:280}}>
        <div style={{fontSize:10.5, fontWeight:700, letterSpacing:1.1, color:IV.slate, textTransform:'uppercase'}}>
          Ficha del conteo · {inv.tipo_inventario === 'GENERAL' ? 'Inventario general' : 'Inventario cíclico'}
        </div>
        <div style={{fontSize:20, fontWeight:800, color:IV.ink, letterSpacing:-0.3, marginTop:2}}>{nomSuc} · {fechaEf(inv)}</div>
        <div style={{fontSize:11.5, color:IV.slate, marginTop:3}}>
          {inv.id} · {cats}{inv.supervisor_nombre ? ` · supervisó ${inv.supervisor_nombre}` : ''}
          {(inv.contador_a_nombre || inv.contador_b_nombre) ? ` · contaron ${[inv.contador_a_nombre, inv.contador_b_nombre].filter(Boolean).join(' y ')}` : ''}
        </div>
      </div>
      <div style={{display:'flex', gap:8, alignItems:'center'}}>
        <button onClick={copiar} style={btn('outline')}>{copiado ? 'COPIADO' : 'COPIAR INFORME'}</button>
        {onBack && <button onClick={onBack} style={btn('ghost')}>← VOLVER</button>}
      </div>
    </div>

    {/* Titular + calificación */}
    <div style={{display:'flex', gap:0, border:`1px solid ${IV.line}`, borderRadius:4, background:'#fff', marginBottom:14, overflow:'hidden', flexWrap:'wrap'}}>
      <div style={{flex:1, minWidth:300, padding:'14px 18px', borderLeft:`4px solid ${nota ? colorNota(nota.nota) : IV.navy}`}}>
        <div style={{fontSize:17, fontWeight:800, color:IV.ink, letterSpacing:-0.3, lineHeight:1.35}}>{titular}</div>
        {bajada && <div style={{fontSize:12.5, color:IV.slate, marginTop:6, lineHeight:1.55}}>{bajada}</div>}
      </div>
      {nota && (
        <div style={{padding:'12px 18px', borderLeft:`1px solid ${IV.lineSoft}`, display:'flex', gap:14, alignItems:'center', minWidth:260}}>
          <Nota n={nota.nota} size={54}/>
          <div>
            <div style={{fontSize:10, fontWeight:700, letterSpacing:0.7, color:IV.slate, textTransform:'uppercase'}}>Calificación del conteo</div>
            <div style={{fontSize:13, fontWeight:800, color:colorNota(nota.nota), marginTop:1}}>{LEYENDA_NOTA[nota.nota]}</div>
            <div style={{fontSize:10.5, color:IV.slate, marginTop:3, lineHeight:1.5}}>
              {nota.comps.map(c => `${c.l.split(' ').slice(-1)[0]} ${fmtP(c.v, 0)}`).join(' · ')} · {Math.round(nota.score)}/100
            </div>
          </div>
        </div>
      )}
    </div>

    <Strip>
      <Kpi l="Líneas contadas" v={fmtN(M.contadas)} s={`${R.cats.length} categoría${R.cats.length === 1 ? '' : 's'}`}/>
      <Kpi l="ERI estricto" v={fmtP(M.eri)} c={semERI(M.eri)} delta={Mc && Mc.eri !== null ? M.eri - Mc.eri : null} s={Mc ? 'contra el conteo anterior' : 'sin conteo anterior comparable'}/>
      <Kpi l="ERI con tolerancia" v={fmtP(M.eriTol)} c={semERI(M.eriTol)}/>
      {R.valorOk && <Kpi l="Pérdida" v={fmtM(M.faltVal)} c={IV.rojo} s={`${fmtN(M.faltN)} líneas`}/>}
      {R.valorOk && <Kpi l="Ganancia" v={fmtM(M.sobrVal)} c={IV.verde} s={`${fmtN(M.sobrN)} líneas`}/>}
      {R.valorOk && <Kpi l="Balance" v={fmtSM(M.balance)} c={M.balance < 0 ? IV.rojo : IV.verde} s={`${fmtP(-M.pctPerd, 2)} de ${fmtM(M.valorSis)}`}/>}
      {!R.valorOk && <Kpi l="Faltantes" v={fmtN(M.faltN)} c={IV.rojo} s={`${fmtN(M.faltUds)} uds`}/>}
      {!R.valorOk && <Kpi l="Sobrantes" v={fmtN(M.sobrN)} c={IV.verde} s={`${fmtN(M.sobrUds)} uds`}/>}
      {R.acuerdo !== null && <Kpi l="Acuerdo contadores" v={fmtP(R.acuerdo, 0)} c={R.acuerdo >= 90 ? IV.verde : R.acuerdo >= 75 ? IV.ambar : IV.rojo} s="conteo 1 igual al 2"/>}
      {cruces.grupos.length > 0 && <Kpi l="Cruces de código" v={fmtN(cruces.grupos.length)} c={IV.navy} s={R.valorOk ? `${fmtM(cruces.valFalt)} no son pérdida` : `${fmtN(cruces.uds)} uds`}/>}
    </Strip>

    <div style={{display:'grid', gridTemplateColumns:'minmax(0,1.3fr) minmax(0,1fr)', gap:18, marginBottom:20, alignItems:'start'}}>
      <div>
        <Titular t="Qué hacer con este conteo" s="en orden de prioridad"/>
        <Caja>
          {R.rec.map((r, i) => (
            <div key={i} style={{display:'flex', gap:12, padding:'10px 14px', boxShadow:`inset 3px 0 0 ${sevC[r.sev]}`,
              borderBottom:i < R.rec.length - 1 ? `1px solid ${IV.lineSoft}` : 'none'}}>
              <div style={{fontSize:13, fontWeight:900, color:sevC[r.sev], minWidth:18}}>{i + 1}</div>
              <div>
                <div style={{fontSize:12.5, fontWeight:700, color:IV.ink}}>{r.t}</div>
                <div style={{fontSize:11.5, color:IV.slate, marginTop:2, lineHeight:1.5}}>{r.d}</div>
              </div>
            </div>
          ))}
        </Caja>
      </div>
      <div>
        <Titular t="Contra su historia" s={`${R.hist.length} conteo${R.hist.length === 1 ? '' : 's'} anteriores de la bodega`}/>
        <Caja pad="12px 14px">
          {[
            ['Este conteo', M.eri, true],
            ...(Mc ? [[`Anterior comparable · ${fechaEf(R.comparable.cab)}`, Mc.eri]] : []),
            ...(R.eriProm !== null ? [[`Promedio de los últimos ${R.hist.length}`, R.eriProm]] : []),
            ['Meta', 90],
          ].map(([l, v, este]) => (
            <div key={l} style={{display:'flex', alignItems:'center', gap:10, padding:'5px 0'}}>
              <div style={{fontSize:11.5, minWidth:170, color:este ? IV.ink : IV.slate, fontWeight:este ? 800 : 600}}>{l}</div>
              <div style={{flex:1, height:este ? 13 : 9, background:IV.lineSoft, borderRadius:2, overflow:'hidden'}}>
                <div style={{width:`${Math.max(0, Math.min(100, v || 0))}%`, height:'100%', background:l === 'Meta' ? IV.slate : semERI(v), opacity:este ? 1 : 0.7}}/>
              </div>
              <div style={{fontSize:12, fontWeight:800, minWidth:48, textAlign:'right', color:l === 'Meta' ? IV.slate : semERI(v)}}>{fmtP(v, 0)}</div>
            </div>
          ))}
          {R.reinc.length > 0 && (
            <div style={{fontSize:11.5, color:IV.ambar, marginTop:8, fontWeight:600}}>
              {fmtN(R.reinc.length)} productos ya tenían diferencia en el conteo anterior.
            </div>
          )}
          {!Mc && <div style={{fontSize:11, color:IV.slate, marginTop:8}}>No hay un conteo anterior que cubra al menos el 30% de los mismos productos.</div>}
        </Caja>
      </div>
    </div>

    {cruces.grupos.length > 0 && (
      <div style={{marginBottom:20}}>
        <Titular t={`Cruces de código: ${fmtN(cruces.uds)} unidades faltantes aparecen como sobrantes de productos hermanos`}
          s="Reclasificar en BSALE antes de ajustar · la banda muestra qué unidades pasaron a qué código"/>
        <BloqueCruces cr={cruces} puedeVerCostos={R.valorOk}/>
      </div>
    )}

    <div style={{display:'grid', gridTemplateColumns:'minmax(0,1.3fr) minmax(0,1fr)', gap:18, marginBottom:20, alignItems:'start'}}>
      <div>
        <Titular t={R.cats.length >= 2 ? 'Balance por categoría' : 'Balance por producto'}
          s={R.valorOk ? 'a costo · primero lo que resta, después lo que suma' : 'en unidades · primero lo que resta, después lo que suma'}/>
        <Caja>
          {R.itemsPuente.length ? (
            <div style={{padding:'10px 8px 4px'}}>
              <GrafPuente items={R.itemsPuente} total={R.totalPuente}
                fmt={R.valorOk ? fmtSM : (v => `${v > 0 ? '+' : ''}${fmtN(v)} uds`)}/>
            </div>
          ) : <div style={{padding:16, fontSize:12, color:IV.slate}}>Sin diferencias.</div>}
        </Caja>
      </div>
      <div>
        <Titular t="Tamaño del error" s="diferencia relativa al stock sistema"/>
        <Caja pad="12px 14px">
          {BK.map(([l, c], i) => (
            <div key={l} style={{display:'flex', alignItems:'center', gap:10, padding:'4px 0'}}>
              <div style={{fontSize:12, minWidth:86}}>{l}</div>
              <div style={{flex:1, height:13, background:IV.lineSoft, borderRadius:2, overflow:'hidden'}}>
                <div style={{width:`${R.buckets[i] / tot * 100}%`, height:'100%', background:c}}/>
              </div>
              <div style={{fontSize:12, fontWeight:700, minWidth:74, textAlign:'right'}}>{fmtN(R.buckets[i])} · {fmtP(R.buckets[i] / tot * 100, 0)}</div>
            </div>
          ))}
        </Caja>
      </div>
    </div>

    <Seccion titulo="Diferencias del conteo" sub={`${fmtN(R.detalle.length)} líneas con diferencia · ordenadas por impacto`}>
      {R.detalle.length === 0 ? <Vacio t="Todas las líneas cuadraron"/> : (
        <Caja>
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:880}}>
            <thead><tr>
              <th style={th()}>Producto</th><th style={th(true)}>Sistema</th><th style={th(true)}>Conteo 1</th><th style={th(true)}>Conteo 2</th>
              <th style={th(true)}>Físico</th><th style={th(true)}>Diferencia</th>
              {R.valorOk && <th style={th(true)}>Impacto</th>}{R.valorOk && R.hayPrecio && <th style={th(true)}>A venta</th>}
              <th style={th()}>Señales</th>
            </tr></thead>
            <tbody>{R.detalle.slice(0, 40).map((x, i) => {
              const d = x.d, c1 = d.contador1_cantidad, c2 = d.contador2_cantidad
              const disc = !vacio(c1) && !vacio(c2) && Number(c1) !== Number(c2)
              return (
                <tr key={i}>
                  <td style={td()}><div style={{fontWeight:700, fontSize:12}}>{d.producto || d.sku}</div>
                    <div style={{fontSize:10.5, color:IV.slate}}>{d.sku} · {d.tipo_producto}</div></td>
                  <td style={td(true, {color:IV.slate})}>{fmtN(d.stock_sistema)}</td>
                  <td style={td(true, {color:disc ? IV.ambar : IV.slate})}>{vacio(c1) ? '—' : fmtN(c1)}</td>
                  <td style={td(true, {color:disc ? IV.ambar : IV.slate})}>{vacio(c2) ? '—' : fmtN(c2)}</td>
                  <td style={td(true)}>{fmtN(d.stock_fisico)}</td>
                  <td style={td(true, {fontWeight:800, color:x.dif < 0 ? IV.rojo : IV.verde})}>{x.dif > 0 ? '+' : ''}{fmtN(x.dif)}</td>
                  {R.valorOk && <td style={td(true, {fontWeight:700})}>{x.c === null ? <span style={{color:IV.slate, fontWeight:400}}>sin costo</span> : fmtCLP(x.imp)}</td>}
                  {R.valorOk && R.hayPrecio && <td style={td(true, {color:IV.slate})}>{fmtCLP(x.impV)}</td>}
                  <td style={td(false, {whiteSpace:'nowrap'})}>
                    <span style={{display:'inline-flex', gap:6}}>
                      {x.cruce && <span style={{fontSize:9.5, fontWeight:800, letterSpacing:0.4, color:IV.navy, border:`1px solid ${IV.navy}55`, borderRadius:2, padding:'1px 5px'}}>CRUCE</span>}
                      {x.reinc && <span title={`Diferencia anterior: ${x.antes > 0 ? '+' : ''}${fmtN(x.antes)}`}
                        style={{fontSize:9.5, fontWeight:800, letterSpacing:0.4, color:IV.ambar, border:`1px solid ${IV.ambar}55`, borderRadius:2, padding:'1px 5px'}}>REINCIDE</span>}
                      {disc && <span style={{fontSize:9.5, fontWeight:800, letterSpacing:0.4, color:IV.slate, border:`1px solid ${IV.line}`, borderRadius:2, padding:'1px 5px'}}>C1≠C2</span>}
                    </span>
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </Caja>
      )}
    </Seccion>

    <Guia titulo="CÓMO SE LEE ESTA FICHA">
      <strong>La calificación</strong> resume la calidad del conteo: exactitud del registro (50%), exactitud valorizada (30%) y acuerdo entre los dos contadores (20%). A es clase mundial; E pide rehacer o revisar a fondo. Si un componente no está disponible, su peso se reparte entre los otros.
      <div style={{marginTop:6}}><strong>Cruces de código</strong>: un producto que falta y un producto hermano que sobra casi en la misma cantidad, dentro del mismo conteo. Casi siempre es mercadería registrada con el código equivocado: segunda como primera, genérico en vez de por medida, o modelos cruzados. Se corrige reclasificando, no ajustando.</div>
      <div style={{marginTop:6}}><strong>Contra su historia</strong> compara con el último conteo de la misma bodega que cubrió al menos el 30% de los mismos productos, y con el promedio de sus conteos anteriores.</div>
      <div style={{marginTop:6}}><strong>Señales</strong>: CRUCE es parte de un cruce de código; REINCIDE ya tenía diferencia en el conteo anterior; C1≠C2 los contadores no coincidieron.</div>
    </Guia>
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTARIOS — lista de conteos del período con su calificación
// ═══════════════════════════════════════════════════════════════════════════
export function TabInventarios({D, nombreSuc, puedeVerCostos, ficha, setFicha, cu, sucs, scope}) {
  const [orden, setOrden] = useState('fecha')
  if (ficha) return <InvFicha invId={ficha} cu={cu} sucs={sucs} soloSuc={scope} onBack={() => setFicha(null)}/>
  if (!D.porInv.length) return <Vacio t="Sin inventarios en el período"/>
  const filas = [...D.porInv].sort((a, b) => orden === 'nota' ? (a.nota?.score ?? 999) - (b.nota?.score ?? 999)
    : orden === 'cruces' ? (b.crucesVal - a.crucesVal) || (b.crucesN - a.crucesN)
    : (fechaEf(b.cab) || '').localeCompare(fechaEf(a.cab) || ''))
  const dist = ['A','B','C','D','E'].map(n => ({n, c:D.porInv.filter(x => x.nota?.nota === n).length}))
  return (<>
    <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:12}}>
      <Seg valor={orden} onChange={setOrden} opciones={[{k:'fecha', l:'MÁS RECIENTES'}, {k:'nota', l:'PEOR CALIFICACIÓN'}, {k:'cruces', l:'CON CRUCES'}]}/>
      <div style={{display:'flex', gap:6, alignItems:'center', marginLeft:'auto'}}>
        {dist.map(x => (
          <span key={x.n} style={{display:'inline-flex', alignItems:'center', gap:5, fontSize:11.5, color:IV.slate}}>
            <Nota n={x.n} size={20}/> <strong style={{color:IV.ink}}>{x.c}</strong>
          </span>
        ))}
      </div>
    </div>
    <Caja>
      <table style={{width:'100%', borderCollapse:'collapse', minWidth:900}}>
        <thead><tr>
          <th style={th(false, {width:46})}>Nota</th><th style={th()}>Conteo</th><th style={th()}>Alcance</th>
          <th style={th(true)}>Líneas</th><th style={th(true)}>ERI</th>{puedeVerCostos && <th style={th(true)}>Balance</th>}
          <th style={th(true)}>Cruces</th><th style={th()}></th>
        </tr></thead>
        <tbody>{filas.map(x => {
          const c = x.cab
          const cats = Array.isArray(c.categorias_asignadas) && c.categorias_asignadas.length ? c.categorias_asignadas.join(', ') : (c.categoria_asignada || 'General')
          return (
            <tr key={c.id} onClick={() => setFicha(c.id)} style={{cursor:'pointer'}}>
              <td style={td()}><Nota n={x.nota?.nota} size={30}/></td>
              <td style={td()}>
                <div style={{fontWeight:700, fontSize:12.5}}>{nombreSuc(c.sucursal_codigo)} · {fechaEf(c)}</div>
                <div style={{fontSize:10.5, color:IV.slate}}>{c.id}</div>
              </td>
              <td style={td(false, {fontSize:11.5, color:IV.slate, maxWidth:260})}>
                {c.tipo_inventario === 'GENERAL' ? 'General' : 'Cíclico'} · {trunc(cats, 60)}</td>
              <td style={td(true)}>{fmtN(x.contadas)}</td>
              <td style={td(true, {fontWeight:800, color:semERI(x.eri)})}>{fmtP(x.eri, 0)}</td>
              {puedeVerCostos && <td style={td(true, {fontWeight:700, color:x.balance < 0 ? IV.rojo : x.balance > 0 ? IV.verde : IV.slate})}>{fmtSM(x.balance)}</td>}
              <td style={td(true, {color:x.crucesN ? IV.navy : IV.line, fontWeight:x.crucesN ? 800 : 400})}>
                {x.crucesN ? `${x.crucesN}${puedeVerCostos && x.crucesVal ? ` · ${fmtM(x.crucesVal)}` : ''}` : '—'}</td>
              <td style={td(true, {fontSize:10.5, fontWeight:700, color:IV.azul, whiteSpace:'nowrap'})}>FICHA →</td>
            </tr>
          )
        })}</tbody>
      </table>
    </Caja>
  </>)
}
