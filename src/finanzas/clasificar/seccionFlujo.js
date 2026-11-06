// Sección de flujo (criterio NIC 7) de un movimiento bancario, según la cuenta contable de su subcuenta.
// Naturaleza = cuenta de la factura que paga (plan_cuenta_factura); si no tiene, su cuenta contable
// (plan_cuenta_codigo) o la de su cuenta madre.
//   traspaso       → cuenta madre tipo 'traspaso' (entre cuentas propias): fuera del análisis
//   tarjeta        → pago de la tarjeta de crédito (2310102): se reemplaza por el detalle de los estados de cuenta
//   financiamiento → créditos e intereses (cuenta madre tipo 'financiamiento', 231xxxx, 621xxxx)
//   inversion      → activo fijo (13xxxxx) y préstamos otorgados al personal (11501xx; el anticipo de sueldo 1150201 es operación)
//   operacion      → todo lo demás (incluye nómina y pagos a proveedores: son el costo de operar)
export function naturalezaSubcuenta(sub, madre) {
  return sub?.plan_cuenta_factura || sub?.plan_cuenta_codigo || madre?.plan_cuenta_codigo || ''
}

export function seccionPorCuenta(cuenta, tipoMadre) {
  if (tipoMadre === 'traspaso') return 'traspaso'
  const c = String(cuenta ?? '')
  if (c === '2310102') return 'tarjeta'
  if (tipoMadre === 'financiamiento' || c.startsWith('231') || c.startsWith('621')) return 'financiamiento'
  if (c.startsWith('13') || c.startsWith('11501')) return 'inversion'
  return 'operacion'
}

export const SECCIONES = [
  { k: 'operacion', nombre: 'Operación' },
  { k: 'inversion', nombre: 'Inversión (activo fijo y préstamos otorgados)' },
  { k: 'financiamiento', nombre: 'Financiamiento (créditos e intereses)' },
]
