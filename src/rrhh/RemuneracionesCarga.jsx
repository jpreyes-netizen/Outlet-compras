import { useState } from 'react'
import { supabase } from '../supabase'
import { parsearPDFLibro } from './parser'

const fmt = n => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n||0)
const fN = n => new Intl.NumberFormat("es-CL").format(Math.round(n||0))

export function RemuneracionesCarga({ cu, onCargado }) {
  const [archivo, setArchivo] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [empleadosNuevos, setEmpleadosNuevos] = useState([])
  const [empleadosBD, setEmpleadosBD] = useState([])
  const [yaExiste, setYaExiste] = useState(false)

  const handleArchivo = async e => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      setError("El archivo debe ser un PDF")
      return
    }
    setArchivo(f)
    setError("")
    setPreview(null)
    setParsing(true)
    try {
      const data = await parsearPDFLibro(f)
      if (!data.periodo) {
        setError("No se pudo detectar el período del libro. ¿Es un PDF de Contaline?")
        setParsing(false)
        return
      }
      if (data.empleados.length === 0) {
        setError("No se encontraron empleados en el PDF")
        setParsing(false)
        return
      }
      // Verificar si ya existe ese periodo
      const { data: existente } = await supabase
        .from('rrhh_libro_mensual')
        .select('id, periodo')
        .eq('periodo', data.periodo)
        .maybeSingle()
      setYaExiste(!!existente)
      // Detectar empleados nuevos (no están en BD)
      const codigos = data.empleados.map(e => e.cod_contaline)
      const { data: bdEmps } = await supabase
        .from('rrhh_empleados')
        .select('cod_contaline, nombre, sucursal_id')
        .in('cod_contaline', codigos)
      const existentesCods = new Set((bdEmps || []).map(e => e.cod_contaline))
      const nuevos = data.empleados.filter(e => !existentesCods.has(e.cod_contaline))
      setEmpleadosNuevos(nuevos)
      setEmpleadosBD(bdEmps || [])
      setPreview(data)
    } catch (err) {
      console.error(err)
      setError("Error al parsear el PDF: " + err.message)
    } finally {
      setParsing(false)
    }
  }

  const confirmarCarga = async () => {
    if (!preview) return
    setGuardando(true)
    try {
      // 1. Si ya existe ese periodo, borrar el anterior (reemplazo completo)
      if (yaExiste) {
        const { data: prev } = await supabase
          .from('rrhh_libro_mensual')
          .select('id')
          .eq('periodo', preview.periodo)
          .maybeSingle()
        if (prev) {
          await supabase.from('rrhh_libro_detalle').delete().eq('libro_id', prev.id)
          await supabase.from('rrhh_libro_mensual').delete().eq('id', prev.id)
        }
      }

      // 2. Crear empleados nuevos SIN sucursal/CECO/cuenta madre.
      //    El admin debe asignarlos en el tab Empleados antes de poder generar
      //    reportes contables. Quedan marcados como activos pero "incompletos".
      if (empleadosNuevos.length > 0) {
        const upsertEmps = empleadosNuevos.map(e => ({
          cod_contaline: e.cod_contaline,
          nombre: e.nombre,
          sucursal_id: null,
          centro_costo_id: null,
          cuenta_madre_id: null,
          activo: true
        }))
        const { error: err1 } = await supabase
          .from('rrhh_empleados')
          .upsert(upsertEmps, { onConflict: 'cod_contaline' })
        if (err1) throw err1
      }

      // 3. Insertar header del libro
      const { data: libro, error: err2 } = await supabase
        .from('rrhh_libro_mensual')
        .insert({
          periodo: preview.periodo,
          total_haberes: preview.totales.total_haberes,
          total_descuentos: preview.totales.total_descuentos,
          liquido_pagar: preview.totales.liquido_pagar,
          total_aportes_pat: preview.totales.total_aportes_pat,
          total_costo_empresa: preview.totales.total_costo_empresa,
          n_empleados: preview.totales.n_empleados,
          usuario_carga: cu.nombre,
          pdf_filename: preview.pdf_filename
        })
        .select()
        .single()
      if (err2) throw err2

      // 4. Mapear sucursales: usar la de BD si existe, sino null (empleado nuevo)
      const sucMap = new Map()
      empleadosBD.forEach(e => sucMap.set(e.cod_contaline, e.sucursal_id))

      // 5. Insertar detalle: 1 fila por (empleado × concepto)
      const detalleRows = []
      const conceptos = [
        ['sueldo_base', 'sueldo_base'],
        ['tratos_bonos', 'tratos_bonos'],
        ['otros_ingresos', 'otros_ingresos'],
        ['asignac_fam', 'asignac_fam'],
        ['prevision', 'prevision'],
        ['salud', 'salud'],
        ['prestamos', 'prestamos'],
        ['impuesto_unico', 'impuesto_unico'],
        ['otros_desc', 'otros_desc']
      ]
      for (const emp of preview.empleados) {
        const suc = sucMap.get(emp.cod_contaline) || null
        for (const [k, prop] of conceptos) {
          if (emp[prop] > 0) {
            detalleRows.push({
              libro_id: libro.id,
              cod_contaline: emp.cod_contaline,
              concepto_k: k,
              monto: emp[prop],
              sucursal_id: suc
            })
          }
        }
      }
      // Insertar aportes patronales como filas globales (sin empleado específico ni sucursal).
      // Quedan como "pool" para que finanzas decida cómo prorratearlos.
      const ap = preview.aportes_patronales
      const aportes = [
        ['aporte_mutual', ap.aporte_mutual],
        ['aporte_cesantia', ap.aporte_cesantia],
        ['aporte_invalidez', ap.aporte_invalidez],
        ['aporte_capital', ap.aporte_capital],
        ['aporte_ss_vida', ap.aporte_ss_vida]
      ]
      for (const [k, monto] of aportes) {
        if (monto > 0) {
          detalleRows.push({
            libro_id: libro.id,
            cod_contaline: 0,  // 0 = aporte patronal global
            concepto_k: k,
            monto: monto,
            sucursal_id: null  // sin asignar; finanzas decide cómo prorratear
          })
        }
      }

      // Insertar en lotes de 500
      const BATCH = 500
      for (let i = 0; i < detalleRows.length; i += BATCH) {
        const { error: err3 } = await supabase
          .from('rrhh_libro_detalle')
          .insert(detalleRows.slice(i, i + BATCH))
        if (err3) throw err3
      }

      alert(`✅ Libro de ${preview.periodo} cargado correctamente.\n${preview.empleados.length} empleados, ${detalleRows.length} líneas de detalle.`)
      onCargado?.()
    } catch (err) {
      console.error(err)
      setError("Error al guardar: " + err.message)
    } finally {
      setGuardando(false)
    }
  }

  const v = preview?.validaciones
  const allOk = v?.n_empleados_ok && v?.haberes_ok

  return (
    <div style={{maxWidth:1100,margin:"0 auto"}}>
      <div style={{marginBottom:20}}>
        <h2 style={{margin:0,fontSize:22}}>📤 Cargar Libro de Remuneraciones</h2>
        <p style={{color:"var(--text-muted)",margin:"4px 0 0 0",fontSize:14}}>
          Sube el PDF del Libro mensual exportado de Contaline. El sistema parsea automáticamente empleados, conceptos y aportes patronales.
        </p>
      </div>

      {/* INPUT */}
      <div style={{background:"var(--bg-card)",border:"2px dashed var(--border)",borderRadius:12,padding:32,textAlign:"center",marginBottom:20}}>
        <input
          type="file" accept=".pdf"
          id="pdf-libro" style={{display:"none"}}
          onChange={handleArchivo} disabled={parsing || guardando}
        />
        <label htmlFor="pdf-libro" style={{cursor:parsing?"wait":"pointer",display:"inline-block"}}>
          <div style={{fontSize:48,marginBottom:8}}>{parsing ? "⏳" : "📄"}</div>
          <div style={{fontSize:16,fontWeight:600,marginBottom:4}}>
            {parsing ? "Procesando PDF..." : archivo ? archivo.name : "Selecciona el PDF del Libro"}
          </div>
          <div style={{fontSize:12,color:"var(--text-muted)"}}>
            Formato Contaline ERP — Libro de Remuneraciones
          </div>
        </label>
      </div>

      {error && (
        <div style={{background:"#FFE5E5",color:"#B91C1C",padding:12,borderRadius:8,marginBottom:16,fontSize:13}}>
          ❌ {error}
        </div>
      )}

      {/* PREVIEW */}
      {preview && (
        <>
          {/* Resumen */}
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:20,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h3 style={{margin:0,fontSize:18}}>
                Período: {preview.periodo}
                {yaExiste && <span style={{marginLeft:12,fontSize:12,background:"#FBBF24",color:"#78350F",padding:"3px 8px",borderRadius:4}}>YA EXISTE — se reemplazará</span>}
              </h3>
              <div style={{fontSize:13,color: allOk ? "var(--success)" : "var(--danger)",fontWeight:600}}>
                {allOk ? "✅ Validación OK" : "⚠️ Revisar diferencias"}
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
              <Metric label="Empleados" valor={`${preview.empleados.length} / ${v.n_empleados_declarados}`} ok={v.n_empleados_ok}/>
              <Metric label="Total Haberes" valor={fmt(preview.totales.total_haberes)} ok={v.haberes_ok}/>
              <Metric label="Total Descuentos" valor={fmt(preview.totales.total_descuentos)}/>
              <Metric label="Líquido a Pagar" valor={fmt(preview.totales.liquido_pagar)}/>
              <Metric label="Aportes Patronales" valor={fmt(preview.totales.total_aportes_pat)}/>
              <Metric label="Costo Empresa" valor={fmt(preview.totales.total_costo_empresa)} destacado/>
              <Metric label="Empleados nuevos" valor={empleadosNuevos.length} accent={empleadosNuevos.length>0}/>
              <Metric label="Diff haberes" valor={fmt(v.haberes_diff)} accent={v.haberes_diff!==0}/>
            </div>
          </div>

          {/* Aportes patronales */}
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:20,marginBottom:16}}>
            <h4 style={{margin:"0 0 12px 0",fontSize:14}}>Aportes Patronales</h4>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,fontSize:13}}>
              {Object.entries(preview.aportes_patronales).map(([k, v]) => (
                <div key={k} style={{background:"var(--bg-surface)",padding:10,borderRadius:6}}>
                  <div style={{fontSize:11,color:"var(--text-muted)",marginBottom:3}}>{k.replace('aporte_','').replace('_',' ')}</div>
                  <div style={{fontWeight:600}}>{fmt(v)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Empleados nuevos */}
          {empleadosNuevos.length > 0 && (
            <div style={{background:"#FFF7ED",border:"1px solid #FB923C",borderRadius:12,padding:16,marginBottom:16}}>
              <h4 style={{margin:"0 0 8px 0",fontSize:14,color:"#9A3412"}}>
                ⚠️ {empleadosNuevos.length} empleados nuevos se crearán SIN asignación contable
              </h4>
              <div style={{fontSize:12,color:"#9A3412",marginBottom:12}}>
                Quedarán activos pero <b>sin sucursal, sin centro de costo y sin cuenta madre</b>.
                Después de cargar este libro, debes ir al tab <b>Empleados</b> y completar los 3 campos
                para que aparezcan correctamente en el análisis contable.
              </div>
              <div style={{maxHeight:180,overflowY:"auto",background:"white",borderRadius:6,padding:8}}>
                {empleadosNuevos.map(e => (
                  <div key={e.cod_contaline} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px",fontSize:12,borderBottom:"1px solid #f4f4f4"}}>
                    <span><b>#{e.cod_contaline}</b> {e.nombre}</span>
                    <span style={{color:"var(--text-muted)"}}>{fmt(e.total_haberes)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preview tabla de empleados */}
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",marginBottom:20}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",fontWeight:600,fontSize:14}}>
              Detalle de empleados ({preview.empleados.length})
            </div>
            <div style={{maxHeight:320,overflowY:"auto"}}>
              <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
                <thead style={{background:"var(--bg-surface)",position:"sticky",top:0}}>
                  <tr>
                    <th style={thS}>Cód</th>
                    <th style={thS}>Nombre</th>
                    <th style={{...thS,textAlign:"right"}}>S.Base</th>
                    <th style={{...thS,textAlign:"right"}}>Tratos</th>
                    <th style={{...thS,textAlign:"right"}}>Haberes</th>
                    <th style={{...thS,textAlign:"right"}}>Descuent.</th>
                    <th style={{...thS,textAlign:"right"}}>Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.empleados.map(e => (
                    <tr key={e.cod_contaline} style={{borderBottom:"1px solid var(--border)"}}>
                      <td style={tdS}>{e.cod_contaline}</td>
                      <td style={tdS}>{e.nombre}</td>
                      <td style={{...tdS,textAlign:"right"}}>{fN(e.sueldo_base)}</td>
                      <td style={{...tdS,textAlign:"right"}}>{fN(e.tratos_bonos)}</td>
                      <td style={{...tdS,textAlign:"right",fontWeight:600}}>{fN(e.total_haberes)}</td>
                      <td style={{...tdS,textAlign:"right",color:"var(--danger)"}}>{fN(e.total_desc)}</td>
                      <td style={{...tdS,textAlign:"right",fontWeight:600,color:"var(--success)"}}>{fN(e.liquido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Botones */}
          <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
            <button
              onClick={() => { setPreview(null); setArchivo(null); setError("") }}
              disabled={guardando}
              style={btnSec}>
              Cancelar
            </button>
            <button
              onClick={confirmarCarga}
              disabled={guardando || !allOk}
              title={!allOk ? "Las validaciones no son OK. Revisa el PDF." : ""}
              style={{...btnPri, opacity: (guardando||!allOk)?0.6:1}}>
              {guardando ? "Guardando..." : `✓ Confirmar carga ${yaExiste ? "(reemplazo)" : ""}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Metric({ label, valor, ok, accent, destacado }) {
  return (
    <div style={{
      padding:12,borderRadius:8,
      background: destacado ? "var(--accent)" : "var(--bg-surface)",
      border: ok===false ? "2px solid var(--danger)" : accent ? "2px solid var(--warning)" : "1px solid var(--border)"
    }}>
      <div style={{fontSize:11,color: destacado?"white":"var(--text-muted)",marginBottom:4}}>{label}</div>
      <div style={{fontSize:16,fontWeight:700,color: destacado?"white":"var(--text)"}}>{valor}</div>
    </div>
  )
}

const thS = {padding:"8px 10px",textAlign:"left",fontSize:11,fontWeight:600,color:"var(--text-muted)",borderBottom:"1px solid var(--border)"}
const tdS = {padding:"6px 10px"}
const btnPri = {padding:"10px 20px",background:"var(--accent)",color:"white",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}
const btnSec = {padding:"10px 20px",background:"var(--bg-card)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:8,cursor:"pointer",fontSize:13}
