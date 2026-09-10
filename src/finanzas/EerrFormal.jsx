import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { exportarPDF } from './exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   EERR — MAESTRO ÚNICO (eerr_lineas) · tres lecturas del mismo formato
   · Devengo (contabilidad): libro mayor mapeado a las líneas de gestión
   · Caja (gestión): la lectura histórica (BSALE + banco + RRHH + manuales)
   · Paralelo: línea a línea, devengo − caja, con la explicación
   Matriz mensual con total, promedio, % sobre venta y tendencia.
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73'
const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', FONDO = '#F9FAFB'
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const fmt = n => (n == null || n === 0 ? '–' : new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n))))
const TH = { padding: '6px 8px', fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4,
  borderBottom: `1px solid ${BORDE}`, background: FONDO, position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap', textAlign: 'right' }
const TD = { padding: '5px 8px', fontSize: 11.5, color: INK, borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }

const SECCIONES = { ventas: 'Ventas y margen', operacion: 'Gastos de operación', venta: 'Gastos de venta', admin: 'Gastos operativos y administración', financiero: 'Financiero e impuestos', mp: 'Movimiento de plata (informativo, no afecta resultado)' }

/* Estructura del estado: subtotales calculados desde las líneas del maestro */
function construir(lineas, datos) {
  const val = (cod, i) => Number(datos[cod]?.[i] ?? 0)
  const suma = (cods, i) => cods.reduce((s, c) => s + val(c, i), 0)
  const lin = sec => lineas.filter(l => l.seccion === sec && !l.es_subtotal).map(l => l.codigo)
  const filas = []
  const push = (codigo, nombre, tipo, calc, nivel = 'detalle', seccion = null) =>
    filas.push({ codigo, nombre, tipo, nivel, seccion, valores: MESES.map((_, i) => calc(i)) })

  const oper = lin('operacion'), venta = lin('venta'), admin = lin('admin').filter(c => c !== 'DEPRECIACION')
  const fin = lin('financiero').filter(c => !['IMPUESTO_RENTA', 'OTROS_INGRESOS', 'IVA_SII'].includes(c))

  push('VENTA_NETA', 'Venta neta (sin IVA)', null, i => val('VENTA_NETA', i), 'detalle', 'ventas')
  push('COSTO_NETO', 'Costo de ventas', 'Variable', i => -val('COSTO_NETO', i), 'detalle', 'ventas')
  push('MARGEN_CONTRIB', 'MARGEN BRUTO', null, i => val('VENTA_NETA', i) - val('COSTO_NETO', i), 'subtotal')
  lineas.filter(l => oper.includes(l.codigo)).forEach(l => push(l.codigo, l.nombre, l.tipo_costo, i => -val(l.codigo, i), 'detalle', 'operacion'))
  push('TOTAL_GASTO_OPER', 'Total gasto operación', null, i => -suma(oper, i), 'subtotal')
  push('TOTAL_MARGEN_BRUTO', 'MARGEN DESPUÉS DE OPERACIÓN', null, i => val('VENTA_NETA', i) - val('COSTO_NETO', i) - suma(oper, i), 'subtotal')
  lineas.filter(l => venta.includes(l.codigo)).forEach(l => push(l.codigo, l.nombre, l.tipo_costo, i => -val(l.codigo, i), 'detalle', 'venta'))
  push('TOTAL_GASTO_VENTA', 'Total gasto venta', null, i => -suma(venta, i), 'subtotal')
  lineas.filter(l => admin.includes(l.codigo)).forEach(l => push(l.codigo, l.nombre, l.tipo_costo, i => -val(l.codigo, i), 'detalle', 'admin'))
  push('TOTAL_GASTO_OPERATIVO', 'Total gasto administración', null, i => -suma(admin, i), 'subtotal')
  push('EBITDA', 'EBITDA', null, i => val('VENTA_NETA', i) - val('COSTO_NETO', i) - suma(oper, i) - suma(venta, i) - suma(admin, i), 'subtotal')
  push('DEPRECIACION', 'Depreciación', 'Fijo', i => -val('DEPRECIACION', i), 'detalle', 'admin')
  push('RESULTADO_OPERACIONAL', 'RESULTADO OPERACIONAL (EBIT)', null,
    i => val('VENTA_NETA', i) - val('COSTO_NETO', i) - suma(oper, i) - suma(venta, i) - suma(admin, i) - val('DEPRECIACION', i), 'subtotal')
  push('OTROS_INGRESOS', 'Otros ingresos no operacionales', null, i => val('OTROS_INGRESOS', i), 'detalle', 'financiero')
  lineas.filter(l => fin.includes(l.codigo)).forEach(l => push(l.codigo, l.nombre, l.tipo_costo, i => -val(l.codigo, i), 'detalle', 'financiero'))
  push('RAI', 'RESULTADO ANTES DE IMPUESTO', null,
    i => val('VENTA_NETA', i) - val('COSTO_NETO', i) - suma(oper, i) - suma(venta, i) - suma(admin, i) - val('DEPRECIACION', i) + val('OTROS_INGRESOS', i) - suma(fin, i), 'subtotal')
  push('IMPUESTO_RENTA', 'Impuesto a la renta (provisión)', 'Variable', i => -val('IMPUESTO_RENTA', i), 'detalle', 'financiero')
  push('RESULTADO_NETO', 'RESULTADO NETO', null,
    i => val('VENTA_NETA', i) - val('COSTO_NETO', i) - suma(oper, i) - suma(venta, i) - suma(admin, i) - val('DEPRECIACION', i) + val('OTROS_INGRESOS', i) - suma(fin, i) - val('IMPUESTO_RENTA', i), 'total')
  // Informativas (no afectan resultado)
  const mp = lineas.filter(l => l.seccion === 'mp' && !l.es_subtotal).map(l => l.codigo)
  lineas.filter(l => mp.includes(l.codigo) || l.codigo === 'IVA_SII').forEach(l => push(l.codigo, l.nombre, l.tipo_costo, i => -val(l.codigo, i), 'info', 'mp'))
  return filas
}

function Spark({ v }) {
  const pts = v.filter(x => x !== 0)
  if (pts.length < 2) return null
  const mn = Math.min(...pts), mx = Math.max(...pts), r = mx - mn || 1
  const d = v.map((x, i) => x === 0 ? null : `${(i / 11) * 60},${18 - ((x - mn) / r) * 16}`).filter(Boolean).join(' ')
  return <svg width="62" height="20"><polyline points={d} fill="none" stroke={SLATE} strokeWidth="1.2" /></svg>
}

const EDITABLES_CAJA = new Set(['COSTO_NETO', 'COMISION_GETNET'])
const ROLES_VEN_SOCIOS = new Set(['admin', 'dir_general', 'dir_negocios'])

export function EerrFormal({ modoInicial = 'devengo', titulo, cu }) {
  const [lineas, setLineas] = useState([])
  const [paralelo, setParalelo] = useState([])
  const [modo, setModo] = useState(modoInicial)
  const [detalle, setDetalle] = useState(null)   // { codigo, nombre, periodo|null, filas, cargando }
  const [anio] = useState(new Date().getFullYear())
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const [{ data: l }, { data: p, error }] = await Promise.all([
          supabase.from('eerr_lineas').select('id, codigo, nombre, seccion, tipo_costo, orden, es_subtotal, activo_devengo').eq('activo_devengo', true).order('orden'),
          supabase.from('v_eerr_paralelo').select('*').gte('periodo', `${anio}-01`).lte('periodo', `${anio}-12`).limit(2000),
        ])
        if (error) throw error
        setLineas(l ?? []); setParalelo(p ?? [])
      } catch (e) { toast.error('Error: ' + e.message) } finally { setCargando(false) }
    })()
  }, [anio])

  // datos[codigo][mesIdx] según modo
  const veSocios = ROLES_VEN_SOCIOS.has(cu?.rol)
  const mesEnCurso = new Date().getFullYear() === Number(anio) ? new Date().getMonth() : -1
  const datos = useMemo(() => {
    const d = {}
    paralelo.forEach(r => {
      const i = parseInt(r.periodo.slice(5, 7), 10) - 1
      // Confidencialidad: quien no es socio/dirección ve las remuneraciones de socios fusionadas en administración
      const cod = !veSocios && r.codigo === 'REM_SOCIOS' ? 'REM_ADMIN' : r.codigo
      d[cod] = d[cod] || new Array(12).fill(0)
      d[cod][i] += Number(modo === 'devengo' ? r.devengo : modo === 'caja' ? r.caja : modo === 'presupuesto' ? r.presupuesto : modo === 'desvio' ? r.desvio_presupuesto : r.diferencia)
    })
    return d
  }, [paralelo, modo, veSocios])

  const lineasVisibles = useMemo(() => veSocios ? lineas
    : lineas.filter(l => l.codigo !== 'REM_SOCIOS').map(l => l.codigo === 'REM_ADMIN' ? { ...l, nombre: 'Remuneraciones administración y dirección' } : l), [lineas, veSocios])
  const filas = useMemo(() => construir(lineasVisibles, datos), [lineasVisibles, datos])
  const ventaAnual = filas.find(f => f.codigo === 'VENTA_NETA')?.valores.reduce((s, v) => s + v, 0) || 0
  const mesesConDatos = filas.find(f => f.codigo === 'VENTA_NETA')?.valores.filter(v => v !== 0).length || 1
  const explic = useMemo(() => Object.fromEntries(paralelo.map(r => [r.codigo, r.explicacion])), [paralelo])

  async function abrirDetalle(f, mesIdx) {
    if (f.nivel !== 'detalle' && f.nivel !== 'info') return   // subtotales: son cálculo, no fuente
    const mundo = modo === 'caja' ? 'caja' : 'devengo'
    const periodo = mesIdx != null ? `${anio}-${String(mesIdx + 1).padStart(2, '0')}` : null
    setDetalle({ codigo: f.codigo, nombre: f.nombre, periodo, mundo, filas: [], cargando: true })
    let q = supabase.from(mundo === 'caja' ? 'v_eerr_detalle_caja' : 'v_eerr_detalle_devengo').select('*').eq('codigo', f.codigo)
    q = periodo ? q.eq('periodo', periodo) : q.gte('periodo', `${anio}-01`).lte('periodo', `${anio}-12`)
    const { data, error } = await q.order('fecha', { ascending: false }).limit(3000)
    if (error) toast.error(error.message)
    setDetalle(d => ({ ...d, filas: data ?? [], cargando: false }))
  }

  async function editarManual(f, mesIdx) {
    if (modo !== 'caja' || !EDITABLES_CAJA.has(f.codigo)) return
    const linea = lineas.find(l => l.codigo === f.codigo)
    if (!linea) return
    const actual = Math.abs(Number(datos[f.codigo]?.[mesIdx] ?? 0))
    const v = window.prompt(`${f.nombre} · ${MESES[mesIdx]} ${anio}\nValor de gestión (caja). Actual: ${fmt(actual)}\nIngresá el nuevo monto:`, actual ? String(Math.round(actual)) : '')
    if (v === null) return
    const monto = Number(String(v).replace(/[^\d-]/g, ''))
    if (!Number.isFinite(monto)) { toast.error('Monto inválido'); return }
    const { error } = await supabase.from('eerr_ajustes_manuales').insert({ eerr_linea_id: linea.id, anio, mes: mesIdx + 1, monto, usuario_id: cu?.auth_uid ?? null })
    if (error) { toast.error(error.message); return }
    toast.success(`${f.nombre} ${MESES[mesIdx]}: ${fmt(monto)} guardado`)
    const { data: p } = await supabase.from('v_eerr_paralelo').select('*').gte('periodo', `${anio}-01`).lte('periodo', `${anio}-12`).limit(2000)
    setParalelo(p ?? [])
  }

  function exportarPdfMatriz() {
    const f = filas.map(r => Object.fromEntries([['Línea', (r.nivel === 'sub' ? '· ' : '') + r.nombre], ...MESES.map((m, i) => [m, r.valores[i]]), ['Total', r.valores.reduce((a, b) => a + b, 0)]]))
    exportarPDF({ titulo: `EERR ${anio} — ${({ devengo: 'Devengo (contabilidad)', caja: 'Caja (gestión)', presupuesto: 'Presupuesto', paralelo: 'Devengo − Caja', desvio: 'Devengo − Presupuesto' })[modo] || modo}`, sub: titulo || 'Estado de resultados por línea y mes', filas: f, orientacion: 'landscape' })
  }

  function exportarDetallePdf() {
    if (!detalle?.filas?.length) return
    exportarPDF({ titulo: `${detalle.nombre} · ${detalle.periodo || anio}`, sub: `Fuente: ${detalle.mundo}`, filas: detalle.filas })
  }

  function exportarDetalle() {
    if (!detalle?.filas?.length) return
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalle.filas), 'Detalle')
    XLSX.writeFile(wb, `detalle_${detalle.codigo}_${detalle.periodo || anio}.xlsx`)
  }

  function exportar() {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.map(f => ({
      Línea: f.nombre, Tipo: f.tipo || '', ...Object.fromEntries(MESES.map((m, i) => [m, f.valores[i]])),
      'Total año': f.valores.reduce((s, v) => s + v, 0),
    }))), modo)
    XLSX.writeFile(wb, `eerr_${modo}_${anio}.xlsx`)
  }

  if (cargando) return <div style={{ padding: 28, textAlign: 'center', color: SLATE, fontSize: 12 }}>Cargando…</div>

  let seccionActual = null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
      {titulo && <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{titulo}</div>}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {[{ k: 'devengo', l: 'Devengo (contabilidad)' }, { k: 'caja', l: 'Caja (gestión)' }, { k: 'presupuesto', l: 'Presupuesto' }, { k: 'paralelo', l: 'Devengo − Caja' }, { k: 'desvio', l: 'Devengo − Presupuesto' }].map(v => (
          <button key={v.k} onClick={() => setModo(v.k)} style={{
            padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: modo === v.k ? NAVY : '#fff', color: modo === v.k ? '#fff' : SLATE, border: `1px solid ${modo === v.k ? NAVY : BORDE}`,
          }}>{v.l}</button>
        ))}
        <span style={{ fontSize: 11, color: SLATE, marginLeft: 8 }}>
          {modo === 'devengo' && 'Libro mayor mapeado a las mismas líneas de tu EERR de gestión · presentación por función (NIC 1)'}
          {modo === 'caja' && 'Réplica de tu EERR de gestión desde BSALE, banco, RRHH y ajustes manuales (NC restadas de la venta)'}
          {modo === 'paralelo' && 'Positivo = el devengo reconoce más que la caja · pasá el cursor sobre la línea para ver la explicación'}
          {modo === 'presupuesto' && 'Presupuesto vigente (última versión) mapeado a las mismas líneas'}
          {modo === 'desvio' && 'Real devengado menos presupuesto · en gastos, positivo = se gastó más de lo presupuestado'}
        </span>
        <button onClick={exportar} style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 10px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
        <button onClick={exportarPdfMatriz} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', cursor: 'pointer', fontWeight: 600, color: NAVY }}>PDF</button>
      </div>

      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'auto', maxHeight: '72vh' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 1500, width: '100%' }}>
          <thead><tr>
            <th style={{ ...TH, textAlign: 'left', position: 'sticky', left: 0, zIndex: 2, minWidth: 250 }}>Línea</th>
            <th style={{ ...TH, textAlign: 'left', width: 60 }}>Tipo</th>
            {MESES.map(m => <th key={m} style={TH}>{m}</th>)}
            <th style={{ ...TH, borderLeft: `2px solid ${BORDE}` }}>Total año</th>
            <th style={TH}>Prom/mes</th>
            <th style={TH}>% venta</th>
            <th style={{ ...TH, textAlign: 'center' }}>Tend.</th>
          </tr></thead>
          <tbody>
            {filas.map(f => {
              const total = f.valores.reduce((s, v) => s + v, 0)
              const esSub = f.nivel === 'subtotal' || f.nivel === 'total'
              const esInfo = f.nivel === 'info'
              const rowBg = f.nivel === 'total' ? '#EEF2FF' : esSub ? FONDO : '#fff'
              const color = esSub ? (total >= 0 ? VERDE : ROJO) : esInfo ? SLATE : INK
              const header = f.seccion && f.seccion !== seccionActual && !esSub ? f.seccion : null
              if (header) seccionActual = f.seccion
              return (
                <>
                  {header && (
                    <tr key={'h-' + header}><td colSpan={18} style={{ ...TD, background: '#fff', fontSize: 9.5, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, paddingTop: 10 }}>
                      {SECCIONES[header] || header}</td></tr>
                  )}
                  <tr key={f.codigo} style={{ background: rowBg }} title={modo === 'paralelo' || modo === 'desvio' ? explic[f.codigo] : undefined}>
                    <td onClick={() => abrirDetalle(f, null)} title={esSub ? undefined : 'Ver fuente de datos del año'}
                      style={{ ...TD, fontWeight: esSub ? 700 : 500, color: esSub ? NAVY : esInfo ? SLATE : INK, position: 'sticky', left: 0, background: rowBg, zIndex: 1, paddingLeft: esSub ? 8 : 18, cursor: esSub ? 'default' : 'pointer', textDecoration: esSub ? 'none' : 'underline dotted #C7D2FE' }}>{f.nombre}</td>
                    <td style={{ ...TD }}>{f.tipo && <span style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 999, background: f.tipo === 'Fijo' ? '#E0E7FF' : '#DCFCE7', color: f.tipo === 'Fijo' ? '#3730A3' : '#166534', fontWeight: 600 }}>{f.tipo}</span>}</td>
                    {f.valores.map((v, i) => (
                      <td key={i} onClick={() => v !== 0 && abrirDetalle(f, i)} onDoubleClick={() => editarManual(f, i)}
                        title={modo === 'caja' && EDITABLES_CAJA.has(f.codigo) ? 'Clic: fuente · Doble clic: editar valor de gestión' : esSub || v === 0 ? undefined : 'Ver fuente de datos del mes'}
                        style={{ ...NUM, fontWeight: esSub ? 700 : 400, color: esSub ? color : v < 0 && !esInfo && f.nivel === 'detalle' ? '#7F1D1D' : color, cursor: esSub || v === 0 ? 'default' : 'pointer' }}>{fmt(v)}</td>
                    ))}
                    <td style={{ ...NUM, fontWeight: 700, borderLeft: `2px solid ${BORDE}`, color }}>{fmt(total)}</td>
                    <td style={{ ...NUM, color: SLATE }}>{fmt(total / mesesConDatos)}</td>
                    <td style={{ ...NUM, color: SLATE }}>{ventaAnual && !esInfo ? (Math.abs(total) / ventaAnual * 100).toFixed(1) + '%' : ''}</td>
                    <td style={{ ...TD, textAlign: 'center' }}><Spark v={f.valores} /></td>
                  </tr>
                </>
              )
            })}
          </tbody>
        </table>
      </div>
      {detalle && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(720px, 92vw)', background: '#fff', boxShadow: '-8px 0 30px rgba(0,0,0,0.18)', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDE}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{detalle.nombre} · {detalle.periodo || anio}</div>
              <div style={{ fontSize: 11, color: SLATE }}>
                Fuente de datos · {detalle.mundo === 'caja' ? 'Caja: movimientos bancarios, ventas BSALE, liquidaciones, ajustes manuales' : 'Devengo: líneas del libro mayor'}
                {' · '}{detalle.filas.length} registros · total {fmt(detalle.filas.reduce((s, r) => s + Number(r.monto || 0), 0))}
                {!veSocios && detalle.codigo === 'REM_ADMIN' && <span style={{ color: AMBAR }}> · el total de la celda incluye remuneraciones de dirección (detalle reservado)</span>}
              </div>
            </div>
            <button onClick={exportarDetalle} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
            <button onClick={exportarDetallePdf} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', cursor: 'pointer', fontWeight: 600, color: NAVY }}>PDF</button>
            <button onClick={() => setDetalle(null)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: 'none', background: NAVY, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cerrar</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {detalle.cargando ? <div style={{ padding: 28, textAlign: 'center', color: SLATE, fontSize: 12 }}>Cargando…</div>
              : !detalle.filas.length ? <div style={{ padding: 28, textAlign: 'center', color: SLATE, fontSize: 12 }}>Sin registros en este período</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...TH, textAlign: 'left' }}>Fecha</th>
                    <th style={{ ...TH, textAlign: 'left' }}>{detalle.mundo === 'caja' ? 'Descripción' : 'Glosa'}</th>
                    <th style={{ ...TH, textAlign: 'left' }}>{detalle.mundo === 'caja' ? 'Subcuenta / fuente' : 'Cuenta · tercero'}</th>
                    <th style={TH}>Monto</th>
                  </tr></thead>
                  <tbody>
                    {detalle.filas.map((r, i) => (
                      <tr key={i}>
                        <td style={{ ...TD, color: SLATE }}>{r.fecha}</td>
                        <td style={{ ...TD, whiteSpace: 'normal', maxWidth: 300 }}>{detalle.mundo === 'caja' ? r.descripcion : (r.glosa_linea || r.glosa_asiento)}{r.asiento ? <span style={{ color: SLATE, fontSize: 10 }}> · asiento {r.asiento}</span> : null}</td>
                        <td style={{ ...TD, fontSize: 11, color: SLATE, whiteSpace: 'normal' }}>
                          {detalle.mundo === 'caja' ? `${r.subcuenta || ''} · ${r.fuente}${r.conciliado ? ' · conciliado' : ''}` : `${r.cuenta} ${r.cuenta_nombre || ''}${r.tercero ? ' · ' + r.tercero : ''}`}
                        </td>
                        <td style={{ ...NUM, fontWeight: 600 }}>{fmt(r.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </div>
      )}
      <div style={{ fontSize: 10.5, color: SLATE, lineHeight: 1.5 }}>
        Clic en una línea o en un mes abre su fuente de datos. Fijo/variable y orden de líneas vienen del maestro <b>eerr_lineas</b> — el mismo que usa Gestión → EERR Gestión (caja). Cambiar el maestro cambia ambos.
        Las secciones "Movimiento de plata" e "IVA al SII" son informativas (inventario y pasivo tributario en devengo; salida de caja en gestión).
      </div>
    </div>
  )
}

export default EerrFormal
