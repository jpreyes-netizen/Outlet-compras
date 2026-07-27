// ════════════════════════════════════════════════════════════════════
// gm_saldos.js — Fuente única de verdad para la cadena de saldos GM
// ════════════════════════════════════════════════════════════════════
// REGLA: cualquier operación que altere montos (crear, editar, validar,
// rechazar, eliminar) DEBE terminar llamando a recalcularCadena().
// Nunca ajustar saldo_actual con deltas parciales — eso desincroniza
// la columna saldo_post de los movimientos.
//
// Orden canónico de la cadena: fecha, created_at, id
// (el desempate por id es obligatorio: los movimientos migrados en
// batch comparten created_at).
//
// Los movimientos con afecta_saldo=false (rechazados) NO suman ni
// restan: su saldo_post repite el saldo previo.
// ════════════════════════════════════════════════════════════════════
import { supabase } from '../../supabase'

/**
 * Recalcula la cadena completa de saldo_post de un fondo y alinea
 * gm_fondos.saldo_actual con el último saldo de la cadena.
 *
 * @param {string} fondoId - uuid del fondo
 * @returns {Promise<{ok: boolean, saldoFinal?: number, actualizados?: number, error?: string}>}
 */
export async function recalcularCadena(fondoId) {
  try {
    // 1) Saldo inicial del fondo (offset base de la cadena)
    const { data: fondo, error: eF } = await supabase
      .from('gm_fondos')
      .select('id, saldo_inicial')
      .eq('id', fondoId)
      .single()
    if (eF) throw eF

    // 2) Todos los movimientos en orden canónico
    const { data: movs, error: eM } = await supabase
      .from('gm_movimientos')
      .select('id, tipo, monto, saldo_post, afecta_saldo')
      .eq('fondo_id', fondoId)
      .order('fecha', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(10000)
    if (eM) throw eM

    // 3) Acumular desde saldo_inicial; rechazados no afectan
    let acum = fondo.saldo_inicial || 0
    const updates = []
    for (const m of (movs || [])) {
      if (m.afecta_saldo !== false) {
        acum += m.tipo === 'ingreso' ? m.monto : -m.monto
      }
      if (m.saldo_post !== acum) {
        updates.push({ id: m.id, saldo_post: acum })
      }
    }

    // 4) Actualizar solo los que cambiaron
    for (const u of updates) {
      const { error } = await supabase
        .from('gm_movimientos')
        .update({ saldo_post: u.saldo_post })
        .eq('id', u.id)
      if (error) throw error
    }

    // 5) Alinear el saldo del fondo con el final de la cadena
    const { error: eU } = await supabase
      .from('gm_fondos')
      .update({ saldo_actual: acum, updated_at: new Date().toISOString() })
      .eq('id', fondoId)
    if (eU) throw eU

    return { ok: true, saldoFinal: acum, actualizados: updates.length }
  } catch (e) {
    console.error('recalcularCadena:', e)
    return { ok: false, error: e.message || 'desconocido' }
  }
}
