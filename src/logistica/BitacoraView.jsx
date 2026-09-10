// ═══════════════════════════════════════════════════════════════════════════
// BitacoraView.jsx — Bitácora diaria de operaciones
// Outlet de Puertas · Módulo Logística
//
// Tres vistas según rol:
//   DÍA          captura del checklist + dotación + tareas, con contraste
//                declarado vs sistema (picking/recepciones/mermas/inventarios)
//   HISTÓRICO    worklist de bitácoras por bodega, con validación (jefe/director)
//   CUMPLIMIENTO grilla semanal tipo tablero + motivos de incumplimiento
//
// Tablas: log_bitacora, log_bitacora_lineas, log_bitacora_linea_trab,
//         log_bitacora_turnos, log_bit_actividades, log_bit_temas,
//         log_bit_motivos, log_bit_actividad_sucursal
// Vistas: v_log_bit_checklist, v_log_bit_operarios,
//         v_log_bit_turno_sugerido, v_log_bitacora_resumen
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { css } from './ui_compartida.jsx'

// ── Paleta institucional (misma del módulo Inventario) ──────────────────────
const BV = {
  navy:'#16213E', ink:'#1C1C1E', slate:'#6E6E73', line:'#DADADF', lineSoft:'#ECECEF',
  rojo:'#B42318', verde:'#1E7A44', ambar:'#B25E09', azul:'#175CD3',
  bgHead:'#F4F4F6', bgHover:'#F7F7F9',
}

const AVANCES = [
  {k:'REALIZADO',    l:'Realizado',    c:BV.verde},
  {k:'PARCIAL',      l:'Parcial',      c:BV.ambar},
  {k:'NO_REALIZADO', l:'No realizado', c:BV.rojo},
  {k:'NO_APLICA',    l:'No aplica',    c:BV.slate},
]
const TURNOS = [
  {k:'COMPLETO', l:'Completo'}, {k:'MANANA', l:'Mañana'},
  {k:'TARDE',    l:'Tarde'},    {k:'NOCHE',  l:'Noche'}, {k:'PARCIAL', l:'Parcial'},
]
const PRESENCIAS = [
  {k:'PRESENTE',          l:'Presente',        c:BV.verde},
  {k:'AUSENTE',           l:'Ausente',         c:BV.rojo},
  {k:'PERMISO',           l:'Permiso',         c:BV.ambar},
  {k:'VACACIONES',        l:'Vacaciones',      c:BV.azul},
  {k:'LICENCIA',          l:'Licencia',        c:BV.azul},
  {k:'APOYO_OTRA_BODEGA', l:'Apoyo en otra',   c:BV.slate},
]
const CAT_CHECKS = [
  {k:'ordenada',         l:'ORDEN',      d:'Producto apilado y alineado según estándar'},
  {k:'en_ubicacion',     l:'UBICACIÓN',  d:'Lo físico corresponde al layout asignado'},
  {k:'etiquetada',       l:'ETIQUETADO', d:'Etiquetas de SKU y precio visibles y correctas'},
  {k:'sin_danos',        l:'SIN DAÑOS',  d:'Sin embalajes rotos, cajas vacías ni producto dañado a la vista'},
  {k:'acceso_despejado', l:'ACCESO',     d:'Pasillo y frente de la categoría despejados'},
]
// Guía de llenado — ejemplos tomados de la operación real de las bodegas
const GUIA = {
  checklist: {
    t:'Cómo registrar las actividades',
    p:[
      'Una fila por actividad del turno. El tema precisa dónde o sobre qué se trabajó: "Orden" no dice nada, "Orden — Bodega importaciones" sí.',
      'Marca el avance con un clic. Si quedó Parcial o No realizado, el motivo es obligatorio: es el dato que después muestra qué frena la operación mes a mes.',
      'Asigna operarios tocando sus nombres. Sirve para ver carga de trabajo real, no para controlar a nadie.',
      'Usa "No aplica" cuando la actividad no correspondía ese día, no cuando se olvidó. Un olvido es "No realizado".',
    ],
    ej:[
      ['Bien', 'Cambios de pallets — Paneles acústicos — Parcial — Falta de insumos — Andrés G., Mauricio V.'],
      ['Mal',  'Cambios de pallets — (sin tema) — Parcial — (sin motivo)'],
    ],
  },
  turnos: {
    t:'Cómo registrar la dotación',
    p:[
      'El turno programado lo trae Workera. Solo corrige si el día fue distinto a lo planificado.',
      'Si alguien no estuvo presente, la observación es obligatoria: quién lo reemplazó o cómo se cubrió el trabajo.',
      'Las horas extra que anotes acá son declarativas y sirven para anticipar el mes. Las que se pagan son las que valida RRHH desde la marcación.',
      'Si vino alguien de otra bodega a apoyar, márcalo en su bodega de origen como "Apoyo en otra".',
    ],
    ej:[
      ['Bien', 'Pedro Maraboli — Turno mañana — Ausente — Licencia médica, lo cubrió Sebastián R.'],
      ['Mal',  'Pedro Maraboli — Ausente — (sin observación)'],
    ],
  },
  cierre: {
    t:'Cómo hacer el cierre de bodega',
    p:[
      'Es un recorrido físico al terminar el turno, categoría por categoría. Toma unos minutos y es lo que evita que el desorden se acumule sin que nadie lo note.',
      'Si la categoría está bien en los cinco puntos, usa "Todo OK" y sigue. Solo detente en lo que está mal.',
      'Cada observación exige nota concreta: "3 pallets de Wall Panel en el pasillo" sirve; "desordenado" no.',
      'Lo observado se arrastra día a día hasta que vuelva a quedar todo OK. En Cumplimiento vas a ver cuántos días lleva cada cosa sin resolverse.',
      'Si no alcanzaste a revisar una categoría, márcala N/R y di por qué. Es preferible al OK falso.',
    ],
    ej:[
      ['Bien', 'Wall Panel — Orden OBS, Acceso OBS — "Cajas vacías apiladas frente al rack, sin espacio para contar"'],
      ['Mal',  'Wall Panel — Orden OBS — "está desordenado"'],
    ],
  },
  tareas: {
    t:'Cómo usar las tareas',
    p:[
      'Toda actividad incumplida puede convertirse en tarea con un clic desde la pestaña Actividades: queda con el motivo como título y ligada a la bitácora del día.',
      'Ponle fecha límite. Sin fecha, la tarea no aparece como vencida y nadie la persigue.',
      'Asígnala a una persona. Una tarea de todos es una tarea de nadie.',
      'Las vencidas viajan en el reporte diario al director de operaciones.',
    ],
    ej:[
      ['Bien', 'ALTA — "Reponer zunchos para cambio de pallets" — límite mañana — Pablo Olivares'],
      ['Mal',  'NORMAL — "Ver tema pallets" — sin límite — sin asignar'],
    ],
  },
}

function GuiaPanel({seccion, abierto, onToggle}) {
  const g = GUIA[seccion]
  if (!g) return null
  return (
    <div style={{border:`1px solid ${BV.line}`, borderRadius:4, marginBottom:12,
      background:abierto ? '#FBFBFC' : '#fff'}}>
      <div onClick={onToggle} style={{display:'flex', alignItems:'center', gap:8, padding:'7px 12px',
        cursor:'pointer', userSelect:'none'}}>
        <span style={{fontSize:10, fontWeight:800, letterSpacing:0.6, color:BV.navy,
          border:`1px solid ${BV.navy}`, borderRadius:2, padding:'1px 5px'}}>?</span>
        <span style={{fontSize:11.5, fontWeight:700, color:BV.ink}}>{g.t}</span>
        <span style={{marginLeft:'auto', fontSize:10.5, fontWeight:700, color:BV.slate}}>
          {abierto ? 'OCULTAR' : 'VER GUÍA'}
        </span>
      </div>
      {abierto && (
        <div style={{padding:'2px 14px 12px', borderTop:`1px solid ${BV.lineSoft}`}}>
          <ul style={{margin:'10px 0 12px', paddingLeft:18, fontSize:12, color:BV.ink, lineHeight:1.65}}>
            {g.p.map((x,i)=><li key={i} style={{marginBottom:4}}>{x}</li>)}
          </ul>
          {g.ej.map(([tipo, txt]) => (
            <div key={tipo} style={{display:'flex', gap:8, alignItems:'flex-start', marginBottom:5}}>
              <span style={{fontSize:9.5, fontWeight:800, letterSpacing:0.5, minWidth:34,
                textAlign:'center', borderRadius:2, padding:'2px 4px', marginTop:1,
                color: tipo==='Bien' ? BV.verde : BV.rojo,
                border:`1px solid ${(tipo==='Bien'?BV.verde:BV.rojo)}55`}}>
                {tipo==='Bien' ? 'SÍ' : 'NO'}
              </span>
              <span style={{fontSize:11.5, color: tipo==='Bien' ? BV.ink : BV.slate,
                fontStyle: tipo==='Bien' ? 'normal' : 'italic'}}>{txt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const ESTADOS_BIT = {
  BORRADOR:  {l:'BORRADOR',  c:BV.slate},
  ENVIADO:   {l:'ENVIADO',   c:BV.azul},
  VALIDADO:  {l:'VALIDADO',  c:BV.verde},
  OBSERVADO: {l:'OBSERVADO', c:BV.rojo},
}
const BODEGAS = [
  {k:'cd_mp', l:'CD Maipú'}, {k:'lg', l:'La Granja'},
  {k:'mp',    l:'Tienda Maipú'}, {k:'la', l:'Los Ángeles'},
]

const hoyISO  = () => new Date().toLocaleDateString('en-CA', {timeZone:'America/Santiago'})
const fmtF    = d => d ? new Date(d+'T12:00:00').toLocaleDateString('es-CL',
  {weekday:'long', day:'numeric', month:'long'}) : ''

const bvBtn = v => ({
  fontFamily:'inherit', fontSize:11, fontWeight:700, letterSpacing:0.6, cursor:'pointer',
  padding:'8px 14px', borderRadius:3, transition:'all .12s', whiteSpace:'nowrap',
  ...(v==='solid'   ? {background:BV.navy, color:'#fff', border:`1px solid ${BV.navy}`}
    : v==='danger'  ? {background:'#fff', color:BV.rojo, border:`1px solid ${BV.rojo}70`}
    : v==='outline' ? {background:'#fff', color:BV.navy, border:`1px solid ${BV.line}`}
    :                 {background:'transparent', color:BV.slate, border:'1px solid transparent'}),
})
const bvInput = w => ({
  fontFamily:'inherit', fontSize:12, color:BV.ink, background:'#fff',
  border:`1px solid ${BV.line}`, borderRadius:3, padding:'6px 9px', width:w, outline:'none',
})
const tdS = {padding:'8px 12px', verticalAlign:'top', color:BV.ink, fontSize:12.5}
const thS = num => ({
  padding:'8px 12px', textAlign:num?'right':'left', fontSize:10, fontWeight:700,
  letterSpacing:0.6, color:BV.slate, textTransform:'uppercase', whiteSpace:'nowrap',
  borderBottom:`1px solid ${BV.line}`,
})

// Panel de ayuda plegable: se abre una vez, el jefe lo cierra y no molesta más
function BvGuia({titulo, children, id}) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div style={{marginBottom:10}}>
      <div onClick={()=>setAbierto(v=>!v)}
        style={{display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer',
          fontSize:10.5, fontWeight:700, letterSpacing:0.6, color:BV.azul, userSelect:'none'}}>
        <span style={{display:'inline-flex', alignItems:'center', justifyContent:'center',
          width:14, height:14, borderRadius:'50%', border:`1.5px solid ${BV.azul}`,
          fontSize:9, fontWeight:800}}>?</span>
        {abierto ? 'OCULTAR GUÍA' : (titulo || 'CÓMO SE LLENA')}
      </div>
      {abierto && (
        <div style={{marginTop:8, padding:'12px 14px', background:'#F7F9FC',
          border:`1px solid ${BV.line}`, borderLeft:`3px solid ${BV.azul}`, borderRadius:3,
          fontSize:11.5, lineHeight:1.65, color:BV.ink}}>
          {children}
        </div>
      )}
    </div>
  )
}
const Ej = ({children}) => (
  <div style={{margin:'4px 0 0 0', padding:'5px 9px', background:'#fff',
    border:`1px solid ${BV.line}`, borderRadius:2, fontSize:11, color:BV.slate}}>
    <strong style={{color:BV.ink, fontWeight:700}}>Ejemplo: </strong>{children}
  </div>
)

function BvKpi({label, value, sub, c=BV.ink}) {
  return (
    <div style={{padding:'10px 18px', borderRight:`1px solid ${BV.lineSoft}`, minWidth:118, flex:'1 0 auto'}}>
      <div style={{fontSize:10, fontWeight:700, letterSpacing:0.7, color:BV.slate, textTransform:'uppercase'}}>{label}</div>
      <div style={{fontSize:21, fontWeight:800, color:c, letterSpacing:-0.3, fontVariantNumeric:'tabular-nums', marginTop:2}}>{value}</div>
      {sub ? <div style={{fontSize:10.5, color:BV.slate, marginTop:1}}>{sub}</div> : null}
    </div>
  )
}
function BvPunto({estado}) {
  const e = ESTADOS_BIT[estado] || ESTADOS_BIT.BORRADOR
  return (
    <span style={{display:'inline-flex', alignItems:'center', gap:6, fontSize:10.5,
      fontWeight:700, letterSpacing:0.4, color:e.c, whiteSpace:'nowrap'}}>
      <span style={{width:7, height:7, borderRadius:'50%', background:e.c, flexShrink:0}}/>{e.l}
    </span>
  )
}
// Selector segmentado: reemplaza el <select> de avance para que se marque en un clic
function BvSeg({opciones, valor, onChange, ancho}) {
  return (
    <div style={{display:'inline-flex', border:`1px solid ${BV.line}`, borderRadius:3, overflow:'hidden'}}>
      {opciones.map(o=>(
        <div key={o.k} onClick={()=>onChange(o.k===valor?null:o.k)}
          style={{padding:'5px 10px', fontSize:10.5, fontWeight:700, letterSpacing:0.3,
            cursor:'pointer', whiteSpace:'nowrap', minWidth:ancho, textAlign:'center',
            borderRight:`1px solid ${BV.lineSoft}`,
            background:valor===o.k ? (o.c||BV.navy) : '#fff',
            color:valor===o.k ? '#fff' : BV.slate, transition:'all .1s'}}>
          {o.l}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
export default function BitacoraView({cu, sucs = [], onBack}) {
  const rol = cu?.rol || ''
  const esGlobal = ['admin','jefe_bodega','director'].includes(rol)
  const sucPropia = cu?.sucursal_codigo || null

  const bodegasVisibles = useMemo(() => {
    if (esGlobal) return BODEGAS
    const padre = sucs.find(s=>s.codigo===sucPropia)?.codigo_padre || sucPropia
    return BODEGAS.filter(b=>b.k===padre || b.k===sucPropia)
  }, [esGlobal, sucPropia, sucs])

  const [vista,   setVista]   = useState('dia')
  const [bodega,  setBodega]  = useState(bodegasVisibles[0]?.k || 'cd_mp')
  const [fecha,   setFecha]   = useState(hoyISO())
  const [msg,     setMsg]     = useState(null)

  const flash = (tipo, texto) => { setMsg({tipo, texto}); setTimeout(()=>setMsg(null), 4000) }

  const TABS = [
    {k:'dia',    l:'DÍA'},
    {k:'hist',   l:'HISTÓRICO'},
    {k:'cumpl',  l:'CUMPLIMIENTO'},
    {k:'riesgo', l:'PRIORIDAD DE INVENTARIO'},
  ]

  return (
    <div style={css.body}>
      {/* Header */}
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-end',
        flexWrap:'wrap', gap:10, marginBottom:12}}>
        <div>
          <div style={{fontSize:10.5, fontWeight:700, letterSpacing:1.2, color:BV.slate, textTransform:'uppercase'}}>
            Logística · Operaciones
          </div>
          <div style={{fontSize:21, fontWeight:800, color:BV.ink, letterSpacing:-0.3, marginTop:2}}>
            Bitácora diaria
          </div>
        </div>
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          {bodegasVisibles.length > 1 && (
            <select style={bvInput(150)} value={bodega} onChange={e=>setBodega(e.target.value)}>
              {bodegasVisibles.map(b=><option key={b.k} value={b.k}>{b.l}</option>)}
            </select>
          )}
          {vista==='dia' && (
            <input type="date" style={bvInput(140)} value={fecha}
              onChange={e=>setFecha(e.target.value)} max={hoyISO()}/>
          )}
          {onBack && <button onClick={onBack} style={bvBtn('ghost')}>← VOLVER</button>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex', gap:26, borderBottom:`1px solid ${BV.line}`, marginBottom:14}}>
        {TABS.map(t=>(
          <div key={t.k} onClick={()=>setVista(t.k)}
            style={{padding:'8px 2px 9px', cursor:'pointer', fontSize:12, fontWeight:700,
              letterSpacing:0.8, color:vista===t.k?BV.ink:BV.slate,
              borderBottom:vista===t.k?`2px solid ${BV.navy}`:'2px solid transparent',
              marginBottom:-1, userSelect:'none'}}>
            {t.l}
          </div>
        ))}
      </div>

      {msg && (
        <div style={{padding:'8px 14px', marginBottom:12, borderRadius:3, fontSize:12, fontWeight:600,
          background: msg.tipo==='ok' ? '#F0F7F3' : '#FCF3F1',
          border: `1px solid ${msg.tipo==='ok' ? BV.verde : BV.rojo}40`,
          borderLeft: `3px solid ${msg.tipo==='ok' ? BV.verde : BV.rojo}`,
          color: msg.tipo==='ok' ? BV.verde : BV.rojo}}>
          {msg.texto}
        </div>
      )}

      {vista==='dia'   && <VistaDia    cu={cu} bodega={bodega} fecha={fecha} flash={flash} esGlobal={esGlobal}/>}
      {vista==='hist'  && <VistaHist   cu={cu} bodega={bodega} flash={flash} esGlobal={esGlobal}
                                       onAbrir={(f)=>{setFecha(f); setVista('dia')}}/>}
      {vista==='cumpl'  && <VistaCumpl bodegas={bodegasVisibles}/>}
      {vista==='riesgo' && <VistaRiesgo bodegas={bodegasVisibles} esGlobal={esGlobal} bodega={bodega}/>}
    </div>
  )
}

// ═══════════════════════ VISTA DÍA — captura ═══════════════════════════════
function VistaDia({cu, bodega, fecha, flash, esGlobal}) {
  const [loading, setLoading]   = useState(true)
  const [guardando, setGuard]   = useState(false)
  const [bit, setBit]           = useState(null)
  const [checklist, setCheck]   = useState([])
  const [lineas, setLineas]     = useState({})   // actividad_codigo → {tema, avance, motivo, observacion, trabajadores:[]}
  const [operarios, setOper]    = useState([])
  const [turnos, setTurnos]     = useState({})   // trabajador_id → {turno, presencia, hh_extra, observacion}
  const [motivos, setMotivos]   = useState([])
  const [obsGeneral, setObsGen] = useState('')
  const [secc, setSecc]         = useState('checklist')
  const [sist, setSist]         = useState(null)   // actividad real del WMS ese día
  const [tareas, setTareas]     = useState([])
  const [nuevaTarea, setNT]     = useState(null)   // {titulo, prioridad, fecha_limite, trabajador_id, origen}
  const [guia, setGuia]         = useState(false)
  const [riesgo, setRiesgo]     = useState([])     // inventarios próximos sobre categoría observada
  const [catCats, setCatCats]   = useState([])     // catálogo de categorías de la bodega
  const [catChecks, setCatChk]  = useState({})     // categoria → {5 checks, no_revisada, observacion}

  const bitId = `BIT-${bodega.toUpperCase()}-${fecha.replace(/-/g,'')}`
  const cerrada = bit?.estado === 'VALIDADO' && !esGlobal

  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [bodega, fecha])

  async function cargar() {
    setLoading(true)
    try {
      const [chk, ops, mot, cab, ccat] = await Promise.all([
        supabase.from('v_log_bit_checklist').select('*').eq('sucursal_codigo', bodega).order('orden'),
        supabase.from('v_log_bit_turno_sugerido').select('*').eq('bodega_codigo', bodega),
        supabase.from('log_bit_motivos').select('motivo').eq('activo', true).order('orden'),
        supabase.from('log_bitacora').select('*').eq('id', bitId).maybeSingle(),
        supabase.from('log_bit_check_categorias').select('categoria, orden').eq('sucursal_codigo', bodega)
          .eq('activo', true).order('orden'),
      ])
      setCatCats((ccat.data || []).map(c => c.categoria))
      setCheck(chk.data || [])
      setOper((ops.data || []).sort((a,b)=>a.nombre_completo.localeCompare(b.nombre_completo)))
      setMotivos((mot.data || []).map(m=>m.motivo))
      setBit(cab.data || null)
      setObsGen(cab.data?.observacion || '')

      const baseL = {}
      ;(chk.data || []).forEach(c => {
        baseL[c.actividad_codigo] = {tema:'', avance:null, motivo:'', observacion:'', trabajadores:[]}
      })
      const baseT = {}
      ;(ops.data || []).forEach(o => {
        baseT[o.trabajador_id] = {
          turno:'COMPLETO', presencia:'PRESENTE', hh_extra:0, observacion:'',
          sugerido:o.turno_workera || null,
        }
      })

      const baseC = {}
      ;(ccat.data || []).forEach(c => {
        baseC[c.categoria] = {ordenada:null, en_ubicacion:null, etiquetada:null,
          sin_danos:null, acceso_despejado:null, no_revisada:false, observacion:''}
      })

      if (cab.data) {
        const [lin, tur, cck] = await Promise.all([
          supabase.from('log_bitacora_lineas').select('*, log_bitacora_linea_trab(trabajador_id)').eq('bitacora_id', bitId),
          supabase.from('log_bitacora_turnos').select('*').eq('bitacora_id', bitId),
          supabase.from('log_bitacora_cat_check').select('*').eq('bitacora_id', bitId),
        ])
        ;(cck.data || []).forEach(k => {
          if (baseC[k.categoria]) baseC[k.categoria] = {
            ordenada:k.ordenada, en_ubicacion:k.en_ubicacion, etiquetada:k.etiquetada,
            sin_danos:k.sin_danos, acceso_despejado:k.acceso_despejado,
            no_revisada:!!k.no_revisada, observacion:k.observacion || '',
          }
        })
        ;(lin.data || []).forEach(l => {
          baseL[l.actividad_codigo] = {
            tema:l.tema || '', avance:l.avance, motivo:l.motivo || '',
            observacion:l.observacion || '',
            trabajadores:(l.log_bitacora_linea_trab || []).map(t=>t.trabajador_id),
          }
        })
        ;(tur.data || []).forEach(t => {
          if (baseT[t.trabajador_id]) baseT[t.trabajador_id] = {
            ...baseT[t.trabajador_id], turno:t.turno, presencia:t.presencia,
            hh_extra:Number(t.hh_extra) || 0, observacion:t.observacion || '',
          }
        })
      }
      setLineas(baseL)
      setTurnos(baseT)
      setCatChk(baseC)
      cargarSistema()
      cargarTareas()
      cargarRiesgo()
    } catch (e) {
      flash('error', 'No se pudo cargar la bitácora: ' + e.message)
    }
    setLoading(false)
  }

  // ── Actividad real registrada en el WMS ese día (contexto + contraste) ──
  async function cargarSistema() {
    try {
      const d0 = `${fecha}T00:00:00-03:00`, d1 = `${fecha}T23:59:59-03:00`
      const [rec, pick, repo, mer, inv] = await Promise.all([
        supabase.from('log_recepciones').select('id', {count:'exact', head:true})
          .eq('sucursal_codigo', bodega).gte('created_at', d0).lte('created_at', d1),
        supabase.from('log_picking_ordenes').select('id, estado')
          .eq('sucursal_codigo', bodega).gte('created_at', d0).lte('created_at', d1).limit(500),
        bodega === 'cd_mp'
          ? supabase.from('log_solicitudes_reposicion').select('id', {count:'exact', head:true})
              .gte('fecha_despacho', d0).lte('fecha_despacho', d1)
          : supabase.from('log_solicitudes_reposicion').select('id', {count:'exact', head:true})
              .eq('sucursal_codigo', bodega).gte('created_at', d0).lte('created_at', d1),
        supabase.from('log_mermas').select('id', {count:'exact', head:true})
          .eq('sucursal_codigo', bodega).eq('fecha', fecha),
        supabase.from('log_inv_cabeceras').select('id, estado, fecha_planificada')
          .eq('sucursal_codigo', bodega).neq('estado', 'CERRADO').eq('es_prueba', false).limit(50),
      ])
      const picks = pick.data || []
      setSist({
        recepciones: rec.count || 0,
        pickings: picks.length,
        pickingsCerrados: picks.filter(p => ['ENTREGADO','CERRADO','COMPLETADO'].includes(p.estado)).length,
        reposiciones: repo.count || 0,
        mermas: mer.count || 0,
        invActivos: (inv.data || []).length,
        invDelDia: (inv.data || []).filter(i => i.fecha_planificada === fecha).length,
      })
    } catch (e) { setSist(null) }
  }

  async function cargarRiesgo() {
    const { data } = await supabase.from('v_log_bit_riesgo_inventario')
      .select('*').eq('sucursal_codigo', bodega).order('dias_para_conteo')
    setRiesgo(data || [])
  }

  async function cargarTareas() {
    const { data } = await supabase.from('log_tareas')
      .select('*, log_tarea_asignaciones(trabajador_id, estado)')
      .eq('sucursal_codigo', bodega).in('estado', ['PENDIENTE','EN_PROGRESO'])
      .order('prioridad').order('created_at', {ascending:false}).limit(100)
    setTareas(data || [])
  }

  async function crearTarea(t) {
    try {
      const id = `TAR-${bodega.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`
      const { error } = await supabase.from('log_tareas').insert({
        id, titulo:t.titulo, descripcion:t.descripcion || null,
        prioridad:t.prioridad || 'NORMAL', estado:'PENDIENTE',
        sucursal_codigo:bodega, origen_bitacora:t.origen || null,
        fecha_limite:t.fecha_limite || null,
        creado_por:cu?.id || null, creado_nombre:cu?.nombre || null,
      })
      if (error) throw error
      if (t.trabajador_id) {
        await supabase.from('log_tarea_asignaciones').insert({tarea_id:id, trabajador_id:t.trabajador_id})
      }
      flash('ok', 'Tarea creada.')
      setNT(null); cargarTareas()
    } catch (e) { flash('error', 'No se pudo crear la tarea: ' + e.message) }
  }

  async function cerrarTarea(id) {
    const { error } = await supabase.from('log_tareas')
      .update({estado:'COMPLETADA', cerrado_at:new Date().toISOString()}).eq('id', id)
    if (error) flash('error', error.message); else { flash('ok', 'Tarea completada.'); cargarTareas() }
  }

  // ── Cierre de bodega ──
  const setCk = (cat, campo, val) => setCatChk(p => ({...p, [cat]:{...p[cat], [campo]:val}}))
  const catCompleta = k => k && (k.no_revisada
    ? !!(k.observacion || '').trim()
    : CAT_CHECKS.every(c => k[c.k]))
  const catObservada = k => k && !k.no_revisada && CAT_CHECKS.some(c => k[c.k] === 'OBSERVADO')
  const cierreRev = catCats.filter(c => catCompleta(catChecks[c])).length
  const cierreObs = catCats.filter(c => catObservada(catChecks[c])).length

  // ── Contraste declarado vs sistema (patrón cuadratura) ──
  const contrasteDe = (act, l) => {
    if (!sist || !l?.avance) return null
    const temaEsNo = (l.tema || '').toLowerCase().startsWith('sin')
    if (act === 'RECEPCION') {
      if ((temaEsNo || l.avance === 'NO_APLICA') && sist.recepciones > 0)
        return {t:`El WMS registra ${sist.recepciones} recepción(es) hoy`, sev:'alto'}
      if (l.avance === 'REALIZADO' && !temaEsNo && sist.recepciones === 0)
        return {t:'Sin recepciones registradas en el WMS', sev:'info'}
    }
    if (act === 'DESPACHO' && (temaEsNo || l.avance === 'NO_APLICA') && sist.pickings > 0)
      return {t:`El WMS registra ${sist.pickings} órdenes de picking hoy`, sev:'alto'}
    if (act === 'REPOSICIONES' && (temaEsNo || l.avance === 'NO_APLICA') && sist.reposiciones > 0)
      return {t:`Hay ${sist.reposiciones} solicitud(es) de reposición del día`, sev:'alto'}
    if (act === 'INV_CICLICO' && l.avance === 'NO_APLICA' && sist.invDelDia > 0)
      return {t:`Hay ${sist.invDelDia} inventario(s) planificados hoy en la app`, sev:'alto'}
    return null
  }
  const contrastesAltos = checklist
    .map(c => contrasteDe(c.actividad_codigo, lineas[c.actividad_codigo]))
    .filter(x => x && x.sev === 'alto').length

  // ── Informe del día (para WhatsApp / correo a dirección) ──
  function copiarInforme() {
    const bn = BODEGAS.find(b=>b.k===bodega)?.l || bodega
    const inc = checklist.filter(c => ['PARCIAL','NO_REALIZADO'].includes(lineas[c.actividad_codigo]?.avance))
    const nom = tid => (operarios.find(o=>o.trabajador_id===tid)?.nombre_completo || '').split(' ').slice(0,2).join(' ')
    const L = []
    L.push(`BITÁCORA ${bn.toUpperCase()} — ${fmtF(fecha)}`)
    L.push(`Estado: ${bit?.estado || 'BORRADOR'} · Responsable: ${bit?.responsable_nombre || cu?.nombre || '—'}`)
    L.push(`Actividades: ${completadas}/${checklist.length} · Dotación: ${presentes}/${operarios.length} presentes · HH extra: ${hhExtra.toFixed(1)}`)
    if (sist) L.push(`Sistema: ${sist.pickings} picking (${sist.pickingsCerrados} cerrados) · ${sist.recepciones} recepciones · ${sist.reposiciones} reposiciones · ${sist.mermas} mermas · ${sist.invActivos} inventarios activos`)
    if (inc.length) {
      L.push('', 'INCUMPLIMIENTOS')
      inc.forEach(c => {
        const l = lineas[c.actividad_codigo]
        L.push(`· ${c.actividad}${l.tema ? ` (${l.tema})` : ''}: ${l.avance === 'PARCIAL' ? 'Parcial' : 'No realizado'} — ${l.motivo || 'sin motivo'}${(l.trabajadores||[]).length ? ` [${l.trabajadores.map(nom).join(', ')}]` : ''}`)
      })
    } else L.push('', 'Sin incumplimientos.')
    const aus = operarios.filter(o => turnos[o.trabajador_id]?.presencia !== 'PRESENTE')
    if (aus.length) {
      L.push('', 'DOTACIÓN — NOVEDADES')
      aus.forEach(o => {
        const t = turnos[o.trabajador_id]
        L.push(`· ${o.nombre_completo}: ${(PRESENCIAS.find(p=>p.k===t.presencia)?.l || t.presencia)}${t.observacion ? ` — ${t.observacion}` : ''}`)
      })
    }
    const obsCats = catCats.filter(c => catObservada(catChecks[c]))
    const nrCats  = catCats.filter(c => catChecks[c]?.no_revisada)
    L.push('', `CIERRE DE BODEGA: ${cierreRev}/${catCats.length} categorías revisadas`)
    obsCats.forEach(c => {
      const k = catChecks[c]
      const pts = CAT_CHECKS.filter(x => k[x.k]==='OBSERVADO').map(x => x.l.toLowerCase()).join(', ')
      L.push(`· ${c}: OBSERVADA (${pts})${k.observacion ? ` — ${k.observacion}` : ''}`)
    })
    if (nrCats.length) L.push(`· No revisadas: ${nrCats.join(', ')}`)
    const abiertas = tareas.filter(t=>t.estado!=='COMPLETADA')
    if (abiertas.length) L.push('', `TAREAS ABIERTAS: ${abiertas.length}`,
      ...abiertas.slice(0,5).map(t=>`· [${t.prioridad}] ${t.titulo}${t.fecha_limite ? ` (límite ${t.fecha_limite})` : ''}`))
    if (obsGeneral) L.push('', `Obs.: ${obsGeneral}`)
    const txt = L.join('\n')
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(txt).then(
        () => flash('ok', 'Informe copiado al portapapeles.'),
        () => flash('error', 'No se pudo copiar.'))
    } else flash('error', 'El navegador no permite copiar automático.')
  }

  const setL = (act, campo, val) => setLineas(p => ({...p, [act]:{...p[act], [campo]:val}}))
  const setT = (tid, campo, val) => setTurnos(p => ({...p, [tid]:{...p[tid], [campo]:val}}))
  const toggleTrab = (act, tid) => setLineas(p => {
    const ya = p[act].trabajadores.includes(tid)
    return {...p, [act]:{...p[act],
      trabajadores: ya ? p[act].trabajadores.filter(x=>x!==tid) : [...p[act].trabajadores, tid]}}
  })

  // ── Validación previa: mismas reglas que los CHECK de la base ──
  const errores = useMemo(() => {
    const e = []
    checklist.forEach(c => {
      const l = lineas[c.actividad_codigo]
      if (!l || !l.avance) return
      if (['PARCIAL','NO_REALIZADO'].includes(l.avance) && !l.motivo)
        e.push(`${c.actividad} requiere motivo`)
      if (l.avance !== 'NO_APLICA' && !l.tema && (c.temas || []).length)
        e.push(`${c.actividad} requiere tema`)
    })
    const sinCierre = catCats.filter(c => !catCompleta(catChecks[c])).length
    if (sinCierre > 0) e.push(`Cierre de bodega: ${sinCierre} categoría(s) sin revisar`)
    catCats.forEach(c => {
      const k = catChecks[c]
      if (catObservada(k) && !(k.observacion || '').trim())
        e.push(`Cierre: ${c} observada requiere nota`)
    })
    Object.entries(turnos).forEach(([tid, t]) => {
      if (t.presencia !== 'PRESENTE' && !t.observacion) {
        const n = operarios.find(o=>o.trabajador_id===tid)?.nombre_completo || 'Operario'
        e.push(`${n}: indicar motivo de la ausencia`)
      }
    })
    return e
  }, [checklist, lineas, turnos, operarios])

  const completadas = checklist.filter(c => lineas[c.actividad_codigo]?.avance).length
  const presentes   = Object.values(turnos).filter(t => t.presencia === 'PRESENTE').length
  const hhExtra     = Object.values(turnos).reduce((s,t)=>s + (Number(t.hh_extra)||0), 0)

  async function guardar(nuevoEstado) {
    if (nuevoEstado !== 'BORRADOR' && errores.length) {
      flash('error', `Faltan datos: ${errores[0]}${errores.length>1?` (y ${errores.length-1} más)`:''}`)
      return
    }
    setGuard(true)
    try {
      const sucNombre = BODEGAS.find(b=>b.k===bodega)?.l || bodega
      const cab = {
        id:bitId, fecha, sucursal_codigo:bodega, estado:nuevoEstado,
        responsable_id:cu?.id || null, responsable_nombre:cu?.nombre || null,
        observacion:obsGeneral || null, created_by:cu?.nombre || null,
        updated_at:new Date().toISOString(),
      }
      if (nuevoEstado === 'VALIDADO') {
        cab.validado_por = cu?.id || null
        cab.validado_nombre = cu?.nombre || null
        cab.validado_at = new Date().toISOString()
      }
      const { error:e1 } = await supabase.from('log_bitacora').upsert(cab, {onConflict:'id'})
      if (e1) throw e1

      // Líneas: se reescriben completas para que borrar una asignación funcione
      await supabase.from('log_bitacora_lineas').delete().eq('bitacora_id', bitId)
      const filas = checklist
        .filter(c => lineas[c.actividad_codigo]?.avance)
        .map(c => {
          const l = lineas[c.actividad_codigo]
          return {
            bitacora_id:bitId, actividad_codigo:c.actividad_codigo,
            tema:l.tema || null, avance:l.avance,
            motivo:['PARCIAL','NO_REALIZADO'].includes(l.avance) ? (l.motivo || null) : null,
            observacion:l.observacion || null,
          }
        })
      if (filas.length) {
        const { data:ins, error:e2 } = await supabase.from('log_bitacora_lineas').insert(filas).select('id, actividad_codigo')
        if (e2) throw e2
        const asign = []
        ;(ins || []).forEach(row => {
          (lineas[row.actividad_codigo]?.trabajadores || []).forEach(tid =>
            asign.push({linea_id:row.id, trabajador_id:tid}))
        })
        if (asign.length) {
          const { error:e3 } = await supabase.from('log_bitacora_linea_trab').insert(asign)
          if (e3) throw e3
        }
      }

      // Cierre de bodega por categoría
      await supabase.from('log_bitacora_cat_check').delete().eq('bitacora_id', bitId)
      const filasC = catCats
        .filter(c => {
          const k = catChecks[c]
          return k && (k.no_revisada || CAT_CHECKS.some(x => k[x.k]))
        })
        .map(c => {
          const k = catChecks[c]
          return {
            bitacora_id:bitId, categoria:c,
            ordenada:k.ordenada, en_ubicacion:k.en_ubicacion, etiquetada:k.etiquetada,
            sin_danos:k.sin_danos, acceso_despejado:k.acceso_despejado,
            no_revisada:!!k.no_revisada,
            observacion:(k.observacion || '').trim() || null,
          }
        })
      if (filasC.length) {
        const { error:e5 } = await supabase.from('log_bitacora_cat_check').insert(filasC)
        if (e5) throw e5
      }

      // Turnos
      const filasT = Object.entries(turnos).map(([tid, t]) => ({
        bitacora_id:bitId, trabajador_id:tid, turno:t.turno, presencia:t.presencia,
        hh_extra:Number(t.hh_extra) || 0,
        observacion:t.presencia !== 'PRESENTE' ? (t.observacion || 'Sin detalle') : (t.observacion || null),
      }))
      if (filasT.length) {
        const { error:e4 } = await supabase.from('log_bitacora_turnos')
          .upsert(filasT, {onConflict:'bitacora_id,trabajador_id'})
        if (e4) throw e4
      }

      flash('ok', nuevoEstado === 'BORRADOR' ? 'Borrador guardado.'
          : nuevoEstado === 'ENVIADO' ? `Bitácora de ${sucNombre} enviada para validación.`
          : 'Bitácora validada.')
      cargar()
    } catch (e) {
      flash('error', 'No se pudo guardar: ' + e.message)
    }
    setGuard(false)
  }

  if (loading) return <div style={{padding:'30px 4px', color:BV.slate, fontSize:12.5}}>Cargando bitácora…</div>

  return (
    <>
      {/* Resumen del día */}
      <div style={{display:'flex', flexWrap:'wrap', border:`1px solid ${BV.line}`, borderRadius:4,
        background:'#fff', marginBottom:12, overflow:'hidden'}}>
        <BvKpi label="Fecha" value={fecha.slice(8,10)+'/'+fecha.slice(5,7)} sub={fmtF(fecha)}/>
        <BvKpi label="Estado" value={<BvPunto estado={bit?.estado || 'BORRADOR'}/>}
               sub={bit?.responsable_nombre || 'sin registrar'}/>
        <BvKpi label="Actividades" value={`${completadas}/${checklist.length}`}
               c={completadas===checklist.length?BV.verde:BV.ambar} sub="registradas"/>
        <BvKpi label="Dotación presente" value={`${presentes}/${operarios.length}`}
               c={presentes===operarios.length?BV.verde:BV.ambar}/>
        <BvKpi label="Horas extra" value={hhExtra.toFixed(1)} c={hhExtra>0?BV.ambar:BV.slate}/>
        <BvKpi label="Cierre de bodega" value={`${cierreRev}/${catCats.length}`}
               c={cierreRev===catCats.length?BV.verde:BV.ambar}
               sub={cierreObs>0?`${cierreObs} observada(s)`:'categorías revisadas'}/>
        <BvKpi label="Contrastes WMS" value={contrastesAltos}
               c={contrastesAltos>0?BV.rojo:BV.verde}
               sub={contrastesAltos>0?'declarado ≠ sistema':'sin diferencias'}/>
      </div>

      {/* Actividad real del WMS ese día — contexto antes de declarar */}
      {sist && (
        <div style={{display:'flex', flexWrap:'wrap', gap:0, border:`1px solid ${BV.line}`,
          borderRadius:4, background:BV.bgHead, marginBottom:12, overflow:'hidden',
          fontSize:11.5, color:BV.slate}}>
          <div style={{padding:'7px 14px', fontWeight:700, letterSpacing:0.6, textTransform:'uppercase',
            fontSize:10, borderRight:`1px solid ${BV.line}`, color:BV.navy, alignSelf:'center'}}>
            Registrado en el WMS hoy
          </div>
          {[
            ['Picking', `${sist.pickings} órdenes · ${sist.pickingsCerrados} cerradas`],
            ['Recepciones', sist.recepciones],
            ['Reposiciones', sist.reposiciones],
            ['Mermas', sist.mermas],
            ['Inventarios activos', `${sist.invActivos}${sist.invDelDia ? ` (${sist.invDelDia} de hoy)` : ''}`],
          ].map(([l, v]) => (
            <div key={l} style={{padding:'7px 14px', borderRight:`1px solid ${BV.lineSoft}`}}>
              <span style={{fontWeight:700, color:BV.ink, fontVariantNumeric:'tabular-nums'}}>{v}</span> {l}
            </div>
          ))}
        </div>
      )}

      {/* Alerta preventiva: vas a contar sobre una categoría observada */}
      {riesgo.length > 0 && (
        <div style={{padding:'10px 14px', marginBottom:12, borderRadius:3,
          background:'#FDF6EC', border:`1px solid ${BV.ambar}45`, borderLeft:`3px solid ${BV.ambar}`}}>
          <div style={{fontSize:12, fontWeight:700, color:BV.ambar, marginBottom:4}}>
            {riesgo.length === 1
              ? 'Hay un inventario próximo sobre una categoría con observaciones abiertas'
              : `Hay ${riesgo.length} inventarios próximos sobre categorías con observaciones abiertas`}
          </div>
          {riesgo.slice(0,4).map((r,i)=>(
            <div key={i} style={{fontSize:11.5, color:BV.ink, lineHeight:1.6}}>
              · <strong>{r.categoria}</strong> se cuenta {r.dias_para_conteo <= 0 ? 'hoy'
                : r.dias_para_conteo === 1 ? 'mañana' : `en ${r.dias_para_conteo} días`}
              {' '}({r.fecha_planificada}) y lleva {r.dias_pendiente} día(s) observada
              en {(r.puntos_observados||[]).join(', ')}
              {r.observacion ? ` — ${r.observacion}` : ''}
            </div>
          ))}
          <div style={{fontSize:11, color:BV.slate, marginTop:5}}>
            Ordenar antes de contar evita el reconteo. Es lo que pasó con Wall Panel en Maipú.
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div style={{display:'flex', gap:20, borderBottom:`1px solid ${BV.line}`, marginBottom:12}}>
        {[{k:'checklist', l:`ACTIVIDADES (${checklist.length})`},
          {k:'turnos',    l:`DOTACIÓN Y TURNOS (${operarios.length})`},
          {k:'cierre',    l:`CIERRE DE BODEGA (${cierreRev}/${catCats.length})`},
          {k:'tareas',    l:`TAREAS (${tareas.length})`}].map(t=>(
          <div key={t.k} onClick={()=>setSecc(t.k)}
            style={{padding:'7px 2px 8px', cursor:'pointer', fontSize:11, fontWeight:700, letterSpacing:0.7,
              color:secc===t.k?BV.ink:BV.slate,
              borderBottom:secc===t.k?`2px solid ${BV.navy}`:'2px solid transparent',
              marginBottom:-1, userSelect:'none'}}>{t.l}</div>
        ))}
      </div>

      <GuiaPanel seccion={secc} abierto={guia} onToggle={()=>setGuia(v=>!v)}/>

      {/* ── ACTIVIDADES ── */}
      {secc==='checklist' && (<>
        <BvGuia titulo="CÓMO SE LLENAN LAS ACTIVIDADES">
          <strong>Todas las actividades se responden, aunque el día haya estado tranquilo.</strong> Si algo
          no correspondía hoy, se marca <em>No aplica</em> — eso también es información.
          <div style={{marginTop:8}}>
            <strong>Tema:</strong> el qué o el dónde. Elige la opción que más se acerque a lo que
            realmente se hizo, no la primera de la lista.
            <Ej>En Limpieza, si se barrió solo el patio, el tema es <em>Patio</em>, no <em>Bodega en general</em>.</Ej>
          </div>
          <div style={{marginTop:8}}>
            <strong>Avance:</strong> <em>Realizado</em> es que quedó terminado.
            <em> Parcial</em> es que se avanzó pero quedó pendiente.
            <em> No realizado</em> es que no se alcanzó a hacer.
            <Ej>Se cambiaron los pallets de la mitad de los paneles porque se acabaron los pallets nuevos
            → <em>Parcial</em> + motivo <em>Falta de insumos</em>.</Ej>
          </div>
          <div style={{marginTop:8}}>
            <strong>Motivo:</strong> obligatorio cuando no quedó completo. Es el dato más importante del
            registro: es lo que se acumula en el reporte mensual y muestra qué está frenando la bodega.
            No pongas <em>Bajo rendimiento</em> si en realidad faltó gente o material.
          </div>
          <div style={{marginTop:8}}>
            <strong>Operarios:</strong> marca a quienes efectivamente hicieron esa tarea. Sirve para ver
            carga de trabajo, no para controlar a nadie. Los que estén marcados como ausentes en Dotación
            aparecen en rojo.
          </div>
          <div style={{marginTop:8}}>
            <strong>Si la fila se pone roja:</strong> falta el motivo, o lo declarado no calza con lo que
            registra el sistema. En ese caso revisa: quizá hubo movimiento que no anotaste, o la actividad
            sí se hizo y corresponde corregir el avance.
          </div>
        </BvGuia>
        <div style={{border:`1px solid ${BV.line}`, borderRadius:4, background:'#fff', overflowX:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:1000}}>
            <thead><tr style={{background:BV.bgHead}}>
              <th style={{...thS(), width:36}}>#</th>
              <th style={thS()}>Actividad</th>
              <th style={thS()}>Tema</th>
              <th style={thS()}>Avance</th>
              <th style={thS()}>Motivo</th>
              <th style={thS()}>Operarios</th>
              <th style={thS()}>Observación</th>
            </tr></thead>
            <tbody>
              {checklist.map((c, i) => {
                const l = lineas[c.actividad_codigo] || {}
                const pideMotivo = ['PARCIAL','NO_REALIZADO'].includes(l.avance)
                const ctr = contrasteDe(c.actividad_codigo, l)
                return (
                  <tr key={c.actividad_codigo} style={{borderBottom:`1px solid ${BV.lineSoft}`,
                    boxShadow: (pideMotivo && !l.motivo) || ctr?.sev==='alto' ? `inset 3px 0 0 ${BV.rojo}` : 'none'}}>
                    <td style={{...tdS, color:BV.slate, fontVariantNumeric:'tabular-nums'}}>{i+1}</td>
                    <td style={{...tdS, fontWeight:700, minWidth:170}}>
                      {c.actividad}
                      {ctr && (
                        <div style={{fontSize:10, fontWeight:600, marginTop:2,
                          color: ctr.sev==='alto' ? BV.rojo : BV.ambar}}>
                          {ctr.sev==='alto' ? '⨯ ' : ''}{ctr.t}
                        </div>
                      )}
                      {pideMotivo && l.motivo && !cerrada && (
                        <div onClick={()=>setNT({
                            titulo:`${c.actividad}${l.tema?` (${l.tema})`:''}: ${l.motivo}`,
                            prioridad:'ALTA', origen:bitId, trabajador_id:'', fecha_limite:'', descripcion:l.observacion||''})}
                          style={{fontSize:10, fontWeight:700, marginTop:3, color:BV.azul,
                            cursor:'pointer', userSelect:'none'}}>
                          → CONVERTIR EN TAREA
                        </div>
                      )}
                    </td>
                    <td style={tdS}>
                      <select style={bvInput(180)} value={l.tema || ''} disabled={cerrada}
                        onChange={e=>setL(c.actividad_codigo, 'tema', e.target.value)}>
                        <option value="">— seleccionar —</option>
                        {(c.temas || []).map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td style={tdS}>
                      <BvSeg opciones={AVANCES} valor={l.avance} ancho={62}
                        onChange={v=>{
                          setL(c.actividad_codigo, 'avance', v)
                          if (!['PARCIAL','NO_REALIZADO'].includes(v)) setL(c.actividad_codigo, 'motivo', '')
                          if (v === 'NO_APLICA') setL(c.actividad_codigo, 'trabajadores', [])
                        }}/>
                    </td>
                    <td style={tdS}>
                      {pideMotivo ? (
                        <select style={{...bvInput(150), borderColor: l.motivo ? BV.line : BV.rojo}}
                          value={l.motivo || ''} disabled={cerrada}
                          onChange={e=>setL(c.actividad_codigo, 'motivo', e.target.value)}>
                          <option value="">— obligatorio —</option>
                          {motivos.map(m=><option key={m} value={m}>{m}</option>)}
                        </select>
                      ) : <span style={{color:BV.slate}}>—</span>}
                    </td>
                    <td style={{...tdS, maxWidth:280}}>
                      {l.avance === 'NO_APLICA' ? <span style={{color:BV.slate}}>—</span> : (
                        <div style={{display:'flex', flexWrap:'wrap', gap:4}}>
                          {operarios.map(o => {
                            const on = (l.trabajadores || []).includes(o.trabajador_id)
                            const ausente = turnos[o.trabajador_id]?.presencia !== 'PRESENTE'
                            return (
                              <span key={o.trabajador_id}
                                onClick={()=>!cerrada && toggleTrab(c.actividad_codigo, o.trabajador_id)}
                                title={ausente ? 'Marcado como no presente en Dotación' : o.nombre_completo}
                                style={{fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:2,
                                  cursor:cerrada?'default':'pointer', userSelect:'none',
                                  border:`1px solid ${on?BV.navy:BV.line}`,
                                  background:on?BV.navy:'#fff', color:on?'#fff':(ausente?BV.rojo:BV.slate),
                                  opacity: ausente && !on ? 0.5 : 1}}>
                                {o.nombre_completo.split(' ')[0]} {o.nombre_completo.split(' ')[1]?.[0] || ''}.
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </td>
                    <td style={tdS}>
                      <input style={bvInput(150)} value={l.observacion || ''} disabled={cerrada}
                        placeholder="opcional"
                        onChange={e=>setL(c.actividad_codigo, 'observacion', e.target.value)}/>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>)}

      {/* ── DOTACIÓN Y TURNOS ── */}
      {secc==='turnos' && (<>
        <BvGuia titulo="CÓMO SE LLENA LA DOTACIÓN">
          <strong>Esto no reemplaza la marcación de Workera.</strong> El reloj sigue siendo la fuente
          oficial para sueldos y Dirección del Trabajo. Acá se declara la dotación operativa: con quién
          contaste realmente hoy.
          <div style={{marginTop:8}}>
            <strong>Turno programado:</strong> lo trae Workera solo. Si dice <em>sin programación</em>,
            esa persona no está mapeada al reloj — avísale a Gestión de Personas.
          </div>
          <div style={{marginTop:8}}>
            <strong>Turno:</strong> corrígelo solo si difiere de lo programado.
            <Ej>Entró a las 08:00 pero se retiró a las 14:00 por hora médica → turno <em>Parcial</em>,
            presencia <em>Presente</em>, y la explicación en Observación.</Ej>
          </div>
          <div style={{marginTop:8}}>
            <strong>Presencia:</strong> cualquier cosa distinta de <em>Presente</em> exige nota.
            Usa <em>Apoyo en otra</em> cuando la persona fue a reforzar otra bodega — así no cuenta como
            ausencia y queda el registro del traslado.
          </div>
          <div style={{marginTop:8}}>
            <strong>HH extra:</strong> horas efectivamente trabajadas de más, en decimales
            (1.5 = una hora y media). Se declaran acá para tenerlas el mismo día; la validación formal
            sigue el flujo de RRHH.
          </div>
        </BvGuia>
        <div style={{border:`1px solid ${BV.line}`, borderRadius:4, background:'#fff', overflowX:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:920}}>
            <thead><tr style={{background:BV.bgHead}}>
              <th style={thS()}>Operario</th>
              <th style={thS()}>Función</th>
              <th style={thS()}>Turno programado</th>
              <th style={thS()}>Turno</th>
              <th style={thS()}>Presencia</th>
              <th style={{...thS(true), width:90}}>HH extra</th>
              <th style={thS()}>Observación</th>
            </tr></thead>
            <tbody>
              {operarios.map(o => {
                const t = turnos[o.trabajador_id] || {}
                const faltaObs = t.presencia !== 'PRESENTE' && !t.observacion
                return (
                  <tr key={o.trabajador_id} style={{borderBottom:`1px solid ${BV.lineSoft}`,
                    boxShadow: faltaObs ? `inset 3px 0 0 ${BV.rojo}` : 'none'}}>
                    <td style={{...tdS, fontWeight:700, whiteSpace:'nowrap'}}>
                      {o.nombre_completo}
                      {o.sucursal_origen !== o.bodega_codigo && (
                        <span style={{fontSize:9.5, fontWeight:700, color:BV.slate, marginLeft:6,
                          border:`1px solid ${BV.line}`, borderRadius:2, padding:'1px 4px'}}>BODEGA AUX</span>
                      )}
                    </td>
                    <td style={{...tdS, color:BV.slate}}>{o.rol_operativo}</td>
                    <td style={{...tdS, color:BV.slate, whiteSpace:'nowrap'}}>
                      {o.turno_workera
                        ? <>{o.turno_workera}{o.hora_inicio_sug ? ` · ${String(o.hora_inicio_sug).slice(0,5)}–${String(o.hora_fin_sug||'').slice(0,5)}` : ''}</>
                        : <span style={{color:BV.ambar}}>sin programación</span>}
                    </td>
                    <td style={tdS}>
                      <select style={bvInput(105)} value={t.turno || 'COMPLETO'} disabled={cerrada}
                        onChange={e=>setT(o.trabajador_id, 'turno', e.target.value)}>
                        {TURNOS.map(x=><option key={x.k} value={x.k}>{x.l}</option>)}
                      </select>
                    </td>
                    <td style={tdS}>
                      <select style={{...bvInput(135),
                          color:(PRESENCIAS.find(p=>p.k===t.presencia)?.c) || BV.ink, fontWeight:600}}
                        value={t.presencia || 'PRESENTE'} disabled={cerrada}
                        onChange={e=>setT(o.trabajador_id, 'presencia', e.target.value)}>
                        {PRESENCIAS.map(p=><option key={p.k} value={p.k}>{p.l}</option>)}
                      </select>
                    </td>
                    <td style={{...tdS, textAlign:'right'}}>
                      <input type="number" step="0.5" min="0" max="12" disabled={cerrada}
                        style={{...bvInput(60), textAlign:'right'}} value={t.hh_extra ?? 0}
                        onChange={e=>setT(o.trabajador_id, 'hh_extra', e.target.value)}/>
                    </td>
                    <td style={tdS}>
                      <input style={{...bvInput(190), borderColor: faltaObs ? BV.rojo : BV.line}}
                        disabled={cerrada} value={t.observacion || ''}
                        placeholder={t.presencia !== 'PRESENTE' ? 'motivo obligatorio' : 'opcional'}
                        onChange={e=>setT(o.trabajador_id, 'observacion', e.target.value)}/>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{padding:'8px 12px', fontSize:11, color:BV.slate, borderTop:`1px solid ${BV.lineSoft}`}}>
            El turno programado viene de Workera. La marcación real sigue registrándose ahí:
            acá solo se declara la dotación operativa del día.
          </div>
        </div>
      </>)}

      {/* ── CIERRE DE BODEGA — revisión por categoría ── */}
      {secc==='cierre' && (<>
        <BvGuia titulo="CÓMO SE HACE EL CIERRE DE BODEGA">
          <strong>Es una caminata por la bodega antes de cerrar el turno.</strong> Categoría por categoría,
          cinco preguntas. Si todo está bien, el botón <em>Todo OK</em> marca la fila completa de una vez;
          lo que toma tiempo es solo lo que está mal, que es justamente lo que importa registrar.
          <div style={{marginTop:8}}>
            <strong>Orden:</strong> apilado y alineado según el estándar de la bodega.
            <Ej>Puertas paradas apoyadas sin separador, o pallets de piso a media altura sin completar
            → <em>Observado</em>.</Ej>
          </div>
          <div style={{marginTop:8}}>
            <strong>Ubicación:</strong> lo físico está donde el layout dice que debe estar.
            <Ej>Encontraste tres cajas de Panel UV en el pasillo de molduras → <em>Observado</em> en
            ambas categorías si corresponde.</Ej>
          </div>
          <div style={{marginTop:8}}>
            <strong>Etiquetado:</strong> etiqueta de SKU y precio visibles y legibles.
            <Ej>Piedra Flex sin etiqueta de precio en la exhibición → <em>Observado</em>.</Ej>
          </div>
          <div style={{marginTop:8}}>
            <strong>Sin daños:</strong> sin embalajes rotos, cajas vacías mezcladas ni producto golpeado.
            <Ej>Este es el que habría detectado el problema del Wall Panel en Maipú en agosto: cajas
            vacías entremedio del producto bueno, que después descuadraron el conteo.</Ej>
          </div>
          <div style={{marginTop:8}}>
            <strong>Acceso:</strong> se puede llegar al frente de la categoría sin mover otra cosa.
            <Ej>Pallet de despacho pendiente bloqueando el rack de cerraduras → <em>Observado</em>.</Ej>
          </div>
          <div style={{marginTop:8}}>
            <strong>N/R (no revisada):</strong> úsalo con honestidad cuando no alcanzaste a mirar una
            categoría, con la razón. Es preferible un no-revisado explícito a un OK falso: lo segundo
            hace que confiemos en un dato que no existe.
          </div>
          <div style={{marginTop:8, paddingTop:8, borderTop:`1px solid ${BV.line}`}}>
            <strong>Lo observado no desaparece.</strong> Se arrastra día a día hasta que la categoría
            vuelva a quedar completa en verde, y en Cumplimiento se ve cuántos días lleva así. Esa es la
            medida real de si la bodega se ordena o solo se anota.
          </div>
        </BvGuia>
        <div style={{border:`1px solid ${BV.line}`, borderRadius:4, background:'#fff', overflowX:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:960}}>
            <thead><tr style={{background:BV.bgHead}}>
              <th style={thS()}>Categoría</th>
              <th style={{...thS(), width:76}}></th>
              {CAT_CHECKS.map(c=>(
                <th key={c.k} title={c.d} style={{...thS(), textAlign:'center', cursor:'help'}}>{c.l}</th>
              ))}
              <th style={thS()}>Nota</th>
              <th style={{...thS(), width:60, textAlign:'center'}}>N/R</th>
            </tr></thead>
            <tbody>
              {catCats.map(cat => {
                const k = catChecks[cat] || {}
                const obs = catObservada(k)
                const falta = !catCompleta(k)
                return (
                  <tr key={cat} style={{borderBottom:`1px solid ${BV.lineSoft}`,
                    opacity:k.no_revisada?0.55:1,
                    boxShadow: obs ? `inset 3px 0 0 ${BV.rojo}` : 'none'}}>
                    <td style={{...tdS, fontWeight:700, whiteSpace:'nowrap'}}>{cat}</td>
                    <td style={tdS}>
                      {!cerrada && !k.no_revisada && (
                        <span onClick={()=>CAT_CHECKS.forEach(c=>setCk(cat, c.k, 'OK'))}
                          style={{fontSize:10, fontWeight:700, color:BV.verde, cursor:'pointer',
                            userSelect:'none', whiteSpace:'nowrap'}}>✓ TODO OK</span>
                      )}
                    </td>
                    {CAT_CHECKS.map(c => {
                      const v = k[c.k]
                      return (
                        <td key={c.k} onClick={()=>{ if (cerrada || k.no_revisada) return
                            setCk(cat, c.k, v===null||v===undefined ? 'OK' : v==='OK' ? 'OBSERVADO' : null) }}
                          style={{...tdS, textAlign:'center', cursor:cerrada||k.no_revisada?'default':'pointer',
                            userSelect:'none', fontWeight:800, fontSize:11,
                            background: v==='OK' ? '#E8F2EC' : v==='OBSERVADO' ? '#FCE9E6' : 'transparent',
                            color: v==='OK' ? BV.verde : v==='OBSERVADO' ? BV.rojo : BV.line,
                            borderLeft:`1px solid ${BV.lineSoft}`}}>
                          {v==='OK' ? 'OK' : v==='OBSERVADO' ? 'OBS' : '·'}
                        </td>
                      )
                    })}
                    <td style={{...tdS, borderLeft:`1px solid ${BV.lineSoft}`}}>
                      {(obs || k.no_revisada) ? (
                        <input style={{...bvInput(190),
                            borderColor:(k.observacion||'').trim() ? BV.line : BV.rojo}}
                          disabled={cerrada} value={k.observacion || ''}
                          placeholder={k.no_revisada ? 'por qué no se revisó' : 'qué se observó'}
                          onChange={e=>setCk(cat, 'observacion', e.target.value)}/>
                      ) : <span style={{color:BV.slate}}>—</span>}
                    </td>
                    <td onClick={()=>{ if (cerrada) return
                        const nr = !k.no_revisada
                        setCk(cat, 'no_revisada', nr)
                        if (nr) CAT_CHECKS.forEach(c=>setCk(cat, c.k, null)) }}
                      title="Marcar como no revisada hoy (requiere nota)"
                      style={{...tdS, textAlign:'center', cursor:cerrada?'default':'pointer',
                        userSelect:'none', fontWeight:700, fontSize:10.5,
                        color:k.no_revisada ? BV.ambar : BV.line}}>
                      {k.no_revisada ? 'N/R' : '·'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{padding:'8px 12px', fontSize:11, color:BV.slate, borderTop:`1px solid ${BV.lineSoft}`}}>
            Un clic en la celda: OK → OBS → vacío. Toda categoría observada exige nota, y lo observado
            se sigue arrastrando día a día hasta que vuelva a quedar todo OK (los días acumulados se ven
            en Cumplimiento). N/R = no revisada hoy, con justificación.
          </div>
        </div>
      </>)}

      {/* ── TAREAS ── */}
      {secc==='tareas' && (<>
        <BvGuia titulo="CÓMO SE USAN LAS TAREAS">
          Sirven para que lo que quedó pendiente hoy tenga dueño y fecha, en vez de repetirse mañana.
          <div style={{marginTop:8}}>
            <strong>Desde un incumplimiento:</strong> en Actividades, cualquier línea parcial o no
            realizada muestra <em>→ Convertir en tarea</em>. Queda con el título y el motivo ya escritos
            y ligada a la bitácora del día.
            <Ej>«Cambios de pallets (Paneles acústicos): Falta de insumos» → tarea alta, asignada a
            Pedro, límite viernes.</Ej>
          </div>
          <div style={{marginTop:8}}>
            <strong>Prioridad:</strong> <em>Urgente</em> es que frena la operación o hay riesgo de
            seguridad. <em>Alta</em>, que compromete el cumplimiento de la semana. Si todo es urgente,
            nada lo es.
          </div>
          <div style={{marginTop:8}}>
            <strong>Vencidas:</strong> aparecen con banda roja y se cuentan en el reporte diario que le
            llega a la Dirección de Operaciones.
          </div>
        </BvGuia>
        <div style={{border:`1px solid ${BV.line}`, borderRadius:4, background:'#fff'}}>
          <div style={{display:'flex', alignItems:'center', padding:'8px 12px',
            borderBottom:`1px solid ${BV.line}`, background:BV.bgHead}}>
            <div style={{fontSize:10, fontWeight:700, letterSpacing:0.6, color:BV.slate,
              textTransform:'uppercase'}}>Tareas abiertas de la bodega</div>
            <button onClick={()=>setNT({titulo:'', prioridad:'NORMAL', trabajador_id:'', fecha_limite:'', descripcion:'', origen:null})}
              style={{...bvBtn('solid'), marginLeft:'auto', padding:'5px 12px'}}>+ NUEVA TAREA</button>
          </div>
          {tareas.length === 0 ? (
            <div style={{padding:'26px 14px', textAlign:'center', color:BV.slate, fontSize:12.5}}>
              Sin tareas abiertas.
            </div>
          ) : tareas.map(t => {
            const asig = (t.log_tarea_asignaciones || [])
              .map(a => operarios.find(o=>o.trabajador_id===a.trabajador_id)?.nombre_completo)
              .filter(Boolean)
            const cPrio = t.prioridad==='URGENTE'?BV.rojo:t.prioridad==='ALTA'?BV.ambar:BV.slate
            const vencida = t.fecha_limite && t.fecha_limite < hoyISO()
            return (
              <div key={t.id} style={{display:'flex', alignItems:'flex-start', gap:12,
                padding:'9px 12px', borderBottom:`1px solid ${BV.lineSoft}`,
                boxShadow: vencida ? `inset 3px 0 0 ${BV.rojo}` : 'none'}}>
                <span style={{fontSize:9.5, fontWeight:700, letterSpacing:0.5, color:cPrio,
                  border:`1px solid ${cPrio}55`, borderRadius:2, padding:'2px 6px', marginTop:1,
                  whiteSpace:'nowrap'}}>{t.prioridad}</span>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:12.5, fontWeight:700, color:BV.ink}}>{t.titulo}</div>
                  <div style={{fontSize:11, color:BV.slate, marginTop:1}}>
                    {t.fecha_limite && <span style={{color:vencida?BV.rojo:BV.slate,
                      fontWeight:vencida?700:400}}>Límite {t.fecha_limite}{vencida?' — VENCIDA':''} · </span>}
                    {asig.length ? asig.join(', ') : 'sin asignar'}
                    {t.origen_bitacora && ' · desde bitácora'}
                    {t.creado_nombre && ` · creada por ${t.creado_nombre}`}
                  </div>
                </div>
                <button onClick={()=>cerrarTarea(t.id)}
                  style={{...bvBtn('outline'), padding:'4px 10px', color:BV.verde,
                    borderColor:`${BV.verde}70`}}>COMPLETAR</button>
              </div>
            )
          })}
        </div>
      </>)}

      {/* Modal de nueva tarea */}
      {nuevaTarea && (
        <div style={{position:'fixed', inset:0, background:'rgba(22,33,62,0.45)', zIndex:400,
          display:'flex', alignItems:'center', justifyContent:'center', padding:16}}
          onClick={()=>setNT(null)}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:'#fff', borderRadius:4, border:`1px solid ${BV.line}`,
              width:460, maxWidth:'100%', padding:'18px 20px'}}>
            <div style={{fontSize:14, fontWeight:800, color:BV.ink, marginBottom:12}}>Nueva tarea</div>
            <input autoFocus style={{...bvInput('100%'), marginBottom:8}} placeholder="Título"
              value={nuevaTarea.titulo} onChange={e=>setNT({...nuevaTarea, titulo:e.target.value})}/>
            <textarea style={{...bvInput('100%'), minHeight:52, resize:'vertical',
              fontFamily:'inherit', marginBottom:8}} placeholder="Descripción (opcional)"
              value={nuevaTarea.descripcion} onChange={e=>setNT({...nuevaTarea, descripcion:e.target.value})}/>
            <div style={{display:'flex', gap:8, marginBottom:12, flexWrap:'wrap'}}>
              <select style={bvInput(110)} value={nuevaTarea.prioridad}
                onChange={e=>setNT({...nuevaTarea, prioridad:e.target.value})}>
                {['BAJA','NORMAL','ALTA','URGENTE'].map(p=><option key={p} value={p}>{p}</option>)}
              </select>
              <input type="date" style={bvInput(135)} value={nuevaTarea.fecha_limite}
                onChange={e=>setNT({...nuevaTarea, fecha_limite:e.target.value})}/>
              <select style={bvInput(160)} value={nuevaTarea.trabajador_id}
                onChange={e=>setNT({...nuevaTarea, trabajador_id:e.target.value})}>
                <option value="">— sin asignar —</option>
                {operarios.map(o=><option key={o.trabajador_id} value={o.trabajador_id}>{o.nombre_completo}</option>)}
              </select>
            </div>
            <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
              <button onClick={()=>setNT(null)} style={bvBtn('ghost')}>CANCELAR</button>
              <button onClick={()=>nuevaTarea.titulo.trim() && crearTarea(nuevaTarea)}
                style={{...bvBtn('solid'), opacity:nuevaTarea.titulo.trim()?1:0.45}}>CREAR TAREA</button>
            </div>
          </div>
        </div>
      )}

      {/* Observación general + acciones */}
      <div style={{marginTop:14, display:'flex', gap:10, alignItems:'flex-start', flexWrap:'wrap'}}>
        <textarea style={{...bvInput(420), minHeight:56, resize:'vertical', fontFamily:'inherit'}}
          placeholder="Observación general del día (opcional)" value={obsGeneral} disabled={cerrada}
          onChange={e=>setObsGen(e.target.value)}/>
        <div style={{flex:1, minWidth:220}}>
          {errores.length > 0 && (
            <div style={{fontSize:11.5, color:BV.rojo, marginBottom:8, lineHeight:1.5}}>
              <strong>{errores.length} {errores.length===1?'dato pendiente':'datos pendientes'}:</strong><br/>
              {errores.slice(0,3).join(' · ')}{errores.length>3 ? ` · y ${errores.length-3} más` : ''}
            </div>
          )}
          {!cerrada && (
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
              <button onClick={copiarInforme} style={bvBtn('ghost')}>COPIAR INFORME</button>
              <button onClick={()=>guardar('BORRADOR')} disabled={guardando} style={bvBtn('outline')}>
                {guardando ? 'GUARDANDO…' : 'GUARDAR BORRADOR'}
              </button>
              <button onClick={()=>guardar('ENVIADO')} disabled={guardando || errores.length>0} style={{...bvBtn('solid'),
                opacity: errores.length>0 ? 0.45 : 1, cursor: errores.length>0 ? 'not-allowed' : 'pointer'}}>
                ENVIAR PARA VALIDACIÓN
              </button>
              {esGlobal && (
                <button onClick={()=>guardar('VALIDADO')} disabled={guardando || errores.length>0}
                  style={{...bvBtn('outline'), color:BV.verde, borderColor:`${BV.verde}70`,
                    opacity: errores.length>0 ? 0.45 : 1}}>
                  VALIDAR
                </button>
              )}
            </div>
          )}
          {cerrada && (
            <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
              <div style={{fontSize:11.5, color:BV.verde, fontWeight:600}}>
                Bitácora validada{bit?.validado_nombre ? ` por ${bit.validado_nombre}` : ''}. Solo lectura.
              </div>
              <button onClick={copiarInforme} style={bvBtn('outline')}>COPIAR INFORME</button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ═══════════════════════ VISTA HISTÓRICO ═══════════════════════════════════
function VistaHist({cu, bodega, flash, esGlobal, onAbrir}) {
  const [loading, setLoading] = useState(true)
  const [filas, setFilas]     = useState([])
  const [todas, setTodas]     = useState(false)

  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [bodega, todas])

  async function cargar() {
    setLoading(true)
    let q = supabase.from('v_log_bitacora_resumen').select('*').order('fecha', {ascending:false}).limit(120)
    if (!todas) q = q.eq('sucursal_codigo', bodega)
    const { data } = await q
    setFilas(data || [])
    setLoading(false)
  }

  async function validar(id) {
    const { error } = await supabase.from('log_bitacora')
      .update({estado:'VALIDADO', validado_por:cu?.id || null, validado_nombre:cu?.nombre || null,
               validado_at:new Date().toISOString()}).eq('id', id)
    if (error) flash('error', 'No se pudo validar: ' + error.message)
    else { flash('ok', 'Bitácora validada.'); cargar() }
  }

  const pendientes = filas.filter(f => f.estado === 'ENVIADO').length

  return (
    <>
      <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:10, flexWrap:'wrap'}}>
        {esGlobal && (
          <button onClick={()=>setTodas(v=>!v)} style={bvBtn(todas?'solid':'outline')}>
            {todas ? 'VIENDO LAS 4 BODEGAS' : 'VER TODAS LAS BODEGAS'}
          </button>
        )}
        {pendientes > 0 && (
          <span style={{fontSize:11.5, fontWeight:700, color:BV.azul}}>
            {pendientes} {pendientes===1?'bitácora espera':'bitácoras esperan'} validación
          </span>
        )}
        <span style={{marginLeft:'auto', fontSize:11.5, color:BV.slate, fontVariantNumeric:'tabular-nums'}}>
          {filas.length} registros
        </span>
      </div>

      <div style={{border:`1px solid ${BV.line}`, borderRadius:4, background:'#fff', overflowX:'auto'}}>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:820}}>
          <thead><tr style={{background:BV.bgHead}}>
            <th style={thS()}>Fecha</th>
            {todas && <th style={thS()}>Bodega</th>}
            <th style={thS()}>Estado</th>
            <th style={thS()}>Responsable</th>
            <th style={thS(true)}>Actividades</th>
            <th style={thS(true)}>Incumplidas</th>
            <th style={thS(true)}>Cumplimiento</th>
            <th style={thS()}></th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{padding:'28px 14px', textAlign:'center', color:BV.slate, fontSize:12.5}}>
                Cargando…</td></tr>
            ) : filas.length === 0 ? (
              <tr><td colSpan={8} style={{padding:'28px 14px', textAlign:'center', color:BV.slate, fontSize:12.5}}>
                Sin bitácoras registradas.</td></tr>
            ) : filas.map(f => {
              const pct = f.pct_cumplimiento === null ? null : Number(f.pct_cumplimiento)
              const inc = (f.parciales || 0) + (f.no_realizadas || 0)
              return (
                <tr key={f.id}
                  onMouseEnter={e=>e.currentTarget.style.background=BV.bgHover}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                  style={{borderBottom:`1px solid ${BV.lineSoft}`}}>
                  <td style={{...tdS, fontWeight:700, whiteSpace:'nowrap', cursor:'pointer'}}
                      onClick={()=>onAbrir(f.fecha)}>{f.fecha}</td>
                  {todas && <td style={tdS}>{BODEGAS.find(b=>b.k===f.sucursal_codigo)?.l || f.sucursal_codigo}</td>}
                  <td style={tdS}><BvPunto estado={f.estado}/></td>
                  <td style={{...tdS, color:BV.slate}}>{f.responsable_nombre || '—'}</td>
                  <td style={{...tdS, textAlign:'right', fontVariantNumeric:'tabular-nums'}}>
                    {f.realizadas}/{(f.actividades || 0) - (f.no_aplica || 0)}
                  </td>
                  <td style={{...tdS, textAlign:'right', fontVariantNumeric:'tabular-nums',
                    color:inc>0?BV.rojo:BV.slate, fontWeight:inc>0?700:400}}>{inc || '—'}</td>
                  <td style={{...tdS, textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:700,
                    color: pct===null ? BV.slate : pct>=90 ? BV.verde : pct>=70 ? BV.ambar : BV.rojo}}>
                    {pct === null ? '—' : pct + '%'}
                  </td>
                  <td style={{...tdS, textAlign:'right', whiteSpace:'nowrap'}}>
                    {esGlobal && f.estado === 'ENVIADO' && (
                      <button onClick={()=>validar(f.id)} style={{...bvBtn('outline'), padding:'4px 10px',
                        color:BV.verde, borderColor:`${BV.verde}70`}}>VALIDAR</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ═══════════════════════ VISTA CUMPLIMIENTO ════════════════════════════════
function VistaCumpl({bodegas}) {
  const [loading, setLoading] = useState(true)
  const [comp, setComp]       = useState([])
  const [mot,  setMot]        = useState([])
  const [sinRep, setSinRep]   = useState([])
  const [pend, setPend]       = useState([])

  useEffect(() => { cargar() /* eslint-disable-next-line */ }, [])

  async function cargar() {
    setLoading(true)
    const desde = new Date(); desde.setDate(1)
    const d0 = desde.toLocaleDateString('en-CA', {timeZone:'America/Santiago'})
    try {
      const [res, lin, bits] = await Promise.all([
        supabase.from('v_log_bitacora_resumen').select('*').gte('fecha', d0).limit(2000),
        supabase.from('log_bitacora_lineas').select('motivo, actividad_codigo, bitacora_id').not('motivo','is',null).limit(5000),
        supabase.from('log_bitacora').select('sucursal_codigo, fecha').eq('fecha', hoyISO()),
      ])
      const porSuc = {}
      ;(res.data || []).forEach(r => {
        const s = porSuc[r.sucursal_codigo] || (porSuc[r.sucursal_codigo] = {dias:0, suma:0, n:0, inc:0})
        s.dias++
        s.inc += (r.parciales || 0) + (r.no_realizadas || 0)
        if (r.pct_cumplimiento !== null) { s.suma += Number(r.pct_cumplimiento); s.n++ }
      })
      setComp(bodegas.map(b => ({
        ...b, ...(porSuc[b.k] || {dias:0, suma:0, n:0, inc:0}),
        pct: porSuc[b.k]?.n ? Math.round(porSuc[b.k].suma / porSuc[b.k].n) : null,
      })))

      const cnt = {}
      ;(lin.data || []).forEach(l => { cnt[l.motivo] = (cnt[l.motivo] || 0) + 1 })
      setMot(Object.entries(cnt).sort((a,b)=>b[1]-a[1]))

      const hoyBod = new Set((bits.data || []).map(b=>b.sucursal_codigo))
      setSinRep(bodegas.filter(b => !hoyBod.has(b.k)))

      const { data:pn } = await supabase.from('v_log_bit_cat_estado')
        .select('*').eq('pendiente', true)
        .order('dias_pendiente', {ascending:false}).limit(40)
      setPend(pn || [])
    } catch (e) { /* vista vacía */ }
    setLoading(false)
  }

  if (loading) return <div style={{padding:'30px 4px', color:BV.slate, fontSize:12.5}}>Cargando…</div>

  const maxMot = mot.length ? mot[0][1] : 1

  return (
    <>
      <BvGuia titulo="CÓMO SE LEE ESTE TABLERO">
        <strong>Últimos 7 días:</strong> una celda por bodega y día. Verde ≥ 90%, ámbar ≥ 70%, rojo
        bajo 70%. Fondo rojo claro con guion es un día sin bitácora — eso pesa más que un mal
        porcentaje, porque significa que nadie miró.
        <div style={{marginTop:8}}>
          <strong>Categorías pendientes de regularizar:</strong> lo observado en el cierre de bodega que
          todavía no vuelve a estar OK. La columna de días es la métrica que importa: mide cuánto demora
          la bodega en resolver lo que ella misma detectó. Sobre 7 días se marca en rojo.
        </div>
        <div style={{marginTop:8}}>
          <strong>Qué está frenando la operación:</strong> ranking de motivos del mes. Si
          <em> Falta de insumos</em> encabeza mes a mes, el problema no es del turno: es de compras.
        </div>
      </BvGuia>

      {sinRep.length > 0 && (
        <div style={{display:'flex', alignItems:'center', gap:12, padding:'8px 14px', marginBottom:12,
          background:'#FCF3F1', border:`1px solid ${BV.rojo}40`, borderLeft:`3px solid ${BV.rojo}`, borderRadius:3}}>
          <div style={{fontSize:12, color:BV.rojo, fontWeight:700}}>
            {sinRep.length === 1 ? 'Una bodega no ha reportado hoy' : `${sinRep.length} bodegas no han reportado hoy`}
          </div>
          <div style={{fontSize:11.5, color:BV.slate}}>{sinRep.map(b=>b.l).join(' · ')}</div>
        </div>
      )}

      {/* Tablero semanal: bodega × día, semáforo */}
      <SemanaGrid/>

      <div style={{fontSize:10.5, fontWeight:700, letterSpacing:0.8, color:BV.slate,
        textTransform:'uppercase', marginBottom:8}}>Cumplimiento del mes por bodega</div>
      <div style={{border:`1px solid ${BV.line}`, borderRadius:4, background:'#fff', marginBottom:20, overflowX:'auto'}}>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:620}}>
          <thead><tr style={{background:BV.bgHead}}>
            <th style={thS()}>Bodega</th>
            <th style={thS(true)}>Días reportados</th>
            <th style={thS(true)}>Incumplimientos</th>
            <th style={thS(true)}>Cumplimiento promedio</th>
          </tr></thead>
          <tbody>
            {comp.map(c => (
              <tr key={c.k} style={{borderBottom:`1px solid ${BV.lineSoft}`}}>
                <td style={{...tdS, fontWeight:700}}>{c.l}</td>
                <td style={{...tdS, textAlign:'right', fontVariantNumeric:'tabular-nums',
                  color:c.dias===0?BV.rojo:BV.ink}}>{c.dias}</td>
                <td style={{...tdS, textAlign:'right', fontVariantNumeric:'tabular-nums',
                  color:c.inc>0?BV.rojo:BV.slate}}>{c.inc || '—'}</td>
                <td style={{...tdS, textAlign:'right'}}>
                  {c.pct === null ? <span style={{color:BV.slate}}>—</span> : (
                    <div style={{display:'inline-flex', alignItems:'center', gap:8}}>
                      <div style={{width:70, height:5, background:BV.lineSoft, borderRadius:2, overflow:'hidden'}}>
                        <div style={{width:`${Math.min(c.pct,100)}%`, height:'100%',
                          background:c.pct>=90?BV.verde:c.pct>=70?BV.ambar:BV.rojo}}/>
                      </div>
                      <span style={{fontVariantNumeric:'tabular-nums', fontWeight:700, minWidth:36,
                        textAlign:'right', color:c.pct>=90?BV.verde:c.pct>=70?BV.ambar:BV.rojo}}>{c.pct}%</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Categorías observadas y hace cuántos días — la métrica de regularización */}
      <div style={{fontSize:10.5, fontWeight:700, letterSpacing:0.8, color:BV.slate,
        textTransform:'uppercase', marginBottom:8}}>Categorías pendientes de regularizar</div>
      <div style={{border:`1px solid ${BV.line}`, borderRadius:4, background:'#fff',
        marginBottom:20, overflowX:'auto'}}>
        {pend.length === 0 ? (
          <div style={{padding:'22px 14px', textAlign:'center', color:BV.slate, fontSize:12.5}}>
            Ninguna categoría con observaciones abiertas.
          </div>
        ) : (
          <table style={{width:'100%', borderCollapse:'collapse', minWidth:720}}>
            <thead><tr style={{background:BV.bgHead}}>
              <th style={thS()}>Bodega</th>
              <th style={thS()}>Categoría</th>
              <th style={thS()}>Puntos observados</th>
              <th style={thS()}>Última nota</th>
              <th style={thS()}>Desde</th>
              <th style={{...thS(true)}}>Días</th>
            </tr></thead>
            <tbody>
              {pend.map(p => {
                const d = p.dias_pendiente ?? 0
                const cD = d >= 7 ? BV.rojo : d >= 3 ? BV.ambar : BV.ink
                return (
                  <tr key={p.sucursal_codigo + p.categoria}
                    style={{borderBottom:`1px solid ${BV.lineSoft}`,
                      boxShadow: d >= 7 ? `inset 3px 0 0 ${BV.rojo}` : 'none'}}>
                    <td style={tdS}>{BODEGAS.find(b=>b.k===p.sucursal_codigo)?.l || p.sucursal_codigo}</td>
                    <td style={{...tdS, fontWeight:700}}>{p.categoria}</td>
                    <td style={{...tdS, color:BV.rojo, fontWeight:600}}>
                      {(p.puntos_observados || []).join(', ') || '—'}</td>
                    <td style={{...tdS, color:BV.slate, maxWidth:240, overflow:'hidden',
                      textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={p.observacion || ''}>
                      {p.observacion || '—'}</td>
                    <td style={{...tdS, whiteSpace:'nowrap'}}>{p.observada_desde || '—'}</td>
                    <td style={{...tdS, textAlign:'right', fontVariantNumeric:'tabular-nums',
                      fontWeight:800, color:cD}}>{d}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{fontSize:10.5, fontWeight:700, letterSpacing:0.8, color:BV.slate,
        textTransform:'uppercase', marginBottom:8}}>Qué está frenando la operación</div>
      <div style={{border:`1px solid ${BV.line}`, borderRadius:4, background:'#fff', padding:'4px 0'}}>
        {mot.length === 0 ? (
          <div style={{padding:'22px 14px', textAlign:'center', color:BV.slate, fontSize:12.5}}>
            Sin incumplimientos registrados.
          </div>
        ) : mot.map(([m, n]) => (
          <div key={m} style={{display:'flex', alignItems:'center', gap:12, padding:'8px 14px',
            borderBottom:`1px solid ${BV.lineSoft}`}}>
            <div style={{fontSize:12.5, fontWeight:600, minWidth:170, color:BV.ink}}>{m}</div>
            <div style={{flex:1, height:16, background:BV.lineSoft, borderRadius:2, overflow:'hidden', maxWidth:340}}>
              <div style={{width:`${(n/maxMot)*100}%`, height:'100%', background:BV.navy}}/>
            </div>
            <div style={{fontSize:12.5, fontWeight:700, fontVariantNumeric:'tabular-nums',
              minWidth:30, textAlign:'right'}}>{n}</div>
          </div>
        ))}
      </div>
    </>
  )
}


// ═══════════════════════ TABLERO SEMANAL (bodega × día) ════════════════════
function SemanaGrid() {
  const [datos, setDatos] = useState(null)

  useEffect(() => { (async () => {
    const d = new Date(); d.setDate(d.getDate() - 6)
    const d0 = d.toLocaleDateString('en-CA', {timeZone:'America/Santiago'})
    const { data } = await supabase.from('v_log_bitacora_resumen')
      .select('sucursal_codigo, fecha, estado, pct_cumplimiento').gte('fecha', d0).limit(200)
    const m = {}
    ;(data || []).forEach(r => { m[`${r.sucursal_codigo}|${r.fecha}`] = r })
    setDatos(m)
  })() }, [])

  const dias = useMemo(() => {
    const out = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      out.push({
        iso: d.toLocaleDateString('en-CA', {timeZone:'America/Santiago'}),
        dow: d.toLocaleDateString('es-CL', {weekday:'short', timeZone:'America/Santiago'}).replace('.',''),
        dm:  d.toLocaleDateString('es-CL', {day:'2-digit', month:'2-digit', timeZone:'America/Santiago'}),
        domingo: d.getDay() === 0,
      })
    }
    return out
  }, [])

  if (!datos) return null
  return (
    <>
      <div style={{fontSize:10.5, fontWeight:700, letterSpacing:0.8, color:BV.slate,
        textTransform:'uppercase', marginBottom:8}}>Últimos 7 días</div>
      <div style={{border:`1px solid ${BV.line}`, borderRadius:4, background:'#fff',
        marginBottom:20, overflowX:'auto'}}>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:640}}>
          <thead><tr style={{background:BV.bgHead}}>
            <th style={thS()}>Bodega</th>
            {dias.map(d=>(
              <th key={d.iso} style={{...thS(true), textAlign:'center'}}>{d.dow} {d.dm}</th>
            ))}
          </tr></thead>
          <tbody>
            {BODEGAS.map(b=>(
              <tr key={b.k} style={{borderBottom:`1px solid ${BV.lineSoft}`}}>
                <td style={{...tdS, fontWeight:700, whiteSpace:'nowrap'}}>{b.l}</td>
                {dias.map(d=>{
                  const r = datos[`${b.k}|${d.iso}`]
                  const pct = r?.pct_cumplimiento === null || r?.pct_cumplimiento === undefined
                    ? null : Number(r.pct_cumplimiento)
                  const bg = !r ? (d.domingo ? '#FAFAFB' : '#FCF3F1')
                    : pct === null ? BV.lineSoft
                    : pct >= 90 ? '#E8F2EC' : pct >= 70 ? '#F7EEE3' : '#FCE9E6'
                  const fg = !r ? (d.domingo ? BV.line : BV.rojo)
                    : pct === null ? BV.slate
                    : pct >= 90 ? BV.verde : pct >= 70 ? BV.ambar : BV.rojo
                  return (
                    <td key={d.iso} title={r ? `${r.estado}` : (d.domingo ? 'Domingo' : 'Sin bitácora')}
                      style={{...tdS, textAlign:'center', background:bg, color:fg,
                        fontWeight:700, fontVariantNumeric:'tabular-nums', fontSize:11.5,
                        borderLeft:`1px solid ${BV.lineSoft}`}}>
                      {r ? (pct === null ? '·' : pct + '%') : (d.domingo ? '' : '—')}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{padding:'7px 12px', fontSize:10.5, color:BV.slate, borderTop:`1px solid ${BV.lineSoft}`}}>
          Verde ≥ 90 · Ámbar ≥ 70 · Rojo &lt; 70 · Fondo rojo claro sin porcentaje = día sin bitácora
        </div>
      </div>
    </>
  )
}


// ═══════════ PRIORIDAD DE INVENTARIO — cruce bitácora × historial ══════════
function VistaRiesgo({bodegas, esGlobal, bodega}) {
  const [loading, setLoading] = useState(true)
  const [filas, setFilas]     = useState([])
  const [soloMia, setSoloMia] = useState(!esGlobal)

  useEffect(() => { (async () => {
    setLoading(true)
    let q = supabase.from('v_log_cat_riesgo').select('*')
      .order('indice_riesgo', {ascending:false}).limit(200)
    if (soloMia) q = q.eq('sucursal_codigo', bodega)
    const { data } = await q
    setFilas(data || [])
    setLoading(false)
  })() }, [soloMia, bodega])

  const fmtCLP = n => new Intl.NumberFormat('es-CL',
    {style:'currency', currency:'CLP', maximumFractionDigits:0}).format(n || 0)

  return (
    <>
      <BvGuia titulo="QUÉ ES ESTA PRIORIDAD Y CÓMO SE CALCULA">
        Responde una sola pregunta: <strong>¿qué categoría conviene inventariar primero?</strong> En vez
        de seguir el orden de siempre, cruza tres señales que ya están en el sistema.
        <div style={{marginTop:8}}>
          <strong>1. Desorden actual (hasta 40 puntos).</strong> Lo que el cierre de bodega viene
          observando y cuántos días lleva así. Una categoría desordenada hoy es una categoría que va a
          descuadrar mañana.
        </div>
        <div style={{marginTop:6}}>
          <strong>2. Antigüedad del último conteo (hasta 30).</strong> Mientras más tiempo sin contar,
          más error acumulado sin detectar.
        </div>
        <div style={{marginTop:6}}>
          <strong>3. Historial de descuadre (hasta 30).</strong> El ERI de esa categoría en inventarios
          anteriores. Las que siempre fallan tienden a seguir fallando.
        </div>
        <div style={{marginTop:8, paddingTop:8, borderTop:`1px solid ${BV.line}`}}>
          Es una sugerencia de priorización, no un reemplazo del plan anual. Úsala al armar el
          calendario del mes o cuando aparezca una ventana libre para un cíclico extra.
        </div>
      </BvGuia>

      {esGlobal && (
        <div style={{marginBottom:10}}>
          <button onClick={()=>setSoloMia(v=>!v)} style={bvBtn(soloMia?'outline':'solid')}>
            {soloMia ? 'VER TODAS LAS BODEGAS' : 'VIENDO LAS 4 BODEGAS'}
          </button>
        </div>
      )}

      <div style={{border:`1px solid ${BV.line}`, borderRadius:4, background:'#fff', overflowX:'auto'}}>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:880}}>
          <thead><tr style={{background:BV.bgHead}}>
            <th style={{...thS(true), width:70}}>Riesgo</th>
            <th style={thS()}>Bodega</th>
            <th style={thS()}>Categoría</th>
            <th style={thS(true)}>Días sin contar</th>
            <th style={thS(true)}>ERI histórico</th>
            <th style={thS(true)}>Descuadre acumulado</th>
            <th style={thS()}>Estado en bodega</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{padding:'28px 14px', textAlign:'center', color:BV.slate, fontSize:12.5}}>
                Calculando…</td></tr>
            ) : filas.length === 0 ? (
              <tr><td colSpan={7} style={{padding:'28px 14px', textAlign:'center', color:BV.slate, fontSize:12.5}}>
                Sin datos suficientes.</td></tr>
            ) : filas.map(f => {
              const r = f.indice_riesgo || 0
              const cR = r >= 60 ? BV.rojo : r >= 40 ? BV.ambar : BV.slate
              const eri = f.eri_historico === null ? null : Number(f.eri_historico)
              return (
                <tr key={f.sucursal_codigo + f.categoria}
                  style={{borderBottom:`1px solid ${BV.lineSoft}`,
                    boxShadow: r >= 60 ? `inset 3px 0 0 ${BV.rojo}` : 'none'}}>
                  <td style={{...tdS, textAlign:'right'}}>
                    <div style={{display:'inline-flex', alignItems:'center', gap:7}}>
                      <div style={{width:34, height:5, background:BV.lineSoft, borderRadius:2, overflow:'hidden'}}>
                        <div style={{width:`${r}%`, height:'100%', background:cR}}/>
                      </div>
                      <span style={{fontWeight:800, fontVariantNumeric:'tabular-nums', color:cR,
                        minWidth:22, textAlign:'right'}}>{r}</span>
                    </div>
                  </td>
                  <td style={{...tdS, whiteSpace:'nowrap'}}>
                    {BODEGAS.find(b=>b.k===f.sucursal_codigo)?.l || f.sucursal_codigo}</td>
                  <td style={{...tdS, fontWeight:700}}>{f.categoria}</td>
                  <td style={{...tdS, textAlign:'right', fontVariantNumeric:'tabular-nums',
                    color: f.dias_sin_inventario === null ? BV.rojo
                         : f.dias_sin_inventario > 120 ? BV.rojo
                         : f.dias_sin_inventario > 60 ? BV.ambar : BV.ink,
                    fontWeight: (f.dias_sin_inventario === null || f.dias_sin_inventario > 120) ? 700 : 400}}>
                    {f.dias_sin_inventario === null ? 'nunca' : f.dias_sin_inventario}</td>
                  <td style={{...tdS, textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:700,
                    color: eri === null ? BV.slate : eri >= 90 ? BV.verde : eri >= 70 ? BV.ambar : BV.rojo}}>
                    {eri === null ? '—' : eri + '%'}</td>
                  <td style={{...tdS, textAlign:'right', fontVariantNumeric:'tabular-nums',
                    color: Number(f.descuadre_hist_clp) > 1000000 ? BV.rojo : BV.ink}}>
                    {Number(f.descuadre_hist_clp) ? fmtCLP(f.descuadre_hist_clp) : '—'}</td>
                  <td style={{...tdS, fontSize:11.5}}>
                    {f.dias_observada > 0
                      ? <span style={{color:BV.rojo, fontWeight:600}}>
                          {(f.puntos_observados || []).join(', ')} · {f.dias_observada}d</span>
                      : <span style={{color:BV.slate}}>sin observaciones</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{padding:'8px 12px', fontSize:11, color:BV.slate, borderTop:`1px solid ${BV.lineSoft}`}}>
          Riesgo ≥ 60 en rojo. «Nunca» en días sin contar significa que esa categoría no aparece en
          ningún inventario cerrado de la bodega. El descuadre acumulado suma las diferencias absolutas
          valorizadas de todos sus conteos históricos.
        </div>
      </div>
    </>
  )
}
