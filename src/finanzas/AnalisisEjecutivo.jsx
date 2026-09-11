import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { FuenteDrawer, abrirFuente } from './FuenteDrawer'
import { exportarExcel, exportarPDF } from './exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   ANÁLISIS EJECUTIVO — informe de resultados, estructura y diagnóstico
   · Diagnóstico: inferencias automáticas sobre los datos del mes
   · EERR desglosado: TODAS las líneas del maestro × 12 meses, con % s/venta
   · Estructura de costo: composición y su desplazamiento en el año
   · Por sucursal: contribución directa y resultado con prorrateo de CD/Casa Matriz
   · Salud financiera y punto de equilibrio
   Todo lee las mismas vistas que el resultado contable: un solo número.
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fM = n => { const v = Number(n || 0); return Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + 'M' : fmt(v) }
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const TH = { textAlign: 'left', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.4, color: SLATE, padding: '6px 8px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }
const TD = { fontSize: 12, padding: '5px 8px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }
const CLICK = { cursor: 'pointer', textDecoration: 'underline dotted #C7D2FE' }
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff' }
const btn = a => ({ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${a ? NAVY : BORDE}`, background: a ? NAVY : '#fff', color: a ? '#fff' : INK })
const SEV = { critico: ROJO, alerta: AMBAR, ok: VERDE }
const VERSION = 'v0.0.69 · carga única con cache'

function Analisis({ puntos }) {
  if (!puntos?.length) return null
  return (
    <div style={{ marginTop: 12, background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '12px 16px' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Análisis</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: INK, lineHeight: 1.65 }}>
        {puntos.map((p, i) => <li key={i} style={{ marginBottom: 3 }}>{p}</li>)}
      </ul>
    </div>
  )
}

function Panel({ titulo, sub, acciones, children }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${BORDE}`, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>{titulo}</div>
          {sub && <div style={{ fontSize: 11, color: SLATE }}>{sub}</div>}
        </div>
        {acciones}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  )
}
const Ex = ({ filas, nombre, titulo, sub }) => (
  <span style={{ display: 'inline-flex', gap: 6 }}>
    <button onClick={() => exportarExcel(filas, nombre, 'Analisis')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
    <button onClick={() => exportarPDF({ titulo, sub, filas, archivo: nombre, orientacion: 'landscape' })} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>PDF</button>
  </span>
)
// barra proporcional simple (sin librerías)
const Barra = ({ v, max, color }) => (
  <div style={{ background: '#F3F4F6', borderRadius: 3, height: 8, width: '100%', overflow: 'hidden' }}>
    <div style={{ width: `${Math.min(100, Math.abs(v) / (max || 1) * 100)}%`, height: '100%', background: color, borderRadius: 3 }} />
  </div>
)

export function AnalisisEjecutivo({ cu }) {
  const [mensual, setMensual] = useState([])
  const [desglose, setDesglose] = useState([])
  const [estructura, setEstructura] = useState([])
  const [diag, setDiag] = useState([])
  const [salud, setSalud] = useState([])
  const [equilibrio, setEquilibrio] = useState(null)
  const [suc, setSuc] = useState([])
  const [cobertura, setCobertura] = useState([])
  const [cobResumen, setCobResumen] = useState([])
  const [alertas, setAlertas] = useState([])
  const [indSuc, setIndSuc] = useState([])
  const [sucLinea, setSucLinea] = useState([])
  const [sucAnual, setSucAnual] = useState([])
  const [alcance, setAlcance] = useState('mes')
  const [det, setDet] = useState(null)
  const anio = new Date().getFullYear()
  const [vista, setVista] = useState('resumen')   // resumen | desglose | estructura | sucursal
  const [modoCol, setModoCol] = useState('pesos') // pesos | pct
  const [vision, setVision] = useState('directa')
  const [mes, setMes] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7) })

  const [errores, setErrores] = useState([])
  const [calculadoAt, setCalculadoAt] = useState(null)
  const [refrescando, setRefrescando] = useState(false)

  const aplicar = (v) => {
    setMensual(v.mensual ?? []); setDesglose(v.desglose ?? []); setEstructura(v.estructura ?? [])
    setDiag(v.diagnostico ?? []); setSalud(v.salud ?? []); setEquilibrio(v.equilibrio ?? null)
    setSuc(v.sucursal ?? []); setCobertura(v.cobertura ?? []); setCobResumen(v.cobresumen ?? [])
    setAlertas(v.alertas ?? []); setIndSuc(v.indicadores ?? []); setSucLinea(v.suclinea ?? [])
    setSucAnual(v.sucanual ?? []); setCalculadoAt(v.calculado_at ?? null)
  }
  const cargar = async (maxEdadMin) => {
    setRefrescando(true)
    const { data, error } = await supabase.rpc('fn_analisis_ejecutivo', { p_max_edad_min: maxEdadMin })
    setRefrescando(false)
    if (error) { setErrores([`fn_analisis_ejecutivo: ${error.message}`]); return }
    setErrores([]); aplicar(data ?? {})
  }
  useEffect(() => { cargar(15) }, [anio])

  const cerrados = useMemo(() => mensual.filter(m => !m.mes_en_curso), [mensual])
  const periodos = useMemo(() => mensual.map(m => m.periodo), [mensual])
  const ytd = k => cerrados.reduce((s, m) => s + Number(m[k] || 0), 0)
  const mesRow = mensual.find(m => m.periodo === mes)

  // desglose: líneas × meses
  const lineas = useMemo(() => {
    const map = new Map()
    for (const d of desglose) {
      if (!map.has(d.codigo)) map.set(d.codigo, { codigo: d.codigo, nombre: d.nombre, seccion: d.seccion, orden: d.orden, es_subtotal: d.es_subtotal, tipo_costo: d.tipo_costo, meses: {} })
      map.get(d.codigo).meses[d.periodo] = d
    }
    return [...map.values()].sort((a, b) => a.orden - b.orden).filter(l => periodos.some(p => Math.abs(Number(l.meses[p]?.monto || 0)) > 0))
  }, [desglose, periodos])

  const sucMes = useMemo(() => suc.filter(s => s.periodo === mes), [suc, mes])
  const esAnual = alcance === 'anio'
  const cerradosP = useMemo(() => cerrados.map(c => c.periodo), [cerrados])
  // indicadores: mes o anual (anual usa ratios comparables cuando el centro abrió a mitad de año)
  const indVista = useMemo(() => esAnual
    ? sucAnual.map(a => ({ ...a, rem_sobre_venta_pct: a.parcial ? a.rem_comparable_pct : a.rem_sobre_venta_pct,
        arriendo_sobre_venta_pct: a.parcial ? a.arriendo_comparable_pct : a.arriendo_sobre_venta_pct,
        gasto_total_sobre_venta_pct: a.parcial ? a.gasto_comparable_pct : a.gasto_total_sobre_venta_pct }))
    : indSuc.filter(i => i.periodo === mes), [esAnual, sucAnual, indSuc, mes])
  // matriz por sucursal: mes o suma de meses cerrados
  const sucVista = useMemo(() => {
    if (!esAnual) return sucMes
    const map = new Map()
    for (const f of suc.filter(x => cerradosP.includes(x.periodo) && x.ceco !== 'suc-ajuste-jun')) {
      const a = map.get(f.ceco) ?? { ceco: f.ceco, ceco_nombre: f.ceco_nombre, clase: f.clase, ingresos: 0, costo_ventas: 0, remuneraciones: 0, mermas: 0, gastos_directos: 0, contribucion: 0, prorrateo_cd: 0, prorrateo_casa_matriz: 0, prorrateo_no_asignado: 0, resultado_final: 0 }
      for (const k of ['ingresos', 'costo_ventas', 'remuneraciones', 'mermas', 'gastos_directos', 'contribucion', 'prorrateo_cd', 'prorrateo_casa_matriz', 'prorrateo_no_asignado', 'resultado_final']) a[k] += Number(f[k] || 0)
      if (f.clase === 'tienda') a.clase = 'tienda'
      map.set(f.ceco, a)
    }
    const ord = { tienda: 0, cd: 1, casa_matriz: 2 }
    return [...map.values()].sort((x, y) => (ord[x.clase] - ord[y.clase]) || (y.ingresos - x.ingresos))
  }, [esAnual, sucMes, suc, cerradosP])
  const rotulo = esAnual ? `acumulado ${anio} (${cerrados.length} meses cerrados)` : mes

  // ── análisis automático de la vista actual ──
  const analisisSuc = useMemo(() => {
    const t = indVista.filter(i => Number(i.ingresos) > 0 && i.ceco !== 'suc-web')
    if (!t.length) return []
    const out = []
    const top = [...t].sort((a, b) => Number(b.ingresos) - Number(a.ingresos))[0]
    const totalVenta = t.reduce((s2, x) => s2 + Number(x.ingresos), 0)
    out.push(`${top.ceco_nombre} concentra el ${(100 * Number(top.ingresos) / totalVenta).toFixed(0)}% de la venta de tiendas: el resultado de la empresa depende de esa sola tienda.`)
    const mejorRem = [...t].sort((a, b) => Number(a.rem_sobre_venta_pct) - Number(b.rem_sobre_venta_pct))[0]
    const peorRem = [...t].sort((a, b) => Number(b.rem_sobre_venta_pct) - Number(a.rem_sobre_venta_pct))[0]
    if (Number(peorRem.rem_sobre_venta_pct) > Number(mejorRem.rem_sobre_venta_pct) * 1.4)
      out.push(`Remuneración sobre venta: ${peorRem.ceco_nombre} gasta ${peorRem.rem_sobre_venta_pct}% frente al ${mejorRem.rem_sobre_venta_pct}% de ${mejorRem.ceco_nombre}. Llevarla al estándar liberaría ${fM(Number(peorRem.ingresos) * (Number(peorRem.rem_sobre_venta_pct) - Number(mejorRem.rem_sobre_venta_pct)) / 100)}.`)
    const mejorArr = [...t].sort((a, b) => Number(a.arriendo_sobre_venta_pct) - Number(b.arriendo_sobre_venta_pct))[0]
    const peorArr = [...t].sort((a, b) => Number(b.arriendo_sobre_venta_pct) - Number(a.arriendo_sobre_venta_pct))[0]
    if (Number(peorArr.arriendo_sobre_venta_pct) > Number(mejorArr.arriendo_sobre_venta_pct) * 2)
      out.push(`Arriendo sobre venta: ${peorArr.ceco_nombre} paga ${peorArr.arriendo_sobre_venta_pct}% de su venta contra ${mejorArr.arriendo_sobre_venta_pct}% de ${mejorArr.ceco_nombre}. Es un costo fijo: solo se corrige con más venta o renegociando el contrato.`)
    const mbBajo = [...t].filter(x => x.margen_bruto_pct != null).sort((a, b) => Number(a.margen_bruto_pct) - Number(b.margen_bruto_pct))[0]
    const mbAlto = [...t].filter(x => x.margen_bruto_pct != null).sort((a, b) => Number(b.margen_bruto_pct) - Number(a.margen_bruto_pct))[0]
    if (mbBajo && mbAlto && Number(mbAlto.margen_bruto_pct) - Number(mbBajo.margen_bruto_pct) > 4)
      out.push(`Margen bruto: ${mbBajo.ceco_nombre} vende con ${mbBajo.margen_bruto_pct}% contra ${mbAlto.margen_bruto_pct}% de ${mbAlto.ceco_nombre} (${(Number(mbAlto.margen_bruto_pct) - Number(mbBajo.margen_bruto_pct)).toFixed(1)} puntos). Con la venta de ${mbBajo.ceco_nombre} eso vale ${fM(Number(mbBajo.ingresos) * (Number(mbAlto.margen_bruto_pct) - Number(mbBajo.margen_bruto_pct)) / 100)}. Revisar precios y mix, no dotación.`)
    const prod = t.filter(x => x.venta_por_trabajador).sort((a, b) => Number(b.venta_por_trabajador) - Number(a.venta_por_trabajador))
    if (prod.length > 1) out.push(`Productividad: ${prod[0].ceco_nombre} vende ${fM(prod[0].venta_por_trabajador)} por trabajador contra ${fM(prod[prod.length - 1].venta_por_trabajador)} de ${prod[prod.length - 1].ceco_nombre}.`)
    const negativos = t.filter(x => Number(x.contribucion) < 0)
    if (negativos.length) out.push(`${negativos.map(x => x.ceco_nombre).join(' y ')} ${negativos.length > 1 ? 'no cubren' : 'no cubre'} ni sus propios costos directos, antes de cargar estructura.`)
    if (esAnual && sucAnual.some(a => a.parcial)) out.push(`Los centros marcados como parciales abrieron durante el año: sus ratios se calculan solo sobre los meses con venta, para que sean comparables.`)
    return out
  }, [indVista, esAnual, sucAnual])

  const filtroLinea = useMemo(() => (x) => esAnual ? cerradosP.includes(x.periodo) : x.periodo === mes, [esAnual, cerradosP, mes])
  // abre la fuente real del dato segun la linea pinchada
  function fuenteLinea(s, k, etiqueta) {
    const periodos = esAnual ? cerradosP : [mes]
    const ini = periodos[0] + '-01', fin = periodos[periodos.length - 1] + '-31'
    const t = `${etiqueta} · ${s.ceco_nombre} · ${esAnual ? 'acumulado ' + anio : mes}`
    if (k === 'ingresos' || k === 'costo_ventas') return abrirFuente(setDet, {
      titulo: t, sub: 'Reporte Detalle de ventas de BSALE: venta neta y costo al día de la venta',
      query: supabase.from('bsale_ventas_control').select('periodo, sucursal_id, venta_neta, costo_real, docs, lineas, cargado_at, cargado_por')
        .eq('sucursal_id', s.ceco).in('periodo', periodos).order('periodo') })
    if (k === 'remuneraciones') return abrirFuente(setDet, {
      titulo: t, sub: 'Liquidaciones del período en este centro de costo (los sueldos de dirección se ocultan según el rol)',
      query: supabase.from('rrhh_liquidaciones').select('periodo, nombre, cargo, centro_costo_texto, total_haberes')
        .in('periodo', periodos).order('total_haberes', { ascending: false }) })
    if (k === 'mermas' || k === 'ajuste_inventario') return abrirFuente(setDet, {
      titulo: t, sub: k === 'mermas' ? 'Salidas de inventario con causa registrada' : 'Salidas de inventario sin causa: hay que clasificarlas',
      query: supabase.from('log_mermas').select('fecha, sucursal_codigo, tipo, nota, total_unidades, costo_total')
        .gte('fecha', ini).lte('fecha', fin).order('costo_total', { ascending: false }) })
    if (k === 'gastos_directos') return abrirFuente(setDet, {
      titulo: t, sub: 'Facturas y pagos con centro de costo asignado a este local',
      query: supabase.from('v_eerr_sucursal_gastos').select('periodo, linea_nombre, fuente, monto')
        .eq('ceco', s.ceco).in('periodo', periodos).order('monto', { ascending: false }) })
    if (k === 'contribucion' || k.startsWith('prorrateo') || k === 'resultado_final') return abrirFuente(setDet, {
      titulo: t, sub: 'Cómo se arma el resultado de cada centro y cómo se reparte la estructura',
      query: supabase.from('v_eerr_sucursal_prorrateado').select('periodo, ceco_nombre, clase, ingresos, contribucion, prorrateo_cd, prorrateo_casa_matriz, prorrateo_no_asignado, resultado_final, participacion_pct')
        .in('periodo', periodos).order('periodo') })
  }

  const analisisResultado = useMemo(() => {
    const t = sucVista.filter(s => s.clase === 'tienda' && Number(s.ingresos) > 0)
    const centrales = sucVista.filter(s => s.clase !== 'tienda')
    if (!t.length) return []
    const out = []
    const estructura = centrales.reduce((a, s) => a + Number(s.contribucion || 0), 0)
    const contribTotal = t.reduce((a, s) => a + Number(s.contribucion || 0), 0)
    out.push(`Las tiendas generan ${fM(contribTotal)} de contribución directa. La estructura que no vende (CD y Casa Matriz) consume ${fM(Math.abs(estructura))}: se lleva el ${Math.round(100 * Math.abs(estructura) / (contribTotal || 1))}% de lo que las tiendas producen.`)
    if (vision === 'prorrateada') {
      const cambian = t.filter(s => Number(s.contribucion) > 0 && Number(s.resultado_final) < 0)
      if (cambian.length) out.push(`${cambian.map(s => s.ceco_nombre).join(' y ')} ${cambian.length > 1 ? 'aparecen' : 'aparece'} en positivo por contribución directa pero ${cambian.length > 1 ? 'quedan' : 'queda'} en pérdida al cargar su parte de la estructura: no alcanzan a pagar el soporte que consumen.`)
      const sostiene = [...t].sort((a, b) => Number(b.resultado_final) - Number(a.resultado_final))[0]
      if (Number(sostiene.resultado_final) > 0) out.push(`${sostiene.ceco_nombre} aporta ${fM(sostiene.resultado_final)} después de estructura: es lo que financia al resto de la red.`)
    } else {
      const neg = t.filter(s => Number(s.contribucion) < 0)
      if (neg.length) out.push(`${neg.map(s => s.ceco_nombre).join(' y ')} no ${neg.length > 1 ? 'cubren' : 'cubre'} ni sus costos directos: la pérdida existe antes de repartir un peso de estructura.`)
    }
    const cd = centrales.find(s => s.clase === 'cd')
    if (cd) out.push(`CD Maipú consume ${fM(Math.abs(Number(cd.contribucion)))} sin generar ingreso. Es un costo de servicio: la pregunta es si ese nivel corresponde al volumen que mueve.`)
    if (esAnual) out.push(`Acumulado de ${cerrados.length} meses cerrados. Un centro que abrió durante el año arrastra gastos de meses en que aún no vendía.`)
    return out
  }, [sucVista, vision, esAnual, cerrados])

  const cecosMes = useMemo(() => [...new Set(sucLinea.filter(filtroLinea).map(x => x.ceco_nombre).filter(Boolean))], [sucLinea, filtroLinea])
  const lineasSuc = useMemo(() => [...new Set(sucLinea.filter(x => filtroLinea(x) && x.grupo !== 'resultado').map(x => x.linea))].sort(), [sucLinea, filtroLinea])

  function fuenteLinea(l, p) {
    abrirFuente(setDet, { titulo: `${l.nombre} · ${p}`, sub: 'Asientos contables que componen la línea',
      query: supabase.from('v_eerr_detalle_devengo').select('fecha, asiento, cuenta, cuenta_nombre, glosa_linea, tercero, monto').eq('periodo', p).eq('codigo', l.codigo).order('monto', { ascending: false }) })
  }
  function fuenteDiag(d) {
    const q = {
      inventario: () => ({ t: 'Salidas de inventario sin clasificar', s: 'Eventos BSALE sin causa registrada', q: supabase.from('log_mermas').select('fecha, sucursal_codigo, nota, tipo, total_unidades, costo_total').eq('tipo', 'sin_clasificar').order('costo_total', { ascending: false }) }),
      sucursal: () => ({ t: 'Resultado por centro con prorrateo', s: mes, q: supabase.from('v_eerr_sucursal_prorrateado').select('ceco_nombre, clase, ingresos, contribucion, prorrateo_cd, prorrateo_casa_matriz, prorrateo_no_asignado, resultado_final').eq('periodo', mes) }),
      margen: () => ({ t: 'Costo de ventas por mes', s: 'Comparación con el kardex PMP', q: supabase.from('v_inv_pmp_resumen').select('periodo, venta_neta, costo_ventas_estandar, costo_ventas_pmp, diferencia, margen_estandar_pct, margen_pmp_pct') }),
      estructura: () => ({ t: 'Remuneraciones por período', s: 'Detalle de liquidaciones y honorarios', q: supabase.from('v_rrhh_master').select('periodo, trabajador, cargo, centro_costo_nombre, glosa_nombre, monto').in('naturaleza', ['haber_imponible', 'haber_no_imponible', 'honorario']).order('periodo', { ascending: false }) }),
      liquidez: () => ({ t: 'Inventario valorizado por SKU', s: 'Kardex del último mes calculado', q: supabase.from('v_inv_pmp_detalle').select('periodo, sku, producto, stock_bsale, pmp, estandar, vendidas').gt('stock_bsale', 0).order('stock_bsale', { ascending: false }) }),
      rentabilidad: () => ({ t: 'Resultado mes a mes', s: 'Base del diagnóstico', q: supabase.from('v_informe_resultado_mensual').select('periodo, venta, margen_bruto_pct, ebitda, resultado_antes_impuesto, impuesto, resultado') }),
      equilibrio: () => ({ t: 'Estructura de costo por mes', s: 'Base del punto de equilibrio', q: supabase.from('v_estructura_costo').select('*') }),
    }[d.area]
    if (q) { const o = q(); abrirFuente(setDet, { titulo: o.t, sub: o.s, query: o.q }) }
  }

  function fuenteCobertura(c) {
    const ini = c.periodo + '-01', fin = c.periodo + '-31'
    if (c.medida.includes('Días del mes')) return abrirFuente(setDet, { titulo: `Días con venta · ${c.periodo}`, sub: 'Un día ausente es venta no registrada', query: supabase.from('ventas_bsale_dia').select('fecha, sucursal_id, docs_venta, total_venta').gte('fecha', ini).lte('fecha', fin).order('fecha') })
    if (c.medida.includes('cuenta contable')) return abrirFuente(setDet, { titulo: `Facturas sin cuenta contable · ${c.periodo}`, sub: 'Quedan en la cuenta puente, fuera del resultado', query: supabase.from('v_libro_compras_clasificacion').select('fecha_emision, razon_social, folio, monto_total').eq('periodo', c.periodo).eq('origen_clasificacion', 'pendiente').order('monto_total', { ascending: false }) })
    if (c.medida.includes('centro de costo')) return abrirFuente(setDet, { titulo: `Facturas sin centro de costo · ${c.periodo}`, sub: 'El gasto no se asigna a ninguna sucursal', query: supabase.from('libro_compras').select('fecha_emision, razon_social, folio, monto_total').is('ceco_id', null).eq('anulado', false).gte('fecha_emision', ini).lte('fecha_emision', fin).order('monto_total', { ascending: false }) })
    if (c.medida.includes('Liquidaciones')) return abrirFuente(setDet, { titulo: `Liquidaciones cargadas · ${c.periodo}`, sub: `${c.registrado} de ${c.esperado} trabajadores activos — contrastar contra la nómina`, query: supabase.from('rrhh_liquidaciones').select('periodo, nombre, rut, centro_costo_texto, total_haberes').eq('periodo', c.periodo).order('nombre') })
    if (c.medida.includes('Movimientos clasificados')) return abrirFuente(setDet, { titulo: `Movimientos del banco sin clasificar · ${c.periodo}`, sub: 'Cada cargo puede ser un gasto que aún no está en el resultado', query: supabase.from('movimientos_bancarios').select('fecha, tipo, descripcion, monto').is('subcuenta_id', null).gte('fecha', ini).lte('fecha', fin).order('monto') })
    if (c.medida.includes('cartola oficial')) return abrirFuente(setDet, { titulo: 'Puntos de saldo con cartola oficial', sub: 'Fechas en que el saldo contable se contrastó con el banco', query: supabase.from('v_libro_banco_puntos').select('fecha, fuente, saldo_oficial, saldo_contable, diferencia_residual, estado').order('fecha') })
    if (c.medida.includes('causa clasificada')) return abrirFuente(setDet, { titulo: `Salidas de inventario sin causa · ${c.periodo}`, sub: 'Hoy se cargan como pérdida sin respaldo', query: supabase.from('log_mermas').select('fecha, sucursal_codigo, nota, total_unidades, costo_total').eq('tipo', 'sin_clasificar').gte('fecha', ini).lte('fecha', fin).order('costo_total', { ascending: false }) })
    if (c.medida.includes('Provisiones del mes')) return abrirFuente(setDet, { titulo: `Provisiones del mes · ${c.periodo}`, sub: 'Costo de ventas, depreciación e impuesto', query: supabase.from('cont_asientos').select('fecha, glosa, origen_tabla, total_debe, estado').in('origen_tabla', ['costo_ventas_mes', 'depreciacion_mes', 'provision_renta_mes', 'log_mermas_mes']).eq('origen_id', c.periodo) })
    if (c.medida.includes('caja chica')) return abrirFuente(setDet, { titulo: `Caja chica sin respaldo · ${c.periodo}`, sub: 'Gastos sin documento adjunto', query: supabase.from('gm_movimientos').select('fecha, proveedor, descripcion, monto, responsable_nombre').eq('tipo', 'gasto').is('url_respaldo', null).is('archivo_storage', null).gte('fecha', ini).lte('fecha', fin).order('monto', { ascending: false }) })
    if (c.medida.includes('Período contable')) return abrirFuente(setDet, { titulo: 'Estado de los períodos contables', sub: 'Un período abierto puede cambiar', query: supabase.from('cont_periodos').select('*').order('periodo') })
  }

  const maxMag = Math.max(...diag.map(d => Math.abs(Number(d.magnitud || 0))), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Análisis ejecutivo</div>
        <span style={{ fontSize: 10.5, color: SLATE, border: `1px solid ${BORDE}`, borderRadius: 10, padding: '2px 8px' }}>{VERSION}</span>
        <span style={{ fontSize: 11, color: SLATE, marginLeft: 'auto' }}>
          {refrescando ? 'calculando…' : calculadoAt ? `datos calculados ${new Date(calculadoAt).toLocaleString('es-CL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}` : mensual.length ? '' : 'cargando…'}
        </span>
        <button onClick={() => cargar(0)} disabled={refrescando}
          title="Recalcula todo el análisis con los datos de este momento (tarda ~1 minuto)"
          style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY, opacity: refrescando ? 0.5 : 1 }}>
          {refrescando ? 'Calculando…' : 'Actualizar'}
        </button>
      </div>
      {errores.length > 0 && (
        <div style={{ background: '#FEF3F2', border: '1px solid #FECDCA', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: ROJO }}>
          <b>No se pudieron cargar {errores.length} fuente(s).</b> El resto de la pantalla sí está actualizado.
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{errores.map((e, i) => <li key={i} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{e}</li>)}</ul>
        </div>
      )}
      {/* síntesis */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {[
          { l: `Venta ${mes}`, v: fM(mesRow?.venta), s: `MB ${mesRow?.margen_bruto_pct ?? '—'}%` },
          { l: 'Resultado antes de impuesto', v: fM(mesRow?.resultado_antes_impuesto), s: `${mesRow?.rai_pct ?? '—'}% s/venta`, c: Number(mesRow?.resultado_antes_impuesto) < 0 ? ROJO : VERDE },
          { l: 'EBITDA del mes', v: fM(mesRow?.ebitda), s: 'antes de interés, impuesto y depreciación', c: Number(mesRow?.ebitda) < 0 ? ROJO : VERDE },
          { l: `Acumulado ${anio}`, v: fM(ytd('resultado')), s: `${cerrados.length} meses cerrados`, c: ytd('resultado') < 0 ? ROJO : VERDE },
          { l: 'Punto de equilibrio', v: fM(equilibrio?.venta_equilibrio), s: equilibrio ? (Number(equilibrio.brecha_venta) > 0 ? `faltan ${fM(equilibrio.brecha_venta)} (${equilibrio.brecha_pct}%)` : 'superado') : '', c: Number(equilibrio?.brecha_venta) > 0 ? AMBAR : VERDE },
          { l: 'Alertas de validación', v: String(alertas.length), s: alertas.length ? 'líneas fuera de su rango habitual' : 'sin desviaciones', c: alertas.length > 5 ? ROJO : alertas.length ? AMBAR : VERDE },
          { l: `Cobertura de datos ${mes}`, v: (cobResumen.find(c => c.periodo === mes)?.cobertura_pct ?? '—') + '%', s: `${cobResumen.find(c => c.periodo === mes)?.medidas_incompletas ?? 0} medidas incompletas`, c: Number(cobResumen.find(c => c.periodo === mes)?.cobertura_pct) >= 95 ? VERDE : Number(cobResumen.find(c => c.periodo === mes)?.cobertura_pct) >= 85 ? AMBAR : ROJO },
        ].map((k, i) => (
          <div key={i} style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 14px', flex: '1 1 180px' }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE }}>{k.l}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.c || NAVY, fontFamily: 'ui-monospace, monospace' }}>{k.v}</div>
            <div style={{ fontSize: 11, color: SLATE }}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* diagnóstico */}
      <Panel titulo="Diagnóstico" sub="Inferencias calculadas sobre los datos del informe · clic en cada hallazgo para ver su fuente"
        acciones={<Ex filas={diag.map(d => ({ Área: d.area, Severidad: d.severidad, Hallazgo: d.titulo, Detalle: d.hallazgo, Magnitud: d.magnitud, Acción: d.accion }))} nombre="diagnostico_ejecutivo" titulo="Diagnóstico ejecutivo" />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {diag.map(d => (
            <div key={d.orden} onClick={() => fuenteDiag(d)}
              style={{ display: 'grid', gridTemplateColumns: '6px 1fr 150px', gap: 12, alignItems: 'center', padding: '10px 12px', border: `1px solid ${BORDE}`, borderRadius: 6, cursor: 'pointer', background: d.severidad === 'critico' ? '#FEF3F2' : d.severidad === 'alerta' ? '#FFFBEB' : '#F0FDF4' }}>
              <div style={{ background: SEV[d.severidad], height: '100%', minHeight: 34, borderRadius: 3 }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>{d.titulo}</div>
                <div style={{ fontSize: 12, color: INK, lineHeight: 1.45 }}>{d.hallazgo}</div>
                <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>→ {d.accion}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: SEV[d.severidad] }}>{fM(d.magnitud)}</div>
                <Barra v={d.magnitud} max={maxMag} color={SEV[d.severidad]} />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* selector de vista */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {[['resumen', 'Resultado mensual'], ['desglose', 'EERR desglosado'], ['estructura', 'Estructura de costo'], ['sucursal', 'Por sucursal'], ['gastosuc', 'Gasto fino por tienda'], ['alertas', `Alertas${alertas.length ? ' · ' + alertas.length : ''}`], ['cobertura', 'Cobertura de datos']].map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)} style={btn(vista === k)}>{l}</button>
        ))}
        {['sucursal', 'gastosuc'].includes(vista) && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            <button onClick={() => setAlcance('mes')} style={btn(alcance === 'mes')}>Mes</button>
            <button onClick={() => setAlcance('anio')} style={btn(alcance === 'anio')}>Año {anio}</button>
          </div>
        )}
        <select value={mes} onChange={e => setMes(e.target.value)} disabled={esAnual && ['sucursal', 'gastosuc'].includes(vista)}
          style={{ ...INPUT, marginLeft: ['sucursal', 'gastosuc'].includes(vista) ? 0 : 'auto', opacity: esAnual && ['sucursal', 'gastosuc'].includes(vista) ? 0.5 : 1 }}>
          {mensual.map(m => <option key={m.periodo} value={m.periodo}>{MESES[Number(m.periodo.slice(5)) - 1]}{m.mes_en_curso ? ' (en curso)' : ''}</option>)}
        </select>
      </div>

      {vista === 'resumen' && (
        <Panel titulo={`Resultado mes a mes ${anio}`} sub="Clic en cualquier cifra abre los asientos que la componen"
          acciones={<Ex filas={mensual.map(m => ({ Mes: m.periodo, Venta: m.venta, Costo: m.costo, 'MB %': m.margen_bruto_pct, Remuneraciones: m.remuneraciones, Arriendo: m.arriendo, 'Merma real': m.mermas, 'Sin clasificar': m.ajuste_inventario, 'Otros gastos': m.otros_gastos, EBITDA: m.ebitda, Depreciación: m.depreciacion, Interés: m.interes, 'Antes de impuesto': m.resultado_antes_impuesto, Impuesto: m.impuesto, Resultado: m.resultado }))} nombre={`resultado_mensual_${anio}`} titulo={`Resultado mes a mes ${anio}`} />}>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={TH}>Mes</th>{['Venta', 'Costo', 'MB %', 'Remun.', 'Arriendo', 'Merma real', 'Sin clasif.', 'Otros', 'EBITDA', 'Deprec.', 'Interés', 'Antes de imp.', 'Impuesto', 'Resultado'].map(h => <th key={h} style={{ ...TH, textAlign: 'right' }}>{h}</th>)}</tr></thead>
              <tbody>
                {mensual.map(m => (
                  <tr key={m.periodo} style={{ background: m.periodo === mes ? '#F0F4FF' : m.mes_en_curso ? '#FFFBEB' : undefined }}>
                    <td style={{ ...TD, fontWeight: 700 }}>{MESES[Number(m.periodo.slice(5)) - 1]}{m.mes_en_curso ? ' ⌛' : ''}</td>
                    {['venta', 'costo'].map(k => <td key={k} style={NUM}>{fmt(m[k])}</td>)}
                    <td style={{ ...NUM, color: Number(m.margen_bruto_pct) < 38 ? ROJO : INK }}>{m.margen_bruto_pct}%</td>
                    {['remuneraciones', 'arriendo', 'mermas'].map(k => <td key={k} style={NUM}>{fmt(m[k])}</td>)}
                    <td style={{ ...NUM, color: Number(m.ajuste_inventario) > 10000000 ? ROJO : AMBAR }}>{fmt(m.ajuste_inventario)}</td>
                    <td style={NUM}>{fmt(m.otros_gastos)}</td>
                    <td style={{ ...NUM, fontWeight: 600, color: Number(m.ebitda) < 0 ? ROJO : VERDE }}>{fmt(m.ebitda)}</td>
                    <td style={NUM}>{fmt(m.depreciacion)}</td><td style={NUM}>{fmt(m.interes)}</td>
                    <td style={{ ...NUM, fontWeight: 700, background: '#FAFAFB', color: Number(m.resultado_antes_impuesto) < 0 ? ROJO : VERDE }}>{fmt(m.resultado_antes_impuesto)}</td>
                    <td style={{ ...NUM, color: Number(m.impuesto) < 0 ? VERDE : INK }}>{fmt(m.impuesto)}</td>
                    <td style={{ ...NUM, fontWeight: 700, color: Number(m.resultado) < 0 ? ROJO : VERDE }}>{fmt(m.resultado)}</td>
                  </tr>
                ))}
                <tr style={{ background: '#EEF2FF' }}>
                  <td style={{ ...TD, fontWeight: 700, color: NAVY }}>Acumulado</td>
                  {['venta', 'costo'].map(k => <td key={k} style={{ ...NUM, fontWeight: 700, color: NAVY }}>{fmt(ytd(k))}</td>)}
                  <td style={{ ...NUM, fontWeight: 700, color: NAVY }}>{ytd('venta') ? (100 * (ytd('venta') - ytd('costo')) / ytd('venta')).toFixed(1) : '—'}%</td>
                  {['remuneraciones', 'arriendo', 'mermas', 'ajuste_inventario', 'otros_gastos', 'ebitda', 'depreciacion', 'interes', 'resultado_antes_impuesto', 'impuesto', 'resultado'].map(k =>
                    <td key={k} style={{ ...NUM, fontWeight: 700, color: ['ebitda', 'resultado', 'resultado_antes_impuesto'].includes(k) ? (ytd(k) < 0 ? ROJO : VERDE) : NAVY }}>{fmt(ytd(k))}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {vista === 'desglose' && (
        <Panel titulo={`Estado de resultados desglosado · ${anio}`} sub={`${lineas.length} líneas del maestro × 12 meses · clic en cualquier celda abre su detalle contable`}
          acciones={<>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setModoCol('pesos')} style={btn(modoCol === 'pesos')}>Pesos</button>
              <button onClick={() => setModoCol('pct')} style={btn(modoCol === 'pct')}>% s/venta</button>
            </div>
            <Ex filas={lineas.map(l => Object.fromEntries([['Línea', l.nombre], ['Sección', l.seccion], ...periodos.map(p => [MESES[Number(p.slice(5)) - 1], Number(l.meses[p]?.monto || 0)]), ['Acumulado', periodos.reduce((s, p) => s + Number(l.meses[p]?.monto || 0), 0)]]))} nombre={`eerr_desglose_${anio}`} titulo={`EERR desglosado ${anio}`} />
          </>}>
          <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...TH, left: 0, position: 'sticky', zIndex: 3, background: '#fff', minWidth: 230 }}>Línea</th>
                {periodos.map(p => <th key={p} style={{ ...TH, textAlign: 'right' }}>{MESES[Number(p.slice(5)) - 1]}</th>)}
                <th style={{ ...TH, textAlign: 'right', background: '#EEF2FF' }}>Acumulado</th>
              </tr></thead>
              <tbody>
                {lineas.map(l => {
                  const sub = l.es_subtotal
                  const acum = periodos.reduce((s, p) => s + Number(l.meses[p]?.monto || 0), 0)
                  return (
                    <tr key={l.codigo} style={{ background: sub ? '#F7F7F8' : undefined }}>
                      <td style={{ ...TD, position: 'sticky', left: 0, background: sub ? '#F7F7F8' : '#fff', fontWeight: sub ? 700 : 400, color: sub ? NAVY : INK, zIndex: 1 }}>
                        {sub ? l.nombre : <span style={{ paddingLeft: 10 }}>{l.nombre}</span>}
                        {l.tipo_costo && !sub && <span style={{ fontSize: 9.5, color: SLATE, marginLeft: 6 }}>{l.tipo_costo}</span>}
                      </td>
                      {periodos.map(p => {
                        const d = l.meses[p], v = Number(d?.monto || 0)
                        return (
                          <td key={p} onClick={() => v !== 0 && !sub && fuenteLinea(l, p)}
                            style={{ ...NUM, ...(v !== 0 && !sub ? CLICK : {}), fontWeight: sub ? 700 : 400, color: sub && v < 0 ? ROJO : sub ? NAVY : INK, background: p === mes ? '#F0F4FF' : undefined }}>
                            {v === 0 ? '' : modoCol === 'pct' ? (d?.pct_venta ?? '—') + '%' : fmt(v)}
                          </td>
                        )
                      })}
                      <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF', color: sub && acum < 0 ? ROJO : NAVY }}>{fmt(acum)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: SLATE, marginTop: 6 }}>Las filas en gris son subtotales del maestro. "% s/venta" permite comparar meses de distinto volumen: ahí se ve el desplazamiento de la estructura.</div>
        </Panel>
      )}

      {vista === 'estructura' && (
        <Panel titulo="Estructura de costo" sub="Cómo se reparte cada peso vendido, mes a mes · el desplazamiento explica la caída del resultado"
          acciones={<Ex filas={estructura} nombre={`estructura_costo_${anio}`} titulo={`Estructura de costo ${anio}`} />}>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Concepto</th>
                {estructura.map(e => <th key={e.periodo} style={{ ...TH, textAlign: 'right' }}>{MESES[Number(e.periodo.slice(5)) - 1]}</th>)}
                <th style={{ ...TH, textAlign: 'right', background: '#EEF2FF' }}>Var. año</th>
              </tr></thead>
              <tbody>
                {[['pct_costo', 'Costo de mercadería', ROJO], ['pct_personal', 'Personal', ROJO], ['pct_ocupacion', 'Ocupación (arriendo y básicos)', AMBAR],
                  ['pct_inventario', 'Mermas y ajustes', AMBAR], ['pct_comercial', 'Comercial y logístico', SLATE], ['pct_administrativo', 'Administrativo', SLATE], ['pct_financiero', 'Financiero', SLATE]].map(([k, l, c]) => {
                  const prim = Number(estructura[0]?.[k] || 0), ultCerr = estructura.filter(e => e.periodo < new Date().toISOString().slice(0, 7))
                  const ult = Number(ultCerr[ultCerr.length - 1]?.[k] || 0), delta = ult - prim
                  return (
                    <tr key={k}>
                      <td style={{ ...TD, fontWeight: 500 }}>{l}</td>
                      {estructura.map(e => (
                        <td key={e.periodo} style={{ ...NUM, background: e.periodo === mes ? '#F0F4FF' : undefined, color: Number(e[k]) > Number(estructura[0]?.[k] || 0) + 3 ? ROJO : INK }}>{e[k] ?? '—'}%</td>
                      ))}
                      <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF', color: delta > 1 ? ROJO : delta < -1 ? VERDE : SLATE }}>{delta > 0 ? '+' : ''}{delta.toFixed(1)} pts</td>
                    </tr>
                  )
                })}
                <tr style={{ background: '#F7F7F8' }}>
                  <td style={{ ...TD, fontWeight: 700, color: NAVY }}>Venta del mes</td>
                  {estructura.map(e => <td key={e.periodo} style={{ ...NUM, fontWeight: 700, color: NAVY }}>{fM(e.venta)}</td>)}
                  <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF', color: NAVY }}>{fM(estructura.reduce((s, e) => s + Number(e.venta), 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {equilibrio && (
            <div style={{ marginTop: 12, background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '12px 16px', fontSize: 12.5, lineHeight: 1.6, color: INK }}>
              <b>Punto de equilibrio</b> (promedio de los últimos 3 meses cerrados): con un margen de contribución de <b>{equilibrio.margen_contribucion_pct}%</b> y costos fijos de <b>{fmt(equilibrio.costos_fijos_mes)}</b> mensuales,
              la empresa necesita vender <b>{fmt(equilibrio.venta_equilibrio)}</b> al mes para no perder. Hoy vende {fmt(equilibrio.venta_promedio_3m)}.
              {Number(equilibrio.brecha_venta) > 0
                ? <> Faltan <b style={{ color: ROJO }}>{fmt(equilibrio.brecha_venta)}</b> ({equilibrio.brecha_pct}%). Cada punto de margen bruto que se recupere baja la venta necesaria en cerca de {fmt(equilibrio.venta_equilibrio / equilibrio.margen_contribucion_pct)}.</>
                : <> Está <b style={{ color: VERDE }}>{fmt(-equilibrio.brecha_venta)}</b> por encima.</>}
            </div>
          )}
        </Panel>
      )}

      {vista === 'sucursal' && (
        <Panel titulo={`Resultado por sucursal · ${rotulo}`} sub="CD Maipú y Casa Matriz no venden pero gastan: con prorrateo su costo se reparte según participación en ventas"
          acciones={<>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setVision('directa')} style={btn(vision === 'directa')}>Contribución directa</button>
              <button onClick={() => setVision('prorrateada')} style={btn(vision === 'prorrateada')}>Con prorrateo</button>
            </div>
            <Ex filas={sucVista} nombre={`sucursal_${esAnual ? anio : mes}`} titulo={`Resultado por sucursal ${rotulo}`} />
          </>}>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Línea</th>
                {sucVista.map(s => <th key={s.ceco} style={{ ...TH, textAlign: 'right', color: s.clase === 'tienda' ? NAVY : SLATE }}>{s.ceco_nombre}{s.clase !== 'tienda' ? ' *' : ''}</th>)}
                <th style={{ ...TH, textAlign: 'right', background: '#EEF2FF' }}>Total</th>
              </tr></thead>
              <tbody>
                {[
                  ['ingresos', 'Ventas del período', 'Boletas y facturas emitidas, sin IVA y ya descontadas las devoluciones'],
                  ['costo_ventas', 'Lo que costó esa mercadería', 'Precio que pagamos por los productos que se vendieron, al costo del día de la venta'],
                  ['margen_bruto', 'Ganancia sobre la mercadería', 'Lo que queda después de pagar el producto, antes de cualquier gasto de operación'],
                  ['remuneraciones', 'Sueldos del personal', 'Sueldos, honorarios y leyes sociales de la gente asignada a este centro'],
                  ['mermas', 'Mercadería perdida o dañada', 'Productos que se rompieron, se destruyeron o faltaron en el conteo'],
                  ['ajuste_inventario', 'Mercadería que salió sin explicar', 'Salió del inventario en BSALE pero nadie registró por qué. Hay que clasificarla'],
                  ['gastos_directos', 'Gastos propios del local', 'Arriendo, luz, agua, internet, aseo y todo lo que se paga solo por tener este local abierto'],
                  ['contribucion', 'LO QUE APORTA ESTE CENTRO', 'Lo que deja después de cubrir todos sus propios costos, antes de repartir la estructura central'],
                  ...(vision === 'prorrateada' ? [
                    ['prorrateo_cd', 'Su parte del CD Maipú', 'El centro de distribución no vende: su costo se reparte entre las tiendas según cuánto vende cada una'],
                    ['prorrateo_casa_matriz', 'Su parte de la administración', 'Gerencia, contabilidad y sistemas: se reparte igual, según participación en ventas'],
                    ['prorrateo_no_asignado', 'Su parte de intereses e impuestos', 'Intereses de créditos, depreciación, comisiones bancarias e impuesto a la renta'],
                    ['resultado_final', 'RESULTADO FINAL DEL CENTRO', 'Lo que realmente gana o pierde esta tienda una vez que paga todo lo que consume'],
                  ] : [])
                ].map(([k, l, ayuda]) => {
                  const esT = k === 'contribucion' || k === 'resultado_final'
                  const val = s => k === 'margen_bruto' ? Number(s.ingresos) - Number(s.costo_ventas) : Number(s[k] || 0)
                  const total = sucVista.reduce((t, s) => t + val(s), 0)
                  if (k === 'ajuste_inventario' && total === 0) return null
                  return (
                    <tr key={k} style={{ background: esT ? '#F7F7F8' : undefined }}>
                      <td style={{ ...TD, fontWeight: esT || k === 'margen_bruto' ? 700 : 500, color: esT ? NAVY : INK, whiteSpace: 'normal', maxWidth: 250 }}>
                        {l}
                        <div style={{ fontSize: 10, color: SLATE, fontWeight: 400, lineHeight: 1.35, marginTop: 1 }}>{ayuda}</div>
                      </td>
                      {sucVista.map(s => {
                        const v = val(s), oculto = s.clase !== 'tienda' && (k.startsWith('prorrateo') || k === 'resultado_final')
                        const clickable = !oculto && v !== 0 && !['margen_bruto'].includes(k)
                        return <td key={s.ceco}
                          onClick={() => clickable && fuenteLinea(s, k, l)}
                          style={{ ...NUM, ...(clickable ? CLICK : {}), fontWeight: esT ? 700 : 400, color: esT ? (v < 0 ? ROJO : VERDE) : INK, opacity: oculto ? 0.3 : 1 }}>
                          {oculto ? '—' : fmt(v)}{k === 'margen_bruto' && Number(s.ingresos) > 0 ? <span style={{ fontSize: 9.5, color: SLATE }}> {(100 * v / Number(s.ingresos)).toFixed(1)}%</span> : null}
                        </td>
                      })}
                      <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF', color: esT ? (total < 0 ? ROJO : VERDE) : NAVY }}>{fmt(total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: SLATE, marginTop: 8, lineHeight: 1.55 }}>
            <b>De dónde sale cada número.</b> Ventas y costo: reporte Detalle de ventas de BSALE, con el costo que el producto tenía el día de la venta.
            Sueldos: liquidaciones del mes, repartidas por el centro de costo de cada trabajador. Mermas: movimientos de inventario de BSALE, separando lo que tiene causa registrada de lo que no.
            Gastos del local: facturas y pagos con centro de costo asignado. <b>Clic en cualquier monto abre el detalle que lo compone.</b>
            <br />* Centros sin ingreso propio. En la visión prorrateada la suma del resultado final de las tiendas es exactamente el resultado del EERR{esAnual ? ' acumulado' : ' del mes'}.
          </div>
          <Analisis puntos={analisisResultado} />
        </Panel>
      )}

      {vista === 'gastosuc' && (
        <>
          <Panel titulo={`Indicadores por tienda · ${rotulo}`} sub="Cada gasto medido contra su propia venta: así se comparan tiendas de distinto tamaño"
            acciones={<Ex filas={indVista} nombre={`indicadores_tienda_${esAnual ? anio : mes}`} titulo={`Indicadores por tienda ${rotulo}`} />}>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={TH}>Centro</th>{['Venta', 'Margen bruto', 'Remun. $', 'Rem/venta', 'Arriendo $', 'Arr/venta', 'Gasto total/venta', 'Dotación', 'Venta × trabajador', 'Contribución'].map(h => <th key={h} style={{ ...TH, textAlign: 'right' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {!indVista.length && <tr><td colSpan={11} style={{ ...TD, textAlign: 'center', color: SLATE, padding: 18 }}>Sin datos de indicadores para {rotulo}. Verificá que la vista v_indicadores_sucursal tenga filas del período.</td></tr>}
                  {indVista.map(i => {
                    const ref = indVista.filter(x => Number(x.ingresos) > 0)
                    const mejorRem = Math.min(...ref.map(x => Number(x.rem_sobre_venta_pct ?? 999)))
                    const mejorArr = Math.min(...ref.map(x => Number(x.arriendo_sobre_venta_pct ?? 999)))
                    return (
                      <tr key={i.ceco}>
                        <td style={{ ...TD, fontWeight: 600 }}>{i.ceco_nombre}
                          {i.parcial ? <span title={`Abrió en ${i.primer_mes_venta}: los ratios usan solo los ${i.meses_con_venta} meses con venta`} style={{ fontSize: 9.5, color: AMBAR, marginLeft: 6, fontWeight: 700 }}>PARCIAL</span> : null}</td>
                        <td style={NUM}>{fmt(i.ingresos)}</td>
                        <td style={{ ...NUM, color: Number(i.margen_bruto_pct) < 30 && Number(i.ingresos) > 0 ? ROJO : INK }}>{i.margen_bruto_pct ?? '—'}%</td>
                        <td onClick={() => abrirFuente(setDet, { titulo: `Remuneraciones · ${i.ceco_nombre} · ${mes}`, sub: 'Liquidaciones y honorarios del centro', query: esAnual ? supabase.from('v_rrhh_master').select('periodo, trabajador, cargo, glosa_nombre, monto').eq('centro_costo_nombre', i.ceco_nombre).order('monto', { ascending: false }) : supabase.from('v_rrhh_master').select('trabajador, cargo, glosa_nombre, monto').eq('periodo', mes).eq('centro_costo_nombre', i.ceco_nombre).order('monto', { ascending: false }) })} style={{ ...NUM, ...CLICK }}>{fmt(i.remuneraciones)}</td>
                        <td style={{ ...NUM, fontWeight: 700, color: Number(i.rem_sobre_venta_pct) > mejorRem * 1.5 ? ROJO : Number(i.rem_sobre_venta_pct) === mejorRem ? VERDE : INK }}>{i.rem_sobre_venta_pct ?? '—'}%</td>
                        <td onClick={() => abrirFuente(setDet, { titulo: `Arriendo · ${i.ceco_nombre} · ${mes}`, sub: 'Facturas y pagos de arriendo del centro', query: esAnual ? supabase.from('v_eerr_sucursal_gastos').select('periodo, linea_nombre, fuente, monto').eq('ceco', i.ceco).eq('linea', 'ARRIENDO').order('periodo') : supabase.from('v_eerr_sucursal_gastos').select('periodo, linea_nombre, fuente, monto').eq('ceco', i.ceco).eq('periodo', mes).eq('linea', 'ARRIENDO') })} style={{ ...NUM, ...CLICK }}>{fmt(i.arriendo)}</td>
                        <td style={{ ...NUM, fontWeight: 700, color: Number(i.arriendo_sobre_venta_pct) > mejorArr * 2 ? ROJO : INK }}>{i.arriendo_sobre_venta_pct ?? '—'}%</td>
                        <td style={{ ...NUM, fontWeight: 700, color: Number(i.gasto_total_sobre_venta_pct) > 30 ? ROJO : Number(i.gasto_total_sobre_venta_pct) > 20 ? AMBAR : VERDE }}>{i.gasto_total_sobre_venta_pct ?? '—'}%</td>
                        <td style={NUM}>{i.trabajadores ?? '—'}</td>
                        <td style={NUM}>{i.venta_por_trabajador ? fmt(i.venta_por_trabajador) : '—'}</td>
                        <td style={{ ...NUM, fontWeight: 700, color: Number(i.contribucion) < 0 ? ROJO : VERDE }}>{fmt(i.contribucion)}<span style={{ fontSize: 10, color: SLATE }}> {i.contribucion_pct ?? ''}%</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: SLATE, marginTop: 6 }}>Verde: mejor ratio. Rojo: más de 1,5× (remuneración) o 2× (arriendo) el mejor. Clic en los montos abre el detalle. Un centro <b>PARCIAL</b> abrió durante el año: sus ratios anuales se calculan solo sobre los meses con venta.</div>
            <Analisis puntos={analisisSuc} />
          </Panel>

          <Panel titulo={`Gasto por línea y tienda · ${rotulo}`} sub="Cada línea del EERR abierta por centro de costo — clic para ver los documentos"
            acciones={<Ex filas={sucLinea.filter(filtroLinea)} nombre={`gasto_linea_tienda_${esAnual ? anio : mes}`} titulo={`Gasto por línea y tienda ${rotulo}`} />}>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={TH}>Línea</th>{cecosMes.map(c => <th key={c} style={{ ...TH, textAlign: 'right' }}>{c}</th>)}<th style={{ ...TH, textAlign: 'right', background: '#EEF2FF' }}>Total</th></tr></thead>
                <tbody>
                  {!lineasSuc.length && <tr><td colSpan={cecosMes.length + 2} style={{ ...TD, textAlign: 'center', color: SLATE, padding: 18 }}>Sin gasto por línea para {rotulo}.</td></tr>}
                  {lineasSuc.map(ln => {
                    const fila = cecosMes.map(c => sucLinea.filter(x => filtroLinea(x) && x.ceco_nombre === c && x.linea === ln).reduce((s2, x) => s2 + Number(x.monto || 0), 0))
                    const tot = fila.reduce((a, b) => a + b, 0)
                    if (tot === 0) return null
                    return (
                      <tr key={ln}>
                        <td style={{ ...TD, fontWeight: 500 }}>{ln}</td>
                        {fila.map((v, i2) => (
                          <td key={i2} onClick={() => { const cc = (sucLinea.find(z => z.ceco_nombre === cecosMes[i2]) || {}).ceco || ''
                            const q = supabase.from('v_eerr_sucursal_gastos').select('periodo, linea_nombre, fuente, monto').eq('ceco', cc)
                            v !== 0 && abrirFuente(setDet, { titulo: `${ln} · ${cecosMes[i2]} · ${rotulo}`, sub: 'Documentos que componen el gasto', query: esAnual ? q.order('periodo') : q.eq('periodo', mes).order('monto', { ascending: false }) }) }}
                            style={{ ...NUM, ...(v !== 0 ? CLICK : {}) }}>{v === 0 ? '' : fmt(v)}</td>
                        ))}
                        <td style={{ ...NUM, fontWeight: 700, background: '#EEF2FF' }}>{fmt(tot)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {esAnual && <div style={{ fontSize: 11, color: SLATE, marginTop: 6 }}>Acumulado de los {cerrados.length} meses cerrados. El mes en curso no se incluye porque no tiene costo ni provisiones.</div>}
          </Panel>
        </>
      )}

      {vista === 'alertas' && (
        <Panel titulo="Alertas de validación del año" sub="Meses en que una línea se aparta de su comportamiento habitual · comparación contra la mediana de los demás meses"
          acciones={<Ex filas={alertas} nombre={`alertas_${anio}`} titulo={`Alertas de validación ${anio}`} />}>
          {!alertas.length ? <div style={{ padding: 20, textAlign: 'center', color: VERDE, fontSize: 13 }}>Sin desviaciones materiales: todas las líneas se comportan dentro de su rango habitual.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={TH}>Mes</th><th style={TH}>Línea</th><th style={{ ...TH, textAlign: 'right' }}>Monto</th><th style={{ ...TH, textAlign: 'right' }}>Mediana del resto</th><th style={{ ...TH, textAlign: 'right' }}>Desvío</th><th style={TH}>Qué revisar</th></tr></thead>
              <tbody>
                {alertas.map((a, i) => {
                  const col = a.tipo === 'falta' ? ROJO : a.tipo === 'salto_alza' ? AMBAR : SLATE
                  return (
                    <tr key={i} onClick={() => abrirFuente(setDet, { titulo: `${a.linea} · ${a.periodo}`, sub: `Monto ${fmt(a.monto)} vs mediana ${fmt(a.mediana_resto)} — validar respaldo`, query: supabase.from('v_eerr_detalle_devengo').select('fecha, asiento, cuenta_nombre, glosa_linea, tercero, monto').eq('periodo', a.periodo).eq('codigo', a.codigo).order('monto', { ascending: false }) })}
                      style={{ cursor: 'pointer' }}>
                      <td style={{ ...TD, fontWeight: 700 }}>{MESES[Number(a.periodo.slice(5)) - 1]}</td>
                      <td style={{ ...TD, fontWeight: 500 }}>{a.linea}</td>
                      <td style={{ ...NUM, fontWeight: 700, color: col }}>{fmt(a.monto)}</td>
                      <td style={{ ...NUM, color: SLATE }}>{fmt(a.mediana_resto)}</td>
                      <td style={{ ...NUM, fontWeight: 700, color: col }}>{a.desvio_pct !== null ? (Number(a.desvio_pct) > 0 ? '+' : '') + a.desvio_pct + '%' : 'nuevo'}</td>
                      <td style={{ ...TD, fontSize: 11, whiteSpace: 'normal', color: SLATE, maxWidth: 340 }}>
                        <span style={{ fontWeight: 700, color: col }}>{a.tipo === 'falta' ? 'FALTA REGISTRAR' : a.tipo === 'salto_alza' ? 'SALTO AL ALZA' : 'CAÍDA'}</span> · {a.que_revisar}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 11, color: SLATE, marginTop: 8, lineHeight: 1.5 }}>
            Se compara cada línea contra la <b>mediana</b> de los otros meses (no el promedio: la mediana no se contamina con el propio outlier). Se alerta cuando el desvío supera el 40% <b>y</b> los $3.000.000, para no llenar la lista con líneas menores. Clic abre los asientos del mes para validar el respaldo.
          </div>
        </Panel>
      )}

      {vista === 'cobertura' && (
        <>
          <Panel titulo="Cobertura de datos por mes" sub="Qué tan completa está la información que sostiene cada resultado · el impacto es lo que puede moverse al completarla"
            acciones={<Ex filas={cobResumen} nombre={`cobertura_${anio}`} titulo={`Cobertura de datos ${anio}`} />}>
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={TH}>Mes</th>{cobResumen.map(c => <th key={c.periodo} style={{ ...TH, textAlign: 'right' }}>{MESES[Number(c.periodo.slice(5)) - 1]}</th>)}</tr></thead>
                <tbody>
                  <tr><td style={{ ...TD, fontWeight: 600 }}>Cobertura global</td>
                    {cobResumen.map(c => <td key={c.periodo} style={{ ...NUM, fontWeight: 700, color: Number(c.cobertura_pct) >= 95 ? VERDE : Number(c.cobertura_pct) >= 85 ? AMBAR : ROJO, background: c.periodo === mes ? '#F0F4FF' : undefined }}>{c.cobertura_pct}%</td>)}</tr>
                  <tr><td style={{ ...TD, fontWeight: 600 }}>Cobertura de lo crítico</td>
                    {cobResumen.map(c => <td key={c.periodo} style={{ ...NUM, color: Number(c.cobertura_critica_pct) >= 95 ? VERDE : Number(c.cobertura_critica_pct) >= 85 ? AMBAR : ROJO }}>{c.cobertura_critica_pct}%</td>)}</tr>
                  <tr><td style={{ ...TD }}>Medidas incompletas</td>
                    {cobResumen.map(c => <td key={c.periodo} style={NUM}>{c.medidas_incompletas}</td>)}</tr>
                  <tr><td style={{ ...TD }}>Bloqueantes del cierre</td>
                    {cobResumen.map(c => <td key={c.periodo} style={{ ...NUM, color: c.bloqueantes > 0 ? ROJO : VERDE, fontWeight: 700 }}>{c.bloqueantes}</td>)}</tr>
                  <tr style={{ background: '#F7F7F8' }}><td style={{ ...TD, fontWeight: 700, color: NAVY }}>Impacto potencial en el resultado</td>
                    {cobResumen.map(c => <td key={c.periodo} style={{ ...NUM, fontWeight: 700, color: Number(c.impacto_potencial) > 50000000 ? ROJO : AMBAR }}>{fM(c.impacto_potencial)}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, background: '#FEF3F2', border: '1px solid #FECDCA', borderRadius: 8, padding: '10px 14px', fontSize: 12, lineHeight: 1.55, color: INK }}>
              <b>Cómo leer el impacto.</b> Casi todo lo que falta son <b>gastos todavía no registrados</b> (cargos del banco sin clasificar, liquidaciones sin cargar, facturas sin imputar): al completarlos el resultado <b>empeora</b>, no mejora. La única partida que juega al revés son las salidas de inventario sin clasificar, que hoy castigan como pérdida y podrían no serlo.
              Por eso un mes con cobertura baja no es un mes con mejor resultado: es un mes cuyo resultado todavía no se puede afirmar.
            </div>
          </Panel>

          <Panel titulo={`Detalle de cobertura · ${mes}`} sub="Clic en cada fila para ver exactamente qué registros faltan"
            acciones={<Ex filas={cobertura.filter(c => c.periodo === mes).map(c => ({ Libro: c.libro, Medida: c.medida, Registrado: c.registrado, Esperado: c.esperado, 'Falta': c.esperado - c.registrado, Impacto: c.impacto, Criticidad: c.criticidad, Acción: c.accion }))} nombre={`cobertura_detalle_${mes}`} titulo={`Cobertura de datos ${mes}`} />}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={TH}>Libro</th><th style={TH}>Medida</th><th style={{ ...TH, textAlign: 'right' }}>Registrado</th><th style={{ ...TH, textAlign: 'right' }}>Esperado</th><th style={{ ...TH, textAlign: 'right' }}>Falta</th><th style={{ ...TH, textAlign: 'right' }}>Impacto</th><th style={TH}>Criticidad</th></tr></thead>
              <tbody>
                {cobertura.filter(c => c.periodo === mes).map((c, i) => {
                  const pct = 100 * c.registrado / (c.esperado || 1), falta = c.esperado - c.registrado
                  const col = pct >= 99 ? VERDE : pct >= 90 ? AMBAR : ROJO
                  return (
                    <tr key={i} onClick={() => fuenteCobertura(c)} style={{ cursor: 'pointer' }} title={c.accion}>
                      <td style={{ ...TD, color: SLATE }}>{c.libro}</td>
                      <td style={{ ...TD, fontWeight: 500, whiteSpace: 'normal' }}>{c.medida}
                        <div style={{ fontSize: 10.5, color: SLATE }}>{c.accion}</div></td>
                      <td style={{ ...NUM, color: col, fontWeight: 700 }}>{c.registrado}</td>
                      <td style={NUM}>{c.esperado}</td>
                      <td style={{ ...NUM, color: falta > 0 ? ROJO : VERDE, fontWeight: 700 }}>{falta > 0 ? falta : '—'}</td>
                      <td style={{ ...NUM, color: Number(c.impacto) > 0 ? ROJO : SLATE }}>{Number(c.impacto) > 0 ? fmt(c.impacto) : '—'}</td>
                      <td style={{ ...TD, fontSize: 11, fontWeight: 700, color: c.criticidad === 'bloqueante' ? ROJO : c.criticidad === 'alto' ? AMBAR : SLATE }}>{c.criticidad}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Panel>
        </>
      )}

      {/* salud financiera */}
      <Panel titulo="Salud financiera" sub="Posición patrimonial a la fecha · conversa con el resultado: un balance sano no compensa una operación en pérdida"
        acciones={<Ex filas={salud.map(s => ({ Indicador: s.indicador, Valor: s.valor, Referencia: s.referencia, Lectura: s.lectura }))} nombre="salud_financiera" titulo="Salud financiera" />}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
          {salud.map(s => (
            <div key={s.orden} onClick={() => abrirFuente(setDet, { titulo: 'Balance de 8 columnas', sub: 'Base de los indicadores', query: supabase.from('v_balance_8_columnas').select('codigo, nombre, activo, pasivo, perdida, ganancia').order('codigo') })}
              style={{ border: `1px solid ${BORDE}`, borderLeft: `3px solid ${s.lectura === 'Sano' || s.lectura === 'Manejable' ? VERDE : s.lectura === 'Ajustado' ? AMBAR : ROJO}`, borderRadius: 6, padding: '8px 10px', cursor: 'pointer' }}>
              <div style={{ fontSize: 11, color: SLATE }}>{s.indicador}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: NAVY }}>{s.valor}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: s.lectura === 'Sano' || s.lectura === 'Manejable' ? VERDE : s.lectura === 'Ajustado' ? AMBAR : ROJO }}>{s.lectura}</div>
              </div>
              <div style={{ fontSize: 10.5, color: SLATE }}>{s.referencia}</div>
            </div>
          ))}
        </div>
      </Panel>

      <FuenteDrawer det={det} onClose={() => setDet(null)} />
    </div>
  )
}

export default AnalisisEjecutivo
