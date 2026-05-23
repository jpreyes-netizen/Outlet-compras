// src/core/permisos.js
// Helpers de matriz de acceso ERP — Fase 2
// Doble lectura: matriz nueva (usuario_acceso) con fallback a usuarios.rol legado

import { supabase } from '../supabase'

// ─── ROLES LEGADO (espejo de ROLES en App.jsx) ───────────────────────────────
// Se usan como fallback si el usuario no tiene registro en usuario_acceso
const ROLES_LEGADO = {
  admin:        { permisos: ['todo'] },
  dir_general:  { permisos: ['aprobar_ilimitado','ver_dash','ver_fin'] },
  dir_finanzas: { permisos: ['aprobar_fin','ver_dash','ver_fin','reg_pago'] },
  dir_negocios: { permisos: ['aprobar_neg','crear_oc','ver_dash','gest_prov','valid_prov'] },
  analista:     { permisos: ['crear_oc','ver_dash','cerrar_oc','gest_prov','config','seguim','gest_imp'] },
  jefe_bodega:  { permisos: ['recibir','ver_dash'] },
  directorio:   { permisos: ['ver_dash','ver_fin'] },
  cajero:       { permisos: ['declarar_cierre','ver_propios'] },
}

// ─── CACHE EN MEMORIA ─────────────────────────────────────────────────────────
// Evita queries repetidas a Supabase durante la sesion
// Se limpia al hacer logout llamando clearCache()
let _cache = {}  // { userId: { accesos: [...], cargado: true } }

export function clearCache() {
  _cache = {}
}

// ─── CARGA DE ACCESOS DESDE SUPABASE ─────────────────────────────────────────
// Trae todos los accesos del usuario en una sola query
// Retorna array de { app_codigo, rol_id, sucursal_id, permisos: [...] }
async function cargarAccesos(usuario) {
  if (!usuario?.id) return []

  // Si ya esta en cache, retorna sin ir a Supabase
  if (_cache[usuario.id]?.cargado) return _cache[usuario.id].accesos

  try {
    const { data, error } = await supabase
      .from('usuario_acceso')
      .select('app_codigo, rol_id, sucursal_id, activo, roles_app(permisos)')
      .eq('usuario_id', usuario.id)
      .eq('activo', true)

    if (error || !data || data.length === 0) {
      // Sin registros en matriz → fallback legado
      _cache[usuario.id] = { cargado: true, accesos: [] }
      return []
    }

    const accesos = data.map(a => ({
      app_codigo:  a.app_codigo,
      rol_id:      a.rol_id,
      sucursal_id: a.sucursal_id,
      permisos:    a.roles_app?.permisos ?? [],
    }))

    _cache[usuario.id] = { cargado: true, accesos }
    return accesos

  } catch {
    _cache[usuario.id] = { cargado: true, accesos: [] }
    return []
  }
}

// ─── HELPERS PUBLICOS ─────────────────────────────────────────────────────────

// ¿El usuario tiene acceso a esta app?
// hasApp(usuario, 'compras') → true | false
export async function hasApp(usuario, appCodigo) {
  const accesos = await cargarAccesos(usuario)
  if (accesos.length === 0) {
    // Fallback legado: admin y dir_general tienen acceso a todo
    return ['admin','dir_general'].includes(usuario?.rol)
  }
  return accesos.some(a => a.app_codigo === appCodigo)
}

// ¿Qué rol tiene el usuario en esta app?
// roleIn(usuario, 'compras') → 'admin' | 'analista' | null
export async function roleIn(usuario, appCodigo) {
  const accesos = await cargarAccesos(usuario)
  if (accesos.length === 0) {
    // Fallback legado: retorna el rol del campo usuarios.rol
    return usuario?.rol ?? null
  }
  const acceso = accesos.find(a => a.app_codigo === appCodigo)
  if (!acceso) return null
  // rol_id es "compras.admin" → extraemos "admin"
  return acceso.rol_id.split('.')[1] ?? null
}

// ¿El usuario puede hacer esta accion en esta app?
// canIn(usuario, 'compras', 'crear_oc') → true | false
export async function canIn(usuario, appCodigo, permiso) {
  const accesos = await cargarAccesos(usuario)

  if (accesos.length === 0) {
    // Fallback legado: usa ROLES_LEGADO con el rol de usuarios.rol
    const rolLegado = ROLES_LEGADO[usuario?.rol]
    if (!rolLegado) return false
    return rolLegado.permisos.includes('todo') || rolLegado.permisos.includes(permiso)
  }

  const acceso = accesos.find(a => a.app_codigo === appCodigo)
  if (!acceso) return false

  const permisos = acceso.permisos
  return permisos.includes('todo') || permisos.includes(permiso)
}

// ¿A qué sucursal está limitado el usuario en esta app?
// scopeIn(usuario, 'finanzas') → 'suc-la' | null (null = todas)
export async function scopeIn(usuario, appCodigo) {
  const accesos = await cargarAccesos(usuario)
  if (accesos.length === 0) return null
  const acceso = accesos.find(a => a.app_codigo === appCodigo)
  return acceso?.sucursal_id ?? null
}

// Lista de apps a las que tiene acceso (para el AppHub)
// getAppsDisponibles(usuario) → ['compras','finanzas']
export async function getAppsDisponibles(usuario) {
  const accesos = await cargarAccesos(usuario)
  if (accesos.length === 0) {
    // Fallback legado
    if (['admin','dir_general'].includes(usuario?.rol)) return ['compras','finanzas','admin']
    if (usuario?.rol === 'dir_finanzas') return ['compras','finanzas']
    return ['compras']
  }
  return accesos.map(a => a.app_codigo)
}

// Version sincrona de canIn — usa solo el rol legado
// Para componentes que no pueden hacer await (render directo)
// canInSync(usuario, 'compras', 'crear_oc') → true | false
export function canInSync(usuario, appCodigo, permiso) {
  // Si el cache ya tiene los accesos, los usa
  const cached = _cache[usuario?.id]
  if (cached?.cargado && cached.accesos.length > 0) {
    const acceso = cached.accesos.find(a => a.app_codigo === appCodigo)
    if (!acceso) return false
    const permisos = acceso.permisos
    return permisos.includes('todo') || permisos.includes(permiso)
  }
  // Sin cache → fallback legado sincrono
  const rolLegado = ROLES_LEGADO[usuario?.rol]
  if (!rolLegado) return false
  return rolLegado.permisos.includes('todo') || rolLegado.permisos.includes(permiso)
}