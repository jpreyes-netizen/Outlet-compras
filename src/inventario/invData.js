/* ════════════════════════════════════════════════════════════════════
   invData.js — acceso a la capa analítica de inventario (Supabase)
   Outlet de Puertas SpA

   Toda la matemática de reposición vive en vistas SQL, no en el cliente:
     v_inv_kpi_sku     decisión por SKU × sucursal (reponer/quiebre/exceso)
     v_inv_red         decisión de COMPRA agregando red + tránsito, ABC-XYZ
     v_inv_asignacion  qué empujar del CD a cada tienda (fair share)
     v_inv_salud_datos frescura de la fuente
   El cliente sólo pide, filtra y muestra.
   ════════════════════════════════════════════════════════════════════ */

import { supabase } from '../supabase'

/* Ubicaciones canónicas del ecosistema. CD y bodegas NO son puntos de venta. */
export const SUCURSALES = [
  { id: 'suc-lg',    nombre: 'La Granja',    vende: true,  color: '#1E7A44' },
  { id: 'suc-la',    nombre: 'Los Ángeles',  vende: true,  color: '#1D4E89' },
  { id: 'suc-maipu', nombre: 'Tienda Maipú', vende: true,  color: '#B25E09' },
  { id: 'suc-mp',    nombre: 'CD Maipú',     vende: false, color: '#6E6E73' },
]
export const nombreSuc = id => SUCURSALES.find(s => s.id === id)?.nombre || id || '—'
export const colorSuc  = id => SUCURSALES.find(s => s.id === id)?.color  || '#6E6E73'
export const SUC_VENTA = SUCURSALES.filter(s => s.vende).map(s => s.id)

/* Semáforo operativo — orden de urgencia descendente */
export const ESTADOS = ['QUIEBRE', 'CRITICO', 'REPONER', 'OK', 'EXCESO', 'SIN ROTACION', 'MUERTO']
export const CL_ESTADO = {
  QUIEBRE: '#B42318', CRITICO: '#D1442F', REPONER: '#B25E09',
  OK: '#1E7A44', EXCESO: '#1D4E89', 'SIN ROTACION': '#6E6E73', MUERTO: '#5B2C6F',
}
export const CL_ABC = { A: '#1E7A44', B: '#1D4E89', C: '#B25E09', D: '#6E6E73' }

/* Patrón de demanda (Syntetos-Boylan-Croston) */
export const CL_PATRON = {
  SUAVE: '#1E7A44', ERRATICA: '#B25E09',
  INTERMITENTE: '#1D4E89', GRUMOSA: '#B42318', SIN_DEMANDA: '#6E6E73',
}
export const AYUDA_PATRON = {
  SUAVE: 'Venta frecuente y pareja. Stock de seguridad por distribución normal.',
  ERRATICA: 'Venta frecuente pero de tamaño muy variable.',
  INTERMITENTE: 'Venta espaciada de tamaño estable. Stock de seguridad por Poisson compuesta.',
  GRUMOSA: 'Venta espaciada y de tamaño muy variable. El caso más difícil de predecir.',
  SIN_DEMANDA: 'Sin ventas registradas en 84 días.',
}

const LIMITE = 20000

/* ── Decisión por SKU × sucursal ──────────────────────────────────── */
export async function fetchKpiSku({ sucursales = null, soloVende = true } = {}) {
  let q = supabase.from('v_inv_kpi_sku').select('*').limit(LIMITE)
  if (soloVende) q = q.eq('vende', true)
  if (sucursales?.length) q = q.in('sucursal_id', sucursales)
  const { data, error } = await q
  if (error) throw new Error('v_inv_kpi_sku: ' + error.message)
  return data || []
}

/* ── Decisión de compra a nivel red ───────────────────────────────── */
export async function fetchRed() {
  const { data, error } = await supabase.from('v_inv_red').select('*').limit(LIMITE)
  if (error) throw new Error('v_inv_red: ' + error.message)
  return data || []
}

/* ── Asignación CD → tiendas ──────────────────────────────────────── */
export async function fetchAsignacion() {
  const { data, error } = await supabase
    .from('v_inv_asignacion').select('*')
    .gt('enviar_sugerido', 0)
    .order('valor_envio', { ascending: false })
    .limit(LIMITE)
  if (error) throw new Error('v_inv_asignacion: ' + error.message)
  return data || []
}

/* ── Salud de la fuente de datos ──────────────────────────────────── */
export async function fetchSalud() {
  const { data, error } = await supabase.from('v_inv_salud_datos').select('*')
  if (error) return {}
  return Object.fromEntries((data || []).map(r => [r.metrica, r.valor]))
}

/* ════════════════════════════════════════════════════════════════════
   KPIs de cabecera. Las definiciones siguen el uso estándar en retail:
   - Quiebre se mide en días-SKU (no en foto del día), que es lo que
     realmente refleja la exposición a venta perdida.
   - Rotación y GMROI se ponderan por valor, no se promedian simple:
     el promedio simple deja que un SKU de $5.000 pese lo mismo que uno
     de $5 millones.
   ════════════════════════════════════════════════════════════════════ */
export function calcularKpis(filas) {
  if (!filas?.length) return null
  const n = e => filas.filter(f => f.estado === e).length
  const valor  = filas.reduce((a, f) => a + (+f.valor_costo || 0), 0)
  const cogs   = filas.reduce((a, f) => a + (+f.venta_364d || 0) * (+f.costo_unit || 0), 0)
  const neto   = filas.reduce((a, f) => a + (+f.neto_364d || 0), 0)
  const activos = filas.filter(f => +f.demanda_dia > 0)

  return {
    skus: filas.length,
    valorInventario: valor,
    quiebre: n('QUIEBRE'),
    critico: n('CRITICO'),
    reponer: n('REPONER'),
    exceso: n('EXCESO'),
    muerto: n('MUERTO') + n('SIN ROTACION'),
    valorMuerto: filas
      .filter(f => f.estado === 'MUERTO' || f.estado === 'SIN ROTACION')
      .reduce((a, f) => a + (+f.valor_costo || 0), 0),
    valorExceso: filas.filter(f => f.estado === 'EXCESO')
      .reduce((a, f) => a + (+f.valor_costo || 0), 0),
    // Tasa de quiebre ponderada por días-SKU sobre los 84 días medidos
    pctQuiebre: activos.length
      ? activos.reduce((a, f) => a + (+f.pct_quiebre || 0), 0) / activos.length : 0,
    ventaPerdida: filas.reduce((a, f) => a + (+f.venta_perdida_84d || 0), 0),
    inversionRequerida: filas.reduce((a, f) => a + (+f.sugerido || 0) * (+f.costo_unit || 0), 0),
    rotacion: valor > 0 ? cogs / valor : 0,
    gmroi: valor > 0 ? (neto - cogs) / valor : 0,
    coberturaMedia: activos.length
      ? activos.reduce((a, f) => a + (+f.dias_cobertura || 0), 0) / activos.length : 0,
  }
}

/* Matriz ABC × XYZ para la vista de red */
export function matrizAbcXyz(red) {
  const m = {}
  for (const a of ['A', 'B', 'C', 'D'])
    for (const x of ['X', 'Y', 'Z'])
      m[a + x] = { skus: 0, valor: 0, margen: 0, comprar: 0 }
  for (const r of red || []) {
    const k = (r.abc || 'D') + (r.xyz || 'Z')
    if (!m[k]) continue
    m[k].skus++
    m[k].valor  += +r.valor_red || 0
    m[k].margen += +r.margen_364d || 0
    m[k].comprar += (+r.comprar_sugerido || 0) * (+r.costo_unit || 0)
  }
  return m
}

/* Lectura de la matriz en lenguaje de negocio */
export const LEYENDA_ABC_XYZ = {
  AX: 'Motor del negocio, demanda predecible. Nunca deben quebrar.',
  AY: 'Alto margen, demanda variable. Requieren más stock de seguridad.',
  AZ: 'Alto margen, demanda impredecible. Vigilar de cerca, comprar seguido y poco.',
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
