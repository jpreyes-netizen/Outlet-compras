// src/rrhh/asistencia/tabs/AsisPermisos.jsx
import { useState, useEffect } from 'react'
import { supabase } from '../../../supabase'

const TIPO_COLOR = {
  LICENCIA_MEDICA:       { bg:'var(--danger)15',    c:'var(--danger)' },
  VACACIONES:            { bg:'var(--success)15',   c:'var(--success)' },
  PRENATAL:              { bg:'var(--purple,#7c3aed)15', c:'var(--purple,#7c3aed)' },
  POSTNATAL:             { bg:'var(--purple,#7c3aed)15', c:'var(--purple,#7c3aed)' },
  NO_TRABAJADO:          { bg:'var(--warning)15',   c:'var(--warning)' },
  TRABAJADO:             { bg:'var(--success)15',   c:'var(--success)' },
  TRABAJADO_EN_HORARIO:  { bg:'var(--accent)15',    c:'var(--accent)' },
}
const PAGE_SIZE = 50

export function AsisPermisos({ cu, onIrASync }) {
  const [permisos, setPermisos] = useState([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [pagina, setPagina] = useState(0)
  const [fil, setFil] = useState({
    desde: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10),
    hasta: new Date().toISOString().slice(0,10),
    tipo: 'todos',
    sucursal: 'todas'
  })
  const [sucursales, setSucursales] = useState([])
  const [tiposPermiso, setTiposPermiso] = useState([])

  useEffect(() => { cargarCatalogos() }, [])
  useEffect(() => { cargar() }, [fil, pagina])

  async function cargarCatalogos() {
    const [suc, tipos] = await Promise.all([
      supabase.from('sucursales').select('id,nombre').order('nombre'),
      supabase.from('asis_workera_tipos_permiso').select('workera_code,workera_name,workera_type').order('workera_name')
    ])
    setSucursales(suc.data || [])
    setTiposPermiso(tipos.data || [])
  }

  async function cargar() {
    setCargando(true)
    try {
      let q = supabase.from('v_asis_permisos').select('*', { count:'exact' })
        .gte('inicio', fil.desde)
        .lte('inicio', fil.hasta + 'T23:59:59')
        .order('inicio', { ascending: false })
        .range(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE - 1)

      if (fil.sucursal !== 'todas') q = q.eq('sucursal_id', fil.sucursal)
      if (fil.tipo !== 'todos') q = q.eq('permiso_tipo', fil.tipo)

      const { data, count, error } = await q
      if (error) throw error
      setPermisos(data || [])
      setTotal(count || 0)
    } catch(e) {
      console.error(e)
    } finally {
      setCargando(false)
    }
  }

  const totalPaginas = Math.ceil(total / PAGE_SIZE)
  const sinDatos = !cargando && total === 0 && pagina === 0 && fil.tipo === 'todos' && fil.sucursal === 'todas'

  if (sinDatos) return <EstadoVacio onIrASync={onIrASync} />

  return (
    <div>
      <div style={{marginBottom:16}}>
        <h2 style={{fontSize:22,fontWeight:700,margin:'0 0 4px 0'}}>Permisos y Vacaciones</h2>
        <div style={{fontSize:13,color:'var(--text-muted)'}}>{total.toLocaleString('es-CL')} registros encontrados</div>
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
          <label style={lbl}>Tipo</label>
          <select value={fil.tipo} onChange={e => { setFil({...fil,tipo:e.target.value}); setPagina(0) }} style={input}>
            <option value="todos">Todos los tipos</option>
            <option value="LICENCIA_MEDICA">Licencia medica</option>
            <option value="VACACIONES">Vacaciones</option>
            <option value="PRENATAL">Prenatal</option>
            <option value="POSTNATAL">Postnatal</option>
            <option value="NO_TRABAJADO">No trabajado</option>
            <option value="TRABAJADO">Trabajado</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Sucursal</label>
          <select value={fil.sucursal} onChange={e => { setFil({...fil,sucursal:e.target.value}); setPagina(0) }} style={input}>
            <option value="todas">Todas</option>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      </div>

      {/* Tabla */}
      <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
        <table style={tbl}>
          <thead>
            <tr style={trHead}>
              <th style={th}>Empleado</th>
              <th style={th}>Tipo</th>
              <th style={th}>Nombre permiso</th>
              <th style={th}>Inicio</th>
              <th style={th}>Fin</th>
              <th style={{...th,textAlign:'right'}}>Dias</th>
              <th style={th}>Sucursal</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={7} style={{padding:30,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</td></tr>
            ) : permisos.length === 0 ? (
              <tr><td colSpan={7} style={{padding:30,textAlign:'center',color:'var(--text-muted)'}}>Sin resultados para los filtros aplicados</td></tr>
            ) : permisos.map(p => {
              const tc = TIPO_COLOR[p.permiso_tipo] || { bg:'var(--text-muted)15', c:'var(--text-muted)' }
              return (
                <tr key={p.workera_id}>
                  <td style={td}>
                    <div style={{fontWeight:500}}>{p.empleado_nombre || <span style={{color:'var(--text-muted)',fontStyle:'italic'}}>Sin mapear</span>}</div>
                    <div style={{fontSize:11,color:'var(--text-muted)'}}>{p.sucursal_nombre}</div>
                  </td>
                  <td style={td}>
                    <span style={{fontSize:10,fontWeight:700,padding:'3px 9px',borderRadius:100,background:tc.bg,color:tc.c}}>
                      {p.permiso_tipo?.replace(/_/g,' ')}
                    </span>
                  </td>
                  <td style={{...td,fontSize:13}}>{p.permiso_nombre}</td>
                  <td style={{...td,fontSize:12,whiteSpace:'nowrap'}}>{new Date(p.inicio).toLocaleDateString('es-CL')}</td>
                  <td style={{...td,fontSize:12,whiteSpace:'nowrap'}}>{new Date(p.fin).toLocaleDateString('es-CL')}</td>
                  <td style={{...td,textAlign:'right',fontWeight:600}}>{Math.round(p.dias ?? 1)}</td>
                  <td style={{...td,fontSize:12,color:'var(--text-muted)'}}>{p.sucursal_nombre || '—'}</td>
                </tr>
              )
            })}
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

function EstadoVacio({ onIrASync }) {
  return (
    <div style={{maxWidth:500,margin:'60px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'48px 32px'}}>
      <div style={{fontSize:56,marginBottom:16}}>📋</div>
      <h2 style={{margin:'0 0 8px 0',fontSize:20,fontWeight:700}}>Sin permisos registrados aun</h2>
      <p style={{color:'var(--text-muted)',fontSize:14,lineHeight:1.5,margin:'0 0 24px 0'}}>
        Sincroniza los permisos desde Workera para verlos aqui.
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
