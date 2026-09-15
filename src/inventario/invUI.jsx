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
export const fD  = (n, d = 2) => (Number(n) || 0).toFixed(d)
export const fMM = n => {
  const v = Math.abs(n || 0)
  if (v >= 1e9) return (n / 1e9).toFixed(2) + ' MMM'
  if (v >= 1e6) return (n / 1e6).toFixed(1) + ' MM'
  if (v >= 1e3) return Math.round(n / 1e3) + ' k'
  return String(Math.round(n || 0))
}

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
