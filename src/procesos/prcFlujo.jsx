// src/procesos/prcFlujo.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Motor de flujogramas swimlane de Outlet de Puertas.
// Una sola fuente de verdad: los mismos datos (prc_fases + prc_pasos) generan
// el SVG que se ve dentro de la app, las páginas por fase del informe del
// proceso y el XML de draw.io que se descarga.
//
// Convención visual (estándar interno ODP, tomado del "Flujo Picking y Despacho"
// dibujado en draw.io): carriles blancos con cabecera gris, bandas de etapa en
// pastel con borde del tono, cajas blancas de borde oscuro, rombos amarillos
// #FFF2CC, celeste #DAE8FC para pasos con documento, INICIO verde y FIN rojo
// (paleta clásica de draw.io), retornos de decisión en naranjo discontinuo.
//
// Opciones de flujoSVG / modeloFlujo (todas opcionales; sin ellas el dibujo es
// el flujograma completo que usa la app):
//   interactivo, selId, selFase, version, fecha   → visor y diseñador
//   sinTitulo, sinLeyenda                          → recorte para documentos
//   terminadores: 'ambos' | 'inicio' | 'fin' | 'ninguno'
//   entrada / salida: { num, texto, fase }         → conectores "viene de" / "continúa en"
//   numFase(fase, idx) → número de fase a mostrar (al dibujar una sola fase)
//   resolver(destinoId, origenId) → { num, texto, fase, atras } para ramas cuyo
//       destino está fuera del recorte (se dibujan como salidas a otra página)
//   dims: { COL_W, ROW_H, ... }                    → medidas alternativas (impresión)
// ─────────────────────────────────────────────────────────────────────────────

export const FLU = {
  LANE_W: 178,   // ancho de la columna de títulos de swimlane
  COL_W: 236,    // ancho de cada columna (un paso)
  ROW_H: 132,    // alto de cada swimlane
  PHASE_H: 46,   // alto de la barra de fase
  TITLE_H: 62,   // alto del bloque de título
  PAD: 18,
  BOX_W: 196,
  BOX_H: 92,
  TERM_W: 108,   // columna del terminador INICIO / FIN (o del conector viene de / continúa en)
  PISTA: 24,     // separación vertical entre calles de retorno
  FONT: '-apple-system, BlinkMacSystemFont, Segoe UI, Inter, system-ui, sans-serif'
}

/** Medidas efectivas: FLU con las sobreescrituras de opts.dims. */
export const dimsDe = (opts = {}) => (opts.dims ? { ...FLU, ...opts.dims } : FLU)

// Carriles al estilo del estándar: cuerpo blanco (alternado apenas), cabecera gris
const LANE_PALETTE = [
  { bg: '#FFFFFF', border: '#C9CDD4', text: '#333333' },
  { bg: '#FAFBFC', border: '#C9CDD4', text: '#333333' }
]

// Bandas de etapa: pares pastel/borde de la paleta clásica de draw.io
const PHASE_PALETTE = [
  { bg: '#FFE6CC', tono: '#D79B00' },   // naranjo
  { bg: '#DAE8FC', tono: '#6C8EBF' },   // celeste
  { bg: '#D5E8D4', tono: '#82B366' },   // verde
  { bg: '#FFF2CC', tono: '#D6B656' },   // amarillo
  { bg: '#E1D5E7', tono: '#9673A6' },   // morado
  { bg: '#F8CECC', tono: '#B85450' },   // rojo
  { bg: '#F5F5F5', tono: '#666666' }    // gris
]
// Deriva el par pastel/tono desde el color elegido en el editor
const pastelDe = hex => {
  const h = String(hex || '').replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return { bg: '#' + h + '26', tono: '#' + h }
}
/** Color de una fase (pastel + tono), el mismo que usa la barra del flujograma. */
export const colorFase = (fase, idx = 0) => pastelDe(fase?.color) || PHASE_PALETTE[idx % PHASE_PALETTE.length]

const CRITICO = '#B85450'    // rojo draw.io
const DECISION = '#D79B00'   // naranjo draw.io (decisiones y retornos)
const DOC_BG = '#DAE8FC'     // celeste: paso con documento
const DOC_BORDE = '#6C8EBF'
const NEUTRO = '#4D4D4D'
const CONECTOR = '#475569'   // gris pizarra: conectores viene de / continúa en

/* ── utilidades ──────────────────────────────────────────────────────────── */

export const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Doble escape para el atributo value de draw.io, que contiene HTML
export const escHtmlAttr = s => esc(s).replace(/&amp;/g, '&amp;amp;')

export function wrap(txt, maxChars, maxLines) {
  const words = String(txt || '').split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w
    if (test.length <= maxChars) { cur = test; continue }
    if (cur) lines.push(cur)
    cur = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w
  }
  if (cur) lines.push(cur)
  if (maxLines && lines.length > maxLines) {
    const cut = lines.slice(0, maxLines)
    cut[maxLines - 1] = cut[maxLines - 1].replace(/[\s,.;:]+$/, '').slice(0, maxChars - 1) + '…'
    return cut
  }
  return lines
}

/* ── modelo ──────────────────────────────────────────────────────────────── */

/**
 * Arma el modelo geométrico del flujograma.
 * @param {Array} fases  [{id, orden, nombre, color}]
 * @param {Array} pasos  [{id, fase_id, orden, accion, responsable, sistema,
 *                         control_tiempo, es_control_critico, es_decision, rama_si, rama_no,
 *                         rama_si_destino, rama_no_destino, documento, participantes}]
 * @param {Object} opts  ver cabecera del archivo
 */
export function modeloFlujo(fases, pasos, opts = {}) {
  const D = dimsDe(opts)
  const fs = [...(fases || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0))
  const byFase = new Map(fs.map(f => [f.id, []]))
  for (const p of (pasos || [])) {
    if (!byFase.has(p.fase_id)) byFase.set(p.fase_id, [])
    byFase.get(p.fase_id).push(p)
  }
  for (const arr of byFase.values()) arr.sort((a, b) => (a.orden || 0) - (b.orden || 0))

  // Columnas en orden fase → paso
  const cols = []
  const barras = []
  fs.forEach((f, fi) => {
    const list = byFase.get(f.id) || []
    if (!list.length) return
    const desde = cols.length
    list.forEach(p => cols.push({ paso: p, fase: f, faseIdx: fi }))
    barras.push({ fase: f, faseIdx: fi, desde, hasta: cols.length - 1, color: colorFase(f, fi) })
  })

  // Swimlanes en orden de primera aparición
  const lanes = []
  const laneIdx = new Map()
  cols.forEach(c => {
    const key = (c.paso.responsable || 'Sin asignar').trim()
    if (!laneIdx.has(key)) {
      laneIdx.set(key, lanes.length)
      lanes.push({ key, label: key, ...LANE_PALETTE[lanes.length % LANE_PALETTE.length] })
    }
  })
  cols.forEach(c => { c.lane = laneIdx.get((c.paso.responsable || 'Sin asignar').trim()) })

  // Terminadores y conectores de página
  const term = opts.terminadores || 'ambos'
  const conInicio = term === 'ambos' || term === 'inicio'
  const conFin = term === 'ambos' || term === 'fin'
  const entrada = !conInicio && opts.entrada ? opts.entrada : null
  const salida = !conFin && opts.salida ? opts.salida : null
  const colIzq = (conInicio || entrada) ? D.TERM_W : 0
  const colDer = (conFin || salida) ? D.TERM_W : 0
  const titleH = opts.sinTitulo ? 0 : D.TITLE_H

  // Destino de una rama: dentro del dibujo ('int', columna j), fuera de él
  // ('ext', resuelto por opts.resolver) o inexistente (null).
  const idx = new Map(cols.map((c, i) => [c.paso.id, i]))
  const resolver = typeof opts.resolver === 'function' ? opts.resolver : null
  const destinoDe = (destId, origenId) => {
    if (!destId) return null
    if (idx.has(destId)) return { tipo: 'int', j: idx.get(destId) }
    const info = resolver ? resolver(destId, origenId) : null
    return info ? { tipo: 'ext', ...info } : null
  }

  // Desvíos de decisión: el flujo salta o vuelve a otro paso (rama con destino).
  // Cada desvío corre por su propia "calle" bajo los carriles para no cruzarse.
  // Los destinos fuera del dibujo salen por una calle hacia el borde, con la
  // referencia del paso al que van (conector fuera de página).
  const desvios = []
  cols.forEach((c, i) => {
    const p = c.paso
    if (!p.es_decision) return
    const agregar = (destId, tipo, etiqueta) => {
      const dst = destinoDe(destId, p.id)
      if (!dst) return
      if (dst.tipo === 'int') {
        if (dst.j === i || dst.j === i + 1) return       // el paso siguiente usa la flecha normal
        desvios.push({ from: i, to: dst.j, tipo, etiqueta, pista: desvios.length })
      } else {
        desvios.push({ from: i, to: null, ext: dst, tipo, etiqueta, pista: desvios.length })
      }
    }
    agregar(p.rama_si_destino, 'si', p.rama_si || 'SÍ')
    agregar(p.rama_no_destino, 'no', p.rama_no || 'NO')
  })

  const W = D.PAD * 2 + D.LANE_W + colIzq + colDer + cols.length * D.COL_W
  const extraDesvios = desvios.length ? desvios.length * D.PISTA + 14 : 0
  const pieH = opts.sinLeyenda ? (desvios.length ? 4 : 0) : 34
  const H = D.PAD * 2 + titleH + D.PHASE_H + lanes.length * D.ROW_H + extraDesvios + pieH

  const cellX = i => D.PAD + D.LANE_W + colIzq + i * D.COL_W
  const cellY = lane => D.PAD + titleH + D.PHASE_H + lane * D.ROW_H
  const finLanes = D.PAD + titleH + D.PHASE_H + lanes.length * D.ROW_H
  const numFase = c => (typeof opts.numFase === 'function' ? opts.numFase(c.fase, c.faseIdx) : c.faseIdx + 1)
  const numPaso = c => `${numFase(c)}.${c.paso.orden}`

  return {
    fases: fs, cols, lanes, barras, idx, desvios, extraDesvios, W, H,
    D, colIzq, colDer, titleH, conInicio, conFin, entrada, salida,
    cellX, cellY, finLanes, destinoDe, numFase, numPaso
  }
}

/* ── SVG ─────────────────────────────────────────────────────────────────── */

export function flujoSVG(proceso, fases, pasos, opts = {}) {
  const { interactivo, selId, selFase } = opts
  const SEL = '#4F46E5'
  const m = modeloFlujo(fases, pasos, opts)
  const D = m.D
  if (!m.cols.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="90"><text x="16" y="50" `
      + `font-family="${D.FONT}" font-size="14" fill="#8E8E93">Sin pasos definidos para este proceso.</text></svg>`
  }
  const { cols, lanes, barras, desvios, W, H, cellX, cellY, finLanes, destinoDe, numPaso } = m
  const CH = D.BOX_W / FLU.BOX_W                       // factor de caracteres por línea según el ancho de caja
  const chars = n => Math.max(10, Math.round(n * CH))
  const o = []

  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${D.FONT}">`)
  o.push(`<defs>
    <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#4D4D4D"/>
    </marker>
    <marker id="arc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${CRITICO}"/>
    </marker>
    <marker id="ard" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${DECISION}"/>
    </marker>
    <marker id="arp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${CONECTOR}"/>
    </marker>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.6" flood-color="#0F172A" flood-opacity="0.10"/>
    </filter>
  </defs>`)
  o.push(`<rect width="${W}" height="${H}" fill="#FFFFFF"/>`)

  /* Título */
  if (!opts.sinTitulo) {
    const tx = D.PAD, ty = D.PAD
    o.push(`<rect x="${tx}" y="${ty}" width="${W - D.PAD * 2}" height="${D.TITLE_H - 12}" rx="10" fill="#16213E"/>`)
    o.push(`<text x="${tx + 18}" y="${ty + 21}" font-size="13.5" font-weight="700" fill="#FFFFFF">${esc(proceso.id)} · ${esc(proceso.nombre)}</text>`)
    o.push(`<text x="${tx + 18}" y="${ty + 38}" font-size="10.5" fill="#B9C0D4">Flujograma swimlane · Outlet de Puertas SpA · ${esc(opts.version || 'Borrador v0.1')}${opts.fecha ? ' · ' + esc(opts.fecha) : ''}</text>`)
  }

  /* Barras de fase */
  const py = D.PAD + m.titleH
  o.push(`<rect x="${D.PAD}" y="${py}" width="${D.LANE_W}" height="${D.PHASE_H}" rx="8" fill="#F1F5F9"/>`)
  o.push(`<text x="${D.PAD + 14}" y="${py + D.PHASE_H / 2 + 5}" font-size="11" font-weight="700" fill="#64748B">FASES →</text>`)
  barras.forEach(b => {
    const x = cellX(b.desde) + 4
    const w = (b.hasta - b.desde + 1) * D.COL_W - 8
    o.push(`<g data-fase="${esc(b.fase.id)}"${interactivo ? ' style="cursor:pointer"' : ''}>`)
    o.push(`<rect x="${x}" y="${py}" width="${w}" height="${D.PHASE_H}" rx="8" fill="${b.color.bg}" stroke="${b.color.tono}" stroke-width="1.4"/>`)
    if (selFase && selFase === b.fase.id) {
      o.push(`<rect x="${x - 3}" y="${py - 3}" width="${w + 6}" height="${D.PHASE_H + 6}" rx="10" fill="none" stroke="${SEL}" stroke-width="3" stroke-dasharray="6 4"/>`)
    }
    const label = `${m.numFase(b)}. ${b.fase.nombre}`.toUpperCase()
    const apoyos = (b.fase.responsables_apoyo || []).filter(Boolean)
    const conApoyo = apoyos.length > 0
    const yTit = conApoyo ? py + D.PHASE_H / 2 - 2 : py + D.PHASE_H / 2 + 4
    o.push(`<text x="${x + w / 2}" y="${yTit}" font-size="11.5" font-weight="700" fill="${b.color.tono}" text-anchor="middle">${esc(wrap(label, Math.floor(w / 7.2), 1)[0] || '')}</text>`)
    if (conApoyo) {
      const resp = [b.fase.responsable_principal, ...apoyos].filter(Boolean).join(' · ')
      o.push(`<text x="${x + w / 2}" y="${py + D.PHASE_H / 2 + 11}" font-size="9" font-weight="600" fill="${b.color.tono}" fill-opacity="0.9" text-anchor="middle">${esc(wrap(resp, Math.floor(w / 5.4), 1)[0] || '')}</text>`)
    }
    o.push('</g>')
  })

  /* Swimlanes */
  lanes.forEach((ln, i) => {
    const y = cellY(i)
    o.push(`<rect x="${D.PAD}" y="${y}" width="${W - D.PAD * 2}" height="${D.ROW_H}" fill="${ln.bg}" stroke="${ln.border}" stroke-width="1"/>`)
    o.push(`<rect x="${D.PAD}" y="${y}" width="${D.LANE_W}" height="${D.ROW_H}" fill="#F5F5F5" stroke="${ln.border}"/>`)
    const lines = wrap(ln.label, Math.max(12, Math.round(20 * D.LANE_W / FLU.LANE_W)), 3)
    const y0 = y + D.ROW_H / 2 - (lines.length - 1) * 8
    lines.forEach((l, k) => {
      o.push(`<text x="${D.PAD + D.LANE_W / 2}" y="${y0 + k * 16 + 5}" font-size="11.5" font-weight="700" fill="${ln.text}" text-anchor="middle">${esc(l)}</text>`)
    })
  })

  /* Separadores verticales de fase */
  barras.forEach((b, i) => {
    if (i === 0) return
    const x = cellX(b.desde)
    o.push(`<line x1="${x}" y1="${py + D.PHASE_H}" x2="${x}" y2="${finLanes}" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4 4"/>`)
  })

  /* Etiqueta de la rama que sigue derecho desde una decisión (SÍ / NO cortas: el
     texto completo de cada rama va en el SOP y en la tabla del informe) */
  const ramaQueSigue = (pa, i) => {
    if (!pa.es_decision) return ''
    const siD = destinoDe(pa.rama_si_destino, pa.id), noD = destinoDe(pa.rama_no_destino, pa.id)
    const sigue = d => d && d.tipo === 'int' && d.j === i + 1
    if (!siD || sigue(siD)) return 'SÍ'
    if (!noD || sigue(noD)) return 'NO'
    return null                                          // ambas ramas desvían: no hay flecha secuencial
  }
  const etiquetaRama = (x, y, txt, anchor = 'middle') => {
    if (txt) o.push(`<text x="${x}" y="${y}" font-size="9.5" font-weight="800" fill="${DECISION}" text-anchor="${anchor}">${esc(txt)}</text>`)
  }

  /* INICIO y FIN — terminadores del flujo; o conectores "viene de" / "continúa en" */
  const primero = cols[0], ultimo = cols[cols.length - 1]
  const iniCx = D.PAD + D.LANE_W + D.TERM_W / 2
  const iniCy = cellY(primero.lane) + D.ROW_H / 2
  const finCx = cellX(cols.length - 1) + D.COL_W + D.TERM_W / 2
  const finCy = cellY(ultimo.lane) + D.ROW_H / 2
  const xIn = cellX(0) + (D.COL_W - D.BOX_W) / 2               // borde izquierdo de la primera caja
  const xOut = cellX(cols.length - 1) + D.COL_W / 2 + D.BOX_W / 2   // borde derecho de la última caja
  const ramaFin = ramaQueSigue(ultimo.paso, cols.length - 1)   // null = ambas ramas salen por calles: sin flecha al terminador

  const conector = (cx, cy, rotulo, ref, sub) => {
    o.push(`<rect x="${cx - 37}" y="${cy - 16}" width="74" height="32" rx="7" fill="#F1F5F9" stroke="${CONECTOR}" stroke-width="1.4" stroke-dasharray="4 3"/>`)
    o.push(`<text x="${cx}" y="${cy - 4}" font-size="7.5" font-weight="700" letter-spacing=".8" fill="${CONECTOR}" text-anchor="middle">${esc(rotulo)}</text>`)
    o.push(`<text x="${cx}" y="${cy + 10}" font-size="11.5" font-weight="800" fill="#1E293B" text-anchor="middle">${esc(ref)}</text>`)
    if (sub) o.push(`<text x="${cx}" y="${cy + 29}" font-size="8.5" fill="#64748B" text-anchor="middle">${esc(wrap(sub, 16, 1)[0])}</text>`)
  }

  if (m.conInicio) {
    o.push(`<rect x="${iniCx - 41}" y="${iniCy - 17}" width="82" height="34" rx="17" fill="#D5E8D4" stroke="#82B366" stroke-width="2" filter="url(#sh)"/>`)
    o.push(`<text x="${iniCx}" y="${iniCy + 4}" font-size="11" font-weight="800" letter-spacing="1" fill="#1F5B24" text-anchor="middle">INICIO</text>`)
    o.push(`<path d="M ${iniCx + 41} ${iniCy} L ${xIn} ${iniCy}" fill="none" stroke="#82B366" stroke-width="1.8" marker-end="url(#ar)"/>`)
  } else if (m.entrada) {
    conector(iniCx, iniCy, 'VIENE DE', m.entrada.num || '—', m.entrada.fase)
    o.push(`<path d="M ${iniCx + 37} ${iniCy} L ${xIn} ${iniCy}" fill="none" stroke="${CONECTOR}" stroke-width="1.6" marker-end="url(#arp)"/>`)
  }
  if (m.conFin) {
    o.push(`<rect x="${finCx - 37}" y="${finCy - 17}" width="74" height="34" rx="17" fill="#F8CECC" stroke="${CRITICO}" stroke-width="2.6" filter="url(#sh)"/>`)
    o.push(`<text x="${finCx}" y="${finCy + 4}" font-size="11" font-weight="800" letter-spacing="1.5" fill="#7C2B25" text-anchor="middle">FIN</text>`)
    if (ramaFin !== null) {
      o.push(`<path d="M ${xOut} ${finCy} L ${finCx - 37} ${finCy}" fill="none" stroke="${CRITICO}" stroke-width="1.8" marker-end="url(#arc)"/>`)
      etiquetaRama((xOut + finCx - 37) / 2, finCy - 7, ramaFin)
    }
  } else if (m.salida && ramaFin !== null) {
    conector(finCx, finCy, 'CONTINÚA EN', m.salida.num || '—', m.salida.fase)
    o.push(`<path d="M ${xOut} ${finCy} L ${finCx - 37} ${finCy}" fill="none" stroke="${CONECTOR}" stroke-width="1.6" marker-end="url(#arp)"/>`)
    etiquetaRama((xOut + finCx - 37) / 2, finCy - 7, ramaFin)
  }

  /* Conectores secuenciales (debajo de las cajas) */
  for (let i = 0; i < cols.length - 1; i++) {
    const a = cols[i], b = cols[i + 1]
    const etiqueta = ramaQueSigue(a.paso, i)
    if (etiqueta === null) continue
    const ax = cellX(i) + D.COL_W / 2, ay = cellY(a.lane) + D.ROW_H / 2
    const bx = cellX(i + 1) + D.COL_W / 2, by = cellY(b.lane) + D.ROW_H / 2
    const x1 = ax + D.BOX_W / 2, x2 = bx - D.BOX_W / 2
    const crit = a.paso.es_control_critico || b.paso.es_control_critico
    const stroke = crit ? CRITICO : '#4D4D4D'
    const mk = crit ? 'arc' : 'ar'
    let d
    if (a.lane === b.lane) {
      d = `M ${x1} ${ay} L ${x2} ${by}`
      o.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.6" marker-end="url(#${mk})"/>`)
      etiquetaRama((x1 + x2) / 2, ay - 7, etiqueta)
    } else {
      const mid = (x1 + x2) / 2
      const r = 10, dir = by > ay ? 1 : -1
      d = `M ${x1} ${ay} L ${mid - r} ${ay} Q ${mid} ${ay} ${mid} ${ay + r * dir} `
        + `L ${mid} ${by - r * dir} Q ${mid} ${by} ${mid + r} ${by} L ${x2} ${by}`
      o.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.6" marker-end="url(#${mk})"/>`)
      // la etiqueta va junto al tramo vertical, en el borde entre los dos carriles
      etiquetaRama(mid + 5, (ay + by) / 2 + 3.5, etiqueta, 'start')
    }
  }

  /* Desvíos de decisión: retornos y saltos por calles bajo los carriles */
  const TAG_W = 44
  desvios.forEach(dv => {
    const from = cols[dv.from]
    const fx = cellX(dv.from) + D.COL_W / 2
    const fy = cellY(from.lane) + D.ROW_H / 2 + D.BOX_H / 2
    const yCalle = finLanes + 16 + dv.pista * D.PISTA
    const r = 9
    const rotulo = dv.tipo === 'no' ? 'NO' : 'SÍ'
    const extra = dv.etiqueta && !['SÍ', 'NO', 'Sí', 'No', 'SI', 'Si'].includes(dv.etiqueta.trim()) ? ` · ${wrap(dv.etiqueta, 26, 1)[0]}` : ''

    if (dv.to !== null) {
      const to = cols[dv.to]
      const txc = cellX(dv.to) + D.COL_W / 2
      const tyc = cellY(to.lane) + D.ROW_H / 2 + D.BOX_H / 2
      const dir = txc > fx ? 1 : -1
      const d = `M ${fx} ${fy} L ${fx} ${yCalle - r} Q ${fx} ${yCalle} ${fx + r * dir} ${yCalle} `
        + `L ${txc - r * dir} ${yCalle} Q ${txc} ${yCalle} ${txc} ${yCalle - r} L ${txc} ${tyc + 4}`
      o.push(`<path d="${d}" fill="none" stroke="${DECISION}" stroke-width="1.8" stroke-dasharray="7 5" marker-end="url(#ard)"/>`)
      const retorno = dv.to < dv.from
      const tag = `${rotulo} → ${retorno ? 'vuelve a' : 'sigue en'} ${numPaso(to)}${extra}`
      const tagX = Math.min(fx, txc) + Math.abs(txc - fx) / 2
      o.push(`<text x="${tagX}" y="${yCalle - 5}" font-size="9.5" font-weight="700" fill="${DECISION}" text-anchor="middle">${esc(tag)}</text>`)
      return
    }

    // Destino fuera del dibujo: sale por la calle hacia el borde, con la referencia del paso
    const ext = dv.ext
    const atras = !!ext.atras
    const xTag = atras ? D.PAD + D.LANE_W + 8 : W - D.PAD - 8 - TAG_W
    const xEnd = atras ? xTag + TAG_W + 2 : xTag - 2
    const dir = atras ? -1 : 1
    const d = `M ${fx} ${fy} L ${fx} ${yCalle - r} Q ${fx} ${yCalle} ${fx + r * dir} ${yCalle} L ${xEnd} ${yCalle}`
    o.push(`<path d="${d}" fill="none" stroke="${DECISION}" stroke-width="1.8" stroke-dasharray="7 5" marker-end="url(#ard)"/>`)
    o.push(`<rect x="${xTag}" y="${yCalle - 9}" width="${TAG_W}" height="18" rx="4" fill="#FFFFFF" stroke="${DECISION}" stroke-width="1.6"/>`)
    o.push(`<text x="${xTag + TAG_W / 2}" y="${yCalle + 3.5}" font-size="9.5" font-weight="800" fill="${DECISION}" text-anchor="middle">${esc(ext.num || '?')}</text>`)
    const tag = `${rotulo} → ${atras ? 'vuelve a' : 'sigue en'} ${ext.num || '?'}${ext.fase ? ` (${ext.fase})` : ''}${ext.texto ? ` · ${wrap(ext.texto, 34, 1)[0]}` : ''}`
    // el rótulo va sobre el tramo horizontal, del lado donde hay más espacio
    const largo = Math.abs(fx - xEnd)
    let tx, anchor
    if (atras) { if (largo > 170) { tx = xTag + TAG_W + 8; anchor = 'start' } else { tx = fx + 8; anchor = 'start' } }
    else { if (largo > 170) { tx = xTag - 8; anchor = 'end' } else { tx = fx - 8; anchor = 'end' } }
    o.push(`<text x="${tx}" y="${yCalle - 5}" font-size="9.5" font-weight="700" fill="${DECISION}" text-anchor="${anchor}">${esc(tag)}</text>`)
  })

  /* Cajas */
  cols.forEach((c, i) => {
    const p = c.paso
    const cx = cellX(i) + D.COL_W / 2
    const cy = cellY(c.lane) + D.ROW_H / 2
    const x = cx - D.BOX_W / 2, y = cy - D.BOX_H / 2
    const conDoc = !!p.documento
    const stroke = p.es_control_critico ? CRITICO : p.es_decision ? '#D6B656' : conDoc ? DOC_BORDE : '#4D4D4D'
    const sw = p.es_control_critico ? 2.4 : p.es_decision ? 1.6 : 1.1
    const fondoCaja = conDoc ? DOC_BG : '#FFFFFF'

    o.push(`<g data-paso="${esc(p.id)}"${interactivo ? ' style="cursor:pointer"' : ''}>`)
    if (selId && selId === p.id) {
      o.push(`<rect x="${x - 6}" y="${y - 6}" width="${D.BOX_W + 12}" height="${D.BOX_H + 12}" rx="14" fill="${SEL}12" stroke="${SEL}" stroke-width="3" stroke-dasharray="7 4"/>`)
    }
    if (p.es_decision) {
      o.push(`<polygon points="${cx},${y} ${cx + D.BOX_W / 2},${cy} ${cx},${y + D.BOX_H} ${cx - D.BOX_W / 2},${cy}" `
        + `fill="#FFF2CC" stroke="${stroke}" stroke-width="${sw}" filter="url(#sh)"/>`)
    } else {
      o.push(`<rect x="${x}" y="${y}" width="${D.BOX_W}" height="${D.BOX_H}" rx="4" fill="${fondoCaja}" stroke="${stroke}" stroke-width="${sw}" filter="url(#sh)"/>`)
      if (p.es_control_critico) {
        o.push(`<rect x="${x}" y="${y}" width="5" height="${D.BOX_H}" rx="2" fill="${CRITICO}"/>`)
      }
    }

    // número de paso
    o.push(`<circle cx="${x + 16}" cy="${y - 2}" r="10.5" fill="${p.es_control_critico ? CRITICO : NEUTRO}"/>`)
    o.push(`<text x="${x + 16}" y="${y + 2.5}" font-size="10" font-weight="700" fill="#FFFFFF" text-anchor="middle">${esc(numPaso(c))}</text>`)

    // documento que el paso genera o exige (símbolo con esquina doblada)
    if (p.documento) {
      const dx = x + D.BOX_W - 21, dy = y - 11
      o.push(`<path d="M ${dx} ${dy} h 10 l 6 6 v 13 h -16 z" fill="#FFFFFF" stroke="#4A72A8" stroke-width="1.4"/>`)
      o.push(`<path d="M ${dx + 10} ${dy} v 6 h 6" fill="none" stroke="#4A72A8" stroke-width="1.4"/>`)
      o.push(`<line x1="${dx + 3}" y1="${dy + 10}" x2="${dx + 13}" y2="${dy + 10}" stroke="#4A72A8" stroke-width="1"/>`)
      o.push(`<line x1="${dx + 3}" y1="${dy + 14}" x2="${dx + 13}" y2="${dy + 14}" stroke="#4A72A8" stroke-width="1"/>`)
      o.push(`<text x="${dx - 5}" y="${y - 6}" font-size="8.5" font-style="italic" fill="#31537B" text-anchor="end">${esc(wrap(p.documento, chars(26), 1)[0])}</text>`)
    }

    const tags = []
    if (p.sistema) tags.push(p.sistema)
    if (p.control_tiempo) tags.push(p.control_tiempo)
    const parts = (p.participantes || []).filter(Boolean)
    const pieDoble = parts.length > 0 && !p.es_decision      // sistema + participantes al pie

    const maxChars = chars(p.es_decision ? 20 : 27)
    // con dos líneas al pie, la acción se recorta a 3 para que nada se pise
    const lines = wrap(p.accion, maxChars, pieDoble ? 3 : 4)
    const ty0 = cy - (lines.length - 1) * 7 - (p.sistema || p.control_tiempo ? 7 : 0) - (pieDoble ? 7 : 0)
    lines.forEach((l, k) => {
      o.push(`<text x="${cx}" y="${ty0 + k * 14 + 4}" font-size="11" fill="#0F172A" text-anchor="middle">${esc(l)}</text>`)
    })

    if (tags.length && !p.es_decision) {
      const t = wrap(tags.join(' · '), chars(38), 1)[0]
      o.push(`<text x="${cx}" y="${y + D.BOX_H - (parts.length ? 20 : 9)}" font-size="9" font-weight="600" fill="#64748B" text-anchor="middle">${esc(t)}</text>`)
    }
    // participantes: cargos que intervienen sin ser dueños del carril
    if (parts.length && !p.es_decision) {
      const t = wrap('con ' + parts.join(', '), chars(40), 1)[0]
      o.push(`<text x="${cx}" y="${y + D.BOX_H - 8}" font-size="8.5" font-style="italic" fill="#94A3B8" text-anchor="middle">${esc(t)}</text>`)
    }
    // el texto "NO →" bajo el rombo solo cuando la rama NO no tiene flecha propia
    if (p.es_decision && p.rama_no && !destinoDe(p.rama_no_destino, p.id)) {
      o.push(`<text x="${cx}" y="${y + D.BOX_H + 14}" font-size="9.5" font-weight="700" fill="${DECISION}" text-anchor="middle">NO → ${esc(wrap(p.rama_no, chars(30), 1)[0])}</text>`)
    }
    o.push('</g>')
  })

  /* Leyenda */
  if (!opts.sinLeyenda) {
    const ly = H - D.PAD - 16
    let lx = D.PAD
    const item = (dibujo, ancho, texto, anchoTexto) => {
      dibujo(lx)
      o.push(`<text x="${lx + ancho + 6}" y="${ly - 3}" font-size="10" fill="#64748B">${texto}</text>`)
      lx += ancho + 6 + anchoTexto + 22
    }
    item(x => o.push(`<rect x="${x}" y="${ly - 14}" width="26" height="13" rx="6.5" fill="#D5E8D4" stroke="#82B366" stroke-width="1.6"/>`), 26, 'Inicio / término', 76)
    item(x => o.push(`<rect x="${x}" y="${ly - 12}" width="16" height="10" rx="3" fill="#FFFFFF" stroke="${CRITICO}" stroke-width="2"/>`), 16, 'Control crítico', 72)
    item(x => o.push(`<polygon points="${x + 8},${ly - 14} ${x + 16},${ly - 7} ${x + 8},${ly} ${x},${ly - 7}" fill="#FFF2CC" stroke="#D6B656" stroke-width="1.6"/>`), 16, 'Punto de decisión', 86)
    item(x => {
      o.push(`<path d="M ${x} ${ly - 14} h 8 l 5 5 v 9 h -13 z" fill="${DOC_BG}" stroke="${DOC_BORDE}" stroke-width="1.3"/>`)
      o.push(`<path d="M ${x + 8} ${ly - 14} v 5 h 5" fill="none" stroke="${DOC_BORDE}" stroke-width="1.3"/>`)
    }, 13, 'Paso con documento', 96)
    item(x => o.push(`<path d="M ${x} ${ly - 7} h 26" fill="none" stroke="${DECISION}" stroke-width="1.8" stroke-dasharray="6 4" marker-end="url(#ard)"/>`), 26, 'Retorno o salto de la decisión', 140)
    o.push(`<text x="${W - D.PAD}" y="${ly - 3}" font-size="9.5" fill="#94A3B8" text-anchor="end">Generado por ERP Outlet · módulo Procesos</text>`)
  }

  o.push('</svg>')
  return o.join('\n')
}

/* ── draw.io ─────────────────────────────────────────────────────────────── */

export function flujoDrawio(proceso, fases, pasos, opts = {}) {
  const m = modeloFlujo(fases, pasos)
  const { cols, lanes, barras, idx, desvios } = m
  const LW = FLU.LANE_W, CW = FLU.COL_W, RH = FLU.ROW_H, PH = FLU.PHASE_H, TW = FLU.TERM_W
  const x0 = 40, y0 = 40
  const laneTop = y0 + PH + 10
  const cells = []
  let n = 1
  const nid = () => 'n' + (n++)

  // Barras de fase (corridas por la columna del INICIO)
  barras.forEach(b => {
    const x = x0 + LW + TW + b.desde * CW
    const w = (b.hasta - b.desde + 1) * CW
    cells.push(
      `<mxCell id="${nid()}" value="${escHtmlAttr(`<b>${b.faseIdx + 1}. ${b.fase.nombre.toUpperCase()}</b>`)}" `
      + `style="rounded=1;whiteSpace=wrap;html=1;fillColor=${b.color.bg};strokeColor=${b.color.tono};fontColor=${b.color.tono};fontSize=13;fontStyle=1;verticalAlign=middle;" `
      + `vertex="1" parent="1"><mxGeometry x="${x}" y="${y0}" width="${w}" height="${PH}" as="geometry"/></mxCell>`
    )
  })

  // Swimlanes (contenedores horizontales)
  const laneIds = []
  lanes.forEach((ln, i) => {
    const id = nid()
    laneIds.push(id)
    cells.push(
      `<mxCell id="${id}" value="${escHtmlAttr(ln.label)}" `
      + `style="swimlane;horizontal=0;startSize=${LW};html=1;whiteSpace=wrap;fillColor=#F5F5F5;strokeColor=#999999;`
      + `fontColor=#333333;fontSize=13;fontStyle=1;swimlaneFillColor=#FFFFFF;" `
      + `vertex="1" parent="1"><mxGeometry x="${x0}" y="${laneTop + i * RH}" width="${LW + TW * 2 + cols.length * CW}" height="${RH}" as="geometry"/></mxCell>`
    )
  })

  // Pasos
  const pasoIds = []
  cols.forEach((c, i) => {
    const p = c.paso
    const id = nid()
    pasoIds.push(id)
    const relX = LW + TW + i * CW + (CW - FLU.BOX_W) / 2
    const relY = (RH - FLU.BOX_H) / 2
    const label = `<b>${c.faseIdx + 1}.${p.orden}</b> ${p.accion}`
      + (p.sistema || p.control_tiempo
        ? `<br/><font color="#64748B" style="font-size:10px">${[p.sistema, p.control_tiempo].filter(Boolean).join(' · ')}</font>`
        : '')
      + (p.documento
        ? `<br/><font color="#31537B" style="font-size:10px">📄 ${p.documento}</font>`
        : '')
    const fondoPaso = p.documento ? DOC_BG : '#FFFFFF'
    const bordePaso = p.documento ? DOC_BORDE : '#4D4D4D'
    const style = p.es_decision
      ? `rhombus;whiteSpace=wrap;html=1;fillColor=#FFF2CC;strokeColor=#D6B656;strokeWidth=2;fontSize=11;align=center;`
      : p.es_control_critico
        ? `whiteSpace=wrap;html=1;fillColor=${fondoPaso};strokeColor=${CRITICO};strokeWidth=3;fontSize=11;align=center;`
        : `whiteSpace=wrap;html=1;fillColor=${fondoPaso};strokeColor=${bordePaso};strokeWidth=1;fontSize=11;align=center;`
    cells.push(
      `<mxCell id="${id}" value="${escHtmlAttr(label)}" style="${style}" vertex="1" parent="${laneIds[c.lane]}">`
      + `<mxGeometry x="${relX}" y="${relY}" width="${FLU.BOX_W}" height="${FLU.BOX_H}" as="geometry"/></mxCell>`
    )
  })

  // Terminadores INICIO y FIN
  const iniId = nid()
  cells.push(
    `<mxCell id="${iniId}" value="INICIO" style="ellipse;html=1;fillColor=#D5E8D4;strokeColor=#82B366;strokeWidth=2;fontSize=11;fontStyle=1;fontColor=#1F5B24;" `
    + `vertex="1" parent="${laneIds[cols[0].lane]}"><mxGeometry x="${LW + (TW - 84) / 2}" y="${(RH - 36) / 2}" width="84" height="36" as="geometry"/></mxCell>`
  )
  const finId = nid()
  cells.push(
    `<mxCell id="${finId}" value="FIN" style="ellipse;html=1;fillColor=#F8CECC;strokeColor=${CRITICO};strokeWidth=3;fontSize=11;fontStyle=1;fontColor=#7C2B25;" `
    + `vertex="1" parent="${laneIds[cols[cols.length - 1].lane]}"><mxGeometry x="${LW + TW + cols.length * CW + (TW - 76) / 2}" y="${(RH - 36) / 2}" width="76" height="36" as="geometry"/></mxCell>`
  )
  cells.push(
    `<mxCell id="${nid()}" style="edgeStyle=orthogonalEdgeStyle;html=1;strokeColor=#82B366;strokeWidth=1.5;" edge="1" parent="1" source="${iniId}" target="${pasoIds[0]}"><mxGeometry relative="1" as="geometry"/></mxCell>`
  )
  cells.push(
    `<mxCell id="${nid()}" style="edgeStyle=orthogonalEdgeStyle;html=1;strokeColor=${CRITICO};strokeWidth=1.5;" edge="1" parent="1" source="${pasoIds[pasoIds.length - 1]}" target="${finId}"><mxGeometry relative="1" as="geometry"/></mxCell>`
  )

  // Conectores secuenciales (con la misma regla de ramas que el SVG)
  for (let i = 0; i < cols.length - 1; i++) {
    const pa = cols[i].paso
    let lbl = ''
    if (pa.es_decision) {
      const siDest = pa.rama_si_destino && idx.has(pa.rama_si_destino) ? idx.get(pa.rama_si_destino) : null
      const noDest = pa.rama_no_destino && idx.has(pa.rama_no_destino) ? idx.get(pa.rama_no_destino) : null
      const siSigue = siDest === null || siDest === i + 1
      if (siSigue) lbl = pa.rama_si || 'SÍ'
      else if (noDest === i + 1 || noDest === null) lbl = pa.rama_no || 'NO'
      else continue
    }
    const crit = cols[i].paso.es_control_critico || cols[i + 1].paso.es_control_critico
    cells.push(
      `<mxCell id="${nid()}" value="${escHtmlAttr(lbl)}" `
      + `style="edgeStyle=orthogonalEdgeStyle;curved=1;html=1;rounded=1;strokeColor=${crit ? CRITICO : '#4D4D4D'};strokeWidth=${crit ? 2 : 1.5};fontSize=10;" `
      + `edge="1" parent="1" source="${pasoIds[i]}" target="${pasoIds[i + 1]}"><mxGeometry relative="1" as="geometry"/></mxCell>`
    )
  }

  // Desvíos: retornos y saltos de decisión
  desvios.forEach(dv => {
    if (dv.to === null) return
    const retorno = dv.to < dv.from
    const lbl = `${dv.tipo === 'no' ? 'NO' : 'SÍ'} → ${retorno ? 'vuelve a' : 'sigue en'} ${cols[dv.to].faseIdx + 1}.${cols[dv.to].paso.orden}`
    cells.push(
      `<mxCell id="${nid()}" value="${escHtmlAttr(lbl)}" `
      + `style="edgeStyle=orthogonalEdgeStyle;html=1;rounded=1;dashed=1;strokeColor=${DECISION};strokeWidth=2;fontSize=10;fontColor=${DECISION};exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=1;entryDx=0;entryDy=0;" `
      + `edge="1" parent="1" source="${pasoIds[dv.from]}" target="${pasoIds[dv.to]}"><mxGeometry relative="1" as="geometry"/></mxCell>`
    )
  })

  // Título
  cells.push(
    `<mxCell id="${nid()}" value="${escHtmlAttr(`<b>${proceso.id} · ${proceso.nombre}</b><br/><font style="font-size:10px">Outlet de Puertas SpA · ${opts.version || 'Borrador v0.1'}</font>`)}" `
    + `style="text;html=1;align=left;verticalAlign=middle;fontSize=15;fontColor=#16213E;" vertex="1" parent="1">`
    + `<mxGeometry x="${x0}" y="${y0 - 46}" width="700" height="40" as="geometry"/></mxCell>`
  )

  return `<mxfile host="ERP Outlet" modified="${opts.fecha || ''}" agent="modulo-procesos" version="21.0.0">
  <diagram id="${esc(proceso.id)}" name="${esc(proceso.id + ' ' + proceso.nombre).slice(0, 60)}">
    <mxGraphModel dx="1400" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`
}
