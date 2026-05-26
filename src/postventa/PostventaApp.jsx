// ═══════════════════════════════════════════════════════════════════════════
// App.jsx — Postventa Outlet de Puertas SpA
// Versión: 1.2.0 (2026-05-04) — Módulo de usuarios y permisos
// Stack: React 18 + Vite + Supabase
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import { supabase, signOut } from '../supabase'
import { preloadCaps, canSync } from '../core/permisos'
import { useResponsive } from '../core/responsive'

/* ═══════════════════════════════════════════════════════════════════════════
   2. HELPERS GLOBALES
═══════════════════════════════════════════════════════════════════════════ */
const fmt  = n => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n||0)
const fN   = n => new Intl.NumberFormat("es-CL").format(Math.round(n||0))
const hoy  = () => new Date().toISOString().slice(0,10)
const hora = () => new Date().toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"})
const uid  = () => "pv"+Date.now().toString(36)+Math.random().toString(36).slice(2,5)

// Valida RUT chileno (formato 12.345.678-9 o 12345678-9)
const validaRut = rut => {
  if (!rut) return false
  const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase()
  if (clean.length < 2) return false
  const body = clean.slice(0, -1)
  const dv   = clean.slice(-1)
  let sum = 0, mul = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const expected = 11 - (sum % 11)
  const dvCalc = expected === 11 ? '0' : expected === 10 ? 'K' : String(expected)
  return dv === dvCalc
}

// Formatea RUT: 12345678 → 12.345.678
const fmtRut = r => {
  const clean = r.replace(/[^0-9kK]/g, '')
  if (clean.length < 2) return clean
  const body = clean.slice(0, -1)
  const dv   = clean.slice(-1).toUpperCase()
  const bodyFmt = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${bodyFmt}-${dv}`
}

// Días hábiles entre dos fechas
const diasHabiles = (desde, hasta) => {
  let d = new Date(desde), n = 0
  while (d < new Date(hasta)) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) n++
  }
  return n
}

// Diferencia en horas entre fecha y ahora
const horasDesde = fechaStr => {
  if (!fechaStr) return 0
  return Math.round((Date.now() - new Date(fechaStr).getTime()) / 3600000)
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. DESIGN SYSTEM
═══════════════════════════════════════════════════════════════════════════ */
const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"

// Colores criticidad (bloques postventa)
const CL = {
  A: {c:"#FF3B30", bg:"#FF3B3015", t:"Crítico"},
  B: {c:"#007AFF", bg:"#007AFF15", t:"Importante"},
  C: {c:"#34C759", bg:"#34C75915", t:"Regular"},
  D: {c:"#8E8E93", bg:"#8E8E9315", t:"Bajo"}
}

// Mapa bloque → criticidad visual
const BLOQUE_CL = { B1:"B", B2:"A", B3:"C", B4:"B", B5:"A", B6:"B" }

// Roles del módulo postventa — con permisos granulares y descripción
const ROLES = [
  {
    k:"admin", l:"Admin", c:"#FF3B30",
    desc:"Acceso total al sistema, gestión de usuarios y configuración",
    sucursales:["todas"],
    p:["todo"]
  },
  {
    k:"gerencia", l:"Gerencia", c:"#FF3B30",
    desc:"Visibilidad total, escalamiento N3, aprobación de excepciones",
    sucursales:["todas"],
    p:["ver_dash","ver_casos","ver_reportes","escalar","aprobar_excepcion",
       "crear_caso","editar_caso","cerrar_caso","form2","form3","form4_transfer","gestionar_usuarios"]
  },
  {
    k:"jefe_tienda", l:"Jefe Tienda", c:"#FF9500",
    desc:"Escalamiento N2, aprobación comercial, supervisión de su sucursal",
    sucursales:["maipu","la_granja","los_angeles"],
    p:["ver_dash","ver_casos","crear_caso","editar_caso","cerrar_caso",
       "escalar","aprobar","form2","form3"]
  },
  {
    k:"postventa", l:"Postventa", c:"#007AFF",
    desc:"Operación central: recibe, registra, clasifica, resuelve y cierra casos",
    sucursales:["maipu","la_granja","los_angeles"],
    p:["ver_dash","ver_casos","crear_caso","editar_caso","cerrar_caso","form3"]
  },
  {
    k:"operaciones", l:"Operaciones", c:"#AF52DE",
    desc:"Validación técnica de productos (FORM 2). Solo lectura del resto",
    sucursales:["maipu","la_granja","los_angeles"],
    p:["ver_casos","form2"]
  },
  {
    k:"caja", l:"Caja", c:"#34C759",
    desc:"Ejecuta transferencias bancarias bajo instrucción formal (FORM 4). Solo lectura",
    sucursales:["todas"],
    p:["ver_casos","form4_transfer"]
  },
]
const rl = u => ROLES.find(r => r.k === u?.rol) || ROLES[3]
// Mapeo de permisos legado a capability IDs del sistema RBAC
const PV_CAP_MAP = {
  'ver_dash':          'pv.dashboard',
  'ver_casos':         'pv.casos',
  'ver_reportes':      'pv.dashboard',
  'crear_caso':        'pv.crear_caso',
  'editar_caso':       'pv.editar_caso',
  'cerrar_caso':       'pv.cerrar_caso',
  'escalar':           'pv.escalar',
  'aprobar':           'pv.aprobar',
  'aprobar_excepcion': 'pv.aprobar',
  'form2':             'pv.form2',
  'form3':             'pv.form3',
  'form4':             'pv.form4',
  'form4_transfer':    'pv.form4',
  'gestionar_usuarios':'pv.usuarios',
}
// RBAC-6: hp() usa capabilities dinámicas si el cache está disponible, fallback a sistema legado
const hp = (u, p) => {
  if (!u) return false
  // Intentar RBAC desde cache (no requiere await)
  const capId = PV_CAP_MAP[p]
  if (capId) {
    const result = canSync(u, 'postventa', capId)
    if (result !== false) return true
    // Si result es false podría ser que caps no estén cargadas aún — verificar con fallback
  }
  // Fallback legado
  const r = rl(u)
  return r.p.includes('todo') || r.p.includes(p)
}

// Mapa legible de permisos (para mostrar en UI)
const PERMS_LABELS = {
  ver_dash:          {l:"Ver dashboard",         ic:"📊", g:"Visualización"},
  ver_casos:         {l:"Ver casos",             ic:"👁️",  g:"Visualización"},
  ver_reportes:      {l:"Ver reportes",          ic:"📈", g:"Visualización"},
  crear_caso:        {l:"Crear casos",           ic:"➕", g:"Operación"},
  editar_caso:       {l:"Editar casos",          ic:"✏️",  g:"Operación"},
  cerrar_caso:       {l:"Cerrar casos",          ic:"✅", g:"Operación"},
  form2:             {l:"Validación técnica",    ic:"🔬", g:"Formularios"},
  form3:             {l:"Emitir NC / resolución",ic:"🧾", g:"Formularios"},
  form4_transfer:    {l:"Ejecutar transferencias",ic:"💸",g:"Formularios"},
  escalar:           {l:"Escalar casos",         ic:"🔺", g:"Autoridad"},
  aprobar:           {l:"Aprobar escalados",     ic:"✔️",  g:"Autoridad"},
  aprobar_excepcion: {l:"Aprobar excepciones",   ic:"⚡", g:"Autoridad"},
  gestionar_usuarios:{l:"Gestionar usuarios",    ic:"👥", g:"Admin"},
}

// Estados con color y etiqueta
const ESTADOS = {
  abierto:                 {l:"Abierto",              c:"#FF9500", bg:"#FF950015", ic:"🟡"},
  en_validacion_tecnica:   {l:"Validación técnica",   c:"#AF52DE", bg:"#AF52DE15", ic:"🔬"},
  en_resolucion:           {l:"En resolución",        c:"#007AFF", bg:"#007AFF15", ic:"🔄"},
  escalado:                {l:"Escalado",             c:"#FF3B30", bg:"#FF3B3015", ic:"🔴"},
  transfer_pendiente:      {l:"Transferencia pend.",  c:"#34C759", bg:"#34C75915", ic:"💸"},
  cerrado:                 {l:"Cerrado",              c:"#34C759", bg:"#34C75915", ic:"✅"},
  rechazado:               {l:"Rechazado",            c:"#8E8E93", bg:"#8E8E9315", ic:"❌"},
}

// SLA en horas por etapa (referencia del SOP)
const SLA = { validacion:24, resolucion:48, escalado:24 }

const css = {
  page:    {fontFamily:FONT, margin:0, padding:"0 20px calc(100px + env(safe-area-inset-bottom))", background:"var(--bg-page)", minHeight:"100vh", fontSize:14},
  card:    {background:"var(--bg-surface)", borderRadius:"var(--r-lg)", padding:"16px 18px", boxShadow:"var(--shadow-md)", marginBottom:10, border:"1px solid var(--border-1)"},
  cardSm:  {background:"var(--bg-surface)", borderRadius:"var(--r-md)", padding:"12px 14px", boxShadow:"var(--shadow-sm)", border:"1px solid var(--border-1)"},
  input:   {width:"100%", padding:"10px 14px", borderRadius:"var(--r-md)", border:"1px solid var(--border-2)", fontSize:14, background:"var(--bg-surface)", outline:"none", fontFamily:FONT},
  select:  {width:"100%", padding:"10px 14px", borderRadius:"var(--r-md)", border:"1px solid var(--border-2)", fontSize:14, background:"var(--bg-surface)", fontFamily:FONT},
  textarea:{width:"100%", padding:"10px 14px", borderRadius:"var(--r-md)", border:"1px solid var(--border-2)", fontSize:14, background:"var(--bg-surface)", outline:"none", fontFamily:FONT, resize:"vertical", minHeight:80},
  btn:     {padding:"12px 20px", borderRadius:12, fontSize:14, fontWeight:600, border:"none", cursor:"pointer", display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6, fontFamily:FONT},
  modal:   {position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.45)", backdropFilter:"blur(8px)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:999},
  row:     {display:"flex", gap:12, alignItems:"flex-start"},
  col:     {flex:1},
  divider: {height:1, background:"#F2F2F7", margin:"12px 0"},
  label:   {fontSize:11, fontWeight:600, color:"#8E8E93", textTransform:"uppercase", letterSpacing:"0.04em"},
  val:     {fontSize:14, fontWeight:500, color:"#1C1C1E", marginTop:2},
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. COMPONENTES UI
═══════════════════════════════════════════════════════════════════════════ */
const Bt = ({children, onClick, variant="primary", disabled, sm, fw, loading}) => {
  const v = {
    primary:   {bg:"#007AFF", c:"#fff"},
    secondary: {bg:"#F2F2F7", c:"#1C1C1E"},
    ghost:     {bg:"transparent", c:"#007AFF"},
    danger:    {bg:"#FF3B30", c:"#fff"},
    success:   {bg:"#34C759", c:"#fff"},
    warning:   {bg:"#FF9500", c:"#fff"},
  }[variant] || {bg:"#007AFF", c:"#fff"}
  return (
    <button onClick={onClick} disabled={disabled || loading} style={{
      ...css.btn,
      background: (disabled || loading) ? "#C7C7CC" : v.bg,
      color: v.c,
      padding: sm ? "7px 14px" : "11px 20px",
      fontSize: sm ? 13 : 14,
      width: fw ? "100%" : undefined,
      opacity: (disabled || loading) ? 0.7 : 1
    }}>
      {loading ? "Cargando..." : children}
    </button>
  )
}

const Bd = ({children, c, bg, lg}) => (
  <span style={{
    display:"inline-flex", alignItems:"center", gap:4,
    padding: lg ? "5px 12px" : "3px 9px",
    borderRadius:20, fontSize: lg ? 13 : 11, fontWeight:600,
    color: c||"#8E8E93", background: bg||"#F2F2F7", whiteSpace:"nowrap"
  }}>{children}</span>
)

const Cd = ({children, ac, s, onClick}) => (
  <div onClick={onClick} style={{
    ...css.card,
    borderLeft: ac ? `3px solid ${ac}` : undefined,
    cursor: onClick ? "pointer" : undefined,
    ...(s||{})
  }}>{children}</div>
)

const Mt = ({l, v, sub, ac, ic}) => (
  <div style={{...css.cardSm, textAlign:"center", flex:"1 1 100px", minWidth:90}}>
    {ic && <div style={{fontSize:22, marginBottom:2}}>{ic}</div>}
    <div style={{fontSize:11, color:"#8E8E93", marginBottom:2, fontWeight:600}}>{l}</div>
    <div style={{fontSize:24, fontWeight:700, color:ac||"#1C1C1E", letterSpacing:"-0.02em"}}>{v}</div>
    {sub && <div style={{fontSize:10, color:"#AEAEB2", marginTop:2}}>{sub}</div>}
  </div>
)

const Av = ({nombre, color, size=32}) => {
  const ini = (nombre||"?").split(" ").map(s=>s[0]).slice(0,2).join("").toUpperCase()
  return (
    <div style={{
      width:size, height:size, borderRadius:"50%",
      background:color||"#007AFF", color:"#fff",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontWeight:700, fontSize:size*0.38, flexShrink:0
    }}>{ini}</div>
  )
}

const Fl = ({l, children, req, err}) => (
  <div style={{marginBottom:12}}>
    <label style={{fontSize:12, fontWeight:600, color: err?"#FF3B30":"#3C3C43", marginBottom:4, display:"block"}}>
      {l}{req && <span style={{color:"#FF3B30"}}> *</span>}
    </label>
    {children}
    {err && <div style={{color:"#FF3B30", fontSize:11, marginTop:3}}>⚠️ {err}</div>}
  </div>
)

const Sheet = ({open, onClose, title, children, wide}) => {
  if (!open) return null
  return (
    <div style={css.modal} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background:"#fff", width:"100%",
        maxWidth: wide ? 800 : 600,
        borderRadius:"24px 24px 0 0",
        padding:"20px 24px 40px",
        maxHeight:"92vh", overflowY:"auto"
      }}>
        <div style={{width:36, height:5, background:"#C7C7CC", borderRadius:3, margin:"0 auto 16px"}}/>
        {title && <h3 style={{margin:"0 0 16px", fontSize:18, fontWeight:700}}>{title}</h3>}
        {children}
      </div>
    </div>
  )
}

const Stp = ({steps, current, alertIdx}) => (
  <div style={{display:"flex", alignItems:"center", padding:"10px 0", overflowX:"auto", gap:0}}>
    {steps.map((s, i) => {
      const done    = i < current
      const active  = i === current
      const isAlert = active && alertIdx != null && i === alertIdx
      const bg = done ? "#34C759" : isAlert ? "#FF9500" : active ? "#007AFF" : "#E5E5EA"
      const tc = done||active ? "#fff" : "#8E8E93"
      return (
        <div key={i} style={{display:"flex", alignItems:"center", flex:"0 0 auto"}}>
          <div style={{
            width:26, height:26, borderRadius:"50%",
            background: bg, color: tc,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:11, fontWeight:700, flexShrink:0,
            boxShadow: isAlert ? "0 0 0 3px rgba(255,149,0,0.25)" : undefined
          }}>{done ? "✓" : i+1}</div>
          <span style={{
            marginLeft:5, fontSize:12,
            fontWeight: active ? 700 : 500,
            color: done ? "#34C759" : isAlert ? "#FF9500" : active ? "#007AFF" : "#8E8E93",
            whiteSpace:"nowrap"
          }}>{s}</span>
          {i < steps.length-1 && (
            <div style={{
              width:24, height:2, margin:"0 6px",
              background: done ? "#34C759" : "#E5E5EA"
            }}/>
          )}
        </div>
      )
    })}
  </div>
)

// Alerta SLA — muestra advertencia si el caso está cerca o fuera de plazo
const AlertaSLA = ({caso}) => {
  if (!caso || caso.estado === 'cerrado' || caso.estado === 'rechazado') return null
  const h = horasDesde(caso.created_at)
  const slaTarget = caso.estado === 'escalado' ? SLA.escalado :
                    caso.estado === 'en_validacion_tecnica' ? SLA.validacion : SLA.resolucion
  const pct = Math.min(h / slaTarget, 1)
  const vencido = pct >= 1
  const cercano = pct >= 0.75
  if (!cercano) return null
  return (
    <div style={{
      background: vencido ? "#FF3B3015" : "#FF950015",
      border:`1px solid ${vencido ? "#FF3B30" : "#FF9500"}`,
      borderRadius:10, padding:"6px 10px",
      fontSize:11, color: vencido ? "#FF3B30" : "#FF9500",
      fontWeight:600, display:"flex", alignItems:"center", gap:5
    }}>
      {vencido ? "⛔" : "⚠️"} SLA {vencido ? "VENCIDO" : "en riesgo"} — {h}h de {slaTarget}h
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. PANTALLAS
═══════════════════════════════════════════════════════════════════════════ */

// ─── LOGIN ────────────────────────────────────────────────────────────────
// LoginScreen eliminado — el ERP maneja el login via Supabase Auth

// ─── MINI SPARKLINE (barra horizontal proporcional) ───────────────────────
const Bar = ({pct, color, h=6}) => (
  <div style={{height:h, background:"#F2F2F7", borderRadius:h, overflow:"hidden"}}>
    <div style={{
      height:"100%", width:(pct||0)+"%", background:color,
      borderRadius:h, transition:"width 0.6s cubic-bezier(.4,0,.2,1)"
    }}/>
  </div>
)

// ─── MINI DONUT (SVG) ──────────────────────────────────────────────────────
const Donut = ({slices, size=80}) => {
  const r = 28, cx = 40, cy = 40, circ = 2*Math.PI*r
  let offset = 0
  const total = slices.reduce((s,x) => s+x.v, 0)
  return (
    <svg width={size} height={size} viewBox="0 0 80 80">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F2F2F7" strokeWidth={10}/>
      {total === 0
        ? <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E5E5EA" strokeWidth={10}/>
        : slices.map((s, i) => {
            const dash = (s.v/total)*circ
            const el = (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                stroke={s.c} strokeWidth={10}
                strokeDasharray={`${dash} ${circ-dash}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 40 40)"
                style={{transition:"stroke-dasharray 0.6s ease"}}
              />
            )
            offset += dash
            return el
          })
      }
      <text x={cx} y={cy+1} textAnchor="middle" dominantBaseline="middle"
        style={{fontSize:13, fontWeight:700, fill:"#1C1C1E"}}>
        {fN(total)}
      </text>
    </svg>
  )
}

// ─── SECCIÓN HEADER ────────────────────────────────────────────────────────
const SecH = ({title, sub, right}) => (
  <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:14}}>
    <div>
      <div style={{fontSize:15, fontWeight:700, color:"#1C1C1E", letterSpacing:"-0.01em"}}>{title}</div>
      {sub && <div style={{fontSize:11, color:"#8E8E93", marginTop:1}}>{sub}</div>}
    </div>
    {right}
  </div>
)

// ─── FILA DE RANKING ──────────────────────────────────────────────────────
const RankRow = ({pos, label, sub, value, pct, color, badge, onClick}) => (
  <div onClick={onClick} style={{
    display:"flex", alignItems:"center", gap:10,
    padding:"8px 0", borderBottom:"1px solid #F2F2F7",
    cursor: onClick ? "pointer" : undefined
  }}>
    <div style={{
      width:22, height:22, borderRadius:6, flexShrink:0,
      background: pos===1?"#FF9500":pos===2?"#8E8E93":pos===3?"#C67C2A":"#F2F2F7",
      color: pos<=3?"#fff":"#8E8E93",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize:11, fontWeight:800
    }}>{pos}</div>
    <div style={{flex:1, minWidth:0}}>
      <div style={{fontSize:13, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>
        {label} {badge}
      </div>
      {sub && <Bar pct={pct} color={color} h={4}/>}
      {sub && <div style={{fontSize:10, color:"#8E8E93", marginTop:1}}>{sub}</div>}
    </div>
    <div style={{
      fontSize:16, fontWeight:800, color: color||"#1C1C1E",
      flexShrink:0, letterSpacing:"-0.02em"
    }}>{value}</div>
  </div>
)

// ─── EMAIL HELPER (Brevo) ─────────────────────────────────────────────────
// Llama la Edge Function brevo-email con el tipo de evento y los datos
const sendEmail = async (tipo, data, destinatarios) => {
  try {
    const baseUrl = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

    // Leer API key de Brevo desde config_sistema
    const { data: cfg } = await supabase
      .from('config_sistema')
      .select('valor')
      .eq('clave', 'brevo_api_key')
      .maybeSingle()

    if (!cfg?.valor) {
      console.warn('[Email] brevo_api_key no configurada en config_sistema')
      return { ok: false, error: 'API key no configurada' }
    }

    const res = await fetch(`${baseUrl}/functions/v1/brevo-email`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        tipo,
        data,
        destinatarios,
        brevo_api_key: cfg.valor,
        caso_id:       data.caso_id || data.id || null,
        supabase_url:  baseUrl,
        supabase_key:  anonKey,
        usuario:       data.ejecutivo_nombre || data.validador_nombre || '',
      })
    })
    const result = await res.json()
    if (!result.ok) console.warn('[Email] Error Brevo:', result.error)
    return result
  } catch(e) {
    console.warn('[Email] Error:', e.message)
    return { ok: false, error: e.message }
  }
}

// Obtener destinatarios configurados para un evento específico
// Si no existe config en BD, fallback a búsqueda por rol
const getEmailsParaEvento = async (eventoKey, roles = []) => {
  try {
    // Leer config de destinatarios desde BD
    const { data: cfg } = await supabase
      .from('config_sistema')
      .select('valor')
      .eq('clave', `notif_${eventoKey}`)
      .maybeSingle()

    if (cfg?.valor) {
      const ids = JSON.parse(cfg.valor)
      if (ids.length > 0) {
        const { data } = await supabase
          .from('usuarios')
          .select('nombre, correo')
          .in('id', ids)
          .eq('activo', true)
          .not('correo', 'is', null)
        return (data || []).map(u => ({ email: u.correo, nombre: u.nombre }))
      }
    }
  } catch(e) {}

  // Fallback: buscar por rol si no hay config
  if (roles.length === 0) return []
  const { data } = await supabase
    .from('usuarios')
    .select('nombre, correo')
    .in('rol', roles)
    .eq('activo', true)
    .not('correo', 'is', null)
  return (data || []).map(u => ({ email: u.correo, nombre: u.nombre }))
}

// Compatibilidad legacy — busca por rol
const getEmailsPorRol = async (roles) => {
  const { data } = await supabase
    .from('usuarios')
    .select('nombre, correo')
    .in('rol', Array.isArray(roles) ? roles : [roles])
    .eq('activo', true)
    .not('correo', 'is', null)
  return (data || []).map(u => ({ email: u.correo, nombre: u.nombre }))
}

// ─── DASHBOARD PROFESIONAL ────────────────────────────────────────────────
const Dashboard = ({casos, codigos, cu, onNuevo, onVerCaso}) => {
  const h = p => hp(cu, p)
  const [hovKpi,    setHovKpi]    = useState(null)
  const [hovBar,    setHovBar]    = useState(null)
  const [hovProd,   setHovProd]   = useState(null)
  const [hovVend,   setHovVend]   = useState(null)
  const [hovEtapa,  setHovEtapa]  = useState(null)
  const [filtroPer, setFiltroPer] = useState('todos') // 'todos'|'7d'|'30d'|'90d'

  // Paleta Power BI dark
  const PBI = {
    bg:     '#1a1a2e',
    panel:  '#16213e',
    card:   '#0f3460',
    accent: '#e94560',
    blue:   '#4fc3f7',
    green:  '#69f0ae',
    orange: '#ffb74d',
    purple: '#ce93d8',
    text:   '#e0e0e0',
    muted:  '#78909c',
    border: 'rgba(255,255,255,0.08)',
    grid:   'rgba(255,255,255,0.05)',
  }

  // Filtro temporal
  const casosFil = useMemo(() => {
    if (filtroPer === 'todos') return casos
    const dias = filtroPer === '7d' ? 7 : filtroPer === '30d' ? 30 : 90
    const desde = Date.now() - dias * 86400000
    return casos.filter(c => new Date(c.created_at).getTime() >= desde)
  }, [casos, filtroPer])

  // Estados activos (no cerrados)
  const ESTADOS_CERR = ['cerrado','rechazado']
  const ESTADOS_EN_CURSO = ['en_validacion_tecnica','en_resolucion','transfer_pendiente']

  // KPIs
  const total          = casosFil.length
  const abiertos       = casosFil.filter(c => c.estado==='abierto').length
  const enCurso        = casosFil.filter(c => ESTADOS_EN_CURSO.includes(c.estado)).length
  const escalados      = casosFil.filter(c => c.estado==='escalado').length
  const transferPend   = casosFil.filter(c => c.estado==='transfer_pendiente').length
  const cerrados       = casosFil.filter(c => c.estado==='cerrado').length
  const rechazados     = casosFil.filter(c => c.estado==='rechazado').length
  const vencidos       = casosFil.filter(c => !ESTADOS_CERR.includes(c.estado) && horasDesde(c.created_at)>SLA.resolucion).length
  const urgentes       = casosFil.filter(c => !ESTADOS_CERR.includes(c.estado) && (c.estado==='escalado'||c.es_critico||horasDesde(c.created_at)>SLA.resolucion))

  const tResp = useMemo(() => {
    const cerr = casosFil.filter(c => c.estado==='cerrado'&&c.cerrado_at&&c.created_at)
    if (!cerr.length) return null
    const hrs = cerr.map(c=>(new Date(c.cerrado_at)-new Date(c.created_at))/3600000).filter(h=>h>=0&&h<9999)
    if (!hrs.length) return null
    const avg=hrs.reduce((s,h)=>s+h,0)/hrs.length
    const pct=Math.round(hrs.filter(h=>h<=SLA.resolucion).length/hrs.length*100)
    return {avg:Math.round(avg),min:Math.round(Math.min(...hrs)),max:Math.round(Math.max(...hrs)),pct,total:hrs.length}
  }, [casosFil])

  // Tendencia por semana (últimas 8 semanas)
  const tendencia = useMemo(() => {
    const weeks = []
    for (let i=7; i>=0; i--) {
      const desde = new Date(); desde.setDate(desde.getDate()-i*7-7)
      const hasta = new Date(); hasta.setDate(hasta.getDate()-i*7)
      const cnt = casos.filter(c => {
        const d = new Date(c.created_at)
        return d >= desde && d < hasta
      }).length
      const label = hasta.toLocaleDateString('es-CL',{day:'2-digit',month:'2-digit'})
      weeks.push({label, cnt})
    }
    return weeks
  }, [casos])
  const maxTend = Math.max(...tendencia.map(w=>w.cnt), 1)

  // Distribución por canal
  const porCanal = useMemo(() => {
    const m = {}
    casosFil.forEach(c => {
      const k = c.canal_ingreso||'otros'
      m[k] = (m[k]||0)+1
    })
    return Object.entries(m).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v)
  }, [casosFil])

  // Códigos frecuentes
  const porCodigo = useMemo(() => {
    const m = {}
    casosFil.forEach(c => {
      const cod = c.codigo_final||c.codigo_provisional||'S/C'
      if (!m[cod]) m[cod]={cnt:0,desc:'',bloque:''}
      m[cod].cnt++
      const info = codigos.find(x=>x.codigo===cod)
      m[cod].desc = info?.descripcion?.slice(0,32)||cod
      m[cod].bloque = info?.bloque||'—'
    })
    return Object.entries(m).map(([cod,d])=>({cod,...d})).sort((a,b)=>b.cnt-a.cnt).slice(0,7)
  }, [casosFil, codigos])
  const maxCod = Math.max(...porCodigo.map(x=>x.cnt),1)

  // Vendedores
  const porVendedor = useMemo(() => {
    const m = {}
    casosFil.forEach(c => {
      const n = c.vendedor_bsale||c.ejecutivo_nombre||'Sin asignar'
      if (!m[n]) m[n]={total:0,cerrados:0,escalados:0}
      m[n].total++
      if (c.estado==='cerrado') m[n].cerrados++
      if (c.estado==='escalado') m[n].escalados++
    })
    return Object.entries(m).map(([n,d])=>({n,...d})).sort((a,b)=>b.total-a.total).slice(0,6)
  }, [casosFil])
  const maxVend = Math.max(...porVendedor.map(x=>x.total),1)

  // Productos
  const porProducto = useMemo(() => {
    const m = {}
    casosFil.forEach(c => {
      if (!c.notas?.startsWith('Productos en reclamo:')) return
      c.notas.replace('Productos en reclamo: ','').split(' | ').forEach(p => {
        const ms = p.match(/\(SKU:\s*([^)]+)\)/)
        const nombre = p.split('(SKU:')[0].trim()
        if (!nombre) return
        const key = ms?ms[1].trim():nombre
        if (!m[key]) m[key]={cnt:0,nombre,sku:ms?ms[1].trim():''}
        m[key].cnt++
      })
    })
    return Object.entries(m).map(([k,d])=>({k,...d})).sort((a,b)=>b.cnt-a.cnt).slice(0,5)
  }, [casosFil])
  const maxProd = Math.max(...porProducto.map(x=>x.cnt),1)

  // ── Monto total facturado (suma de doc_monto de todos los casos) ──
  const montoTotal = useMemo(() =>
    casosFil.reduce((s,c) => s + (Number(c.doc_monto)||0), 0)
  , [casosFil])

  // ── Monto reclamado — suma del monto_reclamado registrado en Form3 ──
  const montoReclamado = useMemo(() =>
    casosFil.reduce((s,c) => s + (Number(c.monto_reclamado)||0), 0)
  , [casosFil])

  // Etapas funnel
  const etapas = [
    {k:'abierto',               l:'Recepción',      ic:'📥', v:abiertos,  c:PBI.orange},
    {k:'en_validacion_tecnica', l:'Validación',     ic:'🔬', v:casosFil.filter(c=>c.estado==='en_validacion_tecnica').length, c:PBI.purple},
    {k:'en_resolucion',         l:'Resolución',     ic:'🔄', v:casosFil.filter(c=>c.estado==='en_resolucion').length, c:PBI.blue},
    {k:'transfer_pendiente',    l:'Transferencia',  ic:'💸', v:casosFil.filter(c=>c.estado==='transfer_pendiente').length, c:PBI.green},
    {k:'escalado',              l:'Escalado',       ic:'🔺', v:escalados, c:PBI.accent},
    {k:'cerrado',               l:'Cerrado',        ic:'✅', v:cerrados,  c:PBI.green},
    {k:'rechazado',             l:'Rechazado',      ic:'❌', v:rechazados,c:PBI.muted},
  ]
  const maxEtapa = Math.max(...etapas.map(e=>e.v),1)

  const recientes = [...casosFil].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,5)

  // ── Componentes internos SVG ──────────────────────────────────
  const Tooltip = ({txt, x, y}) => (
    <g>
      <rect x={x-4} y={y-22} width={txt.length*6.5+8} height={20}
        rx={4} fill="rgba(0,0,0,0.85)" stroke="rgba(255,255,255,0.15)" strokeWidth={0.5}/>
      <text x={x+txt.length*3.25} y={y-8} textAnchor="middle"
        fill="#fff" fontSize={10} fontWeight="600" fontFamily="monospace">{txt}</text>
    </g>
  )

  const PANEL = {
    background: PBI.panel,
    border:`1px solid ${PBI.border}`,
    borderRadius:16,
    padding:"18px 20px",
  }

  return (
    <div style={{background: PBI.bg, minHeight:"100vh", padding:"0 0 24px", fontFamily:FONT}}>

      {/* ── HEADER POWER BI ── */}
      <div style={{
        background:`linear-gradient(135deg, ${PBI.panel} 0%, #0d1b2e 100%)`,
        borderBottom:`1px solid ${PBI.border}`,
        padding:"16px 20px", marginBottom:16,
        display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10
      }}>
        <div>
          <div style={{fontSize:18, fontWeight:800, color:"#fff", letterSpacing:"-0.02em"}}>
            📊 Analytics — Postventa
          </div>
          <div style={{color:PBI.muted, fontSize:11, marginTop:2}}>
            {new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}
            {" · "}{cu.nombre} · {rl(cu).l}
          </div>
        </div>
        <div style={{display:"flex", gap:6, alignItems:"center", flexWrap:"wrap"}}>
          {/* Filtro temporal */}
          {['todos','7d','30d','90d'].map(p => (
            <button key={p} onClick={()=>setFiltroPer(p)} style={{
              padding:"5px 12px", borderRadius:8, border:`1px solid ${filtroPer===p?PBI.blue:PBI.border}`,
              background: filtroPer===p ? PBI.blue+"25" : "transparent",
              color: filtroPer===p ? PBI.blue : PBI.muted,
              cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:FONT,
              transition:"all 0.15s"
            }}>
              {p==='todos'?'Todo':p}
            </button>
          ))}
          {urgentes.length>0 && (
            <div style={{
              background:"rgba(233,69,96,0.2)", border:"1px solid rgba(233,69,96,0.4)",
              borderRadius:8, padding:"5px 12px", fontSize:11, color:PBI.accent, fontWeight:700
            }}>🔴 {urgentes.length} urgente{urgentes.length!==1?'s':''}</div>
          )}
          {h('crear_caso') && (
            <button onClick={onNuevo} style={{
              background:PBI.blue, color:"#000", border:"none", borderRadius:8,
              padding:"6px 14px", fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:FONT
            }}>+ Nuevo caso</button>
          )}
        </div>
      </div>

      <div style={{padding:"0 16px"}}>

        {/* ── FILA 1: KPI cards ── */}
        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))", gap:10, marginBottom:14}}>
          {[
            {l:"Total casos",      v:total,        ic:"📋", c:PBI.blue,
              sub:`${filtroPer==='todos'?'histórico':filtroPer}`},
            {l:"Abiertos",         v:abiertos,     ic:"📥", c:PBI.orange,
              sub:"esperando atención"},
            {l:"En curso",         v:enCurso,      ic:"⚙️", c:PBI.blue,
              sub:"validación · resolución · transfer"},
            {l:"Escalados",        v:escalados,    ic:"🔺", c:PBI.accent,
              sub:"requieren jefatura", alert:escalados>0},
            {l:"Transferencia",    v:transferPend, ic:"💸", c:PBI.green,
              sub:"pendiente Caja", alert:transferPend>0},
            {l:"Cerrados",         v:cerrados,     ic:"✅", c:PBI.green,
              sub:`${total>0?Math.round(cerrados/total*100):0}% del total`},
            {l:"Fuera de SLA",     v:vencidos,     ic:"⏱️", c:vencidos>0?PBI.accent:PBI.muted,
              sub:"vencidos", alert:vencidos>0},
            {l:"T. respuesta",     v:tResp?tResp.avg+"h":"—", ic:"🕐",
              c:tResp?(tResp.avg<=48?PBI.green:PBI.accent):PBI.muted,
              sub:tResp?`SLA: ${tResp.pct}%`:"sin datos"},
            {l:"Monto total",
              v: montoTotal >= 1000000
                ? `$${(montoTotal/1000000).toFixed(1)}M`
                : montoTotal >= 1000
                  ? `$${Math.round(montoTotal/1000)}K`
                  : fmt(montoTotal),
              ic:"💰", c:PBI.blue,
              sub:"suma boletas registradas"},
            {l:"Monto reclamado",
              v: montoReclamado >= 1000000
                ? `$${(montoReclamado/1000000).toFixed(1)}M`
                : montoReclamado >= 1000
                  ? `$${Math.round(montoReclamado/1000)}K`
                  : fmt(montoReclamado),
              ic:"💸", c:PBI.green,
              sub:"casos cerrados + transf."},
          ].map((m,i) => (
            <div key={m.l}
              onMouseEnter={()=>setHovKpi(i)}
              onMouseLeave={()=>setHovKpi(null)}
              style={{
                ...PANEL,
                padding:"14px 16px",
                borderColor: m.alert ? m.c+"60" : hovKpi===i ? m.c+"40" : PBI.border,
                background: hovKpi===i ? m.c+"12" : PBI.panel,
                transition:"all 0.2s", cursor:"default",
                position:"relative", overflow:"hidden"
              }}>
              {/* Acento lateral */}
              <div style={{
                position:"absolute", left:0, top:0, bottom:0,
                width:3, background:m.c, borderRadius:"16px 0 0 16px"
              }}/>
              <div style={{fontSize:18, marginBottom:6}}>{m.ic}</div>
              <div style={{
                fontSize:28, fontWeight:900, color:m.c,
                letterSpacing:"-0.04em", lineHeight:1, marginBottom:4
              }}>{m.v}</div>
              <div style={{fontSize:11, fontWeight:700, color:"#fff", marginBottom:2}}>{m.l}</div>
              <div style={{fontSize:10, color:PBI.muted}}>{m.sub}</div>
            </div>
          ))}
        </div>

        {/* ── FILA 2: Tendencia + Pipeline ── */}
        <div style={{display:"grid", gridTemplateColumns:"1fr 300px", gap:12, marginBottom:12}}>

          {/* Tendencia semanal — barras CSS */}
          <div style={PANEL}>
            <div style={{fontSize:13, fontWeight:700, color:"#fff", marginBottom:4}}>Tendencia — casos por semana</div>
            <div style={{fontSize:11, color:PBI.muted, marginBottom:12}}>Últimas 8 semanas (todos los casos)</div>
            <div style={{display:"flex", alignItems:"flex-end", gap:4, height:110, paddingBottom:20, position:"relative"}}>
              {/* Línea base */}
              <div style={{
                position:"absolute", bottom:20, left:0, right:0,
                height:1, background:PBI.border
              }}/>
              {tendencia.map((w,i) => {
                const BAR_MAX = 80  // px máximo de barra
                const barH = maxTend > 0 ? Math.max(Math.round(w.cnt/maxTend*BAR_MAX), w.cnt>0?6:1) : 1
                const isHov = hovBar===`tend${i}`
                return (
                  <div key={i}
                    style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:0, cursor:"pointer"}}
                    onMouseEnter={()=>setHovBar(`tend${i}`)}
                    onMouseLeave={()=>setHovBar(null)}>
                    {/* Valor encima */}
                    <div style={{
                      fontSize:10, fontWeight:700,
                      color: isHov ? "#fff" : w.cnt>0 ? PBI.blue : "transparent",
                      marginBottom:3, minHeight:14
                    }}>{w.cnt>0 ? w.cnt : ""}</div>
                    {/* Barra */}
                    <div style={{
                      width:"80%", height:barH,
                      background: isHov ? PBI.blue : w.cnt>0 ? PBI.blue+"90" : PBI.border,
                      borderRadius:"3px 3px 0 0",
                      transition:"all 0.2s",
                      boxShadow: isHov ? `0 0 10px ${PBI.blue}70` : "none"
                    }}/>
                    {/* Label fecha */}
                    <div style={{
                      fontSize:9, color: isHov?"#fff":PBI.muted,
                      marginTop:4, textAlign:"center", lineHeight:1.2,
                      position:"absolute", bottom:0
                    }}>{w.label}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Pipeline — barras CSS */}
          <div style={PANEL}>
            <div style={{fontSize:13, fontWeight:700, color:"#fff", marginBottom:4}}>Pipeline de etapas</div>
            <div style={{fontSize:11, color:PBI.muted, marginBottom:14}}>Casos por estado actual</div>
            {etapas.map((e,i) => {
              const pct = Math.round(e.v/maxEtapa*100)
              const isHov = hovEtapa===i
              return (
                <div key={e.k}
                  onMouseEnter={()=>setHovEtapa(i)}
                  onMouseLeave={()=>setHovEtapa(null)}
                  style={{marginBottom:9}}>
                  <div style={{display:"flex", justifyContent:"space-between", marginBottom:3}}>
                    <div style={{fontSize:11, color:isHov?"#fff":PBI.text, fontWeight:isHov?700:400,
                      display:"flex", gap:5, alignItems:"center"}}>
                      <span style={{fontSize:12}}>{e.ic}</span>{e.l}
                    </div>
                    <div style={{fontSize:12, fontWeight:800, color:e.c}}>{e.v}</div>
                  </div>
                  <div style={{height:7, background:PBI.bg, borderRadius:4, overflow:"hidden"}}>
                    <div style={{
                      height:"100%", width:`${pct}%`, background:e.c,
                      borderRadius:4, transition:"width 0.6s ease",
                      opacity:isHov?1:0.7,
                      boxShadow:isHov?`0 0 8px ${e.c}80`:undefined
                    }}/>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── FILA 3: Códigos + Canal + SLA ── */}
        <div style={{display:"grid", gridTemplateColumns:"1fr 200px 240px", gap:12, marginBottom:12}}>

          {/* Códigos frecuentes — barras CSS */}
          <div style={PANEL}>
            <div style={{fontSize:13, fontWeight:700, color:"#fff", marginBottom:4}}>Códigos más frecuentes</div>
            <div style={{fontSize:11, color:PBI.muted, marginBottom:12}}>Clasificación V2.0</div>
            {porCodigo.map((x,i) => {
              const pct = Math.round(x.cnt/maxCod*100)
              const isHov = hovBar===`cod${i}`
              const cl = CL[BLOQUE_CL[x.bloque]||'D']
              return (
                <div key={x.cod}
                  onMouseEnter={()=>setHovBar(`cod${i}`)}
                  onMouseLeave={()=>setHovBar(null)}
                  style={{marginBottom:8, cursor:"default"}}>
                  <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3}}>
                    <div style={{display:"flex", gap:6, alignItems:"center", minWidth:0, flex:1}}>
                      <span style={{
                        fontSize:10, fontWeight:800, color:cl.c,
                        flexShrink:0, width:26
                      }}>{x.cod}</span>
                      {isHov && (
                        <span style={{
                          fontSize:10, color:PBI.muted,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"
                        }}>{x.desc}</span>
                      )}
                    </div>
                    <span style={{fontSize:11, fontWeight:800, color:isHov?"#fff":PBI.muted, flexShrink:0, marginLeft:6}}>
                      {x.cnt}
                    </span>
                  </div>
                  <div style={{height:8, background:PBI.bg, borderRadius:4, overflow:"hidden"}}>
                    <div style={{
                      height:"100%", width:`${pct}%`,
                      background:cl.c, borderRadius:4,
                      opacity:isHov?1:0.7,
                      transition:"all 0.2s",
                      boxShadow:isHov?`0 0 8px ${cl.c}80`:undefined
                    }}/>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Canal de ingreso — donut CSS */}
          <div style={PANEL}>
            <div style={{fontSize:13, fontWeight:700, color:"#fff", marginBottom:4}}>Canal de ingreso</div>
            <div style={{fontSize:11, color:PBI.muted, marginBottom:12}}>Por tipo</div>
            {(() => {
              const COLS = [PBI.blue,PBI.green,PBI.orange,PBI.purple,PBI.accent]
              const tot  = porCanal.reduce((s,x)=>s+x.v,0)||1
              // Donut con conic-gradient
              const stops = []
              let acc = 0
              porCanal.forEach((x,i) => {
                const pct = x.v/tot*100
                stops.push(`${COLS[i%COLS.length]} ${acc}% ${acc+pct}%`)
                acc += pct
              })
              return (
                <div>
                  <div style={{
                    width:90, height:90, borderRadius:"50%", margin:"0 auto 12px",
                    background:`conic-gradient(${stops.join(', ')})`,
                    position:"relative"
                  }}>
                    <div style={{
                      position:"absolute", inset:"18px",
                      borderRadius:"50%", background:PBI.panel,
                      display:"flex", flexDirection:"column",
                      alignItems:"center", justifyContent:"center"
                    }}>
                      <div style={{fontSize:14,fontWeight:900,color:"#fff"}}>{tot}</div>
                      <div style={{fontSize:8,color:PBI.muted}}>total</div>
                    </div>
                  </div>
                  {porCanal.slice(0,5).map((x,i) => (
                    <div key={x.k} style={{
                      display:"flex", alignItems:"center", gap:6,
                      marginBottom:5, padding:"3px 0"
                    }}>
                      <div style={{width:8,height:8,borderRadius:2,background:COLS[i%COLS.length],flexShrink:0}}/>
                      <div style={{flex:1,fontSize:10,color:PBI.muted,
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{x.k}</div>
                      <div style={{fontSize:11,fontWeight:700,color:"#fff"}}>{x.v}</div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* SLA gauge CSS */}
          <div style={PANEL}>
            <div style={{fontSize:13, fontWeight:700, color:"#fff", marginBottom:4}}>Cumplimiento SLA</div>
            <div style={{fontSize:11, color:PBI.muted, marginBottom:12}}>Target ≤{SLA.resolucion}h</div>
            {tResp ? (
              <div>
                {/* Gauge semicircular con border-radius trick */}
                {(() => {
                  const pct = tResp.pct
                  const c = pct>=80?PBI.green:pct>=50?PBI.orange:PBI.accent
                  const deg = Math.round(pct*1.8) // 0-180 grados
                  return (
                    <div style={{textAlign:"center", marginBottom:12}}>
                      <div style={{
                        position:"relative", width:120, height:60,
                        margin:"0 auto 8px", overflow:"hidden"
                      }}>
                        {/* Fondo gris */}
                        <div style={{
                          position:"absolute", inset:0, bottom:"auto",
                          width:120, height:120, borderRadius:"60px 60px 0 0",
                          background:PBI.bg
                        }}/>
                        {/* Arco coloreado usando clip */}
                        <div style={{
                          position:"absolute", inset:0, bottom:"auto",
                          width:120, height:120, borderRadius:"60px 60px 0 0",
                          background:`conic-gradient(from 180deg, ${c} 0deg, ${c} ${deg}deg, transparent ${deg}deg)`,
                          opacity:0.9
                        }}/>
                        {/* Hueco interior */}
                        <div style={{
                          position:"absolute", left:20, right:20, top:20, bottom:0,
                          borderRadius:"40px 40px 0 0", background:PBI.panel
                        }}/>
                        {/* Texto */}
                        <div style={{
                          position:"absolute", bottom:4, left:0, right:0,
                          textAlign:"center"
                        }}>
                          <div style={{fontSize:22,fontWeight:900,color:c}}>{pct}%</div>
                        </div>
                      </div>
                      <div style={{fontSize:11,color:PBI.muted}}>dentro del SLA</div>
                    </div>
                  )
                })()}
                <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6}}>
                  {[
                    {l:"Promedio",v:`${tResp.avg}h`,c:tResp.avg<=48?PBI.green:PBI.orange},
                    {l:"Mínimo",  v:`${tResp.min}h`,c:PBI.green},
                    {l:"Máximo",  v:`${tResp.max}h`,c:tResp.max>96?PBI.accent:PBI.orange},
                  ].map(t=>(
                    <div key={t.l} style={{background:PBI.bg,borderRadius:8,padding:"7px 4px",textAlign:"center"}}>
                      <div style={{fontSize:9,color:PBI.muted,fontWeight:600,marginBottom:2}}>{t.l}</div>
                      <div style={{fontSize:13,fontWeight:800,color:t.c}}>{t.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{color:PBI.muted,fontSize:12,textAlign:"center",padding:"20px 0"}}>
                Sin casos cerrados todavía
              </div>
            )}
          </div>
        </div>

        {/* ── FILA 4: Vendedores + Productos + Urgentes ── */}
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 240px", gap:12, marginBottom:12}}>

          {/* Vendedores — barras CSS */}
          <div style={PANEL}>
            <div style={{fontSize:13, fontWeight:700, color:"#fff", marginBottom:4}}>Vendedores — casos</div>
            <div style={{fontSize:11, color:PBI.muted, marginBottom:12}}>
              <span style={{display:"inline-flex",gap:10,alignItems:"center"}}>
                {[{c:PBI.green,l:"Cerrados"},{c:PBI.blue+"80",l:"Total"},{c:PBI.accent,l:"Escalados"}].map(l=>(
                  <span key={l.l} style={{display:"flex",gap:4,alignItems:"center"}}>
                    <span style={{width:8,height:8,borderRadius:2,background:l.c,display:"inline-block"}}/>
                    <span>{l.l}</span>
                  </span>
                ))}
              </span>
            </div>
            {porVendedor.map((v,i) => {
              const pctTot = Math.round(v.total/maxVend*100)
              const pctCer = v.total>0?Math.round(v.cerrados/v.total*100):0
              const pctEsc = v.total>0?Math.round(v.escalados/v.total*100):0
              const isHov  = hovVend===i
              return (
                <div key={v.n}
                  onMouseEnter={()=>setHovVend(i)}
                  onMouseLeave={()=>setHovVend(null)}
                  style={{marginBottom:10}}>
                  <div style={{display:"flex", justifyContent:"space-between", marginBottom:3}}>
                    <span style={{fontSize:11,color:isHov?"#fff":PBI.text,fontWeight:isHov?700:400}}>
                      {v.n.split(" ").slice(0,2).join(" ")}
                    </span>
                    <span style={{fontSize:11,fontWeight:800,color:isHov?"#fff":PBI.muted}}>
                      {v.total}
                      {isHov && <span style={{color:PBI.muted,fontWeight:400}}> · {v.cerrados}✅ · {v.escalados}🔺</span>}
                    </span>
                  </div>
                  {/* Barra total (fondo) */}
                  <div style={{height:10, background:PBI.bg, borderRadius:4, overflow:"hidden", position:"relative"}}>
                    <div style={{
                      position:"absolute", left:0, top:0, bottom:0,
                      width:`${pctTot}%`, background:PBI.blue+"40", borderRadius:4
                    }}/>
                    <div style={{
                      position:"absolute", left:0, top:0, height:"60%",
                      width:`${pctTot*pctCer/100}%`,
                      background:PBI.green, borderRadius:"4px 0 0 0",
                      opacity:isHov?1:0.8
                    }}/>
                    {pctEsc>0 && (
                      <div style={{
                        position:"absolute", left:0, bottom:0, height:"40%",
                        width:`${pctTot*pctEsc/100}%`,
                        background:PBI.accent, opacity:isHov?1:0.8
                      }}/>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Productos — barras CSS */}
          <div style={PANEL}>
            <div style={{fontSize:13, fontWeight:700, color:"#fff", marginBottom:4}}>Productos más reclamados</div>
            <div style={{fontSize:11, color:PBI.muted, marginBottom:12}}>Desde registros BSALE</div>
            {porProducto.length===0 ? (
              <div style={{color:PBI.muted,fontSize:12,textAlign:"center",padding:"20px 0"}}>Sin productos registrados</div>
            ) : porProducto.map((p,i) => {
              const pct = Math.round(p.cnt/maxProd*100)
              const isHov = hovProd===i
              const c = [PBI.blue,PBI.purple,PBI.orange,PBI.green,PBI.accent][i%5]
              return (
                <div key={p.k}
                  onMouseEnter={()=>setHovProd(i)}
                  onMouseLeave={()=>setHovProd(null)}
                  style={{marginBottom:10}}>
                  <div style={{display:"flex", justifyContent:"space-between", marginBottom:2}}>
                    <div style={{minWidth:0, flex:1}}>
                      <div style={{fontSize:11, fontWeight:isHov?700:400,
                        color:isHov?"#fff":PBI.text,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                        {p.nombre}
                      </div>
                      {p.sku && <div style={{fontSize:9, color:PBI.muted+"80"}}>{p.sku}</div>}
                    </div>
                    <span style={{fontSize:12, fontWeight:800, color:c, flexShrink:0, marginLeft:8}}>{p.cnt}</span>
                  </div>
                  <div style={{height:8, background:PBI.bg, borderRadius:4, overflow:"hidden"}}>
                    <div style={{
                      height:"100%", width:`${pct}%`, background:c,
                      borderRadius:4, opacity:isHov?1:0.7,
                      transition:"all 0.2s",
                      boxShadow:isHov?`0 0 8px ${c}80`:undefined
                    }}/>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Donut — distribución por canal */}
          <div style={PANEL}>
            <div style={{fontSize:13, fontWeight:700, color:"#fff", marginBottom:4}}>Canal de ingreso</div>
            <div style={{fontSize:11, color:PBI.muted, marginBottom:10}}>Por tipo</div>
            {(() => {
              const COLS = [PBI.blue,PBI.green,PBI.orange,PBI.purple,PBI.accent,PBI.muted]
              const tot  = porCanal.reduce((s,x)=>s+x.v,0)||1
              let ang = -90
              const slices = porCanal.map((x,i) => {
                const pct = x.v/tot
                const a1  = ang
                const a2  = ang + pct*360
                ang = a2
                const r = 55, cx = 90, cy = 75
                const x1 = cx+r*Math.cos(a1*Math.PI/180)
                const y1 = cy+r*Math.sin(a1*Math.PI/180)
                const x2 = cx+r*Math.cos(a2*Math.PI/180)
                const y2 = cy+r*Math.sin(a2*Math.PI/180)
                const lg = pct > 0.5 ? 1 : 0
                return {x,i,pct,a1,a2,x1,y1,x2,y2,lg,c:COLS[i%COLS.length]}
              })
              return (
                <div>
                  <svg viewBox="0 0 180 150" style={{width:"100%"}}>
                    {slices.map((s,i) => {
                      const isHov = hovBar===`canal${i}`
                      const r = isHov ? 60 : 55
                      const cx=90, cy=75
                      const x1=cx+r*Math.cos(s.a1*Math.PI/180)
                      const y1=cy+r*Math.sin(s.a1*Math.PI/180)
                      const x2=cx+r*Math.cos(s.a2*Math.PI/180)
                      const y2=cy+r*Math.sin(s.a2*Math.PI/180)
                      return (
                        <path key={i}
                          d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${s.lg},1 ${x2},${y2} Z`}
                          fill={s.c} opacity={isHov?1:0.8}
                          style={{transition:"all 0.2s", cursor:"pointer"}}
                          onMouseEnter={()=>setHovBar(`canal${i}`)}
                          onMouseLeave={()=>setHovBar(null)}/>
                      )
                    })}
                    {/* Hole */}
                    <circle cx={90} cy={75} r={35} fill={PBI.panel}/>
                    <text x={90} y={72} textAnchor="middle" fill="#fff" fontSize={14} fontWeight="800" fontFamily={FONT}>{tot}</text>
                    <text x={90} y={85} textAnchor="middle" fill={PBI.muted} fontSize={9} fontFamily={FONT}>total</text>
                  </svg>
                  {slices.slice(0,4).map((s,i) => (
                    <div key={i} style={{display:"flex", alignItems:"center", gap:6, marginBottom:4}}>
                      <div style={{width:8,height:8,borderRadius:2,background:s.c,flexShrink:0}}/>
                      <div style={{fontSize:10,color:PBI.muted,flex:1,
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {s.x.k}
                      </div>
                      <div style={{fontSize:10,fontWeight:700,color:"#fff"}}>{s.x.v}</div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* SLA gauge */}
          <div style={PANEL}>
            <div style={{fontSize:13, fontWeight:700, color:"#fff", marginBottom:4}}>Cumplimiento SLA</div>
            <div style={{fontSize:11, color:PBI.muted, marginBottom:14}}>Target: ≤{SLA.resolucion}h</div>
            {tResp ? (
              <div>
                {/* Gauge arc SVG */}
                {(() => {
                  const pct = tResp.pct/100
                  const r=70, cx=120, cy=110, startAng=-180, endAng=0
                  const toXY=(ang,rr)=>({x:cx+rr*Math.cos(ang*Math.PI/180),y:cy+rr*Math.sin(ang*Math.PI/180)})
                  const bgS = toXY(startAng,r), bgE = toXY(endAng,r)
                  const valAng = startAng + pct*180
                  const valE = toXY(valAng,r)
                  const c = pct>=0.8 ? PBI.green : pct>=0.5 ? PBI.orange : PBI.accent
                  return (
                    <svg viewBox="0 0 240 130" style={{width:"100%"}}>
                      {/* Fondo arco */}
                      <path d={`M${bgS.x},${bgS.y} A${r},${r} 0 0,1 ${bgE.x},${bgE.y}`}
                        fill="none" stroke={PBI.bg} strokeWidth={18} strokeLinecap="round"/>
                      {/* Arco valor */}
                      <path d={`M${bgS.x},${bgS.y} A${r},${r} 0 0,1 ${valE.x},${valE.y}`}
                        fill="none" stroke={c} strokeWidth={18} strokeLinecap="round"
                        style={{filter:`drop-shadow(0 0 6px ${c}80)`}}/>
                      {/* Texto central */}
                      <text x={cx} y={cy-8} textAnchor="middle" fill={c}
                        fontSize={28} fontWeight="900" fontFamily={FONT}>{tResp.pct}%</text>
                      <text x={cx} y={cy+10} textAnchor="middle" fill={PBI.muted}
                        fontSize={10} fontFamily={FONT}>dentro de SLA</text>
                      {/* Ticks */}
                      {[0,25,50,75,100].map(v => {
                        const a = -180+v*1.8
                        const p1=toXY(a,r-12), p2=toXY(a,r-20)
                        return <line key={v} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                          stroke={PBI.border} strokeWidth={1.5}/>
                      })}
                    </svg>
                  )
                })()}
                <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginTop:4}}>
                  {[
                    {l:"Promedio", v:`${tResp.avg}h`, c:tResp.avg<=48?PBI.green:PBI.orange},
                    {l:"Mínimo",   v:`${tResp.min}h`, c:PBI.green},
                    {l:"Máximo",   v:`${tResp.max}h`, c:tResp.max>96?PBI.accent:PBI.orange},
                  ].map(t => (
                    <div key={t.l} style={{background:PBI.bg,borderRadius:8,padding:"6px",textAlign:"center"}}>
                      <div style={{fontSize:9,color:PBI.muted,fontWeight:600,marginBottom:2}}>{t.l}</div>
                      <div style={{fontSize:14,fontWeight:800,color:t.c}}>{t.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{color:PBI.muted,fontSize:12,textAlign:"center",padding:"20px 0"}}>
                Sin casos cerrados todavía
              </div>
            )}
          </div>
        </div>
        {/* ── FILA 5: Actividad reciente ── */}
        <div style={PANEL}>
          <div style={{
            display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14
          }}>
            <div>
              <div style={{fontSize:13, fontWeight:700, color:"#fff"}}>Actividad reciente</div>
              <div style={{fontSize:11, color:PBI.muted, marginTop:1}}>Últimos casos registrados</div>
            </div>
            {h('crear_caso') && (
              <button onClick={onNuevo} style={{
                background:"transparent", border:`1px solid ${PBI.border}`, color:PBI.blue,
                borderRadius:8, padding:"5px 12px", fontSize:11, fontWeight:700,
                cursor:"pointer", fontFamily:FONT
              }}>+ Nuevo caso</button>
            )}
          </div>
          {/* Tabla */}
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%", borderCollapse:"collapse"}}>
              <thead>
                <tr>
                  {["N° Caso","Cliente","Estado","Código","Canal","Sucursal","Fecha","Monto"].map(h=>(
                    <th key={h} style={{
                      padding:"7px 12px", textAlign:"left",
                      fontSize:10, fontWeight:700, textTransform:"uppercase",
                      letterSpacing:"0.05em", color:PBI.muted,
                      borderBottom:`1px solid ${PBI.border}`
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recientes.map((c,i) => {
                  const est = ESTADOS[c.estado]||ESTADOS.abierto
                  const blq = c.codigo_final?.slice(0,2)||'?'
                  const cl  = CL[BLOQUE_CL[blq]||'D']
                  return (
                    <tr key={c.id} onClick={()=>onVerCaso(c)} style={{
                      cursor:"pointer",
                      background: i%2===0?"transparent":"rgba(255,255,255,0.02)",
                      transition:"background 0.1s"
                    }}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(79,195,247,0.08)"}
                    onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":"rgba(255,255,255,0.02)"}>
                      <td style={{padding:"8px 12px", fontSize:12, fontWeight:700, color:PBI.blue}}>
                        {c.numero}
                      </td>
                      <td style={{padding:"8px 12px", fontSize:12, color:PBI.text, maxWidth:140,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                        {c.cliente_nombre}
                      </td>
                      <td style={{padding:"8px 12px"}}>
                        <span style={{
                          background:est.c+"20", color:est.c,
                          borderRadius:6, padding:"2px 8px", fontSize:10, fontWeight:700
                        }}>{est.ic} {est.l}</span>
                      </td>
                      <td style={{padding:"8px 12px"}}>
                        {c.codigo_final && (
                          <span style={{
                            background:cl.c+"20", color:cl.c,
                            borderRadius:6, padding:"2px 8px", fontSize:10, fontWeight:700
                          }}>{c.codigo_final}</span>
                        )}
                      </td>
                      <td style={{padding:"8px 12px", fontSize:11, color:PBI.muted}}>
                        {c.canal_ingreso}
                      </td>
                      <td style={{padding:"8px 12px", fontSize:11, color:PBI.muted}}>
                        {c.sucursal?.replace(/_/g,' ')}
                      </td>
                      <td style={{padding:"8px 12px", fontSize:11, color:PBI.muted}}>
                        {c.fecha_recepcion}
                        {c.hora_recepcion && <span style={{color:PBI.muted+"80"}}> {c.hora_recepcion}</span>}
                      </td>
                      <td style={{padding:"8px 12px", fontSize:12, fontWeight:700, color:PBI.green,
                        textAlign:"right"}}>
                        {c.doc_monto>0?fmt(c.doc_monto):"—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
// ─── LISTA DE CASOS ───────────────────────────────────────────────────────
const ListaCasos = ({casos, cu, onVerCaso, onNuevo, onRefresh}) => {
  const h = p => hp(cu, p)
  const [busq,        setBusq]        = useState("")
  const [filtEst,     setFiltEst]     = useState("activos")  // 'activos'|'cerrados'|'todos'|estado específico
  const [filtSuc,     setFiltSuc]     = useState("todas")
  const [filtCanal,   setFiltCanal]   = useState("todos")
  const [filtCodigo,  setFiltCodigo]  = useState("todos")
  const [filtFechaD,  setFiltFechaD]  = useState("")  // desde
  const [filtFechaH,  setFiltFechaH]  = useState("")  // hasta
  const [mostrarAdv,  setMostrarAdv]  = useState(false)
  const [verPapelera, setVerPapelera] = useState(false)
  const [eliminados,  setEliminados]  = useState([])
  const [loadingEli,  setLoadingEli]  = useState(false)
  const [confirmDel,  setConfirmDel]  = useState(null)
  const esAdmin = cu.rol === 'admin'

  // Estados "activos" = todo lo que no está cerrado ni rechazado
  const ESTADOS_ACTIVOS = ['abierto','en_validacion_tecnica','en_resolucion','escalado','transfer_pendiente']
  const ESTADOS_CERRADOS = ['cerrado','rechazado']

  const fil = useMemo(() => casos.filter(c => {
    if (c.deleted_at) return false

    // Búsqueda texto
    const txt = busq.toLowerCase()
    if (busq && !(
      c.cliente_nombre?.toLowerCase().includes(txt) ||
      c.cliente_rut?.toLowerCase().includes(txt) ||
      c.numero?.toLowerCase().includes(txt) ||
      c.codigo_final?.toLowerCase().includes(txt) ||
      c.codigo_provisional?.toLowerCase().includes(txt) ||
      c.doc_numero?.toLowerCase().includes(txt) ||
      c.motivo_cliente?.toLowerCase().includes(txt)
    )) return false

    // Filtro estado — quick filter
    if (filtEst === "activos"  && !ESTADOS_ACTIVOS.includes(c.estado))  return false
    if (filtEst === "cerrados" && !ESTADOS_CERRADOS.includes(c.estado)) return false
    if (!["activos","cerrados","todos"].includes(filtEst) && c.estado !== filtEst) return false

    // Filtros avanzados
    if (filtSuc   !== "todas" && c.sucursal     !== filtSuc)    return false
    if (filtCanal !== "todos" && c.canal_ingreso !== filtCanal) return false
    if (filtCodigo!== "todos" &&
        c.codigo_final !== filtCodigo &&
        c.codigo_provisional !== filtCodigo) return false

    if (filtFechaD && c.fecha_recepcion < filtFechaD) return false
    if (filtFechaH && c.fecha_recepcion > filtFechaH) return false

    return true
  }).sort((a,b) => new Date(b.created_at) - new Date(a.created_at)),
  [casos, busq, filtEst, filtSuc, filtCanal, filtCodigo, filtFechaD, filtFechaH])

  // Conteos para los quick filters
  const cntActivos  = useMemo(() => casos.filter(c => !c.deleted_at && ESTADOS_ACTIVOS.includes(c.estado)).length, [casos])
  const cntCerrados = useMemo(() => casos.filter(c => !c.deleted_at && ESTADOS_CERRADOS.includes(c.estado)).length, [casos])
  const cntTodos    = useMemo(() => casos.filter(c => !c.deleted_at).length, [casos])

  // Códigos únicos para el filtro
  const codigosUnicos = useMemo(() => {
    const s = new Set()
    casos.forEach(c => {
      if (c.codigo_final) s.add(c.codigo_final)
      if (c.codigo_provisional) s.add(c.codigo_provisional)
    })
    return [...s].sort()
  }, [casos])

  const hayFiltrosAvanzados = filtSuc !== "todas" || filtCanal !== "todos" ||
    filtCodigo !== "todos" || filtFechaD || filtFechaH

  const limpiarFiltros = () => {
    setBusq(""); setFiltEst("activos"); setFiltSuc("todas")
    setFiltCanal("todos"); setFiltCodigo("todos")
    setFiltFechaD(""); setFiltFechaH("")
  }

  // Cargar casos eliminados
  const cargarEliminados = async () => {
    setLoadingEli(true)
    const { data } = await supabase
      .from('casos_postventa').select('*')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    setEliminados(data || [])
    setLoadingEli(false)
  }

  const abrirPapelera = () => { setVerPapelera(true); cargarEliminados() }

  const eliminarCaso = async (caso) => {
    await supabase.from('casos_postventa').update({
      deleted_at: new Date().toISOString(),
      deleted_by: cu.nombre,
    }).eq('id', caso.id)
    setConfirmDel(null)
    onRefresh()
  }

  const restaurarCaso = async (caso) => {
    await supabase.from('casos_postventa').update({
      deleted_at: null, deleted_by: null,
    }).eq('id', caso.id)
    cargarEliminados()
    onRefresh()
  }

  return (
    <div>
      {/* ── Barra principal ── */}
      <Cd>
        {/* Fila 1: búsqueda + acciones */}
        <div style={{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", marginBottom:10}}>
          <input style={{...css.input, flex:"1 1 200px", maxWidth:340}}
            placeholder="🔍 Buscar nombre, RUT, N° caso, código, doc..."
            value={busq} onChange={e => setBusq(e.target.value)}/>
          <Bt sm variant="secondary"
            onClick={() => setMostrarAdv(!mostrarAdv)}
            style={{background: hayFiltrosAvanzados ? "#007AFF15" : undefined,
                    color:      hayFiltrosAvanzados ? "#007AFF"   : undefined}}>
            {hayFiltrosAvanzados ? "🔽 Filtros activos" : "⚙️ Filtros"}
          </Bt>
          {(busq || hayFiltrosAvanzados || filtEst !== "activos") && (
            <Bt sm variant="secondary" onClick={limpiarFiltros}>✕ Limpiar</Bt>
          )}
          {h('crear_caso') && <Bt sm onClick={onNuevo}>+ Nuevo</Bt>}
          {esAdmin && (
            <Bt sm variant="secondary" onClick={abrirPapelera}>🗑️ Papelera</Bt>
          )}
        </div>

        {/* Fila 2: Quick filters de estado */}
        <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
          {[
            {k:"activos",  l:"Activos",  cnt:cntActivos,  c:"#007AFF"},
            {k:"cerrados", l:"Cerrados", cnt:cntCerrados, c:"#34C759"},
            {k:"todos",    l:"Todos",    cnt:cntTodos,    c:"#8E8E93"},
            // Estado individuales
            {k:"abierto",               l:"Recepción",    cnt: casos.filter(c=>!c.deleted_at&&c.estado==='abierto').length,               c:"#FF9500"},
            {k:"en_validacion_tecnica", l:"Validación",   cnt: casos.filter(c=>!c.deleted_at&&c.estado==='en_validacion_tecnica').length,  c:"#AF52DE"},
            {k:"en_resolucion",         l:"Resolución",   cnt: casos.filter(c=>!c.deleted_at&&c.estado==='en_resolucion').length,          c:"#007AFF"},
            {k:"escalado",              l:"Escalado",     cnt: casos.filter(c=>!c.deleted_at&&c.estado==='escalado').length,               c:"#FF3B30"},
            {k:"transfer_pendiente",    l:"Transferencia",cnt: casos.filter(c=>!c.deleted_at&&c.estado==='transfer_pendiente').length,     c:"#34C759"},
            {k:"cerrado",               l:"Cerrado",      cnt: casos.filter(c=>!c.deleted_at&&c.estado==='cerrado').length,                c:"#34C759"},
            {k:"rechazado",             l:"Rechazado",    cnt: casos.filter(c=>!c.deleted_at&&c.estado==='rechazado').length,              c:"#8E8E93"},
          ].map(q => (
            <button key={q.k} onClick={() => setFiltEst(q.k)} style={{
              display:"flex", alignItems:"center", gap:5,
              padding:"5px 12px", borderRadius:20, border:"none",
              cursor:"pointer", fontFamily:FONT, fontSize:12, fontWeight:600,
              background: filtEst===q.k ? q.c : "#F2F2F7",
              color:      filtEst===q.k ? "#fff" : "#8E8E93",
              transition:"all 0.15s"
            }}>
              {q.l}
              {q.cnt > 0 && (
                <span style={{
                  background: filtEst===q.k ? "rgba(255,255,255,0.3)" : q.c+"20",
                  color:      filtEst===q.k ? "#fff" : q.c,
                  borderRadius:10, padding:"1px 6px", fontSize:10, fontWeight:800
                }}>{q.cnt}</span>
              )}
            </button>
          ))}
        </div>

        {/* Fila 3: Filtros avanzados desplegables */}
        {mostrarAdv && (
          <div style={{
            marginTop:12, paddingTop:12,
            borderTop:"1px solid #F0F0F0",
            display:"grid",
            gridTemplateColumns:"repeat(auto-fit, minmax(150px,1fr))",
            gap:8
          }}>
            <div>
              <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                textTransform:"uppercase", marginBottom:4}}>Sucursal</div>
              <select style={css.select} value={filtSuc}
                onChange={e => setFiltSuc(e.target.value)}>
                <option value="todas">Todas</option>
                <option value="la_granja">La Granja</option>
                <option value="maipu">Maipú</option>
                <option value="los_angeles">Los Ángeles</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                textTransform:"uppercase", marginBottom:4}}>Canal</div>
              <select style={css.select} value={filtCanal}
                onChange={e => setFiltCanal(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="presencial">Presencial</option>
                <option value="telefono">Teléfono</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="correo">Correo</option>
                <option value="despacho">Despacho</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                textTransform:"uppercase", marginBottom:4}}>Código</div>
              <select style={css.select} value={filtCodigo}
                onChange={e => setFiltCodigo(e.target.value)}>
                <option value="todos">Todos</option>
                {codigosUnicos.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                textTransform:"uppercase", marginBottom:4}}>Desde</div>
              <input style={css.input} type="date"
                value={filtFechaD} max={filtFechaH || undefined}
                onChange={e => setFiltFechaD(e.target.value)}/>
            </div>
            <div>
              <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                textTransform:"uppercase", marginBottom:4}}>Hasta</div>
              <input style={css.input} type="date"
                value={filtFechaH} min={filtFechaD || undefined}
                onChange={e => setFiltFechaH(e.target.value)}/>
            </div>
          </div>
        )}
      </Cd>

      {/* Conteo + resumen filtros */}
      <div style={{
        fontSize:12, color:"#8E8E93", marginBottom:8, marginLeft:4,
        display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"
      }}>
        <span style={{fontWeight:600, color:"#1C1C1E"}}>
          {fil.length} caso{fil.length!==1?"s":""}
        </span>
        {filtEst !== "activos" && (
          <Bd c="#007AFF" bg="#007AFF12">
            {filtEst === "cerrados" ? "Cerrados" :
             filtEst === "todos"    ? "Todos"    :
             ESTADOS[filtEst]?.l   || filtEst}
          </Bd>
        )}
        {filtSuc !== "todas" && <Bd c="#8E8E93" bg="#F2F2F7">{filtSuc.replace('_',' ')}</Bd>}
        {filtCanal !== "todos" && <Bd c="#8E8E93" bg="#F2F2F7">{filtCanal}</Bd>}
        {filtCodigo !== "todos" && <Bd c="#8E8E93" bg="#F2F2F7">{filtCodigo}</Bd>}
        {(filtFechaD || filtFechaH) && (
          <Bd c="#8E8E93" bg="#F2F2F7">
            {filtFechaD || "inicio"} → {filtFechaH || "hoy"}
          </Bd>
        )}
      </div>

      {/* Lista */}
      {fil.length === 0 ? (
        <Cd><div style={{textAlign:"center", color:"#8E8E93", padding:"24px 0"}}>Sin resultados para los filtros aplicados</div></Cd>
      ) : fil.map(c => {
        const est = ESTADOS[c.estado] || ESTADOS.abierto
        const blq = c.codigo_final?.slice(0,2) || 'S/C'
        const cl  = CL[BLOQUE_CL[blq] || 'D']
        const hrs = horasDesde(c.created_at)
        return (
          <div key={c.id} style={{position:"relative"}}>
            <Cd ac={c.es_critico ? "#FF3B30" : c.estado==='escalado' ? "#FF9500" : undefined}
              onClick={() => onVerCaso(c)}>
              <div style={{display:"flex", gap:10, alignItems:"flex-start"}}>
                <div style={{
                  width:42, height:42, borderRadius:10,
                  background:cl.bg, color:cl.c,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontWeight:800, fontSize:13, flexShrink:0
                }}>{blq}</div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginBottom:3}}>
                    <span style={{fontWeight:800, fontSize:14}}>{c.numero||c.id}</span>
                    <Bd c={est.c} bg={est.bg}>{est.ic} {est.l}</Bd>
                    {c.es_critico && <Bd c="#FF3B30" bg="#FF3B3015">🔴 B5 Crítico</Bd>}
                    {c.codigo_final && <Bd c={cl.c} bg={cl.bg}>{c.codigo_final}</Bd>}
                    {c.migrado_desde && <Bd c="#8E8E93" bg="#F2F2F7">📂 Histórico</Bd>}
                  </div>
                  <div style={{fontSize:13, fontWeight:600}}>{c.cliente_nombre}
                    <span style={{color:"#8E8E93", fontWeight:400}}> · {c.cliente_rut}</span>
                  </div>
                  <div style={{display:"flex", gap:12, marginTop:3, fontSize:11, color:"#8E8E93", flexWrap:"wrap"}}>
                    <span>📍 {c.sucursal?.replace('_',' ')}</span>
                    <span>📡 {c.canal_ingreso}</span>
                    <span>👤 {c.ejecutivo_nombre?.split(" ")[0]}</span>
                    <span>🕐 {c.fecha_recepcion}</span>
                    {hrs > 48 && !['cerrado','rechazado'].includes(c.estado) &&
                      <span style={{color:"#FF3B30", fontWeight:600}}>⛔ {hrs}h</span>}
                  </div>
                </div>
                {c.monto_reclamado > 0 && (
                  <div style={{textAlign:"right", flexShrink:0}}>
                    <div style={{fontSize:13, fontWeight:700, color:"#34C759"}}>
                      {fmt(c.monto_reclamado)}
                    </div>
                    <div style={{fontSize:10, color:"#8E8E93"}}>💸 reclamado</div>
                  </div>
                )}
                {/* Botón eliminar — solo admin, detener propagación */}
                {esAdmin && (
                  <button
                    onClick={e => { e.stopPropagation(); setConfirmDel(c) }}
                    style={{
                      width:28, height:28, borderRadius:8, border:"none",
                      background:"transparent", cursor:"pointer",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:14, color:"#C7C7CC", flexShrink:0,
                      transition:"color 0.15s, background 0.15s"
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color="#FF3B30"; e.currentTarget.style.background="#FF3B3012" }}
                    onMouseLeave={e => { e.currentTarget.style.color="#C7C7CC"; e.currentTarget.style.background="transparent" }}
                    title="Eliminar caso">
                    🗑️
                  </button>
                )}
              </div>
              <AlertaSLA caso={c}/>
            </Cd>
          </div>
        )
      })}

      {/* ── Modal confirmar eliminación ── */}
      {confirmDel && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
          display:"flex", alignItems:"center", justifyContent:"center",
          zIndex:9999, padding:20
        }}>
          <div style={{
            background:"#fff", borderRadius:20, padding:24,
            maxWidth:400, width:"100%", boxShadow:"0 20px 60px rgba(0,0,0,0.3)"
          }}>
            <div style={{fontSize:32, textAlign:"center", marginBottom:8}}>🗑️</div>
            <div style={{fontWeight:800, fontSize:16, textAlign:"center", marginBottom:6}}>
              Eliminar caso
            </div>
            <div style={{fontSize:13, color:"#3C3C43", textAlign:"center", marginBottom:4}}>
              <strong>{confirmDel.numero}</strong>
            </div>
            <div style={{fontSize:12, color:"#8E8E93", textAlign:"center", marginBottom:16}}>
              {confirmDel.cliente_nombre} · {confirmDel.cliente_rut}
            </div>
            <div style={{
              background:"#FF3B3010", border:"1px solid #FF3B3030",
              borderRadius:10, padding:"8px 12px", marginBottom:16, fontSize:12, color:"#FF3B30"
            }}>
              ⚠️ El caso se moverá a la papelera. Puedes restaurarlo desde ahí en cualquier momento. No se borrará permanentemente.
            </div>
            <div style={{display:"flex", gap:8}}>
              <Bt variant="secondary" fw onClick={() => setConfirmDel(null)}>Cancelar</Bt>
              <Bt variant="danger" fw onClick={() => eliminarCaso(confirmDel)}>
                Eliminar caso
              </Bt>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal papelera ── */}
      {verPapelera && (
        <Sheet open wide onClose={() => setVerPapelera(false)} title="🗑️ Papelera de casos">
          <div style={{
            background:"#FF3B3010", border:"1px solid #FF3B3030",
            borderRadius:10, padding:"8px 12px", marginBottom:14, fontSize:12, color:"#FF3B30"
          }}>
            Los casos en la papelera no aparecen en la lista ni en el dashboard. Puedes restaurarlos en cualquier momento.
          </div>

          {loadingEli ? (
            <div style={{color:"#8E8E93", textAlign:"center", padding:20}}>Cargando...</div>
          ) : eliminados.length === 0 ? (
            <div style={{color:"#8E8E93", textAlign:"center", padding:30}}>
              <div style={{fontSize:32, marginBottom:8}}>✅</div>
              La papelera está vacía
            </div>
          ) : eliminados.map(c => {
            const est = ESTADOS[c.estado] || ESTADOS.abierto
            return (
              <div key={c.id} style={{
                display:"flex", alignItems:"center", gap:10,
                padding:"10px 12px", borderRadius:12, marginBottom:6,
                background:"#fff", border:"1px solid #F0F0F0"
              }}>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{display:"flex", gap:6, alignItems:"center", marginBottom:2}}>
                    <span style={{fontWeight:700, fontSize:13}}>{c.numero}</span>
                    <Bd c={est.c} bg={est.bg}>{est.ic} {est.l}</Bd>
                  </div>
                  <div style={{fontSize:12, color:"#3C3C43"}}>{c.cliente_nombre} · {c.cliente_rut}</div>
                  <div style={{fontSize:10, color:"#8E8E93", marginTop:2}}>
                    Eliminado por {c.deleted_by} ·{" "}
                    {c.deleted_at ? new Date(c.deleted_at).toLocaleString('es-CL') : "—"}
                  </div>
                </div>
                <Bt sm variant="secondary" onClick={() => restaurarCaso(c)}>
                  ↩️ Restaurar
                </Bt>
              </div>
            )
          })}
        </Sheet>
      )}
    </div>
  )
}

// ─── FORM 2 — Validación técnica ─────────────────────────────────────────
const Form2Validacion = ({caso, cu, onClose, onGuardado}) => {
  const [saving,      setSaving]      = useState(false)
  const [errs,        setErrs]        = useState({})
  const [foto,        setFoto]        = useState(null)
  const [fotoPreview, setFotoPreview] = useState(null)
  const [uploading,   setUploading]   = useState(false)
  const [prodsSel, setProdsSel] = useState([])  // productos seleccionados (múltiples)

  // Parsear productos desde caso.notas
  // Formato guardado: "Productos en reclamo: NOMBRE (SKU: xxx) — cant. reclamada: N de M | ..."
  const prodsCaso = useMemo(() => {
    if (!caso.notas || !caso.notas.startsWith('Productos en reclamo:')) return []
    const parte = caso.notas.replace('Productos en reclamo: ', '')
    return parte.split(' | ').map(p => {
      // "NOMBRE (SKU: xxx) — cant. reclamada: N de M"
      const matchSku    = p.match(/\(SKU:\s*([^)]+)\)/)
      const matchCants  = p.match(/cant\. reclamada:\s*(\d+)\s*de\s*(\d+)/)
      const nombre      = p.split('(SKU:')[0].trim()
      return {
        nombre,
        sku:          matchSku    ? matchSku[1].trim()          : "",
        cant_reclamo: matchCants  ? parseInt(matchCants[1])     : 1,
        cant_total:   matchCants  ? parseInt(matchCants[2])     : 1,
      }
    }).filter(p => p.nombre)
  }, [caso.notas])

  const [f, setF] = useState({
    producto_sku:        "",
    producto_nombre:     "",
    cantidad:            "1",
    descripcion_problema:"",
    conclusion_tecnica:  "",
    procede_reclamo:     null,
    motivo_rechazo:      "",
  })
  const set = (k, v) => { setF(p => ({...p, [k]:v})); setErrs(p => ({...p, [k]:""})) }

  // Toggle multiselección — agrega con cant_real = cant_reclamo por defecto
  const toggleProd = (prod) => {
    setProdsSel(prev => {
      const existe = prev.find(p => p.sku === prod.sku)
      if (existe) return prev.filter(p => p.sku !== prod.sku)
      return [...prev, { ...prod, cant_real: prod.cant_reclamo }]
    })
  }

  // Actualizar cantidad real recibida por operaciones
  const setCantReal = (sku, val) => {
    setProdsSel(prev => prev.map(p =>
      p.sku === sku ? {...p, cant_real: Math.max(0, Number(val) || 0)} : p
    ))
  }

  const onFotoChange = e => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { alert("La foto no puede superar 10MB"); return }
    setFoto(file)
    setFotoPreview(URL.createObjectURL(file))
  }

  // ── Detectar diferencias de cantidad en tiempo real ──
  const diferencias = useMemo(() =>
    prodsSel.filter(p => p.cant_real !== p.cant_reclamo).map(p => ({
      nombre:       p.nombre,
      sku:          p.sku,
      cant_reclamo: p.cant_reclamo,
      cant_real:    p.cant_real,
      diff:         p.cant_real - p.cant_reclamo,
    }))
  , [prodsSel])

  const validar = () => {
    const e = {}
    if (!f.descripcion_problema.trim()) e.descripcion_problema = "Requerido"
    if (!f.conclusion_tecnica.trim())   e.conclusion_tecnica   = "Requerido"
    if (f.procede_reclamo === null)     e.procede_reclamo      = "Debes indicar si procede o no"
    if (f.procede_reclamo === false && !f.motivo_rechazo.trim())
      e.motivo_rechazo = "Debes indicar el motivo del rechazo"
    if (!foto) e.foto = "La foto del producto es obligatoria"
    return e
  }

  const guardar = async () => {
    // Si hay diferencias de cantidad, confirmar antes de guardar
    if (diferencias.length > 0) {
      const resumen = diferencias.map(d =>
        `• ${d.nombre}: reclamadas ${d.cant_reclamo}, recibidas ${d.cant_real} (${d.diff > 0 ? '+' : ''}${d.diff})`
      ).join('\n')
      const confirmado = window.confirm(
        `⚠️ ATENCIÓN: Diferencia de cantidades detectada\n\n${resumen}\n\n¿Confirmas que los valores recibidos son correctos y deseas continuar?`
      )
      if (!confirmado) return
    }

    const e = validar()
    if (Object.keys(e).length > 0) { setErrs(e); return }
    setSaving(true)

    setUploading(true)
    const ext  = foto.name.split('.').pop()
    const path = `casos/${caso.id}/form2_${Date.now()}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('postventa-fotos').upload(path, foto, { upsert: true })

    if (uploadErr) {
      alert("Error al subir foto: " + uploadErr.message)
      setSaving(false); setUploading(false); return
    }

    const { data: urlData } = supabase.storage
      .from('postventa-fotos').getPublicUrl(path)
    const fotoUrl = urlData?.publicUrl || ""
    setUploading(false)

    const id_form2    = "f2" + Date.now().toString(36)
    // Siempre pasa a resolución — Postventa decide el cierre con el insumo de Operaciones
    const nuevoEstado = f.procede_reclamo ? 'en_resolucion' : 'rechazado'

    // Serializar todos los productos inspeccionados
    const prodsTexto = prodsSel.length > 0
      ? prodsSel.map(p =>
          `${p.nombre} (SKU: ${p.sku}) — reclamadas: ${p.cant_reclamo}, recibidas: ${p.cant_real}`
        ).join(" | ")
      : f.producto_nombre.trim() || null
    const skusTexto = prodsSel.length > 0
      ? prodsSel.map(p => p.sku).join(", ")
      : f.producto_sku.trim() || null

    const { error: formErr } = await supabase
      .from('caso_form2_validacion')
      .upsert({
        id:                   id_form2,
        caso_id:              caso.id,
        producto_sku:         skusTexto,
        producto_nombre:      prodsTexto,
        cantidad:             prodsSel.length > 0
          ? prodsSel.reduce((s,p) => s + p.cant_reclamo, 0)
          : Number(f.cantidad) || 1,
        descripcion_problema: f.descripcion_problema.trim(),
        conclusion_tecnica:   f.conclusion_tecnica.trim(),
        procede_reclamo:      f.procede_reclamo,
        motivo_rechazo:       f.procede_reclamo ? null : f.motivo_rechazo.trim(),
        foto_path:            path,
        foto_url:             fotoUrl,
        validador_id:         cu.id,
        validador_nombre:     cu.nombre,
        fecha_validacion:     new Date().toISOString(),
      }, { onConflict: 'caso_id' })

    if (formErr) { alert("Error al guardar: " + formErr.message); setSaving(false); return }

    await supabase.from('casos_postventa').update({
      estado:       nuevoEstado,
      codigo_final: caso.codigo_provisional || caso.codigo_final,
    }).eq('id', caso.id)

    await supabase.from('caso_eventos').insert({
      caso_id:        caso.id,
      evento:         'form2_completado',
      estado_anterior:'en_validacion_tecnica',
      estado_nuevo:   f.procede_reclamo ? 'en_resolucion' : 'rechazado',
      detalle:        f.procede_reclamo
        ? `Validación técnica por ${cu.nombre} — PROCEDE. Pasa a resolución.`
        : `Validación técnica por ${cu.nombre} — NO PROCEDE según Operaciones. Postventa revisará y decidirá.`,
      payload:        { procede: f.procede_reclamo, conclusion: f.conclusion_tecnica, motivo_rechazo: f.motivo_rechazo },
      usuario_id:     cu.id,
      usuario_nombre: cu.nombre,
      usuario_rol:    cu.rol,
    })

    // ── Email: notificar a postventa que validación completó ──
    getEmailsParaEvento('form2_completado', ['postventa','jefe_tienda','admin','gerencia']).then(dest => {
      if (dest.length) sendEmail('form2_completado', {
        numero:           caso.numero,
        cliente_nombre:   caso.cliente_nombre,
        procede_reclamo:  f.procede_reclamo,
        producto_nombre:  prodsSel.length > 0
          ? prodsSel.map(p=>p.nombre).join(', ')
          : f.producto_nombre,
        conclusion_tecnica: f.conclusion_tecnica,
        motivo_rechazo:   f.motivo_rechazo,
        validador_nombre: cu.nombre,
        caso_id:          caso.id,
      }, dest)
    })

    // ── Email adicional si hay diferencias de cantidad ──
    if (diferencias.length > 0) {
      getEmailsParaEvento('form3_completado', ['postventa','admin','gerencia']).then(dest => {
        if (!dest.length) return
        const resumenDiff = diferencias.map(d =>
          `${d.nombre} (SKU: ${d.sku}): cliente reclamó ${d.cant_reclamo} ud. — operaciones recibió ${d.cant_real} ud. (${d.diff > 0 ? '+' : ''}${d.diff})`
        ).join('\n')
        sendEmail('diferencia_cantidades', {
          numero:          caso.numero,
          cliente_nombre:  caso.cliente_nombre,
          cliente_rut:     caso.cliente_rut,
          validador_nombre:cu.nombre,
          diferencias:     diferencias,
          resumen_diff:    resumenDiff,
          caso_id:         caso.id,
        }, dest)
      })
    }

    setSaving(false)
    onGuardado()
  }

  const puedeEditar  = ['operaciones','jefe_tienda','admin','gerencia'].includes(cu.rol)
  const estadoCorrecto = caso.estado === 'en_validacion_tecnica'

  return (
    <Sheet open wide onClose={onClose} title="🔬 FORM 2 — Validación técnica">

      {!estadoCorrecto && (
        <div style={{background:"#FF950015",border:"1px solid #FF9500",borderRadius:12,
          padding:"12px 14px",marginBottom:14,fontSize:13,color:"#FF9500",fontWeight:600}}>
          ⚠️ Este caso no está en estado "Validación técnica" (estado actual: {ESTADOS[caso.estado]?.l}).
        </div>
      )}
      {!puedeEditar && (
        <div style={{background:"#FF3B3015",border:"1px solid #FF3B30",borderRadius:12,
          padding:"12px 14px",marginBottom:14,fontSize:13,color:"#FF3B30",fontWeight:600}}>
          🔒 Solo Operaciones y Jefe de Tienda pueden completar este formulario.
        </div>
      )}

      {/* Resumen del caso */}
      <div style={{background:"#F2F2F7",borderRadius:12,padding:"10px 14px",marginBottom:12,fontSize:12}}>
        <div style={{fontWeight:700,marginBottom:3}}>{caso.numero} · {caso.cliente_nombre}</div>
        <div style={{color:"#8E8E93"}}>
          {caso.doc_tipo} {caso.doc_numero} · {fmt(caso.doc_monto)} · {caso.motivo_cliente?.slice(0,80)}...
        </div>
      </div>

      <div style={css.divider}/>

      {/* ── PRODUCTOS SELECCIONADOS AL REGISTRO ── */}
      <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>📦 Productos a inspeccionar</div>

      {prodsCaso.length > 0 ? (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11, color:"#8E8E93", marginBottom:8}}>
            Selecciona uno o más productos a inspeccionar:
          </div>
          {prodsCaso.map((prod, i) => {
            const selec = prodsSel.some(p => p.sku === prod.sku)
            return (
              <div key={i}
                onClick={() => puedeEditar && estadoCorrecto && toggleProd(prod)}
                style={{
                  display:"flex", alignItems:"center", gap:10,
                  padding:"10px 12px", borderRadius:12, marginBottom:6,
                  border:`1.5px solid ${selec ? "#007AFF" : "#E5E5EA"}`,
                  background: selec ? "#007AFF08" : "#fff",
                  cursor: puedeEditar && estadoCorrecto ? "pointer" : "default",
                  transition:"all 0.15s"
                }}>
                <div style={{
                  width:20, height:20, borderRadius:6, flexShrink:0,
                  border:`2px solid ${selec ? "#007AFF" : "#C7C7CC"}`,
                  background: selec ? "#007AFF" : "#fff",
                  display:"flex", alignItems:"center", justifyContent:"center"
                }}>
                  {selec && <span style={{color:"#fff",fontSize:11,fontWeight:800}}>✓</span>}
                </div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontWeight:700, fontSize:13, color: selec?"#007AFF":"#1C1C1E"}}>
                    {prod.nombre}
                  </div>
                  <div style={{fontSize:11, color:"#8E8E93", marginTop:1}}>
                    SKU: {prod.sku || "—"}
                  </div>
                </div>
                <div style={{textAlign:"right", flexShrink:0}}>
                  <div style={{fontSize:13, fontWeight:800, color: selec?"#007AFF":"#1C1C1E"}}>
                    {prod.cant_reclamo} ud.
                  </div>
                  <div style={{fontSize:10, color:"#8E8E93"}}>
                    de {prod.cant_total} compradas
                  </div>
                </div>
              </div>
            )
          })}

          {/* Editor de cantidad real por producto seleccionado */}
          {prodsSel.length > 0 && (
            <div style={{
              border:"1px solid #007AFF30", borderRadius:12,
              overflow:"hidden", marginTop:6
            }}>
              {/* Header */}
              <div style={{
                background:"#007AFF10", padding:"8px 14px",
                display:"grid", gridTemplateColumns:"1fr 110px 110px 110px",
                gap:8, fontSize:10, fontWeight:700, color:"#007AFF",
                textTransform:"uppercase", letterSpacing:"0.04em"
              }}>
                <div>Producto</div>
                <div style={{textAlign:"center"}}>Reclamadas</div>
                <div style={{textAlign:"center"}}>Recibidas reales</div>
                <div style={{textAlign:"center"}}>Diferencia</div>
              </div>

              {prodsSel.map(p => {
                const diff     = p.cant_real - p.cant_reclamo
                const igual    = diff === 0
                const menos    = diff < 0
                const diffColor= igual ? "#34C759" : menos ? "#FF3B30" : "#FF9500"
                const diffLabel= igual ? "✅ Coincide" : menos ? `${diff} menos` : `+${diff} más`
                return (
                  <div key={p.sku} style={{
                    display:"grid",
                    gridTemplateColumns:"1fr 110px 110px 110px",
                    gap:8, padding:"10px 14px",
                    borderTop:"1px solid #F2F2F7",
                    alignItems:"center", background:"#fff"
                  }}>
                    <div>
                      <div style={{fontWeight:700, fontSize:12}}>{p.nombre}</div>
                      <div style={{fontSize:10, color:"#8E8E93"}}>SKU: {p.sku||"—"}</div>
                    </div>
                    {/* Reclamadas — fijo */}
                    <div style={{textAlign:"center", fontSize:13, fontWeight:600, color:"#8E8E93"}}>
                      {p.cant_reclamo} ud.
                    </div>
                    {/* Recibidas — editable */}
                    <div style={{display:"flex", alignItems:"center", justifyContent:"center", gap:4}}
                      onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => puedeEditar && estadoCorrecto && setCantReal(p.sku, p.cant_real - 1)}
                        style={{
                          width:24, height:24, borderRadius:6,
                          border:"1px solid #E5E5EA", background:"#F2F2F7",
                          cursor:"pointer", fontSize:14, fontWeight:700,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          color:"#1C1C1E", flexShrink:0
                        }}>−</button>
                      <input
                        type="number" min="0"
                        value={p.cant_real}
                        onChange={e => setCantReal(p.sku, e.target.value)}
                        disabled={!puedeEditar || !estadoCorrecto}
                        style={{
                          width:44, textAlign:"center",
                          padding:"4px 4px", borderRadius:8,
                          border:"1.5px solid #007AFF",
                          fontSize:13, fontWeight:800,
                          color:"#007AFF", fontFamily:FONT,
                          outline:"none"
                        }}/>
                      <button
                        onClick={() => puedeEditar && estadoCorrecto && setCantReal(p.sku, p.cant_real + 1)}
                        style={{
                          width:24, height:24, borderRadius:6,
                          border:"1px solid #E5E5EA", background:"#F2F2F7",
                          cursor:"pointer", fontSize:14, fontWeight:700,
                          display:"flex", alignItems:"center", justifyContent:"center",
                          color:"#1C1C1E", flexShrink:0
                        }}>+</button>
                    </div>
                    {/* Diferencia */}
                    <div style={{textAlign:"center"}}>
                      <Bd c={diffColor} bg={diffColor+"15"}>{diffLabel}</Bd>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* Sin productos precargados — ingreso manual */
        <div style={{marginBottom:14}}>
          <div style={{
            background:"#F2F2F7", borderRadius:10,
            padding:"8px 12px", fontSize:11, color:"#8E8E93", marginBottom:10
          }}>
            Sin productos seleccionados al registro — ingresa los datos manualmente
          </div>
          <div style={css.row}>
            <div style={css.col}>
              <Fl l="SKU / Código producto">
                <input style={css.input} value={f.producto_sku}
                  onChange={e => set('producto_sku', e.target.value)}
                  placeholder="ej: PTA-001"
                  disabled={!puedeEditar || !estadoCorrecto}/>
              </Fl>
            </div>
            <div style={{...css.col, flex:2}}>
              <Fl l="Nombre del producto">
                <input style={css.input} value={f.producto_nombre}
                  onChange={e => set('producto_nombre', e.target.value)}
                  placeholder="ej: Puerta interior PVC 80x200cm"
                  disabled={!puedeEditar || !estadoCorrecto}/>
              </Fl>
            </div>
            <div style={{flex:"0 0 100px"}}>
              <Fl l="Cantidad">
                <input style={css.input} type="number" min="1" value={f.cantidad}
                  onChange={e => set('cantidad', e.target.value)}
                  disabled={!puedeEditar || !estadoCorrecto}/>
              </Fl>
            </div>
          </div>
        </div>
      )}

      {/* ── ALERTA DIFERENCIA DE CANTIDADES ── */}
      {diferencias.length > 0 && (
        <div style={{
          background:"#FF3B3010",
          border:"1.5px solid #FF3B30",
          borderRadius:14, padding:"14px 16px", marginBottom:12
        }}>
          <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:10}}>
            <span style={{fontSize:22}}>⚠️</span>
            <div>
              <div style={{fontWeight:800, fontSize:14, color:"#FF3B30"}}>
                Diferencia de cantidades detectada
              </div>
              <div style={{fontSize:12, color:"#8E8E93", marginTop:1}}>
                Las cantidades recibidas no coinciden con las reclamadas por el cliente.
                Verifica antes de guardar.
              </div>
            </div>
          </div>

          {diferencias.map((d, i) => (
            <div key={i} style={{
              background:"#fff", borderRadius:10, padding:"10px 12px",
              marginBottom: i < diferencias.length-1 ? 6 : 0,
              border:"1px solid #FF3B3020"
            }}>
              <div style={{fontWeight:700, fontSize:13, marginBottom:6}}>{d.nombre}</div>
              <div style={{display:"flex", gap:12, alignItems:"center"}}>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:9, color:"#8E8E93", textTransform:"uppercase",
                    fontWeight:700, marginBottom:2}}>Cliente reclamó</div>
                  <div style={{fontSize:18, fontWeight:800, color:"#1C1C1E"}}>{d.cant_reclamo}</div>
                </div>
                <div style={{
                  fontSize:18, color:"#E5E5EA", fontWeight:300
                }}>→</div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:9, color:"#8E8E93", textTransform:"uppercase",
                    fontWeight:700, marginBottom:2}}>Operaciones recibió</div>
                  <div style={{fontSize:18, fontWeight:800, color:"#FF3B30"}}>{d.cant_real}</div>
                </div>
                <div style={{
                  marginLeft:"auto",
                  background: d.diff < 0 ? "#FF3B3015" : "#FF950015",
                  border:`1px solid ${d.diff < 0 ? "#FF3B30" : "#FF9500"}`,
                  borderRadius:8, padding:"6px 12px", textAlign:"center"
                }}>
                  <div style={{
                    fontSize:16, fontWeight:800,
                    color: d.diff < 0 ? "#FF3B30" : "#FF9500"
                  }}>
                    {d.diff > 0 ? '+' : ''}{d.diff} ud.
                  </div>
                  <div style={{fontSize:10, color:"#8E8E93"}}>
                    {d.diff < 0 ? 'Menos de lo reclamado' : 'Más de lo reclamado'}
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div style={{
            marginTop:10, fontSize:11, color:"#FF3B30", fontWeight:600,
            display:"flex", gap:6, alignItems:"center"
          }}>
            <span>📧</span>
            Al guardar se enviará una alerta automática a Postventa con este detalle.
          </div>
        </div>
      )}

      {/* Inspección */}
      <div style={css.divider}/>
      <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>🔍 Inspección técnica</div>

      <Fl l="Descripción del problema observado" req err={errs.descripcion_problema}>
        <textarea style={css.textarea} value={f.descripcion_problema}
          onChange={e => set('descripcion_problema', e.target.value)}
          placeholder="Describe detalladamente lo que observaste al inspeccionar el producto: dimensiones, daños visibles, funcionamiento, etc."
          disabled={!puedeEditar || !estadoCorrecto}/>
      </Fl>

      <Fl l="Conclusión técnica" req err={errs.conclusion_tecnica}>
        <textarea style={css.textarea} value={f.conclusion_tecnica}
          onChange={e => set('conclusion_tecnica', e.target.value)}
          placeholder="Conclusión objetiva: ej. 'La puerta presenta daño en el marco inferior consistente con golpe en transporte, no atribuible al cliente.'"
          disabled={!puedeEditar || !estadoCorrecto}/>
      </Fl>

      {/* Foto obligatoria */}
      <Fl l="📷 Foto del producto (obligatoria)" req err={errs.foto}>
        {fotoPreview ? (
          <div style={{position:"relative", display:"inline-block"}}>
            <img src={fotoPreview} alt="Preview"
              style={{maxWidth:"100%", maxHeight:280, borderRadius:12, border:"2px solid #34C759"}}/>
            {(puedeEditar && estadoCorrecto) && (
              <button onClick={() => { setFoto(null); setFotoPreview(null) }}
                style={{
                  position:"absolute", top:8, right:8,
                  background:"rgba(0,0,0,0.6)", border:"none", borderRadius:"50%",
                  width:28, height:28, color:"#fff", cursor:"pointer", fontSize:14
                }}>✕</button>
            )}
          </div>
        ) : (
          <label style={{
            display:"flex", flexDirection:"column", alignItems:"center",
            justifyContent:"center", gap:8, padding:"24px",
            border:`2px dashed ${errs.foto ? "#FF3B30" : "#E5E5EA"}`,
            borderRadius:12, cursor: puedeEditar && estadoCorrecto ? "pointer" : "default",
            background: errs.foto ? "#FF3B3008" : "#FAFAFA"
          }}>
            <span style={{fontSize:32}}>📷</span>
            <span style={{fontSize:13, color:"#8E8E93", fontWeight:500}}>
              {puedeEditar && estadoCorrecto
                ? "Toca para subir foto del producto"
                : "Sin foto adjunta"}
            </span>
            <span style={{fontSize:11, color:"#AEAEB2"}}>JPG, PNG o HEIC · máx 10MB</span>
            {puedeEditar && estadoCorrecto && (
              <input type="file" accept="image/*" style={{display:"none"}}
                onChange={onFotoChange}/>
            )}
          </label>
        )}
      </Fl>

      <div style={css.divider}/>

      {/* Veredicto */}
      <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>⚖️ Veredicto</div>
      {errs.procede_reclamo && (
        <div style={{color:"#FF3B30", fontSize:12, marginBottom:8}}>⚠️ {errs.procede_reclamo}</div>
      )}

      <div style={{display:"flex", gap:10, marginBottom:14}}>
        {[
          {v:true,  l:"✅ PROCEDE el reclamo",      desc:"El caso es válido. Pasa a resolución por Postventa.", c:"#34C759"},
          {v:false, l:"⚠️ NO procede según Operaciones", desc:"Postventa revisa el argumento técnico y toma la decisión final de cierre.", c:"#FF9500"},
        ].map(op => (
          <div key={String(op.v)}
            onClick={() => puedeEditar && estadoCorrecto && set('procede_reclamo', op.v)}
            style={{
              flex:1, borderRadius:14, padding:"14px",
              border:`2px solid ${f.procede_reclamo === op.v ? op.c : "#E5E5EA"}`,
              background: f.procede_reclamo === op.v ? op.c+"12" : "#FAFAFA",
              cursor: puedeEditar && estadoCorrecto ? "pointer" : "default",
              transition:"all 0.15s"
            }}>
            <div style={{fontWeight:700, fontSize:13, color: f.procede_reclamo === op.v ? op.c : "#3C3C43"}}>
              {op.l}
            </div>
            <div style={{fontSize:11, color:"#8E8E93", marginTop:4}}>{op.desc}</div>
          </div>
        ))}
      </div>

      {f.procede_reclamo === false && (
        <Fl l="Argumento técnico de Operaciones (insumo para Postventa)" req err={errs.motivo_rechazo}>
          <textarea style={css.textarea} value={f.motivo_rechazo}
            onChange={e => set('motivo_rechazo', e.target.value)}
            placeholder="ej: El producto fue instalado y presenta daños por uso inadecuado, no corresponde a falla de fábrica. Postventa evaluará si aplica excepción comercial."
            disabled={!puedeEditar || !estadoCorrecto}/>
          <div style={{fontSize:10, color:"#FF9500", marginTop:4}}>
            ⚠️ Este argumento quedará visible para Postventa al momento de resolver el caso.
          </div>
        </Fl>
      )}

      {/* Acciones */}
      {puedeEditar && estadoCorrecto && (
        <div style={{display:"flex", gap:10, marginTop:8}}>
          <Bt variant="secondary" fw onClick={onClose}>Cancelar</Bt>
          <Bt fw
            loading={saving || uploading}
            variant={f.procede_reclamo === false ? "warning" : "success"}
            onClick={guardar}>
            {uploading ? "Subiendo foto..." :
             f.procede_reclamo === true  ? "✅ Guardar — Procede a resolución" :
             f.procede_reclamo === false ? "⚠️ Guardar — Enviar a revisión Postventa" :
             "Guardar validación"}
          </Bt>
        </div>
      )}
      {(!puedeEditar || !estadoCorrecto) && (
        <Bt variant="secondary" fw onClick={onClose}>Cerrar</Bt>
      )}
    </Sheet>
  )
}

// ─── DETALLE CASO ─────────────────────────────────────────────────────────
const DetalleCaso = ({caso, cu, codigos, onClose, onRefresh}) => {
  if (!caso) return null

  const [form2Data,   setForm2Data]   = useState(null)
  const [form3Data,   setForm3Data]   = useState(null)
  const [showCambioTipo, setShowCambioTipo] = useState(false)
  const [cambioTipoLoading, setCambioTipoLoading] = useState(false)
  const [cambioTipoDatos, setCambioTipoDatos] = useState({ banco:'', tipo_cuenta:'Cuenta Corriente', num_cuenta:'', nombre_titular:'' })
  const [form4Data,   setForm4Data]   = useState(null)
  const [eventos,     setEventos]     = useState([])
  const [loadingF2,   setLoadingF2]   = useState(false)
  const [showForm2,   setShowForm2]   = useState(false)
  const [showForm3,   setShowForm3]   = useState(false)
  const [showForm4T,  setShowForm4T]  = useState(false)  // transferencia
  const [showForm4E,  setShowForm4E]  = useState(false)  // escalamiento
  const [casoActual,  setCasoActual]  = useState(caso)

  const est       = ESTADOS[casoActual.estado] || ESTADOS.abierto
  const blq       = casoActual.codigo_final?.slice(0,2) || 'S/C'
  const cl        = CL[BLOQUE_CL[blq] || 'D']
  const codigoInfo= codigos.find(c => c.codigo === casoActual.codigo_final || c.codigo === casoActual.codigo_provisional)

  const puedeForm2 = ['operaciones','jefe_tienda','admin','gerencia'].includes(cu.rol)

  // ── Stepper dinámico según estado del caso ──
  const getSteps = () => {
    const est = casoActual.estado
    const tieneF2 = casoActual.requiere_form2

    if (est === 'escalado') {
      return {
        steps: ["Recepción", tieneF2?"Validación":"Resolución", "Escalamiento", "Cierre"],
        current: 2,
        estados: ["abierto", tieneF2?"en_validacion_tecnica":"en_resolucion", "escalado", "cerrado"]
      }
    }
    if (est === 'transfer_pendiente') {
      return {
        steps: ["Recepción", tieneF2?"Validación":"Resolución", "Finanzas", "Cierre"],
        current: 2,
        estados: []
      }
    }
    if (form3Data?.tipo_resolucion === 'nc_transfer' && form4Data?.transfer_ejecutada) {
      return {
        steps: ["Recepción", tieneF2?"Validación":"Resolución", "Finanzas", "Cierre"],
        current: 3,
        estados: ["abierto", "en_resolucion", "cerrado", "cerrado"]
      }
    }

    // Flujo estándar
    const steps = ["Recepción"]
    const mapped = [0]
    if (tieneF2) { steps.push("Validación técnica"); mapped.push(1) }
    steps.push("Resolución"); mapped.push(tieneF2?2:1)
    steps.push("Cierre");     mapped.push(tieneF2?3:2)

    const idx = {
      abierto:               0,
      en_validacion_tecnica: tieneF2 ? 1 : 0,
      en_resolucion:         tieneF2 ? 2 : 1,
      cerrado:               tieneF2 ? 3 : 2,
      rechazado:             tieneF2 ? 3 : 2,
    }[est] ?? 0

    return {steps, current: idx, estados: []}
  }

  const {steps: STEPS, current: stepIdx} = getSteps()

  // Cargar todos los datos del caso en paralelo
  useEffect(() => {
    setLoadingF2(true)
    Promise.all([
      supabase.from('caso_form2_validacion').select('*').eq('caso_id', casoActual.id).maybeSingle(),
      supabase.from('caso_form3_resolucion').select('*').eq('caso_id', casoActual.id).maybeSingle(),
      supabase.from('caso_form4_cierre').select('*').eq('caso_id', casoActual.id).maybeSingle(),
      supabase.from('caso_eventos').select('*').eq('caso_id', casoActual.id).order('created_at', {ascending: true}),
    ]).then(([{data: f2}, {data: f3}, {data: f4}, {data: evs}]) => {
      setForm2Data(f2)
      setForm3Data(f3)
      setForm4Data(f4)
      setEventos(evs || [])
      setLoadingF2(false)
    })
  }, [casoActual.id])

  const recargarCaso = async () => {
    const [{data}, {data: f2}, {data: f3}, {data: f4}, {data: evs}] = await Promise.all([
      supabase.from('casos_postventa').select('*').eq('id', casoActual.id).single(),
      supabase.from('caso_form2_validacion').select('*').eq('caso_id', casoActual.id).maybeSingle(),
      supabase.from('caso_form3_resolucion').select('*').eq('caso_id', casoActual.id).maybeSingle(),
      supabase.from('caso_form4_cierre').select('*').eq('caso_id', casoActual.id).maybeSingle(),
      supabase.from('caso_eventos').select('*').eq('caso_id', casoActual.id).order('created_at', {ascending: true}),
    ])
    if (data) setCasoActual(data)
    setForm2Data(f2)
    setForm3Data(f3)
    setForm4Data(f4)
    setEventos(evs || [])
    onRefresh()
  }

  const onForm2Guardado = async () => {
    setShowForm2(false)
    await recargarCaso()
  }

  const onForm3Guardado = async () => {
    setShowForm3(false)
    await recargarCaso()
  }

  const ejecutarCambioTipo = async (nuevoTipo, datosBancarios) => {
    if (!casoActual || !form3Data) return
    setCambioTipoLoading(true)
    try {
      const tipoAnterior = form3Data.tipo_resolucion
      const update = {
        tipo_resolucion: nuevoTipo,
        banco:          nuevoTipo === 'nc_abono' ? null : (datosBancarios?.banco || form3Data.banco),
        tipo_cuenta:    nuevoTipo === 'nc_abono' ? null : (datosBancarios?.tipo_cuenta || form3Data.tipo_cuenta),
        num_cuenta:     nuevoTipo === 'nc_abono' ? null : (datosBancarios?.num_cuenta || form3Data.num_cuenta),
        nombre_titular: nuevoTipo === 'nc_abono' ? null : (datosBancarios?.nombre_titular || form3Data.nombre_titular),
      }
      await supabase.from('caso_form3_resolucion').update(update).eq('caso_id', casoActual.id)
      await supabase.from('caso_eventos').insert({
        caso_id: casoActual.id,
        usuario_id: cu.id,
        usuario_nombre: cu.nombre,
        usuario_rol: cu.rol,
        evento: 'cambio_tipo_resolucion',
        payload: {
          tipo_anterior: tipoAnterior,
          tipo_nuevo: nuevoTipo,
          motivo: 'Cambio solicitado por cliente',
          datos_anteriores: { banco: form3Data.banco, tipo_cuenta: form3Data.tipo_cuenta, num_cuenta: form3Data.num_cuenta, nombre_titular: form3Data.nombre_titular }
        }
      })
      setForm3Data(p => ({ ...p, ...update }))
      setShowCambioTipo(false)
      setCambioTipoDatos({ banco:'', tipo_cuenta:'Cuenta Corriente', num_cuenta:'', nombre_titular:'' })
    } catch(e) { console.error('Error cambiando tipo:', e) }
    setCambioTipoLoading(false)
  }

  return (
    <>
    <Sheet open wide onClose={onClose} title={null}>

      {/* ── Header ── */}
      <div style={{
        background:"linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        borderRadius:16, padding:"16px 18px", marginBottom:14, color:"#fff"
      }}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10}}>
          <div>
            <div style={{fontSize:20, fontWeight:800, letterSpacing:"-0.02em"}}>{casoActual.numero||casoActual.id}</div>
            <div style={{color:"rgba(255,255,255,0.5)", fontSize:12, marginTop:2}}>
              {casoActual.fecha_recepcion} · {casoActual.sucursal?.replace(/_/g,' ')} · {casoActual.canal_ingreso}
            </div>
          </div>
          <Bd c={est.c} bg={est.c+"30"} lg>{est.ic} {est.l}</Bd>
        </div>
        {casoActual.es_critico && (
          <div style={{marginTop:8, background:"rgba(255,59,48,0.2)", borderRadius:8,
            padding:"5px 10px", fontSize:12, color:"#FF6B6B", fontWeight:600}}>
            🔴 Caso crítico — requiere escalamiento inmediato
          </div>
        )}
      </div>

      {/* ── Timeline ── */}
      <Stp steps={STEPS} current={stepIdx}
        alertIdx={
          casoActual.estado === 'escalado'           ? stepIdx :
          casoActual.estado === 'transfer_pendiente' ? stepIdx :
          undefined
        }
      />
      <AlertaSLA caso={casoActual}/>
      <div style={css.divider}/>

      {/* ── FORM 2 CTA o resultado ── */}
      {(casoActual.requiere_form2 || casoActual.estado === 'en_validacion_tecnica') && (
        <div style={{marginBottom:14}}>
          {loadingF2 ? (
            <div style={{color:"#8E8E93", fontSize:13}}>Cargando validación técnica...</div>
          ) : form2Data ? (
            /* Validación ya completada — mostrar resultado */
            <div style={{
              borderRadius:14, padding:"14px 16px",
              background: form2Data.procede_reclamo ? "#34C75912" : "#FF3B3012",
              border:`1.5px solid ${form2Data.procede_reclamo ? "#34C75940" : "#FF3B3040"}`
            }}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
                <div style={{fontWeight:700, fontSize:14}}>🔬 Validación técnica</div>
                <Bd c={form2Data.procede_reclamo?"#34C759":"#FF3B30"}
                   bg={form2Data.procede_reclamo?"#34C75920":"#FF3B3020"} lg>
                  {form2Data.procede_reclamo ? "✅ Procede" : "❌ No procede"}
                </Bd>
              </div>
              {form2Data.producto_nombre && (
                <div style={{fontSize:12, color:"#8E8E93", marginBottom:6}}>
                  📦 {form2Data.producto_nombre} {form2Data.producto_sku && `(${form2Data.producto_sku})`}
                </div>
              )}
              <div style={{fontSize:13, marginBottom:6}}>
                <span style={{fontWeight:600}}>Problema: </span>{form2Data.descripcion_problema}
              </div>
              <div style={{fontSize:13, marginBottom:6}}>
                <span style={{fontWeight:600}}>Conclusión: </span>{form2Data.conclusion_tecnica}
              </div>
              {!form2Data.procede_reclamo && form2Data.motivo_rechazo && (
                <div style={{fontSize:13, color:"#FF3B30", marginBottom:6}}>
                  <span style={{fontWeight:600}}>Motivo rechazo: </span>{form2Data.motivo_rechazo}
                </div>
              )}
              {form2Data.foto_url && (
                <div style={{marginTop:8}}>
                  <div style={{fontSize:11, color:"#8E8E93", marginBottom:4}}>📷 Foto del producto:</div>
                  <img src={form2Data.foto_url} alt="Producto"
                    style={{maxWidth:"100%", maxHeight:200, borderRadius:10, objectFit:"cover"}}/>
                </div>
              )}
              <div style={{fontSize:11, color:"#8E8E93", marginTop:8}}>
                Validado por {form2Data.validador_nombre} ·{" "}
                {form2Data.fecha_validacion
                  ? new Date(form2Data.fecha_validacion).toLocaleDateString('es-CL')
                  : "—"}
              </div>
            </div>
          ) : (
            /* Pendiente de validación */
            <div style={{
              borderRadius:14, padding:"14px 16px",
              background:"#AF52DE12", border:"1.5px solid #AF52DE40"
            }}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700, fontSize:14, color:"#AF52DE"}}>🔬 Validación técnica pendiente</div>
                  <div style={{fontSize:12, color:"#8E8E93", marginTop:3}}>
                    Este caso requiere inspección física del producto antes de continuar.
                  </div>
                </div>
                {puedeForm2 && casoActual.estado === 'en_validacion_tecnica' && (
                  <Bt variant="primary" sm onClick={() => setShowForm2(true)}>
                    Completar FORM 2
                  </Bt>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Datos del cliente ── */}
      <div style={{fontWeight:700, fontSize:13, marginBottom:8}}>👤 Cliente</div>
      <div style={{display:"flex", gap:14, flexWrap:"wrap", marginBottom:14}}>
        {[
          {l:"Nombre",  v:casoActual.cliente_nombre},
          {l:"RUT",     v:casoActual.cliente_rut},
          {l:"Teléfono",v:casoActual.cliente_telefono||"—"},
          {l:"Email",   v:casoActual.cliente_email||"—"},
          {l:"Tipo",    v:casoActual.cliente_tipo==='b2b'?'🏢 B2B':'👤 Persona'},
        ].map(d => (
          <div key={d.l} style={{flex:"1 1 120px"}}>
            <div style={css.label}>{d.l}</div>
            <div style={css.val}>{d.v}</div>
          </div>
        ))}
      </div>
      <div style={css.divider}/>

      {/* ── Documento ── */}
      <div style={{fontWeight:700, fontSize:13, marginBottom:8}}>🧾 Documento original</div>
      <div style={{display:"flex", gap:14, flexWrap:"wrap", marginBottom:14}}>
        {[
          {l:"Tipo",   v:casoActual.doc_tipo},
          {l:"Número", v:casoActual.doc_numero},
          {l:"Fecha",  v:casoActual.doc_fecha},
          {l:"Monto",  v:fmt(casoActual.doc_monto), bold:true},
        ].map(d => (
          <div key={d.l} style={{flex:"1 1 110px"}}>
            <div style={css.label}>{d.l}</div>
            <div style={{...css.val, fontWeight: d.bold?700:500}}>{d.v}</div>
          </div>
        ))}
      </div>
      <div style={css.divider}/>

      {/* ── Clasificación ── */}
      <div style={{fontWeight:700, fontSize:13, marginBottom:8}}>🏷️ Clasificación</div>
      <div style={{display:"flex", gap:8, flexWrap:"wrap", marginBottom:8}}>
        {casoActual.codigo_provisional &&
          <div><div style={css.label}>Provisional</div>
            <Bd c="#8E8E93" bg="#8E8E9315" lg>{casoActual.codigo_provisional}</Bd></div>}
        {casoActual.codigo_final &&
          <div><div style={css.label}>Final</div>
            <Bd c={cl.c} bg={cl.bg} lg>{casoActual.codigo_final}</Bd></div>}
      </div>
      {codigoInfo && (
        <div style={{...css.cardSm, marginBottom:14, borderLeft:`3px solid ${cl.c}`}}>
          <div style={{fontSize:13, fontWeight:600}}>{codigoInfo.descripcion}</div>
          <div style={{fontSize:11, color:"#8E8E93", marginTop:3}}>
            Bloque {codigoInfo.bloque} · Responsable: {codigoInfo.responsable} · Resolución típica: {codigoInfo.resolucion_tipica}
          </div>
        </div>
      )}

      {/* ── Motivo ── */}
      <div style={{marginBottom:14}}>
        <div style={css.label}>Motivo del cliente</div>
        <div style={{...css.cardSm, marginTop:4, fontSize:13, color:"#3C3C43",
          borderLeft:"3px solid #007AFF", fontStyle:"italic"}}>
          "{casoActual.motivo_cliente}"
        </div>
      </div>

      {/* ── FORM 3: Resolución ── */}
      {(casoActual.estado === 'en_resolucion' ||
        (casoActual.estado === 'abierto' && !casoActual.requiere_form2)) && (
        <div style={{marginBottom:14}}>
          <div style={css.divider}/>
          {/* Si hay form3 pero era un escalamiento anterior devuelto → permitir nueva resolución */}
          {form3Data && form3Data.tipo_resolucion !== 'escalar' ? (
            /* Resolución ya registrada (no escalamiento) */
            <div style={{
              borderRadius:14, padding:"14px 16px",
              background:"#34C75912", border:"1.5px solid #34C75940"
            }}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
                <div style={{fontWeight:700, fontSize:14}}>🧾 Resolución registrada</div>
                <Bd c="#34C759" bg="#34C75920" lg>
                  {{cambio:'🔄 Cambio', nc_abono:'💳 NC Abono',
                    nc_transfer:'🏦 NC Transferencia', escalar:'🔺 Escalado'}[form3Data.tipo_resolucion] || form3Data.tipo_resolucion}
                </Bd>
              </div>
              {form3Data.bsale_doc_numero && (
                <div style={{fontSize:13, marginBottom:4}}>
                  <span style={{fontWeight:600}}>Doc. BSALE: </span>N°{form3Data.bsale_doc_numero}
                </div>
              )}
              {form3Data.monto > 0 && (
                <div style={{fontSize:13, marginBottom:4}}>
                  <span style={{fontWeight:600}}>Monto: </span>{fmt(form3Data.monto)}
                </div>
              )}
              {form3Data.tipo_resolucion === 'nc_transfer' && form3Data.banco && (
                <div style={{fontSize:12, color:"#8E8E93"}}>
                  {form3Data.banco} · {form3Data.tipo_cuenta} · {form3Data.num_cuenta} · {form3Data.nombre_titular}
                </div>
              )}
              {/* Botón cambio tipo — solo admin/jefe_tienda en casos transfer_pendiente */}
              {casoActual.estado === 'transfer_pendiente' && ['admin','jefe_tienda','gerencia'].includes(cu.rol) && (
                <div style={{marginTop:10}}>
                  <button onClick={() => { setShowCambioTipo(true); setCambioTipoDatos({ banco:'', tipo_cuenta:'Cuenta Corriente', num_cuenta:'', nombre_titular:'' }) }} style={{
                    padding:'6px 14px', borderRadius:8, border:'1px solid #FF9500',
                    background:'#FF950012', color:'#FF9500', fontSize:12, fontWeight:600, cursor:'pointer'
                  }}>
                    🔄 Cambiar método de pago
                  </button>
                </div>
              )}
              <div style={{fontSize:11, color:"#8E8E93", marginTop:6}}>
                Registrado por {form3Data.resuelto_por_nombre} ·{" "}
                {form3Data.fecha_resolucion
                  ? new Date(form3Data.fecha_resolucion).toLocaleDateString('es-CL') : "—"}
              </div>
            </div>
          ) : (
            /* Pendiente de resolución — también aplica si form3 anterior era escalamiento devuelto */
            <div style={{
              borderRadius:14, padding:"14px 16px",
              background:"#007AFF10", border:"1.5px solid #007AFF40"
            }}>
              {form3Data?.tipo_resolucion === 'escalar' && (
                <div style={{
                  background:"#FF950012", border:"1px solid #FF950040",
                  borderRadius:10, padding:"8px 12px", marginBottom:10,
                  fontSize:12, color:"#FF9500"
                }}>
                  ↩️ Caso devuelto desde escalamiento — registra una nueva resolución
                </div>
              )}
              {/* Aviso cuando Operaciones dijo NO PROCEDE */}
              {form2Data && !form2Data.procede_reclamo && (
                <div style={{
                  background:"#FF950012", border:"1px solid #FF950040",
                  borderRadius:10, padding:"10px 12px", marginBottom:10
                }}>
                  <div style={{fontSize:12, fontWeight:700, color:"#FF9500", marginBottom:4}}>
                    ⚠️ Operaciones determinó que el reclamo NO procede técnicamente
                  </div>
                  {form2Data.motivo_rechazo && (
                    <div style={{fontSize:12, color:"#3C3C43", fontStyle:"italic", marginBottom:4}}>
                      "{form2Data.motivo_rechazo}"
                    </div>
                  )}
                  <div style={{fontSize:11, color:"#8E8E93"}}>
                    Postventa debe evaluar este argumento y tomar la decisión final:
                    rechazar, compensar comercialmente o escalar.
                  </div>
                </div>
              )}
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700, fontSize:14, color:"#007AFF"}}>🧾 Resolución pendiente</div>
                  <div style={{fontSize:12, color:"#8E8E93", marginTop:3}}>
                    {form3Data?.tipo_resolucion === 'escalar'
                      ? "Jefatura devolvió el caso. Registra la resolución final."
                      : casoActual.requiere_form2
                      ? "Validación técnica aprobada. Postventa debe decidir la resolución."
                      : "Caso sin validación técnica. Postventa decide la resolución directamente."
                    }
                  </div>
                </div>
                {['admin','postventa','jefe_tienda','gerencia'].includes(cu.rol) && (
                  <Bt variant="primary" sm onClick={() => setShowForm3(true)}>
                    Resolver caso
                  </Bt>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── FORM 4A: Transferencia pendiente (Caja) ── */}
      {(() => {
        // Aplica si: el form3 actual es nc_transfer (directo o via escalamiento aprobado)
        const esTransfer = form3Data?.tipo_resolucion === 'nc_transfer'
        // transfer_ejecutada no existe en schema actual — se infiere del estado
        const yaEjecutada = casoActual.estado === "cerrado" && form4Data != null
        if (!esTransfer) return null
        if (!['cerrado','transfer_pendiente','en_resolucion'].includes(casoActual.estado)) return null
        return (
          <div style={{marginBottom:14}}>
            <div style={css.divider}/>
            {yaEjecutada ? (
              <div style={{borderRadius:14,padding:"12px 16px",
                background:"#34C75908",border:"1px solid #34C75930"}}>
                <div style={{fontWeight:700,fontSize:13,color:"#34C759",marginBottom:6}}>
                  ✅ Transferencia ejecutada
                </div>
                <div style={{fontSize:12,color:"#3C3C43"}}>
                  N° operación: <strong>{form4Data.transfer_comprobante}</strong> ·
                  Fecha: {form4Data.transfer_fecha
                    ? new Date(form4Data.transfer_fecha).toLocaleDateString('es-CL') : "—"} ·
                  Ejecutado por: {form4Data.transfer_ejecutado_nombre}
                </div>
              </div>
            ) : (
              <div style={{borderRadius:14,padding:"14px 16px",
                background:"#34C75912",border:"1.5px solid #34C75940"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:14,color:"#34C759"}}>💸 Transferencia pendiente de ejecución</div>
                    <div style={{fontSize:12,color:"#8E8E93",marginTop:3}}>
                      NC N°{form3Data.bsale_doc_numero} · {fmt(form3Data.monto)} · {form3Data.nombre_titular}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    {['admin','jefe_tienda','gerencia'].includes(cu.rol) && (
                      <button onClick={() => { setShowCambioTipo(true); setCambioTipoDatos({ banco:'', tipo_cuenta:'Cuenta Corriente', num_cuenta:'', nombre_titular:'' }) }} style={{
                        padding:'6px 12px', borderRadius:8, border:'1px solid var(--warning)',
                        background:'var(--warning-bg)', color:'var(--warning)', fontSize:12, fontWeight:600, cursor:'pointer'
                      }}>🔄 Cambiar método</button>
                    )}
                    {['caja','admin','gerencia'].includes(cu.rol) && (
                      <Bt variant="success" sm onClick={() => setShowForm4T(true)}>
                        Confirmar transferencia
                      </Bt>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── FORM 4B: Resolución de escalamiento (Jefatura) ── */}
      {casoActual.estado === 'escalado' && (
        <div style={{marginBottom:14}}>
          <div style={css.divider}/>
          {form4Data ? (
            <div style={{
              borderRadius:14, padding:"12px 16px",
              background:"#F2F2F7", border:"1px solid #E5E5EA"
            }}>
              <div style={{fontWeight:700, fontSize:13, marginBottom:4}}>📋 Decisión de jefatura registrada</div>
              <div style={{fontSize:12, color:"#3C3C43"}}>
                {form4Data.observaciones_finales}
              </div>
              <div style={{fontSize:11, color:"#8E8E93", marginTop:4}}>
                Por {form4Data.cerrado_por_nombre} ·{" "}
                {new Date(form4Data.fecha_cierre).toLocaleDateString('es-CL')}
              </div>
            </div>
          ) : (
            <div style={{
              borderRadius:14, padding:"14px 16px",
              background:"#FF950012", border:"1.5px solid #FF950040"
            }}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:700, fontSize:14, color:"#FF9500"}}>
                    🔺 Pendiente resolución de jefatura
                  </div>
                  <div style={{fontSize:12, color:"#8E8E93", marginTop:3}}>
                    Escalado a {casoActual.escalado_a === 'jefe_tienda' ? 'Jefe de Tienda' : 'Gerencia'}.
                    {form3Data?.escalar_motivo && ` Motivo: ${form3Data.escalar_motivo}`}
                  </div>
                </div>
                {(cu.rol === 'admin' || cu.rol === 'gerencia' ||
                  (cu.rol === 'jefe_tienda' && casoActual.escalado_a === 'jefe_tienda')) && (
                  <Bt variant="warning" sm onClick={() => setShowForm4E(true)}>
                    Resolver escalamiento
                  </Bt>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ BITÁCORA COMPLETA ══════════════════════════════════════════ */}
      <div style={{marginBottom:14}}>
        <div style={css.divider}/>
        <div style={{fontWeight:700, fontSize:14, marginBottom:16, display:"flex", gap:8, alignItems:"center"}}>
          📋 Bitácora completa
          <span style={{fontSize:11, color:"#8E8E93", fontWeight:400}}>
            {eventos.length} evento{eventos.length!==1?'s':''}
          </span>
        </div>

        {/* ── BLOQUE 0: Documento y vendedor de origen ── */}
        <div style={{display:"flex", gap:0, marginBottom:0, position:"relative"}}>
          <div style={{
            display:"flex", flexDirection:"column", alignItems:"center",
            width:32, flexShrink:0, marginRight:12
          }}>
            <div style={{
              width:32, height:32, borderRadius:"50%",
              background:"#1C1C1E", border:"2px solid #1C1C1E",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:14, zIndex:1, color:"#fff"
            }}>🧾</div>
            <div style={{width:2, flex:1, minHeight:20, background:"#E5E5EA", marginTop:4}}/>
          </div>
          <div style={{
            flex:1, background:"#1C1C1E", borderRadius:14,
            padding:"14px 16px", marginBottom:12, color:"#fff"
          }}>
            <div style={{fontSize:11, color:"rgba(255,255,255,0.5)",
              fontWeight:700, textTransform:"uppercase",
              letterSpacing:"0.05em", marginBottom:10}}>
              Documento de origen · Compra del cliente
            </div>
            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:10}}>
              {[
                {l:"Tipo",          v:(casoActual.doc_tipo||'—').toUpperCase()},
                {l:"N° documento",  v: casoActual.doc_numero || '—'},
                {l:"Fecha",         v: casoActual.doc_fecha  || '—'},
                {l:"Monto documento",v: fmt(casoActual.doc_monto || 0), highlight:"orange"},
                {l:"Canal",         v: casoActual.canal_ingreso || '—'},
                {l:"Sucursal",      v: (casoActual.sucursal||'—').replace(/_/g,' ')},
              ].map(d => (
                <div key={d.l}>
                  <div style={{fontSize:9, color:"rgba(255,255,255,0.4)",
                    fontWeight:700, textTransform:"uppercase", marginBottom:2}}>{d.l}</div>
                  <div style={{
                    fontSize: d.highlight ? 15 : 13,
                    fontWeight: d.highlight ? 800 : 600,
                    color: d.highlight === "orange" ? "#FF9500" : d.highlight ? "#34C759" : "#fff"
                  }}>{d.v}</div>
                </div>
              ))}
            </div>

            {/* Monto reclamado — card destacada */}
            <div style={{
              background:"rgba(255,149,0,0.15)", border:"1px solid rgba(255,149,0,0.3)",
              borderRadius:8, padding:"10px 14px", marginBottom:8,
              display:"flex", justifyContent:"space-between", alignItems:"center"
            }}>
              <div>
                <div style={{fontSize:9, color:"rgba(255,255,255,0.5)",
                  fontWeight:700, textTransform:"uppercase", marginBottom:2}}>
                  💰 Monto reclamado por el cliente
                </div>
                <div style={{fontSize:18, fontWeight:900, color:"#FF9500"}}>
                  {fmt(casoActual.doc_monto || 0)}
                </div>
              </div>
              {casoActual.monto_reclamado > 0 && (
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:9, color:"rgba(255,255,255,0.5)",
                    fontWeight:700, textTransform:"uppercase", marginBottom:2}}>
                    ✅ Monto resolución
                  </div>
                  <div style={{fontSize:18, fontWeight:900, color:"#34C759"}}>
                    {fmt(casoActual.monto_reclamado)}
                  </div>
                </div>
              )}
            </div>
            {/* Vendedor BSALE */}
            {casoActual.vendedor_bsale && (
              <div style={{
                background:"rgba(255,255,255,0.08)", borderRadius:8,
                padding:"7px 10px", marginBottom:8,
                display:"flex", gap:8, alignItems:"center"
              }}>
                <span style={{fontSize:14}}>👤</span>
                <div>
                  <div style={{fontSize:9, color:"rgba(255,255,255,0.4)",
                    textTransform:"uppercase", fontWeight:700}}>Vendedor BSALE</div>
                  <div style={{fontSize:13, fontWeight:700, color:"#fff"}}>
                    {casoActual.vendedor_bsale}
                  </div>
                </div>
              </div>
            )}
            {/* Productos del caso */}
            {casoActual.notas?.startsWith('Productos en reclamo:') && (
              <div style={{background:"rgba(255,255,255,0.06)", borderRadius:8, padding:"8px 10px"}}>
                <div style={{fontSize:9, color:"rgba(255,255,255,0.4)",
                  textTransform:"uppercase", fontWeight:700, marginBottom:6}}>
                  Productos en reclamo
                </div>
                {casoActual.notas.replace('Productos en reclamo: ','').split(' | ').map((p, i) => {
                  const m = p.match(/(.+?)\s*\(SKU:\s*([^)]+)\)\s*—\s*cant\. reclamada:\s*(\d+)\s*de\s*(\d+)/)
                  return m ? (
                    <div key={i} style={{
                      display:"flex", justifyContent:"space-between",
                      alignItems:"center", padding:"4px 0",
                      borderBottom: i > 0 ? "1px solid rgba(255,255,255,0.06)" : "none"
                    }}>
                      <div>
                        <div style={{fontSize:12, fontWeight:600, color:"#fff"}}>{m[1].trim()}</div>
                        <div style={{fontSize:10, color:"rgba(255,255,255,0.4)"}}>SKU: {m[2].trim()}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{
                          fontSize:13, fontWeight:800,
                          color: parseInt(m[3]) < parseInt(m[4]) ? "#FF9500" : "#34C759"
                        }}>{m[3]} ud.</div>
                        <div style={{fontSize:9, color:"rgba(255,255,255,0.4)"}}>de {m[4]} compradas</div>
                      </div>
                    </div>
                  ) : (
                    <div key={i} style={{fontSize:12, color:"rgba(255,255,255,0.7)", padding:"3px 0"}}>{p}</div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── EVENTOS DEL TIMELINE ── */}
        {eventos.map((ev, i) => {
          const CFG = {
            creado:            {ic:'📥', c:'#FF9500', l:'Recepción del caso'},
            form2_completado:  {ic:'🔬', c:'#AF52DE', l:'Validación técnica'},
            form3_completado:  {ic:'🧾', c:'#007AFF', l:'Resolución'},
            escalado:          {ic:'🔺', c:'#FF3B30', l:'Escalado a jefatura'},
            form4_completado:  {ic:'⚖️',  c:'#FF9500', l:'Decisión de jefatura'},
            transfer_ejecutada:{ic:'💸', c:'#34C759', l:'Transferencia ejecutada'},
          }
          const cfg  = CFG[ev.evento] || {ic:'📌', c:'#8E8E93', l:ev.evento}
          const fecha = ev.created_at
            ? new Date(ev.created_at).toLocaleString('es-CL',{
                day:'2-digit', month:'2-digit', year:'numeric',
                hour:'2-digit', minute:'2-digit'
              })
            : "—"
          const esUltimo = i === eventos.length - 1

          // Extraer datos del payload si existe
          const p = ev.payload || {}

          return (
            <div key={i} style={{display:"flex", gap:0, marginBottom:0, position:"relative"}}>
              {/* Eje vertical */}
              <div style={{
                display:"flex", flexDirection:"column", alignItems:"center",
                width:32, flexShrink:0, marginRight:12
              }}>
                <div style={{
                  width:32, height:32, borderRadius:"50%", flexShrink:0,
                  background: cfg.c+"15", border:`2px solid ${cfg.c}`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:14, zIndex:1
                }}>
                  {cfg.ic}
                </div>
                {!esUltimo && (
                  <div style={{width:2, flex:1, minHeight:20, background:"#E5E5EA", marginTop:4}}/>
                )}
              </div>

              {/* Tarjeta del evento */}
              <div style={{
                flex:1, borderRadius:14, marginBottom:12,
                border:`1px solid ${cfg.c}30`,
                background: cfg.c+"06", overflow:"hidden"
              }}>
                {/* Header */}
                <div style={{
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"10px 14px", borderBottom:`1px solid ${cfg.c}20`,
                  background: cfg.c+"10"
                }}>
                  <div style={{fontWeight:800, fontSize:13, color:cfg.c}}>{cfg.l}</div>
                  <div style={{fontSize:10, color:"#8E8E93"}}>{fecha}</div>
                </div>

                {/* Cuerpo según tipo de evento */}
                <div style={{padding:"10px 14px"}}>

                  {/* ── CREADO: registro inicial ── */}
                  {ev.evento === 'creado' && (
                    <div>
                      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8}}>
                        <div>
                          <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                            textTransform:"uppercase", marginBottom:1}}>Cliente</div>
                          <div style={{fontSize:13, fontWeight:700}}>{casoActual.cliente_nombre}</div>
                          <div style={{fontSize:11, color:"#8E8E93"}}>{casoActual.cliente_rut}</div>
                        </div>
                        <div>
                          <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                            textTransform:"uppercase", marginBottom:1}}>Ingresado por</div>
                          <div style={{fontSize:13, fontWeight:700}}>{ev.usuario_nombre}</div>
                          <div style={{fontSize:11, color:"#8E8E93"}}>{ev.usuario_rol} · {casoActual.canal_ingreso}</div>
                        </div>
                      </div>
                      {casoActual.motivo_cliente && (
                        <div style={{
                          background:"#FFF8F0", border:"1px solid #FF950030",
                          borderRadius:8, padding:"8px 10px"
                        }}>
                          <div style={{fontSize:10, color:"#FF9500", fontWeight:700,
                            textTransform:"uppercase", marginBottom:3}}>Motivo expresado por el cliente</div>
                          <div style={{fontSize:12, color:"#3C3C43", fontStyle:"italic"}}>
                            "{casoActual.motivo_cliente}"
                          </div>
                        </div>
                      )}
                      {(casoActual.codigo_provisional || casoActual.codigo_final) && (
                        <div style={{marginTop:8, display:"flex", gap:6, alignItems:"center"}}>
                          <div style={{fontSize:10, color:"#8E8E93", fontWeight:600}}>Clasificación provisional:</div>
                          <Bd c="#007AFF" bg="#007AFF15">
                            {casoActual.codigo_provisional || casoActual.codigo_final}
                          </Bd>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── FORM 2: validación técnica ── */}
                  {ev.evento === 'form2_completado' && form2Data && (
                    <div>
                      <div style={{
                        display:"flex", alignItems:"center", gap:8,
                        marginBottom:10, padding:"8px 10px", borderRadius:8,
                        background: form2Data.procede_reclamo ? "#34C75912" : "#FF3B3012",
                        border:`1px solid ${form2Data.procede_reclamo ? "#34C75940" : "#FF3B3040"}`
                      }}>
                        <span style={{fontSize:18}}>
                          {form2Data.procede_reclamo ? "✅" : "❌"}
                        </span>
                        <div>
                          <div style={{
                            fontWeight:800, fontSize:14,
                            color: form2Data.procede_reclamo ? "#34C759" : "#FF3B30"
                          }}>
                            {form2Data.procede_reclamo ? "PROCEDE el reclamo" : "NO procede el reclamo"}
                          </div>
                          {!form2Data.procede_reclamo && form2Data.motivo_rechazo && (
                            <div style={{fontSize:11, color:"#FF3B30", marginTop:2}}>
                              Motivo: {form2Data.motivo_rechazo}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Productos inspeccionados */}
                      {form2Data.producto_nombre && (
                        <div style={{marginBottom:8}}>
                          <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                            textTransform:"uppercase", marginBottom:4}}>Productos inspeccionados</div>
                          {form2Data.producto_nombre.split(' | ').map((prod, j) => {
                            const mP = prod.match(/(.+?)\s*\(SKU:\s*([^)]+)\)\s*—\s*reclamadas:\s*(\d+),\s*recibidas:\s*(\d+)/)
                            return mP ? (
                              <div key={j} style={{
                                display:"flex", justifyContent:"space-between",
                                padding:"6px 8px", background:"#F7F7F8",
                                borderRadius:7, marginBottom:4
                              }}>
                                <div>
                                  <div style={{fontWeight:600, fontSize:12}}>{mP[1].trim()}</div>
                                  <div style={{fontSize:10, color:"#8E8E93"}}>SKU: {mP[2].trim()}</div>
                                </div>
                                <div style={{textAlign:"right"}}>
                                  <div style={{fontSize:10, color:"#8E8E93"}}>Reclamadas: {mP[3]}</div>
                                  <div style={{
                                    fontSize:12, fontWeight:700,
                                    color: parseInt(mP[4]) === parseInt(mP[3]) ? "#34C759" : "#FF9500"
                                  }}>Recibidas: {mP[4]}</div>
                                </div>
                              </div>
                            ) : (
                              <div key={j} style={{fontSize:12, padding:"4px 0"}}>{prod}</div>
                            )
                          })}
                        </div>
                      )}

                      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8}}>
                        {form2Data.descripcion_problema && (
                          <div style={{background:"#F7F7F8", borderRadius:8, padding:"8px 10px"}}>
                            <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                              textTransform:"uppercase", marginBottom:3}}>Problema observado</div>
                            <div style={{fontSize:12, color:"#3C3C43"}}>{form2Data.descripcion_problema}</div>
                          </div>
                        )}
                        {form2Data.conclusion_tecnica && (
                          <div style={{background:"#F7F7F8", borderRadius:8, padding:"8px 10px"}}>
                            <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                              textTransform:"uppercase", marginBottom:3}}>Conclusión técnica</div>
                            <div style={{fontSize:12, color:"#3C3C43"}}>{form2Data.conclusion_tecnica}</div>
                          </div>
                        )}
                      </div>

                      {form2Data.foto_url && (
                        <div style={{marginTop:8}}>
                          <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                            textTransform:"uppercase", marginBottom:4}}>Foto del producto</div>
                          <img src={form2Data.foto_url} alt="Foto producto"
                            style={{
                              width:120, height:120, objectFit:"cover",
                              borderRadius:8, border:"1px solid #E5E5EA", cursor:"pointer"
                            }}
                            onClick={() => window.open(form2Data.foto_url,'_blank')}/>
                        </div>
                      )}

                      <div style={{fontSize:10, color:"#AEAEB2", marginTop:8}}>
                        Validado por {form2Data.validador_nombre}
                        {form2Data.fecha_validacion
                          ? " · " + new Date(form2Data.fecha_validacion).toLocaleString('es-CL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})
                          : ""}
                      </div>
                    </div>
                  )}

                  {/* ── FORM 3: resolución ── */}
                  {(ev.evento === 'form3_completado' || ev.evento === 'escalado') && form3Data && (
                    <div>
                      <div style={{marginBottom:8}}>
                        <Bd c={
                          form3Data.tipo_resolucion==='cambio'      ? "#007AFF" :
                          form3Data.tipo_resolucion==='nc_abono'    ? "#AF52DE" :
                          form3Data.tipo_resolucion==='nc_transfer' ? "#34C759" :
                          form3Data.tipo_resolucion==='rechazar'    ? "#FF3B30" : "#FF9500"
                        } bg={
                          form3Data.tipo_resolucion==='cambio'      ? "#007AFF15" :
                          form3Data.tipo_resolucion==='nc_abono'    ? "#AF52DE15" :
                          form3Data.tipo_resolucion==='nc_transfer' ? "#34C75915" :
                          form3Data.tipo_resolucion==='rechazar'    ? "#FF3B3015" : "#FF950015"
                        } lg>
                          {{
                            cambio:      '🔄 Cambio de producto',
                            nc_abono:    '💳 NC con abono',
                            nc_transfer: '🏦 NC con transferencia',
                            escalar:     '🔺 Escalado a jefatura',
                            rechazar:    '❌ Caso rechazado',
                          }[form3Data.tipo_resolucion] || form3Data.tipo_resolucion}
                        </Bd>
                      </div>

                      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8}}>
                        {/* Monto reclamado por el cliente — siempre desde el documento original */}
                        {casoActual.doc_monto > 0 && (
                          <div style={{background:"#F7F7F8", borderRadius:8, padding:"7px 10px"}}>
                            <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                              textTransform:"uppercase", marginBottom:1}}>Monto reclamado (doc.)</div>
                            <div style={{fontSize:14, fontWeight:800, color:"#FF9500"}}>
                              {fmt(casoActual.doc_monto)}
                            </div>
                          </div>
                        )}
                        {/* Monto de resolución — NC o monto acordado */}
                        {form3Data.monto > 0 && (
                          <div style={{background:"#34C75910", borderRadius:8, padding:"7px 10px",
                            border:"1px solid #34C75930"}}>
                            <div style={{fontSize:10, color:"#34C759", fontWeight:700,
                              textTransform:"uppercase", marginBottom:1}}>Monto resolución</div>
                            <div style={{fontSize:14, fontWeight:800, color:"#34C759"}}>
                              {fmt(form3Data.monto)}
                            </div>
                          </div>
                        )}
                        {form3Data.bsale_doc_numero && (
                          <div style={{background:"#F7F7F8", borderRadius:8, padding:"7px 10px"}}>
                            <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                              textTransform:"uppercase", marginBottom:1}}>N° doc BSALE</div>
                            <div style={{fontSize:14, fontWeight:800}}>{form3Data.bsale_doc_numero}</div>
                          </div>
                        )}
                      </div>

                      {/* Datos bancarios si es transferencia */}
                      {form3Data.tipo_resolucion === 'nc_transfer' && form3Data.banco && (
                        <div style={{
                          background:"#1C1C1E", borderRadius:10,
                          padding:"10px 12px", marginTop:8,
                          display:"grid", gridTemplateColumns:"1fr 1fr", gap:6
                        }}>
                          {[
                            {l:"Titular",    v:form3Data.nombre_titular},
                            {l:"Banco",      v:form3Data.banco},
                            {l:"Tipo",       v:form3Data.tipo_cuenta},
                            {l:"N° cuenta",  v:form3Data.num_cuenta},
                            {l:"RUT",        v:form3Data.rut_titular},
                          ].map(d => (
                            <div key={d.l}>
                              <div style={{fontSize:9, color:"rgba(255,255,255,0.4)",
                                textTransform:"uppercase", fontWeight:700, marginBottom:1}}>{d.l}</div>
                              <div style={{fontSize:12, fontWeight:600, color:"#fff"}}>{d.v}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Escalamiento */}
                      {ev.evento === 'escalado' && (
                        <div style={{
                          background:"#FF950012", borderLeft:"3px solid #FF9500",
                          borderRadius:"0 8px 8px 0", padding:"8px 10px", marginTop:8
                        }}>
                          <div style={{fontSize:10, color:"#FF9500", fontWeight:700,
                            textTransform:"uppercase", marginBottom:3}}>Motivo del escalamiento</div>
                          <div style={{fontSize:12, color:"#3C3C43"}}>
                            {form3Data.escalar_motivo || ev.detalle}
                          </div>
                        </div>
                      )}

                      <div style={{fontSize:10, color:"#AEAEB2", marginTop:8}}>
                        Registrado por {form3Data.resuelto_por_nombre}
                        {form3Data.fecha_resolucion
                          ? " · " + new Date(form3Data.fecha_resolucion).toLocaleString('es-CL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})
                          : ""}
                      </div>
                    </div>
                  )}

                  {/* ── FORM 4: decisión jefatura ── */}
                  {ev.evento === 'form4_completado' && form4Data && (
                    <div>
                      <div style={{marginBottom:8}}>
                        <div style={{fontSize:12, color:"#3C3C43", background:"#F7F7F8",
                          borderRadius:8, padding:"8px 10px"}}>
                          {form4Data.observaciones_finales || ev.detalle}
                        </div>
                      </div>
                      <div style={{fontSize:10, color:"#AEAEB2"}}>
                        Decisión de {form4Data.cerrado_por_nombre}
                        {form4Data.fecha_cierre
                          ? " · " + new Date(form4Data.fecha_cierre).toLocaleString('es-CL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})
                          : ""}
                      </div>
                    </div>
                  )}

                  {/* ── TRANSFERENCIA ejecutada ── */}
                  {ev.evento === 'transfer_ejecutada' && form4Data && (
                    <div>
                      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8}}>
                        <div style={{background:"#34C75912", borderRadius:8, padding:"8px 10px"}}>
                          <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                            textTransform:"uppercase", marginBottom:1}}>N° operación</div>
                          <div style={{fontSize:15, fontWeight:800, color:"#34C759"}}>
                            {form4Data.transfer_comprobante}
                          </div>
                        </div>
                        <div style={{background:"#F7F7F8", borderRadius:8, padding:"8px 10px"}}>
                          <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                            textTransform:"uppercase", marginBottom:1}}>Fecha</div>
                          <div style={{fontSize:13, fontWeight:700}}>
                            {form4Data.transfer_fecha
                              ? new Date(form4Data.transfer_fecha).toLocaleDateString('es-CL')
                              : "—"}
                          </div>
                        </div>
                      </div>
                      {form4Data.transfer_comprobante_url && (
                        <div>
                          <div style={{fontSize:10, color:"#8E8E93", fontWeight:700,
                            textTransform:"uppercase", marginBottom:4}}>Comprobante adjunto</div>
                          {form4Data.transfer_comprobante_url.match(/\.(jpg|jpeg|png|webp)$/i) ? (
                            <img src={form4Data.transfer_comprobante_url} alt="Comprobante"
                              style={{
                                width:160, height:100, objectFit:"cover",
                                borderRadius:8, border:"1px solid #E5E5EA", cursor:"pointer"
                              }}
                              onClick={() => window.open(form4Data.transfer_comprobante_url,'_blank')}/>
                          ) : (
                            <a href={form4Data.transfer_comprobante_url} target="_blank"
                              rel="noreferrer"
                              style={{
                                display:"inline-flex", gap:6, alignItems:"center",
                                background:"#FF3B3012", border:"1px solid #FF3B3030",
                                borderRadius:8, padding:"6px 12px",
                                color:"#FF3B30", fontSize:12, fontWeight:700,
                                textDecoration:"none"
                              }}>
                              📄 Ver comprobante PDF
                            </a>
                          )}
                        </div>
                      )}
                      <div style={{fontSize:10, color:"#AEAEB2", marginTop:8}}>
                        Ejecutado por {form4Data.transfer_ejecutado_nombre}
                      </div>
                    </div>
                  )}

                  {/* Fallback para eventos sin template específico */}
                  {!['creado','form2_completado','form3_completado','escalado',
                     'form4_completado','transfer_ejecutada'].includes(ev.evento) && (
                    <div style={{fontSize:12, color:"#3C3C43"}}>{ev.detalle}</div>
                  )}

                  {/* Transición de estado */}
                  {ev.estado_nuevo && (
                    <div style={{display:"flex", gap:6, alignItems:"center", marginTop:8}}>
                      {ev.estado_anterior && (
                        <>
                          <Bd c="#8E8E93" bg="#F2F2F7" sm>
                            {ESTADOS[ev.estado_anterior]?.l || ev.estado_anterior}
                          </Bd>
                          <span style={{fontSize:10, color:"#8E8E93"}}>→</span>
                        </>
                      )}
                      <Bd c={ESTADOS[ev.estado_nuevo]?.c||"#8E8E93"}
                         bg={(ESTADOS[ev.estado_nuevo]?.c||"#8E8E93")+"15"}>
                        {ESTADOS[ev.estado_nuevo]?.ic} {ESTADOS[ev.estado_nuevo]?.l||ev.estado_nuevo}
                      </Bd>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {/* Sin eventos */}
        {eventos.length === 0 && (
          <div style={{
            background:"#F7F7F8", borderRadius:12,
            padding:"20px", textAlign:"center", color:"#8E8E93"
          }}>
            Sin eventos registrados todavía
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center",
        fontSize:11, color:"#8E8E93"}}>
        <div style={{display:"flex", gap:6, alignItems:"center"}}>
          <Av nombre={casoActual.ejecutivo_nombre} size={20}/>
          <span>Recibido por <strong style={{color:"#1C1C1E"}}>{casoActual.ejecutivo_nombre}</strong></span>
        </div>
        <div>{casoActual.fecha_recepcion} {casoActual.hora_recepcion}</div>
      </div>

    </Sheet>

    {/* FORM 2 en modal separado encima del detalle */}
    {showForm4T && (
      <Form4Transfer
        caso={casoActual} form3={form3Data} cu={cu}
        onClose={() => setShowForm4T(false)}
        onGuardado={async () => { setShowForm4T(false); await recargarCaso() }}
      />
    )}
    {showForm4E && (
      <Form4Escalamiento
        caso={casoActual} form3={form3Data} cu={cu}
        onClose={() => setShowForm4E(false)}
        onGuardado={async () => { setShowForm4E(false); await recargarCaso() }}
      />
    )}
    {showForm3 && (
      <Form3Resolucion
        caso={casoActual}
        cu={cu}
        codigos={codigos}
        onClose={() => setShowForm3(false)}
        onGuardado={onForm3Guardado}
      />
    )}
    {showForm2 && (
      <Form2Validacion
        caso={casoActual}
        cu={cu}
        onClose={() => setShowForm2(false)}
        onGuardado={onForm2Guardado}
      />
    )}

    {/* MODAL CAMBIO TIPO RESOLUCIÓN */}
    {showCambioTipo && form3Data && casoActual && (
      <div onClick={() => setShowCambioTipo(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',backdropFilter:'blur(8px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,padding:20}}>
        <div onClick={e => e.stopPropagation()} style={{background:'#fff',borderRadius:20,padding:28,width:'100%',maxWidth:460}}>
          <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>🔄 Cambiar método de pago</div>
          <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12}}>
            Caso {casoActual.numero} · Monto {fmt(form3Data.monto)}
          </div>
          <div style={{padding:'10px 14px',borderRadius:10,background:'var(--bg-hover)',marginBottom:10,fontSize:13}}>
            <span style={{color:'var(--text-muted)'}}>Tipo actual: </span>
            <strong>{form3Data.tipo_resolucion === 'nc_transfer' ? '🏦 Transferencia bancaria' : '💳 Abono cuenta cliente'}</strong>
          </div>
          <div style={{padding:'10px 14px',borderRadius:10,background:'var(--warning-bg)',border:'1px solid #FFE082',marginBottom:16,fontSize:12,color:'var(--warning-text)'}}>
            ⚠️ Este cambio quedará registrado con fecha, hora y tu usuario en el historial del caso.
          </div>
          {/* Transfer → Abono */}
          {form3Data.tipo_resolucion === 'nc_transfer' && (
            <div>
              <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>Cambiar a: <span style={{color:'var(--purple)'}}>💳 Abono cuenta cliente (NC)</span></div>
              <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:16}}>Se eliminarán los datos bancarios: {form3Data.banco} · {form3Data.num_cuenta}</div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button onClick={() => setShowCambioTipo(false)} style={{padding:'10px 18px',borderRadius:10,background:'var(--bg-hover)',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,color:'var(--text-primary)'}}>Cancelar</button>
                <button disabled={cambioTipoLoading} onClick={() => ejecutarCambioTipo('nc_abono', null)} style={{padding:'10px 18px',borderRadius:10,background:'var(--purple)',color:'#fff',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,opacity:cambioTipoLoading?0.6:1}}>
                  {cambioTipoLoading ? 'Guardando...' : 'Confirmar cambio'}
                </button>
              </div>
            </div>
          )}
          {/* Abono → Transfer */}
          {(form3Data.tipo_resolucion === 'nc_abono' || form3Data.tipo_resolucion === 'nc_abono_cliente') && (
            <div>
              <div style={{fontSize:13,fontWeight:600,marginBottom:12}}>Cambiar a: <span style={{color:'var(--success)'}}>🏦 Transferencia bancaria</span></div>
              {['banco','num_cuenta','nombre_titular'].map(k => (
                <div key={k} style={{marginBottom:10}}>
                  <label style={{display:'block',fontSize:12,fontWeight:600,color:'var(--text-secondary)',marginBottom:4}}>
                    {k==='banco'?'Banco':k==='num_cuenta'?'Número de cuenta':'Nombre titular'} *
                  </label>
                  <input value={cambioTipoDatos[k]||''} onChange={e => setCambioTipoDatos(p=>({...p,[k]:e.target.value}))}
                    style={{width:'100%',padding:'9px 12px',borderRadius:10,border:'1px solid var(--border-2)',fontSize:13,boxSizing:'border-box'}}
                    placeholder={k==='banco'?'Ej: BancoEstado':k==='num_cuenta'?'Ej: 123456789':'Nombre completo'}/>
                </div>
              ))}
              <div style={{marginBottom:14}}>
                <label style={{display:'block',fontSize:12,fontWeight:600,color:'var(--text-secondary)',marginBottom:4}}>Tipo de cuenta *</label>
                <select value={cambioTipoDatos.tipo_cuenta} onChange={e => setCambioTipoDatos(p=>({...p,tipo_cuenta:e.target.value}))} style={{width:'100%',padding:'9px 12px',borderRadius:10,border:'1px solid var(--border-2)',fontSize:13}}>
                  <option>Cuenta Corriente</option><option>Cuenta Vista</option><option>Cuenta RUT</option><option>Cuenta de Ahorro</option>
                </select>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button onClick={() => setShowCambioTipo(false)} style={{padding:'10px 18px',borderRadius:10,background:'var(--bg-hover)',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,color:'var(--text-primary)'}}>Cancelar</button>
                <button disabled={cambioTipoLoading||!cambioTipoDatos.banco||!cambioTipoDatos.num_cuenta||!cambioTipoDatos.nombre_titular}
                  onClick={() => ejecutarCambioTipo('nc_transfer', cambioTipoDatos)}
                  style={{padding:'10px 18px',borderRadius:10,background:(!cambioTipoDatos.banco||!cambioTipoDatos.num_cuenta||!cambioTipoDatos.nombre_titular)?'var(--text-disabled)':'var(--success)',color:'#fff',border:'none',cursor:'pointer',fontSize:13,fontWeight:600}}>
                  {cambioTipoLoading ? 'Guardando...' : 'Confirmar cambio'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}
    </>
  )
}

// ─── FORM 4A — EJECUCIÓN DE TRANSFERENCIA (Caja) ─────────────────────────
const Form4Transfer = ({caso, form3, cu, onClose, onGuardado}) => {
  const [saving,      setSaving]      = useState(false)
  const [errs,        setErrs]        = useState({})
  const [comprobante, setComprobante] = useState(null)   // File adjunto
  const [compPreview, setCompPreview] = useState(null)   // preview local
  const [uploading,   setUploading]   = useState(false)
  const [f, setF] = useState({
    num_operacion:    "",
    fecha_transfer:   hoy(),
    comprobante_nota: "",
  })
  const set = (k,v) => { setF(p=>({...p,[k]:v})); setErrs(p=>({...p,[k]:""})) }

  const puedeCaja = ['caja','admin','gerencia'].includes(cu.rol)

  const onComprobanteChange = e => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 15 * 1024 * 1024) { alert("El archivo no puede superar 15MB"); return }
    setComprobante(file)
    if (file.type.startsWith('image/')) {
      setCompPreview(URL.createObjectURL(file))
    } else {
      setCompPreview(null) // PDF — no preview visual
    }
  }

  const validar = () => {
    const e = {}
    if (!f.num_operacion.trim()) e.num_operacion = "Ingresa el N° de operación de la transferencia"
    if (!f.fecha_transfer)       e.fecha_transfer = "Requerido"
    return e
  }

  const guardar = async () => {
    const e = validar()
    if (Object.keys(e).length > 0) { setErrs(e); return }
    setSaving(true)

    // Subir comprobante si existe
    let compUrl = null
    if (comprobante) {
      setUploading(true)
      const ext  = comprobante.name.split('.').pop()
      const path = `transferencias/${caso.id}/comprobante_${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('postventa-fotos')
        .upload(path, comprobante, { upsert: true })
      if (!upErr) {
        const { data: urlData } = supabase.storage
          .from('postventa-fotos').getPublicUrl(path)
        compUrl = urlData?.publicUrl || null
      }
      setUploading(false)
    }

    // 1. Guardar FORM 4
    const { error } = await supabase.from('caso_form4_cierre').upsert({
      id:                    "f4"+Date.now().toString(36),
      caso_id:               caso.id,
      cliente_conforme:      true,
      metodo_confirmacion:   "transferencia_ejecutada",
      transfer_requerida:    true,
      transfer_ejecutada:    true,
      transfer_fecha:        new Date(f.fecha_transfer).toISOString(),
      transfer_comprobante:  f.num_operacion.trim(),
      transfer_comprobante_url: compUrl,
      transfer_ejecutado_por:   cu.id,
      transfer_ejecutado_nombre: cu.nombre,
      cerrado_por_id:        cu.id,
      cerrado_por_nombre:    cu.nombre,
      fecha_cierre:          new Date().toISOString(),
      observaciones_finales: f.comprobante_nota.trim() || null,
    }, { onConflict: 'caso_id' })

    if (error) { alert("Error: " + error.message); setSaving(false); return }

    // 2. Cerrar el caso con SLA real
    const horas = Math.round((Date.now() - new Date(caso.created_at).getTime()) / 3600000)
    await supabase.from('casos_postventa').update({
      estado:    'cerrado',
      cerrado_at: new Date().toISOString(),
      sla_resolucion_horas: horas,
      sla_cumplido: horas <= 48,
    }).eq('id', caso.id)

    // 3. Evento
    await supabase.from('caso_eventos').insert({
      caso_id:        caso.id,
      evento:         'transfer_ejecutada',
      estado_anterior:'cerrado',
      estado_nuevo:   'cerrado',
      detalle:        `Transferencia ejecutada por ${cu.nombre}. N° op: ${f.num_operacion}. Fecha: ${f.fecha_transfer}`,
      payload:        { num_operacion: f.num_operacion, fecha: f.fecha_transfer },
      usuario_id:     cu.id,
      usuario_nombre: cu.nombre,
      usuario_rol:    cu.rol,
    })

    // ── Email: notificar a postventa que transferencia fue ejecutada ──
    getEmailsParaEvento('form3_completado', ['postventa','admin','gerencia']).then(dest => {
      if (dest.length) sendEmail('transfer_ejecutada', {
        numero:         caso.numero,
        cliente_nombre: caso.cliente_nombre,
        cliente_rut:    caso.cliente_rut,
        num_operacion:  f.num_operacion,
        fecha_transfer: f.fecha_transfer,
        ejecutado_por:  cu.nombre,
        caso_id:        caso.id,
      }, dest)
    })

    setSaving(false)
    onGuardado()
  }

  return (
    <Sheet open wide onClose={onClose} title="💸 FORM 4 — Confirmación de transferencia">

      {!puedeCaja && (
        <div style={{background:"#FF3B3015",border:"1px solid #FF3B30",borderRadius:12,
          padding:"12px 14px",marginBottom:14,fontSize:13,color:"#FF3B30",fontWeight:600}}>
          🔒 Solo Caja puede confirmar la ejecución de la transferencia.
        </div>
      )}

      {/* Instrucción de la transferencia */}
      <div style={{
        background:"linear-gradient(135deg,#1a1a2e,#16213e)",
        borderRadius:14, padding:"16px", marginBottom:14, color:"#fff"
      }}>
        <div style={{fontSize:13, fontWeight:700, marginBottom:10, color:"rgba(255,255,255,0.6)"}}>
          INSTRUCCIÓN DE TRANSFERENCIA
        </div>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
          {[
            {l:"Cliente",       v: caso.cliente_nombre},
            {l:"RUT titular",   v: form3?.rut_titular || caso.cliente_rut},
            {l:"Nombre titular",v: form3?.nombre_titular || caso.cliente_nombre},
            {l:"Banco",         v: form3?.banco || "—"},
            {l:"Tipo cuenta",   v: form3?.tipo_cuenta || "—"},
            {l:"N° cuenta",     v: form3?.num_cuenta || "—"},
            {l:"NC BSALE N°",   v: form3?.bsale_doc_numero || "—"},
            {l:"Monto a girar", v: fmt(form3?.monto || 0)},
          ].map(d => (
            <div key={d.l}>
              <div style={{fontSize:10, color:"rgba(255,255,255,0.5)", fontWeight:600,
                textTransform:"uppercase", letterSpacing:"0.04em"}}>{d.l}</div>
              <div style={{fontSize:14, fontWeight:700, color: d.l==="Monto a girar"?"#34C759":"#fff",
                marginTop:2}}>{d.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={css.divider}/>
      <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>✅ Confirmar ejecución</div>

      <div style={css.row}>
        <div style={css.col}>
          <Fl l="N° operación / comprobante" req err={errs.num_operacion}>
            <input style={css.input} value={f.num_operacion}
              onChange={e => set('num_operacion', e.target.value)}
              placeholder="Ej: 202605041234"
              disabled={!puedeCaja}/>
          </Fl>
        </div>
        <div style={{flex:"0 0 160px"}}>
          <Fl l="Fecha de ejecución" req err={errs.fecha_transfer}>
            <input style={css.input} type="date" value={f.fecha_transfer}
              max={hoy()} onChange={e => set('fecha_transfer', e.target.value)}
              disabled={!puedeCaja}/>
          </Fl>
        </div>
      </div>

      <Fl l="Observaciones (opcional)">
        <textarea style={{...css.textarea, minHeight:60}}
          value={f.comprobante_nota}
          onChange={e => set('comprobante_nota', e.target.value)}
          placeholder="Ej: Transferencia realizada vía BancoEstado web..."
          disabled={!puedeCaja}/>
      </Fl>

      {/* Adjuntar comprobante */}
      <Fl l="Comprobante de transferencia (opcional)">
        <div style={{
          border:`2px dashed ${comprobante ? "#34C759" : "#E5E5EA"}`,
          borderRadius:12, padding:"14px",
          background: comprobante ? "#34C75908" : "#F7F7F8",
          cursor:"pointer", transition:"all 0.15s"
        }} onClick={() => document.getElementById('comp-input').click()}>
          <input id="comp-input" type="file"
            accept="image/*,.pdf"
            onChange={onComprobanteChange}
            style={{display:"none"}} disabled={!puedeCaja}/>

          {comprobante ? (
            <div style={{display:"flex", gap:10, alignItems:"center"}}>
              {compPreview ? (
                <img src={compPreview} alt="preview"
                  style={{width:64, height:64, objectFit:"cover", borderRadius:8}}/>
              ) : (
                <div style={{
                  width:64, height:64, borderRadius:8,
                  background:"#FF3B3015", display:"flex",
                  alignItems:"center", justifyContent:"center", fontSize:28
                }}>📄</div>
              )}
              <div style={{flex:1}}>
                <div style={{fontWeight:700, fontSize:13, color:"#34C759"}}>
                  ✅ {comprobante.name}
                </div>
                <div style={{fontSize:11, color:"#8E8E93", marginTop:2}}>
                  {(comprobante.size / 1024).toFixed(0)} KB ·{" "}
                  {comprobante.type.startsWith('image/') ? 'Imagen' : 'PDF'}
                </div>
                <button onClick={e => { e.stopPropagation(); setComprobante(null); setCompPreview(null) }}
                  style={{
                    marginTop:4, fontSize:11, color:"#FF3B30", background:"none",
                    border:"none", cursor:"pointer", padding:0, fontFamily:FONT
                  }}>
                  × Quitar
                </button>
              </div>
            </div>
          ) : (
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:28, marginBottom:4}}>📎</div>
              <div style={{fontSize:13, fontWeight:600, color:"#8E8E93"}}>
                Adjuntar comprobante
              </div>
              <div style={{fontSize:11, color:"#AEAEB2", marginTop:2}}>
                JPG, PNG o PDF · máx 15MB
              </div>
            </div>
          )}
        </div>
        {uploading && (
          <div style={{fontSize:12, color:"#007AFF", marginTop:4}}>
            ⏳ Subiendo comprobante...
          </div>
        )}
      </Fl>

      {puedeCaja && (
        <div style={{display:"flex", gap:10, marginTop:8}}>
          <Bt variant="secondary" fw onClick={onClose}>Cancelar</Bt>
          <Bt fw variant="success" loading={saving} onClick={guardar}>
            💸 Confirmar transferencia ejecutada
          </Bt>
        </div>
      )}
    </Sheet>
  )
}

// ─── FORM 4B — RESOLUCIÓN DE ESCALAMIENTO (Jefatura) ─────────────────────
const Form4Escalamiento = ({caso, form3, cu, onClose, onGuardado}) => {
  const [saving,   setSaving]   = useState(false)
  const [errs,     setErrs]     = useState({})
  const [decision, setDecision] = useState("")
  // 'aprobar_cambio' | 'aprobar_nc_abono' | 'aprobar_nc_transfer' | 'rechazar' | 'devolver'

  const [f, setF] = useState({
    resolucion_descripcion: "",
    // Si aprueba con NC transferencia
    banco:         "",
    tipo_cuenta:   "",
    num_cuenta:    "",
    rut_titular:   caso.cliente_rut || "",
    nombre_titular:caso.cliente_nombre || "",
    monto:         String(caso.doc_monto || ""),
    bsale_nc_num:  "",
    // Si devuelve
    motivo_devolver: "",
  })
  const set = (k,v) => { setF(p=>({...p,[k]:v})); setErrs(p=>({...p,[k]:""})) }

  const destino   = form3?.escalar_a || caso.escalado_a || "jefe_tienda"
  const puedeActuar = cu.rol === 'admin' || cu.rol === 'gerencia' ||
    (cu.rol === 'jefe_tienda' && destino === 'jefe_tienda')

  const validar = () => {
    const e = {}
    if (!decision) { e.decision = "Selecciona una decisión"; return e }
    if (!f.resolucion_descripcion.trim()) e.resolucion_descripcion = "Describe la decisión tomada"
    if (decision === 'aprobar_nc_transfer') {
      if (!f.bsale_nc_num.trim()) e.bsale_nc_num = "Requerido"
      if (!f.monto || Number(f.monto) <= 0) e.monto = "Requerido"
      if (!f.banco.trim())       e.banco       = "Requerido"
      if (!f.tipo_cuenta)        e.tipo_cuenta = "Requerido"
      if (!f.num_cuenta.trim())  e.num_cuenta  = "Requerido"
      if (!f.rut_titular.trim()) e.rut_titular = "Requerido"
      if (!f.nombre_titular.trim()) e.nombre_titular = "Requerido"
    }
    if (decision === 'devolver' && !f.motivo_devolver.trim())
      e.motivo_devolver = "Indica por qué se devuelve a resolución"
    return e
  }

  const guardar = async () => {
    const e = validar()
    if (Object.keys(e).length > 0) { setErrs(e); return }
    setSaving(true)

    const nuevoEstado = decision === 'rechazar'            ? 'rechazado'
                      : decision === 'devolver'            ? 'en_resolucion'
                      : decision === 'aprobar_nc_transfer' ? 'transfer_pendiente'
                      : 'cerrado'

    // 1. Guardar FORM 4
    await supabase.from('caso_form4_cierre').upsert({
      id:                   "f4"+Date.now().toString(36),
      caso_id:              caso.id,
      cliente_conforme:     !['rechazar','devolver'].includes(decision),
      metodo_confirmacion:  "decision_jefatura",
      transfer_requerida:   decision === 'aprobar_nc_transfer',
      transfer_ejecutada:   false,
      cerrado_por_id:       cu.id,
      cerrado_por_nombre:   cu.nombre,
      fecha_cierre:         new Date().toISOString(),
      observaciones_finales:f.resolucion_descripcion.trim(),
    }, { onConflict: 'caso_id' })

    // 2. Si aprueba NC transferencia → crear FORM 3 con datos bancarios
    if (decision === 'aprobar_nc_transfer') {
      await supabase.from('caso_form3_resolucion').upsert({
        id:                  "f3e"+Date.now().toString(36),
        caso_id:             caso.id,
        tipo_resolucion:     'nc_transfer',
        monto:               Number(f.monto),
        bsale_doc_numero:    f.bsale_nc_num.trim(),
        bsale_status:        'manual',
        banco:               f.banco.trim(),
        tipo_cuenta:         f.tipo_cuenta,
        num_cuenta:          f.num_cuenta.trim(),
        rut_titular:         f.rut_titular.trim(),
        nombre_titular:      f.nombre_titular.trim(),
        resuelto_por_id:     cu.id,
        resuelto_por_nombre: cu.nombre,
        fecha_resolucion:    new Date().toISOString(),
      }, { onConflict: 'caso_id' })
    }

    // 3. Actualizar estado del caso
    const updateData = { estado: nuevoEstado }
    if (['aprobar_nc_transfer','aprobar_nc_abono','aprobar_cambio'].includes(decision) && f.monto) {
      updateData.monto_reclamado = Number(f.monto) || 0
    }
    if (['cerrado','rechazado'].includes(nuevoEstado)) {
      updateData.cerrado_at = new Date().toISOString()
      const horas = Math.round((Date.now() - new Date(caso.created_at).getTime()) / 3600000)
      updateData.sla_resolucion_horas = horas
      updateData.sla_cumplido = horas <= 48
    }
    if (decision === 'devolver') {
      updateData.escalado_a      = null
      updateData.escalado_motivo = null
      updateData.escalado_fecha  = null
    }
    await supabase.from('casos_postventa').update(updateData).eq('id', caso.id)

    // 4. Evento
    await supabase.from('caso_eventos').insert({
      caso_id:        caso.id,
      evento:         'form4_completado',
      estado_anterior:'escalado',
      estado_nuevo:   nuevoEstado,
      detalle:        `Decisión jefatura (${cu.nombre}): ${decision} — ${f.resolucion_descripcion}`,
      payload:        { decision },
      usuario_id:     cu.id,
      usuario_nombre: cu.nombre,
      usuario_rol:    cu.rol,
    })

    // ── Email: notificar a postventa la decisión de jefatura ──
    const DECISION_LABELS = {
      aprobar_cambio:      '✅ Aprobado — Cambio de producto',
      aprobar_nc_abono:    '✅ Aprobado — NC con abono',
      aprobar_nc_transfer: '✅ Aprobado — NC con transferencia',
      rechazar:            '❌ Rechazado',
      devolver:            '↩️ Devuelto a resolución',
    }
    getEmailsParaEvento('form4_completado', ['postventa','admin','gerencia']).then(dest => {
      if (dest.length) sendEmail('form4_completado', {
        numero:              caso.numero,
        decision_label:      DECISION_LABELS[decision] || decision,
        observaciones:       f.resolucion_descripcion,
        cerrado_por_nombre:  cu.nombre,
        caso_id:             caso.id,
      }, dest)
    })
    // Si aprobó transferencia, notificar a caja
    if (decision === 'aprobar_nc_transfer') {
      getEmailsParaEvento('nc_transfer_caja', ['caja']).then(dest => {
        if (dest.length) sendEmail('form3_completado', {
          numero:           caso.numero,
          cliente_nombre:   caso.cliente_nombre,
          tipo_resolucion:  'nc_transfer',
          monto:            f.monto,
          bsale_doc_numero: f.bsale_nc_num,
          nombre_titular:   f.nombre_titular,
          banco:            f.banco,
          tipo_cuenta:      f.tipo_cuenta,
          num_cuenta:       f.num_cuenta,
          rut_titular:      f.rut_titular,
          resuelto_por_nombre: cu.nombre,
          caso_id:          caso.id,
        }, dest)
      })
    }

    setSaving(false)
    onGuardado()
  }

  const DECISIONES = [
    {k:'aprobar_cambio',      ic:'🔄', l:'Aprobar — Cambio de producto',    c:'#007AFF'},
    {k:'aprobar_nc_abono',    ic:'💳', l:'Aprobar — NC con abono',           c:'#AF52DE'},
    {k:'aprobar_nc_transfer', ic:'🏦', l:'Aprobar — NC con transferencia',   c:'#34C759'},
    {k:'rechazar',            ic:'❌', l:'Rechazar el caso',                  c:'#FF3B30'},
    {k:'devolver',            ic:'↩️',  l:'Devolver a resolución',            c:'#FF9500'},
  ]

  return (
    <Sheet open wide onClose={onClose} title="🔺 FORM 4 — Resolución de escalamiento">

      {!puedeActuar && (
        <div style={{background:"#FF3B3015",border:"1px solid #FF3B30",borderRadius:12,
          padding:"12px 14px",marginBottom:14,fontSize:13,color:"#FF3B30",fontWeight:600}}>
          🔒 Este caso está escalado a {destino==='jefe_tienda'?'Jefe de Tienda':'Gerencia'}.
          Solo ese rol puede resolverlo.
        </div>
      )}

      {/* Contexto del escalamiento */}
      <div style={{
        background:"#FF950012", border:"1px solid #FF950040",
        borderRadius:12, padding:"12px 16px", marginBottom:14
      }}>
        <div style={{fontWeight:700, fontSize:13, color:"#FF9500", marginBottom:6}}>
          🔺 Caso escalado a {destino==='jefe_tienda'?'Jefe de Tienda':'Gerencia'}
        </div>
        <div style={{fontSize:12, color:"#3C3C43", marginBottom:4}}>
          <span style={{fontWeight:600}}>Escalado por: </span>{form3?.resuelto_por_nombre || caso.ejecutivo_nombre}
        </div>
        <div style={{fontSize:12, color:"#3C3C43", marginBottom:4}}>
          <span style={{fontWeight:600}}>Motivo: </span>{form3?.escalar_motivo || caso.escalado_motivo || "—"}
        </div>
        <div style={{fontSize:12, color:"#3C3C43"}}>
          <span style={{fontWeight:600}}>Caso: </span>
          {caso.numero} · {caso.cliente_nombre} · {caso.doc_tipo} N°{caso.doc_numero} · {fmt(caso.doc_monto)}
        </div>
      </div>

      <div style={css.divider}/>
      <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>⚖️ Decisión de jefatura</div>
      {errs.decision && <div style={{color:"#FF3B30",fontSize:12,marginBottom:8}}>⚠️ {errs.decision}</div>}

      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14}}>
        {DECISIONES.map(d => (
          <div key={d.k}
            onClick={() => puedeActuar && setDecision(d.k)}
            style={{
              borderRadius:12, padding:"12px 14px",
              border:`2px solid ${decision===d.k ? d.c : "#E5E5EA"}`,
              background: decision===d.k ? d.c+"10" : "#fff",
              cursor: puedeActuar ? "pointer" : "default",
              transition:"all 0.15s", display:"flex", alignItems:"center", gap:8
            }}>
            <span style={{fontSize:18}}>{d.ic}</span>
            <span style={{fontWeight:700, fontSize:12, color:decision===d.k?d.c:"#1C1C1E"}}>
              {d.l}
            </span>
          </div>
        ))}
      </div>

      {/* Descripción siempre requerida */}
      {decision && (
        <Fl l="Descripción de la decisión" req err={errs.resolucion_descripcion}>
          <textarea style={css.textarea}
            value={f.resolucion_descripcion}
            onChange={e => set('resolucion_descripcion', e.target.value)}
            placeholder={
              decision==='rechazar'  ? "Explica al cliente por qué se rechaza el caso..." :
              decision==='devolver'  ? "Indica qué debe revisar Postventa antes de resolver..." :
              "Describe la decisión tomada y las condiciones..."
            }
            disabled={!puedeActuar}/>
        </Fl>
      )}

      {/* Campos adicionales para NC transferencia */}
      {decision === 'aprobar_nc_transfer' && (
        <div>
          <div style={css.divider}/>
          <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>🏦 Datos para la transferencia</div>
          <div style={css.row}>
            <div style={css.col}>
              <Fl l="N° NC BSALE" req err={errs.bsale_nc_num}>
                <input style={css.input} value={f.bsale_nc_num}
                  onChange={e => set('bsale_nc_num', e.target.value)}
                  placeholder="Ej: 789" disabled={!puedeActuar}/>
              </Fl>
            </div>
            <div style={css.col}>
              <Fl l="Monto ($)" req err={errs.monto}>
                <input style={css.input} type="number" value={f.monto}
                  onChange={e => set('monto', e.target.value)}
                  disabled={!puedeActuar}/>
              </Fl>
            </div>
          </div>
          <div style={css.row}>
            <div style={css.col}>
              <Fl l="Banco" req err={errs.banco}>
                <select style={css.select} value={f.banco}
                  onChange={e => set('banco', e.target.value)} disabled={!puedeActuar}>
                  <option value="">Seleccionar...</option>
                  {["Banco de Chile","BancoEstado","Santander","BCI","Itaú","Scotiabank",
                    "Security","Falabella","Ripley","Consorcio","Coopeuch","Otro"].map(b =>
                    <option key={b} value={b}>{b}</option>)}
                </select>
              </Fl>
            </div>
            <div style={css.col}>
              <Fl l="Tipo cuenta" req err={errs.tipo_cuenta}>
                <select style={css.select} value={f.tipo_cuenta}
                  onChange={e => set('tipo_cuenta', e.target.value)} disabled={!puedeActuar}>
                  <option value="">Seleccionar...</option>
                  <option value="corriente">Cuenta corriente</option>
                  <option value="vista">Cuenta vista</option>
                  <option value="rut">Cuenta RUT</option>
                  <option value="ahorro">Cuenta de ahorro</option>
                </select>
              </Fl>
            </div>
          </div>
          <div style={css.row}>
            <div style={css.col}>
              <Fl l="N° cuenta" req err={errs.num_cuenta}>
                <input style={css.input} value={f.num_cuenta}
                  onChange={e => set('num_cuenta', e.target.value)} disabled={!puedeActuar}/>
              </Fl>
            </div>
            <div style={css.col}>
              <Fl l="RUT titular" req err={errs.rut_titular}>
                <input style={css.input} value={f.rut_titular}
                  onChange={e => set('rut_titular', e.target.value)} disabled={!puedeActuar}/>
              </Fl>
            </div>
          </div>
          <Fl l="Nombre titular" req err={errs.nombre_titular}>
            <input style={css.input} value={f.nombre_titular}
              onChange={e => set('nombre_titular', e.target.value)} disabled={!puedeActuar}/>
          </Fl>
        </div>
      )}

      {decision === 'devolver' && (
        <Fl l="¿Qué debe corregir Postventa?" req err={errs.motivo_devolver}>
          <textarea style={{...css.textarea, minHeight:60}}
            value={f.motivo_devolver}
            onChange={e => set('motivo_devolver', e.target.value)}
            disabled={!puedeActuar}/>
        </Fl>
      )}

      {puedeActuar && decision && (
        <div style={{display:"flex", gap:10, marginTop:8}}>
          <Bt variant="secondary" fw onClick={onClose}>Cancelar</Bt>
          <Bt fw loading={saving}
            variant={decision==='rechazar'?"danger":decision==='devolver'?"warning":"success"}
            onClick={guardar}>
            {decision==='aprobar_cambio'       ? "✅ Aprobar cambio"            :
             decision==='aprobar_nc_abono'     ? "✅ Aprobar NC abono"          :
             decision==='aprobar_nc_transfer'  ? "✅ Aprobar NC + transferencia" :
             decision==='rechazar'             ? "❌ Rechazar caso"             :
                                                 "↩️ Devolver a resolución"}
          </Bt>
        </div>
      )}
    </Sheet>
  )
}

// ─── FORM 3 — RESOLUCIÓN ─────────────────────────────────────────────────
const Form3Resolucion = ({caso, cu, codigos, onClose, onGuardado}) => {
  const [saving,  setSaving]  = useState(false)
  const [errs,    setErrs]    = useState({})
  const [tipo,    setTipo]    = useState("")
  // 'cambio' | 'nc_abono' | 'nc_transfer' | 'escalar'

  const [f, setF] = useState({
    // Cambio
    bsale_cambio_num:   caso.numero || "",
    // NC (abono o transferencia)
    bsale_nc_num:       "",
    monto:              String(caso.doc_monto || ""),
    // Transferencia
    banco:              "",
    tipo_cuenta:        "",
    num_cuenta:         "",
    rut_titular:        caso.cliente_rut || "",
    nombre_titular:     caso.cliente_nombre || "",
    // Escalamiento
    escalar_a:          "jefe_tienda",
    escalar_motivo:     "",
    motivo_rechazo:     "",
    // Común
    notas_resolucion:   "",
  })
  const set = (k,v) => { setF(p=>({...p,[k]:v})); setErrs(p=>({...p,[k]:""})) }

  const puedeResolver = ['admin','postventa','jefe_tienda','gerencia'].includes(cu.rol)
  const estadoCorrecto = casoActual => casoActual.estado === 'en_resolucion'

  const validar = () => {
    const e = {}
    if (!tipo) { e.tipo = "Selecciona un tipo de resolución"; return e }
    if (tipo === 'cambio' && !f.bsale_cambio_num.trim())
      f.bsale_cambio_num = caso.numero  // fallback al número del caso
    if ((tipo === 'nc_abono' || tipo === 'nc_transfer') && !f.bsale_nc_num.trim())
      e.bsale_nc_num = "Ingresa el N° de la Nota de Crédito emitida en BSALE"
    if ((tipo === 'nc_abono' || tipo === 'nc_transfer') && (!f.monto || Number(f.monto) <= 0))
      e.monto = "Monto requerido"
    if (tipo === 'nc_transfer') {
      if (!f.banco.trim())       e.banco       = "Requerido"
      if (!f.tipo_cuenta)        e.tipo_cuenta = "Requerido"
      if (!f.num_cuenta.trim())  e.num_cuenta  = "Requerido"
      if (!f.rut_titular.trim()) e.rut_titular = "Requerido"
      if (!f.nombre_titular.trim()) e.nombre_titular = "Requerido"
    }
    if (tipo === 'escalar' && !f.escalar_motivo.trim())
      e.escalar_motivo = "Describe el motivo del escalamiento"
    if (tipo === 'rechazar' && !f.motivo_rechazo.trim())
      e.motivo_rechazo = "Debes indicar el motivo del rechazo para notificar al cliente"
    return e
  }

  // ── Generar PDF de resolución de cambio ──
  const generarPDFCambio = () => {
    const now     = new Date()
    const fechaDoc= now.toLocaleDateString('es-CL',{day:'2-digit',month:'2-digit',year:'numeric'})
    const horaDoc = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0')
    const prods   = caso.notas?.startsWith('Productos en reclamo:')
      ? caso.notas.replace('Productos en reclamo: ','').split(' | ')
          .map(p => { const m=p.match(/(.+?)\s*\(SKU:\s*([^)]+)\)\s*—\s*cant\. reclamada:\s*(\d+)/); return m?{nombre:m[1].trim(),sku:m[2].trim(),cant:m[3]}:{nombre:p,sku:'—',cant:'—'} })
      : []
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Resolucion ${caso.numero}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;color:#1C1C1E;padding:28px}.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1C1C1E;padding-bottom:14px;margin-bottom:18px}.logo{font-size:22px;font-weight:900}.titulo{font-size:16px;font-weight:800;color:#007AFF;padding:8px 12px;background:#007AFF10;border-left:4px solid #007AFF;border-radius:0 6px 6px 0;margin-bottom:14px}.sec{margin-bottom:14px}.sec-t{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8E8E93;margin-bottom:6px}.g2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.c{background:#F7F7F8;border-radius:6px;padding:8px 10px}.cl{font-size:10px;color:#8E8E93;font-weight:700;text-transform:uppercase;margin-bottom:2px}.cv{font-size:13px;font-weight:600}table{width:100%;border-collapse:collapse;margin-top:4px}th{background:#1C1C1E;color:#fff;font-size:10px;text-transform:uppercase;padding:7px 10px;text-align:left}td{padding:7px 10px;border-bottom:1px solid #F0F0F0;font-size:12px}.rbox{background:#34C75910;border:1.5px solid #34C759;border-radius:8px;padding:12px 14px;margin-bottom:14px}.aviso{background:#FFF3CD;border:1px solid #FF9500;border-radius:6px;padding:8px 10px;font-size:11px;color:#856404;margin-bottom:14px}.footer{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;border-top:1px solid #E5E5EA;padding-top:12px;margin-top:18px}.fbox{border:1px solid #E5E5EA;border-radius:6px;padding:8px;text-align:center;height:72px;display:flex;flex-direction:column;justify-content:flex-end}.flbl{font-size:10px;color:#8E8E93;border-top:1px solid #E5E5EA;padding-top:4px;margin-top:auto}@media print{.noprint{display:none}}</style></head>
<body>
<div class="hdr"><div><div class="logo">Outlet de Puertas SpA</div><div style="font-size:11px;color:#8E8E93;margin-top:3px">Sistema Postventa</div></div><div style="text-align:right;font-size:11px;color:#8E8E93"><strong style="display:block;font-size:15px;color:#1C1C1E">RESOLUCIÓN DE CAMBIO</strong>${fechaDoc} ${horaDoc} · N° <strong>${caso.numero}</strong></div></div>
<div class="titulo">🔄 Cambio de producto aprobado</div>
<div class="aviso">⚠️ Documento de respaldo formal. Debe ser firmado por el cliente, ejecutivo Postventa y Picking/Bodega antes de proceder con el cambio físico.</div>
<div class="sec"><div class="sec-t">Datos del cliente</div><div class="g2">
<div class="c"><div class="cl">Nombre</div><div class="cv">${caso.cliente_nombre}</div></div>
<div class="c"><div class="cl">RUT</div><div class="cv">${caso.cliente_rut}</div></div>
<div class="c"><div class="cl">Teléfono</div><div class="cv">${caso.cliente_telefono||'—'}</div></div>
<div class="c"><div class="cl">Tipo</div><div class="cv">${caso.cliente_tipo==='b2b'?'B2B / Empresa':'Persona natural'}</div></div></div></div>
<div class="sec"><div class="sec-t">Documento original</div><div class="g2">
<div class="c"><div class="cl">Tipo</div><div class="cv">${(caso.doc_tipo||'').toUpperCase()}</div></div>
<div class="c"><div class="cl">N° documento</div><div class="cv">${caso.doc_numero}</div></div>
<div class="c"><div class="cl">Fecha compra</div><div class="cv">${caso.doc_fecha}</div></div>
<div class="c"><div class="cl">Monto</div><div class="cv">$${Number(caso.doc_monto||0).toLocaleString('es-CL')}</div></div></div></div>
<div class="sec"><div class="sec-t">Motivo del reclamo</div>
<div class="c" style="background:#FFF8F0"><div class="cl">Descripción del cliente</div><div class="cv" style="font-weight:400">${caso.motivo_cliente||'—'}</div></div>
${caso.codigo_final?`<div class="c" style="margin-top:6px"><div class="cl">Código</div><div class="cv">${caso.codigo_final}</div></div>`:''}
</div>
${prods.length?`<div class="sec"><div class="sec-t">Productos a cambiar</div>
<table><thead><tr><th>Producto</th><th>SKU</th><th style="text-align:center">Cant.</th></tr></thead><tbody>
${prods.map(p=>`<tr><td>${p.nombre}</td><td style="color:#8E8E93">${p.sku}</td><td style="text-align:center;font-weight:700">${p.cant}</td></tr>`).join('')}
</tbody></table></div>`:''}
<div class="rbox"><div style="font-size:15px;font-weight:800;color:#34C759;margin-bottom:6px">✅ Cambio autorizado</div>
<div>Doc. BSALE N°: <strong>${f.bsale_cambio_num||'_______________'}</strong></div>
<div style="font-size:11px;color:#8E8E93;margin-top:4px">Autorizado por ${cu.nombre} · ${fechaDoc} ${horaDoc} · ${(caso.sucursal||'').replace(/_/g,' ')}</div>
${f.notas_resolucion?`<div style="font-size:11px;margin-top:4px">Obs: ${f.notas_resolucion}</div>`:''}</div>
<div class="footer">
<div class="fbox"><div style="flex:1"></div><div class="flbl">Firma del cliente</div></div>
<div class="fbox"><div style="flex:1"></div><div class="flbl">Ejecutivo Postventa<br>${cu.nombre}</div></div>
<div class="fbox"><div style="flex:1"></div><div class="flbl">Picking / Bodega</div></div></div>
<div style="text-align:center;margin-top:10px;font-size:10px;color:#C7C7CC">Outlet de Puertas SpA · Sistema Postventa · ${fechaDoc} ${horaDoc}</div>
<script>window.onload=()=>window.print()</script>
</body></html>`
    const w = window.open('','_blank','width=794,height=1050')
    w.document.write(html)
    w.document.close()
  }

  const guardar = async () => {
    const e = validar()
    if (Object.keys(e).length > 0) { setErrs(e); return }
    setSaving(true)

    const nuevoEstado = tipo === 'escalar'      ? 'escalado'
                      : tipo === 'nc_transfer' ? 'transfer_pendiente'
                      : tipo === 'rechazar'    ? 'rechazado'
                      : 'cerrado'
    const bsaleDocNum = tipo === 'cambio' ? f.bsale_cambio_num.trim()
                      : ['nc_abono','nc_transfer'].includes(tipo) ? f.bsale_nc_num.trim()
                      : null

    // 1. Guardar FORM 3
    const { error: f3err } = await supabase.from('caso_form3_resolucion').upsert({
      id:                  "f3"+Date.now().toString(36),
      caso_id:             caso.id,
      tipo_resolucion:     tipo,
      monto:               Number(f.monto) || 0,
      bsale_doc_tipo:      tipo === 'cambio' ? 'cambio' : tipo === 'escalar' ? null : 'nota_credito',
      bsale_doc_numero:    bsaleDocNum,
      bsale_status:        bsaleDocNum ? 'manual' : 'pendiente',
      bsale_emitido_at:    bsaleDocNum ? new Date().toISOString() : null,
      banco:               tipo === 'nc_transfer' ? f.banco.trim() : null,
      tipo_cuenta:         tipo === 'nc_transfer' ? f.tipo_cuenta  : null,
      num_cuenta:          tipo === 'nc_transfer' ? f.num_cuenta.trim() : null,
      rut_titular:         tipo === 'nc_transfer' ? f.rut_titular.trim() : null,
      nombre_titular:      tipo === 'nc_transfer' ? f.nombre_titular.trim() : null,
      resuelto_por_id:     cu.id,
      resuelto_por_nombre: cu.nombre,
      fecha_resolucion:    new Date().toISOString(),
    }, { onConflict: 'caso_id' })

    if (f3err) { alert("Error al guardar: " + f3err.message); setSaving(false); return }

    // 2. Actualizar estado del caso + monto reclamado
    const updateData = { estado: nuevoEstado }
    // Guardar monto reclamado (NC o doc) para mostrarlo en la lista
    if (['nc_abono','nc_transfer','cambio'].includes(tipo) && f.monto) {
      updateData.monto_reclamado = Number(f.monto) || 0
    }
    if (tipo === 'escalar') {
      updateData.escalado_a      = f.escalar_a
      updateData.escalado_motivo = f.escalar_motivo.trim()
      updateData.escalado_fecha  = new Date().toISOString()
    } else if (tipo === 'nc_transfer') {
      // NO cerrar — queda en transfer_pendiente hasta que Caja confirme
    } else {
      // cambio, nc_abono, rechazar → cerrar directamente
      updateData.cerrado_at = new Date().toISOString()
      const horas = Math.round((Date.now() - new Date(caso.created_at).getTime()) / 3600000)
      updateData.sla_resolucion_horas = horas
      updateData.sla_cumplido = horas <= 48
    }
    await supabase.from('casos_postventa').update(updateData).eq('id', caso.id)

    // 3. Evento auditable
    await supabase.from('caso_eventos').insert({
      caso_id:        caso.id,
      evento:         tipo === 'escalar' ? 'escalado' : 'form3_completado',
      estado_anterior: caso.estado,  // puede ser 'en_resolucion' o 'abierto'
      estado_nuevo:   nuevoEstado,
      detalle:        tipo === 'cambio'       ? `Cambio de producto. Doc BSALE: ${bsaleDocNum}` :
                      tipo === 'nc_abono'     ? `NC abono emitida. N° ${bsaleDocNum}. Monto: ${fmt(Number(f.monto))}` :
                      tipo === 'nc_transfer'  ? `NC transferencia. N° ${bsaleDocNum}. Monto: ${fmt(Number(f.monto))}` :
                      `Escalado a ${f.escalar_a}: ${f.escalar_motivo}`,
      payload:        { tipo, bsale_doc: bsaleDocNum, monto: f.monto },
      usuario_id:     cu.id,
      usuario_nombre: cu.nombre,
      usuario_rol:    cu.rol,
    })

    setSaving(false)

    // ── Emails según tipo de resolución ──
    if (tipo === 'escalar') {
      // Notificar a quien se escaló
      const rolDestino = f.escalar_a === 'jefe_tienda'
        ? ['jefe_tienda','admin','gerencia']
        : ['gerencia','admin']
      getEmailsParaEvento('caso_escalado', rolDestino).then(dest => {
        if (dest.length) sendEmail('caso_escalado', {
          numero:            caso.numero,
          cliente_nombre:    caso.cliente_nombre,
          sucursal:          caso.sucursal,
          escalar_motivo:    f.escalar_motivo,
          escalado_por:      cu.nombre,
          destinatario_nombre: dest[0]?.nombre || '',
          caso_id:           caso.id,
        }, dest)
      })
    } else {
      // Notificar resolución
      const roles = tipo === 'nc_transfer'
        ? ['caja','admin','gerencia']
        : ['admin','gerencia']
      const eventoKey = tipo === 'nc_transfer' ? 'nc_transfer_caja' : 'form3_completado'
      getEmailsParaEvento(eventoKey, roles).then(dest => {
        if (dest.length) sendEmail('form3_completado', {
          numero:              caso.numero,
          cliente_nombre:      caso.cliente_nombre,
          tipo_resolucion:     tipo,
          monto:               f.monto,
          bsale_doc_numero:    bsaleDocNum,
          banco:               f.banco,
          tipo_cuenta:         f.tipo_cuenta,
          num_cuenta:          f.num_cuenta,
          rut_titular:         f.rut_titular,
          nombre_titular:      f.nombre_titular,
          escalar_a:           f.escalar_a,
          escalar_motivo:      f.escalar_motivo,
          resuelto_por_nombre: cu.nombre,
          caso_id:             caso.id,
        }, dest)
      })
    }

    onGuardado()
  }

  const TIPOS_RES = [
    {k:'cambio',      ic:'🔄', l:'Cambio de producto',      desc:'Se reemplaza producto sin nota de crédito. Entregar comprobante a bodega.', c:'#007AFF'},
    {k:'nc_abono',    ic:'💳', l:'NC con saldo a favor',     desc:'Nota de crédito. El monto queda como saldo para futura compra.', c:'#AF52DE'},
    {k:'nc_transfer', ic:'🏦', l:'NC con transferencia',     desc:'Nota de crédito + devolución vía transferencia bancaria. Requiere datos bancarios.', c:'#34C759'},
    {k:'escalar',     ic:'🔺', l:'Escalar a jefatura',       desc:'El caso supera la autoridad de Postventa. Pasa a Jefe de Tienda o Gerencia.', c:'#FF9500'},
    {k:'rechazar',    ic:'❌', l:'Rechazar caso',            desc:'El caso no tiene fundamento para resolución. Se notifica al cliente con el motivo.', c:'#FF3B30'},
  ]

  return (
    <Sheet open wide onClose={onClose} title="🧾 FORM 3 — Resolución del caso">

      {!puedeResolver && (
        <div style={{background:"#FF3B3015",border:"1px solid #FF3B30",borderRadius:12,
          padding:"12px 14px",marginBottom:14,fontSize:13,color:"#FF3B30",fontWeight:600}}>
          🔒 Solo Postventa, Jefe Tienda, Admin y Gerencia pueden resolver casos.
        </div>
      )}

      {/* Resumen del caso */}
      <div style={{background:"#F2F2F7",borderRadius:12,padding:"10px 14px",marginBottom:12,fontSize:12}}>
        <div style={{fontWeight:700,marginBottom:3}}>{caso.numero} · {caso.cliente_nombre}</div>
        <div style={{color:"#8E8E93"}}>
          {caso.doc_tipo} {caso.doc_numero} · {fmt(caso.doc_monto)} · {caso.cliente_rut}
        </div>
      </div>

      <div style={css.divider}/>

      {/* ── Tipo de resolución ── */}
      <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>⚖️ Tipo de resolución</div>
      {errs.tipo && <div style={{color:"#FF3B30",fontSize:12,marginBottom:8}}>⚠️ {errs.tipo}</div>}

      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14}}>
        {TIPOS_RES.map(t => (
          <div key={t.k}
            onClick={() => puedeResolver && setTipo(t.k)}
            style={{
              borderRadius:14, padding:"14px",
              border:`2px solid ${tipo===t.k ? t.c : "#E5E5EA"}`,
              background: tipo===t.k ? t.c+"10" : "#fff",
              cursor: puedeResolver ? "pointer" : "default",
              transition:"all 0.15s"
            }}>
            <div style={{fontSize:20, marginBottom:4}}>{t.ic}</div>
            <div style={{fontWeight:700, fontSize:13, color: tipo===t.k?t.c:"#1C1C1E", marginBottom:3}}>
              {t.l}
            </div>
            <div style={{fontSize:11, color:"#8E8E93", lineHeight:1.4}}>{t.desc}</div>
          </div>
        ))}
      </div>

      {/* ── Campos según tipo ── */}
      {tipo === 'cambio' && (
        <div>
          <div style={css.divider}/>
          <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>🔄 Cambio de producto</div>
          <div style={{
            background:"#007AFF10",border:"1px solid #007AFF30",
            borderRadius:10,padding:"8px 12px",marginBottom:12,fontSize:12,color:"#007AFF"
          }}>
            ℹ️ El número correlativo del caso queda registrado como referencia del cambio.
          </div>
          <Fl l="N° documento de cambio (correlativo del caso)">
            <input style={{...css.input, background:"#F7F7F8", color:"#8E8E93", cursor:"default"}}
              value={f.bsale_cambio_num}
              readOnly/>
          </Fl>
          <Fl l="Notas de la resolución">
            <textarea style={css.textarea} value={f.notas_resolucion}
              onChange={e => set('notas_resolucion', e.target.value)}
              placeholder="Observaciones adicionales..." disabled={!puedeResolver}/>
          </Fl>
          {/* Botón PDF — disponible siempre para imprimir el respaldo */}
          <div style={{
            background:"#F7F7F8", border:"1px solid #E5E5EA",
            borderRadius:10, padding:"10px 14px", display:"flex",
            justifyContent:"space-between", alignItems:"center"
          }}>
            <div>
              <div style={{fontWeight:700, fontSize:13}}>📄 Documento de respaldo para bodega</div>
              <div style={{fontSize:11, color:"#8E8E93", marginTop:2}}>
                Genera el PDF con firmas para cliente, Postventa y Picking
              </div>
            </div>
            <Bt sm variant="secondary" onClick={generarPDFCambio}>
              🖨️ Generar PDF
            </Bt>
          </div>
        </div>
      )}

      {(tipo === 'nc_abono' || tipo === 'nc_transfer') && (
        <div>
          <div style={css.divider}/>
          <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>
            {tipo === 'nc_abono' ? '💳 Nota de crédito — abono' : '🏦 Nota de crédito — transferencia'}
          </div>
          <div style={{
            background:"#AF52DE10",border:"1px solid #AF52DE30",
            borderRadius:10,padding:"8px 12px",marginBottom:12,fontSize:12,color:"#AF52DE"
          }}>
            ℹ️ Emite la Nota de Crédito en BSALE primero, luego ingresa el número aquí.
            {tipo === 'nc_transfer' && " La instrucción de transferencia se enviará automáticamente a Caja."}
          </div>
          <div style={css.row}>
            <div style={css.col}>
              <Fl l="N° Nota de Crédito (BSALE)" req err={errs.bsale_nc_num}>
                <input style={css.input} value={f.bsale_nc_num}
                  onChange={e => set('bsale_nc_num', e.target.value)}
                  placeholder="Ej: 456" disabled={!puedeResolver}/>
              </Fl>
            </div>
            <div style={css.col}>
              <Fl l="Monto NC ($)" req err={errs.monto}>
                <input style={css.input} type="number" value={f.monto}
                  onChange={e => set('monto', e.target.value)}
                  placeholder={String(caso.doc_monto)} disabled={!puedeResolver}/>
              </Fl>
            </div>
          </div>
          <Fl l="Notas de la resolución">
            <textarea style={{...css.textarea, minHeight:60}} value={f.notas_resolucion}
              onChange={e => set('notas_resolucion', e.target.value)}
              disabled={!puedeResolver}/>
          </Fl>
        </div>
      )}

      {tipo === 'nc_transfer' && (
        <div>
          <div style={css.divider}/>
          <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>🏦 Datos bancarios del cliente</div>
          <div style={{
            background:"#FF950010",border:"1px solid #FF950030",
            borderRadius:10,padding:"8px 12px",marginBottom:12,fontSize:12,color:"#FF9500"
          }}>
            ⚠️ Estos datos quedarán registrados para que Caja ejecute la transferencia. Verifica con el cliente.
          </div>
          <div style={css.row}>
            <div style={css.col}>
              <Fl l="Banco" req err={errs.banco}>
                <select style={css.select} value={f.banco}
                  onChange={e => set('banco', e.target.value)} disabled={!puedeResolver}>
                  <option value="">Seleccionar...</option>
                  {["Banco de Chile","BancoEstado","Santander","BCI","Itaú","Scotiabank",
                    "Security","Falabella","Ripley","Consorcio","Coopeuch","Otro"].map(b =>
                    <option key={b} value={b}>{b}</option>
                  )}
                </select>
              </Fl>
            </div>
            <div style={css.col}>
              <Fl l="Tipo de cuenta" req err={errs.tipo_cuenta}>
                <select style={css.select} value={f.tipo_cuenta}
                  onChange={e => set('tipo_cuenta', e.target.value)} disabled={!puedeResolver}>
                  <option value="">Seleccionar...</option>
                  <option value="corriente">Cuenta corriente</option>
                  <option value="vista">Cuenta vista</option>
                  <option value="rut">Cuenta RUT</option>
                  <option value="ahorro">Cuenta de ahorro</option>
                </select>
              </Fl>
            </div>
          </div>
          <div style={css.row}>
            <div style={css.col}>
              <Fl l="N° de cuenta" req err={errs.num_cuenta}>
                <input style={css.input} value={f.num_cuenta}
                  onChange={e => set('num_cuenta', e.target.value)}
                  placeholder="Ej: 00012345678" disabled={!puedeResolver}/>
              </Fl>
            </div>
            <div style={css.col}>
              <Fl l="RUT titular" req err={errs.rut_titular}>
                <input style={css.input} value={f.rut_titular}
                  onChange={e => set('rut_titular', e.target.value)}
                  placeholder="12.345.678-9" disabled={!puedeResolver}/>
              </Fl>
            </div>
          </div>
          <Fl l="Nombre titular" req err={errs.nombre_titular}>
            <input style={css.input} value={f.nombre_titular}
              onChange={e => set('nombre_titular', e.target.value)}
              disabled={!puedeResolver}/>
          </Fl>
        </div>
      )}

      {tipo === 'escalar' && (
        <div>
          <div style={css.divider}/>
          <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>🔺 Escalamiento</div>
          <div style={css.row}>
            <div style={css.col}>
              <Fl l="Escalar a">
                <select style={css.select} value={f.escalar_a}
                  onChange={e => set('escalar_a', e.target.value)} disabled={!puedeResolver}>
                  <option value="jefe_tienda">Jefe de Tienda (Nivel 2)</option>
                  <option value="gerencia">Gerencia Comercial (Nivel 3)</option>
                </select>
              </Fl>
            </div>
          </div>
          <Fl l="Motivo del escalamiento" req err={errs.escalar_motivo}>
            <textarea style={css.textarea} value={f.escalar_motivo}
              onChange={e => set('escalar_motivo', e.target.value)}
              placeholder="Describe por qué este caso debe ser revisado por la jefatura..."
              disabled={!puedeResolver}/>
          </Fl>
        </div>
      )}

      {tipo === 'rechazar' && (
        <div>
          <div style={css.divider}/>
          <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>❌ Rechazo del caso</div>
          <div style={{
            background:"#FF3B3010", border:"1px solid #FF3B3030",
            borderRadius:10, padding:"8px 12px", marginBottom:12,
            fontSize:12, color:"#FF3B30"
          }}>
            ⚠️ El rechazo cierra el caso definitivamente. El motivo quedará registrado en la bitácora.
          </div>
          <Fl l="Motivo del rechazo" req err={errs.motivo_rechazo}>
            <textarea style={css.textarea} value={f.motivo_rechazo}
              onChange={e => set('motivo_rechazo', e.target.value)}
              placeholder="ej: El producto presenta daños atribuibles al uso inadecuado por parte del cliente, no corresponde a falla de fábrica ni error de despacho."
              disabled={!puedeResolver}/>
          </Fl>
        </div>
      )}

      {/* Acciones */}
      {puedeResolver && tipo && (
        <div style={{display:"flex", gap:10, marginTop:14}}>
          <Bt variant="secondary" fw onClick={onClose}>Cancelar</Bt>
          <Bt fw loading={saving}
            variant={tipo==='escalar'?"warning":tipo==='rechazar'?"danger":tipo==='cambio'?"primary":"success"}
            onClick={guardar}>
            {tipo==='cambio'      ? "✅ Registrar cambio"              :
             tipo==='nc_abono'    ? "💳 Registrar NC abono"            :
             tipo==='nc_transfer' ? "🏦 Registrar NC + transferencia"  :
             tipo==='rechazar'    ? "❌ Confirmar rechazo"             :
                                    "🔺 Escalar caso"}
          </Bt>
        </div>
      )}
      {!tipo && (
        <div style={{marginTop:8, fontSize:12, color:"#8E8E93", textAlign:"center"}}>
          Selecciona un tipo de resolución para continuar
        </div>
      )}
    </Sheet>
  )
}

// ─── NUEVO CASO (FORM 1) ──────────────────────────────────────────────────
const NuevoCaso = ({cu, codigos, onClose, onCreado}) => {
  const [saving, setSaving] = useState(false)
  const [errs, setErrs]     = useState({})

  // ── Estados BSALE ──
  const [buscandoRut,    setBuscandoRut]    = useState(false)
  const [buscandoDoc,    setBuscandoDoc]    = useState(false)
  const [docsCliente,    setDocsCliente]    = useState([])
  const [multiDocs,      setMultiDocs]      = useState([])   // múltiples docs mismo número
  const [bsaleOk,        setBsaleOk]        = useState(false)
  const [bsaleErr,       setBsaleErr]       = useState("")
  // ── Líneas del documento seleccionado ──
  const [lineasDoc,      setLineasDoc]      = useState([])
  const [cargandoLineas, setCargandoLineas] = useState(false)
  const [prodsSel,       setProdsSel]       = useState([])
  const [docSelInfo,     setDocSelInfo]     = useState(null)

  const [f, setF] = useState({
    sucursal:          "",
    canal_ingreso:     "",
    cliente_nombre:    "",
    cliente_rut:       "",
    cliente_telefono:  "",
    cliente_email:     "",
    cliente_tipo:      "persona",
    doc_tipo:          "",
    doc_numero:        "",
    doc_fecha:         "",
    doc_monto:         "",
    motivo_cliente:    "",
    codigo_provisional:"",
    es_critico:        false,
  })

  const set = (k, v) => { setF(p => ({...p, [k]:v})); setErrs(p => ({...p, [k]:""})) }

  // ── Helper llamada a Edge Function bsale-proxy ──
  const bsaleCall = async (accion, params) => {
    const baseUrl = import.meta.env.VITE_SUPABASE_URL
    const fnUrl   = `${baseUrl}/functions/v1/bsale-proxy`
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    const res = await fetch(fnUrl, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${anonKey}`,
        'apikey':        anonKey,
      },
      body: JSON.stringify({ accion, ...params })
    })
    return res.json()
  }

  // ── Buscar cliente por RUT al salir del campo ──
  const buscarPorRut = async () => {
    const rut = f.cliente_rut.trim()
    if (!rut || rut.length < 5) return
    setBuscandoRut(true); setBsaleErr(""); setDocsCliente([])
    try {
      const data = await bsaleCall('buscar_por_rut', { rut })
      console.log('[BSALE buscar_por_rut] respuesta:', JSON.stringify(data))

      // Si la función devuelve error HTTP (texto plano o JSON con error)
      if (!data || data.error) {
        setBsaleErr("BSALE: " + (data?.error || "respuesta vacía"))
        setBuscandoRut(false); return
      }

      const docs = data.documentos || []
      setDocsCliente(docs)

      if (data.cliente?.nombre) {
        setF(p => ({
          ...p,
          cliente_nombre:   data.cliente.nombre   || p.cliente_nombre,
          cliente_telefono: data.cliente.telefono || p.cliente_telefono,
          cliente_email:    data.cliente.email    || p.cliente_email,
          cliente_tipo:     data.cliente.tipo     || p.cliente_tipo,
        }))
        setErrs(p => ({...p, cliente_nombre:"", cliente_rut:""}))
        setBsaleOk(true)
      } else if (docs.length > 0) {
        const u = docs[0]
        setF(p => ({
          ...p,
          cliente_nombre:   u.cliente_nombre   || p.cliente_nombre,
          cliente_telefono: u.cliente_telefono || p.cliente_telefono,
          cliente_email:    u.cliente_email    || p.cliente_email,
        }))
        setErrs(p => ({...p, cliente_nombre:"", cliente_rut:""}))
        setBsaleOk(true)
      } else {
        setBsaleErr(data.debug || "RUT no encontrado en BSALE — ingresa los datos manualmente")
      }
    } catch(e) {
      console.error('[BSALE] error:', e)
      setBsaleErr("Error de conexión con BSALE")
    }
    setBuscandoRut(false)
  }

  // ── Buscar documento por número al salir del campo ──
  const buscarPorNumDoc = async () => {
    const num = f.doc_numero.trim()
    if (!num || num.length < 2) return
    setBuscandoDoc(true); setBsaleErr(""); setMultiDocs([])
    try {
      const data = await bsaleCall('buscar_por_numero', { numero: num })
      if (data.error) { setBsaleErr("BSALE: " + data.error); setBuscandoDoc(false); return }

      const multiples = data.multiples || []

      if (multiples.length === 0) {
        setBsaleErr(`N°${num} no encontrado en BSALE — ingresa los datos manualmente`)
      } else if (multiples.length === 1) {
        // Solo uno → aplicar directo
        await aplicarDoc(multiples[0])
      } else {
        // Múltiples → mostrar selector
        setMultiDocs(multiples)
        setBsaleErr("")
      }
    } catch(e) { setBsaleErr("Sin conexión con BSALE") }
    setBuscandoDoc(false)
  }

  // ── Aplicar documento + cargar líneas de productos ──
  const aplicarDoc = async doc => {
    setMultiDocs([])
    setF(p => ({
      ...p,
      doc_tipo:   doc.tipo === 'ticket' ? 'boleta' :
                  doc.tipo === 'nota_venta' ? 'boleta' :
                  ['boleta','factura'].includes(doc.tipo) ? doc.tipo : p.doc_tipo,
      doc_numero: String(doc.numero),
      doc_fecha:  doc.fecha ? doc.fecha.slice(0,10) : p.doc_fecha,
      doc_monto:  doc.monto ? String(doc.monto) : p.doc_monto,
      // Cliente: vincular siempre si BSALE lo trae, independiente de lo que haya
      cliente_nombre:   doc.cliente_nombre   || p.cliente_nombre,
      cliente_rut:      doc.cliente_rut      || p.cliente_rut,
      cliente_telefono: doc.cliente_telefono || p.cliente_telefono,
      cliente_email:    doc.cliente_email    || p.cliente_email,
      cliente_tipo:     doc.cliente_tipo     || p.cliente_tipo,
    }))
    setErrs(p => ({...p, doc_tipo:"", doc_numero:"", doc_fecha:"", doc_monto:"",
                         cliente_nombre:"", cliente_rut:""}))
    setDocsCliente([])
    setDocSelInfo(doc)
    setProdsSel([])
    setLineasDoc([])
    setBsaleOk(!doc.sin_cliente)

    if (doc.sin_cliente) {
      setBsaleErr(`✅ Documento encontrado (${doc.tipo_nombre || doc.tipo}) — cliente no registrado en BSALE. Ingresa los datos manualmente.`)
    } else {
      setBsaleErr("")
    }

    // Cargar productos automáticamente
    if (doc.bsale_id) {
      setCargandoLineas(true)
      try {
        const det = await bsaleCall('detalle_documento', { bsale_id: doc.bsale_id })
        if (det.ok && det.lineas) setLineasDoc(det.lineas)
        else setLineasDoc([])
      } catch(e) { setLineasDoc([]) }
      setCargandoLineas(false)
    }
  }

  // ── Toggle selección de producto para reclamar ──
  const toggleProd = (linea) => {
    setProdsSel(prev => {
      const existe = prev.find(p => p.sku === linea.sku)
      if (existe) return prev.filter(p => p.sku !== linea.sku)
      return [...prev, {
        sku:           linea.sku,
        nombre:        linea.nombre,
        cant_comprada: linea.cantidad,
        cant_reclamo:  1,
      }]
    })
  }

  // ── Cambiar cantidad a reclamar ──
  const setCantReclamo = (sku, val) => {
    setProdsSel(prev => prev.map(p =>
      p.sku === sku
        ? {...p, cant_reclamo: Math.max(1, Math.min(Number(val), p.cant_comprada))}
        : p
    ))
  }

  // Auto-detectar si es caso crítico al cambiar código
  const onCodigo = v => {
    set('codigo_provisional', v)
    const cod = codigos.find(c => c.codigo === v)
    if (cod) set('es_critico', cod.es_critico)
  }

  // Validar plazo de 6 meses
  const validarFechaCompra = fecha => {
    if (!fecha) return "Requerido"
    const haceSeisM = new Date(); haceSeisM.setMonth(haceSeisM.getMonth() - 6)
    if (new Date(fecha) < haceSeisM) return "La compra supera los 6 meses — caso no aceptado directamente"
    if (new Date(fecha) > new Date()) return "Fecha no puede ser futura"
    return ""
  }

  const validar = () => {
    const e = {}
    if (!f.sucursal)       e.sucursal       = "Requerido"
    if (!f.canal_ingreso)  e.canal_ingreso  = "Requerido"
    if (!f.cliente_nombre.trim()) e.cliente_nombre = "Requerido"
    if (!f.cliente_rut.trim()) e.cliente_rut = "Requerido"
    else if (!validaRut(f.cliente_rut)) e.cliente_rut = "RUT inválido — verifica el dígito verificador"
    if (!f.doc_tipo)       e.doc_tipo       = "Requerido"
    if (!f.doc_numero.trim()) e.doc_numero  = "Requerido"
    const errFecha = validarFechaCompra(f.doc_fecha)
    if (errFecha) e.doc_fecha = errFecha
    if (!f.doc_monto || isNaN(Number(f.doc_monto)) || Number(f.doc_monto) <= 0)
      e.doc_monto = "Monto inválido"
    if (!f.motivo_cliente.trim()) e.motivo_cliente = "Requerido"
    if (!f.codigo_provisional)    e.codigo_provisional = "Debes seleccionar un código de clasificación"
    return e
  }

  const guardar = async () => {
    const e = validar()
    if (Object.keys(e).length > 0) { setErrs(e); return }

    const now    = new Date()
    const id     = uid()
    const numero = "PV-" + now.getFullYear() + "-" + Date.now().toString().slice(-5)
    // Hora en formato HH:MM 24h — evita "p. m." de algunos locales
    const horaRec = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0')
    // Fecha en YYYY-MM-DD — no usar toLocaleDateString (varía por SO/locale)
    const fechaRec = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`

    // Normalizar doc_fecha a YYYY-MM-DD independiente del formato de entrada
    const normalizarFecha = (fecha) => {
      if (!fecha) return null
      // Ya es YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha
      // DD-MM-YYYY o DD/MM/YYYY
      const m = fecha.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
      if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
      // Intentar parsear como Date
      const d = new Date(fecha)
      if (!isNaN(d)) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      return null
    }

    const docFechaNorm = normalizarFecha(f.doc_fecha)

    const codInfo = codigos.find(c => c.codigo === f.codigo_provisional)
    const requiereForm2 = codInfo?.requiere_form2 || false
    const esCritico     = codInfo?.es_critico || false

    const { error } = await supabase.from('casos_postventa').insert({
      id,
      numero,
      sucursal:          f.sucursal,
      canal_ingreso:     f.canal_ingreso,
      cliente_nombre:    f.cliente_nombre.trim(),
      cliente_rut:       fmtRut(f.cliente_rut),
      cliente_telefono:  f.cliente_telefono.trim() || null,
      cliente_email:     f.cliente_email.trim() || null,
      cliente_tipo:      f.cliente_tipo,
      doc_tipo:          f.doc_tipo,
      doc_numero:        f.doc_numero.trim(),
      doc_fecha:         docFechaNorm,
      doc_monto:         Number(f.doc_monto),
      motivo_cliente:    f.motivo_cliente.trim(),
      codigo_provisional: f.codigo_provisional || null,
      estado:            esCritico ? 'escalado' :
                         requiereForm2 ? 'en_validacion_tecnica' : 'abierto',
      requiere_form2:    requiereForm2,
      es_critico:        esCritico,
      ejecutivo_id:      cu.id,
      ejecutivo_nombre:  cu.nombre,
      vendedor_bsale:    docSelInfo?.vendedor_nombre || null,
      hora_recepcion:    horaRec,
      fecha_recepcion:   fechaRec,
      notas: prodsSel.length > 0
        ? "Productos en reclamo: " + prodsSel.map(p =>
            `${p.nombre} (SKU: ${p.sku}) — cant. reclamada: ${p.cant_reclamo} de ${p.cant_comprada}`
          ).join(" | ")
        : null,
    })

    if (error) {
      alert("Error al guardar: " + error.message)
      setSaving(false)
      return
    }

    // Registrar evento
    await supabase.from('caso_eventos').insert({
      caso_id:        id,
      evento:         'creado',
      estado_nuevo:   esCritico ? 'escalado' : requiereForm2 ? 'en_validacion_tecnica' : 'abierto',
      detalle:        `Caso creado por ${cu.nombre} · Canal: ${f.canal_ingreso}`,
      usuario_id:     cu.id,
      usuario_nombre: cu.nombre,
      usuario_rol:    cu.rol,
    })

    // ── Email: notificar creación del caso ──
    // Al ejecutivo que lo creó + operaciones si requiere form2 + jefatura si es crítico
    const destEmails = [{ email: cu.correo || cu.email, nombre: cu.nombre }]
      .filter(d => d.email)
    if (requiereForm2) {
      getEmailsParaEvento('caso_creado', ['operaciones','postventa','admin']).then(ops => {
        const todos = [...destEmails, ...ops.filter(o => o.email !== cu.correo)]
        if (todos.length) sendEmail('caso_creado', {
          id, numero, sucursal: f.sucursal,
          canal_ingreso:       f.canal_ingreso,
          cliente_nombre:      f.cliente_nombre,
          cliente_rut:         fmtRut(f.cliente_rut),
          doc_tipo:            f.doc_tipo,
          doc_numero:          f.doc_numero,
          motivo_cliente:      f.motivo_cliente,
          codigo_provisional:  f.codigo_provisional,
          ejecutivo_nombre:    cu.nombre,
          requiere_form2:      requiereForm2,
          es_critico:          esCritico,
        }, todos)
      })
    } else if (destEmails.length) {
      sendEmail('caso_creado', {
        id, numero, sucursal: f.sucursal,
        canal_ingreso:       f.canal_ingreso,
        cliente_nombre:      f.cliente_nombre,
        cliente_rut:         fmtRut(f.cliente_rut),
        doc_tipo:            f.doc_tipo,
        doc_numero:          f.doc_numero,
        motivo_cliente:      f.motivo_cliente,
        codigo_provisional:  f.codigo_provisional,
        ejecutivo_nombre:    cu.nombre,
        requiere_form2:      false,
        es_critico:          esCritico,
      }, destEmails)
    }

    setSaving(false)
    onCreado()
  }

  const codPorBloque = useMemo(() => {
    const m = {}
    codigos.forEach(c => {
      const bnm = {B1:'Problemas de producto',B2:'Devoluciones y cambios',B3:'Problemas de entrega',B4:'Instalación',B5:'Garantía',B6:'Casos especiales'}
      if (!m[c.bloque]) m[c.bloque] = {nombre:bnm[c.bloque]||c.bloque, items:[]}
      m[c.bloque].items.push(c)
    })
    return Object.entries(m).sort((a,b) => a[0].localeCompare(b[0]))
  }, [codigos])

  const codSelInfo = codigos.find(c => c.codigo === f.codigo_provisional)

  return (
    <Sheet open wide onClose={onClose} title="📋 Nuevo caso — FORM 1 Recepción">
      <Stp steps={["Recepción","Validación","Resolución","Cierre"]} current={0}/>
      <div style={css.divider}/>

      {/* Bloque 1: datos de recepción */}
      <div style={{fontWeight:700, fontSize:14, marginBottom:10}}>📍 Datos de recepción</div>
      <div style={css.row}>
        <div style={css.col}>
          <Fl l="Sucursal" req err={errs.sucursal}>
            <select style={css.select} value={f.sucursal} onChange={e => set('sucursal', e.target.value)}>
              <option value="">Seleccionar...</option>
              <option value="maipu">Maipú</option>
              <option value="la_granja">La Granja</option>
              <option value="los_angeles">Los Ángeles</option>
            </select>
          </Fl>
        </div>
        <div style={css.col}>
          <Fl l="Canal de ingreso" req err={errs.canal_ingreso}>
            <select style={css.select} value={f.canal_ingreso} onChange={e => set('canal_ingreso', e.target.value)}>
              <option value="">Seleccionar...</option>
              <option value="presencial">Presencial</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="mail">Mail</option>
              <option value="rrss">RRSS</option>
              <option value="telefono">Teléfono</option>
              <option value="ecommerce">Ecommerce</option>
              <option value="vambe">Vambe</option>
            </select>
          </Fl>
        </div>
      </div>

      <div style={css.divider}/>

      {/* ── BLOQUE 2: DOCUMENTO ORIGINAL (va primero) ── */}
      <div style={{fontWeight:700, fontSize:14, marginBottom:10}}>🧾 Documento original</div>
      <div style={css.row}>
        <div style={{flex:"0 0 130px"}}>
          <Fl l="Tipo" req err={errs.doc_tipo}>
            <select style={css.select} value={f.doc_tipo}
              onChange={e => set('doc_tipo', e.target.value)}>
              <option value="">Tipo...</option>
              <option value="boleta">Boleta</option>
              <option value="factura">Factura</option>
            </select>
          </Fl>
        </div>
        <div style={css.col}>
          <Fl l="N° documento" req err={errs.doc_numero}>
            <div style={{position:"relative"}}>
              <input style={{...css.input, paddingRight: buscandoDoc ? 40 : 14}}
                value={f.doc_numero}
                onChange={e => { set('doc_numero', e.target.value); setMultiDocs([]) }}
                onBlur={buscarPorNumDoc}
                onKeyDown={e => e.key === "Enter" && buscarPorNumDoc()}
                placeholder="Ej: 12345"/>
              {buscandoDoc && (
                <div style={{
                  position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
                  fontSize:11, color:"#007AFF", fontWeight:600
                }}>🔍</div>
              )}
            </div>
            <div style={{fontSize:10, color:"#8E8E93", marginTop:3}}>
              Ingresa el N° y se busca automáticamente en BSALE
            </div>
          </Fl>
        </div>
        <div style={css.col}>
          <Fl l="Fecha de compra" req err={errs.doc_fecha}>
            <input style={css.input} type="date" value={f.doc_fecha}
              max={hoy()} onChange={e => set('doc_fecha', e.target.value)}/>
          </Fl>
        </div>
        <div style={css.col}>
          <Fl l="Monto ($)" req err={errs.doc_monto}>
            <input style={css.input} type="number" value={f.doc_monto}
              onChange={e => set('doc_monto', e.target.value)}
              placeholder="Se autocompleta" min="1"/>
          </Fl>
        </div>
      </div>

      {/* Alerta / info BSALE para el documento */}
      {bsaleErr && (
        <div style={{
          background: bsaleErr.startsWith('✅') ? "#007AFF10" : "#FF950012",
          border:`1px solid ${bsaleErr.startsWith('✅') ? "#007AFF40" : "#FF950050"}`,
          borderRadius:10, padding:"8px 12px", marginBottom:8,
          fontSize:12, color: bsaleErr.startsWith('✅') ? "#007AFF" : "#FF9500",
          display:"flex", alignItems:"flex-start", gap:6
        }}>
          <span style={{flexShrink:0}}>{bsaleErr.startsWith('✅') ? 'ℹ️' : '⚠️'}</span>
          <span>{bsaleErr.startsWith('✅') ? bsaleErr.slice(2) : bsaleErr}</span>
          {!bsaleErr.startsWith('✅') && (
            <span style={{color:"#8E8E93", marginLeft:4, flexShrink:0}}>— ingresa los datos manualmente</span>
          )}
        </div>
      )}

      {/* Selector: múltiples documentos con el mismo número */}
      {multiDocs.length > 1 && (
        <div style={{
          background:"#007AFF08", border:"1px solid #007AFF30",
          borderRadius:12, padding:"12px 14px", marginBottom:8
        }}>
          <div style={{fontSize:12, fontWeight:700, color:"#007AFF", marginBottom:8}}>
            📄 Se encontraron {multiDocs.length} documentos con el N°{f.doc_numero} — selecciona el que corresponde:
          </div>
          {multiDocs.map((doc, i) => (
            <div key={i} onClick={() => aplicarDoc(doc)} style={{
              display:"flex", alignItems:"center", gap:10,
              padding:"9px 12px", borderRadius:10, marginBottom:5,
              background:"#fff", cursor:"pointer", border:"1px solid #E5E5EA"
            }}>
              <div style={{
                width:38, height:38, borderRadius:9, flexShrink:0,
                background: doc.tipo==='boleta'?"#007AFF15":doc.tipo==='factura'?"#34C75915":"#F2F2F7",
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:18
              }}>
                {doc.tipo==='boleta'?'🧾':doc.tipo==='factura'?'📋':'🎫'}
              </div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontWeight:700, fontSize:13}}>
                  {(doc.tipo_nombre || doc.tipo).toUpperCase()} N°{doc.numero}
                </div>
                <div style={{fontSize:11, color:"#8E8E93", marginTop:1}}>
                  {doc.fecha}
                  {doc.sucursal_nombre ? ` · ${doc.sucursal_nombre}` : ""}
                  {doc.vendedor_nombre ? ` · ${doc.vendedor_nombre}` : ""}
                  {doc.sin_cliente ? " · Sin cliente registrado" : ""}
                  {doc.cliente_nombre ? ` · ${doc.cliente_nombre}` : ""}
                </div>
              </div>
              <div style={{textAlign:"right", flexShrink:0}}>
                <div style={{fontSize:13, fontWeight:800}}>{fmt(doc.monto)}</div>
                <div style={{fontSize:10, color:"#007AFF", fontWeight:600, marginTop:2}}>Seleccionar →</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmación documento seleccionado */}
      {docSelInfo && !multiDocs.length && (
        <div style={{
          background:"#34C75910", border:"1px solid #34C75940",
          borderRadius:10, padding:"8px 14px", marginBottom:4,
          display:"flex", gap:8, alignItems:"center", fontSize:12
        }}>
          <span>✅</span>
          <div>
            <span style={{fontWeight:700}}>
              {(docSelInfo.tipo_nombre || docSelInfo.tipo).toUpperCase()} N°{docSelInfo.numero}
            </span>
            <span style={{color:"#8E8E93", marginLeft:8}}>
              {docSelInfo.fecha} · {fmt(docSelInfo.monto)}
              {docSelInfo.sucursal_nombre ? ` · ${docSelInfo.sucursal_nombre}` : ""}
              {docSelInfo.vendedor_nombre ? ` · Vendedor: ${docSelInfo.vendedor_nombre}` : ""}
            </span>
          </div>
        </div>
      )}

      <div style={css.divider}/>

      {/* ── BLOQUE 3: DATOS DEL CLIENTE (después del documento) ── */}
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
        <div style={{fontWeight:700, fontSize:14}}>👤 Datos del cliente</div>
        {docSelInfo && bsaleOk && (
          <Bd c="#34C759" bg="#34C75915">✅ Cliente vinculado</Bd>
        )}
      </div>

      {/* RUT — búsqueda independiente, NO toca campos del documento */}
      <div style={css.row}>
        <div style={css.col}>
          <Fl l="RUT" req err={errs.cliente_rut}>
            <div style={{position:"relative"}}>
              <input style={{...css.input, paddingRight: buscandoRut ? 40 : 14}}
                value={f.cliente_rut}
                onChange={e => { set('cliente_rut', e.target.value); setDocsCliente([]) }}
                onBlur={buscarPorRut}
                onKeyDown={e => e.key === "Enter" && buscarPorRut()}
                placeholder="12.345.678-9"/>
              {buscandoRut && (
                <div style={{position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
                  fontSize:11, color:"#007AFF", fontWeight:600}}>🔍</div>
              )}
            </div>
            <div style={{fontSize:10, color:"#8E8E93", marginTop:3}}>
              Al ingresar el RUT se busca el cliente en BSALE
            </div>
          </Fl>
        </div>
        <div style={{...css.col, flex:2}}>
          <Fl l="Nombre completo" req err={errs.cliente_nombre}>
            <input style={css.input} value={f.cliente_nombre}
              onChange={e => set('cliente_nombre', e.target.value)}
              placeholder={buscandoRut ? "Buscando en BSALE..." : "Se autocompleta o ingresa manualmente"}/>
          </Fl>
        </div>
      </div>

      <div style={css.row}>
        <div style={css.col}>
          <Fl l="Teléfono" err={errs.cliente_telefono}>
            <input style={css.input} value={f.cliente_telefono}
              onChange={e => set('cliente_telefono', e.target.value)} placeholder="+56 9 XXXX XXXX"/>
          </Fl>
        </div>
        <div style={css.col}>
          <Fl l="Email" err={errs.cliente_email}>
            <input style={css.input} value={f.cliente_email}
              onChange={e => set('cliente_email', e.target.value)} placeholder="correo@cliente.cl"/>
          </Fl>
        </div>
        <div style={{flex:"0 0 140px"}}>
          <Fl l="Tipo de cliente">
            <select style={css.select} value={f.cliente_tipo}
              onChange={e => set('cliente_tipo', e.target.value)}>
              <option value="persona">Persona natural</option>
              <option value="b2b">B2B / Empresa</option>
            </select>
          </Fl>
        </div>
      </div>

      {/* Boletas del cliente desde BSALE — para vincular o cambiar documento */}
      {docsCliente.length > 0 && (
        <div style={{
          background:"#AF52DE10", border:"1px solid #AF52DE30",
          borderRadius:12, padding:"12px 14px", marginBottom:8
        }}>
          <div style={{fontSize:12, fontWeight:700, color:"#AF52DE", marginBottom:8}}>
            🛍️ {docsCliente.length} compra{docsCliente.length!==1?'s':''} del cliente en BSALE
            {docSelInfo ? " — puedes cambiar el documento si corresponde:" : " — selecciona para vincular al caso:"}
          </div>
          {docsCliente.slice(0,5).map((doc, i) => (
            <div key={i} onClick={() => aplicarDoc(doc)} style={{
              display:"flex", alignItems:"center", gap:10,
              padding:"8px 10px", borderRadius:9, marginBottom:4,
              background: docSelInfo?.bsale_id === doc.bsale_id ? "#007AFF08" : "#fff",
              cursor:"pointer",
              border:`1px solid ${docSelInfo?.bsale_id === doc.bsale_id ? "#007AFF" : "#E5E5EA"}`
            }}>
              <div style={{
                width:36, height:36, borderRadius:8, flexShrink:0,
                background: doc.tipo==='boleta'?"#007AFF15":"#34C75915",
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:16
              }}>
                {doc.tipo==='boleta'?'🧾':'📋'}
              </div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontWeight:700, fontSize:13}}>
                  {doc.tipo.toUpperCase()} N°{doc.numero}
                </div>
                <div style={{fontSize:11, color:"#8E8E93"}}>
                  {doc.fecha} · {doc.sucursal_nombre||"—"} · {doc.vendedor_nombre||"—"}
                </div>
              </div>
              <div style={{textAlign:"right", flexShrink:0}}>
                <div style={{fontSize:13, fontWeight:700}}>{fmt(doc.monto)}</div>
                <div style={{fontSize:10, fontWeight:600, color: docSelInfo?.bsale_id===doc.bsale_id ? "#34C759" : "#007AFF"}}>
                  {docSelInfo?.bsale_id===doc.bsale_id ? "✅ Seleccionado" : docSelInfo ? "Cambiar →" : "Vincular →"}
                </div>
              </div>
            </div>
          ))}
          {docsCliente.length > 5 && (
            <div style={{fontSize:11, color:"#8E8E93", textAlign:"center", marginTop:4}}>
              +{docsCliente.length - 5} compras más
            </div>
          )}
        </div>
      )}

      <div style={css.divider}/>

      {/* ── BLOQUE 4: PRODUCTOS DE LA BOLETA ── */}
      {(cargandoLineas || lineasDoc.length > 0 || docSelInfo) && (
        <div style={{marginBottom:10}}>
          <div style={css.divider}/>
          <div style={{
            display:"flex", justifyContent:"space-between",
            alignItems:"center", marginBottom:10
          }}>
            <div style={{fontWeight:700, fontSize:14}}>🛒 Productos de la boleta</div>
            {prodsSel.length > 0 && (
              <Bd c="#007AFF" bg="#007AFF15">
                {prodsSel.length} producto{prodsSel.length!==1?'s':''} seleccionado{prodsSel.length!==1?'s':''}
              </Bd>
            )}
          </div>

          {cargandoLineas ? (
            <div style={{
              background:"#F2F2F7", borderRadius:12, padding:"16px",
              textAlign:"center", color:"#8E8E93", fontSize:13
            }}>
              🔍 Cargando productos desde BSALE...
            </div>
          ) : lineasDoc.length === 0 ? (
            <div style={{
              background:"#F2F2F7", borderRadius:12, padding:"12px 14px",
              fontSize:12, color:"#8E8E93"
            }}>
              Sin productos disponibles para este documento
            </div>
          ) : (
            <div style={{
              border:"1px solid #E5E5EA", borderRadius:14, overflow:"hidden"
            }}>
              {/* Header tabla */}
              <div style={{
                display:"grid",
                gridTemplateColumns:"32px 1fr 90px 80px 100px 80px",
                gap:8, padding:"8px 12px",
                background:"#F7F7F8",
                fontSize:10, fontWeight:700, color:"#8E8E93",
                textTransform:"uppercase", letterSpacing:"0.04em"
              }}>
                <div/>
                <div>Producto</div>
                <div style={{textAlign:"center"}}>SKU</div>
                <div style={{textAlign:"center"}}>Comprado</div>
                <div style={{textAlign:"center"}}>A reclamar</div>
                <div style={{textAlign:"right"}}>P. unit.</div>
              </div>

              {/* Filas */}
              {lineasDoc.map((linea, i) => {
                const selec = prodsSel.find(p => p.sku === linea.sku)
                return (
                  <div key={i} onClick={() => toggleProd(linea)} style={{
                    display:"grid",
                    gridTemplateColumns:"32px 1fr 90px 80px 100px 80px",
                    gap:8, padding:"10px 12px",
                    borderTop:"1px solid #F2F2F7",
                    background: selec ? "#007AFF08" : "#fff",
                    cursor:"pointer",
                    transition:"background 0.1s"
                  }}>
                    {/* Checkbox */}
                    <div style={{display:"flex", alignItems:"center", justifyContent:"center"}}>
                      <div style={{
                        width:18, height:18, borderRadius:5,
                        border:`2px solid ${selec ? "#007AFF" : "#C7C7CC"}`,
                        background: selec ? "#007AFF" : "#fff",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        flexShrink:0
                      }}>
                        {selec && <span style={{color:"#fff", fontSize:11, fontWeight:800}}>✓</span>}
                      </div>
                    </div>

                    {/* Nombre */}
                    <div style={{
                      fontSize:12, fontWeight: selec?700:500,
                      color: selec?"#007AFF":"#1C1C1E",
                      display:"flex", alignItems:"center"
                    }}>
                      {linea.nombre}
                    </div>

                    {/* SKU */}
                    <div style={{
                      display:"flex", alignItems:"center", justifyContent:"center"
                    }}>
                      <Bd c="#8E8E93" bg="#F2F2F7">{linea.sku}</Bd>
                    </div>

                    {/* Cantidad comprada */}
                    <div style={{
                      fontSize:13, fontWeight:600, textAlign:"center",
                      display:"flex", alignItems:"center", justifyContent:"center"
                    }}>
                      {linea.cantidad}
                    </div>

                    {/* Cantidad a reclamar — solo si seleccionado */}
                    <div style={{
                      display:"flex", alignItems:"center", justifyContent:"center"
                    }} onClick={e => e.stopPropagation()}>
                      {selec ? (
                        <div style={{display:"flex", alignItems:"center", gap:4}}>
                          <button onClick={() => setCantReclamo(linea.sku, selec.cant_reclamo - 1)}
                            style={{
                              width:22, height:22, borderRadius:6, border:"1px solid #E5E5EA",
                              background:"#F2F2F7", cursor:"pointer", fontSize:14,
                              display:"flex", alignItems:"center", justifyContent:"center",
                              fontWeight:700, color:"#1C1C1E"
                            }}>−</button>
                          <span style={{
                            minWidth:24, textAlign:"center",
                            fontSize:13, fontWeight:800, color:"#007AFF"
                          }}>{selec.cant_reclamo}</span>
                          <button onClick={() => setCantReclamo(linea.sku, selec.cant_reclamo + 1)}
                            style={{
                              width:22, height:22, borderRadius:6, border:"1px solid #E5E5EA",
                              background:"#F2F2F7", cursor:"pointer", fontSize:14,
                              display:"flex", alignItems:"center", justifyContent:"center",
                              fontWeight:700, color:"#1C1C1E"
                            }}>+</button>
                        </div>
                      ) : (
                        <span style={{fontSize:11, color:"#C7C7CC"}}>—</span>
                      )}
                    </div>

                    {/* Precio unitario */}
                    <div style={{
                      fontSize:12, color:"#8E8E93", textAlign:"right",
                      display:"flex", alignItems:"center", justifyContent:"flex-end"
                    }}>
                      {fmt(linea.precio_unit)}
                    </div>
                  </div>
                )
              })}

              {/* Footer — resumen seleccionados */}
              {prodsSel.length > 0 && (
                <div style={{
                  background:"#007AFF10", borderTop:"1px solid #007AFF30",
                  padding:"10px 14px"
                }}>
                  <div style={{fontSize:11, fontWeight:700, color:"#007AFF", marginBottom:4}}>
                    Productos seleccionados para el reclamo:
                  </div>
                  {prodsSel.map(p => (
                    <div key={p.sku} style={{
                      fontSize:12, color:"#1C1C1E", display:"flex",
                      justifyContent:"space-between", marginBottom:2
                    }}>
                      <span>• {p.nombre}</span>
                      <span style={{color:"#007AFF", fontWeight:700}}>
                        {p.cant_reclamo} de {p.cant_comprada} unid.
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bloque 4: motivo y clasificación */}
      <div style={{fontWeight:700, fontSize:14, marginBottom:10}}>🏷️ Motivo y clasificación</div>
      <Fl l="Motivo expresado por el cliente" req err={errs.motivo_cliente}>
        <textarea style={css.textarea} value={f.motivo_cliente}
          onChange={e => set('motivo_cliente', e.target.value)}
          placeholder="Describe con las palabras del cliente qué pasó..."/>
      </Fl>

      <Fl l="Código provisional (Matriz V2.0)" req err={errs.codigo_provisional}>
        <select style={{...css.select, borderColor: errs.codigo_provisional ? "#FF3B30" : undefined}}
          value={f.codigo_provisional} onChange={e => onCodigo(e.target.value)}>
          <option value="">Seleccionar código...</option>
          {codPorBloque.map(([bl, {nombre, items}]) => (
            <optgroup key={bl} label={`${bl} — ${nombre}`}>
              {items.map(c => (
                <option key={c.codigo} value={c.codigo}>
                  {c.codigo} · {c.descripcion}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Fl>

      {/* Info del código seleccionado */}
      {codSelInfo && (
        <div style={{
          ...css.cardSm, marginBottom:12,
          borderLeft:`3px solid ${codSelInfo.es_critico ? "#FF3B30" : "#007AFF"}`,
          background: codSelInfo.es_critico ? "#FF3B3008" : "#007AFF08"
        }}>
          {codSelInfo.es_critico && (
            <div style={{color:"#FF3B30", fontWeight:700, fontSize:12, marginBottom:4}}>
              ⚠️ CASO CRÍTICO — Se escalará automáticamente al guardar
            </div>
          )}
          <div style={{fontSize:12, color:"#3C3C43"}}>
            <strong>Responsable:</strong> {codSelInfo.responsable} ·
            <strong> Resolución típica:</strong> {codSelInfo.resolucion_tipica} ·
            <strong> Requiere validación técnica:</strong> {codSelInfo.requiere_form2 ? "Sí" : "No"}
          </div>
        </div>
      )}

      {/* Acciones */}
      <div style={{display:"flex", gap:10, marginTop:8}}>
        <Bt variant="secondary" fw onClick={onClose}>Cancelar</Bt>
        <Bt fw loading={saving} onClick={guardar}>
          {f.es_critico ? "🔴 Guardar y escalar" : "Guardar caso"}
        </Bt>
      </div>
    </Sheet>
  )
}

// ─── MÓDULO USUARIOS ─────────────────────────────────────────────────────
const ModuloUsuarios = ({users, cu, onRefresh}) => {
  const [sel,      setSel]      = useState(null)   // usuario seleccionado para editar
  const [modalNew, setModalNew] = useState(false)
  const [busq,     setBusq]     = useState("")

  const fil = useMemo(() =>
    users.filter(u =>
      !busq ||
      u.nombre?.toLowerCase().includes(busq.toLowerCase()) ||
      u.correo?.toLowerCase().includes(busq.toLowerCase()) ||
      u.rol?.toLowerCase().includes(busq.toLowerCase())
    ).sort((a,b) => a.nombre?.localeCompare(b.nombre))
  , [users, busq])

  const toggleActivo = async (u) => {
    if (u.id === cu.id) { alert("No puedes desactivar tu propia cuenta"); return }
    await supabase.from('usuarios').update({activo: !u.activo}).eq('id', u.id)
    onRefresh()
  }

  return (
    <div>
      {/* Header */}
      <div style={{
        background:"linear-gradient(135deg, #1a1a2e 0%, #1a1a3e 100%)",
        borderRadius:20, padding:"18px 22px", marginBottom:12, color:"#fff"
      }}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div>
            <div style={{fontSize:18, fontWeight:800, letterSpacing:"-0.02em"}}>👥 Gestión de usuarios</div>
            <div style={{color:"rgba(255,255,255,0.5)", fontSize:12, marginTop:2}}>
              {users.filter(u=>u.activo).length} activos · {users.filter(u=>!u.activo).length} inactivos
            </div>
          </div>
          <Bt onClick={() => setModalNew(true)}>+ Nuevo usuario</Bt>
        </div>
      </div>

      {/* Filtro */}
      <div style={{...css.card, padding:"12px 14px", marginBottom:10}}>
        <input style={{...css.input, margin:0}}
          placeholder="🔍 Buscar por nombre, correo o rol..."
          value={busq} onChange={e => setBusq(e.target.value)}/>
      </div>

      {/* Tarjetas de roles — resumen visual */}
      <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:8, marginBottom:12}}>
        {ROLES.map(r => {
          const cnt = users.filter(u => u.rol === r.k && u.activo).length
          return (
            <div key={r.k} style={{
              background:"#fff", borderRadius:14, padding:"12px 14px",
              borderLeft:`3px solid ${r.c}`, boxShadow:"0 1px 3px rgba(0,0,0,0.06)"
            }}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <Bd c={r.c} bg={r.c+"18"}>{r.l}</Bd>
                <span style={{fontSize:20, fontWeight:800, color:r.c}}>{cnt}</span>
              </div>
              <div style={{fontSize:10, color:"#8E8E93", marginTop:5, lineHeight:1.4}}>{r.desc}</div>
            </div>
          )
        })}
      </div>

      {/* Lista de usuarios */}
      {fil.map(u => {
        const rd = rl(u)
        return (
          <div key={u.id} style={{
            ...css.card,
            borderLeft:`3px solid ${u.activo ? rd.c : "#E5E5EA"}`,
            opacity: u.activo ? 1 : 0.6
          }}>
            <div style={{display:"flex", alignItems:"center", gap:12}}>
              <Av nombre={u.nombre} color={u.activo ? rd.c : "#C7C7CC"} size={44}/>
              <div style={{flex:1, minWidth:0}}>
                <div style={{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
                  <span style={{fontWeight:700, fontSize:15}}>{u.nombre}</span>
                  <Bd c={rd.c} bg={rd.c+"18"}>{rd.l}</Bd>
                  {!u.activo && <Bd c="#8E8E93" bg="#8E8E9315">Inactivo</Bd>}
                  {!u.password_hash && <Bd c="#FF9500" bg="#FF950015">⚠️ Sin contraseña</Bd>}
                </div>
                <div style={{fontSize:12, color:"#8E8E93", marginTop:3}}>
                  {u.correo}
                  {u.sucursal && u.sucursal !== 'todas' &&
                    <span> · 📍 {u.sucursal.replace('_',' ')}</span>}
                  {u.ultimo_acceso &&
                    <span> · Último acceso: {new Date(u.ultimo_acceso).toLocaleDateString('es-CL')}</span>}
                </div>
                {/* Permisos del rol en chips pequeños */}
                <div style={{display:"flex", gap:4, flexWrap:"wrap", marginTop:6}}>
                  {rd.p.includes("todo")
                    ? <Bd c="#FF3B30" bg="#FF3B3015">🔑 Acceso total</Bd>
                    : rd.p.slice(0,5).map(p => {
                        const pl = PERMS_LABELS[p]
                        return pl ? (
                          <Bd key={p} c="#3C3C43" bg="#F2F2F7">{pl.ic} {pl.l}</Bd>
                        ) : null
                      })
                  }
                  {!rd.p.includes("todo") && rd.p.length > 5 &&
                    <Bd c="#8E8E93" bg="#F2F2F7">+{rd.p.length-5} más</Bd>}
                </div>
              </div>
              <div style={{display:"flex", gap:8, flexShrink:0}}>
                <Bt sm variant="secondary" onClick={() => setSel(u)}>Editar</Bt>
                <Bt sm variant={u.activo ? "danger" : "success"}
                  onClick={() => toggleActivo(u)}>
                  {u.activo ? "Desactivar" : "Activar"}
                </Bt>
              </div>
            </div>
          </div>
        )
      })}

      {fil.length === 0 && (
        <div style={{...css.card, textAlign:"center", color:"#8E8E93", padding:"32px"}}>
          Sin resultados para "{busq}"
        </div>
      )}

      {/* Modal nuevo / editar */}
      {(modalNew || sel) && (
        <FormUsuario
          usuario={sel}
          cu={cu}
          onClose={() => { setModalNew(false); setSel(null) }}
          onGuardado={() => { setModalNew(false); setSel(null); onRefresh() }}
        />
      )}
    </div>
  )
}

// ─── FORM USUARIO (crear / editar) ───────────────────────────────────────
const FormUsuario = ({usuario, cu, onClose, onGuardado}) => {
  const esNuevo = !usuario
  const [saving, setSaving] = useState(false)
  const [errs,   setErrs]   = useState({})
  const [tab,    setTab]    = useState('datos')  // 'datos' | 'permisos'

  const [f, setF] = useState({
    nombre:    usuario?.nombre    || "",
    correo:    usuario?.correo    || "",
    telefono:  usuario?.telefono  || "",
    rol:       usuario?.rol       || "postventa",
    sucursal:  usuario?.sucursal  || "todas",
    activo:    usuario?.activo    ?? true,
    password:  "",
    password2: "",
  })
  const set = (k, v) => { setF(p => ({...p, [k]:v})); setErrs(p => ({...p, [k]:""})) }

  const rolInfo = ROLES.find(r => r.k === f.rol)

  const validar = () => {
    const e = {}
    if (!f.nombre.trim())  e.nombre  = "Requerido"
    if (!f.correo.trim())  e.correo  = "Requerido"
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.correo)) e.correo = "Correo inválido"
    if (esNuevo && !f.password)     e.password  = "Debes asignar una contraseña inicial"
    if (f.password && f.password.length < 6) e.password = "Mínimo 6 caracteres"
    if (f.password && f.password !== f.password2) e.password2 = "Las contraseñas no coinciden"
    return e
  }

  const guardar = async () => {
    const e = validar()
    if (Object.keys(e).length > 0) { setErrs(e); return }
    setSaving(true)

    let hash = usuario?.password_hash || null
    if (f.password) {
      hash = await bcrypt.hash(f.password, 10)
    }

    const payload = {
      nombre:    f.nombre.trim(),
      correo:    f.correo.trim().toLowerCase(),
      telefono:  f.telefono.trim() || null,
      rol:       f.rol,
      sucursal:  f.sucursal,
      activo:    f.activo,
      password_hash: hash,
    }

    if (esNuevo) {
      const { error } = await supabase.from('usuarios').insert({
        id: "u"+Date.now().toString(36),
        ...payload
      })
      if (error) { alert("Error: "+error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('usuarios').update(payload).eq('id', usuario.id)
      if (error) { alert("Error: "+error.message); setSaving(false); return }
    }

    setSaving(false)
    onGuardado()
  }

  return (
    <Sheet open wide onClose={onClose}
      title={esNuevo ? "➕ Nuevo usuario" : `✏️ Editar — ${usuario.nombre}`}>

      {/* Tabs internos */}
      <div style={{display:"flex", gap:4, marginBottom:16}}>
        {[{k:'datos',l:'Datos y acceso',ic:'👤'},{k:'permisos',l:'Facultades del rol',ic:'🔑'}].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding:"7px 14px", borderRadius:10, border:"none", cursor:"pointer",
            fontFamily:FONT, fontSize:13, fontWeight:600,
            background: tab===t.k ? "#1C1C1E" : "#F2F2F7",
            color:       tab===t.k ? "#fff"    : "#8E8E93",
          }}>{t.ic} {t.l}</button>
        ))}
      </div>

      {/* ── Tab: Datos ── */}
      {tab === 'datos' && (
        <div>
          <div style={{fontWeight:700, fontSize:13, color:"#3C3C43", marginBottom:10}}>Información personal</div>
          <div style={css.row}>
            <div style={{...css.col, flex:2}}>
              <Fl l="Nombre completo" req err={errs.nombre}>
                <input style={css.input} value={f.nombre}
                  onChange={e => set('nombre', e.target.value)} placeholder="María González"/>
              </Fl>
            </div>
            <div style={css.col}>
              <Fl l="Teléfono">
                <input style={css.input} value={f.telefono}
                  onChange={e => set('telefono', e.target.value)} placeholder="+56 9 XXXX XXXX"/>
              </Fl>
            </div>
          </div>

          <Fl l="Correo corporativo" req err={errs.correo}>
            <input style={css.input} type="email" value={f.correo}
              onChange={e => set('correo', e.target.value)}
              placeholder="usuario@outletdepuertas.cl"
              disabled={!esNuevo}/>
            {!esNuevo && <div style={{fontSize:11,color:"#8E8E93",marginTop:3}}>
              El correo no se puede cambiar después de creado
            </div>}
          </Fl>

          <div style={css.divider}/>
          <div style={{fontWeight:700, fontSize:13, color:"#3C3C43", marginBottom:10}}>Rol y acceso</div>

          <div style={css.row}>
            <div style={css.col}>
              <Fl l="Rol" req>
                <select style={css.select} value={f.rol} onChange={e => set('rol', e.target.value)}>
                  {ROLES.map(r => (
                    <option key={r.k} value={r.k}>{r.l}</option>
                  ))}
                </select>
              </Fl>
            </div>
            <div style={css.col}>
              <Fl l="Sucursal asignada">
                <select style={css.select} value={f.sucursal} onChange={e => set('sucursal', e.target.value)}>
                  <option value="todas">Todas las sucursales</option>
                  <option value="maipu">Maipú</option>
                  <option value="la_granja">La Granja</option>
                  <option value="los_angeles">Los Ángeles</option>
                </select>
              </Fl>
            </div>
            <div style={{flex:"0 0 120px"}}>
              <Fl l="Estado">
                <select style={css.select} value={f.activo ? "1" : "0"}
                  onChange={e => set('activo', e.target.value === "1")}>
                  <option value="1">✅ Activo</option>
                  <option value="0">⛔ Inactivo</option>
                </select>
              </Fl>
            </div>
          </div>

          {/* Descripción del rol seleccionado */}
          {rolInfo && (
            <div style={{
              background: rolInfo.c+"10", border:`1px solid ${rolInfo.c}30`,
              borderRadius:12, padding:"10px 14px", marginBottom:12
            }}>
              <div style={{fontSize:12, fontWeight:700, color:rolInfo.c, marginBottom:3}}>
                {rolInfo.l} — ¿qué puede hacer?
              </div>
              <div style={{fontSize:12, color:"#3C3C43"}}>{rolInfo.desc}</div>
            </div>
          )}

          <div style={css.divider}/>
          <div style={{fontWeight:700, fontSize:13, color:"#3C3C43", marginBottom:4}}>
            {esNuevo ? "Contraseña inicial" : "Cambiar contraseña"}
            {!esNuevo && <span style={{fontSize:11, fontWeight:400, color:"#8E8E93"}}> (dejar vacío para no cambiar)</span>}
          </div>

          <div style={css.row}>
            <div style={css.col}>
              <Fl l={esNuevo ? "Contraseña" : "Nueva contraseña"} req={esNuevo} err={errs.password}>
                <input style={css.input} type="password" value={f.password}
                  onChange={e => set('password', e.target.value)}
                  placeholder={esNuevo ? "Mínimo 6 caracteres" : "Dejar vacío para no cambiar"}/>
              </Fl>
            </div>
            <div style={css.col}>
              <Fl l="Confirmar contraseña" req={esNuevo} err={errs.password2}>
                <input style={css.input} type="password" value={f.password2}
                  onChange={e => set('password2', e.target.value)}
                  placeholder="Repetir contraseña"/>
              </Fl>
            </div>
          </div>

          {f.password && (
            <div style={{marginBottom:12}}>
              <div style={{fontSize:11, color:"#8E8E93", marginBottom:4}}>Seguridad de la contraseña:</div>
              {[
                {l:"Mínimo 6 caracteres", ok: f.password.length >= 6},
                {l:"Tiene letras y números", ok: /[a-zA-Z]/.test(f.password) && /[0-9]/.test(f.password)},
                {l:"Las contraseñas coinciden", ok: f.password === f.password2 && f.password2.length > 0},
              ].map(c => (
                <div key={c.l} style={{fontSize:11, color: c.ok ? "#34C759":"#FF3B30", display:"flex", gap:4, marginBottom:2}}>
                  {c.ok ? "✅" : "❌"} {c.l}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Permisos del rol ── */}
      {tab === 'permisos' && (
        <div>
          <div style={{
            background:"#F2F2F7", borderRadius:12, padding:"10px 14px", marginBottom:14,
            fontSize:12, color:"#3C3C43"
          }}>
            Los permisos son fijos por rol. Para cambiar las facultades de un usuario,
            cambia su rol en la pestaña "Datos y acceso".
          </div>

          {/* Agrupar permisos por categoría */}
          {Object.entries(
            Object.entries(PERMS_LABELS).reduce((acc, [k, v]) => {
              if (!acc[v.g]) acc[v.g] = []
              acc[v.g].push({k, ...v})
              return acc
            }, {})
          ).map(([grupo, perms]) => (
            <div key={grupo} style={{marginBottom:14}}>
              <div style={{fontSize:11, fontWeight:700, color:"#8E8E93",
                textTransform:"uppercase", letterSpacing:"0.04em", marginBottom:8}}>
                {grupo}
              </div>
              <div style={{display:"flex", flexDirection:"column", gap:4}}>
                {perms.map(p => {
                  const tienePermiso = rolInfo?.p.includes("todo") || rolInfo?.p.includes(p.k)
                  return (
                    <div key={p.k} style={{
                      display:"flex", alignItems:"center", gap:10,
                      padding:"8px 12px", borderRadius:10,
                      background: tienePermiso ? "#34C75910" : "#F2F2F7",
                      border: `1px solid ${tienePermiso ? "#34C75940" : "#E5E5EA"}`
                    }}>
                      <span style={{fontSize:16}}>{p.ic}</span>
                      <span style={{flex:1, fontSize:13, fontWeight: tienePermiso ? 600 : 400,
                        color: tienePermiso ? "#1C1C1E" : "#8E8E93"}}>
                        {p.l}
                      </span>
                      <span style={{
                        fontSize:11, fontWeight:700,
                        color: tienePermiso ? "#34C759" : "#C7C7CC"
                      }}>{tienePermiso ? "✅ Permitido" : "❌ Sin acceso"}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Comparativa de todos los roles */}
          <div style={css.divider}/>
          <div style={{fontWeight:700, fontSize:13, marginBottom:10}}>Comparativa entre roles</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%", borderCollapse:"collapse", fontSize:11}}>
              <thead>
                <tr>
                  <th style={{textAlign:"left", padding:"6px 8px", color:"#8E8E93", fontWeight:600}}>Permiso</th>
                  {ROLES.map(r => (
                    <th key={r.k} style={{
                      padding:"6px 8px", textAlign:"center",
                      color: r.k === f.rol ? r.c : "#8E8E93",
                      fontWeight: r.k === f.rol ? 700 : 500
                    }}>{r.l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(PERMS_LABELS).map(([pk, pv]) => (
                  <tr key={pk} style={{borderTop:"1px solid #F2F2F7"}}>
                    <td style={{padding:"5px 8px", fontSize:11}}>
                      {pv.ic} {pv.l}
                    </td>
                    {ROLES.map(r => {
                      const tiene = r.p.includes("todo") || r.p.includes(pk)
                      return (
                        <td key={r.k} style={{
                          textAlign:"center", padding:"5px 8px",
                          background: r.k === f.rol ? r.c+"08" : "transparent"
                        }}>
                          <span style={{color: tiene ? "#34C759" : "#E5E5EA", fontSize:14}}>
                            {tiene ? "●" : "○"}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Acciones */}
      <div style={{display:"flex", gap:10, marginTop:16, paddingTop:14, borderTop:"1px solid #F2F2F7"}}>
        <Bt variant="secondary" fw onClick={onClose}>Cancelar</Bt>
        <Bt fw loading={saving} onClick={guardar}>
          {esNuevo ? "Crear usuario" : "Guardar cambios"}
        </Bt>
      </div>
    </Sheet>
  )
}

// ─── MÓDULO FINANZAS — Transferencias pendientes ──────────────────────────
const ModuloFinanzas = ({casos, cu, onRefresh, onVerCaso}) => {
  const [loading,     setLoading]     = useState(true)
  const [pendientes,  setPendientes]  = useState([])  // {caso, form3}
  const [ejecutados,  setEjecutados]  = useState([])  // {caso, form3, form4}
  const [selCaso,     setSelCaso]     = useState(null)
  const [selForm3,    setSelForm3]    = useState(null)
  const [showF4,      setShowF4]      = useState(false)

  useEffect(() => { cargar() }, [casos])

  const cargar = async () => {
    setLoading(true)
    // Cargar form3 de tipo nc_transfer
    const { data: f3s } = await supabase
      .from('caso_form3_resolucion')
      .select('*')
      .eq('tipo_resolucion','nc_transfer')
      .order('fecha_resolucion', {ascending:false})

    if (!f3s?.length) { setPendientes([]); setEjecutados([]); setLoading(false); return }

    // Cargar form4 existentes
    const casosIds = f3s.map(f => f.caso_id)
    const { data: f4s } = await supabase
      .from('caso_form4_cierre')
      .select('*')
      .in('caso_id', casosIds)

    const f4Map = {}
    ;(f4s||[]).forEach(f => { f4Map[f.caso_id] = f })

    const pend = [], ejec = []
    f3s.forEach(f3 => {
      const caso = casos.find(c => c.id === f3.caso_id)
      if (!caso) return
      const f4 = f4Map[f3.caso_id]
      // transfer_ejecutada no existe en schema actual — se infiere del estado del caso
      if (caso?.estado === 'cerrado' && f4) ejec.push({caso, form3:f3, form4:f4})
      else pend.push({caso, form3:f3})
    })

    setPendientes(pend)
    setEjecutados(ejec)
    setLoading(false)
  }

  const abrirF4 = (item) => {
    setSelCaso(item.caso)
    setSelForm3(item.form3)
    setShowF4(true)
  }

  return (
    <div>
      {/* Header */}
      <div style={{
        background:"linear-gradient(135deg,#1a3a1a,#1a4a1a)",
        borderRadius:20, padding:"18px 22px", marginBottom:12, color:"#fff"
      }}>
        <div style={{fontSize:18, fontWeight:800}}>💸 Estación Finanzas — Transferencias</div>
        <div style={{color:"rgba(255,255,255,0.5)", fontSize:12, marginTop:2}}>
          {pendientes.length} pendiente{pendientes.length!==1?'s':''} ·{" "}
          {ejecutados.length} ejecutada{ejecutados.length!==1?'s':''}
        </div>
      </div>

      {loading ? (
        <Cd><div style={{textAlign:"center",color:"#8E8E93",padding:24}}>Cargando...</div></Cd>
      ) : (
        <>
          {/* Pendientes */}
          {pendientes.length > 0 && (
            <div style={{marginBottom:16}}>
              <div style={{fontWeight:700, fontSize:13, color:"#FF9500", marginBottom:8,
                display:"flex", alignItems:"center", gap:6}}>
                <span style={{background:"#FF9500", color:"#fff", borderRadius:6,
                  padding:"2px 8px", fontSize:11}}>PENDIENTES</span>
                {pendientes.length} transferencia{pendientes.length!==1?'s':''} por ejecutar
              </div>
              {pendientes.map((item, i) => (
                <Cd key={i} ac="#FF9500">
                  <div style={{display:"flex", gap:12, alignItems:"flex-start"}}>
                    <div style={{
                      width:44, height:44, borderRadius:12, flexShrink:0,
                      background:"#34C75915", display:"flex",
                      alignItems:"center", justifyContent:"center", fontSize:22
                    }}>💸</div>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{display:"flex", gap:6, alignItems:"center", marginBottom:3}}>
                        <span style={{fontWeight:800, fontSize:14}}>{item.caso.numero}</span>
                        <Bd c="#FF9500" bg="#FF950015">⏳ Pendiente</Bd>
                      </div>
                      <div style={{fontWeight:600, fontSize:13}}>{item.caso.cliente_nombre}
                        <span style={{color:"#8E8E93", fontWeight:400}}> · {item.caso.cliente_rut}</span>
                      </div>
                      <div style={{
                        background:"#1C1C1E", borderRadius:10,
                        padding:"10px 12px", marginTop:8,
                        display:"grid", gridTemplateColumns:"1fr 1fr 1fr",
                        gap:8, fontSize:11
                      }}>
                        {[
                          {l:"Titular",    v: item.form3.nombre_titular},
                          {l:"Banco",      v: item.form3.banco},
                          {l:"Tipo",       v: item.form3.tipo_cuenta},
                          {l:"N° cuenta",  v: item.form3.num_cuenta},
                          {l:"RUT",        v: item.form3.rut_titular},
                          {l:"Monto",      v: fmt(item.form3.monto)},
                        ].map(d => (
                          <div key={d.l}>
                            <div style={{color:"rgba(255,255,255,0.4)", fontSize:9,
                              textTransform:"uppercase", marginBottom:1}}>{d.l}</div>
                            <div style={{color:"#fff", fontWeight:700,
                              fontSize: d.l==="Monto"?14:12,
                              color: d.l==="Monto"?"#34C759":"#fff"}}>{d.v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{fontSize:11, color:"#8E8E93", marginTop:4}}>
                        NC BSALE N°{item.form3.bsale_doc_numero} ·
                        Registrado por {item.form3.resuelto_por_nombre}
                      </div>
                    </div>
                    {['caja','admin','gerencia'].includes(cu.rol) && (
                      <div style={{display:"flex", flexDirection:"column", gap:6, flexShrink:0}}>
                        <Bt variant="success" sm onClick={() => abrirF4(item)}>
                          Confirmar transferencia
                        </Bt>
                        {onVerCaso && (
                          <Bt variant="secondary" sm onClick={() => onVerCaso(item.caso)}>
                            📋 Ver bitácora
                          </Bt>
                        )}
                      </div>
                    )}
                  </div>
                </Cd>
              ))}
            </div>
          )}

          {pendientes.length === 0 && (
            <Cd>
              <div style={{textAlign:"center", padding:"20px 0", color:"#34C759"}}>
                <div style={{fontSize:32, marginBottom:8}}>✅</div>
                <div style={{fontWeight:700}}>Sin transferencias pendientes</div>
              </div>
            </Cd>
          )}

          {/* Ejecutadas */}
          {ejecutados.length > 0 && (
            <div>
              <div style={{fontWeight:700, fontSize:13, color:"#34C759", marginBottom:8,
                display:"flex", alignItems:"center", gap:6}}>
                <span style={{background:"#34C759", color:"#fff", borderRadius:6,
                  padding:"2px 8px", fontSize:11}}>EJECUTADAS</span>
                Historial de transferencias completadas
              </div>
              {ejecutados.map((item, i) => (
                <Cd key={i}>
                  <div style={{display:"flex", gap:12, alignItems:"center"}}>
                    <div style={{
                      width:40, height:40, borderRadius:10, flexShrink:0,
                      background:"#34C75915",
                      display:"flex", alignItems:"center", justifyContent:"center", fontSize:20
                    }}>✅</div>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontWeight:700, fontSize:13}}>
                        {item.caso.numero} · {item.caso.cliente_nombre}
                      </div>
                      <div style={{fontSize:12, color:"#8E8E93", marginTop:2}}>
                        {fmt(item.form3.monto)} · {item.form3.banco} · {item.form3.nombre_titular}
                      </div>
                      <div style={{fontSize:11, color:"#34C759", marginTop:2}}>
                        N° op: {item.form4.transfer_comprobante} ·
                        {item.form4.transfer_fecha
                          ? " " + new Date(item.form4.transfer_fecha).toLocaleDateString('es-CL')
                          : ""} ·
                        Ejecutado por {item.form4.transfer_ejecutado_nombre}
                      </div>
                    </div>
                    <div style={{display:"flex", flexDirection:"column", gap:6, alignItems:"flex-end"}}>
                      <Bd c="#34C759" bg="#34C75915">✅ Ejecutada</Bd>
                      {onVerCaso && (
                        <Bt variant="secondary" sm onClick={() => onVerCaso(item.caso)}>
                          📋 Ver bitácora
                        </Bt>
                      )}
                    </div>
                  </div>
                </Cd>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal FORM 4 */}
      {showF4 && selCaso && (
        <Form4Transfer
          caso={selCaso} form3={selForm3} cu={cu}
          onClose={() => { setShowF4(false); setSelCaso(null) }}
          onGuardado={async () => { setShowF4(false); setSelCaso(null); await cargar(); onRefresh() }}
        />
      )}
    </div>
  )
}

// ─── MÓDULO ESCALADOS — Vista jefatura ───────────────────────────────────
const ModuloEscalados = ({casos, cu, onVerCaso, onRefresh}) => {
  const [loadingF, setLoadingF] = useState(true)
  const [items,    setItems]    = useState([])
  const [selCaso,  setSelCaso]  = useState(null)
  const [selForm3, setSelForm3] = useState(null)
  const [showF4E,  setShowF4E]  = useState(false)

  useEffect(() => { cargar() }, [casos])

  const cargar = async () => {
    setLoadingF(true)
    const escalados = casos.filter(c => c.estado === 'escalado')
    if (!escalados.length) { setItems([]); setLoadingF(false); return }

    const ids = escalados.map(c => c.id)
    const { data: f3s } = await supabase
      .from('caso_form3_resolucion')
      .select('*')
      .in('caso_id', ids)

    const f3Map = {}
    ;(f3s||[]).forEach(f => { f3Map[f.caso_id] = f })

    setItems(escalados.map(c => ({
      caso:  c,
      form3: f3Map[c.id] || null,
      hrs:   Math.round((Date.now() - new Date(c.created_at).getTime()) / 3600000)
    })))
    setLoadingF(false)
  }

  const puedeActuar = (item) => {
    const dest = item.form3?.escalar_a || item.caso.escalado_a || 'jefe_tienda'
    return cu.rol==='admin' || cu.rol==='gerencia' ||
      (cu.rol==='jefe_tienda' && dest==='jefe_tienda')
  }

  return (
    <div>
      <div style={{
        background:"linear-gradient(135deg,#3a1a1a,#4a1a1a)",
        borderRadius:20, padding:"18px 22px", marginBottom:12, color:"#fff"
      }}>
        <div style={{fontSize:18, fontWeight:800}}>🔺 Escalados — Pendientes de jefatura</div>
        <div style={{color:"rgba(255,255,255,0.5)", fontSize:12, marginTop:2}}>
          {items.length} caso{items.length!==1?'s':''} requieren tu decisión
        </div>
      </div>

      {loadingF ? (
        <Cd><div style={{textAlign:"center",color:"#8E8E93",padding:24}}>Cargando...</div></Cd>
      ) : items.length === 0 ? (
        <Cd>
          <div style={{textAlign:"center",padding:"24px 0",color:"#34C759"}}>
            <div style={{fontSize:32,marginBottom:8}}>✅</div>
            <div style={{fontWeight:700}}>Sin casos escalados pendientes</div>
          </div>
        </Cd>
      ) : items.map((item, i) => {
        const dest = item.form3?.escalar_a || item.caso.escalado_a || 'jefe_tienda'
        const destLabel = dest==='jefe_tienda' ? 'Jefe de Tienda' : 'Gerencia'
        return (
          <Cd key={i} ac="#FF3B30">
            <div style={{display:"flex", gap:12, alignItems:"flex-start"}}>
              <div style={{
                width:44, height:44, borderRadius:12, flexShrink:0,
                background:"#FF3B3015",
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:22
              }}>🔺</div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{display:"flex", gap:6, alignItems:"center", marginBottom:3, flexWrap:"wrap"}}>
                  <span style={{fontWeight:800, fontSize:14}}>{item.caso.numero}</span>
                  <Bd c="#FF3B30" bg="#FF3B3015">🔺 Escalado a {destLabel}</Bd>
                  {item.hrs > 48 && <Bd c="#FF3B30" bg="#FF3B3015">⛔ {item.hrs}h</Bd>}
                </div>
                <div style={{fontWeight:600, fontSize:13}}>{item.caso.cliente_nombre}
                  <span style={{color:"#8E8E93", fontWeight:400}}> · {item.caso.cliente_rut}</span>
                </div>
                <div style={{fontSize:12, color:"#3C3C43", marginTop:4}}>
                  {item.caso.doc_tipo} N°{item.caso.doc_numero} · {fmt(item.caso.doc_monto)}
                </div>
                {item.form3?.escalar_motivo && (
                  <div style={{
                    background:"#FF950012", borderLeft:"3px solid #FF9500",
                    borderRadius:"0 8px 8px 0", padding:"6px 10px", marginTop:6,
                    fontSize:12, color:"#3C3C43"
                  }}>
                    <strong>Motivo:</strong> {item.form3.escalar_motivo}
                  </div>
                )}
                <div style={{fontSize:11, color:"#8E8E93", marginTop:4}}>
                  Escalado por {item.form3?.resuelto_por_nombre || item.caso.ejecutivo_nombre} ·
                  {item.caso.sucursal?.replace(/_/g,' ')}
                </div>
              </div>
              <div style={{display:"flex", flexDirection:"column", gap:6, flexShrink:0}}>
                {puedeActuar(item) && (
                  <Bt sm variant="warning" onClick={() => {
                    setSelCaso(item.caso)
                    setSelForm3(item.form3)
                    setShowF4E(true)
                  }}>
                    Resolver
                  </Bt>
                )}
                <Bt sm variant="secondary" onClick={() => onVerCaso(item.caso)}>
                  Ver caso
                </Bt>
              </div>
            </div>
          </Cd>
        )
      })}

      {showF4E && selCaso && (
        <Form4Escalamiento
          caso={selCaso} form3={selForm3} cu={cu}
          onClose={() => { setShowF4E(false); setSelCaso(null) }}
          onGuardado={async () => { setShowF4E(false); setSelCaso(null); await cargar(); onRefresh() }}
        />
      )}
    </div>
  )
}

// ─── PANEL NOTIFICACIONES EMAIL ──────────────────────────────────────────
const EVENTOS_EMAIL = [
  {k:'caso_creado',       ic:'📥', l:'Caso registrado',             form:'FORM 1', roles_default:['operaciones','postventa','admin']},
  {k:'form2_completado',  ic:'🔬', l:'Validación técnica',           form:'FORM 2', roles_default:['postventa','jefe_tienda','admin']},
  {k:'form3_completado',  ic:'🧾', l:'Resolución registrada',        form:'FORM 3', roles_default:['admin','gerencia']},
  {k:'caso_escalado',     ic:'🔺', l:'Caso escalado',                form:'FORM 3', roles_default:['jefe_tienda','gerencia','admin']},
  {k:'form4_completado',  ic:'⚖️',  l:'Decisión de jefatura',        form:'FORM 4B',roles_default:['postventa','admin']},
  {k:'nc_transfer_caja',  ic:'🏦', l:'NC transferencia → Caja',      form:'FORM 3/4B',roles_default:['caja']},
  {k:'transfer_ejecutada',ic:'💸', l:'Transferencia ejecutada',      form:'FORM 4A',roles_default:['postventa','admin','gerencia']},
  {k:'diferencia_cantidades',ic:'⚠️',l:'Diferencia de cantidades',  form:'FORM 2', roles_default:['postventa','admin']},
]

const BrevoPanelCompleto = ({brevoKey, setBrevoKey, brevoFrom, setBrevoFrom,
  brevoOk, brevoSaving, brevoTesting, brevoTestMsg, guardarBrevo, testBrevo}) => {

  const [usuarios,    setUsuarios]    = useState([])
  const [config,      setConfig]      = useState({}) // {evento_k: [usuario_id, ...]}
  const [loadingCfg,  setLoadingCfg]  = useState(true)
  const [savingCfg,   setSavingCfg]   = useState(false)
  const [savedMsg,    setSavedMsg]    = useState("")
  const [diagnostico, setDiagnostico] = useState(null)
  const [loadingDiag, setLoadingDiag] = useState(false)

  useEffect(() => {
    cargarConfig()
  }, [])

  const cargarConfig = async () => {
    setLoadingCfg(true)
    const [{ data: users }, { data: cfgs }] = await Promise.all([
      supabase.from('usuarios').select('id,nombre,correo,rol,activo').eq('activo',true).order('nombre'),
      supabase.from('config_sistema').select('clave,valor').like('clave','notif_%'),
    ])
    setUsuarios(users || [])

    // Construir config desde BD: notif_{evento} = JSON array de user IDs
    const cfgMap = {}
    ;(cfgs || []).forEach(r => {
      const k = r.clave.replace('notif_','')
      try { cfgMap[k] = JSON.parse(r.valor) } catch { cfgMap[k] = [] }
    })

    // Si no existe config para un evento, usar los roles default
    EVENTOS_EMAIL.forEach(ev => {
      if (!cfgMap[ev.k]) {
        cfgMap[ev.k] = (users||[])
          .filter(u => ev.roles_default.includes(u.rol) && u.correo)
          .map(u => u.id)
      }
    })
    setConfig(cfgMap)
    setLoadingCfg(false)
  }

  const toggleUsuario = (eventoK, userId) => {
    setConfig(prev => {
      const actual = prev[eventoK] || []
      const nuevo  = actual.includes(userId)
        ? actual.filter(id => id !== userId)
        : [...actual, userId]
      return {...prev, [eventoK]: nuevo}
    })
  }

  const guardarConfig = async () => {
    setSavingCfg(true)
    const upserts = EVENTOS_EMAIL.map(ev => ({
      clave:       `notif_${ev.k}`,
      valor:       JSON.stringify(config[ev.k] || []),
      descripcion: `Destinatarios para evento: ${ev.l}`,
    }))
    await supabase.from('config_sistema')
      .upsert(upserts, { onConflict: 'clave' })
    setSavingCfg(false)
    setSavedMsg("✅ Configuración guardada")
    setTimeout(() => setSavedMsg(""), 3000)
  }

  const diagnosticarEmail = async () => {
    setLoadingDiag(true)
    setDiagnostico(null)
    const resultados = []

    // 1. Verificar API key
    const { data: apiCfg } = await supabase
      .from('config_sistema').select('valor').eq('clave','brevo_api_key').maybeSingle()
    resultados.push({
      item: 'API Key Brevo',
      ok: !!apiCfg?.valor,
      msg: apiCfg?.valor ? '✅ Configurada' : '❌ No configurada en config_sistema',
    })

    // 2. Verificar email remitente
    const { data: fromCfg } = await supabase
      .from('config_sistema').select('valor').eq('clave','brevo_from_email').maybeSingle()
    resultados.push({
      item: 'Email remitente',
      ok: !!fromCfg?.valor,
      msg: fromCfg?.valor ? `✅ ${fromCfg.valor}` : '❌ No configurado',
    })

    // 3. Verificar usuarios con correo
    const { data: usersConCorreo } = await supabase
      .from('usuarios').select('nombre,correo,rol').eq('activo',true).not('correo','is',null)
    const sinCorreo = usuarios.filter(u => !u.correo)
    resultados.push({
      item: 'Usuarios con correo',
      ok: (usersConCorreo?.length || 0) > 0,
      msg: `✅ ${usersConCorreo?.length || 0} usuarios con correo` +
           (sinCorreo.length > 0 ? ` · ⚠️ ${sinCorreo.length} sin correo: ${sinCorreo.map(u=>u.nombre).join(', ')}` : ''),
    })

    // 4. Verificar Edge Function
    const baseUrl = import.meta.env.VITE_SUPABASE_URL
    try {
      const r = await fetch(`${baseUrl}/functions/v1/brevo-email`, {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`},
        body: JSON.stringify({ tipo:'ping', data:{}, destinatarios:[], brevo_api_key: apiCfg?.valor||'' })
      })
      resultados.push({
        item: 'Edge Function brevo-email',
        ok: r.status !== 404,
        msg: r.status === 404 ? '❌ No desplegada en Supabase' : `✅ Accesible (status ${r.status})`,
      })
    } catch(e) {
      resultados.push({ item:'Edge Function', ok:false, msg:`❌ Error: ${e.message}` })
    }

    // 5. Verificar config de eventos
    const eventosSinDestinatarios = EVENTOS_EMAIL.filter(ev => !(config[ev.k]?.length > 0))
    resultados.push({
      item: 'Destinatarios configurados',
      ok: eventosSinDestinatarios.length === 0,
      msg: eventosSinDestinatarios.length === 0
        ? '✅ Todos los eventos tienen destinatarios'
        : `⚠️ Sin destinatarios: ${eventosSinDestinatarios.map(e=>e.l).join(', ')}`,
    })

    setDiagnostico(resultados)
    setLoadingDiag(false)
  }

  const ROLES_COLORS = {
    admin:'#FF3B30', gerencia:'#AF52DE', jefe_tienda:'#FF9500',
    postventa:'#007AFF', operaciones:'#34C759', caja:'#34C759',
  }

  return (
    <div>
      {/* ── Configuración API ── */}
      <Cd>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14}}>
          <div>
            <div style={{fontWeight:700, fontSize:14}}>📧 Configuración Brevo</div>
            <div style={{fontSize:12, color:"#8E8E93", marginTop:2}}>
              Conexión con el servicio de envío de emails transaccionales
            </div>
          </div>
          <div style={{display:"flex", gap:8, alignItems:"center"}}>
            <Bd c={brevoOk?"#34C759":"#FF3B30"} bg={brevoOk?"#34C75915":"#FF3B3015"} lg>
              {brevoOk ? "✅ Conectado" : "⚠️ Sin configurar"}
            </Bd>
            <Bt sm variant="secondary" loading={loadingDiag} onClick={diagnosticarEmail}>
              🔍 Diagnóstico
            </Bt>
          </div>
        </div>

        <div style={css.row}>
          <div style={css.col}>
            <Fl l="API Key de Brevo" req>
              <input style={{...css.input, fontFamily:"monospace"}} type="password"
                value={brevoKey} onChange={e => setBrevoKey(e.target.value)}
                placeholder="xkeysib-xxxxxxxxxxxxxxxx"/>
            </Fl>
          </div>
          <div style={css.col}>
            <Fl l="Email remitente">
              <input style={css.input} type="email" value={brevoFrom}
                onChange={e => setBrevoFrom(e.target.value)}
                placeholder="postventa@outletdepuertas.cl"/>
            </Fl>
          </div>
        </div>

        <div style={{display:"flex", gap:8}}>
          <Bt variant="primary" loading={brevoSaving} onClick={guardarBrevo}>Guardar API</Bt>
          {brevoOk && <Bt variant="secondary" loading={brevoTesting} onClick={testBrevo}>Enviar email de prueba</Bt>}
        </div>
        {brevoTestMsg && (
          <div style={{marginTop:10,padding:"8px 12px",borderRadius:8,fontSize:12,fontWeight:600,
            background:brevoTestMsg.startsWith('✅')?"#34C75910":"#FF3B3010",
            color:brevoTestMsg.startsWith('✅')?"#34C759":"#FF3B30"}}>
            {brevoTestMsg}
          </div>
        )}

        {/* Diagnóstico */}
        {diagnostico && (
          <div style={{marginTop:14, border:"1px solid #E5E5EA", borderRadius:12, overflow:"hidden"}}>
            <div style={{background:"#1C1C1E", padding:"8px 14px", fontSize:11, fontWeight:700,
              color:"#fff", textTransform:"uppercase", letterSpacing:"0.05em"}}>
              Resultado del diagnóstico
            </div>
            {diagnostico.map((d, i) => (
              <div key={i} style={{
                display:"flex", gap:10, padding:"10px 14px",
                borderBottom: i<diagnostico.length-1?"1px solid #F2F2F7":undefined,
                background: d.ok ? "#fff" : "#FFF5F5"
              }}>
                <span style={{fontSize:14, flexShrink:0}}>{d.ok ? "✅" : "⚠️"}</span>
                <div>
                  <div style={{fontWeight:700, fontSize:12}}>{d.item}</div>
                  <div style={{fontSize:11, color:"#3C3C43", marginTop:2}}>{d.msg}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Cd>

      {/* ── Destinatarios por evento ── */}
      <Cd>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6}}>
          <div>
            <div style={{fontWeight:700, fontSize:14}}>📬 Destinatarios por evento</div>
            <div style={{fontSize:12, color:"#8E8E93", marginTop:2}}>
              Selecciona qué usuarios reciben el email de cada etapa
            </div>
          </div>
          <div style={{display:"flex", gap:8, alignItems:"center"}}>
            {savedMsg && <span style={{fontSize:12, color:"#34C759", fontWeight:600}}>{savedMsg}</span>}
            <Bt variant="primary" sm loading={savingCfg} onClick={guardarConfig}>
              Guardar destinatarios
            </Bt>
          </div>
        </div>

        {loadingCfg ? (
          <div style={{color:"#8E8E93", textAlign:"center", padding:20}}>Cargando...</div>
        ) : (
          EVENTOS_EMAIL.map(ev => {
            const selIds = config[ev.k] || []
            const selUsers = usuarios.filter(u => selIds.includes(u.id))
            return (
              <div key={ev.k} style={{
                border:"1px solid #E5E5EA", borderRadius:14,
                marginBottom:10, overflow:"hidden"
              }}>
                {/* Header evento */}
                <div style={{
                  background:"#F7F7F8", padding:"10px 14px",
                  display:"flex", justifyContent:"space-between", alignItems:"center"
                }}>
                  <div style={{display:"flex", gap:8, alignItems:"center"}}>
                    <span style={{fontSize:16}}>{ev.ic}</span>
                    <div>
                      <div style={{fontWeight:700, fontSize:13}}>{ev.l}</div>
                      <div style={{fontSize:10, color:"#8E8E93"}}>{ev.form}</div>
                    </div>
                  </div>
                  <div style={{display:"flex", gap:4, flexWrap:"wrap", justifyContent:"flex-end"}}>
                    {selUsers.length === 0 ? (
                      <Bd c="#FF3B30" bg="#FF3B3012">Sin destinatarios ⚠️</Bd>
                    ) : selUsers.map(u => (
                      <Bd key={u.id} c={ROLES_COLORS[u.rol]||"#8E8E93"}
                         bg={(ROLES_COLORS[u.rol]||"#8E8E93")+"15"}>
                        {u.nombre.split(" ")[0]}
                      </Bd>
                    ))}
                  </div>
                </div>

                {/* Lista de usuarios seleccionables */}
                <div style={{padding:"8px 14px", display:"flex", gap:6, flexWrap:"wrap"}}>
                  {usuarios.map(u => {
                    const selec = selIds.includes(u.id)
                    const sinCorreo = !u.correo
                    return (
                      <div key={u.id}
                        onClick={() => !sinCorreo && toggleUsuario(ev.k, u.id)}
                        style={{
                          display:"flex", alignItems:"center", gap:6,
                          padding:"5px 10px", borderRadius:20,
                          border:`1.5px solid ${selec ? ROLES_COLORS[u.rol]||"#007AFF" : "#E5E5EA"}`,
                          background: selec ? (ROLES_COLORS[u.rol]||"#007AFF")+"12" : "#fff",
                          cursor: sinCorreo ? "not-allowed" : "pointer",
                          opacity: sinCorreo ? 0.4 : 1,
                          transition:"all 0.15s"
                        }}>
                        <div style={{
                          width:16, height:16, borderRadius:4, flexShrink:0,
                          border:`1.5px solid ${selec ? ROLES_COLORS[u.rol]||"#007AFF" : "#C7C7CC"}`,
                          background: selec ? ROLES_COLORS[u.rol]||"#007AFF" : "#fff",
                          display:"flex", alignItems:"center", justifyContent:"center"
                        }}>
                          {selec && <span style={{color:"#fff",fontSize:9,fontWeight:800}}>✓</span>}
                        </div>
                        <div>
                          <div style={{fontSize:11, fontWeight:700, color:selec?ROLES_COLORS[u.rol]||"#007AFF":"#1C1C1E"}}>
                            {u.nombre.split(" ").slice(0,2).join(" ")}
                          </div>
                          <div style={{fontSize:9, color:"#8E8E93"}}>
                            {sinCorreo ? "⚠️ sin correo" : u.correo}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </Cd>
    </div>
  )
}

// ─── MÓDULO CONFIGURACIÓN MATRIZ V2.0 ────────────────────────────────────
const ModuloMatriz = ({codigos, onRefresh}) => {
  const [sel,         setSel]         = useState(null)
  const [saving,      setSaving]      = useState(false)
  const [busq,        setBusq]        = useState("")
  const [filtBloq,    setFiltBloq]    = useState("todos")
  const [tabConfig,   setTabConfig]   = useState("matriz") // 'matriz' | 'brevo'
  // Brevo config
  const [brevoKey,    setBrevoKey]    = useState("")
  const [brevoFrom,   setBrevoFrom]   = useState("")
  const [brevoSaving, setBrevoSaving] = useState(false)
  const [brevoOk,     setBrevoOk]     = useState(false)
  const [brevoTesting,setBrevoTesting]= useState(false)
  const [brevoTestMsg,setBrevoTestMsg]= useState("")

  // Cargar config Brevo al montar
  useEffect(() => {
    supabase.from('config_sistema')
      .select('clave,valor')
      .in('clave', ['brevo_api_key','brevo_from_email'])
      .then(({data}) => {
        if (!data) return
        data.forEach(r => {
          if (r.clave === 'brevo_api_key')    setBrevoKey(r.valor || "")
          if (r.clave === 'brevo_from_email') setBrevoFrom(r.valor || "")
        })
        setBrevoOk(data.some(r => r.clave === 'brevo_api_key' && r.valor))
      })
  }, [])

  const guardarBrevo = async () => {
    setBrevoSaving(true)
    await Promise.all([
      supabase.from('config_sistema').upsert(
        { clave:'brevo_api_key', valor:brevoKey.trim(), descripcion:'API Key de Brevo para emails transaccionales' },
        { onConflict:'clave' }
      ),
      supabase.from('config_sistema').upsert(
        { clave:'brevo_from_email', valor:brevoFrom.trim() || 'postventa@outletdepuertas.cl', descripcion:'Email remitente Brevo' },
        { onConflict:'clave' }
      ),
    ])
    setBrevoOk(!!brevoKey.trim())
    setBrevoSaving(false)
  }

  const testBrevo = async () => {
    if (!brevoKey.trim()) return
    setBrevoTesting(true)
    setBrevoTestMsg("")
    const result = await sendEmail('caso_creado', {
      numero:           'TEST-001',
      cliente_nombre:   'Cliente de Prueba',
      cliente_rut:      '12.345.678-9',
      doc_tipo:         'boleta',
      doc_numero:       '99999',
      motivo_cliente:   'Este es un email de prueba del sistema Postventa.',
      ejecutivo_nombre: 'Admin',
      sucursal:         'la_granja',
      requiere_form2:   false,
      es_critico:       false,
    }, [{ email: brevoFrom || 'test@outletdepuertas.cl', nombre: 'Admin Test' }])
    setBrevoTestMsg(result.ok ? '✅ Email enviado correctamente' : '❌ Error: ' + result.error)
    setBrevoTesting(false)
  }

  const RIESGO = {
    Alto:  {c:"#FF3B30", bg:"#FF3B3015"},
    Medio: {c:"#FF9500", bg:"#FF950015"},
    Bajo:  {c:"#34C759", bg:"#34C75915"},
  }

  const fil = useMemo(() =>
    codigos.filter(c => {
      const matchBloq = filtBloq === 'todos' || c.bloque === filtBloq
      const matchBusq = !busq ||
        c.codigo.toLowerCase().includes(busq.toLowerCase()) ||
        c.descripcion.toLowerCase().includes(busq.toLowerCase())
      return matchBloq && matchBusq
    })
  , [codigos, filtBloq, busq])

  const porBloque = useMemo(() => {
    const m = {}
    fil.forEach(c => {
      const bnm2 = {B1:'Problemas de producto',B2:'Devoluciones y cambios',B3:'Problemas de entrega',B4:'Instalación',B5:'Garantía',B6:'Casos especiales'}
      if (!m[c.bloque]) m[c.bloque] = {nombre: bnm2[c.bloque]||c.bloque, items:[]}
      m[c.bloque].items.push(c)
    })
    return Object.entries(m).sort((a,b) => a[0].localeCompare(b[0]))
  }, [fil])

  const bloques = [...new Set(codigos.map(c => c.bloque))].sort()
  const totalConForm2 = codigos.filter(c => c.requiere_form2).length
  const totalAlto     = codigos.filter(c => c.riesgo === 'Alto').length

  const guardar = async (f) => {
    setSaving(true)
    await supabase.from('matriz_codigos').update({
      descripcion:       f.descripcion,
      requiere_form2:    f.requiere_form2,
      riesgo:            f.riesgo,
      resolucion_tipica: f.resolucion_tipica,
      activo:            f.activo,
    }).eq('codigo', f.codigo)
    setSaving(false)
    setSel(null)
    onRefresh()
  }

  return (
    <div>
      {/* Header */}
      <div style={{
        background:"linear-gradient(135deg, #1a1a2e 0%, #1a1a3e 100%)",
        borderRadius:20, padding:"18px 22px", marginBottom:12, color:"#fff"
      }}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div>
            <div style={{fontSize:18, fontWeight:800, letterSpacing:"-0.02em"}}>
              ⚙️ Configuración del sistema
            </div>
            <div style={{color:"rgba(255,255,255,0.5)", fontSize:12, marginTop:2}}>
              {codigos.length} códigos · {totalConForm2} con validación técnica · {totalAlto} riesgo alto
            </div>
          </div>
        </div>
      </div>

      {/* Tabs internos */}
      <div style={{display:"flex", gap:6, marginBottom:12}}>
        {[
          {k:'matriz', l:'📋 Matriz V2.0'},
          {k:'brevo',  l:'📧 Notificaciones Email'},
        ].map(t => (
          <button key={t.k} onClick={() => setTabConfig(t.k)} style={{
            padding:"8px 16px", borderRadius:10, border:"none", cursor:"pointer",
            fontFamily:FONT, fontSize:13, fontWeight:600,
            background: tabConfig===t.k ? "#007AFF" : "#fff",
            color:      tabConfig===t.k ? "#fff"    : "#8E8E93",
            boxShadow:  tabConfig===t.k ? "0 2px 8px rgba(0,122,255,0.3)" : "none",
          }}>{t.l}</button>
        ))}
      </div>

      {/* ── Tab: Brevo ── */}
      {tabConfig === 'brevo' && (
        <BrevoPanelCompleto
          brevoKey={brevoKey} setBrevoKey={setBrevoKey}
          brevoFrom={brevoFrom} setBrevoFrom={setBrevoFrom}
          brevoOk={brevoOk} brevoSaving={brevoSaving}
          brevoTesting={brevoTesting} brevoTestMsg={brevoTestMsg}
          guardarBrevo={guardarBrevo} testBrevo={testBrevo}
        />
      )}

      {/* ── Tab: Matriz ── */}
      {tabConfig === 'matriz' && (
        <div>
          {/* Aviso importante */}
          <div style={{
            background:"#FF950012", border:"1px solid #FF950040",
            borderRadius:12, padding:"10px 14px", marginBottom:12,
            fontSize:12, color:"#FF9500", display:"flex", gap:8
          }}>
            <span>⚠️</span>
            <span>El campo <strong>¿Requiere validación técnica?</strong> determina si un caso pasa a <em>en_validacion_tecnica</em> o queda <em>abierto</em>.</span>
          </div>

          {/* Filtros */}
          <div style={{...css.card, padding:"12px 14px", marginBottom:10}}>
            <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
              <input style={{...css.input, flex:"1 1 180px", maxWidth:260, margin:0}}
                placeholder="🔍 Buscar código o descripción..."
                value={busq} onChange={e => setBusq(e.target.value)}/>
              <select style={{...css.select, flex:"0 0 140px"}}
                value={filtBloq} onChange={e => setFiltBloq(e.target.value)}>
                <option value="todos">Todos los bloques</option>
                {bloques.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>

          {porBloque.map(([bloque, {nombre, items}]) => {
            const clKey = BLOQUE_CL[bloque] || 'D'
            const cl    = CL[clKey]
            return (
              <div key={bloque} style={{...css.card, marginBottom:10}}>
                <div style={{
                  display:"flex", alignItems:"center", gap:8, marginBottom:12,
                  paddingBottom:10, borderBottom:"1px solid #F2F2F7"
                }}>
                  <div style={{
                    width:32, height:32, borderRadius:8,
                    background:cl.bg, color:cl.c,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontWeight:800, fontSize:13
                  }}>{bloque}</div>
                  <div>
                    <div style={{fontWeight:700, fontSize:14}}>{nombre}</div>
                    <div style={{fontSize:11, color:"#8E8E93"}}>
                      {items.length} código{items.length!==1?'s':''} · {items.filter(x=>x.requiere_form2).length} con validación técnica
                    </div>
                  </div>
                </div>
                {items.map(cod => {
                  const r = RIESGO[cod.riesgo] || RIESGO.Medio
                  return (
                    <div key={cod.codigo} style={{
                      display:"flex", alignItems:"center", gap:10,
                      padding:"9px 0", borderBottom:"1px solid #F7F7F8"
                    }}>
                      <div style={{width:36, flexShrink:0, fontWeight:800, fontSize:12, color:cl.c}}>{cod.codigo}</div>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{
                          fontSize:13, fontWeight:500,
                          color: cod.activo ? "#1C1C1E" : "#AEAEB2",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"
                        }}>
                          {cod.descripcion}
                          {!cod.activo && <span style={{color:"#AEAEB2", fontSize:11}}> (inactivo)</span>}
                        </div>
                      </div>
                      <div style={{flexShrink:0, width:140, textAlign:"center"}}>
                        <Bd c={cod.requiere_form2?"#AF52DE":"#8E8E93"} bg={cod.requiere_form2?"#AF52DE15":"#F2F2F7"}>
                          {cod.requiere_form2 ? "🔬 Sí requiere" : "Sin validación"}
                        </Bd>
                      </div>
                      <div style={{flexShrink:0, width:80, textAlign:"center"}}>
                        <Bd c={r.c} bg={r.bg}>{cod.riesgo||"Medio"}</Bd>
                      </div>
                      <Bt sm variant="secondary" onClick={() => setSel({...cod})}>Editar</Bt>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Sheet edición código */}
      {sel && (
        <Sheet open onClose={() => setSel(null)} title={`⚙️ Editar código ${sel.codigo}`}>
          <div style={{...css.cardSm, marginBottom:14, borderLeft:`3px solid ${CL[BLOQUE_CL[sel.bloque]||'D'].c}`}}>
            <div style={{fontSize:11, color:"#8E8E93"}}>Bloque {sel.bloque}</div>
          </div>
          <Fl l="Descripción del caso">
            <textarea style={css.textarea} value={sel.descripcion}
              onChange={e => setSel(p=>({...p, descripcion:e.target.value}))}/>
          </Fl>
          <div style={{
            background: sel.requiere_form2 ? "#AF52DE10" : "#F2F2F7",
            border:`1.5px solid ${sel.requiere_form2 ? "#AF52DE50" : "#E5E5EA"}`,
            borderRadius:14, padding:"14px 16px", marginBottom:12
          }}>
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700, fontSize:14}}>🔬 Requiere validación técnica</div>
                <div style={{fontSize:12, color:"#8E8E93", marginTop:3}}>
                  Si activo, el caso pasa a <strong>en_validacion_tecnica</strong> al crearse.
                </div>
              </div>
              <div onClick={() => setSel(p=>({...p, requiere_form2:!p.requiere_form2}))}
                style={{
                  width:50, height:28, borderRadius:14, cursor:"pointer",
                  background: sel.requiere_form2 ? "#AF52DE" : "#C7C7CC",
                  position:"relative", transition:"background 0.2s", flexShrink:0, marginLeft:16
                }}>
                <div style={{
                  position:"absolute", top:3, left: sel.requiere_form2 ? 24 : 3,
                  width:22, height:22, borderRadius:"50%", background:"#fff",
                  boxShadow:"0 1px 4px rgba(0,0,0,0.2)", transition:"left 0.2s"
                }}/>
              </div>
            </div>
          </div>
          <div style={css.row}>
            <div style={css.col}>
              <Fl l="Nivel de riesgo">
                <select style={css.select} value={sel.riesgo||"Medio"}
                  onChange={e => setSel(p=>({...p, riesgo:e.target.value}))}>
                  <option value="Bajo">🟢 Bajo</option>
                  <option value="Medio">🟡 Medio</option>
                  <option value="Alto">🔴 Alto</option>
                </select>
              </Fl>
            </div>
            <div style={css.col}>
              <Fl l="Resolución típica">
                <select style={css.select} value={sel.resolucion_tipica||"cambio"}
                  onChange={e => setSel(p=>({...p, resolucion_tipica:e.target.value}))}>
                  <option value="cambio">Cambio de producto</option>
                  <option value="nc_abono">NC con abono</option>
                  <option value="nc_transfer">NC con transferencia</option>
                  <option value="rechazo">Rechazo</option>
                  <option value="escalar">Escalar</option>
                </select>
              </Fl>
            </div>
          </div>
          <Fl l="Estado del código">
            <select style={css.select} value={sel.activo ? "1":"0"}
              onChange={e => setSel(p=>({...p, activo:e.target.value==="1"}))}>
              <option value="1">✅ Activo</option>
              <option value="0">⛔ Inactivo</option>
            </select>
          </Fl>
          <div style={{display:"flex", gap:10, marginTop:8}}>
            <Bt variant="secondary" fw onClick={() => setSel(null)}>Cancelar</Bt>
            <Bt fw loading={saving} onClick={() => guardar(sel)}>Guardar cambios</Bt>
          </div>
        </Sheet>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. APP RAÍZ
═══════════════════════════════════════════════════════════════════════════ */
// ═══ POSTVENTA APP — Módulo integrado al ERP Outlet de Puertas ═══
// Recibe cu (usuario actual) y setAppActual como props del ERP
// El login, la sesión y el Auth son manejados por el ERP
export function PostventaApp({ cu, setAppActual }) {
  const [loading,   setLoading]   = useState(true)
  const [users,     setUsers]     = useState([])
  const [casos,     setCasos]     = useState([])
  const [codigos,   setCodigos]   = useState([])
  const [capsLoaded, setCapsLoaded] = useState(false)
  const { isMobile, isXs } = useResponsive()

  const [tab,       setTab]       = useState(()=>{try{return localStorage.getItem('pv_tab')||'dashboard'}catch(e){return 'dashboard'}})
  const [modalNew,  setModalNew]  = useState(false)
  const [casoSel,   setCasoSel]   = useState(null)

  // Carga inicial: casos, usuarios, codigos + precargar capabilities RBAC
  useEffect(() => {
    ;(async () => {
      const [{data: u}, {data: cod}, {data: cas}] = await Promise.all([
        supabase.from('usuarios').select('*').eq('activo', true),
        supabase.from('matriz_codigos').select('*').eq('activo', true).order('orden'),
        supabase.from('casos_postventa').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
      ])
      setUsers(u || [])
      setCodigos(cod || [])
      setCasos(cas || [])
      setLoading(false)
    })()
  }, [])

  // RBAC-6: precargar capabilities cuando hay usuario
  useEffect(() => {
    if (cu?.id) preloadCaps(cu, 'postventa').then(() => setCapsLoaded(true))
  }, [cu?.id])

  // Persistir tab seleccionado
  useEffect(()=>{try{localStorage.setItem('pv_tab',tab)}catch(e){}},[tab])

  // Volver al AppHub
  const volverHub = () => {
    try{localStorage.removeItem('outlet_app_actual')}catch(e){}
    setAppActual(null)
  }

  const cerrarSesion = async () => {
    try { await signOut() } catch(e) {}
    try { localStorage.removeItem('outlet_app_actual') } catch(e) {}
    window.location.reload()
  }

  const cargarCasos = async () => {
    const { data } = await supabase.from('casos_postventa')
      .select('*').is('deleted_at', null).order('created_at', { ascending: false })
    setCasos(data || [])
  }

  const cargarUsers = async () => {
    const { data } = await supabase.from('usuarios').select('*').order('nombre')
    setUsers(data || [])
  }

  const cargarCodigos = async () => {
    const { data } = await supabase.from('matriz_codigos')
      .select('*').eq('activo', true).order('orden')
    setCodigos(data || [])
  }

  const onCreado = () => {
    setModalNew(false)
    cargarCasos()
    setTab('casos')
  }

  const h = p => cu ? hp(cu, p) : false

  if (loading) return (
    <div style={{
      minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
      background:"#F2F2F7", fontFamily:FONT
    }}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:48, marginBottom:12}}>🚪</div>
        <div style={{fontSize:18, fontWeight:700, letterSpacing:"-0.02em"}}>Outlet de Puertas</div>
        <div style={{fontSize:13, color:"#8E8E93", marginTop:4}}>Cargando sistema postventa...</div>
      </div>
    </div>
  )

  // Login manejado por el ERP — cu siempre viene como prop

  const rd = rl(cu)
  const TABS = [
    {k:'dashboard',  l:'Dashboard',  ic:'📊'},
    {k:'casos',      l:'Casos',      ic:'📋'},
    // Tab Finanzas — solo caja, admin, gerencia
    ...(['caja','admin','gerencia'].includes(cu.rol)
      ? [{k:'finanzas', l:'Finanzas', ic:'💸',
          badge: casos.filter(c => c.estado === 'transfer_pendiente' && !c.deleted_at).length || null}]
      : []),
    // Tab Escalados — solo jefe_tienda, gerencia, admin
    ...(['jefe_tienda','gerencia','admin'].includes(cu.rol)
      ? [{k:'escalados', l:'Escalados', ic:'🔺',
          badge: casos.filter(c => c.estado === 'escalado').length || null}]
      : []),
    ...(cu.rol==='admin' || cu.rol==='gerencia'
      ? [{k:'usuarios',  l:'Usuarios',     ic:'👥'},
         {k:'matriz',    l:'Configuración', ic:'⚙️'}]
      : []),
  ]

  return (
    <div style={{...css.page, fontFamily:FONT}}>
      <style>{`
        @keyframes slideUp { from{transform:translateY(60px);opacity:0} to{transform:translateY(0);opacity:1} }
        * { box-sizing:border-box; margin:0; padding:0 }
        body { background:var(--bg-page); overflow-x:hidden }
        input:focus, select:focus, textarea:focus {
          border-color:var(--accent) !important;
          box-shadow:0 0 0 3px rgba(79,70,229,0.12);
          outline:none;
        }
        ::selection { background:var(--accent); color:#fff }
        ::-webkit-scrollbar { width:8px; height:8px }
        ::-webkit-scrollbar-thumb { background:#C7C7CC; border-radius:4px }
        ::-webkit-scrollbar-thumb:hover { background:var(--text-muted) }
        optgroup { font-weight:700; color:#3C3C43 }
        option   { font-weight:400; color:#1C1C1E }
      `}</style>

      {/* ── HEADER RESPONSIVE ── */}
      <div style={{
        padding: isMobile ? "10px 0 8px" : "14px 0 10px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        borderBottom:"1px solid var(--border-1)", marginBottom: isMobile ? 10 : 14
      }}>
        {/* Logo + título */}
        <div style={{display:"flex", alignItems:"center", gap: isMobile ? 8 : 10, minWidth:0, flex:1}}>
          <div style={{fontSize: isMobile ? 22 : 28, flexShrink:0}}>🚪</div>
          <div style={{minWidth:0}}>
            <div style={{fontSize: isMobile ? 15 : 18, fontWeight:800, letterSpacing:"-0.02em", lineHeight:1.1}}>Postventa</div>
            {!isXs && <div style={{fontSize:11, color:"var(--text-muted)", fontWeight:500}}>Outlet de Puertas SpA</div>}
          </div>
          {/* En móvil: nombre corto inline */}
          {isMobile && (
            <div style={{fontSize:12, fontWeight:600, color:"var(--text-secondary)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0}}>
              · {cu.nombre.split(" ")[0]}
            </div>
          )}
        </div>

        {/* Acciones derecha */}
        <div style={{display:"flex", alignItems:"center", gap: isMobile ? 4 : 10, flexShrink:0}}>
          {/* En desktop: badge rol + avatar + nombre */}
          {!isMobile && <>
            <Bd c={rd.c} bg={rd.c+"18"} lg>{rd.l}</Bd>
            <Av nombre={cu.nombre} color={rd.c}/>
            <div style={{fontSize:13, fontWeight:600, color:"var(--text-primary)"}}>{cu.nombre.split(" ")[0]}</div>
          </>}
          {/* En móvil: solo avatar pequeño */}
          {isMobile && <Av nombre={cu.nombre} color={rd.c}/>}
          <button onClick={volverHub} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:isMobile?"5px 8px":"6px 10px",borderRadius:10,background:"var(--purple-bg)",border:"none",cursor:"pointer",color:"var(--purple)",minWidth: isMobile?40:56}} title="Cambiar de aplicacion">
            <span style={{fontSize: isMobile?12:14,lineHeight:1}}>⊞</span>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.02em"}}>Apps</span>
          </button>
          <button onClick={cerrarSesion} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,padding:isMobile?"5px 8px":"6px 10px",borderRadius:10,background:"var(--danger-bg)",border:"none",cursor:"pointer",color:"var(--danger)",minWidth: isMobile?40:56}} title="Cerrar sesion">
            <span style={{fontSize: isMobile?12:14,lineHeight:1}}>⏻</span>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.02em"}}>Salir</span>
          </button>
        </div>
      </div>

      {/* ── TABS RESPONSIVE ── */}
      <div style={{
        display:"flex", gap: isMobile ? 3 : 4, marginBottom: isMobile ? 12 : 16,
        overflowX:"auto", WebkitOverflowScrolling:"touch",
        scrollbarWidth:"none", msOverflowStyle:"none",
        background: !isMobile ? "var(--bg-surface-2)" : "transparent",
        border: !isMobile ? "1px solid var(--border-1)" : "none",
        borderRadius: !isMobile ? 10 : 0,
        padding: !isMobile ? "4px" : "2px 0 4px",
      }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: isMobile ? "7px 12px" : "8px 16px",
            borderRadius:8, border: tab===t.k ? "none" : (isMobile ? "1px solid var(--border-1)" : "none"),
            cursor:"pointer", fontFamily:FONT,
            fontSize: isMobile ? 12 : 13,
            fontWeight:600, whiteSpace:"nowrap", flexShrink:0,
            background: tab===t.k ? "var(--accent)" : (isMobile ? "var(--bg-surface)" : "transparent"),
            color: tab===t.k ? "#fff" : "var(--text-muted)",
            boxShadow: tab===t.k ? "0 2px 8px rgba(79,70,229,0.25)" : "none",
            transition:"all 0.15s", position:"relative",
          }}>
            {t.ic} {t.l}
            {t.badge > 0 && (
              <span style={{
                position:"absolute", top:-4, right:-4,
                background:"var(--danger)", color:"#fff",
                fontSize:10, fontWeight:800, borderRadius:"50%",
                width:18, height:18, display:"flex",
                alignItems:"center", justifyContent:"center",
                lineHeight:1
              }}>{t.badge > 9 ? '9+' : t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── CONTENIDO ── */}
      {tab === 'finanzas' && (
        <ModuloFinanzas casos={casos} cu={cu} onRefresh={cargarCasos}
          onVerCaso={c => { setCasoSel(c); setTab('casos') }}/>
      )}
      {tab === 'escalados' && (
        <ModuloEscalados casos={casos} cu={cu} onVerCaso={c => { setCasoSel(c); setTab('casos') }} onRefresh={cargarCasos}/>
      )}
      {tab === 'matriz' && (
        <ModuloMatriz codigos={codigos} onRefresh={cargarCodigos}/>
      )}
      {tab === 'usuarios' && (
        <ModuloUsuarios users={users} cu={cu} onRefresh={cargarUsers}/>
      )}
      {tab === 'dashboard' && (
        <Dashboard
          casos={casos} codigos={codigos} cu={cu}
          onNuevo={() => setModalNew(true)}
          onVerCaso={c => { setCasoSel(c); setTab('casos') }}
        />
      )}
      {tab === 'casos' && (
        <ListaCasos
          casos={casos} cu={cu}
          onVerCaso={c => setCasoSel(c)}
          onNuevo={() => setModalNew(true)}
          onRefresh={cargarCasos}
        />
      )}

      {/* ── MODALES ── */}
      {modalNew && (
        <NuevoCaso
          cu={cu} codigos={codigos}
          onClose={() => setModalNew(false)}
          onCreado={onCreado}
        />
      )}
      {casoSel && (
        <DetalleCaso
          caso={casoSel} cu={cu} codigos={codigos}
          onClose={() => setCasoSel(null)}
          onRefresh={cargarCasos}
        />
      )}

    </div>
  )
}
