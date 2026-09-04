// src/procesos/prcInformeProceso.jsx
// Informe de un proceso (dossier): estado y avance, contenido completo del SOP,
// indicadores, gobierno (versiones, firmas, comité de trabajo, acuerdos,
// decisiones, capacitaciones), bitácora y el flujograma como Anexo A en páginas
// horizontales: A.0 mapa del proceso (cadena de fases, quién hace qué, decisiones)
// y una página por fase con su diagrama swimlane, el detalle de cada paso y los
// retornos. Se abre en una pestaña nueva para imprimir o guardar como PDF, con el
// mismo look que el acta y el informe de avance.

import { supabase } from '../supabase'
import { docShell, abrirDocumento, esc, fF } from './prcDoc'
import { desgloseAvance, PESOS_AVANCE, etapas } from './PrcGuia'
import { flujoSVG, modeloFlujo, colorFase } from './prcFlujo'
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
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`

/* ══════════════════════════════════════════════════════════════════════════
   ANEXO A · flujograma por páginas
   ══════════════════════════════════════════════════════════════════════════ */

// Medidas de impresión: más apretadas que las de pantalla para que una fase de
// hasta 5 pasos quepa legible en una hoja A4 horizontal.
const COMPACTO = { PAD: 12, LANE_W: 150, COL_W: 218, BOX_W: 186, ROW_H: 112, BOX_H: 80, TERM_W: 92, PHASE_H: 42, PISTA: 22 }
const MAX_TRAMO = 5

/** Reparte los pasos de una fase larga en partes de a lo más MAX_TRAMO, lo más parejas posible.
 *  Una fase de 5 pasos con 4 o más carriles también se parte: entera quedaría ilegible en la hoja. */
function partir(arr, max = MAX_TRAMO) {
  const carriles = new Set(arr.map(x => (x.responsable || 'Sin asignar').trim())).size
  if (arr.length <= max && !(arr.length >= 5 && carriles >= 4)) return [arr]
  const k = Math.max(2, Math.ceil(arr.length / max)), size = Math.ceil(arr.length / k)
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const LEYENDA = `<div class="ley">
  <span><i style="background:#D5E8D4;border-color:#82B366;border-radius:8px"></i>Inicio / término</span>
  <span><i style="background:#F1F5F9;border-color:#475569;border-style:dashed"></i>Viene de / continúa en (otra página)</span>
  <span><i style="background:#fff;border-color:#B85450;border-width:2px"></i>Control crítico</span>
  <span><i style="background:#FFF2CC;border-color:#D6B656;transform:rotate(45deg);width:10px;height:10px"></i>Punto de decisión</span>
  <span><i style="background:#DAE8FC;border-color:#6C8EBF"></i>Paso con documento</span>
  <span><i style="border:0;border-top:2px dashed #D79B00;height:0;width:22px"></i>Retorno o salto de la decisión</span>
  <span><i style="background:#fff;border-color:#D79B00;font-size:7px;color:#D79B00;font-weight:800;text-align:center;line-height:9px;font-style:normal">1.1</i>Paso destino en otra página</span>
</div>`

/**
 * Arma el Anexo A. Devuelve { html, paginas, numero } donde numero es el mapa
 * pasoId → "fase.paso" que usan las otras secciones del informe.
 */
export function anexoFlujoHTML({ p, fs, pasos = [], errores = [], version, fecha }) {
  // pasos con numeración contigua por fase (la misma que muestran el SOP y el diagrama)
  const norm = []
  fs.forEach((f, fi) => pasos.filter(x => x.fase_id === f.id).sort((a, b) => (a.orden || 0) - (b.orden || 0))
    .forEach((x, i) => norm.push({ ...x, orden: i + 1, _fi: fi, _num: `${fi + 1}.${i + 1}` })))
  const numero = new Map(norm.map(x => [x.id, x._num]))
  const m = modeloFlujo(fs, norm)
  if (!m.cols.length) return { html: '', paginas: 0, numero, norm }

  const byId = new Map(norm.map(x => [x.id, x]))
  const info = id => { const x = byId.get(id); return x ? { num: x._num, texto: x.accion, fase: `Fase ${x._fi + 1}`, fi: x._fi } : null }
  const resolver = (destId, origenId) => { const i = info(destId); return i ? { ...i, atras: m.idx.get(destId) < m.idx.get(origenId) } : null }
  const pasosFase = f => norm.filter(x => x.fase_id === f.id)
  const siguienteDe = x => { const i = m.idx.get(x.id); return i != null && i + 1 < m.cols.length ? m.cols[i + 1].paso : null }
  // ¿el flujo sigue derecho al paso siguiente? (misma regla que el motor: una decisión
  // sigue derecho si alguna de sus ramas no tiene destino propio)
  const sigueDerecho = x => !x.es_decision || !byId.has(x.rama_si_destino) || !byId.has(x.rama_no_destino)
  const cab = der => `<div class="anx-cab"><span><b>Anexo A</b> · Flujograma del proceso · ${esc(p.id)} ${esc(p.nombre)}</span><span>${der}</span></div>`
  const pie = `${esc(version)} · ${fecha}`
  const nombreCarril = x => (x.responsable || 'Sin asignar').trim()
  const carriles = [...new Set(norm.map(nombreCarril))]
  const participantes = [...new Set(norm.flatMap(x => (x.participantes || []).map(s => String(s).trim()).filter(Boolean)))].filter(s => !carriles.includes(s))
  const roles = [...carriles, ...participantes]

  /* ── A.0 · mapa del proceso ─────────────────────────────────────────────── */
  const cadena = fs.map((f, fi) => {
    const ps = pasosFase(f), col = colorFase(f, fi)
    const stat = ps.length
      ? `${plural(ps.length, 'paso', 'pasos')} · ${plural(ps.filter(x => x.es_decision).length, 'decisión', 'decisiones')} · ${plural(ps.filter(x => x.es_control_critico).length, 'control crítico', 'controles críticos')} · ${plural(ps.filter(x => x.documento).length, 'documento', 'documentos')}`
      : 'sin pasos definidos'
    return `<div class="fcard" style="border-top-color:${col.tono}">
      <div class="fnum" style="color:${col.tono}">${fi + 1}</div>
      <div class="fnom">${esc(f.nombre)}</div>
      <div class="fresp">${esc(f.responsable_principal || 'Sin responsable')}</div>
      <div class="fstat">${stat}</div>
      ${ps.length ? `<div class="fpag" style="color:${col.tono}">Página A.${fi + 1}</div>` : ''}
    </div>`
  }).join('<div class="flecha">›</div>')

  const filaRol = r => {
    const mios = norm.filter(x => nombreCarril(x) === r)
    const part = norm.filter(x => (x.participantes || []).map(s => String(s).trim()).includes(r) && nombreCarril(x) !== r)
    const celdas = fs.map((f, fi) => {
      const a = mios.filter(x => x.fase_id === f.id), b = part.filter(x => x.fase_id === f.id)
      if (!a.length && !b.length) return '<td class="c"></td>'
      const col = colorFase(f, fi)
      return `<td class="c" style="background:${col.bg}">${a.map(x => `<span class="n">${x._num}${x.es_decision ? '◆' : ''}${x.es_control_critico ? '<b class="cr">!</b>' : ''}</span>`).join(' ')}${b.length ? `<span class="p">participa en ${b.map(x => x._num).join(', ')}</span>` : ''}</td>`
    }).join('')
    return `<tr><td><b>${esc(r)}</b>${!mios.length ? '<div class="p">solo participa</div>' : ''}</td>${celdas}<td class="c tot">${mios.length}</td><td class="c tot">${mios.filter(x => x.es_decision).length}</td><td class="c tot">${mios.filter(x => x.es_control_critico).length}</td></tr>`
  }
  const matriz = `<table class="t mx">
    <tr><th style="width:22%">Responsable (carril)</th>${fs.map((f, fi) => `<th class="c" style="background:${colorFase(f, fi).tono}" title="${esc(f.nombre)}">Fase ${fi + 1}</th>`).join('')}<th class="c">Pasos</th><th class="c">Decide</th><th class="c">Controla</th></tr>
    ${roles.map(filaRol).join('')}
    <tr class="docs"><td><b>Documentos del flujo</b></td>${fs.map(f => `<td class="c">${pasosFase(f).filter(x => x.documento).map(x => `<span class="d">${esc(x.documento)} <span class="p">(${x._num})</span></span>`).join('') || ''}</td>`).join('')}<td class="c tot">${norm.filter(x => x.documento).length}</td><td></td><td></td></tr>
  </table>`

  const decs = norm.filter(x => x.es_decision)
  const corto = (t, n) => { const v = String(t || ''); return v.length > n ? v.slice(0, n - 1).replace(/[\s,.;:]+$/, '') + '…' : v }
  // breve = sin la acción del paso destino (tabla de la fase); completo en A.0
  const destino = (x, destId, txt, esSi, breve) => {
    const i = info(destId)
    const sig = siguienteDe(x)
    if (i) {
      const atras = m.idx.get(destId) < m.idx.get(x.id)
      const otraFase = i.fi !== x._fi
      return `${txt ? `${esc(txt)} ` : ''}<span class="dest ${atras ? 'atras' : 'salto'}">${atras ? '↩ vuelve a' : '↪ sigue en'} ${i.num}</span>${breve ? (otraFase ? ` <span class="muted">(${i.fase})</span>` : '') : ` <span class="muted">${esc(corto(i.texto, 38))} (${i.fase})</span>`}`
    }
    // sin destino propio: la rama SÍ sigue derecho; la NO solo si la SÍ se fue a otro paso
    // (misma regla que dibuja el motor); si no, queda descrita solo en el texto
    const siSigue = !byId.has(x.rama_si_destino) || m.idx.get(x.rama_si_destino) === m.idx.get(x.id) + 1
    const sigue = esSi ? siSigue : !siSigue
    if (sigue && sig) return `${txt ? `${esc(txt)} ` : ''}<span class="dest sig">→ continúa en ${sig._num}</span>${breve ? '' : ` <span class="muted">${esc(corto(sig.accion, 38))}</span>`}`
    if (sigue && !sig) return `${txt ? `${esc(txt)} ` : ''}<span class="dest sig">→ fin del proceso</span>`
    return `${txt ? `${esc(txt)} ` : ''}${breve ? '' : '<span class="muted">(sin destino en el flujo)</span>'}`
  }
  const lectura = x => {
    const ds = [x.rama_si_destino, x.rama_no_destino].filter(id => byId.has(id))
    if (!ds.length) return 'Bifurcación simple'
    const atras = ds.some(id => m.idx.get(id) < m.idx.get(x.id))
    const otraFase = ds.some(id => byId.get(id)._fi !== x._fi)
    return atras ? `Bucle de control${otraFase ? ' entre fases' : ''}` : `Salto adelante${otraFase ? ' a otra fase' : ''}`
  }
  const decisiones = decs.length ? `<table class="t dc">
    <tr><th class="num">N°</th><th style="width:19%">Pregunta / decisión</th><th style="width:11%">Responsable</th><th style="width:28%">Si la respuesta es SÍ</th><th style="width:28%">Si la respuesta es NO</th><th>Lectura</th></tr>
    ${decs.map(x => `<tr><td class="num">${x._num}</td><td><b>${esc(x.accion)}</b><div class="p">Fase ${x._fi + 1} · ${esc(fs[x._fi].nombre)}</div></td><td class="small">${esc(x.responsable || '—')}</td><td class="small">${destino(x, x.rama_si_destino, x.rama_si, true)}</td><td class="small">${destino(x, x.rama_no_destino, x.rama_no, false)}</td><td class="small">${lectura(x)}</td></tr>`).join('')}
  </table>` : '<p class="muted small">El flujo no tiene puntos de decisión: es una secuencia lineal.</p>'

  // estimación en mm de lo que ocupa A.0 (cabecera + cadena + matriz + leyenda): si las
  // decisiones no caben debajo, van en una página propia
  const altoBase = 96 + roles.length * 8.5
  const altoDec = decs.length ? 12 + decs.length * 12 : 0
  const decAparte = decs.length > 0 && altoBase + altoDec > 190
  const bloqueDec = `<div class="bloque"><h3 class="anx-h3">Decisiones y bifurcaciones</h3>${decisiones}</div>`
  const pag0 = `<div class="pag-flujo">
    ${cab(`Mapa del proceso · ${pie}`)}
    <div class="anx-tit">A.0 · Mapa del proceso</div>
    <p class="small muted anx-lead">Cómo leer: cada fase de la cadena tiene su página (A.1, A.2…) con el diagrama swimlane —un carril por responsable— y el detalle de sus pasos. La matriz dice quién ejecuta qué (◆ decide, <b class="cr">!</b> control crítico); la tabla de decisiones resume cada bifurcación y su destino (↩ = bucle de control: el proceso vuelve atrás para corregir).</p>
    <div class="cadena">${cadena}</div>
    <div class="bloque"><h3 class="anx-h3">Quién hace qué</h3>${matriz}</div>
    ${decAparte ? '' : bloqueDec}
    ${LEYENDA}
  </div>${decAparte ? `<div class="pag-flujo">
    ${cab(`Decisiones y bifurcaciones · ${pie}`)}
    <div class="anx-tit">A.0 · Decisiones y bifurcaciones</div>
    <p class="small muted anx-lead">Las ${decs.length} decisiones del proceso con sus dos salidas y el paso al que lleva cada una. ↩ vuelve a = bucle de control (el proceso retrocede para corregir); ↪ sigue en = salto hacia adelante; → continúa en = sigue al paso siguiente.</p>
    ${bloqueDec}
  </div>` : ''}`

  /* ── A.n · una página por fase ─────────────────────────────────────────── */
  const paginas = [pag0]
  fs.forEach((f, fi) => {
    const ps = pasosFase(f)
    if (!ps.length) return
    const col = colorFase(f, fi)
    const tramos = partir(ps)
    const errs = errores.filter(e => e.fase_id === f.id).sort((a, b) => (a.orden || 0) - (b.orden || 0))
    const apoyo = (f.responsables_apoyo || []).filter(Boolean)
    const stat = (n, l) => `<div class="st"><b>${n}</b><span>${l}</span></div>`
    tramos.forEach((t, k) => {
      const g0 = m.idx.get(t[0].id), g1 = m.idx.get(t[t.length - 1].id)
      const prev = g0 > 0 ? m.cols[g0 - 1].paso : null, next = g1 < m.cols.length - 1 ? m.cols[g1 + 1].paso : null
      const entrada = prev && sigueDerecho(prev) ? info(prev.id) : null
      const salida = next && sigueDerecho(t[t.length - 1]) ? info(next.id) : null
      const term = (g0 === 0 ? 'inicio' : '') + (g1 === m.cols.length - 1 ? 'fin' : '')
      const svg = flujoSVG(p, [f], t, {
        sinTitulo: true, sinLeyenda: true, dims: COMPACTO,
        terminadores: term === 'iniciofin' ? 'ambos' : (term || 'ninguno'),
        entrada, salida, numFase: () => fi + 1, resolver
      })
      const llegan = norm.filter(x => x.es_decision && !t.some(y => y.id === x.id) && [x.rama_si_destino, x.rama_no_destino].some(d => t.some(y => y.id === d)))
        .map(x => `${x._num} (${x.rama_si_destino && t.some(y => y.id === x.rama_si_destino) ? 'SÍ' : 'NO'}) → ${numero.get(t.some(y => y.id === x.rama_si_destino) ? x.rama_si_destino : x.rama_no_destino)}`)
      const hayDec = t.some(x => x.es_decision)
      // alto máximo del diagrama en mm: lo que deja libre la tabla en la hoja horizontal
      // (192 mm útiles − ~27 de cabeceras − márgenes). Las filas se estiman por líneas de texto.
      const lineas = (txt, ancho) => Math.max(1, Math.ceil(String(txt || '').length / ancho))
      const altoFila = x => {
        let n = Math.max(lineas(x.accion, hayDec ? 48 : 75), lineas(x.responsable, 24), lineas((x.participantes || []).join(', '), 18), lineas(x.sistema, 16), lineas(x.documento, 18), lineas(x.control_tiempo, 14))
        if (x.es_decision) n = Math.max(n, lineas((x.rama_si || 'SÍ') + '0000000000000000000000', 40) + lineas((x.rama_no || 'NO') + '0000000000000000000000', 40))
        return 3.5 + n * 3.7
      }
      const altoTabla = 7 + t.reduce((acc, x) => acc + altoFila(x), 0)
      const txtErr = k === tramos.length - 1 ? errs.map(e => `${e.error} ${e.prevencion || ''}`).join(' · ') : ''
      const altoErr = txtErr ? 4 + lineas(txtErr, 165) * 3.8 : 0
      const cap = Math.max(55, Math.min(120, Math.round(150 - altoTabla - altoErr - (llegan.length ? 5 : 0))))
      const salidas = x => `<div><b>SÍ:</b> ${destino(x, x.rama_si_destino, x.rama_si, true, true)}</div><div style="margin-top:2px"><b>NO:</b> ${destino(x, x.rama_no_destino, x.rama_no, false, true)}</div>`
      const tabla = `<table class="t tp">
        <tr><th class="num">N°</th><th style="width:${hayDec ? 25 : 40}%">Acción</th><th style="width:13%">Responsable</th><th style="width:${hayDec ? 10 : 12}%">Participan</th><th style="width:${hayDec ? 9 : 12}%">Sistema</th><th style="width:${hayDec ? 10 : 12}%">Documento</th><th style="width:${hayDec ? 8 : 9}%">Control / tiempo</th>${hayDec ? '<th style="width:21%">Salidas de la decisión</th>' : ''}</tr>
        ${t.map(x => {
          const doc = x.documento ? (x.documento_url ? `<a href="${esc(x.documento_url)}">${esc(x.documento)}</a>` : esc(x.documento)) : '—'
          return `<tr><td class="num">${x._num}${x.es_control_critico ? '<div class="cr">!</div>' : ''}${x.es_decision ? '<div class="dec">◆</div>' : ''}</td><td>${esc(x.accion)}</td><td>${esc(x.responsable || '—')}</td><td class="small">${(x.participantes || []).filter(Boolean).map(esc).join(', ') || '—'}</td><td class="small">${esc(x.sistema || '—')}</td><td class="small">${doc}</td><td class="small">${esc(x.control_tiempo || '—')}</td>${hayDec ? `<td class="small">${x.es_decision ? salidas(x) : '—'}</td>` : ''}</tr>`
        }).join('')}
      </table>`
      const nav = `<div class="fase-nav">
        <span>${entrada ? `◀ Viene de <b>${entrada.num}</b> ${esc(entrada.texto)} <i>(${entrada.fase})</i>` : prev ? `◀ Se llega desde las salidas de la decisión <b>${numero.get(prev.id)}</b>` : '● Inicio del proceso'}</span>
        <span>${salida ? `Continúa en <b>${salida.num}</b> ${esc(salida.texto)} <i>(${salida.fase})</i> ▶` : next ? `Las salidas de la decisión <b>${t[t.length - 1]._num}</b> van a otros pasos (ver flechas) ▶` : '■ Fin del proceso'}</span>
      </div>${llegan.length ? `<div class="fase-llegan">↩ Retornos que llegan a esta ${tramos.length > 1 ? 'parte' : 'fase'}: ${llegan.map(esc).join(' · ')}</div>` : ''}`
      paginas.push(`<div class="pag-flujo">
        ${cab(`Fase ${fi + 1} de ${fs.length}${tramos.length > 1 ? ` · parte ${k + 1} de ${tramos.length}` : ''} · leyenda en A.0 · ${pie}`)}
        <div class="fase-cab" style="border-left-color:${col.tono}">
          <div class="fase-num" style="background:${col.tono}">FASE ${fi + 1}</div>
          <div class="fase-txt"><div class="fase-nom">${esc(f.nombre)}</div><div class="fase-desc">${esc(f.descripcion || 'Sin descripción registrada.')}</div></div>
          <div class="fase-meta">
            <span class="k">Responsable principal</span><b>${esc(f.responsable_principal || '—')}</b>
            <span class="k">Apoyo</span><span>${apoyo.length ? apoyo.map(esc).join(', ') : '—'}</span>
          </div>
          <div class="fase-stats">${stat(ps.length, 'pasos')}${stat(ps.filter(x => x.es_decision).length, 'decisiones')}${stat(ps.filter(x => x.es_control_critico).length, 'controles')}${stat(ps.filter(x => x.documento).length, 'documentos')}</div>
        </div>
        ${nav}
        <div class="tramo-svg" style="--cap:${cap}mm">${svg}</div>
        ${tabla}
        ${k === tramos.length - 1 && errs.length ? `<p class="small fase-err"><b>Errores frecuentes en esta fase:</b> ${errs.map(e => `${esc(e.error)}${e.prevencion ? ` <span class="muted">(prevención: ${esc(e.prevencion)})</span>` : ''}`).join(' · ')}</p>` : ''}
      </div>`)
    })
  })

  const css = `<style>
    @page flujo { size: A4 landscape; margin: 8mm 8mm 10mm; }
    .pag-flujo { page: flujo; break-before: page; margin: 0 -10mm; }
    .pie { page: flujo; }   /* el pie sigue en la última página horizontal, no abre una hoja vertical vacía */
    .anx-cab { display:flex; justify-content:space-between; gap: 12px; font-size: 8.3pt; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid var(--line); padding-bottom: 2px; margin-bottom: 3mm; }
    .anx-cab b { color: var(--ink); }
    .anx-tit { font-size: 16pt; font-weight: 800; color: var(--ink); margin: 0 0 1.5mm; }
    .anx-lead { margin: 0 0 3mm; max-width: 245mm; }
    .anx-h3 { font-size: 11pt; margin: 3.5mm 0 1.5mm; color: var(--ink2); }
    .bloque { break-inside: avoid; }
    .cadena { display:flex; align-items: stretch; margin: 2mm 0 3mm; break-inside: avoid; }
    .fcard { flex: 1 1 0; min-width: 0; border: 1px solid var(--line); border-top: 5px solid; border-radius: 8px; padding: 5px 8px 6px; background:#fff; display:flex; flex-direction: column; }
    .fcard .fnum { font-size: 17pt; font-weight: 800; line-height: 1; }
    .fcard .fnom { font-weight: 700; font-size: 9.2pt; line-height: 1.2; margin: 3px 0 2px; color: var(--ink); }
    .fcard .fresp { font-size: 8.3pt; color: var(--muted); flex: 1; }
    .fcard .fstat { font-size: 7.8pt; color: var(--muted); margin-top: 4px; border-top: 1px dashed var(--line); padding-top: 3px; line-height: 1.3; }
    .fcard .fpag { font-size: 7.8pt; font-weight: 700; margin-top: 2px; }
    .flecha { align-self: center; padding: 0 2px; color: #94A3B8; font-size: 15pt; line-height: 1; }
    table.mx { font-size: 8.8pt; } table.mx th.c, table.mx td.c { text-align: center; }
    table.mx td.c { padding: 4px 5px; } table.mx .n { display:inline-block; font-weight: 700; margin: 0 2px; white-space: nowrap; }
    table.mx .p, table.dc .p { display:block; font-weight: 400; color: var(--muted); font-size: 7.6pt; line-height: 1.25; }
    table.mx .d { display:block; font-size: 7.8pt; font-weight: 600; color: #31537B; }
    table.mx td.tot { font-weight: 800; color: var(--ink); } table.mx tr.docs td { background: #F8FAFC; }
    .cr { color: var(--bad); font-weight: 800; } table.tp td.num .cr, table.tp td.num .dec { font-size: 8pt; line-height: 1.1; }
    table.tp td.num .dec { color: #B8860B; }
    .dest { display:inline-block; font-weight: 700; font-size: 8.3pt; padding: 0 5px; border-radius: 4px; white-space: nowrap; }
    .dest.atras { background:#FFF4E5; color:#9A5B00; } .dest.salto { background:#E8F0FE; color:#1a56db; } .dest.sig { background:#F1F5F9; color:#334155; }
    .fase-cab { display:flex; gap: 12px; align-items: center; border: 1px solid var(--line); border-left: 7px solid; border-radius: 8px; padding: 4px 10px; background: var(--soft); break-inside: avoid; }
    .fase-num { color:#fff; font-weight: 800; font-size: 8.5pt; letter-spacing: 1.2px; padding: 6px 9px; border-radius: 6px; white-space: nowrap; }
    .fase-txt { flex: 1 1 auto; min-width: 0; }
    .fase-nom { font-size: 12.5pt; font-weight: 800; color: var(--ink); line-height: 1.12; }
    .fase-desc { font-size: 8.8pt; color: var(--muted); margin-top: 1px; font-style: italic; line-height: 1.3; }
    .fase-meta { flex: 0 0 auto; display: grid; grid-template-columns: auto auto; gap: 0 8px; font-size: 8.3pt; max-width: 84mm; align-items: baseline; line-height: 1.3; }
    .fase-meta .k { color: var(--muted); text-transform: uppercase; font-size: 7pt; letter-spacing: .5px; font-weight: 700; }
    .fase-stats { display:flex; gap: 6px; }
    .fase-stats .st { text-align:center; border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; background:#fff; min-width: 44px; }
    .fase-stats .st b { display:block; font-size: 11pt; line-height: 1.1; color: var(--ink); } .fase-stats .st span { font-size: 6.8pt; color: var(--muted); text-transform: uppercase; letter-spacing: .3px; }
    .fase-nav { display:flex; justify-content: space-between; gap: 16px; font-size: 8.8pt; color: var(--muted); margin: 2mm 0 1.2mm; }
    .fase-nav b { color: var(--ink); } .fase-nav i { color: #94A3B8; }
    .fase-llegan { font-size: 8.5pt; color: #9A5B00; margin: -0.5mm 0 1.5mm; }
    .tramo-svg { display:block; break-inside: avoid; margin-bottom: 2mm; }
    .tramo-svg svg { display:block; max-width: 100%; max-height: var(--cap, 84mm); width: auto; height: auto; margin: 0 auto; border: 1px solid var(--line); border-radius: 6px; background:#fff; }
    table.tp { font-size: 8.6pt; margin-bottom: 2mm; } table.dc { font-size: 8.3pt; } table.tp td, table.dc td { padding: 2px 6px; line-height: 1.3; } table.tp th, table.dc th, table.mx th { padding: 4px 6px; }
    .fase-err { margin: 0.5mm 0 1mm; line-height: 1.4; }
    .ley { display:flex; gap: 14px; flex-wrap: wrap; font-size: 8pt; color: var(--muted); margin-top: 2mm; }
    .ley span { display: inline-flex; align-items: center; gap: 6px; }
    .ley i { display: inline-block; width: 18px; height: 11px; border: 1.5px solid #4D4D4D; border-radius: 2px; background: #fff; font-style: normal; }
    @media screen {
      .pag-flujo { width: 281mm; margin: 8mm 0 8mm calc(-16mm - 35.5mm); padding: 8mm 8mm 10mm; background:#fff; box-shadow: 0 6px 30px rgba(0,0,0,.12); border-radius: 4px; }
    }
    @media print { .fcard, .fase-cab, .fase-num, .fase-stats .st, .dest, table.mx td.c, table.mx th.c { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>`

  return { html: css + paginas.join('\n'), paginas: paginas.length, numero, norm }
}

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
  const docSop = (d.docs || []).filter(x => x.tipo === 'SOP').sort((x, y) => String(y.version).localeCompare(String(x.version), 'es', { numeric: true }))
  const sopVig = docSop.find(x => x.es_vigente) || docSop[0]
  const version = sopVig ? `${sopVig.es_vigente ? 'Vigente' : 'Borrador'} v${sopVig.version}` : 'Sin versión guardada'
  const semP = SEM_PROCESO[p.semaforo] || SEM_PROCESO.gris
  const abiertos = acuerdos.filter(x => ['ABIERTO', 'EN_CURSO'].includes(x.estado))
  const vencidos = abiertos.filter(x => x.vencido)
  const sc = new Map(scorecard.map(k => [k.id, k]))

  const anexo = anexoFlujoHTML({ p, fs, pasos: d.pasos || [], errores: d.errores || [], version, fecha: fF(hoy) })
  const { numero, norm } = anexo
  const pasosDe = f => norm.filter(x => x.fase_id === f.id)
  const docsFlujo = norm.filter(x => x.documento).map(x => ({ n: x._num, fi: x._fi, fase: fs[x._fi].nombre, accion: x.accion, documento: x.documento, url: x.documento_url, responsable: x.responsable }))

  /* resumen automático */
  const mensajes = []
  mensajes.push(`Avance global <b>${pct(a.global)}</b>: SOP ${pct(a.sop)} · flujograma ${pct(a.flujograma)} · capacitación ${pct(a.capacitacion)} · implementación ${pct(a.implementacion)}. Etapa ${Math.min(6, et.filter(e => e.ok).length + 1)} de 6: <b>${esc((et.find(e => !e.ok) || {}).l || 'todas completas')}</b>.`)
  mensajes.push(`Contenido del SOP: ${a.contenidoN} de 7 secciones${a.contenidoN < 7 ? ` (faltan ${a.secciones.filter(s => !s.ok).map(s => s.l.toLowerCase()).join(', ')})` : ' completas'}; ${fs.length} fases y ${norm.length} pasos, ${norm.filter(x => x.es_decision).length} decisiones, ${norm.filter(x => x.es_control_critico).length} controles críticos y ${docsFlujo.length} documentos asociados al flujo.`)
  if (p.dueno_provisional) mensajes.push(`Dueño provisional: el cargo <b>${esc(p.dueno_cargo || '—')}</b> está vacante o por contratar; sin dueño real no hay quien firme la revisión ni lidere la bajada.`)
  if (p.dias_atraso > 0) mensajes.push(`${p.dias_atraso} días sobre la fecha objetivo vigente (${fF(p.fecha_objetivo_vigente)}). Semáforo: ${semP[1].toLowerCase()}.`)
  if (encargo) mensajes.push(`Comité de trabajo liderado por <b>${esc(encargo.lider)}</b> (${(encargo.integrantes || []).length} integrantes), fase ${encargo.fase_actual} de 7 (${esc(encargo.fase_actual_nombre || '')}), ${encargo.vencido ? `<b>vencido hace ${Math.abs(encargo.dias_restantes)} días</b>` : `${encargo.dias_restantes} días de plazo`}.`)
  else mensajes.push('Sin comité de trabajo asignado: nadie tiene el encargo formal de llevar este proceso a aprobación (P21).')
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
      <p class="small"><i>${esc(f.descripcion || 'Sin descripción.')}</i> · Responsable principal: <b>${esc(f.responsable_principal || '—')}</b>${apoyo.length ? ` · Con: ${apoyo.map(esc).join(', ')}` : ''}${ps.length ? ` · Diagrama en el Anexo A, página A.${fi + 1}` : ''}</p>
      ${ps.length ? `<table class="t"><tr><th class="num">N°</th><th style="width:34%">Acción</th><th>Responsable</th><th>Participan</th><th>Sistema</th><th>Documento</th><th>Control / tiempo</th></tr>
        ${ps.map(s => {
          const marca = s.es_control_critico ? ' 🔴' : s.es_decision ? ' ◆' : ''
          const dest = id => numero.has(id) ? ` (paso ${numero.get(id)})` : ''
          const ramas = s.es_decision ? `<div class="small"><b>Sí →</b> ${esc(s.rama_si || '—')}${s.rama_si_destino ? dest(s.rama_si_destino) : ''}<br/><b>No →</b> ${esc(s.rama_no || '—')}${s.rama_no_destino ? dest(s.rama_no_destino) : ''}</div>` : ''
          const doc = s.documento ? (s.documento_url ? `<a href="${esc(s.documento_url)}">${esc(s.documento)}</a>` : esc(s.documento)) : '—'
          return `<tr><td class="num">${s._num}${marca}</td><td>${esc(s.accion)}${ramas}</td><td>${esc(s.responsable || '—')}</td><td class="small">${(s.participantes || []).filter(Boolean).map(esc).join(', ') || '—'}</td><td class="small">${esc(s.sistema || '—')}</td><td class="small">${doc}</td><td class="small">${esc(s.control_tiempo || '—')}</td></tr>`
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

  /* 4. flujograma y documentos */
  const docsT = docsFlujo.length ? `<table class="t"><tr><th class="num">Paso</th><th>Fase</th><th>Acción</th><th>Documento / estándar</th><th>Responsable</th><th>Anexo</th></tr>
    ${docsFlujo.map(x => `<tr><td class="num">${esc(x.n)}</td><td class="small">${esc(x.fase)}</td><td>${esc(x.accion)}</td><td><b>${esc(x.documento)}</b>${x.url ? `<div class="small"><a href="${esc(x.url)}">${esc(x.url)}</a></div>` : ''}</td><td class="small">${esc(x.responsable || '—')}</td><td class="small">A.${x.fi + 1}</td></tr>`).join('')}</table>` : '<p class="muted">Ningún paso tiene documento asociado todavía (Editar → sección 5 → Documento).</p>'
  const carrilesN = new Set(norm.map(x => (x.responsable || 'Sin asignar').trim())).size
  secciones.push(`<h2>4. Flujograma, documentos y responsables</h2>
    ${anexo.paginas
      ? `<div class="caja"><b>El flujograma completo va en el Anexo A</b>, en ${anexo.paginas} páginas horizontales al final de este informe: <b>A.0</b> es el mapa del proceso (cadena de ${fs.length} fases, matriz de quién hace qué entre ${carrilesN} responsables y tabla de las ${norm.filter(x => x.es_decision).length} decisiones con sus destinos); luego hay <b>una página por fase</b> con su diagrama swimlane, el detalle de cada paso (responsable, participantes, sistema, documento, control) y los retornos que entran o salen de ella.</div>
         <p class="small muted">Cómo leer el diagrama: cada carril horizontal es un responsable; las cajas son pasos numerados fase.paso; el rombo es una decisión con sus salidas SÍ/NO; borde rojo = control crítico; caja celeste = paso que genera o exige un documento; la flecha naranja discontinua es un retorno o salto de una decisión, y cuando el destino está en otra página se indica su número en un rótulo. Los conectores "viene de / continúa en" enlazan las páginas entre sí.</p>`
      : '<p class="muted">El flujograma se genera cuando el proceso tiene fases con pasos (Editar → sección 5).</p>'}
    <h3>Documentos del flujo</h3>${docsT}`)

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
    : '<p class="muted">Sin comité de trabajo asignado. Se asigna desde la sala de sesión del comité de gobierno o en Comités → Comités de trabajo (P21).</p>'
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
    <h3>Comité de trabajo (P21)</h3>${encT}
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

  /* anexo A: flujograma en páginas horizontales */
  if (anexo.paginas) secciones.push(anexo.html)

  const meta = [
    ['Proceso', `<b>${esc(p.id)} · ${esc(p.nombre)}</b>`],
    ['Clasificación', `${esc(p.categoria_nombre || p.categoria)} · ${esc(String(p.onda_nombre || p.onda || '').replace('ONDA_', 'Onda '))} · impacto ${esc(p.impacto)} × urgencia ${esc(p.urgencia)} = score ${p.score} · detalle ${esc(p.nivel_detalle || '—')}`],
    ['Dirección / comité', `${esc(p.direccion_etiqueta || p.direccion_responsable || '—')} · ${esc(comite?.nombre || '—')}`],
    ['Dueño del proceso', `${esc(p.dueno_cargo || '—')}${p.dueno_persona ? ' — ' + esc(p.dueno_persona) : ''}${p.dueno_provisional ? ' ' + chip('provisional', 'warn') : ''}`],
    ['Estado', `${esc(p.estado_impl_etiqueta || p.estado_implementacion)} · SOP ${esc(String(p.estado_sop || '').toLowerCase().replace('_', ' '))} · flujograma ${esc(String(p.estado_flujograma || '').toLowerCase().replace('_', ' '))} · ${chip(semP[1], semP[0])}`],
    ['Fechas', `objetivo vigente ${fF(p.fecha_objetivo_vigente)}${p.dias_atraso > 0 ? ` (<b>${p.dias_atraso} días de atraso</b>)` : ''}${p.proxima_revision ? ` · próxima revisión ${fF(p.proxima_revision)}` : ''} · corte del informe ${fF(hoy)}`],
    ['Documento SOP', `${esc(version)} · ${docSop.length} versión(es) guardada(s)`],
    ['Contenido', `8 secciones${anexo.paginas ? ` + Anexo A: flujograma en ${anexo.paginas} páginas horizontales (mapa del proceso y una página por fase)` : ''}`],
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
    toast?.(`Informe del proceso ${p.id} generado. En la pestaña nueva: Imprimir → Guardar como PDF (el Anexo A sale en páginas horizontales).`)
  }
}
