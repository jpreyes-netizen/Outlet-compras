import { useState } from 'react'
import { supabase } from '../supabase'
import { parsearPDFLiquidaciones } from './parserLiquidaciones'

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
    if (!f.name.toLowerCase().endsWith('.pdf')) { setError("El archivo debe ser un PDF"); return }
    setArchivo(f); setError(""); setPreview(null); setParsing(true)
    try {
      const data = await parsearPDFLiquidaciones(f)
      if (!data.periodo) { setError("No se pudo detectar el período. ¿Es un PDF de liquidaciones Contaline?"); setParsing(false); return }
      if (data.liquidaciones.length === 0) { setError("No se encontraron liquidaciones en el PDF"); setParsing(false); return }

      // ¿ya existe ese período cargado?
      const { data: existente } = await supabase
        .from('rrhh_liquidaciones').select('id').eq('periodo', data.periodo).limit(1)
      setYaExiste((existente || []).length > 0)

      // Detectar empleados nuevos
      const codigos = data.liquidaciones.map(l => l.cod_contaline)
      const { data: bdEmps } = await supabase
        .from('rrhh_empleados').select('cod_contaline, nombre, centro_costo_codigo, cuenta_madre_codigo').in('cod_contaline', codigos)
      const existentesCods = new Set((bdEmps || []).map(e => e.cod_contaline))
      const nuevos = data.liquidaciones.filter(l => !existentesCods.has(l.cod_contaline))
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
      // 1. Reemplazo si ya existe el período
      if (yaExiste) {
        const { data: prev } = await supabase
          .from('rrhh_liquidaciones').select('id').eq('periodo', preview.periodo)
        const ids = (prev || []).map(p => p.id)
        if (ids.length > 0) {
          // las líneas tienen ON DELETE CASCADE, basta borrar cabeceras
          await supabase.from('rrhh_liquidaciones').delete().eq('periodo', preview.periodo)
        }
      }

      // 2. Crear empleados nuevos SIN asignación (quedan incompletos para el admin)
      if (empleadosNuevos.length > 0) {
        const upsertEmps = empleadosNuevos.map(l => ({
          cod_contaline: l.cod_contaline,
          nombre: l.nombre,
          rut: l.rut || null,
          cargo: l.cargo || null,
          sucursal_id: null,
          centro_costo_codigo: null,
          cuenta_madre_codigo: null,
          activo: true
        }))
        const { error: e1 } = await supabase.from('rrhh_empleados').upsert(upsertEmps, { onConflict: 'cod_contaline' })
        if (e1) throw e1
      }

      // 3. Insertar cabeceras de liquidación
      const cabeceras = preview.liquidaciones.map(l => ({
        periodo: l.periodo || preview.periodo,
        cod_contaline: l.cod_contaline,
        nombre: l.nombre,
        rut: l.rut || null,
        cargo: l.cargo || null,
        centro_costo_texto: l.centro_costo_texto || null,
        dias_trabajados: l.dias_trabajados || null,
        total_haberes: l.total_haberes,
        total_descuentos: l.total_descuentos,
        liquido_pagar: l.liquido_pagar || (l.total_haberes - l.total_descuentos),
        base_leyes_sociales: l.base_leyes_sociales || 0,
        base_cesantia_empresa: l.base_cesantia_empresa || 0,
        banco: l.banco || null,
        cuenta_banco: l.cuenta_banco || null,
        usuario_carga: cu.nombre,
        pdf_filename: preview.pdf_filename
      }))
      const { data: cabsInsertadas, error: e2 } = await supabase
        .from('rrhh_liquidaciones').insert(cabeceras).select('id, cod_contaline, periodo')
      if (e2) throw e2

      // Mapa cod_contaline → liquidacion_id
      const liqMap = new Map(cabsInsertadas.map(c => [c.cod_contaline, c.id]))

      // 4. Traer catálogo de glosas para snapshot de tipo/naturaleza
      const { data: glosas } = await supabase.from('rrhh_glosas').select('codigo, nombre, tipo_glosa, naturaleza')
      const glosaMap = new Map((glosas || []).map(g => [g.codigo, g]))

      // 5. Insertar líneas
      const lineasRows = []
      for (const l of preview.liquidaciones) {
        const liqId = liqMap.get(l.cod_contaline)
        if (!liqId) continue
        for (const ln of l.lineas) {
          const g = glosaMap.get(ln.glosa_codigo)
          // Si la glosa está en catálogo, usar su tipo/naturaleza.
          // Si no, usar la naturaleza detectada por columna (haber/descuento) y nombre del PDF.
          lineasRows.push({
            liquidacion_id: liqId,
            periodo: l.periodo || preview.periodo,
            cod_contaline: l.cod_contaline,
            glosa_codigo: ln.glosa_codigo,
            glosa_nombre: g?.nombre || ln.nombre_pdf || `COD_${ln.glosa_codigo}`,
            tipo_glosa: g?.tipo_glosa || (ln.naturaleza_pdf === 'haber' ? 'sin_mapear_haber' : 'sin_mapear_desc'),
            naturaleza: g?.naturaleza || (ln.naturaleza_pdf === 'haber' ? 'haber_imponible' : 'descuento_legal'),
            monto: ln.monto
          })
        }
      }
      const BATCH = 500
      for (let i = 0; i < lineasRows.length; i += BATCH) {
        const { error: e3 } = await supabase.from('rrhh_liquidacion_lineas').insert(lineasRows.slice(i, i + BATCH))
        if (e3) throw e3
      }

      alert(`✅ Liquidaciones de ${preview.periodo} cargadas.\n${preview.liquidaciones.length} trabajadores, ${lineasRows.length} líneas de glosa.`)
      onCargado?.()
    } catch (err) {
      console.error(err)
      setError("Error al guardar: " + err.message)
    } finally {
      setGuardando(false)
    }
  }

  const val = preview?.validacion
  const totH = preview?.liquidaciones.reduce((s,l)=>s+l.total_haberes,0) || 0
  const totD = preview?.liquidaciones.reduce((s,l)=>s+l.total_descuentos,0) || 0
  const totL = preview?.liquidaciones.reduce((s,l)=>s+(l.liquido_pagar||0),0) || 0

  return (
    <div style={{maxWidth:1100,margin:"0 auto"}}>
      <div style={{marginBottom:20}}>
        <h2 style={{margin:0,fontSize:22}}>📤 Cargar Liquidaciones de Sueldo</h2>
        <p style={{color:"var(--text-muted)",margin:"4px 0 0 0",fontSize:14}}>
          Sube el PDF de liquidaciones individuales de Contaline. El sistema parsea cada glosa por trabajador
          y la mapea al plan de cuentas corporativo.
        </p>
      </div>

      <div style={{background:"var(--bg-card)",border:"2px dashed var(--border)",borderRadius:12,padding:32,textAlign:"center",marginBottom:20}}>
        <input type="file" accept=".pdf" id="pdf-liq" style={{display:"none"}} onChange={handleArchivo} disabled={parsing || guardando}/>
        <label htmlFor="pdf-liq" style={{cursor:parsing?"wait":"pointer",display:"inline-block"}}>
          <div style={{fontSize:48,marginBottom:8}}>{parsing ? "⏳" : "📄"}</div>
          <div style={{fontSize:16,fontWeight:600,marginBottom:4}}>
            {parsing ? "Procesando PDF..." : archivo ? archivo.name : "Selecciona el PDF de Liquidaciones"}
          </div>
          <div style={{fontSize:12,color:"var(--text-muted)"}}>Formato Contaline — Liquidaciones de Sueldo</div>
        </label>
      </div>

      {error && (
        <div style={{background:"#FFE5E5",color:"#B91C1C",padding:12,borderRadius:8,marginBottom:16,fontSize:13}}>❌ {error}</div>
      )}

      {preview && (
        <>
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:20,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <h3 style={{margin:0,fontSize:18}}>
                Período: {preview.periodo}
                {yaExiste && <span style={{marginLeft:12,fontSize:12,background:"#FBBF24",color:"#78350F",padding:"3px 8px",borderRadius:4}}>YA EXISTE — se reemplazará</span>}
              </h3>
              <div style={{fontSize:13,color: val.todas_ok ? "var(--success)" : "var(--danger)",fontWeight:600}}>
                {val.todas_ok
                  ? `✅ ${val.cuadran}/${val.total} cuadran${val.max_diff > 0 ? ` (dif. máx $${val.max_diff})` : ''}`
                  : `⚠️ ${val.con_diferencia} con diferencia > $1`}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
              <Metric label="Trabajadores" valor={val.total} ok={val.todas_ok}/>
              <Metric label="Total Haberes" valor={fmt(totH)}/>
              <Metric label="Total Descuentos" valor={fmt(totD)}/>
              <Metric label="Líquido Total" valor={fmt(totL)} destacado/>
              <Metric label="Empleados nuevos" valor={empleadosNuevos.length} accent={empleadosNuevos.length>0}/>
              <Metric label="Liquidaciones OK" valor={`${val.cuadran}/${val.total}`} ok={val.todas_ok}/>
            </div>
          </div>

          {empleadosNuevos.length > 0 && (
            <div style={{background:"#FFF7ED",border:"1px solid #FB923C",borderRadius:12,padding:16,marginBottom:16}}>
              <h4 style={{margin:"0 0 8px 0",fontSize:14,color:"#9A3412"}}>
                ⚠️ {empleadosNuevos.length} trabajadores nuevos se crearán SIN asignación contable
              </h4>
              <div style={{fontSize:12,color:"#9A3412",marginBottom:12}}>
                Quedarán sin sucursal, centro de costo ni cuenta madre. Ve al tab <b>Empleados</b> a completarlos
                para que sus glosas aparezcan en el análisis corporativo.
              </div>
              <div style={{maxHeight:160,overflowY:"auto",background:"white",borderRadius:6,padding:8}}>
                {empleadosNuevos.map(l => (
                  <div key={l.cod_contaline} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px",fontSize:12,borderBottom:"1px solid #f4f4f4"}}>
                    <span><b>#{l.cod_contaline}</b> {l.nombre} <span style={{color:"#9A3412"}}>· {l.cargo}</span></span>
                    <span style={{color:"var(--text-muted)"}}>{fmt(l.total_haberes)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Object.keys(preview.glosas_desconocidas || {}).length > 0 && (
            <div style={{background:"#EFF6FF",border:"1px solid #3B82F6",borderRadius:12,padding:16,marginBottom:16}}>
              <h4 style={{margin:"0 0 8px 0",fontSize:14,color:"#1E40AF"}}>
                ℹ️ {Object.keys(preview.glosas_desconocidas).length} glosa(s) nueva(s) detectada(s)
              </h4>
              <div style={{fontSize:12,color:"#1E40AF",marginBottom:10}}>
                Estas glosas no están en el catálogo. Se guardarán igual (clasificadas por columna del PDF),
                pero conviene mapearlas al plan de cuentas. Códigos detectados:
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {Object.entries(preview.glosas_desconocidas).map(([cod, nom]) => (
                  <span key={cod} style={{background:"white",border:"1px solid #93C5FD",borderRadius:6,padding:"4px 10px",fontSize:12}}>
                    <b>{cod}</b> · {nom}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tabla de liquidaciones */}
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",marginBottom:20}}>
            <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",fontWeight:600,fontSize:14}}>
              Liquidaciones ({preview.liquidaciones.length})
            </div>
            <div style={{maxHeight:340,overflowY:"auto"}}>
              <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
                <thead style={{background:"var(--bg-surface)",position:"sticky",top:0}}>
                  <tr>
                    <th style={thS}>Cód</th><th style={thS}>Nombre</th><th style={thS}>C.Costo PDF</th>
                    <th style={{...thS,textAlign:"center"}}>Líneas</th>
                    <th style={{...thS,textAlign:"right"}}>Haberes</th>
                    <th style={{...thS,textAlign:"right"}}>Descuentos</th>
                    <th style={{...thS,textAlign:"right"}}>Líquido</th>
                    <th style={{...thS,textAlign:"center"}}>OK</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.liquidaciones.map(l => (
                    <tr key={l.cod_contaline} style={{borderBottom:"1px solid var(--border)",background: l.cuadra ? "transparent":"#FEF2F2"}}>
                      <td style={tdS}>{l.cod_contaline}</td>
                      <td style={tdS}>{l.nombre}</td>
                      <td style={{...tdS,color:"var(--text-muted)"}}>{l.centro_costo_texto}</td>
                      <td style={{...tdS,textAlign:"center"}}>{l.lineas.length}</td>
                      <td style={{...tdS,textAlign:"right",fontWeight:600}}>{fN(l.total_haberes)}</td>
                      <td style={{...tdS,textAlign:"right",color:"var(--danger)"}}>{fN(l.total_descuentos)}</td>
                      <td style={{...tdS,textAlign:"right",fontWeight:600,color:"var(--success)"}}>{fN(l.liquido_pagar)}</td>
                      <td style={{...tdS,textAlign:"center"}}>{l.cuadra ? "✓" : "✕"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
            <button onClick={() => { setPreview(null); setArchivo(null); setError("") }} disabled={guardando} style={btnSec}>Cancelar</button>
            <button onClick={confirmarCarga} disabled={guardando || !val.todas_ok}
              title={!val.todas_ok ? "Hay liquidaciones que no cuadran. Revisa el PDF." : ""}
              style={{...btnPri, opacity: (guardando||!val.todas_ok)?0.6:1}}>
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
