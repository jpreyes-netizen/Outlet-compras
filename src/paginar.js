// src/rrhh/asistencia/lib/paginar.js
// ═══════════════════════════════════════════════════════════════════════════
// LECTURA COMPLETA DE UNA CONSULTA (26-11-2026)
// La API de Supabase entrega como máximo "Max Rows" filas por respuesta (1.000
// por defecto) aunque se pida .limit(20000): el resto se pierde en silencio.
// Ejemplo real: un período de pago tiene ≈1.450 decisiones de horas extra; sin
// paginar, ≈450 días ya decididos aparecían "por decidir".
// armar: () => consulta nueva sin .range()/.limit() (se llama una vez por página)
// orden: columnas que dan un orden ÚNICO y estable ('col' ascendente o
//        ['col', false] descendente); sin orden único una página puede repetir
//        o saltarse filas.
// Sigue pidiendo hasta recibir una página vacía, así funciona con cualquier tope.
// ═══════════════════════════════════════════════════════════════════════════
export async function traerTodas(armar, orden = [], { pagina = 1000, maxPaginas = 300 } = {}) {
  const out = []
  for (let desde = 0, n = 0; n < maxPaginas; n++) {
    let q = armar()
    for (const o of orden) {
      const [col, asc] = Array.isArray(o) ? o : [o, true]
      q = q.order(col, { ascending: asc !== false })
    }
    const { data, error } = await q.range(desde, desde + pagina - 1)
    if (error) throw error
    if (!data || !data.length) return out
    out.push(...data)
    desde += data.length
  }
  throw new Error('La consulta supera el máximo de páginas previsto; acota el rango de fechas.')
}

// Igual que traerTodas, pero con la forma { data, error } de una consulta normal
export const traerTodasRes = (armar, orden, opts) =>
  traerTodas(armar, orden, opts).then(data => ({ data, error: null }), error => ({ data: null, error }))
