/* ════════════════════════════════════════════════════════════════════
   InvPareto.jsx — qué categorías hacen el negocio y cuánto capital les cuesta.
   Junto a cada barra de venta o margen va la participación en el inventario:
   cuando la de inventario es mucho más alta, hay capital mal asignado.
   Barras y filas abren los productos de esa categoría en la base de datos.
   ════════════════════════════════════════════════════════════════════ */

import { useState, useMemo } from 'react'
import { Panel, Boton, Ex, Leyenda, Tag, Enlace, fmt, fD, fCLP, INK, SLATE, BORDE, PAPER, NAVY, ROJO, VERDE, AMBAR, MORADO } from './invUI'
import { CONFIG_DEFECTO } from './invData'
import { tablaExcel, tablaPdf } from './invReportes'

const CLASE = { A: VERDE, B: '#1D4E89', C: AMBAR }

function agrupar(rows, nivel) {
  const m = new Map()
  for (const r of rows || []) {
    const k = nivel === 'familia' ? r.familia : r.tipo
    const g = m.get(k) || { k, venta: 0, venta_con_costo: 0, cogs: 0, cogs_84d: 0, valor_inv: 0, valor_detenido: 0, valor_exceso: 0, valor_nuevo: 0 }
    g.venta += +r.venta_12m || 0; g.venta_con_costo += +r.venta_con_costo || 0; g.cogs += +r.cogs_12m || 0
    g.cogs_84d += +r.cogs_84d || 0; g.valor_inv += +r.valor_inv || 0; g.valor_detenido += +r.valor_detenido || 0
    g.valor_exceso += +r.valor_exceso || 0; g.valor_nuevo += +r.valor_nuevo || 0
    m.set(k, g)
  }
  return [...m.values()].map(g => ({ ...g, margen: g.venta_con_costo - g.cogs, sinClasificar: ['SIN CLASIFICAR', 'SIN TIPO'].includes(g.k) }))
}

function Grafico({ filas, metrica, onBarra }) {
  const W = 980, H = 300, PL = 42, PR = 42, PT = 14, PB = 96
  if (!filas.length) return null
  const iw = (W - PL - PR) / filas.length
  const maxPct = Math.max(...filas.map(f => Math.max(f.pct, f.pctInv)), 1)
  const y = p => PT + (H - PT - PB) * (1 - p / maxPct)
  const yA = p => PT + (H - PT - PB) * (1 - p / 100)
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 640, display: 'block' }} role="img" aria-label={`Pareto de ${metrica} por categoría`}>
        {[0, 25, 50, 75, 100].map(p => <g key={p}><line x1={PL} x2={W - PR} y1={yA(p)} y2={yA(p)} stroke={BORDE} /><text x={W - PR + 4} y={yA(p) + 3} fontSize="9.5" fill={SLATE}>{p}%</text></g>)}
        <line x1={PL} x2={W - PR} y1={yA(80)} y2={yA(80)} stroke={VERDE} strokeWidth="1.2" strokeDasharray="5 4" />
        <text x={PL + 3} y={yA(80) - 4} fontSize="9.5" fill={VERDE} fontWeight="700">80% acumulado</text>
        {[0, maxPct / 2, maxPct].map(p => <text key={p} x={PL - 5} y={y(p) + 3} fontSize="9.5" fill={SLATE} textAnchor="end">{fD(p, 0)}%</text>)}
        {filas.map((f, i) => {
          const x = PL + iw * i, bw = Math.max(iw * 0.36, 3)
          return (
            <g key={f.k} onClick={() => onBarra(f)} style={{ cursor: 'pointer' }} className="inv-tramo">
              <title>{`${f.k}\n${metrica === 'margen' ? 'Margen' : 'Venta'}: ${fmt(f.valor)} (${fD(f.pct, 1)}%)\nInventario: ${fmt(f.valor_inv)} (${fD(f.pctInv, 1)}%)\nClic para ver sus productos`}</title>
              <rect x={x} y={PT} width={iw} height={H - PT - PB} fill="transparent" />
              <rect x={x + iw / 2 - bw - 1} y={y(f.pct)} width={bw} height={Math.max(H - PB - y(f.pct), 0)} fill={CLASE[f.clase]} rx="1.5" />
              <rect x={x + iw / 2 + 1} y={y(f.pctInv)} width={bw} height={Math.max(H - PB - y(f.pctInv), 0)} fill={f.desbalance ? ROJO : '#B8BCC6'} opacity="0.85" rx="1.5" />
              <text transform={`translate(${x + iw / 2},${H - PB + 9}) rotate(-50)`} fontSize="9.2" fill={f.desbalance ? ROJO : INK} fontWeight={f.desbalance ? 700 : 400} textAnchor="end">
                {f.k.length > 22 ? f.k.slice(0, 21) + '…' : f.k}
              </text>
            </g>
          )
        })}
        <polyline points={filas.map((f, i) => `${PL + iw * i + iw / 2},${yA(f.acum)}`).join(' ')} fill="none" stroke={NAVY} strokeWidth="1.8" />
        {filas.map((f, i) => <circle key={f.k} cx={PL + iw * i + iw / 2} cy={yA(f.acum)} r="2.6" fill={NAVY} />)}
      </svg>
    </div>
  )
}

export function InvPareto({ pareto, cfg = CONFIG_DEFECTO, irABase }) {
  const [nivel, setNivel] = useState('familia')
  const [metrica, setMetrica] = useState('venta')

  const { filas, resumen } = useMemo(() => {
    const g = agrupar(pareto, nivel)
    const totV = g.reduce((a, f) => a + Math.max(f[metrica], 0), 0) || 1
    const totInv = g.reduce((a, f) => a + f.valor_inv, 0) || 1
    const totInvNeto = g.reduce((a, f) => a + f.valor_inv - f.valor_nuevo, 0) || 1
    const totMg = g.reduce((a, f) => a + Math.max(f.margen, 0), 0) || 1
    const F = +cfg.factor_desbalance || 2
    let acum = 0
    const filas = g.filter(f => f[metrica] > 0 || f.valor_inv > 0).sort((a, b) => b[metrica] - a[metrica]).map(f => {
      const valor = Math.max(f[metrica], 0), pct = 100 * valor / totV
      acum += pct
      const pctInvNeto = 100 * (f.valor_inv - f.valor_nuevo) / totInvNeto, pctMg = 100 * Math.max(f.margen, 0) / totMg
      const cogsMes = f.cogs_84d / 84 * 30.4
      return {
        ...f, valor, pct, acum: Math.min(acum, 100), pctInv: 100 * f.valor_inv / totInv, pctMg,
        clase: acum - pct < 80 ? 'A' : acum - pct < 95 ? 'B' : 'C',
        mesesInv: cogsMes > 0 ? (f.valor_inv - f.valor_nuevo) / cogsMes : null,
        gmroi: f.valor_inv > 0 ? f.margen / f.valor_inv : null,
        margenPct: f.venta_con_costo > 0 ? 100 * f.margen / f.venta_con_costo : null,
        desbalance: !f.sinClasificar && pctInvNeto >= 1 && pctInvNeto > F * pctMg,
      }
    })
    const a = filas.filter(f => f.clase === 'A'), desb = filas.filter(f => f.desbalance).sort((x, y) => y.valor_inv - x.valor_inv)
    return { filas, resumen: { nA: a.length, total: filas.length, pctInvA: a.reduce((s, f) => s + f.pctInv, 0), desb, invDesb: desb.reduce((s, f) => s + f.valor_inv, 0) } }
  }, [pareto, nivel, metrica, cfg])

  const abrir = f => irABase('productos', nivel === 'familia' ? { familia: [f.k], conStock: true } : { tipo_producto: [f.k], conStock: true },
                             `${nivel === 'familia' ? 'Familia' : 'Tipo'} ${f.k}: productos con stock`)
  const colsEx = [
    { k: 'k', l: nivel === 'familia' ? 'Familia' : 'Tipo' }, { k: 'clase', l: 'Clase' },
    { k: 'valor', l: metrica === 'venta' ? 'Venta 12m' : 'Margen 12m', num: true },
    { k: 'pct', l: '% del total', crudo: f => fD(f.pct, 1) }, { k: 'acum', l: 'Acumulado %', crudo: f => fD(f.acum, 1) },
    { k: 'margenPct', l: 'Margen %', crudo: f => f.margenPct == null ? '' : fD(f.margenPct, 1) },
    { k: 'valor_inv', l: 'Inventario', num: true }, { k: 'pctInv', l: '% inventario', crudo: f => fD(f.pctInv, 1) },
    { k: 'mesesInv', l: 'Meses de stock', crudo: f => f.mesesInv == null ? 'sin venta' : fD(f.mesesInv, 1) },
    { k: 'gmroi', l: 'GMROI', crudo: f => f.gmroi == null ? '' : fD(f.gmroi, 2) },
    { k: 'valor_detenido', l: 'Detenido', num: true }, { k: 'valor_exceso', l: 'Sobre objetivo', num: true }, { k: 'valor_nuevo', l: 'Recién llegado', num: true },
  ]
  const th = (al = 'right') => ({ padding: '6px 9px', textAlign: al, fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase',
                                  letterSpacing: 0.4, borderBottom: `1px solid ${BORDE}`, whiteSpace: 'nowrap', background: PAPER })
  const td = (al = 'right') => ({ padding: '6px 9px', textAlign: al, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' })

  return (
    <Panel titulo="Pareto por categoría" sub="qué categorías hacen el negocio y cuánto capital les cuesta · clic en una barra o fila para ver sus productos"
      acciones={<span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
        <Boton onClick={() => setNivel('familia')} activo={nivel === 'familia'} tono="primario">Familia</Boton>
        <Boton onClick={() => setNivel('tipo')} activo={nivel === 'tipo'} tono="primario">Tipo</Boton>
        <span style={{ width: 1, background: BORDE }} />
        <Boton onClick={() => setMetrica('venta')} activo={metrica === 'venta'} tono="primario">Venta</Boton>
        <Boton onClick={() => setMetrica('margen')} activo={metrica === 'margen'} tono="primario">Margen</Boton>
        <span style={{ width: 1, background: BORDE }} />
        <Ex onExcel={() => tablaExcel(filas, colsEx, `pareto_${nivel}`)}
            onPdf={() => tablaPdf({ titulo: `Inventario · Pareto por ${nivel} (${metrica})`, filas, cols: colsEx, nombre: `pareto_${nivel}`, orientacion: 'landscape' })} />
      </span>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: INK, lineHeight: 1.5, padding: '8px 11px', borderLeft: `3px solid ${VERDE}`, background: PAPER, borderRadius: 4 }}>
          <b>{resumen.nA} de {resumen.total} {nivel === 'familia' ? 'familias' : 'tipos'}</b> hacen el 80% de{metrica === 'venta' ? ' la venta' : 'l margen'} y
          concentran el <b>{fD(resumen.pctInvA, 1)}%</b> del inventario.
        </div>
        {resumen.desb.length > 0 && (
          <div style={{ fontSize: 12, color: INK, lineHeight: 1.5, padding: '8px 11px', borderLeft: `3px solid ${ROJO}`, background: PAPER, borderRadius: 4 }}>
            <b>{fCLP(resumen.invDesb)} en {resumen.desb.length} {nivel === 'familia' ? 'familias' : 'tipos'}</b> que absorben más de {fD(cfg.factor_desbalance, 1)} veces
            el inventario que el margen que producen:{' '}
            {resumen.desb.slice(0, 3).map((f, i) => <span key={f.k}>{i ? ', ' : ''}<Enlace color={ROJO} onClick={() => abrir(f)}>{f.k.toLowerCase()}</Enlace></span>)}.
          </div>
        )}
      </div>

      <Grafico filas={filas} metrica={metrica} onBarra={abrir} />

      <div style={{ overflowX: 'auto', marginTop: 8, border: `1px solid ${BORDE}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead><tr>{colsEx.map((c, i) => <th key={c.k} style={th(i === 0 ? 'left' : i === 1 ? 'center' : 'right')}>{c.l}</th>)}</tr></thead>
          <tbody>{filas.map(f => (
            <tr key={f.k} className="inv-fila" onClick={() => abrir(f)} style={{ borderBottom: `1px solid ${BORDE}`, cursor: 'pointer', background: f.desbalance ? ROJO + '08' : '#fff' }}>
              <td style={{ ...td('left'), fontWeight: 600, color: f.desbalance ? ROJO : NAVY }}>
                {f.k} ›{f.sinClasificar && <span style={{ fontSize: 10, color: AMBAR, fontWeight: 400 }}> · sin costo en el maestro</span>}
              </td>
              <td style={td('center')}><Tag texto={f.clase} color={CLASE[f.clase]} /></td>
              <td style={{ ...td(), fontWeight: 700 }}>{fmt(f.valor)}</td>
              <td style={td()}>{fD(f.pct, 1)}%</td>
              <td style={td()}>{fD(f.acum, 1)}%</td>
              <td style={{ ...td(), color: f.margenPct != null && f.margenPct < 25 ? ROJO : INK }}>{f.margenPct == null ? '—' : fD(f.margenPct, 1) + '%'}</td>
              <td style={td()}>{fmt(f.valor_inv)}</td>
              <td style={{ ...td(), fontWeight: f.desbalance ? 700 : 400, color: f.desbalance ? ROJO : INK }}>{fD(f.pctInv, 1)}%</td>
              <td style={{ ...td(), color: f.mesesInv > 12 ? ROJO : f.mesesInv > 6 ? AMBAR : INK }}>{f.mesesInv == null ? (f.valor_inv > 0 ? 'sin venta' : '—') : f.mesesInv > 120 ? '+120' : fD(f.mesesInv, 1)}</td>
              <td style={{ ...td(), color: f.gmroi != null && f.gmroi < 1 ? ROJO : VERDE }}>{f.gmroi == null ? '—' : fD(f.gmroi, 2)}</td>
              <td style={{ ...td(), color: f.valor_detenido > 0 ? ROJO : SLATE }}>{f.valor_detenido > 0 ? fCLP(f.valor_detenido) : '—'}</td>
              <td style={{ ...td(), color: f.valor_exceso > 0 ? MORADO : SLATE }}>{f.valor_exceso > 0 ? fCLP(f.valor_exceso) : '—'}</td>
              <td style={{ ...td(), color: SLATE }}>{f.valor_nuevo > 0 ? fCLP(f.valor_nuevo) : '—'}</td>
            </tr>))}</tbody>
        </table>
      </div>

      <Leyenda items={[
        { c: VERDE, t: 'Clase A', d: 'las categorías que juntas hacen el primer 80%. Nunca deberían quebrar.' },
        { c: '#1D4E89', t: 'Clase B', d: 'del 80% al 95%.' },
        { c: AMBAR, t: 'Clase C', d: 'el último 5%. Revisar si justifican espacio y capital.' },
        { c: '#B8BCC6', t: 'Barra gris', d: 'participación de la categoría en el inventario total.' },
        { c: ROJO, t: 'En rojo', d: `absorbe más de ${fD(cfg.factor_desbalance, 1)} veces el inventario que el margen que produce.` },
        { c: NAVY, t: 'Línea azul', d: 'porcentaje acumulado; donde cruza el 80% termina la clase A.' },
      ]} nota={<><b>Meses de stock</b>: meses de venta que cubre el inventario al ritmo de las últimas 12 semanas, sin lo recién llegado
        (sobre 12 es sobrecompra). <b>GMROI</b>: margen anual por peso invertido; bajo 1 no devuelve lo que inmoviliza.
        <b> Familia</b> junta primera y segunda selección y los perfiles con su producto.</>} />
    </Panel>
  )
}
