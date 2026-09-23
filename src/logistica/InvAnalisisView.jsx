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
//   EXACTITUD       ERI estricto y con tolerancia ABC, distribución del error,
//                   sesgo, por bodega / categoría / inventario
//   VALORIZACIÓN    Valor sistema vs físico, pérdida neta, descuadre bruto,
//                   concentración de impacto, inventario vs bajas registradas
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
const COLS_DET = 'id,inventario_id,sku,producto,tipo_producto,stock_sistema,stock_fisico,' +
                 'diferencia,costo_unitario,precio_costo_ref,cruce_confirmado_con'

// ── Formato ─────────────────────────────────────────────────────────────────
const vacio = n => n === null || n === undefined || Number.isNaN(Number(n))
export const fmtCLP = n => vacio(n) ? '—' : new Intl.NumberFormat('es-CL',
  {style:'currency', currency:'CLP', maximumFractionDigits:0}).format(Math.round(Number(n)))
export const fmtN = n => vacio(n) ? '—' : new Intl.NumberFormat('es-CL').format(Math.round(Number(n)))
export const fmtP = (n, d = 1) => vacio(n) ? '—' : `${Number(n).toFixed(d).replace('.', ',')}%`
export const fmtM = n => {
  if (vacio(n)) return '—'
  const v = Number(n), a = Math.abs(v), s = v < 0 ? '−' : ''
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1).replace('.', ',')}M`
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
export function calcular(ds, abc, cabIdx) {
  const o = {lineas:ds.length, contadas:0, cuadran:0, dentroTol:0, faltN:0, sobrN:0,
    faltUds:0, sobrUds:0, valorSis:0, valorFis:0, faltVal:0, sobrVal:0,
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
    if (c === null) { if (costoBruto(d) > COSTO_MAX) o.outliers++; else o.sinCosto++; continue }
    o.lineasCosto++
    o.valorSis += sis * c
    o.valorFis += (Number(d.stock_fisico) || 0) * c
    if (dif < 0) o.faltVal += -dif * c; else if (dif > 0) o.sobrVal += dif * c
  }
  o.eri       = o.contadas ? o.cuadran / o.contadas * 100 : null
  o.eriTol    = o.contadas ? o.dentroTol / o.contadas * 100 : null
  o.perdNeta  = o.faltVal - o.sobrVal
  o.descuadre = o.faltVal + o.sobrVal
  o.pctPerd   = o.valorSis > 0 ? o.perdNeta / o.valorSis * 100 : null
  o.pctDesc   = o.valorSis > 0 ? o.descuadre / o.valorSis * 100 : null
  o.exactVal  = o.pctDesc === null ? null : Math.max(0, 100 - o.pctDesc)
  o.varAbsUds = o.faltUds + o.sobrUds
  o.sesgo     = (o.faltN + o.sobrN) ? o.faltN / (o.faltN + o.sobrN) * 100 : null
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
  const [suc, setSuc]         = useState('todas')
  const [anio, setAnio]       = useState(new Date().getFullYear())
  const [periodo, setPeriodo] = useState('anio')
  const [tipo, setTipo]       = useState('todos')
  const [cabs, setCabs]       = useState(null)
  const [cache, setCache]     = useState({})         // anio → detalles
  const [cargando, setCarg]   = useState(false)
  const [riesgo, setRiesgo]   = useState([])
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

  const cabIdx = useMemo(() => Object.fromEntries((cabs || []).map(c => [c.id, c])), [cabs])
  const nombreSuc = k => sucs.find(s => s.codigo === k)?.nombre || cabs?.find(c => c.sucursal_codigo === k)?.sucursal_nombre || k
  const sucsDisp = useMemo(() => [...new Set((cabs || []).map(c => c.sucursal_codigo))]
    .map(k => ({k, l:nombreSuc(k)})).sort((a, b) => a.l.localeCompare(b.l)),
    // eslint-disable-next-line
    [cabs, sucs])
  const aniosDisp = useMemo(() => [...new Set((cabs || []).map(c => anioDe(fechaEf(c))).filter(Boolean))]
    .sort((a, b) => b - a), [cabs])

  const detsAnio = cache[anio] || []
  const sig = `${anio}|${suc}|${tipo}|${periodo}|${detsAnio.length}|${(cabs || []).length}`

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
    const M = calcular(detsP, abc, cabIdx)
    const Mprev = pPrev && detsPr.length ? calcular(detsPr, abc, cabIdx) : null
    const sucOf = d => cabIdx[d.inventario_id]?.sucursal_codigo
    const porSuc = Object.entries(agrupar(detsP, sucOf)).map(([k, ds]) => ({k, ...calcular(ds, abc, cabIdx),
      invs:cabsP.filter(c => c.sucursal_codigo === k).length,
      ultimo:(cabs || []).filter(c => c.sucursal_codigo === k).map(fechaEf).sort().pop()}))
    const porCat = Object.entries(agrupar(detsP, d => d.tipo_producto || 'Sin categoría'))
      .map(([k, ds]) => ({k, ...calcular(ds, abc, cabIdx)}))
    const porInv = cabsP.map(c => ({cab:c, ...calcular(detsP.filter(d => d.inventario_id === c.id), abc, cabIdx)}))
      .sort((a, b) => (fechaEf(b.cab) || '').localeCompare(fechaEf(a.cab) || ''))
    // Impacto por SKU en el período
    const skuImp = {}
    detsP.forEach(d => {
      if (d.stock_fisico === null || d.stock_fisico === undefined) return
      const dif = Number(d.diferencia) || 0; if (!dif) return
      const k = `${sucOf(d)}|${d.sku}`
      const c = costoDe(d)
      const s = skuImp[k] || (skuImp[k] = {k, sku:d.sku, producto:d.producto, cat:d.tipo_producto, suc:sucOf(d),
        dif:0, abs:0, imp:0, impAbs:0, veces:0, costo:c})
      s.dif += dif; s.abs += Math.abs(dif); s.veces++
      if (c !== null) { s.imp += dif * c; s.impAbs += Math.abs(dif * c) }
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
    Object.entries(agrupar(detsA, mesOf)).forEach(([m, ds]) => { porMes[m] = calcular(ds, abc, cabIdx) })
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
    return {cabsA, cabsP, detsA, detsP, abc, M, Mprev, pPrev, porSuc, porCat, porInv, topSku, top10Share,
            reincidentes, porMes, buckets}
    // eslint-disable-next-line
  }, [sig, cabIdx])

  const cobRiesgo = useMemo(() => riesgo.filter(r => suc === 'todas' || r.sucursal_codigo === suc), [riesgo, suc])

  const TABS = [
    {k:'resumen',   l:'RESUMEN'},
    {k:'exactitud', l:'EXACTITUD'},
    {k:'valor',     l:'VALORIZACIÓN', r:!puedeVerCostos},
    {k:'cobertura', l:'COBERTURA'},
    {k:'tendencia', l:'TENDENCIA'},
    {k:'abc',       l:'CLASE ABC',    r:!puedeVerCostos},
    {k:'comparar',  l:'COMPARAR'},
    {k:'bono',      l:'BONO TRIMESTRAL', r:!puedeVerBono},
  ].filter(t => !t.r)

  const ctx = {D, cabs:cabs || [], cabIdx, nombreSuc, sucsDisp, puedeVerCostos, setTab, setSuc, setPeriodo,
               anio, suc, periodo, tipo, riesgo:cobRiesgo, detsAnio, onPdfTrimestral, scope}

  const sinFiltrosPropios = !['comparar','bono'].includes(tab)
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
          <div key={t.k} onClick={() => setTab(t.k)} style={{padding:'7px 2px 8px', cursor:'pointer', fontSize:11,
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
          {tab === 'exactitud' && <TabExactitud {...ctx}/>}
          {tab === 'valor'     && <TabValor     {...ctx}/>}
          {tab === 'cobertura' && <TabCobertura {...ctx}/>}
          {tab === 'tendencia' && <TabTendencia {...ctx}/>}
          {tab === 'abc'       && <TabABC       {...ctx}/>}
          {tab === 'comparar'  && <TabComparar  {...ctx}/>}
          {tab === 'bono'      && <TabBono      {...ctx}/>}
        </>)}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Diagnóstico automático
// ═══════════════════════════════════════════════════════════════════════════
export function diagnosticar(D, riesgo, puedeVerCostos, nombreSuc) {
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
export function TabResumen({D, riesgo, puedeVerCostos, nombreSuc, setTab, setSuc, setPeriodo, anio, suc}) {
  const M = D.M, P = D.Mprev
  if (!D.cabsP.length) return <Vacio t="Sin inventarios en el período" s="Ajusta bodega, año, período o tipo."/>
  const hall = diagnosticar(D, riesgo, puedeVerCostos, nombreSuc)
  const cSev = {rojo:IV.rojo, ambar:IV.ambar, verde:IV.verde, info:IV.azul}
  const viejas = riesgo.filter(r => r.dias_sin_inventario === null || r.dias_sin_inventario > 180).length
  const maxMesL = Math.max(1, ...Object.values(D.porMes).map(m => m.contadas))
  const puertas = [
    {k:'exactitud', t:'Exactitud', d:'ERI, distribución del error y sesgo', v:fmtP(M.eri), c:semERI(M.eri)},
    ...(puedeVerCostos ? [{k:'valor', t:'Valorización', d:'Pérdida neta, descuadre y concentración', v:fmtP(M.pctPerd, 2), c:semPerd(M.pctPerd)}] : []),
    {k:'cobertura', t:'Cobertura', d:'Qué categorías llevan tiempo sin contarse', v:`${fmtN(viejas)} críticas`, c:viejas ? IV.ambar : IV.verde},
    {k:'tendencia', t:'Tendencia', d:'Evolución mensual y SKUs reincidentes', v:`${fmtN(D.reincidentes.length)} reincid.`, c:D.reincidentes.length ? IV.ambar : IV.verde},
    ...(puedeVerCostos ? [{k:'abc', t:'Clase ABC', d:'Exactitud en lo que más vale', v:'A · B · C', c:IV.navy}] : []),
    {k:'comparar', t:'Comparar', d:'Dos conteos del mismo alcance, SKU a SKU', v:'2 conteos', c:IV.navy},
  ]
  return (<>
    <Strip>
      <Kpi l="ERI estricto" v={fmtP(M.eri)} c={semERI(M.eri)} s="meta ≥ 90%"
        delta={P && M.eri !== null && P.eri !== null ? M.eri - P.eri : null} onClick={() => setTab('exactitud')}/>
      <Kpi l="ERI con tolerancia" v={fmtP(M.eriTol)} c={semERI(M.eriTol)} s="A ±0 · B ±2% · C ±5%"/>
      {puedeVerCostos && <Kpi l="Exactitud valorizada" v={fmtP(M.exactVal)} c={semERI(M.exactVal)} s="100 − descuadre bruto"/>}
      {puedeVerCostos && <Kpi l="Pérdida neta" v={fmtP(M.pctPerd, 2)} c={semPerd(M.pctPerd)} s={fmtCLP(M.perdNeta)} inv
        delta={P && M.pctPerd !== null && P.pctPerd !== null ? M.pctPerd - P.pctPerd : null} onClick={() => setTab('valor')}/>}
      {puedeVerCostos && <Kpi l="Descuadre bruto" v={fmtP(M.pctDesc, 2)} c={semDesc(M.pctDesc)} s={fmtCLP(M.descuadre)}/>}
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
      <div style={{marginTop:8, paddingTop:8, borderTop:`1px solid ${IV.line}`}}>
        Solo inventarios cerrados y no marcados como prueba. La fecha usada es la de ejecución real, o la planificada si no existe. Las líneas sin costo o con costo sobre $1.000.000 cuentan para el ERI pero no para la valorización.
      </div>
    </Guia>
  </>)
}

// ═══════════════════════════════════════════════════════════════════════════
// EXACTITUD
// ═══════════════════════════════════════════════════════════════════════════
export function TabExactitud({D, nombreSuc, setSuc}) {
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
            <tr key={f.k} onClick={vista === 'bodega' ? () => setSuc(f.k) : undefined}
              style={{cursor:vista === 'bodega' ? 'pointer' : 'default'}}>
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
// VALORIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════
export function TabValor({D, nombreSuc, anio, periodo, suc, scope}) {
  const M = D.M
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
  const bajasSuc = {}
  ;(bajas || []).forEach(b => {
    const s = bajasSuc[b.sucursal_codigo] || (bajasSuc[b.sucursal_codigo] = {tot:0, real:0})
    s.tot += Number(b.costo_total) || 0
    if (['destruccion','perdida'].includes(b.tipo)) s.real += Number(b.costo_total) || 0
  })
  const cats = [...D.porCat].filter(c => c.valorSis > 0).sort((a, b) => b.descuadre - a.descuadre)
  return (<>
    <Strip>
      <Kpi l="Valor sistema" v={fmtM(M.valorSis)} s={fmtCLP(M.valorSis)}/>
      <Kpi l="Valor físico" v={fmtM(M.valorFis)} s={fmtCLP(M.valorFis)}/>
      <Kpi l="Faltantes" v={fmtM(M.faltVal)} c={IV.rojo} s={fmtCLP(M.faltVal)}/>
      <Kpi l="Sobrantes" v={fmtM(M.sobrVal)} c={IV.ambar} s={fmtCLP(M.sobrVal)}/>
      <Kpi l="Pérdida neta" v={fmtP(M.pctPerd, 2)} c={semPerd(M.pctPerd)} s={fmtCLP(M.perdNeta)}/>
      <Kpi l="Descuadre bruto" v={fmtP(M.pctDesc, 2)} c={semDesc(M.pctDesc)} s={fmtCLP(M.descuadre)}/>
      <Kpi l="Exactitud valorizada" v={fmtP(M.exactVal)} c={semERI(M.exactVal)}/>
    </Strip>

    <Seccion titulo="Pérdida neta contra el límite del 1%">
      <Caja pad="12px 14px">
        <div style={{position:'relative', height:12, background:IV.lineSoft, borderRadius:2}}>
          <div style={{position:'absolute', left:0, top:0, bottom:0, borderRadius:2,
            width:`${Math.max(0, Math.min(100, (M.pctPerd || 0) / 2 * 100))}%`, background:semPerd(M.pctPerd)}}/>
          <div style={{position:'absolute', left:'50%', top:-3, bottom:-3, width:2, background:IV.ink}}/>
        </div>
        <div style={{display:'flex', justifyContent:'space-between', fontSize:10.5, color:IV.slate, marginTop:5}}>
          <span>0%</span><span style={{fontWeight:700, color:IV.ink}}>Límite 1%</span><span>2% o más</span>
        </div>
        {M.pctPerd !== null && M.pctPerd < 0 && (
          <div style={{fontSize:11.5, color:IV.slate, marginTop:8}}>
            El neto es sobrante: aparece más mercadería de la registrada. Revisa el descuadre bruto: un neto favorable con descuadre alto no es buena noticia.
          </div>
        )}
      </Caja>
    </Seccion>

    <Guia>
      <strong>Faltantes</strong> y <strong>sobrantes</strong> son las diferencias valorizadas al costo. La <strong>pérdida neta</strong> los compensa; el <strong>descuadre bruto</strong> los suma. Una bodega con pérdida neta cero y descuadre del 8% no tiene pérdida: tiene el registro desordenado, y eso tarde o temprano se convierte en quiebres de stock y ventas perdidas.
      <div style={{marginTop:6}}><strong>Inventario contra bajas</strong>: lo que el conteo detectó como faltante se compara con las bajas registradas en el mismo período. Si el inventario encuentra mucho más faltante que las mermas declaradas, hay pérdida que nadie registra.</div>
    </Guia>

    <Seccion titulo="Por categoría" sub="ordenado por descuadre">
      <Caja>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:820}}>
          <thead><tr>
            <th style={th()}>Categoría</th><th style={th(true)}>Valor sistema</th><th style={th(true)}>Faltantes</th>
            <th style={th(true)}>Sobrantes</th><th style={th(true)}>Neto</th><th style={th(true)}>% neto</th><th style={th(true)}>Descuadre %</th>
          </tr></thead>
          <tbody>{cats.map(c => (
            <tr key={c.k}>
              <td style={td(false, {fontWeight:700})}>{c.k}</td>
              <td style={td(true)}>{fmtCLP(c.valorSis)}</td>
              <td style={td(true, {color:IV.rojo})}>{c.faltVal ? fmtCLP(c.faltVal) : '—'}</td>
              <td style={td(true, {color:IV.ambar})}>{c.sobrVal ? fmtCLP(c.sobrVal) : '—'}</td>
              <td style={td(true, {fontWeight:700, color:c.perdNeta > 0 ? IV.rojo : c.perdNeta < 0 ? IV.ambar : IV.slate})}>{fmtCLP(-c.perdNeta)}</td>
              <td style={td(true, {fontWeight:700, color:semPerd(c.pctPerd)})}>{fmtP(c.pctPerd, 2)}</td>
              <td style={td(true, {color:semDesc(c.pctDesc)})}>{fmtP(c.pctDesc, 1)}</td>
            </tr>
          ))}</tbody>
        </table>
      </Caja>
    </Seccion>

    <Seccion titulo="Concentración del impacto" sub={D.top10Share !== null ? `los 10 primeros explican el ${fmtP(D.top10Share, 0)} del descuadre` : null}>
      <Caja>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:820}}>
          <thead><tr>
            <th style={th(true, {width:34})}>#</th><th style={th()}>Producto</th><th style={th()}>Bodega</th>
            <th style={th(true)}>Diferencia</th><th style={th(true)}>Costo</th><th style={th(true)}>Impacto</th><th style={th(true)}>% acum.</th>
          </tr></thead>
          <tbody>{(() => { let acc = 0; return D.topSku.slice(0, 20).map((s, i) => {
            acc += s.impAbs
            return (
              <tr key={s.k}>
                <td style={td(true, {color:IV.slate})}>{i + 1}</td>
                <td style={td()}>
                  <div style={{fontWeight:700, fontSize:12}}>{s.producto || s.sku}</div>
                  <div style={{fontSize:10.5, color:IV.slate}}>{s.sku} · {s.cat}{s.veces > 1 ? ` · ${s.veces} conteos` : ''}</div>
                </td>
                <td style={td(false, {color:IV.slate, fontSize:11.5})}>{nombreSuc(s.suc)}</td>
                <td style={td(true, {fontWeight:700, color:s.dif < 0 ? IV.rojo : IV.ambar})}>{s.dif > 0 ? '+' : ''}{fmtN(s.dif)}</td>
                <td style={td(true, {color:IV.slate})}>{s.costo !== null ? fmtCLP(s.costo) : 'sin costo'}</td>
                <td style={td(true, {fontWeight:700})}>{fmtCLP(s.impAbs)}</td>
                <td style={td(true, {color:IV.slate})}>{D.M.descuadre ? fmtP(acc / D.M.descuadre * 100, 0) : '—'}</td>
              </tr>
            )
          }) })()}</tbody>
        </table>
      </Caja>
    </Seccion>

    <Seccion titulo="Inventario contra bajas registradas" sub="mismo período">
      <Caja>
        {bajas === null ? <div style={{padding:16, fontSize:12, color:IV.slate}}>Cargando bajas…</div> : (
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:680}}>
            <thead><tr>
              <th style={th()}>Bodega</th><th style={th(true)}>Faltante detectado</th><th style={th(true)}>Pérdida neta</th>
              <th style={th(true)}>Bajas registradas</th><th style={th(true)}>de ellas merma real</th>
            </tr></thead>
            <tbody>{D.porSuc.map(s => {
              const b = bajasSuc[s.k] || {tot:0, real:0}
              return (
                <tr key={s.k}>
                  <td style={td(false, {fontWeight:700})}>{nombreSuc(s.k)}</td>
                  <td style={td(true, {color:IV.rojo})}>{fmtCLP(s.faltVal)}</td>
                  <td style={td(true, {fontWeight:700, color:semPerd(s.pctPerd)})}>{fmtCLP(s.perdNeta)}</td>
                  <td style={td(true)}>{fmtCLP(b.tot)}</td>
                  <td style={td(true, {color:IV.slate})}>{fmtCLP(b.real)}</td>
                </tr>
              )
            })}</tbody>
          </table>
        )}
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
