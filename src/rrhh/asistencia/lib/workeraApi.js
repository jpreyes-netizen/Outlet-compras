// src/rrhh/asistencia/lib/workeraApi.js
// Invocación de la Edge Function workera-sync.
// Usa fetch directo para evitar problemas con supabase.functions.invoke()
// en clientes viejos o con configuración rara de CORS.

import { supabase } from '../../../supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Llama a la Edge Function workera-sync con la acción solicitada.
 * @param {string} action - test_credenciales | sync_catalogos | sync_empleados
 *                          | sync_marcaciones | sync_permisos | sync_hhee
 * @param {object} params - parámetros adicionales (desde, hasta, etc)
 * @returns {Promise<object>} respuesta de la Edge Function
 */
export async function callWorkera(action, params = {}) {
  // Obtener el token de sesión si existe (para verify_jwt si está activo)
  let authToken = SUPABASE_ANON_KEY
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) authToken = session.access_token
  } catch {
    // sin sesión, usar anon key
  }

  const url = `${SUPABASE_URL}/functions/v1/workera-sync`
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...params })
    })
  } catch (e) {
    throw new Error('Error de red invocando Edge Function: ' + e.message)
  }

  // Intentar parsear respuesta como JSON
  let data
  const text = await response.text()
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`Edge Function respondió con texto no-JSON (status ${response.status}): ${text.slice(0, 200)}`)
  }

  if (!response.ok) {
    const msg = data?.error || data?.message || `HTTP ${response.status}`
    throw new Error(msg)
  }

  return data
}

// Conveniencia: formatea fecha YYYY-MM-DD desde Date o string
export function ymd(d) {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 10)
  const dd = new Date(d)
  const y = dd.getFullYear()
  const m = String(dd.getMonth() + 1).padStart(2, '0')
  const day = String(dd.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Rango "últimos N días" relativo a hoy
export function rangoUltimosNDias(n) {
  const hasta = new Date()
  const desde = new Date()
  desde.setDate(desde.getDate() - n)
  return { desde: ymd(desde), hasta: ymd(hasta) }
}
