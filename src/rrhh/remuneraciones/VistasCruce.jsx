// src/rrhh/remuneraciones/VistasCruce.jsx
// Vistas de análisis cruzado del Panel de dotación y costo (nov-2026):
//  · Por centro: tablero de todos los centros (mes o año) y ficha del centro con
//    todos los indicadores mes a mes.
//  · Matriz: cualquier indicador × centro, función, centro y función, cargo o persona
//    × mes, con color contra el promedio, tendencia y detalle por persona.
//  · Personas: persona × mes con la medida elegida y ficha individual por glosa.
import { useMemo, useState } from 'react'
import {
  agg, combinar, mesesNomina, tableroCentros, fichaCentro, matrizIndicador, matrizPersonas, fichaPersona, subModelo,
  INDICADORES, DIMS_MATRIZ, MEDIDAS_PERSONA, formatoDe, esPct, costoNomina, costoPorFte, div, variacion,
  fM, fmt, fN, fP, fVar, fPts, fEnt, mesCorto, mesSolo, mesTexto, esApoyo, nombreArea,
} from './remDatos'
import { C, Panel, Seg, Tabla, btn, sel, exportar, filasExport, BotonExcel, Spark, colorCalor, tonoSube } from './remUi'

const fmtTend = v => (v == null ? '—' : `${v > 0 ? '↑' : v < 0 ? '↓' : '→'} ${fN(Math.abs(v) * 100, 1)}%/mes`)

// ═══ POR CENTRO ═════════════════════════════════════════════════════════════
export function VistaPorCentro({ m, anio, mes, pBase, filtrarCentro }) {
  const [alcance, setAlcance] = useState('mes')
  const [selC, setSelC] = useState(null)
  const meses = mesesNomina(m, anio)
  const ps = alcance === 'mes' ? [mes] : meses
  const clave = ps.join(',')
  const tablero = useMemo(() => tableroCentros(m, ps, alcance === 'mes' ? pBase : null), [m, clave, pBase]) // eslint-disable-line react-hooks/exhaustive-deps
  const filas = useMemo(() => [...tablero.filter(f => !f.apoyo).sort((a, b) => b.venta - a.venta), ...tablero.filter(f => f.apoyo).sort((a, b) => b.costo - a.costo)], [tablero])
  const centroFicha = selC && m.centros.includes(selC) ? selC : (filas.find(f => f.dot > 0) || filas[0])?.c
  const ficha = useMemo(() => (centroFicha ? fichaCentro(m, anio, centroFicha) : null), [m, anio, centroFicha])
  const A = combinar(ps.map(p => agg(m, p)))
  const sum = k => tablero.reduce((t, f) => t + (f[k] || 0), 0)
  const n = ps.length || 1
  const mbT = tablero.some(f => f.mb == null) ? null : sum('mb'), coT = tablero.some(f => f.contrib == null) ? null : sum('contrib')
  const total = {
    _k: 'total', nombre: m.filtrado ? `Total ${m.filtroNombre.toLowerCase()}` : 'Total centros', dot: A.dotProm, fte: A.fteProm,
    contrat: sum('contrat'), trasIn: sum('trasIn'), desv: sum('desv'), trasOut: sum('trasOut'), costo: costoNomina(A), costoFte: costoPorFte(A),
    variable: div(A.clases.variable || 0, A.haberes), hhee: A.hhee, hheeSB: div(A.hhee, A.sueldoBase), hheeFte: div(A.hhee, A.fte),
    venta: sum('venta'), rem: sum('rem'), contrib: coT, pctVenta: div(sum('rem'), sum('venta')), gmrol: div(mbT, sum('rem')),
    roi: mbT == null ? null : div(mbT - sum('rem'), sum('rem')), ventaFte: div(sum('venta'), A.fteProm * n), contribPct: div(coT, sum('venta')), idxCostoFte: 1, idxHhee: 1,
  }
  const idx = v => (v == null ? '—' : fN(v * 100, 0))
  const tonoIdx = s => v => (v == null ? undefined : s * (v - 1) > 0.1 ? C.rojo : s * (v - 1) < -0.1 ? C.verde : undefined)
  const cols = [
    { k: 'nombre', l: 'Centro', sticky: true }, { k: 'tipo', l: 'Tipo' },
    { k: 'dot', l: alcance === 'mes' ? 'Dotación' : 'Dotación prom.', num: true, f: v => fN(v, alcance === 'mes' ? 0 : 1) },
    { k: 'fte', l: 'FTE', num: true, f: v => fN(v, 1) },
    { k: 'contrat', l: 'Contrat.', num: true, f: v => fN(v) }, { k: 'desv', l: 'Desvinc.', num: true, f: v => fN(v) },
    { k: 'trasIn', l: 'Trasl. entran', num: true, f: v => fN(v) }, { k: 'trasOut', l: 'Trasl. salen', num: true, f: v => fN(v) },
    { k: 'costo', l: 'Costo nómina', num: true, f: fM, negrita: true },
    ...(alcance === 'mes' && pBase ? [{ k: 'dCosto', l: `Δ vs ${mesSolo(pBase)}`, num: true, pct: true, f: v => fVar(v), tono: tonoSube }] : []),
    { k: 'costoFte', l: 'Nómina por FTE', num: true, f: fmt }, { k: 'idxCostoFte', l: 'Índice (empresa = 100)', num: true, f: idx, tono: tonoIdx(1), x: v => (v == null ? '' : Math.round(v * 100)) },
    { k: 'variable', l: '% variable', num: true, pct: true, f: v => fP(v) },
    { k: 'hhee', l: 'Horas extra', num: true, f: fM }, { k: 'hheeSB', l: 'HE / sueldo base', num: true, pct: true, f: v => fP(v), tono: v => (v > 0.15 ? C.rojo : undefined) },
    { k: 'hheeFte', l: 'HE por FTE', num: true, f: fmt }, { k: 'idxHhee', l: 'Índice HE (empresa = 100)', num: true, f: idx, tono: tonoIdx(1), x: v => (v == null ? '' : Math.round(v * 100)) },
    { k: 'venta', l: 'Venta neta', num: true, f: fM }, { k: 'rem', l: 'Costo personal (oficial)', num: true, f: fM },
    { k: 'pctVenta', l: '% venta', num: true, pct: true, f: v => fP(v), negrita: true },
    ...(alcance === 'mes' && pBase ? [{ k: 'dPct', l: `Δ pts vs ${mesSolo(pBase)}`, num: true, f: v => fPts(v), tono: tonoSube }] : []),
    { k: 'ventaFte', l: 'Venta por FTE', num: true, f: fM }, { k: 'gmrol', l: 'Margen por $1', num: true, f: v => (v == null ? '—' : `$${fN(v, 2)}`), tono: v => (v != null && v < 1 ? C.rojo : undefined) },
    { k: 'roi', l: 'ROI', num: true, pct: true, f: v => fP(v, 0) },
    { k: 'contrib', l: 'Contribución', num: true, f: fM, tono: v => (v < 0 ? C.rojo : undefined) }, { k: 'contribPct', l: 'Contrib. / venta', num: true, pct: true, f: v => fP(v) },
  ]
  const fm = ficha ? ficha.meses : []
  const colsF = [
    { k: 'g', l: 'Grupo' }, { k: 'nombre', l: 'Indicador', sticky: true, max: 300 },
    ...fm.map(p => ({ k: p, l: mesSolo(p), num: true, f: (v, r) => formatoDe(r.ind)(v), fondo: (v, r) => colorCalor(v, r.prom, r.ind.s), x: v => v ?? '' })),
    { k: 'anio', l: 'Año', num: true, f: (v, r) => formatoDe(r.ind)(v), negrita: true, x: v => v ?? '' },
    { k: 'tend', l: 'Tendencia', num: true, f: fmtTend, x: v => (v == null ? '' : Math.round(v * 1000) / 10) },
    { k: 'serie', l: '', f: (v, r) => <Spark vals={v} color={r.ind.s > 0 ? C.rojo : r.ind.s < 0 ? C.verde : C.navy} />, x: () => '' },
  ]
  const filasF = ficha ? ficha.filas.map(r => ({ ...r, prom: (() => { const v = r.serie.filter(x => x != null); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : null })() })) : []
  const nomF = centroFicha ? m.nombreCentro(centroFicha) : ''
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Panel titulo={`Centros · ${alcance === 'mes' ? mesTexto(mes) : `año ${anio}`}`} nota="Dotación, nómina y horas extra: liquidaciones del centro. Venta, costo oficial y contribución: resultado por sucursal de Finanzas. Índice 100 = promedio de la empresa. Clic en un centro para ver su ficha mes a mes." sinPad
        acciones={<>
          <Seg valor={alcance} onChange={setAlcance} opciones={[['mes', mesCorto(mes)], ['anio', `Año ${anio}`]]} />
          <BotonExcel onClick={() => exportar(`centros_${alcance === 'mes' ? mes : anio}`, [{ nombre: 'Centros', filas: filasExport(cols, filas, total) }, ...(ficha ? [{ nombre: `Ficha ${nomF}`.slice(0, 31), filas: filasExport(colsF, filasF) }] : [])])} />
        </>}>
        <Tabla cols={cols} filas={filas} total={total} onFila={f => setSelC(f.c)} activa={centroFicha} />
      </Panel>
      {ficha && (
        <Panel titulo={`Ficha de ${nomF} · ${anio}`} nota="Todos los indicadores del centro mes a mes. Color contra el promedio del centro en el año: rojo cuando empeora, verde cuando mejora. Tendencia: pendiente mensual sobre el promedio." sinPad
          acciones={!m.filtrado || m.centros.length > 1 ? <button type="button" style={btn} onClick={() => filtrarCentro(centroFicha)}>Filtrar todo el panel por {nomF}</button> : null}>
          <Tabla cols={colsF} filas={filasF} maxH={640} />
        </Panel>
      )}
    </div>
  )
}

// ═══ MATRIZ ═════════════════════════════════════════════════════════════════
const PRED_DIM = {
  centro: k => x => x.ceco === k,
  funcion: k => x => x.funcion === k,
  centroFuncion: k => { const [c, f] = String(k).split('|'); return x => x.ceco === c && x.funcion === f },
  cargo: k => x => x.cargo === k,
  gerencia: k => x => x.gerencia === k,
  area: k => x => x.area === k,
  gerenciaCentro: k => { const [g, c] = String(k).split('|'); return x => x.gerencia === g && x.ceco === c },
}
export function VistaMatriz({ m, anio, mes, pBase, abrirPersona, filtrarCentro, filtrarArea }) {
  const [indK, setIndK] = useState('costoFte')
  const [dim, setDim] = useState('gerencia')
  const [color, setColor] = useState('fila')
  const [drill, setDrill] = useState(null)
  const res = useMemo(() => matrizIndicador(m, anio, dim, indK), [m, anio, dim, indK])
  const ind = res.ind
  const f = formatoDe(ind)
  const pct = esPct(ind)
  const ref = r => (color === 'fila' ? r.prom : color === 'inicio' ? r.primero : null)
  const delta = r => {
    if (!pBase || !mes || r[pBase] == null || r[mes] == null) return null
    return pct ? r[mes] - r[pBase] : variacion(r[pBase], r[mes])
  }
  const filas = res.filas.map(r => ({ ...r, delta: delta(r) })).sort((a, b) => (b.anio ?? -Infinity) - (a.anio ?? -Infinity))
  const total = { ...res.total, delta: delta(res.total) }
  const indDrill = ind.soloCentro ? INDICADORES.find(i => i.k === 'costo') : ind
  const resDrill = useMemo(() => {
    if (!drill || dim === 'persona' || !PRED_DIM[dim]) return null
    const fila = res.filas.find(r => r.k === drill)
    if (!fila) return null
    return matrizIndicador(subModelo(m, PRED_DIM[dim](drill), fila.nombre), anio, 'persona', indDrill.k)
  }, [m, anio, dim, drill, indDrill.k, res]) // eslint-disable-line react-hooks/exhaustive-deps
  const colsBase = (resMat, fmtV, indV) => [
    ...resMat.meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: v => fmtV(v), fondo: color === 'no' ? undefined : (v, r) => colorCalor(v, ref(r), indV.s), x: v => (v == null ? '' : esPct(indV) ? Math.round(v * 1000) / 10 : Math.round(v * 100) / 100) })),
    { k: 'anio', l: indV.anual === 'suma' ? 'Año' : indV.anual === 'prom' ? 'Promedio' : 'Año', num: true, f: v => fmtV(v), negrita: true, x: v => (v == null ? '' : esPct(indV) ? Math.round(v * 1000) / 10 : Math.round(v * 100) / 100) },
  ]
  const cols = [
    { k: 'nombre', l: DIMS_MATRIZ.find(d => d[0] === dim)[1], sticky: true, max: 260 },
    ...(dim === 'persona' ? [{ k: 'cargo', l: 'Cargo', max: 180 }, { k: 'centro', l: 'Centro' }, { k: 'gerencia', l: 'Gerencia' }] : []),
    ...(dim === 'cargo' ? [{ k: 'funcion', l: 'Función' }] : []),
    ...colsBase(res, f, ind),
    ...(pBase && pBase.startsWith(String(anio)) ? [{ k: 'delta', l: `${mesSolo(mes)} vs ${mesSolo(pBase)}`, num: true, f: v => (pct ? fPts(v) : fVar(v)), tono: v => (v == null || !ind.s ? undefined : ind.s * v > 0 ? C.rojo : ind.s * v < 0 ? C.verde : undefined), x: v => (v == null ? '' : Math.round(v * 1000) / 10) }] : []),
    { k: 'tend', l: 'Tendencia', num: true, f: fmtTend, tono: v => (v == null || !ind.s ? undefined : ind.s * v > 0.01 ? C.rojo : ind.s * v < -0.01 ? C.verde : undefined), x: v => (v == null ? '' : Math.round(v * 1000) / 10) },
    { k: 'serie', l: '', f: v => <Spark vals={v} />, x: () => '' },
  ]
  const grupos = [...new Set(INDICADORES.map(i => i.g))]
  const clicFila = r => {
    if (dim === 'persona') { if (r.cod != null) abrirPersona(r.cod); return }
    setDrill(drill === r.k ? null : r.k)
  }
  const lbl = { fontSize: 11.5, color: C.gris, marginBottom: 4 }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Panel>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><div style={lbl}>Indicador</div>
            <select style={{ ...sel, minWidth: 300 }} value={indK} onChange={e => { setIndK(e.target.value); setDrill(null) }}>
              {grupos.map(g => <optgroup key={g} label={g}>{INDICADORES.filter(i => i.g === g).map(i => <option key={i.k} value={i.k}>{i.l}</option>)}</optgroup>)}
            </select>
          </div>
          <div><div style={lbl}>Filas</div><select style={sel} value={dim} aria-label="Filas de la matriz" onChange={e => { setDim(e.target.value); setDrill(null) }}>{DIMS_MATRIZ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><div style={lbl}>Color</div><Seg valor={color} onChange={setColor} opciones={[['fila', 'Contra su promedio'], ['inicio', 'Contra su primer mes'], ['no', 'Sin color']]} /></div>
        </div>
      </Panel>
      {!res.disponible ? (
        <Panel><div style={{ color: C.gris, fontSize: 12.5 }}>“{ind.l}” usa la venta del centro y solo existe por centro. Elige Filas = Centro.</div></Panel>
      ) : (
        <Panel titulo={`${ind.l} por ${DIMS_MATRIZ.find(d => d[0] === dim)[1].toLowerCase()} · ${anio}`}
          nota={`${ind.anual === 'ratio' ? 'Año y total se recalculan con los componentes, no promediando porcentajes. ' : ''}Color: rojo cuando el valor empeora frente a la referencia de su fila, verde cuando mejora. ${dim === 'persona' ? 'Clic en una persona para ver su ficha.' : 'Clic en una fila para ver las personas que la componen.'}`} sinPad
          acciones={<BotonExcel onClick={() => exportar(`matriz_${indK}_${dim}_${anio}`, [{ nombre: 'Matriz', filas: filasExport(cols, filas, total) }])} />}>
          <Tabla cols={cols} filas={filas} total={total} maxH={dim === 'persona' ? 560 : undefined} onFila={clicFila} activa={drill} vacio="Sin datos para el indicador en el año." />
        </Panel>
      )}
      {resDrill && (
        <Panel titulo={`${resDrill.filas.length} personas · ${res.filas.find(r => r.k === drill)?.nombre}`} nota={`${indDrill.l} por persona y mes${ind.soloCentro ? ' (el indicador elegido usa la venta del centro; por persona se muestra el costo de nómina)' : ''}. Clic para ver la ficha.`} sinPad
          acciones={<>
            {dim === 'centro' && !m.filtrado ? <button type="button" style={btn} onClick={() => filtrarCentro(drill)}>Filtrar el panel por este centro</button> : null}
            {(dim === 'gerencia' || dim === 'area') && filtrarArea ? <button type="button" style={btn} onClick={() => filtrarArea(`${dim === 'gerencia' ? 'g' : 'a'}:${drill}`)}>Filtrar el panel por {nombreArea(`${dim === 'gerencia' ? 'g' : 'a'}:${drill}`)}</button> : null}
            <button type="button" style={btn} onClick={() => setDrill(null)}>Cerrar</button>
          </>}>
          <Tabla cols={[{ k: 'nombre', l: 'Persona', sticky: true, max: 220 }, { k: 'cargo', l: 'Cargo', max: 180 }, { k: 'centro', l: 'Centro' }, ...colsBase(resDrill, formatoDe(indDrill), indDrill), { k: 'tend', l: 'Tendencia', num: true, f: fmtTend }, { k: 'serie', l: '', f: v => <Spark vals={v} />, x: () => '' }]}
            filas={resDrill.filas.sort((a, b) => (b.anio ?? -Infinity) - (a.anio ?? -Infinity))} total={resDrill.total} maxH={420} onFila={r => r.cod != null && abrirPersona(r.cod)} />
        </Panel>
      )}
    </div>
  )
}

// ═══ PERSONAS ═══════════════════════════════════════════════════════════════
export function VistaPersonas({ m, anio, mes, pBase, persona, setPersona }) {
  const [medida, setMedida] = useState('costo')
  const [buscar, setBuscar] = useState('')
  const [fFun, setFFun] = useState('')
  const [fCargo, setFCargo] = useState('')
  const [soloTras, setSoloTras] = useState(false)
  const [fOrg, setFOrg] = useState('todas')
  const res = useMemo(() => matrizPersonas(m, anio, medida, pBase, mes), [m, anio, medida, pBase, mes])
  const ficha = useMemo(() => (persona != null ? fichaPersona(m, persona, anio) : null), [m, persona, anio])
  const cargos = useMemo(() => [...new Set(res.filas.map(r => r.cargo))].sort(), [res])
  const q = buscar.trim().toLowerCase()
  const filas = res.filas.filter(r => (!q || r.nombre.toLowerCase().includes(q) || r.cargo.toLowerCase().includes(q)) && (!fFun || r.funcion === fFun) && (!fCargo || r.cargo === fCargo) && (!soloTras || r.traslados > 0) && (fOrg === 'todas' || (fOrg.startsWith('g:') ? r.gerencia === fOrg.slice(2) : r.area === fOrg.slice(2))))
  const fMed = formatoDe({ f: res.medida[3] })
  const total = { _k: 'total', nombre: `Total (${filas.length} personas)`, anio: res.medida[0] === 'dias' ? null : filas.reduce((t, r) => t + (r.anio || 0), 0) }
  res.meses.forEach(p => { total[p] = res.medida[0] === 'dias' ? null : filas.reduce((t, r) => t + (r[p] || 0), 0) })
  const cols = [
    { k: 'nombre', l: 'Persona', sticky: true, max: 220 }, { k: 'cargo', l: 'Cargo', max: 190 }, { k: 'centro', l: 'Centro' }, { k: 'gerencia', l: 'Gerencia' }, { k: 'area', l: 'Área' }, { k: 'funcion', l: 'Función' },
    { k: 'meses', l: 'Meses', num: true, f: v => fN(v) }, { k: 'traslados', l: 'Cambios de centro', num: true, f: v => (v ? fN(v) : '') },
    ...res.meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: v => (v == null ? '' : fMed(v)) })),
    { k: 'anio', l: res.medida[0] === 'dias' ? 'Promedio' : 'Año', num: true, f: v => fMed(v), negrita: true },
    { k: 'prom', l: 'Promedio mensual', num: true, f: v => fMed(v) },
    ...(pBase ? [{ k: 'dBase', l: `${mesSolo(mes)} − ${mesSolo(pBase)}`, num: true, f: v => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fMed(Math.abs(v))}`), tono: v => (v > 0 && medida !== 'dias' ? C.rojo : undefined) }] : []),
    { k: 'serie', l: '', f: v => <Spark vals={v} />, x: () => '' },
  ]
  const lbl = { fontSize: 11.5, color: C.gris, marginBottom: 4 }
  const fichaCols = ficha ? [
    { k: 'nombre', l: '', sticky: true, max: 300 },
    ...ficha.meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: (v, r) => (v == null ? '' : r.fmtK === 'p1' ? fP(v) : r.fmtK === 'h' ? fN(v, 1) : r.fmtK === 'n' ? fN(v) : r.fmtK === 's' || typeof v !== 'number' ? v : fmt(v)) })),
    { k: 'anio', l: 'Año', num: true, f: (v, r) => (v == null ? '' : r.fmtK === 'p1' ? fP(v) : r.fmtK === 'h' ? fN(v, 1) : r.fmtK === 'n' ? fN(v) : fmt(v)), negrita: true },
  ] : []
  const filasGlosa = ficha ? ficha.haberes.map(h => ({ ...h, nombre: `${h.partidaL} · ${h.glosa}` })) : []
  const filasInfo = ficha ? ficha.info.map(r => ({ ...r, fmtK: r._k === 'dias' ? 'n' : 's' })) : []
  const filasW = ficha ? ficha.workera.map(r => ({ ...r, fmtK: r._k === 'wtope' ? 'n' : 'h' })) : []
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Panel>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><div style={lbl}>Medida</div><Seg valor={medida} onChange={setMedida} opciones={MEDIDAS_PERSONA.map(x => [x[0], x[1]])} /></div>
          <div><div style={lbl}>Buscar</div><input style={{ ...sel, width: 200 }} value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Nombre o cargo" aria-label="Buscar persona" /></div>
          <div><div style={lbl}>Gerencia o área</div><select style={sel} value={fOrg} onChange={e => setFOrg(e.target.value)} aria-label="Gerencia o área"><option value="todas">Todas</option><optgroup label="Gerencia">{(m.gerencias || []).map(x => <option key={x} value={`g:${x}`}>{x}</option>)}</optgroup><optgroup label="Área">{(m.areas || []).map(x => <option key={x} value={`a:${x}`}>{x}</option>)}</optgroup></select></div>
          <div><div style={lbl}>Función</div><select style={sel} value={fFun} onChange={e => setFFun(e.target.value)} aria-label="Función"><option value="">Todas</option>{m.funciones.map(x => <option key={x} value={x}>{x}</option>)}</select></div>
          <div><div style={lbl}>Cargo</div><select style={{ ...sel, maxWidth: 240 }} value={fCargo} onChange={e => setFCargo(e.target.value)} aria-label="Cargo"><option value="">Todos</option>{cargos.map(x => <option key={x} value={x}>{x}</option>)}</select></div>
          <label style={{ fontSize: 12, color: C.gris, display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={soloTras} onChange={e => setSoloTras(e.target.checked)} /> Solo con cambio de centro</label>
        </div>
      </Panel>
      <Panel titulo={`${res.medida[1]} por persona y mes · ${anio}`} nota="Centro, cargo y función del último mes con liquidación. Clic en una persona para ver su ficha por glosa." sinPad
        acciones={<BotonExcel onClick={() => exportar(`personas_${res.medida[0]}_${anio}`, [{ nombre: 'Personas', filas: filasExport(cols, filas, total) }])} />}>
        <Tabla cols={cols} filas={filas} total={total} maxH={520} onFila={r => r.cod != null && setPersona(r.cod)} activa={persona != null ? `p${persona}` : null} vacio="Sin personas para los filtros elegidos." />
      </Panel>
      {persona != null && !ficha && <div style={{ fontSize: 12, color: C.gris }}>La persona elegida no tiene liquidaciones en {anio} dentro del filtro actual.</div>}
      {ficha && (
        <Panel titulo={ficha.nombre} nota={`${ficha.cargo} · ${ficha.gerencia} / ${ficha.area} · ${ficha.funcion} · ${ficha.centro}${ficha.centros.length > 1 ? ` (en el año: ${ficha.centros.join(', ')})` : ''}${ficha.fechaIngreso ? ` · ingreso ${ficha.fechaIngreso}` : ''}`} sinPad
          acciones={<>
            <BotonExcel onClick={() => exportar(`ficha_${ficha.nombre.replace(/\s+/g, '_')}_${anio}`, [{ nombre: 'Haberes por glosa', filas: filasExport(fichaCols, filasGlosa) }, { nombre: 'Resumen', filas: filasExport(fichaCols, ficha.resumen) }, { nombre: 'Datos del mes', filas: filasExport(fichaCols, filasInfo) }])} />
            <button type="button" style={btn} onClick={() => setPersona(null)}>Cerrar</button>
          </>}>
          <div style={{ display: 'grid', gap: 0 }}>
            <div style={{ padding: '8px 14px 4px', fontSize: 12, fontWeight: 600, color: C.navy }}>Haberes por glosa</div>
            <Tabla cols={fichaCols} filas={filasGlosa} />
            <div style={{ padding: '12px 14px 4px', fontSize: 12, fontWeight: 600, color: C.navy }}>Costo, descuentos y líquido</div>
            <Tabla cols={fichaCols} filas={ficha.resumen} />
            <div style={{ padding: '12px 14px 4px', fontSize: 12, fontWeight: 600, color: C.navy }}>Días, centro y cargo</div>
            <Tabla cols={fichaCols} filas={filasInfo} />
            {filasW.length > 0 && (<>
              <div style={{ padding: '12px 14px 4px', fontSize: 12, fontWeight: 600, color: C.navy }}>Horas extra (período de pago 26–25)</div>
              <Tabla cols={fichaCols} filas={filasW} />
            </>)}
          </div>
        </Panel>
      )}
    </div>
  )
}
