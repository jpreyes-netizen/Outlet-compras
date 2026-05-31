// src/rrhh/asistencia/tabs/AsisHHEE.jsx
import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'

const PAGE_SIZE = 50

function fmtHoras(segundos) {
  if (!segundos) return '0h'
  const h = Math.floor(segundos / 3600)
  const m = Math.round((segundos % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function AsisHHEE({ cu, onIrASync }) {
  const [hhee, setHhee] = useState([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [pagina, setPagina] = useState(0)
  const [totalesGlobales, setTotalesGlobales] = useState(null)
  const [fil, setFil] = useState({
    desde: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10),
    hasta: new Date().toISOString().slice(0,10),
    sucursal: 'todas',
    soloAsignadas: false
  })
  const [sucursales, setSucursales] = useState([])

  useEffect(() => { supabase.from('sucursales').select('id,nombre').order('nombre').then(({data}) => setSucursales(data||[])) }, [])
  useEffect(() => { cargar() }, [fil, pagina])

  async function cargar() {
    setCargando(true)
    try {
      let q = supabase.from('v_asis_hhee').select('*', { count:'exact' })
        .gte('fecha_autorizada', fil.desde)
        .lte('fecha_autorizada', fil.hasta)
        .order('fecha_autorizada', { ascending: false })
        .range(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE - 1)

      if (fil.sucursal !== 'todas') q = q.eq('sucursal_id', fil.sucursal)
      if (fil.soloAsignadas) q = q.eq('asignado', true)

      const { data, count, error } = await q
      if (error) throw error
      setHhee(data || [])
      setTotal(count || 0)

      // Calcular totales del rango (sin paginar)
      if (pagina === 0) {
        let qTot = supabase.from('asis_horas_extras')
          .select('segundos_entrada,segundos_salida,segundos_sin_horario,segundos_festivo')
          .gte('fecha_autorizada', fil.desde)
          .lte('fecha_autorizada', fil.hasta)
        if (fil.sucursal !== 'todas') qTot = qTot.eq('sucursal_id', fil.sucursal)
        const { data: tots } = await qTot
        if (tots) {
          const t = tots.reduce((acc, h) => ({
            entrada:     acc.entrada     + (h.segundos_entrada || 0),
            salida:      acc.salida      + (h.segundos_salida || 0),
            sinHorario:  acc.sinHorario  + (h.segundos_sin_horario || 0),
            festivo:     acc.festivo     + (h.segundos_festivo || 0),
          }), { entrada:0, salida:0, sinHorario:0, festivo:0 })
          t.total = t.entrada + t.salida + t.sinHorario + t.festivo
          setTotalesGlobales(t)
        }
      }
    } catch(e) {
      console.error(e)
    } finally {
      setCargando(false)
    }
  }

  const totalPaginas = Math.ceil(total / PAGE_SIZE)
  const sinDatos = !cargando && total === 0 && pagina === 0 && fil.sucursal === 'todas' && !fil.soloAsignadas

  if (sinDatos) return <EstadoVacio onIrASync={onIrASync} />

  return (
    <div>
      <div style={{marginBottom:16}}>
        <h2 style={{fontSize:22,fontWeight:700,margin:'0 0 4px 0'}}>Horas Extras Autorizadas</h2>
        <div style={{fontSize:13,color:'var(--text-muted)'}}>{total.toLocaleString('es-CL')} autorizaciones en el rango</div>
      </div>

      {/* Totales del rango */}
      {totalesGlobales && totalesGlobales.total > 0 && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:16}}>
          <KPI label="Total HHEE" v={fmtHoras(totalesGlobales.total)} c="var(--accent)" />
          <KPI label="En entrada" v={fmtHoras(totalesGlobales.entrada)} c="var(--success)" />
          <KPI label="En salida" v={fmtHoras(totalesGlobales.salida)} c="var(--warning)" />
          <KPI label="Sin horario" v={fmtHoras(totalesGlobales.sinHorario)} c="var(--text-muted)" />
          <KPI label="Festivos" v={fmtHoras(totalesGlobales.festivo)} c="var(--danger)" />
        </div>
      )}

      {/* Filtros */}
      <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap',alignItems:'flex-end'}}>
        <div>
          <label style={lbl}>Desde</label>
          <input type="date" value={fil.desde} onChange={e => { setFil({...fil,desde:e.target.value}); setPagina(0) }} style={input} />
        </div>
        <div>
          <label style={lbl}>Hasta</label>
          <input type="date" value={fil.hasta} onChange={e => { setFil({...fil,hasta:e.target.value}); setPagina(0) }} style={input} />
        </div>
        <div>
          <label style={lbl}>Sucursal</label>
          <select value={fil.sucursal} onChange={e => { setFil({...fil,sucursal:e.target.value}); setPagina(0) }} style={input}>
            <option value="todas">Todas</option>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <label style={{display:'flex',alignItems:'center',gap:6,fontSize:13,cursor:'pointer',paddingBottom:2}}>
          <input type="checkbox" checked={fil.soloAsignadas} onChange={e => { setFil({...fil,soloAsignadas:e.target.checked}); setPagina(0) }} />
          Solo asignadas a jornada
        </label>
      </div>

      {/* Tabla */}
      <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
        <table style={tbl}>
          <thead>
            <tr style={trHead}>
              <th style={th}>Empleado</th>
              <th style={th}>Fecha</th>
              <th style={{...th,textAlign:'right'}}>Entrada</th>
              <th style={{...th,textAlign:'right'}}>Salida</th>
              <th style={{...th,textAlign:'right'}}>Sin horario</th>
              <th style={{...th,textAlign:'right'}}>Festivo</th>
              <th style={{...th,textAlign:'right'}}>Total</th>
              <th style={th}>Asignada</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={8} style={{padding:30,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</td></tr>
            ) : hhee.length === 0 ? (
              <tr><td colSpan={8} style={{padding:30,textAlign:'center',color:'var(--text-muted)'}}>Sin resultados</td></tr>
            ) : hhee.map(h => (
              <tr key={h.id}>
                <td style={td}>
                  <div style={{fontWeight:500}}>{h.empleado_nombre || <span style={{color:'var(--text-muted)',fontStyle:'italic'}}>Sin mapear</span>}</div>
                  <div style={{fontSize:11,color:'var(--text-muted)'}}>{h.sucursal_nombre}</div>
                </td>
                <td style={{...td,fontSize:12,whiteSpace:'nowrap'}}>{new Date(h.fecha_autorizada).toLocaleDateString('es-CL')}</td>
                <td style={{...td,textAlign:'right',fontSize:12}}>{fmtHoras(h.segundos_entrada)}</td>
                <td style={{...td,textAlign:'right',fontSize:12}}>{fmtHoras(h.segundos_salida)}</td>
                <td style={{...td,textAlign:'right',fontSize:12}}>{fmtHoras(h.segundos_sin_horario)}</td>
                <td style={{...td,textAlign:'right',fontSize:12}}>{fmtHoras(h.segundos_festivo)}</td>
                <td style={{...td,textAlign:'right',fontWeight:700,color:'var(--accent)'}}>{fmtHoras(h.segundos_total)}</td>
                <td style={td}>
                  <span style={{
                    fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:100,
                    background: h.asignado ? 'var(--success)15' : 'var(--text-muted)15',
                    color: h.asignado ? 'var(--success)' : 'var(--text-muted)'
                  }}>{h.asignado ? 'Si' : 'Pendiente'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPaginas > 1 && (
        <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:12,alignItems:'center'}}>
          <button onClick={() => setPagina(p => Math.max(0,p-1))} disabled={pagina===0} style={btnSec}>← Anterior</button>
          <span style={{fontSize:13,color:'var(--text-muted)'}}>Pag. {pagina+1} de {totalPaginas}</span>
          <button onClick={() => setPagina(p => Math.min(totalPaginas-1,p+1))} disabled={pagina>=totalPaginas-1} style={btnSec}>Siguiente →</button>
        </div>
      )}
    </div>
  )
}

function KPI({ label, v, c }) {
  return (
    <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px'}}>
      <div style={{fontSize:11,color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.04em'}}>{label}</div>
      <div style={{fontSize:22,fontWeight:800,color:c,marginTop:2}}>{v}</div>
    </div>
  )
}

function EstadoVacio({ onIrASync }) {
  return (
    <div style={{maxWidth:500,margin:'60px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'48px 32px'}}>
      <div style={{fontSize:56,marginBottom:16}}>⏱</div>
      <h2 style={{margin:'0 0 8px 0',fontSize:20,fontWeight:700}}>Sin horas extras registradas aun</h2>
      <p style={{color:'var(--text-muted)',fontSize:14,lineHeight:1.5,margin:'0 0 24px 0'}}>
        Sincroniza las horas extras autorizadas desde Workera para verlas aqui.
      </p>
      <button onClick={onIrASync} style={btnPri}>Ir a Sincronizacion →</button>
    </div>
  )
}

const lbl = {display:'block',fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.04em'}
const input = {padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit'}
const btnPri = {padding:'10px 20px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:600}
const btnSec = {padding:'7px 14px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}
const tbl = {width:'100%',borderCollapse:'collapse',fontSize:13}
const trHead = {background:'var(--bg-app)'}
const th = {padding:'10px 12px',textAlign:'left',fontWeight:600,fontSize:11,textTransform:'uppercase',letterSpacing:'0.04em',color:'var(--text-muted)',borderBottom:'1px solid var(--border)'}
const td = {padding:'10px 12px',borderBottom:'1px solid var(--border)',verticalAlign:'middle'}
