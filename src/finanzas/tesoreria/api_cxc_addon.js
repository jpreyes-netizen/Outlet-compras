// ── Agregar al final de api.js ──────────────────────────────────────────────
// Funciones para módulo CxC (Cuentas por Cobrar)

// Cuadratura mensual desde la vista v_cuadratura_mensual
export async function fetchCuadraturasMes({ anio, mes, sucursal_id } = {}) {
  let q = supabase.from('v_cuadratura_mensual').select('*')
  if (anio)       q = q.eq('anio', anio)
  if (mes)        q = q.eq('mes', mes)
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// Cuadratura anual desde la vista v_cuadratura_anual
export async function fetchCuadraturasAnio({ anio, sucursal_id } = {}) {
  let q = supabase.from('v_cuadratura_anual').select('*')
  if (anio)        q = q.eq('anio', anio)
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// Saldos vigentes por cliente
export async function fetchSaldosClientes({ sucursal_id } = {}) {
  let q = supabase.from('v_saldos_clientes').select('*').order('saldo_actual', { ascending: false })
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// Movimientos CxC — detalle por cliente o por período
export async function fetchMovimientosCxc({ sucursal_id, cliente_rut, anio, mes, cierre_id } = {}) {
  let q = supabase.from('cxc_movimientos').select('*').order('fecha', { ascending: false }).order('created_at', { ascending: false })
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  if (cliente_rut) q = q.eq('cliente_rut', cliente_rut)
  if (anio)        q = q.eq('anio', anio)
  if (mes)         q = q.eq('mes', mes)
  if (cierre_id)   q = q.eq('cierre_id', cierre_id)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// Insertar movimiento CxC manual
export async function insertMovimientoCxc(row) {
  const uid = (await supabase.auth.getSession()).data.session?.user.id
  const { data, error } = await supabase.from('cxc_movimientos')
    .insert({ ...row, registrado_por: uid })
    .select('*').single()
  if (error) throw error
  return data
}
