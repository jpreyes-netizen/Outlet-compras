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

  // Adjuntar la clasificación (RUT → patrón → sin_clasificar) de v_clasificacion_pagos.
  // Un movimiento clasificado como traspaso/remuneración/tributario/etc. YA está
  // documentado por otra vía: no debe aparecer como "pendiente de conciliar".
  {
    const [{ data: clasif }, { data: cats }] = await Promise.all([
      supabase.from('v_clasificacion_pagos')
        .select('movimiento_id, categoria, via_clasificacion, patron_nombre')
        .limit(20000),
      supabase.from('clasif_pagos_categorias')
        .select('categoria, label, color_hex, es_anomalia'),
    ])
    const catMap = new Map((cats ?? []).map(c => [c.categoria, c]))
    const clasifMap = new Map((clasif ?? []).map(c => [c.movimiento_id, c]))
    mapped.forEach(m => {
      const c = clasifMap.get(m.movimiento_id)
      const cat = c ? catMap.get(c.categoria) : null
      m.categoria = c?.categoria ?? null
      m.categoria_label = cat?.label ?? null
      m.categoria_color = cat?.color_hex ?? null
      m.via_clasificacion = c?.via_clasificacion ?? null
      // Requiere conciliación = es anomalía (proveedor/honorarios/sin_clasificar).
      // Sin clasificación conocida (abonos, fechas antiguas) → true: no esconder lo desconocido.
      m.requiere_conciliacion = cat ? cat.es_anomalia === true : true
    })
  }

  if (filtros.estado !== 'todos') mapped = mapped.filter(m => m.estado_conciliacion === filtros.estado)
  if (filtros.soloSugerencia) mapped = mapped.filter(m => m.tiene_sugerencia)
  if (filtros.soloConciliables) mapped = mapped.filter(m => m.requiere_conciliacion)

  // Filtros adicionales (proveedor/RUT, categoría, rango de montos, antigüedad)
  if (filtros.proveedor?.trim()) {
    const p = filtros.proveedor.trim().toLowerCase().replace(/[.\-]/g, '')
    mapped = mapped.filter(m => (m.descripcion || '').toLowerCase().replace(/[.\-]/g, '').includes(p))
  }
  if (filtros.categoria && filtros.categoria !== 'todas') {
    mapped = mapped.filter(m => m.categoria === filtros.categoria)
  }
  if (filtros.montoMin !== '' && filtros.montoMin != null) {
    const min = Number(filtros.montoMin)
    if (!isNaN(min)) mapped = mapped.filter(m => Math.abs(m.monto) >= min)
  }
  if (filtros.montoMax !== '' && filtros.montoMax != null) {
    const max = Number(filtros.montoMax)
    if (!isNaN(max)) mapped = mapped.filter(m => Math.abs(m.monto) <= max)
  }
  if (filtros.diasMin !== '' && filtros.diasMin != null) {
    const dmin = Number(filtros.diasMin)
    if (!isNaN(dmin)) mapped = mapped.filter(m => {
      const dias = Math.round((Date.now() - new Date(m.fecha)) / 86400000)
      return dias >= dmin
    })
  }
  if (filtros.diasMax !== '' && filtros.diasMax != null) {
    const dmax = Number(filtros.diasMax)
    if (!isNaN(dmax)) mapped = mapped.filter(m => {
      const dias = Math.round((Date.now() - new Date(m.fecha)) / 86400000)
      return dias <= dmax
    })
  }
  return mapped
}

// ============ Vinculados ============
export async function fetchVinculados(movimientoId) {
  const { data: rows, error } = await supabase
    .from('conciliaciones')
    .select('id, movimiento_id, tipo_respaldo, factura_compra_id, carpeta_importacion_id, provision_id, monto_aplicado, observaciones, created_at')
    .eq('movimiento_id', movimientoId)
    .order('created_at', { ascending: true })
  if (error) throw error

  const conc = rows ?? []
  if (conc.length === 0) return []

  const facturaIds = conc.filter(c => c.factura_compra_id).map(c => c.factura_compra_id)
  const provisionIds = conc.filter(c => c.provision_id).map(c => c.provision_id)

  const facturasMap = new Map()
  if (facturaIds.length) {
    const { data: facs } = await supabase.from('libro_compras').select('id, folio, razon_social').in('id', facturaIds)
    ;(facs ?? []).forEach(f => facturasMap.set(f.id, { folio: f.folio, proveedor: f.razon_social }))
  }

  const provisionesMap = new Map()
  if (provisionIds.length) {
    const { data: provs } = await supabase.from('provisiones_aduana').select('id, folio_agencia, oc_id, agente_nombre').in('id', provisionIds)
    ;(provs ?? []).forEach(p => provisionesMap.set(p.id, { folio: p.folio_agencia ?? p.oc_id, proveedor: p.agente_nombre }))
  }

  return conc.map(c => {
    let folio = null, proveedor = null
    if (c.tipo_respaldo === 'factura_compra' && c.factura_compra_id) {
      const f = facturasMap.get(c.factura_compra_id)
      folio = f?.folio ?? null; proveedor = f?.proveedor ?? null
    } else if (c.tipo_respaldo === 'provision_aduana' && c.provision_id) {
      const p = provisionesMap.get(c.provision_id)
      folio = p?.folio ?? null; proveedor = p?.proveedor ?? null
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

// ============ Provisiones de aduana ============
// Modelo: la provisión es un ANTICIPO a cuenta corriente del agente.
// 1 provisión = 1 importación, pagada en N cargos bancarios (tope transferencia).
// La factura del agente NUNCA se concilia contra el banco: se salda contra la
// provisión (rendición) y se marca conciliable_banco=false en libro_compras.

export async function fetchProvisionesAbiertas() {
  const { data, error } = await supabase.from('v_provisiones_estado').select('*').neq('estado', 'cerrada').order('fecha_solicitud', { ascending: false, nullsFirst: false }).limit(200)
  if (error) throw error
  return data ?? []
}

export async function crearProvision(payload) {
  const { data: sess } = await supabase.auth.getSession()
  const userId = sess.session?.user?.id ?? null
  const { data, error } = await supabase.from('provisiones_aduana').insert({ ...payload, estado: 'abierta', created_by: userId }).select('*').single()
  if (error) throw error
  return data
}

export async function cerrarProvision(provisionId) {
  const { error } = await supabase.from('provisiones_aduana').update({ estado: 'cerrada' }).eq('id', provisionId)
  if (error) throw error
}

export async function fetchRendicion(provisionId) {
  const { data, error } = await supabase.from('provision_aduana_rendicion')
    .select('id, concepto, monto, es_factura_agente, factura_compra_id, notas, created_at')
    .eq('provision_id', provisionId).order('created_at', { ascending: true })
  if (error) throw error
  const lineas = data ?? []
  const facIds = lineas.filter(l => l.factura_compra_id).map(l => l.factura_compra_id)
  if (facIds.length) {
    const { data: facs } = await supabase.from('libro_compras').select('id, folio, monto_total').in('id', facIds)
    const fMap = new Map((facs ?? []).map(f => [f.id, f]))
    lineas.forEach(l => { l.factura = l.factura_compra_id ? fMap.get(l.factura_compra_id) ?? null : null })
  }
  return lineas
}

export async function agregarLineaRendicion({ provisionId, concepto, monto, esFacturaAgente, notas }) {
  const { error } = await supabase.from('provision_aduana_rendicion')
    .insert({ provision_id: provisionId, concepto, monto, es_factura_agente: esFacturaAgente, notas: notas ?? null })
  if (error) throw error
}

export async function eliminarLineaRendicion(linea) {
  // Si la línea tenía una factura neteada, revertir la marca en libro_compras
  if (linea.factura_compra_id) {
    await supabase.from('libro_compras')
      .update({ conciliable_banco: true, motivo_no_conciliable: null })
      .eq('id', linea.factura_compra_id)
  }
  const { error } = await supabase.from('provision_aduana_rendicion').delete().eq('id', linea.id)
  if (error) throw error
}

// Facturas del agente candidatas al neteo (por cuerpo de RUT, sin verificador)
export async function fetchFacturasAgente(agenteRut) {
  const cuerpo = String(agenteRut ?? '').replace(/[.\-]/g, '').replace(/[0-9kK]$/, '')
  if (!cuerpo) return []
  const { data, error } = await supabase.from('libro_compras')
    .select('id, folio, fecha_emision, monto_total, razon_social, conciliable_banco, motivo_no_conciliable')
    .ilike('rut_proveedor', `%${cuerpo}%`)
    .or('anulado.is.null,anulado.eq.false')
    .order('fecha_emision', { ascending: false }).limit(100)
  if (error) throw error
  return data ?? []
}

// FLUJO C — Neteo: la factura del agente queda "pagada vía provisión".
// Reusa el riel de Pieza 1 (v0.0.29): conciliable_banco + motivo_no_conciliable,
// que ya excluye la factura de v_ctrl_facturas_antiguas. Egreso contado UNA vez.
export async function netearFacturaConProvision({ lineaId, facturaId, folioProvision }) {
  const { error: e1 } = await supabase.from('provision_aduana_rendicion')
    .update({ factura_compra_id: facturaId }).eq('id', lineaId)
  if (e1) throw e1
  const { error: e2 } = await supabase.from('libro_compras')
    .update({ conciliable_banco: false, motivo_no_conciliable: `Pagada vía provisión aduana ${folioProvision ?? ''}`.trim() })
    .eq('id', facturaId)
  if (e2) throw e2
}

// ============ Vincular / Desvincular ============
export async function vincularRespaldo({ movimientoId, tipoRespaldo, facturaId, carpetaId, provisionId, monto, observaciones, subtipoOtro, movimiento, proveedorNombre }) {
  const { data: sess } = await supabase.auth.getSession()
  const userId = sess.session?.user?.id ?? null
  const obs = tipoRespaldo === 'otro' && subtipoOtro ? `[${subtipoOtro}] ${observaciones ?? ''}`.trim() : observaciones ?? null
  const row = { movimiento_id: movimientoId, tipo_respaldo: tipoRespaldo, factura_compra_id: facturaId ?? null, carpeta_importacion_id: carpetaId ?? null, provision_id: provisionId ?? null, monto_aplicado: monto, observaciones: obs, created_by: userId }
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
    .select('id, fecha_emision, folio, rut_proveedor, razon_social, monto_total, anulado, conciliable_banco, motivo_no_conciliable')
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

  // Filtro de estado: 'no_conciliable' es un pseudo-estado (no viene de v_estado_factura,
  // sino de la marca conciliable_banco). El resto de estados excluye las no-conciliables
  // por default, para no ensuciar el flujo normal con comisiones que nunca van al banco.
  if (filtros.estado === 'no_conciliable') {
    mapped = mapped.filter(f => f.conciliable_banco === false)
  } else if (filtros.estado && filtros.estado !== 'todos') {
    mapped = mapped.filter(f => f.estado_factura === filtros.estado && f.conciliable_banco !== false)
  } else if (filtros.estado === 'todos') {
    // 'todos' respeta el pedido explícito de ver todo, incluidas no-conciliables
  }

  // Marcar facturas con sugerencia del agente (badge ✨)
  const { data: sugs } = await supabase
    .from('ai_match_sugerencias')
    .select('factura_id')
    .eq('estado', 'pendiente')
    .limit(5000)
  const conSug = new Set((sugs ?? []).map(s => s.factura_id))
  mapped.forEach(f => { f.tiene_sugerencia = conSug.has(f.id) })

  // Filtros avanzados por monto y antigüedad (sobre el saldo pendiente)
  if (filtros.montoMin !== '' && filtros.montoMin != null) {
    const min = Number(filtros.montoMin)
    if (!isNaN(min)) mapped = mapped.filter(f => f.saldo >= min)
  }
  if (filtros.montoMax !== '' && filtros.montoMax != null) {
    const max = Number(filtros.montoMax)
    if (!isNaN(max)) mapped = mapped.filter(f => f.saldo <= max)
  }
  if (filtros.diasMin !== '' && filtros.diasMin != null) {
    const dmin = Number(filtros.diasMin)
    if (!isNaN(dmin)) mapped = mapped.filter(f => Math.round((Date.now() - new Date(f.fecha_emision)) / 86400000) >= dmin)
  }
  if (filtros.diasMax !== '' && filtros.diasMax != null) {
    const dmax = Number(filtros.diasMax)
    if (!isNaN(dmax)) mapped = mapped.filter(f => Math.round((Date.now() - new Date(f.fecha_emision)) / 86400000) <= dmax)
  }

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
// Stop words para el fallback por nombre (términos genéricos que no identifican al proveedor)
const STOP_NOMBRE = new Set(['SPA', 'LTDA', 'LIMITADA', 'SOCIEDAD', 'EIRL', 'S.A.', 'SA', 'CIA', 'COMERCIAL', 'COMERCIALIZADORA', 'IMPORTADORA', 'DISTRIBUIDORA', 'SERVICIOS', 'INGENIERIA', 'CONSTRUCTORA', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'E', 'CHILE'])

export async function fetchCargosCandidatos({ factura, texto }) {
  const saldoObjetivo = Number(factura?.saldo) || 0
  const fechaEmision = factura?.fecha_emision ?? null

  // ── Estrategia de búsqueda en cascada ──────────────────────────────────
  // 1º texto manual del usuario (si lo hay)
  // 2º cuerpo del RUT sin verificador (matchea glosas "0"+cuerpo+dv y variantes)
  // 3º fallback: token más distintivo de la razón social
  let data = null
  const t = texto?.trim()

  async function buscar(patron) {
    const { data: rows, error } = await supabase.from('movimientos_bancarios')
      .select('id, fecha, monto, descripcion, tipo, estado, conciliaciones(monto_aplicado)')
      .eq('tipo', 'CARGO')
      .eq('estado', 'clasificado')
      .ilike('descripcion', `%${patron}%`)
      .order('fecha', { ascending: false })
      .limit(300)
    if (error) throw error
    return rows ?? []
  }

  if (t) {
    data = await buscar(t)
  } else {
    const rutNorm = (factura?.rut_proveedor || '').replace(/[.\-]/g, '')
    const rutCuerpo = rutNorm.length >= 8 ? rutNorm.slice(0, -1) : rutNorm
    if (rutCuerpo.length >= 7) {
      data = await buscar(rutCuerpo)
    }
    // Fallback: si el RUT no aparece en ninguna glosa, buscar por nombre
    if ((!data || data.length === 0) && factura?.razon_social) {
      const tokens = factura.razon_social.toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4 && !STOP_NOMBRE.has(w))
      // El token más largo suele ser el más distintivo (ESPIRAL, AVSOLOMOVICH, AMELDOOR…)
      const token = tokens.sort((a, b) => b.length - a.length)[0]
      if (token) data = await buscar(token)
    }
    if (!data) return []
  }

  // ── Saldo disponible + score de relevancia ─────────────────────────────
  let cargos = data.map(m => {
    const aplicado = (m.conciliaciones ?? []).reduce((a, c) => a + (Number(c.monto_aplicado) || 0), 0)
    const montoAbs = Math.abs(Number(m.monto) || 0)
    return {
      movimiento_id: m.id, fecha: m.fecha, descripcion: m.descripcion ?? '',
      monto: Number(m.monto) || 0, montoAbs,
      saldoDisponible: montoAbs - aplicado,
    }
  }).filter(m => m.saldoDisponible > 0.5)

  cargos.forEach(c => {
    let score = 0
    // Monto (hasta 60): exacto al saldo de la factura = 60; decae con la distancia relativa
    if (saldoObjetivo > 0) {
      const difRel = Math.abs(c.saldoDisponible - saldoObjetivo) / saldoObjetivo
      if (difRel <= 0.005) score += 60
      else if (difRel <= 0.05) score += 45
      else if (difRel <= 0.15) score += 25
      else if (difRel <= 0.50) score += 10
    }
    // Coherencia temporal (hasta 20): el pago no puede preceder a la factura
    if (fechaEmision && c.fecha) {
      if (c.fecha >= fechaEmision) score += 20
    }
    // Proximidad (hasta 20): decae con los días transcurridos desde la emisión
    if (fechaEmision && c.fecha && c.fecha >= fechaEmision) {
      const dias = Math.round((new Date(c.fecha) - new Date(fechaEmision)) / 86400000)
      if (dias <= 35) score += 20
      else if (dias <= 95) score += 12   // crédito 60-90 días
      else if (dias <= 180) score += 5
    }
    c.score = score
  })

  // Relevancia primero; a igual score, el más cercano en monto
  cargos.sort((a, b) => b.score - a.score
    || Math.abs(a.saldoDisponible - saldoObjetivo) - Math.abs(b.saldoDisponible - saldoObjetivo))
  return cargos
}
