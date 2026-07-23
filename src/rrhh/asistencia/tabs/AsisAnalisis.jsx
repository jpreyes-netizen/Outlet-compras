// src/rrhh/asistencia/tabs/AsisAnalisis.jsx
// Fusión de Jornadas + Extra/Atrasos.
// 3 vistas internas: Resumen (sucursal→área→trabajador), Reporte legal, Bitácora.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabase'
import { canSync } from '../../../core/permisos'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import 'jspdf-autotable'

const LIMITE_EXTRA_MIN = 120 // 2h legales

const fMin = m => {
  if (!m || m === 0) return '—'
  const h = Math.floor(Math.abs(m)/60), min = Math.abs(m)%60
  return h > 0 ? `${h}h${min>0?' '+min+'m':''}` : `${min}m`
}
const fHora  = ts => ts ? new Date(ts).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'}) : '—'
const fFecha = d  => d  ? new Date(d+'T12:00:00').toLocaleDateString('es-CL',{weekday:'short',day:'2-digit',month:'short'}) : '—'
const hoy    = ()  => new Date().toISOString().slice(0,10)
const hace7  = ()  => { const d=new Date(); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10) }
const iMes   = ()  => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` }
const iMAnt  = ()  => { const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,10) }
const fMAnt  = ()  => { const d=new Date(); d.setDate(0); return d.toISOString().slice(0,10) }

const RANGOS = [
  {k:'7d',  l:'Últimos 7 días', desde:hace7, hasta:hoy},
  {k:'mes', l:'Este mes',       desde:iMes,  hasta:hoy},
  {k:'mant',l:'Mes anterior',   desde:iMAnt, hasta:fMAnt},
  {k:'libre',l:'Rango libre',   desde:hace7, hasta:hoy},
]

const EST = {
  puntual:           {c:'#34C759',bg:'#34C75912',ic:'✅',l:'Puntual'},
  hizo_extra:        {c:'#007AFF',bg:'#007AFF12',ic:'⏱', l:'Horas extra'},
  atraso:            {c:'#FF3B30',bg:'#FF3B3012',ic:'⚠️',l:'Atraso'},
  salida_anticipada: {c:'#FF6B35',bg:'#FF6B3512',ic:'🏃',l:'Salida anticipada'},
  turno_corrido:     {c:'#FF9500',bg:'#FF950012',ic:'🔄',l:'Turno corrido'},
  incompleta:        {c:'#AF52DE',bg:'#AF52DE12',ic:'❓',l:'Incompleta'},
  sin_marcas:        {c:'#8E8E93',bg:'#8E8E9312',ic:'⭕',l:'Sin marcas'},
  sin_turno:         {c:'#6B7280',bg:'#6B728012',ic:'📭',l:'Sin turno asignado'},
}

const TIPO_MARCA = {
  0: { ic:'🟢', l:'Entrada' },
  1: { ic:'🔴', l:'Salida'  },
  2: { ic:'🟣', l:'Salida extra' },
  3: { ic:'🟣', l:'Entrada extra' },
  4: { ic:'🍴', l:'Inicio colación' },
  5: { ic:'🍴', l:'Fin colación' },
}

// Estados de colación (Art. 34 Código del Trabajo Chile)
const COL = {
  ok:          { c:'#34C759', bg:'#34C75912', ic:'✅', l:'OK' },
  breve:       { c:'#FF9500', bg:'#FF950012', ic:'⏱',  l:'Colación breve' },
  extendida:   { c:'#FF9500', bg:'#FF950012', ic:'⏲',  l:'Colación extendida' },
  parcial:     { c:'#FF3B30', bg:'#FF3B3012', ic:'⚠️', l:'Marcó solo un extremo' },
  no_marcada:  { c:'#FF3B30', bg:'#FF3B3012', ic:'🚫', l:'Sin colación marcada' },
  no_aplica:   { c:'#8E8E93', bg:'#8E8E9312', ic:'—',  l:'No aplica (jornada ≤6h)' },
}

const AUS_CATS = {
  falta_injustificada: { l:'Falta injustificada', c:'#FF3B30', ic:'⛔' },
  licencia_medica:     { l:'Licencia médica',     c:'#0A84FF', ic:'🏥' },
  permiso_con_goce:    { l:'Permiso con goce',    c:'#34C759', ic:'✅' },
  permiso_sin_goce:    { l:'Permiso sin goce',    c:'#FF9500', ic:'📄' },
}

export function AsisAnalisis({ cu, onIrASync, onNavegar, scopeSuc }) {
  const [fil, setFil]   = useState({rango:'mes',desde:iMes(),hasta:hoy(),sucursal:'todas'})
  const [incluirSinTurno, setIncluirSinTurno] = useState(false)
  const [datos, setDatos] = useState([])
  const [cargando, setCarg] = useState(true)
  const [vista, setVista]  = useState('resumen') // resumen | legal | bitacora
  const [drillSuc, setDrillSuc]   = useState(null)
  const [drillArea, setDrillArea] = useState(null)
  const [drillCod, setDrillCod]   = useState(null)
  const [drillNom, setDrillNom]   = useState(null)

  useEffect(() => { cargar() }, [fil.desde, fil.hasta, scopeSuc])

  async function cargar() {
    setCarg(true)
    try {
      let q = supabase
        .from('v_asis_jornadas').select('*')
        .gte('fecha', fil.desde).lte('fecha', fil.hasta)
        .order('fecha',{ascending:false})
        .limit(20000) // evita truncamiento silencioso a 1.000 filas de Supabase
      if (scopeSuc) q = q.eq('sucursal_id', scopeSuc)
      const { data, error } = await q
      if (error) throw error
      setDatos(data||[])
    } catch(e) { console.error(e) }
    finally { setCarg(false) }
  }

  function aplicarRango(k) {
    const r = RANGOS.find(x=>x.k===k)
    if (!r) return
    setFil(f=>({...f,rango:k,desde:r.desde(),hasta:r.hasta()}))
    resetDrill()
  }

  function resetDrill() {
    setDrillSuc(null); setDrillArea(null); setDrillCod(null); setDrillNom(null)
  }

  const sucs = useMemo(() => [...new Set(datos.map(r=>r.sucursal_nombre).filter(Boolean))].sort(),[datos])

  const puedeCorregirDirecto = !!canSync(cu, 'rrhh', 'rrhh.asistencia.corregir_turno') || !!canSync(cu, 'rrhh', 'rrhh.asistencia.aprobar_turno')
  const puedeProponer = !!canSync(cu, 'rrhh', 'rrhh.asistencia.proponer_turno')
  const puedeAprobarTurno = !!canSync(cu, 'rrhh', 'rrhh.asistencia.aprobar_turno')
  const puedeCorregir = puedeCorregirDirecto || puedeProponer

  // Filtrado global: excluye sin_turno por defecto (datos sin cobertura en Workera)
  const datosBase = useMemo(()=>{
    return datos.filter(r =>
      (incluirSinTurno || r.estado_dia !== 'sin_turno') &&
      (fil.sucursal === 'todas' || r.sucursal_nombre === fil.sucursal)
    )
  },[datos, incluirSinTurno, fil.sucursal])

  const datosFil = useMemo(() => {
    let d = datosBase
    if (drillSuc)  d = d.filter(r=>r.sucursal_nombre===drillSuc)
    if (drillArea) d = d.filter(r=>r.departamento===drillArea)
    if (drillCod)  d = d.filter(r=>r.cod_contaline===drillCod)
    return d
  },[datosBase,drillSuc,drillArea,drillCod])

  const agruSuc  = useMemo(()=>agrupar(datosBase,'sucursal_nombre'),[datosBase])
  const agruArea = useMemo(()=>agrupar(datosBase.filter(r=>!drillSuc||r.sucursal_nombre===drillSuc),'departamento'),[datosBase,drillSuc])
  const agruTrab = useMemo(()=>agruparTrab(datosBase.filter(r=>(!drillSuc||r.sucursal_nombre===drillSuc)&&(!drillArea||r.departamento===drillArea))),[datosBase,drillSuc,drillArea])

  // KPIs reactivos al drill-down (sucursal/area/trabajador) y filtro de sucursal
  const kpis = useMemo(()=>{
    const d = datosFil
    const totalCol = d.filter(r=>r.estado_colacion && r.estado_colacion!=='no_aplica').length
    return {
      tot: d.length,
      puntual: d.filter(r=>r.estado_dia==='puntual').length,
      atraso:  d.filter(r=>r.estado_dia==='atraso').length,
      extra:   d.filter(r=>r.estado_dia==='hizo_extra').length,
      salidaAnt: d.filter(r=>r.estado_dia==='salida_anticipada').length,
      corrido: d.filter(r=>r.estado_dia==='turno_corrido').length,
      incompleta: d.filter(r=>r.estado_dia==='incompleta').length,
      ausencias:  d.filter(r=>r.estado_dia==='sin_marcas').length,
      sinTurno: datos.filter(r=>r.estado_dia==='sin_turno' && (fil.sucursal==='todas'||r.sucursal_nombre===fil.sucursal)).length,
      minAtraso: d.reduce((s,r)=>s+(r.min_atraso_contable||0),0),
      minExtra:  d.reduce((s,r)=>s+(r.min_extra_dia||0),0),
      minSalAnt: d.reduce((s,r)=>s+(r.min_salida_anticipada_contable||0),0),
      excesos:   d.filter(r=>(r.min_extra_dia||0)>LIMITE_EXTRA_MIN).length,
      // % puntualidad cuenta puntual + hizo_extra como "OK" (no son atrasos)
      pct: d.length>0 ? Math.round((d.filter(r=>r.estado_dia==='puntual'||r.estado_dia==='hizo_extra').length / d.length) * 100) : 0,
      pctSoloPuntual: d.length>0 ? Math.round(d.filter(r=>r.estado_dia==='puntual').length / d.length * 100) : 0,
      colNoMarcada: d.filter(r=>r.estado_colacion==='no_marcada').length,
      colParcial:   d.filter(r=>r.estado_colacion==='parcial').length,
      colBreve:     d.filter(r=>r.estado_colacion==='breve').length,
      colOk:        d.filter(r=>r.estado_colacion==='ok').length,
      colAplica:    totalCol,
    }
  },[datosFil, datos, fil.sucursal])

  function exportarExcel() {
    const base2 = datosBase
    const trabMap = {}
    for (const r of base2) {
      const k = r.cod_contaline
      if (!trabMap[k]) trabMap[k]={nombre:r.empleado,sucursal:r.sucursal_nombre,area:r.departamento,
        diasExtra:0,minExtra:0,diasAtraso:0,minAtraso:0,diasExceso:0,turnosCorridos:0}
      const t = trabMap[k]
      if((r.min_extra_dia||0)>0) { t.diasExtra++; t.minExtra+=r.min_extra_dia||0 }
      if((r.min_atraso_contable||0)>0) { t.diasAtraso++; t.minAtraso+=r.min_atraso_contable||0 }
      if((r.min_extra_dia||0)>LIMITE_EXTRA_MIN) t.diasExceso++
      if(r.estado_dia==='turno_corrido') t.turnosCorridos++
    }
    const resumen = Object.values(trabMap).map(t=>({
      'Trabajador':t.nombre,'Sucursal':t.sucursal,'Área':t.area,
      'Días con extra':t.diasExtra,'Total extra (min)':t.minExtra,'Total extra':fMin(t.minExtra),
      'Días con atraso':t.diasAtraso,'Total atraso (min)':t.minAtraso,'Total atraso':fMin(t.minAtraso),
      'Días exceso tope (>2h)':t.diasExceso,'Días turno corrido':t.turnosCorridos,
    }))
    const detalle = base2
      .filter(r=>(r.min_extra_dia||0)>0||(r.min_atraso_contable||0)>0)
      .sort((a,b)=>(a.empleado||'').localeCompare(b.empleado||'')||(a.fecha<b.fecha?-1:1))
      .map(r=>({
        'Trabajador':r.empleado,'Sucursal':r.sucursal_nombre,'Área':r.departamento,
        'Fecha':r.fecha,'Turno':r.workshift_name,
        'Entrada esperada':fHora(r.entrada_esperada),'Entrada real':fHora(r.entrada_real),
        'Salida esperada':fHora(r.salida_esperada),'Salida real':fHora(r.salida_real),
        'Atraso':fMin(r.min_atraso_contable),'Extra (min)':r.min_extra_dia||0,
        'Extra total':fMin(r.min_extra_dia),'Excede tope 2h':(r.min_extra_dia||0)>120?'SÍ':'',
        'Estado':r.estado_dia,
      }))
    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.json_to_sheet(resumen)
    const ws2 = XLSX.utils.json_to_sheet(detalle)
    ws1['!cols'] = Array(11).fill({wch:18})
    ws2['!cols'] = Array(15).fill({wch:16})
    XLSX.utils.book_append_sheet(wb,ws1,'Resumen por trabajador')
    XLSX.utils.book_append_sheet(wb,ws2,'Detalle diario')
    XLSX.writeFile(wb,`asistencia_${fil.desde}_${fil.hasta}.xlsx`)
  }

  if (!cargando && datos.length===0) return (
    <div style={{maxWidth:480,margin:'60px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'40px 28px'}}>
      <div style={{fontSize:52,marginBottom:12}}>📅</div>
      <h3 style={{margin:'0 0 8px 0'}}>Sin datos de jornadas</h3>
      <p style={{color:'var(--text-muted)',fontSize:13,margin:'0 0 20px 0'}}>Sincroniza marcaciones y horarios desde Config.</p>
      <button onClick={onIrASync} style={btnPri}>Ir a Sincronización →</button>
    </div>
  )

  return (
    <div>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:10}}>
        <div>
          <h2 style={{fontSize:22,fontWeight:700,margin:0}}>Análisis de Asistencia</h2>
          <div style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>{fil.desde} → {fil.hasta}</div>
        </div>
        <button onClick={exportarExcel} style={btnExcel}>📥 Exportar Excel</button>
      </div>

      {/* Rango + sucursal */}
      <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap',alignItems:'center'}}>
        {RANGOS.map(r=>(
          <button key={r.k} onClick={()=>aplicarRango(r.k)} style={{
            ...presetBtn,
            background:fil.rango===r.k?'var(--accent)15':'transparent',
            color:fil.rango===r.k?'var(--accent)':'var(--text)',
            borderColor:fil.rango===r.k?'var(--accent)':'var(--border)'
          }}>{r.l}</button>
        ))}
        {fil.rango==='libre'&&(
          <>
            <input type="date" value={fil.desde} onChange={e=>setFil(f=>({...f,desde:e.target.value}))} style={inp}/>
            <span style={{color:'var(--text-muted)'}}>→</span>
            <input type="date" value={fil.hasta} onChange={e=>setFil(f=>({...f,hasta:e.target.value}))} style={inp}/>
            <button onClick={cargar} style={btnSec}>Buscar</button>
          </>
        )}
        {!scopeSuc && (
          <select value={fil.sucursal} onChange={e=>{setFil(f=>({...f,sucursal:e.target.value}));resetDrill()}} style={inp}>
            <option value="todas">Todas las sucursales</option>
            {sucs.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,cursor:'pointer',color:'var(--text-muted)',paddingLeft:4}}>
          <input type="checkbox" checked={incluirSinTurno}
            onChange={e=>setIncluirSinTurno(e.target.checked)}/>
          Incluir días sin turno asignado
        </label>
      </div>

      {/* Aviso de cobertura cuando hay sin_turno excluidos */}
      {!incluirSinTurno && kpis.sinTurno > 0 && (
        <div style={{marginBottom:14,padding:'10px 14px',borderRadius:8,background:'#6B728010',border:'1px solid #6B728030',fontSize:12,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:16}}>📭</span>
          <span>
            <strong>{kpis.sinTurno.toLocaleString('es-CL')} jornadas</strong> sin turno asignado en Workera están excluidas del análisis.
            Habitual en períodos antiguos donde no se habían configurado turnos.
          </span>
        </div>
      )}

      {/* Vista selector */}
      <div style={{display:'flex',gap:2,marginBottom:16,borderBottom:'1px solid var(--border)'}}>
        {[
          {k:'resumen',l:'📊 Resumen'},
          {k:'escalamiento', l:'🚨 Escalamiento'},
          {k:'legal',  l:'⏱ Exceso tope 2h'},
          {k:'ausencias',l:'⭕ Ausencias'},
          ...(puedeAprobarTurno ? [{k:'solicitudes',l:'🕓 Solicitudes de turno'}] : []),
          {k:'bitacora',l:'📋 Bitácora'},
        ].map(v=>(
          <button key={v.k} onClick={()=>{setVista(v.k);if(v.k!=='bitacora')resetDrill()}} style={{
            padding:'9px 16px',border:'none',background:'transparent',
            borderBottom:`3px solid ${vista===v.k?'var(--accent)':'transparent'}`,
            color:vista===v.k?'var(--accent)':'var(--text)',
            fontWeight:vista===v.k?600:400,fontSize:14,cursor:'pointer'
          }}>{v.l}</button>
        ))}
      </div>

      {/* KPIs siempre visibles — reflejan el drill-down activo */}
      <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:8,letterSpacing:'0.04em',textTransform:'uppercase',fontWeight:600}}>
        Métricas {kpis.tot > 0 ? `de ${kpis.tot.toLocaleString('es-CL')} jornadas` : ''}
        {drillSuc && <span> · {drillSuc}</span>}
        {drillArea && <span> › {drillArea}</span>}
        {drillCod && drillNom && <span> › {drillNom}</span>}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8,marginBottom:12}}>
        <MiniKpi ic="✅" l="Puntualidad" v={kpis.pct+'%'} sub={`${kpis.pctSoloPuntual}% sin desfase`} c="#34C759"/>
        <MiniKpi ic="⚠️" l="Atrasos" v={kpis.atraso} sub={fMin(kpis.minAtraso)+' acum.'} c="#FF3B30" alerta={kpis.atraso>0}/>
        <MiniKpi ic="⏱" l="Con extra" v={kpis.extra} sub={fMin(kpis.minExtra)+' acum.'} c="#007AFF"/>
        <MiniKpi ic="🏃" l="Salida ant." v={kpis.salidaAnt} sub={fMin(kpis.minSalAnt)+' acum.'} c="#FF6B35" alerta={kpis.salidaAnt>0}/>
        <MiniKpi ic="🚨" l="Exceso 2h" v={kpis.excesos} c="#FF3B30" alerta={kpis.excesos>0}/>
        <MiniKpi ic="🔄" l="Turno corrido" v={kpis.corrido} c="#FF9500" alerta={kpis.corrido>0}/>
        <MiniKpi ic="🍴" l="Sin colación" v={kpis.colNoMarcada} sub={kpis.colAplica>0?Math.round(kpis.colNoMarcada/kpis.colAplica*100)+'% del total':'—'} c={kpis.colNoMarcada>0?"#FF3B30":"#34C759"} alerta={kpis.colNoMarcada>0}/>
        <MiniKpi ic="❓" l="Incompletas" v={kpis.incompleta} c="#AF52DE" alerta={kpis.incompleta>0}/>
        <MiniKpi ic="⭕" l="Ausencias" v={kpis.ausencias} sub="días con turno sin marca" c={kpis.ausencias>0?"#FF3B30":"#34C759"} alerta={kpis.ausencias>0}/>
      </div>

      {/* Banner crítico si la falta de colación es sistémica (>50%) */}
      {kpis.colAplica > 0 && (kpis.colNoMarcada / kpis.colAplica) > 0.5 && (
        <div style={{marginBottom:14,padding:'14px 16px',borderRadius:10,background:'#FF3B3010',border:'1px solid #FF3B3040',display:'flex',gap:12,alignItems:'flex-start',fontSize:13}}>
          <span style={{fontSize:24}}>🚨</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,color:'#FF3B30',marginBottom:4}}>Incumplimiento sistémico de registro de colación</div>
            <div style={{color:'var(--text-muted)',fontSize:12,lineHeight:1.5}}>
              <strong>{kpis.colNoMarcada} de {kpis.colAplica} jornadas</strong> ({Math.round(kpis.colNoMarcada/kpis.colAplica*100)}%) no tienen colación marcada en el reloj biométrico.
              El <strong>Art. 34 del Código del Trabajo</strong> obliga a registrar el inicio y término de colación en jornadas mayores a 6 horas (mínimo legal: 30 minutos).
              Acción recomendada: comunicar a los trabajadores la obligación de marcar inicio/fin de colación.
            </div>
          </div>
        </div>
      )}

      {cargando ? (
        <div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</div>
      ) : vista==='resumen' ? (
        <VistaResumen
          agruSuc={agruSuc} agruArea={agruArea} agruTrab={agruTrab}
          drillSuc={drillSuc} drillArea={drillArea} drillNom={drillNom}
          setDrillSuc={setDrillSuc} setDrillArea={setDrillArea}
          setDrillCod={setDrillCod} setDrillNom={setDrillNom}
          onBitacora={()=>setVista('bitacora')}
        />
      ) : vista==='escalamiento' ? (
        <VistaEscalamiento
          datos={datosBase}
          fil={fil}
          onVerDetalle={(cod, nombre)=>{
            setDrillCod(cod); setDrillNom(nombre); setVista('bitacora')
          }}
        />
      ) : vista==='legal' ? (
        <VistaLegal datos={datosBase} />
      ) : vista==='ausencias' ? (
        <VistaAusenciasGlobal datos={datosBase} fil={fil} onNavegar={onNavegar}
          onVerBitacora={(cod,nombre)=>{ setDrillCod(cod); setDrillNom(nombre); setVista('bitacora') }}/>
      ) : vista==='solicitudes' ? (
        <VistaSolicitudesTurno cu={cu} scopeSuc={scopeSuc}
          onVerBitacora={(cod,nombre)=>{ setDrillCod(cod); setDrillNom(nombre); setVista('bitacora') }}/>
      ) : (
        <VistaBitacora onNavegar={onNavegar}
          agruTrab={agruTrab} datosFil={datosFil}
          drillCod={drillCod} drillNom={drillNom}
          setDrillCod={setDrillCod} setDrillNom={setDrillNom}
          datos={datosBase}
          drillSuc={drillSuc} drillArea={drillArea}
          fil={fil}
          cu={cu} puedeCorregir={puedeCorregir} puedeAprobar={puedeAprobarTurno} onRecargar={cargar}
        />
      )}
    </div>
  )
}

// ─── Vista Resumen ────────────────────────────────────────────────────────────
function VistaResumen({ agruSuc,agruArea,agruTrab,drillSuc,drillArea,drillNom,setDrillSuc,setDrillArea,setDrillCod,setDrillNom,onBitacora }) {
  const nivel = !drillSuc?'suc':!drillArea?'area':'trab'
  const rows  = nivel==='suc'?agruSuc:nivel==='area'?agruArea:agruTrab

  return (
    <div>
      {/* Breadcrumb */}
      {drillSuc && (
        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:12,fontSize:13,flexWrap:'wrap'}}>
          <button onClick={()=>{setDrillSuc(null);setDrillArea(null);setDrillCod(null);setDrillNom(null)}} style={breadBtn}>Todas las sucursales</button>
          {drillSuc&&<><span style={{color:'var(--text-muted)'}}>›</span>
          <button onClick={()=>{setDrillArea(null);setDrillCod(null);setDrillNom(null)}} style={drillArea?breadBtn:breadBtnAct}>{drillSuc}</button></>}
          {drillArea&&<><span style={{color:'var(--text-muted)'}}>›</span>
          <span style={{fontWeight:600}}>{drillArea}</span></>}
        </div>
      )}
      <TablaAgregada rows={rows} colLabel={nivel==='suc'?'Sucursal':nivel==='area'?'Área':'Trabajador'}
        showBitacora={nivel==='trab'}
        onDrill={r=>{
          if(nivel==='suc'){setDrillSuc(r.label)}
          else if(nivel==='area'){setDrillArea(r.label)}
          else{setDrillCod(r.cod);setDrillNom(r.nombre);onBitacora()}
        }}
      />
    </div>
  )
}

function TablaAgregada({ rows, colLabel, showBitacora, onDrill }) {
  const [sort,setSort] = useState({col:'atrasos',dir:-1})
  const tog = col => setSort(s=>({col,dir:s.col===col?-s.dir:-1}))
  const sorted = [...rows].sort((a,b)=>(a[sort.col]-b[sort.col])*sort.dir)
  const Th = ({k,l}) => <th style={{...thS,cursor:'pointer'}} onClick={()=>tog(k)}>{l}{sort.col===k?(sort.dir===-1?' ↓':' ↑'):''}</th>
  return (
    <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
        <thead><tr style={{background:'var(--bg-app)'}}>
          <th style={thS}>{colLabel}</th>
          <Th k="dias" l="Días"/><Th k="pct" l="% Puntual"/>
          <Th k="atrasos" l="Atrasos"/><Th k="minAtraso" l="Min. atraso"/>
          <Th k="extras" l="Con extra"/><Th k="minExtra" l="Min. extra"/>
          <Th k="salAnt" l="Salida ant."/>
          <Th k="excesos" l="Exceso 2h"/><Th k="corridos" l="Corridos"/>
          <th style={thS}></th>
        </tr></thead>
        <tbody>
          {sorted.map(r=>(
            <tr key={r.label||r.cod} style={{cursor:'pointer'}}
              onClick={()=>onDrill(r)}
              onMouseOver={e=>e.currentTarget.style.background='var(--bg-app)'}
              onMouseOut={e=>e.currentTarget.style.background='transparent'}>
              <td style={{...tdS,fontWeight:600,maxWidth:200}}>
                {r.nombre||r.label}
                {r.workshift&&<div style={{fontSize:11,color:'var(--text-muted)',fontWeight:400}}>{r.workshift}</div>}
              </td>
              <td style={tdS}>{r.dias}</td>
              <td style={tdS}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <div style={{width:40,height:5,borderRadius:3,background:'var(--border)',overflow:'hidden'}}>
                    <div style={{width:r.pct+'%',height:'100%',background:r.pct>=80?'#34C759':r.pct>=60?'#FF9500':'#FF3B30',borderRadius:3}}/>
                  </div>
                  <span style={{fontSize:12,fontWeight:600,color:r.pct>=80?'#34C759':r.pct>=60?'#FF9500':'#FF3B30'}}>{r.pct}%</span>
                </div>
              </td>
              <td style={tdS}>{r.atrasos>0?<Bd c="#FF3B30" bg="#FF3B3012">{r.atrasos}</Bd>:'—'}</td>
              <td style={{...tdS,color:r.minAtraso>0?'#FF3B30':'var(--text-muted)'}}>{fMin(r.minAtraso)}</td>
              <td style={tdS}>{r.extras>0?<Bd c="#007AFF" bg="#007AFF12">{r.extras}</Bd>:'—'}</td>
              <td style={{...tdS,color:r.minExtra>0?'#007AFF':'var(--text-muted)'}}>{fMin(r.minExtra)}</td>
              <td style={tdS}>{r.salAnt>0?<Bd c="#FF6B35" bg="#FF6B3512">🏃 {r.salAnt}</Bd>:'—'}</td>
              <td style={tdS}>{r.excesos>0?<Bd c="#FF3B30" bg="#FF3B3012">🚨 {r.excesos}</Bd>:'—'}</td>
              <td style={tdS}>{r.corridos>0?<Bd c="#FF9500" bg="#FF950012">⚠️ {r.corridos}</Bd>:'—'}</td>
              <td style={{...tdS,color:'var(--accent)',fontWeight:600}}>{showBitacora?'Bitácora →':'Ver →'}</td>
            </tr>
          ))}
          {rows.length===0&&<tr><td colSpan={11} style={{padding:28,textAlign:'center',color:'var(--text-muted)'}}>Sin datos</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ─── Vista Escalamiento ──────────────────────────────────────────────────────
// Sistema de scoring para priorizar casos críticos de asistencia.
// Pensado para que un gerente identifique en segundos los 10 casos más urgentes.
function VistaEscalamiento({ datos, fil, onVerDetalle }) {
  const [topN, setTopN] = useState(10)

  // Calcular score por trabajador
  const ranking = useMemo(()=>{
    const map = {}
    for (const r of datos) {
      const k = r.cod_contaline
      if (!map[k]) map[k] = {
        cod: k, nombre: r.empleado, sucursal: r.sucursal_nombre, area: r.departamento,
        jornadas: [], atrasos: [], excesos: [], incompletas: [], hizoExtra: [],
        fechaUltimaFalta: null
      }
      map[k].jornadas.push(r)

      if (r.estado_dia === 'atraso' && (r.min_atraso_contable||0) > 0) {
        map[k].atrasos.push(r)
        if (!map[k].fechaUltimaFalta || r.fecha > map[k].fechaUltimaFalta) map[k].fechaUltimaFalta = r.fecha
      }
      if ((r.min_extra_dia||0) > LIMITE_EXTRA_MIN) {
        map[k].excesos.push(r)
        if (!map[k].fechaUltimaFalta || r.fecha > map[k].fechaUltimaFalta) map[k].fechaUltimaFalta = r.fecha
      }
      if (r.estado_dia === 'hizo_extra' && (r.min_extra_dia||0) > 0) {
        map[k].hizoExtra.push(r)
      }
      if (['incompleta','sin_marcas'].includes(r.estado_dia)) {
        map[k].incompletas.push(r)
      }
    }

    const hoy = new Date()
    const hace7 = new Date(hoy.getTime() - 7*86400000).toISOString().slice(0,10)

    const lista = Object.values(map).map(t => {
      const totalDias = t.jornadas.length
      if (totalDias === 0) return null

      const nAtrasos = t.atrasos.length
      const nExcesos = t.excesos.length
      const nHE = t.hizoExtra.length
      const nIncompletas = t.incompletas.length
      const minAtrasoProm = nAtrasos > 0 ? t.atrasos.reduce((s,r)=>s+(r.min_atraso_contable||0),0) / nAtrasos : 0
      const minHEProm    = nHE > 0      ? t.hizoExtra.reduce((s,r)=>s+(r.min_extra_dia||0),0) / nHE   : 0
      const tasaAtraso   = totalDias > 0 ? nAtrasos / totalDias : 0
      const minAtrasoTotal = t.atrasos.reduce((s,r)=>s+(r.min_atraso_contable||0),0)
      const minHETotal     = t.hizoExtra.reduce((s,r)=>s+(r.min_extra_dia||0),0)

      // SCORE
      let score = 0
      const factores = []

      // 1. Tasa de atraso (hasta 25 pts)
      const ptsAtraso = Math.min(Math.round(tasaAtraso * 50), 25)
      if (ptsAtraso > 0) {
        score += ptsAtraso
        factores.push({l:`${Math.round(tasaAtraso*100)}% días con atraso`, pts:ptsAtraso, sev:tasaAtraso>=0.3?'alto':'medio'})
      }

      // 2. Severidad atraso promedio (hasta 15 pts)
      let ptsSev = 0
      if (minAtrasoProm > 40) ptsSev = 15
      else if (minAtrasoProm > 20) ptsSev = 10
      else if (minAtrasoProm > 10) ptsSev = 5
      if (ptsSev > 0) {
        score += ptsSev
        factores.push({l:`Atraso promedio ${Math.round(minAtrasoProm)} min`, pts:ptsSev, sev:ptsSev>=10?'alto':'medio'})
      }

      // 3. Exceso legal HE (hasta 25 pts) — el más crítico
      const ptsExceso = Math.min(nExcesos * 5, 25)
      if (ptsExceso > 0) {
        score += ptsExceso
        factores.push({l:`${nExcesos} jornadas con exceso de tope (>2h extra)`, pts:ptsExceso, sev:'critico'})
      }

      // 4. HE acumulado (hasta 10 pts)
      let ptsHE = 0
      if (minHEProm > 60) ptsHE = 10
      else if (minHEProm > 20) ptsHE = 5
      if (ptsHE > 0) {
        score += ptsHE
        factores.push({l:`${nHE} días con HE (prom. ${Math.round(minHEProm)} min)`, pts:ptsHE, sev:'medio'})
      }

      // 5. Incompletas (hasta 10 pts)
      const ptsInc = Math.min(nIncompletas * 2, 10)
      if (ptsInc > 0) {
        score += ptsInc
        factores.push({l:`${nIncompletas} jornadas incompletas`, pts:ptsInc, sev:nIncompletas>=5?'alto':'medio'})
      }

      // 6. Recurrencia multi-categoría (+10 pts)
      const categorias = (nAtrasos>0?1:0) + (nExcesos>0?1:0) + (nHE>=5?1:0) + (nIncompletas>0?1:0)
      if (categorias >= 3) {
        score += 10
        factores.push({l:`Problemas en ${categorias} categorías diferentes`, pts:10, sev:'alto'})
      }

      // 7. Recencia (+20% si la última falta fue en los últimos 7 días)
      let bonusRecencia = 0
      if (t.fechaUltimaFalta && t.fechaUltimaFalta >= hace7) {
        bonusRecencia = Math.round(score * 0.2)
        score += bonusRecencia
        if (bonusRecencia > 0) factores.push({l:`Falta reciente (${t.fechaUltimaFalta})`, pts:bonusRecencia, sev:'alto'})
      }

      score = Math.min(score, 100)

      let nivel, color, accion
      if (score >= 80)      { nivel='Crítico'; color='#FF3B30'; accion='Acción inmediata. Citar hoy.' }
      else if (score >= 60) { nivel='Alto';    color='#FF6B35'; accion='Citar a conversación esta semana.' }
      else if (score >= 40) { nivel='Medio';   color='#FF9500'; accion='Advertencia verbal. Monitorear.' }
      else                  { nivel='Bajo';    color='#34C759'; accion='Sin acción inmediata.' }

      return {
        ...t,
        totalDias, nAtrasos, nExcesos, nHE, nIncompletas,
        minAtrasoProm: Math.round(minAtrasoProm),
        minAtrasoTotal, minHETotal,
        score, nivel, color, accion, factores
      }
    }).filter(t => t && t.score >= 10)
      .sort((a,b) => b.score - a.score)

    return lista
  },[datos])

  const visible = ranking.slice(0, topN)
  const stats = {
    criticos: ranking.filter(r=>r.score>=80).length,
    altos:    ranking.filter(r=>r.score>=60 && r.score<80).length,
    medios:   ranking.filter(r=>r.score>=40 && r.score<60).length,
    bajos:    ranking.filter(r=>r.score<40).length,
  }

  function exportarEscalamientoExcel() {
    const wb = XLSX.utils.book_new()

    const header = [
      ['REPORTE DE ESCALAMIENTO DE ASISTENCIA'],
      [],
      ['Outlet de Puertas SpA'],
      ['Período', `${fil.desde} al ${fil.hasta}`],
      ['Casos en el reporte', visible.length],
      ['Emitido', new Date().toLocaleString('es-CL')],
      [],
      ['Niveles:', 'Crítico (≥80): Acción inmediata', 'Alto (60-79): Citar esta semana', 'Medio (40-59): Advertencia', 'Bajo (<40): Monitoreo'],
      [],
    ]
    const wsR = XLSX.utils.aoa_to_sheet([
      ...header,
      ['#','Trabajador','Sucursal','Área','Score','Nivel','Acción','Atrasos','Min. atraso prom.','Exceso 2h','Incompletas','HE total (min)','Última falta'],
      ...visible.map((r,i)=>[
        i+1, r.nombre, r.sucursal, r.area, r.score, r.nivel, r.accion,
        r.nAtrasos, r.minAtrasoProm, r.nExcesos, r.nIncompletas, r.minHETotal,
        r.fechaUltimaFalta || ''
      ])
    ])
    wsR['!cols'] = [{wch:4},{wch:30},{wch:14},{wch:24},{wch:7},{wch:10},{wch:36},{wch:9},{wch:14},{wch:10},{wch:12},{wch:14},{wch:14}]
    XLSX.utils.book_append_sheet(wb, wsR, 'Ranking')

    // Hoja por persona con factores
    const factoresData = []
    visible.forEach((r,i) => {
      factoresData.push({
        '#': i+1,
        'Trabajador': r.nombre,
        'Score total': r.score,
        'Factor': '',
        'Puntos': '',
        'Severidad': ''
      })
      for (const f of r.factores) {
        factoresData.push({
          '#': '',
          'Trabajador': '',
          'Score total': '',
          'Factor': f.l,
          'Puntos': f.pts,
          'Severidad': f.sev
        })
      }
    })
    const ws2 = XLSX.utils.json_to_sheet(factoresData)
    ws2['!cols'] = [{wch:4},{wch:30},{wch:11},{wch:48},{wch:8},{wch:10}]
    XLSX.utils.book_append_sheet(wb, ws2, 'Detalle por caso')

    XLSX.writeFile(wb, `escalamiento_asistencia_${fil.desde}_${fil.hasta}.xlsx`)
  }

  function exportarEscalamientoPdf() {
    const doc = new jsPDF({orientation:'portrait',unit:'mm',format:'a4'})
    const pageW = doc.internal.pageSize.getWidth()
    const margin = 14

    doc.setFillColor(26,26,46)
    doc.rect(0,0,pageW,30,'F')
    doc.setTextColor(255,255,255)
    doc.setFontSize(16); doc.setFont('helvetica','bold')
    doc.text('REPORTE DE ESCALAMIENTO', margin, 14)
    doc.setFontSize(9); doc.setFont('helvetica','normal')
    doc.text('Casos críticos de asistencia · Outlet de Puertas SpA', margin, 21)
    doc.text(`Emitido: ${new Date().toLocaleString('es-CL')}`, pageW-margin, 21, {align:'right'})

    let y = 38
    doc.setTextColor(0,0,0)
    doc.setFontSize(10); doc.setFont('helvetica','bold')
    doc.text(`Período: ${fil.desde}  →  ${fil.hasta}`, margin, y); y += 5
    doc.setFont('helvetica','normal')
    doc.text(`${visible.length} casos en el reporte de ${ranking.length} totales con score ≥ 10`, margin, y); y += 8

    // Distribución
    const distr = [
      ['Crítico (≥80)', stats.criticos, [255,59,48]],
      ['Alto (60-79)',  stats.altos,    [255,107,53]],
      ['Medio (40-59)', stats.medios,   [255,149,0]],
      ['Bajo (10-39)',  stats.bajos,    [52,199,89]],
    ]
    const cardW = (pageW - margin*2 - 9) / 4
    distr.forEach((d,i) => {
      const x = margin + i*(cardW+3)
      doc.setFillColor(...d[2])
      doc.roundedRect(x, y, cardW, 16, 2, 2, 'F')
      doc.setTextColor(255,255,255)
      doc.setFontSize(14); doc.setFont('helvetica','bold')
      doc.text(String(d[1]), x+4, y+8)
      doc.setFontSize(7); doc.setFont('helvetica','normal')
      doc.text(d[0], x+4, y+13)
    })
    y += 22
    doc.setTextColor(0,0,0)

    // Tabla ranking
    doc.setFontSize(11); doc.setFont('helvetica','bold')
    doc.text(`Top ${visible.length} casos por prioridad`, margin, y); y += 2

    doc.autoTable({
      startY: y,
      head: [['#','Trabajador','Sucursal','Score','Nivel','Atrasos','Exceso 2h','Acción recomendada']],
      body: visible.map((r,i)=>[
        i+1, r.nombre, r.sucursal,
        r.score, r.nivel,
        r.nAtrasos > 0 ? `${r.nAtrasos} (${r.minAtrasoProm}m)` : '—',
        r.nExcesos > 0 ? String(r.nExcesos) : '—',
        r.accion
      ]),
      theme: 'striped',
      headStyles: {fillColor:[22,33,62],textColor:255,fontSize:8},
      bodyStyles: {fontSize:7.5},
      columnStyles: {0:{halign:'center',cellWidth:8},3:{halign:'center',fontStyle:'bold'},5:{halign:'right'},6:{halign:'right'}},
      margin: {left:margin,right:margin},
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const nivel = data.cell.raw
          if (nivel === 'Crítico') data.cell.styles.textColor = [255,59,48]
          else if (nivel === 'Alto') data.cell.styles.textColor = [255,107,53]
          else if (nivel === 'Medio') data.cell.styles.textColor = [255,149,0]
          else data.cell.styles.textColor = [52,199,89]
          data.cell.styles.fontStyle = 'bold'
        }
      }
    })

    // Detalle por cada caso crítico/alto
    const criticosAltos = visible.filter(r=>r.score>=60).slice(0, 8)
    if (criticosAltos.length > 0) {
      doc.addPage()
      y = 20
      doc.setFontSize(13); doc.setFont('helvetica','bold')
      doc.text('Detalle de casos prioritarios', margin, y); y += 8

      criticosAltos.forEach((r,idx) => {
        if (y > 250) { doc.addPage(); y = 20 }
        // Header del caso
        doc.setFillColor(245,245,247)
        doc.roundedRect(margin, y, pageW-margin*2, 16, 2, 2, 'F')
        doc.setTextColor(0,0,0); doc.setFontSize(11); doc.setFont('helvetica','bold')
        doc.text(`#${idx+1}  ${r.nombre}`, margin+4, y+6)
        doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(100,100,100)
        doc.text(`${r.sucursal} · ${r.area}`, margin+4, y+11)
        // Score badge
        doc.setFillColor(...(r.nivel==='Crítico'?[255,59,48]:[255,107,53]))
        doc.roundedRect(pageW-margin-32, y+3, 28, 10, 2, 2, 'F')
        doc.setTextColor(255,255,255); doc.setFontSize(10); doc.setFont('helvetica','bold')
        doc.text(`${r.score} · ${r.nivel}`, pageW-margin-30, y+9.5)
        y += 18

        // Factores
        doc.setTextColor(0,0,0); doc.setFontSize(8); doc.setFont('helvetica','bold')
        doc.text('Factores que elevan el score:', margin+4, y); y += 4
        doc.setFont('helvetica','normal')
        r.factores.forEach(f => {
          doc.text(`  • ${f.l}   (+${f.pts} pts)`, margin+4, y); y += 4
        })
        // Acción
        doc.setFont('helvetica','bold'); doc.setTextColor(...(r.nivel==='Crítico'?[255,59,48]:[255,107,53]))
        doc.text(`→ ${r.accion}`, margin+4, y+1); y += 8
        doc.setTextColor(0,0,0)
      })
    }

    // Footer paginado
    const total = doc.internal.getNumberOfPages()
    for (let i=1; i<=total; i++) {
      doc.setPage(i)
      doc.setFontSize(7); doc.setTextColor(150,150,150)
      doc.text('Outlet de Puertas SpA · Reporte de Escalamiento de Asistencia · Confidencial', margin, 290)
      doc.text(`Página ${i} de ${total}`, pageW-margin, 290, {align:'right'})
    }

    doc.save(`escalamiento_asistencia_${fil.desde}_${fil.hasta}.pdf`)
  }

  if (ranking.length === 0) return (
    <div style={{padding:32,textAlign:'center',color:'var(--text-muted)'}}>
      <div style={{fontSize:40,marginBottom:8}}>✅</div>
      Sin casos relevantes de escalamiento en el período.
    </div>
  )

  return (
    <div>
      {/* Header con cards de niveles */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:14}}>
        <CardNivel l="🔴 Crítico" sub="≥80 · Acción inmediata" v={stats.criticos} c="#FF3B30"/>
        <CardNivel l="🟠 Alto"    sub="60-79 · Esta semana"   v={stats.altos}    c="#FF6B35"/>
        <CardNivel l="🟡 Medio"   sub="40-59 · Advertencia"   v={stats.medios}   c="#FF9500"/>
        <CardNivel l="🟢 Bajo"    sub="<40 · Monitoreo"       v={stats.bajos}    c="#34C759"/>
      </div>

      {/* Controles */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',gap:10}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:13,color:'var(--text-muted)'}}>Mostrar top:</span>
          {[5,10,20,50].map(n=>(
            <button key={n} onClick={()=>setTopN(n)} style={{
              padding:'5px 11px',border:'1px solid var(--border)',borderRadius:100,cursor:'pointer',
              fontSize:12,fontWeight:500,
              background:topN===n?'var(--accent)15':'transparent',
              color:topN===n?'var(--accent)':'var(--text)',
              borderColor:topN===n?'var(--accent)':'var(--border)'
            }}>{n}</button>
          ))}
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={exportarEscalamientoExcel} style={btnExportExcel}>📊 Excel</button>
          <button onClick={exportarEscalamientoPdf}  style={btnExportPdf}>📄 PDF</button>
        </div>
      </div>

      {/* Explicación de scoring */}
      <details style={{marginBottom:14,padding:'10px 14px',borderRadius:8,background:'var(--bg-app)',border:'1px solid var(--border)',fontSize:12,color:'var(--text-muted)'}}>
        <summary style={{cursor:'pointer',fontWeight:600,color:'var(--text)'}}>¿Cómo se calcula el score?</summary>
        <div style={{marginTop:8,lineHeight:1.6}}>
          El score combina: tasa de atrasos (25pts), severidad del atraso promedio (15pts), exceso de tope de HE {'>'}2h diarias (25pts, el más grave),
          HE acumulado (10pts), jornadas incompletas (10pts), recurrencia en múltiples categorías (10pts) y bonus de recencia si la última falta fue en los últimos 7 días (+20%).
          Total ponderado a 100.
        </div>
      </details>

      {/* Lista de casos */}
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {visible.map((r,i)=>(
          <div key={r.cod} style={{
            border:`1px solid ${r.color}40`,
            borderLeft:`4px solid ${r.color}`,
            borderRadius:10, padding:'14px 16px',
            background: r.score>=80 ? `${r.color}06` : 'var(--bg-surface)',
            display:'grid', gridTemplateColumns:'auto 1fr auto auto', gap:14, alignItems:'center'
          }}>
            {/* Posición + score */}
            <div style={{textAlign:'center',minWidth:64}}>
              <div style={{fontSize:11,color:'var(--text-muted)',fontWeight:600}}>#{i+1}</div>
              <div style={{fontSize:28,fontWeight:800,color:r.color,lineHeight:1}}>{r.score}</div>
              <div style={{fontSize:10,fontWeight:700,color:r.color,letterSpacing:'0.04em'}}>{r.nivel.toUpperCase()}</div>
            </div>

            {/* Info */}
            <div>
              <div style={{fontWeight:700,fontSize:14,marginBottom:2}}>{r.nombre}</div>
              <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:6}}>{r.sucursal} · {r.area} · {r.totalDias} jornadas en el período</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
                {r.factores.slice(0,4).map((f,j)=>(
                  <span key={j} style={{
                    fontSize:10, padding:'3px 8px', borderRadius:100,
                    background: f.sev==='critico'?'#FF3B3015':f.sev==='alto'?'#FF6B3515':'#FF950015',
                    color: f.sev==='critico'?'#FF3B30':f.sev==='alto'?'#FF6B35':'#FF9500',
                    fontWeight:600
                  }}>
                    {f.l} <span style={{opacity:0.6,fontWeight:400}}>+{f.pts}</span>
                  </span>
                ))}
                {r.factores.length > 4 && (
                  <span style={{fontSize:10,color:'var(--text-muted)',padding:'3px 4px'}}>+{r.factores.length-4} más</span>
                )}
              </div>
              <div style={{fontSize:12,fontWeight:600,color:r.color}}>→ {r.accion}</div>
            </div>

            {/* Métricas rápidas */}
            <div style={{display:'flex',gap:14,fontSize:11,color:'var(--text-muted)',textAlign:'right'}}>
              {r.nAtrasos>0 && <div><div style={{fontWeight:700,color:'#FF3B30',fontSize:14}}>{r.nAtrasos}</div>atrasos</div>}
              {r.nExcesos>0 && <div><div style={{fontWeight:700,color:'#FF3B30',fontSize:14}}>{r.nExcesos}</div>exc. 2h</div>}
              {r.nHE>=5 && <div><div style={{fontWeight:700,color:'#007AFF',fontSize:14}}>{r.nHE}</div>HE</div>}
              {r.nIncompletas>0 && <div><div style={{fontWeight:700,color:'#AF52DE',fontSize:14}}>{r.nIncompletas}</div>incomp.</div>}
            </div>

            {/* Acción */}
            <button onClick={()=>onVerDetalle(r.cod, r.nombre)} style={{
              padding:'8px 14px',background:'var(--accent)',color:'white',
              border:'none',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600,whiteSpace:'nowrap'
            }}>
              Ver bitácora →
            </button>
          </div>
        ))}
      </div>

      {ranking.length > topN && (
        <div style={{textAlign:'center',marginTop:14,fontSize:12,color:'var(--text-muted)'}}>
          Mostrando {topN} de {ranking.length} casos. Aumenta el top para ver más.
        </div>
      )}
    </div>
  )
}

function CardNivel({l, sub, v, c}) {
  return (
    <div style={{
      padding:'12px 14px', background:'var(--bg-surface)',
      border:`1px solid ${c}40`, borderTop:`3px solid ${c}`,
      borderRadius:10
    }}>
      <div style={{fontSize:12,fontWeight:700}}>{l}</div>
      <div style={{fontSize:24,fontWeight:800,color:c,lineHeight:1.1,marginTop:2}}>{v}</div>
      <div style={{fontSize:10,color:'var(--text-muted)'}}>{sub}</div>
    </div>
  )
}

// ─── Vista Legal ──────────────────────────────────────────────────────────────
function VistaLegal({ datos }) {
  const excesos = useMemo(()=>
    datos.filter(r=>(r.min_extra_dia||0)>LIMITE_EXTRA_MIN)
    .sort((a,b)=>(b.min_extra_dia||0)-(a.min_extra_dia||0)),[datos])
  const corridos = useMemo(()=>{
    const map={}
    for(const r of datos.filter(r=>r.estado_dia==='turno_corrido')){
      const k=r.cod_contaline; if(!map[k]) map[k]={nombre:r.empleado,suc:r.sucursal_nombre,area:r.departamento,dias:[]}
      map[k].dias.push(r)
    }
    return Object.values(map).filter(t=>t.dias.length>=3).sort((a,b)=>b.dias.length-a.dias.length)
  },[datos])

  // Análisis de colaciones — agrupar por trabajador
  const colaciones = useMemo(()=>{
    const map={}
    const aplica = datos.filter(r => r.estado_colacion && r.estado_colacion !== 'no_aplica')
    for (const r of aplica) {
      const k = r.cod_contaline
      if (!map[k]) map[k] = { nombre:r.empleado, suc:r.sucursal_nombre, area:r.departamento,
        total:0, no_marcada:0, parcial:0, breve:0, ok:0, extendida:0 }
      const o = map[k]
      o.total++
      if (o[r.estado_colacion] !== undefined) o[r.estado_colacion]++
    }
    return Object.values(map)
      .filter(t => (t.no_marcada + t.parcial + t.breve) > 0)
      .map(t => ({ ...t, faltas: t.no_marcada + t.parcial + t.breve, pctFalta: Math.round((t.no_marcada+t.parcial+t.breve)/t.total*100) }))
      .sort((a,b) => b.faltas - a.faltas)
  },[datos])

  // Diagnóstico sistémico: días donde la mayoría del turno completo NO marcó colación
  // (indica que es problema del reloj o cultura, no de un empleado puntual)
  const diasSistematicos = useMemo(()=>{
    const map = {}
    const aplica = datos.filter(r => r.estado_colacion && r.estado_colacion !== 'no_aplica')
    for (const r of aplica) {
      const k = `${r.fecha}|${r.sucursal_nombre}`
      if (!map[k]) map[k] = { fecha:r.fecha, sucursal:r.sucursal_nombre, total:0, sin_col:0 }
      map[k].total++
      if (r.estado_colacion === 'no_marcada') map[k].sin_col++
    }
    return Object.values(map)
      .filter(d => d.total >= 3 && d.sin_col / d.total >= 0.8)
      .sort((a,b) => a.fecha < b.fecha ? 1 : -1)
      .slice(0, 20)
  },[datos])

  const sinNada = excesos.length===0 && corridos.length===0 && colaciones.length===0
  const totalAplica = datos.filter(r=>r.estado_colacion && r.estado_colacion!=='no_aplica').length
  const totalSinCol = datos.filter(r=>r.estado_colacion==='no_marcada').length

  return (
    <div>
      {sinNada && (
        <div style={{padding:32,textAlign:'center',color:'var(--text-muted)'}}>
          <div style={{fontSize:40,marginBottom:8}}>✅</div>
          Sin excesos de tope en el período seleccionado.
        </div>
      )}
      {excesos.length>0&&(
        <div style={{marginBottom:24}}>
          <div style={{fontSize:14,fontWeight:700,color:'#FF3B30',marginBottom:10}}>
            🚨 Exceso de tope de 2 horas ({excesos.length} jornadas)
          </div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:10}}>
            Tope: 2 horas extra por jornada diaria (120 min).
          </div>
          <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:'var(--bg-app)'}}>
                <th style={thS}>Trabajador</th><th style={thS}>Fecha</th>
                <th style={thS}>Sucursal</th><th style={{...thS,textAlign:'right'}}>Extra total</th>
                <th style={{...thS,textAlign:'right'}}>Exceso</th>
              </tr></thead>
              <tbody>
                {excesos.map((r,i)=>(
                  <tr key={i} style={{background:'#FF3B3006'}}>
                    <td style={{...tdS,fontWeight:600}}>{r.empleado}</td>
                    <td style={tdS}>{fFecha(r.fecha)}</td>
                    <td style={{...tdS,fontSize:12,color:'var(--text-muted)'}}>{r.sucursal_nombre}</td>
                    <td style={{...tdS,textAlign:'right',color:'#FF3B30',fontWeight:700}}>{fMin(r.min_extra_dia)}</td>
                    <td style={{...tdS,textAlign:'right',color:'#FF3B30'}}>+{fMin((r.min_extra_dia||0)-LIMITE_EXTRA_MIN)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* COLACIONES — Art. 34 Código del Trabajo */}
      {colaciones.length > 0 && (
        <div style={{marginBottom:24}}>
          <div style={{fontSize:14,fontWeight:700,color:'#FF3B30',marginBottom:10}}>
            🍴 Incumplimiento de registro de colación ({totalSinCol} de {totalAplica} jornadas)
          </div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:10,lineHeight:1.5}}>
            <strong>Art. 34 Código del Trabajo Chile:</strong> jornadas mayores a 6 horas requieren mínimo 30 minutos de colación, debidamente registrada (inicio y fin).
            Sin este registro la empresa no puede comprobar el cumplimiento ante una fiscalización.
          </div>

          {/* Diagnóstico sistémico */}
          {diasSistematicos.length > 0 && (
            <div style={{marginBottom:14,padding:'12px 14px',borderRadius:10,background:'#FF950012',border:'1px solid #FF950040',fontSize:12}}>
              <div style={{fontWeight:700,color:'#FF9500',marginBottom:6}}>
                ⚠️ Días con falta masiva (posible falla del reloj o problema operacional)
              </div>
              <div style={{color:'var(--text-muted)',marginBottom:8}}>
                En los siguientes días, 80% o más del personal no marcó colación. Revisar reloj biométrico o capacitar al turno completo.
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {diasSistematicos.map((d,i)=>(
                  <span key={i} style={{padding:'4px 10px',background:'var(--bg-surface)',border:'1px solid #FF950030',borderRadius:6,fontSize:11}}>
                    {fFecha(d.fecha)} · <strong>{d.sucursal}</strong> · {d.sin_col}/{d.total}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Ranking por trabajador */}
          <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:'var(--bg-app)'}}>
                <th style={thS}>Trabajador</th>
                <th style={thS}>Sucursal · Área</th>
                <th style={{...thS,textAlign:'right'}}>Jornadas</th>
                <th style={{...thS,textAlign:'right'}}>Sin marcar</th>
                <th style={{...thS,textAlign:'right'}}>Parcial</th>
                <th style={{...thS,textAlign:'right'}}>Breve</th>
                <th style={{...thS,textAlign:'right'}}>% Falta</th>
              </tr></thead>
              <tbody>
                {colaciones.map((t,i)=>(
                  <tr key={i} style={{background: t.pctFalta>=80?'#FF3B3008':undefined}}>
                    <td style={{...tdS,fontWeight:600}}>{t.nombre}</td>
                    <td style={{...tdS,fontSize:12,color:'var(--text-muted)'}}>{t.suc} · {t.area}</td>
                    <td style={{...tdS,textAlign:'right'}}>{t.total}</td>
                    <td style={{...tdS,textAlign:'right',color:t.no_marcada>0?'#FF3B30':'var(--text-muted)',fontWeight:600}}>
                      {t.no_marcada>0?t.no_marcada:'—'}
                    </td>
                    <td style={{...tdS,textAlign:'right',color:t.parcial>0?'#FF3B30':'var(--text-muted)'}}>
                      {t.parcial>0?t.parcial:'—'}
                    </td>
                    <td style={{...tdS,textAlign:'right',color:t.breve>0?'#FF9500':'var(--text-muted)'}}>
                      {t.breve>0?t.breve:'—'}
                    </td>
                    <td style={{...tdS,textAlign:'right'}}>
                      <Bd c={t.pctFalta>=80?'#FF3B30':t.pctFalta>=50?'#FF9500':'#8E8E93'}
                          bg={t.pctFalta>=80?'#FF3B3015':t.pctFalta>=50?'#FF950015':'#8E8E9315'}>
                        {t.pctFalta}%
                      </Bd>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {corridos.length>0&&(
        <div>
          <div style={{fontSize:14,fontWeight:700,color:'#FF9500',marginBottom:10}}>
            🔄 Posibles turnos mal asignados en Workera ({corridos.length} trabajadores)
          </div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:10}}>
            Trabajadores con 3+ jornadas "turno corrido" — el horario asignado probablemente no coincide con la jornada real.
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {corridos.map((t,i)=>(
              <div key={i} style={{padding:'12px 16px',borderRadius:10,background:'#FF950008',border:'1px solid #FF950040',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:13}}>
                <div>
                  <div style={{fontWeight:600}}>{t.nombre}</div>
                  <div style={{fontSize:12,color:'var(--text-muted)'}}>{t.suc} · {t.area}</div>
                </div>
                <Bd c="#FF9500" bg="#FF950015">{t.dias.length} días corridos</Bd>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Vista Bitácora ───────────────────────────────────────────────────────────
function VistaBitacora({ agruTrab, datosFil, drillCod, drillNom, setDrillCod, setDrillNom, datos, drillSuc, drillArea, fil, cu, puedeCorregir, puedeAprobar, onRecargar, onNavegar }) {
  const base = useMemo(()=>datos.filter(r=>(!drillSuc||r.sucursal_nombre===drillSuc)&&(!drillArea||r.departamento===drillArea)),[datos,drillSuc,drillArea])
  const trab = useMemo(()=>agruparTrab(base),[base])
  const [modalCorr, setModalCorr] = useState(null) // jornada a corregir
  const [gesAus, setGesAus] = useState({})         // fecha → gestión de ausencia (asis_ausencias)

  useEffect(() => {
    if (!drillCod) { setGesAus({}); return }
    supabase.from('asis_ausencias').select('*')
      .eq('activo', true).eq('cod_contaline', drillCod)
      .gte('fecha', fil.desde).lte('fecha', fil.hasta)
      .then(({ data }) => setGesAus(Object.fromEntries((data||[]).map(g=>[g.fecha, g]))))
  }, [drillCod, fil.desde, fil.hasta])

  const dias = [...datosFil].sort((a,b)=>a.fecha<b.fecha?1:-1)
  const corridos = dias.filter(r=>r.estado_dia==='turno_corrido').length
  const pctCorr  = dias.length>0?Math.round(corridos/dias.length*100):0

  // Métricas resumidas para informe
  const resumen = useMemo(()=>{
    const tot = dias.length
    const puntual = dias.filter(r=>r.estado_dia==='puntual').length
    const extras = dias.filter(r=>r.estado_dia==='hizo_extra').length
    return {
      total: tot,
      puntual,
      atrasos:   dias.filter(r=>r.estado_dia==='atraso').length,
      extras,
      salAnt:    dias.filter(r=>r.estado_dia==='salida_anticipada').length,
      corridos,
      incompletas: dias.filter(r=>r.estado_dia==='incompleta').length,
      ausencias:   dias.filter(r=>r.estado_dia==='sin_marcas').length,
      minAtraso: dias.reduce((s,r)=>s+(r.min_atraso_contable||0),0),
      minExtra:  dias.reduce((s,r)=>s+(r.min_extra_dia||0),0),
      minSalAnt: dias.reduce((s,r)=>s+(r.min_salida_anticipada_contable||0),0),
      excesos:   dias.filter(r=>(r.min_extra_dia||0)>LIMITE_EXTRA_MIN).length,
      colOk:     dias.filter(r=>r.estado_colacion==='ok').length,
      colNoMarcada: dias.filter(r=>r.estado_colacion==='no_marcada').length,
      colBreve:  dias.filter(r=>r.estado_colacion==='breve').length,
      pct: tot>0 ? Math.round((puntual+extras)/tot*100) : 0,
    }
  },[dias,corridos])

  const ausDias = useMemo(()=>dias.filter(r=>r.estado_dia==='sin_marcas'),[dias])
  const ausPend = useMemo(()=>ausDias.filter(r=>!gesAus[r.fecha]).length,[ausDias,gesAus])

  if (!drillCod) return (
    <div>
      <p style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>Selecciona un trabajador para ver su bitácora:</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:8}}>
        {trab.map(t=>(
          <button key={t.cod} onClick={()=>{setDrillCod(t.cod);setDrillNom(t.nombre)}}
            style={{padding:'12px 14px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,textAlign:'left',cursor:'pointer'}}>
            <div style={{fontWeight:600,fontSize:13,marginBottom:4}}>{t.nombre}</div>
            <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:6}}>{t.area}</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {t.atrasos>0&&<Bd c="#FF3B30" bg="#FF3B3012">⚠️ {t.atrasos}</Bd>}
              {t.extras>0&&<Bd c="#007AFF" bg="#007AFF12">⏱ {t.extras}</Bd>}
              {t.salAnt>0&&<Bd c="#FF6B35" bg="#FF6B3512">🏃 {t.salAnt}</Bd>}
              {t.excesos>0&&<Bd c="#FF3B30" bg="#FF3B3012">🚨 {t.excesos}</Bd>}
              {t.corridos>0&&<Bd c="#FF9500" bg="#FF950012">🔄 {t.corridos}</Bd>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )

  // Datos generales del trabajador
  const meta = dias.length > 0 ? {
    nombre: dias[0].empleado,
    area: dias[0].departamento,
    sucursal: dias[0].sucursal_nombre,
  } : { nombre: drillNom, area:'—', sucursal:'—' }

  function exportarExcelIndividual() {
    const wb = XLSX.utils.book_new()

    // Hoja 1: Resumen
    const resHoja = [
      ['INFORME DE ASISTENCIA INDIVIDUAL'],
      [],
      ['Trabajador', meta.nombre],
      ['Sucursal', meta.sucursal],
      ['Área', meta.area],
      ['Período', `${fil.desde} al ${fil.hasta}`],
      ['Fecha emisión', new Date().toLocaleString('es-CL')],
      [],
      ['RESUMEN DEL PERÍODO', ''],
      ['Total jornadas', resumen.total],
      ['% Puntualidad', resumen.pct + '%'],
      ['Días puntuales', resumen.puntual],
      ['Días con atraso', resumen.atrasos],
      ['Días con horas extra', resumen.extras],
      ['Días con salida anticipada', resumen.salAnt],
      ['Días con turno corrido', resumen.corridos],
      ['Días incompletos', resumen.incompletas],
      [],
      ['ACUMULADOS (minutos)', ''],
      ['Min. atraso acumulado', resumen.minAtraso],
      ['Min. extra acumulado', resumen.minExtra],
      ['Min. salida anticipada acumulado', resumen.minSalAnt],
      ['Jornadas con exceso de tope (>2h)', resumen.excesos],
      [],
      ['COLACIONES', ''],
      ['Colación OK', resumen.colOk],
      ['Sin colación marcada', resumen.colNoMarcada],
      ['Colación breve (<30min)', resumen.colBreve],
      [],
      ['AUSENCIAS', ''],
      ['Días de ausencia (turno sin marcas)', resumen.ausencias],
      ['Ausencias gestionadas', resumen.ausencias - ausPend],
      ['Pendientes (cuentan como falta injustificada)', ausPend],
    ]
    const ws1 = XLSX.utils.aoa_to_sheet(resHoja)
    ws1['!cols'] = [{wch:32},{wch:30}]
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumen')

    // Hoja 2: Detalle día por día
    const detHoja = dias.map(r=>({
      'Fecha': r.fecha,
      'Día': ['LUN','MAR','MIE','JUE','VIE','SAB','DOM'][r.dia_semana-1] || '',
      'Turno': r.workshift_name || '',
      'Entrada esperada': fHora(r.entrada_esperada),
      'Entrada real': fHora(r.entrada_real),
      'Salida esperada': fHora(r.salida_esperada),
      'Salida real': fHora(r.salida_real),
      'Colación inicio': fHora(r.inicio_colacion_real),
      'Colación fin': fHora(r.fin_colacion_real),
      'Duración colación (min)': r.min_colacion_real || '',
      'Atraso (min)': r.min_atraso_contable || 0,
      'Extra (min)': r.min_extra_dia || 0,
      'Salida ant. (min)': r.min_salida_anticipada_contable || 0,
      'Exceso tope 2h': (r.min_extra_dia||0) > LIMITE_EXTRA_MIN ? 'SÍ' : '',
      'Estado': (EST[r.estado_dia]||{}).l || r.estado_dia,
      'Estado colación': (COL[r.estado_colacion]||{}).l || r.estado_colacion,
      'Gestión ausencia': r.estado_dia==='sin_marcas'
        ? ((AUS_CATS[gesAus[r.fecha]?.clasificacion]||{}).l || 'Pendiente — falta injustificada') : '',
      'Justificación ausencia': r.estado_dia==='sin_marcas' ? (gesAus[r.fecha]?.justificacion||'') : '',
    }))
    const ws2 = XLSX.utils.json_to_sheet(detHoja)
    ws2['!cols'] = Array(16).fill({wch:16})
    XLSX.utils.book_append_sheet(wb, ws2, 'Detalle diario')

    // Hoja 3: Todos los marcajes
    const marcRows = []
    for (const r of dias) {
      const marcajes = Array.isArray(r.marcajes_detalle) ? r.marcajes_detalle : []
      for (const m of marcajes) {
        const t = TIPO_MARCA[m.tipo] || {l:`Tipo ${m.tipo}`}
        marcRows.push({
          'Fecha': r.fecha,
          'Hora': new Date(m.hora).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
          'Tipo': t.l,
          'Origen': m.origen || '',
          'Dispositivo': m.dispositivo || '',
        })
      }
    }
    if (marcRows.length > 0) {
      const ws3 = XLSX.utils.json_to_sheet(marcRows)
      ws3['!cols'] = [{wch:12},{wch:12},{wch:20},{wch:24},{wch:24}]
      XLSX.utils.book_append_sheet(wb, ws3, 'Marcajes')
    }

    const nombreLimpio = (meta.nombre||'trabajador').replace(/[^\w]/g,'_').slice(0,40)
    XLSX.writeFile(wb, `asistencia_${nombreLimpio}_${fil.desde}_${fil.hasta}.xlsx`)
  }

  function exportarPdfIndividual() {
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    const margin = 14

    // Header corporativo
    doc.setFillColor(26,26,46) // #1a1a2e
    doc.rect(0, 0, pageW, 30, 'F')
    doc.setTextColor(255,255,255)
    doc.setFontSize(16); doc.setFont('helvetica','bold')
    doc.text('INFORME DE ASISTENCIA INDIVIDUAL', margin, 14)
    doc.setFontSize(9); doc.setFont('helvetica','normal')
    doc.text('Outlet de Puertas SpA', margin, 21)
    doc.text(`Emitido: ${new Date().toLocaleString('es-CL')}`, pageW - margin, 21, { align:'right' })

    let y = 40
    doc.setTextColor(0,0,0)

    // Datos del trabajador
    doc.setFontSize(13); doc.setFont('helvetica','bold')
    doc.text(meta.nombre || '—', margin, y); y += 6
    doc.setFontSize(10); doc.setFont('helvetica','normal')
    doc.setTextColor(100,100,100)
    doc.text(`${meta.sucursal} · ${meta.area}`, margin, y); y += 5
    doc.text(`Período: ${fil.desde}  al  ${fil.hasta}`, margin, y); y += 10
    doc.setTextColor(0,0,0)

    // Banner % puntualidad
    const pctColor = resumen.pct >= 80 ? [52,199,89] : resumen.pct >= 60 ? [255,149,0] : [255,59,48]
    doc.setFillColor(...pctColor); doc.setTextColor(255,255,255)
    doc.roundedRect(margin, y, pageW-margin*2, 18, 3, 3, 'F')
    doc.setFontSize(20); doc.setFont('helvetica','bold')
    doc.text(`${resumen.pct}%`, margin+8, y+12)
    doc.setFontSize(10); doc.setFont('helvetica','normal')
    doc.text('Puntualidad del período', margin+38, y+8)
    doc.text(`${resumen.puntual+resumen.extras} de ${resumen.total} jornadas cumpliendo horario`, margin+38, y+14)
    y += 24
    doc.setTextColor(0,0,0)

    // KPIs resumen
    doc.setFontSize(11); doc.setFont('helvetica','bold')
    doc.text('Resumen del período', margin, y); y += 2

    doc.autoTable({
      startY: y,
      head: [['Indicador','Días','Min. acumulados']],
      body: [
        ['Días puntuales',       String(resumen.puntual), '—'],
        ['Atrasos',              String(resumen.atrasos), fMin(resumen.minAtraso)],
        ['Con horas extra',      String(resumen.extras), fMin(resumen.minExtra)],
        ['Salidas anticipadas',  String(resumen.salAnt), fMin(resumen.minSalAnt)],
        ['Turno corrido (verificar Workera)', String(resumen.corridos), '—'],
        ['Jornadas incompletas', String(resumen.incompletas), '—'],
        ['Ausencias (turno sin marcas)', String(resumen.ausencias), ausPend>0?`${ausPend} sin gestionar`:'todas gestionadas'],
        ['Exceso de tope (>2h extra)', String(resumen.excesos), '—'],
      ],
      theme:'striped',
      headStyles:{fillColor:[22,33,62],textColor:255,fontSize:9},
      bodyStyles:{fontSize:9},
      columnStyles:{1:{halign:'right'},2:{halign:'right'}},
      margin:{left:margin,right:margin},
    })
    y = doc.lastAutoTable.finalY + 6

    // Colación
    doc.setFontSize(11); doc.setFont('helvetica','bold')
    doc.text('Colación (Art. 34 Código del Trabajo)', margin, y); y += 2
    doc.autoTable({
      startY: y,
      head: [['Estado','Días']],
      body: [
        ['Colación correcta',   String(resumen.colOk)],
        ['Sin colación marcada', String(resumen.colNoMarcada)],
        ['Colación breve (<30 min)', String(resumen.colBreve)],
      ],
      theme:'striped',
      headStyles:{fillColor:[22,33,62],textColor:255,fontSize:9},
      bodyStyles:{fontSize:9},
      columnStyles:{1:{halign:'right'}},
      margin:{left:margin,right:margin},
    })
    y = doc.lastAutoTable.finalY + 6

    // Detalle día por día — nueva página si no cabe
    if (y > 230) { doc.addPage(); y = 20 }
    doc.setFontSize(11); doc.setFont('helvetica','bold')
    doc.text('Detalle diario', margin, y); y += 2

    doc.autoTable({
      startY: y,
      head: [['Fecha','Turno','Esp. ent.','Real ent.','Esp. sal.','Real sal.','Atr.','Ext.','Estado']],
      body: dias.map(r=>([
        r.fecha,
        r.workshift_name || '—',
        fHora(r.entrada_esperada),
        fHora(r.entrada_real),
        fHora(r.salida_esperada),
        fHora(r.salida_real),
        (r.min_atraso_contable||0) > 0 ? '+'+r.min_atraso_contable : '',
        (r.min_extra_dia||0) > 0 ? '+'+r.min_extra_dia + ((r.min_extra_dia||0)>LIMITE_EXTRA_MIN?' !':'') : '',
        r.estado_dia==='sin_marcas'
          ? `Ausencia — ${(AUS_CATS[gesAus[r.fecha]?.clasificacion]||{}).l || 'falta injust. (pendiente)'}`
          : (EST[r.estado_dia]||{}).l || r.estado_dia,
      ])),
      theme:'striped',
      headStyles:{fillColor:[22,33,62],textColor:255,fontSize:8},
      bodyStyles:{fontSize:7.5},
      columnStyles:{6:{halign:'right'},7:{halign:'right'}},
      margin:{left:margin,right:margin},
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 8) {
          const est = data.cell.raw
          if (est === 'Atraso') { data.cell.styles.textColor = [255,59,48] }
          else if (est === 'Horas extra') { data.cell.styles.textColor = [0,122,255] }
          else if (est === 'Turno corrido') { data.cell.styles.textColor = [255,149,0] }
          else if (est === 'Salida anticipada') { data.cell.styles.textColor = [255,107,53] }
          else if (est === 'Puntual') { data.cell.styles.textColor = [52,199,89] }
        }
      }
    })

    // Footer en todas las páginas
    const total = doc.internal.getNumberOfPages()
    for (let i=1; i<=total; i++) {
      doc.setPage(i)
      doc.setFontSize(7); doc.setTextColor(150,150,150)
      doc.text(`Outlet de Puertas SpA · Informe de Asistencia · ${meta.nombre}`, margin, 290)
      doc.text(`Página ${i} de ${total}`, pageW-margin, 290, { align:'right' })
    }

    const nombreLimpio = (meta.nombre||'trabajador').replace(/[^\w]/g,'_').slice(0,40)
    doc.save(`asistencia_${nombreLimpio}_${fil.desde}_${fil.hasta}.pdf`)
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,flexWrap:'wrap',gap:10}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <button onClick={()=>{setDrillCod(null);setDrillNom(null)}} style={breadBtn}>← Todos los trabajadores</button>
          <span style={{fontWeight:700,fontSize:16}}>{drillNom}</span>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={exportarExcelIndividual} style={btnExportExcel}>📊 Excel</button>
          <button onClick={exportarPdfIndividual} style={btnExportPdf}>📄 PDF</button>
        </div>
      </div>
      {ausDias.length>0&&(
        <div style={{marginBottom:14,padding:'12px 16px',borderRadius:10,background:'#FF3B300A',border:'1px solid #FF3B3035',fontSize:13,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div>
            <div style={{fontWeight:700,color:'#FF3B30',marginBottom:2}}>⭕ {ausDias.length} ausencia(s) en el período{ausPend>0?` · ${ausPend} pendiente(s) de gestión`:' · todas gestionadas'}</div>
            <div style={{color:'var(--text-muted)',fontSize:12}}>Las ausencias sin gestionar se contabilizan como falta injustificada.</div>
          </div>
          {ausPend>0 && onNavegar && (
            <button onClick={()=>onNavegar('hhee',{dominio:'ausencias'})}
              style={{padding:'7px 14px',background:'#FF3B30',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:12.5,fontWeight:700,whiteSpace:'nowrap'}}>
              Gestionar en Excepciones →
            </button>
          )}
        </div>
      )}
      {pctCorr>=40&&(
        <div style={{marginBottom:14,padding:'12px 16px',borderRadius:10,background:'#FF950012',border:'1px solid #FF950040',fontSize:13}}>
          <div style={{fontWeight:700,color:'#FF9500',marginBottom:4}}>🔄 Posible turno mal asignado</div>
          <div style={{color:'var(--text-muted)',fontSize:12}}>
            {corridos} de {dias.length} días aparecen como "turno corrido". Verificar asignación en <strong>Workera → Control de Asistencia → Horarios y Turnos</strong>.
          </div>
        </div>
      )}
      <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead><tr style={{background:'var(--bg-app)'}}>
            <th style={thS}>Fecha</th><th style={thS}>Turno</th>
            <th style={{...thS,textAlign:'center'}}>Esperado</th>
            <th style={{...thS,textAlign:'center'}}>Real</th>
            <th style={{...thS,textAlign:'right'}}>Atraso</th>
            <th style={{...thS,textAlign:'right'}}>Extra</th>
            <th style={thS}>Estado</th>
            <th style={thS}></th>
          </tr></thead>
          <tbody>
            {dias.map((r,i)=>(<FilaDia key={i} r={r} ges={r.estado_dia==='sin_marcas'?gesAus[r.fecha]:null} puedeCorregir={puedeCorregir} onCorregir={()=>setModalCorr(r)}/>))}
            {dias.length===0&&<tr><td colSpan={8} style={{padding:24,textAlign:'center',color:'var(--text-muted)'}}>Sin jornadas en el período</td></tr>}
          </tbody>
        </table>
      </div>
      {modalCorr && (
        <ModalCorregirTurno
          r={modalCorr} cu={cu} puedeAprobar={puedeAprobar}
          onCerrar={()=>setModalCorr(null)}
          onGuardado={onRecargar}
        />
      )}
    </div>
  )
}

// ─── Vista global: todas las ausencias del período ────────────────────────────
function VistaAusenciasGlobal({ datos, fil, onNavegar, onVerBitacora }) {
  const [ges, setGes] = useState({})               // `cod|fecha` → gestión
  const [fEstado, setFEstado] = useState('todas')  // todas | pendientes | gestionadas
  const [busq, setBusq] = useState('')

  useEffect(() => {
    supabase.from('asis_ausencias').select('*').eq('activo', true)
      .gte('fecha', fil.desde).lte('fecha', fil.hasta)
      .then(({ data }) => setGes(Object.fromEntries((data||[]).map(g=>[`${g.cod_contaline}|${g.fecha}`, g]))))
  }, [fil.desde, fil.hasta])

  const aus = useMemo(() => datos
    .filter(r => r.estado_dia === 'sin_marcas')
    .map(r => ({ ...r, ges: ges[`${r.cod_contaline}|${r.fecha}`] || null }))
    .sort((a,b) => a.fecha < b.fecha ? 1 : -1), [datos, ges])

  const lista = useMemo(() => {
    const q = busq.trim().toLowerCase()
    return aus
      .filter(a => fEstado==='todas' || (fEstado==='pendientes' ? !a.ges : !!a.ges))
      .filter(a => !q || `${a.empleado} ${a.sucursal_nombre} ${a.departamento}`.toLowerCase().includes(q))
  }, [aus, fEstado, busq])

  const pend = aus.filter(a=>!a.ges).length
  const porTrab = useMemo(() => {
    const m = {}
    for (const a of aus) {
      const r = (m[a.cod_contaline] ??= { cod:a.cod_contaline, nombre:a.empleado, n:0, pend:0 })
      r.n++; if (!a.ges) r.pend++
    }
    return Object.values(m).sort((x,y)=>y.n-x.n)
  }, [aus])

  function exportarExcel() {
    const ws = XLSX.utils.json_to_sheet(lista.map(a => ({
      Fecha: a.fecha, Trabajador: a.empleado, Sucursal: a.sucursal_nombre, 'Área': a.departamento,
      Turno: a.workshift_name || '',
      'Gestión': a.ges ? ((AUS_CATS[a.ges.clasificacion]||{}).l || a.ges.clasificacion) : 'Pendiente — falta injustificada',
      'Justificación': a.ges?.justificacion || '',
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Ausencias')
    XLSX.writeFile(wb, `ausencias_global_${fil.desde}_${fil.hasta}.xlsx`)
  }

  if (aus.length === 0) return (
    <div style={{padding:'50px 0',textAlign:'center'}}>
      <div style={{fontSize:40,marginBottom:8}}>🎉</div>
      <div style={{fontWeight:700}}>Sin ausencias en el período seleccionado</div>
      <div style={{fontSize:12.5,color:'var(--text-muted)',marginTop:4}}>No hay días con turno asignado y cero marcas.</div>
    </div>
  )

  return (
    <div>
      {/* Resumen + acciones */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:12}}>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          <div style={{fontSize:13}}>
            <strong style={{fontSize:17}}>{aus.length}</strong> ausencia(s) ·
            <strong style={{color:'#FF3B30',marginLeft:4}}>{pend}</strong> pendiente(s) ·
            <strong style={{color:'#34C759',marginLeft:4}}>{aus.length-pend}</strong> gestionada(s)
          </div>
          <div style={{display:'flex',gap:4}}>
            {[['todas','Todas'],['pendientes','Pendientes'],['gestionadas','Gestionadas']].map(([k,l])=>(
              <button key={k} onClick={()=>setFEstado(k)} style={{
                padding:'5px 12px',borderRadius:100,fontSize:11.5,fontWeight:600,cursor:'pointer',
                border:`1px solid ${fEstado===k?'var(--accent)':'var(--border)'}`,
                background:fEstado===k?'var(--accent)12':'transparent',
                color:fEstado===k?'var(--accent)':'var(--text-muted)'}}>{l}</button>
            ))}
          </div>
          <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder='🔎 Trabajador, sucursal...'
            style={{padding:'6px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:12,background:'var(--bg-surface)',color:'var(--text)',width:190}}/>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={exportarExcel} style={{padding:'7px 13px',border:'1px solid var(--border)',borderRadius:8,fontSize:12.5,fontWeight:600,background:'var(--bg-surface)',color:'var(--text)',cursor:'pointer'}}>📊 Excel</button>
          {pend > 0 && onNavegar && (
            <button onClick={()=>onNavegar('hhee',{dominio:'ausencias'})}
              style={{padding:'7px 14px',background:'#FF3B30',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:12.5,fontWeight:700}}>
              Gestionar en Excepciones →
            </button>
          )}
        </div>
      </div>

      {/* Concentración por trabajador */}
      {porTrab.length > 1 && (
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
          {porTrab.slice(0,8).map(t=>(
            <button key={t.cod} onClick={()=>onVerBitacora(t.cod, t.nombre)}
              title='Ver bitácora del trabajador'
              style={{padding:'5px 11px',borderRadius:100,fontSize:11.5,cursor:'pointer',
                border:`1px solid ${t.pend>0?'#FF3B3040':'var(--border)'}`,
                background:t.pend>0?'#FF3B3008':'var(--bg-surface)',color:'var(--text)'}}>
              <strong>{t.nombre.split(' ').slice(0,2).join(' ')}</strong> · {t.n}
              {t.pend>0 && <span style={{color:'#FF3B30',fontWeight:700}}> ({t.pend} pend.)</span>}
            </button>
          ))}
        </div>
      )}

      {/* Tabla */}
      <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'auto',background:'var(--bg-surface)'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,minWidth:860}}>
          <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
            {['Fecha','Trabajador','Sucursal','Área','Turno','Gestión','Justificación',''].map(h=>(
              <th key={h} style={{padding:'9px 12px',textAlign:'left',fontSize:10.5,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {lista.map(a=>{
              const c = a.ges ? (AUS_CATS[a.ges.clasificacion]||{l:a.ges.clasificacion,c:'#8E8E93',ic:''}) : null
              return (
                <tr key={`${a.cod_contaline}|${a.fecha}`} style={{borderBottom:'1px solid var(--border)'}}>
                  <td style={{padding:'8px 12px',whiteSpace:'nowrap',fontWeight:500}}>{fFecha(a.fecha)}</td>
                  <td style={{padding:'8px 12px',fontWeight:600}}>{a.empleado}</td>
                  <td style={{padding:'8px 12px'}}>{a.sucursal_nombre}</td>
                  <td style={{padding:'8px 12px',fontSize:11.5,color:'var(--text-muted)'}}>{a.departamento}</td>
                  <td style={{padding:'8px 12px',fontSize:11.5,color:'var(--text-muted)'}}>{a.workshift_name||'—'}</td>
                  <td style={{padding:'8px 12px'}}>
                    {c ? (
                      <span style={{fontSize:10.5,fontWeight:800,padding:'2px 9px',borderRadius:100,background:`${c.c}15`,color:c.c,whiteSpace:'nowrap'}}>{c.ic} {c.l}</span>
                    ) : (
                      <span style={{fontSize:10.5,fontWeight:800,padding:'2px 9px',borderRadius:100,background:'#FF3B3012',color:'#FF3B30',whiteSpace:'nowrap'}}>⛔ Pendiente · falta injust.</span>
                    )}
                  </td>
                  <td style={{padding:'8px 12px',fontSize:11,fontStyle:a.ges?'italic':'normal',color:a.ges?'var(--text)':'var(--text-muted)',maxWidth:260}}>{a.ges?.justificacion||'—'}</td>
                  <td style={{padding:'8px 12px',textAlign:'right'}}>
                    <button onClick={()=>onVerBitacora(a.cod_contaline, a.empleado)}
                      style={{padding:'4px 10px',border:'1px solid var(--border)',borderRadius:7,background:'transparent',cursor:'pointer',fontSize:11.5,whiteSpace:'nowrap'}}>📋 Bitácora</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// --- Cola de aprobación de solicitudes de modificación de turno ---
function VistaSolicitudesTurno({ cu, scopeSuc, onVerBitacora }) {
  const [solis, setSolis] = useState([])
  const [emps, setEmps] = useState({})
  const [users, setUsers] = useState({})
  const [estado, setEstado] = useState('pendiente')
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(null)
  const [msg, setMsg] = useState(null)

  useEffect(() => { cargar() }, [estado, scopeSuc])
  async function cargar() {
    setCargando(true)
    try {
      let q = supabase.from('asis_correcciones_turno').select('*').order('solicitado_at', { ascending: false })
      if (estado !== 'todas') q = q.eq('estado', estado)
      const { data, error } = await q
      if (error) throw error
      let rows = data || []
      const cods = [...new Set(rows.map(r => r.cod_contaline))]
      let emap = {}
      if (cods.length) {
        const { data: es } = await supabase.from('rrhh_empleados').select('cod_contaline,nombre,sucursal_id').in('cod_contaline', cods)
        emap = Object.fromEntries((es||[]).map(e => [e.cod_contaline, e]))
      }
      if (scopeSuc) rows = rows.filter(r => emap[r.cod_contaline]?.sucursal_id === scopeSuc)
      setEmps(emap)
      const uids = [...new Set(rows.flatMap(r => [r.solicitado_por, r.resuelto_por]).filter(Boolean))]
      if (uids.length) {
        const { data: us } = await supabase.from('usuarios').select('id,nombre').in('id', uids)
        setUsers(Object.fromEntries((us||[]).map(u => [u.id, u.nombre])))
      }
      setSolis(rows)
    } catch(e) { setMsg({ t:'error', x:e.message }) }
    finally { setCargando(false) }
  }

  async function resolver(soli, decision, comentario) {
    try {
      if (decision === 'aprobada') {
        await supabase.from('asis_correcciones_turno')
          .update({ activo:false })
          .eq('cod_contaline', soli.cod_contaline).eq('fecha', soli.fecha)
          .eq('estado','aprobada').eq('activo', true)
      }
      const { error } = await supabase.from('asis_correcciones_turno').update({
        estado: decision, activo: decision === 'aprobada',
        resuelto_por: cu.id, resuelto_at: new Date().toISOString(),
        comentario_resolucion: comentario || null, updated_at: new Date().toISOString(),
      }).eq('id', soli.id)
      if (error) throw error
      setModal(null)
      setMsg({ t:'ok', x:`Solicitud ${decision === 'aprobada' ? 'aprobada' : 'rechazada'}` })
      await cargar()
    } catch(e) { setMsg({ t:'error', x:e.message }) }
  }

  const hhmm = ts => ts ? String(ts).slice(11,16) : '--'

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:12}}>
        <div style={{display:'flex',gap:4}}>
          {[['pendiente','Pendientes'],['aprobada','Aprobadas'],['rechazada','Rechazadas'],['todas','Todas']].map(([k,l])=>(
            <button key={k} onClick={()=>setEstado(k)} style={{
              padding:'6px 13px',borderRadius:100,fontSize:12,fontWeight:600,cursor:'pointer',
              border:`1px solid ${estado===k?'var(--accent)':'var(--border)'}`,
              background: estado===k?'var(--accent)12':'transparent',
              color: estado===k?'var(--accent)':'var(--text-muted)'}}>{l}</button>
          ))}
        </div>
        <div style={{fontSize:12.5,color:'var(--text-muted)'}}>{solis.length} solicitud(es)</div>
      </div>

      {msg && (
        <div style={{marginBottom:12,padding:'9px 14px',borderRadius:8,fontSize:13,
          background: msg.t==='error'?'#FF3B3012':'#34C75912',
          border:`1px solid ${msg.t==='error'?'#FF3B3040':'#34C75940'}`,
          display:'flex',justifyContent:'space-between'}}>
          <span>{msg.x}</span>
          <button onClick={()=>setMsg(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
        </div>
      )}

      {cargando ? <div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</div> :
       solis.length === 0 ? (
        <div style={{padding:'40px 0',textAlign:'center'}}>
          <div style={{fontSize:36,marginBottom:8}}>{estado==='pendiente'?'✅':'📋'}</div>
          <div style={{fontWeight:700}}>{estado==='pendiente'?'Sin solicitudes pendientes':'Sin solicitudes en este estado'}</div>
        </div>
      ) : (
        <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'auto',background:'var(--bg-surface)'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,minWidth:900}}>
            <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
              {['Solicitado','Trabajador','Fecha turno','Cambio propuesto','Motivo','Estado',''].map(h=>(
                <th key={h} style={{padding:'9px 12px',textAlign:'left',fontSize:10.5,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {solis.map(s => {
                const e = emps[s.cod_contaline]
                const stColor = s.estado==='pendiente'?'#FF9500':s.estado==='aprobada'?'#34C759':'#FF3B30'
                const stLabel = s.estado==='pendiente'?'Pendiente':s.estado==='aprobada'?'Aprobada':'Rechazada'
                return (
                  <tr key={s.id} style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'8px 12px',fontSize:11,whiteSpace:'nowrap'}}>
                      {users[s.solicitado_por]||s.solicitado_por||'--'}<br/>
                      <span style={{color:'var(--text-muted)'}}>{s.solicitado_at?fFecha(s.solicitado_at):'--'}</span>
                    </td>
                    <td style={{padding:'8px 12px',fontWeight:600}}>{e?.nombre||`#${s.cod_contaline}`}<br/><span style={{fontSize:10.5,color:'var(--text-muted)',fontWeight:400}}>{e?.sucursal_id||''}</span></td>
                    <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>{fFecha(s.fecha)}</td>
                    <td style={{padding:'8px 12px',fontSize:11.5}}>
                      <div><span style={{color:'var(--text-muted)'}}>de:</span> {s.workshift_name_original||'sin turno'} {s.entrada_esperada_original?`${hhmm(s.entrada_esperada_original)}-${hhmm(s.salida_esperada_original)}`:''}</div>
                      <div style={{fontWeight:700}}><span style={{color:'var(--text-muted)',fontWeight:400}}>a:</span> {s.workshift_name_corregido||'--'} {hhmm(s.entrada_esperada_corregida)}-{hhmm(s.salida_esperada_corregida)}</div>
                    </td>
                    <td style={{padding:'8px 12px',fontSize:11,maxWidth:200}}>{s.motivo}</td>
                    <td style={{padding:'8px 12px'}}>
                      <span style={{fontSize:10.5,fontWeight:800,padding:'2px 9px',borderRadius:100,background:`${stColor}15`,color:stColor,whiteSpace:'nowrap'}}>{stLabel}</span>
                      {s.estado!=='pendiente' && s.resuelto_por && (
                        <div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>{users[s.resuelto_por]||s.resuelto_por}{s.comentario_resolucion?` - "${s.comentario_resolucion}"`:''}</div>
                      )}
                    </td>
                    <td style={{padding:'8px 12px',textAlign:'right',whiteSpace:'nowrap'}}>
                      {s.estado==='pendiente' ? (
                        <>
                          <button onClick={()=>setModal({ soli:s, decision:'aprobada' })} title='Aprobar' style={{padding:'4px 9px',border:'1px solid #34C75940',color:'#34C759',background:'transparent',borderRadius:7,cursor:'pointer',fontSize:12,marginRight:4}}>✅</button>
                          <button onClick={()=>setModal({ soli:s, decision:'rechazada' })} title='Rechazar' style={{padding:'4px 9px',border:'1px solid #FF3B3040',color:'#FF3B30',background:'transparent',borderRadius:7,cursor:'pointer',fontSize:12,marginRight:4}}>⛔</button>
                        </>
                      ) : null}
                      <button onClick={()=>onVerBitacora(s.cod_contaline, e?.nombre||'')} title='Ver bitácora' style={{padding:'4px 9px',border:'1px solid var(--border)',background:'transparent',borderRadius:7,cursor:'pointer',fontSize:12}}>📋</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ModalResolverTurno soli={modal.soli} decision={modal.decision} emp={emps[modal.soli.cod_contaline]}
          onCerrar={()=>setModal(null)}
          onConfirmar={(coment)=>resolver(modal.soli, modal.decision, coment)}/>
      )}
    </div>
  )
}

function ModalResolverTurno({ soli, decision, emp, onCerrar, onConfirmar }) {
  const [coment, setComent] = useState('')
  const [enviando, setEnviando] = useState(false)
  const aprob = decision === 'aprobada'
  const hhmm = ts => ts ? String(ts).slice(11,16) : '--'
  return (
    <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-surface)',borderRadius:14,padding:22,width:'100%',maxWidth:440,border:'1px solid var(--border)'}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:2}}>{aprob?'Aprobar modificación':'Rechazar solicitud'}</div>
        <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12}}>
          {emp?.nombre||`#${soli.cod_contaline}`} - {fFecha(soli.fecha)}
        </div>
        <div style={{fontSize:12,background:'var(--bg-app)',borderRadius:8,padding:'10px 12px',marginBottom:12}}>
          <div><span style={{color:'var(--text-muted)'}}>Turno actual:</span> {soli.workshift_name_original||'sin turno'} {soli.entrada_esperada_original?`${hhmm(soli.entrada_esperada_original)}-${hhmm(soli.salida_esperada_original)}`:''}</div>
          <div style={{fontWeight:700,marginTop:2}}><span style={{color:'var(--text-muted)',fontWeight:400}}>Propuesto:</span> {soli.workshift_name_corregido||'--'} {hhmm(soli.entrada_esperada_corregida)}-{hhmm(soli.salida_esperada_corregida)}</div>
          <div style={{marginTop:6,fontStyle:'italic',color:'var(--text-muted)'}}>Motivo: {soli.motivo}</div>
        </div>
        {aprob && (
          <div style={{fontSize:11.5,color:'#34C759',background:'#34C75910',border:'1px solid #34C75930',borderRadius:8,padding:'8px 11px',marginBottom:12}}>
            Al aprobar, el turno corregido se aplicará y recalculará la puntualidad de esa jornada.
          </div>
        )}
        <label style={{display:'block',fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.04em'}}>
          Comentario {aprob?'(opcional)':'(motivo del rechazo)'}
        </label>
        <textarea value={coment} onChange={e=>setComent(e.target.value)} rows={2}
          placeholder={aprob?'Ej: Confirmado con el trabajador...':'Ej: El turno propuesto no corresponde...'}
          style={{width:'100%',boxSizing:'border-box',padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit',resize:'vertical'}}/>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:14}}>
          <button onClick={onCerrar} disabled={enviando} style={btnSec}>Cancelar</button>
          <button disabled={enviando || (!aprob && !coment.trim())}
            onClick={async()=>{ setEnviando(true); await onConfirmar(coment.trim()) }}
            style={{padding:'8px 15px',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600,color:'white',
              background: aprob?'#34C759':'#FF3B30', opacity:(enviando||(!aprob&&!coment.trim()))?0.5:1}}>
            {enviando?'...':(aprob?'Aprobar':'Rechazar')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Una fila por día con detalle de marcajes expandible
function FilaDia({ r, ges, puedeCorregir, onCorregir }) {
  const [abierto, setAbierto] = useState(false)
  const est = EST[r.estado_dia] || EST.sin_marcas
  const col = COL[r.estado_colacion] || null
  const marcajes = Array.isArray(r.marcajes_detalle) ? r.marcajes_detalle : []
  const tieneDetalle = marcajes.length > 0

  // Detectar inicio/fin de colación
  const colInicio = marcajes.find(m=>m.tipo===4)
  const colFin    = marcajes.find(m=>m.tipo===5)
  const tieneColacion = !!(colInicio || colFin)

  return (
    <>
      <tr style={{background: r.estado_dia==='turno_corrido'?'#FF950006' : r.estado_dia==='atraso'?'#FF3B3006' : undefined, cursor: tieneDetalle?'pointer':'default'}}
        onClick={()=>tieneDetalle && setAbierto(!abierto)}>
        <td style={{...tdS,fontWeight:500,whiteSpace:'nowrap'}}>{fFecha(r.fecha)}</td>
        <td style={{...tdS,fontSize:12,color:'var(--text-muted)'}}>
          {r.workshift_name||'—'}
          {r.turno_corregido && <span title="Turno corregido manualmente" style={{marginLeft:5,fontSize:10,fontWeight:700,padding:'1px 6px',borderRadius:100,background:'var(--accent)15',color:'var(--accent)'}}>✏️ corregido</span>}
        </td>
        <td style={{...tdS,textAlign:'center',fontSize:11,fontFamily:'monospace'}}>{fHora(r.entrada_esperada)} → {fHora(r.salida_esperada)}</td>
        <td style={{...tdS,textAlign:'center',fontSize:11,fontFamily:'monospace'}}>
          {fHora(r.entrada_real)} → {fHora(r.salida_real)}
          {tieneColacion && <div style={{fontSize:10,color:'#FF9500',marginTop:2}}>🍴 {fHora(colInicio?.hora)} - {fHora(colFin?.hora)}{r.min_colacion_real?` (${r.min_colacion_real}m)`:''}</div>}
        </td>
        <td style={{...tdS,textAlign:'right',fontWeight:600,color:(r.min_atraso_contable||0)>0?'#FF3B30':'var(--text-muted)'}}>
          {(r.min_atraso_contable||0)>0?'+'+fMin(r.min_atraso_contable):'—'}
        </td>
        <td style={{...tdS,textAlign:'right',fontWeight:600,color:(r.min_extra_dia||0)>120?'#FF3B30':(r.min_extra_dia||0)>0?'#007AFF':'var(--text-muted)'}}>
          {(r.min_extra_dia||0)>0?'+'+fMin(r.min_extra_dia)+((r.min_extra_dia||0)>120?' 🚨':''):'—'}
        </td>
        <td style={tdS}>
          <div style={{display:'flex',flexDirection:'column',gap:3}}>
            <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:100,background:est.bg,color:est.c,whiteSpace:'nowrap'}}>
              {est.ic} {est.l}
            </span>
            {col && col !== COL.no_aplica && (
              <span style={{fontSize:10,fontWeight:600,padding:'1px 7px',borderRadius:100,background:col.bg,color:col.c,whiteSpace:'nowrap'}}>
                {col.ic} {col.l}
              </span>
            )}
            {r.estado_dia==='sin_marcas' && (
              ges ? (
                <span title={`${ges.justificacion} — gestionada el ${ges.gestionado_at?.slice(0,10)||''}`}
                  style={{fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:100,whiteSpace:'nowrap',
                    background:`${(AUS_CATS[ges.clasificacion]||{}).c||'#8E8E93'}15`,
                    color:(AUS_CATS[ges.clasificacion]||{}).c||'#8E8E93'}}>
                  {(AUS_CATS[ges.clasificacion]||{}).ic} {(AUS_CATS[ges.clasificacion]||{}).l||ges.clasificacion}
                </span>
              ) : (
                <span style={{fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:100,whiteSpace:'nowrap',background:'#FF3B3012',color:'#FF3B30'}}>
                  ⛔ Falta injustificada · pendiente de gestión
                </span>
              )
            )}
          </div>
        </td>
        <td style={{...tdS,color:'var(--text-muted)',fontSize:11,textAlign:'center',whiteSpace:'nowrap'}}>
          {puedeCorregir && (
            <button onClick={e=>{e.stopPropagation();onCorregir()}} title="Corregir turno"
              style={{background:'none',border:'1px solid var(--border)',borderRadius:6,cursor:'pointer',fontSize:11,padding:'2px 7px',marginRight:6}}>✏️</button>
          )}
          {tieneDetalle ? (abierto?'▲':`▼ ${marcajes.length}`) : '—'}
        </td>
      </tr>
      {abierto && tieneDetalle && (
        <tr>
          <td colSpan={8} style={{padding:'0',background:'var(--bg-app)',borderBottom:'1px solid var(--border)'}}>
            <DetalleMarcajes marcajes={marcajes} jornada={r} />
          </td>
        </tr>
      )}
    </>
  )
}

function DetalleMarcajes({ marcajes, jornada }) {
  const sorted = [...marcajes].sort((a,b)=> a.hora < b.hora ? -1 : 1)
  const col = jornada && COL[jornada.estado_colacion]
  const showDiag = col && jornada.estado_colacion !== 'no_aplica' && jornada.estado_colacion !== 'ok'

  return (
    <div style={{padding:'12px 20px'}}>
      <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:8}}>
        Marcajes registrados ({sorted.length})
      </div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:showDiag?10:0}}>
        {sorted.map((m,i)=>{
          const t = TIPO_MARCA[m.tipo] || {ic:'•',l:`Tipo ${m.tipo}`}
          const color = m.tipo===0 ? '#34C759' : m.tipo===1 ? '#FF3B30' : m.tipo===4||m.tipo===5 ? '#FF9500' : '#007AFF'
          return (
            <div key={i} style={{
              padding:'8px 12px',background:'var(--bg-surface)',border:`1px solid ${color}30`,
              borderRadius:8,display:'flex',alignItems:'center',gap:8,fontSize:12
            }}>
              <span style={{fontSize:14}}>{t.ic}</span>
              <div>
                <div style={{fontWeight:600,color,lineHeight:1.2}}>{t.l}</div>
                <div style={{fontFamily:'monospace',fontSize:11,color:'var(--text-muted)'}}>
                  {fHora(m.hora)} {m.origen && <span style={{marginLeft:4}}>· {m.origen}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Diagnóstico de colación */}
      {showDiag && (
        <div style={{padding:'10px 14px',borderRadius:8,background:col.bg,border:`1px solid ${col.c}40`,fontSize:12}}>
          <div style={{fontWeight:700,color:col.c,marginBottom:2}}>
            {col.ic} {col.l}
          </div>
          <div style={{color:'var(--text-muted)',fontSize:11,lineHeight:1.5}}>
            {jornada.estado_colacion === 'no_marcada' && (
              <>Jornada de {Math.round((jornada.min_presencia||0)/60*10)/10}h requiere registro de colación. <strong>El trabajador no marcó ni inicio ni fin.</strong> Esta es una falta legal según Art. 34 del Código del Trabajo.</>
            )}
            {jornada.estado_colacion === 'parcial' && (
              <>El trabajador marcó solo uno de los dos extremos de colación ({jornada.n_inicio_col} inicio + {jornada.n_fin_col} fin). No se puede comprobar la duración legal.</>
            )}
            {jornada.estado_colacion === 'breve' && (
              <>Colación registrada de <strong>{jornada.min_colacion_real} minutos</strong>. El mínimo legal son 30 minutos.</>
            )}
            {jornada.estado_colacion === 'extendida' && (
              <>Colación registrada de <strong>{jornada.min_colacion_real} minutos</strong> (más de 90 min). Verificar si es lo pactado en contrato o si el trabajador olvidó marcar el regreso.</>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helpers agrupación ───────────────────────────────────────────────────────
function calcMet(label,rows) {
  const dias=rows.length
  const puntual=rows.filter(r=>r.estado_dia==='puntual').length
  const atrasos=rows.filter(r=>r.estado_dia==='atraso').length
  const extras=rows.filter(r=>r.estado_dia==='hizo_extra').length
  const salAnt=rows.filter(r=>r.estado_dia==='salida_anticipada').length
  const corridos=rows.filter(r=>r.estado_dia==='turno_corrido').length
  const excesos=rows.filter(r=>(r.min_extra_dia||0)>LIMITE_EXTRA_MIN).length
  const minAtraso=rows.reduce((s,r)=>s+(r.min_atraso_contable||0),0)
  const minExtra=rows.reduce((s,r)=>s+(r.min_extra_dia||0),0)
  const minSalAnt=rows.reduce((s,r)=>s+(r.min_salida_anticipada_contable||0),0)
  // % puntualidad: puntual + hizo_extra (los que cumplieron horario)
  const pct=dias>0?Math.round((puntual+extras)/dias*100):0
  return {label,dias,puntual,atrasos,extras,salAnt,corridos,excesos,minAtraso,minExtra,minSalAnt,pct}
}
function agrupar(datos,campo) {
  const map={}
  for(const r of datos){const k=r[campo]||'Sin asignar';if(!map[k])map[k]=[];map[k].push(r)}
  return Object.entries(map).map(([l,rows])=>calcMet(l,rows))
}
function agruparTrab(datos) {
  const map={}
  for(const r of datos){const k=r.cod_contaline;if(!map[k])map[k]=[];map[k].push(r)}
  return Object.entries(map).map(([cod,rows])=>({
    cod:Number(cod),nombre:rows[0].empleado||'Sin nombre',
    workshift:rows[0].workshift_name,area:rows[0].departamento,
    ...calcMet(cod,rows)
  }))
}

// ─── Modal Corregir Turno ─────────────────────────────────────────────────────
// Solo admin y Gestión de Personas. Escribe en asis_correcciones_turno;
// v_asis_jornadas recalcula estado y % puntualidad automáticamente.
// Convención TZ: horas chilenas locales etiquetadas como UTC (igual que Workera).
function ModalCorregirTurno({ r, cu, puedeAprobar, onCerrar, onGuardado }) {
  const [form, setForm] = useState({
    turno:   r.workshift_name || '',
    entrada: r.entrada_esperada ? String(r.entrada_esperada).slice(11,16) : '09:00',
    salida:  r.salida_esperada  ? String(r.salida_esperada).slice(11,16)  : '17:30',
    motivo:  ''
  })
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  const tsOriginal = v => v ? String(v).replace(' ','T') + 'Z' : null

  async function guardar() {
    if (!form.motivo.trim())            { setErr('El motivo es obligatorio'); return }
    if (!form.entrada || !form.salida)  { setErr('Entrada y salida son obligatorias'); return }
    if (form.salida <= form.entrada)    { setErr('La salida debe ser posterior a la entrada (turnos nocturnos no soportados aún)'); return }
    setGuardando(true); setErr(null)
    try {
      const ahora = new Date().toISOString()
      const base = {
        cod_contaline: r.cod_contaline, fecha: r.fecha,
        workshift_name_corregido:   form.turno.trim() || null,
        entrada_esperada_corregida: `${r.fecha}T${form.entrada}:00Z`,
        salida_esperada_corregida:  `${r.fecha}T${form.salida}:00Z`,
        workshift_name_original:    r.workshift_name || null,
        entrada_esperada_original:  tsOriginal(r.entrada_esperada),
        salida_esperada_original:   tsOriginal(r.salida_esperada),
        motivo: form.motivo.trim(), corregido_por: cu.id, updated_at: ahora,
      }
      let error
      if (puedeAprobar) {
        ({ error } = await supabase.from('asis_correcciones_turno').upsert(
          { ...base, activo: true, estado: 'aprobada', solicitado_por: cu.id, solicitado_at: ahora,
            resuelto_por: cu.id, resuelto_at: ahora, comentario_resolucion: 'Corrección directa por rol autorizado' },
          { onConflict: 'cod_contaline,fecha' }))
      } else {
        ({ error } = await supabase.from('asis_correcciones_turno').insert(
          { ...base, activo: true, estado: 'pendiente', solicitado_por: cu.id, solicitado_at: ahora }))
      }
      if (error) {
        if (error.code === '23505') throw new Error('Ya existe una solicitud pendiente para este día. Espera su resolución.')
        throw error
      }
      await onGuardado()
      onCerrar()
    } catch(e) { setErr(e.message) }
    finally { setGuardando(false) }
  }

  async function revertir() {
    setGuardando(true); setErr(null)
    try {
      const { error } = await supabase.from('asis_correcciones_turno')
        .update({ activo: false, updated_at: new Date().toISOString() })
        .eq('cod_contaline', r.cod_contaline).eq('fecha', r.fecha)
      if (error) throw error
      await onGuardado()
      onCerrar()
    } catch(e) { setErr(e.message) }
    finally { setGuardando(false) }
  }

  return (
    <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-surface)',borderRadius:14,padding:24,width:'100%',maxWidth:440,border:'1px solid var(--border)'}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:2}}>{puedeAprobar ? '✏️ Corregir turno' : '📝 Proponer modificación de turno'}</div>
        <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12}}>
          {r.empleado} · {fFecha(r.fecha)}
          {r.workshift_name && <span> · turno actual: <strong>{r.workshift_name}</strong> {fHora(r.entrada_esperada)}–{fHora(r.salida_esperada)}</span>}
          {!r.workshift_name && <span> · <strong>sin turno asignado</strong></span>}
        </div>
        {!puedeAprobar && (
          <div style={{fontSize:11.5,color:'#FF9500',background:'#FF950010',border:'1px solid #FF950030',borderRadius:8,padding:'8px 11px',marginBottom:14}}>
            Tu solicitud quedará <strong>pendiente de aprobación</strong> por Gestión de Personas o dirección. El turno no cambia hasta que sea autorizada.
          </div>
        )}

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:12}}>
          <div>
            <label style={lblM}>Turno</label>
            <input value={form.turno} onChange={e=>setForm(f=>({...f,turno:e.target.value}))} placeholder="Ej: T3" style={{...inp,width:'100%',boxSizing:'border-box'}}/>
          </div>
          <div>
            <label style={lblM}>Entrada</label>
            <input type="time" value={form.entrada} onChange={e=>setForm(f=>({...f,entrada:e.target.value}))} style={{...inp,width:'100%',boxSizing:'border-box'}}/>
          </div>
          <div>
            <label style={lblM}>Salida</label>
            <input type="time" value={form.salida} onChange={e=>setForm(f=>({...f,salida:e.target.value}))} style={{...inp,width:'100%',boxSizing:'border-box'}}/>
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <label style={lblM}>Motivo de la corrección (obligatorio)</label>
          <textarea value={form.motivo} onChange={e=>setForm(f=>({...f,motivo:e.target.value}))} rows={2}
            placeholder="Ej: turno mal asignado en Workera, el trabajador cubrió turno T3"
            style={{...inp,width:'100%',boxSizing:'border-box',resize:'vertical',fontFamily:'inherit'}}/>
        </div>

        <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:14,padding:'8px 10px',background:'var(--bg-app)',borderRadius:8}}>
          Al guardar, el estado del día y el % de puntualidad se recalculan automáticamente.
          La corrección queda registrada con tu usuario, fecha y motivo.
        </div>

        {err && <div style={{fontSize:12,color:'#FF3B30',marginBottom:12}}>⚠️ {err}</div>}

        <div style={{display:'flex',gap:8,justifyContent:'space-between',alignItems:'center'}}>
          <div>
            {r.turno_corregido && (
              <button onClick={revertir} disabled={guardando}
                style={{padding:'8px 14px',background:'transparent',color:'#FF3B30',border:'1px solid #FF3B3040',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600}}>
                Revertir corrección
              </button>
            )}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={onCerrar} disabled={guardando} style={btnSec}>Cancelar</button>
            <button onClick={guardar} disabled={guardando} style={btnPri}>
              {guardando ? 'Guardando...' : (puedeAprobar ? 'Guardar corrección' : 'Enviar solicitud')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
const lblM = {display:'block',fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.04em'}

// ─── Micro UI ─────────────────────────────────────────────────────────────────
function MiniKpi({ic,l,v,sub,c,alerta}) {
  return (
    <div style={{background:alerta?'#FF3B3008':'var(--bg-surface)',border:`1px solid ${alerta?'#FF3B3040':'var(--border)'}`,borderRadius:10,padding:'10px 12px'}}>
      <div style={{fontSize:18,marginBottom:2}}>{ic}</div>
      <div style={{fontSize:20,fontWeight:800,color:c}}>{v}</div>
      <div style={{fontSize:11,fontWeight:600}}>{l}</div>
      {sub&&<div style={{fontSize:10,color:'var(--text-muted)'}}>{sub}</div>}
    </div>
  )
}
function Bd({c,bg,children}) {
  return <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:100,color:c,background:bg,display:'inline-block'}}>{children}</span>
}

const btnPri   = {padding:'10px 20px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:600}
const btnSec   = {padding:'8px 14px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}
const btnExcel = {padding:'9px 16px',background:'#1D6F42',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}
const btnExportExcel = {padding:'7px 13px',background:'#1D6F42',color:'white',border:'none',borderRadius:7,cursor:'pointer',fontSize:12,fontWeight:600}
const btnExportPdf   = {padding:'7px 13px',background:'#B22222',color:'white',border:'none',borderRadius:7,cursor:'pointer',fontSize:12,fontWeight:600}
const presetBtn= {padding:'6px 12px',border:'1px solid var(--border)',borderRadius:100,cursor:'pointer',fontSize:12,fontWeight:500}
const inp      = {padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit'}
const breadBtn = {background:'none',border:'none',cursor:'pointer',color:'var(--accent)',fontSize:13,padding:'2px 4px',textDecoration:'underline'}
const breadBtnAct = {...breadBtn,fontWeight:700,color:'var(--text)',textDecoration:'none'}
const thS      = {padding:'10px 12px',textAlign:'left',fontWeight:600,fontSize:11,textTransform:'uppercase',letterSpacing:'0.04em',color:'var(--text-muted)',borderBottom:'1px solid var(--border)'}
const tdS      = {padding:'10px 12px',borderBottom:'1px solid var(--border)',verticalAlign:'middle'}
