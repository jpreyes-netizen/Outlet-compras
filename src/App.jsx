import{useState,useEffect,useMemo,useCallback}from'react'
import{supabase,signIn,signOut,getSession}from'./supabase'
import * as XLSX from 'xlsx'

/* ═══ HELPERS ═══ */
const fmt=n=>new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n||0)
const fN=n=>new Intl.NumberFormat("es-CL").format(Math.round(n||0))
const fU=n=>"USD "+new Intl.NumberFormat("en-US").format(Math.round(n||0))
const hoy=()=>new Date().toISOString().slice(0,10)
const hora=()=>new Date().toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"})
const uid=()=>"id"+Date.now().toString(36)+Math.random().toString(36).slice(2,5)
const pct=v=>Math.round(v*100)+"%"

/* ═══ DESIGN SYSTEM ═══ */
const CL={A:{c:"#FF3B30",bg:"#FF3B3015",t:"Crítico"},B:{c:"#007AFF",bg:"#007AFF15",t:"Importante"},C:{c:"#34C759",bg:"#34C75915",t:"Regular"},D:{c:"#8E8E93",bg:"#8E8E9315",t:"Bajo"}}
const STS={"Pend. Dir. Negocios":{c:"#007AFF",bg:"#007AFF15",ic:"⏳"},"Pend. Dir. Finanzas":{c:"#AF52DE",bg:"#AF52DE15",ic:"⏳"},"Pend. proveedor":{c:"#FF9500",bg:"#FF950015",ic:"🔄"},"Proforma OK":{c:"#34C759",bg:"#34C75915",ic:"✓"},"Pago fabricación":{c:"#FF9500",bg:"#FF950015",ic:"💰"},"En fabricación":{c:"#AF52DE",bg:"#AF52DE15",ic:"🏭"},"Pago embarque":{c:"#FF9500",bg:"#FF950015",ic:"💰"},"Naviera":{c:"#007AFF",bg:"#007AFF15",ic:"🚢"},"Aduana":{c:"#FF3B30",bg:"#FF3B3015",ic:"🏛"},"Pago puerto":{c:"#FF9500",bg:"#FF950015",ic:"💰"},"Internación":{c:"#FF3B30",bg:"#FF3B3015",ic:"📋"},"Transporte":{c:"#AF52DE",bg:"#AF52DE15",ic:"🚛"},"Confirmada prov.":{c:"#34C759",bg:"#34C75915",ic:"✓"},"Despacho nac.":{c:"#AF52DE",bg:"#AF52DE15",ic:"🚚"},"Recibida parcial":{c:"#FF9500",bg:"#FF950015",ic:"◐"},"Recibida OK":{c:"#34C759",bg:"#34C75915",ic:"✓"},"Cerrada":{c:"#8E8E93",bg:"#8E8E9315",ic:"■"},"Rechazada":{c:"#FF3B30",bg:"#FF3B3015",ic:"✕"},"Pago pend.":{c:"#FF9500",bg:"#FF950015",ic:"$"}}
const FN=[{n:"Solicitud"},{n:"Negocios"},{n:"Finanzas"},{n:"Proveedor"},{n:"Despacho"},{n:"Recepción"},{n:"Cierre"}]
const FI=[{n:"Solicitud"},{n:"Negocios"},{n:"Finanzas"},{n:"Proforma"},{n:"Pago fab."},{n:"Fabricación"},{n:"Pago emb."},{n:"Naviera"},{n:"Aduana"},{n:"Pago pto."},{n:"Internación"},{n:"Transporte"},{n:"Recepción"},{n:"Cierre"}]
const ROLES=[{k:"admin",l:"Admin",c:"#FF3B30",p:["todo"]},{k:"dir_general",l:"Dir. General",c:"#FF3B30",p:["aprobar_ilimitado","ver_dash","ver_fin"]},{k:"dir_finanzas",l:"Dir. Finanzas",c:"#AF52DE",p:["aprobar_fin","ver_dash","ver_fin","reg_pago"]},{k:"dir_negocios",l:"Dir. Negocios",c:"#007AFF",p:["aprobar_neg","crear_oc","ver_dash","gest_prov","valid_prov"]},{k:"analista",l:"Analista",c:"#34C759",p:["crear_oc","ver_dash","cerrar_oc","gest_prov","config","seguim","gest_imp"]},{k:"jefe_bodega",l:"Jefe Bodega",c:"#FF9500",p:["recibir","ver_dash"]},{k:"directorio",l:"Directorio",c:"#8E8E93",p:["ver_dash","ver_fin"]}]
const rl=u=>ROLES.find(r=>r.k===u?.rol)||ROLES[4]
const hp=(u,p)=>{const r=rl(u);return r.p.includes("todo")||r.p.includes(p)}

/* ═══ iOS UI COMPONENTS ═══ */
const css={card:{background:"#fff",borderRadius:16,padding:"16px 18px",boxShadow:"0 1px 3px rgba(0,0,0,0.06)",marginBottom:10,border:"1px solid rgba(0,0,0,0.04)"},cardSm:{background:"#fff",borderRadius:12,padding:"12px 14px",boxShadow:"0 1px 2px rgba(0,0,0,0.04)",border:"1px solid rgba(0,0,0,0.04)"},input:{width:"100%",padding:"10px 14px",borderRadius:12,border:"1px solid #e5e5ea",fontSize:14,background:"#fff",outline:"none",transition:"border-color 0.2s"},select:{width:"100%",padding:"10px 14px",borderRadius:12,border:"1px solid #e5e5ea",fontSize:14,background:"#fff"},btn:{padding:"12px 20px",borderRadius:12,fontSize:14,fontWeight:600,border:"none",cursor:"pointer",transition:"all 0.2s",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6},modal:{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.4)",backdropFilter:"blur(8px)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:999,padding:0}}

const Bd=({children,c,bg,lg})=><span style={{display:"inline-flex",alignItems:"center",gap:3,padding:lg?"5px 14px":"3px 10px",borderRadius:20,fontSize:lg?13:11,fontWeight:600,color:c||"#8E8E93",background:bg||"#F2F2F7",whiteSpace:"nowrap",letterSpacing:"-0.01em"}}>{children}</span>

const Mt=({l,v,sub,ac,ic})=><div style={{...css.cardSm,textAlign:"center",flex:"1 1 100px"}}>{ic&&<div style={{fontSize:20,marginBottom:2}}>{ic}</div>}<div style={{fontSize:11,color:"#8E8E93",marginBottom:2,fontWeight:500}}>{l}</div><div style={{fontSize:22,fontWeight:700,color:ac||"#1C1C1E",letterSpacing:"-0.02em"}}>{v}</div>{sub&&<div style={{fontSize:10,color:"#AEAEB2",marginTop:1}}>{sub}</div>}</div>

const Cd=({children,ac,s,onClick})=><div onClick={onClick} style={{...css.card,borderLeft:ac?"3px solid "+ac:undefined,cursor:onClick?"pointer":undefined,...(s||{})}}>{children}</div>

const Fl=({l,children,req})=><div style={{marginBottom:14}}><label style={{display:"block",fontSize:13,fontWeight:600,color:"#3A3A3C",marginBottom:5}}>{l}{req&&<span style={{color:"#FF3B30"}}> *</span>}</label>{children}</div>

const Bt=({children,v,dis,onClick,full,sm,ic})=>{const m={pri:{bg:"#007AFF",c:"#fff"},suc:{bg:"#34C759",c:"#fff"},dan:{bg:"#FF3B30",c:"#fff"},pur:{bg:"#AF52DE",c:"#fff"},amb:{bg:"#FF9500",c:"#fff"},gry:{bg:"#F2F2F7",c:"#3A3A3C"}};const st=m[v]||{bg:"#F2F2F7",c:"#3A3A3C"};return<button onClick={onClick} disabled={dis} style={{...css.btn,padding:sm?"8px 14px":"12px 20px",fontSize:sm?12:14,background:dis?"#F2F2F7":st.bg,color:dis?"#AEAEB2":st.c,width:full?"100%":"auto",opacity:dis?0.5:1}}>{ic&&<span>{ic}</span>}{children}</button>}

const Av=({n,c,sz})=>{const s=sz||36;return<div style={{width:s,height:s,borderRadius:s/2,background:c?(c+"20"):"#F2F2F7",display:"flex",alignItems:"center",justifyContent:"center",fontSize:s*0.36,fontWeight:700,color:c||"#8E8E93",flexShrink:0,letterSpacing:"-0.02em"}}>{n}</div>}

const Stp=({steps,cur})=><div style={{display:"flex",alignItems:"flex-start",margin:"0 0 14px",overflowX:"auto",paddingBottom:4,gap:0}}>{steps.map((s,i)=>{const d=i<cur,a=i===cur;return<div key={i} style={{display:"flex",alignItems:"center",flex:"0 0 auto"}}><div style={{display:"flex",flexDirection:"column",alignItems:"center",minWidth:steps.length>10?44:54}}><div style={{width:22,height:22,borderRadius:11,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,background:d?"#34C759":a?"#007AFF":"#F2F2F7",color:(d||a)?"#fff":"#C7C7CC",transition:"all 0.3s"}}>{d?"✓":i+1}</div><div style={{fontSize:7,marginTop:2,color:a?"#007AFF":d?"#34C759":"#C7C7CC",fontWeight:a?700:500,textAlign:"center",maxWidth:48,lineHeight:1.2}}>{s.n}</div></div>{i<steps.length-1&&<div style={{width:12,height:2,borderRadius:1,background:d?"#34C759":"#E5E5EA",margin:"0 0 16px",flexShrink:0}}/>}</div>})}</div>

const Sheet=({show,onClose,title,children})=>{if(!show)return null;return<div style={css.modal} onClick={onClose}><div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"8px 20px 32px",width:"100%",maxWidth:680,maxHeight:"92vh",overflow:"auto",animation:"slideUp 0.3s ease"}}><div style={{width:36,height:4,borderRadius:2,background:"#E5E5EA",margin:"0 auto 12px"}}/><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><div style={{fontSize:18,fontWeight:700,letterSpacing:"-0.02em"}}>{title}</div><button onClick={onClose} style={{width:30,height:30,borderRadius:15,background:"#F2F2F7",border:"none",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#8E8E93"}}>✕</button></div>{children}</div></div>}

/* ═══ LOGIN SCREEN — Email + Password only ═══ */
function LoginScreen({onLogin,users}){
  const[email,setEmail]=useState("")
  const[pass,setPass]=useState("")
  const[err,setErr]=useState("")
  const[loading,setLoading]=useState(false)

  const authLogin=async()=>{
    setLoading(true);setErr("")
    // First try Supabase Auth
    const{data,error}=await signIn(email,pass)
    if(error){
      // Fallback: match by email in usuarios table (for users without Supabase Auth)
      const u=users.find(x=>x.correo===email)
      if(u){onLogin(u);return}
      setErr(error.message);setLoading(false);return
    }
    const u=users.find(x=>x.correo===email)
    if(u){onLogin(u)}else{setErr("Usuario no registrado en el sistema. Contacta al administrador.");setLoading(false)}
  }

  return<div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f3460 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{width:"100%",maxWidth:420}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{width:60,height:60,borderRadius:16,background:"rgba(255,255,255,0.1)",backdropFilter:"blur(10px)",display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:16,border:"1px solid rgba(255,255,255,0.08)"}}><span style={{fontSize:30}}>🏢</span></div>
        <div style={{fontSize:36,fontWeight:800,color:"#fff",letterSpacing:"-0.04em"}}>Outlet de Puertas</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,0.6)",marginTop:4}}>Sistema de Compras y Abastecimiento</div>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",marginTop:4}}>SOP P07 v2.0 · Módulo ERP</div>
      </div>
      <div style={{background:"#fff",borderRadius:20,padding:32,boxShadow:"0 25px 60px rgba(0,0,0,0.3)"}}>
        <div style={{fontSize:18,fontWeight:700,color:"#1C1C1E",marginBottom:4}}>Iniciar sesión</div>
        <div style={{fontSize:13,color:"#8E8E93",marginBottom:20}}>Ingresa con tu correo corporativo</div>
        <Fl l="Correo electrónico"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="usuario@outletdepuertas.cl" style={{...css.input,padding:"12px 16px",fontSize:15}} autoFocus/></Fl>
        <Fl l="Contraseña"><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" style={{...css.input,padding:"12px 16px",fontSize:15}} onKeyDown={e=>e.key==="Enter"&&authLogin()}/></Fl>
        {err&&<div style={{color:"#FF3B30",fontSize:13,marginBottom:12,padding:"10px 14px",background:"#FF3B3008",borderRadius:10,border:"1px solid #FF3B3020"}}>{err}</div>}
        <Bt v="pri" full dis={!email||!pass||loading} onClick={authLogin}>{loading?"Verificando...":"Ingresar"}</Bt>
      </div>
    </div>
  </div>
}

/* ═══ MAIN APP ═══ */
const TABS=[{k:"monitor",l:"Monitor",ic:"📊"},{k:"repo",l:"Reposición",ic:"📦"},{k:"forecast",l:"Forecast",ic:"📈"},{k:"costeo",l:"Costeo IMP",ic:"🧮"},{k:"transito",l:"Tránsito",ic:"🚚"},{k:"nueva",l:"Nueva OC",ic:"➕"},{k:"ordenes",l:"Órdenes",ic:"📋"},{k:"config",l:"Config",ic:"⚙️"}]

export default function App(){
  const[session,setSession]=useState(null)
  const[cu,setCu]=useState(null)
  const[users,setUsers]=useState([])
  const[provs,setProvs]=useState([])
  const[prods,setProds]=useState([])
  const[ocs,setOcs]=useState([])
  const[firmas,setFirmas]=useState([])
  const[pagos,setPagos]=useState([])
  const[params,setParams]=useState([])
  const[paramsABCD,setParamsABCD]=useState([])
  const[config,setConfig]=useState({})
  const[stockTransito,setStockTransito]=useState([])
  const[cart,setCart]=useState({})
  const[tab,setTab]=useState("monitor")
  const[det,setDet]=useState(null)
  const[loading,setLoading]=useState(true)
  const[configTab,setConfigTab]=useState("params")

  useEffect(()=>{loadAll()},[])

  const loadAll=async()=>{
    try{
      const[ru,rp,rprod,roc,rf,rpag,rpt,rpa,rcfg]=await Promise.all([
        supabase.from('usuarios').select('*').eq('activo',true).order('nombre'),
        supabase.from('proveedores').select('*').order('nombre'),
        supabase.from('productos').select('*').order('costo_reposicion',{ascending:false}),
        supabase.from('ordenes_compra').select('*').order('created_at',{ascending:false}),
        supabase.from('firmas').select('*').order('created_at'),
        supabase.from('pagos').select('*'),
        supabase.from('parametros_tipo').select('*'),
        supabase.from('parametros_abcd').select('*'),
        supabase.from('config_sistema').select('*'),
      ])
      if(ru.error)throw ru.error
      setUsers(ru.data||[]);setProvs(rp.data||[]);setProds(rprod.data||[])
      setOcs(roc.data||[]);setFirmas(rf.data||[]);setPagos(rpag.data||[])
      setParams(rpt.data||[]);setParamsABCD(rpa.data||[])
      const cfgMap={};(rcfg.data||[]).forEach(c=>cfgMap[c.clave]=c.valor);setConfig(cfgMap)
      // Stock en tránsito
      try{const st=await supabase.from('stock_transito').select('*');setStockTransito(st.data||[])}catch(e){}
      setLoading(false)
    }catch(e){console.error(e);setLoading(false)}
  }

  const addFirma=async(ocId,accion)=>{
    if(!cu)return;const f={id:uid(),oc_id:ocId,usuario_id:cu.id,nombre_usuario:cu.nombre,rol_usuario:rl(cu).l,accion,firma_digital:cu.firma_digital,fecha:hoy(),hora:hora()}
    await supabase.from('firmas').insert(f);setFirmas(p=>[...p,f])
  }
  const updOC=async(id,up)=>{await supabase.from('ordenes_compra').update(up).eq('id',id);setOcs(p=>p.map(o=>o.id===id?{...o,...up}:o))}
  const saveConfig=async(k,v)=>{await supabase.from('config_sistema').upsert({clave:k,valor:v},{onConflict:'clave'});setConfig(p=>({...p,[k]:v}))}
  const h=p=>cu?hp(cu,p):false

  // Merge stock en tránsito into products
  const prodsWithTransit=useMemo(()=>{
    return prods.map(p=>{
      const tr=stockTransito.find(s=>s.sku===p.sku)
      return{...p,stock_transito:tr?.cantidad_transito||0,ocs_transito:tr?.ordenes||""}
    })
  },[prods,stockTransito])

  const pend=ocs.filter(o=>o.estado?.startsWith("Pend.")).length

  if(loading)return<div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#F2F2F7"}}><div style={{textAlign:"center"}}><div style={{fontSize:32,marginBottom:8}}>📦</div><div style={{fontSize:18,fontWeight:700,color:"#1C1C1E"}}>Outlet de Puertas</div><div style={{fontSize:13,color:"#8E8E93",marginTop:4}}>Conectando...</div></div></div>

  if(!cu)return<LoginScreen onLogin={setCu} users={users}/>

  const rd=rl(cu)

  return<div style={{fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",margin:0,padding:"0 20px 100px",background:"#F2F2F7",minHeight:"100vh",fontSize:14}}>
    <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}*{box-sizing:border-box;margin:0;padding:0}body{background:#F2F2F7;overflow-x:hidden}input:focus,select:focus,textarea:focus{border-color:#007AFF!important;box-shadow:0 0 0 3px rgba(0,122,255,0.1)}::selection{background:#007AFF;color:#fff}::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:#F2F2F7;border-radius:5px}::-webkit-scrollbar-thumb{background:#C7C7CC;border-radius:5px;border:2px solid #F2F2F7}::-webkit-scrollbar-thumb:hover{background:#8E8E93}table{font-size:13px}th,td{white-space:nowrap}`}</style>

    {/* HEADER */}
    <div style={{position:"sticky",top:0,zIndex:50,background:"rgba(242,242,247,0.9)",backdropFilter:"blur(20px)",padding:"14px 0 10px",marginBottom:10,borderBottom:"1px solid rgba(0,0,0,0.06)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:26,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.03em"}}>Outlet de Puertas</div><div style={{display:"flex",alignItems:"center",gap:8,marginTop:2}}><div style={{fontSize:13,color:rd.c,fontWeight:600}}>{rd.l} — {cu.nombre}</div>{config.ultima_sincronizacion&&<span style={{fontSize:10,color:"#AEAEB2"}}>· Sync: {new Date(config.ultima_sincronizacion).toLocaleDateString("es-CL")}</span>}</div></div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:8,background:"#fff",border:"1px solid #E5E5EA"}}><Av n={cu?.avatar} c={rd.c} sz={24}/><span style={{fontSize:12,fontWeight:600}}>{cu?.nombre}</span></div>
          <button onClick={()=>setCu(null)} style={{width:32,height:32,borderRadius:10,background:"#FF3B3015",border:"none",cursor:"pointer",fontSize:13,color:"#FF3B30"}}>⏻</button>
        </div>
      </div>
    </div>

    {/* CONTENT */}
    {tab==="monitor"&&<MonitorView ocs={ocs} prods={prodsWithTransit} h={h}/>}
    {tab==="repo"&&<RepoView prods={prodsWithTransit} cart={cart} setCart={setCart} go={()=>setTab("nueva")} config={config} params={params} paramsABCD={paramsABCD}/>}
    {tab==="costeo"&&<CosteoImpView config={config} saveConfig={saveConfig} ocs={ocs}/>}
    {tab==="forecast"&&<ForecastView prods={prodsWithTransit} ocs={ocs} config={config} saveConfig={saveConfig}/>}
    {tab==="transito"&&<TransitoView ocs={ocs} provs={provs}/>}
    {tab==="nueva"&&<SolView cart={cart} setCart={setCart} provs={provs} users={users} cu={cu} setOcs={setOcs} addFirma={addFirma} goOC={()=>setTab("ordenes")} ocs={ocs}/>}
    {tab==="ordenes"&&<OCListView ocs={ocs} firmas={firmas} pagos={pagos} updOC={updOC} addFirma={addFirma} setDet={setDet} cu={cu} h={h} provs={provs} setOcs={setOcs}/>}
    {tab==="config"&&<ConfigView config={config} saveConfig={saveConfig} params={params} setParams={setParams} paramsABCD={paramsABCD} setParamsABCD={setParamsABCD} provs={provs} setProvs={setProvs} users={users} setUsers={setUsers} h={h} configTab={configTab} setConfigTab={setConfigTab} loadAll={loadAll} cu={cu}/>}

    <Sheet show={!!det} onClose={()=>setDet(null)} title={det?.id||""}>{det&&<OCDetView oc={det} firmas={firmas.filter(f=>f.oc_id===det.id)} pagos={pagos.filter(p=>p.oc_id===det.id)} updOC={updOC} addFirma={addFirma} setPagos={setPagos} close={()=>{setDet(null);loadAll()}} cu={cu} h={h}/>}</Sheet>

    {/* BOTTOM TAB BAR */}
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(255,255,255,0.95)",backdropFilter:"blur(20px)",borderTop:"1px solid rgba(0,0,0,0.08)",display:"flex",justifyContent:"center",padding:"8px 0 env(safe-area-inset-bottom,8px)",zIndex:50}}>
      <div style={{display:"flex",gap:0,maxWidth:700,width:"100%"}}>
        {TABS.filter(t=>{if(t.k==="config")return h("config")||cu.rol==="admin";if(t.k==="nueva")return h("crear_oc");return true}).map(t=><button key={t.k} onClick={()=>setTab(t.k)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"6px 4px",background:"none",border:"none",cursor:"pointer"}}>
          <span style={{fontSize:22,opacity:tab===t.k?1:0.4}}>{t.ic}</span>
          <span style={{fontSize:11,fontWeight:600,color:tab===t.k?"#007AFF":"#8E8E93"}}>{t.l}{t.k==="ordenes"&&pend>0?` (${pend})`:""}</span>
        </button>)}
      </div>
    </div>
  </div>
}

/* ═══ MONITOR — Dashboard BI ═══ */
function MonitorView({ocs,prods,h}){
  const pN=ocs.filter(o=>o.estado==="Pend. Dir. Negocios"),pF=ocs.filter(o=>o.estado==="Pend. Dir. Finanzas")
  const trans=ocs.filter(o=>["Despacho nac.","Naviera","Aduana","Transporte","Internación"].includes(o.estado))
  
  // ═══ ANALYTICS ═══
  const totalSKU=prods.length
  const conVenta=prods.filter(p=>(p.venta_total||0)>0)
  const sinVenta=prods.filter(p=>!p.venta_total||p.venta_total===0)
  const enRepo=prods.filter(p=>p.estado==="Reposición")
  const stockSuf=prods.filter(p=>p.estado==="Stock suficiente")
  const revisar=prods.filter(p=>p.estado==="Revisar"||p.estado==="Sin ventas")
  
  // Stock value analysis
  const stockTotalVal=prods.reduce((s,p)=>s+(p.costo_stock||((p.stock_actual||0)*(p.costo_unitario||0))),0)
  const stockSinRotVal=sinVenta.reduce((s,p)=>s+(p.costo_stock||((p.stock_actual||0)*(p.costo_unitario||0))),0)
  const stockSinRotUds=sinVenta.reduce((s,p)=>s+(p.stock_actual||0),0)
  const pctCapitalInmov=stockTotalVal>0?Math.round(stockSinRotVal/stockTotalVal*100):0
  
  // Investment needed
  const invReposicion=enRepo.reduce((s,p)=>s+(p.costo_reposicion||0),0)
  const invClaseA=prods.filter(p=>p.clasif_abcd==="A"&&p.estado==="Reposición").reduce((s,p)=>s+(p.costo_reposicion||0),0)
  
  // Coverage analysis
  const cobPromedio=conVenta.length>0?Math.round(conVenta.reduce((s,p)=>s+Math.min(p.dias_cobertura||0,365),0)/conVenta.length):0
  const criticos=prods.filter(p=>(p.dias_cobertura||999)<15&&["A","B"].includes(p.clasif_abcd))
  const tasaQuiebre=totalSKU>0?Math.round(enRepo.length/totalSKU*100):0
  
  // ABCD distribution
  const abcdData=["A","B","C","D"].map(c=>{const items=prods.filter(p=>p.clasif_abcd===c);return{c,n:items.length,pct:totalSKU>0?Math.round(items.length/totalSKU*100):0,venta:items.reduce((s,p)=>s+(p.venta_total||0),0),stock:items.reduce((s,p)=>s+(p.stock_actual||0),0),stockVal:items.reduce((s,p)=>s+((p.stock_actual||0)*(p.costo_unitario||0)),0),repos:items.filter(p=>p.estado==="Reposición").length,inv:items.filter(p=>p.estado==="Reposición").reduce((s,p)=>s+(p.costo_reposicion||0),0)}})
  const totalVenta=abcdData.reduce((s,d)=>s+d.venta,0)
  
  // By tipo analysis
  const tipoData=[...new Set(prods.map(p=>p.tipo_producto).filter(Boolean))].map(t=>{const items=prods.filter(p=>p.tipo_producto===t);const repos=items.filter(p=>p.estado==="Reposición");return{tipo:t,total:items.length,repos:repos.length,cobProm:items.filter(p=>(p.venta_total||0)>0).length>0?Math.round(items.filter(p=>(p.venta_total||0)>0).reduce((s,p)=>s+Math.min(p.dias_cobertura||0,365),0)/items.filter(p=>(p.venta_total||0)>0).length):999,inv:repos.reduce((s,p)=>s+(p.costo_reposicion||0),0),venta:items.reduce((s,p)=>s+(p.venta_total||0),0)}}).sort((a,b)=>b.inv-a.inv)
  
  // Dead stock — products with stock but no sales (capital inmovilizado)
  const deadStock=sinVenta.filter(p=>(p.stock_actual||0)>0).map(p=>({...p,valorStock:(p.stock_actual||0)*(p.costo_unitario||0)})).sort((a,b)=>b.valorStock-a.valorStock)
  
  // Bar chart helper (pure CSS)
  const Bar=({pct,color,h})=><div style={{width:"100%",background:"#F2F2F7",borderRadius:4,height:h||8,overflow:"hidden"}}><div style={{width:Math.max(pct,1)+"%",height:"100%",background:color,borderRadius:4,transition:"width 0.5s ease"}}/></div>

  return<div>
    {/* ═══ ROW 1: KPIs ═══ */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10,marginBottom:16}}>
      <div style={{background:"#fff",borderRadius:12,padding:"16px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:"4px solid #FF3B30"}}><div style={{fontSize:11,color:"#8E8E93",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>Tasa de quiebre</div><div style={{fontSize:28,fontWeight:800,color:"#FF3B30"}}>{tasaQuiebre}%</div><div style={{fontSize:11,color:"#8E8E93"}}>{enRepo.length} de {totalSKU} SKUs</div></div>
      <div style={{background:"#fff",borderRadius:12,padding:"16px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:"4px solid #FF9500"}}><div style={{fontSize:11,color:"#8E8E93",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>Inversión reposición</div><div style={{fontSize:22,fontWeight:800,color:"#FF9500"}}>{fmt(invReposicion)}</div><div style={{fontSize:11,color:"#8E8E93"}}>Clase A: {fmt(invClaseA)}</div></div>
      <div style={{background:"#fff",borderRadius:12,padding:"16px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:"4px solid #007AFF"}}><div style={{fontSize:11,color:"#8E8E93",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>Cobertura promedio</div><div style={{fontSize:28,fontWeight:800,color:"#007AFF"}}>{cobPromedio}d</div><div style={{fontSize:11,color:"#8E8E93"}}>{criticos.length} SKUs críticos (&lt;15d)</div></div>
      <div style={{background:"#fff",borderRadius:12,padding:"16px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:"4px solid #AF52DE"}}><div style={{fontSize:11,color:"#8E8E93",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>Capital inmovilizado</div><div style={{fontSize:22,fontWeight:800,color:"#AF52DE"}}>{fmt(stockSinRotVal)}</div><div style={{fontSize:11,color:"#FF3B30",fontWeight:600}}>{pctCapitalInmov}% del inventario total</div></div>
      <div style={{background:"#fff",borderRadius:12,padding:"16px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:"4px solid #34C759"}}><div style={{fontSize:11,color:"#8E8E93",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>Valor inventario</div><div style={{fontSize:22,fontWeight:800,color:"#34C759"}}>{fmt(stockTotalVal)}</div><div style={{fontSize:11,color:"#8E8E93"}}>{fN(prods.reduce((s,p)=>s+(p.stock_actual||0),0))} unidades</div></div>
      <div style={{background:"#fff",borderRadius:12,padding:"16px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:"4px solid #007AFF"}}><div style={{fontSize:11,color:"#8E8E93",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>OC en proceso</div><div style={{fontSize:28,fontWeight:800,color:"#007AFF"}}>{ocs.filter(o=>!["Cerrada","Rechazada"].includes(o.estado)).length}</div><div style={{fontSize:11,color:"#8E8E93"}}>Tránsito: {trans.length} · Pend: {pN.length+pF.length}</div></div>
    </div>

    {/* ═══ ROW 2: ABCD + Estado distribution ═══ */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
      {/* ABCD Chart */}
      <div style={{background:"#fff",borderRadius:12,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",marginBottom:12}}>Clasificación ABCD — Participación en ventas</div>
        {abcdData.map(d=>{const pctVenta=totalVenta>0?Math.round(d.venta/totalVenta*100):0;return<div key={d.c} style={{marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{display:"inline-block",width:24,height:24,borderRadius:6,background:CL[d.c]?.bg,color:CL[d.c]?.c,fontSize:12,fontWeight:800,textAlign:"center",lineHeight:"24px"}}>{d.c}</span><span style={{fontSize:13,fontWeight:600}}>{d.n} SKUs</span></div>
            <div style={{display:"flex",gap:12,fontSize:12,color:"#8E8E93"}}><span>Venta: <strong style={{color:"#1C1C1E"}}>{pctVenta}%</strong></span><span>Repos: <strong style={{color:"#FF3B30"}}>{d.repos}</strong></span><span>Inv: <strong style={{color:"#FF9500"}}>{fmt(d.inv)}</strong></span></div>
          </div>
          <Bar pct={pctVenta} color={CL[d.c]?.c} h={10}/>
        </div>})}
      </div>

      {/* Estado distribution */}
      <div style={{background:"#fff",borderRadius:12,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",marginBottom:12}}>Estado del inventario</div>
        {[["Reposición",enRepo.length,"#FF3B30"],["Stock suficiente",stockSuf.length,"#34C759"],["Sin ventas",sinVenta.length,"#8E8E93"],["Revisar",revisar.length,"#FF9500"]].map(([label,n,c])=>{const pct=totalSKU>0?Math.round(n/totalSKU*100):0;return<div key={label} style={{marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:13,fontWeight:600,color:c}}>{label}</span><span style={{fontSize:13,fontWeight:700}}>{n} <span style={{color:"#8E8E93",fontWeight:400}}>({pct}%)</span></span></div>
          <Bar pct={pct} color={c} h={10}/>
        </div>})}
        <div style={{marginTop:12,padding:10,background:"#F2F2F7",borderRadius:8}}>
          <div style={{fontSize:12,fontWeight:600,color:"#1C1C1E"}}>Resumen ejecutivo</div>
          <div style={{fontSize:11,color:"#636366",marginTop:4,lineHeight:1.6}}>{enRepo.length>0?`Se requiere reposición de ${enRepo.length} SKUs con una inversión de ${fmt(invReposicion)}. `:"Todos los productos están abastecidos. "}{sinVenta.length>0?`Hay ${sinVenta.length} productos sin rotación que representan ${fmt(stockSinRotVal)} en capital inmovilizado (${pctCapitalInmov}% del inventario).`:"No hay productos sin rotación."}{criticos.length>0?` ⚠ ${criticos.length} productos clase A/B tienen cobertura menor a 15 días — requieren acción inmediata.`:""}</div>
        </div>
      </div>
    </div>

    {/* ═══ ROW 3: Dead stock + Top urgent ═══ */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
      {/* DEAD STOCK — Capital inmovilizado */}
      <div style={{background:"#fff",borderRadius:12,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div><div style={{fontSize:15,fontWeight:700,color:"#AF52DE"}}>🧊 Capital inmovilizado</div><div style={{fontSize:11,color:"#8E8E93"}}>Productos con stock pero sin ventas en 4 meses</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:20,fontWeight:800,color:"#AF52DE"}}>{fmt(stockSinRotVal)}</div><div style={{fontSize:11,color:"#8E8E93"}}>{deadStock.length} SKUs · {fN(stockSinRotUds)} uds</div></div>
        </div>
        {deadStock.length===0?<div style={{textAlign:"center",padding:20,color:"#8E8E93"}}>Sin productos inmovilizados ✓</div>:
        <div style={{maxHeight:280,overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{background:"#F2F2F7"}}><th style={{padding:"6px 8px",textAlign:"left",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Producto</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Stock</th><th style={{padding:"6px 8px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Valor</th></tr></thead>
            <tbody>{deadStock.slice(0,15).map((p,i)=><tr key={i} style={{borderBottom:"1px solid #F2F2F7"}}>
              <td style={{padding:"5px 8px"}}><div style={{fontWeight:500,fontSize:12}}>{p.producto}</div><div style={{fontSize:10,color:"#AEAEB2"}}>{p.tipo_producto}</div></td>
              <td style={{padding:"5px 6px",textAlign:"right",fontWeight:600}}>{fN(p.stock_actual)}</td>
              <td style={{padding:"5px 8px",textAlign:"right",fontWeight:600,color:"#AF52DE"}}>{fmt(p.valorStock)}</td>
            </tr>)}</tbody>
          </table>
          {deadStock.length>15&&<div style={{fontSize:11,color:"#8E8E93",textAlign:"center",padding:6}}>...y {deadStock.length-15} más</div>}
        </div>}
      </div>

      {/* TOP URGENTES */}
      <div style={{background:"#fff",borderRadius:12,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:15,fontWeight:700,color:"#FF3B30",marginBottom:10}}>🔥 Top 10 — Reposición urgente</div>
        <div style={{maxHeight:300,overflowY:"auto"}}>
          {enRepo.sort((a,b)=>(a.dias_cobertura||999)-(b.dias_cobertura||999)).slice(0,10).map((p,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:"1px solid #F2F2F7"}}>
            <div style={{width:24,height:24,borderRadius:12,background:i<3?"#FF3B3015":"#F2F2F7",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:i<3?"#FF3B30":"#8E8E93",flexShrink:0}}>{i+1}</div>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.producto}</div><div style={{fontSize:10,color:"#8E8E93"}}>{p.tipo_producto} · <span style={{color:CL[p.clasif_abcd]?.c,fontWeight:600}}>{p.clasif_abcd}</span></div></div>
            <div style={{textAlign:"right",flexShrink:0}}><div style={{fontSize:13,fontWeight:700,color:"#FF3B30"}}>{p.dias_cobertura&&p.dias_cobertura<999?Math.round(p.dias_cobertura)+"d":"0d"}</div><div style={{fontSize:10,color:"#8E8E93"}}>{fN(p.reposicion_necesaria)} uds</div></div>
          </div>)}
        </div>
      </div>
    </div>

    {/* ═══ ROW 4: Coverage by tipo + Autorizaciones ═══ */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
      {/* Cobertura por tipo */}
      <div style={{background:"#fff",borderRadius:12,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",marginBottom:10}}>📊 Cobertura promedio por tipo de producto</div>
        <div style={{maxHeight:280,overflowY:"auto"}}>
          {tipoData.filter(t=>t.venta>0).slice(0,12).map((t,i)=>{const cobColor=t.cobProm<15?"#FF3B30":t.cobProm<30?"#FF9500":t.cobProm<60?"#007AFF":"#34C759";return<div key={i} style={{marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
              <span style={{fontSize:12,fontWeight:500,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.tipo}</span>
              <div style={{display:"flex",gap:10,fontSize:11}}><span style={{color:cobColor,fontWeight:700}}>{t.cobProm}d</span><span style={{color:"#8E8E93"}}>{t.repos}/{t.total} repos</span></div>
            </div>
            <Bar pct={Math.min(t.cobProm,90)/90*100} color={cobColor} h={6}/>
          </div>})}
        </div>
      </div>

      {/* Autorizaciones pendientes */}
      <div style={{background:"#fff",borderRadius:12,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",marginBottom:10}}>⏳ Autorizaciones pendientes</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <div style={{background:pN.length?"#007AFF08":"#34C75908",borderRadius:10,padding:12,textAlign:"center"}}><div style={{fontSize:24,fontWeight:800,color:pN.length?"#007AFF":"#34C759"}}>{pN.length}</div><div style={{fontSize:11,color:"#8E8E93"}}>Dir. Negocios</div></div>
          <div style={{background:pF.length?"#AF52DE08":"#34C75908",borderRadius:10,padding:12,textAlign:"center"}}><div style={{fontSize:24,fontWeight:800,color:pF.length?"#AF52DE":"#34C759"}}>{pF.length}</div><div style={{fontSize:11,color:"#8E8E93"}}>Dir. Finanzas</div></div>
        </div>
        {[...pN,...pF].slice(0,6).map(oc=><div key={oc.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #F2F2F7",fontSize:12}}>
          <div><strong style={{fontFamily:"monospace"}}>{oc.id}</strong> <Bd c={STS[oc.estado]?.c} bg={STS[oc.estado]?.bg}>{oc.estado?.replace("Pend. ","")}</Bd></div>
          <strong>{fmt(oc.total_clp)}</strong>
        </div>)}
        {pN.length+pF.length===0&&<div style={{textAlign:"center",padding:16,color:"#34C759",fontSize:13,fontWeight:600}}>✓ Sin pendientes</div>}

        {/* OC recientes */}
        {ocs.length>0&&<div style={{marginTop:12}}><div style={{fontSize:13,fontWeight:700,color:"#1C1C1E",marginBottom:6}}>Últimas órdenes</div>
          {ocs.slice(0,4).map(oc=><div key={oc.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #F2F2F7",fontSize:12}}>
            <div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontFamily:"monospace",fontWeight:600}}>{oc.id}</span><Bd c={STS[oc.estado]?.c} bg={STS[oc.estado]?.bg}>{STS[oc.estado]?.ic}</Bd></div>
            <strong>{fmt(oc.total_clp)}</strong>
          </div>)}
        </div>}
      </div>
    </div>
  </div>
}

/* ═══ REPOSICIÓN ═══ */
function RepoView({prods,cart,setCart,go,config,params,paramsABCD}){
  const[q,setQ]=useState("");const[fc,setFc]=useState("T");const[ft,setFt]=useState("T");const[sortBy,setSortBy]=useState("costo_reposicion");const[fe,setFe]=useState("T");const[sortDir,setSortDir]=useState("desc")
  const tipos=[...new Set(prods.map(p=>p.tipo_producto).filter(Boolean))].sort()
  const estados=["Reposición","Stock suficiente","Sin ventas","Revisar"]
  const toggleSort=(col)=>{if(sortBy===col){setSortDir(d=>d==="desc"?"asc":"desc")}else{setSortBy(col);setSortDir(col==="dias_cobertura"?"asc":"desc")}}
  const fil=prods.filter(i=>(fc==="T"||i.clasif_abcd===fc)&&(ft==="T"||i.tipo_producto===ft)&&(fe==="T"||i.estado===fe)&&(!q||i.producto?.toLowerCase().includes(q.toLowerCase())||i.sku?.toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>{const av=a[sortBy]||0,bv=b[sortBy]||0;if(sortBy==="producto"||sortBy==="tipo_producto")return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));return sortDir==="asc"?(av-bv):(bv-av)})
  const tog=it=>setCart(p=>{const n={...p};if(n[it.sku])delete n[it.sku];else n[it.sku]={...it,cp:it.reposicion_necesaria||0};return n})
  const setQty=(sku,v)=>setCart(p=>({...p,[sku]:{...p[sku],cp:Math.max(0,Number(v))}}))
  const cL=Object.keys(cart).length;const tC=Object.values(cart).reduce((s,i)=>s+((i.cp||0)*(i.costo_unitario||0)),0)
  const resumen={total:prods.length,repos:prods.filter(p=>p.estado==="Reposición").length,suf:prods.filter(p=>p.estado==="Stock suficiente").length,a:prods.filter(p=>p.clasif_abcd==="A").length,b:prods.filter(p=>p.clasif_abcd==="B").length,c:prods.filter(p=>p.clasif_abcd==="C").length,d:prods.filter(p=>p.clasif_abcd==="D").length}
  const mNames=[config.mes_1_nombre||"Mes 1",config.mes_2_nombre||"Mes 2",config.mes_3_nombre||"Mes 3",config.mes_4_nombre||"Mes 4"]

  const exportCSV=()=>{
    const h=["Tipo","Producto","SKU","Clasif.","Estado",mNames[0],mNames[1],mNames[2],mNames[3],"Venta Total","Max Mensual","Umbral Quiebre","Meses Quiebre","Vta Prom Raw","Vta Prom Compensada","Factor Comp.","Vta Prom Diaria","Stock Actual","Stock Tránsito","Días Cobertura","Días Fabricación","Días Emergencia","Punto Reorden","Período Cubrir","Reposición Necesaria","Costo Unitario","Costo Reposición"]
    const rows=fil.map(i=>[i.tipo_producto,`"${i.producto}"`,i.sku,i.clasif_abcd,i.estado,i.venta_mes_1||0,i.venta_mes_2||0,i.venta_mes_3||0,i.venta_mes_4||0,i.venta_total||0,i.max_mensual||0,i.umbral_quiebre||0,i.meses_quiebre||0,Math.round(i.vta_prom_raw||0),Math.round(i.vta_prom_compensada||0),i.factor_compensacion||1,Math.round((i.vta_prom_diaria||0)*100)/100,i.stock_actual||0,i.stock_transito||0,Math.round(i.dias_cobertura||0),i.dias_fabricacion||0,i.dias_emergencia||0,Math.round(i.punto_reorden||0),i.periodo_cubrir||0,i.reposicion_necesaria||0,i.costo_unitario||0,i.costo_reposicion||0])
    const csv="\uFEFF"+[h,...rows].map(r=>r.join(";")).join("\n")
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`reposicion_completa_${hoy()}.csv`;a.click()
  }

  const estColors={"Reposición":{c:"#FF3B30",bg:"#FF3B3012"},"Stock suficiente":{c:"#34C759",bg:"#34C75912"},"Sin ventas":{c:"#8E8E93",bg:"#8E8E9312"},"Revisar":{c:"#FF9500",bg:"#FF950012"}}

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
      <div><div style={{fontSize:26,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Análisis de reposición</div><div style={{fontSize:14,color:"#8E8E93"}}>{resumen.total} SKUs · {resumen.repos} requieren reposición · Umbral: {config.umbral_quiebre_pct||30}%</div></div>
      <div style={{display:"flex",gap:6}}>{cL>0&&<Bt v="pri" onClick={go} ic="➕">Crear OC ({cL})</Bt>}<Bt v="gry" onClick={exportCSV} sm ic="📥">Exportar CSV</Bt></div>
    </div>

    {/* Summary cards */}
    <div style={{display:"flex",gap:6,marginBottom:10,overflowX:"auto"}}>
      {[["Reposición",resumen.repos,"#FF3B30"],["Stock OK",resumen.suf,"#34C759"],["A",resumen.a,"#FF3B30"],["B",resumen.b,"#007AFF"],["C",resumen.c,"#34C759"],["D",resumen.d,"#8E8E93"]].map(([l,n,c])=><div key={l} style={{background:"#fff",borderRadius:10,padding:"8px 14px",boxShadow:"0 1px 2px rgba(0,0,0,0.04)",textAlign:"center",minWidth:70}}><div style={{fontSize:18,fontWeight:700,color:c}}>{n}</div><div style={{fontSize:10,color:"#8E8E93"}}>{l}</div></div>)}
    </div>

    {/* Filters */}
    <div style={{display:"flex",gap:4,marginBottom:6,overflowX:"auto"}}>{[["T","Todos",resumen.total],["A","A",resumen.a],["B","B",resumen.b],["C","C",resumen.c],["D","D",resumen.d]].map(([k,l,n])=><button key={k} onClick={()=>setFc(k)} style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",background:fc===k?(k==="T"?"#007AFF":CL[k]?.bg||"#007AFF"):"#F2F2F7",color:fc===k?(k==="T"?"#fff":CL[k]?.c||"#fff"):"#8E8E93"}}>{l} ({n})</button>)}</div>

    {cL>0&&<Cd ac="#007AFF" s={{marginBottom:8,background:"#007AFF08"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:13,fontWeight:600,color:"#007AFF"}}>{cL} SKUs seleccionados · {fmt(tC)}</span><div style={{display:"flex",gap:4}}><Bt sm v="pri" onClick={go} ic="➕">Crear OC</Bt><Bt sm v="gry" onClick={()=>setCart({})}>Vaciar</Bt></div></div></Cd>}

    <div style={{display:"flex",gap:6,marginBottom:8}}>
      <input placeholder="Buscar producto o SKU..." value={q} onChange={e=>setQ(e.target.value)} style={{...css.input,flex:1,fontSize:13}}/>
      <select value={ft} onChange={e=>setFt(e.target.value)} style={{...css.select,width:140,fontSize:12}}><option value="T">Todos los tipos</option>{tipos.map(t=><option key={t} value={t}>{t}</option>)}</select>
      <select value={fe} onChange={e=>setFe(e.target.value)} style={{...css.select,width:130,fontSize:12}}><option value="T">Todos estados</option>{estados.map(e=><option key={e} value={e}>{e}</option>)}</select>
      <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...css.select,width:130,fontSize:12}}><option value="costo_reposicion">Mayor inversión</option><option value="dias_cobertura">Menor cobertura</option><option value="reposicion_necesaria">Mayor cantidad</option><option value="venta_total">Mayor venta</option></select>
    </div>

    {/* EXPANDED TABLE with sticky header + clickable sort */}
    <div style={{overflowY:"auto",maxHeight:"calc(100vh - 280px)",borderRadius:10,border:"1px solid #D1D1D6"}}>
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,tableLayout:"auto"}}>
      <thead style={{position:"sticky",top:0,zIndex:5}}><tr style={{background:"#E5E5EA"}}>
        {[["",""],["Producto","producto"],["Tipo","tipo_producto"],["Clasif.","clasif_abcd"],["Estado","estado"],["Ene","venta_mes_1"],["Feb","venta_mes_2"],["Mar","venta_mes_3"],["Abr","venta_mes_4"],["Vta Total","venta_total"],["Quieb.","meses_quiebre"],["Vta Comp.","vta_prom_compensada"],["Vta/Día","vta_prom_diaria"],["Stock","stock_actual"],["Tráns.","stock_transito"],["Cob.","dias_cobertura"],["Pto Re.","punto_reorden"],["Reponer","reposicion_necesaria"],["Costo U.","costo_unitario"],["Inversión","costo_reposicion"]].map(([label,col],i)=>
          <th key={i} onClick={col?()=>toggleSort(col):undefined} style={{padding:"9px 5px",textAlign:i<3?"left":"right",fontSize:10,fontWeight:700,color:sortBy===col?"#007AFF":"#636366",borderBottom:sortBy===col?"2px solid #007AFF":"2px solid #C7C7CC",textTransform:"uppercase",letterSpacing:"0.03em",whiteSpace:"nowrap",background:sortBy===col?"#D6E4F0":"#E5E5EA",cursor:col?"pointer":"default",userSelect:"none",transition:"all 0.15s"}}>{label}{sortBy===col&&<span style={{marginLeft:3,fontSize:8}}>{sortDir==="desc"?"▼":"▲"}</span>}</th>
        )}
      </tr></thead>
      <tbody>{fil.map((it,idx)=>{const inC=!!cart[it.sku];const crit=(it.dias_cobertura||999)<15&&["A","B"].includes(it.clasif_abcd);const isR=it.estado==="Reposición";const ec=estColors[it.estado]||estColors["Revisar"]
        return<tr key={it.sku} onClick={()=>tog(it)} style={{background:inC?"#007AFF06":idx%2?"#fafafa":"#fff",cursor:"pointer",borderBottom:"1px solid #E5E5EA",transition:"background 0.1s"}} onMouseOver={e=>{if(!inC)e.currentTarget.style.background="#F2F2F7"}} onMouseOut={e=>{if(!inC)e.currentTarget.style.background=idx%2?"#fafafa":"#fff"}}>
          <td style={{padding:"7px 4px",width:28}}><input type="checkbox" checked={inC} onChange={()=>{}} style={{width:16,height:16}}/></td>
          <td style={{padding:"7px 4px",maxWidth:200}}><div style={{fontSize:13,fontWeight:600,color:"#1C1C1E",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.producto}</div><div style={{fontSize:10,color:"#AEAEB2"}}>{it.sku}</div></td>
          <td style={{padding:"7px 4px",fontSize:11,color:"#636366",whiteSpace:"nowrap",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis"}}>{it.tipo_producto}</td>
          <td style={{padding:"7px 4px",textAlign:"center"}}><span style={{display:"inline-block",padding:"2px 6px",borderRadius:4,fontSize:11,fontWeight:700,color:CL[it.clasif_abcd]?.c,background:CL[it.clasif_abcd]?.bg}}>{it.clasif_abcd}</span></td>
          <td style={{padding:"7px 4px",textAlign:"right"}}><span style={{display:"inline-block",padding:"2px 5px",borderRadius:4,fontSize:10,fontWeight:600,color:ec.c,background:ec.bg,whiteSpace:"nowrap"}}>{it.estado}</span></td>
          <td style={{padding:"7px 4px",textAlign:"right",color:it.venta_mes_1?"#1C1C1E":"#D1D1D6"}}>{fN(it.venta_mes_1||0)}</td>
          <td style={{padding:"7px 4px",textAlign:"right",color:it.venta_mes_2?"#1C1C1E":"#D1D1D6"}}>{fN(it.venta_mes_2||0)}</td>
          <td style={{padding:"7px 4px",textAlign:"right",color:it.venta_mes_3?"#1C1C1E":"#D1D1D6"}}>{fN(it.venta_mes_3||0)}</td>
          <td style={{padding:"7px 4px",textAlign:"right",color:it.venta_mes_4?"#1C1C1E":"#D1D1D6"}}>{fN(it.venta_mes_4||0)}</td>
          <td style={{padding:"7px 4px",textAlign:"right",fontWeight:600,color:it.venta_total?"#1C1C1E":"#D1D1D6"}}>{fN(it.venta_total||0)}</td>
          <td style={{padding:"7px 4px",textAlign:"right"}}>{it.meses_quiebre>0?<span style={{color:"#FF9500",fontWeight:700}}>{it.meses_quiebre}</span>:<span style={{color:"#D1D1D6"}}>0</span>}</td>
          <td style={{padding:"7px 4px",textAlign:"right",fontWeight:600,color:it.vta_prom_compensada?"#007AFF":"#D1D1D6"}}>{fN(it.vta_prom_compensada||0)}</td>
          <td style={{padding:"7px 4px",textAlign:"right",color:"#636366"}}>{it.vta_prom_diaria?Math.round(it.vta_prom_diaria*10)/10:"—"}</td>
          <td style={{padding:"7px 4px",textAlign:"right",fontWeight:600,color:it.stock_actual<=0?"#FF3B30":"#1C1C1E"}}>{fN(it.stock_actual)}</td>
          <td style={{padding:"7px 4px",textAlign:"right",color:it.stock_transito?"#007AFF":"#D1D1D6"}}>{it.stock_transito?fN(it.stock_transito):"—"}</td>
          <td style={{padding:"7px 4px",textAlign:"right"}}><span style={{fontWeight:700,color:crit?"#FF3B30":(it.dias_cobertura||0)<30?"#FF9500":"#34C759"}}>{it.dias_cobertura&&it.dias_cobertura<999?Math.round(it.dias_cobertura)+"d":"—"}</span></td>
          <td style={{padding:"7px 4px",textAlign:"right",color:"#636366"}}>{it.punto_reorden?fN(it.punto_reorden):"—"}</td>
          <td style={{padding:"7px 4px",textAlign:"right"}}>{inC?<input type="number" value={cart[it.sku]?.cp||0} onChange={e=>{e.stopPropagation();setQty(it.sku,e.target.value)}} onClick={e=>e.stopPropagation()} style={{width:65,textAlign:"center",fontSize:13,fontWeight:700,padding:"3px",border:"2px solid #007AFF",borderRadius:6,color:"#007AFF"}}/>:<strong style={{color:isR?"#FF3B30":"#1C1C1E"}}>{it.reposicion_necesaria?fN(it.reposicion_necesaria):"—"}</strong>}</td>
          <td style={{padding:"7px 4px",textAlign:"right",color:"#636366",fontSize:12}}>{it.costo_unitario?fmt(it.costo_unitario):"—"}</td>
          <td style={{padding:"7px 4px",textAlign:"right",fontWeight:600,fontSize:12}}>{it.costo_reposicion?fmt(it.costo_reposicion):"—"}</td>
        </tr>})}</tbody>
    </table></div>
    <div style={{padding:"8px 12px",background:"#F2F2F7",borderRadius:"0 0 10px 10px",fontSize:11,color:"#8E8E93",display:"flex",justifyContent:"space-between"}}><span>{fil.length} de {resumen.total} productos</span><span>Inversión reposición: <strong style={{color:"#1C1C1E"}}>{fmt(fil.filter(i=>i.estado==="Reposición").reduce((s,i)=>s+(i.costo_reposicion||0),0))}</strong></span></div>
  </div>
}

/* ═══ SOLICITUD — Formal corporate document ═══ */
function SolView({cart,setCart,provs,users,cu,setOcs,addFirma,goOC,ocs}){
  const[prov,setProv]=useState("");const[tipo,setTipo]=useState("Nacional");const[fEst,setFEst]=useState("");const[notas,setNotas]=useState("");const[done,setDone]=useState(null);const[saving,setSaving]=useState(false)
  // Manual items (added from scratch)
  const[manualItems,setManualItems]=useState([])
  const addManual=()=>setManualItems(p=>[...p,{id:uid(),producto:"",sku:"",tipo_producto:"",cantidad:0,costo_unitario:0}])
  const updManual=(id,k,v)=>setManualItems(p=>p.map(i=>i.id===id?{...i,[k]:v}:i))
  const delManual=(id)=>setManualItems(p=>p.filter(i=>i.id!==id))

  const sel=Object.values(cart)
  const allItems=[...sel.map(i=>({...i,source:"repo"})),...manualItems.map(i=>({...i,cp:i.cantidad,source:"manual"}))]
  const total=allItems.reduce((s,i)=>s+((i.cp||i.cantidad||0)*(i.costo_unitario||0)),0)
  const sp=provs.find(p=>p.id===prov)

  const nextNum=()=>{const prefix=tipo==="Importación"?"OC-IMP-":"OC-NAC-";const existing=(ocs||[]).filter(o=>o.id?.startsWith(prefix));const maxN=existing.reduce((m,o)=>{const n=parseInt(o.id.replace(prefix,""))||0;return n>m?n:m},0);return prefix+String(maxN+1).padStart(6,"0")}

  const submit=async()=>{setSaving(true);const isI=tipo==="Importación";const id=nextNum()
    const oc={id,fecha_creacion:hoy(),solicitante_id:cu.id,proveedor_id:prov,tipo_oc:tipo,estado:"Pend. Dir. Negocios",fase_actual:1,total_clp:total,total_usd:isI?Math.round(total/950):0,condicion_pago:sp?.condicion_pago||"Contado",pct_fab:sp?.pct_fabricacion||0,pct_embarque:sp?.pct_embarque||0,pct_puerto:sp?.pct_puerto||0,fecha_estimada:fEst||null,estado_pago:"Pago pend.",notas}
    const{error}=await supabase.from('ordenes_compra').insert(oc)
    if(!error){
      const items=allItems.map(i=>({id:uid(),oc_id:id,sku:i.sku||"MANUAL-"+Date.now(),producto:i.producto,cantidad_sugerida:i.reposicion_necesaria||0,cantidad_pedida:i.cp||i.cantidad||0,costo_unitario:i.costo_unitario||0}))
      await supabase.from('oc_items').insert(items);await addFirma(id,"Solicitud creada");setOcs(p=>[oc,...p]);setCart({});setManualItems([]);setDone(oc)
    };setSaving(false)}

  if(done)return<div style={{textAlign:"center",padding:"60px 20px"}}><div style={{width:64,height:64,borderRadius:32,background:"#34C75920",margin:"0 auto 16px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>✓</div><div style={{fontSize:24,fontWeight:800,fontFamily:"monospace"}}>{done.id}</div><div style={{fontSize:14,color:"#8E8E93",marginBottom:20}}>Solicitud enviada a Dir. Negocios</div><Bt v="pri" onClick={()=>{setDone(null);goOC()}} ic="📋">Ver órdenes</Bt></div>

  return<div style={{maxWidth:960,margin:"0 auto"}}>
    <div style={{background:"#fff",borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
      <div style={{background:"linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)",color:"#fff",padding:"24px 32px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.5)",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>Outlet de Puertas SpA</div><div style={{fontSize:22,fontWeight:800}}>SOLICITUD DE ORDEN DE COMPRA</div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"rgba(255,255,255,0.4)",textTransform:"uppercase"}}>Fecha</div><div style={{fontSize:18,fontWeight:700}}>{hoy()}</div></div>
      </div>
      <div style={{padding:"24px 32px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
          <div>
            <Fl l="Solicitante"><div style={{display:"flex",alignItems:"center",gap:10}}><Av n={cu?.avatar} c={rl(cu).c} sz={36}/><div><div style={{fontSize:14,fontWeight:600}}>{cu?.nombre}</div><div style={{fontSize:12,color:rl(cu).c}}>{rl(cu).l}</div></div></div></Fl>
            <Fl l="Proveedor" req><select value={prov} onChange={e=>{setProv(e.target.value);const s=provs.find(p=>p.id===e.target.value);if(s)setTipo(s.tipo)}} style={css.select}><option value="">Seleccionar...</option>{provs.filter(p=>p.activo).map(p=><option key={p.id} value={p.id}>{p.nombre} ({p.tipo})</option>)}</select></Fl>
          </div>
          <div>
            <Fl l="Fecha estimada" req><input type="date" value={fEst} onChange={e=>setFEst(e.target.value)} style={css.input}/></Fl>
            <Fl l="Observaciones"><textarea value={notas} onChange={e=>setNotas(e.target.value)} rows={2} style={{...css.input,resize:"vertical"}}/></Fl>
          </div>
        </div>

        {/* Products from Reposición */}
        {sel.length>0&&<><div style={{fontSize:12,fontWeight:700,color:"#007AFF",textTransform:"uppercase",marginBottom:6}}>Productos desde reposición ({sel.length})</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:16}}>
          <thead><tr style={{background:"#F8F8FA"}}><th style={{padding:"8px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA"}}>Producto</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"2px solid #E5E5EA"}}>Cantidad</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"2px solid #E5E5EA"}}>Costo U.</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"2px solid #E5E5EA"}}>Subtotal</th></tr></thead>
          <tbody>{sel.map((i,idx)=><tr key={idx} style={{borderBottom:"1px solid #F2F2F7"}}><td style={{padding:"8px"}}><div style={{fontWeight:600}}>{i.producto}</div><div style={{fontSize:10,color:"#AEAEB2"}}>{i.sku}</div></td><td style={{padding:"8px",textAlign:"right",color:"#007AFF",fontWeight:700}}>{fN(i.cp)}</td><td style={{padding:"8px",textAlign:"right"}}>{fmt(i.costo_unitario)}</td><td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{fmt(i.cp*(i.costo_unitario||0))}</td></tr>)}</tbody>
        </table></>}

        {/* Manual products */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:12,fontWeight:700,color:"#AF52DE",textTransform:"uppercase"}}>Productos manuales ({manualItems.length})</div>
          <button onClick={addManual} style={{padding:"6px 14px",borderRadius:8,fontSize:12,fontWeight:600,background:"#AF52DE",color:"#fff",border:"none",cursor:"pointer"}}>+ Agregar producto</button>
        </div>
        {manualItems.length>0&&<table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:12}}>
          <thead><tr style={{background:"#AF52DE08"}}><th style={{padding:"6px",textAlign:"left",fontSize:10,fontWeight:700,color:"#AF52DE",borderBottom:"1px solid #AF52DE30"}}>Producto</th><th style={{padding:"6px",fontSize:10,fontWeight:700,color:"#AF52DE",borderBottom:"1px solid #AF52DE30"}}>SKU</th><th style={{padding:"6px",fontSize:10,fontWeight:700,color:"#AF52DE",borderBottom:"1px solid #AF52DE30"}}>Tipo</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"1px solid #AF52DE30"}}>Cant.</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"1px solid #AF52DE30"}}>Costo U.</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"1px solid #AF52DE30"}}>Subtotal</th><th style={{width:30,borderBottom:"1px solid #AF52DE30"}}></th></tr></thead>
          <tbody>{manualItems.map(i=><tr key={i.id} style={{borderBottom:"1px solid #F2F2F7"}}>
            <td style={{padding:"4px"}}><input value={i.producto} onChange={e=>updManual(i.id,"producto",e.target.value)} placeholder="Nombre..." style={{...css.input,padding:"6px 8px",fontSize:12}}/></td>
            <td style={{padding:"4px"}}><input value={i.sku} onChange={e=>updManual(i.id,"sku",e.target.value)} placeholder="SKU..." style={{...css.input,padding:"6px 8px",fontSize:12,width:100}}/></td>
            <td style={{padding:"4px"}}><input value={i.tipo_producto} onChange={e=>updManual(i.id,"tipo_producto",e.target.value)} placeholder="Tipo..." style={{...css.input,padding:"6px 8px",fontSize:12,width:100}}/></td>
            <td style={{padding:"4px"}}><input type="number" value={i.cantidad} onChange={e=>updManual(i.id,"cantidad",Number(e.target.value))} style={{...css.input,padding:"6px 8px",fontSize:12,width:70,textAlign:"right"}}/></td>
            <td style={{padding:"4px"}}><input type="number" value={i.costo_unitario} onChange={e=>updManual(i.id,"costo_unitario",Number(e.target.value))} style={{...css.input,padding:"6px 8px",fontSize:12,width:80,textAlign:"right"}}/></td>
            <td style={{padding:"4px",textAlign:"right",fontWeight:600}}>{fmt(i.cantidad*i.costo_unitario)}</td>
            <td style={{padding:"4px"}}><button onClick={()=>delManual(i.id)} style={{background:"#FF3B3012",color:"#FF3B30",border:"none",borderRadius:4,padding:"4px 6px",cursor:"pointer",fontSize:10}}>✕</button></td>
          </tr>)}</tbody>
        </table>}
        {manualItems.length===0&&sel.length===0&&<div style={{textAlign:"center",padding:20,color:"#8E8E93",fontSize:13}}>Agrega productos desde Reposición o manualmente con el botón "Agregar producto"</div>}

        <div style={{borderTop:"2px solid #1C1C1E",paddingTop:12,marginTop:8,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:16,fontWeight:700}}>TOTAL ORDEN</span><span style={{fontSize:24,fontWeight:800}}>{fmt(total)}</span></div>
      </div>
      <div style={{borderTop:"1px solid #E5E5EA",padding:"16px 32px",background:"#FAFAFA"}}><div style={{display:"flex",alignItems:"center",gap:12}}><Av n={cu?.avatar} c={rl(cu).c} sz={40}/><div><div style={{fontSize:16,fontStyle:"italic",fontWeight:700,color:rl(cu).c}}>{cu?.firma_digital||cu?.nombre}</div><div style={{fontSize:11,color:"#AEAEB2"}}>{rl(cu).l} — {hoy()} {hora()}</div></div></div></div>
    </div>
    <div style={{marginTop:14}}><Bt v="pri" full dis={!prov||!fEst||saving||(sel.length===0&&manualItems.length===0)} onClick={submit} ic="✍️">{saving?"Procesando...":"Firmar y enviar solicitud"}</Bt></div>
  </div>
}

/* ═══ OC LIST — With admin edit/delete + notification log ═══ */
function OCListView({ocs,firmas,pagos,updOC,addFirma,setDet,cu,h,provs,setOcs}){
  const[f,setF]=useState("Todas");const[deleting,setDeleting]=useState(null);const[notifLog,setNotifLog]=useState([])
  const[commentOC,setCommentOC]=useState("");const[showComment,setShowComment]=useState(null)
  const estados=["Todas","Pend. Dir. Negocios","Pend. Dir. Finanzas","Pend. proveedor","En fabricación","Naviera","Recibida OK","Cerrada"]
  const fil=f==="Todas"?ocs:ocs.filter(o=>o.estado===f)
  const firma=async(oc,acc,nE,nF)=>{
    const comment=commentOC.trim()
    const accionFull=comment?`${acc} — "${comment}"`:acc
    await addFirma(oc.id,accionFull);await updOC(oc.id,{estado:nE,fase_actual:nF??oc.fase_actual})
    const notif={id:uid(),oc_id:oc.id,accion:accionFull,nuevo_estado:nE,usuario:cu.nombre,rol:rl(cu).l,fecha:hoy(),hora:hora(),tipo:"estado_oc"}
    await supabase.from('notificaciones').insert(notif).catch(()=>{})
    setNotifLog(p=>[notif,...p]);setCommentOC("");setShowComment(null)
  }
  const isAdmin=cu?.rol==="admin"||cu?.rol==="dir_general"
  const deleteOC=async(oc)=>{
    if(!confirm(`¿Eliminar la OC ${oc.id}? Esta acción no se puede deshacer.`))return
    setDeleting(oc.id)
    await supabase.from('oc_items').delete().eq('oc_id',oc.id)
    await supabase.from('firmas').delete().eq('oc_id',oc.id)
    await supabase.from('pagos').delete().eq('oc_id',oc.id)
    await supabase.from('recepcion').delete().eq('oc_id',oc.id)
    await supabase.from('ordenes_compra').delete().eq('id',oc.id)
    setOcs(p=>p.filter(o=>o.id!==oc.id))
    setDeleting(null)
  }

  // Load notification log
  useEffect(()=>{supabase.from('notificaciones').select('*').order('created_at',{ascending:false}).limit(50).then(r=>setNotifLog(r.data||[]))},[])

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div style={{fontSize:22,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Órdenes</div>
      {isAdmin&&<Bd c="#FF3B30" bg="#FF3B3012" lg>🔑 Admin</Bd>}
    </div>
    <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto",paddingBottom:4}}>{estados.map(e=>{const cnt=e==="Todas"?ocs.length:ocs.filter(o=>o.estado===e).length;return<button key={e} onClick={()=>setF(e)} style={{padding:"8px 14px",borderRadius:20,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",whiteSpace:"nowrap",background:f===e?"#007AFF":"#F2F2F7",color:f===e?"#fff":"#8E8E93",transition:"all 0.2s"}}>{e==="Todas"?"Todas":e.replace("Pend. ","")} ({cnt})</button>})}</div>
    {fil.map(oc=>{const ocF=firmas.filter(fi=>fi.oc_id===oc.id);const isI=oc.tipo_oc==="Importación";const pv=provs?.find(p=>p.id===oc.proveedor_id)
      return<Cd key={oc.id} s={{marginBottom:8}} onClick={()=>setDet(oc)}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:8}}>
          <div><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}><span style={{fontSize:15,fontWeight:700}}>{oc.id}</span><Bd c={isI?"#FF3B30":"#007AFF"} bg={isI?"#FF3B3015":"#007AFF15"}>{isI?"IMP":"NAC"}</Bd></div><Bd c={STS[oc.estado]?.c} bg={STS[oc.estado]?.bg} lg>{STS[oc.estado]?.ic} {oc.estado}</Bd><div style={{fontSize:11,color:"#8E8E93",marginTop:4}}>{pv?.nombre||oc.proveedor_id} · {oc.fecha_creacion} · {oc.condicion_pago}</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800}}>{fmt(oc.total_clp)}</div>{oc.total_usd>0&&<div style={{fontSize:11,color:"#8E8E93"}}>{fU(oc.total_usd)}</div>}
            {isAdmin&&<div style={{display:"flex",gap:4,marginTop:4,justifyContent:"flex-end"}} onClick={e=>e.stopPropagation()}>
              <button onClick={()=>setDet(oc)} style={{padding:"4px 8px",borderRadius:6,fontSize:10,fontWeight:600,border:"1px solid #007AFF",background:"#007AFF12",color:"#007AFF",cursor:"pointer"}}>✏️ Editar</button>
              <button onClick={()=>deleteOC(oc)} disabled={deleting===oc.id} style={{padding:"4px 8px",borderRadius:6,fontSize:10,fontWeight:600,border:"1px solid #FF3B30",background:"#FF3B3012",color:"#FF3B30",cursor:"pointer",opacity:deleting===oc.id?0.5:1}}>{deleting===oc.id?"...":"🗑 Eliminar"}</button>
            </div>}
          </div>
        </div>
        <Stp steps={isI?FI:FN} cur={oc.fase_actual}/>
        <div style={{fontSize:11,color:"#AEAEB2",marginBottom:8}}>{ocF.map((fi,i)=><span key={i}>{i>0?" → ":""}<strong style={{color:"#8E8E93"}}>{fi.nombre_usuario}</strong> ({fi.accion})</span>)}</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}} onClick={e=>e.stopPropagation()}>
          {oc.estado==="Pend. Dir. Negocios"&&h("aprobar_neg")&&<><Bt sm v="pri" onClick={()=>showComment===oc.id+"a"?firma(oc,"Aprobada Dir. Negocios","Pend. Dir. Finanzas",2):setShowComment(oc.id+"a")} ic="✓">{showComment===oc.id+"a"?"Confirmar":"Aprobar"}</Bt><Bt sm v="dan" onClick={()=>showComment===oc.id+"r"?firma(oc,"Rechazada","Rechazada"):setShowComment(oc.id+"r")} ic="✕">{showComment===oc.id+"r"?"Confirmar rechazo":"Rechazar"}</Bt></>}
          {oc.estado==="Pend. Dir. Finanzas"&&h("aprobar_fin")&&<><Bt sm v="pur" onClick={()=>showComment===oc.id+"a"?firma(oc,"Aprobada Finanzas","Pend. proveedor",3):setShowComment(oc.id+"a")} ic="✓">{showComment===oc.id+"a"?"Confirmar":"Presupuesto OK"}</Bt><Bt sm v="dan" onClick={()=>showComment===oc.id+"r"?firma(oc,"Rechazada","Rechazada"):setShowComment(oc.id+"r")} ic="✕">{showComment===oc.id+"r"?"Confirmar":"Rechazar"}</Bt></>}
          {oc.estado==="Pend. proveedor"&&h("valid_prov")&&<Bt sm v="suc" onClick={()=>showComment===oc.id+"a"?firma(oc,isI?"Proforma confirmada":"Proveedor confirmó",isI?"Proforma OK":"Confirmada prov.",4):setShowComment(oc.id+"a")} ic="◉">{showComment===oc.id+"a"?"Confirmar":"Confirmado"}</Bt>}
          {oc.estado==="Confirmada prov."&&<Bt sm v="pri" onClick={()=>firma(oc,"En despacho","Despacho nac.",5)} ic="🚚">Despacho</Bt>}
          {oc.estado==="Despacho nac."&&h("recibir")&&<Bt sm v="amb" onClick={()=>setDet(oc)} ic="📦">Recepción</Bt>}
          {(oc.estado==="Recibida OK"||oc.estado==="Recibida parcial")&&h("cerrar_oc")&&<Bt sm v="gry" onClick={()=>firma(oc,"Cerrada","Cerrada",isI?14:7)} ic="■">Cerrar</Bt>}
        </div>
        {/* Comment input for approvals */}
        {showComment&&showComment.startsWith(oc.id)&&<div style={{marginTop:6,display:"flex",gap:6,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
          <input value={commentOC} onChange={e=>setCommentOC(e.target.value)} placeholder="Comentario de aprobación (opcional)..." style={{...css.input,flex:1,padding:"8px 12px",fontSize:12}} autoFocus onKeyDown={e=>{if(e.key==="Escape"){setShowComment(null);setCommentOC("")}}}/>
          <button onClick={()=>{setShowComment(null);setCommentOC("")}} style={{padding:"6px 10px",borderRadius:6,fontSize:11,fontWeight:600,background:"#F2F2F7",color:"#8E8E93",border:"none",cursor:"pointer"}}>Cancelar</button>
        </div>}
      </Cd>
    })}
    {fil.length===0&&<div style={{textAlign:"center",padding:40}}><div style={{fontSize:32,marginBottom:8}}>📭</div><div style={{color:"#8E8E93"}}>Sin órdenes</div></div>}

    {/* NOTIFICATION LOG */}
    {notifLog.length>0&&<Cd s={{marginTop:16}}>
      <div style={{fontSize:15,fontWeight:700,marginBottom:8}}>📧 Registro de notificaciones</div>
      <div style={{fontSize:11,color:"#8E8E93",marginBottom:8}}>Historial de acciones en órdenes de compra con fecha y hora</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
        <thead><tr style={{background:"#F2F2F7"}}>{["Fecha","Hora","OC","Acción","Nuevo Estado","Usuario","Rol"].map((h,i)=><th key={i} style={{padding:"6px 8px",textAlign:"left",fontSize:9,fontWeight:700,color:"#8E8E93",borderBottom:"1px solid #E5E5EA",textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
        <tbody>{notifLog.slice(0,30).map((n,i)=><tr key={i} style={{borderBottom:"1px solid #F2F2F7"}}>
          <td style={{padding:"5px 8px",whiteSpace:"nowrap"}}>{n.fecha||new Date(n.created_at).toLocaleDateString("es-CL")}</td>
          <td style={{padding:"5px 8px",whiteSpace:"nowrap",color:"#8E8E93"}}>{n.hora||new Date(n.created_at).toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"})}</td>
          <td style={{padding:"5px 8px",fontWeight:600,fontFamily:"monospace"}}>{n.oc_id}</td>
          <td style={{padding:"5px 8px",fontWeight:500}}>{n.accion}</td>
          <td style={{padding:"5px 8px"}}><Bd c={STS[n.nuevo_estado]?.c||"#8E8E93"} bg={STS[n.nuevo_estado]?.bg||"#F2F2F7"}>{n.nuevo_estado||"—"}</Bd></td>
          <td style={{padding:"5px 8px"}}>{n.usuario}</td>
          <td style={{padding:"5px 8px",color:"#8E8E93"}}>{n.rol}</td>
        </tr>)}</tbody>
      </table>
    </Cd>}
  </div>
}

/* ═══ OC DETAIL — With parametric reception, provider validation, document attachments ═══ */
function OCDetView({oc,firmas,pagos,updOC,addFirma,setPagos,close,cu,h}){
  const[rf,setRf]=useState(hoy());const[rr,setRr]=useState(cu?.nombre||"Jefe Bodega");const[rd,setRd]=useState("");const isI=oc.tipo_oc==="Importación"
  const[items,setItems]=useState([]);const[recQty,setRecQty]=useState({});const[provQty,setProvQty]=useState({});const[provNotas,setProvNotas]=useState("")
  const[docs,setDocs]=useState([]);const[uploading,setUploading]=useState(false);const[pendingFiles,setPendingFiles]=useState([]);const[saveMsg,setSaveMsg]=useState("")
  useEffect(()=>{supabase.from('oc_items').select('*').eq('oc_id',oc.id).then(r=>{const d=r.data||[];setItems(d);const q={};const pq={};d.forEach(i=>{q[i.id]=i.cantidad_pedida||0;pq[i.id]=i.cantidad_confirmada||i.cantidad_pedida||0});setRecQty(q);setProvQty(pq)})},[oc.id])
  useEffect(()=>{supabase.from('documentos_import').select('*').eq('oc_id',oc.id).order('created_at',{ascending:false}).then(r=>{console.log("Loaded docs for OC:",oc.id,r.data?.length,"docs",r.error);setDocs(r.data||[])})},[oc.id])

  const firma=async(a,nE,nF)=>{await addFirma(oc.id,a);await updOC(oc.id,{estado:nE,fase_actual:nF??oc.fase_actual});close()}
  const regP=async(c,m,mon)=>{const p={id:uid(),oc_id:oc.id,concepto:c,monto:m,moneda:mon,fecha_pago:hoy(),estado:"Pagado",aprobado_por:cu.id};await supabase.from('pagos').insert(p);setPagos(prev=>[...prev,p])}

  // Stage a file locally (not saved yet)
  const stageFile=async(file,tipo,descripcion)=>{
    if(!file)return
    if(file.size>5*1024*1024){alert("Archivo muy grande. Máximo 5MB.");return}
    const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=()=>rej(new Error("Error"));r.readAsDataURL(file)})
    setPendingFiles(p=>[...p,{id:uid(),tipo,nombre_archivo:file.name,url_archivo:base64,descripcion,size:file.size}])
  }

  // Remove a staged file
  const unstageFile=(id)=>setPendingFiles(p=>p.filter(f=>f.id!==id))

  // SAVE ALL — persist all pending files to Supabase
  const saveAllDocs=async()=>{
    if(pendingFiles.length===0)return
    setUploading(true);setSaveMsg("")
    let saved=0;let errors=[]
    for(const f of pendingFiles){
      console.log(`Saving doc: ${f.nombre_archivo}, size: ${Math.round(f.url_archivo.length/1024)}KB base64`)
      // Store file reference without base64 to avoid size issues
      // Instead store base64 in localStorage as backup and just the metadata in DB
      const doc={id:f.id,oc_id:oc.id,tipo_documento:f.tipo,nombre_documento:f.descripcion||f.tipo,nombre_archivo:f.nombre_archivo,url_archivo:f.url_archivo,descripcion:f.descripcion||f.tipo,subido_por:cu.nombre,fecha_subida:hoy(),hora_subida:hora(),etapa:oc.estado||"",estado:"Adjunto",monto:0,moneda:"CLP",fecha_documento:hoy()}
      const{error,data}=await supabase.from('documentos_import').insert(doc).select()
      console.log("Insert result:",{error,data})
      if(error){
        console.error("Insert error:",error)
        errors.push(`${f.nombre_archivo}: ${error.message}`)
      }else{
        saved++
        setDocs(p=>[doc,...p])
      }
    }
    if(saved>0){
      await addFirma(oc.id,`📎 ${saved} documento(s) adjuntado(s) a la OC`)
      setPendingFiles([])
      setSaveMsg(`✅ ${saved} documento(s) guardado(s) en la OC`)
    }
    if(errors.length>0){setSaveMsg(p=>(p||"")+` ⚠ Errores: ${errors.join(", ")}`)}
    setUploading(false)
    setTimeout(()=>setSaveMsg(""),8000)
  }

  // Delete saved document
  const deleteDoc=async(docId)=>{
    if(!confirm("¿Eliminar este documento de la OC?"))return
    const{error}=await supabase.from('documentos_import').delete().eq('id',docId)
    if(!error)setDocs(p=>p.filter(d=>d.id!==docId))
    else alert("Error eliminando: "+error.message)
  }

  // File upload component — stages files, shows saved + pending
  const FileUpload=({tipo,label,desc})=>{
    const savedDocs=docs.filter(d=>d.tipo_documento===tipo)
    const pending=pendingFiles.filter(f=>f.tipo===tipo)
    return<div style={{background:"#F2F2F7",borderRadius:10,padding:12,marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:"#1C1C1E"}}>{label}</div><div style={{fontSize:11,color:"#8E8E93"}}>{desc}</div></div>
        <label style={{padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:600,background:"#007AFF",color:"#fff",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}>
          📎 Seleccionar
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f)stageFile(f,tipo,label);e.target.value=""}}/>
        </label>
      </div>
      {/* Pending (not yet saved) */}
      {pending.map(f=><div key={f.id} style={{display:"flex",alignItems:"center",gap:8,marginTop:8,padding:10,background:"#FFF9E6",borderRadius:8,border:"1px solid #FF950040"}}>
        <span style={{fontSize:16}}>⏳</span>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"#FF9500"}}>{f.nombre_archivo}</div><div style={{fontSize:10,color:"#FF9500"}}>Pendiente de guardar · {Math.round(f.size/1024)}KB</div></div>
        <button onClick={()=>unstageFile(f.id)} style={{padding:"4px 8px",borderRadius:6,fontSize:10,fontWeight:600,background:"#FF3B3012",color:"#FF3B30",border:"none",cursor:"pointer"}}>✕</button>
      </div>)}
      {/* Saved documents */}
      {savedDocs.map(d=><div key={d.id} style={{display:"flex",alignItems:"center",gap:8,marginTop:8,padding:10,background:"#fff",borderRadius:8,border:"1px solid #34C75950"}}>
        <span style={{fontSize:16}}>{d.nombre_archivo?.match(/\.pdf$/i)?"📄":"🖼"}</span>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"#1C1C1E",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.nombre_archivo}</div><div style={{fontSize:10,color:"#34C759"}}>✓ Guardado · {d.subido_por} — {d.fecha_subida} {d.hora_subida}</div></div>
        <div style={{display:"flex",gap:4,flexShrink:0}}>
          <button onClick={()=>{
            if(d.url_archivo&&d.url_archivo.startsWith("data:")){
              const w=window.open("","_blank");if(w){w.document.write(`<!DOCTYPE html><html><head><title>${d.nombre_archivo||"Documento"}</title></head><body style="margin:0"><iframe src="${d.url_archivo}" style="width:100%;height:100vh;border:none"></iframe></body></html>`);w.document.close()}
            }else if(d.url_archivo){window.open(d.url_archivo,"_blank")}
            else{alert("El archivo no se puede visualizar")}
          }} style={{padding:"6px 12px",borderRadius:6,fontSize:12,fontWeight:600,background:"#007AFF",color:"#fff",border:"none",cursor:"pointer"}}>👁 Ver</button>
          {(cu?.rol==="admin"||cu?.rol==="dir_general")&&<button onClick={()=>deleteDoc(d.id)} style={{padding:"6px 10px",borderRadius:6,fontSize:11,fontWeight:600,background:"#FF3B3012",color:"#FF3B30",border:"none",cursor:"pointer"}}>🗑</button>}
        </div>
      </div>)}
    </div>
  }

  // Calculate discrepancies automatically
  const totalPedido=items.reduce((s,i)=>s+(i.cantidad_pedida||0),0)
  const totalRecibido=Object.values(recQty).reduce((s,v)=>s+Number(v||0),0)
  const hasDisc=items.some(i=>Number(recQty[i.id]||0)!==(i.cantidad_pedida||0))
  const pctRecibido=totalPedido>0?Math.round(totalRecibido/totalPedido*100):0
  const autoEstado=pctRecibido>=100?"Conforme":pctRecibido>=50?"Parcial":"No conforme"

  const saveR=async()=>{
    // Build discrepancy detail automatically
    const discs=items.filter(i=>Number(recQty[i.id]||0)!==(i.cantidad_pedida||0)).map(i=>`${i.producto}: pedido ${i.cantidad_pedida}, recibido ${recQty[i.id]||0} (dif: ${Number(recQty[i.id]||0)-(i.cantidad_pedida||0)})`).join("; ")
    const discText=discs||(rd||"Sin discrepancias")
    await supabase.from('recepcion').insert({id:uid(),oc_id:oc.id,fecha_recepcion:rf,responsable_id:cu.id,nombre_responsable:rr,cantidad_esperada:String(totalPedido),cantidad_recibida:String(totalRecibido),porcentaje_recibido:pctRecibido+"%",estado_recepcion:autoEstado,discrepancias:discText+(rd?" | Obs: "+rd:""),firma_recepcion:cu.firma_digital})
    await addFirma(oc.id,`Recepción ${autoEstado}: ${pctRecibido}% (${totalRecibido}/${totalPedido})`)
    await updOC(oc.id,{estado:autoEstado==="Conforme"?"Recibida OK":"Recibida parcial",fase_actual:isI?13:6,fecha_real_recepcion:rf})
    close()
  }

  return<div>
    <Stp steps={isI?FI:FN} cur={oc.fase_actual}/>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
      {[["Proveedor",oc.proveedor_id],["Tipo",oc.tipo_oc],["Total",fmt(oc.total_clp)],["ETA",oc.fecha_estimada||"—"],["Creación",oc.fecha_creacion],["Pago",oc.condicion_pago]].map(([l,v],i)=><div key={i} style={{background:"#F2F2F7",borderRadius:10,padding:"8px 12px"}}><div style={{fontSize:10,color:"#AEAEB2",fontWeight:600}}>{l}</div><div style={{fontSize:13,fontWeight:600,color:"#1C1C1E"}}>{v}</div></div>)}
    </div>

    <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>Firmas ({firmas.length})</div>
    <div style={{paddingLeft:12,borderLeft:"2px solid #E5E5EA",marginBottom:16}}>
      {firmas.map((f,i)=><div key={i} style={{display:"flex",gap:8,padding:"6px 0"}}><div style={{width:10,height:10,borderRadius:5,background:"#34C759",marginTop:4,flexShrink:0,marginLeft:-7,border:"2px solid #fff"}}/><div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{f.accion}</div><div style={{fontSize:11,color:"#8E8E93"}}>{f.nombre_usuario} — <span style={{fontStyle:"italic"}}>{f.firma_digital}</span></div></div><div style={{fontSize:10,color:"#AEAEB2"}}>{f.fecha} {f.hora}</div></div>)}
    </div>

    {items.length>0&&<><div style={{fontSize:15,fontWeight:700,marginBottom:6}}>Productos ({items.length})</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:14}}>
        <thead><tr style={{background:"#F2F2F7"}}><th style={{padding:"6px 8px",textAlign:"left",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Producto</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Sugerido</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Pedido</th><th style={{padding:"6px 8px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Subtotal</th></tr></thead>
        <tbody>{items.map((i,idx)=><tr key={idx} style={{borderBottom:"1px solid #F2F2F7"}}><td style={{padding:"6px 8px"}}><div style={{fontWeight:600}}>{i.producto}</div><div style={{fontSize:10,color:"#AEAEB2"}}>{i.sku}</div></td><td style={{padding:"6px",textAlign:"right",color:"#8E8E93"}}>{fN(i.cantidad_sugerida)}</td><td style={{padding:"6px",textAlign:"right",color:"#007AFF",fontWeight:700}}>{fN(i.cantidad_pedida)}</td><td style={{padding:"6px 8px",textAlign:"right",fontWeight:600}}>{fmt((i.cantidad_pedida||0)*(i.costo_unitario||0))}</td></tr>)}</tbody>
      </table></>}

    {pagos.length>0&&<div style={{marginTop:16}}><div style={{fontSize:15,fontWeight:700,marginBottom:6}}>Pagos</div>
      {pagos.map((p,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #F2F2F7",fontSize:13}}><span>{p.concepto}</span><div style={{display:"flex",gap:6,alignItems:"center"}}><strong>{p.moneda==="USD"?fU(p.monto):fmt(p.monto)}</strong><Bd c={p.estado==="Pagado"?"#34C759":"#FF9500"} bg={p.estado==="Pagado"?"#34C75915":"#FF950015"}>{p.estado}</Bd></div></div>)}</div>}

    {/* COMPROBANTES DE PAGO */}
    {pagos.length>0&&<div style={{marginTop:12}}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>📎 Comprobantes de pago</div>
      <div style={{fontSize:12,color:"#8E8E93",marginBottom:8}}>Adjunta el comprobante de transferencia o depósito para cada pago registrado.</div>
      {pagos.map((p,i)=><FileUpload key={i} tipo={`comprobante_pago_${i+1}`} label={`Comprobante ${p.concepto}`} desc={`${p.moneda==="USD"?fU(p.monto):fmt(p.monto)} — ${p.fecha_pago}`}/>)}
    </div>}

    {/* DOCUMENTOS GENERALES DE LA OC */}
    <div style={{marginTop:12}}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>📁 Documentos de la OC</div>
      <FileUpload tipo="proforma" label="Proforma / Cotización" desc="Documento del proveedor con precios y condiciones"/>
      <FileUpload tipo="factura" label="Factura del proveedor" desc="Factura o boleta del proveedor"/>
      <FileUpload tipo="guia_despacho" label="Guía de despacho" desc="Guía de transporte o despacho"/>
      {isI&&<FileUpload tipo="bl_naviera" label="Bill of Lading / BL" desc="Documento de embarque marítimo"/>}
      {isI&&<FileUpload tipo="din_aduana" label="DIN / Declaración aduana" desc="Declaración de Internación"/>}
    </div>

    {/* SAVE ALL DOCUMENTS BUTTON */}
    {pendingFiles.length>0&&<div style={{background:"#FF950012",borderRadius:12,padding:16,marginTop:12,marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:14,fontWeight:700,color:"#FF9500"}}>{pendingFiles.length} documento(s) pendiente(s) de guardar</div><div style={{fontSize:12,color:"#8E8E93"}}>Haz clic en el botón para guardar los archivos en la orden de compra</div></div>
        <button onClick={saveAllDocs} disabled={uploading} style={{padding:"12px 24px",borderRadius:10,fontSize:14,fontWeight:700,background:uploading?"#8E8E93":"#34C759",color:"#fff",border:"none",cursor:uploading?"wait":"pointer",display:"flex",alignItems:"center",gap:6}}>{uploading?"⏳ Guardando...":"💾 Guardar en la OC"}</button>
      </div>
    </div>}
    {saveMsg&&<div style={{background:saveMsg.includes("✅")?"#34C75912":"#FF3B3012",borderRadius:8,padding:10,marginBottom:12,fontSize:13,fontWeight:600,color:saveMsg.includes("✅")?"#34C759":"#FF3B30"}}>{saveMsg}</div>}

    {/* PROVIDER QUANTITY VALIDATION */}
    {oc.estado==="Pend. proveedor"&&h("valid_prov")&&<div style={{borderTop:"2px solid #E5E5EA",paddingTop:16,marginTop:16}}>
      <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>🔄 Validación de cantidades por proveedor</div>
      <div style={{fontSize:12,color:"#8E8E93",marginBottom:12}}>Ajusta las cantidades según lo confirmado por el proveedor. Si hay quiebre de stock del proveedor o cantidades mínimas de venta, modifica la columna "Confirmado".</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:12}}>
        <thead><tr style={{background:"#F2F2F7"}}><th style={{padding:"6px 8px",textAlign:"left",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Producto</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93",width:80}}>Pedido</th><th style={{padding:"6px",textAlign:"center",fontSize:10,fontWeight:600,color:"#34C759",width:100}}>Confirmado</th><th style={{padding:"6px 8px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93",width:80}}>Diferencia</th></tr></thead>
        <tbody>{items.map((i,idx)=>{const conf=Number(provQty[i.id]||0);const ped=i.cantidad_pedida||0;const dif=conf-ped;return<tr key={idx} style={{borderBottom:"1px solid #F2F2F7",background:dif!==0?"#FF950008":"transparent"}}>
          <td style={{padding:"6px 8px"}}><div style={{fontWeight:600}}>{i.producto}</div><div style={{fontSize:10,color:"#AEAEB2"}}>{i.sku}</div></td>
          <td style={{padding:"6px",textAlign:"right",fontWeight:600}}>{fN(ped)}</td>
          <td style={{padding:"6px",textAlign:"center"}}><input type="number" value={provQty[i.id]||0} onChange={e=>setProvQty(p=>({...p,[i.id]:e.target.value}))} style={{width:80,textAlign:"center",padding:"4px",borderRadius:8,border:dif!==0?"2px solid #FF9500":"1px solid #E5E5EA",fontSize:13,fontWeight:600,color:dif!==0?"#FF9500":"#34C759"}}/></td>
          <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600,color:dif<0?"#FF3B30":dif>0?"#34C759":"#8E8E93"}}>{dif!==0?((dif>0?"+":"")+dif):"="}</td>
        </tr>})}</tbody>
      </table>
      {items.some(i=>Number(provQty[i.id]||0)!==(i.cantidad_pedida||0))&&<div style={{background:"#FF950012",borderRadius:10,padding:10,marginBottom:10,fontSize:12,color:"#FF9500",fontWeight:600}}>⚠ Cantidades ajustadas por el proveedor — se actualizará la OC</div>}
      <Fl l="Notas del proveedor"><input value={provNotas} onChange={e=>setProvNotas(e.target.value)} placeholder="Motivo del ajuste (quiebre stock, mínimo de compra, etc.)..." style={css.input}/></Fl>
      <Bt v="suc" full onClick={async()=>{
        // Update each item with confirmed quantity
        for(const i of items){
          const conf=Number(provQty[i.id]||i.cantidad_pedida)
          await supabase.from('oc_items').update({cantidad_confirmada:conf}).eq('id',i.id)
        }
        // Recalculate total
        const newTotal=items.reduce((s,i)=>s+(Number(provQty[i.id]||i.cantidad_pedida)*(i.costo_unitario||0)),0)
        const adj=items.filter(i=>Number(provQty[i.id]||0)!==(i.cantidad_pedida||0)).map(i=>`${i.producto}: ${i.cantidad_pedida}→${provQty[i.id]}`).join(", ")
        await addFirma(oc.id,`Proveedor confirmó${adj?" (ajustes: "+adj+")":""}${provNotas?" — "+provNotas:""}`)
        await updOC(oc.id,{estado:isI?"Proforma OK":"Confirmada prov.",fase_actual:4,total_clp:newTotal})
        close()
      }} ic="✓">Confirmar cantidades del proveedor</Bt>
    </div>}

    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:16}}>
      {isI&&oc.estado==="Proforma OK"&&h("reg_pago")&&<Bt v="amb" onClick={async()=>{await regP("Fab. "+oc.pct_fab+"%",Math.round((oc.total_usd||0)*oc.pct_fab/100),"USD");await firma("Pago fabricación","Pago fabricación",5)}} ic="💰">Pago fabricación</Bt>}
      {isI&&oc.estado==="Pago fabricación"&&<Bt v="pur" onClick={()=>firma("Fabricación","En fabricación",6)} ic="🏭">En fabricación</Bt>}
      {isI&&oc.estado==="En fabricación"&&h("reg_pago")&&oc.pct_embarque>0&&<Bt v="amb" onClick={async()=>{await regP("Emb. "+oc.pct_embarque+"%",Math.round((oc.total_usd||0)*oc.pct_embarque/100),"USD");await firma("Pago embarque","Pago embarque",7)}} ic="💰">Pago embarque</Bt>}
      {isI&&(oc.estado==="Pago embarque"||(oc.estado==="En fabricación"&&!oc.pct_embarque))&&<Bt v="pri" onClick={()=>firma("Embarcada","Naviera",8)} ic="🚢">Embarque</Bt>}
      {isI&&oc.estado==="Naviera"&&<Bt v="amb" onClick={()=>firma("Puerto","Aduana",9)} ic="🏛">Puerto</Bt>}
      {isI&&oc.estado==="Aduana"&&h("reg_pago")&&<Bt v="amb" onClick={async()=>{await regP("Puerto "+oc.pct_puerto+"%",Math.round((oc.total_usd||0)*oc.pct_puerto/100),"USD");await firma("Pago puerto","Pago puerto",10)}} ic="💰">Pago puerto</Bt>}
      {isI&&oc.estado==="Pago puerto"&&<Bt v="pur" onClick={()=>firma("Internación","Internación",11)} ic="📋">Internación</Bt>}
      {isI&&oc.estado==="Internación"&&<Bt v="pri" onClick={()=>firma("Transporte","Transporte",12)} ic="🚛">Transporte</Bt>}
    </div>

    {/* PARAMETRIC RECEPTION - per item quantities */}
    {((isI&&oc.estado==="Transporte")||(!isI&&oc.estado==="Despacho nac."))&&h("recibir")&&<div style={{borderTop:"2px solid #E5E5EA",paddingTop:16,marginTop:16}}>
      <div style={{fontSize:15,fontWeight:700,marginBottom:10}}>📦 Registrar recepción — Ingrese cantidad recibida por producto</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:12}}>
        <thead><tr style={{background:"#F2F2F7"}}><th style={{padding:"6px 8px",textAlign:"left",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Producto</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93",width:80}}>Pedido</th><th style={{padding:"6px",textAlign:"center",fontSize:10,fontWeight:600,color:"#8E8E93",width:90}}>Recibido</th><th style={{padding:"6px 8px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93",width:80}}>Diferencia</th></tr></thead>
        <tbody>{items.map((i,idx)=>{const rec=Number(recQty[i.id]||0);const ped=i.cantidad_pedida||0;const dif=rec-ped;return<tr key={idx} style={{borderBottom:"1px solid #F2F2F7",background:dif!==0?"#FFF3E015":"transparent"}}>
          <td style={{padding:"6px 8px"}}><div style={{fontWeight:600}}>{i.producto}</div></td>
          <td style={{padding:"6px",textAlign:"right",fontWeight:600}}>{fN(ped)}</td>
          <td style={{padding:"6px",textAlign:"center"}}><input type="number" value={recQty[i.id]||0} onChange={e=>setRecQty(p=>({...p,[i.id]:e.target.value}))} style={{width:70,textAlign:"center",padding:"4px",borderRadius:8,border:dif!==0?"2px solid #FF9500":"1px solid #E5E5EA",fontSize:13,fontWeight:600,color:dif!==0?"#FF9500":"#1C1C1E"}}/></td>
          <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600,color:dif<0?"#FF3B30":dif>0?"#34C759":"#8E8E93"}}>{dif>0?"+":""}{dif}</td>
        </tr>})}</tbody>
        <tfoot><tr style={{borderTop:"2px solid #1C1C1E"}}><td style={{padding:"8px",fontWeight:700}}>TOTAL</td><td style={{padding:"8px",textAlign:"right",fontWeight:700}}>{fN(totalPedido)}</td><td style={{padding:"8px",textAlign:"center",fontWeight:700,color:hasDisc?"#FF9500":"#34C759"}}>{fN(totalRecibido)}</td><td style={{padding:"8px",textAlign:"right",fontWeight:700,color:totalRecibido-totalPedido<0?"#FF3B30":"#34C759"}}>{totalRecibido-totalPedido>0?"+":""}{totalRecibido-totalPedido}</td></tr></tfoot>
      </table>

      {/* Auto-calculated status */}
      <div style={{background:autoEstado==="Conforme"?"#34C75915":autoEstado==="Parcial"?"#FF950015":"#FF3B3015",borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:700,color:autoEstado==="Conforme"?"#34C759":autoEstado==="Parcial"?"#FF9500":"#FF3B30"}}>Estado: {autoEstado} — {pctRecibido}% recibido</div>
        {hasDisc&&<div style={{fontSize:11,color:"#8E8E93",marginTop:4}}>Discrepancias detectadas: {items.filter(i=>Number(recQty[i.id]||0)!==(i.cantidad_pedida||0)).map(i=>`${i.producto} (${Number(recQty[i.id]||0)-i.cantidad_pedida>0?"+":""}${Number(recQty[i.id]||0)-i.cantidad_pedida})`).join(", ")}</div>}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <Fl l="Fecha recepción"><input type="date" value={rf} onChange={e=>setRf(e.target.value)} style={css.input}/></Fl>
        <Fl l="Responsable"><input value={rr} onChange={e=>setRr(e.target.value)} style={css.input}/></Fl>
      </div>
      <Fl l="Observaciones adicionales"><input value={rd} onChange={e=>setRd(e.target.value)} placeholder="Observaciones opcionales..." style={css.input}/></Fl>

      {/* RECEPTION DOCUMENTS */}
      <div style={{marginTop:12,marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>📎 Documentos de recepción</div>
        <FileUpload tipo="informe_recepcion" label="Informe de recepción" desc="Documento firmado con detalle de lo recibido, estado de productos y observaciones"/>
        <FileUpload tipo="ingreso_bsale" label="Comprobante ingreso BSALE" desc="Captura o PDF del movimiento de stock registrado en BSALE"/>
      </div>

      <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8,padding:12,background:"#F2F2F7",borderRadius:12}}><Av n={cu?.avatar} c={rl(cu).c} sz={36}/><div><div style={{fontSize:14,fontStyle:"italic",fontWeight:700,color:rl(cu).c}}>{cu?.firma_digital}</div><div style={{fontSize:11,color:"#AEAEB2"}}>{hoy()} {hora()}</div></div></div>
      <div style={{marginTop:12}}><Bt v="suc" full onClick={saveR} ic="✍️">Firmar recepción ({autoEstado})</Bt></div>
    </div>}
    {(oc.estado==="Recibida OK"||oc.estado==="Recibida parcial")&&h("cerrar_oc")&&<div style={{marginTop:16}}><Bt v="gry" full onClick={()=>firma("Cerrada","Cerrada",isI?14:7)} ic="■">Cerrar OC</Bt></div>}
  </div>
}

/* ═══ FORECAST — Purchase forecast + new store expansion + compliance ═══ */
function ForecastView({prods,ocs,config,saveConfig}){
  const[pctExpansion,setPctExpansion]=useState(Number(config.pct_expansion_nueva_suc)||30)
  const[nombreSuc,setNombreSuc]=useState(config.nombre_nueva_sucursal||"Nueva Sucursal")
  const[fechaApertura,setFechaApertura]=useState(config.fecha_apertura_suc||"")
  const[rampUp,setRampUp]=useState(Number(config.rampup_pct)||70)
  const[pctA,setPctA]=useState(Number(config.expansion_pct_a)||40)
  const[pctB,setPctB]=useState(Number(config.expansion_pct_b)||30)
  const[pctC,setPctC]=useState(Number(config.expansion_pct_c)||20)
  const[pctD,setPctD]=useState(Number(config.expansion_pct_d)||10)
  const[modoExpansion,setModoExpansion]=useState(config.modo_expansion||"global") // global or abcd

  const saveParams=async()=>{
    await saveConfig("pct_expansion_nueva_suc",String(pctExpansion));await saveConfig("nombre_nueva_sucursal",nombreSuc)
    await saveConfig("fecha_apertura_suc",fechaApertura);await saveConfig("rampup_pct",String(rampUp))
    await saveConfig("expansion_pct_a",String(pctA));await saveConfig("expansion_pct_b",String(pctB))
    await saveConfig("expansion_pct_c",String(pctC));await saveConfig("expansion_pct_d",String(pctD))
    await saveConfig("modo_expansion",modoExpansion);alert("Parámetros de forecast guardados")
  }

  // Calculate forecast per product
  const forecast=prods.map(p=>{
    const repoNormal=p.reposicion_necesaria||0
    const stockActual=p.stock_actual||0
    const pctExp=modoExpansion==="abcd"?({A:pctA,B:pctB,C:pctC,D:pctD}[p.clasif_abcd]||pctExpansion):pctExpansion
    const stockExpansionBase=Math.round(stockActual*pctExp/100)
    const stockExpansion=Math.round(stockExpansionBase*rampUp/100) // Apply ramp-up factor
    const compraTotal=repoNormal+stockExpansion
    const costoRepo=(repoNormal)*(p.costo_unitario||0)
    const costoExpansion=stockExpansion*(p.costo_unitario||0)
    const costoTotal=compraTotal*(p.costo_unitario||0)
    return{...p,repoNormal,stockExpansion,compraTotal,costoRepo,costoExpansion,costoTotal,pctExp}
  })

  // Aggregations
  const abcdForecast=["A","B","C","D"].map(c=>{const items=forecast.filter(p=>p.clasif_abcd===c);return{c,skus:items.length,repoNormal:items.reduce((s,p)=>s+p.repoNormal,0),expansion:items.reduce((s,p)=>s+p.stockExpansion,0),total:items.reduce((s,p)=>s+p.compraTotal,0),invRepo:items.reduce((s,p)=>s+p.costoRepo,0),invExp:items.reduce((s,p)=>s+p.costoExpansion,0),invTotal:items.reduce((s,p)=>s+p.costoTotal,0)}})
  const totals={repoNormal:forecast.reduce((s,p)=>s+p.repoNormal,0),expansion:forecast.reduce((s,p)=>s+p.stockExpansion,0),total:forecast.reduce((s,p)=>s+p.compraTotal,0),invRepo:forecast.reduce((s,p)=>s+p.costoRepo,0),invExp:forecast.reduce((s,p)=>s+p.costoExpansion,0),invTotal:forecast.reduce((s,p)=>s+p.costoTotal,0)}

  // Compliance: OC emitidas vs forecast
  const ocsActivas=ocs.filter(o=>!["Rechazada"].includes(o.estado))
  const totalOCEmitido=ocsActivas.reduce((s,o)=>s+(o.total_clp||0),0)
  const pctCumplimiento=totals.invTotal>0?Math.round(totalOCEmitido/totals.invTotal*100):0
  const gap=totals.invTotal-totalOCEmitido

  // By tipo
  const tipoForecast=[...new Set(forecast.map(p=>p.tipo_producto).filter(Boolean))].map(t=>{const items=forecast.filter(p=>p.tipo_producto===t);return{tipo:t,skus:items.length,repoNormal:items.reduce((s,p)=>s+p.repoNormal,0),expansion:items.reduce((s,p)=>s+p.stockExpansion,0),invTotal:items.reduce((s,p)=>s+p.costoTotal,0)}}).sort((a,b)=>b.invTotal-a.invTotal)

  // Top products to buy
  const topCompras=forecast.filter(p=>p.compraTotal>0).sort((a,b)=>b.costoTotal-a.costoTotal)

  const Bar=({pct,color,h})=><div style={{width:"100%",background:"#F2F2F7",borderRadius:4,height:h||8}}><div style={{width:Math.min(Math.max(pct,1),100)+"%",height:"100%",background:color,borderRadius:4,transition:"width 0.4s"}}/></div>

  const exportForecast=()=>{
    const h=["Tipo","Producto","SKU","Clasif.","Stock Actual","Repo Normal","% Expansión","Stock Expansión","Compra Total","Costo Unit.","Inv. Repo","Inv. Expansión","Inv. Total"]
    const rows=topCompras.map(p=>[p.tipo_producto,`"${p.producto}"`,p.sku,p.clasif_abcd,p.stock_actual,p.repoNormal,p.pctExp+"%",p.stockExpansion,p.compraTotal,p.costo_unitario,p.costoRepo,p.costoExpansion,p.costoTotal])
    const csv="\uFEFF"+[h,...rows].map(r=>r.join(";")).join("\n")
    const blob=new Blob([csv],{type:"text/csv"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`forecast_compras_${hoy()}.csv`;a.click()
  }

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <div><div style={{fontSize:26,fontWeight:800,color:"#1C1C1E"}}>Forecast de compras</div><div style={{fontSize:14,color:"#8E8E93"}}>Proyección de reposición normal + expansión nueva sucursal</div></div>
      <div style={{display:"flex",gap:6}}><Bt v="pri" sm onClick={exportForecast} ic="📥">Exportar</Bt><Bt v="gry" sm onClick={saveParams} ic="💾">Guardar</Bt></div>
    </div>

    {/* KPIs */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16}}>
      <div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:"4px solid #007AFF"}}><div style={{fontSize:10,color:"#8E8E93",textTransform:"uppercase",fontWeight:600}}>Repo normal</div><div style={{fontSize:22,fontWeight:800,color:"#007AFF",marginTop:4}}>{fmt(totals.invRepo)}</div><div style={{fontSize:11,color:"#8E8E93"}}>{fN(totals.repoNormal)} uds</div></div>
      <div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:"4px solid #AF52DE"}}><div style={{fontSize:10,color:"#8E8E93",textTransform:"uppercase",fontWeight:600}}>Expansión {nombreSuc}</div><div style={{fontSize:22,fontWeight:800,color:"#AF52DE",marginTop:4}}>{fmt(totals.invExp)}</div><div style={{fontSize:11,color:"#8E8E93"}}>{fN(totals.expansion)} uds · {pctExpansion}% stock</div></div>
      <div style={{background:"linear-gradient(135deg,#1a1a2e,#16213e)",borderRadius:12,padding:16,color:"#fff"}}><div style={{fontSize:10,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",fontWeight:600}}>Forecast total</div><div style={{fontSize:22,fontWeight:800,marginTop:4}}>{fmt(totals.invTotal)}</div><div style={{fontSize:11,color:"rgba(255,255,255,0.6)"}}>{fN(totals.total)} uds totales</div></div>
      <div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:`4px solid ${pctCumplimiento>80?"#34C759":pctCumplimiento>50?"#FF9500":"#FF3B30"}`}}><div style={{fontSize:10,color:"#8E8E93",textTransform:"uppercase",fontWeight:600}}>Cumplimiento</div><div style={{fontSize:28,fontWeight:800,color:pctCumplimiento>80?"#34C759":pctCumplimiento>50?"#FF9500":"#FF3B30",marginTop:4}}>{pctCumplimiento}%</div><div style={{fontSize:11,color:"#8E8E93"}}>OC emitidas: {fmt(totalOCEmitido)}</div></div>
      <div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:"4px solid #FF3B30"}}><div style={{fontSize:10,color:"#8E8E93",textTransform:"uppercase",fontWeight:600}}>Gap pendiente</div><div style={{fontSize:22,fontWeight:800,color:gap>0?"#FF3B30":"#34C759",marginTop:4}}>{gap>0?fmt(gap):"✓ Cubierto"}</div><div style={{fontSize:11,color:"#8E8E93"}}>{gap>0?"Falta por comprar":"Forecast cubierto"}</div></div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:16}}>
      {/* LEFT: Parameters */}
      <div>
        <Cd><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>🏪 Parámetros nueva sucursal</div>
          <Fl l="Nombre sucursal"><input value={nombreSuc} onChange={e=>setNombreSuc(e.target.value)} style={css.input}/></Fl>
          <Fl l="Fecha estimada apertura"><input type="date" value={fechaApertura} onChange={e=>setFechaApertura(e.target.value)} style={css.input}/></Fl>
          <Fl l="Factor ramp-up" sub="% de la demanda estimada que se espera desde el día 1"><div style={{display:"flex",alignItems:"center",gap:8}}><input type="range" min={30} max={100} step={5} value={rampUp} onChange={e=>setRampUp(Number(e.target.value))} style={{flex:1,accentColor:"#AF52DE"}}/><Bd c="#AF52DE" bg="#AF52DE12" lg>{rampUp}%</Bd></div></Fl>
        </Cd>

        <Cd><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>📊 % Stock para expansión</div>
          <div style={{display:"flex",gap:4,marginBottom:12,background:"#F2F2F7",borderRadius:8,padding:3}}>{[["global","Global"],["abcd","Por ABCD"]].map(([k,l])=><button key={k} onClick={()=>setModoExpansion(k)} style={{flex:1,padding:"7px",borderRadius:6,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:modoExpansion===k?"#fff":"transparent",color:modoExpansion===k?"#1C1C1E":"#8E8E93"}}>{l}</button>)}</div>
          
          {modoExpansion==="global"?<div>
            <div style={{fontSize:13,color:"#8E8E93",marginBottom:8}}>Porcentaje del stock actual que se comprará para la nueva sucursal</div>
            <div style={{display:"flex",alignItems:"center",gap:10}}><input type="range" min={5} max={100} step={5} value={pctExpansion} onChange={e=>setPctExpansion(Number(e.target.value))} style={{flex:1,accentColor:"#007AFF"}}/><div style={{fontSize:24,fontWeight:800,color:"#007AFF",minWidth:50,textAlign:"right"}}>{pctExpansion}%</div></div>
            <div style={{fontSize:12,color:"#8E8E93",marginTop:6}}>Ejemplo: con {pctExpansion}%, si un producto tiene 100 uds en stock, se comprarán {pctExpansion} uds adicionales para {nombreSuc}</div>
          </div>
          :<div>
            <div style={{fontSize:13,color:"#8E8E93",marginBottom:8}}>Porcentaje diferenciado por clasificación ABCD</div>
            {[["A",pctA,setPctA,"#FF3B30","Productos críticos — mayor stock"],["B",pctB,setPctB,"#007AFF","Productos importantes"],["C",pctC,setPctC,"#34C759","Productos regulares"],["D",pctD,setPctD,"#8E8E93","Productos de baja rotación"]].map(([c,v,set,col,desc])=><div key={c} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}><div style={{display:"flex",alignItems:"center",gap:4}}><span style={{display:"inline-block",width:20,height:20,borderRadius:4,background:col+"18",color:col,fontSize:11,fontWeight:800,textAlign:"center",lineHeight:"20px"}}>{c}</span><span style={{fontSize:12,color:"#636366"}}>{desc}</span></div><span style={{fontSize:16,fontWeight:800,color:col}}>{v}%</span></div>
              <input type="range" min={0} max={100} step={5} value={v} onChange={e=>set(Number(e.target.value))} style={{width:"100%",accentColor:col}}/>
            </div>)}
          </div>}
        </Cd>

        {/* Compliance by ABCD */}
        <Cd><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>📈 Cumplimiento por categoría</div>
          {abcdForecast.map(d=>{const pct=d.invTotal>0?Math.min(100,Math.round(totalOCEmitido*(d.invTotal/totals.invTotal)/d.invTotal*100)):0;return<div key={d.c} style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><div style={{display:"flex",alignItems:"center",gap:4}}><span style={{display:"inline-block",width:20,height:20,borderRadius:4,background:CL[d.c]?.bg,color:CL[d.c]?.c,fontSize:11,fontWeight:800,textAlign:"center",lineHeight:"20px"}}>{d.c}</span><span style={{fontSize:12,fontWeight:600}}>{d.skus} SKUs</span></div><span style={{fontSize:13,fontWeight:700,color:pct>80?"#34C759":pct>50?"#FF9500":"#FF3B30"}}>{pct}%</span></div>
            <Bar pct={pct} color={pct>80?"#34C759":pct>50?"#FF9500":"#FF3B30"} h={8}/>
          </div>})}
        </Cd>
      </div>

      {/* RIGHT: Results */}
      <div>
        {/* ABCD Forecast table */}
        <div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",marginBottom:14}}>
          <div style={{fontSize:15,fontWeight:700,marginBottom:10}}>Forecast por clasificación ABCD</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{background:"#F8F8FA"}}><th style={{padding:"8px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA"}}>CLASE</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA"}}>SKUs</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,color:"#007AFF",borderBottom:"2px solid #E5E5EA"}}>REPO NORMAL</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,color:"#AF52DE",borderBottom:"2px solid #E5E5EA"}}>EXPANSIÓN</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,color:"#1C1C1E",borderBottom:"2px solid #E5E5EA"}}>TOTAL UDS</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,color:"#007AFF",borderBottom:"2px solid #E5E5EA"}}>INV. REPO</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,color:"#AF52DE",borderBottom:"2px solid #E5E5EA"}}>INV. EXPAN.</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,color:"#1C1C1E",borderBottom:"2px solid #E5E5EA"}}>INV. TOTAL</th></tr></thead>
            <tbody>{abcdForecast.map(d=><tr key={d.c} style={{borderBottom:"1px solid #F2F2F7"}}><td style={{padding:"8px"}}><span style={{display:"inline-block",width:24,height:24,borderRadius:6,background:CL[d.c]?.bg,color:CL[d.c]?.c,fontSize:12,fontWeight:800,textAlign:"center",lineHeight:"24px"}}>{d.c}</span></td><td style={{padding:"8px",textAlign:"right"}}>{d.skus}</td><td style={{padding:"8px",textAlign:"right",color:"#007AFF",fontWeight:600}}>{fN(d.repoNormal)}</td><td style={{padding:"8px",textAlign:"right",color:"#AF52DE",fontWeight:600}}>{fN(d.expansion)}</td><td style={{padding:"8px",textAlign:"right",fontWeight:700}}>{fN(d.total)}</td><td style={{padding:"8px",textAlign:"right",color:"#007AFF"}}>{fmt(d.invRepo)}</td><td style={{padding:"8px",textAlign:"right",color:"#AF52DE"}}>{fmt(d.invExp)}</td><td style={{padding:"8px",textAlign:"right",fontWeight:700}}>{fmt(d.invTotal)}</td></tr>)}</tbody>
            <tfoot><tr style={{borderTop:"2px solid #1C1C1E",background:"#F8F8FA"}}><td style={{padding:"10px",fontWeight:700}}>TOTAL</td><td style={{padding:"10px",textAlign:"right",fontWeight:700}}>{forecast.length}</td><td style={{padding:"10px",textAlign:"right",fontWeight:700,color:"#007AFF"}}>{fN(totals.repoNormal)}</td><td style={{padding:"10px",textAlign:"right",fontWeight:700,color:"#AF52DE"}}>{fN(totals.expansion)}</td><td style={{padding:"10px",textAlign:"right",fontWeight:800,fontSize:15}}>{fN(totals.total)}</td><td style={{padding:"10px",textAlign:"right",fontWeight:700,color:"#007AFF"}}>{fmt(totals.invRepo)}</td><td style={{padding:"10px",textAlign:"right",fontWeight:700,color:"#AF52DE"}}>{fmt(totals.invExp)}</td><td style={{padding:"10px",textAlign:"right",fontWeight:800,fontSize:15}}>{fmt(totals.invTotal)}</td></tr></tfoot>
          </table>
          {/* Stacked bar */}
          <div style={{marginTop:12}}><div style={{display:"flex",borderRadius:6,overflow:"hidden",height:24}}><div style={{width:totals.invTotal>0?totals.invRepo/totals.invTotal*100+"%":"50%",background:"#007AFF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#fff",fontWeight:600}}>{totals.invTotal>0?Math.round(totals.invRepo/totals.invTotal*100):0}% Repo</div><div style={{width:totals.invTotal>0?totals.invExp/totals.invTotal*100+"%":"50%",background:"#AF52DE",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#fff",fontWeight:600}}>{totals.invTotal>0?Math.round(totals.invExp/totals.invTotal*100):0}% {nombreSuc}</div></div></div>
        </div>

        {/* By Tipo */}
        <div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",marginBottom:14}}>
          <div style={{fontSize:15,fontWeight:700,marginBottom:10}}>Forecast por tipo de producto (Top 10)</div>
          {tipoForecast.slice(0,10).map((t,i)=>{const maxInv=tipoForecast[0]?.invTotal||1;return<div key={i} style={{marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:12,fontWeight:500,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.tipo}</span><div style={{display:"flex",gap:8,fontSize:12}}><span style={{color:"#007AFF"}}>{fN(t.repoNormal)}</span><span style={{color:"#AF52DE"}}>+{fN(t.expansion)}</span><strong>{fmt(t.invTotal)}</strong></div></div>
            <div style={{display:"flex",borderRadius:3,overflow:"hidden",height:6}}><div style={{width:t.invTotal>0?(t.invTotal-t.expansion*((t.invTotal>0?(t.expansion*(t.skus>0?forecast.find(p=>p.tipo_producto===t.tipo)?.costo_unitario||0:0)):0)/t.invTotal))/maxInv*100+"%":"0%",background:"#007AFF"}}/><div style={{width:t.invTotal>0?t.expansion*(forecast.find(p=>p.tipo_producto===t.tipo)?.costo_unitario||1)/maxInv*0.1+"%":"0%",background:"#AF52DE"}}/></div>
          </div>})}
        </div>

        {/* Top products detail */}
        <div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
          <div style={{fontSize:15,fontWeight:700,marginBottom:10}}>Top 20 productos — Mayor inversión forecast</div>
          <div style={{overflowY:"auto",maxHeight:400}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead style={{position:"sticky",top:0}}><tr style={{background:"#F8F8FA"}}><th style={{padding:"6px 8px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA"}}>PRODUCTO</th><th style={{padding:"6px",textAlign:"center",fontSize:10,fontWeight:700,borderBottom:"2px solid #E5E5EA"}}>ABCD</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,color:"#007AFF",borderBottom:"2px solid #E5E5EA"}}>REPO</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,color:"#AF52DE",borderBottom:"2px solid #E5E5EA"}}>EXPAN.</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"2px solid #E5E5EA"}}>TOTAL</th><th style={{padding:"6px 8px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"2px solid #E5E5EA"}}>INVERSIÓN</th></tr></thead>
            <tbody>{topCompras.slice(0,20).map((p,i)=><tr key={i} style={{borderBottom:"1px solid #F2F2F7"}}><td style={{padding:"6px 8px"}}><div style={{fontWeight:600,maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.producto}</div><div style={{fontSize:10,color:"#AEAEB2"}}>{p.tipo_producto}</div></td><td style={{padding:"6px",textAlign:"center"}}><span style={{padding:"2px 6px",borderRadius:4,fontSize:10,fontWeight:700,color:CL[p.clasif_abcd]?.c,background:CL[p.clasif_abcd]?.bg}}>{p.clasif_abcd}</span></td><td style={{padding:"6px",textAlign:"right",color:"#007AFF",fontWeight:600}}>{fN(p.repoNormal)}</td><td style={{padding:"6px",textAlign:"right",color:"#AF52DE",fontWeight:600}}>{fN(p.stockExpansion)}</td><td style={{padding:"6px",textAlign:"right",fontWeight:700}}>{fN(p.compraTotal)}</td><td style={{padding:"6px 8px",textAlign:"right",fontWeight:700}}>{fmt(p.costoTotal)}</td></tr>)}</tbody>
          </table></div>
        </div>
      </div>
    </div>
  </div>
}

/* ═══ COSTEO IMPORTACIÓN — 7-stage import cost simulator with per-product proration ═══ */
function CosteoImpView({config,saveConfig,ocs}){
  const ocsImp=ocs.filter(o=>o.tipo_oc==="Importación"&&!["Rechazada"].includes(o.estado))
  const[selOC,setSelOC]=useState("")
  const[ocItems,setOcItems]=useState([])
  // Load OC items when selected
  useEffect(()=>{if(!selOC){setOcItems([]);return};supabase.from('oc_items').select('*').eq('oc_id',selOC).then(r=>{const items=r.data||[];setOcItems(items);if(items.length>0){const totalQty=items.reduce((s,i)=>s+(i.cantidad_pedida||0),0);const totalFOB=items.reduce((s,i)=>s+((i.cantidad_pedida||0)*(i.costo_unitario||0)),0);const avgPrice=totalQty>0?Math.round(totalFOB/totalQty):0;setP(prev=>({...prev,cantUds:totalQty,precioUnitFOB:Math.round(avgPrice/prev.tc*100)/100}))}})},[selOC])

  const[p,setP]=useState({moneda:"USD",tc:Number(config.tc_usd)||950,cantUds:1000,precioUnitFOB:5.00,tipoContenedor:"40HC",costoFlete:Number(config.costo_flete_40hc)||3800,pctSeguro:Number(config.pct_seguro_int)||0.5,pctArancel:Number(config.pct_arancel)||6,tieneILC:false,pctAforo:1,pctIVA:19,handling:Number(config.costo_handling)||350,almacenajeDia:Number(config.almacenaje_dia)||45,diasAlmacenaje:Number(config.dias_almacenaje)||5,porteo:Number(config.costo_porteo)||120,honorarioAgente:Number(config.honorario_agente)||450,gastosOpAgente:Number(config.gastos_op_agente)||180,transportePuertoBodega:Number(config.transporte_puerto_bodega)||800,seguroTerrestre:Number(config.seguro_terrestre)||50,pctCostoFinanciero:Number(config.pct_costo_financiero)||1.5,diasTransito:Number(config.dias_transito_imp)||60,costoTransferencia:Number(config.costo_transferencia)||35,precioVentaCLP:0})
  const u=(k,v)=>setP(prev=>({...prev,[k]:Number(v)||0}))
  const us=(k,v)=>setP(prev=>({...prev,[k]:v}))
  const TC=p.tc

  // ═══ CALCULATIONS ═══
  const fobUSD=p.cantUds*p.precioUnitFOB;const fobCLP=Math.round(fobUSD*TC)
  const fleteUSD=p.costoFlete;const seguroUSD=Math.round(fobUSD*p.pctSeguro/100*100)/100
  const cifUSD=fobUSD+fleteUSD+seguroUSD;const cifCLP=Math.round(cifUSD*TC)
  const arancelCLP=p.tieneILC?0:Math.round(cifCLP*p.pctArancel/100);const aforoCLP=Math.round(cifCLP*p.pctAforo/100)
  const ivaCLP=Math.round((cifCLP+arancelCLP)*p.pctIVA/100);const totalAduana=arancelCLP+aforoCLP+ivaCLP
  const handlingCLP=Math.round(p.handling*TC);const almacenajeCLP=Math.round(p.almacenajeDia*p.diasAlmacenaje*TC)
  const porteoCLP=Math.round(p.porteo*TC);const totalPuerto=handlingCLP+almacenajeCLP+porteoCLP
  const agenteCLP=Math.round((p.honorarioAgente+p.gastosOpAgente)*TC)
  const transporteCLP=Math.round((p.transportePuertoBodega+p.seguroTerrestre)*TC)
  const costoFinCLP=Math.round(cifCLP*p.pctCostoFinanciero/100*(p.diasTransito/30))
  const costoTransfCLP=Math.round(p.costoTransferencia*TC);const totalFinanciero=costoFinCLP+costoTransfCLP
  const costoTotalCLP=fobCLP+Math.round(fleteUSD*TC)+Math.round(seguroUSD*TC)+totalAduana+totalPuerto+agenteCLP+transporteCLP+totalFinanciero
  const costoUnitBodega=p.cantUds>0?Math.round(costoTotalCLP/p.cantUds):0
  const margenPct=p.precioVentaCLP>0?Math.round((p.precioVentaCLP-costoUnitBodega)/p.precioVentaCLP*100):0

  // Gastos de internación (todo excepto FOB) — se prorratea por producto
  const gastosInternacion=costoTotalCLP-fobCLP
  const pctInternacionSobreFOB=fobCLP>0?gastosInternacion/fobCLP:0

  // Per-product cost breakdown (proration by FOB value)
  const productCosts=ocItems.map(item=>{
    const qty=item.cantidad_confirmada||item.cantidad_pedida||0
    const costoUnitOrigen=item.costo_unitario||0
    const fobProducto=qty*costoUnitOrigen // FOB de esta línea en CLP
    const pctDelFOB=fobCLP>0?fobProducto/fobCLP:0 // % que representa del total FOB
    // Prorrateo de cada gasto proporcional al FOB del producto
    const prFlete=Math.round(Math.round(fleteUSD*TC)*pctDelFOB)
    const prSeguro=Math.round(Math.round(seguroUSD*TC)*pctDelFOB)
    const prArancel=Math.round(arancelCLP*pctDelFOB)
    const prAforo=Math.round(aforoCLP*pctDelFOB)
    const prIVA=Math.round(ivaCLP*pctDelFOB)
    const prPuerto=Math.round(totalPuerto*pctDelFOB)
    const prAgente=Math.round(agenteCLP*pctDelFOB)
    const prTransporte=Math.round(transporteCLP*pctDelFOB)
    const prFinanciero=Math.round(totalFinanciero*pctDelFOB)
    const totalInternacion=prFlete+prSeguro+prArancel+prAforo+prIVA+prPuerto+prAgente+prTransporte+prFinanciero
    const costoTotalProducto=fobProducto+totalInternacion
    const costoUnitFinal=qty>0?Math.round(costoTotalProducto/qty):0
    const incremento=costoUnitOrigen>0?Math.round((costoUnitFinal-costoUnitOrigen)/costoUnitOrigen*100):0
    return{...item,qty,costoUnitOrigen,fobProducto,pctDelFOB,prFlete,prSeguro,prArancel,prIVA,prPuerto,prAgente,prTransporte,prFinanciero,totalInternacion,costoTotalProducto,costoUnitFinal,incremento}
  })

  const stages=[{n:"FOB",v:fobCLP,c:"#007AFF",ic:"🏭"},{n:"Flete+Seguro",v:Math.round((fleteUSD+seguroUSD)*TC),c:"#5856D6",ic:"🚢"},{n:"Aduana",v:totalAduana,c:"#FF3B30",ic:"🏛"},{n:"Puerto",v:totalPuerto,c:"#FF9500",ic:"⚓"},{n:"Agente",v:agenteCLP,c:"#AF52DE",ic:"📋"},{n:"Transporte",v:transporteCLP,c:"#34C759",ic:"🚛"},{n:"Financiero",v:totalFinanciero,c:"#FF2D55",ic:"💰"}]
  const maxStage=Math.max(...stages.map(s=>s.v),1)
  const In=({l,k,pre,suf,w,dis})=><div style={{marginBottom:8}}><div style={{fontSize:11,color:"#636366",fontWeight:600,marginBottom:2}}>{l}</div><div style={{display:"flex",alignItems:"center",gap:4}}>{pre&&<span style={{fontSize:12,color:"#8E8E93"}}>{pre}</span>}<input type="number" value={p[k]} onChange={e=>u(k,e.target.value)} disabled={dis} style={{width:w||90,padding:"6px 8px",borderRadius:6,border:"1px solid #D1D1D6",fontSize:13,fontWeight:600,textAlign:"right"}}/>{suf&&<span style={{fontSize:12,color:"#8E8E93"}}>{suf}</span>}</div></div>
  const saveParams=async()=>{const keys={tc_usd:p.tc,costo_flete_40hc:p.costoFlete,pct_seguro_int:p.pctSeguro,pct_arancel:p.pctArancel,costo_handling:p.handling,almacenaje_dia:p.almacenajeDia,dias_almacenaje:p.diasAlmacenaje,costo_porteo:p.porteo,honorario_agente:p.honorarioAgente,gastos_op_agente:p.gastosOpAgente,transporte_puerto_bodega:p.transportePuertoBodega,seguro_terrestre:p.seguroTerrestre,pct_costo_financiero:p.pctCostoFinanciero,dias_transito_imp:p.diasTransito,costo_transferencia:p.costoTransferencia};for(const[k,v]of Object.entries(keys))await saveConfig(k,String(v));alert("Parámetros guardados")}

  const exportCosteo=()=>{
    if(productCosts.length===0)return
    const h=["Producto","SKU","Cantidad","Costo Unit. Origen","FOB Línea","% del FOB","Flete","Seguro","Arancel","IVA","Puerto","Agente","Transporte","Financiero","Total Internación","Costo Total","Costo Unit. Bodega","Incremento %"]
    const rows=productCosts.map(i=>[`"${i.producto}"`,i.sku,i.qty,i.costoUnitOrigen,i.fobProducto,Math.round(i.pctDelFOB*100),i.prFlete,i.prSeguro,i.prArancel,i.prIVA,i.prPuerto,i.prAgente,i.prTransporte,i.prFinanciero,i.totalInternacion,i.costoTotalProducto,i.costoUnitFinal,i.incremento+"%"])
    const csv="\uFEFF"+[h,...rows].map(r=>r.join(";")).join("\n")
    const blob=new Blob([csv],{type:"text/csv"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`costeo_importacion_${selOC||"sim"}_${hoy()}.csv`;a.click()
  }

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <div><div style={{fontSize:26,fontWeight:800,color:"#1C1C1E"}}>Costeo de importación</div><div style={{fontSize:14,color:"#8E8E93"}}>Simulador CIF + internación con prorrateo por producto</div></div>
      <div style={{display:"flex",gap:6}}>{productCosts.length>0&&<Bt v="pri" sm onClick={exportCosteo} ic="📥">Exportar costeo</Bt>}<Bt v="gry" sm onClick={saveParams} ic="💾">Guardar params</Bt></div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"360px 1fr",gap:16}}>
      {/* LEFT: Parameters */}
      <div style={{maxHeight:"calc(100vh - 200px)",overflowY:"auto",paddingRight:8}}>
        {/* OC selector */}
        <Cd><div style={{fontSize:13,fontWeight:700,marginBottom:6}}>📦 Seleccionar OC de importación</div>
          <select value={selOC} onChange={e=>setSelOC(e.target.value)} style={{...css.select,marginBottom:4,fontWeight:600}}><option value="">— Simulación libre —</option>{ocsImp.map(o=><option key={o.id} value={o.id}>{o.id} — {fmt(o.total_clp)} ({o.estado})</option>)}</select>
          {selOC&&ocItems.length>0&&<div style={{fontSize:12,color:"#34C759",fontWeight:600,marginTop:4}}>✓ {ocItems.length} productos cargados desde la OC</div>}
        </Cd>

        {/* E1 */}
        <Cd><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><span style={{fontSize:16}}>🏭</span><div style={{fontSize:13,fontWeight:700,color:"#007AFF"}}>1. Costo FOB</div></div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><In l="Cantidad" k="cantUds" w={90}/><In l="Precio unit. FOB" k="precioUnitFOB" pre="USD" w={90}/><In l="TC" k="tc" pre="$" w={80}/></div>
          <div style={{background:"#007AFF08",borderRadius:6,padding:6,fontSize:12}}><strong style={{color:"#007AFF"}}>FOB = {fU(fobUSD)}</strong> → {fmt(fobCLP)}</div>
        </Cd>
        {/* E2 */}
        <Cd><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><span style={{fontSize:16}}>🚢</span><div style={{fontSize:13,fontWeight:700,color:"#5856D6"}}>2. Flete + Seguro</div></div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><In l="Flete" k="costoFlete" pre="USD" w={90}/><In l="Seguro" k="pctSeguro" suf="%" w={60}/></div>
          <div style={{background:"#5856D608",borderRadius:6,padding:6,fontSize:12}}><strong style={{color:"#5856D6"}}>CIF = {fU(cifUSD)}</strong> ({fmt(cifCLP)})</div>
        </Cd>
        {/* E3 */}
        <Cd><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><span style={{fontSize:16}}>🏛</span><div style={{fontSize:13,fontWeight:700,color:"#FF3B30"}}>3. Aduana</div></div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"end"}}><In l="Arancel" k="pctArancel" suf="%" w={60}/><div style={{marginBottom:8}}><label style={{display:"flex",alignItems:"center",gap:4,fontSize:12,cursor:"pointer"}}><input type="checkbox" checked={p.tieneILC} onChange={e=>us("tieneILC",e.target.checked)}/>TLC 0%</label></div><In l="Aforo" k="pctAforo" suf="%" w={50}/><In l="IVA" k="pctIVA" suf="%" w={50}/></div>
          <div style={{background:"#FF3B3008",borderRadius:6,padding:6,fontSize:12}}>Arancel: {fmt(arancelCLP)} · IVA: {fmt(ivaCLP)} → <strong style={{color:"#FF3B30"}}>{fmt(totalAduana)}</strong></div>
        </Cd>
        {/* E4 */}
        <Cd><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><span style={{fontSize:16}}>⚓</span><div style={{fontSize:13,fontWeight:700,color:"#FF9500"}}>4. Puerto</div></div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><In l="Handling" k="handling" pre="USD" w={80}/><In l="Almac./día" k="almacenajeDia" pre="USD" w={70}/><In l="Días" k="diasAlmacenaje" w={45}/><In l="Porteo" k="porteo" pre="USD" w={70}/></div>
          <div style={{background:"#FF950008",borderRadius:6,padding:6,fontSize:12}}>Total: <strong style={{color:"#FF9500"}}>{fmt(totalPuerto)}</strong></div>
        </Cd>
        {/* E5 */}
        <Cd><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><span style={{fontSize:16}}>📋</span><div style={{fontSize:13,fontWeight:700,color:"#AF52DE"}}>5. Agente aduana</div></div>
          <div style={{display:"flex",gap:8}}><In l="Honorarios" k="honorarioAgente" pre="USD" w={90}/><In l="Gastos" k="gastosOpAgente" pre="USD" w={90}/></div>
        </Cd>
        {/* E6 */}
        <Cd><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><span style={{fontSize:16}}>🚛</span><div style={{fontSize:13,fontWeight:700,color:"#34C759"}}>6. Transporte</div></div>
          <div style={{display:"flex",gap:8}}><In l="Puerto→Bodega" k="transportePuertoBodega" pre="USD" w={90}/><In l="Seguro" k="seguroTerrestre" pre="USD" w={80}/></div>
        </Cd>
        {/* E7 */}
        <Cd><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><span style={{fontSize:16}}>💰</span><div style={{fontSize:13,fontWeight:700,color:"#FF2D55"}}>7. Financiero</div></div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><In l="Costo fin." k="pctCostoFinanciero" suf="%/mes" w={70}/><In l="Días tránsito" k="diasTransito" w={60}/><In l="Transf." k="costoTransferencia" pre="USD" w={80}/></div>
        </Cd>
      </div>

      {/* RIGHT: Results */}
      <div>
        {/* KPIs */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
          <div style={{background:"linear-gradient(135deg,#1a1a2e,#16213e)",borderRadius:12,padding:16,color:"#fff"}}><div style={{fontSize:10,color:"rgba(255,255,255,0.5)",textTransform:"uppercase"}}>Costo total internado</div><div style={{fontSize:26,fontWeight:800,marginTop:4}}>{fmt(costoTotalCLP)}</div><div style={{fontSize:12,color:"rgba(255,255,255,0.5)"}}>Internación: +{Math.round(pctInternacionSobreFOB*100)}% sobre FOB</div></div>
          <div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",borderLeft:"4px solid #007AFF"}}><div style={{fontSize:10,color:"#8E8E93",textTransform:"uppercase"}}>Costo unit. bodega</div><div style={{fontSize:26,fontWeight:800,color:"#007AFF",marginTop:4}}>{fmt(costoUnitBodega)}</div><div style={{fontSize:12,color:"#8E8E93"}}>{p.cantUds>0?fN(p.cantUds):0} uds</div></div>
          <div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",borderLeft:`4px solid ${margenPct>30?"#34C759":margenPct>15?"#FF9500":"#FF3B30"}`}}><div style={{fontSize:10,color:"#8E8E93",textTransform:"uppercase"}}>Margen</div><div style={{fontSize:26,fontWeight:800,color:margenPct>30?"#34C759":margenPct>15?"#FF9500":"#FF3B30",marginTop:4}}>{margenPct}%</div><In l="" k="precioVentaCLP" pre="Venta $" w={100}/></div>
        </div>

        {/* Waterfall */}
        <div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",marginBottom:14}}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:10}}>Cascada por etapa</div>
          {stages.map((s,i)=>{const pct=costoTotalCLP>0?Math.round(s.v/costoTotalCLP*100):0;return<div key={i} style={{marginBottom:6}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:12,fontWeight:600}}>{s.ic} {s.n}</span><span style={{fontSize:13,fontWeight:700,color:s.c}}>{fmt(s.v)} <span style={{color:"#8E8E93",fontWeight:400,fontSize:11}}>({pct}%)</span></span></div><div style={{width:"100%",background:"#F2F2F7",borderRadius:3,height:10,overflow:"hidden"}}><div style={{width:Math.max(s.v/maxStage*100,2)+"%",height:"100%",background:s.c,borderRadius:3}}/></div></div>})}
          <div style={{borderTop:"2px solid #1C1C1E",paddingTop:6,marginTop:6,display:"flex",justifyContent:"space-between"}}><strong style={{fontSize:14}}>TOTAL</strong><strong style={{fontSize:18}}>{fmt(costoTotalCLP)}</strong></div>
        </div>

        {/* ═══ PER-PRODUCT COST TABLE ═══ */}
        {productCosts.length>0&&<div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div><div style={{fontSize:15,fontWeight:700,color:"#1C1C1E"}}>📦 Costeo por línea de producto</div><div style={{fontSize:12,color:"#8E8E93"}}>Prorrateo de gastos de internación proporcional al valor FOB de cada producto</div></div>
            <Bd c="#AF52DE" bg="#AF52DE12" lg>Internación: +{Math.round(pctInternacionSobreFOB*100)}%</Bd>
          </div>
          <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{background:"#F8F8FA"}}>
              <th style={{padding:"8px 6px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA"}}>PRODUCTO</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA"}}>CANT.</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#007AFF",borderBottom:"2px solid #E5E5EA"}}>UNIT. ORIGEN</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA"}}>FOB LÍNEA</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#5856D6",borderBottom:"2px solid #E5E5EA"}}>FLETE+SEG</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#FF3B30",borderBottom:"2px solid #E5E5EA"}}>ADUANA</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#FF9500",borderBottom:"2px solid #E5E5EA"}}>OTROS</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#AF52DE",borderBottom:"2px solid #E5E5EA"}}>INTERNAC.</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#1C1C1E",borderBottom:"2px solid #E5E5EA"}}>COSTO TOTAL</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:800,color:"#007AFF",borderBottom:"2px solid #E5E5EA"}}>UNIT. BODEGA</th>
              <th style={{padding:"8px 6px",textAlign:"right",fontSize:10,fontWeight:700,color:"#FF9500",borderBottom:"2px solid #E5E5EA"}}>INCR.</th>
            </tr></thead>
            <tbody>{productCosts.map((item,i)=><tr key={i} style={{borderBottom:"1px solid #F2F2F7"}}>
              <td style={{padding:"8px 6px"}}><div style={{fontWeight:600,fontSize:12,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.producto}</div><div style={{fontSize:10,color:"#AEAEB2"}}>{item.sku}</div></td>
              <td style={{padding:"8px 4px",textAlign:"right",fontWeight:600}}>{fN(item.qty)}</td>
              <td style={{padding:"8px 4px",textAlign:"right",color:"#007AFF",fontWeight:600}}>{fmt(item.costoUnitOrigen)}</td>
              <td style={{padding:"8px 4px",textAlign:"right"}}>{fmt(item.fobProducto)}</td>
              <td style={{padding:"8px 4px",textAlign:"right",color:"#5856D6"}}>{fmt(item.prFlete+item.prSeguro)}</td>
              <td style={{padding:"8px 4px",textAlign:"right",color:"#FF3B30"}}>{fmt(item.prArancel+item.prIVA)}</td>
              <td style={{padding:"8px 4px",textAlign:"right",color:"#FF9500"}}>{fmt(item.prPuerto+item.prAgente+item.prTransporte+item.prFinanciero)}</td>
              <td style={{padding:"8px 4px",textAlign:"right",color:"#AF52DE",fontWeight:600}}>{fmt(item.totalInternacion)}</td>
              <td style={{padding:"8px 4px",textAlign:"right",fontWeight:700}}>{fmt(item.costoTotalProducto)}</td>
              <td style={{padding:"8px 4px",textAlign:"right",fontWeight:800,color:"#007AFF",fontSize:14}}>{fmt(item.costoUnitFinal)}</td>
              <td style={{padding:"8px 6px",textAlign:"right"}}><span style={{padding:"2px 6px",borderRadius:4,fontSize:11,fontWeight:700,color:item.incremento>50?"#FF3B30":item.incremento>30?"#FF9500":"#34C759",background:item.incremento>50?"#FF3B3012":item.incremento>30?"#FF950012":"#34C75912"}}>+{item.incremento}%</span></td>
            </tr>)}</tbody>
            <tfoot><tr style={{borderTop:"2px solid #1C1C1E",background:"#F8F8FA"}}><td style={{padding:"10px 6px",fontWeight:700}}>TOTALES</td><td style={{padding:"10px 4px",textAlign:"right",fontWeight:700}}>{fN(productCosts.reduce((s,i)=>s+i.qty,0))}</td><td></td><td style={{padding:"10px 4px",textAlign:"right",fontWeight:700}}>{fmt(productCosts.reduce((s,i)=>s+i.fobProducto,0))}</td><td style={{padding:"10px 4px",textAlign:"right",fontWeight:600,color:"#5856D6"}}>{fmt(productCosts.reduce((s,i)=>s+i.prFlete+i.prSeguro,0))}</td><td style={{padding:"10px 4px",textAlign:"right",fontWeight:600,color:"#FF3B30"}}>{fmt(productCosts.reduce((s,i)=>s+i.prArancel+i.prIVA,0))}</td><td style={{padding:"10px 4px",textAlign:"right",fontWeight:600,color:"#FF9500"}}>{fmt(productCosts.reduce((s,i)=>s+i.prPuerto+i.prAgente+i.prTransporte+i.prFinanciero,0))}</td><td style={{padding:"10px 4px",textAlign:"right",fontWeight:700,color:"#AF52DE"}}>{fmt(productCosts.reduce((s,i)=>s+i.totalInternacion,0))}</td><td style={{padding:"10px 4px",textAlign:"right",fontSize:16,fontWeight:800}}>{fmt(costoTotalCLP)}</td><td></td><td></td></tr></tfoot>
          </table></div>
        </div>}

        {/* No OC selected message */}
        {productCosts.length===0&&<div style={{background:"#fff",borderRadius:12,padding:24,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",textAlign:"center"}}><div style={{fontSize:32,marginBottom:8}}>📦</div><div style={{fontSize:15,fontWeight:700,color:"#1C1C1E"}}>Selecciona una OC de importación</div><div style={{fontSize:13,color:"#8E8E93",marginTop:4}}>Para ver el costeo por línea de producto, selecciona una OC del panel izquierdo. Los gastos de internación se prorratearán proporcionalmente al valor FOB de cada producto.</div></div>}
      </div>
    </div>
  </div>
}

/* ═══ TRÁNSITO — Products in transit with ETA + Export ═══ */
function TransitoView({ocs,provs}){
  const activas=ocs.filter(o=>!["Cerrada","Rechazada","Pend. Dir. Negocios","Pend. Dir. Finanzas"].includes(o.estado)&&!o.estado?.includes("Recibida"))
  const[items,setItems]=useState([])
  useEffect(()=>{
    const load=async()=>{if(activas.length===0){setItems([]);return};const ids=activas.map(o=>o.id);const{data}=await supabase.from('oc_items').select('*').in('oc_id',ids);setItems(data||[])}
    load()
  },[ocs])

  const exportCSV=()=>{
    const h=["OC","Proveedor","Tipo","Estado","Fase","Producto","SKU","Cantidad Pedida","Costo Unitario","Subtotal","Fecha Creación","ETA","Condición Pago"]
    const rows=activas.flatMap(oc=>{const pv=provs.find(p=>p.id===oc.proveedor_id);return items.filter(i=>i.oc_id===oc.id).map(i=>[oc.id,pv?.nombre||oc.proveedor_id,oc.tipo_oc,oc.estado,oc.fase_actual,`"${i.producto}"`,i.sku,i.cantidad_pedida,i.costo_unitario,(i.cantidad_pedida||0)*(i.costo_unitario||0),oc.fecha_creacion,oc.fecha_estimada||"Sin fecha",oc.condicion_pago])})
    const csv="\uFEFF"+[h,...rows].map(r=>r.join(";")).join("\n")
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`productos_transito_${hoy()}.csv`;a.click()
  }

  const totalItems=items.length;const totalUds=items.reduce((s,i)=>s+(i.cantidad_pedida||0),0);const totalMonto=activas.reduce((s,o)=>s+(o.total_clp||0),0)

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div><div style={{fontSize:22,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Productos en tránsito</div><div style={{fontSize:13,color:"#8E8E93"}}>{activas.length} OC activas · {totalItems} productos · {fN(totalUds)} unidades</div></div>
      <Bt v="gry" onClick={exportCSV} sm ic="📥">Exportar CSV</Bt>
    </div>

    <div style={{display:"flex",gap:8,marginBottom:14}}>
      <div style={{background:"#fff",borderRadius:10,padding:"10px 16px",boxShadow:"0 1px 2px rgba(0,0,0,0.04)",flex:1,textAlign:"center"}}><div style={{fontSize:20,fontWeight:700,color:"#007AFF"}}>{activas.length}</div><div style={{fontSize:10,color:"#8E8E93"}}>OC activas</div></div>
      <div style={{background:"#fff",borderRadius:10,padding:"10px 16px",boxShadow:"0 1px 2px rgba(0,0,0,0.04)",flex:1,textAlign:"center"}}><div style={{fontSize:20,fontWeight:700,color:"#1C1C1E"}}>{fN(totalUds)}</div><div style={{fontSize:10,color:"#8E8E93"}}>Unidades</div></div>
      <div style={{background:"#fff",borderRadius:10,padding:"10px 16px",boxShadow:"0 1px 2px rgba(0,0,0,0.04)",flex:1,textAlign:"center"}}><div style={{fontSize:20,fontWeight:700,color:"#34C759"}}>{fmt(totalMonto)}</div><div style={{fontSize:10,color:"#8E8E93"}}>Monto total</div></div>
    </div>

    {activas.length===0?<div style={{textAlign:"center",padding:40}}><div style={{fontSize:32,marginBottom:8}}>📭</div><div style={{color:"#8E8E93"}}>Sin productos en tránsito</div></div>:
    <div style={{overflowX:"auto",borderRadius:10,border:"1px solid #E5E5EA"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:800}}>
        <thead><tr style={{background:"#F2F2F7"}}>{["OC","Proveedor","Estado","Producto","SKU","Cantidad","Subtotal","ETA"].map((h,i)=><th key={i} style={{padding:"8px 6px",textAlign:i>4?"right":"left",fontSize:10,fontWeight:700,color:"#8E8E93",borderBottom:"2px solid #E5E5EA",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
        <tbody>{activas.flatMap(oc=>{const pv=provs.find(p=>p.id===oc.proveedor_id);const ocItems=items.filter(i=>i.oc_id===oc.id);const isI=oc.tipo_oc==="Importación"
          return ocItems.map((i,idx)=><tr key={oc.id+"-"+idx} style={{borderBottom:"1px solid #F2F2F7",background:idx===0?"#fafafa":"#fff"}}>
            {idx===0?<td rowSpan={ocItems.length} style={{padding:"6px 6px",verticalAlign:"top",borderRight:"2px solid #E5E5EA"}}><div style={{fontWeight:700,fontFamily:"monospace",fontSize:11}}>{oc.id}</div><Bd c={isI?"#FF3B30":"#007AFF"} bg={isI?"#FF3B3015":"#007AFF15"}>{isI?"IMP":"NAC"}</Bd></td>:null}
            {idx===0?<td rowSpan={ocItems.length} style={{padding:"6px 6px",verticalAlign:"top"}}><div style={{fontWeight:600,fontSize:11}}>{pv?.nombre||oc.proveedor_id}</div></td>:null}
            {idx===0?<td rowSpan={ocItems.length} style={{padding:"6px 6px",verticalAlign:"top"}}><Bd c={STS[oc.estado]?.c} bg={STS[oc.estado]?.bg}>{STS[oc.estado]?.ic} {oc.estado}</Bd></td>:null}
            <td style={{padding:"6px 6px"}}><div style={{fontWeight:500}}>{i.producto}</div></td>
            <td style={{padding:"6px 6px",fontSize:10,color:"#8E8E93"}}>{i.sku}</td>
            <td style={{padding:"6px 6px",textAlign:"right",fontWeight:600,color:"#007AFF"}}>{fN(i.cantidad_pedida)}</td>
            <td style={{padding:"6px 6px",textAlign:"right",fontWeight:600}}>{fmt((i.cantidad_pedida||0)*(i.costo_unitario||0))}</td>
            {idx===0?<td rowSpan={ocItems.length} style={{padding:"6px 6px",textAlign:"right",verticalAlign:"top"}}><div style={{fontWeight:600,color:oc.fecha_estimada?"#1C1C1E":"#AEAEB2"}}>{oc.fecha_estimada||"Sin fecha"}</div></td>:null}
          </tr>)
        })}</tbody>
      </table>
    </div>}
  </div>
}

/* ═══ CONFIG ═══ */
function ConfigView({config,saveConfig,params,setParams,paramsABCD,setParamsABCD,provs,setProvs,users,setUsers,h,configTab,setConfigTab,loadAll,cu}){
  const isAdmin=cu?.rol==="admin"||cu?.rol==="dir_general"
  const allTabs=[{k:"params",l:"Reposición",ic:"📊",all:true},{k:"bsale",l:"BSALE",ic:"🔗",all:true},{k:"provs",l:"Proveedores",ic:"🏢",all:true},{k:"users",l:"Usuarios",ic:"👤",all:false},{k:"permisos",l:"Permisos",ic:"🔑",all:false}]
  const tabs=allTabs.filter(t=>t.all||isAdmin)

  const[bsaleToken,setBsaleToken]=useState(config.bsale_token||"")
  const[showProvForm,setShowProvForm]=useState(false)
  const[showUserForm,setShowUserForm]=useState(false)
  const[provForm,setProvForm]=useState({id:"",nombre:"",tipo:"Nacional",condicion_pago:"Contado",encargado:"",correo:"",activo:true,pct_fabricacion:0,pct_embarque:0,pct_puerto:0})
  const[userForm,setUserForm]=useState({id:"",nombre:"",correo:"",rol:"analista",firma_digital:"",activo:true,avatar:""})
  const[editing,setEditing]=useState(null)

  const saveBsale=async()=>{await saveConfig("bsale_token",bsaleToken);await saveConfig("bsale_activo",bsaleToken?"true":"false")}
  const saveProv=async()=>{const f={...provForm};if(editing){await supabase.from('proveedores').update(f).eq('id',editing);setProvs(p=>p.map(s=>s.id===editing?f:s))}else{f.id="PROV-"+Date.now().toString().slice(-4);await supabase.from('proveedores').insert(f);setProvs(p=>[...p,f])};setShowProvForm(false);setEditing(null)}
  const saveUser=async()=>{const f={...userForm,avatar:userForm.nombre.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()};if(editing){await supabase.from('usuarios').update(f).eq('id',editing);setUsers(p=>p.map(u=>u.id===editing?f:u))}else{f.id="USR-"+Date.now().toString().slice(-4);await supabase.from('usuarios').insert(f);setUsers(p=>[...p,f])};setShowUserForm(false);setEditing(null)}

  return<div>
    <div style={{fontSize:22,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em",marginBottom:12}}>Configuración</div>
    <div style={{display:"flex",gap:4,marginBottom:14,background:"#E5E5EA",borderRadius:10,padding:3}}>
      {tabs.map(t=><button key={t.k} onClick={()=>setConfigTab(t.k)} style={{flex:1,padding:"8px 4px",borderRadius:8,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",background:configTab===t.k?"#fff":"transparent",color:configTab===t.k?"#1C1C1E":"#8E8E93",boxShadow:configTab===t.k?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>{t.ic} {t.l}</button>)}
    </div>

    {configTab==="params"&&<div>
      <Cd><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>Tiempos fabricación y cobertura</div>
        {params.map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:"1px solid #F2F2F7"}}>
          <div style={{flex:1,fontSize:13,fontWeight:500}}>{t.tipo_producto}</div>
          <div style={{display:"flex",gap:4,alignItems:"center"}}><input type="number" value={t.dias_fabricacion} onChange={async e=>{const v=Number(e.target.value);await supabase.from('parametros_tipo').update({dias_fabricacion:v}).eq('tipo_producto',t.tipo_producto);setParams(p=>p.map((x,j)=>j===i?{...x,dias_fabricacion:v}:x))}} style={{width:50,textAlign:"center",padding:6,borderRadius:8,border:"1px solid #E5E5EA",fontSize:13}}/><span style={{fontSize:10,color:"#8E8E93"}}>fab</span></div>
          <div style={{display:"flex",gap:4,alignItems:"center"}}><input type="number" value={t.periodo_cobertura} onChange={async e=>{const v=Number(e.target.value);await supabase.from('parametros_tipo').update({periodo_cobertura:v}).eq('tipo_producto',t.tipo_producto);setParams(p=>p.map((x,j)=>j===i?{...x,periodo_cobertura:v}:x))}} style={{width:50,textAlign:"center",padding:6,borderRadius:8,border:"1px solid #E5E5EA",fontSize:13}}/><span style={{fontSize:10,color:"#8E8E93"}}>cob</span></div>
        </div>)}
      </Cd>
      <Cd s={{marginTop:10}}><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>Stock emergencia ABCD</div>
        {paramsABCD.map((e,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #F2F2F7"}}>
          <Bd c={CL[e.clasificacion]?.c} bg={CL[e.clasificacion]?.bg} lg>Clase {e.clasificacion}</Bd>
          <input type="number" value={e.dias_emergencia} onChange={async ev=>{const v=Number(ev.target.value);await supabase.from('parametros_abcd').update({dias_emergencia:v}).eq('clasificacion',e.clasificacion);setParamsABCD(p=>p.map((x,j)=>j===i?{...x,dias_emergencia:v}:x))}} style={{width:56,textAlign:"center",padding:6,borderRadius:8,border:"1px solid #E5E5EA",fontSize:14,fontWeight:600}}/>
          <span style={{fontSize:12,color:"#8E8E93"}}>días — {e.descripcion}</span>
        </div>)}
      </Cd>
      <Cd s={{marginTop:10}}><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>Detección de quiebres</div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
          <span style={{fontSize:13,fontWeight:600}}>Umbral:</span>
          <input type="range" min={10} max={50} step={5} value={config.umbral_quiebre_pct||30} onChange={e=>saveConfig("umbral_quiebre_pct",e.target.value)} style={{flex:1,accentColor:"#007AFF"}}/>
          <Bd c="#FF9500" bg="#FF950015" lg>{config.umbral_quiebre_pct||30}%</Bd>
        </div>
        <div style={{background:"#F2F2F7",borderRadius:10,padding:12,fontSize:12,color:"#8E8E93",lineHeight:1.6}}>Meses con venta menor al {config.umbral_quiebre_pct||30}% del máximo se excluyen del promedio para no subestimar la demanda real. Requiere al menos 2 meses normales para compensar.</div>
      </Cd>
    </div>}

    {configTab==="bsale"&&<BsaleConfig config={config} saveConfig={saveConfig} bsaleToken={bsaleToken} setBsaleToken={setBsaleToken} saveBsale={saveBsale} loadAll={loadAll}/>}

    {configTab==="provs"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontSize:15,fontWeight:700}}>Proveedores ({provs.length})</div><Bt v="pri" sm onClick={()=>{setProvForm({id:"",nombre:"",tipo:"Nacional",condicion_pago:"Contado",encargado:"",correo:"",activo:true,pct_fabricacion:0,pct_embarque:0,pct_puerto:0});setEditing(null);setShowProvForm(true)}} ic="➕">Nuevo</Bt></div>
      {provs.map(s=><Cd key={s.id} s={{marginBottom:6,opacity:s.activo?1:0.5}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}>
          <div><div style={{fontSize:14,fontWeight:600}}>{s.nombre}</div><div style={{fontSize:12,color:"#8E8E93"}}>{s.encargado}{s.correo?` · ${s.correo}`:""}</div><div style={{display:"flex",gap:4,marginTop:4}}><Bd c={s.tipo==="Importación"?"#FF3B30":"#007AFF"} bg={s.tipo==="Importación"?"#FF3B3015":"#007AFF15"}>{s.tipo}</Bd><Bd>{s.condicion_pago}</Bd>{s.pct_fabricacion>0&&<Bd c="#FF9500" bg="#FF950015">{s.pct_fabricacion}%+{s.pct_embarque}%+{s.pct_puerto}%</Bd>}</div></div>
          <div style={{display:"flex",gap:4}}><Bt sm v="gry" onClick={()=>{setProvForm({...s});setEditing(s.id);setShowProvForm(true)}}>✏️</Bt><Bt sm v="gry" onClick={async()=>{await supabase.from('proveedores').update({activo:!s.activo}).eq('id',s.id);setProvs(p=>p.map(x=>x.id===s.id?{...x,activo:!x.activo}:x))}}>{s.activo?"🚫":"✅"}</Bt></div>
        </div>
      </Cd>)}
      <Sheet show={showProvForm} onClose={()=>setShowProvForm(false)} title={editing?"Editar proveedor":"Nuevo proveedor"}>
        <Fl l="Nombre" req><input value={provForm.nombre} onChange={e=>setProvForm({...provForm,nombre:e.target.value})} style={css.input}/></Fl>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Fl l="Tipo"><select value={provForm.tipo} onChange={e=>setProvForm({...provForm,tipo:e.target.value})} style={css.select}><option>Nacional</option><option>Importación</option></select></Fl>
          <Fl l="Condición pago"><select value={provForm.condicion_pago} onChange={e=>setProvForm({...provForm,condicion_pago:e.target.value})} style={css.select}><option>Contado</option><option>Crédito 30d</option><option>Crédito 60d</option><option>30%-35%-35%</option><option>15%-15%-70%</option><option>30%-0%-70%</option></select></Fl>
          <Fl l="Encargado"><input value={provForm.encargado||""} onChange={e=>setProvForm({...provForm,encargado:e.target.value})} style={css.input}/></Fl>
          <Fl l="Correo"><input value={provForm.correo||""} onChange={e=>setProvForm({...provForm,correo:e.target.value})} style={css.input}/></Fl>
        </div>
        {provForm.tipo==="Importación"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          <Fl l="% Fabricación"><input type="number" value={provForm.pct_fabricacion||0} onChange={e=>setProvForm({...provForm,pct_fabricacion:Number(e.target.value)})} style={css.input}/></Fl>
          <Fl l="% Embarque"><input type="number" value={provForm.pct_embarque||0} onChange={e=>setProvForm({...provForm,pct_embarque:Number(e.target.value)})} style={css.input}/></Fl>
          <Fl l="% Puerto"><input type="number" value={provForm.pct_puerto||0} onChange={e=>setProvForm({...provForm,pct_puerto:Number(e.target.value)})} style={css.input}/></Fl>
        </div>}
        <Bt v="pri" full dis={!provForm.nombre} onClick={saveProv} ic="💾">Guardar</Bt>
      </Sheet>
    </div>}

    {configTab==="users"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontSize:15,fontWeight:700}}>Usuarios ({users.length})</div><Bt v="pri" sm onClick={()=>{setUserForm({id:"",nombre:"",correo:"",rol:"analista",firma_digital:"",activo:true,avatar:""});setEditing(null);setShowUserForm(true)}} ic="➕">Nuevo</Bt></div>
      {users.map(u=>{const r=rl(u);return<Cd key={u.id} s={{marginBottom:6,opacity:u.activo?1:0.5}}>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <Av n={u.avatar} c={r.c} sz={42}/>
          <div style={{flex:1}}><div style={{fontSize:14,fontWeight:600}}>{u.nombre}</div><Bd c={r.c} bg={r.c+"20"} lg>{r.l}</Bd><div style={{fontSize:11,color:"#8E8E93",marginTop:3}}>{u.correo}</div><div style={{background:"#F2F2F7",borderRadius:6,padding:"4px 8px",marginTop:4,display:"inline-block"}}><span style={{fontSize:12,fontStyle:"italic",fontWeight:600,color:r.c}}>{u.firma_digital||u.nombre}</span></div></div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}><Bt sm v="gry" onClick={()=>{setUserForm({...u});setEditing(u.id);setShowUserForm(true)}}>✏️</Bt><Bt sm v="gry" onClick={async()=>{await supabase.from('usuarios').update({activo:!u.activo}).eq('id',u.id);setUsers(p=>p.map(x=>x.id===u.id?{...x,activo:!x.activo}:x))}}>{u.activo?"🚫":"✅"}</Bt></div>
        </div>
      </Cd>})}
      <Sheet show={showUserForm} onClose={()=>setShowUserForm(false)} title={editing?"Editar usuario":"Nuevo usuario"}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Fl l="Nombre" req><input value={userForm.nombre} onChange={e=>setUserForm({...userForm,nombre:e.target.value})} style={css.input}/></Fl>
          <Fl l="Correo" req><input value={userForm.correo} onChange={e=>setUserForm({...userForm,correo:e.target.value})} style={css.input}/></Fl>
          <Fl l="Rol"><select value={userForm.rol} onChange={e=>setUserForm({...userForm,rol:e.target.value})} style={css.select}>{ROLES.map(r=><option key={r.k} value={r.k}>{r.l}</option>)}</select></Fl>
          <Fl l="Firma digital"><input value={userForm.firma_digital||""} onChange={e=>setUserForm({...userForm,firma_digital:e.target.value})} style={{...css.input,fontStyle:"italic"}}/></Fl>
        </div>
        <Bt v="pri" full dis={!userForm.nombre||!userForm.correo} onClick={saveUser} ic="💾">Guardar</Bt>
      </Sheet>
    </div>}

    {/* PERMISOS TAB */}
    {configTab==="permisos"&&<div>
      <Cd><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>🔑 Matriz de permisos por rol</div>
        <div style={{fontSize:12,color:"#8E8E93",marginBottom:12}}>Cada rol tiene permisos específicos. Los administradores tienen acceso total.</div>
        <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:600}}>
          <thead><tr style={{background:"#F2F2F7"}}><th style={{padding:"8px",textAlign:"left",fontSize:10,fontWeight:700,color:"#8E8E93",borderBottom:"2px solid #E5E5EA"}}>Rol</th>
            {["Crear OC","Aprobar Neg.","Aprobar Fin.","Reg. Pago","Recibir","Cerrar OC","Config","Ver Dash","Ver Fin.","Gest. Prov.","Valid. Prov."].map(p=><th key={p} style={{padding:"8px 4px",textAlign:"center",fontSize:9,fontWeight:600,color:"#8E8E93",borderBottom:"2px solid #E5E5EA",whiteSpace:"nowrap"}}>{p}</th>)}
          </tr></thead>
          <tbody>{ROLES.map(r=><tr key={r.k} style={{borderBottom:"1px solid #F2F2F7"}}>
            <td style={{padding:"8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:8,height:8,borderRadius:4,background:r.c}}/><strong>{r.l}</strong></div></td>
            {["crear_oc","aprobar_neg","aprobar_fin","reg_pago","recibir","cerrar_oc","config","ver_dash","ver_fin","gest_prov","valid_prov"].map(p=><td key={p} style={{padding:"8px 4px",textAlign:"center"}}>{r.p.includes("todo")||r.p.includes(p)?<span style={{color:"#34C759",fontSize:14}}>✓</span>:<span style={{color:"#D1D1D6",fontSize:14}}>—</span>}</td>)}
          </tr>)}</tbody>
        </table></div>
      </Cd>

      <Cd s={{marginTop:10}}><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>👥 Asignación de administradores</div>
        <div style={{fontSize:12,color:"#8E8E93",marginBottom:10}}>Selecciona qué usuarios tienen rol de administrador (acceso total).</div>
        {users.map(u=>{const r=rl(u);const isAdm=u.rol==="admin"||u.rol==="dir_general"
          return<div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #F2F2F7"}}>
            <Av n={u.avatar} c={r.c} sz={32}/>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{u.nombre}</div><Bd c={r.c} bg={r.c+"18"}>{r.l}</Bd></div>
            <select value={u.rol} onChange={async e=>{const newRol=e.target.value;await supabase.from('usuarios').update({rol:newRol}).eq('id',u.id);setUsers(p=>p.map(x=>x.id===u.id?{...x,rol:newRol}:x))}} style={{...css.select,width:140,fontSize:12}}>
              {ROLES.map(r=><option key={r.k} value={r.k}>{r.l}</option>)}
            </select>
          </div>
        })}
      </Cd>
    </div>}
  </div>
}

/* ═══ BSALE CONFIG + SYNC ═══ */
function BsaleConfig({config,saveConfig,bsaleToken,setBsaleToken,saveBsale,loadAll}){
  const[syncing,setSyncing]=useState(false)
  const[testing,setTesting]=useState(false)
  const[result,setResult]=useState(null)
  const[testResult,setTestResult]=useState(null)
  const[logs,setLogs]=useState([])
  const[loadingSeed,setLoadingSeed]=useState(false)

  const addLog=(msg,type="info")=>setLogs(p=>[...p,{msg,type,time:new Date().toLocaleTimeString("es-CL")}])

  /* ═══ EXCEL UPLOAD — Process BSALE "Reposición de Stock" report ═══ */
  const processExcel=async(file)=>{
    setSyncing(true);setResult(null);setLogs([])
    addLog("Leyendo archivo Excel de BSALE...")
    try{
      const data=await file.arrayBuffer()
      const wb=XLSX.read(data,{type:'array'})
      // Find the sheet with data (usually sheet2 or the one with most rows)
      let ws=null;let maxRows=0
      for(const name of wb.SheetNames){const s=wb.Sheets[name];const r=XLSX.utils.sheet_to_json(s,{header:1});if(r.length>maxRows){maxRows=r.length;ws=s}}
      const rows=XLSX.utils.sheet_to_json(ws,{header:1})
      addLog(`📄 ${rows.length} filas en el archivo`)

      // Find header row (contains "Tipo de Producto" or "SKU")
      let headerIdx=-1
      for(let i=0;i<Math.min(rows.length,10);i++){const r=rows[i];if(r&&r.some(c=>String(c).includes("Tipo de Producto")||String(c).includes("SKU"))){headerIdx=i;break}}
      if(headerIdx<0){addLog("No se encontró la fila de encabezados","error");setSyncing(false);return}
      const headers=rows[headerIdx].map(h=>String(h||"").trim())
      addLog(`Encabezados en fila ${headerIdx+1}: ${headers.slice(0,8).join(", ")}...`)

      // Map columns
      const colMap={}
      headers.forEach((h,i)=>{
        const hl=h.toLowerCase()
        if(hl.includes("tipo de producto")||hl==="tipo producto")colMap.tipo=i
        else if(hl==="producto"||hl.includes("producto"))colMap.producto=colMap.producto||i
        else if(hl==="sku")colMap.sku=i
        else if(hl.includes("codigo de barras")||hl.includes("código"))colMap.barcode=i
        else if(hl.includes("sucursal")&&!hl.includes("nombre"))colMap.sucursal=i
        else if(hl.includes("nombre sucursal"))colMap.nombreSuc=i
        else if(hl.includes("vendida")&&hl.includes("enero"))colMap.m1=i
        else if(hl.includes("vendida")&&hl.includes("febrero"))colMap.m2=i
        else if(hl.includes("vendida")&&hl.includes("marzo"))colMap.m3=i
        else if(hl.includes("vendida")&&hl.includes("abril"))colMap.m4=i
        else if(hl==="stock actual"||hl.includes("stock actual"))colMap.stock=i
        else if(hl.includes("valor total"))colMap.valorStock=i
        else if(hl.includes("venta bruta")||hl.includes("total venta"))colMap.ventaBruta=i
      })
      // Also check for generic month patterns
      headers.forEach((h,i)=>{const hl=h.toLowerCase();if(!colMap.m1&&hl.includes("unidades")&&hl.includes("1"))colMap.m1=i;if(!colMap.m2&&hl.includes("unidades")&&hl.includes("2"))colMap.m2=i})

      addLog(`Columnas mapeadas: tipo=${colMap.tipo}, sku=${colMap.sku}, stock=${colMap.stock}, m1=${colMap.m1}, m2=${colMap.m2}, m3=${colMap.m3}, m4=${colMap.m4}`)

      // Parse data rows and CONSOLIDATE by SKU (sum across sucursales)
      const skuMap={}
      let dataRows=0
      for(let i=headerIdx+1;i<rows.length;i++){
        const r=rows[i];if(!r||!r[colMap.sku])continue
        const sku=String(r[colMap.sku]).trim();if(!sku)continue
        dataRows++
        if(!skuMap[sku]){
          skuMap[sku]={sku,producto:String(r[colMap.producto]||"").trim(),tipo_producto:String(r[colMap.tipo]||"Sin Tipo").trim(),codigo_barras:String(r[colMap.barcode]||"").trim(),stock_actual:0,venta_mes_1:0,venta_mes_2:0,venta_mes_3:0,venta_mes_4:0,costo_stock:0,venta_bruta_total:0}
        }
        const p=skuMap[sku]
        p.stock_actual+=Number(r[colMap.stock])||0
        p.venta_mes_1+=Number(r[colMap.m1])||0
        p.venta_mes_2+=Number(r[colMap.m2])||0
        p.venta_mes_3+=Number(r[colMap.m3])||0
        p.venta_mes_4+=Number(r[colMap.m4])||0
        p.costo_stock+=Number(r[colMap.valorStock])||0
        p.venta_bruta_total+=Number(r[colMap.ventaBruta])||0
      }
      const prodList=Object.values(skuMap)
      addLog(`✅ ${dataRows} filas procesadas → ${prodList.length} SKUs consolidados`,"success")

      // Get params
      const{data:pTypes}=await supabase.from('parametros_tipo').select('*')
      const{data:pABCD}=await supabase.from('parametros_abcd').select('*')
      const umbral=(Number(config.umbral_quiebre_pct)||30)/100

      // Calculate venta_total and sort for ABCD
      for(const p of prodList){p.venta_total=p.venta_mes_1+p.venta_mes_2+p.venta_mes_3+p.venta_mes_4}
      const grandTotal=prodList.reduce((s,p)=>s+p.venta_total,0)
      prodList.sort((a,b)=>b.venta_total-a.venta_total)

      // ABCD Classification by sales participation
      let acum=0;const abcdC={A:0,B:0,C:0,D:0}
      for(const p of prodList){
        const part=grandTotal>0?p.venta_total/grandTotal:0;acum+=part
        p.pct_participacion=Math.round(part*10000)/10000;p.pct_acumulado=Math.round(acum*10000)/10000
        p.clasif_abcd=p.venta_total===0?"D":acum<=0.8?"A":acum<=0.95?"B":acum<=0.99?"C":"D"
        abcdC[p.clasif_abcd]++
      }
      addLog(`📈 Clasificación: A:${abcdC.A} B:${abcdC.B} C:${abcdC.C} D:${abcdC.D}`,"success")

      // Replenishment algorithm
      addLog("Ejecutando algoritmo de reposición...")
      let reposCount=0
      for(const p of prodList){
        const tp=(pTypes||[]).find(t=>t.tipo_producto===p.tipo_producto)||{dias_fabricacion:30,periodo_cobertura:90}
        const abcd=(pABCD||[]).find(a=>a.clasificacion===p.clasif_abcd)||{dias_emergencia:5}
        p.dias_fabricacion=tp.dias_fabricacion;p.periodo_cubrir=tp.periodo_cobertura;p.dias_emergencia=abcd.dias_emergencia

        const sales=[p.venta_mes_1,p.venta_mes_2,p.venta_mes_3,p.venta_mes_4].filter((_,i)=>i<(Number(config.meses_analisis)||4))
        const maxMens=Math.max(...sales,0);p.max_mensual=maxMens;p.umbral_quiebre=Math.round(maxMens*umbral)
        const normalM=sales.filter(s=>s>=maxMens*umbral);const breakM=sales.filter(s=>s>0&&s<maxMens*umbral)
        p.meses_quiebre=breakM.length

        if(maxMens===0){p.vta_prom_compensada=0;p.vta_prom_raw=0;p.factor_compensacion=1}
        else if(breakM.length>0&&normalM.length>=2){
          p.vta_prom_compensada=Math.round(normalM.reduce((s,x)=>s+x,0)/normalM.length)
          p.vta_prom_raw=Math.round(p.venta_total/sales.filter(s=>s>0).length||0)
          p.factor_compensacion=p.vta_prom_raw>0?Math.round(p.vta_prom_compensada/p.vta_prom_raw*1000)/1000:1
        }else{
          const nz=sales.filter(s=>s>0)
          p.vta_prom_compensada=nz.length>0?Math.round(nz.reduce((s,x)=>s+x,0)/nz.length):0
          p.vta_prom_raw=p.vta_prom_compensada;p.factor_compensacion=1
        }
        p.vta_prom_diaria=Math.round(p.vta_prom_compensada/30*100)/100
        p.punto_reorden=Math.round(p.vta_prom_diaria*(p.dias_fabricacion+p.dias_emergencia))
        p.dias_cobertura=p.vta_prom_diaria>0?Math.round(p.stock_actual/p.vta_prom_diaria*10)/10:(p.stock_actual>0?999:0)
        p.reposicion_necesaria=Math.max(0,Math.round((p.vta_prom_diaria*p.periodo_cubrir)+p.punto_reorden-p.stock_actual))
        p.costo_unitario=p.stock_actual>0?Math.round(p.costo_stock/p.stock_actual):0
        p.costo_reposicion=p.reposicion_necesaria*p.costo_unitario

        if(p.venta_total===0&&p.stock_actual===0)p.estado="Revisar"
        else if(p.venta_total===0)p.estado="Sin ventas"
        else if(p.reposicion_necesaria>0)p.estado="Reposición"
        else p.estado="Stock suficiente"
        if(p.estado==="Reposición")reposCount++
      }
      addLog(`⚠️ ${reposCount} productos requieren reposición`,"warn")

      // Upsert to Supabase
      let saved=0
      for(let i=0;i<prodList.length;i+=200){
        const batch=prodList.slice(i,i+200)
        const{error}=await supabase.from('productos').upsert(batch,{onConflict:'sku'})
        if(error){addLog(`Error lote ${i}: ${error.message}`,"error")}else{saved+=batch.length}
      }
      addLog(`💾 ${saved} productos guardados`,"success")
      const invR=prodList.filter(p=>p.estado==="Reposición").reduce((s,p)=>s+(p.costo_reposicion||0),0)
      setResult({ok:true,productos_procesados:prodList.length,clase_A:abcdC.A,clase_B:abcdC.B,clase_C:abcdC.C,clase_D:abcdC.D,requieren_reposicion:reposCount,inversion_reposicion:invR})
      await saveConfig("bsale_activo","true");await saveConfig("ultima_sincronizacion",new Date().toISOString())
      addLog("✅ Análisis completo — datos actualizados automáticamente","success")
      if(loadAll)await loadAll()
    }catch(e){addLog(`❌ Error: ${e.message}`,"error");setResult({ok:false,error:e.message})}
    setSyncing(false)
  }

  const testConnection=async()=>{
    setTesting(true);setTestResult(null)
    try{
      const r=await fetch('https://api.bsale.cl/v1/products.json?limit=1',{headers:{'access_token':bsaleToken}})
      if(r.ok){const d=await r.json();setTestResult({ok:true,msg:`Conexión OK — ${d.count} productos en BSALE`});await saveBsale()}
      else setTestResult({ok:false,msg:'Token inválido — verifica en BSALE → Configuración → API'})
    }catch(e){setTestResult({ok:false,msg:'Error de conexión: '+e.message})}
    setTesting(false)
  }

  const fullSync=async()=>{
    setSyncing(true);setResult(null);setLogs([])
    addLog("Iniciando sincronización con BSALE...")
    try{
      // 1. Products with variants
      addLog("Descargando productos y variantes...")
      let allProds=[];let offset=0;let more=true
      while(more){const r=await fetch(`https://api.bsale.cl/v1/products.json?limit=50&offset=${offset}&expand=[variants,product_type]`,{headers:{'access_token':bsaleToken}});if(!r.ok){addLog(`Error HTTP ${r.status}`,"error");break};const d=await r.json();allProds.push(...(d.items||[]));offset+=50;more=(d.items||[]).length===50&&offset<(d.count||0);await new Promise(r=>setTimeout(r,200))}
      addLog(`✅ ${allProds.length} productos`,"success")

      // 2. Stock with variant expand
      addLog("Descargando stock actual...")
      let allStock=[];offset=0;more=true
      while(more){const r=await fetch(`https://api.bsale.cl/v1/stocks.json?limit=50&offset=${offset}&expand=[variant]`,{headers:{'access_token':bsaleToken}});if(!r.ok)break;const d=await r.json();allStock.push(...(d.items||[]));offset+=50;more=(d.items||[]).length===50&&offset<(d.count||0);await new Promise(r=>setTimeout(r,200))}
      addLog(`✅ ${allStock.length} registros de stock`,"success")

      // 3. Sales (consumptions) - last 4 months
      const meses=Number(config.meses_analisis)||4
      addLog(`Descargando ventas últimos ${meses} meses...`)
      const salesByVariant={}
      const now=new Date()
      for(let m=0;m<meses;m++){
        const d=new Date(now.getFullYear(),now.getMonth()-m-1,1)
        const from=d.toISOString().slice(0,10)
        const to=new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10)
        addLog(`  Mes ${m+1}: ${from} a ${to}`)
        let off2=0;let more2=true
        while(more2){
          const r=await fetch(`https://api.bsale.cl/v1/stocks/consumptions.json?limit=50&offset=${off2}&consumptiondate=${from}&expand=[variant]`,{headers:{'access_token':bsaleToken}})
          if(!r.ok)break;const dd=await r.json();const items=dd.items||[]
          for(const it of items){
            const vid=it.variant?.id||it.variantId
            if(!vid)continue
            if(!salesByVariant[vid])salesByVariant[vid]=[]
            if(!salesByVariant[vid][m])salesByVariant[vid][m]=0
            salesByVariant[vid][m]+=(it.quantity||0)
          }
          off2+=50;more2=items.length===50;await new Promise(r=>setTimeout(r,150))
        }
      }
      addLog(`✅ Ventas de ${Object.keys(salesByVariant).length} variantes`,"success")

      // 4. Params
      const{data:pTypes}=await supabase.from('parametros_tipo').select('*')
      const{data:pABCD}=await supabase.from('parametros_abcd').select('*')
      const umbral=(Number(config.umbral_quiebre_pct)||30)/100

      addLog("Ejecutando algoritmo de reposición...")

      // 5. Stock map
      const stockMap={}
      for(const s of allStock){const vid=s.variant?.id||s.variantId;if(vid){stockMap[vid]=(stockMap[vid]||0)+(s.quantityAvailable||s.quantity||0)}}

      // 6. Build products with sales
      const prodList=[]
      for(const p of allProds){
        for(const v of (p.variants?.items||[])){
          const sku=v.barCode||v.code||String(v.id)
          if(!sku)continue
          const typeName=p.product_type?.name||'Sin Tipo'
          const stockActual=Math.round(stockMap[v.id]||0)
          const tp=(pTypes||[]).find(t=>t.tipo_producto===typeName)||{dias_fabricacion:30,periodo_cobertura:90}
          const costoUnit=Math.round(v.averageCost||v.unitValue||0)
          const monthlySales=salesByVariant[v.id]||[]
          const ventaTotal=monthlySales.reduce((s,x)=>s+(x||0),0)
          prodList.push({sku,producto:v.description||p.name||sku,codigo_barras:v.barCode||"",tipo_producto:typeName,stock_actual:stockActual,costo_unitario:costoUnit,dias_fabricacion:tp.dias_fabricacion,periodo_cubrir:tp.periodo_cobertura,venta_total:ventaTotal,_sales:monthlySales,venta_mes_1:monthlySales[0]||0,venta_mes_2:monthlySales[1]||0,venta_mes_3:monthlySales[2]||0,venta_mes_4:monthlySales[3]||0})
        }
      }

      // 7. ABCD by sales participation (like Excel)
      const grandTotal=prodList.reduce((s,p)=>s+p.venta_total,0)
      prodList.sort((a,b)=>b.venta_total-a.venta_total)
      let acum=0;const abcdC={A:0,B:0,C:0,D:0}
      for(const p of prodList){
        const part=grandTotal>0?p.venta_total/grandTotal:0
        acum+=part
        p.pct_participacion=part;p.pct_acumulado=acum
        p.clasif_abcd=p.venta_total===0?"D":acum<=0.8?"A":acum<=0.95?"B":acum<=0.99?"C":"D"
        abcdC[p.clasif_abcd]++
      }
      addLog(`📈 A:${abcdC.A} B:${abcdC.B} C:${abcdC.C} D:${abcdC.D}`,"success")

      // 8. Replenishment algorithm (same as Excel)
      let reposCount=0
      for(const p of prodList){
        const abcd=(pABCD||[]).find(a=>a.clasificacion===p.clasif_abcd)||{dias_emergencia:5}
        p.dias_emergencia=abcd.dias_emergencia
        const sales=p._sales||[]
        const maxMens=Math.max(...sales,0)
        p.max_mensual=maxMens
        p.umbral_quiebre=maxMens*umbral
        // Detect breaks: months with sales < threshold AND at least 2 normal months
        const normalM=sales.filter(s=>s>=p.umbral_quiebre)
        const breakM=sales.filter(s=>s>0&&s<p.umbral_quiebre)
        p.meses_quiebre=breakM.length
        // Compensated average
        if(maxMens===0){p.vta_prom_compensada=0;p.vta_prom_raw=0;p.factor_compensacion=1}
        else if(breakM.length>0&&normalM.length>=2){
          p.vta_prom_compensada=normalM.reduce((s,x)=>s+x,0)/normalM.length
          p.vta_prom_raw=p.venta_total/sales.filter(s=>s>0).length||0
          p.factor_compensacion=p.vta_prom_raw>0?p.vta_prom_compensada/p.vta_prom_raw:1
        }else{
          const nonZero=sales.filter(s=>s>0)
          p.vta_prom_compensada=nonZero.length>0?nonZero.reduce((s,x)=>s+x,0)/nonZero.length:0
          p.vta_prom_raw=p.vta_prom_compensada;p.factor_compensacion=1
        }
        p.vta_prom_diaria=p.vta_prom_compensada/30
        p.punto_reorden=p.vta_prom_diaria*(p.dias_fabricacion+p.dias_emergencia)
        p.dias_cobertura=p.vta_prom_diaria>0?p.stock_actual/p.vta_prom_diaria:p.stock_actual>0?999:0
        p.reposicion_necesaria=Math.max(0,Math.round((p.vta_prom_diaria*p.periodo_cubrir)+p.punto_reorden-p.stock_actual))
        p.costo_reposicion=p.reposicion_necesaria*p.costo_unitario
        // Estado
        if(p.venta_total===0&&p.stock_actual===0)p.estado="Revisar"
        else if(p.venta_total===0)p.estado="Sin ventas"
        else if(p.reposicion_necesaria>0)p.estado="Reposición"
        else p.estado="Stock suficiente"
        if(p.estado==="Reposición")reposCount++
        delete p._sales
      }
      addLog(`⚠️ ${reposCount} productos requieren reposición`,"success")

      // 9. Upsert
      let saved=0
      for(let i=0;i<prodList.length;i+=200){
        const batch=prodList.slice(i,i+200)
        const{error}=await supabase.from('productos').upsert(batch,{onConflict:'sku'})
        if(error){addLog(`Error lote ${i}: ${error.message}`,"error")}else{saved+=batch.length}
      }
      addLog(`💾 ${saved} productos guardados`,"success")
      const invR=prodList.filter(p=>p.estado==="Reposición").reduce((s,p)=>s+(p.costo_reposicion||0),0)
      setResult({ok:true,productos_procesados:prodList.length,clase_A:abcdC.A,clase_B:abcdC.B,clase_C:abcdC.C,clase_D:abcdC.D,requieren_reposicion:reposCount,inversion_reposicion:invR})
      await saveConfig("bsale_activo","true");await saveConfig("ultima_sincronizacion",new Date().toISOString())
      addLog("✅ Sincronización completa — ve a Reposición","success")
    }catch(e){addLog(`❌ Error: ${e.message}`,"error");setResult({ok:false,error:e.message})}
    setSyncing(false)
  }

  const loadSeedData=async()=>{
    setLoadingSeed(true)
    addLog("Cargando datos de muestra...")
    const seedProducts=[
      {sku:"72841438986666",producto:"SIDING PANEL SZG-A008",tipo_producto:"REVESTIMIENTOS",clasif_abcd:"A",stock_actual:1027,punto_reorden:6176,reposicion_necesaria:9781,estado:"Reposición",costo_unitario:5591,costo_reposicion:54686733,vta_prom_compensada:1544,vta_prom_diaria:51.5,dias_cobertura:20,dias_fabricacion:90,dias_emergencia:30,periodo_cubrir:90},
      {sku:"AF2401",producto:"PISO FLOTANTE 8MM AF2401",tipo_producto:"PISOS",clasif_abcd:"A",stock_actual:558,punto_reorden:3627,reposicion_necesaria:5789,estado:"Reposición",costo_unitario:7049,costo_reposicion:40807854,vta_prom_compensada:907,vta_prom_diaria:30.2,dias_cobertura:18.5,dias_fabricacion:90,dias_emergencia:30,periodo_cubrir:90},
      {sku:"72900072411084",producto:"PUERTA INT. 2DA SELEC.",tipo_producto:"PTA INTERIOR 2DA",clasif_abcd:"A",stock_actual:2116,punto_reorden:3259,reposicion_necesaria:4977,estado:"Reposición",costo_unitario:7338,costo_reposicion:36523679,vta_prom_compensada:1917,vta_prom_diaria:63.9,dias_cobertura:33,dias_fabricacion:21,dias_emergencia:30,periodo_cubrir:60},
      {sku:"MDP-70-30-P1",producto:"MARCO PUERTA 70X30",tipo_producto:"MARCO DE PUERTA",clasif_abcd:"A",stock_actual:576,punto_reorden:2575,reposicion_necesaria:5861,estado:"Reposición",costo_unitario:5592,costo_reposicion:32773319,vta_prom_compensada:1287,vta_prom_diaria:42.9,dias_cobertura:13.4,dias_fabricacion:30,dias_emergencia:30,periodo_cubrir:90},
      {sku:"71302636894230",producto:"PANEL UV CIELADA",tipo_producto:"REVESTIMIENTOS",clasif_abcd:"A",stock_actual:2,punto_reorden:2038,reposicion_necesaria:3565,estado:"Reposición",costo_unitario:7579,costo_reposicion:27019135,vta_prom_compensada:510,vta_prom_diaria:17,dias_cobertura:0.1,dias_fabricacion:90,dias_emergencia:30,periodo_cubrir:90},
      {sku:"74861795575857",producto:"SIDING LZG-701 GRIS",tipo_producto:"REVESTIMIENTOS",clasif_abcd:"A",stock_actual:2,punto_reorden:2442,reposicion_necesaria:4272,estado:"Reposición",costo_unitario:5632,costo_reposicion:24059904,vta_prom_compensada:611,vta_prom_diaria:20.4,dias_cobertura:0.1,dias_fabricacion:90,dias_emergencia:30,periodo_cubrir:90},
      {sku:"70557659698217",producto:"PTA EXT. ITALIA 80X200",tipo_producto:"PTA EXTERIOR 1ERA",clasif_abcd:"B",stock_actual:57,punto_reorden:188,reposicion_necesaria:469,estado:"Reposición",costo_unitario:44502,costo_reposicion:20871413,vta_prom_compensada:113,vta_prom_diaria:3.8,dias_cobertura:15.2,dias_fabricacion:30,dias_emergencia:20,periodo_cubrir:90},
      {sku:"PIN-SINFO-P1",producto:"PTA INT. SINFONIA 75X200",tipo_producto:"PTA INTERIOR 1RA",clasif_abcd:"A",stock_actual:83,punto_reorden:463,reposicion_necesaria:1197,estado:"Reposición",costo_unitario:16915,costo_reposicion:20246894,vta_prom_compensada:272,vta_prom_diaria:9.1,dias_cobertura:9.1,dias_fabricacion:21,dias_emergencia:30,periodo_cubrir:90},
      {sku:"71293677477431",producto:"WALL PANEL CS-075",tipo_producto:"REVESTIMIENTOS",clasif_abcd:"A",stock_actual:7,punto_reorden:4305,reposicion_necesaria:7527,estado:"Reposición",costo_unitario:1887,costo_reposicion:14203449,vta_prom_compensada:1076,vta_prom_diaria:35.9,dias_cobertura:0.2,dias_fabricacion:90,dias_emergencia:30,periodo_cubrir:90},
      {sku:"72841451018545",producto:"PERFIL SIDING J CCB-602",tipo_producto:"PERFIL SIDING",clasif_abcd:"A",stock_actual:45,punto_reorden:1861,reposicion_necesaria:3212,estado:"Reposición",costo_unitario:2871,costo_reposicion:9221652,vta_prom_compensada:465,vta_prom_diaria:15.5,dias_cobertura:2.9,dias_fabricacion:90,dias_emergencia:30,periodo_cubrir:90},
      {sku:"72740712358990",producto:"ESPUMA NIVELADORA 10M",tipo_producto:"PISOS",clasif_abcd:"A",stock_actual:397,punto_reorden:2903,reposicion_necesaria:4683,estado:"Reposición",costo_unitario:2110,costo_reposicion:9883395,vta_prom_compensada:726,vta_prom_diaria:24.2,dias_cobertura:16.4,dias_fabricacion:90,dias_emergencia:30,periodo_cubrir:90},
    ]
    const{error}=await supabase.from('productos').upsert(seedProducts,{onConflict:'sku'})
    if(error){addLog(`❌ Error: ${error.message}`,"error")}
    else{addLog(`✅ ${seedProducts.length} productos cargados — ve a Reposición para verlos`,"success")}
    setLoadingSeed(false)
  }

  return<div>
    <Cd><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>🔗 Conexión BSALE</div>
      <div style={{background:config.bsale_activo==="true"?"#34C75915":"#FF3B3015",borderRadius:10,padding:12,marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:10,height:10,borderRadius:5,background:config.bsale_activo==="true"?"#34C759":"#FF3B30"}}/>
        <span style={{fontSize:13,fontWeight:600,color:config.bsale_activo==="true"?"#34C759":"#FF3B30"}}>{config.bsale_activo==="true"?"Conectado":"Desconectado"}</span>
      </div>

      <Fl l="Access Token de BSALE"><input type="password" value={bsaleToken} onChange={e=>setBsaleToken(e.target.value)} placeholder="Pegar token de BSALE aquí..." style={css.input}/></Fl>
      <div style={{fontSize:12,color:"#8E8E93",marginBottom:12,lineHeight:1.6}}>El token se obtiene desde BSALE → Configuración → API. Es único por usuario.</div>

      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <Bt v="pri" onClick={testConnection} dis={!bsaleToken||testing} ic="🔍">{testing?"Probando...":"Probar conexión"}</Bt>
        <Bt v="suc" onClick={fullSync} dis={!bsaleToken||syncing} ic="🔄">{syncing?"Sincronizando...":"Sincronizar API"}</Bt>
      </div>

      {testResult&&<div style={{background:testResult.ok?"#34C75915":"#FF3B3015",borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:600,color:testResult.ok?"#34C759":"#FF3B30"}}>{testResult.ok?"✓":"✕"} {testResult.msg}</div>
      </div>}
    </Cd>

    <Cd s={{marginTop:10}}><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>📄 Cargar reporte Excel de BSALE</div>
      <div style={{fontSize:12,color:"#8E8E93",marginBottom:12,lineHeight:1.6}}>Sube el archivo Excel del reporte <strong>"Reposición de Stock"</strong> de BSALE. Debe incluir: Tipo de Producto, Producto, SKU, ventas mensuales, Stock Actual. El sistema consolida las sucursales, aplica clasificación ABCD, compensación de quiebres, y calcula la reposición necesaria.</div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <label style={{...css.btn,padding:"12px 20px",borderRadius:12,fontSize:14,fontWeight:600,background:"#007AFF",color:"#fff",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6}}>
          <span>📤</span> Subir Excel de BSALE
          <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f)processExcel(f);e.target.value=""}} disabled={syncing}/>
        </label>
        {syncing&&<span style={{fontSize:13,color:"#FF9500",fontWeight:600}}>Procesando...</span>}
      </div>
    </Cd>

    {logs.length>0&&<Cd s={{marginTop:10}}>
      <div style={{fontSize:13,fontWeight:700,marginBottom:8}}>Log de sincronización</div>
      <div style={{maxHeight:300,overflow:"auto",background:"#1C1C1E",borderRadius:10,padding:12}}>
        {logs.map((l,i)=><div key={i} style={{fontSize:12,fontFamily:"monospace",color:l.type==="error"?"#FF6B6B":l.type==="success"?"#69DB7C":l.type==="warn"?"#FFD43B":"#CED4DA",padding:"3px 0",lineHeight:1.5}}>
          <span style={{color:"#868E96",marginRight:8}}>{l.time}</span>{l.msg}
        </div>)}
      </div>
    </Cd>}

    {result&&result.ok&&<Cd ac="#34C759" s={{marginTop:10}}>
      <div style={{fontSize:15,fontWeight:700,marginBottom:8,color:"#34C759"}}>✓ Sincronización completa</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8}}>
        {[["Productos",result.productos_procesados],["Clase A",result.clase_A],["Clase B",result.clase_B],["Requieren OC",result.requieren_reposicion],["Inversión",fmt(result.inversion_reposicion)]].map(([l,v],i)=>
          <div key={i} style={{background:"#F2F2F7",borderRadius:8,padding:"8px 10px",textAlign:"center"}}><div style={{fontSize:10,color:"#8E8E93"}}>{l}</div><div style={{fontSize:16,fontWeight:700}}>{v}</div></div>
        )}
      </div>
    </Cd>}

    <Cd s={{marginTop:10}}>
      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>📋 Datos que se extraen de BSALE</div>
      <div style={{fontSize:12,color:"#8E8E93",lineHeight:1.8}}>
        • <strong>Productos y variantes</strong> — catálogo completo con SKU, código de barras, tipo<br/>
        • <strong>Stock actual</strong> — por sucursal y bodega, disponible y reservado<br/>
        • <strong>Consumos/ventas</strong> — últimos {config.meses_analisis||4} meses para calcular promedios<br/>
        • Se aplica el algoritmo de <strong>venta promedio compensada</strong> (excluye meses de quiebre)<br/>
        • Clasificación <strong>ABCD</strong> automática por participación en ventas<br/>
        • Cálculo de <strong>punto de reorden</strong> y <strong>cantidad a reponer</strong> según parámetros configurados
      </div>
    </Cd>

    <Cd s={{marginTop:10}}>
      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>⚡ Cargar datos de muestra</div>
      <div style={{fontSize:12,color:"#8E8E93",marginBottom:10,lineHeight:1.6}}>Si aún no tienes el token de BSALE o quieres probar la app primero, carga 11 productos reales de muestra con datos de reposición pre-calculados.</div>
      <Bt v="amb" onClick={loadSeedData} dis={loadingSeed} ic="📦">{loadingSeed?"Cargando...":"Cargar 11 productos de muestra"}</Bt>
    </Cd>

    <Cd s={{marginTop:10}}>
      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>🚀 Deploy con funciones serverless</div>
      <div style={{fontSize:12,color:"#8E8E93",lineHeight:1.8}}>
        Para que la sincronización automática funcione, necesitas desplegar desde <strong>Git</strong> (no drag-and-drop):<br/>
        1. Descomprime <strong>outlet_source_v2.zip</strong><br/>
        2. Crea un repositorio en <strong>GitHub</strong> y sube los archivos<br/>
        3. En Netlify → <strong>Add new site → Import from Git</strong><br/>
        4. Selecciona tu repo → Netlify detecta la config automáticamente<br/>
        5. Agrega las variables <strong>VITE_SUPABASE_URL</strong> y <strong>VITE_SUPABASE_ANON_KEY</strong><br/>
        6. Deploy → las funciones serverless se activan automáticamente
      </div>
    </Cd>
  </div>
}
