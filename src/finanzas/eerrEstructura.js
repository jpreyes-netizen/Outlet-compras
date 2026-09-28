/* ══════════════════════════════════════════════════════════════════════
   ESTRUCTURA ÚNICA DEL EERR — Fase 2 "una sola verdad" (28-sep-2026)
   Única definición de bloques y subtotales (margen, EBITDA, EBIT, RAI,
   resultado neto). La usan EerrFormal.jsx y FinPresupuesto.jsx: si una
   regla cambia, cambia aquí y en ninguna otra parte.
   Las líneas se toman del maestro eerr_lineas (activo_devengo = true),
   así una línea nueva entra sola a su bloque.
   El control SQL v_ctrl_eerr_cuadratura verifica en el servidor que
   estas líneas sumen exactamente el resultado del libro mayor.
   ══════════════════════════════════════════════════════════════════════ */

// Líneas financieras que no son gasto financiero del período
const FUERA_DE_FINANCIERO = ['IMPUESTO_RENTA', 'OTROS_INGRESOS', 'IVA_SII']

// Movimientos de plata: se muestran como información, nunca afectan el resultado
export const CODIGOS_INFORMATIVOS = new Set([
  'MP_IMPORTACION', 'MP_REPOSICION', 'MP_INVERSION', 'MP_TRANSPORTES', 'MP_CREDITOS', 'TOTAL_MP', 'IVA_SII',
])

/** Agrupa las líneas del maestro en los bloques del estado. */
export function bloquesEerr(lineas) {
  const lin = sec => lineas
    .filter(l => l.seccion === sec && !l.es_subtotal && l.activo_devengo !== false)
    .map(l => l.codigo)
  return {
    oper: lin('operacion'),
    venta: lin('venta'),
    admin: lin('admin').filter(c => c !== 'DEPRECIACION'),
    fin: lin('financiero').filter(c => !FUERA_DE_FINANCIERO.includes(c)),
  }
}

/** Subtotales de un mes. val(codigo, mesIdx) entrega el monto positivo de la línea. */
export function totalesEerr(bloques, val, i) {
  const suma = cods => cods.reduce((s, c) => s + Number(val(c, i) || 0), 0)
  const ventaTotal = Number(val('VENTA_NETA', i) || 0) + Number(val('VENTA_SIN_DOC', i) || 0)
  const margen = ventaTotal - Number(val('COSTO_NETO', i) || 0)
  const gOper = suma(bloques.oper)
  const gVenta = suma(bloques.venta)
  const gAdmin = suma(bloques.admin)
  const ebitda = margen - gOper - gVenta - gAdmin
  const ebit = ebitda - Number(val('DEPRECIACION', i) || 0)
  const rai = ebit + Number(val('OTROS_INGRESOS', i) || 0) - suma(bloques.fin)
  const neto = rai - Number(val('IMPUESTO_RENTA', i) || 0)
  return {
    VENTA_TOTAL: ventaTotal,
    MARGEN_CONTRIB: margen,
    TOTAL_GASTO_OPER: gOper,
    TOTAL_MARGEN_BRUTO: margen - gOper,
    TOTAL_GASTO_VENTA: gVenta,
    TOTAL_GASTO_OPERATIVO: gAdmin,
    EBITDA: ebitda,
    RESULTADO_OPERACIONAL: ebit,
    RAI: rai,
    RESULTADO_NETO: neto,
  }
}

/** Fórmulas legibles para mostrar en los detalles. */
export const FORMULAS_EERR = {
  MARGEN_CONTRIB: 'Venta neta + venta sin documento − costo de ventas',
  TOTAL_GASTO_OPER: 'Remuneraciones de operación + mermas + diferencias de inventario',
  TOTAL_MARGEN_BRUTO: 'Margen bruto − gasto de operación',
  TOTAL_GASTO_VENTA: 'Remuneraciones de venta + marketing + comisiones de medios de pago',
  TOTAL_GASTO_OPERATIVO: 'Suma de los gastos de administración (sin depreciación)',
  EBITDA: 'Margen − operación − venta − administración',
  RESULTADO_OPERACIONAL: 'EBITDA − depreciación',
  RAI: 'Resultado operacional + otros ingresos − gastos financieros',
  RESULTADO_NETO: 'Resultado antes de impuesto − provisión de impuesto a la renta',
}
