// src/rrhh/asistencia/tabs/AsisFicha.jsx
// Ficha de asistencia de un trabajador — panel lateral sobre la vista actual.
//
// Por qué existe: hasta ahora la información de una persona estaba repartida
// entre cuatro pantallas (resumen, marcaciones, análisis, validación). Cuando
// alguien reclama "yo trabajé más horas", había que cruzar a mano. Acá está
// el mes completo: lo que se esperaba, lo que marcó, lo que el sistema computó
// y quién decidió qué. Es la pantalla que zanja una discusión.
//
// Convención de horas: las marcas se guardan como hora local de Chile en un
// campo con zona. Convertirlas otra vez desfasa el valor, así que se leen
// directo del string (mismo criterio que el resto del módulo).

import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'

const NUM  = { fontVariantNumeric:'tabular-nums' }
const hora = ts => ts ? String(ts).slice(11,16) : null
const fMin = m => {
  if (!m) return '0m'
  const s = m < 0 ? '−' : '', a = Math.abs(m)
  const h = Math.floor(a/60), min = a%60
  return h > 0 ? `${s}${h}h${min ? ' '+min+'m' : ''}` : `${s}${min}m`
}
const fFecha = iso => { const [y,m,d] = String(iso).slice(0,10).split('-'); return `${d}-${m}-${y}` }

// Un estado por día, con su color y su nombre en lenguaje de jefatura.
const EST = {
  puntual:       { l:'Puntual',            c:'#1E7A44' },
  hizo_extra:    { l:'Con horas extra',    c:'#0A6EBD' },
  atraso:        { l:'Atraso',             c:'#B25E09' },
  turno_corrido: { l:'Turno corrido',      c:'#7A5AF8' },
  incompleta:    { l:'Marca incompleta',   c:'#8E8E93' },
  sin_marcas:    { l:'Ausencia',           c:'#B42318' },
  sin_turno:     { l:'Sin turno asignado', c:'#C7C7CC' },
}
const DIAS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre']

export function AsisFicha({ cod, nombre, onCerrar }) {
  const hoy = new Date()
  const [ym, setYm]   = useState({ y: hoy.getFullYear(), m: hoy.getMonth() })
  const [d, setD]     = useState(null)      // datos del mes
  const [sel, setSel] = useState(null)      // día seleccionado
  const [cargando, setCargando] = useState(true)

  useEffect(() => { cargar() }, [cod, ym.y, ym.m])
  // Cerrar con Escape: en un panel superpuesto es lo que la gente intenta.
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onCerrar?.() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCerrar])

  async function cargar() {
    setCargando(true); setSel(null)
    try {
      const ini = new Date(ym.y, ym.m, 1).toISOString().slice(0,10)
      const fin = new Date(ym.y, ym.m + 1, 0).toISOString().slice(0,10)
      const [jor, vals, aus, ficha] = await Promise.all([
        supabase.from('v_asis_jornadas')
          .select('fecha,dia_semana,workshift_name,entrada_esperada,salida_esperada,entrada_real,salida_real,'+
                  'inicio_colacion_real,fin_colacion_real,estado_dia,estado_colacion,n_marcas_dia,'+
                  'min_atraso_contable,min_extra_dia,min_salida_anticipada_contable,min_trabajados_efectivos,'+
                  'min_turno_neto,novedad_tipo')
          .eq('cod_contaline', cod).gte('fecha', ini).lte('fecha', fin).order('fecha'),
        supabase.from('asis_hhee_validaciones').select('fecha,decision,justificacion,validado_por,validado_at')
          .eq('cod_contaline', cod).eq('activo', true).gte('fecha', ini).lte('fecha', fin),
        supabase.from('asis_ausencias').select('fecha,clasificacion,justificacion,gestionado_por,gestionado_at')
          .eq('cod_contaline', cod).eq('activo', true).gte('fecha', ini).lte('fecha', fin),
        supabase.from('rrhh_empleados').select('cargo,sucursal_id,fecha_ingreso,activo')
          .eq('cod_contaline', cod).maybeSingle(),
      ])
      const vMap = {}; for (const v of vals.data || []) vMap[String(v.fecha).slice(0,10)] = v
      const aMap = {}; for (const a of aus.data  || []) aMap[String(a.fecha).slice(0,10)] = a
      const dias = {}
      for (const j of jor.data || []) dias[String(j.fecha).slice(0,10)] = j
      setD({ dias, vMap, aMap, ficha: ficha.data || null,
             decisiones: [...(vals.data||[]), ...(aus.data||[])] })
    } catch (e) { console.error(e) }
    finally { setCargando(false) }
  }

  const mover = n => setYm(p => {
    const x = new Date(p.y, p.m + n, 1)
    return { y: x.getFullYear(), m: x.getMonth() }
  })
  const esMesActual = ym.y === hoy.getFullYear() && ym.m === hoy.getMonth()

  // Rejilla del calendario: lunes primero, con huecos antes del día 1.
  const primero = new Date(ym.y, ym.m, 1)
  const offset  = (primero.getDay() + 6) % 7
  const nDias   = new Date(ym.y, ym.m + 1, 0).getDate()
  const celdas  = [...Array(offset).fill(null),
                   ...Array.from({length:nDias}, (_,i) => i + 1)]

  const clave = n => `${ym.y}-${String(ym.m+1).padStart(2,'0')}-${String(n).padStart(2,'0')}`

  // Totales del mes, excluyendo días sin turno (no son jornada).
  const conTurno = d ? Object.values(d.dias).filter(j => j.estado_dia !== 'sin_turno') : []
  const tot = {
    jornadas:  conTurno.length,
    aTiempo:   conTurno.filter(j => ['puntual','hizo_extra'].includes(j.estado_dia)).length,
    atrasos:   conTurno.filter(j => j.estado_dia === 'atraso').length,
    minAtraso: conTurno.reduce((s,j) => s + (j.min_atraso_contable||0), 0),
    minExtra:  conTurno.reduce((s,j) => s + (j.min_extra_dia||0), 0),
    ausencias: conTurno.filter(j => j.estado_dia === 'sin_marcas').length,
    trabajado: conTurno.reduce((s,j) => s + (j.min_trabajados_efectivos||0), 0),
  }
  const pctPunt = tot.jornadas ? Math.round(tot.aTiempo / tot.jornadas * 100) : 0
  const jSel = sel && d ? d.dias[sel] : null

  return (
    <>
      <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.32)',zIndex:200}}/>
      <aside role="dialog" aria-label={`Ficha de asistencia de ${nombre}`} style={{
        position:'fixed',top:0,right:0,bottom:0,width:'min(760px,100vw)',zIndex:201,
        background:'var(--bg-app)',borderLeft:'1px solid var(--border)',
        boxShadow:'-10px 0 34px rgba(0,0,0,.14)',display:'flex',flexDirection:'column'}}>

        <header style={{padding:'15px 20px',borderBottom:'1px solid var(--border)',
          background:'var(--bg-surface)',display:'flex',alignItems:'flex-start',
          justifyContent:'space-between',gap:14}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:17,fontWeight:650,letterSpacing:'-.01em'}}>{nombre}</div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>
              {d?.ficha?.cargo || 'Sin cargo registrado'}
              {d?.ficha?.sucursal_id && ` · ${d.ficha.sucursal_id}`}
              {d?.ficha && !d.ficha.activo && <span style={{color:'#B42318',fontWeight:600}}> · desvinculado</span>}
            </div>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar ficha" style={{background:'none',border:'none',
            fontSize:22,lineHeight:1,cursor:'pointer',color:'var(--text-muted)',padding:'0 2px'}}>×</button>
        </header>

        <div style={{flex:1,overflowY:'auto',padding:'16px 20px 28px'}}>
          {/* Navegación de mes */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
            <button onClick={()=>mover(-1)} style={btnNav} aria-label="Mes anterior">←</button>
            <div style={{fontSize:14,fontWeight:650,textTransform:'capitalize'}}>
              {MESES[ym.m]} {ym.y}
            </div>
            <button onClick={()=>mover(1)} style={{...btnNav,
              opacity: esMesActual ? .35 : 1, pointerEvents: esMesActual ? 'none' : 'auto'}}
              aria-label="Mes siguiente">→</button>
          </div>

          {cargando ? (
            <div style={{padding:60,textAlign:'center',color:'var(--text-muted)',fontSize:13}}>Cargando el mes…</div>
          ) : tot.jornadas === 0 ? (
            <div style={{padding:'50px 20px',textAlign:'center',border:'1px solid var(--border)',
              borderRadius:9,background:'var(--bg-surface)'}}>
              <div style={{fontWeight:650,marginBottom:4}}>Sin jornadas este mes</div>
              <div style={{fontSize:12.5,color:'var(--text-muted)'}}>
                No hay turnos asignados ni marcas registradas en {MESES[ym.m]}.
              </div>
            </div>
          ) : (
            <>
              {/* Totales del mes */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(112px,1fr))',
                border:'1px solid var(--border)',borderRadius:9,overflow:'hidden',
                background:'var(--bg-surface)',marginBottom:16}}>
                <Mini l="A tiempo" v={`${pctPunt}%`} sub={`${tot.aTiempo} de ${tot.jornadas}`}
                  c={pctPunt>=70?'#1E7A44':pctPunt>=50?'#B25E09':'#B42318'}/>
                <Mini l="Atrasos" v={tot.atrasos} sub={fMin(tot.minAtraso)}/>
                <Mini l="Horas extra" v={fMin(tot.minExtra)} sub="en el mes"/>
                <Mini l="Ausencias" v={tot.ausencias} sub="con turno, sin marcas"
                  c={tot.ausencias?'#B42318':undefined}/>
                <Mini l="Trabajado" v={fMin(tot.trabajado)} sub="efectivo"/>
              </div>

              {/* Calendario */}
              <div style={{border:'1px solid var(--border)',borderRadius:9,background:'var(--bg-surface)',
                padding:'12px 12px 10px',marginBottom:16}}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4,marginBottom:6}}>
                  {DIAS.map(x => (
                    <div key={x} style={{fontSize:10,fontWeight:700,color:'var(--text-muted)',
                      textAlign:'center',paddingBottom:2}}>{x}</div>
                  ))}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4}}>
                  {celdas.map((n,i) => {
                    if (n === null) return <div key={`x${i}`}/>
                    const k = clave(n), j = d.dias[k]
                    const e = j ? (EST[j.estado_dia] || EST.sin_turno) : null
                    const activo = sel === k
                    const pend = j && (j.min_extra_dia||0) > 0 && !d.vMap[k]
                    return (
                      <button key={k} onClick={()=>setSel(activo ? null : k)}
                        disabled={!j}
                        title={j ? `${fFecha(k)} · ${e.l}` : `${fFecha(k)} · sin registro`}
                        style={{
                          position:'relative',minHeight:52,padding:'4px 5px',textAlign:'left',
                          border:`1px solid ${activo ? 'var(--text)' : 'var(--border)'}`,
                          borderRadius:6,cursor:j?'pointer':'default',
                          background: activo ? 'var(--bg-app)' : 'transparent',
                          opacity: j ? 1 : .4, overflow:'hidden'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                          <span style={{fontSize:11,fontWeight:600,...NUM}}>{n}</span>
                          {pend && <span title="Horas extra sin decidir" style={{width:5,height:5,
                            borderRadius:'50%',background:'#B42318'}}/>}
                        </div>
                        {j && (
                          <>
                            <div style={{height:3,borderRadius:2,background:e.c,margin:'3px 0 3px'}}/>
                            <div style={{fontSize:9.5,color:'var(--text-muted)',lineHeight:1.25,...NUM}}>
                              {j.estado_dia === 'sin_marcas' ? 'sin marcas'
                                : j.estado_dia === 'sin_turno' ? 'libre'
                                : hora(j.entrada_real) || '—'}
                            </div>
                            {(j.min_extra_dia||0) > 0 && (
                              <div style={{fontSize:9.5,fontWeight:700,color:'#0A6EBD',...NUM}}>
                                +{fMin(j.min_extra_dia)}
                              </div>
                            )}
                            {(j.min_atraso_contable||0) > 0 && (
                              <div style={{fontSize:9.5,fontWeight:700,color:'#B25E09',...NUM}}>
                                −{fMin(j.min_atraso_contable)}
                              </div>
                            )}
                          </>
                        )}
                      </button>
                    )
                  })}
                </div>
                <div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:10,paddingTop:9,
                  borderTop:'1px solid var(--border)'}}>
                  {Object.entries(EST).filter(([k]) =>
                    conTurno.some(j => j.estado_dia === k) || k === 'sin_turno'
                  ).map(([k,e]) => (
                    <span key={k} style={{display:'flex',alignItems:'center',gap:5,fontSize:11,
                      color:'var(--text-muted)'}}>
                      <span style={{width:14,height:3,borderRadius:2,background:e.c}}/>{e.l}
                    </span>
                  ))}
                </div>
              </div>

              {/* Detalle del día elegido */}
              {jSel && <DetalleDia fecha={sel} j={jSel} val={d.vMap[sel]} aus={d.aMap[sel]}/>}

              {/* Historial de decisiones del mes */}
              {d.decisiones.length > 0 && (
                <section style={{border:'1px solid var(--border)',borderRadius:9,
                  background:'var(--bg-surface)',padding:'12px 14px'}}>
                  <h4 style={{margin:'0 0 10px',fontSize:13,fontWeight:700}}>Decisiones del mes</h4>
                  {[...d.decisiones]
                    .sort((a,b) => String(b.fecha).localeCompare(String(a.fecha)))
                    .map((x,i) => {
                      const esHhee = 'decision' in x
                      const col = esHhee
                        ? (x.decision === 'autorizada' ? '#1E7A44' : '#B42318')
                        : '#0A6EBD'
                      const et = esHhee
                        ? (x.decision === 'autorizada' ? 'Horas autorizadas' : 'Horas rechazadas')
                        : `Ausencia: ${String(x.clasificacion||'').replace(/_/g,' ')}`
                      return (
                        <div key={i} style={{display:'flex',gap:10,padding:'7px 0',fontSize:12.5,
                          borderTop: i ? '1px solid var(--border)' : 'none'}}>
                          <span style={{width:3,borderRadius:2,background:col,flexShrink:0}}/>
                          <div style={{flex:1,minWidth:0}}>
                            <div><span style={{fontWeight:600,color:col}}>{et}</span>
                              <span style={{color:'var(--text-muted)'}}> · {fFecha(x.fecha)}</span></div>
                            {x.justificacion && (
                              <div style={{fontSize:11.5,color:'var(--text-muted)',fontStyle:'italic',marginTop:1}}>
                                “{x.justificacion}”
                              </div>
                            )}
                          </div>
                          <span style={{fontSize:11,color:'var(--text-muted)',whiteSpace:'nowrap'}}>
                            {String(x.validado_at || x.gestionado_at || '').slice(0,10).split('-').reverse().join('-')}
                          </span>
                        </div>
                      )
                    })}
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}

/* ── detalle de un día ─────────────────────────────────────────────────────── */
// Compara lo pactado con lo ocurrido. Cuando alguien reclama, esta tabla es
// la evidencia: turno, marcas reales y el cómputo que hizo el sistema.
function DetalleDia({ fecha, j, val, aus }) {
  const e = EST[j.estado_dia] || EST.sin_turno
  const fila = (l, a, b) => (
    <tr>
      <td style={{padding:'5px 10px 5px 0',color:'var(--text-muted)',fontSize:11.5,whiteSpace:'nowrap'}}>{l}</td>
      <td style={{padding:'5px 14px 5px 0',...NUM,fontSize:12.5}}>{a}</td>
      <td style={{padding:'5px 0',...NUM,fontSize:12.5,fontWeight:600}}>{b}</td>
    </tr>
  )
  return (
    <section style={{border:'1px solid var(--border)',borderRadius:9,background:'var(--bg-surface)',
      padding:'13px 15px',marginBottom:16,borderLeft:`3px solid ${e.c}`}}>
      <div style={{display:'flex',alignItems:'baseline',gap:10,marginBottom:10,flexWrap:'wrap'}}>
        <h4 style={{margin:0,fontSize:13.5,fontWeight:700}}>{fFecha(fecha)}</h4>
        <span style={{fontSize:11.5,fontWeight:700,color:e.c}}>{e.l}</span>
        {j.workshift_name && <span style={{fontSize:11.5,color:'var(--text-muted)'}}>Turno {j.workshift_name}</span>}
        {j.novedad_tipo && <span style={{fontSize:11,fontWeight:600,color:'#0A6EBD'}}>
          {String(j.novedad_tipo).replace(/_/g,' ')}</span>}
      </div>

      <table style={{borderCollapse:'collapse',marginBottom: (j.min_extra_dia||j.min_atraso_contable) ? 10 : 0}}>
        <thead>
          <tr>
            <th/>
            <th style={{textAlign:'left',fontSize:10,fontWeight:700,color:'var(--text-muted)',
              padding:'0 14px 4px 0'}}>Debía</th>
            <th style={{textAlign:'left',fontSize:10,fontWeight:700,color:'var(--text-muted)',
              padding:'0 0 4px'}}>Marcó</th>
          </tr>
        </thead>
        <tbody>
          {fila('Entrada', hora(j.entrada_esperada) || '—', hora(j.entrada_real) || 'sin marca')}
          {fila('Salida',  hora(j.salida_esperada)  || '—', hora(j.salida_real)  || 'sin marca')}
          {(j.inicio_colacion_real || j.fin_colacion_real || j.estado_colacion === 'no_marcada') &&
            fila('Colación', j.estado_colacion === 'no_aplica' ? 'no aplica' : 'según turno',
              j.inicio_colacion_real
                ? `${hora(j.inicio_colacion_real)} – ${hora(j.fin_colacion_real) || '?'}`
                : 'no marcada')}
        </tbody>
      </table>

      {(j.min_extra_dia > 0 || j.min_atraso_contable > 0 || j.min_salida_anticipada_contable > 0) && (
        <div style={{display:'flex',gap:16,flexWrap:'wrap',paddingTop:9,borderTop:'1px solid var(--border)'}}>
          {j.min_atraso_contable > 0 && (
            <Dato l="Atraso" v={fMin(j.min_atraso_contable)} c="#B25E09"/>)}
          {j.min_salida_anticipada_contable > 0 && (
            <Dato l="Salida anticipada" v={fMin(j.min_salida_anticipada_contable)} c="#B25E09"/>)}
          {j.min_extra_dia > 0 && (
            <Dato l="Horas extra" v={fMin(j.min_extra_dia)}
              c={j.min_extra_dia > 120 ? '#B42318' : '#0A6EBD'}
              nota={j.min_extra_dia > 120 ? 'supera el tope de 2 h' :
                    val ? (val.decision === 'autorizada' ? 'autorizadas' : 'rechazadas') : 'sin decidir'}/>)}
          {j.min_trabajados_efectivos > 0 && (
            <Dato l="Trabajado efectivo" v={fMin(j.min_trabajados_efectivos)}/>)}
        </div>
      )}

      {aus && (
        <div style={{marginTop:9,paddingTop:9,borderTop:'1px solid var(--border)',fontSize:12}}>
          <span style={{fontWeight:600}}>Ausencia justificada como {String(aus.clasificacion||'').replace(/_/g,' ')}</span>
          {aus.justificacion && <span style={{color:'var(--text-muted)'}}> — {aus.justificacion}</span>}
        </div>
      )}
    </section>
  )
}

function Dato({ l, v, c, nota }) {
  return (
    <div>
      <div style={{fontSize:10.5,color:'var(--text-muted)',fontWeight:600}}>{l}</div>
      <div style={{fontSize:15,fontWeight:700,color:c||'var(--text)',...NUM}}>{v}</div>
      {nota && <div style={{fontSize:10.5,color:c||'var(--text-muted)'}}>{nota}</div>}
    </div>
  )
}

function Mini({ l, v, sub, c }) {
  return (
    <div style={{padding:'10px 12px',borderRight:'1px solid var(--border)'}}>
      <div style={{fontSize:10.5,color:'var(--text-muted)',fontWeight:600,marginBottom:3}}>{l}</div>
      <div style={{fontSize:18,fontWeight:700,color:c||'var(--text)',...NUM,letterSpacing:'-.01em'}}>{v}</div>
      <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:1}}>{sub}</div>
    </div>
  )
}

const btnNav = {padding:'5px 13px',background:'var(--bg-card)',color:'var(--text)',
  border:'1px solid var(--border)',borderRadius:6,cursor:'pointer',fontSize:13}
