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
//   REBAJAS PREVIAS Rebajas de stock registradas días antes de contar (posibles
//                   "ajustes fantasma"): pérdida oculta y correlación temporal
//   LIBRO           Inventario por inventario y categoría por categoría:
//                   desapariciones, apariciones, rebajas previas y acumulado
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
const MES_LARGO = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const frasePeriodo = (per, anio) => per === 'anio' ? `En ${anio}` : per[0] === 'Q' ? `En el Q${per.slice(1)} de ${anio}` : `En ${MES_LARGO[Number(per.slice(1)) - 1]} de ${anio}`
const labelPeriodo = per => per === 'anio' ? 'Año completo'
  : per[0] === 'Q' ? `Q${per.slice(1)} · ${MES[(Number(per.slice(1)) - 1) * 3]}–${MES[Number(per.slice(1)) * 3 - 1]}`
  : MES[Number(per.slice(1)) - 1]

// ── Identidad de línea ──────────────────────────────────────────────────────
// Algunas planillas pasaron por Excel y los códigos de barra largos quedaron en
// notación científica (7.2626e+17): productos distintos terminaron con el mismo
// "SKU". En esos casos el SKU ya no identifica nada y se usa el nombre.
const SKU_CORRUPTO = /^[0-9]\.[0-9]+e\+[0-9]+$/i
export const skuValido = s => !!s && !SKU_CORRUPTO.test(String(s).trim())
export const claveSku = d => skuValido(d.sku) ? String(d.sku).trim()
  : `~${String(d.producto || '').toUpperCase().replace(/\s+/g, ' ').trim()}`

// ── Costos ──────────────────────────────────────────────────────────────────
// Orden: costo del conteo → precio de costo de referencia → costo de las bajas de
// BSALE del mismo SKU (_cref, mediana). El tercero recupera líneas que quedaban
// fuera de la valorización por venir sin costo.
const costoBruto = d => Number(d.costo_unitario) > 0 ? Number(d.costo_unitario)
  : Number(d.precio_costo_ref) > 0 ? Number(d.precio_costo_ref) : (Number(d._cref) || 0)
const usaCref = d => !(Number(d.costo_unitario) > 0) && !(Number(d.precio_costo_ref) > 0) && Number(d._cref) > 0
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
    lineasCosto:0, sinCosto:0, outliers:0, cruces:0, conCref:0}
  for (const d of ds) {
    if (d.stock_fisico === null || d.stock_fisico === undefined) continue
    o.contadas++
    const dif = Number(d.diferencia) || 0
    const sis = Number(d.stock_sistema) || 0
    const exacto = Math.round(dif) === 0
    if (exacto) o.cuadran++
    const cls = abc?.get(`${cabIdx?.[d.inventario_id]?.sucursal_codigo}|${claveSku(d)}`) || 'C'
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
    if (usaCref(d)) o.conCref++
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
    const k = `${cab.sucursal_codigo}|${claveSku(d)}`
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
  const arr = dets.map(d => [claveSku(d), (Number(d.stock_sistema) || 0) * (costoDe(d) || 0)])
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

  const [tab, setTab]         = useState('panorama')     // panorama · inventarios · profundizar
  const [sub, setSub]         = useState('resultado')    // sub-sección de profundizar
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
  const [bajasRaw, setBajas]  = useState(null)       // log_mermas + items + clasificación contable
  const [ventana, setVentana] = useState(15)         // días previos al conteo para rebajas
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

  useEffect(() => {
    if (!puedeVerCostos) return
    let vivo = true
    ;(async () => {
      const pag = async (tabla, cols, filtro) => {
        let all = []
        for (let from = 0; ; from += 1000) {
          let q = supabase.from(tabla).select(cols).order('id').range(from, from + 999)
          if (filtro) q = filtro(q)
          const { data, error } = await q
          if (error) break
          all = all.concat(data || [])
          if (!data || data.length < 1000) break
        }
        return all
      }
      const mermas = await pag('log_mermas', 'id,sucursal_codigo,fecha,tipo,estado,nota', scope ? q => q.in('sucursal_codigo', scope) : null)
      const items  = await pag('log_mermas_items', 'id,merma_id,sku,producto,cantidad,costo_unitario')
      const val    = await pag('v_log_merma_validacion', 'id,categoria_sugerida')
      if (vivo) setBajas({mermas, items, val})
    })()
    return () => { vivo = false }
    // eslint-disable-next-line
  }, [puedeVerCostos, scopeKey])
  const rebajasData = useMemo(() => ({...construirRebajas(bajasRaw), cargado:!!bajasRaw}), [bajasRaw])

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

  const detsCrudos = cache[anio] || []
  const detsAnio = useMemo(() => detsCrudos.map(d =>
    (Number(d.costo_unitario) > 0 || Number(d.precio_costo_ref) > 0 || !skuValido(d.sku)) ? d
      : {...d, _cref:rebajasData.costoRef.get(String(d.sku).trim()) || 0}), [detsCrudos, rebajasData])
  const sig = `${anio}|${suc}|${tipo}|${periodo}|${detsAnio.length}|${(cabs || []).length}|${ventasAnio.length}|` +
              `${rebajasData.rebajas.length}|${rebajasData.costoRef.size}|${ventana}`

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
    const porSucPrev = pPrev && detsPr.length ? Object.fromEntries(Object.entries(agrupar(detsPr, d => cabIdx[d.inventario_id]?.sucursal_codigo))
      .map(([k, ds]) => [k, calcular(ds, abc, cabIdx, precioDe)])) : {}
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
      const k = `${sucOf(d)}|${claveSku(d)}`
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
      const k = `${sucOf(d)}|${claveSku(d)}`
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
    // Rebajas previas: se evalúan sobre el año completo (para detectar el ajuste de
    // un conteo anterior) y se reportan las del período filtrado
    const setDetsP = new Set(detsP)
    const rebPrev = rebajasData.rebajas.length ? rebajasPrevias(detsAnio, cabIdx, rebajasData.rebajas, ventana) : []
    // solo conteos con cobertura completa de bajas: desde la primera baja sincronizada + la ventana
    const evalDesde = rebajasData.desde ? sumarDias(rebajasData.desde, ventana) : null
    const rebPrevP = rebPrev.filter(x => setDetsP.has(x.d) && setA.has(x.d.inventario_id) && (!evalDesde || x.f >= evalDesde))
    const evento = rebajasData.rebajas.length ? eventoRebajas(detsP, cabIdx, rebajasData.rebajas, rebajasData.desde) : {}
    const arrastres = marcarArrastres(detsAnio, cabIdx)
    const libro = construirLibro(detsP, cabsP, rebPrevP, arrastres)
    const arrastresN = detsP.filter(d => arrastres.has(d)).length
    return {cabsA, cabsP, detsA, detsP, abc, M, Mprev, pPrev, porSucPrev, ventaSuc, cruces, rebPrev:rebPrevP, evento, libro, arrastresN, porSuc, porCat, porInv, topSku, top10Share,
            reincidentes, porMes, buckets}
    // eslint-disable-next-line
  }, [sig, cabIdx])

  const cobRiesgo = useMemo(() => riesgo.filter(r => suc === 'todas' || r.sucursal_codigo === suc), [riesgo, suc])

  const TABS = [
    {k:'panorama',    l:'PANORAMA',    d:'Cómo estamos y qué hacer'},
    {k:'inventarios', l:'INVENTARIOS', d:'Conteo por conteo, con el acumulado'},
    {k:'profundizar', l:'PROFUNDIZAR', d:'Análisis especializados'},
  ]
  // Los vínculos internos (diagnóstico, tarjetas) usan nombres de análisis: se traducen a sección
  const irA = k => {
    const m = {resumen:['panorama'], panorama:['panorama'], tendencia:['panorama'], inventarios:['inventarios'], libro:['inventarios'],
      valor:['profundizar','resultado'], resultado:['profundizar','resultado'], rebajas:['profundizar','rebajas'],
      exactitud:['profundizar','exactitud'], cobertura:['profundizar','cobertura'], abc:['profundizar','abc'],
      comparar:['profundizar','comparar'], bono:['profundizar','bono']}[k] || ['panorama']
    setTab(m[0]); if (m[1]) setSub(m[1]); if (m[0] !== 'inventarios') setFicha(null)
  }

  const ctx = {D, cabs:cabs || [], cabIdx, nombreSuc, sucsDisp, puedeVerCostos, puedeVerBono, setTab:irA, setSuc, setPeriodo, sub, setSub,
               anio, suc, periodo, tipo, riesgo:cobRiesgo, detsAnio, onPdfTrimestral, scope,
               ventaSuc:D.ventaSuc, padreDe, hayVentas, cu, sucs, ficha, setFicha,
               abrirFicha:id => { setFicha(id); setTab('inventarios') }, contexto:null,
               rebajasData, ventana, setVentana, anio, periodo}

  const sinFiltrosPropios = !(tab === 'profundizar' && ['comparar','bono'].includes(sub)) && !(tab === 'inventarios' && ficha)
  const contexto = `${suc === 'todas' ? (scope ? 'Mi alcance' : 'Todas las bodegas') : nombreSuc(suc)} · ${anio} · ` +
    `${labelPeriodo(periodo)} · ${tipo === 'todos' ? 'Cíclicos y generales' : tipo === 'CICLICO' ? 'Cíclicos' : 'Generales'}`
  ctx.contexto = contexto

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
          <div key={t.k} onClick={() => { setTab(t.k); if (t.k !== 'inventarios') setFicha(null) }} style={{padding:'6px 4px 9px', cursor:'pointer',
            userSelect:'none', marginBottom:-1, borderBottom:tab === t.k ? `3px solid ${IV.navy}` : '3px solid transparent'}}>
            <div style={{fontSize:12, fontWeight:800, letterSpacing:0.8, color:tab === t.k ? IV.ink : IV.slate}}>{t.l}</div>
            <div style={{fontSize:10.5, color:IV.slate, marginTop:1}}>{t.d}</div>
          </div>
        ))}
      </div>

      {err && (
        <div style={{padding:'8px 12px', marginBottom:12, borderRadius:3, background:IV.tRojo,
          borderLeft:`3px solid ${IV.rojo}`, fontSize:12, color:IV.rojo, fontWeight:600}}>{err}</div>
      )}

      {cabs === null ? <Vacio t="Cargando análisis…"/>
        : cabs.length === 0 ? <Vacio t="Sin inventarios cerrados" s="Cierra al menos un inventario para ver el análisis."/>
        : (<>
          {tab === 'panorama'    && <TabPanorama {...ctx}/>}
          {tab === 'inventarios' && <TabInventarios {...ctx}/>}
          {tab === 'profundizar' && <TabProfundizar {...ctx}/>}
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
  if (puedeVerCostos && (D.rebPrev || []).length) {
    const oc = D.rebPrev.filter(x => x.cuadro).reduce((s, x) => s + x.val, 0)
    const tot = D.rebPrev.reduce((s, x) => s + x.val, 0)
    if (oc >= 500000 || tot >= 2000000)
      H.push({sev:oc >= 5000000 ? 'rojo' : 'ambar', tab:'rebajas',
        t: oc > 0 ? `${fmtM(oc)} de pérdida quedaron ocultos por rebajas registradas antes de contar`
                  : `${fmtM(tot)} en rebajas registradas días antes de los conteos`,
        d:`${fmtN(D.rebPrev.filter(x => x.cuadro).length)} productos se rebajaron y después cuadraron exacto: el conteo se ve bien pero la pérdida solo cambió de lugar.`})
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
// EXACTITUD
// ═══════════════════════════════════════════════════════════════════════════
export function TabExactitud({D, nombreSuc, setSuc, abrirFicha, puedeVerCostos}) {
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
        <Caja pad="12px 14px 0">
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
          <div style={{margin:'10px -14px 0'}}><Lectura como="Cada barra agrupa los productos según qué tan grande fue su diferencia respecto de lo que decía el sistema."
            buscar="Muchas diferencias chicas (hasta 5%) son errores de conteo. Muchas sobre 25% suelen ser producto guardado en otro lugar o una unidad de medida mal cargada."/></div>
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
export function TabResultado({D, nombreSuc, anio, periodo, suc, scope, ventaSuc, padreDe, hayVentas, rebajasData, setTab}) {
  const M = D.M
  const [base, setBase] = useState('costo')
  const [eje, setEje]   = useState('categoria')
  const bajas = rebajasData?.cargado ? true : null     // la merma conocida se toma de las bajas ya clasificadas
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
  // Merma conocida: rebajas clasificadas como merma real por la regla contable
  // (no cuenta lo que pasó a segunda aunque se haya marcado "pérdida")
  const bajasSuc = {}
  const enPer = f => f && anioDe(f) === anio && enPeriodo(f, periodo)
  ;(rebajasData?.todas || []).filter(r => enPer(r.fecha) && (suc === 'todas' || r.suc === suc)).forEach(r => {
    const s = bajasSuc[r.suc] || (bajasSuc[r.suc] = {tot:0, real:0, segunda:0})
    const v = r.q * r.cu
    if (r.clase === 'segunda') s.segunda += v; else s.tot += v
    if (r.clase === 'merma_real') s.real += v
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
      {(D.rebPrev || []).length > 0 && <Kpi l="Rebajas previas" v={fmtM(D.rebPrev.reduce((s, x) => s + x.val, 0))} c={IV.ambar}
        s="rebajado antes de contar" onClick={() => setTab && setTab('rebajas')}/>}
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
          <Leyenda items={[[IV.rojo, 'resta al balance'], [IV.verde, 'suma al balance']]}/>
          <Lectura como="Se parte en cero arriba y cada fila suma (verde) o resta (rojo) según su balance; la barra de abajo es el total. El largo de cada barra es cuánto aporta."
            buscar="Las barras rojas más largas: ahí está la pérdida. Si una roja y una verde grandes son variantes del mismo producto, probablemente es un error de código."/></Caja>
      </div>
      <div>
        <Titular t="Pérdida y ganancia lado a lado"
          s={`Las ${filasMariposa.length} ${eje === 'categoria' ? 'categorías' : 'bodegas'} con más movimiento · el rombo marca el balance`}/>
        <Caja><div style={{padding:'10px 8px 4px'}}><GrafMariposa rows={filasMariposa}/></div>
          <Leyenda items={[[IV.rojo, 'pérdida'], [IV.verde, 'ganancia'], [IV.navy, 'balance', 'rombo']]}/>
          <Lectura como="A la izquierda del eje lo que desapareció, a la derecha lo que apareció. El rombo marca el balance: a la izquierda del eje es pérdida neta, a la derecha ganancia neta."
            buscar="Barras largas a ambos lados con el rombo cerca del centro: se compensan, es desorden de registro. Barra larga solo a la izquierda: pérdida real."/></Caja>
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
        <Leyenda items={[[IV.verde, 'ganancia del mes'], [IV.rojo, 'pérdida del mes'], [IV.navy, 'balance acumulado', 'linea']]}/>
        <Lectura como="Cada columna es un mes: hacia arriba lo que apareció, hacia abajo lo que desapareció, en pesos. La línea es el balance acumulado desde enero."
          buscar="Meses con barras rojas largas y la línea bajando: ahí se perdió plata. Una línea plana significa que los meses se compensan entre sí."/></Caja>
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
        <Caja><div style={{padding:'10px 8px 4px'}}>{matriz.length ? <GrafMatriz pts={matriz}/> : <Vacio t="Sin datos suficientes"/>}</div>
          <Lectura como="Cada círculo es una categoría: hacia la derecha cuadra más, hacia arriba pierde más plata; el tamaño es cuánto vale lo contado. La línea vertical es la meta de 90% y la horizontal el límite de 1% de pérdida."
            buscar="Círculos grandes arriba a la izquierda (crítico): mucha plata, poca exactitud y pérdida. Abajo a la izquierda no pierden plata, pero el registro está desordenado."/></Caja>
      </div>
      <div>
        <Titular t={acc10 !== null ? `${n80} SKUs concentran el 80% del impacto; los 10 primeros, el ${fmtP(acc10, 0)}` : 'Concentración del impacto'}
          s={`Pareto del impacto por SKU ${aV ? 'a precio de venta' : 'a costo'} · barras rojas faltantes, verdes sobrantes`}/>
        <Caja><div style={{padding:'10px 8px 4px'}}><GrafPareto items={pareto} total={totPareto}/></div>
          <Leyenda items={[[IV.rojo, 'faltante'], [IV.verde, 'sobrante'], [IV.navy, 'acumulado', 'linea'], [IV.ambar, '80%', 'linea']]}/>
          <Lectura como="Cada barra es un producto, del que más impacto tiene al que menos (escala de la izquierda, en pesos). La línea azul suma el porcentaje acumulado del impacto total (escala de la derecha)."
            buscar="Dónde la línea cruza el 80%: esos pocos productos explican casi todo el problema. Corregirlos mueve el resultado completo."/></Caja>
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
              <th style={th()}>Bodega</th><th style={th(true)}>Conocida (merma real, regla contable)</th>
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
// CLASE ABC
// ═══════════════════════════════════════════════════════════════════════════
export function TabABC({D, cabIdx, nombreSuc}) {
  const clases = {A:[], B:[], C:[]}
  D.detsP.forEach(d => {
    const k = `${cabIdx[d.inventario_id]?.sucursal_codigo}|${claveSku(d)}`
    clases[D.abc.get(k) || 'C'].push(d)
  })
  const R = Object.fromEntries(Object.entries(clases).map(([k, ds]) => [k, {...calcular(ds, D.abc, cabIdx),
    skus:new Set(ds.map(d => `${cabIdx[d.inventario_id]?.sucursal_codigo}|${claveSku(d)}`)).size}]))
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
  const mA = Object.fromEntries(dA.filter(d => d.stock_fisico !== null).map(d => [claveSku(d), d]))
  const mB = Object.fromEntries(dB.filter(d => d.stock_fisico !== null).map(d => [claveSku(d), d]))
  const comunes = Object.keys(mA).filter(k => mB[k])
  // Mejora = reducción del error ABSOLUTO. El módulo anterior restaba diferencias con
  // signo, y un sobrante que bajaba de +10 a +2 figuraba como "empeoró".
  const filas = comunes.map(sku => {
    const a = mA[sku], b = mB[sku]
    const eA = Math.abs(Number(a.diferencia) || 0), eB = Math.abs(Number(b.diferencia) || 0)
    const c = costoDe(b) ?? costoDe(a)
    return {sku:b.sku || sku, k:sku, producto:b.producto || a.producto, cat:b.tipo_producto, difA:Number(a.diferencia) || 0,
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
              <tr key={f.k}>
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
  const skusCont = new Set(conC.map(d => claveSku(d)))
  const valorCubierto = genDets.filter(d => skusCont.has(claveSku(d))).reduce((s, d) => s + cv(d), 0)
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
      const e = errSku[claveSku(d)] || (errSku[claveSku(d)] = {sku:d.sku, producto:d.producto, veces:0, difTotal:0})
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
      const cand = sobr.filter(s => s.resto > 0 && s.fam === f.fam && claveSku(s.d) !== claveSku(f.d)).map(s => {
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
  const [bajasRaw, setBR] = useState(null)
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
        let br = null
        if (puedeVerCostos) {
          const pag = async (tabla, cols, filtro) => {
            let all = []
            for (let from = 0; ; from += 1000) {
              let q = supabase.from(tabla).select(cols).order('id').range(from, from + 999)
              if (filtro) q = filtro(q)
              const { data, error:eb } = await q
              if (eb) break
              all = all.concat(data || []); if (!data || data.length < 1000) break
            }
            return all
          }
          const mermas = await pag('log_mermas', 'id,sucursal_codigo,fecha,tipo,estado,nota', q => q.eq('sucursal_codigo', cab.sucursal_codigo))
          const items  = await pag('log_mermas_items', 'id,merma_id,sku,producto,cantidad,costo_unitario')
          const val    = await pag('v_log_merma_validacion', 'id,categoria_sugerida')
          br = {mermas, items, val}
        }
        if (vivo) { setInv(cab); setDets(ds); setPrev({cabs:pcs, dets:pds}); setVen(vs); setBR(br) }
      } catch (e) { if (vivo) setErr(e.message) }
    })()
    return () => { vivo = false }
    // eslint-disable-next-line
  }, [invId])

  const R = useMemo(() => {
    if (!inv || !dets) return null
    const RB = construirRebajas(bajasRaw)
    const enr = d => (Number(d.costo_unitario) > 0 || Number(d.precio_costo_ref) > 0 || !skuValido(d.sku)) ? d
      : {...d, _cref:RB.costoRef.get(String(d.sku).trim()) || 0}
    const detsX = dets.map(enr), prevX = prev.dets.map(enr)
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
    const abc = clasificarABC([...detsX, ...prevX], cabIdx)
    const M = calcular(detsX, abc, cabIdx, precioDe)
    const cruces = detectarCruces(detsX)
    const acuerdo = acuerdoContadores(detsX)
    const rebPrev = RB.rebajas.length
      ? rebajasPrevias([...detsX, ...prevX], cabIdx, RB.rebajas, 15).filter(x => x.d.inventario_id === inv.id) : []
    const rebDesde = RB.desde
    const nota = calificar(M, acuerdo)
    const contadas = detsX.filter(esContada)
    const skus = new Set(contadas.map(d => claveSku(d)))
    const prevPorInv = agrupar(prevX, d => d.inventario_id)
    const comparable = prev.cabs.map(c => {
      const ds = (prevPorInv[c.id] || []).filter(esContada)
      const inter = ds.filter(d => skus.has(claveSku(d))).length
      return {cab:c, ds, overlap:skus.size ? inter / skus.size : 0}
    }).find(x => x.overlap >= 0.3 && x.ds.length) || null
    const Mc = comparable ? calcular(comparable.ds, abc, cabIdx, precioDe) : null
    const hist = prev.cabs.map(c => ({cab:c, ...calcular(prevPorInv[c.id] || [], abc, cabIdx, null)})).filter(x => x.contadas > 0)
    const eriProm = hist.length ? hist.reduce((s, x) => s + x.eri, 0) / hist.length : null
    const difAntes = new Map((comparable?.ds || []).filter(d => Math.round(Number(d.diferencia) || 0) !== 0)
      .map(d => [claveSku(d), Number(d.diferencia)]))
    const reinc = contadas.filter(d => Math.round(Number(d.diferencia) || 0) !== 0 && difAntes.has(claveSku(d)))
    const enCruce = new Set(cruces.grupos.flatMap(g => [claveSku(g.falt), ...g.sobrantes.map(s => claveSku(s.d))]))
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
        impV:Math.abs(Number(d.diferencia) * (pv ?? c ?? 0)), reinc:difAntes.has(claveSku(d)), antes:difAntes.get(claveSku(d)), cruce:enCruce.has(claveSku(d))}
    }).sort((a, b) => (b.imp - a.imp) || (Math.abs(b.dif) - Math.abs(a.dif)))
    // Recomendaciones: qué hacer, en orden
    const rec = []
    if (cruces.grupos.length) rec.push({sev:'ambar', t:`Reclasificar en BSALE los ${cruces.grupos.length} cruces de código detectados antes de ajustar`,
      d:`${fmtN(cruces.uds)} unidades${valorOk ? ` por ${fmtCLP(cruces.valFalt)}` : ''} no son pérdida: son producto registrado con el código equivocado. Ajustarlas como pérdida y ganancia deja el error vivo para el próximo conteo.`})
    const pendienteAjuste = !inv.ajuste_folio_bsale && !inv.ajuste_sin_movimiento && (M.faltN + M.sobrN) > 0
    if (pendienteAjuste) rec.push({sev:'rojo', t:'Registrar el comprobante del ajuste en BSALE',
      d:'El inventario tiene diferencias y no hay folio ni documento de ajuste respaldado.'})
    const rebOculto = rebPrev.filter(x => x.cuadro)
    if (rebOculto.length) rec.push({sev:'rojo', t:`${fmtN(rebOculto.length)} productos cuadraron porque se rebajaron días antes del conteo`,
      d:`${fmtCLP(rebOculto.reduce((s, x) => s + x.val, 0))} rebajados en los 15 días previos: el conteo sale cuadrado, pero la pérdida está en la baja. Revisar el respaldo de cada rebaja.`})
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
      buckets, detalle, rec, hayPrecio:!!precioDe, padreDe, rebPrev, rebDesde}
    // eslint-disable-next-line
  }, [inv, dets, prev, ventas, bajasRaw])

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
      {R.rebPrev.length > 0 && <Kpi l="Rebajas previas" v={fmtM(R.rebPrev.reduce((s, x) => s + x.val, 0))} c={IV.ambar}
        s={`${fmtN(R.rebPrev.filter(x => x.cuadro).length)} cuadraron después`}/>}
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
        <div style={{border:`1px solid ${IV.line}`, borderRadius:4, overflow:'hidden'}}>
          <Lectura como="A la izquierda, en rojo, el producto que falta. A la derecha, en verde, los productos parecidos que sobran. Cada banda muestra cuántas unidades probablemente quedaron registradas en ese otro código."
            buscar="Si las bandas cubren casi todo el faltante, no hay pérdida: basta con corregir el código en BSALE."/>
        </div>
      </div>
    )}

    {R.rebPrev.length > 0 && (
      <div style={{marginBottom:20}}>
        <Titular t={R.rebPrev.some(x => x.cuadro)
          ? `${fmtN(R.rebPrev.filter(x => x.cuadro).length)} productos se rebajaron en los 15 días previos y después cuadraron exacto`
          : `${fmtN(R.rebPrev.length)} productos tuvieron rebajas en los 15 días previos al conteo`}
          s="Rebajas de stock (sin contar lo que pasó a segunda) registradas antes de contar estos mismos productos"/>
        <Caja>
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:880}}>
            <thead><tr>
              <th style={th()}>Sospecha</th><th style={th()}>Producto</th><th style={th()}>Rebaja</th>
              <th style={th(true)}>Días antes</th><th style={th(true)}>Uds</th><th style={th(true)}>Costo</th><th style={th(true)}>En el conteo</th>
            </tr></thead>
            <tbody>{[...R.rebPrev].sort((a, b) => b.val - a.val).slice(0, 25).map((x, i) => (
              <tr key={i}>
                <td style={td()}><Punto c={x.sospecha === 'ALTA' ? IV.rojo : x.sospecha === 'MEDIA' ? IV.ambar : IV.slate}>{x.sospecha}</Punto></td>
                <td style={td()}><div style={{fontWeight:700, fontSize:12}}>{x.d.producto || x.d.sku}</div>
                  <div style={{fontSize:10.5, color:IV.slate}}>{x.d.sku}</div></td>
                <td style={td(false, {fontSize:11.5, maxWidth:260})}>
                  <div style={{fontWeight:700}}>{CLASE_BAJA[x.clase] || x.clase}{x.sinInforme ? <span style={{color:IV.rojo}}> · sin informe</span> : ''}</div>
                  <div style={{color:IV.slate}}>{trunc(x.previas[0]?.nota || '—', 50)}</div></td>
                <td style={td(true, {fontWeight:700, color:x.minDias <= 3 ? IV.rojo : IV.ink})}>{x.minDias}</td>
                <td style={td(true)}>{fmtN(x.q)}</td>
                <td style={td(true, {fontWeight:700})}>{fmtCLP(x.val)}</td>
                <td style={td(true, {fontWeight:800, color:x.cuadro ? IV.rojo : x.dif < 0 ? IV.rojo : IV.verde})}>{x.cuadro ? 'cuadró exacto' : `${x.dif > 0 ? '+' : ''}${fmtN(x.dif)}`}</td>
              </tr>
            ))}</tbody>
          </table>
        </Caja>
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
          {R.itemsPuente.length > 0 && <Lectura como="Cada fila suma (verde) o resta (rojo) al resultado del conteo; la barra de abajo es el total. Primero aparece lo que resta y después lo que suma."
            buscar="La barra roja más larga es por dónde empezar a revisar."/>}
        </Caja>
      </div>
      <div>
        <Titular t="Tamaño del error" s="diferencia relativa al stock sistema"/>
        <Caja pad="12px 14px 0">
          {BK.map(([l, c], i) => (
            <div key={l} style={{display:'flex', alignItems:'center', gap:10, padding:'4px 0'}}>
              <div style={{fontSize:12, minWidth:86}}>{l}</div>
              <div style={{flex:1, height:13, background:IV.lineSoft, borderRadius:2, overflow:'hidden'}}>
                <div style={{width:`${R.buckets[i] / tot * 100}%`, height:'100%', background:c}}/>
              </div>
              <div style={{fontSize:12, fontWeight:700, minWidth:74, textAlign:'right'}}>{fmtN(R.buckets[i])} · {fmtP(R.buckets[i] / tot * 100, 0)}</div>
            </div>
          ))}
          <div style={{margin:'10px -14px 0'}}><Lectura como="Los productos del conteo agrupados según qué tan grande fue su diferencia." buscar="Diferencias sobre 25% casi nunca son error de conteo: revisa si el producto está en otra ubicación o si la unidad de medida está bien cargada."/></div>
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
export function TabInventarios(ctx) {
  const {ficha, setFicha, cu, sucs, scope} = ctx
  if (ficha) return <InvFicha invId={ficha} cu={cu} sucs={sucs} soloSuc={scope} onBack={() => setFicha(null)}/>
  return <TabLibro {...ctx}/>
}

// ═══════════════════════════════════════════════════════════════════════════
// REBAJAS PREVIAS AL CONTEO — posibles "ajustes fantasma"
//
// Una rebaja de stock registrada pocos días antes de contar un producto hace que
// el conteo cuadre sin que la pérdida desaparezca: solo cambió de lugar, de
// "diferencia de inventario" a "baja". Si el producto después cuadra exacto, la
// pérdida quedó oculta del indicador.
//
// Regla de clasificación (manda la contable):
//   · Se EXCLUYE lo que va a segunda o cambia de código: clasificación contable
//     "reclasificación"; si no hay contable, tipo segunda, conversión o
//     corrección de SKU. Eso no es una rebaja: el producto sigue en inventario.
//   · Todo lo demás es REBAJA: merma real, ajuste de conteo, corrección de
//     registro, uso interno y sin clasificar.
//   · No es previa la rebaja que ajusta un conteo anterior del mismo SKU (hubo un
//     faltante en los 30 días previos a la rebaja): ese es el ajuste legítimo.
//
// Sospecha:
//   ALTA   el producto cuadró exacto y la rebaja no tiene evidencia física
//          (corrección, ajuste, uso interno, sin clasificar) o fue ≤ 3 días antes
//   MEDIA  cuadró exacto, o no tiene evidencia y tampoco informe
//   BAJA   el resto (típicamente merma real con informe que igual dejó diferencia)
//
// Cobertura: las bajas con detalle por SKU existen desde que se sincronizan
// (log_mermas_items). Los conteos anteriores a esa fecha + la ventana no se evalúan.
// ═══════════════════════════════════════════════════════════════════════════
export const CLASE_BAJA = {merma_real:'Merma real', ajuste_conteo:'Ajuste de conteo', correccion:'Corrección de registro',
  uso_interno:'Uso interno', sin_clasificar:'Sin clasificar', segunda:'A segunda / otro código'}
const SIN_EVIDENCIA = new Set(['correccion','ajuste_conteo','uso_interno','sin_clasificar'])

export function claseBaja(tipo, contable) {
  if (contable === 'reclasificacion') return 'segunda'
  if (!contable && ['segunda_seleccion','conversion','correccion_sku'].includes(tipo)) return 'segunda'
  if (contable) return contable
  if (['destruccion','perdida'].includes(tipo)) return 'merma_real'
  if (['ajuste','ajuste_inventario'].includes(tipo)) return 'ajuste_conteo'
  if (tipo === 'uso_interno') return 'uso_interno'
  return 'sin_clasificar'
}

// Une cabeceras, líneas y clasificación contable de las bajas de BSALE
export function construirRebajas(raw) {
  if (!raw) return {rebajas:[], todas:[], costoRef:new Map(), desde:null}
  const ct = new Map((raw.val || []).map(v => [v.id, v.categoria_sugerida]))
  const hdr = new Map((raw.mermas || []).map(m => [m.id, m]))
  const costos = {}, todas = []
  ;(raw.items || []).forEach(it => {
    const m = hdr.get(it.merma_id); if (!m) return
    const cu = Number(it.costo_unitario) || 0
    const sku = String(it.sku || '').trim()
    if (skuValido(sku) && cu > 0 && cu <= COSTO_MAX) (costos[sku] = costos[sku] || []).push(cu)
    const contable = ct.has(m.id) ? ct.get(m.id) : null
    todas.push({mermaId:m.id, suc:m.sucursal_codigo, fecha:m.fecha, sku, producto:it.producto,
      q:Number(it.cantidad) || 0, cu:cu > 0 && cu <= COSTO_MAX ? cu : 0, tipo:m.tipo, contable,
      clase:claseBaja(m.tipo, contable), estado:m.estado, nota:m.nota})
  })
  const costoRef = new Map(Object.entries(costos).map(([k, arr]) => { arr.sort((a, b) => a - b); return [k, arr[Math.floor(arr.length / 2)]] }))
  const desde = (raw.mermas || []).reduce((mn, m) => !mn || (m.fecha && m.fecha < mn) ? m.fecha : mn, null)
  return {rebajas:todas.filter(x => x.clase !== 'segunda'), todas, costoRef, desde}
}

const diasEntre = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 86400000)
const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

export function rebajasPrevias(dets, cabIdx, rebajas, ventana = 15) {
  const idx = new Map()
  rebajas.forEach(r => { if (!skuValido(r.sku)) return; const k = `${r.suc}|${r.sku}`; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(r) })
  const cont = new Map()
  dets.forEach(d => {
    if (!esContada(d) || !skuValido(d.sku)) return
    const cab = cabIdx[d.inventario_id]; if (!cab) return
    const k = `${cab.sucursal_codigo}|${String(d.sku).trim()}`
    if (!cont.has(k)) cont.set(k, [])
    cont.get(k).push({f:fechaEf(cab), inv:d.inventario_id, dif:Number(d.diferencia) || 0})
  })
  const lineas = []
  dets.forEach(d => {
    if (!esContada(d) || !skuValido(d.sku)) return
    const cab = cabIdx[d.inventario_id]; if (!cab) return
    const f = fechaEf(cab), k = `${cab.sucursal_codigo}|${String(d.sku).trim()}`
    const previas = (idx.get(k) || []).filter(r => { const dd = diasEntre(f, r.fecha); return dd >= 1 && dd <= ventana })
      .filter(r => !(cont.get(k) || []).some(c => c.inv !== d.inventario_id && c.dif < 0 &&
        diasEntre(r.fecha, c.f) >= 0 && diasEntre(r.fecha, c.f) <= 30))
    if (!previas.length) return
    const q = previas.reduce((s, r) => s + r.q, 0), val = previas.reduce((s, r) => s + r.q * r.cu, 0)
    const dif = Number(d.diferencia) || 0, cuadro = Math.round(dif) === 0
    const sinEvid = previas.some(r => SIN_EVIDENCIA.has(r.clase))
    const sinInforme = previas.some(r => r.estado === 'pendiente')
    const minDias = Math.min(...previas.map(r => diasEntre(f, r.fecha)))
    const sospecha = cuadro && (sinEvid || minDias <= 3) ? 'ALTA' : (cuadro || (sinEvid && sinInforme)) ? 'MEDIA' : 'BAJA'
    lineas.push({d, cab, f, previas, q, val, dif, cuadro, sinEvid, sinInforme, minDias, sospecha,
      clase:previas.sort((a, b) => b.q * b.cu - a.q * a.cu)[0].clase})
  })
  return lineas
}

// Rebajas en torno a la fecha del conteo (−30 a +15 días). Cada rebaja se asigna
// al conteo más cercano de ese SKU, para no contarla dos veces.
export function eventoRebajas(dets, cabIdx, rebajas, desde) {
  const conteos = new Map()
  dets.forEach(d => {
    if (!esContada(d) || !skuValido(d.sku)) return
    const cab = cabIdx[d.inventario_id]; if (!cab) return
    const f = fechaEf(cab); if (desde && f < sumarDias(desde, 30)) return
    const k = `${cab.sucursal_codigo}|${String(d.sku).trim()}`
    if (!conteos.has(k)) conteos.set(k, new Set())
    conteos.get(k).add(f)
  })
  const b = {}
  for (let i = -30; i <= 15; i++) b[i] = {val:0, q:0, n:0}
  rebajas.forEach(r => {
    if (!skuValido(r.sku)) return
    const fs = conteos.get(`${r.suc}|${r.sku}`); if (!fs) return
    let mejor = null
    fs.forEach(f => { const o = diasEntre(r.fecha, f); if (o >= -30 && o <= 15 && (mejor === null || Math.abs(o) < Math.abs(mejor))) mejor = o })
    if (mejor === null) return
    b[mejor].val += r.q * r.cu; b[mejor].q += r.q; b[mejor].n++
  })
  return b
}

// Diferencias que se arrastran: el mismo SKU vuelve a contarse con el mismo stock
// de sistema y la misma diferencia → el ajuste no se aplicó y el conteo repite
// una pérdida ya contada. Se excluyen del acumulado para no sumarla dos veces.
export function marcarArrastres(dets, cabIdx) {
  const porClave = new Map()
  dets.forEach(d => {
    if (!esContada(d)) return
    const cab = cabIdx[d.inventario_id]; if (!cab) return
    const k = `${cab.sucursal_codigo}|${claveSku(d)}`
    if (!porClave.has(k)) porClave.set(k, [])
    porClave.get(k).push({d, f:fechaEf(cab) || ''})
  })
  const arr = new Set()
  porClave.forEach(lista => {
    lista.sort((a, b) => a.f.localeCompare(b.f) || String(a.d.inventario_id).localeCompare(String(b.d.inventario_id)))
    for (let i = 1; i < lista.length; i++) {
      const p = lista[i - 1].d, c = lista[i].d
      const dc = Math.round(Number(c.diferencia) || 0)
      if (dc !== 0 && p.inventario_id !== c.inventario_id && Number(p.stock_sistema) === Number(c.stock_sistema) &&
          Math.round(Number(p.diferencia) || 0) === dc) arr.add(c)
    }
  })
  return arr
}

// ═══════════════════════════════════════════════════════════════════════════
// LIBRO DE DIFERENCIAS — inventario por inventario, categoría por categoría,
// con el acumulado. Desapariciones = faltantes, apariciones = sobrantes.
// Balance ajustado = balance − rebajas previas (lo que se rebajó antes de contar
// habría aparecido como desaparición).
// ═══════════════════════════════════════════════════════════════════════════
const vacioFila = () => ({desUds:0, desVal:0, apaUds:0, apaVal:0, rebUds:0, rebVal:0, arrUds:0, arrVal:0, lineas:0, cuadran:0})
function sumarFila(t, d, c, arrastre) {
  const dif = Number(d.diferencia) || 0
  t.lineas++; if (Math.round(dif) === 0) t.cuadran++
  if (dif < 0) { t.desUds += -dif; if (c !== null) t.desVal += -dif * c }
  else if (dif > 0) { t.apaUds += dif; if (c !== null) t.apaVal += dif * c }
  if (arrastre) { t.arrUds += dif; if (c !== null) t.arrVal += dif * c }
}
export function construirLibro(detsP, cabsP, reb, arrastres) {
  const rebPorLinea = new Map(reb.map(x => [x.d, x]))
  const invs = [...cabsP].sort((a, b) => (fechaEf(a) || '').localeCompare(fechaEf(b) || '') || a.id.localeCompare(b.id))
  const porInv = agrupar(detsP.filter(esContada), d => d.inventario_id)
  const acumCat = {}, acumTot = vacioFila()
  const filas = invs.map(cab => {
    const ds = porInv[cab.id] || []
    const tot = vacioFila(), cats = {}
    ds.forEach(d => {
      const cat = d.tipo_producto || 'Sin categoría', c = costoDe(d), ar = arrastres.has(d)
      const t = cats[cat] || (cats[cat] = vacioFila())
      sumarFila(t, d, c, ar); sumarFila(tot, d, c, ar)
      const r = rebPorLinea.get(d)
      if (r) { t.rebUds += r.q; t.rebVal += r.val; tot.rebUds += r.q; tot.rebVal += r.val }
    })
    // acumulado: suma de balances (sin arrastres) y rebajas, hasta este inventario
    Object.entries(cats).forEach(([k, t]) => {
      const a = acumCat[k] || (acumCat[k] = vacioFila())
      Object.keys(t).forEach(x => { a[x] += t[x] })
      t.acum = {...a}
    })
    Object.keys(tot).forEach(x => { acumTot[x] += tot[x] })
    return {cab, tot, cats, acum:{...acumTot}, acumCat:JSON.parse(JSON.stringify(acumCat))}
  })
  return {filas, acumCat, acumTot}
}
// balance de una fila: apariciones − desapariciones, descontando arrastres si se pide
export const balFila = (t, base, sinArr = false) => base === 'valor'
  ? (t.apaVal - t.desVal) - (sinArr ? t.arrVal : 0)
  : (t.apaUds - t.desUds) - (sinArr ? t.arrUds : 0)
export const balAjustado = (t, base, sinArr = true) => balFila(t, base, sinArr) - (base === 'valor' ? t.rebVal : t.rebUds)

// ── Gráfico: rebajas en torno al conteo ──
export function GrafEvento({b, base = 'valor'}) {
  const H = 230, pl = 58, pr = 16, pt = 18, pb = 36, cw = GW - pl - pr, ch = H - pt - pb
  const dias = Object.keys(b).map(Number).sort((x, y) => x - y)
  const v = d => base === 'valor' ? b[d].val : b[d].q
  const tk = niceTicks(0, Math.max(1, ...dias.map(v)), 4), mx = tk[tk.length - 1]
  const band = cw / dias.length, bw = Math.max(2, band * 0.72)
  const X = i => pl + band * i + (band - bw) / 2, Y = x => pt + ch - x / mx * ch
  const i0 = dias.indexOf(0)
  return (
    <svg viewBox={`0 0 ${GW} ${H}`} width="100%" role="img" style={{display:'block'}}>
      <rect x={pl} y={pt} width={band * i0} height={ch} fill={IV.tAmbar} opacity="0.45"/>
      {tk.map((t, i) => (
        <g key={i}>
          <line x1={pl} x2={pl + cw} y1={Y(t)} y2={Y(t)} stroke={IV.lineSoft}/>
          <text x={pl - 8} y={Y(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill={IV.slate}>{base === 'valor' ? fmtM(t) : fmtN(t)}</text>
        </g>
      ))}
      {dias.map((d, i) => (
        <g key={d}>
          <title>{`${d < 0 ? `${-d} días antes` : d === 0 ? 'El día del conteo' : `${d} días después`}: ${base === 'valor' ? fmtCLP(b[d].val) : `${fmtN(b[d].q)} uds`} en ${b[d].n} líneas`}</title>
          <rect x={X(i)} y={Y(v(d))} width={bw} height={Math.max(0, pt + ch - Y(v(d)))} rx="1"
            fill={d < 0 ? IV.ambar : d === 0 ? IV.navy : IV.slate} opacity={d < 0 ? 0.9 : 0.55}/>
        </g>
      ))}
      <line x1={pl + band * i0} x2={pl + band * i0} y1={pt - 4} y2={pt + ch} stroke={IV.navy} strokeWidth="1.5" strokeDasharray="4 3"/>
      <TxtHalo x={pl + band * i0 + 4} y={pt + 8} anchor="start" fill={IV.navy}>CONTEO</TxtHalo>
      {dias.filter(d => v(d) >= mx * 0.06).map(d => (
        <TxtHalo key={'v' + d} x={X(dias.indexOf(d)) + bw / 2} y={Y(v(d)) - 5} fill={d < 0 ? IV.ambar : IV.ink}>
          {base === 'valor' ? fmtM(v(d)) : fmtN(v(d))}</TxtHalo>
      ))}
      {dias.filter(d => d % 5 === 0).map(d => (
        <text key={d} x={pl + band * dias.indexOf(d) + band / 2} y={pt + ch + 14} textAnchor="middle" fontSize="10" fill={IV.slate}>{d === 0 ? '0' : d > 0 ? `+${d}` : d}</text>
      ))}
      <text x={pl + band * i0 / 2} y={H - 4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill={IV.ambar}>ANTES DEL CONTEO</text>
      <text x={pl + band * i0 + (cw - band * i0) / 2} y={H - 4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill={IV.slate}>DESPUÉS</text>
    </svg>
  )
}

// ── Gráfico: acumulado por categoría a lo largo de los conteos ──
export function GrafAcumulado({series, puntos, fmt}) {
  // series: [{label, vals:[acumulado en cada punto], total?}]  puntos: etiquetas (fechas)
  const H = 290, pl = 70, pr = 212, pt = 16, pb = 30, cw = GW - pl - pr, ch = H - pt - pb
  const todos = series.flatMap(s => s.vals).concat(0)
  const tk = niceTicks(Math.min(...todos), Math.max(...todos), 5)
  const mn = tk[0], mx = tk[tk.length - 1]
  const n = Math.max(1, puntos.length - 1)
  const X = i => pl + (puntos.length === 1 ? cw / 2 : i / n * cw), Y = v => pt + (mx - v) / ((mx - mn) || 1) * ch
  const colores = [IV.rojo, IV.ambar, IV.azul, '#6B4FBB', '#0E7C86', '#8A6D3B', '#5B6770']
  const col = (s, i) => s.total ? IV.navy : colores[i % colores.length]
  // Etiquetas en dos líneas, en el orden vertical de sus líneas y sin superponerse
  const etq = series.map((s, i) => ({s, c:col(s, i), y:Y(s.vals[s.vals.length - 1])})).sort((a, b) => a.y - b.y)
  for (let i = 1; i < etq.length; i++) if (etq[i].y - etq[i - 1].y < 26) etq[i].y = etq[i - 1].y + 26
  const exceso = etq.length ? etq[etq.length - 1].y - (H - 10) : 0
  if (exceso > 0) etq.forEach(e => { e.y -= exceso })
  const paso = Math.max(1, Math.ceil(puntos.length / 8))
  return (
    <svg viewBox={`0 0 ${GW} ${H}`} width="100%" role="img" style={{display:'block'}}>
      {tk.map((t, i) => (
        <g key={i}>
          <line x1={pl} x2={pl + cw} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? IV.ink : IV.lineSoft}/>
          <text x={pl - 8} y={Y(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill={IV.slate}>{fmt(t)}</text>
        </g>
      ))}
      {puntos.map((p, i) => ((i % paso === 0 && i < puntos.length - paso / 2) || i === puntos.length - 1) && (
        <text key={i} x={X(i)} y={H - 10} textAnchor="middle" fontSize="9.5" fill={IV.slate}>{p}</text>
      ))}
      {series.map((s, si) => (
        <g key={s.label}>
          <title>{`${s.label}: ${fmt(s.vals[s.vals.length - 1])} acumulado`}</title>
          <path d={s.vals.map((v, i) => `${i ? 'L' : 'M'} ${X(i)} ${Y(v)}`).join(' ')} fill="none" stroke={col(s, si)}
            strokeWidth={s.total ? 2.6 : 1.6} strokeLinejoin="round"/>
          {s.total && s.vals.map((v, i) => <circle key={i} cx={X(i)} cy={Y(v)} r="2.4" fill={col(s, si)}/>)}
        </g>
      ))}
      {etq.map(e => (
        <g key={'e' + e.s.label}>
          <line x1={pl + cw + 2} x2={pl + cw + 10} y1={Y(e.s.vals[e.s.vals.length - 1])} y2={e.y} stroke={e.c} strokeOpacity="0.6"/>
          <text x={pl + cw + 14} y={e.y - 3} fontSize="10.5" fontWeight={e.s.total ? 800 : 700} fill={e.c}>{trunc(e.s.label, 30)}</text>
          <text x={pl + cw + 14} y={e.y + 10} fontSize="10.5" fontWeight="800" fill={e.c}>{fmt(e.s.vals[e.s.vals.length - 1])}</text>
        </g>
      ))}
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PESTAÑA REBAJAS PREVIAS
// ═══════════════════════════════════════════════════════════════════════════
export function TabRebajas({D, cabIdx, nombreSuc, rebajasData, ventana, setVentana, abrirFicha}) {
  const [base, setBase] = useState('valor')
  const [filtro, setFiltro] = useState('ALTA')
  const R = rebajasData
  if (!R || !R.cargado) return <Vacio t="Cargando las bajas de BSALE…"/>
  if (!R.desde) return <Vacio t="Sin bajas sincronizadas" s="No hay detalle de bajas por producto para cruzar con los conteos."/>
  const evaluableDesde = sumarDias(R.desde, ventana)
  const lin = (D.rebPrev || []).filter(x => x.f >= evaluableDesde)
  const contEval = D.detsP.filter(d => esContada(d) && skuValido(d.sku) && (fechaEf(cabIdx[d.inventario_id]) || '') >= evaluableDesde)
  const conReb = new Set(lin.map(x => x.d))
  const sin = contEval.filter(d => !conReb.has(d))
  const eriCon = lin.length ? lin.filter(x => x.cuadro).length / lin.length * 100 : null
  const eriSin = sin.length ? sin.filter(d => Math.round(Number(d.diferencia) || 0) === 0).length / sin.length * 100 : null
  const val = lin.reduce((s, x) => s + x.val, 0), q = lin.reduce((s, x) => s + x.q, 0)
  const oculto = lin.filter(x => x.cuadro).reduce((s, x) => s + x.val, 0)
  const faltEval = contEval.reduce((s, d) => { const dif = Number(d.diferencia) || 0, c = costoDe(d); return dif < 0 && c !== null ? s + -dif * c : s }, 0)
  const porClase = Object.entries(agrupar(lin, x => x.clase)).map(([k, xs]) => ({k, n:xs.length, q:xs.reduce((s, x) => s + x.q, 0),
    val:xs.reduce((s, x) => s + x.val, 0), cuadro:xs.filter(x => x.cuadro).length})).sort((a, b) => b.val - a.val)
  const porSuc = Object.entries(agrupar(lin, x => x.cab.sucursal_codigo)).map(([k, xs]) => ({k, n:xs.length,
    val:xs.reduce((s, x) => s + x.val, 0), oculto:xs.filter(x => x.cuadro).reduce((s, x) => s + x.val, 0),
    cuadro:xs.filter(x => x.cuadro).length, alta:xs.filter(x => x.sospecha === 'ALTA').length})).sort((a, b) => b.val - a.val)
  const antes = Object.entries(D.evento || {}).filter(([d]) => Number(d) < 0).reduce((s, [, x]) => s + x.val, 0)
  const despues = Object.entries(D.evento || {}).filter(([d]) => Number(d) > 0).reduce((s, [, x]) => s + x.val, 0)
  const lista = lin.filter(x => filtro === 'TODAS' || x.sospecha === filtro).sort((a, b) => b.val - a.val)
  const titular = oculto > 0
    ? `${fmtM(oculto)} en rebajas se registraron días antes de contar productos que después cuadraron exacto: esa pérdida no aparece en el conteo.`
    : lin.length ? `Hubo ${fmtN(lin.length)} rebajas previas al conteo, pero los productos no quedaron cuadrados: no se ve un patrón de ajuste previo.`
    : 'No se registraron rebajas en los días previos a los conteos del período.'
  const sosC = {ALTA:IV.rojo, MEDIA:IV.ambar, BAJA:IV.slate}
  return (<>
    <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:12}}>
      <Seg valor={String(ventana)} onChange={v => setVentana(Number(v))} opciones={[{k:'7', l:'7 DÍAS'}, {k:'15', l:'15 DÍAS'}, {k:'30', l:'30 DÍAS'}]}/>
      <Seg valor={base} onChange={setBase} opciones={[{k:'valor', l:'EN COSTO'}, {k:'uds', l:'EN UNIDADES'}]}/>
      <span style={{fontSize:11, color:IV.slate}}>
        Evalúa conteos desde el {evaluableDesde}: las bajas por producto existen desde el {R.desde}.
      </span>
    </div>

    <div style={{border:`1px solid ${IV.line}`, borderLeft:`4px solid ${oculto > 0 ? IV.rojo : IV.verde}`, borderRadius:4,
      background:'#fff', padding:'14px 18px', marginBottom:14}}>
      <div style={{fontSize:17, fontWeight:800, color:IV.ink, letterSpacing:-0.3, lineHeight:1.35}}>{titular}</div>
      {lin.length > 0 && eriCon !== null && eriSin !== null && (
        <div style={{fontSize:12.5, color:IV.slate, marginTop:6, lineHeight:1.55}}>
          Los productos rebajados antes del conteo cuadraron en el {fmtP(eriCon, 0)} de los casos, contra el {fmtP(eriSin, 0)} del resto.
          {eriCon > eriSin + 10 ? ' Cuadran bastante más que el promedio: es la huella de un ajuste previo.' : eriCon < eriSin - 10 ? ' Cuadran menos que el promedio: en general la rebaja no se usó para dejar el conteo cuadrado, salvo en los casos marcados.' : ''}
        </div>
      )}
    </div>

    <Strip>
      <Kpi l="Rebajas previas" v={base === 'valor' ? fmtM(val) : fmtN(q)} c={IV.ambar} s={`${fmtN(lin.length)} líneas · ventana ${ventana} días`}/>
      <Kpi l="Pérdida oculta" v={fmtM(oculto)} c={oculto ? IV.rojo : IV.verde} s="rebajado y después cuadró"/>
      <Kpi l="Pérdida del conteo" v={fmtM(faltEval)} c={IV.rojo} s="faltantes detectados"/>
      <Kpi l="Pérdida ajustada" v={fmtM(faltEval + val)} c={IV.rojo} s={faltEval ? `+${fmtP(val / faltEval * 100, 0)} sobre lo detectado` : 'conteo + rebajas previas'}/>
      <Kpi l="Cuadraron tras rebajar" v={fmtP(eriCon, 0)} c={eriCon !== null && eriSin !== null && eriCon > eriSin ? IV.rojo : IV.ink} s={`resto ${fmtP(eriSin, 0)}`}/>
      <Kpi l="Sospecha alta" v={fmtN(lin.filter(x => x.sospecha === 'ALTA').length)} c={IV.rojo} s="líneas a revisar"/>
    </Strip>

    <Guia titulo="QUÉ ES UNA REBAJA PREVIA Y POR QUÉ IMPORTA">
      Si alguien registra una baja de stock pocos días antes de contar, el conteo se compara contra un sistema ya rebajado. El producto puede <strong>cuadrar exacto</strong> y el ERI verse perfecto, pero la pérdida no desapareció: se movió de "diferencia de inventario" a "baja". Puede ser legítimo —una recepción mal ingresada que se corrige—, pero en cualquier caso la pérdida real es la del conteo <strong>más</strong> la rebaja.
      <div style={{marginTop:6}}><strong>Qué se considera</strong>: solo rebajas de stock. No cuenta lo que pasa a segunda ni los cambios de código, porque el producto sigue en inventario. Manda la clasificación contable.</div>
      <div style={{marginTop:6}}><strong>Qué se descarta</strong>: la rebaja que ajusta un conteo anterior del mismo producto (hubo un faltante en los 30 días previos). Ese es el ajuste correcto, no uno previo.</div>
      <div style={{marginTop:6}}><strong>El gráfico en torno al conteo</strong> suma todas las rebajas de los productos contados según cuántos días antes o después del conteo se registraron. Lo normal es que se concentren <em>después</em> (ajustar lo que el conteo encontró). Una concentración <em>antes</em> del conteo es la huella del ajuste previo.</div>
    </Guia>

    <div style={{marginBottom:20}}>
      <Titular t={antes > despues ? `Se rebaja más antes de contar que después: ${fmtM(antes)} antes contra ${fmtM(despues)} después`
        : `Las rebajas se concentran después del conteo, como corresponde: ${fmtM(despues)} después, ${fmtM(antes)} antes`}
        s="Rebajas de los productos contados, según los días respecto de la fecha del conteo · cada rebaja se asigna al conteo más cercano"/>
      <Caja><div style={{padding:'10px 8px 4px'}}><GrafEvento b={D.evento || {}} base={base}/></div>
        <Leyenda items={[[IV.ambar, 'antes del conteo'], [IV.navy, 'el día del conteo'], [IV.slate, 'después del conteo']]}/>
        <Lectura como="Cada barra suma las rebajas de los productos contados según cuántos días antes (izquierda) o después (derecha) de su conteo se registraron. La línea punteada es el día del conteo."
          buscar="Lo normal es que las rebajas estén a la derecha: se ajusta lo que el conteo encontró. Una barra alta a la izquierda es stock que se rebajó justo antes de contar."/></Caja>
    </div>

    <div style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:18, marginBottom:20}}>
      <Seccion titulo="Por tipo de rebaja" mb={0}>
        <Caja>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead><tr><th style={th()}>Tipo</th><th style={th(true)}>Líneas</th><th style={th(true)}>{base === 'valor' ? 'Costo' : 'Unidades'}</th><th style={th(true)}>Cuadraron</th></tr></thead>
            <tbody>{porClase.map(c => (
              <tr key={c.k}>
                <td style={td(false, {fontWeight:700})}>{CLASE_BAJA[c.k] || c.k}</td>
                <td style={td(true)}>{fmtN(c.n)}</td>
                <td style={td(true, {fontWeight:700})}>{base === 'valor' ? fmtCLP(c.val) : fmtN(c.q)}</td>
                <td style={td(true, {fontWeight:700, color:c.n && c.cuadro / c.n > 0.6 ? IV.rojo : IV.slate})}>{fmtN(c.cuadro)} · {fmtP(c.cuadro / c.n * 100, 0)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Caja>
      </Seccion>
      <Seccion titulo="Por bodega" mb={0}>
        <Caja>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead><tr><th style={th()}>Bodega</th><th style={th(true)}>Rebajado</th><th style={th(true)}>Oculto</th><th style={th(true)}>Alta</th></tr></thead>
            <tbody>{porSuc.map(s => (
              <tr key={s.k}>
                <td style={td(false, {fontWeight:700})}>{nombreSuc(s.k)}</td>
                <td style={td(true)}>{fmtCLP(s.val)}</td>
                <td style={td(true, {fontWeight:700, color:s.oculto ? IV.rojo : IV.slate})}>{s.oculto ? fmtCLP(s.oculto) : '—'}</td>
                <td style={td(true, {fontWeight:700, color:s.alta ? IV.rojo : IV.slate})}>{fmtN(s.alta)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Caja>
      </Seccion>
    </div>

    <Seccion titulo="Rebajas previas, línea por línea" sub="ordenadas por monto">
      <div style={{marginBottom:10}}>
        <Seg valor={filtro} onChange={setFiltro} opciones={[{k:'ALTA', l:'SOSPECHA ALTA'}, {k:'MEDIA', l:'MEDIA'}, {k:'BAJA', l:'BAJA'}, {k:'TODAS', l:'TODAS'}]}/>
      </div>
      {lista.length === 0 ? <Vacio t="Sin rebajas en este nivel"/> : (
        <Caja>
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:1000}}>
            <thead><tr>
              <th style={th()}>Sospecha</th><th style={th()}>Producto</th><th style={th()}>Conteo</th>
              <th style={th()}>Rebaja</th><th style={th(true)}>Días antes</th><th style={th(true)}>Uds</th><th style={th(true)}>Costo</th><th style={th(true)}>Dif. del conteo</th>
            </tr></thead>
            <tbody>{lista.slice(0, 60).map((x, i) => (
              <tr key={i} onClick={abrirFicha ? () => abrirFicha(x.cab.id) : undefined} style={{cursor:abrirFicha ? 'pointer' : 'default'}}>
                <td style={td()}><Punto c={sosC[x.sospecha]}>{x.sospecha}</Punto></td>
                <td style={td()}><div style={{fontWeight:700, fontSize:12}}>{x.d.producto || x.d.sku}</div>
                  <div style={{fontSize:10.5, color:IV.slate}}>{x.d.sku} · {x.d.tipo_producto}</div></td>
                <td style={td(false, {fontSize:11.5, whiteSpace:'nowrap'})}>{nombreSuc(x.cab.sucursal_codigo)} · {x.f}</td>
                <td style={td(false, {fontSize:11.5, maxWidth:260})}>
                  <div style={{fontWeight:700}}>{CLASE_BAJA[x.clase] || x.clase}{x.sinInforme ? <span style={{color:IV.rojo}}> · sin informe</span> : ''}</div>
                  <div style={{color:IV.slate, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={x.previas.map(r => r.nota).join(' | ')}>
                    {trunc(x.previas[0]?.nota || '—', 48)}</div>
                </td>
                <td style={td(true, {fontWeight:700, color:x.minDias <= 3 ? IV.rojo : IV.ink})}>{x.minDias}</td>
                <td style={td(true)}>{fmtN(x.q)}</td>
                <td style={td(true, {fontWeight:700})}>{fmtCLP(x.val)}</td>
                <td style={td(true, {fontWeight:800, color:x.cuadro ? IV.rojo : x.dif < 0 ? IV.rojo : IV.verde})}>
                  {x.cuadro ? 'cuadró exacto' : `${x.dif > 0 ? '+' : ''}${fmtN(x.dif)}`}</td>
              </tr>
            ))}</tbody>
          </table>
        </Caja>
      )}
    </Seccion>
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// PESTAÑA LIBRO — inventario por inventario y el acumulado
// ═══════════════════════════════════════════════════════════════════════════
export function TabLibro({D, nombreSuc, puedeVerCostos, abrirFicha}) {
  const notaDe = Object.fromEntries((D.porInv || []).map(x => [x.cab.id, x.nota]))
  const [base, setBase]   = useState(puedeVerCostos ? 'valor' : 'uds')
  const [vista, setVista] = useState('inventario')
  const [abierto, setAb]  = useState(null)       // inventario expandido
  const [cat, setCat]     = useState(null)       // categoría seleccionada
  const L = D.libro
  if (!L || !L.filas.length) return <Vacio t="Sin inventarios en el período"/>
  const aV = base === 'valor'
  const fm = aV ? fmtSM : (v => `${v > 0 ? '+' : ''}${fmtN(v)}`)
  const fv = (t, k) => aV ? t[k + 'Val'] : t[k + 'Uds']
  const cats = Object.entries(L.acumCat).map(([k, t]) => ({k, t})).sort((a, b) => balAjustado(a.t, base) - balAjustado(b.t, base))
  // Serie acumulada: total + las 6 categorías de mayor efecto absoluto (o la elegida)
  const puntos = L.filas.map(f => fechaEf(f.cab).slice(5).split('-').reverse().join('/'))
  const top = cat ? [cat] : [...cats].sort((a, b) => Math.abs(balAjustado(b.t, base)) - Math.abs(balAjustado(a.t, base))).slice(0, 6).map(c => c.k)
  const series = [
    {label:'Total', total:true, vals:L.filas.map(f => balAjustado(f.acum, base))},
    ...top.map(k => ({label:k, vals:L.filas.map(f => f.acumCat[k] ? balAjustado(f.acumCat[k], base) : 0)})),
  ]
  const T = L.acumTot
  const arrN = D.arrastresN || 0
  return (<>
    <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:12}}>
      {puedeVerCostos && <Seg valor={base} onChange={setBase} opciones={[{k:'valor', l:'EN COSTO'}, {k:'uds', l:'EN UNIDADES'}]}/>}
      <Seg valor={vista} onChange={v => { setVista(v); setCat(null) }} opciones={[{k:'inventario', l:'INVENTARIO POR INVENTARIO'}, {k:'categoria', l:'CATEGORÍA POR CATEGORÍA'}]}/>
      {cat && <button style={btn('ghost')} onClick={() => setCat(null)}>← TODAS LAS CATEGORÍAS</button>}
    </div>

    <Strip>
      <Kpi l="Desapariciones" v={aV ? fmtM(T.desVal) : fmtN(T.desUds)} c={IV.rojo} s={aV ? `${fmtN(T.desUds)} uds` : 'unidades faltantes'}/>
      <Kpi l="Apariciones" v={aV ? fmtM(T.apaVal) : fmtN(T.apaUds)} c={IV.verde} s={aV ? `${fmtN(T.apaUds)} uds` : 'unidades sobrantes'}/>
      <Kpi l="Balance" v={fm(balFila(T, base))} c={balFila(T, base) < 0 ? IV.rojo : IV.verde} s="suma de los conteos"/>
      {arrN > 0 && <Kpi l="Arrastres excluidos" v={fm(-(aV ? T.arrVal : T.arrUds))} c={IV.slate} s={`${fmtN(arrN)} líneas repetidas`}/>}
      {(aV ? T.rebVal : T.rebUds) > 0 && <Kpi l="Rebajas previas" v={aV ? fmtM(T.rebVal) : fmtN(T.rebUds)} c={IV.ambar} s="registradas antes de contar"/>}
      <Kpi l="Balance ajustado" v={fm(balAjustado(T, base))} c={balAjustado(T, base) < 0 ? IV.rojo : IV.verde} s="sin arrastres, con rebajas previas"/>
    </Strip>

    <div style={{fontSize:12.5, color:IV.ink, marginBottom:12, lineHeight:1.55}}>
      Cada fila es un conteo, en orden de fecha. <strong>Ábrela</strong> para ver sus categorías; <strong>FICHA</strong> abre el detalle completo del conteo: qué hacer, cruces de código, rebajas previas y cada producto con diferencia.
    </div>
    <Guia titulo="CÓMO SE LEE EL LIBRO">
      Cada conteo es un asiento: lo que <strong>desapareció</strong> (faltantes), lo que <strong>apareció</strong> (sobrantes) y el <strong>balance</strong>. El <strong>acumulado</strong> los va sumando en orden de fecha, así se ve cómo se construye el resultado del período conteo a conteo y categoría a categoría.
      <div style={{marginTop:6}}><strong>Balance ajustado</strong> = balance − rebajas previas. Lo que se rebajó en los días previos al conteo habría aparecido como desaparición; sumarlo muestra la pérdida real.</div>
      <div style={{marginTop:6}}><strong>Arrastres</strong>: cuando un producto se vuelve a contar con el mismo stock de sistema y la misma diferencia, el ajuste anterior no se aplicó y el conteo repite una pérdida ya registrada. Se muestra en su conteo pero no se suma al acumulado, para no contarla dos veces.</div>
    </Guia>

    <div style={{marginBottom:20}}>
      <Titular t={cat ? `${cat}: acumulado ${fm(balAjustado(L.acumCat[cat], base))}` : `Acumulado del período: ${fm(balAjustado(T, base))}`}
        s={`Balance ajustado acumulado conteo a conteo ${aV ? 'a costo' : 'en unidades'} · ${cat ? 'categoría seleccionada' : 'total y las 6 categorías de mayor efecto'}`}/>
      <Caja><div style={{padding:'10px 8px 4px'}}><GrafAcumulado series={series} puntos={puntos} fmt={aV ? fmtSM : (v => `${v > 0 ? '+' : ''}${fmtN(v)}`)}/></div>
        <Lectura como="Cada punto es un conteo, en orden de fecha. La línea gruesa es el total: cuánto se ha acumulado entre lo que apareció y lo que desapareció hasta ese conteo. Las otras líneas son las categorías que más mueven el resultado."
          buscar="Un salto brusco hacia abajo es un conteo que encontró mucho faltante: ábrelo en la tabla. Dos categorías que saltan al mismo tiempo en sentido contrario suelen ser el mismo producto registrado con otro código."/></Caja>
    </div>

    {vista === 'inventario' && (
      <Caja>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:1080}}>
          <thead><tr>
            <th style={th(false, {width:44})}>Nota</th>
            <th style={th()}>Conteo</th><th style={th(true)}>Desaparecen</th><th style={th(true)}>Aparecen</th><th style={th(true)}>Balance</th>
            <th style={th(true)}>Rebajas previas</th><th style={th(true)}>Balance ajustado</th><th style={th(true, {borderLeft:`1px solid ${IV.line}`})}>Acumulado</th><th style={th()}></th>
          </tr></thead>
          <tbody>{L.filas.map(f => {
            const ab = abierto === f.cab.id, b = balFila(f.tot, base), ba = balAjustado(f.tot, base, false), ac = balAjustado(f.acum, base)
            return (
              <React.Fragment key={f.cab.id}>
                <tr onClick={() => setAb(ab ? null : f.cab.id)} style={{cursor:'pointer', background:ab ? IV.bgSoft : 'transparent'}}>
                  <td style={td()}><Nota n={notaDe[f.cab.id]?.nota} size={26}/></td>
                  <td style={td()}>
                    <div style={{fontWeight:700, fontSize:12.5}}>{ab ? '▾' : '▸'} {nombreSuc(f.cab.sucursal_codigo)} · {fechaEf(f.cab)}</div>
                    <div style={{fontSize:10.5, color:IV.slate}}>{f.cab.id} · {Object.keys(f.cats).length} categorías · {fmtN(f.tot.lineas)} líneas</div>
                  </td>
                  <td style={td(true, {color:IV.rojo})}>{fv(f.tot, 'des') ? (aV ? fmtCLP(-f.tot.desVal) : `−${fmtN(f.tot.desUds)}`) : '—'}</td>
                  <td style={td(true, {color:IV.verde})}>{fv(f.tot, 'apa') ? (aV ? fmtCLP(f.tot.apaVal) : `+${fmtN(f.tot.apaUds)}`) : '—'}</td>
                  <td style={td(true, {fontWeight:700, color:b < 0 ? IV.rojo : b > 0 ? IV.verde : IV.slate})}>{fm(b)}</td>
                  <td style={td(true, {color:IV.ambar})}>{fv(f.tot, 'reb') ? (aV ? fmtCLP(-f.tot.rebVal) : `−${fmtN(f.tot.rebUds)}`) : '—'}</td>
                  <td style={td(true, {fontWeight:800, color:ba < 0 ? IV.rojo : ba > 0 ? IV.verde : IV.slate})}>{fm(ba)}</td>
                  <td style={td(true, {fontWeight:800, color:ac < 0 ? IV.rojo : IV.verde, borderLeft:`1px solid ${IV.line}`})}>{fm(ac)}</td>
                  <td style={td(true)}>{abrirFicha && <span onClick={e => { e.stopPropagation(); abrirFicha(f.cab.id) }}
                    style={{fontSize:10.5, fontWeight:700, color:IV.azul, cursor:'pointer', whiteSpace:'nowrap'}}>FICHA →</span>}</td>
                </tr>
                {ab && Object.entries(f.cats).sort((a, b2) => balAjustado(a[1], base, false) - balAjustado(b2[1], base, false)).map(([k, t]) => {
                  const bb = balFila(t, base), bj = balAjustado(t, base, false), acc = balAjustado(t.acum, base)
                  return (
                    <tr key={k} style={{background:IV.bgSoft}}>
                      <td style={td()}></td>
                      <td style={td(false, {paddingLeft:30, fontSize:12})}>{k}
                        {(aV ? t.arrVal : t.arrUds) !== 0 && <span style={{fontSize:10, color:IV.slate, marginLeft:6}}>· arrastre {fm(aV ? t.arrVal : t.arrUds)}</span>}</td>
                      <td style={td(true, {fontSize:12, color:IV.rojo})}>{fv(t, 'des') ? (aV ? fmtCLP(-t.desVal) : `−${fmtN(t.desUds)}`) : '—'}</td>
                      <td style={td(true, {fontSize:12, color:IV.verde})}>{fv(t, 'apa') ? (aV ? fmtCLP(t.apaVal) : `+${fmtN(t.apaUds)}`) : '—'}</td>
                      <td style={td(true, {fontSize:12, color:bb < 0 ? IV.rojo : bb > 0 ? IV.verde : IV.slate})}>{fm(bb)}</td>
                      <td style={td(true, {fontSize:12, color:IV.ambar})}>{fv(t, 'reb') ? (aV ? fmtCLP(-t.rebVal) : `−${fmtN(t.rebUds)}`) : '—'}</td>
                      <td style={td(true, {fontSize:12, fontWeight:700, color:bj < 0 ? IV.rojo : bj > 0 ? IV.verde : IV.slate})}>{fm(bj)}</td>
                      <td style={td(true, {fontSize:12, color:acc < 0 ? IV.rojo : IV.verde, borderLeft:`1px solid ${IV.line}`})}>{fm(acc)}</td>
                      <td style={td()}></td>
                    </tr>
                  )
                })}
              </React.Fragment>
            )
          })}</tbody>
          <tfoot><tr style={{background:IV.bgHead}}>
            <td style={td()}></td>
            <td style={td(false, {fontWeight:800})}>Acumulado del período</td>
            <td style={td(true, {fontWeight:800, color:IV.rojo})}>{aV ? fmtCLP(-T.desVal) : `−${fmtN(T.desUds)}`}</td>
            <td style={td(true, {fontWeight:800, color:IV.verde})}>{aV ? fmtCLP(T.apaVal) : `+${fmtN(T.apaUds)}`}</td>
            <td style={td(true, {fontWeight:800})}>{fm(balFila(T, base))}</td>
            <td style={td(true, {fontWeight:800, color:IV.ambar})}>{aV ? fmtCLP(-T.rebVal) : `−${fmtN(T.rebUds)}`}</td>
            <td style={td(true, {fontWeight:800})}>{fm(balAjustado(T, base, false))}</td>
            <td style={td(true, {fontWeight:900, borderLeft:`1px solid ${IV.line}`})}>{fm(balAjustado(T, base))}</td>
            <td style={td()}></td>
          </tr></tfoot>
        </table>
      </Caja>
    )}

    {vista === 'categoria' && !cat && (
      <Caja>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:1000}}>
          <thead><tr>
            <th style={th()}>Categoría</th><th style={th(true)}>Conteos</th><th style={th(true)}>Desaparecen</th><th style={th(true)}>Aparecen</th>
            <th style={th(true)}>Balance</th><th style={th(true)}>Rebajas previas</th><th style={th(true)}>Arrastres</th><th style={th(true)}>Acumulado ajustado</th><th style={th()}></th>
          </tr></thead>
          <tbody>{cats.map(({k, t}) => {
            const n = L.filas.filter(f => f.cats[k]).length, bj = balAjustado(t, base)
            return (
              <tr key={k} onClick={() => setCat(k)} style={{cursor:'pointer'}}>
                <td style={td(false, {fontWeight:700})}>{k}</td>
                <td style={td(true, {color:IV.slate})}>{n}</td>
                <td style={td(true, {color:IV.rojo})}>{aV ? fmtCLP(-t.desVal) : `−${fmtN(t.desUds)}`}</td>
                <td style={td(true, {color:IV.verde})}>{aV ? fmtCLP(t.apaVal) : `+${fmtN(t.apaUds)}`}</td>
                <td style={td(true)}>{fm(balFila(t, base))}</td>
                <td style={td(true, {color:IV.ambar})}>{(aV ? t.rebVal : t.rebUds) ? (aV ? fmtCLP(-t.rebVal) : `−${fmtN(t.rebUds)}`) : '—'}</td>
                <td style={td(true, {color:IV.slate})}>{(aV ? t.arrVal : t.arrUds) ? fm(-(aV ? t.arrVal : t.arrUds)) : '—'}</td>
                <td style={td(true, {fontWeight:800, color:bj < 0 ? IV.rojo : bj > 0 ? IV.verde : IV.slate})}>{fm(bj)}</td>
                <td style={td(true, {fontSize:10.5, fontWeight:700, color:IV.azul, whiteSpace:'nowrap'})}>VER →</td>
              </tr>
            )
          })}</tbody>
        </table>
      </Caja>
    )}

    {vista === 'categoria' && cat && (
      <Caja>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:980}}>
          <thead><tr>
            <th style={th()}>Conteo · {cat}</th><th style={th(true)}>Desaparecen</th><th style={th(true)}>Aparecen</th><th style={th(true)}>Balance</th>
            <th style={th(true)}>Rebajas previas</th><th style={th(true)}>Balance ajustado</th><th style={th(true, {borderLeft:`1px solid ${IV.line}`})}>Acumulado</th>
          </tr></thead>
          <tbody>{L.filas.filter(f => f.cats[cat]).map(f => {
            const t = f.cats[cat], b = balFila(t, base), bj = balAjustado(t, base, false), ac = balAjustado(t.acum, base)
            return (
              <tr key={f.cab.id} onClick={abrirFicha ? () => abrirFicha(f.cab.id) : undefined} style={{cursor:abrirFicha ? 'pointer' : 'default'}}>
                <td style={td()}><div style={{fontWeight:700, fontSize:12.5}}>{nombreSuc(f.cab.sucursal_codigo)} · {fechaEf(f.cab)}</div>
                  <div style={{fontSize:10.5, color:IV.slate}}>{f.cab.id} · {fmtN(t.lineas)} líneas · ERI {fmtP(t.lineas ? t.cuadran / t.lineas * 100 : null, 0)}</div></td>
                <td style={td(true, {color:IV.rojo})}>{fv(t, 'des') ? (aV ? fmtCLP(-t.desVal) : `−${fmtN(t.desUds)}`) : '—'}</td>
                <td style={td(true, {color:IV.verde})}>{fv(t, 'apa') ? (aV ? fmtCLP(t.apaVal) : `+${fmtN(t.apaUds)}`) : '—'}</td>
                <td style={td(true, {fontWeight:700, color:b < 0 ? IV.rojo : b > 0 ? IV.verde : IV.slate})}>{fm(b)}</td>
                <td style={td(true, {color:IV.ambar})}>{fv(t, 'reb') ? (aV ? fmtCLP(-t.rebVal) : `−${fmtN(t.rebUds)}`) : '—'}</td>
                <td style={td(true, {fontWeight:800, color:bj < 0 ? IV.rojo : bj > 0 ? IV.verde : IV.slate})}>{fm(bj)}</td>
                <td style={td(true, {fontWeight:800, color:ac < 0 ? IV.rojo : IV.verde, borderLeft:`1px solid ${IV.line}`})}>{fm(ac)}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </Caja>
    )}
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// LECTURA DE GRÁFICOS — cada gráfico dice cómo leerlo y qué buscar
// ═══════════════════════════════════════════════════════════════════════════
export function Lectura({como, buscar}) {
  return (
    <div style={{padding:'9px 14px 11px', borderTop:`1px solid ${IV.lineSoft}`, background:IV.bgSoft,
      fontSize:11.5, lineHeight:1.6, color:IV.slate}}>
      <strong style={{color:IV.ink}}>Cómo leerlo.</strong> {como}
      {buscar && <><br/><strong style={{color:IV.ink}}>Qué buscar.</strong> {buscar}</>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// GRÁFICOS MENSUALES — misma presentación para exactitud, unidades y costo:
// una columna por mes, el valor escrito sobre cada barra y una fila de cifras
// bajo los meses, para que se pueda leer sin pasar el mouse.
// ═══════════════════════════════════════════════════════════════════════════
const MH = 236, MPL = 58, MPR = 14, MPT = 22, MPB = 50
export function GrafMesERI({meses}) {
  const cw = GW - MPL - MPR, ch = MH - MPT - MPB, band = cw / 12, bw = band * 0.56
  const Y = v => MPT + ch - v / 100 * ch
  return (
    <svg viewBox={`0 0 ${GW} ${MH}`} width="100%" role="img" style={{display:'block'}}>
      {[0, 50, 70, 90, 100].map(t => (
        <g key={t}>
          <line x1={MPL} x2={MPL + cw} y1={Y(t)} y2={Y(t)} stroke={t === 90 ? IV.verde : IV.lineSoft} strokeDasharray={t === 90 ? '5 3' : 'none'}/>
          <text x={MPL - 8} y={Y(t)} textAnchor="end" dominantBaseline="middle" fontSize="10.5" fill={t === 90 ? IV.verde : IV.slate} fontWeight={t === 90 ? 700 : 400}>{t}%</text>
        </g>
      ))}
      <text x={MPL + cw - 4} y={Y(90) - 5} textAnchor="end" fontSize="10" fontWeight="700" fill={IV.verde}>meta 90%</text>
      <text x={MPL - 8} y={MH - 13} textAnchor="end" fontSize="9.5" fontWeight="700" fill={IV.slate}>líneas</text>
      {MES.map((m, i) => {
        const x = meses[i + 1], cx = MPL + band * i + band / 2
        return (
          <g key={m}>
            {x && x.eri !== null && (<>
              <title>{`${m}: ${fmtP(x.eri)} de exactitud en ${fmtN(x.contadas)} productos contados`}</title>
              <rect x={cx - bw / 2} y={Y(x.eri)} width={bw} height={Math.max(1, MPT + ch - Y(x.eri))} fill={semERI(x.eri)} rx="2" opacity="0.88"/>
              <TxtHalo x={cx} y={Y(x.eri) - 6} size={11} weight={800} fill={semERI(x.eri)}>{Math.round(x.eri)}%</TxtHalo>
            </>)}
            <text x={cx} y={MH - 30} textAnchor="middle" fontSize="11" fontWeight={x ? 700 : 400} fill={x ? IV.ink : IV.line}>{m}</text>
            <text x={cx} y={MH - 13} textAnchor="middle" fontSize="10.5" fontWeight={x ? 700 : 400} fill={x ? IV.slate : IV.line}>{x ? fmtN(x.contadas) : '·'}</text>
          </g>
        )
      })}
    </svg>
  )
}
export function GrafMesBalance({meses, base}) {
  const aV = base === 'valor'
  const P = x => aV ? x.faltVal : x.faltUds, G = x => aV ? x.sobrVal : x.sobrUds
  const fmt = aV ? fmtM : (v => fmtN(v))
  const fmtS = aV ? fmtSM : (v => `${v > 0 ? '+' : ''}${fmtN(v)}`)
  const cw = GW - MPL - MPR, ch = MH - MPT - MPB, band = cw / 12, bw = band * 0.56
  const vals = [0, ...MES.flatMap((_, i) => meses[i + 1] ? [G(meses[i + 1]), -P(meses[i + 1])] : [])]
  const tk = niceTicks(Math.min(...vals), Math.max(...vals), 4), mn = tk[0], mx = tk[tk.length - 1]
  const Y = v => MPT + (mx - v) / ((mx - mn) || 1) * ch
  return (
    <svg viewBox={`0 0 ${GW} ${MH}`} width="100%" role="img" style={{display:'block'}}>
      {tk.map((t, i) => (
        <g key={i}>
          <line x1={MPL} x2={MPL + cw} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? IV.ink : IV.lineSoft}/>
          <text x={MPL - 8} y={Y(t)} textAnchor="end" dominantBaseline="middle" fontSize="10.5" fill={IV.slate}>{fmt(t)}</text>
        </g>
      ))}
      <text x={MPL + 4} y={MPT - 8} fontSize="10" fontWeight="700" fill={IV.verde}>▲ APARECEN</text>
      <text x={MPL + 90} y={MPT - 8} fontSize="10" fontWeight="700" fill={IV.rojo}>▼ DESAPARECEN</text>
      {MES.map((m, i) => {
        const x = meses[i + 1], cx = MPL + band * i + band / 2
        const b = x ? G(x) - P(x) : 0
        return (
          <g key={m}>
            {x && (<>
              <title>{`${m}: aparecen ${aV ? fmtCLP(G(x)) : fmtN(G(x)) + ' uds'} · desaparecen ${aV ? fmtCLP(P(x)) : fmtN(P(x)) + ' uds'} · balance ${aV ? fmtCLP(b) : fmtN(b) + ' uds'}`}</title>
              <rect x={cx - bw / 2} y={Y(G(x))} width={bw} height={Math.max(0.5, Y(0) - Y(G(x)))} fill={IV.verde} opacity="0.75" rx="1.5"/>
              <rect x={cx - bw / 2} y={Y(0)} width={bw} height={Math.max(0.5, Y(-P(x)) - Y(0))} fill={IV.rojo} opacity="0.75" rx="1.5"/>
            </>)}
            <text x={cx} y={MH - 30} textAnchor="middle" fontSize="11" fontWeight={x ? 700 : 400} fill={x ? IV.ink : IV.line}>{m}</text>
            <text x={cx} y={MH - 13} textAnchor="middle" fontSize="10.5" fontWeight="800"
              fill={!x ? IV.line : b < 0 ? IV.rojo : b > 0 ? IV.verde : IV.slate}>{x ? fmtS(b) : '·'}</text>
          </g>
        )
      })}
      <text x={MPL - 8} y={MH - 13} textAnchor="end" fontSize="9.5" fontWeight="700" fill={IV.slate}>balance</text>
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAPA POR CATEGORÍA — la tendencia completa, con la misma métrica que se elija
// ═══════════════════════════════════════════════════════════════════════════
export function MapaMeses({D, cabIdx, nombreSuc, puedeVerCostos}) {
  const [met, setMet] = useState('eri')
  const [eje, setEje] = useState('categoria')
  const [todas, setTodas] = useState(false)
  const METS = [{k:'eri', l:'EXACTITUD'}, {k:'uds', l:'BALANCE EN UNIDADES'}, ...(puedeVerCostos ? [{k:'valor', l:'BALANCE EN COSTO'}] : [])]
  const mesOf = d => mesDe(fechaEf(cabIdx[d.inventario_id]))
  const keyOf = eje === 'categoria' ? (d => d.tipo_producto || 'Sin categoría') : (d => cabIdx[d.inventario_id]?.sucursal_codigo)
  const val = x => met === 'eri' ? x.eri : met === 'uds' ? x.sobrUds - x.faltUds : x.sobrVal - x.faltVal
  const filas = Object.entries(agrupar(D.detsA, keyOf)).map(([k, ds]) => {
    const pm = {}
    Object.entries(agrupar(ds, mesOf)).forEach(([m, x]) => { pm[m] = calcular(x, D.abc, cabIdx) })
    return {k, label:eje === 'categoria' ? k : nombreSuc(k), total:calcular(ds, D.abc, cabIdx), pm}
  }).sort((a, b) => met === 'eri' ? b.total.contadas - a.total.contadas : val(a.total) - val(b.total))
  const visibles = todas ? filas : filas.slice(0, 12)
  const maxAbs = Math.max(1, ...filas.flatMap(f => Object.values(f.pm).map(x => Math.abs(val(x) || 0))))
  const fondo = x => {
    const v = val(x)
    if (met === 'eri') return tinte(semERI(v))
    const a = 0.10 + 0.55 * Math.min(1, Math.abs(v) / maxAbs)
    return v < 0 ? `rgba(180,35,24,${a})` : v > 0 ? `rgba(30,122,68,${a})` : IV.bgHead
  }
  const texto = x => { const v = val(x); if (vacio(v)) return '·'
    return met === 'eri' ? `${Math.round(v)}` : met === 'uds' ? `${v > 0 ? '+' : ''}${fmtN(v)}` : fmtSM(v) }
  const colorTxt = x => { const v = val(x); if (met === 'eri') return semERI(v)
    return Math.abs(v) / maxAbs > 0.55 ? '#fff' : v < 0 ? IV.rojo : v > 0 ? IV.verde : IV.slate }
  return (
    <Caja>
      <div style={{display:'flex', gap:8, flexWrap:'wrap', padding:'10px 12px', borderBottom:`1px solid ${IV.lineSoft}`}}>
        <Seg valor={met} onChange={setMet} opciones={METS}/>
        <Seg valor={eje} onChange={setEje} opciones={[{k:'categoria', l:'POR CATEGORÍA'}, {k:'bodega', l:'POR BODEGA'}]}/>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:920}}>
          <thead><tr>
            <th style={th()}>{eje === 'categoria' ? 'Categoría' : 'Bodega'}</th>
            {MES.map(m => <th key={m} style={th(true, {textAlign:'center', padding:'8px 3px'})}>{m}</th>)}
            <th style={th(true, {borderLeft:`1px solid ${IV.line}`})}>Año</th>
          </tr></thead>
          <tbody>{visibles.map(f => (
            <tr key={f.k}>
              <td style={td(false, {fontWeight:700, whiteSpace:'nowrap', fontSize:12})}>{trunc(f.label, 30)}</td>
              {MES.map((m, i) => {
                const x = f.pm[i + 1]
                if (!x) return <td key={m} style={td(true, {textAlign:'center', color:IV.line, padding:'7px 3px'})}>·</td>
                return (
                  <td key={m} title={`${f.label} · ${m}: exactitud ${fmtP(x.eri)} · aparecen ${fmtN(x.sobrUds)} · desaparecen ${fmtN(x.faltUds)} uds${puedeVerCostos ? ` · balance ${fmtCLP(x.sobrVal - x.faltVal)}` : ''}`}
                    style={td(true, {textAlign:'center', background:fondo(x), padding:'7px 3px', fontWeight:800,
                      fontSize:11, color:colorTxt(x), borderLeft:'1px solid #fff'})}>{texto(x)}</td>
                )
              })}
              <td style={td(true, {fontWeight:900, color:met === 'eri' ? semERI(val(f.total)) : val(f.total) < 0 ? IV.rojo : IV.verde,
                borderLeft:`1px solid ${IV.line}`})}>{texto(f.total)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {filas.length > 12 && (
        <div style={{padding:'6px 12px'}}>
          <button style={btn('ghost')} onClick={() => setTodas(v => !v)}>{todas ? 'VER LAS 12 PRINCIPALES' : `VER LAS ${filas.length}`}</button>
        </div>
      )}
      <div style={{display:'flex', gap:14, flexWrap:'wrap', padding:'8px 14px', borderTop:`1px solid ${IV.lineSoft}`, fontSize:10.5, color:IV.slate}}>
        {met === 'eri' ? [[IV.tVerde, IV.verde, '90% o más: sobre la meta'], [IV.tAmbar, IV.ambar, '70% a 89%: aceptable'], [IV.tRojo, IV.rojo, 'menos de 70%: crítico']]
          .map(([bg, c, l]) => <span key={l} style={{display:'inline-flex', alignItems:'center', gap:6}}>
            <span style={{width:14, height:12, background:bg, border:`1px solid ${c}55`}}/>{l}</span>)
          : [['rgba(180,35,24,0.55)', 'rojo: desaparece más de lo que aparece'], ['rgba(30,122,68,0.55)', 'verde: aparece más de lo que desaparece'], [IV.bgHead, 'más intenso = más grande']]
          .map(([bg, l]) => <span key={l} style={{display:'inline-flex', alignItems:'center', gap:6}}>
            <span style={{width:14, height:12, background:bg}}/>{l}</span>)}
      </div>
      <Lectura
        como={met === 'eri'
          ? 'Cada fila es una categoría y cada columna un mes. El número es el porcentaje de productos que cuadraron en los conteos de ese mes; la última columna es el año completo. Un punto significa que esa categoría no se contó ese mes.'
          : `Cada celda es el balance del mes: lo que apareció menos lo que desapareció${met === 'valor' ? ', valorizado a costo' : ', en unidades'}. Rojo resta, verde suma; mientras más intenso, más grande. La última columna es el año completo.`}
        buscar={met === 'eri'
          ? 'Filas que se mantienen en rojo mes a mes: ahí el problema es de proceso, no de un mal conteo. Y categorías con muchos puntos: se están contando poco.'
          : 'Una categoría en rojo varios meses seguidos está perdiendo producto de forma sistemática. Rojo y verde grandes en categorías hermanas (por ejemplo, primera y segunda del mismo producto) suelen ser el mismo producto registrado con otro código.'}/>
    </Caja>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CONCLUSIONES POR BODEGA — tres a cinco frases simples y una acción
// ═══════════════════════════════════════════════════════════════════════════
export function conclusionesBodega(D, riesgo, puedeVerCostos, nombreSuc, cabIdx) {
  return [...D.porSuc].sort((a, b) => (a.eri ?? 999) - (b.eri ?? 999)).map(s => {
    const ds = D.detsP.filter(d => cabIdx[d.inventario_id]?.sucursal_codigo === s.k)
    const porCat = Object.entries(agrupar(ds, d => d.tipo_producto || 'Sin categoría')).map(([k, x]) => ({k, ...calcular(x, D.abc, cabIdx)}))
    const prev = D.porSucPrev?.[s.k]
    const B = []
    const de10 = s.eri === null ? null : Math.round(s.eri / 10)
    let comp = ''
    if (prev && prev.eri !== null && s.eri !== null && D.pPrev) {
      comp = s.eri >= prev.eri + 2 ? `, mejor que en ${labelPeriodo(D.pPrev)} (${fmtP(prev.eri, 0)})`
        : s.eri <= prev.eri - 2 ? `, peor que en ${labelPeriodo(D.pPrev)} (${fmtP(prev.eri, 0)})` : ', igual que el período anterior'
    }
    B.push({c:semERI(s.eri), t:`Exactitud ${fmtP(s.eri, 0)}: ${de10} de cada 10 productos cuadran${comp}.`})
    const bu = s.sobrUds - s.faltUds
    if (puedeVerCostos && s.valorSis > 0) {
      const peor = porCat.filter(c => c.balance < 0).sort((a, b) => a.balance - b.balance)[0]
      B.push({c:s.balance < 0 ? IV.rojo : IV.verde, t:`Desaparecieron ${fmtM(s.faltVal)} y aparecieron ${fmtM(s.sobrVal)}: balance ${fmtSM(s.balance)} (${bu > 0 ? '+' : ''}${fmtN(bu)} unidades).${peor ? ` Lo que más resta es ${peor.k} (${fmtSM(peor.balance)}).` : ''}`})
    } else {
      const peorU = porCat.map(c => ({...c, bu:c.sobrUds - c.faltUds})).filter(c => c.bu < 0).sort((a, b) => a.bu - b.bu)[0]
      B.push({c:bu < 0 ? IV.rojo : IV.verde, t:`Desaparecieron ${fmtN(s.faltUds)} unidades y aparecieron ${fmtN(s.sobrUds)}: balance ${bu > 0 ? '+' : ''}${fmtN(bu)}.${peorU ? ` Donde más faltan: ${peorU.k} (${fmtN(peorU.bu)}).` : ''}`})
    }
    const peorE = porCat.filter(c => c.contadas >= 5 && c.eri !== null).sort((a, b) => a.eri - b.eri)[0]
    if (peorE && peorE.eri < 80) B.push({c:semERI(peorE.eri), t:`La categoría con más errores es ${peorE.k}: cuadra el ${fmtP(peorE.eri, 0)}.`})
    const cr = (D.cruces?.grupos || []).filter(g => cabIdx[g.inv]?.sucursal_codigo === s.k)
    if (cr.length) B.push({c:IV.navy, t:`${cr.length} cruce${cr.length === 1 ? '' : 's'} de código: producto que falta en un código y sobra en otro parecido${puedeVerCostos ? ` (${fmtM(cr.reduce((a, g) => a + g.valFalt, 0))})` : ''}. No es pérdida, es registro.`})
    const rb = (D.rebPrev || []).filter(x => x.cab.sucursal_codigo === s.k && x.cuadro)
    if (puedeVerCostos && rb.length) B.push({c:IV.rojo, t:`${rb.length} ${rb.length === 1 ? 'producto cuadró porque se rebajó' : 'productos cuadraron porque se rebajaron'} días antes del conteo (${fmtM(rb.reduce((a, x) => a + x.val, 0))}).`})
    const viejas = riesgo.filter(r => r.sucursal_codigo === s.k && (r.dias_sin_inventario === null || r.dias_sin_inventario > 180)).length
    if (viejas) B.push({c:IV.ambar, t:`${viejas} categoría${viejas === 1 ? '' : 's'} sin contar hace más de 180 días.`})
    const accion = rb.length && puedeVerCostos ? 'Revisar el respaldo de las rebajas registradas antes de los conteos.'
      : cr.length ? 'Corregir en BSALE los códigos cruzados antes de ajustar.'
      : peorE && peorE.eri < 70 ? `Recontar ${peorE.k} y revisar su ubicación en bodega.`
      : viejas ? 'Programar el conteo de las categorías atrasadas.'
      : s.eri !== null && s.eri >= 90 ? 'Mantener la rutina de conteos cíclicos.' : 'Aumentar la frecuencia de cíclicos en las categorías con más errores.'
    return {k:s.k, nombre:nombreSuc(s.k), s, B, accion}
  })
}

function Tarjeta({titulo, valor, color, estado, explica, delta, inv, onClick}) {
  return (
    <div onClick={onClick} style={{border:`1px solid ${IV.line}`, borderTop:`4px solid ${color}`, borderRadius:4,
      background:'#fff', padding:'14px 16px', cursor:onClick ? 'pointer' : 'default'}}>
      <div style={{fontSize:10.5, fontWeight:700, letterSpacing:0.8, color:IV.slate, textTransform:'uppercase'}}>{titulo}</div>
      <div style={{fontSize:30, fontWeight:900, color, marginTop:4, letterSpacing:-0.6, fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap'}}>
        {valor}<Delta v={delta} inv={inv}/></div>
      {estado && <div style={{fontSize:11, fontWeight:800, color, marginTop:1, letterSpacing:0.3}}>{estado}</div>}
      <div style={{fontSize:12, color:IV.ink, marginTop:7, lineHeight:1.5}}>{explica}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PANORAMA — la entrada: cómo estamos, qué pasó en el año y qué hacer
// ═══════════════════════════════════════════════════════════════════════════
export function TabPanorama(ctx) {
  const {D, riesgo, puedeVerCostos, nombreSuc, setTab, anio, periodo, padreDe, hayVentas, cabIdx, cu, contexto} = ctx
  const [pdf, setPdf] = useState(null)
  const M = D.M, P = D.Mprev
  if (!D.cabsP.length) return <Vacio t="Sin inventarios en el período" s="Ajusta bodega, año, período o tipo."/>
  const mv = puedeVerCostos && padreDe ? mermaSobreVenta(D, padreDe) : null
  const glob = diagnosticar(D, riesgo, puedeVerCostos, nombreSuc, {mv, hayVentas}).slice(0, 4)
  const porB = conclusionesBodega(D, riesgo, puedeVerCostos, nombreSuc, cabIdx)
  const bu = M.sobrUds - M.faltUds
  const alDia = riesgo.filter(r => r.dias_sin_inventario !== null && r.dias_sin_inventario <= 90).length
  const cSev = {rojo:IV.rojo, ambar:IV.ambar, verde:IV.verde, info:IV.azul}
  const titular = puedeVerCostos && M.valorSis > 0
    ? `${frasePeriodo(periodo, anio)} se hicieron ${D.cabsP.length} conteos: cuadró el ${fmtP(M.eri, 0)} de los productos y el balance fue ${fmtSM(M.balance)}.`
    : `${frasePeriodo(periodo, anio)} se hicieron ${D.cabsP.length} conteos: cuadró el ${fmtP(M.eri, 0)} de los productos y el balance fue de ${bu > 0 ? '+' : ''}${fmtN(bu)} unidades.`
  const bajada = M.eri === null ? '' : M.eri >= 90 ? 'La exactitud está sobre la meta del 90%.'
    : `La meta es 90%: ${Math.round((100 - M.eri) / 10)} de cada 10 productos todavía no cuadran.` +
      (M.compens !== null && M.compens >= 70 && puedeVerCostos ? ' Lo que falta y lo que sobra casi se compensan: el problema es más de registro que de pérdida.' : '')

  async function descargar() {
    setPdf('Preparando el informe…')
    try {
      await generarInformePDF({...ctx, glob, porB, titular, bajada, mv})
      setPdf(null)
    } catch (e) { console.error(e); setPdf('No se pudo generar el PDF: ' + e.message) }
  }

  return (<>
    <div style={{display:'flex', gap:12, alignItems:'stretch', marginBottom:14, flexWrap:'wrap'}}>
      <div style={{flex:1, minWidth:320, border:`1px solid ${IV.line}`, borderLeft:`4px solid ${IV.navy}`, borderRadius:4, background:'#fff', padding:'14px 18px'}}>
        <div style={{fontSize:18, fontWeight:800, color:IV.ink, letterSpacing:-0.3, lineHeight:1.35}}>{titular}</div>
        {bajada && <div style={{fontSize:13, color:IV.slate, marginTop:6, lineHeight:1.55}}>{bajada}</div>}
      </div>
      <div style={{display:'flex', flexDirection:'column', justifyContent:'center', gap:6}}>
        <button style={{...btn('solid'), padding:'10px 16px'}} onClick={descargar} disabled={!!pdf && !pdf.startsWith('No')}>
          {pdf && !pdf.startsWith('No') ? 'GENERANDO…' : 'DESCARGAR INFORME PDF'}</button>
        {pdf && pdf.startsWith('No') && <div style={{fontSize:11, color:IV.rojo, maxWidth:220}}>{pdf}</div>}
      </div>
    </div>

    <div style={{display:'grid', gridTemplateColumns:`repeat(${puedeVerCostos && M.valorSis > 0 ? 4 : 3},minmax(0,1fr))`, gap:10, marginBottom:20}}>
      <Tarjeta titulo="Exactitud" valor={fmtP(M.eri, 0)} color={semERI(M.eri)}
        estado={M.eri >= 90 ? 'SOBRE LA META' : M.eri >= 70 ? 'BAJO LA META' : 'CRÍTICO'}
        delta={P && P.eri !== null && M.eri !== null ? M.eri - P.eri : null}
        explica={`${Math.round((M.eri || 0) / 10)} de cada 10 productos contados cuadraron exacto con el sistema. Meta: 90%.`}
        onClick={() => setTab('exactitud')}/>
      <Tarjeta titulo="Balance en unidades" valor={`${bu > 0 ? '+' : ''}${fmtN(bu)}`} color={bu < 0 ? IV.rojo : IV.verde}
        estado={bu < 0 ? 'FALTA MÁS DE LO QUE SOBRA' : 'SOBRA MÁS DE LO QUE FALTA'}
        explica={`Desaparecieron ${fmtN(M.faltUds)} unidades y aparecieron ${fmtN(M.sobrUds)} en los conteos.`}
        onClick={() => setTab('inventarios')}/>
      {puedeVerCostos && M.valorSis > 0 && (
        <Tarjeta titulo="Balance en costo" valor={fmtSM(M.balance)} color={M.balance < 0 ? IV.rojo : IV.verde}
          estado={`${fmtP(-M.pctPerd, 2)} DEL VALOR CONTADO`}
          explica={`Desapareció ${fmtM(M.faltVal)} y apareció ${fmtM(M.sobrVal)}, a costo.${mv ? ` Merma sobre venta: ${fmtP(mv.pct, 2)}.` : ''}`}
          onClick={() => setTab('valor')}/>
      )}
      <Tarjeta titulo="Conteos" valor={fmtN(D.cabsP.length)} color={IV.navy}
        estado={`${fmtN(M.contadas)} PRODUCTOS CONTADOS`}
        explica={riesgo.length ? `${alDia} de ${riesgo.length} categorías se contaron en los últimos 90 días.` : 'Inventarios cerrados en el período.'}
        onClick={() => setTab('cobertura')}/>
    </div>

    <Seccion titulo="Conclusiones" sub="generadas a partir de los conteos del período">
      <div style={{display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1.6fr)', gap:14, alignItems:'start'}}>
        <Caja>
          <div style={{padding:'10px 14px 6px', fontSize:10.5, fontWeight:700, letterSpacing:0.7, color:IV.slate}}>EN GENERAL</div>
          {glob.map((h, i) => (
            <div key={i} onClick={() => setTab(h.tab)} style={{padding:'9px 14px', cursor:'pointer', boxShadow:`inset 3px 0 0 ${cSev[h.sev]}`,
              borderTop:`1px solid ${IV.lineSoft}`}}>
              <div style={{fontSize:12.5, fontWeight:700, color:h.sev === 'info' ? IV.ink : cSev[h.sev], lineHeight:1.4}}>{h.t}</div>
              <div style={{fontSize:11.5, color:IV.slate, marginTop:2, lineHeight:1.5}}>{h.d}</div>
            </div>
          ))}
        </Caja>
        <div style={{display:'grid', gridTemplateColumns:`repeat(${Math.min(2, porB.length)},minmax(0,1fr))`, gap:10}}>
          {porB.map(b => (
            <div key={b.k} style={{border:`1px solid ${IV.line}`, borderTop:`4px solid ${semERI(b.s.eri)}`, borderRadius:4, background:'#fff'}}>
              <div style={{display:'flex', alignItems:'baseline', gap:8, padding:'10px 14px 6px'}}>
                <div style={{fontSize:13.5, fontWeight:800, color:IV.ink}}>{b.nombre}</div>
                <div style={{marginLeft:'auto', fontSize:11, color:IV.slate}}>{b.s.invs} conteo{b.s.invs === 1 ? '' : 's'}</div>
              </div>
              {b.B.map((x, i) => (
                <div key={i} style={{display:'flex', gap:8, padding:'4px 14px', fontSize:12, lineHeight:1.5, color:IV.ink}}>
                  <span style={{width:6, height:6, borderRadius:'50%', background:x.c, marginTop:6, flexShrink:0}}/>{x.t}
                </div>
              ))}
              <div style={{margin:'8px 14px 12px', padding:'7px 10px', background:IV.bgHead, borderRadius:3, fontSize:11.5, fontWeight:700, color:IV.navy}}>
                Qué hacer: {b.accion}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Seccion>

    <Seccion titulo={`Tendencia de ${anio}`} sub="año completo, mes a mes · los tres gráficos usan la misma escala de meses">
      <div style={{display:'grid', gap:14}}>
        <div data-pdf-grafico data-pdf-titulo={`Exactitud mes a mes · ${anio}`}>
          <Caja>
            <div style={{padding:'10px 14px 0', fontSize:13, fontWeight:800, color:IV.ink}}>Exactitud mes a mes</div>
            <div style={{padding:'4px 8px'}}><GrafMesERI meses={D.porMes}/></div>
            <Lectura como="Cada barra es un mes. Su altura y el número sobre ella muestran qué porcentaje de los productos contados ese mes cuadró con el sistema. Verde está sobre la meta del 90% (línea punteada), ámbar entre 70% y 89%, rojo bajo 70%. La fila de abajo dice cuántos productos se contaron cada mes."
              buscar="Si las barras suben mes a mes, el control está mejorando. Un mes con pocas líneas contadas pesa poco: no saques conclusiones de un mes con 20 productos."/>
          </Caja>
        </div>
        <div data-pdf-grafico data-pdf-titulo={`Balance en unidades mes a mes · ${anio}`}>
          <Caja>
            <div style={{padding:'10px 14px 0', fontSize:13, fontWeight:800, color:IV.ink}}>Balance en unidades mes a mes</div>
            <div style={{padding:'4px 8px'}}><GrafMesBalance meses={D.porMes} base="uds"/></div>
            <Lectura como="Sobre la línea, en verde, las unidades que aparecieron (había más de lo que decía el sistema). Bajo la línea, en rojo, las que desaparecieron. La fila de números bajo los meses es el balance: lo que apareció menos lo que desapareció."
              buscar="Barras rojas largas que se repiten indican pérdida constante. Barras verdes y rojas del mismo tamaño en el mismo mes indican desorden de registro: el producto está, pero anotado en otro lado."/>
          </Caja>
        </div>
        {puedeVerCostos && (
          <div data-pdf-grafico data-pdf-titulo={`Balance en costo mes a mes · ${anio}`}>
            <Caja>
              <div style={{padding:'10px 14px 0', fontSize:13, fontWeight:800, color:IV.ink}}>Balance en costo mes a mes</div>
              <div style={{padding:'4px 8px'}}><GrafMesBalance meses={D.porMes} base="valor"/></div>
              <Lectura como="El mismo gráfico anterior, pero valorizado a costo: verde lo que apareció en pesos, rojo lo que desapareció, y la fila de abajo el balance del mes."
                buscar="Compáralo con el de unidades: si en unidades el mes está parejo pero en pesos no, lo que falta vale más que lo que sobra (se pierde producto caro y aparece producto barato)."/>
            </Caja>
          </div>
        )}
      </div>
    </Seccion>

    <Seccion titulo="Mapa por categoría" sub="la tendencia de cada categoría o bodega · cambia la métrica arriba del mapa">
      <MapaMeses D={D} cabIdx={cabIdx} nombreSuc={nombreSuc} puedeVerCostos={puedeVerCostos}/>
    </Seccion>

    <Guia titulo="CÓMO USAR ESTE ANÁLISIS">
      El análisis está ordenado de lo general a lo particular. <strong>Panorama</strong> responde cómo estamos y qué hacer. <strong>Inventarios</strong> muestra cada conteo, en orden, con lo que desapareció, lo que apareció y el acumulado; cada fila se abre en categorías y la ficha trae el detalle completo. <strong>Profundizar</strong> reúne los análisis especializados: resultado en pesos, rebajas previas, exactitud, cobertura, clase ABC, comparación de conteos y bono.
      <div style={{marginTop:6}}><strong>Exactitud</strong>: de cada 100 productos contados, cuántos cuadraron exacto con el sistema. <strong>Aparecen</strong>: había más de lo registrado. <strong>Desaparecen</strong>: había menos. <strong>Balance</strong>: aparecen menos desaparecen.</div>
    </Guia>
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFUNDIZAR — los análisis especializados, agrupados
// ═══════════════════════════════════════════════════════════════════════════
export function TabProfundizar(ctx) {
  const {sub, setSub, puedeVerCostos, puedeVerBono} = ctx
  const SUBS = [
    {k:'resultado', l:'Resultado', d:'Pérdida, ganancia y balance en pesos: qué categorías restan, cuánto se explica por cruces de código y cuánto se pierde de verdad.', r:!puedeVerCostos},
    {k:'rebajas',   l:'Rebajas previas', d:'Stock rebajado días antes de contar: pérdida que no aparece en el conteo porque ya se había dado de baja.', r:!puedeVerCostos},
    {k:'exactitud', l:'Exactitud', d:'Qué tan grandes son los errores, si predominan faltantes o sobrantes, y qué productos fallan una y otra vez.'},
    {k:'cobertura', l:'Cobertura', d:'Qué categorías llevan tiempo sin contarse y cuáles conviene contar primero.'},
    {k:'abc',       l:'Clase ABC', d:'La exactitud en los productos que más valen: la clase A debería ser la más controlada.', r:!puedeVerCostos},
    {k:'comparar',  l:'Comparar', d:'Dos conteos de la misma bodega, producto a producto: qué mejoró y qué empeoró.'},
    {k:'bono',      l:'Bono trimestral', d:'El cálculo del bono de cada bodega por trimestre.', r:!puedeVerBono},
  ].filter(s => !s.r)
  const act = SUBS.find(s => s.k === sub) || SUBS[0]
  return (<>
    <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:8}}>
      {SUBS.map(s => (
        <div key={s.k} onClick={() => setSub(s.k)} style={{padding:'6px 12px', borderRadius:3, cursor:'pointer', fontSize:11.5, fontWeight:700,
          border:`1px solid ${act.k === s.k ? IV.navy : IV.line}`, background:act.k === s.k ? IV.navy : '#fff',
          color:act.k === s.k ? '#fff' : IV.slate, userSelect:'none'}}>{s.l}</div>
      ))}
    </div>
    <div style={{fontSize:12, color:IV.slate, marginBottom:14, lineHeight:1.5}}>{act.d}</div>
    {act.k === 'resultado' && <TabResultado {...ctx}/>}
    {act.k === 'rebajas'   && <TabRebajas {...ctx}/>}
    {act.k === 'exactitud' && <TabExactitud {...ctx}/>}
    {act.k === 'cobertura' && <TabCobertura {...ctx}/>}
    {act.k === 'abc'       && <TabABC {...ctx}/>}
    {act.k === 'comparar'  && <TabComparar {...ctx}/>}
    {act.k === 'bono'      && <TabBono {...ctx}/>}
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// INFORME PDF — panorama, conclusiones, tendencia, categorías, conteos y control
// ═══════════════════════════════════════════════════════════════════════════
let _pdfLib = null
async function cargarPDFLib() {
  if (!_pdfLib) {
    const [m1, m2] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const J = typeof m1.jsPDF === 'function' ? m1.jsPDF : typeof m1.default === 'function' ? m1.default : m1.default?.jsPDF
    const fn = typeof m2.default === 'function' ? m2.default : typeof m2.default?.default === 'function' ? m2.default.default
      : typeof m2.autoTable === 'function' ? m2.autoTable : null
    _pdfLib = {jsPDF:J, autoTable:(doc, o) => fn ? fn(doc, o) : doc.autoTable(o)}
  }
  return _pdfLib
}
// Las fuentes estándar del PDF no traen algunos signos: se reemplazan por equivalentes
const pdfTxt = s => String(s ?? '').replace(/−/g, '-').replace(/▲/g, '+').replace(/▼/g, '-').replace(/→/g, '>')
  .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/…/g, '...').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
async function svgAPng(svg, anchoPx = 1500) {
  const vb = svg.viewBox?.baseVal
  const w = vb?.width || svg.clientWidth || 760, h = vb?.height || svg.clientHeight || 240
  const cl = svg.cloneNode(true)
  cl.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); cl.setAttribute('width', w); cl.setAttribute('height', h)
  cl.setAttribute('style', 'font-family:Helvetica,Arial,sans-serif;background:#fff')
  cl.querySelectorAll('title').forEach(t => t.remove())
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(cl))
  const img = new Image()
  await Promise.race([
    new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('no se pudo dibujar el gráfico')); img.src = url }),
    new Promise((_, no) => setTimeout(() => no(new Error('el gráfico tardó demasiado')), 2500)),
  ])
  const cv = document.createElement('canvas'); cv.width = anchoPx; cv.height = Math.round(anchoPx * h / w)
  const cx = cv.getContext('2d'); if (!cx) throw new Error('sin lienzo para dibujar')
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height)
  return {data:cv.toDataURL('image/jpeg', 0.9), ratio:h / w}
}

export async function generarInformePDF({D, cabIdx, nombreSuc, puedeVerCostos, contexto, cu, glob, porB, titular, bajada, mv, anio}) {
  const {jsPDF, autoTable} = await cargarPDFLib()
  const doc = new jsPDF({unit:'mm', format:'a4'})
  const W = 210, Hp = 297, Mx = 14, ancho = W - 2 * Mx
  const NAVY = [22, 33, 62], INK = [28, 28, 30], SLATE = [110, 110, 115], ROJO = [180, 35, 24], VERDE = [30, 122, 68], AMBAR = [178, 94, 9]
  const rgbDe = c => c === IV.rojo ? ROJO : c === IV.verde ? VERDE : c === IV.ambar ? AMBAR : c === IV.navy ? NAVY : SLATE
  const M = D.M, bu = M.sobrUds - M.faltUds
  let y = 0
  const nuevaPag = () => { doc.addPage(); y = 18 }
  const espacio = h => { if (y + h > Hp - 16) nuevaPag() }
  const titulo = (t, sub) => {
    espacio(16)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...NAVY); doc.text(pdfTxt(t), Mx, y)
    if (sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...SLATE); doc.text(pdfTxt(sub), Mx, y + 4.5) }
    doc.setDrawColor(...NAVY); doc.setLineWidth(0.5); doc.line(Mx, y + (sub ? 7 : 2.5), W - Mx, y + (sub ? 7 : 2.5))
    y += sub ? 12 : 8
  }
  const parrafo = (t, tam = 9.5, color = INK, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(tam); doc.setTextColor(...color)
    const ls = doc.splitTextToSize(pdfTxt(t), ancho)
    espacio(ls.length * tam * 0.42 + 2); doc.text(ls, Mx, y); y += ls.length * tam * 0.42 + 2
  }
  const vineta = (t, color) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK)
    const ls = doc.splitTextToSize(pdfTxt(t), ancho - 6)
    espacio(ls.length * 3.9 + 1.5)
    doc.setFillColor(...(color || SLATE)); doc.circle(Mx + 1.4, y - 1.1, 1, 'F')
    doc.text(ls, Mx + 5, y); y += ls.length * 3.9 + 1.5
  }
  const tabla = (head, body, opts = {}) => {
    autoTable(doc, {startY:y, head:[head.map(pdfTxt)], body:body.map(r => r.map(pdfTxt)), margin:{left:Mx, right:Mx},
      styles:{fontSize:7.8, cellPadding:1.6, textColor:INK, lineColor:[225, 225, 230], lineWidth:0.1},
      headStyles:{fillColor:[244, 244, 246], textColor:SLATE, fontStyle:'bold', fontSize:7.2},
      alternateRowStyles:{fillColor:[250, 250, 251]}, ...opts})
    y = doc.lastAutoTable.finalY + 7
  }

  // ── Portada: titular, indicadores y conclusiones generales ──
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('Informe de inventario', Mx, 13)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(pdfTxt(contexto), Mx, 20)
  doc.text(pdfTxt(`Outlet de Puertas · Logística · emitido el ${new Date().toLocaleString('es-CL')}${cu?.nombre ? ` por ${cu.nombre}` : ''}`), Mx, 25.5)
  y = 40
  parrafo(titular, 12.5, INK, true)
  if (bajada) parrafo(bajada, 9.5, SLATE)
  y += 2
  const kpis = [
    ['EXACTITUD', fmtP(M.eri, 0), `${Math.round((M.eri || 0) / 10)} de cada 10 productos cuadran · meta 90%`, rgbDe(semERI(M.eri))],
    ['BALANCE EN UNIDADES', `${bu > 0 ? '+' : ''}${fmtN(bu)}`, `desaparecen ${fmtN(M.faltUds)} · aparecen ${fmtN(M.sobrUds)}`, bu < 0 ? ROJO : VERDE],
    ...(puedeVerCostos && M.valorSis > 0 ? [['BALANCE EN COSTO', fmtSM(M.balance), `desaparece ${fmtM(M.faltVal)} · aparece ${fmtM(M.sobrVal)}`, M.balance < 0 ? ROJO : VERDE]] : []),
    ['CONTEOS', fmtN(D.cabsP.length), `${fmtN(M.contadas)} productos contados`, NAVY],
  ]
  const kw = (ancho - (kpis.length - 1) * 3) / kpis.length
  kpis.forEach(([t, v, s, c], i) => {
    const x = Mx + i * (kw + 3)
    doc.setDrawColor(218, 218, 223); doc.setLineWidth(0.2); doc.rect(x, y, kw, 24)
    doc.setFillColor(...c); doc.rect(x, y, kw, 1.4, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor(...SLATE); doc.text(pdfTxt(t), x + 3, y + 6)
    doc.setFontSize(15); doc.setTextColor(...c); doc.text(pdfTxt(v), x + 3, y + 14)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...INK)
    doc.text(doc.splitTextToSize(pdfTxt(s), kw - 6), x + 3, y + 19)
  })
  y += 32
  titulo('Conclusiones generales')
  glob.forEach(h => { vineta(`${h.t}. ${h.d}`, rgbDe({rojo:IV.rojo, ambar:IV.ambar, verde:IV.verde}[h.sev] || IV.navy)) })
  if (mv) vineta(`Merma sobre venta en tiendas: ${fmtP(mv.pct, 2)} (referencia retail 1,4% a 1,6%).`, NAVY)

  // ── Conclusiones por bodega ──
  y += 3
  titulo('Conclusiones por bodega', 'ordenadas de menor a mayor exactitud')
  porB.forEach(b => {
    espacio(18)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...rgbDe(semERI(b.s.eri)))
    doc.text(pdfTxt(`${b.nombre} · exactitud ${fmtP(b.s.eri, 0)} · ${b.s.invs} conteo${b.s.invs === 1 ? '' : 's'}`), Mx, y); y += 5
    b.B.forEach(x => vineta(x.t, rgbDe(x.c)))
    parrafo(`Qué hacer: ${b.accion}`, 9, NAVY, true); y += 2
  })

  // ── Tendencia: los gráficos del panorama y la tabla por mes ──
  nuevaPag()
  titulo(`Tendencia de ${anio}`, 'año completo, mes a mes')
  const graficos = [...document.querySelectorAll('[data-pdf-grafico]')]
  // punto de enganche solo para pruebas automatizadas (en el navegador se usa svgAPng)
  const rasterizar = (typeof window !== 'undefined' && window.__rasterizarSVG__) || svgAPng
  for (const g of graficos) {
    const svg = g.querySelector('svg'); if (!svg) continue
    try {
      const im = await rasterizar(svg), h = ancho * im.ratio
      espacio(h + 9)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK)
      doc.text(pdfTxt(g.getAttribute('data-pdf-titulo') || ''), Mx, y); y += 2.5
      doc.addImage(im.data, 'JPEG', Mx, y, ancho, h, undefined, 'FAST'); y += h + 6
    } catch (e) { /* si un gráfico no se puede dibujar, el informe sigue con las tablas */ }
  }
  const filasMes = MES.map((m, i) => ({m, x:D.porMes[i + 1]})).filter(r => r.x)
  tabla(['Mes', 'Líneas', 'Exactitud', 'Desaparecen', 'Aparecen', 'Balance uds', ...(puedeVerCostos ? ['Balance costo'] : [])],
    filasMes.map(({m, x}) => [m, fmtN(x.contadas), fmtP(x.eri, 0), fmtN(x.faltUds), fmtN(x.sobrUds),
      `${x.sobrUds - x.faltUds > 0 ? '+' : ''}${fmtN(x.sobrUds - x.faltUds)}`, ...(puedeVerCostos ? [fmtCLP(x.sobrVal - x.faltVal)] : [])]),
    {columnStyles:{1:{halign:'right'}, 2:{halign:'right'}, 3:{halign:'right'}, 4:{halign:'right'}, 5:{halign:'right'}, 6:{halign:'right'}}})

  // ── Balance por categoría ──
  titulo('Balance por categoría', puedeVerCostos ? 'período filtrado · ordenado por balance en costo' : 'período filtrado · ordenado por balance en unidades')
  const cats = [...D.porCat].sort((a, b) => puedeVerCostos ? a.balance - b.balance : (a.sobrUds - a.faltUds) - (b.sobrUds - b.faltUds))
  tabla(['Categoría', 'Líneas', 'Exactitud', 'Desaparecen', 'Aparecen', 'Balance uds', ...(puedeVerCostos ? ['Desaparece $', 'Aparece $', 'Balance $'] : [])],
    cats.map(c => [c.k, fmtN(c.contadas), fmtP(c.eri, 0), fmtN(c.faltUds), fmtN(c.sobrUds),
      `${c.sobrUds - c.faltUds > 0 ? '+' : ''}${fmtN(c.sobrUds - c.faltUds)}`,
      ...(puedeVerCostos ? [fmtCLP(-c.faltVal), fmtCLP(c.sobrVal), fmtCLP(c.balance)] : [])]),
    {columnStyles:{1:{halign:'right'}, 2:{halign:'right'}, 3:{halign:'right'}, 4:{halign:'right'}, 5:{halign:'right'}, 6:{halign:'right'}, 7:{halign:'right'}, 8:{halign:'right'}}})

  // ── Conteo por conteo, con el acumulado ──
  titulo('Conteo por conteo', 'en orden de fecha · el acumulado excluye diferencias repetidas y descuenta las rebajas previas')
  const notaDe = Object.fromEntries(D.porInv.map(x => [x.cab.id, x.nota?.nota || '']))
  tabla(['Fecha', 'Bodega', 'Tipo', 'Líneas', 'Exactitud', 'Nota', 'Balance uds', ...(puedeVerCostos ? ['Balance $', 'Acumulado $'] : ['Acumulado uds'])],
    (D.libro?.filas || []).map(f => {
      const ex = f.tot.lineas ? f.tot.cuadran / f.tot.lineas * 100 : null
      return [fechaEf(f.cab), nombreSuc(f.cab.sucursal_codigo), f.cab.tipo_inventario === 'GENERAL' ? 'General' : 'Cíclico',
        fmtN(f.tot.lineas), fmtP(ex, 0), notaDe[f.cab.id] || '', `${balFila(f.tot, 'uds') > 0 ? '+' : ''}${fmtN(balFila(f.tot, 'uds'))}`,
        ...(puedeVerCostos ? [fmtCLP(balFila(f.tot, 'valor')), fmtCLP(balAjustado(f.acum, 'valor'))] : [`${fmtN(balAjustado(f.acum, 'uds'))}`])]
    }),
    {columnStyles:{3:{halign:'right'}, 4:{halign:'right'}, 5:{halign:'center'}, 6:{halign:'right'}, 7:{halign:'right'}, 8:{halign:'right'}}})

  // ── Control: cruces de código y rebajas previas ──
  if (puedeVerCostos && ((D.cruces?.grupos || []).length || (D.rebPrev || []).length)) {
    titulo('Hallazgos de control')
    if ((D.cruces?.grupos || []).length) {
      parrafo('Cruces de código: producto que falta en un código y sobra en otro parecido, en el mismo conteo. No es pérdida; se corrige reclasificando en BSALE.', 8.5, SLATE)
      tabla(['Conteo', 'Falta', 'Probablemente registrado como', 'Uds', 'Valor'],
        D.cruces.grupos.slice(0, 12).map(g => [`${nombreSuc(cabIdx[g.inv]?.sucursal_codigo)} ${fechaEf(cabIdx[g.inv])}`, trunc(g.falt.producto || g.falt.sku, 34),
          g.sobrantes.map(s => trunc(sinPrefijoComun(s.d.producto || s.d.sku, g.falt.producto), 26)).join(' · '), fmtN(g.uds), fmtCLP(g.valFalt)]),
        {columnStyles:{3:{halign:'right'}, 4:{halign:'right'}}})
    }
    const rb = (D.rebPrev || []).filter(x => x.sospecha === 'ALTA').sort((a, b) => b.val - a.val)
    if (rb.length) {
      parrafo('Rebajas previas con sospecha alta: stock rebajado días antes de contar un producto que después cuadró exacto. La pérdida no aparece en el conteo porque ya se había dado de baja.', 8.5, SLATE)
      tabla(['Conteo', 'Producto', 'Rebaja', 'Días antes', 'Uds', 'Costo'],
        rb.slice(0, 15).map(x => [`${nombreSuc(x.cab.sucursal_codigo)} ${x.f}`, trunc(x.d.producto || x.d.sku, 34),
          CLASE_BAJA[x.clase] || x.clase, String(x.minDias), fmtN(x.q), fmtCLP(x.val)]),
        {columnStyles:{3:{halign:'right'}, 4:{halign:'right'}, 5:{halign:'right'}}})
    }
  }

  // ── Cómo interpretar ──
  titulo('Cómo interpretar este informe')
  ;[
    'Exactitud: de cada 100 productos contados, cuántos cuadraron exacto con el sistema. La meta es 90%.',
    'Desaparecen: unidades que el sistema decía tener y no estaban. Aparecen: unidades que estaban y el sistema no registraba. Balance: aparecen menos desaparecen.',
    'Balance en costo: las mismas unidades valorizadas al costo del producto. Un balance cercano a cero con mucha desaparición y aparición indica desorden de registro, no ausencia de pérdida.',
    'Cruce de código: producto que falta en un código y sobra en otro parecido en el mismo conteo; es un error de registro.',
    'Rebaja previa: baja de stock registrada en los 15 días anteriores a contar el mismo producto. No incluye lo que pasa a segunda.',
    'Nota del conteo (A a E): resume exactitud, exactitud valorizada y acuerdo entre contadores. A es clase mundial; E pide revisar a fondo.',
    'Se consideran solo inventarios cerrados y no marcados como prueba.',
  ].forEach(t => vineta(t, NAVY))

  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...SLATE)
    doc.text(pdfTxt(`Informe de inventario · ${contexto}`), Mx, Hp - 8)
    doc.text(`Página ${i} de ${n}`, W - Mx, Hp - 8, {align:'right'})
  }
  doc.save(`Informe_inventario_${String(contexto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60)}.pdf`)
}
