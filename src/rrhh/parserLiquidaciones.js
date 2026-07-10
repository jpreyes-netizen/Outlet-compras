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
  if (m) { out.total_haberes_declarado = n(m[1]); out.total_descuentos_declarado = n(m[2]); out.tiene_totales = true }
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

// Detecta si una fila reconstruida es un ancla de cabecera ("NOMBRE :")
// El token NOMBRE queda a la izquierda (x<100) y la fila contiene "NOMBRE :".
function esAnclaNombre(tokens) {
  const txt = tokens.map(t => t.str).join(' ')
  if (!/NOMBRE\s*:/.test(txt)) return false
  return tokens.some(t => t.x < 100 && /NOMBRE/i.test(t.str))
}

// Segmenta las líneas de UNA página en regiones (1 liquidación c/u).
// Cada región va desde un ancla NOMBRE hasta el ancla siguiente (o el fin de página).
// Junio trae 2 liquidaciones apiladas por página; abril trae 1 (=> 1 sola región).
// El título "06/2026 IDP" queda ARRIBA del ancla, por eso el período se resuelve
// a nivel página (fallback) y no dentro de la región.
function segmentarRegiones(lineas) {
  const anclas = []
  lineas.forEach((l, i) => { if (esAnclaNombre(l)) anclas.push(i) })
  if (anclas.length === 0) return []
  const regiones = []
  for (let k = 0; k < anclas.length; k++) {
    const ini = anclas[k]
    const fin = k + 1 < anclas.length ? anclas[k + 1] : lineas.length
    regiones.push(lineas.slice(ini, fin))
  }
  return regiones
}

/* PARSER PRINCIPAL — recibe File, devuelve array de liquidaciones (1 por REGIÓN) */
export async function parsearPDFLiquidaciones(file) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise

  const liquidaciones = []
  let periodoGlobal = null

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    const lineas = lineasConX(tc.items)

    // Período a nivel PÁGINA (el título queda fuera de cada región individual)
    const textoPagina = lineas.map(l => l.map(t => t.str).join(' ')).join('\n')
    let periodoPagina = null
    const mp = textoPagina.match(/(\d{2})\/(\d{4})\s+IDP/)
    if (mp) periodoPagina = `${mp[2]}-${mp[1]}`

    // Segmentar la página en regiones (1 liquidación por región)
    const regiones = segmentarRegiones(lineas)

    for (const regionLineas of regiones) {
      const texto = regionLineas.map(l => l.map(t => t.str).join(' ')).join('\n')
      const cab = parseCabecera(texto)
      if (!cab.cod_contaline) continue  // región sin liquidación válida

      // El período casi nunca cae dentro de la región → usar fallback de página
      if (!cab.periodo && periodoPagina) cab.periodo = periodoPagina

      const lineasGlosa = parseLineas(regionLineas)
      // Totales según la columna donde cayó el monto (no lista fija de códigos)
      let totalHaberes = lineasGlosa.filter(l => l.naturaleza_pdf === 'haber').reduce((s,l)=>s+l.monto,0)
      let totalDesc = lineasGlosa.filter(l => l.naturaleza_pdf === 'descuento').reduce((s,l)=>s+l.monto,0)

      if (cab.periodo) periodoGlobal = cab.periodo

      // Validación con fallback:
      //  a) si hay TOTALES declarado  → comparar haberes/descuentos ±1
      //  b) si NO hay TOTALES pero sí LÍQUIDO → liquidación truncada por Contaline
      //     ("No se listaron todos los conceptos"). La truncadura corta desde el pie,
      //     donde van los descuentos, así que los HABERES impresos están completos y
      //     el LÍQUIDO es la cifra autoritativa. Se deriva el descuento total real
      //     (haberes − líquido) y el faltante vs lo impreso se registra como una
      //     línea explícita "DESCUENTO NO DETALLADO" para no romper la identidad
      //     contable ni ocultar el ajuste.
      //  c) si no hay ninguno → no cuadra
      let cuadra = false, diff = Infinity, truncada = false, descuento_no_detallado = 0
      if (cab.tiene_totales) {
        const dH = Math.abs(totalHaberes - (cab.total_haberes_declarado||0))
        const dD = Math.abs(totalDesc   - (cab.total_descuentos_declarado||0))
        diff = Math.max(dH, dD)
        cuadra = diff <= 1
      } else if (cab.liquido_pagar != null) {
        truncada = true
        const descReal = totalHaberes - cab.liquido_pagar
        const faltante = Math.round(descReal - totalDesc)
        if (descReal >= 0 && faltante >= -1) {
          // Reconciliable: solo faltan descuentos (caso normal de truncadura)
          if (faltante > 0) {
            descuento_no_detallado = faltante
            lineasGlosa.push({
              glosa_codigo: 999, monto: faltante, naturaleza_pdf: 'descuento',
              nombre_pdf: 'DESCUENTO NO DETALLADO (PDF truncado)'
            })
            totalDesc += faltante
          }
          diff = 0
          cuadra = true
        } else {
          // No reconciliable (probable omisión de HABERES): requiere reimpresión 1x página
          diff = Math.abs((totalHaberes - totalDesc) - cab.liquido_pagar)
          cuadra = false
        }
      }

      // Glosas no presentes en el catálogo conocido (para avisar al usuario)
      const desconocidas = lineasGlosa.filter(l => !ES_GLOSA(l.glosa_codigo))

      liquidaciones.push({
        ...cab,
        total_haberes: totalHaberes,
        total_descuentos: totalDesc,
        lineas: lineasGlosa,
        glosas_desconocidas: desconocidas,
        validado_por: cab.tiene_totales ? 'totales' : (cab.liquido_pagar != null ? 'liquido' : 'ninguno'),
        truncada,
        descuento_no_detallado,
        diff,
        cuadra
      })
    }
  }

  const cuadran = liquidaciones.filter(l => l.cuadra).length
  const difs = liquidaciones.map(l => l.diff).filter(d => Number.isFinite(d))
  const maxDiff = difs.length ? Math.max(...difs) : 0
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
