// src/rrhh/asistencia/tabs/AsisExtrasAtrasos.jsx
// Reporte de horas extra y atrasos con alerta legal (máx 2h extra/jornada).
// Export a Excel. Fuente: v_asis_jornadas.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabase'
import * as XLSX from 'xlsx'

// Límite legal Chile: 2 horas extra por jornada diaria
const LIMITE_EXTRA_DIA_MIN = 120

const fMin = m => {
  if (m == null) return '—'
  if (m === 0) return '0'
  const h = Math.floor(Math.abs(m) / 60)
  const min = Math.abs(m) % 60
  const s = m < 0 ? '-' : ''
  return h > 0 ? `${s}${h}h ${min > 0 ? min + 'm' : ''}`.trim() : `${s}${min}m`
}
const fHora = ts => ts ? new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—'
const fFecha = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' }) : '—'
const hoy = () => new Date().toISOString().slice(0, 10)
const hace7 = () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10) }
const inicioMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` }
const inicioMesAnt = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,10) }
const finMesAnt = () => { const d = new Date(); d.setDate(0); return d.toISOString().slice(0,10) }

const RANGOS = [
  { k: '7d',   l: 'Últimos 7 días', desde: hace7,       hasta: hoy },
  { k: 'mes',  l: 'Este mes',       desde: inicioMes,   hasta: hoy },
  { k: 'mant', l: 'Mes anterior',   desde: inicioMesAnt,hasta: finMesAnt },
  { k: 'libre',l: 'Rango libre',    desde: hace7,       hasta: hoy },
]

export function AsisExtrasAtrasos({ cu, onIrASync }) {
  const [fil, setFil] = useState({ rango: 'mes', desde: inicioMes(), hasta: hoy(), sucursal: 'todas', tipo: 'todos' })
  const [datos, setDatos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [expandido, setExpandido] = useState(null)

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
    } catch(e) { console.error(e) }
    finally { setCargando(false) }
  }

  function aplicarRango(k) {
    const r = RANGOS.find(x => x.k === k)
    if (!r) return
    setFil(f => ({ ...f, rango: k, desde: r.desde(), hasta: r.hasta() }))
  }

  const sucursales = useMemo(() =>
    [...new Set(datos.map(r => r.sucursal_nombre).filter(Boolean))].sort(), [datos])

  // Filtrar por sucursal
  const datosFil = useMemo(() => {
    let d = datos
    if (fil.sucursal !== 'todas') d = d.filter(r => r.sucursal_nombre === fil.sucursal)
    return d
  }, [datos, fil.sucursal])

  // Agrupar por trabajador con métricas de extra y atraso
  const porTrabajador = useMemo(() => {
    const map = {}
    for (const r of datosFil) {
      const k = r.cod_contaline
      if (!map[k]) map[k] = {
        cod: k, nombre: r.empleado || 'Sin nombre',
        sucursal: r.sucursal_nombre, area: r.departamento,
        dias: [], minExtra: 0, minAtraso: 0, diasExceso: 0, diasAtraso: 0, diasExtra: 0
      }
      const o = map[k]
      o.dias.push(r)
      o.minExtra  += (r.min_extra_dia || 0)
      o.minAtraso += (r.min_atraso_contable || 0)
      if ((r.min_extra_dia || 0) > LIMITE_EXTRA_DIA_MIN) o.diasExceso++
      if ((r.min_atraso_contable || 0) > 0) o.diasAtraso++
      if ((r.min_extra_dia || 0) > 0) o.diasExtra++
    }
    let arr = Object.values(map)
    if (fil.tipo === 'extra')   arr = arr.filter(t => t.minExtra > 0)
    if (fil.tipo === 'atraso')  arr = arr.filter(t => t.minAtraso > 0)
    if (fil.tipo === 'exceso')  arr = arr.filter(t => t.diasExceso > 0)
    return arr.sort((a,b) => b.minExtra - a.minExtra)
  }, [datosFil, fil.tipo])

  // Totales
  const tot = useMemo(() => ({
    minExtra:   porTrabajador.reduce((s,t) => s + t.minExtra, 0),
    minAtraso:  porTrabajador.reduce((s,t) => s + t.minAtraso, 0),
    diasExceso: porTrabajador.reduce((s,t) => s + t.diasExceso, 0),
    conExtra:   porTrabajador.filter(t => t.minExtra > 0).length,
    conAtraso:  porTrabajador.filter(t => t.minAtraso > 0).length,
    conExceso:  porTrabajador.filter(t => t.diasExceso > 0).length,
  }), [porTrabajador])

  function exportarExcel() {
    // Hoja 1: Resumen por trabajador
    const resumen = porTrabajador.map(t => ({
      'Trabajador': t.nombre,
      'Sucursal': t.sucursal,
      'Área': t.area,
      'Días con extra': t.diasExtra,
      'Total horas extra': fMin(t.minExtra),
      'Min extra (num)': t.minExtra,
      'Días con atraso': t.diasAtraso,
      'Total atraso': fMin(t.minAtraso),
      'Min atraso (num)': t.minAtraso,
      'Días exceso legal (>2h)': t.diasExceso,
    }))

    // Hoja 2: Detalle día por día (solo días con extra o atraso)
    const detalle = datosFil
      .filter(r => (r.min_extra_dia||0) > 0 || (r.min_atraso_contable||0) > 0)
      .sort((a,b) => (a.empleado||'').localeCompare(b.empleado||'') || (a.fecha < b.fecha ? -1 : 1))
      .map(r => ({
        'Trabajador': r.empleado,
        'Sucursal': r.sucursal_nombre,
        'Área': r.departamento,
        'Fecha': r.fecha,
        'Turno': r.workshift_name,
        'Entrada esperada': fHora(r.entrada_esperada),
        'Entrada real': fHora(r.entrada_real),
        'Salida esperada': fHora(r.salida_esperada),
        'Salida real': fHora(r.salida_real),
        'Atraso': fMin(r.min_atraso_contable),
        'Extra antes turno': fMin(r.min_antes_turno_contable),
        'Extra después turno': fMin(r.min_despues_turno_contable),
        'Extra total día': fMin(r.min_extra_dia),
        'Excede 2h legal': (r.min_extra_dia||0) > LIMITE_EXTRA_DIA_MIN ? 'SÍ' : '',
        'Estado': r.estado_dia,
      }))

    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.json_to_sheet(resumen)
    const ws2 = XLSX.utils.json_to_sheet(detalle)
    ws1['!cols'] = [{wch:28},{wch:14},{wch:24},{wch:14},{wch:16},{wch:14},{wch:14},{wch:14},{wch:14},{wch:18}]
    ws2['!cols'] = [{wch:28},{wch:14},{wch:24},{wch:12},{wch:8},{wch:14},{wch:14},{wch:14},{wch:14},{wch:10},{wch:14},{wch:16},{wch:14},{wch:14},{wch:14}]
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumen')
    XLSX.utils.book_append_sheet(wb, ws2, 'Detalle')
    XLSX.writeFile(wb, `extras_atrasos_${fil.desde}_${fil.hasta}.xlsx`)
  }

  const sinDatos = !cargando && datos.length === 0
  if (sinDatos) return (
    <div style={{maxWidth:500,margin:'60px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'48px 32px'}}>
      <div style={{fontSize:56,marginBottom:16}}>⏱</div>
      <h2 style={{margin:'0 0 8px 0',fontSize:20,fontWeight:700}}>Sin datos</h2>
      <p style={{color:'var(--text-muted)',fontSize:14,margin:'0 0 24px 0'}}>Sincroniza marcaciones y horarios primero.</p>
      <button onClick={onIrASync} style={btnPri}>Ir a Sincronización →</button>
    </div>
  )

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:12}}>
        <div>
          <h2 style={{fontSize:22,fontWeight:700,margin:0}}>Horas Extra y Atrasos</h2>
          <div style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>
            {fil.desde} → {fil.hasta} · límite legal 2h extra/jornada
          </div>
        </div>
        <button onClick={exportarExcel} style={btnExcel}>📥 Exportar Excel</button>
      </div>

      {/* Rango + filtros */}
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        {RANGOS.map(r => (
          <button key={r.k} onClick={() => aplicarRango(r.k)} style={{
            ...presetBtn,
            background: fil.rango===r.k?'var(--accent)15':'transparent',
            color: fil.rango===r.k?'var(--accent)':'var(--text)',
            borderColor: fil.rango===r.k?'var(--accent)':'var(--border)'
          }}>{r.l}</button>
        ))}
        {fil.rango === 'libre' && (
          <>
            <input type="date" value={fil.desde} onChange={e=>setFil(f=>({...f,desde:e.target.value}))} style={inputSm}/>
            <span style={{color:'var(--text-muted)'}}>→</span>
            <input type="date" value={fil.hasta} onChange={e=>setFil(f=>({...f,hasta:e.target.value}))} style={inputSm}/>
            <button onClick={cargar} style={btnSec}>Buscar</button>
          </>
        )}
      </div>
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        <select value={fil.sucursal} onChange={e=>setFil(f=>({...f,sucursal:e.target.value}))} style={inputSm}>
          <option value="todas">Todas las sucursales</option>
          {sucursales.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={fil.tipo} onChange={e=>setFil(f=>({...f,tipo:e.target.value}))} style={inputSm}>
          <option value="todos">Todos</option>
          <option value="extra">Solo con horas extra</option>
          <option value="atraso">Solo con atrasos</option>
          <option value="exceso">Solo con exceso legal (&gt;2h)</option>
        </select>
      </div>

      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginBottom:20}}>
        <Kpi ic="⏱" l="Total horas extra" v={fMin(tot.minExtra)} sub={`${tot.conExtra} trabajadores`} c="var(--accent,#007AFF)"/>
        <Kpi ic="⚠️" l="Total atrasos" v={fMin(tot.minAtraso)} sub={`${tot.conAtraso} trabajadores`} c="#FF3B30"/>
        <Kpi ic="🚨" l="Exceso legal >2h" v={tot.diasExceso} sub={`${tot.conExceso} trabajadores`} c="#FF3B30" alerta={tot.diasExceso>0}/>
      </div>

      {/* Alerta legal global */}
      {tot.diasExceso > 0 && (
        <div style={{marginBottom:16,padding:'12px 16px',borderRadius:10,background:'#FF3B3010',border:'1px solid #FF3B3040',display:'flex',gap:10,alignItems:'center',fontSize:13}}>
          <span style={{fontSize:20}}>🚨</span>
          <div>
            <div style={{fontWeight:700,color:'#FF3B30'}}>Exceso de horas extra legales</div>
            <div style={{color:'var(--text-muted)',fontSize:12}}>
              Hay {tot.diasExceso} jornada(s) que superan el máximo legal de 2 horas extra diarias en {tot.conExceso} trabajador(es). Revisar para cumplimiento normativo.
            </div>
          </div>
        </div>
      )}

      {/* Tabla trabajadores */}
      {cargando ? (
        <div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</div>
      ) : (
        <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
          <table style={tbl}>
            <thead>
              <tr style={trHead}>
                <th style={th}>Trabajador</th>
                <th style={th}>Sucursal · Área</th>
                <th style={{...th,textAlign:'right'}}>Días extra</th>
                <th style={{...th,textAlign:'right'}}>Total extra</th>
                <th style={{...th,textAlign:'right'}}>Días atraso</th>
                <th style={{...th,textAlign:'right'}}>Total atraso</th>
                <th style={{...th,textAlign:'center'}}>Exceso 2h</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {porTrabajador.map(t => (
                <FilaTrabajador key={t.cod} t={t} expandido={expandido === t.cod}
                  onToggle={() => setExpandido(expandido === t.cod ? null : t.cod)} />
              ))}
              {porTrabajador.length === 0 && (
                <tr><td colSpan={8} style={{padding:30,textAlign:'center',color:'var(--text-muted)'}}>Sin resultados para el filtro aplicado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FilaTrabajador({ t, expandido, onToggle }) {
  return (
    <>
      <tr style={{cursor:'pointer',background: t.diasExceso>0?'#FF3B3008':undefined}} onClick={onToggle}>
        <td style={{...td,fontWeight:600}}>{t.nombre}</td>
        <td style={{...td,fontSize:12,color:'var(--text-muted)'}}>{t.sucursal} · {t.area}</td>
        <td style={{...td,textAlign:'right'}}>{t.diasExtra || '—'}</td>
        <td style={{...td,textAlign:'right',fontWeight:600,color:t.minExtra>0?'var(--accent)':'var(--text-muted)'}}>{fMin(t.minExtra)}</td>
        <td style={{...td,textAlign:'right'}}>{t.diasAtraso || '—'}</td>
        <td style={{...td,textAlign:'right',fontWeight:600,color:t.minAtraso>0?'#FF3B30':'var(--text-muted)'}}>{fMin(t.minAtraso)}</td>
        <td style={{...td,textAlign:'center'}}>
          {t.diasExceso > 0
            ? <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:100,background:'#FF3B3015',color:'#FF3B30'}}>🚨 {t.diasExceso}</span>
            : <span style={{color:'var(--text-muted)'}}>—</span>}
        </td>
        <td style={{...td,color:'var(--accent)',fontWeight:600,textAlign:'center'}}>{expandido?'▲':'▼'}</td>
      </tr>
      {expandido && (
        <tr>
          <td colSpan={8} style={{padding:0,background:'var(--bg-app)'}}>
            <DetalleDias dias={t.dias} />
          </td>
        </tr>
      )}
    </>
  )
}

function DetalleDias({ dias }) {
  const relevantes = dias
    .filter(r => (r.min_extra_dia||0) > 0 || (r.min_atraso_contable||0) > 0)
    .sort((a,b) => a.fecha < b.fecha ? 1 : -1)
  if (relevantes.length === 0) return (
    <div style={{padding:'12px 16px',fontSize:12,color:'var(--text-muted)'}}>Sin días con extra ni atraso en el período.</div>
  )
  return (
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead>
        <tr>
          <th style={tdSub}>Fecha</th>
          <th style={tdSub}>Esperado</th>
          <th style={tdSub}>Real</th>
          <th style={{...tdSub,textAlign:'right'}}>Atraso</th>
          <th style={{...tdSub,textAlign:'right'}}>Extra día</th>
          <th style={tdSub}>Legal</th>
        </tr>
      </thead>
      <tbody>
        {relevantes.map((r,i) => (
          <tr key={i}>
            <td style={tdSub}>{fFecha(r.fecha)}</td>
            <td style={{...tdSub,fontFamily:'monospace'}}>{fHora(r.entrada_esperada)} → {fHora(r.salida_esperada)}</td>
            <td style={{...tdSub,fontFamily:'monospace'}}>{fHora(r.entrada_real)} → {fHora(r.salida_real)}</td>
            <td style={{...tdSub,textAlign:'right',color:r.min_atraso_contable>0?'#FF3B30':'var(--text-muted)'}}>{r.min_atraso_contable>0?fMin(r.min_atraso_contable):'—'}</td>
            <td style={{...tdSub,textAlign:'right',fontWeight:600,color:r.min_extra_dia>0?'var(--accent)':'var(--text-muted)'}}>{r.min_extra_dia>0?fMin(r.min_extra_dia):'—'}</td>
            <td style={tdSub}>
              {(r.min_extra_dia||0) > 120
                ? <span style={{fontSize:10,fontWeight:700,color:'#FF3B30'}}>🚨 Excede</span>
                : <span style={{color:'var(--text-muted)'}}>OK</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Kpi({ ic, l, v, sub, c, alerta }) {
  return (
    <div style={{background: alerta?'#FF3B3008':'var(--bg-surface)',border:`1px solid ${alerta?'#FF3B3040':'var(--border)'}`,borderRadius:12,padding:'14px 16px'}}>
      <div style={{fontSize:22,marginBottom:4}}>{ic}</div>
      <div style={{fontSize:24,fontWeight:800,color:c}}>{v}</div>
      <div style={{fontSize:12,fontWeight:600,marginTop:2}}>{l}</div>
      <div style={{fontSize:11,color:'var(--text-muted)'}}>{sub}</div>
    </div>
  )
}

const btnPri    = {padding:'10px 20px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:600}
const btnSec    = {padding:'8px 14px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}
const btnExcel  = {padding:'9px 16px',background:'#1D6F42',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}
const presetBtn = {padding:'6px 12px',border:'1px solid var(--border)',borderRadius:100,cursor:'pointer',fontSize:12,fontWeight:500}
const inputSm   = {padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit'}
const tbl       = {width:'100%',borderCollapse:'collapse',fontSize:13}
const trHead    = {background:'var(--bg-app)'}
const th        = {padding:'10px 12px',textAlign:'left',fontWeight:600,fontSize:11,textTransform:'uppercase',letterSpacing:'0.04em',color:'var(--text-muted)',borderBottom:'1px solid var(--border)'}
const td        = {padding:'10px 12px',borderBottom:'1px solid var(--border)',verticalAlign:'middle'}
const tdSub     = {padding:'7px 16px',textAlign:'left',color:'var(--text-muted)',borderBottom:'1px solid var(--border)'}
