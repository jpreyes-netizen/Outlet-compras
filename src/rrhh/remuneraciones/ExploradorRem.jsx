// src/rrhh/remuneraciones/ExploradorRem.jsx
// v3 (nov-2026): agrupación por gerencia y área del organigrama.
// Explorador libre de la nómina (reemplaza al Análisis comparativo, nov-2026).
// Correcciones respecto de la versión anterior:
//  · "Todo" sumaba haberes y descuentos en un mismo total: ahora se elige una medida.
//  · La variación comparaba el primer y el último período elegido aunque no fueran
//    consecutivos: ahora hay dos columnas explícitas (mes anterior y primer→último).
//  · El centro sale de la liquidación de cada mes, no de la ficha actual.
//  · Exporta a Excel y ordena por cualquier columna.
import { useEffect, useMemo, useState } from 'react'
import { mesesNomina, mesSolo, mesCorto, perAnterior, partidaL, tipoHheeL, fmt, fN, fP, fVar, div, variacion } from './remDatos'
import { C, Panel, Seg, Tabla, btn, sel, exportar, filasExport, BotonExcel } from './remUi'

const DIMS = [['partida', 'Partida'], ['glosa', 'Glosa'], ['tipoHhee', 'Tipo de hora extra'], ['gerencia', 'Gerencia'], ['area', 'Área'], ['centro', 'Centro'], ['funcion', 'Función'], ['cargo', 'Cargo'], ['trabajador', 'Trabajador']]
const MEDIDAS = [['costo', 'Costo empresa'], ['haberes', 'Haberes'], ['descuentos', 'Descuentos']]
const NAT = {
  costo: ['haber_imponible', 'haber_no_imponible', 'aporte', 'honorario'],
  haberes: ['haber_imponible', 'haber_no_imponible', 'honorario'],
  descuentos: ['descuento_legal', 'descuento_interno'],
}
const DESC_L = { afp: 'AFP', salud: 'Salud', impuesto: 'Impuesto único', cesantia: 'Seguro de cesantía', anticipo: 'Anticipos', prestamo: 'Préstamos', descuento_interno: 'Descuentos internos', ccaf: 'CCAF', sin_mapear_desc: 'Descuentos sin mapear' }

export function ExploradorRem({ m, anio }) {
  const meses = useMemo(() => mesesNomina(m, anio), [m, anio])
  const [medida, setMedida] = useState('costo')
  const [dim, setDim] = useState('partida')
  const [modo, setModo] = useState('pivote')
  const [fCentro, setFCentro] = useState([])
  const [fFuncion, setFFuncion] = useState([])
  const [perA, setPerA] = useState(meses[meses.length - 2] || meses[0])
  const [perB, setPerB] = useState(meses[meses.length - 1])
  const [drill, setDrill] = useState(null)
  useEffect(() => { setPerA(meses[meses.length - 2] || meses[0]); setPerB(meses[meses.length - 1]) }, [meses])
  useEffect(() => { setDrill(null) }, [dim, medida, modo, fCentro, fFuncion, anio, perA, perB])

  const dimL = DIMS.find(d => d[0] === dim)[1]
  const clave = l => {
    if (dim === 'partida') return l.naturaleza?.startsWith('descuento') ? (DESC_L[l.partida] || l.partida) : partidaL(l.partida)
    if (dim === 'tipoHhee') return tipoHheeL(l.tipoHhee)
    if (dim === 'centro') return m.nombreCentro(l.ceco)
    return l[dim] || 'Sin dato'
  }
  const ps = modo === 'pivote' ? meses : [...new Set([perA, perB])].filter(Boolean)
  const base = useMemo(() => m.lineas.filter(l => {
    if (!NAT[medida].includes(l.naturaleza)) return false
    if (dim === 'tipoHhee' && !l.tipoHhee) return false
    if (fCentro.length && !fCentro.includes(l.ceco)) return false
    if (fFuncion.length && !fFuncion.includes(l.funcion)) return false
    return ps.includes(l.periodo)
  }), [m, medida, dim, fCentro, fFuncion, ps.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const { filas, total } = useMemo(() => {
    const mapa = new Map()
    for (const l of base) {
      const k = clave(l)
      let r = mapa.get(k)
      if (!r) { r = { _k: k, clave: k, total: 0 }; mapa.set(k, r) }
      r[l.periodo] = (r[l.periodo] || 0) + l.monto
      r.total += l.monto
    }
    const gran = [...mapa.values()].reduce((t, r) => t + r.total, 0)
    const pN = meses[meses.length - 1], pPrev = meses[meses.length - 2], p0 = meses[0]
    const consecutivo = pPrev && perAnterior(pN) === pPrev
    const arr = [...mapa.values()].map(r => {
      if (modo === 'pivote') return { ...r, varMes: consecutivo ? variacion(r[pPrev] || 0, r[pN] || 0) : null, varAnio: variacion(r[p0] || 0, r[pN] || 0), share: div(r.total, gran) }
      const a = r[perA] || 0, b = r[perB] || 0
      return { ...r, a, b, dif: b - a, var: variacion(a, b), estado: a === 0 && b > 0 ? 'Nuevo' : b === 0 && a > 0 ? 'Sale' : '' }
    }).sort((x, y) => (modo === 'pivote' ? y.total - x.total : Math.abs(y.dif) - Math.abs(x.dif)))
    const t = { _k: 'total', clave: 'Total' }
    if (modo === 'pivote') {
      meses.forEach(p => { t[p] = arr.reduce((s, r) => s + (r[p] || 0), 0) })
      Object.assign(t, { total: gran, varMes: consecutivo ? variacion(t[pPrev], t[pN]) : null, varAnio: variacion(t[p0], t[pN]), share: 1 })
    } else {
      const a = arr.reduce((s, r) => s + r.a, 0), b = arr.reduce((s, r) => s + r.b, 0)
      Object.assign(t, { a, b, dif: b - a, var: variacion(a, b) })
    }
    return { filas: arr, total: t }
  }, [base, modo, meses, perA, perB]) // eslint-disable-line react-hooks/exhaustive-deps

  const pN = meses[meses.length - 1], pPrev = meses[meses.length - 2], p0 = meses[0]
  const tonoCosto = v => (v == null ? undefined : medida === 'descuentos' ? undefined : v > 0.005 ? C.rojo : v < -0.005 ? C.verde : undefined)
  const cols = modo === 'pivote' ? [
    { k: 'clave', l: dimL, sticky: true, max: 280 },
    ...meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: v => (v ? fN(v) : '') })),
    { k: 'total', l: 'Total año', num: true, f: fmt, negrita: true },
    { k: 'varMes', l: pPrev ? `${mesSolo(pPrev)}→${mesSolo(pN)}` : 'Var. mes', num: true, pct: true, f: v => fVar(v), tono: tonoCosto },
    { k: 'varAnio', l: p0 && pN && p0 !== pN ? `${mesSolo(p0)}→${mesSolo(pN)}` : 'Var. año', num: true, pct: true, f: v => fVar(v), tono: tonoCosto },
    { k: 'share', l: '% del total', num: true, pct: true, f: v => fP(v) },
  ] : [
    { k: 'clave', l: dimL, sticky: true, max: 280 },
    { k: 'a', l: mesCorto(perA), num: true, f: fmt }, { k: 'b', l: mesCorto(perB), num: true, f: fmt, negrita: true },
    { k: 'dif', l: 'Diferencia', num: true, f: v => (v ? `${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}` : '—'), tono: v => (medida === 'descuentos' || !v ? undefined : v > 0 ? C.rojo : C.verde) },
    { k: 'var', l: 'Variación', num: true, pct: true, f: v => fVar(v), tono: tonoCosto },
    { k: 'estado', l: '' },
  ]
  const lineasDrill = drill ? base.filter(l => clave(l) === drill).sort((a, b) => a.periodo.localeCompare(b.periodo) || b.monto - a.monto) : []
  const colsDrill = [
    { k: 'periodo', l: 'Mes', f: v => mesCorto(v) }, { k: 'trabajador', l: 'Persona', max: 220 }, { k: 'cargo', l: 'Cargo', max: 200 },
    { k: 'ceco', l: 'Centro', f: v => m.nombreCentro(v) }, { k: 'gerencia', l: 'Gerencia' }, { k: 'funcion', l: 'Función' }, { k: 'glosa', l: 'Glosa', max: 260 },
    { k: 'tipoHhee', l: 'Tipo de hora extra', f: v => (v ? tipoHheeL(v) : '') }, { k: 'monto', l: 'Monto', num: true, f: fmt },
  ]
  const tog = (arr, set, v) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v])
  const chip = act => ({ ...btn, padding: '3px 9px', fontSize: 11.5, fontWeight: 500, background: act ? C.navy : '#fff', color: act ? '#fff' : C.texto, borderColor: act ? C.navy : C.borde })
  const lbl = { fontSize: 11.5, color: C.gris, marginBottom: 4 }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Panel>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div><div style={lbl}>Vista</div><Seg valor={modo} onChange={setModo} opciones={[['pivote', 'Pivote del año'], ['comparar', 'Comparar dos meses']]} /></div>
          <div><div style={lbl}>Medida</div><Seg valor={medida} onChange={setMedida} opciones={MEDIDAS} /></div>
          <div><div style={lbl}>Agrupar por</div>
            <select style={sel} value={dim} onChange={e => setDim(e.target.value)}>{DIMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
          {modo === 'comparar' && (
            <div><div style={lbl}>Meses</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select style={sel} value={perA || ''} onChange={e => setPerA(e.target.value)} aria-label="Mes base">{meses.map(p => <option key={p} value={p}>{mesCorto(p)}</option>)}</select>
                <span style={{ color: C.gris }}>→</span>
                <select style={sel} value={perB || ''} onChange={e => setPerB(e.target.value)} aria-label="Mes a comparar">{meses.map(p => <option key={p} value={p}>{mesCorto(p)}</option>)}</select>
                <button type="button" style={btn} onClick={() => { const x = perA; setPerA(perB); setPerB(x) }} title="Intercambiar meses">⇄</button>
              </div>
            </div>
          )}
          <div><div style={lbl}>Centro</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 520 }}>{m.centros.map(c => <button key={c} type="button" style={chip(fCentro.includes(c))} onClick={() => tog(fCentro, setFCentro, c)}>{m.nombreCentro(c)}</button>)}</div>
          </div>
          <div><div style={lbl}>Función</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{m.funciones.map(f => <button key={f} type="button" style={chip(fFuncion.includes(f))} onClick={() => tog(fFuncion, setFFuncion, f)}>{f}</button>)}</div>
          </div>
          {(fCentro.length > 0 || fFuncion.length > 0) && <button type="button" style={{ ...btn, color: C.rojo, alignSelf: 'flex-end' }} onClick={() => { setFCentro([]); setFFuncion([]) }}>Limpiar filtros</button>}
        </div>
      </Panel>
      <Panel titulo={modo === 'pivote' ? `${MEDIDAS.find(x => x[0] === medida)[1]} por ${dimL.toLowerCase()} · ${anio}` : `${mesCorto(perA)} contra ${mesCorto(perB)} por ${dimL.toLowerCase()}`}
        nota="Haz clic en una fila para ver las líneas de liquidación que la componen. Los aportes patronales son estimados." sinPad
        acciones={<BotonExcel onClick={() => exportar(`explorador_${medida}_${dim}_${anio}`, [{ nombre: 'Explorador', filas: filasExport(cols, filas, total) }, ...(drill ? [{ nombre: 'Detalle', filas: filasExport(colsDrill, lineasDrill) }] : [])])} />}>
        <Tabla cols={cols} filas={filas} total={total} maxH={560} onFila={r => setDrill(drill === r._k ? null : r._k)} activa={drill} vacio="Sin líneas para los filtros elegidos." />
      </Panel>
      {drill && (
        <Panel titulo={`Detalle: ${drill}`} nota={`${lineasDrill.length} líneas · ${fmt(lineasDrill.reduce((t, l) => t + l.monto, 0))}`} sinPad
          acciones={<button type="button" style={btn} onClick={() => setDrill(null)}>Cerrar</button>}>
          <Tabla cols={colsDrill} filas={lineasDrill.map((l, i) => ({ ...l, _k: i }))} maxH={380} />
        </Panel>
      )}
    </div>
  )
}
