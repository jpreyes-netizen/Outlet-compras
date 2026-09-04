// src/procesos/prcInforme.js
// Informe de avance del programa de procesos y del gobierno por información
// (P21, fase 7 · Reporte al Directorio). Arma los datos desde las tablas vivas y
// abre el documento imprimible. El mismo generador (prcDoc.informeHTML) se usa
// fuera de la app con un snapshot de datos, así el PDF y la app dicen lo mismo.

import { supabase } from '../supabase'
import { informeHTML, abrirDocumento, fF } from './prcDoc'
import { indicadoresComite, efectividadIntervencion, coberturaContramedidas, hoyISO, sumarDias } from './prcComite'
import { descargar } from './prcUI'

/** Calcula la estructura del informe a partir de los datos crudos. */
export function datosInforme({ matriz = [], cat = {}, alertas = [], sesiones = [], acuerdos = [], decisiones = [], scorecard = [], mediciones = [], encargos = [], hitos = [], docs = [], numero, cu, dias = 30 }) {
  const hoy = hoyISO()
  const desde = sumarDias(hoy, -dias)
  const t = matriz.length || 1
  const sumScore = matriz.reduce((a, p) => a + (p.score || 0), 0) || 1
  const enRiesgo = matriz.filter(p => p.semaforo === 'rojo')
  const sopBorr = new Set(docs.filter(d => d.tipo === 'SOP' && ['BORRADOR', 'POR_OFICIALIZAR'].includes(d.estado)).map(d => d.proceso_id))

  const m = {
    total: matriz.length,
    implementados: matriz.filter(p => p.estado_implementacion === 'IMPLEMENTADO').length,
    score9: matriz.filter(p => p.score === 9).length,
    enRiesgo: enRiesgo.length,
    sinDueno: matriz.filter(p => p.dueno_provisional).length,
    conSopVigente: matriz.filter(p => p.sop_aprobado).length,
    conFlujograma: matriz.filter(p => p.flujograma_ok).length,
    conCapacitacion: matriz.filter(p => p.capacitacion_ok).length,
    conMedicion: matriz.filter(p => p.medicion_ok).length,
    sopBorradorCompleto: sopBorr.size,
    avanceSimple: Math.round(matriz.reduce((a, p) => a + (p.pct_global || 0), 0) / t),
    avancePonderado: Math.round(matriz.reduce((a, p) => a + (p.pct_global || 0) * (p.score || 0), 0) / sumScore)
  }
  const ondas = (cat.ondas || []).map(o => {
    const ps = matriz.filter(p => p.onda === o.codigo)
    return { nombre: o.nombre, ventana: o.ventana, n: ps.length, avance: ps.length ? Math.round(ps.reduce((a, p) => a + (p.pct_global || 0), 0) / ps.length) : 0,
      rojo: ps.filter(p => p.semaforo === 'rojo').length, vencida: !!(o.fecha_termino && o.fecha_termino < hoy) }
  }).filter(o => o.n)
  const direcciones = (cat.direcciones || []).map(d => {
    const ps = matriz.filter(p => p.direccion_responsable === d.codigo)
    return { etiqueta: d.etiqueta, n: ps.length, impl: ps.filter(p => p.estado_implementacion === 'IMPLEMENTADO').length,
      rojo: ps.filter(p => p.semaforo === 'rojo').length, avance: ps.length ? Math.round(ps.reduce((a, p) => a + (p.pct_global || 0), 0) / ps.length) : 0 }
  }).filter(d => d.n)

  const ctx = { sesiones, acuerdos, decisiones, scorecard, mediciones }
  const tot = indicadoresComite(null, ctx, desde, hoy)
  const comites = (cat.comites || []).map(c => ({ codigo: c.codigo, nombre: c.nombre, periodicidad: c.periodicidad, ...indicadoresComite(c.codigo, ctx, desde, hoy) }))
    .filter(c => c.sesionesPlan || c.proximas || c.acuerdos)
  const ef = efectividadIntervencion(acuerdos, scorecard, mediciones)
  const cob = coberturaContramedidas(scorecard)
  const sc = {
    total: scorecard.length, ancla: scorecard.filter(k => k.es_kpi_ancla).length,
    verdes: scorecard.filter(k => k.semaforo === 'VERDE').length, amarillos: scorecard.filter(k => k.semaforo === 'AMARILLO').length,
    rojos: scorecard.filter(k => k.semaforo === 'ROJO').length,
    sinDato: scorecard.filter(k => k.semaforo === 'SIN_DATO' || k.semaforo === 'SIN_META').length,
    cobertura: cob, efectividad: ef, rojosSinContramedida: cob.sin,
    tabla: scorecard.filter(k => k.semaforo && k.semaforo !== 'SIN_DATO').sort((a, b) => ({ ROJO: 0, AMARILLO: 1, VERDE: 2, SIN_META: 3 }[a.semaforo] - { ROJO: 0, AMARILLO: 1, VERDE: 2, SIN_META: 3 }[b.semaforo])).slice(0, 25)
  }
  const encActivos = encargos.filter(e => ['ACTIVO', 'EN_PILOTO', 'EN_APROBACION'].includes(e.estado))
  const encVencidos = encActivos.filter(e => e.vencido)
  const riesgos = [...alertas].sort((a, b) => (a.severidad === 'alta' ? -1 : 1) - (b.severidad === 'alta' ? -1 : 1)).slice(0, 14)

  // ── narrativa automática ──
  const semaforo = enRiesgo.length > matriz.length * 0.3 || encVencidos.length > 2 ? 'rojo' : enRiesgo.length > 0 || tot.vencidos > 0 ? 'ambar' : 'verde'
  const mensajes = []
  mensajes.push(`${m.implementados} de ${m.total} procesos implementados; avance ponderado ${m.avancePonderado}% (simple ${m.avanceSimple}%). ${m.sopBorradorCompleto} SOP con borrador completo esperan revisión del dueño y aprobación en comité.`)
  if (enRiesgo.length) mensajes.push(`${enRiesgo.length} procesos en riesgo (score ≥ 6 con más de 30 días de atraso): ${enRiesgo.slice(0, 6).map(p => p.id).join(', ')}${enRiesgo.length > 6 ? '…' : ''}.`)
  mensajes.push(`Comités: ${tot.realizadas} sesiones realizadas de ${tot.sesionesPlan} en el período${tot.pctQuorum != null ? `, ${tot.pctQuorum}% con quórum` : ''}${tot.asistencia != null ? `, asistencia ${tot.asistencia}%` : ''}; ${tot.acuerdos} acuerdos tomados, ${tot.vencidos} vencidos sin cerrar, ${tot.decisiones} decisiones registradas.`)
  mensajes.push(`Scorecard: ${sc.rojos} indicadores en rojo, ${sc.amarillos} en amarillo, ${sc.verdes} en verde y ${sc.sinDato} sin dato. Cobertura de contramedidas ${cob.pct == null ? 'sin rojos que cubrir' : cob.pct + '%'}; efectividad de la intervención ${ef.pct == null ? 'aún sin casos evaluables' : ef.pct + '%'}.`)
  mensajes.push(`Comités de trabajo: ${encActivos.length} activos${encVencidos.length ? `, ${encVencidos.length} fuera del plazo de 2 meses` : ''}; ${encargos.filter(e => e.estado === 'CERRADO').length} cerrados.`)

  const decisionesRequeridas = []
  matriz.filter(p => p.dueno_provisional && p.score >= 6).slice(0, 5).forEach(p => decisionesRequeridas.push(`Definir dueño real para ${p.id} ${p.nombre} (cargo vacante: ${p.dueno_cargo || 'sin definir'}).`))
  encVencidos.forEach(e => decisionesRequeridas.push(`Comité de trabajo de ${e.proceso_id} vencido hace ${Math.abs(e.dias_restantes)} días: extender con fecha, cerrar o reasignar (principio 13).`))
  acuerdos.filter(a => a.vencido && a.escalado_a).slice(0, 5).forEach(a => decisionesRequeridas.push(`Acuerdo escalado a ${a.escalado_a}: "${a.acuerdo}" (${a.responsable || 'sin responsable'}, plazo ${fF(a.fecha_compromiso)}).`))
  cob.sin.slice(0, 5).forEach(k => decisionesRequeridas.push(`Indicador en rojo sin contramedida: ${k.indicador} (${k.proceso_id}) — acordar causa, responsable y plazo.`))
  ondas.filter(o => o.vencida && o.avance < 100).forEach(o => decisionesRequeridas.push(`Reprogramar la ventana de ${o.nombre} (${o.ventana}): venció con ${o.avance}% de avance.`))

  const proximosPasos = []
  const proximas = sesiones.filter(s => s.fecha >= hoy && s.estado === 'PLANIFICADA').sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 4)
  proximas.forEach(s => proximosPasos.push(`${fF(s.fecha)} · ${s.comite_nombre || s.comite_codigo} sesión N° ${s.numero ?? '—'}${s.tema ? ': ' + s.tema : ''}.`))
  const porAprobar = docs.filter(d => d.tipo === 'SOP' && ['BORRADOR', 'POR_OFICIALIZAR'].includes(d.estado))
  if (porAprobar.length) proximosPasos.push(`Llevar a aprobación en comité ${porAprobar.length} SOP en borrador: ${[...new Set(porAprobar.map(d => d.proceso_id))].slice(0, 8).join(', ')}.`)
  encActivos.filter(e => !e.vencido).slice(0, 5).forEach(e => proximosPasos.push(`${e.proceso_id}: completar fase ${e.fase_actual} (${e.fase_actual_nombre || ''}) — plazo del encargo ${fF(e.fecha_limite)}.`))
  const sinEncargo = matriz.filter(p => p.score === 9 && p.estado_implementacion !== 'IMPLEMENTADO' && !encActivos.some(e => e.proceso_id === p.id)).slice(0, 5)
  if (sinEncargo.length) proximosPasos.push(`Asignar comité de trabajo a los procesos score 9 sin encargo: ${sinEncargo.map(p => p.id).join(', ')}.`)
  const comSinAgenda = (cat.comites || []).filter(c => c.codigo !== 'DIRECTORIO' && !sesiones.some(s => s.comite_codigo === c.codigo && s.fecha >= hoy && s.estado === 'PLANIFICADA'))
  if (comSinAgenda.length) proximosPasos.push(`Agendar el calendario del trimestre para: ${comSinAgenda.map(c => c.nombre).join(', ')}.`)

  const nombre = new Map(matriz.map(p => [p.id, p.nombre]))
  return {
    numero: numero ?? 1, fechaCorte: hoy, periodo: `últimos ${dias} días (${fF(desde)} al ${fF(hoy)})`,
    preparadoPor: cu?.nombre ? `${cu.nombre} — Dirección General` : 'Dirección General', para: 'Directorio y Comité de Dirección',
    resumen: { semaforo, mensajes },
    matriz: m, ondas, direcciones,
    gobierno: { ...tot, comites },
    scorecard: sc,
    encargos: encargos.filter(e => e.estado !== 'CANCELADO').sort((a, b) => (a.vencido ? -1 : 1) - (b.vencido ? -1 : 1)).slice(0, 20),
    riesgos, decisionesRequeridas, proximosPasos,
    hitos: hitos.filter(h => h.fecha >= desde).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 20).map(h => ({ ...h, nombre: nombre.get(h.proceso_id) })),
    anexoProcesos: [...matriz].sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id)).map(p => ({
      id: p.id, nombre: p.nombre, direccion: p.direccion_etiqueta, onda: p.onda_nombre, score: p.score,
      estado: p.estado_impl_etiqueta, pct_global: p.pct_global, semaforo: p.semaforo,
      dueno: (p.dueno_persona || p.dueno_cargo || '—') + (p.dueno_provisional ? ' (provisional)' : '')
    }))
  }
}

/** Carga todo lo necesario, arma el informe y lo abre para imprimir. */
export async function generarInforme({ matriz, cat, cu, toast, dias = 30 }) {
  const q = (t, sel = '*') => supabase.from(t).select(sel).then(r => (r.error ? [] : r.data || []))
  const [alertas, sesiones, acuerdos, decisiones, scorecard, mediciones, encargos, hitos, docs, cfg] = await Promise.all([
    q('v_prc_alertas'), q('v_prc_sesiones'), q('v_prc_acuerdos'), q('prc_decisiones'), q('v_prc_scorecard'),
    q('prc_mediciones'), q('v_prc_encargos'), q('prc_hitos', 'proceso_id, fecha, tipo, descripcion'),
    q('prc_documentos', 'id, proceso_id, tipo, codigo, version, estado, es_vigente'),
    q('prc_config', 'clave, valor')
  ])
  const prevNum = parseInt((cfg.find(c => c.clave === 'informe_numero') || {}).valor, 10) || 0
  const numero = prevNum + 1
  const d = datosInforme({ matriz, cat, alertas, sesiones, acuerdos, decisiones, scorecard, mediciones, encargos, hitos, docs, numero, cu, dias })
  const html = informeHTML(d)
  if (!abrirDocumento(html)) {
    descargar(`Informe_avance_procesos_${d.fechaCorte}.html`, html, 'text/html;charset=utf-8')
    toast?.('El navegador bloqueó la pestaña: se descargó el informe como archivo HTML. Ábrelo e imprime a PDF.')
  } else {
    toast?.(`Informe de avance N° ${numero} generado. En la pestaña nueva: Imprimir → Guardar como PDF.`)
  }
  // correlativo del informe (mejor esfuerzo)
  try {
    await supabase.from('prc_config').upsert({ clave: 'informe_numero', valor: String(numero), descripcion: 'Correlativo del informe de avance (P21 fase 7)' })
  } catch { /* sin correlativo no pasa nada */ }
  return d
}
