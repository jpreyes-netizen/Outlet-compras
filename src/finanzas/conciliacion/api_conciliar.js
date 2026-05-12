import { supabase } from '../../supabase'

// ============ helpers ============
function calcularEstado(monto, aplicado) {
  const m = Number(monto) || 0
  const a = Number(aplicado) || 0
  const saldo = m - a
  const pct = m > 0 ? Math.min(100, Math.round((a / m) * 100)) : 0
  let estado
  if (a === 0) estado = 'sin_conciliar'
  else if (a > m + 0.5) estado = 'sobre_conciliado'
  else if (Math.abs(saldo) < 0.5) estado = 'completo'
  else estado = 'parcial'
  return { estado_conciliacion: estado, porcentaje: pct, saldo_pendiente: saldo }
}

// ============ Movimientos ============
export async function fetchMovimientos(filtros) {
  let q = supabase
    .from('movimientos_bancarios')
    .select('id, cartola_id, fecha, tipo, monto, descripcion, referencia, estado, conciliaciones(id, monto_aplicado)')
    .eq('estado', 'clasificado')
    .order('fecha', { ascending: false })
    .limit(500)

  if (filtros.soloCargo) q = q.eq('tipo', 'CARGO')
  if (filtros.desde) q = q.gte('fecha', filtros.desde)
  if (filtros.hasta) q = q.lte('fecha', filtros.hasta)
  if (filtros.texto?.trim()) {
    const t = filtros.texto.trim()
    q = q.or(`descripcion.ilike.%${t}%,referencia.ilike.%${t}%`)
  }

  const { data, error } = await q
  if (error) throw error

  let mapped = (data ?? []).map(r => {
    const aplicado = (r.conciliaciones ?? []).reduce((acc, c) => acc + (Number(c.monto_aplicado) || 0), 0)
    const calc = calcularEstado(Number(r.monto) || 0, aplicado)
    return {
      movimiento_id: r.id, cartola_id: r.cartola_id ?? null,
      fecha: r.fecha, tipo: r.tipo, monto: Number(r.monto) || 0,
      descripcion: r.descripcion ?? '', referencia: r.referencia ?? null,
      estado: r.estado, total_aplicado: aplicado,
      saldo_pendiente: calc.saldo_pendiente, porcentaje: calc.porcentaje,
      estado_conciliacion: calc.estado_conciliacion,
    }
  })

  if (filtros.estado !== 'todos') mapped = mapped.filter(m => m.estado_conciliacion === filtros.estado)
  return mapped
}

// ============ Vinculados ============
export async function fetchVinculados(movimientoId) {
  const { data: rows, error } = await supabase
    .from('conciliaciones')
    .select('id, movimiento_id, tipo_respaldo, factura_compra_id, carpeta_importacion_id, monto_aplicado, observaciones, created_at')
    .eq('movimiento_id', movimientoId)
    .order('created_at', { ascending: true })
  if (error) throw error

  const conc = rows ?? []
  if (conc.length === 0) return []

  const facturaIds = conc.filter(c => c.factura_compra_id).map(c => c.factura_compra_id)
  const importacionIds = conc.filter(c => c.carpeta_importacion_id).map(c => c.carpeta_importacion_id)

  const facturasMap = new Map()
  if (facturaIds.length) {
    const { data: facs } = await supabase.from('libro_compras').select('id, folio, razon_social').in('id', facturaIds)
    ;(facs ?? []).forEach(f => facturasMap.set(f.id, { folio: f.folio, proveedor: f.razon_social }))
  }

  const importsMap = new Map()
  if (importacionIds.length) {
    const { data: imps } = await supabase.from('carpeta_importaciones').select('id, numero_din, proveedor_exterior').in('id', importacionIds)
    ;(imps ?? []).forEach(i => importsMap.set(i.id, { folio: i.numero_din, proveedor: i.proveedor_exterior }))
  }

  return conc.map(c => {
    let folio = null, proveedor = null
    if (c.tipo_respaldo === 'factura_compra' && c.factura_compra_id) {
      const f = facturasMap.get(c.factura_compra_id)
      folio = f?.folio ?? null; proveedor = f?.proveedor ?? null
    } else if (c.tipo_respaldo === 'importacion' && c.carpeta_importacion_id) {
      const i = importsMap.get(c.carpeta_importacion_id)
      folio = i?.folio ?? null; proveedor = i?.proveedor ?? null
    } else {
      folio = c.observaciones?.slice(0, 24) ?? null; proveedor = 'Sin respaldo tributario'
    }
    return { ...c, folio, proveedor }
  })
}

// ============ Facturas candidatas ============
export async function fetchFacturasCandidatas({ texto, saldoObjetivo, rutHint }) {
  const min = Math.round(saldoObjetivo * 0.7)
  const max = Math.round(saldoObjetivo * 1.3)

  let q = supabase.from('libro_compras').select('id, fecha_emision, folio, rut_proveedor, razon_social, monto_total').order('fecha_emision', { ascending: false }).limit(200)

  const t = texto?.trim()
  if (t) q = q.or(`rut_proveedor.ilike.%${t}%,razon_social.ilike.%${t}%,folio.ilike.%${t}%`)
  else if (rutHint) q = q.eq('rut_proveedor', rutHint)
  else if (saldoObjetivo > 0) q = q.gte('monto_total', min).lte('monto_total', max)

  const { data, error } = await q
  if (error) throw error
  const facturas = data ?? []
  if (facturas.length === 0) return []

  const ids = facturas.map(x => x.id)
  const { data: estados } = await supabase.from('v_estado_factura').select('factura_id, total_pagado, saldo, estado_factura').in('factura_id', ids)
  const estadoMap = new Map()
  ;(estados ?? []).forEach(e => estadoMap.set(e.factura_id, { total_pagado: Number(e.total_pagado) || 0, saldo: Number(e.saldo) || 0, estado_factura: e.estado_factura }))

  const enriched = facturas.map(x => {
    const e = estadoMap.get(x.id)
    const total = Number(x.monto_total) || 0
    return { ...x, monto_total: total, total_pagado: e?.total_pagado ?? 0, saldo: e?.saldo ?? total, estado_factura: e?.estado_factura ?? 'sin_pagar' }
  })

  enriched.sort((a, b) => {
    const oa = a.estado_factura === 'pagada' ? 2 : 0
    const ob = b.estado_factura === 'pagada' ? 2 : 0
    if (oa !== ob) return oa - ob
    if (saldoObjetivo > 0) return Math.abs(a.monto_total - saldoObjetivo) - Math.abs(b.monto_total - saldoObjetivo)
    return 0
  })
  return enriched
}

// ============ Importaciones ============
export async function fetchImportacionesAbiertas() {
  const { data, error } = await supabase.from('carpeta_importaciones').select('*').in('estado', ['abierta', 'parcial']).order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return data ?? []
}

export async function crearImportacion(payload) {
  const { data, error } = await supabase.from('carpeta_importaciones').insert({ ...payload, estado: 'abierta' }).select('*').single()
  if (error) throw error
  return data
}

// ============ Vincular / Desvincular ============
export async function vincularRespaldo({ movimientoId, tipoRespaldo, facturaId, carpetaId, monto, observaciones, subtipoOtro }) {
  const { data: sess } = await supabase.auth.getSession()
  const userId = sess.session?.user?.id ?? null
  const obs = tipoRespaldo === 'otro' && subtipoOtro ? `[${subtipoOtro}] ${observaciones ?? ''}`.trim() : observaciones ?? null
  const row = { movimiento_id: movimientoId, tipo_respaldo: tipoRespaldo, factura_compra_id: facturaId ?? null, carpeta_importacion_id: carpetaId ?? null, monto_aplicado: monto, observaciones: obs, created_by: userId }
  const { error } = await supabase.from('conciliaciones').insert(row)
  if (error) throw error
  await refrescarEstadoMovimiento(movimientoId)
}

export async function desvincular(conciliacionId, movimientoId) {
  const { error } = await supabase.from('conciliaciones').delete().eq('id', conciliacionId)
  if (error) throw error
  await refrescarEstadoMovimiento(movimientoId)
}

export async function refrescarEstadoMovimiento(movimientoId) {
  const { data: mov } = await supabase.from('movimientos_bancarios').select('id, monto, conciliaciones(monto_aplicado)').eq('id', movimientoId).maybeSingle()
  if (!mov) return
  const aplicado = (mov.conciliaciones ?? []).reduce((acc, c) => acc + (Number(c.monto_aplicado) || 0), 0)
  const monto = Number(mov.monto) || 0
  const nuevoEstado = monto > 0 && aplicado >= monto - 0.5 ? 'conciliado' : 'clasificado'
  await supabase.from('movimientos_bancarios').update({ estado: nuevoEstado }).eq('id', movimientoId)
}

// ============ Extraer RUT ============
const RUT_REGEX_DOTTED = /(\d{1,2}\.\d{3}\.\d{3}-[\dkK])/
const RUT_REGEX_PLAIN = /(?<![\d])(\d{7,8}-[\dkK])(?![\d])/

export function extraerRut(desc) {
  if (!desc) return null
  const m1 = desc.match(RUT_REGEX_DOTTED)
  if (m1) return m1[1].replace(/\./g, '').toUpperCase()
  const m2 = desc.match(RUT_REGEX_PLAIN)
  if (m2) return m2[1].toUpperCase()
  return null
}
