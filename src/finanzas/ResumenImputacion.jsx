import { useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'
import * as XLSX from 'xlsx'

/* ═══════════════════════════════════════════════════════════════════════
   RESUMEN DE LA IMPUTACIÓN (23-oct-2026) — Imputar facturas › Resumen
   Tabla dinámica sobre las facturas ya imputadas: filas (cuenta del plan
   único madre › subcuenta, centro de costo, sede, proveedor o cuenta
   contable), columnas (mes, centro o sede) y valor (neto, total o N°).
   Usa las mismas subcuentas y centros del banco. Las notas de crédito restan.
   Cada factura cuenta una sola vez aunque la vista contable la traiga en
   dos líneas (se toma la de gasto o activo). Clic en una celda = sus facturas.
   ═══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', BORDE = '#E5E7EB', AMBAR = '#B25E09', VERDE = '#1E7A44'
const PALETA = ['#16213E', '#1D4ED8', '#0E7490', '#15803D', '#B45309', '#B42318', '#7C3AED', '#475569', '#A16207']
const MES_L = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const mesLabel = p => { const [a, m] = String(p ?? '').split('-'); return m ? `${MES_L[Number(m) - 1] ?? m}-${String(a).slice(2)}` : String(p ?? '') }
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fmtM = n => { const v = Number(n || 0); return Math.abs(v) >= 1e6 ? `${(v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })}M` : fmt(v) }
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff', color: INK }
const TH = { fontSize: 10.5, fontWeight: 700, color: SLATE, textAlign: 'right', padding: '7px 8px', borderBottom: `1px solid ${BORDE}`, background: '#F8FAFC', position: 'sticky', top: 0, whiteSpace: 'nowrap', zIndex: 1 }
const TD = { fontSize: 11.5, padding: '5px 8px', borderBottom: '1px solid #F1F2F4', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', cursor: 'pointer' }

const signo = f => (Number(f.monto_libro) < 0 || f.codigo_sii === '61') ? -1 : 1
export const montoNeto = f => signo(f) * Math.abs(Number(f.neto ?? f.monto_total ?? 0))
export const montoTotal = f => signo(f) * Math.abs(Number(f.monto_total ?? 0))

export const DIMS = {
  cuenta: {
    l: 'Cuenta (plan único)',
    grupo: f => (f.madre_codigo ? `${f.madre_codigo} ${f.madre_nombre}` : 'Sin subcuenta asignada'),
    clave: f => (f.subcuenta_codigo ? `${f.subcuenta_codigo} ${f.subcuenta_nombre}` : `${f.cuenta ?? 'sin cuenta'} ${f.cuenta_nombre ?? ''}`.trim()),
  },
  centro: { l: 'Centro de costo', clave: f => (f.centro_codigo ? `${f.centro_codigo} ${f.centro_nombre}` : `Sin centro · ${f.ceco_nombre ?? 'sin sede'}`) },
  sede: { l: 'Sede', clave: f => f.ceco_nombre ?? 'Sin sede' },
  proveedor: { l: 'Proveedor', clave: f => f.razon_social ?? '—' },
  contable: { l: 'Cuenta contable', clave: f => `${f.cuenta ?? 'sin cuenta'} ${f.cuenta_nombre ?? ''}`.trim() },
  mes: { l: 'Mes', clave: f => f.periodo ?? String(f.fecha_emision ?? '').slice(0, 7) },
}
const FILAS_OPC = ['cuenta', 'centro', 'sede', 'proveedor', 'contable']
const COLS_OPC = [['mes', 'Mes'], ['centro', 'Centro de costo'], ['sede', 'Sede'], ['ninguna', 'Sin columnas (solo total)']]

// Una fila por factura: si la vista contable la trae en varias líneas, se toma la de gasto o activo (y la que ya tiene subcuenta)
export function unaFilaPorFactura(filas) {
  const M = new Map()
  const peso = x => (x.tipo_eeff === 'pasivo' ? 0 : 2) + (x.subcuenta_codigo ? 1 : 0)
  for (const f of filas ?? []) {
    const prev = M.get(f.id)
    if (!prev || peso(f) > peso(prev)) M.set(f.id, f)
  }
  return [...M.values()]
}

export function pivotear(facturas, { filas, columnas, valor }) {
  const dF = DIMS[filas], dC = columnas === 'ninguna' ? null : DIMS[columnas]
  const val = f => (valor === 'n' ? 1 : valor === 'total' ? montoTotal(f) : montoNeto(f))
  const celdas = new Map(), totFila = new Map(), totCol = new Map(), hijos = new Map(), totGrupo = new Map(), celdasGrupo = new Map()
  let total = 0
  for (const f of facturas) {
    const v = val(f), kf = dF.clave(f), kc = dC ? dC.clave(f) : 'Total'
    celdas.set(kf + '\u0001' + kc, (celdas.get(kf + '\u0001' + kc) ?? 0) + v)
    totFila.set(kf, (totFila.get(kf) ?? 0) + v)
    totCol.set(kc, (totCol.get(kc) ?? 0) + v)
    total += v
    if (dF.grupo) {
      const g = dF.grupo(f)
      if (!hijos.has(g)) hijos.set(g, new Set())
      hijos.get(g).add(kf)
      totGrupo.set(g, (totGrupo.get(g) ?? 0) + v)
      celdasGrupo.set(g + '\u0001' + kc, (celdasGrupo.get(g + '\u0001' + kc) ?? 0) + v)
    }
  }
  const porTotal = m => (a, b) => Math.abs(m.get(b) ?? 0) - Math.abs(m.get(a) ?? 0)
  const cols = [...totCol.keys()].sort(columnas === 'mes' ? (a, b) => String(a).localeCompare(String(b)) : porTotal(totCol))
  const out = []
  if (dF.grupo) {
    for (const g of [...hijos.keys()].sort(porTotal(totGrupo))) {
      out.push({ tipo: 'grupo', clave: g, total: totGrupo.get(g), celda: c => celdasGrupo.get(g + '\u0001' + c) ?? 0 })
      for (const kf of [...hijos.get(g)].sort(porTotal(totFila))) out.push({ tipo: 'hoja', grupo: g, clave: kf, total: totFila.get(kf), celda: c => celdas.get(kf + '\u0001' + c) ?? 0 })
    }
  } else {
    for (const kf of [...totFila.keys()].sort(porTotal(totFila))) out.push({ tipo: 'hoja', clave: kf, total: totFila.get(kf), celda: c => celdas.get(kf + '\u0001' + c) ?? 0 })
  }
  return { cols, filas: out, totCol, total }
}

export function ResumenImputacion({ filas }) {
  const base = useMemo(() => unaFilaPorFactura(filas), [filas])
  const anios = useMemo(() => [...new Set(base.map(f => String(f.periodo ?? f.fecha_emision ?? '').slice(0, 4)).filter(Boolean))].sort().reverse(), [base])
  const [anio, setAnio] = useState('')
  const anioSel = anio || anios[0] || ''
  const [filasDim, setFilasDim] = useState('cuenta')
  const [colsDim, setColsDim] = useState('mes')
  const [valor, setValor] = useState('neto')
  const [tipo, setTipo] = useState('todo')
  const [sede, setSede] = useState('todas')
  const [grafico, setGrafico] = useState(true)
  const [abiertos, setAbiertos] = useState(() => new Set())
  const [celdaSel, setCeldaSel] = useState(null)

  const sedes = useMemo(() => [...new Set(base.map(f => f.ceco_nombre ?? 'Sin sede'))].sort(), [base])
  const universo = useMemo(() => base.filter(f =>
    String(f.periodo ?? f.fecha_emision ?? '').startsWith(anioSel)
    && (tipo === 'todo' || (tipo === 'gasto' ? ['gasto', 'costo'].includes(f.tipo_eeff) : !['gasto', 'costo'].includes(f.tipo_eeff)))
    && (sede === 'todas' || (f.ceco_nombre ?? 'Sin sede') === sede)), [base, anioSel, tipo, sede])
  const pv = useMemo(() => pivotear(universo, { filas: filasDim, columnas: colsDim, valor }), [universo, filasDim, colsDim, valor])
  const conGrupo = !!DIMS[filasDim].grupo
  const etiquetaCol = c => (colsDim === 'mes' ? mesLabel(c) : c)
  const kpi = useMemo(() => ({
    n: universo.length,
    neto: universo.reduce((s, f) => s + montoNeto(f), 0),
    conSub: universo.filter(f => f.subcuenta_codigo).length,
    conCentro: universo.filter(f => f.centro_codigo || f.requiere_centro === false).length,
  }), [universo])
  const maxAbs = useMemo(() => {
    let m = 1
    for (const r of pv.filas) if (r.tipo === 'hoja') for (const c of pv.cols) m = Math.max(m, Math.abs(r.celda(c)))
    return m
  }, [pv])
  const graf = useMemo(() => {
    const nivel = pv.filas.filter(r => (conGrupo ? r.tipo === 'grupo' : true))
    const top = nivel.slice(0, 8), resto = nivel.slice(8)
    const series = top.map(r => r.clave).concat(resto.length ? ['Otros'] : [])
    const porCol = pv.cols.map(c => {
      const o = { col: etiquetaCol(c) }
      top.forEach(r => { o[r.clave] = Math.round(r.celda(c)) })
      if (resto.length) o.Otros = Math.round(resto.reduce((s, r) => s + r.celda(c), 0))
      return o
    })
    const porFila = nivel.slice(0, 12).map(r => ({ col: r.clave.length > 34 ? r.clave.slice(0, 33) + '…' : r.clave, Total: Math.round(r.total) }))
    return { series, porCol, porFila }
  }, [pv, conGrupo, colsDim]) // eslint-disable-line react-hooks/exhaustive-deps
  const detalle = useMemo(() => {
    if (!celdaSel) return []
    const dF = DIMS[filasDim], dC = colsDim === 'ninguna' ? null : DIMS[colsDim]
    return universo
      .filter(f => (celdaSel.esGrupo ? dF.grupo(f) === celdaSel.fila : dF.clave(f) === celdaSel.fila)
        && (celdaSel.col == null || (dC ? dC.clave(f) : 'Total') === celdaSel.col))
      .sort((a, b) => Math.abs(montoNeto(b)) - Math.abs(montoNeto(a)))
  }, [celdaSel, universo, filasDim, colsDim])

  const fondo = v => { const a = Math.min(1, Math.abs(v) / maxAbs); return !v ? 'transparent' : v < 0 ? `rgba(180,35,24,${0.05 + 0.25 * a})` : `rgba(29,78,216,${0.04 + 0.28 * a})` }
  const vis = pv.filas.filter(r => r.tipo === 'grupo' || !r.grupo || abiertos.has(r.grupo))
  const todosAbiertos = conGrupo && pv.filas.filter(r => r.tipo === 'grupo').every(r => abiertos.has(r.clave))
  const toggle = g => setAbiertos(s => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n })
  const elegir = (fila, esGrupo, col) => setCeldaSel(s => (s && s.fila === fila && s.col === col && s.esGrupo === esGrupo ? null : { fila, esGrupo, col }))
  const cambiar = setter => v => { setter(v); setCeldaSel(null) }

  function exportar() {
    const aoa = [[DIMS[filasDim].l, ...pv.cols.map(etiquetaCol), 'Total']]
    for (const r of pv.filas) aoa.push([(r.tipo === 'hoja' && r.grupo ? '    ' : '') + r.clave, ...pv.cols.map(c => Math.round(r.celda(c))), Math.round(r.total)])
    aoa.push(['Total', ...pv.cols.map(c => Math.round(pv.totCol.get(c) ?? 0)), Math.round(pv.total)])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Resumen')
    XLSX.writeFile(wb, `resumen_imputacion_${anioSel}_${filasDim}_${colsDim}.xlsx`)
  }

  const Sel = ({ label, value, onChange, children }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: SLATE }}>{label}
      <select value={value} onChange={e => onChange(e.target.value)} style={INPUT} aria-label={label}>{children}</select>
    </label>
  )
  const Kpi = ({ l, v, d, c }) => (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '8px 12px', minWidth: 150 }}>
      <div style={{ fontSize: 10.5, color: SLATE, fontWeight: 600 }}>{l}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: c ?? NAVY, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
      {d && <div style={{ fontSize: 10.5, color: SLATE }}>{d}</div>}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '8px 12px' }}>
        <Sel label="Filas" value={filasDim} onChange={cambiar(setFilasDim)}>{FILAS_OPC.map(k => <option key={k} value={k}>{DIMS[k].l}</option>)}</Sel>
        <Sel label="Columnas" value={colsDim} onChange={cambiar(setColsDim)}>{COLS_OPC.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Sel>
        <Sel label="Valor" value={valor} onChange={setValor}>
          <option value="neto">Neto (sin IVA)</option><option value="total">Total con IVA</option><option value="n">N° de facturas</option>
        </Sel>
        <Sel label="Año" value={anioSel} onChange={cambiar(setAnio)}>{anios.map(a => <option key={a} value={a}>{a}</option>)}</Sel>
        <Sel label="Tipo" value={tipo} onChange={cambiar(setTipo)}>
          <option value="todo">Todo</option><option value="gasto">Solo gastos (resultado)</option><option value="activo">Mercadería y activos</option>
        </Sel>
        <Sel label="Sede" value={sede} onChange={cambiar(setSede)}><option value="todas">Todas</option>{sedes.map(s => <option key={s} value={s}>{s}</option>)}</Sel>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 11.5, color: SLATE, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={grafico} onChange={e => setGrafico(e.target.checked)} /> gráfico</label>
        <button onClick={exportar} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600 }}>Exportar Excel</button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Kpi l="Neto imputado" v={`$${fmtM(kpi.neto)}`} d={`${fmt(kpi.n)} facturas · NC restan`} />
        <Kpi l="Con subcuenta" v={`${kpi.n ? Math.round(100 * kpi.conSub / kpi.n) : 0}%`} d={`${fmt(kpi.n - kpi.conSub)} sin subcuenta`} c={kpi.conSub === kpi.n ? VERDE : AMBAR} />
        <Kpi l="Con centro de costo" v={`${kpi.n ? Math.round(100 * kpi.conCentro / kpi.n) : 0}%`} d={`${fmt(kpi.n - kpi.conCentro)} sin centro`} c={kpi.conCentro === kpi.n ? VERDE : AMBAR} />
      </div>

      {grafico && pv.cols.length > 0 && (
        <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 6px 4px', height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            {colsDim === 'mes'
              ? (
                <BarChart data={graf.porCol} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="col" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={fmtM} tick={{ fontSize: 11 }} width={60} />
                  <Tooltip formatter={v => `$${fmt(v)}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {graf.series.map((s, i) => <Bar key={s} dataKey={s} stackId="a" fill={PALETA[i % PALETA.length]} />)}
                </BarChart>
              ) : (
                <BarChart data={graf.porFila} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={fmtM} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="col" width={230} tick={{ fontSize: 10.5 }} />
                  <Tooltip formatter={v => `$${fmt(v)}`} />
                  <Bar dataKey="Total" fill={NAVY} />
                </BarChart>
              )}
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'auto', maxHeight: '60vh' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: 'left', left: 0, zIndex: 2 }}>
                {DIMS[filasDim].l}
                {conGrupo && (
                  <button onClick={() => setAbiertos(todosAbiertos ? new Set() : new Set(pv.filas.filter(r => r.tipo === 'grupo').map(r => r.clave)))}
                    style={{ marginLeft: 8, fontSize: 10.5, border: `1px solid ${BORDE}`, background: '#fff', borderRadius: 4, cursor: 'pointer', padding: '1px 6px' }}>
                    {todosAbiertos ? 'Contraer todo' : 'Expandir todo'}
                  </button>
                )}
              </th>
              {pv.cols.map(c => <th key={c} style={TH}>{etiquetaCol(c)}</th>)}
              <th style={{ ...TH, color: NAVY }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {vis.map(r => {
              const esGrupo = r.tipo === 'grupo'
              return (
                <tr key={(esGrupo ? 'g:' : 'h:') + (r.grupo ?? '') + r.clave} style={{ background: esGrupo ? '#F8FAFC' : '#fff' }}>
                  <td style={{ ...TD, textAlign: 'left', fontWeight: esGrupo ? 700 : 400, paddingLeft: !esGrupo && r.grupo ? 26 : 8, color: INK, cursor: esGrupo ? 'pointer' : 'default', position: 'sticky', left: 0, background: esGrupo ? '#F8FAFC' : '#fff' }}
                    onClick={() => esGrupo && toggle(r.clave)}>
                    {esGrupo && <span style={{ display: 'inline-block', width: 14, color: SLATE }}>{abiertos.has(r.clave) ? '▾' : '▸'}</span>}
                    {r.clave}
                  </td>
                  {pv.cols.map(c => {
                    const v = r.celda(c)
                    const sel = celdaSel && celdaSel.fila === r.clave && celdaSel.col === c && celdaSel.esGrupo === esGrupo
                    return (
                      <td key={c} onClick={() => v && elegir(r.clave, esGrupo, c)} title="Ver facturas"
                        style={{ ...TD, fontWeight: esGrupo ? 700 : 400, background: sel ? '#FDE68A' : esGrupo ? '#F8FAFC' : fondo(v), color: v < 0 ? '#B42318' : INK }}>
                        {v ? fmt(v) : ''}
                      </td>
                    )
                  })}
                  <td onClick={() => elegir(r.clave, esGrupo, null)} style={{ ...TD, fontWeight: 700, color: NAVY, background: esGrupo ? '#F1F5F9' : '#F8FAFC' }}>{fmt(r.total)}</td>
                </tr>
              )
            })}
            <tr>
              <td style={{ ...TD, textAlign: 'left', fontWeight: 800, color: NAVY, position: 'sticky', left: 0, background: '#EEF2FF' }}>Total</td>
              {pv.cols.map(c => <td key={c} style={{ ...TD, fontWeight: 800, color: NAVY, background: '#EEF2FF' }}>{fmt(pv.totCol.get(c) ?? 0)}</td>)}
              <td style={{ ...TD, fontWeight: 800, color: NAVY, background: '#E0E7FF' }}>{fmt(pv.total)}</td>
            </tr>
          </tbody>
        </table>
        {!pv.filas.length && <div style={{ padding: 14, fontSize: 12.5, color: SLATE }}>Sin facturas con estos filtros.</div>}
      </div>

      {celdaSel && (
        <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'auto', maxHeight: 340 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `1px solid ${BORDE}`, position: 'sticky', top: 0, background: '#fff' }}>
            <b style={{ fontSize: 12.5, color: NAVY }}>{celdaSel.fila}{celdaSel.col != null ? ` · ${etiquetaCol(celdaSel.col)}` : ''}</b>
            <span style={{ fontSize: 11.5, color: SLATE }}>{detalle.length} factura{detalle.length === 1 ? '' : 's'} · neto ${fmt(detalle.reduce((s, f) => s + montoNeto(f), 0))}</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setCeldaSel(null)} style={{ ...INPUT, cursor: 'pointer', fontSize: 11 }}>Cerrar</button>
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {detalle.slice(0, 200).map(f => (
                <tr key={f.id}>
                  <td style={{ ...TD, textAlign: 'left', cursor: 'default' }}>{String(f.fecha_emision ?? '').slice(0, 10)}</td>
                  <td style={{ ...TD, textAlign: 'left', cursor: 'default' }}>{f.codigo_sii === '61' ? 'NC' : f.codigo_sii === '914' ? 'DIN' : 'F'} {f.folio}</td>
                  <td style={{ ...TD, textAlign: 'left', cursor: 'default', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.razon_social}</td>
                  <td style={{ ...TD, textAlign: 'left', cursor: 'default', color: f.subcuenta_codigo ? INK : AMBAR }}>{f.subcuenta_codigo ? `${f.subcuenta_codigo} ${f.subcuenta_nombre}` : 'sin subcuenta'}</td>
                  <td style={{ ...TD, textAlign: 'left', cursor: 'default', color: f.centro_codigo ? INK : AMBAR }}>{f.centro_codigo ? `${f.centro_codigo} ${f.centro_nombre}` : 'sin centro'}</td>
                  <td style={{ ...TD, cursor: 'default', color: montoNeto(f) < 0 ? '#B42318' : INK }}>{fmt(montoNeto(f))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detalle.length > 200 && <div style={{ padding: '6px 12px', fontSize: 11, color: SLATE }}>Se muestran las 200 de mayor monto.</div>}
        </div>
      )}
    </div>
  )
}
