// src/rrhh/asistencia/AsistenciaApp.jsx
// 5 tabs: Dashboard | Registros | Análisis | HHEE | Config
// HHEE v2: validación de horas extras con autorización de jefatura
// Eliminados: AsisMarcaciones, AsisPermisos, AsisJornadas, AsisExtrasAtrasos

import { useState, useEffect, useRef } from 'react'
import { can, userScope } from '../../core/permisos'
import { aplicarAlcance, enAlcance } from './alcance'
import { supabase } from '../../supabase'
import { AsisConfig }    from './config/AsisConfig'
import { AsisDashboard } from './tabs/AsisDashboard'
import { AsisRegistros } from './tabs/AsisRegistros'
import { AsisAnalisis }  from './tabs/AsisAnalisis'
import { AsisHHEE }      from './tabs/AsisHHEE'
import { AsisDotacion }  from './tabs/AsisDotacion'
import { AsisRemuneracion } from './tabs/AsisRemuneracion'
import { AsisFueraTurno } from './tabs/AsisFueraTurno'
import { deepLink }       from '../../core/deeplink'

const ROLES = [
  { k:"admin",           l:"Admin",           c:"var(--danger)"   },
  { k:"dir_general",     l:"Dir. General",    c:"var(--danger)"   },
  { k:"dir_finanzas",    l:"Dir. Finanzas",   c:"var(--purple)"   },
  { k:"dir_negocios",    l:"Dir. Negocios",   c:"var(--accent)"   },
  { k:"dir_operaciones", l:"Dir. Operaciones",c:"var(--info)"     },
  { k:"analista",        l:"Analista",        c:"var(--success)"  },
  { k:"directorio",      l:"Directorio",      c:"var(--text-muted)" }
]
const rl = u => ROLES.find(r=>r.k===u?.rol)||ROLES[5]

// Etiquetas en lenguaje del usuario, no del sistema. "Por validar" dice qué
// se hace ahí; "Excepciones" describía el dato, no la tarea.
const TABS = [
  { k:"dashboard", l:"Resumen"            },
  { k:"registros", l:"Marcaciones"        },
  { k:"analisis",  l:"Análisis"           },
  { k:"hhee",      l:"Por validar", badge:true },
  { k:"fuera_turno", l:"Fuera de turno"     },
  { k:"dotacion",  l:"Dotación"           },
  { k:"costo",     l:"Costo"               },
  { k:"config",    l:"Configuración"      },
]

// embebido/sub/onSub: patrón del shell tipo Finanzas (menú superior). El shell
// indica la pestaña (sub) y recibe los cambios internos para la ruta de navegación.
// onPend / onContexto: suben el contador de pendientes y el alcance al menú.
export function AsistenciaApp({ cu, onVolverHubRrhh, onCerrarSesion, embebido, sub, onSub, onPend, onContexto }) {
  const [tab, setTab] = useState(() => {
    if (sub && TABS.some(t => t.k === sub)) return sub
    try {
      if (deepLink?.modulo === 'asistencia' && deepLink?.tab) return deepLink.tab
      return localStorage.getItem("asis_tab")||"dashboard"
    } catch { return "dashboard" }
  })
  const primeraSub = useRef(true)
  useEffect(() => { if (primeraSub.current) { primeraSub.current = false; return } if (sub && sub !== tab && TABS.some(t => t.k === sub)) setTab(sub) }, [sub]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onSub?.(tab) }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem("asis_tab",tab) } catch {}
  }, [tab])

  // ─── RBAC: alcance del usuario en asistencia ──────────────────────────────
  // scope: undefined=resolviendo | 'all' | 'sucursal' | 'propio' | false
  // scopeSuc: null (ve todo) | ID de sucursal ('suc-lg') — TODOS los tabs
  // filtran por sucursal_id, que es la convención del sistema. No traducir a
  // nombre acá: el desajuste histórico estaba en los filtros de Excepciones,
  // ya corregidos en AsisHHEE.
  const [scope, setScope]       = useState(undefined)
  const [scopeSuc, setScopeSuc] = useState(null)
  const [sucNombre, setSucNombre] = useState(null)   // solo para mostrar
  // Alcance por ÁREA: en La Granja y Tienda Maipú conviven dos jefaturas sobre
  // la misma sucursal. Sin esto, cada una veía —y podía validar— el equipo de
  // la otra. El criterio se lee de la misma fuente que segmenta los correos.
  const [areaScope, setAreaScope] = useState(null)   // { nombre, filtro } | null — solo para mostrar el área
  // Equipo que esta jefatura puede ver y validar (fn_asis_mi_alcance): organigrama
  // + trabajadores sin cargo de su sucursal/área. null = sin restricción.
  const [scopeCods, setScopeCods] = useState(null)

  useEffect(() => {
    let cancel = false
    async function resolver() {
      try {
        const s   = await can(cu, 'rrhh', 'rrhh.asistencia')
        const suc = await userScope(cu, 'rrhh', 'rrhh.asistencia')
        if (cancel) return
        // Roles legado sin matriz (admin/dir_general/dir_finanzas) → acceso total
        const esLegado = ['admin','dir_general','dir_finanzas'].includes(cu?.rol)
        const sc = s === false && esLegado ? 'all' : s
        setScope(sc)
        setScopeSuc(suc || null)
        // Restringido → equipo desde la BD. Falla cerrado: sin equipo no ve a nadie
        // (antes, una jefatura sin sucursal asignada veía toda la empresa).
        if (sc === 'sucursal' || sc === 'propio') {
          const { data: cods, error: eC } = await supabase.rpc('fn_asis_mi_alcance')
          if (cancel) return
          setScopeCods(eC ? [] : (cods || []))
          if (!suc) { setSucNombre('mi equipo'); return }
        } else setScopeCods(null)
        if (!suc) { setSucNombre(null); return }
        try {
          const { data } = await supabase.from('sucursales')
            .select('nombre').eq('id', suc).maybeSingle()
          if (!cancel) setSucNombre(data?.nombre || suc)
        } catch { if (!cancel) setSucNombre(suc) }
        try {
          const { data: al } = await supabase.from('v_asis_alcance_usuario')
            .select('area_nombre,area_filtro').eq('usuario_id', cu.id).maybeSingle()
          if (!cancel && al?.area_filtro)
            setAreaScope({ nombre: al.area_nombre, filtro: al.area_filtro })
        } catch { /* sin área definida: conserva el alcance de sucursal */ }
      } catch {
        if (!cancel) { setScope(false); setScopeSuc(null); setSucNombre(null) }
      }
    }
    resolver()
    return () => { cancel = true }
  }, [cu?.id])

  // Restringido mientras llega el equipo desde la BD: no consultar todavía.
  const scopeEsperaEquipo = (scope === 'sucursal' || scope === 'propio') && scopeCods === null
  // Para la UI, un restringido sin sucursal se trata como restringido (oculta
  // controles de dirección); las consultas usan scopeCods, no este valor.
  const scopeSucUI = scopeSuc || (Array.isArray(scopeCods) ? '__equipo__' : null)

  // ─── Pendientes de validación · alimenta el contador de la pestaña ────────
  // Señal de navegación: el usuario ve cuánto le falta sin entrar a buscarlo.
  // Misma definición que el informe por correo: HHEE del mes en curso sin
  // decisión de jefatura + ausencias con turno sin gestionar.
  const [pend, setPend] = useState(null)   // { hhee, ausencias }
  async function cargarPendientes() {
    try {
      // Horas extra: ventana de trabajo = período de pago (26 al 25) en curso
      // más el anterior; misma regla que fn_periodo_pago_ventana_desde() en la BD.
      // No es un cierre: fuera de la ventana se puede decidir igual, solo no
      // se cuenta como trabajo pendiente. Ausencias: mes calendario en curso.
      const h = new Date()
      const desde = `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,'0')}-01`
      const hasta = h.toISOString().slice(0, 10)
      const [hy, hm, hd] = hasta.split('-').map(Number)
      // Mes en que termina el período vigente, menos dos meses, día 26
      const t = new Date(Date.UTC(hy, (hd >= 26 ? hm : hm - 1) - 2, 1))
      const desdeH = `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,'0')}-26`
      let qH = supabase.from('v_asis_jornadas').select('cod_contaline,fecha,departamento')
        .gt('min_extra_dia', 0).gte('fecha', desdeH).lte('fecha', hasta).limit(20000)
      let qA = supabase.from('v_asis_jornadas').select('cod_contaline,fecha,departamento')
        .eq('estado_dia', 'sin_marcas').gte('fecha', desde).lte('fecha', hasta).limit(20000)
      qH = aplicarAlcance(qH, scopeSuc, scopeCods); qA = aplicarAlcance(qA, scopeSuc, scopeCods)
      const [jh, ja, vals, ges, ft] = await Promise.all([
        qH, qA,
        supabase.from('asis_hhee_validaciones').select('cod_contaline,fecha')
          .eq('activo', true).gte('fecha', desdeH).limit(20000),
        supabase.from('asis_ausencias').select('cod_contaline,fecha')
          .gte('fecha', desde).limit(20000),
        // Días con huella y sin turno por decidir (la vista ya filtra por equipo)
        supabase.from('v_asis_fuera_turno').select('cod_contaline', { count: 'exact', head: true })
          .eq('estado', 'pendiente').in('clasificacion', ['dia_adicional', 'turno_no_cargado']).gte('fecha', desdeH),
      ])
      const k = r => `${r.cod_contaline}|${r.fecha}`
      const vSet = new Set((vals.data || []).map(k))
      const gSet = new Set((ges.data || []).map(k))
      // El contador debe reflejar SOLO lo que esta jefatura puede resolver:
      // con alcance por área, contar la sucursal entera marcaría pendientes
      // que no le corresponden y que además no puede tocar.
      const enArea = enAlcance(scopeCods)   // el equipo ya viene resuelto por la BD
      setPend({
        hhee: (jh.data || []).filter(enArea).filter(r => !vSet.has(k(r))).length,
        ausencias: (ja.data || []).filter(enArea).filter(r => !gSet.has(k(r))).length,
        fuera_turno: ft?.count || 0,
      })
    } catch { setPend(null) }
  }
  useEffect(() => { if (scope && scope !== false && !(scopeEsperaEquipo)) cargarPendientes() }, [scope, scopeSuc, scopeCods, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onPend?.(pend) }, [pend]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onContexto?.(sucNombre ? `Solo ${sucNombre}${areaScope ? ` · ${areaScope.nombre}` : ''}${Array.isArray(scopeCods) ? ` · ${scopeCods.length} personas` : ''}` : null) }, [sucNombre, areaScope, scopeCods]) // eslint-disable-line react-hooks/exhaustive-deps

  const restringido  = scope === 'sucursal' || scope === 'propio'
  const [puedeDotacion, setPuedeDotacion] = useState(null)   // null = resolviendo
  // Costo: lista explícita de acceso, no por rol (los roles son compartidos
  // entre personas y filtrarían los sueldos base).
  const [puedeCosto, setPuedeCosto] = useState(null)
  useEffect(() => {
    supabase.from('rrhh_acceso_remuneracion')
      .select('usuario_id').eq('usuario_id', cu.id).eq('activo', true).maybeSingle()
      .then(r => setPuedeCosto(!!r.data), () => setPuedeCosto(false))
    can(cu, 'rrhh', 'rrhh.dotacion')
      .then(s => setPuedeDotacion(s !== false && s != null))
      .catch(() => setPuedeDotacion(['admin','dir_general'].includes(cu?.rol)))
  }, [cu?.id])
  const tabsVisibles = TABS.filter(t =>
    (t.k !== 'config' || !restringido) && (t.k !== 'dotacion' || puedeDotacion) &&
    (t.k !== 'costo' || puedeCosto))

  // Si el usuario restringido quedó en Config (localStorage), rebotar a dashboard
  useEffect(() => {
    if (restringido && tab === 'config') setTab('dashboard')
    // Solo rebota cuando el permiso ya se resolvió en falso: antes rebotaba
    // mientras cargaba y nunca se podía entrar directo a Dotación o Costo.
    if (tab === 'dotacion' && puedeDotacion === false) setTab('dashboard')
    if (tab === 'costo' && puedeCosto === false) setTab('dashboard')
  }, [restringido, tab, puedeDotacion, puedeCosto])

  // Destino inicial para el tab Excepciones cuando se navega desde el dashboard
  const [hheeInit, setHheeInit] = useState(null)   // { dominio, cat }

  function navegar(destino, opts) {
    if (destino === 'hhee') setHheeInit(opts || null)
    setTab(destino)
  }

  function irASync() {
    setTab('config')
    try { localStorage.setItem("asis_config_sub","sync") } catch {}
  }

  if (scope === undefined) return (
    <div style={{padding:80,textAlign:"center",color:"var(--text-muted)"}}>Verificando alcance de acceso...</div>
  )
  if (scope === false) return (
    <div style={{padding:60,textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:16}}>🔒</div>
      <h2 style={{margin:"0 0 8px 0"}}>Sin acceso a Control de Asistencia</h2>
      <p style={{color:"var(--text-muted)",margin:"0 0 24px 0"}}>Solicita acceso al administrador del sistema.</p>
      <button onClick={onVolverHubRrhh} style={btnSec}>&larr; Volver</button>
    </div>
  )
  if (scope === 'propio') return (
    <div style={{padding:60,textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:16}}>🚧</div>
      <h2 style={{margin:"0 0 8px 0"}}>Alcance "propio" aún no disponible</h2>
      <p style={{color:"var(--text-muted)",margin:"0 0 24px 0"}}>La vista individual de asistencia estará disponible próximamente.</p>
      <button onClick={onVolverHubRrhh} style={btnSec}>&larr; Volver</button>
    </div>
  )

  const contenido = scopeEsperaEquipo ? <div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>Cargando tu equipo…</div> : (<>
        {tab==="dashboard" && <AsisDashboard cu={cu} onIrASync={irASync} onNavegar={navegar} scopeSuc={scopeSucUI} scopeCods={scopeCods} areaScope={areaScope} pend={pend}/>}
        {tab==="registros" && <AsisRegistros cu={cu} onIrASync={irASync} scopeSuc={scopeSucUI} scopeCods={scopeCods}/>}
        {tab==="analisis"  && <AsisAnalisis  cu={cu} onIrASync={irASync} onNavegar={navegar} scopeSuc={scopeSucUI} scopeCods={scopeCods}/>}
        {tab==="hhee"      && <AsisHHEE      cu={cu} scopeSuc={scopeSucUI} scopeCods={scopeCods} areaScope={areaScope} initDominio={hheeInit?.dominio} initCat={hheeInit?.cat} onCambio={cargarPendientes}/>}
        {tab==="config"    && !restringido && <AsisConfig cu={cu}/>}
        {tab==="dotacion"  && puedeDotacion && <AsisDotacion cu={cu}/>}
        {tab==="costo"     && puedeCosto    && <AsisRemuneracion cu={cu}/>}
        {tab==="fuera_turno" && <AsisFueraTurno cu={cu} onCambio={cargarPendientes}/>}
  </>)
  if (embebido) return <div>{contenido}</div>

  return (
    <div style={{minHeight:"100vh",background:"var(--bg-app)"}}>
      {/* Cabecera: identidad, alcance y sesión. Barra de navegación pegada
          abajo para que el contador de pendientes siga visible al hacer scroll. */}
      <header style={{
        background:"var(--bg-surface)",borderBottom:"1px solid var(--border)",
        padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",
        position:"sticky",top:0,zIndex:51,gap:16,flexWrap:"wrap"
      }}>
        <div style={{display:"flex",alignItems:"center",gap:14,minWidth:0}}>
          <button onClick={onVolverHubRrhh} style={btnSec} title="Volver a Gestión de Personas">
            &larr;<span style={{marginLeft:6}}>Gestión de Personas</span>
          </button>
          <div style={{width:1,height:26,background:"var(--border)"}}/>
          <div style={{minWidth:0}}>
            <div style={{fontSize:17,fontWeight:650,letterSpacing:"-.01em"}}>Control de Asistencia</div>
            <div style={{fontSize:11.5,color:"var(--text-muted)",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span>Datos de Workera</span>
              {sucNombre && (
                <span style={{
                  fontSize:10.5,fontWeight:700,padding:"2px 8px",borderRadius:4,
                  background:"var(--warning,#B25E09)15",color:"var(--warning,#B25E09)",
                  letterSpacing:".02em"
                }}>Solo {sucNombre}{areaScope ? ` · ${areaScope.nombre}` : ''}</span>
              )}
            </div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{textAlign:"right",lineHeight:1.25}}>
            <div style={{fontSize:13,fontWeight:600}}>{cu.nombre}</div>
            <div style={{fontSize:11,color:rl(cu).c,fontWeight:600}}>{rl(cu).l}</div>
          </div>
          <button onClick={onCerrarSesion} style={btnGhost}>Salir</button>
        </div>
      </header>

      <nav style={{
        background:"var(--bg-surface)",borderBottom:"1px solid var(--border)",
        padding:"0 24px",display:"flex",gap:2,overflowX:"auto",
        position:"sticky",top:0,zIndex:50
      }}>
        {tabsVisibles.map(t=>{
          const act = tab===t.k
          const n   = t.badge ? ((pend?.hhee||0)+(pend?.ausencias||0)) : 0
          return (
            <button key={t.k} onClick={()=>setTab(t.k)} aria-current={act?"page":undefined} style={{
              padding:"13px 18px",border:"none",background:"transparent",
              borderBottom:`2px solid ${act?"var(--accent)":"transparent"}`,
              color:act?"var(--accent)":"var(--text)",
              fontWeight:act?650:500,fontSize:13.5,cursor:"pointer",
              display:"flex",alignItems:"center",gap:7,whiteSpace:"nowrap",
              transition:"color .12s"
            }}>
              {t.l}
              {n>0 && (
                <span title={`${pend.hhee} horas extra · ${pend.ausencias} ausencias`} style={{
                  fontSize:10.5,fontWeight:800,minWidth:18,padding:"1px 6px",borderRadius:10,
                  background:"var(--danger,#B42318)",color:"#fff",
                  fontVariantNumeric:"tabular-nums",lineHeight:"15px",textAlign:"center"
                }}>{n>999?'999+':n}</span>
              )}
            </button>
          )
        })}
      </nav>

      <main style={{padding:24}}>
        {contenido}
      </main>
    </div>
  )
}

const btnSec   = {padding:"8px 12px",background:"var(--bg-card)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:500}
const btnGhost = {padding:"8px 14px",background:"transparent",color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13}
