// ═══════════════════════════════════════════════════════════════════════════
// INTEGRACIÓN OC (ERP Compras) ↔ RECEPCIÓN (Logística)
// Módulo compartido — importado por LogisticaApp. NO modifica App.jsx.
//
// Contrato con Compras (espejo del flujo moderno de OCDetView/guardarRecepcion):
//  · recepciones        {id,oc_id,tipo,numero_doc,fecha,monto,moneda,notas,registrado_por}
//  · recepciones_items  {id,recepcion_id,oc_item_id,sku,producto,cantidad}
//  · firmas             {id,oc_id,usuario_id,nombre_usuario,rol_usuario,accion,firma_digital,fecha,hora}
//  · ordenes_compra     estado → 'Recibida OK' (≥100%) / 'Recibida parcial' (>0%),
//                       fase_actual (Importación=13 / Nacional=6), fecha_real_recepcion,
//                       recepcion_cuadrada, recepcion_forzada — misma matemática que Compras:
//                       solo tipos 'guia' y 'guia_factura' acumulan unidades por SKU.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from '../supabase'
import { uid, hoy, hora } from './constants'

export const ESTADOS_ARRIBO = ['Despacho nac.', 'Transporte', 'Internación']
export const PUEDE_RECEPCIONAR_OC = ['admin', 'jefe_bodega', 'coordinador', 'jefe_sucursal']
const TIPOS_QUE_SUMAN = ['guia', 'guia_factura']

// Logística usa TIPOS_DOC_REC=['Guia','Factura','Boleta','Otro'] → enum de Compras.
// 'Factura' se mapea a 'guia_factura' para que las unidades cuenten en el acumulado
// (en Compras, tipo 'factura' pura no suma unidades — es solo documento de cobro).
export const mapTipoDocACompras = (t) => {
  const s = (t || '').toLowerCase()
  return s.includes('fact') ? 'guia_factura' : 'guia'
}

// ── Acumulado ya recibido por SKU de una OC (misma lógica que Compras) ──────
async function fetchAcumuladoOC(ocId) {
  const { data: recs, error: e1 } = await supabase.from('recepciones')
    .select('id,tipo').eq('oc_id', ocId).in('tipo', TIPOS_QUE_SUMAN)
  if (e1) throw e1
  const ids = (recs || []).map(r => r.id)
  if (!ids.length) return {}
  const { data: items, error: e2 } = await supabase.from('recepciones_items')
    .select('recepcion_id,sku,cantidad').in('recepcion_id', ids)
  if (e2) throw e2
  const acc = {}
  ;(items || []).forEach(i => { acc[i.sku] = (acc[i.sku] || 0) + Number(i.cantidad || 0) })
  return acc
}

// ── Arribos programados: OCs en camino + parciales con saldo pendiente ──────
// Criterio "todo lo activo" (decisión JP, alineado al módulo Tránsito de Compras):
// se excluyen cerradas/rechazadas/pendientes de directorio/Recibida OK, y también
// Dividida/Fusionada (OCs muertas — sus ítems viven en otra OC; recepcionar contra
// ellas corrompería el flujo). 'Recibida parcial' se mantiene solo con saldo > 0.
const ESTADOS_EXCLUIDOS = ['Cerrada','Rechazada','Pend. Dir. Negocios','Pend. Dir. Finanzas','Recibida OK','Dividida','Fusionada']

export async function fetchArribosOC() {
  const [{ data: ocs, error: e1 }, { data: provs }] = await Promise.all([
    supabase.from('ordenes_compra')
      .select('id,estado,tipo_oc,fecha_estimada,fecha_creacion,proveedor_id,total_clp,total_usd,fecha_real_recepcion')
      .not('estado', 'in', '("' + ESTADOS_EXCLUIDOS.join('","') + '")')
      .order('fecha_estimada', { ascending: true, nullsFirst: false }),
    supabase.from('proveedores').select('id,nombre'),
  ])
  if (e1) throw e1
  if (!ocs || !ocs.length) return []
  const provMap = {}
  ;(provs || []).forEach(p => { provMap[p.id] = p.nombre })

  const ocIds = ocs.map(o => o.id)
  const [{ data: allItems, error: e2 }, { data: recs }] = await Promise.all([
    supabase.from('oc_items')
      .select('id,oc_id,sku,producto,cantidad_pedida,costo_unitario').in('oc_id', ocIds),
    supabase.from('recepciones').select('id,oc_id,tipo').in('oc_id', ocIds).in('tipo', TIPOS_QUE_SUMAN),
  ])
  if (e2) throw e2
  const recIds = (recs || []).map(r => r.id)
  let recItems = []
  if (recIds.length) {
    const { data } = await supabase.from('recepciones_items')
      .select('recepcion_id,sku,cantidad').in('recepcion_id', recIds)
    recItems = data || []
  }
  const recPorOC = {}
  ;(recs || []).forEach(r => { recPorOC[r.id] = r.oc_id })
  const accPorOC = {} // {oc_id: {sku: cant}}
  recItems.forEach(ri => {
    const ocId = recPorOC[ri.recepcion_id]
    if (!ocId) return
    accPorOC[ocId] = accPorOC[ocId] || {}
    accPorOC[ocId][ri.sku] = (accPorOC[ocId][ri.sku] || 0) + Number(ri.cantidad || 0)
  })

  const hoyStr = hoy()
  return ocs.map(oc => {
    const acc = accPorOC[oc.id] || {}
    const items = (allItems || []).filter(i => i.oc_id === oc.id).map(i => {
      const recibido = acc[i.sku] || 0
      return {
        oc_item_id: i.id, sku: i.sku, producto: i.producto,
        cantidad_pedida: Number(i.cantidad_pedida || 0),
        costo_unitario: Number(i.costo_unitario || 0),
        recibido, pendiente: Math.max(0, Number(i.cantidad_pedida || 0) - recibido),
      }
    })
    const totalPedido = items.reduce((s, i) => s + i.cantidad_pedida, 0)
    const totalRecibido = items.reduce((s, i) => s + i.recibido, 0)
    const totalPendiente = items.reduce((s, i) => s + i.pendiente, 0)
    const diasAtraso = oc.fecha_estimada && oc.fecha_estimada < hoyStr
      ? Math.round((new Date(hoyStr + 'T12:00:00') - new Date(oc.fecha_estimada + 'T12:00:00')) / 86400000)
      : 0
    return {
      oc, proveedorNombre: provMap[oc.proveedor_id] || oc.proveedor_id || '—',
      items, totalPedido, totalRecibido, totalPendiente,
      pct: totalPedido > 0 ? Math.round(totalRecibido / totalPedido * 100) : 0,
      diasAtraso, esParcial: oc.estado === 'Recibida parcial',
      enCamino: ESTADOS_ARRIBO.includes(oc.estado) || oc.estado === 'Recibida parcial',
    }
  }).filter(a => !a.esParcial || a.totalPendiente > 0) // parciales solo si les queda saldo
}

// ── Validación anti-sobre-recepción (misma regla que Compras) ───────────────
// items: [{sku, cantidad}]
export async function validarRecepcionContraOC(ocId, items) {
  const { data: oc, error: e1 } = await supabase.from('ordenes_compra')
    .select('id,estado').eq('id', ocId).maybeSingle()
  if (e1) return { ok: false, error: e1.message }
  if (!oc) return { ok: false, error: `La OC "${ocId}" no existe en el ERP — revisa el campo Orden de compra` }
  const { data: ocItems, error: e2 } = await supabase.from('oc_items')
    .select('sku,producto,cantidad_pedida').eq('oc_id', ocId)
  if (e2) return { ok: false, error: e2.message }
  const acc = await fetchAcumuladoOC(ocId)
  const porSku = {}
  ;(ocItems || []).forEach(i => { porSku[i.sku] = i })
  const errores = []
  for (const it of items) {
    const ref = porSku[it.sku]
    if (!ref) { errores.push(`${it.sku}: no pertenece a la OC ${ocId}`); continue }
    const pend = Number(ref.cantidad_pedida || 0) - (acc[it.sku] || 0)
    if (Number(it.cantidad || 0) > pend) {
      errores.push(`${ref.producto || it.sku}: recibiendo ${it.cantidad}, pendiente ${pend}`)
    }
  }
  return errores.length ? { ok: false, error: 'Sobre-recepción — ' + errores.join(' · ') } : { ok: true }
}

// ── Espejo completo hacia Compras ───────────────────────────────────────────
// items: [{sku, producto, cantidad}] · Devuelve {pct, estado}
export async function registrarRecepcionEnCompras({ ocId, tipoDoc, numeroDoc, fecha, items, cu, rolLabel, notas, archivoUrl = null, archivoNombre = null }) {
  const { data: oc, error: e0 } = await supabase.from('ordenes_compra')
    .select('id,estado,tipo_oc,fecha_real_recepcion').eq('id', ocId).single()
  if (e0) throw new Error(`OC ${ocId}: ${e0.message}`)
  const { data: ocItems, error: e1 } = await supabase.from('oc_items')
    .select('id,sku,producto,cantidad_pedida').eq('oc_id', ocId)
  if (e1) throw e1
  const acc = await fetchAcumuladoOC(ocId)

  // Revalidación defensiva (la UI ya validó antes de guardar en Logística)
  const porSku = {}
  ;(ocItems || []).forEach(i => { porSku[i.sku] = i })
  for (const it of items) {
    const ref = porSku[it.sku]
    if (!ref) throw new Error(`${it.sku} no pertenece a la OC ${ocId}`)
    const pend = Number(ref.cantidad_pedida || 0) - (acc[it.sku] || 0)
    if (Number(it.cantidad || 0) > pend) throw new Error(`${it.sku}: recibiendo ${it.cantidad}, pendiente ${pend}`)
  }

  const tipo = mapTipoDocACompras(tipoDoc)
  const totalCant = items.reduce((s, i) => s + Number(i.cantidad || 0), 0)

  // 1 · Cabecera en recepciones
  const recId = uid()
  const { error: eR } = await supabase.from('recepciones').insert({
    id: recId, oc_id: ocId, tipo, numero_doc: (numeroDoc || 'S/N').trim(),
    fecha: fecha, monto: null, moneda: null,
    archivo_url: archivoUrl, archivo_nombre: archivoNombre,
    notas: notas ? `[Logística] ${notas}` : '[Logística] Recepción registrada desde el módulo Logística',
    registrado_por: cu?.id || null,
  })
  if (eR) throw eR

  // 2 · Detalle por SKU
  const rows = items.map(it => ({
    id: uid(), recepcion_id: recId,
    oc_item_id: porSku[it.sku]?.id || null,
    sku: it.sku, producto: it.producto || porSku[it.sku]?.producto || it.sku,
    cantidad: Number(it.cantidad || 0),
  }))
  const { error: eI } = await supabase.from('recepciones_items').insert(rows)
  if (eI) throw eI

  // 3 · Firma en el timeline de la OC
  const labelTipo = tipo === 'guia_factura' ? 'Guía+Factura' : 'Guía'
  const { error: eF } = await supabase.from('firmas').insert({
    id: uid(), oc_id: ocId, usuario_id: cu?.id || null,
    nombre_usuario: cu?.nombre || 'Logística', rol_usuario: rolLabel || 'Logística',
    accion: `${labelTipo} #${(numeroDoc || 'S/N').trim()} registrada desde Logística: ${totalCant} uds · ${items.length} SKU(s)`,
    firma_digital: cu?.firma_digital || null, fecha: hoy(), hora: hora(),
  })
  if (eF) throw eF

  // 4 · Recalcular acumulado → estado de la OC (misma matemática que Compras)
  const nuevoAcc = { ...acc }
  items.forEach(it => { nuevoAcc[it.sku] = (nuevoAcc[it.sku] || 0) + Number(it.cantidad || 0) })
  const totalPedido = (ocItems || []).reduce((s, i) => s + Number(i.cantidad_pedida || 0), 0)
  const totalRecibido = Object.values(nuevoAcc).reduce((s, v) => s + v, 0)
  const pct = totalPedido > 0 ? totalRecibido / totalPedido * 100 : 0
  const esImp = oc.tipo_oc === 'Importación'
  let up = null
  if (pct >= 100) up = { estado: 'Recibida OK', fase_actual: esImp ? 13 : 6, fecha_real_recepcion: fecha, recepcion_cuadrada: true, recepcion_forzada: false }
  else if (pct > 0) up = { estado: 'Recibida parcial', fase_actual: esImp ? 13 : 6, fecha_real_recepcion: oc.fecha_real_recepcion || fecha, recepcion_cuadrada: false }
  if (up) {
    const { error: eU } = await supabase.from('ordenes_compra').update(up).eq('id', ocId)
    if (eU) throw eU
  }
  return { pct: Math.round(pct), estado: up ? up.estado : oc.estado }
}
