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
  const cogs  = filas.reduce((a, f) => a + (+f.venta_364d || 0) * (+f.costo_unit || 0), 0)
  const neto  = suma(filas, 'neto_364d')
  const activos = filas.filter(f => +f.demanda_dia > 0)
  const inertes = filas.filter(f => f.estado === 'MUERTO' || f.estado === 'SIN ROTACION')

  return {
    skus: filas.length,
    valorInventario: valor,
    quiebre: cuenta('QUIEBRE'), critico: cuenta('CRITICO'), reponer: cuenta('REPONER'),
    exceso: cuenta('EXCESO'), muerto: inertes.length,
    valorMuerto: suma(inertes, 'valor_costo'),
    valorExceso: suma(filas.filter(f => f.estado === 'EXCESO'), 'valor_costo'),
    pctQuiebre: activos.length ? suma(activos, 'pct_quiebre') / activos.length : 0,
    ventaPerdida: suma(filas, 'venta_perdida_84d'),
    inversionRequerida: filas.reduce((a, f) => a + (+f.sugerido || 0) * (+f.costo_unit || 0), 0),
    rotacion: valor > 0 ? cogs / valor : 0,
    gmroi: valor > 0 ? (neto - cogs) / valor : 0,
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
