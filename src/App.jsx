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

/* ═══ LOGIN SCREEN ═══ */
function LoginScreen({onLogin,users}){
  const[email,setEmail]=useState("")
  const[pass,setPass]=useState("")
  const[err,setErr]=useState("")
  const[loading,setLoading]=useState(false)
  const[mode,setMode]=useState("quick")

  const quickLogin=(user)=>{onLogin(user)}
  const authLogin=async()=>{
    setLoading(true);setErr("")
    const{data,error}=await signIn(email,pass)
    if(error){setErr(error.message);setLoading(false);return}
    const u=users.find(x=>x.correo===email)
    if(u){onLogin(u)}else{setErr("Usuario no registrado en el sistema");setLoading(false)}
  }

  return<div style={{minHeight:"100vh",background:"linear-gradient(135deg,#667eea 0%,#764ba2 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{width:"100%",maxWidth:400}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{fontSize:42,fontWeight:800,color:"#fff",letterSpacing:"-0.04em",marginBottom:4}}>Outlet de Puertas</div>
        <div style={{fontSize:15,color:"rgba(255,255,255,0.7)",fontWeight:500}}>Sistema de Compras y Abastecimiento</div>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.5)",marginTop:4}}>SOP P07 v2.0</div>
      </div>
      <div style={{background:"#fff",borderRadius:24,padding:28,boxShadow:"0 20px 60px rgba(0,0,0,0.15)"}}>
        <div style={{display:"flex",gap:4,marginBottom:20,background:"#F2F2F7",borderRadius:10,padding:3}}>
          <button onClick={()=>setMode("quick")} style={{flex:1,padding:"8px",borderRadius:8,fontSize:13,fontWeight:600,border:"none",cursor:"pointer",background:mode==="quick"?"#fff":"transparent",color:mode==="quick"?"#1C1C1E":"#8E8E93",boxShadow:mode==="quick"?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>Acceso rápido</button>
          <button onClick={()=>setMode("auth")} style={{flex:1,padding:"8px",borderRadius:8,fontSize:13,fontWeight:600,border:"none",cursor:"pointer",background:mode==="auth"?"#fff":"transparent",color:mode==="auth"?"#1C1C1E":"#8E8E93",boxShadow:mode==="auth"?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>Email + Clave</button>
        </div>

        {mode==="quick"?<div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div style={{fontSize:13,color:"#8E8E93",marginBottom:4}}>Selecciona tu perfil</div>
          {users.map(u=>{const r=rl(u);return<button key={u.id} onClick={()=>quickLogin(u)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderRadius:14,border:"1px solid #E5E5EA",background:"#FAFAFA",cursor:"pointer",transition:"all 0.2s",textAlign:"left"}} onMouseOver={e=>e.currentTarget.style.background="#F2F2F7"} onMouseOut={e=>e.currentTarget.style.background="#FAFAFA"}>
            <Av n={u.avatar} c={r.c} sz={40}/>
            <div style={{flex:1}}><div style={{fontSize:15,fontWeight:600,color:"#1C1C1E"}}>{u.nombre}</div><div style={{fontSize:12,color:r.c,fontWeight:600}}>{r.l}</div></div>
            <div style={{color:"#C7C7CC",fontSize:18}}>›</div>
          </button>})}
        </div>:<div>
          <Fl l="Correo electrónico"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="usuario@outletdepuertas.cl" style={css.input}/></Fl>
          <Fl l="Contraseña"><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" style={css.input} onKeyDown={e=>e.key==="Enter"&&authLogin()}/></Fl>
          {err&&<div style={{color:"#FF3B30",fontSize:12,marginBottom:12,padding:"8px 12px",background:"#FF3B3010",borderRadius:8}}>{err}</div>}
          <Bt v="pri" full dis={!email||!pass||loading} onClick={authLogin}>{loading?"Ingresando...":"Ingresar"}</Bt>
          <div style={{fontSize:11,color:"#AEAEB2",textAlign:"center",marginTop:12}}>Para crear cuentas con contraseña, configura Supabase Auth en tu proyecto</div>
        </div>}
      </div>
    </div>
  </div>
}

/* ═══ MAIN APP ═══ */
const TABS=[{k:"monitor",l:"Monitor",ic:"📊"},{k:"repo",l:"Reposición",ic:"📦"},{k:"transito",l:"Tránsito",ic:"🚚"},{k:"nueva",l:"Nueva OC",ic:"➕"},{k:"ordenes",l:"Órdenes",ic:"📋"},{k:"config",l:"Config",ic:"⚙️"}]

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
        <div><div style={{fontSize:26,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.03em"}}>Outlet de Puertas</div><div style={{fontSize:13,color:rd.c,fontWeight:600}}>{rd.l} — {cu.nombre}</div></div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <select value={cu.id} onChange={e=>setCu(users.find(u=>u.id===e.target.value))} style={{fontSize:11,padding:"6px 8px",borderRadius:8,border:"1px solid #E5E5EA",background:"#fff"}}>{users.map(u=><option key={u.id} value={u.id}>{u.nombre}</option>)}</select>
          <button onClick={()=>setCu(null)} style={{width:32,height:32,borderRadius:16,background:"#FF3B3015",border:"none",cursor:"pointer",fontSize:13,color:"#FF3B30"}}>⏻</button>
        </div>
      </div>
    </div>

    {/* CONTENT */}
    {tab==="monitor"&&<MonitorView ocs={ocs} prods={prodsWithTransit} h={h}/>}
    {tab==="repo"&&<RepoView prods={prodsWithTransit} cart={cart} setCart={setCart} go={()=>setTab("nueva")} config={config} params={params} paramsABCD={paramsABCD}/>}
    {tab==="transito"&&<TransitoView ocs={ocs} provs={provs}/>}
    {tab==="nueva"&&<SolView cart={cart} setCart={setCart} provs={provs} users={users} cu={cu} setOcs={setOcs} addFirma={addFirma} goOC={()=>setTab("ordenes")}/>}
    {tab==="ordenes"&&<OCListView ocs={ocs} firmas={firmas} pagos={pagos} updOC={updOC} addFirma={addFirma} setDet={setDet} cu={cu} h={h} provs={provs} setOcs={setOcs}/>}
    {tab==="config"&&<ConfigView config={config} saveConfig={saveConfig} params={params} setParams={setParams} paramsABCD={paramsABCD} setParamsABCD={setParamsABCD} provs={provs} setProvs={setProvs} users={users} setUsers={setUsers} h={h} configTab={configTab} setConfigTab={setConfigTab}/>}

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

/* ═══ MONITOR ═══ */
function MonitorView({ocs,prods,h}){
  const pN=ocs.filter(o=>o.estado==="Pend. Dir. Negocios"),pF=ocs.filter(o=>o.estado==="Pend. Dir. Finanzas")
  const trans=ocs.filter(o=>["Despacho nac.","Naviera","Aduana","Transporte","Internación"].includes(o.estado))
  const urgA=prods.filter(i=>i.clasif_abcd==="A"&&(i.dias_cobertura||999)<15).length
  const inv=prods.reduce((s,i)=>s+(i.costo_reposicion||0),0)

  return<div>
    <div style={{display:"flex",gap:8,marginBottom:16,overflowX:"auto",paddingBottom:4}}>
      <Mt ic="🔴" l="Clase A urgentes" v={urgA} ac="#FF3B30" sub="< 15 días"/>
      <Mt ic="📝" l="Pend. Negocios" v={pN.length} ac={pN.length>0?"#007AFF":"#34C759"}/>
      <Mt ic="💰" l="Pend. Finanzas" v={pF.length} ac={pF.length>0?"#AF52DE":"#34C759"}/>
      <Mt ic="🚚" l="En tránsito" v={trans.length} ac="#AF52DE"/>
      <Mt ic="📊" l="Inversión req." v={fmt(inv)}/>
    </div>

    <Cd><div style={{fontSize:13,fontWeight:700,marginBottom:6,color:"#1C1C1E"}}>Flujo nacional</div><Stp steps={FN} cur={-1}/></Cd>
    <Cd><div style={{fontSize:13,fontWeight:700,marginBottom:6,color:"#1C1C1E"}}>Flujo importación</div><Stp steps={FI} cur={-1}/></Cd>

    <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",marginBottom:8,marginTop:8}}>Autorizaciones pendientes</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
      <Cd ac="#007AFF"><div style={{fontSize:13,fontWeight:700,color:"#007AFF",marginBottom:6}}>Dir. Negocios ({pN.length})</div>{pN.length===0?<div style={{fontSize:12,color:"#AEAEB2"}}>Sin pendientes ✓</div>:pN.map(o=><div key={o.id} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #F2F2F7",fontSize:12}}><div><strong>{o.id}</strong><div style={{color:"#8E8E93",fontSize:10}}>{o.proveedor_id}</div></div><strong>{fmt(o.total_clp)}</strong></div>)}</Cd>
      <Cd ac="#AF52DE"><div style={{fontSize:13,fontWeight:700,color:"#AF52DE",marginBottom:6}}>Dir. Finanzas ({pF.length})</div>{pF.length===0?<div style={{fontSize:12,color:"#AEAEB2"}}>Sin pendientes ✓</div>:pF.map(o=><div key={o.id} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #F2F2F7",fontSize:12}}><div><strong>{o.id}</strong><div style={{color:"#8E8E93",fontSize:10}}>{o.proveedor_id}</div></div><strong>{fmt(o.total_clp)}</strong></div>)}</Cd>
    </div>

    <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",marginBottom:8}}>Alertas — Quiebre stock Clase A</div>
    {prods.filter(i=>(i.dias_cobertura||999)<10&&i.clasif_abcd==="A").slice(0,5).map((i,idx)=><Cd key={idx} ac="#FF3B30" s={{marginBottom:6}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:13,fontWeight:600}}>{i.producto}</div><div style={{fontSize:11,color:"#8E8E93"}}>{i.tipo_producto}</div></div>
        <Bd c="#FF3B30" bg="#FF3B3015" lg>⚠ {Math.round(i.dias_cobertura||0)}d</Bd>
      </div>
      <div style={{display:"flex",gap:16,marginTop:6,fontSize:12,color:"#8E8E93"}}>
        <span>Stock: <strong style={{color:"#1C1C1E"}}>{fN(i.stock_actual)}</strong></span>
        {i.stock_transito>0&&<span>En tránsito: <strong style={{color:"#007AFF"}}>{fN(i.stock_transito)}</strong></span>}
        <span>Reponer: <strong style={{color:"#FF3B30"}}>{fN(i.reposicion_necesaria)}</strong></span>
      </div>
    </Cd>)}

    {ocs.length>0&&<><div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",marginBottom:8,marginTop:8}}>Órdenes recientes</div>
    {ocs.slice(0,4).map(oc=><Cd key={oc.id} s={{marginBottom:6}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:14,fontWeight:600}}>{oc.id}</span><Bd c={STS[oc.estado]?.c} bg={STS[oc.estado]?.bg}>{STS[oc.estado]?.ic} {oc.estado}</Bd></div><div style={{fontSize:11,color:"#8E8E93",marginTop:2}}>{oc.proveedor_id} — {oc.fecha_creacion}</div></div>
        <div style={{fontSize:16,fontWeight:700}}>{fmt(oc.total_clp)}</div>
      </div>
    </Cd>)}</>}
  </div>
}

/* ═══ REPOSICIÓN ═══ */
function RepoView({prods,cart,setCart,go,config,params,paramsABCD}){
  const[q,setQ]=useState("");const[fc,setFc]=useState("T");const[ft,setFt]=useState("T");const[sortBy,setSortBy]=useState("costo_reposicion");const[fe,setFe]=useState("T")
  const tipos=[...new Set(prods.map(p=>p.tipo_producto).filter(Boolean))].sort()
  const estados=["Reposición","Stock suficiente","Sin ventas","Revisar"]
  const fil=prods.filter(i=>(fc==="T"||i.clasif_abcd===fc)&&(ft==="T"||i.tipo_producto===ft)&&(fe==="T"||i.estado===fe)&&(!q||i.producto?.toLowerCase().includes(q.toLowerCase())||i.sku?.toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>{if(sortBy==="dias_cobertura")return(a.dias_cobertura||999)-(b.dias_cobertura||999);return(b[sortBy]||0)-(a[sortBy]||0)})
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

    {/* EXPANDED TABLE with sticky header */}
    <div style={{overflowY:"auto",maxHeight:"calc(100vh - 280px)",borderRadius:10,border:"1px solid #D1D1D6"}}>
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,tableLayout:"auto"}}>
      <thead style={{position:"sticky",top:0,zIndex:5}}><tr style={{background:"#E5E5EA"}}>
        {["","Producto","Tipo","Clasif.","Estado","Ene","Feb","Mar","Abr","Vta Total","Quieb.","Vta Comp.","Vta/Día","Stock","Tráns.","Cob.","Pto Re.","Reponer","Costo U.","Inversión"].map((h,i)=>
          <th key={i} style={{padding:"9px 5px",textAlign:i<3?"left":"right",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #C7C7CC",textTransform:"uppercase",letterSpacing:"0.03em",whiteSpace:"nowrap",background:"#E5E5EA"}}>{h}</th>
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

/* ═══ SOLICITUD ═══ */
function SolView({cart,setCart,provs,users,cu,setOcs,addFirma,goOC}){
  const sel=Object.values(cart);const[prov,setProv]=useState("");const[tipo,setTipo]=useState("Nacional");const[fEst,setFEst]=useState("");const[notas,setNotas]=useState("");const[done,setDone]=useState(null);const[saving,setSaving]=useState(false)
  const total=sel.reduce((s,i)=>s+((i.cp||0)*(i.costo_unitario||0)),0);const sp=provs.find(p=>p.id===prov)

  const submit=async()=>{setSaving(true);const isI=tipo==="Importación";const id=(isI?"IMP-":"NAC-")+String(Date.now()).slice(-5)
    const oc={id,fecha_creacion:hoy(),solicitante_id:cu.id,proveedor_id:prov,tipo_oc:tipo,estado:"Pend. Dir. Negocios",fase_actual:1,total_clp:total,total_usd:isI?Math.round(total/950):0,condicion_pago:sp?.condicion_pago||"Contado",pct_fab:sp?.pct_fabricacion||0,pct_embarque:sp?.pct_embarque||0,pct_puerto:sp?.pct_puerto||0,fecha_estimada:fEst||null,estado_pago:"Pago pend.",notas}
    const{error}=await supabase.from('ordenes_compra').insert(oc)
    if(!error){const items=sel.map(i=>({id:uid(),oc_id:id,sku:i.sku,producto:i.producto,cantidad_sugerida:i.reposicion_necesaria||0,cantidad_pedida:i.cp,costo_unitario:i.costo_unitario}));await supabase.from('oc_items').insert(items);await addFirma(id,"Solicitud creada");setOcs(p=>[oc,...p]);setCart({});setDone(oc)}
    setSaving(false)}

  if(done)return<div style={{textAlign:"center",padding:"60px 20px"}}><div style={{width:64,height:64,borderRadius:32,background:"#34C75920",margin:"0 auto 16px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>✓</div><div style={{fontSize:22,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>{done.id}</div><div style={{fontSize:14,color:"#8E8E93",marginBottom:20}}>Enviada a Dir. Negocios para aprobación</div><Bt v="pri" onClick={()=>{setDone(null);goOC()}} ic="📋">Ver órdenes</Bt></div>
  if(sel.length===0)return<div style={{textAlign:"center",padding:"60px 20px"}}><div style={{fontSize:40,marginBottom:12}}>📋</div><div style={{fontSize:18,fontWeight:700,color:"#1C1C1E"}}>Sin productos</div><div style={{fontSize:14,color:"#8E8E93",marginTop:4}}>Selecciona en Reposición</div></div>

  return<div><div style={{fontSize:22,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em",marginBottom:16}}>Nueva solicitud</div>
    <Cd><div style={{fontSize:15,fontWeight:700,marginBottom:12}}>Datos de la solicitud</div>
      <Fl l="Solicitante"><div style={{display:"flex",alignItems:"center",gap:10}}><Av n={cu?.avatar} c={rl(cu).c} sz={36}/><div><div style={{fontSize:14,fontWeight:600}}>{cu?.nombre}</div><div style={{fontSize:12,color:rl(cu).c,fontWeight:600}}>{rl(cu).l}</div></div></div></Fl>
      <Fl l="Proveedor" req><select value={prov} onChange={e=>{setProv(e.target.value);const s=provs.find(p=>p.id===e.target.value);if(s)setTipo(s.tipo)}} style={css.select}><option value="">Seleccionar proveedor...</option>{provs.filter(p=>p.activo).map(p=><option key={p.id} value={p.id}>{p.nombre} ({p.tipo})</option>)}</select></Fl>
      {sp&&<div style={{background:"#F2F2F7",borderRadius:12,padding:12,marginBottom:14,fontSize:13}}><Bd c={tipo==="Importación"?"#FF3B30":"#007AFF"} bg={tipo==="Importación"?"#FF3B3015":"#007AFF15"} lg>{tipo}</Bd><div style={{marginTop:6,color:"#8E8E93"}}>Pago: <strong style={{color:"#1C1C1E"}}>{sp.condicion_pago}</strong>{sp.pct_fabricacion>0&&<span style={{color:"#FF9500"}}> — {sp.pct_fabricacion}% fab + {sp.pct_embarque}% emb + {sp.pct_puerto}% pto</span>}</div></div>}
      <Fl l="Fecha estimada recepción" req><input type="date" value={fEst} onChange={e=>setFEst(e.target.value)} style={css.input}/></Fl>
      <Fl l="Notas"><textarea value={notas} onChange={e=>setNotas(e.target.value)} rows={2} style={{...css.input,resize:"vertical"}}/></Fl>
    </Cd>
    <Cd s={{marginTop:10}}><div style={{fontSize:15,fontWeight:700,marginBottom:8}}>Productos ({sel.length})</div>
      {sel.map((i,idx)=><div key={idx} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:idx<sel.length-1?"1px solid #F2F2F7":"none"}}><div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{i.producto}</div><div style={{fontSize:11,color:"#8E8E93"}}>Sugerido: {fN(i.reposicion_necesaria)}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:14,fontWeight:700,color:"#007AFF"}}>{fN(i.cp)} uds</div><div style={{fontSize:11,color:"#8E8E93"}}>{fmt(i.cp*(i.costo_unitario||0))}</div></div></div>)}
      <div style={{borderTop:"2px solid #F2F2F7",paddingTop:12,marginTop:8,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:15,fontWeight:600}}>Total</span><span style={{fontSize:22,fontWeight:800}}>{fmt(total)}</span></div>
    </Cd>
    <Cd s={{marginTop:10}}><div style={{fontSize:13,fontWeight:700,marginBottom:6}}>Firma digital</div><div style={{display:"flex",alignItems:"center",gap:10,padding:12,background:"#F2F2F7",borderRadius:12}}><Av n={cu?.avatar} c={rl(cu).c} sz={42}/><div><div style={{fontSize:16,fontStyle:"italic",fontWeight:700,color:rl(cu).c}}>{cu?.firma_digital}</div><div style={{fontSize:11,color:"#AEAEB2"}}>{rl(cu).l} — {hoy()} {hora()}</div></div></div></Cd>
    <div style={{marginTop:14}}><Bt v="pri" full dis={!prov||!fEst||saving} onClick={submit} ic="✍️">{saving?"Guardando...":"Firmar y enviar solicitud"}</Bt></div>
  </div>
}

/* ═══ OC LIST — With admin edit/delete + notification log ═══ */
function OCListView({ocs,firmas,pagos,updOC,addFirma,setDet,cu,h,provs,setOcs}){
  const[f,setF]=useState("Todas");const[deleting,setDeleting]=useState(null);const[notifLog,setNotifLog]=useState([])
  const estados=["Todas","Pend. Dir. Negocios","Pend. Dir. Finanzas","Pend. proveedor","En fabricación","Naviera","Recibida OK","Cerrada"]
  const fil=f==="Todas"?ocs:ocs.filter(o=>o.estado===f)
  const firma=async(oc,acc,nE,nF)=>{
    await addFirma(oc.id,acc);await updOC(oc.id,{estado:nE,fase_actual:nF??oc.fase_actual})
    // Log notification
    const notif={id:uid(),oc_id:oc.id,accion:acc,nuevo_estado:nE,usuario:cu.nombre,rol:rl(cu).l,fecha:hoy(),hora:hora(),tipo:"estado_oc"}
    await supabase.from('notificaciones').insert(notif).catch(()=>{})
    setNotifLog(p=>[notif,...p])
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
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
          {oc.estado==="Pend. Dir. Negocios"&&h("aprobar_neg")&&<><Bt sm v="pri" onClick={()=>firma(oc,"Aprobada Dir. Negocios","Pend. Dir. Finanzas",2)} ic="✓">Aprobar</Bt><Bt sm v="dan" onClick={()=>firma(oc,"Rechazada","Rechazada")} ic="✕">Rechazar</Bt></>}
          {oc.estado==="Pend. Dir. Finanzas"&&h("aprobar_fin")&&<><Bt sm v="pur" onClick={()=>firma(oc,"Aprobada Finanzas","Pend. proveedor",3)} ic="✓">Presupuesto OK</Bt><Bt sm v="dan" onClick={()=>firma(oc,"Rechazada","Rechazada")} ic="✕">Rechazar</Bt></>}
          {oc.estado==="Pend. proveedor"&&h("valid_prov")&&<Bt sm v="suc" onClick={()=>firma(oc,isI?"Proforma confirmada":"Proveedor confirmó",isI?"Proforma OK":"Confirmada prov.",4)} ic="◉">Confirmado</Bt>}
          {oc.estado==="Confirmada prov."&&<Bt sm v="pri" onClick={()=>firma(oc,"En despacho","Despacho nac.",5)} ic="🚚">Despacho</Bt>}
          {oc.estado==="Despacho nac."&&h("recibir")&&<Bt sm v="amb" onClick={()=>setDet(oc)} ic="📦">Recepción</Bt>}
          {(oc.estado==="Recibida OK"||oc.estado==="Recibida parcial")&&h("cerrar_oc")&&<Bt sm v="gry" onClick={()=>firma(oc,"Cerrada","Cerrada",isI?14:7)} ic="■">Cerrar</Bt>}
        </div>
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
  const[docs,setDocs]=useState([]);const[uploading,setUploading]=useState(false)
  useEffect(()=>{supabase.from('oc_items').select('*').eq('oc_id',oc.id).then(r=>{const d=r.data||[];setItems(d);const q={};const pq={};d.forEach(i=>{q[i.id]=i.cantidad_pedida||0;pq[i.id]=i.cantidad_confirmada||i.cantidad_pedida||0});setRecQty(q);setProvQty(pq)})},[oc.id])
  // Load existing documents
  useEffect(()=>{supabase.from('documentos_import').select('*').eq('oc_id',oc.id).order('created_at',{ascending:false}).then(r=>setDocs(r.data||[]))},[oc.id])

  const firma=async(a,nE,nF)=>{await addFirma(oc.id,a);await updOC(oc.id,{estado:nE,fase_actual:nF??oc.fase_actual});close()}
  const regP=async(c,m,mon)=>{const p={id:uid(),oc_id:oc.id,concepto:c,monto:m,moneda:mon,fecha_pago:hoy(),estado:"Pagado",aprobado_por:cu.id};await supabase.from('pagos').insert(p);setPagos(prev=>[...prev,p])}

  // Upload document — always store as base64 in DB (reliable, no bucket config needed)
  const uploadDoc=async(file,tipo,descripcion)=>{
    if(!file)return null;setUploading(tipo)
    try{
      // Validate file size (max 5MB)
      if(file.size>5*1024*1024){alert("Archivo muy grande. Máximo 5MB.");setUploading(false);return}
      // Convert to base64
      const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=()=>rej(new Error("Error leyendo archivo"));r.readAsDataURL(file)})
      const doc={id:uid(),oc_id:oc.id,tipo_documento:tipo,nombre_archivo:file.name,url_archivo:base64,descripcion:descripcion||tipo,subido_por:cu.nombre,fecha_subida:hoy(),hora_subida:hora()}
      const{error}=await supabase.from('documentos_import').insert(doc)
      if(error){alert("Error guardando: "+error.message);setUploading(false);return}
      setDocs(p=>[doc,...p])
      await addFirma(oc.id,`📎 ${descripcion||tipo}: ${file.name}`)
    }catch(e){alert("Error: "+e.message)}
    setUploading(false)
  }

  // Delete document
  const deleteDoc=async(docId)=>{
    if(!confirm("¿Eliminar este documento?"))return
    await supabase.from('documentos_import').delete().eq('id',docId)
    setDocs(p=>p.filter(d=>d.id!==docId))
  }

  // File upload component with upload status, view, and delete
  const FileUpload=({tipo,label,desc})=>{
    const tipoDocs=docs.filter(d=>d.tipo_documento===tipo)
    return<div style={{background:"#F2F2F7",borderRadius:10,padding:12,marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:"#1C1C1E"}}>{label}</div><div style={{fontSize:11,color:"#8E8E93"}}>{desc}</div></div>
        <label style={{padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:600,background:uploading===tipo?"#8E8E93":"#007AFF",color:"#fff",cursor:uploading?"wait":"pointer",display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}>
          {uploading===tipo?"⏳ Subiendo...":"📎 Adjuntar"}
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f)uploadDoc(f,tipo,label);e.target.value=""}} disabled={!!uploading}/>
        </label>
      </div>
      {tipoDocs.map(d=><div key={d.id} style={{display:"flex",alignItems:"center",gap:8,marginTop:8,padding:10,background:"#fff",borderRadius:8,border:"1px solid #34C75940"}}>
        <span style={{fontSize:18}}>{d.nombre_archivo?.match(/\.pdf$/i)?"📄":"🖼"}</span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,fontWeight:600,color:"#1C1C1E",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.nombre_archivo}</div>
          <div style={{fontSize:10,color:"#8E8E93"}}>{d.subido_por} — {d.fecha_subida} {d.hora_subida}</div>
        </div>
        <div style={{display:"flex",gap:4,flexShrink:0}}>
          {d.url_archivo&&d.url_archivo.startsWith("data:")&&<button onClick={()=>{const w=window.open();w.document.write(`<iframe src="${d.url_archivo}" style="width:100%;height:100%;border:none"></iframe>`);w.document.title=d.nombre_archivo}} style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,background:"#007AFF15",color:"#007AFF",border:"none",cursor:"pointer"}}>👁 Ver</button>}
          {d.url_archivo&&!d.url_archivo.startsWith("data:")&&<a href={d.url_archivo} target="_blank" rel="noopener noreferrer" style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,background:"#007AFF15",color:"#007AFF",textDecoration:"none"}}>👁 Ver</a>}
          <button onClick={()=>deleteDoc(d.id)} style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,background:"#FF3B3012",color:"#FF3B30",border:"none",cursor:"pointer"}}>🗑</button>
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
function ConfigView({config,saveConfig,params,setParams,paramsABCD,setParamsABCD,provs,setProvs,users,setUsers,h,configTab,setConfigTab}){
  const tabs=[{k:"params",l:"Reposición",ic:"📊"},{k:"bsale",l:"BSALE",ic:"🔗"},{k:"provs",l:"Proveedores",ic:"🏢"},{k:"users",l:"Usuarios",ic:"👤"},{k:"permisos",l:"Permisos",ic:"🔑"}]

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

    {configTab==="bsale"&&<BsaleConfig config={config} saveConfig={saveConfig} bsaleToken={bsaleToken} setBsaleToken={setBsaleToken} saveBsale={saveBsale}/>}

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
function BsaleConfig({config,saveConfig,bsaleToken,setBsaleToken,saveBsale}){
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
      addLog("✅ Análisis completo — ve a Reposición para ver los resultados","success")
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
