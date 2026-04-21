import{useState,useEffect,useMemo,useCallback}from'react'
import{supabase,signIn,signOut,getSession}from'./supabase'
import * as XLSX from 'xlsx'

/* ═══ HELPERS ═══ */
const fmt=n=>new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n||0)
const fN=n=>new Intl.NumberFormat("es-CL").format(Math.round(n||0))
const fU=n=>"USD "+new Intl.NumberFormat("en-US").format(Math.round(n||0))
const hoy=()=>new Date().toISOString().slice(0,10)
const hora=()=>{const d=new Date();return String(d.getHours()).padStart(2,'0')+":"+String(d.getMinutes()).padStart(2,'0')+":"+String(d.getSeconds()).padStart(2,'0')}
const uid=()=>"id"+Date.now().toString(36)+Math.random().toString(36).slice(2,5)
const pct=v=>Math.round(v*100)+"%"
const addDias=(fecha,dias)=>{if(!fecha)return null;const d=new Date(fecha);d.setDate(d.getDate()+dias);return d.toISOString().slice(0,10)}
const diff=(fecha)=>{if(!fecha)return 0;const d=new Date(fecha);d.setHours(0,0,0,0);const h=new Date();h.setHours(0,0,0,0);return Math.round((d-h)/86400000)}

// Paginación automática — Supabase limita a 1000 filas por request
const fetchAll=async(query)=>{
  const CHUNK=1000;let all=[],from=0
  while(true){
    const{data,error}=await query.range(from,from+CHUNK-1)
    if(error)return{data:null,error}
    if(!data||data.length===0)break
    all=all.concat(data)
    if(data.length<CHUNK)break
    from+=CHUNK
    if(from>100000)break
  }
  return{data:all,error:null}
}

/* ═══ DESIGN SYSTEM ═══ */
const CL={A:{c:"#FF3B30",bg:"#FF3B3015",t:"Crítico"},B:{c:"#007AFF",bg:"#007AFF15",t:"Importante"},C:{c:"#34C759",bg:"#34C75915",t:"Regular"},D:{c:"#8E8E93",bg:"#8E8E9315",t:"Bajo"}}
const STS={"Pend. Dir. Negocios":{c:"#007AFF",bg:"#007AFF15",ic:"⏳"},"Pend. Dir. Finanzas":{c:"#AF52DE",bg:"#AF52DE15",ic:"⏳"},"Pend. proveedor":{c:"#FF9500",bg:"#FF950015",ic:"🔄"},"Proforma OK":{c:"#34C759",bg:"#34C75915",ic:"✓"},"Pago fabricación":{c:"#FF9500",bg:"#FF950015",ic:"💰"},"En fabricación":{c:"#AF52DE",bg:"#AF52DE15",ic:"🏭"},"Pago embarque":{c:"#FF9500",bg:"#FF950015",ic:"💰"},"Naviera":{c:"#007AFF",bg:"#007AFF15",ic:"🚢"},"Aduana":{c:"#FF3B30",bg:"#FF3B3015",ic:"🏛"},"Pago puerto":{c:"#FF9500",bg:"#FF950015",ic:"💰"},"Internación":{c:"#FF3B30",bg:"#FF3B3015",ic:"📋"},"Transporte":{c:"#AF52DE",bg:"#AF52DE15",ic:"🚛"},"Confirmada prov.":{c:"#34C759",bg:"#34C75915",ic:"✓"},"Despacho nac.":{c:"#AF52DE",bg:"#AF52DE15",ic:"🚚"},"Recibida parcial":{c:"#FF9500",bg:"#FF950015",ic:"◐"},"Recibida OK":{c:"#34C759",bg:"#34C75915",ic:"✓"},"Cerrada":{c:"#8E8E93",bg:"#8E8E9315",ic:"■"},"Rechazada":{c:"#FF3B30",bg:"#FF3B3015",ic:"✕"},"Pago pend.":{c:"#FF9500",bg:"#FF950015",ic:"$"}}
const FN=[{n:"Solicitud"},{n:"Negocios"},{n:"Finanzas"},{n:"Proveedor"},{n:"Despacho"},{n:"Recepción"},{n:"Cierre"}]
const FI=[{n:"Solicitud"},{n:"Negocios"},{n:"Finanzas"},{n:"Proforma"},{n:"Pago fab."},{n:"Fabricación"},{n:"Pago emb."},{n:"Naviera"},{n:"Aduana"},{n:"Pago pto."},{n:"Internación"},{n:"Transporte"},{n:"Recepción"},{n:"Cierre"}]
// Catálogo de todos los permisos disponibles en el sistema
const PERMISOS=[
  {k:"crear_oc",l:"Crear OC",d:"Crear órdenes de compra"},
  {k:"aprobar_neg",l:"Aprobar Negocios",d:"Firmar aprobación como Dir. Negocios"},
  {k:"aprobar_fin",l:"Aprobar Finanzas",d:"Firmar aprobación como Dir. Finanzas"},
  {k:"aprobar_ilimitado",l:"Aprobación Ilimitada",d:"Aprobar cualquier monto/estado"},
  {k:"aprobar_ops",l:"Aprobar Operaciones",d:"Confirmar espacio y recepción en CD/sucursal"},
  {k:"reg_pago",l:"Registrar Pago",d:"Marcar pagos como ejecutados con comprobante"},
  {k:"recibir",l:"Recibir mercadería",d:"Registrar guías y facturas de recepción"},
  {k:"cerrar_oc",l:"Cerrar OC",d:"Marcar OC como cerrada"},
  {k:"gest_prov",l:"Gestión Proveedores",d:"Crear y editar proveedores"},
  {k:"valid_prov",l:"Validar Proveedor",d:"Confirmar datos del proveedor en OC"},
  {k:"gest_imp",l:"Gestión Importaciones",d:"Editar parámetros de importación y costeo"},
  {k:"seguim",l:"Seguimiento",d:"Ver detalles de tránsito y ETA"},
  {k:"config",l:"Configuración",d:"Acceso al módulo de configuración"},
  {k:"ver_dash",l:"Ver Dashboard",d:"Acceso a Monitor y reportes"},
  {k:"ver_fin",l:"Ver Finanzas",d:"Acceso a módulo financiero"}
]

const ROLES=[
  {k:"admin",l:"Admin",c:"#FF3B30",p:["todo"]},
  {k:"dir_general",l:"Dir. General",c:"#FF3B30",p:["aprobar_ilimitado","ver_dash","ver_fin"]},
  {k:"dir_finanzas",l:"Dir. Finanzas",c:"#AF52DE",p:["aprobar_fin","ver_dash","ver_fin","reg_pago"]},
  {k:"dir_negocios",l:"Dir. Negocios",c:"#007AFF",p:["aprobar_neg","crear_oc","ver_dash","gest_prov","valid_prov"]},
  {k:"dir_operaciones",l:"Dir. Operaciones",c:"#5AC8FA",p:["aprobar_ops","recibir","ver_dash","seguim","cerrar_oc"]},
  {k:"analista",l:"Analista",c:"#34C759",p:["crear_oc","ver_dash","cerrar_oc","gest_prov","config","seguim","gest_imp"]},
  {k:"jefe_bodega",l:"Jefe Bodega",c:"#FF9500",p:["recibir","ver_dash"]},
  {k:"jefe_operaciones",l:"Jefe Operaciones",c:"#FF9500",p:["recibir","aprobar_ops","ver_dash","seguim"]},
  {k:"directorio",l:"Directorio",c:"#8E8E93",p:["ver_dash","ver_fin"]}
]
const rl=u=>ROLES.find(r=>r.k===u?.rol)||ROLES[5]
// ⭐ hp con override por usuario: si usuario.permisos_custom existe, se usa ese listado; sino el del rol
const hp=(u,p)=>{
  if(!u)return false
  if(u.rol==="admin")return true
  const custom=u.permisos_custom
  if(custom&&Array.isArray(custom))return custom.includes(p)||custom.includes("todo")
  const r=rl(u)
  return r.p.includes("todo")||r.p.includes(p)
}

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
const TABS=[{k:"monitor",l:"Monitor",ic:"📊"},{k:"repo",l:"Reposición",ic:"📦"},{k:"forecast",l:"Forecast",ic:"📈"},{k:"costeo",l:"Costeo IMP",ic:"🧮"},{k:"transito",l:"Tránsito",ic:"🚚"},{k:"finanzas",l:"Finanzas",ic:"💰"},{k:"nueva",l:"Nueva OC",ic:"➕"},{k:"ordenes",l:"Órdenes",ic:"📋"},{k:"config",l:"Config",ic:"⚙️"}]

export default function App(){
  const[session,setSession]=useState(null)
  const[cu,setCu]=useState(null)
  const[users,setUsers]=useState([])
  const[sucursales,setSucursales]=useState([])
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
      const[ru,rp,rprod,roc,rf,rpag,rpt,rpa,rcfg,rsuc]=await Promise.all([
        supabase.from('usuarios').select('*').eq('activo',true).order('nombre'),
        supabase.from('proveedores').select('*').order('nombre'),
        fetchAll(supabase.from('productos').select('*').order('costo_reposicion',{ascending:false})),
        supabase.from('ordenes_compra').select('*').order('created_at',{ascending:false}),
        fetchAll(supabase.from('firmas').select('*').order('created_at')),
        supabase.from('pagos').select('*'),
        supabase.from('parametros_tipo').select('*'),
        supabase.from('parametros_abcd').select('*'),
        supabase.from('config_sistema').select('*'),
        supabase.from('sucursales').select('*').order('orden'),
      ])
      if(ru.error)throw ru.error
      setUsers(ru.data||[]);setProvs(rp.data||[]);setProds(rprod.data||[])
      setOcs(roc.data||[]);setFirmas(rf.data||[]);setPagos(rpag.data||[])
      setParams(rpt.data||[]);setParamsABCD(rpa.data||[])
      setSucursales(rsuc.data||[])
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
          <button onClick={()=>setTab("flujograma")} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"6px 10px",borderRadius:10,background:tab==="flujograma"?"#5AC8FA":"#5AC8FA15",border:"none",cursor:"pointer",color:tab==="flujograma"?"#fff":"#5AC8FA",minWidth:56}} title="Flujograma del proceso de compras">
            <span style={{fontSize:14,lineHeight:1}}>🔄</span>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.02em"}}>Flujo</span>
          </button>
          <a href="/Manual_ERP_Compras_v1.pdf" target="_blank" rel="noopener" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:"6px 10px",borderRadius:10,background:"#007AFF15",border:"none",cursor:"pointer",color:"#007AFF",textDecoration:"none",minWidth:56}} title="Manual de Usuario ERP">
            <span style={{fontSize:14,lineHeight:1}}>📖</span>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.02em"}}>Manual</span>
          </a>
          <button onClick={()=>setCu(null)} style={{width:36,height:36,borderRadius:10,background:"#FF3B3015",border:"none",cursor:"pointer",fontSize:13,color:"#FF3B30"}} title="Cerrar sesión">⏻</button>
        </div>
      </div>
    </div>

    {/* CONTENT */}
    {tab==="monitor"&&<MonitorView ocs={ocs} prods={prodsWithTransit} pagos={pagos} provs={provs} h={h} setTab={setTab}/>}
    {tab==="repo"&&<RepoView prods={prodsWithTransit} cart={cart} setCart={setCart} go={()=>setTab("nueva")} config={config} params={params} paramsABCD={paramsABCD} sucursales={sucursales}/>}
    {tab==="costeo"&&<CosteoImpView config={config} saveConfig={saveConfig} ocs={ocs} cu={cu} addFirma={addFirma}/>}
    {tab==="forecast"&&<ForecastView prods={prodsWithTransit} ocs={ocs} config={config} saveConfig={saveConfig}/>}
    {tab==="transito"&&<TransitoView ocs={ocs} provs={provs}/>}
    {tab==="finanzas"&&<FinanzasView ocs={ocs} provs={provs} pagos={pagos} setPagos={setPagos}/>}
    {tab==="nueva"&&<SolView cart={cart} setCart={setCart} provs={provs} users={users} sucursales={sucursales} cu={cu} setOcs={setOcs} addFirma={addFirma} goOC={()=>setTab("ordenes")} ocs={ocs} config={config}/>}
    {tab==="ordenes"&&<OCListView ocs={ocs} firmas={firmas} pagos={pagos} updOC={updOC} addFirma={addFirma} setDet={setDet} cu={cu} h={h} provs={provs} setOcs={setOcs}/>}
    {tab==="flujograma"&&<FlujogramaView ocs={ocs} provs={provs} sucursales={sucursales} users={users} setDet={setDet}/>}
    {tab==="config"&&<ConfigView config={config} saveConfig={saveConfig} params={params} setParams={setParams} paramsABCD={paramsABCD} setParamsABCD={setParamsABCD} provs={provs} setProvs={setProvs} users={users} setUsers={setUsers} sucursales={sucursales} setSucursales={setSucursales} h={h} configTab={configTab} setConfigTab={setConfigTab} loadAll={loadAll} cu={cu}/>}

    <Sheet show={!!det} onClose={()=>setDet(null)} title={det?.id||""}>{det&&<OCDetView oc={det} firmas={firmas.filter(f=>f.oc_id===det.id)} pagos={pagos.filter(p=>p.oc_id===det.id)} provs={provs} updOC={updOC} addFirma={addFirma} setPagos={setPagos} close={()=>{setDet(null);loadAll()}} cu={cu} h={h} config={config}/>}</Sheet>

    {/* BOTTOM TAB BAR */}
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(255,255,255,0.95)",backdropFilter:"blur(20px)",borderTop:"1px solid rgba(0,0,0,0.08)",display:"flex",justifyContent:"center",padding:"8px 0 env(safe-area-inset-bottom,8px)",zIndex:50}}>
      <div style={{display:"flex",gap:0,maxWidth:700,width:"100%"}}>
        {TABS.filter(t=>{if(t.k==="config")return h("config")||cu.rol==="admin";if(t.k==="nueva")return h("crear_oc");if(t.k==="finanzas")return h("ver_fin")||cu.rol==="admin";return true}).map(t=><button key={t.k} onClick={()=>setTab(t.k)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"6px 4px",background:"none",border:"none",cursor:"pointer"}}>
          <span style={{fontSize:22,opacity:tab===t.k?1:0.4}}>{t.ic}</span>
          <span style={{fontSize:11,fontWeight:600,color:tab===t.k?"#007AFF":"#8E8E93"}}>{t.l}{t.k==="ordenes"&&pend>0?` (${pend})`:""}</span>
        </button>)}
      </div>
    </div>
  </div>
}

/* ═══ MONITOR — Dashboard BI ═══ */
function MonitorView({ocs,prods,pagos=[],provs=[],h,setTab}){
  const pN=ocs.filter(o=>o.estado==="Pend. Dir. Negocios"),pF=ocs.filter(o=>o.estado==="Pend. Dir. Finanzas")
  const trans=ocs.filter(o=>["Despacho nac.","Naviera","Aduana","Transporte","Internación"].includes(o.estado))

  // ═══ ANALYTICS ═══
  const totalSKU=prods.length
  const conVenta=prods.filter(p=>(p.venta_total||0)>0)
  const sinVenta=prods.filter(p=>!p.venta_total||p.venta_total===0)
  const enRepo=prods.filter(p=>p.estado==="Reposición")
  const stockSuf=prods.filter(p=>p.estado==="Stock suficiente")
  const revisar=prods.filter(p=>p.estado==="Revisar"||p.estado==="Sin ventas")
  const criticos=prods.filter(p=>(p.dias_cobertura||999)<15&&["A","B"].includes(p.clasif_abcd))
  const criticosA=criticos.filter(p=>p.clasif_abcd==="A")
  const stockTotalVal=prods.reduce((s,p)=>s+(p.costo_stock||((p.stock_actual||0)*(p.costo_unitario||0))),0)
  const stockSinRotVal=sinVenta.reduce((s,p)=>s+(p.costo_stock||((p.stock_actual||0)*(p.costo_unitario||0))),0)
  const pctCapitalInmov=stockTotalVal>0?Math.round(stockSinRotVal/stockTotalVal*100):0
  const invReposicion=enRepo.reduce((s,p)=>s+(p.costo_reposicion||0),0)
  const invClaseA=prods.filter(p=>p.clasif_abcd==="A"&&p.estado==="Reposición").reduce((s,p)=>s+(p.costo_reposicion||0),0)
  const cobPromedio=conVenta.length>0?Math.round(conVenta.reduce((s,p)=>s+Math.min(p.dias_cobertura||0,365),0)/conVenta.length):0
  const tasaQuiebre=totalSKU>0?Math.round(enRepo.length/totalSKU*100):0

  // ═══ SCORE DE SALUD DEL NEGOCIO (0-100) ═══
  // 40% tasa de quiebre · 30% cobertura crítica · 20% capital inmov · 10% OC atascadas
  const scoreQuiebre=Math.max(0,100-tasaQuiebre*1.5) // 0% quiebre = 100, 67%+ = 0
  const scoreCritico=totalSKU>0?Math.max(0,100-(criticosA.length/totalSKU*100)*20):100
  const scoreInmov=Math.max(0,100-pctCapitalInmov*1.5)
  const ocAtascadas=ocs.filter(o=>{if(["Cerrada","Rechazada","Recibida OK"].includes(o.estado))return false;const dias=diff(o.fecha_creacion)*-1;return dias>14}).length
  const scoreOcs=Math.max(0,100-ocAtascadas*5)
  const scoreTotal=Math.round(scoreQuiebre*0.4+scoreCritico*0.3+scoreInmov*0.2+scoreOcs*0.1)
  const scoreColor=scoreTotal>=80?"#34C759":scoreTotal>=60?"#FFCC00":scoreTotal>=40?"#FF9500":"#FF3B30"
  const scoreLabel=scoreTotal>=80?"Saludable":scoreTotal>=60?"Estable":scoreTotal>=40?"Atención":"Crítico"

  // ═══ ALERTAS ACTIVAS (las que piden acción YA) ═══
  const pagosVencidos=pagos.filter(p=>p.estado!=="Pagado"&&p.fecha_programada&&diff(p.fecha_programada)<0)
  const pagosProx7=pagos.filter(p=>p.estado!=="Pagado"&&p.fecha_programada&&diff(p.fecha_programada)>=0&&diff(p.fecha_programada)<=7)
  const alertas=[]
  if(criticosA.length>0)alertas.push({sev:"high",ic:"🚨",t:`${criticosA.length} productos clase A en quiebre`,sub:`Stock crítico < 15 días en SKUs de alta rotación`,action:"Revisar reposición",tab:"repo"})
  if(pagosVencidos.length>0)alertas.push({sev:"high",ic:"💸",t:`${pagosVencidos.length} pagos vencidos`,sub:`Total: ${fmt(pagosVencidos.reduce((s,p)=>s+(p.monto||0)*(p.moneda==="USD"?950:1),0))}`,action:"Ver finanzas",tab:"finanzas"})
  if(pN.length>0||pF.length>0)alertas.push({sev:"med",ic:"⏳",t:`${pN.length+pF.length} OC esperando aprobación`,sub:`${pN.length} Dir. Negocios · ${pF.length} Dir. Finanzas`,action:"Ir a órdenes",tab:"ordenes"})
  if(ocAtascadas>0)alertas.push({sev:"med",ic:"⚠️",t:`${ocAtascadas} OC atascadas +14 días`,sub:`Sin movimiento hace más de 2 semanas`,action:"Ver órdenes",tab:"ordenes"})
  if(pagosProx7.length>0)alertas.push({sev:"low",ic:"📅",t:`${pagosProx7.length} pagos vencen en 7 días`,sub:fmt(pagosProx7.reduce((s,p)=>s+(p.monto||0)*(p.moneda==="USD"?950:1),0)),action:"Planificar",tab:"finanzas"})
  if(pctCapitalInmov>25)alertas.push({sev:"low",ic:"🧊",t:`${pctCapitalInmov}% capital inmovilizado`,sub:`${fmt(stockSinRotVal)} en stock sin rotación`,action:"Analizar liquidación"})

  // ═══ ABCD ═══
  const abcdData=["A","B","C","D"].map(c=>{const items=prods.filter(p=>p.clasif_abcd===c);return{c,n:items.length,pct:totalSKU>0?Math.round(items.length/totalSKU*100):0,venta:items.reduce((s,p)=>s+(p.venta_total||0),0),stock:items.reduce((s,p)=>s+(p.stock_actual||0),0),stockVal:items.reduce((s,p)=>s+((p.stock_actual||0)*(p.costo_unitario||0)),0),repos:items.filter(p=>p.estado==="Reposición").length,inv:items.filter(p=>p.estado==="Reposición").reduce((s,p)=>s+(p.costo_reposicion||0),0)}})
  const totalVenta=abcdData.reduce((s,d)=>s+d.venta,0)

  // ═══ POR TIPO ═══
  const tipoData=[...new Set(prods.map(p=>p.tipo_producto).filter(Boolean))].map(t=>{const items=prods.filter(p=>p.tipo_producto===t);const repos=items.filter(p=>p.estado==="Reposición");return{tipo:t,total:items.length,repos:repos.length,cobProm:items.filter(p=>(p.venta_total||0)>0).length>0?Math.round(items.filter(p=>(p.venta_total||0)>0).reduce((s,p)=>s+Math.min(p.dias_cobertura||0,365),0)/items.filter(p=>(p.venta_total||0)>0).length):999,inv:repos.reduce((s,p)=>s+(p.costo_reposicion||0),0),venta:items.reduce((s,p)=>s+(p.venta_total||0),0)}}).sort((a,b)=>b.inv-a.inv)

  // ═══ DEAD STOCK ═══
  const deadStock=sinVenta.filter(p=>(p.stock_actual||0)>0).map(p=>({...p,valorStock:(p.stock_actual||0)*(p.costo_unitario||0)})).sort((a,b)=>b.valorStock-a.valorStock)

  // ═══ PIPELINE FINANCIERO ═══
  const totalComprometido=ocs.filter(o=>!["Cerrada","Rechazada"].includes(o.estado)).reduce((s,o)=>s+(o.total_clp||0),0)
  const totalPagado=pagos.filter(p=>p.estado==="Pagado").reduce((s,p)=>s+((p.monto||0)*(p.moneda==="USD"?950:1)),0)
  const totalPendiente=pagos.filter(p=>p.estado!=="Pagado").reduce((s,p)=>s+((p.monto||0)*(p.moneda==="USD"?950:1)),0)

  // ═══ COMPONENTS ═══
  const Bar=({pct,color,h})=><div style={{width:"100%",background:"#F2F2F7",borderRadius:4,height:h||8,overflow:"hidden"}}><div style={{width:Math.max(pct,1)+"%",height:"100%",background:color,borderRadius:4,transition:"width 0.6s cubic-bezier(0.4,0,0.2,1)"}}/></div>

  // Donut ring (SVG)
  const Ring=({value,color,size=88,stroke=10,sub,label})=>{
    const r=(size-stroke)/2
    const circ=2*Math.PI*r
    const offset=circ-(value/100)*circ
    return<div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} stroke="#F2F2F7" strokeWidth={stroke} fill="none"/>
        <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} style={{transition:"stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:size>80?22:16,fontWeight:800,color,letterSpacing:"-0.02em",lineHeight:1}}>{value}</div>
        {sub&&<div style={{fontSize:9,color:"#8E8E93",marginTop:2,fontWeight:600}}>{sub}</div>}
      </div>
    </div>
  }

  return<div>
    {/* ══════════════════════════════════════════ */}
    {/* HERO: Score de salud del negocio          */}
    {/* ══════════════════════════════════════════ */}
    <div style={{background:"linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)",borderRadius:16,padding:"24px 28px",marginBottom:14,color:"#fff",position:"relative",overflow:"hidden"}}>
      {/* Decorative gradient glow */}
      <div style={{position:"absolute",top:-50,right:-50,width:200,height:200,borderRadius:"50%",background:`radial-gradient(circle,${scoreColor}40 0%,transparent 70%)`,pointerEvents:"none"}}/>
      <div style={{display:"flex",alignItems:"center",gap:24,position:"relative"}}>
        <Ring value={scoreTotal} color={scoreColor} size={120} stroke={14} sub="de 100"/>
        <div style={{flex:1}}>
          <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.5)",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>Pulso del negocio</div>
          <div style={{fontSize:32,fontWeight:800,letterSpacing:"-0.03em",lineHeight:1}}>{scoreLabel}</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.7)",marginTop:6,maxWidth:500,lineHeight:1.5}}>
            {scoreTotal>=80?"El negocio opera saludablemente. Mantené el ritmo actual de reposición.":
             scoreTotal>=60?"Operación estable, pero hay áreas que requieren atención para no escalar a crítico.":
             scoreTotal>=40?"Varios indicadores requieren acción. Priorizá las alertas para evitar mayores quiebres.":
             "Múltiples áreas críticas simultáneas. Se requiere intervención urgente en reposición y flujo de OCs."}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,minWidth:260}}>
          <div style={{background:"rgba(255,255,255,0.06)",borderRadius:10,padding:"10px 14px",border:"1px solid rgba(255,255,255,0.08)"}}>
            <div style={{fontSize:9,fontWeight:600,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.05em"}}>Abastecimiento</div>
            <div style={{fontSize:20,fontWeight:800,color:scoreQuiebre>=70?"#34C759":scoreQuiebre>=40?"#FFCC00":"#FF3B30"}}>{Math.round(scoreQuiebre)}</div>
          </div>
          <div style={{background:"rgba(255,255,255,0.06)",borderRadius:10,padding:"10px 14px",border:"1px solid rgba(255,255,255,0.08)"}}>
            <div style={{fontSize:9,fontWeight:600,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.05em"}}>Crítico A</div>
            <div style={{fontSize:20,fontWeight:800,color:scoreCritico>=70?"#34C759":scoreCritico>=40?"#FFCC00":"#FF3B30"}}>{Math.round(scoreCritico)}</div>
          </div>
          <div style={{background:"rgba(255,255,255,0.06)",borderRadius:10,padding:"10px 14px",border:"1px solid rgba(255,255,255,0.08)"}}>
            <div style={{fontSize:9,fontWeight:600,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.05em"}}>Capital</div>
            <div style={{fontSize:20,fontWeight:800,color:scoreInmov>=70?"#34C759":scoreInmov>=40?"#FFCC00":"#FF3B30"}}>{Math.round(scoreInmov)}</div>
          </div>
          <div style={{background:"rgba(255,255,255,0.06)",borderRadius:10,padding:"10px 14px",border:"1px solid rgba(255,255,255,0.08)"}}>
            <div style={{fontSize:9,fontWeight:600,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.05em"}}>OCs en flujo</div>
            <div style={{fontSize:20,fontWeight:800,color:scoreOcs>=70?"#34C759":scoreOcs>=40?"#FFCC00":"#FF3B30"}}>{Math.round(scoreOcs)}</div>
          </div>
        </div>
      </div>
    </div>

    {/* ══════════════════════════════════════════ */}
    {/* ALERTAS ACTIVAS                           */}
    {/* ══════════════════════════════════════════ */}
    {alertas.length>0&&<div style={{marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <span style={{fontSize:14,fontWeight:700,color:"#1C1C1E"}}>Requiere tu atención</span>
        <span style={{fontSize:11,color:"#8E8E93",background:"#F2F2F7",padding:"2px 8px",borderRadius:10,fontWeight:600}}>{alertas.length}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:8}}>
        {alertas.map((a,i)=>{
          const cSev=a.sev==="high"?"#FF3B30":a.sev==="med"?"#FF9500":"#007AFF"
          const bgSev=a.sev==="high"?"#FF3B3008":a.sev==="med"?"#FF950008":"#007AFF08"
          return<div key={i} onClick={()=>a.tab&&setTab&&setTab(a.tab)} style={{background:"#fff",borderRadius:12,padding:"14px 16px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:`4px solid ${cSev}`,cursor:a.tab?"pointer":"default",transition:"all 0.2s",position:"relative",overflow:"hidden"}}
            onMouseEnter={e=>{if(a.tab){e.currentTarget.style.transform="translateX(2px)";e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,0.08)"}}}
            onMouseLeave={e=>{if(a.tab){e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,0.04)"}}}>
            <div style={{position:"absolute",top:0,right:0,width:60,height:60,background:`radial-gradient(circle at top right,${cSev}15,transparent 70%)`,pointerEvents:"none"}}/>
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              <div style={{fontSize:22,flexShrink:0}}>{a.ic}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,color:"#1C1C1E",marginBottom:2}}>{a.t}</div>
                <div style={{fontSize:11,color:"#8E8E93",lineHeight:1.4}}>{a.sub}</div>
                {a.tab&&<div style={{fontSize:11,fontWeight:600,color:cSev,marginTop:6,display:"flex",alignItems:"center",gap:2}}>{a.action} →</div>}
              </div>
            </div>
          </div>
        })}
      </div>
    </div>}

    {/* ══════════════════════════════════════════ */}
    {/* KPIs JERARQUIZADOS                        */}
    {/* ══════════════════════════════════════════ */}
    <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10,marginBottom:14}}>
      {/* KPI principal: Quiebre */}
      <div style={{background:"#fff",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,right:0,bottom:0,width:120,background:`linear-gradient(135deg,${tasaQuiebre>50?"#FF3B30":tasaQuiebre>30?"#FF9500":"#34C759"}08,transparent)`,pointerEvents:"none"}}/>
        <div style={{display:"flex",alignItems:"center",gap:20,position:"relative"}}>
          <Ring value={tasaQuiebre} color={tasaQuiebre>50?"#FF3B30":tasaQuiebre>30?"#FF9500":"#34C759"} size={80} stroke={9}/>
          <div style={{flex:1}}>
            <div style={{fontSize:11,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:2}}>Tasa de quiebre</div>
            <div style={{fontSize:28,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em",lineHeight:1}}>{enRepo.length}<span style={{fontSize:16,color:"#8E8E93",fontWeight:600}}> / {totalSKU}</span></div>
            <div style={{fontSize:12,color:"#8E8E93",marginTop:4}}>SKUs que necesitan reposición</div>
            <div style={{display:"flex",gap:10,marginTop:8,fontSize:11}}>
              <span style={{color:"#FF3B30",fontWeight:600}}>● {abcdData[0].repos} A</span>
              <span style={{color:"#007AFF",fontWeight:600}}>● {abcdData[1].repos} B</span>
              <span style={{color:"#34C759",fontWeight:600}}>● {abcdData[2].repos} C</span>
              <span style={{color:"#8E8E93",fontWeight:600}}>● {abcdData[3].repos} D</span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI: Inversión requerida */}
      <div style={{background:"#fff",borderRadius:14,padding:"18px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>💰 Inversión requerida</div>
        <div style={{fontSize:22,fontWeight:800,color:"#FF9500",letterSpacing:"-0.02em",lineHeight:1}}>{fmt(invReposicion)}</div>
        <div style={{fontSize:11,color:"#8E8E93",marginTop:6}}>Para reponer {enRepo.length} SKUs</div>
        {invClaseA>0&&<div style={{marginTop:8,padding:"6px 10px",background:"#FF3B3008",borderRadius:6,borderLeft:"2px solid #FF3B30"}}>
          <div style={{fontSize:10,color:"#FF3B30",fontWeight:700}}>Prioritario A</div>
          <div style={{fontSize:13,fontWeight:800,color:"#FF3B30"}}>{fmt(invClaseA)}</div>
        </div>}
      </div>

      {/* KPI: Cobertura promedio */}
      <div style={{background:"#fff",borderRadius:14,padding:"18px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>📅 Cobertura promedio</div>
        <div style={{fontSize:22,fontWeight:800,color:"#007AFF",letterSpacing:"-0.02em",lineHeight:1}}>{cobPromedio}<span style={{fontSize:14,color:"#8E8E93",fontWeight:600}}> días</span></div>
        <div style={{fontSize:11,color:"#8E8E93",marginTop:6}}>Stock promedio disponible</div>
        {criticos.length>0&&<div style={{marginTop:8,padding:"6px 10px",background:"#FF3B3008",borderRadius:6,borderLeft:"2px solid #FF3B30"}}>
          <div style={{fontSize:10,color:"#FF3B30",fontWeight:700}}>Críticos (&lt;15d)</div>
          <div style={{fontSize:13,fontWeight:800,color:"#FF3B30"}}>{criticos.length} SKUs</div>
        </div>}
      </div>
    </div>

    {/* ══════════════════════════════════════════ */}
    {/* PIPELINE FINANCIERO                       */}
    {/* ══════════════════════════════════════════ */}
    <div style={{background:"#fff",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Pipeline financiero</div>
          <div style={{fontSize:12,color:"#8E8E93",marginTop:2}}>Flujo de compras desde aprobación hasta pago</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:10,color:"#8E8E93",fontWeight:600}}>TOTAL COMPROMETIDO</div>
          <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>{fmt(totalComprometido)}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
        {[
          {n:"Aprobación",c:"#007AFF",ic:"⏳",count:pN.length+pF.length,val:[...pN,...pF].reduce((s,o)=>s+(o.total_clp||0),0),tab:"ordenes"},
          {n:"Proveedor",c:"#FF9500",ic:"🔄",count:ocs.filter(o=>["Pend. proveedor","Confirmada prov.","Proforma OK"].includes(o.estado)).length,val:ocs.filter(o=>["Pend. proveedor","Confirmada prov.","Proforma OK"].includes(o.estado)).reduce((s,o)=>s+(o.total_clp||0),0),tab:"ordenes"},
          {n:"En tránsito",c:"#AF52DE",ic:"🚢",count:trans.length,val:trans.reduce((s,o)=>s+(o.total_clp||0),0),tab:"transito"},
          {n:"Pagos pend.",c:"#FF3B30",ic:"💰",count:pagos.filter(p=>p.estado!=="Pagado").length,val:totalPendiente,tab:"finanzas"},
          {n:"Ejecutados",c:"#34C759",ic:"✓",count:pagos.filter(p=>p.estado==="Pagado").length,val:totalPagado,tab:"finanzas"}
        ].map((s,i)=><div key={i} onClick={()=>s.tab&&setTab&&setTab(s.tab)} style={{padding:"14px 16px",borderRadius:10,background:s.c+"08",border:`1px solid ${s.c}20`,cursor:s.tab?"pointer":"default",transition:"all 0.2s"}}
          onMouseEnter={e=>{if(s.tab){e.currentTarget.style.background=s.c+"14";e.currentTarget.style.transform="translateY(-2px)"}}}
          onMouseLeave={e=>{if(s.tab){e.currentTarget.style.background=s.c+"08";e.currentTarget.style.transform=""}}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
            <span style={{fontSize:14}}>{s.ic}</span>
            <div style={{fontSize:11,fontWeight:700,color:s.c,textTransform:"uppercase",letterSpacing:"0.02em"}}>{s.n}</div>
          </div>
          <div style={{fontSize:22,fontWeight:800,color:s.c,letterSpacing:"-0.02em",lineHeight:1}}>{s.count}</div>
          <div style={{fontSize:11,color:"#8E8E93",marginTop:4}}>{fmt(s.val)}</div>
        </div>)}
      </div>
    </div>

    {/* ══════════════════════════════════════════ */}
    {/* ABCD + CAPITAL                            */}
    {/* ══════════════════════════════════════════ */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
      <div style={{background:"#fff",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",letterSpacing:"-0.02em",marginBottom:4}}>Clasificación ABCD</div>
        <div style={{fontSize:12,color:"#8E8E93",marginBottom:14}}>Participación en ventas · Regla 80/20</div>
        {abcdData.map(d=>{const pctVenta=totalVenta>0?Math.round(d.venta/totalVenta*100):0;return<div key={d.c} style={{marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:32,height:32,borderRadius:8,background:CL[d.c]?.bg,color:CL[d.c]?.c,fontSize:14,fontWeight:800}}>{d.c}</span>
              <div>
                <div style={{fontSize:13,fontWeight:700}}>{d.n} SKUs <span style={{color:"#8E8E93",fontWeight:500}}>({d.pct}%)</span></div>
                <div style={{fontSize:10,color:"#8E8E93"}}>{CL[d.c]?.t}</div>
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:15,fontWeight:800,color:CL[d.c]?.c,letterSpacing:"-0.02em"}}>{pctVenta}%</div>
              <div style={{fontSize:10,color:"#8E8E93"}}>de las ventas</div>
            </div>
          </div>
          <Bar pct={pctVenta} color={CL[d.c]?.c} h={8}/>
          {d.repos>0&&<div style={{fontSize:10,color:"#FF3B30",marginTop:4,fontWeight:600}}>⚠ {d.repos} SKUs necesitan reposición ({fmt(d.inv)})</div>}
        </div>})}
      </div>

      <div style={{background:"#fff",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
          <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Capital inmovilizado</div>
          <span style={{fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:10,background:pctCapitalInmov>30?"#FF3B3015":pctCapitalInmov>15?"#FF950015":"#34C75915",color:pctCapitalInmov>30?"#FF3B30":pctCapitalInmov>15?"#FF9500":"#34C759"}}>{pctCapitalInmov}%</span>
        </div>
        <div style={{fontSize:12,color:"#8E8E93",marginBottom:14}}>Stock sin rotación que atasca flujo</div>
        <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:12}}>
          <div style={{fontSize:28,fontWeight:800,color:"#AF52DE",letterSpacing:"-0.02em",lineHeight:1}}>{fmt(stockSinRotVal)}</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          <div style={{padding:"10px 12px",background:"#F8F8FA",borderRadius:8}}>
            <div style={{fontSize:10,color:"#8E8E93",fontWeight:600}}>SKUs sin venta</div>
            <div style={{fontSize:18,fontWeight:800,color:"#1C1C1E"}}>{deadStock.length}</div>
          </div>
          <div style={{padding:"10px 12px",background:"#F8F8FA",borderRadius:8}}>
            <div style={{fontSize:10,color:"#8E8E93",fontWeight:600}}>Unidades</div>
            <div style={{fontSize:18,fontWeight:800,color:"#1C1C1E"}}>{fN(sinVenta.reduce((s,p)=>s+(p.stock_actual||0),0))}</div>
          </div>
        </div>
        {deadStock.length>0&&<div style={{maxHeight:140,overflowY:"auto",marginTop:8,borderTop:"1px solid #F2F2F7",paddingTop:10}}>
          <div style={{fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",marginBottom:6}}>Top stock sin rotación</div>
          {deadStock.slice(0,5).map((p,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",fontSize:11}}>
            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:220,fontWeight:500}}>{p.producto}</span>
            <strong style={{color:"#AF52DE"}}>{fmt(p.valorStock)}</strong>
          </div>)}
        </div>}
      </div>
    </div>

    {/* ══════════════════════════════════════════ */}
    {/* TOP URGENTES + COBERTURA POR TIPO         */}
    {/* ══════════════════════════════════════════ */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      <div style={{background:"#fff",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",letterSpacing:"-0.02em"}}>🔥 Top 10 urgentes</div>
            <div style={{fontSize:12,color:"#8E8E93",marginTop:2}}>Cobertura más baja entre los que necesitan reposición</div>
          </div>
          <button onClick={()=>setTab&&setTab("repo")} style={{background:"none",border:"1px solid #E5E5EA",borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:600,color:"#007AFF",cursor:"pointer"}}>Ir a Reposición →</button>
        </div>
        <div style={{maxHeight:340,overflowY:"auto"}}>
          {enRepo.sort((a,b)=>(a.dias_cobertura||999)-(b.dias_cobertura||999)).slice(0,10).map((p,i)=>{
            const cobColor=p.dias_cobertura<7?"#FF3B30":p.dias_cobertura<15?"#FF9500":"#007AFF"
            return<div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:i<9?"1px solid #F2F2F7":"none"}}>
              <div style={{width:28,height:28,borderRadius:14,background:i<3?"#FF3B3015":"#F8F8FA",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:i<3?"#FF3B30":"#8E8E93",flexShrink:0}}>{i+1}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.producto}</div>
                <div style={{fontSize:10,color:"#8E8E93",marginTop:1}}>{p.tipo_producto} · <span style={{color:CL[p.clasif_abcd]?.c,fontWeight:700}}>{p.clasif_abcd}</span> · SKU {p.sku}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:14,fontWeight:800,color:cobColor}}>{p.dias_cobertura&&p.dias_cobertura<999?Math.round(p.dias_cobertura):0}d</div>
                <div style={{fontSize:10,color:"#8E8E93"}}>Repo: {fN(p.reposicion_necesaria)}</div>
              </div>
            </div>
          })}
          {enRepo.length===0&&<div style={{textAlign:"center",padding:40,color:"#34C759"}}><div style={{fontSize:32,marginBottom:8}}>🎉</div><div style={{fontSize:13,fontWeight:600}}>No hay productos en quiebre</div></div>}
        </div>
      </div>

      <div style={{background:"#fff",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",letterSpacing:"-0.02em",marginBottom:4}}>📊 Cobertura por tipo</div>
        <div style={{fontSize:12,color:"#8E8E93",marginBottom:14}}>Días promedio de stock disponible por categoría</div>
        <div style={{maxHeight:340,overflowY:"auto"}}>
          {tipoData.filter(t=>t.venta>0).slice(0,12).map((t,i)=>{const cobColor=t.cobProm<15?"#FF3B30":t.cobProm<30?"#FF9500":t.cobProm<60?"#007AFF":"#34C759";return<div key={i} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:600,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.tipo}</span>
              <div style={{display:"flex",gap:10,fontSize:11,alignItems:"center"}}>
                <span style={{color:cobColor,fontWeight:800,fontSize:13}}>{t.cobProm}d</span>
                {t.repos>0&&<span style={{color:"#FF3B30",fontWeight:700}}>{t.repos} repo</span>}
                <span style={{color:"#8E8E93"}}>{t.total} SKUs</span>
              </div>
            </div>
            <Bar pct={Math.min(t.cobProm,90)/90*100} color={cobColor} h={6}/>
          </div>})}
        </div>
      </div>
    </div>
  </div>
}

/* ═══ REPOSICIÓN ═══ */
function RepoView({prods,cart,setCart,go,config,params,paramsABCD,sucursales=[]}){
  const[q,setQ]=useState("");const[fc,setFc]=useState("T");const[ft,setFt]=useState("T");const[sortBy,setSortBy]=useState("costo_reposicion");const[fe,setFe]=useState("T");const[sortDir,setSortDir]=useState("desc")
  const[fsuc,setFsuc]=useState("T") // ⭐ filtro sucursal
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

    {/* ⭐ Tabs de sucursal */}
    {sucursales.length>0&&<div style={{background:"#fff",borderRadius:12,padding:"4px",marginBottom:10,display:"flex",gap:2,boxShadow:"0 1px 2px rgba(0,0,0,0.03)",border:"1px solid #E5E5EA"}}>
      <button onClick={()=>setFsuc("T")} style={{flex:1,padding:"10px 14px",borderRadius:8,fontSize:12,fontWeight:700,border:"none",cursor:"pointer",background:fsuc==="T"?"#1C1C1E":"transparent",color:fsuc==="T"?"#fff":"#8E8E93",transition:"all 0.2s"}}>
        🏢 Todas las sucursales
      </button>
      {sucursales.filter(s=>s.activo!==false).map(s=>{
        const active=fsuc===s.id
        const color=s.es_cd?"#5AC8FA":"#007AFF"
        return<button key={s.id} onClick={()=>setFsuc(s.id)} style={{flex:1,padding:"10px 14px",borderRadius:8,fontSize:12,fontWeight:700,border:"none",cursor:"pointer",background:active?color:"transparent",color:active?"#fff":"#8E8E93",transition:"all 0.2s",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
          <span>{s.es_cd?"🏭":"🏬"}</span>
          <span>{s.nombre}</span>
        </button>
      })}
    </div>}

    {/* Aviso si se selecciona sucursal específica */}
    {fsuc!=="T"&&(()=>{const suc=sucursales.find(s=>s.id===fsuc)
      return<div style={{padding:"10px 14px",background:suc?.es_cd?"#5AC8FA08":"#FF950008",borderRadius:10,border:`1px solid ${suc?.es_cd?"#5AC8FA30":"#FF950030"}`,marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:700,color:suc?.es_cd?"#5AC8FA":"#FF9500",marginBottom:3}}>{suc?.es_cd?"📊 Vista: CD Maipú":"📊 Vista filtrada por sucursal"}</div>
        <div style={{fontSize:11,color:"#636366",lineHeight:1.4}}>
          {suc?.es_cd
            ?"Las cifras mostradas corresponden a los totales del sistema. Todas las compras llegan primero al CD Maipú y desde ahí se redistribuyen internamente a las sucursales."
            :`Los datos actuales de BSALE son consolidados (suma de las 3 sucursales). Para ver la necesidad específica de ${suc?.nombre} necesitamos incorporar ventas y stock por sucursal en el upload del Excel. Por ahora este filtro es solo referencial.`}
        </div>
      </div>
    })()}

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
function SolView({cart,setCart,provs,users,sucursales=[],cu,setOcs,addFirma,goOC,ocs,config={}}){
  const TC_USD=Number(config.tc_usd)||950
  const[prov,setProv]=useState("");const[tipo,setTipo]=useState("Nacional");const[fEst,setFEst]=useState("");const[notas,setNotas]=useState("");const[done,setDone]=useState(null);const[saving,setSaving]=useState(false)
  // ⭐ Destino de la OC — default CD Maipú, excepción directo a sucursal
  const[destinoSucursal,setDestinoSucursal]=useState("")
  useEffect(()=>{if(!destinoSucursal&&sucursales.length>0){const cd=sucursales.find(s=>s.es_cd);setDestinoSucursal(cd?.id||sucursales[0]?.id||"")}},[sucursales])
  // Manual items (added from scratch)
  const[manualItems,setManualItems]=useState([])
  const addManual=()=>setManualItems(p=>[...p,{id:uid(),producto:"",sku:"",tipo_producto:"",cantidad:0,costo_unitario:0}])
  const updManual=(id,k,v)=>setManualItems(p=>p.map(i=>i.id===id?{...i,[k]:v}:i))
  const delManual=(id)=>setManualItems(p=>p.filter(i=>i.id!==id))

  // ⭐ Plan de pago configurable
  const[medioPago,setMedioPago]=useState("contado") // contado | credito
  const[numCuotas,setNumCuotas]=useState(1) // 1-4
  const[cuotas,setCuotas]=useState([{pct:100,fecha:"",concepto:"Pago único"}])
  const[diasCredito,setDiasCredito]=useState(30)

  // Al cambiar medio de pago, resetear cuotas
  const onMedioPagoChange=(m)=>{
    setMedioPago(m)
    if(m==="contado"){
      setNumCuotas(1)
      setCuotas([{pct:100,fecha:"",concepto:"Pago contado"}])
    }else{
      setNumCuotas(1)
      setCuotas([{pct:100,fecha:addDias(fEst||hoy(),diasCredito)||"",concepto:`Crédito ${diasCredito} días`}])
    }
  }

  // Al cambiar número de cuotas, redistribuir porcentajes
  const onNumCuotasChange=(n)=>{
    const num=Math.min(4,Math.max(1,Number(n)))
    setNumCuotas(num)
    const pctBase=Math.floor(100/num)
    const resto=100-pctBase*num
    const nc=[]
    for(let i=0;i<num;i++){
      const pct=pctBase+(i===0?resto:0)
      const diasOffset=medioPago==="credito"?diasCredito*(i+1):0
      nc.push({pct,fecha:addDias(fEst||hoy(),diasOffset)||"",concepto:num===1?(medioPago==="contado"?"Pago contado":`Crédito ${diasCredito} días`):`Cuota ${i+1} de ${num}`})
    }
    setCuotas(nc)
  }

  // Actualizar cuota individual
  const updCuota=(idx,k,v)=>setCuotas(p=>p.map((c,i)=>i===idx?{...c,[k]:v}:c))

  // Ajustar porcentajes al sumar 100%
  const totalPct=cuotas.reduce((s,c)=>s+(Number(c.pct)||0),0)

  // Al cambiar proveedor, pre-cargar su condición de pago
  const onProvChange=(id)=>{
    setProv(id)
    const s=provs.find(p=>p.id===id)
    if(s){
      setTipo(s.tipo)
      // Inferir medio de pago del proveedor
      const cond=(s.condicion_pago||"").toString().toLowerCase()
      if(cond.includes("contado")){
        setMedioPago("contado")
        setCuotas([{pct:100,fecha:"",concepto:"Pago contado"}])
        setNumCuotas(1)
      }else{
        const d=parseInt(cond.match(/\d+/)?.[0])||30
        setMedioPago("credito")
        setDiasCredito(d)
        setCuotas([{pct:100,fecha:addDias(fEst||hoy(),d)||"",concepto:`Crédito ${d} días`}])
        setNumCuotas(1)
      }
      // Si es importación, pre-cargar estructura de pagos del proveedor
      if(s.tipo==="Importación"&&(s.pct_fabricacion||s.pct_embarque||s.pct_puerto)){
        const cuotasImp=[]
        if(s.pct_fabricacion>0)cuotasImp.push({pct:s.pct_fabricacion,fecha:"",concepto:"Anticipo fabricación"})
        if(s.pct_embarque>0)cuotasImp.push({pct:s.pct_embarque,fecha:"",concepto:"Pago embarque"})
        if(s.pct_puerto>0)cuotasImp.push({pct:s.pct_puerto,fecha:"",concepto:"Pago puerto/saldo"})
        if(cuotasImp.length>0){
          setMedioPago("credito")
          setNumCuotas(cuotasImp.length)
          setCuotas(cuotasImp)
        }
      }
    }
  }

  // ⭐ Editar costo unitario — guarda costo_original para detectar modificaciones
  const setCosto=(sku,v)=>setCart(p=>{
    const it=p[sku];if(!it)return p
    const nuevoCosto=Math.max(0,Number(v)||0)
    const costoOriginal=it.costo_original!==undefined?it.costo_original:(it.costo_unitario||0)
    return{...p,[sku]:{...it,costo_unitario:nuevoCosto,costo_original:costoOriginal,costo_modificado:nuevoCosto!==costoOriginal}}
  })

  const sel=Object.values(cart)
  const allItems=[...sel.map(i=>({...i,source:"repo"})),...manualItems.map(i=>({...i,cp:i.cantidad,source:"manual"}))]
  const total=allItems.reduce((s,i)=>s+((i.cp||i.cantidad||0)*(i.costo_unitario||0)),0)
  const sp=provs.find(p=>p.id===prov)

  const nextNum=()=>{const prefix=tipo==="Importación"?"OC-IMP-":"OC-NAC-";const existing=(ocs||[]).filter(o=>o.id?.startsWith(prefix));const maxN=existing.reduce((m,o)=>{const n=parseInt(o.id.replace(prefix,""))||0;return n>m?n:m},0);return prefix+String(maxN+1).padStart(6,"0")}

  const submit=async()=>{
    // Validar que porcentajes sumen 100
    if(totalPct!==100){alert(`⚠ Los porcentajes del plan de pago suman ${totalPct}% en vez de 100%. Ajustá antes de enviar.`);return}
    // ⭐ Detectar costos modificados y preguntar si actualizar en productos
    const costosModificados=sel.filter(i=>i.costo_modificado&&i.sku&&!i.sku.startsWith("MANUAL-"))
    let actualizarCostosBD=false
    if(costosModificados.length>0){
      const lista=costosModificados.slice(0,8).map(i=>`• ${i.producto}: ${fmt(i.costo_original||0)} → ${fmt(i.costo_unitario)}`).join("\n")
      actualizarCostosBD=window.confirm(`✏ Modificaste el costo de ${costosModificados.length} producto(s).\n\n${lista}\n\n¿Actualizar el costo en la base de datos para futuras OCs?\n\n• OK → actualiza el costo del SKU\n• Cancelar → solo aplica a esta OC`)
    }
    setSaving(true);const isI=tipo==="Importación";const id=nextNum()
    const condPago=medioPago==="contado"?"Contado":(numCuotas>1?`${numCuotas} cuotas`:`Crédito ${diasCredito} días`)
    const oc={id,fecha_creacion:hoy(),solicitante_id:cu.id,proveedor_id:prov,tipo_oc:tipo,estado:"Pend. Dir. Negocios",fase_actual:1,total_clp:total,total_usd:isI?Math.round(total/TC_USD):0,condicion_pago:condPago,pct_fab:isI?(cuotas.find(c=>c.concepto.toLowerCase().includes("fabri"))?.pct||0):0,pct_embarque:isI?(cuotas.find(c=>c.concepto.toLowerCase().includes("embar"))?.pct||0):0,pct_puerto:isI?(cuotas.find(c=>c.concepto.toLowerCase().includes("puerto")||c.concepto.toLowerCase().includes("saldo"))?.pct||0):0,fecha_estimada:fEst||null,estado_pago:"Pago pend.",notas,destino_sucursal_id:destinoSucursal||null}
    const{error}=await supabase.from('ordenes_compra').insert(oc)
    if(error){alert("Error al crear OC: "+error.message);setSaving(false);return}
    // ⭐ Items con SKU único aunque haya varios manuales (index asegura unicidad)
    const items=allItems.map((i,idx)=>({id:uid(),oc_id:id,sku:i.sku||`MANUAL-${Date.now()}-${idx}`,producto:i.producto,cantidad_sugerida:i.reposicion_necesaria||0,cantidad_pedida:i.cp||i.cantidad||0,costo_unitario:i.costo_unitario||0}))
    const{error:itemsErr}=await supabase.from('oc_items').insert(items)
    if(itemsErr){
      // Rollback: borrar la OC recién creada
      await supabase.from('ordenes_compra').delete().eq('id',id)
      alert(`Error al guardar productos de la OC: ${itemsErr.message}\n\nLa OC fue revertida. Verificá los productos e intentá de nuevo.`)
      console.error("Error insertando oc_items:",itemsErr,"Items intentados:",items)
      setSaving(false);return
    }
    // ⭐ Insertar plan de pagos programados
    const moneda=sp?.moneda||"CLP"
    const totalRef=moneda==="USD"?(oc.total_usd||0):(oc.total_clp||0)
    const pagosRows=cuotas.map((c,i)=>({id:uid(),oc_id:id,concepto:c.concepto,monto:Math.round(totalRef*(c.pct||0)/100),moneda,fecha_programada:c.fecha||null,fecha_pago:null,estado:"Pendiente",etapa:c.concepto.toLowerCase().replace(/\s+/g,"_"),orden:i+1,pct:c.pct||0}))
    if(pagosRows.length>0){
      const{error:pagosErr}=await supabase.from('pagos').insert(pagosRows)
      if(pagosErr){console.error("Error insertando pagos (OC creada OK pero sin plan de pago):",pagosErr)}
    }
    // ⭐ Si confirmó, actualizar costos en productos
    if(actualizarCostosBD){
      for(const item of costosModificados){
        await supabase.from('productos').update({costo_unitario:item.costo_unitario}).eq('sku',item.sku)
      }
    }
    await addFirma(id,`Solicitud creada con ${items.length} producto(s)`);setOcs(p=>[oc,...p]);setCart({});setManualItems([]);setDone(oc)
    setSaving(false)}

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
            <Fl l="Proveedor" req><select value={prov} onChange={e=>onProvChange(e.target.value)} style={css.select}><option value="">Seleccionar...</option>{provs.filter(p=>p.activo).map(p=><option key={p.id} value={p.id}>{p.nombre} ({p.tipo})</option>)}</select></Fl>
          </div>
          <div>
            <Fl l="Fecha estimada" req><input type="date" value={fEst} onChange={e=>setFEst(e.target.value)} style={css.input}/></Fl>
            <Fl l="Destino" req>
              <select value={destinoSucursal} onChange={e=>setDestinoSucursal(e.target.value)} style={css.select}>
                {sucursales.filter(s=>s.activo!==false).map(s=><option key={s.id} value={s.id}>{s.nombre}{s.es_cd?" (Centro Distribución)":""}</option>)}
              </select>
              {(()=>{const suc=sucursales.find(s=>s.id===destinoSucursal);return suc&&!suc.es_cd?<div style={{fontSize:10,color:"#FF9500",marginTop:4,fontWeight:600}}>⚠ Entrega directa a sucursal · no pasa por CD Maipú</div>:null})()}
            </Fl>
            <Fl l="Observaciones"><textarea value={notas} onChange={e=>setNotas(e.target.value)} rows={2} style={{...css.input,resize:"vertical"}}/></Fl>
          </div>
        </div>

        {/* ⭐ Plan de Pago */}
        {prov&&<div style={{background:"#F9FAFB",borderRadius:10,padding:"16px 20px",marginBottom:20,border:"1px solid #E5E5EA"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1C1C1E",marginBottom:12,display:"flex",alignItems:"center",gap:6}}>💰 Plan de pago
            {totalPct!==100&&<span style={{fontSize:11,color:"#FF3B30",fontWeight:600}}>⚠ Suma {totalPct}% (debe ser 100%)</span>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
            <Fl l="Medio de pago">
              <select value={medioPago} onChange={e=>onMedioPagoChange(e.target.value)} style={css.select}>
                <option value="contado">Contado</option>
                <option value="credito">Crédito</option>
              </select>
            </Fl>
            {medioPago==="credito"&&<Fl l="Días de crédito">
              <select value={diasCredito} onChange={e=>{setDiasCredito(Number(e.target.value))}} style={css.select}>
                <option value={15}>15 días</option>
                <option value={30}>30 días</option>
                <option value={45}>45 días</option>
                <option value={60}>60 días</option>
                <option value={90}>90 días</option>
                <option value={120}>120 días</option>
              </select>
            </Fl>}
            <Fl l="Número de cuotas/pagos">
              <select value={numCuotas} onChange={e=>onNumCuotasChange(Number(e.target.value))} style={css.select}>
                <option value={1}>1 pago</option>
                <option value={2}>2 pagos</option>
                <option value={3}>3 pagos</option>
                <option value={4}>4 pagos</option>
              </select>
            </Fl>
          </div>

          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{background:"#F2F2F7"}}>
              <th style={{padding:"6px 8px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA"}}>Concepto</th>
              <th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"2px solid #E5E5EA",width:80}}>%</th>
              <th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"2px solid #E5E5EA",width:120}}>Monto estimado</th>
              <th style={{padding:"6px",fontSize:10,fontWeight:700,borderBottom:"2px solid #E5E5EA",width:150}}>Fecha programada</th>
            </tr></thead>
            <tbody>{cuotas.map((c,i)=>{
              const moneda=sp?.moneda||"CLP"
              const montoEst=Math.round(total*(c.pct||0)/100)
              return<tr key={i} style={{borderBottom:"1px solid #F2F2F7"}}>
                <td style={{padding:"6px 8px"}}><input value={c.concepto} onChange={e=>updCuota(i,"concepto",e.target.value)} style={{...css.input,padding:"5px 8px",fontSize:12}} placeholder="Ej: Anticipo fabricación"/></td>
                <td style={{padding:"6px"}}><input type="number" min={0} max={100} value={c.pct} onChange={e=>updCuota(i,"pct",Number(e.target.value))} style={{...css.input,padding:"5px 8px",fontSize:12,width:60,textAlign:"right"}}/></td>
                <td style={{padding:"6px",textAlign:"right",fontWeight:600,color:moneda==="USD"?"#34C759":"#007AFF"}}>{moneda==="USD"?fU(montoEst):fmt(montoEst)}</td>
                <td style={{padding:"6px"}}><input type="date" value={c.fecha||""} onChange={e=>updCuota(i,"fecha",e.target.value)} style={{...css.input,padding:"5px 8px",fontSize:12}}/></td>
              </tr>
            })}</tbody>
            <tfoot><tr style={{background:"#F8F8FA"}}>
              <td style={{padding:"8px",fontWeight:700}}>TOTAL</td>
              <td style={{padding:"8px",textAlign:"right",fontWeight:700,color:totalPct===100?"#34C759":"#FF3B30"}}>{totalPct}%</td>
              <td style={{padding:"8px",textAlign:"right",fontWeight:700}}>{sp?.moneda==="USD"?fU(total):fmt(total)}</td>
              <td></td>
            </tr></tfoot>
          </table>
        </div>}

        {/* Products from Reposición */}
        {sel.length>0&&<><div style={{fontSize:12,fontWeight:700,color:"#007AFF",textTransform:"uppercase",marginBottom:6}}>Productos desde reposición ({sel.length})</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:16}}>
          <thead><tr style={{background:"#F8F8FA"}}><th style={{padding:"8px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA"}}>Producto</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"2px solid #E5E5EA"}}>Cantidad</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"2px solid #E5E5EA"}}>Costo U.</th><th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"2px solid #E5E5EA"}}>Subtotal</th></tr></thead>
          <tbody>{sel.map((i,idx)=><tr key={idx} style={{borderBottom:"1px solid #F2F2F7"}}>
            <td style={{padding:"8px"}}><div style={{fontWeight:600}}>{i.producto}</div><div style={{fontSize:10,color:"#AEAEB2"}}>{i.sku}</div></td>
            <td style={{padding:"8px",textAlign:"right",color:"#007AFF",fontWeight:700}}>{fN(i.cp)}</td>
            <td style={{padding:"8px",textAlign:"right"}}>
              <input type="number" min={0} step="any" value={i.costo_unitario||0} onChange={e=>setCosto(i.sku,e.target.value)}
                style={{...css.input,padding:"5px 8px",fontSize:12,width:90,textAlign:"right",
                  borderColor:i.costo_modificado?"#FF9500":((i.costo_unitario||0)===0?"#FF3B3060":"#E5E5EA"),
                  background:i.costo_modificado?"#FFF8EC":((i.costo_unitario||0)===0?"#FFEEEE":"#fff")}}
                title={i.costo_modificado?`Original: ${fmt(i.costo_original)}`:((i.costo_unitario||0)===0?"⚠ Costo en $0":"Costo unitario")}/>
              {i.costo_modificado&&<div style={{fontSize:9,color:"#FF9500",marginTop:2,fontWeight:600}}>✏ modificado</div>}
            </td>
            <td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{fmt(i.cp*(i.costo_unitario||0))}</td>
          </tr>)}</tbody>
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

/* ═══ PAGOS EDITOR — Editor de plan de pago post-creación ═══ */
function PagosEditor({oc,pagos,setPagos,cu,puedeEditar,addFirma,TC_USD=950}){
  const[editMode,setEditMode]=useState(false)
  const[editing,setEditing]=useState([]) // copia local editable
  const[saving,setSaving]=useState(false)
  const[monedaOC,setMonedaOC]=useState(pagos[0]?.moneda||"CLP")

  const pagosOrdenados=[...pagos].sort((a,b)=>(a.orden||0)-(b.orden||0))
  const tienePagosEjecutados=pagos.some(p=>p.estado==="Pagado")

  const abrirEdicion=()=>{
    setEditing(pagosOrdenados.map(p=>({...p})))
    setMonedaOC(pagos[0]?.moneda||"CLP")
    setEditMode(true)
  }

  const cancelar=()=>{setEditMode(false);setEditing([])}

  const updateCuota=(idx,campo,valor)=>{
    setEditing(prev=>prev.map((c,i)=>i===idx?{...c,[campo]:valor}:c))
  }

  const agregarCuota=()=>{
    setEditing(prev=>[...prev,{id:uid(),oc_id:oc.id,concepto:"Nueva cuota",monto:0,moneda:monedaOC,fecha_programada:null,estado:"Pendiente",orden:prev.length+1,pct:0,__nueva:true}])
  }

  const eliminarCuota=(idx)=>{
    const c=editing[idx]
    if(c.estado==="Pagado"){alert("⚠ No se puede eliminar una cuota ya pagada. Primero anulá el pago.");return}
    if(!window.confirm(`¿Eliminar la cuota "${c.concepto}" por ${c.moneda==="USD"?fU(c.monto):fmt(c.monto)}?`))return
    setEditing(prev=>prev.filter((_,i)=>i!==idx))
  }

  const cambiarMonedaGlobal=(nuevaMoneda)=>{
    if(tienePagosEjecutados){
      if(!window.confirm(`⚠ Hay pagos ya ejecutados. Cambiar la moneda de la OC no modificará los pagos históricos pero sí los pendientes.\n\n¿Continuar?`))return
    }
    setMonedaOC(nuevaMoneda)
    setEditing(prev=>prev.map(c=>c.estado==="Pagado"?c:{...c,moneda:nuevaMoneda}))
  }

  // ⭐ Recalcular: reparte el total de la OC según los porcentajes actuales en la moneda seleccionada
  const recalcularMontos=()=>{
    const pendientes=editing.filter(c=>c.estado!=="Pagado")
    if(pendientes.length===0){alert("No hay cuotas pendientes para recalcular");return}

    // Calcular total a repartir: total OC menos lo ya pagado
    const yaPagadoCLP=editing.filter(c=>c.estado==="Pagado").reduce((s,c)=>{
      if(c.moneda==="USD"&&c.tipo_cambio)return s+(c.monto*c.tipo_cambio)
      if(c.moneda==="USD")return s+(c.monto*TC_USD) // fallback TC
      return s+c.monto
    },0)
    const totalOC_CLP=oc.total_clp||0
    const totalOC_USD=oc.total_usd||Math.round(totalOC_CLP/TC_USD)
    const restanteCLP=Math.max(0,totalOC_CLP-yaPagadoCLP)
    const restanteUSD=Math.max(0,totalOC_USD-Math.round(yaPagadoCLP/TC_USD))

    // Redistribuir según pct o en partes iguales si no hay pct
    const sumaPct=pendientes.reduce((s,c)=>s+Number(c.pct||0),0)
    const usarPct=sumaPct>0

    const msg=`Se repartirá el total restante (${fmt(restanteCLP)} CLP / ${fU(restanteUSD)}) entre ${pendientes.length} cuotas pendientes en moneda ${monedaOC}.\n\n¿Confirmar?`
    if(!window.confirm(msg))return

    setEditing(prev=>prev.map(c=>{
      if(c.estado==="Pagado")return c
      const pctCuota=usarPct?(Number(c.pct||0)/sumaPct):(1/pendientes.length)
      const nuevoMonto=monedaOC==="USD"?Math.round(restanteUSD*pctCuota):Math.round(restanteCLP*pctCuota)
      return{...c,monto:nuevoMonto,moneda:monedaOC}
    }))
  }

  const guardar=async()=>{
    // Validaciones
    if(editing.length===0){alert("⚠ Al menos una cuota es necesaria");return}
    for(const c of editing){
      if(!c.concepto?.trim()){alert("⚠ Falta el concepto en una cuota");return}
      if(!c.monto||c.monto<0){alert(`⚠ Monto inválido en "${c.concepto}"`);return}
    }
    setSaving(true)
    try{
      // IDs originales vs actuales (para detectar eliminaciones)
      const idsOriginales=pagos.map(p=>p.id)
      const idsActuales=editing.map(p=>p.id)
      const idsEliminados=idsOriginales.filter(id=>!idsActuales.includes(id))

      // Eliminar los que fueron borrados (excepto pagados)
      if(idsEliminados.length>0){
        const aEliminar=pagos.filter(p=>idsEliminados.includes(p.id)&&p.estado!=="Pagado")
        if(aEliminar.length>0){
          const ids=aEliminar.map(p=>p.id)
          await supabase.from('pagos').delete().in('id',ids)
        }
      }

      // Upsert de todos los actuales
      for(let i=0;i<editing.length;i++){
        const c={...editing[i]}
        c.orden=i+1
        delete c.__nueva
        // Recalcular monto_clp si la moneda es USD
        if(c.moneda==="USD"&&c.tipo_cambio){c.monto_clp=Math.round(c.monto*c.tipo_cambio)}
        else if(c.moneda==="CLP"){c.monto_clp=c.monto;c.tipo_cambio=1}

        if(idsOriginales.includes(c.id)){
          // update
          await supabase.from('pagos').update({
            concepto:c.concepto,monto:c.monto,moneda:c.moneda,
            fecha_programada:c.fecha_programada||null,
            monto_clp:c.monto_clp,tipo_cambio:c.tipo_cambio||null,
            pct:c.pct||null,orden:c.orden
          }).eq('id',c.id)
        }else{
          // insert
          await supabase.from('pagos').insert({
            id:c.id,oc_id:oc.id,concepto:c.concepto,monto:c.monto,moneda:c.moneda,
            fecha_programada:c.fecha_programada||null,estado:"Pendiente",
            etapa:c.concepto.toLowerCase().replace(/\s+/g,"_"),
            orden:c.orden,pct:c.pct||0,monto_clp:c.monto_clp,tipo_cambio:c.tipo_cambio||null
          })
        }
      }

      // Recargar
      const{data:nuevos}=await supabase.from('pagos').select('*').eq('oc_id',oc.id)
      setPagos(prev=>{
        const otros=prev.filter(p=>p.oc_id!==oc.id)
        return[...otros,...(nuevos||[])]
      })

      await addFirma(oc.id,`Plan de pago editado por ${cu?.nombre||"admin"}: ${editing.length} cuota(s) · moneda ${monedaOC}`)
      setEditMode(false)
      setEditing([])
    }catch(e){
      alert("Error al guardar: "+e.message)
    }
    setSaving(false)
  }

  const totalActual=editing.reduce((s,c)=>s+Number(c.monto||0),0)

  // Totales por moneda (en modo lectura)
  const totalCLP_plan=pagos.filter(p=>p.moneda!=="USD").reduce((s,p)=>s+Number(p.monto||0),0)
  const totalUSD_plan=pagos.filter(p=>p.moneda==="USD").reduce((s,p)=>s+Number(p.monto||0),0)
  // Inconsistencia: si toda la OC es CLP pero los pagos son USD o viceversa
  const ocEsIMP=oc.tipo_oc==="Importación"
  const hayPagosUSD=totalUSD_plan>0
  const hayPagosCLP=totalCLP_plan>0
  const sumaUSDenCLP=totalUSD_plan*TC_USD
  const totalPlanAprox=totalCLP_plan+sumaUSDenCLP
  const ocTotalCLP=oc.total_clp||0
  const diferencia=Math.abs(totalPlanAprox-ocTotalCLP)
  const pctDiferencia=ocTotalCLP>0?diferencia/ocTotalCLP*100:0
  const inconsistente=pctDiferencia>10

  if(!editMode){
    // Vista normal (lectura)
    return<div style={{marginTop:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div style={{fontSize:15,fontWeight:700}}>💰 Plan de pago</div>
        {puedeEditar&&<Bt sm v="gry" onClick={abrirEdicion} ic="✏️">Editar plan</Bt>}
      </div>

      {/* Alerta de inconsistencia */}
      {inconsistente&&puedeEditar&&<div style={{padding:"10px 14px",background:"#FF3B3010",borderRadius:10,border:"1px solid #FF3B3040",marginBottom:10}}>
        <div style={{fontSize:12,fontWeight:700,color:"#FF3B30",marginBottom:3}}>⚠ Inconsistencia detectada</div>
        <div style={{fontSize:11,color:"#636366",lineHeight:1.4}}>
          El total de la OC es <strong>{fmt(ocTotalCLP)}</strong>{oc.total_usd>0?` (${fU(oc.total_usd)})`:""} pero la suma del plan de pago es aproximadamente <strong>{fmt(totalPlanAprox)}</strong> (TC ~$950).
          Diferencia: {Math.round(pctDiferencia)}%. Probablemente las cuotas se generaron en moneda incorrecta.
          Hacé click en <strong>Editar plan</strong> para corregir manualmente o usar "Recalcular".
        </div>
      </div>}

      {pagosOrdenados.map((p,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #F2F2F7",fontSize:13}}>
        <span>{p.concepto}{p.fecha_programada?<span style={{fontSize:11,color:"#8E8E93",marginLeft:8}}>· {p.fecha_programada}</span>:null}</span>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <strong>{p.moneda==="USD"?fU(p.monto):fmt(p.monto)}</strong>
          <Bd c={p.estado==="Pagado"?"#34C759":"#FF9500"} bg={p.estado==="Pagado"?"#34C75915":"#FF950015"}>{p.estado}</Bd>
        </div>
      </div>)}

      {/* Total del plan */}
      <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",fontSize:13,borderTop:"2px solid #1C1C1E",marginTop:6}}>
        <strong>Total del plan</strong>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {totalCLP_plan>0&&<strong style={{color:"#007AFF"}}>{fmt(totalCLP_plan)}</strong>}
          {totalCLP_plan>0&&totalUSD_plan>0&&<span style={{color:"#AEAEB2"}}>+</span>}
          {totalUSD_plan>0&&<strong style={{color:"#34C759"}}>{fU(totalUSD_plan)}</strong>}
        </div>
      </div>
    </div>
  }

  // Vista edición
  return<div style={{marginTop:16,background:"#FFF8E7",borderRadius:12,padding:"14px 16px",border:"1px solid #FFE4A0"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
      <div>
        <div style={{fontSize:14,fontWeight:700,color:"#946200"}}>✏️ Editando plan de pago</div>
        <div style={{fontSize:11,color:"#946200",marginTop:2}}>Podés cambiar moneda, montos, fechas y agregar/eliminar cuotas</div>
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <span style={{fontSize:11,fontWeight:700,color:"#946200"}}>Moneda OC:</span>
        <div style={{display:"flex",gap:3,background:"#fff",borderRadius:6,padding:2}}>
          {["CLP","USD"].map(m=><button key={m} onClick={()=>cambiarMonedaGlobal(m)} style={{padding:"5px 12px",borderRadius:4,fontSize:11,fontWeight:700,border:"none",cursor:"pointer",background:monedaOC===m?(m==="USD"?"#34C759":"#007AFF"):"transparent",color:monedaOC===m?"#fff":"#8E8E93"}}>{m}</button>)}
        </div>
      </div>
    </div>

    {tienePagosEjecutados&&<div style={{padding:"8px 12px",background:"#FF950015",borderRadius:8,marginBottom:10,fontSize:11,color:"#946200"}}>
      ⚠ Hay pagos ya ejecutados. Podés editarlos pero con cautela — los cambios afectan la bitácora histórica.
    </div>}

    {/* Tabla editable */}
    <div style={{background:"#fff",borderRadius:8,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{background:"#F8F8FA"}}>
          <th style={{padding:"8px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366"}}>Concepto</th>
          <th style={{padding:"8px",textAlign:"right",fontSize:10,fontWeight:700,color:"#636366",width:100}}>Monto</th>
          <th style={{padding:"8px",textAlign:"center",fontSize:10,fontWeight:700,color:"#636366",width:75}}>Moneda</th>
          <th style={{padding:"8px",textAlign:"center",fontSize:10,fontWeight:700,color:"#636366",width:130}}>Fecha programada</th>
          <th style={{padding:"8px",textAlign:"center",fontSize:10,fontWeight:700,color:"#636366",width:85}}>Estado</th>
          <th style={{padding:"8px",width:40}}></th>
        </tr></thead>
        <tbody>{editing.map((c,i)=>{
          const esPagado=c.estado==="Pagado"
          return<tr key={i} style={{borderBottom:"1px solid #F2F2F7",background:esPagado?"#34C75906":c.__nueva?"#007AFF08":"transparent"}}>
            <td style={{padding:"6px"}}>
              <input value={c.concepto} onChange={e=>updateCuota(i,"concepto",e.target.value)} disabled={esPagado}
                style={{...css.input,padding:"5px 8px",fontSize:12,background:esPagado?"#F8F8FA":"#fff"}}/>
            </td>
            <td style={{padding:"6px"}}>
              <input type="number" min={0} step="any" value={c.monto||0} onChange={e=>updateCuota(i,"monto",Number(e.target.value)||0)} disabled={esPagado}
                style={{width:"100%",padding:"5px 8px",textAlign:"right",fontWeight:700,borderRadius:6,border:"1px solid #E5E5EA",fontSize:12,background:esPagado?"#F8F8FA":"#fff"}}/>
            </td>
            <td style={{padding:"6px"}}>
              <select value={c.moneda||"CLP"} onChange={e=>updateCuota(i,"moneda",e.target.value)} disabled={esPagado}
                style={{width:"100%",padding:"5px 4px",borderRadius:6,border:"1px solid #E5E5EA",fontSize:12,fontWeight:600,background:esPagado?"#F8F8FA":"#fff"}}>
                <option value="CLP">CLP</option>
                <option value="USD">USD</option>
              </select>
            </td>
            <td style={{padding:"6px"}}>
              <input type="date" value={c.fecha_programada||""} onChange={e=>updateCuota(i,"fecha_programada",e.target.value)} disabled={esPagado}
                style={{width:"100%",padding:"5px 4px",borderRadius:6,border:"1px solid #E5E5EA",fontSize:11,background:esPagado?"#F8F8FA":"#fff"}}/>
            </td>
            <td style={{padding:"6px",textAlign:"center"}}>
              <Bd c={esPagado?"#34C759":"#FF9500"} bg={esPagado?"#34C75915":"#FF950015"}>{c.estado}</Bd>
            </td>
            <td style={{padding:"6px",textAlign:"center"}}>
              <button onClick={()=>eliminarCuota(i)} disabled={esPagado} title={esPagado?"No se puede eliminar un pago ejecutado":"Eliminar cuota"}
                style={{padding:"4px 8px",fontSize:12,background:esPagado?"#F2F2F7":"#FF3B3015",color:esPagado?"#AEAEB2":"#FF3B30",border:"none",borderRadius:5,cursor:esPagado?"not-allowed":"pointer",fontWeight:600}}>🗑</button>
            </td>
          </tr>
        })}</tbody>
        <tfoot><tr style={{background:"#F8F8FA",borderTop:"2px solid #1C1C1E"}}>
          <td style={{padding:"8px",fontWeight:700}}>TOTAL · {editing.length} cuota(s)</td>
          <td style={{padding:"8px",textAlign:"right",fontWeight:800,fontSize:14,color:monedaOC==="USD"?"#34C759":"#007AFF"}}>{monedaOC==="USD"?fU(totalActual):fmt(totalActual)}</td>
          <td colSpan={4}></td>
        </tr></tfoot>
      </table>
    </div>

    <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
      <Bt v="gry" sm onClick={agregarCuota} ic="➕">Agregar cuota</Bt>
      <Bt v="pri" sm onClick={recalcularMontos} ic="🔄">Recalcular desde total OC</Bt>
      <div style={{flex:1}}/>
      <Bt v="gry" sm onClick={cancelar}>Cancelar</Bt>
      <Bt v="suc" sm onClick={guardar} dis={saving} ic={saving?"⏳":"💾"}>{saving?"Guardando...":"Guardar cambios"}</Bt>
    </div>
  </div>
}

/* ═══ OC DETAIL — With parametric reception, provider validation, document attachments ═══ */
function OCDetView({oc,firmas,pagos,provs=[],updOC,addFirma,setPagos,close,cu,h,config={}}){
  const TC_USD=Number(config.tc_usd)||950
  const[rf,setRf]=useState(hoy());const[rr,setRr]=useState(cu?.nombre||"Jefe Bodega");const[rd,setRd]=useState("");const isI=oc.tipo_oc==="Importación"
  const[items,setItems]=useState([]);const[recQty,setRecQty]=useState({});const[provQty,setProvQty]=useState({});const[provNotas,setProvNotas]=useState("")
  const[docs,setDocs]=useState([]);const[uploading,setUploading]=useState(false);const[pendingFiles,setPendingFiles]=useState([]);const[saveMsg,setSaveMsg]=useState("")
  useEffect(()=>{supabase.from('oc_items').select('*').eq('oc_id',oc.id).then(r=>{const d=r.data||[];setItems(d);const q={};const pq={};d.forEach(i=>{q[i.id]=i.cantidad_pedida||0;pq[i.id]=i.cantidad_confirmada||i.cantidad_pedida||0});setRecQty(q);setProvQty(pq)})},[oc.id])
  useEffect(()=>{supabase.from('documentos_import').select('*').eq('oc_id',oc.id).order('created_at',{ascending:false}).then(r=>{console.log("Loaded docs for OC:",oc.id,r.data?.length,"docs",r.error);setDocs(r.data||[])})},[oc.id])

  // ⭐ Recepciones parciales (guías + facturas)
  const prov=provs.find(p=>p.id===oc.proveedor_id)
  const facturaConGuia=prov?.factura_con_guia||false
  const[recepciones,setRecepciones]=useState([])
  const[costeos,setCosteos]=useState([])
  useEffect(()=>{if(!isI){setCosteos([]);return};supabase.from('costeos_oc').select('*').eq('oc_id',oc.id).order('created_at',{ascending:false}).then(r=>setCosteos(r.data||[]))},[oc.id])
  const eliminarCosteo=async(c)=>{
    if(!window.confirm(`¿Eliminar este costeo del historial?\n\nFecha: ${c.fecha}\nCosto unit. bodega: ${fmt(c.costo_unit_bodega)}`))return
    await supabase.from('costeos_oc').delete().eq('id',c.id)
    setCosteos(prev=>prev.filter(x=>x.id!==c.id))
    await addFirma(oc.id,`Costeo del ${c.fecha} eliminado del historial`)
  }
  const[recepcionItems,setRecepcionItems]=useState([])
  const[recepcionLinks,setRecepcionLinks]=useState([])
  const[showRecModal,setShowRecModal]=useState(false)
  const[recForm,setRecForm]=useState({tipo:"guia",numero_doc:"",fecha:hoy(),monto:"",moneda:"CLP",archivo:null,archivoNombre:"",notas:"",itemsQty:{},facturasVinculadas:[]})

  useEffect(()=>{supabase.from('recepciones').select('*').eq('oc_id',oc.id).order('fecha',{ascending:true}).then(r=>setRecepciones(r.data||[]))},[oc.id])
  useEffect(()=>{(async()=>{if(!recepciones.length){setRecepcionItems([]);setRecepcionLinks([]);return}const ids=recepciones.map(r=>r.id);const[ri,rl]=await Promise.all([supabase.from('recepciones_items').select('*').in('recepcion_id',ids),supabase.from('recepciones_link').select('*').or(`guia_id.in.(${ids.join(',')}),factura_id.in.(${ids.join(',')})`)]);setRecepcionItems(ri.data||[]);setRecepcionLinks(rl.data||[])})()},[recepciones])

  // Calcular acumulados
  const accRecibido={};const accFacturado={} // {sku: cantidad}
  const accMonto={facturado:0,facturadoUSD:0}
  recepciones.forEach(r=>{
    const itemsOfRec=recepcionItems.filter(i=>i.recepcion_id===r.id)
    if(r.tipo==="guia"||r.tipo==="guia_factura"){
      itemsOfRec.forEach(i=>{accRecibido[i.sku]=(accRecibido[i.sku]||0)+Number(i.cantidad||0)})
    }
    if(r.tipo==="factura"||r.tipo==="guia_factura"){
      itemsOfRec.forEach(i=>{accFacturado[i.sku]=(accFacturado[i.sku]||0)+Number(i.cantidad||0)})
      if(r.moneda==="USD")accMonto.facturadoUSD+=Number(r.monto||0)
      else accMonto.facturado+=Number(r.monto||0)
    }
  })

  const totalPedidoOC=items.reduce((s,i)=>s+(i.cantidad_pedida||0),0)
  const totalRecibidoAcum=Object.values(accRecibido).reduce((s,v)=>s+v,0)
  const totalFacturadoAcum=Object.values(accFacturado).reduce((s,v)=>s+v,0)
  const pctRecibidoAcum=totalPedidoOC>0?Math.round(totalRecibidoAcum/totalPedidoOC*100):0
  const pctFacturadoAcum=totalPedidoOC>0?Math.round(totalFacturadoAcum/totalPedidoOC*100):0
  const esImp=isI

  const abrirRecModal=(tipo)=>{
    const itemsQty={};items.forEach(i=>{itemsQty[i.id]=0})
    setRecForm({tipo:tipo||(facturaConGuia?"guia_factura":"guia"),numero_doc:"",fecha:hoy(),monto:"",moneda:esImp?"USD":"CLP",archivo:null,archivoNombre:"",notas:"",itemsQty,facturasVinculadas:[]})
    setShowRecModal(true)
  }

  const guardarRecepcion=async()=>{
    if(!recForm.numero_doc.trim()){alert("⚠ Falta el número de documento");return}
    const itemsConCant=items.filter(i=>Number(recForm.itemsQty[i.id]||0)>0)
    if(itemsConCant.length===0){alert("⚠ Ingresá al menos un ítem con cantidad > 0");return}
    // Validar que no supere lo pendiente por recibir/facturar
    const tipoEsRec=recForm.tipo==="guia"||recForm.tipo==="guia_factura"
    const tipoEsFac=recForm.tipo==="factura"||recForm.tipo==="guia_factura"
    for(const it of itemsConCant){
      const cant=Number(recForm.itemsQty[it.id])
      if(tipoEsRec){const pend=(it.cantidad_pedida||0)-(accRecibido[it.sku]||0);if(cant>pend){alert(`⚠ ${it.producto}: cantidad recibida (${cant}) supera lo pendiente (${pend})`);return}}
      if(tipoEsFac&&!tipoEsRec){const pend=(it.cantidad_pedida||0)-(accFacturado[it.sku]||0);if(cant>pend){alert(`⚠ ${it.producto}: cantidad facturada (${cant}) supera lo pendiente de facturar (${pend})`);return}}
    }
    if(tipoEsFac&&(!recForm.monto||Number(recForm.monto)<=0)){alert("⚠ Factura: el monto es obligatorio");return}

    // Subir archivo si hay
    let archivo_url="",archivo_nombre=""
    if(recForm.archivo){
      const sanitize=s=>(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"_").replace(/_+/g,"_")
      const ext=recForm.archivoNombre.split(".").pop()||"pdf"
      const path=`${sanitize(oc.id)}/${recForm.tipo}_${sanitize(recForm.numero_doc)}_${Date.now()}.${ext}`
      const{error:upErr}=await supabase.storage.from('comprobantes').upload(path,recForm.archivo,{upsert:true})
      if(upErr){alert("Error subiendo archivo: "+upErr.message);return}
      const{data:urlData}=supabase.storage.from('comprobantes').getPublicUrl(path)
      archivo_url=urlData?.publicUrl||""
      archivo_nombre=recForm.archivoNombre
    }

    // Insertar recepción
    const recId=uid()
    const{error:rErr}=await supabase.from('recepciones').insert({
      id:recId,oc_id:oc.id,tipo:recForm.tipo,numero_doc:recForm.numero_doc,fecha:recForm.fecha,
      monto:tipoEsFac?Number(recForm.monto):null,moneda:tipoEsFac?recForm.moneda:null,
      archivo_url,archivo_nombre,notas:recForm.notas||null,registrado_por:cu?.id
    })
    if(rErr){alert("Error: "+rErr.message);return}

    // Insertar ítems
    const itemsRows=itemsConCant.map(it=>({id:uid(),recepcion_id:recId,oc_item_id:it.id,sku:it.sku,producto:it.producto,cantidad:Number(recForm.itemsQty[it.id])}))
    await supabase.from('recepciones_items').insert(itemsRows)

    // Si es factura y hay guías vinculadas, crear links
    if(recForm.tipo==="factura"&&recForm.facturasVinculadas.length>0){
      const links=recForm.facturasVinculadas.map(gId=>({id:uid(),guia_id:gId,factura_id:recId}))
      await supabase.from('recepciones_link').insert(links)
    }

    // Registrar en firmas
    const labelTipo=recForm.tipo==="guia"?"Guía":recForm.tipo==="factura"?"Factura":"Guía+Factura"
    const totalCant=itemsConCant.reduce((s,i)=>s+Number(recForm.itemsQty[i.id]),0)
    await addFirma(oc.id,`${labelTipo} #${recForm.numero_doc} registrada: ${totalCant} uds${tipoEsFac?` · ${recForm.moneda} ${fN(recForm.monto)}`:""}`)

    // Recargar
    const{data:recs}=await supabase.from('recepciones').select('*').eq('oc_id',oc.id).order('fecha',{ascending:true})
    setRecepciones(recs||[])

    // Auto-actualizar estado de la OC
    const nuevoAccRecibido={...accRecibido}
    if(tipoEsRec){itemsConCant.forEach(it=>{nuevoAccRecibido[it.sku]=(nuevoAccRecibido[it.sku]||0)+Number(recForm.itemsQty[it.id])})}
    const nuevoTotalRecibido=Object.values(nuevoAccRecibido).reduce((s,v)=>s+v,0)
    const nuevoPctRecibido=totalPedidoOC>0?nuevoTotalRecibido/totalPedidoOC*100:0
    if(tipoEsRec){
      if(nuevoPctRecibido>=100)await updOC(oc.id,{estado:"Recibida OK",fase_actual:esImp?13:6,fecha_real_recepcion:recForm.fecha})
      else if(nuevoPctRecibido>0)await updOC(oc.id,{estado:"Recibida parcial",fase_actual:esImp?13:6,fecha_real_recepcion:oc.fecha_real_recepcion||recForm.fecha})
    }

    setShowRecModal(false)
  }

  const eliminarRecepcion=async(rec)=>{
    if(!window.confirm(`¿Eliminar ${rec.tipo==="guia"?"guía":rec.tipo==="factura"?"factura":"documento"} #${rec.numero_doc}?`))return
    await supabase.from('recepciones').delete().eq('id',rec.id)
    const{data:recs}=await supabase.from('recepciones').select('*').eq('oc_id',oc.id).order('fecha',{ascending:true})
    setRecepciones(recs||[])
    await addFirma(oc.id,`Eliminada ${rec.tipo==="guia"?"guía":"factura"} #${rec.numero_doc}`)
  }

  // ⭐ Edición de items post-creación
  const estadosBloqueados=["Recibida OK","Recibida parcial","Cerrada","Rechazada"]
  const tienePermisoEdicion=h("aprobar_neg")||h("aprobar_fin")||h("crear_oc")||cu?.rol==="admin"||cu?.rol==="dir_general"
  const puedeEditarItems=!estadosBloqueados.includes(oc.estado)&&tienePermisoEdicion
  const[editingItem,setEditingItem]=useState(null)
  const[editDraft,setEditDraft]=useState({})
  const[addingItem,setAddingItem]=useState(false)
  const[newItem,setNewItem]=useState({producto:"",sku:"",cantidad_pedida:0,costo_unitario:0})
  const[savingEdit,setSavingEdit]=useState(false)

  const startEditItem=(it)=>{setEditingItem(it.id);setEditDraft({producto:it.producto||"",cantidad_pedida:it.cantidad_pedida||0,costo_unitario:it.costo_unitario||0})}
  const cancelEdit=()=>{setEditingItem(null);setEditDraft({})}

  const saveItemEdit=async(it)=>{
    setSavingEdit(true)
    const changes={}
    if(editDraft.producto!==it.producto)changes.producto=editDraft.producto
    if(Number(editDraft.cantidad_pedida)!==it.cantidad_pedida)changes.cantidad_pedida=Number(editDraft.cantidad_pedida)
    if(Number(editDraft.costo_unitario)!==it.costo_unitario)changes.costo_unitario=Number(editDraft.costo_unitario)
    if(Object.keys(changes).length===0){setSavingEdit(false);setEditingItem(null);return}
    const{error}=await supabase.from('oc_items').update(changes).eq('id',it.id)
    if(error){alert("Error: "+error.message);setSavingEdit(false);return}
    const newItems=items.map(x=>x.id===it.id?{...x,...changes}:x);setItems(newItems)
    const nuevoTotal=newItems.reduce((s,x)=>s+((x.cantidad_pedida||0)*(x.costo_unitario||0)),0)
    await updOC(oc.id,{total_clp:nuevoTotal,total_usd:isI?Math.round(nuevoTotal/TC_USD):0})
    await addFirma(oc.id,`Item editado: ${it.sku} (${Object.entries(changes).map(([k,v])=>`${k}:${typeof v==='number'?fN(v):v}`).join(", ")})`)
    setEditingItem(null);setEditDraft({});setSavingEdit(false)
  }

  const deleteItem=async(it)=>{
    if(!window.confirm(`¿Eliminar "${it.producto}" (${it.sku}) de la OC?`))return
    setSavingEdit(true)
    const{error}=await supabase.from('oc_items').delete().eq('id',it.id)
    if(error){alert("Error: "+error.message);setSavingEdit(false);return}
    const newItems=items.filter(x=>x.id!==it.id);setItems(newItems)
    const nuevoTotal=newItems.reduce((s,x)=>s+((x.cantidad_pedida||0)*(x.costo_unitario||0)),0)
    await updOC(oc.id,{total_clp:nuevoTotal,total_usd:isI?Math.round(nuevoTotal/TC_USD):0})
    await addFirma(oc.id,`Item eliminado: ${it.sku} — ${it.producto}`)
    setSavingEdit(false)
  }

  const saveNewItem=async()=>{
    if(!newItem.producto){alert("Falta nombre del producto");return}
    if((newItem.cantidad_pedida||0)<=0){alert("Cantidad debe ser mayor a 0");return}
    setSavingEdit(true)
    const row={id:uid(),oc_id:oc.id,sku:newItem.sku||"MANUAL-"+Date.now(),producto:newItem.producto,cantidad_sugerida:0,cantidad_pedida:Number(newItem.cantidad_pedida),costo_unitario:Number(newItem.costo_unitario||0)}
    const{error}=await supabase.from('oc_items').insert(row)
    if(error){alert("Error: "+error.message);setSavingEdit(false);return}
    const newItems=[...items,row];setItems(newItems)
    const nuevoTotal=newItems.reduce((s,x)=>s+((x.cantidad_pedida||0)*(x.costo_unitario||0)),0)
    await updOC(oc.id,{total_clp:nuevoTotal,total_usd:isI?Math.round(nuevoTotal/TC_USD):0})
    await addFirma(oc.id,`Item agregado: ${newItem.sku||"MANUAL"} — ${newItem.producto} (${fN(newItem.cantidad_pedida)} × ${fmt(newItem.costo_unitario)})`)
    setNewItem({producto:"",sku:"",cantidad_pedida:0,costo_unitario:0});setAddingItem(false);setSavingEdit(false)
  }

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
      {(()=>{
        const suc=oc.destino_sucursal_id
        const totalStr=isI&&oc.total_usd>0?`${fmt(oc.total_clp)} · ${fU(oc.total_usd)}`:fmt(oc.total_clp)
        return[["Proveedor",oc.proveedor_id],["Tipo",oc.tipo_oc],["Total",totalStr],["ETA",oc.fecha_estimada||"—"],["Destino",suc||"CD Maipú"],["Pago",oc.condicion_pago]]
      })().map(([l,v],i)=><div key={i} style={{background:"#F2F2F7",borderRadius:10,padding:"8px 12px"}}><div style={{fontSize:10,color:"#AEAEB2",fontWeight:600}}>{l}</div><div style={{fontSize:13,fontWeight:600,color:"#1C1C1E"}}>{v}</div></div>)}
    </div>

    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
      <div style={{fontSize:15,fontWeight:700}}>Firmas ({firmas.length})</div>
      {items.length>0&&<button onClick={()=>{const el=document.getElementById("oc-productos-"+oc.id);if(el)el.scrollIntoView({behavior:"smooth",block:"start"})}} style={{padding:"5px 12px",borderRadius:8,fontSize:11,fontWeight:600,background:"#007AFF15",color:"#007AFF",border:"1px solid #007AFF30",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>📦 Ver productos ({items.length})</button>}
    </div>
    <div style={{paddingLeft:12,borderLeft:"2px solid #E5E5EA",marginBottom:16}}>
      {firmas.map((f,i)=><div key={i} style={{display:"flex",gap:8,padding:"6px 0"}}><div style={{width:10,height:10,borderRadius:5,background:"#34C759",marginTop:4,flexShrink:0,marginLeft:-7,border:"2px solid #fff"}}/><div style={{flex:1}}><div style={{fontSize:13,fontWeight:600}}>{f.accion}</div><div style={{fontSize:11,color:"#8E8E93"}}>{f.nombre_usuario} — <span style={{fontStyle:"italic"}}>{f.firma_digital}</span></div></div><div style={{fontSize:10,color:"#AEAEB2"}}>{f.fecha} {f.hora}</div></div>)}
    </div>

    {/* Sección productos — siempre visible (con placeholder si está vacía) */}
    <div id={"oc-productos-"+oc.id} style={{fontSize:15,fontWeight:700,marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center",scrollMarginTop:20}}>
      <span>Productos ({items.length})</span>
      {puedeEditarItems&&!addingItem&&!editingItem&&<button onClick={()=>setAddingItem(true)} style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,background:"#34C75915",color:"#34C759",border:"1px solid #34C75940",cursor:"pointer"}}>+ Agregar item</button>}
    </div>
    {items.length===0&&!addingItem&&<div style={{padding:"20px",background:"#FFF8E7",borderRadius:10,border:"1px solid #FFE4A0",marginBottom:14,textAlign:"center"}}>
      <div style={{fontSize:24,marginBottom:6}}>📦</div>
      <div style={{fontSize:13,fontWeight:600,color:"#946200",marginBottom:4}}>Esta OC no tiene productos cargados</div>
      <div style={{fontSize:11,color:"#8E8E93",lineHeight:1.4,maxWidth:400,margin:"0 auto"}}>Pudo haber ocurrido un error al crearla. {puedeEditarItems?"Usá el botón \"+ Agregar item\" arriba para cargarlos manualmente.":"Contactá al admin para que los cargue."}</div>
    </div>}
    {(items.length>0||addingItem)&&<><table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:14}}>
        <thead><tr style={{background:"#F2F2F7"}}>
          <th style={{padding:"6px 8px",textAlign:"left",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Producto</th>
          <th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Sugerido</th>
          <th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Pedido</th>
          <th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Costo U.</th>
          <th style={{padding:"6px 8px",textAlign:"right",fontSize:10,fontWeight:600,color:"#8E8E93"}}>Subtotal</th>
          {puedeEditarItems&&<th style={{width:80,padding:"6px"}}></th>}
        </tr></thead>
        <tbody>{items.map((i,idx)=>{
          const isEditing=editingItem===i.id
          if(isEditing) return<tr key={idx} style={{borderBottom:"1px solid #F2F2F7",background:"#FFF9E8"}}>
            <td style={{padding:"6px 8px"}}><input value={editDraft.producto||""} onChange={e=>setEditDraft({...editDraft,producto:e.target.value})} style={{...css.input,padding:"5px 8px",fontSize:12}} /><div style={{fontSize:10,color:"#AEAEB2",marginTop:2}}>{i.sku}</div></td>
            <td style={{padding:"6px",textAlign:"right",color:"#8E8E93"}}>{fN(i.cantidad_sugerida)}</td>
            <td style={{padding:"6px"}}><input type="number" min={0} value={editDraft.cantidad_pedida||0} onChange={e=>setEditDraft({...editDraft,cantidad_pedida:e.target.value})} style={{...css.input,padding:"5px 8px",fontSize:12,width:80,textAlign:"right"}}/></td>
            <td style={{padding:"6px"}}><input type="number" min={0} step="any" value={editDraft.costo_unitario||0} onChange={e=>setEditDraft({...editDraft,costo_unitario:e.target.value})} style={{...css.input,padding:"5px 8px",fontSize:12,width:90,textAlign:"right"}}/></td>
            <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600}}>{fmt((Number(editDraft.cantidad_pedida)||0)*(Number(editDraft.costo_unitario)||0))}</td>
            <td style={{padding:"6px"}}><div style={{display:"flex",gap:4}}><button onClick={()=>saveItemEdit(i)} disabled={savingEdit} style={{padding:"4px 8px",fontSize:11,background:"#34C759",color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontWeight:600}}>✓</button><button onClick={cancelEdit} style={{padding:"4px 8px",fontSize:11,background:"#8E8E93",color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}}>✕</button></div></td>
          </tr>
          return<tr key={idx} style={{borderBottom:"1px solid #F2F2F7"}}>
            <td style={{padding:"6px 8px"}}><div style={{fontWeight:600}}>{i.producto}</div><div style={{fontSize:10,color:"#AEAEB2"}}>{i.sku}</div></td>
            <td style={{padding:"6px",textAlign:"right",color:"#8E8E93"}}>{fN(i.cantidad_sugerida)}</td>
            <td style={{padding:"6px",textAlign:"right",color:"#007AFF",fontWeight:700}}>{fN(i.cantidad_pedida)}</td>
            <td style={{padding:"6px",textAlign:"right"}}>{fmt(i.costo_unitario)}</td>
            <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600}}>{fmt((i.cantidad_pedida||0)*(i.costo_unitario||0))}</td>
            {puedeEditarItems&&<td style={{padding:"6px"}}><div style={{display:"flex",gap:4}}>
              <button onClick={()=>startEditItem(i)} disabled={!!editingItem||addingItem} style={{padding:"4px 8px",fontSize:11,background:"#007AFF15",color:"#007AFF",border:"1px solid #007AFF30",borderRadius:4,cursor:"pointer",fontWeight:600,opacity:editingItem||addingItem?0.4:1}} title="Editar">✏</button>
              <button onClick={()=>deleteItem(i)} disabled={!!editingItem||addingItem} style={{padding:"4px 8px",fontSize:11,background:"#FF3B3015",color:"#FF3B30",border:"1px solid #FF3B3030",borderRadius:4,cursor:"pointer",opacity:editingItem||addingItem?0.4:1}} title="Eliminar">🗑</button>
            </div></td>}
          </tr>
        })}
        {addingItem&&<tr style={{borderBottom:"1px solid #F2F2F7",background:"#E8F5E9"}}>
          <td style={{padding:"6px 8px"}}><input value={newItem.producto} onChange={e=>setNewItem({...newItem,producto:e.target.value})} placeholder="Producto" style={{...css.input,padding:"5px 8px",fontSize:12,marginBottom:3}}/><input value={newItem.sku} onChange={e=>setNewItem({...newItem,sku:e.target.value})} placeholder="SKU" style={{...css.input,padding:"5px 8px",fontSize:11}}/></td>
          <td style={{padding:"6px",textAlign:"right",color:"#AEAEB2"}}>—</td>
          <td style={{padding:"6px"}}><input type="number" min={0} value={newItem.cantidad_pedida||0} onChange={e=>setNewItem({...newItem,cantidad_pedida:Number(e.target.value)})} style={{...css.input,padding:"5px 8px",fontSize:12,width:80,textAlign:"right"}}/></td>
          <td style={{padding:"6px"}}><input type="number" min={0} step="any" value={newItem.costo_unitario||0} onChange={e=>setNewItem({...newItem,costo_unitario:Number(e.target.value)})} style={{...css.input,padding:"5px 8px",fontSize:12,width:90,textAlign:"right"}}/></td>
          <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600}}>{fmt((newItem.cantidad_pedida||0)*(newItem.costo_unitario||0))}</td>
          <td style={{padding:"6px"}}><div style={{display:"flex",gap:4}}><button onClick={saveNewItem} disabled={savingEdit} style={{padding:"4px 8px",fontSize:11,background:"#34C759",color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontWeight:600}}>✓</button><button onClick={()=>{setAddingItem(false);setNewItem({producto:"",sku:"",cantidad_pedida:0,costo_unitario:0})}} style={{padding:"4px 8px",fontSize:11,background:"#8E8E93",color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}}>✕</button></div></td>
        </tr>}
        </tbody>
      </table>
      {puedeEditarItems&&<div style={{fontSize:10,color:"#8E8E93",marginBottom:10}}>💡 Podés editar/agregar/eliminar items. Cada cambio recalcula el total y queda en el historial de firmas.</div>}
      {!puedeEditarItems&&tienePermisoEdicion&&<div style={{fontSize:10,color:"#FF9500",marginBottom:10}}>🔒 La OC está en estado <strong>{oc.estado}</strong>. Ya no se pueden editar items.</div>}
    </>}

    {/* ⭐ Plan de pagos — editable por admin/dir_finanzas */}
    {pagos.length>0&&(()=>{
      const puedeEditarPagos=(cu?.rol==="admin"||cu?.rol==="dir_finanzas")&&oc.estado!=="Cerrada"
      return<PagosEditor oc={oc} pagos={pagos} setPagos={setPagos} cu={cu} puedeEditar={puedeEditarPagos} addFirma={addFirma} TC_USD={TC_USD}/>
    })()}

    {/* COMPROBANTES DE PAGO */}
    {pagos.length>0&&<div style={{marginTop:12}}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>📎 Comprobantes de pago</div>
      {pagos.map((p,i)=>{
        const tieneComprobante=p.comprobante_url&&p.comprobante_nombre
        return<div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:tieneComprobante?"#34C75908":"#fff",borderRadius:10,border:`1px solid ${tieneComprobante?"#34C75930":"#E5E5EA"}`,marginBottom:6}}>
          <div>
            <div style={{fontSize:13,fontWeight:600}}>{p.concepto}</div>
            <div style={{fontSize:11,color:"#8E8E93"}}>{p.moneda==="USD"?fU(p.monto):fmt(p.monto)} — {p.fecha_pago||"Sin fecha"}{p.observaciones_pago?` — ${p.observaciones_pago}`:""}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Bd c={p.estado==="Pagado"?"#34C759":"#FF9500"} bg={p.estado==="Pagado"?"#34C75915":"#FF950015"}>{p.estado}</Bd>
            {tieneComprobante?
              <a href={p.comprobante_url} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:4,padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:600,background:"#007AFF",color:"#fff",textDecoration:"none",cursor:"pointer"}}>📄 {p.comprobante_nombre.length>20?p.comprobante_nombre.slice(0,18)+"...":p.comprobante_nombre}</a>
            :p.estado==="Pagado"?
              <span style={{fontSize:11,color:"#FF9500",fontWeight:500}}>⚠ Sin comprobante</span>
            :
              <span style={{fontSize:11,color:"#8E8E93"}}>Pendiente</span>
            }
          </div>
        </div>
      })}
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
    {/* ⭐ HISTORIAL DE COSTEOS (solo importación) */}
    {isI&&costeos.length>0&&<div style={{borderTop:"2px solid #E5E5EA",paddingTop:16,marginTop:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E"}}>🧮 Historial de costeos</div>
          <div style={{fontSize:11,color:"#8E8E93",marginTop:2}}>Costeos de importación registrados · {costeos.length} {costeos.length===1?"registro":"registros"}</div>
        </div>
      </div>
      {costeos.map((c,i)=>{
        const esUltimo=i===0
        return<div key={c.id} style={{background:"#fff",borderRadius:10,padding:"12px 14px",marginBottom:8,border:"1px solid #AF52DE20",borderLeft:"3px solid #AF52DE"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                <span style={{fontSize:16}}>🧮</span>
                <span style={{fontSize:13,fontWeight:700,color:"#AF52DE"}}>Costeo registrado</span>
                <Bd c="#8E8E93" bg="#F2F2F7">{c.fecha}</Bd>
                {esUltimo&&<Bd c="#34C759" bg="#34C75915">Más reciente</Bd>}
                {c.nombre_usuario&&<span style={{fontSize:11,color:"#8E8E93"}}>· por {c.nombre_usuario}</span>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginTop:8}}>
                <div style={{padding:"8px 10px",background:"#007AFF06",borderRadius:8,border:"1px solid #007AFF15"}}>
                  <div style={{fontSize:9,fontWeight:700,color:"#007AFF",textTransform:"uppercase"}}>Costo unit. bodega</div>
                  <div style={{fontSize:16,fontWeight:800,color:"#007AFF",letterSpacing:"-0.02em",marginTop:2}}>{fmt(c.costo_unit_bodega)}</div>
                  <div style={{fontSize:10,color:"#8E8E93"}}>{fN(c.cant_unidades)} uds</div>
                </div>
                <div style={{padding:"8px 10px",background:"#AF52DE06",borderRadius:8,border:"1px solid #AF52DE15"}}>
                  <div style={{fontSize:9,fontWeight:700,color:"#AF52DE",textTransform:"uppercase"}}>Costo total</div>
                  <div style={{fontSize:16,fontWeight:800,color:"#AF52DE",letterSpacing:"-0.02em",marginTop:2}}>{fmt(c.costo_total_clp)}</div>
                  <div style={{fontSize:10,color:"#8E8E93"}}>+{Math.round((c.pct_internacion_sobre_fob||0)*100)}% internación</div>
                </div>
                <div style={{padding:"8px 10px",background:(c.margen_calculado>=30?"#34C75906":c.margen_calculado>=15?"#FF950006":"#FF3B3006"),borderRadius:8,border:`1px solid ${c.margen_calculado>=30?"#34C75915":c.margen_calculado>=15?"#FF950015":"#FF3B3015"}`}}>
                  <div style={{fontSize:9,fontWeight:700,color:c.margen_calculado>=30?"#34C759":c.margen_calculado>=15?"#FF9500":"#FF3B30",textTransform:"uppercase"}}>Margen</div>
                  <div style={{fontSize:16,fontWeight:800,color:c.margen_calculado>=30?"#34C759":c.margen_calculado>=15?"#FF9500":"#FF3B30",letterSpacing:"-0.02em",marginTop:2}}>{c.margen_calculado||0}%</div>
                  <div style={{fontSize:10,color:"#8E8E93"}}>Precio: {fmt(c.precio_venta_clp||0)}</div>
                </div>
                <div style={{padding:"8px 10px",background:"#F8F8FA",borderRadius:8,border:"1px solid #E5E5EA"}}>
                  <div style={{fontSize:9,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Ganancia proy.</div>
                  <div style={{fontSize:16,fontWeight:800,color:c.ganancia_total>0?"#34C759":"#FF3B30",letterSpacing:"-0.02em",marginTop:2}}>{fmt(c.ganancia_total||0)}</div>
                  <div style={{fontSize:10,color:"#8E8E93"}}>TC ${fN(c.tc_usd)}</div>
                </div>
              </div>
              {/* Desglose por etapa */}
              <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap",fontSize:10}}>
                <span style={{padding:"3px 8px",borderRadius:4,background:"#007AFF10",color:"#007AFF",fontWeight:600}}>FOB {fmt(c.fob_clp)}</span>
                <span style={{padding:"3px 8px",borderRadius:4,background:"#FF3B3010",color:"#FF3B30",fontWeight:600}}>Aduana {fmt(c.total_aduana)}</span>
                <span style={{padding:"3px 8px",borderRadius:4,background:"#FF950010",color:"#FF9500",fontWeight:600}}>Puerto {fmt(c.total_puerto)}</span>
                <span style={{padding:"3px 8px",borderRadius:4,background:"#AF52DE10",color:"#AF52DE",fontWeight:600}}>Agente {fmt(c.agente_clp)}</span>
                <span style={{padding:"3px 8px",borderRadius:4,background:"#34C75910",color:"#34C759",fontWeight:600}}>Transp. {fmt(c.transporte_clp)}</span>
                <span style={{padding:"3px 8px",borderRadius:4,background:"#FF2D5510",color:"#FF2D55",fontWeight:600}}>Fin. {fmt(c.total_financiero)}</span>
              </div>
              {c.productos_detalle&&Array.isArray(c.productos_detalle)&&c.productos_detalle.length>0&&<details style={{marginTop:10}}>
                <summary style={{fontSize:11,fontWeight:600,color:"#007AFF",cursor:"pointer"}}>📦 Ver detalle por producto ({c.productos_detalle.length})</summary>
                <div style={{marginTop:8,maxHeight:200,overflowY:"auto",border:"1px solid #E5E5EA",borderRadius:8}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead><tr style={{background:"#F8F8FA",position:"sticky",top:0}}>
                      <th style={{padding:"6px 8px",textAlign:"left",fontSize:9,fontWeight:700,color:"#636366"}}>Producto</th>
                      <th style={{padding:"6px",textAlign:"right",fontSize:9,fontWeight:700,color:"#636366"}}>Cant.</th>
                      <th style={{padding:"6px",textAlign:"right",fontSize:9,fontWeight:700,color:"#007AFF"}}>Unit. origen</th>
                      <th style={{padding:"6px",textAlign:"right",fontSize:9,fontWeight:700,color:"#AF52DE"}}>Internac.</th>
                      <th style={{padding:"6px",textAlign:"right",fontSize:9,fontWeight:700,color:"#007AFF"}}>Unit. bodega</th>
                      <th style={{padding:"6px",textAlign:"right",fontSize:9,fontWeight:700,color:"#FF9500"}}>Incr.</th>
                      <th style={{padding:"6px 8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#34C759"}}>P. venta sug.</th>
                    </tr></thead>
                    <tbody>{c.productos_detalle.map((pr,j)=><tr key={j} style={{borderBottom:"1px solid #F2F2F7"}}>
                      <td style={{padding:"5px 8px"}}><div style={{fontWeight:600,fontSize:11}}>{pr.producto}</div><div style={{fontSize:9,color:"#AEAEB2"}}>{pr.sku}</div></td>
                      <td style={{padding:"5px",textAlign:"right",fontWeight:600}}>{fN(pr.qty)}</td>
                      <td style={{padding:"5px",textAlign:"right",color:"#007AFF",fontWeight:600}}>{fmt(pr.costo_unit_origen)}</td>
                      <td style={{padding:"5px",textAlign:"right",color:"#AF52DE"}}>{fmt(pr.total_internacion)}</td>
                      <td style={{padding:"5px",textAlign:"right",fontWeight:800,color:"#007AFF"}}>{fmt(pr.costo_unit_final)}</td>
                      <td style={{padding:"5px",textAlign:"right"}}><span style={{padding:"1px 5px",borderRadius:3,fontSize:10,fontWeight:700,color:pr.incremento>50?"#FF3B30":pr.incremento>30?"#FF9500":"#34C759",background:pr.incremento>50?"#FF3B3012":pr.incremento>30?"#FF950012":"#34C75912"}}>+{pr.incremento}%</span></td>
                      <td style={{padding:"5px 8px",textAlign:"right",color:"#34C759",fontWeight:700}}>{fmt(pr.precio_venta_sug)}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </details>}
              {c.notas&&<div style={{fontSize:11,color:"#8E8E93",marginTop:6,fontStyle:"italic"}}>💬 {c.notas}</div>}
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
              {c.archivo_url&&<a href={c.archivo_url} target="_blank" rel="noopener" style={{padding:"5px 10px",fontSize:11,fontWeight:600,background:"#007AFF",color:"#fff",textDecoration:"none",borderRadius:6}}>📄 Ver</a>}
              {(cu?.rol==="admin"||c.registrado_por===cu?.id)&&<button onClick={()=>eliminarCosteo(c)} style={{padding:"5px 10px",fontSize:11,background:"#FF3B3015",color:"#FF3B30",border:"1px solid #FF3B3030",borderRadius:6,cursor:"pointer",fontWeight:600}} title="Eliminar">🗑</button>}
            </div>
          </div>
        </div>
      })}
    </div>}

    {/* ⭐ PANEL DE RECEPCIONES PARCIALES (guías + facturas) */}
    {(((isI&&oc.estado==="Transporte")||(!isI&&oc.estado==="Despacho nac.")||oc.estado==="Recibida parcial"||oc.estado==="Recibida OK")&&h("recibir"))&&<div style={{borderTop:"2px solid #E5E5EA",paddingTop:16,marginTop:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E"}}>📦 Recepciones parciales</div>
          <div style={{fontSize:11,color:"#8E8E93",marginTop:2}}>{facturaConGuia?"Este proveedor emite guía + factura en documento combinado":"Este proveedor emite guías y facturas por separado"} {prov&&<button onClick={()=>{const f=window.confirm(`¿Cambiar a: "${facturaConGuia?"documentos separados":"guía + factura combinada"}"?\n\nEste cambio afecta solo a ${prov.nombre}.`);if(f){supabase.from('proveedores').update({factura_con_guia:!facturaConGuia}).eq('id',prov.id).then(()=>{alert("Actualizado. Recargá para ver el cambio");close()})}}} style={{background:"none",border:"none",color:"#007AFF",fontSize:10,fontWeight:600,cursor:"pointer",marginLeft:4,padding:0}}>cambiar</button>}</div>
        </div>
        {oc.estado!=="Cerrada"&&<div style={{display:"flex",gap:6}}>
          {facturaConGuia?
            <Bt v="pri" sm onClick={()=>abrirRecModal("guia_factura")} ic="📄">+ Guía + Factura</Bt>
          :<>
            <Bt v="pri" sm onClick={()=>abrirRecModal("guia")} ic="📦">+ Guía</Bt>
            <Bt v="pur" sm onClick={()=>abrirRecModal("factura")} ic="📋">+ Factura</Bt>
          </>}
        </div>}
      </div>

      {/* Resumen de progreso */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div style={{background:"#fff",borderRadius:10,padding:"12px 14px",border:"1px solid #E5E5EA"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{fontSize:11,fontWeight:700,color:"#34C759",textTransform:"uppercase",letterSpacing:"0.05em"}}>📦 Recibido físico</span>
            <span style={{fontSize:14,fontWeight:800,color:"#34C759"}}>{pctRecibidoAcum}%</span>
          </div>
          <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em",lineHeight:1}}>{fN(totalRecibidoAcum)}<span style={{fontSize:13,color:"#8E8E93",fontWeight:600}}> / {fN(totalPedidoOC)} uds</span></div>
          <div style={{width:"100%",background:"#F2F2F7",borderRadius:3,height:6,overflow:"hidden",marginTop:8}}><div style={{width:Math.min(pctRecibidoAcum,100)+"%",height:"100%",background:"#34C759",borderRadius:3,transition:"width 0.5s ease"}}/></div>
          <div style={{fontSize:10,color:"#8E8E93",marginTop:4}}>{recepciones.filter(r=>r.tipo==="guia"||r.tipo==="guia_factura").length} documentos de recepción</div>
        </div>
        <div style={{background:"#fff",borderRadius:10,padding:"12px 14px",border:"1px solid #E5E5EA"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{fontSize:11,fontWeight:700,color:"#AF52DE",textTransform:"uppercase",letterSpacing:"0.05em"}}>📋 Facturado</span>
            <span style={{fontSize:14,fontWeight:800,color:"#AF52DE"}}>{pctFacturadoAcum}%</span>
          </div>
          <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em",lineHeight:1}}>{fN(totalFacturadoAcum)}<span style={{fontSize:13,color:"#8E8E93",fontWeight:600}}> / {fN(totalPedidoOC)} uds</span></div>
          <div style={{width:"100%",background:"#F2F2F7",borderRadius:3,height:6,overflow:"hidden",marginTop:8}}><div style={{width:Math.min(pctFacturadoAcum,100)+"%",height:"100%",background:"#AF52DE",borderRadius:3,transition:"width 0.5s ease"}}/></div>
          <div style={{fontSize:10,color:"#8E8E93",marginTop:4}}>{accMonto.facturado>0&&`${fmt(accMonto.facturado)}`}{accMonto.facturado>0&&accMonto.facturadoUSD>0&&" · "}{accMonto.facturadoUSD>0&&fU(accMonto.facturadoUSD)}{recepciones.filter(r=>r.tipo==="factura"||r.tipo==="guia_factura").length>0?` · ${recepciones.filter(r=>r.tipo==="factura"||r.tipo==="guia_factura").length} facturas`:""}</div>
        </div>
      </div>

      {/* Timeline de documentos */}
      {recepciones.length===0?
        <div style={{textAlign:"center",padding:30,background:"#F9FAFB",borderRadius:10,border:"1px dashed #E5E5EA"}}>
          <div style={{fontSize:28,marginBottom:4}}>📥</div>
          <div style={{fontSize:13,color:"#8E8E93",fontWeight:600}}>Sin documentos registrados</div>
          <div style={{fontSize:11,color:"#AEAEB2",marginTop:2}}>Registrá guías y facturas a medida que el proveedor entrega</div>
        </div>
      :
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Documentos registrados ({recepciones.length})</div>
          {recepciones.map((r,i)=>{
            const recItems=recepcionItems.filter(ri=>ri.recepcion_id===r.id)
            const totalCant=recItems.reduce((s,it)=>s+Number(it.cantidad||0),0)
            const esGuia=r.tipo==="guia"||r.tipo==="guia_factura"
            const esFactura=r.tipo==="factura"||r.tipo==="guia_factura"
            const tipoColor=r.tipo==="guia"?"#34C759":r.tipo==="factura"?"#AF52DE":"#007AFF"
            const tipoIcon=r.tipo==="guia"?"📦":r.tipo==="factura"?"📋":"📄"
            const tipoLabel=r.tipo==="guia"?"Guía":r.tipo==="factura"?"Factura":"Guía + Factura"
            // Si es factura, buscar guías vinculadas
            const guiasVinculadas=r.tipo==="factura"?recepcionLinks.filter(l=>l.factura_id===r.id).map(l=>recepciones.find(rx=>rx.id===l.guia_id)).filter(Boolean):[]
            const facturasVinculadas=r.tipo==="guia"?recepcionLinks.filter(l=>l.guia_id===r.id).map(l=>recepciones.find(rx=>rx.id===l.factura_id)).filter(Boolean):[]
            return<div key={r.id} style={{background:"#fff",borderRadius:10,padding:"12px 14px",marginBottom:8,border:`1px solid ${tipoColor}20`,borderLeft:`3px solid ${tipoColor}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                    <span style={{fontSize:16}}>{tipoIcon}</span>
                    <span style={{fontSize:13,fontWeight:700,color:tipoColor}}>{tipoLabel} #{r.numero_doc}</span>
                    <Bd c="#8E8E93" bg="#F2F2F7">{r.fecha}</Bd>
                    {esFactura&&r.monto&&<Bd c="#AF52DE" bg="#AF52DE12">{r.moneda==="USD"?fU(r.monto):fmt(r.monto)}</Bd>}
                  </div>
                  <div style={{fontSize:11,color:"#636366",marginBottom:4}}>
                    {recItems.length} {recItems.length===1?"producto":"productos"} · {fN(totalCant)} unidades
                  </div>
                  {recItems.length>0&&<div style={{fontSize:11,color:"#8E8E93",marginTop:4}}>{recItems.slice(0,3).map(it=>`${it.producto} (${fN(it.cantidad)})`).join(" · ")}{recItems.length>3&&` · +${recItems.length-3} más`}</div>}
                  {r.notas&&<div style={{fontSize:11,color:"#8E8E93",marginTop:4,fontStyle:"italic"}}>💬 {r.notas}</div>}
                  {guiasVinculadas.length>0&&<div style={{fontSize:10,color:"#34C759",marginTop:4,fontWeight:600}}>🔗 Cubre guías: {guiasVinculadas.map(g=>"#"+g.numero_doc).join(", ")}</div>}
                  {facturasVinculadas.length>0&&<div style={{fontSize:10,color:"#AF52DE",marginTop:4,fontWeight:600}}>🔗 Facturada en: {facturasVinculadas.map(f=>"#"+f.numero_doc).join(", ")}</div>}
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                  {r.archivo_url&&<a href={r.archivo_url} target="_blank" rel="noopener" style={{padding:"5px 10px",fontSize:11,fontWeight:600,background:"#007AFF",color:"#fff",textDecoration:"none",borderRadius:6,display:"inline-flex",alignItems:"center",gap:4}}>📄 Ver</a>}
                  {oc.estado!=="Cerrada"&&<button onClick={()=>eliminarRecepcion(r)} style={{padding:"5px 10px",fontSize:11,background:"#FF3B3015",color:"#FF3B30",border:"1px solid #FF3B3030",borderRadius:6,cursor:"pointer",fontWeight:600}} title="Eliminar">🗑</button>}
                </div>
              </div>
            </div>
          })}
        </div>
      }
    </div>}

    {/* MODAL DE CARGA DE GUÍA/FACTURA */}
    {showRecModal&&<div style={css.modal} onClick={()=>setShowRecModal(false)}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"8px 24px 32px",width:"100%",maxWidth:760,maxHeight:"92vh",overflow:"auto",animation:"slideUp 0.3s ease"}}>
        <div style={{width:36,height:4,borderRadius:2,background:"#E5E5EA",margin:"0 auto 12px"}}/>
        <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>
          {recForm.tipo==="guia"?"📦 Registrar guía de despacho":recForm.tipo==="factura"?"📋 Registrar factura":"📄 Registrar guía + factura"}
        </div>
        <div style={{fontSize:12,color:"#8E8E93",marginBottom:14}}>{oc.id} · {prov?.nombre}</div>

        {/* Selector de tipo (solo si el proveedor no fuerza combinado) */}
        {!facturaConGuia&&<div style={{display:"flex",gap:4,background:"#F2F2F7",borderRadius:8,padding:3,marginBottom:14,width:"fit-content"}}>
          {[{k:"guia",l:"📦 Guía"},{k:"factura",l:"📋 Factura"},{k:"guia_factura",l:"📄 Ambos"}].map(t=><button key={t.k} onClick={()=>setRecForm(p=>({...p,tipo:t.k}))} style={{padding:"6px 14px",borderRadius:6,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:recForm.tipo===t.k?"#fff":"transparent",color:recForm.tipo===t.k?"#1C1C1E":"#8E8E93",boxShadow:recForm.tipo===t.k?"0 1px 2px rgba(0,0,0,0.06)":"none"}}>{t.l}</button>)}
        </div>}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <Fl l="Número documento" req><input value={recForm.numero_doc} onChange={e=>setRecForm(p=>({...p,numero_doc:e.target.value}))} placeholder={recForm.tipo==="factura"?"Ej: 12345":"Ej: 98765"} style={css.input}/></Fl>
          <Fl l="Fecha" req><input type="date" value={recForm.fecha} onChange={e=>setRecForm(p=>({...p,fecha:e.target.value}))} style={css.input}/></Fl>
        </div>

        {(recForm.tipo==="factura"||recForm.tipo==="guia_factura")&&<div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:10,marginBottom:12,padding:"12px 14px",background:"#AF52DE06",borderRadius:10,border:"1px solid #AF52DE15"}}>
          <Fl l="Monto factura" req><input type="number" min={0} step="any" value={recForm.monto} onChange={e=>setRecForm(p=>({...p,monto:e.target.value}))} style={css.input} placeholder="0"/></Fl>
          <Fl l="Moneda"><select value={recForm.moneda} onChange={e=>setRecForm(p=>({...p,moneda:e.target.value}))} style={css.select}><option value="CLP">CLP</option><option value="USD">USD</option></select></Fl>
        </div>}

        {/* Selector de guías vinculadas (solo para facturas cuando hay guías registradas) */}
        {recForm.tipo==="factura"&&recepciones.filter(r=>r.tipo==="guia").length>0&&<Fl l="Guías que esta factura cubre (opcional)">
          <div style={{background:"#F9FAFB",borderRadius:10,padding:10,border:"1px solid #E5E5EA"}}>
            {recepciones.filter(r=>r.tipo==="guia").map(g=><label key={g.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",cursor:"pointer",fontSize:12,fontWeight:500}}>
              <input type="checkbox" checked={recForm.facturasVinculadas.includes(g.id)} onChange={e=>{
                setRecForm(p=>({...p,facturasVinculadas:e.target.checked?[...p.facturasVinculadas,g.id]:p.facturasVinculadas.filter(x=>x!==g.id)}))
              }} style={{accentColor:"#34C759"}}/>
              <span>📦 Guía #{g.numero_doc} · {g.fecha} · {fN(recepcionItems.filter(i=>i.recepcion_id===g.id).reduce((s,i)=>s+Number(i.cantidad||0),0))} uds</span>
            </label>)}
          </div>
        </Fl>}

        {/* Tabla de items */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>Cantidades del documento</div>
          <div style={{fontSize:11,color:"#8E8E93",marginBottom:8}}>Ingresá solo las cantidades que llegan en este documento</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{background:"#F2F2F7"}}>
              <th style={{padding:"6px 8px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366"}}>Producto</th>
              <th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,color:"#636366",width:70}}>Pedido</th>
              <th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,color:"#34C759",width:80}}>Recibido acum.</th>
              {(recForm.tipo==="factura"||recForm.tipo==="guia_factura")&&<th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,color:"#AF52DE",width:80}}>Facturado acum.</th>}
              <th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,color:"#FF9500",width:70}}>Pendiente</th>
              <th style={{padding:"6px",textAlign:"center",fontSize:10,fontWeight:700,color:"#007AFF",width:80}}>Este doc.</th>
            </tr></thead>
            <tbody>{items.map(it=>{
              const recAcum=accRecibido[it.sku]||0
              const facAcum=accFacturado[it.sku]||0
              const tipoEsRec=recForm.tipo==="guia"||recForm.tipo==="guia_factura"
              const pend=tipoEsRec?((it.cantidad_pedida||0)-recAcum):((it.cantidad_pedida||0)-facAcum)
              return<tr key={it.id} style={{borderBottom:"1px solid #F2F2F7"}}>
                <td style={{padding:"6px 8px"}}><div style={{fontWeight:600,fontSize:12}}>{it.producto}</div><div style={{fontSize:10,color:"#AEAEB2"}}>{it.sku}</div></td>
                <td style={{padding:"6px",textAlign:"right"}}>{fN(it.cantidad_pedida||0)}</td>
                <td style={{padding:"6px",textAlign:"right",color:"#34C759",fontWeight:600}}>{fN(recAcum)}</td>
                {(recForm.tipo==="factura"||recForm.tipo==="guia_factura")&&<td style={{padding:"6px",textAlign:"right",color:"#AF52DE",fontWeight:600}}>{fN(facAcum)}</td>}
                <td style={{padding:"6px",textAlign:"right",color:pend<=0?"#8E8E93":"#FF9500",fontWeight:700}}>{fN(Math.max(0,pend))}</td>
                <td style={{padding:"6px"}}><input type="number" min={0} max={Math.max(0,pend)} value={recForm.itemsQty[it.id]||0} onChange={e=>setRecForm(p=>({...p,itemsQty:{...p.itemsQty,[it.id]:e.target.value}}))} disabled={pend<=0} style={{width:70,textAlign:"right",padding:"4px 6px",borderRadius:6,border:Number(recForm.itemsQty[it.id]||0)>0?"2px solid #007AFF":"1px solid #E5E5EA",fontSize:12,fontWeight:600,background:pend<=0?"#F8F8FA":"#fff"}}/></td>
              </tr>
            })}</tbody>
            <tfoot><tr style={{borderTop:"2px solid #1C1C1E",background:"#F8F8FA"}}>
              <td style={{padding:"8px",fontWeight:700}}>TOTAL EN ESTE DOC.</td>
              <td colSpan={3+(recForm.tipo==="factura"||recForm.tipo==="guia_factura"?1:0)}></td>
              <td style={{padding:"8px",textAlign:"center",fontSize:14,fontWeight:800,color:"#007AFF"}}>{fN(Object.values(recForm.itemsQty).reduce((s,v)=>s+Number(v||0),0))}</td>
            </tr></tfoot>
          </table>
        </div>

        {/* Upload archivo */}
        <Fl l={`Adjuntar ${recForm.tipo==="guia"?"guía":recForm.tipo==="factura"?"factura":"documento"}${recForm.tipo==="factura"||recForm.tipo==="guia_factura"?" (recomendado)":" (opcional)"}`}>
          <div style={{border:"2px dashed "+(recForm.archivo?"#34C759":"#007AFF"),borderRadius:12,padding:"12px 16px",textAlign:"center",cursor:"pointer",background:recForm.archivo?"#34C75908":"#007AFF05"}}
            onClick={()=>document.getElementById("rec-file-input").click()}>
            {recForm.archivo?<>
              <div style={{fontSize:18}}>✅</div>
              <div style={{fontSize:12,fontWeight:600,color:"#34C759",marginTop:2}}>{recForm.archivoNombre}</div>
            </>:<>
              <div style={{fontSize:18}}>📎</div>
              <div style={{fontSize:12,fontWeight:600,color:"#007AFF",marginTop:2}}>Click para adjuntar PDF o imagen</div>
            </>}
          </div>
          <input id="rec-file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" style={{display:"none"}}
            onChange={e=>{const f=e.target.files[0];if(f)setRecForm(p=>({...p,archivo:f,archivoNombre:f.name}));e.target.value=""}}/>
        </Fl>

        <Fl l="Notas (opcional)"><textarea value={recForm.notas} onChange={e=>setRecForm(p=>({...p,notas:e.target.value}))} rows={2} style={{...css.input,resize:"vertical"}} placeholder="Ej: Faltó un bulto, se completa en próximo despacho"/></Fl>

        <div style={{display:"flex",gap:10,marginTop:14}}>
          <Bt v="pri" full onClick={guardarRecepcion} ic="✓">Registrar {recForm.tipo==="guia"?"guía":recForm.tipo==="factura"?"factura":"documento"}</Bt>
          <Bt v="gry" onClick={()=>setShowRecModal(false)}>Cancelar</Bt>
        </div>
      </div>
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
function CosteoImpView({config,saveConfig,ocs,cu,addFirma}){
  const ocsImp=ocs.filter(o=>o.tipo_oc==="Importación"&&!["Rechazada"].includes(o.estado))
  const[selOC,setSelOC]=useState("")
  const[ocItems,setOcItems]=useState([])
  const[itemsOverrides,setItemsOverrides]=useState({})
  const[modoCalc,setModoCalc]=useState("costo") // "costo" | "margen" — calcular costo o sugerir precio desde margen objetivo
  const[margenObjetivo,setMargenObjetivo]=useState(35)
  const[paramsExpanded,setParamsExpanded]=useState(true)
  const[tab,setLocalTab]=useState("pipeline") // pipeline | productos | comparador

  // ⭐ Método de prorrateo por etapa de costo
  const[metodos,setMetodos]=useState({flete:"cbm",seguro:"fob",puerto:"cbm",transporte:"cbm",agente:"fob",arancel:"cif",iva:"cif",financiero:"cif"})
  const setMetodo=(k,v)=>setMetodos(p=>({...p,[k]:v}))

  useEffect(()=>{if(!selOC){setOcItems([]);setItemsOverrides({});return};supabase.from('oc_items').select('*').eq('oc_id',selOC).then(r=>{setOcItems(r.data||[]);setItemsOverrides({})})},[selOC])

  const[p,setP]=useState({moneda:"USD",tc:Number(config.tc_usd)||950,cantUds:1000,precioUnitFOB:5.00,tipoContenedor:"40HC",costoFlete:Number(config.costo_flete_40hc)||3800,pctSeguro:Number(config.pct_seguro_int)||0.5,pctArancel:Number(config.pct_arancel)||6,tieneILC:false,pctAforo:1,pctIVA:19,handling:Number(config.costo_handling)||350,almacenajeDia:Number(config.almacenaje_dia)||45,diasAlmacenaje:Number(config.dias_almacenaje)||5,porteo:Number(config.costo_porteo)||120,honorarioAgente:Number(config.honorario_agente)||450,gastosOpAgente:Number(config.gastos_op_agente)||180,transportePuertoBodega:Number(config.transporte_puerto_bodega)||800,seguroTerrestre:Number(config.seguro_terrestre)||50,pctCostoFinanciero:Number(config.pct_costo_financiero)||1.5,diasTransito:Number(config.dias_transito_imp)||60,costoTransferencia:Number(config.costo_transferencia)||35,precioVentaCLP:0})
  const u=(k,v)=>setP(prev=>({...prev,[k]:Number(v)||0}))
  const us=(k,v)=>setP(prev=>({...prev,[k]:v}))
  const TC=p.tc

  // ═══ CÁLCULOS ═══
  // Modo dual: "oc" si hay OC con líneas, "sim" si es simulación libre
  const modoOrigen=selOC&&ocItems.length>0?"oc":"sim"

  // Items con overrides locales de cbm/peso
  const itemsEnriched=ocItems.map(it=>({...it,cbm:itemsOverrides[it.id]?.cbm!==undefined?itemsOverrides[it.id].cbm:(it.cbm||0),peso_kg:itemsOverrides[it.id]?.peso_kg!==undefined?itemsOverrides[it.id].peso_kg:(it.peso_kg||0)}))
  const updOverride=(id,k,v)=>setItemsOverrides(p=>({...p,[id]:{...(p[id]||{}),[k]:Number(v)||0}}))
  const hasOverrides=Object.keys(itemsOverrides).length>0

  // Totales desde las líneas
  const fobCLPFromLines=itemsEnriched.reduce((s,i)=>s+((i.cantidad_confirmada||i.cantidad_pedida||0)*(i.costo_unitario||0)),0)
  const totalQtyFromLines=itemsEnriched.reduce((s,i)=>s+(i.cantidad_confirmada||i.cantidad_pedida||0),0)
  const totalCbmFromLines=itemsEnriched.reduce((s,i)=>s+((i.cantidad_confirmada||i.cantidad_pedida||0)*(i.cbm||0)),0)
  const totalPesoFromLines=itemsEnriched.reduce((s,i)=>s+((i.cantidad_confirmada||i.cantidad_pedida||0)*(i.peso_kg||0)),0)

  // FOB base según modo
  const fobCLP=modoOrigen==="oc"?Math.round(fobCLPFromLines):Math.round(p.cantUds*p.precioUnitFOB*TC)
  const fobUSD=Math.round(fobCLP/TC*100)/100
  const cantTotal=modoOrigen==="oc"?totalQtyFromLines:p.cantUds

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
  const costoUnitBodega=cantTotal>0?Math.round(costoTotalCLP/cantTotal):0

  const precioSugerido=margenObjetivo<100?Math.round(costoUnitBodega/(1-margenObjetivo/100)):0
  const precioVenta=modoCalc==="margen"?precioSugerido:p.precioVentaCLP
  const margenPct=precioVenta>0?Math.round((precioVenta-costoUnitBodega)/precioVenta*100):0
  const gananciaUnit=precioVenta-costoUnitBodega
  const gananciaTotal=gananciaUnit*cantTotal

  const gastosInternacion=costoTotalCLP-fobCLP
  const pctInternacionSobreFOB=fobCLP>0?gastosInternacion/fobCLP:0

  // ⭐ Prorrateo HÍBRIDO por producto con fallback automático a FOB si falta CBM/peso
  const hayCBM=totalCbmFromLines>0
  const hayPeso=totalPesoFromLines>0
  const productCosts=itemsEnriched.map(item=>{
    const qty=item.cantidad_confirmada||item.cantidad_pedida||0
    const costoUnitOrigen=item.costo_unitario||0
    const fobProducto=qty*costoUnitOrigen
    const cbmProducto=qty*(item.cbm||0)
    const pesoProducto=qty*(item.peso_kg||0)
    const pctFOB=fobCLPFromLines>0?fobProducto/fobCLPFromLines:0
    const pctCBM=totalCbmFromLines>0?cbmProducto/totalCbmFromLines:pctFOB
    const pctPeso=totalPesoFromLines>0?pesoProducto/totalPesoFromLines:pctFOB

    const getPct=m=>m==="cbm"?(hayCBM?pctCBM:pctFOB):m==="peso"?(hayPeso?pctPeso:pctFOB):m==="cif"?pctFOB:pctFOB

    const prFlete=Math.round(Math.round(fleteUSD*TC)*getPct(metodos.flete))
    const prSeguro=Math.round(Math.round(seguroUSD*TC)*getPct(metodos.seguro))
    const prArancel=Math.round(arancelCLP*getPct(metodos.arancel))
    const prAforo=Math.round(aforoCLP*getPct(metodos.arancel))
    const prIVA=Math.round(ivaCLP*getPct(metodos.iva))
    const prPuerto=Math.round(totalPuerto*getPct(metodos.puerto))
    const prAgente=Math.round(agenteCLP*getPct(metodos.agente))
    const prTransporte=Math.round(transporteCLP*getPct(metodos.transporte))
    const prFinanciero=Math.round(totalFinanciero*getPct(metodos.financiero))
    const totalInternacion=prFlete+prSeguro+prArancel+prAforo+prIVA+prPuerto+prAgente+prTransporte+prFinanciero
    const costoTotalProducto=fobProducto+totalInternacion
    const costoUnitFinal=qty>0?Math.round(costoTotalProducto/qty):0
    const incremento=costoUnitOrigen>0?Math.round((costoUnitFinal-costoUnitOrigen)/costoUnitOrigen*100):0
    const precioVentaSug=margenObjetivo<100?Math.round(costoUnitFinal/(1-margenObjetivo/100)):0
    return{...item,qty,costoUnitOrigen,fobProducto,cbmProducto,pesoProducto,pctFOB,pctCBM,pctPeso,prFlete,prSeguro,prArancel,prIVA,prPuerto,prAgente,prTransporte,prFinanciero,totalInternacion,costoTotalProducto,costoUnitFinal,incremento,precioVentaSug}
  })

  // Guardar overrides de CBM/peso en BD
  const saveOverrides=async()=>{
    const cambios=Object.entries(itemsOverrides).filter(([id,data])=>data.cbm!==undefined||data.peso_kg!==undefined)
    if(cambios.length===0){alert("No hay cambios de CBM o peso para guardar");return}
    for(const[id,data]of cambios){
      const upd={}
      if(data.cbm!==undefined)upd.cbm=data.cbm
      if(data.peso_kg!==undefined)upd.peso_kg=data.peso_kg
      await supabase.from('oc_items').update(upd).eq('id',id)
    }
    const{data:items}=await supabase.from('oc_items').select('*').eq('oc_id',selOC)
    setOcItems(items||[])
    setItemsOverrides({})
    alert(`✓ ${cambios.length} producto(s) actualizados con CBM/peso`)
  }

  // Etapas con icono, monto, color y descripción
  const stages=[
    {n:"FOB Origen",v:fobCLP,c:"#007AFF",ic:"🏭",desc:"Costo producto en origen"},
    {n:"Flete + Seguro",v:Math.round((fleteUSD+seguroUSD)*TC),c:"#5856D6",ic:"🚢",desc:"Transporte marítimo"},
    {n:"Aduana",v:totalAduana,c:"#FF3B30",ic:"🏛",desc:"Arancel + IVA"},
    {n:"Puerto",v:totalPuerto,c:"#FF9500",ic:"⚓",desc:"Handling + almacenaje"},
    {n:"Agente",v:agenteCLP,c:"#AF52DE",ic:"📋",desc:"Honorarios aduana"},
    {n:"Transporte",v:transporteCLP,c:"#34C759",ic:"🚛",desc:"Puerto → bodega"},
    {n:"Financiero",v:totalFinanciero,c:"#FF2D55",ic:"💰",desc:"Costo fin + transfer."}
  ]
  const maxStage=Math.max(...stages.map(s=>s.v),1)

  const saveParams=async()=>{const keys={tc_usd:p.tc,costo_flete_40hc:p.costoFlete,pct_seguro_int:p.pctSeguro,pct_arancel:p.pctArancel,costo_handling:p.handling,almacenaje_dia:p.almacenajeDia,dias_almacenaje:p.diasAlmacenaje,costo_porteo:p.porteo,honorario_agente:p.honorarioAgente,gastos_op_agente:p.gastosOpAgente,transporte_puerto_bodega:p.transportePuertoBodega,seguro_terrestre:p.seguroTerrestre,pct_costo_financiero:p.pctCostoFinanciero,dias_transito_imp:p.diasTransito,costo_transferencia:p.costoTransferencia};for(const[k,v]of Object.entries(keys))await saveConfig(k,String(v));alert("Parámetros guardados")}

  // ⭐ Guardar costeo en historial de la OC
  const[guardandoCosteo,setGuardandoCosteo]=useState(false)
  const guardarCosteoEnOC=async()=>{
    if(!selOC){alert("⚠ Seleccioná una OC primero para anexar el costeo");return}
    if(!window.confirm(`¿Anexar este costeo al historial de ${selOC}?\n\nSe guardarán todos los parámetros, resultados y el detalle por producto.`))return
    setGuardandoCosteo(true)
    try{
      const costeoId=uid()
      const row={
        id:costeoId,oc_id:selOC,fecha:hoy(),registrado_por:cu?.id,nombre_usuario:cu?.nombre||"",
        tc_usd:p.tc,cant_unidades:p.cantUds,precio_unit_fob:p.precioUnitFOB,
        tiene_tlc:p.tieneILC,pct_arancel:p.pctArancel,pct_iva:p.pctIVA,pct_aforo:p.pctAforo,pct_seguro:p.pctSeguro,
        costo_flete_usd:p.costoFlete,handling_usd:p.handling,almacenaje_dia_usd:p.almacenajeDia,dias_almacenaje:p.diasAlmacenaje,
        porteo_usd:p.porteo,honorario_agente_usd:p.honorarioAgente,gastos_op_agente_usd:p.gastosOpAgente,
        transporte_pb_usd:p.transportePuertoBodega,seguro_terrestre_usd:p.seguroTerrestre,
        pct_costo_financiero:p.pctCostoFinanciero,dias_transito:p.diasTransito,costo_transferencia_usd:p.costoTransferencia,
        margen_objetivo:margenObjetivo,precio_venta_clp:precioVenta,
        fob_clp:fobCLP,cif_clp:cifCLP,total_aduana:totalAduana,total_puerto:totalPuerto,
        agente_clp:agenteCLP,transporte_clp:transporteCLP,total_financiero:totalFinanciero,
        gastos_internacion:gastosInternacion,costo_total_clp:costoTotalCLP,costo_unit_bodega:costoUnitBodega,
        pct_internacion_sobre_fob:pctInternacionSobreFOB,margen_calculado:margenPct,
        ganancia_unit:gananciaUnit,ganancia_total:gananciaTotal,
        productos_detalle:productCosts.length>0?productCosts.map(i=>({sku:i.sku,producto:i.producto,qty:i.qty,costo_unit_origen:i.costoUnitOrigen,fob_producto:i.fobProducto,cbm_producto:i.cbmProducto,peso_producto:i.pesoProducto,pct_fob:i.pctFOB,pct_cbm:i.pctCBM,pct_peso:i.pctPeso,total_internacion:i.totalInternacion,costo_total_producto:i.costoTotalProducto,costo_unit_final:i.costoUnitFinal,incremento:i.incremento,precio_venta_sug:i.precioVentaSug})):null,
        metodo_prorrateo:JSON.stringify(metodos),
        total_cbm:totalCbmFromLines,
        total_peso_kg:totalPesoFromLines,
        notas:hayCBM?`Prorrateo híbrido aplicado · CBM total: ${totalCbmFromLines.toFixed(2)}`:`Prorrateo 100% por FOB (sin datos CBM/peso)`
      }
      const{error}=await supabase.from('costeos_oc').insert(row)
      if(error){alert("Error: "+error.message);setGuardandoCosteo(false);return}
      if(addFirma)await addFirma(selOC,`Costeo de importación registrado: costo unit. bodega ${fmt(costoUnitBodega)} · margen ${margenPct}% · total ${fmt(costoTotalCLP)}`)
      alert(`✓ Costeo anexado al historial de ${selOC}`)
    }catch(e){
      alert("Error inesperado: "+e.message)
    }
    setGuardandoCosteo(false)
  }

  const exportCosteo=()=>{
    if(productCosts.length===0)return
    const h=["Producto","SKU","Cantidad","Costo Unit. Origen","FOB Línea","% del FOB","Flete","Seguro","Arancel","IVA","Puerto","Agente","Transporte","Financiero","Total Internación","Costo Total","Costo Unit. Bodega","Incremento %","Precio venta sugerido","Margen %"]
    const rows=productCosts.map(i=>[`"${i.producto}"`,i.sku,i.qty,i.costoUnitOrigen,i.fobProducto,Math.round(i.pctDelFOB*100),i.prFlete,i.prSeguro,i.prArancel,i.prIVA,i.prPuerto,i.prAgente,i.prTransporte,i.prFinanciero,i.totalInternacion,i.costoTotalProducto,i.costoUnitFinal,i.incremento+"%",i.precioVentaSug,margenObjetivo+"%"])
    const csv="\uFEFF"+[h,...rows].map(r=>r.join(";")).join("\n")
    const blob=new Blob([csv],{type:"text/csv"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`costeo_importacion_${selOC||"sim"}_${hoy()}.csv`;a.click()
  }

  // Input inline compacto
  const In=({l,k,pre,suf,w,dis,step})=><div style={{display:"flex",alignItems:"center",gap:5}}>
    {l&&<span style={{fontSize:11,color:"#636366",fontWeight:600,minWidth:"auto"}}>{l}</span>}
    {pre&&<span style={{fontSize:11,color:"#8E8E93"}}>{pre}</span>}
    <input type="number" step={step||"any"} value={p[k]} onChange={e=>u(k,e.target.value)} disabled={dis} style={{width:w||80,padding:"5px 8px",borderRadius:6,border:"1px solid #D1D1D6",fontSize:12,fontWeight:600,textAlign:"right",background:dis?"#F8F8FA":"#fff"}}/>
    {suf&&<span style={{fontSize:11,color:"#8E8E93"}}>{suf}</span>}
  </div>

  // Card de etapa compacta
  const StageCard=({title,color,icon,children,subtotal,sub})=><div style={{background:"#fff",borderRadius:10,padding:"10px 14px",border:`1px solid ${color}15`,borderLeft:`3px solid ${color}`,marginBottom:8}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <span style={{fontSize:14}}>{icon}</span>
        <span style={{fontSize:12,fontWeight:700,color}}>{title}</span>
      </div>
      {subtotal!==undefined&&<div style={{fontSize:12,fontWeight:800,color}}>{fmt(subtotal)}</div>}
    </div>
    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>{children}</div>
    {sub&&<div style={{fontSize:10,color:"#8E8E93",marginTop:6}}>{sub}</div>}
  </div>

  return<div>
    {/* ══════════════════════════════════════════ */}
    {/* HERO: Selector + KPIs principales         */}
    {/* ══════════════════════════════════════════ */}
    <div style={{background:"linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)",borderRadius:16,padding:"20px 24px",marginBottom:12,color:"#fff",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:-60,right:-60,width:240,height:240,borderRadius:"50%",background:"radial-gradient(circle,#007AFF30 0%,transparent 70%)",pointerEvents:"none"}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:14,position:"relative"}}>
        <div style={{flex:"1 1 320px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.5)",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>Simulador CIF + internación</div>
          <div style={{fontSize:26,fontWeight:800,letterSpacing:"-0.02em",lineHeight:1}}>Costeo de importación</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",marginTop:6}}>Calculá el costo real puesto en bodega con prorrateo por producto</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={selOC} onChange={e=>setSelOC(e.target.value)} style={{padding:"10px 14px",borderRadius:10,fontSize:13,fontWeight:600,background:"rgba(255,255,255,0.08)",color:"#fff",border:"1px solid rgba(255,255,255,0.15)",cursor:"pointer",minWidth:280}}>
            <option value="" style={{color:"#1C1C1E"}}>— Simulación libre —</option>
            {ocsImp.map(o=><option key={o.id} value={o.id} style={{color:"#1C1C1E"}}>{o.id} — {fmt(o.total_clp)} ({o.estado})</option>)}
          </select>
          {productCosts.length>0&&<button onClick={exportCosteo} style={{background:"#34C759",color:"#fff",border:"none",padding:"10px 16px",borderRadius:10,fontSize:12,fontWeight:600,cursor:"pointer"}}>📥 Exportar CSV</button>}
          {selOC&&<button onClick={guardarCosteoEnOC} disabled={guardandoCosteo} style={{background:guardandoCosteo?"rgba(175,82,222,0.5)":"#AF52DE",color:"#fff",border:"none",padding:"10px 16px",borderRadius:10,fontSize:12,fontWeight:700,cursor:guardandoCosteo?"wait":"pointer"}}>{guardandoCosteo?"⏳ Guardando...":"📎 Anexar al historial OC"}</button>}
          <button onClick={saveParams} style={{background:"rgba(255,255,255,0.1)",color:"#fff",border:"1px solid rgba(255,255,255,0.2)",padding:"10px 16px",borderRadius:10,fontSize:12,fontWeight:600,cursor:"pointer"}}>💾 Guardar params</button>
        </div>
      </div>

      {/* KPIs destacados */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,position:"relative"}}>
        <div style={{background:"rgba(255,255,255,0.06)",borderRadius:12,padding:"12px 16px",border:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Costo total internado</div>
          <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.02em",lineHeight:1,marginTop:4}}>{fmt(costoTotalCLP)}</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.5)",marginTop:4}}>Internación: +{Math.round(pctInternacionSobreFOB*100)}% sobre FOB</div>
        </div>
        <div style={{background:"rgba(255,255,255,0.06)",borderRadius:12,padding:"12px 16px",border:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Costo unitario bodega</div>
          <div style={{fontSize:22,fontWeight:800,color:"#66d9ff",letterSpacing:"-0.02em",lineHeight:1,marginTop:4}}>{fmt(costoUnitBodega)}</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.5)",marginTop:4}}>{fN(p.cantUds)} uds total</div>
        </div>
        <div style={{background:"rgba(255,255,255,0.06)",borderRadius:12,padding:"12px 16px",border:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Margen actual</div>
          <div style={{fontSize:22,fontWeight:800,color:margenPct>=30?"#5efc82":margenPct>=15?"#ffcc00":"#ff6b6b",letterSpacing:"-0.02em",lineHeight:1,marginTop:4}}>{margenPct}%</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.5)",marginTop:4}}>Precio: {fmt(precioVenta)} · Gan: {fmt(gananciaUnit)}/u</div>
        </div>
        <div style={{background:"rgba(255,255,255,0.06)",borderRadius:12,padding:"12px 16px",border:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",letterSpacing:"0.08em"}}>Ganancia proyectada</div>
          <div style={{fontSize:22,fontWeight:800,color:gananciaTotal>0?"#5efc82":"#ff6b6b",letterSpacing:"-0.02em",lineHeight:1,marginTop:4}}>{fmt(gananciaTotal)}</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.5)",marginTop:4}}>{p.cantUds} uds × {fmt(gananciaUnit)}</div>
        </div>
      </div>
    </div>

    {/* ══════════════════════════════════════════ */}
    {/* CALCULADORA INVERSA DE MARGEN             */}
    {/* ══════════════════════════════════════════ */}
    <div style={{background:"#fff",borderRadius:14,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:"#1C1C1E"}}>🎯 Calculadora de precio / margen</div>
          <div style={{fontSize:11,color:"#8E8E93",marginTop:1}}>Definí precio de venta o margen objetivo y el sistema calcula el otro</div>
        </div>
        <div style={{display:"flex",gap:4,background:"#F2F2F7",borderRadius:8,padding:3}}>
          <button onClick={()=>setModoCalc("costo")} style={{padding:"6px 12px",borderRadius:6,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",background:modoCalc==="costo"?"#fff":"transparent",color:modoCalc==="costo"?"#1C1C1E":"#8E8E93",boxShadow:modoCalc==="costo"?"0 1px 2px rgba(0,0,0,0.06)":"none"}}>Precio → margen</button>
          <button onClick={()=>setModoCalc("margen")} style={{padding:"6px 12px",borderRadius:6,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",background:modoCalc==="margen"?"#fff":"transparent",color:modoCalc==="margen"?"#1C1C1E":"#8E8E93",boxShadow:modoCalc==="margen"?"0 1px 2px rgba(0,0,0,0.06)":"none"}}>Margen → precio</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,alignItems:"center"}}>
        <div style={{padding:"12px 14px",background:"#007AFF06",borderRadius:10,border:"1px solid #007AFF15"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#007AFF",textTransform:"uppercase",marginBottom:4}}>Costo unitario bodega</div>
          <div style={{fontSize:22,fontWeight:800,color:"#007AFF",letterSpacing:"-0.02em"}}>{fmt(costoUnitBodega)}</div>
          <div style={{fontSize:10,color:"#8E8E93",marginTop:2}}>Calculado · no editable</div>
        </div>

        {modoCalc==="costo"?
          <div style={{padding:"12px 14px",background:"#34C75906",borderRadius:10,border:"1px solid #34C75915"}}>
            <div style={{fontSize:10,fontWeight:700,color:"#34C759",textTransform:"uppercase",marginBottom:4}}>Precio venta CLP</div>
            <input type="number" value={p.precioVentaCLP} onChange={e=>u("precioVentaCLP",e.target.value)} style={{width:"100%",padding:"6px 10px",fontSize:20,fontWeight:800,color:"#34C759",background:"#fff",border:"1px solid #34C75930",borderRadius:6,textAlign:"right"}}/>
            <div style={{fontSize:10,color:"#8E8E93",marginTop:4}}>Ingresá el precio objetivo</div>
          </div>
        :
          <div style={{padding:"12px 14px",background:"#AF52DE06",borderRadius:10,border:"1px solid #AF52DE15"}}>
            <div style={{fontSize:10,fontWeight:700,color:"#AF52DE",textTransform:"uppercase",marginBottom:4}}>Margen objetivo</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <input type="range" min={5} max={80} step={1} value={margenObjetivo} onChange={e=>setMargenObjetivo(Number(e.target.value))} style={{flex:1,accentColor:"#AF52DE"}}/>
              <div style={{fontSize:22,fontWeight:800,color:"#AF52DE",minWidth:60,textAlign:"right"}}>{margenObjetivo}%</div>
            </div>
            <div style={{fontSize:10,color:"#8E8E93",marginTop:4}}>Precio sugerido: {fmt(precioSugerido)}</div>
          </div>
        }

        <div style={{padding:"12px 14px",background:margenPct>=30?"#34C75906":margenPct>=15?"#FF950006":"#FF3B3006",borderRadius:10,border:`1px solid ${margenPct>=30?"#34C75915":margenPct>=15?"#FF950015":"#FF3B3015"}`}}>
          <div style={{fontSize:10,fontWeight:700,color:margenPct>=30?"#34C759":margenPct>=15?"#FF9500":"#FF3B30",textTransform:"uppercase",marginBottom:4}}>{modoCalc==="costo"?"Margen resultante":"Precio sugerido"}</div>
          <div style={{fontSize:22,fontWeight:800,color:margenPct>=30?"#34C759":margenPct>=15?"#FF9500":"#FF3B30",letterSpacing:"-0.02em"}}>
            {modoCalc==="costo"?`${margenPct}%`:fmt(precioSugerido)}
          </div>
          <div style={{fontSize:10,color:"#8E8E93",marginTop:2}}>Ganancia: {fmt(gananciaUnit)}/u · Total: {fmt(gananciaTotal)}</div>
        </div>
      </div>
    </div>

    {/* ══════════════════════════════════════════ */}
    {/* PARÁMETROS (colapsable) + PIPELINE VISUAL */}
    {/* ══════════════════════════════════════════ */}
    <div style={{display:"grid",gridTemplateColumns:paramsExpanded?"380px 1fr":"52px 1fr",gap:12,marginBottom:12,transition:"grid-template-columns 0.3s"}}>
      {/* LEFT: Parámetros colapsables */}
      <div style={{background:"#fff",borderRadius:14,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",overflow:"hidden"}}>
        <div style={{padding:"12px 14px",borderBottom:paramsExpanded?"1px solid #F2F2F7":"none",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={()=>setParamsExpanded(!paramsExpanded)}>
          {paramsExpanded?<>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:"#1C1C1E"}}>⚙️ Parámetros</div>
              <div style={{fontSize:10,color:"#8E8E93"}}>7 etapas de costo</div>
            </div>
            <span style={{fontSize:12,color:"#8E8E93"}}>◀</span>
          </>:<div style={{writingMode:"vertical-rl",transform:"rotate(180deg)",fontSize:11,fontWeight:700,color:"#007AFF",margin:"0 auto"}}>⚙️ Parámetros ▶</div>}
        </div>
        {paramsExpanded&&<div style={{padding:"12px",maxHeight:"calc(100vh - 350px)",overflowY:"auto"}}>
          {/* Indicador de modo */}
          <div style={{padding:"8px 12px",background:modoOrigen==="oc"?"#34C75908":"#FF950008",borderRadius:8,marginBottom:10,border:`1px solid ${modoOrigen==="oc"?"#34C75930":"#FF950030"}`}}>
            <div style={{fontSize:10,fontWeight:700,color:modoOrigen==="oc"?"#34C759":"#FF9500",textTransform:"uppercase",letterSpacing:"0.05em"}}>{modoOrigen==="oc"?"✓ Desde OC real":"⚠ Simulación libre"}</div>
            <div style={{fontSize:11,color:"#636366",marginTop:2}}>{modoOrigen==="oc"?`FOB calculado desde ${ocItems.length} líneas de productos reales`:"Sin OC seleccionada · usando cantidad y FOB promedio estimado"}</div>
          </div>

          {/* StageCard FOB adaptable al modo */}
          {modoOrigen==="sim"?
            <StageCard title="1. FOB Origen" color="#007AFF" icon="🏭" subtotal={fobCLP} sub={`USD ${fU(fobUSD)} · TC $${p.tc}`}>
              <In l="Cant." k="cantUds" w={70}/>
              <In l="FOB" k="precioUnitFOB" pre="USD" w={70}/>
              <In l="TC" k="tc" w={65}/>
            </StageCard>
          :
            <div style={{background:"#fff",borderRadius:10,padding:"10px 14px",border:"1px solid #007AFF15",borderLeft:"3px solid #007AFF",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:14}}>🏭</span><span style={{fontSize:12,fontWeight:700,color:"#007AFF"}}>1. FOB Origen</span></div>
                <div style={{fontSize:12,fontWeight:800,color:"#007AFF"}}>{fmt(fobCLP)}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                <div style={{padding:"6px 8px",background:"#F8F8FA",borderRadius:6}}>
                  <div style={{fontSize:9,color:"#8E8E93",fontWeight:600}}>CANT. REAL</div>
                  <div style={{fontSize:13,fontWeight:700,color:"#1C1C1E"}}>{fN(cantTotal)} uds</div>
                </div>
                <div style={{padding:"6px 8px",background:"#F8F8FA",borderRadius:6}}>
                  <div style={{fontSize:9,color:"#8E8E93",fontWeight:600}}>FOB PROMEDIO</div>
                  <div style={{fontSize:13,fontWeight:700,color:"#1C1C1E"}}>USD {cantTotal>0?(fobUSD/cantTotal).toFixed(2):"0"}</div>
                </div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <In l="TC" k="tc" w={70}/>
                <span style={{fontSize:10,color:"#8E8E93"}}>Costos por línea en tabla Productos</span>
              </div>
            </div>
          }

          <StageCard title="2. Flete + Seguro" color="#5856D6" icon="🚢" subtotal={Math.round((fleteUSD+seguroUSD)*TC)} sub={`CIF: ${fU(cifUSD)}`}>
            <In l="Flete" k="costoFlete" pre="USD" w={80}/>
            <In l="Seguro" k="pctSeguro" suf="%" w={55}/>
          </StageCard>

          <StageCard title="3. Aduana" color="#FF3B30" icon="🏛" subtotal={totalAduana} sub={`Arancel ${fmt(arancelCLP)} + IVA ${fmt(ivaCLP)}`}>
            <In l="Aran." k="pctArancel" suf="%" w={50}/>
            <label style={{display:"flex",alignItems:"center",gap:3,fontSize:11,cursor:"pointer",color:"#636366"}}><input type="checkbox" checked={p.tieneILC} onChange={e=>us("tieneILC",e.target.checked)} style={{accentColor:"#34C759"}}/>TLC 0%</label>
            <In l="IVA" k="pctIVA" suf="%" w={50}/>
          </StageCard>

          <StageCard title="4. Puerto" color="#FF9500" icon="⚓" subtotal={totalPuerto}>
            <In l="Handl." k="handling" pre="USD" w={70}/>
            <In l="Alm./día" k="almacenajeDia" pre="USD" w={60}/>
            <In l="Días" k="diasAlmacenaje" w={45}/>
            <In l="Porteo" k="porteo" pre="USD" w={60}/>
          </StageCard>

          <StageCard title="5. Agente aduana" color="#AF52DE" icon="📋" subtotal={agenteCLP}>
            <In l="Honor." k="honorarioAgente" pre="USD" w={70}/>
            <In l="Gastos" k="gastosOpAgente" pre="USD" w={70}/>
          </StageCard>

          <StageCard title="6. Transporte" color="#34C759" icon="🚛" subtotal={transporteCLP}>
            <In l="Transp." k="transportePuertoBodega" pre="USD" w={70}/>
            <In l="Seg." k="seguroTerrestre" pre="USD" w={60}/>
          </StageCard>

          <StageCard title="7. Financiero" color="#FF2D55" icon="💰" subtotal={totalFinanciero} sub={`${p.pctCostoFinanciero}%/mes × ${p.diasTransito}d`}>
            <In l="%/mes" k="pctCostoFinanciero" suf="%" w={55}/>
            <In l="Días" k="diasTransito" w={50}/>
            <In l="Transf." k="costoTransferencia" pre="USD" w={65}/>
          </StageCard>

          {/* ⭐ Método de prorrateo por etapa */}
          {modoOrigen==="oc"&&<div style={{background:"#fff",borderRadius:10,padding:"12px 14px",border:"1px solid #E5E5EA",marginTop:10}}>
            <div style={{fontSize:12,fontWeight:700,color:"#1C1C1E",marginBottom:8}}>🎯 Método de prorrateo</div>
            <div style={{fontSize:10,color:"#8E8E93",marginBottom:10,lineHeight:1.4}}>
              Cómo distribuir cada gasto entre productos. <strong>FOB</strong> = proporcional al valor. <strong>CBM</strong> = al volumen (más justo para logística). <strong>CIF</strong> = sobre base imponible (correcto para aduana).
              {!hayCBM&&<span style={{display:"block",color:"#FF9500",marginTop:4,fontWeight:600}}>⚠ Sin CBM cargado · las selecciones "CBM" usarán FOB como fallback</span>}
            </div>
            {[
              {k:"flete",l:"Flete",c:"#5856D6",ops:[{v:"cbm",l:"CBM"},{v:"fob",l:"FOB"}]},
              {k:"seguro",l:"Seguro",c:"#5856D6",ops:[{v:"fob",l:"FOB"},{v:"cbm",l:"CBM"}]},
              {k:"arancel",l:"Arancel/IVA",c:"#FF3B30",ops:[{v:"cif",l:"CIF"},{v:"fob",l:"FOB"}]},
              {k:"puerto",l:"Puerto",c:"#FF9500",ops:[{v:"cbm",l:"CBM"},{v:"fob",l:"FOB"}]},
              {k:"agente",l:"Agente",c:"#AF52DE",ops:[{v:"fob",l:"FOB"},{v:"cif",l:"CIF"}]},
              {k:"transporte",l:"Transporte",c:"#34C759",ops:[{v:"cbm",l:"CBM"},{v:"peso",l:"Peso"},{v:"fob",l:"FOB"}]},
              {k:"financiero",l:"Financiero",c:"#FF2D55",ops:[{v:"cif",l:"CIF"},{v:"fob",l:"FOB"}]}
            ].map(m=><div key={m.k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #F8F8FA"}}>
              <span style={{fontSize:11,fontWeight:600,color:m.c}}>{m.l}</span>
              <div style={{display:"flex",gap:3,background:"#F2F2F7",borderRadius:6,padding:2}}>
                {m.ops.map(o=><button key={o.v} onClick={()=>setMetodo(m.k,o.v)} style={{padding:"3px 8px",borderRadius:4,fontSize:10,fontWeight:600,border:"none",cursor:"pointer",background:metodos[m.k]===o.v?"#fff":"transparent",color:metodos[m.k]===o.v?m.c:"#8E8E93",boxShadow:metodos[m.k]===o.v?"0 1px 2px rgba(0,0,0,0.06)":"none"}}>{o.l}</button>)}
              </div>
            </div>)}
          </div>}
        </div>}
      </div>

      {/* RIGHT: Vista principal con tabs */}
      <div>
        {/* Tabs locales */}
        <div style={{display:"flex",gap:4,marginBottom:10,background:"#F2F2F7",borderRadius:10,padding:3,width:"fit-content"}}>
          {[{k:"pipeline",l:"📊 Pipeline",desc:"Cascada visual"},{k:"productos",l:"📦 Productos",desc:"Prorrateo por línea",disabled:productCosts.length===0},{k:"analisis",l:"🔍 Análisis",desc:"Insights"}].map(t=><button key={t.k} onClick={()=>!t.disabled&&setLocalTab(t.k)} disabled={t.disabled} style={{padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:t.disabled?"not-allowed":"pointer",background:tab===t.k?"#fff":"transparent",color:t.disabled?"#C7C7CC":tab===t.k?"#1C1C1E":"#8E8E93",boxShadow:tab===t.k?"0 1px 3px rgba(0,0,0,0.06)":"none",opacity:t.disabled?0.5:1}}>{t.l}</button>)}
        </div>

        {tab==="pipeline"&&<div>
          {/* Waterfall chart mejorado */}
          <div style={{background:"#fff",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:"#1C1C1E"}}>Cascada de costos</div>
                <div style={{fontSize:11,color:"#8E8E93",marginTop:1}}>Del FOB origen al costo final puesto en bodega</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:10,color:"#8E8E93",fontWeight:600,textTransform:"uppercase"}}>Total</div>
                <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>{fmt(costoTotalCLP)}</div>
              </div>
            </div>
            {/* Stacked bar horizontal */}
            <div style={{display:"flex",borderRadius:10,overflow:"hidden",height:42,marginBottom:14,boxShadow:"inset 0 1px 2px rgba(0,0,0,0.08)"}}>
              {stages.map((s,i)=>{const w=costoTotalCLP>0?s.v/costoTotalCLP*100:0;if(w<0.5)return null;return<div key={i} title={`${s.n}: ${fmt(s.v)} (${Math.round(w)}%)`} style={{width:w+"%",background:s.c,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:11,fontWeight:700,transition:"all 0.3s"}}>{w>=6?Math.round(w)+"%":""}</div>})}
            </div>
            {/* Cascada desglose */}
            {stages.map((s,i)=>{const pct=costoTotalCLP>0?s.v/costoTotalCLP*100:0;return<div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:i<stages.length-1?"1px solid #F8F8FA":"none"}}>
              <div style={{width:32,height:32,borderRadius:8,background:s.c+"15",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>{s.ic}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <div>
                    <span style={{fontSize:13,fontWeight:700,color:"#1C1C1E"}}>{s.n}</span>
                    <span style={{fontSize:10,color:"#8E8E93",marginLeft:8}}>{s.desc}</span>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <span style={{fontSize:14,fontWeight:800,color:s.c}}>{fmt(s.v)}</span>
                    <span style={{fontSize:11,color:"#8E8E93",marginLeft:6,fontWeight:600}}>{Math.round(pct)}%</span>
                  </div>
                </div>
                <div style={{width:"100%",background:"#F2F2F7",borderRadius:3,height:6,overflow:"hidden"}}><div style={{width:Math.max(s.v/maxStage*100,2)+"%",height:"100%",background:s.c,borderRadius:3,transition:"width 0.5s ease"}}/></div>
              </div>
            </div>})}
          </div>

          {/* Distribución FOB vs internación */}
          <div style={{background:"#fff",borderRadius:14,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
            <div style={{fontSize:13,fontWeight:700,color:"#1C1C1E",marginBottom:12}}>Distribución costos</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div style={{padding:"12px 14px",background:"#007AFF08",borderRadius:10,border:"1px solid #007AFF15"}}>
                <div style={{fontSize:10,fontWeight:700,color:"#007AFF",textTransform:"uppercase"}}>FOB Origen</div>
                <div style={{fontSize:20,fontWeight:800,color:"#007AFF",marginTop:4}}>{fmt(fobCLP)}</div>
                <div style={{fontSize:11,color:"#8E8E93"}}>{costoTotalCLP>0?Math.round(fobCLP/costoTotalCLP*100):0}% del costo total</div>
              </div>
              <div style={{padding:"12px 14px",background:"#AF52DE08",borderRadius:10,border:"1px solid #AF52DE15"}}>
                <div style={{fontSize:10,fontWeight:700,color:"#AF52DE",textTransform:"uppercase"}}>Gastos internación</div>
                <div style={{fontSize:20,fontWeight:800,color:"#AF52DE",marginTop:4}}>{fmt(gastosInternacion)}</div>
                <div style={{fontSize:11,color:"#8E8E93"}}>+{Math.round(pctInternacionSobreFOB*100)}% sobre el FOB</div>
              </div>
            </div>
          </div>
        </div>}

        {tab==="productos"&&productCosts.length>0&&<div style={{background:"#fff",borderRadius:14,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#1C1C1E"}}>📦 Costeo por línea de producto</div>
              <div style={{fontSize:11,color:"#8E8E93",marginTop:1}}>
                {hayCBM?"Prorrateo híbrido · FOB + CBM":hayPeso?"Prorrateo híbrido · FOB + Peso":"Prorrateo 100% por FOB"} · Cada categoría absorbe su parte proporcional
              </div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <Bd c="#AF52DE" bg="#AF52DE12" lg>Internación: +{Math.round(pctInternacionSobreFOB*100)}%</Bd>
              {hasOverrides&&<Bt v="suc" sm onClick={saveOverrides} ic="💾">Guardar CBM/peso</Bt>}
            </div>
          </div>

          {/* Alerta informativa si no hay CBM */}
          {!hayCBM&&!hayPeso&&<div style={{padding:"10px 14px",background:"#FF950008",borderRadius:10,border:"1px solid #FF950020",marginBottom:12,fontSize:12,color:"#636366"}}>
            <strong style={{color:"#FF9500"}}>💡 Sugerencia:</strong> Cargá CBM o peso por producto para un prorrateo más justo. Los productos voluminosos (panel UV, wall panel) consumen más flete que perfiles. Sin estos datos, todo se prorratea por FOB (valor).
          </div>}

          <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:1100}}>
            <thead><tr style={{background:"#F8F8FA"}}>
              <th style={{padding:"8px 6px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA"}}>PRODUCTO</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA"}}>CANT.</th>
              <th style={{padding:"8px 4px",textAlign:"center",fontSize:10,fontWeight:700,color:"#5856D6",borderBottom:"2px solid #E5E5EA"}}>CBM UNIT.</th>
              <th style={{padding:"8px 4px",textAlign:"center",fontSize:10,fontWeight:700,color:"#5856D6",borderBottom:"2px solid #E5E5EA"}}>KG UNIT.</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#007AFF",borderBottom:"2px solid #E5E5EA"}}>UNIT. ORIGEN</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA"}}>% FOB</th>
              {hayCBM&&<th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#5856D6",borderBottom:"2px solid #E5E5EA"}}>% CBM</th>}
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#AF52DE",borderBottom:"2px solid #E5E5EA"}}>INTERNAC.</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:800,color:"#007AFF",borderBottom:"2px solid #E5E5EA"}}>UNIT. BODEGA</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#FF9500",borderBottom:"2px solid #E5E5EA"}}>INCR.</th>
              <th style={{padding:"8px 4px",textAlign:"right",fontSize:10,fontWeight:700,color:"#34C759",borderBottom:"2px solid #E5E5EA"}}>P. VENTA SUG.</th>
            </tr></thead>
            <tbody>{productCosts.map((item,i)=><tr key={i} style={{borderBottom:"1px solid #F2F2F7"}}>
              <td style={{padding:"6px"}}><div style={{fontWeight:600,fontSize:11,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.producto}</div><div style={{fontSize:9,color:"#AEAEB2"}}>{item.sku}</div></td>
              <td style={{padding:"6px 4px",textAlign:"right",fontWeight:600}}>{fN(item.qty)}</td>
              <td style={{padding:"6px 4px",textAlign:"center"}}>
                <input type="number" step="0.001" min={0} value={item.cbm||0} onChange={e=>updOverride(item.id,"cbm",e.target.value)}
                  style={{width:60,padding:"3px 5px",borderRadius:4,border:itemsOverrides[item.id]?.cbm!==undefined?"2px solid #FF9500":"1px solid #E5E5EA",fontSize:11,textAlign:"right",fontWeight:600,color:item.cbm>0?"#5856D6":"#AEAEB2"}}
                  placeholder="0.00"/>
              </td>
              <td style={{padding:"6px 4px",textAlign:"center"}}>
                <input type="number" step="0.1" min={0} value={item.peso_kg||0} onChange={e=>updOverride(item.id,"peso_kg",e.target.value)}
                  style={{width:55,padding:"3px 5px",borderRadius:4,border:itemsOverrides[item.id]?.peso_kg!==undefined?"2px solid #FF9500":"1px solid #E5E5EA",fontSize:11,textAlign:"right",fontWeight:600,color:item.peso_kg>0?"#5856D6":"#AEAEB2"}}
                  placeholder="0.0"/>
              </td>
              <td style={{padding:"6px 4px",textAlign:"right",color:"#007AFF",fontWeight:600}}>{fmt(item.costoUnitOrigen)}</td>
              <td style={{padding:"6px 4px",textAlign:"right",color:"#636366",fontWeight:500}}>{(item.pctFOB*100).toFixed(1)}%</td>
              {hayCBM&&<td style={{padding:"6px 4px",textAlign:"right",color:"#5856D6",fontWeight:500}}>{(item.pctCBM*100).toFixed(1)}%</td>}
              <td style={{padding:"6px 4px",textAlign:"right",color:"#AF52DE",fontWeight:600}}>{fmt(item.totalInternacion)}</td>
              <td style={{padding:"6px 4px",textAlign:"right",fontWeight:800,color:"#007AFF",fontSize:13}}>{fmt(item.costoUnitFinal)}</td>
              <td style={{padding:"6px 4px",textAlign:"right"}}><span style={{padding:"2px 6px",borderRadius:4,fontSize:10,fontWeight:700,color:item.incremento>50?"#FF3B30":item.incremento>30?"#FF9500":"#34C759",background:item.incremento>50?"#FF3B3012":item.incremento>30?"#FF950012":"#34C75912"}}>+{item.incremento}%</span></td>
              <td style={{padding:"6px 4px",textAlign:"right",color:"#34C759",fontWeight:700}}>{fmt(item.precioVentaSug)}</td>
            </tr>)}</tbody>
            <tfoot><tr style={{borderTop:"2px solid #1C1C1E",background:"#F8F8FA"}}>
              <td style={{padding:"8px 6px",fontWeight:700}}>TOTALES</td>
              <td style={{padding:"8px 4px",textAlign:"right",fontWeight:700}}>{fN(productCosts.reduce((s,i)=>s+i.qty,0))}</td>
              <td style={{padding:"8px 4px",textAlign:"center",fontWeight:700,color:hayCBM?"#5856D6":"#AEAEB2"}}>{hayCBM?totalCbmFromLines.toFixed(2):"—"}</td>
              <td style={{padding:"8px 4px",textAlign:"center",fontWeight:700,color:hayPeso?"#5856D6":"#AEAEB2"}}>{hayPeso?fN(totalPesoFromLines):"—"}</td>
              <td></td>
              <td style={{padding:"8px 4px",textAlign:"right",fontWeight:700}}>100%</td>
              {hayCBM&&<td style={{padding:"8px 4px",textAlign:"right",fontWeight:700}}>100%</td>}
              <td style={{padding:"8px 4px",textAlign:"right",fontWeight:700,color:"#AF52DE"}}>{fmt(productCosts.reduce((s,i)=>s+i.totalInternacion,0))}</td>
              <td colSpan={3} style={{padding:"8px 4px",textAlign:"right",fontSize:14,fontWeight:800}}>{fmt(costoTotalCLP)}</td>
            </tr></tfoot>
          </table></div>

          {hasOverrides&&<div style={{padding:"10px 14px",background:"#FFF3E0",borderRadius:10,border:"1px solid #FF950030",marginTop:12,fontSize:11,color:"#636366",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>⚠ Hay cambios de CBM/peso sin guardar · {Object.keys(itemsOverrides).length} producto(s) modificados</span>
            <Bt v="suc" sm onClick={saveOverrides} ic="💾">Guardar cambios</Bt>
          </div>}
        </div>}

        {tab==="productos"&&productCosts.length===0&&<div style={{background:"#fff",borderRadius:14,padding:60,boxShadow:"0 1px 3px rgba(0,0,0,0.04)",textAlign:"center"}}>
          <div style={{fontSize:48,marginBottom:12}}>📦</div>
          <div style={{fontSize:16,fontWeight:700,color:"#1C1C1E"}}>Seleccioná una OC de importación</div>
          <div style={{fontSize:13,color:"#8E8E93",marginTop:6,maxWidth:400,margin:"6px auto 0"}}>Para ver el costeo por línea, elegí una OC del selector superior. Los gastos se prorratean proporcionalmente al valor FOB de cada producto.</div>
        </div>}

        {tab==="analisis"&&<div>
          {/* Ratios clave */}
          <div style={{background:"#fff",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:700,color:"#1C1C1E",marginBottom:12}}>📊 Ratios clave</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              {[
                {l:"Ratio internación",v:`+${Math.round(pctInternacionSobreFOB*100)}%`,sub:"Sobre FOB origen",c:pctInternacionSobreFOB>0.5?"#FF3B30":pctInternacionSobreFOB>0.35?"#FF9500":"#34C759",benchmark:"Óptimo: <35%"},
                {l:"Costo Aduana/CIF",v:cifCLP>0?`${Math.round(totalAduana/cifCLP*100)}%`:"—",sub:fmt(totalAduana),c:"#FF3B30",benchmark:"Chile: 25% típico"},
                {l:"Flete/FOB",v:fobCLP>0?`${Math.round(Math.round(fleteUSD*TC)/fobCLP*100)}%`:"—",sub:fmt(Math.round(fleteUSD*TC)),c:"#5856D6",benchmark:"Óptimo: 5-15%"},
                {l:"Gastos portuarios",v:fobCLP>0?`${Math.round(totalPuerto/fobCLP*100)}%`:"—",sub:fmt(totalPuerto),c:"#FF9500",benchmark:"Variable según TEU"},
                {l:"Costo financiero",v:cifCLP>0?`${Math.round(totalFinanciero/cifCLP*100)}%`:"—",sub:`${p.diasTransito}d tránsito`,c:"#FF2D55",benchmark:"2-4% típico"},
                {l:"Break-even margen",v:costoUnitBodega>0?`${Math.round(gastosInternacion/costoTotalCLP*100)}%`:"—",sub:"Para cubrir internación",c:"#AF52DE",benchmark:"Margen mínimo"}
              ].map((r,i)=><div key={i} style={{padding:"12px 14px",borderRadius:10,background:r.c+"06",border:`1px solid ${r.c}15`}}>
                <div style={{fontSize:10,fontWeight:700,color:r.c,textTransform:"uppercase",letterSpacing:"0.02em"}}>{r.l}</div>
                <div style={{fontSize:24,fontWeight:800,color:r.c,marginTop:4,letterSpacing:"-0.02em"}}>{r.v}</div>
                <div style={{fontSize:11,color:"#8E8E93",marginTop:2}}>{r.sub}</div>
                <div style={{fontSize:10,color:"#AEAEB2",marginTop:6,fontStyle:"italic"}}>💡 {r.benchmark}</div>
              </div>)}
            </div>
          </div>

          {/* Insights automáticos */}
          <div style={{background:"#fff",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:700,color:"#1C1C1E",marginBottom:12}}>💡 Insights automáticos</div>
            {(()=>{const insights=[]
              if(pctInternacionSobreFOB>0.6)insights.push({ic:"⚠️",t:"Internación muy alta",d:`Los gastos de internación representan +${Math.round(pctInternacionSobreFOB*100)}% sobre el FOB, considerablemente por encima del 35% óptimo. Revisá costos fijos (agente, transporte) o negociá flete.`,c:"#FF3B30"})
              else if(pctInternacionSobreFOB<0.25)insights.push({ic:"✅",t:"Internación eficiente",d:`Solo +${Math.round(pctInternacionSobreFOB*100)}% sobre FOB. Excelente eficiencia en gastos de importación.`,c:"#34C759"})
              if(p.diasAlmacenaje>7)insights.push({ic:"📦",t:"Almacenaje excesivo",d:`${p.diasAlmacenaje} días de almacenaje en puerto = ${fmt(almacenajeCLP)}. Acelerá trámites de aduana para bajar el costo.`,c:"#FF9500"})
              if(p.pctCostoFinanciero>2)insights.push({ic:"💰",t:"Costo financiero elevado",d:`${p.pctCostoFinanciero}%/mes es alto. Considerá fuentes de financiamiento alternativas o prepago.`,c:"#FF2D55"})
              if(!p.tieneILC&&p.pctArancel>6)insights.push({ic:"🤝",t:"Posible ahorro con TLC",d:`Arancel actual: ${p.pctArancel}%. Si tu proveedor es de país con TLC (China, EE.UU., etc.), podés pagar 0%. Verificá certificado de origen.`,c:"#007AFF"})
              if(margenPct<15&&precioVenta>0)insights.push({ic:"📉",t:"Margen bajo",d:`Margen de ${margenPct}% está por debajo del 15% recomendado. ${modoCalc==="costo"?"Considerá subir el precio de venta":"Apuntá a >25% de margen"}.`,c:"#FF9500"})
              if(margenPct>50)insights.push({ic:"🎯",t:"Margen excelente",d:`Margen de ${margenPct}% muy saludable. Validá que el precio sea competitivo en el mercado.`,c:"#34C759"})
              if(productCosts.length>0){const maxIncr=Math.max(...productCosts.map(p=>p.incremento));const prodMax=productCosts.find(p=>p.incremento===maxIncr);if(maxIncr>100)insights.push({ic:"🔥",t:"Producto con alto incremento",d:`"${prodMax.producto}" tiene +${maxIncr}% de incremento (origen ${fmt(prodMax.costoUnitOrigen)} → bodega ${fmt(prodMax.costoUnitFinal)}). Revisá si es normal para esa categoría.`,c:"#FF3B30"})}
              if(insights.length===0)insights.push({ic:"👍",t:"Costeo balanceado",d:"Los parámetros están dentro de rangos razonables. Podés ajustar el margen objetivo para optimizar el precio de venta.",c:"#007AFF"})
              return insights.map((ins,i)=><div key={i} style={{padding:"12px 14px",borderRadius:10,background:ins.c+"06",border:`1px solid ${ins.c}15`,borderLeft:`3px solid ${ins.c}`,marginBottom:8,display:"flex",gap:10,alignItems:"flex-start"}}>
                <div style={{fontSize:18,flexShrink:0}}>{ins.ic}</div>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:ins.c}}>{ins.t}</div>
                  <div style={{fontSize:12,color:"#3A3A3C",marginTop:2,lineHeight:1.5}}>{ins.d}</div>
                </div>
              </div>)
            })()}
          </div>

          {/* Comparador con otras OCs */}
          {ocsImp.filter(o=>o.id!==selOC).length>0&&<div style={{background:"#fff",borderRadius:14,padding:"18px 22px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
            <div style={{fontSize:14,fontWeight:700,color:"#1C1C1E",marginBottom:4}}>🔍 Comparador con otras OCs</div>
            <div style={{fontSize:11,color:"#8E8E93",marginBottom:12}}>Otras OCs de importación para comparar escala</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{background:"#F8F8FA"}}>
                <th style={{padding:"6px 10px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366"}}>OC</th>
                <th style={{padding:"6px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366"}}>Estado</th>
                <th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,color:"#007AFF"}}>FOB CLP</th>
                <th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,color:"#AF52DE"}}>USD</th>
              </tr></thead>
              <tbody>{ocsImp.slice(0,8).map(o=><tr key={o.id} style={{borderBottom:"1px solid #F2F2F7",background:o.id===selOC?"#007AFF08":"transparent"}}>
                <td style={{padding:"8px 10px",fontWeight:600,fontFamily:"monospace"}}>{o.id}{o.id===selOC&&<span style={{marginLeft:6,fontSize:10,color:"#007AFF",fontWeight:700}}>● activa</span>}</td>
                <td style={{padding:"8px"}}><Bd c={STS[o.estado]?.c} bg={STS[o.estado]?.bg}>{o.estado}</Bd></td>
                <td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{fmt(o.total_clp)}</td>
                <td style={{padding:"8px",textAlign:"right",color:"#AF52DE",fontWeight:600}}>{fU(o.total_usd||0)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </div>}
      </div>
    </div>
  </div>
}

/* ═══ TRÁNSITO — Products in transit with ETA + Export ═══ */
function TransitoView({ocs,provs}){
  const activas=ocs.filter(o=>!["Cerrada","Rechazada","Pend. Dir. Negocios","Pend. Dir. Finanzas"].includes(o.estado)&&!o.estado?.includes("Recibida"))
  const[items,setItems]=useState([])
  useEffect(()=>{
    const load=async()=>{
      if(activas.length===0){setItems([]);return}
      const ids=activas.map(o=>o.id)
      const{data,error}=await supabase.from('oc_items').select('*').in('oc_id',ids)
      if(error)console.error("Error cargando oc_items en Tránsito:",error)
      console.log(`Tránsito: ${activas.length} OCs activas, IDs:`,ids,`items encontrados: ${(data||[]).length}`)
      setItems(data||[])
    }
    load()
  },[ocs.map(o=>o.id+o.estado).join(",")])

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
          // Si la OC no tiene items cargados, mostrar placeholder
          if(ocItems.length===0){
            return[<tr key={oc.id+"-empty"} style={{borderBottom:"1px solid #F2F2F7",background:"#FFF8E7"}}>
              <td style={{padding:"8px 6px",verticalAlign:"top",borderRight:"2px solid #E5E5EA"}}><div style={{fontWeight:700,fontFamily:"monospace",fontSize:11}}>{oc.id}</div><Bd c={isI?"#FF3B30":"#007AFF"} bg={isI?"#FF3B3015":"#007AFF15"}>{isI?"IMP":"NAC"}</Bd></td>
              <td style={{padding:"8px 6px",verticalAlign:"top"}}><div style={{fontWeight:600,fontSize:11}}>{pv?.nombre||oc.proveedor_id}</div></td>
              <td style={{padding:"8px 6px",verticalAlign:"top"}}><Bd c={STS[oc.estado]?.c} bg={STS[oc.estado]?.bg}>{STS[oc.estado]?.ic} {oc.estado}</Bd></td>
              <td colSpan={4} style={{padding:"8px 12px",color:"#FF9500",fontSize:11,fontStyle:"italic"}}>⚠ Esta OC no tiene productos cargados. Verificá el detalle de la OC.</td>
              <td style={{padding:"8px 6px",textAlign:"right",verticalAlign:"top"}}><div style={{fontWeight:600,color:oc.fecha_estimada?"#1C1C1E":"#AEAEB2"}}>{oc.fecha_estimada||"Sin fecha"}</div></td>
            </tr>]
          }
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

/* ═══ FINANZAS — Proyección de pagos OC en tránsito ═══ */
function FinanzasView({ocs,provs,pagos,setPagos}){
  const aprobadas=ocs.filter(o=>!["Cerrada","Rechazada","Pend. Dir. Negocios","Pend. Dir. Finanzas","Recibida OK"].includes(o.estado))

  const[vista,setVista]=useState("timeline")
  const[filtroProv,setFiltroProv]=useState("")
  const[filtroTipo,setFiltroTipo]=useState("")

  const hitos=useMemo(()=>{
    const out=[]
    aprobadas.forEach(oc=>{
      const pv=provs.find(p=>p.id===oc.proveedor_id)
      const pagosOC=pagos.filter(p=>p.oc_id===oc.id)
      const moneda=pv?.moneda||"CLP"
      const totalRef=moneda==="USD"?(oc.total_usd||0):(oc.total_clp||0)

      // ⭐ Si hay pagos programados (insertados desde plan de pago en Nueva OC), usarlos
      const programados=pagosOC.filter(p=>p.fecha_programada||p.orden)
      if(programados.length>0){
        programados.sort((a,b)=>(a.orden||0)-(b.orden||0))
        programados.forEach(p=>{
          out.push({
            oc_id:oc.id,oc,prov:pv,
            hito:p.etapa||p.concepto?.toLowerCase().replace(/\s+/g,"_")||"pago",
            label:p.concepto||"Pago",
            pct:p.pct||100,
            monto:p.monto||0,
            moneda:p.moneda||moneda,
            fecha_proy:p.fecha_programada||p.fecha_pago||oc.fecha_creacion,
            pagado:p.estado==="Pagado",
            fecha_real:p.fecha_pago,
            pago_id:p.id
          })
        })
      }else{
        // Fallback: lógica legacy para OCs sin plan de pago estructurado
        if(oc.tipo_oc==="Importación"){
          const pctF=oc.pct_fab||pv?.pct_fabricacion||0
          const pctE=oc.pct_embarque||pv?.pct_embarque||0
          const pctP=oc.pct_puerto||pv?.pct_puerto||0
          const pagadosOC=pagosOC.filter(p=>p.estado==="Pagado")
          if(pctF>0)out.push({oc_id:oc.id,oc,prov:pv,hito:"fabricacion",label:"Pago fabricación",pct:pctF,monto:totalRef*pctF/100,moneda,fecha_proy:oc.fecha_creacion,pagado:!!pagadosOC.find(p=>p.concepto?.toLowerCase().includes("fabri")),fecha_real:pagadosOC.find(p=>p.concepto?.toLowerCase().includes("fabri"))?.fecha_pago})
          if(pctE>0)out.push({oc_id:oc.id,oc,prov:pv,hito:"embarque",label:"Pago embarque",pct:pctE,monto:totalRef*pctE/100,moneda,fecha_proy:oc.etd||addDias(oc.fecha_creacion,45),pagado:!!pagadosOC.find(p=>p.concepto?.toLowerCase().includes("embar")),fecha_real:pagadosOC.find(p=>p.concepto?.toLowerCase().includes("embar"))?.fecha_pago})
          if(pctP>0)out.push({oc_id:oc.id,oc,prov:pv,hito:"puerto",label:"Pago puerto",pct:pctP,monto:totalRef*pctP/100,moneda,fecha_proy:oc.eta||addDias(oc.fecha_creacion,75),pagado:!!pagadosOC.find(p=>p.concepto?.toLowerCase().includes("puerto")),fecha_real:pagadosOC.find(p=>p.concepto?.toLowerCase().includes("puerto"))?.fecha_pago})
        }else{
          const cond=(oc.condicion_pago||pv?.condicion_pago||"Contado").toString().toLowerCase()
          const dias=cond.includes("90")?90:cond.includes("60")?60:cond.includes("45")?45:cond.includes("30")?30:cond.includes("15")?15:0
          const fechaBase=oc.fecha_real_recepcion||oc.fecha_creacion
          const pagadosOC=pagosOC.filter(p=>p.estado==="Pagado")
          out.push({oc_id:oc.id,oc,prov:pv,hito:dias===0?"contado":`credito_${dias}`,label:dias===0?"Pago contado":`Crédito ${dias} días`,pct:100,monto:totalRef,moneda,fecha_proy:dias===0?oc.fecha_creacion:addDias(fechaBase,dias),pagado:pagadosOC.length>0,fecha_real:pagadosOC[0]?.fecha_pago})
        }
      }
    })
    return out
  },[aprobadas,pagos,provs])

  const hitosFil=hitos.filter(h=>{
    if(filtroProv&&h.prov?.id!==filtroProv)return false
    if(filtroTipo&&h.oc.tipo_oc!==filtroTipo)return false
    return true
  })

  const pendientes=hitosFil.filter(h=>!h.pagado)

  const TC=1000
  const enCLP=h=>h.moneda==="USD"?h.monto*TC:h.monto

  const vencidos=pendientes.filter(h=>diff(h.fecha_proy)<0)
  const prox7=pendientes.filter(h=>{const d=diff(h.fecha_proy);return d>=0&&d<=7})
  const prox30=pendientes.filter(h=>{const d=diff(h.fecha_proy);return d>=0&&d<=30})
  const prox60=pendientes.filter(h=>{const d=diff(h.fecha_proy);return d>=0&&d<=60})
  const prox90=pendientes.filter(h=>{const d=diff(h.fecha_proy);return d>=0&&d<=90})
  const totalPend=pendientes.reduce((s,h)=>s+enCLP(h),0)
  const totalVenc=vencidos.reduce((s,h)=>s+enCLP(h),0)
  const total30=prox30.reduce((s,h)=>s+enCLP(h),0)
  const total60=prox60.reduce((s,h)=>s+enCLP(h),0)
  const total90=prox90.reduce((s,h)=>s+enCLP(h),0)
  const totalUSD=pendientes.filter(h=>h.moneda==="USD").reduce((s,h)=>s+h.monto,0)
  const totalCLPpuro=pendientes.filter(h=>h.moneda==="CLP").reduce((s,h)=>s+h.monto,0)

  const expProv={};pendientes.forEach(h=>{const k=h.prov?.nombre||h.oc.proveedor_id;expProv[k]=(expProv[k]||0)+enCLP(h)})
  const topProv=Object.entries(expProv).sort((a,b)=>b[1]-a[1]).slice(0,5)

  const proxCritico=pendientes.filter(h=>diff(h.fecha_proy)>=0).sort((a,b)=>new Date(a.fecha_proy)-new Date(b.fecha_proy))[0]

  const semanas=useMemo(()=>{
    const map={}
    pendientes.forEach(h=>{
      if(diff(h.fecha_proy)<0)return
      const d=new Date(h.fecha_proy)
      const lunes=new Date(d);lunes.setDate(d.getDate()-((d.getDay()+6)%7));lunes.setHours(0,0,0,0)
      const k=lunes.toISOString().slice(0,10)
      if(!map[k])map[k]={lunes,hitos:[],total:0}
      map[k].hitos.push(h);map[k].total+=enCLP(h)
    })
    return Object.values(map).sort((a,b)=>a.lunes-b.lunes)
  },[pendientes])

  const exportCSV=()=>{
    const head=["OC","Tipo","Proveedor","Hito","%","Monto","Moneda","Fecha proyectada","Días","Estado"]
    const rows=hitosFil.map(h=>[h.oc_id,h.oc.tipo_oc,h.prov?.nombre||h.oc.proveedor_id,h.label,h.pct+"%",h.monto.toFixed(0),h.moneda,h.fecha_proy,diff(h.fecha_proy),h.pagado?"Pagado":"Pendiente"])
    const csv="\uFEFF"+[head,...rows].map(r=>r.join(";")).join("\n")
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`pagos_proyectados_${hoy()}.csv`;a.click()
  }

  // ⭐ Modal de pago con comprobante obligatorio
  const[pagoModal,setPagoModal]=useState(null) // hito seleccionado para pagar
  const[pagoForm,setPagoForm]=useState({fecha:hoy(),monto:"",obs:"",file:null,fileName:"",uploading:false})

  const abrirPagoModal=(h)=>{
    setPagoModal(h)
    setPagoForm({fecha:hoy(),monto:h.monto.toFixed(0),obs:"",file:null,fileName:"",uploading:false})
  }

  const confirmarPago=async()=>{
    if(!pagoForm.file){alert("⚠ Debés adjuntar un comprobante de pago (obligatorio)");return}
    if(!pagoForm.fecha){alert("⚠ Falta la fecha de pago");return}
    if(!pagoForm.monto||Number(pagoForm.monto)<=0){alert("⚠ El monto debe ser mayor a 0");return}
    setPagoForm(p=>({...p,uploading:true}))
    const h=pagoModal
    try{
      // 1) Subir comprobante a Supabase Storage
      const ext=pagoForm.fileName.split(".").pop()||"pdf"
      const sanitize=s=>(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"_").replace(/_+/g,"_")
      const path=`${sanitize(h.oc_id)}/${sanitize(h.hito)}_${Date.now()}.${ext}`
      const{error:upErr}=await supabase.storage.from('comprobantes').upload(path,pagoForm.file,{upsert:true})
      if(upErr){alert("Error subiendo archivo: "+upErr.message);setPagoForm(p=>({...p,uploading:false}));return}
      // 2) Obtener URL pública
      const{data:urlData}=supabase.storage.from('comprobantes').getPublicUrl(path)
      const comprobanteUrl=urlData?.publicUrl||""

      // 3) Actualizar o crear el pago
      const montoReal=parseFloat(pagoForm.monto)
      if(h.pago_id){
        const{error}=await supabase.from('pagos').update({estado:"Pagado",fecha_pago:pagoForm.fecha,monto:montoReal,comprobante_url:comprobanteUrl,comprobante_nombre:pagoForm.fileName,observaciones_pago:pagoForm.obs||null}).eq('id',h.pago_id)
        if(error){alert("Error: "+error.message);setPagoForm(p=>({...p,uploading:false}));return}
        setPagos(prev=>prev.map(p=>p.id===h.pago_id?{...p,estado:"Pagado",fecha_pago:pagoForm.fecha,monto:montoReal,comprobante_url:comprobanteUrl,comprobante_nombre:pagoForm.fileName,observaciones_pago:pagoForm.obs}:p))
      }else{
        const p={id:uid(),oc_id:h.oc_id,concepto:h.label,monto:montoReal,moneda:h.moneda,fecha_pago:pagoForm.fecha,estado:"Pagado",etapa:h.hito,comprobante_url:comprobanteUrl,comprobante_nombre:pagoForm.fileName,observaciones_pago:pagoForm.obs||null}
        const{error}=await supabase.from('pagos').insert(p)
        if(error){alert("Error: "+error.message);setPagoForm(p=>({...p,uploading:false}));return}
        setPagos(prev=>[...prev,p])
      }

      // 4) Registrar en documentos_import para que aparezca en el historial de la OC
      await supabase.from('documentos_import').insert({id:uid(),oc_id:h.oc_id,tipo:`comprobante_pago_${h.hito}`,nombre_archivo:pagoForm.fileName,url:comprobanteUrl,descripcion:`Comprobante: ${h.label} — ${h.moneda} ${fN(montoReal)} — ${pagoForm.fecha}${pagoForm.obs?` — ${pagoForm.obs}`:""}`})

      setPagoModal(null)
    }catch(e){
      alert("Error inesperado: "+e.message)
    }
    setPagoForm(p=>({...p,uploading:false}))
  }

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
      <div>
        <div style={{fontSize:22,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Control financiero · Pagos proyectados</div>
        <div style={{fontSize:13,color:"#8E8E93"}}>{aprobadas.length} OC activas · {pendientes.length} pagos pendientes · {fmt(totalPend)} comprometido</div>
      </div>
      <div style={{display:"flex",gap:6}}>
        <Bt v={vista==="timeline"?"pri":"gry"} onClick={()=>setVista("timeline")} sm ic="📅">Timeline</Bt>
        <Bt v={vista==="dashboard"?"pri":"gry"} onClick={()=>setVista("dashboard")} sm ic="📊">Dashboard</Bt>
        <Bt v="gry" onClick={exportCSV} sm ic="📥">CSV</Bt>
      </div>
    </div>

    <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
      <select value={filtroProv} onChange={e=>setFiltroProv(e.target.value)} style={{...css.select,flex:"1 1 200px",maxWidth:300}}>
        <option value="">Todos los proveedores</option>
        {provs.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>
      <select value={filtroTipo} onChange={e=>setFiltroTipo(e.target.value)} style={{...css.select,maxWidth:200}}>
        <option value="">Todos los tipos</option>
        <option value="Nacional">Solo Nacional</option>
        <option value="Importación">Solo Importación</option>
      </select>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:14}}>
      <Mt l="Vencidos" v={fmt(totalVenc)} sub={`${vencidos.length} pagos`} ac={vencidos.length?"#FF3B30":"#34C759"} ic="⚠️"/>
      <Mt l="Próx. 7 días" v={fmt(prox7.reduce((s,h)=>s+enCLP(h),0))} sub={`${prox7.length} pagos`} ac="#FF9500" ic="🔴"/>
      <Mt l="Próx. 30 días" v={fmt(total30)} sub={`${prox30.length} pagos`} ac="#007AFF" ic="📅"/>
      <Mt l="Próx. 60 días" v={fmt(total60)} sub={`${prox60.length} pagos`} ac="#5856D6" ic="📆"/>
      <Mt l="Próx. 90 días" v={fmt(total90)} sub={`${prox90.length} pagos`} ac="#AF52DE" ic="🗓"/>
    </div>

    {pendientes.length===0?<div style={{textAlign:"center",padding:40,background:"#fff",borderRadius:12}}><div style={{fontSize:32,marginBottom:8}}>✅</div><div style={{color:"#8E8E93"}}>Sin pagos pendientes proyectados</div></div>:vista==="dashboard"?
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        {proxCritico&&<Cd ac="#FF3B30">
          <div style={{fontSize:11,color:"#8E8E93",fontWeight:600,textTransform:"uppercase",marginBottom:6}}>⏰ Próximo pago crítico</div>
          <div style={{fontSize:24,fontWeight:800,color:"#FF3B30",letterSpacing:"-0.02em"}}>{proxCritico.moneda==="USD"?fU(proxCritico.monto):fmt(proxCritico.monto)}</div>
          <div style={{fontSize:13,marginTop:4,fontWeight:600}}>{proxCritico.label}</div>
          <div style={{fontSize:12,color:"#8E8E93",marginTop:2}}>{proxCritico.prov?.nombre} · {proxCritico.oc_id}</div>
          <div style={{fontSize:12,color:"#FF9500",marginTop:6,fontWeight:600}}>📅 {proxCritico.fecha_proy} · en {diff(proxCritico.fecha_proy)} días</div>
        </Cd>}
        <Cd>
          <div style={{fontSize:11,color:"#8E8E93",fontWeight:600,textTransform:"uppercase",marginBottom:8}}>💱 Por moneda</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #F2F2F7"}}>
            <div><div style={{fontSize:13,fontWeight:600}}>CLP</div><div style={{fontSize:10,color:"#8E8E93"}}>Nacional</div></div>
            <div style={{fontSize:18,fontWeight:700,color:"#007AFF"}}>{fmt(totalCLPpuro)}</div>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0"}}>
            <div><div style={{fontSize:13,fontWeight:600}}>USD</div><div style={{fontSize:10,color:"#8E8E93"}}>Importación</div></div>
            <div><div style={{fontSize:18,fontWeight:700,color:"#34C759",textAlign:"right"}}>{fU(totalUSD)}</div><div style={{fontSize:10,color:"#8E8E93",textAlign:"right"}}>≈ {fmt(totalUSD*TC)}</div></div>
          </div>
        </Cd>
      </div>

      <Cd>
        <div style={{fontSize:11,color:"#8E8E93",fontWeight:600,textTransform:"uppercase",marginBottom:10}}>🏢 Top exposición por proveedor</div>
        {topProv.length===0?<div style={{color:"#8E8E93",fontSize:12}}>Sin datos</div>:topProv.map(([nom,monto],i)=>{const max=topProv[0][1];const w=(monto/max)*100;return<div key={i} style={{marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:2}}>
            <div style={{fontWeight:600}}>{nom}</div>
            <div style={{fontWeight:700,color:"#1C1C1E"}}>{fmt(monto)}</div>
          </div>
          <div style={{height:6,background:"#F2F2F7",borderRadius:3,overflow:"hidden"}}><div style={{width:w+"%",height:"100%",background:i===0?"#FF3B30":i===1?"#FF9500":"#007AFF"}}/></div>
        </div>})}
      </Cd>

      {vencidos.length>0&&<Cd ac="#FF3B30" s={{marginTop:12}}>
        <div style={{fontSize:11,color:"#FF3B30",fontWeight:700,textTransform:"uppercase",marginBottom:8}}>⚠️ Pagos vencidos · {vencidos.length}</div>
        {vencidos.map((h,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:i<vencidos.length-1?"1px solid #F2F2F7":"none"}}>
          <div>
            <div style={{fontSize:13,fontWeight:600}}>{h.label} · {h.prov?.nombre}</div>
            <div style={{fontSize:11,color:"#8E8E93"}}>{h.oc_id} · vencido hace {Math.abs(diff(h.fecha_proy))} días</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{fontSize:14,fontWeight:700,color:"#FF3B30"}}>{h.moneda==="USD"?fU(h.monto):fmt(h.monto)}</div>
            <Bt v="suc" sm onClick={()=>abrirPagoModal(h)}>✓ Pagar</Bt>
          </div>
        </div>)}
      </Cd>}
    </div>
    :
    <div>
      {vencidos.length>0&&<Cd ac="#FF3B30" s={{background:"#FF3B3008"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:13,fontWeight:700,color:"#FF3B30"}}>⚠️ VENCIDOS · {vencidos.length} pagos · {fmt(totalVenc)}</div>
        </div>
        {vencidos.map((h,i)=><HitoRow key={i} h={h} onPagar={()=>abrirPagoModal(h)}/>)}
      </Cd>}

      {semanas.slice(0,12).map((sem,i)=>{
        const finSem=new Date(sem.lunes);finSem.setDate(sem.lunes.getDate()+6)
        const lbl=`Semana del ${sem.lunes.toLocaleDateString("es-CL",{day:"2-digit",month:"short"})} al ${finSem.toLocaleDateString("es-CL",{day:"2-digit",month:"short"})}`
        return<Cd key={i} s={{marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,paddingBottom:6,borderBottom:"1px solid #F2F2F7"}}>
            <div>
              <div style={{fontSize:13,fontWeight:700}}>{lbl}</div>
              <div style={{fontSize:10,color:"#8E8E93"}}>{sem.hitos.length} {sem.hitos.length===1?"pago":"pagos"}</div>
            </div>
            <div style={{fontSize:18,fontWeight:800,color:"#007AFF",letterSpacing:"-0.02em"}}>{fmt(sem.total)}</div>
          </div>
          {sem.hitos.map((h,j)=><HitoRow key={j} h={h} onPagar={()=>abrirPagoModal(h)}/>)}
        </Cd>
      })}

      {semanas.length===0&&vencidos.length===0&&<div style={{textAlign:"center",padding:40,color:"#8E8E93"}}>Sin pagos en próximas 12 semanas</div>}
    </div>}

    {/* ⭐ Modal de registro de pago con comprobante */}
    {pagoModal&&<div style={css.modal} onClick={()=>!pagoForm.uploading&&setPagoModal(null)}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"8px 24px 32px",width:"100%",maxWidth:520,maxHeight:"92vh",overflow:"auto",animation:"slideUp 0.3s ease"}}>
        <div style={{width:36,height:4,borderRadius:2,background:"#E5E5EA",margin:"0 auto 12px"}}/>
        <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>Registrar pago</div>
        <div style={{fontSize:13,color:"#8E8E93",marginBottom:16}}>{pagoModal.label} · {pagoModal.oc_id} · {pagoModal.prov?.nombre}</div>

        <div style={{background:"#F9FAFB",borderRadius:10,padding:"14px 16px",marginBottom:16,border:"1px solid #E5E5EA"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:11,color:"#8E8E93",fontWeight:600}}>Monto programado</div><div style={{fontSize:22,fontWeight:800,color:"#1C1C1E"}}>{pagoModal.moneda==="USD"?fU(pagoModal.monto):fmt(pagoModal.monto)}</div></div>
            <Bd c={pagoModal.moneda==="USD"?"#34C759":"#007AFF"} bg={pagoModal.moneda==="USD"?"#34C75915":"#007AFF15"} lg>{pagoModal.moneda}</Bd>
          </div>
          {pagoModal.pct<100&&<div style={{fontSize:11,color:"#8E8E93",marginTop:4}}>({pagoModal.pct}% del total de la OC)</div>}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
          <Fl l="Fecha de pago" req>
            <input type="date" value={pagoForm.fecha} onChange={e=>setPagoForm(p=>({...p,fecha:e.target.value}))} style={css.input}/>
          </Fl>
          <Fl l="Monto real pagado" req>
            <input type="number" min={0} step="any" value={pagoForm.monto} onChange={e=>setPagoForm(p=>({...p,monto:e.target.value}))} style={css.input} placeholder={pagoModal.monto.toFixed(0)}/>
          </Fl>
        </div>

        <Fl l="Comprobante de pago" req>
          <div style={{border:"2px dashed "+(pagoForm.file?"#34C759":"#007AFF"),borderRadius:12,padding:"16px 20px",textAlign:"center",cursor:"pointer",background:pagoForm.file?"#34C75908":"#007AFF05",transition:"all 0.2s"}}
            onClick={()=>document.getElementById("comprobante-input").click()}>
            {pagoForm.file?<>
              <div style={{fontSize:24,marginBottom:4}}>✅</div>
              <div style={{fontSize:13,fontWeight:600,color:"#34C759"}}>{pagoForm.fileName}</div>
              <div style={{fontSize:11,color:"#8E8E93",marginTop:2}}>Click para cambiar archivo</div>
            </>:<>
              <div style={{fontSize:24,marginBottom:4}}>📎</div>
              <div style={{fontSize:13,fontWeight:600,color:"#007AFF"}}>Click para adjuntar comprobante</div>
              <div style={{fontSize:11,color:"#8E8E93",marginTop:2}}>PDF, imagen o documento (obligatorio)</div>
            </>}
          </div>
          <input id="comprobante-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" style={{display:"none"}}
            onChange={e=>{const f=e.target.files[0];if(f)setPagoForm(p=>({...p,file:f,fileName:f.name}));e.target.value=""}}/>
        </Fl>

        <Fl l="Observaciones (opcional)">
          <textarea value={pagoForm.obs} onChange={e=>setPagoForm(p=>({...p,obs:e.target.value}))} rows={2} style={{...css.input,resize:"vertical"}} placeholder="Ej: Transferencia Banco Estado, ref #12345"/>
        </Fl>

        <div style={{display:"flex",gap:10,marginTop:8}}>
          <Bt v="pri" full onClick={confirmarPago} dis={pagoForm.uploading||!pagoForm.file} ic={pagoForm.uploading?"⏳":"✓"}>
            {pagoForm.uploading?"Subiendo comprobante...":"Confirmar pago"}
          </Bt>
          <Bt v="gry" onClick={()=>setPagoModal(null)} dis={pagoForm.uploading}>Cancelar</Bt>
        </div>
      </div>
    </div>}
  </div>
}

function HitoRow({h,onPagar}){
  const d=diff(h.fecha_proy)
  const semaforo=d<0?"#FF3B30":d<=3?"#FF9500":d<=7?"#FFCC00":"#34C759"
  const esIMP=h.oc.tipo_oc==="Importación"
  return<div style={{display:"flex",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #F8F8FA",gap:10}}>
    <div style={{width:8,height:8,borderRadius:4,background:semaforo,flexShrink:0}}/>
    <div style={{flex:1,minWidth:0}}>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
        <span style={{fontSize:13,fontWeight:600}}>{h.label}</span>
        <Bd c={esIMP?"#FF3B30":"#007AFF"} bg={esIMP?"#FF3B3015":"#007AFF15"}>{esIMP?"IMP":"NAC"}</Bd>
        {h.pct<100&&<Bd c="#8E8E93" bg="#F2F2F7">{h.pct}%</Bd>}
      </div>
      <div style={{fontSize:11,color:"#8E8E93"}}>{h.prov?.nombre||h.oc.proveedor_id} · {h.oc_id} · 📅 {h.fecha_proy} {d>=0?`(en ${d}d)`:`(vencido ${Math.abs(d)}d)`}</div>
    </div>
    <div style={{textAlign:"right",fontSize:14,fontWeight:700,color:"#1C1C1E"}}>{h.moneda==="USD"?fU(h.monto):fmt(h.monto)}</div>
    <Bt v="suc" sm onClick={onPagar}>✓</Bt>
  </div>
}

/* ═══ FLUJOGRAMA ═══ */
function FlujogramaView({ocs,provs,sucursales=[],users,setDet}){
  const[vista,setVista]=useState("interactivo") // interactivo | estatico

  // Mapeo de estados a etapas del flujograma (columnas del proceso)
  const etapas=[
    {k:"alerta",l:"Alerta pre-quiebre",c:"#FF9500",ic:"🚨",area:"operaciones",desc:"Stock bajo detectado"},
    {k:"analisis",l:"Revisión stock",c:"#007AFF",ic:"📊",area:"negocios",desc:"Analizar cobertura y forecast"},
    {k:"oc_draft",l:"Generación OC",c:"#007AFF",ic:"📝",area:"negocios",desc:"Crear orden de compra"},
    {k:"neg",l:"Aprobación Negocios",c:"#007AFF",ic:"✓",area:"negocios",estados:["Pend. Dir. Negocios"]},
    {k:"fin",l:"Aprobación Finanzas",c:"#AF52DE",ic:"💰",area:"finanzas",estados:["Pend. Dir. Finanzas"]},
    {k:"prov",l:"Curse a proveedor",c:"#FF9500",ic:"🔄",area:"negocios",estados:["Pend. proveedor","Confirmada prov.","Proforma OK"]},
    {k:"ops",l:"Validación Operaciones",c:"#5AC8FA",ic:"📦",area:"operaciones",desc:"Aprobación de espacio/almacenaje"},
    {k:"transito",l:"En tránsito",c:"#AF52DE",ic:"🚢",area:"negocios",estados:["Pago fabricación","En fabricación","Pago embarque","Naviera","Aduana","Pago puerto","Internación","Transporte","Despacho nac.","Pago pend."]},
    {k:"recep",l:"Recepción",c:"#FF9500",ic:"📥",area:"operaciones",estados:["Recibida parcial","Recibida OK"]},
    {k:"cierre",l:"Cierre y DTE",c:"#34C759",ic:"📋",area:"finanzas",estados:["Cerrada"]}
  ]

  // Clasificar OCs por etapa
  const ocsPorEtapa={}
  etapas.forEach(e=>{
    ocsPorEtapa[e.k]=ocs.filter(o=>{
      if(!e.estados)return false
      return e.estados.includes(o.estado)&&o.estado!=="Rechazada"
    })
  })

  const areas={
    negocios:{l:"Área de Negocios",c:"#007AFF",bg:"#007AFF08"},
    finanzas:{l:"Departamento de Finanzas",c:"#AF52DE",bg:"#AF52DE08"},
    operaciones:{l:"Área de Operaciones",c:"#5AC8FA",bg:"#5AC8FA08"},
    ventas:{l:"Área de Ventas",c:"#34C759",bg:"#34C75908"}
  }

  return<div>
    {/* Header */}
    <div style={{background:"linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)",borderRadius:16,padding:"20px 24px",marginBottom:14,color:"#fff",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:-60,right:-60,width:200,height:200,borderRadius:"50%",background:"radial-gradient(circle,#5AC8FA30 0%,transparent 70%)",pointerEvents:"none"}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:14,position:"relative"}}>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.5)",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>Proceso de compras · SOP P07</div>
          <div style={{fontSize:24,fontWeight:800,letterSpacing:"-0.02em",lineHeight:1}}>Flujograma operativo</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",marginTop:6}}>{ocs.filter(o=>!["Cerrada","Rechazada"].includes(o.estado)).length} OCs activas en el proceso</div>
        </div>
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,0.08)",borderRadius:10,padding:3}}>
          <button onClick={()=>setVista("interactivo")} style={{padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:vista==="interactivo"?"#fff":"transparent",color:vista==="interactivo"?"#1C1C1E":"rgba(255,255,255,0.7)"}}>🎯 Interactivo</button>
          <button onClick={()=>setVista("estatico")} style={{padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:vista==="estatico"?"#fff":"transparent",color:vista==="estatico"?"#1C1C1E":"rgba(255,255,255,0.7)"}}>📖 Proceso</button>
        </div>
      </div>
    </div>

    {/* VISTA INTERACTIVA */}
    {vista==="interactivo"&&<div>
      <div style={{background:"#fff",borderRadius:14,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:700,color:"#1C1C1E",marginBottom:4}}>OCs posicionadas en el flujo</div>
        <div style={{fontSize:11,color:"#8E8E93",marginBottom:14}}>Click en una OC para abrir el detalle · Agrupadas por etapa del proceso</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8}}>
          {etapas.filter(e=>e.estados).map(e=>{
            const ocsEtapa=ocsPorEtapa[e.k]||[]
            const area=areas[e.area]
            return<div key={e.k} style={{background:"#fff",borderRadius:10,border:`1px solid ${e.c}25`,borderTop:`3px solid ${e.c}`,overflow:"hidden",minHeight:180}}>
              <div style={{padding:"10px 12px",background:e.c+"08",borderBottom:"1px solid "+e.c+"20"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                  <span style={{fontSize:14}}>{e.ic}</span>
                  <span style={{fontSize:11,fontWeight:700,color:e.c}}>{e.l}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:9,color:"#8E8E93",fontWeight:600,textTransform:"uppercase"}}>{area.l}</span>
                  <span style={{fontSize:18,fontWeight:800,color:e.c,letterSpacing:"-0.02em"}}>{ocsEtapa.length}</span>
                </div>
              </div>
              <div style={{padding:"8px",maxHeight:240,overflowY:"auto"}}>
                {ocsEtapa.length===0?
                  <div style={{textAlign:"center",padding:20,color:"#AEAEB2",fontSize:11}}>Sin OCs</div>
                :ocsEtapa.map(oc=>{
                  const pv=provs.find(p=>p.id===oc.proveedor_id)
                  const isI=oc.tipo_oc==="Importación"
                  const dias=diff(oc.fecha_creacion)*-1
                  return<div key={oc.id} onClick={()=>setDet&&setDet(oc)} style={{padding:"8px 10px",borderRadius:8,background:dias>14?"#FF3B3008":"#F8F8FA",border:`1px solid ${dias>14?"#FF3B3020":"#E5E5EA"}`,marginBottom:6,cursor:"pointer",transition:"all 0.2s"}}
                    onMouseEnter={e=>{e.currentTarget.style.transform="translateX(2px)";e.currentTarget.style.boxShadow="0 2px 6px rgba(0,0,0,0.06)"}}
                    onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow=""}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                      <span style={{fontSize:10,fontFamily:"monospace",fontWeight:700}}>{oc.id}</span>
                      <Bd c={isI?"#FF3B30":"#007AFF"} bg={isI?"#FF3B3015":"#007AFF15"}>{isI?"IMP":"NAC"}</Bd>
                    </div>
                    <div style={{fontSize:11,fontWeight:600,color:"#1C1C1E",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pv?.nombre||oc.proveedor_id}</div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
                      <span style={{fontSize:10,color:"#8E8E93"}}>{fmt(oc.total_clp)}</span>
                      <span style={{fontSize:10,fontWeight:600,color:dias>14?"#FF3B30":dias>7?"#FF9500":"#8E8E93"}}>{dias}d</span>
                    </div>
                  </div>
                })}
              </div>
            </div>
          })}
        </div>
      </div>

      {/* Leyenda de áreas */}
      <div style={{background:"#fff",borderRadius:14,padding:"14px 18px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#1C1C1E",marginBottom:10}}>📚 Áreas responsables</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:8}}>
          {Object.entries(areas).map(([k,a])=><div key={k} style={{padding:"8px 12px",borderRadius:8,background:a.bg,borderLeft:`3px solid ${a.c}`}}>
            <div style={{fontSize:11,fontWeight:700,color:a.c}}>{a.l}</div>
            <div style={{fontSize:10,color:"#8E8E93",marginTop:2}}>
              {k==="negocios"?"Dir. Negocios · Analista":k==="finanzas"?"Dir. Finanzas · Dir. General":k==="operaciones"?"Dir. Operaciones · Jefes Bodega":"Equipo de ventas"}
            </div>
          </div>)}
        </div>
      </div>
    </div>}

    {/* VISTA ESTÁTICA (Documentación del proceso) */}
    {vista==="estatico"&&<div>
      <div style={{background:"#fff",borderRadius:14,padding:"20px 24px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:700,color:"#1C1C1E",marginBottom:6}}>🔄 Proceso de compras — SOP P07</div>
        <div style={{fontSize:12,color:"#8E8E93",marginBottom:16}}>Flujograma completo del proceso de compras con responsables, SLAs y autorizaciones por etapa</div>

        {/* Carriles por área */}
        {Object.entries(areas).map(([ak,area])=>{
          const etapasArea=etapas.filter(e=>e.area===ak)
          if(etapasArea.length===0)return null
          return<div key={ak} style={{marginBottom:20,padding:"12px 16px",background:area.bg,borderRadius:12,borderLeft:`4px solid ${area.c}`}}>
            <div style={{fontSize:13,fontWeight:700,color:area.c,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.05em"}}>{area.l}</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {etapasArea.map((e,i)=><div key={e.k} style={{flex:"1 1 200px",minWidth:180,background:"#fff",borderRadius:10,padding:"12px 14px",border:`1px solid ${e.c}25`}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                  <span style={{fontSize:18}}>{e.ic}</span>
                  <span style={{fontSize:12,fontWeight:700,color:e.c}}>{e.l}</span>
                </div>
                <div style={{fontSize:11,color:"#636366",lineHeight:1.4}}>
                  {e.k==="alerta"&&"Detección automática de stock bajo · Alerta inmediata si hay movimientos fuera de rango"}
                  {e.k==="analisis"&&"Revisión cobertura ABCD · Forecast · Análisis de ventas · Presupuesto"}
                  {e.k==="oc_draft"&&"Generación de OC · Importación: 72h · Nacional: 24h"}
                  {e.k==="neg"&&"Firma Dir. Negocios · Valida proveedor y términos"}
                  {e.k==="fin"&&"Aprobación dentro de 24h · Si rechazo, se reenvía en 7 días"}
                  {e.k==="prov"&&"Envío formal al proveedor · Confirmación de proforma"}
                  {e.k==="ops"&&"Dir. Operaciones valida espacio en CD · Dentro de 24h · No dirime si acepta"}
                  {e.k==="transito"&&"Seguimiento de OC hasta llegada física · Pagos escalonados"}
                  {e.k==="recep"&&"Recepción parcial o total · Guías y facturas · CD o sucursal directa"}
                  {e.k==="cierre"&&"Registro DTE en planilla · Cierre formal de la OC"}
                </div>
                {e.estados&&ocsPorEtapa[e.k]&&<div style={{marginTop:8,padding:"4px 8px",background:e.c+"10",borderRadius:6,fontSize:10,fontWeight:700,color:e.c,display:"inline-block"}}>{ocsPorEtapa[e.k].length} OCs activas</div>}
              </div>)}
            </div>
          </div>
        })}
      </div>

      {/* Notas operativas */}
      <div style={{background:"#FFF8E7",borderRadius:12,padding:"14px 18px",border:"1px solid #FFE4A0"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#946200",marginBottom:8}}>📋 Notas operativas</div>
        <ul style={{margin:0,paddingLeft:20,fontSize:12,color:"#636366",lineHeight:1.7}}>
          <li><strong>Destino:</strong> por default todas las OCs llegan a CD Maipú. Excepcionalmente pueden ir directo a sucursal (LA o LG).</li>
          <li><strong>Operaciones:</strong> no dirime si acepta o no el pedido. Gestiona espacio y confirma almacenamiento.</li>
          <li><strong>Rechazo Finanzas:</strong> la OC se reenviará automáticamente al 7mo día para nueva evaluación.</li>
          <li><strong>Tiempos de revisión:</strong> primeros 15 días del mes para importación, últimos 15 días para nacional.</li>
          <li><strong>Alertas pre-quiebre:</strong> inmediatas en caso de movimientos fuera del rango normal (ventas superiores al promedio).</li>
        </ul>
      </div>
    </div>}
  </div>
}

/* ═══ CONFIG ═══ */
function ConfigView({config,saveConfig,params,setParams,paramsABCD,setParamsABCD,provs,setProvs,users,setUsers,sucursales=[],setSucursales,h,configTab,setConfigTab,loadAll,cu}){
  const isAdmin=cu?.rol==="admin"||cu?.rol==="dir_general"
  const allTabs=[{k:"params",l:"Reposición",ic:"📊",all:true},{k:"bsale",l:"BSALE",ic:"🔗",all:true},{k:"provs",l:"Proveedores",ic:"🏢",all:true},{k:"sucursales",l:"Sucursales",ic:"🏬",all:false},{k:"users",l:"Usuarios",ic:"👤",all:false},{k:"permisos",l:"Permisos",ic:"🔑",all:false},{k:"audit",l:"Auditoría",ic:"📜",all:false},{k:"email",l:"Email",ic:"📧",all:false}]
  const tabs=allTabs.filter(t=>t.all||isAdmin)

  const[bsaleToken,setBsaleToken]=useState(config.bsale_token||"")
  const[showProvForm,setShowProvForm]=useState(false)
  const[showUserForm,setShowUserForm]=useState(false)
  const[showSucForm,setShowSucForm]=useState(false)
  const[provForm,setProvForm]=useState({id:"",nombre:"",tipo:"Nacional",condicion_pago:"Contado",encargado:"",correo:"",activo:true,pct_fabricacion:0,pct_embarque:0,pct_puerto:0,factura_con_guia:false})
  const[userForm,setUserForm]=useState({id:"",nombre:"",correo:"",rol:"analista",firma_digital:"",activo:true,avatar:"",sucursal_id:null,permisos_custom:null})
  const[sucForm,setSucForm]=useState({id:"",codigo:"",nombre:"",direccion:"",comuna:"",region:"",es_cd:false,activo:true,orden:0})
  const[editing,setEditing]=useState(null)

  const saveBsale=async()=>{await saveConfig("bsale_token",bsaleToken);await saveConfig("bsale_activo",bsaleToken?"true":"false")}
  const saveProv=async()=>{const f={...provForm};if(editing){await supabase.from('proveedores').update(f).eq('id',editing);setProvs(p=>p.map(s=>s.id===editing?f:s))}else{f.id="PROV-"+Date.now().toString().slice(-4);await supabase.from('proveedores').insert(f);setProvs(p=>[...p,f])};setShowProvForm(false);setEditing(null)}
  const saveUser=async()=>{const f={...userForm,avatar:userForm.nombre.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()};if(editing){await supabase.from('usuarios').update(f).eq('id',editing);setUsers(p=>p.map(u=>u.id===editing?f:u))}else{f.id="USR-"+Date.now().toString().slice(-4);await supabase.from('usuarios').insert(f);setUsers(p=>[...p,f])};setShowUserForm(false);setEditing(null)}
  const saveSuc=async()=>{const f={...sucForm};if(editing){await supabase.from('sucursales').update(f).eq('id',editing);setSucursales(p=>p.map(s=>s.id===editing?f:s))}else{f.id="suc-"+Date.now().toString().slice(-6);await supabase.from('sucursales').insert(f);setSucursales(p=>[...p,f])};setShowSucForm(false);setEditing(null)}

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
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontSize:15,fontWeight:700}}>Proveedores ({provs.length})</div><Bt v="pri" sm onClick={()=>{setProvForm({id:"",nombre:"",tipo:"Nacional",condicion_pago:"Contado",encargado:"",correo:"",activo:true,pct_fabricacion:0,pct_embarque:0,pct_puerto:0,factura_con_guia:false});setEditing(null);setShowProvForm(true)}} ic="➕">Nuevo</Bt></div>
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
        <Fl l="Documentación del proveedor">
          <label style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"#F9FAFB",borderRadius:10,border:"1px solid #E5E5EA",cursor:"pointer"}}>
            <input type="checkbox" checked={provForm.factura_con_guia||false} onChange={e=>setProvForm({...provForm,factura_con_guia:e.target.checked})} style={{width:18,height:18,accentColor:"#007AFF"}}/>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:"#1C1C1E"}}>Emite guía + factura en documento combinado</div>
              <div style={{fontSize:11,color:"#8E8E93",marginTop:2}}>{provForm.factura_con_guia?"✓ Cada entrega incluye guía y factura en el mismo documento":"Guías y facturas se emiten por separado (la factura puede cubrir varias guías)"}</div>
            </div>
          </label>
        </Fl>
        <Bt v="pri" full dis={!provForm.nombre} onClick={saveProv} ic="💾">Guardar</Bt>
      </Sheet>
    </div>}

    {configTab==="sucursales"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div><div style={{fontSize:15,fontWeight:700}}>Sucursales ({sucursales.length})</div><div style={{fontSize:11,color:"#8E8E93"}}>Catálogo de puntos de venta y centros de distribución</div></div>
        <Bt v="pri" sm onClick={()=>{setSucForm({id:"",codigo:"",nombre:"",direccion:"",comuna:"",region:"",es_cd:false,activo:true,orden:sucursales.length});setEditing(null);setShowSucForm(true)}} ic="➕">Nueva</Bt>
      </div>
      {sucursales.map(s=><Cd key={s.id} s={{marginBottom:6,opacity:s.activo===false?0.5:1}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:44,height:44,borderRadius:10,background:s.es_cd?"#5AC8FA20":"#007AFF20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{s.es_cd?"🏭":"🏬"}</div>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:14,fontWeight:700}}>{s.nombre}</span>
                <Bd c={s.es_cd?"#5AC8FA":"#007AFF"} bg={s.es_cd?"#5AC8FA15":"#007AFF15"}>{s.codigo}</Bd>
                {s.es_cd&&<Bd c="#5AC8FA" bg="#5AC8FA15">Centro Distribución</Bd>}
              </div>
              <div style={{fontSize:11,color:"#8E8E93",marginTop:3}}>{[s.direccion,s.comuna,s.region].filter(Boolean).join(" · ")||"Sin dirección"}</div>
              <div style={{fontSize:10,color:"#AEAEB2",marginTop:2}}>{users.filter(u=>u.sucursal_id===s.id).length} usuarios asignados</div>
            </div>
          </div>
          <div style={{display:"flex",gap:4}}>
            <Bt sm v="gry" onClick={()=>{setSucForm({...s});setEditing(s.id);setShowSucForm(true)}}>✏️</Bt>
            <Bt sm v="gry" onClick={async()=>{await supabase.from('sucursales').update({activo:!s.activo}).eq('id',s.id);setSucursales(p=>p.map(x=>x.id===s.id?{...x,activo:!x.activo}:x))}}>{s.activo===false?"✅":"🚫"}</Bt>
          </div>
        </div>
      </Cd>)}

      <Sheet show={showSucForm} onClose={()=>setShowSucForm(false)} title={editing?"Editar sucursal":"Nueva sucursal"}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Fl l="Código" req><input value={sucForm.codigo} onChange={e=>setSucForm({...sucForm,codigo:e.target.value.toUpperCase()})} maxLength={6} placeholder="LA, MP, LG..." style={css.input}/></Fl>
          <Fl l="Nombre" req><input value={sucForm.nombre} onChange={e=>setSucForm({...sucForm,nombre:e.target.value})} placeholder="Los Ángeles" style={css.input}/></Fl>
        </div>
        <Fl l="Dirección"><input value={sucForm.direccion||""} onChange={e=>setSucForm({...sucForm,direccion:e.target.value})} style={css.input}/></Fl>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Fl l="Comuna"><input value={sucForm.comuna||""} onChange={e=>setSucForm({...sucForm,comuna:e.target.value})} style={css.input}/></Fl>
          <Fl l="Región"><input value={sucForm.region||""} onChange={e=>setSucForm({...sucForm,region:e.target.value})} style={css.input}/></Fl>
        </div>
        <Fl l="Tipo">
          <label style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"#F9FAFB",borderRadius:10,border:"1px solid #E5E5EA",cursor:"pointer"}}>
            <input type="checkbox" checked={sucForm.es_cd||false} onChange={e=>setSucForm({...sucForm,es_cd:e.target.checked})} style={{width:18,height:18,accentColor:"#5AC8FA"}}/>
            <div><div style={{fontSize:13,fontWeight:600}}>Centro de Distribución</div><div style={{fontSize:11,color:"#8E8E93"}}>Destino por default para OCs · recibe y redistribuye</div></div>
          </label>
        </Fl>
        <Bt v="pri" full dis={!sucForm.nombre||!sucForm.codigo} onClick={saveSuc} ic="💾">Guardar</Bt>
      </Sheet>
    </div>}

    {configTab==="users"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div><div style={{fontSize:15,fontWeight:700}}>Usuarios ({users.length})</div><div style={{fontSize:11,color:"#8E8E93"}}>Creá usuarios, asigná sucursal y personalizá permisos</div></div><Bt v="pri" sm onClick={()=>{setUserForm({id:"",nombre:"",correo:"",rol:"analista",firma_digital:"",activo:true,avatar:"",sucursal_id:null,permisos_custom:null});setEditing(null);setShowUserForm(true)}} ic="➕">Nuevo</Bt></div>
      {users.map(u=>{
        const r=rl(u)
        const suc=sucursales.find(s=>s.id===u.sucursal_id)
        const tieneCustom=u.permisos_custom&&Array.isArray(u.permisos_custom)
        return<Cd key={u.id} s={{marginBottom:6,opacity:u.activo?1:0.5}}>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <Av n={u.avatar} c={r.c} sz={42}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:14,fontWeight:600}}>{u.nombre}</span>
                <Bd c={r.c} bg={r.c+"20"} lg>{r.l}</Bd>
                {suc&&<Bd c={suc.es_cd?"#5AC8FA":"#007AFF"} bg={suc.es_cd?"#5AC8FA15":"#007AFF15"}>🏬 {suc.nombre}</Bd>}
                {tieneCustom&&<Bd c="#FF9500" bg="#FF950015">🔑 Permisos custom</Bd>}
              </div>
              <div style={{fontSize:11,color:"#8E8E93",marginTop:3}}>{u.correo}</div>
              <div style={{background:"#F2F2F7",borderRadius:6,padding:"4px 8px",marginTop:4,display:"inline-block"}}><span style={{fontSize:12,fontStyle:"italic",fontWeight:600,color:r.c}}>{u.firma_digital||u.nombre}</span></div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              <Bt sm v="gry" onClick={()=>{setUserForm({...u,permisos_custom:u.permisos_custom||null});setEditing(u.id);setShowUserForm(true)}}>✏️</Bt>
              <Bt sm v="gry" onClick={async()=>{await supabase.from('usuarios').update({activo:!u.activo}).eq('id',u.id);setUsers(p=>p.map(x=>x.id===u.id?{...x,activo:!x.activo}:x))}}>{u.activo?"🚫":"✅"}</Bt>
            </div>
          </div>
        </Cd>
      })}

      <Sheet show={showUserForm} onClose={()=>setShowUserForm(false)} title={editing?"Editar usuario":"Nuevo usuario"}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Fl l="Nombre" req><input value={userForm.nombre} onChange={e=>setUserForm({...userForm,nombre:e.target.value})} style={css.input}/></Fl>
          <Fl l="Correo" req><input value={userForm.correo} onChange={e=>setUserForm({...userForm,correo:e.target.value})} style={css.input}/></Fl>
          <Fl l="Rol">
            <select value={userForm.rol} onChange={e=>setUserForm({...userForm,rol:e.target.value})} style={css.select}>
              {ROLES.map(r=><option key={r.k} value={r.k}>{r.l}</option>)}
            </select>
          </Fl>
          <Fl l="Sucursal asignada">
            <select value={userForm.sucursal_id||""} onChange={e=>setUserForm({...userForm,sucursal_id:e.target.value||null})} style={css.select}>
              <option value="">— Sin asignar —</option>
              {sucursales.filter(s=>s.activo!==false).map(s=><option key={s.id} value={s.id}>{s.nombre}{s.es_cd?" (CD)":""}</option>)}
            </select>
          </Fl>
          <Fl l="Firma digital"><input value={userForm.firma_digital||""} onChange={e=>setUserForm({...userForm,firma_digital:e.target.value})} style={{...css.input,fontStyle:"italic"}}/></Fl>
        </div>

        {/* Permisos granulares */}
        {(()=>{const rolObj=ROLES.find(r=>r.k===userForm.rol);const permisosRol=rolObj?.p||[];const usaCustom=userForm.permisos_custom&&Array.isArray(userForm.permisos_custom);const permisosActivos=usaCustom?userForm.permisos_custom:permisosRol
          return<Fl l="Permisos del usuario">
            <div style={{background:"#F9FAFB",borderRadius:10,padding:"12px 14px",border:"1px solid #E5E5EA"}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:10,paddingBottom:10,borderBottom:"1px solid #E5E5EA"}}>
                <input type="checkbox" checked={usaCustom} onChange={e=>{
                  if(e.target.checked)setUserForm({...userForm,permisos_custom:[...permisosRol]})
                  else setUserForm({...userForm,permisos_custom:null})
                }} style={{width:16,height:16,accentColor:"#FF9500"}}/>
                <div><div style={{fontSize:12,fontWeight:600}}>Permisos personalizados</div><div style={{fontSize:10,color:"#8E8E93"}}>{usaCustom?"Los cambios sobrescriben el rol default":`Usa los ${permisosRol.length} permisos del rol ${rolObj?.l}`}</div></div>
              </label>
              {userForm.rol==="admin"&&<div style={{padding:10,background:"#FF3B3008",borderRadius:8,fontSize:11,color:"#FF3B30",fontWeight:600,textAlign:"center"}}>🔓 Admin tiene acceso total, no se pueden restringir permisos</div>}
              {userForm.rol!=="admin"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,maxHeight:280,overflowY:"auto"}}>
                {PERMISOS.map(perm=>{
                  const activo=permisosActivos.includes(perm.k)
                  const enRol=permisosRol.includes(perm.k)
                  const diverge=usaCustom&&(activo!==enRol)
                  return<label key={perm.k} style={{display:"flex",alignItems:"flex-start",gap:6,padding:"6px 8px",borderRadius:6,background:diverge?"#FF950012":activo?"#34C75908":"#F2F2F7",cursor:usaCustom?"pointer":"not-allowed",border:diverge?"1px solid #FF950040":"1px solid transparent",opacity:usaCustom?1:0.65}}>
                    <input type="checkbox" checked={activo} disabled={!usaCustom} onChange={e=>{
                      if(!usaCustom)return
                      const nuevos=e.target.checked?[...userForm.permisos_custom,perm.k]:userForm.permisos_custom.filter(x=>x!==perm.k)
                      setUserForm({...userForm,permisos_custom:nuevos})
                    }} style={{marginTop:2,accentColor:"#34C759"}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:11,fontWeight:600,color:activo?"#1C1C1E":"#8E8E93"}}>{perm.l}{diverge&&<span style={{color:"#FF9500",fontSize:9,marginLeft:4}}>●</span>}</div>
                      <div style={{fontSize:9,color:"#8E8E93",lineHeight:1.3}}>{perm.d}</div>
                    </div>
                  </label>
                })}
              </div>}
            </div>
          </Fl>
        })()}

        <Bt v="pri" full dis={!userForm.nombre||!userForm.correo} onClick={saveUser} ic="💾">Guardar</Bt>
      </Sheet>
    </div>}

    {/* PERMISOS TAB */}
    {configTab==="permisos"&&<div>
      <Cd><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>🔑 Matriz de permisos por rol</div>
        <div style={{fontSize:12,color:"#8E8E93",marginBottom:12}}>Permisos default por rol · Pueden sobrescribirse individualmente desde Usuarios</div>
        <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:900}}>
          <thead><tr style={{background:"#F2F2F7"}}>
            <th style={{padding:"8px",textAlign:"left",fontSize:10,fontWeight:700,color:"#8E8E93",borderBottom:"2px solid #E5E5EA",position:"sticky",left:0,background:"#F2F2F7"}}>Rol</th>
            {PERMISOS.map(p=><th key={p.k} style={{padding:"8px 4px",textAlign:"center",fontSize:9,fontWeight:600,color:"#8E8E93",borderBottom:"2px solid #E5E5EA",whiteSpace:"nowrap"}} title={p.d}>{p.l}</th>)}
          </tr></thead>
          <tbody>{ROLES.map(r=><tr key={r.k} style={{borderBottom:"1px solid #F2F2F7"}}>
            <td style={{padding:"8px",position:"sticky",left:0,background:"#fff"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:5,background:r.c}}/><strong>{r.l}</strong></div></td>
            {PERMISOS.map(p=><td key={p.k} style={{padding:"8px 4px",textAlign:"center"}}>{r.p.includes("todo")||r.p.includes(p.k)?<span style={{color:"#34C759",fontSize:14}}>✓</span>:<span style={{color:"#D1D1D6",fontSize:14}}>—</span>}</td>)}
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

    {configTab==="audit"&&<AuditView cu={cu} loadAll={loadAll}/>}
    {configTab==="email"&&<EmailLauncherView cu={cu} config={config} saveConfig={saveConfig}/>}
  </div>
}

/* ═══ AUDIT VIEW ═══ */
function AuditView({cu,loadAll}){
  const[logs,setLogs]=useState([])
  const[loading,setLoading]=useState(false)
  const[filtroOp,setFiltroOp]=useState("T") // T | INSERT | UPDATE | DELETE
  const[filtroTabla,setFiltroTabla]=useState("T")
  const[q,setQ]=useState("")
  const[limit,setLimit]=useState(100)
  const[expanded,setExpanded]=useState(null)
  const[restoring,setRestoring]=useState(null)

  const cargar=async()=>{
    setLoading(true)
    const{data,error}=await supabase.from('audit_log').select('*').order('created_at',{ascending:false}).limit(limit)
    if(error){console.error("Error cargando audit_log:",error);alert("Error: "+error.message);setLoading(false);return}
    setLogs(data||[])
    setLoading(false)
  }
  useEffect(()=>{cargar()},[limit])

  // Filtros
  const tablasUnicas=[...new Set(logs.map(l=>l.tabla).filter(Boolean))].sort()
  const fil=logs.filter(l=>(filtroOp==="T"||l.operacion===filtroOp)&&(filtroTabla==="T"||l.tabla===filtroTabla)&&(!q||(l.usuario_nombre||"").toLowerCase().includes(q.toLowerCase())||(l.oc_id||"").toLowerCase().includes(q.toLowerCase())||(l.registro_id||"").toLowerCase().includes(q.toLowerCase())))

  // OCs eliminadas candidatas a restaurar
  const ocsEliminadas=logs.filter(l=>l.tabla==="ordenes_compra"&&l.operacion==="DELETE")

  const opColor=op=>op==="DELETE"?"#FF3B30":op==="UPDATE"?"#FF9500":op==="INSERT"?"#34C759":"#8E8E93"
  const opIcon=op=>op==="DELETE"?"🗑":op==="UPDATE"?"✏️":op==="INSERT"?"➕":"•"

  const restaurarOC=async(log)=>{
    const datos=log.cambios
    if(!datos||typeof datos!=="object"){alert("⚠ Este registro no tiene snapshot de datos. No se puede restaurar.");return}
    const ocSnapshot=datos.before||datos.old||datos.data||datos
    if(!ocSnapshot.id){alert("⚠ El snapshot no contiene un ID de OC válido.");return}

    // Verificar que no exista ya
    const{data:existe}=await supabase.from('ordenes_compra').select('id').eq('id',ocSnapshot.id).maybeSingle()
    if(existe){alert(`⚠ Ya existe una OC con ID ${ocSnapshot.id}. No se puede restaurar sin conflicto.`);return}

    if(!window.confirm(`¿Restaurar la OC ${ocSnapshot.id}?\n\nSe recreará con los datos del momento en que fue eliminada.\nLos items y pagos asociados NO se restauran automáticamente (solo la OC cabecera).\n\n¿Continuar?`))return

    setRestoring(log.id)
    try{
      // Limpiar campos que no deben reinsertarse o que pueden causar conflictos
      const toInsert={...ocSnapshot}
      delete toInsert.created_at // dejar que se regenere
      const{error}=await supabase.from('ordenes_compra').insert(toInsert)
      if(error){alert("Error al restaurar: "+error.message);setRestoring(null);return}

      // Registrar en firmas
      await supabase.from('firmas').insert({
        id:uid(),oc_id:ocSnapshot.id,usuario_id:cu.id,nombre_usuario:cu.nombre,
        rol_usuario:cu.rol,accion:`OC restaurada desde audit log por ${cu.nombre}`,
        firma_digital:cu.firma_digital,fecha:hoy(),hora:hora()
      })

      // Registrar en audit
      await supabase.from('audit_log').insert({
        tabla:"ordenes_compra",operacion:"RESTORE",registro_id:ocSnapshot.id,
        oc_id:ocSnapshot.id,usuario_id:cu.id,usuario_nombre:cu.nombre,
        cambios:{restored_from:log.id,data:toInsert}
      })

      alert(`✓ OC ${ocSnapshot.id} restaurada correctamente.\n\nRevisá el detalle en Órdenes. Si necesitás restaurar items o pagos, hay que hacerlo manualmente.`)
      loadAll()
      cargar()
    }catch(e){alert("Error inesperado: "+e.message)}
    setRestoring(null)
  }

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontSize:15,fontWeight:700}}>📜 Auditoría del sistema</div>
        <div style={{fontSize:11,color:"#8E8E93"}}>Registro de todas las acciones · {logs.length} eventos recientes</div>
      </div>
      <div style={{display:"flex",gap:6}}>
        <Bt sm v="gry" onClick={cargar} ic={loading?"⏳":"🔄"} dis={loading}>{loading?"Cargando...":"Refrescar"}</Bt>
      </div>
    </div>

    {/* Card destacada: OCs eliminadas restaurables */}
    {ocsEliminadas.length>0&&<Cd ac="#FF9500" s={{marginBottom:14,background:"#FF950008"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:700,color:"#FF9500",marginBottom:4}}>🗑 OCs eliminadas ({ocsEliminadas.length})</div>
          <div style={{fontSize:11,color:"#636366",marginBottom:10}}>Órdenes borradas que se pueden restaurar con sus datos originales. Los items y pagos NO se restauran automáticamente.</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {ocsEliminadas.slice(0,5).map(log=>{
              const snap=log.cambios?.before||log.cambios?.old||log.cambios?.data||log.cambios||{}
              const ocId=snap.id||log.registro_id||log.oc_id||"—"
              return<div key={log.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:"#fff",borderRadius:8,border:"1px solid #FF950030"}}>
                <div>
                  <span style={{fontSize:12,fontWeight:700,fontFamily:"monospace"}}>{ocId}</span>
                  {snap.proveedor_id&&<span style={{fontSize:11,color:"#8E8E93",marginLeft:8}}>· {snap.proveedor_id}</span>}
                  {snap.total_clp&&<span style={{fontSize:11,color:"#8E8E93",marginLeft:8}}>· {fmt(snap.total_clp)}</span>}
                  <div style={{fontSize:10,color:"#AEAEB2",marginTop:2}}>Eliminada por {log.usuario_nombre||"?"} · {new Date(log.created_at).toLocaleString("es-CL")}</div>
                </div>
                <Bt sm v="pri" onClick={()=>restaurarOC(log)} dis={restoring===log.id} ic={restoring===log.id?"⏳":"↩"}>{restoring===log.id?"Restaurando":"Restaurar"}</Bt>
              </div>
            })}
            {ocsEliminadas.length>5&&<div style={{fontSize:11,color:"#8E8E93",textAlign:"center",padding:4}}>+ {ocsEliminadas.length-5} más en el registro completo abajo</div>}
          </div>
        </div>
      </div>
    </Cd>}

    {/* Filtros */}
    <div style={{background:"#fff",borderRadius:10,padding:"10px 12px",marginBottom:10,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
      <input placeholder="Buscar usuario, OC o ID..." value={q} onChange={e=>setQ(e.target.value)} style={{...css.input,flex:"1 1 180px",fontSize:12,padding:"6px 10px"}}/>
      <select value={filtroOp} onChange={e=>setFiltroOp(e.target.value)} style={{...css.select,width:130,fontSize:12}}>
        <option value="T">Todas las ops</option>
        <option value="INSERT">➕ INSERT</option>
        <option value="UPDATE">✏️ UPDATE</option>
        <option value="DELETE">🗑 DELETE</option>
        <option value="RESTORE">↩ RESTORE</option>
      </select>
      <select value={filtroTabla} onChange={e=>setFiltroTabla(e.target.value)} style={{...css.select,width:170,fontSize:12}}>
        <option value="T">Todas las tablas</option>
        {tablasUnicas.map(t=><option key={t} value={t}>{t}</option>)}
      </select>
      <select value={limit} onChange={e=>setLimit(Number(e.target.value))} style={{...css.select,width:110,fontSize:12}}>
        <option value={50}>Últimos 50</option>
        <option value={100}>Últimos 100</option>
        <option value={250}>Últimos 250</option>
        <option value={500}>Últimos 500</option>
      </select>
    </div>

    {/* Tabla de logs */}
    <div style={{background:"#fff",borderRadius:10,overflow:"hidden",border:"1px solid #E5E5EA"}}>
      {fil.length===0?<div style={{padding:40,textAlign:"center",color:"#8E8E93"}}>{loading?"Cargando...":"Sin registros que coincidan"}</div>:
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:700}}>
            <thead><tr style={{background:"#F8F8FA"}}>
              {["Fecha","Operación","Tabla","Registro","OC","Usuario",""].map((h,i)=><th key={i} style={{padding:"8px 10px",textAlign:i===6?"right":"left",fontSize:9,fontWeight:700,color:"#636366",borderBottom:"2px solid #E5E5EA",whiteSpace:"nowrap"}}>{h}</th>)}
            </tr></thead>
            {fil.map(l=>{
              const isExp=expanded===l.id
              return<tbody key={l.id}>
                <tr style={{borderBottom:"1px solid #F2F2F7",cursor:"pointer"}} onClick={()=>setExpanded(isExp?null:l.id)}>
                  <td style={{padding:"6px 10px",color:"#636366",fontFamily:"monospace",fontSize:10,whiteSpace:"nowrap"}}>{new Date(l.created_at).toLocaleString("es-CL",{year:"2-digit",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</td>
                  <td style={{padding:"6px 10px"}}><span style={{fontSize:10,fontWeight:700,color:opColor(l.operacion),background:opColor(l.operacion)+"15",padding:"2px 7px",borderRadius:4}}>{opIcon(l.operacion)} {l.operacion}</span></td>
                  <td style={{padding:"6px 10px",fontFamily:"monospace",fontSize:10,color:"#8E8E93"}}>{l.tabla}</td>
                  <td style={{padding:"6px 10px",fontFamily:"monospace",fontSize:10,fontWeight:600}}>{l.registro_id||"—"}</td>
                  <td style={{padding:"6px 10px",fontFamily:"monospace",fontSize:10,fontWeight:600,color:"#007AFF"}}>{l.oc_id||"—"}</td>
                  <td style={{padding:"6px 10px"}}><div style={{fontSize:11,fontWeight:600}}>{l.usuario_nombre||"—"}</div></td>
                  <td style={{padding:"6px 10px",textAlign:"right",color:"#8E8E93"}}>{isExp?"▲":"▼"}</td>
                </tr>
                {isExp&&<tr><td colSpan={7} style={{padding:"0 10px 10px",background:"#F8F8FA"}}>
                  <div style={{background:"#fff",borderRadius:8,padding:"10px 12px",border:"1px solid #E5E5EA"}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#636366",marginBottom:6,textTransform:"uppercase"}}>Cambios registrados</div>
                    <pre style={{margin:0,fontSize:10,fontFamily:"monospace",color:"#1C1C1E",whiteSpace:"pre-wrap",wordBreak:"break-all",maxHeight:300,overflowY:"auto"}}>{JSON.stringify(l.cambios,null,2)||"—"}</pre>
                    {l.ip&&<div style={{fontSize:10,color:"#AEAEB2",marginTop:6}}>IP: {l.ip}</div>}
                    {l.tabla==="ordenes_compra"&&l.operacion==="DELETE"&&<div style={{marginTop:10}}>
                      <Bt sm v="pri" onClick={()=>restaurarOC(l)} dis={restoring===l.id} ic="↩">Restaurar esta OC</Bt>
                    </div>}
                  </div>
                </td></tr>}
              </tbody>
            })}
          </table>
        </div>
      }
    </div>
  </div>
}

/* ═══ EMAIL LAUNCHER VIEW ═══ */
function EmailLauncherView({cu,config,saveConfig}){
  const[notifs,setNotifs]=useState([])
  const[loading,setLoading]=useState(false)
  const[filtroEstado,setFiltroEstado]=useState("T")
  const[q,setQ]=useState("")
  const[emailActivo,setEmailActivo]=useState(config.email_activo==="true")
  const[emailRemitente,setEmailRemitente]=useState(config.email_remitente||"")
  const[emailFirma,setEmailFirma]=useState(config.email_firma||"")

  const cargar=async()=>{
    setLoading(true)
    const{data,error}=await supabase.from('notificaciones').select('*').order('created_at',{ascending:false}).limit(200)
    if(error){console.error("Error notificaciones:",error);setLoading(false);return}
    setNotifs(data||[])
    setLoading(false)
  }
  useEffect(()=>{cargar()},[])

  const fil=notifs.filter(n=>(filtroEstado==="T"||n.estado===filtroEstado)&&(!q||(n.destino_correo||"").toLowerCase().includes(q.toLowerCase())||(n.asunto||"").toLowerCase().includes(q.toLowerCase())||(n.oc_id||"").toLowerCase().includes(q.toLowerCase())))

  const estados=[...new Set(notifs.map(n=>n.estado).filter(Boolean))]
  const resumen={
    total:notifs.length,
    enviados:notifs.filter(n=>n.estado==="Enviado"||n.estado==="enviado").length,
    pendientes:notifs.filter(n=>n.estado==="Pendiente"||n.estado==="pendiente").length,
    errores:notifs.filter(n=>n.estado==="Error"||n.estado==="error"||n.estado==="Fallo").length
  }

  const estColor=e=>{
    const s=(e||"").toLowerCase()
    if(s==="enviado")return{c:"#34C759",bg:"#34C75915",ic:"✓"}
    if(s==="pendiente")return{c:"#FF9500",bg:"#FF950015",ic:"⏳"}
    if(s==="error"||s==="fallo")return{c:"#FF3B30",bg:"#FF3B3015",ic:"✕"}
    return{c:"#8E8E93",bg:"#F2F2F7",ic:"•"}
  }

  const guardarConfigEmail=async()=>{
    await saveConfig("email_activo",emailActivo?"true":"false")
    await saveConfig("email_remitente",emailRemitente)
    await saveConfig("email_firma",emailFirma)
    alert("✓ Configuración de email guardada")
  }

  const reintentar=async(n)=>{
    if(!window.confirm(`¿Reintentar envío del email a ${n.destino_correo}?\n\nAsunto: ${n.asunto}`))return
    await supabase.from('notificaciones').update({estado:"Pendiente",fecha_envio:null}).eq('id',n.id)
    alert("✓ Marcado como pendiente. El sistema reintentará en el próximo envío programado.")
    cargar()
  }

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontSize:15,fontWeight:700}}>📧 Email launcher</div>
        <div style={{fontSize:11,color:"#8E8E93"}}>Configuración y registro de envíos automáticos del sistema</div>
      </div>
      <Bt sm v="gry" onClick={cargar} ic={loading?"⏳":"🔄"} dis={loading}>{loading?"Cargando...":"Refrescar"}</Bt>
    </div>

    {/* Configuración general */}
    <Cd s={{marginBottom:14}}>
      <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>⚙️ Configuración general</div>
      <Fl l="Sistema de envío">
        <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#F9FAFB",borderRadius:10,border:"1px solid #E5E5EA",cursor:"pointer"}}>
          <input type="checkbox" checked={emailActivo} onChange={e=>setEmailActivo(e.target.checked)} style={{width:18,height:18,accentColor:"#34C759"}}/>
          <div>
            <div style={{fontSize:13,fontWeight:600}}>{emailActivo?"✓ Envío de emails activado":"✕ Envío de emails desactivado"}</div>
            <div style={{fontSize:11,color:"#8E8E93"}}>{emailActivo?"El sistema enviará notificaciones automáticamente a los destinatarios configurados":"Los eventos se registran pero no se envían emails"}</div>
          </div>
        </label>
      </Fl>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Fl l="Email remitente (from)">
          <input value={emailRemitente} onChange={e=>setEmailRemitente(e.target.value)} placeholder="compras@outletdepuertas.cl" style={css.input}/>
        </Fl>
        <Fl l="Firma al pie del email">
          <input value={emailFirma} onChange={e=>setEmailFirma(e.target.value)} placeholder="Outlet de Puertas SpA" style={css.input}/>
        </Fl>
      </div>
      <Bt v="pri" sm onClick={guardarConfigEmail} ic="💾">Guardar configuración</Bt>
    </Cd>

    {/* Resumen */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
      {[["Total",resumen.total,"#007AFF","📧"],["Enviados",resumen.enviados,"#34C759","✓"],["Pendientes",resumen.pendientes,"#FF9500","⏳"],["Errores",resumen.errores,"#FF3B30","✕"]].map(([l,n,c,i])=><div key={l} style={{background:"#fff",borderRadius:10,padding:"10px 14px",border:"1px solid #E5E5EA",textAlign:"center"}}>
        <div style={{fontSize:18,fontWeight:800,color:c}}>{i} {n}</div>
        <div style={{fontSize:10,color:"#8E8E93",fontWeight:600,marginTop:2,textTransform:"uppercase"}}>{l}</div>
      </div>)}
    </div>

    {/* Filtros */}
    <div style={{background:"#fff",borderRadius:10,padding:"10px 12px",marginBottom:10,display:"flex",gap:8,flexWrap:"wrap"}}>
      <input placeholder="Buscar destinatario, asunto, OC..." value={q} onChange={e=>setQ(e.target.value)} style={{...css.input,flex:"1 1 200px",fontSize:12,padding:"6px 10px"}}/>
      <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{...css.select,width:140,fontSize:12}}>
        <option value="T">Todos los estados</option>
        {estados.map(e=><option key={e} value={e}>{e}</option>)}
      </select>
    </div>

    {/* Lista */}
    <div style={{background:"#fff",borderRadius:10,overflow:"hidden",border:"1px solid #E5E5EA"}}>
      {fil.length===0?<div style={{padding:40,textAlign:"center",color:"#8E8E93"}}>{loading?"Cargando...":"Sin registros"}</div>:
        fil.map(n=>{
          const c=estColor(n.estado)
          return<div key={n.id} style={{padding:"10px 14px",borderBottom:"1px solid #F2F2F7",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:200}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                <span style={{fontSize:11,fontWeight:700,color:c.c,background:c.bg,padding:"2px 7px",borderRadius:4}}>{c.ic} {n.estado||"—"}</span>
                {n.tipo&&<span style={{fontSize:10,color:"#8E8E93",fontWeight:600,background:"#F2F2F7",padding:"2px 6px",borderRadius:4}}>{n.tipo}</span>}
                {n.oc_id&&<span style={{fontSize:10,fontFamily:"monospace",color:"#007AFF",fontWeight:600}}>{n.oc_id}</span>}
              </div>
              <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{n.asunto||"(sin asunto)"}</div>
              <div style={{fontSize:11,color:"#8E8E93"}}>
                {n.destino_nombre?`${n.destino_nombre} · `:""}<span style={{fontFamily:"monospace"}}>{n.destino_correo||"—"}</span>
              </div>
              {n.mensaje&&<div style={{fontSize:11,color:"#636366",marginTop:4,maxHeight:60,overflow:"hidden",textOverflow:"ellipsis"}}>{n.mensaje.length>200?n.mensaje.slice(0,200)+"...":n.mensaje}</div>}
              <div style={{fontSize:10,color:"#AEAEB2",marginTop:4}}>
                {n.fecha_envio?`Enviado: ${n.fecha_envio}`:"Sin envío"}
                {n.created_at&&` · Registrado: ${new Date(n.created_at).toLocaleString("es-CL")}`}
              </div>
            </div>
            {(n.estado==="Error"||n.estado==="error"||n.estado==="Fallo"||n.estado==="Pendiente"||n.estado==="pendiente")&&<Bt sm v="gry" onClick={()=>reintentar(n)} ic="🔄">Reintentar</Bt>}
          </div>
        })
      }
    </div>
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
