// src/rrhh/remuneraciones/PanelDotacionCosto.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Panel de dotación y costo de personal (Personas → Remuneraciones → Reportes).
// Fusiona el Panel de remuneraciones y el Análisis comparativo (nov-2026). Todas
// las cifras salen de remDatos.js, la misma capa del Informe mensual.
// v2 (nov-2026): filtro global por centro de costo que aplica a todas las vistas,
// vistas cruzadas (Por centro, Matriz, Personas), traslados entre centros,
// contribución por centro y fichas de centro y persona.
// v3 (nov-2026): filtro global por gerencia o área del organigrama y desglose por área.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import {
  cargarDatos, cargarWorkera, construirModelo, filtrarModelo, mesesNomina, periodoBase, nombreFiltro, nombreArea,
  fM, fP, mesCorto, mesLargo, mesTexto, perAnioAnterior, esApoyo,
} from './remDatos'
import { C, Seg, btn, sel, Vacio, lsGet, lsSet } from './remUi'
import { VistaResumen, VistaDotacion, VistaCosto, VistaHhee, VistaRoi } from './VistasPanel'
import { VistaPorCentro, VistaMatriz, VistaPersonas } from './VistasCruce'
import { ExploradorRem } from './ExploradorRem'

const VISTAS = [
  ['resumen', 'Resumen'], ['centros', 'Por centro'], ['matriz', 'Matriz'], ['dotacion', 'Dotación'], ['costo', 'Costo'],
  ['hhee', 'Horas extra'], ['roi', 'Productividad y ROI'], ['personas', 'Personas'], ['explorador', 'Explorador'],
]

export function PanelDotacionCosto({ cu, vistaInicial }) {
  const [raw, setRaw] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [recarga, setRecarga] = useState(0)
  const [vista, setVista] = useState(() => vistaInicial || lsGet('rrhh_panel_vista', 'resumen'))
  const [conSocios, setConSocios] = useState(true)
  const [filtro, setFiltro] = useState(() => lsGet('rrhh_panel_centro', 'todos'))
  const [filtroArea, setFiltroArea] = useState(() => lsGet('rrhh_panel_area', 'todas'))
  const [anio, setAnio] = useState(null)
  const [mes, setMes] = useState(null)
  const [base, setBase] = useState(() => lsGet('rrhh_panel_base', 'inicio'))
  const [persona, setPersona] = useState(null)

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
  useEffect(() => { lsSet('rrhh_panel_centro', filtro) }, [filtro])
  useEffect(() => { lsSet('rrhh_panel_area', filtroArea) }, [filtroArea])

  const modeloBase = useMemo(() => (raw ? construirModelo(raw, conSocios) : null), [raw, conSocios])
  // Centros con nómina: los únicos que tiene sentido filtrar.
  const opcionesCentro = useMemo(() => (modeloBase ? modeloBase.centros.filter(c => modeloBase.periodos.some(p => modeloBase.centro.get(p)?.has(c))) : []), [modeloBase])
  const filtroOk = !filtro || filtro === 'todos' || filtro === 'tiendas' || filtro === 'apoyo' || opcionesCentro.includes(filtro) ? filtro : 'todos'
  const filtroAreaOk = modeloBase && filtroArea && filtroArea !== 'todas' && ((filtroArea.startsWith('g:') && modeloBase.gerencias.includes(filtroArea.slice(2))) || (filtroArea.startsWith('a:') && modeloBase.areas.includes(filtroArea.slice(2)))) ? filtroArea : 'todas'
  const m = useMemo(() => (modeloBase ? filtrarModelo(modeloBase, filtroOk, filtroAreaOk) : null), [modeloBase, filtroOk, filtroAreaOk])
  const anios = useMemo(() => (modeloBase ? [...new Set(modeloBase.periodos.map(p => p.slice(0, 4)))] : []), [modeloBase])
  useEffect(() => { if (anios.length && (!anio || !anios.includes(anio))) setAnio(anios[anios.length - 1]) }, [anios]) // eslint-disable-line react-hooks/exhaustive-deps
  const meses = useMemo(() => (m && anio ? mesesNomina(m, anio) : []), [m, anio])
  useEffect(() => { if (meses.length && (!mes || !meses.includes(mes))) setMes(meses[meses.length - 1]) }, [meses]) // eslint-disable-line react-hooks/exhaustive-deps
  const pBase = useMemo(() => (m && mes ? periodoBase(m, anio, mes, base) : null), [m, anio, mes, base])

  if (cargando && !raw) return <div style={{ padding: 60, textAlign: 'center', color: C.gris, fontSize: 13 }}>Cargando liquidaciones, libro mayor y resultado por centro…</div>
  if (error && !raw) return <Vacio titulo="No se pudo cargar el panel" texto={error} accion={<button type="button" style={btn} onClick={() => setRecarga(x => x + 1)}>Reintentar</button>} />
  if (!m || !modeloBase) return null
  if (!modeloBase.periodos.length) return <Vacio titulo="Sin liquidaciones cargadas" texto="Carga las liquidaciones del mes en Remuneraciones → Cargar liquidaciones." />
  if (!anio) return null

  const vistaOk = VISTAS.some(v => v[0] === vista) ? vista : 'resumen'
  const mesOk = mes && meses.includes(mes) ? mes : null
  const hayAnioAnt = !!mesOk && (m.tot.has(perAnioAnterior(mesOk)) || m.eerr.has(perAnioAnterior(mesOk)))
  const ultCerrado = [...modeloBase.eerr.entries()].filter(([, v]) => !v.enCurso).map(([p]) => p).sort().pop()
  const lbl = { fontSize: 12, color: C.gris, display: 'inline-flex', alignItems: 'center', gap: 6 }
  const filtrarCentro = c => { setFiltro(c || 'todos'); setPersona(null) }
  const filtrarArea = a => { setFiltroArea(a || 'todas'); setPersona(null) }
  const abrirPersona = cod => { if (cod == null) return; setPersona(cod); setVista('personas') }
  const props = { m, anio, mes: mesOk, pBase, irA: setVista, filtrarCentro, filtrarArea, abrirPersona, persona, setPersona }
  const tiendas = opcionesCentro.filter(c => !esApoyo(c)), apoyo = opcionesCentro.filter(c => esApoyo(c))

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.navy, letterSpacing: -0.2 }}>Dotación y costo de personal{m.filtrado ? ` · ${m.filtroNombre}` : ''}</h2>
          <div style={{ fontSize: 12, color: C.gris, marginTop: 3 }}>
            Nómina de {mesCorto(modeloBase.periodos[0])} a {mesCorto(modeloBase.periodos[modeloBase.periodos.length - 1])} · libro mayor hasta {ultCerrado ? mesCorto(ultCerrado) : '—'}
            {modeloBase.calidad.workeraDesde ? ` · Workera desde ${mesCorto(modeloBase.calidad.workeraDesde)}` : ''}{m.verSocios && !m.conSocios ? ' · sin socios' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={lbl}>Centro
            <select aria-label="Centro" style={{ ...sel, fontWeight: filtroOk !== 'todos' ? 600 : 400, color: filtroOk !== 'todos' ? C.navy : undefined }} value={filtroOk} onChange={e => filtrarCentro(e.target.value)}>
              <option value="todos">Todos los centros</option>
              {tiendas.length > 1 && <option value="tiendas">Solo tiendas</option>}
              {apoyo.length > 0 && <option value="apoyo">CD y administración</option>}
              <optgroup label="Centro">{opcionesCentro.map(c => <option key={c} value={c}>{modeloBase.nombreCentro(c)}</option>)}</optgroup>
            </select>
          </label>
          <label style={lbl}>Área
            <select aria-label="Área" style={{ ...sel, fontWeight: filtroAreaOk !== 'todas' ? 600 : 400, color: filtroAreaOk !== 'todas' ? C.navy : undefined }} value={filtroAreaOk} onChange={e => filtrarArea(e.target.value)}>
              <option value="todas">Todas las áreas</option>
              <optgroup label="Gerencia">{modeloBase.gerencias.map(g => <option key={g} value={`g:${g}`}>{g}</option>)}</optgroup>
              <optgroup label="Área">{modeloBase.areas.map(a => <option key={a} value={`a:${a}`}>{a}</option>)}</optgroup>
            </select>
          </label>
          <label style={lbl}>Año
            <select style={sel} value={anio} onChange={e => setAnio(e.target.value)}>{anios.map(y => <option key={y} value={y}>{y}</option>)}</select>
          </label>
          <label style={lbl}>Mes
            <select style={sel} value={mesOk || ''} onChange={e => setMes(e.target.value)} disabled={!meses.length}>{meses.map(p => <option key={p} value={p}>{mesLargo(p)}</option>)}</select>
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

      {m.filtrado && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: '#EEF2F8', border: `1px solid #D5DEEC`, borderRadius: 7, fontSize: 12.5, color: C.navy }}>
          <span>Viendo solo <b>{m.filtroNombre}</b>: {m.porArea ? 'dotación, nómina y horas extra de sus liquidaciones. El costo es la nómina del área (haberes, aportes estimados y honorarios) y la venta, la del alcance como referencia; margen, ROI y contribución no se asignan a áreas.' : 'dotación, nómina y horas extra de sus liquidaciones; venta, costo oficial prorrateado y contribución del resultado por sucursal.'}</span>
          <button type="button" style={{ ...btn, padding: '3px 10px', marginLeft: 'auto' }} onClick={() => { filtrarCentro('todos'); filtrarArea('todas') }}>Quitar filtros</button>
        </div>
      )}

      <nav style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${C.borde}`, overflowX: 'auto' }}>
        {VISTAS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setVista(k)} aria-current={vistaOk === k ? 'page' : undefined}
            style={{ padding: '8px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: vistaOk === k ? 600 : 500, color: vistaOk === k ? C.navy : C.gris, borderBottom: `2px solid ${vistaOk === k ? C.navy : 'transparent'}`, marginBottom: -1, whiteSpace: 'nowrap' }}>{l}</button>
        ))}
      </nav>

      {!mesOk ? (
        <Vacio titulo={`Sin liquidaciones de ${m.filtroNombre} en ${anio}`} texto="Elige otro año, centro o área." accion={m.filtrado ? <button type="button" style={btn} onClick={() => { filtrarCentro('todos'); filtrarArea('todas') }}>Quitar filtros</button> : null} />
      ) : (<>
        <Calidad m={m} mes={mesOk} />
        {vistaOk === 'resumen' && <VistaResumen {...props} />}
        {vistaOk === 'centros' && <VistaPorCentro {...props} />}
        {vistaOk === 'matriz' && <VistaMatriz {...props} />}
        {vistaOk === 'dotacion' && <VistaDotacion {...props} />}
        {vistaOk === 'costo' && <VistaCosto {...props} />}
        {vistaOk === 'hhee' && <VistaHhee {...props} />}
        {vistaOk === 'roi' && <VistaRoi {...props} />}
        {vistaOk === 'personas' && <VistaPersonas {...props} />}
        {vistaOk === 'explorador' && <ExploradorRem m={m} anio={anio} />}
      </>)}
    </div>
  )
}

// Avisos de calidad de datos del mes: sin ellos el número no se puede defender.
function Calidad({ m, mes }) {
  const notas = []
  m.calidad.errores.forEach(e => notas.push({ c: C.rojo, t: `No se pudo leer ${e.fuente}: ${e.error}` }))
  const sl = m.calidad.sinLineas.get(mes)
  if (sl && !m.filtrado) notas.push({ c: C.ambar, t: `${sl} liquidación${sl > 1 ? 'es' : ''} de ${mesTexto(mes)} sin detalle de líneas y sin haberes: cuentan en la dotación con 0 FTE.` })
  if (m.calidad.sinMapeo.size) notas.push({ c: C.ambar, t: `Centros sin mapeo en ceco_alias, cargados a Administración central: ${[...m.calidad.sinMapeo.entries()].map(([t, n]) => `${t} (${n})`).join(', ')}.` })
  if (m.calidad.sinFuncion) notas.push({ c: C.ambar, t: `${m.calidad.sinFuncion} liquidaciones de personas sin cuenta madre en el maestro de empleados.` })
  const vs = m.calidad.ventaSinCentro.get(mes)
  if (vs) notas.push({ c: C.ambar, t: `Venta de ${mesTexto(mes)} sin centro: ${fM(vs.oficial - vs.centros)} (por centro suma ${fM(vs.centros)}; el libro mayor, ${fM(vs.oficial)}). Afecta la venta y el % sobre venta de los centros.` })
  const ms = m.calidad.margenSinCuadre?.get(mes)
  if (ms) notas.push({ c: C.rojo, t: `Margen por centro de ${mesTexto(mes)} no cuadra con el libro mayor (centros ${fM(ms.centros)}; libro ${fM(ms.oficial)}): falta el costo de venta por centro. Margen, ROI y contribución por centro de ese mes quedan sin dato.` })
  const ma = m.calidad.metodoArea || {}, tma = Object.values(ma).reduce((s, x) => s + x, 0), pc = k => fP(tma ? (ma[k] || 0) / tma : null, 0)
  if (tma > 0) notas.push({ c: tma && (ma.cuenta || 0) / tma > 0.05 ? C.ambar : C.tenue, t: `Gerencia y área del organigrama: ${pc('vigente')} del costo con el cargo vigente del mes, ${pc('cercana')} con la asignación más cercana (meses antes de julio), ${pc('cargo')} por su cargo de liquidación y ${pc('cuenta')} por cuenta madre.` })
  notas.push({ c: C.tenue, t: 'Aportes patronales del detalle: estimados con tasas vigentes. El costo oficial (libro mayor) usa el pago real.' })
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 18px', fontSize: 11.5, lineHeight: 1.4 }}>
      {notas.map((n, i) => <span key={i} style={{ color: n.c }}>{n.t}</span>)}
    </div>
  )
}
