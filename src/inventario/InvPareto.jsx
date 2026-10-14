/* ════════════════════════════════════════════════════════════════════
   InvPareto.jsx — Pareto por categoría
   No basta saber qué categorías venden más: hay que ver cuánto capital
   absorbe cada una para producir ese margen. Una categoría con 5% del
   inventario y 0,5% del margen es dinero mal asignado aunque "venda".
   ════════════════════════════════════════════════════════════════════ */

import { useState, useMemo } from 'react'
import { Panel, Boton, Leyenda, Tag, fmt, fN, fD, fCLP, INK, SLATE, LINE, NAVY, ROJO, VERDE, AMBAR, MORADO } from './invUI'
import { CONFIG_DEFECTO } from './invData'

const CLASE = { A: VERDE, B: '#1D4E89', C: AMBAR }

function agrupar(rows, nivel) {
  const m = new Map()
  for (const r of rows || []) {
    const k = nivel === 'familia' ? r.familia : r.tipo
    const g = m.get(k) || { k, venta: 0, venta_con_costo: 0, cogs: 0, cogs_84d: 0, venta_sin_costo: 0, valor_inv: 0,
      valor_detenido: 0, valor_exceso: 0, valor_nuevo: 0, valor_lento: 0, skus_con_stock: 0, skus_vendidos: 0, tipos: 0 }
    for (const c of ['venta_con_costo', 'cogs_12m', 'cogs_84d', 'venta_sin_costo', 'valor_inv', 'valor_detenido', 'valor_exceso',
                     'valor_nuevo', 'valor_lento', 'skus_con_stock', 'skus_vendidos'])
      g[c === 'cogs_12m' ? 'cogs' : c] += +r[c] || 0
    g.venta += +r.venta_12m || 0
    g.tipos++
    m.set(k, g)
  }
  return [...m.values()].map(g => ({ ...g, margen: g.venta_con_costo - g.cogs, sinClasificar: g.k === 'SIN CLASIFICAR' || g.k === 'SIN TIPO' }))
}

function Grafico({ filas, metrica }) {
  const W = 960, H = 300, PL = 40, PR = 40, PT = 14, PB = 92
  const n = filas.length
  if (!n) return null
  const iw = (W - PL - PR) / n
  const maxPct = Math.max(...filas.map(f => Math.max(f.pct, f.pctInv)), 1)
  const y = p => PT + (H - PT - PB) * (1 - p / maxPct)
  const yA = p => PT + (H - PT - PB) * (1 - p / 100)
  const linea = filas.map((f, i) => `${PL + iw * i + iw / 2},${yA(f.acum)}`).join(' ')

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 640, display: 'block' }} role="img"
           aria-label={`Pareto de ${metrica} por categoría`}>
        {[0, 25, 50, 75, 100].map(p => (
          <g key={p}>
            <line x1={PL} x2={W - PR} y1={yA(p)} y2={yA(p)} stroke={LINE} strokeWidth="1" />
            <text x={W - PR + 4} y={yA(p) + 3} fontSize="9.5" fill={SLATE}>{p}%</text>
          </g>
        ))}
        <line x1={PL} x2={W - PR} y1={yA(80)} y2={yA(80)} stroke={VERDE} strokeWidth="1.2" strokeDasharray="5 4" />
        <text x={PL + 3} y={yA(80) - 4} fontSize="9.5" fill={VERDE} fontWeight="700">80% acumulado</text>
        {[0, maxPct / 2, maxPct].map(p => (
          <text key={p} x={PL - 5} y={y(p) + 3} fontSize="9.5" fill={SLATE} textAnchor="end">{fD(p, 0)}%</text>
        ))}
        {filas.map((f, i) => {
          const x = PL + iw * i
          const bw = Math.max(iw * 0.36, 3)
          return (
            <g key={f.k}>
              <title>{`${f.k}\n${metrica === 'margen' ? 'Margen' : 'Venta'}: ${fmt(f.valor)} (${fD(f.pct, 1)}%)\nInventario: ${fmt(f.valor_inv)} (${fD(f.pctInv, 1)}%)\nAcumulado: ${fD(f.acum, 1)}%`}</title>
              <rect x={x + iw / 2 - bw - 1} y={y(f.pct)} width={bw} height={Math.max(H - PB - y(f.pct), 0)}
                    fill={CLASE[f.clase]} rx="1.5" />
              <rect x={x + iw / 2 + 1} y={y(f.pctInv)} width={bw} height={Math.max(H - PB - y(f.pctInv), 0)}
                    fill={f.desbalance ? ROJO : '#B8BCC6'} opacity={f.desbalance ? 0.85 : 0.75} rx="1.5" />
              <text transform={`translate(${x + iw / 2},${H - PB + 9}) rotate(-50)`} fontSize="9.2"
                    fill={f.desbalance ? ROJO : INK} fontWeight={f.desbalance ? 700 : 400} textAnchor="end">
                {f.k.length > 22 ? f.k.slice(0, 21) + '…' : f.k}
              </text>
            </g>
          )
        })}
        <polyline points={linea} fill="none" stroke={NAVY} strokeWidth="1.8" />
        {filas.map((f, i) => <circle key={f.k} cx={PL + iw * i + iw / 2} cy={yA(f.acum)} r="2.6" fill={NAVY} />)}
      </svg>
    </div>
  )
}

export function InvPareto({ pareto, cfg = CONFIG_DEFECTO }) {
  const [nivel, setNivel] = useState('familia')
  const [metrica, setMetrica] = useState('venta')

  const { filas, resumen } = useMemo(() => {
    const g = agrupar(pareto, nivel)
    const totV = g.reduce((a, f) => a + Math.max(f[metrica], 0), 0) || 1
    const totInv = g.reduce((a, f) => a + f.valor_inv, 0) || 1
    // Para juzgar asignación de capital se excluye lo recién llegado: una apuesta nueva no es un error todavía
    const totInvNeto = g.reduce((a, f) => a + f.valor_inv - f.valor_nuevo, 0) || 1
    const F = +cfg.factor_desbalance || 2
    const totMg = g.reduce((a, f) => a + Math.max(f.margen, 0), 0) || 1
    const orden = g.filter(f => f[metrica] > 0 || f.valor_inv > 0).sort((a, b) => b[metrica] - a[metrica])
    let acum = 0
    const filas = orden.map(f => {
      const valor = Math.max(f[metrica], 0)
      const pct = 100 * valor / totV
      acum += pct
      const pctInv = 100 * f.valor_inv / totInv
      const pctInvNeto = 100 * (f.valor_inv - f.valor_nuevo) / totInvNeto
      const pctMg = 100 * Math.max(f.margen, 0) / totMg
      // Meses de stock al ritmo de las últimas 12 semanas (no del año): refleja la tendencia actual
      const cogsMes = f.cogs_84d / 84 * 30.4
      const mesesInv = cogsMes > 0 ? (f.valor_inv - f.valor_nuevo) / cogsMes : null
      return {
        ...f, valor, pct, acum: Math.min(acum, 100), pctInv, pctMg, mesesInv,
        clase: acum - pct < 80 ? 'A' : acum - pct < 95 ? 'B' : 'C',
        gmroi: f.valor_inv > 0 ? f.margen / f.valor_inv : null,
        margenPct: f.venta_con_costo > 0 ? 100 * f.margen / f.venta_con_costo : null,
        // Capital mal asignado: absorbe bastante más inventario que margen produce
        desbalance: !f.sinClasificar && pctInvNeto >= 1 && pctInvNeto > F * pctMg,
      }
    })
    const a = filas.filter(f => f.clase === 'A')
    const desb = filas.filter(f => f.desbalance).sort((x, y) => y.valor_inv - x.valor_inv)
    return { filas, resumen: {
      nA: a.length, total: filas.length,
      pctInvA: a.reduce((s, f) => s + f.pctInv, 0),
      desb, invDesb: desb.reduce((s, f) => s + f.valor_inv, 0),
      sinClas: filas.find(f => f.sinClasificar),
    } }
  }, [pareto, nivel, metrica, cfg])

  const th = (al = 'right') => ({ padding: '6px 8px', textAlign: al, fontSize: 10.2, fontWeight: 700, color: SLATE,
    textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap', background: '#FAFAFB' })
  const td = (al = 'right') => ({ padding: '5px 8px', textAlign: al, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' })

  return (
    <Panel titulo="Pareto por categoría" sub="qué categorías hacen el negocio, y cuánto capital les cuesta"
      accion={<span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <Boton onClick={() => setNivel('familia')} activo={nivel === 'familia'} tono="primario">Familia</Boton>
        <Boton onClick={() => setNivel('tipo')} activo={nivel === 'tipo'} tono="primario">Tipo</Boton>
        <span style={{ width: 1, background: LINE, margin: '0 2px' }} />
        <Boton onClick={() => setMetrica('venta')} activo={metrica === 'venta'} tono="primario">Venta</Boton>
        <Boton onClick={() => setMetrica('margen')} activo={metrica === 'margen'} tono="primario">Margen</Boton>
      </span>}>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: INK, lineHeight: 1.5, padding: '7px 10px', borderLeft: `3px solid ${VERDE}`, background: '#fff' }}>
          <b>{resumen.nA} de {resumen.total} {nivel === 'familia' ? 'familias' : 'tipos'}</b> hacen el 80% de
          {metrica === 'venta' ? ' la venta' : 'l margen'} y concentran el <b>{fD(resumen.pctInvA, 1)}%</b> del inventario.
        </div>
        {resumen.desb.length > 0 && (
          <div style={{ fontSize: 12, color: INK, lineHeight: 1.5, padding: '7px 10px', borderLeft: `3px solid ${ROJO}`, background: '#fff' }}>
            <b>{fCLP(resumen.invDesb)} en {resumen.desb.length} {nivel === 'familia' ? 'familias' : 'tipos'}</b> que absorben más
            de {fD(cfg.factor_desbalance, 1)} veces el inventario que el margen que producen: {resumen.desb.slice(0, 3).map(f => f.k.toLowerCase()).join(', ')}
            {resumen.desb.length > 3 ? '…' : ''}.
          </div>
        )}
      </div>

      <Grafico filas={filas} metrica={metrica} />

      <div style={{ overflowX: 'auto', marginTop: 8, border: `1px solid ${LINE}`, borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.8, minWidth: 980 }}>
          <thead><tr>
            <th style={th('left')}>{nivel === 'familia' ? 'Familia' : 'Tipo'}</th>
            <th style={th('center')}>Clase</th>
            <th style={th()}>{metrica === 'venta' ? 'Venta 12m' : 'Margen 12m'}</th>
            <th style={th()}>% del total</th>
            <th style={th()}>Acumulado</th>
            <th style={th()}>Margen %</th>
            <th style={th()}>Inventario</th>
            <th style={th()}>% inventario</th>
            <th style={th()}>Meses de stock</th>
            <th style={th()}>GMROI</th>
            <th style={th()}>Detenido</th>
            <th style={th()}>Exceso</th>
            <th style={th()}>Recién llegado</th>
          </tr></thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.k} style={{ borderBottom: `1px solid ${LINE}`, background: f.desbalance ? ROJO + '08' : i % 2 ? '#FCFCFD' : '#fff' }}>
                <td style={{ ...td('left'), fontWeight: 600, color: f.desbalance ? ROJO : INK }}>
                  {f.k}{f.sinClasificar && <span style={{ fontSize: 10, color: AMBAR }}> · sin costo en el maestro</span>}
                </td>
                <td style={td('center')}><Tag texto={f.clase} color={CLASE[f.clase]} /></td>
                <td style={{ ...td(), fontWeight: 700 }}>{fmt(f.valor)}</td>
                <td style={td()}>{fD(f.pct, 1)}%</td>
                <td style={td()}>{fD(f.acum, 1)}%</td>
                <td style={{ ...td(), color: f.margenPct != null && f.margenPct < 25 ? ROJO : INK }}>
                  {f.margenPct == null ? '—' : fD(f.margenPct, 1) + '%'}</td>
                <td style={td()}>{fmt(f.valor_inv)}</td>
                <td style={{ ...td(), fontWeight: f.desbalance ? 700 : 400, color: f.desbalance ? ROJO : INK }}>{fD(f.pctInv, 1)}%</td>
                <td style={{ ...td(), color: f.mesesInv > 12 ? ROJO : f.mesesInv > 6 ? AMBAR : INK }}>
                  {f.mesesInv == null ? (f.valor_inv > 0 ? 'sin venta' : '—') : f.mesesInv > 120 ? '+120' : fD(f.mesesInv, 1)}</td>
                <td style={{ ...td(), color: f.gmroi != null && f.gmroi < 1 ? ROJO : VERDE }}>{f.gmroi == null ? '—' : fD(f.gmroi, 2)}</td>
                <td style={{ ...td(), color: f.valor_detenido > 0 ? ROJO : SLATE }}>{f.valor_detenido > 0 ? fCLP(f.valor_detenido) : '—'}</td>
                <td style={{ ...td(), color: f.valor_exceso > 0 ? MORADO : SLATE }}>{f.valor_exceso > 0 ? fCLP(f.valor_exceso) : '—'}</td>
                <td style={{ ...td(), color: SLATE }}>{f.valor_nuevo > 0 ? fCLP(f.valor_nuevo) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Leyenda items={[
        { c: VERDE, t: 'Clase A', d: 'Las categorías que juntas hacen el primer 80%. Nunca deberían quebrar.' },
        { c: '#1D4E89', t: 'Clase B', d: 'Del 80% al 95%. Importantes, con más margen para negociar stock.' },
        { c: AMBAR, t: 'Clase C', d: 'El último 5%. Revisar si justifican el espacio y el capital que usan.' },
        { c: '#B8BCC6', t: 'Barra gris', d: 'Participación de esa categoría en el inventario total (a costo).' },
        { c: ROJO, t: 'Barra o fila roja', d: `Absorbe más de ${fD(cfg.factor_desbalance, 1)} veces el inventario que el margen que produce: capital mal asignado.` },
        { c: NAVY, t: 'Línea azul', d: 'Porcentaje acumulado. Donde cruza la línea verde de 80% termina la clase A.' },
      ]} nota={<><b>Meses de stock</b>: cuántos meses de venta cubre el inventario, al ritmo de las <b>últimas 12 semanas</b> (no
        del año, para que una categoría que está acelerando o frenando se vea como está hoy) y sin contar lo recién llegado.
        Sobre 12 meses es una categoría sobrecomprada. El desbalance también excluye lo recién llegado: una apuesta nueva
        no es un error hasta que tenga tiempo de venderse. El margen usa el costo actual de cada producto. <b>GMROI</b>: pesos de margen al año por cada peso invertido en
        inventario; bajo 1 la categoría no devuelve lo que inmoviliza. <b>Familia</b> junta primera y segunda selección y
        los perfiles con su producto; <b>Tipo</b> muestra la clasificación tal como está en el maestro. "Sin clasificar" son
        productos sin tipo ni costo en el maestro del ERP: su margen no se puede calcular.</>} />
    </Panel>
  )
}
