// src/rrhh/asistencia/lib/xlsxEstilo.js
// ═══════════════════════════════════════════════════════════════════════════
// EXCEL CON FORMATO (26-11-2026)
// La versión de SheetJS del proyecto (xlsx 0.18.5, edición comunitaria) no
// escribe estilos: sin negritas, colores, bordes ni paneles inmovilizados.
// Este módulo arma el archivo .xlsx (OOXML) directamente y lo comprime con el
// zip que trae la misma librería (XLSX.CFB). No agrega dependencias.
//
// Hoja: { nombre, filas, anchos, altos, combinar, congelar, filtro, repetir,
//         sinCuadricula, vertical }
//   filas    [[celda, …], …]   (null = fila o celda vacía)
//   anchos   [n, …]            ancho de cada columna en caracteres
//   altos    { iFila: pt }     alto de filas puntuales (índice 0)
//   combinar ['A1:F1', …]
//   congelar { filas, cols }   filas/columnas inmovilizadas
//   filtro   'A5:Z90'          rango del autofiltro (encabezado + datos)
//   repetir  [ini, fin]        filas de título al imprimir (1 = primera)
//   vertical true = hoja vertical al imprimir (por defecto, horizontal)
// Celda: valor directo (texto, número, booleano, Date) o { v, s, f }
//   v valor · s estilo · f fórmula sin '=' (v queda como valor calculado)
// Estilo: { b, i, sz, color, fill, fmt, h, v, wrap, borde, ind }
//   color/fill 'RRGGBB' · fmt formato numérico ('#,##0', 'dd-mm-yyyy',
//   'hh:mm', '[h]:mm', …) · h 'left'|'center'|'right' · v 'top'|'center'
//   borde 'fino' | 'total' | 'cab'
// Las fechas y horas van como número de Excel (ver serialFecha / serialHora)
// para que se puedan ordenar, filtrar y sumar.
// ═══════════════════════════════════════════════════════════════════════════
import * as XLSX from 'xlsx'

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml'
export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Texto seguro para XML: sin caracteres de control (Workera y las
// justificaciones a veces los traen) y con las entidades escapadas.
const esc = s => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const colLetra = i => {
  let s = '', n = i + 1
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}
const absRef = ref => String(ref).replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')
const nombreHoja = s => String(s || 'Hoja').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Hoja'
const refHoja = n => `'${n.replace(/'/g, "''")}'`

// Fecha 'YYYY-MM-DD' → número de Excel (días desde 30-12-1899)
const BASE = Date.UTC(1899, 11, 30)
export const serialFecha = iso => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return (Date.UTC(y, m - 1, d) - BASE) / 86400000
}
// Fecha y hora local de un Date (o texto ISO) → número de Excel
export const serialFechaHora = x => {
  const t = x instanceof Date ? x : new Date(x)
  if (Number.isNaN(t.getTime())) return null
  return (Date.UTC(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds()) - BASE) / 86400000
}
// Minutos (del día o de duración) → fracción de día, para formatos hh:mm / [h]:mm
export const serialHora = min => (min == null || Number.isNaN(min)) ? null : min / 1440

const GRIS = 'D9D9DE', AZUL = '16213E'
const lado = (t, c) => `<${t} style="thin"><color rgb="FF${c}"/></${t}>`
const BORDES = {
  fino:  `<border>${lado('left', GRIS)}${lado('right', GRIS)}${lado('top', GRIS)}${lado('bottom', GRIS)}<diagonal/></border>`,
  total: `<border><left/><right/>${lado('top', AZUL)}${lado('bottom', AZUL)}<diagonal/></border>`,
  cab:   `<border>${lado('left', '3A4466')}${lado('right', '3A4466')}${lado('top', '3A4466')}${lado('bottom', '3A4466')}<diagonal/></border>`,
}
const FMT_STD = { 'General':0, '0':1, '0.00':2, '#,##0':3, '#,##0.00':4, '0%':9, '0.00%':10 }

// Registro de estilos: cada combinación distinta se escribe una sola vez
function registroEstilos() {
  const fonts = ['<font><sz val="10"/><color rgb="FF1C1C1E"/><name val="Calibri"/><family val="2"/></font>']
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>']
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
  const fmts = new Map()
  const mapa = arr => new Map(arr.map((x, i) => [x, i]))
  const mF = mapa(fonts), mL = mapa(fills), mB = mapa(borders), mX = mapa(xfs)
  const add = (arr, m, xml) => { let i = m.get(xml); if (i == null) { i = arr.length; arr.push(xml); m.set(xml, i) } return i }
  const fmtId = f => {
    if (!f) return 0
    if (FMT_STD[f] != null) return FMT_STD[f]
    if (!fmts.has(f)) fmts.set(f, 164 + fmts.size)
    return fmts.get(f)
  }
  const cache = new Map()
  function id(st) {
    if (!st) return 0
    if (cache.has(st)) return cache.get(st)
    const col = String(st.color || '1C1C1E').toUpperCase()
    const fontId = add(fonts, mF, `<font>${st.b ? '<b/>' : ''}${st.i ? '<i/>' : ''}<sz val="${st.sz || 10}"/><color rgb="FF${col}"/><name val="Calibri"/><family val="2"/></font>`)
    const fillId = st.fill ? add(fills, mL, `<fill><patternFill patternType="solid"><fgColor rgb="FF${String(st.fill).toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`) : 0
    const borderId = st.borde && BORDES[st.borde] ? add(borders, mB, BORDES[st.borde]) : 0
    const numFmtId = fmtId(st.fmt)
    const al = `<alignment${st.h ? ` horizontal="${st.h}"` : ''} vertical="${st.v || 'center'}"${st.wrap ? ' wrapText="1"' : ''}${st.ind ? ` indent="${st.ind}"` : ''}/>`
    const x = add(xfs, mX, `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
      ` applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`)
    cache.set(st, x)
    return x
  }
  function xml() {
    const nf = fmts.size ? `<numFmts count="${fmts.size}">${[...fmts].map(([f, i]) => `<numFmt numFmtId="${i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : ''
    return XML + `<styleSheet xmlns="${NS}">${nf}` +
      `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
      `<fills count="${fills.length}">${fills.join('')}</fills>` +
      `<borders count="${borders.length}">${borders.join('')}</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `<dxfs count="0"/><tableStyles count="0"/></styleSheet>`
  }
  return { id, xml }
}

function celdaXML(c, ref, est) {
  const cel = c !== null && typeof c === 'object' && !(c instanceof Date) ? c : { v: c }
  const s = est.id(cel.s), sa = s ? ` s="${s}"` : ''
  let v = cel.v
  if (v instanceof Date) v = serialFechaHora(v)
  if (typeof v === 'number' && !Number.isFinite(v)) v = null
  if (cel.f) {
    const res = typeof v === 'number' ? `<v>${v}</v>` : v != null && v !== '' ? `<v>${esc(v)}</v>` : ''
    return `<c r="${ref}"${sa}${typeof v === 'string' ? ' t="str"' : ''}><f>${esc(cel.f)}</f>${res}</c>`
  }
  if (v == null || v === '') return s ? `<c r="${ref}"${sa}/>` : ''
  if (typeof v === 'number') return `<c r="${ref}"${sa}><v>${v}</v></c>`
  if (typeof v === 'boolean') return `<c r="${ref}"${sa} t="b"><v>${v ? 1 : 0}</v></c>`
  return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(String(v).slice(0, 32000))}</t></is></c>`
}

function hojaXML(h, est, i) {
  const filas = h.filas || []
  let maxC = 1
  const rows = filas.map((fila, r) => {
    const ht = h.altos?.[r]
    const cs = (fila || []).map((c, ci) => {
      if (c === undefined || c === null) return ''
      maxC = Math.max(maxC, ci + 1)
      return celdaXML(c, colLetra(ci) + (r + 1), est)
    }).join('')
    if (!cs && !ht) return ''
    return `<row r="${r + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cs}</row>`
  }).join('')

  const cg = h.congelar || {}
  const x = cg.cols || 0, y = cg.filas || 0
  let pane = ''
  if (x || y) {
    const tl = colLetra(x) + (y + 1)
    const ap = x && y ? 'bottomRight' : y ? 'bottomLeft' : 'topRight'
    pane = `<pane${x ? ` xSplit="${x}"` : ''}${y ? ` ySplit="${y}"` : ''} topLeftCell="${tl}" activePane="${ap}" state="frozen"/>` +
      `<selection pane="${ap}" activeCell="${tl}" sqref="${tl}"/>`
  }
  const cols = (h.anchos || []).map((w, ci) => w ? `<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>` : '').join('')
  const comb = (h.combinar || [])
  return XML + `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<dimension ref="A1:${colLetra(maxC - 1)}${Math.max(filas.length, 1)}"/>` +
    `<sheetViews><sheetView${i === 0 ? ' tabSelected="1"' : ''}${h.sinCuadricula ? ' showGridLines="0"' : ''} workbookViewId="0">${pane}</sheetView></sheetViews>` +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rows}</sheetData>` +
    (h.filtro ? `<autoFilter ref="${h.filtro}"/>` : '') +
    (comb.length ? `<mergeCells count="${comb.length}">${comb.map(r => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>` : '') +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup orientation="${h.vertical ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>` +
    `</worksheet>`
}

// Arma el libro completo y lo devuelve como Blob listo para descargar
export function xlsxBlob(hojas, props = {}) {
  const est = registroEstilos()
  const usados = new Set()
  const hs = hojas.map(h => {
    let n = nombreHoja(h.nombre), k = 2
    while (usados.has(n.toLowerCase())) n = `${nombreHoja(h.nombre).slice(0, 28)} ${k++}`
    usados.add(n.toLowerCase())
    return { ...h, nombre: n }
  })
  const sheets = hs.map((h, i) => hojaXML(h, est, i))   // antes que styles: registra los estilos usados

  const nombres = []
  hs.forEach((h, i) => {
    if (h.filtro) nombres.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(refHoja(h.nombre))}!${absRef(h.filtro)}</definedName>`)
    if (h.repetir) nombres.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(refHoja(h.nombre))}!$${h.repetir[0]}:$${h.repetir[1]}</definedName>`)
  })
  const ahora = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const partes = [
    ['[Content_Types].xml', XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>` +
      hs.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>`).join('') +
      `<Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `</Types>`],
    ['_rels/.rels', XML + `<Relationships xmlns="${NS_PKG}">` +
      `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `</Relationships>`],
    ['docProps/core.xml', XML + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
      `xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      (props.titulo ? `<dc:title>${esc(props.titulo)}</dc:title>` : '') +
      `<dc:creator>${esc(props.autor || 'ERP Outlet de Puertas')}</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${ahora}</dcterms:created>` +
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${ahora}</dcterms:modified>` +
      `</cp:coreProperties>`],
    ['xl/workbook.xml', XML + `<workbook xmlns="${NS}" xmlns:r="${NS_R}"><workbookPr/>` +
      `<bookViews><workbookView activeTab="0"/></bookViews>` +
      `<sheets>${hs.map((h, i) => `<sheet name="${esc(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
      (nombres.length ? `<definedNames>${nombres.join('')}</definedNames>` : '') +
      `<calcPr calcId="191029"/></workbook>`],
    ['xl/_rels/workbook.xml.rels', XML + `<Relationships xmlns="${NS_PKG}">` +
      hs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${hs.length + 1}" Type="${NS_R}/styles" Target="styles.xml"/>` +
      `</Relationships>`],
    ['xl/styles.xml', est.xml()],
    ...sheets.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x]),
  ]
  const { CFB } = XLSX
  const zip = CFB.utils.cfb_new()
  const enc = new TextEncoder()
  for (const [ruta, xml] of partes) CFB.utils.cfb_add(zip, ruta, enc.encode(xml))
  const bin = CFB.write(zip, { fileType: 'zip', type: 'array', compression: true })
  return new Blob([bin], { type: MIME_XLSX })
}

export function descargarXLSX(hojas, archivo, props) {
  const url = URL.createObjectURL(xlsxBlob(hojas, props))
  const a = document.createElement('a')
  a.href = url; a.download = archivo
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
