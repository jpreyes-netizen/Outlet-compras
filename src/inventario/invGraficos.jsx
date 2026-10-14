/* invGraficos.jsx — historia mensual + venta promedio + proyección, y proyección del stock. SVG sin librerías. */

import { NAVY, INK, SLATE, BORDE, ROJO, VERDE, AMBAR, fN, fD } from './invUI'
import { DIAS_MES, nombreMes, fechaCorta } from './invProyeccion'

const W = 760

/* Barras: 12 meses cerrados + mes en curso + 3 proyectados. Línea: venta promedio mensual actual. */
export function GraficoVenta({ serie, proyeccion, diaria }) {
  const H = 230, PL = 44, PR = 12, PT = 16, PB = 40
  const datos = [...serie, ...proyeccion]
  if (!datos.length || datos.every(d => !(d.unidades > 0))) {
    return <div style={{ padding: '26px 12px', textAlign: 'center', color: SLATE, fontSize: 12.5, border: `1px dashed ${BORDE}`, borderRadius: 8 }}>
      Sin ventas en los últimos 13 meses: no hay historia que graficar ni venta que proyectar.</div>
  }
  const prom = diaria * DIAS_MES
  const max = Math.max(...datos.map(d => d.unidades), prom, 1) * 1.12
  const iw = (W - PL - PR) / datos.length
  const y = v => PT + (H - PT - PB) * (1 - v / max)
  // Marcas del eje sin repetir (con ventas muy bajas, max/2 y max pueden redondear al mismo número)
  const ticks = [...new Set([0, max / 2, max].map(v => Math.round(v)))]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label="Venta mensual, venta promedio y proyección">
      {ticks.map(t => <g key={t}><line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke={BORDE} />
        <text x={PL - 6} y={y(t) + 3} fontSize="10" fill={SLATE} textAnchor="end">{fN(t)}</text></g>)}
      {datos.map((d, i) => {
        const x = PL + iw * i + iw * 0.15, w = iw * 0.7, h = Math.max(H - PB - y(d.unidades), d.unidades > 0 ? 1 : 0)
        const quiebre = d.pctStock != null && d.pctStock < 80
        return (
          <g key={d.mes}>
            <title>{`${nombreMes(d.mes)}: ${fN(d.unidades)} unidades${d.proyectado ? ' (proyectado)' : d.parcial ? ' (mes en curso)' : ''}${d.pctStock != null ? ` · stock ${d.pctStock}% de los días` : ''}`}</title>
            <rect x={x} y={H - PB - h} width={w} height={h} rx="2"
                  fill={d.proyectado ? '#fff' : d.parcial ? NAVY + '66' : NAVY}
                  stroke={d.proyectado ? VERDE : 'none'} strokeDasharray={d.proyectado ? '4 3' : undefined} strokeWidth="1.5" />
            {quiebre && <circle cx={x + w / 2} cy={H - PB - h - 6} r="3.2" fill={AMBAR}><title>{`Tuvo stock sólo el ${d.pctStock}% de los días`}</title></circle>}
            <text x={x + w / 2} y={H - PB + 13} fontSize="9.5" fill={d.proyectado ? VERDE : INK} textAnchor="middle" fontWeight={d.proyectado ? 700 : 400}>{nombreMes(d.mes)}</text>
            {d.proyectado && <text x={x + w / 2} y={H - PB + 25} fontSize="8.5" fill={VERDE} textAnchor="middle">proyección</text>}
            {d.parcial && <text x={x + w / 2} y={H - PB + 25} fontSize="8.5" fill={SLATE} textAnchor="middle">en curso</text>}
          </g>
        )
      })}
      <line x1={PL} x2={W - PR} y1={y(prom)} y2={y(prom)} stroke={VERDE} strokeWidth="1.6" strokeDasharray="6 4" />
      <text x={W - PR} y={y(prom) - 5} fontSize="10" fill={VERDE} textAnchor="end" fontWeight="700">venta promedio actual: {fD(prom, 1)} al mes</text>
    </svg>
  )
}

/* Stock disponible proyectado a la venta promedio, sin compras nuevas */
export function GraficoStock({ p }) {
  const H = 170, PL = 44, PR = 12, PT = 14, PB = 26
  if (!p) return null
  const max = Math.max(p.disponible, p.puntoReorden, p.seguridad, 1) * 1.1
  const x = d => PL + (W - PL - PR) * d / p.horizonte
  const y = v => PT + (H - PT - PB) * (1 - v / max)
  const linea = p.puntos.map(q => `${x(q.dia)},${y(q.stock)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label="Proyección del stock disponible">
      {[0, 30, 60, 90].filter(d => d <= p.horizonte).map(d => <g key={d}>
        <line x1={x(d)} x2={x(d)} y1={PT} y2={H - PB} stroke={BORDE} />
        <text x={x(d)} y={H - PB + 13} fontSize="9.5" fill={SLATE} textAnchor="middle">{d === 0 ? 'hoy' : `+${d} días`}</text></g>)}
      <text x={PL - 6} y={y(max / 1.1) + 3} fontSize="10" fill={SLATE} textAnchor="end">{fN(max / 1.1)}</text>
      <text x={PL - 6} y={y(0) + 3} fontSize="10" fill={SLATE} textAnchor="end">0</text>
      {p.puntoReorden > 0 && <g><line x1={PL} x2={W - PR} y1={y(p.puntoReorden)} y2={y(p.puntoReorden)} stroke={AMBAR} strokeDasharray="5 4" />
        <text x={W - PR} y={y(p.puntoReorden) - 4} fontSize="9.5" fill={AMBAR} textAnchor="end">punto de reorden {fN(p.puntoReorden)}</text></g>}
      {p.seguridad > 0 && <g><line x1={PL} x2={W - PR} y1={y(p.seguridad)} y2={y(p.seguridad)} stroke={ROJO} strokeDasharray="2 3" />
        <text x={W - PR} y={y(p.seguridad) + 11} fontSize="9.5" fill={ROJO} textAnchor="end">stock de seguridad {fN(p.seguridad)}</text></g>}
      <polyline points={linea} fill="none" stroke={NAVY} strokeWidth="2" />
      {p.diasQuiebre != null && p.diasQuiebre <= p.horizonte && <g>
        <line x1={x(p.diasQuiebre)} x2={x(p.diasQuiebre)} y1={PT} y2={H - PB} stroke={ROJO} strokeWidth="1.4" />
        <text x={x(p.diasQuiebre) + (p.diasQuiebre > p.horizonte * 0.75 ? -4 : 4)} y={PT + 10} fontSize="10" fill={ROJO} fontWeight="700"
              textAnchor={p.diasQuiebre > p.horizonte * 0.75 ? 'end' : 'start'}>se acaba ≈ {fechaCorta(p.fechaQuiebre)}</text></g>}
    </svg>
  )
}

export function LeyendaGraficos() {
  const it = (c, t, dash) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
    <span style={{ width: 16, height: dash ? 0 : 10, borderTop: dash ? `2px dashed ${c}` : 'none', background: dash ? 'none' : c, borderRadius: 2 }} />{t}</span>
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: SLATE, marginTop: 4 }}>
      {it(NAVY, 'venta del mes')}{it(NAVY + '66', 'mes en curso')}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 10, border: `1.5px dashed ${VERDE}`, borderRadius: 2 }} />proyección</span>
      {it(VERDE, 'venta promedio actual', true)}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: AMBAR }} />mes con stock menos del 80% de los días</span>
    </div>
  )
}
