/* InvMatriz.jsx — dónde está el margen (ABC) y qué tan predecible es (XYZ). Cada celda abre sus productos. */

import { useMemo, useState, Fragment } from 'react'
import { Panel, Ex, Leyenda, inputEstilo, fN, fCLP, INK, SLATE, BORDE, NAVY } from './invUI'
import { matrizAbcXyz, LEYENDA_ABC_XYZ, CL_ABC } from './invData'
import { tablaExcel, tablaPdf } from './invReportes'

const EJES = { X: 'demanda estable', Y: 'demanda variable', Z: 'demanda errática' }
const ABC = { A: 'hace el 80% del margen', B: 'del 80% al 95%', C: 'el último 5%', D: 'sin margen' }

export function InvMatriz({ base, scope, irABase }) {
  const [categoria, setCategoria] = useState('')
  const categorias = useMemo(() => [...new Set(base.map(r => r.tipo_producto))].sort(), [base])
  const filas = useMemo(() => base.filter(r => (!scope || r.sucursal_id === scope) && (!categoria || r.tipo_producto === categoria)), [base, scope, categoria])
  const m = useMemo(() => matrizAbcXyz(filas), [filas])
  const maxV = Math.max(...Object.values(m).map(c => c.valor), 1)
  const plano = Object.entries(m).map(([k, c]) => ({ clase: k, skus: c.skus, valor: c.valor, lectura: LEYENDA_ABC_XYZ[k] }))
  const cols = [{ k: 'clase', l: 'Clase' }, { k: 'skus', l: 'Productos', num: true }, { k: 'valor', l: 'Inventario a costo', num: true }, { k: 'lectura', l: 'Lectura' }]

  return (
    <Panel titulo="Matriz ABC × XYZ" sub="filas: aporte al margen · columnas: variabilidad de la demanda · clic en una celda para ver sus productos"
      acciones={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={categoria} onChange={e => setCategoria(e.target.value)} style={{ ...inputEstilo, fontSize: 12 }} title="Filtrar por categoría de producto">
          <option value="">Todas las categorías</option>
          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <Ex onExcel={() => tablaExcel(plano, cols, 'matriz_abc_xyz')}
            onPdf={() => tablaPdf({ titulo: 'Inventario · matriz ABC × XYZ', sub: categoria ? `Categoría ${categoria}` : 'Todas las categorías', filas: plano, cols, nombre: 'matriz_abc_xyz' })} />
      </span>}>
      <div style={{ display: 'grid', gridTemplateColumns: '150px repeat(3, minmax(150px, 1fr))', gap: 6, maxWidth: 980 }}>
        <div />
        {['X', 'Y', 'Z'].map(x => (
          <div key={x} style={{ fontSize: 11, fontWeight: 700, color: SLATE, textAlign: 'center', padding: '2px 0 4px' }}>
            {x}<div style={{ fontWeight: 400, fontSize: 10.5 }}>{EJES[x]}</div>
          </div>
        ))}
        {['A', 'B', 'C', 'D'].map(a => (
          <Fragment key={a}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: CL_ABC[a] }}>{a}</span>
              <span style={{ fontSize: 10.5, color: SLATE }}>{ABC[a]}</span>
            </div>
            {['X', 'Y', 'Z'].map(x => {
              const k = a + x, c = m[k], vacia = !c.skus
              return (
                <button key={k} disabled={vacia} className={vacia ? undefined : 'inv-clic'} title={LEYENDA_ABC_XYZ[k]}
                  onClick={() => irABase('productos', { clase: [k], ...(categoria && { tipo_producto: [categoria] }) }, `Clase ${k}${categoria ? ` · ${categoria}` : ''}: ${LEYENDA_ABC_XYZ[k]}`)}
                  style={{ border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 12px', textAlign: 'left', font: 'inherit',
                           cursor: vacia ? 'default' : 'pointer', color: INK, background: `rgba(22,33,62,${0.03 + (c.valor / maxV) * 0.14})` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <b style={{ fontSize: 13, color: CL_ABC[a] }}>{k}</b>
                    <span style={{ fontSize: 17, fontWeight: 700 }}>{fN(c.skus)}{!vacia && <span style={{ color: '#B0B4BC', fontSize: 12 }}> ›</span>}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: NAVY, fontWeight: 600 }}>{fCLP(c.valor)}</div>
                  <div style={{ fontSize: 10.5, color: SLATE, lineHeight: 1.35, marginTop: 3 }}>{LEYENDA_ABC_XYZ[k]}</div>
                </button>
              )
            })}
          </Fragment>
        ))}
      </div>
      <Leyenda items={[
        { t: 'ABC', d: 'clasificación por margen anual acumulado de cada producto en la red (Pareto).' },
        { t: 'XYZ', d: 'variabilidad de la demanda: X estable, Y variable, Z errática o intermitente.' },
        { t: 'Cifra grande', d: 'cantidad de productos distintos en la celda; abajo, su inventario a costo.' },
        { t: 'Intensidad del fondo', d: 'más oscuro = más capital en esa celda.' },
      ]} />
    </Panel>
  )
}
