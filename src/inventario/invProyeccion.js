/* ════════════════════════════════════════════════════════════════════
   invProyeccion.js — cómo se compone la venta promedio y cómo se proyecta.
   Una sola fuente para la ficha, los gráficos, el PDF y el Excel: todos
   explican con las mismas cifras que usan los indicadores (mismo cálculo,
   mismo instante: mv_inv_demanda_detalle se recalcula junto a mv_inv_kpi_sku).

   ALGORITMO (venta promedio diaria = demanda sin censura por quiebre)
     Ventana de días COMPLETOS: hasta ayer; hoy no cuenta porque no ha terminado.
     1. Si en los últimos 28 días el producto tuvo stock al menos 5 días:
          venta de esos 28 días ÷ días con stock en esos 28 días
     2. Si no, y en los últimos 84 días tuvo stock al menos 5 días:
          venta de esos 84 días ÷ días con stock en esos 84 días
     3. Si no (casi nunca tuvo stock, o no hay registro de inventario):
          venta de los 84 días ÷ 84 días de calendario
     Un día "con stock" es un día cuya foto de inventario de apertura (01:30)
     tenía unidades disponibles. Dividir por los días con stock evita que los
     días de quiebre, en que no se pudo vender, bajen artificialmente el promedio.
   ════════════════════════════════════════════════════════════════════ */

export const DIAS_MES = 30.4
export const MIN_DIAS_STOCK = 5
export const SALAS_IDS = ['suc-lg', 'suc-la', 'suc-maipu']

export const METODOS = {
  ultimos_28: {
    l: 'Últimos 28 días, sobre los días con stock', corto: '28 días con stock',
    d: `Tuvo stock al menos ${MIN_DIAS_STOCK} de los últimos 28 días: se usa la venta reciente, que refleja mejor la demanda actual.`,
  },
  ultimos_84: {
    l: 'Últimos 84 días, sobre los días con stock', corto: '84 días con stock',
    d: `Tuvo stock menos de ${MIN_DIAS_STOCK} de los últimos 28 días: se amplía a 84 días para tener suficiente evidencia.`,
  },
  calendario_84: {
    l: 'Últimos 84 días de calendario', corto: '84 días calendario',
    d: `Tuvo stock menos de ${MIN_DIAS_STOCK} de los últimos 84 días (o no hay registro de inventario): se divide por el calendario completo, la estimación más conservadora.`,
  },
}

export const METODOLOGIA = [
  'La venta promedio diaria mide la demanda real del producto, no sólo lo que alcanzó a venderse.',
  'Ventana de días completos: hasta ayer. El día de hoy no se cuenta porque no ha terminado.',
  `Paso 1: si en los últimos 28 días el producto tuvo stock al menos ${MIN_DIAS_STOCK} días, venta promedio = unidades vendidas en esos 28 días ÷ días con stock en esos 28 días.`,
  `Paso 2: si no, y en los últimos 84 días tuvo stock al menos ${MIN_DIAS_STOCK} días, venta promedio = unidades vendidas en 84 días ÷ días con stock en 84 días.`,
  'Paso 3: si no, venta promedio = unidades vendidas en 84 días ÷ 84 días de calendario (estimación conservadora).',
  'Un día con stock es un día cuya foto de inventario de apertura (01:30) tenía unidades disponibles en esa bodega.',
  'Por qué se divide por los días con stock: en un día sin stock no se puede vender. Dividir por el calendario completo haría parecer que el producto se vende menos de lo que realmente se demanda, y se volvería a comprar de menos.',
  `Venta promedio mensual = venta promedio diaria × ${DIAS_MES} días.`,
  'La venta promedio de la red es la suma de la de cada sala. El CD no vende: su necesidad se calcula con la venta de la red.',
  'Fuente: ventas diarias netas de BSALE (boletas y facturas menos notas de crédito) e inventario diario por bodega; recalculado cada madrugada.',
  'Limitación conocida: un día con pocas unidades cuenta como día con stock aunque no alcance para la demanda. Por eso cada producto se contrasta con su historia: si la venta promedio actual se aleja mucho del promedio de los 6 meses anteriores, el informe lo advierte para revisarlo antes de comprar.',
]

const iso = d => d.toISOString().slice(0, 10)
export const restarDias = (fecha, n) => { const d = new Date(fecha + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return iso(d) }
export const sumarDias = (fecha, n) => restarDias(fecha, -n)
export const fechaCorta = f => f ? `${f.slice(8, 10)}-${f.slice(5, 7)}-${f.slice(0, 4)}` : '—'
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const nombreMes = m => `${MESES[+m.slice(5, 7) - 1]}-${m.slice(2, 4)}`

/* Composición de la venta promedio de una fila producto × bodega */
export function composicion(r) {
  if (!r?.metodo) return null
  const fecha = r.fecha_calculo || iso(new Date())
  const m = r.metodo
  const ventana = m === 'ultimos_28' ? 28 : 84
  const unidades = +(m === 'ultimos_28' ? r.venta_28d : r.venta_84d) || 0
  const dias = m === 'ultimos_28' ? +r.dias_stock_28 || 0 : m === 'ultimos_84' ? +r.dias_stock_84 || 0 : 84
  const observados = m === 'ultimos_28' ? +r.dias_obs_28 || 0 : +r.dias_obs_84 || 0
  const diaria = +r.demanda_dia || 0
  const calendario = unidades / ventana
  return {
    metodo: m, fecha, desde: restarDias(fecha, ventana), hasta: restarDias(fecha, 1), ventana,
    unidades, dias, observados, diaria, mensual: diaria * DIAS_MES, calendario,
    sinStock: m === 'calendario_84' ? null : Math.max(observados - dias, 0),
    ocultaPorQuiebre: Math.max(diaria - calendario, 0),
  }
}

/* Frase con las cifras reales, para la ficha y el PDF */
export function explicar(c, fmtN = x => String(Math.round(x * 100) / 100), fmtU = x => new Intl.NumberFormat('es-CL').format(Math.round(x))) {
  if (!c) return 'Sin datos para calcular la venta promedio.'
  const per = `del ${fechaCorta(c.desde)} al ${fechaCorta(c.hasta)}`
  if (c.metodo === 'calendario_84')
    return `Vendió ${fmtU(c.unidades)} unidades ${per} (84 días). Como casi no tuvo stock en ese período, se divide por los 84 días del calendario: ${fmtU(c.unidades)} ÷ 84 = ${fmtN(c.diaria)} unidades por día.`
  const base = `Vendió ${fmtU(c.unidades)} unidades ${per} (${c.ventana} días completos) y tuvo stock ${c.dias} de los ${c.observados} días con registro de inventario: ` +
    `${fmtU(c.unidades)} ÷ ${c.dias} = ${fmtN(c.diaria)} unidades por día con stock (aprox. ${fmtU(c.mensual)} al mes).`
  return c.sinStock > 0
    ? `${base} Si se dividiera por los ${c.ventana} días del calendario daría ${fmtN(c.calendario)}: los ${c.sinStock} días sin stock esconden demanda.`
    : base
}

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
export function contrasteHistorico(serie, diaria, meses = 6) {
  const cerrados = (serie || []).filter(m => !m.parcial).slice(-meses)
  if (cerrados.length < 3) return null
  const hist = cerrados.reduce((a, m) => a + m.unidades, 0) / cerrados.length
  const actual = diaria * DIAS_MES
  if (hist < 10 && actual < 10) return null            // volúmenes muy bajos: la variación no es significativa
  const variacion = hist > 0 ? (actual / hist - 1) * 100 : null
  const n = x => new Intl.NumberFormat('es-CL').format(Math.round(x))
  const per = `${nombreMes(cerrados[0].mes)} a ${nombreMes(cerrados[cerrados.length - 1].mes)}`
  if (variacion != null && variacion <= -50) return { tipo: 'baja', hist, actual, variacion,
    texto: `La venta promedio actual (${n(actual)} al mes) es ${n(-variacion)}% menor que el promedio de ${per} (${n(hist)} al mes). ` +
           'Puede ser una baja real de la demanda o stock insuficiente: un día con pocas unidades cuenta como día con stock aunque no alcance para vender. Revisar antes de decidir la compra.' }
  if (variacion == null || variacion >= 100) return { tipo: 'alza', hist, actual, variacion,
    texto: `La venta promedio actual (${n(actual)} al mes) es ${variacion == null ? 'muy superior a la' : `${n(variacion)}% mayor que la`} de ${per} (${n(hist)} al mes). ` +
           'Puede ser un alza real o una venta grande puntual que infla el promedio reciente. Revisar antes de decidir la compra.' }
  return null
}

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
