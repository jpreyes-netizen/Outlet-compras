// src/rrhh/remuneraciones/PanelDotacionCosto.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Panel de dotación y costo de personal (Personas → Remuneraciones → Reportes).
// Fusiona el Panel de remuneraciones y el Análisis comparativo (nov-2026): ambos
// repetían cálculos con fuentes distintas. Todas las cifras salen de remDatos.js,
// la misma capa del Informe mensual.
//  · Resumen: costo oficial vs venta, ROI y lectura automática del período.
//  · Dotación: liquidaciones, FTE, ingresos, salidas y rotación por centro y función.
//  · Costo: nómina por partida y centro, puente dotación/costo medio, conciliación.
//  · Horas extra: uso anual por tipo, centro y persona + horas de Workera.
//  · Productividad y ROI: por mes y por centro, retorno incremental, referencia.
//  · Explorador: pivote y comparador libres (reemplaza al Análisis comparativo).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import {
  cargarDatos, cargarWorkera, construirModelo, agg, aggCentro, aggFuncion, mesesNomina, filasMensuales, acumulado, movimientos,
  retornoIncremental, filasCentros, analisisHhee, analisisWorkera, workeraPorSucursal, puenteCosto, hallazgos,
  periodoBase, costoNomina, costoPorFte, div, variacion, fM, fmt, fN, fP, fVar, fPts, fDelta, fEnt, fPesos,
  mesCorto, mesSolo, mesLargo, mesTexto, perAnioAnterior, partidaL, CLASES, TIPOS_HHEE, esApoyo,
} from './remDatos'
import { C, Panel, Franja, Seg, Tabla, Cascada, TT, NIVEL, btn, sel, exportar, filasExport, Vacio, Fila2, BotonExcel } from './remUi'
import { ExploradorRem } from './ExploradorRem'

const VISTAS = [['resumen', 'Resumen'], ['dotacion', 'Dotación'], ['costo', 'Costo'], ['hhee', 'Horas extra'], ['roi', 'Productividad y ROI'], ['explorador', 'Explorador']]
const COLOR_CENTRO = { 'suc-lg': '#16213E', 'suc-la': '#175CD3', 'suc-maipu': '#B25E09', 'suc-web': '#53B1FD', 'suc-mp': '#6941C6', ADM: '#98A2B3' }
const colorCentro = (c, i) => COLOR_CENTRO[c] || ['#12B76A', '#F04438', '#7A5AF8', '#667085'][i % 4]
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const lsSet = (k, v) => { try { localStorage.setItem(k, v) } catch { /* sin storage */ } }
// Costo: subir es malo. Venta y ROI: bajar es malo.
const tonoSube = v => (v == null || !Number.isFinite(v) ? undefined : v > 0.005 ? C.rojo : v < -0.005 ? C.verde : C.gris)
const tonoBaja = v => (v == null || !Number.isFinite(v) ? undefined : v > 0.005 ? C.verde : v < -0.005 ? C.rojo : C.gris)
const pesos = v => (v == null || !Number.isFinite(v) ? '—' : `$${fN(v, 2)}`)
const ejeM = { tick: { fontSize: 11, fill: C.gris }, axisLine: false, tickLine: false }

export function PanelDotacionCosto({ cu, vistaInicial }) {
  const [raw, setRaw] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [recarga, setRecarga] = useState(0)
  const [vista, setVista] = useState(() => vistaInicial || lsGet('rrhh_panel_vista', 'resumen'))
  const [conSocios, setConSocios] = useState(true)
  const [anio, setAnio] = useState(null)
  const [mes, setMes] = useState(null)
  const [base, setBase] = useState(() => lsGet('rrhh_panel_base', 'inicio'))

  useEffect(() => {
    let vivo = true
    setCargando(true); setError(null)
    cargarDatos(cu).then(
      r => {
        if (!vivo) return
        setRaw(r); setCargando(false)
        cargarWorkera().then(hh => { if (vivo) setRaw(x => (x ? { ...x, hh } : x)) })
      },
      e => { if (vivo) { setError(e?.message || String(e)); setCargando(false) } },
    )
    return () => { vivo = false }
  }, [cu?.id, recarga]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (vistaInicial) setVista(vistaInicial) }, [vistaInicial])
  useEffect(() => { lsSet('rrhh_panel_vista', vista) }, [vista])
  useEffect(() => { lsSet('rrhh_panel_base', base) }, [base])

  const m = useMemo(() => (raw ? construirModelo(raw, conSocios) : null), [raw, conSocios])
  const anios = useMemo(() => (m ? [...new Set(m.periodos.map(p => p.slice(0, 4)))] : []), [m])
  useEffect(() => { if (anios.length && (!anio || !anios.includes(anio))) setAnio(anios[anios.length - 1]) }, [anios]) // eslint-disable-line react-hooks/exhaustive-deps
  const meses = useMemo(() => (m && anio ? mesesNomina(m, anio) : []), [m, anio])
  useEffect(() => { if (meses.length && (!mes || !meses.includes(mes))) setMes(meses[meses.length - 1]) }, [meses]) // eslint-disable-line react-hooks/exhaustive-deps
  const pBase = useMemo(() => (m && mes ? periodoBase(m, anio, mes, base) : null), [m, anio, mes, base])

  if (cargando && !raw) return <div style={{ padding: 60, textAlign: 'center', color: C.gris, fontSize: 13 }}>Cargando liquidaciones, libro mayor y horas de Workera…</div>
  if (error && !raw) return <Vacio titulo="No se pudo cargar el panel" texto={error} accion={<button type="button" style={btn} onClick={() => setRecarga(x => x + 1)}>Reintentar</button>} />
  if (!m) return null
  if (!m.periodos.length) return <Vacio titulo="Sin liquidaciones cargadas" texto="Carga las liquidaciones del mes en Remuneraciones → Cargar liquidaciones." />
  if (!anio || !mes || !meses.includes(mes)) return null

  const vistaOk = VISTAS.some(v => v[0] === vista) ? vista : 'resumen'
  const hayAnioAnt = m.tot.has(perAnioAnterior(mes)) || m.eerr.has(perAnioAnterior(mes))
  const ultCerrado = [...m.eerr.entries()].filter(([, v]) => !v.enCurso).map(([p]) => p).sort().pop()
  const lbl = { fontSize: 12, color: C.gris, display: 'inline-flex', alignItems: 'center', gap: 6 }
  const props = { m, anio, mes, pBase, irA: setVista }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.navy, letterSpacing: -0.2 }}>Dotación y costo de personal</h2>
          <div style={{ fontSize: 12, color: C.gris, marginTop: 3 }}>
            Nómina de {mesCorto(m.periodos[0])} a {mesCorto(m.periodos[m.periodos.length - 1])} · libro mayor hasta {ultCerrado ? mesCorto(ultCerrado) : '—'}
            {m.calidad.workeraDesde ? ` · Workera desde ${mesCorto(m.calidad.workeraDesde)}` : ''}{m.verSocios && !m.conSocios ? ' · sin socios' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={lbl}>Año
            <select style={sel} value={anio} onChange={e => setAnio(e.target.value)}>{anios.map(y => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <label style={lbl}>Mes
            <select style={sel} value={mes} onChange={e => setMes(e.target.value)}>{meses.map(p => <option key={p} value={p}>{mesLargo(p)}</option>)}</select>
          </label>
          <span style={lbl}>Comparar con</span>
          <Seg valor={base} onChange={setBase} opciones={[['anterior', 'Mes anterior'], ['inicio', 'Inicio del año'], ['anio_ant', 'Año anterior', !hayAnioAnt]]} />
          {m.verSocios && (
            <label style={{ ...lbl, cursor: 'pointer' }}>
              <input type="checkbox" checked={conSocios} onChange={e => setConSocios(e.target.checked)} /> Incluir socios
            </label>
          )}
          <button type="button" style={btn} disabled={cargando} onClick={() => setRecarga(x => x + 1)}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>
        </div>
      </div>

      <nav style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${C.borde}`, overflowX: 'auto' }}>
        {VISTAS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setVista(k)} aria-current={vistaOk === k ? 'page' : undefined}
            style={{ padding: '8px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: vistaOk === k ? 600 : 500, color: vistaOk === k ? C.navy : C.gris, borderBottom: `2px solid ${vistaOk === k ? C.navy : 'transparent'}`, marginBottom: -1, whiteSpace: 'nowrap' }}>{l}</button>
        ))}
      </nav>

      <Calidad m={m} mes={mes} />

      {vistaOk === 'resumen' && <VistaResumen {...props} />}
      {vistaOk === 'dotacion' && <VistaDotacion {...props} />}
      {vistaOk === 'costo' && <VistaCosto {...props} />}
      {vistaOk === 'hhee' && <VistaHhee {...props} />}
      {vistaOk === 'roi' && <VistaRoi {...props} />}
      {vistaOk === 'explorador' && <ExploradorRem m={m} anio={anio} />}
    </div>
  )
}

// Avisos de calidad de datos del mes: sin ellos el número no se puede defender.
function Calidad({ m, mes }) {
  const notas = []
  m.calidad.errores.forEach(e => notas.push({ c: C.rojo, t: `No se pudo leer ${e.fuente}: ${e.error}` }))
  const sl = m.calidad.sinLineas.get(mes)
  if (sl) notas.push({ c: C.ambar, t: `${sl} liquidación${sl > 1 ? 'es' : ''} de ${mesTexto(mes)} sin detalle de líneas y sin haberes: cuentan en la dotación con 0 FTE.` })
  if (m.calidad.sinMapeo.size) notas.push({ c: C.ambar, t: `Centros sin mapeo en ceco_alias, cargados a Administración central: ${[...m.calidad.sinMapeo.entries()].map(([t, n]) => `${t} (${n})`).join(', ')}.` })
  if (m.calidad.sinFuncion) notas.push({ c: C.ambar, t: `${m.calidad.sinFuncion} liquidaciones de personas sin cuenta madre en el maestro de empleados.` })
  notas.push({ c: C.tenue, t: 'Aportes patronales del detalle: estimados con tasas vigentes. El costo oficial (libro mayor) usa el pago real.' })
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 18px', fontSize: 11.5, lineHeight: 1.4 }}>
      {notas.map((n, i) => <span key={i} style={{ color: n.c }}>{n.t}</span>)}
    </div>
  )
}

// ═══ RESUMEN ════════════════════════════════════════════════════════════════
function VistaResumen({ m, anio, mes, pBase, irA }) {
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
  const items = [
    { l: 'Costo de personal (libro mayor)', v: fM(r.cp), s: rb.cp ? `${fVar(variacion(rb.cp, r.cp))}${vs}` : (r.cp == null ? 'Sin libro mayor del mes' : ''), sColor: tonoSube(variacion(rb.cp, r.cp)), s2: `Año: ${fM(acum.cp)}`, ayuda: 'Cuenta de remuneraciones del libro mayor (haberes, aportes y honorarios). Es la cifra del EERR.' },
    { l: 'Sobre la venta neta', v: fP(r.pct), s: dPct != null ? `${fPts(dPct)}${vs}` : '', sColor: tonoSube(dPct), s2: `Año: ${fP(acum.pct)}` },
    { l: 'Venta neta', v: fM(r.venta), s: rb.venta ? `${fVar(variacion(rb.venta, r.venta))}${vs}` : '', sColor: tonoBaja(variacion(rb.venta, r.venta)), s2: `Año: ${fM(acum.venta)}` },
    { l: 'ROI de personal', v: fP(r.roi, 0), s: r.gmrol != null ? `${pesos(r.gmrol)} de margen por cada $1` : '', s2: rb.roi != null ? `${mesCorto(pBase)}: ${fP(rb.roi, 0)}` : '', color: r.roi != null && rb.roi != null && r.roi < rb.roi ? C.rojo : C.navy, ayuda: '(Margen bruto − costo de personal) ÷ costo de personal.' },
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
    { k: 'cp', l: 'Costo personal', num: true, f: fM, negrita: true },
    { k: 'pct', l: '% venta', num: true, pct: true, f: v => fP(v), tono: (v, x) => (x._total ? undefined : tonoNivel(v)) },
    { k: 'roi', l: 'ROI', num: true, pct: true, f: v => fP(v, 0) },
    { k: 'dot', l: 'Dotación', num: true, f: (v, x) => (x._total ? `${fN(v, 1)} prom.` : fN(v)) },
    { k: 'fte', l: 'FTE', num: true, f: (v, x) => (x._total ? `${fN(v, 1)} prom.` : fN(v, 1)) },
    { k: 'costoFte', l: 'Nómina por FTE', num: true, f: fmt },
    { k: 'hhee', l: 'Horas extra', num: true, f: fM },
    { k: 'hheePctSB', l: 'HE / sueldo base', num: true, pct: true, f: v => fP(v) },
    { k: 'ebitda', l: 'EBITDA', num: true, f: fM, tono: v => (v < 0 ? C.rojo : undefined) },
  ]
  const total = { _total: true, p: 'Año', venta: acum.venta, mb: acum.mb, cp: acum.cp, pct: acum.pct, roi: acum.roi, dot: acum.dotPromedio, fte: acum.ftePromedio, costoFte: acum.costoFte, hhee: acum.hhee, hheePctSB: acum.hheePctSB, ebitda: acum.ebitda }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Franja items={items} />
      <Fila2 min={520}>
        <Panel titulo="Costo de personal y su peso en la venta" nota={`Libro mayor ${anio}. Barras: costo de personal. Línea: % sobre la venta neta; punteada, promedio móvil de 3 meses.`}>
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
      <Panel titulo={`Evolución mensual ${anio}`} nota="Venta, margen, costo de personal y EBITDA: libro mayor. Dotación, FTE, nómina y horas extra: liquidaciones." sinPad
        acciones={<BotonExcel onClick={() => exportar(`dotacion_costo_${anio}`, [{ nombre: 'Evolución', filas: filasExport(cols, filas, total) }])} />}>
        <Tabla cols={cols} filas={filas.map(x => ({ ...x, _k: x.p }))} total={total} />
      </Panel>
    </div>
  )
}

// ═══ DOTACIÓN ═══════════════════════════════════════════════════════════════
function VistaDotacion({ m, anio, mes, pBase }) {
  const meses = mesesNomina(m, anio)
  const a = agg(m, mes), ab = agg(m, pBase)
  const fl = m.flujos.get(mes) || {}
  const movC = useMemo(() => movimientos(m, meses, r => r.ceco), [m, anio]) // eslint-disable-line react-hooks/exhaustive-deps
  const movF = useMemo(() => movimientos(m, meses, r => r.funcion), [m, anio]) // eslint-disable-line react-hooks/exhaustive-deps
  const cargos = useMemo(() => {
    const g = new Map()
    for (const r of m.regs) {
      if (r.tipo !== 'liq' || r.periodo !== mes) continue
      let x = g.get(r.cargo)
      if (!x) { x = { _k: r.cargo, cargo: r.cargo, personas: 0, fte: 0, costo: 0, sb: 0, hhee: 0, centros: new Map() }; g.set(r.cargo, x) }
      x.personas += 1; x.fte += r.fte; x.costo += r.costo; x.sb += r.sueldoBase; x.hhee += r.hheeTotal
      x.centros.set(r.ceco, (x.centros.get(r.ceco) || 0) + 1)
    }
    return [...g.values()].map(x => ({
      ...x, costoMedio: div(x.costo, x.personas), sbMedio: div(x.sb, x.personas), hheePct: div(x.hhee, x.sb),
      centro: [...x.centros.entries()].sort((p, q) => q[1] - p[1]).map(([c, n]) => (x.centros.size > 1 ? `${m.nombreCentro(c)} (${n})` : m.nombreCentro(c))).join(', '),
    })).sort((p, q) => q.personas - p.personas || q.costo - p.costo)
  }, [m, mes])

  let salAnio = 0, mesesSal = 0
  for (const p of meses) { const f = m.flujos.get(p); if (f && !f.salidasFicha) { salAnio += (f.salidas || []).length; mesesSal += 1 } }
  const dotProm = meses.length ? meses.reduce((t, p) => t + agg(m, p).dot, 0) / meses.length : 0
  const rot = mesesSal && dotProm ? (salAnio / dotProm) * (12 / mesesSal) : null
  const fin = Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)
  const antig = m.regs.filter(r => r.tipo === 'liq' && r.periodo === mes && r.fechaIngreso).map(r => (fin - Date.parse(r.fechaIngreso)) / 2629800000).filter(Number.isFinite)
  const antigProm = antig.length ? antig.reduce((t, x) => t + x, 0) / antig.length : null
  const vs = pBase ? ` vs ${mesCorto(pBase)}` : ''
  const items = [
    { l: 'Dotación', v: fN(a.dot), s: pBase ? `${fEnt(a.dot - ab.dot)}${vs}` : '', s2: `${a.pagados} con haberes en el mes`, ayuda: 'Liquidaciones emitidas en el mes.' },
    { l: 'FTE', v: fN(a.fte, 1), s: `${fP(div(a.fte, a.dot), 0)} de jornada completa`, s2: pBase ? `${fN(ab.fte, 1)} en ${mesCorto(pBase)}` : '', ayuda: 'Días trabajados ÷ 30. Licencias, ingresos y salidas a mitad de mes bajan el FTE.' },
    { l: 'Ingresos del mes', v: fl.ingresos ? fN(fl.ingresos.length) : '—', s: `Año: ${fN(movC.ing)}` },
    { l: 'Salidas del mes', v: fl.salidas ? fN(fl.salidas.length) : '—', s: fl.salidasFicha ? 'Según ficha: falta la nómina siguiente' : `Año: ${fN(salAnio)}`, sColor: fl.salidasFicha ? C.ambar : undefined },
    { l: 'Rotación anualizada', v: fP(rot, 0), s: 'Salidas ÷ dotación promedio', s2: `${mesesSal} meses con dato`, ayuda: 'Solo meses con la nómina del mes siguiente cargada.' },
    { l: 'Antigüedad media', v: antigProm != null ? `${fN(antigProm, 1)} meses` : '—', s: `${antig.length} con fecha de ingreso` },
    a.prest.size ? { l: 'Prestadores a honorarios', v: fN(a.prest.size), s: fM(a.honorario) } : null,
  ]
  const centrosD = m.centros.filter(c => meses.some(p => aggCentro(m, p, c).dot > 0))
  const datos = meses.map(p => { const o = { label: mesSolo(p), fte: agg(m, p).fte }; centrosD.forEach(c => { o[c] = aggCentro(m, p, c).dot }); return o })
  const armar = (lista, getAgg, nombre, mov) => {
    const filas = lista.filter(k => meses.some(p => getAgg(p, k).dot > 0)).map(k => {
      const o = { _k: k, nombre: nombre(k) }
      meses.forEach(p => { o[p] = getAgg(p, k).dot || null })
      const x = getAgg(mes, k)
      o.fte = x.fte; o.delta = pBase ? x.dot - getAgg(pBase, k).dot : null; o.costoFte = costoPorFte(x)
      const mv = mov.porGrupo.get(k) || { ing: 0, sal: 0 }; o.ing = mv.ing; o.sal = mv.sal
      return o
    })
    const total = { _k: 'total', nombre: 'Total' }
    meses.forEach(p => { total[p] = agg(m, p).dot })
    Object.assign(total, { fte: a.fte, delta: pBase ? a.dot - ab.dot : null, costoFte: costoPorFte(a), ing: mov.ing, sal: mov.sal })
    return { filas, total }
  }
  const tc = armar(m.centros, (p, c) => aggCentro(m, p, c), m.nombreCentro, movC)
  const tf = armar(m.funciones, (p, f) => aggFuncion(m, p, f), f => f, movF)
  const colsGrupo = titulo => [
    { k: 'nombre', l: titulo, sticky: true },
    ...meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: v => (v ? fN(v) : '') })),
    { k: 'fte', l: `FTE ${mesSolo(mes)}`, num: true, f: v => fN(v, 1) },
    { k: 'delta', l: pBase ? `Δ vs ${mesSolo(pBase)}` : 'Δ', num: true, f: fEnt },
    { k: 'ing', l: 'Ingresos año', num: true, f: v => fN(v) },
    { k: 'sal', l: 'Salidas año', num: true, f: v => fN(v), x: v => v },
    { k: 'costoFte', l: `Nómina por FTE ${mesSolo(mes)}`, num: true, f: fmt },
  ]
  const movs = [
    ...(fl.ingresos || []).map(c => ({ r: m.regPC.get(`${mes}|${c}`), mov: 'Ingreso' })),
    ...(fl.salidas || []).map(c => ({ r: m.regPC.get(`${mes}|${c}`), mov: fl.salidasFicha ? 'Salida (según ficha)' : 'Salida' })),
  ].filter(x => x.r).map(({ r, mov }) => ({ _k: `${mov}|${r.cod}`, mov, nombre: r.nombre, cargo: r.cargo, centro: m.nombreCentro(r.ceco), funcion: r.funcion, dias: r.dias, haberes: r.haberes }))
  const colsMov = [
    { k: 'mov', l: 'Movimiento' }, { k: 'nombre', l: 'Persona', max: 220 }, { k: 'cargo', l: 'Cargo', max: 200 }, { k: 'centro', l: 'Centro' },
    { k: 'funcion', l: 'Función' }, { k: 'dias', l: 'Días', num: true, f: v => fN(v) }, { k: 'haberes', l: 'Haberes', num: true, f: fmt },
  ]
  const colsCargo = [
    { k: 'cargo', l: 'Cargo', sticky: true, max: 240 }, { k: 'centro', l: 'Centro', max: 260 },
    { k: 'personas', l: 'Personas', num: true, f: v => fN(v) }, { k: 'fte', l: 'FTE', num: true, f: v => fN(v, 1) },
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
      <Panel titulo="Por centro de costo" nota="Liquidaciones por mes. Ingresos: primera liquidación; salidas: último mes con liquidación." sinPad
        acciones={<BotonExcel onClick={() => exportar(`dotacion_${anio}`, [{ nombre: 'Por centro', filas: filasExport(colsGrupo('Centro'), tc.filas, tc.total) }, { nombre: 'Por función', filas: filasExport(colsGrupo('Función'), tf.filas, tf.total) }, { nombre: `Cargos ${mes}`, filas: filasExport(colsCargo, cargos) }, { nombre: `Movimientos ${mes}`, filas: filasExport(colsMov, movs) }])} />}>
        <Tabla cols={colsGrupo('Centro')} filas={tc.filas} total={tc.total} />
      </Panel>
      <Panel titulo="Por función" nota="Según la cuenta madre del maestro de empleados: Venta (610), Operación (600), Administración (760), Socios (761)." sinPad>
        <Tabla cols={colsGrupo('Función')} filas={tf.filas} total={tf.total} />
      </Panel>
      <Fila2 min={520}>
        <Panel titulo={`Movimientos de ${mesTexto(mes)}`} nota={fl.ingresos ? `${(fl.ingresos || []).length} ingresos y ${(fl.salidas || []).length} salidas.` : 'Sin el mes anterior cargado no se pueden calcular ingresos.'} sinPad>
          <Tabla cols={colsMov} filas={movs} maxH={360} vacio="Sin ingresos ni salidas en el mes." />
        </Panel>
        <Panel titulo={`Cargos en ${mesTexto(mes)}`} nota="Costo medio = haberes + aportes por persona." sinPad>
          <Tabla cols={colsCargo} filas={cargos} maxH={360} />
        </Panel>
      </Fila2>
    </div>
  )
}

// ═══ COSTO ══════════════════════════════════════════════════════════════════
function VistaCosto({ m, anio, mes, pBase }) {
  const meses = mesesNomina(m, anio)
  const a = agg(m, mes), ab = agg(m, pBase)
  const pz = useMemo(() => (pBase && pBase !== mes ? puenteCosto(agg(m, pBase), agg(m, mes)) : null), [m, pBase, mes])
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
  const keys = [...new Set(meses.flatMap(p => Object.keys(agg(m, p).partidas)))]
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
  const filasC = m.centros.filter(c => meses.some(p => costoNomina(aggCentro(m, p, c)) > 0)).map(c => {
    const o = { _k: c, nombre: m.nombreCentro(c) }
    let t = 0
    meses.forEach(p => { const v = costoNomina(aggCentro(m, p, c)); o[p] = v || null; t += v })
    o.total = t; o.share = div(t, totAnio); o.varAnio = variacion(o[p0] || 0, o[pN] || 0); o.costoFte = costoPorFte(aggCentro(m, mes, c))
    return o
  }).sort((x, y) => y.total - x.total)
  const totalC = { ...totalP, nombre: 'Total', costoFte: costoPorFte(a) }
  const colsC = [{ k: 'nombre', l: 'Centro', sticky: true }, ...colMeses, { k: 'total', l: 'Año', num: true, f: fM, negrita: true }, { k: 'share', l: '% año', num: true, pct: true, f: v => fP(v) }, colVar, { k: 'costoFte', l: `Nómina por FTE ${mesSolo(mes)}`, num: true, f: fmt }]
  const conc = m.conSocios ? meses.map(p => {
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
        acciones={<BotonExcel onClick={() => exportar(`costo_nomina_${anio}`, [{ nombre: 'Por partida', filas: filasExport(colsP, filasP, totalP) }, { nombre: 'Por centro', filas: filasExport(colsC, filasC, totalC) }, ...(conc.length ? [{ nombre: 'Conciliación libro', filas: filasExport(colsConc, conc) }] : [])])} />}>
        <Tabla cols={colsP} filas={filasP} total={totalP} />
      </Panel>
      <Panel titulo="Por centro de costo" nota="Centro de la liquidación de cada mes, igual que el resultado por sucursal de Finanzas." sinPad>
        <Tabla cols={colsC} filas={filasC} total={totalC} />
      </Panel>
      {m.conSocios ? (
        <Panel titulo="Conciliación de la nómina con el libro mayor" nota="Aportes: pago real del libro Contaline cuando está cargado. La diferencia corresponde a remuneración de socios registrada directo en el libro mayor y a ajustes contables: revisa los meses marcados." sinPad>
          <Tabla cols={colsConc} filas={conc} />
        </Panel>
      ) : m.verSocios ? (
        <div style={{ fontSize: 12, color: C.gris }}>Activa “Incluir socios” para ver la conciliación de la nómina con el libro mayor.</div>
      ) : null}
    </div>
  )
}

// ═══ HORAS EXTRA ════════════════════════════════════════════════════════════
function VistaHhee({ m, anio, mes }) {
  const h = useMemo(() => analisisHhee(m, anio), [m, anio])
  const w = useMemo(() => analisisWorkera(m, anio), [m, anio])
  const ws = useMemo(() => workeraPorSucursal(m, mes), [m, mes])
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
  const formatos = { pctSB: v => fP(v) }
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
  const colsPer = [
    { k: 'nombre', l: 'Persona', sticky: true, max: 220 }, { k: 'cargo', l: 'Cargo', max: 200 }, { k: 'centro', l: 'Centro' },
    { k: 'mesesHhee', l: 'Meses con HE', num: true, f: (v, x) => `${v} de ${x.meses}` },
    { k: 'hhee', l: 'Año', num: true, f: fmt, negrita: true }, { k: 'pctSB', l: '% de su sueldo base', num: true, pct: true, f: v => fP(v) },
    { k: 'promMes', l: 'Promedio por mes con HE', num: true, f: fmt },
    { k: 'recurrente', l: 'Recurrente', f: v => (v ? 'Sí' : ''), tono: v => (v ? C.ambar : undefined), x: v => (v ? 'Sí' : '') },
  ]
  const colsW = [
    { k: 'p', l: 'Mes', f: v => mesCorto(v) }, { k: 'horas', l: 'Horas registradas', num: true, f: v => fN(v, 1), negrita: true },
    { k: 'aut', l: 'Autorizadas', num: true, f: v => fN(v, 1), tono: () => C.verde }, { k: 'rech', l: 'Rechazadas', num: true, f: v => fN(v, 1) },
    { k: 'pend', l: 'Pendientes', num: true, f: v => fN(v, 1), tono: v => (v > 0 ? C.ambar : undefined) },
    { k: 'personas', l: 'Personas', num: true, f: v => fN(v) }, { k: 'horasPersona', l: 'Horas por persona', num: true, f: v => fN(v, 1) },
    { k: 'sobreTope', l: 'Días con más de 2 h', num: true, f: v => fN(v), tono: v => (v > 0 ? C.rojo : undefined) },
  ]
  const colsWS = [{ k: 'sucursal', l: 'Sucursal' }, ...colsW.slice(1)]
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
            <Tooltip content={<TT formatos={formatos} />} />
            <Legend wrapperStyle={{ fontSize: 11.5 }} />
            {tiposP.map(t => <Bar key={t.k} yAxisId="m" dataKey={t.k} name={t.l} stackId="h" fill={t.c} maxBarSize={42} />)}
            <Line yAxisId="p" type="monotone" dataKey="pctSB" name="% del sueldo base" stroke={C.rojo} strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>
      <Panel titulo="Mes a mes" nota="Montos de liquidación. Las horas se pagan con corte del 26 al 25; las rezagadas corresponden a horas del período anterior." sinPad
        acciones={<BotonExcel onClick={() => exportar(`horas_extra_${anio}`, [{ nombre: 'Mes a mes', filas: filasExport(colsM, filasM, totalM) }, { nombre: 'Por centro', filas: filasExport(colsC, filasC, totalC) }, { nombre: 'Personas', filas: filasExport(colsPer, h.personas) }, ...(w.length ? [{ nombre: 'Workera', filas: filasExport(colsW, w) }] : [])])} />}>
        <Tabla cols={colsM} filas={filasM} total={totalM} />
      </Panel>
      <Panel titulo="Por centro de costo" nota="Centro de la liquidación. Por FTE al mes = horas extra del año ÷ FTE-mes del centro." sinPad>
        <Tabla cols={colsC} filas={filasC} total={totalC} />
      </Panel>
      <Panel titulo={`Personas con horas extra en ${anio}`} nota={`${h.personas.length} personas. Recurrente: horas extra en al menos 3 de cada 4 meses con liquidación (mínimo 3 meses).`} sinPad>
        <Tabla cols={colsPer} filas={h.personas} maxH={420} />
      </Panel>
      {m.calidad.workeraPendiente && <div style={{ fontSize: 12, color: C.gris }}>Cargando horas registradas en Workera…</div>}
      {w.length > 0 && (
        <Fila2 min={520}>
          <Panel titulo="Horas sobre la jornada registradas en Workera" nota="Por mes calendario, con la decisión de jefatura registrada en el ERP. No cuadra mes a mes con la liquidación por el corte del 26 al 25." sinPad>
            <Tabla cols={colsW} filas={w} />
          </Panel>
          <Panel titulo={`Workera por sucursal · ${mesTexto(mes)}`} nota="Horas registradas en el mes calendario." sinPad>
            <Tabla cols={colsWS} filas={ws} vacio="Sin registros de Workera en el mes." />
          </Panel>
        </Fila2>
      )}
    </div>
  )
}

// ═══ PRODUCTIVIDAD Y ROI ════════════════════════════════════════════════════
function VistaRoi({ m, anio, mes, pBase }) {
  const filas = useMemo(() => filasMensuales(m, anio), [m, anio])
  const acum = useMemo(() => acumulado(filas), [filas])
  const [alcance, setAlcance] = useState('mes')
  const [ref, setRef] = useState(() => lsGet('rrhh_ref_pct', ''))
  useEffect(() => { lsSet('rrhh_ref_pct', ref) }, [ref])
  const refN = (() => { const v = parseFloat(String(ref).replace(',', '.')); return Number.isFinite(v) && v > 0 ? v / 100 : null })()
  const cerrados = useMemo(() => mesesNomina(m, anio).filter(p => m.eerr.get(p) && !m.eerr.get(p).enCurso), [m, anio])
  const periodosC = alcance === 'mes' ? [mes] : cerrados
  const clave = periodosC.join(',')
  const centros = useMemo(() => filasCentros(m, periodosC), [m, clave]) // eslint-disable-line react-hooks/exhaustive-deps
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
  const sum = (k) => centros.reduce((t, f) => t + (f[k] || 0), 0)
  const sV = sum('ingresos'), sM = sum('mb'), sR = sum('rem'), sF = sum('fteMeses')
  const filasT = [...centros.filter(f => !f.apoyo).sort((x, y) => y.ingresos - x.ingresos), ...centros.filter(f => f.apoyo).sort((x, y) => y.rem - x.rem)].map(f => {
    const sb = pBase && alcance === 'mes' ? m.suc.get(pBase)?.get(f.c) : null
    return { ...f, _k: f.c, tipo: f.apoyo ? 'Apoyo' : 'Tienda', shareRem: div(f.rem, sR), dPct: f.pct != null && sb && sb.ingresos > 0 && sb.rem > 0 ? f.pct - sb.rem / sb.ingresos : null }
  })
  const totalT = { _k: 'total', nombre: 'Total empresa', ingresos: sV, mb: sM, rem: sR, pct: div(sR, sV), gmrol: div(sM, sR), roi: div(sM - sR, sR), fte: sum('fte'), ventaFte: div(sV, sF), costoFte: div(sR, sF), shareRem: 1, hhee: sum('hhee') }
  const colsT = [
    { k: 'nombre', l: 'Centro', sticky: true }, { k: 'tipo', l: 'Tipo' },
    { k: 'ingresos', l: 'Venta neta', num: true, f: fM }, { k: 'mb', l: 'Margen bruto', num: true, f: fM },
    { k: 'rem', l: 'Costo personal', num: true, f: fM, negrita: true }, { k: 'pct', l: '% venta', num: true, pct: true, f: v => fP(v) },
    ...(pBase && alcance === 'mes' ? [{ k: 'dPct', l: `Δ vs ${mesSolo(pBase)}`, num: true, f: v => fPts(v), tono: tonoSube }] : []),
    { k: 'gmrol', l: 'Margen por $1', num: true, f: pesos, tono: v => (v != null && v < 1 ? C.rojo : undefined) },
    { k: 'roi', l: 'ROI', num: true, pct: true, f: v => fP(v, 0) }, { k: 'fte', l: 'FTE', num: true, f: v => fN(v, 1) },
    { k: 'ventaFte', l: 'Venta por FTE', num: true, f: fM }, { k: 'costoFte', l: 'Costo por FTE', num: true, f: fmt },
    { k: 'shareRem', l: '% del costo', num: true, pct: true, f: v => fP(v) }, { k: 'hhee', l: 'Horas extra', num: true, f: fM },
  ]
  const tiendas = m.centros.filter(c => !esApoyo(c) && cerrados.some(p => (m.suc.get(p)?.get(c)?.rem || 0) > 0))
  const filasH = tiendas.map(c => {
    const o = { _k: c, nombre: m.nombreCentro(c) }
    let first = null, sv = 0, sr = 0
    cerrados.forEach(p => { const s = m.suc.get(p)?.get(c); const v = s && s.ingresos > 0 && s.rem > 0 ? s.rem / s.ingresos : null; o[p] = v; if (first == null && v != null) first = v; if (s && s.ingresos > 0) { sv += s.ingresos; sr += s.rem } })
    o._first = first; o.anio = div(sr, sv)
    return o
  })
  const totalH = { _k: 'total', nombre: 'Empresa (incluye apoyo)', anio: acum.pct }
  cerrados.forEach(p => { totalH[p] = filas.find(x => x.p === p)?.pct ?? null })
  const fondoH = (v, row) => (v == null || row._first == null ? undefined : v - row._first >= 0.03 ? 'rgba(180,35,24,.16)' : v - row._first >= 0.015 ? 'rgba(180,35,24,.08)' : row._first - v >= 0.015 ? 'rgba(30,122,68,.10)' : undefined)
  const colsH = [{ k: 'nombre', l: 'Tienda', sticky: true }, ...cerrados.map(p => ({ k: p, l: mesSolo(p), num: true, pct: true, f: v => fP(v), fondo: fondoH })), { k: 'anio', l: 'Año', num: true, pct: true, f: v => fP(v), negrita: true }]
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Franja items={items} />
      <Fila2 min={520}>
        <Panel titulo="Margen bruto contra costo de personal" nota="Libro mayor. Línea: ROI de personal del mes."
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
        <Panel titulo="Retorno incremental del personal" nota="Compara dos meses del libro mayor: cuánto margen bruto adicional trajo cada peso adicional de costo de personal.">
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
          ) : <div style={{ color: C.gris, fontSize: 12.5 }}>Elige con qué comparar (mes anterior o inicio del año) con libro mayor cerrado.</div>}
        </Panel>
      </Fila2>
      <Panel titulo="Productividad por centro" nota="Venta, margen y costo de personal oficial prorrateado por centro (igual que el resultado por sucursal de Finanzas). CD y administración central se miden por costo." sinPad
        acciones={<>
          <Seg valor={alcance} onChange={setAlcance} opciones={[['mes', mesCorto(mes)], ['anio', `Año ${anio}`]]} />
          <BotonExcel onClick={() => exportar(`productividad_${alcance === 'mes' ? mes : anio}`, [{ nombre: 'Por centro', filas: filasExport(colsT, filasT, totalT) }, { nombre: '% costo sobre venta', filas: filasExport(colsH, filasH, totalH) }])} />
        </>}>
        <Tabla cols={colsT} filas={filasT} total={totalT} />
      </Panel>
      <Panel titulo="Costo de personal sobre venta, por tienda" nota="Rojo: deterioro de 1,5 o más puntos contra el primer mes de la tienda; verde: mejora. La fila empresa incluye CD y administración central." sinPad>
        <Tabla cols={colsH} filas={filasH} total={totalH} />
      </Panel>
    </div>
  )
}
