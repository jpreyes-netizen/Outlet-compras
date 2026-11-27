// src/rrhh/asistencia/lib/pendientes.js
// ═══════════════════════════════════════════════════════════════════════════
// VENTANA ÚNICA DE PENDIENTES (27-11-2026)
// Qué cuenta como "por decidir" en toda la app: lo pendiente de los TRES
// últimos períodos de pago (el actual y los dos anteriores, corte 26–25).
// Lo que se autoriza de un período ya pagado se paga como ajuste del mes
// siguiente (glosas "mes anterior" de la liquidación), por eso sigue vigente.
// Lo anterior es historia previa al flujo de validación y no se mezcla.
// La usan: el contador "Por validar" del menú, la bandeja de horas extra (aviso
// de pendientes en períodos anteriores), Trabajo fuera de turno y la ficha del
// trabajador. Antes cada pantalla tenía su propia ventana (un período, 60 días,
// desde el 26 del mes −2) y un pendiente podía quedar invisible en todas.
// ═══════════════════════════════════════════════════════════════════════════
export const hoyCL = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const inicioPeriodo = (hoy, atras) => {
  const [y, m, d] = String(hoy).slice(0, 10).split('-').map(Number)
  const finIdx = d >= 26 ? m : m - 1          // mes (base 0) en que termina el período vigente
  return new Date(Date.UTC(y, finIdx - 1 - atras, 26)).toISOString().slice(0, 10)
}
// Desde cuándo un pendiente sigue vigente (inicio del antepenúltimo período)
export const pendientesDesde = (hoy = hoyCL()) => inicioPeriodo(hoy, 2)
// Inicio del período anterior al vigente: antes de esta fecha el período ya se pagó
// (mismo criterio que fn_periodo_pago_ventana_desde en la base)
export const periodoAbiertoDesde = (hoy = hoyCL()) => inicioPeriodo(hoy, 1)
