// src/rrhh/remuneraciones/remUi.jsx
// Piezas de interfaz de los reportes de Remuneraciones. Estilo ejecutivo del ERP:
// densidad alta, sin adornos, números alineados, tablas ordenables y exportables.
import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { fM } from './remDatos'

export const C = {
  navy: '#16213E', azul: '#175CD3', ambar: '#B25E09', rojo: '#B42318', verde: '#1E7A44', morado: '#6941C6',
  gris: '#6E6E73', tenue: '#8E96A3', borde: '#E5E7EB', fondo: '#F7F8FA', linea: '#F0F1F3', texto: '#1C1C1E',
}
export const NUM = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
export const NIVEL = { alto: C.rojo, medio: C.ambar, info: C.azul, bien: C.verde }
export const btn = { padding: '5px 11px', border: `1px solid ${C.borde}`, background: '#fff', color: C.navy, borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }
export const sel = { padding: '5px 8px', border: `1px solid ${C.borde}`, background: '#fff', color: C.texto, borderRadius: 6, fontSize: 12.5 }

export function Panel({ titulo, nota, acciones, children, sinPad, style }) {
  return (
    <section style={{ background: '#fff', border: `1px solid ${C.borde}`, borderRadius: 8, minWidth: 0, ...style }}>
      {(titulo || acciones) && (
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderBottom: `1px solid ${C.borde}` }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.navy }}>{titulo}</h3>
            {nota && <div style={{ fontSize: 11.5, color: C.gris, marginTop: 2, lineHeight: 1.4 }}>{nota}</div>}
          </div>
          {acciones && <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{acciones}</div>}
        </header>
      )}
      <div style={{ padding: sinPad ? 0 : 14 }}>{children}</div>
    </section>
  )
}

// Franja de indicadores: una sola banda con divisiones, no tarjetas sueltas.
export function Franja({ items }) {
  const vis = items.filter(Boolean)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 1, background: C.borde, border: `1px solid ${C.borde}`, borderRadius: 8, overflow: 'hidden' }}>
      {vis.map((it, i) => (
        <div key={i} title={it.ayuda || undefined} style={{ background: '#fff', padding: '10px 14px', minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: C.gris, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.l}{it.ayuda ? ' ⓘ' : ''}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: it.color || C.navy, letterSpacing: -0.3, marginTop: 2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.v}</div>
          {it.s ? <div style={{ fontSize: 11.5, color: it.sColor || C.gris, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.s}</div> : null}
          {it.s2 ? <div style={{ fontSize: 11, color: C.tenue, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.s2}</div> : null}
        </div>
      ))}
    </div>
  )
}

export function Seg({ valor, onChange, opciones }) {
  return (
    <div style={{ display: 'inline-flex', background: C.fondo, border: `1px solid ${C.borde}`, borderRadius: 7, padding: 2, gap: 2 }}>
      {opciones.map(([k, l, dis]) => (
        <button key={k} type="button" disabled={!!dis} onClick={() => onChange(k)} aria-pressed={valor === k}
          style={{ padding: '4px 10px', border: 'none', borderRadius: 5, cursor: dis ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 600, background: valor === k ? C.navy : 'transparent', color: valor === k ? '#fff' : dis ? '#C0C4CC' : C.gris }}>{l}</button>
      ))}
    </div>
  )
}

export const Fila2 = ({ min = 460, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`, gap: 12, alignItems: 'start' }}>{children}</div>
)

export function Vacio({ titulo, texto, accion }) {
  return (
    <div style={{ padding: '48px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.navy }}>{titulo}</div>
      {texto && <div style={{ fontSize: 12.5, color: C.gris, marginTop: 6 }}>{texto}</div>}
      {accion && <div style={{ marginTop: 14 }}>{accion}</div>}
    </div>
  )
}

// Tabla densa ordenable. cols: [{ k, l, num, f(v,fila), tono(v,fila), fondo(v,fila), sticky, negrita, max, ord(fila), pct, x(v,fila) }]
export function Tabla({ cols, filas, total, maxH, onFila, activa, vacio }) {
  const [orden, setOrden] = useState(null)
  const vis = useMemo(() => {
    if (!orden) return filas
    const c = cols.find(x => x.k === orden.k)
    if (!c) return filas
    const val = r => (c.ord ? c.ord(r) : r[c.k])
    return [...filas].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es')
      return orden.dir === 'asc' ? d : -d
    })
  }, [filas, orden, cols])
  if (!filas.length) return <div style={{ padding: 22, textAlign: 'center', color: C.gris, fontSize: 12.5 }}>{vacio || 'Sin datos para el período.'}</div>
  const th = { padding: '6px 10px', fontSize: 11.5, fontWeight: 600, color: C.gris, background: '#FAFBFC', borderBottom: `1px solid ${C.borde}`, position: 'sticky', top: 0, zIndex: 1, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }
  const valor = (c, r) => { const v = c.f ? c.f(r[c.k], r) : r[c.k]; return v == null || v === '' ? (c.num ? '—' : '') : v }
  const clic = c => setOrden(o => (o?.k === c.k ? (o.dir === 'desc' ? { k: c.k, dir: 'asc' } : null) : { k: c.k, dir: c.num ? 'desc' : 'asc' }))
  return (
    <div style={{ overflow: 'auto', maxHeight: maxH || 'none' }}>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5 }}>
        <thead>
          <tr>{cols.map(c => (
            <th key={c.k} onClick={() => clic(c)} title="Ordenar" style={{ ...th, textAlign: c.num ? 'right' : 'left', ...(c.sticky ? { left: 0, zIndex: 3 } : {}) }}>
              {c.l}{orden?.k === c.k ? (orden.dir === 'desc' ? ' ↓' : ' ↑') : ''}
            </th>))}
          </tr>
        </thead>
        <tbody>
          {vis.map((r, i) => {
            const k = r._k ?? i
            const act = activa != null && activa === k
            return (
              <tr key={k} onClick={onFila ? () => onFila(r) : undefined} style={{ cursor: onFila ? 'pointer' : 'default' }}>
                {cols.map(c => {
                  const bg = act ? '#EAF0F8' : (c.fondo ? c.fondo(r[c.k], r) : undefined) || (c.sticky ? '#fff' : undefined)
                  return (
                    <td key={c.k} style={{
                      padding: '5px 10px', borderBottom: `1px solid ${C.linea}`, ...(c.num ? NUM : {}), color: c.tono ? c.tono(r[c.k], r) : undefined, background: bg,
                      fontWeight: c.negrita ? 600 : 400, ...(c.sticky ? { position: 'sticky', left: 0, zIndex: 1 } : {}),
                      ...(c.max ? { maxWidth: c.max, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}),
                    }} title={c.max && typeof r[c.k] === 'string' ? r[c.k] : undefined}>{valor(c, r)}</td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        {total && (
          <tfoot>
            <tr>{cols.map(c => (
              <td key={c.k} style={{ padding: '6px 10px', borderTop: `1px solid ${C.navy}`, fontWeight: 700, background: '#FAFBFC', position: 'sticky', bottom: 0, ...(c.num ? NUM : {}), ...(c.sticky ? { left: 0, zIndex: 2 } : {}) }}>
                {total[c.k] == null ? '' : (c.f ? c.f(total[c.k], total) : total[c.k])}
              </td>))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// Exportación: números crudos (porcentajes en %), una hoja por tabla.
export function filasExport(cols, filas, total) {
  const uno = r => Object.fromEntries(cols.map(c => {
    const v = r[c.k]
    if (c.x) return [c.l, c.x(v, r)]
    if (typeof v === 'number') return [c.l, c.pct ? Math.round(v * 1000) / 10 : Math.round(v * 100) / 100]
    if (c.f && v != null && typeof v !== 'object') return [c.l, c.f(v, r)]
    return [c.l, v ?? '']
  }))
  const out = filas.map(uno)
  if (total) out.push(uno(total))
  return out
}
export function exportar(nombre, hojas) {
  const wb = XLSX.utils.book_new()
  hojas.filter(h => h.filas && h.filas.length).forEach(h => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(h.filas), String(h.nombre).slice(0, 31)))
  if (!wb.SheetNames.length) return
  XLSX.writeFile(wb, `${nombre}.xlsx`)
}
export const BotonExcel = ({ onClick }) => <button type="button" style={btn} onClick={onClick}>Exportar Excel</button>

// Tooltip de gráficos: cada serie puede tener su formato.
export function TT({ active, payload, label, formatos, fmtV }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.borde}`, borderRadius: 6, padding: '8px 10px', fontSize: 12, boxShadow: '0 4px 14px rgba(16,24,40,.12)', minWidth: 180 }}>
      {label != null && <div style={{ fontWeight: 600, marginBottom: 4, color: C.navy }}>{label}</div>}
      {payload.filter(x => x.value != null).map((x, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
          <span style={{ color: x.color || x.fill }}>{x.name}</span>
          <b style={NUM}>{((formatos && formatos[x.dataKey]) || fmtV || fM)(x.value)}</b>
        </div>
      ))}
    </div>
  )
}

// Cascada horizontal (puente de variación).
export function Cascada({ pasos, fmtV = fM }) {
  let run = 0
  const filas = pasos.map(p => {
    if (p.tipo === 'total') { run = p.v; return { ...p, desde: 0, hasta: p.v } }
    const r = { ...p, desde: run, hasta: run + p.v }
    run += p.v
    return r
  })
  const max = Math.max(1, ...filas.map(f => Math.max(f.desde, f.hasta)))
  const min = Math.min(0, ...filas.map(f => Math.min(f.desde, f.hasta)))
  const esc = v => ((v - min) / (max - min || 1)) * 100
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {filas.map((f, i) => {
        const a = esc(Math.min(f.desde, f.hasta)), b = esc(Math.max(f.desde, f.hasta))
        const color = f.tipo === 'total' ? C.navy : f.v > 0 ? C.rojo : C.verde
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 230px) 1fr 104px', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
            <div style={{ color: C.texto, fontWeight: f.tipo === 'total' ? 600 : 400, lineHeight: 1.3 }}>
              {f.l}{f.s && <div style={{ fontSize: 11, color: C.gris, fontWeight: 400 }}>{f.s}</div>}
            </div>
            <div style={{ position: 'relative', height: 18, background: C.fondo, borderRadius: 3 }}>
              <div style={{ position: 'absolute', left: `${a}%`, width: `${Math.max(b - a, 0.5)}%`, top: 3, bottom: 3, background: color, borderRadius: 2 }} />
            </div>
            <div style={{ ...NUM, fontWeight: 600, color: f.tipo === 'total' ? C.navy : color }}>
              {f.tipo === 'total' ? fmtV(f.v) : `${f.v > 0 ? '+' : f.v < 0 ? '−' : ''}${fmtV(Math.abs(f.v))}`}
            </div>
          </div>
        )
      })}
    </div>
  )
}
