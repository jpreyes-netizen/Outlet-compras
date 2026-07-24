// ============================================================
// OUTLET LOGÍSTICA — ui_compartida.jsx
// Tokens de tema + componentes UI compartidos entre LogisticaApp
// (monolito) y los módulos extraídos (PickingView, ...).
// Extraído del monolito en Fase 0 del refactor (jul 2026).
// ============================================================

const FONT            = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"
const SIDEBAR_BG      = 'linear-gradient(180deg, #0f0c29 0%, #18183a 60%, #24243e 100%)'
const BRAND_ORANGE    = '#E8660A'

// ──────────────────────────────────────────────────────────────
const css = {
  // ── Layout ──────────────────────────────────────────────────────────────────
  appWrap: {display:'flex',minHeight:'100vh',background:'#F2F2F7',fontFamily:FONT},
  sidebar: {width:220,background:SIDEBAR_BG,display:'flex',flexDirection:'column',
    position:'fixed',top:0,left:0,bottom:0,zIndex:200,
    boxShadow:'4px 0 24px rgba(0,0,0,0.35)'},
  sideTop: {padding:'20px 18px 14px'},
  sideNav: {flex:1,overflowY:'auto',padding:'4px 10px 8px'},
  sideUser:{padding:'14px 16px',borderTop:'1px solid rgba(255,255,255,0.08)'},
  sideGrp: {fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.3)',
    textTransform:'uppercase',letterSpacing:1.2,padding:'16px 8px 6px'},
  sideItem:(active,st)=>({
    display:'flex',alignItems:'center',gap:10,
    padding:'10px 12px',                    // +2px más alto → más fácil de tocar
    borderRadius:10,marginBottom:3,
    cursor:st==='active'?'pointer':'not-allowed',
    opacity:st==='active'?1:st==='soon'?0.5:0.28,
    background:active?'rgba(255,255,255,0.13)':'transparent',
    border:active?'1px solid rgba(255,255,255,0.18)':'1px solid transparent',
    transition:'all 0.15s',
  }),
  main:   {marginLeft:220,flex:1,display:'flex',flexDirection:'column',minHeight:'100vh'},
  topbar: {background:'#fff',borderBottom:'1px solid #E5E5EA',
    padding:'12px 28px',                    // +2px vertical, +4px horizontal
    display:'flex',alignItems:'center',justifyContent:'space-between',
    position:'sticky',top:0,zIndex:100,boxShadow:'0 1px 3px rgba(0,0,0,0.05)'},
  body:   {padding:'24px 28px',flex:1},     // +4px en todos los lados

  // ── Cards ────────────────────────────────────────────────────────────────────
  card:   {background:'#fff',borderRadius:14,padding:'18px 20px',marginBottom:14,
    boxShadow:'0 1px 4px rgba(0,0,0,0.06)'},
  cardAc: (c='#007AFF')=>({background:'#fff',borderRadius:14,padding:'18px 20px',
    marginBottom:14,boxShadow:'0 1px 4px rgba(0,0,0,0.06)',borderLeft:`4px solid ${c}`}),

  // ── Tipografía — escala Enterprise ──────────────────────────────────────────
  // Antes: 20/16/14/11/12px — muy pequeño para operarios
  // Ahora: 22/17/15/12/13px — legible a distancia normal de trabajo
  t1:   {fontSize:22,fontWeight:700,letterSpacing:-0.4,color:'#1C1C1E',lineHeight:1.2},
  t2:   {fontSize:17,fontWeight:600,color:'#1C1C1E',lineHeight:1.3},
  t3:   {fontSize:15,fontWeight:500,color:'#1C1C1E',lineHeight:1.4},
  cap:  {fontSize:12,fontWeight:700,color:'#8E8E93',textTransform:'uppercase',
    letterSpacing:0.6,lineHeight:1.4},
  sm:   {fontSize:13,color:'#6D6D72',lineHeight:1.5},

  // ── Layout helpers ───────────────────────────────────────────────────────────
  row:  {display:'flex',gap:12,alignItems:'center'},
  rowSb:{display:'flex',justifyContent:'space-between',alignItems:'center'},
  col:  {display:'flex',flexDirection:'column',gap:10},

  // ── Formularios — altura mínima 44px (estándar táctil) ──────────────────────
  input:  {width:'100%',padding:'11px 14px',border:'1.5px solid #E5E5EA',
    borderRadius:10,fontSize:15,fontFamily:FONT,outline:'none',
    background:'#fff',boxSizing:'border-box',lineHeight:1.4,
    minHeight:44},                          // mínimo táctil
  label:  {fontSize:13,fontWeight:600,color:'#6D6D72',marginBottom:6,display:'block'},
  select: {width:'100%',padding:'11px 14px',border:'1.5px solid #E5E5EA',
    borderRadius:10,fontSize:15,fontFamily:FONT,outline:'none',
    background:'#fff',boxSizing:'border-box',minHeight:44},
  textarea:{width:'100%',padding:'11px 14px',border:'1.5px solid #E5E5EA',
    borderRadius:10,fontSize:14,fontFamily:FONT,outline:'none',
    background:'#fff',boxSizing:'border-box',resize:'vertical',minHeight:88},

  // ── Otros ────────────────────────────────────────────────────────────────────
  sep:  {height:1,background:'#E5E5EA',margin:'16px 0'},
  empty:{textAlign:'center',padding:'72px 24px',color:'#8E8E93'},
}

// ─── UI COMPONENTS ─────────────────────────────────────────
function Bt({children,v='pri',onClick,dis=false,full=false,sm=false,ic=null,tooltip=null}) {
  // sm: 36px altura — acciones secundarias
  // normal: 44px altura — acciones primarias (estándar táctil mínimo)
  const base={display:'inline-flex',alignItems:'center',gap:6,
    padding:sm?'8px 16px':'12px 22px',
    borderRadius:10,border:'none',
    cursor:dis?'not-allowed':'pointer',
    fontSize:sm?13:15,                      // sm: 13px, normal: 15px
    fontWeight:600,fontFamily:FONT,
    opacity:dis?0.45:1,transition:'all 0.15s',
    width:full?'100%':'auto',justifyContent:'center',
    minHeight:sm?36:44,                     // altura mínima táctil
  }
  const vars={
    pri:{background:'#007AFF',color:'#fff',boxShadow:'0 2px 8px rgba(0,122,255,0.3)'},
    suc:{background:'#34C759',color:'#fff',boxShadow:'0 2px 8px rgba(52,199,89,0.3)'},
    dan:{background:'#FF3B30',color:'#fff',boxShadow:'0 2px 8px rgba(255,59,48,0.3)'},
    pur:{background:'#5856D6',color:'#fff',boxShadow:'0 2px 8px rgba(88,86,214,0.3)'},
    amb:{background:'#FF9500',color:'#fff',boxShadow:'0 2px 8px rgba(255,149,0,0.3)'},
    gry:{background:'#F2F2F7',color:'#1C1C1E',boxShadow:'none'},
    out:{background:'transparent',color:'#007AFF',border:'1.5px solid #007AFF',boxShadow:'none'},
    dark:{background:'#1C1C1E',color:'#fff',boxShadow:'0 2px 8px rgba(0,0,0,0.2)'},
    brand:{background:BRAND_ORANGE,color:'#fff',boxShadow:`0 2px 8px ${BRAND_ORANGE}50`},
  }
  return <button style={{...base,...(vars[v]||vars.pri)}} onClick={!dis?onClick:undefined} disabled={dis} title={tooltip||undefined}>{ic&&<span>{ic}</span>}{children}</button>
}

export { FONT, SIDEBAR_BG, BRAND_ORANGE, css, Bt }
