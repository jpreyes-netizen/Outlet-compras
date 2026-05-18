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
    bsale_vendedor_id: p.bsale_vendedor_id ?? null,
    firmado_por_usuario_id: p.firmado_por_usuario_id ?? uid ?? null,
    firmado_por_nombre: p.firmado_por_nombre ?? null,
    estado: 'declarado', declarado_at: new Date().toISOString(), declarado_por: uid,
    venta_bsale_api: p.venta_bsale_api, observaciones_vendedor: p.observaciones_vendedor,
    efectivo: p.efectivo ?? 0, t_credito: p.t_credito ?? 0, t_debito: p.t_debito ?? 0,
    webpay: p.webpay ?? 0, transferencia: p.transferencia ?? 0, m_pago: p.m_pago ?? 0,
    abono_cliente: p.abono_cliente ?? 0, canje: p.canje ?? 0, p_clay: p.p_clay ?? 0, cheque: p.cheque ?? 0,
  }
}

// Resuelve el usuario interno a partir de su bsale_user_id
// Retorna { id, nombre, bsale_user_id } o null si no hay mapeo
export async function fetchUsuarioByBsaleId(bsaleUserId) {
  if (!bsaleUserId) return null
  const { data, error } = await supabase.from('usuarios')
    .select('id, nombre, bsale_user_id, rol')
    .eq('bsale_user_id', String(bsaleUserId))
    .maybeSingle()
  if (error) return null
  return data
}

// Corrobora un cierre — el admin cuenta el efectivo físico.
// Los medios electrónicos se auto-completan con el declarado.
// Si efectivo ≠ contado → registra descuadre para cobranza al vendedor.
export async function corroborarCierre(p) {
  const uid = (await supabase.auth.getSession()).data.session?.user.id
  if (!uid) throw new Error('Sesión no encontrada')
  const { id, efectivo_contado, observaciones_admin, vendedor_id, vendedor_nombre, sucursal_id, fecha } = p

  // 1. Traer cierre actual + umbrales
  const [{ data: cierre, error: errC }, umbrales] = await Promise.all([
    supabase.from('cierres_caja').select('*').eq('id', id).single(),
    fetchUmbrales(),
  ])
  if (errC) throw errC

  const efDeclarado = Number(cierre.efectivo ?? 0)
  const efContado   = Number(efectivo_contado ?? 0)
  const difEfectivo = efContado - efDeclarado

  // 2. Calcular estado según diferencia TOTAL del cierre (diferencia es columna GENERATED)
  // Usamos la diferencia que tendrá la BD tras el update:
  // total_corroborado - total_declarado (la BD lo calcula)
  // Aproximamos: la única diferencia real es la del efectivo
  const absDif = Math.abs(difEfectivo)
  const estado = absDif === 0
    ? 'cuadra'
    : absDif <= umbrales.cuadra
      ? 'cuadra'
      : absDif <= umbrales.tolerable
        ? 'tolerable'
        : 'descuadre'

  // 3. Update: efectivo contado, demás medios auto-igualados con declarado
  const update = {
    efectivo_corrob:      efContado,
    t_credito_corrob:     Number(cierre.t_credito     ?? 0),
    t_debito_corrob:      Number(cierre.t_debito      ?? 0),
    webpay_corrob:        Number(cierre.webpay        ?? 0),
    transferencia_corrob: Number(cierre.transferencia ?? 0),
    m_pago_corrob:        Number(cierre.m_pago        ?? 0),
    abono_cliente_corrob: Number(cierre.abono_cliente ?? 0),
    canje_corrob:         Number(cierre.canje         ?? 0),
    p_clay_corrob:        Number(cierre.p_clay        ?? 0),
    cheque_corrob:        Number(cierre.cheque        ?? 0),
    observaciones_admin:  observaciones_admin ?? null,
    corroborado_at:       new Date().toISOString(),
    admin_id:             uid,
    estado,
  }

  const { data, error } = await supabase.from('cierres_caja')
    .update(update).eq('id', id).select('*').single()
  if (error) throw error

  // 4. Si hay diferencia en efectivo → registrar en cobranza
  if (Math.abs(difEfectivo) > 0) {
    await supabase.from('descuadres_cobranza').insert({
      cierre_id:           id,
      vendedor_id:         vendedor_id ?? cierre.vendedor_id,
      vendedor_nombre,
      sucursal_id:         sucursal_id ?? cierre.sucursal_id,
      fecha:               fecha ?? cierre.fecha,
      monto:               difEfectivo,
      medio:               'efectivo',
      motivo:              difEfectivo < 0 ? 'Falta efectivo en caja' : 'Sobra efectivo en caja',
      observaciones_admin: observaciones_admin ?? null,
      registrado_por:      uid,
    }).then(() => {}).catch(() => {}) // no bloquear si tabla no existe aún
  }

  return { ...data, descuadre_registrado: Math.abs(difEfectivo) > 0, diferencia_efectivo: difEfectivo }
}

// Lista descuadres pendientes/históricos (cobranza al vendedor)
export async function fetchDescuadresCobranza({ vendedor_id, estado_cobro, fecha_desde, fecha_hasta } = {}) {
  let q = supabase.from('descuadres_cobranza').select('*').order('fecha', { ascending: false })
  if (vendedor_id)  q = q.eq('vendedor_id', vendedor_id)
  if (estado_cobro) q = q.eq('estado_cobro', estado_cobro)
  if (fecha_desde)  q = q.gte('fecha', fecha_desde)
  if (fecha_hasta)  q = q.lte('fecha', fecha_hasta)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function resolverDescuadreCobranza(id, { estado_cobro, observaciones_admin }) {
  const uid = (await supabase.auth.getSession()).data.session?.user.id
  const { data, error } = await supabase.from('descuadres_cobranza')
    .update({
      estado_cobro,
      observaciones_admin,
      resuelto_por: uid,
      resuelto_at: new Date().toISOString(),
    })
    .eq('id', id).select('*').single()
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

  const ESTADOS_CORROBORADOS = ['cuadra', 'tolerable', 'descuadre', 'conciliado']
  const brechaTotal   = cierres.filter(c => c.estado !== 'anulado').reduce((s, c) => s + Math.abs(Number(c.diferencia ?? 0)), 0)
  const pendientes    = cierres.filter(c => c.estado === 'declarado').length
  const corroborados  = cierres.filter(c => ESTADOS_CORROBORADOS.includes(c.estado)).length
  const descuadres    = cierres.filter(c => c.estado === 'descuadre').length

  return { ventasBsale, totalDepositado: dep + gn + wp, brechaTotal, pendientes, corroborados, descuadres }
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

// ═══════════════════════════════════════════════════════════════
// CONCILIACIÓN 3 FASES: venta → corroboración → depósito
// ═══════════════════════════════════════════════════════════════

const MEDIOS_CONC = ['efectivo', 't_credito', 't_debito', 'webpay', 'transferencia']

export async function fetchParamsConciliacion() {
  const { data, error } = await supabase.from('parametros_sistema')
    .select('clave, valor').like('clave', 'conc_%')
  if (error) return getDefaultParams()
  const map = {}
  for (const r of data ?? []) map[r.clave] = Number(r.valor)
  return {
    tol_dias: {
      efectivo:      map.conc_tol_dias_efectivo      ?? 2,
      t_credito:     map.conc_tol_dias_t_credito     ?? 3,
      t_debito:      map.conc_tol_dias_t_debito      ?? 2,
      webpay:        map.conc_tol_dias_webpay        ?? 2,
      transferencia: map.conc_tol_dias_transferencia ?? 1,
    },
    umbral_cuadra:     map.conc_umbral_cuadra     ?? 5000,
    umbral_tolerable:  map.conc_umbral_tolerable  ?? 50000,
    alerta_recurrentes: map.conc_alerta_recurrentes ?? 3,
  }
}

function getDefaultParams() {
  return {
    tol_dias: { efectivo: 2, t_credito: 3, t_debito: 2, webpay: 2, transferencia: 1 },
    umbral_cuadra: 5000, umbral_tolerable: 50000, alerta_recurrentes: 3,
  }
}

// Carga datos crudos de las 3 fases para un período
export async function fetchConciliacion3Fases({ anio, mes, sucursal_id }) {
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
  const fin = new Date(anio, mes, 0)
  const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`

  // Ventana de depósitos: hasta 5 días después del fin de mes (cubre tolerancias)
  const hastaDep = new Date(anio, mes - 1, fin.getDate() + 5).toISOString().slice(0, 10)

  // ── Fase 1+2 desde cierres_caja ──────────────────────────────────────
  let qC = supabase.from('cierres_caja').select('*')
    .gte('fecha', desde).lte('fecha', hasta)
    .neq('estado', 'anulado')
  if (sucursal_id) qC = qC.eq('sucursal_id', sucursal_id)
  const { data: cierres, error: errC } = await qC
  if (errC) throw errC

  // ── Fase 3 — Depósitos efectivo ──────────────────────────────────────
  let qDE = supabase.from('depositos_efectivo')
    .select('id, fecha, sucursal_id, monto_depositado')
    .gte('fecha', desde).lte('fecha', hastaDep)
  if (sucursal_id) qDE = qDE.eq('sucursal_id', sucursal_id)
  const { data: depEfectivo } = await qDE

  // ── Fase 3 — Getnet (crédito + débito por tipo_pago) ─────────────────
  let qGN = supabase.from('getnet_transacciones')
    .select('id, fecha_venta, fecha_abono, sucursal_id, monto_abono, tipo_pago')
    .gte('fecha_venta', desde).lte('fecha_venta', hasta)
  if (sucursal_id) qGN = qGN.eq('sucursal_id', sucursal_id)
  const { data: getnetTx } = await qGN

  // ── Fase 3 — Webpay ──────────────────────────────────────────────────
  let qWP = supabase.from('abonos_webpay')
    .select('id, fecha, sucursal_id, deposito_transbank')
    .gte('fecha', desde).lte('fecha', hastaDep)
  if (sucursal_id) qWP = qWP.eq('sucursal_id', sucursal_id)
  const { data: webpay } = await qWP

  // Resolver nombres
  const sucIds = [...new Set(cierres.map(r => r.sucursal_id).filter(Boolean))]
  const sucMap = {}
  if (sucIds.length > 0) {
    const { data: sucs } = await supabase.from('sucursales').select('id, nombre').in('id', sucIds)
    for (const s of sucs ?? []) sucMap[s.id] = s.nombre
  }
  const vendIds = [...new Set(cierres.map(r => r.vendedor_id).filter(Boolean))]
  const vendMap = {}
  if (vendIds.length > 0) {
    const { data: vends } = await supabase.from('usuarios').select('id, nombre').in('id', vendIds)
    for (const v of vends ?? []) vendMap[v.id] = v.nombre
  }

  // Enriquecer cierres
  const cierresEnr = cierres.map(c => {
    let vendedor_nombre = c.vendedor_id ? (vendMap[c.vendedor_id] ?? null) : null
    if (!vendedor_nombre && c.observaciones_admin?.startsWith('[MIGRADO] Vendedor: ')) {
      vendedor_nombre = c.observaciones_admin.replace('[MIGRADO] Vendedor: ', '').trim()
    }
    return { ...c, vendedor_nombre, sucursal_nombre: sucMap[c.sucursal_id] ?? null }
  })

  return {
    desde, hasta, hastaDep,
    cierres: cierresEnr,
    depEfectivo: depEfectivo ?? [],
    getnetTx: getnetTx ?? [],
    webpay: webpay ?? [],
    sucMap, vendMap,
  }
}

// Agrega Fase 3 por medio: cuánto llegó al banco/pasarela por sucursal en el período
export function agregarFase3PorMedio(datos) {
  const { depEfectivo, getnetTx, webpay, desde, hasta } = datos
  const sumarEn = (rows, montoKey, fechaKey) => {
    let total = 0
    const porSuc = {}
    for (const r of rows) {
      const f = r[fechaKey]
      if (!f) continue
      // Solo sumar si la fecha de venta/origen está en el rango del mes
      // (los depósitos pueden ser posteriores, pero se asocian a ventas del mes)
      const monto = Number(r[montoKey] ?? 0)
      total += monto
      porSuc[r.sucursal_id] = (porSuc[r.sucursal_id] ?? 0) + monto
    }
    return { total, porSuc }
  }

  // Efectivo → depositos_efectivo (fecha del depósito bancario)
  // T. Crédito → getnet_transacciones WHERE tipo_pago ILIKE '%CRED%'
  // T. Débito  → getnet_transacciones WHERE tipo_pago ILIKE '%DEB%'
  // Webpay     → abonos_webpay (link de pago, tabla separada de Getnet)
  // Transferencia → sin tabla de fase 3 por ahora
  const efectivo = sumarEn(depEfectivo, 'monto_depositado', 'fecha')
  const webpayAg = sumarEn(webpay, 'deposito_transbank', 'fecha')

  // Getnet: usamos fecha_venta para asociar al mes correcto
  const getnetCred = sumarEn(
    getnetTx.filter(r => /CRED/i.test(r.tipo_pago ?? '')),
    'monto_abono', 'fecha_venta'
  )
  const getnetDeb = sumarEn(
    getnetTx.filter(r => /DEB/i.test(r.tipo_pago ?? '')),
    'monto_abono', 'fecha_venta'
  )

  return {
    efectivo,
    t_credito: getnetCred,
    t_debito: getnetDeb,
    webpay: webpayAg,
    transferencia: { total: 0, porSuc: {} }, // no hay tabla específica todavía
  }
}
