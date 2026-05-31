// deploy v5 - ascii clean, cors fix
// Edge Function: workera-proxy
// Proxy seguro entre el cliente y la API de Workera.

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
})

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age':       '86400',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

async function getCfg() {
  const { data, error } = await sb
    .from('config_sistema')
    .select('clave, valor')
    .in('clave', ['workera_api_user','workera_api_key','workera_base_url','workera_activo'])
  if (error) throw new Error('No se pudo leer config_sistema: ' + error.message)
  const c: Record<string,string> = {}
  for (const r of data ?? []) c[r.clave] = r.valor
  if (!c.workera_api_user || !c.workera_api_key)
    throw new Error('Faltan workera_api_user o workera_api_key en config_sistema')
  if (c.workera_activo !== 'true')
    throw new Error('Workera deshabilitado: workera_activo debe ser "true"')
  return {
    apiUser: c.workera_api_user,
    apiKey:  c.workera_api_key,
    baseUrl: c.workera_base_url || 'https://workera.com/apiClient/v1'
  }
}

async function wFetch(cfg: {apiUser:string;apiKey:string;baseUrl:string}, path: string, params: Record<string,string|number> = {}) {
  const url = new URL(cfg.baseUrl + path)
  for (const [k,v] of Object.entries(params))
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v))
  const res = await fetch(url.toString(), {
    method:  'GET',
    headers: { 'API_USER': cfg.apiUser, 'API_KEY': cfg.apiKey, 'Accept': 'application/json' }
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Workera ${res.status} en ${path}: ${t.slice(0,300)}`)
  }
  return res.json()
}

async function wFetchAll(cfg: {apiUser:string;apiKey:string;baseUrl:string}, path: string, params: Record<string,string|number> = {}, maxPages = 50) {
  const all: any[] = []
  let page = 1
  while (page <= maxPages) {
    const res = await wFetch(cfg, path, { ...params, page })
    const data = res.data ?? res.result ?? []
    if (Array.isArray(data)) all.push(...data)
    if (page >= Number(res.totalPages ?? 1)) break
    page++
  }
  return all
}

async function logStart(tipo: string, ejecutado_por: string, rango?: {desde?:string;hasta?:string}) {
  const { data, error } = await sb.from('asis_sync_log')
    .insert({ tipo, ejecutado_por, rango_desde: rango?.desde ?? null, rango_hasta: rango?.hasta ?? null, estado: 'en_curso' })
    .select('id').single()
  if (error) throw new Error('logStart: ' + error.message)
  return data.id
}

async function logEnd(id: string, p: {estado:'ok'|'parcial'|'error';consultados?:number;nuevos?:number;actualizados?:number;sin_match?:number;errores?:any}) {
  await sb.from('asis_sync_log').update({
    fin: new Date().toISOString(),
    estado: p.estado,
    registros_consultados:   p.consultados  ?? 0,
    registros_nuevos:        p.nuevos       ?? 0,
    registros_actualizados:  p.actualizados ?? 0,
    registros_sin_match:     p.sin_match    ?? 0,
    errores:                 p.errores      ?? null,
  }).eq('id', id)
}

async function buildMapeo() {
  const idx = new Map<string,{cod_contaline:number;sucursal_id:string|null}>()
  const { data, error } = await sb.from('asis_mapeo_empleados')
    .select('workera_code, cod_contaline, rrhh_empleados(sucursal_id)')
  if (error) throw new Error('buildMapeo: ' + error.message)
  for (const r of data ?? []) {
    idx.set(r.workera_code, {
      cod_contaline: r.cod_contaline,
      // @ts-ignore
      sucursal_id: r.rrhh_empleados?.sucursal_id ?? null
    })
  }
  return idx
}

// ACCION: test_credenciales
async function actionTest() {
  const id = await logStart('test_credenciales', 'test')
  try {
    const cfg = await getCfg()
    const res = await wFetch(cfg, '/branchOffice', { page: 1 })
    await logEnd(id, { estado: 'ok', consultados: (res.data ?? []).length })
    return { ok: true, empresa: res.requestInfo?.companyName, rut: res.requestInfo?.companyIdentification, sucursales_visibles: res.totalResult ?? (res.data?.length ?? 0) }
  } catch(e) {
    await logEnd(id, { estado: 'error', errores: { msg: (e as Error).message } })
    throw e
  }
}

// ACCION: sync_catalogos
async function actionCatalogos() {
  const id = await logStart('catalogos', 'manual')
  try {
    const cfg = await getCfg()
    const [sucursales, departamentos, tiposPermiso] = await Promise.all([
      wFetchAll(cfg, '/branchOffice'),
      wFetchAll(cfg, '/department'),
      wFetchAll(cfg, '/permissionTypes')
    ])
    for (const s of sucursales) {
      await sb.from('asis_workera_sucursales').upsert({
        workera_id: s.id, workera_code: s.code, workera_name: s.name,
        timezone_name: s.timezoneName, status: s.status,
        is_default: s.defaultBranchoffice ?? false, employees_count: s.employeesCount ?? 0,
        last_sync: new Date().toISOString()
      }, { onConflict: 'workera_id' })
    }
    for (const d of departamentos) {
      await sb.from('asis_workera_departamentos').upsert({
        workera_id: d.id, workera_code: d.code, workera_name: d.name,
        status: d.status, is_default: d.defaultDepartment ?? false,
        employees_count: d.employeesCount ?? 0, last_sync: new Date().toISOString()
      }, { onConflict: 'workera_id' })
    }
    for (const t of tiposPermiso) {
      await sb.from('asis_workera_tipos_permiso').upsert({
        workera_code: t.code, workera_name: t.name, workera_type: t.type,
        descripcion: t.description, last_sync: new Date().toISOString()
      }, { onConflict: 'workera_code' })
    }
    const total = sucursales.length + departamentos.length + tiposPermiso.length
    await logEnd(id, { estado: 'ok', consultados: total, nuevos: total })
    return { ok: true, sucursales: sucursales.length, departamentos: departamentos.length, tipos_permiso: tiposPermiso.length }
  } catch(e) {
    await logEnd(id, { estado: 'error', errores: { msg: (e as Error).message } })
    throw e
  }
}

// ACCION: sync_empleados (staging, sin auto-match)
async function actionEmpleados() {
  const id = await logStart('mapeo_empleados', 'manual')
  try {
    const cfg = await getCfg()
    const empleados = await wFetchAll(cfg, '/employee')
    let nuevos = 0
    const errores: any[] = []
    for (const e of empleados) {
      const nombre = [e.name, e.secondName, e.lastName, e.secondLastName].filter(Boolean).join(' ')
      let sug = { cod_contaline: null as number|null, nombre: null as string|null, match_metodo: 'huerfano', confianza: null as number|null }
      try {
        const { data: s } = await sb.rpc('asis_sugerir_match_empleado', {
          p_workera_rut: e.identification ?? null,
          p_workera_nombre: nombre
        })
        if (s && s[0]) sug = s[0]
      } catch {}
      const { error: err } = await sb.from('asis_staging_empleados_workera').upsert({
        workera_code: e.code, workera_device_code: e.deviceCode ?? null,
        workera_dept_code: e.departmentCode ?? null, workera_dept_name: e.departmentName ?? null,
        workera_branch_code: e.branchOfficeCode ?? null, workera_branch_name: e.branchOfficeName ?? null,
        identification: e.identification ?? null, nombre_completo: nombre,
        primer_nombre: e.name ?? null, primer_apellido: e.lastName ?? null,
        employee_status: e.employeeStatus ?? null,
        sugerencia_cod_contaline: sug.cod_contaline, sugerencia_nombre: sug.nombre,
        sugerencia_confianza: sug.confianza, sugerencia_motivo: sug.match_metodo,
        last_sync: new Date().toISOString(), raw: e
      }, { onConflict: 'workera_code' })
      if (err) errores.push({ code: e.code, error: err.message })
      else nuevos++
    }
    await logEnd(id, { estado: errores.length > 0 ? 'parcial' : 'ok', consultados: empleados.length, nuevos, errores: errores.length > 0 ? { items: errores.slice(0,50) } : null })
    return { ok: true, total_empleados_workera: empleados.length, guardados_en_staging: nuevos, errores: errores.length, mensaje: 'Staging actualizado. Mapeo manual desde UI Config.' }
  } catch(e) {
    await logEnd(id, { estado: 'error', errores: { msg: (e as Error).message } })
    throw e
  }
}

// ACCION: sync_marcaciones
async function actionMarcaciones(desde: string, hasta: string) {
  const id = await logStart('marcaciones', 'manual', { desde, hasta })
  try {
    const cfg = await getCfg()
    const marcaciones = await wFetchAll(cfg, '/attendanceData', { start: desde, end: hasta })
    const mapeo = await buildMapeo()
    let nuevos = 0; let sinMatch = 0
    const errores: any[] = []
    const batchId = crypto.randomUUID()
    const CHUNK = 500
    for (let i = 0; i < marcaciones.length; i += CHUNK) {
      const rows = marcaciones.slice(i, i + CHUNK).map((m: any) => {
        const code = m.employee?.code ?? null
        const map = code ? mapeo.get(String(code)) : null
        if (!map) sinMatch++
        return {
          workera_employee_code: String(code), cod_contaline: map?.cod_contaline ?? null,
          sucursal_id: map?.sucursal_id ?? null, fecha_hora: m.attendanceDate,
          tipo: m.attendanceType, estado: m.attendanceStatus, origen_codigo: m.originCode,
          origen_descripcion: m.origin, direccion: m.address, dispositivo: m.deviceName,
          checksum: m.checksum, is_mobile: m.isMobile ?? false,
          coordenadas: m.coordinatesMobile ?? null, precision_gps: m.precisionMobile ?? null,
          sync_batch_id: batchId, raw: m
        }
      })
      const { error, count } = await sb.from('asis_marcaciones').upsert(rows, {
        onConflict: 'workera_employee_code,fecha_hora,tipo,checksum', ignoreDuplicates: false, count: 'exact'
      })
      if (error) errores.push({ chunk: i/CHUNK, msg: error.message })
      else nuevos += count ?? rows.length
    }
    await logEnd(id, { estado: errores.length > 0 ? 'parcial' : 'ok', consultados: marcaciones.length, nuevos, sin_match: sinMatch, errores: errores.length > 0 ? { chunks: errores } : null })
    return { ok: true, total_marcaciones: marcaciones.length, guardadas: nuevos, sin_match: sinMatch, errores: errores.length }
  } catch(e) {
    await logEnd(id, { estado: 'error', errores: { msg: (e as Error).message } })
    throw e
  }
}

// ACCION: sync_permisos
async function actionPermisos(desde: string, hasta: string) {
  const id = await logStart('permisos', 'manual', { desde, hasta })
  try {
    const cfg = await getCfg()
    const permisos = await wFetchAll(cfg, '/permission', { start: desde, end: hasta })
    const mapeo = await buildMapeo()
    let nuevos = 0; let sinMatch = 0
    const batchId = crypto.randomUUID()
    const rows = permisos.map((p: any) => {
      const code = p.employee?.code ?? null
      const map = code ? mapeo.get(String(code)) : null
      if (!map) sinMatch++
      return {
        workera_id: p.id, workera_employee_code: String(code),
        cod_contaline: map?.cod_contaline ?? null, sucursal_id: map?.sucursal_id ?? null,
        inicio: p.start, fin: p.end, permiso_codigo: p.permissionCode,
        permiso_nombre: p.permissionName, permiso_tipo: p.permissionType,
        comentario: p.comment, sync_batch_id: batchId, raw: p,
        updated_at: new Date().toISOString()
      }
    })
    let errores: any[] = []
    for (let i = 0; i < rows.length; i += 500) {
      const { error, count } = await sb.from('asis_permisos').upsert(rows.slice(i, i+500), { onConflict: 'workera_id', count: 'exact' })
      if (error) errores.push({ chunk: i/500, msg: error.message })
      else nuevos += count ?? 0
    }
    await logEnd(id, { estado: errores.length > 0 ? 'parcial' : 'ok', consultados: permisos.length, nuevos, sin_match: sinMatch, errores: errores.length > 0 ? { chunks: errores } : null })
    return { ok: true, total_permisos: permisos.length, guardados: nuevos, sin_match: sinMatch }
  } catch(e) {
    await logEnd(id, { estado: 'error', errores: { msg: (e as Error).message } })
    throw e
  }
}

// ACCION: sync_hhee
async function actionHHEE(desde: string, hasta: string) {
  const id = await logStart('hhee', 'manual', { desde, hasta })
  try {
    const cfg = await getCfg()
    const hhee = await wFetchAll(cfg, '/overtimeAuthorization', { start: desde, end: hasta })
    const mapeo = await buildMapeo()
    let nuevos = 0; let sinMatch = 0
    const batchId = crypto.randomUUID()
    const rows = hhee.map((h: any) => {
      const code = h.employee?.code ?? null
      const map = code ? mapeo.get(String(code)) : null
      if (!map) sinMatch++
      return {
        workera_employee_code: String(code), cod_contaline: map?.cod_contaline ?? null,
        sucursal_id: map?.sucursal_id ?? null, fecha_autorizada: h.authDate,
        segundos_entrada: h.scheduleInAuthTime ?? 0, segundos_salida: h.scheduleOutAuthTime ?? 0,
        segundos_sin_horario: h.withoutScheduleAuthTime ?? 0, segundos_festivo: h.holidayExtraAuthTime ?? 0,
        asignado: h.assigned ?? false, comentario: h.comment,
        sync_batch_id: batchId, raw: h, updated_at: new Date().toISOString()
      }
    })
    let errores: any[] = []
    for (let i = 0; i < rows.length; i += 500) {
      const { error, count } = await sb.from('asis_horas_extras').upsert(rows.slice(i, i+500), { onConflict: 'workera_employee_code,fecha_autorizada', count: 'exact' })
      if (error) errores.push({ chunk: i/500, msg: error.message })
      else nuevos += count ?? 0
    }
    await logEnd(id, { estado: errores.length > 0 ? 'parcial' : 'ok', consultados: hhee.length, nuevos, sin_match: sinMatch, errores: errores.length > 0 ? { chunks: errores } : null })
    return { ok: true, total_hhee: hhee.length, guardados: nuevos, sin_match: sinMatch }
  } catch(e) {
    await logEnd(id, { estado: 'error', errores: { msg: (e as Error).message } })
    throw e
  }
}

// DISPATCHER
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Solo POST permitido' }, 405)
  try {
    const body = await req.json()
    const action = String(body.action || '').trim()
    switch (action) {
      case 'test_credenciales':  return json(await actionTest())
      case 'sync_catalogos':     return json(await actionCatalogos())
      case 'sync_empleados':     return json(await actionEmpleados())
      case 'sync_marcaciones':
        if (!body.desde || !body.hasta) return json({ error: 'Faltan desde/hasta' }, 400)
        return json(await actionMarcaciones(body.desde, body.hasta))
      case 'sync_permisos':
        if (!body.desde || !body.hasta) return json({ error: 'Faltan desde/hasta' }, 400)
        return json(await actionPermisos(body.desde, body.hasta))
      case 'sync_hhee':
        if (!body.desde || !body.hasta) return json({ error: 'Faltan desde/hasta' }, 400)
        return json(await actionHHEE(body.desde, body.hasta))
      default:
        return json({ error: 'Accion desconocida', acciones_validas: ['test_credenciales','sync_catalogos','sync_empleados','sync_marcaciones','sync_permisos','sync_hhee'] }, 400)
    }
  } catch(e) {
    return json({ error: (e as Error).message }, 500)
  }
}) 
