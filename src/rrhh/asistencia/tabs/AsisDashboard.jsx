// src/rrhh/asistencia/tabs/AsisDashboard.jsx
// Resumen de asistencia — métricas reales desde v_asis_jornadas + sync log.
//
// Criterio de diseño: la pantalla responde tres preguntas, en este orden.
//   1. ¿Qué tengo que hacer?      → banda de acción arriba de todo
//   2. ¿Cómo vamos?               → cifras comparadas contra el mes anterior
//   3. ¿Dónde está el problema?   → composición de jornadas y corte por sucursal
// Todo lo numérico usa cifras tabulares y todo lo accionable navega con el
// filtro ya puesto, para que nadie tenga que volver a buscar lo mismo.

import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'

const fMin = m => {
  if (!m) return '0m'
  const h = Math.floor(m / 60), min = m % 60
  return h > 0 ? `${h}h${min > 0 ? ' ' + min + 'm' : ''}` : `${min}m`
}
const iso = d => d.toISOString().slice(0, 10)
const NUM = { fontVariantNumeric: 'tabular-nums' }

// Estados de jornada, en el orden en que se leen en la barra de composición.
const COMPO = [
  { k:'puntual',       l:'Puntual',    c:'#1E7A44' },
  { k:'hizo_extra',    l:'Con extra',  c:'#0A6EBD' },
  { k:'atraso',        l:'Atraso',     c:'#B25E09' },
  { k:'turno_corrido', l:'Corrido',    c:'#7A5AF8' },
  { k:'incompleta',    l:'Incompleta', c:'#8E8E93' },
  { k:'sin_marcas',    l:'Ausencia',   c:'#B42318' },
]

export function AsisDashboard({ cu, onIrASync, onNavegar, scopeSuc, pend }) {
  const [data, setData]         = useState(null)
  const [cargando, setCargando] = useState(true)
  const [orden, setOrden]       = useState({ col:'jornadas', dir:'desc' })

  useEffect(() => { cargar() }, [scopeSuc])

  async function cargar() {
    setCargando(true)
    try {
      const hoy  = new Date()
      const iMes = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1))
      const fHoy = iso(hoy)
      const mes  = hoy.toLocaleString('es-CL', { month:'long', year:'numeric' })
      // Mismo tramo de días del mes anterior: comparar un mes completo contra
      // uno a medio andar mostraría una caída falsa todos los días 1.
      const iPrev = iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1))
      const fPrev = iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, hoy.getDate()))

      const sel = 'estado_dia,min_atraso_contable,min_extra_dia,sucursal_id,sucursal_nombre'
      let qMes  = supabase.from('v_asis_jornadas').select(sel)
        .gte('fecha', iMes).lte('fecha', fHoy).limit(20000)
      let qPrev = supabase.from('v_asis_jornadas').select('estado_dia')
        .gte('fecha', iPrev).lte('fecha', fPrev).limit(20000)
      if (scopeSuc) { qMes = qMes.eq('sucursal_id', scopeSuc); qPrev = qPrev.eq('sucursal_id', scopeSuc) }

      const [marcaciones, sinMapear, ultimaSync, jorMes, jorPrev] = await Promise.all([
        scopeSuc
          ? supabase.from('v_asis_marcaciones').select('id',{count:'exact',head:true}).gte('fecha_hora', iMes).eq('sucursal_id', scopeSuc)
          : supabase.from('asis_marcaciones').select('id',{count:'exact',head:true}).gte('fecha_hora', iMes),
        supabase.from('asis_staging_empleados_workera').select('workera_code',{count:'exact',head:true})
          .is('sugerencia_cod_contaline', null).eq('employee_status','ACTIVO'),
        supabase.from('asis_sync_log').select('inicio,tipo,estado,registros_nuevos')
          .order('inicio',{ascending:false}).limit(5),
        qMes, qPrev,
      ])

      const jd = (jorMes.data || []).filter(r => r.estado_dia !== 'sin_turno')
      const sinTurno = (jorMes.data || []).length - jd.length
      const jp = (jorPrev.data || []).filter(r => r.estado_dia !== 'sin_turno')
      const cnt = (rows, k) => rows.filter(r => r.estado_dia === k).length
      // "A tiempo" agrupa puntual + con extra: ambos llegaron a la hora. La
      // salida tardía es otra conversación y tiene su propia métrica.
      const aTiempo = rows => cnt(rows,'puntual') + cnt(rows,'hizo_extra')
      const pct = (n, t) => t > 0 ? Math.round(n / t * 100) : 0

      // Corte por sucursal para la tabla de abajo
      const porSuc = new Map()
      for (const r of jd) {
        const id = r.sucursal_id || '—'
        const a = porSuc.get(id) || { id, nombre: r.sucursal_nombre || id,
          jornadas:0, aTiempo:0, atrasos:0, minAtraso:0, hhee:0, minExtra:0, ausencias:0, exceso:0 }
        a.jornadas++
        if (['puntual','hizo_extra'].includes(r.estado_dia)) a.aTiempo++
        if (r.estado_dia === 'atraso')   { a.atrasos++; a.minAtraso += r.min_atraso_contable || 0 }
        if (r.estado_dia === 'sin_marcas') a.ausencias++
        if ((r.min_extra_dia || 0) > 0)  { a.hhee++; a.minExtra += r.min_extra_dia }
        if ((r.min_extra_dia || 0) > 120)  a.exceso++
        porSuc.set(id, a)
      }

      setData({
        mes, sinTurno,
        jornadas:    jd.length,
        pctPuntual:  pct(aTiempo(jd), jd.length),
        pctPrev:     pct(aTiempo(jp), jp.length),
        hayPrev:     jp.length > 0,
        atrasos:     cnt(jd,'atraso'),
        minAtraso:   jd.reduce((s,r) => s + (r.min_atraso_contable||0), 0),
        hhee:        jd.filter(r => (r.min_extra_dia||0) > 0).length,
        minExtra:    jd.reduce((s,r) => s + (r.min_extra_dia||0), 0),
        excesos:     jd.filter(r => (r.min_extra_dia||0) > 120).length,
        ausencias:   cnt(jd,'sin_marcas'),
        compo:       COMPO.map(c => ({ ...c, n: cnt(jd, c.k) })).filter(c => c.n > 0),
        sucursales:  [...porSuc.values()],
        marcaciones: marcaciones.count ?? 0,
        sinMapear:   sinMapear.count ?? 0,
        ultimaSync:  ultimaSync.data ?? [],
      })
    } catch(e) { console.error(e) }
    finally { setCargando(false) }
  }

  if (cargando) return <Esqueleto/>
  if (!data) return null
  if (data.marcaciones === 0 && data.jornadas === 0) return <SinDatos onIrASync={onIrASync}/>

  const sync      = data.ultimaSync[0]
  const horasSync = sync ? (Date.now() - new Date(sync.inicio).getTime()) / 3.6e6 : null
  const syncViejo = horasSync !== null && horasSync > 36
  const totalPend = (pend?.hhee || 0) + (pend?.ausencias || 0)
  const delta     = data.hayPrev ? data.pctPuntual - data.pctPrev : null

  const sucOrden = [...data.sucursales].sort((a,b) => {
    const v = orden.col === 'nombre'
      ? String(a.nombre).localeCompare(String(b.nombre))
      : (a[orden.col] || 0) - (b[orden.col] || 0)
    return orden.dir === 'asc' ? v : -v
  })
  const ordenarPor = col => setOrden(o =>
    ({ col, dir: o.col === col && o.dir === 'desc' ? 'asc' : 'desc' }))

  return (
    <div style={{maxWidth:1280}}>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',
        gap:16,marginBottom:18,flexWrap:'wrap'}}>
        <div>
          <h2 style={{fontSize:21,fontWeight:650,margin:0,letterSpacing:'-.015em'}}>
            Resumen de {data.mes}
          </h2>
          <div style={{fontSize:12.5,color:'var(--text-muted)',marginTop:3,...NUM}}>
            {data.jornadas.toLocaleString('es-CL')} jornadas con turno asignado
            {data.sinTurno > 0 && ` · ${data.sinTurno} sin turno en Workera`}
          </div>
        </div>
        <button onClick={cargar} style={btnSec}>Actualizar</button>
      </div>

      {/* 1 · Qué hay que hacer */}
      {totalPend > 0 ? (
        <Foco tono="critico"
          titulo={scopeSuc ? 'Tienes validaciones pendientes' : 'Hay validaciones pendientes'}
          texto={[
            pend.hhee ? `${pend.hhee} ${pend.hhee === 1 ? 'día de horas extra' : 'días de horas extra'} sin decisión` : null,
            pend.ausencias ? `${pend.ausencias} ${pend.ausencias === 1 ? 'ausencia' : 'ausencias'} sin justificar` : null,
          ].filter(Boolean).join(' · ') + '. Solo las horas autorizadas se pagan.'}
          accion="Revisar y validar"
          onClick={() => onNavegar?.('hhee', { dominio:'hhee' })}/>
      ) : pend && (
        <Foco tono="ok" titulo="Sin validaciones pendientes"
          texto="Las horas extra están decididas y las ausencias justificadas. El período puede ir a remuneraciones."/>
      )}

      {syncViejo && (
        <Foco tono="critico" titulo="Los datos no están al día"
          texto={`La última sincronización con Workera fue hace ${Math.round(horasSync)} horas. Las cifras de abajo pueden estar incompletas.`}
          accion="Ir a sincronización" onClick={onIrASync}/>
      )}
      {!scopeSuc && data.sinMapear > 0 && (
        <Foco tono="alerta" titulo={`${data.sinMapear} trabajadores de Workera sin vincular`}
          texto="No aparecen en informes ni evaluaciones hasta que se vinculen con su ficha del ERP."
          accion="Vincular ahora" onClick={onIrASync}/>
      )}

      {/* 2 · Cómo vamos */}
      <div style={{display:'grid',gap:0,gridTemplateColumns:'repeat(auto-fit,minmax(168px,1fr))',
        border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',
        background:'var(--bg-surface)',margin:'18px 0'}}>
        <Cifra l="Llegadas a tiempo" v={`${data.pctPuntual}%`} delta={delta}
          sub={data.hayPrev ? `${data.pctPrev}% mismo tramo del mes anterior` : 'sin base de comparación'}/>
        <Cifra l="Atrasos" v={data.atrasos} sub={`${fMin(data.minAtraso)} acumulados`}
          onClick={()=>onNavegar?.('analisis')}/>
        <Cifra l="Jornadas con horas extra" v={data.hhee} sub={`${fMin(data.minExtra)} acumuladas`}
          onClick={()=>onNavegar?.('hhee',{dominio:'hhee'})}/>
        <Cifra l="Sobre el tope de 2h" v={data.excesos} sub="máximo legal diario (Art. 31)"
          tono={data.excesos > 0 ? 'critico' : undefined}
          onClick={()=>onNavegar?.('hhee',{dominio:'hhee',cat:'aut_exceso'})}/>
        <Cifra l="Ausencias" v={data.ausencias} sub="día con turno y sin marcas"
          tono={data.ausencias > 0 ? 'alerta' : undefined}
          onClick={()=>onNavegar?.('hhee',{dominio:'ausencias'})}/>
      </div>

      {/* 3 · Dónde está el problema */}
      {data.compo.length > 0 && (
        <Bloque titulo="Cómo se repartieron las jornadas"
          nota="Cada segmento es proporcional al número de jornadas. Pincha para ver el detalle.">
          <div style={{display:'flex',height:30,borderRadius:5,overflow:'hidden',
            border:'1px solid var(--border)',marginBottom:12}}>
            {data.compo.map(c => {
              const p  = c.n / data.jornadas * 100
              const ir = () => c.k === 'sin_marcas' ? onNavegar?.('hhee',{dominio:'ausencias'})
                : c.k === 'hizo_extra' ? onNavegar?.('hhee',{dominio:'hhee'})
                : onNavegar?.('analisis')
              return (
                <div key={c.k} onClick={ir} role="button" tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && ir()}
                  title={`${c.l}: ${c.n} jornadas (${Math.round(p)}%)`}
                  style={{width:`${p}%`,background:c.c,cursor:'pointer',
                    display:'flex',alignItems:'center',justifyContent:'center',
                    color:'#fff',fontSize:11,fontWeight:700,...NUM}}>
                  {p >= 8 ? `${Math.round(p)}%` : ''}
                </div>
              )
            })}
          </div>
          <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
            {data.compo.map(c => (
              <div key={c.k} style={{display:'flex',alignItems:'center',gap:6,fontSize:12}}>
                <span style={{width:9,height:9,borderRadius:2,background:c.c,flexShrink:0}}/>
                <span style={{color:'var(--text)'}}>{c.l}</span>
                <span style={{color:'var(--text-muted)',...NUM}}>{c.n}</span>
              </div>
            ))}
          </div>
        </Bloque>
      )}

      {data.sucursales.length > 1 && (
        <Bloque titulo="Comparación por sucursal"
          nota="Ordena por cualquier columna. La fila lleva al análisis detallado.">
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr>
                  <Th onClick={()=>ordenarPor('nombre')}    act={orden.col==='nombre'}    dir={orden.dir}>Sucursal</Th>
                  <Th onClick={()=>ordenarPor('jornadas')}  act={orden.col==='jornadas'}  dir={orden.dir} r>Jornadas</Th>
                  <Th onClick={()=>ordenarPor('aTiempo')}   act={orden.col==='aTiempo'}   dir={orden.dir} r>A tiempo</Th>
                  <Th onClick={()=>ordenarPor('atrasos')}   act={orden.col==='atrasos'}   dir={orden.dir} r>Atrasos</Th>
                  <Th onClick={()=>ordenarPor('minExtra')}  act={orden.col==='minExtra'}  dir={orden.dir} r>Horas extra</Th>
                  <Th onClick={()=>ordenarPor('ausencias')} act={orden.col==='ausencias'} dir={orden.dir} r>Ausencias</Th>
                  <Th onClick={()=>ordenarPor('exceso')}    act={orden.col==='exceso'}    dir={orden.dir} r>Sobre 2h</Th>
                </tr>
              </thead>
              <tbody>
                {sucOrden.map((s,i) => {
                  const p = s.jornadas ? Math.round(s.aTiempo / s.jornadas * 100) : 0
                  return (
                    <tr key={s.id} onClick={()=>onNavegar?.('analisis')}
                      style={{cursor:'pointer',background: i%2 ? 'var(--bg-app)' : 'transparent'}}>
                      <Td b>{s.nombre}</Td>
                      <Td r>{s.jornadas}</Td>
                      <Td r><span style={{fontWeight:600,
                        color: p>=70?'#1E7A44':p>=50?'#B25E09':'#B42318'}}>{p}%</span></Td>
                      <Td r>{s.atrasos ? `${s.atrasos} · ${fMin(s.minAtraso)}` : '—'}</Td>
                      <Td r>{s.hhee ? `${s.hhee} · ${fMin(s.minExtra)}` : '—'}</Td>
                      <Td r tono={s.ausencias ? '#B42318' : undefined}>{s.ausencias || '—'}</Td>
                      <Td r tono={s.exceso ? '#B42318' : undefined}>{s.exceso || '—'}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Bloque>
      )}

      {!scopeSuc && data.ultimaSync.length > 0 && (
        <Bloque titulo="Últimas sincronizaciones">
          {data.ultimaSync.map((s,i) => (
            <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
              padding:'7px 0',fontSize:12.5,
              borderBottom: i < data.ultimaSync.length-1 ? '1px solid var(--border)' : 'none'}}>
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <span style={{fontSize:10,fontWeight:800,padding:'1px 7px',borderRadius:3,
                  background: s.estado==='ok' ? '#1E7A4415' : s.estado==='error' ? '#B4231815' : '#B25E0915',
                  color:      s.estado==='ok' ? '#1E7A44'   : s.estado==='error' ? '#B42318'   : '#B25E09'}}>
                  {s.estado === 'ok' ? 'OK' : String(s.estado).toUpperCase()}
                </span>
                <span>{s.tipo}</span>
              </div>
              <div style={{color:'var(--text-muted)',...NUM}}>
                {new Date(s.inicio).toLocaleString('es-CL')} · {(s.registros_nuevos??0).toLocaleString('es-CL')} nuevos
              </div>
            </div>
          ))}
        </Bloque>
      )}
    </div>
  )
}

/* ── piezas ───────────────────────────────────────────────────────────────── */

const TONOS = {
  critico: { c:'#B42318', bg:'#B4231810' },
  alerta:  { c:'#B25E09', bg:'#B25E0910' },
  ok:      { c:'#1E7A44', bg:'#1E7A4410' },
}

// Banda de acción: barra lateral de color en vez de caja tintada completa,
// para que dos o tres apiladas no compitan entre sí.
function Foco({ tono='alerta', titulo, texto, accion, onClick }) {
  const t = TONOS[tono] || TONOS.alerta
  return (
    <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:10,
      background:t.bg,borderLeft:`3px solid ${t.c}`,borderRadius:'0 6px 6px 0',padding:'12px 16px'}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13.5,fontWeight:700,color:t.c,marginBottom:2}}>{titulo}</div>
        <div style={{fontSize:12.5,color:'var(--text)',lineHeight:1.45}}>{texto}</div>
      </div>
      {accion && (
        <button onClick={onClick} style={{padding:'7px 14px',background:t.c,color:'#fff',
          border:'none',borderRadius:6,cursor:'pointer',fontSize:12.5,fontWeight:600,whiteSpace:'nowrap'}}>
          {accion}
        </button>
      )}
    </div>
  )
}

// Celda de cifra dentro de la tira. Sin tarjetas sueltas: una sola caja
// dividida por filetes mantiene la lectura horizontal y quita ruido.
function Cifra({ l, v, sub, delta, tono, onClick }) {
  const clic = typeof onClick === 'function'
  const col  = tono ? TONOS[tono].c : 'var(--text)'
  return (
    <div onClick={onClick} role={clic?'button':undefined} tabIndex={clic?0:undefined}
      onKeyDown={clic ? e => { if (e.key === 'Enter') onClick() } : undefined}
      style={{padding:'13px 16px',borderRight:'1px solid var(--border)',
        cursor:clic?'pointer':'default',minWidth:0}}>
      <div style={{fontSize:11.5,color:'var(--text-muted)',fontWeight:600,marginBottom:5}}>{l}</div>
      <div style={{display:'flex',alignItems:'baseline',gap:7}}>
        <span style={{fontSize:25,fontWeight:700,color:col,letterSpacing:'-.02em',...NUM}}>{v}</span>
        {delta !== null && delta !== undefined && delta !== 0 && (
          <span style={{fontSize:11.5,fontWeight:700,...NUM,
            color: delta > 0 ? '#1E7A44' : '#B42318'}}>
            {delta > 0 ? '+' : ''}{delta} pp
          </span>
        )}
      </div>
      <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3,lineHeight:1.35}}>{sub}</div>
    </div>
  )
}

function Bloque({ titulo, nota, children }) {
  return (
    <section style={{border:'1px solid var(--border)',borderRadius:10,
      background:'var(--bg-surface)',padding:'14px 16px',marginBottom:16}}>
      <h3 style={{fontSize:13.5,fontWeight:700,margin:0,marginBottom:nota?4:12}}>{titulo}</h3>
      {nota && <div style={{fontSize:11.5,color:'var(--text-muted)',marginBottom:12}}>{nota}</div>}
      {children}
    </section>
  )
}

function Th({ children, onClick, act, dir, r }) {
  return (
    <th onClick={onClick} style={{padding:'7px 10px',textAlign:r?'right':'left',
      fontSize:11,fontWeight:700,color:act?'var(--text)':'var(--text-muted)',
      borderBottom:'1.5px solid var(--border)',cursor:'pointer',whiteSpace:'nowrap',
      userSelect:'none'}}>
      {children}{act && <span style={{marginLeft:4}}>{dir==='asc'?'▲':'▼'}</span>}
    </th>
  )
}

function Td({ children, r, b, tono }) {
  return (
    <td style={{padding:'8px 10px',textAlign:r?'right':'left',
      borderBottom:'1px solid var(--border)',fontWeight:b?600:400,
      color:tono||'var(--text)',...(r?NUM:{})}}>{children}</td>
  )
}

function Esqueleto() {
  return (
    <div style={{maxWidth:1280}}>
      <div style={{height:22,width:220,background:'var(--border)',borderRadius:4,marginBottom:20,opacity:.5}}/>
      <div style={{height:62,background:'var(--border)',borderRadius:8,marginBottom:14,opacity:.3}}/>
      <div style={{height:96,background:'var(--border)',borderRadius:8,opacity:.25}}/>
    </div>
  )
}

function SinDatos({ onIrASync }) {
  return (
    <div style={{maxWidth:460,margin:'72px auto',textAlign:'center'}}>
      <h2 style={{margin:'0 0 8px 0',fontSize:18,fontWeight:650}}>Todavía no hay marcaciones</h2>
      <p style={{color:'var(--text-muted)',fontSize:13.5,lineHeight:1.55,margin:'0 0 22px 0'}}>
        Trae las marcaciones y los turnos desde Workera para empezar a ver el resumen.
      </p>
      <button onClick={onIrASync} style={{padding:'10px 20px',background:'var(--accent)',
        color:'#fff',border:'none',borderRadius:7,cursor:'pointer',fontSize:13.5,fontWeight:600}}>
        Sincronizar ahora
      </button>
    </div>
  )
}

const btnSec = {padding:'7px 14px',background:'var(--bg-card)',color:'var(--text)',
  border:'1px solid var(--border)',borderRadius:7,cursor:'pointer',fontSize:12.5,fontWeight:500}
