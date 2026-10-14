/* ════════════════════════════════════════════════════════════════════
   invData.js — única capa de acceso a datos del módulo Inventario
   Outlet de Puertas SpA

   Toda la matemática de reposición vive en vistas SQL, no en el cliente.
   Reemplaza a engine.js, que recalculaba en el navegador sobre un Excel
   subido a mano y con supuestos que no aplican a nuestra demanda:
   normalidad, sin corrección por quiebre, y CD mezclado con tienda.

     v_inv_kpi_sku          decisión por SKU × sucursal
     v_inv_red              decisión de compra a nivel red + ABC/XYZ
     v_inv_prioridad_compra orden de compra bajo capital escaso
     v_inv_asignacion       reparto del CD a tiendas (fair share)
     v_inv_salud_datos      frescura de la fuente
   ════════════════════════════════════════════════════════════════════ */

import { supabase } from '../supabase'

const LIMITE = 20000

/* ── Ubicaciones canónicas. CD y bodegas NO son puntos de venta ───── */
export const SUCURSALES = [
  { id: 'suc-lg',    nombre: 'La Granja',    vende: true },
  { id: 'suc-la',    nombre: 'Los Ángeles',  vende: true },
  { id: 'suc-maipu', nombre: 'Tienda Maipú', vende: true },
  { id: 'suc-mp',    nombre: 'CD Maipú',     vende: false },
]
export const nombreSuc = id => SUCURSALES.find(s => s.id === id)?.nombre || id || '—'
export const SALAS = SUCURSALES.filter(s => s.vende)

/* ── Paletas y leyendas ───────────────────────────────────────────── */
export const CL_ESTADO = {
  QUIEBRE: '#B42318', CRITICO: '#D1442F', REPONER: '#B25E09',
  OK: '#1E7A44', EXCESO: '#1D4E89', 'SIN ROTACION': '#6E6E73', MUERTO: '#5B2C6F',
}
export const ESTADOS = Object.keys(CL_ESTADO)
export const CL_ABC = { A: '#1E7A44', B: '#1D4E89', C: '#B25E09', D: '#6E6E73' }
export const CL_PATRON = {
  SUAVE: '#1E7A44', ERRATICA: '#B25E09', INTERMITENTE: '#1D4E89',
  GRUMOSA: '#B42318', SIN_DEMANDA: '#6E6E73',
}
export const AYUDA_PATRON = {
  SUAVE: 'Venta frecuente y pareja. Stock de seguridad por distribución normal.',
  ERRATICA: 'Venta frecuente pero de tamaño muy variable.',
  INTERMITENTE: 'Venta espaciada, tamaño estable. Stock de seguridad por Poisson compuesta.',
  GRUMOSA: 'Venta espaciada y de tamaño variable. El caso más difícil de predecir.',
  SIN_DEMANDA: 'Sin ventas en los últimos 84 días.',
}
export const LEYENDA_ABC_XYZ = {
  AX: 'Motor del negocio, demanda predecible. Nunca deben quebrar.',
  AY: 'Alto margen, demanda variable. Requieren más stock de seguridad.',
  AZ: 'Alto margen, impredecibles. Comprar seguido y poco.',
  BX: 'Aportan margen con demanda estable. Reposición automática.',
  BY: 'Margen medio, variabilidad media.',
  BZ: 'Margen medio, muy variables. Candidatos a comprar contra pedido.',
  CX: 'Bajo margen pero predecibles. Mantener mínimos.',
  CY: 'Bajo margen, variables. Revisar si justifican espacio.',
  CZ: 'Bajo margen e impredecibles. Candidatos a descontinuar.',
  DX: 'Sin margen. Revisar precio o costo.',
  DY: 'Sin margen y variables. Liquidar.',
  DZ: 'Sin margen ni rotación. Liquidar o descontinuar.',
}

/* ── Consultas ────────────────────────────────────────────────────── */
async function pedir(vista, armar) {
  let q = supabase.from(vista).select('*').limit(LIMITE)
  if (armar) q = armar(q)
  const { data, error } = await q
  if (error) throw new Error(`${vista}: ${error.message}`)
  return data || []
}

export const fetchKpiSku     = () => pedir('v_inv_kpi_sku', q => q.eq('vende', true))
export const fetchRed        = () => pedir('v_inv_red')
export const fetchPrioridad  = () => pedir('v_inv_prioridad_compra', q => q.order('prioridad'))
export const fetchAsignacion = () => pedir('v_inv_asignacion', q => q.gt('enviar_sugerido', 0))
export const fetchPoliticas  = () => pedir('inv_politica_tipo', q => q.order('tipo_producto'))
export const fetchScorecard  = () => pedir('v_inv_scorecard')
export const fetchComparable = () => pedir('v_inv_comparable')
export const fetchRebalanceo = () => pedir('v_inv_rebalanceo', q => q.order('venta_recuperable', { ascending: false }))

/* ── Capital, inmovilizados, capacidad y Pareto ───────────────────── */
export const fetchCapitalBodega    = () => pedir('v_inv_capital_bodega')
export const fetchCapacidadResumen = () => pedir('v_inv_capacidad_resumen')
export const fetchCapacidad        = () => pedir('v_inv_capacidad', q => q.neq('uso', 'BIEN USADA'))
export const fetchPareto           = () => pedir('v_inv_pareto_categoria')
export const fetchHistoria         = () => pedir('inv_capital_historia', q => q.order('fecha', { ascending: false }).limit(200))

export function fetchInmovilizado() {
  // Sólo lo que no está activo (es lo que requiere decisión) y sólo las columnas que se muestran
  const cols = 'sku,producto,tipo_producto,sucursal_id,vende,stock,costo_unit,valor_costo,demanda_dia,' +
    'dias_cobertura,nivel_objetivo,unid_exceso,ultima_venta,ultima_venta_red,ultimo_despacho,ultima_llegada,' +
    'dias_inmovil,dias_es_minimo,sala_destino,nivel,accion,alerta_id,alerta_estado,alerta_desde,alerta_nota,alerta_carga_inicial'
  return supabase.from('v_inv_inmovilizado').select(cols).neq('nivel', 'ACTIVO')
    .order('valor_costo', { ascending: false }).limit(LIMITE)
    .then(({ data, error }) => { if (error) throw new Error('v_inv_inmovilizado: ' + error.message); return data || [] })
}

/* ── Reglas de negocio editables ──────────────────────────────────── */
export const CONFIG_DEFECTO = {
  dias_activo: 30, dias_lento: 90, dias_inmovilizado: 180,
  factor_sobredimension: 2, factor_desbalance: 2, dias_reposicion_sala: 14,
}
export async function fetchConfig() {
  const { data, error } = await supabase.from('inv_config').select('*').eq('id', 1).maybeSingle()
  if (error || !data) return CONFIG_DEFECTO
  return { ...CONFIG_DEFECTO, ...data }
}
export async function guardarConfig(campos, usuario) {
  const { error } = await supabase.from('inv_config')
    .update({ ...campos, actualizado_at: new Date().toISOString(), actualizado_por: usuario || null }).eq('id', 1)
  if (error) throw new Error(error.message)
}
export async function validarPolitica(tipo, validado, usuario) {
  const { error } = await supabase.from('inv_politica_tipo').update({
    validado, validado_por: validado ? usuario || null : null,
    validado_at: validado ? new Date().toISOString() : null,
  }).eq('tipo_producto', tipo)
  if (error) throw new Error(error.message)
}

/* ── Gestión de alertas ───────────────────────────────────────────── */
export async function gestionarAlerta(id, estado, nota, usuario) {
  const campos = { estado, nota: nota || null, gestionada_por: usuario || null, gestionada_at: new Date().toISOString() }
  if (estado === 'resuelta') Object.assign(campos, { resuelta_el: new Date().toISOString().slice(0, 10), motivo_cierre: 'Cerrada manualmente' })
  const { error } = await supabase.from('inv_alertas').update(campos).eq('id', id)
  if (error) throw new Error(error.message)
}

/* ── Antigüedad ───────────────────────────────────────────────────────
   Días sin moverse = desde el último movimiento o la última llegada,
   lo más reciente. Movimiento: venta en sala, despacho en el CD.     */
export function nivelesDesde(cfg = CONFIG_DEFECTO) {
  const a = cfg.dias_activo, l = cfg.dias_lento, i = cfg.dias_inmovilizado
  return [
    { k: 'ACTIVO',       c: '#1E7A44', l: 'Activo',         d: `Se movió en los últimos ${a} días. Capital trabajando.` },
    { k: 'NUEVO',        c: '#1D4E89', l: 'Recién llegado', d: `Llegó hace ${a} días o menos y aún no se mueve. Se vigila, no se alarma.` },
    { k: 'LENTO',        c: '#B25E09', l: 'Lento',          d: `${a + 1} a ${l} días sin moverse. Todavía se puede actuar barato.` },
    { k: 'INMOVILIZADO', c: '#D1442F', l: 'Inmovilizado',   d: `${l + 1} a ${i} días sin moverse. Capital detenido: abre una alerta.` },
    { k: 'MUERTO',       c: '#5B2C6F', l: 'Muerto',         d: `Más de ${i} días sin moverse. Liquidar, transferir o pasar a segunda selección.` },
  ]
}
export const NIVELES = nivelesDesde()
export const CL_NIVEL = Object.fromEntries(NIVELES.map(n => [n.k, n.c]))

export const ACCIONES = {
  'Distribuir a salas':                   'Está en el CD y hay salas que lo venden y lo necesitan: falta despacharlo.',
  'Transferir a sala que sí vende':       'Aquí no se mueve, pero otra sala lo vende y está bajo su cobertura. No es stock muerto: está en el lugar equivocado.',
  'Suspender recompra':                   'La red lo vende, pero el CD tiene más de lo que las salas necesitan. No comprar hasta que baje.',
  'Liquidar o pasar a segunda selección': 'No se vende en ninguna sala hace más del umbral de "muerto", o nunca.',
  'Exhibir mejor o promocionar':          'Se vende en la red pero aquí se está quedando. Primero visibilidad, después precio.',
  'Rebajar precio':                       'Lleva tiempo quieto y no tiene otra salida en la red.',
}

export const ESTADOS_ALERTA = {
  abierta:    { l: 'Sin gestionar', c: '#B42318' },
  en_gestion: { l: 'En gestión',    c: '#B25E09' },
  resuelta:   { l: 'Resuelta',      c: '#1E7A44' },
}

/* Cómo se usa cada posición física, comparada con lo que su producto debería guardar */
export function usosDesde(cfg = CONFIG_DEFECTO) {
  return [
    { k: 'BIEN USADA',        c: '#1E7A44', d: 'Producto que se vende, en una posición del tamaño adecuado a su rotación.' },
    { k: 'SOBREDIMENSIONADA', c: '#1D4E89', d: `La posición es más de ${cfg.factor_sobredimension} veces el máximo que el producto debería guardar: sobra espacio.` },
    { k: 'SUBDIMENSIONADA',   c: '#7C3AED', d: `No alcanza a guardar ${cfg.dias_reposicion_sala} días de venta más el stock de seguridad: obliga a reponer más seguido o a desbordar.` },
    { k: 'DESBORDADA',        c: '#8E1B10', d: 'Hoy hay más unidades que su capacidad: el excedente ocupa pasillo o zona sin plano.' },
    { k: 'LENTO',             c: '#B25E09', d: 'Ocupada por un producto que se está poniendo lento.' },
    { k: 'INMOVILIZADO',      c: '#D1442F', d: 'Ocupada por un producto detenido: espacio que no trabaja.' },
    { k: 'EN QUIEBRE',        c: '#B42318', d: 'Vacía porque el producto se acabó y sí se vende. No es espacio ocioso: es venta perdida, hay que reponer.' },
    { k: 'VACÍA',             c: '#5B2C6F', d: 'Reservada para un producto sin stock y sin demanda: espacio ocioso, se puede reasignar.' },
    { k: 'SIN CAPACIDAD',     c: '#9A9AA0', d: 'Posición sin capacidad máxima en el plano: no se puede evaluar.' },
  ]
}
export const USOS = usosDesde()
export const CL_USO = Object.fromEntries(USOS.map(u => [u.k, u.c]))


/* Recalcula la capa KPI materializada (≈5 s). Se usa tras editar políticas. */
export async function recalcularKpi() {
  const { data, error } = await supabase.rpc('fn_inv_refresh_kpi')
  if (error) throw new Error(error.message)
  return data
}

export async function fetchSalud() {
  const { data, error } = await supabase.from('v_inv_salud_datos').select('*')
  if (error) return {}
  return Object.fromEntries((data || []).map(r => [r.metrica, r.valor]))
}

/* Ficha de producto: posición por sucursal + serie diaria de 180 días */
export async function fetchProducto(sku) {
  const desde = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)
  const [pos, serie] = await Promise.all([
    supabase.from('v_inv_kpi_sku').select('*').eq('sku', sku),
    supabase.from('inv_ventas_dia').select('fecha, sucursal_id, qty_neta, neto_neto')
      .eq('sku', sku).gte('fecha', desde).order('fecha'),
  ])
  if (pos.error) throw new Error(pos.error.message)
  return { posicion: pos.data || [], serie: serie.data || [] }
}

export async function guardarPolitica(tipo, campos) {
  const { error } = await supabase.from('inv_politica_tipo')
    .update({ ...campos, actualizado_at: new Date().toISOString() })
    .eq('tipo_producto', tipo)
  if (error) throw new Error(error.message)
}

/* ── KPIs de cabecera ─────────────────────────────────────────────────
   El quiebre se mide en días-SKU sobre 84 días, no como foto del día:
   es lo que refleja la exposición real a venta perdida. Rotación y GMROI
   se calculan sobre el total, no promediando SKU, para que un producto
   de $5.000 no pese igual que uno de $5 millones.
   ─────────────────────────────────────────────────────────────────── */
export function calcularKpis(filas) {
  if (!filas?.length) return null
  const cuenta = e => filas.filter(f => f.estado === e).length
  const suma = (fs, campo) => fs.reduce((a, x) => a + (+x[campo] || 0), 0)
  const valor = suma(filas, 'valor_costo')
  const activos = filas.filter(f => +f.demanda_dia > 0)

  return {
    skus: filas.length,
    valorInventario: valor,
    quiebre: cuenta('QUIEBRE'), critico: cuenta('CRITICO'), reponer: cuenta('REPONER'),
    pctQuiebre: activos.length ? suma(activos, 'pct_quiebre') / activos.length : 0,
    ventaPerdida: suma(filas, 'venta_perdida_84d'),
    inversionRequerida: filas.reduce((a, f) => a + (+f.sugerido || 0) * (+f.costo_unit || 0), 0),
    coberturaMedia: activos.length ? suma(activos, 'dias_cobertura') / activos.length : 0,
  }
}

export function matrizAbcXyz(red) {
  const m = {}
  for (const a of ['A', 'B', 'C', 'D'])
    for (const x of ['X', 'Y', 'Z']) m[a + x] = { skus: 0, valor: 0, margen: 0 }
  for (const r of red || []) {
    const k = (r.abc || 'D') + (r.xyz || 'Z')
    if (!m[k]) continue
    m[k].skus++
    m[k].valor  += +r.valor_red || 0
    m[k].margen += +r.margen_364d || 0
  }
  return m
}
