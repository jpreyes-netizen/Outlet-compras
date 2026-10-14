/* ════════════════════════════════════════════════════════════════════
   invUI.jsx — componentes compartidos del módulo Inventario
   Estética ejecutiva: densidad alta, cromo mínimo.
   ════════════════════════════════════════════════════════════════════ */

import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'

export const INK = '#1C1C1E', SLATE = '#6E6E73', LINE = '#E3E3E6', PAPER = '#FAFAFB'
export const NAVY = '#16213E', ROJO = '#B42318', VERDE = '#1E7A44'
export const AMBAR = '#B25E09', AZUL = '#1D4E89', MORADO = '#5B2C6F'

export const fmt = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
export const fN  = n => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))
export const fD  = (n, d = 2) => new Intl.NumberFormat('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n) || 0)
export const fMM = n => {
  const v = Math.abs(n || 0)
  const d = (x, k) => new Intl.NumberFormat('es-CL', { minimumFractionDigits: k, maximumFractionDigits: k }).format(x)
  if (v >= 1e9) return d(n / 1e9, 2) + ' MMM'
  if (v >= 1e6) return d(n / 1e6, 1) + ' MM'
  if (v >= 1e3) return Math.round(n / 1e3) + ' k'
  return String(Math.round(n || 0))
}

export const fCLP = n => '$' + fMM(n)

export function Kpi({ label, valor, sub, color, alerta }) {
  return (
    <div style={{
      background: '#fff', border: `1px solid ${alerta ? ROJO + '40' : LINE}`,
      borderLeft: `3px solid ${color || SLATE}`, borderRadius: 4,
      padding: '8px 11px', flex: '1 1 132px', minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: SLATE, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color || INK, letterSpacing: '-.02em', lineHeight: 1.2 }}>{valor}</div>
      {sub && <div style={{ fontSize: 10.5, color: SLATE, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

export function Tag({ texto, color }) {
  const c = color || SLATE
  return <span style={{
    display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 10,
    fontWeight: 700, color: c, background: c + '18', border: `1px solid ${c}30`, whiteSpace: 'nowrap',
  }}>{texto}</span>
}

export function Panel({ titulo, sub, children, accion }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 4, padding: '11px 13px', marginBottom: 10 }}>
      {titulo && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: INK }}>{titulo}</div>
          {sub && <div style={{ fontSize: 11, color: SLATE }}>{sub}</div>}
          {accion && <div style={{ marginLeft: 'auto' }}>{accion}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

export const inputEstilo = {
  padding: '5px 8px', border: `1px solid ${LINE}`, borderRadius: 4,
  fontSize: 12, background: '#fff', color: INK, font: 'inherit',
}

export function Boton({ children, onClick, activo, tono }) {
  const c = tono === 'primario' ? NAVY : SLATE
  return (
    <button onClick={onClick} style={{
      padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${activo ? c : LINE}`, borderRadius: 4, font: 'inherit',
      background: activo ? c : '#fff', color: activo ? '#fff' : c,
    }}>{children}</button>
  )
}

export function Vacio({ children }) {
  return <div style={{ padding: 26, textAlign: 'center', color: SLATE, fontSize: 12.5 }}>{children}</div>
}

export function Cargando({ children = 'Cargando…' }) {
  return <div style={{ padding: 40, textAlign: 'center', color: SLATE, fontSize: 13 }}>{children}</div>
}

export function ErrorBox({ children }) {
  return (
    <div style={{ padding: 14, background: ROJO + '10', border: `1px solid ${ROJO}40`, borderRadius: 4, color: ROJO, fontSize: 12.5 }}>
      {children}
    </div>
  )
}

/* ── Exportar a Excel ─────────────────────────────────────────────── */
export function exportarXlsx(filas, cols, nombre) {
  if (!filas?.length) return
  const datos = filas.map(f => Object.fromEntries(
    cols.map(c => [c.l, c.crudo ? c.crudo(f) : f[c.k]])))
  const hoja = XLSX.utils.json_to_sheet(datos)
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Datos')
  XLSX.writeFile(libro, `${nombre}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

/* ── Tabla ordenable con exportación ──────────────────────────────── */
export function Tabla({ cols, filas, ordenInicial, onFila, nombreExport, tope = 400 }) {
  const [orden, setOrden] = useState(ordenInicial || null)

  const ordenadas = useMemo(() => {
    if (!orden?.col) return filas
    const { col, dir } = orden
    return [...filas].sort((a, b) => {
      const va = a[col], vb = b[col]
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb : String(va).localeCompare(String(vb), 'es')
      return dir === 'asc' ? cmp : -cmp
    })
  }, [filas, orden])

  const toggle = c => setOrden(o =>
    o?.col === c ? { col: c, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { col: c, dir: 'desc' })

  return (
    <>
      {nombreExport && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <Boton onClick={() => exportarXlsx(ordenadas, cols, nombreExport)}>
            Exportar {fN(ordenadas.length)} filas a Excel
          </Boton>
        </div>
      )}
      <div style={{ overflowX: 'auto', border: `1px solid ${LINE}`, borderRadius: 4, background: '#fff' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: PAPER }}>
              {cols.map(c => (
                <th key={c.k} onClick={() => toggle(c.k)}
                  style={{
                    padding: '7px 9px', textAlign: c.num ? 'right' : 'left', cursor: 'pointer',
                    fontSize: 10.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase',
                    letterSpacing: '.03em', borderBottom: `1px solid ${LINE}`,
                    position: 'sticky', top: 0, background: PAPER, whiteSpace: 'nowrap',
                  }}>
                  {c.l}{orden?.col === c.k ? (orden.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordenadas.slice(0, tope).map((f, i) => (
              <tr key={(f.sku || i) + '|' + (f.sucursal_id || '')}
                onClick={onFila ? () => onFila(f) : undefined}
                style={{
                  borderBottom: `1px solid ${LINE}`, background: i % 2 ? '#FCFCFD' : '#fff',
                  cursor: onFila ? 'pointer' : 'default',
                }}>
                {cols.map(c => (
                  <td key={c.k} style={{
                    padding: '6px 9px', textAlign: c.num ? 'right' : 'left', color: INK,
                    whiteSpace: c.wrap ? 'normal' : 'nowrap', maxWidth: c.wrap ? 250 : undefined,
                    fontVariantNumeric: c.num ? 'tabular-nums' : undefined,
                  }}>
                    {c.render ? c.render(f) : (c.num ? fN(f[c.k]) : (f[c.k] ?? '—'))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!ordenadas.length && <Vacio>Sin resultados con los filtros actuales.</Vacio>}
        {ordenadas.length > tope && (
          <div style={{ padding: '7px 10px', fontSize: 11, color: SLATE, borderTop: `1px solid ${LINE}` }}>
            Mostrando {tope} de {fN(ordenadas.length)} filas. Exporta a Excel para ver todas.
          </div>
        )}
      </div>
    </>
  )
}

/* ── Leyenda: "cómo leer esto" en lenguaje de negocio ─────────────────
   items: [{ c: color, t: 'Nombre', d: 'qué significa y qué hacer' }]
   Se muestra siempre abierta: una leyenda que hay que buscar no se lee. */
export function Leyenda({ titulo = 'Cómo leer esto', items = [], nota }) {
  return (
    <div style={{
      marginTop: 9, padding: '8px 11px', background: PAPER, border: `1px solid ${LINE}`,
      borderRadius: 4, fontSize: 11.2, color: SLATE, lineHeight: 1.5,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: INK, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
        {titulo}
      </div>
      {items.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '4px 14px' }}>
          {items.map(it => (
            <div key={it.t} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              {it.c && <span style={{ width: 10, height: 10, borderRadius: 2, background: it.c, flexShrink: 0, marginTop: 3 }} />}
              <span><b style={{ color: INK }}>{it.t}</b>{it.d ? ' — ' + it.d : ''}</span>
            </div>
          ))}
        </div>
      )}
      {nota && <div style={{ marginTop: items.length ? 5 : 0 }}>{nota}</div>}
    </div>
  )
}

/* ── Barra apilada horizontal con etiqueta y total ───────────────────
   tramos: [{ k, l, c, v }]  ·  fmtV: formateador del total y tooltips */
export function BarraApilada({ etiqueta, sub, tramos, fmtV = fMM, ancho = 118, total: totalForzado, alto = 20 }) {
  const total = totalForzado ?? tramos.reduce((a, t) => a + (+t.v || 0), 0)
  const base = Math.max(total, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 7 }}>
      <div style={{ width: ancho, flexShrink: 0 }}>
        <div style={{ fontSize: 11.8, color: INK, fontWeight: 700 }}>{etiqueta}</div>
        {sub && <div style={{ fontSize: 10, color: SLATE }}>{sub}</div>}
      </div>
      <div style={{ flex: 1, display: 'flex', height: alto, borderRadius: 3, overflow: 'hidden', background: LINE }}>
        {tramos.map(t => {
          const v = +t.v || 0
          if (v <= 0) return null
          const pct = 100 * v / base
          return (
            <div key={t.k} title={`${t.l}: ${fmtV(v)} (${fD(pct, 1)}%)`}
                 style={{ width: `${pct}%`, background: t.c, color: '#fff', fontSize: 9.5, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {pct >= 9 ? fmtV(v) : ''}
            </div>
          )
        })}
      </div>
      <div style={{ width: 72, fontSize: 11.5, color: INK, fontWeight: 700, textAlign: 'right', flexShrink: 0 }}>{fmtV(total)}</div>
    </div>
  )
}
