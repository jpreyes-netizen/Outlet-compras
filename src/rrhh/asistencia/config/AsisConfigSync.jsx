// src/rrhh/asistencia/config/AsisConfigSync.jsx
// Sync unificado: 2 botones. Itera automáticamente en bloques para rangos largos.

import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'
import { callWorkera } from '../lib/workeraApi'

const hoy    = () => new Date().toISOString().slice(0,10)
const hace7  = () => { const d=new Date(); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10) }
const iAno   = () => `${new Date().getFullYear()}-01-01`
const iMes   = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` }

function dividirRango(desde, hasta, bloqueMax=55) {
  const bloques = []
  let cur = new Date(desde+'T12:00:00')
  const fin = new Date(hasta+'T12:00:00')
  while (cur <= fin) {
    const inicio = cur.toISOString().slice(0,10)
    const finB = new Date(cur); finB.setDate(finB.getDate()+bloqueMax-1)
    const cierre = finB > fin ? hasta : finB.toISOString().slice(0,10)
    bloques.push({ desde: inicio, hasta: cierre })
    cur = new Date(finB); cur.setDate(cur.getDate()+1)
  }
  return bloques
}

export function AsisConfigSync({ cu }) {
  const [log, setLog]             = useState([])
  const [cargandoLog, setCargLog] = useState(true)
  const [corriendo, setCorriendo] = useState(false)
  const [progreso, setProgreso]   = useState(null)
  const [resultado, setResultado] = useState(null)
  const [desde, setDesde]         = useState(iMes())
  const [hasta, setHasta]         = useState(hoy())
  const [rangoPreset, setPreset]  = useState('mes')
  const [errores, setErrores]     = useState([])

  const PRESETS = [
    { k:'7d',   l:'7 días',      desde: hace7, hasta: hoy  },
    { k:'mes',  l:'Este mes',    desde: iMes,  hasta: hoy  },
    { k:'ano',  l:'Este año',    desde: iAno,  hasta: hoy  },
    { k:'libre',l:'Rango libre', desde: iMes,  hasta: hoy  },
  ]

  useEffect(() => { cargarLog() }, [])

  async function cargarLog() {
    setCargLog(true)
    try {
      const { data } = await supabase.from('asis_sync_log')
        .select('*').order('inicio',{ascending:false}).limit(20)
      setLog(data||[])
    } catch(e) { console.error(e) }
    finally { setCargLog(false) }
  }

  function aplicarPreset(k) {
    const p = PRESETS.find(x=>x.k===k); if(!p) return
    setPreset(k)
    if (k !== 'libre') { setDesde(p.desde()); setHasta(p.hasta()) }
  }

  async function syncCatalogos() {
    setCorriendo(true); setResultado(null); setErrores([])
    const errs = []
    try {
      setProgreso({paso:1,total:2,accion:'Catálogos',desde:null,hasta:null})
      await callWorkera('sync_catalogos')
      setProgreso({paso:2,total:2,accion:'Empleados',desde:null,hasta:null})
      await callWorkera('sync_empleados')
      setResultado({ok:true,msg:'Catálogos y empleados actualizados correctamente.'})
    } catch(e) {
      errs.push(e.message)
      setResultado({ok:false,msg:'Error: '+e.message})
    }
    setErrores(errs); setProgreso(null); setCorriendo(false); cargarLog()
  }

  async function syncCompleto() {
    const dias = Math.round((new Date(hasta)-new Date(desde))/86400000)
    if (dias < 0) { setResultado({ok:false,msg:'Rango inválido.'}); return }
    if (dias > 366) { setResultado({ok:false,msg:'Máximo 1 año (366 días).'}); return }
    setCorriendo(true); setResultado(null); setErrores([])
    const bloques = dividirRango(desde, hasta, 55)
    const totalPasos = bloques.length*2+1
    let paso=0; const errs=[]

    for (const b of bloques) {
      paso++
      setProgreso({paso,total:totalPasos,accion:`Horarios ${b.desde}→${b.hasta}`,desde:b.desde,hasta:b.hasta})
      try { await callWorkera('sync_horarios',{desde:b.desde,hasta:b.hasta}) }
      catch(e) { errs.push(`Horarios ${b.desde}: ${e.message}`) }
    }
    for (const b of bloques) {
      paso++
      setProgreso({paso,total:totalPasos,accion:`Marcaciones ${b.desde}→${b.hasta}`,desde:b.desde,hasta:b.hasta})
      try { await callWorkera('sync_marcaciones',{desde:b.desde,hasta:b.hasta}) }
      catch(e) { errs.push(`Marcaciones ${b.desde}: ${e.message}`) }
    }
    paso++
    setProgreso({paso,total:totalPasos,accion:'Permisos',desde,hasta})
    try { await callWorkera('sync_permisos',{desde,hasta}) }
    catch(e) { errs.push(`Permisos: ${e.message}`) }

    setErrores(errs)
    setResultado({
      ok:errs.length===0,
      msg:errs.length===0
        ? `Sync completo: ${bloques.length} bloque(s), ${dias+1} días.`
        : `Terminado con ${errs.length} error(es). Revisa el log.`
    })
    setProgreso(null); setCorriendo(false); cargarLog()
  }

  const diasRango = Math.round((new Date(hasta)-new Date(desde))/86400000)+1
  const nBloques  = dividirRango(desde,hasta,55).length

  return (
    <div>
      <h2 style={{fontSize:22,fontWeight:700,margin:'0 0 4px 0'}}>Sincronización</h2>
      <p style={{color:'var(--text-muted)',fontSize:13,margin:'0 0 20px 0'}}>
        Mantén los datos actualizados desde Workera. Las acciones quedan registradas en el log.
      </p>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:16}}>
        {/* Card 1: Catálogos */}
        <div style={{padding:'18px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12}}>
          <div style={{fontSize:22,marginBottom:6}}>📋</div>
          <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>Catálogos y empleados</div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:14,lineHeight:1.5}}>
            Actualiza sucursales, departamentos y trabajadores. Sin rango. Ejecutar al inicio o cuando hay cambios de personal.
          </div>
          <button onClick={syncCatalogos} disabled={corriendo}
            style={{...btnSec,opacity:corriendo?0.5:1,cursor:corriendo?'wait':'pointer',width:'100%',justifyContent:'center',display:'flex'}}>
            {corriendo&&progreso?.total===2?'Sincronizando...':'🔄 Sync catálogos'}
          </button>
        </div>

        {/* Card 2: Completo */}
        <div style={{padding:'18px',background:'var(--bg-surface)',border:'1px solid var(--accent)30',borderRadius:12}}>
          <div style={{fontSize:22,marginBottom:6}}>⚡</div>
          <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>Sync completo del período</div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12,lineHeight:1.5}}>
            Marcaciones + horarios + permisos. Rangos largos se dividen automáticamente en bloques de 55 días.
          </div>
          <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
            {PRESETS.map(p=>(
              <button key={p.k} onClick={()=>aplicarPreset(p.k)} style={{
                padding:'4px 10px',border:'1px solid var(--border)',borderRadius:100,
                cursor:'pointer',fontSize:11,fontWeight:500,
                background:rangoPreset===p.k?'var(--accent)15':'transparent',
                color:rangoPreset===p.k?'var(--accent)':'var(--text)',
                borderColor:rangoPreset===p.k?'var(--accent)':'var(--border)'
              }}>{p.l}</button>
            ))}
          </div>
          <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
            <input type="date" value={desde} max={hoy()}
              onChange={e=>{setDesde(e.target.value);setPreset('libre')}} style={inp}/>
            <span style={{color:'var(--text-muted)',fontSize:12}}>→</span>
            <input type="date" value={hasta} max={hoy()}
              onChange={e=>{setHasta(e.target.value);setPreset('libre')}} style={inp}/>
            <span style={{fontSize:11,color:'var(--text-muted)'}}>{diasRango} días · {nBloques} bloques</span>
          </div>
          <button onClick={syncCompleto} disabled={corriendo}
            style={{...btnPri,opacity:corriendo?0.5:1,cursor:corriendo?'wait':'pointer',width:'100%'}}>
            {corriendo&&progreso?.total>2?'Sincronizando...':'⚡ Sincronizar período'}
          </button>
        </div>
      </div>

      {/* Barra de progreso */}
      {corriendo&&progreso&&(
        <div style={{marginBottom:14,padding:'12px 16px',background:'var(--accent)08',border:'1px solid var(--accent)30',borderRadius:10}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:8}}>
            <span style={{fontWeight:600,color:'var(--accent)'}}>{progreso.accion}</span>
            <span style={{color:'var(--text-muted)'}}>{progreso.paso} / {progreso.total}</span>
          </div>
          <div style={{height:6,background:'var(--border)',borderRadius:3,overflow:'hidden'}}>
            <div style={{height:'100%',borderRadius:3,background:'var(--accent)',
              width:`${Math.round(progreso.paso/progreso.total*100)}%`,transition:'width 0.4s'}}/>
          </div>
        </div>
      )}

      {/* Resultado */}
      {resultado&&!corriendo&&(
        <div style={{marginBottom:14,padding:'12px 16px',borderRadius:10,
          background:resultado.ok?'var(--success)10':'var(--danger)10',
          border:`1px solid ${resultado.ok?'var(--success)':'var(--danger)'}40`}}>
          <div style={{fontWeight:700,color:resultado.ok?'var(--success)':'var(--danger)',marginBottom:errores.length>0?6:0}}>
            {resultado.ok?'✅':'❌'} {resultado.msg}
          </div>
          {errores.length>0&&(
            <ul style={{margin:'4px 0 0 0',paddingLeft:18,fontSize:12,color:'var(--danger)'}}>
              {errores.map((e,i)=><li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      <div style={{marginBottom:16,padding:'10px 14px',borderRadius:8,background:'var(--bg-app)',border:'1px solid var(--border)',fontSize:12,color:'var(--text-muted)'}}>
        💡 <strong>Flujo mensual:</strong> Sync catálogos → Sync completo del mes. Los atrasos y horas extra se calculan automáticamente en <strong>Análisis</strong>.
      </div>

      {/* Log */}
      <div style={{fontSize:12,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:8}}>
        Log de sincronizaciones
      </div>
      <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr style={{background:'var(--bg-app)'}}>
            <th style={thS}>Tipo</th><th style={thS}>Inicio</th><th style={thS}>Duración</th>
            <th style={thS}>Rango</th>
            <th style={{...thS,textAlign:'right'}}>Consultados</th>
            <th style={{...thS,textAlign:'right'}}>Nuevos</th>
            <th style={thS}>Estado</th>
          </tr></thead>
          <tbody>
            {cargandoLog?<tr><td colSpan={7} style={{padding:18,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</td></tr>
            :log.length===0?<tr><td colSpan={7} style={{padding:18,textAlign:'center',color:'var(--text-muted)'}}>Sin sincronizaciones aún</td></tr>
            :log.map(l=>(
              <tr key={l.id}>
                <td style={{...tdS,fontWeight:600}}>{l.tipo}</td>
                <td style={tdS}>{new Date(l.inicio).toLocaleString('es-CL')}</td>
                <td style={tdS}>{l.duracion_ms?`${(l.duracion_ms/1000).toFixed(1)}s`:'—'}</td>
                <td style={{...tdS,fontSize:11,color:'var(--text-muted)'}}>
                  {l.rango_desde&&l.rango_hasta?`${l.rango_desde} → ${l.rango_hasta}`:'—'}
                </td>
                <td style={{...tdS,textAlign:'right'}}>{l.registros_consultados??0}</td>
                <td style={{...tdS,textAlign:'right',fontWeight:600}}>{l.registros_nuevos??0}</td>
                <td style={tdS}>
                  <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:100,
                    background:l.estado==='ok'?'var(--success)15':l.estado==='error'?'var(--danger)15':'var(--warning)15',
                    color:l.estado==='ok'?'var(--success)':l.estado==='error'?'var(--danger)':'var(--warning)'}}>
                    {l.estado}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:8}}>
        <button onClick={cargarLog} style={{padding:'7px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:12}}>
          🔄 Refrescar log
        </button>
      </div>
    </div>
  )
}

const lbl = {display:'block',fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.04em'}
const inp = {padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:12,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit'}
const btnPri = {padding:'10px 18px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}
const btnSec = {padding:'9px 14px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:500}
const thS = {padding:'9px 12px',textAlign:'left',fontWeight:600,fontSize:10,textTransform:'uppercase',letterSpacing:'0.04em',color:'var(--text-muted)',borderBottom:'1px solid var(--border)'}
const tdS = {padding:'8px 12px',borderBottom:'1px solid var(--border)',verticalAlign:'middle'}
