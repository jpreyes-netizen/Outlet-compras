import { useEffect, useRef } from 'react'

// ============================================================
// OUTLET LOGÍSTICA — ui_compartida.jsx
// Tokens de tema + componentes UI compartidos entre LogisticaApp
// (monolito) y los módulos extraídos (PickingView, ...).
// Extraído del monolito en Fase 0 del refactor (jul 2026).
// ============================================================

const FONT            = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"
const SIDEBAR_BG      = 'linear-gradient(180deg, #16213E 0%, #1B2A4E 60%, #223058 100%)'
const BRAND_ORANGE    = '#E8660A'

// ──────────────────────────────────────────────────────────────
const css = {
  // ── Layout ──────────────────────────────────────────────────────────────────
  appWrap: {display:'flex',minHeight:'100vh',background:'#F4F5F7',fontFamily:FONT},
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
  main:   {marginLeft:0,flex:1,display:'flex',flexDirection:'column',minHeight:'100vh'},
  topbar: {background:'#fff',borderBottom:'1px solid #E5E7EB',
    padding:'12px 28px',                    // +2px vertical, +4px horizontal
    display:'flex',alignItems:'center',justifyContent:'space-between',
    position:'sticky',top:0,zIndex:100,boxShadow:'0 1px 3px rgba(0,0,0,0.05)'},
  body:   {padding:'24px 28px',flex:1},     // +4px en todos los lados

  // ── Cards ────────────────────────────────────────────────────────────────────
  card:   {background:'#fff',borderRadius:14,padding:'18px 20px',marginBottom:14,
    boxShadow:'0 1px 4px rgba(0,0,0,0.06)'},
  cardAc: (c='#175CD3')=>({background:'#fff',borderRadius:14,padding:'18px 20px',
    marginBottom:14,boxShadow:'0 1px 4px rgba(0,0,0,0.06)',borderLeft:`4px solid ${c}`}),

  // ── Tipografía — escala Enterprise ──────────────────────────────────────────
  // Antes: 20/16/14/11/12px — muy pequeño para operarios
  // Ahora: 22/17/15/12/13px — legible a distancia normal de trabajo
  t1:   {fontSize:22,fontWeight:700,letterSpacing:-0.4,color:'#1C1C1E',lineHeight:1.2},
  t2:   {fontSize:17,fontWeight:600,color:'#1C1C1E',lineHeight:1.3},
  t3:   {fontSize:15,fontWeight:500,color:'#1C1C1E',lineHeight:1.4},
  cap:  {fontSize:12,fontWeight:700,color:'#767A83',textTransform:'uppercase',
    letterSpacing:0.6,lineHeight:1.4},
  sm:   {fontSize:13,color:'#6E6E73',lineHeight:1.5},

  // ── Layout helpers ───────────────────────────────────────────────────────────
  row:  {display:'flex',gap:12,alignItems:'center'},
  rowSb:{display:'flex',justifyContent:'space-between',alignItems:'center'},
  col:  {display:'flex',flexDirection:'column',gap:10},

  // ── Formularios — altura mínima 44px (estándar táctil) ──────────────────────
  input:  {width:'100%',padding:'11px 14px',border:'1.5px solid #E5E7EB',
    borderRadius:10,fontSize:15,fontFamily:FONT,outline:'none',
    background:'#fff',boxSizing:'border-box',lineHeight:1.4,
    minHeight:44},                          // mínimo táctil
  label:  {fontSize:13,fontWeight:600,color:'#6E6E73',marginBottom:6,display:'block'},
  select: {width:'100%',padding:'11px 14px',border:'1.5px solid #E5E7EB',
    borderRadius:10,fontSize:15,fontFamily:FONT,outline:'none',
    background:'#fff',boxSizing:'border-box',minHeight:44},
  textarea:{width:'100%',padding:'11px 14px',border:'1.5px solid #E5E7EB',
    borderRadius:10,fontSize:14,fontFamily:FONT,outline:'none',
    background:'#fff',boxSizing:'border-box',resize:'vertical',minHeight:88},

  // ── Otros ────────────────────────────────────────────────────────────────────
  sep:  {height:1,background:'#E5E7EB',margin:'16px 0'},
  empty:{textAlign:'center',padding:'72px 24px',color:'#767A83'},
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
    pri:{background:'#16213E',color:'#fff',boxShadow:'0 1px 2px rgba(22,33,62,0.25)'},
    suc:{background:'#1E7A44',color:'#fff',boxShadow:'0 1px 2px rgba(30,122,68,0.25)'},
    dan:{background:'#B42318',color:'#fff',boxShadow:'0 1px 2px rgba(180,35,24,0.25)'},
    pur:{background:'#6941C6',color:'#fff',boxShadow:'0 1px 2px rgba(105,65,198,0.25)'},
    amb:{background:'#B25E09',color:'#fff',boxShadow:'0 1px 2px rgba(178,94,9,0.25)'},
    gry:{background:'#EEF1F7',color:'#16213E',boxShadow:'none'},
    out:{background:'transparent',color:'#16213E',border:'1.5px solid #16213E',boxShadow:'none'},
    dark:{background:'#1C1C1E',color:'#fff',boxShadow:'0 2px 8px rgba(0,0,0,0.2)'},
    brand:{background:BRAND_ORANGE,color:'#fff',boxShadow:`0 2px 8px ${BRAND_ORANGE}50`},
  }
  return <button style={{...base,...(vars[v]||vars.pri)}} onClick={!dis?onClick:undefined} disabled={dis} title={tooltip||undefined}>{ic&&<span>{ic}</span>}{children}</button>
}

// ─── NAVEGACIÓN DESDE EL MENÚ SUPERIOR (patrón Finanzas · 30-sep-2026) ─────
// El shell entrega nav = {sub, n}: sub = subpantalla pedida en el menú, n = contador
// que sube en cada clic (así, volver a elegir la misma opción también navega).
// · subInicial: valor inicial del estado interno si la sub pedida es válida.
// · useNavMenu: aplica la sub al montar y en cada clic del menú, y avisa al shell
//   (onSub) la subpantalla activa para la ruta de navegación. Sin nav no hace nada.
const subInicial = (nav, validos, def) => (nav?.sub && validos.includes(nav.sub)) ? nav.sub : def
function useNavMenu(nav, aplicar, valor, onSub, validos) {
  const ult = useRef(null)
  useEffect(() => {
    if (!nav || nav.n === ult.current) return
    ult.current = nav.n
    if (nav.sub) aplicar(nav.sub)
  }, [nav?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (onSub && valor && (!validos || validos.includes(valor))) onSub(valor)
  }, [valor]) // eslint-disable-line react-hooks/exhaustive-deps
}

export { FONT, SIDEBAR_BG, BRAND_ORANGE, css, Bt, subInicial, useNavMenu }
