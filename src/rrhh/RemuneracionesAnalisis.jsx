import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabase'
import { canSync, preloadCaps } from '../core/permisos'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const fmt = n => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n||0)
const fN = n => new Intl.NumberFormat("es-CL").format(Math.round(n||0))
const fM = n => n>=1e6?(n/1e6).toFixed(1)+'M':(n/1e3).toFixed(0)+'k'
const fPct = n => (n>0?'+':'')+n.toFixed(1)+'%'

const PARTIDA_LABEL = {
  sueldo_base:'Sueldo base', gratificacion:'Gratificación', comision:'Comisiones',
  hora_extra:'Horas extra', bono:'Bonos', viatico:'Viáticos', colacion:'Colación',
  movilizacion:'Movilización', afp:'AFP', salud:'Salud', cesantia:'Cesantía',
  impuesto:'Impuesto', anticipo:'Anticipos', prestamo:'Préstamos', descuento_interno:'Desc. interno'
}
const pl = t => PARTIDA_LABEL[t] || t
const SUC_LABEL = { 'suc-lg':'La Granja','suc-la':'Los Ángeles','suc-mp':'Maipú','suc-cd':'CD','suc-web':'Web' }
const PALETTE = ['#6366F1','#06B6D4','#F59E0B','#EF4444','#10B981','#8B5CF6','#EC4899','#14B8A6','#F97316','#3B82F6','#A855F7','#84CC16']

const DIMS = [
  {k:'partida', l:'Partida'},
  {k:'tipo_gasto', l:'Tipo Gasto'},
  {k:'cuenta_madre_nombre', l:'Cuenta Madre'},
  {k:'centro_costo_nombre', l:'Centro de Costo'},
  {k:'sucursal_id', l:'Sucursal'},
  {k:'glosa_nombre', l:'Glosa específica'},
  {k:'cargo', l:'Cargo'},
  {k:'trabajador', l:'Trabajador'}
]

export function RemuneracionesAnalisis({ cu }) {
  const [master, setMaster] = useState([])
  const [loading, setLoading] = useState(true)
  const [dim, setDim] = useState('partida')
  const [natFiltro, setNatFiltro] = useState('haberes')
  const [filtroPeriodos, setFiltroPeriodos] = useState([])
  const [filtroSuc, setFiltroSuc] = useState([])
  const [filtroCeco, setFiltroCeco] = useState([])
  const [drill, setDrill] = useState(null)   // { key } o null
  const [modo, setModo] = useState('pivote')  // 'pivote' | 'comparar'
  const [perA, setPerA] = useState(null)
  const [perB, setPerB] = useState(null)

  useEffect(() => { (async () => {
    setLoading(true)
    await preloadCaps(cu, 'rrhh')
    const { data } = await supabase.from('v_rrhh_master').select('*')
    // Remuneración socios (761): solo con capability. Filtrado en el fetch para
    // que no aparezca en ningún pivote, drill ni comparación.
    const verSocios = canSync(cu, 'rrhh', 'rrhh.rem.ver_socios')
    setMaster(verSocios ? (data||[]) : (data||[]).filter(r => String(r.cuenta_madre_codigo) !== '761'))
    setLoading(false)
  })() }, [cu])

  // Cerrar drill si cambia dimensión o filtros
  useEffect(() => { setDrill(null) }, [dim, natFiltro, filtroPeriodos, filtroSuc, filtroCeco])

  const periodos = useMemo(() => [...new Set(master.map(r=>r.periodo))].sort(), [master])

  // Inicializar período A/B cuando llegan los datos
  useEffect(() => {
    if (periodos.length >= 2 && (!perA || !perB)) {
      setPerA(periodos[periodos.length - 2])
      setPerB(periodos[periodos.length - 1])
    } else if (periodos.length === 1 && (!perA || !perB)) {
      setPerA(periodos[0]); setPerB(periodos[0])
    }
  }, [periodos, perA, perB])
  const sucursales = useMemo(() => [...new Set(master.map(r=>r.sucursal_id).filter(Boolean))], [master])
  const cecos = useMemo(() => [...new Set(master.map(r=>r.centro_costo_nombre).filter(Boolean))].sort(), [master])

  const dotacion = useMemo(() => {
    const m = {}
    master.forEach(r => { (m[r.periodo] ??= new Set()).add(r.cod_contaline) })
    return Object.fromEntries(Object.entries(m).map(([p,s])=>[p,s.size]))
  }, [master])

  const filtrada = useMemo(() => master.filter(r => {
    if (natFiltro==='haberes' && !(r.naturaleza==='haber_imponible'||r.naturaleza==='haber_no_imponible'||r.naturaleza==='honorario')) return false
    if (natFiltro==='descuentos' && !(r.naturaleza==='descuento_legal'||r.naturaleza==='descuento_interno')) return false
    if (filtroPeriodos.length && !filtroPeriodos.includes(r.periodo)) return false
    if (filtroSuc.length && !filtroSuc.includes(r.sucursal_id)) return false
    if (filtroCeco.length && !filtroCeco.includes(r.centro_costo_nombre)) return false
    return true
  }), [master, natFiltro, filtroPeriodos, filtroSuc, filtroCeco])

  const labelDim = r => {
    const v = r[dim]
    if (dim==='partida') return pl(v)
    if (dim==='sucursal_id') return SUC_LABEL[v]||v||'Sin asignar'
    return v || 'Sin asignar'
  }

  const periodosVis = filtroPeriodos.length ? [...filtroPeriodos].sort() : periodos

  const pivote = useMemo(() => {
    const rows = new Map()
    filtrada.forEach(r => {
      const k = labelDim(r)
      if (!rows.has(k)) rows.set(k, {})
      const cur = rows.get(k)
      cur[r.periodo] = (cur[r.periodo]||0)+Number(r.monto)
    })
    return [...rows.entries()].map(([k,vals]) => {
      const total = Object.values(vals).reduce((a,b)=>a+b,0)
      const pa = periodosVis[0], pu = periodosVis[periodosVis.length-1]
      const va = vals[pa]||0, vu = vals[pu]||0
      const varPct = va>0?(vu-va)/va*100:(vu>0?100:0)
      return { key:k, vals, total, varPct }
    }).sort((a,b)=>b.total-a.total)
  }, [filtrada, dim, periodosVis])

  const totPorPeriodo = useMemo(() => {
    const t = {}
    pivote.forEach(r => Object.entries(r.vals).forEach(([p,v])=>t[p]=(t[p]||0)+v))
    return t
  }, [pivote])

  const grandTotal = useMemo(() => pivote.reduce((s,r)=>s+r.total,0), [pivote])
  const chartData = useMemo(() => pivote.slice(0,12).map(r=>({name:r.key,value:r.total})), [pivote])

  // Drill-down: registros individuales de la dimensión seleccionada
  const drillRows = useMemo(() => {
    if (!drill) return []
    return filtrada
      .filter(r => labelDim(r) === drill.key)
      .sort((a,b) => a.periodo.localeCompare(b.periodo) || Number(b.monto)-Number(a.monto))
  }, [drill, filtrada])

  const drillTotales = useMemo(() => {
    const t = {}
    drillRows.forEach(r => { t[r.periodo]=(t[r.periodo]||0)+Number(r.monto) })
    return t
  }, [drillRows])

  // Comparador A vs B: agrupa filas filtradas por dimensión, suma para cada período
  const comparador = useMemo(() => {
    if (!perA || !perB) return []
    const rows = new Map()
    filtrada.forEach(r => {
      const k = labelDim(r)
      if (!rows.has(k)) rows.set(k, { a:0, b:0 })
      const cur = rows.get(k)
      if (r.periodo === perA) cur.a += Number(r.monto)
      if (r.periodo === perB) cur.b += Number(r.monto)
    })
    return [...rows.entries()]
      .map(([key, v]) => {
        const diff = v.b - v.a
        const varPct = v.a > 0 ? diff / v.a * 100 : (v.b > 0 ? 100 : 0)
        return { key, a: v.a, b: v.b, diff, varPct }
      })
      .filter(r => r.a > 0 || r.b > 0)
      .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
  }, [filtrada, perA, perB, dim])

  const compTotales = useMemo(() => ({
    a: comparador.reduce((s,r)=>s+r.a, 0),
    b: comparador.reduce((s,r)=>s+r.b, 0)
  }), [comparador])

  // ── Returns tempranos DESPUÉS de todos los hooks ──
  if (loading) return <div style={{textAlign:"center",padding:60}}>Cargando análisis...</div>
  if (!master.length) return (
    <div style={{textAlign:"center",padding:60}}>
      <div style={{fontSize:48,marginBottom:12}}>📈</div><h3>Sin datos</h3>
      <p style={{color:"var(--text-muted)"}}>Carga liquidaciones para analizar.</p>
    </div>
  )

  const tog = (arr,set,v) => set(arr.includes(v)?arr.filter(x=>x!==v):[...arr,v])
  const abrirDrill = key => setDrill(drill?.key===key ? null : { key })

  return (
    <div style={{maxWidth:1500,margin:"0 auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,gap:16}}>
        <div>
          <h2 style={{margin:0,fontSize:24,fontWeight:700,letterSpacing:-0.5}}>Análisis de Remuneraciones</h2>
          <p style={{color:"var(--text-muted)",margin:"4px 0 0 0",fontSize:13}}>
            {modo==='pivote'
              ? 'Pivote multidimensional · click en barra o doble click en fila para ver registros'
              : 'Comparador A vs B · contrasta dos períodos lado a lado para cualquier dimensión'}
          </p>
        </div>
        <div style={{display:"flex",gap:4,background:"var(--bg-surface)",padding:4,borderRadius:10,border:"1px solid var(--border)"}}>
          {[['pivote','📊 Pivote'],['comparar','⇄ Comparar']].map(([k,l]) => (
            <button key={k} onClick={()=>setModo(k)} style={{
              padding:"8px 14px",border:"none",borderRadius:7,cursor:"pointer",fontSize:13,fontWeight:600,
              background: modo===k?"var(--accent)":"transparent", color: modo===k?"white":"var(--text-muted)"
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Controles */}
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:16,marginBottom:16}}>
        <div style={{display:"flex",gap:20,flexWrap:"wrap",alignItems:"flex-start"}}>
          <div>
            <div style={lbl}>Naturaleza</div>
            <div style={{display:"flex",gap:6}}>
              {[['haberes','Haberes'],['descuentos','Descuentos'],['todo','Todo']].map(([k,l]) => (
                <button key={k} onClick={()=>setNatFiltro(k)} style={{...btn,...(natFiltro===k?act:{})}}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={lbl}>Dimensión</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",maxWidth:520}}>
              {DIMS.map(o => <button key={o.k} onClick={()=>setDim(o.k)} style={{...btn,...(dim===o.k?act:{})}}>{o.l}</button>)}
            </div>
          </div>
          <div>
            <div style={lbl}>Períodos ({filtroPeriodos.length||'todos'})</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {periodos.map(p => <button key={p} onClick={()=>tog(filtroPeriodos,setFiltroPeriodos,p)} style={{...btnSm,...(filtroPeriodos.includes(p)?act:{})}}>{p}</button>)}
            </div>
          </div>
          <div>
            <div style={lbl}>Sucursal ({filtroSuc.length||'todas'})</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {sucursales.map(s => <button key={s} onClick={()=>tog(filtroSuc,setFiltroSuc,s)} style={{...btnSm,...(filtroSuc.includes(s)?act:{})}}>{SUC_LABEL[s]||s}</button>)}
            </div>
          </div>
          {cecos.length>0 && (
            <div>
              <div style={lbl}>CECO ({filtroCeco.length||'todos'})</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",maxWidth:360}}>
                {cecos.map(c => <button key={c} onClick={()=>tog(filtroCeco,setFiltroCeco,c)} style={{...btnSm,...(filtroCeco.includes(c)?act:{})}}>{c}</button>)}
              </div>
            </div>
          )}
          {(filtroPeriodos.length||filtroSuc.length||filtroCeco.length)>0 &&
            <button onClick={()=>{setFiltroPeriodos([]);setFiltroSuc([]);setFiltroCeco([])}} style={{...btn,color:"var(--danger)"}}>Limpiar</button>}
        </div>
      </div>

      {/* Gráfico de barras — click abre drill (solo modo pivote) */}
      {modo==='pivote' && (
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:20,marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h3 style={{margin:0,fontSize:16,fontWeight:600}}>Top por {DIMS.find(d=>d.k===dim)?.l}</h3>
          <span style={{fontSize:12,color:"var(--text-muted)"}}>Click en barra para ver registros</span>
        </div>
        <ResponsiveContainer width="100%" height={Math.max(220,chartData.length*36)}>
          <BarChart data={chartData} layout="vertical" margin={{left:20,right:40}}
            onClick={e => e?.activePayload?.[0] && abrirDrill(e.activePayload[0].payload.name)}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false}/>
            <XAxis type="number" tickFormatter={fM} tick={{fontSize:11,fill:"var(--text-muted)"}} axisLine={false} tickLine={false}/>
            <YAxis type="category" dataKey="name" width={160} tick={{fontSize:11,fill:"var(--text)"}} axisLine={false} tickLine={false}/>
            <Tooltip content={({active,payload}) => active&&payload?.[0] ? (
              <div style={{background:"var(--bg-surface)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 12px",fontSize:12}}>
                <div style={{fontWeight:600}}>{payload[0].payload.name}</div>
                <b>{fmt(payload[0].value)}</b>
                <div style={{fontSize:11,color:"var(--text-muted)",marginTop:4}}>Click para ver registros</div>
              </div>) : null}/>
            <Bar dataKey="value" radius={[0,6,6,0]} cursor="pointer">
              {chartData.map((d,i)=>(
                <Cell key={i}
                  fill={drill?.key===d.name ? PALETTE[i%PALETTE.length] : PALETTE[i%PALETTE.length]+'AA'}
                  stroke={drill?.key===d.name ? PALETTE[i%PALETTE.length] : 'none'}
                  strokeWidth={2}/>
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      )}

      {/* Panel drill-down (solo en pivote) */}
      {modo==='pivote' && drill && (
        <div style={{background:"var(--bg-card)",border:"2px solid var(--accent)",borderRadius:14,marginBottom:16,overflow:"hidden"}}>
          <div style={{background:"var(--accent)",padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <span style={{color:"white",fontWeight:700,fontSize:15}}>🔍 Detalle: {drill.key}</span>
              <span style={{color:"white",opacity:0.8,fontSize:12,marginLeft:12}}>{drillRows.length} registros · {fmt(drillRows.reduce((s,r)=>s+Number(r.monto),0))}</span>
            </div>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              {/* Totales por período */}
              {periodosVis.map(p => (
                <span key={p} style={{color:"white",fontSize:12}}>
                  <span style={{opacity:0.7}}>{p}: </span><b>{fmt(drillTotales[p]||0)}</b>
                </span>
              ))}
              <button onClick={()=>setDrill(null)} style={{background:"rgba(255,255,255,.2)",border:"none",borderRadius:6,color:"white",padding:"4px 10px",cursor:"pointer",fontSize:13}}>✕</button>
            </div>
          </div>
          <div style={{maxHeight:400,overflowY:"auto"}}>
            <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
              <thead style={{background:"var(--bg-surface)",position:"sticky",top:0}}>
                <tr>
                  <th style={thS}>Período</th>
                  <th style={thS}>Cód</th>
                  <th style={thS}>Trabajador</th>
                  <th style={thS}>Cargo</th>
                  <th style={thS}>Glosa</th>
                  <th style={thS}>Tipo</th>
                  <th style={thS}>Naturaleza</th>
                  <th style={thS}>CECO</th>
                  <th style={thS}>Cuenta Madre</th>
                  <th style={{...thS,textAlign:"right"}}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {drillRows.map((r,i) => (
                  <tr key={i} style={{borderTop:"1px solid var(--border)",background: i%2===0?"transparent":"var(--bg-surface)"}}>
                    <td style={tdS}>{r.periodo}</td>
                    <td style={{...tdS,fontWeight:600}}>{r.cod_contaline}</td>
                    <td style={tdS}>{r.trabajador}</td>
                    <td style={{...tdS,color:"var(--text-muted)"}}>{r.cargo}</td>
                    <td style={tdS}>{r.glosa_nombre}</td>
                    <td style={tdS}>{pl(r.tipo_glosa)||r.tipo_glosa}</td>
                    <td style={tdS}>
                      <span style={{
                        fontSize:10,padding:"2px 6px",borderRadius:4,fontWeight:600,
                        background: r.naturaleza==='haber_imponible'?'#D1FAE5':r.naturaleza==='haber_no_imponible'?'#DBEAFE':r.naturaleza==='descuento_legal'?'#FEE2E2':'#FEF3C7',
                        color: r.naturaleza==='haber_imponible'?'#065F46':r.naturaleza==='haber_no_imponible'?'#1E40AF':r.naturaleza==='descuento_legal'?'#991B1B':'#92400E'
                      }}>{r.naturaleza}</span>
                    </td>
                    <td style={{...tdS,color:"var(--text-muted)"}}>{r.centro_costo_nombre||'—'}</td>
                    <td style={{...tdS,color:"var(--text-muted)"}}>{r.cuenta_madre_nombre||'—'}</td>
                    <td style={{...tdS,textAlign:"right",fontWeight:700}}>{fmt(r.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tabla pivote — doble click en fila abre drill (solo modo pivote) */}
      {modo==='pivote' && (
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,overflow:"auto"}}>
        <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",fontSize:12,color:"var(--text-muted)"}}>
          Doble click en cualquier fila para ver sus registros individuales
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:800}}>
          <thead style={{background:"var(--bg-surface)"}}>
            <tr>
              <th style={{...th,minWidth:180,position:"sticky",left:0,background:"var(--bg-surface)",zIndex:1}}>{DIMS.find(d=>d.k===dim)?.l}</th>
              {periodosVis.map(p => <th key={p} style={{...th,textAlign:"right"}}>{p}</th>)}
              <th style={{...th,textAlign:"right",background:"var(--bg-surface)"}}>Total</th>
              <th style={{...th,textAlign:"right"}}>Var. %</th>
              <th style={{...th,textAlign:"right",fontSize:11}}>% s/total</th>
            </tr>
          </thead>
          <tbody>
            {pivote.map(r => (
              <tr key={r.key}
                onDoubleClick={() => abrirDrill(r.key)}
                style={{
                  borderTop:"1px solid var(--border)",
                  cursor:"pointer",
                  background: drill?.key===r.key ? "rgba(99,102,241,.06)" : "transparent"
                }}>
                <td style={{...td,fontWeight:500,position:"sticky",left:0,background: drill?.key===r.key?"rgba(99,102,241,.06)":"var(--bg-card)"}}>
                  {drill?.key===r.key && <span style={{marginRight:6,color:"var(--accent)"}}>▶</span>}
                  {r.key}
                </td>
                {periodosVis.map(p => <td key={p} style={{...td,textAlign:"right"}}>{r.vals[p]?fN(r.vals[p]):<span style={{color:"var(--text-muted)"}}>—</span>}</td>)}
                <td style={{...td,textAlign:"right",fontWeight:700,background:"var(--bg-surface)"}}>{fmt(r.total)}</td>
                <td style={{...td,textAlign:"right",fontWeight:600,color: r.varPct>0?"#DC2626":r.varPct<0?"#16A34A":"var(--text-muted)"}}>
                  {periodosVis.length>1 ? fPct(r.varPct) : '—'}
                </td>
                <td style={{...td,textAlign:"right",fontSize:11,color:"var(--text-muted)"}}>{grandTotal>0?(r.total/grandTotal*100).toFixed(1)+'%':''}</td>
              </tr>
            ))}
            <tr style={{borderTop:"2px solid var(--text)",background:"var(--bg-surface)",fontWeight:700}}>
              <td style={{...td,position:"sticky",left:0,background:"var(--bg-surface)"}}>TOTAL</td>
              {periodosVis.map(p => <td key={p} style={{...td,textAlign:"right"}}>{fN(totPorPeriodo[p]||0)}</td>)}
              <td style={{...td,textAlign:"right"}}>{fmt(grandTotal)}</td>
              <td style={td}/><td style={td}/>
            </tr>
          </tbody>
        </table>
      </div>
      )}

      {/* Comparador A vs B (solo modo comparar) */}
      {modo==='comparar' && (
      <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,overflow:"hidden",marginBottom:16}}>
        <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border)",display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{display:"flex",gap:12,alignItems:"center"}}>
            <div>
              <div style={lbl}>Período A (base)</div>
              <select value={perA||''} onChange={e=>setPerA(e.target.value)} style={{...inp,minWidth:130}}>
                {periodos.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{fontSize:24,color:"var(--text-muted)",marginTop:18}}>→</div>
            <div>
              <div style={lbl}>Período B (comparar)</div>
              <select value={perB||''} onChange={e=>setPerB(e.target.value)} style={{...inp,minWidth:130}}>
                {periodos.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <button onClick={() => { const a=perA; setPerA(perB); setPerB(a) }} style={{...btn,marginTop:18}} title="Intercambiar períodos">⇄</button>
          </div>
          {comparador.length>0 && (
            <div style={{marginLeft:"auto",display:"flex",gap:14,fontSize:12}}>
              <Stat label={`Total ${perA}`} valor={fmt(compTotales.a)}/>
              <Stat label={`Total ${perB}`} valor={fmt(compTotales.b)}/>
              <Stat label="Diferencia" valor={fmt(compTotales.b - compTotales.a)} color={compTotales.b - compTotales.a > 0 ? "#DC2626" : "#16A34A"}/>
              <Stat label="Variación" valor={compTotales.a>0?fPct((compTotales.b-compTotales.a)/compTotales.a*100):'—'} color={compTotales.b > compTotales.a ? "#DC2626" : "#16A34A"}/>
            </div>
          )}
        </div>
        <div style={{maxHeight:600,overflowY:"auto"}}>
          <table style={{width:"100%",fontSize:13,borderCollapse:"collapse"}}>
            <thead style={{background:"var(--bg-surface)",position:"sticky",top:0,zIndex:1}}>
              <tr>
                <th style={th}>{DIMS.find(d=>d.k===dim)?.l}</th>
                <th style={{...th,textAlign:"right"}}>{perA}</th>
                <th style={{...th,textAlign:"right"}}>{perB}</th>
                <th style={{...th,textAlign:"right"}}>Diferencia $</th>
                <th style={{...th,textAlign:"right"}}>Var. %</th>
                <th style={{...th,minWidth:140}}>Visual</th>
              </tr>
            </thead>
            <tbody>
              {comparador.map(r => {
                const max = Math.max(r.a, r.b, 1)
                return (
                  <tr key={r.key} style={{borderTop:"1px solid var(--border)"}}>
                    <td style={{...td,fontWeight:500}}>{r.key}</td>
                    <td style={{...td,textAlign:"right",color:"var(--text-muted)"}}>{fN(r.a)}</td>
                    <td style={{...td,textAlign:"right",fontWeight:600}}>{fN(r.b)}</td>
                    <td style={{...td,textAlign:"right",fontWeight:600,color: r.diff>0?"#DC2626":r.diff<0?"#16A34A":"var(--text-muted)"}}>
                      {r.diff===0?'—':(r.diff>0?'+':'')+fN(r.diff)}
                    </td>
                    <td style={{...td,textAlign:"right",fontWeight:600,color: r.varPct>0?"#DC2626":r.varPct<0?"#16A34A":"var(--text-muted)"}}>
                      {r.a===0&&r.b>0?'NUEVO':r.b===0&&r.a>0?'SALIÓ':fPct(r.varPct)}
                    </td>
                    <td style={td}>
                      <div style={{display:"flex",alignItems:"center",gap:4,fontSize:10}}>
                        <div style={{width:`${r.a/max*60}px`,height:8,background:"#94A3B8",borderRadius:2}} title={`A: ${fmt(r.a)}`}/>
                        <div style={{width:`${r.b/max*60}px`,height:8,background: r.b>=r.a?"#DC2626":"#16A34A",borderRadius:2}} title={`B: ${fmt(r.b)}`}/>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {comparador.length>0 && (
                <tr style={{borderTop:"2px solid var(--text)",background:"var(--bg-surface)",fontWeight:700}}>
                  <td style={td}>TOTAL</td>
                  <td style={{...td,textAlign:"right"}}>{fN(compTotales.a)}</td>
                  <td style={{...td,textAlign:"right"}}>{fN(compTotales.b)}</td>
                  <td style={{...td,textAlign:"right",color: compTotales.b-compTotales.a>0?"#DC2626":"#16A34A"}}>{(compTotales.b-compTotales.a>0?'+':'')+fN(compTotales.b-compTotales.a)}</td>
                  <td style={{...td,textAlign:"right"}}>{compTotales.a>0?fPct((compTotales.b-compTotales.a)/compTotales.a*100):'—'}</td>
                  <td style={td}/>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {comparador.length===0 && <div style={{padding:30,textAlign:"center",color:"var(--text-muted)"}}>Selecciona dos períodos para comparar.</div>}
      </div>
      )}

      {/* Resumen dotación */}
      <div style={{marginTop:16,background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:20}}>
        <h3 style={{margin:"0 0 16px 0",fontSize:16,fontWeight:600}}>Dotación y costo promedio por período</h3>
        <table style={{width:"100%",fontSize:13,borderCollapse:"collapse"}}>
          <thead style={{background:"var(--bg-surface)"}}>
            <tr>
              <th style={th}>Período</th>
              <th style={{...th,textAlign:"right"}}>Trabajadores</th>
              <th style={{...th,textAlign:"right"}}>Total (filtro actual)</th>
              <th style={{...th,textAlign:"right"}}>Promedio/trab.</th>
            </tr>
          </thead>
          <tbody>
            {periodosVis.map(p => {
              const tot = totPorPeriodo[p]||0, dot = dotacion[p]||0
              return (
                <tr key={p} style={{borderTop:"1px solid var(--border)"}}>
                  <td style={{...td,fontWeight:500}}>{p}</td>
                  <td style={{...td,textAlign:"right"}}>{dot}</td>
                  <td style={{...td,textAlign:"right"}}>{fmt(tot)}</td>
                  <td style={{...td,textAlign:"right",fontWeight:600}}>{fmt(dot?tot/dot:0)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, valor, color }) {
  return (
    <div>
      <div style={{fontSize:10,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:0.4}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color:color||"var(--text)"}}>{valor}</div>
    </div>
  )
}

const lbl = {fontSize:11,color:"var(--text-muted)",marginBottom:6,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}
const th = {padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:600,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:0.5}
const td = {padding:"8px 14px"}
const thS = {padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:600,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:0.4,borderBottom:"1px solid var(--border)"}
const tdS = {padding:"6px 12px"}
const inp = {padding:"6px 10px",border:"1px solid var(--border)",borderRadius:6,fontSize:12,background:"var(--bg-card)",color:"var(--text)"}
const btn = {padding:"6px 12px",border:"1px solid var(--border)",background:"var(--bg-surface)",color:"var(--text)",borderRadius:6,cursor:"pointer",fontSize:12}
const btnSm = {padding:"4px 8px",border:"1px solid var(--border)",background:"var(--bg-surface)",color:"var(--text)",borderRadius:4,cursor:"pointer",fontSize:11}
const act = {background:"var(--accent)",color:"white",borderColor:"var(--accent)"}
