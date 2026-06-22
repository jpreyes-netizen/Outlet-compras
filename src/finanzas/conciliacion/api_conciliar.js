import { supabase } from '../../supabase'

// ============ helpers ============
function calcularEstado(monto, aplicado) {
  const m = Math.abs(Number(monto) || 0)   // magnitud del movimiento (CARGO viene negativo)
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
    .limit(20000)

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

  // Marcar cuáles movimientos tienen sugerencia pendiente del agente (badge ✨ y filtro).
  // Traemos directamente los movimiento_id con sugerencia (pocos) en vez de filtrar por
  // cientos de IDs en la URL, que puede truncarse silenciosamente.
  {
    const { data: sugs } = await supabase
      .from('ai_match_sugerencias')
      .select('movimiento_id')
      .eq('estado', 'pendiente')
      .limit(5000)
    const conSug = new Set((sugs ?? []).map(s => s.movimiento_id))
    mapped.forEach(m => { m.tiene_sugerencia = conSug.has(m.movimiento_id) })
  }

  if (filtros.estado !== 'todos') mapped = mapped.filter(m => m.estado_conciliacion === filtros.estado)
  if (filtros.soloSugerencia) mapped = mapped.filter(m => m.tiene_sugerencia)
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

// ============ Match scoring (Capa 1) ============
// Normaliza texto para comparación: minúsculas, sin tildes, sin puntuación, sin espacios extra
function normalizar(s) {
  if (!s) return ''
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

// Similitud entre 2 strings basada en tokens compartidos (Jaccard simplificado)
// 0 = nada en común, 1 = idéntico. Ignora tokens muy cortos (<3 chars) tipo "ltda", "spa"
function similitudTexto(a, b) {
  const STOPWORDS = new Set(['ltda', 'spa', 'sa', 'eirl', 'de', 'la', 'el', 'y', 'del', 'los', 'las'])
  const ta = new Set(normalizar(a).split(' ').filter(w => w.length >= 3 && !STOPWORDS.has(w)))
  const tb = new Set(normalizar(b).split(' ').filter(w => w.length >= 3 && !STOPWORDS.has(w)))
  if (ta.size === 0 || tb.size === 0) return 0
  let comunes = 0
  for (const w of ta) if (tb.has(w)) comunes++
  return comunes / Math.min(ta.size, tb.size)
}

// Días entre 2 fechas (string YYYY-MM-DD)
function diasEntre(fecha1, fecha2) {
  if (!fecha1 || !fecha2) return 9999
  const d1 = new Date(fecha1)
  const d2 = new Date(fecha2)
  return Math.abs(Math.round((d1 - d2) / (1000 * 60 * 60 * 24)))
}

/**
 * Calcula score 0-100 de match entre movimiento bancario y factura candidata.
 * Pesos: RUT 30, Monto 40, Fecha 15, Razón social 10, Historial 5
 * Devuelve { score, level, reasons } donde level es 'perfecto'|'probable'|'revisar'|'descartado'
 */
export function calcularMatchScore({ movimiento, factura }) {
  const reasons = []
  let score = 0

  const rutMov = extraerRut(movimiento.descripcion)
  const saldoMov = Number(movimiento.saldo_pendiente) || 0

  // 1) RUT (peso 30)
  if (rutMov && factura.rut_proveedor) {
    if (rutMov === factura.rut_proveedor.toUpperCase().replace(/\./g, '')) {
      score += 30
      reasons.push({ ok: true, txt: 'RUT exacto' })
    } else {
      reasons.push({ ok: false, txt: 'RUT distinto' })
    }
  } else if (rutMov && !factura.rut_proveedor) {
    reasons.push({ ok: false, txt: 'Factura sin RUT' })
  } else if (!rutMov && factura.rut_proveedor) {
    reasons.push({ ok: null, txt: 'Mov. sin RUT detectable' })
  }

  // 2) Monto (peso 40) — compara saldo_pendiente movimiento vs saldo factura
  const saldoFact = Number(factura.saldo) || Number(factura.monto_total) || 0
  if (saldoFact > 0 && saldoMov > 0) {
    const diff = Math.abs(saldoFact - saldoMov)
    const pct = diff / saldoMov
    if (pct < 0.001) {
      score += 40
      reasons.push({ ok: true, txt: 'Monto exacto' })
    } else if (pct <= 0.01) {
      score += 35
      reasons.push({ ok: true, txt: `Monto ±${(pct * 100).toFixed(1)}%` })
    } else if (pct <= 0.05) {
      score += 25
      reasons.push({ ok: true, txt: `Monto ±${(pct * 100).toFixed(1)}%` })
    } else if (pct <= 0.15) {
      score += 10
      reasons.push({ ok: null, txt: `Monto difiere ${(pct * 100).toFixed(0)}%` })
    } else {
      reasons.push({ ok: false, txt: `Monto difiere ${(pct * 100).toFixed(0)}%` })
    }
  }

  // 3) Fecha (peso 15) — proximidad fecha factura vs fecha movimiento
  const dias = diasEntre(movimiento.fecha, factura.fecha_emision)
  if (dias <= 7) {
    score += 15
    reasons.push({ ok: true, txt: `${dias}d entre fechas` })
  } else if (dias <= 30) {
    score += 10
    reasons.push({ ok: true, txt: `${dias}d entre fechas` })
  } else if (dias <= 60) {
    score += 5
    reasons.push({ ok: null, txt: `${dias}d entre fechas` })
  } else if (dias < 9999) {
    reasons.push({ ok: false, txt: `${dias}d entre fechas` })
  }

  // 4) Razón social en descripción (peso 10)
  if (factura.razon_social && movimiento.descripcion) {
    const sim = similitudTexto(factura.razon_social, movimiento.descripcion)
    if (sim >= 0.7) {
      score += 10
      reasons.push({ ok: true, txt: 'Razón social coincide' })
    } else if (sim >= 0.3) {
      score += 5
      reasons.push({ ok: true, txt: 'Razón social parcial' })
    }
  }

  // 5) Penalizar factura ya pagada
  if (factura.estado_factura === 'pagada') {
    score = Math.max(0, score - 30)
    reasons.push({ ok: false, txt: 'Factura ya pagada' })
  }

  // Nivel de match
  let level
  if (score >= 95) level = 'perfecto'
  else if (score >= 70) level = 'probable'
  else if (score >= 40) level = 'revisar'
  else level = 'descartado'

  return { score, level, reasons }
}

// ============ Facturas candidatas ============
export async function fetchFacturasCandidatas({ texto, saldoObjetivo, rutHint, movimiento }) {
  // Ampliamos rango: 50%-200% del saldo (el score filtra después)
  const min = Math.round(saldoObjetivo * 0.5)
  const max = Math.round(saldoObjetivo * 2.0)

  let q = supabase.from('libro_compras').select('id, fecha_emision, folio, rut_proveedor, razon_social, monto_total').gte('fecha_emision', '2026-01-01').order('fecha_emision', { ascending: false }).limit(200)

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
    const f = { ...x, monto_total: total, total_pagado: e?.total_pagado ?? 0, saldo: e?.saldo ?? total, estado_factura: e?.estado_factura ?? 'sin_pagar' }
    // Calcular score si tenemos el movimiento de contexto
    if (movimiento) {
      const { score, level, reasons } = calcularMatchScore({ movimiento, factura: f })
      f.match_score = score
      f.match_level = level
      f.match_reasons = reasons
    }
    return f
  })

  // Orden: 1) score desc si existe, 2) no pagadas primero, 3) cercanía de monto
  enriched.sort((a, b) => {
    if (a.match_score != null && b.match_score != null) return b.match_score - a.match_score
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
export async function vincularRespaldo({ movimientoId, tipoRespaldo, facturaId, carpetaId, monto, observaciones, subtipoOtro, movimiento, proveedorNombre }) {
  const { data: sess } = await supabase.auth.getSession()
  const userId = sess.session?.user?.id ?? null
  const obs = tipoRespaldo === 'otro' && subtipoOtro ? `[${subtipoOtro}] ${observaciones ?? ''}`.trim() : observaciones ?? null
  const row = { movimiento_id: movimientoId, tipo_respaldo: tipoRespaldo, factura_compra_id: facturaId ?? null, carpeta_importacion_id: carpetaId ?? null, monto_aplicado: monto, observaciones: obs, created_by: userId }
  const { error } = await supabase.from('conciliaciones').insert(row)
  if (error) throw error
  await refrescarEstadoMovimiento(movimientoId)
  // Guardar aprendizaje en background (no bloquea ni rompe si falla)
  if (movimiento) {
    guardarAprendizaje({ movimiento, tipoRespaldo, facturaId, carpetaId, proveedorNombre }).catch(() => {})
  }
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

// ============ Capa 2: Memoria de conciliación ============

// Limpia la descripción para extraer patrón reutilizable:
// elimina RUTs, números largos (montos, folios, referencias), fechas, deja solo palabras clave
export function extraerPatron(descripcion) {
  if (!descripcion) return ''
  return descripcion
    .replace(/\d{1,2}\.\d{3}\.\d{3}-[\dkK]/gi, '')   // RUT con puntos
    .replace(/\d{7,8}-[\dkK]/gi, '')                   // RUT sin puntos
    .replace(/\b\d{6,}\b/g, '')                        // números largos (montos, refs)
    .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, '') // fechas
    .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ ]/g, ' ')         // solo letras
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 120)                                      // máx 120 chars
}

// Busca sugerencia aprendida para un movimiento dado
// Devuelve el registro con más aciertos que coincida por RUT o patrón de descripción
export async function buscarAprendizaje(movimiento) {
  const rut = extraerRut(movimiento.descripcion)
  const patron = extraerPatron(movimiento.descripcion)
  if (!rut && !patron) return null

  // Buscar por RUT primero (más confiable), luego por patrón
  let candidatos = []
  if (rut) {
    const { data } = await supabase.from('conciliacion_aprendizaje')
      .select('*').eq('rut_proveedor', rut)
      .order('aciertos', { ascending: false }).limit(5)
    candidatos = data ?? []
  }

  // Si no hay por RUT, buscar por patrón (coincidencia parcial)
  if (candidatos.length === 0 && patron.length >= 6) {
    const palabrasClave = patron.split(' ').filter(p => p.length >= 4).slice(0, 3)
    for (const pal of palabrasClave) {
      const { data } = await supabase.from('conciliacion_aprendizaje')
        .select('*').ilike('patron', `%${pal}%`)
        .order('aciertos', { ascending: false }).limit(5)
      if (data?.length) { candidatos = data; break }
    }
  }

  if (candidatos.length === 0) return null
  // Devolver el de más aciertos
  return candidatos[0]
}

// Guarda o actualiza un aprendizaje al conciliar manualmente
export async function guardarAprendizaje({ movimiento, tipoRespaldo, facturaId, carpetaId, proveedorNombre }) {
  const { data: sess } = await supabase.auth.getSession()
  const userId = sess.session?.user?.id ?? null
  const rut = extraerRut(movimiento.descripcion)
  const patron = extraerPatron(movimiento.descripcion)
  if (!patron) return  // descripción sin patrón útil, no guardar

  // Buscar si ya existe un registro con ese patrón+tipo
  const { data: existing } = await supabase.from('conciliacion_aprendizaje')
    .select('id, aciertos')
    .eq('patron', patron)
    .eq('tipo_respaldo', tipoRespaldo)
    .maybeSingle()

  if (existing) {
    // Actualizar aciertos + datos del ejemplo más reciente
    await supabase.from('conciliacion_aprendizaje').update({
      aciertos: existing.aciertos + 1,
      ultima_vez: new Date().toISOString(),
      factura_id_ej: facturaId ?? null,
      carpeta_id_ej: carpetaId ?? null,
      proveedor_nombre: proveedorNombre ?? null,
      rut_proveedor: rut ?? null,
    }).eq('id', existing.id)
  } else {
    await supabase.from('conciliacion_aprendizaje').insert({
      patron,
      rut_proveedor: rut ?? null,
      tipo_respaldo: tipoRespaldo,
      factura_id_ej: facturaId ?? null,
      carpeta_id_ej: carpetaId ?? null,
      proveedor_nombre: proveedorNombre ?? null,
      aciertos: 1,
      created_by: userId,
    })
  }
}

// ════════════════════════════════════════════════════════════════════════
// FLUJO "DESDE FACTURAS": parte del libro de compras → busca el pago
// ════════════════════════════════════════════════════════════════════════

// Lista facturas del libro de compras 2026 con su estado de conciliación.
// filtros: { desde, hasta, estado ('todos'|'sin_pagar'|'parcial'|'pagada'), texto }
export async function fetchFacturas(filtros = {}) {
  let q = supabase.from('libro_compras')
    .select('id, fecha_emision, folio, rut_proveedor, razon_social, monto_total, anulado')
    .eq('anulado', false)
    .gte('fecha_emision', '2026-01-01')
    .order('fecha_emision', { ascending: false })
    .limit(20000)
  if (filtros.desde) q = q.gte('fecha_emision', filtros.desde)
  if (filtros.hasta) q = q.lte('fecha_emision', filtros.hasta)
  if (filtros.texto?.trim()) {
    const t = filtros.texto.trim()
    q = q.or(`razon_social.ilike.%${t}%,rut_proveedor.ilike.%${t}%,folio.ilike.%${t}%`)
  }
  const { data, error } = await q
  if (error) throw error

  // Estado de conciliación de cada factura
  const { data: est } = await supabase
    .from('v_estado_factura')
    .select('factura_id, total_pagado, saldo, estado_factura')
    .limit(20000)
  const eMap = new Map((est ?? []).map(e => [e.factura_id, e]))

  let mapped = (data ?? []).map(f => {
    const e = eMap.get(f.id)
    return {
      ...f,
      monto_total: Number(f.monto_total) || 0,
      saldo: Number(e?.saldo ?? f.monto_total) || 0,
      total_pagado: Number(e?.total_pagado) || 0,
      estado_factura: e?.estado_factura ?? 'sin_pagar',
    }
  })

  if (filtros.estado && filtros.estado !== 'todos') {
    mapped = mapped.filter(f => f.estado_factura === filtros.estado)
  }

  // Marcar facturas con sugerencia del agente (badge ✨)
  const { data: sugs } = await supabase
    .from('ai_match_sugerencias')
    .select('factura_id')
    .eq('estado', 'pendiente')
    .limit(5000)
  const conSug = new Set((sugs ?? []).map(s => s.factura_id))
  mapped.forEach(f => { f.tiene_sugerencia = conSug.has(f.id) })

  return mapped
}

// Sugerencias del agente PARA una factura específica (los cargos que la pagarían)
export async function fetchSugerenciasDeFactura(facturaId) {
  const { data, error } = await supabase
    .from('ai_match_sugerencias')
    .select('*')
    .eq('factura_id', facturaId)
    .eq('estado', 'pendiente')
  if (error) throw error
  return data ?? []
}

// Cargos del banco candidatos para pagar una factura.
// Si hay texto manual, busca por descripción. Si no, busca por el RUT del
// proveedor en la glosa del banco (formato sin puntos/guión).
export async function fetchCargosCandidatos({ factura, texto }) {
  let q = supabase.from('movimientos_bancarios')
    .select('id, fecha, monto, descripcion, tipo, estado, conciliaciones(monto_aplicado)')
    .eq('tipo', 'CARGO')
    .eq('estado', 'clasificado')
    .order('fecha', { ascending: false })
    .limit(300)

  const t = texto?.trim()
  if (t) {
    q = q.ilike('descripcion', `%${t}%`)
  } else {
    // RUT del proveedor sin puntos ni guión (ej "77965751-5" → "779657515")
    const rutBusca = (factura?.rut_proveedor || '').replace(/[.\-]/g, '')
    if (rutBusca && rutBusca.length >= 7) {
      q = q.ilike('descripcion', `%${rutBusca}%`)
    } else {
      // sin RUT útil: no precargar nada, esperar búsqueda manual
      return []
    }
  }

  const { data, error } = await q
  if (error) throw error

  // Calcular saldo disponible de cada cargo (monto − ya aplicado) y descartar los agotados
  let cargos = (data ?? []).map(m => {
    const aplicado = (m.conciliaciones ?? []).reduce((a, c) => a + (Number(c.monto_aplicado) || 0), 0)
    const montoAbs = Math.abs(Number(m.monto) || 0)
    return {
      movimiento_id: m.id, fecha: m.fecha, descripcion: m.descripcion ?? '',
      monto: Number(m.monto) || 0, montoAbs,
      saldoDisponible: montoAbs - aplicado,
    }
  }).filter(m => m.saldoDisponible > 0.5)

  // Ordenar por cercanía al saldo de la factura
  const objetivo = Number(factura?.saldo) || 0
  cargos.sort((a, b) => Math.abs(a.saldoDisponible - objetivo) - Math.abs(b.saldoDisponible - objetivo))
  return cargos
}
