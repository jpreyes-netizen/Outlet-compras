// src/rrhh/asistencia/tabs/AsisDashboard.jsx
import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'

export function AsisDashboard({ cu, onIrASync }) {
  const [data, setData] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCargando(true)
    try {
      const hoy = new Date()
      const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0,10)
      const fHoy = hoy.toISOString().slice(0,10)

      const [totalMarcaciones, totalPermisos, totalHHEE, mapeados, sinMapear, sinMatch, ultimaSync] = await Promise.all([
        supabase.from('asis_marcaciones').select('id', { count:'exact', head:true }).gte('fecha_hora', inicioMes),
        supabase.from('asis_permisos').select('id', { count:'exact', head:true }).gte('inicio', inicioMes),
        supabase.from('asis_horas_extras').select('id', { count:'exact', head:true }).gte('fecha_autorizada', inicioMes),
        supabase.from('asis_mapeo_empleados').select('cod_contaline', { count:'exact', head:true }),
        supabase.from('asis_staging_empleados_workera').select('workera_code', { count:'exact', head:true }).is('sugerencia_cod_contaline', null).eq('employee_status','ACTIVO'),
        supabase.from('v_asis_sin_match').select('workera_employee_code', { count:'exact', head:true }),
        supabase.from('asis_sync_log').select('inicio,tipo,estado,registros_nuevos').order('inicio',{ascending:false}).limit(5)
      ])

      setData({
        marcaciones: totalMarcaciones.count ?? 0,
        permisos: totalPermisos.count ?? 0,
        hhee: totalHHEE.count ?? 0,
        mapeados: mapeados.count ?? 0,
        sinMapear: sinMapear.count ?? 0,
        sinMatch: sinMatch.count ?? 0,
        ultimaSync: ultimaSync.data ?? [],
        mes: hoy.toLocaleString('es-CL', { month:'long', year:'numeric' })
      })
    } catch(e) {
      console.error(e)
    } finally {
      setCargando(false)
    }
  }

  if (cargando) return <div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</div>

  const sinDatos = data.marcaciones === 0 && data.permisos === 0 && data.hhee === 0

  if (sinDatos) return <EstadoVacio onIrASync={onIrASync} />

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
        <div>
          <h2 style={{fontSize:22,fontWeight:700,margin:0}}>Dashboard Asistencia</h2>
          <div style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>Datos del mes de {data.mes}</div>
        </div>
        <button onClick={cargar} style={btnSec}>Actualizar</button>
      </div>

      {/* KPIs principales */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginBottom:20}}>
        <KPI ic="🕐" label="Marcaciones" v={data.marcaciones} sub="este mes" c="var(--accent)" />
        <KPI ic="📋" label="Permisos" v={data.permisos} sub="este mes" c="var(--warning)" />
        <KPI ic="⏱" label="HHEE autorizadas" v={data.hhee} sub="este mes" c="var(--purple,#7c3aed)" />
        <KPI ic="👥" label="Empleados mapeados" v={data.mapeados} sub="de Workera" c="var(--success)" />
      </div>

      {/* Alertas */}
      <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:20}}>
        {data.sinMapear > 0 && (
          <Alerta tipo="warning" ic="⚠️"
            msg={`${data.sinMapear} empleados activos de Workera sin mapear en el ERP`}
            accion="Ir a Config → Empleados" onClick={onIrASync} />
        )}
        {data.sinMatch > 0 && (
          <Alerta tipo="info" ic="🔍"
            msg={`${data.sinMatch} empleados marcaron asistencia sin coincidencia en el ERP`}
            accion="Ver sin match" onClick={onIrASync} />
        )}
      </div>

      {/* Ultima sync */}
      {data.ultimaSync.length > 0 && (
        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,padding:16}}>
          <div style={{fontSize:13,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:10}}>
            Ultimas sincronizaciones
          </div>
          {data.ultimaSync.map((s,i) => (
            <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0',borderBottom: i < data.ultimaSync.length-1 ? '1px solid var(--border)' : 'none',fontSize:13}}>
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <span style={{
                  fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,
                  background: s.estado==='ok' ? 'var(--success)15' : s.estado==='error' ? 'var(--danger)15' : 'var(--warning)15',
                  color: s.estado==='ok' ? 'var(--success)' : s.estado==='error' ? 'var(--danger)' : 'var(--warning)'
                }}>{s.estado}</span>
                <span style={{fontWeight:500}}>{s.tipo}</span>
              </div>
              <div style={{color:'var(--text-muted)',fontSize:12}}>
                {new Date(s.inicio).toLocaleString('es-CL')} · {s.registros_nuevos ?? 0} nuevos
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EstadoVacio({ onIrASync }) {
  return (
    <div style={{maxWidth:500,margin:'60px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'48px 32px'}}>
      <div style={{fontSize:56,marginBottom:16}}>📊</div>
      <h2 style={{margin:'0 0 8px 0',fontSize:20,fontWeight:700}}>Sin datos de asistencia aun</h2>
      <p style={{color:'var(--text-muted)',fontSize:14,lineHeight:1.5,margin:'0 0 24px 0'}}>
        Para ver el dashboard necesitas sincronizar los datos de Workera. Ve a Config → Sincronizacion y ejecuta la primera sync.
      </p>
      <button onClick={onIrASync} style={btnPri}>Ir a Sincronizacion →</button>
    </div>
  )
}

function KPI({ ic, label, v, sub, c }) {
  return (
    <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'16px 18px'}}>
      <div style={{fontSize:24,marginBottom:6}}>{ic}</div>
      <div style={{fontSize:28,fontWeight:800,color:c}}>{v.toLocaleString('es-CL')}</div>
      <div style={{fontSize:13,fontWeight:600,marginTop:2}}>{label}</div>
      <div style={{fontSize:11,color:'var(--text-muted)'}}>{sub}</div>
    </div>
  )
}

function Alerta({ tipo, ic, msg, accion, onClick }) {
  return (
    <div style={{
      padding:'12px 16px',borderRadius:10,
      background: tipo==='warning' ? 'var(--warning)10' : 'var(--accent)10',
      border: `1px solid ${tipo==='warning' ? 'var(--warning)' : 'var(--accent)'}40`,
      display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,fontSize:13
    }}>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <span>{ic}</span>
        <span>{msg}</span>
      </div>
      <button onClick={onClick} style={{...btnSecSmall,whiteSpace:'nowrap'}}>{accion}</button>
    </div>
  )
}

const btnPri = {padding:'10px 20px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:600}
const btnSec = {padding:'8px 14px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}
const btnSecSmall = {padding:'6px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:6,cursor:'pointer',fontSize:12}
