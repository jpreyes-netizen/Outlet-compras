// src/procesos/prcPlantillas.jsx — los formatos anexos del método P21 (v2, estándar profesional).
//
// Un formato por fase del comité de trabajo (F1–F7), como DOCUMENTO CONTROLADO:
// control documental (código, versión, elaboración), propósito e instrucciones
// de llenado, ejemplos en las tablas clave, escalas definidas (nada de
// alto/medio/bajo sin criterio), las herramientas de la disciplina donde
// corresponden —SIPOC y 5 porqués en el diagnóstico, RACI en el diseño,
// criterios de éxito definidos ANTES del piloto, rúbrica con puntaje y umbral
// en la validación, lecciones aprendidas en el cierre— y al final de cada uno
// la lista de verificación del gate de la fase más el bloque de aprobaciones.
//
// Se descargan como .doc (HTML que Word abre y edita), pre-llenados con los
// datos del encargo; se completan, se exportan a PDF y se cargan como
// evidencia de la fase en el ERP.

import { descargar } from './prcUI'
import { docShell, abrirDocumento } from './prcDoc'

const hoyCL = () => new Date().toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
const fF = d => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}` }

/* ── paleta y piezas (HTML compatible con Word: tablas y estilos simples) ──── */
const AZUL = '#1a1a2e', AZUL2 = '#16213e', GRIS = '#eef0f5', GRISX = '#f7f8fb', BORDE = '#b9bdcc', TINTA = '#1c1c28', MUTED = '#6a6f80', EJ = '#8a90a3'
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const T = (filas, anchos = []) => {
  const colgroup = anchos.length ? `<colgroup>${anchos.map(a => `<col width="${a}%">`).join('')}</colgroup>` : ''
  return `<table width="100%" cellspacing="0" cellpadding="5" style="border-collapse:collapse;font-size:9pt;margin:4pt 0">${colgroup}${filas}</table>`
}
const th = (...cs) => `<tr>${cs.map(c => `<td bgcolor="${AZUL}" style="border:1pt solid ${AZUL};color:#ffffff;font-weight:bold;font-size:8.5pt">${esc(c)}</td>`).join('')}</tr>`
const td = (c, extra = '') => `<td style="border:1pt solid ${BORDE};${extra}">${c}</td>`
const tdv = (n = 1, alto = 22) => Array.from({ length: n }, () => `<td style="border:1pt solid ${BORDE};height:${alto}pt">&nbsp;</td>`).join('')
const filasVacias = (filas, cols, alto = 22, primera = null) =>
  Array.from({ length: filas }, (_, i) => `<tr>${primera ? td(primera(i + 1), 'text-align:center;font-weight:bold;background:' + GRISX) : ''}${tdv(cols - (primera ? 1 : 0), alto)}</tr>`).join('')
/** Fila de ejemplo: cursiva gris, marcada. Enseña qué se espera sin ocupar el espacio útil. */
const ej = (...cs) => `<tr>${cs.map((c, i) => `<td style="border:1pt solid ${BORDE};font-style:italic;color:${EJ};font-size:8pt;background:${GRISX}">${i === 0 ? 'Ej: ' : ''}${esc(c)}</td>`).join('')}</tr>`
const filaDato = (rotulo, valor, alto = 15) =>
  `<tr><td bgcolor="${GRIS}" width="32%" style="border:1pt solid ${BORDE};font-weight:bold;font-size:8.5pt">${esc(rotulo)}</td><td style="border:1pt solid ${BORDE};height:${alto}pt;font-size:9pt">${esc(valor ?? '')}&nbsp;</td></tr>`
const cajaTexto = (alto = 70, guia = '') => T(`<tr><td style="border:1pt solid ${BORDE};height:${alto}pt;vertical-align:top">${guia ? `<span style="font-style:italic;color:${EJ};font-size:8pt">${esc(guia)}</span>` : '&nbsp;'}</td></tr>`)

/** Sección numerada con su propósito: quien llena sabe QUÉ se busca, no solo qué casilla es. */
const sec = (n, titulo, proposito, cuerpo) => `
  <table width="100%" cellspacing="0" cellpadding="0" style="margin:13pt 0 3pt"><tr>
    <td bgcolor="${AZUL}" width="30" align="center" style="color:#fff;font-weight:bold;font-size:10pt;padding:3pt 0">${n}</td>
    <td style="border-bottom:2pt solid ${AZUL};padding:2pt 8pt">
      <span style="font-weight:bold;font-size:10.5pt">${esc(titulo)}</span>
      ${proposito ? `<br/><span style="font-size:8pt;color:${MUTED}">${esc(proposito)}</span>` : ''}
    </td>
  </tr></table>
  ${cuerpo}`

/** Escala definida — para que "alto" signifique lo mismo para todos. */
const escala = (titulo, items) => `
  <table width="100%" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:8pt;margin:2pt 0 6pt"><tr>
    <td bgcolor="${GRISX}" style="border:1pt solid ${BORDE};color:${MUTED}"><b>${esc(titulo)}:</b> ${items.map(i => `<b>${esc(i[0])}</b> = ${esc(i[1])}`).join(' &nbsp;·&nbsp; ')}</td>
  </tr></table>`

/** Lista de verificación con casillas: el gate de la fase, dentro del documento. */
const checklist = items => T(items.map(i =>
  `<tr><td width="24" align="center" style="border:1pt solid ${BORDE};font-size:11pt">&#9744;</td><td style="border:1pt solid ${BORDE};font-size:9pt">${esc(i)}</td></tr>`).join(''), [5, 95])

/** Bloque formal de elaboración/revisión/aprobación. */
const aprobaciones = filas => T(
  th('', 'Nombre', 'Cargo / rol', 'Firma', 'Fecha') +
  filas.map(r => `<tr>${td(`<b>${esc(r[0])}</b>`, `background:${GRIS};font-size:8.5pt`)}${td(esc(r[1] || ''), 'height:24pt')}${td(esc(r[2] || ''), '')}${tdv(2, 24)}</tr>`).join(''),
  [16, 30, 24, 18, 12])

const instrucciones = items => `
  <table width="100%" cellspacing="0" cellpadding="7" style="margin:8pt 0"><tr>
    <td bgcolor="#fff7e0" style="border:1pt solid #e0c568;font-size:8.5pt;color:#5d4d15;line-height:1.5">
      <b>INSTRUCCIONES DE LLENADO</b><br/>
      ${items.map((t, i) => `${i + 1}. ${esc(t)}`).join('<br/>')}
    </td></tr></table>`

const proposito = texto => `
  <table width="100%" cellspacing="0" cellpadding="7" style="margin:8pt 0 0"><tr>
    <td bgcolor="${GRISX}" style="border-left:3pt solid ${AZUL};font-size:9pt;line-height:1.5">
      <b>Propósito de este documento.</b> ${esc(texto)}
    </td></tr></table>`

function shell(fase, codigo, titulo, enc, cuerpo) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${esc(codigo)} · ${esc(titulo)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>body{font-family:'Segoe UI',Arial,sans-serif;font-size:9.5pt;color:${TINTA};margin:36pt 44pt} p{margin:4pt 0}</style>
</head><body>

<!-- encabezado con control documental (documento controlado) -->
<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
<tr>
  <td bgcolor="${AZUL}" width="34%" style="padding:10pt 14px;border:1pt solid ${AZUL}">
    <span style="color:#ffffff;font-size:12.5pt;font-weight:bold">OUTLET DE PUERTAS</span><br/>
    <span style="color:#9fb0d8;font-size:8pt;letter-spacing:1pt">SISTEMA DE GESTIÓN DE PROCESOS</span>
  </td>
  <td bgcolor="${AZUL2}" style="padding:10pt 14px;border:1pt solid ${AZUL2}">
    <span style="color:#ffffff;font-size:11.5pt;font-weight:bold">${esc(titulo)}</span><br/>
    <span style="color:#9fb0d8;font-size:8pt">SOP P21 · Construcción y aprobación de procesos · Fase ${fase}</span>
  </td>
  <td width="20%" style="border:1pt solid ${BORDE};padding:0">
    <table width="100%" cellspacing="0" cellpadding="2" style="border-collapse:collapse;font-size:7.5pt">
      <tr><td bgcolor="${GRIS}" style="border-bottom:1pt solid ${BORDE};font-weight:bold">Código</td><td style="border-bottom:1pt solid ${BORDE}">${esc(codigo)}-P21</td></tr>
      <tr><td bgcolor="${GRIS}" style="border-bottom:1pt solid ${BORDE};font-weight:bold">Versión</td><td style="border-bottom:1pt solid ${BORDE}">1.0</td></tr>
      <tr><td bgcolor="${GRIS}" style="border-bottom:1pt solid ${BORDE};font-weight:bold">Emisión</td><td style="border-bottom:1pt solid ${BORDE}">${hoyCL()}</td></tr>
      <tr><td bgcolor="${GRIS}" style="font-weight:bold">Clasificación</td><td>Uso interno</td></tr>
    </table>
  </td>
</tr></table>

<!-- identificación del encargo -->
<table width="100%" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:8.5pt;margin-top:6pt">
<tr>
  <td bgcolor="${GRIS}" width="12%" style="border:1pt solid ${BORDE};font-weight:bold">Proceso</td>
  <td width="38%" style="border:1pt solid ${BORDE}">${esc(enc.proceso_id || '')} · ${esc(enc.proceso_nombre || '')}</td>
  <td bgcolor="${GRIS}" width="12%" style="border:1pt solid ${BORDE};font-weight:bold">Encargo</td>
  <td style="border:1pt solid ${BORDE}">${esc(enc.id || '')}</td>
</tr>
<tr>
  <td bgcolor="${GRIS}" style="border:1pt solid ${BORDE};font-weight:bold">Líder</td>
  <td style="border:1pt solid ${BORDE}">${esc(enc.lider || '')}</td>
  <td bgcolor="${GRIS}" style="border:1pt solid ${BORDE};font-weight:bold">Asignado por</td>
  <td style="border:1pt solid ${BORDE}">${esc(enc.comite_codigo || '—')} · plazo ${fF(enc.fecha_limite)}</td>
</tr>
<tr>
  <td bgcolor="${GRIS}" style="border:1pt solid ${BORDE};font-weight:bold">Elaborado por</td>
  <td style="border:1pt solid ${BORDE};height:14pt">&nbsp;</td>
  <td bgcolor="${GRIS}" style="border:1pt solid ${BORDE};font-weight:bold">Fecha elab.</td>
  <td style="border:1pt solid ${BORDE}">&nbsp;</td>
</tr></table>

${cuerpo}

<p style="margin-top:14pt;font-size:7.5pt;color:#9a9aa6;border-top:1pt solid ${BORDE};padding-top:4pt">
${esc(codigo)}-P21 v1.0 · Outlet de Puertas SpA · Documento controlado del Sistema de Gestión de Procesos — una copia impresa o descargada es copia no controlada; la versión vigente vive en el ERP. El documento rellenado y exportado a PDF es el entregable oficial de la fase ${fase}: cárguelo como evidencia en el encargo (Procesos → Comités de trabajo).
</p>
</body></html>`
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export const PLANTILLAS = {
  1: { codigo: 'F1', titulo: 'Informe de activación del encargo' },
  2: { codigo: 'F2', titulo: 'Acta de constitución y encuadre' },
  3: { codigo: 'F3', titulo: 'Informe de diagnóstico del proceso' },
  4: { codigo: 'F4', titulo: 'Memoria de diseño y Ficha de KPI' },
  5: { codigo: 'F5', titulo: 'Plan, bitácora e informe del piloto' },
  6: { codigo: 'F6', titulo: 'Expediente de validación del directorio' },
  7: { codigo: 'F7', titulo: 'Acta de cierre, capacitación y traspaso' }
}

/* ── F1 · Activación ───────────────────────────────────────────────────────── */
function f1(enc) {
  return shell(1, 'F1', PLANTILLAS[1].titulo, enc,
    proposito('Dejar constancia de que el encargo fue recibido y entendido, que se investigó el proceso con sus actores reales, que el equipo quedó conformado según las reglas del método y que la sesión de constitución fue convocada. Es el entregable de la fase 1 y su gate de salida.') +
    instrucciones([
      'Completa las secciones en orden: la nómina (sección 3) se arma DESPUÉS de las entrevistas, para elegir con información.',
      'Las filas en gris cursiva son ejemplos del tipo de respuesta esperada: no las copies, reemplázalas por tu realidad.',
      'La nómina de la sección 3 debe registrarse también en el ERP (paso 1.3): este documento respalda los vistos buenos.',
      'Verifica la lista de la sección 5 antes de exportar a PDF y cargar: es el gate de la fase.'
    ]) +
    sec('1', 'Recepción del encargo (paso 1.1)',
      'Confirmar que el líder conoce qué se le encargó, por qué este proceso y contra qué se medirá.',
      T(filaDato('Objetivo declarado del encargo', enc.objetivo || '', 26) +
        filaDato('Fuera de alcance declarado', enc.fuera_de_alcance || '', 20) +
        filaDato('Score del proceso en la matriz', '') +
        filaDato('Dueño designado del proceso', '') +
        filaDato('¿Qué problema del negocio origina este encargo?', '', 26))) +
    sec('2', 'Levantamiento inicial (paso 1.2 · mínimo 2 actores clave)',
      'Entender el proceso desde quienes lo ejecutan, ANTES de armar el equipo. Preguntas guía: ¿qué haces paso a paso? ¿dónde se traba? ¿qué harías distinto?',
      T(th('Actor entrevistado', 'Cargo / sucursal', 'Fecha', 'Síntesis de lo relevante que declaró') +
        ej('Karla León', 'Cajera · La Granja', '15-09', 'El cliente pide factura y el proceso se corta: no hay regla clara de quién autoriza') +
        filasVacias(3, 4, 28), [20, 17, 10, 53]) +
      `<p style="font-size:8.5pt;margin-top:5pt"><b>Hallazgos del levantamiento</b> — qué funciona, qué falla y qué riesgos se ven para el rediseño:</p>` +
      cajaTexto(85, 'Redacta en 3–6 líneas. Distingue hechos observados de opiniones.')) +
    sec('3', 'Conformación del equipo (paso 1.3)',
      'El equipo se elige por aporte al proceso, no por disponibilidad. Reglas: impar, mínimo 3, al menos una persona de otra área (principio 5 y 7); tope de carga 4 comités por persona.',
      T(th('N°', 'Nombre', 'Área / cargo', 'Rol en el comité', 'Por qué aporta (criterio de elección)', 'V°B° jefatura') +
        ej('', 'David Bascur', 'Jefe de Tienda Maipú', 'Integrante', 'Ejecuta el proceso a diario en la sucursal de mayor flujo', '✓ (firma)') +
        filasVacias(5, 6, 22, i => String(i)), [5, 20, 17, 14, 30, 14]) +
      checklist([
        'La conformación es impar y de mínimo 3 integrantes (incluido el líder).',
        'Hay al menos una persona de otra dirección o área.',
        'Cada designado tiene el visto bueno de su jefatura directa (firma en la tabla).',
        'La nómina quedó registrada en el ERP con nombre, área y rol.'
      ])) +
    sec('4', 'Convocatoria a la sesión de constitución (paso 1.4)',
      'Con fecha, hora, modalidad y tabla conocidas por todos. La convocatoria se envía con 48 horas de anticipación.',
      T(filaDato('Fecha y hora', '') + filaDato('Modalidad y lugar / enlace', '') + filaDato('Enviada a (todos los de la nómina)', '') ) +
      T(th('N°', 'Tabla propuesta de la sesión de constitución', 'Min.') +
        [['1', 'Presentación del encargo: objetivo, plazo y reglas del método', '10'],
         ['2', 'Designación del secretario de actas (por nombre)', '5'],
         ['3', 'Alcance y exclusiones: discusión y acuerdo', '20'],
         ['4', 'Plan de trabajo: fechas por fase y responsables', '20'],
         ['5', 'Firma del acta de encuadre (formato F2)', '5']]
          .map(r => `<tr>${td(r[0], 'text-align:center')}${td(esc(r[1]))}${td(r[2], 'text-align:center')}</tr>`).join(''), [6, 82, 12])) +
    sec('5', 'Verificación antes de cargar (gate de salida de la fase 1)', '',
      checklist([
        'Proceso confirmado en el ERP y el líder conoce el SOP P21 y el alcance del encargo.',
        'Levantamiento inicial hecho con 2 o más actores clave (sección 2 completa).',
        'Nómina registrada en el ERP con los vistos buenos (sección 3).',
        'Sesión de constitución convocada con 48 h de anticipación (sección 4).'
      ])) +
    sec('6', 'Elaboración y visto bueno', '',
      aprobaciones([['Elabora', enc.lider || '', 'Líder del comité de trabajo'], ['Revisa', '', 'Responsable del comité que asigna']])))
}

/* ── F2 · Acta de constitución y encuadre ──────────────────────────────────── */
function f2(enc) {
  return shell(2, 'F2', PLANTILLAS[2].titulo, enc,
    proposito('Formalizar la constitución del comité de trabajo: quórum verificado, secretario designado, objetivo y alcance acordados con exclusiones explícitas, y plan de trabajo con fechas y responsables. Firmada por todos, esta acta cierra la fase 2; sin ella la fase 3 no se abre.') +
    instrucciones([
      'Se llena DURANTE la sesión de constitución, no después: el secretario registra y el pleno valida antes de firmar.',
      'El objetivo (sección 3) debe poder verificarse: incluye qué se logrará, cómo se sabrá y para cuándo.',
      'Las exclusiones evitan que el encargo crezca: lo que no está escrito acá como alcance, queda fuera.',
      'El plan de la sección 4 debe cuadrar con el tope de 2 meses del encargo (principio 11).'
    ]) +
    sec('1', 'Datos de la sesión y quórum (paso 2.1)',
      'El quórum es ¾ de los votantes, redondeado hacia arriba. Sin quórum la sesión es informativa y se reagenda dentro de 5 días hábiles.',
      T(filaDato('Fecha, hora de inicio y de término', '') + filaDato('Modalidad y lugar', '')) +
      T(th('N°', 'Integrante', 'Rol', 'Presente', 'Firma') +
        ej('', 'Claudia Reyes', 'Secretaria de actas', 'Sí', '(firma)') +
        filasVacias(5, 5, 20, i => String(i)), [5, 33, 20, 12, 30]) +
      T(filaDato('Cálculo del quórum', 'Votantes: ____ · Presentes: ____ · Requerido (¾ redondeo ↑): ____ · ¿Cumple?  SÍ / NO'))) +
    sec('2', 'Designaciones (paso 2.2)',
      'El secretario se designa por nombre, no por área: es quien levanta las actas de todas las sesiones del encargo.',
      T(filaDato('Secretario/a de actas', enc.secretario || '') + filaDato('Suplente del secretario (opcional)', ''))) +
    sec('3', 'Objetivo, alcance y exclusiones (paso 2.4)',
      'El encuadre delimita el trabajo: qué se va a lograr, qué cubre, qué queda explícitamente fuera y con qué procesos limita.',
      T(filaDato('Objetivo del encargo (verificable: qué + cómo se mide + cuándo)', enc.objetivo || '', 30) +
        filaDato('Alcance — qué SÍ cubre', '', 28) +
        filaDato('Exclusiones — qué NO cubre (explícitas)', enc.fuera_de_alcance || '', 28) +
        filaDato('Interfaces — con qué procesos limita y dónde está el corte', '', 24))) +
    sec('4', 'Plan de trabajo (paso 2.3)',
      'Fechas comprometidas por fase y responsable nominal de cada entregable. La suma debe caber en el plazo del encargo.',
      T(th('Fase del método', 'Entregable comprometido', 'Fecha', 'Responsable nominal') +
        [['3. Diagnóstico', 'Informe de diagnóstico validado (F3)'],
         ['4. Diseño', 'SOP y flujograma en el ERP + memoria F4'],
         ['5. Piloto', 'Informe de piloto con KPI (F5)'],
         ['6. Validación', 'Expediente aprobado por directorio (F6)'],
         ['7. Bajada y traspaso', 'Acta de cierre y traspaso (F7)']]
          .map(r => `<tr>${td(`<b>${r[0]}</b>`, `background:${GRISX}`)}${td(esc(r[1]), `font-size:8.5pt;color:${MUTED}`)}${tdv(2, 20)}</tr>`).join(''), [20, 42, 16, 22])) +
    sec('5', 'Riesgos del encargo identificados en la sesión',
      'Qué podría hacer fracasar este encargo y qué se hará al respecto. Revisar en cada sesión.',
      T(th('Riesgo', 'Cómo se mitiga', 'Responsable') +
        ej('Temporada alta reduce disponibilidad del equipo en octubre', 'Adelantar el diagnóstico; sesiones de 60 min máximo', 'Líder') +
        filasVacias(2, 3, 22), [40, 42, 18])) +
    sec('6', 'Acuerdos de la sesión',
      'Cada acuerdo con responsable único (una persona, no un área — principio 8) y fecha.',
      T(th('N°', 'Acuerdo', 'Responsable', 'Fecha compromiso') + filasVacias(3, 4, 20, i => String(i)), [5, 55, 22, 18])) +
    sec('7', 'Verificación antes de cargar (gate de salida de la fase 2)', '',
      checklist([
        'Quórum verificado y registrado (sección 1).',
        'Secretario de actas designado por nombre (sección 2).',
        'Alcance con exclusiones explícitas acordado por el pleno (sección 3).',
        'Plan de trabajo con fechas dentro del plazo de 2 meses (sección 4).',
        'Acta firmada por todos los presentes (sección 8).'
      ])) +
    sec('8', 'Firmas del pleno', 'El acta firmada y cargada en el ERP es la evidencia del encuadre.',
      aprobaciones([['Líder', enc.lider || '', 'Líder del comité de trabajo'], ['Secretario/a', enc.secretario || '', 'Secretario/a de actas'], ['Integrante', '', ''], ['Integrante', '', ''], ['Integrante', '', '']])))
}

/* ── F3 · Informe de diagnóstico ───────────────────────────────────────────── */
function f3(enc) {
  return shell(3, 'F3', PLANTILLAS[3].titulo, enc,
    proposito('Describir el proceso COMO FUNCIONA HOY (no como debería), identificar sus quiebres con evidencia y llegar a máximo 3 causas raíz priorizadas. Este informe alimenta directamente el diseño: cada solución de la fase 4 debe apuntar a una causa raíz de este documento.') +
    instrucciones([
      'Diagnostica el proceso real: observa y pregunta a quienes lo ejecutan (mínimo 3 ejecutores), no a quienes lo supervisan.',
      'Un quiebre sin evidencia es una opinión: registra el dato, el caso o la observación que lo respalda.',
      'Aplica los 5 porqués hasta llegar a una causa que esté bajo control de la empresa (sección 5).',
      'Prioriza con la escala definida: llega a las 3 causas raíz que más explican el problema, no a una lista de 10.'
    ]) +
    sec('1', 'Metodología aplicada',
      'Qué herramientas se usaron para levantar la información (paso 3.2: la batería de herramientas).',
      checklist([
        'Entrevistas estructuradas a ejecutores (pauta adjunta o descrita).',
        'Observación directa en terreno (fecha y lugar registrados).',
        'Revisión de datos del ERP / BSALE (período analizado).',
        'Checklist o cuaderno de campo aplicado en las sucursales.'
      ]) +
      T(th('Ejecutor consultado (mín. 3)', 'Cargo / sucursal', 'Herramienta aplicada', 'Fecha') +
        ej('Gerardo Cavieres', 'Cajero · Los Ángeles', 'Entrevista + observación de 2 atenciones', '18-09') +
        filasVacias(3, 4, 20), [26, 22, 36, 16])) +
    sec('2', 'Mapa del proceso actual — SIPOC',
      'La vista de punta a punta en una tabla: de dónde vienen los insumos, qué hace el proceso y quién recibe el resultado. Marca dónde empieza y termina el alcance del encargo.',
      T(th('Proveedores (quién entrega)', 'Insumos (qué recibe)', 'Proceso (5–7 macropasos)', 'Salidas (qué produce)', 'Clientes (quién recibe)') +
        ej('Cliente / vendedor', 'Pedido, datos del cliente', '1. Cotiza → 2. Vende → 3. Documenta → 4. Despacha', 'Boleta o factura, guía', 'Cliente final, contabilidad') +
        filasVacias(2, 5, 46), [20, 20, 24, 18, 18])) +
    sec('3', 'El proceso paso a paso (as-is)',
      'Cada actividad con su ejecutor y sistema, y el problema observado si lo hay. Acá aparecen los quiebres.',
      T(th('N°', 'Actividad (como se hace HOY)', 'Quién la hace', 'Sistema / documento', 'Problema observado') +
        ej('', 'Cajera registra venta y reimprime porque el formato sale cortado', 'Cajera', 'BSALE', 'Reimpresión en 1 de cada 3 ventas') +
        filasVacias(6, 5, 20, i => String(i)), [5, 34, 15, 16, 30])) +
    sec('4', 'Quiebres detectados, con evidencia',
      'Un quiebre es una falla repetible del proceso, no un error puntual de una persona.',
      escala('Escala de impacto', [['3 · Alto', 'afecta venta, caja o cliente final'], ['2 · Medio', 'genera retrabajo o demora interna'], ['1 · Bajo', 'molestia sin efecto en el resultado']]) +
      escala('Escala de frecuencia', [['3', 'diario o casi diario'], ['2', 'semanal'], ['1', 'ocasional']]) +
      T(th('N°', 'Quiebre', 'Evidencia (dato, caso, observación)', 'Imp.', 'Frec.', 'Total') +
        ej('', 'Ventas sin documentar el mismo día', '12 casos en la muestra de sept. (reporte BSALE)', '3', '2', '6') +
        filasVacias(4, 6, 22, i => String(i)), [5, 32, 39, 8, 8, 8]) +
      `<p style="font-size:8pt;color:${MUTED}">Total = Impacto × Frecuencia. Pasan al análisis de causa los de mayor total (máximo 3).</p>`) +
    sec('5', 'Análisis de causa raíz — 5 porqués (para los 3 quiebres priorizados)',
      'Pregunta "¿por qué ocurre?" sucesivamente hasta llegar a una causa que la empresa pueda intervenir. Si la respuesta es "porque la persona se equivocó", falta profundizar.',
      [1, 2, 3].map(n =>
        T(filaDato(`Quiebre priorizado N° ${n}`, '', 16) +
          filaDato('¿Por qué ocurre? (1)', '') + filaDato('¿Por qué? (2)', '') + filaDato('¿Por qué? (3)', '') +
          filaDato('¿Por qué? (4, si aplica)', '') +
          `<tr><td bgcolor="#e8f0e6" style="border:1pt solid ${BORDE};font-weight:bold;font-size:8.5pt">CAUSA RAÍZ ${n}</td><td style="border:1pt solid ${BORDE};height:18pt;font-weight:bold">&nbsp;</td></tr>`)
      ).join('')) +
    sec('6', 'Conclusiones para el diseño',
      'Qué debe resolver sí o sí la fase 4. Estas líneas se transforman en la matriz quiebre→solución del formato F4.',
      cajaTexto(70, 'Ej: El rediseño debe definir quién autoriza facturas fuera de horario, y dejar una regla única de documentación el mismo día.')) +
    sec('7', 'Validación en sesión (paso 3.5) y gate de la fase 3', '',
      T(filaDato('Sesión y fecha de validación', '') +
        filaDato('Votación', '___ a favor · ___ en contra · ___ abstenciones — resultado: APROBADO / DEVUELTO')) +
      checklist([
        'Se consultó a 3 o más ejecutores reales del proceso (sección 1).',
        'El as-is describe lo que pasa hoy, con evidencia por quiebre (secciones 3 y 4).',
        'Hay máximo 3 causas raíz, cada una con sus 5 porqués (sección 5).',
        'El diagnóstico fue validado por el pleno en sesión (esta sección).'
      ])) +
    sec('8', 'Elaboración y validación', '',
      aprobaciones([['Elabora', '', 'Integrante a cargo del diagnóstico'], ['Revisa', enc.lider || '', 'Líder del comité de trabajo'], ['Valida', enc.secretario || '', 'Secretario/a — fe del acta de votación']])))
}

/* ── F4 · Memoria de diseño y Ficha de KPI ─────────────────────────────────── */
function f4(enc) {
  return shell(4, 'F4', PLANTILLAS[4].titulo, enc,
    proposito('Documentar las decisiones de diseño que no caben en el SOP: la trazabilidad quiebre→solución, la asignación de responsabilidades (RACI), las excepciones resueltas y la Ficha de KPI que se activará en la fase 7. El SOP y el flujograma se redactan y versionan en el ERP; esta memoria es su respaldo metodológico.') +
    instrucciones([
      'Parte de las causas raíz del F3: cada una debe tener una contramedida de diseño en la sección 1.',
      'En la matriz RACI cada actividad tiene UN solo responsable de ejecutar (R) y UN solo aprobador (A).',
      'Resuelve mínimo 3 excepciones reales: si "nunca pasa", pregunta en terreno — siempre pasa.',
      'La Ficha de KPI (sección 5) se completa entera: sin línea base ni responsable de medir, el KPI no se puede activar en fase 7.'
    ]) +
    sec('1', 'Trazabilidad quiebre → solución (paso 4.1)',
      'Verifica que el diseño responde al diagnóstico y no a preferencias. Un quiebre sin solución debe justificarse.',
      T(th('Causa raíz (del F3)', 'Solución en el diseño (qué parte del SOP la resuelve)', '¿Resuelto?') +
        ej('No hay regla de quién autoriza facturas fuera de horario', 'SOP §4.2: la autoriza el jefe de tienda de turno; tope $500.000', 'Sí') +
        filasVacias(3, 3, 24), [36, 50, 14])) +
    sec('2', 'Objetivo del proceso con criterio de cumplimiento (paso 4.2)',
      'Verificable: qué logra el proceso, medido cómo, con qué meta.',
      cajaTexto(46, 'Ej: Documentar el 100% de las ventas el mismo día de la transacción, medido por el reporte diario de BSALE.')) +
    sec('3', 'Matriz de responsabilidades — RACI (paso 4.4)',
      'R = Responsable de ejecutar (uno solo) · A = Aprueba/responde por el resultado (uno solo) · C = Consultado · I = Informado.',
      T(th('Actividad del proceso', 'Rol 1: ________', 'Rol 2: ________', 'Rol 3: ________', 'Rol 4: ________') +
        ej('Autorizar factura fuera de horario', 'C', 'A', 'R', 'I') +
        filasVacias(5, 5, 20), [40, 15, 15, 15, 15]) +
      T(th('Rol', 'Límite explícito (qué NO puede hacer)', 'A quién escala lo que excede su límite') +
        filasVacias(3, 3, 22), [22, 46, 32])) +
    sec('4', 'Excepciones resueltas (paso 4.5 · mínimo 3)',
      'La regla de decisión debe permitir resolver sin consultar: situación → regla → quién decide si la regla no alcanza.',
      T(th('N°', 'Situación de excepción', 'Regla de decisión', 'Decide si la regla no alcanza', 'Dónde queda registrado') +
        ej('', 'Cliente exige factura con la caja cerrada', 'Se emite al día hábil siguiente antes de las 10:00', 'Jefe de tienda', 'Bitácora de caja') +
        filasVacias(3, 5, 24, i => String(i)), [5, 27, 30, 20, 18])) +
    sec('5', 'FICHA DE KPI (paso 4.6 — el corazón del control del proceso)',
      'Esta ficha define el indicador que la fase 7 activa. Los umbrales del semáforo permiten leerlo sin discusión.',
      T(filaDato('Nombre del indicador', '') +
        filaDato('Definición operacional (qué mide exactamente, sin ambigüedad)', '', 24) +
        filaDato('Fórmula de cálculo', '') +
        filaDato('Fuente del dato (reporte, tabla, sistema)', '') +
        filaDato('Línea base actual (valor + período medido)', '') +
        filaDato('Meta (valor + sentido ≥ / ≤ + plazo para alcanzarla)', '') +
        filaDato('Frecuencia de medición y quién mide (cargo)', '') +
        filaDato('Semáforo — verde desde / amarillo entre / rojo bajo', '')) ) +
    sec('6', 'Anexos y documentos del proceso (paso 4.7)',
      'Los documentos que el proceso usa u origina, y dónde viven.',
      T(th('Documento / anexo', 'Lo usa el paso', 'Dónde vive (ERP, BSALE, papel)') + filasVacias(3, 3, 20), [46, 20, 34])) +
    sec('7', 'Presentación al pleno (paso 4.9) y gate de la fase 4', '',
      T(filaDato('Versión del SOP y flujograma guardada en el ERP', 'SOP v0.___ · flujograma v0.___') +
        filaDato('Sesión y votación', '___ a favor · ___ en contra — resultado: APROBADO / DEVUELTO')) +
      checklist([
        'Cada causa raíz del F3 tiene su solución trazada (sección 1).',
        'RACI con un solo R y un solo A por actividad; límites y escalamiento definidos (sección 3).',
        'Mínimo 3 excepciones con regla de decisión (sección 4).',
        'Ficha de KPI completa: definición, fórmula, línea base, meta, semáforo y responsable (sección 5).',
        'SOP y flujograma versionados en el ERP y aprobados por el pleno (sección 7).'
      ])) +
    sec('8', 'Elaboración y aprobación', '',
      aprobaciones([['Elabora', '', 'Integrante a cargo del diseño'], ['Revisa', enc.lider || '', 'Líder del comité de trabajo'], ['Valida', enc.secretario || '', 'Secretario/a — fe del acta de votación']])))
}

/* ── F5 · Piloto ───────────────────────────────────────────────────────────── */
function f5(enc) {
  return shell(5, 'F5', PLANTILLAS[5].titulo, enc,
    proposito('Probar el diseño en la realidad antes de pedir su aprobación. La disciplina del piloto está en definir los criterios de éxito ANTES de partir, registrar lo que pasa sin maquillarlo y evaluar contra esos criterios — no contra la impresión general.') +
    instrucciones([
      'La sección 2 (criterios de éxito) se completa y firma ANTES del primer día del piloto: después no se cambian.',
      'La unidad piloto se elige por representatividad, no por comodidad (paso 5.1). Justifícalo.',
      'La bitácora se llena el mismo día de cada incidencia; una bitácora reconstruida al final no sirve como evidencia.',
      'El piloto dura mínimo 14 días corridos (principio 10): la base rechaza pilotos más cortos.'
    ]) +
    sec('1', 'Ficha del piloto (paso 5.1)',
      'Dónde, cuándo, quiénes y qué KPI se observa (el de la Ficha F4 §5).',
      T(filaDato('Unidad / sucursal donde se pilotea', '') +
        filaDato('Justificación de representatividad (por qué esta y no la más fácil)', '', 26) +
        filaDato('Período (mínimo 14 días corridos)', 'Del ____-____-______ al ____-____-______') +
        filaDato('KPI a observar y su línea base (de F4 §5)', '') +
        filaDato('Responsable del piloto en terreno', '') +
        filaDato('Capacitación previa al equipo ejecutor (paso 5.2): fecha y asistentes', ''))) +
    sec('2', 'Criterios de éxito — SE DEFINEN ANTES DE PARTIR',
      'Qué tiene que pasar para declarar el piloto exitoso. Se firman antes del día 1 y no se modifican durante la ejecución.',
      T(th('N°', 'Criterio de éxito', 'Umbral (número o condición verificable)', 'Cómo y con qué se medirá') +
        ej('', 'Ventas documentadas el mismo día', '≥ 95% de las ventas del período', 'Reporte diario BSALE vs. registro de caja') +
        filasVacias(3, 4, 22, i => String(i)), [5, 33, 28, 34]) +
      T(`<tr><td bgcolor="${GRISX}" style="border:1pt solid ${BORDE};font-size:8.5pt">Criterios fijados antes del inicio — firma del líder: ______________________ fecha: ____-____-______</td></tr>`)) +
    sec('3', 'Bitácora de ejecución (paso 5.3)',
      'Toda incidencia, desviación o hallazgo, el día que ocurre. Tipo: D = desviación del SOP · I = incidencia · M = mejora detectada · B = bloqueo.',
      T(th('Fecha', 'Tipo', 'Qué ocurrió', 'Acción tomada', 'Registró') +
        ej('22-09', 'D', 'La cajera saltó la verificación del paso 3 por fila de clientes', 'Se reforzó el instructivo; se midió el tiempo real del paso', 'K. León') +
        filasVacias(8, 5, 20), [11, 7, 40, 28, 14])) +
    sec('4', 'Mediciones del KPI durante el piloto (paso 5.4)',
      'La comparación es contra la línea base y contra el umbral de la sección 2.',
      T(th('Semana', 'Período', 'Valor medido', 'vs. línea base', 'vs. umbral de éxito') +
        filasVacias(3, 5, 20, i => `S${i}`), [10, 24, 22, 22, 22])) +
    sec('5', 'Evaluación contra los criterios de éxito',
      'Criterio por criterio: cumplido o no, con el dato. La conclusión sale de esta tabla, no de la sensación.',
      T(th('Criterio (de la sección 2)', 'Resultado medido', '¿Cumple el umbral?') + filasVacias(3, 3, 22), [42, 38, 20]) +
      `<p style="font-size:8.5pt;margin-top:5pt"><b>Ajustes al SOP derivados del piloto</b> (se versionan en el ERP antes de la validación):</p>` +
      cajaTexto(56, 'Ej: Se ajusta el paso 3: la verificación pasa al cierre de caja para no frenar la atención en horario punta.')) +
    sec('6', 'Validación y envío al directorio (pasos 5.5 y 5.6) — gate de la fase 5', '',
      T(filaDato('Votación del pleno', '___ a favor · ___ en contra — resultado: APROBADO / SE EXTIENDE EL PILOTO') +
        filaDato('Expediente enviado al directorio el', '')) +
      checklist([
        'El piloto duró 14 días corridos o más, en la unidad justificada como representativa.',
        'Los criterios de éxito se definieron y firmaron antes de partir (sección 2).',
        'Bitácora al día, con fechas reales (sección 3).',
        'KPI medido y comparado contra línea base y umbral (secciones 4 y 5).',
        'Ajustes al SOP versionados en el ERP; informe enviado al directorio.'
      ])) +
    sec('7', 'Elaboración y validación', '',
      aprobaciones([['Elabora', '', 'Responsable del piloto en terreno'], ['Revisa', enc.lider || '', 'Líder del comité de trabajo'], ['Valida', enc.secretario || '', 'Secretario/a — fe del acta de votación']])))
}

/* ── F6 · Validación del directorio ────────────────────────────────────────── */
function f6(enc) {
  return shell(6, 'F6', PLANTILLAS[6].titulo, enc,
    proposito('Dar al comité de directorio una base objetiva para aprobar o devolver: verificación de que el expediente está completo, preguntas dirigidas, y una rúbrica con puntaje y umbral definido — la decisión queda fundada en criterios, no en impresiones. Lo llena el directorio (paso 6.2), no el comité de trabajo.') +
    instrucciones([
      'Antes de citar la sesión, verifica el expediente (sección 1): si falta una pieza, se devuelve sin sesionar.',
      'Cada evaluador puntúa la rúbrica por separado y luego se consolida: evita el arrastre del primero que habla.',
      'Umbral de aprobación: promedio ≥ 80% del puntaje máximo Y ningún criterio en 0.',
      'La decisión con condiciones debe listar las condiciones con responsable y fecha (sección 5).'
    ]) +
    sec('1', 'Verificación del expediente recibido',
      'El directorio revisa contra documentos, no contra relatos. Todo esto debe estar cargado en el ERP.',
      checklist([
        'F2 · Acta de encuadre firmada.',
        'F3 · Informe de diagnóstico validado en sesión.',
        'F4 · Memoria de diseño con Ficha de KPI completa.',
        'F5 · Informe de piloto (≥14 días) con criterios de éxito evaluados.',
        'SOP y flujograma versionados y vigentes en el ERP (versión: ______).',
        'Informe de cierre del comité de trabajo enviado (paso 5.6).'
      ])) +
    sec('2', 'Preguntas dirigidas al comité de trabajo (paso 6.2)',
      'Preparadas antes de la sesión, apuntadas a los riesgos del diseño.',
      T(th('N°', 'Pregunta', 'Respuesta satisfactoria', 'Nota') +
        ej('', '¿Qué pasa con las excepciones en sucursales sin jefe de tienda en turno?', 'Sí', 'Escala al jefe de operaciones por teléfono') +
        filasVacias(4, 4, 22, i => String(i)), [5, 52, 18, 25])) +
    sec('3', 'Rúbrica de aprobación',
      'Puntaje por criterio: 0 = no cumple · 1 = cumple parcialmente · 2 = cumple. Umbral: promedio ≥ 80% y ningún 0.',
      T(th('Criterio', '0 / 1 / 2', 'Fundamento del puntaje') +
        ['El diseño resuelve las causas raíz del diagnóstico (trazabilidad F3→F4)',
         'Roles con un responsable y un aprobador por actividad; límites y escalamiento claros',
         'Excepciones reales resueltas con regla de decisión',
         'KPI con definición operacional, línea base, meta, semáforo y responsable',
         'Piloto representativo, ≥14 días, evaluado contra criterios fijados antes',
         'El SOP es ejecutable por una persona nueva sin ayuda (claridad y completitud)']
          .map(c => `<tr>${td(esc(c), 'font-size:8.5pt')}${tdv(1, 18)}${tdv(1, 18)}</tr>`).join(''), [52, 12, 36]) +
      T(filaDato('Puntaje total obtenido / máximo', '________ / 12  =  ________ %  · ¿Algún criterio en 0?  SÍ / NO'))) +
    sec('4', 'Deliberación (paso 6.4)',
      'Lo que el directorio quiere dejar dicho: fortalezas, observaciones y condiciones si las hay.',
      T(filaDato('Fortalezas del trabajo presentado', '', 30) +
        filaDato('Observaciones', '', 30) +
        filaDato('Condiciones para la aprobación (si aplica: qué, quién, para cuándo)', '', 30))) +
    sec('5', 'Decisión formal y votación — gate de la fase 6', '',
      T(filaDato('Sesión y fecha', '') +
        filaDato('Decisión', 'APROBADO · APROBADO CON CONDICIONES · DEVUELTO A DISEÑO (vuelve al paso 4.3)') +
        filaDato('Votación', '___ a favor · ___ en contra · ___ abstenciones') +
        filaDato('Si se aprueba: SOP firmado y publicado en el ERP el (paso 6.5)', '')) +
      checklist([
        'Expediente completo verificado antes de sesionar (sección 1).',
        'Rúbrica puntuada con fundamento; umbral aplicado (sección 3).',
        'Decisión registrada con votación en el acta de la sesión.',
        'Si se aprobó: SOP firmado y publicado como vigente en el ERP.'
      ])) +
    sec('6', 'Firmas del comité de directorio', '',
      aprobaciones([['Preside', '', 'Preside la sesión de directorio'], ['Secretario/a', '', 'Secretario/a de actas del directorio'], ['Comparece', enc.lider || '', 'Líder del comité de trabajo']])))
}

/* ── F7 · Cierre, capacitación y traspaso ──────────────────────────────────── */
function f7(enc) {
  return shell(7, 'F7', PLANTILLAS[7].titulo, enc,
    proposito('Cerrar el encargo de forma verificable: capacitación ejecutada con al menos 80% de asistencia registrada, KPI activado con su primera medición, traspaso formal al dueño del proceso, plan de acompañamiento de 60 días y lecciones aprendidas que alimentan la mejora del propio método P21.') +
    instrucciones([
      'La capacitación tiene destinatarios NOMINALES (personas con nombre, no "las cajeras"): el 80% se calcula sobre esa lista.',
      'La primera medición del KPI se registra en el ERP: sin ella el proceso no puede marcarse implementado.',
      'El traspaso convierte al dueño en responsable: desde la firma, las desviaciones del proceso son suyas, no del comité.',
      'Las lecciones aprendidas (sección 6) van a la próxima sesión del comité de gestión: es como mejora el método.'
    ]) +
    sec('1', 'Plan de capacitación (paso 7.1 · sesión ≤ 90 minutos)',
      'Qué debe saber hacer la gente al salir (objetivos de aprendizaje), no solo qué se les va a contar.',
      T(filaDato('Objetivos de aprendizaje (al salir, cada asistente sabe…)', '', 30) +
        filaDato('Contenidos (del SOP aprobado)', '', 26) +
        filaDato('Modalidad, duración y lugar', '') +
        filaDato('Materiales entregados', '') +
        filaDato('Cómo se verifica que aprendieron (pregunta, ejercicio, simulación)', ''))) +
    sec('2', 'Registro de asistencia (paso 7.2 · mínimo 80% con firma)',
      'La lista de destinatarios se fija primero; el porcentaje se calcula sobre ella.',
      T(th('N°', 'Destinatario (nominal)', 'Cargo / sucursal', 'Asistió', 'Firma', 'Fecha') +
        filasVacias(7, 6, 20, i => String(i)), [5, 30, 24, 10, 21, 10]) +
      T(filaDato('Cálculo de cobertura', 'Destinatarios: ____ · Asistieron: ____ · Cobertura: ____ % (mínimo 80%)'))) +
    sec('3', 'Activación del KPI (paso 7.3)',
      'Solo activación: la definición viene intacta de la Ficha F4 §5.',
      T(filaDato('Indicador (de F4 §5)', '') +
        filaDato('Responsable de medir (nombre, no cargo)', '') +
        filaDato('Primera medición: valor, período y fecha de registro en el ERP', '') +
        filaDato('Próxima medición programada para', ''))) +
    sec('4', 'Verificación de los criterios de cierre (paso 7.4)',
      'Los tres criterios del método, cada uno con su evidencia. Si alguno no se cumple, el encargo no cierra.',
      T(th('Criterio de cierre', 'Cumple', 'Evidencia (dónde está)') +
        [['Capacitación ejecutada con ≥80% de asistencia registrada con firma', '', ''],
         ['KPI activado: responsable asignado y primera medición en el ERP', '', ''],
         ['SOP vigente publicado en el módulo Procesos', '', '']]
          .map(r => `<tr>${td(esc(r[0]), 'font-size:8.5pt')}${tdv(2, 20)}</tr>`).join(''), [52, 12, 36])) +
    sec('5', 'Traspaso al dueño y plan de acompañamiento 60 días (paso 7.5)',
      'El comité de trabajo se disuelve; el dueño queda a cargo con un acompañamiento decreciente y fechado.',
      T(filaDato('Proceso traspasado a (dueño designado)', '') +
        filaDato('Fecha del traspaso', '') +
        filaDato('Compromisos del dueño (medir el KPI, reportar al comité, controlar desviaciones)', '', 30)) +
      T(th('Hito', 'Fecha', 'Qué se revisa', 'Con quién') +
        [['Día 15', '', 'KPI de las 2 primeras semanas + desviaciones del SOP', ''],
         ['Día 30', '', 'Tendencia del KPI vs. meta; ajustes menores si corresponde', ''],
         ['Día 45', '', 'Excepciones aparecidas que el SOP no cubría', ''],
         ['Día 60', '', 'Cierre del acompañamiento: informe breve al comité de gestión', '']]
          .map(r => `<tr>${td(`<b>${r[0]}</b>`, `background:${GRISX};text-align:center`)}${tdv(1, 18)}${td(esc(r[2]), `font-size:8.5pt;color:${MUTED}`)}${tdv(1, 18)}</tr>`).join(''), [10, 14, 56, 20])) +
    sec('6', 'Lecciones aprendidas del encargo',
      'Alimenta la mejora del método P21: se presenta en la siguiente sesión del comité de gestión.',
      T(th('Qué funcionó bien (mantener)', 'Qué costó o falló (cambiar)', 'Recomendación concreta para el próximo encargo') +
        filasVacias(2, 3, 30), [33, 33, 34])) +
    sec('7', 'Acta de cierre — gate de la fase 7 y del encargo', '',
      checklist([
        'Cobertura de capacitación ≥ 80% con firmas (sección 2).',
        'KPI activado con primera medición registrada en el ERP (sección 3).',
        'Los 3 criterios de cierre verificados con evidencia (sección 4).',
        'Traspaso firmado por el dueño y plan de 60 días con fechas (sección 5).',
        'Lecciones aprendidas registradas para el comité de gestión (sección 6).'
      ]) +
      aprobaciones([['Entrega', enc.lider || '', 'Líder del comité de trabajo'], ['Recibe', '', 'Dueño del proceso'], ['Fe del acta', enc.secretario || '', 'Secretario/a de actas'], ['Toma conocimiento', '', 'Responsable del comité de gestión']])))
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

/* ═══════════════════════════════════════════════════════════════════════════
   Informe de cumplimiento de la fase — se genera desde la hoja de trabajo
   ───────────────────────────────────────────────────────────────────────────
   Todo lo que el equipo registró en la app (estado, responsable, fecha, qué se
   hizo, resultado, evidencias, verificación del líder) sale como documento
   corporativo listo para imprimir o guardar en PDF y cargar como evidencia.
   ═══════════════════════════════════════════════════════════════════════════ */

const EST_L = { PENDIENTE: ['Pendiente', 'gris'], EN_CURSO: ['En curso', 'info'], HECHO: ['Hecho', 'ok'], NO_APLICA: ['No aplica', 'warn'] }
const chip = (txt, cls) => `<span class="chip ${cls}">${esc(txt)}</span>`
const fFH2 = ts => ts ? fF(String(ts).slice(0, 10)) : '—'

export function informeCumplimientoHTML({ encargo: e, fase, faseMetodo: fm, pasos = [], registros = new Map(), docs = [], gate = '' }) {
  const est = p => (registros.get(p.id) || {}).estado || 'PENDIENTE'
  const n = { HECHO: 0, EN_CURSO: 0, NO_APLICA: 0, PENDIENTE: 0 }
  pasos.forEach(p => { n[est(p)] = (n[est(p)] || 0) + 1 })
  const cumplidos = n.HECHO + n.NO_APLICA
  const pct = pasos.length ? Math.round(100 * cumplidos / pasos.length) : 0
  const verificados = pasos.filter(p => (registros.get(p.id) || {}).verificado_at).length

  const filas = pasos.map(p => {
    const r = registros.get(p.id) || {}
    const evid = docs.filter(d => d.paso_id === p.id)
    const [el, ecls] = EST_L[est(p)] || EST_L.PENDIENTE
    const resultado = p.es_decision
      ? (r.resultado ? `<b>Decisión: ${esc(r.resultado)}</b>` : '<span class="muted">decisión sin registrar</span>')
      : p.es_control_critico
        ? (r.resultado ? `<b>Control: ${esc(r.resultado)}</b>` : '<span class="muted">control sin verificar</span>')
        : (r.resultado ? esc(r.resultado) : '')
    return `
      <tr>
        <td class="num">${fase}.${p.orden}</td>
        <td>
          <b>${esc(p.accion)}</b>${p.es_control_critico ? ' ' + chip('control crítico', 'bad') : ''}${p.es_decision ? ' ' + chip('decisión', 'info') : ''}
          <div class="small muted">${p.documento ? `📄 ${esc(p.documento)}` : ''}${p.documento && p.control_tiempo ? ' · ' : ''}${p.control_tiempo ? `⏱ ${esc(p.control_tiempo)}` : ''}</div>
          ${r.registro ? `<div style="margin-top:4px">${esc(r.registro)}</div>` : '<div class="small muted" style="margin-top:4px">Sin registro de lo realizado.</div>'}
          ${resultado ? `<div style="margin-top:3px">${resultado}</div>` : ''}
          ${r.observaciones ? `<div class="small" style="margin-top:3px"><i>Obs.: ${esc(r.observaciones)}</i></div>` : ''}
        </td>
        <td>${chip(el, ecls)}</td>
        <td>${esc(r.responsable || '—')}<div class="small muted">${fFH2(r.fecha_realizado)}</div></td>
        <td>${evid.length ? evid.map(d => `<div class="small">📎 ${esc(d.nombre)}</div>`).join('') : '<span class="small muted">—</span>'}</td>
        <td>${r.verificado_at ? `<span class="chip ok">✓</span><div class="small muted">${esc(r.verificado_por || '')}<br/>${fFH2(r.verificado_at)}</div>` : '<span class="chip gris">—</span>'}</td>
      </tr>`
  }).join('')

  const cuerpo = `
    <div class="kpis">
      <div class="kpi"><div class="v">${pct}%</div><div class="l">cumplimiento de la fase</div></div>
      <div class="kpi"><div class="v">${n.HECHO}</div><div class="l">pasos hechos</div></div>
      <div class="kpi"><div class="v">${n.EN_CURSO}</div><div class="l">en curso</div></div>
      <div class="kpi"><div class="v">${n.PENDIENTE}</div><div class="l">pendientes</div></div>
      <div class="kpi"><div class="v">${verificados}/${pasos.length}</div><div class="l">verificados por el líder</div></div>
    </div>
    <h2>Registro de cumplimiento por paso del método</h2>
    <table class="t">
      <thead><tr><th style="width:44px">N°</th><th>Paso · qué se hizo · resultado</th><th style="width:78px">Estado</th><th style="width:120px">Responsable · fecha</th><th style="width:150px">Evidencia</th><th style="width:86px">Verificado</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    ${gate ? `<div class="caja warn" style="margin-top:12px"><b>Gate de salida de la fase:</b> ${esc(gate)}<div class="small" style="margin-top:4px">${pct === 100 ? '✓ Todos los pasos cumplidos o no aplicables: la fase puede cerrarse.' : `Quedan ${pasos.length - cumplidos} paso(s) sin cumplir: la fase no debería cerrarse todavía.`}</div></div>` : ''}
    <div class="firmas">
      <div class="firma"><div class="l">${esc(e.lider || 'Líder del comité de trabajo')}</div><div class="s">Líder · entrega la fase</div></div>
      <div class="firma"><div class="l">${esc(e.secretario || 'Secretario/a de actas')}</div><div class="s">Secretaría · fe del registro</div></div>
      <div class="firma"><div class="l">&nbsp;</div><div class="s">Responsable del comité que asigna · recibe</div></div>
    </div>`

  return docShell({
    titulo: `Informe de cumplimiento · Fase ${fase} · ${fm?.nombre || ''}`,
    subtitulo: `${e.proceso_id} · ${e.proceso_nombre || ''} — comité de trabajo liderado por ${e.lider || '—'}`,
    codigo: `IC${fase}-P21 · encargo ${e.id}`,
    meta: [['Método', `SOP P21 · Construcción y aprobación de procesos · fase ${fase} de 7`], ['Comité que asigna', esc(e.comite_codigo || '—')], ['Plazo del encargo', fF(e.fecha_limite)], ['Estado de la fase en el ERP', esc((e.fase_actual === fase) ? 'En curso' : (e.fase_actual > fase ? 'Completada' : 'Pendiente'))]],
    cuerpo,
    pie: `Informe de cumplimiento generado desde la hoja de trabajo del encargo. Sirve como evidencia de la fase ${fase}; los adjuntos referidos están cargados en el ERP.`,
    nombreArchivo: `IC${fase}_${e.proceso_id}_${e.id}`
  })
}

export function abrirInformeCumplimiento(args) {
  return abrirDocumento(informeCumplimientoHTML(args))
}
