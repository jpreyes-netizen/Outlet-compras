// src/rrhh/asistencia/tabs/AsisDotacion.jsx
// Dotación — Gestión de Personas (capability rrhh.dotacion)
// · Estado actual de cada trabajador: activo / desvinculado / licencia / permiso / vacaciones
// · Dar de baja con FECHA DE EGRESO EDITABLE (el trigger fn_empleado_egreso cierra cargos)
// · Reincorporar
// · Registrar / anular NOVEDADES por rango (rrhh_empleado_novedades):
//   los días cubiertos quedan auto-justificados y no llegan al jefe.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabase'

const TIPOS_NOV = {
  licencia_medica:  { l:'Licencia médica',  ic:'🏥', c:'#0A84FF' },
  permiso_con_goce: { l:'Permiso con goce', ic:'✅', c:'#34C759' },
  permiso_sin_goce: { l:'Permiso sin goce', ic:'📄', c:'#FF9500' },
  vacaciones:       { l:'Vacaciones',       ic:'🏖️', c:'#AF52DE' },
  otro:             { l:'Otro',             ic:'📌', c:'#8E8E93' },
}
const ESTADOS = {
  activo:       { l:'Activo',       c:'#34C759', ic:'●' },
  desvinculado: { l:'Desvinculado', c:'#8E8E93', ic:'○' },
  ...Object.fromEntries(Object.entries(TIPOS_NOV).map(([k,v])=>[k,{ l:v.l, c:v.c, ic:v.ic }])),
}

const hoyISO = () => new Date().toISOString().slice(0,10)
const fFecha = d => { if(!d) return '—'; const [y,m,dd]=String(d).slice(0,10).split('-'); return `${dd}-${m}-${y}` }
const diasEntre = (a,b) => Math.round((new Date(b)-new Date(a))/86400000)+1

export function AsisDotacion({ cu }) {
  const [dot, setDot] = useState([])
  const [sucs, setSucs] = useState([])
  const [cargando, setCargando] = useState(true)
  const [msg, setMsg] = useState(null)
  const [fEstado, setFEstado] = useState('vigentes')   // vigentes | activo | con_novedad | desvinculado | todos
  const [fSuc, setFSuc] = useState('todas')
  const [busq, setBusq] = useState('')
  const [modal, setModal] = useState(null)             // { tipo:'baja'|'reincorporar'|'novedad'|'historial', emp }

  useEffect(() => { cargar() }, [])
  async function cargar() {
    setCargando(true)
    try {
      const [{ data: d, error }, { data: s }] = await Promise.all([
        supabase.from('v_rrhh_dotacion').select('*').order('nombre').limit(20000),
        supabase.from('sucursales').select('id,nombre').order('nombre'),
      ])
      if (error) throw error
      setDot(d||[]); setSucs(s||[])
    } catch(e) { setMsg({ t:'error', x:e.message }) }
    finally { setCargando(false) }
  }

  const kpis = useMemo(() => ({
    activos: dot.filter(e=>e.estado_actual==='activo').length,
    conNovedad: dot.filter(e=>e.activo && e.novedad_id).length,
    desvinculados: dot.filter(e=>!e.activo).length,
    total: dot.length,
  }), [dot])

  const lista = useMemo(() => {
    const q = busq.trim().toLowerCase()
    return dot
      .filter(e => fEstado==='todos' ? true
        : fEstado==='vigentes' ? e.activo
        : fEstado==='activo' ? e.estado_actual==='activo'
        : fEstado==='con_novedad' ? (e.activo && e.novedad_id)
        : !e.activo)
      .filter(e => fSuc==='todas' || e.sucursal_id===fSuc)
      .filter(e => !q || `${e.nombre} ${e.rut||''} ${e.cargo||''}`.toLowerCase().includes(q))
  }, [dot, fEstado, fSuc, busq])

  // ── Acciones ──
  async function darBaja(emp, fechaEgreso) {
    try {
      // El trigger fija fecha_egreso=hoy al desactivar; luego la sobrescribimos con la real
      let { error } = await supabase.from('rrhh_empleados').update({ activo:false }).eq('cod_contaline', emp.cod_contaline)
      if (error) throw error
      ;({ error } = await supabase.from('rrhh_empleados').update({ fecha_egreso: fechaEgreso }).eq('cod_contaline', emp.cod_contaline))
      if (error) throw error
      setModal(null); setMsg({ t:'ok', x:`${emp.nombre} dado de baja con egreso ${fFecha(fechaEgreso)}. Sus cargos en el organigrama quedaron cerrados.` })
      await cargar()
    } catch(e) { setMsg({ t:'error', x:e.message }) }
  }
  async function reincorporar(emp) {
    if (!window.confirm(`¿Reincorporar a ${emp.nombre}? Se limpia la fecha de egreso. Los cargos del organigrama deben reasignarse manualmente.`)) return
    try {
      const { error } = await supabase.from('rrhh_empleados').update({ activo:true, fecha_egreso:null }).eq('cod_contaline', emp.cod_contaline)
      if (error) throw error
      setMsg({ t:'ok', x:`${emp.nombre} reincorporado.` })
      await cargar()
    } catch(e) { setMsg({ t:'error', x:e.message }) }
  }
  async function registrarNovedad(emp, form) {
    try {
      const { error } = await supabase.from('rrhh_empleado_novedades').insert({
        cod_contaline: emp.cod_contaline, tipo: form.tipo, desde: form.desde, hasta: form.hasta,
        motivo: form.motivo.trim() || null, registrado_por: cu.id,
      })
      if (error) throw error
      setModal(null); setMsg({ t:'ok', x:`${TIPOS_NOV[form.tipo].l} registrada para ${emp.nombre} (${fFecha(form.desde)} → ${fFecha(form.hasta)}). Esos días quedan justificados automáticamente.` })
      await cargar()
    } catch(e) { setMsg({ t:'error', x:e.message }) }
  }
  async function anularNovedad(nov) {
    if (!window.confirm('¿Anular esta novedad? Los días cubiertos volverán a evaluarse como ausencia si no hay marcas.')) return
    try {
      const { error } = await supabase.from('rrhh_empleado_novedades')
        .update({ activo:false, anulado_por:cu.id, anulado_at:new Date().toISOString() }).eq('id', nov.id)
      if (error) throw error
      await cargar()
      // refrescar historial si está abierto
      if (modal?.tipo==='historial') setModal(m=>({ ...m, refresh:(m.refresh||0)+1 }))
    } catch(e) { setMsg({ t:'error', x:e.message }) }
  }

  return (
    <div>
      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10,marginBottom:14}}>
        <Kpi l='Dotación vigente' v={kpis.activos + kpis.conNovedad} sub={`${kpis.total} en el maestro`} c='var(--text)' onClick={()=>setFEstado('vigentes')} on={fEstado==='vigentes'}/>
        <Kpi l='Activos hoy' v={kpis.activos} sub='sin novedad vigente' c='#34C759' onClick={()=>setFEstado('activo')} on={fEstado==='activo'}/>
        <Kpi l='Con novedad hoy' v={kpis.conNovedad} sub='licencia · permiso · vacaciones' c='#0A84FF' onClick={()=>setFEstado('con_novedad')} on={fEstado==='con_novedad'}/>
        <Kpi l='Desvinculados' v={kpis.desvinculados} sub='con fecha de egreso' c='#8E8E93' onClick={()=>setFEstado('desvinculado')} on={fEstado==='desvinculado'}/>
      </div>

      {/* Filtros */}
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
        <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder='🔎 Nombre, RUT, cargo...' style={{...inp,width:240}}/>
        <select value={fSuc} onChange={e=>setFSuc(e.target.value)} style={inp}>
          <option value='todas'>Todas las sucursales</option>
          {sucs.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <button onClick={()=>setFEstado('todos')} style={{...chip, ...(fEstado==='todos'?chipOn:{})}}>Ver todos (incl. desvinculados)</button>
        <span style={{marginLeft:'auto',fontSize:12,color:'var(--text-muted)'}}>{lista.length} trabajador(es)</span>
      </div>

      {msg && (
        <div style={{marginBottom:12,padding:'9px 14px',borderRadius:8,fontSize:13,
          background: msg.t==='error'?'#FF3B3012':'#34C75912', border:`1px solid ${msg.t==='error'?'#FF3B3040':'#34C75940'}`,
          display:'flex',justifyContent:'space-between'}}>
          <span>{msg.t==='error'?'⚠️ ':'✅ '}{msg.x}</span>
          <button onClick={()=>setMsg(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
        </div>
      )}

      {cargando ? <div style={{padding:50,textAlign:'center',color:'var(--text-muted)'}}>Cargando dotación...</div> : (
        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,minWidth:900}}>
            <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
              {['Trabajador','Sucursal','Cargo','Ingreso','Estado hoy','Detalle',''].map(h=><th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {lista.map(e => {
                const est = ESTADOS[e.estado_actual] || ESTADOS.activo
                return (
                  <tr key={e.cod_contaline} style={{borderBottom:'1px solid var(--border)',opacity:e.activo?1:0.65}}>
                    <td style={td}><div style={{fontWeight:600}}>{e.nombre}</div><div style={{fontSize:10.5,color:'var(--text-muted)'}}>{e.rut||''} · #{e.cod_contaline}</div></td>
                    <td style={td}>{e.sucursal_id||'—'}</td>
                    <td style={{...td,fontSize:11.5,color:'var(--text-muted)'}}>{e.cargo||'—'}</td>
                    <td style={{...td,whiteSpace:'nowrap',fontSize:11.5}}>{fFecha(e.fecha_ingreso)}</td>
                    <td style={td}>
                      <span style={{fontSize:10.5,fontWeight:800,padding:'2px 9px',borderRadius:100,background:`${est.c}15`,color:est.c,whiteSpace:'nowrap'}}>{est.ic} {est.l}</span>
                    </td>
                    <td style={{...td,fontSize:11.5,color:'var(--text-muted)'}}>
                      {!e.activo && <>Egreso {fFecha(e.fecha_egreso)}</>}
                      {e.activo && e.novedad_id && <>{fFecha(e.novedad_desde)} → {fFecha(e.novedad_hasta)}{e.novedad_motivo?` · ${e.novedad_motivo}`:''}</>}
                      {e.activo && !e.novedad_id && '—'}
                    </td>
                    <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                      {e.activo ? (
                        <>
                          <button onClick={()=>setModal({ tipo:'novedad', emp:e })} style={btnMini} title='Registrar licencia / permiso / vacaciones'>➕ Novedad</button>
                          <button onClick={()=>setModal({ tipo:'historial', emp:e })} style={btnMini} title='Historial de novedades'>🗂</button>
                          <button onClick={()=>setModal({ tipo:'baja', emp:e })} style={{...btnMini,color:'#FF3B30',borderColor:'#FF3B3040'}} title='Dar de baja'>Baja</button>
                        </>
                      ) : (
                        <>
                          <button onClick={()=>setModal({ tipo:'historial', emp:e })} style={btnMini}>🗂</button>
                          <button onClick={()=>reincorporar(e)} style={{...btnMini,color:'#34C759',borderColor:'#34C75940'}}>↩ Reincorporar</button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal?.tipo==='baja' && <ModalBaja emp={modal.emp} onCerrar={()=>setModal(null)} onConfirmar={f=>darBaja(modal.emp, f)}/>}
      {modal?.tipo==='novedad' && <ModalNovedad emp={modal.emp} onCerrar={()=>setModal(null)} onConfirmar={f=>registrarNovedad(modal.emp, f)}/>}
      {modal?.tipo==='historial' && <ModalHistorial emp={modal.emp} refresh={modal.refresh} onCerrar={()=>setModal(null)} onAnular={anularNovedad} onNueva={()=>setModal({ tipo:'novedad', emp:modal.emp })}/>}
    </div>
  )
}

// ─── Modal: dar de baja con fecha de egreso editable ─────────────────────────
function ModalBaja({ emp, onCerrar, onConfirmar }) {
  const [fecha, setFecha] = useState(hoyISO())
  const [ultimo, setUltimo] = useState(null)
  const [enviando, setEnviando] = useState(false)
  useEffect(() => {
    // Sugerir el último día con marca real como fecha de egreso
    supabase.from('v_asis_jornadas').select('fecha')
      .eq('cod_contaline', emp.cod_contaline)
      .or('entrada_real.not.is.null,salida_real.not.is.null')
      .order('fecha', { ascending:false }).limit(1)
      .then(({ data }) => { if (data?.[0]?.fecha) { setUltimo(data[0].fecha); setFecha(data[0].fecha) } })
  }, [emp.cod_contaline])
  return (
    <Overlay onCerrar={onCerrar}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:2}}>Dar de baja</div>
      <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:14}}>{emp.nombre} · {emp.sucursal_id||'—'} · {emp.cargo||''}</div>
      <label style={lbl}>Fecha de egreso (último día de trabajo)</label>
      <input type='date' value={fecha} max={hoyISO()} onChange={e=>setFecha(e.target.value)} style={{...inp,width:'100%',boxSizing:'border-box'}}/>
      {ultimo && <div style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>Sugerida: último día con marca real registrada ({fFecha(ultimo)}). Ajústala si corresponde.</div>}
      <div style={{fontSize:11.5,background:'#FF3B300A',border:'1px solid #FF3B3030',borderRadius:8,padding:'9px 12px',marginTop:12,color:'var(--text)'}}>
        Al confirmar: se cierran sus cargos en el organigrama, deja de generar ausencias posteriores al egreso y sale de la dotación vigente. Recuerda darle de baja también en <strong>Workera</strong>.
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:14}}>
        <button onClick={onCerrar} disabled={enviando} style={btnSec}>Cancelar</button>
        <button disabled={!fecha||enviando} onClick={async()=>{ setEnviando(true); await onConfirmar(fecha) }}
          style={{...btnPri,background:'#FF3B30',opacity:(!fecha||enviando)?0.5:1}}>{enviando?'...':'Confirmar baja'}</button>
      </div>
    </Overlay>
  )
}

// ─── Modal: registrar novedad por rango ──────────────────────────────────────
function ModalNovedad({ emp, onCerrar, onConfirmar }) {
  const [form, setForm] = useState({ tipo:'licencia_medica', desde:hoyISO(), hasta:hoyISO(), motivo:'' })
  const [enviando, setEnviando] = useState(false)
  const ok = form.tipo && form.desde && form.hasta && form.hasta >= form.desde
  const n = ok ? diasEntre(form.desde, form.hasta) : 0
  return (
    <Overlay onCerrar={onCerrar}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:2}}>Registrar novedad</div>
      <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:14}}>{emp.nombre} · {emp.sucursal_id||'—'}</div>
      <div style={{display:'grid',gap:7,marginBottom:12}}>
        {Object.entries(TIPOS_NOV).map(([k,t])=>(
          <button key={k} onClick={()=>setForm(f=>({...f,tipo:k}))} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:10,cursor:'pointer',textAlign:'left',
            background: form.tipo===k?`${t.c}14`:'var(--bg-app)', border:`1.5px solid ${form.tipo===k?t.c:'var(--border)'}`}}>
            <span style={{fontSize:16}}>{t.ic}</span>
            <span style={{fontSize:13,fontWeight:700,color:form.tipo===k?t.c:'var(--text)'}}>{t.l}</span>
          </button>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
        <div><label style={lbl}>Desde</label><input type='date' value={form.desde} onChange={e=>setForm(f=>({...f,desde:e.target.value, hasta: f.hasta<e.target.value?e.target.value:f.hasta}))} style={{...inp,width:'100%',boxSizing:'border-box'}}/></div>
        <div><label style={lbl}>Hasta</label><input type='date' value={form.hasta} min={form.desde} onChange={e=>setForm(f=>({...f,hasta:e.target.value}))} style={{...inp,width:'100%',boxSizing:'border-box'}}/></div>
      </div>
      <label style={lbl}>Motivo / respaldo (opcional)</label>
      <input value={form.motivo} onChange={e=>setForm(f=>({...f,motivo:e.target.value}))} placeholder='Ej: Licencia folio 123456 · Permiso por matrimonio · Vacaciones legales' style={{...inp,width:'100%',boxSizing:'border-box'}}/>
      <div style={{fontSize:11.5,background:'#0A84FF0A',border:'1px solid #0A84FF30',borderRadius:8,padding:'9px 12px',marginTop:12}}>
        {ok ? <><strong>{n} día(s)</strong> quedarán justificados automáticamente: no aparecerán como ausencia pendiente para el jefe y en los reportes figurarán como "{TIPOS_NOV[form.tipo].l}".</> : 'Define un rango válido.'}
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:14}}>
        <button onClick={onCerrar} disabled={enviando} style={btnSec}>Cancelar</button>
        <button disabled={!ok||enviando} onClick={async()=>{ setEnviando(true); await onConfirmar(form) }}
          style={{...btnPri,opacity:(!ok||enviando)?0.5:1}}>{enviando?'...':'Registrar'}</button>
      </div>
    </Overlay>
  )
}

// ─── Modal: historial de novedades ───────────────────────────────────────────
function ModalHistorial({ emp, refresh, onCerrar, onAnular, onNueva }) {
  const [novs, setNovs] = useState([])
  const [cargando, setCargando] = useState(true)
  useEffect(() => {
    setCargando(true)
    supabase.from('rrhh_empleado_novedades').select('*').eq('cod_contaline', emp.cod_contaline).order('desde', { ascending:false })
      .then(({ data }) => { setNovs(data||[]); setCargando(false) })
  }, [emp.cod_contaline, refresh])
  const hoy = hoyISO()
  return (
    <Overlay onCerrar={onCerrar} ancho={560}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
        <div>
          <div style={{fontSize:16,fontWeight:700}}>Historial de novedades</div>
          <div style={{fontSize:12,color:'var(--text-muted)'}}>{emp.nombre}{!emp.activo?` · desvinculado ${fFecha(emp.fecha_egreso)}`:''}</div>
        </div>
        {emp.activo && <button onClick={onNueva} style={{...btnPri,padding:'6px 12px',fontSize:12}}>➕ Nueva</button>}
      </div>
      {cargando ? <div style={{padding:20,color:'var(--text-muted)',fontSize:12.5}}>Cargando...</div> :
       novs.length===0 ? <div style={{padding:'18px 0',color:'var(--text-muted)',fontSize:12.5}}>Sin novedades registradas.</div> : (
        <div style={{display:'grid',gap:6,maxHeight:380,overflowY:'auto'}}>
          {novs.map(n => {
            const t = TIPOS_NOV[n.tipo] || TIPOS_NOV.otro
            const vigente = n.activo && n.desde <= hoy && hoy <= n.hasta
            return (
              <div key={n.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 11px',borderRadius:9,
                background:'var(--bg-app)',borderLeft:`3px solid ${n.activo?t.c:'var(--border)'}`,opacity:n.activo?1:0.55}}>
                <span style={{fontSize:16}}>{t.ic}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12.5,fontWeight:700}}>{t.l} <span style={{fontWeight:500,color:'var(--text-muted)'}}>· {fFecha(n.desde)} → {fFecha(n.hasta)} · {diasEntre(n.desde,n.hasta)} día(s)</span>
                    {vigente && <span style={{marginLeft:6,fontSize:9.5,fontWeight:800,padding:'1px 6px',borderRadius:100,background:`${t.c}20`,color:t.c}}>VIGENTE</span>}
                    {!n.activo && <span style={{marginLeft:6,fontSize:9.5,fontWeight:800,padding:'1px 6px',borderRadius:100,background:'var(--border)',color:'var(--text-muted)'}}>ANULADA</span>}
                  </div>
                  {n.motivo && <div style={{fontSize:11,color:'var(--text-muted)',fontStyle:'italic'}}>{n.motivo}</div>}
                </div>
                {n.activo && <button onClick={()=>onAnular(n)} style={{...btnMini,color:'#FF3B30',borderColor:'#FF3B3040'}}>Anular</button>}
              </div>
            )
          })}
        </div>
      )}
      <div style={{display:'flex',justifyContent:'flex-end',marginTop:14}}>
        <button onClick={onCerrar} style={btnSec}>Cerrar</button>
      </div>
    </Overlay>
  )
}

// ─── Piezas ──────────────────────────────────────────────────────────────────
function Kpi({ l, v, sub, c, onClick, on }) {
  return (
    <button onClick={onClick} style={{textAlign:'left',cursor:'pointer',background:'var(--bg-surface)',
      border:`1px solid ${on?c:'var(--border)'}`,borderLeft:`4px solid ${c}`,borderRadius:10,padding:'10px 14px',
      boxShadow: on?`0 0 0 2px ${c}25`:'none'}}>
      <div style={{fontSize:10.5,fontWeight:800,color:c,textTransform:'uppercase',letterSpacing:'0.04em'}}>{l}</div>
      <div style={{fontSize:22,fontWeight:800,marginTop:3,color:'var(--text)'}}>{v}</div>
      <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{sub}</div>
    </button>
  )
}
function Overlay({ children, onCerrar, ancho=460 }) {
  return (
    <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-surface)',borderRadius:14,padding:22,width:'100%',maxWidth:ancho,border:'1px solid var(--border)',maxHeight:'88vh',overflowY:'auto'}}>{children}</div>
    </div>
  )
}
const th = {padding:'9px 12px',textAlign:'left',fontSize:10.5,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}
const td = {padding:'8px 12px',verticalAlign:'middle'}
const inp = {padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:12.5,background:'var(--bg-surface)',color:'var(--text)',fontFamily:'inherit'}
const lbl = {display:'block',fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}
const btnPri = {padding:'8px 15px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:700}
const btnSec = {padding:'8px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}
const btnMini = {padding:'4px 9px',background:'transparent',border:'1px solid var(--border)',borderRadius:7,cursor:'pointer',fontSize:11.5,marginLeft:4,color:'var(--text)'}
const chip = {padding:'6px 12px',borderRadius:100,border:'1px solid var(--border)',background:'transparent',color:'var(--text-muted)',fontSize:11.5,fontWeight:600,cursor:'pointer'}
const chipOn = {background:'var(--bg-app)',color:'var(--text)',borderColor:'var(--text-muted)'}
