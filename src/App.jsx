import{useState,useEffect,useMemo,useCallback,useRef,Component,Fragment}from'react'
import{preloadCaps,canSync,hasApp}from'./core/permisos'
import{supabase,signIn,signOut,getSession}from'./supabase'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTablePlugin from 'jspdf-autotable'
import{FinanzasApp}from'./finanzas/FinanzasApp'
import{AppHub}from'./finanzas/AppHub'
import{AdminApp}from'./admin/AdminApp'
import{PostventaApp}from'./postventa/PostventaApp'
import{RrhhApp}from'./rrhh/RrhhApp'
import{deepLink}from'./core/deeplink'
import{InventarioApp}from'./inventario/InventarioApp'
import{AgenteApp}from'./agente/AgenteApp'
import{ProyectosApp,PmoGestion}from'./proyectos/ProyectosApp'
import{LogisticaApp}from'./logistica/LogisticaApp'
import{ComercialApp}from'./comercial/ComercialApp'
import{ProcesosApp}from'./procesos/ProcesosApp'
import{ComprasOpApp}from'./compras_op/ComprasOpApp'
import{OCFacturasLibro}from'./OCFacturasLibro'
import{CostosRealesTab}from'./CostosRealesTab'
import{MenuSuperior,MenuMovil,menuVisible}from'./components/MenuErp'
import{DataGrid}from'./finanzas/conciliacion/DataGrid'

/* ═══ HELPERS ═══ */
const fmt=n=>new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n||0)
const fN=n=>new Intl.NumberFormat("es-CL").format(Math.round(n||0))
const fU=n=>"USD "+new Intl.NumberFormat("en-US").format(Math.round(n||0))
const fUD=(n,d=4)=>"USD "+new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:d}).format(n||0)
const fD=(n,d=4)=>new Intl.NumberFormat("es-CL",{minimumFractionDigits:2,maximumFractionDigits:d}).format(n||0)
const hoy=()=>new Date().toLocaleDateString("en-CA",{timeZone:"America/Santiago"}) // Fase 0 (17-oct-2026): fecha de negocio en hora de Chile (antes UTC)
const hora=()=>{const d=new Date();return String(d.getHours()).padStart(2,'0')+":"+String(d.getMinutes()).padStart(2,'0')+":"+String(d.getSeconds()).padStart(2,'0')}
const uid=()=>"id"+Date.now().toString(36)+Math.random().toString(36).slice(2,5)
const pct=v=>Math.round(v*100)+"%"

// ⭐ Genera link de Google Calendar con evento prellenado
const generarLinkCalendar=(oc,provNombre,sucNombre,usersConRecibir=[])=>{
  const fecha=oc.fecha_estimada||hoy()
  const fechaGCal=fecha.replace(/-/g,"")
  const d2=new Date(fecha+"T00:00:00");d2.setDate(d2.getDate()+1)
  const fechaFin=d2.toISOString().slice(0,10).replace(/-/g,"")
  const esImp=oc.tipo_oc==="Importación"
  const titulo=encodeURIComponent("Llegada OC "+oc.id+" - "+provNombre)
  const desc=encodeURIComponent(
    "Orden de Compra: "+oc.id+"\n"+
    "Proveedor: "+provNombre+"\n"+
    "Tipo: "+oc.tipo_oc+"\n"+
    "Total: "+(esImp?"USD "+Math.round(oc.total_usd||0).toLocaleString("es-CL"):"$"+Math.round(oc.total_clp||0).toLocaleString("es-CL"))+"\n"+
    "Destino: "+sucNombre+"\n"+
    "Estado: "+oc.estado+"\n\n"+
    "Generado desde Abastecimiento - Outlet de Puertas SpA"
  )
  const loc=encodeURIComponent(sucNombre||"CD Maipu - Outlet de Puertas SpA")
  const inv=usersConRecibir.map(u=>"&add="+encodeURIComponent(u.correo)).join("")
  return "https://calendar.google.com/calendar/r/eventedit?text="+titulo+"&dates="+fechaGCal+"/"+fechaFin+"&details="+desc+"&location="+loc+inv+"&trp=false"
}
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
const CL={A:{c:"#B42318",bg:"#B4231815",t:"Crítico"},B:{c:"#1D4E89",bg:"#1D4E8915",t:"Importante"},C:{c:"#1E7A44",bg:"#1E7A4415",t:"Regular"},D:{c:"#6E6E73",bg:"#6E6E7315",t:"Bajo"}}
const STS={"En fabricación":{c:"#B25E09",bg:"#B25E0915",ic:"🏭"},"Embarcada":{c:"#1D4ED8",bg:"#1D4ED815",ic:"🚢"},"Borrador":{c:"#6B7280",bg:"#6B728015",ic:"✎"},"Anulada":{c:"#6B7280",bg:"#6B728015",ic:"⊘"},"Pend. Dir. Negocios":{c:"#1D4E89",bg:"#1D4E8915",ic:"⏳"},"Proyectar costeo":{c:"#223058",bg:"#22305815",ic:"🧮"},"Pend. Dir. Finanzas":{c:"#5B2C6F",bg:"#5B2C6F15",ic:"⏳"},"Pend. proveedor":{c:"#B25E09",bg:"#B25E0915",ic:"🔄"},"Proforma OK":{c:"#1E7A44",bg:"#1E7A4415",ic:"✓"},"Pago fabricación":{c:"#B25E09",bg:"#B25E0915",ic:"💰"},"Pago embarque":{c:"#B25E09",bg:"#B25E0915",ic:"💰"},"Internación":{c:"#B42318",bg:"#B4231815",ic:"📋"},"Validar costeo final":{c:"#223058",bg:"#22305815",ic:"🎯"},"Transporte":{c:"#5B2C6F",bg:"#5B2C6F15",ic:"🚛"},"Confirmada prov.":{c:"#1E7A44",bg:"#1E7A4415",ic:"✓"},"Despacho nac.":{c:"#5B2C6F",bg:"#5B2C6F15",ic:"🚚"},"Recibida parcial":{c:"#B25E09",bg:"#B25E0915",ic:"◐"},"Recibida OK":{c:"#1E7A44",bg:"#1E7A4415",ic:"✓"},"Cerrada":{c:"#6E6E73",bg:"#6E6E7315",ic:"■"},"Rechazada":{c:"#B42318",bg:"#B4231815",ic:"✕"},"Pago pend.":{c:"#B25E09",bg:"#B25E0915",ic:"$"},"Dividida":{c:"#6E6E73",bg:"#6E6E7315",ic:"✂"},"Fusionada":{c:"#6E6E73",bg:"#6E6E7315",ic:"🔗"}}
const FN=[{n:"Solicitud"},{n:"Negocios"},{n:"Finanzas"},{n:"Proveedor"},{n:"Despacho"},{n:"Recepción"},{n:"Cierre"}]
const FI=[{n:"Solicitud"},{n:"Negocios"},{n:"Proy. Costeo"},{n:"Finanzas"},{n:"Proforma"},{n:"Fabricación"},{n:"Embarque"},{n:"Internación"},{n:"Costeo final"},{n:"Transporte"},{n:"Recepción"},{n:"Cierre"}]
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
  {k:"admin",l:"Admin",c:"#B42318",p:["todo"]},
  {k:"dir_general",l:"Dir. General",c:"#B42318",p:["aprobar_ilimitado","ver_dash","ver_fin","gest_imp"]},
  {k:"dir_finanzas",l:"Dir. Finanzas",c:"#5B2C6F",p:["aprobar_fin","ver_dash","ver_fin","reg_pago"]},
  {k:"dir_negocios",l:"Dir. Negocios",c:"#1D4E89",p:["aprobar_neg","crear_oc","ver_dash","gest_prov","valid_prov"]},
  {k:"dir_operaciones",l:"Dir. Operaciones",c:"#1D4E89",p:["aprobar_ops","recibir","ver_dash","seguim","cerrar_oc"]},
  {k:"analista",l:"Analista",c:"#1E7A44",p:["crear_oc","ver_dash","cerrar_oc","gest_prov","config","seguim","gest_imp","recibir","act_estado"]},
  {k:"jefe_bodega",l:"Jefe Bodega",c:"#B25E09",p:["recibir","ver_dash"]},
  {k:"jefe_operaciones",l:"Jefe Operaciones",c:"#B25E09",p:["recibir","aprobar_ops","ver_dash","seguim"]},
  {k:"directorio",l:"Directorio",c:"#6E6E73",p:["ver_dash","ver_fin"]}
]
const rl=u=>ROLES.find(r=>r.k===u?.rol)||ROLES[5]
// Apps con ruta en este shell. Un código desconocido (deep-link viejo, localStorage) vuelve al hub.
const APPS_RUTAS=["compras","compras_op","finanzas","admin","postventa","rrhh","inventario","agente","proyectos","logistica","comercial","procesos"]

/* ═══ ERROR BOUNDARY ═══
   Evita que un error de render tire toda la app a pantalla blanca.
   Muestra el error exacto en pantalla para poder diagnosticarlo. */
class ErrBound extends Component{
  constructor(props){super(props);this.state={err:null}}
  static getDerivedStateFromError(err){return{err}}
  componentDidCatch(err,info){console.error("[ErrBound]",this.props.zona||"",err,info?.componentStack)}
  render(){
    if(this.state.err){
      return<div style={{background:"#FFF5F5",border:"2px solid #B42318",borderRadius:12,padding:20,margin:12}}>
        <div style={{fontSize:15,fontWeight:700,color:"#B42318",marginBottom:8}}>⚠ Error en {this.props.zona||"esta sección"}</div>
        <div style={{fontSize:12,color:"#3A3A3C",marginBottom:6}}>La sección falló pero el resto de la app sigue funcionando. Sácale captura a este recuadro y a la consola (F12) para reportarlo.</div>
        <pre style={{fontSize:12,color:"#B91C1C",background:"#FFE5E5",borderRadius:8,padding:10,overflow:"auto",maxHeight:180,whiteSpace:"pre-wrap"}}>{String(this.state.err?.message||this.state.err)}{"\n"}{String(this.state.err?.stack||"").split("\n").slice(1,5).join("\n")}</pre>
        <button onClick={()=>this.setState({err:null})} style={{marginTop:8,padding:"8px 16px",borderRadius:8,border:"none",background:"#B42318",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>Reintentar</button>
      </div>
    }
    return this.props.children
  }
}
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
const css={card:{background:"#fff",borderRadius:8,padding:"14px 16px",boxShadow:"none",marginBottom:10,border:"1px solid #E5E7EB"},cardSm:{background:"#fff",borderRadius:8,padding:"10px 12px",boxShadow:"none",border:"1px solid #E5E7EB"},input:{width:"100%",padding:"8px 11px",borderRadius:6,border:"1px solid #D1D5DB",fontSize:13,background:"#fff",outline:"none",transition:"border-color 0.2s",color:"#1C1C1E",boxSizing:"border-box"},select:{width:"100%",padding:"8px 11px",borderRadius:6,border:"1px solid #D1D5DB",fontSize:13,background:"#fff",color:"#1C1C1E",boxSizing:"border-box"},btn:{padding:"10px 18px",borderRadius:6,fontSize:13,fontWeight:600,border:"none",cursor:"pointer",transition:"all 0.15s",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6},modal:{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(15,23,42,0.4)",backdropFilter:"blur(6px)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:999,padding:0}} // 18-oct-2026: forma del ecosistema (paneles de 8px con borde fino)

const Bd=({children,c,bg,lg})=><span style={{display:"inline-flex",alignItems:"center",gap:3,padding:lg?"4px 10px":"2px 8px",borderRadius:6,fontSize:lg?12:11,fontWeight:600,color:c||"#6E6E73",background:bg||"#F4F5F7",whiteSpace:"nowrap"}}>{children}</span>

const Mt=({l,v,sub,ac,ic})=><div style={{...css.cardSm,textAlign:"left",flex:"1 1 120px",padding:"8px 12px"}}><div style={{fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",letterSpacing:0.5,marginBottom:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ic&&<span style={{marginRight:4}}>{ic}</span>}{l}</div><div style={{fontSize:18,fontWeight:700,color:ac||"#1C1C1E",fontVariantNumeric:"tabular-nums"}}>{v}</div>{sub&&<div style={{fontSize:11,color:"#6E6E73",marginTop:1}}>{sub}</div>}</div>

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

const Fl=({l,children,req})=><div style={{marginBottom:14}}><label style={{display:"block",fontSize:13,fontWeight:600,color:"#3A3A3C",marginBottom:5}}>{l}{req&&<span style={{color:"#B42318"}}> *</span>}</label>{children}</div>

const Bt=({children,v,dis,onClick,full,sm,ic})=>{const m={pri:{bg:"#16213E",c:"#fff"},suc:{bg:"#1E7A44",c:"#fff"},dan:{bg:"#B42318",c:"#fff"},pur:{bg:"#5B2C6F",c:"#fff"},amb:{bg:"#B25E09",c:"#fff"},gry:{bg:"#fff",c:"#16213E",bd:"1px solid #D1D5DB"}};const st=m[v]||m.gry;return<button onClick={onClick} disabled={dis} style={{...css.btn,padding:sm?"6px 12px":"10px 18px",fontSize:sm?12:13,background:dis?"#F4F5F7":st.bg,color:dis?"#9CA3AF":st.c,border:dis?"1px solid #E5E7EB":(st.bd||"none"),width:full?"100%":"auto",opacity:dis?0.7:1,cursor:dis?"default":"pointer"}}>{ic&&<span>{ic}</span>}{children}</button>}

const Av=({n,c,sz})=>{const s=sz||36;return<div style={{width:s,height:s,borderRadius:s/2,background:c?(c+"20"):"#F4F5F7",display:"flex",alignItems:"center",justifyContent:"center",fontSize:s*0.36,fontWeight:700,color:c||"#6E6E73",flexShrink:0,letterSpacing:"-0.02em"}}>{n}</div>}

const Stp=({steps,cur})=><div style={{display:"flex",alignItems:"flex-start",margin:"0 0 14px",overflowX:"auto",paddingBottom:4,gap:0}}>{steps.map((s,i)=>{const d=i<cur,a=i===cur;return<div key={i} style={{display:"flex",alignItems:"center",flex:"0 0 auto"}}><div style={{display:"flex",flexDirection:"column",alignItems:"center",minWidth:steps.length>10?62:70}}><div style={{width:24,height:24,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,background:d?"#1E7A44":a?"#16213E":"#EEF1F7",color:(d||a)?"#fff":"#9CA3AF",border:(d||a)?"none":"1px solid #E5E7EB",boxSizing:"border-box"}}>{d?"✓":i+1}</div><div style={{fontSize:10.5,marginTop:3,color:a?"#16213E":d?"#1E7A44":"#9CA3AF",fontWeight:a?700:500,textAlign:"center",maxWidth:76,lineHeight:1.2}}>{s.n}</div></div>{i<steps.length-1&&<div style={{width:16,height:2,borderRadius:1,background:d?"#1E7A44":"#E5E7EB",margin:"0 0 18px",flexShrink:0}}/>}</div>})}</div> // 18-oct-2026: etapas legibles

const Sheet=({show,onClose,title,children})=>{if(!show)return null;return<div style={css.modal} onClick={onClose}><div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"8px 20px 32px",width:"100%",maxWidth:680,maxHeight:"92vh",overflow:"auto",animation:"slideUp 0.3s ease"}}><div style={{width:36,height:4,borderRadius:2,background:"#E5E7EB",margin:"0 auto 12px"}}/><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><div style={{fontSize:18,fontWeight:700,letterSpacing:"-0.02em"}}>{title}</div><button onClick={onClose} style={{width:30,height:30,borderRadius:15,background:"#F4F5F7",border:"none",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#6E6E73"}}>✕</button></div>{children}</div></div>}

/* ═══ LOGIN SCREEN — Email + Password only ═══ */
/* \u2550\u2550\u2550 CAMBIAR PASSWORD SCREEN \u2014 Se muestra cuando el usuario llega desde un link de recovery \u2550\u2550\u2550 */
/* ═══ CAMBIAR PASSWORD SCREEN — Aparece cuando el usuario llega desde link de recovery ═══ */
function CambiarPasswordScreen({onDone}){
  const[pass,setPass]=useState("")
  const[pass2,setPass2]=useState("")
  const[loading,setLoading]=useState(false)
  const[err,setErr]=useState("")
  const[ok,setOk]=useState(false)

  const guardar=async()=>{
    if(pass.length<8){setErr("La contrasena debe tener al menos 8 caracteres");return}
    if(pass!==pass2){setErr("Las contrasenas no coinciden");return}
    setLoading(true);setErr("")
    const{error}=await supabase.auth.updateUser({password:pass})
    setLoading(false)
    if(error){setErr("Error: "+error.message);return}
    setOk(true)
    setTimeout(()=>onDone(),2500)
  }

  return<div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f3460 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{width:"100%",maxWidth:420}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{width:60,height:60,borderRadius:16,background:"rgba(255,255,255,0.1)",backdropFilter:"blur(10px)",display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:16,border:"1px solid rgba(255,255,255,0.08)"}}><span style={{fontSize:24}}>🔒</span></div>
        <div style={{fontSize:24,fontWeight:800,color:"#fff",letterSpacing:"-0.03em"}}>Define tu contrasena</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,0.6)",marginTop:6}}>Elige una contrasena segura para tu cuenta ERP</div>
      </div>
      <div style={{background:"#fff",borderRadius:20,padding:32,boxShadow:"0 25px 60px rgba(0,0,0,0.3)"}}>
        {ok?<div style={{textAlign:"center",padding:"20px 0"}}>
          <div style={{fontSize:48,marginBottom:12}}>✅</div>
          <div style={{fontSize:17,fontWeight:700,color:"#1C1C1E",marginBottom:6}}>Contrasena actualizada</div>
          <div style={{fontSize:13,color:"#6E6E73"}}>Ingresando al sistema...</div>
        </div>:<>
          <div style={{fontSize:13,color:"#6E6E73",marginBottom:16}}>Minimo 8 caracteres. Define una contrasena que recuerdes.</div>
          <Fl l="Nueva contrasena"><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="........" style={{...css.input,padding:"12px 16px",fontSize:15}} autoFocus/></Fl>
          <Fl l="Confirmar contrasena"><input type="password" value={pass2} onChange={e=>setPass2(e.target.value)} placeholder="........" style={{...css.input,padding:"12px 16px",fontSize:15}} onKeyDown={e=>e.key==="Enter"&&guardar()}/></Fl>
          {err&&<div style={{color:"#B42318",fontSize:13,marginBottom:12,padding:"10px 14px",background:"#B4231808",borderRadius:10,border:"1px solid #B4231820"}}>{err}</div>}
          {pass.length>0&&pass2.length>0&&pass===pass2&&<div style={{color:"#1E7A44",fontSize:12,marginBottom:10,display:"flex",alignItems:"center",gap:4}}><span>OK</span> Las contrasenas coinciden</div>}
          <Bt v="pri" full dis={!pass||!pass2||loading} onClick={guardar}>{loading?"Guardando...":"Guardar contrasena"}</Bt>
        </>}
      </div>
    </div>
  </div>
}

function LoginScreen({onLogin,users,cargarUsuarios}){
  const[email,setEmail]=useState("")
  const[pass,setPass]=useState("")
  const[err,setErr]=useState("")
  const[loading,setLoading]=useState(false)
  const[showReset,setShowReset]=useState(false)
  const[resetEmail,setResetEmail]=useState("")
  const[resetMsg,setResetMsg]=useState("")
  const[resetLoading,setResetLoading]=useState(false)

  const authLogin=async()=>{
    setLoading(true);setErr("")
    const{data,error}=await signIn(email,pass)
    if(error){
      const msg=error.message?.includes("Invalid login")||error.message?.includes("invalid_credentials")
        ?"Correo o contrasena incorrectos. Usa el link Olvide mi contrasena si es tu primer acceso."
        :error.message
      setErr(msg);setLoading(false);return
    }
    // La lista de usuarios se lee recién ahora, con la sesión Auth activa
    const lista=users.length?users:(cargarUsuarios?await cargarUsuarios():[])
    const u=lista.find(x=>x.correo?.toLowerCase()===email.toLowerCase())
    if(u){onLogin(u)}else{setErr("Usuario no registrado en el sistema. Contacta al administrador.");setLoading(false)}
  }

  const sendReset=async()=>{
    if(!resetEmail){setResetMsg("Ingresa tu correo corporativo");return}
    setResetLoading(true);setResetMsg("")
    const{error}=await supabase.auth.resetPasswordForEmail(resetEmail.toLowerCase().trim(),{
      redirectTo:"https://outlet-compras.netlify.app"
    })
    setResetLoading(false)
    if(error){setResetMsg("Error: "+error.message)}
    else{setResetMsg("✓ Revisa tu correo "+resetEmail+". El link expira en 1 hora.")}
  }

  // Pantalla de reset
  if(showReset)return<div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f3460 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{width:"100%",maxWidth:420}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{width:60,height:60,borderRadius:16,background:"rgba(255,255,255,0.1)",backdropFilter:"blur(10px)",display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:16,border:"1px solid rgba(255,255,255,0.08)"}}><span style={{fontSize:24}}>🔑</span></div>
        <div style={{fontSize:24,fontWeight:800,color:"#fff",letterSpacing:"-0.03em"}}>Recuperar acceso</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,0.6)",marginTop:6}}>Te enviaremos un link para configurar tu contraseña</div>
      </div>
      <div style={{background:"#fff",borderRadius:20,padding:32,boxShadow:"0 25px 60px rgba(0,0,0,0.3)"}}>
        {!resetMsg?<>
          <div style={{fontSize:13,color:"#6E6E73",marginBottom:16}}>Ingresa tu correo corporativo y recibirás un email con instrucciones.</div>
          <Fl l="Correo corporativo"><input type="email" value={resetEmail} onChange={e=>setResetEmail(e.target.value)} placeholder="usuario@outletdepuertas.cl" style={{...css.input,padding:"12px 16px",fontSize:15}} autoFocus onKeyDown={e=>e.key==="Enter"&&sendReset()}/></Fl>
          <Bt v="pri" full dis={!resetEmail||resetLoading} onClick={sendReset}>{resetLoading?"Enviando...":"Enviar link de recuperación"}</Bt>
          <button onClick={()=>{setShowReset(false);setResetEmail("");setResetMsg("")}} style={{width:"100%",marginTop:10,padding:"10px",background:"none",border:"none",color:"#6E6E73",fontSize:13,cursor:"pointer"}}>← Volver al login</button>
        </>:<>
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:40,marginBottom:12}}>📧</div>
            <div style={{fontSize:15,fontWeight:600,color:"#1C1C1E",marginBottom:8}}>Email enviado</div>
            <div style={{fontSize:13,color:"#6E6E73",lineHeight:1.5,marginBottom:20}}>{resetMsg}</div>
            <div style={{fontSize:12,color:"#AEAEB2",marginBottom:20}}>Si no ves el email, revisa tu carpeta de spam. El link te lleva al ERP donde podrás definir tu nueva contraseña.</div>
          </div>
          <Bt v="gry" full onClick={()=>{setShowReset(false);setResetEmail("");setResetMsg("")}}>← Volver al login</Bt>
        </>}
      </div>
    </div>
  </div>

  // Pantalla de login normal
  return<div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f3460 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{width:"100%",maxWidth:420}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{width:60,height:60,borderRadius:16,background:"rgba(255,255,255,0.1)",backdropFilter:"blur(10px)",display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:16,border:"1px solid rgba(255,255,255,0.08)"}}><span style={{fontSize:24}}>🏢</span></div>
        <div style={{fontSize:36,fontWeight:800,color:"#fff",letterSpacing:"-0.04em"}}>Outlet de Puertas</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,0.6)",marginTop:4}}>Abastecimiento y Planificación</div>
        <div style={{fontSize:12,color:"rgba(255,255,255,0.35)",marginTop:4}}>SOP P07 v2.0 · Módulo ERP</div>
      </div>
      <div style={{background:"#fff",borderRadius:20,padding:32,boxShadow:"0 25px 60px rgba(0,0,0,0.3)"}}>
        <div style={{fontSize:18,fontWeight:700,color:"#1C1C1E",marginBottom:4}}>Iniciar sesión</div>
        <div style={{fontSize:13,color:"#6E6E73",marginBottom:20}}>Ingresa con tu correo corporativo</div>
        <Fl l="Correo electrónico"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="usuario@outletdepuertas.cl" style={{...css.input,padding:"12px 16px",fontSize:15}} autoFocus/></Fl>
        <Fl l="Contraseña"><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" style={{...css.input,padding:"12px 16px",fontSize:15}} onKeyDown={e=>e.key==="Enter"&&authLogin()}/></Fl>
        {err&&<div style={{color:"#B42318",fontSize:13,marginBottom:12,padding:"10px 14px",background:"#B4231808",borderRadius:10,border:"1px solid #B4231820"}}>{err}</div>}
        <Bt v="pri" full dis={!email||!pass||loading} onClick={authLogin}>{loading?"Verificando...":"Ingresar"}</Bt>
        <button onClick={()=>{setShowReset(true);setResetEmail(email)}} style={{width:"100%",marginTop:12,padding:"8px",background:"none",border:"none",color:"#6E6E73",fontSize:13,cursor:"pointer",textDecoration:"underline"}}>¿Olvidaste tu contraseña?</button>
      </div>
    </div>
  </div>
}

/* ═══ MAIN APP ═══ */
/* 17-oct-2026: menú homologado con el ecosistema (MenuErp), agrupado por cómo se trabaja */
const MENU_CMP=[
  {k:"planificacion",l:"Planificación",grupos:[
    {l:"Decidir",items:[{l:"Monitor",hoja:"monitor"},{l:"Reposición",hoja:"repo"},{l:"Plan de compras",hoja:"plan"}]},
    {l:"Proyectar",items:[{l:"Cobertura",hoja:"cobertura"},{l:"Forecast",hoja:"forecast"}]},
    {l:"Proveedores",items:[{l:"Desempeño de proveedores",hoja:"proveedores"}]}]},
  {k:"ordenes",l:"Órdenes",grupos:[
    {l:"Órdenes de compra",items:[{l:"Órdenes y aprobaciones",hoja:"ordenes"},{l:"Nueva OC",hoja:"nueva"}]},
    {l:"Abastecimiento entrante",items:[{l:"Tránsito",hoja:"transito"},{l:"Llegadas",hoja:"llegadas"}]}]},
  {k:"costos",l:"Costos y pagos",grupos:[
    {l:"Importación",items:[{l:"Costeo de importación",hoja:"costeo"}]},
    {l:"Pagos",items:[{l:"Finanzas de OC",hoja:"finanzas"}]}]},
  {k:"proceso",l:"Proceso",grupos:[
    {l:"Referencia",items:[{l:"Flujograma",hoja:"flujograma"},{l:"Gestión del área",hoja:"gestion"}]}]},
  {k:"config",l:"Configuración",grupos:[
    {l:"Sistema",items:[{l:"Parámetros, proveedores y usuarios",hoja:"config"}]}]},
]
const TABS=[{k:"monitor",l:"Monitor",ic:"📊"},{k:"repo",l:"Reposición",ic:"📦"},{k:"forecast",l:"Forecast",ic:"📈"},{k:"cobertura",l:"Cobertura",ic:"📅"},{k:"llegadas",l:"Llegadas",ic:"📆"},{k:"costeo",l:"Costeo IMP",ic:"🧮"},{k:"transito",l:"Tránsito",ic:"🚚"},{k:"finanzas",l:"Finanzas",ic:"💰"},{k:"nueva",l:"Nueva OC",ic:"➕"},{k:"ordenes",l:"Órdenes",ic:"📋"},{k:"gestion",l:"Gestión",ic:"🎯"},{k:"config",l:"Config",ic:"⚙️"}]

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
  const[prodsSuc,setProdsSuc]=useState([]) // productos por sucursal
  const[v2App,setV2App]=useState([]) // Fase 3: cálculo v2 de reposición (base Inventario)
  // 19-oct-2026: el cálculo se mantiene al día solo. Antes se cargaba una vez al abrir la app y quien la tenía abierta
  // seguía viendo un cálculo viejo después del recálculo diario o del de Configuración.
  const v2AppRef=useRef(v2App);useEffect(()=>{v2AppRef.current=v2App},[v2App])
  const[v2Aviso,setV2Aviso]=useState("")
  const recargarV2=async motivo=>{try{const{data,error}=await fetchAll(supabase.from('cmp_reposicion_v2').select('*').order('sku'));if(!error&&data){setV2App(data);if(motivo){setV2Aviso(motivo);setTimeout(()=>setV2Aviso(""),8000)}}}catch(e){console.warn('v2:',e)}}
  useEffect(()=>{
    let vivo=true
    const revisar=async()=>{try{const{data}=await supabase.from('cmp_reposicion_v2').select('calculado_at').order('calculado_at',{ascending:false}).limit(1);const nuevo=data?.[0]?.calculado_at,actual=v2AppRef.current?.[0]?.calculado_at;if(vivo&&nuevo&&actual&&nuevo!==actual)recargarV2("Se actualizó el cálculo de reposición")}catch(e){}}
    const t=setInterval(revisar,180000)
    const alVolver=()=>{if(document.visibilityState!=="hidden")revisar()}
    document.addEventListener("visibilitychange",alVolver);window.addEventListener("focus",alVolver)
    return()=>{vivo=false;clearInterval(t);document.removeEventListener("visibilitychange",alVolver);window.removeEventListener("focus",alVolver)}
  },[])
  const[v2Pendiente,setV2Pendiente]=useState(null) // 19-oct-2026: cambios de Política de compra aún no aplicados (el servidor recalcula solo cada minuto)
  useEffect(()=>{
    let vivo=true
    const ver=async()=>{try{
      const[{data:h},{data:c}]=await Promise.all([supabase.from('cmp_param_historial').select('fecha').order('fecha',{ascending:false}).limit(1),supabase.from('cmp_reposicion_v2').select('calculado_at').order('calculado_at',{ascending:false}).limit(1)])
      const f=h?.[0]?.fecha,calcDB=c?.[0]?.calculado_at,calcCargado=v2AppRef.current?.[0]?.calculado_at
      if(!vivo)return
      if(calcDB&&calcCargado&&new Date(calcDB)>new Date(calcCargado))await recargarV2("Se aplicaron los cambios al cálculo de reposición")
      if(vivo)setV2Pendiente(f&&calcDB&&new Date(f)>new Date(calcDB)?f:null)
    }catch(e){}}
    ver();const t=setInterval(ver,30000)
    return()=>{vivo=false;clearInterval(t)}
  },[])
  const[fuenteRepo,setFuenteRepo]=useLocalState("repo_fuente","v2")
  const[cart,setCart]=useState(()=>{try{const s=localStorage.getItem("erp_cart");return s?JSON.parse(s):{}}catch(e){return{}}})
  const[tab,setTab]=useState(()=>{try{
    // ⭐ Vigía OC: deep-link #go/compras/<modulo>/... desde correos (core/deeplink.js)
    if(deepLink?.app==='compras'){const m={ordenes:'ordenes',transito:'transito',costeo:'costeo',finanzas:'finanzas',monitor:'monitor',repo:'repo',reposicion:'repo',cobertura:'cobertura',llegadas:'llegadas',forecast:'forecast',config:'config'};if(m[deepLink.modulo])return m[deepLink.modulo]}
    return localStorage.getItem("erp_tab")||"monitor"}catch(e){return"monitor"}})
  const[det,setDet]=useState(null)
  // ⭐ Vigía OC: si el deep-link trae ?oc=..., abrir el detalle apenas carguen las OC (una sola vez)
  const dlOcRef=useRef(deepLink?.app==='compras'?(deepLink.params?.oc||null):null)
  useEffect(()=>{if(dlOcRef.current&&ocs.length){const o=ocs.find(x=>x.id===dlOcRef.current);if(o)setDet(o);dlOcRef.current=null}},[ocs])
  const[loading,setLoading]=useState(true)
  const[bootErr,setBootErr]=useState("")   // ⭐ error de arranque visible (antes: cuelgue silencioso)
  // ⭐ Watchdog: si a los 15s seguimos en "Conectando..." sin usuarios, mostrar error accionable
  useEffect(()=>{
    if(!loading||users.length>0||bootErr)return
    const t=setTimeout(()=>{
      setBootErr("Tiempo de espera agotado (15s) conectando con la base de datos. Puede ser un problema de red, de variables de entorno del deploy, o un bundle desactualizado en Netlify.")
      setLoading(false)
    },15000)
    return()=>clearTimeout(t)
  },[loading,users.length,bootErr])
  const[configTab,setConfigTab]=useState(()=>{try{return localStorage.getItem("erp_configTab")||"params"}catch(e){return"params"}})

  // ⭐ v51: Detección de móvil para UI responsive
  const[isMobile,setIsMobile]=useState(()=>typeof window!=="undefined"?window.innerWidth<768:false)
  const[moreOpen,setMoreOpen]=useState(false)
  const[cmpListo,setCmpListo]=useState(false) // datos de Abastecimiento cargados (solo si el usuario entra a esa app)
  const[appActual,setAppActual]=useState(()=>{try{if(deepLink?.app)return deepLink.app;return localStorage.getItem("outlet_app_actual")||null}catch(e){return null}})
  const[recoveryMode,setRecoveryMode]=useState(false)
  const[capsLoaded,setCapsLoaded]=useState(false)
  useEffect(()=>{
    const onResize=()=>setIsMobile(window.innerWidth<768)
    window.addEventListener("resize",onResize)
    return()=>window.removeEventListener("resize",onResize)
  },[])

  // ⭐ v48: Persistencia automática en localStorage
  useEffect(()=>{try{localStorage.setItem("erp_tab",tab)}catch(e){}},[tab])
  useEffect(()=>{try{localStorage.setItem("erp_configTab",configTab)}catch(e){}},[configTab])
  useEffect(()=>{try{localStorage.setItem("erp_cart",JSON.stringify(cart))}catch(e){}},[cart])

  // ⭐ Sincronización entre pestañas: escuchar cambios en localStorage de otra pestaña
  useEffect(()=>{
    const onStorage=(e)=>{
      if(e.key==="erp_cart"&&e.newValue){
        try{const v=JSON.parse(e.newValue);setCart(v)}catch(err){}
      }
    }
    window.addEventListener("storage",onStorage)
    return()=>window.removeEventListener("storage",onStorage)
  },[])

  useEffect(()=>{loadUsers()},[])  // Solo carga usuarios para el login — loadAll se dispara post-auth

  // RBAC-5: precargar capabilities de Compras cuando hay usuario autenticado
  useEffect(()=>{
    if(cu?.id) preloadCaps(cu,'compras').then(()=>setCapsLoaded(true))
    else setCapsLoaded(false)
  },[cu?.id])

  // Abastecimiento: guard de acceso + carga diferida. Antes cada login/recarga en CUALQUIER app
  // descargaba productos, stock por sucursal, OCs, firmas, pagos y config_sistema completos.
  useEffect(()=>{
    let cancel=false
    const salirHub=()=>{setAppActual(null);try{localStorage.removeItem("outlet_app_actual")}catch(e){}}
    if(!cu?.id){setCmpListo(false);return}
    if(!appActual)return
    if(!APPS_RUTAS.includes(appActual)){salirHub();return}
    if(appActual!=="compras"||cmpListo)return
    hasApp(cu,"compras").then(async ok=>{
      if(cancel)return
      if(!ok){alert("No tienes acceso a Abastecimiento. Solicítalo a Administración.");salirHub();return}
      await loadAll()
      if(!cancel)setCmpListo(true)
    })
    return()=>{cancel=true}
  },[cu?.id,appActual,cmpListo])

  // Persistencia de sesion via Supabase Auth (unico metodo valido desde v52)
  useEffect(()=>{
    const restoreSession=async()=>{
      try{
        const s=await getSession()
        if(s?.user?.email&&users.length>0){
          const u=users.find(x=>x.correo?.toLowerCase()===s.user.email.toLowerCase())
          if(u){
            setCu(u)
            // Sesion Auth confirmada. Los datos de Abastecimiento se cargan solo al entrar a esa app (ver guard)
            setLoading(false)
            return
          }
        }
        // Sin sesion valida: solo mostrar login, no cargar datos
        setLoading(false)
        try{localStorage.removeItem("erp_cu_id")}catch(e){}
      }catch(e){console.warn("restoreSession:",e);setLoading(false)}
    }
    if(users.length>0&&!cu)restoreSession()
    // Listener de cambios de auth (logout automático si el token expira)
    const{data:authListener}=supabase.auth.onAuthStateChange((event,sess)=>{
      if(event==="SIGNED_OUT"){setCu(null);localStorage.removeItem("erp_cu_id");setRecoveryMode(false)}
      if(event==="PASSWORD_RECOVERY"){setRecoveryMode(true)}
    })
    return()=>{authListener?.subscription?.unsubscribe()}
  },[users])


  // loadUsers: carga usuarios y sucursales SOLO con sesión Auth (seguridad 28-sep-2026:
  // la base de datos ya no responde al rol anónimo). Sin sesión se muestra el login y no se consulta nada.
  // Devuelve la lista para que el login la use inmediatamente después de autenticar.
  const loadUsers=async()=>{
    try{
      const ses=await getSession()
      if(!ses?.user){setUsers([]);setLoading(false);return[]}
      const[ru,rsuc]=await Promise.all([
        supabase.from('usuarios').select('*').eq('activo',true).order('nombre'),
        supabase.from('sucursales').select('*').order('orden'),
      ])
      // ⭐ Supabase NO lanza excepción: retorna {error}. Sin este check, un error
      //    de RLS/red dejaba la app colgada en "Conectando..." sin mensaje.
      if(ru.error)throw new Error("Error cargando usuarios: "+ru.error.message)
      setUsers(ru.data||[])
      setSucursales(rsuc.data||[])
      if(!ru.data||ru.data.length===0){
        setBootErr("La consulta de usuarios devolvió 0 resultados. Posibles causas: problema de permisos (RLS) en la tabla usuarios, o variables de entorno de Supabase no configuradas en el deploy.")
        setLoading(false)
      }
      // Si hay usuarios: restoreSession se encarga de liberar loading
      return ru.data||[]
    }catch(e){
      console.error('loadUsers:',e)
      setBootErr(String(e?.message||e))
      setLoading(false)
      return[]
    }
  }

  // loadAll: carga el resto de tablas — solo se llama cuando hay sesion Auth confirmada
  const loadAll=async()=>{
    try{
      const[rp,rprod,roc,rf,rpag,rpt,rpa,rcfg]=await Promise.all([
        supabase.from('proveedores').select('*').order('nombre'),
        fetchAll(supabase.from('productos').select('*').order('costo_reposicion',{ascending:false})),
        supabase.from('ordenes_compra').select('*').order('created_at',{ascending:false}),
        fetchAll(supabase.from('firmas').select('*').order('created_at')),
        supabase.from('pagos').select('*'),
        supabase.from('parametros_tipo').select('*'),
        supabase.from('parametros_abcd').select('*'),
        supabase.from('config_sistema').select('*'),
      ])
      setProvs(rp.data||[]);setProds(rprod.data||[])
      setOcs(roc.data||[]);setFirmas(rf.data||[]);setPagos(rpag.data||[])
      setParams(rpt.data||[]);setParamsABCD(rpa.data||[])
      const cfgMap={};(rcfg.data||[]).forEach(c=>cfgMap[c.clave]=c.valor);setConfig(cfgMap)
      // Stock en tránsito
      try{const st=await supabase.from('stock_transito').select('*');setStockTransito(st.data||[])}catch(e){}
      try{
        // Supabase limita a 1000 por defecto — paginar para traer los 3000+ registros
        let allPs=[];let from=0;const pageSize=1000
        while(true){
          const{data:page,error}=await supabase.from('productos_sucursal').select('*').range(from,from+pageSize-1)
          if(error||!page||page.length===0)break
          allPs=[...allPs,...page]
          if(page.length<pageSize)break
          from+=pageSize
        }
        setProdsSuc(allPs)
      }catch(e){}
      try{const{data:v2d}=await fetchAll(supabase.from('cmp_reposicion_v2').select('*').order('sku'));setV2App(v2d||[])}catch(e){console.warn('v2:',e)}
      setLoading(false)
    }catch(e){console.error(e);setLoading(false)}
  }

  const addFirma=async(ocId,accion,extra)=>{
    if(!cu)return;const f={id:uid(),oc_id:ocId,usuario_id:cu.id,nombre_usuario:cu.nombre,rol_usuario:rl(cu).l,accion,firma_digital:cu.firma_digital,fecha:hoy(),hora:hora(),...(extra||{})}
    const{error}=await supabase.from('firmas').insert(f);if(error){alert("⚠ No se registró la firma: "+error.message+"\nLa acción no quedó guardada.");throw error}setFirmas(p=>[...p,f])
  }
  const updOC=async(id,up)=>{const{error}=await supabase.from('ordenes_compra').update(up).eq('id',id);if(error){alert("⚠ No se guardó el cambio en "+id+": "+error.message);throw error}setOcs(p=>p.map(o=>o.id===id?{...o,...up}:o))}
  const saveConfig=async(k,v)=>{
    const{error}=await supabase.from('config_sistema').upsert({clave:k,valor:v},{onConflict:'clave'})
    if(error){console.error("[saveConfig]",k,error);return error}
    setConfig(p=>({...p,[k]:v}))
    return null
  }
  // RBAC-5: h() ahora usa capabilities dinámicas cuando están disponibles
  // El mapeo cap_id convierte permisos string legacy a IDs del nuevo sistema
  const CAP_MAP = {
    'crear_oc':    'cmp.crear_oc',
    'aprobar_neg': 'cmp.aprobar_neg',
    'aprobar_fin': 'cmp.aprobar_fin',
    'gest_imp':    'cmp.gest_imp',
    'valid_prov':  'cmp.valid_prov',
    'reg_pago':    'cmp.reg_pago',
    'recibir':     'cmp.recibir',
    'cerrar_oc':   'cmp.cerrar_oc',
    'ver_fin':     'cmp.finanzas',
    'config':      'cmp.config',
  }
  const h=p=>{
    if(!cu) return false
    if(capsLoaded){
      const capId = CAP_MAP[p]
      if(capId) return canSync(cu,'compras',capId) !== false
    }
    // Fallback al sistema legado mientras caps cargan o para permisos no mapeados
    return hp(cu,p)
  }

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
  const prodsV2App=useMemo(()=>v2App.map(v2AProd),[v2App])
  const prodsPlan=(fuenteRepo==="v2"&&prodsV2App.length)?prodsV2App:prodsWithTransit

  const pend=ocs.filter(o=>o.estado?.startsWith("Pend.")).length

  if(bootErr)return<div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#F4F5F7",padding:20}}><div style={{textAlign:"center",maxWidth:480,background:"#fff",borderRadius:16,padding:28,border:"2px solid #B42318"}}><div style={{fontSize:26,marginBottom:8}}>⚠️</div><div style={{fontSize:18,fontWeight:700,color:"#1C1C1E"}}>No se pudo iniciar la aplicación</div><div style={{fontSize:12,color:"#3A3A3C",marginTop:10,lineHeight:1.5,textAlign:"left",background:"#FFF5F5",borderRadius:8,padding:12}}>{bootErr}</div><button onClick={()=>{setBootErr("");setLoading(true);loadUsers()}} style={{marginTop:16,padding:"10px 24px",borderRadius:10,border:"none",background:"#1D4E89",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>🔄 Reintentar</button><div style={{fontSize:11,color:"#6E6E73",marginTop:10}}>Si persiste: revisa la pestaña Network (F12) buscando el request a "usuarios", y en Netlify usa "Clear cache and deploy site".</div></div></div>
  if(loading)return<div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#F4F5F7"}}><div style={{textAlign:"center"}}><div style={{fontSize:26,marginBottom:8}}>📦</div><div style={{fontSize:18,fontWeight:700,color:"#1C1C1E"}}>Outlet de Puertas</div><div style={{fontSize:13,color:"#6E6E73",marginTop:4}}>Conectando...</div></div></div>

  if(recoveryMode)return<CambiarPasswordScreen onDone={()=>setRecoveryMode(false)}/>
  if(!cu)return<LoginScreen onLogin={async(u)=>{setCu(u)}} users={users} cargarUsuarios={loadUsers}/>

  if(cu&&!appActual)return<AppHub cu={cu} onSelect={v=>{setAppActual(v);try{localStorage.setItem("outlet_app_actual",v)}catch(e){}}} onLogout={async()=>{try{await signOut()}catch(e){}try{localStorage.removeItem("erp_cu_id")}catch(e){}try{localStorage.removeItem("outlet_app_actual")}catch(e){}setCu(null);setAppActual(null)}}/>

  if(appActual==="finanzas")return<FinanzasApp cu={cu} setAppActual={v=>{setAppActual(v);try{if(v)localStorage.setItem("outlet_app_actual",v);else localStorage.removeItem("outlet_app_actual")}catch(e){}}}/>

  if(appActual==="admin")return<AdminApp cu={cu} setAppActual={v=>{setAppActual(v);try{if(v)localStorage.setItem("outlet_app_actual",v);else localStorage.removeItem("outlet_app_actual")}catch(e){}}}/>
  if(appActual==="postventa")return<PostventaApp cu={cu} setAppActual={v=>{setAppActual(v);try{if(v)localStorage.setItem("outlet_app_actual",v);else localStorage.removeItem("outlet_app_actual")}catch(e){}}}/>
  if(appActual==="rrhh")return<RrhhApp cu={cu} setAppActual={v=>{setAppActual(v);try{if(v)localStorage.setItem("outlet_app_actual",v);else localStorage.removeItem("outlet_app_actual")}catch(e){}}}/>
  if(appActual==="inventario")return<InventarioApp cu={cu} setAppActual={v=>{setAppActual(v);try{if(v)localStorage.setItem("outlet_app_actual",v);else localStorage.removeItem("outlet_app_actual")}catch(e){}}}/>
  if(appActual==="agente")return<AgenteApp cu={cu} setAppActual={v=>{setAppActual(v);try{if(v)localStorage.setItem("outlet_app_actual",v);else localStorage.removeItem("outlet_app_actual")}catch(e){}}}/>
  if(appActual==="proyectos")return<ProyectosApp cu={cu} setAppActual={v=>{setAppActual(v);try{if(v)localStorage.setItem("outlet_app_actual",v);else localStorage.removeItem("outlet_app_actual")}catch(e){}}}/>
  if(appActual==="logistica")return<LogisticaApp cu={cu} setAppActual={v=>{setAppActual(v);try{if(v)localStorage.setItem("outlet_app_actual",v);else localStorage.removeItem("outlet_app_actual")}catch(e){}}}/>
  if(appActual==="comercial")return<ComercialApp cu={cu} setAppActual={v=>{setAppActual(v);try{if(v)localStorage.setItem("outlet_app_actual",v);else localStorage.removeItem("outlet_app_actual")}catch(e){}}}/>
  if(appActual==="procesos")return<ProcesosApp cu={cu} setAppActual={v=>{setAppActual(v);try{if(v)localStorage.setItem("outlet_app_actual",v);else localStorage.removeItem("outlet_app_actual")}catch(e){}}}/>
  if(appActual==="compras_op")return<ComprasOpApp cu={cu} setAppActual={v=>{setAppActual(v);try{if(v)localStorage.setItem("outlet_app_actual",v);else localStorage.removeItem("outlet_app_actual")}catch(e){}}}/>

  if(!cmpListo)return<div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#F4F5F7"}}><div style={{textAlign:"center"}}><div style={{fontSize:26,marginBottom:8}}>📦</div><div style={{fontSize:18,fontWeight:700,color:"#1C1C1E"}}>Abastecimiento</div><div style={{fontSize:13,color:"#6E6E73",marginTop:4}}>Cargando datos…</div></div></div>

  const rd=rl(cu)
  const menuCmp=menuVisible(MENU_CMP.map(m=>({...m,grupos:m.grupos.map(g=>({...g,items:g.items.map(i=>i.hoja==="nueva"?{...i,si:()=>h("crear_oc")}:i.hoja==="finanzas"?{...i,si:()=>h("ver_fin")||cu.rol==="admin"}:i.hoja==="config"?{...i,si:()=>h("config")||cu.rol==="admin"}:i)}))})),cu,()=>true)
  const salirCmp=async()=>{try{await signOut()}catch(e){}localStorage.removeItem("erp_cu_id");setCu(null)}
  const propsMenuCmp={menu:menuCmp,hoja:tab,sub:null,onIr:(hj)=>setTab(hj),usuario:cu,rolNombre:rd.l,rolColor:"#16213E",marca:"Abastecimiento",ayuda:[{l:"Flujograma del proceso",hoja:"flujograma"}],badges:{"ordenes|":pend},
    contexto:<span style={{display:"inline-flex",alignItems:"center",gap:10,fontSize:11.5,color:"#6E6E73",flexWrap:"wrap"}}>{v2Pendiente&&<span title="Hay cambios en Política de compra posteriores al último cálculo; el sistema recalcula solo en 1 a 2 minutos" style={{color:"#B25E09",fontWeight:700}}>⟳ Aplicando cambios de parámetros…</span>}{v2App.length?<span style={{display:"inline-flex",alignItems:"center",gap:6}}>Cálculo de reposición al <b style={{color:"#1C1C1E"}}>{(()=>{const d=new Date(v2App[0]?.calculado_at);return isNaN(d)?String(v2App[0]?.calculado_at||"").slice(0,10):d.toLocaleString("es-CL",{timeZone:"America/Santiago",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false})+" h"})()}</b><button title="Recargar el cálculo de reposición" onClick={()=>recargarV2("Cálculo recargado")} style={{border:"1px solid #D1D5DB",background:"#fff",borderRadius:5,padding:"0 6px",height:20,minHeight:0,lineHeight:"18px",cursor:"pointer",fontSize:12,color:"#16213E"}}>↻</button>{v2Aviso&&<span style={{color:"#1E7A44",fontWeight:700}}>{v2Aviso}</span>}</span>:null}<a href="/Manual_ERP_Compras_v1.pdf" target="_blank" rel="noopener" style={{color:"#16213E",fontWeight:600,textDecoration:"none"}}>Manual</a></span>,
    onApps:()=>{setAppActual(null);try{localStorage.removeItem("outlet_app_actual")}catch(e){}},onSalir:salirCmp}

  return<div style={{fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",margin:0,padding:0,background:"#F4F5F7",minHeight:"100vh",fontSize:14}}>
    <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}*{box-sizing:border-box;margin:0;padding:0}body{background:#F4F5F7;overflow-x:hidden}input:focus,select:focus,textarea:focus{border-color:#1D4E89!important;box-shadow:0 0 0 3px rgba(0,122,255,0.1)}::selection{background:#1D4E89;color:#fff}::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:#F4F5F7;border-radius:5px}::-webkit-scrollbar-thumb{background:#C7C7CC;border-radius:5px;border:2px solid #F4F5F7}::-webkit-scrollbar-thumb:hover{background:#6E6E73}table{font-size:13px}th,td{white-space:nowrap}
    /* === Mobile styles (v51) === */
    @media (max-width:767px){
      body{font-size:13px}
      h1,h2,h3{letter-spacing:-0.01em}
      /* Tablas con scroll horizontal natural */
      table{font-size:11px}
      th,td{padding:6px 8px!important}
      /* Los contenedores de tabla permiten scroll horizontal */
      .scroll-x,[style*="overflow:auto"],[style*="overflow: auto"]{-webkit-overflow-scrolling:touch}
      /* Grid de KPIs: 2 columnas en móvil */
      .kpi-grid{grid-template-columns:repeat(2,1fr)!important}
      /* Botones más grandes para dedos */
      button{min-height:36px}
      /* Reducir padding de cards */
      .card-mobile{padding:12px!important}
    }`}</style>

    {isMobile?<MenuMovil {...propsMenuCmp}/>:<MenuSuperior {...propsMenuCmp}/>}
    {!isMobile&&<AyudaContextual/>}
    <main style={{padding:isMobile?"10px 10px 40px":"14px 24px 40px",width:"100%",boxSizing:"border-box"}}>
    {/* CONTENT */}
    {tab==="monitor"&&<MonitorView ocs={ocs} prods={prodsPlan} pagos={pagos} provs={provs} h={h} setTab={setTab} config={config} v2App={v2App}/>}
    {tab==="repo"&&<RepoView ocs={ocs} setDet={setDet} prods={prodsWithTransit} prodsSuc={prodsSuc} cart={cart} setCart={setCart} go={()=>setTab("nueva")} config={config} params={params} paramsABCD={paramsABCD} sucursales={sucursales} fuenteRepoApp={fuenteRepo} setFuenteRepoApp={setFuenteRepo} v2App={v2App}/>}
    {tab==="costeo"&&<CosteoImpView config={config} saveConfig={saveConfig} ocs={ocs} cu={cu} addFirma={addFirma}/>}
    {tab==="forecast"&&<ForecastView prods={prodsPlan} ocs={ocs} config={config} saveConfig={saveConfig}/>}
    {tab==="cobertura"&&<CoberturaView prods={prodsPlan} ocs={ocs} config={config} params={params} paramsABCD={paramsABCD}/>}
    {tab==="llegadas"&&<LlegadasView ocs={ocs} provs={provs} setDet={setDet} config={config} updOC={updOC} sucursales={sucursales} addFirma={addFirma}/>}
    {tab==="proveedores"&&<ProveedoresDesempenoView/>}
    {tab==="plan"&&<PlanComprasView setCart={setCart} setTab={setTab} cart={cart}/>}
    {tab==="transito"&&<TransitoView ocs={ocs} provs={provs} config={config} setDet={setDet}/>}
    {tab==="finanzas"&&<FinanzasView ocs={ocs} provs={provs} pagos={pagos} setPagos={setPagos} config={config} cu={cu} h={h}/>}
    {tab==="nueva"&&<SolView cart={cart} setCart={setCart} provs={provs} users={users} sucursales={sucursales} cu={cu} setOcs={setOcs} addFirma={addFirma} goOC={()=>setTab("ordenes")} ocs={ocs} config={config} notificarFlujo={notificarFlujo} v2App={v2App}/>}
    {tab==="ordenes"&&<OCListView ocs={ocs} firmas={firmas} pagos={pagos} updOC={updOC} addFirma={addFirma} setDet={setDet} cu={cu} h={h} provs={provs} setOcs={setOcs} notificarFlujo={notificarFlujo} ROL_POR_ESTADO={ROL_POR_ESTADO}/>}
    {tab==="flujograma"&&<FlujogramaView ocs={ocs} provs={provs} sucursales={sucursales} users={users} setDet={setDet}/>}
    {tab==="gestion"&&<PmoGestion cu={cu} area="negocios"/>}
    {tab==="config"&&<ConfigView config={config} saveConfig={saveConfig} params={params} setParams={setParams} paramsABCD={paramsABCD} setParamsABCD={setParamsABCD} provs={provs} setProvs={setProvs} users={users} setUsers={setUsers} sucursales={sucursales} setSucursales={setSucursales} h={h} configTab={configTab} setConfigTab={setConfigTab} loadAll={loadAll} cu={cu}/>}

    <FichaOC show={!!det} onClose={()=>setDet(null)} oc={det} provs={provs}>{det&&<ErrBound zona={`detalle de ${det.id}`}><OCDetView key={det.id} oc={det} firmas={firmas.filter(f=>f.oc_id===det.id)} pagos={pagos.filter(p=>p.oc_id===det.id)} provs={provs} updOC={updOC} addFirma={addFirma} setPagos={setPagos} close={()=>{setDet(null);loadAll()}} cu={cu} h={h} config={config} notificarFlujo={notificarFlujo} ROL_POR_ESTADO={ROL_POR_ESTADO} setTab={setTab}/></ErrBound>}</FichaOC>

    </main>
  </div>
}

/* 18-oct-2026: control de confiabilidad: estado de los datos que alimentan la compra y precisión medida del pronóstico */
function ConfiabilidadPanel(){
  const[rows,setRows]=useState(null)
  const[bt,setBt]=useState([])
  const[abierto,setAbierto]=useState(false)
  useEffect(()=>{(async()=>{
    const[a,b]=await Promise.all([supabase.from('v_cmp_salud_datos').select('*').order('ord'),supabase.from('cmp_backtest').select('*').order('calculado_at',{ascending:false}).limit(8)])
    setRows(a.data||[])
    const ult=(b.data||[])[0]?.calculado_at
    setBt((b.data||[]).filter(r=>r.calculado_at===ult))
  })()},[])
  if(!rows)return null
  const crit=rows.filter(r=>r.severidad==="critico"),alerta=rows.filter(r=>r.severidad==="alerta")
  const col=crit.length?"#B42318":alerta.length?"#B25E09":"#1E7A44"
  const sku=bt.find(r=>r.nivel==="SKU"&&r.clase==="Total"),cat=bt.find(r=>r.nivel==="Categoría")
  const sevC={critico:["#B42318","#FEF3F2","Crítico"],alerta:["#B25E09","#FFFAEB","Alerta"],ok:["#1E7A44","#ECFDF3","OK"]}
  return <Cd s={{marginBottom:12,padding:"10px 14px",borderLeft:"4px solid "+col}}>
    <div onClick={()=>setAbierto(a=>!a)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",gap:10,flexWrap:"wrap"}}>
      <div>
        <div style={{fontSize:14,fontWeight:700,color:"#16213E"}}>Confiabilidad de la compra</div>
        <div style={{fontSize:12,color:col,fontWeight:600}}>{crit.length?`${crit.length} control(es) crítico(s)`:"Sin controles críticos"}{alerta.length?` · ${alerta.length} alerta(s)`:""}{sku?` · el pronóstico se equivoca ${Math.round(sku.wape_pct)}% por SKU y ${cat?Math.round(cat.wape_pct)+"%":"—"} por categoría`:""}</div>
      </div>
      <span style={{fontSize:12,color:"#6E6E73"}}>{abierto?"Ocultar ▲":"Ver detalle ▼"}</span>
    </div>
    {abierto&&<div style={{marginTop:10}}>
      <div style={{fontSize:12,color:"#6E6E73",marginBottom:6}}>Cada control mide un dato que alimenta la sugerencia de compra. Un crítico significa que la compra no debería firmarse sin revisarlo.</div>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{textAlign:"left",color:"#6E6E73",borderBottom:"1px solid #E5E7EB"}}><th style={{padding:"5px 4px"}}>Control</th><th>Estado</th><th style={{textAlign:"right",padding:"5px 16px 5px 8px"}}>Valor</th><th style={{padding:"5px 12px 5px 0"}}>Detalle</th><th>Qué hacer</th></tr></thead>
        <tbody>{rows.map(r=>{const[c,bg,l]=sevC[r.severidad]||sevC.ok;return <tr key={r.codigo} style={{borderBottom:"1px solid #F3F4F6",verticalAlign:"top"}}>
          <td style={{padding:"5px 4px",fontWeight:600}}>{r.nombre}</td>
          <td><span style={{padding:"2px 8px",borderRadius:999,background:bg,color:c,fontWeight:700,fontSize:12}}>{l}</span></td>
          <td style={{textAlign:"right",whiteSpace:"nowrap",padding:"5px 16px 5px 8px"}}>{fN(r.valor)} <span style={{color:"#9CA3AF",fontSize:11}}>{r.unidad}</span></td>
          <td style={{color:"#4B5563",maxWidth:320,padding:"5px 12px 5px 0"}}>{r.detalle}</td>
          <td style={{color:"#6B7280"}}>{r.severidad==="ok"?"":r.accion}</td>
        </tr>})}</tbody>
      </table></div>
      {sku&&<div style={{marginTop:10,padding:"8px 10px",background:"#F8FAFC",borderRadius:8,fontSize:12,color:"#374151",lineHeight:1.5}}>
        <b>Precisión del pronóstico</b> (se mide cada lunes prediciendo los últimos 90 días con datos anteriores; no incluye sucursales con menos de 6 meses): el error medio es <b>{Math.round(sku.wape_pct)}% por SKU</b> y <b>{cat?Math.round(cat.wape_pct):"—"}% por categoría</b>. El pronóstico tiende a quedarse {sku.sesgo_pct<0?"corto":"largo"} ({sku.sesgo_pct>0?"+":""}{sku.sesgo_pct}%). Por eso el total de una OC es más confiable que la cantidad de una línea suelta, y cada línea se contrasta al comprar.
      </div>}
    </div>}
  </Cd>
}

/* ═══ MONITOR — Dashboard BI ═══ */
function MonitorView({ocs,prods,pagos=[],provs=[],h,setTab,config={},v2App=[]}){
  const TC_USD=Number(config.tc_usd)||950
  const pN=ocs.filter(o=>o.estado==="Pend. Dir. Negocios"),pF=ocs.filter(o=>o.estado==="Pend. Dir. Finanzas")
  const trans=ocs.filter(o=>["Despacho nac.","Transporte","Internación","Validar costeo final","En fabricación","Embarcada","Pago fabricación","Pago embarque"].includes(o.estado))

  // ⭐ Recepciones: cuadradas vs sin cuadratura (indicador dashboard)
  const recibidas=ocs.filter(o=>["Recibida OK","Recibida parcial","Cerrada"].includes(o.estado))
  const recSinCuadrar=recibidas.filter(o=>o.recepcion_cuadrada===false||o.estado==="Recibida parcial")
  const recCuadradas=recibidas.length-recSinCuadrar.length

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
  const tasaQuiebre=conVenta.length>0?Math.round(conVenta.filter(p=>(p.stock_actual||0)<=0).length/conVenta.length*100):0 // Fase 0: quiebre real (SKUs con venta y stock 0); antes era % de SKUs en estado Reposición

  // ═══ SCORE DE SALUD DEL NEGOCIO (0-100) ═══
  // 40% tasa de quiebre · 30% cobertura crítica · 20% capital inmov · 10% OC atascadas
  const scoreQuiebre=Math.max(0,100-tasaQuiebre*1.5) // 0% quiebre = 100, 67%+ = 0
  const scoreCritico=totalSKU>0?Math.max(0,100-(criticosA.length/totalSKU*100)*20):100
  const scoreInmov=Math.max(0,100-pctCapitalInmov*1.5)
  const ocAtascadas=ocs.filter(o=>{if(["Cerrada","Rechazada","Anulada","Borrador","Recibida OK","Dividida","Fusionada"].includes(o.estado))return false;const dias=diff(o.fecha_creacion)*-1;return dias>14}).length
  const scoreOcs=Math.max(0,100-ocAtascadas*5)
  const scoreTotal=Math.round(scoreQuiebre*0.4+scoreCritico*0.3+scoreInmov*0.2+scoreOcs*0.1)
  const scoreColor=scoreTotal>=80?"#1E7A44":scoreTotal>=60?"#B25E09":scoreTotal>=40?"#B25E09":"#B42318"
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
  if(recSinCuadrar.length>0)alertas.push({sev:"med",ic:"📦",t:`${recSinCuadrar.length} OC recibidas SIN cuadratura`,sub:`${recCuadradas} cuadradas ✓ · Sin cuadrar: ${recSinCuadrar.slice(0,3).map(o=>o.id).join(", ")}${recSinCuadrar.length>3?` +${recSinCuadrar.length-3}`:""}`,action:"Revisar recepciones",tab:"ordenes"})

  // ═══ ABCD ═══
  const abcdData=["A","B","C","D"].map(c=>{const items=prods.filter(p=>p.clasif_abcd===c);return{c,n:items.length,pct:totalSKU>0?Math.round(items.length/totalSKU*100):0,venta:items.reduce((s,p)=>s+(p.venta_total||0),0),stock:items.reduce((s,p)=>s+(p.stock_actual||0),0),stockVal:items.reduce((s,p)=>s+((p.stock_actual||0)*(p.costo_unitario||0)),0),repos:items.filter(p=>p.estado==="Reposición").length,inv:items.filter(p=>p.estado==="Reposición").reduce((s,p)=>s+(p.costo_reposicion||0),0)}})
  const totalVenta=abcdData.reduce((s,d)=>s+d.venta,0)

  // ═══ POR TIPO ═══
  const tipoData=[...new Set(prods.map(p=>p.tipo_producto).filter(Boolean))].map(t=>{const items=prods.filter(p=>p.tipo_producto===t);const repos=items.filter(p=>p.estado==="Reposición");return{tipo:t,total:items.length,repos:repos.length,cobProm:items.filter(p=>(p.venta_total||0)>0).length>0?Math.round(items.filter(p=>(p.venta_total||0)>0).reduce((s,p)=>s+Math.min(p.dias_cobertura||0,365),0)/items.filter(p=>(p.venta_total||0)>0).length):999,inv:repos.reduce((s,p)=>s+(p.costo_reposicion||0),0),venta:items.reduce((s,p)=>s+(p.venta_total||0),0)}}).sort((a,b)=>b.inv-a.inv)

  // ═══ DEAD STOCK ═══
  const deadStock=sinVenta.filter(p=>(p.stock_actual||0)>0).map(p=>({...p,valorStock:(p.stock_actual||0)*(p.costo_unitario||0)})).sort((a,b)=>b.valorStock-a.valorStock)

  // ═══ PIPELINE FINANCIERO ═══
  const totalComprometido=ocs.filter(o=>!["Cerrada","Rechazada","Anulada","Borrador","Dividida","Fusionada"].includes(o.estado)).reduce((s,o)=>s+(o.total_clp||0),0)
  // 18-oct-2026: las cuotas USD con montos en pesos (OC en revisión) se excluyen de los totales para no inflarlos en miles de millones
  const ocPorId=Object.fromEntries(ocs.map(o=>[o.id,o]))
  const cuotaConfiable=p=>{if(p.moneda!=="USD")return true;const o=ocPorId[p.oc_id];if(!o)return true;if((o.total_usd||0)>1000000)return false;return !((o.total_usd||0)>0&&(p.monto||0)>o.total_usd*1.02+1)}
  const cuotasEnRevision=pagos.filter(p=>!cuotaConfiable(p))
  const totalPagado=pagos.filter(p=>p.estado==="Pagado"&&cuotaConfiable(p)).reduce((s,p)=>s+((p.monto||0)*(p.moneda==="USD"?TC_USD:1)),0)
  const totalPendiente=pagos.filter(p=>p.estado!=="Pagado"&&cuotaConfiable(p)).reduce((s,p)=>s+((p.monto||0)*(p.moneda==="USD"?TC_USD:1)),0)

  // ═══ COMPONENTS ═══
  const Bar=({pct,color,h})=><div style={{width:"100%",background:"#F4F5F7",borderRadius:4,height:h||8,overflow:"hidden"}}><div style={{width:Math.max(pct,1)+"%",height:"100%",background:color,borderRadius:4,transition:"width 0.6s cubic-bezier(0.4,0,0.2,1)"}}/></div>

  // Donut ring (SVG)
  const Ring=({value,color,size=88,stroke=10,sub,label})=>{
    const r=(size-stroke)/2
    const circ=2*Math.PI*r
    const offset=circ-(value/100)*circ
    return<div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} stroke="#F4F5F7" strokeWidth={stroke} fill="none"/>
        <circle cx={size/2} cy={size/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} style={{transition:"stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:size>80?22:16,fontWeight:800,color,letterSpacing:"-0.02em",lineHeight:1}}>{value}</div>
        {sub&&<div style={{fontSize:10.5,color:"#6E6E73",marginTop:2,fontWeight:600}}>{sub}</div>}
      </div>
    </div>
  }

  // ⭐ INFORME PDF — Cobertura de reposición por tipo de producto
  const generarInformeCobertura=()=>{
    try{
      const autoTable=(d,o)=>d.autoTable(o)
      const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"})
      const W=210
      const UMBRAL_EXCESO=180 // días de cobertura considerados exceso (criterio declarado)
      const quiebres=prods.filter(p=>(p.stock_actual||0)<=0&&(p.venta_total||0)>0)
        .sort((a,b)=>(b.vta_prom_compensada||0)-(a.vta_prom_compensada||0))
      const excesos=prods.filter(p=>(p.stock_actual||0)>0&&(p.venta_total||0)>0&&(p.dias_cobertura||0)>=UMBRAL_EXCESO)
        .map(p=>({...p,capital:(p.stock_actual||0)*(p.costo_unitario||0)}))
        .sort((a,b)=>b.capital-a.capital)
      const capitalExceso=excesos.reduce((s,p)=>s+p.capital,0)
      const perdidaVentaMes=quiebres.reduce((s,p)=>s+((p.vta_prom_compensada||0)*(p.costo_unitario||0)),0)

      doc.setFillColor(26,26,46);doc.rect(0,0,W,32,"F")
      doc.setTextColor(255,255,255);doc.setFontSize(16);doc.setFont(undefined,"bold")
      doc.text("OUTLET DE PUERTAS SPA",14,13)
      doc.setFontSize(11);doc.setFont(undefined,"normal")
      doc.text("Informe de Cobertura de Reposición · SOP P07 Módulo de Abastecimiento",14,21)
      doc.setFontSize(8);doc.text(`Generado: ${hoy()} ${hora()} · Base: ${totalSKU} SKUs · Criterio exceso: >=${UMBRAL_EXCESO} días de cobertura`,14,27)

      let y=40
      doc.setTextColor(26,26,46);doc.setFontSize(13);doc.setFont(undefined,"bold")
      doc.text("Resumen ejecutivo",14,y);y+=6
      doc.setFontSize(9);doc.setFont(undefined,"normal");doc.setTextColor(60,60,60)
      const resumen=[
        `El catálogo activo comprende ${totalSKU} SKUs, de los cuales ${conVenta.length} registran ventas en la ventana de análisis y ${sinVenta.length} no presentan rotación.`,
        `Situación de quiebre: ${quiebres.length} SKUs con venta activa están HOY sin stock (${totalSKU>0?Math.round(quiebres.length/totalSKU*100):0}% del catálogo). La venta mensual en riesgo por estos quiebres se estima en ${fmt(perdidaVentaMes)} a costo.`,
        `Exceso de cobertura: ${excesos.length} SKUs superan los ${UMBRAL_EXCESO} días de cobertura, inmovilizando ${fmt(capitalExceso)} de capital en inventario de baja rotación relativa.`,
        `La cobertura promedio general es de ${cobPromedio} días. ${enRepo.length} SKUs requieren reposición según punto de reorden, con una inversión estimada de ${fmt(invReposicion)}${invClaseA>0?` (${fmt(invClaseA)} corresponde a clase A, prioritaria)`:""}.`,
      ]
      for(const par of resumen){
        const lines=doc.splitTextToSize(par,W-28)
        doc.text(lines,14,y);y+=lines.length*4.2+2
      }
      y+=2

      doc.setFontSize(13);doc.setFont(undefined,"bold");doc.setTextColor(26,26,46)
      doc.text("Estado de cobertura por tipo de producto",14,y);y+=3
      const tipoRows=tipoData.map(t=>{
        const items=prods.filter(p=>p.tipo_producto===t.tipo)
        const enQ=items.filter(p=>(p.stock_actual||0)<=0&&(p.venta_total||0)>0).length
        const exItems=items.filter(p=>(p.stock_actual||0)>0&&(p.venta_total||0)>0&&(p.dias_cobertura||0)>=UMBRAL_EXCESO)
        const capEx=exItems.reduce((s,p)=>s+(p.stock_actual||0)*(p.costo_unitario||0),0)
        const semaforo=enQ>items.length*0.3?"CRITICO":enQ>0?"ATENCION":exItems.length>items.length*0.3?"SOBRE-STOCK":"OK"
        return[t.tipo,String(t.total),String(t.repos),String(enQ),t.cobProm>=999?"—":String(t.cobProm),String(exItems.length),fmt(capEx),fmt(t.inv),semaforo]
      })
      autoTable(doc,{
        startY:y,
        head:[["Tipo de producto","SKUs","En repos.","En quiebre","Cob. prom (d)","En exceso","Capital exceso","Inv. reposición","Estado"]],
        body:tipoRows,
        theme:"striped",styles:{fontSize:7,cellPadding:1.8},headStyles:{fillColor:[26,26,46],fontSize:7},
        columnStyles:{1:{halign:"right"},2:{halign:"right"},3:{halign:"right"},4:{halign:"right"},5:{halign:"right"},6:{halign:"right"},7:{halign:"right"},8:{halign:"center",fontStyle:"bold"}},
        didParseCell:(data)=>{if(data.section==="body"&&data.column.index===8){const v=data.cell.raw;data.cell.styles.textColor=v==="CRITICO"?[255,59,48]:v==="ATENCION"?[255,149,0]:v==="SOBRE-STOCK"?[88,86,214]:[52,199,89]}}
      })
      y=doc.lastAutoTable.finalY+8

      if(y>230){doc.addPage();y=20}
      doc.setFontSize(13);doc.setFont(undefined,"bold");doc.setTextColor(255,59,48)
      doc.text(`ALERTA · Productos en quiebre (${quiebres.length})`,14,y);y+=5
      doc.setFontSize(8.5);doc.setFont(undefined,"normal");doc.setTextColor(60,60,60)
      const txtQ=doc.splitTextToSize(`SKUs con venta activa y stock cero: cada día sin stock es venta perdida. Se listan ordenados por venta promedio mensual compensada (mayor impacto primero). La columna "Reposición" indica las unidades sugeridas según punto de reorden y la inversión asociada a costo unitario.`,W-28)
      doc.text(txtQ,14,y);y+=txtQ.length*3.8+2
      autoTable(doc,{
        startY:y,
        head:[["SKU","Producto","Tipo","ABCD","Vta prom/mes","Meses quiebre","Reposición (uds)","Inversión"]],
        body:quiebres.slice(0,40).map(p=>[p.sku,(p.producto||"").slice(0,42),(p.tipo_producto||"").slice(0,20),p.clasif_abcd||"—",fN(p.vta_prom_compensada||0),String(p.meses_quiebre||0),fN(p.reposicion_necesaria||0),fmt(p.costo_reposicion||0)]),
        theme:"striped",styles:{fontSize:6.8,cellPadding:1.6},headStyles:{fillColor:[255,59,48],fontSize:6.8},
        columnStyles:{4:{halign:"right"},5:{halign:"right"},6:{halign:"right"},7:{halign:"right"}}
      })
      y=doc.lastAutoTable.finalY+4
      if(quiebres.length>40){doc.setFontSize(8);doc.setTextColor(120,120,120);doc.text(`… y ${quiebres.length-40} SKUs adicionales en quiebre (ver módulo Reposición para el detalle completo).`,14,y);y+=6}
      y+=4

      if(y>220){doc.addPage();y=20}
      doc.setFontSize(13);doc.setFont(undefined,"bold");doc.setTextColor(88,86,214)
      doc.text(`ALERTA · Exceso de cobertura (${excesos.length})`,14,y);y+=5
      doc.setFontSize(8.5);doc.setFont(undefined,"normal");doc.setTextColor(60,60,60)
      const txtE=doc.splitTextToSize(`SKUs con más de ${UMBRAL_EXCESO} días de cobertura: capital inmovilizado en inventario que rota lento respecto de su stock. Ordenados por capital comprometido. Acciones sugeridas: pausar recompra, evaluar liquidación o traspaso entre sucursales.`,W-28)
      doc.text(txtE,14,y);y+=txtE.length*3.8+2
      autoTable(doc,{
        startY:y,
        head:[["SKU","Producto","Tipo","ABCD","Stock","Vta prom/mes","Cobertura (d)","Capital inmovilizado"]],
        body:excesos.slice(0,40).map(p=>[p.sku,(p.producto||"").slice(0,42),(p.tipo_producto||"").slice(0,20),p.clasif_abcd||"—",fN(p.stock_actual||0),fN(p.vta_prom_compensada||0),fN(Math.min(p.dias_cobertura||0,9999)),fmt(p.capital)]),
        theme:"striped",styles:{fontSize:6.8,cellPadding:1.6},headStyles:{fillColor:[88,86,214],fontSize:6.8},
        columnStyles:{4:{halign:"right"},5:{halign:"right"},6:{halign:"right"},7:{halign:"right"}}
      })
      y=doc.lastAutoTable.finalY+4
      if(excesos.length>40){doc.setFontSize(8);doc.setTextColor(120,120,120);doc.text(`… y ${excesos.length-40} SKUs adicionales en exceso.`,14,y);y+=6}

      if(deadStock.length>0){
        if(y>230){doc.addPage();y=20}
        y+=4
        doc.setFontSize(11);doc.setFont(undefined,"bold");doc.setTextColor(142,142,147)
        doc.text(`Complemento · Stock sin rotación (${deadStock.length} SKUs · ${fmt(stockSinRotVal)})`,14,y);y+=4
        autoTable(doc,{
          startY:y,
          head:[["SKU","Producto","Stock","Capital"]],
          body:deadStock.slice(0,15).map(p=>[p.sku,(p.producto||"").slice(0,55),fN(p.stock_actual||0),fmt(p.valorStock)]),
          theme:"plain",styles:{fontSize:6.8,cellPadding:1.4},headStyles:{fontSize:6.8,fontStyle:"bold",textColor:[100,100,100]},
          columnStyles:{2:{halign:"right"},3:{halign:"right"}}
        })
      }

      const pages=doc.internal.getNumberOfPages()
      for(let i=1;i<=pages;i++){
        doc.setPage(i);doc.setFontSize(7);doc.setTextColor(150,150,150)
        doc.text(`Outlet de Puertas SpA · Informe de cobertura de reposición · ${hoy()} ${hora()} · Página ${i}/${pages}`,W/2,290,{align:"center"})
      }
      doc.save(`Informe_Cobertura_Reposicion_${hoy()}.pdf`)
    }catch(e){
      console.error("[generarInformeCobertura]",e)
      alert("Error generando el informe: "+(e?.message||e))
    }
  }


  return<div>
    <ConfiabilidadPanel/>
    {/* 18-oct-2026: Monitor con el formato del ecosistema: encabezado, franja de indicadores (cada una lleva a su pantalla) y alertas en panel */}
    <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:10}}>
      <div>
        <div style={{fontSize:20,fontWeight:800,color:"#16213E",letterSpacing:"-0.02em"}}>Monitor de abastecimiento</div>
        <div style={{fontSize:12,color:"#6E6E73",maxWidth:720}}>Salud del abastecimiento: <b style={{color:scoreColor}}>{scoreLabel.toLowerCase()} ({scoreTotal} de 100)</b>. {scoreTotal>=80?"Opera saludablemente; mantener el ritmo de reposición.":scoreTotal>=60?"Estable, con áreas que requieren atención.":scoreTotal>=40?"Varios indicadores requieren acción; priorizar las alertas.":"Varias áreas críticas a la vez; requiere intervención en reposición y flujo de OC."}</div>
      </div>
      <button onClick={generarInformeCobertura} style={{padding:"6px 12px",borderRadius:6,border:"1px solid #D1D5DB",background:"#fff",color:"#16213E",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Informe de cobertura</button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",background:"#fff",border:"1px solid #E5E7EB",borderBottom:"none",borderRadius:8,overflow:"hidden",marginBottom:12}}>
      {[
        ["Salud",`${scoreTotal} / 100`,`Abastec. ${Math.round(scoreQuiebre)} · Críticos ${Math.round(scoreCritico)} · Capital ${Math.round(scoreInmov)} · OC ${Math.round(scoreOcs)}`,scoreColor,null],
        ["Quiebre real",`${tasaQuiebre}%`,"SKUs con venta y sin stock",tasaQuiebre>50?"#B42318":tasaQuiebre>30?"#B25E09":"#1E7A44","repo"],
        ["SKUs a reponer",fN(enRepo.length),`A ${abcdData[0].repos} · B ${abcdData[1].repos} · C ${abcdData[2].repos} · D ${abcdData[3].repos}`,"#1C1C1E","repo"],
        ["Inversión sugerida",fmt(invReposicion),invClaseA>0?`clase A ${fmt(invClaseA)}`:"","#B25E09","repo"],
        ["Críticos A y B",fN(criticos.length),"menos de 15 días de cobertura",criticos.length?"#B42318":"#1E7A44","cobertura"],
        ["Cobertura",`${cobPromedio} días`,"promedio, SKUs con venta","#1D4E89","cobertura"],
        ["Sin rotación",`${pctCapitalInmov}%`,`del capital · ${fmt(stockSinRotVal)}`,pctCapitalInmov>20?"#B25E09":"#1C1C1E",null],
        ["OC por aprobar",fN(pN.length+pF.length),`Negocios ${pN.length} · Finanzas ${pF.length}`,(pN.length+pF.length)?"#B25E09":"#1C1C1E","ordenes"],
        ["OC en tránsito",fN(trans.length),"","#1C1C1E","transito"],
        ["Sin cuadrar",fN(recSinCuadrar.length),`recepciones · ${recCuadradas} cuadradas`,recSinCuadrar.length?"#B25E09":"#1E7A44","ordenes"],
      ].map(([l,v,sub,c,t],k)=>{const cont=<><div style={{fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",letterSpacing:0.5,whiteSpace:"nowrap"}}>{l}{t&&<span style={{color:"#B0B4BC",marginLeft:4}}>›</span>}</div><div style={{fontSize:15,fontWeight:700,color:c,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{v}</div>{sub?<div style={{fontSize:11,color:"#6E6E73",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sub}</div>:null}</>
        const base={padding:"8px 12px",textAlign:"left",background:"#fff",minWidth:0,overflow:"hidden",borderRight:"1px solid #E5E7EB",borderBottom:"1px solid #E5E7EB"}
        return t&&setTab?<button key={k} onClick={()=>setTab(t)} title="Ver el detalle" style={{...base,borderTop:"none",borderLeft:"none",cursor:"pointer",font:"inherit"}}>{cont}</button>:<div key={k} style={base}>{cont}</div>})}
    </div>
    <Venta12Meses filas={v2App}/>
    {alertas.length>0&&<div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:8,marginBottom:12,overflow:"hidden"}}>
      <div style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB",display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:13.5,fontWeight:700,color:"#16213E"}}>Requiere tu atención</span><span style={{fontSize:12,color:"#6E6E73"}}>{alertas.length} alerta(s)</span></div>
      {alertas.map((a,i)=>{const cSev=a.sev==="high"?"#B42318":a.sev==="med"?"#B25E09":"#1D4E89";return <div key={i} onClick={()=>a.tab&&setTab&&setTab(a.tab)} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderTop:i?"1px solid #F3F4F6":"none",borderLeft:`3px solid ${cSev}`,cursor:a.tab?"pointer":"default"}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:700,color:"#1C1C1E"}}>{a.t}</div><div style={{fontSize:12,color:"#6E6E73"}}>{a.sub}</div></div>
        {a.tab&&<span style={{fontSize:12,fontWeight:600,color:cSev,whiteSpace:"nowrap"}}>{a.action} ›</span>}
      </div>})}
    </div>}

    {/* ══════════════════════════════════════════ */}
    {/* PIPELINE FINANCIERO                       */}
    {/* ══════════════════════════════════════════ */}
    <div style={{background:"#fff",borderRadius:8,padding:"18px 22px",border:"1px solid #E5E7EB",marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div>
          <div style={{fontSize:13.5,fontWeight:700,color:"#16213E"}}>Flujo financiero de compras</div>
          <div style={{fontSize:12,color:"#6E6E73",marginTop:2}}>Flujo de compras desde aprobación hasta pago{cuotasEnRevision.length>0&&<span style={{color:"#B42318"}}> · excluye {cuotasEnRevision.length} cuota(s) USD en revisión ({[...new Set(cuotasEnRevision.map(p=>p.oc_id))].join(", ")})</span>}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:11,color:"#6E6E73",fontWeight:600}}>TOTAL COMPROMETIDO</div>
          <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>{fmt(totalComprometido)}</div>
        </div>
      </div>
      <div className="kpi-grid" style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
        {[
          {n:"Aprobación",c:"#1D4E89",ic:"⏳",count:pN.length+pF.length,val:[...pN,...pF].reduce((s,o)=>s+(o.total_clp||0),0),tab:"ordenes"},
          {n:"Proveedor",c:"#B25E09",ic:"🔄",count:ocs.filter(o=>["Pend. proveedor","Confirmada prov.","Proforma OK"].includes(o.estado)).length,val:ocs.filter(o=>["Pend. proveedor","Confirmada prov.","Proforma OK"].includes(o.estado)).reduce((s,o)=>s+(o.total_clp||0),0),tab:"ordenes"},
          {n:"En tránsito",c:"#5B2C6F",ic:"🚢",count:trans.length,val:trans.reduce((s,o)=>s+(o.total_clp||0),0),tab:"transito"},
          {n:"Pagos pend.",c:"#B42318",ic:"💰",count:pagos.filter(p=>p.estado!=="Pagado").length,val:totalPendiente,tab:"finanzas"},
          {n:"Ejecutados",c:"#1E7A44",ic:"✓",count:pagos.filter(p=>p.estado==="Pagado").length,val:totalPagado,tab:"finanzas"}
        ].map((s,i)=><div key={i} onClick={()=>s.tab&&setTab&&setTab(s.tab)} style={{padding:"14px 16px",borderRadius:10,background:s.c+"08",border:`1px solid ${s.c}20`,cursor:s.tab?"pointer":"default",transition:"all 0.2s"}}
          onMouseEnter={e=>{if(s.tab){e.currentTarget.style.background=s.c+"14";e.currentTarget.style.transform="translateY(-2px)"}}}
          onMouseLeave={e=>{if(s.tab){e.currentTarget.style.background=s.c+"08";e.currentTarget.style.transform=""}}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
            <span style={{fontSize:14}}>{s.ic}</span>
            <div style={{fontSize:12,fontWeight:700,color:s.c,textTransform:"uppercase",letterSpacing:"0.02em"}}>{s.n}</div>
          </div>
          <div style={{fontSize:20,fontWeight:800,color:s.c,letterSpacing:"-0.02em",lineHeight:1}}>{s.count}</div>
          <div style={{fontSize:12,color:"#6E6E73",marginTop:4}}>{fmt(s.val)}</div>
        </div>)}
      </div>
    </div>

    {/* ══════════════════════════════════════════ */}
    {/* ABCD + CAPITAL                            */}
    {/* ══════════════════════════════════════════ */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
      <div style={{background:"#fff",borderRadius:8,padding:"18px 22px",border:"1px solid #E5E7EB"}}>
        <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",letterSpacing:"-0.02em",marginBottom:4}}>Clasificación ABCD</div>
        <div style={{fontSize:12,color:"#6E6E73",marginBottom:14}}>Participación en ventas · Regla 80/20</div>
        {abcdData.map(d=>{const pctVenta=totalVenta>0?Math.round(d.venta/totalVenta*100):0;return<div key={d.c} style={{marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:32,height:32,borderRadius:8,background:CL[d.c]?.bg,color:CL[d.c]?.c,fontSize:14,fontWeight:800}}>{d.c}</span>
              <div>
                <div style={{fontSize:13,fontWeight:700}}>{d.n} SKUs <span style={{color:"#6E6E73",fontWeight:500}}>({d.pct}%)</span></div>
                <div style={{fontSize:11,color:"#6E6E73"}}>{CL[d.c]?.t}</div>
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:15,fontWeight:800,color:CL[d.c]?.c,letterSpacing:"-0.02em"}}>{pctVenta}%</div>
              <div style={{fontSize:11,color:"#6E6E73"}}>de las ventas</div>
            </div>
          </div>
          <Bar pct={pctVenta} color={CL[d.c]?.c} h={8}/>
          {d.repos>0&&<div style={{fontSize:11,color:"#B42318",marginTop:4,fontWeight:600}}>⚠ {d.repos} SKUs necesitan reposición ({fmt(d.inv)})</div>}
        </div>})}
      </div>

      <div style={{background:"#fff",borderRadius:8,padding:"18px 22px",border:"1px solid #E5E7EB"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
          <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Capital inmovilizado</div>
          <span style={{fontSize:11,fontWeight:700,padding:"3px 8px",borderRadius:10,background:pctCapitalInmov>30?"#B4231815":pctCapitalInmov>15?"#B25E0915":"#1E7A4415",color:pctCapitalInmov>30?"#B42318":pctCapitalInmov>15?"#B25E09":"#1E7A44"}}>{pctCapitalInmov}%</span>
        </div>
        <div style={{fontSize:12,color:"#6E6E73",marginBottom:14}}>Stock sin rotación que atasca flujo</div>
        <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:12}}>
          <div style={{fontSize:24,fontWeight:800,color:"#5B2C6F",letterSpacing:"-0.02em",lineHeight:1}}>{fmt(stockSinRotVal)}</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          <div style={{padding:"10px 12px",background:"#F8F8FA",borderRadius:8}}>
            <div style={{fontSize:11,color:"#6E6E73",fontWeight:600}}>SKUs sin venta</div>
            <div style={{fontSize:18,fontWeight:800,color:"#1C1C1E"}}>{deadStock.length}</div>
          </div>
          <div style={{padding:"10px 12px",background:"#F8F8FA",borderRadius:8}}>
            <div style={{fontSize:11,color:"#6E6E73",fontWeight:600}}>Unidades</div>
            <div style={{fontSize:18,fontWeight:800,color:"#1C1C1E"}}>{fN(sinVenta.reduce((s,p)=>s+(p.stock_actual||0),0))}</div>
          </div>
        </div>
        {deadStock.length>0&&<div style={{maxHeight:140,overflowY:"auto",marginTop:8,borderTop:"1px solid #F4F5F7",paddingTop:10}}>
          <div style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",marginBottom:6}}>Top stock sin rotación</div>
          {deadStock.slice(0,5).map((p,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",fontSize:12}}>
            <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:220,fontWeight:500}}>{p.producto}</span>
            <strong style={{color:"#5B2C6F"}}>{fmt(p.valorStock)}</strong>
          </div>)}
        </div>}
      </div>
    </div>

    {/* ══════════════════════════════════════════ */}
    {/* TOP URGENTES + COBERTURA POR TIPO         */}
    {/* ══════════════════════════════════════════ */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      <div style={{background:"#fff",borderRadius:8,padding:"18px 22px",border:"1px solid #E5E7EB"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",letterSpacing:"-0.02em"}}>🔥 Top 10 urgentes</div>
            <div style={{fontSize:12,color:"#6E6E73",marginTop:2}}>Cobertura más baja entre los que necesitan reposición</div>
          </div>
          <button onClick={()=>setTab&&setTab("repo")} style={{background:"none",border:"1px solid #E5E7EB",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:600,color:"#1D4E89",cursor:"pointer"}}>Ir a Reposición →</button>
        </div>
        <div style={{maxHeight:340,overflowY:"auto"}}>
          {enRepo.sort((a,b)=>(a.dias_cobertura||999)-(b.dias_cobertura||999)).slice(0,10).map((p,i)=>{
            const cobColor=p.dias_cobertura<7?"#B42318":p.dias_cobertura<15?"#B25E09":"#1D4E89"
            return<div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:i<9?"1px solid #F4F5F7":"none"}}>
              <div style={{width:28,height:28,borderRadius:14,background:i<3?"#B4231815":"#F8F8FA",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:i<3?"#B42318":"#6E6E73",flexShrink:0}}>{i+1}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.producto}</div>
                <div style={{fontSize:11,color:"#6E6E73",marginTop:1}}>{p.tipo_producto} · <span style={{color:CL[p.clasif_abcd]?.c,fontWeight:700}}>{p.clasif_abcd}</span> · SKU {p.sku}</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:14,fontWeight:800,color:cobColor}}>{p.dias_cobertura&&p.dias_cobertura<999?Math.round(p.dias_cobertura):0}d</div>
                <div style={{fontSize:11,color:"#6E6E73"}}>Repo: {fN(p.reposicion_necesaria)}</div>
              </div>
            </div>
          })}
          {enRepo.length===0&&<div style={{textAlign:"center",padding:40,color:"#1E7A44"}}><div style={{fontSize:26,marginBottom:8}}>🎉</div><div style={{fontSize:13,fontWeight:600}}>No hay productos en quiebre</div></div>}
        </div>
      </div>

      <div style={{background:"#fff",borderRadius:8,padding:"18px 22px",border:"1px solid #E5E7EB"}}>
        <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E",letterSpacing:"-0.02em",marginBottom:4}}>📊 Cobertura por tipo</div>
        <div style={{fontSize:12,color:"#6E6E73",marginBottom:14}}>Días promedio de stock disponible por categoría</div>
        <div style={{maxHeight:340,overflowY:"auto"}}>
          {tipoData.filter(t=>t.venta>0).slice(0,12).map((t,i)=>{const cobColor=t.cobProm<15?"#B42318":t.cobProm<30?"#B25E09":t.cobProm<60?"#1D4E89":"#1E7A44";return<div key={i} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:600,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.tipo}</span>
              <div style={{display:"flex",gap:10,fontSize:12,alignItems:"center"}}>
                <span style={{color:cobColor,fontWeight:800,fontSize:13}}>{t.cobProm}d</span>
                {t.repos>0&&<span style={{color:"#B42318",fontWeight:700}}>{t.repos} repo</span>}
                <span style={{color:"#6E6E73"}}>{t.total} SKUs</span>
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
/* ⭐ Tooltip explicativo del cálculo de reposición */
function TooltipFormula({it,mNames,params=[],paramsABCD=[]}){
  const[show,setShow]=useState(false)
  const[tooltipPos,setTooltipPos]=useState({top:0,left:0})
  const handleEnter=(e)=>{
    const r=e.currentTarget.getBoundingClientRect()
    const tw=360,th=480
    let left=r.right-tw // alinear derecha del tooltip con derecha del número
    let top=r.bottom+8
    // si se sale por la derecha, pegar al borde
    if(left<10)left=10
    if(left+tw>window.innerWidth-10)left=window.innerWidth-tw-10
    // si no cabe abajo, mostrar arriba
    if(top+th>window.innerHeight-10)top=Math.max(10,r.top-th-8)
    setTooltipPos({top,left})
    setShow(true)
  }
  const isR=it.estado==="Reposición"
  const sales=[it.venta_mes_1||0,it.venta_mes_2||0,it.venta_mes_3||0,it.venta_mes_4||0,it.venta_mes_5||0,it.venta_mes_6||0]
  const ventaTotal=sales.reduce((s,x)=>s+x,0)
  const mesesQuiebre=it.meses_quiebre||0
  const vtaCompensada=Math.round(it.vta_prom_compensada||0)
  const vtaRaw=Math.round(it.vta_prom_raw||0)
  const vtaDia=it.vta_prom_diaria||0
  const tp=(params||[]).find(p=>p.tipo_producto===it.tipo_producto)
  const abcdP=(paramsABCD||[]).find(a=>a.clasificacion===it.clasif_abcd)
  const fab=tp?.dias_fabricacion||it.dias_fabricacion||0
  const emerg=abcdP?.dias_emergencia||it.dias_emergencia||0
  const cob=tp?.periodo_cobertura||it.periodo_cubrir||0
  const ptoRe=Math.round(it.punto_reorden||0)
  const repo=it.reposicion_necesaria||0
  const stock=it.stock_actual||0
  const transito=it.stock_transito||0
  const necesidadBruta=Math.round(vtaDia*cob)+ptoRe
  return<div style={{position:"relative",display:"inline-block"}}
    onMouseEnter={handleEnter} onMouseLeave={()=>setShow(false)}>
    <strong style={{color:isR?"#B42318":"#1C1C1E",cursor:"help",borderBottom:isR?"1px dotted #B42318":"1px dotted transparent"}}>
      {repo?fN(repo):"—"}
    </strong>
    {show&&<div style={{position:"fixed",zIndex:9999,background:"linear-gradient(135deg,#1a1a2e,#16213e)",color:"#fff",padding:"14px 16px",borderRadius:12,fontSize:12,lineHeight:1.55,width:360,maxWidth:"calc(100vw - 40px)",boxShadow:"0 8px 32px rgba(0,0,0,0.4)",fontWeight:400,textAlign:"left",letterSpacing:0.1,top:tooltipPos.top,left:tooltipPos.left,pointerEvents:"none"}}>
      <div style={{fontSize:12,fontWeight:700,marginBottom:8,color:"#FFD60A"}}>🧮 Cómo se calculó {fN(repo)} u</div>
      <div style={{fontWeight:700,color:"#1D4E89",marginBottom:3,fontSize:11,textTransform:"uppercase",letterSpacing:0.5}}>1. Ventas mensuales</div>
      <div style={{paddingLeft:8,marginBottom:8,opacity:0.9}}>
        {mNames.map((m,i)=><span key={i}>{m}: <b>{fN(sales[i])}</b>{i<mNames.length-1?" · ":""}</span>)}<br/>
        Total {mNames.length} meses: <b>{fN(ventaTotal)}u</b>
      </div>
      <div style={{fontWeight:700,color:"#1D4E89",marginBottom:3,fontSize:11,textTransform:"uppercase",letterSpacing:0.5}}>2. Promedio mensual {mesesQuiebre>0?"(compensado)":""}</div>
      <div style={{paddingLeft:8,marginBottom:8,opacity:0.9}}>
        {mesesQuiebre>0?<>Meses de quiebre detectados: <b>{mesesQuiebre}</b><br/>Promedio sin quiebre: <b>{fN(vtaCompensada)} u/mes</b><br/><span style={{color:"#FFD60A",fontSize:11}}>↑ se ignoran meses con stock=0 para no subestimar</span></>:<>Promedio: <b>{fN(vtaCompensada)} u/mes</b></>}
      </div>
      <div style={{fontWeight:700,color:"#1D4E89",marginBottom:3,fontSize:11,textTransform:"uppercase",letterSpacing:0.5}}>3. Venta diaria</div>
      <div style={{paddingLeft:8,marginBottom:8,opacity:0.9}}>
        {fN(vtaCompensada)} ÷ 30 = <b>{vtaDia.toFixed(1)} u/día</b>
      </div>
      <div style={{fontWeight:700,color:"#1D4E89",marginBottom:3,fontSize:11,textTransform:"uppercase",letterSpacing:0.5}}>4. Punto de reorden</div>
      <div style={{paddingLeft:8,marginBottom:8,opacity:0.9}}>
        Fab ({fab}d) + Emerg ({emerg}d) = <b>{fab+emerg}d</b><br/>
        {vtaDia.toFixed(1)} × {fab+emerg} = <b>{fN(ptoRe)} u</b>
        <div style={{fontSize:11,opacity:0.7,marginTop:2}}>↑ stock mínimo para no quedar sin producto durante fabricación</div>
      </div>
      <div style={{fontWeight:700,color:"#1D4E89",marginBottom:3,fontSize:11,textTransform:"uppercase",letterSpacing:0.5}}>5. Reposición necesaria</div>
      <div style={{paddingLeft:8,marginBottom:6,opacity:0.95}}>
        Cobertura ({cob}d): {vtaDia.toFixed(1)} × {cob} = <b>{fN(Math.round(vtaDia*cob))} u</b><br/>
        + Pto reorden: <b>{fN(ptoRe)} u</b><br/>
        = Necesidad bruta: <b>{fN(necesidadBruta)} u</b><br/>
        − Stock actual: <b>{fN(stock)} u</b><br/>
        {transito>0&&<>− Stock tránsito: <b>{fN(transito)} u</b><br/></>}
        <div style={{borderTop:"1px solid rgba(255,255,255,0.2)",marginTop:4,paddingTop:4}}>
          = <b style={{color:"#FFD60A",fontSize:13}}>{fN(repo)} u a pedir</b>
        </div>
      </div>
    </div>}
  </div>
}

/* Fase 3 (17-oct-2026): filas del cálculo v2 en el formato que usan Reposición, Monitor, Cobertura y Forecast */
const v2AProd=(r)=>{const h=new Date();const vm=r.ventas_mes||{};const o={sku:r.sku,producto:r.producto,tipo_producto:r.tipo_producto,clasif_abcd:r.clasif_abcd,estado:r.estado,stock_actual:Number(r.stock)||0,stock_transito:Number(r.transito)||0,venta_total:Number(r.unid_12m)||0,vta_prom_compensada:Number(r.demanda_mes)||0,vta_prom_diaria:Number(r.demanda_dia)||0,dias_cobertura:r.dias_cobertura,punto_reorden:Number(r.punto_reorden)||0,reposicion_necesaria:Number(r.reposicion)||0,costo_unitario:Number(r.costo_unitario)||0,costo_reposicion:Number(r.inversion)||0,dias_fabricacion:r.lead_time_dias,dias_emergencia:r.dias_emergencia,periodo_cubrir:r.periodo_cubrir,meses_quiebre:r.pct_disponible!=null?Math.round(100-Number(r.pct_disponible)):0,_v2:r};for(let k=6;k>=1;k--){const d=new Date(h.getFullYear(),h.getMonth()-k,1);o[`venta_mes_${7-k}`]=Number(vm[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`])||0}o.venta_mes_actual=Number(vm[`${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,"0")}`])||0;return o}
const v2SucAProd=(r)=>{const h=new Date();const vm=r.ventas_mes||{};const o={sku:r.sku,producto:r.producto,tipo_producto:r.tipo_producto,clasif_abcd:r.clasif_abcd,estado:r.estado,stock_actual:Number(r.stock)||0,stock_transito:r.modalidad==="Directo"?0:(Number(r.stock_cd)||0),venta_total:Number(r.unid_12m)||0,vta_prom_compensada:Math.round((Number(r.demanda_dia)||0)*30),vta_prom_diaria:Number(r.demanda_dia)||0,dias_cobertura:r.dias_cobertura,punto_reorden:Number(r.punto_reorden)||0,reposicion_necesaria:Number(r.reponer??r.traslado_sugerido)||0,costo_unitario:Number(r.costo_unitario)||0,costo_reposicion:Number(r.valor_reponer??r.valor_traslado)||0,dias_fabricacion:r.lead_time,dias_emergencia:r.seguridad,periodo_cubrir:r.cobertura,meses_quiebre:r.pct_disponible!=null?Math.round(100-Number(r.pct_disponible)):0,_v2s:r};for(let k=6;k>=1;k--){const d=new Date(h.getFullYear(),h.getMonth()-k,1);o[`venta_mes_${7-k}`]=Number(vm[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`])||0}o.venta_mes_actual=Number(vm[`${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,"0")}`])||0;return o}
/* 19-oct-2026: leyenda del cálculo de cada producto: 12 meses con su tratamiento, venta promedio y ecuación con sus números */
const LC_FLAG={normal:{l:"Normal",c:"#1E7A44",bg:"#ECFDF3",usa:true},quiebre_compensado:{l:"Quiebre: se compensa",c:"#1D4E89",bg:"#EEF4FB",usa:true},quiebre_excluido:{l:"Quiebre: no entra",c:"#B42318",bg:"#FEF3F2",usa:false},quiebre_probable:{l:"Probable quiebre: no entra",c:"#B25E09",bg:"#FFFAEB",usa:false},atipico:{l:"Atípico: no entra",c:"#5B2C6F",bg:"#F5EEF8",usa:false}}
const lcMes=k=>{const[y,m]=String(k||"").split("-");return m?["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][Number(m)-1]+" "+String(y).slice(2):k}
const lcN=(v,dec=1)=>v==null||isNaN(Number(v))?"—":Number(v).toLocaleString("es-CL",{maximumFractionDigits:dec})
function LeyendaCalculo({r,onClose}){
  const[d,setD]=useState(null)
  useEffect(()=>{let vivo=true;(async()=>{const{data}=await supabase.from('cmp_reposicion_detalle').select('detalle').eq('sku',r.sku).limit(1);if(vivo)setD(data?.[0]?.detalle||{})})();return()=>{vivo=false}},[r.sku])
  useEffect(()=>{const k=e=>{if(e.key==="Escape")onClose()};window.addEventListener("keydown",k);return()=>window.removeEventListener("keydown",k)},[])
  const v2=r._v2||{}
  const meses=d?.meses||[]
  const maxU=Math.max(1,...meses.map(m=>Number(m.u)||0))
  const usados=meses.filter(m=>LC_FLAG[m.flag]?.usa)
  const tasaUsada=m=>m.flag==="quiebre_compensado"&&Number(m.disp)>0?Number(m.tasa)/Number(m.disp):Number(m.tasa)
  const fila=(l,v,sub)=><div style={{display:"flex",justifyContent:"space-between",gap:12,padding:"7px 0",borderTop:"1px solid #F1F2F4"}}><span style={{color:"#3A3A3C"}}>{l}{sub&&<span style={{display:"block",fontSize:11.5,color:"#6E6E73"}}>{sub}</span>}</span><b style={{whiteSpace:"nowrap",color:"#1C1C1E"}}>{v}</b></div>
  const ec=(t,f,res,dest)=><div style={{padding:"8px 12px",borderRadius:8,background:dest?"#16213E":"#fff",color:dest?"#fff":"#1C1C1E",border:dest?"none":"1px solid #E5E7EB",marginBottom:6,fontSize:13}}><b>{t}</b> <span style={{opacity:.8}}>= {f}</span> <b>= {res}</b></div>
  const caja={background:"#fff",border:"1px solid #E5E7EB",borderRadius:10,padding:"14px 16px",marginBottom:12}
  const h2={fontSize:14,fontWeight:800,color:"#16213E",marginBottom:8}
  const comprar=d&&Number(d.pos)<=Number(d.rop)&&Number(d.dem)>0&&d.estado==="Reposición"
  return <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(15,23,42,.45)",zIndex:400,display:"flex",justifyContent:"flex-end"}}>
    <div onClick={e=>e.stopPropagation()} role="dialog" aria-label="Cómo se calculó" style={{width:"min(900px,100%)",height:"100%",background:"#F7F8FA",overflowY:"auto",boxShadow:"-8px 0 30px rgba(0,0,0,.18)"}}>
      <div style={{position:"sticky",top:0,zIndex:2,background:"linear-gradient(135deg,#1a1a2e,#16213e)",color:"#fff",padding:"14px 18px",display:"flex",alignItems:"flex-start",gap:12}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,letterSpacing:1,opacity:.7,textTransform:"uppercase"}}>Cómo se calculó</div>
          <div style={{fontSize:16,fontWeight:800,marginTop:2}}>{r.producto}</div>
          <div style={{fontSize:12,opacity:.8,marginTop:2}}>{r.sku} · {d?.tipo||r.tipo_producto} · clase {d?.clase||r.clasif_abcd} · {d?.proveedor?`proveedor ${d.proveedor}`:"sin proveedor asociado"}</div></div>
        <button onClick={onClose} aria-label="Cerrar" style={{background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.3)",color:"#fff",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontWeight:700}}>Cerrar ✕</button>
      </div>
      {!d?<div style={{padding:24,color:"#6E6E73"}}>Cargando el detalle del cálculo…</div>:<div style={{padding:16}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginBottom:12}}>
          {[["Venta prom./día",lcN(d.dem,2)+" u"],["Lead time",`${d.lt} días`],["Seguridad",`${d.ss_dias} días`],["Cobertura",`${d.cob_dias} días`],["Punto de reorden",lcN(d.rop,0)+" u"],["Stock objetivo",lcN(d.maxi,0)+" u"],["Comprar",comprar?lcN(d.repo,0)+" u":"No por ahora"]].map(([l,v])=><div key={l} style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:8,padding:"8px 10px"}}><div style={{fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>{l}</div><div style={{fontSize:15,fontWeight:800,color:l==="Comprar"&&comprar?"#B42318":"#1C1C1E"}}>{v}</div></div>)}
        </div>
        <div style={caja}>
          <div style={h2}>1. Venta de los últimos 12 meses (con kits repartidos en unidades)</div>
          <div style={{fontSize:12,color:"#6E6E73",marginBottom:8}}>Mediana del producto: {lcN(meses[0]?.med,2)} u/día. Reglas: un mes con más de {lcN(d.reglas?.atipico,1)} veces la mediana es atípico; con stock menos del {Math.round((d.reglas?.disp_min||0.5)*100)}% de los días es quiebre y no entra; con stock entre ese porcentaje y 95% se compensa (venta ÷ % de días con stock); sin foto de stock (antes de junio 2026), una venta bajo el {Math.round((d.reglas?.bajo||0.3)*100)}% de la mediana es probable quiebre.</div>
          {meses.length===0?<div style={{fontSize:13,color:"#6E6E73"}}>Sin ventas en los últimos 12 meses.</div>:
          <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
            <thead><tr style={{color:"#6E6E73",textAlign:"right",fontSize:11.5}}><th style={{textAlign:"left",padding:"5px 6px"}}>Mes</th><th style={{textAlign:"left",width:"34%"}}>Unidades</th><th>Días con stock</th><th>Venta/día</th><th style={{textAlign:"left",paddingLeft:10}}>Tratamiento</th><th>Usado (u/día)</th></tr></thead>
            <tbody>{meses.map(m=>{const f=LC_FLAG[m.flag]||LC_FLAG.normal;const pt=d.por_tienda?.[m.m];return <tr key={m.m} style={{borderTop:"1px solid #F1F2F4"}}>
              <td style={{padding:"5px 6px",fontWeight:600}}>{lcMes(m.m)}</td>
              <td title={pt?Object.entries(pt).map(([k,v])=>`${k}: ${v}`).join(" · "):""}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{height:12,borderRadius:3,background:f.usa?f.c:"#D1D5DB",width:`${Math.max(2,(Number(m.u)||0)/maxU*100)}%`,opacity:f.usa?.85:1}}/><span style={{whiteSpace:"nowrap"}}>{lcN(m.u,0)}</span></div></td>
              <td style={{textAlign:"right"}}>{m.disp==null?<span style={{color:"#9CA3AF"}}>sin foto</span>:`${Math.round(Number(m.disp)*100)}%`}</td>
              <td style={{textAlign:"right"}}>{lcN(m.tasa,2)}</td>
              <td style={{paddingLeft:10}}><span style={{fontSize:11.5,fontWeight:700,color:f.c,background:f.bg,borderRadius:5,padding:"1px 7px"}}>{f.l}</span></td>
              <td style={{textAlign:"right",fontWeight:700,color:f.usa?"#1C1C1E":"#9CA3AF"}}>{f.usa?lcN(tasaUsada(m),2):"no entra"}</td>
            </tr>})}</tbody></table></div>}
        </div>
        <div style={caja}>
          <div style={h2}>2. Venta promedio diaria</div>
          {fila(`Promedio de los ${usados.length} meses que entran`,`${lcN(d.base,2)} u/día`,usados.length<meses.length?`${meses.length-usados.length} mes(es) no entran: ${meses.filter(m=>!LC_FLAG[m.flag]?.usa).map(m=>`${lcMes(m.m)} (${(LC_FLAG[m.flag]||{}).l})`).join(", ")}`:"Todos los meses entran al promedio")}
          {fila(`Estimación de la categoría ${d.tipo}`,`${Number(d.ajuste_pct)>0?"+":""}${lcN(d.ajuste_pct,1)}%`,"Se define en Configuración › Política de compra")}
          {fila("Venta promedio diaria usada",`${lcN(d.base,2)} × (1 ${Number(d.ajuste_pct)<0?"−":"+"} ${lcN(Math.abs(Number(d.ajuste_pct)||0),1)}%) = ${lcN(d.dem,2)} u/día`)}
        </div>
        <div style={caja}>
          <div style={h2}>3. Parámetros</div>
          {fila("Lead time (fabricación + despacho)",`${d.lt} días`,d.lt_fuente)}
          {fila(`Seguridad de la clase ${d.clase}`,`${d.ss_dias} días`)}
          {fila(`Cobertura de la categoría ${d.tipo}`,`${d.cob_dias} días`)}
        </div>
        <div style={caja}>
          <div style={h2}>4. Resultado</div>
          {ec("Stock de seguridad",`${lcN(d.dem,2)} × ${d.ss_dias}`,`${lcN(d.ss_u,0)} u`)}
          {ec("Punto de reorden",`${lcN(d.dem,2)} × (${d.lt} + ${d.ss_dias})`,`${lcN(d.rop,0)} u`)}
          {ec("Stock objetivo",`${lcN(d.dem,2)} × (${d.lt} + ${d.ss_dias} + ${d.cob_dias})`,`${lcN(d.maxi,0)} u`)}
          {ec("Posición",`stock ${lcN(d.stock,0)} + tránsito ${lcN(d.transito,0)}`,`${lcN(d.pos,0)} u`)}
          {d.estado!=="Reposición"&&d.estado!=="Stock suficiente"?<div style={{fontSize:13,color:"#B25E09",fontWeight:600}}>Estado: {d.estado}. No entra a la compra sugerida.</div>
          :comprar?ec("Comprar",`${lcN(d.maxi,0)} − ${lcN(d.pos,0)}`,`${lcN(d.repo,0)} u`,true)
          :<div style={{padding:"8px 12px",borderRadius:8,background:"#ECFDF3",color:"#1E7A44",fontWeight:600,fontSize:13}}>No comprar todavía: la posición ({lcN(d.pos,0)} u) está sobre el punto de reorden ({lcN(d.rop,0)} u).{v2.fecha_pedido?` Fecha sugerida de pedido: ${v2.fecha_pedido}.`:""}</div>}
          {Number(d.dem)>0&&<div style={{fontSize:12.5,color:"#3A3A3C",marginTop:8}}>Días de stock = {lcN(d.stock,0)} ÷ {lcN(d.dem,2)} = <b>{lcN(Number(d.stock)/Number(d.dem),0)} días</b>{v2.fecha_quiebre?` · quiebre estimado el ${v2.fecha_quiebre}`:""}.</div>}
        </div>
      </div>}
    </div>
  </div>
}
/* 19-oct-2026: venta de los últimos 12 meses en el Monitor (total o por categoría) */
function Venta12Meses({filas=[]}){
  const[tipo,setTipo]=useState("T")
  const meses=useMemo(()=>{const h=new Date();const ks=[];for(let k=12;k>=0;k--){const d=new Date(h.getFullYear(),h.getMonth()-k,1);ks.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`)}return ks},[])
  const tipos=useMemo(()=>[...new Set(filas.map(r=>r.tipo_producto).filter(Boolean))].sort(),[filas])
  const tot=useMemo(()=>meses.map(k=>filas.reduce((a,r)=>a+((tipo==="T"||r.tipo_producto===tipo)?Number(r.ventas_mes?.[k])||0:0),0)),[filas,tipo,meses])
  if(!filas.length)return null
  const max=Math.max(1,...tot),prom12=tot.slice(0,12).reduce((a,b)=>a+b,0)/12,ult3=(tot[9]+tot[10]+tot[11])/3,dif=prom12?((ult3-prom12)/prom12*100):0
  return <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:8,padding:"12px 14px",marginBottom:12}}>
    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:10}}>
      <div style={{fontSize:13.5,fontWeight:700,color:"#16213E"}}>Venta de los últimos 12 meses</div>
      <span style={{fontSize:12,color:"#6E6E73"}}>unidades, con kits repartidos · promedio {fN(Math.round(prom12))}/mes · últimos 3 meses {fN(Math.round(ult3))}/mes <b style={{color:Math.abs(dif)<10?"#6E6E73":dif>0?"#1E7A44":"#B42318"}}>({dif>0?"+":""}{Math.round(dif)}%)</b></span>
      <select value={tipo} onChange={e=>setTipo(e.target.value)} style={{...css.select,marginLeft:"auto",width:240,padding:"4px 8px",fontSize:12.5}}><option value="T">Todas las categorías</option>{tipos.map(t=><option key={t} value={t}>{t}</option>)}</select>
    </div>
    <div style={{display:"flex",alignItems:"flex-end",gap:6,height:170,padding:"0 2px"}}>
      {tot.map((v,i)=>{const act=i===12;return <div key={meses[i]} title={`${lcMes(meses[i])}: ${fN(Math.round(v))} u${act?" (mes en curso)":""}`} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",height:"100%",minWidth:0}}>
        <div style={{fontSize:10.5,color:"#3A3A3C",marginBottom:3,whiteSpace:"nowrap"}}>{v>=1000?`${Math.round(v/100)/10}k`:Math.round(v)}</div>
        <div style={{width:"100%",maxWidth:46,height:`${Math.max(2,v/max*130)}px`,borderRadius:"4px 4px 0 0",background:act?"repeating-linear-gradient(45deg,#9FB3D9 0 6px,#C7D3EA 6px 12px)":"#16213E",opacity:act?1:.88}}/>
        <div style={{fontSize:11,color:act?"#B25E09":"#6E6E73",marginTop:4,whiteSpace:"nowrap"}}>{lcMes(meses[i])}{act?" ·":""}</div>
      </div>})}
    </div>
  </div>
}

/* 19-oct-2026: detalle de una línea de Reposición: venta por sucursal (12 meses), stock y tránsito por tienda,
   OC pendientes de recepción con acceso a la ficha, y el cálculo cuando se pide para una sola sucursal */
function DetalleLineaSucursal({it,ambito="T",sucursales=[],ocs=[],setDet,onLeyenda}){
  const r=it._v2||{}
  const[ocsTr,setOcsTr]=useState(null)
  useEffect(()=>{let vivo=true;(async()=>{const{data}=await supabase.from('v_cmp_transito_detalle').select('oc_id,estado,proveedor,destino,destino_sucursal_id,fecha_estimada,pedida,recibida,pendiente,dias_para_eta').eq('sku',it.sku).order('fecha_estimada');if(vivo)setOcsTr((data||[]).filter(x=>Number(x.pendiente)>0))})();return()=>{vivo=false}},[it.sku])
  const nom=id=>sucursales.find(s=>s.id===id)?.nombre||id
  const meses=useMemo(()=>{const h=new Date();const ks=[];for(let k=12;k>=0;k--){const d=new Date(h.getFullYear(),h.getMonth()-k,1);ks.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`)}return ks},[])
  const vt=r.ventas_tienda||{},dt=r.dem_tienda||{},stt=r.stock_tienda||{},trt=r.transito_tienda||{}
  const tot12=s=>meses.slice(0,12).reduce((a,k)=>a+(Number(vt[s]?.[k])||0),0)
  const sucs=[...new Set([...Object.keys(vt),...Object.keys(stt).filter(k=>Number(stt[k])>0),...Object.keys(trt)])].sort((a,b)=>tot12(b)-tot12(a))
  const total=sucs.reduce((a,s)=>a+tot12(s),0)
  const n1=v=>v==null||isNaN(Number(v))?"—":Number(v).toLocaleString("es-CL",{maximumFractionDigits:1})
  const abrir=id=>{const oc=ocs.find(o=>o.id===id);if(oc&&setDet)setDet(oc);else alert(`No encontré la OC ${id} en la lista cargada; búscala en Órdenes.`)}
  const th={padding:"5px 6px",fontSize:11,color:"#6E6E73",fontWeight:700,textAlign:"right",whiteSpace:"nowrap"}
  const t=it._tienda
  return <div onClick={e=>e.stopPropagation()} style={{padding:"12px 16px",cursor:"default",position:"sticky",left:0,maxWidth:"calc(100vw - 64px)",boxSizing:"border-box"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:8}}>
      <div style={{fontSize:13.5,fontWeight:800,color:"#16213E"}}>Distribución por sucursal · {it.producto} <span style={{fontWeight:500,color:"#6E6E73",fontSize:12}}>· {it.sku}</span></div>
      {onLeyenda&&<Bt sm v="gry" onClick={onLeyenda}>ⓘ Ver cálculo de la empresa</Bt>}
    </div>
    {sucs.length===0?<div style={{fontSize:12.5,color:"#6E6E73"}}>Sin venta ni stock por sucursal en los últimos 12 meses.</div>:
    <div style={{overflowX:"auto",background:"#fff",border:"1px solid #E5E7EB",borderRadius:8}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
      <thead><tr style={{borderBottom:"1px solid #E5E7EB"}}><th style={{...th,textAlign:"left"}}>Sucursal</th>{meses.map((k,i)=><th key={k} style={{...th,color:i===12?"#B25E09":"#6E6E73"}}>{lcMes(k)}{i===12?" ◐":""}</th>)}<th style={th}>Total 12 m</th><th style={th}>Participación</th><th style={th}>Venta/día</th><th style={th}>Stock hoy</th><th style={th}>Tránsito con destino</th></tr></thead>
      <tbody>{sucs.map(s=>{const t12=tot12(s);const pct=total>0?t12/total*100:0;return <tr key={s} style={{borderTop:"1px solid #F3F4F6",background:s===ambito?"#EEF4FB":"transparent"}}>
        <td style={{padding:"5px 6px",fontWeight:700,whiteSpace:"nowrap"}}>{nom(s)}</td>
        {meses.map((k,i)=>{const v=Number(vt[s]?.[k])||0;return <td key={k} style={{padding:"5px 6px",textAlign:"right",color:v?(v<0?"#B42318":i===12?"#B25E09":"#1C1C1E"):"#D1D1D6",fontStyle:i===12?"italic":"normal"}}>{fN(v)}</td>})}
        <td style={{padding:"5px 6px",textAlign:"right",fontWeight:700}}>{fN(t12)}</td>
        <td style={{padding:"5px 6px",textAlign:"right",minWidth:110}}><div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6}}><div style={{width:50,height:7,background:"#EEF1F7",borderRadius:4,overflow:"hidden"}}><div style={{width:`${Math.max(0,Math.min(100,pct))}%`,height:"100%",background:"#16213E"}}/></div><span style={{fontWeight:700}}>{Math.round(pct)}%</span></div></td>
        <td style={{padding:"5px 6px",textAlign:"right"}}>{n1(dt[s])}</td>
        <td style={{padding:"5px 6px",textAlign:"right",fontWeight:600,color:Number(stt[s])>0?"#1C1C1E":"#B42318"}}>{fN(Number(stt[s])||0)}</td>
        <td style={{padding:"5px 6px",textAlign:"right",color:Number(trt[s])>0?"#1D4E89":"#D1D1D6",fontWeight:Number(trt[s])>0?700:400}}>{Number(trt[s])>0?fN(trt[s]):"—"}</td>
      </tr>})}
      <tr style={{borderTop:"2px solid #E5E7EB",background:"#F8FAFC",fontWeight:700}}><td style={{padding:"5px 6px"}}>Total</td>{meses.map(k=><td key={k} style={{padding:"5px 6px",textAlign:"right"}}>{fN(sucs.reduce((a,s)=>a+(Number(vt[s]?.[k])||0),0))}</td>)}<td style={{padding:"5px 6px",textAlign:"right"}}>{fN(total)}</td><td style={{padding:"5px 6px",textAlign:"right"}}>100%</td><td style={{padding:"5px 6px",textAlign:"right",color:"#6E6E73",fontWeight:500}} title="La venta diaria de la empresa usada en la compra está en ⓘ (serie consolidada)">empresa: {n1(r.demanda_dia)}</td><td style={{padding:"5px 6px",textAlign:"right"}}>{fN(sucs.reduce((a,s)=>a+(Number(stt[s])||0),0))}</td><td style={{padding:"5px 6px",textAlign:"right"}}>{fN(sucs.reduce((a,s)=>a+(Number(trt[s])||0),0))}</td></tr>
      </tbody></table></div>}
    <div style={{marginTop:12}}>
      <div style={{fontSize:13,fontWeight:800,color:"#16213E",marginBottom:6}}>Órdenes en tránsito <span style={{fontWeight:500,color:"#6E6E73",fontSize:12}}>· pendientes de recepción; revisa la OC para confirmar lo que llegó</span></div>
      {ocsTr===null?<div style={{fontSize:12.5,color:"#6E6E73"}}>Cargando…</div>:ocsTr.length===0?<div style={{fontSize:12.5,color:"#6E6E73"}}>No hay OC pendientes de recepción para este producto.</div>:
      <div style={{overflowX:"auto",background:"#fff",border:"1px solid #E5E7EB",borderRadius:8}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
        <thead><tr style={{borderBottom:"1px solid #E5E7EB"}}><th style={{...th,textAlign:"left"}}>OC</th><th style={{...th,textAlign:"left"}}>Estado</th><th style={{...th,textAlign:"left"}}>Proveedor</th><th style={{...th,textAlign:"left"}}>Destino</th><th style={th}>Pedido</th><th style={th}>Recibido</th><th style={th}>Pendiente</th><th style={th}>Llegada estimada</th><th style={th}></th></tr></thead>
        <tbody>{ocsTr.map(x=>{const atr=Number(x.dias_para_eta)<0;return <tr key={x.oc_id} style={{borderTop:"1px solid #F3F4F6"}}>
          <td style={{padding:"5px 6px",fontWeight:700,fontFamily:"monospace"}}>{x.oc_id}</td>
          <td style={{padding:"5px 6px"}}><span style={{fontSize:11.5,fontWeight:700,color:STS[x.estado]?.c||"#3A3A3C",background:STS[x.estado]?.bg||"#F4F5F7",borderRadius:5,padding:"1px 7px"}}>{x.estado}</span></td>
          <td style={{padding:"5px 6px"}}>{x.proveedor||"—"}</td><td style={{padding:"5px 6px"}}>{x.destino||nom(x.destino_sucursal_id)||"—"}</td>
          <td style={{padding:"5px 6px",textAlign:"right"}}>{fN(x.pedida)}</td><td style={{padding:"5px 6px",textAlign:"right"}}>{fN(x.recibida)}</td>
          <td style={{padding:"5px 6px",textAlign:"right",fontWeight:800,color:"#1D4E89"}}>{fN(x.pendiente)}</td>
          <td style={{padding:"5px 6px",textAlign:"right",whiteSpace:"nowrap",color:atr?"#B42318":"#3A3A3C",fontWeight:atr?700:400}}>{x.fecha_estimada||"—"}{atr?` · atrasada ${Math.abs(Number(x.dias_para_eta))} días`:""}</td>
          <td style={{padding:"5px 6px",textAlign:"right"}}><Bt sm v="pri" onClick={()=>abrir(x.oc_id)}>Revisar OC</Bt></td>
        </tr>})}</tbody></table></div>}
    </div>
    {ambito!=="T"&&t&&<div style={{marginTop:12,background:"#fff",border:"1px solid #C7D3EA",borderLeft:"4px solid #1D4E89",borderRadius:8,padding:"10px 14px",fontSize:12.5,lineHeight:1.7}}>
      <div style={{fontSize:13,fontWeight:800,color:"#16213E"}}>Pedido exclusivo para {nom(ambito)}</div>
      <div>Venta diaria de la tienda = promedio de sus meses válidos {n1(dt[ambito])} × (1 {t.aj<1?"−":"+"} {n1(Math.abs((t.aj-1)*100))}% estimación) = <b>{n1(t.d)} u/día</b></div>
      <div>Punto de reorden = {n1(t.d)} × (lead time {t.lt} + seguridad {t.ss}) = <b>{fN(Math.round(t.rop))} u</b></div>
      <div>Stock objetivo = {n1(t.d)} × ({t.lt} + {t.ss} + cobertura {t.cob}) = <b>{fN(Math.round(t.mx))} u</b></div>
      <div>Posición = stock de la tienda {fN(t.st)} + tránsito con destino {fN(t.tr)} = <b>{fN(t.pos)} u</b></div>
      {t.cd>0&&<div style={{color:"#B25E09",fontWeight:700}}>El CD tiene {fN(t.cd)} u{t.rep>0?`: si se trasladan ${fN(t.tras)} u a ${nom(ambito)}, la compra exclusiva baja a ${fN(t.neta)} u`:""}.</div>}
      <div style={{fontWeight:800,color:t.rep>0?"#B42318":"#1E7A44"}}>{t.rep>0?`Comprar para ${nom(ambito)} = ${fN(Math.round(t.mx))} − ${fN(t.pos)} = ${fN(t.rep)} u`:`No comprar todavía para ${nom(ambito)}: la posición está sobre el punto de reorden.`}</div>
    </div>}
  </div>
}

function RepoView({prods,prodsSuc=[],cart,setCart,go,config,params,paramsABCD,sucursales=[],fuenteRepoApp,setFuenteRepoApp,v2App,ocs=[],setDet}){
  const[q,setQ]=useLocalState("repo_q","")
  // ⭐ v48: filtros multi-select como arrays. [] significa "todos".
  const[fcArr,setFcArr]=useLocalState("repo_fcArr",[])   // clases ABCD seleccionadas
  const[ftArr,setFtArr]=useLocalState("repo_ftArr",[])   // tipos seleccionados
  const[sortBy,setSortBy]=useLocalState("repo_sortBy","costo_reposicion")
  const[fe,setFe]=useLocalState("repo_fe","T")
  const[sortDir,setSortDir]=useLocalState("repo_sortDir","desc")
  const[vistaRepo,setVistaRepo]=useLocalState("repo_vista","grilla") // 18-oct-2026: grilla tipo Excel por defecto; la vista clásica queda como respaldo
  const[fsuc,setFsuc]=useLocalState("repo_fsuc","T")
  const[leyenda,setLeyenda]=useState(null);const[soloSinProv,setSoloSinProv]=useState(false)
  // 19-oct-2026: una sola vista con la estructura de la clásica + filtros por columna y pantalla completa de la grilla
  const[filaAbierta,setFilaAbierta]=useState(null);const[ambito,setAmbito]=useLocalState("repo_ambito","T") // 19-oct-2026: detalle por sucursal y pedido exclusivo
  const[pantallaRepo,setPantallaRepo]=useState(false);const[verFiltros,setVerFiltros]=useState(false);const[filtrosCol,setFiltrosCol]=useState({})
  useEffect(()=>{if(!pantallaRepo)return;const k=e=>{if(e.key==="Escape")setPantallaRepo(false)};window.addEventListener("keydown",k);return()=>window.removeEventListener("keydown",k)},[pantallaRepo])
  // 17-oct-2026: el filtro por sucursal muestra solo las sucursales con cálculo de reposición (sin CD, Web ni Administración)
  const[sucsParam,setSucsParam]=useState(null)
  useEffect(()=>{(async()=>{const{data}=await supabase.from('cmp_param_sucursal').select('sucursal_id').eq('activo',true);setSucsParam((data||[]).map(r=>r.sucursal_id))})()},[])
  // Fase 3 (17-oct-2026): cálculo v2 desde la base de Inventario (año, venta neta, punto de reorden, lead time por proveedor)
  const fuenteRepo=fuenteRepoApp||"v2";const setFuenteRepo=setFuenteRepoApp||(()=>{})
  const irNuevaOC=()=>{try{if(fuenteRepo==="v2"&&ambito&&ambito!=="T")localStorage.setItem("erp_sol_destino_pre",ambito);else localStorage.removeItem("erp_sol_destino_pre")}catch(e){};go()}
  useEffect(()=>{if(fuenteRepo==="v2"&&fsuc!=="T")setFsuc("T")},[fuenteRepo,fsuc]) // 19-oct-2026: la distribución a sucursales es de Logística
  const[v2RowsLocal,setV2Rows]=useState([]);const v2Rows=(v2App&&v2App.length)?v2App:v2RowsLocal
  const[v2Info,setV2Info]=useState(null)
  useEffect(()=>{if(fuenteRepo!=="v2"||v2Rows.length)return;(async()=>{const{data,error}=await fetchAll(supabase.from('cmp_reposicion_v2').select('*').order('sku'));if(error){alert("No se pudo cargar el cálculo v2: "+error.message);return}setV2Rows(data||[]);setV2Info({n:(data||[]).length,fecha:(data||[])[0]?.calculado_at||null})})()},[fuenteRepo])
  const[v2Suc,setV2Suc]=useState([]);const[v2SucSello,setV2SucSello]=useState(null)
  const v2Sello=v2Rows[0]?.calculado_at||null
  useEffect(()=>{if(fuenteRepo!=="v2"||fsuc==="T"||(v2Suc.length&&v2SucSello===v2Sello))return;(async()=>{const{data,error}=await fetchAll(supabase.from('cmp_reposicion_v2_suc').select('*').order('sku'));if(error){alert("No se pudo cargar el cálculo por sucursal: "+error.message);return}setV2Suc(data||[]);setV2SucSello(v2Sello)})()},[fuenteRepo,fsuc,v2Sello])
  const mesKeys12=useMemo(()=>{const h=new Date();const ks=[];for(let k=12;k>=1;k--){const d=new Date(h.getFullYear(),h.getMonth()-k,1);ks.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`)}return ks},[])
  const mesActKey=useMemo(()=>{const h=new Date();return `${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,"0")}`},[])
  const cdId=useMemo(()=>(sucursales||[]).find(x=>x.es_cd)?.id||null,[sucursales]) // 19-oct-2026: stock del CD en el pedido exclusivo
  const prodsV2=useMemo(()=>v2Rows.map(r=>{const vm=r.ventas_mes||{};const o={sku:r.sku,producto:r.producto,tipo_producto:r.tipo_producto,clasif_abcd:r.clasif_abcd,estado:r.estado,stock_actual:Number(r.stock)||0,stock_transito:Number(r.transito)||0,venta_total:Number(r.unid_12m)||0,vta_prom_compensada:Number(r.demanda_mes)||0,vta_prom_diaria:Number(r.demanda_dia)||0,dias_cobertura:r.dias_cobertura,punto_reorden:Number(r.punto_reorden)||0,reposicion_necesaria:Number(r.reposicion)||0,costo_unitario:Number(r.costo_unitario)||0,costo_reposicion:Number(r.inversion)||0,dias_fabricacion:r.lead_time_dias,dias_emergencia:r.dias_emergencia,periodo_cubrir:r.periodo_cubrir,meses_quiebre:r.pct_disponible!=null?Math.round(100-Number(r.pct_disponible)):0,venta_mes_actual:Number(vm[mesActKey])||0,desv:(Number(r.meses_excluidos)||0)+(Number(r.meses_compensados)||0),stock_obj:Number(r.nivel_maximo)||0,proveedor:r.proveedor_nombre||"",urgencia:r.urgencia||"",_v2:r};mesKeys12.forEach((k,i)=>{o[`venta_mes_${i+1}`]=Number(vm[k])||0})
    if(ambito!=="T"){const cd=cdId&&cdId!==ambito?Math.max(0,Number((r.stock_tienda||{})[cdId])||0):0;const vt=(r.ventas_tienda||{})[ambito]||{};const aj=1+(Number(r.ajuste_pct)||0)/100;const d=(Number((r.dem_tienda||{})[ambito])||0)*aj;const st=Math.max(0,Number((r.stock_tienda||{})[ambito])||0);const tr=Number((r.transito_tienda||{})[ambito])||0;const lt=Number(r.lead_time_dias)||0,ss=Number(r.dias_emergencia)||0,cob=Number(r.periodo_cubrir)||0;const rop=d*(lt+ss),mx=d*(lt+ss+cob),pos=st+tr;const excl=["Inactivo","Servicio","Kit por definir","Sin venta reciente","Sin ventas"].includes(r.estado);const rep=!excl&&d>0&&pos<=rop?Math.ceil(mx-pos):0
      mesKeys12.forEach((k,i)=>{o[`venta_mes_${i+1}`]=Number(vt[k])||0});o.venta_mes_actual=Number(vt[mesActKey])||0;o.venta_total=mesKeys12.reduce((a,k)=>a+(Number(vt[k])||0),0)+o.venta_mes_actual
      Object.assign(o,{vta_prom_diaria:d,vta_prom_compensada:d*30,stock_actual:st,stock_transito:tr,dias_cobertura:d>0?st/d:null,punto_reorden:Math.round(rop*10)/10,stock_obj:Math.round(mx*10)/10,reposicion_necesaria:rep,costo_reposicion:rep*(Number(r.costo_unitario)||0),estado:excl?r.estado:(rep>0?"Reposición":(d>0||st>0?"Stock suficiente":"Sin ventas")),urgencia:excl?"":(rep>0?"Pedir hoy":""),desv:0,stock_cd:cd,_tienda:{d,st,tr,rop,mx,pos,rep,lt,ss,cob,aj,cd,tras:Math.min(rep,cd),neta:rep-Math.min(rep,cd)}})}
    return o}),[ambito,cdId,v2Rows,mesKeys12,mesActKey])
  const[showTipos,setShowTipos]=useState(false) // dropdown multi-select tipos
  // ⭐ Modal ajustar parámetros por tipo
  const[showParams,setShowParams]=useState(false)
  const[paramTipo,setParamTipo]=useState("")
  const[paramFab,setParamFab]=useState(21)
  const[paramCob,setParamCob]=useState(90)
  const[paramSaving,setParamSaving]=useState(false)
  const[paramPreview,setParamPreview]=useState(null) // {antes, despues, skus[]}
  const abrirParams=(tipo)=>{
    const tp=(params||[]).find(p=>p.tipo_producto===tipo)||{dias_fabricacion:30,periodo_cobertura:90}
    setParamTipo(tipo||"")
    setParamFab(tp.dias_fabricacion||30)
    setParamCob(tp.periodo_cobertura||90)
    setParamPreview(null)
    setShowParams(true)
  }
  const calcPreview=(fab,cob)=>{
    if(!paramTipo)return
    const abcd=(abcdp,clasif)=>(paramsABCD||[]).find(a=>a.clasificacion===clasif)||{dias_emergencia:5}
    const afectados=prods.filter(p=>p.tipo_producto===paramTipo&&(p.vta_prom_diaria||0)>0)
    const preview=afectados.map(p=>{
      const emerg=abcd(paramsABCD,p.clasif_abcd).dias_emergencia||5
      const ptoRe=Math.round(p.vta_prom_diaria*(fab+emerg))
      const posicion=(p.stock_actual||0)+(p.stock_transito||0);const repo=posicion<=ptoRe?Math.max(0,Math.round((p.vta_prom_diaria*cob)+ptoRe-posicion)):0
      return{...p,nuevo_repo:repo,nuevo_pto:ptoRe,delta:repo-(p.reposicion_necesaria||0)}
    })
    const antesUnid=afectados.reduce((s,p)=>s+(p.reposicion_necesaria||0),0)
    const despuesUnid=preview.reduce((s,p)=>s+p.nuevo_repo,0)
    const antesCLP=afectados.reduce((s,p)=>s+((p.reposicion_necesaria||0)*(p.costo_unitario||0)),0)
    const despuesCLP=preview.reduce((s,p)=>s+(p.nuevo_repo*(p.costo_unitario||0)),0)
    const top5=preview.filter(p=>Math.abs(p.delta)>0).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,5)
    setParamPreview({antesUnid,despuesUnid,antesCLP,despuesCLP,top5,total:afectados.length})
  }
  const aplicarParams=async()=>{
    if(!paramTipo||paramSaving)return
    setParamSaving(true)
    try{
      await supabase.from('parametros_tipo').update({dias_fabricacion:paramFab,periodo_cobertura:paramCob}).eq('tipo_producto',paramTipo)
      const afectados=prods.filter(p=>p.tipo_producto===paramTipo&&(p.vta_prom_diaria||0)>0)
      for(const p of afectados){
        const emerg=(paramsABCD||[]).find(a=>a.clasificacion===p.clasif_abcd)?.dias_emergencia||5
        const ptoRe=Math.round(p.vta_prom_diaria*(paramFab+emerg))
        const posicion=(p.stock_actual||0)+(p.stock_transito||0);const repo=posicion<=ptoRe?Math.max(0,Math.round((p.vta_prom_diaria*paramCob)+ptoRe-posicion)):0
        await supabase.from('productos').update({dias_fabricacion:paramFab,periodo_cubrir:paramCob,punto_reorden:ptoRe,reposicion_necesaria:repo,estado:repo>0?"Reposición":"Stock suficiente"}).eq('sku',p.sku)
      }
      setShowParams(false);setParamPreview(null)
      alert("✓ Parámetros aplicados. Recarga la página para ver los cambios reflejados.")
    }catch(e){alert("Error: "+e.message)}
    setParamSaving(false)
  }
  const tipos=[...new Set(prods.map(p=>p.tipo_producto).filter(Boolean))].sort()
  const exportarExcel=()=>{
    try{
      const filas=fil.map(i=>{const v=i._v2||{};const vs=i._v2s||{};return{"SKU":i.sku,"Producto":i.producto,"Tipo":i.tipo_producto,"ABCD":i.clasif_abcd,"Estado":i.estado,"Sucursal":vs.sucursal_id||(fsuc==="T"?"Consolidado":fsuc),"Modalidad":vs.modalidad||"","Stock":i.stock_actual,"Tránsito / stock CD":i.stock_transito,"Venta 12m (u)":i.venta_total,"Venta año en curso (u)":v.unid_ytd??"","Venta neta 12m ($)":v.neto_12m??"","Demanda mensual":i.vta_prom_compensada,"Punto de reorden":i.punto_reorden,"Reponer":i.reposicion_necesaria,"Costo unitario":i.costo_unitario,"Inversión":i.costo_reposicion,"Lead time (días)":i.dias_fabricacion,"Fuente lead time":v.lead_time_fuente||"","Fuente costo":v.costo_fuente||"","% días con stock":v.pct_disponible??vs.pct_disponible??"","Proveedor":v.proveedor_nombre||"","Origen":v.origen||"","Tasa larga (u/día)":v.tasa_larga??vs.tasa_larga??"","Tasa reciente (u/día)":v.tasa_corta??vs.tasa_corta??"","Peso venta reciente":v.peso_reciente??vs.peso_reciente??"","Calculado":String(v.calculado_at||vs.calculado_at||"").slice(0,16)}})
      const ws=XLSX.utils.json_to_sheet(filas);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Reposición")
      XLSX.writeFile(wb,`reposicion_${fuenteRepo}_${fsuc==="T"?"consolidado":fsuc}_${hoy()}.xlsx`)
    }catch(e){alert("No se pudo exportar: "+e.message)}
  }
  useEffect(()=>{if(fuenteRepo==="v2"&&sucsParam&&fsuc!=="T"&&!sucsParam.includes(fsuc))setFsuc("T")},[sucsParam,fuenteRepo])
  const estados=fuenteRepo==="v2"?(fsuc!=="T"?["Comprar directo a sucursal","Trasladar desde CD","Traslado parcial (falta en CD)","Sin stock en CD","OK"]:["Reposición","Stock suficiente","Sin ventas","Sin venta reciente","Kit por definir","Servicio","Inactivo"]):["Reposición","Stock suficiente","Sin ventas","Revisar"]
  const toggleSort=(col)=>{if(sortBy===col){setSortDir(d=>d==="desc"?"asc":"desc")}else{setSortBy(col);setSortDir(col==="dias_cobertura"?"asc":"desc")}}
  // ⭐ v48: filtros multi: array vacío = "todos"
  // ⭐ Si hay sucursal seleccionada y hay datos por sucursal, usarlos
  // Además recalcula reposicion_necesaria en tiempo real según params actuales
  const prodsActivos=useMemo(()=>{
    if(fuenteRepo==="v2")return fsuc==="T"?prodsV2:v2Suc.filter(r=>r.sucursal_id===fsuc).map(v2SucAProd) // v2: cálculo completo desde la base; por sucursal = traslado sugerido desde CD
    const base=(fsuc==="T"||!prodsSuc.length)?prods:(()=>{
      const suc=prodsSuc.filter(p=>p.sucursal===fsuc||p.sucursal_id===fsuc)
      if(!suc.length)return prods
      return suc.map(ps=>({...prods.find(p=>p.sku===ps.sku)||{},
        ...ps,stock_actual:ps.stock_actual,
        venta_mes_1:ps.venta_mes_1,venta_mes_2:ps.venta_mes_2,
        venta_mes_3:ps.venta_mes_3,venta_mes_4:ps.venta_mes_4,
        venta_mes_5:ps.venta_mes_5,venta_mes_6:ps.venta_mes_6,
        venta_mes_actual:ps.venta_mes_actual,
        venta_total:ps.venta_total,vta_prom_diaria:ps.vta_prom_diaria,
        vta_prom_compensada:ps.vta_prom_compensada,
        dias_cobertura:ps.dias_cobertura,punto_reorden:ps.punto_reorden,
        reposicion_necesaria:ps.reposicion_necesaria,
        costo_reposicion:ps.costo_reposicion,estado:ps.estado,
        meses_quiebre:ps.meses_quiebre,stock_transito:0
      }))
    })()
    // Recalcular con params actuales (tiempo real al cambiar Config)
    if(!params?.length)return base
    return base.map(p=>{
      const tp=(params||[]).find(t=>t.tipo_producto===p.tipo_producto)
      const abcd=(paramsABCD||[]).find(a=>a.clasificacion===p.clasif_abcd)
      if(!tp||!p.vta_prom_diaria)return p
      const fab=tp.dias_fabricacion||p.dias_fabricacion||30
      const emerg=abcd?.dias_emergencia||p.dias_emergencia||5
      const cob=tp.periodo_cobertura||p.periodo_cubrir||90
      const ptoRe=Math.round(p.vta_prom_diaria*(fab+emerg))
      // Fase 0 (decisión JP): se repone al cruzar el punto de reorden; el nivel máximo define cuánto pedir
      const posicion=(p.stock_actual||0)+(p.stock_transito||0)
      const repo=posicion<=ptoRe?Math.max(0,Math.round((p.vta_prom_diaria*cob)+ptoRe-posicion)):0
      const estado=p.venta_total===0&&p.stock_actual===0?"Revisar":p.venta_total===0?"Sin ventas":repo>0?"Reposición":"Stock suficiente"
      return{...p,dias_fabricacion:fab,dias_emergencia:emerg,periodo_cubrir:cob,punto_reorden:ptoRe,reposicion_necesaria:repo,costo_reposicion:repo*(p.costo_unitario||0),estado}
    })
  },[prods,prodsSuc,fsuc,params,paramsABCD,fuenteRepo,prodsV2,v2Suc])

  const ocultaInactivo=i=>fuenteRepo==="v2"&&fe==="T"&&!q&&i.estado==="Inactivo" // solo se ocultan inactivos por defecto; al buscar aparecen
  const nInactivosOcultos=prodsActivos.filter(ocultaInactivo).length
  const nSinProv=prodsActivos.filter(i=>i._v2?.sin_proveedor&&(i.estado==="Reposición"||i.estado==="Stock suficiente")).length
  const pasaFiltro=(v,f)=>{const t=String(f||"").trim();if(!t)return true;const m=t.match(/^([<>]=?|=)\s*(-?[\d.,]+)$/);if(m){const n=Number(m[2].replace(/\./g,"").replace(",","."));const x=Number(v)||0;return m[1]===">"?x>n:m[1]===">="?x>=n:m[1]==="<"?x<n:m[1]==="<="?x<=n:x===n}return String(v??"").toLowerCase().includes(t.toLowerCase())}
  const fil=prodsActivos.filter(i=>!ocultaInactivo(i)&&(!soloSinProv||i._v2?.sin_proveedor)&&Object.entries(filtrosCol).every(([k,f])=>pasaFiltro(k==="producto"?`${i.producto} ${i.sku}`:i[k],f))&&
    (fcArr.length===0||fcArr.includes(i.clasif_abcd))
    &&(ftArr.length===0||ftArr.includes(i.tipo_producto))
    &&(fe==="T"||i.estado===fe)
    &&(!q||i.producto?.toLowerCase().includes(q.toLowerCase())||i.sku?.toLowerCase().includes(q.toLowerCase()))
  ).sort((a,b)=>{const av=a[sortBy]||0,bv=b[sortBy]||0;if(sortBy==="producto"||sortBy==="tipo_producto"||typeof av==="string"||typeof bv==="string")return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));return sortDir==="asc"?(av-bv):(bv-av)})
  const toggleAbcd=(k)=>setFcArr(p=>p.includes(k)?p.filter(x=>x!==k):[...p,k])
  const toggleTipo=(t)=>setFtArr(p=>p.includes(t)?p.filter(x=>x!==t):[...p,t])
  const tog=it=>setCart(p=>{const n={...p};if(n[it.sku])delete n[it.sku];else n[it.sku]={...it,cp:it.reposicion_necesaria||0};return n})
  const setQty=(sku,v)=>setCart(p=>({...p,[sku]:{...p[sku],cp:Math.max(0,Number(v))}}))
  const cL=Object.keys(cart).length;const tC=Object.values(cart).reduce((s,i)=>s+((i.cp||0)*(i.costo_unitario||0)),0)
  const resumen={total:prodsActivos.length,repos:prodsActivos.filter(p=>fuenteRepo==="v2"&&fsuc!=="T"?Number(p.reposicion_necesaria)>0:p.estado==="Reposición").length,suf:prodsActivos.filter(p=>fuenteRepo==="v2"&&fsuc!=="T"?p.estado==="OK":p.estado==="Stock suficiente").length,a:prodsActivos.filter(p=>p.clasif_abcd==="A").length,b:prodsActivos.filter(p=>p.clasif_abcd==="B").length,c:prodsActivos.filter(p=>p.clasif_abcd==="C").length,d:prodsActivos.filter(p=>p.clasif_abcd==="D").length}
  const abrevMes=(s)=>{if(!s)return s;const p=String(s).trim().split(/\s+/);const m=(p[0]||"").slice(0,3);const y=p[1]?` ${p[1].slice(-2)}`:"";return m?`${m}${y}`:s}
  const v2m=fuenteRepo==="v2"
  const mNames=fuenteRepo==="v2"?mesKeys12.map(k=>lcMes(k)):[1,2,3,4,5,6].map(k=>abrevMes(config[`mes_${k}_nombre`])||`Mes ${k}`)
  const mesActualLabel=abrevMes(config.mes_actual_nombre)||"En curso"

  const exportCSV=()=>{
    const h=["Tipo","Producto","SKU","Clasif.","Estado",...mNames,`${mesActualLabel} (parcial)`,"Venta Total","Max Mensual","Umbral Quiebre","Meses Quiebre","Vta Prom Raw","Vta Prom Compensada","Factor Comp.","Vta Prom Diaria","Stock Actual","Stock Tránsito","Días Cobertura","Días Fabricación","Días Emergencia","Punto Reorden","Período Cubrir","Reposición Necesaria","Costo Unitario","Costo Reposición"]
    const rows=fil.map(i=>[i.tipo_producto,`"${i.producto}"`,i.sku,i.clasif_abcd,i.estado,i.venta_mes_1||0,i.venta_mes_2||0,i.venta_mes_3||0,i.venta_mes_4||0,i.venta_mes_5||0,i.venta_mes_6||0,i.venta_mes_actual||0,i.venta_total||0,i.max_mensual||0,i.umbral_quiebre||0,i.meses_quiebre||0,Math.round(i.vta_prom_raw||0),Math.round(i.vta_prom_compensada||0),i.factor_compensacion||1,Math.round((i.vta_prom_diaria||0)*100)/100,i.stock_actual||0,i.stock_transito||0,Math.round(i.dias_cobertura||0),i.dias_fabricacion||0,i.dias_emergencia||0,Math.round(i.punto_reorden||0),i.periodo_cubrir||0,i.reposicion_necesaria||0,i.costo_unitario||0,i.costo_reposicion||0])
    const csv="\uFEFF"+[h,...rows].map(r=>r.join(";")).join("\n")
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`reposicion_completa_${hoy()}.csv`;a.click()
  }

  const estColors={"Reposición":{c:"#B42318",bg:"#B4231812"},"Stock suficiente":{c:"#1E7A44",bg:"#1E7A4412"},"Sin ventas":{c:"#6E6E73",bg:"#6E6E7312"},"Revisar":{c:"#B25E09",bg:"#B25E0912"},"Sin venta reciente":{c:"#6E6E73",bg:"#6E6E7312"},"Inactivo":{c:"#AEAEB2",bg:"#AEAEB212"},"Kit por definir":{c:"#5B2C6F",bg:"#5B2C6F12"},"Servicio":{c:"#6E6E73",bg:"#6E6E7312"},"Comprar directo a sucursal":{c:"#B25E09",bg:"#B25E0912"},"Trasladar desde CD":{c:"#1D4ED8",bg:"#1D4ED812"},"Traslado parcial (falta en CD)":{c:"#B25E09",bg:"#B25E0912"},"Sin stock en CD":{c:"#B42318",bg:"#B4231812"},"OK":{c:"#1E7A44",bg:"#1E7A4412"}}
  // 18-oct-2026: columnas de la grilla tipo Excel (ordenar, filtrar por columna, redimensionar, reordenar, exportar y pantalla completa)
  const celdaNum=(v,o={})=>v?<span style={{color:o.c||"#1C1C1E",fontWeight:o.b?600:400}}>{fN(v)}</span>:<span style={{color:"#D1D1D6"}}>0</span>
  const vistaSuc=fuenteRepo==="v2"&&fsuc!=="T"
  const colsGrid=[
    {key:"producto",label:"Producto",width:230,value:r=>r.producto||"",render:r=><span style={{fontWeight:600,color:"#1C1C1E"}}>{r.producto}</span>},
    ...(fuenteRepo==="v2"?[{key:"ver",label:"Cálculo",width:76,align:"center",value:()=>0,render:r=><button onClick={e=>{e.stopPropagation();setLeyenda(r)}} title="Ver cómo se calculó" style={{border:"1px solid #16213E",background:"#fff",color:"#16213E",borderRadius:5,padding:"1px 8px",fontSize:11.5,fontWeight:700,cursor:"pointer"}}>ⓘ Ver</button>}]:[]),
    {key:"sku",label:"SKU",width:120,value:r=>r.sku||"",render:r=><span style={{fontSize:12,color:"#6E6E73"}}>{r.sku}</span>},
    {key:"tipo_producto",label:"Tipo",width:140,value:r=>r.tipo_producto||""},
    {key:"clasif_abcd",label:"ABCD",width:84,align:"center",value:r=>r.clasif_abcd||"",render:r=><span style={{display:"inline-block",padding:"1px 6px",borderRadius:4,fontSize:12,fontWeight:700,color:CL[r.clasif_abcd]?.c,background:CL[r.clasif_abcd]?.bg}}>{r.clasif_abcd}</span>},
    {key:"estado",label:"Estado",width:150,value:r=>r.estado||"",render:r=>{const ec=estColors[r.estado]||estColors["Revisar"];return <span style={{display:"inline-block",padding:"1px 6px",borderRadius:4,fontSize:11,fontWeight:600,color:ec.c,background:ec.bg}}>{r.estado}</span>}},
    ...(fuenteRepo==="v2"?[1,2,3,4,5,6,7,8,9,10,11,12]:[1,2,3,4,5,6]).map(k=>({key:`venta_mes_${k}`,label:mNames[k-1],width:fuenteRepo==="v2"?66:76,align:"right",value:r=>Number(r[`venta_mes_${k}`])||0,render:r=>celdaNum(r[`venta_mes_${k}`])})),
    {key:"venta_mes_actual",label:`${mesActualLabel} (en curso)`,width:104,align:"right",value:r=>Number(r.venta_mes_actual)||0,render:r=>celdaNum(r.venta_mes_actual,{c:"#B25E09"})},
    {key:"venta_total",label:fuenteRepo==="v2"?"Venta 12 meses":"Venta total",width:104,align:"right",value:r=>Number(r.venta_total)||0,render:r=>celdaNum(r.venta_total,{b:true})},
    {key:"meses_quiebre",label:fuenteRepo==="v2"?"% días sin stock":"Meses de quiebre",width:112,align:"right",value:r=>Number(r.meses_quiebre)||0,render:r=>r.meses_quiebre>0?<span style={{color:"#B25E09",fontWeight:700}}>{r.meses_quiebre}</span>:<span style={{color:"#D1D1D6"}}>0</span>},
    {key:"vta_prom_compensada",label:"Demanda / mes",width:106,align:"right",value:r=>Number(r.vta_prom_compensada)||0,render:r=>celdaNum(r.vta_prom_compensada,{c:"#1D4E89",b:true})},
    {key:"vta_prom_diaria",label:"Demanda / día",width:104,align:"right",value:r=>Number(r.vta_prom_diaria)||0,render:r=>r.vta_prom_diaria?Math.round(r.vta_prom_diaria*10)/10:"—"},
    {key:"stock_actual",label:"Stock",width:74,align:"right",value:r=>Number(r.stock_actual)||0,render:r=><span style={{fontWeight:600,color:(r.stock_actual||0)<=0?"#B42318":"#1C1C1E"}}>{fN(r.stock_actual)}</span>},
    {key:"stock_transito",label:vistaSuc?"Stock en CD":"Tránsito",width:80,align:"right",value:r=>Number(r.stock_transito)||0,render:r=>r.stock_transito?<span style={{color:"#1D4E89"}}>{fN(r.stock_transito)}</span>:<span style={{color:"#D1D1D6"}}>—</span>},
    {key:"dias_cobertura",label:"Cobertura (días)",width:112,align:"right",value:r=>r.dias_cobertura==null?99999:Number(r.dias_cobertura),render:r=>{const d=Number(r.dias_cobertura);if(!r.dias_cobertura||d>=999)return "—";const crit=d<15&&["A","B"].includes(r.clasif_abcd);return <span style={{fontWeight:700,color:crit?"#B42318":d<30?"#B25E09":"#1E7A44"}}>{Math.round(d)}</span>}},
    {key:"punto_reorden",label:"Punto de reorden",width:116,align:"right",value:r=>Number(r.punto_reorden)||0,render:r=>r.punto_reorden?fN(r.punto_reorden):"—"},
    {key:"reposicion_necesaria",label:vistaSuc?"Reponer (traslado o compra)":"Reponer",width:120,align:"right",value:r=>cart[r.sku]?Number(cart[r.sku].cp)||0:Number(r.reposicion_necesaria)||0,render:r=>cart[r.sku]?<input type="number" value={cart[r.sku]?.cp||0} onChange={e=>setQty(r.sku,e.target.value)} onClick={e=>e.stopPropagation()} style={{width:72,textAlign:"center",fontSize:12,fontWeight:700,padding:"2px",border:"2px solid #1D4E89",borderRadius:6,color:"#1D4E89"}}/>:(r.reposicion_necesaria?<span style={{fontWeight:700,color:"#B42318"}}>{fN(r.reposicion_necesaria)}</span>:<span style={{color:"#D1D1D6"}}>0</span>)},
    {key:"costo_unitario",label:"Costo unitario",width:110,align:"right",value:r=>Number(r.costo_unitario)||0,render:r=>r.costo_unitario?fmt(r.costo_unitario):"—"},
    {key:"costo_reposicion",label:"Inversión",width:112,align:"right",value:r=>Number(r.costo_reposicion)||0,render:r=>r.costo_reposicion?<span style={{fontWeight:600}}>{fmt(r.costo_reposicion)}</span>:"—"},
    ...(fuenteRepo==="v2"?[
      {key:"desv",label:"Desviaciones",width:132,value:r=>(Number(r._v2?.meses_excluidos)||0)*10+(Number(r._v2?.meses_compensados)||0),render:r=>{const e=Number(r._v2?.meses_excluidos)||0,c=Number(r._v2?.meses_compensados)||0;if(!e&&!c)return <span style={{color:"#D1D1D6"}}>—</span>;return <span style={{fontSize:11.5}} title="Meses que no entran al promedio (quiebre o atípico) y meses compensados por quiebre; detalle en Ver">{e>0&&<span style={{color:"#5B2C6F",fontWeight:700}}>{e} no entra{e>1?"n":""}</span>}{e>0&&c>0&&" · "}{c>0&&<span style={{color:"#1D4E89",fontWeight:700}}>{c} compensado{c>1?"s":""}</span>}</span>}},
      {key:"ajuste",label:"Estimación categoría",width:104,align:"right",value:r=>Number(r._v2?.ajuste_pct)||0,render:r=>{const a=Number(r._v2?.ajuste_pct)||0;return a?<span style={{fontWeight:700,color:a>0?"#1E7A44":"#B42318"}}>{a>0?"+":""}{a}%</span>:<span style={{color:"#9CA3AF"}}>0%</span>}},
      {key:"seg_dias",label:"Seguridad (días)",width:96,align:"right",value:r=>Number(r.dias_emergencia)||0},
      {key:"cob_obj",label:"Cobertura objetivo (días)",width:112,align:"right",value:r=>Number(r.periodo_cubrir)||0},
      {key:"stock_seg",label:"Stock de seguridad",width:104,align:"right",value:r=>Number(r._v2?.stock_seguridad)||0,render:r=>r._v2?.stock_seguridad!=null?fN(r._v2.stock_seguridad):"—"},
      {key:"stock_obj",label:"Stock objetivo",width:100,align:"right",value:r=>Number(r._v2?.nivel_maximo)||0,render:r=>r._v2?.nivel_maximo?fN(r._v2.nivel_maximo):"—"},
      {key:"urgencia",label:"Urgencia",width:130,value:r=>r._v2?.urgencia||"",render:r=>{const u=r._v2?.urgencia;if(!u)return <span style={{color:"#D1D1D6"}}>—</span>;const c=u==="Pedir hoy"?"#B42318":u==="Pedir esta semana"?"#B25E09":u==="Pedir este mes"?"#1D4E89":"#6E6E73";return <span style={{fontSize:11,fontWeight:700,color:c}}>{u}</span>}},
      {key:"fecha_pedido",label:"Fecha de pedido",width:104,value:r=>r._v2?.fecha_pedido||"",render:r=>r._v2?.fecha_pedido||"—"},
      {key:"fecha_quiebre",label:"Fecha de quiebre",width:104,value:r=>r._v2?.fecha_quiebre||"",render:r=>r._v2?.fecha_quiebre||"—"},
      {key:"proveedor",label:"Proveedor",width:170,value:r=>r._v2?.proveedor_nombre||"",render:r=>r._v2?.proveedor_nombre||<span style={{fontSize:11,fontWeight:700,color:"#B42318",background:"#FEF3F2",borderRadius:5,padding:"1px 7px"}}>Sin proveedor</span>},
      {key:"lead_time",label:"Lead time proveedor (días)",width:112,align:"right",value:r=>Number(r.dias_fabricacion)||0,render:r=>r.dias_fabricacion?fN(r.dias_fabricacion):"—"},
      {key:"fuente_lt",label:"Origen del lead time",width:230,value:r=>r._v2?.lead_time_fuente||"",render:r=><span style={{fontSize:12,color:"#6B7280"}}>{r._v2?.lead_time_fuente||"—"}</span>},
    ]:[])
  ]

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
      <div><div style={{fontSize:26,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Análisis de reposición</div><div style={{fontSize:14,color:"#6E6E73"}}>{resumen.total} SKUs · {resumen.repos} requieren reposición{fuenteRepo==="v2"?` · Cálculo v2 (Inventario, 12 meses)${v2Info?.fecha?" · actualizado "+String(v2Info.fecha).slice(0,10):""}`:` · Umbral: ${config.umbral_quiebre_pct||30}%`}</div><div style={{display:"flex",gap:6,marginTop:6,alignItems:"center",flexWrap:"wrap"}}><button onClick={exportarExcel} title="Exporta todas las columnas del cálculo, incluidas fuentes de costo y lead time" style={{padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:700,border:"1px solid #1E7A44",background:"#fff",color:"#1E7A44",cursor:"pointer"}}>Excel detallado</button>{[["v2","Cálculo v2 · Inventario"],["v1","Cálculo anterior · Excel"]].map(([k,l])=><button key={k} onClick={()=>setFuenteRepo(k)} style={{padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:700,border:"1px solid "+(fuenteRepo===k?"#16213E":"#E5E7EB"),background:fuenteRepo===k?"#16213E":"#fff",color:fuenteRepo===k?"#fff":"#3A3A3C",cursor:"pointer"}}>{l}</button>)}{fuenteRepo==="v2"&&<span style={{fontSize:12,color:"#6E6E73"}}>{fuenteRepo==="v2"?"Compra por unidad · Vta Total = unidades 12 meses · Desv. = meses que no entran al promedio (✕) o se compensan por quiebre (↺) · ⓘ = cálculo completo del producto · Pto Re. con lead time del proveedor":"Vta Total = unidades 12 meses · Quieb. = % de días sin stock · Pto Re. con lead time por proveedor · kits sin composición quedan fuera de la compra"}{fsuc!=="T"?" · por sucursal: Reponer = traslado desde CD Maipú, o compra directa en cerraduras y accesorios · Tráns. = stock disponible en CD":" · vista consolidada"}</span>}</div></div>
      <div style={{display:"flex",gap:6}}>{cL>0&&<Bt v="pri" onClick={irNuevaOC} ic="➕">Crear OC ({cL})</Bt>}{vistaRepo!=="grilla"&&<Bt v="gry" onClick={exportCSV} sm ic="📥">Exportar CSV</Bt>}<Bt v="gry" onClick={()=>abrirParams(ftArr.length===1?ftArr[0]:"")} sm ic="⚙️">Parámetros</Bt></div>
    </div>

    {leyenda&&<LeyendaCalculo r={leyenda} onClose={()=>setLeyenda(null)}/>}
    {/* ⭐ Tabs de sucursal */}
    {fuenteRepo!=="v2"&&sucursales.length>0&&<div style={{background:"#fff",borderRadius:12,padding:"4px",marginBottom:10,display:"flex",gap:2,boxShadow:"0 1px 2px rgba(0,0,0,0.03)",border:"1px solid #E5E7EB"}}>
      <button onClick={()=>{setFsuc("T");setFe("T");setFtArr([]);setQ("")}} style={{flex:1,padding:"10px 14px",borderRadius:8,fontSize:12,fontWeight:700,border:"none",cursor:"pointer",background:fsuc==="T"?"#1C1C1E":"transparent",color:fsuc==="T"?"#fff":"#6E6E73",transition:"all 0.2s"}}>
        🏢 Todas las sucursales
      </button>
      {sucursales.filter(s=>s.activo!==false&&(fuenteRepo==="v2"?(sucsParam||["suc-lg","suc-la","suc-maipu"]).includes(s.id):prodsSuc.some(p=>p.sucursal===s.id||p.sucursal_id===s.id))).map(s=>{
        const active=fsuc===s.id
        const color=s.es_cd?"#1D4E89":"#1D4E89"
        return<button key={s.id} onClick={()=>{setFsuc(s.id);setFe("T");setFtArr([]);setQ("")}} style={{flex:1,padding:"10px 14px",borderRadius:8,fontSize:12,fontWeight:700,border:"none",cursor:"pointer",background:active?color:"transparent",color:active?"#fff":"#6E6E73",transition:"all 0.2s",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
          <span>{s.es_cd?"🏭":"🏬"}</span>
          <span>{s.nombre}</span>
        </button>
      })}
    </div>}

    {/* Aviso sucursal específica */}
    {fsuc!=="T"&&(()=>{
      const suc=sucursales.find(s=>s.id===fsuc)
      const tieneDatos=fuenteRepo==="v2"||prodsSuc.some(p=>p.sucursal===fsuc||p.sucursal_id===fsuc)
      const color=tieneDatos?"#1E7A44":"#B25E09"
      const bg=tieneDatos?"#1E7A4408":"#B25E0908"
      const border=tieneDatos?"#1E7A4430":"#B25E0930"
      return<div style={{padding:"10px 14px",background:bg,borderRadius:10,border:`1px solid ${border}`,marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:12,fontWeight:700,color,marginBottom:2}}>
            {tieneDatos?`✅ Vista por sucursal: ${suc?.nombre}`:`⚠️ Sin datos específicos: ${suc?.nombre}`}
          </div>
          <div style={{fontSize:12,color:"#6E6E73",lineHeight:1.4}}>
            {tieneDatos
              ?(fuenteRepo==="v2"?`Cálculo v2 de ${suc?.nombre}: demanda propia desde su apertura. Reponer = traslado desde CD Maipú, o compra directa en cerraduras y accesorios.`:`Mostrando ventas y stock propios de ${suc?.nombre}. Reposición calculada sobre demanda local.`)
              :`Aún no hay datos por sucursal. Ve a Config → BSALE y sube el Excel para ver el análisis específico de ${suc?.nombre}.`}
          </div>
        </div>
        {!tieneDatos&&<div style={{fontSize:11,color:"#B25E09",fontWeight:700,whiteSpace:"nowrap",marginLeft:12}}>Mostrando consolidado</div>}
      </div>
    })()}

    {/* Summary cards */}
    <div style={{display:"flex",gap:6,marginBottom:10,overflowX:"auto"}}>
      {[["Reposición",resumen.repos,"#B42318"],["Stock OK",resumen.suf,"#1E7A44"],["A",resumen.a,"#B42318"],["B",resumen.b,"#1D4E89"],["C",resumen.c,"#1E7A44"],["D",resumen.d,"#6E6E73"]].map(([l,n,c])=><div key={l} style={{background:"#fff",borderRadius:10,padding:"8px 14px",boxShadow:"0 1px 2px rgba(0,0,0,0.04)",textAlign:"center",minWidth:70}}><div style={{fontSize:18,fontWeight:700,color:c}}>{n}</div><div style={{fontSize:11,color:"#6E6E73"}}>{l}</div></div>)}
    </div>

    {/* Filters */}
    <div style={{display:"flex",gap:4,marginBottom:6,overflowX:"auto",alignItems:"center"}}>
      <button onClick={()=>setFcArr([])} style={{padding:"5px 10px",borderRadius:6,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:fcArr.length===0?"#1D4E89":"#F4F5F7",color:fcArr.length===0?"#fff":"#6E6E73"}}>Todos ({resumen.total})</button>
      {[["A",resumen.a],["B",resumen.b],["C",resumen.c],["D",resumen.d]].map(([k,n])=>{
        const sel=fcArr.includes(k)
        return<button key={k} onClick={()=>toggleAbcd(k)} style={{padding:"5px 10px",borderRadius:6,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:sel?(CL[k]?.bg||"#1D4E89"):"#F4F5F7",color:sel?(CL[k]?.c||"#fff"):"#6E6E73",display:"inline-flex",alignItems:"center",gap:4}}>
          <span style={{width:10,height:10,borderRadius:2,background:sel?(CL[k]?.c||"#fff"):"#C7C7CC",display:"inline-block"}}/>
          Clase {k} ({n})
        </button>
      })}
      {fcArr.length>0&&<button onClick={()=>setFcArr([])} style={{padding:"4px 8px",borderRadius:6,fontSize:11,fontWeight:600,border:"1px solid #E5E7EB",cursor:"pointer",background:"#fff",color:"#6E6E73",marginLeft:4}}>✕ Limpiar</button>}
    </div>

    {cL>0&&<Cd ac="#1D4E89" s={{marginBottom:8,background:"#1D4E8908"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:13,fontWeight:600,color:"#1D4E89"}}>{cL} SKUs seleccionados · {fmt(tC)}</span><div style={{display:"flex",gap:4}}><Bt sm v="pri" onClick={irNuevaOC} ic="➕">Crear OC</Bt><Bt sm v="gry" onClick={()=>setCart({})}>Vaciar</Bt></div></div></Cd>}

    <div style={{display:"flex",gap:6,marginBottom:8}}>
      {fuenteRepo==="v2"&&nSinProv>0&&<button onClick={()=>setSoloSinProv(x=>!x)} title="Productos activos sin proveedor asociado: se asignan en Configuración › Política de compra" style={{padding:"0 12px",borderRadius:8,border:"1px solid "+(soloSinProv?"#B42318":"#F5C2C0"),background:soloSinProv?"#B42318":"#FEF3F2",color:soloSinProv?"#fff":"#B42318",fontSize:12.5,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>⚠ Sin proveedor ({nSinProv})</button>}
      <input placeholder="Buscar producto o SKU..." value={q} onChange={e=>setQ(e.target.value)} style={{...css.input,flex:1,fontSize:13}}/>
      {/* ⭐ v48: Dropdown multi-select de tipos */}
      <div style={{position:"relative"}}>
        <button onClick={()=>setShowTipos(v=>!v)} style={{...css.select,width:180,fontSize:12,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:ftArr.length>0?"#1D4E8910":"#fff",borderColor:ftArr.length>0?"#1D4E8940":"#E5E7EB",color:ftArr.length>0?"#1D4E89":"#3A3A3C",fontWeight:ftArr.length>0?600:400}}>
          <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {ftArr.length===0?"Todos los tipos":ftArr.length===1?ftArr[0]:`${ftArr.length} tipos`}
          </span>
          <span style={{fontSize:11}}>{showTipos?"▲":"▼"}</span>
        </button>
        {showTipos&&<>
          <div onClick={()=>setShowTipos(false)} style={{position:"fixed",inset:0,zIndex:50}}/>
          <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,minWidth:260,maxWidth:320,maxHeight:340,overflowY:"auto",background:"#fff",border:"1px solid #E5E7EB",borderRadius:8,boxShadow:"0 4px 20px rgba(0,0,0,0.12)",zIndex:51,padding:"6px 0"}}>
            <div style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",borderBottom:"1px solid #F4F5F7"}}>
              <button onClick={()=>setFtArr(tipos)} style={{fontSize:11,color:"#1D4E89",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>Seleccionar todos</button>
              <button onClick={()=>setFtArr([])} style={{fontSize:11,color:"#B42318",background:"none",border:"none",cursor:"pointer",fontWeight:600}}>Limpiar</button>
            </div>
            {tipos.length===0?<div style={{padding:12,fontSize:12,color:"#6E6E73",textAlign:"center"}}>No hay tipos disponibles</div>:
            tipos.map(t=>{
              const sel=ftArr.includes(t)
              const count=prods.filter(p=>p.tipo_producto===t).length
              return<label key={t} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",cursor:"pointer",background:sel?"#1D4E8908":"transparent",fontSize:12}}>
                <input type="checkbox" checked={sel} onChange={()=>toggleTipo(t)} style={{width:14,height:14,accentColor:"#1D4E89"}}/>
                <span style={{flex:1,color:sel?"#1D4E89":"#3A3A3C",fontWeight:sel?600:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t}</span>
                <span style={{fontSize:11,color:"#AEAEB2"}}>{count}</span>
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
      <span style={{fontSize:11,color:"#6E6E73",fontWeight:600,textTransform:"uppercase",marginRight:4}}>Tipos:</span>
      {ftArr.map(t=><span key={t} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",background:"#1D4E8915",color:"#1D4E89",borderRadius:12,fontSize:12,fontWeight:600}}>
        {t}
        <button onClick={()=>toggleTipo(t)} style={{background:"none",border:"none",color:"#1D4E89",cursor:"pointer",padding:0,fontSize:12,lineHeight:1}}>×</button>
      </span>)}
    </div>}

    <div style={pantallaRepo?{position:"fixed",inset:0,zIndex:250,background:"#F7F8FA",padding:"12px 16px",overflow:"auto"}:{}}>
    {fuenteRepo==="v2"&&<div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",padding:"8px 12px",background:ambito==="T"?"#fff":"#EEF4FB",border:"1px solid #D1D1D6",borderBottom:"none",borderRadius:"10px 10px 0 0"}}>
      <span style={{fontSize:12.5,fontWeight:800,color:"#16213E",marginRight:4}}>Calcular para:</span>
      {[["T","Empresa (consolidado)"],...sucursales.filter(x=>!x.es_cd&&!["suc-web","suc-admin"].includes(x.id)&&x.activo!==false).map(x=>[x.id,x.nombre])].map(([k,l])=><button key={k} onClick={()=>{setAmbito(k);setFilaAbierta(null)}} style={{padding:"4px 12px",borderRadius:999,fontSize:12.5,fontWeight:700,cursor:"pointer",border:"1px solid "+(ambito===k?"#16213E":"#D1D5DB"),background:ambito===k?"#16213E":"#fff",color:ambito===k?"#fff":"#3A3A3C"}}>{l}</button>)}
      {ambito!=="T"&&<span style={{fontSize:12,color:"#1D4E89",marginLeft:6}}>Pedido exclusivo para <b>{sucursales.find(x=>x.id===ambito)?.nombre||ambito}</b>: usa la venta, el stock y el tránsito con destino a esa tienda, con el lead time del proveedor, la seguridad de la clase y la cobertura de la categoría. La OC queda con ese destino.</span>}
      {ambito!=="T"&&(()=>{const l=prodsV2.filter(p=>p.reposicion_necesaria>0&&p.stock_cd>0);return l.length?<span style={{fontSize:12,color:"#B25E09",fontWeight:700,marginLeft:6}}>⚠ En {fN(l.length)} producto{l.length===1?"":"s"} a reponer, el CD tiene stock para cubrir {fN(l.reduce((a,p)=>a+Math.min(p.reposicion_necesaria,p.stock_cd),0))} u: traslada antes de comprar (columna “En CD”).</span>:null})()}
    </div>}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"8px 12px",background:"#fff",border:"1px solid #D1D1D6",borderBottom:"none",borderRadius:fuenteRepo==="v2"?0:"10px 10px 0 0",flexWrap:"wrap"}}>
      <span style={{fontSize:13,fontWeight:700,color:"#16213E"}}>Reposición · {fuenteRepo!=="v2"?"cálculo anterior":ambito==="T"?"consolidado":`pedido exclusivo para ${sucursales.find(x=>x.id===ambito)?.nombre||ambito}`} <span style={{fontWeight:500,color:"#6E6E73",fontSize:12}}>· {fil.length} de {resumen.total} productos{nInactivosOcultos?` · ${nInactivosOcultos} inactivos ocultos (aparecen al buscar o al filtrar por estado)`:""}</span></span>
      <span style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:"#6B7280"}}>Inversión de lo filtrado: <b style={{color:"#1C1C1E"}}>{fmt(fil.filter(i=>i.estado==="Reposición"||Number(i.reposicion_necesaria)>0).reduce((acc,i)=>acc+(Number(i.costo_reposicion)||0),0))}</b></span>
        <button onClick={()=>setVerFiltros(v=>!v)} style={{padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:700,border:"1px solid "+(verFiltros?"#16213E":"#D1D5DB"),background:verFiltros?"#16213E":"#fff",color:verFiltros?"#fff":"#3A3A3C",cursor:"pointer"}}>Filtros por columna</button>
        {Object.values(filtrosCol).some(Boolean)&&<button onClick={()=>setFiltrosCol({})} style={{padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:700,border:"1px solid #F5C2C0",background:"#FEF3F2",color:"#B42318",cursor:"pointer"}}>Limpiar filtros</button>}
        <button onClick={()=>setPantallaRepo(p=>!p)} style={{padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:700,border:"1px solid #D1D5DB",background:"#fff",color:"#3A3A3C",cursor:"pointer"}}>{pantallaRepo?"Salir de pantalla completa ✕":"⤢ Pantalla completa"}</button>
      </span>
    </div>
    {/* EXPANDED TABLE with sticky header + clickable sort */}
    <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}><div style={{overflowY:"auto",maxHeight:pantallaRepo?"calc(100vh - 120px)":"calc(100vh - 280px)",borderRadius:0,border:"1px solid #D1D1D6",minWidth:window.innerWidth<768?600:"auto"}}>
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,tableLayout:"auto"}}>
      <thead style={{position:"sticky",top:0,zIndex:5}}><tr style={{background:"#E5E7EB"}}>
        {[["",""],["Producto","producto"],["Tipo","tipo_producto"],["Clasif.","clasif_abcd"],["Estado","estado"],...Array.from({length:v2m?12:6},(_,k)=>[mNames[k],`venta_mes_${k+1}`]),[`${mesActualLabel} ◐`,"venta_mes_actual"],["Vta Total","venta_total"],[v2m?"Desv.":"Quieb.",v2m?"desv":"meses_quiebre"],[v2m?"Vta/Mes":"Vta Comp.","vta_prom_compensada"],["Vta/Día","vta_prom_diaria"],["Stock","stock_actual"],["Tráns.","stock_transito"],...(v2m&&ambito!=="T"?[["En CD","stock_cd"]]:[]),["Cob.","dias_cobertura"],["Pto Re.","punto_reorden"],...(v2m?[["Stock obj.","stock_obj"]]:[]),["Reponer","reposicion_necesaria"],...(v2m?[["Cálculo",""]]:[]),["Costo U.","costo_unitario"],["Inversión","costo_reposicion"],...(v2m?[["Proveedor","proveedor"],["Urgencia","urgencia"]]:[])].map(([label,col],i)=>
          <th key={i} onClick={col?()=>toggleSort(col):undefined} style={{padding:"9px 5px",textAlign:i<3?"left":"right",fontSize:11,fontWeight:700,color:sortBy===col?"#1D4E89":"#6E6E73",borderBottom:sortBy===col?"2px solid #1D4E89":"2px solid #C7C7CC",textTransform:"uppercase",letterSpacing:"0.03em",whiteSpace:"nowrap",background:sortBy===col?"#D6E4F0":"#E5E7EB",cursor:col?"pointer":"default",userSelect:"none",transition:"all 0.15s"}}>{label}{sortBy===col&&<span style={{marginLeft:3,fontSize:8}}>{sortDir==="desc"?"▼":"▲"}</span>}</th>
        )}
      </tr>
      {verFiltros&&<tr style={{background:"#F4F5F7"}}>{[["",""],["","producto"],["","tipo_producto"],["","clasif_abcd"],["","estado"],...Array.from({length:v2m?12:6},(_,k)=>["",`venta_mes_${k+1}`]),["","venta_mes_actual"],["","venta_total"],["",v2m?"desv":"meses_quiebre"],["","vta_prom_compensada"],["","vta_prom_diaria"],["","stock_actual"],["","stock_transito"],...(v2m&&ambito!=="T"?[["","stock_cd"]]:[]),["","dias_cobertura"],["","punto_reorden"],...(v2m?[["","stock_obj"]]:[]),["","reposicion_necesaria"],...(v2m?[["",""]]:[]),["","costo_unitario"],["","costo_reposicion"],...(v2m?[["","proveedor"],["","urgencia"]]:[])].map(([_,col],i)=><th key={"f"+i} style={{padding:"3px 3px",borderBottom:"1px solid #D1D1D6"}}>{col?<input value={filtrosCol[col]||""} onChange={e=>setFiltrosCol(f=>({...f,[col]:e.target.value}))} placeholder={i<5||col==="proveedor"||col==="urgencia"?"contiene…":">, <, ="} title={`Filtrar ${col==="producto"?"Producto":col}`} style={{width:"100%",minWidth:42,fontSize:11,padding:"2px 4px",border:"1px solid #D1D5DB",borderRadius:4,fontWeight:400}}/>:null}</th>)}</tr>}
    </thead>
      <tbody>{fil.map((it,idx)=>{const inC=!!cart[it.sku];const crit=(it.dias_cobertura||999)<15&&["A","B"].includes(it.clasif_abcd);const isR=it.estado==="Reposición";const ec=estColors[it.estado]||estColors["Revisar"]
        return<Fragment key={it.sku}><tr onClick={()=>setFilaAbierta(a=>a===it.sku?null:it.sku)} title="Ver la distribución por sucursal y las OC en tránsito" style={{background:filaAbierta===it.sku?"#EEF4FB":inC?"#1D4E8906":idx%2?"#fafafa":"#fff",cursor:"pointer",borderBottom:"1px solid #E5E7EB",transition:"background 0.1s"}} onMouseOver={e=>{if(!inC)e.currentTarget.style.background="#F4F5F7"}} onMouseOut={e=>{if(!inC)e.currentTarget.style.background=idx%2?"#fafafa":"#fff"}}>
          <td style={{padding:"7px 4px",width:28}} onClick={e=>{e.stopPropagation();tog(it)}}><input type="checkbox" checked={inC} onChange={()=>{}} aria-label={`Agregar ${it.producto} a la OC`} style={{width:16,height:16,cursor:"pointer"}}/></td>
          <td style={{padding:"7px 4px",maxWidth:240}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{fontSize:13,fontWeight:600,color:"#1C1C1E",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.producto}</div></div><div style={{fontSize:11,color:"#AEAEB2"}}>{it.sku}{it._v2?.duplicado_de&&<span title="Hay otro producto con el mismo nombre en BSALE; corregirlo allá" style={{marginLeft:6,color:"#B25E09",fontWeight:700}}>· duplicado de {it._v2.duplicado_de}</span>}</div></td>
          <td style={{padding:"7px 4px",fontSize:12,color:"#6E6E73",whiteSpace:"nowrap",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis"}}>{it.tipo_producto}</td>
          <td style={{padding:"7px 4px",textAlign:"center"}}><span style={{display:"inline-block",padding:"2px 6px",borderRadius:4,fontSize:12,fontWeight:700,color:CL[it.clasif_abcd]?.c,background:CL[it.clasif_abcd]?.bg}}>{it.clasif_abcd}</span></td>
          <td style={{padding:"7px 4px",textAlign:"right"}}><span style={{display:"inline-block",padding:"2px 5px",borderRadius:4,fontSize:11,fontWeight:600,color:ec.c,background:ec.bg,whiteSpace:"nowrap"}}>{it.estado}</span></td>
          {Array.from({length:v2m?12:6},(_,k)=>{const v=it[`venta_mes_${k+1}`];return <td key={"m"+k} style={{padding:"7px 4px",textAlign:"right",color:v?(v<0?"#B42318":"#1C1C1E"):"#D1D1D6"}}>{fN(v||0)}</td>})}
          <td style={{padding:"7px 4px",textAlign:"right",fontStyle:"italic",color:it.venta_mes_actual?"#B25E09":"#D1D1D6",background:"#B25E0908"}}>{fN(it.venta_mes_actual||0)}</td>
          <td style={{padding:"7px 4px",textAlign:"right",fontWeight:600,color:it.venta_total?"#1C1C1E":"#D1D1D6"}}>{fN(it.venta_total||0)}</td>
          {v2m?<td style={{padding:"7px 4px",textAlign:"right",whiteSpace:"nowrap"}} title="Meses que no entran al promedio (quiebre o atípico) · meses compensados por quiebre; detalle en ⓘ">{it._tienda?<span style={{color:"#D1D1D6"}}>—</span>:(()=>{const e=Number(it._v2?.meses_excluidos)||0,c=Number(it._v2?.meses_compensados)||0;return e||c?<span style={{fontSize:11.5,fontWeight:700}}>{e>0&&<span style={{color:"#5B2C6F"}}>{e}✕</span>}{e>0&&c>0&&" "}{c>0&&<span style={{color:"#1D4E89"}}>{c}↺</span>}</span>:<span style={{color:"#D1D1D6"}}>—</span>})()}</td>:<td style={{padding:"7px 4px",textAlign:"right"}}>{it.meses_quiebre>0?<span style={{color:"#B25E09",fontWeight:700}}>{it.meses_quiebre}</span>:<span style={{color:"#D1D1D6"}}>0</span>}</td>}
          <td style={{padding:"7px 4px",textAlign:"right",fontWeight:600,color:it.vta_prom_compensada?"#1D4E89":"#D1D1D6"}}>{fN(it.vta_prom_compensada||0)}</td>
          <td style={{padding:"7px 4px",textAlign:"right",color:"#6E6E73"}}>{it.vta_prom_diaria?Math.round(it.vta_prom_diaria*10)/10:"—"}</td>
          <td style={{padding:"7px 4px",textAlign:"right",fontWeight:600,color:it.stock_actual<=0?"#B42318":"#1C1C1E"}}>{fN(it.stock_actual)}</td>
          <td style={{padding:"7px 4px",textAlign:"right",color:it.stock_transito?"#1D4E89":"#D1D1D6"}}>{it.stock_transito?<button onClick={e=>{e.stopPropagation();setFilaAbierta(it.sku)}} title="Ver las OC en tránsito y revisarlas" style={{border:"none",background:"transparent",color:"#1D4E89",fontWeight:800,textDecoration:"underline dotted",cursor:"pointer",padding:0,fontSize:13}}>{fN(it.stock_transito)}</button>:"—"}</td>{v2m&&ambito!=="T"&&<td style={{padding:"7px 4px",textAlign:"right"}}>{it.stock_cd>0?<span title={it.reposicion_necesaria>0?"El CD tiene stock de este producto: traslada a la tienda antes de comprar":"Stock disponible en el CD"} style={{color:it.reposicion_necesaria>0?"#B25E09":"#3A3A3C",fontWeight:it.reposicion_necesaria>0?800:500}}>{it.reposicion_necesaria>0?"⚠ ":""}{fN(it.stock_cd)}</span>:<span style={{color:"#D1D1D6"}}>—</span>}</td>}
          <td style={{padding:"7px 4px",textAlign:"right"}}><span style={{fontWeight:700,color:crit?"#B42318":(it.dias_cobertura||0)<30?"#B25E09":"#1E7A44"}}>{it.dias_cobertura&&it.dias_cobertura<999?Math.round(it.dias_cobertura)+"d":"—"}</span></td>
          <td style={{padding:"7px 4px",textAlign:"right",color:"#6E6E73"}}>{it.punto_reorden?fN(it.punto_reorden):"—"}</td>{v2m&&<td style={{padding:"7px 4px",textAlign:"right",color:"#6E6E73"}}>{it.stock_obj?fN(it.stock_obj):"—"}</td>}
          <td style={{padding:"7px 4px",textAlign:"right"}}>{inC?<input type="number" value={cart[it.sku]?.cp||0} onChange={e=>{e.stopPropagation();setQty(it.sku,e.target.value)}} onClick={e=>e.stopPropagation()} style={{width:65,textAlign:"center",fontSize:13,fontWeight:700,padding:"3px",border:"2px solid #1D4E89",borderRadius:6,color:"#1D4E89"}}/>:(v2m?<span onClick={e=>{e.stopPropagation();setLeyenda(it)}} title="Ver cómo se calculó" style={{cursor:"help",fontWeight:700,color:Number(it.reposicion_necesaria)>0?"#B42318":"#D1D1D6",borderBottom:Number(it.reposicion_necesaria)>0?"1px dotted #B42318":"none"}}>{Number(it.reposicion_necesaria)>0?fN(it.reposicion_necesaria):"—"}</span>:<TooltipFormula it={it} mNames={mNames} params={params} paramsABCD={paramsABCD}/>)}</td>{v2m&&<td style={{padding:"7px 4px",textAlign:"center"}}><button onClick={e=>{e.stopPropagation();setLeyenda(it)}} title="Ver cómo se calculó" style={{border:"1px solid #16213E",background:"#fff",color:"#16213E",borderRadius:5,padding:"1px 8px",fontSize:11.5,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>ⓘ Ver</button></td>}
          <td style={{padding:"7px 4px",textAlign:"right",color:"#6E6E73",fontSize:12}}>{it.costo_unitario?fmt(it.costo_unitario):"—"}</td>
          <td style={{padding:"7px 4px",textAlign:"right",fontWeight:600,fontSize:12}}>{it.costo_reposicion?fmt(it.costo_reposicion):"—"}</td>{v2m&&<td style={{padding:"7px 6px",fontSize:12,whiteSpace:"nowrap",maxWidth:170,overflow:"hidden",textOverflow:"ellipsis"}} title={it._v2?.lead_time_fuente||""}>{it.proveedor||<span style={{fontSize:11,fontWeight:700,color:"#B42318",background:"#FEF3F2",borderRadius:5,padding:"1px 7px"}}>Sin proveedor</span>}</td>}{v2m&&<td style={{padding:"7px 6px",fontSize:11.5,fontWeight:700,whiteSpace:"nowrap",color:it.urgencia==="Pedir hoy"?"#B42318":it.urgencia==="Pedir esta semana"?"#B25E09":it.urgencia==="Pedir este mes"?"#1D4E89":"#9CA3AF"}} title={it._v2?.fecha_pedido?`Fecha sugerida de pedido: ${it._v2.fecha_pedido} · quiebre estimado: ${it._v2?.fecha_quiebre||"—"}`:""}>{it.urgencia||"—"}</td>}
        </tr>{filaAbierta===it.sku&&<tr><td colSpan={99} style={{padding:0,background:"#F7F8FA",borderBottom:"2px solid #16213E"}}><DetalleLineaSucursal it={it} ambito={ambito} sucursales={sucursales} ocs={ocs} setDet={setDet} onLeyenda={v2m?()=>setLeyenda(it):null}/></td></tr>}</Fragment>})}</tbody>
    </table></div></div>
    <div style={{padding:"8px 12px",background:"#F4F5F7",borderRadius:"0 0 10px 10px",fontSize:12,color:"#6E6E73",display:"flex",justifyContent:"space-between"}}><span>{fil.length} de {resumen.total} productos</span><span>Inversión reposición: <strong style={{color:"#1C1C1E"}}>{fmt(fil.filter(i=>i.estado==="Reposición").reduce((s,i)=>s+(i.costo_reposicion||0),0))}</strong></span></div>
    </div>
  </div>


  {/* ⭐ Sheet: Ajustar parámetros por tipo */}
  <Sheet open={showParams} onClose={()=>{setShowParams(false);setParamPreview(null)}} title="⚙️ Ajustar parámetros de reposición">
    <Fl l="Categoría de producto" req>
      <select style={css.select} value={paramTipo} onChange={e=>{setParamTipo(e.target.value);setParamPreview(null)}}>
        <option value="">— Seleccionar tipo —</option>
        {[...new Set(prods.map(p=>p.tipo_producto).filter(Boolean))].sort().map(t=><option key={t} value={t}>{t}</option>)}
      </select>
    </Fl>
    <div style={{display:"flex",gap:12,marginBottom:14}}>
      <Fl l="Días fabricación">
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <button onClick={()=>{setParamFab(v=>Math.max(1,v-5));setParamPreview(null)}} style={{width:32,height:32,borderRadius:8,border:"1px solid #E5E7EB",background:"#F4F5F7",fontSize:18,cursor:"pointer"}}>−</button>
          <input type="number" min="1" max="365" value={paramFab} onChange={e=>{setParamFab(Number(e.target.value));setParamPreview(null)}} style={{...css.input,width:70,textAlign:"center",fontWeight:700,fontSize:16}}/>
          <button onClick={()=>{setParamFab(v=>Math.min(365,v+5));setParamPreview(null)}} style={{width:32,height:32,borderRadius:8,border:"1px solid #E5E7EB",background:"#F4F5F7",fontSize:18,cursor:"pointer"}}>+</button>
          <span style={{fontSize:12,color:"#6E6E73"}}>días</span>
        </div>
      </Fl>
      <Fl l="Días cobertura objetivo">
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <button onClick={()=>{setParamCob(v=>Math.max(1,v-5));setParamPreview(null)}} style={{width:32,height:32,borderRadius:8,border:"1px solid #E5E7EB",background:"#F4F5F7",fontSize:18,cursor:"pointer"}}>−</button>
          <input type="number" min="1" max="365" value={paramCob} onChange={e=>{setParamCob(Number(e.target.value));setParamPreview(null)}} style={{...css.input,width:70,textAlign:"center",fontWeight:700,fontSize:16}}/>
          <button onClick={()=>{setParamCob(v=>Math.min(365,v+5));setParamPreview(null)}} style={{width:32,height:32,borderRadius:8,border:"1px solid #E5E7EB",background:"#F4F5F7",fontSize:18,cursor:"pointer"}}>+</button>
          <span style={{fontSize:12,color:"#6E6E73"}}>días</span>
        </div>
      </Fl>
    </div>
    {paramTipo&&<Bt fw variant="secondary" onClick={()=>calcPreview(paramFab,paramCob)} sm>🔍 Calcular impacto</Bt>}
    {paramPreview&&<div style={{marginTop:14,background:"#F4F5F7",borderRadius:12,padding:14}}>
      <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>Preview — {paramPreview.total} SKUs afectados en "{paramTipo}"</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
        <div style={{background:"#fff",borderRadius:8,padding:10,textAlign:"center"}}>
          <div style={{fontSize:11,color:"#6E6E73",fontWeight:600,marginBottom:4}}>ANTES</div>
          <div style={{fontSize:20,fontWeight:800,color:"#B42318"}}>{fN(paramPreview.antesUnid)} u</div>
          <div style={{fontSize:12,color:"#6E6E73"}}>{fmt(paramPreview.antesCLP)}</div>
        </div>
        <div style={{background:"#fff",borderRadius:8,padding:10,textAlign:"center"}}>
          <div style={{fontSize:11,color:"#6E6E73",fontWeight:600,marginBottom:4}}>DESPUÉS</div>
          <div style={{fontSize:20,fontWeight:800,color:"#1D4E89"}}>{fN(paramPreview.despuesUnid)} u</div>
          <div style={{fontSize:12,color:"#6E6E73"}}>{fmt(paramPreview.despuesCLP)}</div>
        </div>
      </div>
      {paramPreview.top5.length>0&&<>
        <div style={{fontSize:12,fontWeight:700,color:"#3C3C43",marginBottom:6}}>Top SKUs con mayor cambio:</div>
        {paramPreview.top5.map(p=><div key={p.sku} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #E5E7EB"}}>
          <div><div style={{fontSize:12,fontWeight:600}}>{p.producto}</div><div style={{fontSize:11,color:"#6E6E73"}}>{p.sku}</div></div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:12}}>{fN(p.reposicion_necesaria||0)} → <span style={{fontWeight:700,color:p.delta>0?"#B42318":"#1E7A44"}}>{fN(p.nuevo_repo)}</span></div>
            <div style={{fontSize:12,color:p.delta>0?"#B42318":"#1E7A44",fontWeight:600}}>{p.delta>0?"+":""}{fN(p.delta)} u</div>
          </div>
        </div>)}
      </>}
      <div style={{marginTop:14}}><Bt fw onClick={aplicarParams} disabled={paramSaving}>{paramSaving?"Aplicando...":"✓ Aplicar y recalcular en BD"}</Bt></div>
    </div>}
  </Sheet>
}

/* ═══ SOLICITUD — Formal corporate document ═══ */
/* 19-oct-2026: carga masiva de productos a una OC. Se pega desde Excel (cualquier planilla) o se sube un archivo
   (xlsx, xls o csv con columnas SKU y cantidad; la plantilla antigua de OC sigue por su importador).
   Cruza cada SKU con el cálculo vigente y avisa diferencias antes de cargar; las líneas quedan con los controles de compra. */
const cmNorm=t=>String(t??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/\s+/g," ").trim()
const cmNum=v=>{if(typeof v==="number")return v;let t=String(v??"").replace(/[$\s]/g,"").trim();if(!t)return 0;if(t.includes(","))t=t.replace(/\./g,"").replace(",",".");else if(/^-?\d{1,3}(\.\d{3})+$/.test(t))t=t.replace(/\./g,"");const n=Number(t);return isNaN(n)?0:n}
const cmSku=v=>typeof v==="number"?String(Math.round(v)):String(v??"").trim()
function cmLeerTabla(filas){
  let h=null
  for(let r=0;r<Math.min(filas.length,40)&&!h;r++){
    const c=(filas[r]||[]).map(cmNorm)
    const iS=c.findIndex(x=>x==="SKU"||/^(COD|CODIGO)\b/.test(x)||/\bSKU\b/.test(x))
    const iQ=c.findIndex(x=>/^(CANT|CANTIDAD|UNIDADES|UNID|QTY|PEDIDO|A PEDIR|REPONER|A COMPRAR)\b/.test(x))
    if(iS>=0&&iQ>=0)h={r,iS,iQ,iC:c.findIndex(x=>/(COSTO|PRECIO|VALOR)/.test(x)&&!/(TOTAL|SUBTOTAL)/.test(x)),iP:c.findIndex(x=>/(PRODUCTO|DESCRIPCION|NOMBRE|DETALLE)/.test(x))}
  }
  const out=[]
  for(let r=h?h.r+1:0;r<filas.length;r++){
    const f=filas[r]||[];const sku=cmSku(h?f[h.iS]:f[0]);if(!sku)continue
    const cant=cmNum(h?f[h.iQ]:f[1]);if(!h&&!(cant>0))continue
    out.push({sku,cantidad:cant,costo:h?(h.iC>=0?cmNum(f[h.iC]):0):cmNum(f[2]),nombre:h&&h.iP>=0?String(f[h.iP]??"").trim():""})
  }
  return{filas:out,encabezado:!!h}
}
function CargaMasivaOC({v2App=[],enOC=[],onAplicar,onPlantillaAntigua,onClose}){
  const[texto,setTexto]=useState("")
  const[res,setRes]=useState(null)
  const[msg,setMsg]=useState("")
  const mapa=useMemo(()=>{const m={};(v2App||[]).forEach(r=>{m[String(r.sku).trim().toUpperCase()]=r});return m},[v2App])
  const enOCset=useMemo(()=>new Set((enOC||[]).map(s=>String(s).trim().toUpperCase())),[enOC])
  const preparar=(filas,origen)=>{
    const agg={}
    filas.forEach(f=>{const k=f.sku.toUpperCase();if(agg[k]){agg[k].cantidad+=f.cantidad;agg[k].repetido=true;if(!agg[k].costo&&f.costo)agg[k].costo=f.costo}else agg[k]={...f}})
    const lineas=Object.values(agg).map(f=>{const r=mapa[f.sku.toUpperCase()];const sug=r?Number(r.reposicion)||0:null;const costo=f.costo>0?f.costo:(r?Number(r.costo_unitario)||0:0)
      const av=[]
      if(enOCset.has(f.sku.toUpperCase()))av.push({n:"x",t:"Ya está en la OC desde Reposición: no se agrega"})
      if(!r)av.push({n:"!",t:"No está en el cálculo (SKU nuevo o mal escrito)"})
      if(f.repetido)av.push({n:"i",t:"SKU repetido: se sumaron las cantidades"})
      if(r&&["Inactivo","Servicio","Sin venta reciente","Sin ventas","Kit por definir"].includes(r.estado))av.push({n:"!",t:r.estado})
      else if(r&&sug===0&&f.cantidad>0)av.push({n:"!",t:"Hoy no necesita reposición"})
      else if(r&&sug>0&&f.cantidad>sug*1.2)av.push({n:"!",t:`Sobre lo sugerido (${fN(sug)})`})
      if(!(costo>0))av.push({n:"!",t:"Sin costo: complétalo en la OC"})
      if(!(f.cantidad>0))av.push({n:"x",t:"Cantidad 0: no se agrega"})
      return{...f,producto:r?.producto||f.nombre||f.sku,tipo_producto:r?.tipo_producto||"",costo,fuenteCosto:f.costo>0?"archivo":(r?"BSALE":""),sugerido:sug,encontrado:!!r,avisos:av,carga:!enOCset.has(f.sku.toUpperCase())&&f.cantidad>0}})
    setRes({origen,lineas});setMsg(lineas.length?"":"No encontré filas con SKU y cantidad. Revisa que la planilla tenga una columna de SKU o código y otra de cantidad.")
  }
  const leerTexto=()=>{const filas=texto.split(/\r?\n/).map(l=>l.split(/\t|;/)).filter(f=>f.some(c=>String(c).trim()));const{filas:fs}=cmLeerTabla(filas);preparar(fs,"Pegado desde Excel")}
  const leerArchivo=async file=>{
    try{
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array'})
      const hojaOC=wb.SheetNames.find(s=>s.toUpperCase().includes("ORDEN"))
      if(hojaOC&&wb.Sheets[hojaOC]?.['B27']&&onPlantillaAntigua){onPlantillaAntigua(file);onClose();return}
      let mejor=null
      for(const n of wb.SheetNames){const filas=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:true,defval:""});const r=cmLeerTabla(filas);if(r.filas.length&&(!mejor||(r.encabezado&&!mejor.encabezado)))mejor=r;if(mejor?.encabezado)break}
      preparar(mejor?.filas||[],`Archivo ${file.name}`)
    }catch(e){setMsg("No pude leer el archivo: "+e.message)}
  }
  const aCargar=(res?.lineas||[]).filter(l=>l.carga)
  const total=aCargar.reduce((a,l)=>a+l.cantidad*(l.costo||0),0)
  const nAv=(res?.lineas||[]).filter(l=>l.avisos.some(a=>a.n==="!")).length
  const th={padding:"6px 8px",fontSize:11.5,color:"#6E6E73",fontWeight:700,textAlign:"right",whiteSpace:"nowrap",borderBottom:"1px solid #E5E7EB",position:"sticky",top:0,background:"#fff"}
  return <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(15,23,42,.45)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div onClick={e=>e.stopPropagation()} role="dialog" aria-label="Carga masiva de productos" style={{background:"#fff",borderRadius:12,width:"min(1100px,100%)",maxHeight:"92vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 50px rgba(0,0,0,.25)"}}>
      <div style={{padding:"16px 20px",borderBottom:"1px solid #E5E7EB"}}>
        <div style={{fontSize:16,fontWeight:800,color:"#16213E"}}>Carga masiva de productos</div>
        <div style={{fontSize:12.5,color:"#6E6E73",marginTop:2}}>Copia desde cualquier Excel las columnas <b>SKU</b> y <b>cantidad</b> (y si quieres <b>costo</b>), con o sin encabezado, y pégalas aquí; o sube el archivo. Cada SKU se cruza con el cálculo vigente.</div>
      </div>
      <div style={{padding:"12px 20px",overflowY:"auto"}}>
        {!res&&<>
          <textarea value={texto} onChange={e=>setTexto(e.target.value)} aria-label="Pegar productos desde Excel" placeholder={"SKU\tCantidad\tCosto\n70431726513334\t50\t71992\n74534319295007\t10\t89990"} style={{width:"100%",minHeight:180,fontFamily:"monospace",fontSize:12.5,border:"1px solid #D1D5DB",borderRadius:8,padding:10,boxSizing:"border-box"}}/>
          <div style={{display:"flex",gap:8,alignItems:"center",marginTop:10,flexWrap:"wrap"}}>
            <Bt v="pri" dis={!texto.trim()} onClick={leerTexto}>Leer lo pegado</Bt>
            <span style={{fontSize:12.5,color:"#6E6E73"}}>o</span>
            <label style={{padding:"6px 14px",borderRadius:6,fontSize:12.5,fontWeight:700,background:"#fff",color:"#16213E",border:"1px solid #D1D5DB",cursor:"pointer"}}>Subir archivo (xlsx, xls o csv)<input type="file" accept=".xlsx,.xls,.csv" aria-label="Archivo de productos" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)leerArchivo(f);e.target.value=""}}/></label>
          </div>
        </>}
        {msg&&<div style={{marginTop:10,fontSize:12.5,color:"#B42318",fontWeight:600}}>{msg}</div>}
        {res&&res.lineas.length>0&&<>
          <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:12.5,margin:"2px 0 10px"}}>
            <span><b>{res.lineas.length}</b> productos leídos ({res.origen})</span>
            <span style={{color:"#1E7A44"}}><b>{res.lineas.filter(l=>l.encontrado).length}</b> en el cálculo</span>
            <span style={{color:"#B42318"}}><b>{res.lineas.filter(l=>!l.encontrado).length}</b> no encontrados</span>
            <span style={{color:"#B25E09"}}><b>{nAv}</b> con avisos</span>
            <span>Total neto a cargar <b>{fmt(total)}</b></span>
          </div>
          <div style={{border:"1px solid #E5E7EB",borderRadius:8,maxHeight:"48vh",overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
            <thead><tr><th style={{...th,textAlign:"left"}}>SKU</th><th style={{...th,textAlign:"left"}}>Producto</th><th style={th}>Cantidad</th><th style={th}>Costo U.</th><th style={th}>Subtotal</th><th style={th}>Sugerido hoy</th><th style={{...th,textAlign:"left"}}>Avisos</th></tr></thead>
            <tbody>{res.lineas.map(l=><tr key={l.sku} style={{borderTop:"1px solid #F3F4F6",opacity:l.carga?1:.5}}>
              <td style={{padding:"5px 8px",fontFamily:"monospace",whiteSpace:"nowrap"}}>{l.sku}</td>
              <td style={{padding:"5px 8px"}}>{l.producto}{l.tipo_producto&&<div style={{fontSize:11,color:"#6E6E73"}}>{l.tipo_producto}</div>}</td>
              <td style={{padding:"5px 8px",textAlign:"right",fontWeight:700}}>{fN(l.cantidad)}</td>
              <td style={{padding:"5px 8px",textAlign:"right"}}>{l.costo>0?fmt(l.costo):"—"}{l.fuenteCosto==="BSALE"&&<div style={{fontSize:10.5,color:"#6E6E73"}}>costo BSALE</div>}</td>
              <td style={{padding:"5px 8px",textAlign:"right"}}>{l.costo>0?fmt(l.cantidad*l.costo):"—"}</td>
              <td style={{padding:"5px 8px",textAlign:"right",color:l.sugerido==null?"#D1D1D6":"#1C1C1E"}}>{l.sugerido==null?"—":fN(l.sugerido)}</td>
              <td style={{padding:"5px 8px",fontSize:11.5}}>{l.avisos.length?l.avisos.map((a,i)=><div key={i} style={{color:a.n==="i"?"#1D4E89":a.n==="x"?"#6E6E73":"#B25E09",fontWeight:600}}>{a.n==="i"?"ℹ":a.n==="x"?"⊘":"⚠"} {a.t}</div>):<span style={{color:"#1E7A44",fontWeight:700}}>✓ OK</span>}</td>
            </tr>)}</tbody></table></div>
          <div style={{fontSize:11.5,color:"#6E6E73",marginTop:6}}>Los avisos no bloquean: quedan en los controles de compra de la OC para quien aprueba.</div>
        </>}
      </div>
      <div style={{padding:"12px 20px",borderTop:"1px solid #E5E7EB",display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
        <div>{res&&<Bt v="gry" onClick={()=>{setRes(null);setMsg("")}}>← Volver a pegar</Bt>}</div>
        <div style={{display:"flex",gap:8}}>
          <Bt v="gry" onClick={onClose}>Cancelar</Bt>
          {res&&<Bt v="pri" dis={!aCargar.length} onClick={()=>{onAplicar(aCargar.map(l=>({id:uid(),producto:l.producto,sku:l.sku,tipo_producto:l.tipo_producto,cantidad:l.cantidad,costo_unitario:l.costo||0})),res.origen);onClose()}}>Agregar {aCargar.length} productos a la OC</Bt>}
        </div>
      </div>
    </div>
  </div>
}

function SolView({cart,setCart,provs,users,sucursales=[],cu,setOcs,addFirma,goOC,ocs,config={},notificarFlujo,v2App=[]}){
  const TC_USD=Number(config.tc_usd)||950
  const[prov,setProv]=useState("");const[tipo,setTipo]=useState("Nacional");const[fEst,setFEst]=useState("");const[notas,setNotas]=useState("");const[done,setDone]=useState(null);const[saving,setSaving]=useState(false)
  // ⭐ Destino de la OC — default CD Maipú, excepción directo a sucursal
  const[destinoSucursal,setDestinoSucursal]=useState(()=>{try{const v=localStorage.getItem("erp_sol_destino_pre")||"";if(v)localStorage.removeItem("erp_sol_destino_pre");return v}catch(e){return""}}) // 19-oct-2026: pedido exclusivo a una sucursal
  useEffect(()=>{if(!destinoSucursal&&sucursales.length>0){const cd=sucursales.find(s=>s.es_cd);setDestinoSucursal(cd?.id||sucursales[0]?.id||"")}},[sucursales])
  // Manual items (added from scratch)
  const[manualItems,setManualItems]=useLocalState("sol_manual",[])
  const addManual=()=>setManualItems(p=>[...p,{id:uid(),producto:"",sku:"",tipo_producto:"",cantidad:0,costo_unitario:0}])
  const updManual=(id,k,v)=>setManualItems(p=>p.map(i=>i.id===id?{...i,[k]:v}:i))
  const delManual=(id)=>setManualItems(p=>p.filter(i=>i.id!==id))

  // ⭐ Importador de OC desde Excel
  const[importData,setImportData]=useState(null) // {proveedor, productos[], condiciones, ocNum}
  const[showImport,setShowImport]=useState(false)
  const[cargaMasiva,setCargaMasiva]=useState(false) // 19-oct-2026: pegar desde Excel o subir archivo

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
    alert(`✓ ${items.length} productos cargados desde el Excel.\n\nRevisá los datos, selecciona proveedor y completa el plan de pago antes de enviar.`)
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
  useEffect(()=>{try{const v=localStorage.getItem("erp_sol_prov_pre");if(v){localStorage.removeItem("erp_sol_prov_pre");onProvChange(v)}}catch(e){}},[]) // 19-oct-2026: viene del plan de compras

  // ⭐ Editar costo unitario — guarda costo_original para detectar modificaciones
  const setCosto=(sku,v)=>setCart(p=>{
    const it=p[sku];if(!it)return p
    const nuevoCosto=Math.max(0,Number(v)||0)
    const costoOriginal=it.costo_original!==undefined?it.costo_original:(it.costo_unitario||0)
    return{...p,[sku]:{...it,costo_unitario:nuevoCosto,costo_original:costoOriginal,costo_modificado:nuevoCosto!==costoOriginal,costo_usd_ok:tipo==="Importación"?true:it.costo_usd_ok}}
  })

  const sel=Object.values(cart)
  const isI=tipo==="Importación"
  const allItems=[...sel.map(i=>({...i,source:"repo"})),...manualItems.map(i=>({...i,cp:i.cantidad,source:"manual"}))]
  /* 18-oct-2026: controles de compra. Contrastan cada línea con el cálculo de reposición y dejan constancia en el historial de la OC.
     Son avisos, no bloqueos: la decisión de comprar sigue siendo de quien firma, pero queda trazada. */
  const v2Map=useMemo(()=>{const m={};(v2App||[]).forEach(r=>{m[String(r.sku).trim().toUpperCase()]=r});return m},[v2App])
  const controlarCompra=()=>{
    const obs=[]
    allItems.forEach(i=>{
      if(!i.sku||String(i.sku).startsWith("MANUAL-")){if(i.source==="manual")obs.push({sku:i.sku,n:"info",t:`${(i.producto||"Producto manual").slice(0,34)}: línea manual, sin validación contra la demanda`});return}
      const r=v2Map[String(i.sku).trim().toUpperCase()]
      const cant=Number(i.cp||i.cantidad)||0
      const nom=(i.producto||i.sku).slice(0,34)
      if(!r){obs.push({sku:i.sku,n:"info",t:`${nom}: no está en el cálculo de reposición (SKU nuevo o fuera del maestro)`});return}
      const sug=Number(r.reposicion)||0
      if(["Inactivo","Sin ventas","Sin venta reciente"].includes(r.estado))obs.push({sku:i.sku,n:"alerta",t:`${nom}: estado "${r.estado}"; la compra no está respaldada por ventas recientes`})
      else if(r.estado==="Kit por definir")obs.push({sku:i.sku,n:"alerta",t:`${nom}: es un kit sin composición; se compra por sus componentes`})
      else if(r.estado==="Stock suficiente")obs.push({sku:i.sku,n:"alerta",t:`${nom}: stock suficiente según el cálculo (posición ${fN(r.posicion)} · punto de reorden ${fN(r.punto_reorden)})`})
      else if(sug>0&&cant>sug*1.5)obs.push({sku:i.sku,n:"alerta",t:`${nom}: pides ${fN(cant)} y la sugerencia es ${fN(sug)} (${Math.round(cant/sug*100)}%)`})
      else if(sug>0&&cant<sug*0.5)obs.push({sku:i.sku,n:"info",t:`${nom}: pides ${fN(cant)}, menos de la mitad de lo sugerido (${fN(sug)})`})
      const cdS=(sucursales||[]).find(x=>x.es_cd)?.id;const cdQ=cdS?Math.max(0,Number((r.stock_tienda||{})[cdS])||0):0
      if(cdS&&destinoSucursal&&destinoSucursal!==cdS&&cdQ>0)obs.push({sku:i.sku,n:"alerta",t:`${nom}: el CD tiene ${fN(cdQ)} u; para una OC con destino a tienda conviene trasladar antes de comprar`})
      const dem=Number(r.demanda_dia)||0
      if(dem>0&&r.estado==="Reposición"&&!(sug>0&&cant>sug*1.5)){const dias=((Number(r.posicion)||0)+cant)/dem;const tope=((Number(r.periodo_cubrir)||90)+(Number(r.lead_time_dias)||30)+(Number(r.dias_emergencia)||5))*1.5;if(dias>tope)obs.push({sku:i.sku,n:"alerta",t:`${nom}: dejaría ${Math.round(dias)} días de cobertura (el máximo razonable es ${Math.round(tope)})`})}
      if(!isI){const c0=Number(r.costo_unitario)||0,c=Number(i.costo_unitario)||0;if(c0>0&&c>0&&Math.abs(c-c0)/c0>0.25)obs.push({sku:i.sku,n:"alerta",t:`${nom}: costo ${fmt(c)} contra ${fmt(c0)} en inventario (${Math.round((c-c0)/c0*100)}%)`})}
      if(r.proveedor_id&&prov&&r.proveedor_id!==prov)obs.push({sku:i.sku,n:"info",t:`${nom}: habitualmente se compra a ${r.proveedor_nombre||r.proveedor_id}`})
    })
    return obs
  }
  const obsCompra=controlarCompra()
  const obsPorSku=obsCompra.reduce((m,o)=>{if(o.sku)(m[o.sku]=m[o.sku]||[]).push(o);return m},{})
  const total=allItems.reduce((s,i)=>s+((i.cp||i.cantidad||0)*(i.costo_unitario||0)),0)
  const aplicaIVA=tipo==="Nacional"
  const totalNeto=aplicaIVA?total:0
  const ivaMonto=aplicaIVA?Math.round(total*0.19):0
  const totalConIVA=aplicaIVA?Math.round(total*1.19):total
  const sp=provs.find(p=>p.id===prov)
  // Fase 0: en importación, el costo traído desde Reposición (pesos BSALE) se reemplaza por el último FOB USD pagado por SKU;
  //    los SKUs sin historial quedan bloqueados hasta ingresar su FOB.
  useEffect(()=>{
    const items=Object.values(cart)
    if(!isI){
      if(items.some(i=>i.costo_usd_ok&&i.costo_clp_ref!=null))setCart(p=>{const n={...p};for(const k of Object.keys(n)){const it=n[k];if(it.costo_usd_ok&&it.costo_clp_ref!=null)n[k]={...it,costo_unitario:it.costo_clp_ref,costo_original:it.costo_clp_ref,costo_modificado:false,costo_usd_ok:false,costo_clp_ref:undefined}}return n})
      return
    }
    const pend=items.filter(i=>!i.costo_usd_ok)
    if(!pend.length)return
    let cancel=false
    ;(async()=>{
      const impIds=(ocs||[]).filter(o=>o.tipo_oc==="Importación"&&!["Rechazada","Anulada"].includes(o.estado)&&(o.total_usd||0)<5000000).map(o=>o.id)
      if(!impIds.length)return
      const{data}=await supabase.from('oc_items').select('sku,costo_unitario,oc_id').in('oc_id',impIds).in('sku',pend.map(i=>i.sku))
      if(cancel||!data)return
      const fechaOC={};(ocs||[]).forEach(o=>{fechaOC[o.id]=o.fecha_creacion||""})
      const ult={}
      data.forEach(r=>{const c=Number(r.costo_unitario)||0;if(c<=0||c>=1000)return;const f=fechaOC[r.oc_id]||"";if(!ult[r.sku]||f>ult[r.sku].f)ult[r.sku]={c,f}})
      setCart(p=>{const n={...p};for(const k of Object.keys(n)){const it=n[k];if(it.costo_usd_ok)continue;const u=ult[it.sku];if(u)n[k]={...it,costo_clp_ref:it.costo_clp_ref??it.costo_unitario,costo_unitario:u.c,costo_original:u.c,costo_modificado:false,costo_usd_ok:true}}return n})
    })()
    return()=>{cancel=true}
  },[isI,Object.keys(cart).join(",")])

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

  const submit=async(borrador=false)=>{
    // Validar que porcentajes sumen 100
    if(totalPct!==100){alert(`⚠ Los porcentajes del plan de pago suman ${totalPct}% en vez de 100%. Ajusta antes de enviar.`);return}
    // Fase 0: en importación el costo debe ser FOB en USD (antes se guardaban pesos como dólares)
    if(isI){
      const sinCosto=allItems.filter(i=>!(Number(i.costo_unitario)>0))
      if(sinCosto.length){alert(`⚠ OC de importación: ${sinCosto.length} producto(s) sin costo FOB en USD. Ingresa el precio de la proforma del proveedor.`);return}
      const enPesos=sel.filter(i=>!i.costo_usd_ok)
      if(enPesos.length){alert(`⚠ ${enPesos.length} producto(s) vienen de Reposición con el costo promedio BSALE en PESOS (ej. ${enPesos[0].producto}).\n\nEn importación ingresa el costo FOB en USD de cada uno en la columna de costo.`);return}
      const altos=allItems.filter(i=>Number(i.costo_unitario)>=1000)
      if(altos.length&&!window.confirm(`⚠ ${altos.length} producto(s) con costo unitario de USD 1.000 o más (ej. ${altos[0].producto}: USD ${fN(altos[0].costo_unitario)}).\n\n¿Confirmas que esos valores están en dólares y no en pesos?`))return
    }
    // 18-oct-2026: controles de compra contra el cálculo de reposición
    const obsControl=controlarCompra()
    const alertasControl=obsControl.filter(o=>o.n==="alerta")
    if(alertasControl.length&&!borrador){
      const lista=alertasControl.slice(0,10).map(o=>`• ${o.t}`).join("\n")
      if(!window.confirm(`⚠ ${alertasControl.length} observación(es) de control antes de enviar:\n\n${lista}${alertasControl.length>10?`\n… y ${alertasControl.length-10} más`:""}\n\nQuedarán registradas en el historial para quien apruebe.\n¿Enviar de todas formas? (Cancelar para corregir)`))return
    }
    // ⭐ Detectar costos modificados y preguntar si actualizar en productos
    const costosModificados=isI?[]:sel.filter(i=>i.costo_modificado&&i.sku&&!i.sku.startsWith("MANUAL-"))
    let actualizarCostosBD=false
    if(costosModificados.length>0){
      const lista=costosModificados.slice(0,8).map(i=>`• ${i.producto}: ${fmt(i.costo_original||0)} → ${fmt(i.costo_unitario)}`).join("\n")
      actualizarCostosBD=window.confirm(`✏ Modificaste el costo de ${costosModificados.length} producto(s).\n\n${lista}\n\n¿Actualizar el costo en la base de datos para futuras OCs?\n\n• OK → actualiza el costo del SKU\n• Cancelar → solo aplica a esta OC`)
    }
    setSaving(true);const id=await nextNum()
    const condPago=medioPago==="contado"?"Contado":(numCuotas>1?`${numCuotas} cuotas`:`Crédito ${diasCredito} días`)
    // ⭐ Para importación: total = suma en USD, convertir a CLP. Para nacional: total = CLP directo
    const totalUSD=isI?Math.round(total):0
    const totalCLP=isI?Math.round(total*TC_USD):totalConIVA
    const oc={id,fecha_creacion:hoy(),solicitante_id:cu.id,proveedor_id:prov,tipo_oc:tipo,estado:borrador?"Borrador":"Pend. Dir. Negocios",fase_actual:borrador?0:1,total_clp:totalCLP,total_usd:totalUSD,total_neto:aplicaIVA?Math.round(total):0,iva_monto:ivaMonto,aplica_iva:aplicaIVA,condicion_pago:condPago,pct_fab:isI?(cuotas.find(c=>c.concepto.toLowerCase().includes("fabri"))?.pct||0):0,pct_embarque:isI?(cuotas.find(c=>c.concepto.toLowerCase().includes("embar"))?.pct||0):0,pct_puerto:isI?(cuotas.find(c=>c.concepto.toLowerCase().includes("puerto")||c.concepto.toLowerCase().includes("saldo"))?.pct||0):0,fecha_estimada:fEst||null,estado_pago:"Pago pend.",notas,destino_sucursal_id:destinoSucursal||null}
    const{error}=await supabase.from('ordenes_compra').insert(oc)
    if(error){alert("Error al crear OC: "+error.message);setSaving(false);return}
    // ⭐ Items con SKU único aunque haya varios manuales (index asegura unicidad)
    const items=allItems.map((i,idx)=>({id:uid(),oc_id:id,sku:i.sku||`MANUAL-${Date.now()}-${idx}`,producto:i.producto,cantidad_sugerida:i.reposicion_necesaria||0,cantidad_pedida:i.cp||i.cantidad||0,costo_unitario:i.costo_unitario||0}))
    const{error:itemsErr}=await supabase.from('oc_items').insert(items)
    if(itemsErr){
      // Rollback: borrar la OC recién creada
      await supabase.from('ordenes_compra').delete().eq('id',id)
      alert(`Error al guardar productos de la OC: ${itemsErr.message}\n\nLa OC fue revertida. Verifica los productos e intenta de nuevo.`)
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
    await addFirma(id,`${borrador?"Borrador creado":"Solicitud creada"} con ${items.length} producto(s)${obsControl.length?` · Controles de compra: ${alertasControl.length} alerta(s), ${obsControl.length-alertasControl.length} aviso(s)${alertasControl.length?" — "+alertasControl.slice(0,4).map(o=>o.t).join("; ").slice(0,380):""}`:" · Controles de compra: sin observaciones"}`)
    // ⭐ Notificar a Dir. Negocios que hay una OC pendiente de su aprobación (un borrador no notifica)
    if(notificarFlujo&&!borrador){
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

  if(done)return<div style={{textAlign:"center",padding:"60px 20px"}}><div style={{width:64,height:64,borderRadius:32,background:"#1E7A4420",margin:"0 auto 16px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>✓</div><div style={{fontSize:22,fontWeight:800,fontFamily:"monospace"}}>{done.id}</div><div style={{fontSize:14,color:"#6E6E73",marginBottom:20}}>Solicitud enviada a Dir. Negocios</div><Bt v="pri" onClick={()=>{setDone(null);goOC()}} ic="📋">Ver órdenes</Bt></div>

  return<div style={{width:"100%"}}>
    <div style={{background:"#fff",borderRadius:12,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
      <div style={{background:"linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)",color:"#fff",padding:"24px 32px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.5)",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>Outlet de Puertas SpA</div><div style={{fontSize:20,fontWeight:800}}>SOLICITUD DE ORDEN DE COMPRA</div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"rgba(255,255,255,0.4)",textTransform:"uppercase"}}>Fecha</div><div style={{fontSize:18,fontWeight:700}}>{hoy()}</div></div>
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
                {sucursales.filter(s=>s.activo!==false&&!["suc-web","suc-admin"].includes(s.id)).map(s=><option key={s.id} value={s.id}>{s.nombre}{s.es_cd?" (Centro Distribución)":""}</option>)}
              </select>
              {(()=>{const suc=sucursales.find(s=>s.id===destinoSucursal);return suc&&!suc.es_cd?<div style={{fontSize:11,color:"#B25E09",marginTop:4,fontWeight:600}}>⚠ Entrega directa a sucursal · no pasa por CD Maipú</div>:null})()}
            </Fl>
            <Fl l="Observaciones"><textarea value={notas} onChange={e=>setNotas(e.target.value)} rows={2} style={{...css.input,resize:"vertical"}}/></Fl>
          </div>
        </div>

        {/* ⭐ Plan de Pago */}
        {prov&&<div style={{background:"#F9FAFB",borderRadius:10,padding:"16px 20px",marginBottom:20,border:"1px solid #E5E7EB"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1C1C1E",marginBottom:12,display:"flex",alignItems:"center",gap:6}}>💰 Plan de pago
            {totalPct!==100&&<span style={{fontSize:12,color:"#B42318",fontWeight:600}}>⚠ Suma {totalPct}% (debe ser 100%)</span>}
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
            <thead><tr style={{background:"#F4F5F7"}}>
              <th style={{padding:"6px 8px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73",borderBottom:"2px solid #E5E7EB"}}>Concepto</th>
              <th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:700,borderBottom:"2px solid #E5E7EB",width:80}}>%</th>
              <th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:700,borderBottom:"2px solid #E5E7EB",width:120}}>Monto estimado</th>
              <th style={{padding:"6px",fontSize:11,fontWeight:700,borderBottom:"2px solid #E5E7EB",width:150}}>Fecha programada</th>
            </tr></thead>
            <tbody>{cuotas.map((c,i)=>{
              const moneda=sp?.moneda||"CLP"
              const montoEst=Math.round(total*(c.pct||0)/100)
              return<tr key={i} style={{borderBottom:"1px solid #F4F5F7"}}>
                <td style={{padding:"6px 8px"}}><input value={c.concepto} onChange={e=>updCuota(i,"concepto",e.target.value)} style={{...css.input,padding:"5px 8px",fontSize:12}} placeholder="Ej: Anticipo fabricación"/></td>
                <td style={{padding:"6px"}}><input type="number" min={0} max={100} value={c.pct} onChange={e=>updCuota(i,"pct",Number(e.target.value))} style={{...css.input,padding:"5px 8px",fontSize:12,width:60,textAlign:"right"}}/></td>
                <td style={{padding:"6px",textAlign:"right",fontWeight:600,color:moneda==="USD"?"#1E7A44":"#1D4E89"}}>{moneda==="USD"?fU(montoEst):fmt(montoEst)}</td>
                <td style={{padding:"6px"}}><input type="date" value={c.fecha||""} onChange={e=>updCuota(i,"fecha",e.target.value)} style={{...css.input,padding:"5px 8px",fontSize:12}}/></td>
              </tr>
            })}</tbody>
            <tfoot><tr style={{background:"#F8F8FA"}}>
              <td style={{padding:"8px",fontWeight:700}}>TOTAL</td>
              <td style={{padding:"8px",textAlign:"right",fontWeight:700,color:totalPct===100?"#1E7A44":"#B42318"}}>{totalPct}%</td>
              <td style={{padding:"8px",textAlign:"right",fontWeight:700}}>{sp?.moneda==="USD"?fU(total):fmt(total)}</td>
              <td></td>
            </tr></tfoot>
          </table>
        </div>}

        {/* Products from Reposición */}
        {sel.length>0&&<><div style={{fontSize:12,fontWeight:700,color:"#1D4E89",textTransform:"uppercase",marginBottom:6}}>Productos desde reposición ({sel.length}){obsCompra.some(o=>o.n==="alerta")&&<span style={{marginLeft:10,textTransform:"none",color:"#92400E",fontWeight:600}}>· ⚠ {obsCompra.filter(o=>o.n==="alerta").length} alerta(s) de control: revisa las líneas marcadas</span>}</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:16}}>
          <thead><tr style={{background:"#F8F8FA"}}><th style={{padding:"8px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73",borderBottom:"2px solid #E5E7EB"}}>Producto</th><th style={{padding:"8px",textAlign:"right",fontSize:11,fontWeight:700,borderBottom:"2px solid #E5E7EB"}}>Cantidad</th><th style={{padding:"8px",textAlign:"right",fontSize:11,fontWeight:700,borderBottom:"2px solid #E5E7EB"}}>Costo U.</th><th style={{padding:"8px",textAlign:"right",fontSize:11,fontWeight:700,borderBottom:"2px solid #E5E7EB"}}>Subtotal</th><th style={{padding:"8px",borderBottom:"2px solid #E5E7EB",width:36}}></th></tr></thead>
          <tbody>{sel.map((i,idx)=><tr key={idx} style={{borderBottom:"1px solid #F4F5F7"}}>
            <td style={{padding:"8px"}}><div style={{fontWeight:600}}>{i.producto}</div><div style={{fontSize:11,color:"#AEAEB2"}}>{i.sku}</div>{obsPorSku[i.sku]?.length>0&&(()=>{const ob=obsPorSku[i.sku];const al=ob.some(o=>o.n==="alerta");return <div title={ob.map(o=>o.t).join("\n")} style={{display:"inline-block",marginTop:4,fontSize:11.5,fontWeight:600,padding:"2px 8px",borderRadius:6,background:al?"#FFFBEB":"#F3F4F6",color:al?"#92400E":"#6B7280",border:"1px solid "+(al?"#F5C77E":"#E5E7EB")}}>{al?"⚠":"ⓘ"} {ob[0].t.split(": ").slice(1).join(": ")}{ob.length>1?` (+${ob.length-1})`:""}</div>})()}</td>
            <td style={{padding:"8px",textAlign:"right"}}>
              <input type="number" min={0} value={i.cp||0}
                onChange={e=>setCart(p=>({...p,[i.sku]:{...p[i.sku],cp:Math.max(0,Number(e.target.value))}}))}
                style={{...css.input,padding:"5px 8px",fontSize:12,width:70,textAlign:"center",fontWeight:700,borderColor:"#1D4E89",color:"#1D4E89"}}/>
            </td>
            <td style={{padding:"8px",textAlign:"right"}}>
              <input type="number" min={0} step="any" value={i.costo_unitario||0} onChange={e=>setCosto(i.sku,e.target.value)}
                style={{...css.input,padding:"5px 8px",fontSize:12,width:90,textAlign:"right",
                  borderColor:i.costo_modificado?"#B25E09":((i.costo_unitario||0)===0?"#B4231860":"#E5E7EB"),
                  background:i.costo_modificado?"#FFF8EC":((i.costo_unitario||0)===0?"#FFEEEE":"#fff")}}
                title={i.costo_modificado?`Original: ${tipo==="Importación"?fUD(i.costo_original):fmt(i.costo_original)}`:((i.costo_unitario||0)===0?"⚠ Costo en $0":"Costo unitario")}/>
              {i.costo_modificado&&<div style={{fontSize:10.5,color:"#B25E09",marginTop:2,fontWeight:600}}>✏ modificado</div>}
            </td>
            <td style={{padding:"8px",textAlign:"right",fontWeight:600}}>{tipo==="Importación"?fU(i.cp*(i.costo_unitario||0)):fmt(i.cp*(i.costo_unitario||0))}</td>
            <td style={{padding:"4px",textAlign:"center"}}>
              <button onClick={()=>setCart(p=>{const n={...p};delete n[i.sku];return n})} title="Eliminar"
                style={{background:"#B4231815",border:"none",borderRadius:6,color:"#B42318",cursor:"pointer",padding:"4px 8px",fontSize:13,fontWeight:700}}>✕</button>
            </td>
          </tr>)}</tbody>
        </table></>}

        {/* Manual products + Import Excel */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:6}}>
          <div style={{fontSize:12,fontWeight:700,color:"#5B2C6F",textTransform:"uppercase"}}>Productos manuales ({manualItems.length})</div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setCargaMasiva(true)} style={{padding:"6px 14px",borderRadius:6,fontSize:12,fontWeight:600,background:"#fff",color:"#16213E",border:"1px solid #D1D5DB",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>📥 Carga masiva</button>
            <button onClick={addManual} style={{padding:"6px 14px",borderRadius:6,fontSize:12,fontWeight:600,background:"#16213E",color:"#fff",border:"none",cursor:"pointer"}}>+ Agregar producto</button>
          </div>
        </div>
        {cargaMasiva&&<CargaMasivaOC v2App={v2App} enOC={sel.map(i=>i.sku)} onPlantillaAntigua={processOCExcel} onClose={()=>setCargaMasiva(false)} onAplicar={(items,origen)=>{
          setManualItems(prev=>{const m=new Map(prev.map(i=>[String(i.sku||i.id).trim().toUpperCase(),i]));items.forEach(it=>{const kk=String(it.sku).trim().toUpperCase();const ex=m.get(kk);m.set(kk,ex?{...ex,cantidad:it.cantidad,costo_unitario:it.costo_unitario||ex.costo_unitario,producto:it.producto,tipo_producto:it.tipo_producto||ex.tipo_producto}:it)});return[...m.values()]})
          setNotas(prev=>{const ref=`Carga masiva: ${items.length} productos (${origen})`;return prev?prev+"\n"+ref:ref})}}/>}

        {/* ⭐ Panel preview importación Excel */}
        {showImport&&importData&&<div style={{background:"#F0F8FF",borderRadius:12,border:"2px solid #1D4E8940",padding:"16px",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:"#1D4E89"}}>📎 Importación desde Excel</div>
              <div style={{fontSize:12,color:"#6E6E73",marginTop:2}}>OC #{importData.ocNum} · {importData.productos.length} productos · {fU(importData.totalUSD)}</div>
            </div>
            <button onClick={()=>{setShowImport(false);setImportData(null)}} style={{padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:600,background:"#B4231815",color:"#B42318",border:"none",cursor:"pointer"}}>✕ Cancelar</button>
          </div>

          {/* Proveedor match */}
          <div style={{background:"#fff",borderRadius:8,padding:"10px 12px",marginBottom:10,border:"1px solid #E5E7EB"}}>
            <div style={{fontSize:12,fontWeight:700,color:"#6E6E73",marginBottom:4}}>PROVEEDOR DEL EXCEL</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:13,fontWeight:600}}>{importData.provNombre}</div>
              {importData.provMatch?
                <span style={{fontSize:12,fontWeight:700,color:"#1E7A44",background:"#1E7A4415",padding:"3px 8px",borderRadius:4}}>✓ Match: {importData.provMatch.nombre}</span>:
                <span style={{fontSize:12,fontWeight:700,color:"#B25E09",background:"#B25E0915",padding:"3px 8px",borderRadius:4}}>🆕 Proveedor no encontrado en BD</span>
              }
            </div>
            {importData.solicitante&&<div style={{fontSize:12,color:"#6E6E73",marginTop:3}}>Solicitante: {importData.solicitante} · Estado original: {importData.estado||"—"}</div>}
          </div>

          {/* Resumen de matching productos */}
          {(()=>{
            const exact=importData.productos.filter(p=>p.match==="exact").length
            const fuzzy=importData.productos.filter(p=>p.match==="fuzzy").length
            const nuevo=importData.productos.filter(p=>p.match==="new").length
            const conCant=importData.productos.filter(p=>p.cantidad>0).length
            const sinCant=importData.productos.filter(p=>p.cantidad===0).length
            return<div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              <span style={{fontSize:12,fontWeight:700,color:"#1E7A44",background:"#1E7A4415",padding:"4px 10px",borderRadius:6}}>✅ {exact} exactos</span>
              {fuzzy>0&&<span style={{fontSize:12,fontWeight:700,color:"#B25E09",background:"#B25E0915",padding:"4px 10px",borderRadius:6}}>⚠ {fuzzy} aprox.</span>}
              {nuevo>0&&<span style={{fontSize:12,fontWeight:700,color:"#1D4E89",background:"#1D4E8915",padding:"4px 10px",borderRadius:6}}>🆕 {nuevo} nuevos</span>}
              {sinCant>0&&<span style={{fontSize:12,fontWeight:700,color:"#6E6E73",background:"#F4F5F7",padding:"4px 10px",borderRadius:6}}>⊘ {sinCant} sin cantidad</span>}
              <span style={{fontSize:12,fontWeight:700,color:"#1C1C1E",background:"#F4F5F7",padding:"4px 10px",borderRadius:6}}>{conCant} a cargar</span>
            </div>
          })()}

          {/* Tabla de productos */}
          <div style={{maxHeight:350,overflowY:"auto",borderRadius:8,border:"1px solid #E5E7EB"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead style={{position:"sticky",top:0,zIndex:2}}><tr style={{background:"#F8F8FA"}}>
                <th style={{padding:"6px 8px",textAlign:"left",fontSize:10.5,fontWeight:700,color:"#6E6E73"}}>Match</th>
                <th style={{padding:"6px 8px",textAlign:"left",fontSize:10.5,fontWeight:700,color:"#6E6E73"}}>Producto</th>
                <th style={{padding:"6px 8px",textAlign:"left",fontSize:10.5,fontWeight:700,color:"#6E6E73"}}>SKU</th>
                <th style={{padding:"6px 8px",textAlign:"left",fontSize:10.5,fontWeight:700,color:"#6E6E73",minWidth:120}}>Tipo/Categoría</th>
                <th style={{padding:"6px 8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#6E6E73"}}>Cant.</th>
                <th style={{padding:"6px 8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#6E6E73"}}>Costo U.</th>
                <th style={{padding:"6px 8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#6E6E73"}}>Total</th>
              </tr></thead>
              <tbody>{importData.productos.map((p,i)=>{
                const mc=p.match==="exact"?"#1E7A44":p.match==="fuzzy"?"#B25E09":"#1D4E89"
                const ml=p.match==="exact"?"✅":p.match==="fuzzy"?"⚠":"🆕"
                return<tr key={i} style={{borderBottom:"1px solid #F4F5F7",background:p.cantidad===0?"#F8F8FA":"#fff",opacity:p.cantidad===0?0.5:1}}>
                  <td style={{padding:"5px 8px"}}><span style={{fontSize:11,fontWeight:700,color:mc,background:mc+"15",padding:"2px 6px",borderRadius:4}}>{ml}</span></td>
                  <td style={{padding:"5px 8px"}}>
                    <div style={{fontWeight:600,fontSize:12}}>{p.producto}</div>
                    {p.match==="fuzzy"&&p.bdNombre&&<div style={{fontSize:10.5,color:"#B25E09"}}>≈ BD: {p.bdNombre}</div>}
                  </td>
                  <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:11,color:"#6E6E73"}}>{p.sku}</td>
                  <td style={{padding:"5px 8px"}}>
                    {p.match==="new"?
                      <select value={p.tipo_producto} onChange={e=>{const np=[...importData.productos];np[i]={...np[i],tipo_producto:e.target.value};setImportData({...importData,productos:np})}} style={{...css.select,fontSize:11,padding:"3px 4px",width:"100%"}}>
                        <option value="">— Seleccionar —</option>
                        {(importData.tipos||[]).map(t=><option key={t} value={t}>{t}</option>)}
                      </select>:
                      <span style={{fontSize:11,color:"#6E6E73"}}>{p.tipo_producto||"—"}</span>
                    }
                  </td>
                  <td style={{padding:"5px 8px",textAlign:"right",fontWeight:600,color:p.cantidad>0?"#1D4E89":"#AEAEB2"}}>{fN(p.cantidad)}</td>
                  <td style={{padding:"5px 8px",textAlign:"right",color:"#6E6E73"}}>{fU(p.costo_unitario)}</td>
                  <td style={{padding:"5px 8px",textAlign:"right",fontWeight:600}}>{p.cantidad>0?fU(p.total):"—"}</td>
                </tr>
              })}</tbody>
            </table>
          </div>

          {/* Footer con acción */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12}}>
            <div style={{fontSize:13,fontWeight:700,color:"#1E7A44"}}>{fU(importData.totalUSD)} total · {importData.productos.filter(p=>p.cantidad>0).length} productos a cargar</div>
            <Bt v="pri" onClick={aplicarImport} ic="✓">Cargar {importData.productos.filter(p=>p.cantidad>0).length} productos a la OC</Bt>
          </div>
        </div>}

        {manualItems.length>0&&<table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:12}}>
          <thead><tr style={{background:"#5B2C6F08"}}><th style={{padding:"6px",textAlign:"left",fontSize:11,fontWeight:700,color:"#5B2C6F",borderBottom:"1px solid #5B2C6F30"}}>Producto</th><th style={{padding:"6px",fontSize:11,fontWeight:700,color:"#5B2C6F",borderBottom:"1px solid #5B2C6F30"}}>SKU</th><th style={{padding:"6px",fontSize:11,fontWeight:700,color:"#5B2C6F",borderBottom:"1px solid #5B2C6F30"}}>Tipo</th><th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:700,borderBottom:"1px solid #5B2C6F30"}}>Cant.</th><th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:700,borderBottom:"1px solid #5B2C6F30"}}>Costo U.</th><th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:700,borderBottom:"1px solid #5B2C6F30"}}>Subtotal</th><th style={{width:30,borderBottom:"1px solid #5B2C6F30"}}></th></tr></thead>
          <tbody>{manualItems.map(i=><tr key={i.id} style={{borderBottom:"1px solid #F4F5F7"}}>
            <td style={{padding:"4px"}}><input value={i.producto} onChange={e=>updManual(i.id,"producto",e.target.value)} placeholder="Nombre..." style={{...css.input,padding:"6px 8px",fontSize:12}}/></td>
            <td style={{padding:"4px"}}><input value={i.sku} onChange={e=>updManual(i.id,"sku",e.target.value)} placeholder="SKU..." style={{...css.input,padding:"6px 8px",fontSize:12,width:100}}/></td>
            <td style={{padding:"4px"}}><input value={i.tipo_producto} onChange={e=>updManual(i.id,"tipo_producto",e.target.value)} placeholder="Tipo..." style={{...css.input,padding:"6px 8px",fontSize:12,width:100}}/></td>
            <td style={{padding:"4px"}}><input type="number" value={i.cantidad} onChange={e=>updManual(i.id,"cantidad",Number(e.target.value))} style={{...css.input,padding:"6px 8px",fontSize:12,width:70,textAlign:"right"}}/></td>
            <td style={{padding:"4px"}}><input type="number" value={i.costo_unitario} onChange={e=>updManual(i.id,"costo_unitario",Number(e.target.value))} style={{...css.input,padding:"6px 8px",fontSize:12,width:80,textAlign:"right"}}/></td>
            <td style={{padding:"4px",textAlign:"right",fontWeight:600}}>{tipo==="Importación"?fU(i.cantidad*i.costo_unitario):fmt(i.cantidad*i.costo_unitario)}</td>
            <td style={{padding:"4px"}}><button onClick={()=>delManual(i.id)} style={{background:"#B4231812",color:"#B42318",border:"none",borderRadius:4,padding:"4px 6px",cursor:"pointer",fontSize:11}}>✕</button></td>
          </tr>)}</tbody>
        </table>}
        {manualItems.length===0&&sel.length===0&&<div style={{textAlign:"center",padding:20,color:"#6E6E73",fontSize:13}}>Agrega productos desde Reposición o manualmente con el botón "Agregar producto"</div>}

        <div style={{borderTop:"2px solid #1C1C1E",paddingTop:12,marginTop:8}}>
          {isI
            ?<div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
              <span style={{fontSize:16,fontWeight:700}}>TOTAL ORDEN</span>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:22,fontWeight:800,color:"#1E7A44"}}>{fU(total)}</div>
                <div style={{fontSize:13,color:"#6E6E73"}}>≈ {fmt(Math.round(total*TC_USD))} (TC ${fN(TC_USD)})</div>
              </div>
            </div>
            :<div style={{display:"flex",flexDirection:"column",gap:4}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#6E6E73"}}>
                <span>Valor neto</span><span>{fmt(total)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#6E6E73"}}>
                <span>IVA (19%)</span><span>{fmt(ivaMonto)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",borderTop:"1px solid #E5E7EB",paddingTop:8,marginTop:4}}>
                <span style={{fontSize:16,fontWeight:700}}>TOTAL CON IVA</span>
                <span style={{fontSize:22,fontWeight:800}}>{fmt(totalConIVA)}</span>
              </div>
            </div>
          }
        </div>
      </div>
      <div style={{borderTop:"1px solid #E5E7EB",padding:"16px 32px",background:"#FAFAFA"}}><div style={{display:"flex",alignItems:"center",gap:12}}><Av n={cu?.avatar} c={rl(cu).c} sz={40}/><div><div style={{fontSize:16,fontStyle:"italic",fontWeight:700,color:rl(cu).c}}>{cu?.firma_digital||cu?.nombre}</div><div style={{fontSize:12,color:"#AEAEB2"}}>{rl(cu).l} — {hoy()} {hora()}</div></div></div></div>
    </div>
    {obsCompra.length>0&&<div style={{marginTop:14,border:"1px solid "+(obsCompra.some(o=>o.n==="alerta")?"#F5C77E":"#E5E7EB"),background:obsCompra.some(o=>o.n==="alerta")?"#FFFBEB":"#F9FAFB",borderRadius:10,padding:"10px 14px"}}>
      <div style={{fontSize:12,fontWeight:700,color:obsCompra.some(o=>o.n==="alerta")?"#92400E":"#374151",marginBottom:4}}>Controles de compra · {obsCompra.filter(o=>o.n==="alerta").length} alerta(s) · {obsCompra.filter(o=>o.n==="info").length} aviso(s)</div>
      <div style={{fontSize:11,color:"#6B7280",marginBottom:6}}>Contrastan cada línea con el cálculo de reposición. No bloquean el envío, pero quedan registrados en el historial para quien apruebe.</div>
      {obsCompra.slice(0,12).map((o,k)=><div key={k} style={{fontSize:12,color:o.n==="alerta"?"#92400E":"#6B7280",padding:"2px 0"}}>{o.n==="alerta"?"⚠":"ⓘ"} {o.t}</div>)}
      {obsCompra.length>12&&<div style={{fontSize:12,color:"#6B7280"}}>… y {obsCompra.length-12} más</div>}
    </div>}
    <div style={{marginTop:14}}><Bt v="pri" full dis={!prov||!fEst||saving||(sel.length===0&&manualItems.length===0)} onClick={()=>submit(false)} ic="✍️">{saving?"Procesando...":"Firmar y enviar solicitud"}</Bt><div style={{height:8}}/><Bt v="gry" full dis={!prov||saving||(sel.length===0&&manualItems.length===0)} onClick={()=>submit(true)} ic="✎">Guardar como borrador (no se envía a aprobación)</Bt></div>
  </div>
}

/* ═══ OC LIST — With admin edit/delete + notification log ═══ */
/* Fase 0 (decisión JP 17-oct-2026): una OC se cierra solo con documentos, factura, recepción completa y pagos pagados */
const validarCierreOC=async(oc)=>{
  const faltan=[]
  const[d,f,r,p]=await Promise.all([
    supabase.from('documentos_import').select('id',{count:'exact',head:true}).eq('oc_id',oc.id),
    supabase.from('libro_compras').select('id,anulado').eq('oc_id',oc.id),
    supabase.from('recepciones').select('id,tipo').eq('oc_id',oc.id),
    supabase.from('pagos').select('id,estado').eq('oc_id',oc.id),
  ])
  if(!((d.count||0)>0))faltan.push("documentos cargados en la OC")
  if(!(f.data||[]).some(x=>!x.anulado))faltan.push("factura vinculada del libro de compras")
  if(oc.estado!=="Recibida OK"||oc.recepcion_cuadrada===false||!(r.data||[]).some(x=>x.tipo==="guia"||x.tipo==="guia_factura"))faltan.push("recepción completa y cuadrada")
  const pg=p.data||[]
  if(!pg.length||pg.some(x=>x.estado!=="Pagado"))faltan.push("todos los pagos registrados como pagados")
  return faltan
}

/* 17-oct-2026: lista de trabajo para cerrar OC recibidas (documentos, factura, recepción y pagos) */
function CierrePanel({ocs,setDet}){
  const[abierto,setAbierto]=useState(false)
  const[rows,setRows]=useState(null)
  const[ruts,setRuts]=useState({})
  const[filtro,setFiltro]=useState("todas")
  const[cargando,setCargando]=useState(false)
  const cargar=async()=>{setCargando(true);try{const[c,r]=await Promise.all([supabase.from('v_cmp_cierre_oc').select('*').order('fecha_creacion',{ascending:false}),supabase.from('v_cmp_sugerencias_rut_proveedor').select('*')]);if(c.error)throw c.error;setRows(c.data||[]);const m={};(r.data||[]).forEach(x=>{m[x.proveedor_id]=x});setRuts(m)}catch(e){alert("No se pudo cargar la lista de cierre: "+e.message)}finally{setCargando(false)}}
  useEffect(()=>{if(abierto&&rows===null)cargar()},[abierto])
  const lista=(rows||[]).map(r=>{const falta=[];if(!(r.n_documentos>0))falta.push("documentos");if(!(r.n_facturas>0))falta.push("factura");if(!r.recepcion_ok)falta.push("recepción");if(!(r.n_pagos>0)||r.pagos_pendientes>0)falta.push("pagos");return{...r,falta}})
  const listas=lista.filter(r=>r.falta.length===0)
  const porFalta=k=>lista.filter(r=>r.falta.includes(k))
  const vis=filtro==="listas"?listas:filtro==="todas"?lista:porFalta(filtro)
  const asignarRut=async(sg)=>{if(!window.confirm(`¿Asignar el RUT ${sg.rut_sugerido} (${sg.razon_social}) a ${sg.nombre}?\n\nSimilitud de nombre: ${Math.round(sg.similitud*100)}%. Verifica que sea la misma empresa.`))return;const{error}=await supabase.from('proveedores').update({rut:sg.rut_sugerido}).eq('id',sg.proveedor_id);if(error){alert("No se guardó: "+error.message);return}cargar()}
  const ok=v=><span style={{color:v?"#1E7A44":"#B42318",fontWeight:700}}>{v?"✓":"✗"}</span>
  return <Cd s={{marginBottom:12,padding:"10px 14px"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>setAbierto(a=>!a)}>
      <div style={{fontSize:14,fontWeight:700,color:"#16213E"}}>Cierre de OC recibidas{rows?` · ${lista.length} recibidas · ${listas.length} listas para cerrar`:""}</div>
      <span style={{fontSize:12,color:"#6E6E73"}}>{abierto?"Ocultar ▲":"Ver ▼"}</span>
    </div>
    {abierto&&<div style={{marginTop:10}}>
      {cargando&&<div style={{fontSize:12,color:"#6E6E73"}}>Cargando…</div>}
      {rows&&<>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>{[["todas",`Todas (${lista.length})`],["listas",`Listas (${listas.length})`],["factura",`Falta factura (${porFalta("factura").length})`],["documentos",`Faltan documentos (${porFalta("documentos").length})`],["recepción",`Recepción (${porFalta("recepción").length})`],["pagos",`Pagos (${porFalta("pagos").length})`]].map(([k,l])=><button key={k} onClick={()=>setFiltro(k)} style={{padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:700,border:"1px solid "+(filtro===k?"#16213E":"#E5E7EB"),background:filtro===k?"#16213E":"#fff",color:filtro===k?"#fff":"#3A3A3C",cursor:"pointer"}}>{l}</button>)}</div>
        <div style={{fontSize:12,color:"#6E6E73",marginBottom:6}}>Mismas reglas que el botón Cerrar: documentos cargados, factura vinculada, recepción completa y todos los pagos pagados. Las facturas sugeridas se vinculan en la OC y los pagos se concilian en Finanzas.</div>
        <div style={{overflow:"auto",maxHeight:380}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{textAlign:"left",color:"#6E6E73",borderBottom:"1px solid #E5E7EB"}}><th style={{padding:"6px 4px"}}>OC</th><th>Proveedor</th><th>Estado</th><th>Docs</th><th>Factura</th><th>Recepción</th><th>Pagos</th><th>Falta</th></tr></thead>
          <tbody>{vis.length===0&&<tr><td colSpan={8} style={{padding:"14px 4px",color:"#6E6E73",fontSize:12.5}}>{filtro==="todas"?"No hay OC recibidas pendientes de cierre.":"No hay OC en este filtro."}</td></tr>}{vis.map(r=>{const sg=ruts[r.proveedor_id];const oc=ocs.find(o=>o.id===r.oc_id);return <tr key={r.oc_id} style={{borderBottom:"1px solid #F3F4F6",verticalAlign:"top"}}>
            <td style={{padding:"6px 4px"}}><button onClick={()=>oc&&setDet(oc)} style={{background:"none",border:"none",color:"#1D4ED8",fontWeight:700,cursor:"pointer",padding:0}}>{r.oc_id}</button></td>
            <td>{r.proveedor}{!(r.proveedor_rut&&/\d{6,}/.test(r.proveedor_rut))&&<div style={{fontSize:12,color:"#B25E09"}}>Sin RUT{sg?<> · sugerido {sg.rut_sugerido} ({sg.razon_social}, {Math.round(sg.similitud*100)}%) <button onClick={()=>asignarRut(sg)} style={{fontSize:11,padding:"1px 6px",border:"1px solid #B25E09",borderRadius:5,background:"#fff",color:"#B25E09",cursor:"pointer"}}>Asignar</button></>:""}</div>}</td>
            <td>{r.estado}</td>
            <td>{ok(r.n_documentos>0)}</td>
            <td>{ok(r.n_facturas>0)}{!(r.n_facturas>0)&&r.sug_facturas>0&&<div style={{fontSize:12,color:"#1D4ED8"}}>{r.sug_facturas} sugerida(s)</div>}</td>
            <td>{ok(r.recepcion_ok)}</td>
            <td>{r.n_pagos>0&&r.pagos_pendientes===0?ok(true):<span style={{color:"#B42318"}}>{r.n_pagos===0?"sin plan":`${r.pagos_pendientes} pend.`}</span>}</td>
            <td>{r.falta.length?<span style={{color:"#B42318"}}>{r.falta.join(", ")}</span>:<span style={{color:"#1E7A44",fontWeight:700}}>Lista para cerrar</span>}</td>
          </tr>})}</tbody>
        </table></div>
      </>}
    </div>}
  </Cd>
}

function OCListView({ocs,firmas,pagos,updOC,addFirma,setDet,cu,h,provs,setOcs,notificarFlujo,ROL_POR_ESTADO={}}){
  const[f,setF]=useLocalState("oc_filtro","Todas");const[deleting,setDeleting]=useState(null);const[notifLog,setNotifLog]=useState([])
  // ⭐ Fusión de OCs
  const[showFusion,setShowFusion]=useState(false)
  const[ocOrigen,setOcOrigen]=useState(null) // OC desde la que arranca la fusión
  const[fusionSel,setFusionSel]=useState([]) // ids de OCs adicionales a fusionar
  const[fusionEta,setFusionEta]=useState("")
  const[fusionCostos,setFusionCostos]=useState({}) // {sku: costo_editable}
  const[fusionItemsEdit,setFusionItemsEdit]=useState({}) // {sku: cantidad_editable}
  const[fusionSaving,setFusionSaving]=useState(false)
  const[fusionItemsBase,setFusionItemsBase]=useState([]) // items de todas las OCs cargados desde BD
  const[fTipo,setFTipo]=useLocalState("oc_filtro_tipo","T") // T | IMP | NAC
  const[fProv,setFProv]=useLocalState("oc_filtro_prov","") // proveedor_id
  const[qOC,setQOC]=useLocalState("oc_q","") // búsqueda texto libre
  // ⭐ Vista tabla Excel: toggle + orden + datos de documentos/facturas por OC
  const[vistaOC,setVistaOC]=useLocalState("oc_vista","lista") // lista | tabla
  const[sortOC,setSortOC]=useState({k:"fecha_creacion",dir:-1})
  const[tablaData,setTablaData]=useState({docs:new Map(),facs:new Map(),cost:new Map(),recs:new Map(),cargando:false,cargado:false})
  const docsOC=tablaData.docs,facsOC=tablaData.facs,costOC=tablaData.cost,recsOC=tablaData.recs
  useEffect(()=>{
    if(vistaOC!=="tabla"||tablaData.cargado)return
    let cancelado=false
    setTablaData(p=>({...p,cargando:true}))
    ;(async()=>{
      // ⭐ CRÍTICO: NO traer url_archivo aquí — los docs antiguos son base64 de varios MB
      //    y cargar todos juntos satura la BD (causó caída total el 14-jul).
      //    El archivo se descarga on-demand al hacer click (abrirDoc).
      const [docsR,facsR,ctsR,rcsR]=await Promise.all([
        supabase.from('documentos_import').select('id,oc_id,nombre_archivo,tipo_documento').limit(20000),
        supabase.from('libro_compras').select('id,folio,monto_total,oc_id,anulado').not('oc_id','is',null).limit(20000),
        supabase.from('costeos_oc').select('oc_id,tipo_costeo').limit(20000),
        supabase.from('recepciones').select('id,oc_id,tipo,numero_doc,archivo_url,archivo_nombre').limit(20000),
      ])
      if(cancelado)return
      const dm=new Map()
      for(const d of(docsR.data||[])){if(!d.oc_id)continue;if(!dm.has(d.oc_id))dm.set(d.oc_id,[]);dm.get(d.oc_id).push(d)}
      const fm=new Map()
      for(const fc of(facsR.data||[])){if(fc.anulado)continue;if(!fm.has(fc.oc_id))fm.set(fc.oc_id,[]);fm.get(fc.oc_id).push(fc)}
      const cm=new Map()
      for(const c of(ctsR.data||[])){if(!c.oc_id)continue;if(!cm.has(c.oc_id))cm.set(c.oc_id,new Set());cm.get(c.oc_id).add(c.tipo_costeo)}
      const rm=new Map()
      for(const r of(rcsR.data||[])){if(!r.oc_id)continue;if(!rm.has(r.oc_id))rm.set(r.oc_id,[]);rm.get(r.oc_id).push(r)}
      setTablaData({docs:dm,facs:fm,cost:cm,recs:rm,cargando:false,cargado:true})
    })()
    return()=>{cancelado=true}
  },[vistaOC,tablaData.cargado])
  const[commentOC,setCommentOC]=useState("");const[showComment,setShowComment]=useState(null)
  // ⭐ v48: Sheet de cancelación de OC (admin, cualquier estado)
  const[cancelSheet,setCancelSheet]=useState(null) // oc object
  const[cancelMotivo,setCancelMotivo]=useState("")
  const[cancelDetalle,setCancelDetalle]=useState("")
  const[cancelConfirmado,setCancelConfirmado]=useState(false)
  const[cancelPagos,setCancelPagos]=useState([])
  const[cancelSaving,setCancelSaving]=useState(false)
  const estados=["Todas","Pend. Dir. Negocios","Proyectar costeo","Pend. Dir. Finanzas","Pend. proveedor","Proforma OK","En fabricación","Embarcada","Internación","Validar costeo final","Transporte","Despacho nac.","Recibida OK","Cerrada"]
  const fil=ocs.filter(o=>{
    if(f!=="Todas"&&o.estado!==f)return false
    if(fTipo==="IMP"&&o.tipo_oc!=="Importación")return false
    if(fTipo==="NAC"&&o.tipo_oc!=="Nacional")return false
    if(fProv&&o.proveedor_id!==fProv)return false
    if(qOC){const q=qOC.toLowerCase();const pv=provs?.find(p=>p.id===o.proveedor_id);if(!o.id.toLowerCase().includes(q)&&!(pv?.nombre||"").toLowerCase().includes(q))return false}
    return true
  })
  const firma=async(oc,acc,nE,nF)=>{
    // Decisión JP 17-oct-2026: el analista crea y registra, los jefes aprueban y nadie aprueba su propia OC
    if((acc==="Aprobada Dir. Negocios"||acc==="Aprobada Finanzas")&&oc.solicitante_id&&oc.solicitante_id===cu?.id){alert(`⚠ No puedes aprobar ${oc.id} porque la creaste tú. Debe aprobarla otro jefe.`);return}
    const comment=commentOC.trim()
    // ⭐ v47: Comentario obligatorio en todas las transiciones
    if(!comment){alert("⚠ Debes ingresar un comentario para registrar esta acción.\n\nEl comentario quedará asociado a la firma y será visible en el historial.");return}
    // ⭐ v47: Costeo PROYECTADO obligatorio antes de avanzar de "Proyectar costeo" a "Pend. Dir. Finanzas"
    if(acc==="Costeo proyectado"){
      const{data:costeos,error:cErr}=await supabase.from('costeos_oc').select('id,tipo_costeo').eq('oc_id',oc.id).eq('tipo_costeo','proyectado').limit(1)
      if(cErr){alert("Error verificando costeos: "+cErr.message);return}
      if(!costeos||costeos.length===0){
        alert(`⚠ No puedes avanzar sin un costeo PROYECTADO registrado.\n\nLa OC ${oc.id} no tiene costeos proyectados anexados todavía.\n\nPasos:\n1. Abre el módulo "Costeo IMP" en el menú inferior\n2. Selecciona la OC ${oc.id}\n3. Completa los gastos y presioná "Anexar a OC"\n4. Vuelve acá y aprobá la transición`)
        return
      }
    }
    if(oc.reaprobacion_pendiente&&nE!=="Rechazada"){alert(`⚠ ${oc.id} tiene un cambio de ítems pendiente de re-aprobación. Primero deben re-aprobar Dir. Negocios y Dir. Finanzas.`);return}
    let excepcion=""
    if(nE==="Cerrada"){const faltan=await validarCierreOC(oc);if(faltan.length){if(cu?.rol==="admin"){const m=window.prompt(`Para cerrar ${oc.id} falta:\n• ${faltan.join("\n• ")}\n\nComo admin puedes cerrar por excepción. Escribe el motivo (mínimo 15 caracteres):`);if(!m||m.trim().length<15)return;excepcion=` · CIERRE POR EXCEPCIÓN (falta: ${faltan.join(", ")}) — motivo: ${m.trim()}`}else{alert(`No se puede cerrar ${oc.id}. Falta:\n• ${faltan.join("\n• ")}`);return}}}
    const accionFull=`${acc} — "${comment}"${excepcion}`
    const extra=acc==="Aprobada Finanzas"?{monto_aprobado_clp:oc.total_clp,monto_aprobado_usd:oc.total_usd,aprobacion_fin_fecha:new Date().toISOString()}:{}
    await addFirma(oc.id,accionFull);await updOC(oc.id,{estado:nE,fase_actual:nF??oc.fase_actual,...extra})
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
  // Fase 0: re-aprobación de cambios de ítems con la OC ya aprobada (no cambia el estado logístico)
  const reaprobar=async(oc,nivel)=>{
    if(oc.solicitante_id&&oc.solicitante_id===cu?.id){alert(`⚠ No puedes re-aprobar ${oc.id} porque la creaste tú. Debe hacerlo otro jefe.`);return}
    const comment=commentOC.trim()
    if(!comment){alert("⚠ Ingresa un comentario para registrar la re-aprobación.");return}
    const negOk=nivel==="neg"?cu.nombre:oc.reaprobacion_neg_por
    const finOk=nivel==="fin"?cu.nombre:oc.reaprobacion_fin_por
    const up=nivel==="neg"?{reaprobacion_neg_por:cu.nombre}:{reaprobacion_fin_por:cu.nombre}
    const completa=!!(negOk&&finOk)
    if(completa)Object.assign(up,{reaprobacion_pendiente:false,monto_aprobado_clp:oc.total_clp,monto_aprobado_usd:oc.total_usd,aprobacion_fin_fecha:new Date().toISOString()})
    await addFirma(oc.id,`Re-aprobación ${nivel==="neg"?"Dir. Negocios":"Dir. Finanzas"} del cambio de ítems — "${comment}"${completa?" · cambio aprobado, OC liberada":""}`)
    await updOC(oc.id,up)
    setCommentOC("");setShowComment(null)
  }
  // Decisión JP 17-oct-2026: borradores (no entran al flujo) y anulación distinta del rechazo
  const enviarAprobacion=async(oc)=>{
    if(!window.confirm(`¿Enviar ${oc.id} a aprobación de Dir. Negocios?`))return
    await addFirma(oc.id,"Borrador enviado a aprobación")
    await updOC(oc.id,{estado:"Pend. Dir. Negocios",fase_actual:1})
    if(notificarFlujo)await notificarFlujo({ocId:oc.id,tipo:"Email",nuevoEstado:"Pend. Dir. Negocios",rolDestino:"dir_negocios",asunto:`Nueva OC ${oc.id} requiere tu aprobación`,mensaje:`${cu?.nombre} envió a aprobación la orden de compra ${oc.id} por ${oc.tipo_oc==="Importación"?fU(oc.total_usd||0):fmt(oc.total_clp||0)}.\n\nhttps://outlet-compras.netlify.app`})
  }
  const descartarBorrador=async(oc)=>{
    const m=window.prompt(`Motivo para descartar el borrador ${oc.id} (queda como Anulada, no se borra):`)
    if(!m||m.trim().length<5)return
    await addFirma(oc.id,`Anulada — borrador descartado: "${m.trim()}"`)
    await updOC(oc.id,{estado:"Anulada"})
  }
  const isAdmin=cu?.rol==="admin"||cu?.rol==="dir_general"

  // ─── Helper: índice de estado en flujo IMP (para detectar el más avanzado) ───
  const idxEstado=(estado)=>{
    const orden=["Pend. Dir. Negocios","Proyectar costeo","Pend. Dir. Finanzas","Pend. proveedor","Proforma OK","En fabricación","Pago fabricación","Embarcada","Pago embarque","Internación","Validar costeo final","Transporte","Recibida parcial","Recibida OK","Cerrada"]
    const i=orden.indexOf(estado)
    return i>=0?i:0
  }

  // ─── Compatibilidad: mismo proveedor, IMP, no Cerrada/Rechazada/Dividida/Fusionada/madre ──
  const ocsCompatibles=(oc)=>ocs.filter(o=>
    o.id!==oc.id&&
    o.tipo_oc==="Importación"&&
    o.proveedor_id===oc.proveedor_id&&
    !["Cerrada","Rechazada","Anulada","Dividida","Fusionada"].includes(o.estado)&&
    !o.oc_tipo?.startsWith("madre")
  )

  const abrirFusion=async(oc)=>{
    setOcOrigen(oc)
    setFusionSel([])
    setFusionEta(oc.fecha_estimada||"")
    setFusionCostos({})
    setFusionItemsEdit({})
    // Cargar items de la OC origen
    const{data}=await supabase.from('oc_items').select('*').eq('oc_id',oc.id)
    setFusionItemsBase((data||[]).map(i=>({...i,_oc_id:oc.id,_oc_fecha:oc.fecha_creacion})))
    setShowFusion(true)
  }

  const toggleFusion=async(ocFusion)=>{
    if(fusionSel.includes(ocFusion.id)){
      setFusionSel(fusionSel.filter(x=>x!==ocFusion.id))
      setFusionItemsBase(fusionItemsBase.filter(i=>i._oc_id!==ocFusion.id))
    }else{
      setFusionSel([...fusionSel,ocFusion.id])
      const{data}=await supabase.from('oc_items').select('*').eq('oc_id',ocFusion.id)
      setFusionItemsBase([...fusionItemsBase,...(data||[]).map(i=>({...i,_oc_id:ocFusion.id,_oc_fecha:ocFusion.fecha_creacion}))])
    }
  }

  // ─── Consolidar items: sumar cantidades por SKU, costo del más reciente ───
  const consolidados=useMemo(()=>{
    const map={}
    fusionItemsBase.forEach(i=>{
      if(!map[i.sku])map[i.sku]={sku:i.sku,producto:i.producto,cantidad:0,costos:[],ocs:[]}
      map[i.sku].cantidad+=i.cantidad_pedida||0
      map[i.sku].costos.push({fecha:i._oc_fecha,costo:i.costo_unitario||0,oc:i._oc_id})
      map[i.sku].ocs.push(i._oc_id)
    })
    return Object.values(map).map(c=>{
      // Costo más reciente: ordenar por fecha desc
      c.costos.sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||""))
      c.costo_sugerido=c.costos[0]?.costo||0
      c.costo_final=fusionCostos[c.sku]!==undefined?fusionCostos[c.sku]:c.costo_sugerido
      c.cantidad_final=fusionItemsEdit[c.sku]!==undefined?fusionItemsEdit[c.sku]:c.cantidad
      c.duplicado=c.ocs.length>1
      c.subtotal=c.cantidad_final*c.costo_final
      return c
    })
  },[fusionItemsBase,fusionCostos,fusionItemsEdit])

  const ejecutarFusion=async()=>{
    if(!ocOrigen||fusionSel.length===0){alert("⚠ Selecciona al menos otra OC para fusionar");return}
    if(!fusionEta){alert("⚠ Define la ETA de la OC fusionada");return}

    const todasLasOCs=[ocOrigen,...ocs.filter(o=>fusionSel.includes(o.id))]
    // Estado más avanzado entre todas
    const estadoFinal=todasLasOCs.reduce((max,o)=>idxEstado(o.estado)>idxEstado(max)?o.estado:max,todasLasOCs[0].estado)
    const faseFinal=Math.max(...todasLasOCs.map(o=>o.fase_actual||0))

    // Generar correlativo formato OC-IMP-F0007-008
    const sufijos=todasLasOCs.map(o=>{
      const m=o.id.match(/\d+$/)
      return m?m[0].padStart(3,'0').slice(-3):"000"
    }).sort()
    const newId="OC-IMP-F"+sufijos.join("-")

    if(!window.confirm(`¿Fusionar ${todasLasOCs.length} OCs en una nueva?\n\nNueva OC: ${newId}\nEstado final: ${estadoFinal}\nTotal items consolidados: ${consolidados.length}\nETA: ${fusionEta}\n\nLas OCs originales pasarán a "Fusionada".`))return

    setFusionSaving(true)
    try{
      // Calcular totales
      const totalUSD=consolidados.reduce((s,c)=>s+c.subtotal,0)
      const TC=Number(consolidados.length>0?950:950) // se podría leer del config pero usamos referencia
      const totalCLP=Math.round(totalUSD*950)

      // Crear OC fusionada
      const newOC={
        id:newId,
        fecha_creacion:hoy(),
        solicitante_id:ocOrigen.solicitante_id,
        proveedor_id:ocOrigen.proveedor_id,
        tipo_oc:"Importación",
        estado:estadoFinal,
        fase_actual:faseFinal,
        condicion_pago:ocOrigen.condicion_pago,
        pct_fab:ocOrigen.pct_fab,
        pct_embarque:ocOrigen.pct_embarque,
        pct_puerto:ocOrigen.pct_puerto,
        total_usd:Math.round(totalUSD),
        total_clp:totalCLP,
        fecha_estimada:fusionEta,
        destino_sucursal_id:ocOrigen.destino_sucursal_id,
        notas:`OC fusionada de: ${todasLasOCs.map(o=>o.id).join(", ")}`+(ocOrigen.notas?"\n\n"+ocOrigen.notas:""),
        oc_tipo:"fusion",
        ocs_fusionadas:todasLasOCs.map(o=>o.id),
        estado_pago:"Pago pend."
      }
      const{error:eOC}=await supabase.from('ordenes_compra').insert(newOC)
      if(eOC){alert("Error creando OC fusionada: "+eOC.message);setFusionSaving(false);return}

      // Insertar items consolidados
      const newItems=consolidados.filter(c=>c.cantidad_final>0).map(c=>({
        id:uid(),oc_id:newId,sku:c.sku,producto:c.producto,
        cantidad_sugerida:0,
        cantidad_pedida:c.cantidad_final,
        costo_unitario:c.costo_final
      }))
      if(newItems.length>0)await supabase.from('oc_items').insert(newItems)

      // Migrar firmas de cada madre (con marca de origen)
      const firmasMadres=firmas.filter(f=>todasLasOCs.some(o=>o.id===f.oc_id))
      const firmasNuevas=firmasMadres.map(f=>({
        ...f,id:uid(),oc_id:newId,
        accion:f.accion+` (heredada de ${f.oc_id})`
      }))
      if(firmasNuevas.length>0)await supabase.from('firmas').insert(firmasNuevas)

      // Firma de evento de fusión
      await supabase.from('firmas').insert([{
        id:uid(),oc_id:newId,
        nombre_usuario:cu.nombre,rol_usuario:cu.rol,
        accion:`OC fusionada de ${todasLasOCs.map(o=>o.id).join(", ")} · ${consolidados.length} items consolidados · ETA ${fusionEta}`,
        fecha:hoy(),hora:hora()
      }])

      // Migrar pagos PAGADOS de cada madre
      const pagosPagados=pagos.filter(p=>todasLasOCs.some(o=>o.id===p.oc_id)&&p.estado==="Pagado")
      if(pagosPagados.length>0){
        const pagosNuevos=pagosPagados.map(p=>({
          ...p,id:uid(),oc_id:newId,
          concepto:p.concepto+` (migrado de ${p.oc_id})`
        }))
        await supabase.from('pagos').insert(pagosNuevos)
      }

      // Marcar madres como Fusionada
      for(const o of todasLasOCs){
        await updOC(o.id,{estado:"Fusionada",oc_tipo:"madre_fusion"})
        await addFirma(o.id,`OC fusionada en ${newId} junto con ${todasLasOCs.filter(x=>x.id!==o.id).map(x=>x.id).join(", ")} por ${cu.nombre}`)
      }

      setShowFusion(false);setFusionSaving(false)
      // Recargar OCs
      const{data:newOcs}=await supabase.from('ordenes_compra').select('*')
      setOcs(newOcs||[])
      alert(`✓ OCs fusionadas exitosamente.\n\nNueva OC: ${newId}\n${consolidados.length} items consolidados\n${todasLasOCs.length} OCs marcadas como "Fusionada"`)
    }catch(e){alert("Error en fusión: "+e.message);setFusionSaving(false)}
  }
  const deleteOC=async(oc)=>{
    if(!confirm(`¿Eliminar la OC ${oc.id}? Esta acción no se puede deshacer.`))return
    setDeleting(oc.id)
    if(oc.estado!=="Borrador"){alert("Por trazabilidad solo se eliminan borradores. Para dejar sin efecto una OC usa Anular.");setDeleting(null);return}
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
        alert(`Error al eliminar OC ${oc.id}:\n\n${error.message}\n\nLa OC no se eliminó. Revisa si hay referencias pendientes en otras tablas.`)
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
    if(!cancelMotivo){alert("⚠ Selecciona un motivo de cancelación.");return}
    if(!cancelDetalle||cancelDetalle.trim().length<10){alert("⚠ El detalle adicional debe tener al menos 10 caracteres.");return}
    if(cancelPagos.length>0&&!cancelConfirmado){alert("⚠ Hay pagos ejecutados. Debés marcar la casilla de confirmación antes de cancelar.");return}
    setCancelSaving(true)
    try{
      const oc=cancelSheet
      const pagosStr=cancelPagos.length>0?` · ALERTA ${cancelPagos.length} pagos ejecutados pendientes de gestionar reembolso`:""
      const accionFull=`Anulada (${cancelMotivo}) — "${cancelDetalle.trim()}" · por ${cu?.nombre}${pagosStr}`
      await addFirma(oc.id,accionFull)
      await updOC(oc.id,{estado:"Anulada"})
      // Decisión JP 17-oct: la anulación es distinta del rechazo; se notifica con la ruta configurada para "Rechazada"
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
    <CierrePanel ocs={ocs} setDet={setDet}/>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Órdenes</div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        {/* ⭐ Toggle vista lista / tabla Excel */}
        <div style={{display:"flex",gap:2,background:"#F4F5F7",borderRadius:9,padding:3}}>
          {[["lista","📄 Lista"],["tabla","📊 Tabla Excel"]].map(([k,l])=><button key={k} onClick={()=>setVistaOC(k)} style={{padding:"6px 12px",borderRadius:7,fontSize:12,fontWeight:700,border:"none",cursor:"pointer",background:vistaOC===k?"#fff":"transparent",color:vistaOC===k?"#1C1C1E":"#6E6E73",boxShadow:vistaOC===k?"0 1px 3px rgba(0,0,0,0.1)":"none",transition:"all 0.2s"}}>{l}</button>)}
        </div>
        {isAdmin&&<Bd c="#B42318" bg="#B4231812" lg>🔑 Admin</Bd>}
      </div>
    </div>
    <div style={{display:"flex",gap:6,marginBottom:8,overflowX:"auto",paddingBottom:4}}>{estados.map(e=>{const cnt=e==="Todas"?ocs.length:ocs.filter(o=>o.estado===e).length;return<button key={e} onClick={()=>setF(e)} style={{padding:"8px 14px",borderRadius:20,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",whiteSpace:"nowrap",background:f===e?"#1D4E89":"#F4F5F7",color:f===e?"#fff":"#6E6E73",transition:"all 0.2s"}}>{e==="Todas"?"Todas":(t=>t.charAt(0).toUpperCase()+t.slice(1))(e.replace("Pend. ",""))} ({cnt})</button>})}</div>
    {/* ⭐ Filtros secundarios: tipo + proveedor + búsqueda */}
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
      {/* Tipo IMP/NAC */}
      <div style={{display:"flex",gap:4}}>
        {[["T","Todos"],["IMP","🔴 IMP"],["NAC","🔵 NAC"]].map(([k,l])=><button key={k} onClick={()=>setFTipo(k)} style={{padding:"6px 12px",borderRadius:16,fontSize:12,fontWeight:700,border:"none",cursor:"pointer",background:fTipo===k?"#1C1C1E":"#F4F5F7",color:fTipo===k?"#fff":"#6E6E73",transition:"all 0.2s"}}>{l}</button>)}
      </div>
      {/* Búsqueda por número OC o nombre proveedor */}
      <input value={qOC} onChange={e=>setQOC(e.target.value)} placeholder="Buscar por OC o proveedor..."
        style={{...css.input,width:220,fontSize:12,padding:"6px 10px"}}/>
      {/* Filtro por proveedor */}
      <select value={fProv} onChange={e=>setFProv(e.target.value)}
        style={{...css.select,fontSize:12,padding:"6px 10px",maxWidth:220}}>
        <option value="">Todos los proveedores</option>
        {[...new Set(ocs.map(o=>o.proveedor_id).filter(Boolean))].sort().map(pid=>{const pv=provs?.find(p=>p.id===pid);return<option key={pid} value={pid}>{pv?.nombre||pid}</option>})}
      </select>
      {/* Indicador y reset */}
      {(fTipo!=="T"||fProv||qOC)&&<div style={{display:"flex",alignItems:"center",gap:6}}>
        <span style={{fontSize:12,color:"#6E6E73"}}>{fil.length} OC{fil.length!==1?"s":""}</span>
        <button onClick={()=>{setFTipo("T");setFProv("");setQOC("")}} style={{fontSize:11,padding:"3px 8px",borderRadius:8,border:"1px solid #E5E7EB",background:"#fff",color:"#B42318",cursor:"pointer",fontWeight:600}}>✕ Limpiar</button>
      </div>}
    </div>
    {vistaOC==="lista"&&<>
    {fil.map(oc=>{const ocF=firmas.filter(fi=>fi.oc_id===oc.id);const isI=oc.tipo_oc==="Importación";const pv=provs?.find(p=>p.id===oc.proveedor_id)
      return<Cd key={oc.id} s={{marginBottom:8}} onClick={()=>setDet(oc)}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:8}}>
          <div><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}><span style={{fontSize:15,fontWeight:700}}>{oc.id}</span><Bd c={isI?"#B42318":"#1D4E89"} bg={isI?"#B4231815":"#1D4E8915"}>{isI?"IMP":"NAC"}</Bd></div><Bd c={STS[oc.estado]?.c} bg={STS[oc.estado]?.bg} lg>{STS[oc.estado]?.ic} {oc.estado}</Bd><div style={{fontSize:12,color:"#6E6E73",marginTop:4}}>{pv?.nombre||oc.proveedor_id} · {oc.fecha_creacion} · {oc.condicion_pago}</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:800}}>{fmt(oc.total_clp)}</div>{oc.total_usd>0&&<div style={{fontSize:12,color:"#6E6E73"}}>{fU(oc.total_usd)}</div>}
            <div style={{display:"flex",gap:4,marginTop:4,justifyContent:"flex-end",flexWrap:"wrap"}} onClick={e=>e.stopPropagation()}>
              {isAdmin&&<button onClick={()=>setDet(oc)} style={{padding:"4px 8px",borderRadius:6,fontSize:11,fontWeight:600,border:"1px solid #1D4E89",background:"#1D4E8912",color:"#1D4E89",cursor:"pointer"}}>✏️ Editar</button>}
              {isI&&!["Cerrada","Rechazada","Anulada","Borrador","Dividida","Fusionada"].includes(oc.estado)&&h("gest_imp")&&<button onClick={()=>{setDet(oc);setTimeout(()=>document.getElementById("btn-split-"+oc.id)?.click(),300)}} style={{padding:"4px 8px",borderRadius:6,fontSize:11,fontWeight:600,border:"1px solid #223058",background:"#22305812",color:"#223058",cursor:"pointer"}}>✂ Dividir</button>}
              {isI&&!["Cerrada","Rechazada","Anulada","Borrador","Dividida","Fusionada"].includes(oc.estado)&&h("gest_imp")&&ocsCompatibles(oc).length>0&&<button onClick={()=>abrirFusion(oc)} style={{padding:"4px 8px",borderRadius:6,fontSize:11,fontWeight:600,border:"1px solid #1E7A44",background:"#1E7A4412",color:"#1E7A44",cursor:"pointer"}}>🔗 Fusionar</button>}
              {isAdmin&&!["Cerrada","Rechazada","Anulada","Borrador"].includes(oc.estado)&&<button onClick={()=>abrirCancelar(oc)} style={{padding:"4px 8px",borderRadius:6,fontSize:11,fontWeight:600,border:"1px solid #B25E09",background:"#B25E0912",color:"#B25E09",cursor:"pointer"}}>⊘ Anular OC</button>}
              {isAdmin&&oc.estado==="Borrador"&&<button onClick={()=>deleteOC(oc)} disabled={deleting===oc.id} style={{padding:"4px 8px",borderRadius:6,fontSize:11,fontWeight:600,border:"1px solid #B42318",background:"#B4231812",color:"#B42318",cursor:"pointer",opacity:deleting===oc.id?0.5:1}}>{deleting===oc.id?"...":"🗑 Eliminar"}</button>}
            </div>
          </div>
        </div>
        <Stp steps={isI?FI:FN} cur={oc.fase_actual}/>
        {ocF.length>0&&(()=>{const ult=ocF[ocF.length-1];return <div title={ult.accion} style={{fontSize:12,color:"#6E6E73",marginBottom:8,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>Última acción: <strong style={{color:"#3A3A3C"}}>{ult.nombre_usuario}</strong> · {String(ult.accion||"").split(" · ")[0]}{ult.fecha?` · ${ult.fecha}`:""} <span style={{color:"#9CA3AF"}}>· {ocF.length} registro{ocF.length===1?"":"s"} en el historial</span></div>})()}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}} onClick={e=>e.stopPropagation()}>
          {oc.estado==="Borrador"&&(oc.solicitante_id===cu?.id||h("crear_oc")||isAdmin)&&<><Bt sm v="pri" onClick={()=>enviarAprobacion(oc)} ic="➤">Enviar a aprobación</Bt><Bt sm v="gry" onClick={()=>descartarBorrador(oc)} ic="⊘">Descartar</Bt></>}
          {oc.solicitante_id&&oc.solicitante_id===cu?.id&&(["Pend. Dir. Negocios","Pend. Dir. Finanzas"].includes(oc.estado)||oc.reaprobacion_pendiente)&&<Bd c="#B25E09" bg="#FEF3C7">Creada por ti · la aprueba otro jefe</Bd>}
          {oc.reaprobacion_pendiente&&<><Bd c="#B42318" bg="#FEF3F2">⚠ Re-aprobación pendiente{oc.reaprobacion_neg_por?" · Negocios ✓":""}{oc.reaprobacion_fin_por?" · Finanzas ✓":""}</Bd>{!oc.reaprobacion_neg_por&&h("aprobar_neg")&&<Bt sm v="pri" onClick={()=>showComment===oc.id+"rn"?reaprobar(oc,"neg"):setShowComment(oc.id+"rn")} ic="✓">{showComment===oc.id+"rn"?"Confirmar":"Re-aprobar Negocios"}</Bt>}{!oc.reaprobacion_fin_por&&h("aprobar_fin")&&<Bt sm v="pur" onClick={()=>showComment===oc.id+"rf"?reaprobar(oc,"fin"):setShowComment(oc.id+"rf")} ic="✓">{showComment===oc.id+"rf"?"Confirmar":"Re-aprobar Finanzas"}</Bt>}</>}
          {oc.estado==="Pend. Dir. Negocios"&&h("aprobar_neg")&&<><Bt sm v="pri" onClick={()=>showComment===oc.id+"a"?firma(oc,"Aprobada Dir. Negocios",isI?"Proyectar costeo":"Pend. Dir. Finanzas",isI?3:2):setShowComment(oc.id+"a")} ic="✓">{showComment===oc.id+"a"?"Confirmar":"Aprobar"}</Bt><Bt sm v="dan" onClick={()=>showComment===oc.id+"r"?firma(oc,"Rechazada","Rechazada"):setShowComment(oc.id+"r")} ic="✕">{showComment===oc.id+"r"?"Confirmar rechazo":"Rechazar"}</Bt></>}
          {oc.estado==="Proyectar costeo"&&h("gest_imp")&&<Bt sm v="pur" onClick={()=>showComment===oc.id+"a"?firma(oc,"Costeo proyectado","Pend. Dir. Finanzas",4):setShowComment(oc.id+"a")} ic="🧮">{showComment===oc.id+"a"?"Confirmar":"Costeo proyectado"}</Bt>}
          {oc.estado==="Pend. Dir. Finanzas"&&h("aprobar_fin")&&<><Bt sm v="pur" onClick={()=>showComment===oc.id+"a"?firma(oc,"Aprobada Finanzas","Pend. proveedor",isI?5:3):setShowComment(oc.id+"a")} ic="✓">{showComment===oc.id+"a"?"Confirmar":"Presupuesto OK"}</Bt><Bt sm v="dan" onClick={()=>showComment===oc.id+"r"?firma(oc,"Rechazada","Rechazada"):setShowComment(oc.id+"r")} ic="✕">{showComment===oc.id+"r"?"Confirmar":"Rechazar"}</Bt></>}
          {oc.estado==="Pend. proveedor"&&h("valid_prov")&&<Bt sm v="suc" onClick={()=>setDet(oc)} ic="🔍">Validar proforma (requiere detalle)</Bt>}
          {oc.estado==="Confirmada prov."&&<Bt sm v="pri" onClick={()=>showComment===oc.id+"a"?firma(oc,"En despacho","Despacho nac.",5):setShowComment(oc.id+"a")} ic="🚚">{showComment===oc.id+"a"?"Confirmar":"Despacho"}</Bt>}
          {oc.estado==="Despacho nac."&&h("recibir")&&<Bt sm v="amb" onClick={()=>setDet(oc)} ic="📦">Recepción</Bt>}
          {(oc.estado==="Recibida OK"||oc.estado==="Recibida parcial")&&h("cerrar_oc")&&<Bt sm v="gry" onClick={()=>showComment===oc.id+"c"?firma(oc,"Cerrada","Cerrada",isI?12:7):setShowComment(oc.id+"c")} ic="■">{showComment===oc.id+"c"?"Confirmar cierre":"Cerrar"}</Bt>}
        </div>
        {/* Comment input for approvals */}
        {showComment&&showComment.startsWith(oc.id)&&<div style={{marginTop:6,display:"flex",gap:6,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
          <input value={commentOC} onChange={e=>setCommentOC(e.target.value)} placeholder="Comentario (obligatorio)..." style={{...css.input,flex:1,padding:"8px 12px",fontSize:12}} autoFocus onKeyDown={e=>{if(e.key==="Escape"){setShowComment(null);setCommentOC("")}}}/>
          <button onClick={()=>{setShowComment(null);setCommentOC("")}} style={{padding:"6px 10px",borderRadius:6,fontSize:12,fontWeight:600,background:"#F4F5F7",color:"#6E6E73",border:"none",cursor:"pointer"}}>Cancelar</button>
        </div>}
      </Cd>
    })}
    {fil.length===0&&<div style={{textAlign:"center",padding:40}}><div style={{fontSize:26,marginBottom:8}}>📭</div><div style={{color:"#6E6E73"}}>Sin órdenes</div></div>}</>}
    {/* ⭐ VISTA TABLA EXCEL — todos los detalles de la OC en una grilla */}
    {vistaOC==="tabla"&&(()=>{
      const TCOLS=[
        {k:"id",l:"OC",a:"left"},{k:"tipo",l:"Tipo",a:"left"},{k:"estado",l:"Estado",a:"left"},{k:"fase",l:"Fase",a:"center"},
        {k:"prov_nombre",l:"Proveedor",a:"left"},{k:"condicion_pago",l:"Cond. pago",a:"left"},{k:"fecha_creacion",l:"F. creación",a:"right"},
        {k:"fecha_estimada",l:"ETA",a:"right"},{k:"total_neto",l:"Neto",a:"right"},{k:"iva_monto",l:"IVA",a:"right"},
        {k:"total_clp",l:"Total CLP",a:"right"},{k:"total_usd",l:"Total USD",a:"right"},{k:"pagoTxt",l:"Estado pago",a:"center"},
        {k:"recepTxt",l:"Recepción",a:"center"},{k:"facturas",l:"Factura(s) libro",a:"left"},
        {k:"d_costeo",l:"Costeo",a:"center"},{k:"d_proforma",l:"Proforma",a:"center"},{k:"d_factura",l:"Factura prov.",a:"center"},
        {k:"d_packing",l:"Packing List",a:"center"},{k:"d_guia",l:"Guía despacho",a:"center"},{k:"d_recep",l:"Recepciones",a:"center"},
        {k:"d_bldin",l:"BL / DIN",a:"center"},{k:"d_otros",l:"Otros docs",a:"center"},
        {k:"firmasN",l:"Firmas",a:"right"},{k:"acc",l:"",a:"center"}
      ]
      const rows=fil.map(oc=>{
        const pv=provs?.find(p=>p.id===oc.proveedor_id)
        const pg=pagos.filter(p=>p.oc_id===oc.id)
        const pgTot=pg.length,pgPag=pg.filter(p=>p.estado==="Pagado").length
        const pagoTxt=pgTot===0?"—":pgPag===pgTot?"Pagado":pgPag>0?`Parcial ${pgPag}/${pgTot}`:"Pendiente"
        const recepTxt=oc.recepcion_cuadrada===true?"✓ Cuadrada":oc.recepcion_cuadrada===false?"◐ Sin cuadrar":["Recibida OK","Cerrada"].includes(oc.estado)?"✓ Recibida":oc.estado==="Recibida parcial"?"◐ Parcial":"—"
        const fases=oc.tipo_oc==="Importación"?FI:FN
        const isImp=oc.tipo_oc==="Importación"
        // ⭐ Clasificación de documentos por tipo (para columnas descargables)
        const allDocs=docsOC.get(oc.id)||[]
        const esTipo=(d,...ts)=>ts.includes(d.tipo_documento)||ts.some(t=>(d.nombre_archivo||"").toLowerCase().includes(t.replace("_"," ")))
        const dProforma=allDocs.filter(d=>esTipo(d,"proforma"))
        const dFactura=allDocs.filter(d=>d.tipo_documento==="factura")
        const dPacking=allDocs.filter(d=>d.tipo_documento==="packing_list"||(d.nombre_archivo||"").toLowerCase().includes("packing"))
        const dGuiaDocs=allDocs.filter(d=>d.tipo_documento==="guia_despacho")
        const dBlDin=allDocs.filter(d=>["bl_naviera","din_aduana"].includes(d.tipo_documento))
        const clasificados=new Set([...dProforma,...dFactura,...dPacking,...dGuiaDocs,...dBlDin].map(d=>d.id))
        const dOtros=allDocs.filter(d=>!clasificados.has(d.id))
        const recsAll=recsOC.get(oc.id)||[]
        const recGuias=recsAll.filter(r=>(r.tipo==="guia"||r.tipo==="guia_factura")&&r.archivo_url).map(r=>({id:r.id,nombre_archivo:r.archivo_nombre||`Guía ${r.numero_doc}`,url_archivo:r.archivo_url}))
        const recArchivos=recsAll.filter(r=>r.archivo_url).map(r=>({id:r.id,nombre_archivo:r.archivo_nombre||`${r.tipo} ${r.numero_doc}`,url_archivo:r.archivo_url}))
        const cts=costOC.get(oc.id)||new Set()
        return{...oc,tipo:isImp?"IMP":"NAC",isImp,prov_nombre:pv?.nombre||oc.proveedor_id||"",
          fase:`${oc.fase_actual||0}/${fases.length}`,pagoTxt,pgPag,pgTot,recepTxt,
          facs:facsOC.get(oc.id)||[],docsList:allDocs,firmasN:firmas.filter(fi=>fi.oc_id===oc.id).length,
          dProforma,dFactura,dPacking,dGuia:[...dGuiaDocs,...recGuias],dRecep:recArchivos,recsN:recsAll.length,dBlDin,dOtros,
          costeoP:cts.has("proyectado"),costeoF:cts.has("final")}
      })
      const sval=(r,k)=>{
        if(k==="facturas")return r.facs.length
        if(k==="d_costeo")return(r.costeoP?1:0)+(r.costeoF?2:0)
        if(k==="d_proforma")return r.dProforma.length
        if(k==="d_factura")return r.dFactura.length
        if(k==="d_packing")return r.dPacking.length
        if(k==="d_guia")return r.dGuia.length
        if(k==="d_recep")return r.recsN
        if(k==="d_bldin")return r.dBlDin.length
        if(k==="d_otros")return r.dOtros.length
        if(k==="pagoTxt")return r.pgTot>0?r.pgPag/r.pgTot:-1
        if(["total_neto","iva_monto","total_clp","total_usd","firmasN"].includes(k))return Number(r[k])||0
        return r[k]??""
      }
      // ⭐ Celda de documentos por tipo: descargables o ✗ Falta / — no aplica
      const DocCell=({items,aplica=true,vacio="✗ Falta"})=>{
        if(!aplica)return<span style={{fontSize:12,color:"#C7C7CC"}}>—</span>
        if(tablaData.cargando)return<span style={{fontSize:11,color:"#C7C7CC"}}>⏳</span>
        if(!items||items.length===0)return<span style={{fontSize:11,fontWeight:700,color:"#B42318",background:"#B4231810",padding:"2px 7px",borderRadius:6,whiteSpace:"nowrap"}}>{vacio}</span>
        return<div style={{display:"flex",flexDirection:"column",gap:1,alignItems:"center"}}>
          {items.slice(0,3).map((dc,di)=><a key={di} onClick={(e)=>{e.preventDefault();e.stopPropagation();abrirDoc(dc)}} href="#" title={dc.nombre_archivo} style={{color:"#1D4E89",textDecoration:"none",fontSize:11.5,whiteSpace:"nowrap",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",display:"block"}}>📥 {(dc.nombre_archivo||"doc").slice(0,16)}</a>)}
          {items.length>3&&<span style={{fontSize:10.5,color:"#6E6E73"}}>+{items.length-3} más</span>}
        </div>
      }
      const sorted=[...rows].sort((a,b)=>{const x=sval(a,sortOC.k),y=sval(b,sortOC.k);if(typeof x==="number"&&typeof y==="number")return(x-y)*sortOC.dir;return String(x).localeCompare(String(y),"es")*sortOC.dir})
      const abrirDoc=async(dc)=>{
        let u=dc.url_archivo
        // ⭐ On-demand: la grilla solo carga metadatos; el archivo se trae al click
        if(!u&&dc.id){
          const{data,error}=await supabase.from('documentos_import').select('url_archivo').eq('id',dc.id).single()
          if(error){alert("No se pudo obtener el archivo: "+error.message);return}
          u=data?.url_archivo
        }
        if(!u){alert("Sin archivo");return}
        if(!u.startsWith("data:")){window.open(u,"_blank","noopener");return}
        try{
          const ci=u.indexOf(",");const mime=u.slice(5,ci).split(";")[0]||"application/octet-stream"
          const bin=atob(u.slice(ci+1));const by=new Uint8Array(bin.length)
          for(let bx=0;bx<bin.length;bx++)by[bx]=bin.charCodeAt(bx)
          window.open(URL.createObjectURL(new Blob([by],{type:mime})),"_blank","noopener")
        }catch(er){alert("No se pudo abrir: "+er.message)}
      }
      const expX=()=>{
        try{
          const data=sorted.map(r=>({OC:r.id,Tipo:r.tipo,Estado:r.estado,Fase:r.fase,Proveedor:r.prov_nombre,Condicion_pago:r.condicion_pago||"",
            F_creacion:r.fecha_creacion||"",ETA:r.fecha_estimada||"",Neto:r.total_neto||0,IVA:r.iva_monto||0,Total_CLP:r.total_clp||0,Total_USD:r.total_usd||0,
            Estado_pago:r.pagoTxt,Recepcion:r.recepTxt,Facturas_libro:r.facs.map(f=>`${f.folio} (${fmt(f.monto_total)})`).join(" · "),
            Costeo:!r.isImp?"—":`Proyectado:${r.costeoP?"SI":"NO"} Final:${r.costeoF?"SI":"NO"}`,
            Proforma:r.dProforma.length>0?r.dProforma.map(d=>d.nombre_archivo).join(" · "):"FALTA",
            Factura_prov:r.dFactura.length>0?r.dFactura.map(d=>d.nombre_archivo).join(" · "):"FALTA",
            Packing_list:!r.isImp?"—":(r.dPacking.length>0?r.dPacking.map(d=>d.nombre_archivo).join(" · "):"FALTA"),
            Guia_despacho:r.dGuia.length>0?r.dGuia.map(d=>d.nombre_archivo).join(" · "):"FALTA",
            Recepciones:r.recsN>0?`${r.recsN} registradas`:"FALTA",
            BL_DIN:!r.isImp?"—":(r.dBlDin.length>0?r.dBlDin.map(d=>d.nombre_archivo).join(" · "):"FALTA"),
            Otros_docs:r.dOtros.map(dc=>dc.nombre_archivo||dc.tipo_documento).join(" · "),Firmas:r.firmasN}))
          const ws=XLSX.utils.json_to_sheet(data);const wb=XLSX.utils.book_new()
          XLSX.utils.book_append_sheet(wb,ws,"Ordenes")
          XLSX.writeFile(wb,`Ordenes_${hoy()}.xlsx`)
        }catch(e){alert("Error exportando: "+(e?.message||e))}
      }
      return<div style={{background:"#fff",borderRadius:12,border:"1px solid #E5E7EB",overflow:"hidden"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderBottom:"1px solid #F4F5F7"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1C1C1E"}}>📊 Órdenes de compra — vista completa {tablaData.cargando&&<span style={{fontSize:12,fontWeight:600,color:"#B25E09",marginLeft:8}}>⏳ cargando documentos…</span>}</div>
          <div style={{display:"flex",gap:6}}>
            <Bt sm v="gry" onClick={()=>setTablaData(p=>({...p,cargado:false}))} ic="🔄">Refrescar</Bt>
            <Bt sm v="gry" onClick={expX} ic="📊">Exportar Excel</Bt>
          </div>
        </div>
        <div style={{overflowX:"auto",maxHeight:"72vh",overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:2150}}>
            <thead><tr style={{background:"#F4F5F7",position:"sticky",top:0,zIndex:2}}>
              {TCOLS.map(c=><th key={c.k} onClick={()=>c.k!=="acc"&&setSortOC(s=>({k:c.k,dir:s.k===c.k?-s.dir:1}))} style={{padding:"8px 10px",textAlign:c.a,fontSize:11,fontWeight:700,color:sortOC.k===c.k?"#1D4E89":"#6E6E73",borderBottom:"2px solid #E5E7EB",whiteSpace:"nowrap",cursor:c.k!=="acc"?"pointer":"default",userSelect:"none",background:"#F4F5F7"}}>{c.l}{sortOC.k===c.k?(sortOC.dir>0?" ↑":" ↓"):""}</th>)}
            </tr></thead>
            <tbody>{sorted.map((r,i)=>{
              return<tr key={r.id} style={{borderBottom:"1px solid #F4F5F7",background:i%2===0?"#fff":"#FAFAFA",cursor:"pointer"}} onClick={()=>{const oc=ocs.find(o=>o.id===r.id);if(oc)setDet(oc)}}>
                <td style={{padding:"6px 10px",fontFamily:"monospace",fontWeight:700,fontSize:12,whiteSpace:"nowrap"}}>{r.id}</td>
                <td style={{padding:"6px 10px"}}><Bd c={r.tipo==="IMP"?"#B42318":"#1D4E89"} bg={(r.tipo==="IMP"?"#B42318":"#1D4E89")+"15"}>{r.tipo}</Bd></td>
                <td style={{padding:"6px 10px",whiteSpace:"nowrap"}}><Bd c={STS[r.estado]?.c||"#6E6E73"} bg={(STS[r.estado]?.c||"#6E6E73")+"15"}>{STS[r.estado]?.ic} {r.estado}</Bd></td>
                <td style={{padding:"6px 10px",textAlign:"center",fontSize:12,color:"#6E6E73"}}>{r.fase}</td>
                <td style={{padding:"6px 10px",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.prov_nombre}>{r.prov_nombre}</td>
                <td style={{padding:"6px 10px",fontSize:12,whiteSpace:"nowrap"}}>{r.condicion_pago||"—"}</td>
                <td style={{padding:"6px 10px",textAlign:"right",whiteSpace:"nowrap",fontSize:12}}>{r.fecha_creacion||"—"}</td>
                <td style={{padding:"6px 10px",textAlign:"right",whiteSpace:"nowrap",fontSize:12}}>{r.fecha_estimada||"—"}</td>
                <td style={{padding:"6px 10px",textAlign:"right",whiteSpace:"nowrap"}}>{r.total_neto?fmt(r.total_neto):"—"}</td>
                <td style={{padding:"6px 10px",textAlign:"right",whiteSpace:"nowrap"}}>{r.iva_monto?fmt(r.iva_monto):"—"}</td>
                <td style={{padding:"6px 10px",textAlign:"right",fontWeight:700,whiteSpace:"nowrap"}}>{fmt(r.total_clp)}</td>
                <td style={{padding:"6px 10px",textAlign:"right",whiteSpace:"nowrap"}}>{r.total_usd>0?fU(r.total_usd):"—"}</td>
                <td style={{padding:"6px 10px",textAlign:"center"}}><Bd c={r.pagoTxt==="Pagado"?"#1E7A44":r.pagoTxt.startsWith("Parcial")?"#B25E09":r.pagoTxt==="Pendiente"?"#B42318":"#6E6E73"} bg={(r.pagoTxt==="Pagado"?"#1E7A44":r.pagoTxt.startsWith("Parcial")?"#B25E09":r.pagoTxt==="Pendiente"?"#B42318":"#6E6E73")+"15"}>{r.pagoTxt}</Bd></td>
                <td style={{padding:"6px 10px",textAlign:"center"}}><Bd c={r.recepTxt.startsWith("✓")?"#1E7A44":r.recepTxt.startsWith("◐")?"#B25E09":"#6E6E73"} bg={(r.recepTxt.startsWith("✓")?"#1E7A44":r.recepTxt.startsWith("◐")?"#B25E09":"#6E6E73")+"15"}>{r.recepTxt}</Bd></td>
                <td style={{padding:"6px 10px",fontSize:12,maxWidth:150}} onClick={e=>e.stopPropagation()}>{r.facs.length>0?r.facs.map((f,fi)=><div key={fi} style={{whiteSpace:"nowrap"}}>🧾 <b>{f.folio}</b> · {fmt(f.monto_total)}</div>):<span style={{color:"#C7C7CC"}}>—</span>}</td>
                {/* ⭐ Columnas por tipo de documento (descargables / faltantes) */}
                <td style={{padding:"6px 8px",textAlign:"center"}} onClick={e=>e.stopPropagation()}>{!r.isImp?<span style={{fontSize:12,color:"#C7C7CC"}}>—</span>:tablaData.cargando?<span style={{fontSize:11,color:"#C7C7CC"}}>⏳</span>:<span style={{fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}><span style={{color:r.costeoP?"#1E7A44":"#B42318"}}>P{r.costeoP?"✓":"✗"}</span> <span style={{color:r.costeoF?"#1E7A44":"#B25E09"}}>F{r.costeoF?"✓":"✗"}</span></span>}</td>
                <td style={{padding:"6px 8px",textAlign:"center"}} onClick={e=>e.stopPropagation()}><DocCell items={r.dProforma}/></td>
                <td style={{padding:"6px 8px",textAlign:"center"}} onClick={e=>e.stopPropagation()}><DocCell items={r.dFactura}/></td>
                <td style={{padding:"6px 8px",textAlign:"center"}} onClick={e=>e.stopPropagation()}><DocCell items={r.dPacking} aplica={r.isImp}/></td>
                <td style={{padding:"6px 8px",textAlign:"center"}} onClick={e=>e.stopPropagation()}><DocCell items={r.dGuia}/></td>
                <td style={{padding:"6px 8px",textAlign:"center"}} onClick={e=>e.stopPropagation()}>{r.recsN===0?<DocCell items={[]}/>:<div><div style={{fontSize:11,fontWeight:700,color:"#1E7A44",marginBottom:1}}>{r.recsN} reg.</div><DocCell items={r.dRecep} vacio="sin archivo"/></div>}</td>
                <td style={{padding:"6px 8px",textAlign:"center"}} onClick={e=>e.stopPropagation()}><DocCell items={r.dBlDin} aplica={r.isImp}/></td>
                <td style={{padding:"6px 8px",textAlign:"center"}} onClick={e=>e.stopPropagation()}>{r.dOtros.length===0?<span style={{fontSize:12,color:"#C7C7CC"}}>—</span>:<DocCell items={r.dOtros}/>}</td>
                <td style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:"#6E6E73"}}>{r.firmasN}</td>
                <td style={{padding:"6px 10px",textAlign:"center"}} onClick={e=>e.stopPropagation()}><Bt sm v="pri" onClick={()=>{const oc=ocs.find(o=>o.id===r.id);if(oc)setDet(oc)}}>👁</Bt></td>
              </tr>
            })}</tbody>
          </table>
        </div>
        <div style={{padding:"8px 14px",borderTop:"1px solid #F4F5F7",fontSize:12,color:"#6E6E73"}}>{sorted.length} OCs · click en encabezados para ordenar · click en fila abre el detalle</div>
      </div>
    })()}

    {/* NOTIFICATION LOG */}
    {notifLog.length>0&&<Cd s={{marginTop:16}}>
      <div style={{fontSize:15,fontWeight:700,marginBottom:8}}>📧 Registro de notificaciones</div>
      <div style={{fontSize:12,color:"#6E6E73",marginBottom:8}}>Historial de acciones en órdenes de compra con fecha y hora</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{background:"#F4F5F7"}}>{["Fecha","Hora","OC","Acción","Nuevo Estado","Usuario","Rol"].map((h,i)=><th key={i} style={{padding:"6px 8px",textAlign:"left",fontSize:10.5,fontWeight:700,color:"#6E6E73",borderBottom:"1px solid #E5E7EB",textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
        <tbody>{notifLog.slice(0,30).map((n,i)=><tr key={i} style={{borderBottom:"1px solid #F4F5F7"}}>
          <td style={{padding:"5px 8px",whiteSpace:"nowrap"}}>{n.fecha||new Date(n.created_at).toLocaleDateString("es-CL")}</td>
          <td style={{padding:"5px 8px",whiteSpace:"nowrap",color:"#6E6E73"}}>{n.hora||new Date(n.created_at).toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"})}</td>
          <td style={{padding:"5px 8px",fontWeight:600,fontFamily:"monospace"}}>{n.oc_id}</td>
          <td style={{padding:"5px 8px",fontWeight:500}}>{n.accion}</td>
          <td style={{padding:"5px 8px"}}><Bd c={STS[n.nuevo_estado]?.c||"#6E6E73"} bg={STS[n.nuevo_estado]?.bg||"#F4F5F7"}>{n.nuevo_estado||"—"}</Bd></td>
          <td style={{padding:"5px 8px"}}>{n.usuario}</td>
          <td style={{padding:"5px 8px",color:"#6E6E73"}}>{n.rol}</td>
        </tr>)}</tbody>
      </table>
    </Cd>}

    {/* ⭐ Sheet de fusión de OCs */}
    <Sheet show={showFusion} onClose={()=>setShowFusion(false)} title={`🔗 Fusionar OCs · Origen: ${ocOrigen?.id||""}`}>
      {ocOrigen&&<div>
        <div style={{background:"#1E7A4412",borderRadius:10,padding:"10px 12px",marginBottom:14,border:"1px solid #1E7A4430",fontSize:12,color:"#1C1C1E",lineHeight:1.5}}>
          <b>Reglas de fusión:</b> Solo OCs de Importación del mismo proveedor. Hereda el estado más avanzado. Costos del SKU más reciente (editable). Pagos pagados de las madres se migran.
        </div>
        {/* Lista de OCs compatibles */}
        <div style={{fontSize:12,fontWeight:700,marginBottom:8,color:"#1C1C1E"}}>OCs compatibles del proveedor {provs?.find(p=>p.id===ocOrigen.proveedor_id)?.nombre||ocOrigen.proveedor_id}</div>
        <div style={{maxHeight:200,overflowY:"auto",border:"1px solid #E5E7EB",borderRadius:8,marginBottom:14}}>
          {ocsCompatibles(ocOrigen).length===0
            ?<div style={{padding:14,textAlign:"center",fontSize:12,color:"#6E6E73"}}>No hay OCs compatibles del mismo proveedor para fusionar.</div>
            :ocsCompatibles(ocOrigen).map(o=>{
              const sel=fusionSel.includes(o.id)
              return<div key={o.id} onClick={()=>toggleFusion(o)} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderBottom:"1px solid #F4F5F7",cursor:"pointer",background:sel?"#1E7A4410":"#fff"}}>
                <input type="checkbox" checked={sel} readOnly style={{accentColor:"#1E7A44"}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,fontFamily:"monospace"}}>{o.id}</div>
                  <div style={{fontSize:12,color:"#6E6E73"}}>{o.estado} · ETA {o.fecha_estimada||"—"}</div>
                </div>
                <div style={{fontSize:12,fontWeight:700,color:"#1E7A44"}}>{fU(o.total_usd||0)}</div>
              </div>
            })
          }
        </div>
        {/* ETA */}
        <Fl l="ETA combinada" req>
          <input type="date" value={fusionEta} onChange={e=>setFusionEta(e.target.value)} style={css.input}/>
        </Fl>
        {/* Tabla consolidada */}
        {consolidados.length>0&&<>
          <div style={{fontSize:12,fontWeight:700,marginTop:14,marginBottom:8,color:"#1C1C1E"}}>Items consolidados ({consolidados.length} SKUs)</div>
          <div style={{overflowX:"auto",marginBottom:14,maxHeight:300,overflowY:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead style={{position:"sticky",top:0,background:"#F4F5F7"}}><tr>
                <th style={{padding:"6px 8px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73"}}>PRODUCTO</th>
                <th style={{padding:"6px",textAlign:"center",fontSize:11,fontWeight:700,color:"#6E6E73"}}>CANTIDAD</th>
                <th style={{padding:"6px",textAlign:"center",fontSize:11,fontWeight:700,color:"#6E6E73"}}>COSTO U. (USD)</th>
                <th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:700,color:"#6E6E73"}}>SUBTOTAL</th>
              </tr></thead>
              <tbody>{consolidados.map(c=><tr key={c.sku} style={{borderBottom:"1px solid #F4F5F7",background:c.duplicado?"#FFF8EC":"#fff"}}>
                <td style={{padding:"6px 8px"}}>
                  <div style={{fontWeight:600,fontSize:12}}>{c.producto}</div>
                  <div style={{fontSize:11,color:"#6E6E73",fontFamily:"monospace"}}>{c.sku}{c.duplicado&&<span style={{marginLeft:6,color:"#B25E09",fontWeight:700}}>🔗 Fusionado de {c.ocs.length} OCs</span>}</div>
                </td>
                <td style={{padding:"6px",textAlign:"center"}}>
                  <input type="number" min={0} value={c.cantidad_final}
                    onChange={e=>setFusionItemsEdit({...fusionItemsEdit,[c.sku]:Math.max(0,Number(e.target.value))})}
                    style={{width:70,textAlign:"center",padding:"4px 6px",borderRadius:6,border:"1px solid #E5E7EB",fontSize:12,fontWeight:700}}/>
                </td>
                <td style={{padding:"6px",textAlign:"center"}}>
                  <input type="number" min={0} step="any" value={c.costo_final}
                    onChange={e=>setFusionCostos({...fusionCostos,[c.sku]:Math.max(0,Number(e.target.value))})}
                    style={{width:90,textAlign:"right",padding:"4px 6px",borderRadius:6,border:`1px solid ${c.costo_final!==c.costo_sugerido?"#B25E09":"#E5E7EB"}`,fontSize:12,fontWeight:600,background:c.costo_final!==c.costo_sugerido?"#FFF8EC":"#fff"}}
                    title={c.duplicado?`Costos por OC:\n${c.costos.map(x=>x.oc+": "+fUD(x.costo)).join("\n")}\n\nSugerido (más reciente): ${fUD(c.costo_sugerido)}`:`Sugerido: ${fUD(c.costo_sugerido)}`}/>
                </td>
                <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:"#1E7A44"}}>{fUD(c.subtotal,2)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {/* Resumen */}
          {(()=>{
            const totalOriginal=fusionItemsBase.reduce((s,i)=>s+((i.cantidad_pedida||0)*(i.costo_unitario||0)),0)
            const totalNuevo=consolidados.reduce((s,c)=>s+c.subtotal,0)
            return<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
              <div style={{background:"#F4F5F7",borderRadius:8,padding:10,textAlign:"center"}}>
                <div style={{fontSize:11,color:"#6E6E73",fontWeight:700,marginBottom:2}}>SUMA OCs ORIGEN</div>
                <div style={{fontSize:15,fontWeight:700,color:"#6E6E73"}}>{fUD(totalOriginal,2)}</div>
              </div>
              <div style={{background:"#1E7A4410",borderRadius:8,padding:10,textAlign:"center"}}>
                <div style={{fontSize:11,color:"#1E7A44",fontWeight:700,marginBottom:2}}>OC FUSIONADA (NUEVA)</div>
                <div style={{fontSize:16,fontWeight:800,color:"#1E7A44"}}>{fUD(totalNuevo,2)}</div>
              </div>
            </div>
          })()}
        </>}
        <Bt fw onClick={ejecutarFusion} disabled={fusionSaving||fusionSel.length===0}>
          {fusionSaving?"Fusionando...":"🔗 Confirmar fusión"}
        </Bt>
      </div>}
    </Sheet>

    {/* ⭐ v48: Sheet de cancelación de OC (admin) */}
    <Sheet show={!!cancelSheet} onClose={()=>setCancelSheet(null)} title={`⊘ Anular OC ${cancelSheet?.id||""}`}>
      {cancelSheet&&<div>
        <div style={{background:"#B25E0912",borderRadius:10,padding:12,marginBottom:14,border:"1px solid #B25E0930"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#B25E09",marginBottom:4}}>⚠ Cancelación definitiva</div>
          <div style={{fontSize:12,color:"#3A3A3C"}}>La OC cambiará a estado <strong>Rechazada</strong> y no podrá revertirse por los usuarios regulares. Queda registro completo en auditoría con tu firma.</div>
        </div>

        {/* Info de la OC */}
        <div style={{padding:"10px 12px",background:"#F4F5F7",borderRadius:10,marginBottom:12,fontSize:12}}>
          <div><strong>Estado actual:</strong> {cancelSheet.estado}</div>
          <div><strong>Proveedor:</strong> {provs.find(p=>p.id===cancelSheet.proveedor_id)?.nombre||cancelSheet.proveedor_id}</div>
          <div><strong>Monto:</strong> {fmt(cancelSheet.total_clp||0)}{cancelSheet.total_usd>0?` (${fU(cancelSheet.total_usd)})`:""}</div>
        </div>

        {/* Alerta pagos ejecutados */}
        {cancelPagos.length>0&&<div style={{background:"#B4231810",borderRadius:10,padding:12,marginBottom:14,border:"2px solid #B42318"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#B42318",marginBottom:6}}>🚨 Esta OC tiene {cancelPagos.length} pago(s) ejecutado(s)</div>
          <div style={{fontSize:12,color:"#3A3A3C",marginBottom:8}}>Cancelar esta OC no revierte pagos automáticamente. Deberás gestionar reembolso o crédito con el proveedor por separado.</div>
          <div style={{fontSize:12}}>
            {cancelPagos.map(p=><div key={p.id} style={{padding:"4px 0",borderBottom:"1px solid #B4231820"}}>• {p.concepto}: <strong>{p.moneda==="USD"?fU(p.monto):fmt(p.monto)}</strong></div>)}
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
          <textarea value={cancelDetalle} onChange={e=>setCancelDetalle(e.target.value)} placeholder="Describe con claridad por qué se cancela esta OC. Este texto quedará registrado en la auditoría y en el email de notificación." style={{...css.input,minHeight:70,resize:"vertical",fontSize:13}}/>
        </Fl>

        {/* Checkbox confirmación definitiva si hay pagos */}
        {cancelPagos.length>0&&<div style={{padding:"10px 12px",background:cancelConfirmado?"#1E7A4412":"#B4231810",borderRadius:10,marginTop:8,marginBottom:8,border:`1px solid ${cancelConfirmado?"#1E7A44":"#B42318"}`}}>
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
      {inconsistente&&puedeEditar&&<div style={{padding:"10px 14px",background:"#B4231810",borderRadius:10,border:"1px solid #B4231840",marginBottom:10}}>
        <div style={{fontSize:12,fontWeight:700,color:"#B42318",marginBottom:3}}>⚠ Inconsistencia detectada</div>
        <div style={{fontSize:12,color:"#6E6E73",lineHeight:1.4}}>
          El total de la OC es <strong>{fmt(ocTotalCLP)}</strong>{oc.total_usd>0?` (${fU(oc.total_usd)})`:""} pero la suma del plan de pago es aproximadamente <strong>{fmt(totalPlanAprox)}</strong> (TC ~$950).
          Diferencia: {Math.round(pctDiferencia)}%. Probablemente las cuotas se generaron en moneda incorrecta.
          Haz click en <strong>Editar plan</strong> para corregir manualmente o usar "Recalcular".
        </div>
      </div>}

      {pagosOrdenados.map((p,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #F4F5F7",fontSize:13}}>
        <span>{p.concepto}{p.fecha_programada?<span style={{fontSize:12,color:"#6E6E73",marginLeft:8}}>· {p.fecha_programada}</span>:null}</span>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <strong>{p.moneda==="USD"?fU(p.monto):fmt(p.monto)}</strong>
          <Bd c={p.estado==="Pagado"?"#1E7A44":"#B25E09"} bg={p.estado==="Pagado"?"#1E7A4415":"#B25E0915"}>{p.estado}</Bd>
        </div>
      </div>)}

      {/* Total del plan */}
      <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",fontSize:13,borderTop:"2px solid #1C1C1E",marginTop:6}}>
        <strong>Total del plan</strong>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {totalCLP_plan>0&&<strong style={{color:"#1D4E89"}}>{fmt(totalCLP_plan)}</strong>}
          {totalCLP_plan>0&&totalUSD_plan>0&&<span style={{color:"#AEAEB2"}}>+</span>}
          {totalUSD_plan>0&&<strong style={{color:"#1E7A44"}}>{fU(totalUSD_plan)}</strong>}
        </div>
      </div>
    </div>
  }

  // Vista edición
  return<div style={{marginTop:16,background:"#FFF8E7",borderRadius:12,padding:"14px 16px",border:"1px solid #FFE4A0"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
      <div>
        <div style={{fontSize:14,fontWeight:700,color:"#946200"}}>✏️ Editando plan de pago</div>
        <div style={{fontSize:12,color:"#946200",marginTop:2}}>Puedes cambiar moneda, montos, fechas y agregar/eliminar cuotas</div>
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <span style={{fontSize:12,fontWeight:700,color:"#946200"}}>Moneda OC:</span>
        <div style={{display:"flex",gap:3,background:"#fff",borderRadius:6,padding:2}}>
          {["CLP","USD"].map(m=><button key={m} onClick={()=>cambiarMonedaGlobal(m)} style={{padding:"5px 12px",borderRadius:4,fontSize:12,fontWeight:700,border:"none",cursor:"pointer",background:monedaOC===m?(m==="USD"?"#1E7A44":"#1D4E89"):"transparent",color:monedaOC===m?"#fff":"#6E6E73"}}>{m}</button>)}
        </div>
      </div>
    </div>

    {tienePagosEjecutados&&<div style={{padding:"8px 12px",background:"#B25E0915",borderRadius:8,marginBottom:10,fontSize:12,color:"#946200"}}>
      ⚠ Hay pagos ya ejecutados. Puedes editarlos pero con cautela — los cambios afectan la bitácora histórica.
    </div>}

    {/* Tabla editable */}
    <div style={{background:"#fff",borderRadius:8,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{background:"#F8F8FA"}}>
          <th style={{padding:"8px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73"}}>Concepto</th>
          <th style={{padding:"8px",textAlign:"right",fontSize:11,fontWeight:700,color:"#6E6E73",width:100}}>Monto</th>
          <th style={{padding:"8px",textAlign:"center",fontSize:11,fontWeight:700,color:"#6E6E73",width:75}}>Moneda</th>
          <th style={{padding:"8px",textAlign:"center",fontSize:11,fontWeight:700,color:"#6E6E73",width:130}}>Fecha programada</th>
          <th style={{padding:"8px",textAlign:"center",fontSize:11,fontWeight:700,color:"#6E6E73",width:85}}>Estado</th>
          <th style={{padding:"8px",width:40}}></th>
        </tr></thead>
        <tbody>{editing.map((c,i)=>{
          const esPagado=c.estado==="Pagado"
          return<tr key={i} style={{borderBottom:"1px solid #F4F5F7",background:esPagado?"#1E7A4406":c.__nueva?"#1D4E8908":"transparent"}}>
            <td style={{padding:"6px"}}>
              <input value={c.concepto} onChange={e=>updateCuota(i,"concepto",e.target.value)} disabled={esPagado}
                style={{...css.input,padding:"5px 8px",fontSize:12,background:esPagado?"#F8F8FA":"#fff"}}/>
            </td>
            <td style={{padding:"6px"}}>
              <input type="number" min={0} step="any" value={c.monto||0} onChange={e=>updateCuota(i,"monto",Number(e.target.value)||0)} disabled={esPagado}
                style={{width:"100%",padding:"5px 8px",textAlign:"right",fontWeight:700,borderRadius:6,border:"1px solid #E5E7EB",fontSize:12,background:esPagado?"#F8F8FA":"#fff"}}/>
            </td>
            <td style={{padding:"6px"}}>
              <select value={c.moneda||"CLP"} onChange={e=>updateCuota(i,"moneda",e.target.value)} disabled={esPagado}
                style={{width:"100%",padding:"5px 4px",borderRadius:6,border:"1px solid #E5E7EB",fontSize:12,fontWeight:600,background:esPagado?"#F8F8FA":"#fff"}}>
                <option value="CLP">CLP</option>
                <option value="USD">USD</option>
              </select>
            </td>
            <td style={{padding:"6px"}}>
              <input type="date" value={c.fecha_programada||""} onChange={e=>updateCuota(i,"fecha_programada",e.target.value)} disabled={esPagado}
                style={{width:"100%",padding:"5px 4px",borderRadius:6,border:"1px solid #E5E7EB",fontSize:12,background:esPagado?"#F8F8FA":"#fff"}}/>
            </td>
            <td style={{padding:"6px",textAlign:"center"}}>
              <Bd c={esPagado?"#1E7A44":"#B25E09"} bg={esPagado?"#1E7A4415":"#B25E0915"}>{c.estado}</Bd>
            </td>
            <td style={{padding:"6px",textAlign:"center"}}>
              <button onClick={()=>eliminarCuota(i)} disabled={esPagado} title={esPagado?"No se puede eliminar un pago ejecutado":"Eliminar cuota"}
                style={{padding:"4px 8px",fontSize:12,background:esPagado?"#F4F5F7":"#B4231815",color:esPagado?"#AEAEB2":"#B42318",border:"none",borderRadius:5,cursor:esPagado?"not-allowed":"pointer",fontWeight:600}}>🗑</button>
            </td>
          </tr>
        })}</tbody>
        <tfoot><tr style={{background:"#F8F8FA",borderTop:"2px solid #1C1C1E"}}>
          <td style={{padding:"8px",fontWeight:700}}>TOTAL · {editing.length} cuota(s)</td>
          <td style={{padding:"8px",textAlign:"right",fontWeight:800,fontSize:14,color:monedaOC==="USD"?"#1E7A44":"#1D4E89"}}>{monedaOC==="USD"?fU(totalActual):fmt(totalActual)}</td>
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
/* ⭐ Componente: ETA editable con reprogramar en OCDetView */
function ETAReprog({oc,updOC,addFirma,cu,provs=[]}){
  const[edit,setEdit]=useState(false)
  const[val,setVal]=useState(oc.fecha_estimada||"")
  const[saving,setSaving]=useState(false)
  const recibida=["Recibida OK","Recibida parcial","Cerrada"].includes(oc.estado)
  const[linkGCal,setLinkGCal]=useState(null)
  const[sucNombreETA,setSucNombreETA]=useState("")
  const[usersRecibir,setUsersRecibir]=useState([])
  useEffect(()=>{
    supabase.from('sucursales').select('nombre').eq('id',oc.destino_sucursal_id||"").single().then(({data})=>setSucNombreETA(data?.nombre||"CD Maipú"))
    supabase.from('usuarios').select('correo,rol').eq('activo',true).then(({data})=>{
      const con=(data||[]).filter(u=>["dir_operaciones","jefe_bodega","jefe_operaciones","admin","dir_general"].includes(u.rol))
      setUsersRecibir(con)
    })
  },[oc.destino_sucursal_id])
  const guardar=async()=>{
    if(!val)return
    setSaving(true)
    await updOC(oc.id,{fecha_estimada:val})
    await addFirma(oc.id,`Fecha de llegada reprogramada → ${val} por ${cu?.nombre||"usuario"}`)
    // Generar link Calendar con la nueva fecha
    const pv=(provs||[]).find(p=>p.id===oc.proveedor_id)
    const ocActualizado={...oc,fecha_estimada:val}
    setLinkGCal(generarLinkCalendar(ocActualizado,pv?.nombre||oc.proveedor_id,sucNombreETA,usersRecibir))
    setSaving(false);setEdit(false)
  }
  return<div style={{background:"#F4F5F7",borderRadius:10,padding:"8px 12px"}}>
    <div style={{fontSize:11,color:"#AEAEB2",fontWeight:600,marginBottom:4}}>ETA / LLEGADA</div>
    {edit
      ?<div style={{display:"flex",flexDirection:"column",gap:6}}>
        <input type="date" value={val} onChange={e=>setVal(e.target.value)}
          style={{padding:"5px 8px",borderRadius:8,border:"1px solid #B25E09",fontSize:12,background:"#fff"}}/>
        <div style={{display:"flex",gap:4}}>
          <button onClick={guardar} disabled={saving}
            style={{flex:1,padding:"4px 8px",fontSize:12,fontWeight:700,background:"#B25E09",color:"#fff",border:"none",borderRadius:6,cursor:"pointer"}}>
            {saving?"Guardando...":"✓ Confirmar"}
          </button>
          <button onClick={()=>{setEdit(false);setVal(oc.fecha_estimada||"")}}
            style={{padding:"4px 8px",fontSize:12,background:"#E5E7EB",border:"none",borderRadius:6,cursor:"pointer"}}>✕</button>
        </div>
      </div>
      :<div style={{display:"flex",flexDirection:"column",gap:6}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:4}}>
          <span style={{fontSize:13,fontWeight:600,color:"#1C1C1E"}}>{oc.fecha_estimada||"—"}</span>
          {!recibida&&<button onClick={()=>{setVal(oc.fecha_estimada||"");setEdit(true);setLinkGCal(null)}}
            style={{fontSize:10.5,fontWeight:700,padding:"2px 7px",borderRadius:5,border:"1px solid #B25E0960",background:"#B25E0910",color:"#B25E09",cursor:"pointer",whiteSpace:"nowrap"}}>
            📅 Reprogramar
          </button>}
        </div>
        {linkGCal&&<a href={linkGCal} target="_blank" rel="noreferrer"
          style={{display:"flex",alignItems:"center",gap:4,padding:"4px 8px",background:"#1E7A4415",border:"1px solid #1E7A4440",borderRadius:6,textDecoration:"none",color:"#1E7A44",fontSize:11,fontWeight:700}}>
          📆 Crear evento en Google Calendar
          <span style={{fontSize:10.5,opacity:0.7}}>({usersRecibir.length} invitados)</span>
        </a>}
      </div>
    }
  </div>
}

/* ⭐ Componente: Destino editable en OCDetView */
function DestinoEdit({oc,updOC,provs=[]}){
  const[edit,setEdit]=useState(false)
  const[val,setVal]=useState(oc.destino_sucursal_id||"")
  const[saving,setSaving]=useState(false)
  const[sucList,setSucList]=useState([])
  useEffect(()=>{
    supabase.from('sucursales').select('*').then(({data})=>setSucList(data||[]))
  },[])
  const guardar=async()=>{
    setSaving(true)
    await updOC(oc.id,{destino_sucursal_id:val||null})
    setSaving(false);setEdit(false)
  }
  const sucNombre=sucList.find(s=>s.id===oc.destino_sucursal_id)?.nombre||oc.destino_sucursal_id||"CD Maipú"
  return<div style={{background:"#F4F5F7",borderRadius:10,padding:"8px 12px"}}>
    <div style={{fontSize:11,color:"#AEAEB2",fontWeight:600,marginBottom:4}}>DESTINO</div>
    {edit
      ?<div style={{display:"flex",flexDirection:"column",gap:6}}>
        <select value={val} onChange={e=>setVal(e.target.value)}
          style={{padding:"5px 8px",borderRadius:8,border:"1px solid #1D4E89",fontSize:12,background:"#fff"}}>
          <option value="">CD Maipú (por defecto)</option>
          {sucList.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <div style={{display:"flex",gap:4}}>
          <button onClick={guardar} disabled={saving}
            style={{flex:1,padding:"4px 8px",fontSize:12,fontWeight:700,background:"#1D4E89",color:"#fff",border:"none",borderRadius:6,cursor:"pointer"}}>
            {saving?"Guardando...":"✓ Confirmar"}
          </button>
          <button onClick={()=>{setEdit(false);setVal(oc.destino_sucursal_id||"")}}
            style={{padding:"4px 8px",fontSize:12,background:"#E5E7EB",border:"none",borderRadius:6,cursor:"pointer"}}>✕</button>
        </div>
      </div>
      :<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:4}}>
        <span style={{fontSize:13,fontWeight:600,color:"#1C1C1E"}}>{sucNombre}</span>
        <button onClick={()=>{setVal(oc.destino_sucursal_id||"");setEdit(true)}}
          style={{fontSize:10.5,fontWeight:700,padding:"2px 7px",borderRadius:5,border:"1px solid #1D4E8940",background:"#1D4E8910",color:"#1D4E89",cursor:"pointer"}}>
          ✏ Editar
        </button>
      </div>
    }
  </div>
}

/* Decisión JP 17-oct-2026 (pregunta 19): hitos de importación con fecha estimada y real; mueven el estado logístico y la ETA */
const HITOS_IMP=["Fabricación","Zarpe","Arribo a puerto","Liberación aduana","Llegada a CD"]
function HitosImportacion({oc,cu,addFirma,updOC,close}){
  const[rows,setRows]=useState({})
  const[edit,setEdit]=useState({})
  const[saving,setSaving]=useState(null)
  useEffect(()=>{(async()=>{const{data}=await supabase.from('oc_hitos_importacion').select('*').eq('oc_id',oc.id);const m={};(data||[]).forEach(r=>{m[r.hito]=r});setRows(m);const e={};HITOS_IMP.forEach(hh=>{e[hh]={fecha_estimada:m[hh]?.fecha_estimada||"",fecha_real:m[hh]?.fecha_real||"",bl:m[hh]?.bl||"",naviera:m[hh]?.naviera||"",contenedores:m[hh]?.contenedores||""}});setEdit(e)})()},[oc.id])
  const setF=(hh,k,v)=>setEdit(p=>({...p,[hh]:{...p[hh],[k]:v}}))
  const guardar=async(hh)=>{
    const e=edit[hh]||{}
    if(!e.fecha_estimada&&!e.fecha_real){alert("Ingresa al menos una fecha, estimada o real.");return}
    if(e.fecha_real&&e.fecha_real>hoy()){alert("La fecha real no puede ser futura.");return}
    setSaving(hh)
    try{
      const row={oc_id:oc.id,hito:hh,fecha_estimada:e.fecha_estimada||null,fecha_real:e.fecha_real||null,bl:e.bl||null,naviera:e.naviera||null,contenedores:e.contenedores||null,registrado_por:cu?.nombre||null,actualizado_at:new Date().toISOString()}
      const{data,error}=await supabase.from('oc_hitos_importacion').upsert(row,{onConflict:'oc_id,hito'}).select().single()
      if(error){alert("No se guardó el hito: "+error.message);return}
      setRows(p=>({...p,[hh]:data}))
      const det=[e.fecha_estimada&&`estimada ${e.fecha_estimada}`,e.fecha_real&&`real ${e.fecha_real}`,e.bl&&`BL ${e.bl}`,e.naviera&&`naviera ${e.naviera}`,e.contenedores&&`contenedores ${e.contenedores}`].filter(Boolean).join(" · ")
      await addFirma(oc.id,`Hito ${hh}: ${det}`)
      if(hh==="Llegada a CD"&&e.fecha_estimada&&e.fecha_estimada!==(oc.fecha_estimada||"")){await updOC(oc.id,{fecha_estimada:e.fecha_estimada});await addFirma(oc.id,`ETA de llegada al CD actualizada a ${e.fecha_estimada} (antes ${oc.fecha_estimada||"sin fecha"})`)}
      let cambio=null
      if(oc.reaprobacion_pendiente){if(e.fecha_real)alert("El hito quedó registrado, pero la OC no cambia de etapa hasta completar la re-aprobación.")}
      else{
        if(hh==="Zarpe"&&e.fecha_real&&["Proforma OK","En fabricación","Pago fabricación"].includes(oc.estado))cambio={estado:"Embarcada",fase_actual:7}
        if((hh==="Arribo a puerto"||hh==="Liberación aduana")&&e.fecha_real&&["Proforma OK","En fabricación","Embarcada","Pago fabricación","Pago embarque"].includes(oc.estado))cambio={estado:"Internación",fase_actual:8}
      }
      if(cambio){await updOC(oc.id,cambio);await addFirma(oc.id,`Estado → ${cambio.estado} (hito ${hh} registrado)`);alert(`${oc.id} pasa a ${cambio.estado}.`);close&&close()}
    }finally{setSaving(null)}
  }
  const inp={padding:"4px 6px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,fontFamily:"inherit"}
  return <div style={{border:"1px solid #E5E7EB",borderRadius:10,padding:"10px 12px",marginBottom:12}}>
    <div style={{fontSize:12,fontWeight:700,color:"#16213E",marginBottom:4}}>Hitos de importación</div>
    <div style={{fontSize:11,color:"#6E6E73",marginBottom:8}}>Registrar el zarpe pasa la OC a Embarcada y el arribo o la liberación, a Internación. La ETA de llegada al CD actualiza la fecha estimada de la OC. Cada registro queda en el historial de firmas.</div>
    <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
      <thead><tr style={{color:"#6E6E73",textAlign:"left"}}><th style={{padding:4}}>Hito</th><th>Estimada</th><th>Real</th><th>Documentos</th><th></th></tr></thead>
      <tbody>{HITOS_IMP.map(hh=>{const e=edit[hh]||{};const r=rows[hh];return <tr key={hh} style={{borderTop:"1px solid #F3F4F6"}}>
        <td style={{padding:4,fontWeight:600,whiteSpace:"nowrap"}}>{hh}{r?.fecha_real&&<span style={{color:"#1E7A44"}}> ✓</span>}</td>
        <td><input type="date" value={e.fecha_estimada||""} onChange={ev=>setF(hh,"fecha_estimada",ev.target.value)} style={inp}/></td>
        <td><input type="date" value={e.fecha_real||""} onChange={ev=>setF(hh,"fecha_real",ev.target.value)} style={inp}/></td>
        <td>{hh==="Zarpe"?<div style={{display:"flex",gap:4,flexWrap:"wrap"}}><input placeholder="BL" value={e.bl||""} onChange={ev=>setF(hh,"bl",ev.target.value)} style={{...inp,width:90}}/><input placeholder="Naviera" value={e.naviera||""} onChange={ev=>setF(hh,"naviera",ev.target.value)} style={{...inp,width:90}}/><input placeholder="Contenedores" value={e.contenedores||""} onChange={ev=>setF(hh,"contenedores",ev.target.value)} style={{...inp,width:110}}/></div>:<span style={{color:"#9CA3AF"}}>{r?.registrado_por?`por ${r.registrado_por}`:""}</span>}</td>
        <td><button onClick={()=>guardar(hh)} disabled={saving===hh} style={{padding:"4px 10px",borderRadius:6,border:"1px solid #16213E",background:"#16213E",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>{saving===hh?"…":"Guardar"}</button></td>
      </tr>})}</tbody>
    </table></div>
  </div>
}

/* 18-oct-2026: ficha de OC a pantalla completa (paso 3 de la homologación). Esc cierra. */
function FichaOC({show,onClose,oc,provs=[],children}){
  useEffect(()=>{if(!show)return;const f=e=>{if(e.key==="Escape")onClose()};window.addEventListener("keydown",f);return()=>window.removeEventListener("keydown",f)},[show,onClose])
  if(!show||!oc)return null
  const pv=provs.find(p=>p.id===oc.proveedor_id)
  const isI=oc.tipo_oc==="Importación"
  return <div style={{position:"fixed",inset:0,zIndex:80,background:"rgba(15,23,42,0.35)",display:"flex",justifyContent:"center"}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#F7F8FA",width:"100%",height:"100%",overflowY:"auto",boxShadow:"0 0 40px rgba(0,0,0,0.25)"}}>
      <div style={{position:"sticky",top:0,zIndex:6,background:"#16213E",color:"#fff",padding:"10px 20px",display:"flex",alignItems:"center",gap:12,minHeight:46,boxSizing:"border-box"}}>
        <span style={{fontFamily:"monospace",fontWeight:800,fontSize:16}}>{oc.id}</span>
        <span style={{fontSize:12,fontWeight:700,padding:"2px 8px",borderRadius:999,background:"rgba(255,255,255,0.14)"}}>{isI?"Importación":"Nacional"}</span>
        <span style={{fontSize:12,opacity:0.85,whiteSpace:"nowrap"}}>{oc.estado}</span>
        <span style={{fontSize:12,opacity:0.7,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0}}>{pv?.nombre||oc.proveedor_id}</span>
        <div style={{flex:1}}/>
        <span style={{fontSize:13,fontWeight:700,whiteSpace:"nowrap"}}>{isI?fU(oc.total_usd||0):fmt(oc.total_clp||0)}</span>
        <button onClick={onClose} title="Cerrar (Esc)" style={{marginLeft:8,padding:"5px 12px",borderRadius:8,border:"1px solid rgba(255,255,255,0.3)",background:"transparent",color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>Cerrar ✕</button>
      </div>
      <div style={{padding:"14px 28px 48px"}}>{children}</div>
    </div>
  </div>
}

/* 19-oct-2026: historial de la OC en una sola línea de tiempo (firmas + bitácora de etapas).
   Resumen, recorrido por etapas con su duración, filtros, eventos por día con tipo, actor y hora,
   cambios de etapa como etiquetas de color, comentarios destacados y ediciones seguidas agrupadas. */
const HOC_TZ="America/Santiago"
const HOC_TIPOS={creacion:{l:"Creación",ic:"✎",c:"#16213E"},aprobacion:{l:"Aprobación",ic:"✓",c:"#1E7A44"},rechazo:{l:"Rechazo o anulación",ic:"✕",c:"#B42318"},etapa:{l:"Cambio de etapa",ic:"➜",c:"#16213E"},cambio:{l:"Cambio de ítems",ic:"✎",c:"#B25E09"},logistica:{l:"Logística",ic:"🚢",c:"#1D4E89"},recepcion:{l:"Recepción",ic:"📦",c:"#1D4E89"},documento:{l:"Documentos y costeo",ic:"📎",c:"#4B5563"},pago:{l:"Pagos",ic:"$",c:"#5B2C6F"},otro:{l:"Acción",ic:"•",c:"#6E6E73"}}
function hocClasificar(t){
  if(/^(Solicitud creada|Borrador creado|Borrador enviado)/i.test(t))return"creacion"
  if(/^(Rechazada|Anulada|Cancelada)/i.test(t))return"rechazo"
  if(/^(Aprobada|Costeo proyectado|Costeo final validado|Proforma confirmada|Presupuesto OK|Re-?aprobad|Cambios? re-?aprobad)/i.test(t))return"aprobacion"
  if(/^(Estado actualizado|Estado →)/i.test(t))return"etapa"
  if(/^(Item|Ítem) (editado|agregado|eliminado)|^⚠?\s*Plan de pago (recalculado|editado|no recalculado)|re-?aprobación pendiente/i.test(t))return"cambio"
  if(/^Hito|reprogramada|^Destino cambiado|^Fabricación iniciada|^Mercadería embarcada|^ETA|^Llegada/i.test(t))return"logistica"
  if(/RECEPCIONADA|^Recepción|guía/i.test(t))return"recepcion"
  if(/documento\(s\) adjuntado|^📎|Costeo IMP (proyectado|final) anexado|factura/i.test(t))return"documento"
  if(/^Pago|comprobante|cuota/i.test(t))return"pago"
  return"otro"
}
function hocPartir(a){
  let t=String(a||"").trim(),herencia=""
  const h=t.match(/\s*\((heredada[^)]*)\)\s*$/i);if(h){herencia=h[1];t=t.slice(0,h.index).trim()}
  let titulo=t,detalle="",trans=null
  const q=t.match(/^(.*?)\s+[—–-]\s+"([\s\S]*)"\s*$/);if(q){titulo=q[1];detalle=q[2]}
  else{const e=t.match(/^Estado actualizado:\s*(.+?)\s*→\s*(.+?)(?:\s+[—–]\s+([\s\S]+))?$/i)
    if(e){titulo="Estado actualizado";trans={desde:e[1].trim(),hacia:e[2].trim()};detalle=(e[3]||"").trim()}
    else{let prof=0,corte=-1,largo=0
      for(let k=0;k<t.length;k++){const c=t[k];if(c==="("||c==="[")prof++;else if(c===")"||c==="]")prof=Math.max(0,prof-1);else if(prof===0){if(t.startsWith(": ",k)&&k<70){corte=k;largo=2;break}if(t.startsWith(" · ",k)){corte=k;largo=3;break}}}
      if(corte>0){titulo=t.slice(0,corte);detalle=t.slice(corte+largo)}
      else{const pf=t.match(/^(.{3,80}?)\s*\(([^()]+)\)\s*$/);if(pf){titulo=pf[1];detalle=pf[2]}}}}
  return{titulo:titulo.replace(/^📎\s*/,"").trim(),detalle:detalle.replace(/^"|"$/g,"").trim(),herencia,trans}
}
function hocRel(d){const s=(Date.now()-d.getTime())/1000;if(s<60)return"recién";if(s<3600)return`hace ${Math.round(s/60)} min`;if(s<86400)return`hace ${Math.round(s/3600)} h`;const dd=Math.round(s/86400);return dd===1?"ayer":`hace ${dd} días`}
function hocDur(ms){const h=ms/3600000;if(h<1)return`${Math.max(1,Math.round(ms/60000))} min`;if(h<24)return`${Math.round(h)} h`;const d=h/24;return`${d<10?d.toFixed(1).replace(".",","):Math.round(d)} d`}
const HocPill=({estado})=>{const st=STS[estado]||{c:"#6E6E73",bg:"#F4F5F7"};return <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:6,color:st.c,background:st.bg,whiteSpace:"nowrap"}}>{estado}</span>}
/* 19-oct-2026: registro de pago con comprobante, compartido por la pestaña Pagos y el Historial de la OC
   (misma regla que Finanzas: comprobante obligatorio; cuota pagada o pago parcial; documento de la OC; firma en la bitácora) */
function RegistroPagoModal({oc,cuotas=[],pagoId,setPagos,addFirma,onClose}){
  const ini=cuotas.find(p=>p.id===pagoId)||cuotas.find(p=>p.estado!=="Pagado")||cuotas[0]
  const[regPago,setRegPago]=useState({pago_id:ini?.id||"",fecha:hoy(),monto:ini?String(Math.round(Number(ini.monto)||0)):"",obs:"",file:null,fileName:"",subiendo:false})
  const registrarPago=async()=>{
    const r=regPago;const cuota=cuotas.find(p=>p.id===r.pago_id)
    if(!cuota){alert("Elige la cuota que se pagó.");return}
    if(!r.file){alert("Adjunta el comprobante de pago (obligatorio).");return}
    if(!r.fecha){alert("Falta la fecha de pago.");return}
    const monto=Number(String(r.monto).replace(/\./g,"").replace(",","."))
    if(!(monto>0)){alert("El monto debe ser mayor a 0.");return}
    setRegPago(x=>({...x,subiendo:true}))
    try{
      const ext=(String(r.fileName).split(".").pop()||"pdf").toLowerCase()
      const san=t=>(t||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"_")
      const path=`${san(oc.id)}/${san(cuota.etapa||cuota.concepto||"pago")}_${Date.now()}.${ext}`
      const{error:upErr}=await supabase.storage.from('comprobantes').upload(path,r.file,{upsert:true})
      if(upErr)throw new Error("no se pudo subir el archivo: "+upErr.message)
      const url=supabase.storage.from('comprobantes').getPublicUrl(path)?.data?.publicUrl||""
      const parcial=monto<(Number(cuota.monto)||0)*0.99
      if(parcial){
        const np={id:uid(),oc_id:oc.id,concepto:(cuota.concepto||"Pago")+" (parcial)",monto,moneda:cuota.moneda,fecha_pago:r.fecha,estado:"Pagado",etapa:cuota.etapa,hito_padre_id:cuota.id,es_parcial:true,comprobante_url:url,comprobante_nombre:r.fileName,observaciones_pago:r.obs||null}
        const{error}=await supabase.from('pagos').insert(np);if(error)throw error
        setPagos&&setPagos(prev=>[...prev,np])
      }else{
        const up={estado:"Pagado",fecha_pago:r.fecha,monto,comprobante_url:url,comprobante_nombre:r.fileName,observaciones_pago:r.obs||null,es_parcial:false}
        const{error}=await supabase.from('pagos').update(up).eq('id',cuota.id);if(error)throw error
        setPagos&&setPagos(prev=>prev.map(p=>p.id===cuota.id?{...p,...up}:p))
      }
      await supabase.from('documentos_import').insert({id:uid(),oc_id:oc.id,tipo:`comprobante_pago_${cuota.etapa||"pago"}`,nombre_archivo:r.fileName,url,descripcion:`Comprobante: ${cuota.concepto||"cuota"} — ${cuota.moneda||"CLP"} ${fN(monto)} — ${r.fecha}`})
      await addFirma(oc.id,`Pago registrado con comprobante · ${cuota.concepto||"cuota"}${parcial?" (parcial)":""} · ${cuota.moneda||"CLP"} ${fN(monto)} · pagado el ${r.fecha}${r.obs?` · ${r.obs}`:""}`,{comentario:url})
      onClose()
    }catch(e){alert("No se registró el pago: "+(e.message||e));setRegPago(x=>x?{...x,subiendo:false}:x)}
  }
  return <>
    <div onClick={()=>!regPago.subiendo&&onClose()} style={{position:"fixed",inset:0,background:"rgba(15,23,42,.45)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={ev=>ev.stopPropagation()} role="dialog" aria-label="Registrar comprobante de pago" style={{background:"#fff",borderRadius:12,width:"min(520px,100%)",padding:"18px 20px",boxShadow:"0 20px 50px rgba(0,0,0,.25)"}}>
        <div style={{fontSize:16,fontWeight:800,color:"#16213E"}}>Registrar comprobante de pago</div>
        <div style={{fontSize:12.5,color:"#6E6E73",margin:"4px 0 12px"}}>{oc.id} · el pago queda en la cuota, en los documentos de la OC y en esta bitácora.</div>
        <label style={{fontSize:12.5,fontWeight:700}}>Cuota pagada</label>
        <select value={regPago.pago_id} onChange={ev=>{const c=cuotas.find(p=>p.id===ev.target.value);setRegPago(x=>({...x,pago_id:ev.target.value,monto:c?String(Math.round(Number(c.monto)||0)):x.monto}))}} style={{...css.select,width:"100%",margin:"4px 0 10px"}}>
          {cuotas.map(c=><option key={c.id} value={c.id}>{c.concepto||"Cuota"} · {c.moneda||"CLP"} {fN(Number(c.monto)||0)} · {c.estado||"Pendiente"}{c.fecha_vencimiento?` · vence ${c.fecha_vencimiento}`:""}</option>)}
        </select>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><label style={{fontSize:12.5,fontWeight:700}}>Fecha de pago</label><input type="date" value={regPago.fecha} onChange={ev=>setRegPago(x=>({...x,fecha:ev.target.value}))} style={{...css.input,width:"100%",marginTop:4}}/></div>
          <div><label style={{fontSize:12.5,fontWeight:700}}>Monto pagado ({(cuotas.find(p=>p.id===regPago.pago_id)||{}).moneda||"CLP"})</label><input value={regPago.monto} inputMode="decimal" onChange={ev=>setRegPago(x=>({...x,monto:ev.target.value}))} style={{...css.input,width:"100%",marginTop:4}}/></div>
        </div>
        <div style={{fontSize:11.5,color:"#6E6E73",marginTop:4}}>Si el monto es menor a la cuota, se registra como pago parcial.</div>
        <label style={{fontSize:12.5,fontWeight:700,display:"block",marginTop:10}}>Comprobante (obligatorio)</label>
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" aria-label="Comprobante de pago" onChange={ev=>{const f=ev.target.files?.[0];setRegPago(x=>({...x,file:f||null,fileName:f?.name||""}))}} style={{marginTop:4,fontSize:12.5}}/>
        <label style={{fontSize:12.5,fontWeight:700,display:"block",marginTop:10}}>Observación</label>
        <input value={regPago.obs} onChange={ev=>setRegPago(x=>({...x,obs:ev.target.value}))} placeholder="Ej.: transferencia Santander, N° de operación" style={{...css.input,width:"100%",marginTop:4}}/>
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
          <Bt v="gry" dis={regPago.subiendo} onClick={onClose}>Cancelar</Bt>
          <Bt v="pri" dis={regPago.subiendo} onClick={registrarPago}>{regPago.subiendo?"Guardando…":"Registrar pago"}</Bt>
        </div>
      </div>
    </div>
  </>
}
function HistorialOC({oc,firmas=[],pagos=[],setPagos,addFirma,cu}){
  // 19-oct-2026: los analistas registran aquí el comprobante de pago (misma regla que Finanzas: comprobante obligatorio)
  const puedeRegistrar=!!addFirma&&["admin","dir_general","dir_negocios","dir_finanzas","jefe_admin_finanzas","analista"].includes(cu?.rol)
  const[regPagoId,setRegPagoId]=useState(null)
  const cuotas=(pagos||[]).filter(p=>p.oc_id===oc.id)
  const[bit,setBit]=useState(null)
  const[filtro,setFiltro]=useState("todo")
  const[abiertos,setAbiertos]=useState({})
  useEffect(()=>{(async()=>{const{data}=await supabase.from('cmp_oc_bitacora').select('*').eq('oc_id',oc.id).order('creado_at',{ascending:true});setBit(data||[])})()},[oc.id])
  const toggle=k=>setAbiertos(p=>({...p,[k]:!p[k]}))
  const fecha=f=>{const d=new Date(f.created_at||`${f.fecha}T${f.hora||"00:00:00"}`);return isNaN(d)?new Date(0):d}
  // 1) Firmas como eventos
  const evs=firmas.map((f,i)=>{const p=hocPartir(f.accion);return{key:"f"+(f.id||i),t:fecha(f),tipo:hocClasificar(String(f.accion||"")),titulo:p.titulo,detalle:p.detalle||(f.comentario&&!/^https?:\/\//i.test(String(f.comentario))&&!String(f.accion||"").includes(f.comentario)?f.comentario:""),url:/^https?:\/\//i.test(String(f.comentario||""))?f.comentario:null,herencia:p.herencia,trans:p.trans,actor:f.nombre_usuario,rol:f.rol_usuario}})
  // 2) Bitácora: se une a la firma del mismo momento; si no hay, queda como cambio de etapa propio
  const usados=new Set()
  for(const b of (bit||[])){const tb=new Date(b.creado_at).getTime()
    let mejor=null,dmin=181000
    evs.forEach((e,i)=>{if(usados.has(i))return;const d=Math.abs(e.t.getTime()-tb);if(d<dmin&&["creacion","aprobacion","rechazo","etapa","logistica","recepcion","otro"].includes(e.tipo)){dmin=d;mejor=i}})
    const tr={desde:b.desde||"Creación",hacia:b.hacia,en_flujo:b.en_flujo,rol_esperado:b.rol_esperado}
    if(mejor!=null){usados.add(mejor);evs[mejor].trans=tr}
    else evs.push({key:"b"+b.id,t:new Date(b.creado_at),tipo:b.hacia==="ELIMINADA"||b.hacia==="Anulada"||b.hacia==="Rechazada"?"rechazo":"etapa",titulo:b.desde?"Cambio de etapa":"OC creada",detalle:"",trans:tr,actor:b.usuario_nombre,rol:b.rol})}
  evs.sort((a,b)=>a.t-b.t)
  // 3) Ediciones seguidas de la misma persona (≤ 30 min) se agrupan en un solo evento
  const lista=[]
  for(const e of evs){const u=lista[lista.length-1]
    if(u&&["cambio","documento"].includes(e.tipo)&&u.tipo===e.tipo&&u.actor===e.actor&&!e.trans&&!u.trans&&(e.t-u.tFin)<=1800000){(u.items=u.items||[{titulo:u.titulo,detalle:u.detalle,herencia:u.herencia}]).push({titulo:e.titulo,detalle:e.detalle,herencia:e.herencia});u.tFin=e.t;continue}
    lista.push({...e,tFin:e.t})}
  for(const g of lista){if(g.items&&g.items.length>1){const cnt={};g.items.forEach(x=>{cnt[x.titulo]=(cnt[x.titulo]||0)+1})
    g.titulo=g.tipo==="cambio"?`${g.items.length} cambios de ítems y plan de pago`:`${g.items.length} registros de documentos y costeo`
    g.resumen=Object.entries(cnt).map(([k,v])=>`${k.charAt(0).toLowerCase()+k.slice(1)} ×${v}`).join(" · ");g.herencia=g.items.every(x=>x.herencia)?g.items[0].herencia:""}}
  // 4) Resumen
  const aprob=lista.filter(e=>e.tipo==="aprobacion").length
  const rech=lista.filter(e=>e.tipo==="rechazo").length
  const camb=evs.filter(e=>e.tipo==="cambio").length
  const ultimo=lista[lista.length-1]
  const trs=(bit||[]).filter(b=>b.hacia)
  const ultTr=[...trs].reverse().find(b=>b.hacia===oc.estado)
  const desdeEtapa=ultTr?new Date(ultTr.creado_at):(ultimo?ultimo.t:null)
  const creada=new Date(String(oc.fecha_creacion||"").slice(0,10)+"T12:00:00")
  const antig=isNaN(creada)?null:Math.max(0,Math.round((Date.now()-creada.getTime())/86400000))
  // 5) Recorrido por etapas (desde la bitácora)
  const segs=trs.map((b,i)=>{const ini=new Date(b.creado_at).getTime(),fin=i<trs.length-1?new Date(trs[i+1].creado_at).getTime():Date.now();return{etapa:b.hacia,ms:Math.max(60000,fin-ini),actual:i===trs.length-1}})
  const total=segs.reduce((acc,x)=>acc+x.ms,0)||1
  // 6) Filtros
  const FILTROS=[["todo","Todo",()=>true],["etapas","Etapas y aprobaciones",e=>["creacion","aprobacion","rechazo","etapa"].includes(e.tipo)||!!e.trans],["comentarios","Con comentario",e=>!!e.detalle&&["aprobacion","rechazo","etapa","creacion","otro"].includes(e.tipo)],["cambios","Cambios de ítems",e=>e.tipo==="cambio"],["logistica","Logística y recepción",e=>["logistica","recepcion"].includes(e.tipo)],["docs","Documentos y pagos",e=>["documento","pago"].includes(e.tipo)]]
  const fAct=(FILTROS.find(f=>f[0]===filtro)||FILTROS[0])[2]
  const vis=lista.filter(fAct).slice().reverse()
  const dia=d=>d.toLocaleDateString("en-CA",{timeZone:HOC_TZ})
  const hoyK=dia(new Date()),ayerK=dia(new Date(Date.now()-86400000))
  const grupos=[];for(const e of vis){const k=dia(e.t);let g=grupos[grupos.length-1];if(!g||g.k!==k){const l=k===hoyK?"Hoy":k===ayerK?"Ayer":(x=>x.charAt(0).toUpperCase()+x.slice(1))(e.t.toLocaleDateString("es-CL",{timeZone:HOC_TZ,weekday:"long",day:"numeric",month:"long",year:"numeric"}));g={k,l,items:[]};grupos.push(g)}g.items.push(e)}
  const ini=n=>String(n||"Sistema").split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()
  const rolL=r=>({admin:"Admin",dir_general:"Dir. General",dir_negocios:"Dir. Negocios",dir_finanzas:"Dir. Finanzas",jefe_admin_finanzas:"Jefe Adm. y Finanzas",analista:"Analista",jefe_bodega:"Jefe de bodega",operaciones:"Operaciones",jefe_tienda:"Jefe de tienda",dir_operaciones:"Dir. Operaciones"})[r]||r
  const hora=d=>d.toLocaleTimeString("es-CL",{timeZone:HOC_TZ,hour:"2-digit",minute:"2-digit",hour12:false})
  const kpi=(l,v,sub,c)=><div style={{background:"#fff",padding:"9px 14px",borderRight:"1px solid #E5E7EB",borderBottom:"1px solid #E5E7EB",minWidth:0}}><div style={{fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",letterSpacing:0.5}}>{l}</div><div style={{fontSize:16,fontWeight:700,color:c||"#1C1C1E",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{v}</div>{sub&&<div style={{fontSize:11,color:"#6E6E73",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sub}</div>}</div>
  if(bit===null)return <div style={{padding:20,color:"#6E6E73",fontSize:13}}>Cargando historial…</div>
  return <div>
    <style>{`@keyframes hocIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.hoc-ev{animation:hocIn .28s ease both}.hoc-card{transition:box-shadow .15s,border-color .15s,transform .15s}.hoc-card:hover{box-shadow:0 6px 18px rgba(22,33,62,.08);border-color:#CBD5E1}.hoc-chip{transition:background .15s,color .15s,border-color .15s}.hoc-seg{transition:filter .15s}.hoc-seg:hover{filter:brightness(.96)}.hoc-cur{background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.28) 0 7px,transparent 7px 14px)!important;background-size:28px 28px;animation:hocMov 1.4s linear infinite}@keyframes hocMov{from{background-position:0 0}to{background-position:28px 0}}`}</style>
    <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:8}}>
      <div style={{fontSize:16,fontWeight:800,color:"#16213E"}}>Historial de la OC</div>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}><span style={{fontSize:12,color:"#6E6E73"}}>Firmas, pagos y cambios de etapa en una sola línea de tiempo.</span>{puedeRegistrar&&cuotas.length>0&&<Bt sm v="pri" ic="💳" onClick={()=>{const pend=cuotas.find(p=>p.estado!=="Pagado")||cuotas[0];setRegPagoId(pend?.id||"")}}>Registrar comprobante de pago</Bt>}</div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",border:"1px solid #E5E7EB",borderBottom:"none",borderRadius:8,overflow:"hidden",marginBottom:12,background:"#fff"}}>
      {kpi("Etapa actual",<HocPill estado={oc.estado}/>,desdeEtapa?`${ultTr?"desde":"última acción"} ${hocRel(desdeEtapa)}`:"")}
      {kpi("Antigüedad",antig==null?"—":`${antig} día${antig===1?"":"s"}`,oc.fecha_creacion?`creada el ${String(oc.fecha_creacion).slice(0,10)}`:"")}
      {kpi("Aprobaciones",aprob,rech?`${rech} rechazo(s) o anulación(es)`:"sin rechazos",aprob?"#1E7A44":undefined)}
      {kpi("Cambios de ítems",camb,camb?"ediciones, altas y bajas":"sin cambios",camb?"#B25E09":undefined)}
      {kpi("Última acción",ultimo?hocRel(ultimo.t):"—",ultimo?`${ultimo.actor||"Sistema"} · ${ultimo.titulo}`:"")}
      {kpi("Registros",firmas.length,`${(bit||[]).length} cambio(s) de etapa en la bitácora`)}
    </div>
    <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:8,padding:"10px 14px",marginBottom:12}}>
      <div style={{fontSize:13,fontWeight:700,color:"#16213E",marginBottom:8}}>Recorrido por etapas <span style={{fontWeight:500,color:"#6E6E73",fontSize:12}}>· tiempo en cada una</span></div>
      {segs.length===0?<div style={{fontSize:12,color:"#6E6E73"}}>Esta OC no tiene cambios de etapa registrados desde el 17-oct-2026; su recorrido anterior está en las firmas de abajo.</div>:<>
        <div style={{display:"flex",height:30,borderRadius:6,overflow:"hidden",border:"1px solid #E5E7EB"}}>
          {segs.map((g,i)=>{const st=STS[g.etapa]||{c:"#6E6E73",bg:"#F4F5F7"};const w=Math.max(4,g.ms/total*100);return <div key={i} className={"hoc-seg"+(g.actual?" hoc-cur":"")} title={`${g.etapa}: ${hocDur(g.ms)}${g.actual?" (en curso)":""}`} style={{flex:`${w} 1 0`,minWidth:28,background:g.actual?st.c:st.bg,color:g.actual?"#fff":st.c,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,borderRight:i<segs.length-1?"2px solid #fff":"none",overflow:"hidden",whiteSpace:"nowrap",padding:"0 6px"}}>{hocDur(g.ms)}</div>})}
        </div>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:8}}>{segs.map((g,i)=>{const st=STS[g.etapa]||{c:"#6E6E73"};return <span key={i} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:12,color:"#3A3A3C"}}><span style={{width:10,height:10,borderRadius:3,background:st.c}}/>{g.etapa}<span style={{color:"#6E6E73"}}>· {hocDur(g.ms)}{g.actual?" · en curso":""}</span></span>})}</div>
      </>}
    </div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
      {FILTROS.map(([k,l,fn])=>{const n=lista.filter(fn).length;if(k!=="todo"&&!n)return null;const a=filtro===k;return <button key={k} className="hoc-chip" onClick={()=>setFiltro(k)} style={{padding:"5px 12px",borderRadius:999,fontSize:12,fontWeight:600,cursor:"pointer",border:"1px solid "+(a?"#16213E":"#D1D5DB"),background:a?"#16213E":"#fff",color:a?"#fff":"#3A3A3C"}}>{l} <span style={{opacity:.7}}>{n}</span></button>})}
    </div>
    {grupos.length===0&&<div style={{padding:16,color:"#6E6E73",fontSize:13,background:"#fff",border:"1px solid #E5E7EB",borderRadius:8}}>No hay registros para este filtro.</div>}
    {grupos.map(g=><div key={g.k} style={{marginBottom:14}}>
      <div style={{fontSize:12.5,fontWeight:700,color:"#16213E",margin:"0 0 6px"}}>{g.l} <span style={{fontWeight:500,color:"#9CA3AF"}}>· {g.items.length} evento{g.items.length===1?"":"s"}</span></div>
      <div style={{position:"relative",paddingLeft:40}}>
        <div style={{position:"absolute",left:15,top:6,bottom:6,width:2,background:"#E5E7EB",borderRadius:1}}/>
        {g.items.map((e,k)=>{const tp=HOC_TIPOS[e.tipo]||HOC_TIPOS.otro;const ab=!!abiertos[e.key];const largo=(e.detalle||"").length>220
          return <div key={e.key} className="hoc-ev" style={{position:"relative",marginBottom:8,animationDelay:`${Math.min(k,10)*25}ms`}}>
            <div style={{position:"absolute",left:-40,top:10,width:32,height:32,borderRadius:16,background:"#fff",border:`2px solid ${tp.c}`,color:tp.c,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,boxShadow:"0 0 0 4px #F7F8FA"}}>{tp.ic}</div>
            <div className="hoc-card" style={{background:"#fff",border:"1px solid #E5E7EB",borderLeft:`3px solid ${tp.c}`,borderRadius:8,padding:"10px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{fontSize:13.5,fontWeight:700,color:"#1C1C1E"}}>{e.titulo}</span>
                {e.trans&&<span style={{display:"inline-flex",alignItems:"center",gap:5}}><HocPill estado={e.trans.desde}/><span style={{color:"#9CA3AF",fontWeight:700}}>→</span><HocPill estado={e.trans.hacia}/></span>}
                {e.trans&&e.trans.en_flujo===false&&<span title="Cambio de etapa fuera del flujo normal, hecho por admin o Dir. General" style={{fontSize:10.5,fontWeight:700,padding:"2px 7px",borderRadius:6,background:"#FFFBEB",color:"#92400E",border:"1px solid #F5C77E"}}>Fuera de flujo</span>}
                {e.trans&&e.trans.rol_esperado===false&&<span title="Quien hizo el cambio no tiene el rol habitual para esta etapa" style={{fontSize:10.5,fontWeight:600,padding:"2px 7px",borderRadius:6,background:"#F3F4F6",color:"#6B7280"}}>Rol no habitual</span>}
                {e.herencia&&<span title={e.herencia} style={{fontSize:10.5,fontWeight:600,padding:"2px 7px",borderRadius:6,background:"#EEF1F7",color:"#4B5563"}}>{e.herencia.replace(/^heredada (del split )?de /i,"Heredada de ")}</span>}
                <span title={e.t.toLocaleString("es-CL",{timeZone:HOC_TZ})} style={{marginLeft:"auto",fontSize:12,color:"#6E6E73",whiteSpace:"nowrap"}}>{hora(e.t)} · {hocRel(e.t)}</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginTop:5,fontSize:12,color:"#6E6E73",flexWrap:"wrap"}}>
                <span style={{width:22,height:22,borderRadius:11,background:"#EEF1F7",color:"#16213E",fontSize:10,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center"}}>{ini(e.actor)}</span>
                <span style={{color:"#3A3A3C",fontWeight:600}}>{e.actor||"Sistema"}</span>{e.rol&&<span>· {rolL(e.rol)}</span>}<span style={{color:tp.c,fontWeight:600}}>· {tp.l}</span>
              </div>
              {e.items&&e.items.length>1?<div style={{marginTop:8}}>
                <div style={{fontSize:12.5,color:"#374151"}}>{e.resumen}</div>
                <button onClick={()=>toggle(e.key)} style={{marginTop:6,padding:"0 10px",height:26,minHeight:0,lineHeight:"24px",borderRadius:6,border:"1px solid #D1D5DB",background:"#fff",color:"#16213E",fontSize:11.5,fontWeight:600,cursor:"pointer",display:"inline-flex",alignItems:"center"}}>{ab?"Ocultar detalle":`Ver los ${e.items.length}`}</button>
                {ab&&<div style={{marginTop:8,maxHeight:260,overflowY:"auto",border:"1px solid #F3F4F6",borderRadius:6}}>{e.items.map((x,i)=><div key={i} style={{padding:"5px 10px",fontSize:12,borderTop:i?"1px solid #F3F4F6":"none",color:"#374151"}}><b style={{color:"#1C1C1E"}}>{x.titulo}</b>{x.detalle?`: ${x.detalle}`:""}{x.herencia&&<span style={{marginLeft:6,fontSize:10.5,fontWeight:600,padding:"1px 6px",borderRadius:5,background:"#EEF1F7",color:"#4B5563"}}>{x.herencia.replace(/^heredada (del split )?de /i,"Heredada de ")}</span>}</div>)}</div>}
              </div>:e.detalle&&<div onClick={()=>largo&&toggle(e.key)} style={{marginTop:8,padding:"8px 12px",background:"#F8FAFC",borderLeft:`3px solid ${tp.c}40`,borderRadius:6,fontSize:12.5,color:"#374151",lineHeight:1.5,whiteSpace:"pre-wrap",cursor:largo?"pointer":"default"}}>
                {["aprobacion","rechazo","etapa","creacion"].includes(e.tipo)?<span style={{color:"#9CA3AF"}}>“</span>:null}{largo&&!ab?e.detalle.slice(0,220)+"…":e.detalle}{["aprobacion","rechazo","etapa","creacion"].includes(e.tipo)?<span style={{color:"#9CA3AF"}}>”</span>:null}
                {largo&&<span style={{marginLeft:8,color:"#1D4E89",fontWeight:600}}>{ab?"ver menos":"ver más"}</span>}
              </div>}
              {e.url&&<a href={e.url} target="_blank" rel="noopener noreferrer" style={{display:"inline-block",marginTop:8,fontSize:12.5,fontWeight:700,color:"#1D4E89"}}>📎 Ver comprobante</a>}
            </div>
          </div>})}
      </div>
    </div>)}
    {regPagoId!=null&&<RegistroPagoModal oc={oc} cuotas={cuotas} pagoId={regPagoId} setPagos={setPagos} addFirma={addFirma} onClose={()=>setRegPagoId(null)}/>}
  </div>
}

function OCDetView({oc,firmas,pagos,provs=[],updOC,addFirma,setPagos,close,cu,h,config={},notificarFlujo,ROL_POR_ESTADO={},setTab}){
  const[tabF,setTabF]=useState("resumen") // 18-oct-2026: pestaña activa de la ficha
  const[regPagoOC,setRegPagoOC]=useState(null) // 19-oct-2026: registrar pago con comprobante desde la pestaña Pagos
  const puedeRegPago=["admin","dir_general","dir_negocios","dir_finanzas","jefe_admin_finanzas","analista"].includes(cu?.rol)
  const TC_USD=Number(config.tc_usd)||950
  const[rf,setRf]=useState(hoy());const[rr,setRr]=useState(cu?.nombre||"Jefe Bodega");const[rd,setRd]=useState("");const isI=oc.tipo_oc==="Importación"
  const[items,setItems]=useState([]);const[recQty,setRecQty]=useState({});const[provQty,setProvQty]=useState({});const[provNotas,setProvNotas]=useState("")
  // ⭐ v48: Checkbox de confirmación explícita cantidad por cantidad
  const[provVerificado,setProvVerificado]=useState(false)
  const[docs,setDocs]=useState([]);const[uploading,setUploading]=useState(false);const[pendingFiles,setPendingFiles]=useState([]);const[saveMsg,setSaveMsg]=useState("")
  // ⭐ v47: comentario obligatorio para transiciones desde el detalle
  const[commentDet,setCommentDet]=useState("")

  // ⭐ Split de OC
  const[showSplit,setShowSplit]=useState(false)
  const[splitQty,setSplitQty]=useState({}) // {item_id: cantidadParteA}
  const[splitEtaA,setSplitEtaA]=useState(oc.fecha_estimada||"")
  const[splitEtaB,setSplitEtaB]=useState("")
  const[splitSaving,setSplitSaving]=useState(false)

  const abrirSplit=()=>{
    // Inicializar con 50% de cada item
    const ini={}
    items.forEach(i=>{ini[i.id]=Math.ceil((i.cantidad_pedida||0)/2)})
    setSplitQty(ini);setSplitEtaA(oc.fecha_estimada||"");setSplitEtaB("");setShowSplit(true)
  }

  const ejecutarSplit=async()=>{
    // Validar que todas las cantidades sumen igual a la original
    const errores=items.filter(i=>{
      const a=Number(splitQty[i.id])||0
      const b=(i.cantidad_pedida||0)-a
      return a<0||b<0||(a+b)!==(i.cantidad_pedida||0)
    })
    if(errores.length>0){alert(`⚠ Las cantidades no cuadran en ${errores.length} producto(s). Verifica que Parte A + Parte B = cantidad original.`);return}
    if(!splitEtaA||!splitEtaB){alert("⚠ Ingresa la fecha de llegada de ambas partes.");return}
    if(!window.confirm(`¿Dividir ${oc.id} en dos partes?

• ${oc.id}-A → ETA: ${splitEtaA}
• ${oc.id}-B → ETA: ${splitEtaB}

La OC original pasará a estado "Dividida".`))return

    setSplitSaving(true)
    try{
      // Calcular totales de cada parte
      const totalA=items.reduce((s,i)=>{const a=Number(splitQty[i.id])||0;return s+a*(i.costo_unitario||0)},0)
      const totalB=items.reduce((s,i)=>{const a=Number(splitQty[i.id])||0;const b=(i.cantidad_pedida||0)-a;return s+b*(i.costo_unitario||0)},0)
      const totalOrig=totalA+totalB
      const pctA=totalOrig>0?totalA/totalOrig:0.5
      const pctB=1-pctA

      // Crear OC-A
      const idA=oc.id+"-A"
      const idB=oc.id+"-B"
      const base={
        tipo_oc:oc.tipo_oc,proveedor_id:oc.proveedor_id,
        estado:oc.estado,fase_actual:oc.fase_actual,
        condicion_pago:oc.condicion_pago,
        pct_fab:oc.pct_fab,pct_embarque:oc.pct_embarque,pct_puerto:oc.pct_puerto,
        estado_pago:"Pago pend.",notas:oc.notas,
        destino_sucursal_id:oc.destino_sucursal_id,
        oc_padre_id:oc.id,oc_tipo:"split"
      }
      const ocA={...base,id:idA,fecha_creacion:hoy(),
        total_usd:isI?Math.round(totalA):0,
        total_clp:isI?Math.round(totalA*TC_USD):Math.round(totalA*1.19),
        total_neto:!isI?Math.round(totalA):0,
        iva_monto:!isI?Math.round(totalA*0.19):0,
        fecha_estimada:splitEtaA
      }
      const ocB={...base,id:idB,fecha_creacion:hoy(),
        total_usd:isI?Math.round(totalB):0,
        total_clp:isI?Math.round(totalB*TC_USD):Math.round(totalB*1.19),
        total_neto:!isI?Math.round(totalB):0,
        iva_monto:!isI?Math.round(totalB*0.19):0,
        fecha_estimada:splitEtaB
      }
      const{error:eA}=await supabase.from('ordenes_compra').insert(ocA)
      if(eA){alert("Error creando OC-A: "+eA.message);setSplitSaving(false);return}
      const{error:eB}=await supabase.from('ordenes_compra').insert(ocB)
      if(eB){alert("Error creando OC-B: "+eB.message);setSplitSaving(false);return}

      // Items de cada parte
      const itemsA=items.filter(i=>(Number(splitQty[i.id])||0)>0).map(i=>({
        id:uid(),oc_id:idA,sku:i.sku,producto:i.producto,
        cantidad_sugerida:i.cantidad_sugerida||0,
        cantidad_pedida:Number(splitQty[i.id])||0,
        costo_unitario:i.costo_unitario||0
      }))
      const itemsB=items.filter(i=>((i.cantidad_pedida||0)-(Number(splitQty[i.id])||0))>0).map(i=>({
        id:uid(),oc_id:idB,sku:i.sku,producto:i.producto,
        cantidad_sugerida:0,
        cantidad_pedida:(i.cantidad_pedida||0)-(Number(splitQty[i.id])||0),
        costo_unitario:i.costo_unitario||0
      }))
      if(itemsA.length>0)await supabase.from('oc_items').insert(itemsA)
      if(itemsB.length>0)await supabase.from('oc_items').insert(itemsB)

      // Firmas heredadas
      const firmasBase=firmas.map(f=>({
        ...f,id:uid(),oc_id:idA,accion:f.accion+" (heredada del split de "+oc.id+")"
      }))
      const firmasB=firmas.map(f=>({
        ...f,id:uid(),oc_id:idB,accion:f.accion+" (heredada del split de "+oc.id+")"
      }))
      if(firmasBase.length>0)await supabase.from('firmas').insert(firmasBase)
      if(firmasB.length>0)await supabase.from('firmas').insert(firmasB)

      // Registrar el split en las firmas de cada hija
      await supabase.from('firmas').insert([
        {id:uid(),oc_id:idA,nombre_usuario:cu.nombre,rol_usuario:cu.rol,accion:`OC dividida desde ${oc.id} (Parte A · ETA ${splitEtaA})`,fecha:hoy(),hora:hora()},
        {id:uid(),oc_id:idB,nombre_usuario:cu.nombre,rol_usuario:cu.rol,accion:`OC dividida desde ${oc.id} (Parte B · ETA ${splitEtaB})`,fecha:hoy(),hora:hora()}
      ])

      // Marcar OC madre como dividida
      await updOC(oc.id,{estado:"Dividida",oc_tipo:"madre_split"})
      await addFirma(oc.id,`OC dividida en ${idA} (${pct(pctA)} · ETA ${splitEtaA}) y ${idB} (${pct(pctB)} · ETA ${splitEtaB}) por ${cu.nombre}`)

      setShowSplit(false);setSplitSaving(false)
      alert(`✓ OC dividida exitosamente.

• ${idA} creada (ETA: ${splitEtaA})
• ${idB} creada (ETA: ${splitEtaB})

La OC original ${oc.id} quedó en estado "Dividida".`)
      close()
    }catch(e){alert("Error en split: "+e.message);setSplitSaving(false)}
  }

  useEffect(()=>{supabase.from('oc_items').select('*').eq('oc_id',oc.id).then(r=>{const d=r.data||[];setItems(d);const q={};const pq={};d.forEach(i=>{q[i.id]=i.cantidad_pedida||0;pq[i.id]=i.cantidad_confirmada||i.cantidad_pedida||0});setRecQty(q);setProvQty(pq)})},[oc.id])
  useEffect(()=>{supabase.from('documentos_import').select('*').eq('oc_id',oc.id).order('created_at',{ascending:false}).then(r=>{console.log("Loaded docs for OC:",oc.id,r.data?.length,"docs",r.error);setDocs(r.data||[])})},[oc.id])

  // ⭐ Recepciones parciales (guías + facturas)
  const prov=provs.find(p=>p.id===oc.proveedor_id)
  const facturaConGuia=prov?.factura_con_guia||false
  const[recepciones,setRecepciones]=useState([])
  const[adjLog,setAdjLog]=useState([])   // adjuntos físicos cargados en Logística (recepciones vinculadas)
  const[costeos,setCosteos]=useState([])
  useEffect(()=>{if(!isI){setCosteos([]);return};supabase.from('costeos_oc').select('*').eq('oc_id',oc.id).order('created_at',{ascending:false}).then(r=>setCosteos(r.data||[]))},[oc.id])
  const eliminarCosteo=async(c)=>{
    // ⭐ v48: Protección de costeos cuando la OC está cerrada
    const ocEstaCerrada=oc.estado==="Cerrada"
    const esAdmin=cu?.rol==="admin"

    if(ocEstaCerrada&&!esAdmin){
      alert(`🔒 Costeo bloqueado\n\nNo puedes eliminar este costeo porque la OC ${oc.id} está CERRADA.\n\nLos costeos de OCs cerradas son parte de la auditoría contable y solo el administrador puede modificarlos en casos excepcionales.`)
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
  const[recForm,setRecForm]=useState({tipo:"guia",numero_doc:"",fecha:hoy(),monto:"",moneda:"CLP",archivo:null,archivoNombre:"",notas:"",itemsQty:{},facturasVinculadas:[],regularizacion:false})

  useEffect(()=>{supabase.from('recepciones').select('*').eq('oc_id',oc.id).order('fecha',{ascending:true}).then(r=>setRecepciones(r.data||[]))},[oc.id])
  useEffect(()=>{(async()=>{if(!recepciones.length){setRecepcionItems([]);setRecepcionLinks([]);return}const ids=recepciones.map(r=>r.id);const[ri,rl]=await Promise.all([supabase.from('recepciones_items').select('*').in('recepcion_id',ids),supabase.from('recepciones_link').select('*').or(`guia_id.in.(${ids.join(',')}),factura_id.in.(${ids.join(',')})`)]);setRecepcionItems(ri.data||[]);setRecepcionLinks(rl.data||[])
    const logIds=recepciones.map(r=>r.log_recepcion_id).filter(Boolean)
    if(logIds.length){const{data:aj}=await supabase.from('log_recepcion_adjuntos').select('recepcion_id,slot,nombre,url,link_externo').in('recepcion_id',logIds);setAdjLog(aj||[])}else setAdjLog([])
  })()},[recepciones])

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
    setRecForm({tipo:tipo||(facturaConGuia?"guia_factura":"guia"),numero_doc:"",fecha:hoy(),monto:"",moneda:esImp?"USD":"CLP",archivo:null,archivoNombre:"",notas:"",itemsQty,facturasVinculadas:[],regularizacion:false})
    setShowRecModal(true)
  }

  const[guardandoRec,setGuardandoRec]=useState(false)
  const guardarRecepcion=async()=>{
    // Canal doble con puente vivo: admin y ANALISTAS registran guías y facturas
    // desde Compras — cada guía se espeja automáticamente a Logística, así que
    // nada queda invisible. Otros roles: solo facturas.
    if(!["admin","analista"].includes(cu?.rol)&&recForm.tipo!=="factura"){alert("Tu rol no registra guías desde Compras.\nLas guías se recepcionan en Logística o las registra el equipo de compras; las facturas sí puedes registrarlas aquí.");return}
    if(guardandoRec)return
    if(!recForm.numero_doc.trim()){alert("⚠ Falta el número de documento");return}
    const itemsConCant=items.filter(i=>Number(recForm.itemsQty[i.id]||0)>0)
    if(itemsConCant.length===0){alert("⚠ Ingresa al menos un ítem con cantidad > 0");return}
    // ⭐ Sobre-entrega PERMITIDA con confirmación: el proveedor puede despachar
    //    más unidades de las pedidas y hay que poder registrarlo. Antes se
    //    bloqueaba con alert y no había forma de cargar el excedente.
    const tipoEsRec=recForm.tipo==="guia"||recForm.tipo==="guia_factura"
    const tipoEsFac=recForm.tipo==="factura"||recForm.tipo==="guia_factura"
    const excesos=[]
    for(const it of itemsConCant){
      const cant=Number(recForm.itemsQty[it.id])
      if(tipoEsRec){const pend=(it.cantidad_pedida||0)-(accRecibido[it.sku]||0);if(cant>pend)excesos.push({p:it.producto,cant,pend,dif:cant-pend,tipo:"recibida"})}
      else if(tipoEsFac){const pend=(it.cantidad_pedida||0)-(accFacturado[it.sku]||0);if(cant>pend)excesos.push({p:it.producto,cant,pend,dif:cant-pend,tipo:"facturada"})}
    }
    if(excesos.length>0){
      const det=excesos.slice(0,8).map(e=>`• ${(e.p||"").slice(0,45)}: ${e.tipo} ${fN(e.cant)} vs pendiente ${fN(e.pend)} (+${fN(e.dif)})`).join("\n")
      if(!window.confirm(`⚠ SOBRE-ENTREGA detectada en ${excesos.length} ítem(s):\n\n${det}${excesos.length>8?`\n… y ${excesos.length-8} más`:""}\n\nSe registrará la cantidad real entregada (mayor a lo pedido) y quedará señalada en la bitácora.\n\n¿Confirmar el registro?`))return
    }
    if(tipoEsFac&&(!recForm.monto||Number(recForm.monto)<=0)){alert("⚠ Factura: el monto es obligatorio");return}

    setGuardandoRec(true)
    try{
    // Subir archivo si hay
    let archivo_url="",archivo_nombre=""
    if(recForm.archivo){
      const sanitize=s=>(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"_").replace(/_+/g,"_")
      const ext=(recForm.archivoNombre||"").split(".").pop()||"pdf"
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
    const{error:riErr}=await supabase.from('recepciones_items').insert(itemsRows)
    if(riErr){
      // Sin detalle por SKU el documento corrompe el acumulado de la OC
      // (caso guía 123456 · 04-08-2026): rollback de la cabecera y abortar.
      await supabase.from('recepciones').delete().eq('id',recId)
      alert("❌ No se pudo guardar el detalle de ítems: "+riErr.message+"\n\nLa recepción NO quedó registrada. Reintenta.")
      return
    }

    // Si es factura y hay guías vinculadas, crear links
    if(recForm.tipo==="factura"&&recForm.facturasVinculadas.length>0){
      const links=recForm.facturasVinculadas.map(gId=>({id:uid(),guia_id:gId,factura_id:recId}))
      await supabase.from('recepciones_link').insert(links)
    }

    // Registrar en firmas
    const labelTipo=recForm.tipo==="guia"?"Guía":recForm.tipo==="factura"?"Factura":"Guía+Factura"
    const totalCant=itemsConCant.reduce((s,i)=>s+Number(recForm.itemsQty[i.id]),0)
    const notaExceso=excesos.length>0?` · ⚠ SOBRE-ENTREGA en ${excesos.length} ítem(s): ${excesos.slice(0,3).map(e=>`${(e.p||"").slice(0,28)} +${fN(e.dif)}`).join(", ")}${excesos.length>3?"…":""}`:""
    await addFirma(oc.id,`${labelTipo} #${recForm.numero_doc} registrada: ${totalCant} uds${tipoEsFac?` · ${recForm.moneda} ${fN(recForm.monto)}`:""}${notaExceso}`)

    // ── Puente Compras → Logística (Modelo A · 05-08-2026): las GUÍAS crean
    //    una recepción PENDIENTE en log_recepciones — tarea para que bodega
    //    ejecute el proceso físico (inspección, bultos, ingreso BSALE, WMS).
    //    Con "Regularización" marcada nace completada (mercadería ya recibida).
    //    Siempre viaja completo: detalle por SKU, sucursal CD y adjunto.
    //    Las facturas no se espejan: son documentales y viven solo en Compras. ──
    if(recForm.tipo!=="factura"){
      try{
        const{data:yaEsp}=await supabase.from('log_recepciones').select('id').eq('compras_recepcion_id',recId).maybeSingle()
        if(!yaEsp){
          const esReg=!!recForm.regularizacion
          const{data:esp,error:eEsp}=await supabase.from('log_recepciones').insert({
            tipo_recepcion:oc.id?.startsWith("OC-IMP-")?"proveedor_internacional":"proveedor_nacional",
            tipo_documento:recForm.tipo, numero_documento:recForm.numero_doc,
            proveedor:prov?.nombre||"", orden_compra:oc.id, fecha_recepcion:recForm.fecha,
            responsable:cu?.nombre||"ERP Compras", estado:esReg?"completado":"pendiente",
            cantidad_total:totalCant, creado_por:"espejo_compras", compras_recepcion_id:recId,
            sucursal_codigo:"cd_mp", sucursal_nombre:"CD Maipu",
            completado_at:esReg?new Date().toISOString():null,
            completado_por:esReg?(cu?.nombre||"ERP Compras"):null,
            notas:esReg
              ?"[Origen: ERP Compras] Regularización: guía registrada en Compras — mercadería ya recibida en bodega."
              :"[Origen: ERP Compras] Guía registrada en Compras — recepción física PENDIENTE en bodega (inspección, bultos, ingreso BSALE)."
          }).select('id').single()
          if(!eEsp&&esp){
            await supabase.from('recepciones').update({log_recepcion_id:esp.id}).eq('id',recId)
            // Detalle por SKU — mismo detalle que recepciones_items, con costo de la OC
            const espItems=itemsConCant.map(it=>({
              recepcion_id:esp.id, sku:it.sku, producto:it.producto||it.sku,
              cantidad:Number(recForm.itemsQty[it.id])||0,
              costo_unitario:Number(it.costo_unitario)||0,
              notas_item:"[Espejo ERP Compras]"
            }))
            if(espItems.length>0){
              const{error:eEI}=await supabase.from('log_recepcion_items').insert(espItems)
              if(eEI)console.error("[espejo items]",eEI)
            }
            // Adjunto de la guía → slot doc_proveedor en Logística
            if(archivo_url){
              const{error:eEA}=await supabase.from('log_recepcion_adjuntos').insert({
                recepcion_id:esp.id, slot:"doc_proveedor",
                nombre:archivo_nombre||"Documento proveedor",
                tipo:(archivo_nombre||"").split(".").pop()?.toLowerCase()||"pdf",
                url:archivo_url, path:null, link_externo:null,
                subido_por:cu?.nombre||"ERP Compras"
              })
              if(eEA)console.error("[espejo adjunto]",eEA)
            }
          }
        }
      }catch(eB){console.error("[espejo compras→logística]",eB)}
    }

    // Recargar
    const{data:recs}=await supabase.from('recepciones').select('*').eq('oc_id',oc.id).order('fecha',{ascending:true})
    setRecepciones(recs||[])

    // Auto-actualizar estado de la OC
    const nuevoAccRecibido={...accRecibido}
    if(tipoEsRec){itemsConCant.forEach(it=>{nuevoAccRecibido[it.sku]=(nuevoAccRecibido[it.sku]||0)+Number(recForm.itemsQty[it.id])})}
    const nuevoTotalRecibido=Object.values(nuevoAccRecibido).reduce((s,v)=>s+v,0)
    const nuevoPctRecibido=totalPedidoOC>0?nuevoTotalRecibido/totalPedidoOC*100:0
    if(tipoEsRec){
      if(nuevoPctRecibido>=100)await updOC(oc.id,{estado:"Recibida OK",fase_actual:esImp?11:6,fecha_real_recepcion:recForm.fecha,recepcion_cuadrada:true,recepcion_forzada:false})
      else if(nuevoPctRecibido>0)await updOC(oc.id,{estado:"Recibida parcial",fase_actual:esImp?11:6,fecha_real_recepcion:oc.fecha_real_recepcion||recForm.fecha,recepcion_cuadrada:false})
    }

    setShowRecModal(false)
    }catch(e){
      console.error("[guardarRecepcion]",e)
      alert("⚠ Error inesperado registrando la recepción: "+(e?.message||e)+"\n\nLa app sigue funcionando. Revisa la consola (F12) y reportá este mensaje.")
    }finally{
      setGuardandoRec(false)
    }
  }

  const eliminarRecepcion=async(rec)=>{
    if(!window.confirm(`¿Eliminar ${rec.tipo==="guia"?"guía":rec.tipo==="factura"?"factura":"documento"} #${rec.numero_doc}?`))return
    await supabase.from('recepciones').delete().eq('id',rec.id)
    const{data:recs}=await supabase.from('recepciones').select('*').eq('oc_id',oc.id).order('fecha',{ascending:true})
    setRecepciones(recs||[])
    await addFirma(oc.id,`Eliminada ${rec.tipo==="guia"?"guía":"factura"} #${rec.numero_doc}`)
  }

  // ⭐ Edición de items post-creación
  const estadosBloqueados=["Recibida OK","Recibida parcial","Cerrada","Rechazada","Dividida","Fusionada","Anulada"]
  const tienePermisoEdicion=h("aprobar_neg")||h("aprobar_fin")||h("crear_oc")||cu?.rol==="admin"||cu?.rol==="dir_general"
  const puedeEditarItems=!estadosBloqueados.includes(oc.estado)&&tienePermisoEdicion
  const[editingItem,setEditingItem]=useState(null)
  const[editDraft,setEditDraft]=useState({})
  const[addingItem,setAddingItem]=useState(false)
  const[newItem,setNewItem]=useState({producto:"",sku:"",cantidad_pedida:0,costo_unitario:0})
  const[savingEdit,setSavingEdit]=useState(false)

  const startEditItem=(it)=>{setEditingItem(it.id);setEditDraft({producto:it.producto||"",cantidad_pedida:it.cantidad_pedida||0,costo_unitario:it.costo_unitario||0})}
  const cancelEdit=()=>{setEditingItem(null);setEditDraft({})}

  // ⭐ Recalcula el plan de pago tras cambio en items.
  // Preserva % de cada cuota Pendiente, respeta cuotas Pagadas (no las toca),
  // y reparte el saldo nuevo entre las pendientes según su % relativo.
  const recalcPlanPago=async(nuevoTotalCLP,nuevoTotalUSD=null)=>{
    const pagosOC=(pagos||[]).filter(p=>p.oc_id===oc.id)
    if(pagosOC.length===0)return
    // Fase 0: recalcula en la moneda de las cuotas (antes dejaba pesos en cuotas USD)
    const nuevoTotal=(pagosOC[0]?.moneda==="USD"&&nuevoTotalUSD!=null)?nuevoTotalUSD:nuevoTotalCLP
    const pendientes=pagosOC.filter(p=>p.estado==="Pendiente")
    const pagadas=pagosOC.filter(p=>p.estado!=="Pendiente")
    const montoPagado=pagadas.reduce((s,p)=>s+(p.monto||0),0)
    const saldoPendiente=Math.max(0,nuevoTotal-montoPagado)
    if(pendientes.length===0){
      if(Math.abs(nuevoTotal-montoPagado)>2){
        await addFirma(oc.id,`⚠ Plan de pago no recalculado: todas las cuotas están pagadas (total pagado $${fN(montoPagado)} vs nuevo total $${fN(nuevoTotal)})`)
      }
      return
    }
    const sumaPctPend=pendientes.reduce((s,p)=>s+(p.pct||0),0)
    const nuevoPagos=[]
    if(sumaPctPend<=0){
      const cuotaPareja=Math.round(saldoPendiente/pendientes.length)
      let acum=0
      pendientes.forEach((p,i)=>{
        const monto=i===pendientes.length-1?saldoPendiente-acum:cuotaPareja
        acum+=monto
        nuevoPagos.push({id:p.id,monto,pct:Math.round(100/pendientes.length*10)/10})
      })
    }else{
      let acum=0
      pendientes.forEach((p,i)=>{
        const pctRel=(p.pct||0)/sumaPctPend
        const monto=i===pendientes.length-1?saldoPendiente-acum:Math.round(saldoPendiente*pctRel)
        acum+=monto
        const pctSobreTotal=nuevoTotal>0?Math.round((monto/nuevoTotal)*1000)/10:0
        nuevoPagos.push({id:p.id,monto,pct:pctSobreTotal})
      })
    }
    for(const np of nuevoPagos){
      await supabase.from('pagos').update({monto:np.monto,pct:np.pct}).eq('id',np.id)
    }
    if(typeof setPagos==='function'){
      setPagos(prev=>prev.map(p=>{const u=nuevoPagos.find(x=>x.id===p.id);return u?{...p,monto:u.monto,pct:u.pct}:p}))
    }
    await addFirma(oc.id,`Plan de pago recalculado por cambio de items: ${pendientes.length} cuota(s) actualizada(s), nuevo total $${fN(nuevoTotal)}`)
  }

  // Fase 0 (decisión JP 17-oct-2026): cambiar cantidad o costo después de aprobar vuelve la OC a aprobación
  const reaprobRef=useRef(false)
  const exigirReaprobacion=async(detalle)=>{
    if(reaprobRef.current||oc.estado==="Pend. Dir. Negocios"||oc.estado==="Borrador"||oc.reaprobacion_pendiente)return
    reaprobRef.current=true
    const pv=provs.find(p=>p.id===oc.proveedor_id)
    if(["Proyectar costeo","Pend. Dir. Finanzas"].includes(oc.estado)){
      await updOC(oc.id,{estado:"Pend. Dir. Negocios",fase_actual:1})
      await addFirma(oc.id,`↩ Vuelve a aprobación de Dir. Negocios por cambio de ítems: ${detalle}`)
      if(notificarFlujo)await notificarFlujo({ocId:oc.id,tipo:"Email",nuevoEstado:"Pend. Dir. Negocios",asunto:`${oc.id} vuelve a aprobación por cambio de ítems`,mensaje:`La OC ${oc.id} (${pv?.nombre||oc.proveedor_id}) cambió sus ítems y vuelve a aprobación de Dir. Negocios.\n\nDetalle: ${detalle}\nModificado por: ${cu?.nombre}`})
      alert(`${oc.id} vuelve a aprobación de Dir. Negocios por el cambio de ítems.`)
      return
    }
    await updOC(oc.id,{reaprobacion_pendiente:true,reaprobacion_motivo:detalle,reaprobacion_desde:new Date().toISOString(),reaprobacion_neg_por:null,reaprobacion_fin_por:null})
    await addFirma(oc.id,`⚠ Cambio de ítems con la OC ya aprobada (${oc.estado}): ${detalle}. Requiere re-aprobación de Dir. Negocios y Dir. Finanzas`)
    if(notificarFlujo){for(const est of["Pend. Dir. Negocios","Pend. Dir. Finanzas"])await notificarFlujo({ocId:oc.id,tipo:"Email",nuevoEstado:est,asunto:`${oc.id} requiere re-aprobación por cambio de ítems`,mensaje:`La OC ${oc.id} (${pv?.nombre||oc.proveedor_id}) cambió sus ítems después de aprobada. Estado logístico: ${oc.estado}.\n\nDetalle: ${detalle}\nModificado por: ${cu?.nombre}\n\nLa OC no puede avanzar de etapa hasta la re-aprobación.`})}
    alert(`${oc.id} queda pendiente de re-aprobación de Dir. Negocios y Dir. Finanzas. No podrá avanzar de etapa hasta entonces.`)
  }
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
    const nuevoNeto=newItems.reduce((s,x)=>s+((x.cantidad_pedida||0)*(x.costo_unitario||0)),0)
    const nuevoTotalCLP=isI?Math.round(nuevoNeto*TC_USD):Math.round(nuevoNeto*1.19)
    await updOC(oc.id,isI?{total_clp:nuevoTotalCLP,total_usd:Math.round(nuevoNeto),total_neto:0,iva_monto:0}:{total_clp:nuevoTotalCLP,total_usd:0,total_neto:Math.round(nuevoNeto),iva_monto:Math.round(nuevoNeto*0.19)})
    await addFirma(oc.id,`Item editado: ${it.sku} (${Object.entries(changes).map(([k,v])=>`${k}:${typeof v==='number'?fN(v):v}`).join(", ")})`)
    await recalcPlanPago(nuevoTotalCLP,isI?Math.round(nuevoNeto):null)
    await exigirReaprobacion(`ítem ${it.sku} editado (${Object.keys(changes).join(", ")}); nuevo total ${isI?fU(nuevoNeto):fmt(nuevoTotalCLP)}`)
    setEditingItem(null);setEditDraft({});setSavingEdit(false)
  }

  const deleteItem=async(it)=>{
    if(!window.confirm(`¿Eliminar "${it.producto}" (${it.sku}) de la OC?`))return
    setSavingEdit(true)
    const{error}=await supabase.from('oc_items').delete().eq('id',it.id)
    if(error){alert("Error: "+error.message);setSavingEdit(false);return}
    const newItems=items.filter(x=>x.id!==it.id);setItems(newItems)
    const nuevoNeto=newItems.reduce((s,x)=>s+((x.cantidad_pedida||0)*(x.costo_unitario||0)),0)
    const nuevoTotalCLP=isI?Math.round(nuevoNeto*TC_USD):Math.round(nuevoNeto*1.19)
    await updOC(oc.id,isI?{total_clp:nuevoTotalCLP,total_usd:Math.round(nuevoNeto),total_neto:0,iva_monto:0}:{total_clp:nuevoTotalCLP,total_usd:0,total_neto:Math.round(nuevoNeto),iva_monto:Math.round(nuevoNeto*0.19)})
    await addFirma(oc.id,`Item eliminado: ${it.sku} — ${it.producto}`)
    await recalcPlanPago(nuevoTotalCLP,isI?Math.round(nuevoNeto):null)
    await exigirReaprobacion(`ítem ${it.sku} eliminado; nuevo total ${isI?fU(nuevoNeto):fmt(nuevoTotalCLP)}`)
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
    const nuevoNeto=newItems.reduce((s,x)=>s+((x.cantidad_pedida||0)*(x.costo_unitario||0)),0)
    const nuevoTotalCLP=isI?Math.round(nuevoNeto*TC_USD):Math.round(nuevoNeto*1.19)
    await updOC(oc.id,isI?{total_clp:nuevoTotalCLP,total_usd:Math.round(nuevoNeto),total_neto:0,iva_monto:0}:{total_clp:nuevoTotalCLP,total_usd:0,total_neto:Math.round(nuevoNeto),iva_monto:Math.round(nuevoNeto*0.19)})
    await addFirma(oc.id,`Item agregado: ${newItem.sku||"MANUAL"} — ${newItem.producto} (${fN(newItem.cantidad_pedida)} × ${fmt(newItem.costo_unitario)})`)
    await recalcPlanPago(nuevoTotalCLP,isI?Math.round(nuevoNeto):null)
    await exigirReaprobacion(`ítem ${row.sku} agregado; nuevo total ${isI?fU(nuevoNeto):fmt(nuevoTotalCLP)}`)
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
        alert(`⚠ No puedes avanzar sin un costeo FINAL registrado.\n\nLa OC ${oc.id} ya tiene el costeo proyectado pero falta el costeo final con los gastos reales de internación.\n\nPasos:\n1. Abre el módulo "Costeo IMP" en el menú inferior\n2. Selecciona la OC ${oc.id}\n3. Actualizá los gastos con los valores reales\n4. Presioná "Anexar a OC" (se guardará como costeo FINAL porque la OC está en Internación)\n5. Vuelve acá y presioná el botón de nuevo`)
        return
      }
    }
    if(oc.reaprobacion_pendiente&&nE!=="Rechazada"){alert(`⚠ ${oc.id} tiene un cambio de ítems pendiente de re-aprobación. Primero deben re-aprobar Dir. Negocios y Dir. Finanzas (desde Órdenes).`);return}
    let excepcion=""
    if(nE==="Cerrada"){const faltan=await validarCierreOC(oc);if(faltan.length){if(cu?.rol==="admin"){const m=window.prompt(`Para cerrar ${oc.id} falta:\n• ${faltan.join("\n• ")}\n\nComo admin puedes cerrar por excepción. Escribe el motivo (mínimo 15 caracteres):`);if(!m||m.trim().length<15)return;excepcion=` · CIERRE POR EXCEPCIÓN (falta: ${faltan.join(", ")}) — motivo: ${m.trim()}`}else{alert(`No se puede cerrar ${oc.id}. Falta:\n• ${faltan.join("\n• ")}`);return}}}
    const accionFull=`${a} — "${comment}"${excepcion}`
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
    try{
      const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=()=>rej(new Error("No se pudo leer el archivo"));r.readAsDataURL(file)})
      setPendingFiles(p=>[...p,{id:uid(),tipo,nombre_archivo:file.name,url_archivo:base64,descripcion,size:file.size}])
    }catch(e){
      console.error("[stageFile]",e)
      alert("⚠ Error leyendo el archivo: "+(e?.message||e))
    }
  }

  // Remove a staged file
  const unstageFile=(id)=>setPendingFiles(p=>p.filter(f=>f.id!==id))

  // SAVE ALL — persist all pending files to Supabase
  const saveAllDocs=async()=>{
    if(pendingFiles.length===0||uploading)return
    setUploading(true);setSaveMsg("")
    let saved=0;let errors=[]
    const savedIds=new Set()
    try{
    const sanitize=s=>(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"_").replace(/_+/g,"_")
    for(const f of pendingFiles){
      try{
        // ⭐ Convertir base64 → Blob y subir a Storage (bucket 'comprobantes').
        //    Guardamos solo la URL pública en documentos_import.url_archivo,
        //    igual que en guardarRecepcion. Evita blobs gigantes en BD y
        //    el problema de data-URLs truncadas al abrir en pestaña.
        const dataUrl=String(f.url_archivo||"")
        const comaIdx=dataUrl.indexOf(",")
        if(!dataUrl.startsWith("data:")||comaIdx<0)throw new Error("Formato del archivo inválido")
        const header=dataUrl.slice(5,comaIdx) // ej: application/pdf;base64
        const mime=header.split(";")[0]||"application/octet-stream"
        const b64=dataUrl.slice(comaIdx+1)
        const bin=atob(b64)
        const bytes=new Uint8Array(bin.length)
        for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i)
        const blob=new Blob([bytes],{type:mime})
        const ext=(f.nombre_archivo||"").split(".").pop()||"pdf"
        const path=`${sanitize(oc.id)}/${sanitize(f.tipo)}_${Date.now()}_${sanitize((f.nombre_archivo||"doc").replace(/\.[^.]+$/,""))}.${ext}`
        console.log(`Uploading ${f.nombre_archivo} (${Math.round(blob.size/1024)}KB, ${mime}) to Storage as ${path}`)
        const{error:upErr}=await supabase.storage.from('comprobantes').upload(path,blob,{contentType:mime,upsert:false})
        if(upErr)throw new Error("Storage: "+upErr.message)
        const{data:urlData}=supabase.storage.from('comprobantes').getPublicUrl(path)
        const publicUrl=urlData?.publicUrl||""
        // Insertar metadatos en la BD (sin base64, solo la URL)
        const doc={id:f.id,oc_id:oc.id,tipo_documento:f.tipo,nombre_documento:f.descripcion||f.tipo,nombre_archivo:f.nombre_archivo,url_archivo:publicUrl,descripcion:f.descripcion||f.tipo,subido_por:cu.nombre,fecha_subida:hoy(),hora_subida:hora(),etapa:oc.estado||"",estado:"Adjunto",monto:0,moneda:"CLP",fecha_documento:hoy()}
        const{error}=await supabase.from('documentos_import').insert(doc)
        if(error)throw new Error("BD: "+error.message)
        saved++
        savedIds.add(f.id)
        setDocs(p=>[doc,...p])
        console.log(`✓ Saved ${f.nombre_archivo} → ${publicUrl}`)
      }catch(e){
        console.error("Error guardando",f.nombre_archivo,e)
        errors.push(`${f.nombre_archivo}: ${e?.message||e}`)
      }
    }
    if(saved>0){
      await addFirma(oc.id,`📎 ${saved} documento(s) adjuntado(s) a la OC`)
      setPendingFiles(p=>p.filter(f=>!savedIds.has(f.id))) // solo saca los que sí se guardaron
      setSaveMsg(`✅ ${saved} documento(s) guardado(s) en la OC`)
    }
    if(errors.length>0){setSaveMsg(p=>(p||"")+` ⚠ Errores: ${errors.join(" · ")}`)}
    }catch(e){
      console.error("[saveAllDocs]",e)
      setSaveMsg("⚠ Error inesperado: "+(e?.message||e))
    }finally{
      setUploading(false)
      setTimeout(()=>setSaveMsg(""),8000)
    }
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
    return<div style={{background:"#F4F5F7",borderRadius:10,padding:12,marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:"#1C1C1E"}}>{label}</div><div style={{fontSize:12,color:"#6E6E73"}}>{desc}</div></div>
        <label style={{padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:600,background:"#1D4E89",color:"#fff",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}>
          📎 Seleccionar
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f)stageFile(f,tipo,label);e.target.value=""}}/>
        </label>
      </div>
      {/* Pending (not yet saved) */}
      {pending.map(f=><div key={f.id} style={{display:"flex",alignItems:"center",gap:8,marginTop:8,padding:10,background:"#FFF9E6",borderRadius:8,border:"1px solid #B25E0940"}}>
        <span style={{fontSize:16}}>⏳</span>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"#B25E09"}}>{f.nombre_archivo}</div><div style={{fontSize:11,color:"#B25E09"}}>Pendiente de guardar · {Math.round(f.size/1024)}KB</div></div>
        <button onClick={()=>unstageFile(f.id)} style={{padding:"4px 8px",borderRadius:6,fontSize:11,fontWeight:600,background:"#B4231812",color:"#B42318",border:"none",cursor:"pointer"}}>✕</button>
      </div>)}
      {/* Saved documents */}
      {savedDocs.map(d=><div key={d.id} style={{display:"flex",alignItems:"center",gap:8,marginTop:8,padding:10,background:"#fff",borderRadius:8,border:"1px solid #1E7A4450"}}>
        <span style={{fontSize:16}}>{d.nombre_archivo?.match(/\.pdf$/i)?"📄":"🖼"}</span>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"#1C1C1E",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.nombre_archivo}</div><div style={{fontSize:11,color:"#1E7A44"}}>✓ Guardado · {d.subido_por} — {d.fecha_subida} {d.hora_subida}</div></div>
        <div style={{display:"flex",gap:4,flexShrink:0}}>
          <button onClick={()=>{
            const u=d.url_archivo
            if(!u){alert("El archivo no se puede visualizar");return}
            // URL de Storage o cualquier http(s): abrir directo (funciona con archivos grandes)
            if(!u.startsWith("data:")){window.open(u,"_blank","noopener");return}
            // Documentos antiguos guardados como data-URL: convertir a Blob URL para evitar
            // el límite de tamaño de URLs en el navegador (Chrome ~2MB).
            try{
              const comaIdx=u.indexOf(",")
              const mime=u.slice(5,comaIdx).split(";")[0]||"application/octet-stream"
              const bin=atob(u.slice(comaIdx+1))
              const bytes=new Uint8Array(bin.length)
              for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i)
              const blobUrl=URL.createObjectURL(new Blob([bytes],{type:mime}))
              window.open(blobUrl,"_blank","noopener")
              // No revoco la URL para que la pestaña abierta pueda seguir usándola
            }catch(e){
              console.error("Error abriendo documento",e)
              alert("No se pudo abrir el documento: "+(e?.message||e))
            }
          }} style={{padding:"6px 12px",borderRadius:6,fontSize:12,fontWeight:600,background:"#1D4E89",color:"#fff",border:"none",cursor:"pointer"}}>👁 Ver</button>
          {(cu?.rol==="admin"||cu?.rol==="dir_general")&&<button onClick={()=>deleteDoc(d.id)} style={{padding:"6px 10px",borderRadius:6,fontSize:12,fontWeight:600,background:"#B4231812",color:"#B42318",border:"none",cursor:"pointer"}}>🗑</button>}
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
    await updOC(oc.id,{estado:autoEstado==="Conforme"?"Recibida OK":"Recibida parcial",fase_actual:isI?11:6,fecha_real_recepcion:rf})
    close()
  }

  // ⭐ Exportación OC — PDF (jsPDF dyn import) y Excel (XLSX ya importado)
  const[exportando,setExportando]=useState(null)
  const datosExport=()=>{
    const pv=provs.find(p=>p.id===oc.proveedor_id)
    const TC=Number(config.tc_usd)||950
    const cabecera={
      id:oc.id,tipo:oc.tipo_oc,estado:oc.estado,
      proveedor:oc.proveedor_id,rut_proveedor:pv?.rut||"",
      fecha_creacion:oc.created_at?.slice(0,10)||hoy(),
      eta:oc.fecha_estimada||"—",condicion_pago:oc.condicion_pago||"—",
      destino:oc.destino_sucursal_id||"CD Maipú",
      total_clp:oc.total_clp||0,total_usd:oc.total_usd||0,moneda:isI?"USD":"CLP",tc:TC
    }
    const productos=items.map(it=>({
      sku:it.sku||"",producto:it.producto||"",cantidad:it.cantidad_pedida||0,
      costo_u:it.costo_unitario||0,
      costo_u_clp:isI?Math.round((it.costo_unitario||0)*TC):it.costo_unitario||0,
      subtotal:isI?Math.round((it.costo_unitario||0)*(it.cantidad_pedida||0)*TC):(it.costo_unitario||0)*(it.cantidad_pedida||0)
    }))
    const bitacora=firmas.map(f=>({fecha:f.fecha+" "+(f.hora||""),usuario:f.nombre_usuario||"",rol:f.rol_usuario||"",accion:f.accion||""}))
    return{cabecera,productos,bitacora}
  }
  const exportarExcel=()=>{
    setExportando("xlsx")
    try{
      const{cabecera,productos,bitacora}=datosExport()
      const wb=XLSX.utils.book_new()
      const cab=[["ORDEN DE COMPRA — OUTLET DE PUERTAS SpA",""],["",""],
        ["ID OC",cabecera.id],["Tipo",cabecera.tipo],["Estado",cabecera.estado],
        ["Proveedor",cabecera.proveedor],["RUT Proveedor",cabecera.rut_proveedor],
        ["Fecha creación",cabecera.fecha_creacion],["ETA / Entrega",cabecera.eta],
        ["Condición pago",cabecera.condicion_pago],["Destino",cabecera.destino],["",""],
        ["Total CLP",cabecera.total_clp],["Total USD",cabecera.total_usd],["TC USD",cabecera.tc]
      ]
      const wsCab=XLSX.utils.aoa_to_sheet(cab);wsCab["!cols"]=[{wch:22},{wch:40}]
      XLSX.utils.book_append_sheet(wb,wsCab,"Cabecera")
      const prodRows=[["SKU","Producto","Cantidad","Costo U. (orig.)","Costo U. (CLP)","Subtotal CLP"],
        ...productos.map(p=>[p.sku,p.producto,p.cantidad,p.costo_u,p.costo_u_clp,p.subtotal]),
        ["","","","","TOTAL",productos.reduce((s,p)=>s+p.subtotal,0)]
      ]
      const wsP=XLSX.utils.aoa_to_sheet(prodRows);wsP["!cols"]=[{wch:18},{wch:40},{wch:10},{wch:14},{wch:14},{wch:16}]
      XLSX.utils.book_append_sheet(wb,wsP,"Productos")
      const bitRows=[["Fecha","Usuario","Rol","Acción"],...bitacora.map(b=>[b.fecha,b.usuario,b.rol,b.accion])]
      const wsB=XLSX.utils.aoa_to_sheet(bitRows);wsB["!cols"]=[{wch:18},{wch:20},{wch:18},{wch:60}]
      XLSX.utils.book_append_sheet(wb,wsB,"Bitácora")
      XLSX.writeFile(wb,`${oc.id}_${hoy()}.xlsx`)
    }catch(e){alert("Error al generar Excel: "+e.message)}
    setExportando(null)
  }
  const exportarPDF=async()=>{
    setExportando("pdf")
    try{
      const autoTable=(d,o)=>d.autoTable(o)
      const{cabecera,productos,bitacora}=datosExport()
      const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"})
      const W=210;const M=14
      doc.setFillColor(26,26,46);doc.rect(0,0,W,32,"F")
      doc.setTextColor(255,255,255);doc.setFontSize(16);doc.setFont("helvetica","bold")
      doc.text("ORDEN DE COMPRA",M,14)
      doc.setFontSize(10);doc.setFont("helvetica","normal");doc.text("Outlet de Puertas SpA",M,21)
      doc.setFontSize(13);doc.setFont("helvetica","bold");doc.text(cabecera.id,W-M,14,{align:"right"})
      doc.setFontSize(9);doc.setFont("helvetica","normal")
      doc.text(cabecera.estado,W-M,21,{align:"right"});doc.text("Generado: "+hoy(),W-M,27,{align:"right"})
      let y=40;doc.setTextColor(28,28,30);doc.setFontSize(9)
      const filasCab=[
        ["Proveedor",cabecera.proveedor,"RUT",cabecera.rut_proveedor],
        ["Tipo OC",cabecera.tipo,"Destino",cabecera.destino],
        ["Fecha creación",cabecera.fecha_creacion,"ETA / Entrega",cabecera.eta],
        ["Condición pago",cabecera.condicion_pago,"Total CLP",fmt(cabecera.total_clp)]
      ]
      if(cabecera.total_usd>0)filasCab.push(["Total USD",fU(cabecera.total_usd),"TC USD","$"+Number(cabecera.tc).toLocaleString("es-CL")])
      filasCab.forEach(r=>{
        doc.setFont("helvetica","bold");doc.setTextColor(100,100,100)
        doc.text(r[0],M,y);if(r[2])doc.text(r[2],W/2,y)
        doc.setFont("helvetica","normal");doc.setTextColor(28,28,30)
        doc.text(String(r[1]||""),M+28,y);if(r[3])doc.text(String(r[3]||""),W/2+22,y)
        y+=6
      })
      y+=4
      doc.setFont("helvetica","bold");doc.setFontSize(10);doc.text("Productos ("+productos.length+")",M,y);y+=4
      autoTable(doc,{
        startY:y,
        head:[["SKU","Producto","Cant.","Costo U.","Subtotal CLP"]],
        body:productos.map(p=>[p.sku,p.producto,p.cantidad,cabecera.moneda==="USD"?fU(p.costo_u):fmt(p.costo_u),fmt(p.subtotal)]),
        foot:[["","","","TOTAL",fmt(productos.reduce((s,p)=>s+p.subtotal,0))]],
        styles:{fontSize:8,cellPadding:2},
        headStyles:{fillColor:[26,26,46],textColor:[255,255,255],fontStyle:"bold"},
        footStyles:{fillColor:[240,240,245],fontStyle:"bold"},
        columnStyles:{0:{cellWidth:28},1:{cellWidth:72},2:{cellWidth:14,halign:"right"},3:{cellWidth:24,halign:"right"},4:{cellWidth:28,halign:"right"}},
        margin:{left:M,right:M}
      })
      y=doc.lastAutoTable.finalY+8
      // ⭐ Documento dirigido a PROVEEDOR: sin bitácora interna (ediciones, regularizaciones,
      //    sobre-entregas son información interna). Se reemplaza por bloque de firmas formal.
      if(y>240){doc.addPage();y=20}
      const creador=bitacora.length>0?bitacora[0]:null
      doc.setFont("helvetica","bold");doc.setFontSize(10);doc.setTextColor(26,26,46)
      doc.text("Emisión y autorización",M,y);y+=6
      doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(80,80,80)
      if(creador)doc.text(`Documento emitido por ${creador.usuario} · ${creador.fecha}`,M,y)
      doc.text(`Este documento fue generado electrónicamente por el sistema de abastecimiento de Outlet de Puertas SpA (SOP P07).`,M,y+5)
      y+=18
      // Tres bloques de firma
      const bw=(W-2*M-16)/3
      const firmasBloques=["Emitido por","Autorizado por","Recibido — Proveedor"]
      firmasBloques.forEach((t,i)=>{
        const x=M+i*(bw+8)
        doc.setDrawColor(120,120,130);doc.line(x,y+18,x+bw,y+18)
        doc.setFontSize(8);doc.setTextColor(80,80,80)
        doc.text(t,x+bw/2,y+23,{align:"center"})
        doc.setFontSize(6.5);doc.setTextColor(150,150,160)
        doc.text("Nombre, firma y fecha",x+bw/2,y+27,{align:"center"})
      })
      const totalPages=doc.internal.getNumberOfPages()
      for(let i=1;i<=totalPages;i++){
        doc.setPage(i);doc.setFontSize(7);doc.setTextColor(174,174,194)
        doc.text("Outlet de Puertas SpA · "+oc.id+" · "+hoy()+" · Página "+i+" de "+totalPages,W/2,292,{align:"center"})
      }
      doc.save(oc.id+"_"+hoy()+".pdf")
    }catch(e){alert("Error al generar PDF: "+e.message)}
    setExportando(null)
  }

  return<>
  <div>
    {isI&&(oc.estado==="Proyectar costeo"||oc.estado==="Validar costeo final")&&<div style={{background:oc.estado==="Proyectar costeo"?"linear-gradient(135deg,#223058,#5B2C6F)":"linear-gradient(135deg,#223058,#1D4E89)",borderRadius:12,padding:14,marginBottom:12,color:"#fff",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
      <div style={{flex:1,minWidth:240}}>
        <div style={{fontSize:12,fontWeight:700,opacity:0.8,textTransform:"uppercase",letterSpacing:0.5}}>{oc.estado==="Proyectar costeo"?"🧮 Etapa de proyección inicial":"🎯 Etapa de validación final"}</div>
        <div style={{fontSize:15,fontWeight:800,marginTop:2}}>{oc.estado==="Proyectar costeo"?"Proyección de costeo requerida":"Validación de costeo final"}</div>
        <div style={{fontSize:12,opacity:0.9,marginTop:2}}>{oc.estado==="Proyectar costeo"?"Antes de pasar a Finanzas, debe calcularse el costeo proyectado con gastos de internación, agente y márgenes.":"Ya internada: valida el costo real vs proyectado y ajusta márgenes si es necesario."}</div>
      </div>
      {setTab&&<button onClick={()=>{close();setTab("costeo")}} style={{padding:"10px 18px",borderRadius:10,fontSize:13,fontWeight:700,background:"#fff",color:"#223058",border:"none",cursor:"pointer",whiteSpace:"nowrap"}}>Abrir módulo de costeo →</button>}
    </div>}
    <Stp steps={isI?FI:FN} cur={oc.fase_actual}/>
    {oc.reaprobacion_pendiente&&<div style={{background:"#FEF3F2",border:"1px solid #FECDCA",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#B42318",lineHeight:1.5}}><strong>⚠ Cambio de ítems pendiente de re-aprobación</strong> desde {String(oc.reaprobacion_desde||"").slice(0,10)}: {oc.reaprobacion_motivo}<br/>Dir. Negocios: {oc.reaprobacion_neg_por||"pendiente"} · Dir. Finanzas: {oc.reaprobacion_fin_por||"pendiente"}. La OC no avanza de etapa hasta completar ambas (desde Órdenes).</div>}
    {(oc.monto_aprobado_clp!=null&&Math.round(oc.monto_aprobado_clp)!==Math.round(oc.total_clp||0))&&<div style={{fontSize:12,color:"#B25E09",marginBottom:10}}>Monto aprobado {fmt(oc.monto_aprobado_clp)} · monto actual {fmt(oc.total_clp)}</div>}
    {/* 18-oct-2026: ficha con pestañas (paso 3 de la homologación); los botones de exportar quedan siempre visibles */}
    <div style={{display:"flex",alignItems:"center",gap:2,flexWrap:"wrap",borderBottom:"1px solid #E5E7EB",margin:"4px 0 14px",position:"sticky",top:46,background:"#F7F8FA",zIndex:4,paddingTop:4}}>
      {[["resumen","Resumen"],["productos",`Productos (${items.length})`],["pagos",`Pagos (${pagos.length})`],["documentos","Facturas y documentos"],["recepcion","Recepción"],...(isI?[["importacion","Importación"]]:[]),["historial",`Historial (${firmas.length})`]].map(([k,l])=><button key={k} onClick={()=>setTabF(k)} style={{padding:"8px 12px",fontSize:12,fontWeight:tabF===k?700:500,color:tabF===k?"#16213E":"#6B7280",background:"none",border:"none",borderBottom:"2px solid "+(tabF===k?"#16213E":"transparent"),cursor:"pointer",whiteSpace:"nowrap"}}>{l}</button>)}
      <div style={{flex:1}}/>
      <button onClick={exportarExcel} disabled={!!exportando} style={{padding:"5px 12px",borderRadius:8,fontSize:12,fontWeight:600,background:"#1E7A4415",color:"#1E7A44",border:"1px solid #1E7A4440",cursor:"pointer",marginLeft:4}}>Excel</button>
      <button onClick={exportarPDF} disabled={!!exportando} style={{padding:"5px 12px",borderRadius:8,fontSize:12,fontWeight:600,background:"#B4231815",color:"#B42318",border:"1px solid #B4231840",cursor:"pointer",marginLeft:4}}>PDF</button>
    </div>
    {tabF==="importacion"&&<>
    {isI&&<HitosImportacion oc={oc} cu={cu} addFirma={addFirma} updOC={updOC} close={close}/>}
    </>}
    {tabF==="historial"&&<HistorialOC oc={oc} firmas={firmas} pagos={pagos} setPagos={setPagos} addFirma={addFirma} cu={cu}/>}
    {tabF==="resumen"&&<>
    {/* ⭐ Actualizar estado operativo (analista/admin): solo dentro de la zona
        post-aprobación — nunca cruza puertas de autorización (Dir. Negocios/Finanzas) */}
    {(()=>{
      const OPS_NAC=["Pend. proveedor","Confirmada prov.","Despacho nac.","Recibida parcial","Recibida OK"]
      const OPS_IMP=["Pend. proveedor","Proforma OK","En fabricación","Embarcada","Internación","Validar costeo final","Transporte","Recibida parcial","Recibida OK"]
      const FASE_NAC={"Pend. proveedor":3,"Confirmada prov.":4,"Despacho nac.":5,"Recibida parcial":6,"Recibida OK":6}
      const FASE_IMP={"Pend. proveedor":5,"Proforma OK":5,"En fabricación":6,"Embarcada":7,"Internación":8,"Validar costeo final":9,"Transporte":10,"Recibida parcial":13,"Recibida OK":13}
      const OPS=isI?OPS_IMP:OPS_NAC
      // ⭐ Origen extendido (jul-2026): OCs de la migración quedaron en "Proyectar costeo"
      //    con mercadería ya recibida en bodega. Se permite actualizar desde ahí, con
      //    advertencia explícita de que la etapa de aprobación Finanzas queda saltada.
      const PRE_APROB=isI?["Proyectar costeo"]:[]
      const esPre=PRE_APROB.includes(oc.estado)
      if(!h("act_estado")||(!OPS.includes(oc.estado)&&!esPre))return null
      const destinos=(esPre?["Pend. Dir. Finanzas",...OPS]:OPS).filter(e=>e!==oc.estado)
      return<div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",background:"#F0F9FF",border:"1px solid #1D4E8930",borderRadius:10,padding:"8px 12px",marginBottom:12}}>
        <span style={{fontSize:12,fontWeight:700,color:"#1D4E89"}}>🔄 Actualizar estado:</span>
        <select defaultValue="" onChange={async e=>{
          const nuevo=e.target.value;const sel=e.target
          if(!nuevo)return
          const motivo=window.prompt(`Actualizar ${oc.id}:\n"${oc.estado}" → "${nuevo}"\n${esPre&&nuevo!=="Pend. Dir. Finanzas"?"\n⚠ ADVERTENCIA: esta OC no pasó por la aprobación de Dir. Finanzas en el sistema. El salto quedará registrado en la bitácora.\n":""}\nMotivo del cambio (obligatorio):`)
          if(motivo===null||!motivo.trim()){if(motivo!==null)alert("⚠ El motivo es obligatorio");sel.value="";return}
          try{
            const FASES={...(isI?FASE_IMP:FASE_NAC),"Pend. Dir. Finanzas":isI?4:2}
            const up={estado:nuevo,fase_actual:FASES[nuevo]||oc.fase_actual}
            if(nuevo==="Recibida OK"&&oc.recepcion_cuadrada==null)up.recepcion_cuadrada=pctRecibidoAcum>=100
            await updOC(oc.id,up)
            await addFirma(oc.id,`Estado actualizado: ${oc.estado} → ${nuevo}${esPre&&nuevo!=="Pend. Dir. Finanzas"?" (⚠ desde etapa pre-aprobación — regularización)":""} — ${motivo.trim()}`)
            alert(`✓ ${oc.id} actualizada a "${nuevo}"`)
          }catch(er){alert("Error: "+(er?.message||er));sel.value=""}
        }} style={{...css.select,fontSize:12,padding:"6px 10px",maxWidth:230}}>
          <option value="">Mover a…</option>
          {destinos.map(e=><option key={e} value={e}>{STS[e]?.ic} {e}</option>)}
        </select>
        <span style={{fontSize:11,color:"#6E6E73"}}>Solo estados operativos · las aprobaciones (Dir. Negocios / Finanzas) siguen su flujo normal · queda registrado en firmas</span>
      </div>
    })()}
    {(()=>{
      const suc=oc.destino_sucursal_id
      const totalStr=isI&&oc.total_usd>0?`${fmt(oc.total_clp)} · ${fU(oc.total_usd)}`:fmt(oc.total_clp)
      const camposBase=[["Proveedor",provs.find(p=>p.id===oc.proveedor_id)?.nombre||oc.proveedor_id],["Tipo",oc.tipo_oc],["Pago",oc.condicion_pago]]
      return<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        {camposBase.map(([l,v],i)=><div key={i} style={{background:"#F4F5F7",borderRadius:10,padding:"8px 12px"}}><div style={{fontSize:11,color:"#AEAEB2",fontWeight:600}}>{l}</div><div style={{fontSize:13,fontWeight:600,color:"#1C1C1E"}}>{v}</div></div>)}
        {/* Total con desglose IVA para NAC */}
        <div style={{background:"#F4F5F7",borderRadius:10,padding:"8px 12px",gridColumn:isI?"auto":"1/-1"}}>
          <div style={{fontSize:11,color:"#AEAEB2",fontWeight:600,marginBottom:4}}>TOTAL</div>
          {isI
            ?<div>
              <div style={{fontSize:14,fontWeight:700,color:"#1E7A44"}}>{fU(oc.total_usd||0)}</div>
              {oc.total_clp>0&&<div style={{fontSize:12,color:"#6E6E73"}}>≈ {fmt(oc.total_clp)}</div>}
            </div>
            :<div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"flex-end"}}>
              <div>
                <div style={{fontSize:11,color:"#AEAEB2"}}>Neto</div>
                <div style={{fontSize:12,fontWeight:600}}>{fmt(oc.total_neto||Math.round((oc.total_clp||0)/1.19))}</div>
              </div>
              <div>
                <div style={{fontSize:11,color:"#AEAEB2"}}>IVA 19%</div>
                <div style={{fontSize:12,fontWeight:600}}>{fmt(oc.iva_monto||Math.round((oc.total_clp||0)*0.19/1.19))}</div>
              </div>
              <div>
                <div style={{fontSize:11,color:"#AEAEB2"}}>Total c/IVA</div>
                <div style={{fontSize:15,fontWeight:800,color:"#1C1C1E"}}>{fmt(oc.total_clp||0)}</div>
              </div>
            </div>
          }
        </div>
        {/* ETA editable con reprogramar */}
        <ETAReprog oc={oc} updOC={updOC} addFirma={addFirma} cu={cu} provs={provs}/>
        {/* Destino editable */}
        <DestinoEdit oc={oc} updOC={updOC} provs={provs}/>
      </div>
    })()}

    {/* ⭐ Botón Dividir OC (visible cuando es IMP activa) */}
    {isI&&!["Cerrada","Rechazada","Anulada","Borrador","Dividida","Fusionada"].includes(oc.estado)&&h("gest_imp")&&
      <div style={{marginBottom:14}}>
        <button id={"btn-split-"+oc.id} onClick={abrirSplit}
          style={{padding:"8px 14px",borderRadius:8,fontSize:12,fontWeight:700,border:"1px solid #223058",background:"#22305812",color:"#223058",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6}}>
          ✂ Dividir esta OC en dos partes
        </button>
      </div>
    }

    </>}
    {tabF==="productos"&&<>
    {/* Sección productos — siempre visible (con placeholder si está vacía) */}
    <div id={"oc-productos-"+oc.id} style={{fontSize:15,fontWeight:700,marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center",scrollMarginTop:20}}>
      <span>Productos ({items.length})</span>
      {puedeEditarItems&&!addingItem&&!editingItem&&<button onClick={()=>setAddingItem(true)} style={{padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:600,background:"#1E7A4415",color:"#1E7A44",border:"1px solid #1E7A4440",cursor:"pointer"}}>+ Agregar item</button>}
    </div>
    {items.length===0&&!addingItem&&<div style={{padding:"20px",background:"#FFF8E7",borderRadius:10,border:"1px solid #FFE4A0",marginBottom:14,textAlign:"center"}}>
      <div style={{fontSize:22,marginBottom:6}}>📦</div>
      <div style={{fontSize:13,fontWeight:600,color:"#946200",marginBottom:4}}>Esta OC no tiene productos cargados</div>
      <div style={{fontSize:12,color:"#6E6E73",lineHeight:1.4,maxWidth:400,margin:"0 auto"}}>Pudo haber ocurrido un error al crearla. {puedeEditarItems?"Usa el botón \"+ Agregar item\" arriba para cargarlos manualmente.":"Contacta al admin para que los cargue."}</div>
    </div>}
    {(items.length>0||addingItem)&&<><table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:14}}>
        <thead><tr style={{background:"#F4F5F7"}}>
          <th style={{padding:"6px 8px",textAlign:"left",fontSize:11,fontWeight:600,color:"#6E6E73"}}>Producto</th>
          <th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:600,color:"#6E6E73"}}>Sugerido</th>
          <th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:600,color:"#6E6E73"}}>Pedido</th>
          <th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:600,color:"#6E6E73"}}>Costo U.</th>
          <th style={{padding:"6px 8px",textAlign:"right",fontSize:11,fontWeight:600,color:"#6E6E73"}}>Subtotal</th>
          {puedeEditarItems&&<th style={{width:80,padding:"6px"}}></th>}
        </tr></thead>
        <tbody>{items.map((i,idx)=>{
          const isEditing=editingItem===i.id
          if(isEditing) return<tr key={idx} style={{borderBottom:"1px solid #F4F5F7",background:"#FFF9E8"}}>
            <td style={{padding:"6px 8px"}}><input value={editDraft.producto||""} onChange={e=>setEditDraft({...editDraft,producto:e.target.value})} style={{...css.input,padding:"5px 8px",fontSize:12}} /><div style={{fontSize:11,color:"#AEAEB2",marginTop:2}}>{i.sku}</div></td>
            <td style={{padding:"6px",textAlign:"right",color:"#6E6E73"}}>{fN(i.cantidad_sugerida)}</td>
            <td style={{padding:"6px"}}><input type="number" min={0} value={editDraft.cantidad_pedida||0} onChange={e=>setEditDraft({...editDraft,cantidad_pedida:e.target.value})} style={{...css.input,padding:"5px 8px",fontSize:12,width:80,textAlign:"right"}}/></td>
            <td style={{padding:"6px"}}><input type="number" min={0} step="any" value={editDraft.costo_unitario||0} onChange={e=>setEditDraft({...editDraft,costo_unitario:e.target.value})} style={{...css.input,padding:"5px 8px",fontSize:12,width:90,textAlign:"right"}}/></td>
            <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600}}>{isI?fUD((Number(editDraft.cantidad_pedida)||0)*(Number(editDraft.costo_unitario)||0),2):fmt((Number(editDraft.cantidad_pedida)||0)*(Number(editDraft.costo_unitario)||0))}</td>
            <td style={{padding:"6px"}}><div style={{display:"flex",gap:4}}><button onClick={()=>saveItemEdit(i)} disabled={savingEdit} style={{padding:"4px 8px",fontSize:12,background:"#1E7A44",color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontWeight:600}}>✓</button><button onClick={cancelEdit} style={{padding:"4px 8px",fontSize:12,background:"#6E6E73",color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}}>✕</button></div></td>
          </tr>
          return<tr key={idx} style={{borderBottom:"1px solid #F4F5F7"}}>
            <td style={{padding:"6px 8px"}}><div style={{fontWeight:600}}>{i.producto}</div><div style={{fontSize:11,color:"#AEAEB2"}}>{i.sku}</div></td>
            <td style={{padding:"6px",textAlign:"right",color:"#6E6E73"}}>{fN(i.cantidad_sugerida)}</td>
            <td style={{padding:"6px",textAlign:"right",color:"#1D4E89",fontWeight:700}}>{fN(i.cantidad_pedida)}</td>
            <td style={{padding:"6px",textAlign:"right"}}>{isI?fUD(i.costo_unitario):fmt(i.costo_unitario)}</td>
            <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600}}>{isI?fUD((i.cantidad_pedida||0)*(i.costo_unitario||0),2):fmt((i.cantidad_pedida||0)*(i.costo_unitario||0))}</td>
            {puedeEditarItems&&<td style={{padding:"6px"}}><div style={{display:"flex",gap:4}}>
              <button onClick={()=>startEditItem(i)} disabled={!!editingItem||addingItem} style={{padding:"4px 8px",fontSize:12,background:"#1D4E8915",color:"#1D4E89",border:"1px solid #1D4E8930",borderRadius:4,cursor:"pointer",fontWeight:600,opacity:editingItem||addingItem?0.4:1}} title="Editar">✏</button>
              <button onClick={()=>deleteItem(i)} disabled={!!editingItem||addingItem} style={{padding:"4px 8px",fontSize:12,background:"#B4231815",color:"#B42318",border:"1px solid #B4231830",borderRadius:4,cursor:"pointer",opacity:editingItem||addingItem?0.4:1}} title="Eliminar">🗑</button>
            </div></td>}
          </tr>
        })}
        {addingItem&&<tr style={{borderBottom:"1px solid #F4F5F7",background:"#E8F5E9"}}>
          <td style={{padding:"6px 8px"}}><input value={newItem.producto} onChange={e=>setNewItem({...newItem,producto:e.target.value})} placeholder="Producto" style={{...css.input,padding:"5px 8px",fontSize:12,marginBottom:3}}/><input value={newItem.sku} onChange={e=>setNewItem({...newItem,sku:e.target.value})} placeholder="SKU" style={{...css.input,padding:"5px 8px",fontSize:12}}/></td>
          <td style={{padding:"6px",textAlign:"right",color:"#AEAEB2"}}>—</td>
          <td style={{padding:"6px"}}><input type="number" min={0} value={newItem.cantidad_pedida||0} onChange={e=>setNewItem({...newItem,cantidad_pedida:Number(e.target.value)})} style={{...css.input,padding:"5px 8px",fontSize:12,width:80,textAlign:"right"}}/></td>
          <td style={{padding:"6px"}}><input type="number" min={0} step="any" value={newItem.costo_unitario||0} onChange={e=>setNewItem({...newItem,costo_unitario:Number(e.target.value)})} style={{...css.input,padding:"5px 8px",fontSize:12,width:90,textAlign:"right"}}/></td>
          <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600}}>{fmt((newItem.cantidad_pedida||0)*(newItem.costo_unitario||0))}</td>
          <td style={{padding:"6px"}}><div style={{display:"flex",gap:4}}><button onClick={saveNewItem} disabled={savingEdit} style={{padding:"4px 8px",fontSize:12,background:"#1E7A44",color:"#fff",border:"none",borderRadius:4,cursor:"pointer",fontWeight:600}}>✓</button><button onClick={()=>{setAddingItem(false);setNewItem({producto:"",sku:"",cantidad_pedida:0,costo_unitario:0})}} style={{padding:"4px 8px",fontSize:12,background:"#6E6E73",color:"#fff",border:"none",borderRadius:4,cursor:"pointer"}}>✕</button></div></td>
        </tr>}
        </tbody>
      </table>
      {puedeEditarItems&&<div style={{fontSize:11,color:"#6E6E73",marginBottom:10}}>💡 Puedes editar/agregar/eliminar items. Cada cambio recalcula el total y queda en el historial de firmas.</div>}
      {!puedeEditarItems&&tienePermisoEdicion&&<div style={{fontSize:11,color:"#B25E09",marginBottom:10}}>🔒 La OC está en estado <strong>{oc.estado}</strong>. Ya no se pueden editar items.</div>}
    </>}

    </>}
    {tabF==="pagos"&&<>
    {/* ⭐ Plan de pagos — editable por admin/dir_finanzas */}
    {pagos.length>0&&(()=>{
      const puedeEditarPagos=(cu?.rol==="admin"||cu?.rol==="dir_finanzas")&&oc.estado!=="Cerrada"
      return<PagosEditor oc={oc} pagos={pagos} setPagos={setPagos} cu={cu} puedeEditar={puedeEditarPagos} addFirma={addFirma} TC_USD={TC_USD}/>
    })()}

    {/* COMPROBANTES DE PAGO */}
    {pagos.length>0&&<div style={{marginTop:12}}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>📎 Comprobantes de pago</div>
      {regPagoOC&&<RegistroPagoModal oc={oc} cuotas={pagos.filter(x=>x.oc_id===oc.id)} pagoId={regPagoOC} setPagos={setPagos} addFirma={addFirma} onClose={()=>setRegPagoOC(null)}/>}
      {pagos.map((p,i)=>{
        const tieneComprobante=p.comprobante_url&&p.comprobante_nombre
        return<div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:tieneComprobante?"#1E7A4408":"#fff",borderRadius:10,border:`1px solid ${tieneComprobante?"#1E7A4430":"#E5E7EB"}`,marginBottom:6}}>
          <div>
            <div style={{fontSize:13,fontWeight:600}}>{p.concepto}</div>
            <div style={{fontSize:12,color:"#6E6E73"}}>{p.moneda==="USD"?fU(p.monto):fmt(p.monto)} — {p.fecha_pago||"Sin fecha"}{p.observaciones_pago?` — ${p.observaciones_pago}`:""}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <Bd c={p.estado==="Pagado"?"#1E7A44":"#B25E09"} bg={p.estado==="Pagado"?"#1E7A4415":"#B25E0915"}>{p.estado}</Bd>
            {tieneComprobante?
              <a href={p.comprobante_url} target="_blank" rel="noopener" style={{display:"inline-flex",alignItems:"center",gap:4,padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:600,background:"#1D4E89",color:"#fff",textDecoration:"none",cursor:"pointer"}}>📄 {p.comprobante_nombre.length>20?p.comprobante_nombre.slice(0,18)+"...":p.comprobante_nombre}</a>
            :p.estado==="Pagado"?
              <span style={{display:"inline-flex",alignItems:"center",gap:8}}><span style={{fontSize:12,color:"#B25E09",fontWeight:500}}>⚠ Sin comprobante</span>{puedeRegPago&&<Bt sm v="gry" onClick={()=>setRegPagoOC(p.id)}>Adjuntar comprobante</Bt>}</span>
            :
              puedeRegPago?<Bt sm v="pri" ic="💳" onClick={()=>setRegPagoOC(p.id)}>Registrar pago</Bt>:<span style={{fontSize:12,color:"#6E6E73"}}>Pendiente</span>
            }
          </div>
        </div>
      })}
    </div>}

    </>}
    {tabF==="documentos"&&<>
    {/* ⭐ Facturas del libro de compras + conciliación con banco */}
    <ErrBound zona="Facturas del libro de compras"><OCFacturasLibro oc={oc} prov={provs.find(p=>p.id===oc.proveedor_id)} cu={cu}/></ErrBound>

    {/* DOCUMENTOS GENERALES DE LA OC */}
    <div style={{marginTop:12}}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>📁 Documentos de la OC</div>
      <FileUpload tipo="proforma" label="Proforma / Cotización" desc="Documento del proveedor con precios y condiciones"/>
      <FileUpload tipo="factura" label="Factura del proveedor" desc="Factura o boleta del proveedor"/>
      <FileUpload tipo="guia_despacho" label="Guía de despacho" desc="Guía de transporte o despacho"/>
      {isI&&<>
        <div style={{fontSize:12,fontWeight:700,color:"#223058",marginTop:14,marginBottom:6,textTransform:"uppercase"}}>📋 Documentos de importación</div>
        <FileUpload tipo="bl_naviera" label="Bill of Lading / BL" desc="Documento de embarque marítimo"/>
        <FileUpload tipo="packing_list" label="Packing List" desc="Detalle de bultos y contenido del embarque"/>
        <FileUpload tipo="din_aduana" label="DIN / Declaración aduana" desc="Declaración de Internación"/>
        <div style={{fontSize:12,fontWeight:700,color:"#B25E09",marginTop:14,marginBottom:6,textTransform:"uppercase"}}>💰 Comprobantes de pagos logísticos</div>
        <FileUpload tipo="pago_naviera" label="Pago a naviera" desc="Comprobante de pago del flete marítimo"/>
        <FileUpload tipo="pago_aduana" label="Pago aduana (IVA + arancel)" desc="Comprobante de pago de IVA y aranceles"/>
        <FileUpload tipo="provision_agente" label="Provisión agente de aduana" desc="Anticipo/provisión al agente para gestiones"/>
        <FileUpload tipo="pago_transporte_local" label="Pago transporte local" desc="Comprobante del flete puerto → bodega"/>
        <FileUpload tipo="pago_seguros" label="Pago seguros" desc="Comprobante de seguro de mercadería / terrestre"/>
      </>}
    </div>

    {/* SAVE ALL DOCUMENTS BUTTON */}
    {pendingFiles.length>0&&<div style={{background:"#B25E0912",borderRadius:12,padding:16,marginTop:12,marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:14,fontWeight:700,color:"#B25E09"}}>{pendingFiles.length} documento(s) pendiente(s) de guardar</div><div style={{fontSize:12,color:"#6E6E73"}}>Haz clic en el botón para guardar los archivos en la orden de compra</div></div>
        <button onClick={saveAllDocs} disabled={uploading} style={{padding:"12px 24px",borderRadius:10,fontSize:14,fontWeight:700,background:uploading?"#6E6E73":"#1E7A44",color:"#fff",border:"none",cursor:uploading?"wait":"pointer",display:"flex",alignItems:"center",gap:6}}>{uploading?"⏳ Guardando...":"💾 Guardar en la OC"}</button>
      </div>
    </div>}
    {saveMsg&&<div style={{background:saveMsg.includes("✅")?"#1E7A4412":"#B4231812",borderRadius:8,padding:10,marginBottom:12,fontSize:13,fontWeight:600,color:saveMsg.includes("✅")?"#1E7A44":"#B42318"}}>{saveMsg}</div>}

    </>}
    {tabF==="resumen"&&<>
    {/* PROVIDER QUANTITY VALIDATION */}
    {oc.estado==="Pend. proveedor"&&h("valid_prov")&&<div style={{borderTop:"2px solid #E5E7EB",paddingTop:16,marginTop:16}}>
      <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>🔄 Validación de proforma{isI?" · cantidades + forma de pago":" · cantidades"}</div>
      <div style={{fontSize:12,color:"#6E6E73",marginBottom:12}}>Ajusta las cantidades según lo confirmado por el proveedor.{isI?" Verifica además que los % de pago (fab/emb/saldo) coincidan con la proforma recibida.":" Si hay quiebre de stock del proveedor o cantidades mínimas de venta, modifica la columna \"Confirmado\"."}</div>
      {isI&&<div style={{background:"#22305808",borderLeft:"3px solid #223058",borderRadius:6,padding:"10px 12px",marginBottom:12,fontSize:12}}>
        <div style={{fontWeight:700,color:"#223058",marginBottom:6}}>💳 Plan de pago a validar contra proforma:</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
          <div><span style={{color:"#6E6E73"}}>Fabricación:</span> <b>{oc.pct_fab||0}%</b> ({fU(Math.round((oc.total_usd||0)*(oc.pct_fab||0)/100))})</div>
          <div><span style={{color:"#6E6E73"}}>Embarque:</span> <b>{oc.pct_embarque||0}%</b> ({fU(Math.round((oc.total_usd||0)*(oc.pct_embarque||0)/100))})</div>
          <div><span style={{color:"#6E6E73"}}>Saldo/puerto:</span> <b>{oc.pct_puerto||0}%</b> ({fU(Math.round((oc.total_usd||0)*(oc.pct_puerto||0)/100))})</div>
        </div>
        {((oc.pct_fab||0)+(oc.pct_embarque||0)+(oc.pct_puerto||0))!==100&&<div style={{color:"#B42318",marginTop:8,fontWeight:600}}>⚠ Los % no suman 100%. Revisa el plan de pago antes de confirmar.</div>}
      </div>}
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:12}}>
        <thead><tr style={{background:"#F4F5F7"}}><th style={{padding:"6px 8px",textAlign:"left",fontSize:11,fontWeight:600,color:"#6E6E73"}}>Producto</th><th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:600,color:"#6E6E73",width:80}}>Pedido</th><th style={{padding:"6px",textAlign:"center",fontSize:11,fontWeight:600,color:"#1E7A44",width:100}}>Confirmado</th><th style={{padding:"6px 8px",textAlign:"right",fontSize:11,fontWeight:600,color:"#6E6E73",width:80}}>Diferencia</th></tr></thead>
        <tbody>{items.map((i,idx)=>{const conf=Number(provQty[i.id]||0);const ped=i.cantidad_pedida||0;const dif=conf-ped;return<tr key={idx} style={{borderBottom:"1px solid #F4F5F7",background:dif!==0?"#B25E0908":"transparent"}}>
          <td style={{padding:"6px 8px"}}><div style={{fontWeight:600}}>{i.producto}</div><div style={{fontSize:11,color:"#AEAEB2"}}>{i.sku}</div></td>
          <td style={{padding:"6px",textAlign:"right",fontWeight:600}}>{fN(ped)}</td>
          <td style={{padding:"6px",textAlign:"center"}}><input type="number" value={provQty[i.id]||0} onChange={e=>setProvQty(p=>({...p,[i.id]:e.target.value}))} style={{width:80,textAlign:"center",padding:"4px",borderRadius:8,border:dif!==0?"2px solid #B25E09":"1px solid #E5E7EB",fontSize:13,fontWeight:600,color:dif!==0?"#B25E09":"#1E7A44"}}/></td>
          <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600,color:dif<0?"#B42318":dif>0?"#1E7A44":"#6E6E73"}}>{dif!==0?((dif>0?"+":"")+dif):"="}</td>
        </tr>})}</tbody>
      </table>
      {items.some(i=>Number(provQty[i.id]||0)!==(i.cantidad_pedida||0))&&<div style={{background:"#B25E0912",borderRadius:10,padding:10,marginBottom:10,fontSize:12,color:"#B25E09",fontWeight:600}}>⚠ Cantidades ajustadas por el proveedor — se actualizará la OC</div>}
      <Fl l="Notas del proveedor"><input value={provNotas} onChange={e=>setProvNotas(e.target.value)} placeholder="Motivo del ajuste (quiebre stock, mínimo de compra, % pago ajustado, etc.)..." style={css.input}/></Fl>

      {/* ⭐ v48: Checkbox obligatorio de verificación item por item */}
      <div style={{background:provVerificado?"#1E7A4410":"#B4231810",borderRadius:10,padding:"12px 14px",marginTop:10,marginBottom:12,border:`2px solid ${provVerificado?"#1E7A44":"#B42318"}`,transition:"all 0.2s"}}>
        <label style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer"}}>
          <input type="checkbox" checked={provVerificado} onChange={e=>setProvVerificado(e.target.checked)} style={{width:20,height:20,marginTop:2,cursor:"pointer"}}/>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:provVerificado?"#1E7A44":"#B42318",marginBottom:3}}>He verificado cantidad por cantidad contra la proforma recibida del proveedor</div>
            <div style={{fontSize:12,color:"#6E6E73"}}>Al marcar esta casilla confirmás que revisaste cada línea de la tabla y que las cantidades "Confirmado" coinciden con lo que envió el proveedor por escrito (proforma, correo, sistema del proveedor). Esto quedará registrado en la firma digital.</div>
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
        await updOC(oc.id,isI?{estado:nuevoEstado,fase_actual:6,total_clp:Math.round(newTotal*TC_USD),total_usd:Math.round(newTotal)}:{estado:nuevoEstado,fase_actual:4,total_clp:Math.round(newTotal*1.19),total_usd:0,total_neto:Math.round(newTotal),iva_monto:Math.round(newTotal*0.19)})
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
    {oc.estado&&!["Cerrada","Rechazada","Anulada"].includes(oc.estado)&&<div style={{marginTop:16,padding:"10px 12px",background:"#FFF9E6",borderRadius:10,border:"1px solid #FFE082"}}>
      <div style={{fontSize:12,fontWeight:700,color:"#8B6914",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.04em"}}>✎ Comentario de acción (obligatorio)</div>
      <textarea value={commentDet} onChange={e=>setCommentDet(e.target.value)} placeholder="Describe el motivo o detalle de esta acción (requerido para avanzar la OC)..." style={{...css.input,minHeight:50,resize:"vertical",fontSize:13}}/>
    </div>}

    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:16}}>
      {oc.estado==="Pend. Dir. Negocios"&&h("aprobar_neg")&&<><Bt v="pri" onClick={()=>firma("Aprobada Dir. Negocios",isI?"Proyectar costeo":"Pend. Dir. Finanzas",isI?3:2)} ic="✓">Aprobar (Dir. Negocios)</Bt><Bt v="dan" onClick={()=>firma("Rechazada","Rechazada")} ic="✕">Rechazar</Bt></>}
      {oc.estado==="Proyectar costeo"&&h("gest_imp")&&<Bt v="pur" onClick={()=>firma("Costeo proyectado","Pend. Dir. Finanzas",4)} ic="🧮">Costeo proyectado</Bt>}
      {oc.estado==="Pend. Dir. Finanzas"&&h("aprobar_fin")&&<><Bt v="pri" onClick={()=>firma("Aprobada Finanzas","Pend. proveedor",isI?5:3)} ic="✓">Aprobar (Dir. Finanzas)</Bt><Bt v="dan" onClick={()=>firma("Rechazada","Rechazada")} ic="✕">Rechazar</Bt></>}
      {isI&&oc.estado==="Proforma OK"&&h("gest_imp")&&<Bt v="amb" onClick={()=>firma("Fabricación iniciada","En fabricación",6)} ic="🏭">Iniciar fabricación</Bt>}
      {isI&&(oc.estado==="En fabricación"||oc.estado==="Pago fabricación")&&h("gest_imp")&&<Bt v="amb" onClick={()=>firma("Mercadería embarcada (zarpe)","Embarcada",7)} ic="🚢">Marcar embarcada</Bt>}
      {isI&&["Embarcada","Pago embarque","Pago fabricación"].includes(oc.estado)&&<Bt v="pur" onClick={()=>firma("Internación iniciada","Internación",8)} ic="📋">Internación</Bt>}
      {isI&&oc.estado==="Internación"&&h("gest_imp")&&<Bt v="pur" onClick={()=>firma("Costeo final validado","Validar costeo final",9)} ic="🎯">Validar costeo final</Bt>}
      {isI&&oc.estado==="Validar costeo final"&&<Bt v="pri" onClick={()=>firma("Transporte iniciado","Transporte",10)} ic="🚛">Transporte</Bt>}
    </div>

    </>}
    {tabF==="importacion"&&<>
    {/* PARAMETRIC RECEPTION - per item quantities */}
    {/* ⭐ HISTORIAL DE COSTEOS (solo importación) */}
    {isI&&costeos.length>0&&<div style={{borderTop:"2px solid #E5E7EB",paddingTop:16,marginTop:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E"}}>🧮 Historial de costeos</div>
          <div style={{fontSize:12,color:"#6E6E73",marginTop:2}}>Costeos de importación registrados · {costeos.length} {costeos.length===1?"registro":"registros"}</div>
        </div>
      </div>
      {costeos.map((c,i)=>{
        const esUltimo=i===0
        return<div key={c.id} style={{background:"#fff",borderRadius:10,padding:"12px 14px",marginBottom:8,border:"1px solid #5B2C6F20",borderLeft:"3px solid #5B2C6F"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                <span style={{fontSize:16}}>🧮</span>
                <span style={{fontSize:13,fontWeight:700,color:"#5B2C6F"}}>Costeo registrado</span>
                {c.tipo_costeo==="final"?<Bd c="#B42318" bg="#B4231815">🎯 Final</Bd>:<Bd c="#223058" bg="#22305815">🧮 Proyectado</Bd>}
                <Bd c="#6E6E73" bg="#F4F5F7">{c.fecha}</Bd>
                {esUltimo&&<Bd c="#1E7A44" bg="#1E7A4415">Más reciente</Bd>}
                {c.nombre_usuario&&<span style={{fontSize:12,color:"#6E6E73"}}>· por {c.nombre_usuario}</span>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginTop:8}}>
                <div style={{padding:"8px 10px",background:"#1D4E8906",borderRadius:8,border:"1px solid #1D4E8915"}}>
                  <div style={{fontSize:10.5,fontWeight:700,color:"#1D4E89",textTransform:"uppercase"}}>Costo unit. bodega</div>
                  <div style={{fontSize:16,fontWeight:800,color:"#1D4E89",letterSpacing:"-0.02em",marginTop:2}}>{fmt(c.costo_unit_bodega)}</div>
                  <div style={{fontSize:11,color:"#6E6E73"}}>{fN(c.cant_unidades)} uds</div>
                </div>
                <div style={{padding:"8px 10px",background:"#5B2C6F06",borderRadius:8,border:"1px solid #5B2C6F15"}}>
                  <div style={{fontSize:10.5,fontWeight:700,color:"#5B2C6F",textTransform:"uppercase"}}>Costo total</div>
                  <div style={{fontSize:16,fontWeight:800,color:"#5B2C6F",letterSpacing:"-0.02em",marginTop:2}}>{fmt(c.costo_total_clp)}</div>
                  <div style={{fontSize:11,color:"#6E6E73"}}>+{Math.round((c.pct_internacion_sobre_fob||0)*100)}% internación</div>
                </div>
                <div style={{padding:"8px 10px",background:(c.margen_calculado>=30?"#1E7A4406":c.margen_calculado>=15?"#B25E0906":"#B4231806"),borderRadius:8,border:`1px solid ${c.margen_calculado>=30?"#1E7A4415":c.margen_calculado>=15?"#B25E0915":"#B4231815"}`}}>
                  <div style={{fontSize:10.5,fontWeight:700,color:c.margen_calculado>=30?"#1E7A44":c.margen_calculado>=15?"#B25E09":"#B42318",textTransform:"uppercase"}}>Margen</div>
                  <div style={{fontSize:16,fontWeight:800,color:c.margen_calculado>=30?"#1E7A44":c.margen_calculado>=15?"#B25E09":"#B42318",letterSpacing:"-0.02em",marginTop:2}}>{c.margen_calculado||0}%</div>
                  <div style={{fontSize:11,color:"#6E6E73"}}>Precio: {fmt(c.precio_venta_clp||0)}</div>
                </div>
                <div style={{padding:"8px 10px",background:"#F8F8FA",borderRadius:8,border:"1px solid #E5E7EB"}}>
                  <div style={{fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Ganancia proy.</div>
                  <div style={{fontSize:16,fontWeight:800,color:c.ganancia_total>0?"#1E7A44":"#B42318",letterSpacing:"-0.02em",marginTop:2}}>{fmt(c.ganancia_total||0)}</div>
                  <div style={{fontSize:11,color:"#6E6E73"}}>TC ${fN(c.tc_usd)}</div>
                </div>
              </div>
              {/* Desglose por etapa */}
              <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap",fontSize:11}}>
                <span style={{padding:"3px 8px",borderRadius:4,background:"#1D4E8910",color:"#1D4E89",fontWeight:600}}>FOB {fmt(c.fob_clp)}</span>
                <span style={{padding:"3px 8px",borderRadius:4,background:"#B4231810",color:"#B42318",fontWeight:600}}>Aduana {fmt(c.total_aduana)}</span>
                <span style={{padding:"3px 8px",borderRadius:4,background:"#B25E0910",color:"#B25E09",fontWeight:600}}>Puerto {fmt(c.total_puerto)}</span>
                <span style={{padding:"3px 8px",borderRadius:4,background:"#5B2C6F10",color:"#5B2C6F",fontWeight:600}}>Agente {fmt(c.agente_clp)}</span>
                <span style={{padding:"3px 8px",borderRadius:4,background:"#1E7A4410",color:"#1E7A44",fontWeight:600}}>Transp. {fmt(c.transporte_clp)}</span>
                <span style={{padding:"3px 8px",borderRadius:4,background:"#B4231810",color:"#B42318",fontWeight:600}}>Fin. {fmt(c.total_financiero)}</span>
              </div>
              {c.productos_detalle&&Array.isArray(c.productos_detalle)&&c.productos_detalle.length>0&&<details style={{marginTop:10}}>
                <summary style={{fontSize:12,fontWeight:600,color:"#1D4E89",cursor:"pointer"}}>📦 Ver detalle por producto ({c.productos_detalle.length})</summary>
                <div style={{marginTop:8,maxHeight:200,overflowY:"auto",border:"1px solid #E5E7EB",borderRadius:8}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead><tr style={{background:"#F8F8FA",position:"sticky",top:0}}>
                      <th style={{padding:"6px 8px",textAlign:"left",fontSize:10.5,fontWeight:700,color:"#6E6E73"}}>Producto</th>
                      <th style={{padding:"6px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#6E6E73"}}>Cant.</th>
                      <th style={{padding:"6px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#1D4E89"}}>Unit. origen</th>
                      <th style={{padding:"6px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#5B2C6F"}}>Internac.</th>
                      <th style={{padding:"6px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#1D4E89"}}>Unit. bodega</th>
                      <th style={{padding:"6px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#B25E09"}}>Incr.</th>
                      <th style={{padding:"6px 8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#1E7A44"}}>P. venta sug.</th>
                    </tr></thead>
                    <tbody>{c.productos_detalle.map((pr,j)=><tr key={j} style={{borderBottom:"1px solid #F4F5F7"}}>
                      <td style={{padding:"5px 8px"}}><div style={{fontWeight:600,fontSize:12}}>{pr.producto}</div><div style={{fontSize:10.5,color:"#AEAEB2"}}>{pr.sku}</div></td>
                      <td style={{padding:"5px",textAlign:"right",fontWeight:600}}>{fN(pr.qty)}</td>
                      <td style={{padding:"5px",textAlign:"right",color:"#1D4E89",fontWeight:600}}>{fmt(pr.costo_unit_origen)}</td>
                      <td style={{padding:"5px",textAlign:"right",color:"#5B2C6F"}}>{fmt(pr.total_internacion)}</td>
                      <td style={{padding:"5px",textAlign:"right",fontWeight:800,color:"#1D4E89"}}>{fmt(pr.costo_unit_final)}</td>
                      <td style={{padding:"5px",textAlign:"right"}}><span style={{padding:"1px 5px",borderRadius:3,fontSize:11,fontWeight:700,color:pr.incremento>50?"#B42318":pr.incremento>30?"#B25E09":"#1E7A44",background:pr.incremento>50?"#B4231812":pr.incremento>30?"#B25E0912":"#1E7A4412"}}>+{pr.incremento}%</span></td>
                      <td style={{padding:"5px 8px",textAlign:"right",color:"#1E7A44",fontWeight:700}}>{fmt(pr.precio_venta_sug)}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </details>}
              {c.notas&&<div style={{fontSize:12,color:"#6E6E73",marginTop:6,fontStyle:"italic"}}>💬 {c.notas}</div>}
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
              {c.archivo_url&&<a href={c.archivo_url} target="_blank" rel="noopener" style={{padding:"5px 10px",fontSize:12,fontWeight:600,background:"#1D4E89",color:"#fff",textDecoration:"none",borderRadius:6}}>📄 Ver</a>}
              {/* ⭐ v48: Botón eliminar con protección cuando OC está cerrada */}
              {(() => {
                const ocCerrada=oc.estado==="Cerrada"
                const esAdmin=cu?.rol==="admin"
                const puedeVerBoton=esAdmin||c.registrado_por===cu?.id
                if(!puedeVerBoton)return null
                if(ocCerrada&&!esAdmin){
                  return <button disabled style={{padding:"5px 10px",fontSize:12,background:"#6E6E7315",color:"#6E6E73",border:"1px solid #6E6E7330",borderRadius:6,cursor:"not-allowed",fontWeight:600}} title="Costeo bloqueado: OC cerrada">🔒</button>
                }
                if(ocCerrada&&esAdmin){
                  return <button onClick={()=>eliminarCosteo(c)} style={{padding:"5px 10px",fontSize:12,background:"#B25E0915",color:"#B25E09",border:"1px solid #B25E0950",borderRadius:6,cursor:"pointer",fontWeight:600}} title="Eliminar por excepción (OC cerrada — requiere motivo)">🔓 Eliminar</button>
                }
                return <button onClick={()=>eliminarCosteo(c)} style={{padding:"5px 10px",fontSize:12,background:"#B4231815",color:"#B42318",border:"1px solid #B4231830",borderRadius:6,cursor:"pointer",fontWeight:600}} title="Eliminar">🗑</button>
              })()}
            </div>
          </div>
        </div>
      })}
    </div>}

    </>}
    {tabF==="recepcion"&&<><div style={{fontSize:12,color:"#6B7280",marginBottom:10}}>La recepción de mercadería se registra en Logística; aquí se consultan las guías y facturas recibidas de esta OC.</div>
    {/* ⭐ PANEL DE RECEPCIONES PARCIALES (guías + facturas) */}
    {(((isI&&oc.estado==="Transporte")||(!isI&&oc.estado==="Despacho nac.")||oc.estado==="Recibida parcial"||oc.estado==="Recibida OK")&&h("recibir"))&&<div style={{borderTop:"2px solid #E5E7EB",paddingTop:16,marginTop:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,color:"#1C1C1E"}}>📦 Recepciones parciales</div>
          <div style={{fontSize:12,color:"#6E6E73",marginTop:2}}>{facturaConGuia?"Este proveedor emite guía + factura en documento combinado":"Este proveedor emite guías y facturas por separado"} {prov&&<button onClick={()=>{const f=window.confirm(`¿Cambiar a: "${facturaConGuia?"documentos separados":"guía + factura combinada"}"?\n\nEste cambio afecta solo a ${prov.nombre}.`);if(f){supabase.from('proveedores').update({factura_con_guia:!facturaConGuia}).eq('id',prov.id).then(()=>{alert("Actualizado. Recargá para ver el cambio");close()})}}} style={{background:"none",border:"none",color:"#1D4E89",fontSize:11,fontWeight:600,cursor:"pointer",marginLeft:4,padding:0}}>cambiar</button>}</div>
        </div>
        {oc.estado!=="Cerrada"&&<div style={{display:"flex",gap:6}}>
          {facturaConGuia?
            <>{cu?.rol==="admin"?<Bt v="pri" sm onClick={()=>abrirRecModal("guia_factura")} ic="📄">+ Guía + Factura (regularización)</Bt>:<span style={{fontSize:12,color:"#6E6E73"}}>La recepción de mercadería se registra en Logística</span>}</>
          :<>
            <>{cu?.rol==="admin"&&<Bt v="pri" sm onClick={()=>abrirRecModal("guia")} ic="📦">+ Guía (regularización)</Bt>}</>
            <Bt v="pur" sm onClick={()=>abrirRecModal("factura")} ic="📋">+ Factura</Bt>
          </>}
          {/* ⭐ Marcar recepcionada: saca la OC del estado en tránsito SIN exigir cuadratura */}
          {!["Recibida OK","Cerrada"].includes(oc.estado)&&h("recibir")&&<Bt v="suc" sm ic="✔" onClick={async()=>{
            const cuadrada=pctRecibidoAcum>=100
            const msg=cuadrada
              ?`Marcar ${oc.id} como RECEPCIONADA.\n\nRecepción cuadrada: ${pctRecibidoAcum}% recibido (${fN(totalRecibidoAcum)}/${fN(totalPedidoOC)} uds).\n\n¿Confirmar?`
              :`⚠ Marcar ${oc.id} como RECEPCIONADA SIN CUADRATURA.\n\nRecibido: ${pctRecibidoAcum}% (${fN(totalRecibidoAcum)}/${fN(totalPedidoOC)} uds).\nLa OC saldrá de "en tránsito" y quedará marcada como recepción NO cuadrada en el dashboard.\n\n¿Confirmar igualmente?`
            if(!window.confirm(msg))return
            try{
              await updOC(oc.id,{estado:"Recibida OK",fase_actual:esImp?11:6,fecha_real_recepcion:oc.fecha_real_recepcion||hoy(),recepcion_cuadrada:cuadrada,recepcion_forzada:!cuadrada})
              await addFirma(oc.id,cuadrada?`OC marcada RECEPCIONADA (cuadrada: ${pctRecibidoAcum}%)`:`OC marcada RECEPCIONADA SIN CUADRATURA (${pctRecibidoAcum}% recibido — ${fN(totalRecibidoAcum)}/${fN(totalPedidoOC)} uds)`)
              alert(`✓ ${oc.id} marcada como recepcionada${cuadrada?"":" (sin cuadratura — quedará señalada en el dashboard)"}`)
            }catch(e){alert("Error: "+(e?.message||e))}
          }}>Marcar recepcionada</Bt>}
        </div>}
      </div>

      {/* Resumen de progreso */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div style={{background:"#fff",borderRadius:10,padding:"12px 14px",border:"1px solid #E5E7EB"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{fontSize:12,fontWeight:700,color:"#1E7A44",textTransform:"uppercase",letterSpacing:"0.05em"}}>📦 Recibido físico</span>
            <span style={{fontSize:14,fontWeight:800,color:"#1E7A44"}}>{pctRecibidoAcum}%</span>
          </div>
          <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em",lineHeight:1}}>{fN(totalRecibidoAcum)}<span style={{fontSize:13,color:"#6E6E73",fontWeight:600}}> / {fN(totalPedidoOC)} uds</span></div>
          <div style={{width:"100%",background:"#F4F5F7",borderRadius:3,height:6,overflow:"hidden",marginTop:8}}><div style={{width:Math.min(pctRecibidoAcum,100)+"%",height:"100%",background:"#1E7A44",borderRadius:3,transition:"width 0.5s ease"}}/></div>
          <div style={{fontSize:11,color:"#6E6E73",marginTop:4}}>{recepciones.filter(r=>r.tipo==="guia"||r.tipo==="guia_factura").length} documentos de recepción</div>
        </div>
        <div style={{background:"#fff",borderRadius:10,padding:"12px 14px",border:"1px solid #E5E7EB"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{fontSize:12,fontWeight:700,color:"#5B2C6F",textTransform:"uppercase",letterSpacing:"0.05em"}}>📋 Facturado</span>
            <span style={{fontSize:14,fontWeight:800,color:"#5B2C6F"}}>{pctFacturadoAcum}%</span>
          </div>
          <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em",lineHeight:1}}>{fN(totalFacturadoAcum)}<span style={{fontSize:13,color:"#6E6E73",fontWeight:600}}> / {fN(totalPedidoOC)} uds</span></div>
          <div style={{width:"100%",background:"#F4F5F7",borderRadius:3,height:6,overflow:"hidden",marginTop:8}}><div style={{width:Math.min(pctFacturadoAcum,100)+"%",height:"100%",background:"#5B2C6F",borderRadius:3,transition:"width 0.5s ease"}}/></div>
          <div style={{fontSize:11,color:"#6E6E73",marginTop:4}}>{accMonto.facturado>0&&`${fmt(accMonto.facturado)}`}{accMonto.facturado>0&&accMonto.facturadoUSD>0&&" · "}{accMonto.facturadoUSD>0&&fU(accMonto.facturadoUSD)}{recepciones.filter(r=>r.tipo==="factura"||r.tipo==="guia_factura").length>0?` · ${recepciones.filter(r=>r.tipo==="factura"||r.tipo==="guia_factura").length} facturas`:""}</div>
        </div>
      </div>

      {/* Timeline de documentos */}
      {recepciones.length===0?
        <div style={{textAlign:"center",padding:30,background:"#F9FAFB",borderRadius:10,border:"1px dashed #E5E7EB"}}>
          <div style={{fontSize:24,marginBottom:4}}>📥</div>
          <div style={{fontSize:13,color:"#6E6E73",fontWeight:600}}>Sin documentos registrados</div>
          <div style={{fontSize:12,color:"#AEAEB2",marginTop:2}}>Registra guías y facturas a medida que el proveedor entrega</div>
        </div>
      :
        <div>
          <div style={{fontSize:12,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Documentos registrados ({recepciones.length})</div>
          {recepciones.map((r,i)=>{
            const recItems=recepcionItems.filter(ri=>ri.recepcion_id===r.id)
            const totalCant=recItems.reduce((s,it)=>s+Number(it.cantidad||0),0)
            const esGuia=r.tipo==="guia"||r.tipo==="guia_factura"
            const esFactura=r.tipo==="factura"||r.tipo==="guia_factura"
            const tipoColor=r.tipo==="guia"?"#1E7A44":r.tipo==="factura"?"#5B2C6F":"#1D4E89"
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
                    <Bd c="#6E6E73" bg="#F4F5F7">{r.fecha}</Bd>
                    {esFactura&&r.monto&&<Bd c="#5B2C6F" bg="#5B2C6F12">{r.moneda==="USD"?fU(r.monto):fmt(r.monto)}</Bd>}
                  </div>
                  <div style={{fontSize:12,color:"#6E6E73",marginBottom:4}}>
                    {recItems.length} {recItems.length===1?"producto":"productos"} · {fN(totalCant)} unidades
                  </div>
                  {recItems.length>0&&<div style={{fontSize:12,color:"#6E6E73",marginTop:4}}>{recItems.slice(0,3).map(it=>`${it.producto} (${fN(it.cantidad)})`).join(" · ")}{recItems.length>3&&` · +${recItems.length-3} más`}</div>}
                  {r.notas&&<div style={{fontSize:12,color:"#6E6E73",marginTop:4,fontStyle:"italic"}}>💬 {r.notas}</div>}
                  {(()=>{ // ── Origen + respaldos físicos (Logística) + alerta de duplicado ──
                    const esc=t=>String(t||'').trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
                    const docMatch=(a,b)=>{const x=esc(a),y=esc(b);if(!x||!y)return false
                      return new RegExp(`(^|[^0-9])${x}([^0-9]|$)`).test(b)||new RegExp(`(^|[^0-9])${y}([^0-9]|$)`).test(a)}
                    const dups=recepciones.filter(o=>o.id!==r.id&&o.tipo===r.tipo&&docMatch(o.numero_doc,r.numero_doc))
                    const aj=adjLog.filter(a=>a.recepcion_id===r.log_recepcion_id)
                    const SLOT_L={doc_proveedor:"📄 Guía proveedor",comp_bsale:"🧾 Comp. BSALE",formulario_rec:"📋 Formulario",foto_danados:"📷 Fotos daños"}
                    const esFisica=r.tipo==="guia"||r.tipo==="guia_factura"
                    return<>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6,alignItems:"center"}}>
                        {esFisica&&(r.log_recepcion_id
                          ?<Bd c="#248A3D" bg="#1E7A4412">📦 recepción física en Logística</Bd>
                          :<Bd c="#B25E09" bg="#B25E0912">✍️ registro manual · sin respaldo físico</Bd>)}
                        {dups.length>0&&<Bd c="#C93400" bg="#B4231812">⚠ posible duplicado con {dups.map(d=>"#"+d.numero_doc).join(", ")} — validar</Bd>}
                      </div>
                      {(aj.length>0||r.archivo_url)&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
                        {r.archivo_url&&<a href={r.archivo_url} target="_blank" rel="noreferrer" style={{fontSize:11.5,fontWeight:700,color:"#1D4E89",background:"#1D4E890C",border:"1px solid #1D4E8925",padding:"3px 9px",borderRadius:9,textDecoration:"none"}}>📎 {r.archivo_nombre||"Documento"}</a>}
                        {aj.map((a,ix)=><a key={ix} href={a.url||a.link_externo} target="_blank" rel="noreferrer" style={{fontSize:11.5,fontWeight:700,color:"#223058",background:"#2230580C",border:"1px solid #22305825",padding:"3px 9px",borderRadius:9,textDecoration:"none"}}>{SLOT_L[a.slot]||"📄 "+(a.slot||"adjunto")}</a>)}
                      </div>}
                      {esFisica&&r.log_recepcion_id&&aj.length===0&&!r.archivo_url&&<div style={{fontSize:11,color:"#B25E09",fontWeight:600,marginTop:4}}>⚠ vinculada a Logística pero sin adjuntos cargados</div>}
                    </>})()}
                  {guiasVinculadas.length>0&&<div style={{fontSize:11,color:"#1E7A44",marginTop:4,fontWeight:600}}>🔗 Cubre guías: {guiasVinculadas.map(g=>"#"+g.numero_doc).join(", ")}</div>}
                  {facturasVinculadas.length>0&&<div style={{fontSize:11,color:"#5B2C6F",marginTop:4,fontWeight:600}}>🔗 Facturada en: {facturasVinculadas.map(f=>"#"+f.numero_doc).join(", ")}</div>}
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                  {r.archivo_url&&<a href={r.archivo_url} target="_blank" rel="noopener" style={{padding:"5px 10px",fontSize:12,fontWeight:600,background:"#1D4E89",color:"#fff",textDecoration:"none",borderRadius:6,display:"inline-flex",alignItems:"center",gap:4}}>📄 Ver</a>}
                  {oc.estado!=="Cerrada"&&<button onClick={()=>eliminarRecepcion(r)} style={{padding:"5px 10px",fontSize:12,background:"#B4231815",color:"#B42318",border:"1px solid #B4231830",borderRadius:6,cursor:"pointer",fontWeight:600}} title="Eliminar">🗑</button>}
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
        <div style={{width:36,height:4,borderRadius:2,background:"#E5E7EB",margin:"0 auto 12px"}}/>
        <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>
          {recForm.tipo==="guia"?"📦 Registrar guía de despacho":recForm.tipo==="factura"?"📋 Registrar factura":"📄 Registrar guía + factura"}
        </div>
        <div style={{fontSize:12,color:"#6E6E73",marginBottom:14}}>{oc.id} · {prov?.nombre}</div>

        {/* Canal único de recepciones (SOP): la recepción física se registra en
            Logística, que la refleja automáticamente aquí. Este panel queda como
            vía de REGULARIZACIÓN solo para administradores. */}
        <div style={{padding:"9px 12px",borderRadius:10,marginBottom:14,
          background:cu?.rol==="admin"?"#B25E0910":"#1D4E890A",
          border:cu?.rol==="admin"?"1px solid #B25E0935":"1px solid #1D4E8925"}}>
          <div style={{fontSize:11.5,fontWeight:800,color:["admin","analista"].includes(cu?.rol)?"#248A3D":"#1D4E89",marginBottom:2}}>
            {["admin","analista"].includes(cu?.rol)?"🔗 PUENTE ACTIVO CON LOGÍSTICA":"📍 LAS GUÍAS SE REGISTRAN EN LOGÍSTICA"}
          </div>
          <div style={{fontSize:12,color:"#6D6D72",lineHeight:1.4}}>
            {["admin","analista"].includes(cu?.rol)
              ?"Las guías que registres aquí se reflejan automáticamente en Logística, con su OC y proveedor. La recepción física con inspección de bultos sigue disponible en Logística; ambos caminos quedan vinculados."
              :"Las guías se recepcionan en el módulo Logística o las registra el equipo de compras, y se reflejan automáticamente en esta OC. Las facturas sí puedes registrarlas aquí."}
          </div>
        </div>

        {/* Selector de tipo (solo si el proveedor no fuerza combinado) */}
        {!facturaConGuia&&<div style={{display:"flex",gap:4,background:"#F4F5F7",borderRadius:8,padding:3,marginBottom:14,width:"fit-content"}}>
          {[{k:"guia",l:"📦 Guía"},{k:"factura",l:"📋 Factura"},{k:"guia_factura",l:"📄 Ambos"}].map(t=><button key={t.k} onClick={()=>setRecForm(p=>({...p,tipo:t.k}))} style={{padding:"6px 14px",borderRadius:6,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:recForm.tipo===t.k?"#fff":"transparent",color:recForm.tipo===t.k?"#1C1C1E":"#6E6E73",boxShadow:recForm.tipo===t.k?"0 1px 2px rgba(0,0,0,0.06)":"none"}}>{t.l}</button>)}
        </div>}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <Fl l="Número documento" req><input value={recForm.numero_doc} onChange={e=>setRecForm(p=>({...p,numero_doc:e.target.value}))} placeholder={recForm.tipo==="factura"?"Ej: 12345":"Ej: 98765"} style={css.input}/></Fl>
          <Fl l="Fecha" req><input type="date" value={recForm.fecha} onChange={e=>setRecForm(p=>({...p,fecha:e.target.value}))} style={css.input}/></Fl>
        </div>

        {(recForm.tipo==="factura"||recForm.tipo==="guia_factura")&&<div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:10,marginBottom:12,padding:"12px 14px",background:"#5B2C6F06",borderRadius:10,border:"1px solid #5B2C6F15"}}>
          <Fl l="Monto factura" req><input type="number" min={0} step="any" value={recForm.monto} onChange={e=>setRecForm(p=>({...p,monto:e.target.value}))} style={css.input} placeholder="0"/></Fl>
          <Fl l="Moneda"><select value={recForm.moneda} onChange={e=>setRecForm(p=>({...p,moneda:e.target.value}))} style={css.select}><option value="CLP">CLP</option><option value="USD">USD</option></select></Fl>
        </div>}

        {/* Selector de guías vinculadas (solo para facturas cuando hay guías registradas) */}
        {recForm.tipo==="factura"&&recepciones.filter(r=>r.tipo==="guia").length>0&&<Fl l="Guías que esta factura cubre (opcional)">
          <div style={{background:"#F9FAFB",borderRadius:10,padding:10,border:"1px solid #E5E7EB"}}>
            {recepciones.filter(r=>r.tipo==="guia").map(g=><label key={g.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",cursor:"pointer",fontSize:12,fontWeight:500}}>
              <input type="checkbox" checked={recForm.facturasVinculadas.includes(g.id)} onChange={e=>{
                setRecForm(p=>({...p,facturasVinculadas:e.target.checked?[...p.facturasVinculadas,g.id]:p.facturasVinculadas.filter(x=>x!==g.id)}))
              }} style={{accentColor:"#1E7A44"}}/>
              <span>📦 Guía #{g.numero_doc} · {g.fecha} · {fN(recepcionItems.filter(i=>i.recepcion_id===g.id).reduce((s,i)=>s+Number(i.cantidad||0),0))} uds</span>
            </label>)}
          </div>
        </Fl>}

        {/* Tabla de items */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>Cantidades del documento</div>
          <div style={{fontSize:12,color:"#6E6E73",marginBottom:8}}>Ingresa solo las cantidades que llegan en este documento</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{background:"#F4F5F7"}}>
              <th style={{padding:"6px 8px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73"}}>Producto</th>
              <th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:700,color:"#6E6E73",width:70}}>Pedido</th>
              <th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:700,color:"#1E7A44",width:80}}>Recibido acum.</th>
              {(recForm.tipo==="factura"||recForm.tipo==="guia_factura")&&<th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:700,color:"#5B2C6F",width:80}}>Facturado acum.</th>}
              <th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:700,color:"#B25E09",width:70}}>Pendiente</th>
              <th style={{padding:"6px",textAlign:"center",fontSize:11,fontWeight:700,color:"#1D4E89",width:80}}>Este doc.</th>
            </tr></thead>
            <tbody>{items.map(it=>{
              const recAcum=accRecibido[it.sku]||0
              const facAcum=accFacturado[it.sku]||0
              const tipoEsRec=recForm.tipo==="guia"||recForm.tipo==="guia_factura"
              const pend=tipoEsRec?((it.cantidad_pedida||0)-recAcum):((it.cantidad_pedida||0)-facAcum)
              return<tr key={it.id} style={{borderBottom:"1px solid #F4F5F7"}}>
                <td style={{padding:"6px 8px"}}><div style={{fontWeight:600,fontSize:12}}>{it.producto}</div><div style={{fontSize:11,color:"#AEAEB2"}}>{it.sku}</div></td>
                <td style={{padding:"6px",textAlign:"right"}}>{fN(it.cantidad_pedida||0)}</td>
                <td style={{padding:"6px",textAlign:"right",color:"#1E7A44",fontWeight:600}}>{fN(recAcum)}</td>
                {(recForm.tipo==="factura"||recForm.tipo==="guia_factura")&&<td style={{padding:"6px",textAlign:"right",color:"#5B2C6F",fontWeight:600}}>{fN(facAcum)}</td>}
                <td style={{padding:"6px",textAlign:"right",color:pend<=0?"#6E6E73":"#B25E09",fontWeight:700}}>{fN(Math.max(0,pend))}</td>
                {/* ⭐ Sin max ni disabled: se puede registrar sobre-entrega (más de lo pedido).
                    El borde naranja avisa visualmente que excede lo pendiente. */}
                <td style={{padding:"6px"}}>{(()=>{
                  const v=Number(recForm.itemsQty[it.id]||0)
                  const excede=v>Math.max(0,pend)
                  return<input type="number" min={0} value={recForm.itemsQty[it.id]||0} onChange={e=>setRecForm(p=>({...p,itemsQty:{...p.itemsQty,[it.id]:e.target.value}}))} title={excede?`Excede lo pendiente (${fN(Math.max(0,pend))}) en ${fN(v-Math.max(0,pend))} uds — se pedirá confirmación`:""} style={{width:70,textAlign:"right",padding:"4px 6px",borderRadius:6,border:excede?"2px solid #B25E09":v>0?"2px solid #1D4E89":"1px solid #E5E7EB",fontSize:12,fontWeight:600,background:excede?"#FFF8F0":"#fff"}}/>
                })()}</td>
              </tr>
            })}</tbody>
            <tfoot><tr style={{borderTop:"2px solid #1C1C1E",background:"#F8F8FA"}}>
              <td style={{padding:"8px",fontWeight:700}}>TOTAL EN ESTE DOC.</td>
              <td colSpan={3+(recForm.tipo==="factura"||recForm.tipo==="guia_factura"?1:0)}></td>
              <td style={{padding:"8px",textAlign:"center",fontSize:14,fontWeight:800,color:"#1D4E89"}}>{fN(Object.values(recForm.itemsQty).reduce((s,v)=>s+Number(v||0),0))}</td>
            </tr></tfoot>
          </table>
        </div>

        {/* Upload archivo */}
        <Fl l={`Adjuntar ${recForm.tipo==="guia"?"guía":recForm.tipo==="factura"?"factura":"documento"}${recForm.tipo==="factura"||recForm.tipo==="guia_factura"?" (recomendado)":" (opcional)"}`}>
          <div style={{border:"2px dashed "+(recForm.archivo?"#1E7A44":"#1D4E89"),borderRadius:12,padding:"12px 16px",textAlign:"center",cursor:"pointer",background:recForm.archivo?"#1E7A4408":"#1D4E8905"}}
            onClick={()=>document.getElementById("rec-file-input").click()}>
            {recForm.archivo?<>
              <div style={{fontSize:18}}>✅</div>
              <div style={{fontSize:12,fontWeight:600,color:"#1E7A44",marginTop:2}}>{recForm.archivoNombre}</div>
            </>:<>
              <div style={{fontSize:18}}>📎</div>
              <div style={{fontSize:12,fontWeight:600,color:"#1D4E89",marginTop:2}}>Click para adjuntar PDF o imagen</div>
            </>}
          </div>
          <input id="rec-file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" style={{display:"none"}}
            onChange={e=>{const f=e.target.files[0];if(f)setRecForm(p=>({...p,archivo:f,archivoNombre:f.name}));e.target.value=""}}/>
        </Fl>

        {recForm.tipo!=="factura"&&<label style={{display:"flex",alignItems:"flex-start",gap:10,padding:"11px 14px",background:recForm.regularizacion?"#B25E0910":"#F9FAFB",border:"1px solid "+(recForm.regularizacion?"#B25E0940":"#E5E7EB"),borderRadius:10,marginBottom:12,cursor:"pointer"}}>
          <input type="checkbox" checked={!!recForm.regularizacion} onChange={e=>setRecForm(p=>({...p,regularizacion:e.target.checked}))} style={{marginTop:2}}/>
          <div>
            <div style={{fontSize:12.5,fontWeight:700}}>Regularización — la mercadería ya fue recibida físicamente en bodega</div>
            <div style={{fontSize:12,color:"#6E6E73",marginTop:2,lineHeight:1.4}}>Sin marcar: la guía crea una recepción <b>pendiente</b> en Logística para que bodega ejecute el proceso físico (inspección, bultos, ingreso BSALE). Marcada: solo registro documental — nace completada.</div>
          </div>
        </label>}

        <Fl l="Notas (opcional)"><textarea value={recForm.notas} onChange={e=>setRecForm(p=>({...p,notas:e.target.value}))} rows={2} style={{...css.input,resize:"vertical"}} placeholder="Ej: Faltó un bulto, se completa en próximo despacho"/></Fl>

        <div style={{display:"flex",gap:10,marginTop:14}}>
          <Bt v="pri" full onClick={guardarRecepcion} dis={guardandoRec||(!["admin","analista"].includes(cu?.rol)&&recForm.tipo!=="factura")} ic={guardandoRec?"⏳":(!["admin","analista"].includes(cu?.rol)&&recForm.tipo!=="factura")?"🔒":"✓"}>{guardandoRec?"Guardando...":(!["admin","analista"].includes(cu?.rol)&&recForm.tipo!=="factura")?"Guías: registro en Logística":`Registrar ${recForm.tipo==="guia"?"guía":recForm.tipo==="factura"?"factura":"documento"}`}</Bt>
          <Bt v="gry" onClick={()=>setShowRecModal(false)}>Cancelar</Bt>
        </div>
      </div>
    </div>}

    </>}
    {tabF==="resumen"&&<>
    {(oc.estado==="Recibida OK"||oc.estado==="Recibida parcial")&&h("cerrar_oc")&&<div style={{marginTop:16}}><Bt v="gry" full onClick={()=>firma("Cerrada","Cerrada",isI?14:7)} ic="■">Cerrar OC</Bt></div>}
    </>}
  </div>

  {/* ⭐ Modal Split: position:fixed propio para evitar anidamiento con Sheet del detalle */}
  {showSplit&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(4px)",zIndex:2000,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={()=>setShowSplit(false)}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"8px 20px 32px",width:"100%",maxWidth:680,maxHeight:"92vh",overflowY:"auto"}}>
      <div style={{width:36,height:4,borderRadius:2,background:"#E5E7EB",margin:"0 auto 12px"}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontSize:18,fontWeight:700}}>✂ Dividir {oc.id} en dos partes</div>
        <button onClick={()=>setShowSplit(false)} style={{width:30,height:30,borderRadius:15,background:"#F4F5F7",border:"none",fontSize:14,cursor:"pointer"}}>✕</button>
      </div>
    <div style={{fontSize:12,color:"#6E6E73",marginBottom:14,background:"#22305810",borderRadius:8,padding:"10px 12px",border:"1px solid #22305830"}}>
      Asigna cuántas unidades van en cada parte. <b>Parte A + Parte B = cantidad original.</b> Las OCs hija nacerán en estado <b>{oc.estado}</b> heredando las aprobaciones.
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
      <Fl l="ETA Parte A" req>
        <input type="date" value={splitEtaA} onChange={e=>setSplitEtaA(e.target.value)} style={css.input}/>
        <div style={{fontSize:11,color:"#6E6E73",marginTop:3}}>→ {oc.id}-A</div>
      </Fl>
      <Fl l="ETA Parte B" req>
        <input type="date" value={splitEtaB} onChange={e=>setSplitEtaB(e.target.value)} style={css.input}/>
        <div style={{fontSize:11,color:"#6E6E73",marginTop:3}}>→ {oc.id}-B</div>
      </Fl>
    </div>
    <div style={{overflowX:"auto",marginBottom:16}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{background:"#F4F5F7"}}>
          <th style={{padding:"6px 8px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73"}}>PRODUCTO</th>
          <th style={{padding:"6px",textAlign:"right",fontSize:11,fontWeight:700,color:"#6E6E73"}}>ORIGINAL</th>
          <th style={{padding:"6px",textAlign:"center",fontSize:11,fontWeight:700,color:"#223058"}}>PARTE A</th>
          <th style={{padding:"6px",textAlign:"center",fontSize:11,fontWeight:700,color:"#1D4E89"}}>PARTE B</th>
          <th style={{padding:"6px",textAlign:"center",fontSize:11,fontWeight:700,color:"#6E6E73"}}>✓</th>
        </tr></thead>
        <tbody>{items.map(i=>{
          const orig=i.cantidad_pedida||0
          const a=Number(splitQty[i.id])||0
          const b=orig-a
          const ok=a>=0&&b>=0&&(a+b)===orig
          return<tr key={i.id} style={{borderBottom:"1px solid #F4F5F7",background:ok?"#fff":"#FFF0F0"}}>
            <td style={{padding:"6px 8px"}}>
              <div style={{fontWeight:600,fontSize:12}}>{i.producto}</div>
              <div style={{fontSize:11,color:"#6E6E73",fontFamily:"monospace"}}>{i.sku}</div>
            </td>
            <td style={{padding:"6px",textAlign:"right",fontWeight:700}}>{fN(orig)}</td>
            <td style={{padding:"6px",textAlign:"center"}}>
              <input type="number" min={0} max={orig} value={a}
                onChange={e=>setSplitQty(p=>({...p,[i.id]:Math.min(orig,Math.max(0,Number(e.target.value)))}))}
                style={{width:70,textAlign:"center",padding:"4px 6px",borderRadius:8,border:`1px solid ${ok?"#223058":"#B42318"}`,fontSize:13,fontWeight:700,color:"#223058"}}/>
            </td>
            <td style={{padding:"6px",textAlign:"center"}}>
              <div style={{width:70,textAlign:"center",padding:"4px 6px",borderRadius:8,border:"1px solid #1D4E8930",background:"#1D4E8908",fontSize:13,fontWeight:700,color:b>=0?"#1D4E89":"#B42318",display:"inline-block"}}>
                {b>=0?fN(b):"—"}
              </div>
            </td>
            <td style={{padding:"6px",textAlign:"center",fontSize:16}}>{ok?"✅":"⚠️"}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    {(()=>{
      const tA=items.reduce((s,i)=>{const a=Number(splitQty[i.id])||0;return s+a*(i.costo_unitario||0)},0)
      const tB=items.reduce((s,i)=>{const b=(i.cantidad_pedida||0)-(Number(splitQty[i.id])||0);return s+Math.max(0,b)*(i.costo_unitario||0)},0)
      return<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        <div style={{background:"#22305810",borderRadius:8,padding:10,textAlign:"center"}}>
          <div style={{fontSize:11,color:"#223058",fontWeight:700,marginBottom:2}}>PARTE A — {oc.id}-A</div>
          <div style={{fontSize:16,fontWeight:800,color:"#223058"}}>{isI?fUD(tA,2):fmt(Math.round(tA))}</div>
        </div>
        <div style={{background:"#1D4E8910",borderRadius:8,padding:10,textAlign:"center"}}>
          <div style={{fontSize:11,color:"#1D4E89",fontWeight:700,marginBottom:2}}>PARTE B — {oc.id}-B</div>
          <div style={{fontSize:16,fontWeight:800,color:"#1D4E89"}}>{isI?fUD(tB,2):fmt(Math.round(tB))}</div>
        </div>
      </div>
    })()}
    <Bt fw onClick={ejecutarSplit} disabled={splitSaving}>
      {splitSaving?"Dividiendo...":"✂ Confirmar división"}
    </Bt>
    </div>
  </div>}
  </>
}

/* ═══ FORECAST — Purchase forecast + new store expansion + compliance ═══ */
/* ═══ COBERTURA — Heatmap de cuadros con marcadores de reorden/emergencia/quiebre (v50)
   Matriz: filas = items, columnas = meses futuros.
   Cada celda muestra cobertura mensual.
   Marcadores especiales dentro de la celda indican:
   - ⏰ punto de reorden (borde amarillo)
   - ⚠ inicio emergencia (borde naranja)
   - ✕ quiebre (borde rojo grueso)
   - 📦 llegada de reposición si pido hoy (ícono azul)
   Columna "Acción" al lado del nombre con recomendación clara.
*/
function CoberturaView({prods=[],ocs=[],config={},params=[],paramsABCD=[]}){
  const[nivel,setNivel]=useLocalState("cob_nivel","sku")
  const[metodo,setMetodo]=useLocalState("cob_metodo","compensada")
  const[horizonte,setHorizonte]=useLocalState("cob_horizonte",6)
  const[abcdSel,setAbcdSel]=useLocalState("cob_abcdSel",{A:true,B:true,C:true,D:false})
  const[tipoSel,setTipoSel]=useLocalState("cob_tipoSel","")
  const[qSku,setQSku]=useLocalState("cob_qSku","")
  const[incluirTransito,setIncluirTransito]=useLocalState("cob_transito",true)
  const[expanded,setExpanded]=useState({})
  const[hoverCell,setHoverCell]=useState(null)
  const[hoverItem,setHoverItem]=useState(null)
  const[ordenarPor,setOrdenarPor]=useLocalState("cob_orden","urgencia")
  const[soloUrgentes,setSoloUrgentes]=useLocalState("cob_urgentes",false)

  const hoyDate=new Date()
  hoyDate.setHours(0,0,0,0)

  const totalMeses=Math.min(6,Math.max(1,Number(config.meses_analisis)||6))

  // Venta diaria sobre los N meses completos más recientes (mes en curso excluido por diseño de la matriz)
  const ventaDia=(p)=>{
    if(p&&p._v2)return Number(p.vta_prom_diaria)||0 // v2: demanda anual corregida por días sin stock
    const raw=[p.venta_mes_1,p.venta_mes_2,p.venta_mes_3,p.venta_mes_4,p.venta_mes_5,p.venta_mes_6].slice(-totalMeses)
    const consider=raw
    const limpios=consider.filter(v=>v!==null&&v!==undefined).map(v=>Number(v||0))
    if(metodo==="compensada"){
      const maxV=limpios.length>0?Math.max(...limpios):0
      const umbral=maxV*0.3
      const normal=limpios.filter(v=>v>=umbral&&v>0)
      const base=normal.length>=2?normal:limpios.filter(v=>v>0)
      const prom=base.length>0?base.reduce((s,v)=>s+v,0)/base.length:0
      return prom/30
    }
    const usables=limpios.filter(v=>v>0)
    return (usables.length>0?usables.reduce((s,v)=>s+v,0)/usables.length:0)/30
  }

  const getParams=(p)=>{
    const tp=(params||[]).find(t=>t.tipo_producto===p.tipo_producto)
    const abcd=(paramsABCD||[]).find(a=>a.clasificacion===p.clasif_abcd)
    return{
      diasFab:tp?.dias_fabricacion||p.dias_fabricacion||30,
      periodoCob:tp?.periodo_cobertura||p.periodo_cubrir||90,
      diasEmerg:abcd?.dias_emergencia||p.dias_emergencia||5
    }
  }

  // Productos base
  const prodsBase=useMemo(()=>prods.filter(p=>{
    if(!abcdSel[p.clasif_abcd])return false
    if(tipoSel&&p.tipo_producto!==tipoSel)return false
    if(qSku&&!((p.sku||"").toLowerCase().includes(qSku.toLowerCase())||(p.producto||"").toLowerCase().includes(qSku.toLowerCase())))return false
    return (p.stock_actual||0)>0||(p.venta_total||0)>0
  }),[prods,abcdSel,tipoSel,qSku])

  // Meses
  const meses=useMemo(()=>{
    const arr=[]
    for(let i=0;i<horizonte;i++){
      const d=new Date(hoyDate.getFullYear(),hoyDate.getMonth()+i,1)
      arr.push({idx:i,label:d.toLocaleDateString("es-CL",{month:"short"}).toUpperCase().replace(".",""),year:d.getFullYear(),month:d.getMonth()})
    }
    return arr
  },[horizonte])

  // Proyectar producto individual: devuelve celdas por mes + fechas críticas en días
  const proyectarProd=(p)=>{
    const vd=ventaDia(p)
    const vm=vd*30
    const stockInicial=(p.stock_actual||0)+(incluirTransito?(p.stock_transito||0):0)
    const{diasFab,periodoCob,diasEmerg}=getParams(p)

    const sinVenta=vd<=0
    const diasCobertura=sinVenta?999:Math.floor(stockInicial/vd)
    const diasHastaEmerg=sinVenta?999:Math.max(0,diasCobertura-diasEmerg)
    const diasHastaReorden=sinVenta?999:Math.max(0,diasCobertura-(diasFab+diasEmerg))

    // Acción recomendada
    let accion="Stock OK"; let accionColor="#1E7A44"; let accionIcon="✓"
    if(sinVenta){accion="Sin venta"; accionColor="#6E6E73"; accionIcon="—"}
    else if(diasCobertura<diasFab){accion="PEDIR YA"; accionColor="#B42318"; accionIcon="🚨"}
    else if(diasHastaReorden<=0){accion="Pedir"; accionColor="#B25E09"; accionIcon="⚠"}
    else if(diasHastaReorden<=15){accion=`Pedir en ${diasHastaReorden}d`; accionColor="#E6AC00"; accionIcon="⏰"}

    // Celdas por mes: stock al inicio del mes y qué demanda hay
    const celdas=[]
    let stock=stockInicial
    meses.forEach((m,i)=>{
      const stockAntes=stock
      const demanda=vm
      stock=Math.max(0,stock-demanda)
      const cobertura=demanda>0?Math.min(1,stockAntes/demanda):(stockAntes>0?1:0)
      const diaInicioMes=i*30
      const diaFinMes=(i+1)*30
      // Clasificación de la celda según zonas críticas
      // Un mes puede contener puntos de reorden/emergencia/quiebre/llegada
      const contieneReorden=!sinVenta&&diasHastaReorden>=diaInicioMes&&diasHastaReorden<diaFinMes
      const contieneEmerg=!sinVenta&&diasHastaEmerg>=diaInicioMes&&diasHastaEmerg<diaFinMes
      const contieneQuiebre=!sinVenta&&diasCobertura>=diaInicioMes&&diasCobertura<diaFinMes
      const contieneLlegada=!sinVenta&&diasFab>=diaInicioMes&&diasFab<diaFinMes
      // Zona dominante del mes (qué color usa de fondo)
      let zona="normal" // normal | reorden | emergencia | quiebre | sin_venta
      if(sinVenta)zona="sin_venta"
      else if(diaInicioMes>=diasCobertura)zona="quiebre"
      else if(diaInicioMes>=diasHastaEmerg)zona="emergencia"
      else if(diaInicioMes>=diasHastaReorden)zona="reorden"
      celdas.push({mes:m,stockInicio:stockAntes,demanda,cobertura,stockFin:stock,zona,contieneReorden,contieneEmerg,contieneQuiebre,contieneLlegada,diaInicioMes})
    })

    return{
      ventaDia:vd,ventaMes:vm,stockInicial,diasFab,periodoCob,diasEmerg,
      diasCobertura,diasHastaEmerg,diasHastaReorden,sinVenta,
      accion,accionColor,accionIcon,celdas
    }
  }

  // Agrupar por abcd o tipo con agregados
  const agrupar=(key)=>{
    const groups={}
    prodsBase.forEach(p=>{
      const k=(key==="abcd"?p.clasif_abcd:p.tipo_producto)||"Sin clasificar"
      if(!groups[k])groups[k]={prods:[]}
      groups[k].prods.push(p)
    })
    return Object.entries(groups).map(([k,g])=>{
      const proyectados=g.prods.map(p=>({p,proy:proyectarProd(p)}))
      const stockTotal=proyectados.reduce((s,x)=>s+x.proy.stockInicial,0)
      const vdTotal=proyectados.reduce((s,x)=>s+x.proy.ventaDia,0)
      const pesoTotal=vdTotal||1
      const fabProm=Math.round(proyectados.reduce((s,x)=>s+x.proy.diasFab*x.proy.ventaDia,0)/pesoTotal)
      const cobProm=Math.round(proyectados.reduce((s,x)=>s+x.proy.periodoCob*x.proy.ventaDia,0)/pesoTotal)
      const emergProm=Math.round(proyectados.reduce((s,x)=>s+x.proy.diasEmerg*x.proy.ventaDia,0)/pesoTotal)
      const sinVenta=vdTotal<=0
      const diasCob=sinVenta?999:Math.floor(stockTotal/vdTotal)
      const diasHastaEmerg=sinVenta?999:Math.max(0,diasCob-emergProm)
      const diasHastaReorden=sinVenta?999:Math.max(0,diasCob-(fabProm+emergProm))

      let accion="Stock OK";let accionColor="#1E7A44";let accionIcon="✓"
      if(sinVenta){accion="Sin venta";accionColor="#6E6E73";accionIcon="—"}
      else if(diasCob<fabProm){accion="PEDIR YA";accionColor="#B42318";accionIcon="🚨"}
      else if(diasHastaReorden<=0){accion="Pedir";accionColor="#B25E09";accionIcon="⚠"}
      else if(diasHastaReorden<=15){accion=`Pedir en ${diasHastaReorden}d`;accionColor="#E6AC00";accionIcon="⏰"}

      // Celdas agregadas (suma stock, suma demanda)
      const celdas=meses.map((m,i)=>{
        const stockAntes=proyectados.reduce((s,x)=>s+(x.proy.celdas[i]?.stockInicio||0),0)
        const demanda=proyectados.reduce((s,x)=>s+(x.proy.celdas[i]?.demanda||0),0)
        const stockFin=proyectados.reduce((s,x)=>s+(x.proy.celdas[i]?.stockFin||0),0)
        const cob=demanda>0?Math.min(1,stockAntes/demanda):(stockAntes>0?1:0)
        const diaInicioMes=i*30
        const diaFinMes=(i+1)*30
        const contieneReorden=!sinVenta&&diasHastaReorden>=diaInicioMes&&diasHastaReorden<diaFinMes
        const contieneEmerg=!sinVenta&&diasHastaEmerg>=diaInicioMes&&diasHastaEmerg<diaFinMes
        const contieneQuiebre=!sinVenta&&diasCob>=diaInicioMes&&diasCob<diaFinMes
        const contieneLlegada=!sinVenta&&fabProm>=diaInicioMes&&fabProm<diaFinMes
        let zona="normal"
        if(sinVenta)zona="sin_venta"
        else if(diaInicioMes>=diasCob)zona="quiebre"
        else if(diaInicioMes>=diasHastaEmerg)zona="emergencia"
        else if(diaInicioMes>=diasHastaReorden)zona="reorden"
        return{mes:m,stockInicio:stockAntes,demanda,cobertura:cob,stockFin,zona,contieneReorden,contieneEmerg,contieneQuiebre,contieneLlegada,diaInicioMes}
      })

      return{
        key:k,label:key==="abcd"?`Clase ${k}`:k,abcd:key==="abcd"?k:null,
        nProds:proyectados.length,prods:proyectados,
        stockInicial:stockTotal,ventaDia:vdTotal,ventaMes:vdTotal*30,
        diasFab:fabProm,periodoCob:cobProm,diasEmerg:emergProm,
        diasCobertura:diasCob,diasHastaEmerg,diasHastaReorden,sinVenta,
        accion,accionColor,accionIcon,celdas,esGrupo:true
      }
    })
  }

  const filas=useMemo(()=>{
    let arr=[]
    if(nivel==="sku"){
      arr=prodsBase.map(p=>{
        const proy=proyectarProd(p)
        return{
          key:p.sku||p.producto,
          label:p.producto,
          sub:`${p.sku||""} · ${p.tipo_producto||""}`,
          abcd:p.clasif_abcd,
          nProds:1,
          ...proy,
          esGrupo:false,
          prod:p
        }
      })
    }else{
      arr=agrupar(nivel)
    }
    if(soloUrgentes){
      arr=arr.filter(f=>f.accion==="PEDIR YA"||f.accion==="Pedir"||(f.accion&&f.accion.startsWith("Pedir en")))
    }
    if(ordenarPor==="urgencia"){
      const rank=(a)=>a.accion==="PEDIR YA"?0:a.accion==="Pedir"?1:(a.accion&&a.accion.startsWith("Pedir en"))?2:a.accion==="Stock OK"?3:4
      arr.sort((a,b)=>{const r=rank(a)-rank(b);if(r!==0)return r;return a.diasCobertura-b.diasCobertura})
    }else if(ordenarPor==="venta"){
      arr.sort((a,b)=>b.ventaMes-a.ventaMes)
    }else{
      arr.sort((a,b)=>a.label.localeCompare(b.label))
    }
    if(nivel==="abcd"){
      const o={A:0,B:1,C:2,D:3};arr.sort((a,b)=>(o[a.key]??9)-(o[b.key]??9))
    }
    return arr
  },[prodsBase,nivel,metodo,incluirTransito,ordenarPor,soloUrgentes])

  const tiposUnicos=[...new Set(prods.map(p=>p.tipo_producto).filter(Boolean))].sort()

  // Color según zona del mes
  const colorZona=(cel)=>{
    if(cel.zona==="sin_venta")return{bg:"#F5F5F7",c:"#6E6E73",label:"—"}
    if(cel.zona==="quiebre")return{bg:"#FAD4D0",c:"#8B1A10",label:"0%"}
    if(cel.zona==="emergencia")return{bg:"#FFE5CC",c:"#9B4A00",label:Math.round(cel.cobertura*100)+"%"}
    if(cel.zona==="reorden")return{bg:"#FEF5D6",c:"#8B6A00",label:Math.round(cel.cobertura*100)+"%"}
    // zona normal: tonos tenues de verde según cobertura
    if(cel.cobertura>=1)return{bg:"#DCF5E3",c:"#1C7D3E",label:"✓"}
    if(cel.cobertura>=0.75)return{bg:"#EAF7EE",c:"#256B3C",label:Math.round(cel.cobertura*100)+"%"}
    if(cel.cobertura>=0.5)return{bg:"#FEF5D6",c:"#8B6A00",label:Math.round(cel.cobertura*100)+"%"}
    return{bg:"#FFE5CC",c:"#9B4A00",label:Math.round(cel.cobertura*100)+"%"}
  }

  // Fecha + días → string
  const fmtFecha=(diasDesdeHoy)=>{
    const d=new Date(hoyDate)
    d.setDate(d.getDate()+Math.round(diasDesdeHoy))
    return d.toLocaleDateString("es-CL",{day:"2-digit",month:"short"})
  }

  const resumen=useMemo(()=>{
    const urg=filas.filter(f=>f.accion==="PEDIR YA").length
    const prio=filas.filter(f=>f.accion==="Pedir").length
    const pron=filas.filter(f=>f.accion&&f.accion.startsWith("Pedir en")).length
    const ok=filas.filter(f=>f.accion==="Stock OK").length
    const sinV=filas.filter(f=>f.accion==="Sin venta").length
    return{urg,prio,pron,ok,sinV}
  },[filas])

  return<div onMouseLeave={()=>{setHoverCell(null);setHoverItem(null)}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:12,flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>📅 Calendario de Cobertura</div>
        <div style={{fontSize:12,color:"#6E6E73"}}>Heatmap mensual con zonas críticas según <strong>lead time</strong>, <strong>cobertura</strong> y <strong>emergencia</strong>. Cada celda indica el % de demanda cubierto con el stock proyectado.</div>
      </div>
    </div>

    {/* FILTROS */}
    <Cd s={{marginBottom:12}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",marginBottom:4}}>Nivel</div>
          <select value={nivel} onChange={e=>setNivel(e.target.value)} style={css.select}>
            <option value="sku">Por SKU individual</option>
            <option value="tipo">Por tipo de producto</option>
            <option value="abcd">Por clase ABCD</option>
          </select>
        </div>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",marginBottom:4}}>Método de venta</div>
          <select value={metodo} onChange={e=>setMetodo(e.target.value)} style={css.select}>
            <option value="compensada">Compensada (excluye quiebres)</option>
            <option value="simple">Simple (prom. 4 meses)</option>
          </select>
        </div>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",marginBottom:4}}>Horizonte</div>
          <select value={horizonte} onChange={e=>setHorizonte(Number(e.target.value))} style={css.select}>
            <option value={3}>3 meses</option>
            <option value={6}>6 meses</option>
            <option value={12}>12 meses</option>
            <option value={18}>18 meses</option>
          </select>
        </div>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",marginBottom:4}}>Tipo</div>
          <select value={tipoSel} onChange={e=>setTipoSel(e.target.value)} style={css.select}>
            <option value="">Todos</option>
            {tiposUnicos.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",marginBottom:4}}>Ordenar por</div>
          <select value={ordenarPor} onChange={e=>setOrdenarPor(e.target.value)} style={css.select}>
            <option value="urgencia">Urgencia (PEDIR YA primero)</option>
            <option value="venta">Mayor venta mensual</option>
            <option value="nombre">Nombre alfabético</option>
          </select>
        </div>
      </div>
      <div style={{display:"flex",gap:12,marginTop:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>ABCD:</div>
        {["A","B","C","D"].map(k=><label key={k} style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",padding:"4px 10px",borderRadius:6,background:abcdSel[k]?(CL[k]?.bg||"#1D4E8915"):"#F4F5F7",color:abcdSel[k]?(CL[k]?.c||"#1D4E89"):"#6E6E73",fontSize:12,fontWeight:600}}>
          <input type="checkbox" checked={!!abcdSel[k]} onChange={e=>setAbcdSel(p=>({...p,[k]:e.target.checked}))} style={{width:14,height:14}}/>
          Clase {k}
        </label>)}
        <label style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",padding:"4px 10px",borderRadius:6,background:incluirTransito?"#1D4E8915":"#F4F5F7",color:incluirTransito?"#1D4E89":"#6E6E73",fontSize:12,fontWeight:600}}>
          <input type="checkbox" checked={incluirTransito} onChange={e=>setIncluirTransito(e.target.checked)} style={{width:14,height:14}}/>
          Incluir tránsito
        </label>
        <label style={{display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer",padding:"4px 10px",borderRadius:6,background:soloUrgentes?"#B4231815":"#F4F5F7",color:soloUrgentes?"#B42318":"#6E6E73",fontSize:12,fontWeight:600}}>
          <input type="checkbox" checked={soloUrgentes} onChange={e=>setSoloUrgentes(e.target.checked)} style={{width:14,height:14}}/>
          Solo urgentes
        </label>
        {nivel==="sku"&&<input placeholder="Buscar SKU o producto..." value={qSku} onChange={e=>setQSku(e.target.value)} style={{...css.input,flex:"1 1 200px",fontSize:12,padding:"6px 10px"}}/>}
      </div>
    </Cd>

    {/* LEYENDA */}
    <div style={{display:"flex",gap:10,flexWrap:"wrap",fontSize:12,marginBottom:10,padding:"10px 14px",background:"#fff",borderRadius:8,alignItems:"center"}}>
      <span style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Zonas:</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:14,height:14,background:"#DCF5E3",borderRadius:3,border:"1px solid #BDE5C8"}}/>Normal</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:14,height:14,background:"#FEF5D6",borderRadius:3,border:"1px solid #F0E4AB"}}/>Reorden</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:14,height:14,background:"#FFE5CC",borderRadius:3,border:"1px solid #F0CAA1"}}/>Emergencia</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{width:14,height:14,background:"#FAD4D0",borderRadius:3,border:"1px solid #E5A9A3"}}/>Quiebre</span>
      <span style={{width:1,height:20,background:"#E5E7EB",margin:"0 4px"}}/>
      <span style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Marcadores:</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{fontSize:14}}>⏰</span>Punto reorden</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{fontSize:14}}>⚠</span>Emergencia</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{fontSize:14}}>✕</span>Quiebre</span>
      <span style={{display:"inline-flex",alignItems:"center",gap:4}}><span style={{fontSize:14}}>📦</span>Llegada si pido hoy</span>
    </div>

    {/* RESUMEN */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:12}}>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #B42318"}}>
        <div style={{fontSize:11,color:"#B42318",fontWeight:700,textTransform:"uppercase"}}>🚨 Pedir ya</div>
        <div style={{fontSize:20,fontWeight:800,color:"#B42318"}}>{resumen.urg}</div>
        <div style={{fontSize:11,color:"#6E6E73"}}>no alcanza el lead time</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #B25E09"}}>
        <div style={{fontSize:11,color:"#B25E09",fontWeight:700,textTransform:"uppercase"}}>⚠ Pedir</div>
        <div style={{fontSize:20,fontWeight:800,color:"#B25E09"}}>{resumen.prio}</div>
        <div style={{fontSize:11,color:"#6E6E73"}}>cruzó pto. reorden</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #E6AC00"}}>
        <div style={{fontSize:11,color:"#A07D00",fontWeight:700,textTransform:"uppercase"}}>⏰ Pedir pronto</div>
        <div style={{fontSize:20,fontWeight:800,color:"#A07D00"}}>{resumen.pron}</div>
        <div style={{fontSize:11,color:"#6E6E73"}}>en 15 días</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #1E7A44"}}>
        <div style={{fontSize:11,color:"#1E7A44",fontWeight:700,textTransform:"uppercase"}}>✓ Stock OK</div>
        <div style={{fontSize:20,fontWeight:800,color:"#1E7A44"}}>{resumen.ok}</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #6E6E73"}}>
        <div style={{fontSize:11,color:"#6E6E73",fontWeight:700,textTransform:"uppercase"}}>Sin venta</div>
        <div style={{fontSize:20,fontWeight:800,color:"#6E6E73"}}>{resumen.sinV}</div>
      </div>
    </div>

    {/* HEATMAP */}
    <Cd>
      {filas.length===0?<div style={{padding:30,textAlign:"center",color:"#6E6E73"}}>No hay productos que cumplan los filtros.</div>:
      <div style={{overflow:"auto",position:"relative"}}>
        <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",borderRadius:10,border:"1px solid #E5E7EB"}}><table style={{borderCollapse:"separate",borderSpacing:3,width:"100%",minWidth:1000}}>
          <thead>
            <tr>
              <th style={{textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",padding:"4px 8px",position:"sticky",left:0,background:"#fff",zIndex:3,minWidth:250}}>Ítem</th>
              <th style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",padding:"4px 6px",minWidth:105,textAlign:"center",position:"sticky",left:250,background:"#fff",zIndex:3}}>Acción</th>
              <th style={{textAlign:"right",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",padding:"4px 6px",minWidth:85}}>Stock+Tr</th>
              <th style={{textAlign:"right",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",padding:"4px 6px",minWidth:90}}>Venta prom.</th>
              {meses.map(m=><th key={m.idx} style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",textAlign:"center",padding:"4px 2px",minWidth:64}}>
                <div>{m.label}</div>
                <div style={{fontSize:10.5,color:"#AEAEB2"}}>'{String(m.year).slice(2)}</div>
              </th>)}
            </tr>
          </thead>
          <tbody>
            {filas.map(fila=>{
              const abcdColor=fila.abcd?CL[fila.abcd]:null
              const expandable=fila.esGrupo&&nivel!=="sku"
              const estaExpandido=!!expanded[fila.key]
              const isHoverRow=hoverItem===fila.key
              return<>
                <tr key={fila.key}>
                  <td onMouseEnter={()=>setHoverItem(fila.key)} style={{padding:"8px",background:"#fff",position:"sticky",left:0,zIndex:1,borderBottom:"1px solid #F4F5F7"}} onClick={()=>{if(expandable)setExpanded(p=>({...p,[fila.key]:!p[fila.key]}))}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,cursor:expandable?"pointer":"default",minWidth:0}}>
                      {expandable&&<span style={{fontSize:11,color:"#6E6E73",width:10}}>{estaExpandido?"▼":"▶"}</span>}
                      {abcdColor&&<span style={{fontSize:11,fontWeight:700,padding:"2px 6px",borderRadius:4,background:abcdColor.bg,color:abcdColor.c,flexShrink:0}}>{fila.abcd}</span>}
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fila.label}</div>
                        <div style={{fontSize:11,color:"#AEAEB2",marginTop:1}}>
                          {fila.nProds>1?`${fila.nProds} SKU`:""}
                          {!fila.sinVenta&&<span style={{color:"#1D4E89",marginLeft:fila.nProds>1?6:0,fontWeight:600}}>fab {fila.diasFab}d · emerg {fila.diasEmerg}d</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{padding:"8px 6px",background:"#fff",position:"sticky",left:250,zIndex:1,borderBottom:"1px solid #F4F5F7",textAlign:"center"}}>
                    <div style={{display:"inline-block",padding:"4px 6px",borderRadius:6,background:fila.accionColor+"20",color:fila.accionColor,fontSize:11,fontWeight:700,border:`1px solid ${fila.accionColor}40`,whiteSpace:"nowrap"}}>
                      {fila.accionIcon} {fila.accion}
                    </div>
                  </td>
                  <td style={{textAlign:"right",padding:"8px 6px",fontSize:12,fontWeight:700,color:"#1D4E89",borderBottom:"1px solid #F4F5F7"}}>
                    {fN(fila.stockInicial)}
                    {!fila.sinVenta&&<div style={{fontSize:10.5,color:"#6E6E73",fontWeight:500,marginTop:1}}>{fila.diasCobertura}d</div>}
                  </td>
                  <td style={{textAlign:"right",padding:"8px 6px",fontSize:12,fontWeight:700,color:"#223058",borderBottom:"1px solid #F4F5F7"}}>
                    {fila.sinVenta?<span style={{color:"#C7C7CC"}}>—</span>:<>
                      {fN(Math.round(fila.ventaMes))}
                      <div style={{fontSize:10.5,color:"#6E6E73",fontWeight:500,marginTop:1}}>{fila.ventaDia.toFixed(1)}/día</div>
                    </>}
                  </td>
                  {fila.celdas.map((cel,i)=>{
                    const col=colorZona(cel)
                    const cellKey=`${fila.key}-${i}`
                    const isHover=hoverCell===cellKey
                    // Marcadores superpuestos
                    const icons=[]
                    if(cel.contieneReorden)icons.push({ic:"⏰",c:"#FFD60A",title:"Punto de reorden"})
                    if(cel.contieneEmerg)icons.push({ic:"⚠",c:"#B25E09",title:"Inicio emergencia"})
                    if(cel.contieneQuiebre)icons.push({ic:"✕",c:"#B42318",title:"Quiebre"})
                    if(cel.contieneLlegada)icons.push({ic:"📦",c:"#1D4E89",title:"Llegada reposición"})
                    return<td key={i} style={{padding:0,borderBottom:"1px solid #F4F5F7"}}>
                      <div
                        onMouseEnter={()=>setHoverCell(cellKey)}
                        onMouseLeave={()=>setHoverCell(null)}
                        style={{
                          background:col.bg,
                          color:col.c,
                          borderRadius:6,
                          padding:"6px 3px",
                          textAlign:"center",
                          fontSize:12,
                          fontWeight:700,
                          minHeight:52,
                          display:"flex",
                          flexDirection:"column",
                          justifyContent:"center",
                          alignItems:"center",
                          position:"relative",
                          transform:isHover?"scale(1.08)":"scale(1)",
                          transition:"transform 0.15s",
                          boxShadow:isHover?"0 4px 12px rgba(0,0,0,0.2)":"none",
                          cursor:"help",
                          border:cel.contieneQuiebre?"2px solid #D17068":cel.contieneEmerg?"2px solid #D89660":cel.contieneReorden?"2px solid #C4A43A":"none",
                          zIndex:isHover?5:1
                        }}>
                        <div style={{lineHeight:1.1}}>{col.label}</div>
                        {!cel.sinVenta&&fila.ventaDia>0&&<div style={{fontSize:10.5,opacity:0.85,marginTop:2,lineHeight:1}}>{fN(cel.stockInicio)}u</div>}
                        {/* íconos marcadores */}
                        {icons.length>0&&<div style={{display:"flex",gap:2,justifyContent:"center",marginTop:3}}>
                          {icons.map((ic,k)=><span key={k} title={ic.title} style={{fontSize:11,background:"#fff",borderRadius:8,width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",border:`1.5px solid ${ic.c}`,boxShadow:"0 1px 2px rgba(0,0,0,0.15)"}}>{ic.ic}</span>)}
                        </div>}
                        {/* tooltip */}
                        {isHover&&<div style={{position:"absolute",bottom:"calc(100% + 8px)",left:"50%",transform:"translateX(-50%)",background:"#1C1C1E",color:"#fff",padding:"8px 10px",borderRadius:6,fontSize:12,whiteSpace:"nowrap",zIndex:100,fontWeight:500,pointerEvents:"none",boxShadow:"0 4px 12px rgba(0,0,0,0.3)",textAlign:"left"}}>
                          <div style={{fontWeight:700,marginBottom:3,fontSize:12}}>{cel.mes.label} {cel.mes.year}</div>
                          {cel.sinVenta?<div>Sin venta registrada</div>:<>
                            <div>Stock inicio: <b>{fN(cel.stockInicio)}</b>u</div>
                            <div>Demanda: <b>{fN(cel.demanda)}</b>u</div>
                            <div>Stock fin: <b>{fN(cel.stockFin)}</b>u</div>
                            <div style={{marginTop:3,fontWeight:700}}>Cobertura: {Math.round(cel.cobertura*100)}%</div>
                            {cel.contieneReorden&&<div style={{color:"#FFD60A",marginTop:2}}>⏰ Contiene punto de reorden</div>}
                            {cel.contieneEmerg&&<div style={{color:"#B25E09"}}>⚠ Contiene inicio emergencia</div>}
                            {cel.contieneQuiebre&&<div style={{color:"#B42318"}}>✕ Aquí se proyecta el quiebre</div>}
                            {cel.contieneLlegada&&<div style={{color:"#1D4E89"}}>📦 Llegaría reposición si pido hoy</div>}
                          </>}
                        </div>}
                      </div>
                    </td>
                  })}
                </tr>
                {/* Panel expandido: detalles del producto/grupo */}
                {isHoverRow&&!fila.sinVenta&&<tr>
                  <td colSpan={meses.length+4} style={{padding:0,border:"none"}}>
                    <div style={{background:"#1C1C1E",color:"#fff",padding:"10px 14px",borderRadius:6,margin:"4px 0",fontSize:12,display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 2fr",gap:16,alignItems:"center"}}>
                      <div>
                        <div style={{fontSize:11,color:"#6E6E73",textTransform:"uppercase",fontWeight:700,marginBottom:3}}>Parámetros</div>
                        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                          <span><span style={{color:"#1D4E89"}}>●</span> Lead time: <b>{fila.diasFab}d</b></span>
                          <span><span style={{color:"#1E7A44"}}>●</span> Cobertura: <b>{fila.periodoCob}d</b></span>
                          <span><span style={{color:"#B25E09"}}>●</span> Emergencia: <b>{fila.diasEmerg}d</b></span>
                        </div>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:"#FFD60A",fontWeight:700}}>⏰ Reorden</div>
                        <div style={{fontWeight:600}}>{fila.diasHastaReorden>0?`en ${fila.diasHastaReorden}d`:"YA"}</div>
                        <div style={{fontSize:10.5,color:"#6E6E73"}}>{fmtFecha(Math.max(0,fila.diasHastaReorden))}</div>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:"#B25E09",fontWeight:700}}>⚠ Emergencia</div>
                        <div style={{fontWeight:600}}>{fila.diasHastaEmerg>0?`en ${fila.diasHastaEmerg}d`:"YA"}</div>
                        <div style={{fontSize:10.5,color:"#6E6E73"}}>{fmtFecha(Math.max(0,fila.diasHastaEmerg))}</div>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:"#B42318",fontWeight:700}}>✕ Quiebre</div>
                        <div style={{fontWeight:600}}>en {fila.diasCobertura}d</div>
                        <div style={{fontSize:10.5,color:"#6E6E73"}}>{fmtFecha(fila.diasCobertura)}</div>
                      </div>
                      <div style={{padding:"8px 10px",background:fila.accionColor+"30",borderRadius:5,borderLeft:`3px solid ${fila.accionColor}`}}>
                        <div style={{fontSize:11,color:"#6E6E73",fontWeight:700,textTransform:"uppercase",marginBottom:2}}>Recomendación</div>
                        <div style={{fontWeight:700,color:fila.accionColor,fontSize:12,lineHeight:1.3}}>
                          {fila.accion==="PEDIR YA"?`🚨 Agotamiento en ${fila.diasCobertura}d pero reposición tarda ${fila.diasFab}d`:
                           fila.accion==="Pedir"?`⚠ Ya cruzaste reorden, pedí ahora`:
                           fila.accion.startsWith("Pedir en")?`⏰ ${fila.accion}, planificá la OC`:
                           `✓ Cobertura OK por ${fila.diasCobertura}d`}
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>}
                {/* Sub-filas (expandir grupo) */}
                {expandable&&estaExpandido&&fila.prods.slice(0,expanded[fila.key+"_all"]?fila.prods.length:25).map(({p,proy})=>{
                  return<tr key={fila.key+"-"+p.sku}>
                    <td style={{padding:"4px 8px 4px 32px",background:"#FAFAFA",position:"sticky",left:0,zIndex:1,borderBottom:"1px solid #F4F5F7"}}>
                      <div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.producto}</div>
                      <div style={{fontSize:10.5,color:"#AEAEB2",marginTop:1}}>{p.sku} · fab {proy.diasFab}d · emerg {proy.diasEmerg}d</div>
                    </td>
                    <td style={{padding:"4px 6px",background:"#FAFAFA",position:"sticky",left:250,zIndex:1,borderBottom:"1px solid #F4F5F7",textAlign:"center"}}>
                      <div style={{display:"inline-block",padding:"2px 5px",borderRadius:4,background:proy.accionColor+"20",color:proy.accionColor,fontSize:10.5,fontWeight:700,whiteSpace:"nowrap"}}>{proy.accionIcon} {proy.accion}</div>
                    </td>
                    <td style={{textAlign:"right",padding:"4px 6px",fontSize:12,fontWeight:600,color:"#1D4E89",borderBottom:"1px solid #F4F5F7",background:"#FAFAFA"}}>{fN(proy.stockInicial)}</td>
                    <td style={{textAlign:"right",padding:"4px 6px",fontSize:12,fontWeight:600,color:"#223058",borderBottom:"1px solid #F4F5F7",background:"#FAFAFA"}}>
                      {proy.sinVenta?<span style={{color:"#C7C7CC"}}>—</span>:fN(Math.round(proy.ventaMes))}
                    </td>
                    {proy.celdas.map((cel,i)=>{
                      const col=colorZona(cel)
                      const icons=[]
                      if(cel.contieneReorden)icons.push({ic:"⏰",c:"#FFD60A"})
                      if(cel.contieneEmerg)icons.push({ic:"⚠",c:"#B25E09"})
                      if(cel.contieneQuiebre)icons.push({ic:"✕",c:"#B42318"})
                      if(cel.contieneLlegada)icons.push({ic:"📦",c:"#1D4E89"})
                      return<td key={i} style={{padding:0,borderBottom:"1px solid #F4F5F7",background:"#FAFAFA"}}>
                        <div style={{background:col.bg,color:col.c,borderRadius:4,padding:"4px 3px",textAlign:"center",fontSize:11,fontWeight:700,minHeight:36,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",opacity:0.88,position:"relative"}}>
                          <div>{col.label}</div>
                          {icons.length>0&&<div style={{display:"flex",gap:1,justifyContent:"center",marginTop:2}}>
                            {icons.map((ic,k)=><span key={k} style={{fontSize:8,background:"#fff",borderRadius:6,width:12,height:12,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${ic.c}`}}>{ic.ic}</span>)}
                          </div>}
                        </div>
                      </td>
                    })}
                  </tr>
                })}
                {expandable&&estaExpandido&&fila.prods.length>25&&!expanded[fila.key+"_all"]&&<tr>
                  <td colSpan={meses.length+4} style={{padding:"4px 8px 4px 32px",background:"#FAFAFA",fontSize:11,color:"#1D4E89",fontStyle:"italic",cursor:"pointer",textDecoration:"underline"}} onClick={e=>{e.stopPropagation();setExpanded(p=>({...p,[fila.key+"_all"]:true}))}}>
                    + {fila.prods.length-25} SKU más — clic para ver todos
                  </td>
                </tr>}
              </>
            })}
          </tbody>
        </table></div>
      </div>}
    </Cd>

    {/* NOTA METODOLÓGICA */}
    <div style={{marginTop:12,padding:"10px 14px",background:"#1D4E8908",borderRadius:8,fontSize:12,color:"#3A3A3C",lineHeight:1.5}}>
      <strong>📌 Cómo se lee:</strong> Cada celda es un mes. El color indica el estado del stock: <span style={{color:"#1E7A44",fontWeight:700}}>verde</span> (stock normal), <span style={{color:"#A07D00",fontWeight:700}}>amarillo</span> (pasó pto reorden), <span style={{color:"#B25E09",fontWeight:700}}>naranja</span> (emergencia), <span style={{color:"#B42318",fontWeight:700}}>rojo rayado</span> (quiebre). Los íconos en la esquina superior derecha marcan eventos que ocurren dentro de ese mes: ⏰ se cruza el punto de reorden, ⚠ entra en emergencia, ✕ se proyecta el quiebre, 📦 llegaría una OC si pidieras hoy. <strong>Si ves 📦 DESPUÉS de ✕, no alcanzás el lead time → PEDIR YA.</strong> Pasa el mouse sobre una fila para ver los parámetros (lead time, cobertura, emergencia) y las fechas exactas.
    </div>
  </div>
}

/* ═══ LLEGADAS — Calendario mensual de llegadas de OCs (v48) ═══ */
function LlegadasView({ocs=[],provs=[],setDet,config={},updOC=async()=>{},sucursales=[],addFirma=async()=>{}}){
  const hoyDate=new Date()
  const[cursor,setCursor]=useState({year:hoyDate.getFullYear(),month:hoyDate.getMonth()})
  const[filtroTipo,setFiltroTipo]=useLocalState("lleg_tipo","todos")
  const[filtroEstado,setFiltroEstado]=useLocalState("lleg_estado","todos")
  // ⭐ Reprogramar fecha
  const[reprog,setReprog]=useState(null)   // {ocId, fecha} mientras se edita
  const[savingReprog,setSavingReprog]=useState(null)
  // ⭐ Editar sucursal destino
  const[editSuc,setEditSuc]=useState(null) // ocId que está editando sucursal
  const[savingSuc,setSavingSuc]=useState(null)

  // 18-oct-2026: cada reprogramación y cambio de destino queda en el historial de la OC (antes se cambiaba sin rastro)
  const confirmarReprog=async(ocId,nuevaFecha)=>{
    if(!nuevaFecha)return
    const oc=ocs.find(o=>o.id===ocId)
    setSavingReprog(ocId)
    try{
      await updOC(ocId,{fecha_estimada:nuevaFecha})
      if(oc&&oc.fecha_estimada!==nuevaFecha)await addFirma(ocId,`Llegada reprogramada: ${oc.fecha_estimada||"sin fecha"} → ${nuevaFecha}`)
    }catch(e){}
    setReprog(null);setSavingReprog(null)
  }
  const confirmarSucursal=async(ocId,nuevaSuc)=>{
    const oc=ocs.find(o=>o.id===ocId)
    const nom=id=>sucursales.find(x=>x.id===id)?.nombre||"Sin asignar"
    setSavingSuc(ocId)
    try{
      await updOC(ocId,{destino_sucursal_id:nuevaSuc})
      if(oc&&(oc.destino_sucursal_id||null)!==(nuevaSuc||null))await addFirma(ocId,`Destino cambiado: ${nom(oc.destino_sucursal_id)} → ${nom(nuevaSuc)}`)
    }catch(e){}
    setEditSuc(null);setSavingSuc(null)
  }
  // Cargar usuarios con permiso recibir para GCal
  const[usersGCal,setUsersGCal]=useState([])
  useEffect(()=>{
    supabase.from('usuarios').select('correo,rol,nombre').eq('activo',true)
      .then(({data})=>setUsersGCal((data||[]).filter(u=>["dir_operaciones","jefe_bodega","jefe_operaciones","admin","dir_general"].includes(u.rol))))
  },[])

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
    if(recibida)return{bg:"#1E7A4415",c:"#1E7A44",border:"#1E7A4440"}
    if(recibidaParcial)return{bg:"#B25E0915",c:"#B25E09",border:"#B25E0940"}
    if(atrasada)return{bg:"#B4231815",c:"#B42318",border:"#B4231840"}
    if(proxima)return{bg:"#B25E0915",c:"#B25E09",border:"#B25E0940"}
    return{bg:"#1D4E8915",c:"#1D4E89",border:"#1D4E8940"}
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
    pendientes:ocsDelMes.filter(o=>!["Recibida OK","Recibida parcial","Cerrada","Rechazada","Anulada","Borrador"].includes(o.estado)).length,
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
        <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>📆 Calendario de Llegadas</div>
        <div style={{fontSize:12,color:"#6E6E73"}}>Fechas estimadas de llegada de órdenes de compra al CD. Navega por mes y haz clic en una OC para ver su detalle.</div>
      </div>
    </div>

    {/* CONTROLES */}
    <Cd s={{marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <Bt sm v="gry" onClick={prevMonth} ic="◀">Anterior</Bt>
        <div style={{fontSize:16,fontWeight:800,minWidth:180,textAlign:"center"}}>{mesLabel?mesLabel.charAt(0).toUpperCase()+mesLabel.slice(1):""}</div>
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
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #1D4E89"}}>
        <div style={{fontSize:11,color:"#6E6E73",fontWeight:600,textTransform:"uppercase"}}>OCs en el mes</div>
        <div style={{fontSize:20,fontWeight:800}}>{resumen.total}</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #1E7A44"}}>
        <div style={{fontSize:11,color:"#1E7A44",fontWeight:600,textTransform:"uppercase"}}>Recibidas</div>
        <div style={{fontSize:20,fontWeight:800,color:"#1E7A44"}}>{resumen.recibidas}</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #B25E09"}}>
        <div style={{fontSize:11,color:"#B25E09",fontWeight:600,textTransform:"uppercase"}}>Pendientes</div>
        <div style={{fontSize:20,fontWeight:800,color:"#B25E09"}}>{resumen.pendientes}</div>
      </div>
      <div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #B42318"}}>
        <div style={{fontSize:11,color:"#B42318",fontWeight:600,textTransform:"uppercase"}}>Atrasadas</div>
        <div style={{fontSize:20,fontWeight:800,color:"#B42318"}}>{resumen.atrasadas}</div>
      </div>
      {resumen.totalUSD>0&&<div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #5B2C6F"}}>
        <div style={{fontSize:11,color:"#5B2C6F",fontWeight:600,textTransform:"uppercase"}}>Total IMP</div>
        <div style={{fontSize:18,fontWeight:800,color:"#5B2C6F"}}>{fU(resumen.totalUSD)}</div>
      </div>}
      {resumen.totalCLP>0&&<div style={{padding:"10px 12px",background:"#fff",borderRadius:10,borderLeft:"3px solid #1D4E89"}}>
        <div style={{fontSize:11,color:"#1D4E89",fontWeight:600,textTransform:"uppercase"}}>Total NAC</div>
        <div style={{fontSize:18,fontWeight:800,color:"#1D4E89"}}>{fmt(resumen.totalCLP)}</div>
      </div>}
    </div>

    {/* CALENDARIO GRID */}
    <Cd s={{marginBottom:12}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:6}}>
        {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d=><div key={d} style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",textAlign:"center",padding:4}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
        {celdas.map((d,i)=>{
          if(d===null)return <div key={i} style={{minHeight:100,background:"#FAFAFA",borderRadius:6}}/>
          const ocsDia=ocsPorDia[d]||[]
          const hoyFlag=esHoy(d)
          return<div key={i} style={{minHeight:100,background:"#fff",borderRadius:6,padding:6,border:hoyFlag?"2px solid #1D4E89":"1px solid #F4F5F7",display:"flex",flexDirection:"column"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <div style={{fontSize:12,fontWeight:700,color:hoyFlag?"#1D4E89":"#1C1C1E"}}>{d}</div>
              {ocsDia.length>0&&<div style={{fontSize:10.5,fontWeight:700,padding:"1px 5px",borderRadius:8,background:"#1D4E8915",color:"#1D4E89"}}>{ocsDia.length}</div>}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:2,overflow:"hidden"}}>
              {ocsDia.slice(0,3).map(oc=>{
                const col=colorOC(oc)
                const atraso=diasAtraso(oc)
                const pv=provs.find(p=>p.id===oc.proveedor_id)
                return<div key={oc.id} onClick={()=>setDet(oc)} title={`${oc.id} · ${pv?.nombre||oc.proveedor_id}${atraso>0?` · Atrasada ${atraso}d`:""}`} style={{padding:"3px 5px",background:col.bg,color:col.c,border:`1px solid ${col.border}`,borderRadius:4,fontSize:10.5,fontWeight:700,cursor:"pointer",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:3}}>
                  {atraso>0&&<span>⚠</span>}
                  <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{oc.id.replace("OC-","")}</span>
                </div>
              })}
              {ocsDia.length>3&&<div style={{fontSize:10.5,color:"#6E6E73",textAlign:"center",fontWeight:600}}>+ {ocsDia.length-3}</div>}
            </div>
          </div>
        })}
      </div>
    </Cd>

    {/* LISTA DETALLADA DEL MES · grilla tipo Excel (18-oct-2026) */}
    <Cd>
      <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>📋 Detalle del mes ({ocsDelMes.length} OC)</div>
      <div style={{height:Math.min(560,150+ocsDelMes.length*42),minHeight:230}}>
        <DataGrid rows={ocsDelMes} getRowId={o=>o.id} onRowClick={o=>setDet(o)} title="Llegadas del mes" exportName="llegadas" emptyText="No hay OC con llegada estimada en este mes."
          rowStyle={o=>diasAtraso(o)>0?{background:"#FFF7F5"}:{}}
          columns={[
            {key:"fecha_estimada",label:"Llegada estimada",width:170,value:o=>o.fecha_estimada||"",render:o=>{const recibida=["Recibida OK","Recibida parcial","Cerrada"].includes(o.estado);const col=colorOC(o)
              if(reprog?.ocId===o.id)return <span onClick={e=>e.stopPropagation()} style={{display:"inline-flex",gap:4,alignItems:"center"}}><input type="date" defaultValue={o.fecha_estimada} id={"rp_"+o.id} style={{...css.input,padding:"2px 4px",fontSize:12,width:120,borderColor:"#B25E09"}}/><button onClick={async()=>{const v=document.getElementById("rp_"+o.id)?.value;await confirmarReprog(o.id,v)}} disabled={savingReprog===o.id} style={{padding:"2px 6px",fontSize:11,fontWeight:700,background:"#B25E09",color:"#fff",border:"none",borderRadius:5,cursor:"pointer"}}>{savingReprog===o.id?"…":"✓"}</button><button onClick={()=>setReprog(null)} style={{padding:"2px 6px",fontSize:11,background:"#F4F5F7",border:"none",borderRadius:5,cursor:"pointer"}}>✕</button></span>
              return <span style={{display:"inline-flex",gap:6,alignItems:"center"}}><b style={{color:col.c}}>{o.fecha_estimada}</b>{!recibida&&<button onClick={e=>{e.stopPropagation();setReprog({ocId:o.id,fecha:o.fecha_estimada})}} style={{fontSize:10.5,fontWeight:700,padding:"1px 6px",borderRadius:5,border:"1px solid #B25E0960",background:"#B25E0910",color:"#B25E09",cursor:"pointer"}}>Reprogramar</button>}</span>}},
            {key:"atraso",label:"Atraso (días)",width:90,align:"right",value:o=>diasAtraso(o)||0,render:o=>{const a=diasAtraso(o);return a>0?<span style={{color:"#B42318",fontWeight:700}}>{a}</span>:<span style={{color:"#D1D1D6"}}>0</span>}},
            {key:"id",label:"OC",width:140,render:o=><span style={{fontWeight:700,fontFamily:"monospace",fontSize:12}}>{o.id}</span>},
            {key:"tipo_oc",label:"Tipo",width:100},
            {key:"estado",label:"Estado",width:150,value:o=>o.estado||"",render:o=><Bd c={STS[o.estado]?.c} bg={STS[o.estado]?.bg}>{STS[o.estado]?.ic} {o.estado}</Bd>},
            {key:"proveedor",label:"Proveedor",width:170,value:o=>provs.find(p=>p.id===o.proveedor_id)?.nombre||o.proveedor_id||""},
            {key:"destino",label:"Destino",width:190,value:o=>sucursales.find(x=>x.id===o.destino_sucursal_id)?.nombre||"Sin asignar",render:o=>{const sd=sucursales.find(x=>x.id===o.destino_sucursal_id)
              if(editSuc===o.id)return <span onClick={e=>e.stopPropagation()} style={{display:"inline-flex",gap:4,alignItems:"center"}}><select defaultValue={o.destino_sucursal_id||""} id={"suc_"+o.id} style={{...css.select,padding:"2px 4px",fontSize:12,height:24,width:120}}><option value="">Sin asignar</option>{sucursales.filter(x=>x.activo!==false&&!["suc-web","suc-admin"].includes(x.id)).map(x=><option key={x.id} value={x.id}>{x.nombre}</option>)}</select><button onClick={async()=>{const v=document.getElementById("suc_"+o.id)?.value;await confirmarSucursal(o.id,v||null)}} disabled={savingSuc===o.id} style={{padding:"2px 6px",fontSize:11,fontWeight:700,background:"#1D4E89",color:"#fff",border:"none",borderRadius:5,cursor:"pointer"}}>{savingSuc===o.id?"…":"✓"}</button><button onClick={()=>setEditSuc(null)} style={{padding:"2px 6px",fontSize:11,background:"#F4F5F7",border:"none",borderRadius:5,cursor:"pointer"}}>✕</button></span>
              return <span style={{display:"inline-flex",gap:4,alignItems:"center"}}><span style={{color:sd?"#1C1C1E":"#AEAEB2"}}>{sd?.nombre||"Sin asignar"}</span><button onClick={e=>{e.stopPropagation();setEditSuc(o.id)}} title="Cambiar destino" style={{fontSize:10.5,padding:"1px 5px",borderRadius:4,border:"1px solid #1D4E8930",background:"#1D4E8910",color:"#1D4E89",cursor:"pointer"}}>✏</button></span>}},
            {key:"total_clp",label:"Total (CLP)",width:120,align:"right",value:o=>Number(o.total_clp)||0,render:o=><b>{fmt(o.total_clp||0)}</b>},
            {key:"total_usd",label:"Total USD",width:110,align:"right",value:o=>o.tipo_oc==="Importación"?(Number(o.total_usd)||0):0,render:o=>o.tipo_oc==="Importación"?fU(o.total_usd||0):<span style={{color:"#D1D1D6"}}>—</span>},
            {key:"agenda",label:"Agenda",width:130,sortable:false,filterable:false,value:()=>"",render:o=>{const recibida=["Recibida OK","Recibida parcial","Cerrada"].includes(o.estado);if(recibida||!o.fecha_estimada)return null;const pv=provs.find(p=>p.id===o.proveedor_id);const sd=sucursales.find(x=>x.id===o.destino_sucursal_id);return <a href={generarLinkCalendar(o,pv?.nombre||o.proveedor_id,sd?.nombre||"CD Maipú",usersGCal)} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{fontSize:11,fontWeight:700,color:"#1E7A44",textDecoration:"none"}}>📆 Google Calendar</a>}},
          ]}/>
      </div>
    </Cd>
  </div>
}

function ForecastView({prods,ocs,config,saveConfig}){
  // ═══════════════════════════════════════════════════════════════════
  // ⭐ FORECAST v3 — Proyección profesional de compras por categoría
  //    Ángulos: escenarios (base vs uplift) · tendencia de demanda ·
  //    urgencia de compra (cobertura vs lead time) · riesgo por quiebres ·
  //    cobertura post-compra · sobre-stock · drill-down a SKU · leyendas.
  //    compra = dDiaria×(período+fabricación+emergencia) − stock − tránsito
  // ═══════════════════════════════════════════════════════════════════
  const[uplift,setUplift]=useState(Number(config.forecast_uplift_global)||15)
  const[catUp,setCatUp]=useState(()=>{try{return JSON.parse(config.forecast_uplift_cats||"{}")}catch(e){return{}}})
  const[soloCompra,setSoloCompra]=useState(true)
  const[sortF,setSortF]=useState({k:"invEsc",dir:-1})
  const[abiertas,setAbiertas]=useState({})
  const[showLeyenda,setShowLeyenda]=useState(false)
  const[showExp,setShowExp]=useState(false)
  const[guardando,setGuardando]=useState(false)
  const[pctExpansion,setPctExpansion]=useState(Number(config.pct_expansion_nueva_suc)||30)
  const[rampUp,setRampUp]=useState(Number(config.rampup_pct)||70)

  const upliftDe=(tipo)=>catUp[tipo]!==undefined&&catUp[tipo]!==""?Number(catUp[tipo]):uplift

  // ── Motor por SKU: escenario + tendencia + urgencia + post-compra ──
  const skuF=useMemo(()=>prods.map(p=>{
    const dBase=p.vta_prom_diaria||0
    const up=upliftDe(p.tipo_producto)/100
    const dEsc=dBase*(1+up)
    const lead=(p.dias_fabricacion||30)+(p.dias_emergencia||5)
    const horizonte=(p.periodo_cubrir||90)+lead
    const stockDisp=(p.stock_actual||0)+(p.stock_transito||0)
    const compraBase=Math.max(0,Math.round(dBase*horizonte-stockDisp))
    const compraEsc=Math.max(0,Math.round(dEsc*horizonte-stockDisp))
    const cu=p.costo_unitario||0
    // Tendencia: promedio de los últimos 2 meses con dato vs los 2 anteriores
    const serie=[p.venta_mes_1,p.venta_mes_2,p.venta_mes_3,p.venta_mes_4,p.venta_mes_5,p.venta_mes_6].filter(v=>v!==undefined&&v!==null)
    const nz=serie.map((v,i)=>({v:v||0,i})).filter(x=>x.v>0)
    let tendencia=null // % variación
    if(nz.length>=3){
      const vals=serie.slice(nz[0].i) // desde el primer mes con venta
      if(vals.length>=4){
        const h=Math.floor(vals.length/2)
        const prev=vals.slice(0,vals.length-h).reduce((s,v)=>s+(v||0),0)/(vals.length-h)
        const rec=vals.slice(-h).reduce((s,v)=>s+(v||0),0)/h
        if(prev>0)tendencia=Math.round((rec/prev-1)*100)
      }
    }
    // Urgencia: cobertura actual vs lead time
    const cobDias=dBase>0?Math.round(stockDisp/dBase):(stockDisp>0?9999:0)
    let urg="OK"
    if(dBase>0&&cobDias<=lead)urg="AHORA"
    else if(dBase>0&&cobDias<=lead+30)urg="PRONTO"
    else if(cobDias>=180&&compraEsc===0&&stockDisp>0)urg="SOBRE"
    // Cobertura post-compra (escenario): a cuántos días quedo si compro lo sugerido
    const cobPost=dEsc>0?Math.round((stockDisp+compraEsc)/dEsc):9999
    return{...p,dBase,dEsc,up:up*100,lead,horizonte,stockDisp,compraBase,compraEsc,
      invBase:compraBase*cu,invEsc:compraEsc*cu,
      vtaMesBase:Math.round(dBase*30),vtaMesEsc:Math.round(dEsc*30),
      tendencia,cobDias,urg,cobPost,quiebres:p.meses_quiebre||0}
  }),[prods,uplift,catUp])

  // ── Agregación por categoría ──
  const cats=useMemo(()=>{
    const m={}
    for(const p of skuF){
      const t=p.tipo_producto||"Sin Tipo"
      if(!m[t])m[t]={tipo:t,skus:0,vtaMesBase:0,vtaMesEsc:0,stock:0,transito:0,compraBase:0,compraEsc:0,invBase:0,invEsc:0,horiz:0,urgentes:0,pronto:0,sobreInv:0,quiebres:0,tSum:0,tN:0,items:[]}
      const c=m[t]
      c.skus++;c.vtaMesBase+=p.vtaMesBase;c.vtaMesEsc+=p.vtaMesEsc
      c.stock+=p.stock_actual||0;c.transito+=p.stock_transito||0
      c.compraBase+=p.compraBase;c.compraEsc+=p.compraEsc
      c.invBase+=p.invBase;c.invEsc+=p.invEsc
      c.horiz+=p.horizonte
      if(p.urg==="AHORA")c.urgentes++
      if(p.urg==="PRONTO")c.pronto++
      if(p.urg==="SOBRE")c.sobreInv+=(p.stock_actual||0)*(p.costo_unitario||0)
      if(p.quiebres>0)c.quiebres++
      if(p.tendencia!==null){c.tSum+=p.tendencia;c.tN++}
      c.items.push(p)
    }
    return Object.values(m).map(c=>{
      const topInv=Math.max(...c.items.map(p=>p.invEsc),0)
      return{...c,
        horizProm:Math.round(c.horiz/Math.max(1,c.skus)),
        cobDias:c.vtaMesBase>0?Math.round((c.stock+c.transito)/(c.vtaMesBase/30)):9999,
        tendencia:c.tN>0?Math.round(c.tSum/c.tN):null,
        concentracion:c.invEsc>0?Math.round(topInv/c.invEsc*100):0,
        up:upliftDe(c.tipo)}})
  },[skuF,uplift,catUp])

  const sval=(c,k)=>typeof c[k]==="number"?c[k]:String(c[k]??"")
  const catsSorted=[...cats].filter(c=>!soloCompra||c.compraEsc>0).sort((a,b)=>{const x=sval(a,sortF.k),y=sval(b,sortF.k);return(typeof x==="number"?x-y:String(x).localeCompare(String(y),"es"))*sortF.dir})
  const T=cats.reduce((s,c)=>({vB:s.vB+c.vtaMesBase,vE:s.vE+c.vtaMesEsc,cB:s.cB+c.compraBase,cE:s.cE+c.compraEsc,iB:s.iB+c.invBase,iE:s.iE+c.invEsc,urg:s.urg+c.urgentes,pr:s.pr+c.pronto,sob:s.sob+c.sobreInv}),{vB:0,vE:0,cB:0,cE:0,iB:0,iE:0,urg:0,pr:0,sob:0})

  const saveParams=async()=>{
    setGuardando(true)
    try{
      const r1=await saveConfig("forecast_uplift_global",String(uplift))
      const r2=await saveConfig("forecast_uplift_cats",JSON.stringify(catUp))
      if(r1?.error||r2?.error)alert("⚠ Error guardando: "+(r1?.error?.message||r2?.error?.message))
      else alert("✓ Parámetros de escenario guardados")
    }finally{setGuardando(false)}
  }

  // ── Reporte de compras (Excel, 3 hojas enriquecidas) ──
  const exportarReporte=()=>{
    try{
      const wsResumen=XLSX.utils.json_to_sheet([...cats].sort((a,b)=>b.invEsc-a.invEsc).map(c=>({
        Categoria:c.tipo,SKUs:c.skus,Uplift_pct:c.up,
        Tendencia_pct:c.tendencia??"",SKUs_comprar_AHORA:c.urgentes,SKUs_prox_30d:c.pronto,
        SKUs_con_quiebres:c.quiebres,
        Venta_mes_base:c.vtaMesBase,Venta_mes_escenario:c.vtaMesEsc,
        Stock:c.stock,Transito:c.transito,Cobertura_dias:c.cobDias>=9999?"":c.cobDias,
        Compra_base_uds:c.compraBase,Compra_escenario_uds:c.compraEsc,
        Inversion_base_CLP:c.invBase,Inversion_escenario_CLP:c.invEsc,Delta_CLP:c.invEsc-c.invBase,
        Capital_sobrestock_CLP:c.sobreInv,Concentracion_top_SKU_pct:c.concentracion})))
      const wsDetalle=XLSX.utils.json_to_sheet(skuF.filter(p=>p.compraBase>0||p.compraEsc>0||p.urg==="AHORA").sort((a,b)=>(a.urg==="AHORA"?0:1)-(b.urg==="AHORA"?0:1)||b.invEsc-a.invEsc).map(p=>({
        Urgencia:p.urg,SKU:p.sku,Producto:p.producto,Categoria:p.tipo_producto,ABCD:p.clasif_abcd,
        Tendencia_pct:p.tendencia??"",Meses_con_quiebre:p.quiebres,
        Vta_prom_mes:p.vta_prom_compensada||0,Uplift_pct:Math.round(p.up),
        Stock:p.stock_actual||0,Transito:p.stock_transito||0,Cobertura_dias:p.cobDias>=9999?"":p.cobDias,
        Lead_time_dias:p.lead,Horizonte_dias:p.horizonte,
        Compra_base_uds:p.compraBase,Compra_escenario_uds:p.compraEsc,
        Cobertura_post_compra_dias:p.cobPost>=9999?"":p.cobPost,
        Costo_unit_CLP:p.costo_unitario||0,Inversion_escenario_CLP:p.invEsc})))
      const wsParams=XLSX.utils.json_to_sheet([
        {Parametro:"Uplift global (%)",Valor:uplift},
        ...Object.entries(catUp).filter(([k,v])=>v!==""&&v!==undefined).map(([k,v])=>({Parametro:`Uplift ${k} (%)`,Valor:Number(v)})),
        {Parametro:"Fórmula compra",Valor:"dDiaria×(período+fabricación+emergencia) − stock − tránsito"},
        {Parametro:"Demanda base",Valor:"Venta promedio mensual compensada (excluye meses de quiebre)"},
        {Parametro:"Urgencia AHORA",Valor:"Cobertura ≤ lead time (fabricación+emergencia): quiebre antes de que llegue la próxima compra"},
        {Parametro:"Tendencia",Valor:"Promedio de meses recientes vs anteriores de la ventana (mín. 4 meses con historia)"},
        {Parametro:"Generado",Valor:`${hoy()} ${hora()}`}])
      const wb=XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb,wsResumen,"Resumen por categoria")
      XLSX.utils.book_append_sheet(wb,wsDetalle,"Detalle SKU")
      XLSX.utils.book_append_sheet(wb,wsParams,"Parametros")
      XLSX.writeFile(wb,`Reporte_Compras_Forecast_${hoy()}.xlsx`)
    }catch(e){alert("Error exportando: "+(e?.message||e))}
  }

  const Tend=({v})=>v===null?<span style={{color:"#C7C7CC"}}>—</span>:<span style={{fontWeight:700,color:v>10?"#1E7A44":v<-10?"#B42318":"#6E6E73"}}>{v>10?"📈":v<-10?"📉":"→"} {v>0?"+":""}{v}%</span>
  const UrgBadge=({u})=>{const m={AHORA:["#B42318","COMPRAR AHORA"],PRONTO:["#B25E09","PRÓX. 30 DÍAS"],OK:["#1E7A44","OK"],SOBRE:["#223058","SOBRE-STOCK"]};const[c,l]=m[u]||m.OK;return<span style={{fontSize:10.5,fontWeight:800,color:c,background:c+"15",border:`1px solid ${c}40`,padding:"2px 6px",borderRadius:6,whiteSpace:"nowrap"}}>{l}</span>}

  const FCOLS=[
    {k:"tipo",l:"Categoría",a:"left",t:"Tipo de producto. Click en la fila para abrir el detalle por SKU."},
    {k:"skus",l:"SKUs",a:"right",t:"Cantidad de productos de la categoría"},
    {k:"up",l:"Uplift %",a:"center",t:"Aumento de venta del escenario. Editable: pisa el global solo para esta categoría"},
    {k:"tendencia",l:"Tend.",a:"center",t:"Tendencia de demanda: meses recientes vs anteriores. 📈 crece >10% · 📉 cae >10% · → estable"},
    {k:"urgentes",l:"🔴 Ya",a:"right",t:"SKUs cuya cobertura es menor al lead time: se quiebran antes de que llegue una compra hecha hoy"},
    {k:"vtaMesBase",l:"Vta/mes base",a:"right",t:"Venta mensual proyectada con demanda actual (promedio compensado × 30)"},
    {k:"vtaMesEsc",l:"Vta/mes esc.",a:"right",t:"Venta mensual del escenario (base × (1+uplift))"},
    {k:"stock",l:"Stock",a:"right",t:"Stock actual consolidado"},
    {k:"transito",l:"Tráns.",a:"right",t:"Unidades en OC activas por llegar"},
    {k:"cobDias",l:"Cob. (d)",a:"right",t:"Días de cobertura: (stock+tránsito) ÷ venta diaria. ⚠ <30 días"},
    {k:"compraBase",l:"Compra base",a:"right",t:"Unidades a comprar con demanda actual"},
    {k:"compraEsc",l:"Compra esc.",a:"right",t:"Unidades a comprar en el escenario"},
    {k:"invEsc",l:"Inv. escenario",a:"right",t:"Inversión del escenario a costo unitario actual"},
    {k:"delta",l:"Δ inv.",a:"right",t:"Inversión adicional que exige el escenario vs base"}
  ]

  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10,marginBottom:14}}>
      <div>
        <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Forecast de compras</div>
        <div style={{fontSize:12,color:"#6E6E73",marginTop:2}}>Proyección por categoría con drill-down a producto · escenario base (venta actual) vs escenario con aumento proyectado</div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <Bt sm v="gry" onClick={()=>setShowLeyenda(v=>!v)} ic="📖">{showLeyenda?"Ocultar leyenda":"Cómo leer este forecast"}</Bt>
        <Bt sm v="gry" onClick={saveParams} dis={guardando} ic="💾">{guardando?"Guardando…":"Guardar escenario"}</Bt>
        <Bt sm v="pri" onClick={exportarReporte} ic="📊">Reporte de compras</Bt>
      </div>
    </div>

    {/* ── Leyenda explicativa ── */}
    {showLeyenda&&<div style={{background:"#FFFDF5",border:"1px solid #FFD60A50",borderRadius:12,padding:"14px 18px",marginBottom:14,fontSize:12,color:"#3A3A3C",lineHeight:1.55}}>
      <div style={{fontWeight:800,marginBottom:8,color:"#1C1C1E"}}>📖 Cómo leer este forecast</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:"6px 24px"}}>
        <div><b>Demanda base</b> — venta promedio mensual <i>compensada</i>: excluye los meses de quiebre (stock 0) para no subestimar la demanda real.</div>
        <div><b>Escenario</b> — proyección con el % de aumento de venta que definas (global o por categoría). Compara ambas columnas para dimensionar la inversión extra.</div>
        <div><b>Fórmula de compra</b> — demanda diaria × (período de cobertura + días de fabricación + días de emergencia) − stock − tránsito. Los parámetros salen de Config por tipo y ABCD.</div>
        <div><b>🔴 Comprar AHORA</b> — la cobertura es menor al lead time: aunque compres hoy, el producto se quiebra antes de que llegue. Es la lista de acción inmediata.</div>
        <div><b>🟠 Próx. 30 días</b> — cobertura entre lead time y lead time+30: entra a la próxima ronda de compras.</div>
        <div><b>Tendencia</b> — compara los meses recientes contra los anteriores de la ventana: 📈 crece &gt;10%, 📉 cae &gt;10%, → estable. Con tendencia 📈 considerá un uplift mayor; con 📉, revisa antes de comprar.</div>
        <div><b>⚡ Quiebres</b> — meses de la ventana en que el SKU estuvo quebrado: el promedio puede subestimar la demanda real (la venta perdida no se registra).</div>
        <div><b>Cob. post-compra</b> — días de cobertura si ejecutás la compra del escenario: valida que la compra alcanza el horizonte objetivo.</div>
        <div><b>🟣 Sobre-stock</b> — cobertura ≥180 días sin necesidad de compra: capital inmovilizado; candidato a promoción o redistribución, no a compra.</div>
        <div><b>Concentración</b> — % de la inversión de la categoría que se lleva su SKU principal: alta concentración = riesgo de depender de un solo producto.</div>
      </div>
    </div>}

    {/* ── Control de escenario ── */}
    <div style={{background:"#F0F9FF",border:"1px solid #1D4E8930",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
      <div style={{fontSize:13,fontWeight:700,color:"#1D4E89"}}>🎯 Escenario hipotético</div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:12,color:"#3A3A3C"}}>Aumento de venta proyectado:</span>
        <input type="range" min={0} max={100} step={5} value={uplift} onChange={e=>setUplift(Number(e.target.value))} style={{width:180}}/>
        <NumInput value={uplift} onChange={setUplift} step={5} min={0} suffix="%" style={{width:80}}/>
      </div>
      <div style={{fontSize:12,color:"#6E6E73"}}>Editable por categoría en la columna "Uplift %"</div>
      <label style={{fontSize:12,color:"#3A3A3C",display:"flex",alignItems:"center",gap:4,marginLeft:"auto"}}><input type="checkbox" checked={soloCompra} onChange={e=>setSoloCompra(e.target.checked)}/>Solo categorías con compra</label>
    </div>

    {/* ── KPIs: inversión + ángulos de análisis ── */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:8}}>
      <Mt l="Inversión BASE (venta actual)" v={fmt(T.iB)} ic="🧾"/>
      <Mt l={`Inversión ESCENARIO (+${uplift}%)`} v={fmt(T.iE)} ic="🎯" c="#1D4E89"/>
      <Mt l="Δ inversión del escenario" v={fmt(T.iE-T.iB)} ic="📈" c={T.iE-T.iB>0?"#B25E09":"#1E7A44"}/>
      <Mt l="Unidades base → escenario" v={`${fN(T.cB)} → ${fN(T.cE)}`} ic="📦"/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:14}}>
      <Mt l="SKUs para comprar AHORA" v={fN(T.urg)} ic="🔴" c={T.urg>0?"#B42318":"#1E7A44"}/>
      <Mt l="SKUs próximos 30 días" v={fN(T.pr)} ic="🟠" c={T.pr>0?"#B25E09":"#1E7A44"}/>
      <Mt l="Capital en sobre-stock" v={fmt(T.sob)} ic="🟣" c="#223058"/>
      <Mt l="Categorías en tendencia 📈" v={fN(cats.filter(c=>c.tendencia!==null&&c.tendencia>10).length)} ic="📈" c="#1E7A44"/>
    </div>

    {/* ── Tabla por categoría con drill-down ── */}
    <div style={{background:"#fff",borderRadius:12,border:"1px solid #E5E7EB",overflow:"hidden",marginBottom:14}}>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:1300}}>
          <thead><tr style={{background:"#F4F5F7"}}>
            <th style={{width:26,borderBottom:"2px solid #E5E7EB"}}></th>
            {FCOLS.map(c=><th key={c.k} title={c.t} onClick={()=>setSortF(s=>({k:c.k==="delta"?"invEsc":c.k,dir:s.k===(c.k==="delta"?"invEsc":c.k)?-s.dir:-1}))} style={{padding:"8px 9px",textAlign:c.a,fontSize:11,fontWeight:700,color:sortF.k===c.k?"#1D4E89":"#6E6E73",borderBottom:"2px solid #E5E7EB",whiteSpace:"nowrap",cursor:"pointer",userSelect:"none"}}>{c.l}{sortF.k===c.k?(sortF.dir>0?" ↑":" ↓"):""}</th>)}
          </tr></thead>
          {catsSorted.map((c,i)=>{
            const delta=c.invEsc-c.invBase
            const critico=c.cobDias<30&&c.vtaMesBase>0
            const abierta=!!abiertas[c.tipo]
            const skusCat=[...c.items].sort((a,b)=>({AHORA:0,PRONTO:1,OK:2,SOBRE:3}[a.urg]-{AHORA:0,PRONTO:1,OK:2,SOBRE:3}[b.urg])||b.invEsc-a.invEsc)
            return<tbody key={c.tipo}>
              <tr onClick={()=>setAbiertas(p=>({...p,[c.tipo]:!p[c.tipo]}))} style={{borderBottom:"1px solid #F4F5F7",background:abierta?"#F0F9FF":critico?"#FFF8F0":i%2===0?"#fff":"#FAFAFA",cursor:"pointer"}}>
                <td style={{padding:"7px 4px 7px 10px",color:"#1D4E89",fontWeight:700}}>{abierta?"▼":"▶"}</td>
                <td style={{padding:"7px 9px",fontWeight:700,whiteSpace:"nowrap"}}>{critico?"⚠ ":""}{c.tipo}</td>
                <td style={{padding:"7px 9px",textAlign:"right"}}>{c.skus}</td>
                <td style={{padding:"7px 9px",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
                  <input type="number" value={catUp[c.tipo]??""} placeholder={String(uplift)} onChange={e=>setCatUp(p=>({...p,[c.tipo]:e.target.value}))} style={{width:52,textAlign:"center",padding:"3px 4px",borderRadius:6,border:catUp[c.tipo]!==undefined&&catUp[c.tipo]!==""?"2px solid #1D4E89":"1px solid #E5E7EB",fontSize:12,fontWeight:600}}/>
                </td>
                <td style={{padding:"7px 9px",textAlign:"center"}}><Tend v={c.tendencia}/></td>
                <td style={{padding:"7px 9px",textAlign:"right",fontWeight:700,color:c.urgentes>0?"#B42318":"#C7C7CC"}}>{c.urgentes||"—"}</td>
                <td style={{padding:"7px 9px",textAlign:"right"}}>{fN(c.vtaMesBase)}</td>
                <td style={{padding:"7px 9px",textAlign:"right",fontWeight:600,color:"#1D4E89"}}>{fN(c.vtaMesEsc)}</td>
                <td style={{padding:"7px 9px",textAlign:"right"}}>{fN(c.stock)}</td>
                <td style={{padding:"7px 9px",textAlign:"right",color:"#6E6E73"}}>{c.transito>0?fN(c.transito):"—"}</td>
                <td style={{padding:"7px 9px",textAlign:"right",fontWeight:600,color:critico?"#B25E09":c.cobDias>=180&&c.cobDias<9999?"#223058":"#3A3A3C"}}>{c.cobDias>=9999?"—":c.cobDias}</td>
                <td style={{padding:"7px 9px",textAlign:"right"}}>{c.compraBase>0?fN(c.compraBase):"—"}</td>
                <td style={{padding:"7px 9px",textAlign:"right",fontWeight:700,color:"#1D4E89"}}>{c.compraEsc>0?fN(c.compraEsc):"—"}</td>
                <td style={{padding:"7px 9px",textAlign:"right",fontWeight:700,color:"#1D4E89"}}>{c.invEsc>0?fmt(c.invEsc):"—"}</td>
                <td style={{padding:"7px 9px",textAlign:"right",fontWeight:600,color:delta>0?"#B25E09":"#6E6E73"}}>{delta!==0?fmt(delta):"—"}</td>
              </tr>
              {abierta&&<tr><td colSpan={FCOLS.length+1} style={{padding:0,background:"#FBFDFF",borderBottom:"2px solid #1D4E8925"}}>
                <div style={{padding:"10px 14px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#3A3A3C"}}>Detalle por producto — {c.tipo} ({skusCat.length} SKUs, ordenados por urgencia e inversión)</div>
                    <div style={{fontSize:11.5,color:"#6E6E73"}}>Concentración: el SKU principal es el {c.concentracion}% de la inversión de la categoría · {c.quiebres} SKU(s) con quiebres en la ventana</div>
                  </div>
                  <div style={{maxHeight:340,overflowY:"auto",border:"1px solid #E8E8ED",borderRadius:8}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead><tr style={{background:"#F7F8FA",position:"sticky",top:0}}>
                        {["Urgencia","SKU","Producto","ABCD","Tend.","⚡","Vta/mes base→esc","Stock","Tráns.","Cob. (d)","Compra base→esc","Cob. post","CU","Inv. escenario"].map((h,j)=><th key={j} style={{padding:"6px 8px",textAlign:j<=2?"left":"right",fontSize:10.5,fontWeight:700,color:"#6E6E73",whiteSpace:"nowrap",borderBottom:"1px solid #E8E8ED"}}>{h}</th>)}
                      </tr></thead>
                      <tbody>{skusCat.map((p,j)=><tr key={p.sku} style={{borderBottom:"1px solid #F4F5F7",background:p.urg==="AHORA"?"#FFF5F5":j%2===0?"#fff":"#FAFAFA"}}>
                        <td style={{padding:"5px 8px"}}><UrgBadge u={p.urg}/></td>
                        <td style={{padding:"5px 8px",color:"#6E6E73",fontSize:11,whiteSpace:"nowrap"}}>{String(p.sku).slice(0,16)}</td>
                        <td style={{padding:"5px 8px",fontWeight:600,maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={p.producto}>{p.producto}</td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}><Bd t={p.clasif_abcd} c={CL[p.clasif_abcd]}/></td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}><Tend v={p.tendencia}/></td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:p.quiebres>0?"#B25E09":"#C7C7CC",fontWeight:700}} title={p.quiebres>0?`${p.quiebres} mes(es) con quiebre: el promedio puede subestimar la demanda`:""}>{p.quiebres||"—"}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",whiteSpace:"nowrap"}}>{fN(p.vtaMesBase)} → <b style={{color:"#1D4E89"}}>{fN(p.vtaMesEsc)}</b></td>
                        <td style={{padding:"5px 8px",textAlign:"right"}}>{fN(p.stock_actual||0)}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:"#6E6E73"}}>{p.stock_transito>0?fN(p.stock_transito):"—"}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",fontWeight:600,color:p.urg==="AHORA"?"#B42318":p.urg==="PRONTO"?"#B25E09":p.urg==="SOBRE"?"#223058":"#3A3A3C"}}>{p.cobDias>=9999?"—":p.cobDias}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",whiteSpace:"nowrap"}}>{p.compraBase>0||p.compraEsc>0?<>{fN(p.compraBase)} → <b style={{color:"#1D4E89"}}>{fN(p.compraEsc)}</b></>:"—"}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:"#6E6E73"}} title="Días de cobertura si se ejecuta la compra del escenario">{p.compraEsc>0&&p.cobPost<9999?p.cobPost:"—"}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",color:"#6E6E73"}}>{p.costo_unitario?fmt(p.costo_unitario):"—"}</td>
                        <td style={{padding:"5px 8px",textAlign:"right",fontWeight:700,color:p.invEsc>0?"#1D4E89":"#C7C7CC"}}>{p.invEsc>0?fmt(p.invEsc):"—"}</td>
                      </tr>)}</tbody>
                    </table>
                  </div>
                </div>
              </td></tr>}
            </tbody>
          })}
          <tfoot><tr style={{background:"#1a1a2e"}}>
            <td colSpan={11} style={{padding:"8px 10px",color:"#fff",fontWeight:700,fontSize:12}}>TOTAL ({cats.filter(c=>c.compraEsc>0).length} categorías con compra · 🔴 {T.urg} SKUs urgentes · 🟠 {T.pr} próximos)</td>
            <td style={{padding:"8px 10px",textAlign:"right",color:"#fff",fontWeight:700}}>{fN(T.cB)}</td>
            <td style={{padding:"8px 10px",textAlign:"right",color:"#7CC4FF",fontWeight:700}}>{fN(T.cE)}</td>
            <td style={{padding:"8px 10px",textAlign:"right",color:"#7CC4FF",fontWeight:700}}>{fmt(T.iE)}</td>
            <td style={{padding:"8px 10px",textAlign:"right",color:"#FFB84D",fontWeight:700}}>{fmt(T.iE-T.iB)}</td>
          </tr></tfoot>
        </table>
      </div>
      <div style={{padding:"8px 14px",borderTop:"1px solid #F4F5F7",fontSize:11.5,color:"#6E6E73"}}>
        Fórmula: compra = demanda diaria × (período + fabricación + emergencia) − stock − tránsito · Demanda = cálculo v2.1 (mezcla la venta reciente con el promedio desde la apertura de cada sucursal, corregida por quiebres) · Click en una categoría para abrir el detalle por producto · Pasa el mouse por los títulos de columna para ver su definición
      </div>
    </div>

    {/* ── Expansión nueva sucursal (v1, preservado) ── */}
    <div style={{background:"#fff",borderRadius:12,border:"1px solid #E5E7EB",padding:"12px 16px"}}>
      <div onClick={()=>setShowExp(v=>!v)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
        <div style={{fontSize:13,fontWeight:700,color:"#1C1C1E"}}>🏪 Proyección por expansión de nueva sucursal</div>
        <span style={{fontSize:12,color:"#6E6E73"}}>{showExp?"▲ ocultar":"▼ mostrar"}</span>
      </div>
      {showExp&&(()=>{
        const stockExpTotal=prods.reduce((s,p)=>s+Math.round(Math.round((p.stock_actual||0)*pctExpansion/100)*rampUp/100),0)
        const invExpTotal=prods.reduce((s,p)=>s+Math.round(Math.round((p.stock_actual||0)*pctExpansion/100)*rampUp/100)*(p.costo_unitario||0),0)
        return<div style={{marginTop:12}}>
          <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:12}}>% del stock actual:</span><NumInput value={pctExpansion} onChange={setPctExpansion} step={5} min={0} suffix="%" style={{width:76}}/></div>
            <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:12}}>Ramp-up apertura:</span><NumInput value={rampUp} onChange={setRampUp} step={5} min={0} suffix="%" style={{width:76}}/></div>
            <div style={{fontSize:12,color:"#3A3A3C"}}>Stock inicial sugerido: <b>{fN(stockExpTotal)} uds</b> · Inversión: <b>{fmt(invExpTotal)}</b></div>
          </div>
          <div style={{fontSize:12,color:"#6E6E73"}}>Estimación simple: % del stock consolidado con factor de ramp-up. Para la dotación fina por SKU de la Tienda Maipú, usa la vista Reposición → pestaña de la sucursal con su demanda local real.</div>
        </div>
      })()}
    </div>
  </div>
}


function NumInput({value,onChange,step=1,min=0,style={},suffix="",prefix=""}){
  const[local,setLocal]=useState(String(value??0))
  useEffect(()=>{setLocal(String(value??0))},[value])
  return<div style={{display:"inline-flex",alignItems:"center",gap:3,...style}}>
    {prefix&&<span style={{fontSize:11,color:"#6E6E73"}}>{prefix}</span>}
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
    {suffix&&<span style={{fontSize:11,color:"#6E6E73"}}>{suffix}</span>}
  </div>
}

/* 19-oct-2026: cómo se forma el costo de importación (misma lógica del costeo; solo lo muestra paso a paso y valida coherencia) */
function CosteoCascada({fob,flete,cfr,seguro,cif,puerto,arancel,tieneTLC,agente,otros,gastosCL,total,iva,desembolso,cantidad,tc,contenedores,toCLP}){
  const pct=v=>fob>0?`${(v/fob*100).toLocaleString("es-CL",{maximumFractionDigits:1})}%`:"—"
  const pu=v=>cantidad>0?"USD "+(v/cantidad).toLocaleString("es-CL",{minimumFractionDigits:2,maximumFractionDigits:2}):"—"
  const filas=[
    {t:"FOB origen",d:"Valor de la mercadería en el puerto de origen",v:fob,tipo:"base"},
    {t:"+ Flete marítimo",d:contenedores?`${contenedores} contenedor(es) · ${fU(contenedores?flete/contenedores:0)} por contenedor`:"",v:flete},
    {t:"= CFR",d:"FOB + flete",v:cfr,tipo:"sub"},
    {t:"+ Seguro",d:"",v:seguro},
    {t:"= CIF",d:"Valor en puerto de destino; base del arancel y del IVA",v:cif,tipo:"sub"},
    {t:"+ Gastos en puerto",d:"Desconsolidación, almacenaje, EDI, flete interno y descargadores",v:puerto},
    {t:"+ Arancel (ad valorem)",d:tieneTLC?"0%: con TLC vigente":"Sobre el CIF",v:arancel},
    {t:"+ Agente de aduana",d:"",v:agente},
    {t:"+ Otros gastos",d:"",v:otros},
    {t:"= Total importación (costeable)",d:"Lo que entra al costo de los productos",v:total,tipo:"total"},
  ]
  const factor=fob>0?total/fob:0
  const alertas=[]
  if(cantidad<=0)alertas.push("No hay unidades en el costeo: el costo por unidad no se puede calcular.")
  if(fob>0&&flete>fob)alertas.push(`El flete (${fU(flete)}) es ${(flete/fob).toLocaleString("es-CL",{maximumFractionDigits:1})} veces el valor de la mercadería: revisa las cantidades, el costo unitario o el número de contenedores.`)
  if(factor>3)alertas.push(`El costo aterrizado es ${factor.toLocaleString("es-CL",{maximumFractionDigits:1})} veces el FOB: revisa los gastos antes de usar este costeo.`)
  if(tc&&(tc<600||tc>1400))alertas.push(`El tipo de cambio (${tc}) está fuera de un rango habitual: confirma el valor.`)
  const max=Math.max(1,...filas.map(f=>Math.abs(f.v||0)))
  return <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:10,padding:"14px 16px",marginBottom:12}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"baseline",marginBottom:8}}>
      <div><div style={{fontSize:15,fontWeight:800,color:"#16213E"}}>Cómo se forma el costo de importación</div>
        <div style={{fontSize:12,color:"#6E6E73"}}>Cada paso suma al anterior. USD y su equivalente en pesos al tipo de cambio {tc}. El IVA de internación se paga pero es crédito fiscal: no entra al costo.</div></div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {[["Factor de internación",factor?`${factor.toLocaleString("es-CL",{maximumFractionDigits:2})}× el FOB`:"—"],["Costo aterrizado por unidad",cantidad>0?`${pu(total)} · ${fmt(toCLP(total/cantidad))}`:"—"],["Unidades",fN(cantidad)]].map(([l,v])=><div key={l} style={{border:"1px solid #E5E7EB",borderRadius:8,padding:"6px 10px"}}><div style={{fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>{l}</div><div style={{fontSize:14,fontWeight:800,color:"#16213E"}}>{v}</div></div>)}
      </div>
    </div>
    {alertas.length>0&&<div style={{background:"#FFFAEB",border:"1px solid #F5C77E",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12.5,color:"#92400E"}}>{alertas.map((a,i)=><div key={i}>⚠ {a}</div>)}</div>}
    <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
      <thead><tr style={{color:"#6E6E73",fontSize:11.5,textAlign:"right"}}><th style={{textAlign:"left",padding:"5px 6px"}}>Concepto</th><th style={{textAlign:"left",width:"26%"}}></th><th>USD</th><th>CLP</th><th>% del FOB</th><th style={{paddingRight:6}}>Por unidad (USD)</th></tr></thead>
      <tbody>{filas.map(f=>{const esSub=f.tipo==="sub"||f.tipo==="total";return <tr key={f.t} style={{borderTop:"1px solid #F1F2F4",background:f.tipo==="total"?"#16213E":esSub?"#F8FAFC":"transparent",color:f.tipo==="total"?"#fff":"#1C1C1E"}}>
        <td style={{padding:"6px 6px",fontWeight:esSub||f.tipo==="base"?800:600}}>{f.t}{f.d&&<div style={{fontSize:11,fontWeight:400,color:f.tipo==="total"?"rgba(255,255,255,.7)":"#6E6E73"}}>{f.d}</div>}</td>
        <td><div style={{height:10,borderRadius:3,width:`${Math.max(1,Math.abs(f.v||0)/max*100)}%`,background:f.tipo==="total"?"#9FB3D9":esSub?"#16213E":"#B25E09",opacity:esSub?.55:.8}}/></td>
        <td style={{textAlign:"right",fontWeight:700}}>{fU(f.v||0)}</td>
        <td style={{textAlign:"right"}}>{fmt(toCLP(f.v||0))}</td>
        <td style={{textAlign:"right"}}>{pct(f.v||0)}</td>
        <td style={{textAlign:"right",paddingRight:6}}>{pu(f.v||0)}</td>
      </tr>})}
      <tr style={{borderTop:"1px solid #F1F2F4",color:"#6E6E73"}}><td style={{padding:"6px 6px"}}>Informativo: IVA de internación<div style={{fontSize:11}}>Crédito fiscal recuperable en el F29</div></td><td/><td style={{textAlign:"right"}}>{fU(iva||0)}</td><td style={{textAlign:"right"}}>{fmt(toCLP(iva||0))}</td><td/><td/></tr>
      <tr style={{color:"#6E6E73"}}><td style={{padding:"6px 6px"}}>Informativo: desembolso total de la internación<div style={{fontSize:11}}>Total importación + IVA (flujo de caja)</div></td><td/><td style={{textAlign:"right",fontWeight:700}}>{fU(desembolso||0)}</td><td style={{textAlign:"right",fontWeight:700}}>{fmt(toCLP(desembolso||0))}</td><td/><td/></tr>
      </tbody></table></div>
  </div>
}

/* 19-oct-2026: ayuda contextual. Al pasar el mouse sobre un dato aparece qué significa y cómo se calcula.
   Busca el encabezado de la columna (en tablas) o la etiqueta del indicador; respeta los títulos propios de cada elemento. */
const GLOSARIO={
  "Producto":"Nombre del producto en BSALE. Debajo, su SKU.","SKU":"Código del producto en BSALE.","Tipo":"Categoría del producto en BSALE.","Categoría":"Tipo de producto en BSALE.",
  "Clasif.":"Clasificación ABCD por venta de 12 meses: A = productos que hacen el 80% de la venta; B = el siguiente 15%; C = el siguiente 4%; D = el resto.","ABCD":"Clasificación por venta de 12 meses: A = 80% de la venta; B = siguiente 15%; C = siguiente 4%; D = el resto.","Clase":"Clasificación ABCD por venta de 12 meses.",
  "Estado":"Reposición = hay que comprar; Stock suficiente = no por ahora; Inactivo = sin stock ni venta en 6 meses; Sin venta reciente = vendió en el año pero no en 6 meses; Servicio = no es mercadería.",
  "En curso":"Unidades vendidas en lo que va del mes (no entra al promedio).","Vta Total":"Unidades vendidas en los últimos 12 meses, netas de devoluciones y con kits repartidos en sus unidades.","Venta 12 meses":"Unidades vendidas en los últimos 12 meses, netas de devoluciones.",
  "Desv.":"Desviaciones: ✕ = meses que no entran al promedio (quiebre o venta atípica); ↺ = meses compensados por quiebre. El detalle está en ⓘ.","Desviaciones":"Meses que no entran al promedio (quiebre o atípico) y meses compensados por quiebre.",
  "Vta/Mes":"Venta promedio mensual usada en el cálculo (venta diaria × 30).","Vta Comp.":"Venta promedio mensual compensada por quiebres.","Vta/Día":"Venta promedio diaria: promedio de los meses válidos × (1 + estimación de la categoría).",
  "Stock":"Stock disponible hoy en todas las bodegas (última foto de BSALE).","Tráns.":"Unidades en OC en camino (pedidas y aún no recibidas).","Tránsito":"Unidades en OC en camino (pedidas y aún no recibidas).",
  "Cob.":"Días de cobertura: stock ÷ venta diaria. Rojo bajo 15 días en clases A y B; ámbar bajo 30.","Cobertura":"Días de venta que cubre el stock, o días que se compran cada vez según la categoría.",
  "Pto Re.":"Punto de reorden = venta diaria × (lead time del proveedor + días de seguridad de la clase). Al llegar aquí hay que pedir.","Punto de reorden":"Venta diaria × (lead time del proveedor + días de seguridad de la clase).",
  "Stock obj.":"Stock objetivo = venta diaria × (lead time + seguridad + cobertura de la categoría). Se compra hasta este nivel.","Stock objetivo":"Venta diaria × (lead time + seguridad + cobertura de la categoría).",
  "Reponer":"Cantidad a comprar = stock objetivo − (stock + tránsito), cuando la posición llega al punto de reorden.","Cálculo":"Abre el cálculo completo del producto: 12 meses, meses excluidos, ecuaciones y resultado.",
  "Costo U.":"Costo unitario: costo de inventario de BSALE (o el último costo conocido).","Costo unitario":"Costo de inventario de BSALE (o el último conocido).","Inversión":"Reponer × costo unitario.",
  "Proveedor":"Proveedor asociado al producto; define el lead time. Se asigna en Configuración › Política de compra.","Urgencia":"Pedir hoy = la posición ya llegó al punto de reorden; esta semana o este mes = cuándo llegará.","Fecha de pedido":"Día en que la posición llegará al punto de reorden.","Fecha de quiebre":"Día en que se acabaría el stock al ritmo de venta actual.",
  "Stock seg.":"Stock de seguridad = venta diaria × días de seguridad de la clase ABCD.","Stock de seguridad":"Venta diaria × días de seguridad de la clase ABCD.","Lead time":"Días desde que se aprueba la OC hasta que llega la mercadería (fabricación + despacho).",
  "Salud":"Puntaje de 0 a 100 del abastecimiento: combina quiebres, cobertura, OC atrasadas y datos incompletos.","Quiebre real":"Porcentaje de productos con venta que hoy no tienen stock.","SKUs a reponer":"Productos que llegaron a su punto de reorden.","Inversión sugerida":"Monto de la compra sugerida (reponer × costo).","Críticos A y B":"Productos A y B con menos de 15 días de cobertura.","Sin rotación":"Capital en productos sin venta en el período.","OC por aprobar":"Órdenes esperando la firma de Dir. Negocios o Dir. Finanzas.","OC en tránsito":"Órdenes aprobadas que aún no se reciben completas.","Sin cuadrar":"Recepciones con diferencias entre lo pedido y lo recibido.","Pedir hoy":"Productos cuya posición ya llegó al punto de reorden.","Quiebres en 30 días":"Productos que se quedarían sin stock en los próximos 30 días.","Productos sin proveedor":"Productos activos sin proveedor asociado: usan un lead time por defecto.",
  "FOB origen":"Valor de la mercadería en el puerto de origen (cantidad × costo unitario).","CIF":"FOB + flete + seguro: valor de la mercadería en el puerto de destino.","Gastos en CL":"Gastos en Chile que entran al costo: puerto, arancel, agente y otros. Sin IVA.","Total importación":"CIF + gastos en Chile: lo que entra al costo de los productos.","Margen bruto":"(Venta − costo aterrizado) ÷ venta, con los precios de venta de los productos.",
  "Factor de internación":"Total importación ÷ FOB: cuántas veces el valor de origen cuesta tener la mercadería en bodega.","Costo aterrizado por unidad":"Total importación ÷ unidades.","Tipo de cambio":"Pesos por dólar usados para convertir el costeo.",
  "Total CLP":"Total de la OC en pesos, con IVA cuando corresponde.","Total USD":"Total de la OC en dólares (importación).","Neto":"Total sin IVA.","IVA":"Impuesto al valor agregado (19%).","ETA":"Fecha estimada de llegada.","Fase":"Etapa actual de la OC sobre el total de etapas de su flujo.","Estado pago":"Situación de las cuotas de pago de la OC.","Recepción":"Si lo recibido cuadra con lo pedido.","Cond. pago":"Condición de pago acordada con el proveedor.","F. creación":"Fecha en que se creó la OC.","Costeo":"Si la OC tiene costeo proyectado (P) y final (F).","Proforma":"Si la OC tiene la proforma del proveedor cargada.","Factura prov.":"Si la OC tiene la factura del proveedor cargada.","Packing List":"Si la OC de importación tiene el packing list cargado.","Factura(s) libro":"Facturas del libro de compras vinculadas a la OC.",
  "Pedido":"Unidades pedidas en la OC.","Recibido":"Unidades recibidas según guías.","Pendiente":"Pedido − recibido.","Atraso":"Días de atraso respecto de la fecha estimada.",
  "Real medido":"Mediana real medida en OC anteriores (desde la aprobación hasta la primera guía).","Estimación":"Cuánto se espera que cambie la venta de la categoría respecto de su promedio de 12 meses.","Promedio 12 meses":"Venta mensual promedio de la categoría en los últimos 12 meses.","Últimos 3 meses":"Venta mensual promedio de la categoría en los últimos 3 meses completos.","Diferencia":"Últimos 3 meses frente al promedio de 12 meses.",
  "Reposición":"El producto llegó a su punto de reorden: hay que comprar.","Stock suficiente":"El stock más el tránsito alcanza: no hay que comprar todavía.","Inactivo":"Sin stock y sin venta en los últimos 6 meses.","Sin venta reciente":"Vendió en el año pero no en los últimos 6 meses: no se compra.","Servicio":"No es mercadería (despachos, servicios): no se compra.","Kit por definir":"Kit sin composición cargada: su venta no llega a sus unidades.","Pedir esta semana":"La posición llegará al punto de reorden en los próximos 7 días.","Pedir este mes":"La posición llegará al punto de reorden en los próximos 30 días.","Sin urgencia":"La posición está lejos del punto de reorden.",
}
const glNorm=t=>String(t||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[›◐↑↓↕▾▸▴▲▼⇅✕↺ⓘ⤢:•·*%]/g," ").replace(/\(.*?\)/g," ").replace(/\s+/g," ").trim()
const GL_IDX=Object.fromEntries(Object.entries(GLOSARIO).map(([k,v])=>[glNorm(k),{t:k,d:v}]))
const glBuscar=texto=>{const n=glNorm(texto);if(!n||n.length>40)return null;if(GL_IDX[n])return GL_IDX[n];if(/^(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)[A-Z]* \d{2}$/.test(n))return{t:String(texto).trim(),d:"Unidades vendidas en ese mes, netas de devoluciones y con los kits repartidos en sus unidades."};return null}
function AyudaContextual(){
  const[tip,setTip]=useState(null)
  useEffect(()=>{
    let timer=null,actual=null
    const ocultar=()=>{clearTimeout(timer);actual=null;setTip(null)}
    const sobre=e=>{
      const el=e.target;if(!(el instanceof Element))return
      if(el.closest('input,select,textarea,[data-sin-ayuda]')||el.closest('[title]'))return ocultar()
      let hit=null
      const celda=el.closest('td,th')
      if(celda){const tabla=celda.closest('table');const th=tabla?.tHead?.rows?.[0]?.cells?.[celda.cellIndex];if(th)hit=glBuscar(String(th.innerText??th.textContent??"").split("\n")[0])}
      if(!hit){let n=el;for(let k=0;k<4&&n&&!hit;k++){hit=glBuscar(String(n.innerText??n.textContent??"").split("\n")[0]);n=n.parentElement}}
      if(!hit)return ocultar()
      if(actual===hit.t)return
      clearTimeout(timer);const x=e.clientX,y=e.clientY
      timer=setTimeout(()=>{actual=hit.t;setTip({...hit,x,y})},350)
    }
    const mover=e=>setTip(t=>t?{...t,x:e.clientX,y:e.clientY}:t)
    const salir=e=>{if(!e.relatedTarget)ocultar()}
    document.addEventListener("mouseover",sobre);document.addEventListener("mousemove",mover);document.addEventListener("mouseout",salir)
    document.addEventListener("mousedown",ocultar);window.addEventListener("scroll",ocultar,true)
    return()=>{clearTimeout(timer);document.removeEventListener("mouseover",sobre);document.removeEventListener("mousemove",mover);document.removeEventListener("mouseout",salir);document.removeEventListener("mousedown",ocultar);window.removeEventListener("scroll",ocultar,true)}
  },[])
  if(!tip)return null
  const W=300,x=Math.min(tip.x+14,window.innerWidth-W-10),y=tip.y+110>window.innerHeight?tip.y-100:tip.y+18
  return <div role="tooltip" style={{position:"fixed",left:Math.max(6,x),top:Math.max(6,y),width:W,zIndex:1000,background:"#16213E",color:"#fff",borderRadius:8,padding:"8px 10px",fontSize:12,lineHeight:1.45,boxShadow:"0 8px 24px rgba(0,0,0,.25)",pointerEvents:"none"}}><div style={{fontWeight:800,marginBottom:2}}>{tip.t}</div><div style={{opacity:.92}}>{tip.d}</div></div>
}

function CosteoImpView({config,saveConfig,ocs,cu,addFirma}){
  const ocsImp=ocs.filter(o=>o.tipo_oc==="Importación"&&!["Rechazada","Anulada","Borrador"].includes(o.estado))
  const[selOC,setSelOC]=useState("")
  const[ocItems,setOcItems]=useState([])
  const[tab,setLocalTab]=useState("parametros") // parametros | prorrateo | productos | margenes | gastos_puerto
  const[showHelp,setShowHelp]=useState(null) // id de sección con tooltip abierto

  // ⭐ PARÁMETROS — basados en plantilla NV_COTIZACION.xlsx
  // Todos los valores USD (excepto TC e IVA/Aforo que son %)
  // ⭐ FIX: se inicializan desde config_sistema (claves costeo_*) si existen,
  //    así lo guardado con "Guardar params" persiste entre sesiones.
  const cfgNum=(k,def)=>{const v=Number(config[k]);return Number.isFinite(v)&&config[k]!==undefined&&config[k]!==""?v:def}
  const[par,setPar]=useState({
    tc:Number(config.tc_usd)||950,
    // Flete + Seguro (USD)
    fleteUSD:cfgNum('costeo_flete_usd',3800),
    seguroUSD:cfgNum('costeo_seguro_usd',200),
    // Aduana (%)
    pctArancel:cfgNum('costeo_pct_arancel',0),
    tieneTLC:config.costeo_tiene_tlc==="true"||false,
    pctIVA:cfgNum('costeo_pct_iva',19),
    // Puerto (USD) - detalle por plantilla
    puerto_honorarios:cfgNum('costeo_puerto_honorarios',250),
    puerto_despacho:cfgNum('costeo_puerto_despacho',100),
    puerto_desconsolidacion:cfgNum('costeo_puerto_desconsolidacion',175),
    puerto_getin:cfgNum('costeo_puerto_getin',250),
    puerto_seguro:cfgNum('costeo_puerto_seguro',300),
    puerto_seguro_contenedor:cfgNum('costeo_puerto_seguro_contenedor',300),
    puerto_carpeta:cfgNum('costeo_puerto_carpeta',15),
    puerto_edi:cfgNum('costeo_puerto_edi',10),
    puerto_flete_interno:cfgNum('costeo_puerto_flete_interno',400),
    puerto_descargadores:cfgNum('costeo_puerto_descargadores',200),
    contenedores:cfgNum('costeo_contenedores',1),
    // Agente aduana (USD)
    agenteAduana:cfgNum('costeo_agente_aduana',500),
    // Otros (USD)
    otrosGastos:cfgNum('costeo_otros_gastos',0),
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
  // ⭐ FIX SEP-2026: el IVA de internación (19% s/CIF) es CRÉDITO FISCAL recuperable en el F29 — NO es costo del producto.
  // Se calcula solo como informativo (flujo de caja de la internación). Antes se sumaba al costeable e inflaba el CU ~15%
  // (origen del sobrecosto de $131M corregido en BSALE ago-sep 2026). El flete interno ya viene DENTRO de gastosPuerto_USD,
  // por eso no se suma como término aparte (antes se sumaba y restaba, duplicándolo en la vista).
  const totalGastosCL_USD = gastosPuerto_USD + adValorem_USD + agenteAd_USD + otros_USD
  const totalImport_USD = valorCIF_USD + totalGastosCL_USD
  const desembolsoInternacion_USD = totalImport_USD + iva_USD // informativo: caja total a desembolsar (incluye IVA recuperable)

  // Versión CLP (× TC)
  const toCLP = (u) => Math.round(u*TC)

  // 4. Prorrateo por producto (FOB weight) — según plantilla
  const productos = itemsFOB.map(item=>{
    const pctFOB = totalFOBUSD>0 ? item.fobUSD/totalFOBUSD : 0
    const flete_prod = flete_USD * pctFOB
    const seguro_prod = seguro_USD * pctFOB
    const gastosCL_prod = (gastosPuerto_USD + adValorem_USD + agenteAd_USD + otros_USD) * pctFOB // sin IVA (crédito fiscal)
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
    // ⭐ FIX: guarda TODOS los parámetros del costeo con claves costeo_*
    //    (antes guardaba solo 8 con mapeos cruzados) y verifica errores
    //    (antes si RLS bloqueaba la escritura, fallaba en silencio).
    const keys={
      tc_usd:par.tc,
      costeo_flete_usd:par.fleteUSD,
      costeo_seguro_usd:par.seguroUSD,
      costeo_pct_arancel:par.pctArancel,
      costeo_tiene_tlc:par.tieneTLC,
      costeo_pct_iva:par.pctIVA,
      costeo_puerto_honorarios:par.puerto_honorarios,
      costeo_puerto_despacho:par.puerto_despacho,
      costeo_puerto_desconsolidacion:par.puerto_desconsolidacion,
      costeo_puerto_getin:par.puerto_getin,
      costeo_puerto_seguro:par.puerto_seguro,
      costeo_puerto_seguro_contenedor:par.puerto_seguro_contenedor,
      costeo_puerto_carpeta:par.puerto_carpeta,
      costeo_puerto_edi:par.puerto_edi,
      costeo_puerto_flete_interno:par.puerto_flete_interno,
      costeo_puerto_descargadores:par.puerto_descargadores,
      costeo_contenedores:par.contenedores,
      costeo_agente_aduana:par.agenteAduana,
      costeo_otros_gastos:par.otrosGastos,
    }
    const errores=[]
    for(const[k,v]of Object.entries(keys)){
      const err=await saveConfig(k,String(v))
      if(err)errores.push(`${k}: ${err.message}`)
    }
    if(errores.length>0){
      alert(`⚠ ${errores.length} parámetro(s) NO se guardaron:\n\n${errores.slice(0,4).join("\n")}${errores.length>4?"\n…":""}\n\nProbable causa: permisos (RLS) en config_sistema para tu rol. Reportalo al admin.`)
    }else{
      alert("✓ Parámetros guardados. Se cargarán automáticamente la próxima vez que abras el Costeo.")
    }
  }

  const guardarCosteo=async()=>{
    if(!selOC){alert("⚠ Selecciona una OC primero");return}
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
      total_aduana:toCLP(adValorem_USD),gastos_internacion:toCLP(iva_USD),total_puerto:toCLP(puerto),
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

  // ⭐ INFORME ENTREGABLE — PDF ejecutivo del costeo (estilo corporativo SOP P07)
  const generarInformePDF=()=>{
    try{
      const autoTable=(d,o)=>d.autoTable(o)
      const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"})
      const W=210
      const ocActual=selOC?ocs.find(o=>o.id===selOC):null
      const esFinal=ocActual&&["Internación","Validar costeo final","Transporte","Recibida OK","Recibida parcial","Cerrada","Despacho nac."].includes(ocActual.estado)

      // Header corporativo
      doc.setFillColor(26,26,46) // #1a1a2e
      doc.rect(0,0,W,30,"F")
      doc.setTextColor(255,255,255)
      doc.setFontSize(16);doc.setFont(undefined,"bold")
      doc.text("OUTLET DE PUERTAS SPA",14,13)
      doc.setFontSize(10);doc.setFont(undefined,"normal")
      doc.text("Informe de Costeo de Importación · SOP P07 Módulo de Abastecimiento",14,20)
      doc.setFontSize(9)
      doc.text(`${selOC?`OC: ${selOC}`:"Simulación libre"} · ${esFinal?"COSTEO FINAL":"COSTEO PROYECTADO"}`,14,26)

      // Meta
      doc.setTextColor(60,60,60);doc.setFontSize(9)
      doc.text(`Fecha: ${hoy()} ${hora()}`,W-14,13,{align:"right"})
      doc.text(`Preparado por: ${cu?.nombre||"—"}`,W-14,18,{align:"right"})
      doc.text(`TC USD: $${fN(par.tc)}`,W-14,23,{align:"right"})

      // Resumen ejecutivo
      let y=38
      doc.setTextColor(26,26,46);doc.setFontSize(12);doc.setFont(undefined,"bold")
      doc.text("Resumen ejecutivo",14,y);y+=3
      autoTable(doc,{
        startY:y,
        head:[["FOB Origen","CIF","Gastos en CL","Total Importación","CU Bodega prom.","Margen prom."]],
        body:[[
          `USD ${fN(valorFOB_USD)} · ${fmt(toCLP(valorFOB_USD))}`,
          `USD ${fN(valorFOB_USD+flete_USD+seguro_USD)} · ${fmt(toCLP(valorFOB_USD+flete_USD+seguro_USD))}`,
          `USD ${fN(totalImport_USD-valorFOB_USD-flete_USD-seguro_USD)} · ${fmt(toCLP(totalImport_USD-valorFOB_USD-flete_USD-seguro_USD))}`,
          `USD ${fN(totalImport_USD)} · ${fmt(toCLP(totalImport_USD))}`,
          totalCantidad>0?fmt(Math.round(toCLP(totalImport_USD)/totalCantidad)):"—",
          `${Math.round(margenPromedio)}%`
        ]],
        theme:"grid",styles:{fontSize:7.5,cellPadding:2},headStyles:{fillColor:[26,26,46],fontSize:7.5}
      })
      y=doc.lastAutoTable.finalY+8

      // Desglose de costos
      doc.setFontSize(12);doc.setFont(undefined,"bold");doc.setTextColor(26,26,46)
      doc.text("Desglose de costos",14,y);y+=3
      autoTable(doc,{
        startY:y,
        head:[["Etapa","USD","CLP"]],
        body:[
          ["1. FOB Origen",fN(valorFOB_USD),fmt(toCLP(valorFOB_USD))],
          ["2. Flete internacional",fN(flete_USD),fmt(toCLP(flete_USD))],
          ["3. Seguro internacional",fN(seguro_USD),fmt(toCLP(seguro_USD))],
          [`4. Aduana (arancel ${par.tieneTLC?"TLC 0":par.pctArancel}%)`,fN(adValorem_USD),fmt(toCLP(adValorem_USD))],
          [`5. Gastos en puerto sin flete interno (${par.contenedores} contenedor/es)`,fN(puerto-fleteInterno_USD),fmt(toCLP(puerto-fleteInterno_USD))],
          ["6. Agente de aduana",fN(agenteAd_USD),fmt(toCLP(agenteAd_USD))],
          ["7. Transporte interno",fN(fleteInterno_USD),fmt(toCLP(fleteInterno_USD))],
          [{content:"TOTAL IMPORTACIÓN (costeable)",styles:{fontStyle:"bold"}},{content:fN(totalImport_USD),styles:{fontStyle:"bold"}},{content:fmt(toCLP(totalImport_USD)),styles:{fontStyle:"bold"}}],
          [{content:`IVA internación ${par.pctIVA}% (crédito fiscal — NO costeable)`,styles:{textColor:[142,142,147],fontStyle:"italic"}},{content:fN(iva_USD),styles:{textColor:[142,142,147]}},{content:fmt(toCLP(iva_USD)),styles:{textColor:[142,142,147]}}],
          [{content:"Desembolso total internación (con IVA)",styles:{textColor:[142,142,147]}},{content:fN(desembolsoInternacion_USD),styles:{textColor:[142,142,147]}},{content:fmt(toCLP(desembolsoInternacion_USD)),styles:{textColor:[142,142,147]}}],
        ],
        theme:"striped",styles:{fontSize:8,cellPadding:2},headStyles:{fillColor:[26,26,46],fontSize:8},
        columnStyles:{1:{halign:"right"},2:{halign:"right"}}
      })
      y=doc.lastAutoTable.finalY+8

      // Parámetros aplicados
      doc.setFontSize(12);doc.setFont(undefined,"bold");doc.setTextColor(26,26,46)
      doc.text("Parámetros aplicados",14,y);y+=3
      autoTable(doc,{
        startY:y,
        head:[["Parámetro","Valor","Parámetro","Valor"]],
        body:[
          ["Tipo cambio USD",`$${fN(par.tc)}`,"Honorarios puerto",`USD ${par.puerto_honorarios}`],
          ["Flete internacional",`USD ${fN(par.fleteUSD)}`,"Gastos despacho",`USD ${par.puerto_despacho}`],
          ["Seguro internacional",`USD ${fN(par.seguroUSD)}`,"Desconsolidación",`USD ${par.puerto_desconsolidacion} ×cont.`],
          ["Arancel",par.tieneTLC?"TLC (0%)":`${par.pctArancel}%`,"GET IN",`USD ${par.puerto_getin} ×cont.`],
          ["IVA importación",`${par.pctIVA}%`,"Seguro contenedor",`USD ${par.puerto_seguro_contenedor} ×cont.`],
          ["Contenedores",String(par.contenedores),"Flete interno",`USD ${par.puerto_flete_interno} ×cont.`],
          ["Agente aduana",`USD ${fN(par.agenteAduana)}`,"Descargadores",`USD ${par.puerto_descargadores} ×cont.`],
        ],
        theme:"grid",styles:{fontSize:7.5,cellPadding:1.8},headStyles:{fillColor:[26,26,46],fontSize:7.5}
      })
      y=doc.lastAutoTable.finalY+8

      // Productos con prorrateo
      if(productos.length>0){
        if(y>230){doc.addPage();y=20}
        doc.setFontSize(12);doc.setFont(undefined,"bold");doc.setTextColor(26,26,46)
        doc.text(`Prorrateo por producto (${productos.length})`,14,y);y+=3
        autoTable(doc,{
          startY:y,
          head:[["SKU","Producto","Cant.","FOB unit USD","CU imp. USD","CU imp. CLP","Margen","P. venta CLP"]],
          body:productos.map(p=>[
            p.sku||"—",(p.producto||"").slice(0,38),fN(p.cantidad),
            (p.costoUnit||0).toFixed(2),(p.cuImport_USD||0).toFixed(2),
            fmt(Math.round(p.cuImport_CLP||0)),`${p.margenPct}%`,fmt(Math.round(p.ventaCLP||0))
          ]),
          theme:"striped",styles:{fontSize:7,cellPadding:1.6},headStyles:{fillColor:[26,26,46],fontSize:7},
          columnStyles:{2:{halign:"right"},3:{halign:"right"},4:{halign:"right"},5:{halign:"right"},6:{halign:"right"},7:{halign:"right"}}
        })
        y=doc.lastAutoTable.finalY+6
      }

      // Footer
      const pages=doc.internal.getNumberOfPages()
      for(let i=1;i<=pages;i++){
        doc.setPage(i)
        doc.setFontSize(7);doc.setTextColor(150,150,150)
        doc.text(`Outlet de Puertas SpA · Informe de costeo generado el ${hoy()} ${hora()} por ${cu?.nombre||"—"} · Página ${i}/${pages}`,W/2,290,{align:"center"})
      }

      doc.save(`Costeo_${selOC||"Simulacion"}_${hoy()}.pdf`)
    }catch(e){
      console.error("[generarInformePDF]",e)
      alert("⚠ Error generando el informe: "+(e?.message||e))
    }
  }

  const InfoTag=({children,onHover,id})=><span
    onMouseEnter={()=>setShowHelp(id)}
    onMouseLeave={()=>setShowHelp(null)}
    style={{cursor:"help",display:"inline-flex",alignItems:"center",justifyContent:"center",width:16,height:16,borderRadius:8,background:"#E5E7EB",color:"#6E6E73",fontSize:11,fontWeight:700,marginLeft:4,position:"relative"}}
    title={onHover}>?
    {showHelp===id&&<div style={{position:"absolute",bottom:"100%",left:"50%",transform:"translateX(-50%)",marginBottom:4,background:"#1C1C1E",color:"#fff",padding:"8px 10px",borderRadius:6,fontSize:12,fontWeight:400,width:260,zIndex:100,lineHeight:1.4,boxShadow:"0 4px 12px rgba(0,0,0,0.3)"}}>{children}</div>}
  </span>

  const Tab=({id,label,ic})=><button onClick={()=>setLocalTab(id)} style={{padding:"8px 14px",borderRadius:8,fontSize:12,fontWeight:600,background:tab===id?"#1D4E89":"#fff",color:tab===id?"#fff":"#1C1C1E",border:tab===id?"none":"1px solid #E5E7EB",cursor:"pointer"}}>{ic} {label}</button>

  return<div>
    {/* HEADER */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:10}}>
      <div>
        <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>💼 Costeo de Importación</div>
        <div style={{fontSize:13,color:"#6E6E73"}}>
          Prorrateo por FOB según plantilla Excel NV_COTIZACION ·
          {modoOrigen==="oc"?<span style={{color:"#1E7A44",fontWeight:600}}> OC {selOC} · {itemsBase.length} productos</span>:<span style={{color:"#B25E09",fontWeight:600}}> Simulación libre</span>}
        </div>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        <Bt v="gry" onClick={saveParams} sm ic="💾">Guardar params</Bt>
        <Bt v="gry" onClick={generarInformePDF} sm ic="📄">Informe</Bt>
        <Bt v="pri" onClick={guardarCosteo} sm ic="📎" disabled={!selOC}>Anexar a OC</Bt>
      </div>
    </div>

    {/* SELECTOR OC */}
    <div style={{background:"#fff",borderRadius:10,padding:12,marginBottom:10,border:"1px solid #E5E7EB"}}>
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <label style={{fontSize:12,fontWeight:600,color:"#6E6E73"}}>Modo:</label>
        <select value={selOC} onChange={e=>setSelOC(e.target.value)} style={{...css.select,padding:"6px 10px",fontSize:12,minWidth:280}}>
          <option value="">— Simulación libre (ingresa FOB manual) —</option>
          {ocsImp.map(o=><option key={o.id} value={o.id}>{o.id} · {fU(o.total_usd||0)} · {o.estado}</option>)}
        </select>
        {modoOrigen==="sim"&&<>
          <label style={{fontSize:12,color:"#6E6E73"}}>Cant. sim:</label>
          <NumInput value={par.simCantUds} onChange={v=>setParam("simCantUds",v)}/>
          <label style={{fontSize:12,color:"#6E6E73"}}>Costo unit USD:</label>
          <NumInput value={par.simPrecioUnitFOB} onChange={v=>setParam("simPrecioUnitFOB",v)} step={0.01}/>
        </>}
      </div>
    </div>

    {/* KPIs GLOBALES */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:8,marginBottom:12}}>
      <div style={{background:"#fff",borderRadius:10,padding:12,borderLeft:"4px solid #1D4E89",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:11,color:"#6E6E73",textTransform:"uppercase",fontWeight:700}}>FOB Origen</div>
        <div style={{fontSize:18,fontWeight:800,color:"#1D4E89"}}>{fU(valorFOB_USD)}</div>
        <div style={{fontSize:11,color:"#6E6E73"}}>{fmt(toCLP(valorFOB_USD))}</div>
      </div>
      <div style={{background:"#fff",borderRadius:10,padding:12,borderLeft:"4px solid #223058",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:11,color:"#6E6E73",textTransform:"uppercase",fontWeight:700}}>CIF</div>
        <div style={{fontSize:18,fontWeight:800,color:"#223058"}}>{fU(valorCIF_USD)}</div>
        <div style={{fontSize:11,color:"#6E6E73"}}>{fmt(toCLP(valorCIF_USD))}</div>
      </div>
      <div style={{background:"#fff",borderRadius:10,padding:12,borderLeft:"4px solid #B25E09",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:11,color:"#6E6E73",textTransform:"uppercase",fontWeight:700}}>Gastos en CL</div>
        <div style={{fontSize:18,fontWeight:800,color:"#B25E09"}}>{fU(totalGastosCL_USD)}</div>
        <div style={{fontSize:11,color:"#6E6E73"}}>{fmt(toCLP(totalGastosCL_USD))} · sin IVA (créd. fiscal)</div>
      </div>
      <div style={{background:"#fff",borderRadius:10,padding:12,borderLeft:"4px solid #1E7A44",boxShadow:"0 1px 2px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:11,color:"#6E6E73",textTransform:"uppercase",fontWeight:700}}>TOTAL importación</div>
        <div style={{fontSize:18,fontWeight:800,color:"#1E7A44"}}>{fU(totalImport_USD)}</div>
        <div style={{fontSize:11,color:"#6E6E73"}}>{fmt(toCLP(totalImport_USD))}</div>
      </div>
      <div style={{background:"linear-gradient(135deg,#1a1a2e,#16213e)",borderRadius:10,padding:12,color:"#fff"}}>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.6)",textTransform:"uppercase",fontWeight:700}}>Margen bruto</div>
        <div style={{fontSize:18,fontWeight:800}}>{Math.round(margenPromedio)}%</div>
        <div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>{fmt(totalMargenCLP)} CLP</div>
      </div>
    </div>

    <CosteoCascada fob={valorFOB_USD} flete={flete_USD} cfr={valorCFR_USD} seguro={seguro_USD} cif={valorCIF_USD} puerto={gastosPuerto_USD} arancel={adValorem_USD} tieneTLC={par.tieneTLC} agente={agenteAd_USD} otros={otros_USD} gastosCL={totalGastosCL_USD} total={totalImport_USD} iva={iva_USD} desembolso={desembolsoInternacion_USD} cantidad={totalCantidad} tc={TC} contenedores={par.contenedores} toCLP={toCLP}/>
    {/* TABS */}
    <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
      <Tab id="parametros" ic="⚙️" label="Parámetros"/>
      <Tab id="gastos_puerto" ic="⚓" label="Gastos en puerto"/>
      <Tab id="prorrateo" ic="📊" label="Desglose Prorateo"/>
      <Tab id="productos" ic="📦" label={`Productos (${productos.length})`}/>
      <Tab id="margenes" ic="💰" label="Márgenes"/>
      <Tab id="costos_reales" ic="🧾" label="Costos reales"/>
    </div>

    {/* ═══ TAB: PARÁMETROS ═══ */}
    {tab==="parametros"&&<div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <div style={{fontSize:14,fontWeight:800,marginBottom:12,color:"#1C1C1E"}}>⚙️ Parámetros de costeo</div>

      {/* TC */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:"#6E6E73",marginBottom:6,display:"flex",alignItems:"center"}}>TIPO DE CAMBIO (TC)
            <InfoTag id="tc" onHover="TC CLP/USD">
              <b>De dónde viene:</b><br/>
              Configuración global del sistema (Config → Reposición → TC USD). Se usa para convertir todos los valores USD a CLP.<br/><br/>
              <b>En la plantilla Excel:</b> celda <code>cotizacion!J2 = 950</code>
            </InfoTag>
          </div>
          <NumInput value={par.tc} onChange={v=>setParam("tc",v)} style={{width:"100%"}} prefix="CLP/USD"/>
        </div>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:"#6E6E73",marginBottom:6}}>CONTENEDORES
            <InfoTag id="cont" onHover="Nro contenedores">
              Cantidad de contenedores del embarque. Afecta desconsolidación, GET IN, seguro contenedor, flete interno y descargadores.<br/><br/>
              <b>Plantilla:</b> <code>cotizacion!M2 = 2</code>
            </InfoTag>
          </div>
          <NumInput value={par.contenedores} onChange={v=>setParam("contenedores",v)} style={{width:"100%"}} suffix="cont."/>
        </div>
      </div>

      {/* Flete + Seguro */}
      <div style={{padding:12,background:"#22305808",borderRadius:8,marginBottom:12,borderLeft:"3px solid #223058"}}>
        <div style={{fontSize:13,fontWeight:700,color:"#223058",marginBottom:10}}>🚢 Flete + Seguro (USD)</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <div style={{fontSize:12,color:"#6E6E73",marginBottom:4}}>Flete marítimo
              <InfoTag id="flete" onHover="Flete">
                Costo de transporte marítimo desde origen hasta puerto de destino.<br/><br/>
                <b>Plantilla:</b> <code>cotizacion!H2 = 3800</code><br/>
                En plantilla se suma al FOB para formar CFR (Cost + Freight).
              </InfoTag>
            </div>
            <NumInput value={par.fleteUSD} onChange={v=>setParam("fleteUSD",v)} suffix="USD"/>
            <div style={{fontSize:11,color:"#6E6E73",marginTop:3}}>≈ {fmt(toCLP(par.fleteUSD))}</div>
          </div>
          <div>
            <div style={{fontSize:12,color:"#6E6E73",marginBottom:4}}>Seguro mercadería
              <InfoTag id="seguro" onHover="Seguro">
                Seguro sobre la mercadería durante el transporte marítimo.<br/><br/>
                <b>Plantilla:</b> <code>cotizacion!H3 = 200</code> (valor fijo USD)<br/>
                CIF = CFR + Seguro
              </InfoTag>
            </div>
            <NumInput value={par.seguroUSD} onChange={v=>setParam("seguroUSD",v)} suffix="USD"/>
            <div style={{fontSize:11,color:"#6E6E73",marginTop:3}}>≈ {fmt(toCLP(par.seguroUSD))}</div>
          </div>
        </div>
        <div style={{fontSize:12,color:"#223058",marginTop:8,fontWeight:600}}>CIF total: {fU(valorCIF_USD)} · {fmt(toCLP(valorCIF_USD))}</div>
      </div>

      {/* Aduana */}
      <div style={{padding:12,background:"#B4231808",borderRadius:8,marginBottom:12,borderLeft:"3px solid #B42318"}}>
        <div style={{fontSize:13,fontWeight:700,color:"#B42318",marginBottom:10}}>🏛 Aduana</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
          <div>
            <div style={{fontSize:12,color:"#6E6E73",marginBottom:4}}>Ad Valorem
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
            <div style={{fontSize:12,color:"#6E6E73",marginBottom:4}}>Con TLC</div>
            <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",padding:"6px 8px"}}>
              <input type="checkbox" checked={par.tieneTLC} onChange={e=>setParam("tieneTLC",e.target.checked)}/>
              <span style={{fontSize:12}}>TLC vigente (0% arancel)</span>
            </label>
          </div>
          <div>
            <div style={{fontSize:12,color:"#6E6E73",marginBottom:4}}>IVA
              <InfoTag id="iva" onHover="IVA importacion">
                IVA sobre CIF (19% Chile).<br/><br/>
                <b>Plantilla:</b> <code>cotizacion!K2 = 0.19</code> = 19%<br/>
                IVA = CIF × 19% (recuperable como crédito fiscal)
              </InfoTag>
            </div>
            <NumInput value={par.pctIVA} onChange={v=>setParam("pctIVA",v)} step={0.5} suffix="%"/>
          </div>
        </div>
        <div style={{fontSize:12,color:"#B42318",marginTop:8,fontWeight:600}}>
          Arancel {fU(adValorem_USD)} + IVA {fU(iva_USD)} · Pago en aduana {fU(adValorem_USD+iva_USD)} ({fmt(toCLP(adValorem_USD+iva_USD))}) — el IVA es crédito fiscal: se paga pero NO entra al costo
        </div>
      </div>

      {/* Agente aduana + otros */}
      <div style={{padding:12,background:"#5B2C6F08",borderRadius:8,marginBottom:12,borderLeft:"3px solid #5B2C6F"}}>
        <div style={{fontSize:13,fontWeight:700,color:"#5B2C6F",marginBottom:10}}>📋 Agente aduana + otros gastos</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <div style={{fontSize:12,color:"#6E6E73",marginBottom:4}}>Agente aduana
              <InfoTag id="agente" onHover="Agente aduana">
                Honorarios del agente aduana por trámite de importación.<br/><br/>
                <b>Plantilla:</b> <code>cotizacion!H6 = 500</code>
              </InfoTag>
            </div>
            <NumInput value={par.agenteAduana} onChange={v=>setParam("agenteAduana",v)} suffix="USD"/>
            <div style={{fontSize:11,color:"#6E6E73",marginTop:3}}>≈ {fmt(toCLP(par.agenteAduana))}</div>
          </div>
          <div>
            <div style={{fontSize:12,color:"#6E6E73",marginBottom:4}}>Otros gastos
              <InfoTag id="otros" onHover="Otros gastos">
                Gastos varios no categorizados.<br/><br/>
                <b>Plantilla:</b> <code>cotizacion!H8 = 1000</code>
              </InfoTag>
            </div>
            <NumInput value={par.otrosGastos} onChange={v=>setParam("otrosGastos",v)} suffix="USD"/>
            <div style={{fontSize:11,color:"#6E6E73",marginTop:3}}>≈ {fmt(toCLP(par.otrosGastos))}</div>
          </div>
        </div>
      </div>

      <div style={{fontSize:12,color:"#6E6E73",marginTop:12,padding:"10px 12px",background:"#F8F8FA",borderRadius:6,lineHeight:1.5}}>
        💡 Los parámetros se basan en la plantilla Excel <b>NV_COTIZACION.xlsx</b> — hoja "cotizacion" (cabecera) y "Prorateo" (desglose). Para ver el detalle de los gastos en puerto, cambia a la pestaña <b>Gastos en puerto</b>.
      </div>
    </div>}

    {/* ═══ TAB: GASTOS EN PUERTO ═══ */}
    {tab==="gastos_puerto"&&<div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <div style={{fontSize:14,fontWeight:800,marginBottom:6,color:"#1C1C1E"}}>⚓ Gastos en puerto detallados</div>
      <div style={{fontSize:12,color:"#6E6E73",marginBottom:14,lineHeight:1.5}}>
        Detalle basado en la tabla <b>O2:Q13 de la plantilla</b>. Los valores marcados con <span style={{color:"#223058",fontWeight:700}}>× cont.</span> se multiplican por la cantidad de contenedores (actualmente <b>{par.contenedores}</b>).
      </div>

      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{background:"#F8F8FA",borderBottom:"2px solid #E5E7EB"}}>
          <th style={{padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Concepto</th>
          <th style={{padding:"8px 12px",textAlign:"right",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Base USD</th>
          <th style={{padding:"8px 12px",textAlign:"center",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Multiplicador</th>
          <th style={{padding:"8px 12px",textAlign:"right",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Total USD</th>
          <th style={{padding:"8px 12px",textAlign:"right",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Total CLP</th>
          <th style={{padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Fuente</th>
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
            return<tr key={i} style={{borderBottom:"1px solid #F4F5F7"}}>
              <td style={{padding:"6px 12px",fontWeight:600}}>{label}</td>
              <td style={{padding:"6px 12px",textAlign:"right"}}>
                <NumInput value={val} onChange={v=>setParam(key,v)} suffix="USD"/>
              </td>
              <td style={{padding:"6px 12px",textAlign:"center",fontSize:12,color:xcont?"#223058":"#6E6E73",fontWeight:xcont?700:400}}>
                {xcont?`× ${par.contenedores}`:"×1"}
              </td>
              <td style={{padding:"6px 12px",textAlign:"right",fontWeight:700,color:"#1D4E89"}}>{fU(total)}</td>
              <td style={{padding:"6px 12px",textAlign:"right",fontWeight:600,color:"#6E6E73"}}>{fmt(toCLP(total))}</td>
              <td style={{padding:"6px 12px",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>{src}</td>
            </tr>
          })}
          <tr style={{background:"#B25E0908",fontWeight:800}}>
            <td style={{padding:"10px 12px",fontSize:13}}>TOTAL GASTOS EN PUERTO</td>
            <td style={{padding:"10px 12px"}}></td>
            <td style={{padding:"10px 12px"}}></td>
            <td style={{padding:"10px 12px",textAlign:"right",fontSize:14,color:"#B25E09"}}>{fU(puerto)}</td>
            <td style={{padding:"10px 12px",textAlign:"right",fontSize:14,color:"#B25E09"}}>{fmt(toCLP(puerto))}</td>
            <td style={{padding:"10px 12px",fontSize:11,color:"#AEAEB2"}}>SUM(Q2:Q13)</td>
          </tr>
        </tbody>
      </table>
    </div>}

    {/* ═══ TAB: DESGLOSE PRORATEO (según plantilla hoja Prorateo A1:C14) ═══ */}
    {tab==="prorrateo"&&<div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <div style={{fontSize:14,fontWeight:800,marginBottom:6}}>📊 Desglose de valores (hoja Prorateo A1:C14)</div>
      <div style={{fontSize:12,color:"#6E6E73",marginBottom:14}}>Estructura exacta del desglose de la plantilla Excel con valores en USD y CLP.</div>

      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:"#F8F8FA",borderBottom:"2px solid #E5E7EB"}}>
          <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Desglose</th>
          <th style={{padding:"10px 12px",textAlign:"right",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Valor USD</th>
          <th style={{padding:"10px 12px",textAlign:"right",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Valor CLP</th>
          <th style={{padding:"10px 12px",textAlign:"center",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Ref plantilla</th>
        </tr></thead>
        <tbody>
          <tr style={{background:"#1D4E8908"}}><td style={{padding:"8px 12px",fontWeight:700,color:"#1D4E89"}}>VALOR FOB (FCA)</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#1D4E89"}}>{fU(valorFOB_USD)}</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#1D4E89"}}>{fmt(toCLP(valorFOB_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B2 = D49 (suma productos)</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#6E6E73"}}>Flete</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(flete_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(flete_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B3 = cotizacion!H2</td></tr>
          <tr style={{background:"#22305808"}}><td style={{padding:"8px 12px",fontWeight:700,color:"#223058"}}>VALOR CFR (CPT)</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#223058"}}>{fU(valorCFR_USD)}</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#223058"}}>{fmt(toCLP(valorCFR_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B4 = B2+B3</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#6E6E73"}}>Seguro</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(seguro_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(seguro_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B5 = cotizacion!H3</td></tr>
          <tr style={{background:"#1E7A4408"}}><td style={{padding:"8px 12px",fontWeight:700,color:"#1E7A44"}}>VALOR CIF (CIP)</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#1E7A44"}}>{fU(valorCIF_USD)}</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#1E7A44"}}>{fmt(toCLP(valorCIF_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B6 = B4+B5</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#6E6E73"}}>Gastos en puerto (sin flete int.)</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(gastosPuerto_USD-fleteInterno_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(gastosPuerto_USD-fleteInterno_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B7 = cotizacion!H4 − Q11</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#6E6E73"}}>Ad valorem</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(adValorem_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(adValorem_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B8 = CIF × %aran</td></tr>
          <tr style={{opacity:0.65}}><td style={{padding:"8px 12px",paddingLeft:30,color:"#6E6E73",fontStyle:"italic"}}>IVA internación (crédito fiscal — NO costeable)</td><td style={{padding:"8px 12px",textAlign:"right",color:"#6E6E73",fontStyle:"italic"}}>{fU(iva_USD)}</td><td style={{padding:"8px 12px",textAlign:"right",color:"#6E6E73",fontStyle:"italic"}}>{fmt(toCLP(iva_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B9 = B6 × K2 · se recupera en F29</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#6E6E73"}}>Agente de aduana</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(agenteAd_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(agenteAd_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B10 = cotizacion!H6</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#6E6E73"}}>Flete interno</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(fleteInterno_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(fleteInterno_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B11 = Q11</td></tr>
          <tr><td style={{padding:"8px 12px",paddingLeft:30,color:"#6E6E73"}}>Otros gastos</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fU(otros_USD)}</td><td style={{padding:"8px 12px",textAlign:"right"}}>{fmt(toCLP(otros_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B12 = cotizacion!H8</td></tr>
          <tr style={{background:"#B25E0908"}}><td style={{padding:"8px 12px",fontWeight:700,color:"#B25E09"}}>TOTAL GASTOS EN CL (costeable, sin IVA)</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#B25E09"}}>{fU(totalGastosCL_USD)}</td><td style={{padding:"8px 12px",textAlign:"right",fontWeight:700,color:"#B25E09"}}>{fmt(toCLP(totalGastosCL_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B13 = SUM(B7:B12) sin IVA</td></tr>
          <tr style={{background:"#B4231808",borderTop:"2px solid #B42318"}}><td style={{padding:"12px",fontWeight:800,fontSize:14,color:"#B42318"}}>TOTAL COSTEABLE</td><td style={{padding:"12px",textAlign:"right",fontWeight:800,fontSize:14,color:"#B42318"}}>{fU(totalImport_USD)}</td><td style={{padding:"12px",textAlign:"right",fontWeight:800,fontSize:14,color:"#B42318"}}>{fmt(toCLP(totalImport_USD))}</td><td style={{padding:"12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>B14 = CIF+GastosCL</td></tr>
          <tr style={{opacity:0.65}}><td style={{padding:"8px 12px",color:"#6E6E73",fontStyle:"italic"}}>Desembolso total internación (con IVA)</td><td style={{padding:"8px 12px",textAlign:"right",color:"#6E6E73",fontStyle:"italic"}}>{fU(desembolsoInternacion_USD)}</td><td style={{padding:"8px 12px",textAlign:"right",color:"#6E6E73",fontStyle:"italic"}}>{fmt(toCLP(desembolsoInternacion_USD))}</td><td style={{padding:"8px 12px",textAlign:"center",fontSize:11,color:"#AEAEB2",fontFamily:"monospace"}}>caja, no costo</td></tr>
        </tbody>
      </table>
    </div>}

    {/* ═══ TAB: PRORRATEO POR PRODUCTO (hoja Prorateo A17:J48) ═══ */}
    {tab==="productos"&&<div style={{background:"#fff",borderRadius:12,padding:16,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <div style={{fontSize:14,fontWeight:800,marginBottom:6}}>📦 Prorrateo por producto (hoja Prorateo A17:J48)</div>
      <div style={{fontSize:12,color:"#6E6E73",marginBottom:14}}>
        Prorrateo por <b>peso FOB</b> según la fórmula de la plantilla: cada gasto se distribuye según la proporción del FOB de cada producto sobre el total (<code>D_row/$D$49</code>).
      </div>

      {productos.length===0?<div style={{textAlign:"center",padding:30,color:"#6E6E73"}}>Selecciona una OC o usa modo simulación para ver productos.</div>:
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:1000}}>
          <thead><tr style={{background:"#F8F8FA",borderBottom:"2px solid #E5E7EB"}}>
            <th style={{padding:"8px",textAlign:"left",fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Producto</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Cant.</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>CU origen USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",background:"#1D4E8915"}}>FOB total USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>% FOB</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#223058",textTransform:"uppercase",background:"#22305815"}}>Flete USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#B25E09",textTransform:"uppercase",background:"#B25E0915"}}>Seguro USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#B42318",textTransform:"uppercase",background:"#B4231815"}}>Gastos CL USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#1E7A44",textTransform:"uppercase",background:"#1E7A4415"}}>Total Import USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:800,color:"#fff",textTransform:"uppercase",background:"#1C1C1E"}}>CU USD</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:800,color:"#fff",textTransform:"uppercase",background:"#1C1C1E"}}>CU CLP</th>
          </tr></thead>
          <tbody>{productos.map((p,i)=>
            <tr key={i} style={{borderBottom:"1px solid #F4F5F7"}}>
              <td style={{padding:"6px 8px",fontWeight:600}}>{p.producto}<div style={{fontSize:10.5,color:"#6E6E73",fontFamily:"monospace"}}>{p.sku}</div></td>
              <td style={{padding:"6px 8px",textAlign:"right"}}>{fN(p.cantidad)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",color:"#6E6E73"}}>{fUD(p.costoUnit)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:"#1D4E89",background:"#1D4E8908"}}>{fUD(p.fobUSD,2)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",color:"#6E6E73"}}>{(p.pctFOB*100).toFixed(1)}%</td>
              <td style={{padding:"6px 8px",textAlign:"right",color:"#223058",background:"#22305808"}}>{fUD(p.flete_prod_USD)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",color:"#B25E09",background:"#B25E0908"}}>{fUD(p.seguro_prod_USD)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",color:"#B42318",background:"#B4231808"}}>{fUD(p.gastosCL_prod_USD)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:"#1E7A44",background:"#1E7A4408"}}>{fUD(p.totalImport_prod_USD)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:800,color:"#1C1C1E",background:"#F8F8FA"}}>{fUD(p.cuImport_USD)}</td>
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
            <td style={{padding:"10px 8px",textAlign:"right"}}>{fU(gastosPuerto_USD+adValorem_USD+agenteAd_USD+otros_USD)}</td>
            <td style={{padding:"10px 8px",textAlign:"right"}}>{fU(totalImport_USD)}</td>
            <td colSpan={2} style={{padding:"10px 8px",textAlign:"right"}}>Promedio: {fUD(totalImport_USD/Math.max(totalCantidad,1))} · {fmt(Math.round(totalImport_USD/Math.max(totalCantidad,1)*TC))}</td>
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
          <div style={{fontSize:12,color:"#6E6E73"}}>Calcula precio de venta desde margen objetivo: <code>Venta = Costo / (1 - Margen%)</code></div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <label style={{fontSize:12,color:"#6E6E73"}}>Margen default %:</label>
          <NumInput value={margenDefault} onChange={v=>setMargenDefault(v)} suffix="%"/>
        </div>
      </div>

      {productos.length===0?<div style={{textAlign:"center",padding:30,color:"#6E6E73"}}>Selecciona una OC o usa modo simulación para ver márgenes.</div>:
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:900}}>
          <thead><tr style={{background:"#F8F8FA",borderBottom:"2px solid #E5E7EB"}}>
            <th style={{padding:"8px",textAlign:"left",fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Producto</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Cant.</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Costo CLP</th>
            <th style={{padding:"8px",textAlign:"center",fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Margen %</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#1E7A44",textTransform:"uppercase"}}>Venta CLP</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#5B2C6F",textTransform:"uppercase"}}>Margen unit</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Costo total</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#5B2C6F",textTransform:"uppercase"}}>Margen total</th>
            <th style={{padding:"8px",textAlign:"right",fontSize:10.5,fontWeight:700,color:"#1E7A44",textTransform:"uppercase"}}>Venta total</th>
          </tr></thead>
          <tbody>{productos.map((p,i)=>
            <tr key={i} style={{borderBottom:"1px solid #F4F5F7"}}>
              <td style={{padding:"6px 8px",fontWeight:600}}>{p.producto}<div style={{fontSize:10.5,color:"#6E6E73"}}>{p.sku}</div></td>
              <td style={{padding:"6px 8px",textAlign:"right"}}>{fN(p.cantidad)}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600}}>{fmt(Math.round(p.cuImport_CLP))}</td>
              <td style={{padding:"6px 8px",textAlign:"center"}}>
                <NumInput value={p.margenPct} onChange={v=>updMargen(p.sku,v)} suffix="%"/>
              </td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:"#1E7A44"}}>{fmt(Math.round(p.ventaCLP))}</td>
              <td style={{padding:"6px 8px",textAlign:"right",color:"#5B2C6F"}}>{fmt(Math.round(p.margenUnitCLP))}</td>
              <td style={{padding:"6px 8px",textAlign:"right"}}>{fmt(Math.round(p.costoTotalCLP))}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:"#5B2C6F"}}>{fmt(Math.round(p.margenTotalCLP))}</td>
              <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:"#1E7A44"}}>{fmt(Math.round(p.ventaTotalCLP))}</td>
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

      <div style={{marginTop:14,padding:12,background:"#F8F8FA",borderRadius:8,fontSize:12,color:"#6E6E73",lineHeight:1.6}}>
        💡 <b>Fórmulas aplicadas</b> (hoja Margenes):<br/>
        • Venta = Costo / (1 - Margen%) — plantilla <code>E = C / (1-D)</code><br/>
        • Margen unitario = Venta - Costo — plantilla <code>F = E - C</code><br/>
        • Totales = Cantidad × unitario — plantilla <code>G = B*C, H = F*B, I = H+G</code>
      </div>
    </div>}

    {/* ═══ TAB: COSTOS REALES (facturas vinculadas + comparación vs proyectado) ═══ */}
    {tab==="costos_reales"&&<CostosRealesTab ocId={selOC} cu={cu}/>}
  </div>
}

/* ═══ TRÁNSITO — Products in transit with ETA + Export ═══ */
/* 19-oct-2026: plan de compras por proveedor (propuesta tipo MRP): qué pedir, a quién y cuándo, según la fecha de pedido
   del cálculo v2.2 (punto de reorden con stock de seguridad estadístico). "Crear OC" carga los productos y abre Nueva OC. */
function PlanComprasView({setCart,setTab,cart={}}){
  const[rows,setRows]=useState(null)
  const[horizonte,setHorizonte]=useLocalState("plan_horizonte","30")
  const[origen,setOrigen]=useLocalState("plan_origen","T")
  const[abiertos,setAbiertos]=useState({})
  useEffect(()=>{(async()=>{const{data,error}=await fetchAll(supabase.from('cmp_reposicion_v2').select('sku,producto,tipo_producto,clasif_abcd,xyz,estado,proveedor_id,proveedor_nombre,origen,stock,transito,posicion,demanda_dia,demanda_mes,punto_reorden,nivel_maximo,stock_seguridad,nivel_servicio,reposicion,costo_unitario,inversion,lead_time_dias,fecha_quiebre,fecha_pedido,urgencia').not('urgencia','is',null));if(error)console.error("Plan de compras:",error);setRows(data||[])})()},[])
  if(rows===null)return <div style={{padding:30,textAlign:"center",color:"#6E6E73"}}>Cargando plan de compras…</div>
  const lim=horizonte==="hoy"?0:Number(horizonte)
  const base=new Date(hoy()+"T12:00:00")
  const dias=f=>f?Math.round((new Date(String(f).slice(0,10)+"T12:00:00")-base)/86400000):null
  const cant=r=>r.urgencia==="Pedir hoy"?Number(r.reposicion)||0:Math.max(0,Math.ceil((Number(r.nivel_maximo)||0)-(Number(r.punto_reorden)||0)))
  const items=rows.filter(r=>{const d=dias(r.fecha_pedido);return d!=null&&d<=lim&&cant(r)>0&&(origen==="T"||(origen==="IMP"?r.origen==="Importación":r.origen!=="Importación"))})
    .map(r=>({...r,cant:cant(r),monto:cant(r)*(Number(r.costo_unitario)||0),dPedido:dias(r.fecha_pedido),dQuiebre:dias(r.fecha_quiebre)}))
  const grupos=Object.values(items.reduce((m,r)=>{const k=r.proveedor_id||"_sin";(m[k]=m[k]||{k,prov:r.proveedor_id,nombre:r.proveedor_nombre||"Sin proveedor habitual",origen:r.origen,items:[]}).items.push(r);return m},{}))
    .map(g=>({...g,monto:g.items.reduce((a,r)=>a+r.monto,0),pedir:Math.min(...g.items.map(r=>r.dPedido)),quiebre:Math.min(...g.items.map(r=>r.dQuiebre??999)),lt:Math.max(...g.items.map(r=>Number(r.lead_time_dias)||0)),urg:g.items.filter(r=>r.urgencia==="Pedir hoy").length}))
    .sort((a,b)=>a.pedir-b.pedir||b.monto-a.monto)
  const total=grupos.reduce((a,g)=>a+g.monto,0)
  const quiebres=items.filter(r=>r.dQuiebre!=null&&r.dQuiebre<=30).length
  const sinProv=grupos.find(g=>!g.prov)
  const fd=d=>d==null?"—":d<=0?"hoy":d===1?"mañana":`en ${d} días`
  const colU=d=>d<=0?"#B42318":d<=7?"#B25E09":"#1D4E89"
  const crearOC=g=>{
    if(!g.prov){alert("Estos productos no tienen proveedor habitual. Agrégalos desde Reposición y elige el proveedor en Nueva OC.");return}
    const nuevos={};g.items.forEach(r=>{nuevos[r.sku]={sku:r.sku,producto:r.producto,tipo_producto:r.tipo_producto,clasif_abcd:r.clasif_abcd,estado:r.estado,cp:r.cant,reposicion_necesaria:r.cant,costo_unitario:Number(r.costo_unitario)||0,costo_original:Number(r.costo_unitario)||0,stock_actual:Number(r.stock)||0,stock_transito:Number(r.transito)||0}})
    const otros=Object.keys(cart).filter(k=>!nuevos[k]).length
    let final=nuevos
    if(otros>0){final=window.confirm(`El carrito ya tiene ${otros} producto(s) de otra selección.\n\nAceptar: reemplazarlos por los ${g.items.length} de ${g.nombre}.\nCancelar: agregarlos a lo que ya hay.`)?nuevos:{...cart,...nuevos}}
    setCart(final)
    try{localStorage.setItem("erp_sol_prov_pre",g.prov)}catch(e){}
    setTab("nueva")
  }
  const chip=(a,on,l)=><button onClick={on} style={{padding:"5px 12px",borderRadius:999,fontSize:12,fontWeight:600,cursor:"pointer",border:"1px solid "+(a?"#16213E":"#D1D5DB"),background:a?"#16213E":"#fff",color:a?"#fff":"#3A3A3C"}}>{l}</button>
  return <div>
    <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:10}}>
      <div><div style={{fontSize:20,fontWeight:800,color:"#16213E"}}>Plan de compras</div>
        <div style={{fontSize:12,color:"#6E6E73",maxWidth:880}}>Qué pedir, a quién y cuándo. Cada producto tiene su fecha de pedido: el día en que su posición (stock + tránsito) llega al punto de reorden, que incluye el stock de seguridad según su nivel de servicio. "Crear OC" carga los productos del proveedor y abre Nueva OC.</div></div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {chip(horizonte==="hoy",()=>setHorizonte("hoy"),"Pedir hoy")}{chip(horizonte==="7",()=>setHorizonte("7"),"Próximos 7 días")}{chip(horizonte==="30",()=>setHorizonte("30"),"Próximos 30 días")}
        <span style={{width:8}}/>
        {chip(origen==="T",()=>setOrigen("T"),"Todos")}{chip(origen==="NAC",()=>setOrigen("NAC"),"Nacional")}{chip(origen==="IMP",()=>setOrigen("IMP"),"Importación")}
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",background:"#fff",border:"1px solid #E5E7EB",borderBottom:"none",borderRadius:8,overflow:"hidden",marginBottom:12}}>
      {[["Proveedores",fN(grupos.filter(g=>g.prov).length),sinProv?`+ ${sinProv.items.length} SKUs sin proveedor`:"con productos a pedir"],["SKUs a pedir",fN(items.length),`${items.filter(r=>r.urgencia==="Pedir hoy").length} para hoy`],["Monto del plan",fmt(total),horizonte==="hoy"?"a pedir hoy":`en los próximos ${lim} días`],["Quiebres en 30 días",fN(quiebres),"de los productos del plan",quiebres?"#B42318":undefined]].map(([l,v,sub,c],k)=><div key={k} style={{padding:"9px 14px",borderRight:"1px solid #E5E7EB",borderBottom:"1px solid #E5E7EB",minWidth:0}}><div style={{fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",letterSpacing:0.5}}>{l}</div><div style={{fontSize:18,fontWeight:700,color:c||"#1C1C1E"}}>{v}</div><div style={{fontSize:11,color:"#6E6E73"}}>{sub}</div></div>)}
    </div>
    {grupos.length===0&&<div style={{padding:18,background:"#fff",border:"1px solid #E5E7EB",borderRadius:8,color:"#6E6E73",fontSize:13}}>No hay productos que pedir en este horizonte.</div>}
    {grupos.map(g=>{const ab=!!abiertos[g.k];return <div key={g.k} style={{background:"#fff",border:"1px solid #E5E7EB",borderLeft:`4px solid ${colU(g.pedir)}`,borderRadius:8,marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap",padding:"12px 16px"}}>
        <div style={{minWidth:220,flex:"1 1 260px"}}>
          <div style={{fontSize:14.5,fontWeight:700,color:"#1C1C1E"}}>{g.nombre} {g.origen&&<span style={{fontSize:10.5,fontWeight:700,padding:"2px 7px",borderRadius:6,marginLeft:4,background:g.origen==="Importación"?"#B4231812":"#1D4E8912",color:g.origen==="Importación"?"#B42318":"#1D4E89"}}>{g.origen==="Importación"?"IMP":"NAC"}</span>}</div>
          <div style={{fontSize:12,color:"#6E6E73"}}>{g.items.length} producto{g.items.length===1?"":"s"}{g.urg?` · ${g.urg} para hoy`:""} · lead time hasta {g.lt} días</div>
        </div>
        <div style={{textAlign:"right"}}><div style={{fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Pedir</div><div style={{fontSize:14,fontWeight:700,color:colU(g.pedir)}}>{fd(g.pedir)}</div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Primer quiebre</div><div style={{fontSize:14,fontWeight:700,color:g.quiebre<=g.lt?"#B42318":"#1C1C1E"}}>{g.quiebre>=999?"—":fd(g.quiebre)}</div></div>
        <div style={{textAlign:"right",minWidth:130}}><div style={{fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase"}}>Monto</div><div style={{fontSize:15,fontWeight:800,color:"#16213E"}}>{fmt(g.monto)}</div></div>
        <div style={{display:"flex",gap:6}}>
          <Bt sm v="gry" onClick={()=>setAbiertos(p=>({...p,[g.k]:!p[g.k]}))}>{ab?"Ocultar":"Ver productos"}</Bt>
          <Bt sm v="pri" dis={!g.prov} onClick={()=>crearOC(g)} ic="➕">Crear OC</Bt>
        </div>
      </div>
      {g.quiebre<=g.lt&&g.quiebre<999&&<div style={{margin:"0 16px 10px",fontSize:12,color:"#B42318"}}>⚠ Algún producto se quiebra antes de que alcance a llegar un pedido nuevo ({g.lt} días de lead time): conviene pedir hoy y evaluar un traslado o un proveedor alternativo.</div>}
      {ab&&<div style={{borderTop:"1px solid #F3F4F6",overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
        <thead><tr style={{background:"#F8FAFC",color:"#6E6E73",textAlign:"right",fontSize:11.5}}><th style={{textAlign:"left",padding:"7px 16px"}}>Producto</th><th style={{textAlign:"center"}}>ABC-XYZ</th><th>Stock</th><th>Tránsito</th><th>Demanda/mes</th><th>Pto. reorden</th><th>Stock seg.</th><th>Pedir</th><th>Costo</th><th>Monto</th><th>Fecha pedido</th><th style={{paddingRight:16}}>Quiebre</th></tr></thead>
        <tbody>{g.items.sort((a,b)=>a.dPedido-b.dPedido||b.monto-a.monto).map(r=><tr key={r.sku} style={{borderTop:"1px solid #F3F4F6",textAlign:"right"}}>
          <td style={{textAlign:"left",padding:"6px 16px"}}><div style={{fontWeight:600}}>{r.producto}</div><div style={{fontSize:11,color:"#9CA3AF"}}>{r.sku}</div></td>
          <td style={{textAlign:"center"}}><span style={{fontWeight:700,color:CL[r.clasif_abcd]?.c}}>{r.clasif_abcd}</span>{r.xyz?<span style={{color:"#6E6E73"}}>-{r.xyz}</span>:null}</td>
          <td>{fN(r.stock)}</td><td>{Number(r.transito)?fN(r.transito):"—"}</td><td>{fN(r.demanda_mes)}</td><td>{fN(r.punto_reorden)}</td><td title={r.nivel_servicio?`Nivel de servicio ${Math.round(r.nivel_servicio*100)}%`:""}>{fN(r.stock_seguridad)}</td>
          <td style={{fontWeight:700,color:"#16213E"}}>{fN(r.cant)}</td><td>{fmt(r.costo_unitario||0)}</td><td style={{fontWeight:600}}>{fmt(r.monto)}</td>
          <td style={{color:colU(r.dPedido),fontWeight:600}}>{fd(r.dPedido)}</td><td style={{paddingRight:16,color:r.dQuiebre!=null&&r.dQuiebre<=Number(r.lead_time_dias)?"#B42318":"#3A3A3C"}}>{r.dQuiebre==null?"—":fd(r.dQuiebre)}</td>
        </tr>)}</tbody></table></div>}
    </div>})}
  </div>
}

/* 18-oct-2026: desempeño de proveedores: lead time real contra el del cálculo, puntualidad y completitud (base del ajuste por proveedor) */
function ProveedoresDesempenoView(){
  const[rows,setRows]=useState(null)
  useEffect(()=>{(async()=>{const{data,error}=await supabase.from('v_cmp_desempeno_proveedor').select('*').order('monto_clp',{ascending:false});if(error)console.error("Desempeño:",error);setRows(data||[])})()},[])
  if(rows===null)return <div style={{padding:30,textAlign:"center",color:"#6E6E73"}}>Cargando desempeño de proveedores…</div>
  const conLt=rows.filter(r=>Number(r.n_lt)>0)
  const med=a=>{const v=a.filter(x=>x!=null).map(Number).sort((x,y)=>x-y);if(!v.length)return null;const m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2}
  const conPct=rows.filter(r=>r.pct_a_tiempo!=null)
  const pctAT=conPct.length?Math.round(conPct.reduce((acc,r)=>acc+Number(r.pct_a_tiempo),0)/conPct.length):null
  const medNac=med(conLt.filter(r=>r.origen==="Nacional").map(r=>r.lt_real_mediana))
  const medImp=med(conLt.filter(r=>r.origen==="Importación").map(r=>r.lt_real_mediana))
  const fuerte=r=>r.lt_real_mediana!=null&&r.lt_en_calculo!=null&&Number(r.n_lt)>=2&&Math.abs(Number(r.lt_real_mediana)-Number(r.lt_en_calculo))>=10
  const desv=rows.filter(fuerte).length
  const num=(r,k)=>r[k]==null?-1:Number(r[k])
  const cols=[
    {key:"proveedor",label:"Proveedor",width:220,value:r=>r.proveedor||""},
    {key:"origen",label:"Origen",width:100,value:r=>r.origen||""},
    {key:"ocs",label:"OC",width:72,align:"right",value:r=>Number(r.ocs)||0},
    {key:"ocs_recibidas",label:"Recibidas",width:122,align:"right",value:r=>Number(r.ocs_recibidas)||0},
    {key:"ocs_abiertas",label:"Abiertas",width:112,align:"right",value:r=>Number(r.ocs_abiertas)||0},
    {key:"monto_clp",label:"Monto comprado",width:130,align:"right",value:r=>Number(r.monto_clp)||0,render:r=>fmt(r.monto_clp)},
    {key:"lt_real_mediana",label:"Lead time real (mediana, días)",width:160,align:"right",value:r=>num(r,"lt_real_mediana"),render:r=>r.lt_real_mediana==null?"—":<b>{Math.round(r.lt_real_mediana)}</b>},
    {key:"lt_real_promedio",label:"Promedio",width:116,align:"right",value:r=>num(r,"lt_real_promedio"),render:r=>r.lt_real_promedio==null?"—":Math.round(r.lt_real_promedio)},
    {key:"lt_real_max",label:"Máximo",width:108,align:"right",value:r=>num(r,"lt_real_max"),render:r=>r.lt_real_max??"—"},
    {key:"n_lt",label:"OC medidas",width:112,align:"right",value:r=>Number(r.n_lt)||0},
    {key:"lt_en_calculo",label:"Lead time en el cálculo",width:140,align:"right",value:r=>num(r,"lt_en_calculo"),render:r=>r.lt_en_calculo??<span style={{color:"#9CA3AF"}}>por tipo</span>},
    {key:"dif",label:"Diferencia (real − cálculo)",width:160,align:"right",value:r=>r.lt_real_mediana==null||r.lt_en_calculo==null?0:Number(r.lt_real_mediana)-Number(r.lt_en_calculo),render:r=>{if(r.lt_real_mediana==null||r.lt_en_calculo==null)return "—";const d=Math.round(Number(r.lt_real_mediana)-Number(r.lt_en_calculo));return <span style={{fontWeight:700,color:!fuerte(r)?"#6E6E73":d<0?"#1D4E89":"#B42318"}}>{d>0?"+":""}{d}</span>}},
    {key:"pct_a_tiempo",label:"% llega a tiempo",width:110,align:"right",value:r=>num(r,"pct_a_tiempo"),render:r=>r.pct_a_tiempo==null?"—":<span style={{fontWeight:600,color:Number(r.pct_a_tiempo)>=70?"#1E7A44":Number(r.pct_a_tiempo)>=40?"#B25E09":"#B42318"}}>{r.pct_a_tiempo}%</span>},
    {key:"pct_completo",label:"% entregado completo",width:140,align:"right",value:r=>num(r,"pct_completo"),render:r=>r.pct_completo==null?"—":`${r.pct_completo}%`},
    {key:"ultima_oc",label:"Última OC",width:100,value:r=>r.ultima_oc||""},
    {key:"lt_fuente",label:"Origen del lead time del cálculo",width:230,value:r=>r.lt_fuente||"",render:r=><span style={{fontSize:12,color:"#6E6E73"}}>{r.lt_fuente||"Parámetro por tipo de producto"}</span>},
  ]
  return <div>
    <div style={{marginBottom:10}}>
      <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Desempeño de proveedores</div>
      <div style={{fontSize:13,color:"#6E6E73"}}>Lead time real desde la aprobación de Finanzas (o la creación de la OC) hasta la primera guía recibida, comparado con el que usa el cálculo de reposición.</div>
    </div>
    <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
      <Mt l="Proveedores con OC" v={rows.length}/>
      <Mt l="Con lead time medible" v={conLt.length}/>
      <Mt l="Lead time real nacional (mediana)" v={medNac==null?"—":`${Math.round(medNac)} días`}/>
      <Mt l="Lead time real importación (mediana)" v={medImp==null?"—":`${Math.round(medImp)} días`}/>
      <Mt l="OC que llegan a tiempo (promedio)" v={pctAT==null?"—":`${pctAT}%`} ac={pctAT!=null&&pctAT<50?"#B42318":undefined}/>
      <Mt l="Diferencia de 10 días o más" v={desv} ac={desv?"#B25E09":undefined}/>
    </div>
    <div style={{fontSize:12,color:"#6E6E73",marginBottom:8,lineHeight:1.5}}>Cómo leerlo: una diferencia negativa (azul) indica que el proveedor entrega antes de lo que supone el cálculo, y se está comprando antes de lo necesario; una positiva (rojo) indica riesgo de quiebre. El lead time real también depende de cuándo se registra la OC: si se carga con el pedido ya avanzado, se ve más corto. Estos datos alimentan el ajuste de parámetros por proveedor; el cálculo no los toma solo.</div>
    <div style={{height:"calc(100vh - 330px)",minHeight:400}}>
      <DataGrid columns={cols} rows={rows} getRowId={r=>r.proveedor_id} title="Desempeño por proveedor" exportName="desempeno_proveedores" emptyText="Sin proveedores con OC"/>
    </div>
  </div>
}

function TransitoView({ocs,provs,config={},setDet}){
  // 18-oct-2026: detalle desde v_cmp_transito_detalle, con el mismo criterio que Logística y Reposición (pedido menos recibido en guías)
  const[rows,setRows]=useState(null)
  const firmaOcs=ocs.map(o=>o.id+o.estado+(o.fecha_estimada||"")).join(",")
  useEffect(()=>{(async()=>{const{data,error}=await fetchAll(supabase.from('v_cmp_transito_detalle').select('*').order('oc_id'));if(error)console.error("Tránsito:",error);setRows(data||[])})()},[firmaOcs])
  if(rows===null)return <div style={{padding:30,textAlign:"center",color:"#6E6E73"}}>Cargando tránsito…</div>
  const ocsIds=[...new Set(rows.map(r=>r.oc_id))]
  const unidades=rows.reduce((acc,r)=>acc+(Number(r.pendiente)||0),0)
  const usdPorOc=rows.filter(r=>r.moneda==="USD").reduce((m,r)=>{m[r.oc_id]=(m[r.oc_id]||0)+(Number(r.subtotal_pendiente)||0);return m},{})
  const sospechosas=new Set(Object.entries(usdPorOc).filter(([,v])=>v>1000000).map(([k])=>k))
  const clp=rows.filter(r=>r.moneda==="CLP").reduce((acc,r)=>acc+(Number(r.subtotal_pendiente)||0),0)
  const usd=rows.filter(r=>r.moneda==="USD"&&!sospechosas.has(r.oc_id)).reduce((acc,r)=>acc+(Number(r.subtotal_pendiente)||0),0)
  const vencidas=new Set(rows.filter(r=>r.dias_para_eta!=null&&Number(r.dias_para_eta)<0).map(r=>r.oc_id))
  const fM=(v,mon)=>mon==="USD"?fUD(v,2):fmt(v)
  const cols=[
    {key:"oc_id",label:"OC",width:160,render:r=><span style={{fontWeight:700,fontFamily:"monospace",fontSize:12}}>{r.oc_id} <Bd c={r.tipo_oc==="Importación"?"#B42318":"#1D4E89"} bg={r.tipo_oc==="Importación"?"#B4231815":"#1D4E8915"}>{r.tipo_oc==="Importación"?"IMP":"NAC"}</Bd></span>},
    {key:"estado",label:"Estado",width:150,value:r=>r.estado||"",render:r=><Bd c={STS[r.estado]?.c} bg={STS[r.estado]?.bg}>{STS[r.estado]?.ic} {r.estado}</Bd>},
    {key:"proveedor",label:"Proveedor",width:170,value:r=>r.proveedor||r.proveedor_id||""},
    {key:"destino",label:"Destino",width:120,value:r=>r.destino||"CD Maipú"},
    {key:"producto",label:"Producto",width:230,value:r=>r.producto||""},
    {key:"sku",label:"SKU",width:120,value:r=>r.sku||"",render:r=><span style={{fontSize:12,color:"#6E6E73"}}>{r.sku||"—"}</span>},
    {key:"pedida",label:"Pedida",width:98,align:"right",value:r=>Number(r.pedida)||0,render:r=>fN(r.pedida)},
    {key:"recibida",label:"Recibida",width:108,align:"right",value:r=>Number(r.recibida)||0,render:r=>Number(r.recibida)>0?<span style={{color:"#1E7A44"}}>{fN(r.recibida)}</span>:<span style={{color:"#D1D1D6"}}>0</span>},
    {key:"pendiente",label:"Pendiente",width:116,align:"right",value:r=>Number(r.pendiente)||0,render:r=><span style={{fontWeight:700,color:"#1D4E89"}}>{fN(r.pendiente)}</span>},
    {key:"costo_unitario",label:"Costo unitario",width:104,align:"right",value:r=>Number(r.costo_unitario)||0,render:r=>r.costo_unitario?fM(r.costo_unitario,r.moneda):"—"},
    {key:"subtotal_pendiente",label:"Subtotal pendiente",width:124,align:"right",value:r=>Number(r.subtotal_pendiente)||0,render:r=><span style={{fontWeight:600,color:sospechosas.has(r.oc_id)?"#B42318":"#1C1C1E"}}>{r.moneda==="USD"?fU(r.subtotal_pendiente):fmt(r.subtotal_pendiente)}</span>},
    {key:"moneda",label:"Moneda",width:70},
    {key:"fecha_estimada",label:"Llegada estimada",width:112,value:r=>r.fecha_estimada||"",render:r=>r.fecha_estimada||<span style={{color:"#AEAEB2"}}>Sin fecha</span>},
    {key:"dias_para_eta",label:"Días para llegar",width:124,align:"right",value:r=>r.dias_para_eta==null?99999:Number(r.dias_para_eta),render:r=>r.dias_para_eta==null?"—":Number(r.dias_para_eta)<0?<span style={{color:"#B42318",fontWeight:700}}>vencida hace {-Number(r.dias_para_eta)}</span>:<span>{r.dias_para_eta}</span>},
  ]
  return<div>
    <div style={{marginBottom:12}}>
      <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>Productos en tránsito</div>
      <div style={{fontSize:13,color:"#6E6E73"}}>Pendiente de recibir = pedido menos lo recibido en guías; mismo criterio que Logística y Reposición. Clic en una fila abre la OC.</div>
    </div>
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
      {[[ocsIds.length,"OC en tránsito","#1D4E89"],[fN(unidades),"Unidades pendientes","#1C1C1E"],[fmt(clp),"Pendiente nacional","#1E7A44"],[fU(usd),"Pendiente importación","#1E7A44"],[vencidas.size,"OC con llegada vencida",vencidas.size?"#B42318":"#1E7A44"]].map(([v,l,c],k)=><Mt key={k} l={l} v={v} ac={c}/>)}
    </div>
    {sospechosas.size>0&&<div style={{fontSize:12,color:"#B42318",marginBottom:8}}>El pendiente de importación excluye {[...sospechosas].join(", ")}: su monto en USD está en revisión (pesos guardados como dólares).</div>}
    <div style={{height:"calc(100vh - 300px)",minHeight:420}}>
      <DataGrid columns={cols} rows={rows} getRowId={r=>r.oc_id+"|"+(r.sku||"")} onRowClick={r=>{const oc=ocs.find(o=>o.id===r.oc_id);if(oc&&setDet)setDet(oc)}}
        rowStyle={r=>vencidas.has(r.oc_id)?{background:"#FFF7F5"}:{}} title="Tránsito por OC y producto" exportName="transito" emptyText="Sin productos en tránsito"/>
    </div>
  </div>
}

/* ═══ FINANZAS — Proyección de pagos OC en tránsito ═══ */
/* ═══ MODAL CONCILIAR (vincular cuota con egreso de cartola) ═══ */
// Busca combinaciones de egresos (mismo grupo, ±7d) que sumen el objetivo. Máx 5, tol 1%.
function buscarCombosConc(objetivo,egresos,opts={}){
  const maxN=opts.maxN||5,tol=opts.tol??0.01,ventana=opts.ventana??7
  const disp=egresos.filter(e=>e.saldo>0.01).sort((a,b)=>new Date(a.fecha)-new Date(b.fecha))
  const res=[]
  function rec(start,acum,grupo){
    if(grupo.length>maxN)return
    if(grupo.length>=2){
      const dif=Math.abs(1-acum/objetivo)
      if(dif<=tol){
        const fs=grupo.map(g=>new Date(g.fecha)).sort((a,b)=>a-b)
        const span=(fs[fs.length-1]-fs[0])/86400000
        if(span<=ventana)res.push({grupo:[...grupo],suma:acum,span:Math.round(span),dif})
      }
    }
    if(acum>=objetivo*(1+tol))return
    for(let i=start;i<disp.length;i++){
      if(grupo.length>0){const sp=Math.abs(new Date(disp[i].fecha)-new Date(grupo[0].fecha))/86400000;if(sp>ventana)continue}
      rec(i+1,acum+disp[i].saldo,[...grupo,disp[i]])
    }
  }
  rec(0,0,[])
  return res.sort((a,b)=>a.dif-b.dif||a.grupo.length-b.grupo.length).slice(0,5)
}
function ModalConciliar({hito,TC_USD,provs,cu,onClose,onVinculado}){
  const[cands,setCands]=useState([])
  const[combos,setCombos]=useState([])
  const[loading,setLoading]=useState(true)
  const[saving,setSaving]=useState(false)
  const esUSD=hito.moneda==="USD"
  const pendiente=hito.montoPendiente||hito.monto||0

  useEffect(()=>{
    let cancel=false
    ;(async()=>{
      setLoading(true)
      try{
        const prov=provs.find(p=>p.id===hito.oc.proveedor_id)
        const rutProv=prov?.rut?String(prov.rut).replace(/\./g,"").replace(/^0+/,"").replace(/-/g,"").toUpperCase():null
        const rutOk=rutProv&&/\d{6,}/.test(rutProv)?rutProv:null
        let lista=[]
        if(esUSD){
          const{data}=await supabase.from('global66_movimientos').select('id,fecha_transaccion,monto_usd,tercero_nombre,comentario,oc_id,proveedor_id,conciliado_at,tipo').eq('tipo','pago_usd').order('fecha_transaccion',{ascending:false}).limit(500)
          lista=(data||[]).map(m=>({id:m.id,fuente:'global66',fecha:m.fecha_transaccion?String(m.fecha_transaccion).slice(0,10):"",montoComp:Math.abs(m.monto_usd||0),label:`${m.tercero_nombre||""}${m.comentario?" · "+m.comentario:""}`,oc_id:m.oc_id,proveedor_id:m.proveedor_id}))
        }else{
          const{data}=await supabase.from('movimientos_bancarios').select('id,fecha,monto,descripcion,origen').eq('tipo','CARGO').eq('origen','banco').order('fecha',{ascending:false}).limit(2000)
          lista=(data||[]).map(m=>({id:m.id,fuente:'santander',fecha:m.fecha,montoComp:Math.abs(m.monto||0),label:m.descripcion}))
        }
        // Vínculos existentes para descontar saldo
        const{data:vinc}=await supabase.from('conciliacion_pago_mov').select('movimiento_id,global66_mov_id,monto_aplicado')
        const aplicado=new Map()
        for(const v of vinc||[]){const k=v.movimiento_id||v.global66_mov_id;if(k)aplicado.set(k,(aplicado.get(k)||0)+Number(v.monto_aplicado))}
        // Score
        const scored=lista.map(m=>{
          const saldo=m.montoComp-(aplicado.get(m.id)||0)
          let score=0;const raz=[]
          if(pendiente>0&&saldo>0){
            const dif=Math.abs(1-saldo/pendiente)
            if(dif<=0.005){score+=55;raz.push("monto exacto")}else if(dif<=0.02){score+=45;raz.push("monto ~igual")}else if(dif<=0.05){score+=30;raz.push("monto cercano")}else if(dif<=0.15){score+=12;raz.push("monto aprox")}
          }
          if(m.fuente==='global66'){
            if(m.oc_id&&hito.oc_id&&String(m.oc_id).includes(hito.oc_id)){score+=40;raz.push("OC coincide")}
            else if(m.proveedor_id&&hito.oc.proveedor_id&&m.proveedor_id===hito.oc.proveedor_id){score+=30;raz.push("proveedor")}
          }else if(rutOk){
            const rm=(m.label||"").match(/(\d{7,8})-?[\dkK]/)
            if(rm&&rm[1]&&rutOk.startsWith(rm[1])){score+=35;raz.push("RUT")}
          }
          const fProg=hito.fecha_proy
          if(fProg&&m.fecha){const dd=Math.abs((new Date(m.fecha)-new Date(fProg))/86400000);if(dd<=2){score+=12;raz.push("fecha")}else if(dd<=7){score+=8}else if(dd<=20)score+=3}
          const nivel=score>=70?"alto":score>=40?"medio":"bajo"
          return{...m,saldo,score,nivel,razon:raz.join(" · ")||"sin coincidencia"}
        }).filter(m=>m.saldo>0.01).sort((a,b)=>b.score-a.score).slice(0,60)
        if(!cancel)setCands(scored)
        // Combinaciones: solo entre candidatos del mismo grupo (score>=40 o mismo proveedor G66)
        const grupo=scored.filter(m=>m.score>=30||(m.fuente==='global66'&&m.proveedor_id&&hito.oc.proveedor_id&&m.proveedor_id===hito.oc.proveedor_id))
        if(!cancel)setCombos(grupo.length>=2?buscarCombosConc(pendiente,grupo):[])
      }catch(e){alert("Error cargando candidatos: "+e.message)}finally{if(!cancel)setLoading(false)}
    })()
    return()=>{cancel=true}
  },[hito,esUSD,pendiente,provs])

  const vincular=async(m)=>{
    const sug=Math.min(pendiente,m.saldo)
    const inp=window.prompt(`Monto a aplicar (${esUSD?"USD":"CLP"}).\n\nPendiente cuota: ${esUSD?fUD(pendiente,2):fmt(pendiente)}\nSaldo egreso: ${esUSD?fUD(m.saldo,2):fmt(m.saldo)}`,esUSD?String(sug):String(Math.round(sug)))
    if(inp===null)return
    const monto=esUSD?Number(inp):Math.round(Number(inp))
    if(!monto||monto<=0){alert("Monto inválido");return}
    if(monto>m.saldo+(esUSD?0.01:1)){alert("Supera el saldo del egreso");return}
    setSaving(true)
    try{
      const{data:sess}=await supabase.auth.getSession()
      const fila={pago_id:hito.pago_id,monto_aplicado:monto,asignado_por:sess?.session?.user?.id||null}
      if(m.fuente==='global66')fila.global66_mov_id=m.id;else fila.movimiento_id=m.id
      const{error}=await supabase.from('conciliacion_pago_mov').insert(fila)
      if(error)throw error
      onVinculado()
    }catch(e){alert("Error: "+e.message)}finally{setSaving(false)}
  }

  const vincularGrupo=async(grupo)=>{
    const fmtMon=esUSD?(v=>fUD(v,2)):fmt
    const suma=grupo.reduce((s,g)=>s+g.saldo,0)
    const det=grupo.map(g=>`• ${g.fecha} · ${(g.label||"").slice(0,35)} → ${fmtMon(g.saldo)}`).join("\n")
    if(!window.confirm(`Vincular ${grupo.length} egresos a ${hito.oc_id}:\n\n${det}\n\nSuma: ${fmtMon(suma)}\nPendiente: ${fmtMon(pendiente)}\n\n¿Confirmar?`))return
    setSaving(true)
    try{
      const{data:sess}=await supabase.auth.getSession()
      const uid=sess?.session?.user?.id||null
      for(const g of grupo){
        const fila={pago_id:hito.pago_id,monto_aplicado:g.saldo,asignado_por:uid}
        if(g.fuente==='global66')fila.global66_mov_id=g.id;else fila.movimiento_id=g.id
        const{error}=await supabase.from('conciliacion_pago_mov').insert(fila)
        if(error)throw error
      }
      onVinculado()
    }catch(e){alert("Error: "+e.message)}finally{setSaving(false)}
  }

  return<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(4px)",zIndex:2000,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"8px 20px 32px",width:"100%",maxWidth:560,maxHeight:"90vh",overflowY:"auto"}}>
      <div style={{width:36,height:4,borderRadius:2,background:"#E5E7EB",margin:"0 auto 12px"}}/>
      <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>🔗 Conciliar con cartola</div>
      <div style={{fontSize:12,color:"#6E6E73",marginBottom:4}}>{hito.label} · {hito.oc_id} · {hito.prov?.nombre}</div>
      <div style={{fontSize:12,marginBottom:14}}>Circuito: <b style={{color:esUSD?"#7C3AED":"#15803D"}}>{esUSD?"Global66 (USD)":"Santander (CLP)"}</b> · Pendiente: <b>{esUSD?fUD(pendiente,2):fmt(pendiente)}</b></div>
      {!loading&&combos.length>0&&<div style={{marginBottom:14,padding:10,background:"#EFF6FF",borderRadius:10,border:"1px solid #BFDBFE"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#1D4ED8",marginBottom:8}}>💡 Pagos en varias transferencias que suman esta cuota:</div>
        {combos.map((c,ci)=>{
          const fmtMon=esUSD?(v=>fUD(v,2)):fmt
          return<div key={ci} style={{background:"#fff",borderRadius:8,padding:8,marginBottom:6,border:"0.5px solid #BFDBFE"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:700,color:"#1D4ED8"}}>{c.grupo.length} transferencias · {fmtMon(c.suma)} · ±{c.span}d</span>
              <Bt sm v="pri" onClick={()=>vincularGrupo(c.grupo)} dis={saving}>✓ vincular grupo</Bt>
            </div>
            {c.grupo.map((g,gi)=><div key={gi} style={{fontSize:12,color:"#6E6E73",paddingLeft:4}}>• {g.fecha} · {(g.label||"").slice(0,38)} → {fmtMon(g.saldo)}</div>)}
          </div>
        })}
      </div>}
      {loading?<div style={{textAlign:"center",padding:30,color:"#6E6E73"}}>Cargando candidatos…</div>:
       cands.length===0?<div style={{textAlign:"center",padding:30,color:"#6E6E73"}}>Sin egresos disponibles en {esUSD?"Global66":"Santander"}.</div>:
       <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {cands.map(m=>{
          const cc=m.nivel==="alto"?"#1E7A44":m.nivel==="medio"?"#B25E09":"#6E6E73"
          return<div key={m.id} style={{border:"1px solid #E5E7EB",borderRadius:10,padding:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
              <span style={{fontSize:12,fontWeight:700}}>{m.fecha}</span>
              <span style={{fontSize:13,fontWeight:700}}>{esUSD?fUD(m.montoComp,2):fmt(m.montoComp)}</span>
            </div>
            <div style={{fontSize:12,color:"#6E6E73",margin:"2px 0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.label}</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
              <span style={{fontSize:12,background:cc+"15",color:cc,padding:"2px 8px",borderRadius:6,fontWeight:700}}>{m.nivel} · {m.razon}</span>
              <Bt sm v="pri" onClick={()=>vincular(m)} dis={saving}>🔗 vincular</Bt>
            </div>
          </div>
        })}
       </div>}
    </div>
  </div>
}

/* ═══ FINANZAS v2 ═══ */
function FinanzasView({ocs,provs,pagos,setPagos,config={},cu,h:hp}){
  const TC_USD=Number(config.tc_usd)||950
  const isFinAdmin=cu&&["admin","dir_general","dir_finanzas"].includes(cu.rol)
  const canPay=cu&&(isFinAdmin||["analista"].includes(cu.rol))

  // ─── Estados generales ───────────────────────────────────────
  const[vista,setVista]=useLocalState("fin_vista","timeline")
  const[filtroProv,setFiltroProv]=useLocalState("fin_prov","")
  const[filtroTipo,setFiltroTipo]=useLocalState("fin_tipo","")
  const[filtroEstadoPago,setFiltroEstadoPago]=useLocalState("fin_ep","todos")
  const[q,setQ]=useLocalState("fin_q","")
  const[loading,setLoading]=useState(false)

  // ─── Conciliación bancaria ───────────────────────────────────
  const[concVinculos,setConcVinculos]=useState([])   // conciliacion_pago_mov
  const[concMovs,setConcMovs]=useState(new Map())     // id → {fecha,monto,desc,fuente}
  const[detalleConc,setDetalleConc]=useState(null)    // pago_id con detalle abierto
  const[concModal,setConcModal]=useState(null)        // hito al que vincular
  const[facturaModal,setFacturaModal]=useState(null)  // OC cuyas facturas del libro se ven/vinculan
  const[concReload,setConcReload]=useState(0)

  const cargarConciliacion=useCallback(async()=>{
    const{data:vinc}=await supabase.from('conciliacion_pago_mov').select('id,pago_id,movimiento_id,global66_mov_id,monto_aplicado,asignado_at')
    if(!vinc){setConcVinculos([]);return}
    setConcVinculos(vinc)
    const movIds=[...new Set(vinc.map(v=>v.movimiento_id).filter(Boolean))]
    const g66Ids=[...new Set(vinc.map(v=>v.global66_mov_id).filter(Boolean))]
    const m=new Map()
    if(movIds.length){
      const{data:ms}=await supabase.from('movimientos_bancarios').select('id,fecha,monto,descripcion').in('id',movIds)
      for(const x of ms||[])m.set(x.id,{fecha:x.fecha,monto:Math.abs(x.monto),desc:x.descripcion,fuente:'Santander'})
    }
    if(g66Ids.length){
      const{data:gs}=await supabase.from('global66_movimientos').select('id,fecha_transaccion,monto_usd,tercero_nombre,comentario').in('id',g66Ids)
      for(const x of gs||[])m.set(x.id,{fecha:x.fecha_transaccion?String(x.fecha_transaccion).slice(0,10):"",monto:x.monto_usd,desc:`${x.tercero_nombre||""}${x.comentario?" · "+x.comentario:""}`,fuente:'Global66',usd:true})
    }
    setConcMovs(m)
  },[])
  useEffect(()=>{cargarConciliacion()},[cargarConciliacion,concReload])

  // ─── Modal pago ───────────────────────────────────────────────
  const[pagoModal,setPagoModal]=useState(null)
  const[editModal,setEditModal]=useState(null)   // pago ya ejecutado a editar
  const[pagoForm,setPagoForm]=useState({fecha:hoy(),monto:"",obs:"",file:null,fileName:"",uploading:false})
  const[editForm,setEditForm]=useState({fecha:"",monto:"",obs:"",file:null,fileName:""})

  // ─── ⭐ Datos para la grilla única: facturas del libro + documentos por OC ───
  const[facturasPorOC,setFacturasPorOC]=useState(new Map())
  const[docsPorOC,setDocsPorOC]=useState(new Map())
  const[sortG,setSortG]=useState({k:"fecha_proy",dir:1})
  useEffect(()=>{(async()=>{
    const{data:facs}=await supabase.from('libro_compras').select('id,folio,monto_total,oc_id,anulado').not('oc_id','is',null).limit(20000)
    const fm=new Map()
    for(const f of(facs||[])){if(f.anulado)continue;if(!fm.has(f.oc_id))fm.set(f.oc_id,[]);fm.get(f.oc_id).push(f)}
    setFacturasPorOC(fm)
    const{data:docs}=await supabase.from('documentos_import').select('id,oc_id,nombre_archivo,tipo_documento').limit(20000) // ⭐ sin url_archivo: los base64 de MB saturan la BD; se traen on-demand al click
    const dm=new Map()
    for(const d of(docs||[])){if(!d.oc_id)continue;if(!dm.has(d.oc_id))dm.set(d.oc_id,[]);dm.get(d.oc_id).push(d)}
    setDocsPorOC(dm)
  })()},[concReload])

  // ─── OCs activas ─────────────────────────────────────────────
  const aprobadas=ocs.filter(o=>!["Cerrada","Rechazada","Anulada","Borrador","Pend. Dir. Negocios","Dividida","Fusionada"].includes(o.estado))

  // ─── Helpers ────────────────────────────────────────────────
  const enCLP=h=>h.moneda==="USD"?h.monto*TC_USD:h.monto
  const diff=d=>{if(!d)return 999;const hd=new Date(hoy()),dd=new Date(d);return Math.round((dd-hd)/(1000*60*60*24))}
  const addDias=(d,n)=>{if(!d)return null;const x=new Date(d);x.setDate(x.getDate()+n);return x.toISOString().slice(0,10)}

  // ─── Hitos calculados ────────────────────────────────────────
  const hitos=useMemo(()=>{
    const out=[]
    aprobadas.forEach(oc=>{
      const pv=provs.find(p=>p.id===oc.proveedor_id)
      const pagosOC=pagos.filter(p=>p.oc_id===oc.id)
      // Moneda: priorizar la OC (Importación con total_usd > 0 → USD), fallback al proveedor
      const moneda=(oc.tipo_oc==="Importación"&&(oc.total_usd||0)>0)?"USD":(pv?.moneda||"CLP")
      const totalRef=moneda==="USD"?(oc.total_usd||0):(oc.total_clp||0)

      const programados=pagosOC.filter(p=>p.fecha_programada||p.orden)
      if(programados.length>0){
        programados.sort((a,b)=>(a.orden||0)-(b.orden||0))
        programados.forEach(p=>{
          // Pagos parciales del mismo hito
          const parciales=pagosOC.filter(px=>px.hito_padre_id===p.id||px.id===p.id)
          const montoPagado=parciales.filter(px=>px.estado==="Pagado").reduce((s,px)=>s+(px.monto||0),0)
          const pagado=montoPagado>=(p.monto||0)*0.99
          const parcial=montoPagado>0&&!pagado
          out.push({
            oc_id:oc.id,oc,prov:pv,
            hito:p.etapa||p.concepto?.toLowerCase().replace(/\s+/g,"_")||"pago",
            label:p.concepto||"Pago",
            pct:p.pct||100,
            monto:p.monto||0,
            montoPagado,
            montoPendiente:Math.max(0,(p.monto||0)-montoPagado),
            moneda:p.moneda||moneda,
            fecha_proy:p.fecha_programada||p.fecha_pago||oc.fecha_creacion,
            pagado,parcial,
            fecha_real:pagado?parciales.find(px=>px.estado==="Pagado")?.fecha_pago:null,
            pago_id:p.id,
            pagosRelacionados:parciales
          })
        })
      }else{
        if(oc.tipo_oc==="Importación"){
          const pctF=oc.pct_fab||pv?.pct_fabricacion||0
          const pctE=oc.pct_embarque||pv?.pct_embarque||0
          const pctP=oc.pct_puerto||pv?.pct_puerto||0
          const mkHito=(hito,label,pct,fecha_proy)=>{
            const monto=totalRef*pct/100
            const pagHito=pagosOC.filter(p=>p.etapa===hito||p.concepto?.toLowerCase().includes(label.split(" ")[1]?.toLowerCase()||""))
            const montoPagado=pagHito.filter(p=>p.estado==="Pagado").reduce((s,p)=>s+(p.monto||0),0)
            const pagado=montoPagado>=monto*0.99
            const parcial=montoPagado>0&&!pagado
            return{oc_id:oc.id,oc,prov:pv,hito,label,pct,monto,montoPagado,montoPendiente:Math.max(0,monto-montoPagado),moneda,fecha_proy,pagado,parcial,fecha_real:pagado?pagHito.find(p=>p.estado==="Pagado")?.fecha_pago:null,pago_id:pagHito[0]?.id||null,pagosRelacionados:pagHito}
          }
          if(pctF>0)out.push(mkHito("fabricacion","Pago fabricación",pctF,oc.fecha_creacion))
          if(pctE>0)out.push(mkHito("embarque","Pago embarque",pctE,oc.etd||addDias(oc.fecha_creacion,45)))
          if(pctP>0)out.push(mkHito("puerto","Pago puerto",pctP,oc.eta||addDias(oc.fecha_creacion,75)))
        }else{
          const cond=(oc.condicion_pago||pv?.condicion_pago||"Contado").toString().toLowerCase()
          const dias=cond.includes("90")?90:cond.includes("60")?60:cond.includes("45")?45:cond.includes("30")?30:cond.includes("15")?15:0
          const fechaBase=oc.fecha_real_recepcion||oc.fecha_creacion
          const monto=totalRef
          const pagHito=pagosOC.filter(p=>p.estado==="Pagado")
          const montoPagado=pagHito.reduce((s,p)=>s+(p.monto||0),0)
          const pagado=montoPagado>=monto*0.99
          out.push({oc_id:oc.id,oc,prov:pv,hito:dias===0?"contado":`credito_${dias}`,label:dias===0?"Pago contado":`Crédito ${dias} días`,pct:100,monto,montoPagado,montoPendiente:Math.max(0,monto-montoPagado),moneda,fecha_proy:dias===0?oc.fecha_creacion:addDias(fechaBase,dias),pagado,parcial:montoPagado>0&&!pagado,fecha_real:pagado?pagHito[0]?.fecha_pago:null,pago_id:pagHito[0]?.id||null,pagosRelacionados:pagHito})
        }
      }
    })
    return out
  },[aprobadas,pagos,provs])

  // ─── Mapa de conciliación por pago_id ────────────────────────
  const concPorPago=useMemo(()=>{
    const m=new Map()
    for(const v of concVinculos){
      if(!m.has(v.pago_id))m.set(v.pago_id,{total:0,vinculos:[]})
      const e=m.get(v.pago_id)
      e.total+=Number(v.monto_aplicado)||0
      e.vinculos.push(v)
    }
    return m
  },[concVinculos])

  // ─── Filtrar hitos ───────────────────────────────────────────
  const hitosFil=useMemo(()=>hitos.filter(h=>{
    if(filtroProv&&h.prov?.id!==filtroProv)return false
    if(filtroTipo&&h.oc.tipo_oc!==filtroTipo)return false
    if(filtroEstadoPago==="pendientes"&&h.pagado)return false
    if(filtroEstadoPago==="pagados"&&!h.pagado)return false
    if(q){const qx=q.toLowerCase();if(!h.oc_id.toLowerCase().includes(qx)&&!(h.prov?.nombre||"").toLowerCase().includes(qx))return false}
    return true
  }),[hitos,filtroProv,filtroTipo,filtroEstadoPago,q])

  const pendientes=hitosFil.filter(h=>!h.pagado)
  const vencidos=pendientes.filter(h=>diff(h.fecha_proy)<0)
  const prox30=pendientes.filter(h=>{const d=diff(h.fecha_proy);return d>=0&&d<=30})
  const totalPend=pendientes.reduce((s,h)=>s+enCLP(h),0)
  const totalVenc=vencidos.reduce((s,h)=>s+enCLP(h),0)
  const totalUSD=pendientes.filter(h=>h.moneda==="USD").reduce((s,h)=>s+h.monto,0)

  // ─── Semanas para timeline ────────────────────────────────────
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

  // ─── Agrupar por OC ──────────────────────────────────────────
  const porOC=useMemo(()=>{
    const map={}
    hitosFil.forEach(h=>{
      if(!map[h.oc_id])map[h.oc_id]={oc:h.oc,prov:h.prov,hitos:[]}
      map[h.oc_id].hitos.push(h)
    })
    return Object.values(map).sort((a,b)=>{
      const aVenc=a.hitos.some(h=>!h.pagado&&diff(h.fecha_proy)<0)
      const bVenc=b.hitos.some(h=>!h.pagado&&diff(h.fecha_proy)<0)
      if(aVenc&&!bVenc)return -1;if(!aVenc&&bVenc)return 1
      return 0
    })
  },[hitosFil])

  // ─── Refresh ─────────────────────────────────────────────────
  const refresh=async()=>{
    setLoading(true)
    const{data}=await supabase.from('pagos').select('*')
    if(data)setPagos(data)
    setLoading(false)
  }

  // ─── Abrir modal pagar ───────────────────────────────────────
  const abrirPago=(h)=>{
    setPagoModal(h)
    setPagoForm({fecha:hoy(),monto:h.moneda==="USD"?h.montoPendiente.toFixed(2):h.montoPendiente.toFixed(0),obs:"",file:null,fileName:"",uploading:false})
  }

  // ─── Confirmar pago ──────────────────────────────────────────
  const confirmarPago=async()=>{
    const h=pagoModal
    if(!pagoForm.file){alert("⚠ Adjuntá un comprobante de pago (obligatorio)");return}
    if(!pagoForm.fecha){alert("⚠ Falta la fecha de pago");return}
    const montoReal=parseFloat(pagoForm.monto)
    if(!montoReal||montoReal<=0){alert("⚠ El monto debe ser mayor a 0");return}
    setPagoForm(p=>({...p,uploading:true}))
    try{
      const ext=pagoForm.fileName.split(".").pop()||"pdf"
      const san=s=>(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"_")
      const path=`${san(h.oc_id)}/${san(h.hito)}_${Date.now()}.${ext}`
      const{error:upErr}=await supabase.storage.from('comprobantes').upload(path,pagoForm.file,{upsert:true})
      if(upErr){alert("Error subiendo archivo: "+upErr.message);setPagoForm(p=>({...p,uploading:false}));return}
      const{data:urlData}=supabase.storage.from('comprobantes').getPublicUrl(path)
      const compUrl=urlData?.publicUrl||""
      const esParcial=montoReal<(h.monto||0)*0.99
      // Si ya hay pago y es parcial, crear nuevo registro hijo
      if(h.pago_id&&esParcial){
        const np={id:uid(),oc_id:h.oc_id,concepto:h.label+" (parcial)",monto:montoReal,moneda:h.moneda,fecha_pago:pagoForm.fecha,estado:"Pagado",etapa:h.hito,hito_padre_id:h.pago_id,es_parcial:true,comprobante_url:compUrl,comprobante_nombre:pagoForm.fileName,observaciones_pago:pagoForm.obs||null,aprobado_por:cu?.id}
        await supabase.from('pagos').insert(np)
        setPagos(prev=>[...prev,np])
      }else if(h.pago_id){
        await supabase.from('pagos').update({estado:"Pagado",fecha_pago:pagoForm.fecha,monto:montoReal,comprobante_url:compUrl,comprobante_nombre:pagoForm.fileName,observaciones_pago:pagoForm.obs||null,es_parcial:esParcial}).eq('id',h.pago_id)
        setPagos(prev=>prev.map(p=>p.id===h.pago_id?{...p,estado:"Pagado",fecha_pago:pagoForm.fecha,monto:montoReal,comprobante_url:compUrl,comprobante_nombre:pagoForm.fileName,es_parcial:esParcial}:p))
      }else{
        const np={id:uid(),oc_id:h.oc_id,concepto:h.label,monto:montoReal,moneda:h.moneda,fecha_pago:pagoForm.fecha,estado:"Pagado",etapa:h.hito,es_parcial:esParcial,comprobante_url:compUrl,comprobante_nombre:pagoForm.fileName,observaciones_pago:pagoForm.obs||null,aprobado_por:cu?.id}
        await supabase.from('pagos').insert(np)
        setPagos(prev=>[...prev,np])
      }
      await supabase.from('documentos_import').insert({id:uid(),oc_id:h.oc_id,tipo:`comprobante_pago_${h.hito}`,nombre_archivo:pagoForm.fileName,url:compUrl,descripcion:`Comprobante: ${h.label} — ${h.moneda} ${fN(montoReal)} — ${pagoForm.fecha}${pagoForm.obs?` — ${pagoForm.obs}`:""}`})
      setPagoModal(null)
    }catch(e){alert("Error inesperado: "+e.message)}
    setPagoForm(p=>({...p,uploading:false}))
  }

  // ─── Abrir modal editar ──────────────────────────────────────
  const abrirEditar=(p)=>{
    setEditModal(p)
    setEditForm({fecha:p.fecha_pago||hoy(),monto:String(p.monto||""),obs:p.observaciones_pago||"",file:null,fileName:""})
  }

  // ─── Guardar edición ─────────────────────────────────────────
  const guardarEdicion=async()=>{
    if(!editModal)return
    const montoNuevo=parseFloat(editForm.monto)
    if(!montoNuevo||montoNuevo<=0){alert("⚠ El monto debe ser mayor a 0");return}
    const cambiaMonto=montoNuevo!==(editModal.monto||0)
    if(cambiaMonto&&!editForm.file){alert("⚠ Si cambiás el monto debés adjuntar un nuevo comprobante");return}
    try{
      // Guardar historial
      const histAnterior=editModal.historial_edicion||[]
      const nuevoHist=[...histAnterior,{fecha:hoy(),hora:hora(),editado_por:cu?.nombre,monto_anterior:editModal.monto,fecha_anterior:editModal.fecha_pago,obs_anterior:editModal.observaciones_pago}]
      const upd={monto:montoNuevo,fecha_pago:editForm.fecha,observaciones_pago:editForm.obs||null,editado_por:cu?.nombre,fecha_edicion:new Date().toISOString(),historial_edicion:nuevoHist}
      if(cambiaMonto&&editForm.file){
        const ext=editForm.fileName.split(".").pop()||"pdf"
        const san=s=>(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9._-]/g,"_")
        const path=`${san(editModal.oc_id)}/edit_${Date.now()}.${ext}`
        const{error:upErr}=await supabase.storage.from('comprobantes').upload(path,editForm.file,{upsert:true})
        if(!upErr){const{data:urlData}=supabase.storage.from('comprobantes').getPublicUrl(path);upd.comprobante_url=urlData?.publicUrl||"";upd.comprobante_nombre=editForm.fileName}
      }
      await supabase.from('pagos').update(upd).eq('id',editModal.id)
      setPagos(prev=>prev.map(p=>p.id===editModal.id?{...p,...upd}:p))
      setEditModal(null)
    }catch(e){alert("Error: "+e.message)}
  }

  // ─── Fila de hito compartida ─────────────────────────────────
  const HRow=({h,compact=false})=>{
    const d=diff(h.fecha_proy)
    const pct=h.monto>0?Math.round(h.montoPagado/h.monto*100):0
    const color=h.pagado?"#1E7A44":d<0?"#B42318":d<=7?"#B25E09":"#1D4E89"
    return<div style={{display:"flex",alignItems:"center",gap:10,padding:compact?"8px 10px":"10px 14px",background:"#fff",borderRadius:10,border:`1px solid ${h.pagado?"#1E7A4430":d<0?"#B4231830":"#E5E7EB"}`,borderLeft:`3px solid ${color}`,marginBottom:6}}>
      <div style={{minWidth:32,textAlign:"center",fontSize:16}}>{h.pagado?"✅":h.parcial?"🔸":d<0?"🔴":d<=7?"🟡":"🔵"}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:2}}>
          <span style={{fontSize:12,fontWeight:700}}>{h.label}</span>
          <Bd c={color} bg={color+"15"}>{h.pct}%</Bd>
          {h.parcial&&<Bd c="#B25E09" bg="#B25E0915">Parcial {pct}%</Bd>}
          {!compact&&<span style={{fontSize:11,color:"#6E6E73",fontFamily:"monospace"}}>{h.oc_id}</span>}
        </div>
        {!compact&&<div style={{fontSize:12,color:"#6E6E73"}}>{h.prov?.nombre||h.oc.proveedor_id}</div>}
        <div style={{display:"flex",gap:10,marginTop:2,flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:"#6E6E73"}}>📅 {h.fecha_proy}</span>
          {h.pagado&&h.fecha_real&&<span style={{fontSize:12,color:"#1E7A44"}}>✓ Pagado {h.fecha_real}</span>}
          {!h.pagado&&<span style={{fontSize:12,color:d<0?"#B42318":d<=7?"#B25E09":"#6E6E73"}}>{d<0?`Vencido hace ${Math.abs(d)}d`:d===0?"Vence hoy":`En ${d} días`}</span>}
        </div>
        {/* Barra de progreso para pagos parciales */}
        {(h.parcial||h.montoPagado>0)&&<div style={{marginTop:4,height:4,background:"#F4F5F7",borderRadius:2,overflow:"hidden"}}>
          <div style={{height:"100%",width:pct+"%",background:h.pagado?"#1E7A44":"#B25E09",borderRadius:2,transition:"width 0.3s"}}/>
        </div>}
      </div>
      <div style={{textAlign:"right",minWidth:90}}>
        <div style={{fontSize:13,fontWeight:700,color:"#1C1C1E"}}>{h.moneda==="USD"?fUD(h.monto,2):fmt(h.monto)}</div>
        {h.parcial&&<div style={{fontSize:11,color:"#B25E09"}}>Pend: {h.moneda==="USD"?fUD(h.montoPendiente,2):fmt(h.montoPendiente)}</div>}
      </div>
      <div style={{display:"flex",gap:4,flexDirection:"column"}}>
        {!h.pagado&&canPay&&<Bt sm v="suc" onClick={()=>abrirPago(h)}>✓ Pagar</Bt>}
        {h.parcial&&canPay&&<Bt sm v="amb" onClick={()=>abrirPago(h)}>+ Parcial</Bt>}
        {h.pagado&&isFinAdmin&&<Bt sm v="gry" onClick={()=>abrirEditar(h.pagosRelacionados?.[0]||{id:h.pago_id,oc_id:h.oc_id,monto:h.montoPagado,fecha_pago:h.fecha_real,observaciones_pago:""})}>✏</Bt>}
        {h.pagosRelacionados?.[0]?.comprobante_url&&<a href={h.pagosRelacionados[0].comprobante_url} target="_blank" rel="noreferrer" style={{fontSize:11,color:"#1D4E89",textDecoration:"none",textAlign:"center"}}>📎</a>}
      </div>
    </div>
  }

  // ─── Export CSV ───────────────────────────────────────────────
  const exportCSV=()=>{
    const head=["OC","Tipo","Proveedor","Hito","%","Monto","Moneda","Pagado","Pagado Acum","Pendiente","Fecha Proyectada","Días","Fecha Pago","Estado"]
    const rows=hitosFil.map(h=>[h.oc_id,h.oc.tipo_oc,h.prov?.nombre||h.oc.proveedor_id,h.label,h.pct+"%",h.monto.toFixed(0),h.moneda,h.montoPagado.toFixed(0),h.monto.toFixed(0),h.montoPendiente.toFixed(0),h.fecha_proy,diff(h.fecha_proy),h.fecha_real||"",h.pagado?"Pagado":h.parcial?"Parcial":"Pendiente"])
    const csv=[head,...rows].map(r=>r.join(",")).join("\n")
    const a=document.createElement("a");a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);a.download="finanzas_pagos.csv";a.click()
  }

  return<div>
    {/* ─── Header ─── */}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,flexWrap:"wrap",gap:8}}>
      <div>
        <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em"}}>💰 Control de Pagos</div>
        <div style={{fontSize:13,color:"#6E6E73"}}>{aprobadas.length} OC activas · {pendientes.length} pagos pendientes · {fmt(totalPend)} comprometido{totalUSD>0?` (incluye ${fU(totalUSD)} USD)`:""}</div>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        <button onClick={refresh} disabled={loading} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:600,border:"1px solid #E5E7EB",background:"#fff",cursor:"pointer",color:"#1C1C1E"}}>
          {loading?"⏳":"↻"} Actualizar
        </button>
        <button onClick={exportCSV} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:600,border:"1px solid #1E7A44",background:"#1E7A4410",cursor:"pointer",color:"#1E7A44"}}>📊 CSV</button>
      </div>
    </div>

    {/* ─── KPIs ─── */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:16}}>
      {[
        {l:"Total pendiente",v:fmt(totalPend),c:"#B42318",ic:"💸"},
        {l:"Vencidos",v:fmt(totalVenc),c:vencidos.length>0?"#B42318":"#1E7A44",ic:"⚠️",cnt:vencidos.length},
        {l:"Próx. 30 días",v:fmt(prox30.reduce((s,h)=>s+enCLP(h),0)),c:"#B25E09",ic:"📅",cnt:prox30.length},
        {l:"OCs activas",v:aprobadas.length,c:"#1D4E89",ic:"📦",raw:true},
        {l:"Pagados (total)",v:fmt(pagos.filter(p=>p.estado==="Pagado").reduce((s,p)=>s+((p.monto||0)*(p.moneda==="USD"?TC_USD:1)),0)),c:"#1E7A44",ic:"✅"},
      ].map((k,i)=><div key={i} style={{background:"#fff",borderRadius:12,padding:"12px 14px",border:"1px solid #E5E7EB",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{fontSize:11,color:"#6E6E73",fontWeight:600,marginBottom:4,textTransform:"uppercase"}}>{k.ic} {k.l}</div>
        <div style={{fontSize:18,fontWeight:800,color:k.c}}>{k.raw?k.v:k.v}</div>
        {k.cnt!==undefined&&<div style={{fontSize:11,color:"#6E6E73"}}>{k.cnt} hito{k.cnt!==1?"s":""}</div>}
      </div>)}
    </div>

    {/* ─── Filtros ─── */}
    <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar OC o proveedor..." style={{...css.input,width:200,fontSize:12,padding:"6px 10px"}}/>
      <select value={filtroProv} onChange={e=>setFiltroProv(e.target.value)} style={{...css.select,fontSize:12,padding:"6px 10px",maxWidth:200}}>
        <option value="">Todos los proveedores</option>
        {[...new Set(hitos.map(h=>h.oc.proveedor_id))].map(pid=>{const pv=provs.find(p=>p.id===pid);return<option key={pid} value={pid}>{pv?.nombre||pid}</option>})}
      </select>
      <select value={filtroTipo} onChange={e=>setFiltroTipo(e.target.value)} style={{...css.select,fontSize:12,padding:"6px 10px",width:170}}>
        <option value="">Todos los tipos</option>
        <option value="Importación">🔴 Importación</option>
        <option value="Nacional">🔵 Nacional</option>
      </select>
      <select value={filtroEstadoPago} onChange={e=>setFiltroEstadoPago(e.target.value)} style={{...css.select,fontSize:12,padding:"6px 10px",width:170}}>
        <option value="todos">Todos los estados</option>
        <option value="pendientes">Solo pendientes</option>
        <option value="pagados">Solo pagados</option>
      </select>
      {(q||filtroProv||filtroTipo||filtroEstadoPago!=="todos")&&<button onClick={()=>{setQ("");setFiltroProv("");setFiltroTipo("");setFiltroEstadoPago("todos")}} style={{padding:"6px 10px",borderRadius:8,fontSize:12,fontWeight:600,border:"1px solid #B42318",background:"#B4231810",color:"#B42318",cursor:"pointer"}}>✕ Limpiar</button>}
    </div>

    {/* ─── ⭐ GRILLA ÚNICA — Órdenes por pagar (estilo Excel) ─── */}
    {(()=>{
      const GCOLS=[
        {k:"oc_id",l:"OC",align:"left"},{k:"tipo",l:"Tipo",align:"left"},{k:"prov_nombre",l:"Proveedor",align:"left"},
        {k:"condicion",l:"Cond. pago",align:"left"},{k:"label",l:"Hito/Cuota",align:"left"},{k:"pct",l:"%",align:"right"},
        {k:"monto",l:"Monto",align:"right"},{k:"montoPagado",l:"Pagado",align:"right"},{k:"montoPendiente",l:"Pendiente",align:"right"},
        {k:"moneda",l:"Mon.",align:"center"},{k:"fecha_proy",l:"F. compromiso",align:"right"},{k:"dias",l:"Días",align:"right"},
        {k:"estadoTxt",l:"Estado",align:"center"},{k:"concPct",l:"Conciliación",align:"center"},
        {k:"facturas",l:"Factura(s)",align:"left"},{k:"docs",l:"Documentos",align:"left"},{k:"acc",l:"Acciones",align:"center"}
      ]
      const rows=hitosFil.map(h=>{
        const d=diff(h.fecha_proy)
        const ci=concPorPago.get(h.pago_id)
        const concTotal=ci?.total||0
        const concPct=h.monto>0?Math.min(100,Math.round(concTotal/h.monto*100)):0
        const facs=facturasPorOC.get(h.oc_id)||[]
        const docs=docsPorOC.get(h.oc_id)||[]
        return{...h,tipo:h.oc?.tipo_oc==="Importación"?"IMP":"NAC",prov_nombre:h.prov?.nombre||h.oc?.proveedor_id||"",
          condicion:h.oc?.condicion_pago||h.prov?.condicion_pago||"Contado",dias:d,
          estadoTxt:h.pagado?"Pagado":h.parcial?"Parcial":d<0?"Vencido":"Pendiente",concPct,concTotal,facs,docs}
      })
      const sv=(r,k)=>{
        if(k==="monto"||k==="montoPagado"||k==="montoPendiente")return enCLP({...r,monto:r[k]})
        if(k==="facturas")return r.facs.length
        if(k==="docs")return r.docs.length
        if(k==="concPct")return r.concPct
        return r[k]??""
      }
      const sorted=[...rows].sort((a,b)=>{const x=sv(a,sortG.k),y=sv(b,sortG.k);if(typeof x==="number"&&typeof y==="number")return(x-y)*sortG.dir;return String(x).localeCompare(String(y),"es")*sortG.dir})
      const expXLSX=()=>{
        try{
          const data=sorted.map(r=>({OC:r.oc_id,Tipo:r.tipo,Proveedor:r.prov_nombre,Condicion_pago:r.condicion,Hito:r.label,Pct:r.pct,
            Monto:r.monto,Pagado:r.montoPagado,Pendiente:r.montoPendiente,Moneda:r.moneda,Fecha_compromiso:r.fecha_proy||"",
            Dias:r.dias===999?"":r.dias,Estado:r.estadoTxt,Conciliacion_pct:r.concPct,
            Facturas:r.facs.map(f=>`${f.folio} (${fmt(f.monto_total)})`).join(" · "),
            Documentos:r.docs.map(dc=>dc.nombre_archivo||dc.tipo_documento).join(" · ")}))
          const ws=XLSX.utils.json_to_sheet(data);const wb=XLSX.utils.book_new()
          XLSX.utils.book_append_sheet(wb,ws,"Ordenes por pagar")
          XLSX.writeFile(wb,`Ordenes_por_pagar_${hoy()}.xlsx`)
        }catch(e){alert("Error exportando: "+(e?.message||e))}
      }
      return<div style={{background:"#fff",borderRadius:12,border:"1px solid #E5E7EB",overflow:"hidden"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderBottom:"1px solid #F4F5F7"}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1C1C1E"}}>📋 Órdenes por pagar — grilla completa</div>
          <Bt sm v="gry" onClick={expXLSX} ic="📊">Exportar Excel</Bt>
        </div>
        <div style={{overflowX:"auto",maxHeight:"70vh",overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:1450}}>
            <thead><tr style={{background:"#F4F5F7",position:"sticky",top:0,zIndex:2}}>
              {GCOLS.map(c=><th key={c.k} onClick={()=>c.k!=="acc"&&setSortG(s=>({k:c.k,dir:s.k===c.k?-s.dir:1}))} style={{padding:"8px 10px",textAlign:c.align,fontSize:11,fontWeight:700,color:sortG.k===c.k?"#1D4E89":"#6E6E73",borderBottom:"2px solid #E5E7EB",whiteSpace:"nowrap",cursor:c.k!=="acc"?"pointer":"default",userSelect:"none",background:"#F4F5F7"}}>{c.l}{sortG.k===c.k?(sortG.dir>0?" ↑":" ↓"):""}</th>)}
            </tr></thead>
            <tbody>{sorted.map((r,i)=>{
              const color=r.pagado?"#1E7A44":r.dias<0?"#B42318":r.dias<=7?"#B25E09":"#6E6E73"
              return<Fragment key={r.pago_id||r.oc_id+"-"+i}>
              <tr style={{borderBottom:"1px solid #F4F5F7",background:i%2===0?"#fff":"#FAFAFA"}}>
                <td style={{padding:"6px 10px",fontFamily:"monospace",fontWeight:700,fontSize:12,whiteSpace:"nowrap"}}>{r.oc_id}</td>
                <td style={{padding:"6px 10px"}}><Bd c={r.tipo==="IMP"?"#B42318":"#1D4E89"} bg={(r.tipo==="IMP"?"#B42318":"#1D4E89")+"15"}>{r.tipo}</Bd></td>
                <td style={{padding:"6px 10px",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.prov_nombre}>{r.prov_nombre}</td>
                <td style={{padding:"6px 10px",fontSize:12,whiteSpace:"nowrap"}}>{r.condicion}</td>
                <td style={{padding:"6px 10px",fontWeight:600,whiteSpace:"nowrap"}}>{r.label}</td>
                <td style={{padding:"6px 10px",textAlign:"right"}}>{r.pct}%</td>
                <td style={{padding:"6px 10px",textAlign:"right",fontWeight:600,whiteSpace:"nowrap"}}>{r.moneda==="USD"?fUD(r.monto,2):fmt(r.monto)}</td>
                <td style={{padding:"6px 10px",textAlign:"right",color:"#1E7A44",fontWeight:600,whiteSpace:"nowrap"}}>{r.montoPagado>0?(r.moneda==="USD"?fUD(r.montoPagado,2):fmt(r.montoPagado)):"—"}</td>
                <td style={{padding:"6px 10px",textAlign:"right",color:r.montoPendiente>0?"#B42318":"#1E7A44",fontWeight:600,whiteSpace:"nowrap"}}>{r.montoPendiente>0?(r.moneda==="USD"?fUD(r.montoPendiente,2):fmt(r.montoPendiente)):"—"}</td>
                <td style={{padding:"6px 10px",textAlign:"center"}}><Bd c={r.moneda==="USD"?"#1E7A44":"#1D4E89"} bg={(r.moneda==="USD"?"#1E7A44":"#1D4E89")+"15"}>{r.moneda}</Bd></td>
                <td style={{padding:"6px 10px",textAlign:"right",whiteSpace:"nowrap"}}>{r.fecha_proy||"—"}</td>
                <td style={{padding:"6px 10px",textAlign:"right",color,fontWeight:600}}>{r.dias===999?"—":r.dias<0?`-${Math.abs(r.dias)}d`:r.dias===0?"Hoy":`+${r.dias}d`}</td>
                <td style={{padding:"6px 10px",textAlign:"center"}}><Bd c={color} bg={color+"15"}>{r.estadoTxt}</Bd></td>
                <td style={{padding:"6px 10px",textAlign:"center"}}>{r.concTotal>0?<button onClick={()=>setDetalleConc(detalleConc===r.pago_id?null:r.pago_id)} style={{background:(r.concPct>=100?"#1E7A44":"#B25E09")+"15",color:r.concPct>=100?"#1E7A44":"#B25E09",border:"none",borderRadius:6,padding:"2px 8px",fontSize:12,fontWeight:700,cursor:"pointer"}}>{r.concPct>=100?"✓ Conciliado":`◐ ${r.concPct}%`}</button>:<span style={{fontSize:12,color:"#C7C7CC"}}>—</span>}</td>
                <td style={{padding:"6px 10px",fontSize:12,maxWidth:160}}>{r.facs.length>0?r.facs.map((f,fi)=><div key={fi} style={{whiteSpace:"nowrap"}}>🧾 <b>{f.folio}</b> · {fmt(f.monto_total)}</div>):<span style={{color:"#C7C7CC"}}>—</span>}</td>
                <td style={{padding:"6px 10px",fontSize:12,maxWidth:200}}>{r.docs.length>0?r.docs.map((dc,di)=><div key={di} style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:190}}><a href="#" onClick={async(e)=>{e.preventDefault();let u=dc.url_archivo;if(!u&&dc.id){const{data,error}=await supabase.from('documentos_import').select('url_archivo').eq('id',dc.id).single();if(error){alert("No se pudo obtener: "+error.message);return}u=data?.url_archivo}if(!u){alert("Sin archivo");return}if(!u.startsWith("data:")){window.open(u,"_blank","noopener");return}try{const ci2=u.indexOf(",");const mime=u.slice(5,ci2).split(";")[0]||"application/octet-stream";const bin=atob(u.slice(ci2+1));const by=new Uint8Array(bin.length);for(let bx=0;bx<bin.length;bx++)by[bx]=bin.charCodeAt(bx);window.open(URL.createObjectURL(new Blob([by],{type:mime})),"_blank","noopener")}catch(er){alert("No se pudo abrir: "+er.message)}}} style={{color:"#1D4E89",textDecoration:"none"}} title={dc.nombre_archivo}>📎 {(dc.nombre_archivo||dc.tipo_documento||"doc").slice(0,24)}</a></div>):<span style={{color:"#C7C7CC"}}>—</span>}</td>
                <td style={{padding:"6px 10px",textAlign:"center"}}>
                  <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                    {!r.pagado&&canPay&&<Bt sm v="suc" onClick={()=>abrirPago(r)}>✓</Bt>}
                    {!r.pagado&&r.pago_id&&canPay&&<Bt sm v="pri" onClick={()=>setConcModal(r)}>🔗</Bt>}
                    <Bt sm v="pur" onClick={()=>{const oc=ocs.find(o=>o.id===r.oc_id);if(oc)setFacturaModal(oc)}}>🧾</Bt>
                    {r.pagado&&isFinAdmin&&<Bt sm v="gry" onClick={()=>abrirEditar(r.pagosRelacionados?.[0]||{id:r.pago_id,oc_id:r.oc_id,monto:r.montoPagado,fecha_pago:r.fecha_real})}>✏</Bt>}
                  </div>
                </td>
              </tr>
              {detalleConc===r.pago_id&&(()=>{
                const ci=concPorPago.get(r.pago_id)
                if(!ci)return null
                return<tr style={{background:"#F0F9FF"}}>
                  <td colSpan={17} style={{padding:"8px 16px"}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#1D4E89",marginBottom:6}}>🔗 Conciliado con movimientos de cartola:</div>
                    {ci.vinculos.map((v,vi)=>{
                      const mv=concMovs.get(v.movimiento_id||v.global66_mov_id)
                      return<div key={vi} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0",color:"#3A3A3C"}}>
                        <span>{mv?`${mv.fecha} · ${mv.fuente} · ${(mv.desc||"").slice(0,60)}`:(v.movimiento_id||v.global66_mov_id)}</span>
                        <span style={{fontWeight:700}}>{fmt(v.monto_aplicado)}</span>
                      </div>
                    })}
                  </td>
                </tr>
              })()}
              </Fragment>
            })}</tbody>
          </table>
        </div>
        <div style={{padding:"8px 14px",borderTop:"1px solid #F4F5F7",fontSize:12,color:"#6E6E73"}}>{sorted.length} registros · {pendientes.length} pendientes · {sorted.filter(r=>r.pagado).length} pagados · click en encabezados para ordenar</div>
      </div>
    })()}

    {/* ─── Modal Conciliar ─── */}
    {concModal&&<ModalConciliar hito={concModal} TC_USD={TC_USD} provs={provs} cu={cu}
      onClose={()=>setConcModal(null)}
      onVinculado={async()=>{
        setConcReload(x=>x+1)
        setConcModal(null)
        await refresh()  // recarga pagos: el trigger pudo cambiar estado→Pagado al conciliar 100%
      }}/>}

    {/* ─── Modal Facturas del libro (vincular OC↔factura↔banco) ─── */}
    {facturaModal&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.4)",backdropFilter:"blur(8px)",zIndex:1500,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={()=>setFacturaModal(null)}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"8px 20px 32px",width:"100%",maxWidth:680,maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{width:36,height:4,borderRadius:2,background:"#E5E7EB",margin:"0 auto 12px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
          <div style={{fontSize:18,fontWeight:700}}>{facturaModal.id}</div>
          <button onClick={()=>setFacturaModal(null)} style={{width:30,height:30,borderRadius:15,background:"#F4F5F7",border:"none",fontSize:14,cursor:"pointer",color:"#6E6E73"}}>✕</button>
        </div>
        <div style={{fontSize:12,color:"#6E6E73",marginBottom:8}}>{provs.find(p=>p.id===facturaModal.proveedor_id)?.nombre} · {fmt(facturaModal.total_clp)}</div>
        <OCFacturasLibro oc={facturaModal} prov={provs.find(p=>p.id===facturaModal.proveedor_id)} cu={cu}/>
      </div>
    </div>}

    {/* ─── Modal Pagar ─── */}
    {pagoModal&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(4px)",zIndex:2000,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={()=>setPagoModal(null)}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"8px 20px 32px",width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{width:36,height:4,borderRadius:2,background:"#E5E7EB",margin:"0 auto 12px"}}/>
        <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>💰 Registrar pago</div>
        <div style={{fontSize:12,color:"#6E6E73",marginBottom:14}}>{pagoModal.label} · {pagoModal.oc_id} · {pagoModal.prov?.nombre}</div>
        {/* Resumen del hito */}
        <div style={{background:"#F4F5F7",borderRadius:10,padding:"10px 14px",marginBottom:14,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,textAlign:"center"}}>
          <div><div style={{fontSize:10.5,color:"#6E6E73",fontWeight:600}}>TOTAL HITO</div><div style={{fontSize:13,fontWeight:700}}>{pagoModal.moneda==="USD"?fUD(pagoModal.monto,2):fmt(pagoModal.monto)}</div></div>
          <div><div style={{fontSize:10.5,color:"#1E7A44",fontWeight:600}}>YA PAGADO</div><div style={{fontSize:13,fontWeight:700,color:"#1E7A44"}}>{pagoModal.moneda==="USD"?fUD(pagoModal.montoPagado,2):fmt(pagoModal.montoPagado)}</div></div>
          <div><div style={{fontSize:10.5,color:"#B42318",fontWeight:600}}>PENDIENTE</div><div style={{fontSize:13,fontWeight:700,color:"#B42318"}}>{pagoModal.moneda==="USD"?fUD(pagoModal.montoPendiente,2):fmt(pagoModal.montoPendiente)}</div></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <Fl l="Fecha de pago" req><input type="date" value={pagoForm.fecha} onChange={e=>setPagoForm(p=>({...p,fecha:e.target.value}))} style={css.input}/></Fl>
          <Fl l={`Monto (${pagoModal.moneda})`} req>
            <input type="number" value={pagoForm.monto} onChange={e=>setPagoForm(p=>({...p,monto:e.target.value}))} style={css.input} step="any"/>
            {parseFloat(pagoForm.monto)<pagoModal.montoPendiente*0.99&&<div style={{fontSize:11,color:"#B25E09",marginTop:2}}>⚠ Pago parcial — quedará remanente</div>}
          </Fl>
        </div>
        <Fl l="Observaciones" s={{marginBottom:12}}>
          <input value={pagoForm.obs} onChange={e=>setPagoForm(p=>({...p,obs:e.target.value}))} placeholder="Banco, referencia, notas..." style={css.input}/>
        </Fl>
        <Fl l="Comprobante (obligatorio)" req s={{marginBottom:16}}>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e=>{const f=e.target.files[0];if(f)setPagoForm(p=>({...p,file:f,fileName:f.name}))}} style={{fontSize:12}}/>
          {pagoForm.fileName&&<div style={{fontSize:11,color:"#1E7A44",marginTop:4}}>📎 {pagoForm.fileName}</div>}
        </Fl>
        <Bt fw onClick={confirmarPago} disabled={pagoForm.uploading}>
          {pagoForm.uploading?"Subiendo comprobante...":"💾 Confirmar pago"}
        </Bt>
      </div>
    </div>}

    {/* ─── Modal Editar pago ─── */}
    {editModal&&isFinAdmin&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",backdropFilter:"blur(4px)",zIndex:2000,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={()=>setEditModal(null)}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:"20px 20px 0 0",padding:"8px 20px 32px",width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{width:36,height:4,borderRadius:2,background:"#E5E7EB",margin:"0 auto 12px"}}/>
        <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>✏ Editar pago registrado</div>
        <div style={{background:"#B25E0912",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:"#B25E09",border:"1px solid #B25E0930"}}>
          ⚠ Acción restringida. Todos los cambios quedan registrados en el historial de auditoría.
        </div>
        {/* Historial si existe */}
        {(editModal.historial_edicion||[]).length>0&&<div style={{marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:"#6E6E73",marginBottom:6}}>HISTORIAL DE EDICIONES</div>
          {(editModal.historial_edicion||[]).map((h,i)=><div key={i} style={{fontSize:11,color:"#6E6E73",padding:"4px 8px",background:"#F4F5F7",borderRadius:6,marginBottom:4}}>
            {h.fecha} {h.hora} · {h.editado_por} · Monto anterior: {fmt(h.monto_anterior)} · Fecha anterior: {h.fecha_anterior}
          </div>)}
        </div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <Fl l="Fecha de pago" req><input type="date" value={editForm.fecha} onChange={e=>setEditForm(p=>({...p,fecha:e.target.value}))} style={css.input}/></Fl>
          <Fl l="Monto" req><input type="number" value={editForm.monto} onChange={e=>setEditForm(p=>({...p,monto:e.target.value}))} style={css.input} step="any"/></Fl>
        </div>
        <Fl l="Motivo de la edición" s={{marginBottom:12}}>
          <input value={editForm.obs} onChange={e=>setEditForm(p=>({...p,obs:e.target.value}))} placeholder="Explica el motivo del cambio..." style={css.input}/>
        </Fl>
        <Fl l="Nuevo comprobante (requerido si cambia el monto)" s={{marginBottom:16}}>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e=>{const f=e.target.files[0];if(f)setEditForm(p=>({...p,file:f,fileName:f.name}))}} style={{fontSize:12}}/>
          {editForm.fileName&&<div style={{fontSize:11,color:"#1E7A44",marginTop:4}}>📎 {editForm.fileName}</div>}
          {editModal.comprobante_url&&<a href={editModal.comprobante_url} target="_blank" rel="noreferrer" style={{display:"block",fontSize:11,color:"#1D4E89",marginTop:4}}>📎 Ver comprobante actual</a>}
        </Fl>
        <Bt fw onClick={guardarEdicion}>💾 Guardar cambios</Bt>
      </div>
    </div>}
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
    {n:1,k:"solicitud",l:"Solicitud",ic:"📝",c:"#1D4E89",rol:"Analista",cargo:"Analista de Compras",accion:"Genera la OC desde el módulo de Reposición o importa desde Excel",entrega:"OC creada con productos, proveedor, destino y plan de pago",sla:"24h",estados:[]},
    {n:2,k:"negocios",l:"Aprobación Negocios",ic:"✓",c:"#1D4E89",rol:"Dir. Negocios",cargo:"Director de Negocios",accion:"Revisa proveedor, cantidades, precios y necesidad comercial. Firma aprobación.",entrega:"OC validada comercialmente · Firma registrada",sla:"24h",estados:["Pend. Dir. Negocios"]},
    {n:3,k:"finanzas",l:"Aprobación Finanzas",ic:"💰",c:"#5B2C6F",rol:"Dir. Finanzas",cargo:"Director de Finanzas / JP Reyes",accion:"Evalúa disponibilidad de caja, plan de pago y presupuesto. Firma o rechaza.",entrega:"Autorización financiera · Si rechaza: se reenvía al 7° día",sla:"24h",estados:["Pend. Dir. Finanzas"]},
    {n:4,k:"proveedor",l:"Curse a proveedor",ic:"🔄",c:"#B25E09",rol:"Analista",cargo:"Analista de Compras",accion:"Envía la OC al proveedor. Recibe confirmación de cantidades y tiempos.",entrega:"Proveedor confirmó la OC · Guía de despacho agendada",sla:"2-5 días",estados:["Pend. proveedor","Confirmada prov."]},
    {n:5,k:"despacho",l:"Despacho nacional",ic:"🚚",c:"#5B2C6F",rol:"Jefe Operaciones",cargo:"Jefe de Operaciones",accion:"Coordina transporte y fecha de llegada al CD Maipú (o sucursal directa).",entrega:"Mercadería en ruta · ETA confirmada",sla:"3-10 días",estados:["Despacho nac."]},
    {n:6,k:"recepcion",l:"Recepción",ic:"📦",c:"#B25E09",rol:"Jefe Bodega",cargo:"Jefe de Bodega / Analista",accion:"Recibe mercadería, verifica cantidades, registra guías y facturas. Detecta discrepancias.",entrega:"Stock actualizado en BSALE · Factura registrada",sla:"24h",estados:["Recibida parcial","Recibida OK"]},
    {n:7,k:"cierre",l:"Cierre",ic:"📋",c:"#1E7A44",rol:"Analista",cargo:"Analista de Compras",accion:"Valida que todos los pagos estén realizados, DTE registrados y sin discrepancias.",entrega:"OC cerrada formalmente · Ingresa al histórico",sla:"Al pagar",estados:["Cerrada"]}
  ]

  // FLUJO IMPORTACIÓN — 12 etapas (nuevo diseño)
  const etapasImp=[
    {n:1,k:"solicitud",l:"Solicitud",ic:"📝",c:"#1D4E89",rol:"Analista",cargo:"Analista de Compras",accion:"Genera la OC de importación. Define proveedor internacional, cantidades, plan de pago (% fab/emb/saldo) y ETA.",entrega:"OC creada con productos, plan de pago internacional y términos",sla:"72h",estados:[]},
    {n:2,k:"negocios",l:"Aprobación Negocios",ic:"✓",c:"#1D4E89",rol:"Dir. Negocios",cargo:"Director de Negocios",accion:"Revisa tendencia de ventas, forecast y necesidad estratégica. Aprueba la compra internacional.",entrega:"OC validada comercialmente",sla:"24h",estados:["Pend. Dir. Negocios"]},
    {n:3,k:"proyectar_costeo",l:"Proyectar Costeo",ic:"🧮",c:"#223058",rol:"Analista",cargo:"Analista de Compras",accion:"Desde el módulo Costeo: calcula el costo unitario final incluyendo flete, seguro, aduana, gastos en puerto y márgenes. Anexa el costeo al historial de la OC.",entrega:"Costeo proyectado anexado · Margen estimado por producto",sla:"24h",estados:["Proyectar costeo"],critica:true},
    {n:4,k:"finanzas",l:"Aprobación Finanzas",ic:"💰",c:"#5B2C6F",rol:"Dir. Finanzas",cargo:"Director de Finanzas",accion:"Revisa el costeo proyectado, flujo de caja USD y capacidad de financiamiento. Aprueba la inversión total.",entrega:"Autorización financiera para curso internacional",sla:"48h",estados:["Pend. Dir. Finanzas"]},
    {n:5,k:"proforma",l:"Proforma / Proveedor",ic:"📄",c:"#B25E09",rol:"Analista + Dir. Operaciones",cargo:"Analista · Valida: Dir. Operaciones",accion:"Analista envía la OC al proveedor. Recibe proforma. Dir. Operaciones valida cantidades confirmadas Y forma de pago (% fab/emb/saldo).",entrega:"Proforma aceptada · Plan de pago firmado",sla:"3-7 días",estados:["Pend. proveedor","Proforma OK"],critica:true},
    {n:6,k:"pago_fab",l:"Fabricación",ic:"🏭",c:"#B25E09",rol:"Dir. Finanzas",cargo:"Director de Finanzas",accion:"El proveedor fabrica. Gestión de importaciones registra el inicio; el anticipo se paga según el plan de pagos, fuera del flujo de estados.",entrega:"Comprobante de pago anexado · Producción iniciada",sla:"Al confirmar proforma",estados:["Pago fabricación"]},
    {n:7,k:"pago_emb",l:"Embarque",ic:"🚢",c:"#B25E09",rol:"Dir. Finanzas",cargo:"Director de Finanzas",accion:"La mercadería zarpa: se registran fecha, BL, naviera, contenedores y ETA en Hitos de importación; el saldo se paga según el plan de pagos.",entrega:"Comprobante de embarque anexado · B/L recibido",sla:"Al embarcar",estados:["Pago embarque"]},
    {n:8,k:"internacion",l:"Internación",ic:"🏛",c:"#B42318",rol:"Agente de Aduana",cargo:"Agente externo · Gestiona: Analista",accion:"Agente aduana gestiona: Bill of Lading, DIN, IVA, arancel. Analista anexa pagos: naviera, aduana, transporte local, seguros.",entrega:"Carga liberada · DIN y comprobantes anexados",sla:"5-15 días",estados:["Internación"]},
    {n:9,k:"costeo_final",l:"Validar Costeo Final",ic:"🎯",c:"#223058",rol:"Analista",cargo:"Analista de Compras",accion:"Al recibir todos los comprobantes reales (naviera, aduana, agente, transporte, seguros), actualiza el costeo en el módulo. Compara vs proyectado y ajusta márgenes.",entrega:"Costeo final validado · Márgenes reales actualizados",sla:"24h",estados:["Validar costeo final"],critica:true},
    {n:10,k:"transporte",l:"Transporte local",ic:"🚛",c:"#5B2C6F",rol:"Jefe Operaciones",cargo:"Jefe de Operaciones",accion:"Coordina el retiro desde el puerto hasta el CD Maipú. Verifica seguro de transporte terrestre.",entrega:"Mercadería en ruta al CD",sla:"1-3 días",estados:["Transporte"]},
    {n:11,k:"recepcion",l:"Recepción",ic:"📦",c:"#B25E09",rol:"Jefe Bodega",cargo:"Jefe de Bodega",accion:"Recibe carga en CD, verifica unidades vs DIN, registra en BSALE, actualiza stock.",entrega:"Stock actualizado · Reparto a sucursales si corresponde",sla:"48h",estados:["Recibida parcial","Recibida OK"]},
    {n:12,k:"cierre",l:"Cierre",ic:"✅",c:"#1E7A44",rol:"Analista + Dir. Finanzas",cargo:"Analista + Dir. Finanzas",accion:"Valida que todos los pagos estén realizados, sin pendientes con agente aduana, y cierra la OC.",entrega:"OC cerrada · Integrada al histórico de costeos",sla:"Al completar pagos",estados:["Cerrada"]}
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
    "Analista":{c:"#1D4E89",bg:"#1D4E8910"},
    "Dir. Negocios":{c:"#1D4E89",bg:"#1D4E8910"},
    "Dir. Finanzas":{c:"#5B2C6F",bg:"#5B2C6F10"},
    "Dir. Operaciones":{c:"#1D4E89",bg:"#1D4E8910"},
    "Jefe Operaciones":{c:"#B25E09",bg:"#B25E0910"},
    "Jefe Bodega":{c:"#B25E09",bg:"#B25E0910"},
    "Agente de Aduana":{c:"#B42318",bg:"#B4231810"},
    "Analista + Dir. Operaciones":{c:"#223058",bg:"#22305810"},
    "Analista + Dir. Finanzas":{c:"#1E7A44",bg:"#1E7A4410"}
  }

  const ocsActivasImp=ocs.filter(o=>o.tipo_oc==="Importación"&&!["Cerrada","Rechazada","Anulada","Borrador"].includes(o.estado))
  const ocsActivasNac=ocs.filter(o=>o.tipo_oc==="Nacional"&&!["Cerrada","Rechazada","Anulada","Borrador"].includes(o.estado))

  // Contar OCs por etapa
  const contarOCs=(etapa,tipo)=>{
    const filt=tipo==="IMP"?ocsActivasImp:ocsActivasNac
    if(!etapa.estados||etapa.estados.length===0)return 0
    return filt.filter(o=>etapa.estados.includes(o.estado)).length
  }

  return<div>
    {/* Header */}
    <div style={{background:"linear-gradient(135deg,#1a1a2e 0%,#16213e 100%)",borderRadius:16,padding:"20px 24px",marginBottom:14,color:"#fff",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:-60,right:-60,width:200,height:200,borderRadius:"50%",background:"radial-gradient(circle,#1D4E8930 0%,transparent 70%)",pointerEvents:"none"}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:14,position:"relative"}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.5)",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:4}}>Proceso de compras · SOP P07 v2.0</div>
          <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.02em",lineHeight:1}}>Flujograma operativo</div>
          <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",marginTop:6}}>{ocsActivasNac.length} Nac · {ocsActivasImp.length} IMP activas · Click en etapa para ver OCs</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <a href="/Flujograma_OC_v50.pdf" download="Flujograma_OC_Outlet_v50.pdf" style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:8,fontSize:12,fontWeight:600,background:"#1E7A44",color:"#fff",textDecoration:"none",border:"none",cursor:"pointer"}} title="Descargar PDF del flujograma">
            ⬇ Descargar PDF
          </a>
          <div style={{display:"flex",gap:4,background:"rgba(255,255,255,0.08)",borderRadius:10,padding:3}}>
            <button onClick={()=>setVista("nacional")} style={{padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:vista==="nacional"?"#fff":"transparent",color:vista==="nacional"?"#1C1C1E":"rgba(255,255,255,0.7)"}}>🇨🇱 Nacional ({etapasNac.length})</button>
            <button onClick={()=>setVista("importacion")} style={{padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:vista==="importacion"?"#fff":"transparent",color:vista==="importacion"?"#1C1C1E":"rgba(255,255,255,0.7)"}}>🌍 Importación ({etapasImp.length})</button>
            <button onClick={()=>setVista("decalogo")} style={{padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:vista==="decalogo"?"#fff":"transparent",color:vista==="decalogo"?"#1C1C1E":"rgba(255,255,255,0.7)"}}>📖 Decálogo</button>
          </div>
        </div>
      </div>
    </div>

    {/* ═══ VISTA NACIONAL ═══ */}
    {vista==="nacional"&&<div>
      <div style={{background:"#fff",borderRadius:14,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
          <div style={{width:36,height:36,borderRadius:18,background:"#1D4E89",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🇨🇱</div>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:"#1C1C1E"}}>Flujo de Orden de Compra Nacional</div>
            <div style={{fontSize:12,color:"#6E6E73"}}>7 etapas · Tiempo promedio: 5-15 días</div>
          </div>
        </div>
      </div>

      <EtapaRender etapas={etapasNac} contarOCs={(e)=>contarOCs(e,"NAC")} roles={roles} ocs={ocsActivasNac} setDet={setDet} provs={provs}/>
    </div>}

    {/* ═══ VISTA IMPORTACIÓN ═══ */}
    {vista==="importacion"&&<div>
      <div style={{background:"#fff",borderRadius:14,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
          <div style={{width:36,height:36,borderRadius:18,background:"#B42318",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🌍</div>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:"#1C1C1E"}}>Flujo de Orden de Compra Importación</div>
            <div style={{fontSize:12,color:"#6E6E73"}}>12 etapas · Tiempo promedio: 60-90 días · Incluye 2 validaciones de costeo</div>
          </div>
        </div>
        <div style={{marginTop:12,padding:"10px 12px",background:"#22305808",borderRadius:8,borderLeft:"3px solid #223058"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#223058",marginBottom:4}}>🎯 ETAPAS CRÍTICAS</div>
          <div style={{fontSize:12,color:"#6E6E73",lineHeight:1.5}}>Proyectar Costeo (#3) · Proforma (#5) · Validar Costeo Final (#9) son las etapas donde el analista debe ser riguroso porque impactan directamente en el margen final del producto.</div>
        </div>
      </div>

      <EtapaRender etapas={etapasImp} contarOCs={(e)=>contarOCs(e,"IMP")} roles={roles} ocs={ocsActivasImp} setDet={setDet} provs={provs}/>
    </div>}

    {/* ═══ VISTA DECÁLOGO ═══ */}
    {vista==="decalogo"&&<div>
      <div style={{background:"#fff",borderRadius:14,padding:"16px 20px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,borderRadius:18,background:"#1E7A44",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>📖</div>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:"#1C1C1E"}}>Decálogo de términos y conceptos</div>
            <div style={{fontSize:12,color:"#6E6E73"}}>Glosario de términos usados en el proceso de compras e importación · {decalogo.length} conceptos</div>
          </div>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:12}}>
        {decalogo.map((d,i)=><div key={i} style={{background:"#fff",borderRadius:12,padding:"14px 16px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:"3px solid #1E7A44"}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
            <div style={{fontSize:20,flexShrink:0}}>{d.ic}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:800,color:"#1C1C1E",marginBottom:4}}>{d.t}</div>
              <div style={{fontSize:12,color:"#6E6E73",lineHeight:1.5}}>{d.d}</div>
            </div>
          </div>
        </div>)}
      </div>

      <div style={{marginTop:14,background:"#FFF8E7",borderRadius:12,padding:"14px 18px",border:"1px solid #FFE4A0"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#946200",marginBottom:8}}>💡 ¿Cómo usar este decálogo?</div>
        <div style={{fontSize:12,color:"#6E6E73",lineHeight:1.6}}>
          Este glosario está diseñado para resolver dudas frecuentes sin tener que consultar al equipo. Si no encontrás un término acá, revisa el <b>Manual ERP v2</b> (botón 📖 Manual arriba) o preguntá al Analista de Compras. Los conceptos están ordenados desde los más técnicos de importación hasta los operativos del día a día.
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
      const role=roles[e.rol]||{c:"#6E6E73",bg:"#6E6E7310"}
      const isExp=expandida===e.k
      const ocsEnEtapa=e.estados&&e.estados.length>0?ocs.filter(o=>e.estados.includes(o.estado)):[]
      const esUltima=idx===etapas.length-1

      return<div key={e.k} style={{position:"relative"}}>
        {/* Línea conectora */}
        {!esUltima&&<div style={{position:"absolute",left:28,top:68,bottom:-12,width:3,background:`linear-gradient(to bottom, ${e.c}80, ${etapas[idx+1]?.c||"#E5E7EB"}80)`,zIndex:0}}/>}

        <div style={{display:"flex",gap:14,marginBottom:12,position:"relative",zIndex:1}}>
          {/* Círculo de número */}
          <div style={{width:56,height:56,borderRadius:28,background:`linear-gradient(135deg, ${e.c}, ${e.c}dd)`,color:"#fff",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:`0 4px 12px ${e.c}40`,border:e.critica?"3px solid #B42318":"none"}}>
            <div style={{fontSize:12,fontWeight:800,opacity:0.8,lineHeight:1}}>ETAPA</div>
            <div style={{fontSize:20,fontWeight:800,lineHeight:1,marginTop:2}}>{e.n}</div>
          </div>

          {/* Card de etapa */}
          <div style={{flex:1,background:"#fff",borderRadius:12,padding:"14px 18px",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",borderLeft:`4px solid ${e.c}`,cursor:"pointer"}} onClick={()=>setExpandida(isExp?null:e.k)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
              <div style={{flex:1,minWidth:240}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{fontSize:20}}>{e.ic}</span>
                  <span style={{fontSize:15,fontWeight:800,color:"#1C1C1E"}}>{e.l}</span>
                  {e.critica&&<span style={{fontSize:10.5,fontWeight:700,color:"#fff",background:"#B42318",padding:"2px 6px",borderRadius:4}}>CRÍTICA</span>}
                </div>
                <div style={{fontSize:12,color:"#6E6E73",lineHeight:1.5,marginBottom:8}}>{e.accion}</div>

                {/* Meta info */}
                <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}>
                  <span style={{fontSize:11,fontWeight:700,color:role.c,background:role.bg,padding:"3px 8px",borderRadius:4}}>👤 {e.rol}</span>
                  <span style={{fontSize:11,fontWeight:600,color:"#6E6E73",background:"#F4F5F7",padding:"3px 8px",borderRadius:4}}>⏱ {e.sla}</span>
                  {count>0&&<span style={{fontSize:11,fontWeight:700,color:e.c,background:e.c+"15",padding:"3px 8px",borderRadius:4}}>{count} OC{count>1?"s":""} aquí</span>}
                </div>
              </div>

              {/* Click para expandir */}
              <div style={{color:"#AEAEB2",fontSize:11,fontWeight:600}}>{isExp?"▲ Ocultar":"▼ Ver detalle"}</div>
            </div>

            {/* Detalle expandido */}
            {isExp&&<div style={{marginTop:14,padding:"12px 14px",background:"#F8F8FA",borderRadius:8}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:10}}>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",marginBottom:3}}>Responsable</div>
                  <div style={{fontSize:12,fontWeight:600,color:"#1C1C1E"}}>{e.cargo}</div>
                </div>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",marginBottom:3}}>Entregable</div>
                  <div style={{fontSize:12,color:"#1C1C1E"}}>{e.entrega}</div>
                </div>
              </div>

              {/* OCs en esta etapa */}
              {ocsEnEtapa.length>0&&<div>
                <div style={{fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",marginBottom:6}}>OCs en esta etapa</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:6}}>
                  {ocsEnEtapa.map(oc=>{
                    const pv=provs.find(p=>p.id===oc.proveedor_id)
                    const dias=Math.abs(diff(oc.fecha_creacion))
                    return<div key={oc.id} onClick={ev=>{ev.stopPropagation();setDet&&setDet(oc)}} style={{padding:"8px 10px",background:"#fff",borderRadius:6,border:`1px solid ${e.c}30`,cursor:"pointer"}}>
                      <div style={{fontSize:12,fontWeight:700,fontFamily:"monospace"}}>{oc.id}</div>
                      <div style={{fontSize:11,color:"#6E6E73",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pv?.nombre||oc.proveedor_id}</div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
                        <span style={{fontSize:11,color:"#6E6E73"}}>{fmt(oc.total_clp)}</span>
                        <span style={{fontSize:11,fontWeight:600,color:dias>14?"#B42318":dias>7?"#B25E09":"#1E7A44"}}>{dias}d</span>
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
/* ⭐ Input de parámetro tipo: edita localmente, guarda en BD solo al perder foco */
function ParamTipoRow({t,i,setParams}){
  const[fab,setFab]=useState(String(t.dias_fabricacion||0))
  const[cob,setCob]=useState(String(t.periodo_cobertura||0))
  const[dirty,setDirty]=useState({fab:false,cob:false})
  // Sincronizar si cambia desde afuera (ej: reload)
  useEffect(()=>{setFab(String(t.dias_fabricacion||0));setCob(String(t.periodo_cobertura||0))},[t.dias_fabricacion,t.periodo_cobertura])
  const saveFab=async()=>{
    const v=Math.max(1,Number(fab)||1)
    setFab(String(v));setDirty(d=>({...d,fab:false}))
    await supabase.from('parametros_tipo').update({dias_fabricacion:v}).eq('tipo_producto',t.tipo_producto)
    setParams(p=>p.map(x=>x.tipo_producto===t.tipo_producto?{...x,dias_fabricacion:v}:x))
  }
  const saveCob=async()=>{
    const v=Math.max(1,Number(cob)||1)
    setCob(String(v));setDirty(d=>({...d,cob:false}))
    await supabase.from('parametros_tipo').update({periodo_cobertura:v}).eq('tipo_producto',t.tipo_producto)
    setParams(p=>p.map(x=>x.tipo_producto===t.tipo_producto?{...x,periodo_cobertura:v}:x))
  }
  const iStyle=(isDirty)=>({width:60,textAlign:"center",padding:"6px 4px",borderRadius:8,
    border:`1px solid ${isDirty?"#B25E09":"#E5E7EB"}`,fontSize:14,fontWeight:600,
    background:isDirty?"#FFF8EC":"#fff",outline:"none"})
  return<div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 0",borderBottom:"1px solid #F4F5F7"}}>
    <div style={{flex:1,fontSize:13,fontWeight:500}}>{t.tipo_producto}</div>
    <div style={{display:"flex",gap:4,alignItems:"center"}}>
      <input type="number" min="1" value={fab}
        onChange={e=>{setFab(e.target.value);setDirty(d=>({...d,fab:true}))}}
        onBlur={saveFab}
        onKeyDown={e=>{if(e.key==="Enter")e.target.blur()}}
        style={iStyle(dirty.fab)}/>
      <span style={{fontSize:12,color:"#6E6E73"}}>fab</span>
    </div>
    <div style={{display:"flex",gap:4,alignItems:"center"}}>
      <input type="number" min="1" value={cob}
        onChange={e=>{setCob(e.target.value);setDirty(d=>({...d,cob:true}))}}
        onBlur={saveCob}
        onKeyDown={e=>{if(e.key==="Enter")e.target.blur()}}
        style={iStyle(dirty.cob)}/>
      <span style={{fontSize:12,color:"#6E6E73"}}>cob</span>
    </div>
  </div>
}

/* ⭐ Input de días emergencia ABCD: edita localmente, guarda en BD al perder foco */
function ParamAbcdInput({e,i,setParamsABCD}){
  const[val,setVal]=useState(String(e.dias_emergencia||0))
  const[dirty,setDirty]=useState(false)
  useEffect(()=>{setVal(String(e.dias_emergencia||0))},[e.dias_emergencia])
  const save=async()=>{
    const v=Math.max(1,Number(val)||1)
    setVal(String(v));setDirty(false)
    await supabase.from('parametros_abcd').update({dias_emergencia:v}).eq('clasificacion',e.clasificacion)
    setParamsABCD(p=>p.map(x=>x.clasificacion===e.clasificacion?{...x,dias_emergencia:v}:x))
  }
  return<input type="number" min="1" value={val}
    onChange={ev=>{setVal(ev.target.value);setDirty(true)}}
    onBlur={save}
    onKeyDown={ev=>{if(ev.key==="Enter")ev.target.blur()}}
    style={{width:60,textAlign:"center",padding:"6px 4px",borderRadius:8,
      border:`1px solid ${dirty?"#B25E09":"#E5E7EB"}`,fontSize:14,fontWeight:600,
      background:dirty?"#FFF8EC":"#fff",outline:"none"}}/>
}

/* 19-oct-2026: Política de compra guiada. Reemplaza el panel técnico de parámetros: seis preguntas en lenguaje simple,
   valores recomendados, opciones rápidas, matriz ABC-XYZ, lead time real por proveedor, recálculo con impacto e historial. */
const PC_ETIQ={umbral_atipico:"Mes atípico (veces la mediana)",umbral_quiebre_bajo:"Probable quiebre sin foto de stock",disp_min_compensar:"Disponibilidad mínima para compensar",lt_defecto_nacional:"Lead time por defecto · nacional",lt_defecto_importacion:"Lead time por defecto · importación",lt_sin_proveedor:"Lead time sin proveedor",peso_reciente:"Peso de la venta reciente",ventana_reciente_dias:"Ventana de venta reciente",ss_estadistico:"Método de stock de seguridad"}
const PC_CAMPO={ajuste_demanda_pct:"Estimación de la categoría (%)",periodo_cobertura:"Cobertura",dias_emergencia:"Días de seguridad",lead_time_dias:"Lead time del proveedor",proveedor_id:"Proveedor del producto",dias_fabricacion:"Lead time por defecto",modalidad:"Abastecimiento",dias:"Lead time del proveedor"}
const PC_PCT=/^(umbral_quiebre_bajo|disp_min_compensar|peso_reciente)$/
function PcPaso({n,titulo,sub,derecha,children}){
  return <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:10,padding:"16px 18px",marginBottom:14}}>
    <div style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:12}}>
      <div style={{width:30,height:30,borderRadius:15,background:"#16213E",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:14,flexShrink:0}}>{n}</div>
      <div style={{flex:1,minWidth:0}}><div style={{fontSize:15.5,fontWeight:800,color:"#16213E"}}>{titulo}</div><div style={{fontSize:12.5,color:"#6E6E73",marginTop:3,lineHeight:1.5,maxWidth:980}}>{sub}</div></div>
      {derecha}
    </div>
    {children}
  </div>
}
function PcOpcion({activo,titulo,sub,rec,dis,onClick}){
  return <button disabled={dis} onClick={onClick} style={{textAlign:"left",padding:"8px 12px",borderRadius:8,cursor:dis?"default":"pointer",minWidth:120,border:"1.5px solid "+(activo?"#16213E":"#E5E7EB"),background:activo?"#EEF1F7":"#fff",transition:"all .15s"}}>
    <div style={{fontSize:13,fontWeight:700,color:"#16213E",display:"flex",alignItems:"center",gap:6}}>{activo&&<span style={{color:"#1E7A44"}}>●</span>}{titulo}{rec&&<span style={{fontSize:10,fontWeight:700,color:"#1E7A44",background:"#ECFDF3",borderRadius:5,padding:"1px 6px"}}>Recomendado</span>}</div>
    {sub&&<div style={{fontSize:11.5,color:"#6E6E73",marginTop:2}}>{sub}</div>}
  </button>
}
function PcNum({valor,sufijo,dis,onGuardar,step=1,min,max,ancho=90}){
  return <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
    <input type="number" step={step} min={min} max={max} defaultValue={valor==null||isNaN(valor)?"":Math.round(valor*100)/100} key={String(valor)} disabled={dis}
      onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur()}}
      onBlur={e=>{const v=Number(e.target.value);if(e.target.value!==""&&Number.isFinite(v)&&v!==Math.round(valor*100)/100)onGuardar(v)}}
      style={{width:ancho,padding:"6px 8px",border:"1px solid #D1D5DB",borderRadius:6,fontSize:13,textAlign:"right",background:dis?"#F4F5F7":"#fff"}}/>
    {sufijo&&<span style={{fontSize:12.5,color:"#6E6E73"}}>{sufijo}</span>}
  </span>
}
function PcEtiq({t,ayuda}){return <div><div style={{fontSize:13,fontWeight:700,color:"#1C1C1E"}}>{t}</div>{ayuda&&<div style={{fontSize:12,color:"#6E6E73",marginTop:2,lineHeight:1.45}}>{ayuda}</div>}</div>}
function PoliticaCompra({cu,provs=[],loadAll}){
  const puede=["admin","dir_general","dir_negocios"].includes(cu?.rol)
  const puedeAs=puede||cu?.rol==="analista"
  const[alg,setAlg]=useState({})
  const[tipos,setTipos]=useState([])
  const[abcd,setAbcd]=useState([])
  const[provsLt,setProvsLt]=useState([])
  const[desemp,setDesemp]=useState({})
  const[filas,setFilas]=useState([])
  const[resumen,setResumen]=useState(null)
  const[antes,setAntes]=useState(null)
  const[hist,setHist]=useState([])
  const[pend,setPend]=useState(false)
  const[calc,setCalc]=useState(false)
  const[msg,setMsg]=useState("")
  const[qTipo,setQTipo]=useState("")
  const[qSp,setQSp]=useState("")
  const[verTodosProv,setVerTodosProv]=useState(false)
  const[limSp,setLimSp]=useState(40)
  const[asig,setAsig]=useState({})
  const cargar=async()=>{
    const[a,pt,ab,pv,d,f,r,h]=await Promise.all([
      supabase.from('cmp_param_algoritmo').select('*'),
      supabase.from('parametros_tipo').select('*').order('tipo_producto'),
      supabase.from('parametros_abcd').select('*').order('clasificacion'),
      supabase.from('proveedores').select('id,nombre,tipo,activo,lead_time_dias,lead_time_fuente').order('nombre'),
      supabase.from('v_cmp_desempeno_proveedor').select('proveedor_id,lt_real_mediana,n_lt'),
      fetchAll(supabase.from('cmp_reposicion_v2').select('sku,producto,tipo_producto,clasif_abcd,estado,proveedor_id,sin_proveedor,neto_12m,unid_12m,demanda_base,ventas_mes').in('estado',['Reposición','Stock suficiente'])),
      supabase.from('v_cmp_resumen_calculo').select('*'),
      supabase.from('cmp_param_historial').select('*').order('fecha',{ascending:false}).limit(25)])
    setAlg(Object.fromEntries((a.data||[]).map(x=>[x.clave,x])));setTipos(pt.data||[]);setAbcd(ab.data||[]);setProvsLt(pv.data||[])
    setDesemp(Object.fromEntries((d.data||[]).map(x=>[x.proveedor_id,x])));setFilas(f.data||[]);setResumen((r.data||[])[0]||null);setHist(h.data||[])
  }
  useEffect(()=>{cargar()},[])
  const val=(k,def)=>{const v=Number(alg[k]?.valor);return Number.isFinite(v)?v:def}
  const aviso=t=>{setMsg(t);setTimeout(()=>setMsg(""),4500)}
  const ok=()=>{setPend(true);aviso("Guardado. Se aplica solo a la compra en 1 a 2 minutos; con “Recalcular y ver impacto” lo aplicas al instante y ves el efecto.");cargar()}
  const rangos={umbral_atipico:[1.5,6],umbral_quiebre_bajo:[0.05,0.7],disp_min_compensar:[0.2,0.9],lt_defecto_nacional:[1,365],lt_defecto_importacion:[1,365],lt_sin_proveedor:[1,365]}
  const guardarAlg=async(clave,valor)=>{const v=Number(valor);const[mn,mx]=rangos[clave]||[-1e9,1e9]
    if(!Number.isFinite(v)||v<mn-1e-9||v>mx+1e-9){alert(`Valor fuera de rango para “${PC_ETIQ[clave]||clave}”.`);return}
    if(Math.abs(v-val(clave,NaN))<1e-9)return
    const{error}=await supabase.from('cmp_param_algoritmo').update({valor:v,actualizado_at:new Date().toISOString(),actualizado_por:cu?.nombre||null}).eq('clave',clave)
    if(error){alert("No se guardó: "+error.message);return}ok()}
  const guardar=async(tabla,match,campos)=>{const{error}=await supabase.from(tabla).update(campos).match(match);if(error){alert("No se guardó: "+error.message);return}ok()}
  const provNom=id=>provsLt.find(p=>p.id===id)?.nombre||provs.find(p=>p.id===id)?.nombre||id
  const asignar=async(sku,provId)=>{if(!provId)return
    const{error}=await supabase.from('cmp_sku_proveedor').upsert({sku,proveedor_id:provId,fuente:"Asignado en Política de compra",actualizado_por:cu?.nombre||null,actualizado_at:new Date().toISOString()},{onConflict:'sku'})
    if(error){alert("No se guardó: "+error.message);return}
    setFilas(fs=>fs.map(x=>x.sku===sku?{...x,proveedor_id:provId,sin_proveedor:false}:x));setPend(true);aviso(`Proveedor asignado: ${provNom(provId)}. Recalcula para aplicar su lead time.`)}
  const usarReal=async p=>{const d=desemp[p.id];if(!d?.lt_real_mediana)return;const v=Math.max(1,Math.round(d.lt_real_mediana))
    if(!window.confirm(`¿Usar ${v} días como lead time de ${p.nombre}?\n\nEs la mediana real de ${d.n_lt} OC (desde la aprobación hasta la primera guía). Hoy el cálculo usa ${p.lead_time_dias??"el valor por defecto"}.`))return
    await guardar('proveedores',{id:p.id},{lead_time_dias:v,lead_time_fuente:`Real medido (mediana de ${d.n_lt} OC), aplicado por ${cu?.nombre||"usuario"}`})}
  const recalcular=async()=>{setCalc(true);setAntes(resumen)
    try{const a=await supabase.rpc('fn_cmp_reposicion_v2');if(a.error)throw a.error;setPend(false);await cargar();if(loadAll)loadAll();aviso("Recalculado con la política vigente. Arriba ves el antes y el ahora.")}
    catch(e){alert("No se pudo recalcular: "+(e.message||e))}finally{setCalc(false)}}
  // Datos derivados
  const mk=k=>{const h=new Date();const d=new Date(h.getFullYear(),h.getMonth()-k,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`}
  const ult3k=[mk(1),mk(2),mk(3)]
  const porTipo={};filas.forEach(x=>{const k=String(x.tipo_producto||"SIN TIPO").trim().toUpperCase();const o=porTipo[k]||(porTipo[k]={skus:0,prom:0,ult3:0});o.skus++;o.prom+=(Number(x.demanda_base)||0)*30;o.ult3+=ult3k.reduce((a,m)=>a+(Number(x.ventas_mes?.[m])||0),0)/3})
  const nProv={};filas.forEach(x=>{if(x.proveedor_id)nProv[x.proveedor_id]=(nProv[x.proveedor_id]||0)+1})
  const sug={};{const c={};filas.forEach(x=>{if(!x.proveedor_id)return;const k=String(x.tipo_producto||"").toUpperCase();(c[k]=c[k]||{})[x.proveedor_id]=(c[k][x.proveedor_id]||0)+1});Object.entries(c).forEach(([k,m])=>{const tot=Object.values(m).reduce((a,b)=>a+b,0);const[pid,n]=Object.entries(m).sort((a,b)=>b[1]-a[1])[0]||[];if(pid&&n>=3&&n/tot>=0.5)sug[k]={pid,n,tot}})}
  const sinProv=filas.filter(x=>x.sin_proveedor).sort((a,b)=>(Number(b.neto_12m)||0)-(Number(a.neto_12m)||0))
  const ventaTot=filas.reduce((a,x)=>a+(Number(x.neto_12m)||0),0),ventaSp=sinProv.reduce((a,x)=>a+(Number(x.neto_12m)||0),0)
  const spVis=sinProv.filter(x=>!qSp||String(x.producto||"").toLowerCase().includes(qSp.toLowerCase())||String(x.sku).toLowerCase().includes(qSp.toLowerCase()))
  const provsTabla=provsLt.filter(p=>p.activo!==false).map(p=>({...p,n:nProv[p.id]||0})).sort((a,b)=>b.n-a.n||String(a.nombre).localeCompare(String(b.nombre)))
  const provsVis=verTodosProv?provsTabla:provsTabla.filter(p=>p.n>0)
  const tiposVis=tipos.map(t=>{const k=String(t.tipo_producto).trim().toUpperCase();return{...t,clave:k,...(porTipo[k]||{skus:0,prom:0,ult3:0})}}).filter(t=>!qTipo||t.tipo_producto.toLowerCase().includes(qTipo.toLowerCase())).sort((a,b)=>b.prom-a.prom||b.skus-a.skus)
  const pct=v=>v==null||isNaN(v)?"—":`${(Math.round(v*1000)/10).toString().replace(".",",")}%`
  const fechaC=f=>new Date(f).toLocaleString("es-CL",{timeZone:"America/Santiago",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false})
  const fmtHist=(h,v)=>{if(v==null||v==="")return"—";if(h.campo==="proveedor_id")return provNom(v);if(h.tabla==="cmp_param_algoritmo"&&PC_PCT.test(h.clave||""))return pct(Number(v));if(h.campo==="ajuste_demanda_pct")return `${Number(v)>0?"+":""}${v}%`;if(v==="true")return"Sí";if(v==="false")return"No";return v}
  const etiqHist=h=>h.tabla==="cmp_param_algoritmo"?(PC_ETIQ[h.clave]||h.clave):`${PC_CAMPO[h.campo]||h.campo}${h.clave?` · ${h.clave}`:""}`
  const met=[["SKUs a reponer","skus_reponer",x=>fN(x)],["Inversión sugerida","inversion",x=>fmt(x)],["Pedir hoy","pedir_hoy",x=>fN(x)],["Quiebres en 30 días","quiebres_30d",x=>fN(x)]]
  const th={textAlign:"right",padding:"6px 8px",fontSize:11.5,color:"#6E6E73",fontWeight:700}
  return <div>
    <div style={{background:"#fff",border:"1px solid #E5E7EB",borderLeft:"4px solid #16213E",borderRadius:10,padding:"16px 18px",marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
        <div style={{maxWidth:900}}><div style={{fontSize:18,fontWeight:800,color:"#16213E"}}>Política de compra</div>
          <div style={{fontSize:12.5,color:"#6E6E73",marginTop:3,lineHeight:1.5}}>La compra se calcula por unidad, consolidada para toda la empresa (la distribución a sucursales es de Logística). <b>Venta promedio diaria</b> de los últimos 12 meses × (1 + estimación de la categoría). <b>Punto de reorden</b> = venta diaria × (lead time del proveedor + días de seguridad de la clase). <b>Stock objetivo</b> = venta diaria × (lead time + seguridad + cobertura de la categoría). Cada producto muestra su cálculo completo en Reposición › Ver.</div></div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
          <Bt v="pri" dis={!puede||calc} onClick={recalcular} ic="↻">{calc?"Recalculando…":"Recalcular y ver impacto"}</Bt>
          {pend&&<span style={{fontSize:11.5,fontWeight:700,color:"#B25E09"}}>● Hay cambios guardados que aún no se aplican</span>}
        </div>
      </div>
      {msg&&<div style={{marginTop:10,fontSize:12.5,fontWeight:600,color:"#1E7A44"}}>{msg}</div>}
      {resumen&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",border:"1px solid #E5E7EB",borderBottom:"none",borderRadius:8,overflow:"hidden",marginTop:12}}>
        {met.map(([l,k,f])=>{const a=antes?.[k],n=resumen[k];const cambio=antes&&a!=null&&Number(a)!==Number(n);const sube=Number(n)>Number(a)
          return <div key={k} style={{padding:"9px 14px",borderRight:"1px solid #E5E7EB",borderBottom:"1px solid #E5E7EB"}}><div style={{fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",letterSpacing:0.5}}>{l}</div><div style={{fontSize:17,fontWeight:700}}>{f(n)}</div>{cambio?<div style={{fontSize:11.5,fontWeight:600,color:sube?"#B25E09":"#1E7A44"}}>{sube?"▲":"▼"} antes {f(a)}</div>:<div style={{fontSize:11,color:"#9CA3AF"}}>{antes?"sin cambio":"vigente"}</div>}</div>})}
        <div style={{padding:"9px 14px",borderRight:"1px solid #E5E7EB",borderBottom:"1px solid #E5E7EB"}}><div style={{fontSize:10.5,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",letterSpacing:0.5}}>Productos sin proveedor</div><div style={{fontSize:17,fontWeight:700,color:sinProv.length?"#B42318":"#1E7A44"}}>{fN(sinProv.length)}</div><div style={{fontSize:11,color:"#6E6E73"}}>{ventaTot?`${Math.round(ventaSp/ventaTot*100)}% de la venta`:""}</div></div>
      </div>}
    </div>

    <PcPaso n={1} titulo="¿Cómo se calcula la venta promedio? · Desviaciones" sub="Se toman los últimos 12 meses completos de cada producto (con los kits repartidos en sus unidades). Cada mes se revisa: si hubo quiebre de stock se compensa o no entra, y si la venta fue anormalmente alta (por ejemplo, un proyecto puntual) no entra al promedio.">
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:12}}>
        <div style={{border:"1px solid #E5E7EB",borderRadius:8,padding:"10px 12px"}}><PcEtiq t="Mes atípico" ayuda="Un mes con venta diaria mayor a este múltiplo de la mediana del producto no entra al promedio. Recomendado 2,5."/><div style={{marginTop:6}}><PcNum valor={val('umbral_atipico',2.5)} sufijo="veces la mediana" step={0.1} min={1.5} max={6} dis={!puede} onGuardar={v=>guardarAlg('umbral_atipico',v)}/></div></div>
        <div style={{border:"1px solid #E5E7EB",borderRadius:8,padding:"10px 12px"}}><PcEtiq t="Quiebre con foto de stock (desde junio 2026)" ayuda="Si el producto tuvo stock menos de este porcentaje de los días, el mes no entra. Entre este porcentaje y 95% la venta se compensa: venta ÷ % de días con stock. Recomendado 50%."/><div style={{marginTop:6}}><PcNum valor={val('disp_min_compensar',0.5)*100} sufijo="% de días con stock" step={5} min={20} max={90} dis={!puede} onGuardar={v=>guardarAlg('disp_min_compensar',v/100)}/></div></div>
        <div style={{border:"1px solid #E5E7EB",borderRadius:8,padding:"10px 12px"}}><PcEtiq t="Quiebre sin foto de stock (antes de junio 2026)" ayuda="Si un mes vendió menos de este porcentaje de la mediana del producto, se considera probable quiebre y no entra. Recomendado 30%."/><div style={{marginTop:6}}><PcNum valor={val('umbral_quiebre_bajo',0.3)*100} sufijo="% de la mediana" step={5} min={5} max={70} dis={!puede} onGuardar={v=>guardarAlg('umbral_quiebre_bajo',v/100)}/></div></div>
      </div>
      <div style={{fontSize:12.5,color:"#374151",background:"#F8FAFC",borderRadius:6,padding:"8px 10px",marginTop:10}}>Ejemplo con mediana de 10 u/día: un mes de {Math.round(val('umbral_atipico',2.5)*10+5)} u/día es atípico y no entra; un mes con stock el 80% de los días y 8 u/día se compensa a 10 u/día; un mes con stock solo el {Math.round(val('disp_min_compensar',0.5)*100)-10}% de los días no entra.</div>
    </PcPaso>

    <PcPaso n={2} titulo="Estimación y cobertura por categoría" sub="Estimación = cuánto esperas que cambie la venta de la categoría respecto de su promedio de 12 meses (+10% vende más, −10% vende menos). Cobertura = para cuántos días de venta se compra cada vez. Como referencia, cada categoría muestra su venta de los últimos 3 meses frente al promedio."
      derecha={<input value={qTipo} onChange={e=>setQTipo(e.target.value)} placeholder="Buscar categoría…" style={{...css.input,width:200,padding:"6px 10px",fontSize:13}}/>}>
      <div style={{overflowX:"auto",maxHeight:460,overflowY:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead style={{position:"sticky",top:0,background:"#fff",zIndex:1}}><tr style={{borderBottom:"1px solid #E5E7EB"}}><th style={{...th,textAlign:"left"}}>Categoría</th><th style={th}>SKUs</th><th style={th}>Promedio 12 meses</th><th style={th}>Últimos 3 meses</th><th style={th}>Diferencia</th><th style={th}>Estimación</th><th style={th}>Cobertura</th></tr></thead>
        <tbody>{tiposVis.map(t=>{const dif=t.prom?((t.ult3-t.prom)/t.prom*100):null;return <tr key={t.tipo_producto} style={{borderBottom:"1px solid #F3F4F6"}}>
          <td style={{padding:"6px 8px",fontWeight:600}}>{t.tipo_producto}</td>
          <td style={{textAlign:"right",padding:"6px 8px",color:t.skus?"#1C1C1E":"#9CA3AF"}}>{t.skus||"—"}</td>
          <td style={{textAlign:"right",padding:"6px 8px"}}>{t.prom?`${fN(Math.round(t.prom))} u/mes`:"—"}</td>
          <td style={{textAlign:"right",padding:"6px 8px"}}>{t.skus?`${fN(Math.round(t.ult3))} u/mes`:"—"}</td>
          <td style={{textAlign:"right",padding:"6px 8px",fontWeight:700,color:dif==null||Math.abs(dif)<10?"#6E6E73":dif>0?"#1E7A44":"#B42318"}}>{dif==null?"—":`${dif>0?"+":""}${Math.round(dif)}%`}</td>
          <td style={{textAlign:"right",padding:"6px 8px"}}><PcNum valor={Number(t.ajuste_demanda_pct)||0} sufijo="%" step={5} min={-90} max={300} ancho={64} dis={!puede} onGuardar={v=>{if(v<-90||v>300){alert("La estimación debe estar entre -90% y +300%.");return}guardar('parametros_tipo',{tipo_producto:t.tipo_producto},{ajuste_demanda_pct:v})}}/></td>
          <td style={{textAlign:"right",padding:"6px 8px"}}><PcNum valor={Number(t.periodo_cobertura)} sufijo="días" min={7} max={365} ancho={64} dis={!puedeAs} onGuardar={v=>guardar('parametros_tipo',{tipo_producto:t.tipo_producto},{periodo_cobertura:Math.round(v)})}/></td>
        </tr>})}</tbody>
      </table></div>
    </PcPaso>

    <PcPaso n={3} titulo="Stock de seguridad por clase ABCD" sub="Días de venta que se guardan de resguardo según la importancia del producto. Clase A = productos que hacen el 80% de la venta; B = el siguiente 15%; C = el siguiente 4%; D = el resto. Stock de seguridad = venta diaria × días de la clase.">
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:8,maxWidth:880}}>{abcd.map(r=><div key={r.clasificacion} style={{padding:"8px 12px",border:"1px solid #E5E7EB",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}><span style={{fontWeight:700,color:CL[r.clasificacion]?.c}}>Clase {r.clasificacion}</span><PcNum valor={Number(r.dias_emergencia)} sufijo="días" min={0} max={180} ancho={60} dis={!puede} onGuardar={v=>guardar('parametros_abcd',{clasificacion:r.clasificacion},{dias_emergencia:Math.round(v)})}/></div>)}</div>
    </PcPaso>

    <PcPaso n={4} titulo="Lead time por proveedor · fabricación + despacho" sub="Días desde que se aprueba la OC hasta que la mercadería llega. Se define por proveedor y vale para todos sus productos. La columna Real es la mediana medida en Desempeño de proveedores; úsala cuando haya suficientes OC medidas."
      derecha={<label style={{fontSize:12.5,color:"#3A3A3C",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}><input type="checkbox" checked={verTodosProv} onChange={e=>setVerTodosProv(e.target.checked)}/>Ver también proveedores sin productos</label>}>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:10,fontSize:12.5,color:"#3A3A3C"}}>
        <span>Si un proveedor no tiene lead time: nacional <PcNum valor={val('lt_defecto_nacional',30)} sufijo="días" min={1} max={365} ancho={56} dis={!puede} onGuardar={v=>guardarAlg('lt_defecto_nacional',Math.round(v))}/></span>
        <span>· importación <PcNum valor={val('lt_defecto_importacion',90)} sufijo="días" min={1} max={365} ancho={56} dis={!puede} onGuardar={v=>guardarAlg('lt_defecto_importacion',Math.round(v))}/></span>
        <span>· producto sin proveedor <PcNum valor={val('lt_sin_proveedor',30)} sufijo="días" min={1} max={365} ancho={56} dis={!puede} onGuardar={v=>guardarAlg('lt_sin_proveedor',Math.round(v))}/></span>
      </div>
      <div style={{overflowX:"auto",maxHeight:460,overflowY:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead style={{position:"sticky",top:0,background:"#fff",zIndex:1}}><tr style={{borderBottom:"1px solid #E5E7EB"}}><th style={{...th,textAlign:"left"}}>Proveedor</th><th style={th}>Productos</th><th style={th}>Lead time</th><th style={th}>Real medido</th><th style={th}>Diferencia</th><th style={th}></th><th style={{...th,textAlign:"left",paddingLeft:12}}>Origen del valor</th></tr></thead>
        <tbody>{provsVis.map(p=>{const d=desemp[p.id];const real=d?.lt_real_mediana!=null?Math.round(d.lt_real_mediana):null;const dif=real!=null&&p.lead_time_dias!=null?real-Number(p.lead_time_dias):null
          return <tr key={p.id} style={{borderBottom:"1px solid #F3F4F6"}}>
            <td style={{padding:"6px 8px"}}><div style={{fontWeight:600}}>{p.nombre}</div><div style={{fontSize:11.5,color:"#9CA3AF"}}>{p.tipo||"—"}</div></td>
            <td style={{textAlign:"right",padding:"6px 8px"}}>{p.n||"—"}</td>
            <td style={{textAlign:"right",padding:"6px 8px"}}>{p.lead_time_dias==null&&<span style={{fontSize:11,color:"#B25E09",marginRight:6}}>por defecto</span>}<PcNum valor={p.lead_time_dias==null?NaN:Number(p.lead_time_dias)} sufijo="días" min={1} max={365} ancho={60} dis={!puedeAs} onGuardar={v=>{const x=Math.round(v);if(x<1||x>365){alert("Entre 1 y 365 días.");return}guardar('proveedores',{id:p.id},{lead_time_dias:x,lead_time_fuente:`Definido por ${cu?.nombre||"usuario"}`})}}/></td>
            <td style={{textAlign:"right",padding:"6px 8px",color:"#3A3A3C"}}>{real!=null?<>{real} días <span style={{color:"#9CA3AF"}}>({d.n_lt} OC)</span></>:"sin datos"}</td>
            <td style={{textAlign:"right",padding:"6px 8px",fontWeight:700,color:dif==null||Math.abs(dif)<5?"#6E6E73":dif<0?"#1D4E89":"#B42318"}}>{dif==null?"—":`${dif>0?"+":""}${dif} días`}</td>
            <td style={{textAlign:"right",padding:"6px 8px"}}>{real!=null&&d.n_lt>=3&&dif!==0&&puedeAs&&<Bt sm v="gry" onClick={()=>usarReal(p)}>Usar el real</Bt>}</td>
            <td style={{padding:"6px 8px 6px 12px",fontSize:12,color:"#6E6E73"}}>{p.lead_time_fuente||(p.lead_time_dias==null?"Sin lead time: usa el valor por defecto":"—")}</td>
          </tr>})}</tbody>
      </table></div>
    </PcPaso>

    <PcPaso n={5} titulo="Productos sin proveedor" sub="Sin proveedor no hay lead time propio ni OC posible. La sugerencia es el proveedor que tiene la mayoría de los productos de la misma categoría; revísala antes de asignarla."
      derecha={<input value={qSp} onChange={e=>setQSp(e.target.value)} placeholder="Buscar producto o SKU…" style={{...css.input,width:220,padding:"6px 10px",fontSize:13}}/>}>
      <div style={{fontSize:13,marginBottom:8,color:sinProv.length?"#B42318":"#1E7A44",fontWeight:700}}>{sinProv.length?`${fN(sinProv.length)} productos activos sin proveedor (${ventaTot?Math.round(ventaSp/ventaTot*100):0}% de la venta de 12 meses), ordenados por venta.`:"Todos los productos activos tienen proveedor."}</div>
      {sinProv.length>0&&<div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{borderBottom:"1px solid #E5E7EB"}}><th style={{...th,textAlign:"left"}}>Producto</th><th style={{...th,textAlign:"left"}}>Categoría</th><th style={{...th,textAlign:"center"}}>Clase</th><th style={th}>Venta 12 meses</th><th style={{...th,textAlign:"left",paddingLeft:12}}>Sugerencia</th><th style={{...th,textAlign:"left"}}>Asignar proveedor</th></tr></thead>
        <tbody>{spVis.slice(0,limSp).map(x=>{const s=sug[String(x.tipo_producto||"").toUpperCase()];const sel=asig[x.sku]??"";return <tr key={x.sku} style={{borderBottom:"1px solid #F3F4F6"}}>
          <td style={{padding:"6px 8px"}}><div style={{fontWeight:600}}>{x.producto||x.sku}</div><div style={{fontSize:11.5,color:"#9CA3AF"}}>{x.sku}</div></td>
          <td style={{padding:"6px 8px",fontSize:12.5}}>{x.tipo_producto}</td>
          <td style={{textAlign:"center",fontWeight:700,color:CL[x.clasif_abcd]?.c}}>{x.clasif_abcd}</td>
          <td style={{textAlign:"right",padding:"6px 8px"}}>{fmt(Number(x.neto_12m)||0)}</td>
          <td style={{padding:"6px 8px 6px 12px",fontSize:12.5}}>{s?<span>{provNom(s.pid)} <span style={{color:"#9CA3AF"}}>({s.n} de {s.tot} de la categoría)</span>{puedeAs&&<button onClick={()=>asignar(x.sku,s.pid)} style={{marginLeft:6,border:"1px solid #1E7A44",color:"#1E7A44",background:"#fff",borderRadius:5,padding:"1px 8px",fontSize:11.5,fontWeight:700,cursor:"pointer"}}>Usar</button>}</span>:<span style={{color:"#9CA3AF"}}>—</span>}</td>
          <td style={{padding:"6px 8px"}}><div style={{display:"flex",gap:6}}><select value={sel} disabled={!puedeAs} onChange={e=>setAsig(a=>({...a,[x.sku]:e.target.value}))} style={{...css.select,width:220,padding:"4px 8px",fontSize:12.5}}><option value="">Elegir proveedor…</option>{provsTabla.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}</select><Bt sm v="gry" dis={!sel||!puedeAs} onClick={()=>asignar(x.sku,sel)}>Asignar</Bt></div></td>
        </tr>})}</tbody>
      </table>
      {spVis.length>limSp&&<div style={{marginTop:8}}><Bt sm v="gry" onClick={()=>setLimSp(l=>l+40)}>Mostrar 40 más ({fN(spVis.length-limSp)} restantes)</Bt></div>}</div>}
    </PcPaso>

    <PcPaso n={6} titulo="Historial de cambios" sub="Cada cambio de parámetro o de proveedor queda registrado con quién lo hizo, cuándo y el valor anterior.">
      {hist.length===0?<div style={{fontSize:12.5,color:"#6E6E73"}}>Todavía no hay cambios registrados.</div>:
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
        <thead><tr style={{borderBottom:"1px solid #E5E7EB"}}><th style={{...th,textAlign:"left"}}>Fecha</th><th style={{...th,textAlign:"left"}}>Quién</th><th style={{...th,textAlign:"left"}}>Parámetro</th><th style={{...th,textAlign:"left"}}>Cambio</th></tr></thead>
        <tbody>{hist.map(h=><tr key={h.id} style={{borderBottom:"1px solid #F3F4F6"}}>
          <td style={{padding:"6px 8px",whiteSpace:"nowrap",color:"#6E6E73"}}>{fechaC(h.fecha)}</td>
          <td style={{padding:"6px 8px",fontWeight:600}}>{h.usuario}</td>
          <td style={{padding:"6px 8px"}}>{etiqHist(h)}</td>
          <td style={{padding:"6px 8px"}}>{h.accion==="INSERT"?<span>asignado: <b>{fmtHist(h,h.valor_nuevo)}</b></span>:h.accion==="DELETE"?<span>eliminado (era {fmtHist(h,h.valor_anterior)})</span>:<span>{fmtHist(h,h.valor_anterior)} <span style={{color:"#9CA3AF"}}>→</span> <b>{fmtHist(h,h.valor_nuevo)}</b></span>}</td>
        </tr>)}</tbody>
      </table></div>}
    </PcPaso>
  </div>
}
function PlegableV1({children}){
  const[ab,setAb]=useState(false)
  return <div style={{background:"#fff",border:"1px dashed #D1D5DB",borderRadius:10,marginBottom:14}}>
    <button onClick={()=>setAb(a=>!a)} style={{width:"100%",textAlign:"left",background:"none",border:"none",padding:"12px 18px",cursor:"pointer",display:"flex",alignItems:"center",gap:8}}>
      <span style={{fontSize:13,color:"#6E6E73"}}>{ab?"▾":"▸"}</span>
      <span style={{fontSize:13.5,fontWeight:700,color:"#3A3A3C"}}>Parámetros del cálculo anterior (Excel)</span>
      <span style={{fontSize:12,color:"#9CA3AF"}}>· solo afectan la reposición cargada desde el Excel de BSALE; la compra sugerida hoy usa la política de arriba</span>
    </button>
    {ab&&<div style={{padding:"0 14px 14px"}}>{children}</div>}
  </div>
}

function ConfigView({config,saveConfig,params,setParams,paramsABCD,setParamsABCD,provs,setProvs,users,setUsers,sucursales=[],setSucursales,h,configTab,setConfigTab,loadAll,cu}){
  // ⭐ Estados de guardado por sección Config Reposición
  const[savingFab,setSavingFab]=useState(false)
  const[savingAbcd,setSavingAbcd]=useState(false)
  const[savingQuiebre,setSavingQuiebre]=useState(false)
  const[savingAvanzado,setSavingAvanzado]=useState(false)
  const[savedSec,setSavedSec]=useState(null) // sección que acaba de guardarse

  const markSaved=(sec)=>{setSavedSec(sec);setTimeout(()=>setSavedSec(null),2500)}

  // Recalcular productos en BD para todos los tipos (fab/cob)
  const aplicarFabCob=async()=>{
    setSavingFab(true)
    try{
      let n=0
      for(const tp of params){
        const{data:prods}=await supabase.from('productos').select('sku,vta_prom_diaria,clasif_abcd,stock_actual,stock_transito').eq('tipo_producto',tp.tipo_producto).gt('vta_prom_diaria',0)
        if(!prods?.length)continue
        for(const p of prods){
          const emerg=(paramsABCD||[]).find(a=>a.clasificacion===p.clasif_abcd)?.dias_emergencia||5
          const ptoRe=Math.round(p.vta_prom_diaria*(tp.dias_fabricacion+emerg))
          const posicion=(p.stock_actual||0)+(p.stock_transito||0);const repo=posicion<=ptoRe?Math.max(0,Math.round((p.vta_prom_diaria*tp.periodo_cobertura)+ptoRe-posicion)):0
          await supabase.from('productos').update({dias_fabricacion:tp.dias_fabricacion,periodo_cubrir:tp.periodo_cobertura,punto_reorden:ptoRe,reposicion_necesaria:repo,costo_reposicion:repo*(p.costo_unitario||0),estado:repo>0?'Reposición':'Stock suficiente'}).eq('sku',p.sku)
          n++
        }
      }
      markSaved('fab')
      alert(`✓ ${n} productos recalculados con tiempos fab/cob actualizados.`)
    }catch(e){alert('Error: '+e.message)}
    setSavingFab(false)
  }

  // Recalcular punto de reorden para todos los SKUs (días emergencia ABCD cambió)
  const aplicarAbcd=async()=>{
    setSavingAbcd(true)
    try{
      let n=0
      for(const abcd of paramsABCD){
        const{data:prods}=await supabase.from('productos').select('sku,vta_prom_diaria,dias_fabricacion,stock_actual,stock_transito,costo_unitario,periodo_cubrir').eq('clasif_abcd',abcd.clasificacion).gt('vta_prom_diaria',0)
        if(!prods?.length)continue
        for(const p of prods){
          const ptoRe=Math.round(p.vta_prom_diaria*(p.dias_fabricacion+abcd.dias_emergencia))
          const posicion=(p.stock_actual||0)+(p.stock_transito||0);const repo=posicion<=ptoRe?Math.max(0,Math.round((p.vta_prom_diaria*(p.periodo_cubrir||90))+ptoRe-posicion)):0
          await supabase.from('productos').update({dias_emergencia:abcd.dias_emergencia,punto_reorden:ptoRe,reposicion_necesaria:repo,costo_reposicion:repo*(p.costo_unitario||0),estado:repo>0?'Reposición':'Stock suficiente'}).eq('sku',p.sku)
          n++
        }
      }
      markSaved('abcd')
      alert(`✓ ${n} productos recalculados con días de emergencia ABCD actualizados.`)
    }catch(e){alert('Error: '+e.message)}
    setSavingAbcd(false)
  }

  // Detección de quiebres: solo afecta al promedio — se aplica en próximo upload BSALE
  // Pero sí podemos guardar la config y notificar
  const aplicarQuiebre=async()=>{
    setSavingQuiebre(true)
    try{
      await saveConfig('umbral_quiebre_pct',config.umbral_quiebre_pct||30)
      markSaved('quiebre')
      alert('✓ Umbral de quiebre guardado. Se aplicará al próximo procesamiento del Excel BSALE.')
    }catch(e){alert('Error: '+e.message)}
    setSavingQuiebre(false)
  }

  // Parámetros avanzados: guardar y notificar
  const aplicarAvanzado=async()=>{
    setSavingAvanzado(true)
    try{
      await saveConfig('excluir_mes_actual',config.excluir_mes_actual)
      await saveConfig('meses_analisis',config.meses_analisis||4)
      markSaved('avanzado')
      alert('✓ Parámetros avanzados guardados. Se aplicarán al próximo procesamiento del Excel BSALE.')
    }catch(e){alert('Error: '+e.message)}
    setSavingAvanzado(false)
  }
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
    <div style={{fontSize:20,fontWeight:800,color:"#1C1C1E",letterSpacing:"-0.02em",marginBottom:12}}>Configuración</div>
    <div style={{display:"flex",gap:4,marginBottom:14,background:"#E5E7EB",borderRadius:10,padding:3}}>
      {tabs.map(t=><button key={t.k} onClick={()=>setConfigTab(t.k)} style={{flex:1,padding:"8px 4px",borderRadius:8,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",background:configTab===t.k?"#fff":"transparent",color:configTab===t.k?"#1C1C1E":"#6E6E73",boxShadow:configTab===t.k?"0 1px 3px rgba(0,0,0,0.1)":"none"}}>{t.ic} {t.l}</button>)}
    </div>

    {configTab==="params"&&<div>
      <PoliticaCompra cu={cu} provs={provs} loadAll={loadAll}/>
      <PlegableV1>
      <Cd><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:15,fontWeight:700}}>Tiempos fabricación y cobertura</div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {savedSec==="fab"&&<Bd c="#1E7A44" bg="#1E7A4415">✓ Guardado</Bd>}
            <Bt sm variant={savingFab?"secondary":"primary"} disabled={savingFab} onClick={aplicarFabCob}>{savingFab?"Aplicando...":"↻ Aplicar y recalcular BD"}</Bt>
          </div>
        </div>
        <div style={{fontSize:12,color:"#6E6E73",marginBottom:10,background:"#F4F5F7",borderRadius:8,padding:"8px 12px"}}>
          Los cambios en fab/cob se guardan automáticamente fila a fila. El botón <b>recalcula punto de reorden y reposición</b> en los productos del cálculo anterior (Excel). El cálculo v2 toma estos tiempos al usar "Recalcular ahora" en el panel de arriba o en su cálculo diario.
        </div>
        {params.map((t,i)=><ParamTipoRow key={t.tipo_producto} t={t} i={i} setParams={setParams}/>)}
      </Cd>
      <Cd s={{marginTop:10}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:15,fontWeight:700}}>Stock emergencia ABCD</div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {savedSec==="abcd"&&<Bd c="#1E7A44" bg="#1E7A4415">✓ Guardado</Bd>}
            <Bt sm variant={savingAbcd?"secondary":"primary"} disabled={savingAbcd} onClick={aplicarAbcd}>{savingAbcd?"Aplicando...":"↻ Aplicar y recalcular BD"}</Bt>
          </div>
        </div>
        <div style={{fontSize:12,color:"#6E6E73",marginBottom:10,background:"#F4F5F7",borderRadius:8,padding:"8px 12px"}}>
          Los días de emergencia se guardan fila a fila. El botón <b>recalcula el punto de reorden</b> para todos los SKUs de cada clase ABCD.
        </div>
        {paramsABCD.map((e,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #F4F5F7"}}>
          <Bd c={CL[e.clasificacion]?.c} bg={CL[e.clasificacion]?.bg} lg>Clase {e.clasificacion}</Bd>
          <ParamAbcdInput e={e} i={i} setParamsABCD={setParamsABCD}/>
          <span style={{fontSize:12,color:"#6E6E73"}}>días — {e.descripcion}</span>
        </div>)}
      </Cd>
      <Cd s={{marginTop:10}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:15,fontWeight:700}}>Detección de quiebres <span style={{fontSize:12,fontWeight:500,color:"#6E6E73"}}>· cálculo anterior (Excel)</span></div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {savedSec==="quiebre"&&<Bd c="#1E7A44" bg="#1E7A4415">✓ Guardado</Bd>}
            <Bt sm variant={savingQuiebre?"secondary":"primary"} disabled={savingQuiebre} onClick={aplicarQuiebre}>{savingQuiebre?"Guardando...":"💾 Confirmar umbral"}</Bt>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
          <span style={{fontSize:13,fontWeight:600}}>Umbral:</span>
          <input type="range" min={10} max={50} step={5} value={config.umbral_quiebre_pct||30} onChange={e=>saveConfig("umbral_quiebre_pct",e.target.value)} style={{flex:1,accentColor:"#1D4E89"}}/>
          <Bd c="#B25E09" bg="#B25E0915" lg>{config.umbral_quiebre_pct||30}%</Bd>
        </div>
        <div style={{background:"#F4F5F7",borderRadius:10,padding:12,fontSize:12,color:"#6E6E73",lineHeight:1.6}}>Meses con venta menor al {config.umbral_quiebre_pct||30}% del máximo se excluyen del promedio para no subestimar la demanda real. Requiere al menos 2 meses normales para compensar.<br/><b>Nota:</b> Este parámetro se aplica al próximo procesamiento del Excel BSALE.</div>
      </Cd>

      {/* ⭐ v48: Parámetros avanzados del cálculo de venta promedio */}
      <Cd s={{marginTop:10}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
          <div style={{fontSize:15,fontWeight:700}}>Parámetros avanzados del promedio de venta <span style={{fontSize:12,fontWeight:500,color:"#6E6E73"}}>· cálculo anterior (Excel)</span></div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {savedSec==="avanzado"&&<Bd c="#1E7A44" bg="#1E7A4415">✓ Guardado</Bd>}
            <Bt sm variant={savingAvanzado?"secondary":"primary"} disabled={savingAvanzado} onClick={aplicarAvanzado}>{savingAvanzado?"Guardando...":"💾 Confirmar parámetros"}</Bt>
          </div>
        </div>
        <div style={{fontSize:12,color:"#6E6E73",marginBottom:12}}>Estos parámetros afectan tanto al cálculo de reposición como al módulo de Cobertura. Se aplican al próximo procesamiento del Excel BSALE.</div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div style={{background:"#B25E0910",borderRadius:10,padding:14,border:"1px solid #B25E0930"}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
              <input type="checkbox" checked={config.excluir_mes_actual!=="false"} onChange={e=>saveConfig("excluir_mes_actual",e.target.checked?"true":"false")} style={{width:18,height:18,accentColor:"#B25E09"}}/>
              <span style={{fontSize:13,fontWeight:700}}>Excluir mes en curso</span>
            </label>
            <div style={{fontSize:12,color:"#6E6E73",marginTop:6,lineHeight:1.5}}>El último mes del reporte BSALE está parcial (se está cursando). Si está activo, se ignora del cálculo de venta promedio para evitar subestimar la demanda real.</div>
            <div style={{marginTop:8}}>
              <Bd c={config.excluir_mes_actual!=="false"?"#1E7A44":"#6E6E73"} bg={config.excluir_mes_actual!=="false"?"#1E7A4415":"#6E6E7315"}>
                {config.excluir_mes_actual!=="false"?`✓ Usando ${(Number(config.meses_analisis)||4)-1} meses completos`:`Usando los ${Number(config.meses_analisis)||4} meses (incluyendo mes en curso)`}
              </Bd>
            </div>
          </div>

          <div style={{background:"#fff",borderRadius:10,padding:14,border:"1px solid #E5E7EB"}}>
            <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>Meses totales del reporte</div>
            <select value={config.meses_analisis||4} onChange={e=>saveConfig("meses_analisis",e.target.value)} style={css.select}>
              <option value={3}>3 meses</option>
              <option value={4}>4 meses</option>
              <option value={6}>6 meses</option>
              <option value={12}>12 meses</option>
            </select>
            <div style={{fontSize:12,color:"#6E6E73",marginTop:8,lineHeight:1.5}}>Cantidad total de meses de venta que trae el Excel BSALE. El promedio se calcula sobre estos (menos 1 si "Excluir mes en curso" está activo).</div>
          </div>
        </div>

        <div style={{marginTop:12,padding:"10px 14px",background:"#1D4E8908",borderRadius:8,fontSize:12,color:"#3A3A3C"}}>
          💡 <strong>Ejemplo</strong>: si subiste un reporte con 4 meses (Ene/Feb/Mar/Abr) y estamos en abril, con "Excluir mes en curso" activado el promedio se calcula solo con Ene/Feb/Mar (3 meses completos), ignorando abril que está parcial.
        </div>
      </Cd>
      </PlegableV1>
    </div>}

    {configTab==="bsale"&&<BsaleConfig config={config} saveConfig={saveConfig} bsaleToken={bsaleToken} setBsaleToken={setBsaleToken} saveBsale={saveBsale} loadAll={loadAll}/>}

    {configTab==="provs"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div style={{fontSize:15,fontWeight:700}}>Proveedores ({provs.length})</div><Bt v="pri" sm onClick={()=>{setProvForm({id:"",nombre:"",tipo:"Nacional",condicion_pago:"Contado",encargado:"",correo:"",activo:true,pct_fabricacion:0,pct_embarque:0,pct_puerto:0,factura_con_guia:false});setEditing(null);setShowProvForm(true)}} ic="➕">Nuevo</Bt></div>
      {provs.map(s=><Cd key={s.id} s={{marginBottom:6,opacity:s.activo?1:0.5}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"start"}}>
          <div><div style={{fontSize:14,fontWeight:600}}>{s.nombre}</div><div style={{fontSize:12,color:"#6E6E73"}}>{s.encargado}{s.correo?` · ${s.correo}`:""}</div><div style={{display:"flex",gap:4,marginTop:4}}><Bd c={s.tipo==="Importación"?"#B42318":"#1D4E89"} bg={s.tipo==="Importación"?"#B4231815":"#1D4E8915"}>{s.tipo}</Bd><Bd>{s.condicion_pago}</Bd>{s.pct_fabricacion>0&&<Bd c="#B25E09" bg="#B25E0915">{s.pct_fabricacion}%+{s.pct_embarque}%+{s.pct_puerto}%</Bd>}</div></div>
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
          <label style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"#F9FAFB",borderRadius:10,border:"1px solid #E5E7EB",cursor:"pointer"}}>
            <input type="checkbox" checked={provForm.factura_con_guia||false} onChange={e=>setProvForm({...provForm,factura_con_guia:e.target.checked})} style={{width:18,height:18,accentColor:"#1D4E89"}}/>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:"#1C1C1E"}}>Emite guía + factura en documento combinado</div>
              <div style={{fontSize:12,color:"#6E6E73",marginTop:2}}>{provForm.factura_con_guia?"✓ Cada entrega incluye guía y factura en el mismo documento":"Guías y facturas se emiten por separado (la factura puede cubrir varias guías)"}</div>
            </div>
          </label>
        </Fl>
        <Bt v="pri" full dis={!provForm.nombre} onClick={saveProv} ic="💾">Guardar</Bt>
      </Sheet>
    </div>}

    {configTab==="sucursales"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div><div style={{fontSize:15,fontWeight:700}}>Sucursales ({sucursales.length})</div><div style={{fontSize:12,color:"#6E6E73"}}>Catálogo de puntos de venta y centros de distribución</div></div>
        <Bt v="pri" sm onClick={()=>{setSucForm({id:"",codigo:"",nombre:"",direccion:"",comuna:"",region:"",es_cd:false,activo:true,orden:sucursales.length});setEditing(null);setShowSucForm(true)}} ic="➕">Nueva</Bt>
      </div>
      {sucursales.map(s=><Cd key={s.id} s={{marginBottom:6,opacity:s.activo===false?0.5:1}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:44,height:44,borderRadius:10,background:s.es_cd?"#1D4E8920":"#1D4E8920",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{s.es_cd?"🏭":"🏬"}</div>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:14,fontWeight:700}}>{s.nombre}</span>
                <Bd c={s.es_cd?"#1D4E89":"#1D4E89"} bg={s.es_cd?"#1D4E8915":"#1D4E8915"}>{s.codigo}</Bd>
                {s.es_cd&&<Bd c="#1D4E89" bg="#1D4E8915">Centro Distribución</Bd>}
              </div>
              <div style={{fontSize:12,color:"#6E6E73",marginTop:3}}>{[s.direccion,s.comuna,s.region].filter(Boolean).join(" · ")||"Sin dirección"}</div>
              <div style={{fontSize:11,color:"#AEAEB2",marginTop:2}}>{users.filter(u=>u.sucursal_id===s.id).length} usuarios asignados</div>
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
          <label style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:"#F9FAFB",borderRadius:10,border:"1px solid #E5E7EB",cursor:"pointer"}}>
            <input type="checkbox" checked={sucForm.es_cd||false} onChange={e=>setSucForm({...sucForm,es_cd:e.target.checked})} style={{width:18,height:18,accentColor:"#1D4E89"}}/>
            <div><div style={{fontSize:13,fontWeight:600}}>Centro de Distribución</div><div style={{fontSize:12,color:"#6E6E73"}}>Destino por default para OCs · recibe y redistribuye</div></div>
          </label>
        </Fl>
        <Bt v="pri" full dis={!sucForm.nombre||!sucForm.codigo} onClick={saveSuc} ic="💾">Guardar</Bt>
      </Sheet>
    </div>}

    {configTab==="users"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><div><div style={{fontSize:15,fontWeight:700}}>Usuarios ({users.length})</div><div style={{fontSize:12,color:"#6E6E73"}}>Creá usuarios, asigna sucursal y personalizá permisos</div></div><Bt v="pri" sm onClick={()=>{setUserForm({id:"",nombre:"",correo:"",rol:"analista",firma_digital:"",activo:true,avatar:"",sucursal_id:null,permisos_custom:null});setEditing(null);setShowUserForm(true)}} ic="➕">Nuevo</Bt></div>
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
                {suc&&<Bd c={suc.es_cd?"#1D4E89":"#1D4E89"} bg={suc.es_cd?"#1D4E8915":"#1D4E8915"}>🏬 {suc.nombre}</Bd>}
                {tieneCustom&&<Bd c="#B25E09" bg="#B25E0915">🔑 Permisos custom</Bd>}
              </div>
              <div style={{fontSize:12,color:"#6E6E73",marginTop:3}}>{u.correo}</div>
              <div style={{background:"#F4F5F7",borderRadius:6,padding:"4px 8px",marginTop:4,display:"inline-block"}}><span style={{fontSize:12,fontStyle:"italic",fontWeight:600,color:r.c}}>{u.firma_digital||u.nombre}</span></div>
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
            <div style={{background:"#F9FAFB",borderRadius:10,padding:"12px 14px",border:"1px solid #E5E7EB"}}>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:10,paddingBottom:10,borderBottom:"1px solid #E5E7EB"}}>
                <input type="checkbox" checked={usaCustom} onChange={e=>{
                  if(e.target.checked)setUserForm({...userForm,permisos_custom:[...permisosRol]})
                  else setUserForm({...userForm,permisos_custom:null})
                }} style={{width:16,height:16,accentColor:"#B25E09"}}/>
                <div><div style={{fontSize:12,fontWeight:600}}>Permisos personalizados</div><div style={{fontSize:11,color:"#6E6E73"}}>{usaCustom?"Los cambios sobrescriben el rol default":`Usa los ${permisosRol.length} permisos del rol ${rolObj?.l}`}</div></div>
              </label>
              {userForm.rol==="admin"&&<div style={{padding:10,background:"#B4231808",borderRadius:8,fontSize:12,color:"#B42318",fontWeight:600,textAlign:"center"}}>🔓 Admin tiene acceso total, no se pueden restringir permisos</div>}
              {userForm.rol!=="admin"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,maxHeight:280,overflowY:"auto"}}>
                {PERMISOS.map(perm=>{
                  const activo=permisosActivos.includes(perm.k)
                  const enRol=permisosRol.includes(perm.k)
                  const diverge=usaCustom&&(activo!==enRol)
                  return<label key={perm.k} style={{display:"flex",alignItems:"flex-start",gap:6,padding:"6px 8px",borderRadius:6,background:diverge?"#B25E0912":activo?"#1E7A4408":"#F4F5F7",cursor:usaCustom?"pointer":"not-allowed",border:diverge?"1px solid #B25E0940":"1px solid transparent",opacity:usaCustom?1:0.65}}>
                    <input type="checkbox" checked={activo} disabled={!usaCustom} onChange={e=>{
                      if(!usaCustom)return
                      const nuevos=e.target.checked?[...userForm.permisos_custom,perm.k]:userForm.permisos_custom.filter(x=>x!==perm.k)
                      setUserForm({...userForm,permisos_custom:nuevos})
                    }} style={{marginTop:2,accentColor:"#1E7A44"}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:600,color:activo?"#1C1C1E":"#6E6E73"}}>{perm.l}{diverge&&<span style={{color:"#B25E09",fontSize:10.5,marginLeft:4}}>●</span>}</div>
                      <div style={{fontSize:10.5,color:"#6E6E73",lineHeight:1.3}}>{perm.d}</div>
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
        <div style={{fontSize:12,color:"#6E6E73",marginBottom:12}}>Permisos default por rol · Pueden sobrescribirse individualmente desde Usuarios</div>
        <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:900}}>
          <thead><tr style={{background:"#F4F5F7"}}>
            <th style={{padding:"8px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73",borderBottom:"2px solid #E5E7EB",position:"sticky",left:0,background:"#F4F5F7"}}>Rol</th>
            {PERMISOS.map(p=><th key={p.k} style={{padding:"8px 4px",textAlign:"center",fontSize:10.5,fontWeight:600,color:"#6E6E73",borderBottom:"2px solid #E5E7EB",whiteSpace:"nowrap"}} title={p.d}>{p.l}</th>)}
          </tr></thead>
          <tbody>{ROLES.map(r=><tr key={r.k} style={{borderBottom:"1px solid #F4F5F7"}}>
            <td style={{padding:"8px",position:"sticky",left:0,background:"#fff"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:5,background:r.c}}/><strong>{r.l}</strong></div></td>
            {PERMISOS.map(p=><td key={p.k} style={{padding:"8px 4px",textAlign:"center"}}>{r.p.includes("todo")||r.p.includes(p.k)?<span style={{color:"#1E7A44",fontSize:14}}>✓</span>:<span style={{color:"#D1D1D6",fontSize:14}}>—</span>}</td>)}
          </tr>)}</tbody>
        </table></div>
      </Cd>

      <Cd s={{marginTop:10}}><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>👥 Asignación de administradores</div>
        <div style={{fontSize:12,color:"#6E6E73",marginBottom:10}}>Selecciona qué usuarios tienen rol de administrador (acceso total).</div>
        {users.map(u=>{const r=rl(u);const isAdm=u.rol==="admin"||u.rol==="dir_general"
          return<div key={u.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #F4F5F7"}}>
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
        <div style={{fontSize:12,color:"#6E6E73",marginTop:2}}>Asigna qué usuario recibe el email cuando una OC entra a cada estado del flujo. {rows.length} estados configurables.</div>
      </div>
      <Bt sm v="gry" onClick={cargar} ic={loading?"⏳":"🔄"} dis={loading}>{loading?"Cargando":"Refrescar"}</Bt>
    </div>

    {msg&&<div style={{padding:"8px 12px",background:"#1E7A4415",borderRadius:8,color:"#1E7A44",fontSize:12,fontWeight:600,marginBottom:10}}>{msg}</div>}

    <div style={{background:"#fff",borderRadius:10,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,0.04)"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:"#F4F5F7"}}>
          <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",letterSpacing:"0.04em"}}>Estado de la OC</th>
          <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",letterSpacing:"0.04em"}}>Usuario destinatario</th>
          <th style={{padding:"10px 12px",textAlign:"center",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",letterSpacing:"0.04em",width:90}}>CC Admin</th>
          <th style={{padding:"10px 12px",textAlign:"center",fontSize:11,fontWeight:700,color:"#6E6E73",textTransform:"uppercase",letterSpacing:"0.04em",width:80}}>Activo</th>
        </tr></thead>
        <tbody>
          {rows.map(r=>{
            const estaGuardando=saving===r.estado_oc
            const destinatario=usuariosActivos.find(u=>u.id===r.usuario_destino_id)
            const sinDestino=!r.usuario_destino_id&&!r.cc_admin
            return<tr key={r.estado_oc} style={{borderTop:"1px solid #F4F5F7",background:sinDestino?"#FFF9E6":"#fff"}}>
              <td style={{padding:"10px 12px",verticalAlign:"top"}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <Bd c={STS[r.estado_oc]?.c} bg={STS[r.estado_oc]?.bg}>{STS[r.estado_oc]?.ic} {r.estado_oc}</Bd>
                  {sinDestino&&<Bd c="#B25E09" bg="#B25E0915">⚠ sin destino</Bd>}
                </div>
                {r.descripcion&&<div style={{fontSize:12,color:"#6E6E73",marginTop:4}}>{r.descripcion}</div>}
              </td>
              <td style={{padding:"10px 12px",verticalAlign:"top"}}>
                <select value={r.usuario_destino_id||""} onChange={e=>actualizar(r.estado_oc,'usuario_destino_id',e.target.value||null)} disabled={estaGuardando} style={{...css.select,fontSize:12}}>
                  <option value="">— Nadie asignado —</option>
                  {usuariosActivos.map(u=><option key={u.id} value={u.id}>{u.nombre} ({u.rol}) · {u.correo}</option>)}
                </select>
                {destinatario&&<div style={{fontSize:11,color:"#6E6E73",marginTop:3}}>Actual: {destinatario.correo}</div>}
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

    <div style={{marginTop:14,padding:"10px 12px",background:"#1D4E8910",borderRadius:8,fontSize:12,color:"#3A3A3C"}}>
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

  const opColor=op=>op==="DELETE"?"#B42318":op==="UPDATE"?"#B25E09":op==="INSERT"?"#1E7A44":"#6E6E73"
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

      alert(`✓ OC ${ocSnapshot.id} restaurada correctamente.\n\nRevisá el detalle en Órdenes. Si necesitas restaurar items o pagos, hay que hacerlo manualmente.`)
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
        <div style={{fontSize:12,color:"#6E6E73"}}>Registro de todas las acciones · {logs.length} eventos recientes</div>
      </div>
      <div style={{display:"flex",gap:6}}>
        <Bt sm v="gry" onClick={cargar} ic={loading?"⏳":"🔄"} dis={loading}>{loading?"Cargando...":"Refrescar"}</Bt>
      </div>
    </div>

    {/* Card destacada: OCs eliminadas restaurables */}
    {ocsEliminadas.length>0&&<Cd ac="#B25E09" s={{marginBottom:14,background:"#B25E0908"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:700,color:"#B25E09",marginBottom:4}}>🗑 OCs eliminadas ({ocsEliminadas.length})</div>
          <div style={{fontSize:12,color:"#6E6E73",marginBottom:10}}>Órdenes borradas que se pueden restaurar con sus datos originales. Los items y pagos NO se restauran automáticamente.</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {ocsEliminadas.slice(0,5).map(log=>{
              const snap=log.cambios?.before||log.cambios?.old||log.cambios?.data||log.cambios||{}
              const ocId=snap.id||log.registro_id||log.oc_id||"—"
              return<div key={log.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:"#fff",borderRadius:8,border:"1px solid #B25E0930"}}>
                <div>
                  <span style={{fontSize:12,fontWeight:700,fontFamily:"monospace"}}>{ocId}</span>
                  {snap.proveedor_id&&<span style={{fontSize:12,color:"#6E6E73",marginLeft:8}}>· {snap.proveedor_id}</span>}
                  {snap.total_clp&&<span style={{fontSize:12,color:"#6E6E73",marginLeft:8}}>· {fmt(snap.total_clp)}</span>}
                  <div style={{fontSize:11,color:"#AEAEB2",marginTop:2}}>Eliminada por {log.usuario_nombre||"?"} · {new Date(log.created_at).toLocaleString("es-CL")}</div>
                </div>
                <div style={{display:"flex",gap:4}}>
                  <Bt sm v="pri" onClick={()=>restaurarOC(log)} dis={restoring===log.id} ic={restoring===log.id?"⏳":"↩"}>{restoring===log.id?"Restaurando":"Restaurar"}</Bt>
                  <Bt sm v="dan" onClick={()=>eliminarDefinitivo(log)} dis={restoring===log.id} ic="🗑">Eliminar def.</Bt>
                </div>
              </div>
            })}
            {ocsEliminadas.length>5&&<div style={{fontSize:12,color:"#6E6E73",textAlign:"center",padding:4}}>+ {ocsEliminadas.length-5} más en el registro completo abajo</div>}
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
    <div style={{background:"#fff",borderRadius:10,overflow:"hidden",border:"1px solid #E5E7EB"}}>
      {fil.length===0?<div style={{padding:40,textAlign:"center",color:"#6E6E73"}}>{loading?"Cargando...":"Sin registros que coincidan"}</div>:
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:700}}>
            <thead><tr style={{background:"#F8F8FA"}}>
              {["Fecha","Operación","Tabla","Registro","OC","Usuario",""].map((h,i)=><th key={i} style={{padding:"8px 10px",textAlign:i===6?"right":"left",fontSize:10.5,fontWeight:700,color:"#6E6E73",borderBottom:"2px solid #E5E7EB",whiteSpace:"nowrap"}}>{h}</th>)}
            </tr></thead>
            {fil.map(l=>{
              const isExp=expanded===l.id
              return<tbody key={l.id}>
                <tr style={{borderBottom:"1px solid #F4F5F7",cursor:"pointer"}} onClick={()=>setExpanded(isExp?null:l.id)}>
                  <td style={{padding:"6px 10px",color:"#6E6E73",fontFamily:"monospace",fontSize:11,whiteSpace:"nowrap"}}>{new Date(l.created_at).toLocaleString("es-CL",{year:"2-digit",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</td>
                  <td style={{padding:"6px 10px"}}><span style={{fontSize:11,fontWeight:700,color:opColor(l.operacion),background:opColor(l.operacion)+"15",padding:"2px 7px",borderRadius:4}}>{opIcon(l.operacion)} {l.operacion}</span></td>
                  <td style={{padding:"6px 10px",fontFamily:"monospace",fontSize:11,color:"#6E6E73"}}>{l.tabla}</td>
                  <td style={{padding:"6px 10px",fontFamily:"monospace",fontSize:11,fontWeight:600}}>{l.registro_id||"—"}</td>
                  <td style={{padding:"6px 10px",fontFamily:"monospace",fontSize:11,fontWeight:600,color:"#1D4E89"}}>{l.oc_id||"—"}</td>
                  <td style={{padding:"6px 10px"}}><div style={{fontSize:12,fontWeight:600}}>{l.usuario_nombre||"—"}</div></td>
                  <td style={{padding:"6px 10px",textAlign:"right",color:"#6E6E73"}}>{isExp?"▲":"▼"}</td>
                </tr>
                {isExp&&<tr><td colSpan={7} style={{padding:"0 10px 10px",background:"#F8F8FA"}}>
                  <div style={{background:"#fff",borderRadius:8,padding:"10px 12px",border:"1px solid #E5E7EB"}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#6E6E73",marginBottom:6,textTransform:"uppercase"}}>Cambios registrados</div>
                    <pre style={{margin:0,fontSize:11,fontFamily:"monospace",color:"#1C1C1E",whiteSpace:"pre-wrap",wordBreak:"break-all",maxHeight:300,overflowY:"auto"}}>{JSON.stringify(l.cambios,null,2)||"—"}</pre>
                    {l.ip&&<div style={{fontSize:11,color:"#AEAEB2",marginTop:6}}>IP: {l.ip}</div>}
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
    if(s==="enviado")return{c:"#1E7A44",bg:"#1E7A4415",ic:"✓"}
    if(s==="pendiente")return{c:"#B25E09",bg:"#B25E0915",ic:"⏳"}
    if(s==="error"||s==="fallo")return{c:"#B42318",bg:"#B4231815",ic:"✕"}
    return{c:"#6E6E73",bg:"#F4F5F7",ic:"•"}
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
        <div style={{fontSize:12,color:"#6E6E73"}}>Configuración y registro de envíos automáticos del sistema</div>
      </div>
      <Bt sm v="gry" onClick={cargar} ic={loading?"⏳":"🔄"} dis={loading}>{loading?"Cargando...":"Refrescar"}</Bt>
    </div>

    {/* Configuración general */}
    <Cd s={{marginBottom:14}}>
      <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>⚙️ Configuración general</div>
      <Fl l="Sistema de envío">
        <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"#F9FAFB",borderRadius:10,border:"1px solid #E5E7EB",cursor:"pointer"}}>
          <input type="checkbox" checked={emailActivo} onChange={e=>setEmailActivo(e.target.checked)} style={{width:18,height:18,accentColor:"#1E7A44"}}/>
          <div>
            <div style={{fontSize:13,fontWeight:600}}>{emailActivo?"✓ Envío de emails activado":"✕ Envío de emails desactivado"}</div>
            <div style={{fontSize:12,color:"#6E6E73"}}>{emailActivo?"El sistema enviará notificaciones automáticamente a los destinatarios configurados":"Los eventos se registran pero no se envían emails"}</div>
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
          alert(`✓ Notificación de test creada para ${destinatario}.\n\nEl trigger SQL debería haberla enviado automáticamente. Revisa:\n1. Tu bandeja de entrada (puede tardar hasta 1 min)\n2. Esta lista (refrescá) — el estado debería pasar a "Enviado"\n3. Los logs de la edge function en Supabase Dashboard`)
          cargar()
        }} ic="🧪">Enviar email de prueba</Bt>
      </div>
    </Cd>

    {/* Resumen */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
      {[["Total",resumen.total,"#1D4E89","📧"],["Enviados",resumen.enviados,"#1E7A44","✓"],["Pendientes",resumen.pendientes,"#B25E09","⏳"],["Errores",resumen.errores,"#B42318","✕"]].map(([l,n,c,i])=><div key={l} style={{background:"#fff",borderRadius:10,padding:"10px 14px",border:"1px solid #E5E7EB",textAlign:"center"}}>
        <div style={{fontSize:18,fontWeight:800,color:c}}>{i} {n}</div>
        <div style={{fontSize:11,color:"#6E6E73",fontWeight:600,marginTop:2,textTransform:"uppercase"}}>{l}</div>
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
    <div style={{background:"#fff",borderRadius:10,overflow:"hidden",border:"1px solid #E5E7EB"}}>
      {fil.length===0?<div style={{padding:40,textAlign:"center",color:"#6E6E73"}}>{loading?"Cargando...":"Sin registros"}</div>:
        fil.map(n=>{
          const c=estColor(n.estado)
          return<div key={n.id} style={{padding:"10px 14px",borderBottom:"1px solid #F4F5F7",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:200}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                <span style={{fontSize:12,fontWeight:700,color:c.c,background:c.bg,padding:"2px 7px",borderRadius:4}}>{c.ic} {n.estado||"—"}</span>
                {n.tipo&&<span style={{fontSize:11,color:"#6E6E73",fontWeight:600,background:"#F4F5F7",padding:"2px 6px",borderRadius:4}}>{n.tipo}</span>}
                {n.oc_id&&<span style={{fontSize:11,fontFamily:"monospace",color:"#1D4E89",fontWeight:600}}>{n.oc_id}</span>}
              </div>
              <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{n.asunto||"(sin asunto)"}</div>
              <div style={{fontSize:12,color:"#6E6E73"}}>
                {n.destino_nombre?`${n.destino_nombre} · `:""}<span style={{fontFamily:"monospace"}}>{n.destino_correo||"—"}</span>
              </div>
              {n.mensaje&&<div style={{fontSize:12,color:"#6E6E73",marginTop:4,maxHeight:60,overflow:"hidden",textOverflow:"ellipsis"}}>{n.mensaje.length>200?n.mensaje.slice(0,200)+"...":n.mensaje}</div>}
              <div style={{fontSize:11,color:"#AEAEB2",marginTop:4}}>
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
        else if(hl==="stock actual"||hl.includes("stock actual"))colMap.stock=i
        else if(hl.includes("valor total"))colMap.valorStock=i
        else if(hl.includes("venta bruta")||hl.includes("total venta"))colMap.ventaBruta=i
      })
      // ⭐ v53: Detección DINÁMICA de TODAS las columnas "Unidades Vendida <Mes> <Año>"
      // Cada mes se parsea a clave 'YYYY-MM' para alimentar la matriz histórica ventas_mensuales.
      const MESES_ES={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12}
      const parseMesKey=(nombre)=>{ // "Abril 2026" → "2026-04"
        const m=String(nombre||"").trim().toLowerCase().match(/([a-záéíóúñ]+)\s+(\d{4})/)
        if(!m)return null
        const num=MESES_ES[m[1].normalize("NFD").replace(/[\u0300-\u036f]/g,"")]
        if(!num)return null
        return `${m[2]}-${String(num).padStart(2,"0")}`
      }
      const colMeses=[] // {idx, nombre, mesKey}
      headers.forEach((h,i)=>{
        const hl=h.toLowerCase()
        if((hl.includes("vendida")||hl.includes("vendidas"))&&hl.includes("unidades")){
          const nombre=h.replace(/unidades\s+vendidas?\s*/i,"").trim()
          const mesKey=parseMesKey(nombre)
          if(mesKey)colMeses.push({idx:i,nombre,mesKey})
          else addLog(`⚠ Columna de venta con mes no reconocido: "${h}" — se ignora`,"warn")
        }
      })
      if(colMeses.length===0){addLog("⚠ No se detectaron columnas 'Unidades Vendida'. Verifica el formato del reporte BSALE.","error")}
      addLog(`📅 Meses en el archivo: ${colMeses.map(c=>c.nombre).join(" · ")}`,"success")
      addLog(`Columnas mapeadas: tipo=${colMap.tipo}, sku=${colMap.sku}, stock=${colMap.stock}, meses=${colMeses.length}`)

      // Parse data rows and CONSOLIDATE by SKU (sum across sucursales)
      const skuMap={}
      let dataRows=0
      for(let i=headerIdx+1;i<rows.length;i++){
        const r=rows[i];if(!r||!r[colMap.sku])continue
        const sku=String(r[colMap.sku]).trim();if(!sku)continue
        dataRows++
        if(!skuMap[sku]){
          skuMap[sku]={sku,producto:String(r[colMap.producto]||"").trim(),tipo_producto:String(r[colMap.tipo]||"Sin Tipo").trim(),codigo_barras:String(r[colMap.barcode]||"").trim(),stock_actual:0,costo_stock:0,venta_bruta_total:0,_ventas:{}}
        }
        const p=skuMap[sku]
        p.stock_actual+=Number(r[colMap.stock])||0
        for(const cm of colMeses){p._ventas[cm.mesKey]=(p._ventas[cm.mesKey]||0)+(Number(r[cm.idx])||0)}
        p.costo_stock+=Number(r[colMap.valorStock])||0
        p.venta_bruta_total+=Number(r[colMap.ventaBruta])||0
      }
      const prodList=Object.values(skuMap)
      addLog(`✅ ${dataRows} filas procesadas → ${prodList.length} SKUs consolidados`,"success")

      // ⭐ v53: MATRIZ RODANTE — upsert a ventas_mensuales (los meses del archivo PISAN los de la BD)
      addLog("Actualizando matriz de ventas mensuales (rodante)...")
      const vmRows=[]
      const nombrePorKey={};colMeses.forEach(c=>{nombrePorKey[c.mesKey]=c.nombre})
      for(const p of prodList){
        for(const[mesKey,unidades]of Object.entries(p._ventas)){
          vmRows.push({sku:p.sku,mes:mesKey,mes_nombre:nombrePorKey[mesKey]||mesKey,unidades,actualizado:new Date().toISOString()})
        }
      }
      let vmSaved=0
      for(let i=0;i<vmRows.length;i+=500){
        const batch=vmRows.slice(i,i+500)
        const{error}=await supabase.from('ventas_mensuales').upsert(batch,{onConflict:'sku,mes'})
        if(error){addLog(`Error matriz lote ${i}: ${error.message}`,"error");break}
        vmSaved+=batch.length
      }
      addLog(`📊 Matriz: ${vmSaved} celdas SKU×mes actualizadas (${colMeses.length} meses pisados: ${colMeses.map(c=>c.nombre).join(", ")})`,"success")

      // ⭐ Leer de vuelta la VENTANA de análisis: los 6 meses calendario COMPLETOS
      // anteriores al mes en curso + el mes en curso aparte (informativo, se pisa en cada carga)
      const hoyD=new Date()
      const mesActualKey=`${hoyD.getFullYear()}-${String(hoyD.getMonth()+1).padStart(2,"0")}`
      const ventanaKeys=[] // 6 meses completos, más antiguo primero
      for(let k=6;k>=1;k--){
        const d=new Date(hoyD.getFullYear(),hoyD.getMonth()-k,1)
        ventanaKeys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`)
      }
      addLog(`📅 Ventana de análisis: ${ventanaKeys.join(" · ")} + mes en curso ${mesActualKey}`)
      // Query paginada (evita el límite de 1000 filas de Supabase)
      const vmWindow={}
      {
        const keysAll=[...ventanaKeys,mesActualKey]
        let from=0;const page=10000
        while(true){
          const{data:chunk,error}=await supabase.from('ventas_mensuales').select('sku,mes,mes_nombre,unidades').in('mes',keysAll).range(from,from+page-1)
          if(error){addLog(`Error leyendo matriz: ${error.message}`,"error");break}
          for(const row of(chunk||[])){
            if(!vmWindow[row.sku])vmWindow[row.sku]={}
            vmWindow[row.sku][row.mes]={unidades:Number(row.unidades)||0,nombre:row.mes_nombre}
          }
          if(!chunk||chunk.length<page)break
          from+=page
        }
      }
      // Asignar venta_mes_1..6 (m1=más antiguo) + venta_mes_actual a cada producto
      for(const p of prodList){
        const w=vmWindow[p.sku]||{}
        ventanaKeys.forEach((mk,i)=>{p[`venta_mes_${i+1}`]=w[mk]?.unidades||0})
        p.venta_mes_actual=w[mesActualKey]?.unidades||0
        delete p._ventas
      }
      // Guardar nombres de meses en config (encabezados de la tabla Reposición)
      const nombreDeKey=(mk)=>{
        // buscar nombre legible: primero del archivo, luego de la BD, sino armar desde la key
        if(nombrePorKey[mk])return nombrePorKey[mk]
        for(const sku in vmWindow){if(vmWindow[sku][mk]?.nombre)return vmWindow[sku][mk].nombre}
        const[y,m]=mk.split("-");const NM=["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"]
        return `${NM[Number(m)]} ${y}`
      }
      for(let k=0;k<6;k++)await saveConfig(`mes_${k+1}_nombre`,nombreDeKey(ventanaKeys[k]))
      await saveConfig("mes_actual_nombre",nombreDeKey(mesActualKey))

      // Get params
      const{data:pTypes}=await supabase.from('parametros_tipo').select('*')
      const{data:pABCD}=await supabase.from('parametros_abcd').select('*')
      const umbral=(Number(config.umbral_quiebre_pct)||30)/100

      // Fase 0: la carga considera el tránsito vigente y conserva el último costo conocido si hoy no hay stock
      {
        const{data:stTr}=await supabase.from('stock_transito').select('sku,cantidad_transito')
        const trMap={};(stTr||[]).forEach(t=>{trMap[t.sku]=Number(t.cantidad_transito)||0})
        const{data:prevCost}=await fetchAll(supabase.from('productos').select('sku,costo_unitario').order('sku'))
        const costMap={};(prevCost||[]).forEach(c=>{costMap[c.sku]=Number(c.costo_unitario)||0})
        for(const p of prodList){p.stock_transito=trMap[p.sku]||0;p._costo_prev=costMap[p.sku]||0}
        addLog(`🚚 Tránsito vigente considerado en ${Object.keys(trMap).length} SKUs; costo previo disponible para ${Object.values(costMap).filter(v=>v>0).length}`,"success")
      }
      // ⭐ Auto-crear tipos nuevos en parametros_tipo si aparecen en el Excel
      const tiposEnExcel=[...new Set(prodList.map(p=>p.tipo_producto).filter(Boolean))]
      const tiposEnBD=(pTypes||[]).map(t=>t.tipo_producto)
      const tiposNuevos=tiposEnExcel.filter(t=>!tiposEnBD.includes(t))
      if(tiposNuevos.length>0){
        addLog(`🆕 ${tiposNuevos.length} tipo(s) nuevo(s) detectado(s): ${tiposNuevos.join(", ")}`)
        const inserts=tiposNuevos.map(t=>({tipo_producto:t,dias_fabricacion:30,periodo_cobertura:90}))
        const{error:errTipos}=await supabase.from('parametros_tipo').insert(inserts)
        if(errTipos){addLog(`Error al crear tipos: ${errTipos.message}`,"error")}
        else{
          addLog(`✓ Tipos creados con valores por defecto (fab:30, cob:90) — puedes ajustarlos en Config → Reposición`,"success")
          // Recargar pTypes con los nuevos
          const{data:pTypesActualizado}=await supabase.from('parametros_tipo').select('*')
          if(pTypesActualizado)pTypes.push(...pTypesActualizado.filter(t=>tiposNuevos.includes(t.tipo_producto)))
        }
      }

      // ⭐ v53: ventana de 6 meses calendario COMPLETOS (el mes en curso vive aparte
      // en venta_mes_actual y NUNCA entra al análisis — reemplaza a excluir_mes_actual)
      const totalMesesRep=Math.min(6,Math.max(1,Number(config.meses_analisis)||6))
      addLog(`📅 Parámetros: análisis sobre los últimos ${totalMesesRep} meses completos, umbral quiebre ${Math.round(umbral*100)}%`,"success")

      // Calculate venta_total (sobre meses válidos) y sort for ABCD
      for(const p of prodList){
        const allMeses=[p.venta_mes_1,p.venta_mes_2,p.venta_mes_3,p.venta_mes_4,p.venta_mes_5,p.venta_mes_6]
        const mesesParaTotal=allMeses.slice(-totalMesesRep) // los N más recientes
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

        // Ventana de análisis: los N meses completos más recientes (mes en curso excluido por diseño)
        const salesRaw=[p.venta_mes_1,p.venta_mes_2,p.venta_mes_3,p.venta_mes_4,p.venta_mes_5,p.venta_mes_6]
        const sales=salesRaw.slice(-totalMesesRep)
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
        {const pos=(p.stock_actual||0)+(p.stock_transito||0);p.reposicion_necesaria=pos<=p.punto_reorden?Math.max(0,Math.round((p.vta_prom_diaria*p.periodo_cubrir)+p.punto_reorden-pos)):0}
        p.costo_unitario=p.stock_actual>0?Math.round(p.costo_stock/p.stock_actual):(p._costo_prev||0)
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

      // ─── Proceso por sucursal: guardar en productos_sucursal ────────────────
      addLog("Procesando datos por sucursal...")
      // Obtener mapeo de nombres BSALE → sucursal_id
      const{data:sucMap}=await supabase.from('bsale_sucursal_map').select('*')
      const sucMapObj={}
      if(sucMap)sucMap.forEach(s=>{sucMapObj[s.nombre_bsale]={id:s.sucursal_id,label:s.sucursal_label}})

      // Construir mapa SKU+sucursal desde las filas originales
      const sucursalMap={} // key: sku+"__"+sucursalId
      const sucNoMapeadas={} // ⭐ nombre BSALE → filas descartadas (antes: descarte SILENCIOSO)
      for(let i=headerIdx+1;i<rows.length;i++){
        const r=rows[i];if(!r||!r[colMap.sku])continue
        const sku=String(r[colMap.sku]).trim();if(!sku)continue
        const nombreSuc=String(r[colMap.nombreSuc]||r[colMap.sucursal]||"").trim()
        const sucInfo=sucMapObj[nombreSuc]
        if(!sucInfo){if(nombreSuc)sucNoMapeadas[nombreSuc]=(sucNoMapeadas[nombreSuc]||0)+1;continue}
        const key=sku+"__"+sucInfo.id
        if(!sucursalMap[key]){
          const base=Object.values(skuMap).find(p=>p.sku===sku)||{}
          sucursalMap[key]={
            sku,sucursal:sucInfo.id,sucursal_nombre:sucInfo.label,
            producto:base.producto||"",tipo_producto:base.tipo_producto||"",
            clasif_abcd:base.clasif_abcd||"D",
            costo_unitario:base.costo_unitario||0,
            stock_actual:0,costo_stock:0,_ventas:{}
          }
        }
        const ps=sucursalMap[key]
        ps.stock_actual+=Number(r[colMap.stock])||0
        for(const cm of colMeses){ps._ventas[cm.mesKey]=(ps._ventas[cm.mesKey]||0)+(Number(r[cm.idx])||0)}
        ps.costo_stock+=Number(r[colMap.valorStock])||0
      }

      // ⭐ Alerta de sucursales no mapeadas + cuadratura general vs sucursales
      const nmKeys=Object.keys(sucNoMapeadas)
      if(nmKeys.length>0){
        addLog(`⚠⚠ SUCURSALES SIN MAPEAR — sus datos quedaron FUERA del cálculo por sucursal: ${nmKeys.map(n=>`"${n}" (${sucNoMapeadas[n]} filas)`).join(" · ")}`,"error")
        addLog(`→ Para incluirlas: agregar el nombre exacto en la tabla bsale_sucursal_map (nombre_bsale → sucursal_id). El consolidado general SÍ las incluye, por eso general y sucursales no cuadran.`,"error")
      }
      {
        const stockSucs=Object.values(sucursalMap).reduce((s,ps)=>s+ps.stock_actual,0)
        const stockGral=prodList.reduce((s,p)=>s+p.stock_actual,0)
        const dif=stockGral-stockSucs
        if(Math.abs(dif)>0)addLog(`Cuadratura stock: general ${stockGral.toLocaleString()} vs suma sucursales ${stockSucs.toLocaleString()} → diferencia ${dif.toLocaleString()} uds${nmKeys.length>0?" (explicada por las sucursales sin mapear)":" ⚠ REVISAR"}`,dif===0?"success":"error")
        else addLog(`✓ Cuadratura stock: general = suma de sucursales (${stockGral.toLocaleString()} uds)`,"success")
      }

      // ⭐ v53: upsert matriz mensual por sucursal (rodante, igual que la consolidada)
      const vmsRows=[]
      for(const ps of Object.values(sucursalMap)){
        for(const[mesKey,unidades]of Object.entries(ps._ventas)){
          vmsRows.push({sku:ps.sku,sucursal:ps.sucursal,mes:mesKey,unidades,actualizado:new Date().toISOString()})
        }
      }
      let vmsSaved=0
      for(let i=0;i<vmsRows.length;i+=500){
        const batch=vmsRows.slice(i,i+500)
        const{error}=await supabase.from('ventas_mensuales_sucursal').upsert(batch,{onConflict:'sku,sucursal,mes'})
        if(error){addLog(`Error matriz sucursal lote ${i}: ${error.message}`,"error");break}
        vmsSaved+=batch.length
      }
      addLog(`📊 Matriz por sucursal: ${vmsSaved} celdas actualizadas`,"success")

      // Leer ventana por sucursal (paginado) y derivar venta_mes_1..6 + actual
      const vmsWindow={} // key sku__sucursal → {mes:{unidades}}
      {
        const keysAll=[...ventanaKeys,mesActualKey]
        let from=0;const page=10000
        while(true){
          const{data:chunk,error}=await supabase.from('ventas_mensuales_sucursal').select('sku,sucursal,mes,unidades').in('mes',keysAll).range(from,from+page-1)
          if(error){addLog(`Error leyendo matriz sucursal: ${error.message}`,"error");break}
          for(const row of(chunk||[])){
            const k=row.sku+"__"+row.sucursal
            if(!vmsWindow[k])vmsWindow[k]={}
            vmsWindow[k][row.mes]=Number(row.unidades)||0
          }
          if(!chunk||chunk.length<page)break
          from+=page
        }
      }
      for(const[key,ps]of Object.entries(sucursalMap)){
        const w=vmsWindow[key]||{}
        ventanaKeys.forEach((mk,i)=>{ps[`venta_mes_${i+1}`]=w[mk]||0})
        ps.venta_mes_actual=w[mesActualKey]||0
        delete ps._ventas
      }

      // Aplicar mismo algoritmo a cada entrada por sucursal
      const sucList=Object.values(sucursalMap)
      // venta_total por sucursal (misma ventana de meses completos)
      for(const p of sucList){
        const allM=[p.venta_mes_1,p.venta_mes_2,p.venta_mes_3,p.venta_mes_4,p.venta_mes_5,p.venta_mes_6]
        const mP=allM.slice(-totalMesesRep)
        p.venta_total=mP.reduce((s,v)=>s+(v||0),0)
      }
      // ABCD por sucursal: usar la clasificación consolidada ya calculada
      for(const p of sucList){
        const base=Object.values(skuMap).find(b=>b.sku===p.sku)
        p.clasif_abcd=base?.clasif_abcd||"D"
        p.pct_participacion=base?.pct_participacion||0
        p.pct_acumulado=base?.pct_acumulado||0
      }
      // Algoritmo de reposición por sucursal
      for(const p of sucList){
        const tp=(pTypes||[]).find(t=>t.tipo_producto===p.tipo_producto)||{dias_fabricacion:30,periodo_cobertura:90}
        const abcd=(pABCD||[]).find(a=>a.clasificacion===p.clasif_abcd)||{dias_emergencia:5}
        p.dias_fabricacion=tp.dias_fabricacion;p.periodo_cubrir=tp.periodo_cobertura;p.dias_emergencia=abcd.dias_emergencia
        const salesRaw=[p.venta_mes_1,p.venta_mes_2,p.venta_mes_3,p.venta_mes_4,p.venta_mes_5,p.venta_mes_6]
        const sales=salesRaw.slice(-totalMesesRep)
        const maxMens=Math.max(...sales,0);p.max_mensual=maxMens;p.umbral_quiebre=Math.round(maxMens*umbral)
        const normalM=sales.filter(s=>s>=maxMens*umbral);const breakM=sales.filter(s=>s>0&&s<maxMens*umbral)
        p.meses_quiebre=breakM.length
        if(maxMens===0){p.vta_prom_compensada=0;p.vta_prom_raw=0;p.factor_compensacion=1}
        else if(breakM.length>0&&normalM.length>=2){
          p.vta_prom_compensada=Math.round(normalM.reduce((s,x)=>s+x,0)/normalM.length)
          const vtaC=sales.reduce((s,x)=>s+x,0)
          p.vta_prom_raw=Math.round(vtaC/sales.filter(s=>s>0).length||0)
          p.factor_compensacion=p.vta_prom_raw>0?Math.round(p.vta_prom_compensada/p.vta_prom_raw*1000)/1000:1
        }else{
          const nz=sales.filter(s=>s>0)
          p.vta_prom_compensada=nz.length>0?Math.round(nz.reduce((s,x)=>s+x,0)/nz.length):0
          p.vta_prom_raw=p.vta_prom_compensada;p.factor_compensacion=1
        }
        p.vta_prom_diaria=Math.round(p.vta_prom_compensada/30*100)/100
        p.punto_reorden=Math.round(p.vta_prom_diaria*(p.dias_fabricacion+p.dias_emergencia))
        p.dias_cobertura=p.vta_prom_diaria>0?Math.round(p.stock_actual/p.vta_prom_diaria*10)/10:(p.stock_actual>0?999:0)
        // Nota: sin descuento de tránsito en vista por sucursal (tránsito es CD central)
        p.reposicion_necesaria=(p.stock_actual||0)<=p.punto_reorden?Math.max(0,Math.round((p.vta_prom_diaria*p.periodo_cubrir)+p.punto_reorden-p.stock_actual)):0
        p.costo_unitario=p.stock_actual>0?Math.round(p.costo_stock/p.stock_actual):(p._costo_prev||0)
        p.costo_reposicion=p.reposicion_necesaria*p.costo_unitario
        if(p.venta_total===0&&p.stock_actual===0)p.estado="Revisar"
        else if(p.venta_total===0)p.estado="Sin ventas"
        else if(p.reposicion_necesaria>0)p.estado="Reposición"
        else p.estado="Stock suficiente"
        p.sync_date=hoy()
      }
      // Upsert productos_sucursal
      let savedSuc=0
      for(let i=0;i<sucList.length;i+=200){
        const batch=sucList.slice(i,i+200)
        const{error}=await supabase.from('productos_sucursal').upsert(batch,{onConflict:'sku,sucursal'})
        if(error){addLog(`Error sucursal lote ${i}: ${error.message}`,"error")}else{savedSuc+=batch.length}
      }
      addLog(`🏢 ${savedSuc} registros por sucursal guardados`,"success")
      // ────────────────────────────────────────────────────────────────────────

      // Upsert to Supabase
      let saved=0
      for(let i=0;i<prodList.length;i+=200){
        const batch=prodList.slice(i,i+200).map(({_costo_prev,stock_transito,...rest})=>rest)
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
    alert("Sincronización por API deshabilitada (Fase 0, 17-oct-2026): usaba consumos de stock en vez de ventas y pisaba la matriz.");return
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

      // 3. Sales (consumptions) — ⭐ sincronizado con matriz rodante: 6 meses completos
      const meses=Number(config.meses_analisis)||6
      addLog(`Descargando ventas últimos ${meses} meses...`)
      const salesByVariant={}
      const now=new Date()
      const mesKeysAPI=[] // índice m → clave 'YYYY-MM' (m=0 es el mes completo más reciente)
      for(let m=0;m<meses;m++){
        const d=new Date(now.getFullYear(),now.getMonth()-m-1,1)
        mesKeysAPI[m]=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`
        const from=d.toISOString().slice(0,10)
        const to=new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10)
        addLog(`  Mes ${m+1} (${mesKeysAPI[m]}): ${from} a ${to}`)
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
          // ⭐ Orden sincronizado con el flujo Excel: venta_mes_1 = mes MÁS ANTIGUO de la ventana.
          //    monthlySales[m] tiene m=0 = mes más reciente, así que se invierte el índice.
          const vm={}
          for(let m=0;m<meses;m++){vm[`venta_mes_${meses-m}`]=monthlySales[m]||0}
          prodList.push({sku,producto:v.description||p.name||sku,codigo_barras:v.barCode||"",tipo_producto:typeName,stock_actual:stockActual,costo_unitario:costoUnit,dias_fabricacion:tp.dias_fabricacion,periodo_cubrir:tp.periodo_cobertura,venta_total:ventaTotal,_sales:monthlySales,venta_mes_1:vm.venta_mes_1||0,venta_mes_2:vm.venta_mes_2||0,venta_mes_3:vm.venta_mes_3||0,venta_mes_4:vm.venta_mes_4||0,venta_mes_5:vm.venta_mes_5||0,venta_mes_6:vm.venta_mes_6||0,venta_mes_actual:0})
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
        {const pos=(p.stock_actual||0)+(p.stock_transito||0);p.reposicion_necesaria=pos<=p.punto_reorden?Math.max(0,Math.round((p.vta_prom_diaria*p.periodo_cubrir)+p.punto_reorden-pos)):0}
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
      // ⭐ Alimentar la matriz rodante ventas_mensuales (igual que el flujo Excel):
      //    los meses descargados de la API PISAN los existentes en la BD.
      const vmRowsAPI=[]
      const MESES_NOM=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"]
      for(const p of prodList){
        const ms=p._sales||[]
        for(let m=0;m<meses;m++){
          const mk=mesKeysAPI[m];if(!mk)continue
          const nomMes=`${MESES_NOM[Number(mk.slice(5,7))-1]} ${mk.slice(0,4)}`
          vmRowsAPI.push({sku:p.sku,mes:mk,mes_nombre:nomMes,unidades:ms[m]||0,actualizado:new Date().toISOString()})
        }
      }
      let vmSavedAPI=0
      for(let i=0;i<vmRowsAPI.length;i+=500){
        const vmBatch=vmRowsAPI.slice(i,i+500)
        const{error:vmErr}=await supabase.from('ventas_mensuales').upsert(vmBatch,{onConflict:'sku,mes'})
        if(vmErr){addLog(`⚠ Matriz mensual lote ${i}: ${vmErr.message}`,"warn");break}
        vmSavedAPI+=vmBatch.length
      }
      if(vmSavedAPI>0)addLog(`📊 Matriz mensual: ${vmSavedAPI} celdas SKU×mes actualizadas (${meses} meses pisados)`,"success")

      let saved=0
      for(let i=0;i<prodList.length;i+=200){
        const batch=prodList.slice(i,i+200).map(({_sales,...rest})=>rest) // ⭐ sin campos internos que no existen en la tabla
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
    alert("Carga de datos de muestra deshabilitada en producción (Fase 0).");return
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
      <div style={{background:config.bsale_activo==="true"?"#1E7A4415":"#B4231815",borderRadius:10,padding:12,marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
        <div style={{width:10,height:10,borderRadius:5,background:config.bsale_activo==="true"?"#1E7A44":"#B42318"}}/>
        <span style={{fontSize:13,fontWeight:600,color:config.bsale_activo==="true"?"#1E7A44":"#B42318"}}>{config.bsale_activo==="true"?"Conectado":"Desconectado"}</span>
      </div>

      <Fl l="Access Token de BSALE"><input type="password" value={bsaleToken} onChange={e=>setBsaleToken(e.target.value)} placeholder="Pegar token de BSALE aquí..." style={css.input}/></Fl>
      <div style={{fontSize:12,color:"#6E6E73",marginBottom:12,lineHeight:1.6}}>El token se obtiene desde BSALE → Configuración → API. Es único por usuario.</div>

      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <Bt v="pri" onClick={testConnection} dis={!bsaleToken||testing} ic="🔍">{testing?"Probando...":"Probar conexión"}</Bt>
      </div>

      {testResult&&<div style={{background:testResult.ok?"#1E7A4415":"#B4231815",borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:600,color:testResult.ok?"#1E7A44":"#B42318"}}>{testResult.ok?"✓":"✕"} {testResult.msg}</div>
      </div>}
    </Cd>

    <Cd s={{marginTop:10}}><div style={{fontSize:15,fontWeight:700,marginBottom:10}}>📄 Cargar reporte Excel de BSALE</div>
      <div style={{fontSize:12,color:"#6E6E73",marginBottom:12,lineHeight:1.6}}>Sube el archivo Excel del reporte <strong>"Reposición de Stock"</strong> de BSALE. Debe incluir: Tipo de Producto, Producto, SKU, ventas mensuales, Stock Actual. El sistema consolida las sucursales, aplica clasificación ABCD, compensación de quiebres, y calcula la reposición necesaria.</div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <label style={{...css.btn,padding:"12px 20px",borderRadius:12,fontSize:14,fontWeight:600,background:"#1D4E89",color:"#fff",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6}}>
          <span>📤</span> Subir Excel de BSALE
          <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(f)processExcel(f);e.target.value=""}} disabled={syncing}/>
        </label>
        {syncing&&<span style={{fontSize:13,color:"#B25E09",fontWeight:600}}>Procesando...</span>}
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

    {result&&result.ok&&<Cd ac="#1E7A44" s={{marginTop:10}}>
      <div style={{fontSize:15,fontWeight:700,marginBottom:8,color:"#1E7A44"}}>✓ Sincronización completa</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8}}>
        {[["Productos",result.productos_procesados],["Clase A",result.clase_A],["Clase B",result.clase_B],["Requieren OC",result.requieren_reposicion],["Inversión",fmt(result.inversion_reposicion)]].map(([l,v],i)=>
          <div key={i} style={{background:"#F4F5F7",borderRadius:8,padding:"8px 10px",textAlign:"center"}}><div style={{fontSize:11,color:"#6E6E73"}}>{l}</div><div style={{fontSize:16,fontWeight:700}}>{v}</div></div>
        )}
      </div>
    </Cd>}

    <Cd s={{marginTop:10}}>
      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>📋 Datos que se extraen de BSALE</div>
      <div style={{fontSize:12,color:"#6E6E73",lineHeight:1.8}}>
        • <strong>Productos y variantes</strong> — catálogo completo con SKU, código de barras, tipo<br/>
        • <strong>Stock actual</strong> — por sucursal y bodega, disponible y reservado<br/>
        • <strong>Consumos/ventas</strong> — últimos {config.meses_analisis||4} meses para calcular promedios<br/>
        • Se aplica el algoritmo de <strong>venta promedio compensada</strong> (excluye meses de quiebre)<br/>
        • Clasificación <strong>ABCD</strong> automática por participación en ventas<br/>
        • Cálculo de <strong>punto de reorden</strong> y <strong>cantidad a reponer</strong> según parámetros configurados
      </div>
    </Cd>


    <Cd s={{marginTop:10}}>
      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>🚀 Deploy con funciones serverless</div>
      <div style={{fontSize:12,color:"#6E6E73",lineHeight:1.8}}>
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
