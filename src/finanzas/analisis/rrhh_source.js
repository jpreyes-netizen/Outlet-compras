import { supabase } from '../../supabase'

/* ═══ FUENTE RRHH PARA EERR ═══
   Reemplaza el cálculo de las 4 líneas REM_* del EERR usando RRHH como
   fuente de verdad (devengado), en vez de movimientos_bancarios (pagado).

   Fórmula por mes y línea EERR:
     costo[mes][REM_X] = haberes_de_la_linea[mes]
                       + aporte_patronal_prorrateado[mes][REM_X]

   donde:
     haberes_de_la_linea = SUM(v_rrhh_master.monto)
                          WHERE periodo=mes
                            AND cuenta_madre_codigo=mapping[REM_X]
                            AND naturaleza IN ('haber_imponible',
                                               'haber_no_imponible',
                                               'honorario')
     aporte_patronal_prorrateado[mes][REM_X] =
        v_rrhh_costo_empresa.total_aportes_patronales[mes]
        × (haberes_imponibles[mes][REM_X] / haberes_imponibles_total[mes])

   Validación matemática (asserción interna):
     suma_4_lineas[mes] ≈ v_rrhh_costo_empresa.total_costo_empresa[mes]
*/

/* Mapeo cuenta_madre_codigo de RRHH → código de línea EERR */
export const MAP_CUENTA_MADRE_RRHH_EERR = {
  '600': 'REM_OPERACION',
  '610': 'REM_VENTA',
  '760': 'REM_ADMIN',
  '761': 'REM_SOCIOS',
}

/* Códigos REM_* que el motor RRHH gobierna. REM_PREVIRED se elimina. */
export const CODIGOS_REM_RRHH = ['REM_OPERACION', 'REM_VENTA', 'REM_ADMIN', 'REM_SOCIOS']

/* Naturalezas que SUMAN al costo (descuentos NO suman) */
const NATURALEZAS_HABER = new Set(['haber_imponible', 'haber_no_imponible', 'honorario'])

/* Solo haberes IMPONIBLES son base de cálculo de aportes patronales */
const NATURALEZAS_IMPONIBLES = new Set(['haber_imponible'])

const PAGE = 1000

async function fetchAllPaged(table, columns, filters) {
  const all = []
  let from = 0
  while (true) {
    let q = supabase.from(table).select(columns)
    for (const [op, col, val] of filters) {
      if (op === 'gte') q = q.gte(col, val)
      else if (op === 'lte') q = q.lte(col, val)
      else if (op === 'like') q = q.like(col, val)
      else if (op === 'eq') q = q.eq(col, val)
    }
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data ?? []))
    if ((data ?? []).length < PAGE) break
    from += PAGE
  }
  return all
}

/* Convierte 'YYYY-MM' a índice 0..11 */
const periodoAMesIdx = p => {
  if (!p) return null
  const partes = p.split('-')
  if (partes.length < 2) return null
  const m = parseInt(partes[1], 10)
  return (m >= 1 && m <= 12) ? (m - 1) : null
}

/* ─── Función principal: calcula REM_* desde RRHH para un año ─── */
export async function fetchRrhhValores(anio) {
  // 1. Traer todo v_rrhh_master del año
  const master = await fetchAllPaged(
    'v_rrhh_master',
    'periodo, cuenta_madre_codigo, naturaleza, monto',
    [['gte', 'periodo', `${anio}-01`], ['lte', 'periodo', `${anio}-12`]]
  )

  // 2. Traer v_rrhh_costo_empresa del año (para aportes patronales mes a mes)
  const { data: costoEmp, error: ceErr } = await supabase
    .from('v_rrhh_costo_empresa')
    .select('periodo, total_aportes_patronales, total_costo_empresa, total_haberes, total_honorarios')
    .gte('periodo', `${anio}-01`)
    .lte('periodo', `${anio}-12`)
  if (ceErr) throw new Error('v_rrhh_costo_empresa: ' + ceErr.message)

  /* 3. Agregar haberes por (mes, codigo_eerr) */
  // haberes[codigo_eerr] = number[12]  — todos los haberes (imponibles + no imp + honorarios)
  const haberes = new Map()
  // imponibles[codigo_eerr] = number[12]  — solo haberes imponibles (base aportes)
  const imponibles = new Map()
  CODIGOS_REM_RRHH.forEach(c => {
    haberes.set(c, new Array(12).fill(0))
    imponibles.set(c, new Array(12).fill(0))
  })

  master.forEach(row => {
    const mesIdx = periodoAMesIdx(row.periodo)
    if (mesIdx === null) return
    const codigoEerr = MAP_CUENTA_MADRE_RRHH_EERR[String(row.cuenta_madre_codigo)]
    if (!codigoEerr) return  // cuenta_madre fuera de scope
    const monto = Number(row.monto ?? 0)
    if (NATURALEZAS_HABER.has(row.naturaleza)) {
      haberes.get(codigoEerr)[mesIdx] += monto
    }
    if (NATURALEZAS_IMPONIBLES.has(row.naturaleza)) {
      imponibles.get(codigoEerr)[mesIdx] += monto
    }
  })

  /* 4. Prorratear aportes patronales por mes según peso de haberes imponibles */
  // aportesPorLinea[codigo_eerr] = number[12]
  const aportesPorLinea = new Map()
  CODIGOS_REM_RRHH.forEach(c => aportesPorLinea.set(c, new Array(12).fill(0)))

  ;(costoEmp ?? []).forEach(row => {
    const mesIdx = periodoAMesIdx(row.periodo)
    if (mesIdx === null) return
    const totalAportes = Number(row.total_aportes_patronales ?? 0)
    if (totalAportes <= 0) return
    // Total imponible del mes (sumando las 4 líneas)
    const totalImponibleMes = CODIGOS_REM_RRHH.reduce(
      (acc, c) => acc + (imponibles.get(c)[mesIdx] || 0), 0
    )
    if (totalImponibleMes <= 0) {
      // Fallback: si no hay imponibles, prorratear por peso de haberes totales
      const totalHaberMes = CODIGOS_REM_RRHH.reduce(
        (acc, c) => acc + (haberes.get(c)[mesIdx] || 0), 0
      )
      if (totalHaberMes <= 0) return
      CODIGOS_REM_RRHH.forEach(c => {
        const peso = haberes.get(c)[mesIdx] / totalHaberMes
        aportesPorLinea.get(c)[mesIdx] = totalAportes * peso
      })
    } else {
      CODIGOS_REM_RRHH.forEach(c => {
        const peso = imponibles.get(c)[mesIdx] / totalImponibleMes
        aportesPorLinea.get(c)[mesIdx] = totalAportes * peso
      })
    }
  })

  /* 5. Combinar: costoEmpresaPorLinea[REM_X][mes] = haberes + aportes prorrateados */
  const valoresRrhh = new Map()
  CODIGOS_REM_RRHH.forEach(c => {
    const arr = new Array(12).fill(0)
    for (let i = 0; i < 12; i++) {
      arr[i] = haberes.get(c)[i] + aportesPorLinea.get(c)[i]
    }
    valoresRrhh.set(c, arr)
  })

  /* 6. Validación matemática: suma 4 líneas vs total_costo_empresa por mes */
  const validacion = []
  ;(costoEmp ?? []).forEach(row => {
    const mesIdx = periodoAMesIdx(row.periodo)
    if (mesIdx === null) return
    const sumaCalc = CODIGOS_REM_RRHH.reduce(
      (acc, c) => acc + valoresRrhh.get(c)[mesIdx], 0
    )
    const totalReal = Number(row.total_costo_empresa ?? 0)
    const dif = sumaCalc - totalReal
    const difPct = totalReal > 0 ? (dif / totalReal) * 100 : 0
    validacion.push({
      mes: mesIdx + 1,
      sumaCalculada: Math.round(sumaCalc),
      totalCostoEmpresa: Math.round(totalReal),
      diferencia: Math.round(dif),
      difPct: Number(difPct.toFixed(2)),
    })
  })

  return {
    valoresRrhh,
    haberes,
    imponibles,
    aportesPorLinea,
    costoEmpresa: costoEmp ?? [],
    validacion,
  }
}

/* ─── Mergear RRHH sobre los valores del EERR original ───
   Sobrescribe COMPLETAMENTE las 4 líneas REM_* en el Map valoresEERR.
   Recalcula los subtotales que dependen de remuneraciones.
*/
export function mergeRrhhSobreEerr(valoresEERR, valoresRrhh) {
  if (!valoresEERR || !valoresRrhh) return valoresEERR

  // 1. Sobrescribir las 4 líneas
  CODIGOS_REM_RRHH.forEach(c => {
    valoresEERR.set(c, [...valoresRrhh.get(c)])
  })

  // 2. Cero REM_PREVIRED (ya desactivado en BD pero si quedara cargado, anularlo)
  if (valoresEERR.has('REM_PREVIRED')) {
    valoresEERR.set('REM_PREVIRED', new Array(12).fill(0))
  }

  // 3. Recalcular subtotales que dependen de REM_*
  const get = c => valoresEERR.get(c) ?? new Array(12).fill(0)
  const sumCodes = (codes, i) => codes.reduce((acc, c) => acc + (get(c)?.[i] ?? 0), 0)

  for (let i = 0; i < 12; i++) {
    // TOTAL_GASTO_OPER = REM_OPERACION (mismo en motor original)
    get('TOTAL_GASTO_OPER')[i] = get('REM_OPERACION')[i]
    // TOTAL_MARGEN_BRUTO = MARGEN_CONTRIB - TOTAL_GASTO_OPER
    get('TOTAL_MARGEN_BRUTO')[i] = get('MARGEN_CONTRIB')[i] - get('TOTAL_GASTO_OPER')[i]
    // TOTAL_GASTO_VENTA = REM_VENTA + MARKETING + COMISION_GETNET
    get('TOTAL_GASTO_VENTA')[i] = get('REM_VENTA')[i] + get('MARKETING')[i] + get('COMISION_GETNET')[i]
    // TOTAL_GASTO_OPERATIVO: incluye REM_ADMIN, REM_SOCIOS (REM_PREVIRED ahora siempre 0)
    get('TOTAL_GASTO_OPERATIVO')[i] = sumCodes([
      'GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS',
      'COMBUSTIBLE','REM_ADMIN','REM_SOCIOS','FINIQUITOS','GASTOS_TI',
      'OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS','REM_PREVIRED'
    ], i)
    // RESULTADO_OPERACIONAL recalculado
    get('RESULTADO_OPERACIONAL')[i] = get('TOTAL_MARGEN_BRUTO')[i] - get('TOTAL_GASTO_VENTA')[i] - get('TOTAL_GASTO_OPERATIVO')[i]
    // RESULTADO_FINAL recalculado
    get('RESULTADO_FINAL')[i] = get('RESULTADO_OPERACIONAL')[i] - get('INTERES_CREDITOS')[i] - get('IMPUESTOS')[i] - get('TOTAL_MP')[i]
  }

  return valoresEERR
}

/* ─── Comparador: RRHH devengado vs Banco pagado ───
   Devuelve para cada línea REM_* y cada mes: { rrhh, banco, diferencia, difPct }
   `valoresBanco` = valores ORIGINALES del EERR (antes del merge) — el caller
   debe haberlos guardado antes de mergear.
*/
export function compararRrhhVsBanco(valoresRrhh, valoresBancoOriginales) {
  if (!valoresRrhh || !valoresBancoOriginales) return []
  const out = []
  CODIGOS_REM_RRHH.forEach(codigo => {
    const rrhhArr = valoresRrhh.get(codigo) ?? new Array(12).fill(0)
    const bancoArr = valoresBancoOriginales.get(codigo) ?? new Array(12).fill(0)
    const fila = { codigo, rrhh: rrhhArr.slice(), banco: bancoArr.slice() }
    fila.diferencia = rrhhArr.map((v, i) => v - (bancoArr[i] || 0))
    fila.difPct = rrhhArr.map((v, i) => {
      const b = bancoArr[i] || 0
      if (Math.abs(b) < 1) return null
      return ((v - b) / Math.abs(b)) * 100
    })
    out.push(fila)
  })
  return out
}
