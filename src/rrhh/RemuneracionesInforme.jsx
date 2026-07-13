import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabase'
import { canSync, preloadCaps } from '../core/permisos'

const fmt = n => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n||0)
const fN = n => new Intl.NumberFormat("es-CL").format(Math.round(n||0))
const fPct = n => (n>0?'+':'')+n.toFixed(1)+'%'

const PARTIDA_LABEL = {
  sueldo_base:'Sueldo base', gratificacion:'Gratificación', comision:'Comisiones',
  hora_extra:'Horas extra', bono:'Bonos', viatico:'Viáticos', colacion:'Colación',
  movilizacion:'Movilización', afp:'AFP', salud:'Salud', cesantia:'Cesantía',
  impuesto:'Impuesto', anticipo:'Anticipos', prestamo:'Préstamos', descuento_interno:'Desc. interno'
}
const pl = t => PARTIDA_LABEL[t] || t
const MESES = {'01':'Enero','02':'Febrero','03':'Marzo','04':'Abril','05':'Mayo','06':'Junio','07':'Julio','08':'Agosto','09':'Septiembre','10':'Octubre','11':'Noviembre','12':'Diciembre'}
const mesNombre = p => `${MESES[p.slice(5)]} ${p.slice(0,4)}`

export function RemuneracionesInforme({ cu }) {
  const [master, setMaster] = useState([])
  const [costoEmp, setCostoEmp] = useState([])
  const [metricas, setMetricas] = useState([])
  const [loading, setLoading] = useState(true)
  const [modo, setModo] = useState('mes')   // 'mes' | 'anual'
  const [periodoSel, setPeriodoSel] = useState(null)

  useEffect(() => { (async () => {
    setLoading(true)
    await preloadCaps(cu, 'rrhh')
    const [{ data: m },{ data: ce },{ data: mt }] = await Promise.all([
      supabase.from('v_rrhh_master').select('*'),
      supabase.from('v_rrhh_costo_empresa').select('*'),
      supabase.from('v_rrhh_metricas').select('*')
    ])
    // Remuneración socios (761, incluye honorarios de socios): solo con capability.
    const verSocios = canSync(cu, 'rrhh', 'rrhh.rem.ver_socios')
    const mSafe = verSocios ? (m||[]) : (m||[]).filter(r => String(r.cuenta_madre_codigo) !== '761')
    setMaster(mSafe); setCostoEmp(ce||[]); setMetricas(mt||[])
    setLoading(false)
  })() }, [cu])

  const periodos = useMemo(() => [...new Set(master.map(r=>r.periodo))].sort(), [master])
  useEffect(() => { if (periodos.length && !periodoSel) setPeriodoSel(periodos[periodos.length-1]) }, [periodos, periodoSel])

  const ceMap = useMemo(() => Object.fromEntries(costoEmp.map(c=>[c.periodo,c])), [costoEmp])
  const mtMap = useMemo(() => Object.fromEntries(metricas.map(c=>[c.periodo,c])), [metricas])
  const dotacion = useMemo(() => {
    const m = {}
    master.forEach(r => { (m[r.periodo] ??= new Set()).add(r.cod_contaline) })
    return Object.fromEntries(Object.entries(m).map(([p,s])=>[p,s.size]))
  }, [master])

  // helpers de agregación
  const haberes = r => r.naturaleza==='haber_imponible'||r.naturaleza==='haber_no_imponible'||r.naturaleza==='honorario'
  const sumBy = (rows, campo, label) => {
    const m = {}
    rows.forEach(r => { const k = label?label(r):r[campo]||'Sin asignar'; m[k]=(m[k]||0)+Number(r.monto) })
    return Object.entries(m).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v)
  }

  if (loading) return <div style={{textAlign:"center",padding:60}}>Cargando informe...</div>
  if (!periodos.length) return (
    <div style={{textAlign:"center",padding:60}}>
      <div style={{fontSize:48,marginBottom:12}}>📄</div><h3>Sin datos para el informe</h3>
    </div>
  )

  // Esperar hasta que periodoSel esté inicializado
  if (!periodoSel) return <div style={{textAlign:"center",padding:60}}>Cargando...</div>

  // ── datos según modo ──
  const periodosInforme = modo==='mes' ? [periodoSel] : periodos
  const filas = master.filter(r => periodosInforme.includes(r.periodo))
  const filasHaber = filas.filter(haberes)

  const totalHaberes = filasHaber.reduce((s,r)=>s+Number(r.monto),0)
  const totalAportes = periodosInforme.reduce((s,p)=>s+(ceMap[p]?.total_aportes_patronales||0),0)
  const totalHonorarios = periodosInforme.reduce((s,p)=>s+(ceMap[p]?.total_honorarios||0),0)
  const totalCosto = periodosInforme.reduce((s,p)=>s+(ceMap[p]?.total_costo_empresa||0),0)
  const totalLiquido = periodosInforme.reduce((s,p)=>s+(ceMap[p]?.liquido_pagar||0),0)
  const dotProm = modo==='mes' ? dotacion[periodoSel] : Math.round(periodos.reduce((s,p)=>s+(dotacion[p]||0),0)/periodos.length)
  const nPrestadores = modo==='mes' ? (ceMap[periodoSel]?.n_prestadores||0) : Math.max(...periodos.map(p=>ceMap[p]?.n_prestadores||0))
  const costoFijo = periodosInforme.reduce((s,p)=>s+(mtMap[p]?.costo_fijo||0),0)
  const costoVariable = periodosInforme.reduce((s,p)=>s+(mtMap[p]?.costo_variable||0),0)
  const pctVariable = (costoFijo+costoVariable)>0 ? costoVariable/(costoFijo+costoVariable)*100 : 0
  const pctHonor = totalCosto>0 ? totalHonorarios/totalCosto*100 : 0

  const porPartida = sumBy(filasHaber, 'partida', r=>pl(r.partida))
  const porCeco = sumBy(filasHaber, 'centro_costo_nombre')
  const porCM = sumBy(filasHaber, 'cuenta_madre_nombre')
  const porSuc = sumBy(filasHaber, 'sucursal_id')

  const print = () => window.print()

  return (
    <div style={{maxWidth:900,margin:"0 auto"}}>
      {/* Controles (no se imprimen) */}
      <div className="no-print" style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div style={{display:"flex",gap:4,background:"var(--bg-surface)",padding:4,borderRadius:10,border:"1px solid var(--border)"}}>
          {[['mes','Por mes'],['anual','Totalizado año']].map(([k,l]) => (
            <button key={k} onClick={()=>setModo(k)} style={{padding:"8px 16px",border:"none",borderRadius:7,cursor:"pointer",fontSize:13,fontWeight:600,
              background:modo===k?"var(--accent)":"transparent",color:modo===k?"white":"var(--text-muted)"}}>{l}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {modo==='mes' && (
            <select value={periodoSel||''} onChange={e=>setPeriodoSel(e.target.value)} style={{padding:"8px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg-card)",color:"var(--text)",fontSize:13}}>
              {periodos.map(p => <option key={p} value={p}>{mesNombre(p)}</option>)}
            </select>
          )}
          <button onClick={print} style={{padding:"9px 18px",background:"var(--accent)",color:"white",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:600}}>🖨 Imprimir / PDF</button>
        </div>
      </div>

      {/* DOCUMENTO */}
      <div id="informe" style={{background:"white",color:"#1a1a2e",borderRadius:12,overflow:"hidden",boxShadow:"0 4px 24px rgba(0,0,0,.08)"}}>
        {/* Header corporativo */}
        <div style={{background:"linear-gradient(135deg,#1a1a2e,#16213e)",color:"white",padding:"32px 40px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:12,opacity:0.7,letterSpacing:1,textTransform:"uppercase"}}>Outlet de Puertas SpA</div>
              <h1 style={{margin:"8px 0 0 0",fontSize:26,fontWeight:700}}>Informe de Remuneraciones</h1>
              <div style={{fontSize:14,opacity:0.85,marginTop:4}}>
                {modo==='mes' ? mesNombre(periodoSel) : `Año ${periodos[0]?.slice(0,4)} · ${periodos.length} meses`}
              </div>
            </div>
            <div style={{textAlign:"right",fontSize:11,opacity:0.7}}>
              <div>Generado: {new Date().toLocaleDateString('es-CL')}</div>
              <div>Por: {cu.nombre}</div>
            </div>
          </div>
        </div>

        <div style={{padding:"32px 40px"}}>
          {/* Resumen ejecutivo */}
          <SecTitle n="1" t="Resumen Ejecutivo"/>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:16,marginBottom:8}}>
            <Box label="Costo Empresa Total" valor={fmt(totalCosto)} big/>
            <Box label={modo==='mes'?"Empleados + Prestadores":"Dotación prom. + Prestadores"} valor={`${dotProm} + ${nPrestadores}`}/>
            <Box label="Haberes (Liquidaciones)" valor={fmt(totalHaberes - totalHonorarios)}/>
            <Box label="Honorarios" valor={fmt(totalHonorarios)}/>
            <Box label="Aportes Patronales (est.)" valor={fmt(totalAportes)}/>
            <Box label="Líquido Pagado" valor={fmt(totalLiquido)}/>
          </div>

          {/* Estructura de costo — ratios ejecutivos */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginTop:16}}>
            <RatioBox label="Costo Fijo" valor={fmt(costoFijo)} pct={100-pctVariable} color="#3B82F6"/>
            <RatioBox label="Costo Variable" valor={fmt(costoVariable)} pct={pctVariable} color="#F59E0B" nota="comisiones · HHEE · bonos"/>
            <RatioBox label="Peso Honorarios" valor={fmt(totalHonorarios)} pct={pctHonor} color="#8B5CF6" nota="sobre costo empresa total"/>
          </div>

          {/* Composición por partida */}
          <SecTitle n="2" t="Composición por Partida"/>
          <TablaDist filas={porPartida} total={totalHaberes}/>

          {/* Por centro de costo */}
          <SecTitle n="3" t="Distribución por Centro de Costo"/>
          <TablaDist filas={porCeco} total={totalHaberes}/>

          {/* Por cuenta madre */}
          <SecTitle n="4" t="Distribución por Cuenta Madre"/>
          <TablaDist filas={porCM} total={totalHaberes}/>

          {/* Honorarios */}
          {totalHonorarios > 0 && (
            <>
              <SecTitle n="5" t="Honorarios profesionales"/>
              <p style={{fontSize:12,color:"#6b7280",margin:"-8px 0 12px 0"}}>
                Servicios pagados por boleta de honorarios. Suma al costo empresa adicional a las liquidaciones.
              </p>
              <TablaHonorarios filas={filas.filter(r=>r.naturaleza==='honorario')}/>
            </>
          )}

          {/* Evolución mensual (solo en modo anual) */}
          {modo==='anual' && (
            <>
              <SecTitle n="6" t="Evolución Mensual"/>
              <table style={tabla}>
                <thead><tr>
                  <th style={thD}>Mes</th><th style={{...thD,textAlign:"right"}}>Trab.</th>
                  <th style={{...thD,textAlign:"right"}}>Haberes</th>
                  <th style={{...thD,textAlign:"right"}}>Aportes</th>
                  <th style={{...thD,textAlign:"right"}}>Honorarios</th>
                  <th style={{...thD,textAlign:"right"}}>Costo Empresa</th>
                  <th style={{...thD,textAlign:"right"}}>Var.</th>
                </tr></thead>
                <tbody>
                  {periodos.map((p,i) => {
                    const c = ceMap[p]||{}, cPrev = i>0?ceMap[periodos[i-1]]:null
                    const v = cPrev?.total_costo_empresa ? (c.total_costo_empresa-cPrev.total_costo_empresa)/cPrev.total_costo_empresa*100 : null
                    return (
                      <tr key={p} style={{borderTop:"1px solid #eee"}}>
                        <td style={tdD}>{mesNombre(p)}</td>
                        <td style={{...tdD,textAlign:"right"}}>{dotacion[p]||0}</td>
                        <td style={{...tdD,textAlign:"right"}}>{fN(c.total_haberes)}</td>
                        <td style={{...tdD,textAlign:"right"}}>{fN(c.total_aportes_patronales)}</td>
                        <td style={{...tdD,textAlign:"right"}}>{fN(c.total_honorarios)}</td>
                        <td style={{...tdD,textAlign:"right",fontWeight:600}}>{fmt(c.total_costo_empresa)}</td>
                        <td style={{...tdD,textAlign:"right",color:v>0?"#DC2626":v<0?"#16A34A":"#999"}}>{v!==null?fPct(v):'—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}

          <div style={{marginTop:32,paddingTop:16,borderTop:"1px solid #eee",fontSize:10,color:"#999",textAlign:"center"}}>
            Documento generado por el módulo de Gestión de Personas · Outlet de Puertas SpA · Alineado a SOP P07<br/>
            Aportes patronales estimados sobre base imponible con tasas legales vigentes. Cifras en CLP.
          </div>
        </div>
      </div>

      <style>{`@media print {
        .no-print { display: none !important; }
        body * { visibility: hidden; }
        #informe, #informe * { visibility: visible; }
        #informe { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none; }
      }`}</style>
    </div>
  )
}

function SecTitle({ n, t }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,margin:"28px 0 14px 0"}}>
      <div style={{width:26,height:26,borderRadius:7,background:"#1a1a2e",color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700}}>{n}</div>
      <h2 style={{margin:0,fontSize:16,fontWeight:700,color:"#1a1a2e"}}>{t}</h2>
    </div>
  )
}

function Box({ label, valor, big }) {
  return (
    <div style={{background:"#f8f9fb",borderRadius:10,padding:"14px 16px",border:"1px solid #eef0f4"}}>
      <div style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:0.4,marginBottom:6}}>{label}</div>
      <div style={{fontSize:big?24:18,fontWeight:700,color:"#1a1a2e"}}>{valor}</div>
    </div>
  )
}

function RatioBox({ label, valor, pct, color, nota }) {
  return (
    <div style={{background:"#f8f9fb",borderRadius:10,padding:"14px 16px",border:"1px solid #eef0f4"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
        <span style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:0.4}}>{label}</span>
        <span style={{fontSize:15,fontWeight:700,color}}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{fontSize:18,fontWeight:700,color:"#1a1a2e",margin:"4px 0"}}>{valor}</div>
      <div style={{height:6,background:"#e5e7eb",borderRadius:3,overflow:"hidden"}}>
        <div style={{width:`${Math.min(pct,100)}%`,height:"100%",background:color}}/>
      </div>
      {nota && <div style={{fontSize:10,color:"#9ca3af",marginTop:4}}>{nota}</div>}
    </div>
  )
}

function TablaDist({ filas, total }) {
  return (
    <table style={tabla}>
      <thead><tr><th style={thD}>Concepto</th><th style={{...thD,textAlign:"right"}}>Monto</th><th style={{...thD,textAlign:"right",width:80}}>%</th></tr></thead>
      <tbody>
        {filas.map(f => (
          <tr key={f.k} style={{borderTop:"1px solid #eee"}}>
            <td style={tdD}>{f.k}</td>
            <td style={{...tdD,textAlign:"right",fontWeight:500}}>{fmt(f.v)}</td>
            <td style={{...tdD,textAlign:"right",color:"#6b7280"}}>{total>0?(f.v/total*100).toFixed(1)+'%':''}</td>
          </tr>
        ))}
        <tr style={{borderTop:"2px solid #1a1a2e",fontWeight:700}}>
          <td style={tdD}>Total</td>
          <td style={{...tdD,textAlign:"right"}}>{fmt(total)}</td>
          <td style={{...tdD,textAlign:"right"}}>100%</td>
        </tr>
      </tbody>
    </table>
  )
}

function TablaHonorarios({ filas }) {
  // Agrupar por prestador (trabajador en master)
  const agrup = {}
  filas.forEach(r => {
    const k = r.trabajador
    if (!agrup[k]) agrup[k] = { nombre: r.trabajador, cargo: r.cargo, ceco: r.centro_costo_nombre, cm: r.cuenta_madre_nombre, total: 0 }
    agrup[k].total += Number(r.monto)
  })
  const arr = Object.values(agrup).sort((a,b)=>b.total-a.total)
  const total = arr.reduce((s,r)=>s+r.total, 0)
  return (
    <table style={tabla}>
      <thead><tr>
        <th style={thD}>Prestador</th>
        <th style={thD}>Cargo / Servicio</th>
        <th style={thD}>CECO</th>
        <th style={thD}>Cuenta Madre</th>
        <th style={{...thD,textAlign:"right"}}>Monto</th>
        <th style={{...thD,textAlign:"right",width:80}}>%</th>
      </tr></thead>
      <tbody>
        {arr.map(r => (
          <tr key={r.nombre} style={{borderTop:"1px solid #eee"}}>
            <td style={tdD}>{r.nombre}</td>
            <td style={{...tdD,color:"#6b7280"}}>{r.cargo||'—'}</td>
            <td style={{...tdD,color:"#6b7280"}}>{r.ceco||'—'}</td>
            <td style={{...tdD,color:"#6b7280"}}>{r.cm||'—'}</td>
            <td style={{...tdD,textAlign:"right",fontWeight:500}}>{fmt(r.total)}</td>
            <td style={{...tdD,textAlign:"right",color:"#6b7280"}}>{total>0?(r.total/total*100).toFixed(1)+'%':''}</td>
          </tr>
        ))}
        <tr style={{borderTop:"2px solid #1a1a2e",fontWeight:700}}>
          <td style={tdD} colSpan={4}>Total Honorarios</td>
          <td style={{...tdD,textAlign:"right"}}>{fmt(total)}</td>
          <td style={{...tdD,textAlign:"right"}}>100%</td>
        </tr>
      </tbody>
    </table>
  )
}

const tabla = {width:"100%",borderCollapse:"collapse",fontSize:13}
const thD = {padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:600,color:"#6b7280",textTransform:"uppercase",letterSpacing:0.4,borderBottom:"2px solid #1a1a2e"}
const tdD = {padding:"7px 12px",color:"#1a1a2e"}
