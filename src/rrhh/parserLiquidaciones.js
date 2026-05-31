/* ═══════════════════════════════════════════════════════════════════
   src/rrhh/parserLiquidaciones.js
   Parser PDF Liquidaciones individuales Contaline
   Validado contra 50 liquidaciones reales (04/2026) — 50/50 cuadran
   Estrategia: corte por columna X para separar haberes/descuentos
   de la columna "otros antecedentes" (derecha).
   ═══════════════════════════════════════════════════════════════════ */

import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

// Códigos conocidos del catálogo (se actualiza cuando se agregan glosas nuevas al catálogo SQL).
// Solo se usa para el aviso de "glosa desconocida" en el preview — NO afecta la captura de montos.
const CODIGOS_CATALOGO = new Set([
  51,54,55,59,64,66,73,74,75,76,79,83,84,89,90,
  100,101,104,106,107,123,130,133,134,146,169,303,304
])
const ES_GLOSA = c => CODIGOS_CATALOGO.has(c)

// Cortes de columna (coordenada X del PDF, ancho 612)
const X_HABER = [190, 245]
const X_DESC  = [250, 320]
const X_COD_MAX = 90   // códigos de glosa están a la izquierda

const n = s => {
  if (!s) return 0
  const c = String(s).replace(/\./g, '').replace(/,/g, '')
  const v = parseInt(c, 10)
  return isNaN(v) ? 0 : v
}

// Reconstruye líneas de una página usando posición Y, conservando X de cada token
function lineasConX(items) {
  const map = new Map()
  for (const it of items) {
    const y = Math.round(it.transform[5])
    if (!map.has(y)) map.set(y, [])
    map.get(y).push({ x: it.transform[4], str: it.str.trim() })
  }
  // top-down
  return [...map.keys()].sort((a,b)=>b-a).map(y => map.get(y).sort((a,b)=>a.x-b.x))
}

// Extrae cabecera de la página (texto plano concatenado)
function parseCabecera(texto) {
  const out = {}
  let m = texto.match(/NOMBRE\s*:\s*(.+?)\s+RUT\s*:\s*([\dkK.\-]+)/)
  if (m) { out.nombre = m[1].trim(); out.rut = m[2].trim() }
  m = texto.match(/CÓDIGO\s*:\s*(\d+)/)
  if (m) out.cod_contaline = parseInt(m[1], 10)
  m = texto.match(/CARGO\s*:\s*(.+?)\s+CÓDIGO/)
  if (m) out.cargo = m[1].trim()
  m = texto.match(/C\.\s*DE COSTO\s*:\s*(.+?)\s+INGRESO/)
  if (m) out.centro_costo_texto = m[1].trim()
  m = texto.match(/(\d{2})\/(\d{4})\s+IDP/)
  if (m) out.periodo = `${m[2]}-${m[1]}`
  m = texto.match(/Banco:\s*(.+?)(?:\n|Cuenta)/)
  if (m) out.banco = m[1].trim()
  m = texto.match(/Cuenta:\s*([\d]+)/)
  if (m) out.cuenta_banco = m[1].trim()
  m = texto.match(/DIAS TRABAJADOS\s+(\d+)/)
  if (m) out.dias_trabajados = parseInt(m[1], 10)
  // Bases imponibles para estimar aportes patronales
  m = texto.match(/AFECTO LEYES SOCIALES\s+([\d.]+)/)
  if (m) out.base_leyes_sociales = n(m[1])
  m = texto.match(/AFECTO SEG CESANTIA EMPRESA\s+([\d.]+)/)
  if (m) out.base_cesantia_empresa = n(m[1])
  m = texto.match(/TOTALES\s+([\d.]+)\s+([\d.]+)/)
  if (m) { out.total_haberes_declarado = n(m[1]); out.total_descuentos_declarado = n(m[2]) }
  m = texto.match(/LÍQUIDO A PAGAR\s+([\d.]+)/)
  if (m) out.liquido_pagar = n(m[1])
  return out
}

// Extrae líneas de glosa de una página.
// ROBUSTO: detecta CUALQUIER código (no depende de lista fija) y clasifica
// haber/descuento según la columna X donde aparece el monto.
// Así glosas nuevas (ej: 89 MOVILIZACION PROPORC.) se capturan automáticamente.
function parseLineas(lineas) {
  const out = []
  for (const tokens of lineas) {
    // Código de glosa al inicio (x < X_COD_MAX). Cualquier número 1-3 dígitos sirve.
    let cod = null, nombreTokens = []
    for (const t of tokens) {
      if (cod === null && t.x < X_COD_MAX && /^\d{1,3}$/.test(t.str)) {
        cod = parseInt(t.str, 10)
        continue
      }
      // tokens de texto (no numéricos) entre el código y los montos = nombre de glosa
      if (cod !== null && t.x < X_HABER[0] && !/^[\d.,]+$/.test(t.str)) {
        nombreTokens.push(t.str)
      }
    }
    if (cod === null) continue

    // Buscar monto en columna haberes o descuentos (clasificación por POSICIÓN)
    let haber = 0, desc = 0
    for (const t of tokens) {
      if (/^[\d.]+$/.test(t.str)) {
        if (t.x >= X_HABER[0] && t.x <= X_HABER[1]) haber = n(t.str)
        else if (t.x >= X_DESC[0] && t.x <= X_DESC[1]) desc = n(t.str)
      }
    }
    // La columna donde cae el monto define si es haber o descuento
    if (haber > 0) {
      out.push({ glosa_codigo: cod, monto: haber, naturaleza_pdf: 'haber', nombre_pdf: nombreTokens.join(' ').trim() || null })
    } else if (desc > 0) {
      out.push({ glosa_codigo: cod, monto: desc, naturaleza_pdf: 'descuento', nombre_pdf: nombreTokens.join(' ').trim() || null })
    }
  }
  return out
}

/* PARSER PRINCIPAL — recibe File, devuelve array de liquidaciones (1 por página) */
export async function parsearPDFLiquidaciones(file) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise

  const liquidaciones = []
  let periodoGlobal = null

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    const lineas = lineasConX(tc.items)

    // texto plano para cabecera
    const texto = lineas.map(l => l.map(t => t.str).join(' ')).join('\n')
    const cab = parseCabecera(texto)
    if (!cab.cod_contaline) continue  // página sin liquidación válida

    const lineasGlosa = parseLineas(lineas)
    // Totales según la columna donde cayó el monto (no lista fija de códigos)
    const totalHaberes = lineasGlosa.filter(l => l.naturaleza_pdf === 'haber').reduce((s,l)=>s+l.monto,0)
    const totalDesc = lineasGlosa.filter(l => l.naturaleza_pdf === 'descuento').reduce((s,l)=>s+l.monto,0)

    // Glosas no presentes en el catálogo conocido (para avisar al usuario)
    const desconocidas = lineasGlosa.filter(l => !ES_GLOSA(l.glosa_codigo))

    if (cab.periodo) periodoGlobal = cab.periodo

    liquidaciones.push({
      ...cab,
      total_haberes: totalHaberes,
      total_descuentos: totalDesc,
      lineas: lineasGlosa,
      glosas_desconocidas: desconocidas,
      // Tolerar diferencia de ±1 peso (Contaline redondea al prorratear días)
      cuadra: Math.abs(totalHaberes - (cab.total_haberes_declarado||0)) <= 1 &&
              Math.abs(totalDesc   - (cab.total_descuentos_declarado||0)) <= 1
    })
  }

  const cuadran = liquidaciones.filter(l => l.cuadra).length
  const maxDiff = Math.max(...liquidaciones.map(l =>
    Math.max(
      Math.abs(l.total_haberes - (l.total_haberes_declarado||0)),
      Math.abs(l.total_descuentos - (l.total_descuentos_declarado||0))
    )
  ))
  // Recopilar todos los códigos desconocidos únicos del PDF
  const codigosDesconocidos = {}
  liquidaciones.forEach(l => (l.glosas_desconocidas || []).forEach(g => {
    if (!codigosDesconocidos[g.glosa_codigo]) codigosDesconocidos[g.glosa_codigo] = g.nombre_pdf || `Código ${g.glosa_codigo}`
  }))

  return {
    periodo: periodoGlobal,
    liquidaciones,
    validacion: {
      total: liquidaciones.length,
      cuadran,
      con_diferencia: liquidaciones.length - cuadran,
      todas_ok: cuadran === liquidaciones.length,
      max_diff: maxDiff  // si es ≤1 es redondeo normal; si es mayor, revisar
    },
    glosas_desconocidas: codigosDesconocidos,  // {codigo: nombre} para avisar
    pdf_filename: file.name
  }
}
