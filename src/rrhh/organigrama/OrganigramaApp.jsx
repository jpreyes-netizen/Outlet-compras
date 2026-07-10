// src/rrhh/organigrama/OrganigramaApp.jsx
// Organigrama jerárquico de cargos — Outlet de Puertas
// Convención de estados (código de colores del directorio):
//   ocupado=verde · vacante=rojo · propuesto=amarillo · por_crear=borde punteado
// Tablas: org_cargos (árbol) + org_asignaciones (ocupantes, FK rrhh_empleados)
// La vista v_org_equipo (SQL) deriva de aquí los equipos para el scope RBAC 'equipo'.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabase'

const ESTADOS = {
  ocupado:   { l:'Ocupado',   c:'#34C759', bg:'#34C75915' },
  vacante:   { l:'Vacante',   c:'#FF3B30', bg:'#FF3B3015' },
  propuesto: { l:'Propuesto', c:'#FF9500', bg:'#FF950015' },
  por_crear: { l:'Por crear', c:'#8E8E93', bg:'#8E8E9310' },
}

const ROLES = [
  { k:"admin", l:"Admin", c:"var(--danger)" },
  { k:"dir_general", l:"Dir. General", c:"var(--danger)" },
  { k:"dir_finanzas", l:"Dir. Finanzas", c:"var(--purple)" },
  { k:"dir_negocios", l:"Dir. Negocios", c:"var(--accent)" },
  { k:"dir_operaciones", l:"Dir. Operaciones", c:"var(--info)" },
  { k:"analista", l:"Analista", c:"var(--success)" },
  { k:"directorio", l:"Directorio", c:"var(--text-muted)" }
]
const rl = u => ROLES.find(r=>r.k===u?.rol)||ROLES[5]

export function OrganigramaApp({ cu, onVolverHubRrhh, onCerrarSesion }) {
  const [cargos, setCargos]   = useState([])
  const [asigs, setAsigs]     = useState([])
  const [emps, setEmps]       = useState([])
  const [sucs, setSucs]       = useState([])
  const [cargando, setCarg]   = useState(true)
  const [colapsados, setColapsados] = useState(new Set())
  const [modalCargo, setModalCargo] = useState(null)   // { padre_id, cargo? }
  const [modalAsig, setModalAsig]   = useState(null)   // cargo
  const [msg, setMsg] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCarg(true)
    try {
      const [c, a, e, s] = await Promise.all([
        supabase.from('org_cargos').select('*').eq('activo', true).order('orden').order('nombre'),
        supabase.from('org_asignaciones').select('*').eq('activo', true),
        supabase.from('rrhh_empleados').select('cod_contaline,nombre,rut,sucursal_id,cargo').eq('activo', true).order('nombre'),
        supabase.from('sucursales').select('id,nombre').order('nombre'),
      ])
      if (c.error) throw c.error
      if (a.error) throw a.error
      setCargos(c.data||[]); setAsigs(a.data||[]); setEmps(e.data||[]); setSucs(s.data||[])
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
    finally { setCarg(false) }
  }

  // Índices
  const hijosDe = useMemo(() => {
    const m = {}
    for (const c of cargos) { const k = c.cargo_padre_id ?? 'root'; (m[k] = m[k]||[]).push(c) }
    return m
  }, [cargos])

  const ocupantesDe = useMemo(() => {
    const nom = Object.fromEntries(emps.map(e=>[e.cod_contaline, e.nombre]))
    const m = {}
    for (const a of asigs) (m[a.cargo_id] = m[a.cargo_id]||[]).push({ ...a, nombre: nom[a.cod_contaline] || `#${a.cod_contaline}` })
    return m
  }, [asigs, emps])

  const stats = useMemo(() => ({
    total: cargos.length,
    ocupados:   cargos.filter(c=>c.estado==='ocupado').length,
    vacantes:   cargos.filter(c=>c.estado==='vacante').length,
    propuestos: cargos.filter(c=>c.estado==='propuesto').length,
    porCrear:   cargos.filter(c=>c.estado==='por_crear').length,
    asignados:  new Set(asigs.map(a=>a.cod_contaline)).size,
  }), [cargos, asigs])

  function toggleColapso(id) {
    setColapsados(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function desactivarCargo(cargo) {
    const hijos = (hijosDe[cargo.id]||[]).length
    const ocup  = (ocupantesDe[cargo.id]||[]).length
    if (hijos > 0) { setMsg({tipo:'error', txt:`"${cargo.nombre}" tiene ${hijos} cargo(s) hijo(s). Muévelos o desactívalos primero.`}); return }
    if (ocup > 0)  { setMsg({tipo:'error', txt:`"${cargo.nombre}" tiene ${ocup} ocupante(s). Quítalos primero.`}); return }
    if (!window.confirm(`¿Desactivar el cargo "${cargo.nombre}"?`)) return
    try {
      const { error } = await supabase.from('org_cargos')
        .update({ activo:false, updated_at:new Date().toISOString() }).eq('id', cargo.id)
      if (error) throw error
      await cargar()
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }

  const raices = hijosDe['root'] || []

  return (
    <div style={{minHeight:"100vh",background:"var(--bg-app)"}}>
      <header style={{background:"var(--bg-surface)",borderBottom:"1px solid var(--border)",padding:"14px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <button onClick={onVolverHubRrhh} style={btnSec}>&larr; Gestión de Personas</button>
          <div style={{fontSize:22}}>🏛️</div>
          <div>
            <div style={{fontSize:18,fontWeight:600}}>Organigrama</div>
            <div style={{fontSize:12,color:"var(--text-muted)"}}>Estructura de cargos · Outlet de Puertas</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:13,fontWeight:600}}>{cu.nombre}</div>
            <div style={{fontSize:11,color:rl(cu).c,fontWeight:600}}>{rl(cu).l}</div>
          </div>
          <button onClick={onCerrarSesion} style={btnGhost}>Salir</button>
        </div>
      </header>

      <main style={{padding:24,maxWidth:1100,margin:'0 auto'}}>
        {/* Stats + leyenda */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:16}}>
          <div style={{display:'flex',gap:14,flexWrap:'wrap',fontSize:12,color:'var(--text-muted)'}}>
            <span><strong style={{color:'var(--text)',fontSize:15}}>{stats.total}</strong> cargos</span>
            <span style={{color:ESTADOS.ocupado.c}}><strong>{stats.ocupados}</strong> ocupados</span>
            <span style={{color:ESTADOS.vacante.c}}><strong>{stats.vacantes}</strong> vacantes</span>
            <span style={{color:ESTADOS.propuesto.c}}><strong>{stats.propuestos}</strong> propuestos</span>
            <span><strong>{stats.porCrear}</strong> por crear</span>
            <span>· <strong style={{color:'var(--text)'}}>{stats.asignados}</strong>/{emps.length} empleados asignados</span>
          </div>
          <button onClick={()=>setModalCargo({ padre_id:null })} style={btnPri}>➕ Cargo raíz</button>
        </div>

        {msg && (
          <div style={{marginBottom:14,padding:'10px 14px',borderRadius:8,fontSize:13,
            background: msg.tipo==='error' ? '#FF3B3012' : '#34C75912',
            border: `1px solid ${msg.tipo==='error' ? '#FF3B3040' : '#34C75940'}`,
            display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>{msg.tipo==='error'?'⚠️':'✅'} {msg.txt}</span>
            <button onClick={()=>setMsg(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
          </div>
        )}

        {cargando ? (
          <div style={{padding:60,textAlign:'center',color:'var(--text-muted)'}}>Cargando organigrama...</div>
        ) : raices.length === 0 ? (
          <div style={{maxWidth:480,margin:'50px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'40px 28px'}}>
            <div style={{fontSize:48,marginBottom:12}}>🏛️</div>
            <h3 style={{margin:'0 0 6px 0'}}>Organigrama vacío</h3>
            <p style={{color:'var(--text-muted)',fontSize:13,margin:'0 0 20px 0'}}>
              Crea el primer cargo raíz (ej: Directorio) y construye el árbol hacia abajo,
              o corre el seed opcional de la migración.
            </p>
            <button onClick={()=>setModalCargo({ padre_id:null })} style={btnPri}>➕ Crear primer cargo</button>
          </div>
        ) : (
          <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'8px 0'}}>
            {raices.map(c => (
              <NodoCargo key={c.id} cargo={c} nivel={0}
                hijosDe={hijosDe} ocupantesDe={ocupantesDe}
                colapsados={colapsados} onToggle={toggleColapso}
                onNuevoHijo={p=>setModalCargo({ padre_id:p.id })}
                onEditar={c2=>setModalCargo({ padre_id:c2.cargo_padre_id, cargo:c2 })}
                onAsignar={setModalAsig}
                onDesactivar={desactivarCargo}
              />
            ))}
          </div>
        )}
      </main>

      {modalCargo && (
        <ModalCargo ctx={modalCargo} sucs={sucs} cu={cu}
          onCerrar={()=>setModalCargo(null)}
          onGuardado={async()=>{ setModalCargo(null); await cargar() }} />
      )}
      {modalAsig && (
        <ModalAsignar cargo={modalAsig} emps={emps} cu={cu}
          ocupantes={ocupantesDe[modalAsig.id]||[]}
          onCerrar={()=>setModalAsig(null)}
          onCambio={cargar} />
      )}
    </div>
  )
}

// ─── Nodo del árbol (recursivo) ───────────────────────────────────────────────
function NodoCargo({ cargo, nivel, hijosDe, ocupantesDe, colapsados, onToggle, onNuevoHijo, onEditar, onAsignar, onDesactivar }) {
  const hijos = hijosDe[cargo.id] || []
  const ocup  = ocupantesDe[cargo.id] || []
  const est   = ESTADOS[cargo.estado] || ESTADOS.vacante
  const colapsado = colapsados.has(cargo.id)

  return (
    <>
      <div style={{
        display:'flex',alignItems:'center',gap:10,padding:'8px 16px',
        paddingLeft: 16 + nivel*26,
        borderBottom:'1px solid var(--border)',
        borderLeft: `3px solid ${est.c}`,
        ...(cargo.estado==='por_crear' ? { opacity:0.75 } : {})
      }}>
        <button onClick={()=>hijos.length>0 && onToggle(cargo.id)}
          style={{background:'none',border:'none',cursor:hijos.length>0?'pointer':'default',
            width:18,fontSize:11,color:'var(--text-muted)',padding:0}}>
          {hijos.length > 0 ? (colapsado ? '▶' : '▼') : '·'}
        </button>

        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <span style={{fontWeight:600,fontSize:14,
              ...(cargo.estado==='por_crear' ? { border:'1px dashed var(--text-muted)', borderRadius:6, padding:'1px 8px' } : {})
            }}>{cargo.nombre}</span>
            <span style={{fontSize:10,fontWeight:700,padding:'1px 8px',borderRadius:100,background:est.bg,color:est.c}}>{est.l}</span>
            {cargo.area && <span style={{fontSize:11,color:'var(--text-muted)'}}>{cargo.area}</span>}
            {cargo.sucursal_id && <span style={{fontSize:10,fontWeight:600,padding:'1px 7px',borderRadius:100,background:'var(--accent)10',color:'var(--accent)'}}>{cargo.sucursal_id}</span>}
          </div>
          {ocup.length > 0 && (
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:4}}>
              {ocup.map(o => (
                <span key={o.id} style={{fontSize:11,padding:'2px 9px',borderRadius:100,background:'var(--bg-app)',border:'1px solid var(--border)'}}>
                  👤 {o.nombre}
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{display:'flex',gap:4,flexShrink:0}}>
          <button onClick={()=>onAsignar(cargo)}   title="Asignar personas" style={btnMini}>👤</button>
          <button onClick={()=>onNuevoHijo(cargo)} title="Agregar cargo hijo" style={btnMini}>➕</button>
          <button onClick={()=>onEditar(cargo)}    title="Editar cargo" style={btnMini}>✏️</button>
          <button onClick={()=>onDesactivar(cargo)} title="Desactivar cargo" style={{...btnMini,color:'#FF3B30'}}>🗑</button>
        </div>
      </div>

      {!colapsado && hijos.map(h => (
        <NodoCargo key={h.id} cargo={h} nivel={nivel+1}
          hijosDe={hijosDe} ocupantesDe={ocupantesDe}
          colapsados={colapsados} onToggle={onToggle}
          onNuevoHijo={onNuevoHijo} onEditar={onEditar}
          onAsignar={onAsignar} onDesactivar={onDesactivar} />
      ))}
    </>
  )
}

// ─── Modal crear / editar cargo ───────────────────────────────────────────────
function ModalCargo({ ctx, sucs, cu, onCerrar, onGuardado }) {
  const editando = !!ctx.cargo
  const [form, setForm] = useState({
    nombre:   ctx.cargo?.nombre || '',
    area:     ctx.cargo?.area || '',
    sucursal: ctx.cargo?.sucursal_id || '',
    estado:   ctx.cargo?.estado || 'vacante',
    orden:    ctx.cargo?.orden ?? 99,
    notas:    ctx.cargo?.notas || '',
  })
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  async function guardar() {
    if (!form.nombre.trim()) { setErr('El nombre es obligatorio'); return }
    setGuardando(true); setErr(null)
    try {
      const payload = {
        nombre: form.nombre.trim(),
        area: form.area.trim() || null,
        sucursal_id: form.sucursal || null,
        estado: form.estado,
        orden: Number(form.orden) || 99,
        notas: form.notas.trim() || null,
        updated_at: new Date().toISOString(),
      }
      let error
      if (editando) {
        ({ error } = await supabase.from('org_cargos').update(payload).eq('id', ctx.cargo.id))
      } else {
        ({ error } = await supabase.from('org_cargos').insert({ ...payload, cargo_padre_id: ctx.padre_id }))
      }
      if (error) throw error
      await onGuardado()
    } catch(e) { setErr(e.message); setGuardando(false) }
  }

  return (
    <Overlay onCerrar={onCerrar}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:14}}>
        {editando ? '✏️ Editar cargo' : ctx.padre_id ? '➕ Nuevo cargo hijo' : '➕ Nuevo cargo raíz'}
      </div>
      <div style={{display:'grid',gap:10,marginBottom:14}}>
        <div>
          <label style={lblM}>Nombre del cargo</label>
          <input value={form.nombre} onChange={e=>setForm(f=>({...f,nombre:e.target.value}))}
            placeholder="Ej: Jefe de Tienda La Granja" style={inpFull}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div>
            <label style={lblM}>Área</label>
            <input value={form.area} onChange={e=>setForm(f=>({...f,area:e.target.value}))}
              placeholder="Ej: Comercial" style={inpFull}/>
          </div>
          <div>
            <label style={lblM}>Sucursal (opcional)</label>
            <select value={form.sucursal} onChange={e=>setForm(f=>({...f,sucursal:e.target.value}))} style={inpFull}>
              <option value="">— Transversal —</option>
              {sucs.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:10}}>
          <div>
            <label style={lblM}>Estado</label>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {Object.entries(ESTADOS).map(([k,v])=>(
                <button key={k} onClick={()=>setForm(f=>({...f,estado:k}))} style={{
                  padding:'6px 12px',borderRadius:100,fontSize:12,fontWeight:600,cursor:'pointer',
                  background: form.estado===k ? v.bg : 'transparent',
                  color: form.estado===k ? v.c : 'var(--text-muted)',
                  border:`1px solid ${form.estado===k ? v.c : 'var(--border)'}`,
                }}>{v.l}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={lblM}>Orden</label>
            <input type="number" value={form.orden} onChange={e=>setForm(f=>({...f,orden:e.target.value}))} style={inpFull}/>
          </div>
        </div>
        <div>
          <label style={lblM}>Notas (opcional)</label>
          <textarea value={form.notas} onChange={e=>setForm(f=>({...f,notas:e.target.value}))} rows={2}
            placeholder="Ej: Ola 2 del roadmap — contratar post-apertura Maipú" style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
        </div>
      </div>
      {err && <div style={{fontSize:12,color:'#FF3B30',marginBottom:12}}>⚠️ {err}</div>}
      <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button onClick={onCerrar} disabled={guardando} style={btnSec}>Cancelar</button>
        <button onClick={guardar} disabled={guardando} style={btnPri}>{guardando?'Guardando...':'Guardar'}</button>
      </div>
    </Overlay>
  )
}

// ─── Modal asignar personas a un cargo ────────────────────────────────────────
function ModalAsignar({ cargo, emps, cu, ocupantes, onCerrar, onCambio }) {
  const [busq, setBusq] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [err, setErr] = useState(null)
  const [ocupLocal, setOcupLocal] = useState(ocupantes)

  const yaAsignados = new Set(ocupLocal.map(o=>o.cod_contaline))
  const candidatos = useMemo(() => {
    const q = busq.trim().toLowerCase()
    return emps
      .filter(e => !yaAsignados.has(e.cod_contaline))
      .filter(e => !q || e.nombre.toLowerCase().includes(q) || String(e.rut||'').includes(q))
      .slice(0, 8)
  }, [emps, busq, ocupLocal])

  async function refrescarLocal() {
    const { data } = await supabase.from('org_asignaciones').select('*').eq('cargo_id', cargo.id).eq('activo', true)
    const nom = Object.fromEntries(emps.map(e=>[e.cod_contaline, e.nombre]))
    setOcupLocal((data||[]).map(a=>({ ...a, nombre: nom[a.cod_contaline] || `#${a.cod_contaline}` })))
    await onCambio()
  }

  async function agregar(emp) {
    setTrabajando(true); setErr(null)
    try {
      const { error } = await supabase.from('org_asignaciones').insert({
        cargo_id: cargo.id, cod_contaline: emp.cod_contaline, asignado_por: cu.id
      })
      if (error) throw error
      // Al asignar, el cargo pasa a 'ocupado' automáticamente
      if (cargo.estado !== 'ocupado') {
        await supabase.from('org_cargos').update({ estado:'ocupado', updated_at:new Date().toISOString() }).eq('id', cargo.id)
        cargo.estado = 'ocupado'
      }
      setBusq('')
      await refrescarLocal()
    } catch(e) { setErr(e.message) }
    finally { setTrabajando(false) }
  }

  async function quitar(asig) {
    setTrabajando(true); setErr(null)
    try {
      const { error } = await supabase.from('org_asignaciones')
        .update({ activo:false, hasta:new Date().toISOString().slice(0,10) }).eq('id', asig.id)
      if (error) throw error
      // Si era el último ocupante, el cargo vuelve a 'vacante'
      if (ocupLocal.length === 1 && cargo.estado === 'ocupado') {
        await supabase.from('org_cargos').update({ estado:'vacante', updated_at:new Date().toISOString() }).eq('id', cargo.id)
        cargo.estado = 'vacante'
      }
      await refrescarLocal()
    } catch(e) { setErr(e.message) }
    finally { setTrabajando(false) }
  }

  return (
    <Overlay onCerrar={onCerrar}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:2}}>👤 Ocupantes del cargo</div>
      <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:16}}>{cargo.nombre}{cargo.area?` · ${cargo.area}`:''}</div>

      {ocupLocal.length > 0 ? (
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
          {ocupLocal.map(o => (
            <div key={o.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',background:'var(--bg-app)',borderRadius:8,border:'1px solid var(--border)'}}>
              <span style={{fontSize:13,fontWeight:500}}>{o.nombre}</span>
              <button onClick={()=>quitar(o)} disabled={trabajando}
                style={{background:'none',border:'none',cursor:'pointer',color:'#FF3B30',fontSize:12,fontWeight:600}}>Quitar</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{fontSize:13,color:'var(--text-muted)',marginBottom:16,fontStyle:'italic'}}>Sin ocupantes — cargo vacante.</div>
      )}

      <div style={{marginBottom:6}}>
        <label style={lblM}>Agregar empleado</label>
        <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder="Buscar por nombre o RUT..." style={inpFull}/>
      </div>
      {busq.trim() && (
        <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:12,maxHeight:220,overflowY:'auto'}}>
          {candidatos.length === 0 && <div style={{fontSize:12,color:'var(--text-muted)',padding:8}}>Sin coincidencias</div>}
          {candidatos.map(e => (
            <button key={e.cod_contaline} onClick={()=>agregar(e)} disabled={trabajando}
              style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',textAlign:'left'}}>
              <span style={{fontSize:13}}>{e.nombre}</span>
              <span style={{fontSize:11,color:'var(--text-muted)'}}>{e.sucursal_id||''} {e.cargo?`· ${e.cargo}`:''}</span>
            </button>
          ))}
        </div>
      )}

      {err && <div style={{fontSize:12,color:'#FF3B30',marginBottom:12}}>⚠️ {err}</div>}
      <div style={{display:'flex',justifyContent:'flex-end'}}>
        <button onClick={onCerrar} style={btnSec}>Cerrar</button>
      </div>
    </Overlay>
  )
}

// ─── UI compartida ────────────────────────────────────────────────────────────
function Overlay({ children, onCerrar }) {
  return (
    <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-surface)',borderRadius:14,padding:24,width:'100%',maxWidth:480,border:'1px solid var(--border)',maxHeight:'85vh',overflowY:'auto'}}>
        {children}
      </div>
    </div>
  )
}

const btnPri   = {padding:'9px 16px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}
const btnSec   = {padding:'8px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:500}
const btnGhost = {padding:'8px 14px',background:'transparent',color:'var(--text-muted)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}
const btnMini  = {background:'none',border:'1px solid var(--border)',borderRadius:6,cursor:'pointer',fontSize:12,padding:'3px 7px'}
const lblM     = {display:'block',fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.04em'}
const inpFull  = {padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit',width:'100%',boxSizing:'border-box'}
