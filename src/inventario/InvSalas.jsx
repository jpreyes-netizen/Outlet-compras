/* ════════════════════════════════════════════════════════════════════
   InvSalas.jsx — la hoja del gerente general
   Una columna por ubicación, las mismas preguntas para todas:
     ¿cuánto capital tengo ahí?  ¿cuánto vende?  ¿cuántas veces rota?
     ¿tengo lo que el cliente viene a buscar?  ¿qué parte del stock ya no sirve?
   El CD se mide contra la venta de la red: no vende, despacha.
   ════════════════════════════════════════════════════════════════════ */

import { useState, useMemo, Fragment } from 'react'
import {
  Panel, Tabla, Tag, Boton, fmt, fMM, fN, fD,
  INK, SLATE, LINE, PAPER, NAVY, ROJO, VERDE, AMBAR, AZUL, MORADO,
} from './invUI'
import { CL_ESTADO, nombreSuc } from './invData'

/* Referencias externas. Home Depot reporta rotación de 4,5x (2T 2026). */
const REF_ROTACION = 4.5
const REF_INSTOCK_CLAVE = 95

const COLUMNAS = ['suc-lg', 'suc-la', 'suc-maipu', 'suc-mp', 'red']

const pct = v => v == null ? '—' : fD(v, 1) + '%'
const x   = v => v == null ? '—' : fD(v, 2) + 'x'
const mm  = v => v == null ? '—' : '$' + fMM(v)
const n   = v => v == null ? '—' : fN(v)
const sem = v => v == null ? '—' : fD(v, 1) + ' sem'

/* mejor: 'alto' | 'bajo' | null (sin semáforo). ref: referencia externa. */
const FILAS = [
  { g: 'Capital' },
  { k: 'valor', l: 'Inventario a costo', f: mm },
  { k: 'pct_del_inventario', l: '% del inventario de la red', f: pct },
  { k: 'skus_stock', l: 'SKU con stock', f: n },
  { k: 'reservado', l: 'Unidades vendidas por entregar', f: n },

  { g: 'Venta' },
  { k: 'neto_28d', l: 'Venta neta últimos 28 días', f: mm, mejor: 'alto' },
  { k: 'crec_28d_pct', l: 'vs 28 días anteriores', f: pct, mejor: 'alto' },
  { k: 'comp_28d_pct', l: 'vs mismo período año anterior', f: pct, mejor: 'alto', comp: true },
  { k: 'comp_ytd_pct', l: 'Acumulado año vs año anterior', f: pct, mejor: 'alto', comp: true },
  { k: 'margen_pct', l: 'Margen bruto', f: pct, mejor: 'alto' },

  { g: 'Productividad del inventario' },
  { k: 'rotacion', l: 'Rotación anual', f: x, mejor: 'alto', ref: 'HD ' + fD(REF_ROTACION, 1) + 'x' },
  { k: 'gmroi', l: 'GMROI (margen por $ invertido)', f: x, mejor: 'alto' },
  { k: 'semanas_cobertura', l: 'Semanas de venta en stock', f: sem, mejor: 'bajo' },

  { g: 'Disponibilidad' },
  { k: 'instock_clave_hoy', l: 'SKU clave con stock hoy', f: pct, mejor: 'alto', ref: 'obj. ' + REF_INSTOCK_CLAVE + '%' },
  { k: 'instock_clave_84d', l: 'SKU clave con stock, 84 días', f: pct, mejor: 'alto', ref: 'obj. ' + REF_INSTOCK_CLAVE + '%' },
  { k: 'skus_quiebre', l: 'SKU en quiebre o bajo seguridad', f: n, mejor: 'bajo' },
  { k: 'venta_perdida_84d', l: 'Venta perdida estimada, 84 días', f: mm, mejor: 'bajo' },
  { k: 'perdida_con_stock_en_cd', l: '…con el producto en el CD', f: mm, mejor: 'bajo' },

  { g: 'Salud del stock' },
  { k: 'pct_surtido_vende', l: 'Surtido que vendió en 84 días', f: pct, mejor: 'alto' },
  { k: 'valor_exceso', l: 'Stock sobre cobertura objetivo', f: mm, mejor: 'bajo' },
  { k: 'ag_mas_180', l: 'Sin venta hace más de 180 días', f: mm, mejor: 'bajo' },
  { k: 'ag_nunca', l: 'Sin ninguna venta registrada', f: mm, mejor: 'bajo' },
  { k: 'valor_cd_sin_demanda', l: 'En CD sin demanda en ninguna sala', f: mm },
]

const TRAMOS = [
  { k: 'ag_0_30',    l: '0–30 días',  c: VERDE },
  { k: 'ag_31_90',   l: '31–90',      c: AZUL },
  { k: 'ag_91_180',  l: '91–180',     c: AMBAR },
  { k: 'ag_mas_180', l: '+180',       c: ROJO },
  { k: 'ag_nunca',   l: 'sin venta',  c: MORADO },
]

/* ── Hallazgos: lo que el gerente debería leer antes que la tabla ─── */
function hallazgos(por, reb, compListo) {
  const h = []
  const red = por.red, cd = por['suc-mp']
  const salas = ['suc-lg', 'suc-la', 'suc-maipu'].map(id => por[id]).filter(Boolean)
  if (!red) return h

  if (+red.perdida_con_stock_en_cd > 0) h.push({
    c: ROJO, t: 'La venta se pierde en la distribución, no en la compra',
    d: `${mm(red.perdida_con_stock_en_cd)} de venta perdida en 84 días corresponde a ${n(red.skus_quiebre_con_cd)} ` +
       `productos que la sala no tenía pero el CD sí. Es ${pct(100 * red.perdida_con_stock_en_cd / (+red.venta_perdida_84d || 1))} ` +
       `del total perdido: se resuelve con frecuencia de despacho, sin gastar en compras.`,
  })

  const peorIn = salas.filter(s => s.instock_clave_hoy != null).sort((a, b) => a.instock_clave_hoy - b.instock_clave_hoy)[0]
  if (peorIn && peorIn.instock_clave_hoy < REF_INSTOCK_CLAVE) h.push({
    c: AMBAR, t: `${peorIn.nombre}: faltan productos clave`,
    d: `De los ${n(peorIn.skus_clave)} SKU que hacen el 80% de su venta, ${pct(100 - peorIn.instock_clave_hoy)} ` +
       `no tiene stock hoy. La referencia para ítems clave es sobre ${REF_INSTOCK_CLAVE}%.`,
  })

  if (+red.rotacion > 0 && +red.rotacion < REF_ROTACION) {
    const liberable = +red.valor * (1 - red.rotacion / REF_ROTACION)
    h.push({
      c: AZUL, t: `La red rota ${x(red.rotacion)} al año; Home Depot, ${fD(REF_ROTACION, 1)}x`,
      d: `Con la misma venta, rotar como Home Depot requeriría ${mm(+red.valor - liberable)} de inventario ` +
         `en vez de ${mm(red.valor)}: ${mm(liberable)} de capital que hoy está inmovilizado.`,
    })
  }

  if (cd) h.push({
    c: MORADO, t: `El CD guarda ${pct(cd.pct_del_inventario)} del inventario`,
    d: `${mm(cd.valor)} que cubren ${sem(cd.semanas_cobertura)} de venta de toda la red. ` +
       (+cd.valor_cd_sin_demanda > 0 ? `${mm(cd.valor_cd_sin_demanda)} no tienen demanda en ninguna sala: candidatos a liquidación.` : ''),
  })

  const caida = salas.filter(s => s.crec_28d_pct != null).sort((a, b) => a.crec_28d_pct - b.crec_28d_pct)[0]
  if (caida && caida.crec_28d_pct < -10) h.push({
    c: ROJO, t: `${caida.nombre}: venta ${pct(caida.crec_28d_pct)} en 28 días`,
    d: compListo && caida.comp_28d_pct != null
      ? `Contra el mismo período del año anterior: ${pct(caida.comp_28d_pct)}. ` +
        (caida.comp_28d_pct > -5 ? 'Es principalmente estacional.' : 'No es sólo estacional.')
      : 'La comparación contra el año anterior estará disponible cuando termine la carga de 2025.',
  })

  const recuperable = reb.reduce((a, r) => a + (+r.venta_recuperable || 0), 0)
  if (recuperable > 0) {
    const stgo = reb.filter(r => r.ruta === 'Santiago').reduce((a, r) => a + (+r.venta_recuperable || 0), 0)
    h.push({
      c: VERDE, t: 'Venta recuperable sin comprar nada',
      d: `Mover stock entre salas recupera ${mm(recuperable)} de venta con ${mm(reb.reduce((a, r) => a + (+r.valor_costo || 0), 0))} ` +
         `de inventario que ya existe. ${mm(stgo)} son rutas dentro de Santiago. Detalle en Reponer → Entre salas.`,
    })
  }

  const nueva = salas.find(s => s.sala_nueva)
  if (nueva && +nueva.valor_exceso > 0) h.push({
    c: AMBAR, t: `${nueva.nombre} lleva ${n(nueva.dias_hist)} días abierta`,
    d: `${mm(nueva.valor_exceso)} de su stock está sobre la cobertura objetivo: se cargó la sala para la apertura. ` +
       `Sus indicadores anualizados son todavía poco estables.`,
  })
  return h
}

/* ── Semáforo: mejor y peor entre las salas en cada indicador ─────── */
function extremos(fila, por) {
  if (!fila.mejor) return {}
  const vals = ['suc-lg', 'suc-la', 'suc-maipu']
    .map(id => ({ id, v: por[id]?.[fila.k] }))
    .filter(o => o.v != null && !isNaN(+o.v))
  if (vals.length < 2) return {}
  vals.sort((a, b) => +a.v - +b.v)
  const [lo, hi] = [vals[0].id, vals[vals.length - 1].id]
  return fila.mejor === 'alto' ? { [hi]: VERDE, [lo]: ROJO } : { [lo]: VERDE, [hi]: ROJO }
}

function Antiguedad({ por }) {
  return (
    <div>
      {COLUMNAS.filter(id => id !== 'red' && por[id]).map(id => {
        const r = por[id]
        const total = TRAMOS.reduce((a, t) => a + (+r[t.k] || 0), 0) || 1
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
            <div style={{ width: 96, fontSize: 11.5, color: INK, fontWeight: 600, flexShrink: 0 }}>{r.nombre}</div>
            <div style={{ flex: 1, display: 'flex', height: 18, borderRadius: 3, overflow: 'hidden', background: LINE }}>
              {TRAMOS.map(t => {
                const v = +r[t.k] || 0
                return v > 0 && (
                  <div key={t.k} title={`${t.l}: ${fmt(v)} (${fD(100 * v / total, 1)}%)`}
                       style={{ width: `${100 * v / total}%`, background: t.c }} />
                )
              })}
            </div>
            <div style={{ width: 68, fontSize: 11, color: SLATE, textAlign: 'right', flexShrink: 0 }}>{mm(total)}</div>
          </div>
        )
      })}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 11, marginTop: 7 }}>
        {TRAMOS.map(t => (
          <span key={t.k} style={{ fontSize: 10.5, color: SLATE, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: t.c }} />{t.l}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 11, color: SLATE, marginTop: 7, lineHeight: 1.45 }}>
        Valor a costo según días desde la última venta en esa sala. En el CD se mide contra la última venta en
        cualquier sala: el stock del CD envejece cuando la red deja de vender el producto.
      </div>
    </div>
  )
}

export function InvSalas({ scorecard, comparable, rebalanceo, kpiSku, compListo, onProducto }) {
  const [salaSel, setSalaSel] = useState('suc-lg')

  const por = useMemo(() => {
    const m = Object.fromEntries((scorecard || []).map(r => [r.sucursal_id, { ...r }]))
    for (const c of comparable || []) if (m[c.sucursal_id]) {
      m[c.sucursal_id].comp_28d_pct = compListo ? c.comp_28d_pct : null
      m[c.sucursal_id].comp_ytd_pct = compListo ? c.comp_ytd_pct : null
    }
    return m
  }, [scorecard, comparable, compListo])

  const lista = useMemo(() => hallazgos(por, rebalanceo || [], compListo), [por, rebalanceo, compListo])

  const perdidas = useMemo(() => (kpiSku || [])
    .filter(f => f.sucursal_id === salaSel && +f.venta_perdida_84d > 0)
    .sort((a, b) => b.venta_perdida_84d - a.venta_perdida_84d).slice(0, 25), [kpiSku, salaSel])

  const colsPerdida = [
    { k: 'sku', l: 'SKU' },
    { k: 'producto', l: 'Producto', wrap: true },
    { k: 'estado', l: 'Estado', render: f => <Tag texto={f.estado} color={CL_ESTADO[f.estado]} /> },
    { k: 'disponible', l: 'Disp.', num: true },
    { k: 'pct_quiebre', l: 'Días sin stock', num: true, render: f => fN(f.pct_quiebre) + '%' },
    { k: 'demanda_dia', l: 'Venta/día con stock', num: true, render: f => fD(f.demanda_dia) },
    { k: 'venta_perdida_84d', l: 'Venta perdida 84d', num: true, render: f => <b style={{ color: ROJO }}>{fmt(f.venta_perdida_84d)}</b> },
  ]

  if (!scorecard?.length) return null

  return (
    <div>
      {lista.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8, marginBottom: 12 }}>
          {lista.map(o => (
            <div key={o.t} style={{
              background: '#fff', border: `1px solid ${LINE}`, borderLeft: `3px solid ${o.c}`,
              borderRadius: 4, padding: '9px 12px',
            }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginBottom: 3 }}>{o.t}</div>
              <div style={{ fontSize: 11.5, color: SLATE, lineHeight: 1.5 }}>{o.d}</div>
            </div>
          ))}
        </div>
      )}

      <Panel titulo="Comparativo por ubicación" sub="verde: mejor sala · rojo: peor sala">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, minWidth: 720 }}>
            <thead>
              <tr style={{ background: PAPER }}>
                <th style={th('left')}>Indicador</th>
                {COLUMNAS.map(id => (
                  <th key={id} style={{ ...th('right'), color: id === 'red' ? NAVY : SLATE }}>
                    {por[id]?.nombre || nombreSuc(id)}
                    {por[id]?.sala_nueva && <div style={{ fontSize: 9, fontWeight: 600, color: AMBAR, textTransform: 'none' }}>abierta hace {por[id].dias_hist} d</div>}
                  </th>
                ))}
                <th style={th('right')}>Ref.</th>
              </tr>
            </thead>
            <tbody>
              {FILAS.map((fila, i) => fila.g ? (
                <tr key={'g' + i}>
                  <td colSpan={COLUMNAS.length + 2} style={{
                    padding: '9px 9px 4px', fontSize: 10.5, fontWeight: 800, color: NAVY,
                    textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: `1px solid ${LINE}`,
                  }}>{fila.g}</td>
                </tr>
              ) : (
                <Fragment key={fila.k}>
                  <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                    <td style={{ padding: '5px 9px', color: INK, whiteSpace: 'nowrap' }}>
                      {fila.l}
                      {fila.comp && !compListo && <span style={{ fontSize: 10, color: AMBAR }}> · cargando 2025</span>}
                    </td>
                    {COLUMNAS.map(id => {
                      const c = extremos(fila, por)[id]
                      const v = por[id]?.[fila.k]
                      return (
                        <td key={id} style={{
                          padding: '5px 9px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                          color: c || INK, fontWeight: c || id === 'red' ? 700 : 400,
                          background: id === 'red' ? '#F7F8FB' : undefined,
                        }}>{fila.f(v)}</td>
                      )
                    })}
                    <td style={{ padding: '5px 9px', textAlign: 'right', fontSize: 10.5, color: SLATE, whiteSpace: 'nowrap' }}>{fila.ref || ''}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: SLATE, marginTop: 8, lineHeight: 1.5 }}>
          SKU clave: los que suman el 80% de la venta de cada sala. Rotación y GMROI anualizados sobre los días
          de venta de cada sala. En el CD, la rotación mide cuántas veces la venta de la red consume su stock en un año.
          La venta comparable excluye salas con menos de 12 meses abiertas.
        </div>
      </Panel>

      <Panel titulo="Antigüedad del inventario" sub="dónde se está envejeciendo el capital">
        <Antiguedad por={por} />
      </Panel>

      <Panel titulo="Dónde se pierde más venta"
             accion={<span style={{ display: 'flex', gap: 5 }}>
               {['suc-lg', 'suc-la', 'suc-maipu'].map(id => (
                 <Boton key={id} onClick={() => setSalaSel(id)} activo={salaSel === id} tono="primario">{nombreSuc(id)}</Boton>
               ))}
             </span>}>
        <Tabla cols={colsPerdida} filas={perdidas} onFila={f => onProducto(f.sku)}
               ordenInicial={{ col: 'venta_perdida_84d', dir: 'desc' }}
               nombreExport={`venta_perdida_${salaSel}`} tope={25} />
      </Panel>
    </div>
  )
}

function th(align) {
  return {
    padding: '7px 9px', textAlign: align, fontSize: 10.5, fontWeight: 700, color: SLATE,
    textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap',
  }
}
