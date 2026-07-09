// src/rrhh/asistencia/tabs/AsisRegistros.jsx
// Fusiona AsisMarcaciones + AsisPermisos en sub-tabs.

import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'

const PAGE_SIZE = 50
const fFH = ts => ts ? new Date(ts).toLocaleString('es-CL', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'
const fD  = d  => d  ? new Date(d+'T12:00:00').toLocaleDateString('es-CL') : '—'
const TIPO_LABEL = ['Entrada','Salida','Salida extra','Entrada extra','Inicio descanso','Fin descanso']
const hoy7 = () => { const d = new Date(); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10) }
const hoy  = () => new Date().toISOString().slice(0,10)

export function AsisRegistros({ cu, onIrASync, scopeSuc }) {
  const [sub, setSub] = useState('marcaciones')
  return (
    <div>
      {/* Sub-tabs */}
      <div style={{display:'flex',gap:2,marginBottom:20,borderBottom:'1px solid var(--border)',paddingBottom:0}}>
        {[
          { k:'marcaciones', l:'🕐 Marcaciones' },
          { k:'permisos',    l:'📋 Permisos' }
        ].map(t => (
          <button key={t.k} onClick={() => setSub(t.k)} style={{
            padding:'10px 18px',border:'none',background:'transparent',
            borderBottom:`3px solid ${sub===t.k?'var(--accent)':'transparent'}`,
            color: sub===t.k?'var(--accent)':'var(--text)',
            fontWeight: sub===t.k?600:400, fontSize:14, cursor:'pointer'
          }}>{t.l}</button>
        ))}
      </div>
      {sub === 'marcaciones' && <TabMarcaciones onIrASync={onIrASync} scopeSuc={scopeSuc} />}
      {sub === 'permisos'    && <TabPermisos    onIrASync={onIrASync} scopeSuc={scopeSuc} />}
    </div>
  )
}

function TabMarcaciones({ onIrASync, scopeSuc }) {
  const [rows, setRows]     = useState([])
  const [total, setTotal]   = useState(0)
  const [cargando, setCarg] = useState(true)
  const [pagina, setPag]    = useState(0)
  const [sucs, setSucs]     = useState([])
  const [fil, setFil]       = useState({ desde: hoy7(), hasta: hoy(), sucursal:'todas', busqueda:'' })

  useEffect(() => { supabase.from('sucursales').select('id,nombre').order('nombre').then(({data}) => setSucs(data||[])) }, [])
  useEffect(() => { cargar() }, [fil, pagina, scopeSuc])

  async function cargar() {
    setCarg(true)
    try {
      let q = supabase.from('v_asis_marcaciones').select('*',{count:'exact'})
        .gte('fecha_hora', fil.desde+'T00:00:00')
        .lte('fecha_hora', fil.hasta+'T23:59:59')
        .order('fecha_hora',{ascending:false})
        .range(pagina*PAGE_SIZE, (pagina+1)*PAGE_SIZE-1)
      if (scopeSuc) q = q.eq('sucursal_id', scopeSuc)
      else if (fil.sucursal !== 'todas') q = q.eq('sucursal_id', fil.sucursal)
      if (fil.busqueda) q = q.ilike('empleado_nombre', `%${fil.busqueda}%`)
      const { data, count, error } = await q
      if (error) throw error
      setRows(data||[]); setTotal(count||0)
    } catch(e) { console.error(e) }
    finally { setCarg(false) }
  }

  const totalPag = Math.ceil(total/PAGE_SIZE)
  const sinDatos = !cargando && total===0 && pagina===0 && fil.sucursal==='todas' && !fil.busqueda

  if (sinDatos) return (
    <VacioSimple ic="🕐" msg="Sin marcaciones aún" sub="Sincroniza desde Config." onIrASync={onIrASync} />
  )

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
        <div style={{fontSize:13,color:'var(--text-muted)'}}>{total.toLocaleString('es-CL')} registros</div>
      </div>
      <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap',alignItems:'flex-end'}}>
        <div><label style={lbl}>Desde</label>
          <input type="date" value={fil.desde} onChange={e=>{setFil({...fil,desde:e.target.value});setPag(0)}} style={inp}/></div>
        <div><label style={lbl}>Hasta</label>
          <input type="date" value={fil.hasta} onChange={e=>{setFil({...fil,hasta:e.target.value});setPag(0)}} style={inp}/></div>
        {!scopeSuc && (
          <div><label style={lbl}>Sucursal</label>
            <select value={fil.sucursal} onChange={e=>{setFil({...fil,sucursal:e.target.value});setPag(0)}} style={inp}>
              <option value="todas">Todas</option>
              {sucs.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select></div>
        )}
        <div style={{flex:1,minWidth:180}}><label style={lbl}>Empleado</label>
          <input type="search" placeholder="Buscar nombre..." value={fil.busqueda}
            onChange={e=>{setFil({...fil,busqueda:e.target.value});setPag(0)}} style={inp}/></div>
      </div>
      <Tabla>
        <thead><tr style={trH}>
          <Th>Fecha y hora</Th><Th>Empleado</Th><Th>Tipo</Th>
          <Th>Origen</Th><Th>Sucursal</Th><Th>Estado</Th>
        </tr></thead>
        <tbody>
          {cargando ? <VaciaFila cols={6} msg="Cargando..." /> :
           rows.length===0 ? <VaciaFila cols={6} msg="Sin resultados" /> :
           rows.map(m => (
            <tr key={m.id}>
              <td style={{...td,fontFamily:'monospace',fontSize:11,whiteSpace:'nowrap'}}>{fFH(m.fecha_hora)}</td>
              <td style={td}>
                <div style={{fontWeight:500,fontSize:13}}>{m.empleado_nombre || <em style={{color:'var(--text-muted)'}}>Sin mapear</em>}</div>
                {!m.cod_contaline && <div style={{fontSize:10,color:'var(--warning)'}}>code: {m.workera_employee_code}</div>}
              </td>
              <td style={td}>
                <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:100,
                  background:m.tipo===0?'var(--success)15':m.tipo===1?'var(--danger)15':'var(--accent)15',
                  color:m.tipo===0?'var(--success)':m.tipo===1?'var(--danger)':'var(--accent)'}}>
                  {TIPO_LABEL[m.tipo]||m.tipo}
                </span>
              </td>
              <td style={{...td,fontSize:12}}>{m.origen_codigo||'—'}{m.is_mobile&&<span style={{fontSize:10,color:'var(--text-muted)',marginLeft:4}}>GPS</span>}</td>
              <td style={{...td,fontSize:12,color:'var(--text-muted)'}}>{m.sucursal_nombre||'—'}</td>
              <td style={td}><span style={{fontSize:10,fontWeight:600,padding:'2px 6px',borderRadius:100,
                background:m.estado==='ACTIVO'?'var(--success)15':'var(--text-muted)15',
                color:m.estado==='ACTIVO'?'var(--success)':'var(--text-muted)'}}>{m.estado}</span></td>
            </tr>
          ))}
        </tbody>
      </Tabla>
      {totalPag>1 && <Paginacion pagina={pagina} total={totalPag} onChange={setPag}/>}
    </div>
  )
}

function TabPermisos({ onIrASync, scopeSuc }) {
  const [rows, setRows]     = useState([])
  const [total, setTotal]   = useState(0)
  const [cargando, setCarg] = useState(true)
  const [pagina, setPag]    = useState(0)
  const [sucs, setSucs]     = useState([])
  const [fil, setFil]       = useState({ desde: hoy7(), hasta: hoy(), sucursal:'todas' })

  useEffect(() => { supabase.from('sucursales').select('id,nombre').order('nombre').then(({data}) => setSucs(data||[])) }, [])
  useEffect(() => { cargar() }, [fil, pagina, scopeSuc])

  async function cargar() {
    setCarg(true)
    try {
      let q = supabase.from('v_asis_permisos').select('*',{count:'exact'})
        .gte('inicio', fil.desde).lte('inicio', fil.hasta)
        .order('inicio',{ascending:false})
        .range(pagina*PAGE_SIZE,(pagina+1)*PAGE_SIZE-1)
      if (scopeSuc) q = q.eq('sucursal_id', scopeSuc)
      else if (fil.sucursal !== 'todas') q = q.eq('sucursal_id', fil.sucursal)
      const { data, count, error } = await q
      if (error) throw error
      setRows(data||[]); setTotal(count||0)
    } catch(e) { console.error(e) }
    finally { setCarg(false) }
  }

  const totalPag = Math.ceil(total/PAGE_SIZE)
  const sinDatos = !cargando && total===0 && pagina===0 && fil.sucursal==='todas'
  if (sinDatos) return <VacioSimple ic="📋" msg="Sin permisos registrados aún" sub="Sincroniza desde Config." onIrASync={onIrASync}/>

  return (
    <div>
      <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:12}}>{total.toLocaleString('es-CL')} permisos</div>
      <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap',alignItems:'flex-end'}}>
        <div><label style={lbl}>Desde</label>
          <input type="date" value={fil.desde} onChange={e=>{setFil({...fil,desde:e.target.value});setPag(0)}} style={inp}/></div>
        <div><label style={lbl}>Hasta</label>
          <input type="date" value={fil.hasta} onChange={e=>{setFil({...fil,hasta:e.target.value});setPag(0)}} style={inp}/></div>
        {!scopeSuc && (
          <div><label style={lbl}>Sucursal</label>
            <select value={fil.sucursal} onChange={e=>{setFil({...fil,sucursal:e.target.value});setPag(0)}} style={inp}>
              <option value="todas">Todas</option>
              {sucs.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select></div>
        )}
      </div>
      <Tabla>
        <thead><tr style={trH}>
          <Th>Empleado</Th><Th>Inicio</Th><Th>Término</Th>
          <Th>Tipo permiso</Th><Th>Sucursal</Th><Th>Comentario</Th>
        </tr></thead>
        <tbody>
          {cargando ? <VaciaFila cols={6} msg="Cargando..." /> :
           rows.length===0 ? <VaciaFila cols={6} msg="Sin resultados" /> :
           rows.map(p => (
            <tr key={p.id}>
              <td style={td}><div style={{fontWeight:500,fontSize:13}}>{p.empleado_nombre||<em style={{color:'var(--text-muted)'}}>Sin mapear</em>}</div></td>
              <td style={{...td,fontSize:12,whiteSpace:'nowrap'}}>{fFH(p.inicio)}</td>
              <td style={{...td,fontSize:12,whiteSpace:'nowrap'}}>{fFH(p.fin)}</td>
              <td style={td}>
                <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:100,
                  background:'var(--accent)12',color:'var(--accent)'}}>
                  {p.permiso_nombre||p.permiso_tipo||'—'}
                </span>
              </td>
              <td style={{...td,fontSize:12,color:'var(--text-muted)'}}>{p.sucursal_nombre||'—'}</td>
              <td style={{...td,fontSize:12,color:'var(--text-muted)',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {p.comentario||'—'}
              </td>
            </tr>
          ))}
        </tbody>
      </Tabla>
      {totalPag>1 && <Paginacion pagina={pagina} total={totalPag} onChange={setPag}/>}
    </div>
  )
}

// ─── Shared UI ───────────────────────────────────────────────────────────────
function VacioSimple({ ic, msg, sub, onIrASync }) {
  return (
    <div style={{maxWidth:460,margin:'50px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'40px 28px'}}>
      <div style={{fontSize:48,marginBottom:12}}>{ic}</div>
      <h3 style={{margin:'0 0 6px 0',fontSize:18,fontWeight:700}}>{msg}</h3>
      <p style={{color:'var(--text-muted)',fontSize:13,margin:'0 0 20px 0'}}>{sub}</p>
      <button onClick={onIrASync} style={{padding:'9px 18px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
        Ir a Sincronización →
      </button>
    </div>
  )
}
function Tabla({ children }) {
  return (
    <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>{children}</table>
    </div>
  )
}
function Th({ children }) {
  return <th style={{padding:'10px 12px',textAlign:'left',fontWeight:600,fontSize:11,textTransform:'uppercase',letterSpacing:'0.04em',color:'var(--text-muted)',borderBottom:'1px solid var(--border)'}}>{children}</th>
}
function VaciaFila({ cols, msg }) {
  return <tr><td colSpan={cols} style={{padding:28,textAlign:'center',color:'var(--text-muted)'}}>{msg}</td></tr>
}
function Paginacion({ pagina, total, onChange }) {
  return (
    <div style={{display:'flex',gap:8,justifyContent:'center',marginTop:12,alignItems:'center'}}>
      <button onClick={()=>onChange(p=>Math.max(0,p-1))} disabled={pagina===0}
        style={{padding:'7px 14px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}}>← Anterior</button>
      <span style={{fontSize:13,color:'var(--text-muted)'}}>Pág. {pagina+1} de {total}</span>
      <button onClick={()=>onChange(p=>Math.min(total-1,p+1))} disabled={pagina>=total-1}
        style={{padding:'7px 14px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}}>Siguiente →</button>
    </div>
  )
}

const lbl = {display:'block',fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.04em'}
const inp = {padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit'}
const trH = {background:'var(--bg-app)'}
const td  = {padding:'10px 12px',borderBottom:'1px solid var(--border)',verticalAlign:'middle'}
