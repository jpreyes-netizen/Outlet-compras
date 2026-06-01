// src/rrhh/asistencia/tabs/AsisAnalisis.jsx
// Fusión de Jornadas + Extra/Atrasos.
// 3 vistas internas: Resumen (sucursal→área→trabajador), Reporte legal, Bitácora.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabase'
import * as XLSX from 'xlsx'

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
  puntual:       {c:'#34C759',bg:'#34C75912',ic:'✅',l:'Puntual'},
  hizo_extra:    {c:'#007AFF',bg:'#007AFF12',ic:'⏱', l:'Horas extra'},
  atraso:        {c:'#FF3B30',bg:'#FF3B3012',ic:'⚠️',l:'Atraso'},
  turno_corrido: {c:'#FF9500',bg:'#FF950012',ic:'🔄',l:'Turno corrido'},
  incompleta:    {c:'#AF52DE',bg:'#AF52DE12',ic:'❓',l:'Incompleta'},
  sin_marcas:    {c:'#8E8E93',bg:'#8E8E9312',ic:'⭕',l:'Sin marcas'},
  sin_turno:     {c:'#6B7280',bg:'#6B728012',ic:'📭',l:'Sin turno asignado'},
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

export function AsisAnalisis({ cu, onIrASync }) {
  const [fil, setFil]   = useState({rango:'mes',desde:iMes(),hasta:hoy(),sucursal:'todas'})
  const [incluirSinTurno, setIncluirSinTurno] = useState(false)
  const [datos, setDatos] = useState([])
  const [cargando, setCarg] = useState(true)
  const [vista, setVista]  = useState('resumen') // resumen | legal | bitacora
  const [drillSuc, setDrillSuc]   = useState(null)
  const [drillArea, setDrillArea] = useState(null)
  const [drillCod, setDrillCod]   = useState(null)
  const [drillNom, setDrillNom]   = useState(null)

  useEffect(() => { cargar() }, [fil.desde, fil.hasta])

  async function cargar() {
    setCarg(true)
    try {
      const { data, error } = await supabase
        .from('v_asis_jornadas').select('*')
        .gte('fecha', fil.desde).lte('fecha', fil.hasta)
        .order('fecha',{ascending:false})
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
      corrido: d.filter(r=>r.estado_dia==='turno_corrido').length,
      incompleta: d.filter(r=>['incompleta','sin_marcas'].includes(r.estado_dia)).length,
      sinTurno: datos.filter(r=>r.estado_dia==='sin_turno' && (fil.sucursal==='todas'||r.sucursal_nombre===fil.sucursal)).length,
      minAtraso: d.reduce((s,r)=>s+(r.min_atraso_contable||0),0),
      minExtra:  d.reduce((s,r)=>s+(r.min_extra_dia||0),0),
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
      'Días exceso legal (>2h)':t.diasExceso,'Días turno corrido':t.turnosCorridos,
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
        'Extra total':fMin(r.min_extra_dia),'Excede 2h legal':(r.min_extra_dia||0)>120?'SÍ':'',
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
        <select value={fil.sucursal} onChange={e=>{setFil(f=>({...f,sucursal:e.target.value}));resetDrill()}} style={inp}>
          <option value="todas">Todas las sucursales</option>
          {sucs.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
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
          {k:'legal',  l:'🚨 Reporte legal'},
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
        <MiniKpi ic="🚨" l="Exceso 2h" v={kpis.excesos} c="#FF3B30" alerta={kpis.excesos>0}/>
        <MiniKpi ic="🔄" l="Turno corrido" v={kpis.corrido} c="#FF9500" alerta={kpis.corrido>0}/>
        <MiniKpi ic="🍴" l="Sin colación" v={kpis.colNoMarcada} sub={kpis.colAplica>0?Math.round(kpis.colNoMarcada/kpis.colAplica*100)+'% del total':'—'} c={kpis.colNoMarcada>0?"#FF3B30":"#34C759"} alerta={kpis.colNoMarcada>0}/>
        <MiniKpi ic="❓" l="Incompletas" v={kpis.incompleta} c="#AF52DE" alerta={kpis.incompleta>0}/>
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
      ) : vista==='legal' ? (
        <VistaLegal datos={datosBase} />
      ) : (
        <VistaBitacora
          agruTrab={agruTrab} datosFil={datosFil}
          drillCod={drillCod} drillNom={drillNom}
          setDrillCod={setDrillCod} setDrillNom={setDrillNom}
          datos={datosBase}
          drillSuc={drillSuc} drillArea={drillArea}
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
              <td style={tdS}>{r.excesos>0?<Bd c="#FF3B30" bg="#FF3B3012">🚨 {r.excesos}</Bd>:'—'}</td>
              <td style={tdS}>{r.corridos>0?<Bd c="#FF9500" bg="#FF950012">⚠️ {r.corridos}</Bd>:'—'}</td>
              <td style={{...tdS,color:'var(--accent)',fontWeight:600}}>{showBitacora?'Bitácora →':'Ver →'}</td>
            </tr>
          ))}
          {rows.length===0&&<tr><td colSpan={10} style={{padding:28,textAlign:'center',color:'var(--text-muted)'}}>Sin datos</td></tr>}
        </tbody>
      </table>
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
          Sin infracciones legales en el período seleccionado.
        </div>
      )}
      {excesos.length>0&&(
        <div style={{marginBottom:24}}>
          <div style={{fontSize:14,fontWeight:700,color:'#FF3B30',marginBottom:10}}>
            🚨 Exceso de horas extra legales ({excesos.length} jornadas)
          </div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:10}}>
            Máximo legal Chile: 2 horas extra por jornada diaria (120 min).
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
function VistaBitacora({ agruTrab, datosFil, drillCod, drillNom, setDrillCod, setDrillNom, datos, drillSuc, drillArea }) {
  const base = useMemo(()=>datos.filter(r=>(!drillSuc||r.sucursal_nombre===drillSuc)&&(!drillArea||r.departamento===drillArea)),[datos,drillSuc,drillArea])
  const trab = useMemo(()=>agruparTrab(base),[base])

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
              {t.excesos>0&&<Bd c="#FF3B30" bg="#FF3B3012">🚨 {t.excesos}</Bd>}
              {t.corridos>0&&<Bd c="#FF9500" bg="#FF950012">🔄 {t.corridos}</Bd>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )

  const dias = [...datosFil].sort((a,b)=>a.fecha<b.fecha?1:-1)
  const corridos = dias.filter(r=>r.estado_dia==='turno_corrido').length
  const pctCorr  = dias.length>0?Math.round(corridos/dias.length*100):0

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
        <button onClick={()=>{setDrillCod(null);setDrillNom(null)}} style={breadBtn}>← Todos los trabajadores</button>
        <span style={{fontWeight:700,fontSize:16}}>{drillNom}</span>
      </div>
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
            {dias.map((r,i)=>(<FilaDia key={i} r={r}/>))}
            {dias.length===0&&<tr><td colSpan={8} style={{padding:24,textAlign:'center',color:'var(--text-muted)'}}>Sin jornadas en el período</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Una fila por día con detalle de marcajes expandible
function FilaDia({ r }) {
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
        <td style={{...tdS,fontSize:12,color:'var(--text-muted)'}}>{r.workshift_name||'—'}</td>
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
          </div>
        </td>
        <td style={{...tdS,color:'var(--text-muted)',fontSize:11,textAlign:'center'}}>
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
  const dias=rows.length,puntual=rows.filter(r=>r.estado_dia==='puntual').length
  const atrasos=rows.filter(r=>r.estado_dia==='atraso').length
  const extras=rows.filter(r=>r.estado_dia==='hizo_extra').length
  const corridos=rows.filter(r=>r.estado_dia==='turno_corrido').length
  const excesos=rows.filter(r=>(r.min_extra_dia||0)>LIMITE_EXTRA_MIN).length
  const minAtraso=rows.reduce((s,r)=>s+(r.min_atraso_contable||0),0)
  const minExtra=rows.reduce((s,r)=>s+(r.min_extra_dia||0),0)
  const pct=dias>0?Math.round(puntual/dias*100):0
  return {label,dias,puntual,atrasos,extras,corridos,excesos,minAtraso,minExtra,pct}
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
const presetBtn= {padding:'6px 12px',border:'1px solid var(--border)',borderRadius:100,cursor:'pointer',fontSize:12,fontWeight:500}
const inp      = {padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit'}
const breadBtn = {background:'none',border:'none',cursor:'pointer',color:'var(--accent)',fontSize:13,padding:'2px 4px',textDecoration:'underline'}
const breadBtnAct = {...breadBtn,fontWeight:700,color:'var(--text)',textDecoration:'none'}
const thS      = {padding:'10px 12px',textAlign:'left',fontWeight:600,fontSize:11,textTransform:'uppercase',letterSpacing:'0.04em',color:'var(--text-muted)',borderBottom:'1px solid var(--border)'}
const tdS      = {padding:'10px 12px',borderBottom:'1px solid var(--border)',verticalAlign:'middle'}
