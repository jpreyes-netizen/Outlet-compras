// src/procesos/prcFlujo.js
// ─────────────────────────────────────────────────────────────────────────────
// Motor de flujogramas swimlane de Outlet de Puertas.
// Una sola fuente de verdad: los mismos datos (prc_fases + prc_pasos) generan
// el SVG que se ve dentro de la app y el XML de draw.io que se descarga.
//
// Convención visual (tomada del flujograma de Gestión de Inventario, que es el
// estándar interno): swimlanes horizontales por rol con color de fondo propio,
// barras de fase de color arriba, controles críticos en rojo, rombos para
// decisiones, conectores ortogonales.
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
  FONT: '-apple-system, BlinkMacSystemFont, Segoe UI, Inter, system-ui, sans-serif'
}

// Paleta de swimlanes — tonos suaves, alto contraste con el texto
const LANE_PALETTE = [
  { bg: '#EEF2FF', border: '#C7D2FE', text: '#3730A3' },
  { bg: '#ECFDF5', border: '#A7F3D0', text: '#065F46' },
  { bg: '#FFF7ED', border: '#FED7AA', text: '#9A3412' },
  { bg: '#F5F3FF', border: '#DDD6FE', text: '#5B21B6' },
  { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B' },
  { bg: '#F0F9FF', border: '#BAE6FD', text: '#075985' },
  { bg: '#FDF2F8', border: '#FBCFE8', text: '#9D174D' },
  { bg: '#F7FEE7', border: '#D9F99D', text: '#3F6212' }
]

const PHASE_PALETTE = [
  '#1E3A8A', '#065F46', '#9A3412', '#5B21B6',
  '#9D174D', '#0F766E', '#7C2D12', '#334155'
]

const CRITICO = '#DC2626'
const DECISION = '#D97706'
const NEUTRO = '#334155'

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
 *                         control_tiempo, es_control_critico, es_decision, rama_si, rama_no}]
 */
export function modeloFlujo(fases, pasos) {
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
    barras.push({
      fase: f, faseIdx: fi, desde, hasta: cols.length - 1,
      color: f.color || PHASE_PALETTE[fi % PHASE_PALETTE.length]
    })
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

  const W = FLU.PAD * 2 + FLU.LANE_W + cols.length * FLU.COL_W
  const H = FLU.PAD * 2 + FLU.TITLE_H + FLU.PHASE_H + lanes.length * FLU.ROW_H + 34

  return { fases: fs, cols, lanes, barras, W, H }
}

const cellX = i => FLU.PAD + FLU.LANE_W + i * FLU.COL_W
const cellY = (lane, nLanes) => FLU.PAD + FLU.TITLE_H + FLU.PHASE_H + lane * FLU.ROW_H

/* ── SVG ─────────────────────────────────────────────────────────────────── */

export function flujoSVG(proceso, fases, pasos, opts = {}) {
  const { interactivo, selId, selFase } = opts
  const SEL = '#4F46E5'
  const m = modeloFlujo(fases, pasos)
  if (!m.cols.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="90"><text x="16" y="50" `
      + `font-family="${FLU.FONT}" font-size="14" fill="#8E8E93">Sin pasos definidos para este proceso.</text></svg>`
  }
  const { cols, lanes, barras, W, H } = m
  const o = []

  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FLU.FONT}">`)
  o.push(`<defs>
    <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748B"/>
    </marker>
    <marker id="arc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${CRITICO}"/>
    </marker>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.6" flood-color="#0F172A" flood-opacity="0.10"/>
    </filter>
  </defs>`)
  o.push(`<rect width="${W}" height="${H}" fill="#FFFFFF"/>`)

  /* Título */
  const tx = FLU.PAD, ty = FLU.PAD
  o.push(`<rect x="${tx}" y="${ty}" width="${W - FLU.PAD * 2}" height="${FLU.TITLE_H - 12}" rx="10" fill="#16213E"/>`)
  o.push(`<text x="${tx + 18}" y="${ty + 21}" font-size="13.5" font-weight="700" fill="#FFFFFF">${esc(proceso.id)} · ${esc(proceso.nombre)}</text>`)
  o.push(`<text x="${tx + 18}" y="${ty + 38}" font-size="10.5" fill="#B9C0D4">Flujograma swimlane · Outlet de Puertas SpA · ${esc(opts.version || 'Borrador v0.1')}${opts.fecha ? ' · ' + esc(opts.fecha) : ''}</text>`)

  /* Barras de fase */
  const py = FLU.PAD + FLU.TITLE_H
  o.push(`<rect x="${FLU.PAD}" y="${py}" width="${FLU.LANE_W}" height="${FLU.PHASE_H}" rx="8" fill="#F1F5F9"/>`)
  o.push(`<text x="${FLU.PAD + 14}" y="${py + 28}" font-size="11" font-weight="700" fill="#64748B">FASES →</text>`)
  barras.forEach(b => {
    const x = cellX(b.desde) + 4
    const w = (b.hasta - b.desde + 1) * FLU.COL_W - 8
    o.push(`<g data-fase="${esc(b.fase.id)}"${interactivo ? ' style="cursor:pointer"' : ''}>`)
    o.push(`<rect x="${x}" y="${py}" width="${w}" height="${FLU.PHASE_H}" rx="8" fill="${b.color}"/>`)
    if (selFase && selFase === b.fase.id) {
      o.push(`<rect x="${x - 3}" y="${py - 3}" width="${w + 6}" height="${FLU.PHASE_H + 6}" rx="10" fill="none" stroke="${SEL}" stroke-width="3" stroke-dasharray="6 4"/>`)
    }
    const label = `${b.faseIdx + 1}. ${b.fase.nombre}`.toUpperCase()
    o.push(`<text x="${x + w / 2}" y="${py + 27}" font-size="11.5" font-weight="700" fill="#FFFFFF" text-anchor="middle">${esc(wrap(label, Math.floor(w / 7.2), 1)[0] || '')}</text>`)
    o.push('</g>')
  })

  /* Swimlanes */
  lanes.forEach((ln, i) => {
    const y = cellY(i, lanes.length)
    o.push(`<rect x="${FLU.PAD}" y="${y}" width="${W - FLU.PAD * 2}" height="${FLU.ROW_H}" fill="${ln.bg}" stroke="${ln.border}" stroke-width="1"/>`)
    o.push(`<rect x="${FLU.PAD}" y="${y}" width="${FLU.LANE_W}" height="${FLU.ROW_H}" fill="${ln.border}" fill-opacity="0.55" stroke="${ln.border}"/>`)
    const lines = wrap(ln.label, 20, 3)
    const y0 = y + FLU.ROW_H / 2 - (lines.length - 1) * 8
    lines.forEach((l, k) => {
      o.push(`<text x="${FLU.PAD + FLU.LANE_W / 2}" y="${y0 + k * 16 + 5}" font-size="11.5" font-weight="700" fill="${ln.text}" text-anchor="middle">${esc(l)}</text>`)
    })
  })

  /* Separadores verticales de fase */
  barras.forEach((b, i) => {
    if (i === 0) return
    const x = cellX(b.desde)
    o.push(`<line x1="${x}" y1="${py + FLU.PHASE_H}" x2="${x}" y2="${H - FLU.PAD - 34}" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4 4"/>`)
  })

  /* Conectores (debajo de las cajas) */
  for (let i = 0; i < cols.length - 1; i++) {
    const a = cols[i], b = cols[i + 1]
    const ax = cellX(i) + FLU.COL_W / 2, ay = cellY(a.lane, lanes.length) + FLU.ROW_H / 2
    const bx = cellX(i + 1) + FLU.COL_W / 2, by = cellY(b.lane, lanes.length) + FLU.ROW_H / 2
    const x1 = ax + FLU.BOX_W / 2, x2 = bx - FLU.BOX_W / 2
    const crit = a.paso.es_control_critico || b.paso.es_control_critico
    const stroke = crit ? CRITICO : '#64748B'
    const mk = crit ? 'arc' : 'ar'
    let d
    if (a.lane === b.lane) {
      d = `M ${x1} ${ay} L ${x2} ${by}`
    } else {
      const mid = (x1 + x2) / 2
      const r = 10, dir = by > ay ? 1 : -1
      d = `M ${x1} ${ay} L ${mid - r} ${ay} Q ${mid} ${ay} ${mid} ${ay + r * dir} `
        + `L ${mid} ${by - r * dir} Q ${mid} ${by} ${mid + r} ${by} L ${x2} ${by}`
    }
    o.push(`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.6" marker-end="url(#${mk})"/>`)
    if (a.paso.es_decision && a.paso.rama_si) {
      o.push(`<text x="${x1 + 10}" y="${ay - 7}" font-size="9.5" font-weight="700" fill="${DECISION}">${esc(a.paso.rama_si)}</text>`)
    }
  }

  /* Cajas */
  cols.forEach((c, i) => {
    const p = c.paso
    const cx = cellX(i) + FLU.COL_W / 2
    const cy = cellY(c.lane, lanes.length) + FLU.ROW_H / 2
    const x = cx - FLU.BOX_W / 2, y = cy - FLU.BOX_H / 2
    const stroke = p.es_control_critico ? CRITICO : p.es_decision ? DECISION : '#CBD5E1'
    const sw = p.es_control_critico ? 2.2 : p.es_decision ? 1.8 : 1.2

    o.push(`<g data-paso="${esc(p.id)}"${interactivo ? ' style="cursor:pointer"' : ''}>`)
    if (selId && selId === p.id) {
      o.push(`<rect x="${x - 6}" y="${y - 6}" width="${FLU.BOX_W + 12}" height="${FLU.BOX_H + 12}" rx="14" fill="${SEL}12" stroke="${SEL}" stroke-width="3" stroke-dasharray="7 4"/>`)
    }
    if (p.es_decision) {
      o.push(`<polygon points="${cx},${y} ${cx + FLU.BOX_W / 2},${cy} ${cx},${y + FLU.BOX_H} ${cx - FLU.BOX_W / 2},${cy}" `
        + `fill="#FFFBEB" stroke="${stroke}" stroke-width="${sw}" filter="url(#sh)"/>`)
    } else {
      o.push(`<rect x="${x}" y="${y}" width="${FLU.BOX_W}" height="${FLU.BOX_H}" rx="10" fill="#FFFFFF" stroke="${stroke}" stroke-width="${sw}" filter="url(#sh)"/>`)
      if (p.es_control_critico) {
        o.push(`<rect x="${x}" y="${y}" width="5" height="${FLU.BOX_H}" rx="2.5" fill="${CRITICO}"/>`)
      }
    }

    // número de paso
    o.push(`<circle cx="${x + 16}" cy="${y - 2}" r="10.5" fill="${p.es_control_critico ? CRITICO : NEUTRO}"/>`)
    o.push(`<text x="${x + 16}" y="${y + 2.5}" font-size="10" font-weight="700" fill="#FFFFFF" text-anchor="middle">${c.faseIdx + 1}.${p.orden}</text>`)

    const maxChars = p.es_decision ? 20 : 27
    const lines = wrap(p.accion, maxChars, 4)
    const ty0 = cy - (lines.length - 1) * 7 - (p.sistema || p.control_tiempo ? 7 : 0)
    lines.forEach((l, k) => {
      o.push(`<text x="${cx}" y="${ty0 + k * 14 + 4}" font-size="11" fill="#0F172A" text-anchor="middle">${esc(l)}</text>`)
    })

    const tags = []
    if (p.sistema) tags.push(p.sistema)
    if (p.control_tiempo) tags.push(p.control_tiempo)
    if (tags.length && !p.es_decision) {
      const t = wrap(tags.join(' · '), 38, 1)[0]
      o.push(`<text x="${cx}" y="${y + FLU.BOX_H - 9}" font-size="9" font-weight="600" fill="#64748B" text-anchor="middle">${esc(t)}</text>`)
    }
    if (p.es_decision && p.rama_no) {
      o.push(`<text x="${cx}" y="${y + FLU.BOX_H + 14}" font-size="9.5" font-weight="700" fill="${DECISION}" text-anchor="middle">NO → ${esc(wrap(p.rama_no, 28, 1)[0])}</text>`)
    }
    o.push('</g>')
  })

  /* Leyenda */
  const ly = H - FLU.PAD - 16
  o.push(`<rect x="${FLU.PAD}" y="${ly - 12}" width="16" height="10" rx="3" fill="#FFFFFF" stroke="${CRITICO}" stroke-width="2"/>`)
  o.push(`<text x="${FLU.PAD + 22}" y="${ly - 3}" font-size="10" fill="#64748B">Control crítico</text>`)
  o.push(`<polygon points="${FLU.PAD + 130},${ly - 13} ${FLU.PAD + 143},${ly - 7} ${FLU.PAD + 130},${ly - 1} ${FLU.PAD + 117},${ly - 7}" fill="#FFFBEB" stroke="${DECISION}" stroke-width="1.6"/>`)
  o.push(`<text x="${FLU.PAD + 150}" y="${ly - 3}" font-size="10" fill="#64748B">Punto de decisión</text>`)
  o.push(`<text x="${W - FLU.PAD}" y="${ly - 3}" font-size="9.5" fill="#94A3B8" text-anchor="end">Generado por ERP Outlet · módulo Procesos</text>`)

  o.push('</svg>')
  return o.join('\n')
}

/* ── draw.io ─────────────────────────────────────────────────────────────── */

export function flujoDrawio(proceso, fases, pasos, opts = {}) {
  const m = modeloFlujo(fases, pasos)
  const { cols, lanes, barras } = m
  const LW = FLU.LANE_W, CW = FLU.COL_W, RH = FLU.ROW_H, PH = FLU.PHASE_H
  const x0 = 40, y0 = 40
  const laneTop = y0 + PH + 10
  const cells = []
  let n = 1
  const nid = () => 'n' + (n++)

  // Barras de fase
  barras.forEach(b => {
    const x = x0 + LW + b.desde * CW
    const w = (b.hasta - b.desde + 1) * CW
    cells.push(
      `<mxCell id="${nid()}" value="${escHtmlAttr(`<b>${b.faseIdx + 1}. ${b.fase.nombre.toUpperCase()}</b>`)}" `
      + `style="rounded=1;whiteSpace=wrap;html=1;fillColor=${b.color};strokeColor=none;fontColor=#FFFFFF;fontSize=13;fontStyle=1;verticalAlign=middle;" `
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
      + `style="swimlane;horizontal=0;startSize=${LW};html=1;whiteSpace=wrap;fillColor=${ln.bg};strokeColor=${ln.border};`
      + `fontColor=${ln.text};fontSize=13;fontStyle=1;swimlaneFillColor=${ln.bg};" `
      + `vertex="1" parent="1"><mxGeometry x="${x0}" y="${laneTop + i * RH}" width="${LW + cols.length * CW}" height="${RH}" as="geometry"/></mxCell>`
    )
  })

  // Pasos
  const pasoIds = []
  cols.forEach((c, i) => {
    const p = c.paso
    const id = nid()
    pasoIds.push(id)
    const relX = LW + i * CW + (CW - FLU.BOX_W) / 2
    const relY = (RH - FLU.BOX_H) / 2
    const label = `<b>${c.faseIdx + 1}.${p.orden}</b> ${p.accion}`
      + (p.sistema || p.control_tiempo
        ? `<br/><font color="#64748B" style="font-size:10px">${[p.sistema, p.control_tiempo].filter(Boolean).join(' · ')}</font>`
        : '')
    const style = p.es_decision
      ? `rhombus;whiteSpace=wrap;html=1;fillColor=#FFFBEB;strokeColor=${DECISION};strokeWidth=2;fontSize=11;align=center;`
      : p.es_control_critico
        ? `rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=${CRITICO};strokeWidth=3;fontSize=11;align=center;`
        : `rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#CBD5E1;strokeWidth=1;fontSize=11;align=center;`
    cells.push(
      `<mxCell id="${id}" value="${escHtmlAttr(label)}" style="${style}" vertex="1" parent="${laneIds[c.lane]}">`
      + `<mxGeometry x="${relX}" y="${relY}" width="${FLU.BOX_W}" height="${FLU.BOX_H}" as="geometry"/></mxCell>`
    )
  })

  // Conectores
  for (let i = 0; i < cols.length - 1; i++) {
    const crit = cols[i].paso.es_control_critico || cols[i + 1].paso.es_control_critico
    const lbl = cols[i].paso.es_decision && cols[i].paso.rama_si ? cols[i].paso.rama_si : ''
    cells.push(
      `<mxCell id="${nid()}" value="${escHtmlAttr(lbl)}" `
      + `style="edgeStyle=orthogonalEdgeStyle;curved=1;html=1;rounded=1;strokeColor=${crit ? CRITICO : '#64748B'};strokeWidth=${crit ? 2 : 1.5};fontSize=10;" `
      + `edge="1" parent="1" source="${pasoIds[i]}" target="${pasoIds[i + 1]}"><mxGeometry relative="1" as="geometry"/></mxCell>`
    )
  }

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
