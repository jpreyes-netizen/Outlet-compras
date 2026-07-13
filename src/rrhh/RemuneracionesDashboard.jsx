import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabase'
import { canSync, preloadCaps } from '../core/permisos'
import * as XLSX from 'xlsx'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell
} from 'recharts'

const fmt = n => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n||0)
const fM = n => { const a=Math.abs(n); return a>=1e6?(n/1e6).toFixed(1)+'M':a>=1e3?(n/1e3).toFixed(0)+'k':String(Math.round(n)) }
const fPct = n => (n>0?'+':'')+n.toFixed(1)+'%'
const mesCorto = p => { const M={'01':'Ene','02':'Feb','03':'Mar','04':'Abr','05':'May','06':'Jun','07':'Jul','08':'Ago','09':'Sep','10':'Oct','11':'Nov','12':'Dic'}; return M[p.slice(5)]+' '+p.slice(2,4) }

const PARTIDA_LABEL = {
  sueldo_base:'Sueldo base', gratificacion:'Gratificación', comision:'Comisiones',
  hora_extra:'Horas extra', bono:'Bonos', viatico:'Viáticos', colacion:'Colación',
  movilizacion:'Movilización', honorario:'Honorarios'
}
const pl = t => PARTIDA_LABEL[t] || t
const SUC_LABEL = { 'suc-lg':'La Granja','suc-la':'Los Ángeles','suc-mp':'Maipú','suc-cd':'CD','suc-web':'Web' }
const PALETTE = ['#6366F1','#06B6D4','#F59E0B','#EF4444','#10B981','#8B5CF6','#EC4899','#14B8A6','#F97316','#3B82F6']

export function RemuneracionesDashboard({ cu }) {
  const [master, setMaster] = useState([])
  const [costoEmp, setCostoEmp] = useState([])
  const [metricas, setMetricas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { let c=false; (async () => {
    setLoading(true)
    await preloadCaps(cu, 'rrhh')   // habilita canSync() en este render
    const [{data:m},{data:ce},{data:mt}] = await Promise.all([
      supabase.from('v_rrhh_master').select('*'),
      supabase.from('v_rrhh_costo_empresa').select('*'),
      supabase.from('v_rrhh_metricas').select('*')
    ])
    if (c) return
    // Remuneración socios (cuenta madre 761): solo visible con capability.
    // Se filtra en el fetch — el usuario sin permiso nunca recibe los montos.
    const verSocios = canSync(cu, 'rrhh', 'rrhh.rem.ver_socios')
    const mSafe = verSocios ? (m||[]) : (m||[]).filter(r => String(r.cuenta_madre_codigo) !== '761')
    setMaster(mSafe); setCostoEmp(ce||[]); setMetricas(mt||[])
    setLoading(false)
  })(); return ()=>{c=true} }, [cu])

  const [ventana, setVentana] = useState('3')   // '2' | '3' | '6' | '12' | 'todo'

  const periodosAll = useMemo(() => [...new Set(master.map(r=>r.periodo))].sort(), [master])
  const periodos = useMemo(() =>
    ventana === 'todo' ? periodosAll : periodosAll.slice(-Number(ventana)),
  [periodosAll, ventana])
  const perSet = useMemo(() => new Set(periodos), [periodos])
  const masterVis = useMemo(() => master.filter(r => perSet.has(r.periodo)), [master, perSet])

  const ultimo = periodos[periodos.length-1]
  const anterior = periodos[periodos.length-2]
  const primero = periodos[0]
  const haberes = useMemo(() => masterVis.filter(r => ['haber_imponible','haber_no_imponible','honorario'].includes(r.naturaleza)), [masterVis])
  const dotacion = useMemo(() => {
    const m={}; masterVis.forEach(r => { if(r.cod_contaline!=null){(m[r.periodo] ??= new Set()).add(r.cod_contaline)} })
    return Object.fromEntries(Object.entries(m).map(([p,s])=>[p,s.size]))
  }, [masterVis])
  const ceMap = useMemo(() => Object.fromEntries(costoEmp.map(c=>[c.periodo,c])), [costoEmp])
  const mtMap = useMemo(() => Object.fromEntries(metricas.map(c=>[c.periodo,c])), [metricas])

  // Evolución de partidas
  const partidasHaber = useMemo(() => {
    const t={}; haberes.forEach(r => t[r.partida]=(t[r.partida]||0)+Number(r.monto))
    return Object.entries(t).sort((a,b)=>b[1]-a[1]).map(([k])=>k)
  }, [haberes])

  const evolPartida = useMemo(() => {
    const porP={}
    haberes.forEach(r => { const p=r.periodo; (porP[p] ??= {periodo:p,label:mesCorto(p)}); porP[p][r.partida]=(porP[p][r.partida]||0)+Number(r.monto) })
    return Object.values(porP).sort((a,b)=>a.periodo.localeCompare(b.periodo))
  }, [haberes])

  // Estructura de costo (fijo/variable/honorarios) por período
  const estructura = useMemo(() => periodos.map(p => {
    const m = mtMap[p]||{}
    return { label:mesCorto(p), fijo:m.costo_fijo||0, variable:m.costo_variable||0, honorario:m.costo_honorarios||0 }
  }), [periodos, mtMap])

  // Variación por partida (absoluta y por trabajador) + tendencia sostenida
  const variacionPartidas = useMemo(() => {
    if (!ultimo || !anterior) return []
    const tot = (per,part) => haberes.filter(r=>r.periodo===per && r.partida===part).reduce((s,r)=>s+Number(r.monto),0)
    const dotU=dotacion[ultimo]||1, dotA=dotacion[anterior]||1
    return partidasHaber.map(part => {
      const serie = periodos.map(p=>tot(p,part))
      const u=tot(ultimo,part), a=tot(anterior,part)
      const varAbs = a>0?(u-a)/a*100:(u>0?100:0)
      const uPT=u/dotU, aPT=a/dotA
      const varPT = aPT>0?(uPT-aPT)/aPT*100:(uPT>0?100:0)
      // tendencia sostenida: % de meses consecutivos que sube
      let subidas=0; for(let i=1;i<serie.length;i++) if(serie[i]>serie[i-1]) subidas++
      const tendencia = serie.length>1 ? subidas/(serie.length-1) : 0
      const varTotal = serie[0]>0 ? (serie[serie.length-1]-serie[0])/serie[0]*100 : 0
      const deltaVentana = serie[serie.length-1]-serie[0]
      return { partida:part, label:pl(part), ultimo:u, varAbs, varPT, tendencia, varTotal, deltaVentana, serie }
    }).sort((a,b)=>b.ultimo-a.ultimo)
  }, [haberes, ultimo, anterior, partidasHaber, dotacion, periodos])

  const crecDotacion = ultimo&&anterior&&dotacion[anterior] ? (dotacion[ultimo]-dotacion[anterior])/dotacion[anterior]*100 : 0

  // Alertas: 1) suben por trabajador más que dotación  2) tendencia sostenida al alza
  const alertas = useMemo(() => {
    const a = []
    variacionPartidas.forEach(v => {
      if (v.partida==='honorario') return
      if (v.varPT > 10 && v.ultimo > 100000)
        a.push({ ...v, tipo:'porTrab', valor:v.varPT, msg:`sube ${fPct(v.varPT)} por trabajador` })
      else if (v.tendencia >= 0.66 && v.varTotal > 20 && v.ultimo > 100000)
        a.push({ ...v, tipo:'sostenida', valor:v.varTotal, msg:`+${v.varTotal.toFixed(0)}% sostenido en ${periodos.length} meses` })
    })
    return a.sort((x,y)=>y.valor-x.valor).slice(0,6)
  }, [variacionPartidas, periodos])

  // KPIs
  const ce = ceMap[ultimo]||{}, cePrev = ceMap[anterior]||{}
  const mt = mtMap[ultimo]||{}
  const varCosto = cePrev.total_costo_empresa ? (ce.total_costo_empresa-cePrev.total_costo_empresa)/cePrev.total_costo_empresa*100 : 0
  const sparkCosto = periodos.map(p=>({v:ceMap[p]?.total_costo_empresa||0}))
  const sparkHonor = periodos.map(p=>({v:ceMap[p]?.total_honorarios||0}))

  // Concentración de HHEE por sucursal (último período)
  const hheeRanking = useMemo(() => {
    const m={}
    haberes.filter(r=>r.periodo===ultimo && r.partida==='hora_extra').forEach(r => {
      const k = SUC_LABEL[r.sucursal_id]||r.centro_costo_nombre||'Sin asignar'
      m[k]=(m[k]||0)+Number(r.monto)
    })
    return Object.entries(m).map(([k,v])=>({name:k,value:v})).sort((a,b)=>b.value-a.value)
  }, [haberes, ultimo])

  if (loading) return <div style={ld}>Cargando dashboard...</div>
  if (!periodos.length) return <Empty/>

  const pctVar = mt.pct_variable_planilla||0
  const pctHon = mt.pct_honorarios||0

  return (
    <div style={{maxWidth:1500,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12,marginBottom:24}}>
        <div>
          <h2 style={{margin:0,fontSize:24,fontWeight:700,letterSpacing:-0.5}}>Dashboard Remuneraciones</h2>
          <p style={{color:"var(--text-muted)",margin:"4px 0 0 0",fontSize:14}}>
            {primero!==ultimo ? `${mesCorto(primero)} → ${mesCorto(ultimo)}` : mesCorto(ultimo)} · {periodos.length} período(s) · {dotacion[ultimo]} empleados + {ce.n_prestadores||0} prestadores
          </p>
        </div>
        <div style={{display:"flex",gap:2,background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:3}}>
          {[['2','2M'],['3','3M'],['6','6M'],['12','12M'],['todo','Todo']].map(([k,l])=>(
            <button key={k} onClick={()=>setVentana(k)} style={{
              padding:"6px 13px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12.5,fontWeight:600,
              background: ventana===k ? "var(--accent,#6366F1)" : "transparent",
              color: ventana===k ? "white" : "var(--text-muted)"}}>{l}</button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:14}}>
        <KPI label="Costo Empresa" valor={fmt(ce.total_costo_empresa)} trend={varCosto} spark={sparkCosto} destacado/>
        <KPI label="Planilla (haberes)" valor={fmt(ce.total_haberes)} sub={`${dotacion[ultimo]} empleados`} color="#06B6D4"/>
        <KPI label="Honorarios" valor={fmt(ce.total_honorarios)} sub={`${pctHon}% del costo`} spark={sparkHonor} color="#8B5CF6"/>
        <KPI label="Aportes patronales" valor={fmt(ce.total_aportes_patronales)} sub="estimado" color="#10B981"/>
      </div>

      {/* Segunda fila KPIs: estructura */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20}}>
        <KPI label="Costo Fijo" valor={fmt(mt.costo_fijo)} sub="sueldo base, grati, colación, movilización" color="#3B82F6" small/>
        <KPI label="Costo Variable" valor={fmt(mt.costo_variable)} sub={`${pctVar}% de la planilla · comisiones, HHEE, bonos`} color="#F59E0B" small accent={pctVar>40}/>
        <KPI label="Dotación" valor={dotacion[ultimo]} sub={`${fPct(crecDotacion)} vs mes anterior`} color="#06B6D4" small/>
      </div>

      {/* Alertas */}
      {alertas.length>0 && (
        <div style={{background:"linear-gradient(135deg,#FEF3C7,#FED7AA)",border:"1px solid #F59E0B",borderRadius:14,padding:18,marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <span style={{fontSize:20}}>⚡</span>
            <h3 style={{margin:0,fontSize:15,color:"#92400E"}}>Alertas de gasto</h3>
            <span style={{fontSize:12,color:"#92400E",opacity:0.8}}>· dotación creció {fPct(crecDotacion)}</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:10}}>
            {alertas.map((a,i) => (
              <div key={i} style={{background:"white",borderRadius:10,padding:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <span style={{fontSize:13,fontWeight:600}}>{a.label}</span>
                  <span style={{fontSize:10,padding:"2px 7px",borderRadius:10,fontWeight:600,background:a.tipo==='sostenida'?'#FEE2E2':'#FEF3C7',color:a.tipo==='sostenida'?'#991B1B':'#92400E'}}>
                    {a.tipo==='sostenida'?'tendencia':'por trabajador'}
                  </span>
                </div>
                <div style={{fontSize:20,fontWeight:700,color:"#DC2626"}}>{fPct(a.valor)}</div>
                <div style={{fontSize:11,color:"var(--text-muted)",marginTop:2}}>{a.msg} · {fmt(a.ultimo)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Estructura de costo (fijo/variable/honorarios) */}
      <Card title="Estructura de costo mensual" sub="Fijo vs Variable vs Honorarios — peso relativo de cada bloque">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={estructura} margin={{top:10,right:20,left:0,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="label" tick={{fontSize:12,fill:"var(--text-muted)"}} axisLine={false} tickLine={false}/>
            <YAxis tickFormatter={fM} tick={{fontSize:11,fill:"var(--text-muted)"}} axisLine={false} tickLine={false}/>
            <Tooltip content={<TT/>}/>
            <Legend wrapperStyle={{fontSize:12}}/>
            <Bar dataKey="fijo" name="Fijo" stackId="a" fill="#3B82F6" radius={[0,0,0,0]}/>
            <Bar dataKey="variable" name="Variable" stackId="a" fill="#F59E0B"/>
            <Bar dataKey="honorario" name="Honorarios" stackId="a" fill="#8B5CF6" radius={[6,6,0,0]}/>
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* Evolución por partida + Planilla vs Honorarios */}
      <div style={{display:"grid",gridTemplateColumns:"1.4fr 1fr",gap:16,marginTop:16}}>
        <Card title="Evolución por partida" sub="Composición de haberes + honorarios">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={evolPartida} margin={{top:10,right:20,left:0,bottom:0}}>
              <defs>{partidasHaber.map((p,i)=>(
                <linearGradient key={p} id={`ev${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={PALETTE[i%PALETTE.length]} stopOpacity={0.8}/>
                  <stop offset="95%" stopColor={PALETTE[i%PALETTE.length]} stopOpacity={0.1}/>
                </linearGradient>))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
              <XAxis dataKey="label" tick={{fontSize:12,fill:"var(--text-muted)"}} axisLine={false} tickLine={false}/>
              <YAxis tickFormatter={fM} tick={{fontSize:11,fill:"var(--text-muted)"}} axisLine={false} tickLine={false}/>
              <Tooltip content={<TT/>}/>
              <Legend wrapperStyle={{fontSize:11}} formatter={pl}/>
              {partidasHaber.map((p,i)=>(
                <Area key={p} type="monotone" dataKey={p} name={pl(p)} stackId="1" stroke={PALETTE[i%PALETTE.length]} fill={`url(#ev${i})`} strokeWidth={1.5}/>
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Variación por partida" sub={`vs mes anterior y acumulada ${mesCorto(primero)} → ${mesCorto(ultimo)}`}>
          <div style={{maxHeight:300,overflowY:"auto"}}>
            <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
              <thead style={{background:"var(--bg-surface)",position:"sticky",top:0}}>
                <tr><th style={th}>Partida</th><th style={{...th,textAlign:"right"}}>Total</th>
                <th style={{...th,textAlign:"right"}}>Var mes</th><th style={{...th,textAlign:"right"}}>Var ventana</th><th style={{...th,textAlign:"right"}}>x trab.</th></tr>
              </thead>
              <tbody>
                {variacionPartidas.map(v => (
                  <tr key={v.partida} style={{borderTop:"1px solid var(--border)"}}>
                    <td style={{...td,fontWeight:500}}>{v.label}</td>
                    <td style={{...td,textAlign:"right"}}>{fM(v.ultimo)}</td>
                    <td style={{...td,textAlign:"right",color:v.varAbs>0?"#DC2626":"#16A34A",fontWeight:600}}>{fPct(v.varAbs)}</td>
                    <td style={{...td,textAlign:"right",color:v.varTotal>0?"#DC2626":"#16A34A",fontWeight:600}}>{fPct(v.varTotal)}</td>
                    <td style={{...td,textAlign:"right",color:v.varPT>0?"#DC2626":"#16A34A"}}>{v.partida==='honorario'?'—':fPct(v.varPT)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Incremento de gasto por dimensión (sucursal / cuenta madre / centro de costo) */}
      <div style={{marginTop:16}}>
        <IncrementoGastos haberes={haberes} periodos={periodos} primero={primero} anterior={anterior} ultimo={ultimo}/>
      </div>

      {/* Alzas y bajas por glosa */}
      <div style={{marginTop:16}}>
        <GlosasAlzasBajas haberes={haberes} periodos={periodos} primero={primero} ultimo={ultimo}/>
      </div>

      {/* Matriz gasto por trabajador × mes */}
      <div style={{marginTop:16}}>
        <MatrizTrabajadorMes haberes={haberes} periodos={periodos}/>
      </div>

      {/* Concentración HHEE + distribución cuenta madre */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:16}}>
        <Card title="¿Dónde se concentran las horas extra?" sub={`${mesCorto(ultimo)} · por sucursal/área`}>
          {hheeRanking.length>0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hheeRanking} layout="vertical" margin={{left:20,right:40}}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false}/>
                <XAxis type="number" tickFormatter={fM} tick={{fontSize:11,fill:"var(--text-muted)"}} axisLine={false} tickLine={false}/>
                <YAxis type="category" dataKey="name" width={110} tick={{fontSize:11,fill:"var(--text)"}} axisLine={false} tickLine={false}/>
                <Tooltip content={<TT/>}/>
                <Bar dataKey="value" name="Horas extra" radius={[0,6,6,0]}>
                  {hheeRanking.map((d,i)=><Cell key={i} fill="#F59E0B"/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div style={{padding:40,textAlign:"center",color:"var(--text-muted)"}}>Sin horas extra en el período</div>}
        </Card>

        <DistChart title="Distribución por Cuenta Madre" periodo={ultimo} data={haberes}/>
      </div>
    </div>
  )
}

// ─── Incremento de gasto por dimensión (sucursal / cuenta madre / centro costo) ─
function IncrementoGastos({ haberes, periodos, primero, anterior, ultimo }) {
  const [dim, setDim] = useState('sucursal')   // 'sucursal' | 'cuenta_madre' | 'centro_costo'
  const [base, setBase] = useState('anterior') // 'anterior' | 'inicio'

  // Resuelve la etiqueta de la dimensión para una fila del master
  const keyDe = (r) => {
    if (dim === 'sucursal') return SUC_LABEL[r.sucursal_id] || r.sucursal_id || 'Sin asignar'
    if (dim === 'cuenta_madre') return r.cuenta_madre_nombre || 'Sin asignar'
    return r.centro_costo_nombre || 'Sin asignar'
  }
  const perBase = base === 'inicio' ? primero : anterior

  const filas = useMemo(() => {
    // total por (clave × período) dentro de la ventana
    const porClave = {}   // clave -> { periodo -> monto }
    haberes.forEach(r => {
      const k = keyDe(r)
      ;(porClave[k] ??= {})
      porClave[k][r.periodo] = (porClave[k][r.periodo] || 0) + Number(r.monto)
    })
    const totUlt = Object.values(porClave).reduce((s,serie)=>s+(serie[ultimo]||0),0) || 1
    return Object.entries(porClave).map(([k, serie]) => {
      const serieArr = periodos.map(p => serie[p] || 0)
      const act = serie[ultimo] || 0
      const ant = perBase ? (serie[perBase] || 0) : 0
      const deltaAbs = act - ant
      const deltaPct = ant > 0 ? deltaAbs/ant*100 : (act > 0 ? 100 : 0)
      return { clave:k, act, ant, deltaAbs, deltaPct, share:act/totUlt*100, serie:serieArr }
    }).sort((a,b)=>b.deltaAbs-a.deltaAbs)
  }, [haberes, dim, base, periodos, ultimo, perBase])

  const tot = useMemo(() => filas.reduce((a,f)=>({
    act:a.act+f.act, ant:a.ant+f.ant, deltaAbs:a.deltaAbs+f.deltaAbs
  }), {act:0,ant:0,deltaAbs:0}), [filas])
  const totPct = tot.ant>0 ? tot.deltaAbs/tot.ant*100 : 0

  // sparkline SVG mínimo (sin recharts, para densidad)
  const Spark = ({ serie }) => {
    if (serie.length < 2) return <span style={{color:"var(--text-muted)"}}>—</span>
    const max = Math.max(...serie), min = Math.min(...serie), rng = max-min || 1
    const W=72, H=20
    const pts = serie.map((v,i)=>`${(i/(serie.length-1))*W},${H-((v-min)/rng)*H}`).join(' ')
    const sube = serie[serie.length-1] >= serie[0]
    return <svg width={W} height={H} style={{display:"block"}}><polyline points={pts} fill="none" stroke={sube?"#DC2626":"#16A34A"} strokeWidth={1.5}/></svg>
  }

  const DIM_LABEL = { sucursal:'Sucursal', cuenta_madre:'Cuenta madre', centro_costo:'Centro de costo' }

  function exportXLSX() {
    const rows = filas.map(f => ({
      [DIM_LABEL[dim]]: f.clave,
      [`${mesCorto(perBase)}`]: Math.round(f.ant),
      [`${mesCorto(ultimo)}`]: Math.round(f.act),
      'Δ $': Math.round(f.deltaAbs),
      'Δ %': +f.deltaPct.toFixed(1),
      'Share %': +f.share.toFixed(1)
    }))
    rows.push({ [DIM_LABEL[dim]]:'TOTAL', [`${mesCorto(perBase)}`]:Math.round(tot.ant), [`${mesCorto(ultimo)}`]:Math.round(tot.act), 'Δ $':Math.round(tot.deltaAbs), 'Δ %':+totPct.toFixed(1), 'Share %':100 })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Incremento gasto')
    XLSX.writeFile(wb, `incremento_gasto_${dim}_${ultimo}.xlsx`)
  }

  const seg = (val, set, opts) => (
    <div style={{display:"flex",gap:2,background:"var(--bg-surface)",border:"1px solid var(--border)",borderRadius:8,padding:2}}>
      {opts.map(([k,l])=>(
        <button key={k} onClick={()=>set(k)} style={{
          padding:"5px 11px",borderRadius:6,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
          background: val===k ? "var(--accent,#6366F1)" : "transparent",
          color: val===k ? "white" : "var(--text-muted)"}}>{l}</button>
      ))}
    </div>
  )

  return (
    <Card
      title="Incremento de gasto por dimensión"
      sub={`Gasto en haberes · ${mesCorto(perBase)} → ${mesCorto(ultimo)} · ordenado por mayor alza`}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:12}}>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          {seg(dim, setDim, [['sucursal','Sucursal'],['cuenta_madre','Cuenta madre'],['centro_costo','Centro de costo']])}
          {seg(base, setBase, [['anterior','vs mes anterior'],['inicio','vs inicio ventana']])}
        </div>
        <button onClick={exportXLSX} style={{padding:"6px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg-card)",cursor:"pointer",fontSize:12,fontWeight:600,color:"var(--text)"}}>⬇ Excel</button>
      </div>
      {!perBase ? (
        <div style={{padding:30,textAlign:"center",color:"var(--text-muted)",fontSize:13}}>Se necesitan al menos 2 períodos para comparar.</div>
      ) : (
      <div style={{maxHeight:360,overflowY:"auto"}}>
        <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
          <thead style={{background:"var(--bg-surface)",position:"sticky",top:0}}>
            <tr>
              <th style={th}>{DIM_LABEL[dim]}</th>
              <th style={{...th,textAlign:"right"}}>{mesCorto(perBase)}</th>
              <th style={{...th,textAlign:"right"}}>{mesCorto(ultimo)}</th>
              <th style={{...th,textAlign:"right"}}>Δ $</th>
              <th style={{...th,textAlign:"right"}}>Δ %</th>
              <th style={{...th,textAlign:"center"}}>Tendencia</th>
              <th style={{...th,textAlign:"right"}}>Share</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.clave} style={{borderTop:"1px solid var(--border)"}}>
                <td style={{...td,fontWeight:500}}>{f.clave}</td>
                <td style={{...td,textAlign:"right",color:"var(--text-muted)"}}>{fM(f.ant)}</td>
                <td style={{...td,textAlign:"right",fontWeight:600}}>{fM(f.act)}</td>
                <td style={{...td,textAlign:"right",fontWeight:600,color:f.deltaAbs>0?"#DC2626":f.deltaAbs<0?"#16A34A":"var(--text-muted)"}}>{(f.deltaAbs>0?'+':'')+fM(f.deltaAbs)}</td>
                <td style={{...td,textAlign:"right",color:f.deltaPct>0?"#DC2626":f.deltaPct<0?"#16A34A":"var(--text-muted)"}}>{fPct(f.deltaPct)}</td>
                <td style={{...td,textAlign:"center"}}><div style={{display:"flex",justifyContent:"center"}}><Spark serie={f.serie}/></div></td>
                <td style={{...td,textAlign:"right",color:"var(--text-muted)"}}>{f.share.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{borderTop:"2px solid var(--border)",background:"var(--bg-surface)"}}>
              <td style={{...td,fontWeight:700}}>TOTAL</td>
              <td style={{...td,textAlign:"right",fontWeight:700}}>{fM(tot.ant)}</td>
              <td style={{...td,textAlign:"right",fontWeight:700}}>{fM(tot.act)}</td>
              <td style={{...td,textAlign:"right",fontWeight:700,color:tot.deltaAbs>0?"#DC2626":"#16A34A"}}>{(tot.deltaAbs>0?'+':'')+fM(tot.deltaAbs)}</td>
              <td style={{...td,textAlign:"right",fontWeight:700,color:totPct>0?"#DC2626":"#16A34A"}}>{fPct(totPct)}</td>
              <td style={td}></td>
              <td style={{...td,textAlign:"right",fontWeight:700}}>100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
      )}
    </Card>
  )
}

// ─── Alzas y bajas por glosa (nivel más fino que partida) ─────────────────────
function GlosasAlzasBajas({ haberes, periodos, primero, ultimo }) {
  const [fPartida, setFPartida] = useState('todas')
  const partidas = useMemo(()=>[...new Set(haberes.map(r=>r.partida))].sort(),[haberes])

  const glosas = useMemo(() => {
    const base = fPartida==='todas' ? haberes : haberes.filter(r=>r.partida===fPartida)
    const m = {}
    base.forEach(r => {
      const k = r.glosa_nombre || pl(r.partida)
      const g = (m[k] ??= { glosa:k, partida:r.partida, porMes:{} })
      g.porMes[r.periodo] = (g.porMes[r.periodo]||0) + Number(r.monto)
    })
    return Object.values(m).map(g => {
      const serie = periodos.map(p=>g.porMes[p]||0)
      const ini = serie[0], fin = serie[serie.length-1]
      const delta = fin - ini
      const pct = ini>0 ? delta/ini*100 : (fin>0?100:0)
      return { ...g, serie, ini, fin, delta, pct }
    }).filter(g => g.fin>0 || g.ini>0)
  }, [haberes, fPartida, periodos])

  const alzas = useMemo(()=>[...glosas].filter(g=>g.delta>0).sort((a,b)=>b.delta-a.delta).slice(0,7),[glosas])
  const bajas = useMemo(()=>[...glosas].filter(g=>g.delta<0).sort((a,b)=>a.delta-b.delta).slice(0,7),[glosas])

  const Spark = ({ serie, c }) => {
    const max = Math.max(...serie, 1)
    const W=64, H=20, n=serie.length
    const pts = serie.map((v,i)=>`${n>1?(i/(n-1))*W:W/2},${H - (v/max)*(H-3) - 1}`).join(' ')
    return <svg width={W} height={H}><polyline points={pts} fill="none" stroke={c} strokeWidth="1.8" strokeLinejoin="round"/></svg>
  }

  const Lista = ({ items, titulo, color, signo }) => (
    <div>
      <div style={{fontSize:12,fontWeight:700,color,marginBottom:8}}>{titulo}</div>
      {items.length===0 && <div style={{fontSize:12,color:"var(--text-muted)",fontStyle:"italic"}}>Sin movimientos en esta dirección</div>}
      <div style={{display:"grid",gap:6}}>
        {items.map(g=>(
          <div key={g.glosa} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 11px",background:"var(--bg-surface)",borderRadius:9,borderLeft:`3px solid ${color}`}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{g.glosa}</div>
              <div style={{fontSize:10,color:"var(--text-muted)"}}>{pl(g.partida)} · {fM(g.ini)} → {fM(g.fin)}</div>
            </div>
            <Spark serie={g.serie} c={color}/>
            <div style={{textAlign:"right",flexShrink:0,minWidth:76}}>
              <div style={{fontSize:12.5,fontWeight:800,color}}>{signo}{fM(Math.abs(g.delta))}</div>
              <div style={{fontSize:10,color:"var(--text-muted)"}}>{fPct(g.pct)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <Card title="¿Dónde están las alzas y bajas?" sub={`Por glosa · ${mesCorto(primero)} → ${mesCorto(ultimo)} (ventana seleccionada)`}>
      <div style={{marginBottom:12}}>
        <select value={fPartida} onChange={e=>setFPartida(e.target.value)}
          style={{padding:"7px 10px",border:"1px solid var(--border)",borderRadius:8,fontSize:12.5,background:"var(--bg-surface)",color:"var(--text)"}}>
          <option value="todas">Todas las partidas</option>
          {partidas.map(p=><option key={p} value={p}>{pl(p)}</option>)}
        </select>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
        <Lista items={alzas} titulo="▲ Mayores alzas (Δ CLP en la ventana)" color="#DC2626" signo="+"/>
        <Lista items={bajas} titulo="▼ Mayores bajas (Δ CLP en la ventana)" color="#16A34A" signo="−"/>
      </div>
    </Card>
  )
}

// ─── Matriz: composición del gasto por trabajador × mes ───────────────────────
function MatrizTrabajadorMes({ haberes, periodos }) {
  const [abierto, setAbierto] = useState(null)   // trabajador expandido
  const [busq, setBusq] = useState('')

  const filas = useMemo(() => {
    const m = {}
    haberes.forEach(r => {
      const k = r.trabajador || `#${r.cod_contaline}` || 'Sin nombre'
      const f = (m[k] ??= { trabajador:k, porMes:{}, porMesPartida:{}, total:0 })
      f.porMes[r.periodo] = (f.porMes[r.periodo]||0) + Number(r.monto)
      const pm = (f.porMesPartida[r.periodo] ??= {})
      pm[r.partida] = (pm[r.partida]||0) + Number(r.monto)
      f.total += Number(r.monto)
    })
    return Object.values(m).sort((a,b)=>b.total-a.total)
  }, [haberes])

  const filasVis = useMemo(() => {
    const q = busq.trim().toLowerCase()
    return q ? filas.filter(f=>f.trabajador.toLowerCase().includes(q)) : filas
  }, [filas, busq])

  const totCol = useMemo(() => {
    const t = {}
    periodos.forEach(p => t[p] = filas.reduce((s,f)=>s+(f.porMes[p]||0),0))
    return t
  }, [filas, periodos])

  const celda = (f, i) => {
    const p = periodos[i], v = f.porMes[p]||0
    const prev = i>0 ? (f.porMes[periodos[i-1]]||0) : null
    let bg = 'transparent'
    if (prev != null && prev > 0 && v > 0) {
      const d = (v-prev)/prev
      if (d > 0.05) bg = `rgba(220,38,38,${Math.min(0.22, d*0.5)})`
      else if (d < -0.05) bg = `rgba(22,163,74,${Math.min(0.22, -d*0.5)})`
    }
    return { v, bg }
  }

  function exportXLSX() {
    const rows = filasVis.map(f => {
      const o = { Trabajador: f.trabajador }
      periodos.forEach(p => o[mesCorto(p)] = f.porMes[p]||0)
      o['Total ventana'] = periodos.reduce((s,p)=>s+(f.porMes[p]||0),0)
      return o
    })
    const tot = { Trabajador:'TOTAL' }
    periodos.forEach(p => tot[mesCorto(p)] = totCol[p])
    tot['Total ventana'] = periodos.reduce((s,p)=>s+totCol[p],0)
    rows.push(tot)
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Gasto por trabajador')
    XLSX.writeFile(wb, `gasto_trabajador_mes_${periodos[0]}_${periodos[periodos.length-1]}.xlsx`)
  }

  return (
    <Card title="Composición del gasto por trabajador × mes"
      sub="Haberes + honorarios · celdas sombreadas según variación vs mes anterior (rojo sube, verde baja) · clic en un trabajador para ver el desglose por partida">
      <div style={{display:"flex",justifyContent:"space-between",gap:10,marginBottom:10,flexWrap:"wrap"}}>
        <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder="🔎 Filtrar trabajador..."
          style={{padding:"7px 10px",border:"1px solid var(--border)",borderRadius:8,fontSize:12.5,background:"var(--bg-surface)",color:"var(--text)",width:230}}/>
        <button onClick={exportXLSX} style={{padding:"7px 13px",border:"1px solid var(--border)",borderRadius:8,fontSize:12.5,fontWeight:600,background:"var(--bg-surface)",color:"var(--text)",cursor:"pointer"}}>⬇️ Exportar XLSX</button>
      </div>
      <div style={{overflowX:"auto",maxHeight:520,overflowY:"auto"}}>
        <table style={{width:"100%",fontSize:12,borderCollapse:"collapse",minWidth:640}}>
          <thead style={{background:"var(--bg-surface)",position:"sticky",top:0,zIndex:2}}>
            <tr>
              <th style={{...th,minWidth:190}}>Trabajador</th>
              {periodos.map(p=><th key={p} style={{...th,textAlign:"right"}}>{mesCorto(p)}</th>)}
              <th style={{...th,textAlign:"right"}}>Total</th>
              <th style={{...th,textAlign:"right"}}>Δ ventana</th>
            </tr>
          </thead>
          <tbody>
            {filasVis.map(f => {
              const ini = f.porMes[periodos[0]]||0, fin = f.porMes[periodos[periodos.length-1]]||0
              const pct = ini>0 ? (fin-ini)/ini*100 : (fin>0?100:0)
              const exp = abierto===f.trabajador
              return (
                <>
                  <tr key={f.trabajador} onClick={()=>setAbierto(exp?null:f.trabajador)}
                    style={{borderTop:"1px solid var(--border)",cursor:"pointer",background:exp?"var(--bg-surface)":"transparent"}}>
                    <td style={{...td,fontWeight:600,whiteSpace:"nowrap"}}>{exp?'▾':'▸'} {f.trabajador}</td>
                    {periodos.map((p,i)=>{
                      const {v,bg}=celda(f,i)
                      return <td key={p} style={{...td,textAlign:"right",background:bg}}>{v?fM(v):'·'}</td>
                    })}
                    <td style={{...td,textAlign:"right",fontWeight:700}}>{fM(f.total)}</td>
                    <td style={{...td,textAlign:"right",fontWeight:700,color:pct>0?"#DC2626":pct<0?"#16A34A":"var(--text-muted)"}}>{periodos.length>1?fPct(pct):'—'}</td>
                  </tr>
                  {exp && (
                    <tr key={f.trabajador+'_det'}>
                      <td colSpan={periodos.length+3} style={{padding:"4px 10px 12px 28px",background:"var(--bg-surface)"}}>
                        <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
                          <thead><tr>
                            <th style={{...th,fontSize:10}}>Partida</th>
                            {periodos.map(p=><th key={p} style={{...th,fontSize:10,textAlign:"right"}}>{mesCorto(p)}</th>)}
                          </tr></thead>
                          <tbody>
                            {[...new Set(periodos.flatMap(p=>Object.keys(f.porMesPartida[p]||{})))].sort().map(part=>(
                              <tr key={part} style={{borderTop:"1px solid var(--border)"}}>
                                <td style={{...td,padding:"5px 10px"}}>{pl(part)}</td>
                                {periodos.map(p=>(
                                  <td key={p} style={{...td,padding:"5px 10px",textAlign:"right"}}>{f.porMesPartida[p]?.[part]?fM(f.porMesPartida[p][part]):'·'}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{borderTop:"2px solid var(--border)",background:"var(--bg-surface)",position:"sticky",bottom:0}}>
              <td style={{...td,fontWeight:800}}>TOTAL ({filasVis.length})</td>
              {periodos.map(p=><td key={p} style={{...td,textAlign:"right",fontWeight:800}}>{fM(filasVis.reduce((s,f)=>s+(f.porMes[p]||0),0))}</td>)}
              <td style={{...td,textAlign:"right",fontWeight:800}}>{fM(filasVis.reduce((s,f)=>s+f.total,0))}</td>
              <td style={td}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  )
}

function DistChart({ title, periodo, data }) {
  const dist = useMemo(() => {
    const m={}
    data.filter(r=>r.periodo===periodo).forEach(r => { const k=r.cuenta_madre_nombre||'Sin asignar'; m[k]=(m[k]||0)+Number(r.monto) })
    return Object.entries(m).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value)
  }, [data, periodo])
  return (
    <Card title={title} sub={mesCorto(periodo)}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={dist} layout="vertical" margin={{left:20,right:40}}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false}/>
          <XAxis type="number" tickFormatter={fM} tick={{fontSize:11,fill:"var(--text-muted)"}} axisLine={false} tickLine={false}/>
          <YAxis type="category" dataKey="name" width={150} tick={{fontSize:10,fill:"var(--text)"}} axisLine={false} tickLine={false}/>
          <Tooltip content={<TT/>}/>
          <Bar dataKey="value" radius={[0,6,6,0]}>{dist.map((d,i)=><Cell key={i} fill={PALETTE[i%PALETTE.length]}/>)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

function KPI({ label, valor, sub, trend, spark, destacado, color, small, accent }) {
  return (
    <div style={{padding:small?14:18,borderRadius:14,position:"relative",overflow:"hidden",
      background: destacado?"linear-gradient(135deg,#1a1a2e,#16213e)":"var(--bg-card)",
      border: destacado?"none":accent?"2px solid #F59E0B":"1px solid var(--border)", color: destacado?"white":"var(--text)"}}>
      <div style={{fontSize:11,opacity:0.7,textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>{label}</div>
      <div style={{fontSize:small?20:24,fontWeight:700,marginBottom:4,letterSpacing:-0.5}}>{valor}</div>
      {trend!==undefined && <div style={{fontSize:11,color:destacado?(trend>0?"#FF8A8A":"#6EE7A0"):(trend>0?"#DC2626":"#16A34A"),fontWeight:600}}>
        {trend>0?"↑":trend<0?"↓":"→"} {Math.abs(trend).toFixed(1)}% vs mes anterior</div>}
      {sub && <div style={{fontSize:10.5,opacity:0.6,marginTop:4,lineHeight:1.3}}>{sub}</div>}
      {spark&&spark.length>1 && (
        <div style={{position:"absolute",right:0,bottom:0,width:80,height:34,opacity:0.45}}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={spark}><Line type="monotone" dataKey="v" stroke={destacado?"#8B9DFF":color} strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function Card({ title, sub, children }) {
  return (
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:20}}>
      <div style={{marginBottom:16}}>
        <h3 style={{margin:0,fontSize:16,fontWeight:600}}>{title}</h3>
        {sub && <div style={{fontSize:12,color:"var(--text-muted)",marginTop:2}}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function TT({ active, payload, label }) {
  if (!active||!payload||!payload.length) return null
  const rows = payload.filter(p=>p.value>0)
  const total = rows.reduce((s,p)=>s+p.value,0)
  return (
    <div style={{background:"var(--bg-surface)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",fontSize:12,boxShadow:"0 4px 12px rgba(0,0,0,.15)",maxWidth:280}}>
      {label && <div style={{fontWeight:600,marginBottom:6}}>{label}</div>}
      {rows.map((p,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",gap:16,marginBottom:2}}>
        <span style={{color:p.color||p.fill}}>● {p.name}</span><b>{fmt(p.value)}</b></div>))}
      {rows.length>1 && <div style={{display:"flex",justifyContent:"space-between",gap:16,marginTop:6,paddingTop:6,borderTop:"1px solid var(--border)",fontWeight:700}}><span>Total</span><span>{fmt(total)}</span></div>}
    </div>
  )
}

function Empty() {
  return <div style={{textAlign:"center",padding:60}}><div style={{fontSize:48,marginBottom:12}}>📊</div><h3>Sin liquidaciones cargadas</h3><p style={{color:"var(--text-muted)"}}>Ve a "Cargar Liquidaciones" para subir el primer PDF.</p></div>
}

const ld = {textAlign:"center",padding:60,color:"var(--text-muted)"}
const th = {padding:"8px 10px",textAlign:"left",fontSize:11,fontWeight:600,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:0.4}
const td = {padding:"7px 10px"}
