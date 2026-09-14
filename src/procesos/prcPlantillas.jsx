// src/procesos/prcPlantillas.jsx — los formatos anexos del método P21.
//
// Cada fase del comité de trabajo tiene entregables definidos en el SOP (acta de
// encuadre, informe de diagnóstico, ficha de KPI, bitácora de piloto…). Acá vive
// un formato descargable por fase —F1 a F7—, pre-llenado con los datos del
// encargo, que el equipo baja en Word, rellena, exporta a PDF y vuelve a cargar
// como evidencia de la fase. Así el entregable de cada etapa tiene una
// estructura conocida y comparable entre procesos, en vez de partir de cero.
//
// Se descargan como .doc (HTML que Word abre y edita sin problemas).

import { descargar } from './prcUI'

const hoyCL = () => new Date().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
const fF = d => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}` }

/* ── piezas de armado (HTML compatible con Word: tablas y estilos simples) ── */
const AZUL = '#1a1a2e', GRIS = '#f2f2f6', BORDE = '#c9c9d4'
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const seccion = (n, titulo, cuerpo) => `
  <table width="100%" cellspacing="0" cellpadding="0" style="margin:14pt 0 4pt"><tr>
    <td bgcolor="${AZUL}" width="26" align="center" style="color:#fff;font-weight:bold;font-size:10pt;padding:3pt 0">${n}</td>
    <td style="border-bottom:2pt solid ${AZUL};padding:3pt 8pt;font-weight:bold;font-size:11pt">${esc(titulo)}</td>
  </tr></table>
  ${cuerpo}`

const T = (filas, anchos = []) => {
  const colgroup = anchos.length ? `<colgroup>${anchos.map(a => `<col width="${a}%">`).join('')}</colgroup>` : ''
  return `<table width="100%" cellspacing="0" cellpadding="5" style="border-collapse:collapse;font-size:9.5pt">${colgroup}${filas}</table>`
}
const th = (...cs) => `<tr>${cs.map(c => `<td bgcolor="${GRIS}" style="border:1pt solid ${BORDE};font-weight:bold">${esc(c)}</td>`).join('')}</tr>`
const tdv = (n = 1, alto = 22) => Array.from({ length: n }, () => `<td style="border:1pt solid ${BORDE};height:${alto}pt">&nbsp;</td>`).join('')
const filaVacia = (n, alto) => `<tr>${tdv(n, alto)}</tr>`
const filasVacias = (filas, cols, alto) => Array.from({ length: filas }, () => filaVacia(cols, alto)).join('')
const filaDato = (rotulo, valor, alto = 16) =>
  `<tr><td bgcolor="${GRIS}" width="30%" style="border:1pt solid ${BORDE};font-weight:bold">${esc(rotulo)}</td><td style="border:1pt solid ${BORDE};height:${alto}pt">${esc(valor ?? '')}&nbsp;</td></tr>`
const cajaTexto = (alto = 70) => T(`<tr><td style="border:1pt solid ${BORDE};height:${alto}pt;vertical-align:top">&nbsp;</td></tr>`)
const firmas = (roles) => T('<tr>' + roles.map(r =>
  `<td align="center" style="border:0;padding-top:34pt"><div style="border-top:1pt solid #333;padding-top:3pt;font-size:9pt">${esc(r)}<br/>Nombre, firma y fecha</div></td>`).join('') + '</tr>')

const notaUso = (fase, texto) => `
  <table width="100%" cellspacing="0" cellpadding="7" style="margin:8pt 0"><tr>
    <td bgcolor="#fff7e0" style="border:1pt solid #e5c96b;font-size:9pt;color:#6b5a1e">
      <b>Cómo usar este formato:</b> ${esc(texto)} Al terminar, exporta a PDF y cárgalo como evidencia de la
      <b>fase ${fase}</b> del encargo en el ERP (módulo Procesos → Comités de trabajo).
    </td></tr></table>`

function shell(codigo, titulo, enc, cuerpo) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${esc(codigo)} · ${esc(titulo)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>body{font-family:'Segoe UI',Arial,sans-serif;font-size:10pt;color:#1c1c28;margin:40pt 46pt} p{margin:4pt 0}</style>
</head><body>
<table width="100%" cellspacing="0" cellpadding="0"><tr>
  <td bgcolor="${AZUL}" style="padding:12pt 16pt">
    <span style="color:#ffffff;font-size:14pt;font-weight:bold">OUTLET DE PUERTAS SpA</span><br/>
    <span style="color:#a9b6d8;font-size:9pt">P21 · Construcción y aprobación de procesos — formato ${esc(codigo)}</span>
  </td>
  <td bgcolor="${AZUL}" align="right" style="padding:12pt 16pt">
    <span style="color:#ffffff;font-size:11pt;font-weight:bold">${esc(titulo)}</span><br/>
    <span style="color:#a9b6d8;font-size:9pt">Generado el ${hoyCL()}</span>
  </td>
</tr></table>
<table width="100%" cellspacing="0" cellpadding="5" style="border-collapse:collapse;font-size:9.5pt;margin-top:8pt">
  ${filaDato('Proceso', `${enc.proceso_id} · ${enc.proceso_nombre || ''}`)}
  ${filaDato('Comité de trabajo', `Líder: ${enc.lider || '—'} · asignado por ${enc.comite_codigo || '—'} · plazo ${fF(enc.fecha_limite)}`)}
</table>
${cuerpo}
<p style="margin-top:16pt;font-size:8pt;color:#8a8a96">Outlet de Puertas SpA · Módulo de Procesos del ERP · Formato ${esc(codigo)} del método P21. Este documento rellenado es el entregable oficial de la fase: cárguelo como evidencia en el encargo.</p>
</body></html>`
}

/* ═══════════════════════════════════════════════════════════════════════════
   Los 7 formatos, uno por fase, cubriendo los documentos que pide el método
   ═══════════════════════════════════════════════════════════════════════════ */
export const PLANTILLAS = {
  1: { codigo: 'F1', titulo: 'Activación: levantamiento inicial, nómina y convocatoria' },
  2: { codigo: 'F2', titulo: 'Acta de encuadre' },
  3: { codigo: 'F3', titulo: 'Informe de diagnóstico' },
  4: { codigo: 'F4', titulo: 'Diseño: quiebres, roles, excepciones y Ficha de KPI' },
  5: { codigo: 'F5', titulo: 'Piloto: ficha, bitácora e informe' },
  6: { codigo: 'F6', titulo: 'Validación: rúbrica y acta de deliberación' },
  7: { codigo: 'F7', titulo: 'Bajada: capacitación, KPI activados y acta de cierre' }
}

function f1(enc) {
  return shell('F1', PLANTILLAS[1].titulo, enc,
    notaUso(1, 'Cubre los documentos de la fase 1: informe de levantamiento inicial (paso 1.2), nómina del comité con visto bueno de jefatura (paso 1.3) y convocatoria de constitución (paso 1.4).') +
    seccion('1', 'Levantamiento inicial (paso 1.2 · entrevista a 2+ actores clave)',
      T(th('Actor entrevistado', 'Área / cargo', 'Fecha', 'Qué hace hoy / principales problemas') + filasVacias(4, 4, 26), [22, 18, 12, 48]) +
      `<p style="font-size:9pt;margin-top:6pt"><b>Antecedentes y hallazgos del levantamiento:</b></p>` + cajaTexto(90)) +
    seccion('2', 'Nómina del comité de trabajo (paso 1.3 · impar, mínimo 3, uno de otra área)',
      T(th('Nombre', 'Área', 'Rol en el comité', 'Jefatura que aprueba', 'V°B° jefatura (firma)') + filasVacias(5, 5, 24), [24, 16, 18, 22, 20])) +
    seccion('3', 'Convocatoria a la sesión de constitución (paso 1.4)',
      T(filaDato('Fecha y hora', '') + filaDato('Modalidad y lugar', '') + filaDato('Tabla (temas de la sesión)', '', 40))) +
    firmas([`${enc.lider || 'Líder del comité'} · Líder`]))
}

function f2(enc) {
  return shell('F2', PLANTILLAS[2].titulo, enc,
    notaUso(2, 'Es el acta de la sesión de constitución (pasos 2.1 a 2.4). Firmada por todos, cierra la fase 2: sin acta de encuadre la fase 3 no se abre.') +
    seccion('1', 'Asistencia y quórum (paso 2.1 · ¾ de los votantes, redondeo arriba)',
      T(th('Integrante', 'Presente (sí/no)', 'Firma') + filasVacias(5, 3, 22), [50, 20, 30]) +
      T(filaDato('Quórum verificado', '     /     presentes — cumple: SÍ / NO'))) +
    seccion('2', 'Secretario de actas (paso 2.2 · por nombre, no por área)',
      T(filaDato('Secretario/a designado/a', enc.secretario || ''))) +
    seccion('3', 'Objetivo, alcance y exclusiones (paso 2.4)',
      T(filaDato('Objetivo del encargo', enc.objetivo || '', 30) +
        filaDato('Alcance (qué SÍ cubre)', '', 30) +
        filaDato('Exclusiones explícitas (qué NO)', enc.fuera_de_alcance || '', 30))) +
    seccion('4', 'Plan de trabajo (paso 2.3 · hitos, fechas y responsables por fase)',
      T(th('Fase', 'Entregable', 'Fecha comprometida', 'Responsable') +
        [3, 4, 5, 6, 7].map(n => `<tr><td style="border:1pt solid ${BORDE}">${n}. ${['', '', '', 'Diagnóstico', 'Diseño', 'Piloto', 'Validación', 'Bajada y traspaso'][n]}</td>${tdv(3, 20)}</tr>`).join(''), [22, 40, 18, 20])) +
    seccion('5', 'Reglas de la sesión',
      T(filaDato('Periodicidad de sesiones', '') + filaDato('Fecha límite del encargo', fF(enc.fecha_limite)))) +
    firmas([`${enc.lider || 'Líder'} · Líder`, 'Secretario/a de actas', 'Integrante', 'Integrante']))
}

function f3(enc) {
  return shell('F3', PLANTILLAS[3].titulo, enc,
    notaUso(3, 'Es el informe de 1–2 páginas del paso 3.4: proceso as-is, quiebres y 3 causas raíz priorizadas, más el registro de a quiénes se consultó (3+ ejecutores) y la validación en sesión (paso 3.5).') +
    seccion('1', 'Ejecutores consultados (mínimo 3)',
      T(th('Nombre', 'Cargo / sucursal', 'Herramienta aplicada (entrevista, checklist, observación)', 'Fecha') + filasVacias(4, 4, 22), [24, 22, 38, 16])) +
    seccion('2', 'El proceso como funciona HOY (as-is)',
      `<p style="font-size:9pt">Describe el flujo real, no el ideal: quién hace qué, en qué sistema, con qué documento.</p>` + cajaTexto(120)) +
    seccion('3', 'Quiebres detectados y causas raíz (priorizadas, máximo 3)',
      T(th('N°', 'Quiebre observado (con evidencia)', 'Causa raíz (aplicar 5 porqués)', 'Impacto (alto/medio/bajo)') +
        [1, 2, 3].map(n => `<tr><td align="center" style="border:1pt solid ${BORDE}">${n}</td>${tdv(3, 32)}</tr>`).join(''), [6, 40, 38, 16])) +
    seccion('4', 'Validación en sesión (paso 3.5)',
      T(filaDato('Sesión y fecha', '') + filaDato('Resultado de la votación', 'Aprobado: ___ a favor / ___ en contra / ___ abstenciones'))) +
    firmas([`${enc.lider || 'Líder'} · Líder`, 'Secretario/a de actas']))
}

function f4(enc) {
  return shell('F4', PLANTILLAS[4].titulo, enc,
    notaUso(4, 'Acompaña el borrador del SOP (que se redacta en el ERP, paso 4.8). Cubre: matriz quiebre→solución (4.1), objetivo con criterio (4.2), roles y límites (4.4), excepciones (4.5) y la Ficha de KPI (4.6).') +
    seccion('1', 'Matriz quiebre → solución (paso 4.1)',
      T(th('Quiebre (del diagnóstico F3)', 'Qué parte del diseño lo resuelve', '¿Queda resuelto? (sí/parcial)') + filasVacias(3, 3, 26), [40, 42, 18])) +
    seccion('2', 'Objetivo del proceso con criterio de cumplimiento (paso 4.2)', cajaTexto(46)) +
    seccion('3', 'Actores, alcances y limitaciones (paso 4.4)',
      T(th('Rol / cargo', 'Qué hace (función)', 'Qué NO puede hacer (límite)') + filasVacias(4, 3, 24), [24, 40, 36])) +
    seccion('4', 'Casos de excepción resueltos (paso 4.5 · mínimo 3)',
      T(th('N°', 'Excepción', 'Cómo se resuelve y quién decide') +
        [1, 2, 3].map(n => `<tr><td align="center" style="border:1pt solid ${BORDE}">${n}</td>${tdv(2, 26)}</tr>`).join(''), [6, 42, 52])) +
    seccion('5', 'FICHA DE KPI (paso 4.6 — la definición que después se activa en fase 7)',
      T(filaDato('Indicador (nombre)', '') + filaDato('Fórmula de cálculo', '') + filaDato('Línea base actual', '') +
        filaDato('Meta y sentido (≥ / ≤)', '') + filaDato('Frecuencia de medición', '') + filaDato('Fuente del dato', '') +
        filaDato('Responsable de medir (cargo)', ''))) +
    seccion('6', 'Presentación al pleno (paso 4.9)',
      T(filaDato('Sesión y fecha', '') + filaDato('Resultado de la votación', 'Aprobado: ___ a favor / ___ en contra / ___ abstenciones'))) +
    firmas([`${enc.lider || 'Líder'} · Líder`, 'Secretario/a de actas']))
}

function f5(enc) {
  return shell('F5', PLANTILLAS[5].titulo, enc,
    notaUso(5, 'Cubre la ficha del piloto (5.1), la bitácora de incidencias (5.3) y el informe con el KPI antes/durante (5.4). El piloto dura mínimo 14 días (principio 10) y el informe va al directorio (5.6).') +
    seccion('1', 'Ficha del piloto (paso 5.1)',
      T(filaDato('Unidad donde se pilotea', '') +
        filaDato('¿Por qué es representativa? (no la más fácil)', '', 26) +
        filaDato('Fechas (mínimo 14 días)', 'Del ____-____-______ al ____-____-______') +
        filaDato('KPI a observar (de la Ficha 4.6)', '') +
        filaDato('Equipo capacitado el (paso 5.2)', ''))) +
    seccion('2', 'Bitácora de incidencias y desviaciones (paso 5.3)',
      T(th('Fecha', 'Incidencia o desviación observada', 'Acción tomada', 'Registrado por') + filasVacias(7, 4, 22), [12, 42, 30, 16])) +
    seccion('3', 'Informe del piloto (paso 5.4 · KPI antes / durante)',
      T(th('Medición', 'Antes del piloto', 'Durante el piloto', 'Diferencia') +
        `<tr><td style="border:1pt solid ${BORDE}">Valor del KPI</td>${tdv(3, 20)}</tr>`, [30, 24, 24, 22]) +
      `<p style="font-size:9pt;margin-top:6pt"><b>Evaluación: ¿se resolvieron los quiebres? ¿qué se ajusta del SOP?</b></p>` + cajaTexto(80)) +
    seccion('4', 'Validación y envío (pasos 5.5 y 5.6)',
      T(filaDato('Votación del pleno', 'Aprobado: ___ a favor / ___ en contra') +
        filaDato('Informe enviado al directorio el', ''))) +
    firmas([`${enc.lider || 'Líder'} · Líder`, 'Secretario/a de actas']))
}

function f6(enc) {
  return shell('F6', PLANTILLAS[6].titulo, enc,
    notaUso(6, 'La usa el comité de directorio: preguntas dirigidas y rúbrica (paso 6.2) y el acta de deliberación con votación (paso 6.4). Si se aprueba, el SOP se firma y publica en el ERP (paso 6.5).') +
    seccion('1', 'Preguntas dirigidas al comité de trabajo (paso 6.2)',
      T(th('N°', 'Pregunta', 'Respuesta satisfactoria (sí/no)') + [1, 2, 3, 4].map(n => `<tr><td align="center" style="border:1pt solid ${BORDE}">${n}</td>${tdv(2, 24)}</tr>`).join(''), [6, 66, 28])) +
    seccion('2', 'Rúbrica de aprobación',
      T(th('Criterio', 'Cumple (sí/no)', 'Observación') +
        ['Resuelve los quiebres del diagnóstico', 'Roles y límites claros; excepciones resueltas', 'KPI definido con línea base, meta y responsable', 'Piloto ≥14 días con resultados medidos', 'SOP y flujograma versionados en el ERP']
          .map(c => `<tr><td style="border:1pt solid ${BORDE}">${c}</td>${tdv(2, 20)}</tr>`).join(''), [50, 16, 34])) +
    seccion('3', 'Deliberación y votación (paso 6.4)',
      T(filaDato('Sesión y fecha', '') +
        filaDato('Resultado', 'APROBADO / APROBADO CON OBSERVACIONES / DEVUELTO A DISEÑO (vuelve a 4.3)') +
        filaDato('Votos', '___ a favor · ___ en contra · ___ abstenciones') +
        filaDato('Observaciones o condiciones', '', 40))) +
    firmas(['Preside el directorio', 'Secretario/a de actas', `${enc.lider || 'Líder'} · Líder del comité`]))
}

function f7(enc) {
  return shell('F7', PLANTILLAS[7].titulo, enc,
    notaUso(7, 'Cierra el encargo: plan y registro de la capacitación (7.1 y 7.2, asistencia ≥80% con firma), activación del KPI (7.3) y acta de cierre con traspaso al dueño y acompañamiento 60 días (7.5).') +
    seccion('1', 'Plan de capacitación (paso 7.1 · ≤90 min)',
      T(filaDato('Destinatarios (nominales)', '', 26) + filaDato('Contenido', '', 26) +
        filaDato('Modalidad y duración', '') + filaDato('Materiales', ''))) +
    seccion('2', 'Registro de asistencia (paso 7.2 · mínimo 80% de los destinatarios)',
      T(th('Nombre', 'Cargo / sucursal', 'Fecha', 'Firma') + filasVacias(6, 4, 22), [30, 26, 14, 30])) +
    seccion('3', 'Activación del KPI (paso 7.3)',
      T(filaDato('Responsable de medir (nombre)', '') + filaDato('Primera medición: valor y fecha', '') +
        filaDato('Registrado en el ERP el', ''))) +
    seccion('4', 'Acta de cierre y traspaso (paso 7.5)',
      T(filaDato('Proceso traspasado a (dueño)', '') + filaDato('Fecha del traspaso', '') +
        filaDato('Acuerdos de seguimiento', '', 34) +
        filaDato('Plan de acompañamiento 60 días (hitos)', '', 34))) +
    firmas([`${enc.lider || 'Líder'} · Líder`, 'Dueño del proceso', 'Secretario/a de actas']))
}

const GENERADORES = { 1: f1, 2: f2, 3: f3, 4: f4, 5: f5, 6: f6, 7: f7 }

/** Descarga el formato de la fase, pre-llenado con los datos del encargo, como .doc editable. */
export function descargarPlantilla(fase, encargo) {
  const gen = GENERADORES[fase]
  if (!gen) return false
  const { codigo } = PLANTILLAS[fase]
  const html = gen(encargo || {})
  descargar(`${codigo}_${encargo?.proceso_id || 'P'}_fase${fase}.doc`, html, 'application/msword;charset=utf-8')
  return true
}

export default { PLANTILLAS, descargarPlantilla }
