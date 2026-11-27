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
const menos7 = hoy => { const [y, m, d] = String(hoy).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10) }
// Período actual de trabajo: el período de pago de hace una semana (mismo criterio que
// el período por defecto de las bandejas). Justo después del corte del 25 sigue siendo
// el que se está cerrando, que aún no se paga; desde el día 2 del mes siguiente pasa a
// ser el nuevo. Lo pendiente con fecha anterior es de un período ya pagado: si se
// autoriza, se paga como ajuste en la liquidación siguiente.
export const periodoActualDesde = (hoy = hoyCL()) => inicioPeriodo(menos7(hoy), 0)
// Compatibilidad: la ficha del trabajador marca "período ya pagado" con este nombre
export const periodoAbiertoDesde = periodoActualDesde
