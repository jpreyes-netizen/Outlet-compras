/* ════════════════════════════════════════════════════════════════════
   invData.js — única capa de datos del módulo Inventario
   · Toda la matemática vive en vistas SQL; aquí sólo se pide y se filtra.
   · Motor de filtros de la Base de datos: cualquier indicador de la app
     navega a la base con un objeto de filtros, y aquí se aplica y se
     describe en lenguaje de negocio (las "pastillas" de filtro activas).
   ════════════════════════════════════════════════════════════════════ */

import { supabase } from '../supabase'

const LIMITE = 20000

/* ── Ubicaciones ──────────────────────────────────────────────────── */
export const SUCURSALES = [
  { id: 'suc-lg',    nombre: 'La Granja',    vende: true },
  { id: 'suc-la',    nombre: 'Los Ángeles',  vende: true },
  { id: 'suc-maipu', nombre: 'Tienda Maipú', vende: true },
  { id: 'suc-mp',    nombre: 'CD Maipú',     vende: false },
]
export const nombreSuc = id => SUCURSALES.find(s => s.id === id)?.nombre || id || '—'
export const SALAS = SUCURSALES.filter(s => s.vende)

/* ── Diccionarios ─────────────────────────────────────────────────── */
export const CL_ESTADO = {
  QUIEBRE: '#B42318', CRITICO: '#D1442F', REPONER: '#B25E09',
  OK: '#1E7A44', EXCESO: '#1D4E89', 'SIN ROTACION': '#6E6E73', MUERTO: '#5B2C6F',
}
export const AYUDA_ESTADO = {
  QUIEBRE: 'Sin stock y con venta: se está perdiendo venta hoy.',
  CRITICO: 'Bajo el stock de seguridad: quiebre inminente.',
  REPONER: 'Bajo el punto de reorden: pedir ahora.',
  OK: 'Stock dentro de lo esperado.',
  EXCESO: 'Cobertura muy por sobre el objetivo.',
  'SIN ROTACION': 'Tiene stock pero no se vende.',
  MUERTO: 'Tiene stock y no se vende hace más de 180 días.',
}
export const ESTADOS = Object.keys(CL_ESTADO)
export const CL_ABC = { A: '#1E7A44', B: '#1D4E89', C: '#B25E09', D: '#6E6E73' }
export const CL_PATRON = { SUAVE: '#1E7A44', ERRATICA: '#B25E09', INTERMITENTE: '#1D4E89', GRUMOSA: '#B42318', SIN_DEMANDA: '#6E6E73' }
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

/* ── Reglas de negocio editables ──────────────────────────────────── */
export const CONFIG_DEFECTO = {
  dias_activo: 30, dias_lento: 90, dias_inmovilizado: 180,
  factor_sobredimension: 2, factor_desbalance: 2, dias_reposicion_sala: 14,
  meses_promedio: 4, min_dias_stock_mes: 10,
}

export function nivelesDesde(cfg = CONFIG_DEFECTO) {
  const a = cfg.dias_activo, l = cfg.dias_lento, i = cfg.dias_inmovilizado
  return [
    { k: 'ACTIVO',       c: '#1E7A44', l: 'Activo',         d: `Se movió en los últimos ${a} días. Capital trabajando.` },
    { k: 'NUEVO',        c: '#1D4E89', l: 'Recién llegado', d: `Llegó hace ${a} días o menos y aún no se mueve. Se vigila, no se alarma.` },
    { k: 'LENTO',        c: '#B25E09', l: 'Lento',          d: `${a + 1} a ${l} días sin moverse. Todavía se puede actuar barato.` },
    { k: 'INMOVILIZADO', c: '#D1442F', l: 'Inmovilizado',   d: `${l + 1} a ${i} días sin moverse. Capital detenido: abre una alerta.` },
    { k: 'MUERTO',       c: '#5B2C6F', l: 'Muerto',         d: `Más de ${i} días sin moverse. Liquidar, transferir o pasar a segunda selección.` },
    { k: 'SIN STOCK',    c: '#9A9AA0', l: 'Sin stock',      d: 'No hay unidades en esta bodega.' },
  ]
}
export const NIVELES = nivelesDesde()
export const CL_NIVEL = Object.fromEntries(NIVELES.map(n => [n.k, n.c]))
export const NOMBRE_NIVEL = Object.fromEntries(NIVELES.map(n => [n.k, n.l]))

export const ACCIONES = {
  'Distribuir a salas':                   'Está en el CD y hay salas que lo venden y lo necesitan: falta despacharlo.',
  'Transferir a sala que sí vende':       'Aquí no se mueve, pero otra sala lo vende y está bajo su cobertura. Está en el lugar equivocado.',
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

export function usosDesde(cfg = CONFIG_DEFECTO) {
  return [
    { k: 'BIEN USADA',        c: '#1E7A44', d: 'Producto que se vende, en una posición del tamaño adecuado a su rotación.' },
    { k: 'SOBREDIMENSIONADA', c: '#1D4E89', d: `Más de ${cfg.factor_sobredimension} veces el máximo que el producto debería guardar: sobra espacio.` },
    { k: 'SUBDIMENSIONADA',   c: '#7C3AED', d: `No alcanza a guardar ${cfg.dias_reposicion_sala} días de venta más el stock de seguridad.` },
    { k: 'DESBORDADA',        c: '#8E1B10', d: 'Hoy hay más unidades que su capacidad: el excedente ocupa pasillo o zona sin plano.' },
    { k: 'LENTO',             c: '#B25E09', d: 'Ocupada por un producto que se está poniendo lento.' },
    { k: 'INMOVILIZADO',      c: '#D1442F', d: 'Ocupada por un producto detenido: espacio que no trabaja.' },
    { k: 'EN QUIEBRE',        c: '#B42318', d: 'Vacía porque el producto se acabó y sí se vende. No es espacio ocioso: hay que reponer.' },
    { k: 'VACÍA',             c: '#5B2C6F', d: 'Reservada para un producto sin stock ni demanda: espacio ocioso, se puede reasignar.' },
    { k: 'SIN CAPACIDAD',     c: '#9A9AA0', d: 'Posición sin capacidad máxima en el plano: no se puede evaluar.' },
  ]
}
export const USOS = usosDesde()
export const CL_USO = Object.fromEntries(USOS.map(u => [u.k, u.c]))

export const TRAMOS_COB = [
  { k: 'cob_0_15',      l: '0–15 días',   c: '#B42318', min: 0,   max: 15,   d: 'Riesgo de quiebre: alcanza para dos semanas o menos.' },
  { k: 'cob_16_30',     l: '16–30 días',  c: '#B25E09', min: 15,  max: 30,   d: 'Justo: hay que reponer pronto.' },
  { k: 'cob_31_60',     l: '31–60 días',  c: '#1E7A44', min: 30,  max: 60,   d: 'Sano para un producto de reposición nacional.' },
  { k: 'cob_61_90',     l: '61–90 días',  c: '#1D4E89', min: 60,  max: 90,   d: 'Holgado. Normal en importados por el plazo de llegada.' },
  { k: 'cob_91_180',    l: '91–180 días', c: '#C2410C', min: 90,  max: 180,  d: 'Sobrestock: capital y espacio comprometidos por 3 a 6 meses.' },
  { k: 'cob_mas_180',   l: '+180 días',   c: '#5B2C6F', min: 180, max: 1e12, d: 'Más de medio año de venta guardado. Candidato a no recomprar.' },
  { k: 'cob_sin_venta', l: 'Sin venta',   c: '#9A9AA0', d: 'Sin ventas recientes: la cobertura no se puede calcular.' },
]

/* ── Consultas ────────────────────────────────────────────────────── */
async function pedir(vista, armar, cols = '*') {
  let q = supabase.from(vista).select(cols).limit(LIMITE)
  if (armar) q = armar(q)
  const { data, error } = await q
  if (error) throw new Error(`${vista}: ${error.message}`)
  return data || []
}

const COLS_BASE = 'sku,producto,tipo_producto,familia,sucursal_id,vende,tipo_bodega,stock,disponible,reservado,transito,' +
  'costo_unit,valor_costo,stock_en_cd,demanda_dia,patron,pct_quiebre,dias_cobertura,venta_28d,venta_84d,venta_364d,' +
  'neto_364d,venta_perdida_84d,safety_stock,punto_reorden,sugerido,estado,abc,xyz,clase,nivel,dias_inmovil,' +
  'dias_es_minimo,ultima_venta,ultimo_despacho,ultima_llegada,unid_exceso,nivel_objetivo,accion,sala_destino,' +
  'alerta_id,alerta_estado,alerta_desde,alerta_nota,metodo,fecha_calculo,dias_stock_28,dias_obs_28,dias_stock_84,' +
  'dias_obs_84,demanda_dia_observada,lead_time,cobertura_objetivo,venta_mensual,meses_usados,meses_detalle,ventana_desde,ventana_hasta'

export const fetchBaseProductos    = () => pedir('v_inv_base_productos', null, COLS_BASE)
export const fetchPosiciones       = () => pedir('v_inv_capacidad')
export const fetchMovimientos      = () => pedir('v_inv_movimientos', q => q.order('valor_costo', { ascending: false }))
export const fetchPrioridad        = () => pedir('v_inv_prioridad_compra', q => q.order('prioridad'))
export const fetchScorecard        = () => pedir('v_inv_scorecard')
export const fetchComparable       = () => pedir('v_inv_comparable')
export const fetchCapitalBodega    = () => pedir('v_inv_capital_bodega')
export const fetchCapacidadResumen = () => pedir('v_inv_capacidad_resumen')
export const fetchPareto           = () => pedir('v_inv_pareto_categoria')
export const fetchHistoria         = () => pedir('inv_capital_historia', q => q.order('fecha', { ascending: false }).limit(200))
export const fetchPoliticas        = () => pedir('inv_politica_tipo', q => q.order('tipo_producto'))

/* Historia mensual (12 meses + mes en curso) de uno o varios productos, para gráficos e informe */
export async function fetchSerieMensual(skus) {
  if (!skus?.length) return []
  const { data, error } = await supabase.rpc('fn_inv_serie_mensual', { p_skus: [...new Set(skus)] })
  if (error) throw new Error('fn_inv_serie_mensual: ' + error.message)
  return data || []
}

export async function fetchSalud() {
  const { data, error } = await supabase.from('v_inv_salud_datos').select('*')
  if (error) return {}
  return Object.fromEntries((data || []).map(r => [r.metrica, r.valor]))
}
export async function fetchConfig() {
  const { data, error } = await supabase.from('inv_config').select('*').eq('id', 1).maybeSingle()
  if (error || !data) return CONFIG_DEFECTO
  return { ...CONFIG_DEFECTO, ...data }
}

/* Ficha de producto: situación en cada bodega (la historia mensual se pide con fetchSerieMensual) */
export async function fetchProducto(sku) {
  const { data, error } = await supabase.from('v_inv_base_productos').select(COLS_BASE).eq('sku', sku)
  if (error) throw new Error(error.message)
  return { posicion: data || [] }
}

/* ── Escrituras ───────────────────────────────────────────────────── */
async function actualizar(tabla, campos, col, valor) {
  const { error } = await supabase.from(tabla).update(campos).eq(col, valor)
  if (error) throw new Error(error.message)
}
export const guardarPolitica = (tipo, campos) =>
  actualizar('inv_politica_tipo', { ...campos, actualizado_at: new Date().toISOString() }, 'tipo_producto', tipo)
export const validarPolitica = (tipo, validado, usuario) =>
  actualizar('inv_politica_tipo', { validado, validado_por: validado ? usuario || null : null,
    validado_at: validado ? new Date().toISOString() : null }, 'tipo_producto', tipo)
export const guardarConfig = (campos, usuario) =>
  actualizar('inv_config', { ...campos, actualizado_at: new Date().toISOString(), actualizado_por: usuario || null }, 'id', 1)
export function gestionarAlerta(id, estado, nota, usuario) {
  const campos = { estado, nota: nota || null, gestionada_por: usuario || null, gestionada_at: new Date().toISOString() }
  if (estado === 'resuelta') Object.assign(campos, { resuelta_el: new Date().toISOString().slice(0, 10), motivo_cierre: 'Cerrada manualmente' })
  return actualizar('inv_alertas', campos, 'id', id)
}
export async function recalcularKpi() {
  const { data, error } = await supabase.rpc('fn_inv_refresh_kpi')
  if (error) throw new Error(error.message)
  return data
}

/* ════════════════════════════════════════════════════════════════════
   MOTOR DE FILTROS DE LA BASE DE DATOS
   filtros = { campo: valor | [valores] | true }.  Campos especiales:
     cob            tramo de cobertura (k de TRAMOS_COB)
     perdida        con venta perdida en 84 días
     exceso         con unidades sobre el objetivo
     quiebreConCd   en quiebre o crítico en sala, con stock en el CD
     q              texto libre (SKU o producto)
   ════════════════════════════════════════════════════════════════════ */
const ESPECIALES = {
  cob: (r, v) => {
    if (v === 'cob_sin_venta') return r.dias_cobertura == null
    const t = TRAMOS_COB.find(x => x.k === v)
    if (!t || r.dias_cobertura == null) return false
    const d = +r.dias_cobertura
    return t.min === 0 ? d <= t.max : d > t.min && d <= t.max
  },
  perdida: r => +r.venta_perdida_84d > 0,
  exceso: r => +r.unid_exceso > 0,
  quiebreConCd: r => r.vende && ['QUIEBRE', 'CRITICO'].includes(r.estado) && +r.stock_en_cd > 0,
  alertaVigente: r => r.alerta_estado && r.alerta_estado !== 'resuelta',
  detenido: r => ['INMOVILIZADO', 'MUERTO'].includes(r.nivel),
  conStock: r => +r.stock > 0,
  sinStockCd: r => r.vende && ['QUIEBRE', 'CRITICO'].includes(r.estado) && !(+r.stock_en_cd > 0),
  q: (r, v) => {
    const t = String(v).trim().toLowerCase()
    return !t || String(r.sku || '').toLowerCase().includes(t) || String(r.producto || '').toLowerCase().includes(t)
  },
}

export function aplicarFiltros(rows, filtros = {}) {
  const activos = Object.entries(filtros).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
  if (!activos.length) return rows
  return rows.filter(r => activos.every(([k, v]) => {
    if (ESPECIALES[k]) return ESPECIALES[k](r, v)
    if (Array.isArray(v)) return v.includes(r[k])
    return r[k] === v
  }))
}

/* Etiquetas de negocio para las pastillas de filtro */
const ETIQUETAS = {
  sucursal_id:   { l: 'Bodega',       v: nombreSuc },
  origen:        { l: 'Desde',        v: nombreSuc },
  destino:       { l: 'Hacia',        v: nombreSuc },
  tipo_bodega:   { l: 'Tipo de bodega' },
  nivel:         { l: 'Situación',    v: x => NOMBRE_NIVEL[x] || x },
  estado:        { l: 'Reposición',   v: x => x.charAt(0) + x.slice(1).toLowerCase() },
  familia:       { l: 'Familia' },
  tipo_producto: { l: 'Categoría' },
  clase:         { l: 'Clase ABC×XYZ' },
  abc:           { l: 'Clase ABC' },
  patron:        { l: 'Patrón de demanda' },
  accion:        { l: 'Acción' },
  alerta_estado: { l: 'Alerta',       v: x => ESTADOS_ALERTA[x]?.l || x },
  uso:           { l: 'Uso de posición' },
  tipo:          { l: 'Movimiento' },
  ruta:          { l: 'Ruta' },
  cob:           { l: 'Cobertura',    v: x => TRAMOS_COB.find(t => t.k === x)?.l || x },
  perdida:       { l: 'Con venta perdida', bool: true },
  exceso:        { l: 'Sobre el objetivo', bool: true },
  quiebreConCd:  { l: 'En quiebre con stock en el CD', bool: true },
  alertaVigente: { l: 'Con alerta vigente', bool: true },
  detenido:      { l: 'Detenidos', bool: true },
  conStock:      { l: 'Con stock', bool: true },
  sinStockCd:    { l: 'En quiebre sin stock en el CD (hay que comprar)', bool: true },
  q:             { l: 'Búsqueda',     v: x => `"${x}"` },
}
export function describirFiltros(filtros = {}) {
  return Object.entries(filtros)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length) && v !== false)
    .map(([k, v]) => {
      const e = ETIQUETAS[k] || { l: k }
      if (e.bool) return { k, texto: e.l }
      const vals = (Array.isArray(v) ? v : [v]).map(x => (e.v ? e.v(x) : x))
      return { k, texto: `${e.l}: ${vals.join(', ')}` }
    })
}

/* ── Agregados para pantallas de resumen ──────────────────────────── */
export function matrizAbcXyz(base) {
  const m = {}
  for (const a of ['A', 'B', 'C', 'D']) for (const x of ['X', 'Y', 'Z']) m[a + x] = { skus: new Set(), valor: 0 }
  for (const r of base || []) {
    const k = r.clase || 'DZ'
    if (!m[k]) continue
    m[k].skus.add(r.sku)
    m[k].valor += +r.valor_costo || 0
  }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { skus: v.skus.size, valor: v.valor }]))
}

export function resumenBase(base, scope) {
  const f = scope ? base.filter(r => r.sucursal_id === scope) : base
  const salas = f.filter(r => r.vende)
  const suma = (fs, c) => fs.reduce((a, r) => a + (+r[c] || 0), 0)
  const conDemanda = salas.filter(r => +r.demanda_dia > 0)
  return {
    valor: suma(f, 'valor_costo'),
    valorSalas: suma(salas, 'valor_costo'),
    ventaPerdida: suma(salas, 'venta_perdida_84d'),
    pctQuiebre: conDemanda.length ? suma(conDemanda, 'pct_quiebre') / conDemanda.length : 0,
    nQuiebre: salas.filter(r => r.estado === 'QUIEBRE').length,
    nCritico: salas.filter(r => r.estado === 'CRITICO').length,
    nReponer: salas.filter(r => r.estado === 'REPONER').length,
    inversionReposicion: salas.reduce((a, r) => a + (+r.sugerido || 0) * (+r.costo_unit || 0), 0),
    perdidaConCd: salas.filter(ESPECIALES.quiebreConCd).reduce((a, r) => a + (+r.venta_perdida_84d || 0), 0),
    nQuiebreConCd: salas.filter(ESPECIALES.quiebreConCd).length,
  }
}
