/* ════════════════════════════════════════════════════════════════════
   invProyeccion.js — cómo se compone la venta promedio y cómo se proyecta.
   Una sola fuente para la ficha, los gráficos, el PDF, la base de datos y
   el Excel: todos explican con las mismas cifras que usan los indicadores
   (mv_inv_demanda_detalle se recalcula junto a mv_inv_kpi_sku).
   El algoritmo vive en la base (fn_inv_demanda_mensual); aquí sólo se
   describe, mes por mes, con las cifras de cada producto.
   ════════════════════════════════════════════════════════════════════ */

export const DIAS_MES = 30.4
export const SALAS_IDS = ['suc-lg', 'suc-la', 'suc-maipu']

/* ALGORITMO (fn_inv_demanda_mensual, sólo app de Inventario)
   Venta promedio = promedio de los últimos N meses CERRADOS (N = inv_config.meses_promedio, hoy 4).
   Cada mes se mide como venta por día disponible en esa sala; meses sin evidencia de demanda no cuentan. */
export const METODOS = {
  mensual:         { l: 'Promedio de los meses cerrados', corto: 'Mensual', d: 'Todos los meses de la ventana cuentan.' },
  mensual_parcial: { l: 'Promedio de los meses que cuentan', corto: 'Mensual (parcial)', d: 'Algún mes no cuenta: sin stock, con muy pocos días con stock, o antes de que el producto o la sala existieran.' },
  mes_en_curso:    { l: 'Mes en curso', corto: 'Mes en curso', d: 'Producto nuevo o sin meses que cuenten: se usa la venta del mes en curso por día con stock.' },
  sin_venta:       { l: 'Sin venta', corto: 'Sin venta', d: 'Sin venta en la ventana ni en el mes en curso.' },
}
export const TIPOS_MES = {
  completo:         { l: 'Stock todo el mes', cuenta: true,  d: 'unidades ÷ días que la sala estuvo abierta' },
  compensado:       { l: 'Compensado',        cuenta: true,  d: 'tuvo días sin stock: unidades ÷ días con stock estimados' },
  sin_registro:     { l: 'Sin registro diario', cuenta: true, d: 'no hay inventario diario de ese mes: unidades ÷ días abierta, tal cual' },
  sin_stock:        { l: 'Sin stock todo el mes', cuenta: false, d: 'no hay evidencia de demanda: no cuenta' },
  pocos_dias_stock: { l: 'Muy pocos días con stock', cuenta: false, d: 'extrapolar desde pocos días amplifica el ruido: no cuenta' },
  antes_inicio:     { l: 'Antes de existir', cuenta: false, d: 'el producto o la sala aún no existían: no cuenta' },
  inicio_reciente:  { l: 'Recién iniciado', cuenta: false, d: 'menos de 5 días desde el inicio: no cuenta' },
}

export function metodologia(cfg = {}) {
  const n = cfg.meses_promedio || 4, m = cfg.min_dias_stock_mes || 10
  return [
    `La venta promedio es el promedio de los últimos ${n} meses CERRADOS. El mes en curso no entra: está incompleto.`,
    'Se calcula para cada producto en cada sala; la venta promedio de la red es la suma de las salas. El CD no vende.',
    'Cada mes se mide como venta por día disponible: unidades del mes ÷ días que la sala estuvo abierta con el producto.',
    `Si el mes tuvo días sin stock (según el inventario diario), se compensa: unidades ÷ días con stock estimados. Exige al menos ${m} días con stock; con menos, el mes no cuenta (extrapolar desde pocos días amplifica el ruido).`,
    'No cuentan: los meses sin stock todo el mes (no hay evidencia de demanda) y los meses anteriores a que existieran el producto o la sala.',
    'Un mes en cero CON stock sí cuenta como cero: es demanda real. Las devoluciones no restan: un mes con venta neta negativa cuenta como cero.',
    'El mes en que el producto o la sala empiezan (incompleto y atípico) sólo cuenta si no hay otro mes. Si no hay ningún mes que cuente, se usa el mes en curso.',
    `Venta promedio mensual = venta promedio diaria × ${DIAS_MES} días.`,
    'Advertencias: la ficha avisa cuando el último mes cerrado o el ritmo del mes en curso se alejan mucho del promedio (caída real, traslado de clientes, pedido puntual de un proyecto). Un promedio de meses siempre reacciona con retraso.',
    'Fuente: ventas diarias netas de BSALE e inventario diario por bodega (desde junio 2026). Recalculado cada madrugada. Este algoritmo es sólo de la app de Inventario; la app de abastecimiento mantiene el suyo.',
  ]
}
export const METODOLOGIA = metodologia()

const iso = d => d.toISOString().slice(0, 10)
export const restarDias = (fecha, n) => { const d = new Date(fecha + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return iso(d) }
export const sumarDias = (fecha, n) => restarDias(fecha, -n)
export const fechaCorta = f => f ? `${f.slice(8, 10)}-${f.slice(5, 7)}-${f.slice(0, 4)}` : '—'
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const nombreMes = m => `${MESES[+m.slice(5, 7) - 1]}-${m.slice(2, 4)}`

/* Composición de la venta promedio de una fila producto × sala (desde meses_detalle) */
export function composicion(r) {
  if (!r?.metodo) return null
  let meses = r.meses_detalle
  if (typeof meses === 'string') { try { meses = JSON.parse(meses) } catch { meses = [] } }
  meses = (meses || []).map(m => ({ ...m, u: +m.u || 0, dab: +m.dab || 0, dobs: m.dobs == null ? null : +m.dobs, dcs: m.dcs == null ? null : +m.dcs,
                                    tasa: m.tasa == null ? null : +m.tasa, nombre: nombreMes(m.mes + '-01') }))
  const cuentan = meses.filter(m => m.cuenta)
  const conDias = meses.filter(m => m.dab >= 5)
  const diaria = +r.demanda_dia || 0
  // Referencia sin ajustes: toda la venta de la ventana ÷ todos los días desde el inicio (incluye meses sin stock)
  const simple = conDias.reduce((a, m) => a + m.dab, 0) > 0 ? conDias.reduce((a, m) => a + m.u, 0) / conDias.reduce((a, m) => a + m.dab, 0) : 0
  return {
    metodo: r.metodo, desde: r.ventana_desde, hasta: r.ventana_hasta, meses, usados: +r.meses_usados || cuentan.length,
    total: meses.length, diaria, mensual: diaria * DIAS_MES, simple, unidades: meses.reduce((a, m) => a + m.u, 0),
  }
}

/* Cómo se midió un mes, en palabras */
export function describirMes(m, fmtN = x => String(Math.round(x * 100) / 100), fmtU = x => new Intl.NumberFormat('es-CL').format(Math.round(x))) {
  const t = TIPOS_MES[m.tipo] || { l: m.tipo }
  if (m.tipo === 'antes_inicio') return `${m.nombre}: ${t.d}`
  if (m.tipo === 'inicio_reciente') return `${m.nombre}: ${fmtU(m.u)} u en ${m.dab} días: ${t.d}`
  if (m.tipo === 'sin_stock') return `${m.nombre}: sin stock todo el mes: no cuenta`
  if (m.tipo === 'pocos_dias_stock') return `${m.nombre}: ${fmtU(m.u)} u con stock sólo ${m.dcs} días: no cuenta`
  const base = m.tipo === 'compensado'
    ? `${m.nombre}: ${fmtU(m.u)} u, stock ${m.dcs} de ${m.dobs} días → ${fmtN(m.tasa)}/día`
    : `${m.nombre}: ${fmtU(m.u)} u en ${m.dab} días → ${fmtN(m.tasa)}/día${m.tipo === 'sin_registro' ? ' (sin registro diario de inventario)' : ''}`
  return m.cuenta ? base : `${base}, pero no cuenta (mes de inicio, hay meses completos)`
}

/* Frase con las cifras reales, para la ficha y el PDF */
export function explicar(c, fmtN, fmtU) {
  if (!c) return 'Sin datos para calcular la venta promedio.'
  if (c.metodo === 'sin_venta') return 'Sin venta en los meses de la ventana ni en el mes en curso: venta promedio cero.'
  if (c.metodo === 'mes_en_curso') return `Ningún mes cerrado cuenta (producto nuevo en la sala o sin stock): se usa la venta del mes en curso por día con stock, ${fmtN(c.diaria)} unidades por día.`
  const n = x => fmtN ? fmtN(x) : String(Math.round(x * 100) / 100)
  return `Se promedian los meses cerrados de ${nombreMes(c.desde)} a ${nombreMes(c.hasta)}. ` +
    c.meses.map(m => describirMes(m, fmtN, fmtU)).join('; ') + '. ' +
    `Promedio de los ${c.usados} meses que cuentan: ${n(c.diaria)} unidades por día (aprox. ${n(c.mensual)} al mes).`
}

/* Advertencias de tendencia: el promedio de meses reacciona con retraso.
   1) último mes cerrado con stock muy lejos del promedio  2) ritmo del mes en curso muy lejos del promedio */
export function advertencias(c, serie, diaria) {
  const out = [], n = x => new Intl.NumberFormat('es-CL').format(Math.round(x)), d = x => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(x)
  if (c && diaria > 0) {
    const ultimo = [...c.meses].reverse().find(m => m.tasa != null && ['completo', 'compensado'].includes(m.tipo))
    if (ultimo && (ultimo.tasa * DIAS_MES >= 10 || diaria * DIAS_MES >= 10)) {
      const r = ultimo.tasa / diaria
      if (r <= 0.5) out.push(`${ultimo.nombre} vendió ${d(ultimo.tasa)} por día teniendo stock (${n(ultimo.u)} unidades), ${n((1 - r) * 100)}% bajo el promedio. ` +
        'Con stock disponible, no es quiebre: puede ser una baja real de la demanda o traslado de clientes a otra sala. El promedio la recoge con retraso: revisar antes de reponer.')
      if (r >= 2) out.push(`${ultimo.nombre} vendió ${d(ultimo.tasa)} por día, ${d(r)} veces el promedio. Puede ser un alza real o un pedido grande puntual. Revisar antes de comprar.`)
    }
  }
  const cur = (serie || []).find(x => x.parcial)
  const diasMes = cur ? Math.max((new Date().getDate()) - 1, 0) : 0
  if (cur && diasMes >= 5 && (diaria > 0 || cur.unidades > 0)) {
    const ritmo = cur.unidades / diasMes
    if (diaria === 0 && cur.unidades >= 10) out.push(`El mes en curso ya lleva ${n(cur.unidades)} unidades sin venta promedio previa: producto que empezó a venderse.`)
    else if (diaria > 0 && ritmo >= 2 * diaria && cur.unidades >= 10) out.push(`El mes en curso lleva ${n(cur.unidades)} unidades en ${diasMes} días: ritmo de ${d(ritmo)} por día, ${d(ritmo / diaria)} veces el promedio. ` +
      'Puede ser un pedido puntual de un proyecto (no conviene reponer por él) o un alza real. Revisar.')
  }
  return out
}
export const contrasteHistorico = () => null   // reemplazado por advertencias()

/* Serie mensual (13 meses) para una bodega o para la red (suma de salas) */
export function armarSerie(filas, sucursales) {
  const m = new Map()
  for (const r of filas || []) {
    if (!sucursales.includes(r.sucursal_id)) continue
    const k = r.mes.slice(0, 10)
    const a = m.get(k) || { mes: k, unidades: 0, neto: 0, dcs: 0, dobs: 0, dias_mes: +r.dias_mes, n: 0 }
    a.unidades += +r.unidades || 0; a.neto += +r.neto || 0
    if (r.dias_observados != null) { a.dcs += +r.dias_con_stock || 0; a.dobs += +r.dias_observados || 0; a.n++ }
    m.set(k, a)
  }
  const hoyMes = iso(new Date()).slice(0, 7)
  return [...m.values()].sort((a, b) => a.mes.localeCompare(b.mes)).map(a => ({
    ...a, parcial: a.mes.slice(0, 7) === hoyMes,
    // % de días con stock: sólo si el mes tiene registro diario (>= 80% de sus días) en cada bodega
    pctStock: a.n && a.dobs >= 0.8 * a.dias_mes * a.n ? Math.round(100 * a.dcs / a.dobs) : null,
  }))
}

/* Venta de este año contra el mismo período del año anterior, mes a mes.
   El acumulado compara sólo meses cerrados (el mes en curso va aparte: está incompleto). */
export function ventaDelAnio(serie) {
  const hoy = iso(new Date()), anio = +hoy.slice(0, 4), mesActual = +hoy.slice(5, 7)
  const u = (a, m) => (serie || []).find(x => x.mes.slice(0, 7) === `${a}-${String(m).padStart(2, '0')}`)?.unidades ?? 0
  const meses = Array.from({ length: 12 }, (_, i) => i + 1).map(m => ({
    m, nombre: MESES[m - 1], actual: m <= mesActual ? u(anio, m) : null, anterior: u(anio - 1, m),
    enCurso: m === mesActual, futuro: m > mesActual,
  }))
  const cerrados = meses.filter(x => !x.enCurso && !x.futuro)
  const ytd = cerrados.reduce((a, x) => a + x.actual, 0), ytdAnt = cerrados.reduce((a, x) => a + x.anterior, 0)
  return { anio, meses, ytd, ytdAnt, mesesCerrados: cerrados.length,
           variacion: ytdAnt > 0 ? (ytd / ytdAnt - 1) * 100 : null,
           totalAnt: meses.reduce((a, x) => a + x.anterior, 0) }
}
export const ultimos13 = serie => (serie || []).slice(-13)

/* Contraste con la historia: la venta promedio actual frente al promedio de los 6 meses cerrados
   anteriores. No cambia el cálculo: advierte cuando conviene revisarlo antes de comprar. */

/* Proyección de venta de los próximos meses a la venta promedio actual */
export function proyectarMeses(diaria, n = 3, desde = iso(new Date())) {
  const out = []
  const d = new Date(desde.slice(0, 7) + '-01T00:00:00Z')
  for (let i = 1; i <= n; i++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1))
    const dias = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate()
    out.push({ mes: iso(x), unidades: diaria * dias, dias_mes: dias, proyectado: true })
  }
  return out
}

/* Proyección del stock disponible al ritmo de la venta promedio (sin compras nuevas) */
export function proyeccionStock({ disponible, diaria, puntoReorden, seguridad, horizonte = 90, hoy = iso(new Date()) }) {
  const d0 = Math.max(+disponible || 0, 0), v = Math.max(+diaria || 0, 0)
  const diasQuiebre = v > 0 ? d0 / v : null
  const diasReorden = v > 0 && d0 > (+puntoReorden || 0) ? (d0 - (+puntoReorden || 0)) / v : (v > 0 ? 0 : null)
  return {
    disponible: d0, diaria: v, horizonte, puntoReorden: +puntoReorden || 0, seguridad: +seguridad || 0,
    diasQuiebre, fechaQuiebre: diasQuiebre != null ? sumarDias(hoy, Math.floor(diasQuiebre)) : null,
    diasReorden, fechaReorden: diasReorden != null ? sumarDias(hoy, Math.floor(diasReorden)) : null,
    puntos: Array.from({ length: horizonte + 1 }, (_, i) => ({ dia: i, stock: Math.max(d0 - v * i, 0) })),
  }
}

/* Suma de salas (red) a partir de las filas de la base de un producto */
export function agregarRed(filas) {
  const s = (filas || []).filter(r => r.vende)
  const t = k => s.reduce((a, r) => a + (+r[k] || 0), 0)
  return { disponible: t('disponible'), demanda_dia: t('demanda_dia'), punto_reorden: t('punto_reorden'), safety_stock: t('safety_stock') }
}
