// src/rrhh/desempeno/DesempenoApp.jsx
// Evaluación de Desempeño — Outlet de Puertas
// 3 dimensiones ponderables por proceso:
//   1) Técnica (jefatura): cuestionario BARS + batería de control de sesgo
//   2) Formal (AUTOMÁTICA): puntualidad y asistencia desde v_asis_jornadas
//   3) Recomendación de continuidad (jefatura, con justificación)
// Resultado ponderado + informe exportable a PDF.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabase'
import jsPDF from 'jspdf'
import 'jspdf-autotable'

// ─── Escala (del instrumento original, con anclas conductuales) ───────────────
const ESCALA = [
  { v:1, l:'Deficiente',       d:'No cumple con lo esperado para el cargo' },
  { v:2, l:'Bajo lo esperado', d:'Cumple parcialmente y requiere apoyo constante' },
  { v:3, l:'Cumple',           d:'Realiza adecuadamente las funciones de su cargo' },
  { v:4, l:'Sobre lo esperado',d:'Desempeño superior al requerido' },
  { v:5, l:'Destacado',        d:'Sobresaliente; es un referente para el equipo' },
]

// ─── Dimensión 1: ítems con anclas conductuales (BARS) ────────────────────────
const COMPETENCIAS = [
  { g:'Desempeño técnico', items:[
    { k:'t1', l:'Cumplimiento de las funciones del cargo',
      a1:'Deja tareas centrales sin ejecutar o mal ejecutadas de forma recurrente',
      a3:'Ejecuta las funciones del cargo sin observaciones relevantes',
      a5:'Ejecuta todas sus funciones y anticipa necesidades no pedidas' },
    { k:'t2', l:'Calidad del trabajo y control de errores',
      a1:'Sus errores generan retrabajos o reclamos frecuentes',
      a3:'Errores ocasionales que detecta y corrige a tiempo',
      a5:'Trabajo consistentemente sin errores; otros usan su trabajo como referencia' },
    { k:'t3', l:'Ritmo de trabajo y productividad',
      a1:'Requiere plazos extendidos o deja pendientes acumulados',
      a3:'Cumple los volúmenes y plazos normales del cargo',
      a5:'Rinde por sobre el estándar incluso en períodos de alta demanda' },
  ]},
  { g:'Aprendizaje y procedimientos', items:[
    { k:'t4', l:'Aprendizaje y aplicación de nuevas instrucciones',
      a1:'Hay que repetirle instrucciones varias veces; no las incorpora',
      a3:'Incorpora instrucciones nuevas con un refuerzo razonable',
      a5:'Aprende a la primera y ayuda a otros a incorporar lo nuevo' },
    { k:'t5', l:'Cumplimiento de procedimientos y normas internas (SOP)',
      a1:'Omite procedimientos aunque los conoce',
      a3:'Sigue los procedimientos establecidos',
      a5:'Sigue los procedimientos y propone mejoras fundadas' },
  ]},
  { g:'Autonomía y confiabilidad', items:[
    { k:'t6', l:'Autonomía en la ejecución',
      a1:'Necesita seguimiento constante para avanzar',
      a3:'Trabaja sin seguimiento en tareas habituales',
      a5:'Resuelve imprevistos por sí mismo dentro de su ámbito' },
    { k:'t7', l:'Responsabilidad sobre sus tareas y compromisos',
      a1:'Se desentiende de resultados o culpa a terceros',
      a3:'Responde por sus tareas y plazos',
      a5:'Asume resultados del equipo más allá de su tarea individual' },
    { k:'t8', l:'Confiabilidad para la operación diaria',
      a1:'La operación debe planificarse asumiendo que puede fallar',
      a3:'Se puede contar con él/ella en la operación normal',
      a5:'Es a quien se recurre cuando algo no puede fallar' },
  ]},
  { g:'Colaboración y conducta', items:[
    { k:'t9', l:'Disposición para trabajar con compañeros',
      a1:'Evita colaborar o entorpece el trabajo conjunto',
      a3:'Buena disposición en el trabajo conjunto habitual',
      a5:'Genera activamente buen trabajo en equipo; otros quieren trabajar con él/ella' },
    { k:'t10', l:'Colaboración en apoyo a otras tareas o áreas',
      a1:'Se niega o pone trabas cuando se requiere apoyo fuera de su tarea',
      a3:'Apoya cuando se le solicita',
      a5:'Se ofrece a apoyar sin que se le pida cuando ve necesidad' },
    { k:'t11', l:'Respeto hacia compañeros y jefaturas',
      a1:'Tratos irrespetuosos o descalificaciones registradas',
      a3:'Trato respetuoso y correcto',
      a5:'Su trato mejora el clima incluso en situaciones de tensión' },
  ]},
]
const ITEMS = COMPETENCIAS.flatMap(c => c.items)

// ─── Batería de control de sesgo ──────────────────────────────────────────────
const FREC = ['Nunca','Rara vez','A veces','Frecuentemente','Siempre']
const CONTROL_TXT = {
  c_errores:  'Describe 2 errores o situaciones mal manejadas por el evaluado durante el período, con fecha aproximada. Todos cometemos errores: si no recuerdas ninguno, probablemente estás evaluando una impresión general y no el período real.',
  c_aportes:  'Describe 2 aportes o logros concretos del evaluado durante el período, con fecha aproximada.',
  c_rehacer:  'Otras personas deben revisar o rehacer partes de su trabajo',
  c_conflictos:'Ha protagonizado roces o conflictos que afectaron el clima del equipo',
  c_reemplazo:'Si renunciara mañana, ¿qué tan difícil sería reemplazar su desempeño actual?',
  c_recontratar:'Si hoy estuvieras formando tu equipo desde cero, ¿volverías a contratar a esta persona?',
  c_relacion: '¿Tienes con el evaluado una amistad cercana, parentesco o un conflicto personal previo?',
  c_periodo:  '¿Tu evaluación pondera el período completo, y no principalmente las últimas semanas?',
}
const REEMPLAZO = ['Muy fácil','Fácil','Ni fácil ni difícil','Difícil','Muy difícil']

// ─── Recomendación de continuidad (Dimensión 3) ───────────────────────────────
const RECOMS = [
  { k:'plena',          l:'Continuidad plena',            nota:5, c:'#34C759', d:'Recomiendo su continuidad sin condiciones' },
  { k:'con_plan',       l:'Continuidad con plan de mejora',nota:3, c:'#FF9500', d:'Recomiendo continuidad sujeta a un plan de mejora con plazos' },
  { k:'no_continuidad', l:'No continuidad',               nota:1, c:'#FF3B30', d:'No recomiendo su continuidad en la empresa' },
]

const CATEGORIAS = [
  { min:4.3, l:'Destacado',                          c:'#34C759' },
  { min:3.6, l:'Competente',                         c:'#0A84FF' },
  { min:2.9, l:'En desarrollo — con plan de mejora', c:'#FF9500' },
  { min:0,   l:'Insuficiente — revisar continuidad', c:'#FF3B30' },
]
const categoriaDe = n => CATEGORIAS.find(c => n >= c.min)

// ─── Notas de la dimensión formal (brackets sobre datos reales) ───────────────
const notaPuntualidad = p => p>=95?5 : p>=90?4.5 : p>=85?4 : p>=78?3.5 : p>=70?3 : p>=60?2 : 1
const notaAsistencia  = p => p>=98?5 : p>=95?4.5 : p>=92?4 : p>=88?3.5 : p>=84?3 : p>=75?2 : 1

const fFecha = d => { if(!d) return '—'; const [y,m,dd]=String(d).slice(0,10).split('-'); return `${dd}-${m}-${y}` }
const hoyISO = () => new Date().toISOString().slice(0,10)
const r2 = n => Math.round(n*100)/100

// ─── Motor de alertas de sesgo ────────────────────────────────────────────────
function calcularAlertas(resp) {
  const alertas = []
  const notas = ITEMS.map(it => resp.items?.[it.k]?.p).filter(n => n != null)
  if (notas.length === 0) return alertas
  const avg = notas.reduce((s,n)=>s+n,0) / notas.length
  const sd = Math.sqrt(notas.reduce((s,n)=>s+(n-avg)**2,0) / notas.length)
  const ctl = resp.control || {}

  if (avg >= 4.5 && sd < 0.5) alertas.push({ k:'halo', t:'Posible efecto halo', d:`Puntuación uniformemente alta (promedio ${r2(avg)}, dispersión ${r2(sd)}). Ninguna persona destaca por igual en todas las competencias.` })
  if (avg <= 2.0 && sd < 0.5) alertas.push({ k:'severidad', t:'Posible sesgo de severidad', d:`Puntuación uniformemente baja (promedio ${r2(avg)}). Revise si hay competencias donde el desempeño sí cumple.` })
  if (sd < 0.3 && avg > 2.0 && avg < 4.5) alertas.push({ k:'uniforme', t:'Puntuación sin matices', d:'Todos los ítems recibieron prácticamente la misma nota. Diferenciar fortalezas y debilidades hace la evaluación más útil.' })
  const t2 = resp.items?.t2?.p
  if (t2 >= 4 && (ctl.c_rehacer ?? 0) >= 4) alertas.push({ k:'contra_calidad', t:'Contradicción en calidad', d:`Calidad evaluada con ${t2}, pero declara que su trabajo debe rehacerse "${FREC[ctl.c_rehacer-1]}".` })
  const cond = Math.min(resp.items?.t9?.p ?? 5, resp.items?.t11?.p ?? 5)
  if (cond >= 4 && (ctl.c_conflictos ?? 0) >= 4) alertas.push({ k:'contra_conducta', t:'Contradicción en conducta', d:`Conducta evaluada alta, pero declara conflictos "${FREC[ctl.c_conflictos-1]}".` })
  if (avg >= 4.3 && (ctl.c_reemplazo ?? 5) <= 2) alertas.push({ k:'contra_reemplazo', t:'Contradicción de valor', d:'Puntuación alta pero declara que sería fácil de reemplazar. Una de las dos apreciaciones no refleja el desempeño real.' })
  if (ctl.c_recontratar === 'no' && avg >= 4) alertas.push({ k:'contra_recontrato', t:'Contradicción de recontratación', d:'No lo recontrataría pese a evaluar su desempeño sobre lo esperado. La justificación de continuidad debe explicar esta diferencia.' })
  if (ctl.c_recontratar === 'si' && avg <= 2.2) alertas.push({ k:'contra_recontrato2', t:'Contradicción de recontratación', d:'Sí lo recontrataría pese a evaluar su desempeño como deficiente.' })
  if (ctl.c_relacion === 'si') alertas.push({ k:'relacion', t:'Relación personal declarada', d:`El evaluador declara vínculo personal con el evaluado${ctl.c_relacion_det?`: "${ctl.c_relacion_det}"`:''}. Considerar contraparte en la revisión.` })
  if (ctl.c_periodo === 'no') alertas.push({ k:'recencia', t:'Sesgo de recencia declarado', d:'El evaluador reconoce que su evaluación pondera principalmente las últimas semanas y no el período completo.' })
  for (const it of ITEMS) {
    const r = resp.items?.[it.k]
    if (r && (r.p === 1 || r.p === 5) && String(r.ev||'').trim().length < 30)
      alertas.push({ k:`ev_${it.k}`, t:'Evidencia débil en puntaje extremo', d:`"${it.l}" recibió ${r.p} con evidencia insuficiente.` })
  }
  return alertas
}

// ═══════════════════════════════════════════════════════════════════════════════
export function DesempenoApp({ cu, onVolverHubRrhh, onCerrarSesion }) {
  const [ruta, setRuta] = useState({ v:'procesos' })
  const [procesos, setProcesos] = useState([])
  const [cargando, setCarg] = useState(true)
  const [modalProc, setModalProc] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => { cargarProcesos() }, [])
  async function cargarProcesos() {
    setCarg(true)
    try {
      const { data, error } = await supabase.from('eval_procesos').select('*').order('created_at', {ascending:false})
      if (error) throw error
      setProcesos(data||[])
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
    finally { setCarg(false) }
  }

  return (
    <div style={{minHeight:'100vh',background:'var(--bg-app)'}}>
      <header style={{background:'var(--bg-surface)',borderBottom:'1px solid var(--border)',padding:'12px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:50}}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <button onClick={onVolverHubRrhh} style={btnSec}>&larr; Gestión de Personas</button>
          <div style={{fontSize:22}}>📋</div>
          <div>
            <div style={{fontSize:17,fontWeight:600}}>Evaluación de Desempeño</div>
            <div style={{fontSize:11,color:'var(--text-muted)'}}>3 dimensiones ponderadas · asistencia automática · control de sesgo</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:13,fontWeight:600}}>{cu.nombre}</div>
          </div>
          <button onClick={onCerrarSesion} style={btnGhost}>Salir</button>
        </div>
      </header>

      {msg && (
        <div style={{margin:'12px 24px 0',padding:'9px 14px',borderRadius:8,fontSize:13,
          background: msg.tipo==='error' ? '#FF3B3012' : '#34C75912',
          border: `1px solid ${msg.tipo==='error' ? '#FF3B3040' : '#34C75940'}`,
          display:'flex',justifyContent:'space-between'}}>
          <span>{msg.tipo==='error'?'⚠️':'✅'} {msg.txt}</span>
          <button onClick={()=>setMsg(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
        </div>
      )}

      <main style={{padding:24,maxWidth:1100,margin:'0 auto'}}>
        {ruta.v === 'procesos' && (
          <VistaProcesos procesos={procesos} cargando={cargando}
            onNuevo={()=>setModalProc(true)} onAbrir={p=>setRuta({v:'proceso', proc:p})} />
        )}
        {ruta.v === 'proceso' && (
          <VistaProceso proc={ruta.proc} cu={cu} setMsg={setMsg}
            onVolver={()=>setRuta({v:'procesos'})}
            onEvaluar={(ev)=>setRuta({v:'form', proc:ruta.proc, evalRow:ev})}
            onInforme={(ev)=>setRuta({v:'informe', proc:ruta.proc, evalRow:ev})} />
        )}
        {ruta.v === 'form' && (
          <FormEvaluacion proc={ruta.proc} evalRow={ruta.evalRow} cu={cu} setMsg={setMsg}
            onVolver={()=>setRuta({v:'proceso', proc:ruta.proc})}
            onEnviada={(ev)=>setRuta({v:'informe', proc:ruta.proc, evalRow:ev})} />
        )}
        {ruta.v === 'informe' && (
          <InformeEvaluacion proc={ruta.proc} evalRow={ruta.evalRow}
            onVolver={()=>setRuta({v:'proceso', proc:ruta.proc})} />
        )}
      </main>

      {modalProc && (
        <ModalProceso cu={cu}
          onCerrar={()=>setModalProc(false)}
          onCreado={async()=>{ setModalProc(false); await cargarProcesos() }} />
      )}
    </div>
  )
}

// ─── Vista: lista de procesos ─────────────────────────────────────────────────
function VistaProcesos({ procesos, cargando, onNuevo, onAbrir }) {
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
        <div style={{fontSize:13,color:'var(--text-muted)'}}>
          <strong style={{color:'var(--text)',fontSize:15}}>{procesos.length}</strong> proceso(s) de evaluación
        </div>
        <button onClick={onNuevo} style={btnPri}>➕ Nuevo proceso</button>
      </div>
      {cargando ? <div style={{padding:60,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</div> :
      procesos.length === 0 ? (
        <div style={{maxWidth:520,margin:'50px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'40px 28px'}}>
          <div style={{fontSize:48,marginBottom:12}}>📋</div>
          <h3 style={{margin:'0 0 6px 0'}}>Sin procesos de evaluación</h3>
          <p style={{color:'var(--text-muted)',fontSize:13,margin:'0 0 20px 0'}}>
            Un proceso agrupa evaluaciones bajo un período y ponderaciones comunes
            (ej: "Paso a indefinido — Julio 2026" o "Evaluación anual 2026").
          </p>
          <button onClick={onNuevo} style={btnPri}>➕ Crear primer proceso</button>
        </div>
      ) : (
        <div style={{display:'grid',gap:10}}>
          {procesos.map(p => (
            <button key={p.id} onClick={()=>onAbrir(p)}
              style={{display:'flex',alignItems:'center',gap:14,padding:'14px 18px',background:'var(--bg-surface)',
                border:'1px solid var(--border)',borderRadius:12,cursor:'pointer',textAlign:'left'}}>
              <div style={{fontSize:24}}>{p.tipo==='indefinido'?'📄':p.tipo==='anual'?'📅':'🔄'}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:14.5,fontWeight:700}}>{p.nombre}</div>
                <div style={{fontSize:11.5,color:'var(--text-muted)',marginTop:2}}>
                  {fFecha(p.periodo_desde)} → {fFecha(p.periodo_hasta)} · Ponderación: técnica {p.pond_tecnica}% · formal {p.pond_formal}% · recomendación {p.pond_recom}%
                </div>
              </div>
              <span style={{fontSize:10,fontWeight:800,padding:'3px 10px',borderRadius:100,
                background: p.estado==='abierto' ? '#34C75918' : 'var(--text-muted)18',
                color: p.estado==='abierto' ? '#34C759' : 'var(--text-muted)'}}>
                {p.estado.toUpperCase()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Modal: nuevo proceso ─────────────────────────────────────────────────────
function ModalProceso({ cu, onCerrar, onCreado }) {
  const [form, setForm] = useState({
    nombre:'', tipo:'continuidad',
    desde: new Date(Date.now()-90*86400000).toISOString().slice(0,10),
    hasta: hoyISO(),
    pt:50, pf:30, pr:20,
  })
  const [guardando, setG] = useState(false)
  const [err, setErr] = useState(null)
  const suma = Number(form.pt)+Number(form.pf)+Number(form.pr)

  async function crear() {
    if (!form.nombre.trim()) { setErr('El nombre es obligatorio'); return }
    if (suma !== 100) { setErr(`Las ponderaciones deben sumar 100 (hoy: ${suma})`); return }
    setG(true); setErr(null)
    try {
      const { error } = await supabase.from('eval_procesos').insert({
        nombre: form.nombre.trim(), tipo: form.tipo,
        periodo_desde: form.desde, periodo_hasta: form.hasta,
        pond_tecnica: Number(form.pt), pond_formal: Number(form.pf), pond_recom: Number(form.pr),
        creado_por: cu.id,
      })
      if (error) throw error
      await onCreado()
    } catch(e) { setErr(e.message); setG(false) }
  }

  return (
    <Overlay onCerrar={onCerrar}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:14}}>➕ Nuevo proceso de evaluación</div>
      <div style={{display:'grid',gap:10,marginBottom:14}}>
        <div>
          <label style={lblM}>Nombre</label>
          <input value={form.nombre} onChange={e=>setForm(f=>({...f,nombre:e.target.value}))}
            placeholder='Ej: Paso a indefinido — Julio 2026' style={inpFull}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
          <div>
            <label style={lblM}>Tipo</label>
            <select value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))} style={inpFull}>
              <option value='continuidad'>Continuidad</option>
              <option value='indefinido'>Paso a indefinido</option>
              <option value='anual'>Anual</option>
            </select>
          </div>
          <div><label style={lblM}>Período desde</label>
            <input type='date' value={form.desde} onChange={e=>setForm(f=>({...f,desde:e.target.value}))} style={inpFull}/></div>
          <div><label style={lblM}>Período hasta</label>
            <input type='date' value={form.hasta} onChange={e=>setForm(f=>({...f,hasta:e.target.value}))} style={inpFull}/></div>
        </div>
        <div>
          <label style={lblM}>Ponderaciones (deben sumar 100)</label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
            {[['pt','Técnica jefatura'],['pf','Formal (asistencia)'],['pr','Recomendación']].map(([k,l])=>(
              <div key={k}>
                <div style={{fontSize:10.5,color:'var(--text-muted)',marginBottom:3}}>{l}</div>
                <input type='number' min='0' max='100' value={form[k]}
                  onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={inpFull}/>
              </div>
            ))}
          </div>
          <div style={{fontSize:11,marginTop:5,color: suma===100 ? 'var(--success,#34C759)' : '#FF3B30',fontWeight:600}}>
            Suma: {suma}/100
          </div>
        </div>
      </div>
      {err && <div style={{fontSize:12,color:'#FF3B30',marginBottom:12}}>⚠️ {err}</div>}
      <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button onClick={onCerrar} disabled={guardando} style={btnSec}>Cancelar</button>
        <button onClick={crear} disabled={guardando} style={btnPri}>{guardando?'Creando...':'Crear proceso'}</button>
      </div>
    </Overlay>
  )
}

// ─── Vista: detalle de proceso (evaluaciones) ─────────────────────────────────
function VistaProceso({ proc, cu, setMsg, onVolver, onEvaluar, onInforme }) {
  const [evals, setEvals] = useState([])
  const [emps, setEmps] = useState([])
  const [cargando, setCarg] = useState(true)
  const [busq, setBusq] = useState('')
  const [agregando, setAgregando] = useState(false)

  useEffect(() => { cargar() }, [proc.id])
  async function cargar() {
    setCarg(true)
    try {
      const [ev, em] = await Promise.all([
        supabase.from('eval_evaluaciones').select('*').eq('proceso_id', proc.id).order('created_at'),
        supabase.from('rrhh_empleados').select('cod_contaline,nombre,rut,sucursal_id,cargo').eq('activo',true).order('nombre'),
      ])
      if (ev.error) throw ev.error
      setEvals(ev.data||[]); setEmps(em.data||[])
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
    finally { setCarg(false) }
  }

  const empPorCod = useMemo(()=>Object.fromEntries(emps.map(e=>[e.cod_contaline,e])),[emps])
  const yaEval = new Set(evals.map(e=>e.cod_contaline))
  const candidatos = useMemo(() => {
    const q = busq.trim().toLowerCase()
    if (!q) return []
    return emps.filter(e=>!yaEval.has(e.cod_contaline))
      .filter(e=>e.nombre.toLowerCase().includes(q)||String(e.rut||'').includes(q)).slice(0,6)
  }, [busq, emps, evals])

  async function agregarEval(emp) {
    setAgregando(true)
    try {
      const { data, error } = await supabase.from('eval_evaluaciones').insert({
        proceso_id: proc.id, cod_contaline: emp.cod_contaline, evaluador_id: cu.id,
      }).select().single()
      if (error) throw error
      setBusq('')
      onEvaluar(data)
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
    finally { setAgregando(false) }
  }

  return (
    <div>
      <button onClick={onVolver} style={{...btnSec,marginBottom:14}}>&larr; Procesos</button>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 18px',marginBottom:14}}>
        <div style={{fontSize:16,fontWeight:800}}>{proc.nombre}</div>
        <div style={{fontSize:12,color:'var(--text-muted)',marginTop:3}}>
          Período evaluado: {fFecha(proc.periodo_desde)} → {fFecha(proc.periodo_hasta)} ·
          Técnica {proc.pond_tecnica}% · Formal {proc.pond_formal}% · Recomendación {proc.pond_recom}%
        </div>
      </div>

      <div style={{marginBottom:14}}>
        <label style={lblM}>Agregar trabajador a evaluar</label>
        <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder='Buscar por nombre o RUT...' style={{...inpFull,maxWidth:420}}/>
        {busq.trim() && (
          <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:6,maxWidth:420}}>
            {candidatos.length===0 && <div style={{fontSize:12,color:'var(--text-muted)',padding:6}}>Sin coincidencias (o ya está en el proceso)</div>}
            {candidatos.map(e=>(
              <button key={e.cod_contaline} onClick={()=>agregarEval(e)} disabled={agregando}
                style={{display:'flex',justifyContent:'space-between',padding:'8px 11px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',textAlign:'left'}}>
                <span style={{fontSize:12.5,fontWeight:600}}>{e.nombre}</span>
                <span style={{fontSize:11,color:'var(--text-muted)'}}>{e.sucursal_id||''} {e.cargo?`· ${e.cargo}`:''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {cargando ? <div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</div> :
      evals.length === 0 ? (
        <div style={{padding:'30px 0',textAlign:'center',color:'var(--text-muted)',fontSize:13}}>Aún no hay evaluaciones en este proceso.</div>
      ) : (
        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
            <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
              {['Trabajador','Sucursal','Estado','Nota final','Categoría','Alertas',''].map(h=>(
                <th key={h} style={thS}>{h}</th>))}
            </tr></thead>
            <tbody>
              {evals.map(ev => {
                const emp = empPorCod[ev.cod_contaline]
                const cat = ev.nota_final != null ? categoriaDe(Number(ev.nota_final)) : null
                const nAl = (ev.alertas||[]).length
                return (
                  <tr key={ev.id} style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={tdS}><strong>{emp?.nombre || `#${ev.cod_contaline}`}</strong></td>
                    <td style={tdS}>{emp?.sucursal_id || '—'}</td>
                    <td style={tdS}>
                      <span style={{fontSize:10,fontWeight:800,padding:'2px 9px',borderRadius:100,
                        background: ev.estado==='enviada' ? '#34C75918' : '#FF950018',
                        color: ev.estado==='enviada' ? '#34C759' : '#FF9500'}}>
                        {ev.estado==='enviada'?'ENVIADA':'BORRADOR'}
                      </span>
                    </td>
                    <td style={{...tdS,fontWeight:800,fontSize:14}}>{ev.nota_final != null ? Number(ev.nota_final).toFixed(2) : '—'}</td>
                    <td style={tdS}>{cat ? <span style={{color:cat.c,fontWeight:700,fontSize:11.5}}>{cat.l}</span> : '—'}</td>
                    <td style={tdS}>{nAl > 0 ? <span style={{color:'#FF9500',fontWeight:700}}>⚠️ {nAl}</span> : ev.estado==='enviada' ? '✓' : '—'}</td>
                    <td style={{...tdS,textAlign:'right'}}>
                      {ev.estado === 'borrador'
                        ? <button onClick={()=>onEvaluar(ev)} style={{...btnPri,padding:'5px 12px',fontSize:12}}>Evaluar</button>
                        : <button onClick={()=>onInforme(ev)} style={{...btnSec,padding:'5px 12px',fontSize:12}}>📄 Informe</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Formulario de evaluación ─────────────────────────────────────────────────
function FormEvaluacion({ proc, evalRow, cu, setMsg, onVolver, onEnviada }) {
  const [emp, setEmp] = useState(null)
  const [resp, setResp] = useState(evalRow.respuestas && Object.keys(evalRow.respuestas).length ? evalRow.respuestas : { items:{}, control:{} })
  const [recom, setRecom] = useState(evalRow.recomendacion || null)
  const [justif, setJustif] = useState(evalRow.justificacion || '')
  const [asis, setAsis] = useState(null)      // métricas del período
  const [guardando, setG] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { cargarContexto() }, [evalRow.id])
  async function cargarContexto() {
    try {
      const [e, j] = await Promise.all([
        supabase.from('rrhh_empleados').select('*').eq('cod_contaline', evalRow.cod_contaline).single(),
        supabase.from('v_asis_jornadas').select('estado_dia,min_atraso_contable')
          .eq('cod_contaline', evalRow.cod_contaline)
          .gte('fecha', proc.periodo_desde).lte('fecha', proc.periodo_hasta)
          .limit(20000),
      ])
      setEmp(e.data)
      const rows = (j.data||[]).filter(r=>r.estado_dia !== 'sin_turno')
      if (rows.length === 0) { setAsis({ sinDatos:true }); return }
      const punt = rows.filter(r=>['puntual','hizo_extra'].includes(r.estado_dia)).length
      const ausencias = rows.filter(r=>r.estado_dia==='sin_marcas').length
      const pctP = Math.round(punt / rows.length * 100)
      const pctA = Math.round((rows.length - ausencias) / rows.length * 100)
      const minAtr = rows.reduce((s,r)=>s+(r.min_atraso_contable||0),0)
      setAsis({ jornadas: rows.length, pctPuntualidad: pctP, pctAsistencia: pctA, ausencias, minAtraso: minAtr,
        notaP: notaPuntualidad(pctP), notaA: notaAsistencia(pctA),
        nota: r2(notaPuntualidad(pctP)*0.6 + notaAsistencia(pctA)*0.4) })
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }

  const setItem = (k, campo, val) => setResp(r=>({ ...r, items:{ ...r.items, [k]: { ...(r.items?.[k]||{}), [campo]: val } } }))
  const setCtl  = (k, val) => setResp(r=>({ ...r, control:{ ...(r.control||{}), [k]: val } }))
  const ctl = resp.control || {}

  const notasItems = ITEMS.map(it=>resp.items?.[it.k]?.p).filter(n=>n!=null)
  const notaTec = notasItems.length === ITEMS.length ? r2(notasItems.reduce((s,n)=>s+n,0)/notasItems.length) : null
  const notaRecom = recom ? RECOMS.find(r=>r.k===recom).nota : null

  const notaFinal = useMemo(() => {
    if (notaTec == null || notaRecom == null) return null
    const dims = [
      { nota: notaTec, pond: proc.pond_tecnica },
      { nota: asis && !asis.sinDatos ? asis.nota : null, pond: proc.pond_formal },
      { nota: notaRecom, pond: proc.pond_recom },
    ].filter(d => d.nota != null)
    const pondTotal = dims.reduce((s,d)=>s+d.pond,0)
    return r2(dims.reduce((s,d)=>s + d.nota * d.pond, 0) / pondTotal)
  }, [notaTec, notaRecom, asis, proc])

  async function guardarBorrador() {
    setG(true); setErr(null)
    try {
      const { error } = await supabase.from('eval_evaluaciones').update({
        respuestas: resp, recomendacion: recom, justificacion: justif || null,
        updated_at: new Date().toISOString(),
      }).eq('id', evalRow.id)
      if (error) throw error
      setMsg({tipo:'ok', txt:'Borrador guardado'})
    } catch(e) { setErr(e.message) }
    finally { setG(false) }
  }

  async function enviar() {
    // Validaciones duras
    const faltan = ITEMS.filter(it => resp.items?.[it.k]?.p == null)
    if (faltan.length) { setErr(`Faltan ${faltan.length} ítem(s) por puntuar en la dimensión técnica.`); return }
    for (const it of ITEMS) {
      const r = resp.items[it.k]
      if ((r.p === 1 || r.p === 5) && String(r.ev||'').trim().length < 20) {
        setErr(`"${it.l}" tiene puntaje extremo (${r.p}): describe la evidencia concreta que lo respalda (mín. 20 caracteres).`); return
      }
    }
    if (String(ctl.c_errores||'').trim().length < 30) { setErr('Control de sesgo: describe los 2 errores del período (mín. 30 caracteres). Si evalúas alto y no recuerdas ninguno, revisa tu evaluación.'); return }
    if (String(ctl.c_aportes||'').trim().length < 30) { setErr('Control de sesgo: describe los 2 aportes concretos del período (mín. 30 caracteres).'); return }
    for (const k of ['c_rehacer','c_conflictos','c_reemplazo']) if (ctl[k] == null) { setErr('Responde toda la batería de control de sesgo.'); return }
    for (const k of ['c_recontratar','c_relacion','c_periodo']) if (!ctl[k]) { setErr('Responde toda la batería de control de sesgo.'); return }
    if (!recom) { setErr('Selecciona la recomendación de continuidad.'); return }
    if (String(justif||'').trim().length < 80) { setErr('La justificación de la recomendación es obligatoria (mín. 80 caracteres): fundamenta con hechos del período.'); return }
    if (ctl.c_relacion === 'si' && String(ctl.c_relacion_det||'').trim().length < 5) { setErr('Declaraste una relación personal: especifica cuál.'); return }

    const alertas = calcularAlertas(resp)
    const notaFormalFinal = asis && !asis.sinDatos ? asis.nota : null
    const snapshot = asis && !asis.sinDatos ? asis : { sinDatos:true }
    const cat = categoriaDe(notaFinal)

    setG(true); setErr(null)
    try {
      const { data, error } = await supabase.from('eval_evaluaciones').update({
        respuestas: resp, alertas,
        nota_tecnica: notaTec,
        asis_snapshot: snapshot, nota_formal: notaFormalFinal,
        recomendacion: recom, justificacion: justif.trim(), nota_recom: notaRecom,
        nota_final: notaFinal, categoria: cat.l,
        estado: 'enviada', enviada_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', evalRow.id).select().single()
      if (error) throw error
      onEnviada(data)
    } catch(e) { setErr(e.message); setG(false) }
  }

  return (
    <div style={{maxWidth:860,margin:'0 auto'}}>
      <button onClick={onVolver} style={{...btnSec,marginBottom:14}}>&larr; Volver al proceso</button>

      {/* Cabecera del evaluado */}
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 18px',marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
          <div>
            <div style={{fontSize:16,fontWeight:800}}>{emp?.nombre || '...'}</div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>
              {emp?.cargo || 'Sin cargo'} · {emp?.sucursal_id || '—'} · RUT {emp?.rut || '—'} · Evaluador: {cu.nombre}
            </div>
          </div>
          <div style={{textAlign:'right',fontSize:12,color:'var(--text-muted)'}}>
            {proc.nombre}<br/>{fFecha(proc.periodo_desde)} → {fFecha(proc.periodo_hasta)}
          </div>
        </div>
        <div style={{fontSize:11.5,color:'var(--text-muted)',marginTop:10,padding:'8px 11px',background:'var(--bg-app)',borderRadius:8}}>
          Evalúa <strong>hechos observables del período completo</strong>, no impresiones generales ni el último mes.
          Los puntajes 1 y 5 exigen evidencia concreta. Las preguntas de control detectan inconsistencias y quedan
          registradas en el informe — responde con honestidad, no penalizan: dan credibilidad a tu evaluación.
        </div>
      </div>

      {/* ═══ DIMENSIÓN 1 ═══ */}
      <SecTitle n='1' t={`Evaluación técnica de jefatura (${proc.pond_tecnica}%)`} extra={notaTec!=null?`Nota parcial: ${notaTec.toFixed(2)}`:null}/>
      {COMPETENCIAS.map(g => (
        <div key={g.g} style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',margin:'0 0 8px 2px'}}>{g.g}</div>
          <div style={{display:'grid',gap:8}}>
            {g.items.map(it => {
              const r = resp.items?.[it.k] || {}
              const extremo = r.p === 1 || r.p === 5
              return (
                <div key={it.k} style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,padding:'11px 14px'}}>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>{it.l}</div>
                  <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                    {ESCALA.map(e => (
                      <button key={e.v} onClick={()=>setItem(it.k,'p',e.v)}
                        title={e.v===1?it.a1:e.v===3?it.a3:e.v===5?it.a5:e.d}
                        style={{flex:'1 1 90px',padding:'7px 6px',borderRadius:8,cursor:'pointer',fontSize:11,
                          fontWeight: r.p===e.v ? 800 : 500,
                          background: r.p===e.v ? 'var(--accent)' : 'var(--bg-app)',
                          color: r.p===e.v ? 'white' : 'var(--text-muted)',
                          border:`1px solid ${r.p===e.v ? 'var(--accent)' : 'var(--border)'}`}}>
                        {e.v} · {e.l}
                      </button>
                    ))}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:7,fontSize:10,color:'var(--text-muted)'}}>
                    <span>1 = {it.a1}</span><span style={{textAlign:'center'}}>3 = {it.a3}</span><span style={{textAlign:'right'}}>5 = {it.a5}</span>
                  </div>
                  {extremo && (
                    <div style={{marginTop:8}}>
                      <label style={{...lblM,color:'#FF9500'}}>Evidencia obligatoria del puntaje {r.p} (hecho concreto, con fecha aproximada)</label>
                      <textarea value={r.ev||''} onChange={e=>setItem(it.k,'ev',e.target.value)} rows={2}
                        placeholder='Ej: "En mayo detectó y corrigió un error de inventario que habría costado..."'
                        style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Batería de control */}
      <div style={{background:'var(--bg-surface)',border:'1px dashed var(--border)',borderRadius:12,padding:'14px 16px',marginBottom:20}}>
        <div style={{fontSize:12.5,fontWeight:800,marginBottom:3}}>🧭 Control de objetividad</div>
        <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:12}}>
          Estas preguntas cruzan tus respuestas para detectar sesgos habituales (halo, severidad, recencia, afinidad).
          Las inconsistencias no anulan la evaluación: quedan como alertas visibles en el informe.
        </div>
        <div style={{display:'grid',gap:12}}>
          <div>
            <label style={lblM}>{CONTROL_TXT.c_errores}</label>
            <textarea value={ctl.c_errores||''} onChange={e=>setCtl('c_errores',e.target.value)} rows={2} style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
          </div>
          <div>
            <label style={lblM}>{CONTROL_TXT.c_aportes}</label>
            <textarea value={ctl.c_aportes||''} onChange={e=>setCtl('c_aportes',e.target.value)} rows={2} style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
          </div>
          <FilaEscala l={CONTROL_TXT.c_rehacer} opciones={FREC} val={ctl.c_rehacer} onSel={v=>setCtl('c_rehacer',v)}/>
          <FilaEscala l={CONTROL_TXT.c_conflictos} opciones={FREC} val={ctl.c_conflictos} onSel={v=>setCtl('c_conflictos',v)}/>
          <FilaEscala l={CONTROL_TXT.c_reemplazo} opciones={REEMPLAZO} val={ctl.c_reemplazo} onSel={v=>setCtl('c_reemplazo',v)}/>
          <FilaSiNo l={CONTROL_TXT.c_recontratar} val={ctl.c_recontratar} onSel={v=>setCtl('c_recontratar',v)}/>
          <FilaSiNo l={CONTROL_TXT.c_relacion} val={ctl.c_relacion} onSel={v=>setCtl('c_relacion',v)}/>
          {ctl.c_relacion === 'si' && (
            <input value={ctl.c_relacion_det||''} onChange={e=>setCtl('c_relacion_det',e.target.value)}
              placeholder='Especifica la relación (ej: amistad fuera del trabajo, primo, conflicto en 2025...)' style={inpFull}/>
          )}
          <FilaSiNo l={CONTROL_TXT.c_periodo} val={ctl.c_periodo} onSel={v=>setCtl('c_periodo',v)}/>
        </div>
      </div>

      {/* ═══ DIMENSIÓN 2 ═══ */}
      <SecTitle n='2' t={`Aspectos formales — puntualidad y asistencia (${proc.pond_formal}%)`} extra={asis && !asis.sinDatos ? `Nota automática: ${asis.nota.toFixed(2)}` : null}/>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 16px',marginBottom:20}}>
        {!asis ? <div style={{fontSize:12.5,color:'var(--text-muted)'}}>Calculando desde Control de Asistencia...</div> :
        asis.sinDatos ? (
          <div style={{fontSize:12.5,color:'var(--text-muted)'}}>
            ⚠️ Sin jornadas con turno en el período para este trabajador. Esta dimensión no se aplicará y las
            ponderaciones se redistribuirán proporcionalmente entre las otras dos.
          </div>
        ) : (
          <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:10}}>
              <Metrica l='Jornadas con turno' v={asis.jornadas}/>
              <Metrica l='Puntualidad' v={`${asis.pctPuntualidad}%`} sub={`nota ${asis.notaP.toFixed(1)}`} c={asis.pctPuntualidad>=85?'#34C759':asis.pctPuntualidad>=70?'#FF9500':'#FF3B30'}/>
              <Metrica l='Asistencia' v={`${asis.pctAsistencia}%`} sub={`nota ${asis.notaA.toFixed(1)}`} c={asis.pctAsistencia>=92?'#34C759':asis.pctAsistencia>=84?'#FF9500':'#FF3B30'}/>
              <Metrica l='Ausencias' v={asis.ausencias}/>
              <Metrica l='Min. atraso acum.' v={asis.minAtraso}/>
            </div>
            <div style={{fontSize:11,color:'var(--text-muted)'}}>
              Calculado automáticamente desde Control de Asistencia (Workera) para el período del proceso.
              Ni el evaluador ni Gestión de Personas pueden modificar estos valores: se congelan al enviar.
              Nota formal = 60% puntualidad + 40% asistencia. Las ausencias no descuentan permisos autorizados — revisa el módulo de Permisos si hay casos justificados.
            </div>
          </>
        )}
      </div>

      {/* ═══ DIMENSIÓN 3 ═══ */}
      <SecTitle n='3' t={`Recomendación de continuidad (${proc.pond_recom}%)`}/>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 16px',marginBottom:20}}>
        <div style={{display:'grid',gap:8,marginBottom:12}}>
          {RECOMS.map(r=>(
            <button key={r.k} onClick={()=>setRecom(r.k)}
              style={{display:'flex',alignItems:'center',gap:10,padding:'10px 13px',borderRadius:10,cursor:'pointer',textAlign:'left',
                background: recom===r.k ? `${r.c}14` : 'var(--bg-app)',
                border:`1.5px solid ${recom===r.k ? r.c : 'var(--border)'}`}}>
              <span style={{width:14,height:14,borderRadius:100,border:`2px solid ${r.c}`,background:recom===r.k?r.c:'transparent',flexShrink:0}}/>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:recom===r.k?r.c:'var(--text)'}}>{r.l}</div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>{r.d}</div>
              </div>
            </button>
          ))}
        </div>
        <label style={lblM}>Justificación de la recomendación (obligatoria — fundamenta con hechos del período)</label>
        <textarea value={justif} onChange={e=>setJustif(e.target.value)} rows={3}
          placeholder='Mínimo 80 caracteres. Qué hechos concretos del período sustentan esta recomendación...'
          style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
        <div style={{fontSize:10.5,color:justif.trim().length>=80?'var(--success,#34C759)':'var(--text-muted)',marginTop:3}}>{justif.trim().length}/80 caracteres mínimos</div>
      </div>

      {/* Resultado en vivo + acciones */}
      <div style={{position:'sticky',bottom:0,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,boxShadow:'0 -6px 20px rgba(0,0,0,0.08)'}}>
        <div style={{fontSize:12,color:'var(--text-muted)'}}>
          {notaFinal != null ? (
            <>Nota final proyectada: <strong style={{fontSize:17,color:categoriaDe(notaFinal).c}}>{notaFinal.toFixed(2)}</strong>
            <span style={{marginLeft:8,fontWeight:700,color:categoriaDe(notaFinal).c}}>{categoriaDe(notaFinal).l}</span></>
          ) : 'Completa las 3 dimensiones para proyectar la nota final'}
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={guardarBorrador} disabled={guardando} style={btnSec}>💾 Guardar borrador</button>
          <button onClick={enviar} disabled={guardando} style={btnPri}>{guardando?'Enviando...':'✓ Enviar evaluación'}</button>
        </div>
      </div>
      {err && <div style={{fontSize:12.5,color:'#FF3B30',marginTop:10,padding:'9px 12px',background:'#FF3B3010',borderRadius:8}}>⚠️ {err}</div>}
    </div>
  )
}

// ─── Informe de evaluación ────────────────────────────────────────────────────
function InformeEvaluacion({ proc, evalRow: ev0, onVolver }) {
  const [ev, setEv] = useState(ev0)
  const [emp, setEmp] = useState(null)
  const [evaluador, setEvaluador] = useState(null)

  useEffect(() => { (async()=>{
    const [{ data: e }, { data: u }, { data: fresh }] = await Promise.all([
      supabase.from('rrhh_empleados').select('*').eq('cod_contaline', ev0.cod_contaline).single(),
      supabase.from('usuarios').select('nombre').eq('id', ev0.evaluador_id).single(),
      supabase.from('eval_evaluaciones').select('*').eq('id', ev0.id).single(),
    ])
    setEmp(e); setEvaluador(u); if (fresh) setEv(fresh)
  })() }, [ev0.id])

  const cat = ev.nota_final != null ? categoriaDe(Number(ev.nota_final)) : null
  const snap = ev.asis_snapshot || {}
  const alertas = ev.alertas || []
  const recomInfo = RECOMS.find(r=>r.k===ev.recomendacion)

  function exportPDF() {
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' })
    const azul = [26,26,46]
    doc.setFillColor(...azul); doc.rect(0,0,210,26,'F')
    doc.setTextColor(255,255,255); doc.setFontSize(13); doc.setFont(undefined,'bold')
    doc.text('INFORME DE EVALUACIÓN DE DESEMPEÑO', 14, 11)
    doc.setFontSize(8.5); doc.setFont(undefined,'normal')
    doc.text(`Outlet de Puertas SpA · ${proc.nombre} · Período ${fFecha(proc.periodo_desde)} a ${fFecha(proc.periodo_hasta)}`, 14, 18)
    doc.setTextColor(0,0,0)

    doc.autoTable({ startY: 32, theme:'plain', styles:{fontSize:9,cellPadding:1.2},
      body: [
        ['Trabajador', emp?.nombre||'', 'RUT', emp?.rut||''],
        ['Cargo', emp?.cargo||'—', 'Sucursal', emp?.sucursal_id||'—'],
        ['Evaluador', evaluador?.nombre||ev.evaluador_id, 'Fecha de envío', ev.enviada_at ? fFecha(ev.enviada_at) : '—'],
      ]})

    doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, theme:'grid',
      headStyles:{fillColor:azul,fontSize:9}, styles:{fontSize:9},
      head: [['Dimensión','Ponderación','Nota']],
      body: [
        [`1. Evaluación técnica de jefatura`, `${proc.pond_tecnica}%`, ev.nota_tecnica!=null?Number(ev.nota_tecnica).toFixed(2):'—'],
        [`2. Aspectos formales (puntualidad y asistencia)`, `${proc.pond_formal}%`, ev.nota_formal!=null?Number(ev.nota_formal).toFixed(2):'Sin datos — redistribuida'],
        [`3. Recomendación de continuidad`, `${proc.pond_recom}%`, ev.nota_recom!=null?Number(ev.nota_recom).toFixed(2):'—'],
        [{content:'RESULTADO FINAL',styles:{fontStyle:'bold'}}, '', {content:`${Number(ev.nota_final).toFixed(2)} — ${ev.categoria}`,styles:{fontStyle:'bold'}}],
      ]})

    doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, theme:'grid',
      headStyles:{fillColor:azul,fontSize:9}, styles:{fontSize:8},
      head: [['Dimensión 1 — Competencia','Nota','Evidencia registrada']],
      body: ITEMS.map(it => {
        const r = ev.respuestas?.items?.[it.k] || {}
        return [it.l, r.p ?? '—', r.ev || '']
      })})

    if (!snap.sinDatos && snap.jornadas != null) {
      doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, theme:'grid',
        headStyles:{fillColor:azul,fontSize:9}, styles:{fontSize:9},
        head: [['Dimensión 2 — Indicador (automático desde Control de Asistencia)','Valor','Nota']],
        body: [
          ['Jornadas con turno en el período', snap.jornadas, ''],
          ['Puntualidad', `${snap.pctPuntualidad}%`, snap.notaP?.toFixed(1)],
          ['Asistencia', `${snap.pctAsistencia}%`, snap.notaA?.toFixed(1)],
          ['Ausencias (sin marcas)', snap.ausencias, ''],
          ['Minutos de atraso acumulados', snap.minAtraso, ''],
        ]})
    }

    doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, theme:'grid',
      headStyles:{fillColor:azul,fontSize:9}, styles:{fontSize:9},
      head: [['Dimensión 3 — Recomendación de continuidad']],
      body: [
        [`${recomInfo?.l || '—'}`],
        [`Justificación: ${ev.justificacion || ''}`],
      ]})

    doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, theme:'grid',
      headStyles:{fillColor: alertas.length ? [255,149,0] : azul, fontSize:9}, styles:{fontSize:8},
      head: [[`Alertas de objetividad (${alertas.length})`]],
      body: alertas.length ? alertas.map(a=>[`${a.t}: ${a.d}`]) : [['Sin alertas de sesgo detectadas. Controles de objetividad respondidos de forma consistente.']]})

    let y = doc.lastAutoTable.finalY + 18
    if (y > 265) { doc.addPage(); y = 30 }
    doc.setFontSize(9)
    doc.line(20, y, 85, y);  doc.text('Firma Evaluador', 38, y+5)
    doc.line(120, y, 185, y); doc.text('Firma Gestión de Personas', 132, y+5)
    doc.setFontSize(7); doc.setTextColor(120)
    doc.text('Documento generado por el ERP Outlet de Puertas · Los indicadores de la Dimensión 2 provienen del registro de asistencia y no son editables.', 14, 290)

    doc.save(`Evaluacion_${(emp?.nombre||'trabajador').replace(/\s+/g,'_')}_${proc.periodo_hasta}.pdf`)
  }

  return (
    <div style={{maxWidth:860,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:14}}>
        <button onClick={onVolver} style={btnSec}>&larr; Volver al proceso</button>
        <button onClick={exportPDF} style={btnPri}>⬇️ Exportar informe PDF</button>
      </div>

      {/* Resultado */}
      <div style={{background:`linear-gradient(135deg, ${cat?.c||'#888'}12, transparent 55%)`,border:'1px solid var(--border)',borderRadius:14,padding:'18px 20px',marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:12,alignItems:'center'}}>
          <div>
            <div style={{fontSize:17,fontWeight:800}}>{emp?.nombre || '...'}</div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>
              {emp?.cargo||'—'} · {emp?.sucursal_id||'—'} · Evaluador: {evaluador?.nombre || ev.evaluador_id} · Enviada: {ev.enviada_at ? fFecha(ev.enviada_at) : '—'}
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:34,fontWeight:900,color:cat?.c,lineHeight:1}}>{ev.nota_final!=null?Number(ev.nota_final).toFixed(2):'—'}</div>
            <div style={{fontSize:12,fontWeight:800,color:cat?.c}}>{ev.categoria}</div>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginTop:14}}>
          <BarraDim l={`Técnica (${proc.pond_tecnica}%)`} n={ev.nota_tecnica}/>
          <BarraDim l={`Formal (${proc.pond_formal}%)`} n={ev.nota_formal} vacio={snap.sinDatos ? 'Sin datos' : null}/>
          <BarraDim l={`Recomendación (${proc.pond_recom}%)`} n={ev.nota_recom}/>
        </div>
      </div>

      {/* Alertas */}
      <div style={{marginBottom:16}}>
        <div style={secTituloI}>🧭 Alertas de objetividad ({alertas.length})</div>
        {alertas.length === 0 ? (
          <div style={{fontSize:12.5,color:'var(--success,#34C759)',background:'#34C75910',border:'1px solid #34C75930',borderRadius:10,padding:'10px 13px'}}>
            ✓ Sin alertas de sesgo: los controles de objetividad se respondieron de forma consistente.
          </div>
        ) : (
          <div style={{display:'grid',gap:6}}>
            {alertas.map((a,i)=>(
              <div key={i} style={{fontSize:12,background:'#FF950010',border:'1px solid #FF950035',borderLeft:'3px solid #FF9500',borderRadius:8,padding:'8px 12px'}}>
                <strong>{a.t}.</strong> {a.d}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dimensión 1 detalle */}
      <div style={secTituloI}>Dimensión 1 — Evaluación técnica</div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginBottom:16}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <tbody>
            {ITEMS.map(it => {
              const r = ev.respuestas?.items?.[it.k] || {}
              return (
                <tr key={it.k} style={{borderBottom:'1px solid var(--border)'}}>
                  <td style={{...tdS,width:'55%'}}>{it.l}{r.ev && <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:2}}>Evidencia: {r.ev}</div>}</td>
                  <td style={{...tdS,textAlign:'right'}}>
                    <span style={{fontWeight:800,fontSize:13}}>{r.p ?? '—'}</span>
                    <span style={{fontSize:10.5,color:'var(--text-muted)',marginLeft:5}}>{ESCALA.find(e=>e.v===r.p)?.l||''}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{padding:'10px 14px',fontSize:11.5,color:'var(--text-muted)',borderTop:'1px solid var(--border)'}}>
          <strong>Errores del período declarados:</strong> {ev.respuestas?.control?.c_errores || '—'}<br/>
          <strong>Aportes del período declarados:</strong> {ev.respuestas?.control?.c_aportes || '—'}
        </div>
      </div>

      {/* Dimensión 2 detalle */}
      <div style={secTituloI}>Dimensión 2 — Aspectos formales (automático)</div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'13px 16px',marginBottom:16}}>
        {snap.sinDatos ? (
          <div style={{fontSize:12.5,color:'var(--text-muted)'}}>Sin jornadas con turno en el período — dimensión redistribuida entre las otras dos.</div>
        ) : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10}}>
            <Metrica l='Jornadas' v={snap.jornadas}/>
            <Metrica l='Puntualidad' v={`${snap.pctPuntualidad}%`} sub={`nota ${snap.notaP?.toFixed(1)}`}/>
            <Metrica l='Asistencia' v={`${snap.pctAsistencia}%`} sub={`nota ${snap.notaA?.toFixed(1)}`}/>
            <Metrica l='Ausencias' v={snap.ausencias}/>
            <Metrica l='Min. atraso' v={snap.minAtraso}/>
          </div>
        )}
      </div>

      {/* Dimensión 3 detalle */}
      <div style={secTituloI}>Dimensión 3 — Recomendación de continuidad</div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'13px 16px',marginBottom:24}}>
        <div style={{fontSize:14,fontWeight:800,color:recomInfo?.c,marginBottom:6}}>{recomInfo?.l || '—'}</div>
        <div style={{fontSize:12.5,whiteSpace:'pre-wrap'}}>{ev.justificacion || '—'}</div>
      </div>
    </div>
  )
}

// ─── Piezas UI ────────────────────────────────────────────────────────────────
function SecTitle({ n, t, extra }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',margin:'0 0 10px 0'}}>
      <div style={{fontSize:14,fontWeight:800}}>
        <span style={{display:'inline-flex',width:22,height:22,borderRadius:100,background:'var(--accent)',color:'white',fontSize:12,alignItems:'center',justifyContent:'center',marginRight:8}}>{n}</span>
        {t}
      </div>
      {extra && <div style={{fontSize:12,fontWeight:700,color:'var(--accent)'}}>{extra}</div>}
    </div>
  )
}
function FilaEscala({ l, opciones, val, onSel }) {
  return (
    <div>
      <label style={lblM}>{l}</label>
      <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
        {opciones.map((o,i)=>(
          <button key={o} onClick={()=>onSel(i+1)}
            style={{flex:'1 1 90px',padding:'6px',borderRadius:8,cursor:'pointer',fontSize:11,
              fontWeight: val===i+1 ? 800 : 500,
              background: val===i+1 ? 'var(--accent)' : 'var(--bg-app)',
              color: val===i+1 ? 'white' : 'var(--text-muted)',
              border:`1px solid ${val===i+1 ? 'var(--accent)' : 'var(--border)'}`}}>{o}</button>
        ))}
      </div>
    </div>
  )
}
function FilaSiNo({ l, val, onSel }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
      <label style={{...lblM,marginBottom:0,textTransform:'none',letterSpacing:0,fontSize:12.5,fontWeight:600,color:'var(--text)'}}>{l}</label>
      <div style={{display:'flex',gap:5}}>
        {['si','no'].map(o=>(
          <button key={o} onClick={()=>onSel(o)}
            style={{padding:'6px 18px',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:val===o?800:500,
              background: val===o ? 'var(--accent)' : 'var(--bg-app)',
              color: val===o ? 'white' : 'var(--text-muted)',
              border:`1px solid ${val===o ? 'var(--accent)' : 'var(--border)'}`}}>{o==='si'?'Sí':'No'}</button>
        ))}
      </div>
    </div>
  )
}
function Metrica({ l, v, sub, c }) {
  return (
    <div style={{background:'var(--bg-app)',borderRadius:10,padding:'9px 12px'}}>
      <div style={{fontSize:10,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em'}}>{l}</div>
      <div style={{fontSize:19,fontWeight:800,color:c||'var(--text)',marginTop:2}}>{v}</div>
      {sub && <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{sub}</div>}
    </div>
  )
}
function BarraDim({ l, n, vacio }) {
  const num = n != null ? Number(n) : null
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
        <span style={{color:'var(--text-muted)',fontWeight:600}}>{l}</span>
        <span style={{fontWeight:800}}>{vacio || (num!=null?num.toFixed(2):'—')}</span>
      </div>
      <div style={{height:7,background:'var(--bg-app)',borderRadius:100,overflow:'hidden'}}>
        {num!=null && <div style={{width:`${num/5*100}%`,height:'100%',borderRadius:100,background:categoriaDe(num).c}}/>}
      </div>
    </div>
  )
}
function Overlay({ children, onCerrar }) {
  return (
    <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-surface)',borderRadius:14,padding:24,width:'100%',maxWidth:520,border:'1px solid var(--border)',maxHeight:'88vh',overflowY:'auto'}}>
        {children}
      </div>
    </div>
  )
}

const btnPri   = {padding:'8px 15px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}
const btnSec   = {padding:'8px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:500}
const btnGhost = {padding:'8px 14px',background:'transparent',color:'var(--text-muted)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}
const lblM     = {display:'block',fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.04em'}
const inpFull  = {padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit',width:'100%',boxSizing:'border-box'}
const thS = {padding:'9px 14px',textAlign:'left',fontSize:10.5,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}
const tdS = {padding:'9px 14px'}
const secTituloI = {fontSize:12,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}
