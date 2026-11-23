// src/rrhh/RemuneracionesInforme.jsx
// Informe de dotación y costo de personal (documento imprimible, mes o año, empresa
// o un centro). Usa la misma capa de datos que el Panel de dotación y costo.
// v1 (nov-2026) corrigió: "Totalizado año" sumaba todos los períodos cargados; la
// dotación contaba las boletas como una persona; los totales venían de una vista
// sin filtro de socios; el centro venía de la ficha actual; el pie citaba el SOP P07.
// v2 (nov-2026): informe por centro, traslados entre centros, contribución por centro
// y cruces centro × mes en el modo anual.
import { useEffect, useMemo, useState } from 'react'
import {
  cargarDatos, construirModelo, filtrarModelo, nombreFiltro, nombreArea, agg, aggCentro, aggFuncion, aggArea, aggGerencia, combinar, mesesNomina, filasMensuales, filasCentros,
  hallazgos, movimientos, costoNomina, costoPorFte, div, variacion, fM, fmt, fN, fP, fVar, fPts, fEnt, fPesos,
  mesCorto, mesSolo, mesLargo, mesTexto, perAnterior, partidaL, TIPOS_HHEE, esApoyo,
} from './remuneraciones/remDatos'

const NAVY = '#16213E', GRIS = '#6B7280', BORDE = '#E5E7EB', ROJO = '#B42318', VERDE = '#1E7A44'

export function RemuneracionesInforme({ cu }) {
  const [raw, setRaw] = useState(null)
  const [error, setError] = useState(null)
  const [conSocios, setConSocios] = useState(true)
  const [filtro, setFiltro] = useState('todos')
  const [filtroArea, setFiltroArea] = useState('todas')
  const [anio, setAnio] = useState(null)
  const [modo, setModo] = useState('mes')
  const [mes, setMes] = useState(null)

  useEffect(() => {
    let vivo = true
    cargarDatos(cu).then(r => { if (vivo) setRaw(r) }, e => { if (vivo) setError(e?.message || String(e)) })
    return () => { vivo = false }
  }, [cu?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => (raw ? construirModelo(raw, conSocios) : null), [raw, conSocios])
  const opciones = useMemo(() => (base ? base.centros.filter(c => base.periodos.some(p => base.centro.get(p)?.has(c))) : []), [base])
  const m = useMemo(() => (base ? filtrarModelo(base, filtro, filtroArea) : null), [base, filtro, filtroArea])
  const anios = useMemo(() => (base ? [...new Set(base.periodos.map(p => p.slice(0, 4)))] : []), [base])
  useEffect(() => { if (anios.length && (!anio || !anios.includes(anio))) setAnio(anios[anios.length - 1]) }, [anios]) // eslint-disable-line react-hooks/exhaustive-deps
  const meses = useMemo(() => (m && anio ? mesesNomina(m, anio) : []), [m, anio])
  useEffect(() => { if (meses.length && (!mes || !meses.includes(mes))) setMes(meses[meses.length - 1]) }, [meses]) // eslint-disable-line react-hooks/exhaustive-deps
  const d = useMemo(() => (m && anio && mes && meses.includes(mes) ? armarInforme(m, anio, modo, mes) : null), [m, anio, modo, mes, meses])

  if (error) return <div style={{ padding: 60, textAlign: 'center', color: ROJO }}>No se pudo cargar el informe: {error}</div>
  if (!m) return <div style={{ padding: 60, textAlign: 'center', color: GRIS }}>Cargando informe…</div>
  if (!base.periodos.length) return <div style={{ padding: 60, textAlign: 'center', color: GRIS }}>Sin liquidaciones cargadas. Carga las del mes en Remuneraciones → Cargar liquidaciones.</div>

  const ctl = { padding: '6px 10px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', fontSize: 12.5 }
  const seg = act => ({ padding: '6px 12px', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: act ? NAVY : 'transparent', color: act ? '#fff' : GRIS })
  const colsOrg = t => [{ k: 'nombre', l: t }, { k: 'dot', l: d && d.anual ? 'Dotación prom.' : 'Dotación', num: true, f: v => fN(v, d && d.anual ? 1 : 0) }, { k: 'fte', l: d && d.anual ? 'FTE prom.' : 'FTE', num: true, f: v => fN(v, 1) }, { k: 'costo', l: 'Costo de nómina', num: true, f: fM }, { k: 'share', l: '% del costo', num: true, f: v => fP(v) }, { k: 'pctVenta', l: '% de la venta', num: true, f: v => fP(v) }, { k: 'costoFte', l: 'Nómina por FTE', num: true, f: fmt }, { k: 'hhee', l: 'Horas extra', num: true, f: fM }]
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', background: '#F7F8FA', border: `1px solid ${BORDE}`, borderRadius: 7, padding: 2, gap: 2 }}>
            <button type="button" style={seg(modo === 'mes')} onClick={() => setModo('mes')}>Mes</button>
            <button type="button" style={seg(modo === 'anio')} onClick={() => setModo('anio')}>Acumulado del año</button>
          </div>
          <select style={ctl} value={filtro} onChange={e => setFiltro(e.target.value)} aria-label="Centro">
            <option value="todos">Empresa completa</option>
            {opciones.filter(c => !esApoyo(c)).length > 1 && <option value="tiendas">Solo tiendas</option>}
            {opciones.map(c => <option key={c} value={c}>{base.nombreCentro(c)}</option>)}
          </select>
          <select style={ctl} value={filtroArea} onChange={e => setFiltroArea(e.target.value)} aria-label="Área">
            <option value="todas">Todas las áreas</option>
            <optgroup label="Gerencia">{base.gerencias.map(g => <option key={g} value={`g:${g}`}>{g}</option>)}</optgroup>
            <optgroup label="Área">{base.areas.map(a => <option key={a} value={`a:${a}`}>{a}</option>)}</optgroup>
          </select>
          <select style={ctl} value={anio || ''} onChange={e => setAnio(e.target.value)} aria-label="Año">{anios.map(y => <option key={y} value={y}>{y}</option>)}</select>
          {modo === 'mes' && <select style={ctl} value={mes || ''} onChange={e => setMes(e.target.value)} aria-label="Mes">{meses.map(p => <option key={p} value={p}>{mesLargo(p)}</option>)}</select>}
          {m.verSocios && <label style={{ fontSize: 12.5, color: GRIS, display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={conSocios} onChange={e => setConSocios(e.target.checked)} />Incluir socios</label>}
        </div>
        <button type="button" onClick={() => window.print()} style={{ padding: '7px 14px', background: NAVY, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>Imprimir o guardar PDF</button>
      </div>

      {!d ? <div style={{ padding: 40, textAlign: 'center', color: GRIS }}>Sin liquidaciones de {nombreFiltro(base, filtro)} en {anio}.</div> : (
        <div id="informe-rem" style={{ background: '#fff', color: '#1C1C1E', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ background: NAVY, color: '#fff', padding: '22px 32px', display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Outlet de Puertas SpA · Gestión de Personas</div>
              <h1 style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 700 }}>Informe de dotación y costo de personal</h1>
              <div style={{ fontSize: 14, opacity: 0.9, marginTop: 4 }}>{m.filtrado ? `${m.filtroNombre} · ` : ''}{d.titulo}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11.5, opacity: 0.75, lineHeight: 1.6 }}>
              <div>Emitido el {new Date().toLocaleDateString('es-CL')}</div>
              <div>{cu?.nombre || ''}</div>
              {m.verSocios && !m.conSocios && <div>Sin remuneración de socios</div>}
            </div>
          </div>

          <div style={{ padding: '6px 32px 28px' }}>
            <Sec t="Resumen ejecutivo" />
            <TablaDoc cols={[
              { k: 'l', l: 'Indicador' },
              { k: 'a', l: d.etiquetaA, num: true, f: (v, r) => r.f(v) },
              ...(d.comp ? [{ k: 'b', l: d.etiquetaB, num: true, f: (v, r) => r.f(v) }, { k: 'var', l: 'Variación', num: true, f: (v, r) => r.fv, tono: (v, r) => r.tono }] : []),
            ]} filas={d.resumen} />
            {d.hall.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: NAVY, marginBottom: 4 }}>Observaciones</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55 }}>{d.hall.map((h, i) => <li key={i}>{h.texto}</li>)}</ul>
              </div>
            )}

            <Sec t="Dotación y costo de nómina por centro" />
            <TablaDoc cols={[
              { k: 'nombre', l: 'Centro' }, { k: 'dot', l: d.anual ? 'Dotación prom.' : 'Dotación', num: true, f: v => fN(v, d.anual ? 1 : 0) },
              { k: 'fte', l: d.anual ? 'FTE prom.' : 'FTE', num: true, f: v => fN(v, 1) },
              { k: 'contrat', l: 'Contrat.', num: true, f: v => fN(v) }, { k: 'tras', l: 'Traslados (entran / salen)', num: true, f: (v, r) => `${fN(r.trasIn)} / ${fN(r.trasOut)}` },
              { k: 'desv', l: 'Desvinc.', num: true, f: v => fN(v) }, { k: 'costo', l: 'Costo de nómina', num: true, f: fM },
              { k: 'costoFte', l: 'Nómina por FTE', num: true, f: fmt }, { k: 'share', l: '% del costo', num: true, f: v => fP(v) },
            ]} filas={d.centros} total={d.totCentros} />
            {d.salFicha > 0 && <Nota>Salidas del último mes cargado según la fecha de egreso de la ficha ({d.salFicha}); se confirman con la nómina del mes siguiente.</Nota>}

            <Sec t="Por función" />
            <TablaDoc cols={[
              { k: 'nombre', l: 'Función' }, { k: 'dot', l: d.anual ? 'Dotación prom.' : 'Dotación', num: true, f: v => fN(v, d.anual ? 1 : 0) },
              { k: 'fte', l: d.anual ? 'FTE prom.' : 'FTE', num: true, f: v => fN(v, 1) }, { k: 'costo', l: 'Costo de nómina', num: true, f: fM },
              { k: 'costoFte', l: 'Nómina por FTE', num: true, f: fmt }, { k: 'share', l: '% del costo', num: true, f: v => fP(v) },
            ]} filas={d.funciones} total={d.totFunciones} />
            {d.gerencias.length > 1 && (<><Sec t="Por gerencia" /><TablaDoc cols={colsOrg('Gerencia')} filas={d.gerencias} total={d.totOrg} /></>)}
            {d.areas.length > 1 && (<><Sec t="Por área" /><TablaDoc cols={colsOrg('Área')} filas={d.areas} total={d.totOrg} /><Nota>Gerencia y área según el organigrama de Personas: cargo vigente en cada mes; antes de julio 2026, la asignación más cercana.</Nota></>)}

            <Sec t="Costo de nómina por partida" />
            <TablaDoc cols={[{ k: 'nombre', l: 'Partida' }, { k: 'v', l: 'Monto', num: true, f: fmt }, { k: 'share', l: '%', num: true, f: v => fP(v) }, { k: 'porFte', l: 'Por FTE al mes', num: true, f: fmt }]} filas={d.partidas} total={d.totPartidas} />
            <Nota>Aportes patronales estimados con las tasas vigentes. El costo oficial del libro mayor usa el pago real.</Nota>

            {d.productividad.length > 0 && (<>
              <Sec t="Productividad y contribución por centro" />
              <TablaDoc cols={[
                { k: 'nombre', l: 'Centro' }, { k: 'ingresos', l: 'Venta neta', num: true, f: fM }, { k: 'rem', l: 'Costo de personal', num: true, f: fM },
                { k: 'pct', l: '% venta', num: true, f: v => fP(v) }, { k: 'gmrol', l: 'Margen por $1', num: true, f: fPesos, tono: v => (v != null && v < 1 ? ROJO : undefined) },
                { k: 'ventaFte', l: 'Venta por FTE al mes', num: true, f: fM }, { k: 'contrib', l: 'Contribución', num: true, f: fM, tono: v => (v < 0 ? ROJO : undefined) },
              ]} filas={d.productividad} total={d.totProd} />
              <Nota>Venta, costo de personal oficial prorrateado y contribución del resultado por sucursal de Finanzas (contribución = margen − personal − mermas − gastos directos). CD y administración central se miden por costo.</Nota>
              {d.sinMargen.length > 0 && <Nota>Sin margen por centro en {d.sinMargen.map(mesTexto).join(', ')}: falta el costo de venta por centro, por lo que margen, ROI y contribución por centro de esos meses no se informan.</Nota>}
            </>)}

            <Sec t="Horas extra" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
              <TablaDoc cols={[{ k: 'l', l: 'Tipo' }, { k: 'v', l: 'Monto', num: true, f: fmt }, { k: 'share', l: '%', num: true, f: v => fP(v) }]} filas={d.hheeTipos} total={{ l: 'Total', v: d.hheeTotal, share: d.hheeTotal ? 1 : null }} />
              <TablaDoc cols={[{ k: 'nombre', l: 'Centro' }, { k: 'v', l: 'Monto', num: true, f: fmt }, { k: 'porFte', l: 'Por FTE al mes', num: true, f: fmt }, { k: 'pctSB', l: '% sueldo base', num: true, f: v => fP(v) }]} filas={d.hheeCentros} />
            </div>
            {d.hheePersonas.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: NAVY, marginBottom: 4 }}>Diez personas con más horas extra</div>
                <TablaDoc cols={[{ k: 'nombre', l: 'Persona' }, { k: 'cargo', l: 'Cargo' }, { k: 'centro', l: 'Centro' }, { k: 'v', l: 'Monto', num: true, f: fmt }, { k: 'pctSB', l: '% de su sueldo base', num: true, f: v => fP(v) }]} filas={d.hheePersonas} />
              </div>
            )}

            {d.honorarios.length > 0 && (<>
              <Sec t="Honorarios" />
              <TablaDoc cols={[{ k: 'nombre', l: 'Prestador' }, { k: 'cargo', l: 'Cargo o servicio' }, { k: 'v', l: 'Monto bruto', num: true, f: fmt }]} filas={d.honorarios} total={{ nombre: 'Total', v: d.honorarios.reduce((t, x) => t + x.v, 0) }} />
            </>)}

            {d.anual && (<>
              <Sec t="Evolución mensual" />
              <TablaDoc cols={[
                { k: 'p', l: 'Mes', f: (v, r) => `${mesCorto(v)}${r.enCurso ? ' (en curso)' : ''}` }, { k: 'venta', l: 'Venta neta', num: true, f: fM },
                { k: 'cp', l: 'Costo personal', num: true, f: fM }, { k: 'pct', l: '% venta', num: true, f: v => fP(v) },
                { k: 'dot', l: 'Dotación', num: true, f: v => fN(v) }, { k: 'fte', l: 'FTE', num: true, f: v => fN(v, 1) },
                { k: 'costoNomina', l: 'Costo nómina', num: true, f: fM }, { k: 'hhee', l: 'Horas extra', num: true, f: fM },
                { k: m.filtrado ? 'contrib' : 'ebitda', l: m.filtrado ? 'Contribución' : 'EBITDA', num: true, f: fM, tono: v => (v < 0 ? ROJO : undefined) },
              ]} filas={d.evolucion} />
              {d.cruceCosto && (<>
                <Sec t="Costo de nómina por centro y mes" />
                <TablaDoc cols={d.cruceCosto.cols} filas={d.cruceCosto.filas} total={d.cruceCosto.total} />
              </>)}
              {d.crucePct && d.crucePct.filas.length > 0 && (<>
                <Sec t="Costo de personal sobre venta por tienda y mes" />
                <TablaDoc cols={d.crucePct.cols} filas={d.crucePct.filas} />
              </>)}
            </>)}

            <div style={{ marginTop: 24, paddingTop: 12, borderTop: `1px solid ${BORDE}`, fontSize: 10.5, color: GRIS, lineHeight: 1.6 }}>
              Fuentes: {m.porArea ? 'costo de nómina del área (haberes, aportes estimados y honorarios de sus liquidaciones) y venta del alcance como referencia' : m.filtrado ? 'venta, margen, costo de personal prorrateado y contribución del resultado por sucursal de Finanzas' : 'costo de personal, venta, margen y EBITDA del libro mayor del ERP (la cifra del EERR)'}. Detalle por persona, partida y centro: liquidaciones Contaline cargadas en el ERP; el centro es el de cada liquidación.
              Dotación = liquidaciones emitidas; FTE = días trabajados ÷ 30. Contrataciones y desvinculaciones son entradas y salidas de la empresa; los traslados, cambios de centro entre meses. Cifras en pesos chilenos.
            </div>
          </div>
        </div>
      )}

      <style>{`@media print {
        .no-print { display: none !important; }
        body * { visibility: hidden; }
        #informe-rem, #informe-rem * { visibility: visible; }
        #informe-rem { position: absolute; left: 0; top: 0; width: 100%; border: none !important; }
        @page { size: A4; margin: 12mm; }
        tr { page-break-inside: avoid; }
      }`}</style>
    </div>
  )
}

function armarInforme(m, anio, modo, mes) {
  const anual = modo === 'anio'
  const meses = mesesNomina(m, anio)
  const ps = anual ? meses : [mes]
  const comp = !anual && m.tot.has(perAnterior(mes)) ? perAnterior(mes) : null
  const A = combinar(ps.map(p => agg(m, p)))
  const B = comp ? combinar([agg(m, comp)]) : null
  const eSum = list => {
    const v = list.map(p => m.eerr.get(p)).filter(e => e && !e.enCurso)
    return v.length ? v.reduce((t, e) => ({ venta: t.venta + e.venta, mb: t.mb == null || e.mb == null ? null : t.mb + e.mb, cp: t.cp + e.cp }), { venta: 0, mb: 0, cp: 0 }) : null
  }
  const EA = eSum(ps), EB = comp ? eSum([comp]) : null
  const fila = (l, a, b, f, tipo, sube) => {
    let fv = '—', tono
    if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) {
      if (tipo === 'var') { const v = variacion(b, a); fv = fVar(v); if (v != null && Math.abs(v) > 0.005) tono = (v > 0) === sube ? ROJO : VERDE }
      else if (tipo === 'pts') { fv = fPts(a - b); if (Math.abs(a - b) > 0.0005) tono = (a > b) === sube ? ROJO : VERDE }
      else fv = Number.isInteger(a) && Number.isInteger(b) ? fEnt(a - b) : fN(a - b, 1)
    }
    return { l, a, b, f, fv, tono }
  }
  const roi = E => (E && E.mb != null ? div(E.mb - E.cp, E.cp) : null)
  const resumen = [
    fila(m.porArea ? 'Venta del alcance (referencia)' : m.filtrado ? 'Venta neta del centro' : 'Venta neta (libro mayor)', EA?.venta ?? null, EB?.venta ?? null, fM, 'var', false),
    fila('Margen bruto', EA?.mb ?? null, EB?.mb ?? null, fM, 'var', false),
    fila(m.fuenteCosto === 'nomina' ? 'Costo de nómina del área' : m.filtrado ? 'Costo de personal (prorrateado)' : 'Costo de personal (libro mayor)', EA?.cp ?? null, EB?.cp ?? null, fM, 'var', true),
    fila('Costo de personal sobre venta', EA ? div(EA.cp, EA.venta) : null, EB ? div(EB.cp, EB.venta) : null, v => fP(v), 'pts', true),
    fila('ROI de personal', roi(EA), roi(EB), v => fP(v, 0), 'pts', false),
    fila(anual ? 'Dotación promedio mensual' : 'Dotación (liquidaciones)', A.dotProm, B ? B.dotProm : null, v => fN(v, anual ? 1 : 0), 'abs'),
    fila(anual ? 'FTE promedio mensual' : 'FTE', A.fteProm, B ? B.fteProm : null, v => fN(v, 1), 'abs'),
    fila('Costo de nómina', costoNomina(A), B ? costoNomina(B) : null, fM, 'var', true),
    fila('Nómina por FTE al mes', costoPorFte(A), B ? costoPorFte(B) : null, fmt, 'var', true),
    fila('Horas extra', A.hhee, B ? B.hhee : null, fM, 'var', true),
    fila('Horas extra sobre sueldo base', div(A.hhee, A.sueldoBase), B ? div(B.hhee, B.sueldoBase) : null, v => fP(v), 'pts', true),
  ]
  const pIni = meses[0], pFin = anual ? meses[meses.length - 1] : mes
  const hall = hallazgos(m, anio, pFin, anual ? (pIni !== pFin ? pIni : null) : comp).slice(0, 7)
  const costoTot = costoNomina(A)
  const movC = movimientos(m, ps, 'centro'), movF = movimientos(m, ps, 'funcion')
  const grupo = (lista, getAgg, nombre, mov) => lista.map(k => {
    const x = combinar(ps.map(p => getAgg(p, k)))
    const mv = mov.porGrupo.get(k) || { ing: 0, sal: 0, ingT: 0, salT: 0 }
    return { nombre: nombre(k), dot: x.dotProm, fte: x.fteProm, contrat: mv.ing - mv.ingT, trasIn: mv.ingT, desv: mv.sal - mv.salT, trasOut: mv.salT, costo: costoNomina(x), costoFte: costoPorFte(x), share: div(costoNomina(x), costoTot) }
  }).filter(r => r.costo || r.dot)
  const centros = grupo(m.centros, (p, c) => aggCentro(m, p, c), m.nombreCentro, movC)
  const funciones = grupo(m.funciones, (p, f) => aggFuncion(m, p, f), f => f, movF)
  const sum = (arr, k) => arr.reduce((t, r) => t + (r[k] || 0), 0)
  const totCentros = { nombre: 'Total', dot: A.dotProm, fte: A.fteProm, contrat: sum(centros, 'contrat'), trasIn: sum(centros, 'trasIn'), trasOut: sum(centros, 'trasOut'), tras: 0, desv: sum(centros, 'desv'), costo: costoTot, costoFte: costoPorFte(A), share: 1 }
  const totFunciones = { nombre: 'Total', dot: A.dotProm, fte: A.fteProm, costo: costoTot, costoFte: costoPorFte(A), share: 1 }
  const partidas = Object.entries(A.partidas).map(([k, v]) => ({ nombre: partidaL(k), v, share: div(v, costoTot), porFte: k === 'honorario' ? null : div(v, A.fte) })).sort((a, b) => b.v - a.v)
  const cerr = ps.filter(p => m.eerr.get(p) && !m.eerr.get(p).enCurso)
  const prodBase = cerr.length ? filasCentros(m, cerr) : []
  const productividad = prodBase.filter(f => f.ingresos || f.rem).map(f => ({ ...f, nombre: f.apoyo ? `${f.nombre} (apoyo)` : f.nombre }))
  const sV = sum(prodBase, 'ingresos'), sR = sum(prodBase, 'rem'), sF = sum(prodBase, 'fteMeses'), sM = prodBase.some(f => f.mb == null) ? null : sum(prodBase, 'mb'), sC = prodBase.some(f => f.contrib == null) ? null : sum(prodBase, 'contrib')
  const hheeTotal = A.hhee
  const hheeTipos = TIPOS_HHEE.filter(t => A.hheeTipo[t.k]).map(t => ({ l: t.l, v: A.hheeTipo[t.k], share: div(A.hheeTipo[t.k], hheeTotal) }))
  const hheeCentros = m.centros.map(c => { const x = combinar(ps.map(p => aggCentro(m, p, c))); return { nombre: m.nombreCentro(c), v: x.hhee, porFte: div(x.hhee, x.fte), pctSB: div(x.hhee, x.sueldoBase) } }).filter(r => r.v).sort((a, b) => b.v - a.v)
  const per = new Map()
  for (const r of m.regs) {
    if (r.tipo !== 'liq' || !ps.includes(r.periodo)) continue
    let x = per.get(r.cod); if (!x) { x = { nombre: r.nombre, cargo: r.cargo, centro: m.nombreCentro(r.ceco), v: 0, sb: 0 }; per.set(r.cod, x) }
    x.v += r.hheeTotal; x.sb += r.sueldoBase
  }
  const hheePersonas = [...per.values()].filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 10).map(x => ({ ...x, pctSB: div(x.v, x.sb) }))
  const hon = new Map()
  for (const r of m.regs) { if (r.tipo !== 'hon' || !ps.includes(r.periodo)) continue; const x = hon.get(r.nombre) || { nombre: r.nombre, cargo: r.cargo, v: 0 }; x.v += r.honorario; hon.set(r.nombre, x) }
  const ventaPs = EA ? EA.venta : null
  const porOrg = (lista, getAgg) => lista.map(k => { const x = combinar(ps.map(p => getAgg(p, k))); const c = costoNomina(x); return { nombre: k, dot: x.dotProm, fte: x.fteProm, costo: c, share: div(c, costoTot), pctVenta: div(c, ventaPs), costoFte: costoPorFte(x), hhee: x.hhee } }).filter(r => r.costo || r.dot)
  const gerencias = porOrg(m.gerencias || [], (p, k) => aggGerencia(m, p, k)), areas = porOrg(m.areas || [], (p, k) => aggArea(m, p, k))
  const totOrg = { nombre: 'Total', dot: A.dotProm, fte: A.fteProm, costo: costoTot, share: 1, pctVenta: div(costoTot, ventaPs), costoFte: costoPorFte(A), hhee: A.hhee }
  // Cruces centro × mes (modo anual, más de un centro)
  let cruceCosto = null, crucePct = null
  if (anual && m.centros.length > 1) {
    const colsM = meses.map(p => ({ k: p, l: mesSolo(p), num: true, f: v => (v ? fM(v) : '') }))
    const filas = m.centros.map(c => { const o = { nombre: m.nombreCentro(c), total: 0 }; meses.forEach(p => { const v = costoNomina(aggCentro(m, p, c)); o[p] = v || null; o.total += v }); return o }).filter(o => o.total)
    const total = { nombre: 'Total', total: costoTot }
    meses.forEach(p => { total[p] = costoNomina(agg(m, p)) })
    cruceCosto = { cols: [{ k: 'nombre', l: 'Centro' }, ...colsM, { k: 'total', l: 'Año', num: true, f: fM }], filas, total }
    const tiendas = m.centros.filter(c => !esApoyo(c))
    const filasP = tiendas.map(c => {
      const o = { nombre: m.nombreCentro(c) }; let sv = 0, sr = 0
      cerr.forEach(p => { const s = m.suc.get(p)?.get(c); o[p] = s && s.ingresos > 0 && s.rem > 0 ? s.rem / s.ingresos : null; if (s && s.ingresos > 0) { sv += s.ingresos; sr += s.rem } })
      o.anio = div(sr, sv)
      return o
    }).filter(o => cerr.some(p => o[p] != null))
    crucePct = { cols: [{ k: 'nombre', l: 'Tienda' }, ...cerr.map(p => ({ k: p, l: mesSolo(p), num: true, f: v => fP(v) })), { k: 'anio', l: 'Año', num: true, f: v => fP(v) }], filas: filasP }
  }
  return {
    anual, comp,
    titulo: anual ? `Año ${anio} · ${mesTexto(meses[0])} a ${mesTexto(meses[meses.length - 1])}` : mesLargo(mes),
    etiquetaA: anual ? `Año ${anio}` : mesCorto(mes), etiquetaB: comp ? mesCorto(comp) : '',
    resumen, hall, centros, funciones, totCentros, totFunciones, salFicha: movC.salFicha,
    partidas, totPartidas: { nombre: 'Total nómina', v: costoTot, share: 1, porFte: costoPorFte(A) },
    productividad, totProd: prodBase.length ? { nombre: 'Total', ingresos: sV, rem: sR, pct: div(sR, sV), gmrol: div(sM, sR), ventaFte: div(sV, sF), contrib: sC } : null,
    hheeTotal, hheeTipos, hheeCentros, hheePersonas,
    honorarios: [...hon.values()].sort((a, b) => b.v - a.v),
    evolucion: anual ? filasMensuales(m, anio) : [], cruceCosto, crucePct,
    sinMargen: ps.filter(p => m.calidad.margenSinCuadre && m.calidad.margenSinCuadre.has(p)),
    gerencias, areas, totOrg,
  }
}

function Sec({ t }) {
  return <h2 style={{ margin: '24px 0 10px', paddingBottom: 6, borderBottom: `2px solid ${NAVY}`, fontSize: 15, fontWeight: 700, color: NAVY }}>{t}</h2>
}
function Nota({ children }) {
  return <div style={{ fontSize: 11, color: GRIS, marginTop: 6, lineHeight: 1.5 }}>{children}</div>
}
function TablaDoc({ cols, filas, total }) {
  const th = { padding: '6px 8px', fontSize: 11.5, fontWeight: 600, color: GRIS, borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap' }
  const td = { padding: '5px 8px', borderBottom: `1px solid #F0F1F3`, fontSize: 12.5 }
  const val = (c, r) => { const v = r[c.k]; if (c.f) return c.f(v, r); return v == null || v === '' ? (c.num ? '—' : '') : v }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{cols.map(c => <th key={c.k} style={{ ...th, textAlign: c.num ? 'right' : 'left' }}>{c.l}</th>)}</tr></thead>
        <tbody>{filas.map((r, i) => (
          <tr key={i}>{cols.map(c => <td key={c.k} style={{ ...td, textAlign: c.num ? 'right' : 'left', fontVariantNumeric: 'tabular-nums', color: c.tono ? c.tono(r[c.k], r) : undefined, whiteSpace: c.num ? 'nowrap' : undefined }}>{val(c, r)}</td>)}</tr>
        ))}</tbody>
        {total && <tfoot><tr>{cols.map(c => <td key={c.k} style={{ ...td, fontWeight: 700, borderTop: `1.5px solid ${NAVY}`, borderBottom: 'none', textAlign: c.num ? 'right' : 'left', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{total[c.k] == null ? '' : (c.f ? c.f(total[c.k], total) : total[c.k])}</td>)}</tr></tfoot>}
      </table>
    </div>
  )
}
