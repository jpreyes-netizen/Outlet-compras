/* InvComparativo.jsx — cada ubicación con las mismas preguntas. Las cifras con "›" llevan a su detalle. */

import { useMemo } from 'react'
import { Panel, Enlace, Ex, Leyenda, fN, fD, fCLP, fPct, NAVY, INK, SLATE, BORDE, PAPER, ROJO, VERDE, AMBAR } from './invUI'
import { tablaExcel, tablaPdf } from './invReportes'

const REF_ROTACION = 4.5, REF_INSTOCK = 95
const COLUMNAS = ['suc-lg', 'suc-la', 'suc-maipu', 'suc-mp', 'red']
const x = v => v == null ? '—' : fD(v, 2) + 'x'
const sem = v => v == null ? '—' : fD(v, 1) + ' sem'
const n = v => v == null ? '—' : fN(v)

/* f: formato · mejor: semáforo entre salas · ir: filtros de la base (si la cifra se puede desglosar) */
const FILAS = [
  { g: 'Capital' },
  { k: 'valor', l: 'Inventario a costo', f: fCLP, ir: id => ({ conStock: true, ...(id !== 'red' && { sucursal_id: [id] }) }) },
  { k: 'pct_del_inventario', l: '% del inventario de la red', f: v => fPct(v) },
  { k: 'skus_stock', l: 'Productos con stock', f: n, ir: id => ({ conStock: true, ...(id !== 'red' && { sucursal_id: [id] }) }) },
  { g: 'Venta' },
  { k: 'neto_28d', l: 'Venta neta últimos 28 días', f: fCLP, mejor: 'alto' },
  { k: 'crec_28d_pct', l: 'vs 28 días anteriores', f: v => fPct(v), mejor: 'alto' },
  { k: 'comp_28d_pct', l: 'vs mismo período año anterior', f: v => fPct(v), mejor: 'alto', comp: true },
  { k: 'comp_ytd_pct', l: 'Acumulado del año vs año anterior', f: v => fPct(v), mejor: 'alto', comp: true },
  { k: 'margen_pct', l: 'Margen bruto', f: v => fPct(v), mejor: 'alto' },
  { g: 'Productividad del inventario' },
  { k: 'rotacion', l: 'Rotación anual', f: x, mejor: 'alto', ref: `HD ${fD(REF_ROTACION, 1)}x` },
  { k: 'gmroi', l: 'GMROI (margen por $ invertido)', f: x, mejor: 'alto' },
  { k: 'semanas_cobertura', l: 'Semanas de venta en stock', f: sem, mejor: 'bajo' },
  { g: 'Disponibilidad' },
  { k: 'instock_clave_hoy', l: 'Productos clave con stock hoy', f: v => fPct(v), mejor: 'alto', ref: `obj. ${REF_INSTOCK}%` },
  { k: 'instock_clave_84d', l: 'Productos clave con stock, 84 días', f: v => fPct(v), mejor: 'alto', ref: `obj. ${REF_INSTOCK}%` },
  { k: 'skus_quiebre', l: 'En quiebre o bajo el stock de seguridad', f: n, mejor: 'bajo',
    ir: id => ({ estado: ['QUIEBRE', 'CRITICO'], ...(id !== 'red' && { sucursal_id: [id] }) }) },
  { k: 'venta_perdida_84d', l: 'Venta perdida estimada, 84 días', f: fCLP, mejor: 'bajo',
    ir: id => ({ perdida: true, ...(id !== 'red' && { sucursal_id: [id] }) }) },
  { k: 'perdida_con_stock_en_cd', l: '…teniendo el producto en el CD', f: fCLP, mejor: 'bajo',
    ir: id => ({ quiebreConCd: true, ...(id !== 'red' && { sucursal_id: [id] }) }) },
  { k: 'pct_surtido_vende', l: 'Surtido que vendió en 84 días', f: v => fPct(v), mejor: 'alto' },
]

function extremos(fila, por) {
  if (!fila.mejor) return {}
  const v = ['suc-lg', 'suc-la', 'suc-maipu'].map(id => ({ id, v: por[id]?.[fila.k] })).filter(o => o.v != null && !isNaN(+o.v))
  if (v.length < 2) return {}
  v.sort((a, b) => +a.v - +b.v)
  const [lo, hi] = [v[0].id, v[v.length - 1].id]
  return fila.mejor === 'alto' ? { [hi]: VERDE, [lo]: ROJO } : { [lo]: VERDE, [hi]: ROJO }
}

export function InvComparativo({ scorecard, comparable, pendientes, scope, irABase }) {
  const compListo = pendientes === 0
  const por = useMemo(() => {
    const m = Object.fromEntries(scorecard.map(r => [r.sucursal_id, { ...r }]))
    for (const c of comparable) if (m[c.sucursal_id]) {
      m[c.sucursal_id].comp_28d_pct = compListo ? c.comp_28d_pct : null
      m[c.sucursal_id].comp_ytd_pct = compListo ? c.comp_ytd_pct : null
    }
    return m
  }, [scorecard, comparable, compListo])
  const cols = COLUMNAS.filter(id => !scope || id === scope || id === 'red')
  const nombre = id => por[id]?.nombre || id

  const plano = FILAS.filter(f => !f.g).map(f => ({ ind: f.l, ...Object.fromEntries(cols.map(id => [id, f.f(por[id]?.[f.k])])), ref: f.ref || '' }))
  const colsEx = [{ k: 'ind', l: 'Indicador' }, ...cols.map(id => ({ k: id, l: nombre(id) })), { k: 'ref', l: 'Referencia' }]
  const th = al => ({ padding: '7px 10px', textAlign: al, fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase',
                      letterSpacing: 0.4, borderBottom: `1px solid ${BORDE}`, whiteSpace: 'nowrap', background: PAPER })

  return (
    <Panel titulo="Comparativo por ubicación" sub="verde: mejor sala · rojo: peor sala · las cifras con › abren su detalle"
      acciones={<Ex onExcel={() => tablaExcel(plano, colsEx, 'comparativo_por_sala')}
                    onPdf={() => tablaPdf({ titulo: 'Inventario · comparativo por ubicación', filas: plano, cols: colsEx, nombre: 'comparativo_por_sala', orientacion: 'landscape' })} />}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
          <thead><tr>
            <th style={th('left')}>Indicador</th>
            {cols.map(id => (
              <th key={id} style={{ ...th('right'), color: id === 'red' ? NAVY : SLATE }}>
                {nombre(id)}
                {por[id]?.sala_nueva && <div style={{ fontSize: 9, fontWeight: 600, color: AMBAR, textTransform: 'none' }}>abierta hace {por[id].dias_hist} días</div>}
              </th>))}
            <th style={th('right')}>Referencia</th>
          </tr></thead>
          <tbody>
            {FILAS.map((fila, i) => fila.g ? (
              <tr key={'g' + i}><td colSpan={cols.length + 2} style={{ padding: '10px 10px 4px', fontSize: 10.5, fontWeight: 800, color: NAVY,
                textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${BORDE}` }}>{fila.g}</td></tr>
            ) : (
              <tr key={fila.k} className="inv-fila" style={{ borderBottom: `1px solid ${BORDE}` }}>
                <td style={{ padding: '6px 10px', color: INK, whiteSpace: 'nowrap' }}>
                  {fila.l}{fila.comp && !compListo && <span style={{ fontSize: 10, color: AMBAR }}> · cargando historia</span>}
                </td>
                {cols.map(id => {
                  const c = extremos(fila, por)[id], v = por[id]?.[fila.k]
                  const txt = fila.f(v)
                  const clic = fila.ir && v != null && +v > 0
                  return (
                    <td key={id} style={{ padding: '6px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                          color: c || INK, fontWeight: c || id === 'red' ? 700 : 400, background: id === 'red' ? '#F7F8FB' : undefined }}>
                      {clic ? <Enlace color={c || NAVY} onClick={() => irABase('productos', fila.ir(id), `${fila.l} · ${nombre(id)}`)}>{txt} ›</Enlace> : txt}
                    </td>)
                })}
                <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10.5, color: SLATE, whiteSpace: 'nowrap' }}>{fila.ref || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Leyenda items={[
        { c: VERDE, t: 'Verde / rojo', d: 'la mejor y la peor de las tres salas en ese indicador.' },
        { t: 'Productos clave', d: 'los que suman el 80% de la venta de cada sala.' },
        { t: 'Rotación y GMROI', d: 'anualizados sobre los días de venta de cada sala. En el CD, la rotación mide cuántas veces la venta de la red consume su stock.' },
        { t: 'Venta comparable', d: 'contra el mismo período del año anterior; excluye salas con menos de 12 meses abiertas.' },
      ]} />
    </Panel>
  )
}
