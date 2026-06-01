// src/rrhh/asistencia/tabs/AsisDashboard.jsx
// Dashboard principal — métricas reales desde v_asis_jornadas + sync log.

import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'

const fMin = m => {
  if (!m) return '0m'
  const h = Math.floor(m / 60), min = m % 60
  return h > 0 ? `${h}h${min > 0 ? ' ' + min + 'm' : ''}` : `${min}m`
}

export function AsisDashboard({ cu, onIrASync }) {
  const [data, setData]       = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCargando(true)
    try {
      const hoy   = new Date()
      const iMes  = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0,10)
      const fHoy  = hoy.toISOString().slice(0,10)
      const mes   = hoy.toLocaleString('es-CL', { month:'long', year:'numeric' })

      const [
        marcaciones, permisos, mapeados, sinMapear, ultimaSync,
        jornadasMes
      ] = await Promise.all([
        supabase.from('asis_marcaciones').select('id',{count:'exact',head:true}).gte('fecha_hora', iMes),
        supabase.from('asis_permisos').select('id',{count:'exact',head:true}).gte('inicio', iMes),
        supabase.from('asis_mapeo_empleados').select('cod_contaline',{count:'exact',head:true}),
        supabase.from('asis_staging_empleados_workera').select('workera_code',{count:'exact',head:true})
          .is('sugerencia_cod_contaline', null).eq('employee_status','ACTIVO'),
        supabase.from('asis_sync_log').select('inicio,tipo,estado,registros_nuevos,registros_consultados')
          .order('inicio',{ascending:false}).limit(6),
        supabase.from('v_asis_jornadas').select('estado_dia,min_atraso_contable,min_extra_dia')
          .gte('fecha', iMes).lte('fecha', fHoy)
      ])

      // Calcular métricas de jornadas del mes
      const jd = jornadasMes.data || []
      // Excluir sin_turno (jornadas sin horario asignado en Workera para esa fecha)
      const jdConTurno = jd.filter(r => r.estado_dia !== 'sin_turno')
      const sinTurno    = jd.filter(r => r.estado_dia === 'sin_turno').length
      const puntuales   = jdConTurno.filter(r => r.estado_dia === 'puntual').length
      const atrasos     = jdConTurno.filter(r => r.estado_dia === 'atraso').length
      const extras      = jdConTurno.filter(r => r.estado_dia === 'hizo_extra').length
      const corridos    = jdConTurno.filter(r => r.estado_dia === 'turno_corrido').length
      const incompletas = jdConTurno.filter(r => r.estado_dia === 'incompleta' || r.estado_dia === 'sin_marcas').length
      const minAtraso   = jdConTurno.reduce((s,r) => s + (r.min_atraso_contable||0), 0)
      const minExtra    = jdConTurno.reduce((s,r) => s + (r.min_extra_dia||0), 0)
      const excesosLeg  = jdConTurno.filter(r => (r.min_extra_dia||0) > 120).length
      const pctPuntual  = jdConTurno.length > 0 ? Math.round(puntuales / jdConTurno.length * 100) : 0

      setData({
        mes, marcaciones: marcaciones.count??0, permisos: permisos.count??0,
        mapeados: mapeados.count??0, sinMapear: sinMapear.count??0,
        ultimaSync: ultimaSync.data??[],
        jornadas: jdConTurno.length, sinTurno, puntuales, atrasos, extras, corridos,
        incompletas, minAtraso, minExtra, excesosLeg, pctPuntual
      })
    } catch(e) { console.error(e) }
    finally { setCargando(false) }
  }

  if (cargando) return <div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</div>
  if (!data) return null

  const sinDatos = data.marcaciones === 0 && data.jornadas === 0
  if (sinDatos) return <EstadoVacio onIrASync={onIrASync} />

  const ultimoSync = data.ultimaSync[0]
  const syncFecha  = ultimoSync ? new Date(ultimoSync.inicio).toLocaleString('es-CL') : null

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
        <div>
          <h2 style={{fontSize:22,fontWeight:700,margin:0}}>Dashboard Asistencia</h2>
          <div style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>
            {data.mes} · {data.jornadas} jornadas analizadas
            {data.sinTurno > 0 && <span style={{marginLeft:6,color:'var(--text-muted)'}}>· {data.sinTurno} sin turno asignado</span>}
            {syncFecha && <span style={{marginLeft:8,color:'var(--text-muted)'}}>· Última sync: {syncFecha}</span>}
          </div>
        </div>
        <button onClick={cargar} style={btnSec}>🔄 Actualizar</button>
      </div>

      {/* KPIs de puntualidad — los datos que importan */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:20}}>
        <Kpi ic="✅" l="Puntualidad" v={data.pctPuntual+'%'} sub={`${data.puntuales} días puntuales`} c="var(--success,#34C759)"/>
        <Kpi ic="⚠️" l="Atrasos" v={data.atrasos} sub={fMin(data.minAtraso)+' acum.'} c="#FF3B30"/>
        <Kpi ic="⏱" l="Horas extra" v={data.extras} sub={fMin(data.minExtra)+' acum.'} c="var(--accent,#007AFF)"/>
        <Kpi ic="🔄" l="Turno corrido" v={data.corridos} sub="Revisar en Workera" c="#FF9500"
          alerta={data.corridos > 0}/>
        <Kpi ic="🚨" l="Exceso legal" v={data.excesosLeg} sub=">2h extra en 1 jornada" c="#FF3B30"
          alerta={data.excesosLeg > 0}/>
        <Kpi ic="❓" l="Incompletas" v={data.incompletas} sub="Sin entrada o salida" c="#AF52DE"/>
      </div>

      {/* KPIs de operación */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:20}}>
        <Kpi ic="🕐" l="Marcaciones" v={data.marcaciones.toLocaleString('es-CL')} sub="este mes" c="var(--text)"/>
        <Kpi ic="📋" l="Permisos" v={data.permisos.toLocaleString('es-CL')} sub="este mes" c="var(--text)"/>
        <Kpi ic="👥" l="Empleados mapeados" v={data.mapeados} sub="en el ERP" c="var(--success,#34C759)"/>
        {data.sinMapear > 0 && <Kpi ic="🔗" l="Sin mapear" v={data.sinMapear} sub="requieren acción" c="#FF3B30" alerta/>}
      </div>

      {/* Alertas */}
      {(data.sinMapear > 0 || data.excesosLeg > 0 || data.corridos > 5) && (
        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:20}}>
          {data.sinMapear > 0 && (
            <Alerta tipo="warning" ic="⚠️"
              msg={`${data.sinMapear} empleados activos de Workera sin mapear en el ERP`}
              accion="Ir a Config → Empleados" onClick={onIrASync}/>
          )}
          {data.excesosLeg > 0 && (
            <Alerta tipo="danger" ic="🚨"
              msg={`${data.excesosLeg} jornadas superan el máximo legal de 2h extra diarias este mes`}
              accion="Ver en Análisis" onClick={() => {}}/>
          )}
          {data.corridos > 5 && (
            <Alerta tipo="warning" ic="🔄"
              msg={`${data.corridos} jornadas marcadas como turno corrido — posibles turnos mal asignados en Workera`}
              accion="Ver en Análisis" onClick={() => {}}/>
          )}
        </div>
      )}

      {/* Log de syncs */}
      {data.ultimaSync.length > 0 && (
        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,padding:16}}>
          <div style={{fontSize:12,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:12}}>
            Últimas sincronizaciones
          </div>
          {data.ultimaSync.map((s,i) => (
            <div key={i} style={{
              display:'flex',alignItems:'center',justifyContent:'space-between',
              padding:'8px 0',fontSize:13,
              borderBottom: i < data.ultimaSync.length-1 ? '1px solid var(--border)' : 'none'
            }}>
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <span style={{
                  fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,
                  background: s.estado==='ok'?'var(--success)15':s.estado==='error'?'var(--danger)15':'var(--warning)15',
                  color: s.estado==='ok'?'var(--success)':s.estado==='error'?'var(--danger)':'var(--warning)'
                }}>{s.estado}</span>
                <span style={{fontWeight:500}}>{s.tipo}</span>
              </div>
              <div style={{color:'var(--text-muted)',fontSize:12}}>
                {new Date(s.inicio).toLocaleString('es-CL')} · {(s.registros_nuevos??0).toLocaleString('es-CL')} nuevos
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Kpi({ ic, l, v, sub, c, alerta }) {
  return (
    <div style={{
      background: alerta ? '#FF3B3008' : 'var(--bg-surface)',
      border: `1px solid ${alerta ? '#FF3B3040' : 'var(--border)'}`,
      borderRadius:12, padding:'14px 16px'
    }}>
      <div style={{fontSize:20,marginBottom:4}}>{ic}</div>
      <div style={{fontSize:24,fontWeight:800,color:c}}>{v}</div>
      <div style={{fontSize:12,fontWeight:600,marginTop:2}}>{l}</div>
      <div style={{fontSize:11,color:'var(--text-muted)'}}>{sub}</div>
    </div>
  )
}

function Alerta({ tipo, ic, msg, accion, onClick }) {
  const c = tipo==='danger' ? '#FF3B30' : tipo==='warning' ? 'var(--warning,#FF9500)' : 'var(--accent)'
  return (
    <div style={{
      padding:'12px 16px',borderRadius:10,fontSize:13,
      background:`${c}10`,border:`1px solid ${c}40`,
      display:'flex',alignItems:'center',justifyContent:'space-between',gap:12
    }}>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <span>{ic}</span><span>{msg}</span>
      </div>
      <button onClick={onClick} style={{padding:'6px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:6,cursor:'pointer',fontSize:12,whiteSpace:'nowrap'}}>{accion}</button>
    </div>
  )
}

function EstadoVacio({ onIrASync }) {
  return (
    <div style={{maxWidth:500,margin:'60px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'48px 32px'}}>
      <div style={{fontSize:56,marginBottom:16}}>📊</div>
      <h2 style={{margin:'0 0 8px 0',fontSize:20,fontWeight:700}}>Sin datos de asistencia aún</h2>
      <p style={{color:'var(--text-muted)',fontSize:14,lineHeight:1.5,margin:'0 0 24px 0'}}>
        Sincroniza marcaciones y horarios desde Config para ver el dashboard.
      </p>
      <button onClick={onIrASync} style={{padding:'10px 20px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:600}}>
        Ir a Sincronización →
      </button>
    </div>
  )
}

const btnSec = {padding:'8px 14px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}
