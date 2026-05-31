// src/rrhh/asistencia/tabs/AsisJornadas.jsx
// Reporte de jornadas: atrasos, horas extra y diagnóstico de turnos.
// Fuente: v_asis_jornadas (SQL). Solo lectura — 1 sync, toda la info.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabase'

const fMin = m => {
  if (m == null) return '—'
  if (m === 0) return '0 min'
  const h = Math.floor(Math.abs(m) / 60)
  const min = Math.abs(m) % 60
  return h > 0 ? `${h}h ${min > 0 ? min + 'min' : ''}`.trim() : `${min}min`
}
const fHora = ts => {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}
const fFecha = d => {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' })
}
const hoy = () => new Date().toISOString().slice(0, 10)
const hace7 = () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10) }
const inicioMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` }
const inicioMesAnterior = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,10) }
const finMesAnterior = () => { const d = new Date(); d.setDate(0); return d.toISOString().slice(0,10) }

const ESTADO_CFG = {
  puntual:       { c: '#34C759', bg: '#34C75912', ic: '✅', l: 'Puntual' },
  hizo_extra:    { c: '#007AFF', bg: '#007AFF12', ic: '⏱', l: 'Horas extra' },
  atraso:        { c: '#FF3B30', bg: '#FF3B3012', ic: '⚠️', l: 'Atraso' },
  turno_corrido: { c: '#FF9500', bg: '#FF950012', ic: '🔄', l: 'Turno corrido' },
  incompleta:    { c: '#AF52DE', bg: '#AF52DE12', ic: '❓', l: 'Incompleta' },
  sin_marcas:    { c: '#8E8E93', bg: '#8E8E9312', ic: '⭕', l: 'Sin marcas' },
}

const RANGOS = [
  { k: '7d',    l: 'Últimos 7 días',   desde: hace7,              hasta: hoy },
  { k: 'mes',   l: 'Este mes',         desde: inicioMes,          hasta: hoy },
  { k: 'mant',  l: 'Mes anterior',     desde: inicioMesAnterior,  hasta: finMesAnterior },
  { k: 'libre', l: 'Rango libre',      desde: hace7,              hasta: hoy },
]

export function AsisJornadas({ cu, onIrASync }) {
  const [fil, setFil]         = useState({ rango: '7d', desde: hace7(), hasta: hoy(), sucursal: 'todas', area: 'todas' })
  const [datos, setDatos]     = useState([])
  const [cargando, setCargando] = useState(true)
  const [nivel, setNivel]     = useState('sucursal') // sucursal | area | trabajador | bitacora
  const [drillSuc, setDrillSuc] = useState(null)
  const [drillArea, setDrillArea] = useState(null)
  const [drillCod, setDrillCod] = useState(null)
  const [drillNombre, setDrillNombre] = useState(null)
  const [sucursales, setSucursales] = useState([])
  const [areas, setAreas] = useState([])

  useEffect(() => { cargar() }, [fil.desde, fil.hasta])

  async function cargar() {
    setCargando(true)
    try {
      const { data, error } = await supabase
        .from('v_asis_jornadas')
        .select('*')
        .gte('fecha', fil.desde)
        .lte('fecha', fil.hasta)
        .order('fecha', { ascending: false })
      if (error) throw error
      setDatos(data || [])
      // Extraer sucursales y áreas únicas
      const sucs = [...new Set((data||[]).map(r => r.sucursal_nombre).filter(Boolean))].sort()
      const ars  = [...new Set((data||[]).map(r => r.departamento).filter(Boolean))].sort()
      setSucursales(sucs)
      setAreas(ars)
    } catch(e) { console.error(e) }
    finally { setCargando(false) }
  }

  function aplicarRango(k) {
    const r = RANGOS.find(x => x.k === k)
    if (!r) return
    setFil(f => ({ ...f, rango: k, desde: r.desde(), hasta: r.hasta() }))
    resetDrill()
  }

  function resetDrill() {
    setNivel('sucursal')
    setDrillSuc(null); setDrillArea(null); setDrillCod(null); setDrillNombre(null)
  }

  // Datos filtrados según el drill actual
  const datosFil = useMemo(() => {
    let d = datos
    if (drillSuc)  d = d.filter(r => r.sucursal_nombre === drillSuc)
    if (drillArea) d = d.filter(r => r.departamento === drillArea)
    if (drillCod)  d = d.filter(r => r.cod_contaline === drillCod)
    return d
  }, [datos, drillSuc, drillArea, drillCod])

  // Agregar por sucursal
  const porSucursal = useMemo(() => agrupar(datos, 'sucursal_nombre'), [datos])

  // Agregar por área (dentro de sucursal seleccionada)
  const porArea = useMemo(() => {
    const d = drillSuc ? datos.filter(r => r.sucursal_nombre === drillSuc) : datos
    return agrupar(d, 'departamento')
  }, [datos, drillSuc])

  // Agregar por trabajador (dentro de área seleccionada)
  const porTrabajador = useMemo(() => {
    let d = datos
    if (drillSuc) d = d.filter(r => r.sucursal_nombre === drillSuc)
    if (drillArea) d = d.filter(r => r.departamento === drillArea)
    return agruparTrabajador(d)
  }, [datos, drillSuc, drillArea])

  const sinDatos = !cargando && datos.length === 0

  if (sinDatos) return (
    <div style={{maxWidth:500,margin:'60px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'48px 32px'}}>
      <div style={{fontSize:56,marginBottom:16}}>📊</div>
      <h2 style={{margin:'0 0 8px 0',fontSize:20,fontWeight:700}}>Sin datos de jornadas</h2>
      <p style={{color:'var(--text-muted)',fontSize:14,lineHeight:1.5,margin:'0 0 24px 0'}}>
        Primero sincroniza marcaciones y horarios desde Config → Sincronización.
      </p>
      <button onClick={onIrASync} style={btnPri}>Ir a Sincronización →</button>
    </div>
  )

  return (
    <div>
      {/* Header + filtros */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:12}}>
        <div>
          <h2 style={{fontSize:22,fontWeight:700,margin:0}}>Jornadas y Asistencia</h2>
          <div style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>
            {datos.length.toLocaleString('es-CL')} registros · {fil.desde} → {fil.hasta}
          </div>
        </div>
        <button onClick={cargar} style={btnSec}>🔄 Actualizar</button>
      </div>

      {/* Selector de rango */}
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
        {RANGOS.map(r => (
          <button key={r.k} onClick={() => aplicarRango(r.k)} style={{
            ...presetBtn,
            background: fil.rango === r.k ? 'var(--accent)15' : 'transparent',
            color: fil.rango === r.k ? 'var(--accent)' : 'var(--text)',
            borderColor: fil.rango === r.k ? 'var(--accent)' : 'var(--border)'
          }}>{r.l}</button>
        ))}
        {fil.rango === 'libre' && (
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <input type="date" value={fil.desde} onChange={e => setFil(f => ({...f,desde:e.target.value}))} style={inputSm}/>
            <span style={{color:'var(--text-muted)'}}>→</span>
            <input type="date" value={fil.hasta} onChange={e => setFil(f => ({...f,hasta:e.target.value}))} style={inputSm}/>
            <button onClick={cargar} style={btnSec}>Buscar</button>
          </div>
        )}
      </div>

      {/* KPIs globales */}
      <KpiRow datos={datos} />

      {/* Breadcrumb drill */}
      {nivel !== 'sucursal' && (
        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:12,fontSize:13,flexWrap:'wrap'}}>
          <button onClick={resetDrill} style={breadBtn}>Todas las sucursales</button>
          {drillSuc && <>
            <span style={{color:'var(--text-muted)'}}>›</span>
            <button onClick={() => { setNivel('area'); setDrillArea(null); setDrillCod(null) }} style={nivel==='area'?breadBtnAct:breadBtn}>{drillSuc}</button>
          </>}
          {drillArea && <>
            <span style={{color:'var(--text-muted)'}}>›</span>
            <button onClick={() => { setNivel('trabajador'); setDrillCod(null) }} style={nivel==='trabajador'?breadBtnAct:breadBtn}>{drillArea}</button>
          </>}
          {drillNombre && <>
            <span style={{color:'var(--text-muted)'}}>›</span>
            <span style={{fontWeight:600,color:'var(--text)'}}>{drillNombre}</span>
          </>}
        </div>
      )}

      {/* Contenido según nivel */}
      {cargando ? (
        <div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</div>
      ) : nivel === 'sucursal' ? (
        <TablaAgregada
          rows={porSucursal}
          colLabel="Sucursal"
          onDrill={suc => { setDrillSuc(suc); setNivel('area') }}
        />
      ) : nivel === 'area' ? (
        <TablaAgregada
          rows={porArea}
          colLabel="Área / Departamento"
          onDrill={area => { setDrillArea(area); setNivel('trabajador') }}
        />
      ) : nivel === 'trabajador' ? (
        <TablaTrabajadores
          rows={porTrabajador}
          onDrill={(cod, nombre) => { setDrillCod(cod); setDrillNombre(nombre); setNivel('bitacora') }}
        />
      ) : nivel === 'bitacora' ? (
        <BitacoraTrabajador rows={datosFil} nombre={drillNombre} />
      ) : null}
    </div>
  )
}

// ─── KPIs GLOBALES ───────────────────────────────────────────────────────────
function KpiRow({ datos }) {
  const tot       = datos.length
  const atrasos   = datos.filter(r => r.estado_dia === 'atraso').length
  const extras    = datos.filter(r => r.estado_dia === 'hizo_extra').length
  const corridos  = datos.filter(r => r.estado_dia === 'turno_corrido').length
  const incompl   = datos.filter(r => r.estado_dia === 'incompleta' || r.estado_dia === 'sin_marcas').length
  const minAtraso = datos.reduce((s,r) => s + (r.min_atraso_contable||0), 0)
  const minExtra  = datos.reduce((s,r) => s + (r.min_despues_turno_contable||0), 0)
  const pct       = tot > 0 ? Math.round((datos.filter(r => r.estado_dia === 'puntual').length / tot) * 100) : 0

  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:20}}>
      <Kpi ic="✅" l="Puntualidad" v={pct + '%'} sub={`${datos.filter(r=>r.estado_dia==='puntual').length} días puntuales`} c="var(--success,#34C759)"/>
      <Kpi ic="⚠️" l="Atrasos" v={atrasos} sub={fMin(minAtraso) + ' acum.'} c="#FF3B30"/>
      <Kpi ic="⏱" l="Horas extra" v={extras} sub={fMin(minExtra) + ' acum.'} c="var(--accent,#007AFF)"/>
      <Kpi ic="🔄" l="Turno corrido" v={corridos} sub="Revisar en Workera" c="#FF9500"/>
      <Kpi ic="❓" l="Incompletas" v={incompl} sub="Sin entrada o salida" c="#AF52DE"/>
    </div>
  )
}

function Kpi({ ic, l, v, sub, c }) {
  return (
    <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 16px'}}>
      <div style={{fontSize:22,marginBottom:4}}>{ic}</div>
      <div style={{fontSize:26,fontWeight:800,color:c}}>{v}</div>
      <div style={{fontSize:12,fontWeight:600,marginTop:2}}>{l}</div>
      <div style={{fontSize:11,color:'var(--text-muted)'}}>{sub}</div>
    </div>
  )
}

// ─── TABLA AGREGADA (sucursal o área) ────────────────────────────────────────
function TablaAgregada({ rows, colLabel, onDrill }) {
  const [sort, setSort] = useState({ col: 'atrasos', dir: -1 })
  const tog = col => setSort(s => ({ col, dir: s.col === col ? -s.dir : -1 }))
  const sorted = [...rows].sort((a,b) => (a[sort.col] - b[sort.col]) * sort.dir)
  const Th = ({ k, l }) => (
    <th style={th} onClick={() => tog(k)}>
      {l} {sort.col === k ? (sort.dir === -1 ? '↓' : '↑') : ''}
    </th>
  )
  return (
    <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
      <table style={tbl}>
        <thead>
          <tr style={trHead}>
            <th style={th}>{colLabel}</th>
            <Th k="dias" l="Días" />
            <Th k="puntualidad" l="% Puntual" />
            <Th k="atrasos" l="Atrasos" />
            <Th k="minAtraso" l="Min. atraso" />
            <Th k="extras" l="Con extra" />
            <Th k="minExtra" l="Min. extra" />
            <Th k="corridos" l="Corridos ⚠️" />
            <Th k="incompletas" l="Incompl." />
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.label} style={{cursor:'pointer'}} onClick={() => onDrill(r.label)}
              onMouseOver={e=>e.currentTarget.style.background='var(--bg-app)'}
              onMouseOut={e=>e.currentTarget.style.background='transparent'}>
              <td style={{...td,fontWeight:700}}>{r.label}</td>
              <td style={td}>{r.dias}</td>
              <td style={td}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <div style={{width:48,height:6,borderRadius:3,background:'var(--border)',overflow:'hidden'}}>
                    <div style={{width:r.puntualidad+'%',height:'100%',background:'var(--success,#34C759)',borderRadius:3}}/>
                  </div>
                  <span style={{fontSize:12,fontWeight:600,color:r.puntualidad>=80?'var(--success,#34C759)':r.puntualidad>=60?'#FF9500':'#FF3B30'}}>
                    {r.puntualidad}%
                  </span>
                </div>
              </td>
              <td style={td}><Bd c={r.atrasos>0?'#FF3B30':'var(--text-muted)'} bg={r.atrasos>0?'#FF3B3012':'var(--bg-app)'}>{r.atrasos}</Bd></td>
              <td style={{...td,color:r.minAtraso>0?'#FF3B30':'var(--text-muted)'}}>{fMin(r.minAtraso)}</td>
              <td style={td}><Bd c={r.extras>0?'#007AFF':'var(--text-muted)'} bg={r.extras>0?'#007AFF12':'var(--bg-app)'}>{r.extras}</Bd></td>
              <td style={{...td,color:r.minExtra>0?'#007AFF':'var(--text-muted)'}}>{fMin(r.minExtra)}</td>
              <td style={td}>
                {r.corridos > 0
                  ? <Bd c="#FF9500" bg="#FF950012">⚠️ {r.corridos}</Bd>
                  : <span style={{color:'var(--text-muted)'}}>—</span>}
              </td>
              <td style={td}>{r.incompletas > 0 ? <Bd c="#AF52DE" bg="#AF52DE12">{r.incompletas}</Bd> : '—'}</td>
              <td style={{...td,color:'var(--accent)',fontWeight:600}}>Ver →</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── TABLA POR TRABAJADOR ────────────────────────────────────────────────────
function TablaTrabajadores({ rows, onDrill }) {
  const [sort, setSort] = useState({ col: 'atrasos', dir: -1 })
  const tog = col => setSort(s => ({ col, dir: s.col === col ? -s.dir : -1 }))
  const sorted = [...rows].sort((a,b) => (a[sort.col] - b[sort.col]) * sort.dir)
  const Th = ({ k, l }) => (
    <th style={th} onClick={() => tog(k)}>{l} {sort.col===k?(sort.dir===-1?'↓':'↑'):''}</th>
  )
  return (
    <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
      <table style={tbl}>
        <thead>
          <tr style={trHead}>
            <th style={th}>Trabajador</th>
            <Th k="dias" l="Días" />
            <Th k="puntualidad" l="% Puntual" />
            <Th k="atrasos" l="Atrasos" />
            <Th k="minAtraso" l="Min. atraso" />
            <Th k="extras" l="Con extra" />
            <Th k="minExtra" l="Min. extra" />
            <Th k="corridos" l="Corridos ⚠️" />
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.cod} style={{cursor:'pointer'}} onClick={() => onDrill(r.cod, r.nombre)}
              onMouseOver={e=>e.currentTarget.style.background='var(--bg-app)'}
              onMouseOut={e=>e.currentTarget.style.background='transparent'}>
              <td style={td}>
                <div style={{fontWeight:600,fontSize:13}}>{r.nombre}</div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>{r.workshift}</div>
              </td>
              <td style={td}>{r.dias}</td>
              <td style={td}>
                <span style={{fontWeight:700,color:r.puntualidad>=80?'var(--success,#34C759)':r.puntualidad>=60?'#FF9500':'#FF3B30'}}>
                  {r.puntualidad}%
                </span>
              </td>
              <td style={td}>{r.atrasos > 0 ? <Bd c="#FF3B30" bg="#FF3B3012">{r.atrasos} días</Bd> : '—'}</td>
              <td style={{...td,color:r.minAtraso>0?'#FF3B30':'var(--text-muted)'}}>{fMin(r.minAtraso)}</td>
              <td style={td}>{r.extras > 0 ? <Bd c="#007AFF" bg="#007AFF12">{r.extras} días</Bd> : '—'}</td>
              <td style={{...td,color:r.minExtra>0?'#007AFF':'var(--text-muted)'}}>{fMin(r.minExtra)}</td>
              <td style={td}>
                {r.corridos > 0
                  ? <Bd c="#FF9500" bg="#FF950012">⚠️ {r.corridos}</Bd>
                  : '—'}
              </td>
              <td style={{...td,color:'var(--accent)',fontWeight:600}}>Bitácora →</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── BITÁCORA INDIVIDUAL ─────────────────────────────────────────────────────
function BitacoraTrabajador({ rows, nombre }) {
  const sorted = [...rows].sort((a,b) => a.fecha < b.fecha ? 1 : -1)
  const corridos = rows.filter(r => r.estado_dia === 'turno_corrido').length
  const diasTot  = rows.length

  return (
    <div>
      {/* Alerta turno corrido */}
      {corridos > 0 && corridos / diasTot >= 0.4 && (
        <div style={{marginBottom:14,padding:'12px 16px',borderRadius:10,background:'#FF950012',border:'1px solid #FF950040',display:'flex',alignItems:'center',gap:10,fontSize:13}}>
          <span style={{fontSize:20}}>🔄</span>
          <div>
            <div style={{fontWeight:700,color:'#FF9500'}}>Posible turno mal asignado</div>
            <div style={{color:'var(--text-muted)',fontSize:12}}>
              {corridos} de {diasTot} días aparecen como "turno corrido" — el horario en Workera podría no reflejar la jornada real de {nombre?.split(' ')[0]}.
              Revisar asignación de turno en <strong>Workera → Control de Asistencia → Horarios y Turnos</strong>.
            </div>
          </div>
        </div>
      )}

      <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
        <table style={tbl}>
          <thead>
            <tr style={trHead}>
              <th style={th}>Fecha</th>
              <th style={th}>Turno</th>
              <th style={{...th,textAlign:'center'}}>Esperado</th>
              <th style={{...th,textAlign:'center'}}>Real</th>
              <th style={{...th,textAlign:'right'}}>Atraso</th>
              <th style={{...th,textAlign:'right'}}>Extra</th>
              <th style={th}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r,i) => {
              const est = ESTADO_CFG[r.estado_dia] || ESTADO_CFG.sin_marcas
              return (
                <tr key={i} style={{background: r.estado_dia==='turno_corrido'?'#FF950006':undefined}}>
                  <td style={{...td,fontWeight:500,whiteSpace:'nowrap'}}>{fFecha(r.fecha)}</td>
                  <td style={{...td,fontSize:12,color:'var(--text-muted)'}}>{r.workshift_name || '—'}</td>
                  <td style={{...td,textAlign:'center',fontSize:12,fontFamily:'monospace'}}>
                    {fHora(r.entrada_esperada)} → {fHora(r.salida_esperada)}
                  </td>
                  <td style={{...td,textAlign:'center',fontSize:12,fontFamily:'monospace'}}>
                    {r.entrada_real ? fHora(r.entrada_real) : '—'} → {r.salida_real ? fHora(r.salida_real) : '—'}
                  </td>
                  <td style={{...td,textAlign:'right',fontWeight:600,color:r.min_atraso_contable>0?'#FF3B30':'var(--text-muted)'}}>
                    {r.min_atraso_contable > 0 ? '+' + fMin(r.min_atraso_contable) : '—'}
                  </td>
                  <td style={{...td,textAlign:'right',fontWeight:600,color:r.min_despues_turno_contable>0?'#007AFF':'var(--text-muted)'}}>
                    {r.min_despues_turno_contable > 0 ? '+' + fMin(r.min_despues_turno_contable) : '—'}
                  </td>
                  <td style={td}>
                    <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:100,background:est.bg,color:est.c,whiteSpace:'nowrap'}}>
                      {est.ic} {est.l}
                    </span>
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

// ─── HELPERS DE AGRUPACIÓN ───────────────────────────────────────────────────
function agrupar(datos, campo) {
  const map = {}
  for (const r of datos) {
    const k = r[campo] || 'Sin asignar'
    if (!map[k]) map[k] = []
    map[k].push(r)
  }
  return Object.entries(map).map(([label, rows]) => calcMetricas(label, rows))
}

function agruparTrabajador(datos) {
  const map = {}
  for (const r of datos) {
    const k = r.cod_contaline
    if (!map[k]) map[k] = []
    map[k].push(r)
  }
  return Object.entries(map).map(([cod, rows]) => ({
    cod: Number(cod),
    nombre: rows[0].empleado || 'Sin nombre',
    workshift: rows[0].workshift_name,
    ...calcMetricas(cod, rows)
  }))
}

function calcMetricas(label, rows) {
  const dias        = rows.length
  const puntuales   = rows.filter(r => r.estado_dia === 'puntual').length
  const atrasos     = rows.filter(r => r.estado_dia === 'atraso').length
  const extras      = rows.filter(r => r.estado_dia === 'hizo_extra').length
  const corridos    = rows.filter(r => r.estado_dia === 'turno_corrido').length
  const incompletas = rows.filter(r => r.estado_dia === 'incompleta' || r.estado_dia === 'sin_marcas').length
  const minAtraso   = rows.reduce((s,r) => s + (r.min_atraso_contable||0), 0)
  const minExtra    = rows.reduce((s,r) => s + (r.min_despues_turno_contable||0), 0)
  const puntualidad = dias > 0 ? Math.round((puntuales / dias) * 100) : 0
  return { label, dias, puntuales, atrasos, extras, corridos, incompletas, minAtraso, minExtra, puntualidad }
}

// ─── MICRO COMPONENTES ───────────────────────────────────────────────────────
function Bd({ c, bg, children }) {
  return <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:100,color:c,background:bg,display:'inline-block'}}>{children}</span>
}

// ─── ESTILOS ─────────────────────────────────────────────────────────────────
const btnPri    = {padding:'10px 20px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:600}
const btnSec    = {padding:'8px 14px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}
const presetBtn = {padding:'6px 12px',border:'1px solid var(--border)',borderRadius:100,cursor:'pointer',fontSize:12,fontWeight:500,transition:'all 0.15s'}
const inputSm   = {padding:'6px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit'}
const breadBtn  = {background:'none',border:'none',cursor:'pointer',color:'var(--accent)',fontSize:13,padding:'2px 4px',textDecoration:'underline'}
const breadBtnAct = {...breadBtn,fontWeight:700,color:'var(--text)',textDecoration:'none'}
const tbl       = {width:'100%',borderCollapse:'collapse',fontSize:13}
const trHead    = {background:'var(--bg-app)'}
const th        = {padding:'10px 12px',textAlign:'left',fontWeight:600,fontSize:11,textTransform:'uppercase',letterSpacing:'0.04em',color:'var(--text-muted)',borderBottom:'1px solid var(--border)',cursor:'pointer',userSelect:'none'}
const td        = {padding:'10px 12px',borderBottom:'1px solid var(--border)',verticalAlign:'middle'}
