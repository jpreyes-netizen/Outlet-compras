// src/procesos/prcInformeProceso.jsx
// Informe de un proceso (dossier): estado y avance, contenido completo del SOP,
// flujograma anexado por tramos en páginas horizontales con sus documentos y
// responsables, indicadores, gobierno (versiones, firmas, comité de trabajo,
// acuerdos, decisiones, capacitaciones) y bitácora. Se abre en una pestaña nueva
// para imprimir o guardar como PDF, con el mismo look que el acta y el informe de avance.

import { supabase } from '../supabase'
import { docShell, abrirDocumento, esc, fF } from './prcDoc'
import { desgloseAvance, PESOS_AVANCE, etapas } from './PrcGuia'
import { flujoSVG, modeloFlujo, FLU } from './prcFlujo'
import { semDe, semaforoDe, medicionesDe, hoyISO } from './prcComite'
import { descargar } from './prcUI'

const nl = s => esc(s).replace(/\n/g, '<br/>')
const pct = v => v == null ? '—' : `${Math.round(v)}%`
const chip = (txt, cls) => `<span class="chip ${cls}">${esc(txt)}</span>`
const chipEstado = e => {
  const m = { ABIERTO: 'warn', EN_CURSO: 'info', CERRADO: 'ok', ANULADO: 'gris', APROBADA: 'ok', RECHAZADA: 'bad', POSTERGADA: 'warn',
    BORRADOR: 'warn', POR_OFICIALIZAR: 'info', VIGENTE: 'ok', DEROGADO: 'gris', NO_EXISTE: 'gris', EXISTE_PARCIAL: 'warn', EXISTE_COMPLETO: 'info',
    ACTIVO: 'info', EN_PILOTO: 'info', EN_APROBACION: 'warn', REASIGNADO: 'bad', CANCELADO: 'gris', PENDIENTE: 'gris', COMPLETADA: 'ok', OMITIDA: 'warn' }
  return chip(String(e || '—').toLowerCase().replace(/_/g, ' '), m[e] || 'gris')
}
const ACCION_FIRMA = { ELABORA: 'Elaboró', REVISA: 'Revisó', APRUEBA: 'Aprobó', RECHAZA: 'Rechazó', PUBLICA: 'Publicó', DEROGA: 'Derogó' }
const TIPO_DEC = { APROBACION_SOP: 'Aprobación de SOP', RECHAZO_SOP: 'Rechazo de SOP', ASIGNACION_PROCESO: 'Asignación de proceso', REASIGNACION: 'Reasignación', CONTRAMEDIDA: 'Contramedida', CAMBIO_META: 'Cambio de meta', RECURSOS: 'Recursos', ESCALAMIENTO: 'Escalamiento', OTRA: 'Otra' }
const SEM_PROCESO = { rojo: ['bad', 'En riesgo'], ambar: ['warn', 'Atrasado'], verde: ['ok', 'Al día'], gris: ['gris', 'Sin alerta'] }

/* ── flujograma por tramos: ventanas del SVG completo, con la columna de carriles repetida ── */
export function tramosFlujo(proceso, fases, pasos, opts = {}) {
  const m = modeloFlujo(fases, pasos)
  if (!m.cols.length) return { tramos: [], m }
  const svg = flujoSVG(proceso, fases, pasos, { version: opts.version, fecha: opts.fecha })
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  const cellX = i => FLU.PAD + FLU.LANE_W + FLU.TERM_W + i * FLU.COL_W
  const y0 = FLU.PAD + FLU.TITLE_H - 6                       // sin el bloque de título (va en el HTML)
  const y1 = m.H - FLU.PAD - 34                              // sin la leyenda (va en el HTML)
  const segH = y1 - y0
  const LW = FLU.PAD + FLU.LANE_W + 2                        // columna de carriles
  const MAX_COLS = opts.maxCols || 5

  // cortes por fase; una fase con más columnas que MAX_COLS se parte
  const grupos = []
  let actual = null
  m.barras.forEach(b => {
    const n = b.hasta - b.desde + 1
    if (n > MAX_COLS) {
      if (actual) { grupos.push(actual); actual = null }
      for (let i = b.desde; i <= b.hasta; i += MAX_COLS) grupos.push({ desde: i, hasta: Math.min(b.hasta, i + MAX_COLS - 1), fases: [b.faseIdx] })
      return
    }
    if (actual && (actual.hasta - actual.desde + 1 + n) <= MAX_COLS) { actual.hasta = b.hasta; actual.fases.push(b.faseIdx) }
    else { if (actual) grupos.push(actual); actual = { desde: b.desde, hasta: b.hasta, fases: [b.faseIdx] } }
  })
  if (actual) grupos.push(actual)

  const ultimo = m.cols.length - 1
  const tramos = grupos.map((g, k) => {
    const x0 = cellX(g.desde) - (g.desde === 0 ? FLU.TERM_W : 0) - 6
    const x1 = cellX(g.hasta + 1) + (g.hasta === ultimo ? FLU.TERM_W : 0) + 6
    const w = x1 - x0
    const nombres = [...new Set(g.fases)].map(fi => `${fi + 1}. ${m.fases[fi].nombre}`)
    const svgTramo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LW + w} ${segH}" width="${LW + w}" height="${segH}">
  <svg x="0" y="0" width="${LW}" height="${segH}" viewBox="0 ${y0} ${LW} ${segH}" preserveAspectRatio="xMinYMin meet">${inner}</svg>
  <svg x="${LW}" y="0" width="${w}" height="${segH}" viewBox="${x0} ${y0} ${w} ${segH}" preserveAspectRatio="xMinYMin meet">${inner}</svg>
</svg>`
    return { k: k + 1, total: grupos.length, desde: g.desde, hasta: g.hasta, fases: nombres, svg: svgTramo, ancho: LW + w }
  })
  return { tramos, m }
}

const LEYENDA = `<div class="ley">
  <span><i style="background:#D5E8D4;border-color:#82B366;border-radius:8px"></i>Inicio / término</span>
  <span><i style="background:#fff;border-color:#B85450;border-width:2px"></i>Control crítico</span>
  <span><i style="background:#FFF2CC;border-color:#D6B656;transform:rotate(45deg);width:10px;height:10px"></i>Punto de decisión</span>
  <span><i style="background:#DAE8FC;border-color:#6C8EBF"></i>Paso con documento</span>
  <span><i style="border:0;border-top:2px dashed #D79B00;height:0;width:22px"></i>Retorno o salto de la decisión</span>
</div>`

/* ══════════════════════════════════════════════════════════════════════════
   HTML del informe
   ══════════════════════════════════════════════════════════════════════════ */
export function informeProcesoHTML({ p, d, cat = {}, matriz = [], deps = [], encargo, encFases = [], acuerdos = [], decisiones = [], scorecard = [], cu }) {
  const hoy = hoyISO()
  const a = desgloseAvance({ proceso: p, d })
  const et = etapas({ proceso: p, d })
  const comite = (cat.comites || []).find(c => c.codigo === p.comite_codigo)
  const nombreProc = id => (matriz.find(x => x.id === id) || {}).nombre || ''
  const fs = [...(d.fases || [])].sort((x, y) => (x.orden || 0) - (y.orden || 0))
  const pasosDe = f => (d.pasos || []).filter(x => x.fase_id === f.id).sort((x, y) => (x.orden || 0) - (y.orden || 0))
  const numero = new Map()
  fs.forEach((f, fi) => pasosDe(f).forEach((x, i) => numero.set(x.id, `${fi + 1}.${i + 1}`)))
  const docSop = (d.docs || []).filter(x => x.tipo === 'SOP').sort((x, y) => String(y.version).localeCompare(String(x.version), 'es', { numeric: true }))
  const sopVig = docSop.find(x => x.es_vigente) || docSop[0]
  const version = sopVig ? `${sopVig.es_vigente ? 'Vigente' : 'Borrador'} v${sopVig.version}` : 'Sin versión guardada'
  const semP = SEM_PROCESO[p.semaforo] || SEM_PROCESO.gris
  const abiertos = acuerdos.filter(x => ['ABIERTO', 'EN_CURSO'].includes(x.estado))
  const vencidos = abiertos.filter(x => x.vencido)
  const sc = new Map(scorecard.map(k => [k.id, k]))
  const carriles = [...new Set((d.pasos || []).map(x => (x.responsable || 'Sin asignar').trim()))]
  const docsFlujo = fs.flatMap((f, fi) => pasosDe(f).filter(x => x.documento).map(x => ({ n: numero.get(x.id), fase: f.nombre, accion: x.accion, documento: x.documento, url: x.documento_url, responsable: x.responsable })))
  const { tramos } = tramosFlujo(p, fs, d.pasos || [], { version, fecha: fF(hoy) })

  /* resumen automático */
  const mensajes = []
  mensajes.push(`Avance global <b>${pct(a.global)}</b>: SOP ${pct(a.sop)} · flujograma ${pct(a.flujograma)} · capacitación ${pct(a.capacitacion)} · implementación ${pct(a.implementacion)}. Etapa ${Math.min(6, et.filter(e => e.ok).length + 1)} de 6: <b>${esc((et.find(e => !e.ok) || {}).l || 'todas completas')}</b>.`)
  mensajes.push(`Contenido del SOP: ${a.contenidoN} de 7 secciones${a.contenidoN < 7 ? ` (faltan ${a.secciones.filter(s => !s.ok).map(s => s.l.toLowerCase()).join(', ')})` : ' completas'}; ${fs.length} fases y ${(d.pasos || []).length} pasos, ${(d.pasos || []).filter(x => x.es_decision).length} decisiones, ${(d.pasos || []).filter(x => x.es_control_critico).length} controles críticos y ${docsFlujo.length} documentos asociados al flujo.`)
  if (p.dueno_provisional) mensajes.push(`Dueño provisional: el cargo <b>${esc(p.dueno_cargo || '—')}</b> está vacante o por contratar; sin dueño real no hay quien firme la revisión ni lidere la bajada.`)
  if (p.dias_atraso > 0) mensajes.push(`${p.dias_atraso} días sobre la fecha objetivo vigente (${fF(p.fecha_objetivo_vigente)}). Semáforo: ${semP[1].toLowerCase()}.`)
  if (encargo) mensajes.push(`Comité de trabajo liderado por <b>${esc(encargo.lider)}</b> (${(encargo.integrantes || []).length} integrantes), fase ${encargo.fase_actual} de 7 (${esc(encargo.fase_actual_nombre || '')}), ${encargo.vencido ? `<b>vencido hace ${Math.abs(encargo.dias_restantes)} días</b>` : `${encargo.dias_restantes} días de plazo`}.`)
  else mensajes.push('Sin comité de trabajo asignado: nadie tiene el encargo formal de llevar este proceso a aprobación (P37).')
  if (abiertos.length) mensajes.push(`${abiertos.length} acuerdo(s) abiertos en comités${vencidos.length ? `, <b>${vencidos.length} vencidos</b>` : ''}.`)
  const kpisSinMed = (d.kpis || []).filter(k => !medicionesDe(k.id, d.mediciones || []).length)
  if ((d.kpis || []).length) mensajes.push(`${(d.kpis || []).length} indicadores definidos, ${(d.kpis || []).length - kpisSinMed.length} con medición${kpisSinMed.length ? `; sin dato: ${kpisSinMed.slice(0, 4).map(k => esc(k.indicador)).join(', ')}${kpisSinMed.length > 4 ? '…' : ''}` : ''}.`)

  const kpi = (l, v, s) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${v}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`
  const barra = (v, color) => `<div class="barra"><div style="width:${Math.max(0, Math.min(100, v || 0))}%;background:${color || 'var(--acc)'}"></div></div>`
  const secciones = []

  /* 1. resumen */
  secciones.push(`<h2>1. Resumen ejecutivo</h2>
    <div class="caja ${semP[0]}"><b>${esc(p.estado_impl_etiqueta || p.estado_implementacion)} · ${semP[1]}.</b> ${esc(p.objetivo || '')}</div>
    <ul class="lista">${mensajes.map(x => `<li>${x}</li>`).join('')}</ul>`)

  /* 2. avance */
  secciones.push(`<h2>2. Avance y etapas</h2>
    <div class="kpis">
      ${kpi(`SOP · pesa ${PESOS_AVANCE.sop}%`, pct(a.sop), `aporta ${Math.round(a.sop * PESOS_AVANCE.sop / 100)} de ${PESOS_AVANCE.sop} puntos`)}
      ${kpi(`Flujograma · pesa ${PESOS_AVANCE.flujograma}%`, pct(a.flujograma), `aporta ${Math.round(a.flujograma * PESOS_AVANCE.flujograma / 100)} de ${PESOS_AVANCE.flujograma}`)}
      ${kpi(`Capacitación · pesa ${PESOS_AVANCE.capacitacion}%`, pct(a.capacitacion), `aporta ${Math.round(a.capacitacion * PESOS_AVANCE.capacitacion / 100)} de ${PESOS_AVANCE.capacitacion}`)}
      ${kpi(`Implementación · pesa ${PESOS_AVANCE.implementacion}%`, pct(a.implementacion), `aporta ${Math.round(a.implementacion * PESOS_AVANCE.implementacion / 100)} de ${PESOS_AVANCE.implementacion}`)}
    </div>
    <div class="caja"><b>Avance global ${pct(a.global)}</b> ${barra(a.global)}</div>
    <h3>Las 6 etapas del ciclo de vida</h3>
    <table class="t"><tr><th class="num">N°</th><th>Etapa</th><th>Estado</th><th>Qué significa / cómo se hace</th></tr>
    ${et.map(e => `<tr><td class="num">${e.n}</td><td><b>${esc(e.l)}</b></td><td>${e.ok ? chip('completa', 'ok') : chip('pendiente', 'gris')}${e.detalle && !e.ok ? `<div class="small muted">${esc(e.detalle)}</div>` : ''}</td><td class="small">${esc(e.desc)}${!e.ok ? `<br/><span class="muted">${esc(e.comoSeHace)}</span>` : ''}</td></tr>`).join('')}</table>
    <h3>Qué suma y qué falta</h3>
    <table class="t"><tr><th>Ítem</th><th>Componente</th><th>Puntos</th><th>Estado</th><th>Cómo se completa</th></tr>
    ${a.items.map(i => `<tr><td><b>${esc(i.l)}</b></td><td class="small">${esc(i.comp)}</td><td>${i.pts}/${i.max}</td><td>${i.ok ? chip('listo', 'ok') : chip('falta', 'warn')}</td><td class="small">${i.ok ? '—' : esc(i.falta || '')}</td></tr>`).join('')}</table>
    ${(d.avance || []).length ? `<h3>Notas de avance</h3><table class="t"><tr><th>Fecha</th><th>Global</th><th>Nota</th><th>Registró</th></tr>
      ${d.avance.slice(0, 12).map(x => `<tr><td>${fF(x.fecha_corte)}</td><td>${pct(x.pct_global)}</td><td>${nl(x.comentario)}</td><td class="small">${esc(x.registrado_por || '—')}</td></tr>`).join('')}</table>` : ''}`)

  /* 3. contenido del SOP */
  const rolesT = (d.roles || []).length ? `<table class="t"><tr><th>Rol</th><th>Función en este proceso</th><th>Límite — qué NO puede hacer</th></tr>
    ${[...d.roles].sort((x, y) => (x.orden || 0) - (y.orden || 0)).map(r => `<tr><td><b>${esc(r.rol)}</b></td><td>${nl(r.funcion || '—')}</td><td>${nl(r.limite || '—')}</td></tr>`).join('')}</table>` : '<p class="muted">Sin roles registrados.</p>'
  const transT = (d.transicion || []).length ? `<table class="t"><tr><th>Dimensión</th><th>Cómo funciona HOY</th><th>Cómo debe funcionar</th></tr>
    ${[...d.transicion].sort((x, y) => (x.orden || 0) - (y.orden || 0)).map(t => `<tr><td><b>${esc(t.dimension)}</b></td><td>${nl(t.hoy || '—')}</td><td>${nl(t.debe_ser || '—')}</td></tr>`).join('')}</table>` : '<p class="muted">Sin diagnóstico de transición registrado.</p>'
  const fasesT = fs.length ? fs.map((f, fi) => {
    const ps = pasosDe(f)
    const errs = (d.errores || []).filter(e => e.fase_id === f.id).sort((x, y) => (x.orden || 0) - (y.orden || 0))
    const apoyo = (f.responsables_apoyo || []).filter(Boolean)
    return `<h3>Fase ${fi + 1} — ${esc(f.nombre)}</h3>
      <p class="small"><i>${esc(f.descripcion || 'Sin descripción.')}</i> · Responsable principal: <b>${esc(f.responsable_principal || '—')}</b>${apoyo.length ? ` · Con: ${apoyo.map(esc).join(', ')}` : ''}</p>
      ${ps.length ? `<table class="t"><tr><th class="num">N°</th><th style="width:34%">Acción</th><th>Responsable</th><th>Participan</th><th>Sistema</th><th>Documento</th><th>Control / tiempo</th></tr>
        ${ps.map(s => {
          const marca = s.es_control_critico ? ' 🔴' : s.es_decision ? ' ◆' : ''
          const dest = id => numero.has(id) ? ` (paso ${numero.get(id)})` : ''
          const ramas = s.es_decision ? `<div class="small"><b>Sí →</b> ${esc(s.rama_si || '—')}${s.rama_si_destino ? dest(s.rama_si_destino) : ''}<br/><b>No →</b> ${esc(s.rama_no || '—')}${s.rama_no_destino ? dest(s.rama_no_destino) : ''}</div>` : ''
          const doc = s.documento ? (s.documento_url ? `<a href="${esc(s.documento_url)}">${esc(s.documento)}</a>` : esc(s.documento)) : '—'
          return `<tr><td class="num">${numero.get(s.id)}${marca}</td><td>${esc(s.accion)}${ramas}</td><td>${esc(s.responsable || '—')}</td><td class="small">${(s.participantes || []).filter(Boolean).map(esc).join(', ') || '—'}</td><td class="small">${esc(s.sistema || '—')}</td><td class="small">${doc}</td><td class="small">${esc(s.control_tiempo || '—')}</td></tr>`
        }).join('')}</table>` : '<p class="muted">Sin pasos registrados.</p>'}
      ${errs.length ? `<p class="small"><b>Errores frecuentes:</b> ${errs.map(e => `${esc(e.error)}${e.prevencion ? ` <span class="muted">(prevención: ${esc(e.prevencion)})</span>` : ''}`).join(' · ')}</p>` : ''}`
  }).join('') : '<p class="muted">Sin fases registradas.</p>'

  secciones.push(`<h2>3. El proceso (contenido del SOP · ${esc(version)})</h2>
    <h3>Objetivo</h3><p>${nl(p.objetivo || 'Pendiente de redacción.')}</p>
    <h3>Alcance</h3><p>${nl(p.alcance || 'Pendiente de redacción.')}</p>
    ${p.regla_critica ? `<div class="caja bad"><b>REGLA CRÍTICA · </b>${nl(p.regla_critica)}</div>` : '<p class="muted">Sin regla crítica definida.</p>'}
    <h3>Principios operativos</h3>${(d.principios || []).length ? `<ul class="lista">${[...d.principios].sort((x, y) => (x.orden || 0) - (y.orden || 0)).map(x => `<li>${nl(x.texto)}</li>`).join('')}</ul>` : '<p class="muted">Sin principios registrados.</p>'}
    <h3>Roles y límites</h3>${rolesT}
    <h3>Estado de transición</h3>${transT}
    <h3>Flujo operativo por fases</h3>${fasesT}
    <p class="small muted">🔴 control crítico · ◆ punto de decisión</p>`)

  /* 4. flujograma */
  const flujoHTML = tramos.length
    ? tramos.map(t => `<div class="pag-flujo"><div class="tramo-cab"><b>Anexo A · Flujograma ${esc(p.id)}</b> — tramo ${t.k} de ${t.total} · ${t.fases.map(esc).join(' · ')} <span class="muted">· ${esc(version)} · ${fF(hoy)}</span></div><div class="tramo-svg">${t.svg}</div>${LEYENDA}</div>`).join('')
    : '<p class="muted">El flujograma se genera cuando el proceso tiene fases con pasos.</p>'
  const docsT = docsFlujo.length ? `<table class="t"><tr><th class="num">Paso</th><th>Fase</th><th>Acción</th><th>Documento / estándar</th><th>Responsable</th></tr>
    ${docsFlujo.map(x => `<tr><td class="num">${esc(x.n)}</td><td class="small">${esc(x.fase)}</td><td>${esc(x.accion)}</td><td><b>${esc(x.documento)}</b>${x.url ? `<div class="small"><a href="${esc(x.url)}">${esc(x.url)}</a></div>` : ''}</td><td class="small">${esc(x.responsable || '—')}</td></tr>`).join('')}</table>` : '<p class="muted">Ningún paso tiene documento asociado todavía (Editar → sección 5 → Documento).</p>'
  const carrilesT = carriles.length ? `<table class="t"><tr><th>Carril (responsable)</th><th class="num">Pasos</th><th class="num">Decisiones</th><th class="num">Controles</th><th>Fases en que participa</th></tr>
    ${carriles.map(c => { const ps = (d.pasos || []).filter(x => (x.responsable || 'Sin asignar').trim() === c); const fasesC = [...new Set(ps.map(x => (fs.find(f => f.id === x.fase_id) || {}).nombre).filter(Boolean))]
      return `<tr><td><b>${esc(c)}</b></td><td class="num">${ps.length}</td><td class="num">${ps.filter(x => x.es_decision).length}</td><td class="num">${ps.filter(x => x.es_control_critico).length}</td><td class="small">${fasesC.map(esc).join(', ')}</td></tr>` }).join('')}</table>` : ''
  secciones.push(`<h2>4. Flujograma, documentos y responsables</h2>
    <p class="small muted">El flujograma completo va en el Anexo A (páginas horizontales, un tramo por grupo de fases; la columna de carriles se repite en cada tramo). Paso celeste = lleva documento; rombo = decisión; borde rojo = control crítico; flecha naranja discontinua = la decisión vuelve o salta a otro paso.</p>
    <h3>Documentos del flujo</h3>${docsT}
    <h3>Carriles y responsables</h3>${carrilesT}`)

  /* 5. indicadores */
  const kpisT = (d.kpis || []).length ? `<table class="t"><tr><th>Indicador</th><th>Definición</th><th>Meta</th><th>Frecuencia</th><th>Responsable</th><th>Última medición</th><th>Semáforo</th></tr>
    ${[...d.kpis].sort((x, y) => (x.orden || 0) - (y.orden || 0)).map(k => {
      const s = sc.get(k.id); const ms = medicionesDe(k.id, d.mediciones || []); const u = ms[0]
      const sem = s?.semaforo || semaforoDe(k, u); const S = semDe(sem)
      return `<tr><td>${k.es_kpi_ancla ? '⚓ ' : ''}<b>${esc(k.indicador)}</b></td><td class="small">${esc(k.definicion_operacional || '—')}</td><td>${k.meta_valor != null ? `${k.sentido === 'MENOR_MEJOR' ? '≤' : '≥'} ${k.meta_valor}${k.unidad ? ' ' + esc(k.unidad) : ''}` : esc(k.meta || '—')}</td><td class="small">${esc(k.frecuencia || '—')}</td><td class="small">${esc(k.responsable || '—')}</td><td>${u ? `${u.valor ?? esc(u.valor_texto ?? '—')}<div class="small muted">${esc(u.periodo)}</div>` : '<span class="muted">sin dato</span>'}</td><td><span class="chip" style="background:${S.bg};color:${S.c}">${esc(S.l)}</span></td></tr>`
    }).join('')}</table>` : '<p class="muted">Sin indicadores registrados.</p>'
  const medT = (d.mediciones || []).length ? `<h3>Historial de mediciones</h3><table class="t"><tr><th>Período</th><th>Indicador</th><th>Valor</th><th>Cumple</th><th>Comentario</th><th>Registró</th></tr>
    ${[...d.mediciones].sort((x, y) => String(y.periodo).localeCompare(String(x.periodo))).slice(0, 24).map(m => { const k = (d.kpis || []).find(z => z.id === m.kpi_id)
      return `<tr><td>${esc(m.periodo)}</td><td class="small">${esc(k?.indicador || '—')}</td><td>${m.valor ?? esc(m.valor_texto ?? '—')}</td><td>${m.cumple === true ? chip('sí', 'ok') : m.cumple === false ? chip('no', 'bad') : '—'}</td><td class="small">${esc(m.comentario || '')}</td><td class="small">${esc(m.registrado_por || '—')}</td></tr>` }).join('')}</table>` : ''
  secciones.push(`<h2>5. Indicadores</h2>${kpisT}${medT}`)

  /* 6. gobierno */
  const docsG = (d.docs || []).length ? `<table class="t"><tr><th>Código</th><th>Tipo</th><th>Versión</th><th>Estado</th><th>Emisión</th><th>Vigencia</th><th>Próx. revisión</th><th>Elaboró / revisó / aprobó</th></tr>
    ${[...d.docs].sort((x, y) => String(x.codigo).localeCompare(String(y.codigo)) || String(y.version).localeCompare(String(x.version), 'es', { numeric: true })).map(x => `<tr><td><b>${esc(x.codigo)}</b></td><td class="small">${esc(x.tipo)}</td><td>v${esc(x.version)}</td><td>${chipEstado(x.estado)}${x.es_vigente ? ' ' + chip('vigente', 'ok') : ''}</td><td>${fF(x.fecha_emision)}</td><td>${fF(x.fecha_vigencia)}</td><td>${fF(x.proxima_revision)}</td><td class="small">${esc(x.elaborado_por || '—')} / ${esc(x.revisado_por || '—')} / ${esc(x.aprobado_por || '—')}</td></tr>`).join('')}</table>` : '<p class="muted">Sin versiones guardadas. El contenido vive en el editor hasta que se guarde como versión.</p>'
  const firmasT = (d.firmas || []).length ? `<table class="t"><tr><th>Fecha</th><th>Acción</th><th>Quién</th><th>Rol</th><th>Comentario</th></tr>
    ${[...d.firmas].sort((x, y) => String(y.fecha).localeCompare(String(x.fecha))).map(f => `<tr><td>${fF(f.fecha)}${f.hora ? ' ' + esc(f.hora) : ''}</td><td>${chip(ACCION_FIRMA[f.accion] || f.accion, f.accion === 'APRUEBA' ? 'ok' : f.accion === 'RECHAZA' || f.accion === 'DEROGA' ? 'bad' : 'info')}</td><td><b>${esc(f.nombre_usuario)}</b></td><td class="small">${esc(f.rol_usuario || '—')}</td><td class="small">${esc(f.comentario || '—')}</td></tr>`).join('')}</table>` : '<p class="muted">Sin firmas registradas.</p>'
  const encT = encargo ? `<div class="caja ${encargo.vencido ? 'bad' : 'ok'}"><b>Comité de trabajo</b> · líder <b>${esc(encargo.lider)}</b>${encargo.secretario ? ` · secretaría ${esc(encargo.secretario)}` : ''} · integrantes: ${(encargo.integrantes || []).map(esc).join(', ')}<br/>
      <span class="small">Inicio ${fF(encargo.fecha_inicio)} · plazo ${fF(encargo.fecha_limite)} (${encargo.vencido ? `vencido hace ${Math.abs(encargo.dias_restantes)} días` : `${encargo.dias_restantes} días`}) · estado ${esc(String(encargo.estado).toLowerCase().replace('_', ' '))} · asignado por ${esc(encargo.comite_nombre || encargo.comite_codigo || '—')}${encargo.objetivo ? ` · objetivo: ${esc(encargo.objetivo)}` : ''}</span></div>
    ${encFases.length ? `<table class="t"><tr><th class="num">Fase</th><th>Nombre</th><th>Estado</th><th>Meta</th><th>Inicio</th><th>Fin</th><th>Entregable</th></tr>
      ${[...encFases].sort((x, y) => x.fase - y.fase).map(f => `<tr><td class="num">${f.fase}</td><td><b>${esc(f.nombre)}</b></td><td>${chipEstado(f.estado)}</td><td>${fF(f.fecha_meta)}</td><td>${fF(f.fecha_inicio)}</td><td>${fF(f.fecha_fin)}</td><td class="small">${esc(f.entregable || '—')}${f.entregable_url ? ` <a href="${esc(f.entregable_url)}">↗</a>` : ''}</td></tr>`).join('')}</table>` : ''}`
    : '<p class="muted">Sin comité de trabajo asignado. Se asigna desde la sala de sesión del comité de gobierno o en Comités → Comités de trabajo (P37).</p>'
  const acuT = acuerdos.length ? `<table class="t"><tr><th>Fecha</th><th>Comité</th><th>Tipo</th><th style="width:36%">Acuerdo</th><th>Responsable</th><th>Plazo</th><th>Estado</th></tr>
    ${acuerdos.slice(0, 30).map(x => `<tr><td>${fF(x.fecha_sesion)}</td><td class="small">${esc(x.comite_codigo)}${x.sesion_numero ? ` N° ${x.sesion_numero}` : ''}</td><td class="small">${esc(String(x.tipo).toLowerCase().replace('_', ' '))}</td><td>${nl(x.acuerdo)}${x.criterio_cierre ? `<div class="small muted">cierre: ${esc(x.criterio_cierre)}</div>` : ''}</td><td class="small">${esc(x.responsable || '—')}</td><td>${fF(x.fecha_compromiso)}${x.vencido ? ' ' + chip(`+${x.dias_atraso} d`, 'bad') : ''}</td><td>${chipEstado(x.estado)}</td></tr>`).join('')}</table>` : '<p class="muted">Sin acuerdos de comité asociados.</p>'
  const decT = decisiones.length ? `<table class="t"><tr><th>Fecha</th><th>Comité</th><th>Tipo</th><th style="width:44%">Decisión</th><th>Votación</th><th>Resultado</th></tr>
    ${decisiones.slice(0, 30).map(x => `<tr><td>${fF(x.fecha)}</td><td class="small">${esc(x.comite_codigo)}</td><td class="small">${esc(TIPO_DEC[x.tipo] || x.tipo)}</td><td>${nl(x.decision)}${x.fundamento ? `<div class="small muted">${esc(x.fundamento)}</div>` : ''}</td><td class="small">${x.unanime ? 'unánime' : `${x.votos_favor ?? 0}–${x.votos_contra ?? 0}–${x.abstenciones ?? 0}`}</td><td>${chipEstado(x.resultado)}</td></tr>`).join('')}</table>` : '<p class="muted">Sin decisiones de comité asociadas.</p>'
  const capT = (d.capac || []).length ? `<table class="t"><tr><th>Fecha</th><th>Sucursal</th><th>Facilitador</th><th class="num">Asistentes</th><th>Duración</th><th>Evaluación</th></tr>
    ${d.capac.map(c => `<tr><td>${fF(c.fecha)}</td><td>${esc(c.sucursal || '—')}</td><td>${esc(c.facilitador || '—')}</td><td class="num">${c.n_asistentes ?? (Array.isArray(c.asistentes) ? c.asistentes.length : '—')}</td><td>${c.duracion_min ? c.duracion_min + ' min' : '—'}</td><td class="small">${c.evaluacion_aplicada ? `aplicada${c.nota_promedio != null ? ` · nota ${c.nota_promedio}` : ''}` : 'no aplicada'}</td></tr>`).join('')}</table>` : '<p class="muted">Sin capacitaciones registradas. Es requisito del estado IMPLEMENTADO.</p>'
  const misDeps = deps.filter(x => x.proceso_id === p.id), meReq = deps.filter(x => x.depende_de_id === p.id)
  const depT = (misDeps.length || meReq.length) ? `<table class="t"><tr><th>Relación</th><th>Proceso</th><th>Tipo</th></tr>
    ${misDeps.map(x => `<tr><td class="small">Depende de</td><td><b>${esc(x.depende_de_id)}</b> ${esc(nombreProc(x.depende_de_id))}</td><td>${chip(x.tipo, x.tipo === 'bloqueante' ? 'bad' : 'info')}</td></tr>`).join('')}
    ${meReq.map(x => `<tr><td class="small">Lo requiere</td><td><b>${esc(x.proceso_id)}</b> ${esc(nombreProc(x.proceso_id))}</td><td>${chip(x.tipo, x.tipo === 'bloqueante' ? 'bad' : 'info')}</td></tr>`).join('')}</table>` : '<p class="muted">Sin dependencias registradas.</p>'
  secciones.push(`<h2>6. Gobierno y trazabilidad</h2>
    <h3>Versiones del documento</h3>${docsG}
    <h3>Firmas</h3>${firmasT}
    <h3>Comité de trabajo (P37)</h3>${encT}
    <h3>Acuerdos de comité asociados</h3>${acuT}
    <h3>Decisiones de comité asociadas</h3>${decT}
    <h3>Capacitaciones</h3>${capT}
    <h3>Relación con otros procesos</h3>${depT}`)

  /* 7. bitácora */
  secciones.push(`<h2>7. Bitácora</h2>
    ${(d.hitos || []).length ? `<table class="t"><tr><th>Fecha</th><th>Tipo</th><th>Hito</th><th>Responsable</th></tr>
      ${[...d.hitos].sort((x, y) => String(y.fecha).localeCompare(String(x.fecha))).slice(0, 40).map(h => `<tr><td>${fF(h.fecha)}</td><td class="small">${esc(String(h.tipo || '').toLowerCase())}</td><td>${nl(h.descripcion)}</td><td class="small">${esc(h.responsable || '—')}</td></tr>`).join('')}</table>` : '<p class="muted">Sin hitos registrados.</p>'}`)

  /* 8. pendientes */
  const pendientes = []
  a.items.filter(i => !i.ok).forEach(i => pendientes.push(`${i.l}${i.falta ? ` — ${i.falta}` : ''}.`))
  vencidos.forEach(x => pendientes.push(`Acuerdo vencido (${fF(x.fecha_compromiso)}, ${x.responsable || 'sin responsable'}): ${x.acuerdo}`))
  if (encargo && encargo.vencido) pendientes.push(`El comité de trabajo superó el plazo de 2 meses: el comité de gobierno debe decidir extender, cerrar o reasignar (principio 13).`)
  if (encargo && !encargo.vencido) pendientes.push(`Comité de trabajo: completar la fase ${encargo.fase_actual} (${encargo.fase_actual_nombre || ''}) antes del ${fF(encargo.fecha_limite)}.`)
  if (p.dueno_provisional) pendientes.push(`Definir dueño real para el cargo ${p.dueno_cargo || '—'} o un dueño interino con firma.`)
  if (kpisSinMed.length) pendientes.push(`Cargar la primera medición de: ${kpisSinMed.map(k => k.indicador).join(', ')}.`)
  secciones.push(`<h2>8. Pendientes para avanzar</h2>${pendientes.length ? `<ol class="lista">${pendientes.map(x => `<li>${nl(x)}</li>`).join('')}</ol>` : '<p class="muted">Sin pendientes: el proceso cumple todas las etapas.</p>'}`)

  /* anexo A: flujograma en horizontal */
  secciones.push(`<style>
    @page flujo { size: A4 landscape; margin: 10mm 10mm 12mm; }
    .pag-flujo { page: flujo; break-before: page; margin: 0 -8mm; }
    .tramo-svg { display: block; break-inside: avoid; }
    .pie { page: flujo; }   /* el pie sigue en la última página horizontal, no abre una hoja vertical vacía */
    .pag-flujo svg { max-width: 100%; max-height: 140mm; width: auto; height: auto; display: block; margin: 0 auto; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
    .tramo-cab { font-size: 10.5pt; margin: 0 0 3mm; color: var(--ink); }
    .ley { display: flex; gap: 16px; flex-wrap: wrap; font-size: 8.8pt; color: var(--muted); margin-top: 3mm; }
    .ley span { display: inline-flex; align-items: center; gap: 6px; }
    .ley i { display: inline-block; width: 18px; height: 11px; border: 1.5px solid #4D4D4D; border-radius: 2px; background: #fff; }
    @media screen { .pag-flujo { margin: 6mm 0; } }
  </style>
  ${flujoHTML}`)

  const meta = [
    ['Proceso', `<b>${esc(p.id)} · ${esc(p.nombre)}</b>`],
    ['Clasificación', `${esc(p.categoria_nombre || p.categoria)} · ${esc(String(p.onda_nombre || p.onda || '').replace('ONDA_', 'Onda '))} · impacto ${esc(p.impacto)} × urgencia ${esc(p.urgencia)} = score ${p.score} · detalle ${esc(p.nivel_detalle || '—')}`],
    ['Dirección / comité', `${esc(p.direccion_etiqueta || p.direccion_responsable || '—')} · ${esc(comite?.nombre || '—')}`],
    ['Dueño del proceso', `${esc(p.dueno_cargo || '—')}${p.dueno_persona ? ' — ' + esc(p.dueno_persona) : ''}${p.dueno_provisional ? ' ' + chip('provisional', 'warn') : ''}`],
    ['Estado', `${esc(p.estado_impl_etiqueta || p.estado_implementacion)} · SOP ${esc(String(p.estado_sop || '').toLowerCase().replace('_', ' '))} · flujograma ${esc(String(p.estado_flujograma || '').toLowerCase().replace('_', ' '))} · ${chip(semP[1], semP[0])}`],
    ['Fechas', `objetivo vigente ${fF(p.fecha_objetivo_vigente)}${p.dias_atraso > 0 ? ` (<b>${p.dias_atraso} días de atraso</b>)` : ''}${p.proxima_revision ? ` · próxima revisión ${fF(p.proxima_revision)}` : ''} · corte del informe ${fF(hoy)}`],
    ['Documento SOP', `${esc(version)} · ${docSop.length} versión(es) guardada(s)`],
    ['Preparado por', esc(cu?.nombre || 'Módulo Procesos')]
  ]
  return docShell({
    titulo: `Informe del proceso ${p.id}`, subtitulo: p.nombre, codigo: `INF-${p.id} · ${fF(hoy)}`, meta, cuerpo: secciones.join('\n'),
    pie: `Informe del proceso ${p.id} · avance ${pct(a.global)} · documento de trabajo, no reemplaza al SOP firmado`, nombreArchivo: `Informe_${p.id}_${hoy}`
  })
}

/** Carga lo que falta (acuerdos, decisiones, fases del encargo, scorecard), arma el informe y lo abre. */
export async function generarInformeProceso({ p, d, cat, matriz, deps, encargo, cu, toast }) {
  const q = (t, f) => f(supabase.from(t).select('*')).then(r => (r.error ? [] : r.data || []))
  const [acuerdos, decisiones, scorecard, encFases] = await Promise.all([
    q('v_prc_acuerdos', s => s.eq('proceso_id', p.id).order('fecha_sesion', { ascending: false })),
    q('prc_decisiones', s => s.eq('proceso_id', p.id).order('fecha', { ascending: false })),
    q('v_prc_scorecard', s => s.eq('proceso_id', p.id)),
    encargo ? q('prc_encargo_fases', s => s.eq('encargo_id', encargo.id).order('fase')) : Promise.resolve([])
  ])
  const html = informeProcesoHTML({ p, d, cat, matriz, deps, encargo, encFases, acuerdos, decisiones, scorecard, cu })
  if (!abrirDocumento(html)) {
    descargar(`Informe_${p.id}_${hoyISO()}.html`, html, 'text/html;charset=utf-8')
    toast?.('El navegador bloqueó la pestaña: se descargó el informe como archivo HTML. Ábrelo e imprime a PDF.')
  } else {
    toast?.(`Informe del proceso ${p.id} generado. En la pestaña nueva: Imprimir → Guardar como PDF (el flujograma sale en páginas horizontales).`)
  }
}
