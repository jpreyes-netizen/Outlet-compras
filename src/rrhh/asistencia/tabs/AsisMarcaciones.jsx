// src/rrhh/asistencia/tabs/AsisMarcaciones.jsx
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabase'

const TIPO_LABEL = ['Entrada','Salida','Salida extra','Entrada extra','Inicio descanso','Fin descanso']
const ORIGEN_IC  = { RELOJ:'🕐', MOVIL:'📱', SISTEMA:'⚙️', PORTAL:'🖥', DESKTOP:'💻' }
const PAGE_SIZE  = 50

export function AsisMarcaciones({ cu, onIrASync }) {
  const [marcaciones, setMarcaciones] = useState([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [pagina, setPagina] = useState(0)
  const [fil, setFil] = useState({
    desde: new Date(new Date().setDate(new Date().getDate()-7)).toISOString().slice(0,10),
    hasta: new Date().toISOString().slice(0,10),
    sucursal: 'todas',
    busqueda: ''
  })
  const [sucursales, setSucursales] = useState([])

  useEffect(() => { cargarSucursales() }, [])
  useEffect(() => { cargar() }, [fil, pagina])

  async function cargarSucursales() {
    const { data } = await supabase.from('sucursales').select('id,nombre').order('nombre')
    setSucursales(data || [])
  }

  async function cargar() {
    setCargando(true)
    try {
      let q = supabase.from('v_asis_marcaciones').select('*', { count:'exact' })
        .gte('fecha_hora', fil.desde + 'T00:00:00')
        .lte('fecha_hora', fil.hasta + 'T23:59:59')
        .order('fecha_hora', { ascending: false })
        .range(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE - 1)

      if (fil.sucursal !== 'todas') q = q.eq('sucursal_id', fil.sucursal)
      if (fil.busqueda) q = q.ilike('empleado_nombre', `%${fil.busqueda}%`)

      const { data, count, error } = await q
      if (error) throw error
      setMarcaciones(data || [])
      setTotal(count || 0)
    } catch(e) {
      console.error(e)
    } finally {
      setCargando(false)
    }
  }

  const totalPaginas = Math.ceil(total / PAGE_SIZE)
  const sinDatos = !cargando && total === 0 && pagina === 0 && fil.sucursal === 'todas' && !fil.busqueda

  if (sinDatos && marcaciones.length === 0) {
    return <EstadoVacio onIrASync={onIrASync} />
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <div>
          <h2 style={{fontSize:22,fontWeight:700,margin:0}}>Marcaciones</h2>
          <div style={{fontSize:13,color:'var(--text-muted)',marginTop:2}}>{total.toLocaleString('es-CL')} registros encontrados</div>
        </div>
      </div>

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
        <div style={{flex:1,minWidth:200}}>
          <label style={lbl}>Empleado</label>
          <input type="search" placeholder="Buscar nombre..." value={fil.busqueda}
            onChange={e => { setFil({...fil,busqueda:e.target.value}); setPagina(0) }} style={input} />
        </div>
      </div>

      {/* Tabla */}
      <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
        <table style={tbl}>
          <thead>
            <tr style={trHead}>
              <th style={th}>Fecha y hora</th>
              <th style={th}>Empleado</th>
              <th style={th}>Tipo</th>
              <th style={th}>Origen</th>
              <th style={th}>Sucursal</th>
              <th style={th}>Dispositivo</th>
              <th style={th}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={7} style={{padding:30,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</td></tr>
            ) : marcaciones.length === 0 ? (
              <tr><td colSpan={7} style={{padding:30,textAlign:'center',color:'var(--text-muted)'}}>Sin resultados para los filtros aplicados</td></tr>
            ) : marcaciones.map(m => (
              <tr key={m.id}>
                <td style={{...td,fontFamily:'monospace',fontSize:12,whiteSpace:'nowrap'}}>
                  {new Date(m.fecha_hora).toLocaleString('es-CL')}
                </td>
                <td style={td}>
                  <div style={{fontWeight:500}}>{m.empleado_nombre || <span style={{color:'var(--text-muted)',fontStyle:'italic'}}>Sin mapear</span>}</div>
                  {!m.cod_contaline && <div style={{fontSize:10,color:'var(--warning)'}}>workera: {m.workera_employee_code}</div>}
                </td>
                <td style={td}>
                  <span style={{
                    fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:100,
                    background: m.tipo===0 ? 'var(--success)15' : m.tipo===1 ? 'var(--danger)15' : 'var(--accent)15',
                    color: m.tipo===0 ? 'var(--success)' : m.tipo===1 ? 'var(--danger)' : 'var(--accent)'
                  }}>{TIPO_LABEL[m.tipo] || m.tipo}</span>
                </td>
                <td style={{...td,fontSize:13}}>
                  {ORIGEN_IC[m.origen_codigo] || '?'} {m.origen_codigo}
                  {m.is_mobile && <span style={{fontSize:10,color:'var(--text-muted)',marginLeft:4}}>GPS</span>}
                </td>
                <td style={{...td,fontSize:12,color:'var(--text-muted)'}}>{m.sucursal_nombre || '—'}</td>
                <td style={{...td,fontSize:11,color:'var(--text-muted)',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.dispositivo || '—'}</td>
                <td style={td}>
                  <span style={{
                    fontSize:10,fontWeight:600,padding:'2px 6px',borderRadius:100,
                    background: m.estado==='ACTIVO' ? 'var(--success)15' : 'var(--text-muted)15',
                    color: m.estado==='ACTIVO' ? 'var(--success)' : 'var(--text-muted)'
                  }}>{m.estado}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginacion */}
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

function EstadoVacio({ onIrASync }) {
  return (
    <div style={{maxWidth:500,margin:'60px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'48px 32px'}}>
      <div style={{fontSize:56,marginBottom:16}}>🕐</div>
      <h2 style={{margin:'0 0 8px 0',fontSize:20,fontWeight:700}}>Sin marcaciones aun</h2>
      <p style={{color:'var(--text-muted)',fontSize:14,lineHeight:1.5,margin:'0 0 24px 0'}}>
        Sincroniza las marcaciones desde Workera para verlas aqui. Ve a Config → Sincronizacion.
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
