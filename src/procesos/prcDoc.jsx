// src/procesos/prcDoc.js
// Documentos imprimibles del comité de gestión: acta de sesión e informe de avance.
// Generan HTML autocontenido con el look corporativo (encabezado oscuro
// #1a1a2e → #16213e, tipografía SF Pro) y se abren en una pestaña nueva, donde
// el usuario imprime o guarda como PDF (Chrome → Imprimir → Guardar como PDF).
// El mismo generador alimenta el PDF que se produce fuera de la app.

import { SEM, semDe, horasActa, horasAnticipacion } from './prcComite'

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const fF = d => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}` }
const fFH = ts => { if (!ts) return '—'; const t = new Date(ts); return isNaN(t) ? String(ts) : `${fF(t.toISOString())} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` }
const nl = s => esc(s).replace(/\n/g, '<br/>')
const pct = v => v == null ? '—' : `${Math.round(v)}%`

const CSS = `
  :root { --ink:#1a1a2e; --ink2:#16213e; --muted:#5f6368; --line:#d9dbe1; --soft:#f5f6f8; --acc:#3b5bdb; --ok:#1E8E3E; --warn:#B8860B; --bad:#C5221F; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#e9eaee; color:#1c1c1e; font: 11.5pt/1.5 -apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Segoe UI, Roboto, Carlito, Calibri, Arial, sans-serif; }
  .bar { position: sticky; top:0; z-index:9; display:flex; gap:10px; align-items:center; padding:10px 18px; background:#fff; border-bottom:1px solid var(--line); font-size:10.5pt; }
  .bar b { color: var(--ink); }
  .bar button { padding:8px 14px; border-radius:8px; border:1px solid var(--line); background:#fff; cursor:pointer; font-weight:600; font-size:10.5pt; }
  .bar button.pri { background: var(--acc); color:#fff; border-color: var(--acc); }
  .bar .sp { flex:1; }
  .hoja { width: 210mm; min-height: 297mm; margin: 18px auto; background:#fff; box-shadow: 0 6px 30px rgba(0,0,0,.12); padding: 0 0 18mm; }
  .cab { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color:#fff; padding: 14mm 16mm 10mm; }
  .cab .emp { font-size: 9.5pt; letter-spacing: 1.6px; text-transform: uppercase; opacity:.8; }
  .cab h1 { margin: 6px 0 2px; font-size: 20pt; font-weight: 800; letter-spacing: -.2px; }
  .cab .sub { font-size: 11pt; opacity:.9; }
  .cab .cod { margin-top: 10px; display:inline-block; padding: 3px 10px; border: 1px solid rgba(255,255,255,.35); border-radius: 6px; font-size: 9.5pt; letter-spacing:.6px; }
  .cuerpo { padding: 8mm 16mm 0; }
  table.meta { width:100%; border-collapse: collapse; margin: 0 0 6mm; font-size: 10pt; }
  table.meta td { padding: 4px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  table.meta td:first-child { width: 34%; color: var(--muted); font-weight: 600; }
  h2 { font-size: 13pt; margin: 8mm 0 3mm; padding-bottom: 3px; border-bottom: 2px solid var(--ink); color: var(--ink); break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 5mm 0 2mm; color: var(--ink2); break-after: avoid; }
  p { margin: 2mm 0; }
  .muted { color: var(--muted); }
  .small { font-size: 9.5pt; }
  table.t { width:100%; border-collapse: collapse; font-size: 9.5pt; margin: 2mm 0 4mm; break-inside: auto; }
  table.t th { background: var(--ink); color:#fff; text-align:left; padding: 5px 7px; font-weight: 700; font-size: 8.8pt; letter-spacing:.3px; text-transform: uppercase; }
  table.t td { padding: 5px 7px; border-bottom: 1px solid var(--line); vertical-align: top; }
  table.t tr { break-inside: avoid; }
  table.t td.num, table.t th.num { width: 34px; text-align:center; color:#fff; }
  table.t td.num { color: var(--muted); font-weight: 700; }
  .chip { display:inline-block; padding: 1px 8px; border-radius: 10px; font-size: 8.8pt; font-weight: 700; }
  .ok { background:#E6F4EA; color:#1E8E3E; } .warn { background:#FFF4CC; color:#8a6500; } .bad { background:#FCE8E6; color:#C5221F; } .gris { background:#F1F1F3; color:#5f6368; } .info { background:#E8F0FE; color:#1a56db; }
  .kpis { display:flex; flex-wrap: wrap; gap: 8px; margin: 3mm 0 4mm; }
  .kpi { flex: 1 1 calc(25% - 6px); min-width: 118px; border:1px solid var(--line); border-radius: 8px; padding: 8px 10px; break-inside: avoid; }
  .kpi .l { font-size: 8.5pt; color: var(--muted); text-transform: uppercase; letter-spacing:.4px; font-weight: 700; }
  .kpi .v { font-size: 18pt; font-weight: 800; color: var(--ink); line-height: 1.15; margin-top: 2px; }
  .kpi .s { font-size: 8.8pt; color: var(--muted); }
  .caja { border:1px solid var(--line); border-left: 4px solid var(--acc); border-radius: 8px; padding: 8px 12px; margin: 3mm 0; background: var(--soft); break-inside: avoid; }
  .caja.bad { border-left-color: var(--bad); background:#fff7f7; } .caja.ok { border-left-color: var(--ok); background:#f5fbf6; } .caja.warn { border-left-color: var(--warn); background:#fffbef; }
  .sem { display:inline-block; width: 9px; height: 9px; border-radius: 5px; margin-right: 5px; vertical-align: middle; }
  .barra { height: 7px; background: #eceef2; border-radius: 4px; overflow: hidden; }
  .barra > div { height: 100%; background: var(--acc); }
  .firmas { display:grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 14mm; break-inside: avoid; }
  .firma { border-top: 1px solid #333; padding-top: 6px; font-size: 9.5pt; text-align:center; }
  .firma b { display:block; font-size: 10.5pt; }
  .pie { margin: 10mm 16mm 0; padding-top: 4mm; border-top: 1px solid var(--line); font-size: 8.8pt; color: var(--muted); display:flex; justify-content: space-between; gap: 12px; }
  .salto { break-before: page; }
  ul.lista { margin: 2mm 0 2mm 18px; padding: 0; } ul.lista li { margin: 1.2mm 0; }
  @page { size: A4; margin: 12mm 12mm 14mm; }
  @media print {
    html, body { background:#fff; }
    .bar { display:none; }
    .hoja { width:auto; min-height:0; margin:0; box-shadow:none; padding-bottom: 0; }
    .cab { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    table.t th, .chip, .kpi, .caja, .sem, .barra { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`

/** Envoltorio común: encabezado corporativo, metadatos, cuerpo y pie. */
export function docShell({ titulo, subtitulo, codigo, meta = [], cuerpo, pie, empresa = 'Outlet de Puertas SpA', nombreArchivo }) {
  const metaHtml = meta.length
    ? `<table class="meta">${meta.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>` : ''
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<title>${esc(nombreArchivo || titulo)}</title><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>${CSS}</style></head><body>
<div class="bar"><b>${esc(titulo)}</b><span class="muted">· Vista previa. Para PDF: Imprimir → Guardar como PDF.</span><span class="sp"></span>
<button class="pri" onclick="window.print()">🖨 Imprimir / Guardar PDF</button><button onclick="window.close()">Cerrar</button></div>
<div class="hoja">
  <div class="cab"><div class="emp">${esc(empresa)} · Módulo Procesos · Gobierno por información</div>
    <h1>${esc(titulo)}</h1>${subtitulo ? `<div class="sub">${esc(subtitulo)}</div>` : ''}${codigo ? `<div class="cod">${esc(codigo)}</div>` : ''}</div>
  <div class="cuerpo">${metaHtml}${cuerpo}</div>
  <div class="pie"><span>${pie || ''}</span><span>Generado desde el ERP Outlet · ${fFH(new Date().toISOString())}</span></div>
</div></body></html>`
}

/** Abre el documento en una pestaña nueva. Devuelve false si el navegador lo bloqueó. */
export function abrirDocumento(html) {
  try {
    const w = window.open('', '_blank')
    if (!w) return false
    w.document.open(); w.document.write(html); w.document.close(); w.focus()
    return true
  } catch { return false }
}

const chipSem = k => { const s = semDe(k); return `<span class="chip" style="background:${s.bg};color:${s.c}">${esc(s.l)}</span>` }
const chipEstado = e => {
  const m = { ABIERTO: 'warn', EN_CURSO: 'info', CERRADO: 'ok', ANULADO: 'gris', APROBADA: 'ok', RECHAZADA: 'bad', POSTERGADA: 'warn', PRESENTE: 'ok', AUSENTE: 'bad', JUSTIFICADO: 'warn', CONVOCADO: 'gris', TRATADO: 'ok', PENDIENTE: 'gris', POSTERGADO: 'warn' }
  return `<span class="chip ${m[e] || 'gris'}">${esc(String(e || '—').toLowerCase().replace(/_/g, ' '))}</span>`
}
const ROL_L = { PRESIDE: 'Preside', SECRETARIO: 'Secretario/a de acta', PARTICIPANTE: 'Participante', INVITADO: 'Invitado/a (sin voto)' }
const TIPO_DEC = { APROBACION_SOP: 'Aprobación de SOP', RECHAZO_SOP: 'Rechazo de SOP', ASIGNACION_PROCESO: 'Asignación de proceso', REASIGNACION: 'Reasignación', CONTRAMEDIDA: 'Contramedida', CAMBIO_META: 'Cambio de meta', RECURSOS: 'Recursos', ESCALAMIENTO: 'Escalamiento', OTRA: 'Otra' }

/* ══════════════════════════════════════════════════════════════════════════
   ACTA DE SESIÓN
   ══════════════════════════════════════════════════════════════════════════ */
export function actaHTML({ sesion: s, comite: c, asistentes = [], ordenDia = [], decisiones = [], acuerdos = [], acuerdosAnteriores = [], proximaSesion, nombresProceso = {} }) {
  const cod = `ACTA-${s.comite_codigo}-${String(s.numero ?? 0).padStart(3, '0')}`
  const votantes = asistentes.filter(a => a.rol_sesion !== 'INVITADO')
  const pres = votantes.filter(a => a.estado === 'PRESENTE').length
  const qmin = Math.round(Number(c?.quorum_min ?? 0.75) * 100)
  const qok = !!s.quorum_ok
  const dur = s.duracion_min
  const hA = horasActa(s), hC = horasAnticipacion(s)
  const meta = [
    ['Comité', `<b>${esc(c?.nombre || s.comite_nombre || s.comite_codigo)}</b> · ${esc((s.tipo || 'ORDINARIA').toLowerCase().replace('_', ' '))}${c?.reporta_a ? ` · reporta a ${esc(c.reporta_a)}` : ''}`],
    ['Sesión', `N° ${s.numero ?? '—'} · ${fF(s.fecha)}${s.hora_inicio ? ` · ${esc(s.hora_inicio)}${s.hora_fin ? '–' + esc(s.hora_fin) : ''}` : ''}${dur != null ? ` (${dur} min)` : ''}${s.lugar ? ` · ${esc(s.lugar)}` : ''}`],
    ['Preside / Secretaría', `${esc(asistentes.find(a => a.rol_sesion === 'PRESIDE')?.nombre || c?.responsable || '—')} / ${esc(asistentes.find(a => a.rol_sesion === 'SECRETARIO')?.nombre || c?.secretario || '—')}`],
    ['Quórum', `${pres} de ${votantes.length} votantes presentes (${votantes.length ? Math.round(100 * pres / votantes.length) : 0}% · regla ${qmin}%, mínimo ${c?.integrantes_min ?? 3}) — ${qok ? '<span class="chip ok">sesión válida</span>' : '<span class="chip bad">sin quórum: sesión informativa</span>'}`],
    ['Convocatoria', hC == null ? '<span class="muted">sin registro de envío</span>' : `enviada ${hC} h antes ${hC >= 48 ? '<span class="chip ok">cumple 48 h</span>' : '<span class="chip warn">bajo 48 h</span>'}`],
    ['Estado del acta', `${esc(s.acta_estado || 'SIN_ACTA')}${s.acta_emitida_at ? ` · emitida ${fFH(s.acta_emitida_at)}${hA != null ? (hA <= 24 ? ' <span class="chip ok">dentro de 24 h</span>' : ` <span class="chip warn">${hA} h después</span>`) : ''}` : ''}${s.acta_aprobada_por ? ` · aprobada por ${esc(s.acta_aprobada_por)} ${fFH(s.acta_aprobada_at)}` : ''}`]
  ]
  if (s.tema) meta.splice(2, 0, ['Tema', esc(s.tema)])

  const asisT = asistentes.length ? `<table class="t"><tr><th class="num">N°</th><th>Nombre</th><th>Cargo</th><th>Rol en la sesión</th><th>Asistencia</th></tr>
    ${asistentes.map((a, i) => `<tr><td class="num">${i + 1}</td><td><b>${esc(a.nombre)}</b></td><td>${esc(a.cargo || '—')}</td><td>${esc(ROL_L[a.rol_sesion] || a.rol_sesion)}</td><td>${chipEstado(a.estado)}</td></tr>`).join('')}</table>`
    : '<p class="muted">Sin convocados registrados.</p>'

  const odT = ordenDia.length ? `<table class="t"><tr><th class="num">N°</th><th>Punto</th><th style="width:44%">Desarrollo / resultado</th><th>Estado</th></tr>
    ${ordenDia.map(o => `<tr><td class="num">${o.orden}</td><td><b>${esc(o.titulo)}</b>${o.expositor ? `<div class="small muted">Expone: ${esc(o.expositor)}</div>` : ''}${o.minutos ? `<div class="small muted">${o.minutos} min</div>` : ''}</td><td>${o.resultado ? nl(o.resultado) : '<span class="muted">—</span>'}</td><td>${chipEstado(o.estado)}</td></tr>`).join('')}</table>`
    : '<p class="muted">Sin orden del día registrado.</p>'

  const decT = decisiones.length ? `<table class="t"><tr><th class="num">N°</th><th>Tipo</th><th style="width:40%">Decisión</th><th>Fundamento</th><th>Votación</th><th>Resultado</th></tr>
    ${decisiones.map((d, i) => `<tr><td class="num">D${i + 1}</td><td>${esc(TIPO_DEC[d.tipo] || d.tipo)}${d.proceso_id ? `<div class="small muted">${esc(d.proceso_id)} ${esc(nombresProceso[d.proceso_id] || '')}</div>` : ''}</td><td>${nl(d.decision)}</td><td class="small">${nl(d.fundamento || '—')}</td><td class="small">${d.unanime ? 'Unánime' : `${d.votos_favor ?? 0} a favor · ${d.votos_contra ?? 0} en contra · ${d.abstenciones ?? 0} abst.`}</td><td>${chipEstado(d.resultado)}</td></tr>`).join('')}</table>`
    : `<p class="muted">${qok ? 'Sin decisiones formales en esta sesión.' : 'La sesión no alcanzó el quórum: no se registran decisiones (principio 4).'}</p>`

  const acuT = acuerdos.length ? `<table class="t"><tr><th class="num">N°</th><th style="width:36%">Acuerdo</th><th>Responsable</th><th>Plazo</th><th>Criterio de cierre</th><th>Estado</th></tr>
    ${acuerdos.map((a, i) => `<tr><td class="num">A${i + 1}</td><td>${nl(a.acuerdo)}${a.kpi_indicador ? `<div class="small muted">Contramedida sobre: ${esc(a.kpi_indicador)}</div>` : ''}${a.proceso_id ? `<div class="small muted">${esc(a.proceso_id)} ${esc(nombresProceso[a.proceso_id] || '')}</div>` : ''}</td><td>${esc(a.responsable || '—')}</td><td>${fF(a.fecha_compromiso)}</td><td class="small">${nl(a.criterio_cierre || '—')}</td><td>${chipEstado(a.estado)}</td></tr>`).join('')}</table>`
    : '<p class="muted"><b>Sin acuerdos registrados.</b> Regla crítica de P21: un comité sin acuerdos registrados no se realizó.</p>'

  const antT = acuerdosAnteriores.length ? `<table class="t"><tr><th style="width:40%">Acuerdo anterior</th><th>Responsable</th><th>Plazo</th><th>Sesión</th><th>Estado al cierre</th></tr>
    ${acuerdosAnteriores.map(a => `<tr><td>${nl(a.acuerdo)}</td><td>${esc(a.responsable || '—')}</td><td>${fF(a.fecha_compromiso)}${a.vencido ? ' <span class="chip bad">vencido</span>' : ''}</td><td class="small">${a.sesion_numero ? 'N° ' + a.sesion_numero : fF(a.fecha_sesion)}</td><td>${chipEstado(a.estado)}${a.escalado_a ? ` <span class="chip warn">escalado a ${esc(a.escalado_a)}</span>` : ''}</td></tr>`).join('')}</table>`
    : '<p class="muted">Sin acuerdos anteriores abiertos al momento de la sesión.</p>'

  const cuerpo = `
    <h2>1. Asistencia y quórum</h2>${asisT}
    <h2>2. Orden del día y desarrollo</h2>${odT}
    <h2>3. Revisión de acuerdos anteriores</h2>${antT}
    <h2>4. Decisiones</h2>${decT}
    <h2>5. Acuerdos de esta sesión</h2>${acuT}
    ${s.acta_resumen ? `<h2>6. Observaciones</h2><p>${nl(s.acta_resumen)}</p>` : ''}
    <h2>${s.acta_resumen ? 7 : 6}. Próxima sesión</h2>
    <p>${proximaSesion ? `${fF(proximaSesion.fecha)}${proximaSesion.hora_inicio ? ' · ' + esc(proximaSesion.hora_inicio) : ''}${proximaSesion.lugar ? ' · ' + esc(proximaSesion.lugar) : ''}${proximaSesion.tema ? ' · ' + esc(proximaSesion.tema) : ''}` : '<span class="muted">Por agendar según la periodicidad del comité.</span>'}</p>
    <div class="firmas">
      <div class="firma"><b>${esc(asistentes.find(a => a.rol_sesion === 'PRESIDE')?.nombre || c?.responsable || '')}</b>Preside</div>
      <div class="firma"><b>${esc(asistentes.find(a => a.rol_sesion === 'SECRETARIO')?.nombre || c?.secretario || '')}</b>Secretario/a de acta</div>
    </div>`
  return docShell({
    titulo: `Acta de sesión N° ${s.numero ?? '—'}`, subtitulo: c?.nombre || s.comite_nombre || s.comite_codigo, codigo: cod, meta, cuerpo,
    pie: `${cod} · Estado ${s.acta_estado || 'SIN_ACTA'} · Documento controlado por SOP P21`, nombreArchivo: cod
  })
}

/* ══════════════════════════════════════════════════════════════════════════
   INFORME DE AVANCE — programa de procesos y gobierno por información
   d = datosInforme(...)  (ver prcInforme.js) o un snapshot con la misma forma
   ══════════════════════════════════════════════════════════════════════════ */
export function informeHTML(d) {
  const m = d.matriz || {}
  const semG = { verde: ['ok', 'En curso según plan'], ambar: ['warn', 'Con atrasos que requieren decisión'], rojo: ['bad', 'En riesgo'] }[d.resumen?.semaforo || 'ambar']
  const kpi = (l, v, s) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${v}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`
  const barra = (v, color) => `<div class="barra"><div style="width:${Math.max(0, Math.min(100, v || 0))}%;background:${color || 'var(--acc)'}"></div></div>`

  const cuerpo = []
  cuerpo.push(`<h2>1. Resumen ejecutivo</h2>
    <div class="caja ${semG[0]}"><b>Estado general: ${semG[1]}.</b> ${esc(d.resumen?.frase || '')}</div>
    <ul class="lista">${(d.resumen?.mensajes || []).map(x => `<li>${nl(x)}</li>`).join('')}</ul>`)

  cuerpo.push(`<h2>2. Estado de la matriz de procesos</h2>
    <div class="kpis">
      ${kpi('Procesos mapeados', m.total ?? '—', `${m.score9 ?? 0} con score 9 (máxima prioridad)`)}
      ${kpi('Avance ponderado', pct(m.avancePonderado), `Simple ${pct(m.avanceSimple)} · pesa cada proceso por su score`)}
      ${kpi('Implementados', `${m.implementados ?? 0}/${m.total ?? 0}`, 'Cumplen los 4 criterios')}
      ${kpi('En riesgo', m.enRiesgo ?? 0, 'Score ≥ 6, pendiente y > 30 días de atraso')}
      ${kpi('SOP vigentes', `${m.conSopVigente ?? 0}/${m.total ?? 0}`, `${m.sopBorradorCompleto ?? 0} borradores completos en revisión`)}
      ${kpi('Flujogramas vigentes', `${m.conFlujograma ?? 0}/${m.total ?? 0}`, 'Aprobados y firmados')}
      ${kpi('Con capacitación', `${m.conCapacitacion ?? 0}/${m.total ?? 0}`, 'Evidencia registrada')}
      ${kpi('Sin dueño real', m.sinDueno ?? 0, 'Cargo vacante o por contratar')}
    </div>
    <h3>Avance por onda de implementación</h3>
    <table class="t"><tr><th>Onda</th><th>Ventana</th><th class="num">N°</th><th style="width:34%">Avance</th><th>Estado</th></tr>
    ${(d.ondas || []).map(o => `<tr><td><b>${esc(o.nombre)}</b></td><td>${esc(o.ventana || '—')}</td><td class="num">${o.n}</td><td>${barra(o.avance, o.vencida ? 'var(--bad)' : 'var(--acc)')}<div class="small muted">${pct(o.avance)}</div></td><td>${o.vencida ? '<span class="chip bad">ventana vencida</span> ' : ''}${o.rojo ? `<span class="chip bad">${o.rojo} en riesgo</span>` : '<span class="chip ok">sin rojos</span>'}</td></tr>`).join('')}</table>
    <h3>Avance por dirección responsable</h3>
    <table class="t"><tr><th>Dirección</th><th class="num">N°</th><th class="num">Impl.</th><th class="num">Rojos</th><th style="width:34%">Avance</th></tr>
    ${(d.direcciones || []).map(x => `<tr><td><b>${esc(x.etiqueta)}</b></td><td class="num">${x.n}</td><td class="num">${x.impl}</td><td class="num">${x.rojo}</td><td>${barra(x.avance)}<div class="small muted">${pct(x.avance)}</div></td></tr>`).join('')}</table>`)

  if (d.entregasPeriodo?.length) {
    cuerpo.push(`<h2>3. Lo construido en el período</h2><ul class="lista">${d.entregasPeriodo.map(x => `<li>${nl(x)}</li>`).join('')}</ul>`)
  }
  const g = d.gobierno || {}
  cuerpo.push(`<h2>${d.entregasPeriodo?.length ? 4 : 3}. Gobierno por información: comités</h2>
    <p class="small muted">Período de evaluación: ${esc(d.periodo || '—')}. Metas de P21: quórum ≥ 90% · asistencia ≥ 85% · acuerdos a plazo ≥ 80% · actas ≤ 24 h 100% · efectividad de la intervención ≥ 60%.</p>
    <div class="kpis">
      ${kpi('Sesiones realizadas', `${g.realizadas ?? 0}/${g.sesionesPlan ?? 0}`, `${g.sinQuorum ?? 0} sin quórum · ${g.pendientesCierre ?? 0} por cerrar`)}
      ${kpi('Asistencia promedio', pct(g.asistencia), 'Presentes sobre convocados')}
      ${kpi('Acuerdos a plazo', pct(g.pctAcuerdosPlazo), `${g.acuerdos ?? 0} acuerdos · ${g.vencidos ?? 0} vencidos abiertos`)}
      ${kpi('Decisiones registradas', g.decisiones ?? 0, `${g.actasSin ?? 0} sesiones realizadas sin acta`)}
    </div>
    ${(g.comites || []).length ? `<table class="t"><tr><th>Comité</th><th class="num">Ses.</th><th>Quórum</th><th>Asist.</th><th>Acuerdos a plazo</th><th>Vencidos</th><th>Actas ≤24h</th><th>Rojos</th><th>Efectividad</th></tr>
      ${g.comites.map(c => `<tr><td><b>${esc(c.nombre)}</b><div class="small muted">${esc(c.periodicidad || '')}${c.proximas ? ` · ${c.proximas} agendadas` : ' · <span style="color:var(--bad)">sin sesiones agendadas</span>'}</div></td><td class="num">${c.realizadas}/${c.sesionesPlan}</td><td>${pct(c.pctQuorum)}</td><td>${pct(c.asistencia)}</td><td>${pct(c.pctAcuerdosPlazo)}</td><td>${c.vencidos}</td><td>${pct(c.pctActas)}</td><td>${c.rojos}</td><td>${c.efectividad?.pct == null ? '<span class="muted">s/e</span>' : pct(c.efectividad.pct)}</td></tr>`).join('')}</table>` : '<p class="muted">Sin sesiones registradas en el período.</p>'}`)

  const sc = d.scorecard || {}
  const n0 = d.entregasPeriodo?.length ? 5 : 4
  cuerpo.push(`<h2>${n0}. Scorecard de indicadores y efectividad de la intervención</h2>
    <div class="kpis">
      ${kpi('Indicadores', sc.total ?? 0, `${sc.ancla ?? 0} ancla`)}
      ${kpi('Semáforo', `<span class="sem" style="background:${SEM.VERDE.c}"></span>${sc.verdes ?? 0} <span class="sem" style="background:${SEM.AMARILLO.c}"></span>${sc.amarillos ?? 0} <span class="sem" style="background:${SEM.ROJO.c}"></span>${sc.rojos ?? 0}`, `${sc.sinDato ?? 0} sin dato o sin meta`)}
      ${kpi('Cobertura de contramedidas', pct(sc.cobertura?.pct), `${sc.cobertura?.con ?? 0} de ${sc.cobertura?.total ?? 0} rojos con contramedida`)}
      ${kpi('Efectividad de la intervención', sc.efectividad?.pct == null ? 's/e' : pct(sc.efectividad.pct), `${sc.efectividad?.efectivas ?? 0} efectivas · ${sc.efectividad?.noEfectivas ?? 0} no · ${sc.efectividad?.pendientes ?? 0} pendientes`)}
    </div>
    <p class="small muted">Efectividad de la intervención = indicadores en rojo con contramedida acordada que salen del rojo dentro de los 2 períodos siguientes. Es el KPI de fondo del comité: mide si reunirse cambia los resultados, no solo si se cumplen las formas.</p>
    ${(sc.rojosSinContramedida || []).length ? `<div class="caja bad"><b>${sc.rojosSinContramedida.length} indicador(es) en rojo sin contramedida:</b> ${sc.rojosSinContramedida.map(k => `${esc(k.indicador)} (${esc(k.proceso_id)})`).join(' · ')}</div>` : ''}
    ${(sc.tabla || []).length ? `<table class="t"><tr><th>Indicador</th><th>Proceso</th><th>Comité</th><th>Último</th><th>Meta</th><th>Semáforo</th><th>Tend.</th><th>Contramedida</th></tr>
      ${sc.tabla.map(k => `<tr><td>${k.es_kpi_ancla ? '⚓ ' : ''}<b>${esc(k.indicador)}</b></td><td class="small">${esc(k.proceso_id)} ${esc(k.proceso_nombre || '')}</td><td class="small">${esc(k.comite_codigo || '—')}</td><td>${k.ult_valor ?? k.ult_valor_texto ?? '—'}${k.ult_periodo ? `<div class="small muted">${esc(k.ult_periodo)}</div>` : ''}</td><td>${k.meta_valor ?? esc(k.meta || '—')} ${k.sentido === 'MENOR_MEJOR' ? '↓' : '↑'}</td><td>${chipSem(k.semaforo)}</td><td>${k.tendencia === 'MEJORA' ? '▲' : k.tendencia === 'EMPEORA' ? '▼' : k.tendencia === 'IGUAL' ? '=' : '—'}</td><td>${k.contramedida_abierta ? '<span class="chip ok">abierta</span>' : k.semaforo === 'ROJO' ? '<span class="chip bad">falta</span>' : '—'}</td></tr>`).join('')}</table>` : ''}`)

  cuerpo.push(`<h2>${n0 + 1}. Comités de trabajo por proceso (P37)</h2>
    ${(d.encargos || []).length ? `<table class="t"><tr><th>Proceso</th><th>Líder</th><th>Fase actual</th><th style="width:22%">Avance 7 fases</th><th>Plazo</th><th>Estado</th></tr>
      ${d.encargos.map(e => `<tr><td><b>${esc(e.proceso_id)}</b> ${esc(e.proceso_nombre || '')}</td><td>${esc(e.lider)}</td><td>${e.fase_actual}. ${esc(e.fase_actual_nombre || '')}</td><td>${barra(100 * (e.fases_completadas || 0) / 7)}<div class="small muted">${e.fases_completadas || 0}/7 fases</div></td><td>${fF(e.fecha_limite)}<div class="small ${e.vencido ? '' : 'muted'}" style="${e.vencido ? 'color:var(--bad);font-weight:700' : ''}">${e.vencido ? `vencido hace ${Math.abs(e.dias_restantes)} d` : `${e.dias_restantes} días`}</div></td><td>${chipEstado(e.estado)}</td></tr>`).join('')}</table>`
      : '<p class="muted">Todavía no hay procesos encargados a comités de trabajo. La asignación se hace en la sala de sesión del comité de gobierno (P21, fase 1) o en la vista Comités de trabajo.</p>'}
    ${d.encargosNota ? `<p class="small muted">${nl(d.encargosNota)}</p>` : ''}`)

  cuerpo.push(`<h2>${n0 + 2}. Riesgos y alertas</h2>
    ${(d.riesgos || []).length ? `<table class="t"><tr><th>Proceso</th><th>Alerta</th><th>Severidad</th></tr>
      ${d.riesgos.map(r => `<tr><td><b>${esc(r.proceso_id)}</b> ${esc(r.nombre || '')}</td><td>${esc(r.mensaje)}</td><td><span class="chip ${r.severidad === 'alta' ? 'bad' : 'warn'}">${esc(r.severidad)}</span></td></tr>`).join('')}</table>` : '<p class="muted">Sin alertas activas.</p>'}
    ${(d.riesgosNarrativa || []).length ? `<ul class="lista">${d.riesgosNarrativa.map(x => `<li>${nl(x)}</li>`).join('')}</ul>` : ''}`)

  cuerpo.push(`<h2>${n0 + 3}. Decisiones requeridas y próximos pasos</h2>
    <h3>Decisiones que se piden a ${esc(d.para || 'la dirección')}</h3>
    ${(d.decisionesRequeridas || []).length ? `<ol class="lista">${d.decisionesRequeridas.map(x => `<li>${nl(x)}</li>`).join('')}</ol>` : '<p class="muted">Sin decisiones pendientes.</p>'}
    <h3>Próximos pasos (30 días)</h3>
    ${(d.proximosPasos || []).length ? `<ol class="lista">${d.proximosPasos.map(x => `<li>${nl(x)}</li>`).join('')}</ol>` : '<p class="muted">—</p>'}`)

  if (d.hitos?.length) {
    cuerpo.push(`<h2>${n0 + 4}. Hitos del período</h2><table class="t"><tr><th>Fecha</th><th>Proceso</th><th>Tipo</th><th>Hito</th></tr>
      ${d.hitos.map(h => `<tr><td>${fF(h.fecha)}</td><td><b>${esc(h.proceso_id)}</b></td><td class="small">${esc(String(h.tipo || '').toLowerCase())}</td><td>${nl(h.descripcion)}</td></tr>`).join('')}</table>`)
  }
  if (d.anexoProcesos?.length) {
    cuerpo.push(`<h2 class="salto">Anexo A. Estado de cada proceso</h2>
      <table class="t"><tr><th class="num">ID</th><th>Proceso</th><th>Dirección</th><th>Onda</th><th class="num">Score</th><th>Estado</th><th>Avance</th><th>Dueño</th></tr>
      ${d.anexoProcesos.map(p => `<tr><td class="num">${esc(p.id)}</td><td><b>${esc(p.nombre)}</b></td><td class="small">${esc(p.direccion || '—')}</td><td class="small">${esc(p.onda || '—')}</td><td class="num">${p.score ?? '—'}</td><td class="small">${esc(p.estado || '—')}${p.semaforo === 'rojo' ? ' <span class="chip bad">riesgo</span>' : ''}</td><td>${pct(p.pct_global)}</td><td class="small">${esc(p.dueno || '—')}</td></tr>`).join('')}</table>`)
  }

  const meta = [
    ['Documento', `Informe de avance N° ${esc(d.numero ?? '—')} · ${esc(d.periodo || '')}`],
    ['Fecha de corte', fF(d.fechaCorte)],
    ['Preparado por', esc(d.preparadoPor || 'Dirección General')],
    ['Dirigido a', esc(d.para || 'Directorio y Comité de Dirección')],
    ['Fuente', esc(d.fuente || 'Módulo Procesos del ERP Outlet (matriz, SOP, comités, scorecard)')]
  ]
  return docShell({
    titulo: 'Informe de avance', subtitulo: 'Programa de procesos y gobierno por información', codigo: `INF-PRC-${String(d.numero ?? 1).padStart(3, '0')} · corte ${fF(d.fechaCorte)}`,
    meta, cuerpo: cuerpo.join('\n'), pie: `Informe de avance N° ${d.numero ?? 1} · P21 fase 7 · Reporte al Directorio`, nombreArchivo: `Informe_avance_procesos_${String(d.fechaCorte || '').slice(0, 10)}`
  })
}
