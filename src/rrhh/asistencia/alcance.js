// src/rrhh/asistencia/alcance.js
// ═══════════════════════════════════════════════════════════════════════════
// ALCANCE DE ASISTENCIA (fase 5 · 01-oct-2026)
// Fuente única: fn_asis_mi_alcance() en la BD = equipo del organigrama
// (v_org_equipo) + respaldo: trabajadores SIN cargo asignado de la propia
// sucursal/área (para que nadie quede sin jefatura mientras se completa el
// organigrama). Reemplaza el filtro por sucursal + expresión regular de área.
//   · scopeCods = null  → sin restricción (dirección / Gestión de Personas)
//   · scopeCods = []    → restringido sin equipo: no ve a nadie (falla cerrado)
//   · scopeCods = [..]  → solo esos trabajadores, estén en la sucursal que estén
// ═══════════════════════════════════════════════════════════════════════════

// Aplica el alcance a una consulta de Supabase sobre una tabla con cod_contaline
// y sucursal_id. Con equipo definido manda el equipo; sin él, la sucursal.
export function aplicarAlcance(q, scopeSuc, scopeCods) {
  if (Array.isArray(scopeCods)) return q.in('cod_contaline', scopeCods.length ? scopeCods : [-1])
  if (scopeSuc) return q.eq('sucursal_id', scopeSuc)
  return q
}

// Filtro en memoria equivalente (para filas ya cargadas)
export function enAlcance(scopeCods) {
  if (!Array.isArray(scopeCods)) return () => true
  const s = new Set(scopeCods)
  return r => s.has(Number(r.cod_contaline))
}
