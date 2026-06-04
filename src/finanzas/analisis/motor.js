/* ═══ MOTOR DE ANÁLISIS v2 ═══
   Fórmulas corregidas: PE real (todos los fijos), Eficiencia Marketing (no ROI inventado),
   KPIs con composición + evolución + cambio vs período anterior para drill-down.
*/

const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export const UMBRALES = {
  margen_bruto_pct:        { verde: 40, amarillo: 35 },
  margen_operacional_pct:  { verde: 15, amarillo: 5 },
  margen_neto_pct:         { verde: 8, amarillo: 0 },
  costo_venta_pct:         { verde: 60, amarillo: 65 },
  rem_total_pct:           { verde: 18, amarillo: 25 },
  arriendo_pct:            { verde: 5,  amarillo: 8 },
  marketing_pct:           { verde_min: 1, verde_max: 3, amarillo_max: 5 },
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

const TODOS_GASTOS_OPERATIVOS = [
  'COSTO_NETO',
  'REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS',
  'MARKETING','COMISION_GETNET',
  'GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS',
  'COMBUSTIBLE','FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS'
]

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
    benchmark: '≥40% sano',
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
    benchmark: '≥15% sano',
    explicacion: 'Rentabilidad después de todos los gastos operacionales (rem, arriendo, marketing, admin). Excluye intereses e impuestos.',
    formula: '(Margen Contribución − Gastos Operacionales) / Venta Neta',
    composicion: composicion(TODOS_GASTOS_OPERATIVOS),
    evolucionPct: evolucionPctFn('RESULTADO_OPERACIONAL', 'VENTA_NETA'),
    cambio: cambio(margenOpPct, margenOpPrev),
  })

  // 3. Margen Neto
  const margenNetoPct = pct(resFin, vn)
  kpis.push({
    id: 'margen_neto',
    titulo: 'Margen Neto',
    valor: margenNetoPct,
    formato: 'pct',
    semaforo: semaforoDirecto(margenNetoPct, UMBRALES.margen_neto_pct),
    sub: 'Resultado Final: ' + fmtCLP(resFin),
    benchmark: '≥8% sano',
    explicacion: 'Rentabilidad final descontando intereses, impuestos y movimiento de plata (compras de inventario).',
    formula: 'Resultado Final / Venta Neta',
    composicion: [
      { codigo: 'RESULTADO_OPERACIONAL', nombre: 'Resultado Operacional', monto: resOp, peso: 0 },
      { codigo: 'INTERES_CREDITOS', nombre: 'Intereses (-)', monto: -sumHasta(get('INTERES_CREDITOS'), m), peso: 0 },
      { codigo: 'IMPUESTOS', nombre: 'Impuestos (-)', monto: -sumHasta(get('IMPUESTOS'), m), peso: 0 },
      { codigo: 'TOTAL_MP', nombre: 'Mov. Plata (-)', monto: -sumHasta(get('TOTAL_MP'), m), peso: 0 },
    ],
    evolucionPct: evolucionPctFn('RESULTADO_FINAL', 'VENTA_NETA'),
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
    benchmark: '≤60% sano',
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
    benchmark: '≤5% sano',
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
    benchmark: '1-3% sano',
    explicacion: 'Muy bajo (<0.5%) sugiere subinversión; muy alto (>5%) puede indicar quema sin retorno.',
    formula: 'Marketing / Venta Neta',
    composicion: [{ codigo: 'MARKETING', nombre: 'Marketing', monto: marketing, peso: 1 }],
    evolucionPct: evolucionPctFn('MARKETING', 'VENTA_NETA'),
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
      semaforo: ventaPorEmpleado >= 15000000 ? 'verde' : ventaPorEmpleado >= 8000000 ? 'amarillo' : 'rojo',
      sub: dotacionMes + ' trabajadores promedio',
      benchmark: '≥$15M/empleado/mes',
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
  const gastosTotales = TODOS_GASTOS_OPERATIVOS.reduce((s, c) => s + sumHasta(get(c), m), 0)
  const burnDiario = diasTranscurridos > 0 ? gastosTotales / diasTranscurridos : 0
  const runwayDias = (saldoCajaEstimado && burnDiario > 0)
    ? Math.floor(saldoCajaEstimado / burnDiario)
    : null
  const eficienciaOp = gastosTotales > 0 ? resOp / gastosTotales : 0

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

  // Atención: línea >15% del gasto total
  const gastosTotal = TODOS_GASTOS_OPERATIVOS.reduce((s, c) => s + sumHasta(get(c), m), 0)
  if (gastosTotal > 0) {
    TODOS_GASTOS_OPERATIVOS.forEach(codigo => {
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
  txt += '\nALERTAS (' + alertas.length + '):\n'
  alertas.forEach(a => {
    txt += '- [' + a.severidad.toUpperCase() + '] ' + a.titulo + ': ' + a.detalle + '\n'
  })
  return txt
}
