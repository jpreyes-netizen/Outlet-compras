import { useState, useEffect, useCallback, useMemo } from 'react'
import { deepLink } from '../core/deeplink'
import { supabase, signOut } from '../supabase'
import { preloadCaps, canSync, can } from '../core/permisos'
import { RemuneracionesApp } from './remuneraciones/RemuneracionesApp'
import { AsistenciaApp } from './asistencia/AsistenciaApp'
import { OrganigramaApp } from './organigrama/OrganigramaApp'
import { DesempenoApp }   from './desempeno/DesempenoApp'
import { PmoGestion } from '../proyectos/ProyectosApp'
import { RrhhIntegridad } from './integridad/RrhhIntegridad'
import { CuadraturaHHEE } from './cuadratura/CuadraturaHHEE'
import { RrhhCumplimiento } from './cumplimiento/RrhhCumplimiento'
import { MenuSuperior, MenuMovil, menuVisible } from '../components/MenuErp'

/* ═══════════════════════════════════════════════════════════════════════
   PERSONAS (RRHH) — Shell con menú superior tipo ERP, mismo estilo que Finanzas
   · Reemplaza el selector intermedio de sub-apps y los 4 encabezados propios.
   · El menú se organiza por cómo trabaja la gente, no por cómo está el código:
     el trabajador (maestro, dotación, cargo) queda reunido en "Personas".
   · Cada opción apunta a (hoja, sub). Las sub-apps reciben `embebido`, `sub`
     y avisan sus cambios con `onSub`, igual que los módulos de Finanzas.
   · Tokens: las pantallas de RRHH usan --border, --text, --bg-app y --bg-card,
     que no existían en theme.css (bordes y fondos no se dibujaban). Se definen
     aquí, en el contenedor, con la paleta de Finanzas.
   · RBAC: mismas capabilities y reglas legado que antes. Cada sub-app sigue
     validando su propio acceso (defensa en profundidad).
   ═══════════════════════════════════════════════════════════════════════ */

const FONDO = '#F4F5F7', NAVY = '#16213E'

const TOKENS = {
  '--bg-app': FONDO, '--bg-surface': '#FFFFFF', '--bg-card': '#F7F8FA',
  '--border': '#E5E7EB', '--text': '#1C1C1E', '--text-muted': '#6E6E73',
  '--accent': NAVY, '--success': '#1E7A44', '--danger': '#B42318',
  '--warning': '#B25E09', '--info': '#175CD3', '--purple': '#6941C6',
}

const ROLES = [
  { k: "admin", l: "Administrador", c: "#B42318" }, { k: "dir_general", l: "Dirección general", c: "#B42318" },
  { k: "dir_finanzas", l: "Dirección de finanzas", c: "#6941C6" }, { k: "dir_negocios", l: "Dirección de negocios", c: "#175CD3" },
  { k: "dir_operaciones", l: "Dirección de operaciones", c: "#175CD3" }, { k: "jefe_admin_finanzas", l: "Jefatura de administración y finanzas", c: "#6941C6" },
  { k: "analista", l: "Analista", c: "#1E7A44" }, { k: "jefe_bodega", l: "Jefatura de bodega", c: "#B25E09" },
  { k: "jefe_tienda", l: "Jefatura de tienda", c: "#B25E09" }, { k: "jefe_operaciones", l: "Jefatura de operaciones", c: "#B25E09" },
  { k: "directorio", l: "Directorio", c: "#6E6E73" },
]
const rl = u => ROLES.find(r => r.k === u?.rol) || { k: u?.rol, l: u?.rol ?? 'Usuario', c: '#6E6E73' }

// Fallback legado por rol (cuando no hay capabilities cargadas). Espejo en DesempenoApp.
const ROLES_LEGADO_RRHH = ['admin', 'dir_general', 'dir_finanzas']

const CAP_HOJA = {
  asistencia: 'rrhh.asistencia', remuneraciones: 'rrhh.remuneraciones',
  organigrama: 'rrhh.organigrama', desempeno: 'rrhh.desempeno', gestion: null,
  integridad: null,   // visibilidad: fn_rrhh_es_gestor() (BD), vía ex.gestor
  cuadratura_hhee: 'rrhh.remuneraciones',   // + ex.gestor
  cumplimiento: null,                       // vacaciones y contratos · ex.gestor
}
const HOJAS = Object.keys(CAP_HOJA)

/* Arquitectura de información: módulo → grupos → opciones.
   `si` se evalúa contra permisos finos (costo, dotación, configuración). */
const armarMenu = ex => [
  { k: 'inicio', l: 'Inicio', grupos: [
    { l: 'Mi día', items: [
      { l: 'Integridad de datos', hoja: 'integridad', si: () => ex.gestor },
      { l: 'Tareas y reuniones', hoja: 'gestion' },
    ]},
  ]},
  { k: 'asis', l: 'Asistencia', grupos: [
    { l: 'Control diario', items: [
      { l: 'Resumen de asistencia', hoja: 'asistencia', sub: 'dashboard' },
      { l: 'Marcaciones y permisos', hoja: 'asistencia', sub: 'registros' },
    ]},
    { l: 'Jefatura', items: [
      { l: 'Por validar', hoja: 'asistencia', sub: 'hhee' },
    ]},
    { l: 'Análisis y costo', items: [
      { l: 'Análisis de jornadas', hoja: 'asistencia', sub: 'analisis' },
      { l: 'Costo de asistencia y horas extra', hoja: 'asistencia', sub: 'costo', si: () => ex.costo },
    ]},
    { l: 'Configuración', items: [
      { l: 'Integración Workera', hoja: 'asistencia', sub: 'config', si: () => !ex.restringido },
    ]},
  ]},
  { k: 'personas', l: 'Personas', grupos: [
    { l: 'Trabajadores', items: [
      { l: 'Maestro de empleados', hoja: 'remuneraciones', sub: 'empleados' },
      { l: 'Estado de dotación', hoja: 'asistencia', sub: 'dotacion', si: () => ex.dotacion },
    ]},
    { l: 'Cumplimiento', items: [
      { l: 'Vacaciones', hoja: 'cumplimiento', sub: 'vacaciones', si: () => ex.gestor },
      { l: 'Contratos y plazos', hoja: 'cumplimiento', sub: 'contratos', si: () => ex.gestor },
    ]},
    { l: 'Estructura', items: [
      { l: 'Organigrama', hoja: 'organigrama', sub: 'arbol' },
      { l: 'Personas sin cargo asignado', hoja: 'organigrama', sub: 'pendientes' },
    ]},
  ]},
  { k: 'rem', l: 'Remuneraciones', grupos: [
    { l: 'Proceso mensual', items: [
      { l: 'Cargar liquidaciones', hoja: 'remuneraciones', sub: 'cargar' },
      { l: 'Boletas de honorarios', hoja: 'remuneraciones', sub: 'honorarios' },
    ]},
    { l: 'Control', items: [
      { l: 'Cuadratura de horas extra', hoja: 'cuadratura_hhee', si: () => ex.gestor },
    ]},
    { l: 'Reportes', items: [
      { l: 'Panel de remuneraciones', hoja: 'remuneraciones', sub: 'dashboard' },
      { l: 'Informe mensual', hoja: 'remuneraciones', sub: 'informe' },
      { l: 'Análisis comparativo', hoja: 'remuneraciones', sub: 'analisis' },
    ]},
  ]},
  { k: 'des', l: 'Desempeño', grupos: [
    { l: 'Evaluación', items: [
      { l: 'Procesos de evaluación', hoja: 'desempeno', sub: 'procesos' },
      { l: 'Trabajadores evaluados', hoja: 'desempeno', sub: 'trabajadores' },
    ]},
  ]},
]

/* Estado inicial: deep link > hoja guardada > selector antiguo (rrhh_subapp).
   Las pestañas recordadas de la versión anterior se heredan. */
function estadoInicial() {
  let hoja = null, subs = {}
  try { subs = JSON.parse(localStorage.getItem('rrhh_subs') || '{}') || {} } catch { subs = {} }
  try {
    if (!subs.remuneraciones) { const t = localStorage.getItem('rrhh_tab'); if (t) subs.remuneraciones = t }
    if (!subs.asistencia) { const t = localStorage.getItem('asis_tab'); if (t) subs.asistencia = t }
    const h = localStorage.getItem('rrhh_hoja') || localStorage.getItem('rrhh_subapp')
    if (HOJAS.includes(h)) hoja = h
  } catch { /* sin storage */ }
  if (deepLink?.app === 'rrhh' && HOJAS.includes(deepLink.modulo)) {
    hoja = deepLink.modulo
    if (deepLink.tab) subs = { ...subs, [hoja]: deepLink.tab }
  }
  return { hoja, subs }
}

export function RrhhApp({ cu, setAppActual }) {
  const [ini] = useState(estadoInicial)
  const [hoja, setHoja] = useState(ini.hoja)
  const [subs, setSubs] = useState(ini.subs)
  const [verificando, setVerificando] = useState(true)
  const [accesos, setAccesos] = useState({ remuneraciones: false, asistencia: false, organigrama: false, desempeno: false })
  const [ex, setEx] = useState({ costo: false, dotacion: false, restringido: false, gestor: false })
  const [nIntegridad, setNIntegridad] = useState(0)   // inconsistencias de severidad alta
  const [pend, setPend] = useState(null)        // { hhee, ausencias } informado por Asistencia
  const [ctxAsis, setCtxAsis] = useState(null)  // "Solo La Granja · Comercial"
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 900 : false)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Accesos por sub-app (mismas reglas que el selector anterior) + permisos finos del menú
  useEffect(() => {
    let cancel = false
    const verificar = async () => {
      const legado = cu?.rol === 'admin' || ROLES_LEGADO_RRHH.includes(cu?.rol)
      let acc = { remuneraciones: true, asistencia: true, organigrama: true, desempeno: true }
      let restringido = false
      try {
        await preloadCaps(cu, 'rrhh')
        if (!legado) {
          acc = {
            remuneraciones: !!canSync(cu, 'rrhh', 'rrhh.remuneraciones'),
            asistencia: !!canSync(cu, 'rrhh', 'rrhh.asistencia'),
            organigrama: !!canSync(cu, 'rrhh', 'rrhh.organigrama'),
            desempeno: !!canSync(cu, 'rrhh', 'rrhh.desempeno'),
          }
          restringido = ['sucursal', 'propio'].includes(canSync(cu, 'rrhh', 'rrhh.asistencia'))
        }
      } catch {
        if (!legado) acc = { remuneraciones: false, asistencia: false, organigrama: false, desempeno: false }
      }
      // Mismas fuentes que usa AsistenciaApp para mostrar Dotación y Costo
      const [dot, cos, ges] = await Promise.all([
        can(cu, 'rrhh', 'rrhh.dotacion').then(s => s !== false && s != null).catch(() => ['admin', 'dir_general'].includes(cu?.rol)),
        supabase.from('rrhh_acceso_remuneracion').select('usuario_id').eq('usuario_id', cu.id).eq('activo', true).maybeSingle()
          .then(r => !!r.data, () => false),
        supabase.rpc('fn_rrhh_es_gestor').then(r => r.data === true, () => false),
      ])
      if (cancel) return
      setAccesos(acc)
      setEx({ costo: cos, dotacion: dot, restringido, gestor: ges })
      if (ges) supabase.from('v_rrhh_integridad').select('id', { count: 'exact', head: true }).eq('severidad', 'alta')
        .then(r => { if (!cancel) setNIntegridad(r.count || 0) }, () => {})
      setVerificando(false)
    }
    verificar()
    return () => { cancel = true }
  }, [cu?.id, cu?.rol])

  const menu = useMemo(() => {
    const pasaCap = cap => !cap ? true : !!accesos[Object.keys(CAP_HOJA).find(h => CAP_HOJA[h] === cap)]
    return menuVisible(armarMenu(ex), cu, pasaCap, CAP_HOJA)
  }, [accesos, ex, cu])

  const items = useMemo(() => menu.flatMap(m => m.grupos.flatMap(g => g.items)), [menu])
  const hojasVisibles = useMemo(() => new Set(items.map(i => i.hoja)), [items])
  // Aterrizaje: lo que cada perfil usa a diario
  const porDefecto = ex.gestor ? { hoja: 'integridad' }
    : accesos.asistencia ? { hoja: 'asistencia', sub: 'dashboard' }
    : accesos.remuneraciones ? { hoja: 'remuneraciones', sub: 'dashboard' }
    : (items[0] ?? { hoja: 'gestion' })
  const hojaValida = hoja && hojasVisibles.has(hoja) ? hoja : porDefecto.hoja
  const sub = subs[hojaValida] ?? (hojaValida === porDefecto.hoja ? porDefecto.sub : undefined)

  useEffect(() => { try { localStorage.setItem('rrhh_hoja', hojaValida); localStorage.removeItem('rrhh_subapp') } catch { } }, [hojaValida])
  useEffect(() => { try { localStorage.setItem('rrhh_subs', JSON.stringify(subs)) } catch { } }, [subs])

  const ir = useCallback((h, s) => {
    setHoja(h)
    if (s !== undefined) setSubs(m => ({ ...m, [h]: s }))
    try { window.scrollTo({ top: 0 }) } catch { }
  }, [])
  const onSub = useCallback(s => setSubs(m => (s == null || m[hojaValida] === s) ? m : ({ ...m, [hojaValida]: s })), [hojaValida])

  const cambiarApp = () => { try { localStorage.removeItem('outlet_app_actual') } catch { } setAppActual(null) }
  const cerrarSesion = async () => {
    try { await signOut() } catch { }
    try { localStorage.removeItem('erp_cu_id'); localStorage.removeItem('outlet_app_actual') } catch { }
    window.location.reload()
  }

  const estiloBase = { ...TOKENS, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif", background: FONDO, minHeight: '100vh', fontSize: 14, color: '#1C1C1E' }

  if (verificando) return (
    <div style={{ ...estiloBase, padding: 80, textAlign: 'center', color: '#6E6E73' }}>Verificando acceso…</div>
  )

  const ningunAcceso = !accesos.remuneraciones && !accesos.asistencia && !accesos.organigrama && !accesos.desempeno
  if (ningunAcceso) return (
    <div style={{ ...estiloBase, padding: 60, textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 20, color: NAVY }}>Sin acceso a Personas</h2>
      <p style={{ color: '#6E6E73', margin: '0 0 24px' }}>Pide acceso al administrador del sistema.</p>
      <button onClick={cambiarApp} style={{ padding: '9px 16px', background: '#fff', color: NAVY, border: '1px solid #E5E7EB', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Cambiar de aplicación</button>
    </div>
  )

  const nPend = (pend?.hhee || 0) + (pend?.ausencias || 0)
  const badges = { 'asistencia|hhee': nPend, 'integridad|': nIntegridad }
  const contexto = hojaValida === 'asistencia' && ctxAsis
    ? <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 9px', borderRadius: 4, background: '#FEF3E2', color: '#B25E09' }}>{ctxAsis}</span>
    : null

  const p = { cu, embebido: true, sub, onSub, onVolverHubRrhh: () => ir('gestion'), onCerrarSesion: cerrarSesion }
  const r = rl(cu)
  const propsMenu = { menu, hoja: hojaValida, sub, onIr: ir, usuario: cu, rolNombre: r.l, rolColor: r.c, onApps: cambiarApp, onSalir: cerrarSesion, marca: 'Personas', badges, contexto }

  return (
    <div style={estiloBase}>
      <style>{`
        body{background:${FONDO};overflow-x:hidden}
        input:focus,select:focus,textarea:focus{border-color:${NAVY}!important;box-shadow:0 0 0 3px rgba(22,33,62,0.08)!important}
        ::selection{background:${NAVY};color:#fff}
        ::-webkit-scrollbar{width:10px;height:10px}
        ::-webkit-scrollbar-track{background:${FONDO};border-radius:5px}
        ::-webkit-scrollbar-thumb{background:#C7C7CC;border-radius:5px;border:2px solid ${FONDO}}
        ::-webkit-scrollbar-thumb:hover{background:#8E8E93}
        table{font-size:13px}
        @media (max-width:899px){ table{font-size:11px} }
      `}</style>
      {isMobile ? <MenuMovil {...propsMenu} /> : <MenuSuperior {...propsMenu} />}
      <main style={{ padding: isMobile ? '12px 10px 40px' : '18px 22px 40px', maxWidth: 1920, margin: '0 auto' }}>
        {hojaValida === 'remuneraciones' && accesos.remuneraciones && <RemuneracionesApp {...p} />}
        {hojaValida === 'asistencia' && accesos.asistencia && <AsistenciaApp {...p} onPend={setPend} onContexto={setCtxAsis} />}
        {hojaValida === 'organigrama' && accesos.organigrama && <OrganigramaApp {...p} />}
        {hojaValida === 'desempeno' && accesos.desempeno && <DesempenoApp {...p} />}
        {hojaValida === 'gestion' && <PmoGestion cu={cu} area="personas" />}
        {hojaValida === 'integridad' && ex.gestor && <RrhhIntegridad cu={cu} onIr={ir} onConteo={setNIntegridad} />}
        {hojaValida === 'cuadratura_hhee' && ex.gestor && accesos.remuneraciones && <CuadraturaHHEE cu={cu} />}
        {hojaValida === 'cumplimiento' && ex.gestor && <RrhhCumplimiento cu={cu} sub={sub} onSub={onSub} />}
      </main>
    </div>
  )
}
