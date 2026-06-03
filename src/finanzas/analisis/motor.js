/* ═══ MOTOR DE ANÁLISIS FINANCIERO ═══
   Funciones puras. No tocan Supabase, no tocan React.
   Reciben los `valores` calculados del EERR (Map<codigo, number[12]>)
   y opcionalmente el presupuesto, dotación, y mes hasta el cual sumar.
   Devuelven KPIs estructurados y alertas con severidad.

   Diseño determinístico — reglas explícitas, auditables, repetibles.
   Si los umbrales hay que ajustarlos en el futuro, se cambian acá
   en UMBRALES y todos los consumidores se actualizan.
*/

export const UMBRALES = {
  margen_bruto_pct:        { verde: 40, amarillo: 35 },           // ≥40 verde, 35-40 amarillo, <35 rojo
  margen_operacional_pct:  { verde: 15, amarillo: 5 },
  costo_venta_pct:         { verde: 60, amarillo: 65, invertido: true },  // <60 verde, 60-65 amarillo, >65 rojo
  rem_total_pct:           { verde: 18, amarillo: 25, invertido: true },
  arriendo_pct:            { verde: 5,  amarillo: 8,  invertido: true },
  marketing_pct:           { verde_min: 1, verde_max: 3, amarillo_max: 5 },  // rango: 1-3 verde, 0.5-1 o 3-5 amarillo
  var_vs_presupuesto_pct:  { verde: 5,  amarillo: 15 },  // ±5 verde, ±5-15 amarillo, >±15 rojo
  var_gasto_vs_venta:      { verde: 1.0, amarillo: 1.3 },  // gasto/venta crece <=1 verde, <=1.3 amarillo, >1.3 rojo
}

const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

/* ─── Helpers ─── */
const sumHasta = (arr, mesHasta1Indexed) => {
  if (!arr) return 0
  let s = 0
  for (let i = 0; i < Math.min(mesHasta1Indexed, 12); i++) s += arr[i] || 0
  return s
}
const safeDiv = (a, b) => (b && Math.abs(b) > 0.01) ? (a / b) : 0
const pct = (n, base) => safeDiv(n, base) * 100
const semaforoDirecto = (valor, { verde, amarillo }) =>
  valor >= verde ? 'verde' : valor >= amarillo ? 'amarillo' : 'rojo'
const semaforoInvertido = (valor, { verde, amarillo }) =>
  valor <= verde ? 'verde' : valor <= amarillo ? 'amarillo' : 'rojo'
const semaforoRango = (valor, { verde_min, verde_max, amarillo_max }) => {
  if (valor >= verde_min && valor <= verde_max) return 'verde'
  if (valor < verde_min && valor >= verde_min * 0.5) return 'amarillo'
  if (valor > verde_max && valor <= amarillo_max) return 'amarillo'
  return 'rojo'
}

/* ─── KPIs principales ───
   Devuelve un array de objetos KPI listos para renderizar.
   `mesHasta` es 1-indexed (1=enero..12=diciembre). Por defecto: mes actual.
   `valores` = Map<codigo, number[12]> tal como lo emite FinPresupuesto/EERR.
*/
export function calcularKPIs({ valores, mesHasta, dotacionMes }) {
  if (!valores) return []

  const get = c => valores.get(c) ?? new Array(12).fill(0)
  const m = Math.max(1, Math.min(12, mesHasta || 1))

  const vn  = sumHasta(get('VENTA_NETA'), m)
  const vb  = sumHasta(get('VENTA_BRUTA'), m)
  const cn  = sumHasta(get('COSTO_NETO'), m)
  const mc  = sumHasta(get('MARGEN_CONTRIB'), m)
  const remOp     = sumHasta(get('REM_OPERACION'), m)
  const remVe     = sumHasta(get('REM_VENTA'), m)
  const remAd     = sumHasta(get('REM_ADMIN'), m)
  const remSo     = sumHasta(get('REM_SOCIOS'), m)
  const remPv     = sumHasta(get('REM_PREVIRED'), m)
  const arriendo  = sumHasta(get('ARRIENDO'), m)
  const marketing = sumHasta(get('MARKETING'), m)
  const resOp     = sumHasta(get('RESULTADO_OPERACIONAL'), m)
  const resFin    = sumHasta(get('RESULTADO_FINAL'), m)
  const totGastoOperativo = sumHasta(get('TOTAL_GASTO_OPERATIVO'), m)
  const totGastoVenta     = sumHasta(get('TOTAL_GASTO_VENTA'), m)

  const remTotal = remOp + remVe + remAd + remSo + remPv

  const kpis = []

  // 1. Margen bruto %
  const margenBrutoPct = pct(mc, vn)
  kpis.push({
    id: 'margen_bruto',
    titulo: 'Margen Bruto',
    valor: margenBrutoPct,
    formato: 'pct',
    semaforo: semaforoDirecto(margenBrutoPct, UMBRALES.margen_bruto_pct),
    sub: `${formatoCLP(mc)} de ${formatoCLP(vn)} VN`,
    benchmark: '≥40% sano',
  })

  // 2. Margen operacional %
  const margenOpPct = pct(resOp, vn)
  kpis.push({
    id: 'margen_op',
    titulo: 'Margen Operacional',
    valor: margenOpPct,
    formato: 'pct',
    semaforo: semaforoDirecto(margenOpPct, UMBRALES.margen_operacional_pct),
    sub: `Resultado Op: ${formatoCLP(resOp)}`,
    benchmark: '≥15% sano',
  })

  // 3. Margen neto %
  const margenNetoPct = pct(resFin, vn)
  kpis.push({
    id: 'margen_neto',
    titulo: 'Margen Neto',
    valor: margenNetoPct,
    formato: 'pct',
    semaforo: margenNetoPct >= 8 ? 'verde' : margenNetoPct >= 0 ? 'amarillo' : 'rojo',
    sub: `Resultado Final: ${formatoCLP(resFin)}`,
    benchmark: '≥8% sano',
  })

  // 4. Costo venta sobre VN
  const costoVentaPct = pct(cn, vn)
  kpis.push({
    id: 'costo_venta',
    titulo: 'Costo Venta / VN',
    valor: costoVentaPct,
    formato: 'pct',
    semaforo: semaforoInvertido(costoVentaPct, UMBRALES.costo_venta_pct),
    sub: `${formatoCLP(cn)} de costo`,
    benchmark: '≤60% sano',
  })

  // 5. Remuneraciones totales / VN
  const remPct = pct(remTotal, vn)
  kpis.push({
    id: 'rem_total',
    titulo: 'Remuneraciones / VN',
    valor: remPct,
    formato: 'pct',
    semaforo: semaforoInvertido(remPct, UMBRALES.rem_total_pct),
    sub: `${formatoCLP(remTotal)} planilla`,
    benchmark: '≤18% sano',
  })

  // 6. Arriendo / VN
  const arriendoPct = pct(arriendo, vn)
  kpis.push({
    id: 'arriendo',
    titulo: 'Arriendo / VN',
    valor: arriendoPct,
    formato: 'pct',
    semaforo: semaforoInvertido(arriendoPct, UMBRALES.arriendo_pct),
    sub: `${formatoCLP(arriendo)} arriendos`,
    benchmark: '≤5% sano',
  })

  // 7. Marketing / VN (rango sano)
  const marketingPct = pct(marketing, vn)
  kpis.push({
    id: 'marketing',
    titulo: 'Marketing / VN',
    valor: marketingPct,
    formato: 'pct',
    semaforo: semaforoRango(marketingPct, UMBRALES.marketing_pct),
    sub: `${formatoCLP(marketing)} inversión`,
    benchmark: '1-3% sano',
  })

  // 8. Ventas por empleado (mensual promedio)
  if (dotacionMes && dotacionMes > 0) {
    const ventaPromMes = m > 0 ? (vn / m) : 0
    const ventaPorEmpleado = ventaPromMes / dotacionMes
    kpis.push({
      id: 'venta_empleado',
      titulo: 'VN / Empleado (mes)',
      valor: ventaPorEmpleado,
      formato: 'clp',
      semaforo: ventaPorEmpleado >= 15000000 ? 'verde' : ventaPorEmpleado >= 8000000 ? 'amarillo' : 'rojo',
      sub: `${dotacionMes} trabajadores`,
      benchmark: '≥$15M/empleado',
    })
  }

  return kpis
}

/* ─── Análisis adicionales: ROI, Punto de equilibrio, Productividad, Burn rate ─── */
export function calcularAnalisisAdicionales({ valores, valoresPrev, mesHasta, dotacionMes }) {
  if (!valores) return {}
  const get = c => valores.get(c) ?? new Array(12).fill(0)
  const m = Math.max(1, Math.min(12, mesHasta || 1))

  const vn   = sumHasta(get('VENTA_NETA'), m)
  const cn   = sumHasta(get('COSTO_NETO'), m)
  const mc   = sumHasta(get('MARGEN_CONTRIB'), m)
  const totGastoOper = sumHasta(get('TOTAL_GASTO_OPER'), m)
  const totGastoVen  = sumHasta(get('TOTAL_GASTO_VENTA'), m)
  const totGastoOperativo = sumHasta(get('TOTAL_GASTO_OPERATIVO'), m)
  const resOp  = sumHasta(get('RESULTADO_OPERACIONAL'), m)
  const marketing = sumHasta(get('MARKETING'), m)
  const arriendo  = sumHasta(get('ARRIENDO'), m)
  const remTotal  = ['REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS','REM_PREVIRED']
                    .reduce((s, c) => s + sumHasta(get(c), m), 0)

  // 1. ROI Marketing — Δventa neta vs mes anterior / Δmarketing
  let roiMarketing = null
  if (valoresPrev && marketing > 0) {
    const getP = c => valoresPrev.get(c) ?? new Array(12).fill(0)
    const vnPrev = sumHasta(getP('VENTA_NETA'), m)
    const mkPrev = sumHasta(getP('MARKETING'), m)
    const dVn = vn - vnPrev
    const dMk = marketing - mkPrev
    if (Math.abs(dMk) > 1000) roiMarketing = dVn / dMk
  }

  // 2. Productividad remuneraciones (cuántos $ de venta genera cada $ de planilla)
  const productividadRem = remTotal > 0 ? (vn / remTotal) : 0

  // 3. Punto de equilibrio mensual
  //    Gastos fijos = arriendo + remTotal (aproximación; sin admin variables)
  //    Margen bruto % aplicado al revés: PE = Gastos Fijos / (MC/VN)
  const mesesIncluidos = m
  const gastosFijosMes = mesesIncluidos > 0 ? ((arriendo + remTotal) / mesesIncluidos) : 0
  const margenBrutoPct = pct(mc, vn) / 100
  const puntoEquilibrioMes = margenBrutoPct > 0 ? (gastosFijosMes / margenBrutoPct) : 0

  // 4. Burn rate diario (gastos operativos totales / días transcurridos)
  const diasTranscurridos = m * 30  // aproximación: 30 días por mes
  const gastosTotales = totGastoOper + totGastoVen + totGastoOperativo
  const burnDiario = diasTranscurridos > 0 ? (gastosTotales / diasTranscurridos) : 0

  // 5. Eficiencia operativa: Resultado Op / Total Gastos
  const eficienciaOp = (gastosTotales > 0) ? (resOp / gastosTotales) : 0

  return {
    roiMarketing,
    productividadRem,
    puntoEquilibrioMes,
    burnDiario,
    eficienciaOp,
    gastosFijosMes,
    ventaPromMes: m > 0 ? vn / m : 0,
  }
}

/* ─── Alertas inteligentes ─── 
   Devuelve array de { severidad: 'critica'|'atencion'|'positiva', titulo, detalle, codigo? }
   Severidad ordenable: critica > atencion > positiva.
*/
export function generarAlertas({ valores, valoresPrev, presupuesto, mesHasta, lineasPorCodigo, dotacionPorMes }) {
  if (!valores) return []
  const alertas = []
  const get = c => valores.get(c) ?? new Array(12).fill(0)
  const getP = c => valoresPrev ? (valoresPrev.get(c) ?? new Array(12).fill(0)) : new Array(12).fill(0)
  const m = Math.max(1, Math.min(12, mesHasta || 1))

  const vn       = sumHasta(get('VENTA_NETA'), m)
  const vnPrev   = sumHasta(getP('VENTA_NETA'), m)
  const mc       = sumHasta(get('MARGEN_CONTRIB'), m)
  const mcPrev   = sumHasta(getP('MARGEN_CONTRIB'), m)
  const resOp    = sumHasta(get('RESULTADO_OPERACIONAL'), m)
  const remOp    = sumHasta(get('REM_OPERACION'), m)
  const remVe    = sumHasta(get('REM_VENTA'), m)
  const remAd    = sumHasta(get('REM_ADMIN'), m)
  const remSo    = sumHasta(get('REM_SOCIOS'), m)
  const remPv    = sumHasta(get('REM_PREVIRED'), m)
  const remTotal = remOp + remVe + remAd + remSo + remPv
  const totGastoOperativo = sumHasta(get('TOTAL_GASTO_OPERATIVO'), m)

  const margenBrutoPct = pct(mc, vn)
  const margenBrutoPctPrev = pct(mcPrev, vnPrev)
  const remPctVN = pct(remTotal, vn)

  /* ─── CRÍTICAS ─── */

  // R1: Margen bruto cayó >5pp vs período anterior
  if (valoresPrev && margenBrutoPctPrev > 0 && (margenBrutoPctPrev - margenBrutoPct) >= 5) {
    alertas.push({
      severidad: 'critica',
      titulo: 'Margen bruto cayó significativamente',
      detalle: `De ${margenBrutoPctPrev.toFixed(1)}% a ${margenBrutoPct.toFixed(1)}% (-${(margenBrutoPctPrev - margenBrutoPct).toFixed(1)}pp). Revisar costos de productos o precios.`,
    })
  }

  // R2: Resultado operacional negativo
  if (resOp < 0) {
    alertas.push({
      severidad: 'critica',
      titulo: 'Resultado operacional NEGATIVO',
      detalle: `Pérdida operacional acumulada de ${formatoCLP(Math.abs(resOp))}. El negocio operativo está consumiendo capital.`,
    })
  }

  // R3: Línea de gasto excedió presupuesto en >20%
  if (presupuesto) {
    const presPorCodigo = mapearPresupuesto(presupuesto, m)
    presPorCodigo.forEach(({ codigo, pres, nombre }) => {
      if (pres <= 0) return
      const real = sumHasta(get(codigo), m)
      if (real > pres * 1.2) {
        const excesoPct = ((real - pres) / pres) * 100
        alertas.push({
          severidad: 'critica',
          titulo: `${nombre}: ${excesoPct.toFixed(0)}% sobre presupuesto`,
          detalle: `Real ${formatoCLP(real)} vs presupuesto ${formatoCLP(pres)} (exceso ${formatoCLP(real - pres)}).`,
          codigo,
        })
      }
    })
  }

  // R4: Remuneraciones totales > 25% de VN
  if (vn > 0 && remPctVN > 25) {
    alertas.push({
      severidad: 'critica',
      titulo: `Remuneraciones absorben ${remPctVN.toFixed(1)}% de la venta neta`,
      detalle: `Umbral sano ≤18%. Planilla total ${formatoCLP(remTotal)} sobre VN ${formatoCLP(vn)}. Evaluar productividad o redimensionar dotación.`,
    })
  }

  // R5: Gastos crecen más rápido que ventas
  if (valoresPrev && vnPrev > 0) {
    const gastosActual = totGastoOperativo + remTotal
    const gastosPrev = sumHasta(getP('TOTAL_GASTO_OPERATIVO'), m) +
                       ['REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS','REM_PREVIRED']
                         .reduce((s, c) => s + sumHasta(getP(c), m), 0)
    if (gastosPrev > 0) {
      const tasaVenta = (vn - vnPrev) / vnPrev
      const tasaGasto = (gastosActual - gastosPrev) / gastosPrev
      if (tasaGasto > 0 && tasaGasto > tasaVenta * 1.5 && tasaGasto > 0.1) {
        alertas.push({
          severidad: 'critica',
          titulo: 'Gastos crecen más rápido que ventas',
          detalle: `Gastos +${(tasaGasto * 100).toFixed(1)}% vs ventas ${tasaVenta >= 0 ? '+' : ''}${(tasaVenta * 100).toFixed(1)}%. Riesgo de erosión de margen.`,
        })
      }
    }
  }

  /* ─── ATENCIÓN ─── */

  // R6: Líneas que crecieron >30% mes vs mes (las top 3)
  if (valoresPrev) {
    const crecimientos = []
    const codigosRelevantes = ['MARKETING','REM_VENTA','REM_OPERACION','REM_ADMIN','GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','CUENTAS_BASICAS','GASTOS_TI','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS']
    codigosRelevantes.forEach(codigo => {
      const actual = sumHasta(get(codigo), m)
      const prev = sumHasta(getP(codigo), m)
      if (prev > 100000 && actual > prev * 1.3) {
        const crecPct = ((actual - prev) / prev) * 100
        crecimientos.push({ codigo, crecPct, actual, prev, nombre: lineasPorCodigo?.get(codigo)?.nombre ?? codigo })
      }
    })
    crecimientos.sort((a, b) => b.crecPct - a.crecPct).slice(0, 3).forEach(c => {
      alertas.push({
        severidad: 'atencion',
        titulo: `${c.nombre} creció +${c.crecPct.toFixed(0)}%`,
        detalle: `De ${formatoCLP(c.prev)} a ${formatoCLP(c.actual)}. Verificar si justifica el aumento.`,
        codigo: c.codigo,
      })
    })
  }

  // R7: Una línea consume >15% del gasto total
  const gastosTotalesMonto = totGastoOperativo + remTotal
  if (gastosTotalesMonto > 0) {
    const codigosGasto = ['REM_OPERACION','REM_VENTA','REM_ADMIN','REM_SOCIOS','MARKETING','ARRIENDO','CUENTAS_BASICAS','SERVICIOS_EXTERNOS','TRANSPORTE_VIATICOS','MOBILIARIO']
    codigosGasto.forEach(codigo => {
      const monto = sumHasta(get(codigo), m)
      const peso = monto / gastosTotalesMonto
      if (peso > 0.15 && monto > 5000000) {
        const nombre = lineasPorCodigo?.get(codigo)?.nombre ?? codigo
        alertas.push({
          severidad: 'atencion',
          titulo: `${nombre} concentra ${(peso * 100).toFixed(0)}% del gasto`,
          detalle: `${formatoCLP(monto)} de un gasto total de ${formatoCLP(gastosTotalesMonto)}. Alta dependencia de esta partida.`,
          codigo,
        })
      }
    })
  }

  // R8: Dotación creció rápido (>20% en N meses)
  if (dotacionPorMes && dotacionPorMes.length >= 2) {
    const primera = dotacionPorMes[0]
    const ultima = dotacionPorMes[dotacionPorMes.length - 1]
    if (primera.n > 0 && ultima.n > primera.n * 1.2) {
      const crec = ((ultima.n - primera.n) / primera.n) * 100
      alertas.push({
        severidad: 'atencion',
        titulo: `Dotación creció +${crec.toFixed(0)}% en ${dotacionPorMes.length} meses`,
        detalle: `De ${primera.n} a ${ultima.n} trabajadores. Verificar que el crecimiento de ventas justifique la expansión de planilla.`,
      })
    }
  }

  /* ─── POSITIVAS ─── */

  // P1: Margen mejoró vs período anterior
  if (valoresPrev && margenBrutoPctPrev > 0 && (margenBrutoPct - margenBrutoPctPrev) >= 2) {
    alertas.push({
      severidad: 'positiva',
      titulo: 'Margen bruto mejorando',
      detalle: `De ${margenBrutoPctPrev.toFixed(1)}% a ${margenBrutoPct.toFixed(1)}% (+${(margenBrutoPct - margenBrutoPctPrev).toFixed(1)}pp).`,
    })
  }

  // P2: Resultado operacional positivo
  if (resOp > 0 && pct(resOp, vn) >= 10) {
    alertas.push({
      severidad: 'positiva',
      titulo: 'Resultado operacional sano',
      detalle: `Margen operacional ${pct(resOp, vn).toFixed(1)}% (${formatoCLP(resOp)}). Por encima del 10% de referencia.`,
    })
  }

  // Ordenar por severidad
  const orden = { critica: 0, atencion: 1, positiva: 2 }
  alertas.sort((a, b) => orden[a.severidad] - orden[b.severidad])

  return alertas
}

/* ─── Helper: mapear presupuesto del módulo Presupuesto al motor ─── */
function mapearPresupuesto(presupuesto, m) {
  // presupuesto = array de filas { item, codigo, pres: [12] }
  // Devuelve array { codigo, nombre, pres } sumado hasta mes m
  return presupuesto
    .filter(p => p.codigo)  // ignorar huérfanos
    .map(p => ({
      codigo: p.codigo,
      nombre: p.item,
      pres: sumHasta(p.pres, m),
    }))
}

/* ─── Formato ─── */
function formatoCLP(n) {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
}

export const formato = {
  clp: formatoCLP,
  pct: (n, digits = 1) => `${(n || 0).toFixed(digits)}%`,
  ratio: (n, digits = 2) => (n || 0).toFixed(digits),
  numero: (n) => new Intl.NumberFormat('es-CL').format(Math.round(n || 0)),
}

/* ─── Construir resumen ejecutivo en texto para el botón LLM ─── */
export function construirResumenParaLLM({ kpis, alertas, analisis, anio, mesHasta }) {
  const mesNombre = MESES_ES[mesHasta - 1]
  let txt = `EERR ACUMULADO ${anio} (enero - ${mesNombre}):\n\n`
  txt += 'KPIs:\n'
  kpis.forEach(k => {
    const v = k.formato === 'pct' ? `${k.valor.toFixed(1)}%` : k.formato === 'clp' ? formatoCLP(k.valor) : k.valor
    txt += `- ${k.titulo}: ${v} (${k.semaforo.toUpperCase()}, benchmark ${k.benchmark}). ${k.sub}\n`
  })
  txt += `\nMétricas adicionales:\n`
  txt += `- ROI Marketing: ${analisis.roiMarketing !== null ? analisis.roiMarketing.toFixed(2) + 'x' : 'sin datos suficientes'}\n`
  txt += `- Productividad remuneraciones: ${analisis.productividadRem.toFixed(2)}x (cada $1 de planilla genera $${analisis.productividadRem.toFixed(2)} de venta)\n`
  txt += `- Punto de equilibrio mensual: ${formatoCLP(analisis.puntoEquilibrioMes)}\n`
  txt += `- Burn rate diario: ${formatoCLP(analisis.burnDiario)}\n`
  txt += `- Eficiencia operativa: ${(analisis.eficienciaOp * 100).toFixed(1)}%\n`
  txt += `- Venta promedio mensual: ${formatoCLP(analisis.ventaPromMes)}\n`
  txt += `\nAlertas (${alertas.length}):\n`
  alertas.forEach(a => {
    txt += `- [${a.severidad.toUpperCase()}] ${a.titulo}: ${a.detalle}\n`
  })
  return txt
}
