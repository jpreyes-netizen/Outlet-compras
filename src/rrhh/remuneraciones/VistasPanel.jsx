// src/rrhh/remuneraciones/VistasPanel.jsx
// Vistas base del Panel de dotación y costo. Todas trabajan sobre el modelo ya
// filtrado por centro (remDatos.filtrarModelo): con un centro elegido, cada cifra
// es la de ese centro (venta, margen y costo oficial del resultado por sucursal).
import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, ComposedChart, ScatterChart, Scatter, ZAxis, ReferenceLine, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import {
  agg, aggCentro, aggFuncion, mesesNomina, filasMensuales, acumulado, movimientos, retornoIncremental, tableroCentros,
  analisisHhee, analisisWorkera, workeraCentroMes, puenteCosto, hallazgos, matrizIndicador, costoNomina, costoPorFte,
  div, variacion, fM, fmt, fN, fP, fVar, fPts, fDelta, fEnt, fPesos, mesCorto, mesSolo, mesLargo, mesTexto, perAnterior, perSiguiente,
  partidaL, ORDEN_PARTIDA, CLASES, TIPOS_HHEE, esApoyo,
} from './remDatos'
import { PanelPorGrupo, ResumenGerencias, CruceEerr } from './VistasArea'
import {
  C, Panel, Franja, Seg, Tabla, Cascada, TT, NIVEL, btn, sel, exportar, filasExport, Fila2, BotonExcel,
  tonoSube, tonoBaja, pesos, ejeM, colorCentro, lsGet, lsSet, colorCalor,
} from './remUi'

// ═══ RESUMEN ════════════════════════════════════════════════════════════════
export function VistaResumen({ m, anio, mes, pBase, irA, filtrarArea }) {
  const filas = useMemo(() => filasMensuales(m, anio), [m, anio])
  const acum = useMemo(() => acumulado(filas), [filas])
  const hall = useMemo(() => hallazgos(m, anio, mes, pBase), [m, anio, mes, pBase])
  const hh = useMemo(() => analisisHhee(m, anio), [m, anio])
  const filasBase = useMemo(() => (pBase && pBase.slice(0, 4) !== String(anio) ? filasMensuales(m, pBase.slice(0, 4)) : filas), [m, pBase, anio, filas])
  const r = filas.find(x => x.p === mes) || {}
  const rb = (pBase && filasBase.find(x => x.p === pBase)) || {}
  const a = agg(m, mes), ab = agg(m, pBase)
  const vs = pBase ? ` vs ${mesCorto(pBase)}` : ''
  const dPct = r.pct != null && rb.pct != null ? r.pct - rb.pct : null
  const lcp = m.fuenteCosto === 'nomina' ? 'Costo de nómina' : m.filtrado ? 'Costo de personal (prorrateado)' : 'Costo de personal (libro mayor)'
  const items = [
    { l: lcp, v: fM(r.cp), s: rb.cp ? `${fVar(variacion(rb.cp, r.cp))}${vs}` : (r.cp == null ? 'Sin resultado del mes' : ''), sColor: tonoSube(variacion(rb.cp, r.cp)), s2: `Año: ${fM(acum.cp)}`, ayuda: m.filtrado ? 'Costo oficial del libro mayor prorrateado al centro según sus haberes (resultado por sucursal de Finanzas).' : 'Cuenta de remuneraciones del libro mayor (haberes, aportes y honorarios). Es la cifra del EERR.' },
    { l: m.porArea ? 'Sobre la venta total' : 'Sobre la venta neta', v: fP(r.pct), s: dPct != null ? `${fPts(dPct)}${vs}` : '', sColor: tonoSube(dPct), s2: `Año: ${fP(acum.pct)}` },
    { l: 'Venta neta', v: fM(r.venta), s: rb.venta ? `${fVar(variacion(rb.venta, r.venta))}${vs}` : '', sColor: tonoBaja(variacion(rb.venta, r.venta)), s2: `Año: ${fM(acum.venta)}` },
    m.porArea ? { l: 'Peso en la nómina de la empresa', v: fP(div(costoNomina(a), costoNomina(m.totEmpresa.get(mes) || a))), s: pBase ? `${mesCorto(pBase)}: ${fP(div(costoNomina(ab), costoNomina(m.totEmpresa.get(pBase) || ab)))}` : '', ayuda: 'Costo de nómina del área ÷ costo de nómina de toda la empresa.' } : { l: 'ROI de personal', v: fP(r.roi, 0), s: r.gmrol != null ? `${pesos(r.gmrol)} de margen por cada $1` : '', s2: rb.roi != null ? `${mesCorto(pBase)}: ${fP(rb.roi, 0)}` : '', color: r.roi != null && rb.roi != null && r.roi < rb.roi ? C.rojo : C.navy, ayuda: '(Margen bruto − costo de personal) ÷ costo de personal.' },
    m.porArea ? null : { l: m.filtrado ? 'Contribución' : 'EBITDA', v: fM(m.filtrado ? r.contrib : r.ebitda), color: (m.filtrado ? r.contrib : r.ebitda) < 0 ? C.rojo : C.navy, s: `Año: ${fM(m.filtrado ? acum.contrib : acum.ebitda)}`, ayuda: m.filtrado ? 'Margen bruto − costo de personal − mermas − gastos directos del centro.' : 'EBITDA del libro mayor.' },
    { l: 'Dotación', v: fN(a.dot), s: `${fN(a.fte, 1)} FTE`, s2: pBase ? `${fEnt(a.dot - ab.dot)} personas${vs}` : '', ayuda: 'Liquidaciones emitidas en el mes. FTE = días trabajados ÷ 30.' },
    { l: 'Nómina por FTE', v: fmt(costoPorFte(a)), s: pBase ? `${fVar(variacion(costoPorFte(ab), costoPorFte(a)))}${vs}` : '', sColor: tonoSube(variacion(costoPorFte(ab), costoPorFte(a))), ayuda: '(Haberes + aportes) ÷ FTE del mes.' },
    { l: 'Horas extra', v: fM(a.hhee), s: `${fP(div(a.hhee, a.sueldoBase))} del sueldo base`, s2: `${a.conHhee} personas · año ${fM(hh.ytd)}` },
  ]
  const datos = filas.filter(x => !x.enCurso && x.cp != null).map(x => ({ label: mesSolo(x.p), cp: x.cp, pct: x.pct, mm3: x.pctMm3 }))
  const tonoNivel = v => (v == null || acum.pct == null ? undefined : v - acum.pct > 0.01 ? C.rojo : acum.pct - v > 0.01 ? C.verde : undefined)
  const cols = [
    { k: 'p', l: 'Mes', sticky: true, f: (v, x) => (x._total ? 'Año' : `${mesCorto(v)}${x.enCurso ? ' · en curso' : ''}`), ord: x => x.p },
    { k: 'venta', l: 'Venta neta', num: true, f: fM },
    { k: 'mb', l: 'Margen bruto', num: true, f: fM },
    { k: 'cp', l: m.fuenteCosto === 'nomina' ? 'Costo nómina' : m.filtrado ? 'Costo personal (prorr.)' : 'Costo personal', num: true, f: fM, negrita: true },
    { k: 'pct', l: '% venta', num: true, pct: true, f: v => fP(v), tono: (v, x) => (x._total ? undefined : tonoNivel(v)) },
    { k: 'roi', l: 'ROI', num: true, pct: true, f: v => fP(v, 0) },
    { k: 'dot', l: 'Dotación', num: true, f: (v, x) => (x._total ? `${fN(v, 1)} prom.` : fN(v)) },
    { k: 'fte', l: 'FTE', num: true, f: (v, x) => (x._total ? `${fN(v, 1)} prom.` : fN(v, 1)) },
    { k: 'costoFte', l: 'Nómina por FTE', num: true, f: fmt },
    { k: 'ventaFte', l: 'Venta por FTE', num: true, f: fM },
    { k: 'hhee', l: 'Horas extra', num: true, f: fM },
    { k: 'hheePctSB', l: 'HE / sueldo base', num: true, pct: true, f: v => fP(v) },
    { k: 'contrib', l: m.filtrado ? 'Contribución' : 'Contribución centros', num: true, f: fM, tono: v => (v < 0 ? C.rojo : undefined) },
    ...(m.filtrado ? [] : [{ k: 'ebitda', l: 'EBITDA', num: true, f: fM, tono: v => (v < 0 ? C.rojo : undefined) }]),
  ]
  const total = { _total: true, p: 'Año', venta: acum.venta, mb: acum.mb, cp: acum.cp, pct: acum.pct, roi: acum.roi, dot: acum.dotPromedio, fte: acum.ftePromedio, costoFte: acum.costoFte, ventaFte: acum.ventaFte, hhee: acum.hhee, hheePctSB: acum.hheePctSB, contrib: acum.contrib, ebitda: acum.ebitda }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Franja items={items} />
      <Fila2 min={520}>
        <Panel titulo="Costo de personal y su peso en la venta" nota={`${m.filtrado ? `${m.filtroNombre}: resultado por centro` : 'Libro mayor'} ${anio}. Barras: costo de personal. Línea: % sobre la venta neta; punteada, promedio móvil de 3 meses.`}>
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={datos} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#EEF0F3" vertical={false} />
              <XAxis dataKey="label" {...ejeM} />
              <YAxis yAxisId="m" tickFormatter={fM} {...ejeM} width={62} />
              <YAxis yAxisId="p" orientation="right" tickFormatter={v => fP(v, 0)} {...ejeM} width={44} domain={[0, 'auto']} />
              <Tooltip content={<TT formatos={{ pct: v => fP(v), mm3: v => fP(v) }} />} />
              <Legend wrapperStyle={{ fontSize: 11.5 }} />
              <Bar yAxisId="m" dataKey="cp" name="Costo de personal" fill={C.navy} radius={[3, 3, 0, 0]} maxBarSize={40} />
              <Line yAxisId="p" type="monotone" dataKey="pct" name="% sobre venta" stroke={C.rojo} strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line yAxisId="p" type="monotone" dataKey="mm3" name="Promedio móvil 3 meses" stroke={C.rojo} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel titulo="Lectura del período" nota={pBase ? `${mesLargo(mes)} comparado con ${mesTexto(pBase)}. Primero lo que más pesa.` : `${mesLargo(mes)}. Elige con qué comparar para ver variaciones.`}>
          {hall.length ? hall.map((x, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '10px 1fr auto', gap: 10, alignItems: 'start', padding: '7px 0', borderTop: i ? `1px solid ${C.linea}` : 'none', fontSize: 12.5, lineHeight: 1.45 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: NIVEL[x.nivel], marginTop: 5 }} />
              <span>{x.texto}</span>
              {x.vista ? <button type="button" style={{ ...btn, padding: '2px 8px', fontSize: 11.5 }} onClick={() => irA(x.vista)}>Ver</button> : <span />}
            </div>
          )) : <div style={{ color: C.gris, fontSize: 12.5 }}>Sin variaciones relevantes contra el período de comparación.</div>}
        </Panel>
      </Fila2>
      <ResumenGerencias m={m} mes={mes} pBase={pBase} filtrarArea={filtrarArea} />
      <Panel titulo={`Evolución mensual ${anio}`} nota={m.filtrado ? 'Venta, margen, costo de personal y contribución: resultado por centro de Finanzas. Dotación, FTE, nómina y horas extra: liquidaciones del centro.' : 'Venta, margen, costo de personal y EBITDA: libro mayor. Contribución centros: suma del resultado por sucursal. Dotación, FTE, nómina y horas extra: liquidaciones.'} sinPad
        acciones={<BotonExcel onClick={() => exportar(`dotacion_costo_${anio}`, [{ nombre: 'Evolución', filas: filasExport(cols, filas, total) }])} />}>
        <Tabla cols={cols} filas={filas.map(x => ({ ...x, _k: x.p }))} total={total} />
      </Panel>
    </div>
  )
}

// ═══ DOTACIÓN ═══════════════════════════════════════════════════════════════
const TIPO_MOV = { contrat: 'Contratación', trasIn: 'Traslado entrante', desv: 'Desvinculación', trasOut: 'Traslado saliente', ficha: 'Salida según ficha' }
export function VistaDotacion({ m, anio, mes, pBase, abrirPersona, filtrarArea }) {
  const meses = mesesNomina(m, anio)
  const a = agg(m, mes), ab = agg(m, pBase)
  const fl = m.flujos.get(mes) || {}
  const movC = useMemo(() => movimientos(m, meses, 'centro'), [m, anio]) // eslint-disable-line react-hooks/exhaustive-deps
  const movF = useMemo(() => movimientos(m, meses, 'funcion'), [m, anio]) // eslint-disable-line react-hooks/exhaustive-deps
  // Traslados internos del mes entre centros del alcance.
  const trasMes = useMemo(() => {
    const out = []
    m.centros.forEach(c => (m.flCentro.get(c)?.get(mes)?.ingTraslado || []).forEach(cod => {
      const r = m.regPCEmpresa.get(`${mes}|${cod}`), o = m.regPCEmpresa.get(`${perAnterior(mes)}|${cod}`)
      if (r) out.push({ _k: `t${cod}`, cod, nombre: r.nombre, cargo: r.cargo, desde: o ? m.nombreCentro(o.ceco) : '—', hacia: m.nombreCentro(c), funcion: r.funcion })
    }))
    return out
  }, [m, mes])
  const cargos = useMemo(() => {
    const g = new Map()
    for (const r of m.regs) {
      if (r.tipo !== 'liq' || r.periodo !== mes) continue
      let x = g.get(r.cargo)
      if (!x) { x = { _k: r.cargo, cargo: r.cargo, personas: 0, fte: 0, costo: 0, sb: 0, hhee: 0 }; g.set(r.cargo, x) }
      x.personas += 1; x.fte += r.fte; x.costo += r.costo; x.sb += r.sueldoBase; x.hhee += r.hheeTotal
      x[`c_${r.ceco}`] = (x[`c_${r.ceco}`] || 0) + 1
    }
    return [...g.values()].map(x => ({ ...x, costoMedio: div(x.costo, x.personas), sbMedio: div(x.sb, x.personas), hheePct: div(x.hhee, x.sb) })).sort((p, q) => q.personas - p.personas || q.costo - p.costo)
  }, [m, mes])

  let salAnio = 0, desvAnio = 0, mesesSal = 0
  for (const p of meses) { const f = m.flujos.get(p); if (f && !f.salidasFicha) { salAnio += (f.salidas || []).length; desvAnio += (f.salidas || []).length - (f.salTraslado || []).length; mesesSal += 1 } }
  const dotProm = meses.length ? meses.reduce((t, p) => t + agg(m, p).dot, 0) / meses.length : 0
  const rot = mesesSal && dotProm ? (desvAnio / dotProm) * (12 / mesesSal) : null
  const fin = Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)
  const antig = m.regs.filter(r => r.tipo === 'liq' && r.periodo === mes && r.fechaIngreso).map(r => (fin - Date.parse(r.fechaIngreso)) / 2629800000).filter(Number.isFinite)
  const antigProm = antig.length ? antig.reduce((t, x) => t + x, 0) / antig.length : null
  const vs = pBase ? ` vs ${mesCorto(pBase)}` : ''
  const nIng = (fl.ingresos || []).length, nIngT = (fl.ingTraslado || []).length
  const nSal = (fl.salidas || []).length, nSalT = (fl.salTraslado || []).length
  const items = [
    { l: 'Dotación', v: fN(a.dot), s: pBase ? `${fEnt(a.dot - ab.dot)}${vs}` : '', s2: `${a.pagados} con haberes en el mes`, ayuda: 'Liquidaciones emitidas en el mes.' },
    { l: 'FTE', v: fN(a.fte, 1), s: `${fP(div(a.fte, a.dot), 0)} de jornada completa`, s2: pBase ? `${fN(ab.fte, 1)} en ${mesCorto(pBase)}` : '', ayuda: 'Días trabajados ÷ 30. Licencias, ingresos y salidas a mitad de mes bajan el FTE.' },
    { l: 'Ingresos del mes', v: fl.ingresos ? fN(nIng) : '—', s: fl.ingresos ? `${nIng - nIngT} contrataciones · ${nIngT} traslados` : 'Falta la nómina del mes anterior', s2: `Año: ${fN(movC.ing - movC.ingT)} contrataciones` },
    { l: 'Salidas del mes', v: fN(nSal), s: fl.salidasFicha ? 'Según ficha: falta la nómina siguiente' : `${nSal - nSalT} desvinculaciones · ${nSalT} traslados`, sColor: fl.salidasFicha ? C.ambar : undefined, s2: `Año: ${fN(desvAnio)} desvinculaciones` },
    m.centros.length > 1 && !m.filtrado ? { l: 'Traslados entre centros', v: fN(trasMes.length), s: 'Cambios de centro respecto del mes anterior', s2: `Año: ${fN([...movC.porGrupo.values()].reduce((t, x) => t + x.ingT, 0))}` } : null,
    { l: 'Rotación anualizada', v: fP(rot, 0), s: 'Desvinculaciones ÷ dotación promedio', s2: `${mesesSal} meses con dato`, ayuda: 'Excluye traslados. Solo meses con la nómina del mes siguiente cargada.' },
    { l: 'Antigüedad media', v: antigProm != null ? `${fN(antigProm, 1)} meses` : '—', s: `${antig.length} con fecha de ingreso` },
    a.prest.size ? { l: 'Prestadores a honorarios', v: fN(a.prest.size), s: fM(a.honorario) } : null,
  ]
  const centrosD = m.centros.filter(c => meses.some(p => aggCentro(m, p, c).dot > 0))
  const datos = meses.map(p => { const o = { label: mesSolo(p), fte: agg(m, p).fte }; centrosD.forEach(c => { o[c] = aggCentro(m, p, c).dot }); return o })
  const armar = (lista, getAgg, nombre, mov) => {
    const filas = lista.filter(k => meses.some(p => getAgg(p, k).dot > 0)).map(k => {
      const o = { _k: k, nombre: nombre(k) }
      let dotS = 0
      meses.forEach(p => { const d = getAgg(p, k).dot; o[p] = d || null; dotS += d })
      const x = getAgg(mes, k)
      const mv = mov.porGrupo.get(k) || { ing: 0, sal: 0, ingT: 0, salT: 0 }
      const dp = dotS / (meses.length || 1)
      Object.assign(o, { fte: x.fte, delta: pBase ? x.dot - getAgg(pBase, k).dot : null, costoFte: costoPorFte(x), contrat: mv.ing - mv.ingT, trasIn: mv.ingT, desv: mv.sal - mv.salT, trasOut: mv.salT, rot: dp ? ((mv.sal - mv.salT) / dp) * (12 / (meses.length || 1)) : null })
      return o
    })
    const total = { _k: 'total', nombre: 'Total' }
    meses.forEach(p => { total[p] = agg(m, p).dot })
    const sum = k => filas.reduce((t, f) => t + (f[k] || 0), 0)
    Object.assign(total, { fte: a.fte, delta: pBase ? a.dot - ab.dot : null, costoFte: costoPorFte(a), contrat: sum('contrat'), trasIn: sum('trasIn'), desv: sum('desv'), trasOut: sum('trasOut'), rot })
    return { filas, total }
  }
  const tc = armar(m.centros, (p, c) => aggCentro(m, p, c), m.nombreCentro, movC)
  const tf = armar(m.funciones, (p, f) => aggFuncion(m, p, f), f => f, movF)
  const colsGrupo = titulo => [
    { k: 'nombre', l: titulo, sticky: true },
    ...meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: v => (v ? fN(v) : '') })),
    { k: 'fte', l: `FTE ${mesSolo(mes)}`, num: true, f: v => fN(v, 1) },
    { k: 'delta', l: pBase ? `Δ vs ${mesSolo(pBase)}` : 'Δ', num: true, f: fEnt },
    { k: 'contrat', l: 'Contrataciones', num: true, f: v => fN(v) },
    { k: 'trasIn', l: 'Traslados entran', num: true, f: v => fN(v) },
    { k: 'desv', l: 'Desvinculaciones', num: true, f: v => fN(v) },
    { k: 'trasOut', l: 'Traslados salen', num: true, f: v => fN(v) },
    { k: 'rot', l: 'Rotación anual', num: true, pct: true, f: v => fP(v, 0), tono: v => (v > 0.4 ? C.rojo : undefined) },
    { k: 'costoFte', l: `Nómina por FTE ${mesSolo(mes)}`, num: true, f: fmt },
  ]
  // Centro × función del mes
  const cf = m.centros.filter(c => aggCentro(m, mes, c).dot > 0).map(c => {
    const o = { _k: c, nombre: m.nombreCentro(c), total: aggCentro(m, mes, c).dot, fte: aggCentro(m, mes, c).fte }
    m.funciones.forEach(f => { o[f] = 0 })
    m.regs.forEach(r => { if (r.tipo === 'liq' && r.periodo === mes && r.ceco === c) o[r.funcion] = (o[r.funcion] || 0) + 1 })
    return o
  })
  const cfTot = { _k: 'total', nombre: 'Total', total: a.dot, fte: a.fte }
  m.funciones.forEach(f => { cfTot[f] = aggFuncion(m, mes, f).dot })
  const colsCF = [{ k: 'nombre', l: 'Centro', sticky: true }, ...m.funciones.map(f => ({ k: f, l: f, num: true, f: v => (v ? fN(v) : '') })), { k: 'total', l: 'Total', num: true, f: v => fN(v), negrita: true }, { k: 'fte', l: 'FTE', num: true, f: v => fN(v, 1) }]
  const prevCeco = cod => m.regPCEmpresa.get(`${perAnterior(mes)}|${cod}`)?.ceco
  const nextCeco = cod => m.regPCEmpresa.get(`${perSiguiente(mes)}|${cod}`)?.ceco
  const tras = new Set(fl.ingTraslado || []), trasS = new Set(fl.salTraslado || [])
  const movs = [
    ...(fl.ingresos || []).map(c => ({ cod: c, tipo: tras.has(c) ? 'trasIn' : 'contrat', otro: tras.has(c) ? prevCeco(c) : null })),
    ...(fl.salidas || []).map(c => ({ cod: c, tipo: fl.salidasFicha ? 'ficha' : trasS.has(c) ? 'trasOut' : 'desv', otro: trasS.has(c) ? nextCeco(c) : null })),
  ].map(x => ({ ...x, r: m.regPC.get(`${mes}|${x.cod}`) })).filter(x => x.r).map(({ cod, tipo, otro, r }) => ({
    _k: `${tipo}|${cod}`, cod, mov: TIPO_MOV[tipo], detalle: otro ? (tipo === 'trasIn' ? `desde ${m.nombreCentro(otro)}` : `hacia ${m.nombreCentro(otro)}`) : '',
    nombre: r.nombre, cargo: r.cargo, centro: m.nombreCentro(r.ceco), funcion: r.funcion, dias: r.dias, haberes: r.haberes,
  }))
  const colsMov = [
    { k: 'mov', l: 'Movimiento' }, { k: 'detalle', l: 'Origen o destino' }, { k: 'nombre', l: 'Persona', max: 220 }, { k: 'cargo', l: 'Cargo', max: 200 },
    { k: 'centro', l: 'Centro' }, { k: 'funcion', l: 'Función' }, { k: 'dias', l: 'Días', num: true, f: v => fN(v) }, { k: 'haberes', l: 'Haberes', num: true, f: fmt },
  ]
  const colsTras = [{ k: 'nombre', l: 'Persona', max: 220 }, { k: 'cargo', l: 'Cargo', max: 200 }, { k: 'funcion', l: 'Función' }, { k: 'desde', l: 'Desde' }, { k: 'hacia', l: 'Hacia' }]
  const centrosCargo = m.centros.filter(c => cargos.some(x => x[`c_${c}`]))
  const colsCargo = [
    { k: 'cargo', l: 'Cargo', sticky: true, max: 240 },
    ...centrosCargo.map(c => ({ k: `c_${c}`, l: m.nombreCentro(c), num: true, f: v => (v ? fN(v) : '') })),
    { k: 'personas', l: 'Total', num: true, f: v => fN(v), negrita: true }, { k: 'fte', l: 'FTE', num: true, f: v => fN(v, 1) },
    { k: 'costoMedio', l: 'Costo medio', num: true, f: fmt }, { k: 'sbMedio', l: 'Sueldo base medio', num: true, f: fmt },
    { k: 'hheePct', l: 'HE / sueldo base', num: true, pct: true, f: v => fP(v) },
  ]
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Franja items={items} />
      <Panel titulo="Dotación por centro" nota="Barras: liquidaciones por centro de costo de la liquidación de cada mes. Línea: FTE total.">
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={datos} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#EEF0F3" vertical={false} />
            <XAxis dataKey="label" {...ejeM} />
            <YAxis {...ejeM} width={36} allowDecimals={false} />
            <Tooltip content={<TT fmtV={v => fN(v, Number.isInteger(v) ? 0 : 1)} />} />
            <Legend wrapperStyle={{ fontSize: 11.5 }} />
            {centrosD.map((c, i) => <Bar key={c} dataKey={c} name={m.nombreCentro(c)} stackId="d" fill={colorCentro(c, i)} maxBarSize={42} />)}
            <Line dataKey="fte" name="FTE" stroke={C.ambar} strokeWidth={2} dot={{ r: 2.5 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
      <Panel titulo="Por centro de costo" nota="Liquidaciones por mes. Contrataciones y desvinculaciones son entradas y salidas de la empresa; los traslados son cambios de centro entre meses." sinPad
        acciones={<BotonExcel onClick={() => exportar(`dotacion_${anio}`, [{ nombre: 'Por centro', filas: filasExport(colsGrupo('Centro'), tc.filas, tc.total) }, { nombre: 'Por función', filas: filasExport(colsGrupo('Función'), tf.filas, tf.total) }, { nombre: `Centro x función ${mes}`, filas: filasExport(colsCF, cf, cfTot) }, { nombre: `Cargos ${mes}`, filas: filasExport(colsCargo, cargos) }, { nombre: `Movimientos ${mes}`, filas: filasExport(colsMov, movs) }])} />}>
        <Tabla cols={colsGrupo('Centro')} filas={tc.filas} total={tc.total} />
      </Panel>
      <PanelPorGrupo m={m} anio={anio} mes={mes} pBase={pBase} modo="dotacion" onGrupo={filtrarArea} />
      <Fila2 min={460}>
        <Panel titulo={`Centro y función · ${mesTexto(mes)}`} nota="Personas con liquidación en el mes." sinPad>
          <Tabla cols={colsCF} filas={cf} total={cfTot} />
        </Panel>
        <Panel titulo={`Movimientos de ${mesTexto(mes)}`} nota={fl.ingresos ? `${nIng} ingresos y ${nSal} salidas en ${m.filtrado ? m.filtroNombre : 'la empresa'}. Clic en una persona para ver su ficha.` : 'Sin el mes anterior cargado no se pueden calcular ingresos.'} sinPad>
          <Tabla cols={colsMov} filas={movs} maxH={360} onFila={r => abrirPersona(r.cod)} vacio="Sin ingresos ni salidas en el mes." />
        </Panel>
      </Fila2>
      {trasMes.length > 0 && !m.filtrado && (
        <Panel titulo={`Traslados entre centros · ${mesTexto(mes)}`} nota="Personas cuya liquidación cambió de centro respecto del mes anterior. No son ingresos ni salidas de la empresa." sinPad>
          <Tabla cols={colsTras} filas={trasMes} onFila={r => abrirPersona(r.cod)} />
        </Panel>
      )}
      <Panel titulo={`Cargos por centro · ${mesTexto(mes)}`} nota="Personas por cargo y centro. Costo medio = haberes + aportes por persona." sinPad>
        <Tabla cols={colsCargo} filas={cargos} maxH={420} />
      </Panel>
    </div>
  )
}

// ═══ COSTO ══════════════════════════════════════════════════════════════════
export function VistaCosto({ m, anio, mes, pBase, filtrarArea }) {
  const meses = mesesNomina(m, anio)
  const a = agg(m, mes), ab = agg(m, pBase)
  const pz = useMemo(() => (pBase && pBase !== mes ? puenteCosto(agg(m, pBase), agg(m, mes)) : null), [m, pBase, mes])
  const tablero = useMemo(() => (pBase && pBase !== mes ? tableroCentros(m, [mes], pBase) : []), [m, mes, pBase])
  const vs = pBase ? ` vs ${mesCorto(pBase)}` : ''
  const cn = costoNomina(a), cnb = costoNomina(ab)
  const items = [
    { l: 'Costo de nómina', v: fM(cn), s: pBase ? `${fVar(variacion(cnb, cn))}${vs}` : '', sColor: tonoSube(variacion(cnb, cn)), ayuda: 'Haberes + aportes patronales estimados + honorarios.' },
    { l: 'Haberes', v: fM(a.haberes), s: `${fN(a.dot)} liquidaciones` },
    { l: 'Aportes patronales', v: fM(a.aportes), s: `${fP(div(a.aportes, a.haberes))} de los haberes`, s2: 'Estimados con tasas vigentes' },
    a.honorario || ab.honorario ? { l: 'Honorarios', v: fM(a.honorario), s: `${a.prest.size} prestadores` } : null,
    { l: 'Parte fija', v: fP(div(a.clases.fijo || 0, a.haberes)), s: fM(a.clases.fijo || 0), s2: 'Sueldo base, gratificación, colación, movilización, viáticos' },
    { l: 'Parte variable', v: fP(div(a.clases.variable || 0, a.haberes)), s: fM(a.clases.variable || 0), s2: 'Comisiones, horas extra y bonos' },
    { l: 'Nómina por FTE', v: fmt(costoPorFte(a)), s: pBase ? `${fVar(variacion(costoPorFte(ab), costoPorFte(a)))}${vs}` : '', sColor: tonoSube(variacion(costoPorFte(ab), costoPorFte(a))) },
  ]
  const datos = meses.map(p => { const x = agg(m, p); const o = { label: mesSolo(p) }; CLASES.forEach(c => { o[c.k] = x.clases[c.k] || 0 }); return o })
  const clasesP = CLASES.filter(c => datos.some(d => d[c.k]))
  const totAnio = meses.reduce((t, p) => t + costoNomina(agg(m, p)), 0)
  const p0 = meses[0], pN = meses[meses.length - 1]
  const posP = k => { const i = ORDEN_PARTIDA.indexOf(k); return i < 0 ? 99 : i }
  const keys = [...new Set(meses.flatMap(p => Object.keys(agg(m, p).partidas)))].sort((x, y) => posP(x) - posP(y))
  const filasP = keys.map(k => {
    const o = { _k: k, nombre: partidaL(k) }
    let t = 0
    meses.forEach(p => { const v = agg(m, p).partidas[k] || 0; o[p] = v || null; t += v })
    o.total = t; o.share = div(t, totAnio); o.varAnio = variacion(o[p0] || 0, o[pN] || 0); o.porFte = k === 'honorario' ? null : div(a.partidas[k] || 0, a.fte)
    return o
  }).sort((x, y) => y.total - x.total)
  const totalP = { _k: 'total', nombre: 'Total nómina' }
  meses.forEach(p => { totalP[p] = costoNomina(agg(m, p)) })
  Object.assign(totalP, { total: totAnio, share: 1, varAnio: variacion(totalP[p0], totalP[pN]), porFte: costoPorFte(a) })
  const colMeses = meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: v => (v ? fM(v) : '') }))
  const colVar = { k: 'varAnio', l: `${mesSolo(p0)}→${mesSolo(pN)}`, num: true, pct: true, f: v => fVar(v), tono: tonoSube }
  const colsP = [{ k: 'nombre', l: 'Partida', sticky: true }, ...colMeses, { k: 'total', l: 'Año', num: true, f: fM, negrita: true }, { k: 'share', l: '% año', num: true, pct: true, f: v => fP(v) }, colVar, { k: 'porFte', l: `Por FTE ${mesSolo(mes)}`, num: true, f: fmt }]
  // Partida × centro del mes
  const centrosMes = m.centros.filter(c => costoNomina(aggCentro(m, mes, c)) > 0)
  const filasPC = keys.map(k => {
    const o = { _k: k, nombre: partidaL(k), total: a.partidas[k] || 0 }
    centrosMes.forEach(c => { o[c] = aggCentro(m, mes, c).partidas[k] || null })
    return o
  }).filter(o => o.total).sort((x, y) => y.total - x.total)
  const totalPC = { _k: 'total', nombre: 'Total nómina', total: cn }
  centrosMes.forEach(c => { totalPC[c] = costoNomina(aggCentro(m, mes, c)) })
  const fteFila = { _k: 'fte', nombre: 'Nómina por FTE', total: costoPorFte(a), _fte: true }
  centrosMes.forEach(c => { fteFila[c] = costoPorFte(aggCentro(m, mes, c)) })
  const colsPC = [{ k: 'nombre', l: 'Partida', sticky: true }, ...centrosMes.map(c => ({ k: c, l: m.nombreCentro(c), num: true, f: (v, r) => (r._fte ? fmt(v) : v ? fM(v) : '') })), { k: 'total', l: 'Total', num: true, f: (v, r) => (r._fte ? fmt(v) : fM(v)), negrita: true }]
  const filasC = m.centros.filter(c => meses.some(p => costoNomina(aggCentro(m, p, c)) > 0)).map(c => {
    const o = { _k: c, nombre: m.nombreCentro(c) }
    let t = 0
    meses.forEach(p => { const v = costoNomina(aggCentro(m, p, c)); o[p] = v || null; t += v })
    o.total = t; o.share = div(t, totAnio); o.varAnio = variacion(o[p0] || 0, o[pN] || 0); o.costoFte = costoPorFte(aggCentro(m, mes, c))
    return o
  }).sort((x, y) => y.total - x.total)
  const totalC = { ...totalP, nombre: 'Total', costoFte: costoPorFte(a) }
  const colsC = [{ k: 'nombre', l: 'Centro', sticky: true }, ...colMeses, { k: 'total', l: 'Año', num: true, f: fM, negrita: true }, { k: 'share', l: '% año', num: true, pct: true, f: v => fP(v) }, colVar, { k: 'costoFte', l: `Nómina por FTE ${mesSolo(mes)}`, num: true, f: fmt }]
  const filasPz = tablero.map(f => ({ ...f, base: costoNomina(aggCentro(m, pBase, f.c)) }))
  const sumPz = k => filasPz.reduce((t, f) => t + (f[k] || 0), 0)
  const totalPz = { _k: 'total', nombre: 'Total', base: sumPz('base'), efDot: sumPz('efDot'), efCosto: sumPz('efCosto'), efHon: sumPz('efHon'), costo: sumPz('costo') }
  totalPz.dCosto = variacion(totalPz.base, totalPz.costo)
  const colsPz = [
    { k: 'nombre', l: 'Centro', sticky: true }, { k: 'base', l: `Nómina ${mesSolo(pBase)}`, num: true, f: fM },
    { k: 'efDot', l: 'Efecto dotación', num: true, f: v => fDelta(v), tono: tonoSube }, { k: 'efCosto', l: 'Efecto costo por FTE', num: true, f: v => fDelta(v), tono: tonoSube },
    { k: 'efHon', l: 'Honorarios', num: true, f: v => (v ? fDelta(v) : '') }, { k: 'costo', l: `Nómina ${mesSolo(mes)}`, num: true, f: fM, negrita: true },
    { k: 'dCosto', l: 'Variación', num: true, pct: true, f: v => fVar(v), tono: tonoSube }, { k: 'dFte', l: 'Δ FTE', num: true, pct: true, f: v => fVar(v) },
  ]
  const conc = m.conSocios && !m.filtrado ? meses.map(p => {
    const x = agg(m, p), e = m.eerr.get(p), lb = m.libro.get(p)
    const ap = lb ? lb.aportes : x.aportes
    const nom = x.haberes + ap + x.honorario
    return { _k: p, p, haberes: x.haberes, aportes: ap, fuente: lb ? 'Libro Contaline' : 'Estimado', honorario: x.honorario, nomina: nom, libro: e ? e.cp : null, dif: e ? e.cp - nom : null, enCurso: !!e?.enCurso }
  }) : []
  const colsConc = [
    { k: 'p', l: 'Mes', f: (v, x) => `${mesCorto(v)}${x.enCurso ? ' · en curso' : ''}` }, { k: 'haberes', l: 'Haberes', num: true, f: fM },
    { k: 'aportes', l: 'Aportes', num: true, f: fM }, { k: 'fuente', l: 'Fuente aportes' }, { k: 'honorario', l: 'Honorarios', num: true, f: fM },
    { k: 'nomina', l: 'Total nómina', num: true, f: fM, negrita: true }, { k: 'libro', l: 'Libro mayor', num: true, f: fM, negrita: true },
    { k: 'dif', l: 'Diferencia', num: true, f: v => fDelta(v), tono: v => (v != null && Math.abs(v) > 500000 ? C.ambar : undefined) },
  ]
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Franja items={items} />
      {pz && (
        <Fila2 min={480}>
          <Panel titulo="Qué explica la variación del costo de nómina" nota={`${mesLargo(pBase)} → ${mesTexto(mes)}. Efecto dotación: cambio de FTE al costo por FTE inicial. Efecto costo por FTE: cambio del costo medio sobre la dotación final.`}>
            <Cascada pasos={[
              { l: `Costo ${mesCorto(pBase)}`, v: pz.ini, tipo: 'total' },
              { l: 'Efecto dotación', s: `${fN(pz.NA, 1)} → ${fN(pz.NB, 1)} FTE a ${fmt(pz.cA)} por FTE`, v: pz.efDot },
              { l: 'Efecto costo por FTE', s: `${fmt(pz.cA)} → ${fmt(pz.cB)} por FTE`, v: pz.efCosto },
              ...(pz.efHon ? [{ l: 'Honorarios', v: pz.efHon }] : []),
              ...(Math.abs(pz.residuo) > 1 ? [{ l: 'Otros', v: pz.residuo }] : []),
              { l: `Costo ${mesCorto(mes)}`, v: pz.fin, tipo: 'total' },
            ]} />
          </Panel>
          <Panel titulo="Detalle del efecto costo por FTE" nota="Por partida: cambio del monto por FTE multiplicado por el FTE final." sinPad>
            <Tabla cols={[
              { k: 'l', l: 'Partida' },
              { k: 'porFteA', l: `Por FTE ${mesSolo(pBase)}`, num: true, f: fmt },
              { k: 'porFteB', l: `Por FTE ${mesSolo(mes)}`, num: true, f: fmt },
              { k: 'ef', l: 'Efecto', num: true, f: v => fDelta(v), tono: tonoSube, ord: x => Math.abs(x.ef) },
            ]} filas={pz.detalle.map(d => ({ ...d, _k: d.k }))} total={{ l: 'Efecto costo por FTE', ef: pz.efCosto }} />
          </Panel>
        </Fila2>
      )}
      {filasPz.length > 1 && (
        <Panel titulo={`Puente por centro · ${mesCorto(pBase)} → ${mesCorto(mes)}`} nota="Cada centro con su propio costo por FTE. La suma cierra con la variación total; el reparto entre efectos difiere del puente de arriba por la mezcla entre centros." sinPad>
          <Tabla cols={colsPz} filas={filasPz} total={totalPz} />
        </Panel>
      )}
      <Panel titulo={`Composición del costo de nómina ${anio}`} nota="Fijo, variable, otros haberes, aportes patronales estimados y honorarios.">
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={datos} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#EEF0F3" vertical={false} />
            <XAxis dataKey="label" {...ejeM} />
            <YAxis tickFormatter={fM} {...ejeM} width={62} />
            <Tooltip content={<TT />} />
            <Legend wrapperStyle={{ fontSize: 11.5 }} />
            {clasesP.map(c => <Bar key={c.k} dataKey={c.k} name={c.l} stackId="c" fill={c.c} maxBarSize={42} />)}
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
      <Panel titulo="Por partida" nota="Nómina del año por mes. La variación compara el primer y el último mes del año." sinPad
        acciones={<BotonExcel onClick={() => exportar(`costo_nomina_${anio}`, [{ nombre: 'Por partida', filas: filasExport(colsP, filasP, totalP) }, { nombre: `Partida x centro ${mes}`, filas: filasExport(colsPC, filasPC, totalPC) }, { nombre: 'Por centro', filas: filasExport(colsC, filasC, totalC) }, ...(filasPz.length ? [{ nombre: 'Puente por centro', filas: filasExport(colsPz, filasPz, totalPz) }] : []), ...(conc.length ? [{ nombre: 'Conciliación libro', filas: filasExport(colsConc, conc) }] : [])])} />}>
        <Tabla cols={colsP} filas={filasP} total={totalP} />
      </Panel>
      {centrosMes.length > 1 && (
        <Panel titulo={`Partida por centro · ${mesTexto(mes)}`} nota="Cruce de la nómina del mes. La última fila compara el costo por FTE de cada centro." sinPad>
          <Tabla cols={colsPC} filas={[...filasPC, fteFila]} total={totalPC} />
        </Panel>
      )}
      <Panel titulo="Por centro de costo" nota="Centro de la liquidación de cada mes, igual que el resultado por sucursal de Finanzas." sinPad>
        <Tabla cols={colsC} filas={filasC} total={totalC} />
      </Panel>
      <PanelPorGrupo m={m} anio={anio} mes={mes} pBase={pBase} modo="costo" onGrupo={filtrarArea} />
      {!m.porArea && <CruceEerr m={m} anio={anio} mes={mes} />}
      {conc.length > 0 ? (
        <Panel titulo="Conciliación de la nómina con el libro mayor" nota="Aportes: pago real del libro Contaline cuando está cargado. La diferencia corresponde a remuneración de socios registrada directo en el libro mayor y a ajustes contables: revisa los meses marcados." sinPad>
          <Tabla cols={colsConc} filas={conc} />
        </Panel>
      ) : m.verSocios && !m.filtrado ? (
        <div style={{ fontSize: 12, color: C.gris }}>Activa “Incluir socios” para ver la conciliación de la nómina con el libro mayor.</div>
      ) : null}
    </div>
  )
}

// ═══ HORAS EXTRA ════════════════════════════════════════════════════════════
export function VistaHhee({ m, anio, mes, pBase, abrirPersona, filtrarArea }) {
  const h = useMemo(() => analisisHhee(m, anio), [m, anio])
  const w = useMemo(() => analisisWorkera(m, anio), [m, anio])
  const wc = useMemo(() => workeraCentroMes(m, anio), [m, anio])
  const a = agg(m, mes)
  const s = h.serie.find(x => x.p === mes) || {}
  const meses = h.meses
  const tiposP = TIPOS_HHEE.filter(t => h.serie.some(x => x.porTipo[t.k]))
  const sumSB = h.serie.reduce((t, x) => t + x.sb, 0)
  const sumFte = h.serie.reduce((t, x) => t + x.fte, 0)
  const conV = h.serie.filter(x => x.venta != null)
  const items = [
    { l: `Horas extra ${anio}`, v: fM(h.ytd), s: `${meses.length} meses · promedio ${fM(h.prom)}`, ayuda: 'Monto pagado en liquidación: todas las glosas de horas extra.' },
    { l: 'Tendencia', v: h.tend ? fVar(h.tend.var) : '—', color: h.tend ? tonoSube(h.tend.var) : C.navy, s: h.tend ? 'Últimos 3 meses vs primeros 3' : 'Se necesitan 6 meses', s2: h.tend ? `Por FTE: ${fVar(h.tend.varFte)}` : '' },
    { l: mesLargo(mes), v: fM(a.hhee), s: `${fP(s.pctSB)} del sueldo base`, s2: s.pctVenta != null ? `${fP(s.pctVenta, 2)} de la venta` : '' },
    { l: 'Personas con horas extra', v: fN(a.conHhee), s: `${fP(div(a.conHhee, a.dot), 0)} de la dotación` },
    { l: 'Por FTE', v: fmt(s.porFte), s: h.serie[0] ? `${mesSolo(meses[0])}: ${fmt(h.serie[0].porFte)}` : '' },
    { l: `Proyección ${anio}`, v: fM(h.proyeccion), s: h.ultimoMes < 12 ? 'Al ritmo de los últimos 3 meses' : 'Año completo' },
    { l: 'Concentración', v: fP(h.top10Share, 0), s: 'Pagado a las 10 personas con más horas' },
    { l: 'Carga recurrente', v: fN(h.recurrentes), s: 'Personas con horas extra en 3 de cada 4 meses' },
  ]
  const datos = h.serie.map(x => ({ label: mesSolo(x.p), ...Object.fromEntries(tiposP.map(t => [t.k, x.porTipo[t.k] || 0])), pctSB: x.pctSB }))
  const filasM = h.serie.map(x => ({ _k: x.p, p: x.p, total: x.total, ...Object.fromEntries(tiposP.map(t => [t.k, x.porTipo[t.k] || 0])), mm3: x.mm3, pctSB: x.pctSB, pctVenta: x.pctVenta, personas: x.personas, pctDot: x.pctDot, porFte: x.porFte }))
  const totalM = { _k: 'total', p: 'Año', total: h.ytd, pctSB: div(h.ytd, sumSB), pctVenta: div(conV.reduce((t, x) => t + x.total, 0), conV.reduce((t, x) => t + x.venta, 0)), porFte: div(h.ytd, sumFte) }
  tiposP.forEach(t => { totalM[t.k] = h.serie.reduce((q, x) => q + (x.porTipo[t.k] || 0), 0) })
  const colsM = [
    { k: 'p', l: 'Mes', sticky: true, f: v => (v === 'Año' ? 'Año' : mesCorto(v)) },
    { k: 'total', l: 'Total', num: true, f: fM, negrita: true },
    ...tiposP.map(t => ({ k: t.k, l: t.l, num: true, f: v => (v ? fM(v) : '') })),
    { k: 'mm3', l: 'Prom. móvil 3m', num: true, f: fM },
    { k: 'pctSB', l: '% sueldo base', num: true, pct: true, f: v => fP(v) },
    { k: 'pctVenta', l: '% venta', num: true, pct: true, f: v => fP(v, 2) },
    { k: 'personas', l: 'Personas', num: true, f: v => fN(v) },
    { k: 'pctDot', l: '% dotación', num: true, pct: true, f: v => fP(v, 0) },
    { k: 'porFte', l: 'Por FTE', num: true, f: fmt },
  ]
  const filasC = m.centros.filter(c => meses.some(p => aggCentro(m, p, c).hhee)).map(c => {
    const o = { _k: c, nombre: m.nombreCentro(c) }
    let t = 0, fte = 0, sb = 0
    meses.forEach(p => { const x = aggCentro(m, p, c); o[p] = x.hhee || null; t += x.hhee; fte += x.fte; sb += x.sueldoBase })
    o.total = t; o.share = div(t, h.ytd); o.porFte = div(t, fte); o.pctSB = div(t, sb)
    return o
  }).sort((x, y) => y.total - x.total)
  const totalC = { _k: 'total', nombre: 'Total', total: h.ytd, share: 1, porFte: div(h.ytd, sumFte), pctSB: div(h.ytd, sumSB) }
  meses.forEach(p => { totalC[p] = agg(m, p).hhee })
  const colsC = [
    { k: 'nombre', l: 'Centro', sticky: true }, ...meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: v => (v ? fM(v) : '') })),
    { k: 'total', l: 'Año', num: true, f: fM, negrita: true }, { k: 'share', l: '% del total', num: true, pct: true, f: v => fP(v) },
    { k: 'porFte', l: 'Por FTE al mes', num: true, f: fmt }, { k: 'pctSB', l: '% sueldo base', num: true, pct: true, f: v => fP(v) },
  ]
  // Tipo × centro del año
  const filasTC = tiposP.map(t => {
    const o = { _k: t.k, nombre: t.l, total: 0 }
    m.centros.forEach(c => { const v = meses.reduce((q, p) => q + (aggCentro(m, p, c).hheeTipo[t.k] || 0), 0); o[c] = v || null; o.total += v })
    o.share = div(o.total, h.ytd)
    return o
  })
  const centrosHE = m.centros.filter(c => filasTC.some(f => f[c]))
  const totalTC = { _k: 'total', nombre: 'Total', total: h.ytd, share: 1 }
  centrosHE.forEach(c => { totalTC[c] = meses.reduce((q, p) => q + aggCentro(m, p, c).hhee, 0) })
  const colsTC = [{ k: 'nombre', l: 'Tipo', sticky: true }, ...centrosHE.map(c => ({ k: c, l: m.nombreCentro(c), num: true, f: v => (v ? fM(v) : '') })), { k: 'total', l: 'Total', num: true, f: fM, negrita: true }, { k: 'share', l: '% del total', num: true, pct: true, f: v => fP(v) }]
  const colsPer = [
    { k: 'nombre', l: 'Persona', sticky: true, max: 210 }, { k: 'cargo', l: 'Cargo', max: 180 }, { k: 'centro', l: 'Centro' },
    ...meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: v => (v ? fM(v) : ''), fondo: v => (v > 0 ? `rgba(178,94,9,${Math.min(0.06 + v / 900000, 0.32).toFixed(3)})` : undefined) })),
    { k: 'hhee', l: 'Año', num: true, f: fmt, negrita: true }, { k: 'pctSB', l: '% sueldo base', num: true, pct: true, f: v => fP(v) },
    { k: 'mesesHhee', l: 'Meses con HE', num: true, f: (v, x) => `${v} de ${x.meses}` },
    { k: 'recurrente', l: 'Recurrente', f: v => (v ? 'Sí' : ''), tono: v => (v ? C.ambar : undefined), x: v => (v ? 'Sí' : '') },
  ]
  const colsW = [
    { k: 'p', l: 'Mes', f: v => mesCorto(v) }, { k: 'horas', l: 'Horas registradas', num: true, f: v => fN(v, 1), negrita: true },
    { k: 'aut', l: 'Autorizadas', num: true, f: v => fN(v, 1), tono: () => C.verde }, { k: 'rech', l: 'Rechazadas', num: true, f: v => fN(v, 1) },
    { k: 'pend', l: 'Pendientes', num: true, f: v => fN(v, 1), tono: v => (v > 0 ? C.ambar : undefined) },
    { k: 'personas', l: 'Personas', num: true, f: v => fN(v) }, { k: 'horasPersona', l: 'Horas por persona', num: true, f: v => fN(v, 1) },
    { k: 'sobreTope', l: 'Días con más de 2 h', num: true, f: v => fN(v), tono: v => (v > 0 ? C.rojo : undefined) },
  ]
  const colsWC = [{ k: 'nombre', l: 'Centro', sticky: true }, ...wc.meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: v => (v ? fN(v, 0) : '') })), { k: 'total', l: 'Horas año', num: true, f: v => fN(v, 0), negrita: true }, { k: 'aut', l: 'Autorizadas', num: true, f: v => fN(v, 0) }, { k: 'tope', l: 'Días con más de 2 h', num: true, f: v => fN(v), tono: v => (v > 0 ? C.rojo : undefined) }]
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Franja items={items} />
      <Panel titulo={`Horas extra pagadas ${anio}`} nota="Barras: monto por tipo de glosa. Línea: % del sueldo base pagado en el mes.">
        <ResponsiveContainer width="100%" height={270}>
          <ComposedChart data={datos} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#EEF0F3" vertical={false} />
            <XAxis dataKey="label" {...ejeM} />
            <YAxis yAxisId="m" tickFormatter={fM} {...ejeM} width={62} />
            <YAxis yAxisId="p" orientation="right" tickFormatter={v => fP(v, 0)} {...ejeM} width={44} domain={[0, 'auto']} />
            <Tooltip content={<TT formatos={{ pctSB: v => fP(v) }} />} />
            <Legend wrapperStyle={{ fontSize: 11.5 }} />
            {tiposP.map(t => <Bar key={t.k} yAxisId="m" dataKey={t.k} name={t.l} stackId="h" fill={t.c} maxBarSize={42} />)}
            <Line yAxisId="p" type="monotone" dataKey="pctSB" name="% del sueldo base" stroke={C.rojo} strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
      <Panel titulo="Mes a mes" nota="Montos de liquidación. Las horas se pagan con corte del 26 al 25; las rezagadas corresponden a horas del período anterior." sinPad
        acciones={<BotonExcel onClick={() => exportar(`horas_extra_${anio}`, [{ nombre: 'Mes a mes', filas: filasExport(colsM, filasM, totalM) }, { nombre: 'Por centro', filas: filasExport(colsC, filasC, totalC) }, { nombre: 'Tipo x centro', filas: filasExport(colsTC, filasTC, totalTC) }, { nombre: 'Personas x mes', filas: filasExport(colsPer, h.personas) }, ...(w.length ? [{ nombre: 'Workera', filas: filasExport(colsW, w) }, { nombre: 'Workera x centro', filas: filasExport(colsWC, wc.filas) }] : [])])} />}>
        <Tabla cols={colsM} filas={filasM} total={totalM} />
      </Panel>
      <Fila2 min={520}>
        <Panel titulo="Por centro de costo" nota="Centro de la liquidación. Por FTE al mes = horas extra del año ÷ FTE-mes del centro." sinPad>
          <Tabla cols={colsC} filas={filasC} total={totalC} />
        </Panel>
        <Panel titulo={`Tipo de hora extra por centro · ${anio}`} nota="Dónde se concentran las horas especiales, feriados y rezagadas." sinPad>
          <Tabla cols={colsTC} filas={filasTC} total={totalTC} />
        </Panel>
      </Fila2>
      <PanelPorGrupo m={m} anio={anio} mes={mes} pBase={pBase} modo="hhee" onGrupo={filtrarArea} />
      <Panel titulo={`Personas por mes · ${anio}`} nota={`${h.personas.length} personas con horas extra. Más intenso el color, mayor el monto del mes. Recurrente: horas extra en al menos 3 de cada 4 meses con liquidación. Clic para ver la ficha.`} sinPad>
        <Tabla cols={colsPer} filas={h.personas} maxH={460} onFila={r => abrirPersona(r.cod)} />
      </Panel>
      {m.calidad.workeraPendiente && <div style={{ fontSize: 12, color: C.gris }}>Cargando horas registradas en Workera…</div>}
      {w.length > 0 && (
        <Fila2 min={520}>
          <Panel titulo="Horas sobre la jornada registradas en Workera" nota="Por mes calendario, con la decisión de jefatura registrada en el ERP. No cuadra mes a mes con la liquidación por el corte del 26 al 25." sinPad>
            <Tabla cols={colsW} filas={w} />
          </Panel>
          <Panel titulo="Workera por centro y mes" nota="Horas registradas, asignadas al centro de la liquidación de cada persona en el mes." sinPad>
            <Tabla cols={colsWC} filas={wc.filas} vacio="Sin registros de Workera." />
          </Panel>
        </Fila2>
      )}
    </div>
  )
}

// ═══ PRODUCTIVIDAD Y ROI ════════════════════════════════════════════════════
export function VistaRoi({ m, anio, mes, pBase, filtrarCentro }) {
  const filas = useMemo(() => filasMensuales(m, anio), [m, anio])
  const acum = useMemo(() => acumulado(filas), [filas])
  const [alcance, setAlcance] = useState('mes')
  const [ref, setRef] = useState(() => lsGet('rrhh_ref_pct', ''))
  useEffect(() => { lsSet('rrhh_ref_pct', ref) }, [ref])
  const refN = (() => { const v = parseFloat(String(ref).replace(',', '.')); return Number.isFinite(v) && v > 0 ? v / 100 : null })()
  const cerrados = useMemo(() => mesesNomina(m, anio).filter(p => m.eerr.get(p) && !m.eerr.get(p).enCurso), [m, anio])
  const periodosC = alcance === 'mes' ? [mes] : cerrados
  const clave = periodosC.join(',')
  const tablero = useMemo(() => tableroCentros(m, periodosC, alcance === 'mes' ? pBase : null), [m, clave, pBase]) // eslint-disable-line react-hooks/exhaustive-deps
  const mVF = useMemo(() => matrizIndicador(m, anio, 'centro', 'ventaFte'), [m, anio])
  const r = filas.find(x => x.p === mes) || {}
  const inc = pBase ? retornoIncremental(m, pBase, mes) : null
  const exceso = refN && r.cp != null ? r.cp - refN * r.venta : null
  const items = [
    { l: 'Costo de personal sobre venta', v: fP(r.pct), s: `Año: ${fP(acum.pct)}` },
    { l: 'Venta por $1 de personal', v: pesos(r.veces), s: `Año: ${pesos(acum.veces)}` },
    { l: 'Margen bruto por $1 de personal', v: pesos(r.gmrol), s: `Año: ${pesos(acum.gmrol)}`, color: r.gmrol != null && r.gmrol < 1 ? C.rojo : C.navy, ayuda: 'Margen bruto ÷ costo de personal. Bajo $1, el personal cuesta más que el margen que se genera.' },
    { l: 'ROI de personal', v: fP(r.roi, 0), s: `Año: ${fP(acum.roi, 0)}`, ayuda: '(Margen bruto − costo de personal) ÷ costo de personal.' },
    { l: 'Venta mensual por FTE', v: fM(r.ventaFte), s: `Año: ${fM(acum.ventaFte)}` },
    inc ? { l: 'Retorno incremental', v: inc.retorno != null ? pesos(inc.retorno) : '—', s: `Por $1 adicional desde ${mesCorto(pBase)}`, color: inc.dCp > 0 && inc.retorno != null && inc.retorno < 1 ? C.rojo : C.navy, ayuda: 'Cambio del margen bruto ÷ cambio del costo de personal entre los dos meses.' } : null,
    refN ? { l: `Exceso sobre ${fP(refN)} de la venta`, v: fM(exceso), color: exceso > 0 ? C.rojo : C.verde, s: `Año: ${fM(acum.cp - refN * acum.venta)}` } : null,
  ]
  const datos = filas.filter(x => !x.enCurso && x.cp != null).map(x => ({ label: mesSolo(x.p), mb: x.mb, cp: x.cp, roi: x.roi }))
  const tiendas = tablero.filter(f => !f.apoyo), apoyo = tablero.filter(f => f.apoyo)
  const filasT = [...tiendas.sort((x, y) => y.venta - x.venta), ...apoyo.sort((x, y) => y.rem - x.rem)]
  const sum = k => tablero.reduce((t, f) => t + (f[k] || 0), 0)
  const sV = sum('venta'), sM = tablero.some(f => f.mb == null) ? null : sum('mb'), sR = sum('rem'), sC = tablero.some(f => f.contrib == null) ? null : sum('contrib'), sF = sum('fte')
  const totalT = { _k: 'total', nombre: m.filtrado ? `Total ${m.filtroNombre.toLowerCase()}` : 'Total centros', venta: sV, mb: sM, rem: sR, pctVenta: div(sR, sV), gmrol: div(sM, sR), roi: sM == null ? null : div(sM - sR, sR), gastos: sum('gastos'), contrib: sC, contribPct: div(sC, sV), fte: sF, ventaFte: div(sV, sF * periodosC.length), costoFte: div(sum('costo'), sF * periodosC.length), hhee: sum('hhee') }
  const colsT = [
    { k: 'nombre', l: 'Centro', sticky: true }, { k: 'tipo', l: 'Tipo' },
    { k: 'venta', l: 'Venta neta', num: true, f: fM }, { k: 'mb', l: 'Margen bruto', num: true, f: fM },
    { k: 'rem', l: 'Costo personal', num: true, f: fM, negrita: true }, { k: 'pctVenta', l: '% venta', num: true, pct: true, f: v => fP(v) },
    ...(pBase && alcance === 'mes' ? [{ k: 'dPct', l: `Δ vs ${mesSolo(pBase)}`, num: true, f: v => fPts(v), tono: tonoSube }] : []),
    { k: 'gmrol', l: 'Margen por $1', num: true, f: pesos, tono: v => (v != null && v < 1 ? C.rojo : undefined) },
    { k: 'roi', l: 'ROI', num: true, pct: true, f: v => fP(v, 0) },
    { k: 'gastos', l: 'Gastos directos', num: true, f: fM }, { k: 'contrib', l: 'Contribución', num: true, f: fM, tono: v => (v < 0 ? C.rojo : undefined) },
    { k: 'contribPct', l: 'Contrib. / venta', num: true, pct: true, f: v => fP(v) },
    { k: 'fte', l: 'FTE', num: true, f: v => fN(v, 1) }, { k: 'ventaFte', l: 'Venta por FTE', num: true, f: fM }, { k: 'costoFte', l: 'Nómina por FTE', num: true, f: fmt },
    { k: 'hhee', l: 'Horas extra', num: true, f: fM },
  ]
  const tiendasIds = m.centros.filter(c => !esApoyo(c) && cerrados.some(p => (m.suc.get(p)?.get(c)?.rem || 0) > 0))
  const filasH = tiendasIds.map(c => {
    const o = { _k: c, nombre: m.nombreCentro(c) }
    let first = null, sv = 0, sr = 0
    cerrados.forEach(p => { const s = m.suc.get(p)?.get(c); const v = s && s.ingresos > 0 && s.rem > 0 ? s.rem / s.ingresos : null; o[p] = v; if (first == null && v != null) first = v; if (s && s.ingresos > 0) { sv += s.ingresos; sr += s.rem } })
    o._first = first; o.anio = div(sr, sv)
    return o
  })
  const totalH = { _k: 'total', nombre: m.filtrado ? 'Total del filtro' : 'Empresa (incluye apoyo)', anio: acum.pct }
  cerrados.forEach(p => { totalH[p] = filas.find(x => x.p === p)?.pct ?? null })
  const fondoH = (v, row) => (v == null || row._first == null ? undefined : v - row._first >= 0.03 ? 'rgba(180,35,24,.16)' : v - row._first >= 0.015 ? 'rgba(180,35,24,.08)' : row._first - v >= 0.015 ? 'rgba(30,122,68,.10)' : undefined)
  const colsH = [{ k: 'nombre', l: 'Tienda', sticky: true }, ...cerrados.map(p => ({ k: p, l: mesSolo(p), num: true, pct: true, f: v => fP(v), fondo: fondoH })), { k: 'anio', l: 'Año', num: true, pct: true, f: v => fP(v), negrita: true }]
  const filasVF = mVF.filas.filter(f => !esApoyo(f.k) && f.serie.some(v => v != null))
  const colsVF = [{ k: 'nombre', l: 'Tienda', sticky: true }, ...mVF.meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: fM, fondo: (v, row) => colorCalor(v, row.prom, -1) })), { k: 'anio', l: 'Año', num: true, f: fM, negrita: true }]
  // Cuadrante: variación de venta contra variación de costo de personal por tienda.
  const cuad = pBase && alcance === 'mes' ? tiendas.filter(f => f.dVenta != null && f.dRem != null).map((f, i) => ({ nombre: f.nombre, x: f.dVenta, y: f.dRem, z: Math.max(f.fte, 1), c: colorCentro(f.c, i) })) : []
  const lim = Math.max(0.1, ...cuad.flatMap(p => [Math.abs(p.x), Math.abs(p.y)])) * 1.15
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Franja items={items} />
      <Fila2 min={520}>
        <Panel titulo="Margen bruto contra costo de personal" nota={`${m.filtrado ? m.filtroNombre : 'Libro mayor'}. Línea: ROI de personal del mes.`}
          acciones={<label style={{ fontSize: 12, color: C.gris, display: 'inline-flex', alignItems: 'center', gap: 6 }}>Referencia
            <input value={ref} onChange={e => setRef(e.target.value)} placeholder="ej. 12" inputMode="decimal" aria-label="Referencia de costo de personal sobre venta, en porcentaje" style={{ ...sel, width: 58 }} />% de la venta</label>}>
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={datos} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#EEF0F3" vertical={false} />
              <XAxis dataKey="label" {...ejeM} />
              <YAxis yAxisId="m" tickFormatter={fM} {...ejeM} width={62} />
              <YAxis yAxisId="p" orientation="right" tickFormatter={v => fP(v, 0)} {...ejeM} width={48} />
              <Tooltip content={<TT formatos={{ roi: v => fP(v, 0) }} />} />
              <Legend wrapperStyle={{ fontSize: 11.5 }} />
              <Bar yAxisId="m" dataKey="mb" name="Margen bruto" fill={C.azul} radius={[3, 3, 0, 0]} maxBarSize={26} />
              <Bar yAxisId="m" dataKey="cp" name="Costo de personal" fill={C.navy} radius={[3, 3, 0, 0]} maxBarSize={26} />
              <Line yAxisId="p" type="monotone" dataKey="roi" name="ROI de personal" stroke={C.ambar} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel titulo="Retorno incremental del personal" nota="Compara dos meses: cuánto margen bruto adicional trajo cada peso adicional de costo de personal.">
          {inc ? (
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              <div>Entre {mesTexto(pBase)} y {mesTexto(mes)}: venta {fDelta(inc.dVenta)}, margen bruto {fDelta(inc.dMb)} y costo de personal {fDelta(inc.dCp)} al mes.</div>
              <div style={{ margin: '12px 0 6px', fontSize: 22, fontWeight: 700, color: inc.dCp > 0 && inc.retorno != null && inc.retorno < 1 ? C.rojo : C.navy }}>
                {inc.retorno != null ? `${fPesos(inc.retorno)} de margen por cada $1 adicional de personal` : 'Sin cambio en el costo de personal'}
              </div>
              <div style={{ color: C.gris, fontSize: 12.5 }}>
                Sobre $1, el aumento de personal se paga con su propio margen; bajo $1, resta resultado. Margen después de personal: <b style={{ color: inc.dMb - inc.dCp < 0 ? C.rojo : C.verde }}>{fDelta(inc.dMb - inc.dCp)} al mes</b>.
              </div>
              {refN && acum.venta ? (
                <div style={{ marginTop: 10, color: C.gris, fontSize: 12.5 }}>
                  Con la referencia de {fP(refN)}, el costo de personal del año debería ser {fM(refN * acum.venta)}; va en {fM(acum.cp)} ({fDelta(acum.cp - refN * acum.venta)}).
                </div>
              ) : null}
            </div>
          ) : <div style={{ color: C.gris, fontSize: 12.5 }}>Elige con qué comparar (mes anterior o inicio del año). Con un centro filtrado, ambos meses necesitan margen por centro disponible.</div>}
        </Panel>
      </Fila2>
      <Panel titulo="Productividad por centro" nota="Venta, margen, costo de personal oficial prorrateado, gastos directos y contribución por centro (resultado por sucursal de Finanzas). CD y administración central se miden por costo. Clic en un centro para filtrar el panel." sinPad
        acciones={<>
          <Seg valor={alcance} onChange={setAlcance} opciones={[['mes', mesCorto(mes)], ['anio', `Año ${anio}`]]} />
          <BotonExcel onClick={() => exportar(`productividad_${alcance === 'mes' ? mes : anio}`, [{ nombre: 'Por centro', filas: filasExport(colsT, filasT, totalT) }, { nombre: '% costo sobre venta', filas: filasExport(colsH, filasH, totalH) }, { nombre: 'Venta por FTE', filas: filasExport(colsVF, filasVF) }])} />
        </>}>
        <Tabla cols={colsT} filas={filasT} total={totalT} onFila={m.filtrado ? undefined : f => filtrarCentro(f.c)} />
      </Panel>
      <Fila2 min={520}>
        <Panel titulo="Costo de personal sobre venta, por tienda" nota="Rojo: deterioro de 1,5 o más puntos contra el primer mes de la tienda; verde: mejora." sinPad>
          <Tabla cols={colsH} filas={filasH} total={totalH} />
        </Panel>
        <Panel titulo="Venta mensual por FTE, por tienda" nota="Color contra el promedio de la tienda en el año: rojo, bajo su promedio; verde, sobre él." sinPad>
          <Tabla cols={colsVF} filas={filasVF} />
        </Panel>
      </Fila2>
      {cuad.length > 0 && (
        <Panel titulo={`Venta contra costo de personal por tienda · ${mesCorto(pBase)} → ${mesCorto(mes)}`} nota="Cada punto es una tienda (tamaño: FTE). Sobre la diagonal, el costo de personal creció más que la venta: la productividad empeoró.">
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid stroke="#EEF0F3" />
              <XAxis type="number" dataKey="x" name="Variación de la venta" domain={[-lim, lim]} tickFormatter={v => fVar(v, 0)} {...ejeM} label={{ value: 'Variación de la venta', position: 'insideBottom', offset: -4, fontSize: 11, fill: C.gris }} />
              <YAxis type="number" dataKey="y" name="Variación del costo de personal" domain={[-lim, lim]} tickFormatter={v => fVar(v, 0)} {...ejeM} width={56} />
              <ZAxis type="number" dataKey="z" range={[80, 420]} />
              <ReferenceLine x={0} stroke="#C0C4CC" />
              <ReferenceLine y={0} stroke="#C0C4CC" />
              <ReferenceLine segment={[{ x: -lim, y: -lim }, { x: lim, y: lim }]} stroke={C.rojo} strokeDasharray="4 3" />
              <Tooltip content={({ active, payload }) => {
                const p = active && payload && payload[0] ? payload[0].payload : null
                return p ? <div style={{ background: '#fff', border: `1px solid ${C.borde}`, borderRadius: 6, padding: '8px 10px', fontSize: 12 }}><b>{p.nombre}</b><div>Venta {fVar(p.x)}</div><div>Costo de personal {fVar(p.y)}</div></div> : null
              }} />
              <Legend wrapperStyle={{ fontSize: 11.5 }} />
              {cuad.map(p => <Scatter key={p.nombre} name={p.nombre} data={[p]} fill={p.c} />)}
            </ScatterChart>
          </ResponsiveContainer>
        </Panel>
      )}
    </div>
  )
}
