// ============================================================
// Plano3DBodega.jsx  —  Vista isométrica 3D para el módulo Layout
// Outlet de Puertas · WMS
// ------------------------------------------------------------
// DISEÑO / ENTERPRISE:
//  · CERO dependencias nuevas — SVG isométrico puro. No Three.js.
//  · Reusa las tablas existentes `zonas` y `ubicaciones`. Sin cambios de esquema.
//  · Misma firma que PlanoEditor → se monta como una vista más en LayoutView.
//  · Estilo consistente con la app (SF Pro, #007AFF, tarjetas, css.body).
//  · Click en una zona → dispara onVerZona(zona) (tu flujo actual a lista_slots).
//
// INTEGRACIÓN (3 cambios aditivos, ver prompt adjunto):
//  1) import Plano3DView from './Plano3DBodega.jsx'
//  2) En LayoutView, agregar rama:  {vista==='plano3d' && <Plano3DView .../>}
//  3) En LayoutDashboard, un botón "Vista 3D" que llama onMapa3D(suc)
// ============================================================
import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'

// ── Paleta de estado de ocupación (coincide con semáforo de la app) ──────────
const OCC_COLOR = (pct) =>
  pct <= 0   ? { base:'#8E8E93', label:'Vacía' } :
  pct < 40   ? { base:'#34C759', label:'Baja'  } :
  pct < 75   ? { base:'#FF9500', label:'Media' } :
               { base:'#FF3B30', label:'Llena' }

// Color por tipo de zona — usa el color guardado en la zona si existe
const TIPO_COLOR = {
  rack:'#007AFF', piso_altura:'#5856D6', piso_profundidad:'#34C759',
  picking:'#FF9500', pasillo:'#C7C7CC', recepcion:'#30B0C7',
  despacho:'#FF2D55', transito:'#AF52DE', oficina:'#8E8E93',
  bano:'#8E8E93', bloqueado:'#636366',
}

// Aclara/oscurece un hex para las 3 caras del prisma isométrico
function tune(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.min(255, (n >> 16) + amt))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt))
  const b = Math.max(0, Math.min(255, (n & 255) + amt))
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}
const faces = (hex) => ({ top:tune(hex,26), right:tune(hex,-14), left:tune(hex,-40), stroke:tune(hex,-70) })

// Altura relativa del prisma según tipo (en "metros verticales" para el iso)
const ALTURA_TIPO = (tipo, niveles) => {
  const n = Math.max(1, niveles || 1)
  if (tipo === 'rack')             return 0.55 * n       // repisa por nivel
  if (tipo === 'piso_altura')      return 0.8  * n       // pallets apilados
  if (tipo === 'piso_profundidad') return 0.5             // acopio bajo
  if (tipo === 'picking')          return 0.7
  if (tipo === 'pasillo' || tipo === 'transito') return 0.04
  return 0.35
}

// ═════════════════════════════════════════════════════════════════
// RENDERER PURO — recibe zonas + ocupación ya calculada, dibuja SVG iso.
// Sin Supabase: testeable y reutilizable.
// ═════════════════════════════════════════════════════════════════
// Rota un footprint (rect axis-aligned) 90° CW k veces dentro del campo W×D
function rotRect(x, y, w, d, k, W, D) {
  for (let i = 0; i < (k % 4 + 4) % 4; i++) {
    const nx = D - (y + d), ny = x
    x = nx; y = ny
    const tw = w; w = d; d = tw
    const tW = W; W = D; D = tW
  }
  return { x, y, w, d, W, D }
}

export function IsoRenderer({ zonas, anchoBodega, largoBodega, colorMode='ocupacion',
                              seleccion=null, filtro='', rot=0, zoom=1, onSelect=()=>{} }) {
  const COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6)
  const PAD = 40
  const W0 = Math.max(4, anchoBodega || 40)
  const D0 = Math.max(4, largoBodega || 25)
  const fld = rotRect(0, 0, W0, D0, rot, W0, D0)   // campo rotado
  const W = fld.W, D = fld.D
  const maxAlt = Math.max(2, ...zonas.map(z => ALTURA_TIPO(z.tipo_zona, z.niveles) + 0.4))

  // Proyección iso + auto-escala al viewport (× zoom)
  const layout = useMemo(() => {
    const corners = []
    ;[[0,0],[W,0],[W,D],[0,D]].forEach(([x,y]) => {
      corners.push([(x - y) * COS, (x + y) * SIN])
      corners.push([(x - y) * COS, (x + y) * SIN - maxAlt])
    })
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const S = Math.min(900 / (maxX - minX), 560 / (maxY - minY)) * zoom
    return { S, offX:-minX*S+PAD, offY:-minY*S+PAD, w:(maxX-minX)*S+PAD*2, h:(maxY-minY)*S+PAD*2 }
  }, [W, D, maxAlt, zonas.length, zoom])

  const P = (x, y, z) =>
    ((x - y) * COS * layout.S + layout.offX).toFixed(1) + ',' +
    (((x + y) * SIN - z) * layout.S + layout.offY).toFixed(1)
  const poly = (pts) => pts.map(p => P(...p)).join(' ')

  const q = (filtro || '').trim().toLowerCase()

  // Piso + grilla
  const nodes = []
  nodes.push(<polygon key="floor" points={poly([[0,0,0],[W,0,0],[W,D,0],[0,D,0]])}
    fill="#FFFFFF" stroke="#E5E5EA" strokeWidth="1.5" />)
  for (let gx = 0; gx <= W; gx += 5) {
    const a = P(gx,0,0).split(','), b = P(gx,D,0).split(',')
    nodes.push(<line key={'gx'+gx} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#F2F2F7" strokeWidth="1" />)
  }
  for (let gy = 0; gy <= D; gy += 5) {
    const a = P(0,gy,0).split(','), b = P(W,gy,0).split(',')
    nodes.push(<line key={'gy'+gy} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#F2F2F7" strokeWidth="1" />)
  }

  // Rotar footprints, ordenar por profundidad (painter's algorithm) y dibujar
  const ord = zonas
    .filter(z => (z.pos_x||0) > 0 && (z.pos_y||0) > 0)
    .map(z => {
      const r = rotRect(z.pos_x, z.pos_y, Math.max(0.5, z.ancho_visual||6),
                        Math.max(0.5, z.alto_visual||5), rot, W0, D0)
      return { ...z, _x:r.x, _y:r.y, _w:r.w, _d:r.d }
    })
    .sort((a,b) => (a._x+a._y) - (b._x+b._y))

  ord.forEach(z => {
    const x = z._x, y = z._y, w = z._w, d = z._d
    const h = ALTURA_TIPO(z.tipo_zona, z.niveles)
    const match = !q || (z.codigo||'').toLowerCase().includes(q) ||
                        (z.nombre||'').toLowerCase().includes(q)
    const isSel = seleccion === z.id
    const op = q && !match ? 0.2 : 1

    const baseHex = colorMode === 'ocupacion'
      ? OCC_COLOR(z._occ ?? 0).base
      : (z.color || TIPO_COLOR[z.tipo_zona] || '#007AFF')
    const f = faces(baseHex)

    // Prisma: si es rack/piso_altura con niveles, dibuja franjas por nivel en la cara frontal
    const g = []
    const top   = poly([[x,y,h],[x+w,y,h],[x+w,y+d,h],[x,y+d,h]])
    const right = poly([[x+w,y,0],[x+w,y+d,0],[x+w,y+d,h],[x+w,y,h]])
    const left  = poly([[x,y+d,0],[x+w,y+d,0],[x+w,y+d,h],[x,y+d,h]])
    const stk = isSel ? '#007AFF' : f.stroke
    const sw  = isSel ? 2.4 : 0.7
    g.push(<polygon key="l" points={left}  fill={f.left}  stroke={stk} strokeWidth={sw} />)
    g.push(<polygon key="r" points={right} fill={f.right} stroke={stk} strokeWidth={sw} />)
    g.push(<polygon key="t" points={top}   fill={f.top}   stroke={stk} strokeWidth={sw} />)

    // Líneas de nivel en la cara izquierda (frontal visual) para racks apilados
    const nlev = z.tipo_zona === 'rack' || z.tipo_zona === 'piso_altura' ? Math.max(1, z.niveles||1) : 0
    for (let i = 1; i < nlev; i++) {
      const zz = h * i / nlev
      g.push(<polyline key={'nl'+i}
        points={poly([[x,y+d,zz],[x+w,y+d,zz]])}
        fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" />)
    }

    // Etiqueta código sobre la cara superior
    const c = P(x + w/2, y + d/2, h).split(',')
    g.push(<text key="lbl" x={c[0]} y={+c[1]+1} textAnchor="middle"
      fontSize={Math.max(8, Math.min(12, layout.S*0.16))} fontWeight="700"
      fill="rgba(0,0,0,0.72)" style={{ pointerEvents:'none' }}>{z.codigo}</text>)

    nodes.push(
      <g key={z.id} onClick={() => onSelect(z)}
         style={{ cursor:'pointer', opacity:op, transition:'opacity .2s' }}>{g}</g>
    )
  })

  return (
    <svg viewBox={`0 0 ${layout.w.toFixed(0)} ${layout.h.toFixed(0)}`} width="100%"
         preserveAspectRatio="xMidYMid meet"
         style={{ display:'block', fontFamily:"-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif" }}>
      {nodes}
    </svg>
  )
}

// ═════════════════════════════════════════════════════════════════
// VISTA CON DATOS — carga zonas + ubicaciones de la sucursal.
// Firma alineada con PlanoEditor para montarse igual en LayoutView.
// ═════════════════════════════════════════════════════════════════
export default function Plano3DView({ sucursalCodigo, sucs, cu, config, onBack, onVerZona }) {
  const [zonas, setZonas]     = useState([])
  const [loading, setLoading] = useState(true)
  const [colorMode, setColorMode] = useState('ocupacion') // 'ocupacion' | 'tipo'
  const [planta, setPlanta]   = useState(1)
  const [filtro, setFiltro]   = useState('')
  const [sel, setSel]         = useState(null)
  const [rot, setRot]         = useState(0)   // 0..3 → orientación de cámara (pasos de 90°)
  const [zoom, setZoom]       = useState(1)
  const ORIENT = ['Frente (SO)','Derecha (NO)','Fondo (NE)','Izquierda (SE)']

  const cfgA = parseFloat(config?.[`layout_${sucursalCodigo}_ancho_m`] || config?.layout_lg_ancho_m || 0) || 45
  const cfgL = parseFloat(config?.[`layout_${sucursalCodigo}_largo_m`] || config?.layout_lg_largo_m || 0) || 25

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setLoading(true)
      // 1) zonas de la sucursal
      const { data: zs } = await supabase.from('log_zonas')
        .select('id,codigo,nombre,tipo_zona,color,pos_x,pos_y,ancho_visual,alto_visual,niveles,nivel_planta,sucursal_codigo')
        .eq('sucursal_codigo', sucursalCodigo)
      // 2) slots para calcular ocupación por zona
      const { data: us } = await supabase.from('log_ubicaciones')
        .select('zona_id,stock_pallets_actual,capacidad_pallets,capacidad_max_unidades,sku_asignado,activa')
        .eq('sucursal_codigo', sucursalCodigo)
      if (!vivo) return
      const porZona = {}
      ;(us || []).forEach(u => {
        if (u.activa === false) return
        const k = u.zona_id; if (!porZona[k]) porZona[k] = { ocup:0, cap:0, usados:0, total:0 }
        const cap = u.capacidad_pallets || u.capacidad_max_unidades || 0
        const st  = u.stock_pallets_actual || 0
        porZona[k].cap += cap; porZona[k].ocup += st
        porZona[k].total += 1; if (u.sku_asignado) porZona[k].usados += 1
      })
      const enriquecidas = (zs || []).map(z => {
        const a = porZona[z.id]
        const occ = a ? (a.cap > 0 ? Math.round(a.ocup / a.cap * 100)
                                   : Math.round((a.usados / Math.max(1,a.total)) * 100)) : 0
        return { ...z, _occ:occ, _slots:a?.total||0 }
      })
      setZonas(enriquecidas)
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [sucursalCodigo])

  const plantas = useMemo(() => [...new Set(zonas.map(z => z.nivel_planta || 1))].sort(), [zonas])
  const zonasPlanta = zonas.filter(z => (z.nivel_planta || 1) === planta)
  const sucNombre = sucs?.find(s => s.codigo === sucursalCodigo)?.nombre || sucursalCodigo

  const legend = colorMode === 'ocupacion'
    ? [{c:'#8E8E93',l:'Vacía'},{c:'#34C759',l:'Baja'},{c:'#FF9500',l:'Media'},{c:'#FF3B30',l:'Llena'}]
    : Object.entries({rack:'Rack',piso_altura:'Apilado',piso_profundidad:'Acopio',picking:'Picking',pasillo:'Pasillo'})
        .map(([k,l]) => ({ c:TIPO_COLOR[k], l }))

  const btn = (activo) => ({
    border:'none', borderRadius:8, height:32, padding:'0 14px', cursor:'pointer',
    fontSize:13, fontWeight:600, fontFamily:'inherit',
    background: activo ? '#007AFF' : '#FFFFFF',
    color: activo ? '#FFF' : '#3C3C3E',
    boxShadow: activo ? 'none' : 'inset 0 0 0 1px #E5E5EA',
  })
  const camBtn = {
    width:34, height:34, border:'none', borderRadius:7, background:'#F2F2F7',
    cursor:'pointer', fontSize:16, color:'#3C3C3E', fontFamily:'inherit',
  }

  return (
    <div style={{ padding:0 }}>
      {/* Barra de controles */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ fontSize:16, fontWeight:800, color:'#1C1C1E', marginRight:'auto' }}>
          🧊 Vista 3D — {sucNombre}
        </div>
        <input value={filtro} onChange={e => setFiltro(e.target.value)}
          placeholder="Buscar zona / código…"
          style={{ height:32, padding:'0 12px', borderRadius:8, border:'1px solid #E5E5EA',
                   fontSize:13, fontFamily:'inherit', outline:'none', width:180 }} />
        <div style={{ display:'flex', gap:6 }}>
          <button style={btn(colorMode==='ocupacion')} onClick={() => setColorMode('ocupacion')}>Ocupación</button>
          <button style={btn(colorMode==='tipo')}       onClick={() => setColorMode('tipo')}>Tipo</button>
        </div>
        {plantas.length > 1 && (
          <div style={{ display:'flex', gap:6 }}>
            {plantas.map(p => (
              <button key={p} style={btn(planta===p)} onClick={() => setPlanta(p)}>Planta {p}</button>
            ))}
          </div>
        )}
      </div>

      {/* Lienzo */}
      <div style={{ position:'relative', background:'#F7F8FA', borderRadius:16, border:'1px solid #E5E5EA',
                    padding:'18px 16px', overflow:'auto', minHeight:360 }}>
        {/* Controles de cámara: rotación 90° + zoom (sin orbitar libre, a propósito) */}
        {!loading && zonasPlanta.length > 0 && (
          <div style={{ position:'absolute', top:14, right:14, zIndex:5,
                        display:'flex', flexDirection:'column', gap:8, alignItems:'flex-end' }}>
            <div style={{ display:'flex', gap:6, background:'#fff', border:'1px solid #E5E5EA',
                          borderRadius:10, padding:5, boxShadow:'0 2px 8px rgba(0,0,0,0.06)' }}>
              <button title="Rotar izquierda" onClick={() => setRot(r => (r+3)%4)} style={camBtn}>⟲</button>
              <button title="Rotar derecha"   onClick={() => setRot(r => (r+1)%4)} style={camBtn}>⟳</button>
              <div style={{ width:1, background:'#E5E5EA', margin:'2px 2px' }} />
              <button title="Alejar"  onClick={() => setZoom(z => Math.max(0.6, +(z-0.25).toFixed(2)))} style={camBtn}>−</button>
              <button title="Acercar" onClick={() => setZoom(z => Math.min(2.4, +(z+0.25).toFixed(2)))} style={camBtn}>+</button>
            </div>
            <div style={{ fontSize:11, fontWeight:600, color:'#8E8E93', background:'#fff',
                          border:'1px solid #E5E5EA', borderRadius:7, padding:'3px 8px' }}>
              📍 {ORIENT[rot]}
            </div>
          </div>
        )}
        {loading
          ? <div style={{ textAlign:'center', padding:'80px 0', color:'#8E8E93', fontSize:14 }}>Cargando layout…</div>
          : zonasPlanta.length === 0
            ? <div style={{ textAlign:'center', padding:'80px 0', color:'#8E8E93', fontSize:14 }}>
                Esta planta no tiene zonas con posición asignada.<br/>Colócalas en el Plano 2D primero.
              </div>
            : <IsoRenderer zonas={zonasPlanta} anchoBodega={cfgA} largoBodega={cfgL}
                colorMode={colorMode} seleccion={sel?.id} filtro={filtro} rot={rot} zoom={zoom}
                onSelect={(z) => setSel(z)} />
        }
      </div>

      {/* Leyenda + detalle */}
      <div style={{ display:'flex', gap:16, marginTop:12, flexWrap:'wrap', alignItems:'flex-start' }}>
        <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
          {legend.map(x => (
            <div key={x.l} style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ width:14, height:14, borderRadius:4, background:x.c }} />
              <span style={{ fontSize:12, color:'#3C3C3E' }}>{x.l}</span>
            </div>
          ))}
        </div>
        {sel && (
          <div style={{ marginLeft:'auto', background:'#FFF', border:'1px solid #E5E5EA',
                        borderRadius:12, padding:'10px 14px', display:'flex', gap:16, alignItems:'center' }}>
            <div>
              <div style={{ fontSize:11, color:'#8E8E93' }}>{sel.codigo}</div>
              <div style={{ fontSize:14, fontWeight:700, color:'#1C1C1E' }}>{sel.nombre}</div>
              <div style={{ fontSize:11, color:'#8E8E93', marginTop:2 }}>
                {sel._occ}% ocupación · {sel._slots} posiciones
              </div>
            </div>
            {onVerZona && (
              <button style={btn(true)} onClick={() => onVerZona(sel)}>Ver posiciones →</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
