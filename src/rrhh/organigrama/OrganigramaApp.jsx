// src/rrhh/organigrama/OrganigramaApp.jsx  (v3 — estructura + dotación)
// Organigrama jerárquico — Outlet de Puertas
//
// v2: lienzo con pan/zoom · nodos conectados · ficha lateral de cargo con perfil del
//     ocupante (rrhh_empleados) · búsqueda con auto-expansión.
// v3 (20-oct-2026):
//   · Cada cargo tiene ROL (catálogo org_roles), PLAZAS aprobadas y si CUENTA en la
//     dotación (el Directorio y los servicios externos no cuentan).
//   · Cada persona tiene UN cargo principal; los demás son funciones acumuladas. La
//     dotación cuenta personas por su cargo principal: nadie se cuenta dos veces.
//   · Ocupado / vacante lo mantiene la base (triggers): cambia solo al asignar, quitar
//     o dar de baja. A mano solo se planifica: vacante, propuesto o por crear.
//   · Vista Dotación: matriz rol × sucursal (personas / plazas / faltan / con novedad),
//     cuadratura maestro ↔ organigrama ↔ Workera, alertas de estructura y detalle
//     exportable. Plazas y brechas salen de v_org_dotacion (una sola fuente).
//   · Pendientes: sugiere dónde vincular a cada persona (cargo anterior, mismo rol y
//     sucursal) o qué cargo falta crear.
//   · Edita solo Gestión de Personas (fn_rrhh_es_gestor), igual que la RLS de la base.
//   · Si la migración no está aplicada funciona como v2 (modo básico) y lo avisa.
// Estados (código de colores del directorio):
//   ocupado=verde · vacante=rojo · propuesto=amarillo · por_crear=punteado
// La vista v_org_equipo (SQL) deriva de aquí los equipos del scope RBAC 'equipo'.

import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from 'react'
import { supabase } from '../../supabase'
import { DataGrid } from '../../finanzas/conciliacion/DataGrid'

const ESTADOS = {
  ocupado:   { l:'Ocupado',   c:'#34C759' },
  vacante:   { l:'Vacante',   c:'#FF3B30' },
  propuesto: { l:'Propuesto', c:'#FF9500' },
  por_crear: { l:'Por crear', c:'#8E8E93' },
}
// Ocupado/vacante lo calcula la base según los ocupantes; a mano solo se planifica.
const ESTADOS_MANUALES = ['vacante', 'propuesto', 'por_crear']
const VISTAS = ['arbol', 'dotacion', 'pendientes']

const FAMILIAS = {
  comercial:      { l:'Comercial',      c:'#175CD3' },
  operaciones:    { l:'Operaciones',    c:'#B25E09' },
  administracion: { l:'Administración', c:'#1E7A44' },
  marketing:      { l:'Marketing',      c:'#C11574' },
  direccion:      { l:'Dirección',      c:'#6941C6' },
  externo:        { l:'Externos',       c:'#6E6E73' },
}
const ORDEN_FAMILIAS = ['comercial', 'operaciones', 'administracion', 'marketing', 'direccion', 'externo']

// Estado del día según v_asis_dotacion: 'activo' = sin novedad registrada hoy
const ESTADO_HOY = {
  activo:           { l:'Sin novedad',      c:'#1E7A44' },
  licencia_medica:  { l:'Licencia médica',  c:'#175CD3' },
  vacaciones:       { l:'Vacaciones',       c:'#6941C6' },
  permiso_con_goce: { l:'Permiso con goce', c:'#1E7A44' },
  permiso_sin_goce: { l:'Permiso sin goce', c:'#B25E09' },
  otro:             { l:'Otra novedad',     c:'#6E6E73' },
}
const estHoy = k => ESTADO_HOY[k] || { l: k || 'Sin novedad', c:'#6E6E73' }

const ROLES = [
  { k:"admin", l:"Admin", c:"var(--danger)" },
  { k:"dir_general", l:"Dir. General", c:"var(--danger)" },
  { k:"dir_finanzas", l:"Dir. Finanzas", c:"var(--purple)" },
  { k:"dir_negocios", l:"Dir. Negocios", c:"var(--accent)" },
  { k:"dir_operaciones", l:"Dir. Operaciones", c:"var(--info)" },
  { k:"analista", l:"Analista", c:"var(--success)" },
  { k:"directorio", l:"Directorio", c:"var(--text-muted)" }
]
const rl = u => ROLES.find(r=>r.k===u?.rol)||ROLES[5]

const iniciales = n => String(n||'?').trim().split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase()
const fFecha = d => { if(!d) return '—'; const [y,m,dd]=String(d).slice(0,10).split('-'); return `${dd}-${m}-${y}` }

// Paleta determinista para avatares
const AV_COLORS = ['#5856D6','#007AFF','#34C759','#FF9500','#AF52DE','#FF2D55','#00B8A9','#8E6CEF']
const avColor = key => {
  const n = typeof key === 'number' ? key : String(key||'').split('').reduce((s,ch)=>s+ch.charCodeAt(0),0)
  return AV_COLORS[Math.abs(n) % AV_COLORS.length]
}
const nomOcupante = o => o.emp?.nombre || o.nombre_manual || `#${o.cod_contaline}`
const avKey = o => o.cod_contaline ?? o.nombre_manual
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Rol probable a partir del cargo de contrato (para sugerir dónde vincular a alguien).
// El orden importa: la regla más específica va primero.
const ROL_DESDE_CONTRATO = [
  [/gerente|gerencia/,                          'gerencia'],
  [/jefe\/?a? (de )?tienda/,                    'jefe_tienda'],
  [/jefe\/?a? (de )?(bodega|sucursal)/,         'jefe_bodega'],
  [/coordinador\/?a? (de )?venta/,              'coord_ventas'],
  [/coordinador\/?a? (de )?(picking|despach)/,  'coord_picking'],
  [/coordinador\/?a? (de )?bodega/,             'coord_bodega'],
  [/jefe|encargad|subgerente/,                  'jefatura_area'],
  [/grua/,                                      'gruero'],
  [/picker|picking/,                            'picker'],
  [/transport|chofer|conductor|despach/,        'transporte'],
  [/bodeg/,                                     'bodeguero'],
  [/caj(a|er)/,                                 'caja'],
  [/post ?venta/,                               'postventa'],
  [/vended|ventas/,                             'vendedor'],
  [/compra|adquisic|comex/,                     'compras'],
  [/marketing|contenido|community|comunity|social media|disen/, 'marketing'],
  [/asistente|administrativ|backoffice/,        'asist_admin'],
]
const rolDesdeTexto = t => { const n = norm(t); if (!n) return null; for (const [re, r] of ROL_DESDE_CONTRATO) if (re.test(n)) return r; return null }

// Pastilla "ocupan/plazas" del nodo
function pillDotacion(m) {
  const aprob = m.plazas_aprobadas || 0, prop = m.plazas_propuestas || 0
  if (!aprob && !prop) return null
  if (!aprob) return { t:`${m.ocupacion}/${prop}`, c:'#6E6E73', title:`${prop} plaza(s) propuesta(s), aún no aprobada(s)` }
  const falt = Math.max(m.brecha || 0, 0)
  const c = m.ocupacion >= aprob ? '#1E7A44' : m.ocupacion > 0 ? '#B25E09' : '#B42318'
  return { t:`${m.ocupacion}/${aprob}`, c,
    title:`${m.ocupacion} ocupando · ${aprob} plaza(s) aprobada(s)${falt ? ` · faltan ${falt}` : ''}${m.n_secundarios ? ` · ${m.n_secundarios} con función acumulada` : ''}` }
}

// Sugerencia para quien no tiene cargo: su cargo anterior → un cargo de su rol en su
// sucursal (con plaza libre primero) → crear el cargo bajo la jefatura de su área.
function sugerirCargo(emp, cargos, metPorId, rolPorCod, anteriorId) {
  if (anteriorId != null) {
    const ant = cargos.find(c => c.id === anteriorId)
    if (ant) return { tipo:'anterior', cargo:ant }
  }
  const rolE = rolDesdeTexto(emp.cargo)
  if (!rolE) return null
  const libre = c => (metPorId[c.id]?.brecha || 0) > 0 ? 1 : 0
  const planif = c => (c.estado === 'propuesto' || c.estado === 'por_crear') ? 1 : 0
  const misma = cargos
    .filter(c => c.rol_codigo === rolE && c.cuenta_dotacion !== false && c.sucursal_id === emp.sucursal_id)
    .sort((a, b) => libre(b) - libre(a) || planif(a) - planif(b) || a.nombre.localeCompare(b.nombre))
  if (misma.length) return { tipo:'rol', cargo:misma[0] }
  const rol = rolPorCod[rolE]
  if (!rol || !emp.sucursal_id) return null
  const jefes = cargos
    .filter(c => c.sucursal_id === emp.sucursal_id && c.cuenta_dotacion !== false
      && rolPorCod[c.rol_codigo]?.es_jefatura && rolPorCod[c.rol_codigo]?.familia === rol.familia)
    .sort((a, b) => (metPorId[a.id]?.nivel ?? 99) - (metPorId[b.id]?.nivel ?? 99))
  return { tipo:'crear', rol, padre: jefes[0] || null }
}

const VACIA = { plazas:0, propuestas:0, faltan:0, sobran:0, acum:0, sinFicha:0, personas:0, ausentes:0 }
const sumar = lista => lista.reduce((s, v) => { if (v) for (const k of Object.keys(VACIA)) s[k] += v[k] || 0; return s }, { ...VACIA })

const OC_CSS = `
.oc-viewport { position:relative; overflow:hidden; border-radius:14px;
  --oc-line: color-mix(in srgb, var(--text-muted) 70%, var(--accent) 30%);
  background:
  radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--border) 55%, transparent) 1px, transparent 0);
  background-size: 26px 26px; background-color: var(--bg-app);
  border:1px solid var(--border); cursor:grab; user-select:none; }
.oc-viewport.arrastrando { cursor:grabbing; }
.oc-canvas { position:absolute; top:0; left:0; transform-origin:0 0; will-change:transform; }
.oc-nodo { display:flex; flex-direction:column; align-items:center; }
.oc-hijos { display:flex; align-items:flex-start; }
/* ── Conectores tipo codo ──
   Cada rama dibuja su mitad del riel superior; el hijo del extremo
   redondea la esquina y baja en vertical hasta su tarjeta. */
.oc-rama { display:flex; flex-direction:column; align-items:center; position:relative; padding:30px 12px 0; }
.oc-rama::before, .oc-rama::after { content:''; position:absolute; top:0; height:30px; box-sizing:border-box; }
.oc-rama::before { right:50%; width:50%; border-top:2px solid var(--oc-line); }
.oc-rama::after  { left:50%;  width:50%; border-top:2px solid var(--oc-line); border-left:2px solid var(--oc-line); }
.oc-rama:first-child::before { border:0; }
.oc-rama:last-child::after   { border:0; }
.oc-rama:last-child::before  { border-right:2px solid var(--oc-line); border-radius:0 12px 0 0; }
.oc-rama:first-child::after  { border-radius:12px 0 0 0; }
.oc-rama:only-child::before  { display:none; }
.oc-rama:only-child::after   { border:0; border-left:2px solid var(--oc-line); border-radius:0; }
.oc-stub { width:2px; height:12px; background:var(--oc-line); }
.oc-card { position:relative; width:216px; background:var(--bg-surface); border:1px solid var(--border);
  border-radius:12px; padding:10px 12px 10px 15px; text-align:left; cursor:pointer;
  transition: box-shadow .15s ease, transform .15s ease, border-color .15s ease;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
.oc-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.12); }
.oc-card:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.oc-card.sel { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent), 0 6px 18px rgba(0,0,0,0.12); }
.oc-card.hit { box-shadow: 0 0 0 3px #FF950055, 0 6px 18px rgba(0,0,0,0.12); }
.oc-card.punteado { border-style:dashed; opacity:.82; }
.oc-card.contexto { opacity:.45; }
.oc-card.contexto:hover { opacity:.85; }
.oc-spine { position:absolute; left:0; top:10px; bottom:10px; width:4px; border-radius:4px; }
.oc-pill { margin-left:auto; padding:1px 7px; border-radius:100px; font-size:10px; font-weight:800;
  font-variant-numeric:tabular-nums; white-space:nowrap; flex-shrink:0; }
.oc-colapsar { font-size:10px; font-weight:700; padding:2px 10px; border-radius:100px;
  border:1.5px solid var(--oc-line); background:var(--bg-surface); color:var(--text-muted); cursor:pointer; }
.oc-colapsar:hover { color:var(--text); border-color:var(--text-muted); }
.oc-drawer { position:fixed; top:0; right:0; bottom:0; width:404px; max-width:92vw; z-index:300;
  background:var(--bg-surface); border-left:1px solid var(--border);
  box-shadow:-12px 0 32px rgba(0,0,0,0.14); display:flex; flex-direction:column;
  animation: ocSlide .18s ease; }
@keyframes ocSlide { from { transform:translateX(24px); opacity:0 } to { transform:none; opacity:1 } }
.oc-kpis { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:8px; }
.oc-dot-grid { display:grid; grid-template-columns:minmax(0,1fr) 360px; gap:12px; align-items:start; }
.oc-mx { width:100%; border-collapse:collapse; font-size:12px; font-variant-numeric:tabular-nums; }
.oc-mx th { padding:7px 8px; font-size:10.5px; font-weight:700; color:var(--text-muted); text-align:center;
  border-bottom:1px solid var(--border); white-space:nowrap; background:var(--bg-surface); }
.oc-mx th.rol { text-align:left; }
.oc-mx td { border-bottom:1px solid var(--border); padding:5px 8px; text-align:center; vertical-align:middle; }
.oc-mx td.rol { text-align:left; white-space:nowrap; }
.oc-mx .clic { cursor:pointer; }
.oc-mx .clic:hover { background:var(--bg-app); }
.oc-mx tr.total td { border-top:2px solid var(--border); font-weight:700; }
@media (max-width:1180px) { .oc-dot-grid { grid-template-columns:1fr; } .oc-kpis { grid-template-columns:repeat(3, minmax(0,1fr)); } }
@media (prefers-reduced-motion: reduce) {
  .oc-card, .oc-drawer { transition:none; animation:none; }
}
`

// embebido/sub/onSub: patrón del shell tipo Finanzas. sub = 'arbol' | 'dotacion' | 'pendientes'.
export function OrganigramaApp({ cu, onVolverHubRrhh, onCerrarSesion, embebido, sub, onSub }) {
  const [cargos, setCargos]   = useState([])
  const [asigs, setAsigs]     = useState([])
  const [hist, setHist]       = useState([])      // asignaciones cerradas: sugieren el cargo anterior
  const [emps, setEmps]       = useState([])
  const [sucs, setSucs]       = useState([])
  const [roles, setRoles]     = useState([])
  const [met, setMet]         = useState([])      // v_org_dotacion
  const [wk, setWk]           = useState(null)    // { activos, mapeo } · cuadratura con Workera
  const [migrada, setMigrada] = useState(true)    // la base ya tiene roles, plazas y cargo principal
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [cargando, setCarg]   = useState(true)
  const [msg, setMsg]         = useState(null)

  const [selId, setSelId] = useState(null)
  const [vista, setVista] = useState(VISTAS.includes(sub) ? sub : 'arbol')
  const primeraSub = useRef(true)
  useEffect(() => { if (primeraSub.current) { primeraSub.current = false; return } if (VISTAS.includes(sub) && sub !== vista) setVista(sub) }, [sub]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onSub?.(vista) }, [vista]) // eslint-disable-line react-hooks/exhaustive-deps
  const px = embebido ? 0 : 24
  const [modalVinc, setModalVinc]   = useState(null)   // empleado a vincular
  const [colapsados, setColaps]     = useState(new Set())
  const [busq, setBusq]             = useState('')
  const [fSuc, setFSuc]             = useState('todas')
  const [verBrechas, setVerBrechas] = useState(false)
  const [modalCargo, setModalCargo] = useState(null)   // { padre_id, cargo?, prefill? }

  // ── Pan / Zoom ──
  const [view, setView] = useState({ x: 60, y: 30, k: 0.85 })
  const [drag, setDrag] = useState(null)
  const vpRef = useRef(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCarg(true)
    try {
      const [c, a, h, e, d, s, r, m, g] = await Promise.all([
        supabase.from('org_cargos').select('*').eq('activo', true).order('orden').order('nombre'),
        supabase.from('org_asignaciones').select('*').eq('activo', true),
        supabase.from('org_asignaciones').select('cargo_id,cod_contaline,hasta').eq('activo', false)
          .not('cod_contaline', 'is', null).order('hasta', { ascending: false }).limit(3000),
        supabase.from('rrhh_empleados').select('cod_contaline,nombre,rut,sucursal_id,cargo,fecha_ingreso,activo,exento_asistencia')
          .eq('activo', true).is('fusionada_en', null).order('nombre'),
        supabase.from('v_asis_dotacion').select('cod_contaline,estado_actual,novedad_tipo,novedad_desde,novedad_hasta,novedad_motivo,novedad_fuente')
          .eq('activo', true).limit(5000),
        supabase.from('sucursales').select('id,nombre,orden,es_cd').order('orden'),
        supabase.from('org_roles').select('*').eq('activo', true).order('orden'),
        supabase.from('v_org_dotacion').select('*').limit(5000),
        supabase.rpc('fn_rrhh_es_gestor'),
      ])
      if (c.error) throw c.error
      if (a.error) throw a.error
      if (e.error) throw e.error
      const hoy = Object.fromEntries((d.data || []).map(x => [x.cod_contaline, x]))
      setCargos(c.data || []); setAsigs(a.data || []); setHist(h.data || [])
      setEmps((e.data || []).map(x => ({ ...x, hoy: hoy[x.cod_contaline] || null })))
      setSucs(s.data || [])
      const ok = !r.error && !m.error
      setMigrada(ok); setRoles(ok ? (r.data || []) : []); setMet(ok ? (m.data || []) : [])
      setPuedeEditar(g?.data === true)
    } catch (err) { setMsg({ tipo:'error', txt:err.message }) }
    finally { setCarg(false) }
    // Cuadratura con Workera: informativa, no bloquea la carga
    Promise.all([
      supabase.from('asis_staging_empleados_workera')
        .select('workera_code,nombre_completo,workera_branch_name,workera_dept_name,sugerencia_cod_contaline')
        .eq('employee_status', 'ACTIVO').limit(3000),
      supabase.from('asis_mapeo_empleados').select('cod_contaline,workera_code').limit(5000),
    ]).then(([st, mp]) => { if (!st.error && !mp.error) setWk({ activos: st.data || [], mapeo: mp.data || [] }) }, () => {})
  }

  // ── Índices ──
  const empPorCod  = useMemo(() => Object.fromEntries(emps.map(e => [e.cod_contaline, e])), [emps])
  const cargoPorId = useMemo(() => Object.fromEntries(cargos.map(c => [c.id, c])), [cargos])
  const metPorId   = useMemo(() => Object.fromEntries(met.map(m => [m.cargo_id, m])), [met])
  const rolPorCod  = useMemo(() => Object.fromEntries(roles.map(r => [r.codigo, r])), [roles])
  const sucNombre  = useCallback(id => sucs.find(s => s.id === id)?.nombre || id || '—', [sucs])

  const hijosDe = useMemo(() => {
    const m = {}
    for (const c of cargos) { const k = c.cargo_padre_id ?? 'root'; (m[k] = m[k]||[]).push(c) }
    return m
  }, [cargos])

  const ocupantesDe = useMemo(() => {
    const m = {}
    for (const a of asigs) (m[a.cargo_id] = m[a.cargo_id]||[]).push({ ...a, emp: empPorCod[a.cod_contaline] })
    // titulares primero, luego funciones acumuladas y al final los registros sin ficha
    const peso = o => o.cod_contaline == null ? 2 : (o.es_principal === false ? 1 : 0)
    for (const k of Object.keys(m)) m[k].sort((x, y) => peso(x) - peso(y) || nomOcupante(x).localeCompare(nomOcupante(y)))
    return m
  }, [asigs, empPorCod])

  const asigsDePersona = useMemo(() => {
    const m = {}
    for (const a of asigs) { if (a.cod_contaline == null) continue; (m[a.cod_contaline] = m[a.cod_contaline]||[]).push(a) }
    return m
  }, [asigs])

  // Cargo principal de cada persona (si la base aún no lo distingue, el primero)
  const principalDe = useMemo(() => {
    const m = {}
    for (const [cod, l] of Object.entries(asigsDePersona)) m[cod] = l.find(a => a.es_principal !== false) || l[0]
    return m
  }, [asigsDePersona])

  const cargosDePersona = useMemo(() => {
    const m = {}
    for (const [cod, l] of Object.entries(asigsDePersona)) m[cod] = l.map(a => cargoPorId[a.cargo_id]).filter(Boolean)
    return m
  }, [asigsDePersona, cargoPorId])

  const cargoAnteriorDe = useMemo(() => {
    const m = {}
    for (const x of hist) if (m[x.cod_contaline] == null && cargoPorId[x.cargo_id]) m[x.cod_contaline] = x.cargo_id
    return m
  }, [hist, cargoPorId])

  const pendientes = useMemo(() => emps.filter(e => !asigsDePersona[e.cod_contaline]), [emps, asigsDePersona])

  // Jefatura efectiva: el ancestro más cercano que tiene ocupante
  const jefaturaDe = useCallback(cargoId => {
    let p = cargoPorId[cargoId]?.cargo_padre_id
    while (p != null) {
      const oc = ocupantesDe[p] || []
      if (oc.length) return { cargo: cargoPorId[p], nombres: oc.map(nomOcupante).join(', ') }
      p = cargoPorId[p]?.cargo_padre_id
    }
    return null
  }, [cargoPorId, ocupantesDe])

  // Cuadratura maestro ↔ Workera
  const wkRes = useMemo(() => {
    if (!wk) return null
    const activos = new Set(emps.map(e => e.cod_contaline))
    const codPorWk = Object.fromEntries(wk.mapeo.map(x => [x.workera_code, x.cod_contaline]))
    const mapeados = new Set(wk.mapeo.map(x => x.cod_contaline).filter(x => x != null))
    const sinFicha = wk.activos.filter(w => {
      const cod = codPorWk[w.workera_code]
      if (cod != null && activos.has(cod)) return false
      // la ficha existe y solo falta el vínculo: se informa en "fichas sin vínculo"
      if (w.sugerencia_cod_contaline != null && activos.has(w.sugerencia_cod_contaline)) return false
      return true
    })
    const sinVinculo = emps.filter(e => !e.exento_asistencia && !mapeados.has(e.cod_contaline))
    return { mapeados, sinFicha, sinVinculo }
  }, [wk, emps])

  const conBrecha = useMemo(() => new Set(met.filter(m => m.cuenta_dotacion !== false && (m.brecha || 0) > 0).map(m => m.cargo_id)), [met])

  const stats = useMemo(() => {
    const cuenta = met.filter(m => m.cuenta_dotacion !== false)
    return {
      total: cargos.length,
      ocupados:   cargos.filter(c=>c.estado==='ocupado').length,
      vacantes:   cargos.filter(c=>c.estado==='vacante').length,
      propuestos: cargos.filter(c=>c.estado==='propuesto').length,
      porCrear:   cargos.filter(c=>c.estado==='por_crear').length,
      asignados:  emps.filter(e => asigsDePersona[e.cod_contaline]).length,
      plazas:     cuenta.reduce((s, m) => s + (m.plazas_aprobadas || 0), 0),
      porCubrir:  cuenta.reduce((s, m) => s + Math.max(m.brecha || 0, 0), 0),
    }
  }, [cargos, met, emps, asigsDePersona])

  // ── Búsqueda y resaltado de brechas: ids que calzan + ancestros a expandir ──
  const { hits, expandidos } = useMemo(() => {
    const q = norm(busq.trim())
    const hits = new Set()
    if (q) {
      for (const c of cargos) {
        const ocupNombres = (ocupantesDe[c.id]||[]).map(nomOcupante).join(' ')
        const txt = `${c.nombre} ${c.area||''} ${c.notas||''} ${rolPorCod[c.rol_codigo]?.nombre||''} ${sucNombre(c.sucursal_id)} ${ocupNombres}`
        if (norm(txt).includes(q)) hits.add(c.id)
      }
    }
    if (verBrechas) for (const id of conBrecha) hits.add(id)
    if (!q && !verBrechas) return { hits, expandidos: null }
    const exp = new Set()
    for (const id of hits) {
      let p = cargoPorId[id]?.cargo_padre_id
      while (p != null) { exp.add(p); p = cargoPorId[p]?.cargo_padre_id }
    }
    return { hits, expandidos: exp }
  }, [busq, verBrechas, conBrecha, cargos, ocupantesDe, cargoPorId, rolPorCod, sucNombre])

  const estaColapsado = useCallback(id => {
    if (expandidos) return false            // buscando o resaltando: todo visible
    return colapsados.has(id)
  }, [colapsados, expandidos])

  // ── Filtro por sucursal: sus cargos + sus superiores como contexto (atenuados) ──
  const filtroSuc = useMemo(() => {
    if (fSuc === 'todas') return null
    const directos = new Set(cargos.filter(c => c.sucursal_id === fSuc).map(c => c.id))
    const contexto = new Set()
    for (const id of directos) {
      let p = cargoPorId[id]?.cargo_padre_id
      while (p != null) { if (!directos.has(p)) contexto.add(p); p = cargoPorId[p]?.cargo_padre_id }
    }
    return { visibles: new Set([...directos, ...contexto]), contexto }
  }, [fSuc, cargos, cargoPorId])

  const sucsConCargos = useMemo(() => {
    const usadas = new Set(cargos.map(c => c.sucursal_id).filter(Boolean))
    return sucs.filter(s => usadas.has(s.id))
  }, [cargos, sucs])

  // ── Pan / zoom handlers ──
  function onPointerDown(e) {
    if (e.target.closest('[data-card]') || e.target.closest('button')) return
    setDrag({ sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y })
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e) {
    if (!drag) return
    setView(v => ({ ...v, x: drag.ox + (e.clientX - drag.sx), y: drag.oy + (e.clientY - drag.sy) }))
  }
  function onPointerUp() { setDrag(null) }

  const zoom = dir => setView(v => ({ ...v, k: Math.min(1.6, Math.max(0.3, v.k * (dir>0?1.18:0.847))) }))
  const ajustar = () => setView({ x: 60, y: 30, k: 0.85 })

  // La rueda se engancha cuando el lienzo existe (en v2 se enganchaba al montar, antes
  // de que el lienzo apareciera, y la rueda nunca movía ni hacía zoom).
  const hayArbol = (hijosDe['root'] || []).length > 0
  useEffect(() => {
    const el = vpRef.current
    if (!el) return
    const onWheel = e => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        setView(v => ({ ...v, k: Math.min(1.6, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.1 : 0.909))) }))
      } else {
        setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [cargando, vista, hayArbol])

  function toggleColapso(id) {
    setColaps(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const colapsarTodo = () => setColaps(new Set(cargos.filter(c=>(hijosDe[c.id]||[]).length>0 && c.cargo_padre_id!=null).map(c=>c.id)))
  const expandirTodo = () => setColaps(new Set())

  // ── Acciones (solo gestión; la RLS de la base aplica la misma regla) ──
  const ahora = () => new Date().toISOString()

  async function desactivarCargo(cargo) {
    const nH = (hijosDe[cargo.id]||[]).length
    const nO = (ocupantesDe[cargo.id]||[]).length
    if (nH > 0) { setMsg({tipo:'error', txt:`"${cargo.nombre}" tiene ${nH} cargo(s) dependiente(s). Muévelos o desactívalos primero.`}); return }
    if (nO > 0) { setMsg({tipo:'error', txt:`"${cargo.nombre}" tiene ${nO} ocupante(s). Quítalos primero.`}); return }
    if (!window.confirm(`¿Desactivar el cargo "${cargo.nombre}"?`)) return
    try {
      const { error } = await supabase.from('org_cargos').update({ activo:false, updated_at:ahora() }).eq('id', cargo.id)
      if (error) throw error
      setSelId(null)
      await cargar()
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }

  async function cambiarEstado(cargo, estado) {
    if (migrada && estado === 'ocupado') return
    if (migrada && (ocupantesDe[cargo.id]||[]).length > 0) { setMsg({ tipo:'error', txt:'El cargo tiene ocupantes: queda "Ocupado" mientras alguien lo ocupe.' }); return }
    try {
      const { error } = await supabase.from('org_cargos').update({ estado, updated_at:ahora() }).eq('id', cargo.id)
      if (error) throw error
      await cargar()
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }

  async function guardarPlazas(cargo, n) {
    const { error } = await supabase.from('org_cargos').update({ plazas:n, updated_at:ahora() }).eq('id', cargo.id)
    if (error) throw error
    await cargar()
    setMsg({ tipo:'ok', txt:`"${cargo.nombre}" queda con ${n} plaza(s) aprobada(s).` })
  }

  async function marcarPrincipal(asig) {
    const { error } = await supabase.rpc('fn_org_marcar_principal', { p_asig: asig.id })
    if (error) throw error
    await cargar()
    setMsg({ tipo:'ok', txt:`${nomOcupante(asig)}: "${cargoPorId[asig.cargo_id]?.nombre}" es ahora su cargo principal.` })
  }

  async function vincularA(emp, cargo) {
    try {
      const { error } = await supabase.from('org_asignaciones').insert({ cargo_id: cargo.id, cod_contaline: emp.cod_contaline, asignado_por: cu.id })
      if (error) throw error
      if (!migrada && cargo.estado !== 'ocupado') await supabase.from('org_cargos').update({ estado:'ocupado', updated_at:ahora() }).eq('id', cargo.id)
      await cargar()
      setMsg({ tipo:'ok', txt:`${emp.nombre} quedó en "${cargo.nombre}".` })
    } catch(e) { setMsg({ tipo:'error', txt:e.message }) }
  }

  const irACargo = useCallback(id => { setVista('arbol'); setFSuc('todas'); setSelId(id) }, [])

  const raices = (hijosDe['root'] || []).filter(c => !filtroSuc || filtroSuc.visibles.has(c.id))
  const sel = selId != null ? cargoPorId[selId] : null

  return (
    <div style={{minHeight:embebido?undefined:"100vh",background:embebido?undefined:"var(--bg-app)",display:'flex',flexDirection:'column'}}>
      <style>{OC_CSS}</style>

      {!embebido && <header style={{background:"var(--bg-surface)",borderBottom:"1px solid var(--border)",padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:'wrap',position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <button onClick={onVolverHubRrhh} style={btnSec}>&larr; Gestión de Personas</button>
          <div style={{fontSize:22}}>🏛️</div>
          <div>
            <div style={{fontSize:17,fontWeight:600}}>Organigrama 2026/2027</div>
            <div style={{fontSize:11,color:"var(--text-muted)"}}>Casa Matriz · 3 tiendas · CD Maipú</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <input value={busq} onChange={e=>setBusq(e.target.value)}
            placeholder="🔎 Buscar cargo, rol o persona..."
            style={{...inpBase,width:230}}/>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:13,fontWeight:600}}>{cu.nombre}</div>
              <div style={{fontSize:11,color:rl(cu).c,fontWeight:600}}>{rl(cu).l}</div>
            </div>
            <button onClick={onCerrarSesion} style={btnGhost}>Salir</button>
          </div>
        </div>
      </header>}

      {/* Barra de stats + controles */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,padding:embebido?'0 0 12px':'10px 24px'}}>
        <div style={{display:'flex',gap:14,flexWrap:'wrap',alignItems:'center',fontSize:12,color:'var(--text-muted)'}}>
          {!embebido && <div style={{display:'flex',gap:2,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,padding:3}}>
            <button onClick={()=>setVista('arbol')} style={{...tabBtn, ...(vista==='arbol'?tabBtnOn:{})}}>Organigrama</button>
            <button onClick={()=>setVista('dotacion')} style={{...tabBtn, ...(vista==='dotacion'?tabBtnOn:{})}}>Dotación</button>
            <button onClick={()=>setVista('pendientes')} style={{...tabBtn, ...(vista==='pendientes'?tabBtnOn:{})}}>
              Sin cargo
              {pendientes.length > 0 && <span style={{marginLeft:6,fontSize:10,fontWeight:800,padding:'1px 7px',borderRadius:100,background:'#FF950020',color:'#FF9500'}}>{pendientes.length}</span>}
            </button>
          </div>}
          <span><strong style={{color:'var(--text)',fontSize:15}}>{stats.total}</strong> cargos</span>
          {Object.entries(ESTADOS).map(([k,v])=>(
            <span key={k} style={{display:'inline-flex',alignItems:'center',gap:5}}>
              <span style={{width:8,height:8,borderRadius:100,background:v.c,display:'inline-block',
                ...(k==='por_crear'?{background:'transparent',border:`1.5px dashed ${v.c}`}:{})}}/>
              <strong style={{color:v.c}}>{k==='ocupado'?stats.ocupados:k==='vacante'?stats.vacantes:k==='propuesto'?stats.propuestos:stats.porCrear}</strong> {v.l.toLowerCase()}
            </span>
          ))}
          <span>· <strong style={{color:'var(--text)'}}>{stats.asignados}</strong>/{emps.length} personas con cargo</span>
          {migrada && <span>· <strong style={{color:'var(--text)'}}>{stats.plazas}</strong> plazas · <strong style={{color:stats.porCubrir?'#B42318':'var(--text)'}}>{stats.porCubrir}</strong> por cubrir</span>}
          {!cargando && !puedeEditar && <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,background:'var(--bg-card)',border:'1px solid var(--border)'}}>Solo lectura</span>}
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          {embebido && <input value={busq} onChange={e=>setBusq(e.target.value)}
            placeholder="Buscar cargo, rol o persona" aria-label="Buscar cargo, rol o persona"
            style={{...inpBase,width:230}}/>}
          {vista==='arbol' && <>
          <select value={fSuc} onChange={e=>setFSuc(e.target.value)} aria-label="Filtrar por sucursal" style={{...inpBase,padding:'7px 9px'}}>
            <option value="todas">Todas las sucursales</option>
            {sucsConCargos.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          {migrada && conBrecha.size > 0 && <button onClick={()=>setVerBrechas(v=>!v)} aria-pressed={verBrechas}
            style={{...chip, ...(verBrechas?{background:'#B4231812',color:'#B42318',border:'1px solid #B4231855'}:{})}}>
            Resaltar plazas por cubrir ({conBrecha.size})</button>}
          <span style={{width:1,height:20,background:'var(--border)'}}/>
          <button onClick={()=>zoom(-1)} style={btnCtl} title="Alejar" aria-label="Alejar">−</button>
          <span style={{fontSize:11,color:'var(--text-muted)',minWidth:38,textAlign:'center'}}>{Math.round(view.k*100)}%</span>
          <button onClick={()=>zoom(1)} style={btnCtl} title="Acercar" aria-label="Acercar">+</button>
          <button onClick={ajustar} style={btnCtl} title="Restablecer vista" aria-label="Restablecer vista">⌂</button>
          <span style={{width:1,height:20,background:'var(--border)'}}/>
          <button onClick={expandirTodo} style={btnCtl} title="Expandir todo" aria-label="Expandir todo">⊞</button>
          <button onClick={colapsarTodo} style={btnCtl} title="Colapsar ramas" aria-label="Colapsar ramas">⊟</button>
          {puedeEditar && <span style={{width:1,height:20,background:'var(--border)'}}/>}
          </>}
          {puedeEditar && vista==='arbol' && <button onClick={()=>setModalCargo({ padre_id:null })} style={btnPri}>➕ Cargo raíz</button>}
        </div>
      </div>

      {msg && (
        <div style={{margin:`0 ${px}px 10px`,padding:'9px 14px',borderRadius:8,fontSize:13,
          background: msg.tipo==='error' ? '#FF3B3012' : '#34C75912',
          border: `1px solid ${msg.tipo==='error' ? '#FF3B3040' : '#34C75940'}`,
          display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>{msg.tipo==='error'?'⚠️':'✅'} {msg.txt}</span>
          <button onClick={()=>setMsg(null)} aria-label="Cerrar aviso" style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
        </div>
      )}
      {!cargando && !migrada && (
        <div style={{margin:`0 ${px}px 10px`,padding:'9px 14px',borderRadius:8,fontSize:12.5,background:'#FFFAEB',border:'1px solid #FEDF89',color:'#93370D'}}>
          La base aún no tiene roles, plazas ni cargo principal: el organigrama funciona en modo básico. Falta aplicar la migración de dotación del organigrama.
        </div>
      )}

      {/* Lienzo / Dotación / Sin cargo */}
      <div style={{flex:1,padding:`0 ${px}px ${px}px`,minHeight:0}}>
        {vista === 'pendientes' ? (
          <PanelPendientes pendientes={pendientes} busq={busq} totalEmps={emps.length}
            cargos={cargos} metPorId={metPorId} rolPorCod={rolPorCod} sucNombre={sucNombre}
            cargoAnteriorDe={cargoAnteriorDe} puedeEditar={puedeEditar} wkRes={wkRes}
            onElegir={setModalVinc} onVincularA={vincularA}
            onCrearCargo={(emp, s) => setModalCargo({ padre_id: s.padre?.id ?? null, prefill: {
              nombre: `${s.rol.nombre} ${sucNombre(emp.sucursal_id)}`, rol_codigo: s.rol.codigo,
              sucursal_id: emp.sucursal_id, area: s.padre?.area || FAMILIAS[s.rol.familia]?.l || '' } })}/>
        ) : vista === 'dotacion' ? (
          <PanelDotacion cargando={cargando} migrada={migrada} cargos={cargos} met={met} emps={emps}
            asigsDePersona={asigsDePersona} principalDe={principalDe} cargoPorId={cargoPorId}
            ocupantesDe={ocupantesDe} roles={roles} rolPorCod={rolPorCod} sucs={sucs} sucNombre={sucNombre}
            jefaturaDe={jefaturaDe} wkRes={wkRes} onIrACargo={irACargo} onIrPendientes={()=>setVista('pendientes')}/>
        ) : cargando ? (
          <div style={{padding:80,textAlign:'center',color:'var(--text-muted)'}}>Cargando organigrama...</div>
        ) : !hayArbol ? (
          <div style={{maxWidth:480,margin:'60px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'40px 28px'}}>
            <div style={{fontSize:48,marginBottom:12}}>🏛️</div>
            <h3 style={{margin:'0 0 6px 0'}}>Organigrama vacío</h3>
            <p style={{color:'var(--text-muted)',fontSize:13,margin:'0 0 20px 0'}}>Crea el primer cargo raíz o corre el seed de la estructura 2026/2027.</p>
            {puedeEditar && <button onClick={()=>setModalCargo({ padre_id:null })} style={btnPri}>➕ Crear primer cargo</button>}
          </div>
        ) : (
          <div ref={vpRef} className={`oc-viewport ${drag?'arrastrando':''}`}
            style={{height:embebido?'calc(100vh - 175px)':'calc(100vh - 190px)',minHeight:420}}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <div className="oc-canvas" style={{transform:`translate(${view.x}px, ${view.y}px) scale(${view.k})`}}>
              <div style={{display:'flex',gap:60,alignItems:'flex-start',padding:'10px 40px 80px'}}>
                {raices.map(c => (
                  <Nodo key={c.id} cargo={c}
                    hijosDe={hijosDe} ocupantesDe={ocupantesDe} metPorId={metPorId} rolPorCod={rolPorCod}
                    sucNombre={sucNombre} filtroSuc={filtroSuc}
                    estaColapsado={estaColapsado} onToggle={toggleColapso}
                    selId={selId} hits={hits} onSel={setSelId} />
                ))}
              </div>
            </div>
            {raices.length === 0 && <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)',fontSize:13}}>No hay cargos en {sucNombre(fSuc)}.</div>}
            <div style={{position:'absolute',bottom:10,left:14,fontSize:10.5,color:'var(--text-muted)',pointerEvents:'none'}}>
              Arrastra para mover · rueda para desplazar · Ctrl+rueda para zoom · clic en un cargo para ver su ficha{filtroSuc ? ' · atenuados: superiores de otra sucursal' : ''}
            </div>
          </div>
        )}
      </div>

      {/* Ficha lateral */}
      {sel && (
        <FichaCargo
          cargo={sel} cu={cu} m={metPorId[sel.id]} rol={rolPorCod[sel.rol_codigo]}
          ocupantes={ocupantesDe[sel.id]||[]}
          hijos={hijosDe[sel.id]||[]}
          padre={sel.cargo_padre_id != null ? cargoPorId[sel.cargo_padre_id] : null}
          jefatura={jefaturaDe(sel.id)}
          emps={emps} cargosDePersona={cargosDePersona} principalDe={principalDe} cargoPorId={cargoPorId}
          sucNombre={sucNombre} puedeEditar={puedeEditar} migrada={migrada}
          onCerrar={()=>setSelId(null)}
          onEditar={()=>setModalCargo({ padre_id: sel.cargo_padre_id, cargo: sel })}
          onNuevoHijo={()=>setModalCargo({ padre_id: sel.id })}
          onDesactivar={()=>desactivarCargo(sel)}
          onCambiarEstado={est=>cambiarEstado(sel, est)}
          onGuardarPlazas={n=>guardarPlazas(sel, n)}
          onMarcarPrincipal={marcarPrincipal}
          onCambio={cargar}
          onIrACargo={setSelId}
        />
      )}

      {modalCargo && (
        <ModalCargo ctx={modalCargo} sucs={sucs} cargos={cargos} roles={roles} migrada={migrada}
          ocupado={!!modalCargo.cargo && (ocupantesDe[modalCargo.cargo.id]||[]).length > 0}
          onCerrar={()=>setModalCargo(null)}
          onGuardado={async()=>{ setModalCargo(null); await cargar() }} />
      )}
      {modalVinc && (
        <ModalVincular emp={modalVinc} cargos={cargos} ocupantesDe={ocupantesDe} cu={cu}
          principalDe={principalDe} cargoPorId={cargoPorId} sucNombre={sucNombre} migrada={migrada}
          onCerrar={()=>setModalVinc(null)}
          onVinculado={async(cargoId)=>{ setModalVinc(null); await cargar(); setVista('arbol'); setSelId(cargoId) }} />
      )}
    </div>
  )
}

// ─── Panel: dotación por rol y sucursal ──────────────────────────────────────
function PanelDotacion({ cargando, migrada, cargos, met, emps, asigsDePersona, principalDe, cargoPorId, ocupantesDe,
                         roles, rolPorCod, sucs, sucNombre, jefaturaDe, wkRes, onIrACargo, onIrPendientes }) {
  const [filtro, setFiltro] = useState(null)           // { rol, suc } elegido en la matriz
  const [detalle, setDetalle] = useState('personas')   // personas | cargos

  // Una fila por persona activa, ubicada por su cargo principal
  const personas = useMemo(() => emps.map(e => {
    const pri = principalDe[e.cod_contaline]
    const c = pri ? cargoPorId[pri.cargo_id] : null
    const otros = (asigsDePersona[e.cod_contaline] || []).filter(a => a !== pri).map(a => cargoPorId[a.cargo_id]?.nombre).filter(Boolean)
    const jef = c ? jefaturaDe(c.id) : null
    const h = e.hoy
    const est = h?.estado_actual || 'activo'
    return {
      cod: e.cod_contaline, nombre: e.nombre, rut: e.rut || '',
      suc: c?.sucursal_id || e.sucursal_id || 'suc-admin',
      cargoId: c?.id ?? null, cargo: c?.nombre || '',
      rol: c ? (c.rol_codigo || '_sinrol') : '_sincargo',
      otros, jefatura: jef?.nombres || '', estado: est,
      novedad: est !== 'activo' && h?.novedad_desde ? `${fFecha(h.novedad_desde)} → ${fFecha(h.novedad_hasta)}${h.novedad_motivo ? ` · ${h.novedad_motivo}` : ''}` : '',
      workera: e.exento_asistencia ? 'Exento (Art. 22)' : !wkRes ? '' : wkRes.mapeados.has(e.cod_contaline) ? 'Vinculado' : 'Sin vínculo',
      ingreso: e.fecha_ingreso || '', contrato: e.cargo || '',
    }
  }), [emps, principalDe, cargoPorId, asigsDePersona, jefaturaDe, wkRes])

  // Celdas rol × sucursal: plazas y brechas desde v_org_dotacion; personas desde el maestro
  const celdas = useMemo(() => {
    const out = {}
    const add = (rol, suc, k, v) => { if (!v) return; const key = `${rol}|${suc}`; const o = out[key] || (out[key] = { ...VACIA }); o[k] += v }
    for (const m of met) {
      if (m.cuenta_dotacion === false) continue
      const rol = m.rol_codigo || '_sinrol', suc = m.sucursal_id || 'suc-admin'
      add(rol, suc, 'plazas', m.plazas_aprobadas || 0)
      add(rol, suc, 'propuestas', m.plazas_propuestas || 0)
      add(rol, suc, 'faltan', Math.max(m.brecha || 0, 0))
      add(rol, suc, 'sobran', Math.max(-(m.brecha || 0), 0))
      add(rol, suc, 'acum', m.n_secundarios || 0)
      add(rol, suc, 'sinFicha', m.n_manuales || 0)
    }
    for (const p of personas) {
      add(p.rol, p.suc, 'personas', 1)
      if (p.estado !== 'activo') add(p.rol, p.suc, 'ausentes', 1)
    }
    return out
  }, [met, personas])

  const cols = useMemo(() => {
    const usadas = new Set(Object.keys(celdas).map(k => k.split('|')[1]))
    const ord = id => id === 'suc-admin' ? -1 : id === 'suc-web' ? 100 : (sucs.find(s => s.id === id)?.orden ?? 50)
    return [...usadas].sort((a, b) => ord(a) - ord(b) || a.localeCompare(b))
  }, [celdas, sucs])

  const filas = useMemo(() => {
    const presentes = new Set(Object.keys(celdas).map(k => k.split('|')[0]))
    const grupos = ORDEN_FAMILIAS
      .map(f => ({ f, roles: roles.filter(r => r.familia === f && presentes.has(r.codigo)) }))
      .filter(g => g.roles.length)
    return { grupos, sinRol: presentes.has('_sinrol'), sinCargo: presentes.has('_sincargo') }
  }, [celdas, roles])

  const rolKeys = useMemo(() => [
    ...filas.grupos.flatMap(g => g.roles.map(r => r.codigo)),
    ...(filas.sinRol ? ['_sinrol'] : []), ...(filas.sinCargo ? ['_sincargo'] : []),
  ], [filas])
  const celda = (r, s) => celdas[`${r}|${s}`]
  const total = useMemo(() => sumar(Object.values(celdas)), [celdas])

  const resumen = useMemo(() => ({
    conCargo:   personas.filter(p => p.cargoId != null).length,
    sinCargo:   personas.filter(p => p.cargoId == null).length,
    conNovedad: personas.filter(p => p.estado !== 'activo').length,
    acumulan:   personas.filter(p => p.otros.length > 0).length,
    sinFicha:   met.reduce((s, m) => s + (m.n_manuales || 0), 0),
  }), [personas, met])

  const alertas = useMemo(() => {
    const out = []
    const nombresDe = id => (ocupantesDe[id] || []).map(nomOcupante).join(', ')
    if (resumen.sinCargo) out.push({ k:'pend', c:'#B42318', n:resumen.sinCargo, t:'Activos sin cargo en el organigrama',
      d:'Sin cargo no tienen jefatura: nadie valida sus horas extra ni los evalúa. Clic para vincularlos.', items:[] })
    if (wkRes?.sinFicha.length) out.push({ k:'wk1', c:'#B42318', t:'Marcan en Workera y no tienen ficha',
      d:'Trabajan pero no están en el maestro: no suman a la dotación ni se pueden ubicar en el organigrama.',
      items: wkRes.sinFicha.map(w => ({ id:null, l:w.nombre_completo, s:`${w.workera_branch_name || '—'} · ${String(w.workera_dept_name || '').replace(/^DEPARTAMENTO DE /i, '').toLowerCase()}` })) })
    const porCubrir = met.filter(m => m.cuenta_dotacion !== false && (m.brecha || 0) > 0).sort((a, b) => b.brecha - a.brecha || a.nombre.localeCompare(b.nombre))
    if (porCubrir.length) out.push({ k:'brecha', c:'#B42318', n: porCubrir.reduce((s, m) => s + m.brecha, 0), t:'Plazas aprobadas sin cubrir',
      d:'Cargos con menos personas que plazas aprobadas.',
      items: porCubrir.map(m => ({ id:m.cargo_id, l:m.nombre, s:`${sucNombre(m.sucursal_id)} · faltan ${m.brecha}` })) })
    const jefMulti = met.filter(m => m.es_jefatura && (m.n_titulares + m.n_manuales) > 1)
    if (jefMulti.length) out.push({ k:'jef', c:'#B25E09', t:'Jefaturas con más de un titular',
      d:'Dos titulares en una jefatura duplican el equipo que cada uno ve y valida y diluyen la responsabilidad. Si uno coordina, muévelo a su cargo.',
      items: jefMulti.map(m => ({ id:m.cargo_id, l:m.nombre, s:nombresDe(m.cargo_id) })) })
    const sucDist = cargos.filter(c => { const p = cargoPorId[c.cargo_padre_id]; return p && c.sucursal_id && p.sucursal_id && p.sucursal_id !== 'suc-admin' && p.sucursal_id !== c.sucursal_id })
    if (sucDist.length) out.push({ k:'suc', c:'#B25E09', t:'Cargo de otra sucursal que su jefatura',
      d:'Un cargo de una sucursal bajo la jefatura de otra descuadra la dotación por sucursal.',
      items: sucDist.map(c => { const p = cargoPorId[c.cargo_padre_id]; return { id:c.id, l:c.nombre, s:`${sucNombre(c.sucursal_id)}, bajo ${p.nombre} (${sucNombre(p.sucursal_id)})` } }) })
    const sobre = met.filter(m => m.cuenta_dotacion !== false && (m.brecha || 0) < 0)
    if (sobre.length) out.push({ k:'sobre', c:'#B25E09', t:'Cargos con más personas que plazas',
      d:'Ajusta las plazas aprobadas o reubica a quien sobra.',
      items: sobre.map(m => ({ id:m.cargo_id, l:m.nombre, s:`${m.ocupacion} personas · ${m.plazas_aprobadas} plazas` })) })
    if (wkRes?.sinVinculo.length) out.push({ k:'wk2', c:'#B25E09', t:'Fichas sin vínculo con Workera',
      d:'No se controla su asistencia ni sus horas extra. Se vinculan en Asistencia → Integración Workera.',
      items: wkRes.sinVinculo.map(e => ({ id: principalDe[e.cod_contaline]?.cargo_id ?? null, l:e.nombre, s:`${sucNombre(e.sucursal_id)}${e.cargo ? ` · ${e.cargo}` : ''}` })) })
    const acum = personas.filter(p => p.otros.length)
    if (acum.length) out.push({ k:'acum', c:'#175CD3', t:'Personas que acumulan cargos',
      d:'Cubren más de una plaza: es un punto de sobrecarga y, si se ausentan, quedan dos funciones sin cubrir.',
      items: acum.map(p => ({ id:p.cargoId, l:p.nombre, s:[p.cargo, ...p.otros].join(' + ') })) })
    const sinRol = cargos.filter(c => c.cuenta_dotacion !== false && !c.rol_codigo)
    if (sinRol.length) out.push({ k:'rol', c:'#6E6E73', t:'Cargos sin rol',
      d:'Sin rol el cargo no aparece por función en la matriz ni en la cobertura por turno.',
      items: sinRol.map(c => ({ id:c.id, l:c.nombre, s:sucNombre(c.sucursal_id) })) })
    return out
  }, [resumen, wkRes, met, cargos, cargoPorId, personas, ocupantesDe, principalDe, sucNombre])

  const rolLabel = k => k === '_sincargo' ? 'Sin cargo asignado' : k === '_sinrol' ? 'Cargos sin rol' : (rolPorCod[k]?.nombre || k)
  const elegir = (rol, suc) => {
    setFiltro(f => (f && f.rol === rol && f.suc === suc) ? null : { rol, suc })
    if (rol === '_sincargo') setDetalle('personas')
  }
  const personasFil = useMemo(() => !filtro ? personas
    : personas.filter(p => (filtro.rol == null || p.rol === filtro.rol) && (filtro.suc == null || p.suc === filtro.suc)), [personas, filtro])
  const cargosFil = useMemo(() => met.filter(m => m.cuenta_dotacion !== false)
    .filter(m => !filtro || ((filtro.rol == null || (m.rol_codigo || '_sinrol') === filtro.rol) && (filtro.suc == null || (m.sucursal_id || 'suc-admin') === filtro.suc))), [met, filtro])

  const colsPersonas = useMemo(() => [
    { key:'nombre', label:'Trabajador', width:230, render: p => <span><strong>{p.nombre}</strong> <span style={{color:'var(--text-muted)'}}>#{p.cod}</span></span> },
    { key:'suc', label:'Sucursal', width:110, value: p => sucNombre(p.suc) },
    { key:'cargo', label:'Cargo en organigrama', width:230, value: p => p.cargo || '— Sin cargo —',
      render: p => p.cargo ? p.cargo : <span style={{color:'#B42318',fontWeight:700}}>Sin cargo</span> },
    { key:'rol', label:'Rol', width:160, value: p => p.rol === '_sincargo' ? '' : rolLabel(p.rol) },
    { key:'otros', label:'Funciones acumuladas', width:200, value: p => p.otros.join(' · ') },
    { key:'jefatura', label:'Jefatura directa', width:200 },
    { key:'estado', label:'Estado hoy', width:130, value: p => estHoy(p.estado).l,
      render: p => <span style={{fontSize:11,fontWeight:700,color:estHoy(p.estado).c}}>{estHoy(p.estado).l}</span> },
    { key:'novedad', label:'Detalle de la novedad', width:190 },
    { key:'workera', label:'Workera', width:120,
      render: p => <span style={{color: p.workera === 'Sin vínculo' ? '#B25E09' : 'inherit', fontWeight: p.workera === 'Sin vínculo' ? 700 : 400}}>{p.workera || '—'}</span> },
    { key:'ingreso', label:'Ingreso', width:90, render: p => fFecha(p.ingreso) },
    { key:'contrato', label:'Cargo de contrato', width:200 },
  ], [sucNombre, rolPorCod]) // eslint-disable-line react-hooks/exhaustive-deps

  const colsCargos = useMemo(() => [
    { key:'nombre', label:'Cargo', width:240, render: m => <strong>{m.nombre}</strong> },
    { key:'sucursal_id', label:'Sucursal', width:110, value: m => sucNombre(m.sucursal_id) },
    { key:'rol_nombre', label:'Rol', width:170, value: m => m.rol_nombre || 'Sin rol' },
    { key:'area', label:'Área', width:110, value: m => m.area || '' },
    { key:'estado', label:'Estado', width:90, value: m => ESTADOS[m.estado]?.l || m.estado },
    { key:'plazas_aprobadas', label:'Plazas', width:70, align:'right', value: m => m.plazas_aprobadas || m.plazas_propuestas || 0,
      render: m => m.plazas_aprobadas ? m.plazas_aprobadas : <span style={{color:'var(--text-muted)'}}>{m.plazas_propuestas} prop.</span> },
    { key:'n_titulares', label:'Titulares', width:80, align:'right' },
    { key:'n_secundarios', label:'Acumulan', width:80, align:'right' },
    { key:'n_manuales', label:'Sin ficha', width:75, align:'right' },
    { key:'con_novedad_hoy', label:'Novedad hoy', width:90, align:'right' },
    { key:'brecha', label:'Brecha', width:75, align:'right',
      render: m => <span style={{fontWeight:700,color:m.brecha > 0 ? '#B42318' : m.brecha < 0 ? '#B25E09' : 'var(--text-muted)'}}>{m.brecha > 0 ? `−${m.brecha}` : m.brecha < 0 ? `+${-m.brecha}` : '0'}</span> },
    { key:'ocupantes', label:'Ocupantes', width:260, value: m => (ocupantesDe[m.cargo_id] || []).map(nomOcupante).join(', ') },
    { key:'ruta', label:'Ruta jerárquica', width:340 },
  ], [sucNombre, ocupantesDe])

  if (cargando) return <div style={{padding:60,textAlign:'center',color:'var(--text-muted)'}}>Cargando dotación...</div>
  if (!migrada) return (
    <div style={{...card,maxWidth:560,margin:'40px auto',padding:'26px 28px',textAlign:'center'}}>
      <h3 style={{margin:'0 0 6px'}}>Dotación no disponible</h3>
      <p style={{color:'var(--text-muted)',fontSize:13,margin:0,lineHeight:1.5}}>Para ver plazas, brechas y dotación por rol hay que aplicar la migración de dotación del organigrama (roles, plazas y cargo principal).</p>
    </div>
  )

  const filtroTxt = filtro ? `${filtro.rol ? rolLabel(filtro.rol) : 'Todos los roles'} · ${filtro.suc ? sucNombre(filtro.suc) : 'todas las sucursales'}` : null

  return (
    <div style={{display:'grid',gap:12}}>
      <div className="oc-kpis">
        <Kpi l="Plazas aprobadas" v={total.plazas}/>
        <Kpi l="Personas con cargo" v={resumen.conCargo} sub={`de ${emps.length} activas en el maestro`}/>
        <Kpi l="Plazas por cubrir" v={total.faltan} c={total.faltan ? '#B42318' : undefined}/>
        <Kpi l="Con novedad hoy" v={resumen.conNovedad} c={resumen.conNovedad ? '#175CD3' : undefined} sub="licencia, vacaciones o permiso"/>
        <Kpi l="Acumulan cargos" v={resumen.acumulan} c={resumen.acumulan ? '#B25E09' : undefined} sub="cubren más de una plaza"/>
        <Kpi l="Plazas propuestas" v={total.propuestas} sub="aún no aprobadas"/>
      </div>

      <div style={{...card,padding:'9px 14px',display:'flex',flexWrap:'wrap',gap:'4px 18px',alignItems:'baseline',fontSize:12.5}}>
        <strong>Cuadratura</strong>
        <span>Maestro activo <strong>{emps.length}</strong> = <strong>{resumen.conCargo}</strong> con cargo + <strong style={{color:resumen.sinCargo?'#B42318':undefined}}>{resumen.sinCargo}</strong> sin cargo</span>
        {wkRes && <span>Workera: <strong style={{color:wkRes.sinFicha.length?'#B42318':undefined}}>{wkRes.sinFicha.length}</strong> marcan sin ficha · <strong style={{color:wkRes.sinVinculo.length?'#B25E09':undefined}}>{wkRes.sinVinculo.length}</strong> fichas sin vínculo</span>}
        {resumen.sinFicha > 0 && <span><strong>{resumen.sinFicha}</strong> ocupante(s) sin ficha (externos o socios)</span>}
      </div>

      <div className="oc-dot-grid">
        <div style={{...card,padding:0,overflow:'hidden'}}>
          <div style={cardHead}>
            <span style={{fontSize:13,fontWeight:700}}>Dotación por rol y sucursal</span>
            <span style={{fontSize:11,color:'var(--text-muted)'}}>personas con cargo principal / plazas aprobadas · clic para ver el detalle</span>
          </div>
          <div style={{overflowX:'auto'}}>
            <table className="oc-mx">
              <thead>
                <tr>
                  <th className="rol">Rol</th>
                  {cols.map(s => <th key={s} className="clic" onClick={()=>elegir(null, s)} title={`Ver ${sucNombre(s)}`}>{sucNombre(s)}</th>)}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {filas.grupos.map(g => (
                  <Fragment key={g.f}>
                    <tr><td colSpan={cols.length + 2} className="rol" style={{fontSize:10.5,fontWeight:800,color:FAMILIAS[g.f]?.c,background:'var(--bg-app)',padding:'4px 8px'}}>{FAMILIAS[g.f]?.l}</td></tr>
                    {g.roles.map(r => (
                      <FilaMx key={r.codigo} etiqueta={r.nombre} rol={r.codigo} cols={cols} celda={celda} filtro={filtro} onElegir={elegir}/>
                    ))}
                  </Fragment>
                ))}
                {filas.sinRol && <FilaMx etiqueta="Cargos sin rol" rol="_sinrol" cols={cols} celda={celda} filtro={filtro} onElegir={elegir}/>}
                {filas.sinCargo && <FilaMx etiqueta="Sin cargo asignado" rol="_sincargo" cols={cols} celda={celda} filtro={filtro} onElegir={elegir} alerta/>}
                <tr className="total">
                  <td className="rol">Total</td>
                  {cols.map(s => <Celda key={s} v={sumar(rolKeys.map(r => celda(r, s)))} on={filtro && filtro.rol == null && filtro.suc === s} onClick={()=>elegir(null, s)}/>)}
                  <Celda v={total} on={false} onClick={()=>setFiltro(null)}/>
                </tr>
                {total.propuestas > 0 && (
                  <tr>
                    <td className="rol" style={{color:'var(--text-muted)',fontSize:11}}>Propuestas sin aprobar</td>
                    {cols.map(s => { const v = sumar(rolKeys.map(r => celda(r, s))).propuestas; return <td key={s} style={{color:'var(--text-muted)',fontSize:11}}>{v || '·'}</td> })}
                    <td style={{color:'var(--text-muted)',fontSize:11,fontWeight:700}}>{total.propuestas}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{padding:'7px 12px',fontSize:10.5,color:'var(--text-muted)',borderTop:'1px solid var(--border)',lineHeight:1.5}}>
            <strong style={{color:'#B42318'}}>faltan</strong> = plazas aprobadas sin cubrir · <strong>acum.</strong> = plaza cubierta por alguien cuyo cargo principal es otro · <strong>s/ficha</strong> = ocupante externo o sin ficha · <strong style={{color:'#175CD3'}}>nov.</strong> = con licencia, vacaciones o permiso hoy
          </div>
        </div>
        <Alertas alertas={alertas} onIrACargo={onIrACargo} onIrPendientes={onIrPendientes}/>
      </div>

      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        <div role="tablist" style={{display:'flex',gap:2,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,padding:3}}>
          <button role="tab" aria-selected={detalle==='personas'} onClick={()=>setDetalle('personas')} style={{...tabBtn, ...(detalle==='personas'?tabBtnOn:{})}}>Personas ({personasFil.length})</button>
          <button role="tab" aria-selected={detalle==='cargos'} onClick={()=>setDetalle('cargos')} style={{...tabBtn, ...(detalle==='cargos'?tabBtnOn:{})}}>Cargos ({cargosFil.length})</button>
        </div>
        {filtroTxt && <span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600,padding:'4px 6px 4px 10px',borderRadius:100,background:'var(--bg-surface)',border:'1px solid var(--accent)'}}>
          {filtroTxt}<button onClick={()=>setFiltro(null)} aria-label="Quitar filtro" style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:12}}>✕</button></span>}
        <span style={{fontSize:11,color:'var(--text-muted)'}}>Clic en una fila para ir al cargo en el organigrama.</span>
      </div>
      <div style={{height:'min(620px, 75vh)'}}>
        {detalle === 'personas'
          ? <DataGrid columns={colsPersonas} rows={personasFil} getRowId={p => p.cod} onRowClick={p => p.cargoId != null && onIrACargo(p.cargoId)}
              title="Dotación por persona" exportName="dotacion_personas" emptyText="Sin personas en este filtro"/>
          : <DataGrid columns={colsCargos} rows={cargosFil} getRowId={m => m.cargo_id} onRowClick={m => onIrACargo(m.cargo_id)}
              title="Dotación por cargo" exportName="dotacion_cargos" emptyText="Sin cargos en este filtro"/>}
      </div>
    </div>
  )
}

function FilaMx({ etiqueta, rol, cols, celda, filtro, onElegir, alerta }) {
  const tot = sumar(cols.map(s => celda(rol, s)))
  return (
    <tr>
      <td className="rol clic" onClick={()=>onElegir(rol, null)} style={{color: alerta ? '#B42318' : undefined, fontWeight: alerta ? 700 : 500}}>{etiqueta}</td>
      {cols.map(s => <Celda key={s} v={celda(rol, s)} on={filtro?.rol === rol && filtro?.suc === s} onClick={()=>onElegir(rol, s)}/>)}
      <Celda v={tot} on={filtro?.rol === rol && filtro?.suc == null} onClick={()=>onElegir(rol, null)} negrita/>
    </tr>
  )
}

function Celda({ v, on, onClick, negrita }) {
  const vacia = !v || (!v.plazas && !v.personas && !v.acum && !v.sinFicha)
  const marca = on ? { boxShadow:'inset 0 0 0 2px var(--accent)', background:'var(--bg-app)' } : null
  if (vacia) return <td className="clic" onClick={onClick} style={{color:'var(--border)',...marca}}>·</td>
  const falta = v.faltan > 0
  const titulo = [`${v.personas} persona(s) con cargo principal aquí`, v.plazas ? `${v.plazas} plaza(s) aprobada(s)` : null,
    falta ? `faltan ${v.faltan}` : null, v.sobran ? `${v.sobran} sobre plazas` : null, v.acum ? `${v.acum} cubierta(s) con función acumulada` : null,
    v.sinFicha ? `${v.sinFicha} sin ficha` : null, v.ausentes ? `${v.ausentes} con novedad hoy` : null].filter(Boolean).join(' · ')
  return (
    <td className="clic" onClick={onClick} title={titulo} style={{minWidth:74,...marca}}>
      <div style={{fontSize:13,fontWeight:negrita?800:700,color:falta?'#B42318':'var(--text)'}}>
        {v.personas}{v.plazas ? <span style={{color:'var(--text-muted)',fontWeight:500}}>/{v.plazas}</span> : null}
      </div>
      {(falta || v.acum || v.sinFicha || v.ausentes || v.sobran) ? (
        <div style={{fontSize:9.5,display:'flex',gap:4,justifyContent:'center',flexWrap:'wrap',lineHeight:1.3}}>
          {falta && <span style={{color:'#B42318',fontWeight:700}}>faltan {v.faltan}</span>}
          {v.sobran > 0 && <span style={{color:'#B25E09',fontWeight:700}}>+{v.sobran}</span>}
          {v.acum > 0 && <span style={{color:'var(--text-muted)'}}>+{v.acum} acum.</span>}
          {v.sinFicha > 0 && <span style={{color:'var(--text-muted)'}}>+{v.sinFicha} s/ficha</span>}
          {v.ausentes > 0 && <span style={{color:'#175CD3',fontWeight:700}}>{v.ausentes} nov.</span>}
        </div>
      ) : null}
    </td>
  )
}

function Alertas({ alertas, onIrACargo, onIrPendientes }) {
  const [abierta, setAbierta] = useState(null)
  if (!alertas.length) return (
    <div style={{...card,padding:'14px 16px',fontSize:12.5,color:'var(--text-muted)'}}>Sin alertas de estructura.</div>
  )
  return (
    <div style={{...card,padding:0,overflow:'hidden'}}>
      <div style={cardHead}><span style={{fontSize:13,fontWeight:700}}>Alertas de estructura</span></div>
      {alertas.map(a => {
        const open = abierta === a.k
        const n = a.n ?? a.items.length
        return (
          <div key={a.k} style={{borderTop:'1px solid var(--border)'}}>
            <button onClick={()=> a.k === 'pend' ? onIrPendientes() : setAbierta(open ? null : a.k)} aria-expanded={a.k === 'pend' ? undefined : open}
              style={{display:'flex',gap:10,alignItems:'stretch',width:'100%',padding:'9px 12px',background:'none',border:'none',cursor:'pointer',textAlign:'left',color:'var(--text)'}}>
              <span style={{width:4,borderRadius:4,background:a.c,flexShrink:0}}/>
              <span style={{flex:1,minWidth:0}}>
                <span style={{display:'block',fontSize:12.5,fontWeight:700}}>{a.t}</span>
                <span style={{display:'block',fontSize:11,color:'var(--text-muted)',lineHeight:1.4,marginTop:2}}>{a.d}</span>
              </span>
              <span style={{fontSize:13,fontWeight:800,color:a.c,fontVariantNumeric:'tabular-nums'}}>{n}</span>
            </button>
            {open && (
              <div style={{padding:'0 12px 10px 26px',display:'grid',gap:1,maxHeight:260,overflowY:'auto'}}>
                {a.items.map((it, i) => (
                  <button key={i} disabled={it.id == null} onClick={()=> it.id != null && onIrACargo(it.id)}
                    style={{textAlign:'left',fontSize:11.5,padding:'4px 6px',borderRadius:6,border:'none',background:'none',
                      cursor: it.id != null ? 'pointer' : 'default',color:'var(--text)'}}>
                    <span style={{fontWeight:600}}>{it.l}</span><span style={{color:'var(--text-muted)'}}> · {it.s}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Kpi({ l, v, sub, c }) {
  return (
    <div style={{...card,padding:'9px 12px'}}>
      <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)'}}>{l}</div>
      <div style={{fontSize:21,fontWeight:800,lineHeight:1.2,color:c || 'var(--text)',fontVariantNumeric:'tabular-nums'}}>{v}</div>
      {sub && <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{sub}</div>}
    </div>
  )
}

// ─── Panel: empleados sin cargo + cuadratura con Workera ─────────────────────
function PanelPendientes({ pendientes, busq, totalEmps, cargos, metPorId, rolPorCod, sucNombre, cargoAnteriorDe,
                           puedeEditar, wkRes, onElegir, onVincularA, onCrearCargo }) {
  const [trab, setTrab] = useState(null)
  const q = norm(busq.trim())
  const lista = useMemo(() => {
    const f = q ? pendientes.filter(e => norm(`${e.nombre} ${e.rut||''} ${e.cargo||''} ${sucNombre(e.sucursal_id)}`).includes(q)) : pendientes
    return [...f].sort((a,b) => sucNombre(a.sucursal_id).localeCompare(sucNombre(b.sucursal_id)) || a.nombre.localeCompare(b.nombre))
  }, [pendientes, q, sucNombre])
  const sug = useMemo(() => Object.fromEntries(lista.map(e =>
    [e.cod_contaline, sugerirCargo(e, cargos, metPorId, rolPorCod, cargoAnteriorDe[e.cod_contaline])])), [lista, cargos, metPorId, rolPorCod, cargoAnteriorDe])

  async function vincular(e, cargo) { setTrab(e.cod_contaline); try { await onVincularA(e, cargo) } finally { setTrab(null) } }

  return (
    <div style={{display:'grid',gap:14}}>
      {pendientes.length === 0 ? (
        <div style={{maxWidth:480,margin:'40px auto 0',textAlign:'center',...card,padding:'34px 28px'}}>
          <div style={{fontSize:40,marginBottom:10}}>✅</div>
          <h3 style={{margin:'0 0 6px 0'}}>Todos tienen cargo</h3>
          <p style={{color:'var(--text-muted)',fontSize:13,margin:0}}>Los {totalEmps} empleados activos tienen al menos un cargo en el organigrama.</p>
        </div>
      ) : (
        <div style={{...card,overflow:'hidden',padding:0}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border)',fontSize:12.5,color:'var(--text-muted)'}}>
            <strong style={{color:'var(--text)'}}>{lista.length}</strong>{q?` de ${pendientes.length}`:''} empleado(s) activo(s) sin cargo en el organigrama.
            Sin cargo no tienen jefatura: nadie valida sus horas extra ni los evalúa. La sugerencia usa su cargo anterior o su cargo de contrato y su sucursal.
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
              <thead>
                <tr style={{borderBottom:'1px solid var(--border)'}}>
                  {['Empleado','Sucursal','Cargo de contrato','Ingreso','Sugerencia',''].map(h=>(
                    <th key={h} style={thP}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map(e => {
                  const s = sug[e.cod_contaline]
                  const libre = s && s.cargo && (metPorId[s.cargo.id]?.brecha || 0) > 0
                  return (
                    <tr key={e.cod_contaline} style={{borderBottom:'1px solid var(--border)'}}>
                      <td style={{...tdP,whiteSpace:'nowrap'}}>
                        <span style={{display:'inline-flex',alignItems:'center',gap:8}}>
                          <span style={{width:24,height:24,borderRadius:100,background:avColor(e.cod_contaline),color:'white',
                            fontSize:9,fontWeight:800,display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{iniciales(e.nombre)}</span>
                          <span><span style={{fontWeight:600}}>{e.nombre}</span><span style={{display:'block',fontSize:10.5,color:'var(--text-muted)'}}>{e.rut || '—'} · #{e.cod_contaline}</span></span>
                        </span>
                      </td>
                      <td style={{...tdP,whiteSpace:'nowrap'}}>{sucNombre(e.sucursal_id)}</td>
                      <td style={{...tdP,color:'var(--text-muted)'}}>{e.cargo||'—'}</td>
                      <td style={{...tdP,color:'var(--text-muted)',whiteSpace:'nowrap'}}>{fFecha(e.fecha_ingreso)}</td>
                      <td style={{...tdP,minWidth:220}}>
                        {!s ? <span style={{color:'var(--text-muted)'}}>Sin sugerencia: elige el cargo a mano</span>
                         : s.tipo === 'anterior' ? <span>Su cargo anterior: <strong>{s.cargo.nombre}</strong></span>
                         : s.tipo === 'rol' ? <span><strong>{s.cargo.nombre}</strong>{libre && <span style={{marginLeft:6,fontSize:10.5,fontWeight:700,color:'#1E7A44'}}>plaza libre</span>}</span>
                         : <span style={{color:'#B25E09'}}>No existe un cargo de {s.rol.nombre.toLowerCase()} en {sucNombre(e.sucursal_id)}{s.padre ? `; iría bajo ${s.padre.nombre}` : ''}.</span>}
                      </td>
                      <td style={{...tdP,textAlign:'right',whiteSpace:'nowrap'}}>
                        {puedeEditar && s && s.tipo !== 'crear' && <button onClick={()=>vincular(e, s.cargo)} disabled={trab===e.cod_contaline}
                          style={{...btnPri,padding:'5px 11px',fontSize:12,marginRight:6}}>{trab===e.cod_contaline ? 'Vinculando…' : 'Vincular aquí'}</button>}
                        {puedeEditar && s?.tipo === 'crear' && <button onClick={()=>onCrearCargo(e, s)} style={{...btnSec,padding:'5px 11px',fontSize:12,marginRight:6}}>Crear el cargo</button>}
                        {puedeEditar && <button onClick={()=>onElegir(e)} style={{...btnSec,padding:'5px 11px',fontSize:12}}>Elegir cargo</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {wkRes && wkRes.sinFicha.length > 0 && (
        <div style={{...card,overflow:'hidden',padding:0}}>
          <div style={{padding:'11px 16px',borderBottom:'1px solid var(--border)',fontSize:12.5}}>
            <strong style={{color:'#B42318'}}>{wkRes.sinFicha.length}</strong> persona(s) activas en Workera sin ficha en el maestro.
            <span style={{color:'var(--text-muted)'}}> Trabajan pero no suman a la dotación; para darles cargo primero deben ingresar al maestro de empleados.</span>
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
            <thead><tr style={{borderBottom:'1px solid var(--border)'}}>{['Nombre en Workera','Sucursal en Workera','Departamento'].map(h=><th key={h} style={thP}>{h}</th>)}</tr></thead>
            <tbody>{wkRes.sinFicha.map(w => (
              <tr key={w.workera_code} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{...tdP,fontWeight:600}}>{w.nombre_completo}</td>
                <td style={tdP}>{w.workera_branch_name || '—'}</td>
                <td style={{...tdP,color:'var(--text-muted)'}}>{String(w.workera_dept_name || '').replace(/^DEPARTAMENTO DE /i, '').toLowerCase() || '—'}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      {wkRes && wkRes.sinVinculo.length > 0 && (
        <div style={{...card,overflow:'hidden',padding:0}}>
          <div style={{padding:'11px 16px',borderBottom:'1px solid var(--border)',fontSize:12.5}}>
            <strong style={{color:'#B25E09'}}>{wkRes.sinVinculo.length}</strong> ficha(s) activa(s) sin vínculo con Workera (no exentas).
            <span style={{color:'var(--text-muted)'}}> No se controla su asistencia ni sus horas extra. Se vinculan en Asistencia → Integración Workera.</span>
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
            <thead><tr style={{borderBottom:'1px solid var(--border)'}}>{['Trabajador','Sucursal','Cargo de contrato','Ingreso'].map(h=><th key={h} style={thP}>{h}</th>)}</tr></thead>
            <tbody>{wkRes.sinVinculo.map(e => (
              <tr key={e.cod_contaline} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{...tdP,fontWeight:600}}>{e.nombre}</td>
                <td style={tdP}>{sucNombre(e.sucursal_id)}</td>
                <td style={{...tdP,color:'var(--text-muted)'}}>{e.cargo || '—'}</td>
                <td style={{...tdP,color:'var(--text-muted)'}}>{fFecha(e.fecha_ingreso)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Modal: vincular empleado a un cargo ──────────────────────────────────────
function ModalVincular({ emp, cargos, ocupantesDe, cu, principalDe, cargoPorId, sucNombre, migrada, onCerrar, onVinculado }) {
  const [busq, setBusq] = useState('')
  const [trabajando, setTrab] = useState(false)
  const [err, setErr] = useState(null)
  const pri = principalDe[emp.cod_contaline]
  const cargoPri = pri ? cargoPorId[pri.cargo_id] : null

  const lista = useMemo(() => {
    const q = norm(busq.trim())
    let l = cargos.filter(c => c.cuenta_dotacion !== false)
    if (q) l = l.filter(c => norm(`${c.nombre} ${c.area||''} ${sucNombre(c.sucursal_id)}`).includes(q))
    // Prioriza: misma sucursal del empleado primero, luego vacantes
    return [...l].sort((a,b) =>
      ((b.sucursal_id===emp.sucursal_id)?1:0) - ((a.sucursal_id===emp.sucursal_id)?1:0) ||
      ((a.estado==='vacante')?-1:0) - ((b.estado==='vacante')?-1:0) ||
      a.nombre.localeCompare(b.nombre)
    ).slice(0, 12)
  }, [busq, cargos, emp, sucNombre])

  async function vincular(cargo) {
    setTrab(true); setErr(null)
    try {
      const { error } = await supabase.from('org_asignaciones').insert({
        cargo_id: cargo.id, cod_contaline: emp.cod_contaline, asignado_por: cu.id
      })
      if (error) throw error
      if (!migrada && cargo.estado !== 'ocupado') {
        await supabase.from('org_cargos').update({ estado:'ocupado', updated_at:new Date().toISOString() }).eq('id', cargo.id)
      }
      await onVinculado(cargo.id)
    } catch(e) { setErr(e.message); setTrab(false) }
  }

  return (
    <div onClick={onCerrar} style={overlay}>
      <div onClick={e=>e.stopPropagation()} role="dialog" aria-label="Vincular al organigrama" style={{...modalBox,maxWidth:470}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:2}}>Vincular al organigrama</div>
        <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:cargoPri?6:14}}>
          {emp.nombre} {emp.sucursal_id?`· ${sucNombre(emp.sucursal_id)}`:''} {emp.cargo?`· ${emp.cargo}`:''}
        </div>
        {cargoPri && <div style={{fontSize:11.5,color:'#B25E09',marginBottom:12}}>Su cargo principal es "{cargoPri.nombre}": el nuevo queda como función acumulada.</div>}
        <input autoFocus value={busq} onChange={e=>setBusq(e.target.value)}
          placeholder="Buscar cargo..." aria-label="Buscar cargo" style={{...inpFull,marginBottom:10}}/>
        <div style={{display:'flex',flexDirection:'column',gap:5}}>
          {lista.map(c => {
            const est = ESTADOS[c.estado] || ESTADOS.vacante
            const nOcup = (ocupantesDe[c.id]||[]).length
            return (
              <button key={c.id} onClick={()=>vincular(c)} disabled={trabajando}
                style={{display:'flex',alignItems:'center',gap:9,padding:'8px 11px',background:'var(--bg-app)',
                  border:'1px solid var(--border)',borderRadius:9,cursor:'pointer',textAlign:'left'}}>
                <span style={{width:8,height:8,borderRadius:100,flexShrink:0,
                  background: c.estado==='por_crear' ? 'transparent' : est.c,
                  border: c.estado==='por_crear' ? `1.5px dashed ${est.c}` : 'none'}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12.5,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.nombre}</div>
                  <div style={{fontSize:10.5,color:'var(--text-muted)'}}>
                    {c.area||''} {c.sucursal_id?`· ${sucNombre(c.sucursal_id)}`:''} {nOcup>0?`· ${nOcup} ocupante(s)`:''}
                  </div>
                </div>
                <span style={{fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:100,background:`${est.c}18`,color:est.c,flexShrink:0}}>{est.l}</span>
              </button>
            )
          })}
          {lista.length === 0 && <div style={{fontSize:12,color:'var(--text-muted)',padding:8}}>Sin cargos que coincidan</div>}
        </div>
        {err && <div style={{fontSize:12,color:'#FF3B30',marginTop:10}}>⚠️ {err}</div>}
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:14}}>
          <button onClick={onCerrar} style={btnSec}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

// ─── Nodo del lienzo (recursivo) ──────────────────────────────────────────────
function Nodo({ cargo, hijosDe, ocupantesDe, metPorId, rolPorCod, sucNombre, filtroSuc, estaColapsado, onToggle, selId, hits, onSel }) {
  const hijos = (hijosDe[cargo.id] || []).filter(h => !filtroSuc || filtroSuc.visibles.has(h.id))
  const ocup  = ocupantesDe[cargo.id] || []
  const est   = ESTADOS[cargo.estado] || ESTADOS.vacante
  const m     = metPorId[cargo.id]
  const rol   = rolPorCod[cargo.rol_codigo]
  const organo = cargo.cuenta_dotacion === false
  const pill  = m && !organo ? pillDotacion(m) : null
  const colapsado = estaColapsado(cargo.id)
  const clases = ['oc-card',
    selId === cargo.id ? 'sel' : '',
    hits.has(cargo.id) ? 'hit' : '',
    cargo.estado === 'por_crear' ? 'punteado' : '',
    filtroSuc?.contexto.has(cargo.id) ? 'contexto' : '',
  ].filter(Boolean).join(' ')
  const badge = organo ? { l: rol?.familia === 'externo' ? 'Externo' : 'Órgano', c:'#8E8E93' } : est

  return (
    <div className="oc-nodo">
      <div data-card className={clases} onClick={()=>onSel(cargo.id)} role="button" tabIndex={0}
        aria-label={`${cargo.nombre}${pill ? `, ${pill.t} plazas` : ''}`}
        onKeyDown={e=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); onSel(cargo.id) } }}>
        <span className="oc-spine" style={{background: cargo.estado==='por_crear' ? 'transparent' : badge.c,
          border: cargo.estado==='por_crear' ? `1.5px dashed ${badge.c}` : 'none'}}/>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:6}}>
          <div style={{fontSize:12.5,fontWeight:700,lineHeight:1.25}}>{cargo.nombre}</div>
          <span style={{fontSize:9,fontWeight:800,padding:'2px 7px',borderRadius:100,whiteSpace:'nowrap',
            background:`${badge.c}18`,color:badge.c,flexShrink:0}}>{badge.l}</span>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center',marginTop:4,fontSize:10,color:'var(--text-muted)',minWidth:0}}>
          {rol ? <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{rol.nombre}</span>
               : cargo.area && <span>{cargo.area}</span>}
          {cargo.sucursal_id && <span style={{fontWeight:700,color:'var(--accent)',whiteSpace:'nowrap'}}>{sucNombre(cargo.sucursal_id)}</span>}
        </div>
        <div style={{display:'flex',alignItems:'center',marginTop:7,minHeight:22,gap:4}}>
          {ocup.length > 0 ? (
            <>
              <div style={{display:'flex'}}>
                {ocup.slice(0,4).map((o,i)=>(
                  <span key={o.id} title={nomOcupante(o)} style={{
                    width:22,height:22,borderRadius:100,background:avColor(avKey(o)),color:'white',
                    fontSize:8.5,fontWeight:800,display:'inline-flex',alignItems:'center',justifyContent:'center',
                    border:'2px solid var(--bg-surface)',marginLeft:i===0?0:-7,opacity:o.es_principal===false?0.6:1}}>
                    {iniciales(nomOcupante(o))}
                  </span>
                ))}
              </div>
              <span style={{fontSize:10.5,color:'var(--text)',marginLeft:2,fontWeight:600,
                whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:112}}>
                {ocup.length===1 ? nomOcupante(ocup[0]).split(' ').slice(0,2).join(' ') : `${ocup.length} personas`}
              </span>
            </>
          ) : (
            <span style={{fontSize:10.5,color:'var(--text-muted)',fontStyle:'italic'}}>Sin ocupante</span>
          )}
          {pill && <span className="oc-pill" title={pill.title} style={{background:`${pill.c}16`,color:pill.c}}>{pill.t}</span>}
        </div>
        {m?.con_novedad_hoy > 0 && <div style={{marginTop:4,fontSize:10,fontWeight:700,color:'#175CD3'}}>{m.con_novedad_hoy} con novedad hoy</div>}
      </div>

      {hijos.length > 0 && (
        <>
          <div className="oc-stub"/>
          <button className="oc-colapsar" onClick={e=>{e.stopPropagation(); onToggle(cargo.id)}} aria-expanded={!colapsado}
            aria-label={colapsado ? `Mostrar ${hijos.length} cargos dependientes` : 'Ocultar cargos dependientes'}>
            {colapsado ? `▸ ${hijos.length}` : '▾'}
          </button>
          {!colapsado && (
            <div className="oc-hijos">
              {hijos.map(h => (
                <div key={h.id} className="oc-rama">
                  <Nodo cargo={h} hijosDe={hijosDe} ocupantesDe={ocupantesDe} metPorId={metPorId} rolPorCod={rolPorCod}
                    sucNombre={sucNombre} filtroSuc={filtroSuc}
                    estaColapsado={estaColapsado} onToggle={onToggle}
                    selId={selId} hits={hits} onSel={onSel}/>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Ficha lateral de cargo ───────────────────────────────────────────────────
function FichaCargo({ cargo, cu, m, rol, ocupantes, hijos, padre, jefatura, emps, cargosDePersona, principalDe, cargoPorId, sucNombre,
                      puedeEditar, migrada, onCerrar, onEditar, onNuevoHijo, onDesactivar, onCambiarEstado, onGuardarPlazas,
                      onMarcarPrincipal, onCambio, onIrACargo }) {
  const est = ESTADOS[cargo.estado] || ESTADOS.vacante
  const organo = cargo.cuenta_dotacion === false
  const [busq, setBusq] = useState('')
  const [trabajando, setTrab] = useState(false)
  const [err, setErr] = useState(null)
  const [perfilAbierto, setPerfil] = useState(null)
  const [plazas, setPlazas] = useState(cargo.plazas ?? '')
  const claveOc = o => o.cod_contaline ?? `m-${o.id}`

  useEffect(() => { setBusq(''); setErr(null); setPerfil(ocupantes.length===1 ? claveOc(ocupantes[0]) : null) }, [cargo.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPlazas(cargo.plazas ?? '') }, [cargo.id, cargo.plazas])

  const yaAsig = useMemo(() => new Set(ocupantes.map(o=>o.cod_contaline)), [ocupantes])
  const candidatos = useMemo(() => {
    const q = norm(busq.trim())
    if (!q) return []
    return emps.filter(e => !yaAsig.has(e.cod_contaline))
      .filter(e => norm(e.nombre).includes(q) || String(e.rut||'').includes(busq.trim()))
      .slice(0, 6)
  }, [busq, emps, yaAsig])

  const ahora = () => new Date().toISOString()
  async function agregar(emp) {
    setTrab(true); setErr(null)
    try {
      const { error } = await supabase.from('org_asignaciones').insert({
        cargo_id: cargo.id, cod_contaline: emp.cod_contaline, asignado_por: cu.id
      })
      if (error) throw error
      if (!migrada && cargo.estado !== 'ocupado') await supabase.from('org_cargos').update({ estado:'ocupado', updated_at:ahora() }).eq('id', cargo.id)
      await onCambio()
      setBusq('')
    } catch(e) { setErr(e.message) }
    finally { setTrab(false) }
  }

  async function agregarManual(nombre) {
    if (!nombre) return
    setTrab(true); setErr(null)
    try {
      const { error } = await supabase.from('org_asignaciones').insert({
        cargo_id: cargo.id, cod_contaline: null, nombre_manual: nombre, asignado_por: cu.id
      })
      if (error) throw error
      if (!migrada && cargo.estado !== 'ocupado') await supabase.from('org_cargos').update({ estado:'ocupado', updated_at:ahora() }).eq('id', cargo.id)
      await onCambio()
      setBusq('')
    } catch(e) { setErr(e.message) }
    finally { setTrab(false) }
  }

  async function quitar(asig) {
    setTrab(true); setErr(null)
    try {
      const { error } = await supabase.from('org_asignaciones')
        .update({ activo:false, hasta:new Date().toISOString().slice(0,10) }).eq('id', asig.id)
      if (error) throw error
      if (!migrada && ocupantes.length === 1 && cargo.estado === 'ocupado') await supabase.from('org_cargos').update({ estado:'vacante', updated_at:ahora() }).eq('id', cargo.id)
      await onCambio()
    } catch(e) { setErr(e.message) }
    finally { setTrab(false) }
  }

  async function hacerPrincipal(asig) {
    setTrab(true); setErr(null)
    try { await onMarcarPrincipal(asig) } catch(e) { setErr(e.message) } finally { setTrab(false) }
  }

  const nPlazas = plazas === '' ? null : Math.max(0, Math.round(Number(plazas)))
  const plazasCambiadas = nPlazas !== null && !Number.isNaN(nPlazas) && nPlazas !== (cargo.plazas ?? null)
  async function guardarPlazas() {
    setTrab(true); setErr(null)
    try { await onGuardarPlazas(nPlazas) } catch(e) { setErr(e.message) } finally { setTrab(false) }
  }

  const colorCab = organo ? '#8E8E93' : est.c

  return (
    <div className="oc-drawer" role="dialog" aria-label={`Ficha del cargo ${cargo.nombre}`}>
      {/* Encabezado */}
      <div style={{padding:'16px 18px 14px',borderBottom:'1px solid var(--border)',
        background:`linear-gradient(135deg, ${colorCab}14, transparent 60%)`}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:16,fontWeight:800,lineHeight:1.25}}>{cargo.nombre}</div>
            <div style={{fontSize:11.5,color:'var(--text-muted)',marginTop:3,lineHeight:1.5}}>
              {rol ? <strong style={{color:FAMILIAS[rol.familia]?.c}}>{rol.nombre}</strong>
                   : migrada ? <strong style={{color:'#B25E09'}}>Sin rol</strong> : null}
              {cargo.area && <>{(rol || migrada) ? ' · ' : ''}{cargo.area}</>}
              {cargo.sucursal_id && <> · <strong style={{color:'var(--accent)'}}>{sucNombre(cargo.sucursal_id)}</strong></>}
              {padre && <> · reporta a <button onClick={()=>onIrACargo(padre.id)} style={lnk}>{padre.nombre}</button></>}
            </div>
            {jefatura && padre && jefatura.cargo.id !== padre.id && (
              <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3,lineHeight:1.45}}>
                Jefatura efectiva: <button onClick={()=>onIrACargo(jefatura.cargo.id)} style={lnk}>{jefatura.nombres}</button> ({jefatura.cargo.nombre}), porque {padre.nombre} no tiene ocupante.
              </div>
            )}
          </div>
          <button onClick={onCerrar} aria-label="Cerrar ficha" style={{background:'none',border:'none',cursor:'pointer',fontSize:16,color:'var(--text-muted)',padding:2}}>✕</button>
        </div>
        {/* Estado */}
        <div style={{display:'flex',gap:5,marginTop:12,flexWrap:'wrap',alignItems:'center'}}>
          {organo ? (
            <span style={{...chipEst,background:'#8E8E9320',color:'#6E6E73',border:'1px solid #8E8E93'}}>
              {rol?.familia === 'externo' ? 'Servicio externo' : 'Órgano'} · no cuenta en la dotación</span>
          ) : migrada && ocupantes.length > 0 ? (
            <>
              <span style={{...chipEst,background:`${ESTADOS.ocupado.c}20`,color:ESTADOS.ocupado.c,border:`1px solid ${ESTADOS.ocupado.c}`}}>Ocupado</span>
              <span style={{fontSize:11,color:'var(--text-muted)'}}>cambia solo según los ocupantes</span>
            </>
          ) : (migrada ? ESTADOS_MANUALES : Object.keys(ESTADOS)).map(k => {
            const v = ESTADOS[k]; const on = cargo.estado === k
            return (
              <button key={k} disabled={!puedeEditar} onClick={()=>!on && onCambiarEstado(k)} aria-pressed={on} style={{
                ...chipEst, cursor: puedeEditar ? 'pointer' : 'default',
                background: on ? `${v.c}20` : 'transparent', color: on ? v.c : 'var(--text-muted)',
                border:`1px ${k==='por_crear'?'dashed':'solid'} ${on ? v.c : 'var(--border)'}`,
              }}>{v.l}</button>
            )
          })}
        </div>
      </div>

      {/* Cuerpo */}
      <div style={{flex:1,overflowY:'auto',padding:'14px 18px'}}>
        {cargo.notas && (
          <div style={{fontSize:12,color:'var(--text-muted)',background:'var(--bg-app)',borderRadius:8,padding:'8px 11px',marginBottom:14,borderLeft:`3px solid ${colorCab}`}}>
            {cargo.notas}
          </div>
        )}

        {migrada && !organo && m && (
          <>
            <div style={secTitulo}>Dotación del cargo</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:6,marginBottom:6}}>
              <Mini l={m.plazas_aprobadas ? 'Plazas' : 'Propuestas'} v={m.plazas_aprobadas || m.plazas_propuestas}/>
              <Mini l="Ocupan" v={m.ocupacion}/>
              <Mini l="Novedad hoy" v={m.con_novedad_hoy} c={m.con_novedad_hoy ? '#175CD3' : undefined}/>
              <Mini l={m.brecha < 0 ? 'Sobre plazas' : 'Por cubrir'} v={Math.abs(m.brecha || 0)}
                c={m.brecha > 0 ? '#B42318' : m.brecha < 0 ? '#B25E09' : '#1E7A44'}/>
            </div>
            <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:10,lineHeight:1.45}}>
              {m.n_titulares} titular(es){m.n_secundarios ? ` · ${m.n_secundarios} con función acumulada` : ''}{m.n_manuales ? ` · ${m.n_manuales} sin ficha` : ''}
              {!m.plazas_aprobadas && m.plazas_propuestas ? ' · cargo aún no aprobado: no suma a las plazas' : ''}
            </div>
            {puedeEditar && (
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
                <label htmlFor={`plz-${cargo.id}`} style={{fontSize:12,color:'var(--text-muted)'}}>{m.plazas_aprobadas || cargo.estado === 'vacante' || cargo.estado === 'ocupado' ? 'Plazas aprobadas' : 'Plazas propuestas'}</label>
                <input id={`plz-${cargo.id}`} type="number" min={0} step={1} value={plazas} onChange={e=>setPlazas(e.target.value)}
                  style={{...inpBase,width:72,padding:'5px 8px'}}/>
                {plazasCambiadas && <button disabled={trabajando} onClick={guardarPlazas} style={{...btnPri,padding:'5px 12px',fontSize:12}}>Guardar plazas</button>}
              </div>
            )}
          </>
        )}

        <div style={secTitulo}>Ocupantes ({ocupantes.length})</div>
        {ocupantes.length === 0 && (
          <div style={{fontSize:12.5,color:'var(--text-muted)',fontStyle:'italic',marginBottom:10}}>
            Cargo sin ocupante{puedeEditar ? ': usa el buscador para asignar a alguien.' : '.'}
          </div>
        )}
        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
          {ocupantes.map(o => {
            const e = o.emp
            const manual = o.cod_contaline == null
            const acumulada = !manual && o.es_principal === false
            const k = claveOc(o)
            const abierto = perfilAbierto === k
            const pri = !manual ? principalDe[o.cod_contaline] : null
            const cargoPri = acumulada && pri ? cargoPorId[pri.cargo_id] : null
            const otros = manual ? [] : (cargosDePersona[o.cod_contaline]||[]).filter(c=>c && c.id!==cargo.id && c.id!==cargoPri?.id)
            const hoy = e?.hoy?.estado_actual
            const conNov = hoy && hoy !== 'activo'
            return (
              <div key={o.id} style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}>
                <button onClick={()=>setPerfil(abierto?null:k)} aria-expanded={abierto}
                  style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:'9px 11px',
                    background:'var(--bg-app)',border:'none',cursor:'pointer',textAlign:'left'}}>
                  <span style={{width:32,height:32,borderRadius:100,background:avColor(avKey(o)),color:'white',
                    fontSize:11,fontWeight:800,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0,opacity:acumulada?0.7:1}}>
                    {iniciales(nomOcupante(o))}
                  </span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,display:'flex',alignItems:'center',gap:6,minWidth:0}}>
                      <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{nomOcupante(o)}</span>
                      {manual && <span style={tag('#6E6E73')}>Sin ficha</span>}
                      {acumulada && <span style={tag('#175CD3')}>Función acumulada</span>}
                      {conNov && <span style={tag(estHoy(hoy).c)}>{estHoy(hoy).l}</span>}
                    </div>
                    <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{manual ? 'Externo o persona sin ficha en el maestro' : `${e?.cargo || 'Sin cargo de contrato'}${e?.sucursal_id ? ` · ${sucNombre(e.sucursal_id)}` : ''}`}</div>
                  </div>
                  <span style={{fontSize:11,color:'var(--text-muted)'}}>{abierto?'▴':'▾'}</span>
                </button>
                {abierto && manual && (
                  <div style={{padding:'10px 12px',fontSize:12,display:'grid',gap:6}}>
                    <PerfilFila l="Tipo" v="Registro manual"/>
                    <PerfilFila l="En este cargo desde" v={fFecha(o.desde)}/>
                    <div style={{fontSize:11,color:'var(--text-muted)'}}>No suma personas a la dotación ni cuenta para el alcance "equipo" de Asistencia. Si la persona ingresa al maestro, quítala y asígnala como empleado.</div>
                    {puedeEditar && <div style={{display:'flex',justifyContent:'flex-end',marginTop:2}}>
                      <button onClick={()=>quitar(o)} disabled={trabajando} style={{...lnkAccion,color:'#FF3B30'}}>Quitar del cargo</button>
                    </div>}
                  </div>
                )}
                {abierto && !manual && (
                  <div style={{padding:'10px 12px',fontSize:12,display:'grid',gap:6}}>
                    <PerfilFila l="RUT" v={e?.rut || '—'}/>
                    <PerfilFila l="Sucursal" v={sucNombre(e?.sucursal_id)}/>
                    <PerfilFila l="Cargo de contrato" v={e?.cargo || '—'}/>
                    <PerfilFila l="Fecha de ingreso" v={fFecha(e?.fecha_ingreso)}/>
                    <PerfilFila l="En este cargo desde" v={fFecha(o.desde)}/>
                    {conNov && <PerfilFila l="Hoy" v={`${estHoy(hoy).l} · ${fFecha(e.hoy.novedad_desde)} → ${fFecha(e.hoy.novedad_hasta)}`}/>}
                    {cargoPri && (
                      <div style={{fontSize:11.5,color:'var(--text-muted)',lineHeight:1.45}}>
                        Su cargo principal es <button onClick={()=>onIrACargo(cargoPri.id)} style={lnk}>{cargoPri.nombre}</button>: aquí cubre una función acumulada y no se cuenta de nuevo en la dotación.
                      </div>
                    )}
                    {otros.length > 0 && (
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>{acumulada ? 'Además ocupa' : 'También cubre'}</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                          {otros.map(c=>(
                            <button key={c.id} onClick={()=>onIrACargo(c.id)}
                              style={{fontSize:11,padding:'3px 9px',borderRadius:100,cursor:'pointer',
                                background:'var(--bg-app)',border:'1px solid var(--border)',color:'var(--accent)',fontWeight:600}}>
                              {c.nombre}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {puedeEditar && (
                      <div style={{display:'flex',justifyContent:'flex-end',gap:16,marginTop:2}}>
                        {acumulada && migrada && <button onClick={()=>hacerPrincipal(o)} disabled={trabajando} style={lnkAccion}>Hacer principal</button>}
                        <button onClick={()=>quitar(o)} disabled={trabajando} style={{...lnkAccion,color:'#FF3B30'}}>Quitar del cargo</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {puedeEditar && (
          <>
            <div style={secTitulo}>Asignar persona</div>
            <input value={busq} onChange={e=>setBusq(e.target.value)} aria-label="Buscar persona por nombre o RUT"
              placeholder="Buscar por nombre o RUT..." style={{...inpBase,width:'100%',boxSizing:'border-box',marginBottom:8}}/>
            {busq.trim() && (
              <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:14}}>
                {candidatos.length === 0 && <div style={{fontSize:12,color:'var(--text-muted)',padding:6}}>Sin coincidencias entre los empleados activos</div>}
                {candidatos.map(e => {
                  const p = principalDe[e.cod_contaline]
                  const pc = p ? cargoPorId[p.cargo_id] : null
                  return (
                    <button key={e.cod_contaline} onClick={()=>agregar(e)} disabled={trabajando}
                      style={{display:'flex',alignItems:'center',gap:9,padding:'7px 10px',background:'var(--bg-app)',
                        border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',textAlign:'left'}}>
                      <span style={{width:24,height:24,borderRadius:100,background:avColor(e.cod_contaline),color:'white',
                        fontSize:9,fontWeight:800,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                        {iniciales(e.nombre)}
                      </span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12.5,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.nombre}</div>
                        <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{sucNombre(e.sucursal_id)} {e.cargo?`· ${e.cargo}`:''}</div>
                        {pc && migrada && <div style={{fontSize:10.5,color:'#B25E09'}}>Cargo principal: {pc.nombre} · aquí queda como función acumulada</div>}
                      </div>
                      <span style={{fontSize:11,fontWeight:700,color:'var(--accent)'}}>Asignar</span>
                    </button>
                  )
                })}
                <button onClick={()=>agregarManual(busq.trim())} disabled={trabajando}
                  style={{display:'flex',alignItems:'center',gap:9,padding:'7px 10px',background:'transparent',
                    border:'1px dashed var(--border)',borderRadius:8,cursor:'pointer',textAlign:'left'}}>
                  <span style={{fontSize:14}}>✍️</span>
                  <span style={{fontSize:12.5,color:'var(--text-muted)'}}>Agregar <strong style={{color:'var(--text)'}}>"{busq.trim()}"</strong> como ocupante sin ficha (solo externos o socios que no están en el maestro)</span>
                </button>
              </div>
            )}
          </>
        )}

        {hijos.length > 0 && (
          <>
            <div style={secTitulo}>Reportes directos ({hijos.length})</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:14}}>
              {hijos.map(h=>(
                <button key={h.id} onClick={()=>onIrACargo(h.id)}
                  style={{fontSize:11,padding:'4px 10px',borderRadius:100,cursor:'pointer',
                    background:'var(--bg-app)',border:`1px solid ${ESTADOS[h.estado]?.c||'var(--border)'}55`,fontWeight:600}}>
                  <span style={{color:ESTADOS[h.estado]?.c}}>●</span> {h.nombre}
                </button>
              ))}
            </div>
          </>
        )}

        {err && <div style={{fontSize:12,color:'#FF3B30',marginTop:4}}>⚠️ {err}</div>}
      </div>

      {/* Pie de acciones */}
      {puedeEditar && (
        <div style={{padding:'12px 18px',borderTop:'1px solid var(--border)',display:'flex',gap:8}}>
          <button onClick={onEditar} style={{...btnSec,flex:1}}>✏️ Editar</button>
          <button onClick={onNuevoHijo} style={{...btnSec,flex:1}}>➕ Cargo hijo</button>
          <button onClick={onDesactivar} aria-label="Desactivar cargo" style={{...btnSec,color:'#FF3B30',borderColor:'#FF3B3040'}}>🗑</button>
        </div>
      )}
    </div>
  )
}

function Mini({ l, v, c }) {
  return (
    <div style={{background:'var(--bg-app)',borderRadius:8,padding:'6px 8px',textAlign:'center'}}>
      <div style={{fontSize:17,fontWeight:800,color:c || 'var(--text)',fontVariantNumeric:'tabular-nums',lineHeight:1.2}}>{v ?? 0}</div>
      <div style={{fontSize:10,color:'var(--text-muted)'}}>{l}</div>
    </div>
  )
}

function PerfilFila({ l, v }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',gap:10}}>
      <span style={{color:'var(--text-muted)'}}>{l}</span>
      <span style={{fontWeight:600,textAlign:'right'}}>{v}</span>
    </div>
  )
}

// ─── Modal crear / editar cargo ───────────────────────────────────────────────
function ModalCargo({ ctx, sucs, cargos, roles, migrada, ocupado, onCerrar, onGuardado }) {
  const editando = !!ctx.cargo
  const pre = ctx.prefill || {}
  const padreIni = ctx.padre_id == null ? null : cargos.find(c => c.id === ctx.padre_id)
  const [form, setForm] = useState({
    nombre:   ctx.cargo?.nombre ?? pre.nombre ?? '',
    area:     ctx.cargo?.area ?? pre.area ?? padreIni?.area ?? '',
    sucursal: ctx.cargo?.sucursal_id ?? pre.sucursal_id ?? padreIni?.sucursal_id ?? '',
    estado:   ctx.cargo?.estado ?? 'vacante',
    orden:    ctx.cargo?.orden ?? 99,
    notas:    ctx.cargo?.notas ?? '',
    padre:    ctx.padre_id == null ? '' : String(ctx.padre_id),
    rol:      ctx.cargo?.rol_codigo ?? pre.rol_codigo ?? '',
    plazas:   ctx.cargo ? (ctx.cargo.plazas ?? '') : 1,
    cuenta:   ctx.cargo ? ctx.cargo.cuenta_dotacion !== false : true,
  })
  const [sucTocada, setSucTocada] = useState(editando || !!pre.sucursal_id)
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  // Opciones de superior: árbol aplanado con sangría, excluyendo el propio
  // cargo y todos sus descendientes (evita ciclos en la jerarquía)
  const opcionesPadre = useMemo(() => {
    const hijos = {}
    for (const c of (cargos||[])) { const k = c.cargo_padre_id ?? 'root'; (hijos[k]=hijos[k]||[]).push(c) }
    const prohibidos = new Set()
    if (editando) {
      const marcar = id => { prohibidos.add(id); for (const h of (hijos[id]||[])) marcar(h.id) }
      marcar(ctx.cargo.id)
    }
    const out = []
    const rec = (id, prof) => {
      for (const c of (hijos[id]||[])) {
        if (!prohibidos.has(c.id)) out.push({ id:c.id, label: `${'\u2014 '.repeat(prof)}${c.nombre}` })
        // aunque el nodo esté prohibido no bajamos: todo su subárbol también lo está
        if (!prohibidos.has(c.id)) rec(c.id, prof+1)
      }
    }
    rec('root', 0)
    return out
  }, [cargos, editando, ctx.cargo?.id])

  const padreSel = form.padre ? cargos.find(c => String(c.id) === form.padre) : null
  const avisoSuc = padreSel && padreSel.sucursal_id && padreSel.sucursal_id !== 'suc-admin' && form.sucursal && form.sucursal !== padreSel.sucursal_id
  const sucNom = id => sucs.find(s => s.id === id)?.nombre || id
  const rolesPorFam = useMemo(() => ORDEN_FAMILIAS.map(f => ({ f, l: FAMILIAS[f].l, roles: (roles||[]).filter(r => r.familia === f) })).filter(g => g.roles.length), [roles])
  const estadosEdit = migrada ? ESTADOS_MANUALES : Object.keys(ESTADOS)

  function cambiarPadre(v) {
    const np = v ? cargos.find(c => String(c.id) === v) : null
    setForm(f => ({ ...f, padre: v, sucursal: sucTocada ? f.sucursal : (np?.sucursal_id || ''), area: f.area || np?.area || '' }))
  }

  async function guardar() {
    if (!form.nombre.trim()) { setErr('El nombre es obligatorio'); return }
    const nPl = form.plazas === '' ? null : Math.max(0, Math.round(Number(form.plazas)))
    if (migrada && form.cuenta && form.plazas !== '' && Number.isNaN(nPl)) { setErr('Las plazas deben ser un número'); return }
    setGuardando(true); setErr(null)
    try {
      const payload = {
        nombre: form.nombre.trim(),
        area: String(form.area || '').trim() || null,
        sucursal_id: form.sucursal || null,
        orden: Number(form.orden) || 99,
        notas: String(form.notas || '').trim() || null,
        cargo_padre_id: form.padre === '' ? null : Number(form.padre),
        updated_at: new Date().toISOString(),
      }
      if (!(editando && ocupado && migrada)) payload.estado = form.estado
      if (migrada) {
        payload.rol_codigo = form.rol || null
        payload.cuenta_dotacion = !!form.cuenta
        payload.plazas = form.cuenta ? nPl : null
      }
      let error
      if (editando) {
        ({ error } = await supabase.from('org_cargos').update(payload).eq('id', ctx.cargo.id))
      } else {
        ({ error } = await supabase.from('org_cargos').insert(payload))
      }
      if (error) throw error
      await onGuardado()
    } catch(e) { setErr(e.message); setGuardando(false) }
  }

  return (
    <div onClick={onCerrar} style={overlay}>
      <div onClick={e=>e.stopPropagation()} role="dialog" aria-label={editando ? 'Editar cargo' : 'Nuevo cargo'} style={{...modalBox,maxWidth:500}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:14}}>
          {editando ? '✏️ Editar cargo' : ctx.padre_id ? '➕ Nuevo cargo hijo' : '➕ Nuevo cargo raíz'}
        </div>
        <div style={{display:'grid',gap:10,marginBottom:14}}>
          <div>
            <label style={lblM} htmlFor="mc-nombre">Nombre del cargo</label>
            <input id="mc-nombre" value={form.nombre} onChange={e=>setForm(f=>({...f,nombre:e.target.value}))}
              placeholder="Ej: Jefe de Tienda La Granja" style={inpFull}/>
          </div>
          <div>
            <label style={lblM} htmlFor="mc-padre">Depende de</label>
            <select id="mc-padre" value={form.padre} onChange={e=>cambiarPadre(e.target.value)} style={inpFull}>
              <option value="">— Cargo raíz (sin superior) —</option>
              {opcionesPadre.map(o=><option key={o.id} value={String(o.id)}>{o.label}</option>)}
            </select>
            {editando && <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:4}}>Al cambiar el superior, toda la rama que cuelga de este cargo se mueve con él.</div>}
          </div>
          {migrada && (
            <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:10}}>
              <div>
                <label style={lblM} htmlFor="mc-rol">Rol</label>
                <select id="mc-rol" value={form.rol} onChange={e=>setForm(f=>({...f,rol:e.target.value}))} style={inpFull}>
                  <option value="">— Sin rol —</option>
                  {rolesPorFam.map(g => (
                    <optgroup key={g.f} label={g.l}>
                      {g.roles.map(r => <option key={r.codigo} value={r.codigo}>{r.nombre}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label style={lblM} htmlFor="mc-plazas">Plazas</label>
                <input id="mc-plazas" type="number" min={0} step={1} disabled={!form.cuenta} value={form.cuenta ? form.plazas : ''}
                  onChange={e=>setForm(f=>({...f,plazas:e.target.value}))} style={{...inpFull,opacity:form.cuenta?1:0.5}}/>
              </div>
            </div>
          )}
          {migrada && (
            <label style={{display:'flex',alignItems:'flex-start',gap:8,fontSize:12.5,cursor:'pointer'}}>
              <input type="checkbox" checked={form.cuenta} onChange={e=>setForm(f=>({...f,cuenta:e.target.checked}))} style={{marginTop:2}}/>
              <span>Cuenta en la dotación<span style={{display:'block',fontSize:11,color:'var(--text-muted)'}}>Desmárcalo para órganos (Directorio) o servicios externos: no suman plazas ni brechas.</span></span>
            </label>
          )}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div>
              <label style={lblM} htmlFor="mc-area">Área</label>
              <input id="mc-area" value={form.area} onChange={e=>setForm(f=>({...f,area:e.target.value}))}
                placeholder="Ej: Comercial" style={inpFull}/>
            </div>
            <div>
              <label style={lblM} htmlFor="mc-suc">Sucursal</label>
              <select id="mc-suc" value={form.sucursal} onChange={e=>{ setSucTocada(true); setForm(f=>({...f,sucursal:e.target.value})) }} style={inpFull}>
                <option value="">— Transversal —</option>
                {sucs.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          </div>
          {avisoSuc && (
            <div style={{fontSize:11.5,background:'#FFFAEB',border:'1px solid #FEDF89',color:'#93370D',borderRadius:8,padding:'7px 10px',lineHeight:1.45}}>
              Depende de un cargo de {sucNom(padreSel.sucursal_id)} y quedaría en {sucNom(form.sucursal)}. Un cargo de otra sucursal bajo esa jefatura descuadra la dotación por sucursal: revisa que sea correcto.
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:10}}>
            <div>
              <label style={lblM}>Estado</label>
              {editando && ocupado && migrada ? (
                <div style={{fontSize:12,color:'var(--text-muted)',padding:'7px 0'}}>Ocupado: lo define la ocupación. Quita a los ocupantes para planificarlo como vacante, propuesto o por crear.</div>
              ) : (
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {estadosEdit.map(k => { const v = ESTADOS[k]; return (
                    <button key={k} onClick={()=>setForm(f=>({...f,estado:k}))} aria-pressed={form.estado===k} style={{
                      padding:'6px 12px',borderRadius:100,fontSize:12,fontWeight:600,cursor:'pointer',
                      background: form.estado===k ? `${v.c}18` : 'transparent',
                      color: form.estado===k ? v.c : 'var(--text-muted)',
                      border:`1px ${k==='por_crear'?'dashed':'solid'} ${form.estado===k ? v.c : 'var(--border)'}`,
                    }}>{v.l}</button>
                  ) })}
                </div>
              )}
            </div>
            <div>
              <label style={lblM} htmlFor="mc-orden">Orden</label>
              <input id="mc-orden" type="number" value={form.orden} onChange={e=>setForm(f=>({...f,orden:e.target.value}))} style={inpFull}/>
            </div>
          </div>
          <div>
            <label style={lblM} htmlFor="mc-notas">Notas (opcional)</label>
            <textarea id="mc-notas" value={form.notas} onChange={e=>setForm(f=>({...f,notas:e.target.value}))} rows={2}
              placeholder="Ej: Ola 2 del roadmap — contratar post-apertura Maipú" style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
          </div>
        </div>
        {err && <div style={{fontSize:12,color:'#FF3B30',marginBottom:12}}>⚠️ {err}</div>}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCerrar} disabled={guardando} style={btnSec}>Cancelar</button>
          <button onClick={guardar} disabled={guardando} style={btnPri}>{guardando?'Guardando...':'Guardar cargo'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Estilos base ─────────────────────────────────────────────────────────────
const btnPri   = {padding:'8px 15px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}
const btnSec   = {padding:'8px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:500}
const btnGhost = {padding:'8px 14px',background:'transparent',color:'var(--text-muted)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}
const btnCtl   = {width:30,height:30,display:'inline-flex',alignItems:'center',justifyContent:'center',background:'var(--bg-surface)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:600}
const lblM     = {display:'block',fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.04em'}
const inpBase  = {padding:'8px 11px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-surface)',color:'var(--text)',fontFamily:'inherit'}
const inpFull  = {padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit',width:'100%',boxSizing:'border-box'}
const tabBtn   = {padding:'6px 13px',borderRadius:8,border:'none',background:'transparent',color:'var(--text-muted)',fontSize:12.5,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center'}
const tabBtnOn = {background:'var(--bg-app)',color:'var(--text)',boxShadow:'inset 0 0 0 1px var(--border)'}
const secTitulo = {fontSize:10.5,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}
const chip     = {padding:'6px 11px',borderRadius:100,border:'1px solid var(--border)',background:'var(--bg-surface)',color:'var(--text-muted)',fontSize:11.5,fontWeight:600,cursor:'pointer'}
const chipEst  = {padding:'4px 11px',borderRadius:100,fontSize:11,fontWeight:700}
const card     = {background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12}
const cardHead = {display:'flex',alignItems:'baseline',gap:10,flexWrap:'wrap',padding:'10px 12px',borderBottom:'1px solid var(--border)'}
const lnk      = {background:'none',border:'none',padding:0,cursor:'pointer',color:'var(--accent)',fontSize:'inherit',fontWeight:600,textDecoration:'underline'}
const lnkAccion = {background:'none',border:'none',cursor:'pointer',color:'var(--accent)',fontSize:11.5,fontWeight:700,padding:0}
const tag      = c => ({fontSize:9,fontWeight:800,padding:'1px 7px',borderRadius:100,background:`${c}18`,color:c,whiteSpace:'nowrap',flexShrink:0})
const overlay  = {position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}
const modalBox = {background:'var(--bg-surface)',borderRadius:14,padding:22,width:'100%',border:'1px solid var(--border)',maxHeight:'88vh',overflowY:'auto'}
const thP      = {padding:'8px 14px',textAlign:'left',fontSize:10.5,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}
const tdP      = {padding:'8px 14px',verticalAlign:'middle'}
