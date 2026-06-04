/* ═══ MOTOR DE ANÁLISIS v2 ═══
   Fórmulas corregidas: PE real (todos los fijos), Eficiencia Marketing (no ROI inventado),
   KPIs con composición + evolución + cambio vs período anterior para drill-down.
*/

const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export const UMBRALES = {
  margen_bruto_pct:        { verde: 45, amarillo: 38 },
  margen_operacional_pct:  { verde: 8, amarillo: 3 },
  margen_neto_pct:         { verde: 5, amarillo: 1 },
  costo_venta_pct:         { verde: 55, amarillo: 62 },
  gasto_operativo_pct:     { verde: 30, amarillo: 40 },
  rem_total_pct:           { verde: 18, amarillo: 25 },
  arriendo_pct:            { verde: 6,  amarillo: 9 },
  marketing_pct:           { verde_min: 1.5, verde_max: 4, amarillo_max: 6 },
  venta_empleado:          { verde: 12000000, amarillo: 7000000 },
}

// Notas de referencia que se muestran en cada KPI (origen del benchmark).
// Calibrado a retailer de especialidad de bienes durables, importador directo, escala pyme.
// NO comparado contra gran retail de volumen (Sodimac/Easy) por diferencia de escala.
export const BENCHMARK_FUENTE = {
  margen_bruto:   'Ref: specialty durable goods (mueble/showroom) apunta +45%. Importación directa suma puntos vs comprar a distribuidor.',
  margen_op:      'Ref: specialty retail 8-15%. Pyme en crecimiento absorbiendo costos fijos parte más abajo del rango.',
  margen_neto:    'Ref: margen neto retail típico 2-10%. Pyme rentable apunta a 5%.',
  costo_venta:    'Ref: espejo del margen bruto objetivo (45%). Sobre 62% comprime demasiado la rentabilidad.',
  gasto_operativo:'Ref: OpEx specialty parte en 35-45%, meta escalar a 25-30% con volumen.',
  rem_total:      'Ref: mayor componente del gasto en specialty (personal de alto contacto). Sano ≤18%, crítico >25%.',
  arriendo:       'Ref: specialty paga lease premium. KPI clásico retail, sano ≤6% con varios locales.',
  marketing:      'Ref: retail físico pyme. Subinversión <0,5%, quema sin retorno >6%.',
  venta_empleado: 'Ref: productividad pyme retail de especialidad. Escala media apunta ≥$12M/empleado/mes.',
}

export const LINEAS_FIJAS = new Set([
  'ARRIENDO','REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS',
  'GASTOS_BANCARIOS','CUENTAS_BASICAS','GASTOS_TI','SERVICIOS_EXTERNOS',
  'INTERES_CREDITOS'
])
export const LINEAS_VARIABLES = new Set([
  'COSTO_NETO','MARKETING','COMISION_GETNET','MOBILIARIO','COMBUSTIBLE',
  'FINIQUITOS','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS','IMPUESTOS',
  'MP_IMPORTACION','MP_REPOSICION','MP_INVERSION','MP_TRANSPORTES'
])

// COSTO_NETO es COSTO de ventas (va antes del margen bruto), NO gasto operativo.
// Lo separamos en su propia categoría para no confundir el análisis.
const LINEAS_COSTO_VENTAS = ['COSTO_NETO']

// Gastos operativos: todo lo que viene DESPUÉS del margen bruto.
const LINEAS_GASTOS_OPERATIVOS = [
  'REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS',
  'MARKETING','COMISION_GETNET',
  'GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS',
  'COMBUSTIBLE','FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS'
]

// Para casos donde sí necesitas TODO lo que sale de caja (burn rate, etc.):
const TODOS_COSTOS_Y_GASTOS = [...LINEAS_COSTO_VENTAS, ...LINEAS_GASTOS_OPERATIVOS]

const sumHasta = (arr, m) => {
  if (!arr) return 0
  let s = 0; for (let i = 0; i < Math.min(m, 12); i++) s += arr[i] || 0
  return s
}
const safeDiv = (a, b) => (b && Math.abs(b) > 0.01) ? (a / b) : 0
const pct = (n, b) => safeDiv(n, b) * 100
const semaforoDirecto = (v, { verde, amarillo }) =>
  v >= verde ? 'verde' : v >= amarillo ? 'amarillo' : 'rojo'
const semaforoInvertido = (v, { verde, amarillo }) =>
  v <= verde ? 'verde' : v <= amarillo ? 'amarillo' : 'rojo'
const semaforoRango = (v, { verde_min, verde_max, amarillo_max }) => {
  if (v >= verde_min && v <= verde_max) return 'verde'
  if (v < verde_min && v >= verde_min * 0.5) return 'amarillo'
  if (v > verde_max && v <= amarillo_max) return 'amarillo'
  return 'rojo'
}
const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)

export function calcularKPIs({ valores, mesHasta, dotacionMes, lineasPorCodigo }) {
  if (!valores) return []
  const get = c => valores.get(c) ?? new Array(12).fill(0)
  const m = Math.max(1, Math.min(12, mesHasta || 1))

  const vn = sumHasta(get('VENTA_NETA'), m)
  const cn = sumHasta(get('COSTO_NETO'), m)
  const mc = sumHasta(get('MARGEN_CONTRIB'), m)
  const resOp = sumHasta(get('RESULTADO_OPERACIONAL'), m)
  const resFin = sumHasta(get('RESULTADO_FINAL'), m)
  const remCodes = ['REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS']
  const remTotal = remCodes.reduce((s, c) => s + sumHasta(get(c), m), 0)
  const arriendo = sumHasta(get('ARRIENDO'), m)
  const marketing = sumHasta(get('MARKETING'), m)

  const sumPrev = (c) => {
    const arr = get(c); let s = 0
    for (let i = 0; i < m - 1; i++) s += arr[i] || 0
    return s
  }
  const composicion = (codigos) => {
    const items = codigos.map(c => ({
      codigo: c,
      nombre: lineasPorCodigo?.get(c)?.nombre ?? c,
      monto: sumHasta(get(c), m),
    })).sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto))
    const total = items.reduce((s, it) => s + it.monto, 0)
    return items.map(it => ({ ...it, peso: total > 0 ? it.monto / total : 0 }))
  }
  const cambio = (actual, anterior) => {
    if (!anterior || Math.abs(anterior) < 0.01) return null
    const delta = actual - anterior
    return { delta, pct: (delta / Math.abs(anterior)) * 100, anterior }
  }
  const evolucionPctFn = (codigoNum, codigoDen) => Array.from({ length: 12 }, (_, i) => {
    if (i >= m) return null
    const den = get(codigoDen)[i]
    if (!den || den === 0) return null
    return (get(codigoNum)[i] / den) * 100
  })

  const kpis = []

  // 1. Margen Bruto
  const margenBrutoPct = pct(mc, vn)
  const margenBrutoPctPrev = pct(sumPrev('MARGEN_CONTRIB'), sumPrev('VENTA_NETA'))
  kpis.push({
    id: 'margen_bruto',
    titulo: 'Margen Bruto',
    valor: margenBrutoPct,
    formato: 'pct',
    semaforo: semaforoDirecto(margenBrutoPct, UMBRALES.margen_bruto_pct),
    sub: fmtCLP(mc) + ' sobre ' + fmtCLP(vn),
    benchmark: '≥45% sano',
    benchmarkFuente: BENCHMARK_FUENTE.margen_bruto,
    explicacion: 'Margen de contribución sobre venta neta. Indica qué queda después del costo directo.',
    formula: 'Margen Contribución / Venta Neta',
    composicion: [
      { codigo: 'VENTA_NETA', nombre: 'Venta Neta', monto: vn, peso: 1 },
      { codigo: 'COSTO_NETO', nombre: 'Costo Neto', monto: -cn, peso: -1 },
    ],
    evolucionPct: evolucionPctFn('MARGEN_CONTRIB', 'VENTA_NETA'),
    cambio: cambio(margenBrutoPct, margenBrutoPctPrev),
  })

  // 2. Margen Operacional
  const margenOpPct = pct(resOp, vn)
  const margenOpPrev = pct(sumPrev('RESULTADO_OPERACIONAL'), sumPrev('VENTA_NETA'))
  kpis.push({
    id: 'margen_op',
    titulo: 'Margen Operacional',
    valor: margenOpPct,
    formato: 'pct',
    semaforo: semaforoDirecto(margenOpPct, UMBRALES.margen_operacional_pct),
    sub: 'Resultado Op: ' + fmtCLP(resOp),
    benchmark: '≥8% sano',
    benchmarkFuente: BENCHMARK_FUENTE.margen_op,
    explicacion: 'Rentabilidad después de todos los gastos operacionales (rem, arriendo, marketing, admin). Excluye intereses e impuestos.',
    formula: '(Margen Contribución − Gastos Operacionales) / Venta Neta',
    composicion: composicion(LINEAS_GASTOS_OPERATIVOS),
    evolucionPct: evolucionPctFn('RESULTADO_OPERACIONAL', 'VENTA_NETA'),
    cambio: cambio(margenOpPct, margenOpPrev),
  })

  // 3. Margen Neto (CONTABLE — no incluye compras de inventario, que son inversión en activo)
  const interesesAcum = sumHasta(get('INTERES_CREDITOS'), m)
  const impuestosAcum = sumHasta(get('IMPUESTOS'), m)
  const resNetoContable = resOp - interesesAcum - impuestosAcum
  const margenNetoPct = pct(resNetoContable, vn)
  kpis.push({
    id: 'margen_neto',
    titulo: 'Margen Neto',
    valor: margenNetoPct,
    formato: 'pct',
    semaforo: semaforoDirecto(margenNetoPct, UMBRALES.margen_neto_pct),
    sub: 'Resultado neto: ' + fmtCLP(resNetoContable),
    benchmark: '≥5% sano',
    benchmarkFuente: BENCHMARK_FUENTE.margen_neto,
    explicacion: 'Rentabilidad contable final: resultado operacional menos intereses e impuestos. NO descuenta las compras de inventario (eso es inversión en activo, no gasto del período — se ve en el Flujo Económico).',
    formula: '(Resultado Operacional − Intereses − Impuestos) / Venta Neta',
    composicion: [
      { codigo: 'RESULTADO_OPERACIONAL', nombre: 'Resultado Operacional', monto: resOp, peso: 0 },
      { codigo: 'INTERES_CREDITOS', nombre: 'Intereses (-)', monto: -interesesAcum, peso: 0 },
      { codigo: 'IMPUESTOS', nombre: 'Impuestos (-)', monto: -impuestosAcum, peso: 0 },
    ],
    evolucionPct: Array.from({ length: 12 }, (_, i) => {
      if (i >= m) return null
      const v = get('VENTA_NETA')[i]
      if (!v) return null
      const rn = get('RESULTADO_OPERACIONAL')[i] - get('INTERES_CREDITOS')[i] - get('IMPUESTOS')[i]
      return (rn / v) * 100
    }),
  })

  // 4. Costo Venta / VN
  const costoVentaPct = pct(cn, vn)
  kpis.push({
    id: 'costo_venta',
    titulo: 'Costo Venta / VN',
    valor: costoVentaPct,
    formato: 'pct',
    semaforo: semaforoInvertido(costoVentaPct, UMBRALES.costo_venta_pct),
    sub: fmtCLP(cn) + ' de costo neto',
    benchmark: '≤55% sano',
    benchmarkFuente: BENCHMARK_FUENTE.costo_venta,
    explicacion: 'Qué % de la venta neta se va en costo directo. A menor, mejor margen.',
    formula: 'Costo Neto / Venta Neta',
    composicion: [{ codigo: 'COSTO_NETO', nombre: 'Costo Neto', monto: cn, peso: 1 }],
    evolucionPct: evolucionPctFn('COSTO_NETO', 'VENTA_NETA'),
  })

  // 5. Remuneraciones / VN
  const remPct = pct(remTotal, vn)
  kpis.push({
    id: 'rem_total',
    titulo: 'Remuneraciones / VN',
    valor: remPct,
    formato: 'pct',
    semaforo: semaforoInvertido(remPct, UMBRALES.rem_total_pct),
    sub: fmtCLP(remTotal) + ' planilla',
    benchmark: '≤18% sano',
    benchmarkFuente: BENCHMARK_FUENTE.rem_total,
    explicacion: 'Costo total de planilla (sueldos + aportes patronales + honorarios). Excede 25% es alerta crítica.',
    formula: 'Suma REM_* / Venta Neta',
    composicion: composicion(remCodes),
    evolucionPct: Array.from({ length: 12 }, (_, i) => {
      if (i >= m) return null
      const v = get('VENTA_NETA')[i]
      if (!v) return null
      const r = remCodes.reduce((s, c) => s + (get(c)[i] || 0), 0)
      return (r / v) * 100
    }),
  })

  // 6. Arriendo
  const arriendoPct = pct(arriendo, vn)
  kpis.push({
    id: 'arriendo',
    titulo: 'Arriendo / VN',
    valor: arriendoPct,
    formato: 'pct',
    semaforo: semaforoInvertido(arriendoPct, UMBRALES.arriendo_pct),
    sub: fmtCLP(arriendo) + ' arriendos',
    benchmark: '≤6% sano',
    benchmarkFuente: BENCHMARK_FUENTE.arriendo,
    explicacion: 'KPI clásico de retail. Si supera 8% suele indicar tienda subdimensionada para su arriendo.',
    formula: 'Arriendo / Venta Neta',
    composicion: [{ codigo: 'ARRIENDO', nombre: 'Arriendo', monto: arriendo, peso: 1 }],
    evolucionPct: evolucionPctFn('ARRIENDO', 'VENTA_NETA'),
  })

  // 7. Marketing
  const marketingPct = pct(marketing, vn)
  kpis.push({
    id: 'marketing',
    titulo: 'Marketing / VN',
    valor: marketingPct,
    formato: 'pct',
    semaforo: semaforoRango(marketingPct, UMBRALES.marketing_pct),
    sub: fmtCLP(marketing) + ' inversión',
    benchmark: '1,5-4% sano',
    benchmarkFuente: BENCHMARK_FUENTE.marketing,
    explicacion: 'Muy bajo (<0.5%) sugiere subinversión; muy alto (>5%) puede indicar quema sin retorno.',
    formula: 'Marketing / Venta Neta',
    composicion: [{ codigo: 'MARKETING', nombre: 'Marketing', monto: marketing, peso: 1 }],
    evolucionPct: evolucionPctFn('MARKETING', 'VENTA_NETA'),
  })

  // 7b. Gasto Operativo Total / VN (sin costo de ventas)
  const gastoOpTotal = LINEAS_GASTOS_OPERATIVOS.reduce((s, c) => s + sumHasta(get(c), m), 0)
  const gastoOpPct = pct(gastoOpTotal, vn)
  kpis.push({
    id: 'gasto_operativo',
    titulo: 'Gasto Operativo / VN',
    valor: gastoOpPct,
    formato: 'pct',
    semaforo: semaforoInvertido(gastoOpPct, UMBRALES.gasto_operativo_pct),
    sub: fmtCLP(gastoOpTotal) + ' gasto op.',
    benchmark: '≤30% sano',
    benchmarkFuente: BENCHMARK_FUENTE.gasto_operativo,
    explicacion: 'Todos los gastos operativos (rem, arriendo, marketing, admin) sobre venta neta. NO incluye el costo de los productos. Mide eficiencia de la estructura.',
    formula: 'Suma gastos operativos / Venta Neta',
    composicion: composicion(LINEAS_GASTOS_OPERATIVOS),
    evolucionPct: Array.from({ length: 12 }, (_, i) => {
      if (i >= m) return null
      const v = get('VENTA_NETA')[i]
      if (!v) return null
      const g = LINEAS_GASTOS_OPERATIVOS.reduce((s, c) => s + (get(c)[i] || 0), 0)
      return (g / v) * 100
    }),
  })

  // 8. Ventas por empleado
  if (dotacionMes && dotacionMes > 0) {
    const ventaPromMes = m > 0 ? (vn / m) : 0
    const ventaPorEmpleado = ventaPromMes / dotacionMes
    kpis.push({
      id: 'venta_empleado',
      titulo: 'VN / Empleado',
      valor: ventaPorEmpleado,
      formato: 'clp',
      semaforo: ventaPorEmpleado >= UMBRALES.venta_empleado.verde ? 'verde' : ventaPorEmpleado >= UMBRALES.venta_empleado.amarillo ? 'amarillo' : 'rojo',
      sub: dotacionMes + ' trabajadores promedio',
      benchmark: '≥$12M/empleado/mes',
      benchmarkFuente: BENCHMARK_FUENTE.venta_empleado,
      explicacion: 'Productividad de la dotación. Cuánto vende la empresa por trabajador en un mes promedio.',
      formula: '(Venta Neta / meses) / Dotación',
      composicion: null,
      evolucionPct: null,
    })
  }

  return kpis
}

export function calcularMetricasGestion({ valores, mesHasta, lineasPorCodigo, saldoCajaEstimado }) {
  if (!valores) return {}
  const get = c => valores.get(c) ?? new Array(12).fill(0)
  const m = Math.max(1, Math.min(12, mesHasta || 1))

  const vn = sumHasta(get('VENTA_NETA'), m)
  const mc = sumHasta(get('MARGEN_CONTRIB'), m)
  const resOp = sumHasta(get('RESULTADO_OPERACIONAL'), m)
  const interesesAcum = sumHasta(get('INTERES_CREDITOS'), m)
  const impuestosAcum = sumHasta(get('IMPUESTOS'), m)
  const comprasInventario = sumHasta(get('TOTAL_MP'), m)
  // Resultado neto CONTABLE (sin restar compras de inventario)
  const resNetoContable = resOp - interesesAcum - impuestosAcum
  // Flujo económico: lo que queda en caja tras reinvertir en inventario.
  // NEGATIVO no es pérdida: significa reinversión en stock (activo).
  const flujoEconomico = resNetoContable - comprasInventario

  // PUNTO DE EQUILIBRIO REAL: usa TODAS las líneas fijas
  let gastosFijosTotal = 0
  const composicionFijos = []
  LINEAS_FIJAS.forEach(codigo => {
    const monto = sumHasta(get(codigo), m)
    if (monto > 0) {
      gastosFijosTotal += monto
      composicionFijos.push({
        codigo,
        nombre: lineasPorCodigo?.get(codigo)?.nombre ?? codigo,
        monto,
      })
    }
  })
  composicionFijos.sort((a, b) => b.monto - a.monto)
  const gastosFijosMes = m > 0 ? (gastosFijosTotal / m) : 0
  const margenBrutoPct = vn > 0 ? mc / vn : 0
  const peMensual = margenBrutoPct > 0 ? gastosFijosMes / margenBrutoPct : null
  const ventaPromMes = m > 0 ? vn / m : 0
  const margenSeguridadPct = peMensual && ventaPromMes > 0
    ? ((ventaPromMes - peMensual) / ventaPromMes) * 100
    : null

  // Eficiencia Marketing (no ROI causal): venta neta / inversión marketing últimos 6 meses
  const ultimosMeses = Math.min(m, 6)
  let marketingUltimos = 0, ventaUltimos = 0
  for (let i = m - ultimosMeses; i < m; i++) {
    marketingUltimos += get('MARKETING')[i] || 0
    ventaUltimos += get('VENTA_NETA')[i] || 0
  }
  const eficienciaMkt = marketingUltimos > 0 ? ventaUltimos / marketingUltimos : null

  const remTotal = ['REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS']
    .reduce((s, c) => s + sumHasta(get(c), m), 0)
  const productividadRem = remTotal > 0 ? vn / remTotal : 0

  const diasTranscurridos = m * 30
  // Burn rate diario: incluye TODO lo que sale de caja (incluyendo compra de inventario)
  const burnTotal = TODOS_COSTOS_Y_GASTOS.reduce((s, c) => s + sumHasta(get(c), m), 0)
  const burnDiario = diasTranscurridos > 0 ? burnTotal / diasTranscurridos : 0
  const runwayDias = (saldoCajaEstimado && burnDiario > 0)
    ? Math.floor(saldoCajaEstimado / burnDiario)
    : null
  // Eficiencia operativa: resultado operacional vs gastos POST margen bruto (no incluye costo)
  const gastosOperativosTotal = LINEAS_GASTOS_OPERATIVOS.reduce((s, c) => s + sumHasta(get(c), m), 0)
  const eficienciaOp = gastosOperativosTotal > 0 ? resOp / gastosOperativosTotal : 0
  // Para retrocompat con el resumen LLM y otros consumidores:
  const gastosTotales = burnTotal

  return {
    peMensual, peAnual: peMensual ? peMensual * 12 : null,
    ventaPromMes, margenSeguridadPct,
    gastosFijosMes, gastosFijosTotalPeriodo: gastosFijosTotal,
    composicionFijos,
    eficienciaMkt, marketingUltimos, ventaUltimos, ultimosMesesAnalizados: ultimosMeses,
    productividadRem,
    burnDiario, runwayDias,
    eficienciaOp,
    gastosTotalesPeriodo: gastosTotales,
    // Contabilidad vs caja
    resNetoContable, margenNetoContablePct: vn > 0 ? (resNetoContable / vn) * 100 : 0,
    comprasInventario, flujoEconomico,
    flujoEconomicoPct: vn > 0 ? (flujoEconomico / vn) * 100 : 0,
  }
}

export function generarAlertas({ valores, presupuestoMap, mesHasta, lineasPorCodigo }) {
  if (!valores) return []
  const alertas = []
  const get = c => valores.get(c) ?? new Array(12).fill(0)
  const m = Math.max(1, Math.min(12, mesHasta || 1))

  const vn = sumHasta(get('VENTA_NETA'), m)
  const mc = sumHasta(get('MARGEN_CONTRIB'), m)
  const resOp = sumHasta(get('RESULTADO_OPERACIONAL'), m)
  const remCodes = ['REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS']
  const remTotal = remCodes.reduce((s, c) => s + sumHasta(get(c), m), 0)
  const remPct = pct(remTotal, vn)
  const margenBrutoPct = pct(mc, vn)

  // Crítica: margen bruto cayó >5pp
  if (m > 1) {
    let s = 0, v = 0
    for (let i = 0; i < m - 1; i++) { s += get('MARGEN_CONTRIB')[i] || 0; v += get('VENTA_NETA')[i] || 0 }
    const margenPrev = v > 0 ? (s / v) * 100 : 0
    if (margenPrev > 0 && (margenPrev - margenBrutoPct) >= 5) {
      alertas.push({
        severidad: 'critica',
        codigo: 'MARGEN_CONTRIB',
        titulo: 'Margen bruto cayó significativamente',
        detalle: 'De ' + margenPrev.toFixed(1) + '% a ' + margenBrutoPct.toFixed(1) + '% (' + (margenBrutoPct - margenPrev).toFixed(1) + ' pp). Revisar costos o precios.',
        meses: [m - 1],
        valores: { antes: margenPrev, despues: margenBrutoPct },
      })
    }
  }

  // Crítica: resultado op negativo
  if (resOp < 0) {
    alertas.push({
      severidad: 'critica',
      codigo: 'RESULTADO_OPERACIONAL',
      titulo: 'Resultado operacional negativo',
      detalle: 'Pérdida acumulada de ' + fmtCLP(Math.abs(resOp)) + '. El negocio consume capital.',
      meses: Array.from({ length: m }, (_, i) => i),
      valores: { monto: resOp },
    })
  }

  // Crítica: línea >20% sobre presupuesto
  if (presupuestoMap) {
    presupuestoMap.forEach((presArr, codigo) => {
      const presTotal = sumHasta(presArr, m)
      if (presTotal <= 0) return
      const realArr = get(codigo)
      const realTotal = sumHasta(realArr, m)
      if (realTotal > presTotal * 1.2) {
        const excesoPct = ((realTotal - presTotal) / presTotal) * 100
        const nombre = lineasPorCodigo?.get(codigo)?.nombre ?? codigo
        const mesesExc = []
        for (let i = 0; i < m; i++) {
          if ((presArr[i] || 0) > 0 && (realArr[i] || 0) > (presArr[i] || 0) * 1.2) mesesExc.push(i)
        }
        alertas.push({
          severidad: 'critica',
          codigo,
          titulo: nombre + ': ' + excesoPct.toFixed(0) + '% sobre presupuesto',
          detalle: 'Real ' + fmtCLP(realTotal) + ' vs presupuesto ' + fmtCLP(presTotal) + ' (exceso ' + fmtCLP(realTotal - presTotal) + ').',
          meses: mesesExc.length > 0 ? mesesExc : [m - 1],
          valores: { real: realTotal, presupuesto: presTotal, exceso: realTotal - presTotal },
        })
      }
    })
  }

  // Crítica: rem > 25% VN
  if (vn > 0 && remPct > 25) {
    alertas.push({
      severidad: 'critica',
      codigo: 'REM_OPERACION',
      titulo: 'Planilla absorbe ' + remPct.toFixed(1) + '% de la venta neta',
      detalle: fmtCLP(remTotal) + ' planilla total sobre VN ' + fmtCLP(vn) + '. Umbral sano ≤18%.',
      meses: Array.from({ length: m }, (_, i) => i),
      valores: { remTotal, vn, pct: remPct },
    })
  }

  // Atención: crecimiento >30%
  if (m > 1) {
    const crecs = []
    const watch = ['MARKETING','REM_VENTA','REM_OPERACION','REM_ADMIN','GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','CUENTAS_BASICAS','GASTOS_TI','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS']
    watch.forEach(codigo => {
      const arr = get(codigo)
      let actual = 0, prev = 0
      for (let i = 0; i < m; i++) actual += arr[i] || 0
      for (let i = 0; i < m - 1; i++) prev += arr[i] || 0
      if (m > 1) prev = prev * m / (m - 1)
      if (prev > 100000 && actual > prev * 1.3) {
        const crecPct = ((actual - prev) / prev) * 100
        crecs.push({ codigo, crecPct, actual, prev, nombre: lineasPorCodigo?.get(codigo)?.nombre ?? codigo })
      }
    })
    crecs.sort((a, b) => b.crecPct - a.crecPct).slice(0, 3).forEach(c => {
      alertas.push({
        severidad: 'atencion',
        codigo: c.codigo,
        titulo: c.nombre + ' creció +' + c.crecPct.toFixed(0) + '%',
        detalle: 'De ' + fmtCLP(c.prev) + ' a ' + fmtCLP(c.actual) + ' (proyectado). Verificar si justifica.',
        meses: [m - 1],
        valores: { antes: c.prev, despues: c.actual },
      })
    })
  }

  // Atención: línea >15% del gasto operativo total (sin contar costo de ventas)
  const gastosTotal = LINEAS_GASTOS_OPERATIVOS.reduce((s, c) => s + sumHasta(get(c), m), 0)
  if (gastosTotal > 0) {
    LINEAS_GASTOS_OPERATIVOS.forEach(codigo => {
      const monto = sumHasta(get(codigo), m)
      const peso = monto / gastosTotal
      if (peso > 0.15 && monto > 5000000) {
        const nombre = lineasPorCodigo?.get(codigo)?.nombre ?? codigo
        alertas.push({
          severidad: 'atencion',
          codigo,
          titulo: nombre + ' concentra ' + (peso * 100).toFixed(0) + '% del gasto',
          detalle: fmtCLP(monto) + ' de un total de ' + fmtCLP(gastosTotal) + '.',
          meses: Array.from({ length: m }, (_, i) => i),
          valores: { monto, peso, gastoTotal: gastosTotal },
        })
      }
    })
  }

  // Positiva: margen mejoró
  if (m > 1) {
    let s = 0, v = 0
    for (let i = 0; i < m - 1; i++) { s += get('MARGEN_CONTRIB')[i] || 0; v += get('VENTA_NETA')[i] || 0 }
    const margenPrev = v > 0 ? (s / v) * 100 : 0
    if (margenPrev > 0 && (margenBrutoPct - margenPrev) >= 2) {
      alertas.push({
        severidad: 'positiva',
        codigo: 'MARGEN_CONTRIB',
        titulo: 'Margen bruto mejorando',
        detalle: 'De ' + margenPrev.toFixed(1) + '% a ' + margenBrutoPct.toFixed(1) + '% (+' + (margenBrutoPct - margenPrev).toFixed(1) + ' pp).',
        meses: [m - 1],
        valores: { antes: margenPrev, despues: margenBrutoPct },
      })
    }
  }

  if (resOp > 0 && pct(resOp, vn) >= 10) {
    alertas.push({
      severidad: 'positiva',
      codigo: 'RESULTADO_OPERACIONAL',
      titulo: 'Resultado operacional sano',
      detalle: 'Margen ' + pct(resOp, vn).toFixed(1) + '% (' + fmtCLP(resOp) + '). Sobre referencia 10%.',
      meses: Array.from({ length: m }, (_, i) => i),
      valores: { resOp, vn },
    })
  }

  const orden = { critica: 0, atencion: 1, positiva: 2 }
  alertas.sort((a, b) => orden[a.severidad] - orden[b.severidad])
  return alertas
}

export const formato = {
  clp: fmtCLP,
  clpCompacto: n => {
    const abs = Math.abs(n || 0)
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'MM'
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K'
    return fmtCLP(n)
  },
  pct: (n, d = 1) => (n || 0).toFixed(d) + '%',
  ratio: (n, d = 2) => (n || 0).toFixed(d),
  numero: n => new Intl.NumberFormat('es-CL').format(Math.round(n || 0)),
  mes: i => MESES_ES[i] || '',
}

export function construirResumenParaLLM({ kpis, alertas, metricas, anio, mesHasta }) {
  const mesNombre = MESES_ES[mesHasta - 1]
  let txt = 'EERR ACUMULADO ' + anio + ' (enero - ' + mesNombre + '):\n\n'
  txt += 'KPIs DE SALUD FINANCIERA:\n'
  kpis.forEach(k => {
    const v = k.formato === 'pct' ? k.valor.toFixed(1) + '%' : k.formato === 'clp' ? fmtCLP(k.valor) : k.valor
    txt += '- ' + k.titulo + ': ' + v + ' (' + k.semaforo.toUpperCase() + ', benchmark ' + k.benchmark + ')\n'
  })
  txt += '\nMÉTRICAS DE GESTIÓN:\n'
  txt += '- Punto de Equilibrio mensual: ' + (metricas.peMensual ? fmtCLP(metricas.peMensual) : 'n/d') + '\n'
  txt += '- Venta promedio mensual: ' + fmtCLP(metricas.ventaPromMes) + '\n'
  txt += '- Margen de seguridad: ' + (metricas.margenSeguridadPct !== null ? metricas.margenSeguridadPct.toFixed(1) + '%' : 'n/d') + '\n'
  txt += '- Eficiencia Marketing: $' + (metricas.eficienciaMkt ? metricas.eficienciaMkt.toFixed(1) + ' venta por $1 marketing (últimos ' + metricas.ultimosMesesAnalizados + ' meses)' : 'n/d') + '\n'
  txt += '- Productividad Remuneraciones: ' + metricas.productividadRem.toFixed(2) + 'x\n'
  txt += '- Burn rate diario: ' + fmtCLP(metricas.burnDiario) + '\n'
  txt += '- Eficiencia Operativa: ' + (metricas.eficienciaOp * 100).toFixed(1) + '%\n'
  txt += '\nCONTABILIDAD vs CAJA (importante para el diagnóstico):\n'
  txt += '- Resultado Neto Contable: ' + fmtCLP(metricas.resNetoContable) + ' (' + (metricas.margenNetoContablePct || 0).toFixed(1) + '% de VN). Esta es la rentabilidad real.\n'
  txt += '- Compras de inventario en el período: ' + fmtCLP(metricas.comprasInventario) + ' (inversión en stock para crecer/importar, NO gasto del período).\n'
  txt += '- Flujo Económico (tras reinvertir en inventario): ' + fmtCLP(metricas.flujoEconomico) + '. Si es negativo, es por reinversión en stock, no por pérdida operativa.\n'
  txt += '\nALERTAS (' + alertas.length + '):\n'
  alertas.forEach(a => {
    txt += '- [' + a.severidad.toUpperCase() + '] ' + a.titulo + ': ' + a.detalle + '\n'
  })
  return txt
}
