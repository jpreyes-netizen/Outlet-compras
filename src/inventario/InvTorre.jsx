/* Torre — lectura ejecutiva: dónde está el dinero y dónde se está perdiendo. */

import { useMemo, Fragment } from 'react'
import {
  Kpi, Tag, Panel, Tabla, fmt, fMM, fN, fD,
  INK, SLATE, LINE, NAVY, ROJO, VERDE, AMBAR, AZUL, MORADO,
} from './invUI'
import {
  calcularKpis, matrizAbcXyz, LEYENDA_ABC_XYZ, CL_ABC, CL_ESTADO,
  CL_PATRON, nombreSuc,
} from './invData'

function Matriz({ red, sel, onSel }) {
  const m = useMemo(() => matrizAbcXyz(red), [red])
  const maxV = Math.max(...Object.values(m).map(c => c.valor), 1)
  const ejes = { X: 'estable', Y: 'variable', Z: 'errático' }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '30px repeat(3, 1fr)', gap: 3 }}>
        <div />
        {['X', 'Y', 'Z'].map(x => (
          <div key={x} style={{ fontSize: 10, fontWeight: 700, color: SLATE, textAlign: 'center', paddingBottom: 2 }}>
            {x} · {ejes[x]}
          </div>
        ))}
        {['A', 'B', 'C', 'D'].map(a => (
          <Fragment key={a}>
            <div style={{ fontSize: 12, fontWeight: 800, color: CL_ABC[a], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{a}</div>
            {['X', 'Y', 'Z'].map(x => {
              const k = a + x, c = m[k], activo = sel === k
              return (
                <button key={k} onClick={() => onSel(activo ? null : k)} title={LEYENDA_ABC_XYZ[k]}
                  style={{
                    border: `1px solid ${activo ? NAVY : LINE}`, borderRadius: 3, cursor: 'pointer',
                    background: activo ? NAVY : `rgba(22,33,62,${0.04 + (c.valor / maxV) * 0.16})`,
                    color: activo ? '#fff' : INK, padding: '7px 6px', textAlign: 'left', font: 'inherit',
                  }}>
                  <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>{c.skus}</div>
                  <div style={{ fontSize: 10, opacity: .75 }}>{fMM(c.valor)}</div>
                </button>
              )
            })}
          </Fragment>
        ))}
      </div>
      <div style={{ fontSize: 11, color: SLATE, marginTop: 7, lineHeight: 1.45 }}>
        {sel ? <><b style={{ color: INK }}>{sel}</b> — {LEYENDA_ABC_XYZ[sel]}</>
             : 'ABC por margen anual acumulado. XYZ por variabilidad de la demanda. Clic para filtrar la tabla.'}
      </div>
    </div>
  )
}

export function InvTorre({ kpiSku, red, filtroCelda, setFiltroCelda, onProducto }) {
  const k = useMemo(() => calcularKpis(kpiSku), [kpiSku])

  const criticos = useMemo(() => {
    let f = kpiSku.filter(x => ['QUIEBRE', 'CRITICO'].includes(x.estado))
    if (filtroCelda) {
      const skus = new Set(red.filter(r => (r.abc || 'D') + (r.xyz || 'Z') === filtroCelda).map(r => r.sku))
      f = f.filter(x => skus.has(x.sku))
    }
    return f
  }, [kpiSku, red, filtroCelda])

  const cols = [
    { k: 'sku', l: 'SKU' },
    { k: 'producto', l: 'Producto', wrap: true },
    { k: 'sucursal_id', l: 'Sala', render: f => nombreSuc(f.sucursal_id), crudo: f => nombreSuc(f.sucursal_id) },
    { k: 'estado', l: 'Estado', render: f => <Tag texto={f.estado} color={CL_ESTADO[f.estado]} /> },
    { k: 'patron', l: 'Patrón', render: f => <Tag texto={(f.patron || '').slice(0, 4)} color={CL_PATRON[f.patron]} /> },
    { k: 'disponible', l: 'Disp.', num: true },
    { k: 'demanda_dia', l: 'Dem./día', num: true, render: f => fD(f.demanda_dia) },
    { k: 'pct_quiebre', l: '% quiebre', num: true,
      render: f => <span style={{ color: +f.pct_quiebre > 30 ? ROJO : INK }}>{fN(f.pct_quiebre)}%</span> },
    { k: 'venta_perdida_84d', l: 'Venta perdida 84d', num: true, render: f => fmt(f.venta_perdida_84d) },
    { k: 'sugerido', l: 'Reponer', num: true, render: f => <b>{fN(f.sugerido)}</b> },
  ]

  if (!k) return null

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
        <Kpi label="Inventario en sala" valor={fmt(k.valorInventario)} sub={`${fN(k.skus)} SKU · ${fN(k.coberturaMedia)} d cobertura`} color={NAVY} />
        <Kpi label="Quiebre" valor={fN(k.pctQuiebre) + '%'} sub={`${k.quiebre} SKU sin stock hoy`} color={ROJO} alerta={k.pctQuiebre > 25} />
        <Kpi label="Venta perdida 84d" valor={fmt(k.ventaPerdida)} sub="estimada por días sin stock" color={ROJO} alerta={k.ventaPerdida > 0} />
        <Kpi label="Por reponer" valor={fN(k.critico + k.reponer)} sub={`${k.critico} críticos · ${fmt(k.inversionRequerida)}`} color={AMBAR} />
        <Kpi label="Exceso" valor={fmt(k.valorExceso)} sub={`${k.exceso} SKU sobre cobertura`} color={AZUL} />
        <Kpi label="Sin rotación" valor={fmt(k.valorMuerto)} sub={`${k.muerto} SKU inmovilizados`} color={MORADO} />
        <Kpi label="Rotación anual" valor={fD(k.rotacion) + 'x'} sub="COGS 12m / inventario" color={VERDE} />
        <Kpi label="GMROI" valor={fD(k.gmroi)} sub="margen por peso invertido" color={k.gmroi >= 1 ? VERDE : ROJO} />
      </div>

      <Panel titulo="Dónde está el margen y qué tan predecible es"
             sub={filtroCelda ? `filtrando ${filtroCelda}` : null}>
        <Matriz red={red} sel={filtroCelda} onSel={setFiltroCelda} />
      </Panel>

      <Panel titulo="Atención inmediata" sub={`${fN(criticos.length)} SKU en quiebre o bajo stock de seguridad`}>
        <Tabla cols={cols} filas={criticos} onFila={f => onProducto(f.sku)}
               ordenInicial={{ col: 'venta_perdida_84d', dir: 'desc' }}
               nombreExport="inventario_criticos" tope={150} />
      </Panel>
    </div>
  )
}
