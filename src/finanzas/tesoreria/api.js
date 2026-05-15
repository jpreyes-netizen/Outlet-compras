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

export async function fetchVentaBsale(fecha, sucursal_id) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const headers = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bsale-ventas-dia`,
      { method: 'POST', headers, body: JSON.stringify({ fecha, sucursal_id }) }
    )
    if (!res.ok) return null
    const json = await res.json()
    return json.total ?? null
  } catch (e) {
    console.warn('[fetchVentaBsale]', e.message)
    return null
  }
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
  // Sin join directo — evita error por FK faltante en vendedor_id (registros migrados)
  let q = supabase.from('cierres_caja')
    .select('*')
    .order('fecha', { ascending: false })
  if (filtros.sucursal_id) q = q.eq('sucursal_id', filtros.sucursal_id)
  if (filtros.vendedor_id) q = q.eq('vendedor_id', filtros.vendedor_id)
  if (filtros.fecha_desde) q = q.gte('fecha', filtros.fecha_desde)
  if (filtros.fecha_hasta) q = q.lte('fecha', filtros.fecha_hasta)
  if (filtros.estados && filtros.estados.length > 0) q = q.in('estado', filtros.estados)

  const { data, error } = await q
  if (error) throw error

  const rows = data ?? []

  // Nombres de sucursales en una sola query adicional
  const sucIds = [...new Set(rows.map(r => r.sucursal_id).filter(Boolean))]
  let sucMap = {}
  if (sucIds.length > 0) {
    const { data: sucs } = await supabase.from('sucursales').select('id, nombre').in('id', sucIds)
    for (const s of sucs ?? []) sucMap[s.id] = s.nombre
  }

  // Nombres de vendedores en una sola query (solo los que tienen vendedor_id real)
  const vendIds = [...new Set(rows.map(r => r.vendedor_id).filter(Boolean))]
  let vendMap = {}
  if (vendIds.length > 0) {
    const { data: vends } = await supabase.from('usuarios').select('id, nombre').in('id', vendIds)
    for (const v of vends ?? []) vendMap[v.id] = v.nombre
  }

  return rows.map(r => {
    // Registros migrados: extraer nombre desde observaciones_admin
    let vendedor_nombre = r.vendedor_id ? (vendMap[r.vendedor_id] ?? null) : null
    if (!vendedor_nombre && r.observaciones_admin?.startsWith('[MIGRADO] Vendedor: ')) {
      vendedor_nombre = r.observaciones_admin.replace('[MIGRADO] Vendedor: ', '').trim()
    }
    return {
      ...r,
      vendedor_nombre,
      sucursal_nombre: r.sucursal_id ? (sucMap[r.sucursal_id] ?? null) : null,
    }
  })
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
    // Usa venta_bsale_api de cierres_caja — fuente más fresca (actualizada por Edge Function)
    // Solo suma filas con valor no nulo para no inflar con cierres sin datos BSALE aún
    let q = supabase.from('cierres_caja')
      .select('venta_bsale_api')
      .gte('fecha', desde).lte('fecha', hasta)
      .neq('estado', 'anulado')
      .not('venta_bsale_api', 'is', null)
    if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
    const { data, error } = await q
    if (error) return 0
    // Agrupar por fecha+sucursal para no sumar el mismo día N veces (N vendedores)
    const porDia = new Map()
    for (const r of data ?? []) {
      const key = `${r.fecha}|${r.sucursal_id}`
      if (!porDia.has(key)) porDia.set(key, Number(r.venta_bsale_api ?? 0))
    }
    return [...porDia.values()].reduce((s, v) => s + v, 0)
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

// Sincroniza venta_bsale_api para todos los días del mes con cierres que tengan ese campo NULL.
// Llama la Edge Function por cada combinación fecha+sucursal única y reporta progreso.
export async function sincronizarBsaleMes({ anio, mes, sucursal_id, onProgress }) {
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
  const fin = new Date(anio, mes, 0)
  const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`

  // Traer todas las combinaciones fecha+sucursal con venta_bsale_api NULL
  let q = supabase.from('cierres_caja')
    .select('fecha, sucursal_id')
    .gte('fecha', desde).lte('fecha', hasta)
    .neq('estado', 'anulado')
    .is('venta_bsale_api', null)
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data, error } = await q
  if (error) throw error

  // Deduplicar por fecha+sucursal (puede haber N vendedores por día)
  const combos = [...new Map(
    (data ?? []).map(r => [`${r.fecha}|${r.sucursal_id}`, { fecha: r.fecha, sucursal_id: r.sucursal_id }])
  ).values()]

  if (combos.length === 0) return { total: 0, ok: 0, errores: 0 }

  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`

  let ok = 0, errores = 0
  for (let i = 0; i < combos.length; i++) {
    const { fecha, sucursal_id: suc } = combos[i]
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bsale-ventas-dia`,
        { method: 'POST', headers, body: JSON.stringify({ fecha, sucursal_id: suc }) }
      )
      if (res.ok) ok++
      else errores++
    } catch {
      errores++
    }
    onProgress?.({ actual: i + 1, total: combos.length, ok, errores })
  }

  return { total: combos.length, ok, errores }
}
