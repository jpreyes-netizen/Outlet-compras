// src/rrhh/remuneraciones/VistasArea.jsx
// Desglose por gerencia y área del organigrama de Personas (nov-2026).
//  · Gerencia: rama del organigrama bajo el Gerente General (Comercial, Operaciones,
//    Adm. y Finanzas, Desarrollo de Negocios; Dirección para directorio y gerencia general).
//  · Área: el área de cada cargo en el organigrama (Comercial, Marketing, Operaciones,
//    Finanzas, Personas, Negocios, Gobierno).
//  · Función: cuenta madre del maestro de empleados, que es la que usa el EERR.
// La persona se asigna con su cargo vigente en cada mes; antes de julio 2026 (cuando
// partió el organigrama) con su asignación más cercana.
import { useState } from 'react'
import {
  agg, aggArea, aggGerencia, aggFuncion, mesesNomina, costoNomina, costoPorFte, div, variacion,
  fM, fmt, fN, fP, fVar, fEnt, fDelta, mesSolo, mesCorto, mesTexto, lineaEsperada, ESPERADA_LABEL, nombreGerencia,
} from './remDatos'
import { C, Panel, Seg, Tabla, exportar, filasExport, BotonExcel, tonoSube } from './remUi'

const CUENTA_DE = { Venta: '610', Operación: '600', 'Administrativos Adm. y Finanzas': '760', 'Administrativos Marketing': '763', 'Administrativos Negocios': '764', 'Administrativos Tiendas': '765', Socios: '761' }
const DIMS = [['gerencia', 'Gerencia'], ['area', 'Área'], ['funcion', 'Función (cuenta madre)']]
const TITULO = { dotacion: 'Dotación', costo: 'Costo de nómina', hhee: 'Horas extra' }

// Tabla por gerencia, área o función (meses × grupo) y su cruce con los centros del mes.
export function PanelPorGrupo({ m, anio, mes, pBase, modo, onGrupo }) {
  const [dim, setDim] = useState('gerencia')
  const meses = mesesNomina(m, anio)
  const conf = {
    gerencia: { lista: m.gerencias || [], agg: aggGerencia, fl: m.flGerencia, filtro: k => `g:${k}`, clave: r => r.gerencia },
    area: { lista: m.areas || [], agg: aggArea, fl: m.flArea, filtro: k => `a:${k}`, clave: r => r.area },
    funcion: { lista: m.funciones || [], agg: aggFuncion, fl: m.flFuncion, filtro: null, clave: r => r.funcion },
  }[dim]
  const ga = (p, k) => conf.agg(m, p, k)
  const valor = x => (modo === 'dotacion' ? x.dot : modo === 'costo' ? costoNomina(x) : x.hhee)
  const cerr = meses.filter(p => m.eerr.get(p) && !m.eerr.get(p).enCurso)
  const ventaAnio = cerr.reduce((s, p) => s + (m.eerr.get(p)?.venta || 0), 0)
  const totAnio = meses.reduce((s, p) => s + valor(agg(m, p)), 0)
  const filas = conf.lista.filter(k => meses.some(p => valor(ga(p, k)) > 0 || ga(p, k).dot > 0)).map(k => {
    const o = { _k: k, nombre: k }
    let t = 0, fte = 0, sb = 0, cv = 0
    meses.forEach(p => { const x = ga(p, k), v = valor(x); o[p] = v || null; t += v; fte += x.fte; sb += x.sueldoBase; if (cerr.includes(p)) cv += costoNomina(x) })
    const xm = ga(mes, k), xb = pBase ? ga(pBase, k) : null
    if (modo === 'dotacion') {
      let ing = 0, ingT = 0, sal = 0, salT = 0
      meses.forEach(p => { const f = conf.fl?.get(k)?.get(p); if (f) { ing += (f.ingresos || []).length; ingT += (f.ingTraslado || []).length; sal += (f.salidas || []).length; salT += (f.salTraslado || []).length } })
      Object.assign(o, { fte: xm.fte, delta: xb ? xm.dot - xb.dot : null, contrat: ing - ingT, trasIn: ingT, desv: sal - salT, trasOut: salT, costoFte: costoPorFte(xm) })
    } else if (modo === 'costo') {
      Object.assign(o, { total: t, share: div(t, totAnio), varAnio: variacion(o[meses[0]] || 0, o[meses[meses.length - 1]] || 0), dMes: xb ? variacion(costoNomina(xb), costoNomina(xm)) : null, costoFte: costoPorFte(xm), pctVenta: div(cv, ventaAnio) })
    } else {
      Object.assign(o, { total: t, share: div(t, totAnio), porFte: div(t, fte), pctSB: div(t, sb), personas: xm.conHhee })
    }
    return o
  })
  const tm = agg(m, mes), tb = pBase ? agg(m, pBase) : null
  const total = { _k: 'total', nombre: 'Total' }
  meses.forEach(p => { total[p] = valor(agg(m, p)) })
  const sum = k => filas.reduce((s, f) => s + (f[k] || 0), 0)
  if (modo === 'dotacion') Object.assign(total, { fte: tm.fte, delta: tb ? tm.dot - tb.dot : null, contrat: sum('contrat'), trasIn: sum('trasIn'), desv: sum('desv'), trasOut: sum('trasOut'), costoFte: costoPorFte(tm) })
  else if (modo === 'costo') Object.assign(total, { total: totAnio, share: 1, varAnio: variacion(total[meses[0]], total[meses[meses.length - 1]]), dMes: tb ? variacion(costoNomina(tb), costoNomina(tm)) : null, costoFte: costoPorFte(tm), pctVenta: div(cerr.reduce((s, p) => s + costoNomina(agg(m, p)), 0), ventaAnio) })
  else Object.assign(total, { total: totAnio, share: 1, porFte: div(totAnio, meses.reduce((s, p) => s + agg(m, p).fte, 0)), pctSB: div(totAnio, meses.reduce((s, p) => s + agg(m, p).sueldoBase, 0)), personas: tm.conHhee })
  const fv = modo === 'dotacion' ? v => (v ? fN(v) : '') : v => (v ? fM(v) : '')
  const cols = [
    { k: 'nombre', l: DIMS.find(d => d[0] === dim)[1], sticky: true },
    ...meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: fv })),
    ...(modo === 'dotacion' ? [
      { k: 'fte', l: `FTE ${mesSolo(mes)}`, num: true, f: v => fN(v, 1) },
      { k: 'delta', l: pBase ? `Δ vs ${mesSolo(pBase)}` : 'Δ', num: true, f: fEnt },
      { k: 'contrat', l: 'Contrataciones', num: true, f: v => fN(v) }, { k: 'trasIn', l: 'Traslados entran', num: true, f: v => fN(v) },
      { k: 'desv', l: 'Desvinculaciones', num: true, f: v => fN(v) }, { k: 'trasOut', l: 'Traslados salen', num: true, f: v => fN(v) },
      { k: 'costoFte', l: `Nómina por FTE ${mesSolo(mes)}`, num: true, f: fmt },
    ] : modo === 'costo' ? [
      { k: 'total', l: 'Año', num: true, f: fM, negrita: true }, { k: 'share', l: '% del costo', num: true, pct: true, f: v => fP(v) },
      { k: 'varAnio', l: `${mesSolo(meses[0])}→${mesSolo(meses[meses.length - 1])}`, num: true, pct: true, f: v => fVar(v), tono: tonoSube },
      ...(pBase ? [{ k: 'dMes', l: `${mesSolo(mes)} vs ${mesSolo(pBase)}`, num: true, pct: true, f: v => fVar(v), tono: tonoSube }] : []),
      { k: 'costoFte', l: `Nómina por FTE ${mesSolo(mes)}`, num: true, f: fmt }, { k: 'pctVenta', l: '% de la venta (año)', num: true, pct: true, f: v => fP(v) },
    ] : [
      { k: 'total', l: 'Año', num: true, f: fM, negrita: true }, { k: 'share', l: '% del total', num: true, pct: true, f: v => fP(v) },
      { k: 'porFte', l: 'Por FTE al mes', num: true, f: fmt }, { k: 'pctSB', l: '% sueldo base', num: true, pct: true, f: v => fP(v), tono: v => (v > 0.15 ? C.rojo : undefined) },
      { k: 'personas', l: `Personas con HE ${mesSolo(mes)}`, num: true, f: v => fN(v) },
    ]),
  ]
  // Cruce del mes: grupo × centro.
  const cruce = new Map()
  for (const r of m.regs) {
    if (r.periodo !== mes) continue
    const k = conf.clave(r)
    let o = cruce.get(k); if (!o) { o = { _k: k, nombre: k, total: 0 }; cruce.set(k, o) }
    const v = modo === 'dotacion' ? (r.tipo === 'liq' ? 1 : 0) : modo === 'costo' ? r.costo : r.hheeTotal
    o[r.ceco] = (o[r.ceco] || 0) + v; o.total += v
  }
  const centrosC = m.centros.filter(c => [...cruce.values()].some(o => o[c]))
  const filasC = conf.lista.filter(k => cruce.has(k) && cruce.get(k).total).map(k => cruce.get(k))
  const totalC = { _k: 'total', nombre: 'Total', total: filasC.reduce((s, o) => s + o.total, 0) }
  centrosC.forEach(c => { totalC[c] = filasC.reduce((s, o) => s + (o[c] || 0), 0) })
  const colsC = [{ k: 'nombre', l: DIMS.find(d => d[0] === dim)[1], sticky: true }, ...centrosC.map(c => ({ k: c, l: m.nombreCentro(c), num: true, f: fv })), { k: 'total', l: 'Total', num: true, f: modo === 'dotacion' ? v => fN(v) : fM, negrita: true }]
  return (
    <>
      <Panel titulo={`${TITULO[modo]} por gerencia, área o función`} sinPad
        nota="Gerencia y área según el organigrama de Personas (cargo vigente en cada mes; antes de julio 2026, la asignación más cercana). Función: cuenta madre del maestro de empleados, la que usa el EERR. Clic en una gerencia o área para filtrar todo el panel."
        acciones={<>
          <Seg valor={dim} onChange={setDim} opciones={DIMS} />
          <BotonExcel onClick={() => exportar(`${modo}_por_${dim}_${anio}`, [{ nombre: `Por ${dim}`, filas: filasExport(cols, filas, total) }, ...(filasC.length ? [{ nombre: `Por centro ${mes}`, filas: filasExport(colsC, filasC, totalC) }] : [])])} />
        </>}>
        <Tabla cols={cols} filas={filas} total={total} onFila={conf.filtro && onGrupo ? r => onGrupo(conf.filtro(r._k)) : undefined} />
      </Panel>
      {centrosC.length > 1 && filasC.length > 0 && (
        <Panel titulo={`${TITULO[modo]} por ${DIMS.find(d => d[0] === dim)[1].toLowerCase()} y centro · ${mesTexto(mes)}`} nota={modo === 'dotacion' ? 'Liquidaciones del mes.' : 'Montos del mes.'} sinPad>
          <Tabla cols={colsC} filas={filasC} total={totalC} />
        </Panel>
      )}
    </>
  )
}

// Resumen por gerencia del mes, para la primera pantalla.
export function ResumenGerencias({ m, mes, pBase, filtrarArea }) {
  if (!m.gerencias || m.gerencias.length < 2) return null
  const a = agg(m, mes), cn = costoNomina(a), venta = m.eerr.get(mes)?.venta ?? null
  const filas = m.gerencias.map(g => {
    const x = aggGerencia(m, mes, g), xb = pBase ? aggGerencia(m, pBase, g) : null, c = costoNomina(x)
    return { _k: g, nombre: g, dot: x.dot, fte: x.fte, costo: c, share: div(c, cn), pctVenta: div(c, venta), dAbs: xb ? c - costoNomina(xb) : null, dCosto: xb ? variacion(costoNomina(xb), c) : null, costoFte: costoPorFte(x), hheeSB: div(x.hhee, x.sueldoBase) }
  }).filter(f => f.dot || f.costo).sort((x, y) => y.costo - x.costo)
  const ab = pBase ? agg(m, pBase) : null
  const total = { _k: 'total', nombre: 'Total', dot: a.dot, fte: a.fte, costo: cn, share: 1, pctVenta: div(cn, venta), dAbs: ab ? cn - costoNomina(ab) : null, dCosto: ab ? variacion(costoNomina(ab), cn) : null, costoFte: costoPorFte(a), hheeSB: div(a.hhee, a.sueldoBase) }
  const cols = [
    { k: 'nombre', l: 'Gerencia', sticky: true }, { k: 'dot', l: 'Dotación', num: true, f: v => fN(v) }, { k: 'fte', l: 'FTE', num: true, f: v => fN(v, 1) },
    { k: 'costo', l: 'Costo de nómina', num: true, f: fM, negrita: true }, { k: 'share', l: '% del costo', num: true, pct: true, f: v => fP(v) },
    { k: 'pctVenta', l: '% de la venta', num: true, pct: true, f: v => fP(v) },
    ...(pBase ? [{ k: 'dAbs', l: `Δ vs ${mesSolo(pBase)}`, num: true, f: v => fDelta(v), tono: tonoSube }, { k: 'dCosto', l: 'Variación', num: true, pct: true, f: v => fVar(v), tono: tonoSube }] : []),
    { k: 'costoFte', l: 'Nómina por FTE', num: true, f: fmt }, { k: 'hheeSB', l: 'HE / sueldo base', num: true, pct: true, f: v => fP(v) },
  ]
  return (
    <Panel titulo={`Por gerencia · ${mesTexto(mes)}`} sinPad nota="Gerencias del organigrama de Personas. Costo de nómina: haberes + aportes estimados + honorarios. % de la venta: sobre la venta del alcance. Clic en una gerencia para filtrar todo el panel.">
      <Tabla cols={cols} filas={filas} total={total} onFila={filtrarArea ? r => filtrarArea(`g:${r._k}`) : undefined} />
    </Panel>
  )
}

// Nómina por área según la línea del EERR (cuenta madre) en que queda registrada.
export function CruceEerr({ m, anio, mes }) {
  const [alc, setAlc] = useState('mes')
  const ps = alc === 'mes' ? [mes] : mesesNomina(m, anio)
  const g = new Map()
  for (const r of m.regs) {
    if (!ps.includes(r.periodo)) continue
    let o = g.get(r.area)
    if (!o) { o = { _k: r.area, nombre: r.area, total: 0, fuera: 0 }; g.set(r.area, o) }
    o[r.funcion] = (o[r.funcion] || 0) + r.costo; o.total += r.costo
    const esp = lineaEsperada(r)
    if (esp && !esp.includes(r.funcion) && r.funcion !== 'Socios') o.fuera += r.costo
  }
  const filas = [...g.values()].map(o => ({ ...o, pctFuera: div(o.fuera, o.total), esperada: ESPERADA_LABEL[o.nombre] || '—' })).sort((x, y) => y.total - x.total)
  const funcs = (m.funciones || []).filter(f => filas.some(o => o[f]))
  const total = { _k: 'total', nombre: 'Total', total: filas.reduce((s2, o) => s2 + o.total, 0), fuera: filas.reduce((s2, o) => s2 + o.fuera, 0) }
  funcs.forEach(f => { total[f] = filas.reduce((s2, o) => s2 + (o[f] || 0), 0) })
  total.pctFuera = div(total.fuera, total.total)
  const cols = [
    { k: 'nombre', l: 'Área', sticky: true }, { k: 'esperada', l: 'Línea esperada' },
    ...funcs.map(f => ({ k: f, l: `${f}${CUENTA_DE[f] ? ` (${CUENTA_DE[f]})` : ''}`, num: true, f: v => (v ? fM(v) : '') })),
    { k: 'total', l: 'Total', num: true, f: fM, negrita: true },
    { k: 'fuera', l: 'Fuera de su línea', num: true, f: v => (v ? fM(v) : ''), tono: v => (v > 0 ? C.ambar : undefined) },
    { k: 'pctFuera', l: '% fuera', num: true, pct: true, f: v => (v ? fP(v) : ''), tono: v => (v > 0.1 ? C.ambar : undefined) },
  ]
  if (!filas.length) return null
  return (
    <Panel titulo="Nómina por área según su línea del EERR" sinPad
      nota="El EERR reparte la remuneración por la cuenta madre del maestro de empleados (Venta 610, Operación 600; administrativos: Adm. y Finanzas 760, Marketing 763, Negocios 764 y Tiendas 765; Socios 761). Línea esperada: Comercial en venta o administrativos de tienda; Marketing en 763; Operaciones en operación; Finanzas y Personas en 760, salvo quienes dependen de Desarrollo de Negocios (764). “Fuera de su línea”: nómina del área registrada en otra línea. Se corrige actualizando la cuenta madre en el maestro de empleados."
      acciones={<>
        <Seg valor={alc} onChange={setAlc} opciones={[['mes', mesCorto(mes)], ['anio', `Año ${anio}`]]} />
        <BotonExcel onClick={() => exportar(`area_vs_eerr_${alc === 'mes' ? mes : anio}`, [{ nombre: 'Área vs EERR', filas: filasExport(cols, filas, total) }])} />
      </>}>
      <Tabla cols={cols} filas={filas} total={total} />
    </Panel>
  )
}

export { nombreGerencia }
