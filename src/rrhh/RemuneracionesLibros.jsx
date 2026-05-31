import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

const fmt = n => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n||0)

export function RemuneracionesLibros({ cu }) {
  const [libros, setLibros] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandido, setExpandido] = useState(null)
  const [detalle, setDetalle] = useState(null)

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('rrhh_libro_mensual')
      .select('*')
      .order('periodo', { ascending: false })
    setLibros(data || [])
    setLoading(false)
  }

  const verDetalle = async (libro) => {
    if (expandido === libro.id) { setExpandido(null); setDetalle(null); return }
    setExpandido(libro.id)
    setDetalle(null)
    // Cargar detalle agrupado por empleado
    const { data: det } = await supabase
      .from('rrhh_libro_detalle')
      .select('cod_contaline, concepto_k, monto, sucursal_id')
      .eq('libro_id', libro.id)
    const { data: emps } = await supabase
      .from('rrhh_empleados')
      .select('cod_contaline, nombre, sucursal_id')
    const empMap = new Map((emps||[]).map(e => [e.cod_contaline, e]))
    // Agrupar por empleado
    const porEmp = new Map()
    for (const d of (det || [])) {
      if (d.cod_contaline === 0) continue
      if (!porEmp.has(d.cod_contaline)) {
        const e = empMap.get(d.cod_contaline)
        porEmp.set(d.cod_contaline, {
          cod: d.cod_contaline,
          nombre: e?.nombre || `COD_${d.cod_contaline}`,
          sucursal: d.sucursal_id,
          haberes: 0, descuentos: 0, liquido: 0
        })
      }
      const emp = porEmp.get(d.cod_contaline)
      const monto = Number(d.monto)
      // Haberes: sueldo_base, tratos_bonos, otros_ingresos, asignac_fam
      if (['sueldo_base','tratos_bonos','otros_ingresos','asignac_fam'].includes(d.concepto_k)) {
        emp.haberes += monto
      } else if (['prevision','salud','prestamos','impuesto_unico','otros_desc'].includes(d.concepto_k)) {
        emp.descuentos += monto
      }
    }
    // Líquido = haberes - descuentos
    porEmp.forEach(e => { e.liquido = e.haberes - e.descuentos })
    setDetalle([...porEmp.values()].sort((a,b) => a.cod - b.cod))
  }

  const eliminarLibro = async (libro) => {
    if (!confirm(`¿Eliminar el libro de ${libro.periodo}?\nEsto borrará todos los datos asociados.`)) return
    await supabase.from('rrhh_libro_detalle').delete().eq('libro_id', libro.id)
    await supabase.from('rrhh_libro_mensual').delete().eq('id', libro.id)
    await cargar()
  }

  if (loading) return <div style={{textAlign:"center",padding:60}}>Cargando...</div>

  return (
    <div style={{maxWidth:1300,margin:"0 auto"}}>
      <h2 style={{margin:"0 0 20px 0",fontSize:22}}>📚 Histórico de Libros</h2>

      {libros.length === 0 ? (
        <div style={{textAlign:"center",padding:60,color:"var(--text-muted)"}}>
          No hay libros cargados. Ve al tab "Cargar Libro".
        </div>
      ) : (
        <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead style={{background:"var(--bg-surface)"}}>
              <tr>
                <th style={th}>Período</th>
                <th style={th}>Empleados</th>
                <th style={{...th,textAlign:"right"}}>Haberes</th>
                <th style={{...th,textAlign:"right"}}>Descuentos</th>
                <th style={{...th,textAlign:"right"}}>Líquido</th>
                <th style={{...th,textAlign:"right"}}>Aportes Pat.</th>
                <th style={{...th,textAlign:"right"}}>Costo Empresa</th>
                <th style={th}>Cargado</th>
                <th style={th}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {libros.map(l => (
                <>
                  <tr key={l.id} style={{borderTop:"1px solid var(--border)",cursor:"pointer"}} onClick={() => verDetalle(l)}>
                    <td style={{...td,fontWeight:600}}>{l.periodo} {expandido===l.id ? "▼" : "▶"}</td>
                    <td style={td}>{l.n_empleados}</td>
                    <td style={{...td,textAlign:"right"}}>{fmt(l.total_haberes)}</td>
                    <td style={{...td,textAlign:"right",color:"var(--danger)"}}>{fmt(l.total_descuentos)}</td>
                    <td style={{...td,textAlign:"right",color:"var(--success)",fontWeight:600}}>{fmt(l.liquido_pagar)}</td>
                    <td style={{...td,textAlign:"right"}}>{fmt(l.total_aportes_pat)}</td>
                    <td style={{...td,textAlign:"right",fontWeight:700}}>{fmt(l.total_costo_empresa)}</td>
                    <td style={{...td,fontSize:11,color:"var(--text-muted)"}}>
                      {l.fecha_carga ? new Date(l.fecha_carga).toLocaleDateString('es-CL') : "—"}<br/>
                      <span style={{fontSize:10}}>{l.usuario_carga}</span>
                    </td>
                    <td style={td}>
                      <button onClick={(e) => { e.stopPropagation(); eliminarLibro(l) }} style={btnDel}>
                        Eliminar
                      </button>
                    </td>
                  </tr>
                  {expandido === l.id && detalle && (
                    <tr>
                      <td colSpan={9} style={{padding:0,background:"var(--bg-surface)"}}>
                        <div style={{padding:16}}>
                          <div style={{fontWeight:600,marginBottom:10,fontSize:13}}>Detalle por empleado · {l.periodo}</div>
                          <div style={{maxHeight:300,overflowY:"auto"}}>
                            <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
                              <thead><tr style={{background:"var(--bg-card)"}}>
                                <th style={thS}>Cód</th><th style={thS}>Nombre</th><th style={thS}>Sucursal</th>
                                <th style={{...thS,textAlign:"right"}}>Haberes</th>
                                <th style={{...thS,textAlign:"right"}}>Descuentos</th>
                                <th style={{...thS,textAlign:"right"}}>Líquido</th>
                              </tr></thead>
                              <tbody>
                                {detalle.map(e => (
                                  <tr key={e.cod} style={{borderBottom:"1px solid var(--border)"}}>
                                    <td style={tdS}>{e.cod}</td>
                                    <td style={tdS}>{e.nombre}</td>
                                    <td style={tdS}><SucBadge s={e.sucursal}/></td>
                                    <td style={{...tdS,textAlign:"right"}}>{fmt(e.haberes)}</td>
                                    <td style={{...tdS,textAlign:"right",color:"var(--danger)"}}>{fmt(e.descuentos)}</td>
                                    <td style={{...tdS,textAlign:"right",fontWeight:600,color:"var(--success)"}}>{fmt(e.liquido)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SucBadge({ s }) {
  const SUC = { 'suc-lg':['La Granja','#34C759'], 'suc-la':['Los Ángeles','#007AFF'], 'suc-mp':['Maipú','#FF9500'], 'suc-cd':['CD','#8E8E93'], 'suc-web':['Web','#AF52DE'] }
  const [l, c] = SUC[s] || [s, '#999']
  return <span style={{background:c+'20',color:c,padding:"2px 8px",borderRadius:4,fontSize:11,fontWeight:600}}>{l}</span>
}

const th = {padding:"12px 14px",textAlign:"left",fontSize:12,fontWeight:600,color:"var(--text-muted)"}
const td = {padding:"12px 14px",fontSize:13}
const thS = {padding:"8px 10px",textAlign:"left",fontSize:11,fontWeight:600,color:"var(--text-muted)"}
const tdS = {padding:"6px 10px"}
const btnDel = {padding:"4px 10px",background:"transparent",color:"var(--danger)",border:"1px solid var(--danger)",borderRadius:4,cursor:"pointer",fontSize:11}
