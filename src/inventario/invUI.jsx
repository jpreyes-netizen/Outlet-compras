/* ════════════════════════════════════════════════════════════════════
   invUI.jsx — piezas visuales de Inventario, con el mismo lenguaje que
   Finanzas: paneles blancos con título navy y acciones a la derecha,
   franja de indicadores en una sola barra, planillas con DataGrid y
   exportación con el exportador corporativo (finanzas/exportUtils).
   ════════════════════════════════════════════════════════════════════ */

import { useEffect } from 'react'

export const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', BORDE = '#E5E7EB', FONDO = '#F4F5F7'
export const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', AZUL = '#1D4E89', MORADO = '#5B2C6F'
export const PAPER = '#FAFAFB', TINTE = '#EEF1F7'
export const LINE = BORDE   // compatibilidad

/* ── Formatos (es-CL) ─────────────────────────────────────────────── */
const nf = (d = 0) => new Intl.NumberFormat('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d })
export const fmt = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
export const fN  = n => nf(0).format(Math.round(n || 0))
export const fD  = (n, d = 2) => nf(d).format(Number(n) || 0)
export const fMM = n => {
  const v = Math.abs(n || 0)
  if (v >= 1e9) return nf(2).format(n / 1e9) + ' MMM'
  if (v >= 1e6) return nf(1).format(n / 1e6) + ' MM'
  if (v >= 1e3) return Math.round(n / 1e3) + ' k'
  return String(Math.round(n || 0))
}
export const fCLP = n => '$' + fMM(n)
export const fPct = (n, d = 1) => n == null ? '—' : nf(d).format(n) + '%'

export const inputEstilo = {
  padding: '6px 9px', border: `1px solid ${BORDE}`, borderRadius: 6, fontSize: 12.5,
  background: '#fff', color: INK, font: 'inherit', outline: 'none',
}

/* ── Panel: idéntico al de Análisis ejecutivo de Finanzas ─────────── */
export function Panel({ titulo, sub, acciones, children, sinPadding, style }) {
  return (
    <section style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden', ...style }}>
      {(titulo || acciones) && (
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${BORDE}`, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            {titulo && <h2 style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>{titulo}</h2>}
            {sub && <div style={{ fontSize: 11, color: SLATE, marginTop: 1 }}>{sub}</div>}
          </div>
          {acciones}
        </header>
      )}
      <div style={{ padding: sinPadding ? 0 : 12 }}>{children}</div>
    </section>
  )
}

/* ── Franja de indicadores (como los libros de Finanzas) ──────────── */
export function KpiStrip({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflowX: 'auto' }}>
      {children}
    </div>
  )
}

/* Celda de indicador. Si tiene onClick, se comporta como enlace a la
   base de datos filtrada: cursor, foco por teclado y una flecha discreta. */
export function KpiCelda({ l, v, sub, color = INK, onClick, title, destacar }) {
  const cont = (
    <>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
        {l}{onClick && <span aria-hidden="true" style={{ color: '#B0B4BC', marginLeft: 4 }}>›</span>}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{v}</div>
      {sub ? <div style={{ fontSize: 10, color: SLATE, whiteSpace: 'nowrap' }}>{sub}</div> : null}
    </>
  )
  const base = { padding: '8px 14px', borderRight: `1px solid ${BORDE}`, minWidth: 118, textAlign: 'left',
                 background: destacar ? color + '0D' : 'transparent', flexShrink: 0 }
  if (!onClick) return <div style={base}>{cont}</div>
  return (
    <button onClick={onClick} title={title || 'Ver el detalle en la base de datos'} className="inv-clic"
            style={{ ...base, border: 'none', borderRight: `1px solid ${BORDE}`, cursor: 'pointer', font: 'inherit' }}>
      {cont}
    </button>
  )
}

/* ── Botones ──────────────────────────────────────────────────────── */
export function Boton({ children, onClick, activo, tono, title, disabled }) {
  const c = tono === 'primario' ? NAVY : SLATE
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      ...inputEstilo, cursor: disabled ? 'default' : 'pointer', fontWeight: 600, opacity: disabled ? 0.5 : 1,
      border: `1px solid ${activo ? c : BORDE}`, background: activo ? c : '#fff', color: activo ? '#fff' : c,
    }}>{children}</button>
  )
}

/* Par Excel / PDF, igual que en Finanzas */
export function Ex({ onExcel, onPdf }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      {onExcel && <button onClick={onExcel} style={{ ...inputEstilo, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>}
      {onPdf && <button onClick={onPdf} style={{ ...inputEstilo, cursor: 'pointer', fontWeight: 600, color: NAVY }}>PDF</button>}
    </span>
  )
}

/* Enlace de texto para "ver en la base de datos" */
export function Enlace({ children, onClick, color = NAVY }) {
  return (
    <button onClick={onClick} className="inv-enlace" style={{
      border: 'none', background: 'none', padding: 0, cursor: 'pointer', font: 'inherit',
      color, fontWeight: 600, fontSize: 'inherit', textDecoration: 'none',
    }}>{children}</button>
  )
}

export function Tag({ texto, color = SLATE }) {
  return <span style={{
    display: 'inline-block', padding: '1px 7px', borderRadius: 10, fontSize: 10.5, fontWeight: 700,
    color, background: color + '14', border: `1px solid ${color}33`, whiteSpace: 'nowrap',
  }}>{texto}</span>
}

/* ── Estados de carga ─────────────────────────────────────────────── */
export const Cargando = ({ children = 'Cargando…' }) =>
  <div style={{ padding: 40, textAlign: 'center', color: SLATE, fontSize: 13 }}>{children}</div>
export const Vacio = ({ children }) =>
  <div style={{ padding: 26, textAlign: 'center', color: SLATE, fontSize: 12.5 }}>{children}</div>
export const ErrorBox = ({ children }) =>
  <div style={{ padding: 12, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, color: ROJO, fontSize: 12.5 }}>{children}</div>

/* Aviso de contexto (ámbar o informativo) */
export function Aviso({ children, tono = 'ambar' }) {
  const c = tono === 'ambar' ? AMBAR : tono === 'rojo' ? ROJO : AZUL
  return <div style={{ background: c + '0F', border: `1px solid ${c}40`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: INK, lineHeight: 1.5 }}>{children}</div>
}

/* ── Leyenda "Cómo leer esto", siempre visible ───────────────────── */
export function Leyenda({ titulo = 'Cómo leer esto', items = [], nota }) {
  return (
    <div style={{ marginTop: 10, padding: '9px 12px', background: PAPER, border: `1px solid ${BORDE}`, borderRadius: 8, fontSize: 11.2, color: SLATE, lineHeight: 1.5 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>{titulo}</div>
      {items.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '4px 16px' }}>
          {items.map(it => (
            <div key={it.t} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              {it.c && <span style={{ width: 10, height: 10, borderRadius: 2, background: it.c, flexShrink: 0, marginTop: 3 }} />}
              <span><b style={{ color: INK }}>{it.t}</b>{it.d ? ' — ' + it.d : ''}</span>
            </div>
          ))}
        </div>
      )}
      {nota && <div style={{ marginTop: items.length ? 6 : 0 }}>{nota}</div>}
    </div>
  )
}

/* ── Barra apilada. Cada tramo puede llevar a la base filtrada ────── */
export function BarraApilada({ etiqueta, sub, tramos, fmtV = fCLP, ancho = 130, total: totalForzado, alto = 22, onTramo }) {
  const total = totalForzado ?? tramos.reduce((a, t) => a + (+t.v || 0), 0)
  const base = Math.max(total, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <div style={{ width: ancho, flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: INK, fontWeight: 700 }}>{etiqueta}</div>
        {sub && <div style={{ fontSize: 10, color: SLATE }}>{sub}</div>}
      </div>
      <div style={{ flex: 1, display: 'flex', height: alto, borderRadius: 4, overflow: 'hidden', background: BORDE }}>
        {tramos.map(t => {
          const v = +t.v || 0
          if (v <= 0) return null
          const pct = 100 * v / base
          const clic = onTramo && t.filtro !== false
          return (
            <div key={t.k} role={clic ? 'button' : undefined} tabIndex={clic ? 0 : undefined}
                 onClick={clic ? () => onTramo(t) : undefined}
                 onKeyDown={clic ? e => { if (e.key === 'Enter') onTramo(t) } : undefined}
                 title={`${t.l}: ${fmtV(v)} (${fD(pct, 1)}%)${clic ? ' — clic para ver el detalle' : ''}`}
                 className={clic ? 'inv-tramo' : undefined}
                 style={{ width: `${pct}%`, background: t.c, color: '#fff', fontSize: 10, fontWeight: 700, cursor: clic ? 'pointer' : 'default',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {pct >= 9 ? fmtV(v) : ''}
            </div>
          )
        })}
      </div>
      <div style={{ width: 74, fontSize: 12, color: INK, fontWeight: 700, textAlign: 'right', flexShrink: 0 }}>{fmtV(total)}</div>
    </div>
  )
}

/* ── Panel lateral: la ficha se abre sin perder la pantalla ni los filtros ── */
export function Drawer({ abierto, onCerrar, titulo, sub, children, ancho = 640 }) {
  useEffect(() => {
    if (!abierto) return
    const k = e => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [abierto, onCerrar])
  if (!abierto) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={titulo} onClick={onCerrar}
         style={{ position: 'fixed', inset: 0, background: 'rgba(15,24,48,0.35)', zIndex: 95 }}>
      <div onClick={e => e.stopPropagation()}
           style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `min(${ancho}px, 100vw)`, background: FONDO,
                    display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 32px rgba(22,33,62,0.18)' }}>
        <div style={{ background: NAVY, color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titulo}</div>
            {sub && <div style={{ fontSize: 11, opacity: 0.7 }}>{sub}</div>}
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" style={{ border: 'none', background: 'rgba(255,255,255,0.14)', color: '#fff',
            width: 32, height: 32, borderRadius: 6, cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        {/* Área con scroll + capa interior SIN altura fija. Si los paneles fueran hijos directos de un
            contenedor de alto fijo (flex o grid), el navegador repartiría ese alto entre ellos: como cada
            panel tiene overflow:hidden, se encogerían y el contenido quedaría recortado sin barra de scroll. */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>{children}</div>
        </div>
      </div>
    </div>
  )
}

/* Estilos de interacción compartidos (hover/foco de lo clicable) */
export const ESTILOS_INV = `
  .inv-clic:hover{background:${TINTE}!important}
  .inv-clic:focus-visible,.inv-tramo:focus-visible,.inv-enlace:focus-visible{outline:2px solid ${NAVY};outline-offset:-2px}
  .inv-tramo:hover{filter:brightness(1.12)}
  .inv-enlace:hover{text-decoration:underline!important}
  .inv-fila:hover td{background:${TINTE}}
`
