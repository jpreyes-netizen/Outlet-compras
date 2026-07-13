import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { canSync, preloadCaps } from '../core/permisos'
import { parsearBoletas } from './parserBoletas'

const fmt = n => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n||0)
const RUT_OUTLET = '77.599.587-4'
const CM_SOCIOS = '761'   // cuenta madre remuneración socios (oculta sin capability)

export function RemuneracionesHonorarios({ cu }) {
  const [tab, setTab] = useState('cargar') // cargar | boletas | prestadores
  useEffect(() => { preloadCaps(cu, 'rrhh') }, [cu])
  const verSocios = canSync(cu, 'rrhh', 'rrhh.rem.ver_socios')
  return (
    <div style={{maxWidth:1400,margin:"0 auto"}}>
      <div style={{marginBottom:20}}>
        <h2 style={{margin:0,fontSize:22}}>💼 Boletas de Honorarios</h2>
        <p style={{color:"var(--text-muted)",margin:"4px 0 0 0",fontSize:14}}>
          Registro de servicios pagados por boleta — costo empresa adicional a las liquidaciones
        </p>
      </div>

      <div style={{display:"flex",gap:4,marginBottom:20,background:"var(--bg-surface)",padding:4,borderRadius:10,border:"1px solid var(--border)",width:"fit-content"}}>
        {[['cargar','📤 Cargar boletas'],['boletas','📋 Boletas registradas'],['prestadores','👤 Prestadores']].map(([k,l]) => (
          <button key={k} onClick={()=>setTab(k)} style={{
            padding:"8px 16px",border:"none",borderRadius:7,cursor:"pointer",fontSize:13,fontWeight:600,
            background: tab===k?"var(--accent)":"transparent", color: tab===k?"white":"var(--text-muted)"
          }}>{l}</button>
        ))}
      </div>

      {tab==='cargar' && <SubirBoletas cu={cu} onCargado={()=>setTab('boletas')}/>}
      {tab==='boletas' && <ListaBoletas verSocios={verSocios}/>}
      {tab==='prestadores' && <MaestroPrestadores verSocios={verSocios}/>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SUBIR BOLETAS (1 o más PDFs)
// ═══════════════════════════════════════════════════════════════════
function SubirBoletas({ cu, onCargado }) {
  const [parsing, setParsing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [prestadores, setPrestadores] = useState([])
  const [cecos, setCecos] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [asignaciones, setAsignaciones] = useState({})   // idx_boleta -> { centro_costo, cuenta_madre }
  const [error, setError] = useState("")
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { cargarCatalogos() }, [])

  const cargarCatalogos = async () => {
    const [{data:p},{data:c},{data:cm}] = await Promise.all([
      supabase.from('rrhh_prestadores').select('*').eq('activo',true),
      supabase.from('centros_costo').select('codigo,nombre').eq('activo',true).order('codigo'),
      supabase.from('cuentas_madre').select('codigo,nombre').eq('activa',true).order('codigo')
    ])
    setPrestadores(p||[]); setCecos(c||[]); setCuentas(cm||[])
  }

  const handleArchivos = async e => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setError(""); setPreview(null); setParsing(true)
    try {
      const data = await parsearBoletas(files)
      // Detectar prestador existente por RUT
      const prestMap = Object.fromEntries(prestadores.map(p => [p.rut, p]))
      const asign = {}
      data.boletas.forEach((b, i) => {
        const p = prestMap[b.rut_emisor]
        if (p) {
          asign[i] = {
            prestador_id: p.id,
            centro_costo_codigo: p.centro_costo_codigo,
            cuenta_madre_codigo: p.cuenta_madre_codigo
          }
        } else {
          asign[i] = { prestador_id: null, centro_costo_codigo: null, cuenta_madre_codigo: null }
        }
      })
      setAsignaciones(asign)
      setPreview(data)
    } catch (err) {
      setError("Error al parsear: " + err.message)
    } finally {
      setParsing(false)
    }
  }

  const setAsig = (idx, campo, valor) => {
    setAsignaciones(prev => ({ ...prev, [idx]: { ...prev[idx], [campo]: valor }}))
  }

  // Validar antes de guardar
  const errores = useMemo(() => {
    if (!preview) return []
    const errs = []
    preview.boletas.forEach((b, i) => {
      if (!b.cuadra) errs.push(`Boleta ${i+1} (${b.pdf_filename}): no cuadra o parsing incompleto`)
      if (b.rut_receptor && b.rut_receptor !== RUT_OUTLET) errs.push(`Boleta ${i+1}: RUT receptor (${b.rut_receptor}) no es Outlet`)
      const a = asignaciones[i] || {}
      if (!a.centro_costo_codigo) errs.push(`Boleta ${i+1}: falta centro de costo`)
      if (!a.cuenta_madre_codigo) errs.push(`Boleta ${i+1}: falta cuenta madre`)
    })
    return errs
  }, [preview, asignaciones])

  const confirmarCarga = async () => {
    if (errores.length > 0) { alert("Corrige los errores antes de guardar:\n\n"+errores.slice(0,8).join("\n")); return }
    setGuardando(true)
    try {
      let creadosPrestadores = 0, creadasBoletas = 0
      for (let i = 0; i < preview.boletas.length; i++) {
        const b = preview.boletas[i]
        const a = asignaciones[i]
        let prestadorId = a.prestador_id

        // Crear prestador si no existe (puede ya existir por boleta anterior del mismo lote)
        if (!prestadorId) {
          // Buscar de nuevo en BD por si se creó en iteración anterior del mismo lote
          const { data: yaExiste } = await supabase.from('rrhh_prestadores')
            .select('id').eq('rut', b.rut_emisor).single()
          if (yaExiste) {
            prestadorId = yaExiste.id
          } else {
            const { data: pNuevo, error: e1 } = await supabase.from('rrhh_prestadores')
              .insert({
                rut: b.rut_emisor,
                nombre: b.nombre_emisor,
                centro_costo_codigo: a.centro_costo_codigo,
                cuenta_madre_codigo: a.cuenta_madre_codigo,
                activo: true
              })
              .select('id').single()
            if (e1) throw e1
            prestadorId = pNuevo.id
            creadosPrestadores++
          }
        }

        // Insertar/actualizar boleta (upsert por rut+folio para tolerar re-intentos)
        // Primero borramos cualquier líneas previas para esa boleta si existía
        const { data: prev } = await supabase.from('rrhh_boletas_honorarios')
          .select('id').eq('rut_emisor', b.rut_emisor).eq('folio', b.folio)
        if (prev && prev.length > 0) {
          await supabase.from('rrhh_boletas_honorarios').delete().eq('id', prev[0].id)
          // las líneas caen por CASCADE
        }
        const { data: bIns, error: e2 } = await supabase.from('rrhh_boletas_honorarios')
          .insert({
            prestador_id: prestadorId,
            rut_emisor: b.rut_emisor,
            nombre_emisor: b.nombre_emisor,
            folio: b.folio,
            fecha_boleta: b.fecha_boleta,
            periodo: b.periodo,
            monto_bruto: b.monto_bruto,
            tasa_retencion: b.tasa_retencion,
            monto_retencion: b.monto_retencion,
            monto_liquido: b.monto_liquido,
            rut_receptor: b.rut_receptor,
            glosa_servicio: b.glosa_servicio,
            centro_costo_codigo: a.centro_costo_codigo,
            cuenta_madre_codigo: a.cuenta_madre_codigo,
            usuario_carga: cu.nombre,
            pdf_filename: b.pdf_filename
          })
          .select('id').single()
        if (e2) throw e2

        // Líneas (si la boleta trae múltiples servicios)
        if (b.lineas && b.lineas.length > 0) {
          await supabase.from('rrhh_boleta_lineas').insert(
            b.lineas.map(ln => ({ boleta_id: bIns.id, glosa: ln.glosa, monto: ln.monto }))
          )
        }
        creadasBoletas++
      }
      alert(`✅ ${creadasBoletas} boleta(s) registrada(s).${creadosPrestadores>0?` ${creadosPrestadores} prestador(es) nuevo(s) creado(s).`:''}`)
      onCargado?.()
    } catch (err) {
      console.error(err)
      setError("Error al guardar: " + err.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div>
      <div style={{background:"var(--bg-card)",border:"2px dashed var(--border)",borderRadius:12,padding:32,textAlign:"center",marginBottom:20}}>
        <input type="file" accept=".pdf" multiple id="pdf-boletas" style={{display:"none"}} onChange={handleArchivos} disabled={parsing||guardando}/>
        <label htmlFor="pdf-boletas" style={{cursor:parsing?"wait":"pointer",display:"inline-block"}}>
          <div style={{fontSize:48,marginBottom:8}}>{parsing?"⏳":"📄"}</div>
          <div style={{fontSize:16,fontWeight:600,marginBottom:4}}>
            {parsing ? "Procesando..." : "Selecciona una o más boletas PDF"}
          </div>
          <div style={{fontSize:12,color:"var(--text-muted)"}}>Boleta de Honorarios Electrónica del SII · Puedes seleccionar múltiples archivos</div>
        </label>
      </div>

      {error && <div style={{background:"#FFE5E5",color:"#B91C1C",padding:12,borderRadius:8,marginBottom:16,fontSize:13}}>❌ {error}</div>}

      {preview && (
        <>
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:16,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <h3 style={{margin:0,fontSize:16}}>{preview.total_archivos} archivo(s) procesado(s)</h3>
              <span style={{fontSize:13,color: preview.cuadran===preview.total_archivos?"var(--success)":"var(--danger)",fontWeight:600}}>
                {preview.cuadran}/{preview.total_archivos} parseadas OK
              </span>
            </div>
          </div>

          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",marginBottom:20}}>
            <div style={{maxHeight:500,overflowY:"auto"}}>
              <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
                <thead style={{background:"var(--bg-surface)",position:"sticky",top:0,zIndex:1}}>
                  <tr>
                    <th style={th}>OK</th>
                    <th style={th}>Folio</th>
                    <th style={th}>Período</th>
                    <th style={th}>Emisor</th>
                    <th style={th}>RUT</th>
                    <th style={th}>Servicio</th>
                    <th style={th}>CECO</th>
                    <th style={th}>Cuenta Madre</th>
                    <th style={{...th,textAlign:"right"}}>Bruto</th>
                    <th style={{...th,textAlign:"right"}}>Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.boletas.map((b, i) => {
                    const a = asignaciones[i] || {}
                    const okRut = !b.rut_receptor || b.rut_receptor === RUT_OUTLET
                    return (
                      <tr key={i} style={{borderTop:"1px solid var(--border)",background: !b.cuadra||!okRut?"#FEF2F2":"transparent"}}>
                        <td style={td}>{b.cuadra && okRut ? "✓" : "✕"}</td>
                        <td style={{...td,fontWeight:600}}>{b.folio||"?"}</td>
                        <td style={td}>{b.periodo||"?"}</td>
                        <td style={td}>{b.nombre_emisor}</td>
                        <td style={{...td,fontSize:11,color:"var(--text-muted)"}}>{b.rut_emisor}</td>
                        <td style={{...td,fontSize:11,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={b.glosa_servicio}>{b.glosa_servicio}</td>
                        <td style={td}>
                          <select value={a.centro_costo_codigo||''} onChange={e=>setAsig(i,'centro_costo_codigo',e.target.value||null)}
                            style={{...inp,minWidth:150,borderColor:!a.centro_costo_codigo?"var(--warning)":undefined}}>
                            <option value="">— CECO —</option>
                            {cecos.map(c=><option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
                          </select>
                        </td>
                        <td style={td}>
                          <select value={a.cuenta_madre_codigo||''} onChange={e=>setAsig(i,'cuenta_madre_codigo',e.target.value||null)}
                            style={{...inp,minWidth:160,borderColor:!a.cuenta_madre_codigo?"var(--warning)":undefined}}>
                            <option value="">— Cuenta madre —</option>
                            {cuentas.filter(cm => { const n = parseInt(cm.codigo,10); return n>=600 && n<=800 }).map(cm=>(
                              <option key={cm.codigo} value={cm.codigo}>{cm.codigo} · {cm.nombre}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{...td,textAlign:"right",fontWeight:600}}>{fmt(b.monto_bruto)}</td>
                        <td style={{...td,textAlign:"right",color:"var(--text-muted)"}}>{fmt(b.monto_liquido)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {errores.length>0 && (
            <div style={{background:"#FEF2F2",border:"1px solid var(--danger)",borderRadius:8,padding:12,marginBottom:14,fontSize:12,color:"#991B1B"}}>
              <b>No se puede guardar:</b>
              <ul style={{margin:"6px 0 0 20px"}}>
                {errores.slice(0,6).map((m,i)=><li key={i}>{m}</li>)}
                {errores.length>6 && <li>… y {errores.length-6} más</li>}
              </ul>
            </div>
          )}

          <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
            <button onClick={()=>{setPreview(null);setAsignaciones({})}} disabled={guardando} style={btnSec}>Cancelar</button>
            <button onClick={confirmarCarga} disabled={guardando||errores.length>0} style={{...btnPri,opacity:guardando||errores.length>0?0.5:1}}>
              {guardando ? "Guardando..." : `✓ Registrar ${preview.boletas.length} boleta(s)`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// LISTA DE BOLETAS REGISTRADAS
// ═══════════════════════════════════════════════════════════════════
function ListaBoletas({ verSocios }) {
  const [boletas, setBoletas] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState("")
  const [filtroPeriodo, setFiltroPeriodo] = useState("")

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const { data } = await supabase.from('rrhh_boletas_honorarios').select('*').order('fecha_boleta', { ascending: false })
    // Honorarios de socios (cuenta madre 761): filtrados en el fetch sin capability.
    const safe = verSocios ? (data||[]) : (data||[]).filter(b => String(b.cuenta_madre_codigo) !== CM_SOCIOS)
    setBoletas(safe)
    setLoading(false)
  }

  const eliminar = async (id, folio) => {
    if (!confirm(`¿Eliminar la boleta #${folio}?`)) return
    await supabase.from('rrhh_boletas_honorarios').delete().eq('id', id)
    cargar()
  }

  const periodos = useMemo(() => [...new Set(boletas.map(b=>b.periodo))].sort().reverse(), [boletas])

  const filtradas = boletas.filter(b => {
    if (filtro && !b.nombre_emisor.toLowerCase().includes(filtro.toLowerCase()) && !String(b.folio).includes(filtro)) return false
    if (filtroPeriodo && b.periodo !== filtroPeriodo) return false
    return true
  })

  const totBruto = filtradas.reduce((s,b)=>s+Number(b.monto_bruto),0)
  const totRet = filtradas.reduce((s,b)=>s+Number(b.monto_retencion),0)
  const totLiq = filtradas.reduce((s,b)=>s+Number(b.monto_liquido),0)

  if (loading) return <div style={{textAlign:"center",padding:60}}>Cargando...</div>

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:14}}>
        <KPI label="Boletas" valor={filtradas.length}/>
        <KPI label="Total Bruto" valor={fmt(totBruto)}/>
        <KPI label="Retención (15,25%)" valor={fmt(totRet)}/>
        <KPI label="Líquido pagado" valor={fmt(totLiq)}/>
      </div>

      <div style={{display:"flex",gap:10,marginBottom:14}}>
        <input type="text" placeholder="Buscar por emisor o folio..." value={filtro} onChange={e=>setFiltro(e.target.value)} style={{...inp,flex:1}}/>
        <select value={filtroPeriodo} onChange={e=>setFiltroPeriodo(e.target.value)} style={inp}>
          <option value="">Todos los períodos</option>
          {periodos.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
        <div style={{maxHeight:600,overflowY:"auto"}}>
          <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
            <thead style={{background:"var(--bg-surface)",position:"sticky",top:0,zIndex:1}}>
              <tr>
                <th style={th}>Folio</th><th style={th}>Período</th><th style={th}>Fecha</th>
                <th style={th}>Emisor</th><th style={th}>RUT</th><th style={th}>Servicio</th>
                <th style={th}>CECO</th><th style={th}>Cta Madre</th>
                <th style={{...th,textAlign:"right"}}>Bruto</th>
                <th style={{...th,textAlign:"right"}}>Líquido</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(b => (
                <tr key={b.id} style={{borderTop:"1px solid var(--border)"}}>
                  <td style={{...td,fontWeight:600}}>#{b.folio}</td>
                  <td style={td}>{b.periodo}</td>
                  <td style={{...td,color:"var(--text-muted)"}}>{b.fecha_boleta}</td>
                  <td style={td}>{b.nombre_emisor}</td>
                  <td style={{...td,fontSize:11,color:"var(--text-muted)"}}>{b.rut_emisor}</td>
                  <td style={{...td,fontSize:11,maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={b.glosa_servicio}>{b.glosa_servicio}</td>
                  <td style={{...td,fontSize:11}}>{b.centro_costo_codigo}</td>
                  <td style={{...td,fontSize:11}}>{b.cuenta_madre_codigo}</td>
                  <td style={{...td,textAlign:"right",fontWeight:600}}>{fmt(b.monto_bruto)}</td>
                  <td style={{...td,textAlign:"right"}}>{fmt(b.monto_liquido)}</td>
                  <td style={td}>
                    <button onClick={()=>eliminar(b.id, b.folio)} style={btnDel}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {filtradas.length === 0 && <div style={{textAlign:"center",padding:30,color:"var(--text-muted)"}}>Sin boletas registradas.</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAESTRO DE PRESTADORES
// ═══════════════════════════════════════════════════════════════════
function MaestroPrestadores({ verSocios }) {
  const [prestadores, setPrestadores] = useState([])
  const [cecos, setCecos] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [dirty, setDirty] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [{data:p},{data:c},{data:cm}] = await Promise.all([
      supabase.from('rrhh_prestadores').select('*').order('nombre'),
      supabase.from('centros_costo').select('codigo,nombre').eq('activo',true).order('codigo'),
      supabase.from('cuentas_madre').select('codigo,nombre').eq('activa',true).order('codigo')
    ])
    // Prestadores de socios (cuenta madre 761): ocultos sin capability.
    const pSafe = verSocios ? (p||[]) : (p||[]).filter(x => String(x.cuenta_madre_codigo) !== CM_SOCIOS)
    setPrestadores(pSafe); setCecos(c||[]); setCuentas(cm||[])
    setLoading(false)
    setDirty(new Map())
  }

  const cambiar = (id, campo, valor) => {
    setPrestadores(prev => prev.map(p => p.id===id?{...p,[campo]:valor}:p))
    setDirty(prev => { const m = new Map(prev); const cur = m.get(id)||{}; m.set(id, {...cur,[campo]:valor}); return m })
  }

  const guardar = async () => {
    if (dirty.size===0) return
    setGuardando(true)
    try {
      for (const [id, cambios] of dirty.entries()) {
        await supabase.from('rrhh_prestadores').update({...cambios, updated_at:new Date().toISOString()}).eq('id', id)
      }
      alert(`✅ ${dirty.size} prestador(es) actualizado(s)`)
      cargar()
    } catch (err) { alert("Error: " + err.message) } finally { setGuardando(false) }
  }

  if (loading) return <div style={{textAlign:"center",padding:60}}>Cargando...</div>

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
        <p style={{color:"var(--text-muted)",margin:0,fontSize:13}}>
          {prestadores.length} prestador(es) registrado(s). Se crean automáticamente al cargar la primera boleta.
        </p>
        {dirty.size>0 && <button onClick={guardar} disabled={guardando} style={btnPri}>{guardando?"Guardando...":`💾 Guardar ${dirty.size} cambios`}</button>}
      </div>

      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
        <div style={{maxHeight:600,overflowY:"auto"}}>
          <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
            <thead style={{background:"var(--bg-surface)",position:"sticky",top:0,zIndex:1}}>
              <tr>
                <th style={th}>RUT</th><th style={th}>Nombre</th>
                <th style={th}>Cargo / Servicio</th>
                <th style={th}>CECO</th><th style={th}>Cuenta Madre</th>
                <th style={th}>Activo</th>
              </tr>
            </thead>
            <tbody>
              {prestadores.map(p => (
                <tr key={p.id} style={{borderTop:"1px solid var(--border)",background: dirty.has(p.id)?"#FEF3C7":"transparent"}}>
                  <td style={{...td,fontWeight:600}}>{p.rut}</td>
                  <td style={td}>{p.nombre}</td>
                  <td style={td}>
                    <input type="text" value={p.cargo||""} onChange={e=>cambiar(p.id,'cargo',e.target.value)}
                      placeholder="Director, Consultor..." style={{...inp,width:180}}/>
                  </td>
                  <td style={td}>
                    <select value={p.centro_costo_codigo||''} onChange={e=>cambiar(p.id,'centro_costo_codigo',e.target.value||null)} style={inp}>
                      <option value="">—</option>
                      {cecos.map(c=><option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
                    </select>
                  </td>
                  <td style={td}>
                    <select value={p.cuenta_madre_codigo||''} onChange={e=>cambiar(p.id,'cuenta_madre_codigo',e.target.value||null)} style={inp}>
                      <option value="">—</option>
                      {cuentas.filter(cm=>{const n=parseInt(cm.codigo,10);return n>=600&&n<=800}).map(cm=>(
                        <option key={cm.codigo} value={cm.codigo}>{cm.codigo} · {cm.nombre}</option>
                      ))}
                    </select>
                  </td>
                  <td style={td}>
                    <input type="checkbox" checked={p.activo!==false} onChange={e=>cambiar(p.id,'activo',e.target.checked)}/>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {prestadores.length===0 && <div style={{textAlign:"center",padding:30,color:"var(--text-muted)"}}>Sin prestadores. Carga una boleta para crearlos automáticamente.</div>}
    </div>
  )
}

function KPI({ label, valor }) {
  return (
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
      <div style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>{label}</div>
      <div style={{fontSize:18,fontWeight:700}}>{valor}</div>
    </div>
  )
}

const th = {padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:600,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:0.5}
const td = {padding:"8px 14px"}
const inp = {padding:"6px 10px",border:"1px solid var(--border)",borderRadius:6,fontSize:12,background:"var(--bg-card)",color:"var(--text)"}
const btnPri = {padding:"10px 18px",background:"var(--accent)",color:"white",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}
const btnSec = {padding:"10px 18px",background:"var(--bg-card)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13}
const btnDel = {padding:"4px 10px",background:"transparent",color:"var(--danger)",border:"1px solid var(--danger)",borderRadius:4,cursor:"pointer",fontSize:11}
