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
const STS={"Pend. Dir. Negocios":{c:"#007AFF",bg:"#007AFF15",ic:"⏳"},"Proyectar costeo":{c:"#5856D6",bg:"#5856D615",ic:"🧮"},"Pend. Dir. Finanzas":{c:"#AF52DE",bg:"#AF52DE15",ic:"⏳"},"Pend. proveedor":{c:"#FF9500",bg:"#FF950015",ic:"🔄"},"Proforma OK":{c:"#34C759",bg:"#34C75915",ic:"✓"},"Pago fabricación":{c:"#FF9500",bg:"#FF950015",ic:"💰"},"Pago embarque":{c:"#FF9500",bg:"#FF950015",ic:"💰"},"Internación":{c:"#FF3B30",bg:"#FF3B3015",ic:"📋"},"Validar costeo final":{c:"#5856D6",bg:"#5856D615",ic:"🎯"},"Transporte":{c:"#AF52DE",bg:"#AF52DE15",ic:"🚛"},"Confirmada prov.":{c:"#34C759",bg:"#34C75915",ic:"✓"},"Despacho nac.":{c:"#AF52DE",bg:"#AF52DE15",ic:"🚚"},"Recibida parcial":{c:"#FF9500",bg:"#FF950015",ic:"◐"},"Recibida OK":{c:"#34C759",bg:"#34C75915",ic:"✓"},"Cerrada":{c:"#8E8E93",bg:"#8E8E9315",ic:"■"},"Rechazada":{c:"#FF3B30",bg:"#FF3B3015",ic:"✕"},"Pago pend.":{c:"#FF9500",bg:"#FF950015",ic:"$"}}
const FN=[{n:"Solicitud"},{n:"Negocios"},{n:"Finanzas"},{n:"Proveedor"},{n:"Despacho"},{n:"Recepción"},{n:"Cierre"}]
const FI=[{n:"Solicitud"},{n:"Negocios"},{n:"Proy. Costeo"},{n:"Finanzas"},{n:"Proforma"},{n:"Pago fab."},{n:"Pago emb."},{n:"Internación"},{n:"Costeo final"},{n:"Transporte"},{n:"Recepción"},{n:"Cierre"}]
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

// ⭐ v48: Hook para persistir estado en localStorage (filtros, preferencias por módulo)
// Uso: const [f,setF] = useLocalState("repo_filtro_abcd", "Todas")
const useLocalState=(key,initial)=>{
  const[val,setVal]=useState(()=>{
    try{const s=localStorage.getItem("erp_"+key);return s!==null?JSON.parse(s):initial}catch(e){return initial}
  })
  useEffect(()=>{try{localStorage.setItem("erp_"+key,JSON.stringify(val))}catch(e){}},[key,val])
  return[val,setVal]
}

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
const TABS=[{k:"monitor",l:"Monitor",ic:"📊"},{k:"repo",l:"Reposición",ic:"📦"},{k:"forecast",l:"Forecast",ic:"📈"},{k:"cobertura",l:"Cobertura",ic:"📅"},{k:"llegadas",l:"Llegadas",ic:"📆"},{k:"costeo",l:"Costeo IMP",ic:"🧮"},{k:"transito",l:"Tránsito",ic:"🚚"},{k:"finanzas",l:"Finanzas",ic:"💰"},{k:"nueva",l:"Nueva OC",ic:"➕"},{k:"ordenes",l:"Órdenes",ic:"📋"},{k:"config",l:"Config",ic:"⚙️"}]

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
  const[cart,setCart]=useState(()=>{try{const s=localStorage.getItem("erp_cart");return s?JSON.parse(s):{}}catch(e){return{}}})
  const[tab,setTab]=useState(()=>{try{return localStorage.getItem("erp_tab")||"monitor"}catch(e){return"monitor"}})
  const[det,setDet]=useState(null)
  const[loading,setLoading]=useState(true)
  const[configTab,setConfigTab]=useState(()=>{try{return localStorage.getItem("erp_configTab")||"params"}catch(e){return"params"}})

  // ⭐ v48: Persistencia automática en localStorage
  useEffect(()=>{try{localStorage.setItem("erp_tab",tab)}catch(e){}},[tab])
  useEffect(()=>{try{localStorage.setItem("erp_configTab",configTab)}catch(e){}},[configTab])
  useEffect(()=>{try{localStorage.setItem("erp_cart",JSON.stringify(cart))}catch(e){}},[cart])

  useEffect(()=>{loadAll()},[])

  // ⭐ v48: Persistencia de sesión — restaura el usuario al recargar (F5)
  // 1) Intenta con Supabase Auth (si el usuario se logueó con supabase.auth)
  // 2) Fallback: restaura desde localStorage si hay un usuario cacheado
  useEffect(()=>{
    const restoreSession=async()=>{
      try{
        // Primero: intentar Supabase Auth
        const s=await getSession()
        if(s?.user?.email&&users.length>0){
          const u=users.find(x=>x.correo?.toLowerCase()===s.user.email.toLowerCase())
          if(u){setCu(u);return}
        }
        // Fallback: usuario cacheado en localStorage
        const cachedId=localStorage.getItem("erp_cu_id")
        if(cachedId&&users.length>0){
          const u=users.find(x=>x.id===cachedId&&x.activo)
          if(u)setCu(u)
        }
      }catch(e){console.warn("restoreSession:",e)}
    }
    if(users.length>0&&!cu)restoreSession()
    // Listener de cambios de auth (logout automático si el token expira)
    const{data:authListener}=supabase.auth.onAuthStateChange((event,sess)=>{
      if(event==="SIGNED_OUT"){setCu(null);localStorage.removeItem("erp_cu_id")}
    })
    return()=>{authListener?.subscription?.unsubscribe()}
  },[users])

  // ⭐ v48: Guardar id del usuario en localStorage cada vez que cambia (para fallback)
  useEffect(()=>{
    try{
      if(cu?.id)localStorage.setItem("erp_cu_id",cu.id)
      else localStorage.removeItem("erp_cu_id")
    }catch(e){}
  },[cu])

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

  // ⭐ v48: Helper de notificaciones basado en tabla config_notificaciones
  // Consulta qué usuario recibe según el estado destino + opcional CC al admin
  const notificarFlujo=async({ocId,tipo,nuevoEstado,asunto,mensaje})=>{
    if(config.email_activo!=="true"){console.log("📧 Email desactivado, no se notifica");return}
    if(!nuevoEstado){console.warn("notificarFlujo: falta nuevoEstado");return}

    // 1) Consultar config_notificaciones para este estado
    const{data:cfg,error:cfgErr}=await supabase.from('config_notificaciones').select('*').eq('estado_oc',nuevoEstado).eq('activo',true).maybeSingle()
    if(cfgErr){console.error("notificarFlujo: error consultando config:",cfgErr);return}
    if(!cfg){console.warn(`notificarFlujo: no hay config para estado "${nuevoEstado}"`);return}

    // 2) Buscar usuario destino principal
    const correos=new Set()
    let destinoPrincipalNombre=""
    if(cfg.usuario_destino_id){
      const u=users.find(x=>x.id===cfg.usuario_destino_id&&x.activo&&x.correo&&x.correo.includes("@"))
      if(u){correos.add(u.correo);destinoPrincipalNombre=u.nombre}
      else{console.warn(`notificarFlujo: usuario destino ${cfg.usuario_destino_id} no activo o sin correo`)}
    }
    // 3) CC al admin si está marcado
    if(cfg.cc_admin){
      const admins=users.filter(u=>u.rol==="admin"&&u.activo&&u.correo&&u.correo.includes("@"))
      admins.forEach(a=>correos.add(a.correo))
    }
    if(correos.size===0){console.warn(`notificarFlujo: sin destinatarios para estado "${nuevoEstado}"`);return}

    // 4) Crear una notificación por cada destinatario
    const filas=Array.from(correos).map(correo=>{
      const u=users.find(x=>x.correo===correo)
      return{
        id:uid(),
        oc_id:ocId,
        tipo:"Email",
        destino_correo:correo,
        destino_nombre:u?.nombre||destinoPrincipalNombre||"Usuario",
        asunto:asunto||`Acción requerida en ${ocId}`,
        mensaje:mensaje||`La OC ${ocId} requiere tu atención. Estado actual: ${nuevoEstado}`,
        estado:"Pendiente",
        nuevo_estado:nuevoEstado,
        accion:tipo||null,
        usuario:cu?.nombre||null,
        rol:cu?.rol||null,
        fecha:hoy(),
        hora:hora()
      }
    })
    const{error}=await supabase.from('notificaciones').insert(filas)
    if(error){console.error("Error creando notificaciones:",error)}
    else{console.log(`📧 ${filas.length} notificación(es) creada(s) para estado "${nuevoEstado}"`)}
  }

  // Mapa: dado un nuevo estado, qué rol debe ser notificado
  const ROL_POR_ESTADO={
    "Pend. Dir. Negocios":"dir_negocios",
    "Proyectar costeo":"analista",
    "Pend. Dir. Finanzas":"dir_finanzas",
    "Aprobada":"analista",
    "Confirmada prov.":"dir_operaciones",
    "Proforma OK":"dir_operaciones",
    "Validar costeo final":"analista",
    "Transporte":"jefe_operaciones",
    "Despacho nac.":"jefe_operaciones",
    "Recibida OK":"analista",
    "Recibida parcial":"analista"
  }

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
          <button onClick={async()=>{try{await signOut()}catch(e){}localStorage.removeItem("erp_cu_id");setCu(null)}} style={{width:36,height:36,borderRadius:10,background:"#FF3B3015",border:"none",cursor:"pointer",fontSize:13,color:"#FF3B30"}} title="Cerrar sesión">⏻</button>
        </div>
      </div>
    </div>

    {/* CONTENT */}
    {tab==="monitor"&&<MonitorView ocs={ocs} prods={prodsWithTransit} pagos={pagos} provs={provs} h={h} setTab={setTab} config={config}/>}
    {tab==="repo"&&<RepoView prods={prodsWithTransit} cart={cart} setCart={setCart} go={()=>setTab("nueva")} config={config} params={params} paramsABCD={paramsABCD} sucursales={sucursales}/>}
    {tab==="costeo"&&<CosteoImpView config={config} saveConfig={saveConfig} ocs={ocs} cu={cu} addFirma={addFirma}/>}
    {tab==="forecast"&&<ForecastView prods={prodsWithTransit} ocs={ocs} config={config} saveConfig={saveConfig}/>}
    {tab==="cobertura"&&<CoberturaView prods={prodsWithTransit} ocs={ocs} config={config}/>}
    {tab==="llegadas"&&<LlegadasView ocs={ocs} provs={provs} setDet={setDet} config={config}/>}
    {tab==="transito"&&<TransitoView ocs={ocs} provs={provs} config={config}/>}
    {tab==="finanzas"&&<FinanzasView ocs={ocs} provs={provs} pagos={pagos} setPagos={setPagos} config={config}/>}
    {tab==="nueva"&&<SolView cart={cart} setCart={setCart} provs={provs} users={users} sucursales={sucursales} cu={cu} setOcs={setOcs} addFirma={addFirma} goOC={()=>setTab("ordenes")} ocs={ocs} config={config} notificarFlujo={notificarFlujo}/>}
    {tab==="ordenes"&&<OCListView ocs={ocs} firmas={firmas} pagos={pagos} updOC={updOC} addFirma={addFirma} setDet={setDet} cu={cu} h={h} provs={provs} setOcs={setOcs} notificarFlujo={notificarFlujo} ROL_POR_ESTADO={ROL_POR_ESTADO}/>}
    {tab==="flujograma"&&<FlujogramaView ocs={ocs} provs={provs} sucursales={sucursales} users={users} setDet={setDet}/>}
    {tab==="config"&&<ConfigView config={config} saveConfig={saveConfig} params={params} setParams={setParams} paramsABCD={paramsABCD} setParamsABCD={setParamsABCD} provs={provs} setProvs={setProvs} users={users} setUsers={setUsers} sucursales={sucursales} setSucursales={setSucursales} h={h} configTab={configTab} setConfigTab={setConfigTab} loadAll={loadAll} cu={cu}/>}

    <Sheet show={!!det} onClose={()=>setDet(null)} title={det?.id||""}>{det&&<OCDetView oc={det} firmas={firmas.filter(f=>f.oc_id===det.id)} pagos={pagos.filter(p=>p.oc_id===det.id)} provs={provs} updOC={updOC} addFirma={addFirma} setPagos={setPagos} close={()=>{setDet(null);loadAll()}} cu={cu} h={h} config={config} notificarFlujo={notificarFlujo} ROL_POR_ESTADO={ROL_POR_ESTADO} setTab={setTab}/>}</Sheet>

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
function MonitorView({ocs,prods,pagos=[],provs=[],h,setTab,config={}}){
  const TC_USD=Number(config.tc_usd)||950
  const pN=ocs.filter(o=>o.estado==="Pend. Dir. Negocios"),pF=ocs.filter(o=>o.estado==="Pend. Dir. Finanzas")
  const trans=ocs.filter(o=>["Despacho nac.","Transporte","Internación","Validar costeo final","Pago fabricación","Pago embarque"].includes(o.estado))

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
  if(pagosVencidos.length>0)alertas.push({sev:"high",ic:"💸",t:`${pagosVencidos.length} pagos vencidos`,sub:`Total: ${fmt(pagosVencidos.reduce((s,p)=>s+(p.monto||0)*(p.moneda==="USD"?TC_USD:1),0))}`,action:"Ver finanzas",tab:"finanzas"})
  if(pN.length>0||pF.length>0)alertas.push({sev:"med",ic:"⏳",t:`${pN.length+pF.length} OC esperando aprobación`,sub:`${pN.length} Dir. Negocios · ${pF.length} Dir. Finanzas`,action:"Ir a órdenes",tab:"ordenes"})
  if(ocAtascadas>0)alertas.push({sev:"med",ic:"⚠️",t:`${ocAtascadas} OC atascadas +14 días`,sub:`Sin movimiento hace más de 2 semanas`,action:"Ver órdenes",tab:"ordenes"})
  if(pagosProx7.length>0)alertas.push({sev:"low",ic:"📅",t:`${pagosProx7.length} pagos vencen en 7 días`,sub:fmt(pagosProx7.reduce((s,p)=>s+(p.monto||0)*(p.moneda==="USD"?TC_USD:1),0)),action:"Planificar",tab:"finanzas"})
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
  const totalPagado=pagos.filter(p=>p.estado==="Pagado").reduce((s,p)=>s+((p.monto||0)*(p.moneda==="USD"?TC_USD:1)),0)
  const totalPendiente=pagos.filter(p=>p.estado!=="Pagado").reduce((s,p)=>s+((p.monto||0)*(p.moneda==="USD"?TC_USD:1)),0)

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
  const[q,setQ]=useLocalState("repo_q","")
  // ⭐ v48: filtros multi-select como arrays. [] significa "todos".
  const[fcArr,setFcArr]=useLocalState("repo_fcArr",[])   // clases ABCD seleccionadas
  const[ftArr,setFtArr]=useLocalState("repo_ftArr",[])   // tipos seleccionados
  const[sortBy,setSortBy]=useLocalState("repo_sortBy","costo_reposicion")
  const[fe,setFe]=useLocalState("repo_fe","T")
  const[sortDir,setSortDir]=useLocalState("repo_sortDir","desc")
  const[fsuc,setFsuc]=useLocalState("repo_fsuc","T")
  const[showTipos,setShowTipos]=useState(false) // dropdown multi-select tipos
  const tipos=[...new Set(prods.map(p=>p.tipo_producto).filter(Boolean))].sort()
  const estados=["Reposición","Stock suficiente","Sin ventas","Revisar"]
  const toggleSort=(col)=>{if(sortBy===col){setSortDir(d=>d==="desc"?"asc":"desc")}else{setSortBy(col);setSortDir(col==="dias_cobertura"?"asc":"desc")}}
  // ⭐ v48: filtros multi: array vacío = "todos"
  const fil=prods.filter(i=>
    (fcArr.length===0||fcArr.includes(i.clasif_abcd))
    &&(ftArr.length===0||ftArr.includes(i.tipo_producto))
    &&(fe==="T"||i.estado===fe)
    &&(!q||i.producto?.toLowerCase().includes(q.toLowerCase())||i.sku?.toLowerCase().includes(q.toLowerCase()))
  ).sort((a,b)=>{const av=a[sortBy]||0,bv=b[sortBy]||0;if(sortBy==="producto"||sortBy==="tipo_producto")return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));return sortDir==="asc"?(av-bv):(bv-av)})
  const toggleAbcd=(k)=>setFcArr(p=>p.includes(k)?p.filter(x=>x!==k):[...p,k])
  const toggleTipo=(t)=>setFtArr(p=>p.includes(t)?p.filter(x=>x!==t):[...p,t])
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
    <div style={{display:"flex",gap:4,marginBottom:6,overflowX:"auto",alignItems:"center"}}>
      <button onClick={()=>setFcArr([])} style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",background:fcArr.length===0?"#007AFF":"#F2F2F7",color:fcArr.length===0?"#fff":"#8E8E93"}}>Todos ({resumen.total})</button>
      {[["A",resumen.a],["B",resumen.b],["C",resumen.c],["D",resumen.d]].map(([k,n])=>{
        const sel=fcArr.includes(k)
        return<button key={k} onClick={()=>toggleAbcd(k)} style={{padding:"5px 10px",borderRadius:6,fontSize:11,fontWeight:600,border:"none",cursor:"pointer",background:sel?(CL[k]?.bg||"#007AFF"):"#F2F2F7",color:sel?(CL[k]?.c||"#fff"):"#8E8E93",display:"inline-flex",alignItems:"center",gap:4}}>
          <span style={{width:10,height:10,borderRadius:2,background:sel?(CL[k]?.c||"#fff"):"#C7C7CC",display:"inline-block"}}/>
          Clase {k} ({n})
        </button>
      })}
      {fcArr.length>0&&<button onClick={()=>setFcArr([])} style={{padding:"4px 8px",borderRadius:6,fontSize:10,fontWeight:600,border:"1px solid #E5E5EA",cursor:"pointer",background:"#fff",color:"#8E8E93",marginLeft:4}}>✕ Limpiar</button>}
    </div>

    {cL>0&&<Cd ac="#007AFF" s={{marginBottom:8,background:"#007AFF08"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:13,fontWeight:600,color:"#007AFF"}}>{cL} SKUs seleccionados · {fmt(tC)}</span><div style={{display:"flex",gap:4}}><Bt sm v="pri" onClick={go} ic="➕">Crear OC</Bt><Bt sm v="gry" onClick={()=>setCart({})}>Vaciar</Bt></div></div></Cd>}

    <div style={{display:"flex",gap:6,marginBottom:8}}>
      <input placeholder="Buscar producto o SKU..." value={q} onChange={e=>setQ(e.target.value)} style={{...css.input,flex:1,fontSize:13}}/>
      {/* ⭐ v48: Dropdown multi-select de tipos */}
      <div style={{position:"relative"}}>
        <button onClick={()=>setShowTipos(v=>!v)} style={{...css.select,width:180,fontSize:12,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:ftArr.length>0?"#007AFF10":"#fff",borderColor:ftArr.length>0?"#007AFF40":"#E5E5EA",color:ftArr.length>0?"#007AFF":"#3A3A3C",fontWeight:ftArr.length>0?600:400}}>
          <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {ftArr.length===0?"Todos los tipos":ftArr.length===1?ftArr[0]:`${ftArr.length} tipos`}
          </span>
          <span style={{fontSize:10}}>{showTipos?"▲":"▼"}</span>
        </button>
        {showTipos&&<>
          <div onClick={()=>setShowTipos(false)} style={{position:"fixed",inset:0,zIndex:50}}/>
          <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,minWidth:260,maxWidth:320,maxHeight:340,overflowY:"auto",background:"#fff",border:"1px solid #E5E5EA",borderRadius:8,boxShadow:"0 4px 20px rgba(0,0,0,0.12)",zIndex:51,padding:"6px 0"}}>
            <div style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",borderBottom:"1px solid #F2F2F7"}}>
              <button onClick={()=>setFtArr(tipos)} style={{fontSize:10,color:"#007AFF",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>Seleccionar todos</button>
              <button onClick={()=>setFtArr([])} style={{fontSize:10,color:"#FF3B30",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>Limpiar</button>
            </div>
            {tipos.length===0?<div style={{padding:12,fontSize:11,color:"#8E8E93",textAlign:"center"}}>No hay tipos disponibles</div>:
            tipos.map(t=>{
              const sel=ftArr.includes(t)
              const count=prods.filter(p=>p.tipo_producto===t).length
              return<label key={t} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",cursor:"pointer",background:sel?"#007AFF08":"transparent",fontSize:12}}>
                <input type="checkbox" checked={sel} onChange={()=>toggleTipo(t)} style={{width:14,height:14,accentColor:"#007AFF"}}/>
                <span style={{flex:1,color:sel?"#007AFF":"#3A3A3C",fontWeight:sel?600:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t}</span>
                <span style={{fontSize:10,color:"#AEAEB2"}}>{count}</span>
              </label>
            })}
          </div>
        </>}
      </div>
      <select value={fe} onChange={e=>setFe(e.target.value)} style={{...css.select,width:130,fontSize:12}}><option value="T">Todos estados</option>{estados.map(e=><option key={e} value={e}>{e}</option>)}</select>
      <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{...css.select,width:130,fontSize:12}}><option value="costo_reposicion">Mayor inversión</option><option value="dias_cobertura">Menor cobertura</option><option value="reposicion_necesaria">Mayor cantidad</option><option value="venta_total">Mayor venta</option></select>
    </div>

    {/* ⭐ v48: Chips de tipos seleccionados (resumen visual + quick remove) */}
    {ftArr.length>0&&<div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{fontSize:10,color:"#8E8E93",fontWeight:600,textTransform:"uppercase",marginRight:4}}>Tipos:</span>
      {ftArr.map(t=><span key={t} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",background:"#007AFF15",color:"#007AFF",borderRadius:12,fontSize:11,fontWeight:600}}>
        {t}
        <button onClick={()=>toggleTipo(t)} style={{background:"none",border:"none",color:"#007AFF",cursor:"pointer",padding:0,fontSize:12,lineHeight:1}}>×</button>
      </span>)}
    </div>}

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
function SolView({cart,setCart,provs,users,sucursales=[],cu,setOcs,addFirma,goOC,ocs,config={},notificarFlujo}){
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

  // ⭐ Importador de OC desde Excel
  const[importData,setImportData]=useState(null) // {proveedor, productos[], condiciones, ocNum}
  const[showImport,setShowImport]=useState(false)

  const processOCExcel=async(file)=>{
    try{
      const data=await file.arrayBuffer()
      const wb=XLSX.read(data,{type:'array'})
      // Buscar hoja "ORDEN DE COMPRA" o la primera
      const sheetName=wb.SheetNames.find(s=>s.toUpperCase().includes("ORDEN"))||wb.SheetNames[0]
      const ws=wb.Sheets[sheetName]
      if(!ws){alert("⚠ No se encontró la hoja de datos en el Excel");return}

      // Leer cabecera
      const ocNum=ws['D1']?.v||""
      const provNombre=ws['F8']?.v||""
      const solicitante=ws['F10']?.v||""
      const estado=ws['F1']?.v||""
      const condPago=ws['E24']?.v||""
      const fechaEntrega=ws['F24']?.v||""

      // Leer productos (empiezan en fila 27: B=SKU, C=PRODUCTO, D=CANTIDAD, E=COSTO, F=TOTAL)
      const prods=[]
      for(let r=27;r<1100;r++){
        const sku=ws[XLSX.utils.encode_cell({r:r-1,c:1})]?.v
        const prod=ws[XLSX.utils.encode_cell({r:r-1,c:2})]?.v
        if(!sku&&!prod)break
        const cant=Number(ws[XLSX.utils.encode_cell({r:r-1,c:3})]?.v)||0
        const costo=Number(ws[XLSX.utils.encode_cell({r:r-1,c:4})]?.v)||0
        prods.push({sku:String(sku||""),producto:String(prod||""),cantidad:cant,costo_unitario:costo,total:cant*costo})
      }

      if(prods.length===0){alert("⚠ No se encontraron productos en el Excel");return}

      // Match proveedor con BD
      const provMatch=provs.find(p=>(p.nombre||"").toLowerCase().includes(provNombre.toLowerCase().slice(0,15))||provNombre.toLowerCase().includes((p.nombre||"").toLowerCase().slice(0,15)))

      // Match productos con BD — buscar por SKU en tabla productos
      const{data:prodsBD}=await supabase.from('productos').select('sku,producto,tipo_producto')
      const prodsMap={}
      ;(prodsBD||[]).forEach(p=>{prodsMap[String(p.sku)]=p})
      const tipos=[...new Set((prodsBD||[]).map(p=>p.tipo_producto).filter(Boolean))].sort()

      const matched=prods.map(p=>{
        const bdMatch=prodsMap[String(p.sku)]
        if(bdMatch)return{...p,match:"exact",tipo_producto:bdMatch.tipo_producto,bdNombre:bdMatch.producto}
        // Fuzzy match por nombre
        const fuzzy=(prodsBD||[]).find(b=>(b.producto||"").toLowerCase().includes(p.producto.toLowerCase().slice(0,20))||p.producto.toLowerCase().includes((b.producto||"").toLowerCase().slice(0,20)))
        if(fuzzy)return{...p,match:"fuzzy",tipo_producto:fuzzy.tipo_producto,bdNombre:fuzzy.producto,bdSku:fuzzy.sku}
        return{...p,match:"new",tipo_producto:""}
      })

      const totalUSD=prods.reduce((s,p)=>s+p.total,0)

      setImportData({ocNum,provNombre,provMatch,solicitante,estado,condPago,fechaEntrega,productos:matched,totalUSD,tipos})
      setShowImport(true)

      // Si encontró proveedor, auto-setear
      if(provMatch){setProv(provMatch.id);setTipo(provMatch.tipo==="Internacional"||provMatch.tipo==="Importación"?"Importación":"Nacional")}
    }catch(e){
      console.error("Error procesando Excel OC:",e)
      alert("Error al procesar el archivo: "+e.message)
    }
  }

  const aplicarImport=()=>{
    if(!importData)return
    // Cargar productos como items manuales
    const items=importData.productos.filter(p=>p.cantidad>0).map(p=>({
      id:uid(),
      producto:p.producto,
      sku:p.sku,
      tipo_producto:p.tipo_producto||"",
      cantidad:p.cantidad,
      costo_unitario:p.costo_unitario
    }))
    setManualItems(items)
    if(importData.fechaEntrega)setFEst(importData.fechaEntrega)
    // Agregar referencia al Excel original
    const ref=`Importado desde Excel OC #${importData.ocNum||"—"} · ${importData.productos.length} productos · Proveedor: ${importData.provNombre}`
    setNotas(prev=>prev?(prev+"\n"+ref):ref)
    // Auto-setear tipo si el proveedor matcheó
    if(importData.provMatch){
      const pt=importData.provMatch.tipo
      if(pt==="Internacional"||pt==="Importación")setTipo("Importación")
    }
    setShowImport(false)
    setImportData(null)
    alert(`✓ ${items.length} productos cargados desde el Excel.\n\nRevisá los datos, seleccioná proveedor y completá el plan de pago antes de enviar.`)
  }

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
  const isI=tipo==="Importación"
  const allItems=[...sel.map(i=>({...i,source:"repo"})),...manualItems.map(i=>({...i,cp:i.cantidad,source:"manual"}))]
  const total=allItems.reduce((s,i)=>s+((i.cp||i.cantidad||0)*(i.costo_unitario||0)),0)
  const sp=provs.find(p=>p.id===prov)

  // ⭐ v47: Correlativo robusto. Consulta BD (ordenes_compra + audit_log historico) para evitar colisiones con OCs eliminadas.
  const nextNum=async()=>{
    const prefix=tipo==="Importación"?"OC-IMP-":"OC-NAC-"
    let maxN=0
    // 1) IDs vivos en ordenes_compra
    const{data:vivos}=await supabase.from('ordenes_compra').select('id').like('id',prefix+'%')
    ;(vivos||[]).forEach(o=>{const n=parseInt(o.id.replace(prefix,""))||0;if(n>maxN)maxN=n})
    // 2) IDs historicos en audit_log (OCs que existieron alguna vez aunque hoy estén borradas)
    const{data:historicos}=await supabase.from('audit_log').select('registro_id').eq('tabla','ordenes_compra').like('registro_id',prefix+'%')
    ;(historicos||[]).forEach(l=>{const n=parseInt((l.registro_id||"").replace(prefix,""))||0;if(n>maxN)maxN=n})
    // 3) Fallback al estado local por si Supabase fallara
    ;(ocs||[]).filter(o=>o.id?.startsWith(prefix)).forEach(o=>{const n=parseInt(o.id.replace(prefix,""))||0;if(n>maxN)maxN=n})
    return prefix+String(maxN+1).padStart(6,"0")
  }

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
    setSaving(true);const id=await nextNum()
    const condPago=medioPago==="contado"?"Contado":(numCuotas>1?`${numCuotas} cuotas`:`Crédito ${diasCredito} días`)
    // ⭐ Para importación: total = suma en USD, convertir a CLP. Para nacional: total = CLP directo
    const totalUSD=isI?Math.round(total):0
    const totalCLP=isI?Math.round(total*TC_USD):total
    const oc={id,fecha_creacion:hoy(),solicitante_id:cu.id,proveedor_id:prov,tipo_oc:tipo,estado:"Pend. Dir. Negocios",fase_actual:1,total_clp:totalCLP,total_usd:totalUSD,condicion_pago:condPago,pct_fab:isI?(cuotas.find(c=>c.concepto.toLowerCase().includes("fabri"))?.pct||0):0,pct_embarque:isI?(cuotas.find(c=>c.concepto.toLowerCase().includes("embar"))?.pct||0):0,pct_puerto:isI?(cuotas.find(c=>c.concepto.toLowerCase().includes("puerto")||c.concepto.toLowerCase().includes("saldo"))?.pct||0):0,fecha_estimada:fEst||null,estado_pago:"Pago pend.",notas,destino_sucursal_id:destinoSucursal||null}
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
    await addFirma(id,`Solicitud creada con ${items.length} producto(s)`)
    // ⭐ Notificar a Dir. Negocios que hay una OC pendiente de su aprobación
    if(notificarFlujo){
      const pv=provs.find(p=>p.id===prov)
      await notificarFlujo({
        ocId:id,
        tipo:"Email",
        nuevoEstado:"Pend. Dir. Negocios",
        rolDestino:"dir_negocios",
        asunto:`Nueva OC ${id} requiere tu aprobación`,
        mensaje:`${cu?.nombre} ha creado la orden de compra ${id} por ${isI?fU(totalUSD):fmt(totalCLP)} al proveedor ${pv?.nombre||prov} (${tipo}).\n\nIngresá al sistema para revisar y aprobar:\nhttps://outlet-compras.netlify.app`
      })
    }
    setOcs(p=>[oc,...p]);setCart({});setManualItems([]);setDone(oc)
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
            <td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{tipo==="Importación"?fU(i.cp*(i.costo_unitario||0)):fmt(i.cp*(i.costo_unitario||0))}</td>
          </tr>)}</tbody>
        </table></>}

        {/* Manual products + Import Excel */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
          <div style={{fontSize:12,fontWeight:700,color:"#AF52DE",textTransform:"uppercase"}}>Productos manuales ({manualItems.length})</div>
          <div style={{display:"flex",gap:6}}>
            <label style={{padding:"6px 14px",borderRadius:8,fontSize:12,fontWeight:600,background:"#007AFF",color:"#fff",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
              📎 Importar Excel
              <input type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={e=>{if(e.target.files[0])processOCExcel(e.target.files[0]);e.target.value=""}}/>
            </label>
            <button onClick={addManual} style={{padding:"6px 14px",borderRadius:8,fontSize:12,fontWeight:600,background:"#AF52DE",color:"#fff",border:"none",cursor:"pointer"}}>+ Agregar producto</button>
          </div>
        </div>

        {/* ⭐ Panel preview importación Excel */}
        {showImport&&importData&&<div style={{background:"#F0F8FF",borderRadius:12,border:"2px solid #007AFF40",padding:"16px",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:"#007AFF"}}>📎 Importación desde Excel</div>
              <div style={{fontSize:11,color:"#636366",marginTop:2}}>OC #{importData.ocNum} · {importData.productos.length} productos · {fU(importData.totalUSD)}</div>
            </div>
            <button onClick={()=>{setShowImport(false);setImportData(null)}} style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,background:"#FF3B3015",color:"#FF3B30",border:"none",cursor:"pointer"}}>✕ Cancelar</button>
          </div>

          {/* Proveedor match */}
          <div style={{background:"#fff",borderRadius:8,padding:"10px 12px",marginBottom:10,border:"1px solid #E5E5EA"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#636366",marginBottom:4}}>PROVEEDOR DEL EXCEL</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:13,fontWeight:600}}>{importData.provNombre}</div>
              {importData.provMatch?
                <span style={{fontSize:11,fontWeight:700,color:"#34C759",background:"#34C75915",padding:"3px 8px",borderRadius:4}}>✓ Match: {importData.provMatch.nombre}</span>:
                <span style={{fontSize:11,fontWeight:700,color:"#FF9500",background:"#FF950015",padding:"3px 8px",borderRadius:4}}>🆕 Proveedor no encontrado en BD</span>
              }
            </div>
            {importData.solicitante&&<div style={{fontSize:11,color:"#8E8E93",marginTop:3}}>Solicitante: {importData.solicitante} · Estado original: {importData.estado||"—"}</div>}
          </div>

          {/* Resumen de matching productos */}
          {(()=>{
            const exact=importData.productos.filter(p=>p.match==="exact").length
            const fuzzy=importData.productos.filter(p=>p.match==="fuzzy").length
            const nuevo=importData.productos.filter(p=>p.match==="new").length
            const conCant=importData.productos.filter(p=>p.cantidad>0).length
            const sinCant=importData.productos.filter(p=>p.cantidad===0).length
            return<div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              <span style={{fontSize:11,fontWeight:700,color:"#34C759",background:"#34C75915",padding:"4px 10px",borderRadius:6}}>✅ {exact} exactos</span>
              {fuzzy>0&&<span style={{fontSize:11,fontWeight:700,color:"#FF9500",background:"#FF950015",padding:"4px 10px",borderRadius:6}}>⚠ {fuzzy} aprox.</span>}
              {nuevo>0&&<span style={{fontSize:11,fontWeight:700,color:"#007AFF",background:"#007AFF15",padding:"4px 10px",borderRadius:6}}>🆕 {nuevo} nuevos</span>}
              {sinCant>0&&<span style={{fontSize:11,fontWeight:700,color:"#8E8E93",background:"#F2F2F7",padding:"4px 10px",borderRadius:6}}>⊘ {sinCant} sin cantidad</span>}
              <span style={{fontSize:11,fontWeight:700,color:"#1C1C1E",background:"#F2F2F7",padding:"4px 10px",borderRadius:6}}>{conCant} a cargar</span>
            </div>
          })()}

          {/* Tabla de productos */}
          <div style={{maxHeight:350,overflowY:"auto",borderRadius:8,border:"1px solid #E5E5EA"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead style={{position:"sticky",top:0,zIndex:2}}><tr style={{background:"#F8F8FA"}}>
                <th style={{padding:"6px 8px",textAlign:"left",fontSize:9,fontWeight:700,color:"#636366"}}>Match</th>
                <th style={{padding:"6px 8px",textAlign:"left",fontSize:9,fontWeight:700,color:"#636366"}}>Producto</th>
                <th style={{padding:"6px 8px",textAlign:"left",fontSize:9,fontWeight:700,color:"#636366"}}>SKU</th>
                <th style={{padding:"6px 8px",textAlign:"left",fontSize:9,fontWeight:700,color:"#636366",minWidth:120}}>Tipo/Categoría</th>
                <th style={{padding:"6px 8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#636366"}}>Cant.</th>
                <th style={{padding:"6px 8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#636366"}}>Costo U.</th>
                <th style={{padding:"6px 8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#636366"}}>Total</th>
              </tr></thead>
              <tbody>{importData.productos.map((p,i)=>{
                const mc=p.match==="exact"?"#34C759":p.match==="fuzzy"?"#FF9500":"#007AFF"
                const ml=p.match==="exact"?"✅":p.match==="fuzzy"?"⚠":"🆕"
                return<tr key={i} style={{borderBottom:"1px solid #F2F2F7",background:p.cantidad===0?"#F8F8FA":"#fff",opacity:p.cantidad===0?0.5:1}}>
                  <td style={{padding:"5px 8px"}}><span style={{fontSize:10,fontWeight:700,color:mc,background:mc+"15",padding:"2px 6px",borderRadius:4}}>{ml}</span></td>
                  <td style={{padding:"5px 8px"}}>
                    <div style={{fontWeight:600,fontSize:11}}>{p.producto}</div>
                    {p.match==="fuzzy"&&p.bdNombre&&<div style={{fontSize:9,color:"#FF9500"}}>≈ BD: {p.bdNombre}</div>}
                  </td>
                  <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:10,color:"#636366"}}>{p.sku}</td>
                  <td style={{padding:"5px 8px"}}>
                    {p.match==="new"?
                      <select value={p.tipo_producto} onChange={e=>{const np=[...importData.productos];np[i]={...np[i],tipo_producto:e.target.value};setImportData({...importData,productos:np})}} style={{...css.select,fontSize:10,padding:"3px 4px",width:"100%"}}>
                        <option value="">— Seleccionar —</option>
                        {(importData.tipos||[]).map(t=><option key={t} value={t}>{t}</option>)}
                      </select>:
                      <span style={{fontSize:10,color:"#8E8E93"}}>{p.tipo_producto||"—"}</span>
                    }
                  </td>
                  <td style={{padding:"5px 8px",textAlign:"right",fontWeight:600,color:p.cantidad>0?"#007AFF":"#AEAEB2"}}>{fN(p.cantidad)}</td>
                  <td style={{padding:"5px 8px",textAlign:"right",color:"#636366"}}>{fU(p.costo_unitario)}</td>
                  <td style={{padding:"5px 8px",textAlign:"right",fontWeight:600}}>{p.cantidad>0?fU(p.total):"—"}</td>
                </tr>
              })}</tbody>
            </table>
          </div>

          {/* Footer con acción */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12}}>
            <div style={{fontSize:13,fontWeight:700,color:"#34C759"}}>{fU(importData.totalUSD)} total · {importData.productos.filter(p=>p.cantidad>0).length} productos a cargar</div>
            <Bt v="pri" onClick={aplicarImport} ic="✓">Cargar {importData.productos.filter(p=>p.cantidad>0).length} productos a la OC</Bt>
          </div>
        </div>}

        {manualItems.length>0&&<table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:12}}>
          <thead><tr style={{background:"#AF52DE08"}}><th style={{padding:"6px",textAlign:"left",fontSize:10,fontWeight:700,color:"#AF52DE",borderBottom:"1px solid #AF52DE30"}}>Producto</th><th style={{padding:"6px",fontSize:10,fontWeight:700,color:"#AF52DE",borderBottom:"1px solid #AF52DE30"}}>SKU</th><th style={{padding:"6px",fontSize:10,fontWeight:700,color:"#AF52DE",borderBottom:"1px solid #AF52DE30"}}>Tipo</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"1px solid #AF52DE30"}}>Cant.</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"1px solid #AF52DE30"}}>Costo U.</th><th style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:700,borderBottom:"1px solid #AF52DE30"}}>Subtotal</th><th style={{width:30,borderBottom:"1px solid #AF52DE30"}}></th></tr></thead>
          <tbody>{manualItems.map(i=><tr key={i.id} style={{borderBottom:"1px solid #F2F2F7"}}>
            <td style={{padding:"4px"}}><input value={i.producto} onChange={e=>updManual(i.id,"producto",e.target.value)} placeholder="Nombre..." style={{...css.input,padding:"6px 8px",fontSize:12}}/></td>
            <td style={{padding:"4px"}}><input value={i.sku} onChange={e=>updManual(i.id,"sku",e.target.value)} placeholder="SKU..." style={{...css.input,padding:"6px 8px",fontSize:12,width:100}}/></td>
            <td style={{padding:"4px"}}><input value={i.tipo_producto} onChange={e=>updManual(i.id,"tipo_producto",e.target.value)} placeholder="Tipo..." style={{...css.input,padding:"6px 8px",fontSize:12,width:100}}/></td>
            <td style={{padding:"4px"}}><input type="number" value={i.cantidad} onChange={e=>updManual(i.id,"cantidad",Number(e.target.value))} style={{...css.input,padding:"6px 8px",fontSize:12,width:70,textAlign:"right"}}/></td>
            <td style={{padding:"4px"}}><input type="number" value={i.costo_unitario} onChange={e=>updManual(i.id,"costo_unitario",Number(e.target.value))} style={{...css.input,padding:"6px 8px",fontSize:12,width:80,textAlign:"right"}}/></td>
            <td style={{padding:"4px",textAlign:"right",fontWeight:600}}>{tipo==="Importación"?fU(i.cantidad*i.costo_unitario):fmt(i.cantidad*i.costo_unitario)}</td>
            <td style={{padding:"4px"}}><button onClick={()=>delManual(i.id)} style={{background:"#FF3B3012",color:"#FF3B30",border:"none",borderRadius:4,padding:"4px 6px",cursor:"pointer",fontSize:10}}>✕</button></td>
          </tr>)}</tbody>
        </table>}
        {manualItems.length===0&&sel.length===0&&<div style={{textAlign:"center",padding:20,color:"#8E8E93",fontSize:13}}>Agrega productos desde Reposición o manualmente con el botón "Agregar producto"</div>}

        <div style={{borderTop:"2px solid #1C1C1E",paddingTop:12,marginTop:8,display:"flex",justifyContent:"space-between",alignItems:"baseline"}}><span style={{fontSize:16,fontWeight:700}}>TOTAL ORDEN</span><div style={{textAlign:"right"}}>{isI?<><div style={{fontSize:24,fontWeight:800,color:"#34C759"}}>{fU(total)}</div><div style={{fontSize:13,color:"#8E8E93"}}>≈ {fmt(Math.round(total*TC_USD))} (TC ${fN(TC_USD)})</div></>:<span style={{fontSize:24,fontWeight:800}}>{fmt(total)}</span>}</div></div>
      </div>
      <div style={{borderTop:"1px solid #E5E5EA",padding:"16px 32px",background:"#FAFAFA"}}><div style={{display:"flex",alignItems:"center",gap:12}}><Av n={cu?.avatar} c={rl(cu).c} sz={40}/><div><div style={{fontSize:16,fontStyle:"italic",fontWeight:700,color:rl(cu).c}}>{cu?.firma_digital||cu?.nombre}</div><div style={{fontSize:11,color:"#AEAEB2"}}>{rl(cu).l} — {hoy()} {hora()}</div></div></div></div>
    </div>
    <div style={{marginTop:14}}><Bt v="pri" full dis={!prov||!fEst||saving||(sel.length===0&&manualItems.length===0)} onClick={submit} ic="✍️">{saving?"Procesando...":"Firmar y enviar solicitud"}</Bt></div>
  </div>
}

/* ═══ OC LIST — With admin edit/delete + notification log ═══ */
function OCListView({ocs,firmas,pagos,updOC,addFirma,setDet,cu,h,provs,setOcs,notificarFlujo,ROL_POR_ESTADO={}}){
  const[f,setF]=useLocalState("oc_filtro","Todas");const[deleting,setDeleting]=useState(null);const[notifLog,setNotifLog]=useState([])
  const[commentOC,setCommentOC]=useState("");const[showComment,setShowComment]=useState(null)
  // ⭐ v48: Sheet de cancelación de OC (admin, cualquier estado)
  const[cancelSheet,setCancelSheet]=useState(null) // oc object
  const[cancelMotivo,setCancelMotivo]=useState("")
  const[cancelDetalle,setCancelDetalle]=useState("")
  const[cancelConfirmado,setCancelConfirmado]=useState(false)
  const[cancelPagos,setCancelPagos]=useState([])
  const[cancelSaving,setCancelSaving]=useState(false)
  const estados=["Todas","Pend. Dir. Negocios","Proyectar costeo","Pend. Dir. Finanzas","Pend. proveedor","Proforma OK","Pago fabricación","Pago embarque","Internación","Validar costeo final","Transporte","Despacho nac.","Recibida OK","Cerrada"]
  const fil=f==="Todas"?ocs:ocs.filter(o=>o.estado===f)
  const firma=async(oc,acc,nE,nF)=>{
    const comment=commentOC.trim()
    // ⭐ v47: Comentario obligatorio en todas las transiciones
    if(!comment){alert("⚠ Debes ingresar un comentario para registrar esta acción.\n\nEl comentario quedará asociado a la firma y será visible en el historial.");return}
    // ⭐ v47: Costeo PROYECTADO obligatorio antes de avanzar de "Proyectar costeo" a "Pend. Dir. Finanzas"
    if(acc==="Costeo proyectado"){
      const{data:costeos,error:cErr}=await supabase.from('costeos_oc').select('id,tipo_costeo').eq('oc_id',oc.id).eq('tipo_costeo','proyectado').limit(1)
      if(cErr){alert("Error verificando costeos: "+cErr.message);return}
      if(!costeos||costeos.length===0){
        alert(`⚠ No podés avanzar sin un costeo PROYECTADO registrado.\n\nLa OC ${oc.id} no tiene costeos proyectados anexados todavía.\n\nPasos:\n1. Abrí el módulo "Costeo IMP" en el menú inferior\n2. Seleccioná la OC ${oc.id}\n3. Completá los gastos y presioná "Anexar a OC"\n4. Volvé acá y aprobá la transición`)
        return
      }
    }
    const accionFull=`${acc} — "${comment}"`
    await addFirma(oc.id,accionFull);await updOC(oc.id,{estado:nE,fase_actual:nF??oc.fase_actual})
    const notif={id:uid(),oc_id:oc.id,accion:accionFull,nuevo_estado:nE,usuario:cu.nombre,rol:rl(cu).l,fecha:hoy(),hora:hora(),tipo:"Email"}
    await supabase.from('notificaciones').insert(notif).catch(()=>{})
    setNotifLog(p=>[notif,...p])
    // ⭐ v48: Notificar al siguiente destinatario según config_notificaciones
    if(notificarFlujo&&nE){
      const pv=provs.find(p=>p.id===oc.proveedor_id)
      await notificarFlujo({
        ocId:oc.id,
        tipo:"Email",
        nuevoEstado:nE,
        asunto:`${oc.id} cambió a estado "${nE}"`,
        mensaje:`La orden de compra ${oc.id} al proveedor ${pv?.nombre||oc.proveedor_id} cambió al estado "${nE}".\n\nAcción: ${accionFull}\nActualizado por: ${cu?.nombre}\nMonto: ${fmt(oc.total_clp)}\n\nRevisá el detalle en el sistema:\nhttps://outlet-compras.netlify.app`
      })
    }
    setCommentOC("");setShowComment(null)
  }
  const isAdmin=cu?.rol==="admin"||cu?.rol==="dir_general"
  const deleteOC=async(oc)=>{
    if(!confirm(`¿Eliminar la OC ${oc.id}? Esta acción no se puede deshacer.`))return
    setDeleting(oc.id)
    try{
      // ⭐ v47: Con FKs en CASCADE, solo borramos la cabecera y todo lo dependiente cae solo.
      // Igual borramos manualmente las que NO están en CASCADE para seguridad.
      await supabase.from('oc_items').delete().eq('oc_id',oc.id)
      await supabase.from('firmas').delete().eq('oc_id',oc.id)
      await supabase.from('pagos').delete().eq('oc_id',oc.id)
      await supabase.from('recepcion').delete().eq('oc_id',oc.id)
      await supabase.from('recepciones').delete().eq('oc_id',oc.id)
      await supabase.from('documentos_import').delete().eq('oc_id',oc.id)
      await supabase.from('costeos_oc').delete().eq('oc_id',oc.id)
      await supabase.from('notificaciones').delete().eq('oc_id',oc.id)
      const{error}=await supabase.from('ordenes_compra').delete().eq('id',oc.id)
      if(error){
        alert(`Error al eliminar OC ${oc.id}:\n\n${error.message}\n\nLa OC no se eliminó. Revisá si hay referencias pendientes en otras tablas.`)
        console.error("deleteOC error:",error)
        setDeleting(null)
        return
      }
      setOcs(p=>p.filter(o=>o.id!==oc.id))
    }catch(e){
      alert("Error inesperado al eliminar: "+e.message)
      console.error(e)
    }
    setDeleting(null)
  }

  // ⭐ v48: Abrir sheet de cancelación (precarga pagos ejecutados para advertencia)
  const abrirCancelar=async(oc)=>{
    setCancelMotivo(""); setCancelDetalle(""); setCancelConfirmado(false)
    const{data:pgs}=await supabase.from('pagos').select('id,concepto,monto,moneda,estado').eq('oc_id',oc.id).eq('estado','Pagado')
    setCancelPagos(pgs||[])
    setCancelSheet(oc)
  }

  // ⭐ v48: Ejecutar cancelación: estado → Rechazada + firma con motivo + notificación
  const ejecutarCancelacion=async()=>{
    if(!cancelSheet)return
    if(!cancelMotivo){alert("⚠ Seleccioná un motivo de cancelación.");return}
    if(!cancelDetalle||cancelDetalle.trim().length<10){alert("⚠ El detalle adicional debe tener al menos 10 caracteres.");return}
    if(cancelPagos.length>0&&!cancelConfirmado){alert("⚠ Hay pagos ejecutados. Debés marcar la casilla de confirmación antes de cancelar.");return}
    setCancelSaving(true)
    try{
      const oc=cancelSheet
      const pagosStr=cancelPagos.length>0?` · ALERTA ${cancelPagos.length} pagos ejecutados pendientes de gestionar reembolso`:""
      const accionFull=`Cancelada (${cancelMotivo}) — "${cancelDetalle.trim()}" · por ${cu?.nombre}${pagosStr}`
      await addFirma(oc.id,accionFull)
      await updOC(oc.id,{estado:"Rechazada"})
      // Notificar al siguiente destinatario (estado "Rechazada" en config_notificaciones)
      if(notificarFlujo){
        const pv=provs.find(p=>p.id===oc.proveedor_id)
        await notificarFlujo({
          ocId:oc.id,
          tipo:"Email",
          nuevoEstado:"Rechazada",
          asunto:`${oc.id} — OC CANCELADA por ${cu?.nombre}`,
          mensaje:`La orden de compra ${oc.id} al proveedor ${pv?.nombre||oc.proveedor_id} fue CANCELADA por ${cu?.nombre} (${cu?.rol}).\n\nMotivo: ${cancelMotivo}\nDetalle: ${cancelDetalle.trim()}\nMonto: ${fmt(oc.total_clp||0)}\n${cancelPagos.length>0?`\n⚠ ATENCIÓN: Esta OC tenía ${cancelPagos.length} pago(s) ejecutado(s). Gestionar reembolso con proveedor.\n`:""}\nRevisá el detalle en el sistema:\nhttps://outlet-compras.netlify.app`
        })
      }
      setCancelSheet(null); setCancelMotivo(""); setCancelDetalle(""); setCancelConfirmado(false); setCancelPagos([])
    }catch(e){
      alert("Error al cancelar: "+e.message)
      console.error(e)
    }
    setCancelSaving(false)
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
              {!["Cerrada","Rechazada"].includes(oc.estado)&&<button onClick={()=>abrirCancelar(oc)} style={{padding:"4px 8px",borderRadius:6,fontSize:10,fontWeight:600,border:"1px solid #FF9500",background:"#FF950012",color:"#FF9500",cursor:"pointer"}}>⊘ Cancelar OC</button>}
              <button onClick={()=>deleteOC(oc)} disabled={deleting===oc.id} style={{padding:"4px 8px",borderRadius:6,fontSize:10,fontWeight:600,border:"1px solid #FF3B30",background:"#FF3B3012",color:"#FF3B30",cursor:"pointer",opacity:deleting===oc.id?0.5:1}}>{deleting===oc.id?"...":"🗑 Eliminar"}</button>
            </div>}
          </div>
        </div>
        <Stp steps={isI?FI:FN} cur={oc.fase_actual}/>
        <div style={{fontSize:11,color:"#AEAEB2",marginBottom:8}}>{ocF.map((fi,i)=><span key={i}>{i>0?" → ":""}<strong style={{color:"#8E8E93"}}>{fi.nombre_usuario}</strong> ({fi.accion})</span>)}</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}} onClick={e=>e.stopPropagation()}>
          {oc.estado==="Pend. Dir. Negocios"&&h("aprobar_neg")&&<><Bt sm v="pri" onClick={()=>showComment===oc.id+"a"?firma(oc,"Aprobada Dir. Negocios",isI?"Proyectar costeo":"Pend. Dir. Finanzas",isI?3:2):setShowComment(oc.id+"a")} ic="✓">{showComment===oc.id+"a"?"Confirmar":"Aprobar"}</Bt><Bt sm v="dan" onClick={()=>showComment===oc.id+"r"?firma(oc,"Rechazada","Rechazada"):setShowComment(oc.id+"r")} ic="✕">{showComment===oc.id+"r"?"Confirmar rechazo":"Rechazar"}</Bt></>}
          {oc.estado==="Proyectar costeo"&&h("gest_imp")&&<Bt sm v="pur" onClick={()=>showComment===oc.id+"a"?firma(oc,"Costeo proyectado","Pend. Dir. Finanzas",4):setShowComment(oc.id+"a")} ic="🧮">{showComment===oc.id+"a"?"Confirmar":"Costeo proyectado"}</Bt>}
          {oc.estado==="Pend. Dir. Finanzas"&&h("aprobar_fin")&&<><Bt sm v="pur" onClick={()=>showComment===oc.id+"a"?firma(oc,"Aprobada Finanzas","Pend. proveedor",isI?5:3):setShowComment(oc.id+"a")} ic="✓">{showComment===oc.id+"a"?"Confirmar":"Presupuesto OK"}</Bt><Bt sm v="dan" onClick={()=>showComment===oc.id+"r"?firma(oc,"Rechazada","Rechazada"):setShowComment(oc.id+"r")} ic="✕">{showComment===oc.id+"r"?"Confirmar":"Rechazar"}</Bt></>}
          {oc.estado==="Pend. proveedor"&&h("valid_prov")&&<Bt sm v="suc" onClick={()=>setDet(oc)} ic="🔍">Validar proforma (requiere detalle)</Bt>}
          {oc.estado==="Confirmada prov."&&<Bt sm v="pri" onClick={()=>firma(oc,"En despacho","Despacho nac.",5)} ic="🚚">Despacho</Bt>}
          {oc.estado==="Despacho nac."&&h("recibir")&&<Bt sm v="amb" onClick={()=>setDet(oc)} ic="📦">Recepción</Bt>}
          {(oc.estado==="Recibida OK"||oc.estado==="Recibida parcial")&&h("cerrar_oc")&&<Bt sm v="gry" onClick={()=>firma(oc,"Cerrada","Cerrada",isI?12:7)} ic="■">Cerrar</Bt>}
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

    {/* ⭐ v48: Sheet de cancelación de OC (admin) */}
    <Sheet show={!!cancelSheet} onClose={()=>setCancelSheet(null)} title={`⊘ Cancelar OC ${cancelSheet?.id||""}`}>
      {cancelSheet&&<div>
        <div style={{background:"#FF950012",borderRadius:10,padding:12,marginBottom:14,border:"1px solid #FF950030"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#FF9500",marginBottom:4}}>⚠ Cancelación definitiva</div>
          <div style={{fontSize:12,color:"#3A3A3C"}}>La OC cambiará a estado <strong>Rechazada</strong> y no podrá revertirse por los usuarios regulares. Queda registro completo en auditoría con tu firma.</div>
        </div>

        {/* Info de la OC */}
        <div style={{padding:"10px 12px",background:"#F2F2F7",borderRadius:10,marginBottom:12,fontSize:12}}>
          <div><strong>Estado actual:</strong> {cancelSheet.estado}</div>
          <div><strong>Proveedor:</strong> {provs.find(p=>p.id===cancelSheet.proveedor_id)?.nombre||cancelSheet.proveedor_id}</div>
          <div><strong>Monto:</strong> {fmt(cancelSheet.total_clp||0)}{cancelSheet.total_usd>0?` (${fU(cancelSheet.total_usd)})`:""}</div>
        </div>

        {/* Alerta pagos ejecutados */}
        {cancelPagos.length>0&&<div style={{background:"#FF3B3010",borderRadius:10,padding:12,marginBottom:14,border:"2px solid #FF3B30"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#FF3B30",marginBottom:6}}>🚨 Esta OC tiene {cancelPagos.length} pago(s) ejecutado(s)</div>
          <div style={{fontSize:11,color:"#3A3A3C",marginBottom:8}}>Cancelar esta OC no revierte pagos automáticamente. Deberás gestionar reembolso o crédito con el proveedor por separado.</div>
          <div style={{fontSize:12}}>
            {cancelPagos.map(p=><div key={p.id} style={{padding:"4px 0",borderBottom:"1px solid #FF3B3020"}}>• {p.concepto}: <strong>{p.moneda==="USD"?fU(p.monto):fmt(p.monto)}</strong></div>)}
          </div>
        </div>}

        {/* Motivo */}
        <Fl l="Motivo de cancelación *">
          <select value={cancelMotivo} onChange={e=>setCancelMotivo(e.target.value)} style={css.select}>
            <option value="">— Seleccionar motivo —</option>
            <option value="Proveedor incumplió plazos">Proveedor incumplió plazos</option>
            <option value="Proveedor canceló la orden">Proveedor canceló la orden</option>
            <option value="Cliente final canceló">Cliente final canceló</option>
            <option value="Error en la solicitud original">Error en la solicitud original</option>
            <option value="Cambio de proveedor">Cambio de proveedor</option>
            <option value="Problema de calidad detectado">Problema de calidad detectado</option>
            <option value="Condiciones comerciales no aceptadas">Condiciones comerciales no aceptadas</option>
            <option value="Cambio de estrategia/prioridad">Cambio de estrategia/prioridad</option>
            <option value="Otro">Otro (especificar en detalle)</option>
          </select>
        </Fl>

        {/* Detalle */}
        <Fl l="Detalle adicional * (mínimo 10 caracteres)">
          <textarea value={cancelDetalle} onChange={e=>setCancelDetalle(e.target.value)} placeholder="Describí con claridad por qué se cancela esta OC. Este texto quedará registrado en la auditoría y en el email de notificación." style={{...css.input,minHeight:70,resize:"vertical",fontSize:13}}/>
        </Fl>

        {/* Checkbox confirmación definitiva si hay pagos */}
        {cancelPagos.length>0&&<div style={{padding:"10px 12px",background:cancelConfirmado?"#34C75912":"#FF3B3010",borderRadius:10,marginTop:8,marginBottom:8,border:`1px solid ${cancelConfirmado?"#34C759":"#FF3B30"}`}}>
          <label style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer"}}>
            <input type="checkbox" checked={cancelConfirmado} onChange={e=>setCancelConfirmado(e.target.checked)} style={{width:18,height:18,marginTop:2}}/>
            <div style={{fontSize:12,color:"#3A3A3C"}}>Confirmo que entiendo que esta OC tiene pagos ejecutados y que <strong>la cancelación NO revierte los pagos</strong>. Me comprometo a gestionar el reembolso o crédito con el proveedor por separado.</div>
          </label>
        </div>}

        {/* Botones */}
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <Bt v="gry" full onClick={()=>setCancelSheet(null)} dis={cancelSaving}>Volver</Bt>
          <Bt v="dan" full onClick={ejecutarCancelacion} dis={cancelSaving||!cancelMotivo||cancelDetalle.trim().length<10||(cancelPagos.length>0&&!cancelConfirmado)} ic={cancelSaving?"⏳":"⊘"}>{cancelSaving?"Cancelando...":"Cancelar OC definitivamente"}</Bt>
        </div>
      </div>}
    </Sheet>
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

        if(idsOriginales.includes(c.id)){
          // update existente (monto_clp es GENERATED, no se escribe)
          const upd={concepto:c.concepto,monto:Number(c.monto),moneda:c.moneda,fecha_programada:c.fecha_programada||null,pct:Number(c.pct)||0,orden:c.orden,tipo_cambio:c.moneda==="USD"?TC_USD:1}
          console.log("Actualizando pago:",c.id,upd)
          const{error:ue}=await supabase.from('pagos').update(upd).eq('id',c.id)
          if(ue){console.error("Error update pago:",ue);alert("Error actualizando cuota: "+ue.message);setSaving(false);return}
        }else{
          // insert nueva cuota (monto_clp es GENERATED, no se escribe)
          const ins={id:c.id,oc_id:oc.id,concepto:c.concepto,monto:Number(c.monto),moneda:c.moneda,fecha_programada:c.fecha_programada||null,estado:"Pendiente",etapa:c.concepto.toLowerCase().replace(/\s+/g,"_"),orden:c.orden,pct:Number(c.pct)||0,tipo_cambio:c.moneda==="USD"?TC_USD:1}
          console.log("Insertando pago:",ins)
          const{error:ie}=await supabase.from('pagos').insert(ins)
          if(ie){console.error("Error insert pago:",ie);alert("Error insertando cuota: "+ie.message);setSaving(false);return}
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
function OCDetView({oc,firmas,pagos,provs=[],updOC,addFirma,setPagos,close,cu,h,config={},notificarFlujo,ROL_POR_ESTADO={},setTab}){
  const TC_USD=Number(config.tc_usd)||950
  const[rf,setRf]=useState(hoy());const[rr,setRr]=useState(cu?.nombre||"Jefe Bodega");const[rd,setRd]=useState("");const isI=oc.tipo_oc==="Importación"
  const[items,setItems]=useState([]);const[recQty,setRecQty]=useState({});const[provQty,setProvQty]=useState({});const[provNotas,setProvNotas]=useState("")
  // ⭐ v48: Checkbox de confirmación explícita cantidad por cantidad
  const[provVerificado,setProvVerificado]=useState(false)
  const[docs,setDocs]=useState([]);const[uploading,setUploading]=useState(false);const[pendingFiles,setPendingFiles]=useState([]);const[saveMsg,setSaveMsg]=useState("")
  // ⭐ v47: comentario obligatorio para transiciones desde el detalle
  const[commentDet,setCommentDet]=useState("")
  useEffect(()=>{supabase.from('oc_items').select('*').eq('oc_id',oc.id).then(r=>{const d=r.data||[];setItems(d);const q={};const pq={};d.forEach(i=>{q[i.id]=i.cantidad_pedida||0;pq[i.id]=i.cantidad_confirmada||i.cantidad_pedida||0});setRecQty(q);setProvQty(pq)})},[oc.id])
  useEffect(()=>{supabase.from('documentos_import').select('*').eq('oc_id',oc.id).order('created_at',{ascending:false}).then(r=>{console.log("Loaded docs for OC:",oc.id,r.data?.length,"docs",r.error);setDocs(r.data||[])})},[oc.id])

  // ⭐ Recepciones parciales (guías + facturas)
  const prov=provs.find(p=>p.id===oc.proveedor_id)
  const facturaConGuia=prov?.factura_con_guia||false
  const[recepciones,setRecepciones]=useState([])
  const[costeos,setCosteos]=useState([])
  useEffect(()=>{if(!isI){setCosteos([]);return};supabase.from('costeos_oc').select('*').eq('oc_id',oc.id).order('created_at',{ascending:false}).then(r=>setCosteos(r.data||[]))},[oc.id])
  const eliminarCosteo=async(c)=>{
    // ⭐ v48: Protección de costeos cuando la OC está cerrada
    const ocEstaCerrada=oc.estado==="Cerrada"
    const esAdmin=cu?.rol==="admin"

    if(ocEstaCerrada&&!esAdmin){
      alert(`🔒 Costeo bloqueado\n\nNo podés eliminar este costeo porque la OC ${oc.id} está CERRADA.\n\nLos costeos de OCs cerradas son parte de la auditoría contable y solo el administrador puede modificarlos en casos excepcionales.`)
      return
    }

    // Caso admin sobre OC cerrada → flujo estricto con motivo
    if(ocEstaCerrada&&esAdmin){
      const motivo=window.prompt(`⚠ ELIMINACIÓN EXCEPCIONAL DE COSTEO PROTEGIDO\n\nLa OC ${oc.id} está CERRADA y este costeo forma parte del histórico auditado.\n\nIngresá el motivo de la eliminación (mínimo 15 caracteres). Quedará registrado en auditoría con tu firma.`)
      if(!motivo)return
      if(motivo.trim().length<15){alert("⚠ El motivo debe tener al menos 15 caracteres. Eliminación cancelada.");return}
      if(!window.confirm(`¿Confirmás la eliminación del costeo ${c.tipo_costeo||"proyectado"} del ${c.fecha}?\n\nMotivo: ${motivo.trim()}\n\nEsta acción NO se puede revertir.`))return
      await supabase.from('costeos_oc').delete().eq('id',c.id)
      setCosteos(prev=>prev.filter(x=>x.id!==c.id))
      await addFirma(oc.id,`🔓 Costeo ${c.tipo_costeo||"proyectado"} del ${c.fecha} ELIMINADO POR EXCEPCIÓN (OC cerrada) — Motivo: "${motivo.trim()}" — Por: ${cu?.nombre} (admin)`)
      return
    }

    // Caso normal (OC no cerrada): flujo estándar
    if(!window.confirm(`¿Eliminar este costeo del historial?\n\nFecha: ${c.fecha}\nTipo: ${c.tipo_costeo||"proyectado"}\nCosto unit. bodega: ${fmt(c.costo_unit_bodega)}`))return
    await supabase.from('costeos_oc').delete().eq('id',c.id)
    setCosteos(prev=>prev.filter(x=>x.id!==c.id))
    await addFirma(oc.id,`Costeo ${c.tipo_costeo||"proyectado"} del ${c.fecha} eliminado del historial por ${cu?.nombre}`)
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
    await updOC(oc.id,{total_clp:isI?Math.round(nuevoTotal*TC_USD):nuevoTotal,total_usd:isI?Math.round(nuevoTotal):0})
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
    await updOC(oc.id,{total_clp:isI?Math.round(nuevoTotal*TC_USD):nuevoTotal,total_usd:isI?Math.round(nuevoTotal):0})
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
    await updOC(oc.id,{total_clp:isI?Math.round(nuevoTotal*TC_USD):nuevoTotal,total_usd:isI?Math.round(nuevoTotal):0})
    await addFirma(oc.id,`Item agregado: ${newItem.sku||"MANUAL"} — ${newItem.producto} (${fN(newItem.cantidad_pedida)} × ${fmt(newItem.costo_unitario)})`)
    setNewItem({producto:"",sku:"",cantidad_pedida:0,costo_unitario:0});setAddingItem(false);setSavingEdit(false)
  }

  const firma=async(a,nE,nF)=>{
    // ⭐ v47: Comentario obligatorio en todas las transiciones desde el detalle
    const comment=commentDet.trim()
    if(!comment){alert("⚠ Debes ingresar un comentario para registrar esta acción.\n\nEscribí el comentario en el campo de abajo antes de presionar el botón.");return}
    // ⭐ v47: Costeo FINAL obligatorio antes de avanzar a "Validar costeo final"
    if(a==="Costeo final validado"){
      const{data:costeos,error:cErr}=await supabase.from('costeos_oc').select('id,tipo_costeo').eq('oc_id',oc.id).eq('tipo_costeo','final').limit(1)
      if(cErr){alert("Error verificando costeos finales: "+cErr.message);return}
      if(!costeos||costeos.length===0){
        alert(`⚠ No podés avanzar sin un costeo FINAL registrado.\n\nLa OC ${oc.id} ya tiene el costeo proyectado pero falta el costeo final con los gastos reales de internación.\n\nPasos:\n1. Abrí el módulo "Costeo IMP" en el menú inferior\n2. Seleccioná la OC ${oc.id}\n3. Actualizá los gastos con los valores reales\n4. Presioná "Anexar a OC" (se guardará como costeo FINAL porque la OC está en Internación)\n5. Volvé acá y presioná el botón de nuevo`)
        return
      }
    }
    const accionFull=`${a} — "${comment}"`
    await addFirma(oc.id,accionFull)
    await updOC(oc.id,{estado:nE,fase_actual:nF??oc.fase_actual})
    // ⭐ v48: Notificar al siguiente destinatario según config_notificaciones
    if(notificarFlujo&&nE){
      const pv=provs.find(p=>p.id===oc.proveedor_id)
      await notificarFlujo({
        ocId:oc.id,
        tipo:"Email",
        nuevoEstado:nE,
        asunto:`${oc.id} cambió a estado "${nE}"`,
        mensaje:`La orden de compra ${oc.id} al proveedor ${pv?.nombre||oc.proveedor_id} cambió al estado "${nE}".\n\nAcción previa: ${accionFull}\nActualizado por: ${cu?.nombre}\nMonto: ${fmt(oc.total_clp)}\n\nRevisá el detalle en el sistema:\nhttps://outlet-compras.netlify.app`
      })
    }
    setCommentDet("")
    close()
  }
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
    {isI&&(oc.estado==="Proyectar costeo"||oc.estado==="Validar costeo final")&&<div style={{background:oc.estado==="Proyectar costeo"?"linear-gradient(135deg,#5856D6,#AF52DE)":"linear-gradient(135deg,#5856D6,#007AFF)",borderRadius:12,padding:14,marginBottom:12,color:"#fff",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
      <div style={{flex:1,minWidth:240}}>
        <div style={{fontSize:11,fontWeight:700,opacity:0.8,textTransform:"uppercase",letterSpacing:0.5}}>{oc.estado==="Proyectar costeo"?"🧮 Etapa de proyección inicial":"🎯 Etapa de validación final"}</div>
        <div style={{fontSize:15,fontWeight:800,marginTop:2}}>{oc.estado==="Proyectar costeo"?"Proyección de costeo requerida":"Validación de costeo final"}</div>
        <div style={{fontSize:11,opacity:0.9,marginTop:2}}>{oc.estado==="Proyectar costeo"?"Antes de pasar a Finanzas, debe calcularse el costeo proyectado con gastos de internación, agente y márgenes.":"Ya internada: validá el costo real vs proyectado y ajustá márgenes si es necesario."}</div>
      </div>
      {setTab&&<button onClick={()=>{close();setTab("costeo")}} style={{padding:"10px 18px",borderRadius:10,fontSize:13,fontWeight:700,background:"#fff",color:"#5856D6",border:"none",cursor:"pointer",whiteSpace:"nowrap"}}>Abrir módulo de costeo →</button>}
    </div>}
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
      {isI&&<>
        <div style={{fontSize:12,fontWeight:700,color:"#5856D6",marginTop:14,marginBottom:6,textTransform:"uppercase"}}>📋 Documentos de importación</div>
        <FileUpload tipo="bl_naviera" label="Bill of Lading / BL" desc="Documento de embarque marítimo"/>
        <FileUpload tipo="din_aduana" label="DIN / Declaración aduana" desc="Declaración de Internación"/>
        <div style={{fontSize:12,fontWeight:700,color:"#FF9500",marginTop:14,marginBottom:6,textTransform:"uppercase"}}>💰 Comprobantes de pagos logísticos</div>
        <FileUpload tipo="pago_naviera" label="Pago a naviera" desc="Comprobante de pago del flete marítimo"/>
        <FileUpload tipo="pago_aduana" label="Pago aduana (IVA + arancel)" desc="Comprobante de pago de IVA y aranceles"/>
        <FileUpload tipo="provision_agente" label="Provisión agente de aduana" desc="Anticipo/provisión al agente para gestiones"/>
        <FileUpload tipo="pago_transporte_local" label="Pago transporte local" desc="Comprobante del flete puerto → bodega"/>
        <FileUpload tipo="pago_seguros" label="Pago seguros" desc="Comprobante de seguro de mercadería / terrestre"/>
      </>}
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
      <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>🔄 Validación de proforma{isI?" · cantidades + forma de pago":" · cantidades"}</div>
      <div style={{fontSize:12,color:"#8E8E93",marginBottom:12}}>Ajusta las cantidades según lo confirmado por el proveedor.{isI?" Verificá además que los % de pago (fab/emb/saldo) coincidan con la proforma recibida.":" Si hay quiebre de stock del proveedor o cantidades mínimas de venta, modifica la columna \"Confirmado\"."}</div>
      {isI&&<div style={{background:"#5856D608",borderLeft:"3px solid #5856D6",borderRadius:6,padding:"10px 12px",marginBottom:12,fontSize:12}}>
        <div style={{fontWeight:700,color:"#5856D6",marginBottom:6}}>💳 Plan de pago a validar contra proforma:</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
          <div><span style={{color:"#8E8E93"}}>Fabricación:</span> <b>{oc.pct_fab||0}%</b> ({fU(Math.round((oc.total_usd||0)*(oc.pct_fab||0)/100))})</div>
          <div><span style={{color:"#8E8E93"}}>Embarque:</span> <b>{oc.pct_embarque||0}%</b> ({fU(Math.round((oc.total_usd||0)*(oc.pct_embarque||0)/100))})</div>
          <div><span style={{color:"#8E8E93"}}>Saldo/puerto:</span> <b>{oc.pct_puerto||0}%</b> ({fU(Math.round((oc.total_usd||0)*(oc.pct_puerto||0)/100))})</div>
        </div>
        {((oc.pct_fab||0)+(oc.pct_embarque||0)+(oc.pct_puerto||0))!==100&&<div style={{color:"#FF3B30",marginTop:8,fontWeight:600}}>⚠ Los % no suman 100%. Revisá el plan de pago antes de confirmar.</div>}
      </div>}
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
      <Fl l="Notas del proveedor"><input value={provNotas} onChange={e=>setProvNotas(e.target.value)} placeholder="Motivo del ajuste (quiebre stock, mínimo de compra, % pago ajustado, etc.)..." style={css.input}/></Fl>

      {/* ⭐ v48: Checkbox obligatorio de verificación item por item */}
      <div style={{background:provVerificado?"#34C75910":"#FF3B3010",borderRadius:10,padding:"12px 14px",marginTop:10,marginBottom:12,border:`2px solid ${provVerificado?"#34C759":"#FF3B30"}`,transition:"all 0.2s"}}>
        <label style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer"}}>
          <input type="checkbox" checked={provVerificado} onChange={e=>setProvVerificado(e.target.checked)} style={{width:20,height:20,marginTop:2,cursor:"pointer"}}/>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:provVerificado?"#34C759":"#FF3B30",marginBottom:3}}>He verificado cantidad por cantidad contra la proforma recibida del proveedor</div>
            <div style={{fontSize:11,color:"#8E8E93"}}>Al marcar esta casilla confirmás que revisaste cada línea de la tabla y que las cantidades "Confirmado" coinciden con lo que envió el proveedor por escrito (proforma, correo, sistema del proveedor). Esto quedará registrado en la firma digital.</div>
          </div>
        </label>
      </div>

      <Bt v="suc" full dis={!provVerificado} onClick={async()=>{
        if(!provVerificado){alert("⚠ Debés marcar la casilla de verificación antes de confirmar.");return}
        // Validación adicional para IMP: confirmar forma de pago
        if(isI){
          const sumaPct=(oc.pct_fab||0)+(oc.pct_embarque||0)+(oc.pct_puerto||0)
          if(sumaPct!==100){if(!window.confirm(`⚠ Los porcentajes de pago suman ${sumaPct}% (debería ser 100%).\n\n¿Confirmar de todos modos? (podrás ajustarlos desde el editor de plan de pago)`))return}
          if(!window.confirm(`✓ Confirmar proforma con:\n\n• ${items.length} productos (${items.some(i=>Number(provQty[i.id]||0)!==(i.cantidad_pedida||0))?"con ajustes":"sin ajustes"})\n• Pagos: ${oc.pct_fab}% fab + ${oc.pct_embarque}% emb + ${oc.pct_puerto}% saldo\n• Total: ${fU(oc.total_usd||0)}`))return
        }else{
          if(!window.confirm(`✓ Confirmar proforma con:\n\n• ${items.length} productos (${items.some(i=>Number(provQty[i.id]||0)!==(i.cantidad_pedida||0))?"con ajustes":"sin ajustes"})\n• Total: ${fmt(oc.total_clp||0)}`))return
        }
        // Update each item with confirmed quantity
        for(const i of items){
          const conf=Number(provQty[i.id]||i.cantidad_pedida)
          await supabase.from('oc_items').update({cantidad_confirmada:conf}).eq('id',i.id)
        }
        // Recalculate total
        const newTotal=items.reduce((s,i)=>s+(Number(provQty[i.id]||i.cantidad_pedida)*(i.costo_unitario||0)),0)
        const adj=items.filter(i=>Number(provQty[i.id]||0)!==(i.cantidad_pedida||0)).map(i=>`${i.producto}: ${i.cantidad_pedida}→${provQty[i.id]}`).join(", ")
        const planPagoStr=isI?` · Plan: ${oc.pct_fab}%/${oc.pct_embarque}%/${oc.pct_puerto}%`:""
        const verificadoStr=` · Verificado item×item por ${cu?.nombre||"usuario"}`
        const accionFull=`Proforma confirmada${adj?" (ajustes: "+adj+")":""}${planPagoStr}${provNotas?" — "+provNotas:""}${verificadoStr}`
        await addFirma(oc.id,accionFull)
        const nuevoEstado=isI?"Proforma OK":"Confirmada prov."
        await updOC(oc.id,{estado:nuevoEstado,fase_actual:isI?6:4,total_clp:isI?Math.round(newTotal*TC_USD):newTotal,total_usd:isI?Math.round(newTotal):(oc.total_usd||0)})
        // ⭐ v48: Notificar al siguiente destinatario del flujo
        if(notificarFlujo){
          const pv=provs.find(p=>p.id===oc.proveedor_id)
          await notificarFlujo({
            ocId:oc.id,
            tipo:"Email",
            nuevoEstado:nuevoEstado,
            asunto:`${oc.id} — Proforma confirmada (${nuevoEstado})`,
            mensaje:`La proforma de ${pv?.nombre||oc.proveedor_id} fue confirmada por ${cu?.nombre}.\n\n${accionFull}\n\nEstado actualizado: ${nuevoEstado}\nMonto: ${isI?fU(Math.round(newTotal)):fmt(newTotal)}\n\nRevisá el detalle en el sistema:\nhttps://outlet-compras.netlify.app`
          })
        }
        close()
      }} ic="✓">{provVerificado?"Confirmar proforma del proveedor":"⚠ Marcá la casilla de verificación"}</Bt>
    </div>}

    {/* ⭐ v47: Campo de comentario obligatorio para transiciones */}
    {oc.estado&&!["Cerrada","Rechazada"].includes(oc.estado)&&<div style={{marginTop:16,padding:"10px 12px",background:"#FFF9E6",borderRadius:10,border:"1px solid #FFE082"}}>
      <div style={{fontSize:11,fontWeight:700,color:"#8B6914",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.04em"}}>✎ Comentario de acción (obligatorio)</div>
      <textarea value={commentDet} onChange={e=>setCommentDet(e.target.value)} placeholder="Describí el motivo o detalle de esta acción (requerido para avanzar la OC)..." style={{...css.input,minHeight:50,resize:"vertical",fontSize:13}}/>
    </div>}

    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:16}}>
      {isI&&oc.estado==="Proforma OK"&&h("reg_pago")&&<Bt v="amb" onClick={async()=>{await regP("Fab. "+oc.pct_fab+"%",Math.round((oc.total_usd||0)*oc.pct_fab/100),"USD");await firma("Pago fabricación","Pago fabricación",6)}} ic="💰">Pago fabricación</Bt>}
      {isI&&oc.estado==="Pago fabricación"&&h("reg_pago")&&oc.pct_embarque>0&&<Bt v="amb" onClick={async()=>{await regP("Emb. "+oc.pct_embarque+"%",Math.round((oc.total_usd||0)*oc.pct_embarque/100),"USD");await firma("Pago embarque","Pago embarque",7)}} ic="💰">Pago embarque</Bt>}
      {isI&&(oc.estado==="Pago embarque"||(oc.estado==="Pago fabricación"&&!oc.pct_embarque))&&<Bt v="pur" onClick={()=>firma("Internación iniciada","Internación",8)} ic="📋">Internación</Bt>}
      {isI&&oc.estado==="Internación"&&h("gest_imp")&&<Bt v="pur" onClick={()=>firma("Costeo final validado","Validar costeo final",9)} ic="🎯">Validar costeo final</Bt>}
      {isI&&oc.estado==="Validar costeo final"&&<Bt v="pri" onClick={()=>firma("Transporte iniciado","Transporte",10)} ic="🚛">Transporte</Bt>}
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
                {c.tipo_costeo==="final"?<Bd c="#FF3B30" bg="#FF3B3015">🎯 Final</Bd>:<Bd c="#5856D6" bg="#5856D615">🧮 Proyectado</Bd>}
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
              {/* ⭐ v48: Botón eliminar con protección cuando OC está cerrada */}
              {(() => {
                const ocCerrada=oc.estado==="Cerrada"
                const esAdmin=cu?.rol==="admin"
                const puedeVerBoton=esAdmin||c.registrado_por===cu?.id
                if(!puedeVerBoton)return null
                if(ocCerrada&&!esAdmin){
                  return <button disabled style={{padding:"5px 10px",fontSize:11,background:"#8E8E9315",color:"#8E8E93",border:"1px solid #8E8E9330",borderRadius:6,cursor:"not-allowed",fontWeight:600}} title="Costeo bloqueado: OC cerrada">🔒</button>
                }
                if(ocCerrada&&esAdmin){
                  return <button onClick={()=>eliminarCosteo(c)} style={{padding:"5px 10px",fontSize:11,background:"#FF950015",color:"#FF9500",border:"1px solid #FF950050",borderRadius:6,cursor:"pointer",fontWeight:600}} title="Eliminar por excepción (OC cerrada — requiere motivo)">🔓 Eliminar</button>
                }
                return <button onClick={()=>eliminarCosteo(c)} style={{padding:"5px 10px",fontSize:11,background:"#FF3B3015",color:"#FF3B30",border:"1px solid #FF3B3030",borderRadius:6,cursor:"pointer",fontWeight:600}} title="Eliminar">🗑</button>
              })()}
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
/* ═══ COBERTURA — Heatmap matricial de cobertura (v48 redesign) ═══
   Matriz: filas = items (ABCD/tipo/SKU), columnas = meses futuros.
   Cada celda muestra el % de cobertura de ese mes (stock esperado / demanda esperada).
   Color: verde (cubre), amarillo (ajustado), naranja (crítico), rojo (quiebre), gris (sin venta).
*/
function CoberturaView({prods=[],ocs=[],config={}}){
  const[nivel,setNivel]=useLocalState("cob_nivel","tipo") // abcd | tipo | sku
  const[metodo,setMetodo]=useLocalState("cob_metodo","compensada") // compensada | simple
  const[horizonte,setHorizonte]=useLocalState("cob_horizonte",6) // 3/6/12/18 meses
  const[abcdSel,setAbcdSel]=useLocalState("cob_abcdSel",{A:true,B:true,C:true,D:false})
  const[tipoSel,setTipoSel]=useLocalState("cob_tipoSel","")
  const[qSku,setQSku]=useLocalState("cob_qSku","")
  const[incluirTransito,setIncluirTransito]=useLocalState("cob_transito",true)
  const[expanded,setExpanded]=useState({})
  const[hoverCell,setHoverCell]=useState(null)
  const[ordenarPor,setOrdenarPor]=useLocalState("cob_orden","criticidad") // criticidad | venta | nombre

  const hoyDate=new Date()

  // ⭐ v48: Venta promedio diaria — respeta config.excluir_mes_actual
  const excluirActual=config.excluir_mes_actual!=="false" // default ON
  const totalMeses=Number(config.meses_analisis)||4
  const mesesValidos=excluirActual?Math.max(1,totalMeses-1):totalMeses // cantidad real de meses a considerar

  const ventaDia=(p)=>{
    const raw=[p.venta_mes_1,p.venta_mes_2,p.venta_mes_3,p.venta_mes_4].slice(0,totalMeses)
    // Si excluirActual: dejamos fuera el último mes (mes en curso)
    const consider=excluirActual?raw.slice(0,mesesValidos):raw
    const limpios=consider.filter(v=>v!==null&&v!==undefined).map(v=>Number(v||0))
    if(metodo==="compensada"){
      // Compensada: excluye meses de quiebre (definidos como <30% del máximo)
      const maxV=limpios.length>0?Math.max(...limpios):0
      const umbral=maxV*0.3
      const normal=limpios.filter(v=>v>=umbral&&v>0)
      const base=normal.length>=2?normal:limpios.filter(v=>v>0)
      const prom=base.length>0?base.reduce((s,v)=>s+v,0)/base.length:0
      return prom/30
    }else{
      // Simple: promedio sobre los meses considerados (excluyendo los vacíos)
      const usables=limpios.filter(v=>v>0)
      const prom=usables.length>0?usables.reduce((s,v)=>s+v,0)/usables.length:0
      return prom/30
    }
  }
  const ventaMes=(p)=>ventaDia(p)*30

  // Productos filtrados
  const prodsBase=useMemo(()=>prods.filter(p=>{
    if(!abcdSel[p.clasif_abcd])return false
    if(tipoSel&&p.tipo_producto!==tipoSel)return false
    if(qSku&&!((p.sku||"").toLowerCase().includes(qSku.toLowerCase())||(p.producto||"").toLowerCase().includes(qSku.toLowerCase())))return false
    return (p.stock_actual||0)>0||(p.venta_total||0)>0
  }),[prods,abcdSel,tipoSel,qSku])

  // Generar meses futuros
  const meses=useMemo(()=>{
    const arr=[]
    for(let i=0;i<horizonte;i++){
      const d=new Date(hoyDate.getFullYear(),hoyDate.getMonth()+i,1)
      arr.push({
        idx:i,
        label:d.toLocaleDateString("es-CL",{month:"short"}).toUpperCase().replace(".",""),
        year:d.getFullYear(),
        month:d.getMonth(),
        ymKey:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`
      })
    }
    return arr
  },[horizonte])

  // Llegadas proyectadas de OCs por mes: Map<ymKey, total_unidades>
  // OCs en tránsito (no cerradas, no rechazadas) con fecha_estimada caen en el mes correspondiente
  const llegadasPorMes=useMemo(()=>{
    const map={}
    if(!incluirTransito)return map
    ocs.forEach(o=>{
      if(!o.fecha_estimada)return
      if(["Cerrada","Rechazada","Recibida OK"].includes(o.estado))return
      const d=new Date(o.fecha_estimada+"T00:00:00")
      const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`
      // Para cada OC sumamos sus items por SKU
      // Pero oc_items no está en este scope, entonces aproximamos por stock_transito del producto
    })
    return map
  },[ocs,incluirTransito])

  // Calcular para un producto individual el stock proyectado al INICIO de cada mes
  const proyectarProd=(p)=>{
    const stockInicial=(p.stock_actual||0)+(incluirTransito?(p.stock_transito||0):0)
    const vd=ventaDia(p)
    const vm=vd*30
    const result=[]
    let stock=stockInicial
    meses.forEach((m,i)=>{
      const stockAntes=stock
      const demanda=vm
      stock=Math.max(0,stock-demanda)
      // Cobertura del mes: qué porcentaje de la demanda del mes pudo cubrirse
      const cobertura=demanda>0?Math.min(1,stockAntes/demanda):(stockAntes>0?1:0)
      result.push({
        mes:m,
        stockInicio:stockAntes,
        demanda,
        cobertura,
        stockFin:stock,
        sinVenta:vd<=0
      })
    })
    return{stockInicial,ventaDia:vd,ventaMes:vm,celdas:result}
  }

  // Agregar datos a nivel ABCD o tipo
  const agrupar=(key)=>{
    const groups={}
    prodsBase.forEach(p=>{
      const k=(key==="abcd"?p.clasif_abcd:p.tipo_producto)||"Sin clasificar"
      if(!groups[k])groups[k]={prods:[],stockInicial:0,ventaDia:0,ventaMes:0}
      const proy=proyectarProd(p)
      groups[k].prods.push({p,proy})
      groups[k].stockInicial+=proy.stockInicial
      groups[k].ventaDia+=proy.ventaDia
      groups[k].ventaMes+=proy.ventaMes
    })
    // Calcular celdas agregadas (sumas de stock y demanda)
    return Object.entries(groups).map(([k,g])=>{
      const celdas=meses.map((m,i)=>{
        const stockAntes=g.prods.reduce((s,x)=>s+(x.proy.celdas[i]?.stockInicio||0),0)
        const demanda=g.prods.reduce((s,x)=>s+(x.proy.celdas[i]?.demanda||0),0)
        const stockFin=g.prods.reduce((s,x)=>s+(x.proy.celdas[i]?.stockFin||0),0)
        const cobertura=demanda>0?Math.min(1,stockAntes/demanda):(stockAntes>0?1:0)
        return{mes:m,stockInicio:stockAntes,demanda,cobertura,stockFin,sinVenta:g.ventaDia<=0}
      })
      return{
        key:k,
        label:key==="abcd"?`Clase ${k}`:k,
        abcd:key==="abcd"?k:null,
        nProds:g.prods.length,
        stockInicial:g.stockInicial,
        ventaDia:g.ventaDia,
        ventaMes:g.ventaMes,
        celdas,
        esGrupo:true,
        prods:g.prods
      }
    })
  }

  // Filas a mostrar según nivel seleccionado
  const filas=useMemo(()=>{
    let arr=[]
    if(nivel==="sku"){
      arr=prodsBase.map(p=>{
        const proy=proyectarProd(p)
        return{
          key:p.sku||p.producto,
          label:p.producto,
          sub:`${p.sku||""} · ${p.tipo_producto||""} · Clase ${p.clasif_abcd||"-"}`,
          abcd:p.clasif_abcd,
          nProds:1,
          stockInicial:proy.stockInicial,
          ventaDia:proy.ventaDia,
          ventaMes:proy.ventaMes,
          celdas:proy.celdas,
          esGrupo:false,
          prod:p
        }
      })
    }else{
      arr=agrupar(nivel)
    }
    // Ordenar
    if(ordenarPor==="criticidad"){
      arr.sort((a,b)=>{
        // primera celda con cobertura <1 → más crítico = menor índice
        const idxA=a.celdas.findIndex(c=>!c.sinVenta&&c.cobertura<1)
        const idxB=b.celdas.findIndex(c=>!c.sinVenta&&c.cobertura<1)
        const vA=idxA<0?horizonte+1:idxA
        const vB=idxB<0?horizonte+1:idxB
        if(vA!==vB)return vA-vB
        return b.ventaMes-a.ventaMes
      })
    }else if(ordenarPor==="venta"){
      arr.sort((a,b)=>b.ventaMes-a.ventaMes)
    }else{
      arr.sort((a,b)=>a.label.localeCompare(b.label))
    }
    // En nivel abcd, priorizar orden A<B<C<D
    if(nivel==="abcd"){
      const o={A:0,B:1,C:2,D:3}
      arr.sort((a,b)=>(o[a.key]??9)-(o[b.key]??9))
    }
    return arr
  },[prodsBase,nivel,meses,metodo,incluirTransito,ordenarPor])

  const tiposUnicos=[...new Set(prods.map(p=>p.tipo_producto).filter(Boolean))].sort()

  // Color de celda según cobertura (0-1+)
  const colorCelda=(cel)=>{
    if(cel.sinVenta)return{bg:"#F2F2F7",c:"#8E8E93",label:"—"}
    if(cel.cobertura>=1)return{bg:"#34C759",c:"#fff",label:"✓"}
    if(cel.cobertura>=0.75)return{bg:"#A7E3B8",c:"#1C5E2E",label:Math.round(cel.cobertura*100)+"%"}
    if(cel.cobertura>=0.5)return{bg:"#FFD60A",c:"#5A4600",label:Math.round(cel.cobertura*100)+"%"}
    if(cel.cobertura>=0.25)return{bg:"#FF9500",c:"#fff",label:Math.round(cel.cobertura*100)+"%"}
    if(cel.cobertura>0)return{bg:"#FF3B30",c:"#fff",label:Math.round(cel.cobertura*100)+"%"}
    return{bg:"#4B0000",c:"#fff",label:"0"}
  }

  // Resumen total
  const resumen=useMemo(()=>{
    const totVenta=filas.reduce((s,f)=>s+f.ventaMes,0)
    const totStock=filas.reduce((s,f)=>s+f.stockInicial,0)
    // cuántos items tienen quiebre antes del horizonte
    const conQuiebre=filas.filter(f=>f.celdas.some(c=>!c.sinVenta&&c.cobertura<1)).length
    const cubreTodo=filas.filter(f=>f.celdas.every(c=>c.sinVenta||c.cobertura>=1)&&f.celdas.some(c=>!c.sinVenta)).length
    return{totVenta:Math.round(totVenta),totStock:Math.round(totStock),conQuiebre,cubreTodo,sinVenta:filas.filter(f=>f.ventaDia<=0).length}
  },[filas])

  return<div onMouseLeave={()=>setHoverCell(null)}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:12,flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontSize:22,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>📅 Calendario de Cobertura</div>
        <div style={{fontSize:12,color:"#8E8E93"}}>Heatmap mensual por {nivel==="abcd"?"clase ABCD":nivel==="tipo"?"tipo de producto":"SKU"}. Cada celda muestra el % de demanda mensual cubierto por stock + tránsito. Pasá el mouse sobre una celda para ver el detalle.</div>
        <div style={{marginTop:6,display:"inline-flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:6,background:excluirActual?"#FF950015":"#8E8E9315",color:excluirActual?"#FF9500":"#8E8E93",fontSize:11,fontWeight:600}}>
          {excluirActual?"⊘":"◉"} Demanda calculada con {mesesValidos} de {totalMeses} meses {excluirActual?"(el mes en curso se excluye por estar parcial)":"(incluye el mes en curso completo)"}
        </div>
      </div>
    </div>

    {/* FILTROS */}
    <Cd s={{marginBottom:12}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",marginBottom:4}}>Nivel</div>
          <select value={nivel} onChange={e=>setNivel(e.target.value)} style={css.select}>
            <option value="abcd">Por clase ABCD</option>
            <option value="tipo">Por tipo de producto</option>
            <option value="sku">Por SKU individual</option>
          </select>
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",marginBottom:4}}>Método de venta</div>
          <select value={metodo} onChange={e=>setMetodo(e.target.value)} style={css.select}>
            <option value="compensada">Compensada (excluye quiebres)</option>
            <option value="simple">Simple (prom. 4 meses)</option>
          </select>
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",marginBottom:4}}>Horizonte</div>
          <select value={horizonte} onChange={e=>setHorizonte(Number(e.target.value))} style={css.select}>
            <option value={3}>3 meses</option>
            <option value={6}>6 meses</option>
            <option value={12}>12 meses</option>
            <option value={18}>18 meses</option>
          </select>
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",marginBottom:4}}>Tipo</div>
          <select value={tipoSel} onChange={e=>setTipoSel(e.target.value)} style={css.select}>
            <option value="">Todos los tipos</option>
            {tiposUnicos.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",marginBottom:4}}>Ordenar por</div>
          <select value={ordenarPor} onChange={e=>setOrdenarPor(e.target.value)} style={css.select}>
            <option value="criticidad">Criticidad (primero los que quiebran antes)</option>
            <option value="venta">Mayor venta mensual</option>
            <option value="nombre">Nombre alfabético</option>
          </select>
        </div>
      </div>
      <div style={{display:"flex",gap:12,marginTop:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#8E8E93",textTransform:"uppercase"}}>ABCD:</div>
        {["A","B","C","D"].map(k=><label key={k} style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",padding:"4px 10px",borderRadius:6,background:abcdSel[k]?(CL[k]?.bg||"#007AFF15"):"#F2F2F7",color:abcdSel[k]?(CL[k]?.c||"#007AFF"):"#8E8E93",fontSize:12,fontWeight:600}}>
          <input type="checkbox" checked={!!abcdSel[k]} onChange={e=>setAbcdSel(p=>({...p,[k]:e.target.checked}))} style={{width:14,height:14}}/>
          Clase {k}
        </label>)}
        <label style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",padding:"4px 10px",borderRadius:6,background:incluirTransito?"#007AFF15":"#F2F2F7",color:incluirTransito?"#007AFF":"#8E8E93",fontSize:12,fontWeight:600}}>
          <input type="checkbox" checked={incluirTransito} onChange={e=>setIncluirTransito(e.target.checked)} style={{width:14,height:14}}/>
          Incluir tránsito
        </label>
        {nivel==="sku"&&<input placeholder="Buscar SKU o producto..." value={qSku} onChange={e=>setQSku(e.target.value)} style={{...css.input,flex:"1 1 200px",fontSize:12,padding:"6px 10px"}}/>}
      </div>
    </Cd>

    {/* LEYENDA */}
    <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:11,marginBottom:10,padding:"10px 14px",background:"#fff",borderRadius:8,alignItems:"center"}}>
      <span style={{fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase"}}>Cobertura:</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:14,height:14,background:"#34C759",borderRadius:3}}/>100%+</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:14,height:14,background:"#A7E3B8",borderRadius:3}}/>75-99%</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:14,height:14,background:"#FFD60A",borderRadius:3}}/>50-74%</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:14,height:14,background:"#FF9500",borderRadius:3}}/>25-49%</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:14,height:14,background:"#FF3B30",borderRadius:3}}/>1-24%</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:14,height:14,background:"#4B0000",borderRadius:3}}/>0% (quiebre)</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:14,height:14,background:"#F2F2F7",borderRadius:3,border:"1px solid #E5E5EA"}}/>Sin venta</span>
    </div>

    {/* RESUMEN */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:12}}>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #007AFF"}}>
        <div style={{fontSize:10,color:"#8E8E93",fontWeight:600,textTransform:"uppercase"}}>Ítems mostrados</div>
        <div style={{fontSize:20,fontWeight:800}}>{filas.length}</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #34C759"}}>
        <div style={{fontSize:10,color:"#34C759",fontWeight:600,textTransform:"uppercase"}}>Cubren horizonte</div>
        <div style={{fontSize:20,fontWeight:800,color:"#34C759"}}>{resumen.cubreTodo}</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #FF3B30"}}>
        <div style={{fontSize:10,color:"#FF3B30",fontWeight:600,textTransform:"uppercase"}}>Con quiebre</div>
        <div style={{fontSize:20,fontWeight:800,color:"#FF3B30"}}>{resumen.conQuiebre}</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #AF52DE"}}>
        <div style={{fontSize:10,color:"#AF52DE",fontWeight:600,textTransform:"uppercase"}}>Venta/mes agregada</div>
        <div style={{fontSize:20,fontWeight:800,color:"#AF52DE"}}>{fN(resumen.totVenta)}</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #30B0C7"}}>
        <div style={{fontSize:10,color:"#30B0C7",fontWeight:600,textTransform:"uppercase"}}>Stock+Tránsito</div>
        <div style={{fontSize:20,fontWeight:800,color:"#30B0C7"}}>{fN(resumen.totStock)}</div>
      </div>
    </div>

    {/* HEATMAP */}
    <Cd>
      {filas.length===0?<div style={{padding:30,textAlign:"center",color:"#8E8E93"}}>No hay productos que cumplan los filtros.</div>:
      <div style={{overflow:"auto",position:"relative"}}>
        <table style={{borderCollapse:"separate",borderSpacing:3,width:"100%",minWidth:800}}>
          <thead>
            <tr>
              <th style={{textAlign:"left",fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",padding:"4px 8px",position:"sticky",left:0,background:"#fff",zIndex:2,minWidth:260}}>Ítem / Demanda</th>
              <th style={{textAlign:"right",fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",padding:"4px 6px",minWidth:90}}>Stock+Trans</th>
              {meses.map(m=><th key={m.idx} style={{fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",textAlign:"center",padding:"4px 2px",minWidth:60}}>
                <div>{m.label}</div>
                <div style={{fontSize:9,color:"#AEAEB2"}}>'{String(m.year).slice(2)}</div>
              </th>)}
            </tr>
          </thead>
          <tbody>
            {filas.map(fila=>{
              const abcdColor=fila.abcd?CL[fila.abcd]:null
              const expandable=fila.esGrupo&&nivel!=="sku"
              const estaExpandido=!!expanded[fila.key]
              return<>
                <tr key={fila.key}>
                  <td style={{padding:"6px 8px",background:"#fff",position:"sticky",left:0,zIndex:1,borderBottom:"1px solid #F2F2F7"}} onClick={()=>{if(expandable)setExpanded(p=>({...p,[fila.key]:!p[fila.key]}))}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,cursor:expandable?"pointer":"default"}}>
                      {expandable&&<span style={{fontSize:10,color:"#8E8E93",width:10}}>{estaExpandido?"▼":"▶"}</span>}
                      {abcdColor&&<span style={{fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:4,background:abcdColor.bg,color:abcdColor.c}}>{fila.abcd}</span>}
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fila.label}</div>
                        <div style={{fontSize:10,color:"#AEAEB2",marginTop:1}}>
                          {fila.nProds>1?`${fila.nProds} SKU · `:""}
                          <span style={{color:"#5856D6",fontWeight:600}}>Venta/mes: {fN(fila.ventaMes)}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{textAlign:"right",padding:"6px",fontSize:12,fontWeight:700,color:"#30B0C7",borderBottom:"1px solid #F2F2F7"}}>{fN(fila.stockInicial)}</td>
                  {fila.celdas.map((cel,i)=>{
                    const col=colorCelda(cel)
                    const cellKey=`${fila.key}-${i}`
                    const isHover=hoverCell===cellKey
                    return<td key={i} style={{padding:0,borderBottom:"1px solid #F2F2F7"}}>
                      <div
                        onMouseEnter={()=>setHoverCell(cellKey)}
                        onMouseLeave={()=>setHoverCell(null)}
                        style={{
                          background:col.bg,
                          color:col.c,
                          borderRadius:6,
                          padding:"8px 4px",
                          textAlign:"center",
                          fontSize:11,
                          fontWeight:700,
                          minHeight:44,
                          display:"flex",
                          flexDirection:"column",
                          justifyContent:"center",
                          alignItems:"center",
                          position:"relative",
                          transform:isHover?"scale(1.08)":"scale(1)",
                          transition:"transform 0.15s",
                          boxShadow:isHover?"0 4px 12px rgba(0,0,0,0.15)":"none",
                          cursor:"help"
                        }}>
                        <div>{col.label}</div>
                        {!cel.sinVenta&&fila.ventaDia>0&&<div style={{fontSize:9,opacity:0.85,marginTop:2}}>{fN(cel.stockInicio)}u</div>}
                        {isHover&&<div style={{position:"absolute",bottom:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)",background:"#1C1C1E",color:"#fff",padding:"8px 10px",borderRadius:6,fontSize:11,whiteSpace:"nowrap",zIndex:10,fontWeight:500,pointerEvents:"none",boxShadow:"0 4px 12px rgba(0,0,0,0.3)"}}>
                          <div style={{fontWeight:700,marginBottom:3,fontSize:12}}>{cel.mes.label} {cel.mes.year}</div>
                          {cel.sinVenta?<div>Sin venta registrada</div>:<>
                            <div>Stock inicio: <b>{fN(cel.stockInicio)}</b>u</div>
                            <div>Demanda mes: <b>{fN(cel.demanda)}</b>u</div>
                            <div>Stock fin: <b>{fN(cel.stockFin)}</b>u</div>
                            <div style={{marginTop:3,color:col.bg==="#34C759"?"#A7E3B8":"#FFD60A"}}>Cobertura: <b>{Math.round(cel.cobertura*100)}%</b></div>
                          </>}
                        </div>}
                      </div>
                    </td>
                  })}
                </tr>
                {/* Sub-filas al expandir */}
                {expandable&&estaExpandido&&fila.prods.slice(0,25).map(({p,proy})=>{
                  const vMes=proy.ventaMes
                  return<tr key={fila.key+"-"+p.sku}>
                    <td style={{padding:"4px 8px 4px 32px",background:"#FAFAFA",position:"sticky",left:0,zIndex:1,borderBottom:"1px solid #F2F2F7"}}>
                      <div style={{fontSize:11,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.producto}</div>
                      <div style={{fontSize:9,color:"#AEAEB2",marginTop:1}}>{p.sku} · <span style={{color:"#5856D6"}}>{fN(vMes)}/mes</span></div>
                    </td>
                    <td style={{textAlign:"right",padding:"4px 6px",fontSize:11,fontWeight:600,color:"#30B0C7",borderBottom:"1px solid #F2F2F7",background:"#FAFAFA"}}>{fN(proy.stockInicial)}</td>
                    {proy.celdas.map((cel,i)=>{
                      const col=colorCelda(cel)
                      const cellKey=`${fila.key}-${p.sku}-${i}`
                      const isHover=hoverCell===cellKey
                      return<td key={i} style={{padding:0,borderBottom:"1px solid #F2F2F7",background:"#FAFAFA"}}>
                        <div
                          onMouseEnter={()=>setHoverCell(cellKey)}
                          onMouseLeave={()=>setHoverCell(null)}
                          style={{
                            background:col.bg,color:col.c,borderRadius:4,padding:"5px 3px",textAlign:"center",fontSize:10,fontWeight:700,minHeight:32,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",opacity:0.88,position:"relative",
                            transform:isHover?"scale(1.1)":"scale(1)",transition:"transform 0.15s",cursor:"help"
                          }}>
                          <div>{col.label}</div>
                          {isHover&&<div style={{position:"absolute",bottom:"calc(100% + 4px)",left:"50%",transform:"translateX(-50%)",background:"#1C1C1E",color:"#fff",padding:"6px 8px",borderRadius:5,fontSize:10,whiteSpace:"nowrap",zIndex:10,fontWeight:500,pointerEvents:"none",boxShadow:"0 4px 12px rgba(0,0,0,0.3)"}}>
                            <div style={{fontWeight:700,marginBottom:2}}>{cel.mes.label} {cel.mes.year}</div>
                            {cel.sinVenta?<div>Sin venta</div>:<>
                              <div>Stock: <b>{fN(cel.stockInicio)}</b> → <b>{fN(cel.stockFin)}</b></div>
                              <div>Demanda: <b>{fN(cel.demanda)}</b></div>
                              <div>Cobertura: <b>{Math.round(cel.cobertura*100)}%</b></div>
                            </>}
                          </div>}
                        </div>
                      </td>
                    })}
                  </tr>
                })}
                {expandable&&estaExpandido&&fila.prods.length>25&&<tr>
                  <td colSpan={meses.length+2} style={{padding:"4px 8px 4px 32px",background:"#FAFAFA",fontSize:10,color:"#8E8E93",fontStyle:"italic"}}>
                    + {fila.prods.length-25} SKU más. Filtrá por tipo específico para verlos todos.
                  </td>
                </tr>}
              </>
            })}
          </tbody>
        </table>
      </div>}
    </Cd>

    {/* NOTA METODOLÓGICA */}
    <div style={{marginTop:12,padding:"10px 14px",background:"#007AFF08",borderRadius:8,fontSize:11,color:"#3A3A3C",lineHeight:1.5}}>
      <strong>📌 Cómo se calcula:</strong> Para cada celda (ítem × mes), se toma el stock disponible al inicio del mes y se compara contra la demanda mensual esperada (venta promedio {metodo==="compensada"?"compensada (excluyendo quiebres)":"simple"} × 30), usando <strong>{mesesValidos} de {totalMeses}</strong> meses disponibles{excluirActual?" (se excluye el mes en curso por ser parcial — configurable en Config → Reposición)":""}. El <strong>% de cobertura</strong> es <em>stock inicio / demanda</em>, limitado a 100%. El stock se va consumiendo mes a mes según la demanda. {incluirTransito?"Se suma el stock en tránsito al stock inicial.":"No se considera el stock en tránsito."} Pasá el mouse sobre cualquier celda para ver los números exactos.
    </div>
  </div>
}

/* ═══ LLEGADAS — Calendario mensual de llegadas de OCs (v48) ═══ */
function LlegadasView({ocs=[],provs=[],setDet,config={}}){
  const hoyDate=new Date()
  const[cursor,setCursor]=useState({year:hoyDate.getFullYear(),month:hoyDate.getMonth()})
  const[filtroTipo,setFiltroTipo]=useLocalState("lleg_tipo","todos") // todos | IMP | NAC
  const[filtroEstado,setFiltroEstado]=useLocalState("lleg_estado","todos") // todos | pendientes | recibidas

  const mesLabel=new Date(cursor.year,cursor.month,1).toLocaleDateString("es-CL",{month:"long",year:"numeric"})
  const prevMonth=()=>{setCursor(c=>{const d=new Date(c.year,c.month-1,1);return{year:d.getFullYear(),month:d.getMonth()}})}
  const nextMonth=()=>{setCursor(c=>{const d=new Date(c.year,c.month+1,1);return{year:d.getFullYear(),month:d.getMonth()}})}
  const today=()=>{setCursor({year:hoyDate.getFullYear(),month:hoyDate.getMonth()})}

  // OCs con fecha estimada válida
  const ocsConFecha=ocs.filter(o=>{
    if(!o.fecha_estimada)return false
    if(filtroTipo==="IMP"&&o.tipo_oc!=="Importación")return false
    if(filtroTipo==="NAC"&&o.tipo_oc!=="Nacional")return false
    const recibida=["Recibida OK","Recibida parcial","Cerrada"].includes(o.estado)
    if(filtroEstado==="pendientes"&&recibida)return false
    if(filtroEstado==="recibidas"&&!recibida)return false
    return true
  })

  // Filtrar OCs del mes actual
  const ocsDelMes=ocsConFecha.filter(o=>{
    const f=new Date(o.fecha_estimada+"T00:00:00")
    return f.getFullYear()===cursor.year&&f.getMonth()===cursor.month
  }).sort((a,b)=>a.fecha_estimada.localeCompare(b.fecha_estimada))

  // Agrupar OCs por día
  const ocsPorDia={}
  ocsDelMes.forEach(o=>{
    const d=new Date(o.fecha_estimada+"T00:00:00").getDate()
    if(!ocsPorDia[d])ocsPorDia[d]=[]
    ocsPorDia[d].push(o)
  })

  // Calcular color de una OC
  const colorOC=(oc)=>{
    const recibida=["Recibida OK","Cerrada"].includes(oc.estado)
    const recibidaParcial=oc.estado==="Recibida parcial"
    const hoyStr=hoyDate.toISOString().slice(0,10)
    const atrasada=!recibida&&!recibidaParcial&&oc.fecha_estimada<hoyStr
    const proxima=!recibida&&!recibidaParcial&&oc.fecha_estimada>=hoyStr&&oc.fecha_estimada<=new Date(Date.now()+7*86400000).toISOString().slice(0,10)
    if(recibida)return{bg:"#34C75915",c:"#34C759",border:"#34C75940"}
    if(recibidaParcial)return{bg:"#FF950015",c:"#FF9500",border:"#FF950040"}
    if(atrasada)return{bg:"#FF3B3015",c:"#FF3B30",border:"#FF3B3040"}
    if(proxima)return{bg:"#FF950015",c:"#FF9500",border:"#FF950040"}
    return{bg:"#007AFF15",c:"#007AFF",border:"#007AFF40"}
  }

  const diasAtraso=(oc)=>{
    const recibida=["Recibida OK","Cerrada","Recibida parcial"].includes(oc.estado)
    if(recibida)return 0
    const hoyStr=hoyDate.toISOString().slice(0,10)
    if(oc.fecha_estimada>=hoyStr)return 0
    return Math.floor((hoyDate-new Date(oc.fecha_estimada+"T00:00:00"))/86400000)
  }

  // Resumen del mes
  const resumen={
    total:ocsDelMes.length,
    recibidas:ocsDelMes.filter(o=>["Recibida OK","Cerrada"].includes(o.estado)).length,
    pendientes:ocsDelMes.filter(o=>!["Recibida OK","Recibida parcial","Cerrada","Rechazada"].includes(o.estado)).length,
    atrasadas:ocsDelMes.filter(o=>diasAtraso(o)>0).length,
    totalUSD:ocsDelMes.filter(o=>o.tipo_oc==="Importación").reduce((s,o)=>s+(o.total_usd||0),0),
    totalCLP:ocsDelMes.filter(o=>o.tipo_oc==="Nacional").reduce((s,o)=>s+(o.total_clp||0),0),
  }

  // Generar grid del calendario (domingo=0...sabado=6, pero queremos lun-dom)
  const firstDay=new Date(cursor.year,cursor.month,1)
  const lastDay=new Date(cursor.year,cursor.month+1,0).getDate()
  const dowFirst=(firstDay.getDay()+6)%7 // lunes=0
  const celdas=[]
  for(let i=0;i<dowFirst;i++)celdas.push(null)
  for(let d=1;d<=lastDay;d++)celdas.push(d)
  while(celdas.length%7!==0)celdas.push(null)

  const esHoy=(d)=>d===hoyDate.getDate()&&cursor.month===hoyDate.getMonth()&&cursor.year===hoyDate.getFullYear()

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:12,flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontSize:22,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>📆 Calendario de Llegadas</div>
        <div style={{fontSize:12,color:"#8E8E93"}}>Fechas estimadas de llegada de órdenes de compra al CD. Navegá por mes y cliqueá una OC para ver su detalle.</div>
      </div>
    </div>

    {/* CONTROLES */}
    <Cd s={{marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <Bt sm v="gry" onClick={prevMonth} ic="◀">Anterior</Bt>
        <div style={{fontSize:16,fontWeight:800,textTransform:"capitalize",minWidth:180,textAlign:"center"}}>{mesLabel}</div>
        <Bt sm v="gry" onClick={nextMonth} ic="▶">Siguiente</Bt>
        <Bt sm v="pri" onClick={today} ic="📅">Hoy</Bt>
        <div style={{flex:1}}/>
        <select value={filtroTipo} onChange={e=>setFiltroTipo(e.target.value)} style={{...css.select,width:160,fontSize:12}}>
          <option value="todos">Todos los tipos</option>
          <option value="IMP">Solo Importación</option>
          <option value="NAC">Solo Nacional</option>
        </select>
        <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{...css.select,width:150,fontSize:12}}>
          <option value="todos">Todos los estados</option>
          <option value="pendientes">Pendientes</option>
          <option value="recibidas">Recibidas</option>
        </select>
      </div>
    </Cd>

    {/* RESUMEN */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:12}}>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #007AFF"}}>
        <div style={{fontSize:10,color:"#8E8E93",fontWeight:600,textTransform:"uppercase"}}>OCs en el mes</div>
        <div style={{fontSize:22,fontWeight:800}}>{resumen.total}</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #34C759"}}>
        <div style={{fontSize:10,color:"#34C759",fontWeight:600,textTransform:"uppercase"}}>Recibidas</div>
        <div style={{fontSize:22,fontWeight:800,color:"#34C759"}}>{resumen.recibidas}</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #FF9500"}}>
        <div style={{fontSize:10,color:"#FF9500",fontWeight:600,textTransform:"uppercase"}}>Pendientes</div>
        <div style={{fontSize:22,fontWeight:800,color:"#FF9500"}}>{resumen.pendientes}</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #FF3B30"}}>
        <div style={{fontSize:10,color:"#FF3B30",fontWeight:600,textTransform:"uppercase"}}>Atrasadas</div>
        <div style={{fontSize:22,fontWeight:800,color:"#FF3B30"}}>{resumen.atrasadas}</div>
      </div>
      {resumen.totalUSD>0&&<div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #AF52DE"}}>
        <div style={{fontSize:10,color:"#AF52DE",fontWeight:600,textTransform:"uppercase"}}>Total IMP</div>
        <div style={{fontSize:18,fontWeight:800,color:"#AF52DE"}}>{fU(resumen.totalUSD)}</div>
      </div>}
      {resumen.totalCLP>0&&<div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #007AFF"}}>
        <div style={{fontSize:10,color:"#007AFF",fontWeight:600,textTransform:"uppercase"}}>Total NAC</div>
        <div style={{fontSize:18,fontWeight:800,color:"#007AFF"}}>{fmt(resumen.totalCLP)}</div>
      </div>}
    </div>

    {/* CALENDARIO GRID */}
    <Cd s={{marginBottom:12}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:6}}>
        {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d=><div key={d} style={{fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",textAlign:"center",padding:4}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
        {celdas.map((d,i)=>{
          if(d===null)return <div key={i} style={{minHeight:100,background:"#FAFAFA",borderRadius:6}}/>
          const ocsDia=ocsPorDia[d]||[]
          const hoyFlag=esHoy(d)
          return<div key={i} style={{minHeight:100,background:"#fff",borderRadius:6,padding:6,border:hoyFlag?"2px solid #007AFF":"1px solid #F2F2F7",display:"flex",flexDirection:"column"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <div style={{fontSize:11,fontWeight:700,color:hoyFlag?"#007AFF":"#1C1C1E"}}>{d}</div>
              {ocsDia.length>0&&<div style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:8,background:"#007AFF15",color:"#007AFF"}}>{ocsDia.length}</div>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:2,overflow:"hidden"}}>
              {ocsDia.slice(0,3).map(oc=>{
                const col=colorOC(oc)
                const atraso=diasAtraso(oc)
                const pv=provs.find(p=>p.id===oc.proveedor_id)
                return<div key={oc.id} onClick={()=>setDet(oc)} title={`${oc.id} · ${pv?.nombre||oc.proveedor_id}${atraso>0?` · Atrasada ${atraso}d`:""}`} style={{padding:"3px 5px",background:col.bg,color:col.c,border:`1px solid ${col.border}`,borderRadius:4,fontSize:9,fontWeight:700,cursor:"pointer",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:3}}>
                  {atraso>0&&<span>⚠</span>}
                  <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{oc.id.replace("OC-","")}</span>
                </div>
              })}
              {ocsDia.length>3&&<div style={{fontSize:9,color:"#8E8E93",textAlign:"center",fontWeight:600}}>+ {ocsDia.length-3}</div>}
            </div>
          </div>
        })}
      </div>
    </Cd>

    {/* LISTA DETALLADA DEL MES */}
    <Cd>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{fontSize:14,fontWeight:700}}>📋 Detalle del mes ({ocsDelMes.length} OCs)</div>
      </div>
      {ocsDelMes.length===0?<div style={{padding:20,textAlign:"center",color:"#8E8E93",fontSize:13}}>No hay OCs con llegada estimada en este mes.</div>:
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {ocsDelMes.map(oc=>{
          const col=colorOC(oc)
          const atraso=diasAtraso(oc)
          const pv=provs.find(p=>p.id===oc.proveedor_id)
          const fLlegada=new Date(oc.fecha_estimada+"T00:00:00").toLocaleDateString("es-CL",{day:"2-digit",month:"short"})
          const esImp=oc.tipo_oc==="Importación"
          return<div key={oc.id} onClick={()=>setDet(oc)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#fff",borderRadius:8,border:`1px solid ${col.border}`,borderLeft:`3px solid ${col.c}`,cursor:"pointer"}}>
            <div style={{minWidth:60,fontSize:13,fontWeight:700,color:col.c}}>{fLlegada}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                <span style={{fontSize:13,fontWeight:700,fontFamily:"monospace"}}>{oc.id}</span>
                <Bd c={esImp?"#FF3B30":"#007AFF"} bg={esImp?"#FF3B3015":"#007AFF15"}>{esImp?"IMP":"NAC"}</Bd>
                <Bd c={STS[oc.estado]?.c} bg={STS[oc.estado]?.bg}>{STS[oc.estado]?.ic} {oc.estado}</Bd>
                {atraso>0&&<Bd c="#FF3B30" bg="#FF3B3015">⚠ Atrasada {atraso}d</Bd>}
              </div>
              <div style={{fontSize:11,color:"#8E8E93"}}>{pv?.nombre||oc.proveedor_id}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:14,fontWeight:800}}>{esImp?fU(oc.total_usd||0):fmt(oc.total_clp||0)}</div>
              {esImp&&oc.total_clp>0&&<div style={{fontSize:10,color:"#8E8E93"}}>{fmt(oc.total_clp)}</div>}
            </div>
          </div>
        })}
      </div>}
    </Cd>
  </div>
}

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
      <div style={{background:"linear-gradient(135deg,#1a1a2e,#16213e)",borderRadius:12,padding:16,color:"#fff"}}><div style={{fontSize:10,color:"rgba(255,255,255,0.5)",textTransform:"uppercase",fontWeight:600}}>Forecast total</div><div style={{fontSize:22,fontWeight:800,marginTop:4}}>{fmt(totals.invTotal)}</div><div style={{fontSize:11,color:"rgba(255,255,255,0.6)"}}>{fN(totals.total)} uds totales · montos mixtos por catálogo</div></div>
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
/* ═══ NumInput — input numérico con buffer local que evita bug de re-render ═══ */
function NumInput({value,onChange,step=1,min=0,style={},suffix="",prefix=""}){
  const[local,setLocal]=useState(String(value??0))
  useEffect(()=>{setLocal(String(value??0))},[value])
  return<div style={{display:"inline-flex",alignItems:"center",gap:3,...style}}>
    {prefix&&<span style={{fontSize:10,color:"#8E8E93"}}>{prefix}</span>}
    <input
      type="text"
      inputMode="decimal"
      value={local}
      onChange={e=>setLocal(e.target.value)}
      onBlur={()=>{
        const n=Number(String(local).replace(",","."))
        if(!isNaN(n)&&n>=min)onChange(n);else setLocal(String(value??0))
      }}
      onKeyDown={e=>{if(e.key==="Enter")e.target.blur()}}
      style={{...css.input,padding:"6px 8px",fontSize:12,width:80,textAlign:"right"}}
    />
    {suffix&&<span style={{fontSize:10,color:"#8E8E93"}}>{suffix}</span>}
  </div>
}

function CosteoImpView({config,saveConfig,ocs,cu,addFirma}){
  const ocsImp=ocs.filter(o=>o.tipo_oc==="Importación"&&!["Rechazada"].includes(o.estado))
  const[selOC,setSelOC]=useState("")
  const[ocItems,setOcItems]=useState([])
  const[tab,setLocalTab]=useState("parametros") // parametros | prorrateo | productos | margenes | gastos_puerto
  const[showHelp,setShowHelp]=useState(null) // id de sección con tooltip abierto

  // ⭐ PARÁMETROS — basados en plantilla NV_COTIZACION.xlsx
  // Todos los valores USD (excepto TC e IVA/Aforo que son %)
  const[par,setPar]=useState({
    tc:Number(config.tc_usd)||950,
    // Flete + Seguro (USD)
    fleteUSD:3800,           // cotizacion!H2
    seguroUSD:200,           // cotizacion!H3
    // Aduana (%)
    pctArancel:0,            // ad valorem
    tieneTLC:false,
    pctIVA:19,               // 0.19 en Excel = 19%
    // Puerto (USD) - detalle por plantilla
    puerto_honorarios:250,
    puerto_despacho:100,
    puerto_desconsolidacion:175,  // × contenedores
    puerto_getin:250,             // × contenedores
    puerto_seguro:300,
    puerto_seguro_contenedor:300, // × contenedores
    puerto_carpeta:15,
    puerto_edi:10,
    puerto_flete_interno:400,     // × contenedores
    puerto_descargadores:200,     // × contenedores
    contenedores:1,
    // Agente aduana (USD)
    agenteAduana:500,
    // Otros (USD)
    otrosGastos:0,
    // Simulación libre (si no hay OC)
    simCantUds:1000,
    simPrecioUnitFOB:5.00
  })

  // ⭐ Margen por producto (override)
  const[margenes,setMargenes]=useState({})
  const[margenDefault,setMargenDefault]=useState(45) // % por default

  useEffect(()=>{
    if(!selOC){setOcItems([]);return}
    supabase.from('oc_items').select('*').eq('oc_id',selOC).then(r=>{setOcItems(r.data||[])})
  },[selOC])

  const TC=par.tc
  const modoOrigen=selOC&&ocItems.length>0?"oc":"sim"

  // ═══════════════════════════════════════════════════════════
  // CÁLCULOS según plantilla Prorateo
  // ═══════════════════════════════════════════════════════════

  // 1. FOB total (USD) — suma de costo_unitario × cantidad de cada producto
  const itemsBase=modoOrigen==="oc"?ocItems.map(i=>({
    sku:i.sku,producto:i.producto,
    cantidad:Number(i.cantidad_confirmada||i.cantidad_pedida||0),
    costoUnit:Number(i.costo_unitario||0)
  })):[{
    sku:"SIM-001",producto:"Simulación",
    cantidad:par.simCantUds,costoUnit:par.simPrecioUnitFOB
  }]

  // FOB USD por producto y total
  const itemsFOB=itemsBase.map(i=>({...i,fobUSD:i.cantidad*i.costoUnit}))
  const totalFOBUSD=itemsFOB.reduce((s,i)=>s+i.fobUSD,0)
  const totalCantidad=itemsFOB.reduce((s,i)=>s+i.cantidad,0)

  // 2. Gastos en puerto detallados (USD) — formula plantilla
  const puerto = (
    par.puerto_honorarios +
    par.puerto_despacho +
    par.puerto_desconsolidacion * par.contenedores +
    par.puerto_getin * par.contenedores +
    par.puerto_seguro +
    par.puerto_seguro_contenedor * par.contenedores +
    par.puerto_carpeta +
    par.puerto_edi +
    par.puerto_flete_interno * par.contenedores +
    par.puerto_descargadores * par.contenedores
  )

  // 3. Desglose Prorateo (tabla izquierda)
  const valorFOB_USD = totalFOBUSD
  const flete_USD = par.fleteUSD
  const valorCFR_USD = valorFOB_USD + flete_USD
  const seguro_USD = par.seguroUSD
  const valorCIF_USD = valorCFR_USD + seguro_USD
  const gastosPuerto_USD = puerto
  const adValorem_USD = par.tieneTLC?0:Math.round(valorCIF_USD*par.pctArancel/100*100)/100
  const iva_USD = Math.round(valorCIF_USD*par.pctIVA/100*100)/100
  const agenteAd_USD = par.agenteAduana
  const fleteInterno_USD = par.puerto_flete_interno * par.contenedores
  const otros_USD = par.otrosGastos
  const totalGastosCL_USD = gastosPuerto_USD + adValorem_USD + iva_USD + agenteAd_USD + fleteInterno_USD + otros_USD
  const totalImport_USD = valorCIF_USD + totalGastosCL_USD - fleteInterno_USD // fleteInterno ya viene en gastosPuerto

  // Versión CLP (× TC)
  const toCLP = (u) => Math.round(u*TC)

  // 4. Prorrateo por producto (FOB weight) — según plantilla
  const productos = itemsFOB.map(item=>{
    const pctFOB = totalFOBUSD>0 ? item.fobUSD/totalFOBUSD : 0
    const flete_prod = flete_USD * pctFOB
    const seguro_prod = seguro_USD * pctFOB
    const gastosCL_prod = (gastosPuerto_USD + adValorem_USD + iva_USD + agenteAd_USD + otros_USD) * pctFOB
    const totalImport_prod = item.fobUSD + flete_prod + seguro_prod + gastosCL_prod
    const cuImport_USD = item.cantidad>0 ? totalImport_prod/item.cantidad : 0
    const cuImport_CLP = cuImport_USD * TC
    // Margen
    const margenPct = margenes[item.sku]!==undefined ? margenes[item.sku] : margenDefault
    const ventaCLP = margenPct<100 ? cuImport_CLP/(1-margenPct/100) : 0
    const margenUnitCLP = ventaCLP - cuImport_CLP
    const ventaTotalCLP = ventaCLP * item.cantidad
    const costoTotalCLP = cuImport_CLP * item.cantidad
    const margenTotalCLP = margenUnitCLP * item.cantidad
    return {
      ...item,pctFOB,
      flete_prod_USD:flete_prod,seguro_prod_USD:seguro_prod,gastosCL_prod_USD:gastosCL_prod,
      totalImport_prod_USD:totalImport_prod,
      cuImport_USD,cuImport_CLP,
      margenPct,ventaCLP,margenUnitCLP,
      ventaTotalCLP,costoTotalCLP,margenTotalCLP
    }
  })

  const totalVentaCLP = productos.reduce((s,p)=>s+p.ventaTotalCLP,0)
  const totalCostoCLP = productos.reduce((s,p)=>s+p.costoTotalCLP,0)
  const totalMargenCLP = totalVentaCLP - totalCostoCLP
  const margenPromedio = totalVentaCLP>0 ? totalMargenCLP/totalVentaCLP*100 : 0

  // Helpers
  const setParam=(k,v)=>setPar(prev=>({...prev,[k]:v}))
  const updMargen=(sku,v)=>setMargenes(p=>({...p,[sku]:Number(v)||0}))

  const saveParams=async()=>{
    const keys={tc_usd:par.tc,costo_flete_40hc:par.fleteUSD,pct_seguro_int:par.seguroUSD,pct_arancel:par.pctArancel,
      costo_handling:par.puerto_honorarios,almacenaje_dia:par.puerto_despacho,costo_porteo:par.puerto_carpeta,
      honorario_agente:par.agenteAduana}
    for(const[k,v]of Object.entries(keys))await saveConfig(k,String(v))
    alert("✓ Parámetros guardados en configuración")
  }

  const guardarCosteo=async()=>{
    if(!selOC){alert("⚠ Seleccioná una OC primero");return}
    // ⭐ v47: Inferir tipo de costeo según estado actual de la OC
    const ocActual=ocs.find(o=>o.id===selOC)
    const estadosFinales=["Internación","Validar costeo final","Transporte","Recibida OK","Recibida parcial","Cerrada","Despacho nac."]
    const tipoCosteo=estadosFinales.includes(ocActual?.estado)?"final":"proyectado"
    if(!window.confirm(`¿Anexar este costeo (${tipoCosteo.toUpperCase()}) al historial de ${selOC}?`))return
    const row={
      id:uid(),oc_id:selOC,fecha:hoy(),registrado_por:cu?.id,nombre_usuario:cu?.nombre||"",
      tipo_costeo:tipoCosteo,
      tc_usd:par.tc,cant_unidades:totalCantidad,precio_unit_fob:totalFOBUSD/Math.max(totalCantidad,1),
      tiene_tlc:par.tieneTLC,pct_arancel:par.pctArancel,pct_iva:par.pctIVA,pct_aforo:0,pct_seguro:0,
      costo_flete_usd:par.fleteUSD,handling_usd:par.puerto_honorarios,
      fob_clp:toCLP(valorFOB_USD),cif_clp:toCLP(valorFOB_USD+flete_USD+seguro_USD),
      total_aduana:toCLP(adValorem_USD+iva_USD),total_puerto:toCLP(puerto),
      agente_clp:toCLP(agenteAd_USD),transporte_clp:toCLP(fleteInterno_USD),
      total_financiero:0,costo_total_clp:toCLP(totalImport_USD),
      costo_unit_bodega:totalCantidad>0?Math.round(toCLP(totalImport_USD)/totalCantidad):0,
      margen_calculado:Math.round(margenPromedio),precio_venta_clp:totalCantidad>0?Math.round(totalVentaCLP/totalCantidad):0,
      ganancia_unit:totalCantidad>0?Math.round(totalMargenCLP/totalCantidad):0,ganancia_total:Math.round(totalMargenCLP),
      productos_detalle:JSON.stringify(productos.map(p=>({sku:p.sku,producto:p.producto,cantidad:p.cantidad,costo_origen:p.costoUnit,
        cu_import_usd:Math.round(p.cuImport_USD*100)/100,cu_import_clp:Math.round(p.cuImport_CLP),margen_pct:p.margenPct,
        venta_clp:Math.round(p.ventaCLP),margen_unit_clp:Math.round(p.margenUnitCLP)})))
    }
    const{error}=await supabase.from('costeos_oc').insert(row)
    if(error){alert("Error: "+error.message);return}
    if(addFirma)await addFirma(selOC,`Costeo IMP ${tipoCosteo} anexado: CU bodega promedio ${fmt(row.costo_unit_bodega)} · margen ${Math.round(margenPromedio)}% · total ${fmt(row.costo_total_clp)}`)
    alert(`✓ Costeo ${tipoCosteo.toUpperCase()} anexado al historial de ${selOC}`)
  }

  const InfoTag=({children,onHover,id})=><span
    onMouseEnter={()=>setShowHelp(id)}
    onMouseLeave={()=>setShowHelp(null)}
    style={{cursor:"help",display:"inline-flex",alignItems:"center",justifyContent:"center",width:16,height:16,borderRadius:8,background:"#E5E5EA",color:"#636366",fontSize:10,fontWeight:700,marginLeft:4,position:"relative"}}
    title={onHover}>?
    {showHelp===id&&<div style={{position:"absolute",bottom:"100%",left:"50%",transform:"translateX(-50%)",marginBottom:4,background:"#1C1C1E",color:"#fff",padding:"8px 10px",borderRadius:6,fontSize:11,fontWeight:400,width:260,zIndex:100,lineHeight:1.4,boxShadow:"0 4px 12px rgba(0,0,0,0.3)"}}>{children}</div>}
  </span>

  const Tab=({id,label,ic})=><button onClick={()=>setLocalTab(id)} style={{padding:"8px 14px",borderRadius:8,fontSize:12,fontWeight:600,background:tab===id?"#007AFF":"#fff",color:tab===id?"#fff":"#1C1C1E",border:tab===id?"none":"1px solid #E5E5EA",cursor:"pointer"}}>{ic} {label}</button>

  return<div>
    {/* HEADER */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontSize:22,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>💼 Costeo de Importación</div>
        <div style={{fontSize:13,color:"#8E8E93"}}>
          Prorrateo por FOB según plantilla Excel NV_COTIZACION ·
          {modoOrigen==="oc"?<span style={{color:"#34C759",fontWeight:600}}> OC {selOC} · {itemsBase.length} productos</span>:<span style={{color:"#FF9500",fontWeight:600}}> Simulación libre</span>}
        </div>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        <Bt v="gry" onClick={saveParams} sm ic="💾">Guardar params</Bt>
        <Bt v="pri" onClick={guardarCosteo} sm ic="📎" disabled={!selOC}>Anexar a OC</Bt>
      </div>
    </div>

    {/* SELECTOR OC */}
    <div style={{background:"#fff",borderRadius:10,padding:12,marginBottom:10,border:"1px solid #E5E5EA"}}>
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <label style={{fontSize:12,fontWeight:600,color:"#636366"}}>Modo:</label>
        <select value={selOC} onChange={e=>setSelOC(e.target.value)} style={{...css.select,padding:"6px 10px",fontSize:12,minWidth:280}}>
          <option value="">— Simulación libre (ingresá FOB manual) —</option>
          {ocsImp.map(o=><option key={o.id} value={o.id}>{o.id} · {fU(o.total_usd||0)} · {o.estado}</option>)}
        </select>
        {modoOrigen==="sim"&&<>
          <label style={{fontSize:11,color:"#8E8E93"}}>Cant. sim:</label>
          <NumInput value={par.simCantUds} onChange={v=>setParam("simCantUds",v)}/>
          <label style={{fontSize:11,color:"#8E8E93"}}>Costo unit USD:</label>
          <NumInput value={par.simPrecioUnitFOB} onChange={v=>setParam("simPrecioUnitFOB",v)} step={0.01}/>
        </>}
      </div>
    </div>

    {/* KPIs GLOBALES */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:8,marginBottom:12}}>
      <div style={{background:"#fff",borderRadius:10,padding:12,borderLeft:"4px solid #007AFF",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:10,color:"#8E8E93",textTransform:"uppercase",fontWeight:700}}>FOB Origen</div>
        <div style={{fontSize:18,fontWeight:800,color:"#007AFF"}}>{fU(valorFOB_USD)}</div>
        <div style={{fontSize:10,color:"#8E8E93"}}>{fmt(toCLP(valorFOB_USD))}</div>
      </div>
      <div style={{background:"#fff",borderRadius:10,padding:12,borderLeft:"4px solid #5856D6",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:10,color:"#8E8E93",textTransform:"uppercase",fontWeight:700}}>CIF</div>
        <div style={{fontSize:18,fontWeight:800,color:"#5856D6"}}>{fU(valorCIF_USD)}</div>
        <div style={{fontSize:10,color:"#8E8E93"}}>{fmt(toCLP(valorCIF_USD))}</div>
      </div>
      <div style={{background:"#fff",borderRadius:10,padding:12,borderLeft:"4px solid #FF9500",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:10,color:"#8E8E93",textTransform:"uppercase",fontWeight:700}}>Gastos en CL</div>
        <div style={{fontSize:18,fontWeight:800,color:"#FF9500"}}>{fU(totalGastosCL_USD-fleteInterno_USD)}</div>
        <div style={{fontSize:10,color:"#8E8E93"}}>{fmt(toCLP(totalGastosCL_USD-fleteInterno_USD))}</div>
      </div>
      <div style={{background:"#fff",borderRadius:10,padding:12,borderLeft:"4px solid #34C759",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:10,color:"#8E8E93",textTransform:"uppercase",fontWeight:700}}>TOTAL importación</div>
        <div style={{fontSize:18,fontWeight:800,color:"#34C759"}}>{fU(totalImport_USD)}</div>
        <div style={{fontSize:10,color:"#8E8E93"}}>{fmt(toCLP(totalImport_USD))}</div>
      </div>
      <div style={{background:"linear-gradient(135deg,#1a1a2e,#16213e)",borderRadius:10,padding:12,color:"#fff"}}>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.6)",textTransform:"uppercase",fontWeight:700}}>Margen bruto</div>
        <div style={{fontSize:18,fontWeight:800}}>{Math.round(margenPromedio)}%</div>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.7)"}}>{fmt(totalMargenCLP)} CLP</div>
      </div>
    </div>

    {/* TABS */}
    <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
      <Tab id="parametros" ic="⚙️" label="Parámetros"/>
      <Tab id="gastos_puerto" ic="⚓" label="Gastos en puerto"/>
      <Tab id="prorrateo" ic="📊" label="Desglose Prorateo"/>
      <Tab id="productos" ic="📦" label={`Productos (${productos.length})`}/>
      <Tab id="margenes" ic="💰" label="Márgenes"/>
    </div>

    {/* ═══ TAB: PARÁMETROS ═══ */}
    {tab==="parametros"&&<div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <div style={{fontSize:14,fontWeight:800,marginBottom:12,color:"#1C1C1E"}}>⚙️ Parámetros de costeo</div>

      {/* TC */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#636366",marginBottom:6,display:"flex",alignItems:"center"}}>TIPO DE CAMBIO (TC)
            <InfoTag id="tc" onHover="TC CLP/USD">
              <b>De dónde viene:</b><br/>
              Configuración global del sistema (Config → Reposición → TC USD). Se usa para convertir todos los valores USD a CLP.<br/><br/>
              <b>En la plantilla Excel:</b> celda <code>cotizacion!J2 = 950</code>
            </InfoTag>
          </div>
          <NumInput value={par.tc} onChange={v=>setParam("tc",v)} style={{width:"100%"}} prefix="CLP/USD"/>
        </div>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#636366",marginBottom:6}}>CONTENEDORES
            <InfoTag id="cont" onHover="Nro contenedores">
              Cantidad de contenedores del embarque. Afecta desconsolidación, GET IN, seguro contenedor, flete interno y descargadores.<br/><br/>
              <b>Plantilla:</b> <code>cotizacion!M2 = 2</code>
            </InfoTag>
          </div>
          <NumInput value={par.contenedores} onChange={v=>setParam("contenedores",v)} style={{width:"100%"}} suffix="cont."/>
        </div>
      </div>

      {/* Flete + Seguro */}
      <div style={{padding:12,background:"#5856D608",borderRadius:8,marginBottom:12,borderLeft:"3px solid #5856D6"}}>
        <div style={{fontSize:13,fontWeight:700,color:"#5856D6",marginBottom:10}}>🚢 Flete + Seguro (USD)</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <div style={{fontSize:11,color:"#636366",marginBottom:4}}>Flete marítimo
              <InfoTag id="flete" onHover="Flete">
                Costo de transporte marítimo desde origen hasta puerto de destino.<br/><br/>
                <b>Plantilla:</b> <code>cotizacion!H2 = 3800</code><br/>
                En plantilla se suma al FOB para formar CFR (Cost + Freight).
              </InfoTag>
            </div>
            <NumInput value={par.fleteUSD} onChange={v=>setParam("fleteUSD",v)} suffix="USD"/>
            <div style={{fontSize:10,color:"#8E8E93",marginTop:3}}>≈ {fmt(toCLP(par.fleteUSD))}</div>
          </div>
          <div>
            <div style={{fontSize:11,color:"#636366",marginBottom:4}}>Seguro mercadería
              <InfoTag id="seguro" onHover="Seguro">
                Seguro sobre la mercadería durante el transporte marítimo.<br/><br/>
                <b>Plantilla:</b> <code>cotizacion!H3 = 200</code> (valor fijo USD)<br/>
                CIF = CFR + Seguro
              </InfoTag>
            </div>
            <NumInput value={par.seguroUSD} onChange={v=>setParam("seguroUSD",v)} suffix="USD"/>
            <div style={{fontSize:10,color:"#8E8E93",marginTop:3}}>≈ {fmt(toCLP(par.seguroUSD))}</div>
          </div>
        </div>
        <div style={{fontSize:11,color:"#5856D6",marginTop:8,fontWeight:600}}>CIF total: {fU(valorCIF_USD)} · {fmt(toCLP(valorCIF_USD))}</div>
      </div>

      {/* Aduana */}
      <div style={{padding:12,background:"#FF3B3008",borderRadius:8,marginBottom:12,borderLeft:"3px solid #FF3B30"}}>
        <div style={{fontSize:13,fontWeight:700,color:"#FF3B30",marginBottom:10}}>🏛 Aduana</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
          <div>
            <div style={{fontSize:11,color:"#636366",marginBottom:4}}>Ad Valorem
              <InfoTag id="arancel" onHover="Arancel ad valorem">
                Arancel aduanero sobre CIF. Depende del código HTS del producto.<br/><br/>
                <b>Plantilla:</b> <code>cotizacion!H5 = 0</code> (con TLC)<br/>
                Se calcula: CIF × %<br/>
                Marcar "Con TLC" para anular.
              </InfoTag>
            </div>
            <NumInput value={par.pctArancel} onChange={v=>setParam("pctArancel",v)} step={0.1} suffix="%"/>
          </div>
          <div>
            <div style={{fontSize:11,color:"#636366",marginBottom:4}}>Con TLC</div>
            <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",padding:"6px 8px"}}>
              <input type="checkbox" checked={par.tieneTLC} onChange={e=>setParam("tieneTLC",e.target.checked)}/>
              <span style={{fontSize:12}}>TLC vigente (0% arancel)</span>
            </label>
          </div>
          <div>
            <div style={{fontSize:11,color:"#636366",marginBottom:4}}>IVA
              <InfoTag id="iva" onHover="IVA importacion">
                IVA sobre CIF (19% Chile).<br/><br/>
                <b>Plantilla:</b> <code>cotizacion!K2 = 0.19</code> = 19%<br/>
                IVA = CIF × 19% (recuperable como crédito fiscal)
              </InfoTag>
            </div>
            <NumInput value={par.pctIVA} onChange={v=>setParam("pctIVA",v)} step={0.5} suffix="%"/>
          </div>
        </div>
        <div style={{fontSize:11,color:"#FF3B30",marginTop:8,fontWeight:600}}>
          Arancel {fU(adValorem_USD)} + IVA {fU(iva_USD)} · Total {fU(adValorem_USD+iva_USD)} ({fmt(toCLP(adValorem_USD+iva_USD))})
        </div>
      </div>

      {/* Agente aduana + otros */}
      <div style={{padding:12,background:"#AF52DE08",borderRadius:8,marginBottom:12,borderLeft:"3px solid #AF52DE"}}>
        <div style={{fontSize:13,fontWeight:700,color:"#AF52DE",marginBottom:10}}>📋 Agente aduana + otros gastos</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <div style={{fontSize:11,color:"#636366",marginBottom:4}}>Agente aduana
              <InfoTag id="agente" onHover="Agente aduana">
                Honorarios del agente aduana por trámite de importación.<br/><br/>
                <b>Plantilla:</b> <code>cotizacion!H6 = 500</code>
              </InfoTag>
            </div>
            <NumInput value={par.agenteAduana} onChange={v=>setParam("agenteAduana",v)} suffix="USD"/>
            <div style={{fontSize:10,color:"#8E8E93",marginTop:3}}>≈ {fmt(toCLP(par.agenteAduana))}</div>
          </div>
          <div>
            <div style={{fontSize:11,color:"#636366",marginBottom:4}}>Otros gastos
              <InfoTag id="otros" onHover="Otros gastos">
                Gastos varios no categorizados.<br/><br/>
                <b>Plantilla:</b> <code>cotizacion!H8 = 1000</code>
              </InfoTag>
            </div>
            <NumInput value={par.otrosGastos} onChange={v=>setParam("otrosGastos",v)} suffix="USD"/>
            <div style={{fontSize:10,color:"#8E8E93",marginTop:3}}>≈ {fmt(toCLP(par.otrosGastos))}</div>
          </div>
        </div>
      </div>

      <div style={{fontSize:11,color:"#8E8E93",marginTop:12,padding:"10px 12px",background:"#F8F8FA",borderRadius:6,lineHeight:1.5}}>
        💡 Los parámetros se basan en la plantilla Excel <b>NV_COTIZACION.xlsx</b> — hoja "cotizacion" (cabecera) y "Prorateo" (desglose). Para ver el detalle de los gastos en puerto, cambiá a la pestaña <b>Gastos en puerto</b>.
      </div>
    </div>}

    {/* ═══ TAB: GASTOS EN PUERTO ═══ */}
    {tab==="gastos_puerto"&&<div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <div style={{fontSize:14,fontWeight:800,marginBottom:6,color:"#1C1C1E"}}>⚓ Gastos en puerto detallados</div>
      <div style={{fontSize:12,color:"#8E8E93",marginBottom:14,lineHeight:1.5}}>
        Detalle basado en la tabla <b>O2:Q13 de la plantilla</b>. Los valores marcados con <span style={{color:"#5856D6",fontWeight:700}}>× cont.</span> se multiplican por la cantidad de contenedores (actualmente <b>{par.contenedores}</b>).
      </div>

      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{background:"#F8F8FA",borderBottom:"2px solid #E5E5EA"}}>
          <th style={{padding:"8px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Concepto</th>
          <th style={{padding:"8px 12px",textAlign:"right",fontSize:10,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Base USD</th>
          <th style={{padding:"8px 12px",textAlign:"center",fontSize:10,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Multiplicador</th>
          <th style={{padding:"8px 12px",textAlign:"right",fontSize:10,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Total USD</th>
          <th style={{padding:"8px 12px",textAlign:"right",fontSize:10,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Total CLP</th>
          <th style={{padding:"8px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Fuente</th>
        </tr></thead>
        <tbody>
          {[
            ["Honorarios","puerto_honorarios",1,false,"O2:P2"],
            ["Gastos de despacho","puerto_despacho",1,false,"O3:P3"],
            ["Desconsolidación","puerto_desconsolidacion",par.contenedores,true,"O4:P4 × contenedores"],
            ["GET IN","puerto_getin",par.contenedores,true,"O5:P5 × contenedores"],
            ["Seguro","puerto_seguro",1,false,"O6:P6"],
            ["Seguro contenedor","puerto_seguro_contenedor",par.contenedores,true,"O7:P7 × contenedores"],
            ["Carpeta electrónica","puerto_carpeta",1,false,"O8:P8"],
            ["Tramitación EDI","puerto_edi",1,false,"O9:P9"],
            ["Flete interno","puerto_flete_interno",par.contenedores,true,"O11:P11 × contenedores"],
            ["Descargadores","puerto_descargadores",par.contenedores,true,"O13:P13 × contenedores"]
          ].map(([label,key,mult,xcont,src],i)=>{
            const val=par[key]
            const total=val*mult
            return<tr key={i} style={{borderBottom:"1px solid #F2F2F7"}}>
              <td style={{padding:"6px 12px",fontWeight:600}}>{label}</td>
              <td style={{padding:"6px 12px",textAlign:"right"}}>
                <NumInput value={val} onChange={v=>setParam(key,v)} suffix="USD"/>
              </td>
              <td style={{padding:"6px 12px",textAlign:"center",fontSize:11,color:xcont?"#5856D6":"#8E8E93",fontWeight:xcont?700:400}}>
                {xcont?`× ${par.contenedores}`:"×1"}
              </td>
              <td style={{padding:"6px 12px",textAlign:"right",fontWeight:700,color:"#007AFF"}}>{fU(total)}</td>
              <td style={{padding:"6px 12px",textAlign:"right",fontWeight:600,color:"#636366"}}>{fmt(toCLP(total))}</td>
              <td style={{padding:"6px 12px",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>{src}</td>
            </tr>
          })}
          <tr style={{background:"#FF950008",fontWeight:800}}>
            <td style={{padding:"10px 12px",fontSize:13}}>TOTAL GASTOS EN PUERTO</td>
            <td style={{padding:"10px 12px"}}></td>
            <td style={{padding:"10px 12px"}}></td>
            <td style={{padding:"10px 12px",textAlign:"right",fontSize:14,color:"#FF9500"}}>{fU(puerto)}</td>
            <td style={{padding:"10px 12px",textAlign:"right",fontSize:14,color:"#FF9500"}}>{fmt(toCLP(puerto))}</td>
            <td style={{padding:"10px 12px",fontSize:10,color:"#AEAEB2"}}>SUM(Q2:Q13)</td>
          </tr>
        </tbody>
      </table>
    </div>}

    {/* ═══ TAB: DESGLOSE PRORATEO (según plantilla hoja Prorateo A1:C14) ═══ */}
    {tab==="prorrateo"&&<div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <div style={{fontSize:14,fontWeight:800,marginBottom:6}}>📊 Desglose de valores (hoja Prorateo A1:C14)</div>
      <div style={{fontSize:12,color:"#8E8E93",marginBottom:14}}>Estructura exacta del desglose de la plantilla Excel con valores en USD y CLP.</div>

      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:"#F8F8FA",borderBottom:"2px solid #E5E5EA"}}>
          <th style={{padding:"10px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Desglose</th>
          <th style={{padding:"10px 12px",textAlign:"right",fontSize:10,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Valor USD</th>
          <th style={{padding:"10px 12px",textAlign:"right",fontSize:10,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Valor CLP</th>
          <th style={{padding:"10px 12px",textAlign:"center",fontSize:10,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Ref plantilla</th>
        </tr></thead>
        <tbody>
          <tr style={{background:"#007AFF08"}}><td style={{padding:"8px 12px",fontWeight:700,color:"#007AFF"}}>VALOR FOB (FCA)</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#007AFF"}}>{fU(valorFOB_USD)}</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#007AFF"}}>{fmt(toCLP(valorFOB_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B2 = D49 (suma productos)</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#636366"}}>Flete</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(flete_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(flete_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B3 = cotizacion!H2</td></tr>
          <tr style={{background:"#5856D608"}}><td style={{padding:"8px 12px",fontWeight:700,color:"#5856D6"}}>VALOR CFR (CPT)</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#5856D6"}}>{fU(valorCFR_USD)}</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#5856D6"}}>{fmt(toCLP(valorCFR_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B4 = B2+B3</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#636366"}}>Seguro</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(seguro_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(seguro_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B5 = cotizacion!H3</td></tr>
          <tr style={{background:"#34C75908"}}><td style={{padding:"8px 12px",fontWeight:700,color:"#34C759"}}>VALOR CIF (CIP)</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#34C759"}}>{fU(valorCIF_USD)}</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#34C759"}}>{fmt(toCLP(valorCIF_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B6 = B4+B5</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#636366"}}>Gastos en puerto</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(gastosPuerto_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(gastosPuerto_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B7 = cotizacion!H4</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#636366"}}>Ad valorem</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(adValorem_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(adValorem_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B8 = CIF × %aran</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#636366"}}>IVA</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(iva_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(iva_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B9 = B6 × K2 (19%)</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#636366"}}>Agente de aduana</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(agenteAd_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(agenteAd_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B10 = cotizacion!H6</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#636366"}}>Flete interno</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(fleteInterno_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(fleteInterno_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B11 = Q11</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#636366"}}>Otros gastos</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(otros_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(otros_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B12 = cotizacion!H8</td></tr>
          <tr style={{background:"#FF950008"}}><td style={{padding:"8px 12px",fontWeight:700,color:"#FF9500"}}>TOTAL GASTOS EN CL</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#FF9500"}}>{fU(totalGastosCL_USD)}</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#FF9500"}}>{fmt(toCLP(totalGastosCL_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B13 = SUM(B7:B12)</td></tr>
          <tr style={{background:"#FF3B3008",borderTop:"2px solid #FF3B30"}}><td style={{padding:"12px",fontWeight:800,fontSize:14,color:"#FF3B30"}}>TOTAL</td><td style={{padding:"12px",textAlign:"right",fontWeight:800,fontSize:14,color:"#FF3B30"}}>{fU(valorCIF_USD+totalGastosCL_USD)}</td><td style={{padding:"12px",textAlign:"right",fontWeight:800,fontSize:14,color:"#FF3B30"}}>{fmt(toCLP(valorCIF_USD+totalGastosCL_USD))}</td><td style={{padding:"12px",textAlign:"center",fontSize:10,color:"#AEAEB2",fontFamily:"monospace"}}>B14 = CIF+GastosCL</td></tr>
        </tbody>
      </table>
    </div>}

    {/* ═══ TAB: PRORRATEO POR PRODUCTO (hoja Prorateo A17:J48) ═══ */}
    {tab==="productos"&&<div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <div style={{fontSize:14,fontWeight:800,marginBottom:6}}>📦 Prorrateo por producto (hoja Prorateo A17:J48)</div>
      <div style={{fontSize:12,color:"#8E8E93",marginBottom:14}}>
        Prorrateo por <b>peso FOB</b> según la fórmula de la plantilla: cada gasto se distribuye según la proporción del FOB de cada producto sobre el total (<code>D_row/$D$49</code>).
      </div>

      {productos.length===0?<div style={{textAlign:"center",padding:30,color:"#8E8E93"}}>Seleccioná una OC o usá modo simulación para ver productos.</div>:
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:1000}}>
          <thead><tr style={{background:"#F8F8FA",borderBottom:"2px solid #E5E5EA"}}>
            <th style={{padding:"8px",textAlign:"left",fontSize:9,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Producto</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Cant.</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>CU origen USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#636366",textTransform:"uppercase",background:"#007AFF15"}}>FOB total USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>% FOB</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#5856D6",textTransform:"uppercase",background:"#5856D615"}}>Flete USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#FF9500",textTransform:"uppercase",background:"#FF950015"}}>Seguro USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#FF3B30",textTransform:"uppercase",background:"#FF3B3015"}}>Gastos CL USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#34C759",textTransform:"uppercase",background:"#34C75915"}}>Total Import USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:800,color:"#fff",textTransform:"uppercase",background:"#1C1C1E"}}>CU USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:800,color:"#fff",textTransform:"uppercase",background:"#1C1C1E"}}>CU CLP</th>
          </tr></thead>
          <tbody>{productos.map((p,i)=>
            <tr key={i} style={{borderBottom:"1px solid #F2F2F7"}}>
              <td style={{padding:"6px 8px",fontWeight:600}}>{p.producto}<div style={{fontSize:9,color:"#8E8E93",fontFamily:"monospace"}}>{p.sku}</div></td>
              <td style={{padding:"6px 8px",textAlign:"right"}}>{fN(p.cantidad)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",color:"#636366"}}>{fU(p.costoUnit)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:"#007AFF",background:"#007AFF08"}}>{fU(p.fobUSD)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",color:"#636366"}}>{(p.pctFOB*100).toFixed(1)}%</td>
              <td style={{padding:"6px 8px",textAlign:"right",color:"#5856D6",background:"#5856D608"}}>{fU(p.flete_prod_USD)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",color:"#FF9500",background:"#FF950008"}}>{fU(p.seguro_prod_USD)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",color:"#FF3B30",background:"#FF3B3008"}}>{fU(p.gastosCL_prod_USD)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:"#34C759",background:"#34C75908"}}>{fU(p.totalImport_prod_USD)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:800,color:"#1C1C1E",background:"#F8F8FA"}}>{fU(p.cuImport_USD)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:800,color:"#1C1C1E",background:"#F8F8FA"}}>{fmt(Math.round(p.cuImport_CLP))}</td>
            </tr>
          )}
          <tr style={{background:"#1C1C1E",color:"#fff",fontWeight:800}}>
            <td style={{padding:"10px 8px"}}>TOTAL</td>
            <td style={{padding:"10px 8px",textAlign:"right"}}>{fN(totalCantidad)}</td>
            <td style={{padding:"10px 8px"}}></td>
            <td style={{padding:"10px 8px",textAlign:"right"}}>{fU(totalFOBUSD)}</td>
            <td style={{padding:"10px 8px",textAlign:"right"}}>100%</td>
            <td style={{padding:"10px 8px",textAlign:"right"}}>{fU(flete_USD)}</td>
            <td style={{padding:"10px 8px",textAlign:"right"}}>{fU(seguro_USD)}</td>
            <td style={{padding:"10px 8px",textAlign:"right"}}>{fU(gastosPuerto_USD+adValorem_USD+iva_USD+agenteAd_USD+otros_USD)}</td>
            <td style={{padding:"10px 8px",textAlign:"right"}}>{fU(totalImport_USD)}</td>
            <td colSpan={2} style={{padding:"10px 8px",textAlign:"right"}}>Promedio: {fU(totalImport_USD/Math.max(totalCantidad,1))} · {fmt(Math.round(totalImport_USD/Math.max(totalCantidad,1)*TC))}</td>
          </tr>
          </tbody>
        </table>
      </div>}
    </div>}

    {/* ═══ TAB: MÁRGENES (hoja Margenes A1:I17) ═══ */}
    {tab==="margenes"&&<div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:14,fontWeight:800}}>💰 Márgenes y precios de venta (hoja Margenes)</div>
          <div style={{fontSize:12,color:"#8E8E93"}}>Calcula precio de venta desde margen objetivo: <code>Venta = Costo / (1 - Margen%)</code></div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <label style={{fontSize:11,color:"#636366"}}>Margen default %:</label>
          <NumInput value={margenDefault} onChange={v=>setMargenDefault(v)} suffix="%"/>
        </div>
      </div>

      {productos.length===0?<div style={{textAlign:"center",padding:30,color:"#8E8E93"}}>Seleccioná una OC o usá modo simulación para ver márgenes.</div>:
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:900}}>
          <thead><tr style={{background:"#F8F8FA",borderBottom:"2px solid #E5E5EA"}}>
            <th style={{padding:"8px",textAlign:"left",fontSize:9,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Producto</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Cant.</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Costo CLP</th>
            <th style={{padding:"8px",textAlign:"center",fontSize:9,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Margen %</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#34C759",textTransform:"uppercase"}}>Venta CLP</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#AF52DE",textTransform:"uppercase"}}>Margen unit</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#636366",textTransform:"uppercase"}}>Costo total</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#AF52DE",textTransform:"uppercase"}}>Margen total</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:9,fontWeight:700,color:"#34C759",textTransform:"uppercase"}}>Venta total</th>
          </tr></thead>
          <tbody>{productos.map((p,i)=>
            <tr key={i} style={{borderBottom:"1px solid #F2F2F7"}}>
              <td style={{padding:"6px 8px",fontWeight:600}}>{p.producto}<div style={{fontSize:9,color:"#8E8E93"}}>{p.sku}</div></td>
              <td style={{padding:"6px 8px",textAlign:"right"}}>{fN(p.cantidad)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600}}>{fmt(Math.round(p.cuImport_CLP))}</td>
              <td style={{padding:"6px 8px",textAlign:"center"}}>
                <NumInput value={p.margenPct} onChange={v=>updMargen(p.sku,v)} suffix="%"/>
              </td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:"#34C759"}}>{fmt(Math.round(p.ventaCLP))}</td>
              <td style={{padding:"6px 8px",textAlign:"right",color:"#AF52DE"}}>{fmt(Math.round(p.margenUnitCLP))}</td>
              <td style={{padding:"6px 8px",textAlign:"right"}}>{fmt(Math.round(p.costoTotalCLP))}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:"#AF52DE"}}>{fmt(Math.round(p.margenTotalCLP))}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:"#34C759"}}>{fmt(Math.round(p.ventaTotalCLP))}</td>
            </tr>
          )}
          <tr style={{background:"#1C1C1E",color:"#fff",fontWeight:800}}>
            <td style={{padding:"10px 8px"}} colSpan={3}>TOTALES</td>
            <td style={{padding:"10px 8px",textAlign:"center"}}>{Math.round(margenPromedio)}% prom.</td>
            <td style={{padding:"10px 8px"}}></td>
            <td style={{padding:"10px 8px"}}></td>
            <td style={{padding:"10px 8px",textAlign:"right"}}>{fmt(Math.round(totalCostoCLP))}</td>
            <td style={{padding:"10px 8px",textAlign:"right"}}>{fmt(Math.round(totalMargenCLP))}</td>
            <td style={{padding:"10px 8px",textAlign:"right"}}>{fmt(Math.round(totalVentaCLP))}</td>
          </tr>
          </tbody>
        </table>
      </div>}

      <div style={{marginTop:14,padding:12,background:"#F8F8FA",borderRadius:8,fontSize:11,color:"#636366",lineHeight:1.6}}>
        💡 <b>Fórmulas aplicadas</b> (hoja Margenes):<br/>
        • Venta = Costo / (1 - Margen%) — plantilla <code>E = C / (1-D)</code><br/>
        • Margen unitario = Venta - Costo — plantilla <code>F = E - C</code><br/>
        • Totales = Cantidad × unitario — plantilla <code>G = B*C, H = F*B, I = H+G</code>
      </div>
    </div>}
  </div>
}

/* ═══ TRÁNSITO — Products in transit with ETA + Export ═══ */
function TransitoView({ocs,provs,config={}}){
  const TC_USD=Number(config.tc_usd)||950
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

  const totalItems=items.length;const totalUds=items.reduce((s,i)=>s+(i.cantidad_pedida||0),0);const totalMonto=activas.reduce((s,o)=>s+(o.total_clp||0),0);const totalUSD=activas.filter(o=>o.tipo_oc==="Importación").reduce((s,o)=>s+(o.total_usd||0),0)

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div><div style={{fontSize:22,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Productos en tránsito</div><div style={{fontSize:13,color:"#8E8E93"}}>{activas.length} OC activas · {totalItems} productos · {fN(totalUds)} unidades</div></div>
      <Bt v="gry" onClick={exportCSV} sm ic="📥">Exportar CSV</Bt>
    </div>

    <div style={{display:"flex",gap:8,marginBottom:14}}>
      <div style={{background:"#fff",borderRadius:10,padding:"10px 16px",boxShadow:"0 1px 2px rgba(0,0,0,0.04)",flex:1,textAlign:"center"}}><div style={{fontSize:20,fontWeight:700,color:"#007AFF"}}>{activas.length}</div><div style={{fontSize:10,color:"#8E8E93"}}>OC activas</div></div>
      <div style={{background:"#fff",borderRadius:10,padding:"10px 16px",boxShadow:"0 1px 2px rgba(0,0,0,0.04)",flex:1,textAlign:"center"}}><div style={{fontSize:20,fontWeight:700,color:"#1C1C1E"}}>{fN(totalUds)}</div><div style={{fontSize:10,color:"#8E8E93"}}>Unidades</div></div>
      <div style={{background:"#fff",borderRadius:10,padding:"10px 16px",boxShadow:"0 1px 2px rgba(0,0,0,0.04)",flex:1,textAlign:"center"}}><div style={{fontSize:20,fontWeight:700,color:"#34C759"}}>{fmt(totalMonto)}</div><div style={{fontSize:10,color:"#8E8E93"}}>Monto total{totalUSD>0?<span style={{display:"block",fontSize:10,color:"#007AFF",fontWeight:600,marginTop:2}}>{fU(totalUSD)} en IMP</span>:null}</div></div>
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
function FinanzasView({ocs,provs,pagos,setPagos,config={}}){
  const TC_USD=Number(config.tc_usd)||950
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

  const enCLP=h=>h.moneda==="USD"?h.monto*TC_USD:h.monto

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
      if(!map[k])map[k]={lunes,hitos:[],total:0,totalUSD:0}
      map[k].hitos.push(h);map[k].total+=enCLP(h)
      if(h.moneda==="USD")map[k].totalUSD+=h.monto
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
        <div style={{fontSize:13,color:"#8E8E93"}}>{aprobadas.length} OC activas · {pendientes.length} pagos pendientes · {fmt(totalPend)} comprometido {totalUSD>0?<span style={{color:"#34C759",fontWeight:600}}>(incluye {fU(totalUSD)} convertidos a TC ${fN(TC_USD)})</span>:null}</div>
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
      {(()=>{
        // helper: retorna sub string con breakdown de moneda
        const subMoneda=(arr)=>{
          const cnt=arr.length
          const usdArr=arr.filter(h=>h.moneda==="USD")
          const usdSum=usdArr.reduce((s,h)=>s+h.monto,0)
          if(usdSum>0)return `${cnt} pagos · ${fU(usdSum)} + CLP`
          return `${cnt} pagos`
        }
        return<>
          <Mt l="Vencidos" v={fmt(totalVenc)} sub={subMoneda(vencidos)} ac={vencidos.length?"#FF3B30":"#34C759"} ic="⚠️"/>
          <Mt l="Próx. 7 días" v={fmt(prox7.reduce((s,h)=>s+enCLP(h),0))} sub={subMoneda(prox7)} ac="#FF9500" ic="🔴"/>
          <Mt l="Próx. 30 días" v={fmt(total30)} sub={subMoneda(prox30)} ac="#007AFF" ic="📅"/>
          <Mt l="Próx. 60 días" v={fmt(total60)} sub={subMoneda(prox60)} ac="#5856D6" ic="📆"/>
          <Mt l="Próx. 90 días" v={fmt(total90)} sub={subMoneda(prox90)} ac="#AF52DE" ic="🗓"/>
        </>
      })()}
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
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:18,fontWeight:800,color:"#007AFF",letterSpacing:"-0.02em"}}>{fmt(sem.total)}</div>
              {sem.totalUSD>0&&<div style={{fontSize:10,color:"#34C759",fontWeight:600}}>{fU(sem.totalUSD)} × TC ${fN(TC_USD)}</div>}
            </div>
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
  const[vista,setVista]=useState("nacional") // nacional | importacion | decalogo

  // ═══════════════════════════════════════════════════════════
  // DEFINICIÓN DE ETAPAS — detalladas por tipo de OC
  // ═══════════════════════════════════════════════════════════

  // FLUJO NACIONAL — 7 etapas
  const etapasNac=[
    {n:1,k:"solicitud",l:"Solicitud",ic:"📝",c:"#007AFF",rol:"Analista",cargo:"Analista de Compras",accion:"Genera la OC desde el módulo de Reposición o importa desde Excel",entrega:"OC creada con productos, proveedor, destino y plan de pago",sla:"24h",estados:[]},
    {n:2,k:"negocios",l:"Aprobación Negocios",ic:"✓",c:"#007AFF",rol:"Dir. Negocios",cargo:"Director de Negocios",accion:"Revisa proveedor, cantidades, precios y necesidad comercial. Firma aprobación.",entrega:"OC validada comercialmente · Firma registrada",sla:"24h",estados:["Pend. Dir. Negocios"]},
    {n:3,k:"finanzas",l:"Aprobación Finanzas",ic:"💰",c:"#AF52DE",rol:"Dir. Finanzas",cargo:"Director de Finanzas / JP Reyes",accion:"Evalúa disponibilidad de caja, plan de pago y presupuesto. Firma o rechaza.",entrega:"Autorización financiera · Si rechaza: se reenvía al 7° día",sla:"24h",estados:["Pend. Dir. Finanzas"]},
    {n:4,k:"proveedor",l:"Curse a proveedor",ic:"🔄",c:"#FF9500",rol:"Analista",cargo:"Analista de Compras",accion:"Envía la OC al proveedor. Recibe confirmación de cantidades y tiempos.",entrega:"Proveedor confirmó la OC · Guía de despacho agendada",sla:"2-5 días",estados:["Pend. proveedor","Confirmada prov."]},
    {n:5,k:"despacho",l:"Despacho nacional",ic:"🚚",c:"#AF52DE",rol:"Jefe Operaciones",cargo:"Jefe de Operaciones",accion:"Coordina transporte y fecha de llegada al CD Maipú (o sucursal directa).",entrega:"Mercadería en ruta · ETA confirmada",sla:"3-10 días",estados:["Despacho nac."]},
    {n:6,k:"recepcion",l:"Recepción",ic:"📦",c:"#FF9500",rol:"Jefe Bodega",cargo:"Jefe de Bodega / Analista",accion:"Recibe mercadería, verifica cantidades, registra guías y facturas. Detecta discrepancias.",entrega:"Stock actualizado en BSALE · Factura registrada",sla:"24h",estados:["Recibida parcial","Recibida OK"]},
    {n:7,k:"cierre",l:"Cierre",ic:"📋",c:"#34C759",rol:"Analista",cargo:"Analista de Compras",accion:"Valida que todos los pagos estén realizados, DTE registrados y sin discrepancias.",entrega:"OC cerrada formalmente · Ingresa al histórico",sla:"Al pagar",estados:["Cerrada"]}
  ]

  // FLUJO IMPORTACIÓN — 12 etapas (nuevo diseño)
  const etapasImp=[
    {n:1,k:"solicitud",l:"Solicitud",ic:"📝",c:"#007AFF",rol:"Analista",cargo:"Analista de Compras",accion:"Genera la OC de importación. Define proveedor internacional, cantidades, plan de pago (% fab/emb/saldo) y ETA.",entrega:"OC creada con productos, plan de pago internacional y términos",sla:"72h",estados:[]},
    {n:2,k:"negocios",l:"Aprobación Negocios",ic:"✓",c:"#007AFF",rol:"Dir. Negocios",cargo:"Director de Negocios",accion:"Revisa tendencia de ventas, forecast y necesidad estratégica. Aprueba la compra internacional.",entrega:"OC validada comercialmente",sla:"24h",estados:["Pend. Dir. Negocios"]},
    {n:3,k:"proyectar_costeo",l:"Proyectar Costeo",ic:"🧮",c:"#5856D6",rol:"Analista",cargo:"Analista de Compras",accion:"Desde el módulo Costeo: calcula el costo unitario final incluyendo flete, seguro, aduana, gastos en puerto y márgenes. Anexa el costeo al historial de la OC.",entrega:"Costeo proyectado anexado · Margen estimado por producto",sla:"24h",estados:["Proyectar costeo"],critica:true},
    {n:4,k:"finanzas",l:"Aprobación Finanzas",ic:"💰",c:"#AF52DE",rol:"Dir. Finanzas",cargo:"Director de Finanzas",accion:"Revisa el costeo proyectado, flujo de caja USD y capacidad de financiamiento. Aprueba la inversión total.",entrega:"Autorización financiera para curso internacional",sla:"48h",estados:["Pend. Dir. Finanzas"]},
    {n:5,k:"proforma",l:"Proforma / Proveedor",ic:"📄",c:"#FF9500",rol:"Analista + Dir. Operaciones",cargo:"Analista · Valida: Dir. Operaciones",accion:"Analista envía la OC al proveedor. Recibe proforma. Dir. Operaciones valida cantidades confirmadas Y forma de pago (% fab/emb/saldo).",entrega:"Proforma aceptada · Plan de pago firmado",sla:"3-7 días",estados:["Pend. proveedor","Proforma OK"],critica:true},
    {n:6,k:"pago_fab",l:"Pago Fabricación",ic:"💸",c:"#FF9500",rol:"Dir. Finanzas",cargo:"Director de Finanzas",accion:"Ejecuta el % de pago de fabricación al proveedor internacional. Sube comprobante a la OC.",entrega:"Comprobante de pago anexado · Producción iniciada",sla:"Al confirmar proforma",estados:["Pago fabricación"]},
    {n:7,k:"pago_emb",l:"Pago Embarque",ic:"🚢",c:"#FF9500",rol:"Dir. Finanzas",cargo:"Director de Finanzas",accion:"Ejecuta el % de pago de embarque al proveedor. Sube comprobante. Mercadería zarpa.",entrega:"Comprobante de embarque anexado · B/L recibido",sla:"Al embarcar",estados:["Pago embarque"]},
    {n:8,k:"internacion",l:"Internación",ic:"🏛",c:"#FF3B30",rol:"Agente de Aduana",cargo:"Agente externo · Gestiona: Analista",accion:"Agente aduana gestiona: Bill of Lading, DIN, IVA, arancel. Analista anexa pagos: naviera, aduana, transporte local, seguros.",entrega:"Carga liberada · DIN y comprobantes anexados",sla:"5-15 días",estados:["Internación"]},
    {n:9,k:"costeo_final",l:"Validar Costeo Final",ic:"🎯",c:"#5856D6",rol:"Analista",cargo:"Analista de Compras",accion:"Al recibir todos los comprobantes reales (naviera, aduana, agente, transporte, seguros), actualiza el costeo en el módulo. Compara vs proyectado y ajusta márgenes.",entrega:"Costeo final validado · Márgenes reales actualizados",sla:"24h",estados:["Validar costeo final"],critica:true},
    {n:10,k:"transporte",l:"Transporte local",ic:"🚛",c:"#AF52DE",rol:"Jefe Operaciones",cargo:"Jefe de Operaciones",accion:"Coordina el retiro desde el puerto hasta el CD Maipú. Verifica seguro de transporte terrestre.",entrega:"Mercadería en ruta al CD",sla:"1-3 días",estados:["Transporte"]},
    {n:11,k:"recepcion",l:"Recepción",ic:"📦",c:"#FF9500",rol:"Jefe Bodega",cargo:"Jefe de Bodega",accion:"Recibe carga en CD, verifica unidades vs DIN, registra en BSALE, actualiza stock.",entrega:"Stock actualizado · Reparto a sucursales si corresponde",sla:"48h",estados:["Recibida parcial","Recibida OK"]},
    {n:12,k:"cierre",l:"Cierre",ic:"✅",c:"#34C759",rol:"Analista + Dir. Finanzas",cargo:"Analista + Dir. Finanzas",accion:"Valida que todos los pagos estén realizados, sin pendientes con agente aduana, y cierra la OC.",entrega:"OC cerrada · Integrada al histórico de costeos",sla:"Al completar pagos",estados:["Cerrada"]}
  ]

  // DECÁLOGO DE TÉRMINOS Y CONCEPTOS
  const decalogo=[
    {ic:"🏭",t:"FOB (Free On Board)",d:"Costo del producto puesto en el puerto de origen (ej: Shangai). Incluye el precio pagado al proveedor más el transporte interno hasta el barco. No incluye flete marítimo ni seguro."},
    {ic:"🚢",t:"CFR / CIF",d:"CFR (Cost + Freight) = FOB + Flete marítimo · CIF (Cost + Insurance + Freight) = CFR + Seguro. Son los términos Incoterms que definen hasta dónde llega la responsabilidad del vendedor."},
    {ic:"🏛",t:"Ad Valorem",d:"Arancel aduanero calculado como % del valor CIF. En Chile con TLC con China = 0%. Sin TLC, varía según código HTS del producto."},
    {ic:"💰",t:"IVA Importación",d:"19% sobre el valor CIF + Ad Valorem. Es crédito fiscal recuperable contra IVA de ventas. Se paga al momento de la internación."},
    {ic:"📋",t:"DIN",d:"Declaración de Internación. Documento oficial que el agente aduana presenta al SII con todos los datos del embarque. Es el \"DNI\" aduanero de la mercadería."},
    {ic:"📄",t:"Bill of Lading (B/L)",d:"Documento emitido por la naviera que acredita el embarque. Funciona como título de propiedad de la mercadería durante el tránsito marítimo."},
    {ic:"🧮",t:"Prorrateo por FOB",d:"Metodología para distribuir los gastos comunes (flete, seguro, aduana, etc.) entre los productos del embarque en proporción a su valor FOB. Usado por la plantilla NV_COTIZACION."},
    {ic:"🔄",t:"Proforma",d:"Documento preliminar del proveedor que confirma cantidades, precios y forma de pago antes de emitir factura. Debe coincidir con la OC o generar un ajuste."},
    {ic:"⏳",t:"Plan de pago IMP",d:"Típicamente 3 cuotas: % fabricación (al iniciar producción) · % embarque (al zarpar) · % saldo (antes del arribo o al internar). Debe sumar 100%."},
    {ic:"🎯",t:"Costeo proyectado vs final",d:"Proyectado: cálculo inicial con valores estimados (después de Negocios). Final: recálculo con gastos reales (después de Internación). Permite comparar desviación y ajustar precios de venta."},
    {ic:"📦",t:"CD Maipú",d:"Centro de Distribución en Maipú. Destino por defecto de todas las OCs. Desde ahí se redistribuye a Los Ángeles y La Granja. Excepcionalmente una OC puede ir directo a sucursal."},
    {ic:"🔑",t:"SLA",d:"Service Level Agreement: tiempo máximo esperado para completar una etapa. Ej: \"24h\" significa que esa etapa debe resolverse en 24 horas desde que ingresa."},
    {ic:"💳",t:"Condición de pago NAC",d:"Para OC nacional: Contado, Crédito 15/30/45/60/90 días. Define cuándo se paga al proveedor desde la fecha de recepción."},
    {ic:"📊",t:"Clasificación ABCD",d:"A: productos que generan el 80% de las ventas (críticos) · B: siguiente 15% · C: 4% · D: 1% (marginales). Define prioridad de reposición y niveles de stock objetivo."},
    {ic:"🚨",t:"Pre-quiebre",d:"Stock cayendo bajo el punto de reorden antes del tiempo proyectado, usualmente por una venta mayor al promedio. Dispara alerta inmediata al analista."}
  ]

  const roles={
    "Analista":{c:"#007AFF",bg:"#007AFF10"},
    "Dir. Negocios":{c:"#007AFF",bg:"#007AFF10"},
    "Dir. Finanzas":{c:"#AF52DE",bg:"#AF52DE10"},
    "Dir. Operaciones":{c:"#5AC8FA",bg:"#5AC8FA10"},
    "Jefe Operaciones":{c:"#FF9500",bg:"#FF950010"},
    "Jefe Bodega":{c:"#FF9500",bg:"#FF950010"},
    "Agente de Aduana":{c:"#FF3B30",bg:"#FF3B3010"},
    "Analista + Dir. Operaciones":{c:"#5856D6",bg:"#5856D610"},
    "Analista + Dir. Finanzas":{c:"#34C759",bg:"#34C75910"}
  }

  const ocsActivasImp=ocs.filter(o=>o.tipo_oc==="Importación"&&!["Cerrada","Rechazada"].includes(o.estado))
  const ocsActivasNac=ocs.filter(o=>o.tipo_oc==="Nacional"&&!["Cerrada","Rechazada"].includes(o.estado))

  // Contar OCs por etapa
  const contarOCs=(etapa,tipo)=>{
    const filt=tipo==="IMP"?ocsActivasImp:ocsActivasNac
    if(!etapa.estados||etapa.estados.length===0)return 0
    return filt.filter(o=>etapa.estados.includes(o.estado)).length
  }

  return<div>
    {/* Header */}
    <div style={{background:"linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)",borderRadius:16,padding:"20px 24px",marginBottom:14,color:"#fff",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:-60,right:-60,width:200,height:200,borderRadius:"50%",background:"radial-gradient(circle,#5AC8FA30 0%,transparent 70%)",pointerEvents:"none"}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:14,position:"relative"}}>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.5)",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>Proceso de compras · SOP P07 v2.0</div>
          <div style={{fontSize:24,fontWeight:800,letterSpacing:"-0.02em",lineHeight:1}}>Flujograma operativo</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",marginTop:6}}>{ocsActivasNac.length} Nac · {ocsActivasImp.length} IMP activas · Click en etapa para ver OCs</div>
        </div>
        <div style={{display:"flex",gap:4,background:"rgba(255,255,255,0.08)",borderRadius:10,padding:3}}>
          <button onClick={()=>setVista("nacional")} style={{padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:vista==="nacional"?"#fff":"transparent",color:vista==="nacional"?"#1C1C1E":"rgba(255,255,255,0.7)"}}>🇨🇱 Nacional ({etapasNac.length})</button>
          <button onClick={()=>setVista("importacion")} style={{padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:vista==="importacion"?"#fff":"transparent",color:vista==="importacion"?"#1C1C1E":"rgba(255,255,255,0.7)"}}>🌍 Importación ({etapasImp.length})</button>
          <button onClick={()=>setVista("decalogo")} style={{padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:vista==="decalogo"?"#fff":"transparent",color:vista==="decalogo"?"#1C1C1E":"rgba(255,255,255,0.7)"}}>📖 Decálogo</button>
        </div>
      </div>
    </div>

    {/* ═══ VISTA NACIONAL ═══ */}
    {vista==="nacional"&&<div>
      <div style={{background:"#fff",borderRadius:14,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
          <div style={{width:36,height:36,borderRadius:18,background:"#007AFF",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🇨🇱</div>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:"#1C1C1E"}}>Flujo de Orden de Compra Nacional</div>
            <div style={{fontSize:12,color:"#8E8E93"}}>7 etapas · Tiempo promedio: 5-15 días</div>
          </div>
        </div>
      </div>

      <EtapaRender etapas={etapasNac} contarOCs={(e)=>contarOCs(e,"NAC")} roles={roles} ocs={ocsActivasNac} setDet={setDet} provs={provs}/>
    </div>}

    {/* ═══ VISTA IMPORTACIÓN ═══ */}
    {vista==="importacion"&&<div>
      <div style={{background:"#fff",borderRadius:14,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
          <div style={{width:36,height:36,borderRadius:18,background:"#FF3B30",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🌍</div>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:"#1C1C1E"}}>Flujo de Orden de Compra Importación</div>
            <div style={{fontSize:12,color:"#8E8E93"}}>12 etapas · Tiempo promedio: 60-90 días · Incluye 2 validaciones de costeo</div>
          </div>
        </div>
        <div style={{marginTop:12,padding:"10px 12px",background:"#5856D608",borderRadius:8,borderLeft:"3px solid #5856D6"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#5856D6",marginBottom:4}}>🎯 ETAPAS CRÍTICAS</div>
          <div style={{fontSize:11,color:"#636366",lineHeight:1.5}}>Proyectar Costeo (#3) · Proforma (#5) · Validar Costeo Final (#9) son las etapas donde el analista debe ser riguroso porque impactan directamente en el margen final del producto.</div>
        </div>
      </div>

      <EtapaRender etapas={etapasImp} contarOCs={(e)=>contarOCs(e,"IMP")} roles={roles} ocs={ocsActivasImp} setDet={setDet} provs={provs}/>
    </div>}

    {/* ═══ VISTA DECÁLOGO ═══ */}
    {vista==="decalogo"&&<div>
      <div style={{background:"#fff",borderRadius:14,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,borderRadius:18,background:"#34C759",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>📖</div>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:"#1C1C1E"}}>Decálogo de términos y conceptos</div>
            <div style={{fontSize:12,color:"#8E8E93"}}>Glosario de términos usados en el proceso de compras e importación · {decalogo.length} conceptos</div>
          </div>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:12}}>
        {decalogo.map((d,i)=><div key={i} style={{background:"#fff",borderRadius:12,padding:"14px 16px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:"3px solid #34C759"}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
            <div style={{fontSize:22,flexShrink:0}}>{d.ic}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:800,color:"#1C1C1E",marginBottom:4}}>{d.t}</div>
              <div style={{fontSize:11,color:"#636366",lineHeight:1.5}}>{d.d}</div>
            </div>
          </div>
        </div>)}
      </div>

      <div style={{marginTop:14,background:"#FFF8E7",borderRadius:12,padding:"14px 18px",border:"1px solid #FFE4A0"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#946200",marginBottom:8}}>💡 ¿Cómo usar este decálogo?</div>
        <div style={{fontSize:12,color:"#636366",lineHeight:1.6}}>
          Este glosario está diseñado para resolver dudas frecuentes sin tener que consultar al equipo. Si no encontrás un término acá, revisá el <b>Manual ERP v2</b> (botón 📖 Manual arriba) o preguntá al Analista de Compras. Los conceptos están ordenados desde los más técnicos de importación hasta los operativos del día a día.
        </div>
      </div>
    </div>}
  </div>
}

// Componente auxiliar que renderiza una lista de etapas como cards verticales conectadas
function EtapaRender({etapas,contarOCs,roles,ocs,setDet,provs}){
  const[expandida,setExpandida]=useState(null)

  return<div style={{display:"flex",flexDirection:"column",gap:0,position:"relative"}}>
    {etapas.map((e,idx)=>{
      const count=contarOCs(e)
      const role=roles[e.rol]||{c:"#8E8E93",bg:"#8E8E9310"}
      const isExp=expandida===e.k
      const ocsEnEtapa=e.estados&&e.estados.length>0?ocs.filter(o=>e.estados.includes(o.estado)):[]
      const esUltima=idx===etapas.length-1

      return<div key={e.k} style={{position:"relative"}}>
        {/* Línea conectora */}
        {!esUltima&&<div style={{position:"absolute",left:28,top:68,bottom:-12,width:3,background:`linear-gradient(to bottom, ${e.c}80, ${etapas[idx+1]?.c||"#E5E5EA"}80)`,zIndex:0}}/>}

        <div style={{display:"flex",gap:14,marginBottom:12,position:"relative",zIndex:1}}>
          {/* Círculo de número */}
          <div style={{width:56,height:56,borderRadius:28,background:`linear-gradient(135deg, ${e.c}, ${e.c}dd)`,color:"#fff",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:`0 4px 12px ${e.c}40`,border:e.critica?"3px solid #FF3B30":"none"}}>
            <div style={{fontSize:11,fontWeight:800,opacity:0.8,lineHeight:1}}>ETAPA</div>
            <div style={{fontSize:20,fontWeight:800,lineHeight:1,marginTop:2}}>{e.n}</div>
          </div>

          {/* Card de etapa */}
          <div style={{flex:1,background:"#fff",borderRadius:12,padding:"14px 18px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:`4px solid ${e.c}`,cursor:"pointer"}} onClick={()=>setExpandida(isExp?null:e.k)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
              <div style={{flex:1,minWidth:240}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{fontSize:20}}>{e.ic}</span>
                  <span style={{fontSize:15,fontWeight:800,color:"#1C1C1E"}}>{e.l}</span>
                  {e.critica&&<span style={{fontSize:9,fontWeight:700,color:"#fff",background:"#FF3B30",padding:"2px 6px",borderRadius:4}}>CRÍTICA</span>}
                </div>
                <div style={{fontSize:12,color:"#636366",lineHeight:1.5,marginBottom:8}}>{e.accion}</div>

                {/* Meta info */}
                <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}>
                  <span style={{fontSize:10,fontWeight:700,color:role.c,background:role.bg,padding:"3px 8px",borderRadius:4}}>👤 {e.rol}</span>
                  <span style={{fontSize:10,fontWeight:600,color:"#8E8E93",background:"#F2F2F7",padding:"3px 8px",borderRadius:4}}>⏱ {e.sla}</span>
                  {count>0&&<span style={{fontSize:10,fontWeight:700,color:e.c,background:e.c+"15",padding:"3px 8px",borderRadius:4}}>{count} OC{count>1?"s":""} aquí</span>}
                </div>
              </div>

              {/* Click para expandir */}
              <div style={{color:"#AEAEB2",fontSize:10,fontWeight:600}}>{isExp?"▲ Ocultar":"▼ Ver detalle"}</div>
            </div>

            {/* Detalle expandido */}
            {isExp&&<div style={{marginTop:14,padding:"12px 14px",background:"#F8F8FA",borderRadius:8}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:10}}>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",marginBottom:3}}>Responsable</div>
                  <div style={{fontSize:12,fontWeight:600,color:"#1C1C1E"}}>{e.cargo}</div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",marginBottom:3}}>Entregable</div>
                  <div style={{fontSize:12,color:"#1C1C1E"}}>{e.entrega}</div>
                </div>
              </div>

              {/* OCs en esta etapa */}
              {ocsEnEtapa.length>0&&<div>
                <div style={{fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",marginBottom:6}}>OCs en esta etapa</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:6}}>
                  {ocsEnEtapa.map(oc=>{
                    const pv=provs.find(p=>p.id===oc.proveedor_id)
                    const dias=Math.abs(diff(oc.fecha_creacion))
                    return<div key={oc.id} onClick={ev=>{ev.stopPropagation();setDet&&setDet(oc)}} style={{padding:"8px 10px",background:"#fff",borderRadius:6,border:`1px solid ${e.c}30`,cursor:"pointer"}}>
                      <div style={{fontSize:11,fontWeight:700,fontFamily:"monospace"}}>{oc.id}</div>
                      <div style={{fontSize:10,color:"#636366",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pv?.nombre||oc.proveedor_id}</div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
                        <span style={{fontSize:10,color:"#8E8E93"}}>{fmt(oc.total_clp)}</span>
                        <span style={{fontSize:10,fontWeight:600,color:dias>14?"#FF3B30":dias>7?"#FF9500":"#34C759"}}>{dias}d</span>
                      </div>
                    </div>
                  })}
                </div>
              </div>}
            </div>}
          </div>
        </div>
      </div>
    })}
  </div>
}

/* ═══ CONFIG ═══ */
function ConfigView({config,saveConfig,params,setParams,paramsABCD,setParamsABCD,provs,setProvs,users,setUsers,sucursales=[],setSucursales,h,configTab,setConfigTab,loadAll,cu}){
  const isAdmin=cu?.rol==="admin"||cu?.rol==="dir_general"
  const allTabs=[{k:"params",l:"Reposición",ic:"📊",all:true},{k:"bsale",l:"BSALE",ic:"🔗",all:true},{k:"provs",l:"Proveedores",ic:"🏢",all:true},{k:"sucursales",l:"Sucursales",ic:"🏬",all:false},{k:"users",l:"Usuarios",ic:"👤",all:false},{k:"permisos",l:"Permisos",ic:"🔑",all:false},{k:"notifs",l:"Notificaciones",ic:"🔔",all:false},{k:"audit",l:"Auditoría",ic:"📜",all:false},{k:"email",l:"Email",ic:"📧",all:false}]
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

      {/* ⭐ v48: Parámetros avanzados del cálculo de venta promedio */}
      <Cd s={{marginTop:10}}><div style={{fontSize:15,fontWeight:700,marginBottom:4}}>Parámetros avanzados del promedio de venta</div>
        <div style={{fontSize:12,color:"#8E8E93",marginBottom:12}}>Estos parámetros afectan tanto al cálculo de reposición como al módulo de Cobertura.</div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div style={{background:"#FF950010",borderRadius:10,padding:14,border:"1px solid #FF950030"}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
              <input type="checkbox" checked={config.excluir_mes_actual!=="false"} onChange={e=>saveConfig("excluir_mes_actual",e.target.checked?"true":"false")} style={{width:18,height:18,accentColor:"#FF9500"}}/>
              <span style={{fontSize:13,fontWeight:700}}>Excluir mes en curso</span>
            </label>
            <div style={{fontSize:11,color:"#8E8E93",marginTop:6,lineHeight:1.5}}>El último mes del reporte BSALE está parcial (se está cursando). Si está activo, se ignora del cálculo de venta promedio para evitar subestimar la demanda real.</div>
            <div style={{marginTop:8}}>
              <Bd c={config.excluir_mes_actual!=="false"?"#34C759":"#8E8E93"} bg={config.excluir_mes_actual!=="false"?"#34C75915":"#8E8E9315"}>
                {config.excluir_mes_actual!=="false"?`✓ Usando ${(Number(config.meses_analisis)||4)-1} meses completos`:`Usando los ${Number(config.meses_analisis)||4} meses (incluyendo mes en curso)`}
              </Bd>
            </div>
          </div>

          <div style={{background:"#fff",borderRadius:10,padding:14,border:"1px solid #E5E5EA"}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>Meses totales del reporte</div>
            <select value={config.meses_analisis||4} onChange={e=>saveConfig("meses_analisis",e.target.value)} style={css.select}>
              <option value={3}>3 meses</option>
              <option value={4}>4 meses</option>
              <option value={6}>6 meses</option>
              <option value={12}>12 meses</option>
            </select>
            <div style={{fontSize:11,color:"#8E8E93",marginTop:8,lineHeight:1.5}}>Cantidad total de meses de venta que trae el Excel BSALE. El promedio se calcula sobre estos (menos 1 si "Excluir mes en curso" está activo).</div>
          </div>
        </div>

        <div style={{marginTop:12,padding:"10px 14px",background:"#007AFF08",borderRadius:8,fontSize:11,color:"#3A3A3C"}}>
          💡 <strong>Ejemplo</strong>: si subiste un reporte con 4 meses (Ene/Feb/Mar/Abr) y estamos en abril, con "Excluir mes en curso" activado el promedio se calcula solo con Ene/Feb/Mar (3 meses completos), ignorando abril que está parcial.
        </div>
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

    {configTab==="notifs"&&<NotifConfigView users={users}/>}

    {configTab==="audit"&&<AuditView cu={cu} loadAll={loadAll}/>}
    {configTab==="email"&&<EmailLauncherView cu={cu} config={config} saveConfig={saveConfig}/>}
  </div>
}

/* ═══ AUDIT VIEW ═══ */
/* ═══ NOTIF CONFIG VIEW — Asignación de destinatarios por estado de OC (v48) ═══ */
function NotifConfigView({users=[]}){
  const[rows,setRows]=useState([])
  const[loading,setLoading]=useState(false)
  const[saving,setSaving]=useState(null)
  const[msg,setMsg]=useState("")

  const cargar=async()=>{
    setLoading(true)
    const{data,error}=await supabase.from('config_notificaciones').select('*').order('estado_oc')
    if(error){alert("Error cargando config: "+error.message);setLoading(false);return}
    setRows(data||[])
    setLoading(false)
  }
  useEffect(()=>{cargar()},[])

  const actualizar=async(estado,campo,valor)=>{
    setSaving(estado)
    const{error}=await supabase.from('config_notificaciones').update({[campo]:valor,updated_at:new Date().toISOString()}).eq('estado_oc',estado)
    if(error){alert("Error guardando: "+error.message);setSaving(null);return}
    setRows(prev=>prev.map(r=>r.estado_oc===estado?{...r,[campo]:valor}:r))
    setMsg(`✓ Guardado en ${estado}`)
    setTimeout(()=>setMsg(""),2000)
    setSaving(null)
  }

  const usuariosActivos=users.filter(u=>u.activo&&u.correo&&u.correo.includes("@"))

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontSize:15,fontWeight:700}}>🔔 Destinatarios de notificaciones por etapa</div>
        <div style={{fontSize:11,color:"#8E8E93",marginTop:2}}>Asigná qué usuario recibe el email cuando una OC entra a cada estado del flujo. {rows.length} estados configurables.</div>
      </div>
      <Bt sm v="gry" onClick={cargar} ic={loading?"⏳":"🔄"} dis={loading}>{loading?"Cargando":"Refrescar"}</Bt>
    </div>

    {msg&&<div style={{padding:"8px 12px",background:"#34C75915",borderRadius:8,color:"#34C759",fontSize:12,fontWeight:600,marginBottom:10}}>{msg}</div>}

    <div style={{background:"#fff",borderRadius:10,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:"#F2F2F7"}}>
          <th style={{padding:"10px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",letterSpacing:"0.04em"}}>Estado de la OC</th>
          <th style={{padding:"10px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",letterSpacing:"0.04em"}}>Usuario destinatario</th>
          <th style={{padding:"10px 12px",textAlign:"center",fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",letterSpacing:"0.04em",width:90}}>CC Admin</th>
          <th style={{padding:"10px 12px",textAlign:"center",fontSize:10,fontWeight:700,color:"#8E8E93",textTransform:"uppercase",letterSpacing:"0.04em",width:80}}>Activo</th>
        </tr></thead>
        <tbody>
          {rows.map(r=>{
            const estaGuardando=saving===r.estado_oc
            const destinatario=usuariosActivos.find(u=>u.id===r.usuario_destino_id)
            const sinDestino=!r.usuario_destino_id&&!r.cc_admin
            return<tr key={r.estado_oc} style={{borderTop:"1px solid #F2F2F7",background:sinDestino?"#FFF9E6":"#fff"}}>
              <td style={{padding:"10px 12px",verticalAlign:"top"}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <Bd c={STS[r.estado_oc]?.c} bg={STS[r.estado_oc]?.bg}>{STS[r.estado_oc]?.ic} {r.estado_oc}</Bd>
                  {sinDestino&&<Bd c="#FF9500" bg="#FF950015">⚠ sin destino</Bd>}
                </div>
                {r.descripcion&&<div style={{fontSize:11,color:"#8E8E93",marginTop:4}}>{r.descripcion}</div>}
              </td>
              <td style={{padding:"10px 12px",verticalAlign:"top"}}>
                <select value={r.usuario_destino_id||""} onChange={e=>actualizar(r.estado_oc,'usuario_destino_id',e.target.value||null)} disabled={estaGuardando} style={{...css.select,fontSize:12}}>
                  <option value="">— Nadie asignado —</option>
                  {usuariosActivos.map(u=><option key={u.id} value={u.id}>{u.nombre} ({u.rol}) · {u.correo}</option>)}
                </select>
                {destinatario&&<div style={{fontSize:10,color:"#8E8E93",marginTop:3}}>Actual: {destinatario.correo}</div>}
              </td>
              <td style={{padding:"10px 12px",textAlign:"center",verticalAlign:"top"}}>
                <label style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer"}}>
                  <input type="checkbox" checked={!!r.cc_admin} onChange={e=>actualizar(r.estado_oc,'cc_admin',e.target.checked)} disabled={estaGuardando} style={{width:16,height:16}}/>
                </label>
              </td>
              <td style={{padding:"10px 12px",textAlign:"center",verticalAlign:"top"}}>
                <label style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer"}}>
                  <input type="checkbox" checked={!!r.activo} onChange={e=>actualizar(r.estado_oc,'activo',e.target.checked)} disabled={estaGuardando} style={{width:16,height:16}}/>
                </label>
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </div>

    <div style={{marginTop:14,padding:"10px 12px",background:"#007AFF10",borderRadius:8,fontSize:12,color:"#3A3A3C"}}>
      💡 <strong>Cómo funciona:</strong> cuando una OC cambia a uno de estos estados, el sistema envía un email al usuario seleccionado. Si "CC Admin" está marcado, también se envía una copia a todos los usuarios con rol admin. Las filas amarillas no tienen destinatario y no enviarán nada.
    </div>
  </div>
}

function AuditView({cu,loadAll}){
  const[logs,setLogs]=useState([])
  const[loading,setLoading]=useState(false)
  const[filtroOp,setFiltroOp]=useState("T") // T | INSERT | UPDATE | DELETE
  const[filtroTabla,setFiltroTabla]=useState("T")
  const[q,setQ]=useState("")
  const[limit,setLimit]=useState(100)
  const[expanded,setExpanded]=useState(null)
  const[restoring,setRestoring]=useState(null)
  // ⭐ v47: Estado separado para OCs eliminadas — query dedicada sin depender del límite
  const[ocsEliminadas,setOcsEliminadas]=useState([])

  const cargar=async()=>{
    setLoading(true)
    const{data,error}=await supabase.from('audit_log').select('*').order('created_at',{ascending:false}).limit(limit)
    if(error){console.error("Error cargando audit_log:",error);alert("Error: "+error.message);setLoading(false);return}
    setLogs(data||[])
    // Query dedicada para DELETE de ordenes_compra (sin límite general)
    const{data:ocsDel}=await supabase.from('audit_log').select('*').eq('tabla','ordenes_compra').eq('operacion','DELETE').order('created_at',{ascending:false}).limit(50)
    setOcsEliminadas(ocsDel||[])
    setLoading(false)
  }
  useEffect(()=>{cargar()},[limit])

  // Filtros
  const tablasUnicas=[...new Set(logs.map(l=>l.tabla).filter(Boolean))].sort()
  const fil=logs.filter(l=>(filtroOp==="T"||l.operacion===filtroOp)&&(filtroTabla==="T"||l.tabla===filtroTabla)&&(!q||(l.usuario_nombre||"").toLowerCase().includes(q.toLowerCase())||(l.oc_id||"").toLowerCase().includes(q.toLowerCase())||(l.registro_id||"").toLowerCase().includes(q.toLowerCase())))

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

  // ⭐ v47: Eliminar definitivamente del audit log (no se puede restaurar más)
  const eliminarDefinitivo=async(log)=>{
    const ocId=log.registro_id||log.oc_id||"?"
    if(!window.confirm(`⚠ ELIMINACIÓN DEFINITIVA\n\nSe borrará el registro de auditoría de la OC ${ocId}.\nDespués de esto NO se podrá restaurar.\n\n¿Continuar?`))return
    setRestoring(log.id)
    try{
      const{error}=await supabase.from('audit_log').delete().eq('id',log.id)
      if(error){alert("Error al eliminar del audit log: "+error.message);setRestoring(null);return}
      alert(`✓ Registro de auditoría de ${ocId} eliminado definitivamente.`)
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
                <div style={{display:"flex",gap:4}}>
                  <Bt sm v="pri" onClick={()=>restaurarOC(log)} dis={restoring===log.id} ic={restoring===log.id?"⏳":"↩"}>{restoring===log.id?"Restaurando":"Restaurar"}</Bt>
                  <Bt sm v="dan" onClick={()=>eliminarDefinitivo(log)} dis={restoring===log.id} ic="🗑">Eliminar def.</Bt>
                </div>
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
                    {l.tabla==="ordenes_compra"&&l.operacion==="DELETE"&&<div style={{marginTop:10,display:"flex",gap:6}}>
                      <Bt sm v="pri" onClick={()=>restaurarOC(l)} dis={restoring===l.id} ic="↩">Restaurar esta OC</Bt>
                      <Bt sm v="dan" onClick={()=>eliminarDefinitivo(l)} dis={restoring===l.id} ic="🗑">Eliminar definitivamente</Bt>
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
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Bt v="pri" sm onClick={guardarConfigEmail} ic="💾">Guardar configuración</Bt>
        <Bt v="suc" sm onClick={async()=>{
          const destinatario=prompt("¿A qué correo enviar el test?",cu?.correo||"jpreyes@outletdepuertas.cl")
          if(!destinatario||!destinatario.includes("@"))return
          if(config.email_activo!=="true"){
            if(!window.confirm("⚠ El envío de emails está desactivado. Esto creará la notificación pero el trigger no la enviará hasta que actives el flag.\n\n¿Crear igual para probar el registro?"))return
          }
          const testNotif={
            id:uid(),
            tipo:"Email",
            destino_correo:destinatario,
            destino_nombre:cu?.nombre||"Test Admin",
            asunto:`🧪 Test de notificaciones — ${new Date().toLocaleString("es-CL")}`,
            mensaje:`Este es un email de prueba del sistema de notificaciones de Outlet de Puertas.\n\nEnviado por: ${cu?.nombre}\nFecha: ${new Date().toLocaleString("es-CL")}\n\nSi recibís este email, el pipeline completo funciona:\n1. ✓ App crea la fila en 'notificaciones'\n2. ✓ Trigger SQL llama a la edge function\n3. ✓ Edge function envía el email\n\nSistema: outlet-compras.netlify.app`,
            estado:"Pendiente",
            usuario:cu?.nombre,
            rol:cu?.rol,
            fecha:hoy(),
            hora:hora()
          }
          const{error}=await supabase.from('notificaciones').insert(testNotif)
          if(error){alert("✕ Error: "+error.message);return}
          alert(`✓ Notificación de test creada para ${destinatario}.\n\nEl trigger SQL debería haberla enviado automáticamente. Revisá:\n1. Tu bandeja de entrada (puede tardar hasta 1 min)\n2. Esta lista (refrescá) — el estado debería pasar a "Enviado"\n3. Los logs de la edge function en Supabase Dashboard`)
          cargar()
        }} ic="🧪">Enviar email de prueba</Bt>
      </div>
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

      // ⭐ v48: config antes del cálculo (para que venta_total lo respete también)
      const excluirMesActual=config.excluir_mes_actual!=="false"
      const totalMesesRep=Number(config.meses_analisis)||4
      const mesesValidosRep=excluirMesActual?Math.max(1,totalMesesRep-1):totalMesesRep
      addLog(`📅 Parámetros: ${mesesValidosRep}/${totalMesesRep} meses${excluirMesActual?" (excluye mes en curso)":""}, umbral quiebre ${Math.round(umbral*100)}%`,"success")

      // Calculate venta_total (sobre meses válidos) y sort for ABCD
      for(const p of prodList){
        const allMeses=[p.venta_mes_1,p.venta_mes_2,p.venta_mes_3,p.venta_mes_4].slice(0,totalMesesRep)
        const mesesParaTotal=excluirMesActual?allMeses.slice(0,mesesValidosRep):allMeses
        p.venta_total=mesesParaTotal.reduce((s,v)=>s+(v||0),0)
      }
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
      let quiebreCount=0
      let compensadoCount=0
      for(const p of prodList){
        const tp=(pTypes||[]).find(t=>t.tipo_producto===p.tipo_producto)||{dias_fabricacion:30,periodo_cobertura:90}
        const abcd=(pABCD||[]).find(a=>a.clasificacion===p.clasif_abcd)||{dias_emergencia:5}
        p.dias_fabricacion=tp.dias_fabricacion;p.periodo_cubrir=tp.periodo_cobertura;p.dias_emergencia=abcd.dias_emergencia

        // Tomar solo los meses válidos (cortados al total y opcionalmente excluyendo el último)
        const salesRaw=[p.venta_mes_1,p.venta_mes_2,p.venta_mes_3,p.venta_mes_4].slice(0,totalMesesRep)
        const sales=excluirMesActual?salesRaw.slice(0,mesesValidosRep):salesRaw
        const maxMens=Math.max(...sales,0);p.max_mensual=maxMens;p.umbral_quiebre=Math.round(maxMens*umbral)
        const normalM=sales.filter(s=>s>=maxMens*umbral);const breakM=sales.filter(s=>s>0&&s<maxMens*umbral)
        p.meses_quiebre=breakM.length
        if(breakM.length>0)quiebreCount++

        if(maxMens===0){p.vta_prom_compensada=0;p.vta_prom_raw=0;p.factor_compensacion=1}
        else if(breakM.length>0&&normalM.length>=2){
          p.vta_prom_compensada=Math.round(normalM.reduce((s,x)=>s+x,0)/normalM.length)
          // venta_total para raw también respeta los meses considerados
          const ventaTotalConsiderada=sales.reduce((s,x)=>s+x,0)
          p.vta_prom_raw=Math.round(ventaTotalConsiderada/sales.filter(s=>s>0).length||0)
          p.factor_compensacion=p.vta_prom_raw>0?Math.round(p.vta_prom_compensada/p.vta_prom_raw*1000)/1000:1
          compensadoCount++
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
      addLog(`🔍 Quiebres detectados: ${quiebreCount} productos con al menos 1 mes bajo ${Math.round(umbral*100)}% del máximo`,"warn")
      addLog(`⚙️ Compensación aplicada: ${compensadoCount} productos (con ≥2 meses normales Y al menos 1 mes de quiebre)`,"success")
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
