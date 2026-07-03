import { useState, useMemo, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { Maximize2, Minimize2, Download, Filter as FilterIcon, X } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════════
// DataGrid — tabla estilo Excel reutilizable (Desde banco + Desde factura)
// Piezas: ordenar por columna, redimensionar y reordenar columnas (drag),
// filtro por columna, exportar .xlsx (lo filtrado), vista pantalla completa.
//
// Props:
//   columns: [{ key, label, align?, width?, sortable?, filterable?, render?(row), value?(row), exportValue?(row) }]
//     - value(row): valor primitivo para ordenar/filtrar/exportar (default row[key])
//     - render(row): JSX para mostrar (default value)
//   rows: array de datos
//   getRowId(row): id único
//   selectedId, onRowClick(row): selección de fila (opcional)
//   rowStyle(row): estilo extra por fila (opcional)
//   leadingCell(row): celda extra al inicio, ej. checkbox (opcional)
//   leadingHeader: encabezado de la celda inicial (opcional)
//   toolbar: JSX extra en la barra superior (opcional)
//   title: título de la tabla
//   exportName: nombre base del archivo xlsx
//   loading, emptyText
// ═══════════════════════════════════════════════════════════════════════
export function DataGrid({
  columns, rows, getRowId, selectedId, onRowClick, rowStyle, leadingCell, leadingHeader,
  toolbar, title = 'Datos', exportName = 'export', loading = false, emptyText = 'Sin datos',
}) {
  const [orden, setOrden] = useState({ key: null, dir: 'asc' })
  const [filtros, setFiltros] = useState({})            // { colKey: texto }
  const [filtroAbierto, setFiltroAbierto] = useState(null)
  const [anchos, setAnchos] = useState({})              // { colKey: px }
  const [ordenCols, setOrdenCols] = useState(columns.map(c => c.key))  // orden visual de columnas
  const [fullscreen, setFullscreen] = useState(false)
  const dragCol = useRef(null)
  const resizing = useRef(null)

  const colByKey = useMemo(() => Object.fromEntries(columns.map(c => [c.key, c])), [columns])
  const colsVisibles = useMemo(() => ordenCols.map(k => colByKey[k]).filter(Boolean), [ordenCols, colByKey])

  const valorDe = useCallback((row, col) => {
    if (col.value) return col.value(row)
    return row[col.key]
  }, [])

  // ─── Ordenar ───
  function ordenarPor(key) {
    const col = colByKey[key]
    if (col?.sortable === false) return
    setOrden(o => o.key === key ? { key, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  // ─── Filtrar + ordenar (deriva las filas visibles) ───
  const filas = useMemo(() => {
    let out = rows
    // filtros por columna (texto contiene, case-insensitive)
    const activos = Object.entries(filtros).filter(([, v]) => v?.trim())
    if (activos.length) {
      out = out.filter(row => activos.every(([k, v]) => {
        const col = colByKey[k]; if (!col) return true
        const val = valorDe(row, col)
        return String(val ?? '').toLowerCase().includes(v.trim().toLowerCase())
      }))
    }
    if (orden.key) {
      const col = colByKey[orden.key]
      const factor = orden.dir === 'asc' ? 1 : -1
      out = [...out].sort((a, b) => {
        let va = valorDe(a, col), vb = valorDe(b, col)
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor
        va = String(va ?? '').toLowerCase(); vb = String(vb ?? '').toLowerCase()
        return va < vb ? -factor : va > vb ? factor : 0
      })
    }
    return out
  }, [rows, filtros, orden, colByKey, valorDe])

  // ─── Exportar a .xlsx (lo que se ve filtrado/ordenado) ───
  function exportar() {
    const data = filas.map(row => {
      const o = {}
      colsVisibles.forEach(col => {
        const raw = col.exportValue ? col.exportValue(row) : valorDe(row, col)
        o[col.label] = raw ?? ''
      })
      return o
    })
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Datos')
    const fecha = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `${exportName}_${fecha}.xlsx`)
  }

  // ─── Redimensionar columnas ───
  function iniciarResize(e, key) {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const startW = anchos[key] ?? colByKey[key]?.width ?? 120
    resizing.current = { key, startX, startW }
    const onMove = ev => {
      if (!resizing.current) return
      const dw = ev.clientX - resizing.current.startX
      const nuevo = Math.max(60, resizing.current.startW + dw)
      setAnchos(a => ({ ...a, [resizing.current.key]: nuevo }))
    }
    const onUp = () => { resizing.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ─── Reordenar columnas (drag & drop de encabezados) ───
  function onDragStart(key) { dragCol.current = key }
  function onDrop(targetKey) {
    const from = dragCol.current
    if (!from || from === targetKey) return
    setOrdenCols(prev => {
      const arr = [...prev]
      const iFrom = arr.indexOf(from), iTo = arr.indexOf(targetKey)
      arr.splice(iFrom, 1); arr.splice(iTo, 0, from)
      return arr
    })
    dragCol.current = null
  }

  const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748B', background: '#F8FAFC', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2, userSelect: 'none' }
  const TD = { padding: '7px 10px', fontSize: 12, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

  const contenido = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#fff', borderRadius: fullscreen ? 0 : 12, border: fullscreen ? 'none' : '1px solid #E2E8F0', overflow: 'hidden' }}>
      {/* Barra superior */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #F1F5F9', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1E293B' }}>{title}</span>
        <span style={{ fontSize: 11, color: '#94A3B8' }}>{filas.length} fila{filas.length !== 1 ? 's' : ''}</span>
        {Object.values(filtros).some(v => v?.trim()) && (
          <button onClick={() => setFiltros({})} style={{ fontSize: 10, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontWeight: 600 }}>✕ Limpiar filtros</button>
        )}
        <div style={{ flex: 1 }} />
        {toolbar}
        <button onClick={exportar} title="Exportar a Excel" style={btnIcon}><Download size={14} /> Excel</button>
        <button onClick={() => setFullscreen(f => !f)} title={fullscreen ? 'Salir' : 'Pantalla completa'} style={btnIcon}>
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Tabla */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            {leadingCell && <col style={{ width: 34 }} />}
            {colsVisibles.map(c => <col key={c.key} style={{ width: (anchos[c.key] ?? c.width ?? 130) + 'px' }} />)}
          </colgroup>
          <thead>
            <tr>
              {leadingCell && <th style={{ ...TH, width: 34 }}>{leadingHeader}</th>}
              {colsVisibles.map(col => {
                const activo = orden.key === col.key
                const filtroOn = filtros[col.key]?.trim()
                return (
                  <th key={col.key} style={{ ...TH, textAlign: col.align || 'left', position: 'relative' }}
                    draggable onDragStart={() => onDragStart(col.key)} onDragOver={e => e.preventDefault()} onDrop={() => onDrop(col.key)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start' }}>
                      <span onClick={() => ordenarPor(col.key)} style={{ cursor: col.sortable === false ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        {col.label}
                        {col.sortable !== false && <span style={{ fontSize: 9, color: activo ? '#3B82F6' : '#CBD5E1', fontWeight: 700 }}>{activo ? (orden.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>}
                      </span>
                      {col.filterable !== false && (
                        <button onClick={e => { e.stopPropagation(); setFiltroAbierto(filtroAbierto === col.key ? null : col.key) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 1, color: filtroOn ? '#3B82F6' : '#CBD5E1', display: 'inline-flex' }}>
                          <FilterIcon size={11} />
                        </button>
                      )}
                    </div>
                    {filtroAbierto === col.key && col.filterable !== false && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 5, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 8, minWidth: 160 }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input autoFocus value={filtros[col.key] ?? ''} onChange={e => setFiltros(f => ({ ...f, [col.key]: e.target.value }))}
                            placeholder={`Filtrar ${col.label}…`} style={{ flex: 1, padding: '5px 8px', fontSize: 11, border: '1px solid #D1D5DB', borderRadius: 6, textTransform: 'none' }} />
                          <button onClick={() => { setFiltros(f => ({ ...f, [col.key]: '' })); setFiltroAbierto(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 2 }}><X size={13} /></button>
                        </div>
                      </div>
                    )}
                    {/* Handle de redimensión */}
                    <span onMouseDown={e => iniciarResize(e, col.key)}
                      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 3 }} />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={colsVisibles.length + (leadingCell ? 1 : 0)} style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>Cargando…</td></tr>}
            {!loading && filas.length === 0 && <tr><td colSpan={colsVisibles.length + (leadingCell ? 1 : 0)} style={{ padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>{emptyText}</td></tr>}
            {!loading && filas.map(row => {
              const id = getRowId(row)
              const sel = id === selectedId
              const extra = rowStyle ? rowStyle(row) : {}
              return (
                <tr key={id} onClick={() => onRowClick?.(row)}
                  style={{ cursor: onRowClick ? 'pointer' : 'default', borderTop: '1px solid #F1F5F9', outline: sel ? '2px solid #3B82F6' : 'none', outlineOffset: -2, ...extra }}>
                  {leadingCell && <td style={{ ...TD, textAlign: 'center' }} onClick={e => e.stopPropagation()}>{leadingCell(row)}</td>}
                  {colsVisibles.map(col => (
                    <td key={col.key} style={{ ...TD, textAlign: col.align || 'left' }}
                      title={typeof valorDe(row, col) === 'string' ? valorDe(row, col) : undefined}>
                      {col.render ? col.render(row) : valorDe(row, col)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )

  if (fullscreen) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(15,23,42,0.4)', padding: 16 }}>
        <div style={{ height: '100%', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>{contenido}</div>
      </div>
    )
  }
  return contenido
}

const btnIcon = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 7,
  border: '1px solid #E2E8F0', background: '#fff', fontSize: 11, fontWeight: 600, color: '#475569', cursor: 'pointer',
}
