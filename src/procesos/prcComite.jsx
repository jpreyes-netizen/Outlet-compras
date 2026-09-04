// src/procesos/prcComite.js
// Reglas y cálculos del comité de gestión (P21), sin React:
// semáforo de indicadores, quórum, efectividad de la intervención, indicadores
// del propio comité, ausencias seguidas, carga de los comités de trabajo y el
// orden del día estándar. Lo usan la sala de sesión, el scorecard, el panel de
// efectividad y el informe de avance, para que todos digan lo mismo.

export const SEM = {
  VERDE:    { l: 'Verde',    c: '#1E8E3E', bg: '#E6F4EA', ic: '●' },
  AMARILLO: { l: 'Amarillo', c: '#B8860B', bg: '#FFF4CC', ic: '●' },
  ROJO:     { l: 'Rojo',     c: '#C5221F', bg: '#FCE8E6', ic: '●' },
  SIN_DATO: { l: 'Sin dato', c: '#8E8E93', bg: '#F1F1F3', ic: '○' },
  SIN_META: { l: 'Sin meta', c: '#5F6368', bg: '#F1F1F3', ic: '◌' }
}
export const semDe = k => SEM[k] || SEM.SIN_DATO

// Metas de P21 para evaluar al propio comité (mismos valores que los KPI sembrados en el SQL 09)
export const METAS_COMITE = {
  efectividad: 60, cobertura: 100, acuerdosPlazo: 80, quorum: 90, actas: 100, asistencia: 85, reporteria: 95
}

export const TIPOS_DECISION = [
  { k: 'APROBACION_SOP',     l: 'Aprobación de SOP' },
  { k: 'RECHAZO_SOP',        l: 'Rechazo de SOP (vuelve a diseño)' },
  { k: 'ASIGNACION_PROCESO', l: 'Asignación de proceso a comité de trabajo' },
  { k: 'REASIGNACION',       l: 'Reasignación de comité de trabajo' },
  { k: 'CONTRAMEDIDA',       l: 'Contramedida sobre indicador' },
  { k: 'CAMBIO_META',        l: 'Cambio de meta o indicador' },
  { k: 'RECURSOS',           l: 'Recursos (escala al Directorio si es inversión)' },
  { k: 'ESCALAMIENTO',       l: 'Escalamiento al comité superior' },
  { k: 'OTRA',               l: 'Otra decisión' }
]

export const TIPOS_ACUERDO = [
  { k: 'SEGUIMIENTO',        l: 'Seguimiento de avance' },
  { k: 'CONTRAMEDIDA',       l: 'Contramedida (indicador en rojo/amarillo)' },
  { k: 'APROBACION',         l: 'Aprobación de SOP' },
  { k: 'PRESENTACION',       l: 'Presentación' },
  { k: 'REVISION_SEMESTRAL', l: 'Revisión semestral' },
  { k: 'ESCALAMIENTO',       l: 'Escalamiento' }
]

export const TIPOS_OD = {
  APERTURA:            { l: 'Apertura y quórum',       ic: '🏁' },
  ACUERDOS_ANTERIORES: { l: 'Acuerdos anteriores',     ic: '↩' },
  SCORECARD:           { l: 'Scorecard de indicadores', ic: '📈' },
  PROCESOS:            { l: 'Procesos en revisión',     ic: '🗂️' },
  DECISION:            { l: 'Decisión requerida',       ic: '⚖️' },
  TEMA:                { l: 'Tema',                     ic: '💬' },
  CIERRE:              { l: 'Cierre y próxima sesión',  ic: '🔒' }
}

export const FASES_P37 = ['Activación y asignación', 'Encuadre', 'Diagnóstico', 'Diseño', 'Piloto', 'Aprobación', 'Bajada y traspaso']

/* ── fechas ─────────────────────────────────────────────────────────────── */
export const hoyISO = () => new Date().toISOString().slice(0, 10)
export const sumarDias = (fecha, n) => {
  const [y, m, d] = String(fecha).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
export const diasEntre = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000)
export const trimestreDe = (fecha = hoyISO()) => `${fecha.slice(0, 4)}-Q${Math.floor((+fecha.slice(5, 7) - 1) / 3) + 1}`
export const periodoMes = (fecha = hoyISO()) => fecha.slice(0, 7)

/** Horas entre la convocatoria enviada y el inicio de la sesión (negativo = enviada después). */
export function horasAnticipacion(sesion) {
  if (!sesion?.convocatoria_enviada_at || !sesion?.fecha) return null
  const inicio = new Date(`${sesion.fecha}T${(sesion.hora_inicio || '09:00').slice(0, 5)}:00`)
  return Math.round((inicio - new Date(sesion.convocatoria_enviada_at)) / 3600000)
}

/** Horas entre el término de la sesión y la emisión del acta. */
export function horasActa(sesion) {
  if (!sesion?.acta_emitida_at || !sesion?.fecha) return null
  const fin = new Date(`${sesion.fecha}T${(sesion.hora_fin || sesion.hora_inicio || '12:00').slice(0, 5)}:00`)
  return Math.round((new Date(sesion.acta_emitida_at) - fin) / 3600000)
}

/* ── semáforo de un indicador (espejo exacto de v_prc_scorecard) ────────── */
export function semaforoDe(kpi, m) {
  if (!m) return 'SIN_DATO'
  const meta = kpi?.meta_valor
  const tol = kpi?.tolerancia_pct == null ? 10 : Number(kpi.tolerancia_pct)
  if (meta != null && m.valor != null) {
    const v = Number(m.valor), M = Number(meta)
    if (kpi.sentido === 'MENOR_MEJOR') return v <= M ? 'VERDE' : v <= M * (1 + tol / 100) ? 'AMARILLO' : 'ROJO'
    return v >= M ? 'VERDE' : v >= M * (1 - tol / 100) ? 'AMARILLO' : 'ROJO'
  }
  if (m.cumple === true) return 'VERDE'
  if (m.cumple === false) return 'ROJO'
  return 'SIN_META'
}

/** Mediciones de un KPI ordenadas de la más reciente a la más antigua. */
export const medicionesDe = (kpiId, mediciones) => (mediciones || [])
  .filter(m => m.kpi_id === kpiId)
  .sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))

/** Cuántas mediciones seguidas lleva en rojo, contando desde la última. */
export function periodosEnRojo(kpi, mediciones) {
  let n = 0
  for (const m of medicionesDe(kpi.id, mediciones)) {
    if (semaforoDe(kpi, m) === 'ROJO') n++; else break
  }
  return n
}

/* ── quórum ─────────────────────────────────────────────────────────────── */
/** Estado del quórum a partir de la lista de asistentes y el reglamento del comité. */
export function quorum(asistentes, comite) {
  const votantes = (asistentes || []).filter(a => a.rol_sesion !== 'INVITADO')
  const presentes = votantes.filter(a => a.estado === 'PRESENTE')
  const min = Number(comite?.quorum_min ?? 0.75)
  const minInt = Number(comite?.integrantes_min ?? 3)
  const pct = votantes.length ? presentes.length / votantes.length : 0
  const ok = votantes.length > 0 && presentes.length >= minInt && pct >= min
  const faltan = Math.max(0, Math.ceil(votantes.length * min) - presentes.length, minInt - presentes.length)
  return { votantes: votantes.length, presentes: presentes.length, pct: Math.round(pct * 100), min: Math.round(min * 100), minInt, ok, faltan, impar: votantes.length % 2 === 1 }
}

/* ── efectividad de la intervención: el KPI de fondo ────────────────────── */
/**
 * Para cada contramedida (acuerdo tipo CONTRAMEDIDA ligado a un indicador) mira las
 * mediciones posteriores a la sesión en que se acordó:
 *   · alguna de las 2 siguientes sale del rojo  → EFECTIVA
 *   · hay 2 siguientes y ambas siguen en rojo    → NO_EFECTIVA
 *   · todavía no hay 2 mediciones posteriores    → PENDIENTE (si la única que hay ya salió del rojo, EFECTIVA)
 */
export function efectividadIntervencion(acuerdos, scorecard, mediciones) {
  const kpis = new Map((scorecard || []).map(k => [k.id, k]))
  const det = []
  ;(acuerdos || []).filter(a => a.tipo === 'CONTRAMEDIDA' && a.kpi_id && kpis.has(a.kpi_id) && a.estado !== 'ANULADO').forEach(a => {
    const k = kpis.get(a.kpi_id)
    const desde = a.fecha_sesion || a.created_at?.slice(0, 10) || hoyISO()
    const post = medicionesDe(k.id, mediciones)
      .filter(m => String(m.created_at || '').slice(0, 10) > desde)
      .reverse()                                     // cronológico
      .slice(0, 2)
    const sems = post.map(m => semaforoDe(k, m))
    let estado = 'PENDIENTE'
    if (sems.some(s => s !== 'ROJO' && s !== 'SIN_DATO')) estado = 'EFECTIVA'
    else if (sems.length >= 2) estado = 'NO_EFECTIVA'
    det.push({ acuerdo: a, kpi: k, estado, mediciones: post, semaforos: sems })
  })
  const efectivas = det.filter(d => d.estado === 'EFECTIVA').length
  const noEfectivas = det.filter(d => d.estado === 'NO_EFECTIVA').length
  const pendientes = det.filter(d => d.estado === 'PENDIENTE').length
  const evaluables = efectivas + noEfectivas
  return { detalle: det, efectivas, noEfectivas, pendientes, evaluables, pct: evaluables ? Math.round(100 * efectivas / evaluables) : null }
}

/** Cobertura: de los indicadores hoy en rojo (o amarillo), cuántos tienen contramedida abierta. */
export function coberturaContramedidas(scorecard, incluirAmarillo = false) {
  const enRiesgo = (scorecard || []).filter(k => k.semaforo === 'ROJO' || (incluirAmarillo && k.semaforo === 'AMARILLO'))
  const con = enRiesgo.filter(k => k.contramedida_abierta)
  return { total: enRiesgo.length, con: con.length, sin: enRiesgo.filter(k => !k.contramedida_abierta), pct: enRiesgo.length ? Math.round(100 * con.length / enRiesgo.length) : null }
}

/** Reportería a tiempo: indicadores con medición del período actual (mes en curso o anterior según frecuencia). */
export function reporteriaAlDia(scorecard) {
  const mes = periodoMes()
  const prev = periodoMes(sumarDias(mes + '-01', -1))
  const activos = (scorecard || []).filter(k => k.activo !== false)
  const alDia = activos.filter(k => k.ult_periodo && (String(k.ult_periodo) >= prev))
  return { total: activos.length, alDia: alDia.length, pct: activos.length ? Math.round(100 * alDia.length / activos.length) : null }
}

/* ── indicadores del propio comité (P21) ────────────────────────────────── */
export function indicadoresComite(codigo, { sesiones = [], acuerdos = [], decisiones = [], scorecard = [], mediciones = [] }, desde, hasta = hoyISO()) {
  const ses = sesiones.filter(s => (!codigo || s.comite_codigo === codigo) && s.fecha >= desde && s.fecha <= hasta && s.estado !== 'ANULADA')
  const pasadas = ses.filter(s => s.fecha <= hoyISO())
  const realizadas = pasadas.filter(s => s.estado === 'REALIZADA')
  const conQuorum = realizadas.filter(s => s.quorum_ok)
  const conAsis = realizadas.filter(s => s.pct_asistencia != null)
  const actasATiempo = realizadas.filter(s => { const h = horasActa(s); return h != null && h <= 24 })
  const acu = acuerdos.filter(a => (!codigo || a.comite_codigo === codigo) && a.fecha_sesion >= desde && a.fecha_sesion <= hasta && a.estado !== 'ANULADO')
  const cerrados = acu.filter(a => a.estado === 'CERRADO' && a.cerrado_a_tiempo != null)
  const aTiempo = cerrados.filter(a => a.cerrado_a_tiempo)
  const vencidos = acuerdos.filter(a => (!codigo || a.comite_codigo === codigo) && a.vencido)
  const dec = decisiones.filter(d => (!codigo || d.comite_codigo === codigo) && d.fecha >= desde && d.fecha <= hasta)
  const sc = codigo ? scorecard.filter(k => k.comite_codigo === codigo) : scorecard
  const ef = efectividadIntervencion(acu.length ? acuerdos.filter(a => !codigo || a.comite_codigo === codigo) : [], sc, mediciones)
  const cob = coberturaContramedidas(sc)
  const rep = reporteriaAlDia(sc)
  const pct = (a, b) => b ? Math.round(100 * a / b) : null
  return {
    sesionesPlan: pasadas.length, realizadas: realizadas.length, sinQuorum: pasadas.filter(s => s.estado === 'SIN_QUORUM').length,
    pendientesCierre: pasadas.filter(s => s.estado === 'PLANIFICADA').length,
    pctQuorum: pct(conQuorum.length, pasadas.length),
    asistencia: conAsis.length ? Math.round(conAsis.reduce((a, s) => a + Number(s.pct_asistencia), 0) / conAsis.length) : null,
    acuerdos: acu.length, acuerdosCerrados: cerrados.length, pctAcuerdosPlazo: pct(aTiempo.length, cerrados.length),
    vencidos: vencidos.length, decisiones: dec.length,
    pctActas: pct(actasATiempo.length, realizadas.length), actasSin: realizadas.filter(s => s.acta_estado === 'SIN_ACTA').length,
    efectividad: ef, cobertura: cob, reporteria: rep,
    rojos: sc.filter(k => k.semaforo === 'ROJO').length, amarillos: sc.filter(k => k.semaforo === 'AMARILLO').length,
    verdes: sc.filter(k => k.semaforo === 'VERDE').length, sinDato: sc.filter(k => k.semaforo === 'SIN_DATO' || k.semaforo === 'SIN_META').length,
    proximas: sesiones.filter(s => (!codigo || s.comite_codigo === codigo) && s.fecha > hoyISO() && s.estado === 'PLANIFICADA').length
  }
}

/** Semáforo de un indicador del comité contra su meta de P21 (mayor es mejor). */
export function semComite(valor, meta, tol = 10) {
  if (valor == null) return 'SIN_DATO'
  if (valor >= meta) return 'VERDE'
  if (valor >= meta * (1 - tol / 100)) return 'AMARILLO'
  return 'ROJO'
}

/* ── principio 12: dos ausencias seguidas obligan a reemplazar ──────────── */
export function ausenciasSeguidas(sesiones, asistencia, codigo, minimo = 2) {
  const ses = sesiones.filter(s => (!codigo || s.comite_codigo === codigo) && s.estado === 'REALIZADA')
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
  const porPersona = new Map()
  ses.forEach(s => {
    asistencia.filter(a => a.sesion_id === s.id && a.rol_sesion !== 'INVITADO').forEach(a => {
      const k = `${s.comite_codigo}|${a.nombre.trim().toLowerCase()}`
      if (!porPersona.has(k)) porPersona.set(k, { nombre: a.nombre, comite: s.comite_codigo, n: 0, cortado: false })
      const p = porPersona.get(k)
      if (p.cortado) return
      if (a.estado === 'AUSENTE') p.n++; else p.cortado = true
    })
  })
  return [...porPersona.values()].filter(p => p.n >= minimo).sort((a, b) => b.n - a.n)
}

/* ── carga en comités de trabajo (líder ≤ 2, participante ≤ 4) ──────────── */
export function cargaPersonas(encargos, maxLider = 2, maxPart = 4) {
  const activos = (encargos || []).filter(e => ['ACTIVO', 'EN_PILOTO', 'EN_APROBACION'].includes(e.estado))
  const lid = new Map(), par = new Map()
  activos.forEach(e => {
    const l = (e.lider || '').trim()
    if (l) lid.set(l, (lid.get(l) || 0) + 1)
    ;(e.integrantes || []).forEach(p => { const q = String(p).trim(); if (q) par.set(q, (par.get(q) || 0) + 1) })
  })
  return {
    lideres: [...lid].map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n),
    participantes: [...par].map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n),
    lideresExcedidos: [...lid].filter(([, n]) => n > maxLider).map(([nombre, n]) => ({ nombre, n })),
    participantesExcedidos: [...par].filter(([, n]) => n > maxPart).map(([nombre, n]) => ({ nombre, n }))
  }
}

/** Valida la conformación de un comité de trabajo (principios 5, 7 y límites de carga). */
export function validarConformacion({ lider, integrantes, encargos, excluirId }) {
  const errores = [], avisos = []
  const lista = [...new Set((integrantes || []).map(x => String(x).trim()).filter(Boolean))]
  if (!lider?.trim()) errores.push('Falta el líder del comité de trabajo.')
  if (lider && !lista.some(x => x.toLowerCase() === lider.trim().toLowerCase())) errores.push('El líder debe estar entre los integrantes.')
  if (lista.length < 3) errores.push(`Un comité se constituye con mínimo 3 personas (hay ${lista.length}).`)
  if (lista.length >= 3 && lista.length % 2 === 0) errores.push(`La conformación debe ser impar (hay ${lista.length}) — principio 7.`)
  const carga = cargaPersonas((encargos || []).filter(e => e.id !== excluirId))
  const cl = carga.lideres.find(x => x.nombre.toLowerCase() === (lider || '').trim().toLowerCase())
  if (cl && cl.n >= 2) errores.push(`${lider} ya lidera ${cl.n} comités de trabajo activos (máximo 2).`)
  lista.forEach(p => {
    const cp = carga.participantes.find(x => x.nombre.toLowerCase() === p.toLowerCase())
    if (cp && cp.n >= 4) errores.push(`${p} ya participa en ${cp.n} comités de trabajo activos (máximo 4).`)
  })
  avisos.push('Recuerda incluir al menos una persona de otra dirección o área (principio 5).')
  return { ok: errores.length === 0, errores, avisos }
}

/* ── orden del día estándar ─────────────────────────────────────────────── */
/**
 * Construye el orden del día de una sesión con la estructura estándar de revisión
 * por la dirección (ISO 9001 §9.3 / revisión de negocio), adaptada a P21.
 * Recibe el contexto para poblar los puntos concretos: acuerdos abiertos, rojos, SOP por aprobar, encargos.
 */
export function ordenDiaEstandar({ sesion, comite, acuerdosAbiertos = [], rojos = [], porAprobar = [], encargos = [], procesosNombre = {} }) {
  const items = []
  const dur = Number(comite?.duracion_min || 60)
  items.push({ tipo: 'APERTURA', titulo: 'Apertura, verificación de quórum y aprobación del acta anterior', minutos: 5,
    detalle: `Quórum: ${Math.round((comite?.quorum_min ?? 0.75) * 100)}% de los votantes y mínimo ${comite?.integrantes_min ?? 3}. Sin quórum la sesión es informativa.` })
  items.push({ tipo: 'ACUERDOS_ANTERIORES', titulo: `Revisión de acuerdos anteriores (${acuerdosAbiertos.length} abiertos${acuerdosAbiertos.filter(a => a.vencido).length ? `, ${acuerdosAbiertos.filter(a => a.vencido).length} vencidos` : ''})`,
    minutos: 10, detalle: acuerdosAbiertos.slice(0, 8).map(a => `• ${a.acuerdo}${a.responsable ? ' — ' + a.responsable : ''}${a.vencido ? ' (VENCIDO)' : ''}`).join('\n') || 'Sin acuerdos abiertos.' })
  items.push({ tipo: 'SCORECARD', titulo: `Scorecard: indicadores en rojo o amarillo (${rojos.length})`, minutos: Math.max(15, Math.min(40, rojos.length * 6)),
    detalle: rojos.slice(0, 10).map(k => `• ${k.indicador} (${procesosNombre[k.proceso_id] || k.proceso_id}): ${k.ult_valor ?? k.ult_valor_texto ?? 's/d'} vs meta ${k.meta_valor ?? k.meta ?? '—'}${k.contramedida_abierta ? ' · con contramedida' : ' · SIN contramedida'}`).join('\n')
      || 'Todos los indicadores con dato están en verde. Revisar los sin dato.' })
  if (porAprobar.length || encargos.length) {
    items.push({ tipo: 'PROCESOS', titulo: `Procesos: ${porAprobar.length} SOP por aprobar · ${encargos.length} comités de trabajo activos`, minutos: 15,
      detalle: [...porAprobar.map(d => `• Aprobar ${d.codigo} v${d.version} — ${procesosNombre[d.proceso_id] || d.proceso_id}`),
        ...encargos.map(e => `• ${e.proceso_id} ${procesosNombre[e.proceso_id] || ''}: fase ${e.fase_actual} (${e.fase_actual_nombre || ''}) · ${e.vencido ? 'VENCIDO' : (e.dias_restantes ?? '?') + ' días'} · líder ${e.lider}`)].join('\n') })
  } else {
    items.push({ tipo: 'PROCESOS', titulo: 'Procesos: avance de comités de trabajo y SOP en revisión', minutos: 10, detalle: 'Sin SOP pendientes de aprobación ni comités de trabajo activos.' })
  }
  items.push({ tipo: 'DECISION', titulo: 'Decisiones requeridas', minutos: 10, detalle: 'Cada decisión queda registrada con fundamento y votación. Lo que excede las facultades del comité se escala.' })
  items.push({ tipo: 'TEMA', titulo: 'Temas de la sesión' + (sesion?.tema ? `: ${sesion.tema}` : ''), minutos: Math.max(10, dur - 60), detalle: sesion?.observaciones || '' })
  items.push({ tipo: 'CIERRE', titulo: 'Cierre: lectura de acuerdos y decisiones, próxima sesión', minutos: 5,
    detalle: 'Todo tema termina en decisión o acuerdo con responsable, plazo y criterio de cierre. Acta dentro de 24 horas.' })
  return items.map((x, i) => ({ ...x, orden: i + 1, estado: 'PENDIENTE' }))
}

/** Checklist de cierre de sesión. */
export function checklistCierre({ sesion, q, ordenDia = [], acuerdos = [], decisiones = [] }) {
  const dur = sesion?.duracion_min
  return [
    { k: 'quorum', l: `Quórum ${q.presentes}/${q.votantes} votantes (${q.pct}% ≥ ${q.min}%, mínimo ${q.minInt})`, ok: q.ok, critico: true },
    { k: 'od', l: `Orden del día tratado (${ordenDia.filter(o => o.estado !== 'PENDIENTE').length}/${ordenDia.length})`, ok: ordenDia.length > 0 && ordenDia.every(o => o.estado !== 'PENDIENTE') },
    { k: 'acuerdos', l: `Al menos un acuerdo con responsable y plazo (${acuerdos.length})`, ok: acuerdos.length > 0, critico: true },
    { k: 'decisiones', l: `Decisiones registradas (${decisiones.length})`, ok: decisiones.length > 0 || true, info: decisiones.length === 0 ? 'Sin decisiones formales en esta sesión.' : null },
    { k: 'duracion', l: dur == null ? 'Duración: falta hora de inicio o término' : `Duración ${dur} min (regla: 60–180)`, ok: dur != null && dur >= 60 && dur <= 180 }
  ]
}

/** Texto plano de la convocatoria (para copiar y pegar en correo o WhatsApp). */
export function textoConvocatoria({ sesion, comite, asistentes = [], ordenDia = [] }) {
  const L = []
  L.push(`CONVOCATORIA · ${comite?.nombre || sesion.comite_codigo} · Sesión N° ${sesion.numero ?? '—'}`)
  L.push(`Fecha: ${sesion.fecha}${sesion.hora_inicio ? ' · ' + sesion.hora_inicio + (sesion.hora_fin ? '–' + sesion.hora_fin : '') : ''}${sesion.lugar ? ' · ' + sesion.lugar : ''}`)
  if (sesion.tema) L.push(`Tema: ${sesion.tema}`)
  L.push('')
  L.push('Orden del día:')
  ordenDia.forEach(o => L.push(`  ${o.orden}. ${o.titulo}${o.minutos ? ` (${o.minutos} min)` : ''}`))
  if (asistentes.length) { L.push(''); L.push('Convocados: ' + asistentes.map(a => a.nombre).join(', ')) }
  L.push('')
  L.push('Confirma tu asistencia. Sin quórum de ¾ la sesión es informativa y se reprograma (P21, principio 4).')
  return L.join('\n')
}
