// src/rrhh/organigrama/OrganigramaApp.jsx  (v2 — canvas interactivo)
// Organigrama jerárquico — Outlet de Puertas
// Lienzo con pan/zoom · nodos conectados · ficha lateral de cargo con
// perfil del ocupante (rrhh_empleados) · búsqueda con auto-expansión.
// Estados (código de colores del directorio):
//   ocupado=verde · vacante=rojo · propuesto=amarillo · por_crear=punteado
// La vista v_org_equipo (SQL) deriva de aquí los equipos del scope RBAC 'equipo'.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../../supabase'

const ESTADOS = {
  ocupado:   { l:'Ocupado',   c:'#34C759' },
  vacante:   { l:'Vacante',   c:'#FF3B30' },
  propuesto: { l:'Propuesto', c:'#FF9500' },
  por_crear: { l:'Por crear', c:'#8E8E93' },
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

const iniciales = n => String(n||'?').trim().split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase()
const fFecha = d => { if(!d) return '—'; const [y,m,dd]=String(d).slice(0,10).split('-'); return `${dd}-${m}-${y}` }

// Paleta determinista para avatares
const AV_COLORS = ['#5856D6','#007AFF','#34C759','#FF9500','#AF52DE','#FF2D55','#00B8A9','#8E6CEF']
const avColor = cod => AV_COLORS[Math.abs(Number(cod)||0) % AV_COLORS.length]

const OC_CSS = `
.oc-viewport { position:relative; overflow:hidden; border-radius:14px;
  --oc-line: color-mix(in srgb, var(--text-muted) 70%, var(--accent) 30%);
  background:
  radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--border) 55%, transparent) 1px, transparent 0);
  background-size: 26px 26px; background-color: var(--bg-app);
  border:1px solid var(--border); cursor:grab; user-select:none; }
.oc-viewport.arrastrando { cursor:grabbing; }
.oc-canvas { position:absolute; top:0; left:0; transform-origin:0 0; will-change:transform; }
.oc-nodo { display:flex; flex-direction:column; align-items:center; }
.oc-hijos { display:flex; align-items:flex-start; }
/* ── Conectores tipo codo ──
   Cada rama dibuja su mitad del riel superior; el hijo del extremo
   redondea la esquina y baja en vertical hasta su tarjeta. */
.oc-rama { display:flex; flex-direction:column; align-items:center; position:relative; padding:30px 12px 0; }
.oc-rama::before, .oc-rama::after { content:''; position:absolute; top:0; height:30px; box-sizing:border-box; }
.oc-rama::before { right:50%; width:50%; border-top:2px solid var(--oc-line); }
.oc-rama::after  { left:50%;  width:50%; border-top:2px solid var(--oc-line); border-left:2px solid var(--oc-line); }
.oc-rama:first-child::before { border:0; }
.oc-rama:last-child::after   { border:0; }
.oc-rama:last-child::before  { border-right:2px solid var(--oc-line); border-radius:0 12px 0 0; }
.oc-rama:first-child::after  { border-radius:12px 0 0 0; }
.oc-rama:only-child::before  { display:none; }
.oc-rama:only-child::after   { border:0; border-left:2px solid var(--oc-line); border-radius:0; }
.oc-stub { width:2px; height:12px; background:var(--oc-line); }
.oc-card { position:relative; width:216px; background:var(--bg-surface); border:1px solid var(--border);
  border-radius:12px; padding:10px 12px 10px 15px; text-align:left; cursor:pointer;
  transition: box-shadow .15s ease, transform .15s ease, border-color .15s ease;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
.oc-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.12); }
.oc-card.sel { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent), 0 6px 18px rgba(0,0,0,0.12); }
.oc-card.hit { box-shadow: 0 0 0 3px #FF950055, 0 6px 18px rgba(0,0,0,0.12); }
.oc-card.punteado { border-style:dashed; opacity:.82; }
.oc-spine { position:absolute; left:0; top:10px; bottom:10px; width:4px; border-radius:4px; }
.oc-colapsar { font-size:10px; font-weight:700; padding:2px 10px; border-radius:100px;
  border:1.5px solid var(--oc-line); background:var(--bg-surface); color:var(--text-muted); cursor:pointer; }
.oc-colapsar:hover { color:var(--text); border-color:var(--text-muted); }
.oc-drawer { position:fixed; top:0; right:0; bottom:0; width:392px; max-width:92vw; z-index:300;
  background:var(--bg-surface); border-left:1px solid var(--border);
  box-shadow:-12px 0 32px rgba(0,0,0,0.14); display:flex; flex-direction:column;
  animation: ocSlide .18s ease; }
@keyframes ocSlide { from { transform:translateX(24px); opacity:0 } to { transform:none; opacity:1 } }
@media (prefers-reduced-motion: reduce) {
  .oc-card, .oc-drawer { transition:none; animation:none; }
}
`

export function OrganigramaApp({ cu, onVolverHubRrhh, onCerrarSesion }) {
  const [cargos, setCargos] = useState([])
  const [asigs, setAsigs]   = useState([])
  const [emps, setEmps]     = useState([])
  const [sucs, setSucs]     = useState([])
  const [cargando, setCarg] = useState(true)
  const [msg, setMsg]       = useState(null)

  const [selId, setSelId]         = useState(null)
  const [colapsados, setColaps]   = useState(new Set())
  const [busq, setBusq]           = useState('')
  const [modalCargo, setModalCargo] = useState(null)  // { padre_id, cargo? }

  // ── Pan / Zoom ──
  const [view, setView] = useState({ x: 60, y: 30, k: 0.85 })
  const [drag, setDrag] = useState(null)
  const vpRef = useRef(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setCarg(true)
    try {
      const [c, a, e, s] = await Promise.all([
        supabase.from('org_cargos').select('*').eq('activo', true).order('orden').order('nombre'),
        supabase.from('org_asignaciones').select('*').eq('activo', true),
        supabase.from('rrhh_empleados').select('cod_contaline,nombre,rut,sucursal_id,cargo,fecha_ingreso,activo').eq('activo', true).order('nombre'),
        supabase.from('sucursales').select('id,nombre').order('nombre'),
      ])
      if (c.error) throw c.error
      if (a.error) throw a.error
      setCargos(c.data||[]); setAsigs(a.data||[]); setEmps(e.data||[]); setSucs(s.data||[])
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
    finally { setCarg(false) }
  }

  // ── Índices ──
  const empPorCod = useMemo(() => Object.fromEntries(emps.map(e=>[e.cod_contaline, e])), [emps])
  const cargoPorId = useMemo(() => Object.fromEntries(cargos.map(c=>[c.id, c])), [cargos])

  const hijosDe = useMemo(() => {
    const m = {}
    for (const c of cargos) { const k = c.cargo_padre_id ?? 'root'; (m[k] = m[k]||[]).push(c) }
    return m
  }, [cargos])

  const ocupantesDe = useMemo(() => {
    const m = {}
    for (const a of asigs) (m[a.cargo_id] = m[a.cargo_id]||[]).push({ ...a, emp: empPorCod[a.cod_contaline] })
    return m
  }, [asigs, empPorCod])

  const cargosDePersona = useMemo(() => {
    const m = {}
    for (const a of asigs) {
      const c = cargoPorId[a.cargo_id]
      if (c) (m[a.cod_contaline] = m[a.cod_contaline]||[]).push(c)
    }
    return m
  }, [asigs, cargoPorId])

  const stats = useMemo(() => ({
    total: cargos.length,
    ocupados:   cargos.filter(c=>c.estado==='ocupado').length,
    vacantes:   cargos.filter(c=>c.estado==='vacante').length,
    propuestos: cargos.filter(c=>c.estado==='propuesto').length,
    porCrear:   cargos.filter(c=>c.estado==='por_crear').length,
    asignados:  new Set(asigs.map(a=>a.cod_contaline)).size,
  }), [cargos, asigs])

  // ── Búsqueda: ids que calzan + ancestros a expandir ──
  const { hits, expandidosPorBusq } = useMemo(() => {
    const q = busq.trim().toLowerCase()
    if (!q) return { hits: new Set(), expandidosPorBusq: null }
    const hits = new Set()
    for (const c of cargos) {
      const ocupNombres = (ocupantesDe[c.id]||[]).map(o=>o.emp?.nombre||'').join(' ')
      if (`${c.nombre} ${c.area||''} ${c.notas||''} ${ocupNombres}`.toLowerCase().includes(q)) hits.add(c.id)
    }
    const exp = new Set()
    for (const id of hits) {
      let p = cargoPorId[id]?.cargo_padre_id
      while (p != null) { exp.add(p); p = cargoPorId[p]?.cargo_padre_id }
    }
    return { hits, expandidosPorBusq: exp }
  }, [busq, cargos, ocupantesDe, cargoPorId])

  const estaColapsado = useCallback(id => {
    if (expandidosPorBusq) return false            // buscando: todo visible
    return colapsados.has(id)
  }, [colapsados, expandidosPorBusq])

  // ── Pan / zoom handlers ──
  function onPointerDown(e) {
    if (e.target.closest('[data-card]') || e.target.closest('button')) return
    setDrag({ sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y })
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e) {
    if (!drag) return
    setView(v => ({ ...v, x: drag.ox + (e.clientX - drag.sx), y: drag.oy + (e.clientY - drag.sy) }))
  }
  function onPointerUp() { setDrag(null) }

  const zoom = dir => setView(v => ({ ...v, k: Math.min(1.6, Math.max(0.3, v.k * (dir>0?1.18:0.847))) }))
  const ajustar = () => setView({ x: 60, y: 30, k: 0.85 })

  useEffect(() => {
    const el = vpRef.current
    if (!el) return
    const onWheel = e => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        setView(v => ({ ...v, k: Math.min(1.6, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.1 : 0.909))) }))
      } else {
        setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  function toggleColapso(id) {
    setColaps(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const colapsarTodo = () => setColaps(new Set(cargos.filter(c=>(hijosDe[c.id]||[]).length>0 && c.cargo_padre_id!=null).map(c=>c.id)))
  const expandirTodo = () => setColaps(new Set())

  async function desactivarCargo(cargo) {
    const nH = (hijosDe[cargo.id]||[]).length
    const nO = (ocupantesDe[cargo.id]||[]).length
    if (nH > 0) { setMsg({tipo:'error', txt:`"${cargo.nombre}" tiene ${nH} cargo(s) dependiente(s). Muévelos o desactívalos primero.`}); return }
    if (nO > 0) { setMsg({tipo:'error', txt:`"${cargo.nombre}" tiene ${nO} ocupante(s). Quítalos primero.`}); return }
    if (!window.confirm(`¿Desactivar el cargo "${cargo.nombre}"?`)) return
    try {
      const { error } = await supabase.from('org_cargos')
        .update({ activo:false, updated_at:new Date().toISOString() }).eq('id', cargo.id)
      if (error) throw error
      setSelId(null)
      await cargar()
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }

  async function cambiarEstado(cargo, estado) {
    try {
      const { error } = await supabase.from('org_cargos')
        .update({ estado, updated_at:new Date().toISOString() }).eq('id', cargo.id)
      if (error) throw error
      await cargar()
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }

  const raices = hijosDe['root'] || []
  const sel = selId != null ? cargoPorId[selId] : null

  return (
    <div style={{minHeight:"100vh",background:"var(--bg-app)",display:'flex',flexDirection:'column'}}>
      <style>{OC_CSS}</style>

      <header style={{background:"var(--bg-surface)",borderBottom:"1px solid var(--border)",padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:'wrap',position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <button onClick={onVolverHubRrhh} style={btnSec}>&larr; Gestión de Personas</button>
          <div style={{fontSize:22}}>🏛️</div>
          <div>
            <div style={{fontSize:17,fontWeight:600}}>Organigrama 2026/2027</div>
            <div style={{fontSize:11,color:"var(--text-muted)"}}>Casa Matriz · 3 tiendas · CD Maipú</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <input value={busq} onChange={e=>setBusq(e.target.value)}
            placeholder="🔎 Buscar cargo o persona..."
            style={{...inpBase,width:230}}/>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:13,fontWeight:600}}>{cu.nombre}</div>
              <div style={{fontSize:11,color:rl(cu).c,fontWeight:600}}>{rl(cu).l}</div>
            </div>
            <button onClick={onCerrarSesion} style={btnGhost}>Salir</button>
          </div>
        </div>
      </header>

      {/* Barra de stats + controles */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,padding:'10px 24px'}}>
        <div style={{display:'flex',gap:14,flexWrap:'wrap',alignItems:'center',fontSize:12,color:'var(--text-muted)'}}>
          <span><strong style={{color:'var(--text)',fontSize:15}}>{stats.total}</strong> cargos</span>
          {Object.entries(ESTADOS).map(([k,v])=>(
            <span key={k} style={{display:'inline-flex',alignItems:'center',gap:5}}>
              <span style={{width:8,height:8,borderRadius:100,background:v.c,display:'inline-block',
                ...(k==='por_crear'?{background:'transparent',border:`1.5px dashed ${v.c}`}:{})}}/>
              <strong style={{color:v.c}}>{k==='ocupado'?stats.ocupados:k==='vacante'?stats.vacantes:k==='propuesto'?stats.propuestos:stats.porCrear}</strong> {v.l.toLowerCase()}
            </span>
          ))}
          <span>· <strong style={{color:'var(--text)'}}>{stats.asignados}</strong>/{emps.length} personas asignadas</span>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <button onClick={()=>zoom(-1)} style={btnCtl} title="Alejar">−</button>
          <span style={{fontSize:11,color:'var(--text-muted)',minWidth:38,textAlign:'center'}}>{Math.round(view.k*100)}%</span>
          <button onClick={()=>zoom(1)} style={btnCtl} title="Acercar">+</button>
          <button onClick={ajustar} style={btnCtl} title="Restablecer vista">⌂</button>
          <span style={{width:1,height:20,background:'var(--border)'}}/>
          <button onClick={expandirTodo} style={btnCtl} title="Expandir todo">⊞</button>
          <button onClick={colapsarTodo} style={btnCtl} title="Colapsar ramas">⊟</button>
          <span style={{width:1,height:20,background:'var(--border)'}}/>
          <button onClick={()=>setModalCargo({ padre_id:null })} style={btnPri}>➕ Cargo raíz</button>
        </div>
      </div>

      {msg && (
        <div style={{margin:'0 24px 10px',padding:'9px 14px',borderRadius:8,fontSize:13,
          background: msg.tipo==='error' ? '#FF3B3012' : '#34C75912',
          border: `1px solid ${msg.tipo==='error' ? '#FF3B3040' : '#34C75940'}`,
          display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>{msg.tipo==='error'?'⚠️':'✅'} {msg.txt}</span>
          <button onClick={()=>setMsg(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
        </div>
      )}

      {/* Lienzo */}
      <div style={{flex:1,padding:'0 24px 24px',minHeight:0}}>
        {cargando ? (
          <div style={{padding:80,textAlign:'center',color:'var(--text-muted)'}}>Cargando organigrama...</div>
        ) : raices.length === 0 ? (
          <div style={{maxWidth:480,margin:'60px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'40px 28px'}}>
            <div style={{fontSize:48,marginBottom:12}}>🏛️</div>
            <h3 style={{margin:'0 0 6px 0'}}>Organigrama vacío</h3>
            <p style={{color:'var(--text-muted)',fontSize:13,margin:'0 0 20px 0'}}>Crea el primer cargo raíz o corre el seed de la estructura 2026/2027.</p>
            <button onClick={()=>setModalCargo({ padre_id:null })} style={btnPri}>➕ Crear primer cargo</button>
          </div>
        ) : (
          <div ref={vpRef} className={`oc-viewport ${drag?'arrastrando':''}`}
            style={{height:'calc(100vh - 190px)',minHeight:420}}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <div className="oc-canvas" style={{transform:`translate(${view.x}px, ${view.y}px) scale(${view.k})`}}>
              <div style={{display:'flex',gap:60,alignItems:'flex-start',padding:'10px 40px 80px'}}>
                {raices.map(c => (
                  <Nodo key={c.id} cargo={c}
                    hijosDe={hijosDe} ocupantesDe={ocupantesDe}
                    estaColapsado={estaColapsado} onToggle={toggleColapso}
                    selId={selId} hits={hits} onSel={setSelId} />
                ))}
              </div>
            </div>
            <div style={{position:'absolute',bottom:10,left:14,fontSize:10.5,color:'var(--text-muted)',pointerEvents:'none'}}>
              Arrastra para mover · rueda para desplazar · Ctrl+rueda para zoom · clic en un cargo para ver su ficha
            </div>
          </div>
        )}
      </div>

      {/* Ficha lateral */}
      {sel && (
        <FichaCargo
          cargo={sel} cu={cu}
          ocupantes={ocupantesDe[sel.id]||[]}
          hijos={hijosDe[sel.id]||[]}
          padre={sel.cargo_padre_id != null ? cargoPorId[sel.cargo_padre_id] : null}
          emps={emps} cargosDePersona={cargosDePersona}
          onCerrar={()=>setSelId(null)}
          onEditar={()=>setModalCargo({ padre_id: sel.cargo_padre_id, cargo: sel })}
          onNuevoHijo={()=>setModalCargo({ padre_id: sel.id })}
          onDesactivar={()=>desactivarCargo(sel)}
          onCambiarEstado={est=>cambiarEstado(sel, est)}
          onCambio={cargar}
          onIrACargo={setSelId}
        />
      )}

      {modalCargo && (
        <ModalCargo ctx={modalCargo} sucs={sucs}
          onCerrar={()=>setModalCargo(null)}
          onGuardado={async()=>{ setModalCargo(null); await cargar() }} />
      )}
    </div>
  )
}

// ─── Nodo del lienzo (recursivo) ──────────────────────────────────────────────
function Nodo({ cargo, hijosDe, ocupantesDe, estaColapsado, onToggle, selId, hits, onSel }) {
  const hijos = hijosDe[cargo.id] || []
  const ocup  = ocupantesDe[cargo.id] || []
  const est   = ESTADOS[cargo.estado] || ESTADOS.vacante
  const colapsado = estaColapsado(cargo.id)
  const clases = ['oc-card',
    selId === cargo.id ? 'sel' : '',
    hits.has(cargo.id) ? 'hit' : '',
    cargo.estado === 'por_crear' ? 'punteado' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className="oc-nodo">
      <div data-card className={clases} onClick={()=>onSel(cargo.id)} role="button" tabIndex={0}
        onKeyDown={e=>{ if(e.key==='Enter') onSel(cargo.id) }}>
        <span className="oc-spine" style={{background: cargo.estado==='por_crear' ? 'transparent' : est.c,
          border: cargo.estado==='por_crear' ? `1.5px dashed ${est.c}` : 'none'}}/>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:6}}>
          <div style={{fontSize:12.5,fontWeight:700,lineHeight:1.25}}>{cargo.nombre}</div>
          <span style={{fontSize:9,fontWeight:800,padding:'2px 7px',borderRadius:100,whiteSpace:'nowrap',
            background:`${est.c}18`,color:est.c,flexShrink:0}}>{est.l}</span>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center',marginTop:4,fontSize:10,color:'var(--text-muted)'}}>
          {cargo.area && <span>{cargo.area}</span>}
          {cargo.sucursal_id && <span style={{fontWeight:700,color:'var(--accent)'}}>{cargo.sucursal_id}</span>}
        </div>
        <div style={{display:'flex',alignItems:'center',marginTop:7,minHeight:22}}>
          {ocup.length > 0 ? (
            <>
              <div style={{display:'flex'}}>
                {ocup.slice(0,4).map((o,i)=>(
                  <span key={o.id} title={o.emp?.nombre} style={{
                    width:22,height:22,borderRadius:100,background:avColor(o.cod_contaline),color:'white',
                    fontSize:8.5,fontWeight:800,display:'inline-flex',alignItems:'center',justifyContent:'center',
                    border:'2px solid var(--bg-surface)',marginLeft:i===0?0:-7}}>
                    {iniciales(o.emp?.nombre)}
                  </span>
                ))}
              </div>
              <span style={{fontSize:10.5,color:'var(--text)',marginLeft:6,fontWeight:600,
                whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:120}}>
                {ocup.length===1 ? (ocup[0].emp?.nombre||'').split(' ').slice(0,2).join(' ') : `${ocup.length} personas`}
              </span>
            </>
          ) : (
            <span style={{fontSize:10.5,color:'var(--text-muted)',fontStyle:'italic'}}>Sin ocupante</span>
          )}
        </div>
      </div>

      {hijos.length > 0 && (
        <>
          <div className="oc-stub"/>
          <button className="oc-colapsar" onClick={e=>{e.stopPropagation(); onToggle(cargo.id)}}>
            {colapsado ? `▸ ${hijos.length}` : '▾'}
          </button>
          {!colapsado && (
            <>
              <div className="oc-hijos">
                {hijos.map(h => (
                  <div key={h.id} className="oc-rama">
                    <Nodo cargo={h} hijosDe={hijosDe} ocupantesDe={ocupantesDe}
                      estaColapsado={estaColapsado} onToggle={onToggle}
                      selId={selId} hits={hits} onSel={onSel}/>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Ficha lateral de cargo ───────────────────────────────────────────────────
function FichaCargo({ cargo, cu, ocupantes, hijos, padre, emps, cargosDePersona,
                      onCerrar, onEditar, onNuevoHijo, onDesactivar, onCambiarEstado, onCambio, onIrACargo }) {
  const est = ESTADOS[cargo.estado] || ESTADOS.vacante
  const [busq, setBusq] = useState('')
  const [trabajando, setTrab] = useState(false)
  const [err, setErr] = useState(null)
  const [perfilAbierto, setPerfil] = useState(null)  // cod_contaline

  useEffect(() => { setBusq(''); setErr(null); setPerfil(ocupantes.length===1 ? ocupantes[0].cod_contaline : null) }, [cargo.id])

  const yaAsig = new Set(ocupantes.map(o=>o.cod_contaline))
  const candidatos = useMemo(() => {
    const q = busq.trim().toLowerCase()
    if (!q) return []
    return emps.filter(e => !yaAsig.has(e.cod_contaline))
      .filter(e => e.nombre.toLowerCase().includes(q) || String(e.rut||'').includes(q))
      .slice(0, 6)
  }, [busq, emps, ocupantes])

  async function agregar(emp) {
    setTrab(true); setErr(null)
    try {
      const { error } = await supabase.from('org_asignaciones').insert({
        cargo_id: cargo.id, cod_contaline: emp.cod_contaline, asignado_por: cu.id
      })
      if (error) throw error
      if (cargo.estado !== 'ocupado') await onCambiarEstado('ocupado')
      else await onCambio()
      setBusq('')
    } catch(e) { setErr(e.message) }
    finally { setTrab(false) }
  }

  async function quitar(asig) {
    setTrab(true); setErr(null)
    try {
      const { error } = await supabase.from('org_asignaciones')
        .update({ activo:false, hasta:new Date().toISOString().slice(0,10) }).eq('id', asig.id)
      if (error) throw error
      if (ocupantes.length === 1 && cargo.estado === 'ocupado') await onCambiarEstado('vacante')
      else await onCambio()
    } catch(e) { setErr(e.message) }
    finally { setTrab(false) }
  }

  return (
    <div className="oc-drawer">
      {/* Encabezado */}
      <div style={{padding:'16px 18px 14px',borderBottom:'1px solid var(--border)',
        background:`linear-gradient(135deg, ${est.c}14, transparent 60%)`}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
          <div>
            <div style={{fontSize:16,fontWeight:800,lineHeight:1.25}}>{cargo.nombre}</div>
            <div style={{fontSize:11.5,color:'var(--text-muted)',marginTop:3}}>
              {cargo.area||'—'} {cargo.sucursal_id && <>· <strong style={{color:'var(--accent)'}}>{cargo.sucursal_id}</strong></>}
              {padre && <> · reporta a <button onClick={()=>onIrACargo(padre.id)}
                style={{background:'none',border:'none',padding:0,cursor:'pointer',color:'var(--accent)',fontSize:11.5,fontWeight:600,textDecoration:'underline'}}>{padre.nombre}</button></>}
            </div>
          </div>
          <button onClick={onCerrar} style={{background:'none',border:'none',cursor:'pointer',fontSize:16,color:'var(--text-muted)',padding:2}}>✕</button>
        </div>
        {/* Estado — cambio rápido */}
        <div style={{display:'flex',gap:5,marginTop:12,flexWrap:'wrap'}}>
          {Object.entries(ESTADOS).map(([k,v])=>(
            <button key={k} onClick={()=>cargo.estado!==k && onCambiarEstado(k)} style={{
              padding:'4px 11px',borderRadius:100,fontSize:11,fontWeight:700,cursor:'pointer',
              background: cargo.estado===k ? `${v.c}20` : 'transparent',
              color: cargo.estado===k ? v.c : 'var(--text-muted)',
              border:`1px ${k==='por_crear'?'dashed':'solid'} ${cargo.estado===k ? v.c : 'var(--border)'}`,
            }}>{v.l}</button>
          ))}
        </div>
      </div>

      {/* Cuerpo */}
      <div style={{flex:1,overflowY:'auto',padding:'14px 18px'}}>
        {cargo.notas && (
          <div style={{fontSize:12,color:'var(--text-muted)',background:'var(--bg-app)',borderRadius:8,padding:'8px 11px',marginBottom:14,borderLeft:`3px solid ${est.c}`}}>
            {cargo.notas}
          </div>
        )}

        <div style={secTitulo}>Ocupantes ({ocupantes.length})</div>
        {ocupantes.length === 0 && (
          <div style={{fontSize:12.5,color:'var(--text-muted)',fontStyle:'italic',marginBottom:10}}>
            Cargo sin ocupante — usa el buscador para asignar a alguien.
          </div>
        )}
        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
          {ocupantes.map(o => {
            const e = o.emp
            const abierto = perfilAbierto === o.cod_contaline
            const otros = (cargosDePersona[o.cod_contaline]||[]).filter(c=>c && c.id!==cargo.id)
            return (
              <div key={o.id} style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'}}>
                <button onClick={()=>setPerfil(abierto?null:o.cod_contaline)}
                  style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:'9px 11px',
                    background:'var(--bg-app)',border:'none',cursor:'pointer',textAlign:'left'}}>
                  <span style={{width:32,height:32,borderRadius:100,background:avColor(o.cod_contaline),color:'white',
                    fontSize:11,fontWeight:800,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {iniciales(e?.nombre)}
                  </span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e?.nombre || `#${o.cod_contaline}`}</div>
                    <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{e?.cargo || 'Sin cargo contractual'} {e?.sucursal_id?`· ${e.sucursal_id}`:''}</div>
                  </div>
                  <span style={{fontSize:11,color:'var(--text-muted)'}}>{abierto?'▴':'▾'}</span>
                </button>
                {abierto && (
                  <div style={{padding:'10px 12px',fontSize:12,display:'grid',gap:6}}>
                    <PerfilFila l="RUT" v={e?.rut || '—'}/>
                    <PerfilFila l="Sucursal" v={e?.sucursal_id || '—'}/>
                    <PerfilFila l="Cargo contractual" v={e?.cargo || '—'}/>
                    <PerfilFila l="Fecha de ingreso" v={fFecha(e?.fecha_ingreso)}/>
                    <PerfilFila l="En este cargo desde" v={fFecha(o.desde)}/>
                    {otros.length > 0 && (
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>También ocupa</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                          {otros.map(c=>(
                            <button key={c.id} onClick={()=>onIrACargo(c.id)}
                              style={{fontSize:11,padding:'3px 9px',borderRadius:100,cursor:'pointer',
                                background:'var(--bg-app)',border:'1px solid var(--border)',color:'var(--accent)',fontWeight:600}}>
                              {c.nombre}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{display:'flex',justifyContent:'flex-end',marginTop:2}}>
                      <button onClick={()=>quitar(o)} disabled={trabajando}
                        style={{background:'none',border:'none',cursor:'pointer',color:'#FF3B30',fontSize:11.5,fontWeight:700}}>
                        Quitar del cargo
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={secTitulo}>Asignar persona</div>
        <input value={busq} onChange={e=>setBusq(e.target.value)}
          placeholder="Buscar por nombre o RUT..." style={{...inpBase,width:'100%',boxSizing:'border-box',marginBottom:8}}/>
        {busq.trim() && (
          <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:14}}>
            {candidatos.length === 0 && <div style={{fontSize:12,color:'var(--text-muted)',padding:6}}>Sin coincidencias entre los empleados activos</div>}
            {candidatos.map(e => (
              <button key={e.cod_contaline} onClick={()=>agregar(e)} disabled={trabajando}
                style={{display:'flex',alignItems:'center',gap:9,padding:'7px 10px',background:'var(--bg-app)',
                  border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',textAlign:'left'}}>
                <span style={{width:24,height:24,borderRadius:100,background:avColor(e.cod_contaline),color:'white',
                  fontSize:9,fontWeight:800,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  {iniciales(e.nombre)}
                </span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12.5,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.nombre}</div>
                  <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{e.sucursal_id||''} {e.cargo?`· ${e.cargo}`:''}</div>
                </div>
                <span style={{fontSize:11,fontWeight:700,color:'var(--accent)'}}>Asignar</span>
              </button>
            ))}
          </div>
        )}

        {hijos.length > 0 && (
          <>
            <div style={secTitulo}>Reportes directos ({hijos.length})</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:14}}>
              {hijos.map(h=>(
                <button key={h.id} onClick={()=>onIrACargo(h.id)}
                  style={{fontSize:11,padding:'4px 10px',borderRadius:100,cursor:'pointer',
                    background:'var(--bg-app)',border:`1px solid ${ESTADOS[h.estado]?.c||'var(--border)'}55`,fontWeight:600}}>
                  <span style={{color:ESTADOS[h.estado]?.c}}>●</span> {h.nombre}
                </button>
              ))}
            </div>
          </>
        )}

        {err && <div style={{fontSize:12,color:'#FF3B30',marginTop:4}}>⚠️ {err}</div>}
      </div>

      {/* Pie de acciones */}
      <div style={{padding:'12px 18px',borderTop:'1px solid var(--border)',display:'flex',gap:8}}>
        <button onClick={onEditar} style={{...btnSec,flex:1}}>✏️ Editar</button>
        <button onClick={onNuevoHijo} style={{...btnSec,flex:1}}>➕ Cargo hijo</button>
        <button onClick={onDesactivar} style={{...btnSec,color:'#FF3B30',borderColor:'#FF3B3040'}}>🗑</button>
      </div>
    </div>
  )
}

function PerfilFila({ l, v }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',gap:10}}>
      <span style={{color:'var(--text-muted)'}}>{l}</span>
      <span style={{fontWeight:600,textAlign:'right'}}>{v}</span>
    </div>
  )
}

// ─── Modal crear / editar cargo ───────────────────────────────────────────────
function ModalCargo({ ctx, sucs, onCerrar, onGuardado }) {
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
    <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-surface)',borderRadius:14,padding:24,width:'100%',maxWidth:480,border:'1px solid var(--border)',maxHeight:'85vh',overflowY:'auto'}}>
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
                    background: form.estado===k ? `${v.c}18` : 'transparent',
                    color: form.estado===k ? v.c : 'var(--text-muted)',
                    border:`1px ${k==='por_crear'?'dashed':'solid'} ${form.estado===k ? v.c : 'var(--border)'}`,
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
      </div>
    </div>
  )
}

// ─── Estilos base ─────────────────────────────────────────────────────────────
const btnPri   = {padding:'8px 15px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}
const btnSec   = {padding:'8px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:500}
const btnGhost = {padding:'8px 14px',background:'transparent',color:'var(--text-muted)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}
const btnCtl   = {width:30,height:30,display:'inline-flex',alignItems:'center',justifyContent:'center',background:'var(--bg-surface)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:14,fontWeight:600}
const lblM     = {display:'block',fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.04em'}
const inpBase  = {padding:'8px 11px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-surface)',color:'var(--text)',fontFamily:'inherit'}
const inpFull  = {padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit',width:'100%',boxSizing:'border-box'}
const secTitulo = {fontSize:10.5,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}
