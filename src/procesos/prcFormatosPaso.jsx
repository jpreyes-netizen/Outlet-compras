// src/procesos/prcFormatosPaso.jsx — formato de evidencia POR PASO del método P21.
//
// Cada paso de la hoja de trabajo que pide un documento tiene su propio formato
// (código F<fase>.<paso>): se descarga en Word para llenarlo en el computador
// o se abre listo para imprimir y llenar a mano; después se escanea/exporta a
// PDF y se vuelve a cargar como evidencia EN ESE PASO. Mismo look de documento
// controlado que los formatos de fase (F1–F7), que siguen siendo el consolidado.
//
// Los formatos se identifican por fase y orden del paso (1.1, 2.4…), que es lo
// estable del método; se pre-llenan con los datos del encargo (proceso, líder,
// comité que asigna, plazo, integrantes).

import { piezas } from './prcPlantillas'
import { descargar } from './prcUI'
import { abrirDocumento } from './prcDoc'

const { shell, sec, T, th, td, filasVacias, ej, filaDato, cajaTexto, escala, checklist, aprobaciones, instrucciones, proposito, esc } = piezas

/* ── piezas propias de los formatos por paso ─────────────────────────────── */
const integ = e => (e.integrantes || []).filter(Boolean)
const tabla = (cabs, anchos, ejemplo, filas = 5, alto = 22, numerar = false) =>
  T(th(...cabs) + (ejemplo ? ej(...ejemplo) : '') + filasVacias(filas, cabs.length, alto, numerar ? (i => String(i)) : null), anchos)
const datos = (pares, alto = 15) => T(pares.map(([r, v, a]) => filaDato(r, v ?? '', a || alto)).join(''))

/** Registro de asistencia pre-llenado con los integrantes del encargo. */
const asistencia = (e, extra = 4, conRol = true) => {
  const ns = integ(e)
  const rol = n => n === e.lider ? 'Líder' : n === e.secretario ? 'Secretario/a' : 'Integrante'
  const cabs = conRol ? ['N°', 'Nombre', 'Rol', 'Área / cargo', 'Asiste (P/A/J)', 'Firma'] : ['N°', 'Nombre', 'Área / cargo', 'Asiste (P/A/J)', 'Firma']
  const filas = ns.map((n, i) => `<tr>${td(String(i + 1), 'text-align:center;font-weight:bold;background:#f7f8fb')}${td(esc(n), 'height:22pt')}${conRol ? td(rol(n)) : ''}${td('')}${td('')}${td('')}</tr>`).join('')
  return T(th(...cabs) + filas + filasVacias(extra, cabs.length, 22, i => String(ns.length + i)), conRol ? [5, 27, 13, 20, 11, 24] : [5, 30, 25, 13, 27])
}

/** Votación nominal: la decisión con su resultado verificable. */
const votacion = (e, materia) =>
  datos([['Materia sometida a votación', materia, 26], ['Quórum presente (N° / total con voto)', ''], ['Votos a favor · en contra · abstenciones', ''], ['Resultado', 'APROBADO  ☐        RECHAZADO  ☐        APLAZADO  ☐']]) +
  tabla(['Integrante', 'A favor', 'En contra', 'Abstención', 'Fundamento del voto (obligatorio si es en contra)'], [24, 9, 9, 10, 48], null, Math.max(integ(e).length, 3), 20)

const FIRMAS_LIDER = e => aprobaciones([['Elabora', e.lider || '', 'Líder del comité de trabajo'], ['Revisa', e.secretario || '', 'Secretario/a de actas']])
const FIRMAS_PLENO = e => aprobaciones([['Preside', e.lider || '', 'Líder del comité de trabajo'], ['Fe del acta', e.secretario || '', 'Secretario/a de actas']])

/* ═══════════════════════════════════════════════════════════════════════════
   Catálogo: fase.orden → { titulo, cuerpo(e) }
   ═══════════════════════════════════════════════════════════════════════════ */
const F = {
  /* ── FASE 1 · ACTIVACIÓN ─────────────────────────────────────────────── */
  '1.1': {
    titulo: 'Constancia de recepción del encargo',
    cuerpo: e =>
      proposito('Dejar constancia firmada de que el líder recibió el proceso con su ficha de la matriz, entendió qué se le encarga, contra qué se medirá y en qué plazo. Es el control crítico que abre el método.') +
      instrucciones(['Revisa la ficha del proceso en el ERP (Procesos → Matriz) y transcribe los datos.', 'Si algún dato está incompleto o no lo compartes, anótalo en la sección 3: se resuelve con el comité que asigna ANTES de avanzar.', 'Firma, escanea o exporta a PDF y carga el documento en el paso 1.1.']) +
      sec('1', 'Datos de la ficha del proceso', 'Tal como figuran en la matriz del ERP al momento de recibir el encargo.',
        datos([['Proceso', `${e.proceso_id || ''} · ${e.proceso_nombre || ''}`], ['Score / prioridad en la matriz', ''], ['Dueño designado del proceso', ''], ['Fecha objetivo del encargo', e.fecha_limite ? piezas.fF(e.fecha_limite) : ''], ['Comité que asigna', e.comite_codigo || ''], ['Objetivo declarado', e.objetivo || '', 30], ['Fuera de alcance declarado', e.fuera_de_alcance || '', 22]])) +
      sec('2', 'Comprensión del encargo', 'En palabras del líder: demuestra que el encargo se entendió, no solo que se recibió.',
        datos([['¿Qué problema del negocio origina el encargo?', '', 34], ['¿Cómo sabremos que el proceso quedó bien? (resultado esperado)', '', 34], ['Riesgos o restricciones que ya se ven', '', 26]])) +
      sec('3', 'Observaciones a la ficha', 'Datos faltantes, dudas de alcance o plazo que deben aclararse con el comité que asigna.',
        cajaTexto(60, 'Si no hay observaciones, escribe "Sin observaciones".')) +
      sec('4', 'Resultado del control', 'Marca uno. Es el resultado OK / NO OK que se registra en la hoja de trabajo del ERP.',
        checklist(['OK — la ficha está completa y el encargo se entiende; se inicia la fase 1.', 'NO OK — faltan datos o hay dudas de fondo; se devuelve al comité que asigna (detallar en sección 3).'])) +
      sec('5', 'Firmas', '', aprobaciones([['Recibe', e.lider || '', 'Líder del comité de trabajo'], ['Entrega', '', `Responsable ${e.comite_codigo || 'comité que asigna'}`]]))
  },
  '1.2': {
    titulo: 'Informe de levantamiento inicial',
    cuerpo: e =>
      proposito('Entender el proceso desde quienes lo ejecutan, ANTES de conformar el equipo. Mínimo 2 actores clave entrevistados, con antecedentes revisados y hallazgos ordenados.') +
      instrucciones(['Revisa primero los antecedentes (sección 1): SOP previos, reclamos, datos del ERP o BSALE.', 'Usa la pauta de la sección 2 para cada entrevista; una fila por actor.', 'Separa hechos observados de opiniones en los hallazgos.']) +
      sec('1', 'Antecedentes revisados', 'Qué información existente se consultó antes de entrevistar.',
        tabla(['Fuente', 'Tipo (documento, dato, reclamo…)', 'Qué aporta'], [30, 25, 45], ['Reporte BSALE ventas por sucursal', 'Dato', 'Volumen mensual y sucursal con más casos'], 4)) +
      sec('2', 'Entrevistas a actores clave (mínimo 2)', 'Pauta: ¿qué haces paso a paso? ¿dónde se traba? ¿qué harías distinto? ¿con quién dependes?',
        tabla(['Actor', 'Cargo / sucursal', 'Fecha', 'Qué hace en el proceso', 'Dónde se traba / qué propone'], [16, 16, 9, 29, 30], ['Karla León', 'Cajera · La Granja', '15-09', 'Emite la boleta y coordina retiro', 'No sabe quién autoriza cambios; propone regla escrita'], 4, 34)) +
      sec('3', 'Hallazgos', 'Lo que funciona, lo que falla y los riesgos para el rediseño.',
        tabla(['Tipo', 'Hallazgo', 'Evidencia (quién / dato)'], [14, 56, 30], ['Falla', 'No existe responsable nominal de autorizar excepciones', 'Entrevistas 1 y 2'], 5, 24)) +
      sec('4', 'Implicancias para conformar el equipo', 'Qué perfiles o áreas deben estar en el comité según lo levantado.', cajaTexto(55)) +
      sec('5', 'Firmas', '', FIRMAS_LIDER(e))
  },
  '1.3': {
    titulo: 'Nómina del comité con vistos buenos',
    cuerpo: e =>
      proposito('Respaldar con firma el visto bueno de la jefatura directa de cada designado. La nómina también se registra en el ERP; este formato es la evidencia de los vistos buenos.') +
      instrucciones(['Reglas del método: número impar, mínimo 3 (incluido el líder), al menos una persona de otra área, máximo 4 comités simultáneos por persona.', 'Cada jefatura firma en su fila. Un designado sin visto bueno no integra el comité.']) +
      sec('1', 'Nómina y vistos buenos', 'Pre-llenado con las personas registradas hoy en el encargo; completa y agrega las que falten.',
        T(th('N°', 'Nombre', 'Área / cargo', 'Rol en el comité', 'Criterio de elección', 'Jefatura directa', 'V°B° (firma)') +
          integ(e).map((n, i) => `<tr>${td(String(i + 1), 'text-align:center;font-weight:bold;background:#f7f8fb')}${td(esc(n), 'height:24pt')}${td('')}${td(n === e.lider ? 'Líder' : '')}${td('')}${td('')}${td('')}</tr>`).join('') +
          filasVacias(Math.max(5 - integ(e).length, 2), 7, 24, i => String(integ(e).length + i)), [4, 17, 15, 11, 21, 15, 17])) +
      sec('2', 'Verificación de reglas', '', checklist(['Número impar y mínimo 3 integrantes.', 'Al menos una persona de otra dirección o área.', 'Nadie supera 4 comités simultáneos (revisado en el ERP).', 'Todos con visto bueno firmado.', 'Nómina registrada en el ERP con nombre, área y rol.'])) +
      sec('3', 'Firmas', '', FIRMAS_LIDER(e))
  },
  '1.4': {
    titulo: 'Convocatoria a sesión de constitución',
    cuerpo: e =>
      proposito('Convocar a todos los integrantes a la sesión de constitución con fecha, hora, modalidad y tabla, con al menos 48 horas de anticipación.') +
      sec('1', 'Datos de la sesión', '', datos([['Fecha y hora', ''], ['Duración estimada', '60 minutos'], ['Modalidad (presencial / remota / mixta)', ''], ['Lugar o enlace', ''], ['Fecha de envío de la convocatoria', ''], ['Medio de envío (correo, WhatsApp, calendario)', '']])) +
      sec('2', 'Tabla de la sesión', '', T(th('N°', 'Tema', 'Responsable', 'Min.') + [['1', 'Presentación del encargo: objetivo, plazo y reglas del método', e.lider || '', '10'], ['2', 'Verificación de quórum y designación del secretario de actas', e.lider || '', '5'], ['3', 'Alcance y exclusiones explícitas', 'Pleno', '20'], ['4', 'Plan de trabajo: hitos, fechas y responsables', 'Pleno', '20'], ['5', 'Firma del acta de encuadre', 'Secretario/a', '5']].map(r => `<tr>${td(r[0], 'text-align:center')}${td(esc(r[1]))}${td(esc(r[2]))}${td(r[3], 'text-align:center')}</tr>`).join(''), [6, 60, 22, 12])) +
      sec('3', 'Acuse de recibo de los convocados', 'Cada integrante firma o se adjunta el respaldo del envío.', asistencia(e, 2, false).replace('Asiste (P/A/J)', 'Confirma (S/N)')) +
      sec('4', 'Firmas', '', aprobaciones([['Convoca', e.lider || '', 'Líder del comité de trabajo']]))
  },

  /* ── FASE 2 · ENCUADRE ───────────────────────────────────────────────── */
  '2.1': {
    titulo: 'Registro de asistencia y quórum',
    cuerpo: e =>
      proposito('Verificar que la sesión tiene quórum (¾ de los integrantes con voto, redondeado hacia arriba) y que la composición cumple las reglas. Control crítico: sin quórum no hay sesión válida.') +
      sec('1', 'Sesión', '', datos([['Fecha y hora de inicio', ''], ['Lugar o enlace', ''], ['Integrantes con voto (total)', String(integ(e).length || '')], ['Quórum mínimo requerido (¾, redondeo arriba)', integ(e).length ? String(Math.ceil(integ(e).length * 0.75)) : '']])) +
      sec('2', 'Asistencia', 'P = presente · A = ausente · J = ausencia justificada.', asistencia(e, 3)) +
      sec('3', 'Resultado del control', 'Es la decisión SÍ / NO del paso 2.1 en la hoja de trabajo.',
        checklist(['SÍ hay quórum — presentes con voto ≥ mínimo requerido; la sesión continúa.', 'NO hay quórum — se levanta la sesión y se reconvoca (anotar nueva fecha abajo).']) + datos([['Nueva fecha (si no hubo quórum)', '']])) +
      sec('4', 'Firmas', '', FIRMAS_PLENO(e))
  },
  '2.2': {
    titulo: 'Designación del secretario de actas',
    cuerpo: e =>
      proposito('Designar por nombre (no "el área") a la persona que llevará las actas del comité, con su aceptación firmada.') +
      sec('1', 'Designación', '', datos([['Nombre del secretario/a designado/a', e.secretario || ''], ['Cargo / área', ''], ['Suplente (en caso de ausencia)', ''], ['Fecha de designación', '']])) +
      sec('2', 'Responsabilidades aceptadas', '', checklist(['Levantar el acta de cada sesión y circularla en máximo 48 horas.', 'Registrar asistencia, decisiones y votaciones en el ERP.', 'Custodiar la versión vigente de los documentos del comité.', 'Redactar el SOP y sus anexos según lo acordado por el pleno (fase 4).'])) +
      sec('3', 'Firmas', '', aprobaciones([['Designa', e.lider || '', 'Líder del comité de trabajo'], ['Acepta', e.secretario || '', 'Secretario/a de actas']]))
  },
  '2.3': {
    titulo: 'Plan de trabajo y marco referencial',
    cuerpo: e =>
      proposito('Acordar hitos y fechas por fase, con una persona responsable por tarea. El plan es la base contra la que se mide el avance del encargo.') +
      sec('1', 'Marco referencial', 'Normas, SOP relacionados, sistemas y restricciones que el diseño debe respetar.',
        tabla(['Referencia', 'Tipo', 'Cómo condiciona el trabajo'], [30, 18, 52], ['SOP P07 Abastecimiento', 'SOP vigente', 'El nuevo proceso no puede duplicar la aprobación de OC'], 3)) +
      sec('2', 'Plan por fase', `Plazo total del encargo: ${e.fecha_limite ? piezas.fF(e.fecha_limite) : '—'}.`,
        T(th('Fase', 'Hito / entregable', 'Responsable', 'Inicio', 'Término') +
          [['3 · Diagnóstico', 'Informe de diagnóstico validado'], ['4 · Diseño', 'Borrador SOP + Ficha KPI votados'], ['5 · Piloto', 'Informe de piloto (≥ 14 días)'], ['6 · Validación', 'SOP aprobado por directorio'], ['7 · Implementación', 'Capacitación + KPI activo + cierre']]
            .map(r => `<tr>${td(`<b>${esc(r[0])}</b>`, 'background:#f7f8fb')}${td(esc(r[1]))}${td('', 'height:20pt')}${td('')}${td('')}</tr>`).join(''), [18, 36, 20, 13, 13])) +
      sec('3', 'Tareas asignadas', 'Una tarea = una persona responsable por nombre.',
        tabla(['N°', 'Tarea', 'Responsable', 'Fecha compromiso'], [6, 54, 24, 16], ['', 'Entrevistar a jefes de tienda de las 3 sucursales', 'David Bascur', '30-09'], 6, 20, true)) +
      sec('4', 'Firmas', '', FIRMAS_PLENO(e))
  },
  '2.4': {
    titulo: 'Acta de encuadre',
    cuerpo: e =>
      proposito('Fijar por escrito objetivo, alcance con exclusiones, integrantes y roles, periodicidad, fecha límite y quórum. Firmada por todos, cierra la fase 2.') +
      sec('1', 'Objetivo y alcance', '', datos([['Objetivo del comité', e.objetivo || '', 30], ['Alcance: el proceso empieza en…', '', 18], ['…y termina en…', '', 18], ['Exclusiones explícitas (qué NO se abordará)', e.fuera_de_alcance || '', 30]])) +
      sec('2', 'Reglas de funcionamiento', '', datos([['Periodicidad de sesiones', ''], ['Día / hora habitual', ''], ['Quórum (¾ con voto)', integ(e).length ? `${Math.ceil(integ(e).length * 0.75)} de ${integ(e).length}` : ''], ['Fecha límite del encargo', e.fecha_limite ? piezas.fF(e.fecha_limite) : ''], ['Regla de decisión', 'Mayoría simple de presentes con voto']])) +
      sec('3', 'Integrantes, roles y firmas', 'Todos firman: la firma es aceptación del encuadre.', asistencia(e, 2).replace('Asiste (P/A/J)', 'Acepta')) +
      sec('4', 'Firmas del acta', '', FIRMAS_PLENO(e))
  },

  /* ── FASE 3 · DIAGNÓSTICO ────────────────────────────────────────────── */
  '3.1': {
    titulo: 'Informe de levantamiento con interlocutores',
    cuerpo: e =>
      proposito('Registrar cómo funciona HOY el proceso según quienes lo ejecutan, lo reciben y lo controlan. Base del diagnóstico.') +
      sec('1', 'SIPOC del proceso actual', 'Proveedores → Entradas → Proceso → Salidas → Clientes.',
        tabla(['Proveedores', 'Entradas', 'Proceso (pasos gruesos)', 'Salidas', 'Clientes'], [20, 20, 20, 20, 20], ['Bodega CD Maipú', 'Guía de despacho', 'Recibir y revisar', 'Stock ingresado', 'Sucursal'], 4, 30)) +
      sec('2', 'Interlocutores consultados', '',
        tabla(['Nombre', 'Rol en el proceso', 'Fecha', 'Principales declaraciones'], [18, 18, 10, 54], ['Rocío Jara', 'Controla', '22-09', 'Los ingresos se registran sin firma de quien recibe'], 5, 30)) +
      sec('3', 'Síntesis', 'Qué se repite entre interlocutores y qué contradicciones aparecieron.', cajaTexto(70)) +
      sec('4', 'Firmas', '', FIRMAS_LIDER(e))
  },
  '3.2': {
    titulo: 'Batería de herramientas de diagnóstico',
    cuerpo: e =>
      proposito('Diseñar las herramientas con que se medirá el proceso en terreno: qué se pregunta, qué se observa y qué dato se registra, para que el diagnóstico se base en evidencia y no en opinión.') +
      sec('1', 'Herramientas', '', tabla(['Herramienta', 'Qué mide', 'A quién / dónde se aplica', 'Muestra', 'Responsable'], [18, 28, 22, 12, 20], ['Checklist de observación', 'Pasos que se saltan en la recepción', 'Bodega Maipú y La Granja', '20 recepciones', 'Francisco Cid'], 4, 24)) +
      sec('2', 'Cuestionario (preguntas)', 'Preguntas cerradas cuando se quiere contar, abiertas cuando se quiere entender.',
        tabla(['N°', 'Pregunta', 'Tipo (cerrada / abierta / escala)'], [6, 70, 24], ['', '¿Cuántas veces en la última semana tuvo que pedir autorización fuera del sistema?', 'Cerrada (número)'], 8, 20, true)) +
      sec('3', 'Checklist de observación', '', tabla(['N°', 'Qué se observa', 'Cumple (S/N)', 'Observación'], [6, 54, 12, 28], null, 8, 18, true)) +
      sec('4', 'Aprobación de la batería', '', FIRMAS_PLENO(e))
  },
  '3.3': {
    titulo: 'Planilla de registro de campo',
    cuerpo: e =>
      proposito('Registrar los datos obtenidos al aplicar las herramientas en terreno. Una fila por observación o encuesta; se adjunta también la planilla digital si existe.') +
      sec('1', 'Aplicación', '', datos([['Herramienta aplicada', ''], ['Lugar / sucursal', ''], ['Período de aplicación', ''], ['Aplicado por', '']])) +
      sec('2', 'Registros', '', tabla(['N°', 'Fecha', 'Sucursal / lugar', 'Caso u observación', 'Dato / resultado', 'Registra'], [5, 9, 15, 35, 20, 16], ['', '23-09', 'Maipú', 'Recepción OC-NAC-000112', 'Sin firma de quien recibe', 'F. Cid'], 14, 18, true)) +
      sec('3', 'Cuaderno de campo', 'Lo que no cabe en la tabla: contexto, incidentes, citas textuales.', cajaTexto(80)) +
      sec('4', 'Firmas', '', aprobaciones([['Aplica', '', 'Integrante del comité'], ['Revisa', e.lider || '', 'Líder del comité de trabajo']]))
  },
  '3.4': {
    titulo: 'Informe de diagnóstico',
    cuerpo: e =>
      proposito('Describir el proceso as-is y sus 3 causas raíz priorizadas, sustentadas en los datos del levantamiento. Extensión: 1–2 páginas.') +
      sec('1', 'Proceso actual (as-is)', 'Pasos reales como se ejecutan hoy, no como deberían ser.',
        tabla(['N°', 'Paso actual', 'Quién', 'Problema observado'], [6, 40, 18, 36], null, 7, 18, true)) +
      sec('2', 'Quiebres detectados', '', tabla(['N°', 'Quiebre', 'Frecuencia / dato', 'Impacto'], [6, 44, 25, 25], ['', 'Stock ingresado sin validación física', '8 de 20 recepciones', 'Descuadre de inventario'], 5, 20, true)) +
      sec('3', 'Análisis de causa raíz (5 porqués)', 'Para cada quiebre principal: pregunta "¿por qué?" hasta llegar a una causa sobre la que se pueda actuar.',
        tabla(['Quiebre', '¿Por qué? 1', '¿Por qué? 2', '¿Por qué? 3', 'Causa raíz'], [20, 20, 20, 20, 20], null, 3, 34)) +
      sec('4', 'Causas raíz priorizadas', '', escala('Impacto / Esfuerzo', [['A', 'alto'], ['M', 'medio'], ['B', 'bajo']]) +
        tabla(['Prioridad', 'Causa raíz', 'Impacto (A/M/B)', 'Esfuerzo (A/M/B)'], [12, 58, 15, 15], null, 3, 22)) +
      sec('5', 'Firmas', '', FIRMAS_LIDER(e))
  },
  '3.5': {
    titulo: 'Acta de validación del diagnóstico',
    cuerpo: e =>
      proposito('Someter el diagnóstico a votación del pleno. Solo un diagnóstico aprobado habilita el diseño (fase 4).') +
      sec('1', 'Sesión', '', datos([['Fecha', ''], ['Versión del diagnóstico presentada', '']])) +
      sec('2', 'Votación', '', votacion(e, 'Aprobación del informe de diagnóstico y sus 3 causas raíz')) +
      sec('3', 'Observaciones y ajustes acordados', '', cajaTexto(55)) +
      sec('4', 'Firmas', '', FIRMAS_PLENO(e))
  },

  /* ── FASE 4 · DISEÑO ─────────────────────────────────────────────────── */
  '4.1': {
    titulo: 'Matriz quiebre → solución',
    cuerpo: e =>
      proposito('Asegurar que cada quiebre del diagnóstico tenga una respuesta en el diseño. Un quiebre sin solución es un diseño incompleto.') +
      sec('1', 'Matriz', '', tabla(['N°', 'Quiebre del diagnóstico', 'Qué parte del diseño lo resuelve', 'Paso del nuevo flujo', 'Responsable'], [5, 28, 35, 14, 18], ['', 'Stock ingresado sin validación', 'Doble firma en la recepción', 'Paso 3', 'Jefe de bodega'], 7, 24, true)) +
      sec('2', 'Quiebres que NO se resolverán (y por qué)', '', cajaTexto(45, 'Si todos se resuelven, escribe "Todos resueltos".')) +
      sec('3', 'Firmas', '', FIRMAS_PLENO(e))
  },
  '4.2': {
    titulo: 'Objetivo del proceso y criterio de cumplimiento',
    cuerpo: e =>
      proposito('Formular el objetivo del proceso de modo verificable: qué, para quién, con qué estándar y cómo se sabe que se cumplió.') +
      sec('1', 'Objetivo', 'Estructura: verbo + qué + para quién + estándar.', datos([['Objetivo del proceso', '', 34], ['Criterio de cumplimiento (cómo se verifica)', '', 30], ['Meta cuantitativa asociada', ''], ['Plazo o frecuencia de verificación', '']])) +
      sec('2', 'Prueba de calidad del objetivo', '', checklist(['Es específico: dice qué y para quién.', 'Es medible: tiene estándar o meta numérica.', 'Es alcanzable con los recursos del proceso.', 'Responde a las causas raíz del diagnóstico.', 'Tiene plazo o frecuencia de medición.'])) +
      sec('3', 'Aprobación en acta', '', FIRMAS_PLENO(e))
  },
  '4.3': {
    titulo: 'Borrador del flujo futuro (to-be)',
    cuerpo: e =>
      proposito('Definir el nuevo flujo paso a paso, con responsable, sistema y tiempo de cada paso, y marcar decisiones y controles críticos. Se transcribe después al diseñador del ERP.') +
      sec('1', 'Flujo', 'D = decisión (SÍ/NO) · CC = control crítico.', tabla(['N°', 'Acción', 'Responsable', 'Sistema', 'Tiempo', 'D / CC', 'Si SÍ → / Si NO →'], [5, 31, 15, 11, 9, 8, 21], ['', 'Validar cantidades contra guía', 'Bodeguero', 'ERP', '15 min', 'D', 'Paso 4 / Paso 3b'], 12, 20, true)) +
      sec('2', 'Esquema a mano alzada (opcional)', 'Dibuja aquí el flujo si ayuda a la discusión.', cajaTexto(160)) +
      sec('3', 'Firmas', '', FIRMAS_PLENO(e))
  },
  '4.4': {
    titulo: 'Tabla de roles, alcances y límites (RACI)',
    cuerpo: e =>
      proposito('Dejar claro quién hace, quién aprueba, a quién se consulta y a quién se informa en cada actividad, y hasta dónde llega cada rol.') +
      sec('1', 'Matriz RACI', '', escala('Clave', [['R', 'ejecuta'], ['A', 'aprueba / responde'], ['C', 'se consulta'], ['I', 'se informa']]) +
        tabla(['Actividad', 'Rol 1: ______', 'Rol 2: ______', 'Rol 3: ______', 'Rol 4: ______'], [36, 16, 16, 16, 16], null, 8, 18)) +
      sec('2', 'Alcances y limitaciones por rol', '', tabla(['Rol', 'Puede (alcance)', 'No puede (límite)', 'Escala a'], [18, 32, 32, 18], ['Jefe de tienda', 'Aprobar cambios hasta $50.000', 'Anular documentos tributarios', 'Gerencia'], 5, 22)) +
      sec('3', 'Firmas', '', FIRMAS_PLENO(e))
  },
  '4.5': {
    titulo: 'Matriz de casos de excepción',
    cuerpo: e =>
      proposito('Resolver por anticipado al menos 3 casos que se salen del flujo normal, para que el SOP diga qué hacer cuando "lo normal" no aplica.') +
      sec('1', 'Casos de excepción (mínimo 3)', '', tabla(['N°', 'Situación de excepción', 'Frecuencia estimada', 'Cómo se resuelve', 'Quién decide'], [5, 30, 14, 34, 17], ['', 'Proveedor entrega sin guía de despacho', '2 al mes', 'Se recibe en custodia, no se ingresa stock hasta tener guía', 'Jefe de bodega'], 5, 26, true)) +
      sec('2', 'Aprobación en acta', '', FIRMAS_PLENO(e))
  },
  '4.6': {
    titulo: 'Ficha de KPI del proceso',
    cuerpo: e =>
      proposito('Definir el indicador con que se medirá el proceso: fórmula, fuente, línea base, meta, frecuencia y responsable. Es la ficha que se activa en la fase 7.') +
      sec('1', 'Definición', '', datos([['Nombre del indicador', ''], ['Qué mide y por qué importa', '', 26], ['Fórmula (numerador / denominador)', '', 22], ['Unidad', ''], ['Fuente del dato (sistema / reporte)', ''], ['Línea base actual (valor y fecha)', ''], ['Meta', ''], ['Umbrales', 'Verde ≥ ____   ·   Amarillo ____ a ____   ·   Rojo < ____'], ['Frecuencia de medición', ''], ['Responsable de medir', ''], ['Responsable de actuar si está en rojo', '']])) +
      sec('2', 'Prueba de calidad del KPI', '', checklist(['La fórmula es reproducible por otra persona con la misma fuente.', 'La línea base se calculó con datos reales, no estimados.', 'La meta es coherente con el objetivo del proceso (paso 4.2).', 'El responsable de medir aceptó la tarea.'])) +
      sec('3', 'Firmas', '', aprobaciones([['Elabora', e.lider || '', 'Líder del comité de trabajo'], ['Acepta medir', '', 'Responsable de medición']]))
  },
  '4.7': {
    titulo: 'Índice y control de anexos del proceso',
    cuerpo: e =>
      proposito('Listar y controlar los anexos del SOP (formularios, planillas, instructivos, plantillas), con su código, versión y responsable de redacción.') +
      sec('1', 'Anexos', '', tabla(['Código', 'Nombre del anexo', 'Tipo', 'Paso del SOP que lo usa', 'Versión', 'Redacta', 'Estado'], [10, 26, 13, 15, 8, 15, 13], ['A1', 'Planilla de recepción con doble firma', 'Formulario', 'Paso 3', 'v0.1', 'Secretario/a', 'Borrador'], 8, 20)) +
      sec('2', 'Firmas', '', FIRMAS_LIDER(e))
  },
  '4.8': {
    titulo: 'Control de versión del borrador SOP',
    cuerpo: e =>
      proposito('Dejar constancia de la versión del SOP y del flujograma guardada en el ERP y de los cambios respecto de la versión anterior.') +
      sec('1', 'Versión', '', datos([['Código del documento en el ERP', `DOC-SOP-${e.proceso_id || ''}-v__`], ['Versión', ''], ['Fecha de guardado en el ERP', ''], ['Flujograma guardado (S/N)', '']])) +
      sec('2', 'Historial de cambios', '', tabla(['Versión', 'Fecha', 'Cambio realizado', 'Motivo', 'Autor'], [10, 11, 38, 25, 16], ['v0.2', '10-10', 'Se agrega paso de doble firma', 'Quiebre 1 del diagnóstico', 'Secretario/a'], 5, 20)) +
      sec('3', 'Revisión de contenido mínimo', '', checklist(['Objetivo y alcance (con exclusiones).', 'Roles y responsabilidades.', 'Flujo paso a paso con decisiones y controles críticos.', 'Casos de excepción.', 'KPI con ficha.', 'Anexos referenciados.'])) +
      sec('4', 'Firmas', '', FIRMAS_LIDER(e))
  },
  '4.9': {
    titulo: 'Acta de votación del borrador SOP',
    cuerpo: e =>
      proposito('Someter el borrador del SOP a votación del pleno. Aprobado, pasa a piloto.') +
      sec('1', 'Sesión', '', datos([['Fecha', ''], ['Versión del SOP votada', '']])) +
      sec('2', 'Votación', '', votacion(e, 'Aprobación del borrador SOP para pasar a piloto')) +
      sec('3', 'Ajustes comprometidos antes del piloto', '', cajaTexto(50)) +
      sec('4', 'Firmas', '', FIRMAS_PLENO(e))
  },

  /* ── FASE 5 · PILOTO ─────────────────────────────────────────────────── */
  '5.1': {
    titulo: 'Ficha del piloto',
    cuerpo: e =>
      proposito('Definir dónde, cuándo y cómo se probará el SOP, con criterios de éxito fijados ANTES de empezar. Duración mínima: 14 días.') +
      sec('1', 'Diseño del piloto', '', datos([['Unidad piloto (sucursal / área)', ''], ['Por qué es representativa (no la más fácil)', '', 26], ['Fecha de inicio', ''], ['Fecha de término (≥ 14 días)', ''], ['Participantes que ejecutan', '', 22], ['KPI a observar (de la Ficha 4.6)', ''], ['Línea base del KPI', '']])) +
      sec('2', 'Criterios de éxito (definidos antes)', '', tabla(['Criterio', 'Umbral de éxito', 'Cómo se mide'], [40, 25, 35], ['Recepciones con doble firma', '≥ 90%', 'Revisión de planillas A1'], 4, 22)) +
      sec('3', 'Riesgos y plan de contingencia', '', tabla(['Riesgo', 'Qué se hará si ocurre'], [45, 55], null, 3, 22)) +
      sec('4', 'Firmas', '', FIRMAS_PLENO(e))
  },
  '5.2': {
    titulo: 'Registro de capacitación del piloto',
    cuerpo: e =>
      proposito('Dejar constancia de que quienes ejecutan el piloto fueron capacitados en el SOP antes de empezar.') +
      sec('1', 'Capacitación', '', datos([['Fecha y hora', ''], ['Lugar / modalidad', ''], ['Relator/a', ''], ['Duración', ''], ['Contenidos tratados', '', 30]])) +
      sec('2', 'Asistentes', '', tabla(['N°', 'Nombre', 'Cargo / sucursal', 'RUT', 'Firma'], [5, 30, 25, 15, 25], null, 10, 22, true)) +
      sec('3', 'Firmas', '', aprobaciones([['Relator/a', '', 'Integrante asignado'], ['Revisa', e.lider || '', 'Líder del comité de trabajo']]))
  },
  '5.3': {
    titulo: 'Bitácora del piloto e incidencias',
    cuerpo: e =>
      proposito('Registrar día a día la ejecución del piloto: cuántos casos, qué incidencias y qué desviaciones del SOP ocurrieron. Control crítico: sin bitácora no hay piloto evaluable.') +
      sec('1', 'Registro diario', '', tabla(['Fecha', 'Casos ejecutados', 'Con SOP completo', 'Incidencias (N°)', 'Registra'], [16, 18, 18, 18, 30], ['24-10', '12', '10', '2', 'D. Bascur'], 14, 18)) +
      sec('2', 'Detalle de incidencias', '', tabla(['N°', 'Fecha', 'Qué pasó', 'Paso del SOP', 'Cómo se resolvió'], [5, 10, 35, 14, 36], ['', '24-10', 'Proveedor llegó sin guía', 'Paso 2', 'Se aplicó excepción 1'], 8, 22, true)) +
      sec('3', 'Firmas', '', aprobaciones([['Registra', '', 'Participante del piloto'], ['Revisa', e.lider || '', 'Líder del comité de trabajo']]))
  },
  '5.4': {
    titulo: 'Informe del piloto',
    cuerpo: e =>
      proposito('Evaluar el piloto contra los criterios de éxito y el KPI: antes vs durante, incidencias y ajustes necesarios al SOP.') +
      sec('1', 'Resumen', '', datos([['Unidad piloto', ''], ['Período (fechas)', ''], ['Días de ejecución', ''], ['Casos totales', '']])) +
      sec('2', 'KPI antes / durante', '', tabla(['Indicador', 'Línea base (antes)', 'Resultado piloto', 'Meta', '¿Cumple?'], [30, 17, 17, 17, 19], null, 3, 22)) +
      sec('3', 'Criterios de éxito', '', tabla(['Criterio', 'Umbral', 'Resultado', '¿Cumple?'], [40, 18, 22, 20], null, 4, 20)) +
      sec('4', 'Incidencias y ajustes al SOP', '', tabla(['Incidencia recurrente', 'Ajuste propuesto al SOP'], [45, 55], null, 4, 22)) +
      sec('5', 'Conclusión', 'Recomendación del líder al pleno.', checklist(['Aprobar el SOP sin cambios.', 'Aprobar el SOP con los ajustes de la sección 4.', 'Repetir el piloto (indicar motivo).']) + cajaTexto(40)) +
      sec('6', 'Firmas', '', FIRMAS_LIDER(e))
  },
  '5.5': {
    titulo: 'Acta de validación del piloto',
    cuerpo: e =>
      proposito('Validar en pleno que el piloto cumplió los objetivos y resolvió los quiebres del diagnóstico.') +
      sec('1', 'Quiebres del diagnóstico', '¿Quedó resuelto cada uno?', tabla(['Quiebre', 'Resuelto (S/N/Parcial)', 'Evidencia del piloto'], [40, 18, 42], null, 4, 22)) +
      sec('2', 'Votación', '', votacion(e, 'Validación de los resultados del piloto y envío al directorio')) +
      sec('3', 'Firmas', '', FIRMAS_PLENO(e))
  },
  '5.6': {
    titulo: 'Informe de cierre del comité al directorio',
    cuerpo: e =>
      proposito('Entregar al directorio un expediente completo y breve para que pueda estudiar y aprobar el SOP.') +
      sec('1', 'Resumen ejecutivo', 'Máximo media página: problema, solución, resultado del piloto.', cajaTexto(90)) +
      sec('2', 'Documentos que se envían', '', checklist(['Informe de diagnóstico (3.4).', 'SOP versión final y flujograma (4.8).', 'Ficha de KPI (4.6).', 'Anexos del proceso (4.7).', 'Informe del piloto (5.4).', 'Actas de votación (3.5, 4.9, 5.5).'])) +
      sec('3', 'Envío', '', datos([['Fecha de envío', ''], ['Enviado a', ''], ['Medio', '']])) +
      sec('4', 'Firmas', '', aprobaciones([['Envía', e.lider || '', 'Líder del comité de trabajo'], ['Recibe', '', 'Secretaría del directorio']]))
  },

  /* ── FASE 6 · VALIDACIÓN ─────────────────────────────────────────────── */
  '6.1': {
    titulo: 'Recepción del informe y agenda de presentación',
    cuerpo: e =>
      proposito('Dejar constancia de que el directorio recibió el expediente y agendó la presentación del SOP.') +
      sec('1', 'Recepción', '', datos([['Fecha de recepción', ''], ['Recibido por', ''], ['¿Expediente completo? (S/N)', ''], ['Documentos faltantes (si los hay)', '', 22]])) +
      sec('2', 'Presentación agendada', '', datos([['Fecha y hora', ''], ['Lugar / enlace', ''], ['Tiempo asignado', '']])) +
      sec('3', 'Firmas', '', aprobaciones([['Recibe', '', 'Secretaría del directorio']]))
  },
  '6.2': {
    titulo: 'Cuestionario y rúbrica de aprobación',
    cuerpo: e =>
      proposito('Preparar las preguntas dirigidas del directorio y la rúbrica con puntaje y umbral con que se decidirá la aprobación.') +
      sec('1', 'Preguntas dirigidas', '', tabla(['N°', 'Pregunta', 'Dirigida a', 'Documento de referencia'], [5, 55, 18, 22], null, 8, 20, true)) +
      sec('2', 'Rúbrica', 'Puntaje 1 a 4 por criterio. Umbral de aprobación: promedio ≥ 3 y ningún criterio en 1.',
        escala('Puntaje', [['1', 'no cumple'], ['2', 'cumple parcialmente'], ['3', 'cumple'], ['4', 'destaca']]) +
        T(th('Criterio', 'Peso', 'Puntaje (1–4)', 'Comentario') + ['El diagnóstico se sustenta en datos', 'El diseño resuelve las causas raíz', 'Roles y límites son claros', 'El piloto demuestra resultados', 'El KPI es medible y tiene responsable', 'El SOP es ejecutable por quien no lo diseñó']
          .map(c => `<tr>${td(esc(c))}${td('', 'height:20pt')}${td('')}${td('')}</tr>`).join('') + `<tr>${td('<b>Promedio</b>', 'background:#eef0f5')}${td('')}${td('')}${td('')}</tr>`, [44, 10, 14, 32])) +
      sec('3', 'Firmas', '', aprobaciones([['Elabora', '', 'Comité de directorio']]))
  },
  '6.3': {
    titulo: 'Pauta de presentación al directorio',
    cuerpo: e =>
      proposito('Estructurar la presentación del SOP al directorio y registrar las preguntas recibidas y sus respuestas.') +
      sec('1', 'Estructura de la presentación', '', T(th('N°', 'Bloque', 'Presenta', 'Min.') + [['1', 'Problema y diagnóstico (causas raíz)'], ['2', 'Nuevo proceso: flujo, roles y excepciones'], ['3', 'Resultados del piloto y KPI'], ['4', 'Plan de implementación y capacitación'], ['5', 'Preguntas del directorio']].map(r => `<tr>${td(r[0], 'text-align:center')}${td(esc(r[1]))}${td('', 'height:20pt')}${td('')}</tr>`).join(''), [6, 60, 22, 12])) +
      sec('2', 'Preguntas y respuestas', '', tabla(['Pregunta del directorio', 'Respuesta dada', 'Compromiso (si aplica)'], [36, 40, 24], null, 6, 26)) +
      sec('3', 'Firmas', '', aprobaciones([['Presenta', e.lider || '', 'Líder del comité de trabajo']]))
  },
  '6.4': {
    titulo: 'Acta de deliberación y votación del directorio',
    cuerpo: e =>
      proposito('Registrar la deliberación del directorio, el puntaje de la rúbrica y la votación de aprobación del SOP.') +
      sec('1', 'Sesión', '', datos([['Fecha', ''], ['Versión del SOP evaluada', ''], ['Puntaje promedio de la rúbrica', '']])) +
      sec('2', 'Votación', '', datos([['Materia', `Aprobación del SOP ${e.proceso_id || ''} · ${e.proceso_nombre || ''}`, 22], ['Resultado', 'APROBADO  ☐     APROBADO CON CONDICIONES  ☐     RECHAZADO  ☐']]) +
        tabla(['Director/a', 'A favor', 'En contra', 'Abstención', 'Fundamento'], [24, 9, 9, 10, 48], null, 5, 20)) +
      sec('3', 'Condiciones u observaciones', '', cajaTexto(55)) +
      sec('4', 'Firmas', '', aprobaciones([['Preside', '', 'Presidente del directorio'], ['Fe del acta', '', 'Secretario/a del directorio']]))
  },
  '6.5': {
    titulo: 'Hoja de firmas de aprobación del SOP',
    cuerpo: e =>
      proposito('Firmar el SOP aprobado y dejar constancia de su publicación como vigente en el módulo Procesos. Control crítico: sin firma no hay SOP vigente.') +
      sec('1', 'Documento aprobado', '', datos([['Código y versión', `SOP-${e.proceso_id || ''} v____`], ['Fecha de aprobación', ''], ['Fecha de entrada en vigencia', ''], ['Publicado en el ERP como VIGENTE (S/N)', '']])) +
      sec('2', 'Firmas de aprobación', '', aprobaciones([['Elabora', e.lider || '', 'Líder del comité de trabajo'], ['Revisa', '', 'Dueño del proceso'], ['Aprueba', '', 'Directorio'], ['Aprueba', '', 'Directorio']]))
  },

  /* ── FASE 7 · IMPLEMENTACIÓN Y CIERRE ────────────────────────────────── */
  '7.1': {
    titulo: 'Plan de capacitación',
    cuerpo: e =>
      proposito('Planificar la capacitación formal en el SOP vigente: destinatarios nominales, contenido, modalidad (≤ 90 minutos) y materiales.') +
      sec('1', 'Datos', '', datos([['Fecha(s) y hora', ''], ['Modalidad y lugar', ''], ['Duración (≤ 90 min)', ''], ['Relator/a', '']])) +
      sec('2', 'Destinatarios nominales', '', tabla(['N°', 'Nombre', 'Cargo / sucursal', 'Por qué debe asistir'], [5, 30, 25, 40], null, 10, 18, true)) +
      sec('3', 'Contenidos', '', tabla(['N°', 'Tema', 'Min.', 'Material'], [5, 60, 10, 25], ['', 'Flujo nuevo y controles críticos', '30', 'Flujograma impreso'], 6, 18, true)) +
      sec('4', 'Evaluación de aprendizaje', 'Cómo se verificará que se entendió (quiz, caso práctico, observación).', cajaTexto(40)) +
      sec('5', 'Firmas', '', FIRMAS_LIDER(e))
  },
  '7.2': {
    titulo: 'Registro de asistencia a capacitación',
    cuerpo: e =>
      proposito('Registro con firma y fecha de quienes fueron capacitados en el SOP. Control crítico: la cobertura debe ser ≥ 80% de los destinatarios.') +
      sec('1', 'Capacitación', '', datos([['SOP', `${e.proceso_id || ''} · ${e.proceso_nombre || ''}`], ['Fecha y hora', ''], ['Relator/a', ''], ['Duración real', '']])) +
      sec('2', 'Asistentes', '', tabla(['N°', 'Nombre', 'Cargo / sucursal', 'RUT', 'Evaluación (nota o ✓)', 'Firma'], [5, 26, 21, 13, 12, 23], null, 14, 22, true)) +
      sec('3', 'Cobertura', '', datos([['Destinatarios convocados', ''], ['Asistentes', ''], ['Cobertura (%)', ''], ['Plan para los ausentes', '', 22]])) +
      sec('4', 'Firmas', '', aprobaciones([['Relator/a', '', ''], ['Revisa', e.lider || '', 'Líder del comité de trabajo']]))
  },
  '7.3': {
    titulo: 'Acta de activación del KPI',
    cuerpo: e =>
      proposito('Activar el KPI definido en la Ficha 4.6: responsable de medir asignado y primera medición registrada en el ERP.') +
      sec('1', 'KPI', '', datos([['Indicador (de la Ficha 4.6)', ''], ['Fórmula', ''], ['Meta', ''], ['Frecuencia', ''], ['Responsable de medir', '']])) +
      sec('2', 'Primera medición', '', tabla(['Fecha', 'Numerador', 'Denominador', 'Resultado', 'Estado (verde/amarillo/rojo)', 'Registrado en ERP (S/N)'], [13, 15, 15, 15, 22, 20], null, 2, 22)) +
      sec('3', 'Firmas', '', aprobaciones([['Activa', e.lider || '', 'Líder del comité de trabajo'], ['Acepta', '', 'Responsable de medir']]))
  },
  '7.4': {
    titulo: 'Verificación de criterios de cierre',
    cuerpo: e =>
      proposito('Verificar con evidencia los 3 criterios de cierre del encargo. Es la decisión SÍ / NO del paso 7.4.') +
      sec('1', 'Criterios', '', T(th('Criterio', 'Evidencia', 'Cumple (S/N)') + [['Capacitación ejecutada con registro (≥ 80% cobertura)', 'Formato 7.2'], ['KPI con responsable y primera medición en el ERP', 'Formato 7.3'], ['SOP vigente publicado en el módulo Procesos', 'Formato 6.5']].map(r => `<tr>${td(esc(r[0]))}${td(esc(r[1]))}${td('', 'height:22pt')}</tr>`).join(''), [55, 25, 20])) +
      sec('2', 'Resultado', '', checklist(['SÍ — se cumplen los 3 criterios: pasa a cierre formal (7.5).', 'NO — falta al menos uno: se completa antes de cerrar (detallar abajo).']) + cajaTexto(40)) +
      sec('3', 'Firmas', '', FIRMAS_LIDER(e))
  },
  '7.5': {
    titulo: 'Acta de cierre y plan de acompañamiento 60 días',
    cuerpo: e =>
      proposito('Cerrar formalmente el encargo: traspaso del proceso a su dueño, acuerdos de seguimiento y plan de acompañamiento de 60 días.') +
      sec('1', 'Traspaso', '', datos([['Dueño que recibe el proceso', ''], ['Fecha de traspaso', ''], ['Documentos entregados', 'SOP vigente · Flujograma · Anexos · Ficha KPI', 22]])) +
      sec('2', 'Plan de acompañamiento (60 días)', '', tabla(['Semana / fecha', 'Actividad de seguimiento', 'Responsable', 'Resultado esperado'], [16, 40, 20, 24], ['Día 15', 'Revisar KPI y bitácora de incidencias', 'Dueño del proceso', 'KPI en verde'], 5, 22)) +
      sec('3', 'Lecciones aprendidas', 'Para mejorar el método en próximos encargos.', tabla(['Qué funcionó', 'Qué mejorar', 'Recomendación'], [33, 33, 34], null, 3, 26)) +
      sec('4', 'Firmas', '', aprobaciones([['Entrega', e.lider || '', 'Líder del comité de trabajo'], ['Recibe', '', 'Dueño del proceso'], ['Fe del acta', e.secretario || '', 'Secretario/a de actas'], ['Toma conocimiento', '', `Responsable ${e.comite_codigo || 'comité que asigna'}`]]))
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
const clave = (fase, paso) => `${+fase}.${+paso.orden}`

/** ¿Este paso tiene formato de evidencia? */
export const formatoDePaso = (fase, paso) => {
  const f = paso ? F[clave(fase, paso)] : null
  return f ? { codigo: `F${clave(fase, paso)}`, titulo: f.titulo } : null
}

function htmlPaso(fase, paso, enc) {
  const k = clave(fase, paso), f = F[k]
  if (!f) return null
  return shell(fase, `F${k}`, f.titulo, enc || {}, f.cuerpo(enc || {}), {
    subtitulo: `Fase ${fase} · Paso ${k}`,
    nota: `Evidencia del paso ${k} («${paso.accion || ''}»). Llénelo en Word o a mano, fírmelo, expórtelo o escanéelo a PDF y cárguelo en ese paso de la hoja de trabajo (Procesos → Comités de trabajo).`
  })
}

/** Descarga el formato del paso como .doc editable en Word. */
export function descargarFormatoPaso(fase, paso, enc) {
  const html = htmlPaso(fase, paso, enc)
  if (!html) return false
  descargar(`F${clave(fase, paso)}_${enc?.proceso_id || 'P'}_${(F[clave(fase, paso)].titulo).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_')}.doc`, html, 'application/msword;charset=utf-8')
  return true
}

/** Abre el formato en una pestaña lista para imprimir (o guardar como PDF). */
export function imprimirFormatoPaso(fase, paso, enc) {
  const html = htmlPaso(fase, paso, enc)
  if (!html) return false
  const barra = `<style>@media print{.no-print{display:none!important}@page{size:A4;margin:12mm}} body{margin:24pt 32pt!important}</style>
<div class="no-print" style="position:sticky;top:0;background:#1a1a2e;color:#fff;padding:8px 14px;margin:-24pt -32pt 12pt;display:flex;gap:12px;align-items:center;font:13px 'Segoe UI',Arial">
<b style="flex:1">Formato F${clave(fase, paso)} · listo para imprimir y llenar a mano</b>
<button onclick="window.print()" style="background:#fff;color:#1a1a2e;border:0;border-radius:6px;padding:6px 14px;font-weight:700;cursor:pointer">🖨 Imprimir</button></div>`
  return abrirDocumento(html.replace('<body>', '<body>' + barra))
}

export default { formatoDePaso, descargarFormatoPaso, imprimirFormatoPaso }
