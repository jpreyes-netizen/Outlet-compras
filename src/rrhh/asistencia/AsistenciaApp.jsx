// src/rrhh/asistencia/AsistenciaApp.jsx
// 5 tabs: Dashboard | Registros | Análisis | HHEE | Config
// HHEE v2: validación de horas extras con autorización de jefatura
// Eliminados: AsisMarcaciones, AsisPermisos, AsisJornadas, AsisExtrasAtrasos

import { useState, useEffect } from 'react'
import { can, userScope } from '../../core/permisos'
import { supabase } from '../../supabase'
import { AsisConfig }    from './config/AsisConfig'
import { AsisDashboard } from './tabs/AsisDashboard'
import { AsisRegistros } from './tabs/AsisRegistros'
import { AsisAnalisis }  from './tabs/AsisAnalisis'
import { AsisHHEE }      from './tabs/AsisHHEE'
import { AsisDotacion }  from './tabs/AsisDotacion'
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
  { k:"dotacion",  l:"Dotación"           },
  { k:"config",    l:"Configuración"      },
]

export function AsistenciaApp({ cu, onVolverHubRrhh, onCerrarSesion }) {
  const [tab, setTab] = useState(() => {
    try {
      if (deepLink?.modulo === 'asistencia' && deepLink?.tab) return deepLink.tab
      return localStorage.getItem("asis_tab")||"dashboard"
    } catch { return "dashboard" }
  })

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

  useEffect(() => {
    let cancel = false
    async function resolver() {
      try {
        const s   = await can(cu, 'rrhh', 'rrhh.asistencia')
        const suc = await userScope(cu, 'rrhh', 'rrhh.asistencia')
        if (cancel) return
        // Roles legado sin matriz (admin/dir_general/dir_finanzas) → acceso total
        const esLegado = ['admin','dir_general','dir_finanzas'].includes(cu?.rol)
        setScope(s === false && esLegado ? 'all' : s)
        setScopeSuc(suc || null)
        if (!suc) { setSucNombre(null); return }
        try {
          const { data } = await supabase.from('sucursales')
            .select('nombre').eq('id', suc).maybeSingle()
          if (!cancel) setSucNombre(data?.nombre || suc)
        } catch { if (!cancel) setSucNombre(suc) }
      } catch {
        if (!cancel) { setScope(false); setScopeSuc(null); setSucNombre(null) }
      }
    }
    resolver()
    return () => { cancel = true }
  }, [cu?.id])

  // ─── Pendientes de validación · alimenta el contador de la pestaña ────────
  // Señal de navegación: el usuario ve cuánto le falta sin entrar a buscarlo.
  // Misma definición que el informe por correo: HHEE de los últimos 30 días
  // sin decisión de jefatura + ausencias con turno sin gestionar.
  const [pend, setPend] = useState(null)   // { hhee, ausencias }
  async function cargarPendientes() {
    try {
      const d30 = new Date(); d30.setDate(d30.getDate() - 30)
      const desde = d30.toISOString().slice(0, 10)
      const hasta = new Date().toISOString().slice(0, 10)
      let qH = supabase.from('v_asis_jornadas').select('cod_contaline,fecha')
        .gt('min_extra_dia', 0).gte('fecha', desde).lte('fecha', hasta).limit(20000)
      let qA = supabase.from('v_asis_jornadas').select('cod_contaline,fecha')
        .eq('estado_dia', 'sin_marcas').gte('fecha', desde).lte('fecha', hasta).limit(20000)
      if (scopeSuc) { qH = qH.eq('sucursal_id', scopeSuc); qA = qA.eq('sucursal_id', scopeSuc) }
      const [jh, ja, vals, ges] = await Promise.all([
        qH, qA,
        supabase.from('asis_hhee_validaciones').select('cod_contaline,fecha')
          .eq('activo', true).gte('fecha', desde).limit(20000),
        supabase.from('asis_ausencias').select('cod_contaline,fecha')
          .gte('fecha', desde).limit(20000),
      ])
      const k = r => `${r.cod_contaline}|${r.fecha}`
      const vSet = new Set((vals.data || []).map(k))
      const gSet = new Set((ges.data || []).map(k))
      setPend({
        hhee: (jh.data || []).filter(r => !vSet.has(k(r))).length,
        ausencias: (ja.data || []).filter(r => !gSet.has(k(r))).length,
      })
    } catch { setPend(null) }
  }
  useEffect(() => { if (scope && scope !== false) cargarPendientes() }, [scope, scopeSuc, tab])

  const restringido  = scope === 'sucursal' || scope === 'propio'
  const [puedeDotacion, setPuedeDotacion] = useState(false)
  useEffect(() => {
    can(cu, 'rrhh', 'rrhh.dotacion')
      .then(s => setPuedeDotacion(s !== false && s != null))
      .catch(() => setPuedeDotacion(['admin','dir_general'].includes(cu?.rol)))
  }, [cu?.id])
  const tabsVisibles = TABS.filter(t =>
    (t.k !== 'config' || !restringido) && (t.k !== 'dotacion' || puedeDotacion))

  // Si el usuario restringido quedó en Config (localStorage), rebotar a dashboard
  useEffect(() => {
    if (restringido && tab === 'config') setTab('dashboard')
    if (tab === 'dotacion' && !puedeDotacion) setTab('dashboard')
  }, [restringido, tab])

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
                }}>Solo {sucNombre}</span>
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
        {tab==="dashboard" && <AsisDashboard cu={cu} onIrASync={irASync} onNavegar={navegar} scopeSuc={scopeSuc} pend={pend}/>}
        {tab==="registros" && <AsisRegistros cu={cu} onIrASync={irASync} scopeSuc={scopeSuc}/>}
        {tab==="analisis"  && <AsisAnalisis  cu={cu} onIrASync={irASync} onNavegar={navegar} scopeSuc={scopeSuc}/>}
        {tab==="hhee"      && <AsisHHEE      cu={cu} scopeSuc={scopeSuc} initDominio={hheeInit?.dominio} initCat={hheeInit?.cat} onCambio={cargarPendientes}/>}
        {tab==="config"    && !restringido && <AsisConfig cu={cu}/>}
        {tab==="dotacion"  && puedeDotacion && <AsisDotacion cu={cu}/>}
      </main>
    </div>
  )
}

const btnSec   = {padding:"8px 12px",background:"var(--bg-card)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:500}
const btnGhost = {padding:"8px 14px",background:"transparent",color:"var(--text-muted)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13}
