import { supabase } from '../../supabase'
import { UMBRALES_DEFAULT, MEDIOS } from './types'

export async function fetchSucursales() {
  const { data, error } = await supabase.from('sucursales').select('id, nombre').order('nombre')
  if (error) throw error
  return data ?? []
}

export async function fetchUmbrales() {
  const { data, error } = await supabase.from('parametros_sistema').select('clave, valor').in('clave', ['tesoreria_umbral_cuadra', 'tesoreria_umbral_tolerable'])
  if (error) return UMBRALES_DEFAULT
  const map = new Map()
  for (const r of data ?? []) { const n = Number(r.valor); if (Number.isFinite(n)) map.set(r.clave, n) }
  return {
    cuadra: map.get('tesoreria_umbral_cuadra') ?? UMBRALES_DEFAULT.cuadra,
    tolerable: map.get('tesoreria_umbral_tolerable') ?? UMBRALES_DEFAULT.tolerable,
  }
}

export async function fetchCierreDelDia(vendedorId, fecha) {
  const { data, error } = await supabase.from('cierres_caja').select('*').eq('vendedor_id', vendedorId).eq('fecha', fecha).neq('estado', 'anulado').maybeSingle()
  if (error) throw error
  return data ?? null
}

export async function fetchVentaBsale(fecha, sucursal_id, vendedor_id) {
  const { data, error } = await supabase.from('ventas_bsale').select('total_venta').eq('fecha', fecha).eq('sucursal_id', sucursal_id).eq('vendedor_id', vendedor_id)
  if (error) { console.warn('[ventas_bsale]', error.message); return null }
  const rows = data ?? []
  if (rows.length === 0) return 0
  return rows.reduce((s, r) => s + Number(r.total_venta ?? 0), 0)
}

export async function declararCierre(p) {
  const uid = (await supabase.auth.getSession()).data.session?.user.id
  if (!uid) throw new Error('Sesión no encontrada')
  const row = buildRow(p, uid)
  const { data, error } = await supabase.from('cierres_caja').insert(row).select('*').single()
  if (error) throw error
  return data
}

export async function actualizarDeclaracion(id, p) {
  const uid = (await supabase.auth.getSession()).data.session?.user.id
  if (!uid) throw new Error('Sesión no encontrada')
  const row = buildRow(p, uid)
  const { data, error } = await supabase.from('cierres_caja').update(row).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

function buildRow(p, uid) {
  return {
    fecha: p.fecha, sucursal_id: p.sucursal_id, vendedor_id: p.vendedor_id,
    estado: 'declarado', declarado_at: new Date().toISOString(), declarado_por: uid,
    venta_bsale_api: p.venta_bsale_api, observaciones_vendedor: p.observaciones_vendedor,
    efectivo: p.efectivo ?? 0, t_credito: p.t_credito ?? 0, t_debito: p.t_debito ?? 0,
    webpay: p.webpay ?? 0, transferencia: p.transferencia ?? 0, m_pago: p.m_pago ?? 0,
    abono_cliente: p.abono_cliente ?? 0, canje: p.canje ?? 0, p_clay: p.p_clay ?? 0, cheque: p.cheque ?? 0,
  }
}

export async function corroborarCierre(p) {
  const uid = (await supabase.auth.getSession()).data.session?.user.id
  if (!uid) throw new Error('Sesión no encontrada')
  const { id, ...rest } = p
  const { data, error } = await supabase.from('cierres_caja').update({ ...rest, corroborado_at: new Date().toISOString(), admin_id: uid }).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

export async function fetchCierres(filtros) {
  let q = supabase.from('cierres_caja')
    .select('*, vendedor:usuarios!cierres_caja_vendedor_id_fkey(nombre), sucursal:sucursales(nombre)')
    .order('fecha', { ascending: false })
  if (filtros.sucursal_id) q = q.eq('sucursal_id', filtros.sucursal_id)
  if (filtros.vendedor_id) q = q.eq('vendedor_id', filtros.vendedor_id)
  if (filtros.fecha_desde) q = q.gte('fecha', filtros.fecha_desde)
  if (filtros.fecha_hasta) q = q.lte('fecha', filtros.fecha_hasta)
  if (filtros.estados && filtros.estados.length > 0) q = q.in('estado', filtros.estados)
  const { data, error } = await q
  if (error) {
    // fallback sin joins
    let q2 = supabase.from('cierres_caja').select('*').order('fecha', { ascending: false })
    if (filtros.sucursal_id) q2 = q2.eq('sucursal_id', filtros.sucursal_id)
    if (filtros.fecha_desde) q2 = q2.gte('fecha', filtros.fecha_desde)
    if (filtros.fecha_hasta) q2 = q2.lte('fecha', filtros.fecha_hasta)
    if (filtros.estados && filtros.estados.length > 0) q2 = q2.in('estado', filtros.estados)
    const { data: d2, error: e2 } = await q2
    if (e2) throw e2
    return (d2 ?? []).map(c => ({ ...c, vendedor_nombre: null, sucursal_nombre: null }))
  }
  return (data ?? []).map(r => ({
    ...r,
    vendedor_nombre: r.vendedor?.nombre ?? null,
    sucursal_nombre: r.sucursal?.nombre ?? null,
  }))
}

export async function fetchDepositosEfectivo(filtros) {
  let q = supabase.from('depositos_efectivo').select('*').order('fecha', { ascending: false })
  if (filtros.sucursal_id) q = q.eq('sucursal_id', filtros.sucursal_id)
  if (filtros.desde) q = q.gte('fecha', filtros.desde)
  if (filtros.hasta) q = q.lte('fecha', filtros.hasta)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function fetchAbonos(tabla, filtros) {
  let q = supabase.from(tabla).select('*').order('fecha', { ascending: false })
  if (filtros.sucursal_id) q = q.eq('sucursal_id', filtros.sucursal_id)
  if (filtros.desde) q = q.gte('fecha', filtros.desde)
  if (filtros.hasta) q = q.lte('fecha', filtros.hasta)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function insertGenerico(tabla, payload) {
  const uid = (await supabase.auth.getSession()).data.session?.user.id
  const row = uid ? { ...payload, registrado_por: uid } : payload
  const { error } = await supabase.from(tabla).insert(row)
  if (error) throw error
}

export async function fetchKpisMes({ anio, mes, sucursal_id }) {
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
  const fin = new Date(anio, mes, 0)
  const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`

  const sumCol = async (tabla, col) => {
    let q = supabase.from(tabla).select(col).gte('fecha', desde).lte('fecha', hasta)
    if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
    const { data, error } = await q
    if (error) return 0
    return (data ?? []).reduce((s, r) => s + Number(r[col] ?? 0), 0)
  }

  const sumVentas = async () => {
    let q = supabase.from('ventas_bsale').select('total_venta').gte('fecha', desde).lte('fecha', hasta)
    if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
    const { data, error } = await q
    if (error) return 0
    return (data ?? []).reduce((s, r) => s + Number(r.total_venta ?? 0), 0)
  }

  const fetchCierresMes = async () => {
    let q = supabase.from('cierres_caja').select('estado, diferencia').gte('fecha', desde).lte('fecha', hasta)
    if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
    const { data, error } = await q
    if (error) return []
    return data ?? []
  }

  const [ventasBsale, cierres, dep, gn, wp] = await Promise.all([
    sumVentas(),
    fetchCierresMes(),
    sumCol('depositos_efectivo', 'monto_depositado'),
    sumCol('abonos_getnet', 'total_abono'),
    sumCol('abonos_webpay', 'deposito_transbank'),
  ])

  const brechaTotal = cierres.filter(c => c.estado !== 'anulado').reduce((s, c) => s + Math.abs(Number(c.diferencia ?? 0)), 0)
  const pendientes = cierres.filter(c => c.estado === 'declarado').length
  const descuadres = cierres.filter(c => c.estado === 'descuadre').length

  return { ventasBsale, totalDepositado: dep + gn + wp, brechaTotal, pendientes, descuadres }
}
