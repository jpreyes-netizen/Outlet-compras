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
    // Abonos recibidos en caja (Comprobantes de Abono BSALE) — no son venta facturada
    abonos_rec_efectivo: p.abonos_rec_efectivo ?? 0,
    abonos_rec_debito:   p.abonos_rec_debito   ?? 0,
    abonos_rec_otros:    p.abonos_rec_otros     ?? 0,
    abonos_rec_nota:     p.abonos_rec_nota      ?? null,
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

// Corrobora un cierre — el admin edita todos los medios.
// Efectivo es siempre exacto (cualquier diferencia = descuadre + cobranza).
// Medios electrónicos usan umbrales normales.
export async function corroborarCierre(p) {
  const uid = (await supabase.auth.getSession()).data.session?.user.id
  if (!uid) throw new Error('Sesión no encontrada')
  const { id, vendedor_id, vendedor_nombre, sucursal_id, fecha } = p
  const KEYS = ['efectivo','t_credito','t_debito','webpay','transferencia','m_pago','abono_cliente','canje','p_clay','cheque']

  const [{ data: cierre, error: errC }, umbrales] = await Promise.all([
    supabase.from('cierres_caja').select('*').eq('id', id).single(),
    fetchUmbrales(),
  ])
  if (errC) throw errC

  const buildCorrob = k => Number(p[`${k}_corrob`] ?? cierre[k] ?? 0)
  const efDeclarado = Number(cierre.efectivo ?? 0)
  const efContado   = buildCorrob('efectivo')
  const difEfectivo = efContado - efDeclarado

  const totalCorrob = KEYS.reduce((s, k) => s + buildCorrob(k), 0)
  const difTotal    = Math.abs(totalCorrob - Number(cierre.total_declarado ?? 0))

  const estado = difEfectivo !== 0
    ? 'descuadre'
    : difTotal === 0 || difTotal <= umbrales.cuadra
      ? 'cuadra'
      : difTotal <= umbrales.tolerable
        ? 'tolerable'
        : 'descuadre'

  const update = {
    efectivo_corrob:      efContado,
    t_credito_corrob:     buildCorrob('t_credito'),
    t_debito_corrob:      buildCorrob('t_debito'),
    webpay_corrob:        buildCorrob('webpay'),
    transferencia_corrob: buildCorrob('transferencia'),
    m_pago_corrob:        buildCorrob('m_pago'),
    abono_cliente_corrob: buildCorrob('abono_cliente'),
    canje_corrob:         buildCorrob('canje'),
    p_clay_corrob:        buildCorrob('p_clay'),
    cheque_corrob:        buildCorrob('cheque'),
    observaciones_admin:  p.observaciones_admin ?? null,
    corroborado_at:       new Date().toISOString(),
    admin_id:             uid,
    estado,
  }

  const { data, error } = await supabase.from('cierres_caja')
    .update(update).eq('id', id).select('*').single()
  if (error) throw error

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
      observaciones_admin: p.observaciones_admin ?? null,
      registrado_por:      uid,
    }).then(() => {}).catch(() => {})
  }

  await upsertDepositoEfectivoAutoCierre({
    fecha:       fecha ?? cierre.fecha,
    sucursal_id: sucursal_id ?? cierre.sucursal_id,
  }).catch(e => console.error('[upsertDeposito] error:', e?.message, e?.details, e?.hint))

  return { ...data, descuadre_registrado: Math.abs(difEfectivo) > 0, diferencia_efectivo: difEfectivo }
}

// Crea o actualiza la línea de depósito efectivo auto-generada para un día×sucursal.
// Suma el efectivo_corrob de todos los cierres corroborados (excluye 'declarado' y 'anulado').
// Solo actualiza la línea auto-generada si aún no tiene comprobante adjunto.
export async function upsertDepositoEfectivoAutoCierre({ fecha, sucursal_id }) {
  if (!fecha || !sucursal_id) return null
  const ESTADOS_CORROBORADOS = ['cuadra', 'tolerable', 'descuadre']

  // 1. Sumar efectivo corroborado del día×sucursal
  const { data: cierres, error: errC } = await supabase.from('cierres_caja')
    .select('id, efectivo_corrob, efectivo, estado')
    .eq('fecha', fecha)
    .eq('sucursal_id', sucursal_id)
    .in('estado', ESTADOS_CORROBORADOS)
  if (errC) throw errC

  if (!cierres || cierres.length === 0) return null

  const total = cierres.reduce((s, c) => s + Number(c.efectivo_corrob ?? c.efectivo ?? 0), 0)
  const cierreIds = cierres.map(c => c.id)

  // 2. Buscar si ya existe una línea auto-generada SIN comprobante para este día×sucursal
  const { data: existente } = await supabase.from('depositos_efectivo')
    .select('id, comprobante_url, monto_depositado')
    .eq('fecha', fecha)
    .eq('sucursal_id', sucursal_id)
    .eq('auto_generado', true)
    .is('comprobante_url', null)
    .maybeSingle()

  if (existente) {
    // Actualizar monto y trazabilidad
    const { data, error } = await supabase.from('depositos_efectivo')
      .update({ monto_depositado: total, origen_cierres: cierreIds })
      .eq('id', existente.id).select('*').single()
    if (error) throw error
    return data
  }

  // 3. No existe línea abierta → crear nueva
  const { data, error } = await supabase.from('depositos_efectivo')
    .insert({
      fecha,
      sucursal_id,
      monto_depositado: total,
      auto_generado: true,
      origen_cierres: cierreIds,
    })
    .select('*').single()
  if (error) throw error
  return data
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
  // mes === 0 → año completo
  let desde, hasta
  if (mes === 0) {
    desde = `${anio}-01-01`
    hasta = `${anio}-12-31`
  } else {
    desde = `${anio}-${String(mes).padStart(2, '0')}-01`
    const fin = new Date(anio, mes, 0)
    hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`
  }

  const sumCol = async (tabla, col) => {
    let q = supabase.from(tabla).select(col).gte('fecha', desde).lte('fecha', hasta)
    if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
    const { data, error } = await q
    if (error) return 0
    return (data ?? []).reduce((s, r) => s + Number(r[col] ?? 0), 0)
  }

  const sumVentas = async () => {
    // Lee directo de la cache ventas_bsale_dia (alineado con dashboard Análisis)
    // Es la fuente única de verdad: validada contra BSALE Excel mes a mes
    let q = supabase.from('ventas_bsale_dia')
      .select('total_venta')
      .gte('fecha', desde).lte('fecha', hasta)
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

  const ESTADOS_CORROBORADOS = ['cuadra', 'tolerable', 'descuadre']
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

// ═══════════════════════════════════════════════════════════════
// Abonos BSALE — Comprobantes de Abono recibidos en caja
// No son venta facturada — son ingresos físicos de caja que
// se documentan en BSALE como "Comprobante de Abono"
// ═══════════════════════════════════════════════════════════════

// Lista abonos de un cierre o de un rango fecha×sucursal
export async function fetchAbonosBsale({ cierre_id, fecha, sucursal_id } = {}) {
  let q = supabase.from('abonos_bsale').select('*').order('created_at', { ascending: false })
  if (cierre_id)   q = q.eq('cierre_id', cierre_id)
  if (fecha)       q = q.eq('fecha', fecha)
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// Inserta un abono manual (recibido físicamente pero no facturado ese día)
export async function insertAbonosBsale(row) {
  const { data, error } = await supabase.from('abonos_bsale')
    .insert(row).select('*').single()
  if (error) throw error
  return data
}

// Lista ventas imputadas con Abono Cliente (facturadas sin caja física)
export async function fetchVentasAbonoCliente({ cierre_id, fecha, sucursal_id } = {}) {
  let q = supabase.from('ventas_abono_cliente').select('*').order('fecha', { ascending: false })
  if (cierre_id)   q = q.eq('cierre_id', cierre_id)
  if (fecha)       q = q.eq('fecha', fecha)
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}
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

// ═══════════════════════════════════════════════════════════════
// SINCRONIZACIÓN + AUDITORÍA DE COBERTURA
// Itera todos los días L-S del mes × sucursales físicas activas.
// - BSALE tiene venta + existe cierre → actualiza venta_bsale_api (lo hace la edge fn)
// - BSALE tiene venta + NO existe cierre → registra como gap crítico
// - BSALE sin venta → ignora
// ═══════════════════════════════════════════════════════════════
// Detecta 3 tipos de gaps:
//   A) SIN_CIERRE: BSALE tiene venta pero NO hay cierre en BD
//   B) SUB_DECLARADO: hay cierre pero monto declarado < BSALE * (1 - tolerancia)
//   C) SOBRE_DECLARADO: hay cierre pero monto declarado > BSALE * (1 + tolerancia)
const TOLERANCIA_GAP = 0.10  // 10% de margen

export async function sincronizarYAuditarBsaleMes({ anio, mes, sucursal_id, onProgress }) {
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
  const fin = new Date(anio, mes, 0)
  const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`

  // Solo sucursales físicas — web no hace cierres
  const SUCURSALES_FISICAS = ['suc-mp', 'suc-lg', 'suc-la']
  const sucursalesAudit = sucursal_id
    ? SUCURSALES_FISICAS.filter(s => s === sucursal_id)
    : SUCURSALES_FISICAS

  // Días L-S del mes
  const dias = []
  const cursor = new Date(desde + 'T12:00:00')
  const fechaFin = new Date(hasta + 'T12:00:00')
  while (cursor <= fechaFin) {
    if (cursor.getDay() !== undefined) dias.push(cursor.toISOString().split('T')[0])
    cursor.setDate(cursor.getDate() + 1)
  }

  // Traer cierres existentes con totales declarados sumarizados
  let q = supabase.from('cierres_caja')
    .select('fecha, sucursal_id, total_declarado, total_corroborado, estado')
    .gte('fecha', desde).lte('fecha', hasta)
    .neq('estado', 'anulado')
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data: cierresExistentes } = await q

  // Agrupar por fecha+sucursal sumando todos los vendedores
  const cierresMap = new Map()
  for (const c of cierresExistentes ?? []) {
    const key = `${c.fecha}|${c.sucursal_id}`
    const prev = cierresMap.get(key) ?? { declarado: 0, corroborado: 0, n_vendedores: 0, tiene_corrob: false }
    prev.declarado += Number(c.total_declarado ?? 0)
    prev.corroborado += Number(c.total_corroborado ?? 0)
    prev.n_vendedores += 1
    if (c.total_corroborado != null) prev.tiene_corrob = true
    cierresMap.set(key, prev)
  }

  // Headers edge function
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`

  // Combos: fecha × sucursal
  const combos = []
  for (const fecha of dias) {
    for (const suc of sucursalesAudit) {
      combos.push({ fecha, sucursal_id: suc })
    }
  }

  const total = combos.length
  let ok = 0, errores = 0
  const gaps = []

  for (let i = 0; i < combos.length; i++) {
    const { fecha, sucursal_id: suc } = combos[i]
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bsale-ventas-dia`,
        { method: 'POST', headers, body: JSON.stringify({ fecha, sucursal_id: suc }) }
      )
      if (res.ok) {
        const json = await res.json()
        const ventaBsale = Number(json.total_venta ?? 0)
        const key = `${fecha}|${suc}`
        const cierre = cierresMap.get(key)

        if (ventaBsale === 0 && !cierre) {
          // Sin venta y sin cierre: OK, día sin actividad
        } else if (ventaBsale > 0 && !cierre) {
          // TIPO A: día con venta sin cierre alguno
          gaps.push({
            tipo: 'SIN_CIERRE',
            fecha, sucursal_id: suc,
            venta_bsale: ventaBsale,
            declarado: 0,
            diferencia: ventaBsale,
            medios: json.medios_global ?? {},
            severidad: 'critica',
          })
        } else if (cierre && ventaBsale > 0) {
          // Hay cierre Y hay venta — verificar diferencia
          const declarado = cierre.tiene_corrob ? cierre.corroborado : cierre.declarado
          const diferencia = ventaBsale - declarado
          const pctDif = Math.abs(diferencia) / ventaBsale

          if (pctDif > TOLERANCIA_GAP) {
            if (diferencia > 0) {
              // TIPO B: SUB_DECLARADO (venta BSALE > declarado)
              gaps.push({
                tipo: 'SUB_DECLARADO',
                fecha, sucursal_id: suc,
                venta_bsale: ventaBsale,
                declarado,
                diferencia,
                pct_diferencia: pctDif,
                n_vendedores: cierre.n_vendedores,
                medios: json.medios_global ?? {},
                severidad: pctDif > 0.30 ? 'critica' : 'alta',
              })
            } else {
              // TIPO C: SOBRE_DECLARADO (declarado > BSALE)
              gaps.push({
                tipo: 'SOBRE_DECLARADO',
                fecha, sucursal_id: suc,
                venta_bsale: ventaBsale,
                declarado,
                diferencia: -diferencia,
                pct_diferencia: pctDif,
                n_vendedores: cierre.n_vendedores,
                medios: json.medios_global ?? {},
                severidad: 'media',
              })
            }
          }
        } else if (cierre && ventaBsale === 0 && cierre.declarado > 0) {
          // Caso raro: hay cierre con monto pero BSALE dice 0
          gaps.push({
            tipo: 'SOBRE_DECLARADO',
            fecha, sucursal_id: suc,
            venta_bsale: 0,
            declarado: cierre.declarado,
            diferencia: cierre.declarado,
            pct_diferencia: 1,
            n_vendedores: cierre.n_vendedores,
            medios: {},
            severidad: 'critica',
          })
        }
        ok++
      } else { errores++ }
    } catch { errores++ }
    onProgress?.({ actual: i + 1, total, ok, errores, gaps: gaps.length, combo: { fecha, sucursal_id: suc } })
  }

  return { total, ok, errores, gaps }
}

// ═══════════════════════════════════════════════════════════════
// CACHE ventas_bsale_dia
// La edge function bsale-ventas-dia hace UPSERT en esta tabla cada
// vez que es invocada. El dashboard lee de aquí (rápido) en vez de
// llamar 90 veces a BSALE.
// ═══════════════════════════════════════════════════════════════

// Lee la cache para un mes/sucursal — instantáneo, sin BSALE
// Si mes === 0, lee el año completo
export async function fetchVentasBsaleMes({ anio, mes, sucursal_id }) {
  let desde, hasta
  if (mes === 0) {
    desde = `${anio}-01-01`
    hasta = `${anio}-12-31`
  } else {
    desde = `${anio}-${String(mes).padStart(2, '0')}-01`
    const fin = new Date(anio, mes, 0)
    hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`
  }

  let q = supabase.from('ventas_bsale_dia')
    .select('*')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)

  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// Identifica días+sucursales sin cache (faltantes en el mes)
// Devuelve array de combos {fecha, sucursal_id} que necesitan sincronización
export async function fetchCombosFaltantesCache({ anio, mes, sucursal_id }) {
  let desde, hasta
  if (mes === 0) {
    desde = `${anio}-01-01`
    hasta = `${anio}-12-31`
  } else {
    desde = `${anio}-${String(mes).padStart(2, '0')}-01`
    const fin = new Date(anio, mes, 0)
    hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`
  }

  const SUCURSALES_FISICAS = ['suc-mp', 'suc-lg', 'suc-la']
  const sucursalesEval = sucursal_id
    ? SUCURSALES_FISICAS.filter(s => s === sucursal_id)
    : SUCURSALES_FISICAS

  // Todos los días del mes (incluye domingos)
  const dias = []
  const hoy = new Date().toISOString().split('T')[0]
  const cursor = new Date(desde + 'T12:00:00')
  const fechaFin = new Date(hasta + 'T12:00:00')
  while (cursor <= fechaFin) {
    const fechaStr = cursor.toISOString().split('T')[0]
    if (fechaStr <= hoy) dias.push(fechaStr)
    cursor.setDate(cursor.getDate() + 1)
  }

  // Cache actual
  let q = supabase.from('ventas_bsale_dia')
    .select('fecha, sucursal_id')
    .gte('fecha', desde).lte('fecha', hasta)
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data: cached } = await q
  const cachedSet = new Set((cached ?? []).map(c => `${c.fecha}|${c.sucursal_id}`))

  // Calcular faltantes
  const faltantes = []
  for (const fecha of dias) {
    for (const suc of sucursalesEval) {
      const key = `${fecha}|${suc}`
      if (!cachedSet.has(key)) faltantes.push({ fecha, sucursal_id: suc })
    }
  }
  return faltantes
}

// Sincroniza solo los días faltantes del mes llamando la edge function.
// Cada llamada a la edge function actualiza automáticamente el cache.
export async function sincronizarCacheFaltante({ anio, mes, sucursal_id, onProgress, forzarTodo = false }) {
  let combos
  if (forzarTodo) {
    // Modo forzar: re-sincroniza TODOS los días del mes (no solo faltantes)
    const SUCURSALES_FISICAS = ['suc-mp', 'suc-lg', 'suc-la']
    const sucursalesEval = sucursal_id
      ? SUCURSALES_FISICAS.filter(s => s === sucursal_id)
      : SUCURSALES_FISICAS
    let desde, hasta
    if (mes === 0) {
      desde = `${anio}-01-01`
      hasta = `${anio}-12-31`
    } else {
      desde = `${anio}-${String(mes).padStart(2, '0')}-01`
      const fin = new Date(anio, mes, 0)
      hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`
    }
    const dias = []
    const hoy = new Date().toISOString().split('T')[0]
    const cursor = new Date(desde + 'T12:00:00')
    const fechaFin = new Date(hasta + 'T12:00:00')
    while (cursor <= fechaFin) {
      const fechaStr = cursor.toISOString().split('T')[0]
      if (fechaStr <= hoy) dias.push(fechaStr)
      cursor.setDate(cursor.getDate() + 1)
    }
    combos = []
    for (const fecha of dias) {
      for (const suc of sucursalesEval) {
        combos.push({ fecha, sucursal_id: suc })
      }
    }
  } else {
    combos = await fetchCombosFaltantesCache({ anio, mes, sucursal_id })
  }

  const total = combos.length
  if (total === 0) {
    onProgress?.({ actual: 0, total: 0, ok: 0, errores: 0 })
    return { total: 0, ok: 0, errores: 0 }
  }

  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`

  // Paralelizar en batches de 5 — reduce el tiempo de 6 min a ~1.5 min
  const BATCH_SIZE = 5
  let ok = 0, errores = 0
  let procesados = 0

  for (let i = 0; i < combos.length; i += BATCH_SIZE) {
    const batch = combos.slice(i, i + BATCH_SIZE)
    const resultados = await Promise.allSettled(
      batch.map(({ fecha, sucursal_id: suc }) =>
        fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bsale-ventas-dia`,
          { method: 'POST', headers, body: JSON.stringify({ fecha, sucursal_id: suc }) }
        ).then(res => ({ ok: res.ok, fecha, suc }))
      )
    )
    for (const r of resultados) {
      procesados++
      if (r.status === 'fulfilled' && r.value.ok) ok++
      else errores++
    }
    const ultimo = batch[batch.length - 1]
    onProgress?.({
      actual: procesados, total,
      ok, errores,
      combo: { fecha: ultimo.fecha, sucursal_id: ultimo.sucursal_id }
    })
  }
  return { total, ok, errores }
}

// Sincroniza un rango específico de fechas con REINTENTOS automáticos.
// Si un combo falla, lo reintenta hasta 3 veces. Si sigue fallando, queda en errores.
// Paraleliza en batches de 5.
export async function sincronizarRango({ fechaDesde, fechaHasta, sucursal_id, onProgress }) {
  const SUCURSALES_FISICAS = ['suc-mp', 'suc-lg', 'suc-la']
  const sucursalesEval = sucursal_id
    ? SUCURSALES_FISICAS.filter(s => s === sucursal_id)
    : SUCURSALES_FISICAS

  // Todos los días del rango (incluye domingos)
  const dias = []
  const hoy = new Date().toISOString().split('T')[0]
  const cursor = new Date(fechaDesde + 'T12:00:00')
  const fechaFin = new Date(fechaHasta + 'T12:00:00')
  while (cursor <= fechaFin) {
    const fechaStr = cursor.toISOString().split('T')[0]
    if (fechaStr <= hoy) dias.push(fechaStr)
    cursor.setDate(cursor.getDate() + 1)
  }

  const combos = []
  for (const fecha of dias) {
    for (const suc of sucursalesEval) {
      combos.push({ fecha, sucursal_id: suc })
    }
  }

  const total = combos.length
  if (total === 0) {
    onProgress?.({ actual: 0, total: 0, ok: 0, errores: 0 })
    return { total: 0, ok: 0, errores: 0, fallidos: [] }
  }

  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`

  // Función que llama edge function con timeout y captura de errores
  async function llamarEdgeFn(fecha, suc) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60000) // 60s timeout
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bsale-ventas-dia`,
        {
          method: 'POST', headers,
          body: JSON.stringify({ fecha, sucursal_id: suc }),
          signal: controller.signal
        }
      )
      clearTimeout(timeout)
      return { ok: res.ok, status: res.status }
    } catch (e) {
      return { ok: false, status: 0, error: e.message }
    }
  }

  // Paralelizar en batches de 10 (era 5, doble velocidad)
  const BATCH_SIZE = 10
  let ok = 0, errores = 0, procesados = 0
  const fallidos = []

  for (let i = 0; i < combos.length; i += BATCH_SIZE) {
    const batch = combos.slice(i, i + BATCH_SIZE)
    const resultados = await Promise.allSettled(
      batch.map(c => llamarEdgeFn(c.fecha, c.sucursal_id).then(r => ({ ...r, combo: c })))
    )
    for (const r of resultados) {
      procesados++
      if (r.status === 'fulfilled' && r.value.ok) ok++
      else {
        errores++
        if (r.status === 'fulfilled') fallidos.push(r.value.combo)
        else fallidos.push({ fecha: 'unknown', sucursal_id: 'unknown' })
      }
    }
    const ultimo = batch[batch.length - 1]
    onProgress?.({
      actual: procesados, total, ok, errores,
      combo: { fecha: ultimo.fecha, sucursal_id: ultimo.sucursal_id }
    })
  }

  // REINTENTO 1: combos que fallaron en primera pasada
  if (fallidos.length > 0) {
    onProgress?.({
      actual: procesados, total, ok, errores,
      mensaje: `Reintentando ${fallidos.length} combo(s) fallido(s)...`
    })
    const fallidos1 = [...fallidos]
    fallidos.length = 0
    for (const combo of fallidos1) {
      const r = await llamarEdgeFn(combo.fecha, combo.sucursal_id)
      if (r.ok) {
        ok++
        errores--
      } else {
        fallidos.push(combo)
      }
    }
  }

  // REINTENTO 2: si aún quedan fallidos, segundo intento secuencial
  if (fallidos.length > 0) {
    onProgress?.({
      actual: procesados, total, ok, errores,
      mensaje: `Segundo reintento de ${fallidos.length} combo(s)...`
    })
    const fallidos2 = [...fallidos]
    fallidos.length = 0
    for (const combo of fallidos2) {
      await new Promise(r => setTimeout(r, 1000)) // espera 1s entre cada intento
      const r = await llamarEdgeFn(combo.fecha, combo.sucursal_id)
      if (r.ok) {
        ok++
        errores--
      } else {
        fallidos.push(combo)
      }
    }
  }

  // VERIFICACIÓN POST-SYNC: chequear que la cache tiene todas las filas esperadas
  // Si algún combo no está en la cache, lo agregamos a fallidos para el reporte
  const desde = combos[0].fecha
  const hasta = combos[combos.length - 1].fecha
  const { data: cached } = await supabase.from('ventas_bsale_dia')
    .select('fecha, sucursal_id')
    .gte('fecha', desde).lte('fecha', hasta)
  const cachedSet = new Set((cached ?? []).map(c => `${c.fecha}|${c.sucursal_id}`))
  const faltantesPostSync = combos.filter(c => !cachedSet.has(`${c.fecha}|${c.sucursal_id}`))

  // REINTENTO 3: combos detectados como faltantes en cache
  if (faltantesPostSync.length > 0) {
    onProgress?.({
      actual: procesados, total, ok, errores,
      mensaje: `Recuperando ${faltantesPostSync.length} combo(s) faltante(s) en cache...`
    })
    for (const combo of faltantesPostSync) {
      await new Promise(r => setTimeout(r, 1500))
      const r = await llamarEdgeFn(combo.fecha, combo.sucursal_id)
      if (r.ok) ok++
      else if (!fallidos.find(f => f.fecha === combo.fecha && f.sucursal_id === combo.sucursal_id)) {
        fallidos.push(combo)
      }
    }
  }

  return { total, ok, errores: fallidos.length, fallidos }
}

// Sincroniza un solo día (atajo)
export async function sincronizarDia({ fecha, sucursal_id, onProgress }) {
  return sincronizarRango({ fechaDesde: fecha, fechaHasta: fecha, sucursal_id, onProgress })
}

// Sincroniza un MES COMPLETO en una sola llamada a bsale-ventas-mes
// Mucho más rápido que sincronizarRango porque solo hace 1 request a BSALE
// Si mes === 0: sincroniza año completo (12 meses secuencialmente)
export async function sincronizarMesCompleto({ anio, mes, sucursal_id, onProgress }) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`

  // Modo año: llama 12 veces (1 por mes), solo hasta el mes actual si es el año en curso
  if (mes === 0) {
    const hoy = new Date()
    const mesMax = anio === hoy.getFullYear() ? hoy.getMonth() + 1 : 12
    let totalAcum = 0, okAcum = 0, errAcum = 0, montoTotal = 0, docsTotal = 0
    for (let m = 1; m <= mesMax; m++) {
      onProgress?.({
        actual: m - 1, total: mesMax, ok: okAcum, errores: errAcum,
        mensaje: `Procesando mes ${m}/${mesMax}...`
      })
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 180000)
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bsale-ventas-mes`,
          {
            method: 'POST', headers,
            body: JSON.stringify({ anio, mes: m, sucursal_id: sucursal_id ?? null }),
            signal: controller.signal,
          }
        )
        clearTimeout(timeout)
        if (res.ok) {
          const json = await res.json()
          totalAcum += json.combos_procesados ?? 0
          okAcum += json.combos_procesados ?? 0
          montoTotal += json.total_mes ?? 0
          docsTotal += json.docs_venta ?? 0
        } else {
          errAcum++
        }
      } catch (e) {
        errAcum++
      }
    }
    onProgress?.({
      actual: mesMax, total: mesMax, ok: okAcum, errores: errAcum,
      mensaje: `✓ Año sincronizado: ${okAcum} combos · ${docsTotal} docs`,
    })
    return { total: totalAcum, ok: okAcum, errores: errAcum, total_mes: montoTotal, docs_venta: docsTotal }
  }

  // Modo mes único
  onProgress?.({ actual: 0, total: 1, ok: 0, errores: 0, mensaje: 'Procesando mes completo en BSALE...' })
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 180000)
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bsale-ventas-mes`,
      {
        method: 'POST', headers,
        body: JSON.stringify({ anio, mes, sucursal_id: sucursal_id ?? null }),
        signal: controller.signal,
      }
    )
    clearTimeout(timeout)
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }
    const json = await res.json()
    onProgress?.({
      actual: 1, total: 1, ok: 1, errores: 0,
      mensaje: `✓ ${json.combos_procesados} día(s)·sucursal(es) procesados`,
    })
    return {
      total: json.combos_procesados ?? 0,
      ok: json.combos_procesados ?? 0,
      errores: 0,
      total_mes: json.total_mes ?? 0,
      docs_venta: json.docs_venta ?? 0,
    }
  } catch (e) {
    onProgress?.({ actual: 0, total: 1, ok: 0, errores: 1, mensaje: 'Error: ' + e.message })
    return { total: 1, ok: 0, errores: 1, error: e.message }
  }
}

// Auditoría de cobertura usando SOLO la cache (sin llamar BSALE)
// Detecta los 3 tipos de gaps comparando ventas_bsale_dia vs cierres_caja
// Si mes === 0, audita el año completo
export async function auditarCoberturaDesdeCache({ anio, mes, sucursal_id }) {
  const TOLERANCIA = 0.10
  const ventasBsale = await fetchVentasBsaleMes({ anio, mes, sucursal_id })
  const bsaleMap = new Map(ventasBsale.map(v => [`${v.fecha}|${v.sucursal_id}`, v]))

  let desde, hasta
  if (mes === 0) {
    desde = `${anio}-01-01`
    hasta = `${anio}-12-31`
  } else {
    desde = `${anio}-${String(mes).padStart(2, '0')}-01`
    const fin = new Date(anio, mes, 0)
    hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`
  }
  let q = supabase.from('cierres_caja')
    .select('fecha, sucursal_id, total_declarado, total_corroborado, estado')
    .gte('fecha', desde).lte('fecha', hasta)
    .neq('estado', 'anulado')
  if (sucursal_id) q = q.eq('sucursal_id', sucursal_id)
  const { data: cierres } = await q

  const cierresMap = new Map()
  for (const c of cierres ?? []) {
    const key = `${c.fecha}|${c.sucursal_id}`
    const prev = cierresMap.get(key) ?? { declarado: 0, corroborado: 0, n_vendedores: 0, tiene_corrob: false }
    prev.declarado += Number(c.total_declarado ?? 0)
    prev.corroborado += Number(c.total_corroborado ?? 0)
    prev.n_vendedores += 1
    if (c.total_corroborado != null) prev.tiene_corrob = true
    cierresMap.set(key, prev)
  }

  const gaps = []
  for (const [key, bsale] of bsaleMap) {
    const ventaBsale = Number(bsale.total_venta ?? 0)
    const cierre = cierresMap.get(key)
    if (ventaBsale === 0 && !cierre) continue
    if (ventaBsale > 0 && !cierre) {
      gaps.push({
        tipo: 'SIN_CIERRE',
        fecha: bsale.fecha, sucursal_id: bsale.sucursal_id,
        venta_bsale: ventaBsale, declarado: 0,
        diferencia: ventaBsale,
        medios: bsale.medios ?? {},
        severidad: 'critica',
      })
    } else if (cierre && ventaBsale > 0) {
      const declarado = cierre.tiene_corrob ? cierre.corroborado : cierre.declarado
      const diferencia = ventaBsale - declarado
      const pctDif = Math.abs(diferencia) / ventaBsale
      if (pctDif > TOLERANCIA) {
        if (diferencia > 0) {
          gaps.push({
            tipo: 'SUB_DECLARADO',
            fecha: bsale.fecha, sucursal_id: bsale.sucursal_id,
            venta_bsale: ventaBsale, declarado,
            diferencia, pct_diferencia: pctDif,
            n_vendedores: cierre.n_vendedores,
            medios: bsale.medios ?? {},
            severidad: pctDif > 0.30 ? 'critica' : 'alta',
          })
        } else {
          gaps.push({
            tipo: 'SOBRE_DECLARADO',
            fecha: bsale.fecha, sucursal_id: bsale.sucursal_id,
            venta_bsale: ventaBsale, declarado,
            diferencia: -diferencia, pct_diferencia: pctDif,
            n_vendedores: cierre.n_vendedores,
            medios: bsale.medios ?? {},
            severidad: 'media',
          })
        }
      }
    } else if (cierre && ventaBsale === 0 && cierre.declarado > 0) {
      gaps.push({
        tipo: 'SOBRE_DECLARADO',
        fecha: bsale.fecha, sucursal_id: bsale.sucursal_id,
        venta_bsale: 0, declarado: cierre.declarado,
        diferencia: cierre.declarado, pct_diferencia: 1,
        n_vendedores: cierre.n_vendedores,
        medios: {},
        severidad: 'critica',
      })
    }
  }

  return { gaps, totalCache: ventasBsale.length, totalCierres: cierresMap.size }
}
