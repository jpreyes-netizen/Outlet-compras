import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabase'

export function RemuneracionesEmpleados({ cu }) {
  const [emps, setEmps] = useState([])
  const [sucs, setSucs] = useState([])         // sucursales con codigo_plan IS NOT NULL
  const [cecos, setCecos] = useState([])       // centros_costo activos
  const [cuentasMadre, setCuentasMadre] = useState([])
  const [subcuentas, setSubcuentas] = useState([])  // todas las subcuentas activas (para selector de pago)
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState("")
  const [filtroSuc, setFiltroSuc] = useState("")
  const [filtroCeco, setFiltroCeco] = useState("")
  const [filtroActivo, setFiltroActivo] = useState("activos")
  const [filtroIncompletos, setFiltroIncompletos] = useState(false)
  const [dirty, setDirty] = useState(new Map())
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [{ data: e }, { data: s }, { data: c }, { data: cm }, { data: sc }] = await Promise.all([
      supabase.from('rrhh_empleados').select('*').order('cod_contaline'),
      supabase.from('sucursales').select('id,nombre,codigo').not('codigo','is',null).order('codigo'),
      supabase.from('centros_costo').select('codigo,nombre,activo').eq('activo',true).order('codigo'),
      supabase.from('cuentas_madre').select('id,codigo,nombre,tipo,activa').eq('activa',true).order('codigo'),
      supabase.from('subcuentas').select('id,nombre,cuenta_madre_id').order('nombre')
    ])
    // Normalizar empleados: forzar string en los codigos FK para que matcheen con los <option value>
    const empsNorm = (e || []).map(x => ({
      ...x,
      centro_costo_codigo: x.centro_costo_codigo != null ? String(x.centro_costo_codigo) : null,
      cuenta_madre_codigo: x.cuenta_madre_codigo != null ? String(x.cuenta_madre_codigo) : null,
    }))
    setEmps(empsNorm)
    // Forzar string en codigo para que el match con value del select sea exacto
    setSucs((s || []).filter(x => x.codigo && x.codigo !== '').map(x => ({...x, codigo: String(x.codigo)})))
    setCecos((c || []).map(x => ({...x, codigo: String(x.codigo)})))
    setCuentasMadre((cm || []).map(x => ({...x, codigo: String(x.codigo)})))
    setSubcuentas(sc || [])
    setLoading(false)
    setDirty(new Map())
  }

  const cambiar = (cod, campo, valor) => {
    setEmps(prev => prev.map(e => {
      if (e.cod_contaline !== cod) return e
      // Si cambia cuenta_madre_codigo, resetear subcuenta_pago_default (la subcuenta podría ya no pertenecer a esa cuenta madre)
      if (campo === 'cuenta_madre_codigo' && e.cuenta_madre_codigo !== valor) {
        return {...e, [campo]: valor, subcuenta_pago_default: null}
      }
      return {...e, [campo]: valor}
    }))
    setDirty(prev => {
      const m = new Map(prev)
      const cur = m.get(cod) || {}
      const upd = {...cur, [campo]: valor}
      if (campo === 'cuenta_madre_codigo') upd.subcuenta_pago_default = null
      m.set(cod, upd)
      return m
    })
  }

  // Validar que todos los dirty tengan ceco + cuenta madre (si están activos)
  const erroresValidacion = useMemo(() => {
    const errs = []
    for (const [cod, cambios] of dirty.entries()) {
      const emp = emps.find(e => e.cod_contaline === cod)
      if (!emp) continue
      if (emp.activo === false) continue  // inactivos no obligados
      if (!emp.centro_costo_codigo) errs.push(`#${cod} ${emp.nombre}: falta centro de costo`)
      if (!emp.cuenta_madre_codigo) errs.push(`#${cod} ${emp.nombre}: falta cuenta madre`)
    }
    return errs
  }, [dirty, emps])

  const guardarCambios = async () => {
    if (dirty.size === 0) return
    if (erroresValidacion.length > 0) {
      alert("No se puede guardar:\n\n" + erroresValidacion.slice(0,10).join("\n"))
      return
    }
    setGuardando(true)
    try {
      for (const [cod, cambios] of dirty.entries()) {
        await supabase
          .from('rrhh_empleados')
          .update({...cambios, updated_at:new Date().toISOString()})
          .eq('cod_contaline', cod)
      }
      alert(`✅ ${dirty.size} empleados actualizados`)
      await cargar()
    } catch (err) {
      alert("Error: " + err.message)
    } finally {
      setGuardando(false)
    }
  }

  // Para mostrar el nombre legible
  const sucLabel = useMemo(() => Object.fromEntries(sucs.map(s => [s.id, s.nombre])), [sucs])
  const cecoLabel = useMemo(() => Object.fromEntries(cecos.map(c => [c.codigo, `${c.codigo} · ${c.nombre}`])), [cecos])

  // Filtrar CECOs según prefijo (OPS/COM/ADM/NEG) por sucursal: pista visual, no obligatoria
  const cecosFiltrablesPara = (sucId) => {
    // Sin restricción dura: mostramos todos los CECOs activos.
    // El admin elige el que corresponda al tipo de trabajador.
    return cecos
  }

  const empsFiltrados = emps.filter(e => {
    if (filtro && !e.nombre.toLowerCase().includes(filtro.toLowerCase()) && !String(e.cod_contaline).includes(filtro)) return false
    if (filtroSuc && e.sucursal_id !== filtroSuc) return false
    if (filtroCeco && e.centro_costo_codigo !== filtroCeco) return false
    if (filtroActivo === 'activos' && !e.activo) return false
    if (filtroActivo === 'inactivos' && e.activo) return false
    if (filtroIncompletos && e.centro_costo_codigo && e.cuenta_madre_codigo) return false
    return true
  })

  // Contadores por sucursal (solo activos)
  const contadores = emps.reduce((acc, e) => {
    if (!e.activo) return acc
    acc[e.sucursal_id] = (acc[e.sucursal_id]||0) + 1
    return acc
  }, {})
  const totalActivos = emps.filter(e => e.activo).length
  const totalIncompletos = emps.filter(e => e.activo && (!e.centro_costo_codigo || !e.cuenta_madre_codigo)).length

  if (loading) return <div style={{textAlign:"center",padding:60}}>Cargando...</div>

  return (
    <div style={{maxWidth:1500,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <h2 style={{margin:0,fontSize:22}}>👥 Empleados</h2>
          <p style={{color:"var(--text-muted)",margin:"4px 0 0 0",fontSize:13}}>
            {totalActivos} activos · {emps.length - totalActivos} inactivos
            {totalIncompletos > 0 && <span style={{color:"var(--warning)",marginLeft:8,fontWeight:600}}>
              · ⚠ {totalIncompletos} sin centro de costo o cuenta madre
            </span>}
          </p>
        </div>
        {dirty.size > 0 && (
          <button onClick={guardarCambios}
            disabled={guardando || erroresValidacion.length > 0}
            title={erroresValidacion.length > 0 ? erroresValidacion.slice(0,5).join("\n") : ""}
            style={{...btnPri, opacity: (guardando || erroresValidacion.length > 0) ? 0.5 : 1}}>
            {guardando ? "Guardando..." : `💾 Guardar ${dirty.size} cambios`}
            {erroresValidacion.length > 0 && ` (${erroresValidacion.length} errores)`}
          </button>
        )}
      </div>

      {/* Stats por sucursal (solo las del plan) */}
      <div style={{display:"grid",gridTemplateColumns:`repeat(${sucs.length},1fr)`,gap:10,marginBottom:16}}>
        {sucs.map(s => (
          <div key={s.id} style={{
            background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:8,
            padding:12,textAlign:"center",cursor:"pointer",
            outline: filtroSuc===s.id ? "2px solid var(--accent)" : "none"
          }} onClick={() => setFiltroSuc(filtroSuc === s.id ? "" : s.id)}>
            <div style={{fontSize:10,color:"var(--text-muted)"}}>{s.codigo}</div>
            <div style={{fontSize:13,marginBottom:2}}>{s.nombre}</div>
            <div style={{fontSize:22,fontWeight:700,color: filtroSuc===s.id ? "var(--accent)" : "var(--text)"}}>{contadores[s.id] || 0}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        <input
          type="text" placeholder="Buscar por nombre o código..."
          value={filtro} onChange={e=>setFiltro(e.target.value)}
          style={{...inp,flex:1,minWidth:240}}
        />
        <select value={filtroSuc} onChange={e=>setFiltroSuc(e.target.value)} style={sel}>
          <option value="">Todas sucursales</option>
          {sucs.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={filtroCeco} onChange={e=>setFiltroCeco(e.target.value)} style={sel}>
          <option value="">Todos CECOs</option>
          {cecos.map(c => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
        </select>
        <select value={filtroActivo} onChange={e=>setFiltroActivo(e.target.value)} style={sel}>
          <option value="activos">Solo activos</option>
          <option value="inactivos">Solo inactivos</option>
          <option value="todos">Todos</option>
        </select>
        <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,cursor:"pointer",padding:"0 10px",border:"1px solid var(--border)",borderRadius:6,background: filtroIncompletos ? "#FEF3C7":"var(--bg-card)"}}>
          <input type="checkbox" checked={filtroIncompletos} onChange={e=>setFiltroIncompletos(e.target.checked)}/>
          ⚠ Solo incompletos
        </label>
      </div>

      {/* Tabla */}
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
        <div style={{maxHeight:600,overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead style={{background:"var(--bg-surface)",position:"sticky",top:0,zIndex:1}}>
              <tr>
                <th style={th}>Cód</th>
                <th style={th}>Nombre</th>
                <th style={th}>RUT</th>
                <th style={th}>Sucursal</th>
                <th style={th}>Centro Costo</th>
                <th style={th}>Cuenta Madre</th>
                <th style={th}>Subcuenta Pago</th>
                <th style={th}>Cargo</th>
                <th style={th}>Activo</th>
              </tr>
            </thead>
            <tbody>
              {empsFiltrados.map(e => {
                const incompleto = e.activo && (!e.centro_costo_codigo || !e.cuenta_madre_codigo)
                const cecosDisponibles = cecosFiltrablesPara(e.sucursal_id)
                return (
                  <tr key={e.cod_contaline} style={{
                    borderTop:"1px solid var(--border)",
                    background: dirty.has(e.cod_contaline) ? "#FEF3C7" : (incompleto ? "#FFF7ED" : "transparent")
                  }}>
                    <td style={{...td,fontWeight:600}}>
                      {incompleto && <span title="Sin CECO o cuenta madre" style={{marginRight:4}}>⚠</span>}
                      {e.cod_contaline}
                    </td>
                    <td style={td}>{e.nombre}</td>
                    <td style={td}>
                      <input type="text" value={e.rut || ""}
                        onChange={ev => cambiar(e.cod_contaline, 'rut', ev.target.value)}
                        placeholder="12.345.678-9"
                        style={{...inpSmall,width:110}}/>
                    </td>
                    <td style={td}>
                      <select value={e.sucursal_id || ''}
                        onChange={ev => cambiar(e.cod_contaline, 'sucursal_id', ev.target.value)}
                        style={{...inpSmall, minWidth:110}}>
                        <option value="">— Sucursal —</option>
                        {sucs.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      <select value={e.centro_costo_codigo || ''}
                        onChange={ev => cambiar(e.cod_contaline, 'centro_costo_codigo', ev.target.value || null)}
                        style={{...inpSmall, minWidth:170, borderColor: !e.centro_costo_codigo && e.activo ? "var(--warning)" : undefined}}>
                        <option value="">— CECO —</option>
                        {cecosDisponibles.map(c => (
                          <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>
                        ))}
                      </select>
                    </td>
                    <td style={td}>
                      <select value={e.cuenta_madre_codigo || ''}
                        onChange={ev => cambiar(e.cod_contaline, 'cuenta_madre_codigo', ev.target.value || null)}
                        style={{...inpSmall, minWidth:180, borderColor: !e.cuenta_madre_codigo && e.activo ? "var(--warning)" : undefined}}>
                        <option value="">— Cuenta madre —</option>
                        {cuentasMadre.filter(cm => {
                          const n = parseInt(cm.codigo, 10)
                          return n >= 600 && n <= 800  // remuneraciones: 600-800 incluye 760,761,762
                        }).map(cm => (
                          <option key={cm.codigo} value={cm.codigo}>{cm.codigo} · {cm.nombre}</option>
                        ))}
                      </select>
                    </td>
                    <td style={td}>
                      {(() => {
                        // La subcuenta de pago se filtra según la cuenta madre del empleado
                        const cmActual = cuentasMadre.find(cm => cm.codigo === e.cuenta_madre_codigo)
                        const subcuentasFiltradas = cmActual ? subcuentas.filter(s => s.cuenta_madre_id === cmActual.id) : []
                        const disabled = !cmActual
                        return (
                          <select value={e.subcuenta_pago_default || ''}
                            onChange={ev => cambiar(e.cod_contaline, 'subcuenta_pago_default', ev.target.value || null)}
                            disabled={disabled}
                            title={disabled ? 'Primero selecciona cuenta madre' : 'Subcuenta donde se clasifica el pago de sueldo'}
                            style={{...inpSmall, minWidth:170, background: disabled ? '#F3F4F6' : undefined, color: disabled ? '#9CA3AF' : undefined}}>
                            <option value="">— Subcuenta pago —</option>
                            {subcuentasFiltradas.map(s => (
                              <option key={s.id} value={s.id}>{s.nombre}</option>
                            ))}
                          </select>
                        )
                      })()}
                    </td>
                    <td style={td}>
                      <input type="text" value={e.cargo || ""}
                        onChange={ev => cambiar(e.cod_contaline, 'cargo', ev.target.value)}
                        placeholder="Vendedor, Bodeguero..."
                        style={{...inpSmall,width:130}}/>
                    </td>
                    <td style={td}>
                      <input type="checkbox" checked={e.activo !== false}
                        onChange={ev => cambiar(e.cod_contaline, 'activo', ev.target.checked)}/>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {empsFiltrados.length === 0 && (
        <div style={{textAlign:"center",padding:30,color:"var(--text-muted)"}}>
          No hay empleados que coincidan con los filtros.
        </div>
      )}

      {/* Errores de validación inline */}
      {erroresValidacion.length > 0 && (
        <div style={{marginTop:14,background:"#FEF2F2",border:"1px solid var(--danger)",borderRadius:8,padding:12,fontSize:12,color:"#991B1B"}}>
          <b>No se puede guardar:</b>
          <ul style={{margin:"6px 0 0 20px"}}>
            {erroresValidacion.slice(0,6).map((m,i) => <li key={i}>{m}</li>)}
            {erroresValidacion.length > 6 && <li>… y {erroresValidacion.length - 6} más</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

const th = {padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:600,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:0.5}
const td = {padding:"8px 14px"}
const inp = {padding:"8px 12px",border:"1px solid var(--border)",borderRadius:6,fontSize:13,background:"var(--bg-card)",color:"var(--text)"}
const sel = {padding:"8px 10px",border:"1px solid var(--border)",borderRadius:6,fontSize:13,background:"var(--bg-card)",color:"var(--text)"}
const inpSmall = {padding:"4px 6px",border:"1px solid var(--border)",borderRadius:4,fontSize:12,background:"var(--bg-card)",color:"var(--text)"}
const btnPri = {padding:"10px 18px",background:"var(--warning)",color:"#78350F",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}
