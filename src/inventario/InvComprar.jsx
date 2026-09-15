/* Comprar — qué entra al próximo contenedor, ordenado por retorno del capital. */

import { useState, useMemo } from 'react'
import {
  Kpi, Tag, Panel, Tabla, Boton, inputEstilo, fmt, fN, fD,
  INK, SLATE, LINE, NAVY, ROJO, VERDE, AMBAR,
} from './invUI'
import { CL_ABC, CL_PATRON } from './invData'

const PRESUPUESTOS = [50, 100, 200, 400]

export function InvComprar({ prioridad, onProducto }) {
  const [presupuesto, setPresupuesto] = useState(null)   // en millones; null = sin tope
  const [ocultarAlerta, setOcultarAlerta] = useState(true)
  const [texto, setTexto] = useState('')

  const filas = useMemo(() => {
    let f = prioridad
    if (ocultarAlerta) f = f.filter(x => !x.alerta_costo)
    if (presupuesto) f = f.filter(x => +x.capital_acumulado <= presupuesto * 1e6)
    if (texto.trim()) {
      const t = texto.trim().toLowerCase()
      f = f.filter(x => String(x.sku).toLowerCase().includes(t) ||
                        String(x.producto || '').toLowerCase().includes(t))
    }
    return f
  }, [prioridad, presupuesto, ocultarAlerta, texto])

  const tot = useMemo(() => ({
    skus: filas.length,
    inversion: filas.reduce((a, f) => a + (+f.inversion || 0), 0),
    margen: filas.reduce((a, f) => a + (+f.margen_esperado || 0), 0),
    perdida: filas.reduce((a, f) => a + (+f.venta_perdida_84d || 0), 0),
    alertas: prioridad.filter(f => f.alerta_costo).length,
  }), [filas, prioridad])

  const cols = [
    { k: 'prioridad', l: '#', num: true },
    { k: 'sku', l: 'SKU' },
    { k: 'producto', l: 'Producto', wrap: true },
    { k: 'abc', l: 'Clase', render: f => <Tag texto={(f.abc || 'D') + (f.xyz || 'Z')} color={CL_ABC[f.abc]} />,
      crudo: f => (f.abc || 'D') + (f.xyz || 'Z') },
    { k: 'patron', l: 'Patrón', render: f => <Tag texto={(f.patron || '').slice(0, 4)} color={CL_PATRON[f.patron]} /> },
    { k: 'disponible_tiendas', l: 'En salas', num: true },
    { k: 'disponible_cd', l: 'En CD', num: true },
    { k: 'transito', l: 'Tránsito', num: true },
    { k: 'demanda_dia_red', l: 'Dem./día', num: true, render: f => fD(f.demanda_dia_red, 3) },
    { k: 'dias_cobertura_red', l: 'Cobertura', num: true,
      render: f => f.dias_cobertura_red == null ? '—' : fN(f.dias_cobertura_red) + ' d' },
    { k: 'comprar_sugerido', l: 'Comprar', num: true, render: f => <b style={{ color: NAVY }}>{fN(f.comprar_sugerido)}</b> },
    { k: 'inversion', l: 'Inversión', num: true, render: f => fmt(f.inversion) },
    { k: 'margen_esperado', l: 'Margen esperado', num: true, render: f => fmt(f.margen_esperado) },
    { k: 'retorno_capital', l: 'ROI', num: true,
      render: f => <b style={{ color: +f.retorno_capital >= 1 ? VERDE : AMBAR }}>{fD(f.retorno_capital)}x</b> },
    { k: 'capital_acumulado', l: 'Capital acum.', num: true, render: f => fmt(f.capital_acumulado) },
    { k: 'pct_margen_acumulado', l: '% margen acum.', num: true, render: f => fN(f.pct_margen_acumulado) + '%' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
        <Kpi label="SKU en la orden" valor={fN(tot.skus)} sub={presupuesto ? `tope ${presupuesto} MM` : 'sin tope de capital'} color={NAVY} />
        <Kpi label="Inversión" valor={fmt(tot.inversion)} sub="costo de la compra" color={AMBAR} />
        <Kpi label="Margen esperado" valor={fmt(tot.margen)} sub="ajustado por riesgo de demanda" color={VERDE} />
        <Kpi label="Retorno" valor={tot.inversion > 0 ? fD(tot.margen / tot.inversion) + 'x' : '—'} sub="margen por peso invertido" color={VERDE} />
        <Kpi label="Venta perdida en juego" valor={fmt(tot.perdida)} sub="si no se compra" color={ROJO} />
      </div>

      <Panel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: SLATE, fontWeight: 600 }}>Presupuesto:</span>
          <Boton onClick={() => setPresupuesto(null)} activo={!presupuesto} tono="primario">Sin tope</Boton>
          {PRESUPUESTOS.map(p => (
            <Boton key={p} onClick={() => setPresupuesto(p)} activo={presupuesto === p} tono="primario">{p} MM</Boton>
          ))}
          <span style={{ width: 1, height: 20, background: LINE, margin: '0 3px' }} />
          <label style={{ fontSize: 11.5, color: SLATE, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input type="checkbox" checked={ocultarAlerta} onChange={e => setOcultarAlerta(e.target.checked)} />
            Ocultar {tot.alertas} con costo dudoso
          </label>
          <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar SKU o producto"
                 style={{ ...inputEstilo, minWidth: 180, flex: '1 1 180px' }} />
        </div>
      </Panel>

      <Tabla cols={cols} filas={filas} onFila={f => onProducto(f.sku)}
             ordenInicial={{ col: 'prioridad', dir: 'asc' }} nombreExport="orden_compra_sugerida" />

      <div style={{ fontSize: 11, color: SLATE, marginTop: 9, lineHeight: 1.5 }}>
        Orden por retorno del capital, no por urgencia. El margen se acredita sólo sobre las unidades
        que alcanzan a venderse dentro del horizonte de cobertura, y se castiga según la variabilidad
        de la demanda (X 1,0 · Y 0,85 · Z 0,70). La columna de capital acumulado permite cortar el
        pedido donde alcance el presupuesto.
      </div>
    </div>
  )
}
