/* ═══════════════════════════════════════════════════════════════════
   src/rrhh/parserBoletas.js
   Parser PDF Boleta de Honorarios Electrónica del SII
   Soporta múltiples PDFs en una sola carga.
   ═══════════════════════════════════════════════════════════════════ */

import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

const MESES = { enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,octubre:10,noviembre:11,diciembre:12 }

const n = s => {
  if (!s) return 0
  const c = String(s).replace(/\./g,'').replace(/,/g,'')
  const v = parseInt(c, 10)
  return isNaN(v) ? 0 : v
}

// Limpia guiones especiales del SII (− U+2212) a guión normal
const clean = s => String(s||'').replace(/[\u2212\u2013\u2014]/g,'-')

function parsearTexto(texto, filename) {
  const t = clean(texto)
  const out = { pdf_filename: filename }

  // Nombre emisor: primera línea no vacía que no sea texto del título del documento
  // ni N° de boleta ni RUT. Robusto a ambos layouts (con o sin "ELECTRONICA" concatenado).
  const SKIP_LINEAS = new Set(['BOLETA DE HONORARIOS','ELECTRONICA','BOLETA DE HONORARIOS ELECTRONICA'])
  const lineas = t.split('\n').map(l => l.trim()).filter(Boolean)
  for (const l of lineas.slice(0, 6)) {
    if (SKIP_LINEAS.has(l)) continue
    if (/^N\s*°/.test(l)) continue
    if (/^RUT:/.test(l)) break
    // Quitar sufijo "ELECTRONICA" si viene pegado (pdfjs lo concatena en algunos layouts)
    out.nombre_emisor = l.replace(/\s*ELECTRONICA\s*$/, '').trim()
    break
  }

  // N° boleta
  let m = t.match(/N\s*°\s*(\d+)/)
  if (m) out.folio = parseInt(m[1], 10)

  // RUT emisor (primera ocurrencia después de "RUT:")
  m = t.match(/RUT:\s*([\d\.]+-[\dkK])/)
  if (m) out.rut_emisor = m[1]

  // RUT receptor (debe ser Outlet)
  m = t.match(/Rut:\s*([\d\.]+\s*-\s*[\dkK])/)
  if (m) out.rut_receptor = m[1].replace(/\s+/g,'')

  // Fecha de la boleta ("Fecha: 30 de Abril de 2026")
  m = t.match(/Fecha:\s*(\d+)\s+de\s+(\w+)\s+de\s+(\d{4})/i)
  if (m) {
    const dia = m[1].padStart(2,'0')
    const mes = MESES[m[2].toLowerCase()]
    if (mes) {
      const mm = String(mes).padStart(2,'0')
      out.fecha_boleta = `${m[3]}-${mm}-${dia}`
      out.periodo = `${m[3]}-${mm}`
    }
  }

  // Montos
  m = t.match(/Total Honorarios:\s*\$?:?\s*([\d\.]+)/)
  out.monto_bruto = m ? n(m[1]) : 0

  m = t.match(/(\d+[\.,]\d+)\s*%\s*Impto\.\s*Retenido:\s*([\d\.]+)/)
  out.tasa_retencion = m ? parseFloat(m[1].replace(',','.')) : 15.25
  out.monto_retencion = m ? n(m[2]) : 0

  out.monto_liquido = out.monto_bruto - out.monto_retencion

  // Líneas de servicio: entre "Por atención profesional:" y "Total Honorarios"
  m = t.match(/Por atención profesional:?\s*\n([\s\S]+?)Total Honorarios/)
  out.lineas = []
  if (m) {
    for (const ln of m[1].split('\n')) {
      const s = ln.trim()
      if (!s) continue
      // glosa + monto al final
      const mm = s.match(/^(.+?)\s+([\d\.]+)\s*$/)
      if (mm) {
        const monto = n(mm[2])
        if (monto > 0) out.lineas.push({ glosa: mm[1].trim(), monto })
      }
    }
  }
  out.glosa_servicio = out.lineas.map(l => l.glosa).join(' · ') || null

  // Validación: suma de líneas = bruto, retención consistente
  const sumLineas = out.lineas.reduce((s,l)=>s+l.monto, 0)
  const retCalc = Math.round(out.monto_bruto * out.tasa_retencion / 100)
  out.cuadra = (
    out.monto_bruto > 0 &&
    out.folio > 0 &&
    out.rut_emisor &&
    Math.abs(sumLineas - out.monto_bruto) <= 1 &&
    Math.abs(retCalc - out.monto_retencion) <= 2
  )
  return out
}

async function leerPDFTexto(file) {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  let texto = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    // Agrupar por línea Y
    const map = new Map()
    for (const it of tc.items) {
      const y = Math.round(it.transform[5])
      if (!map.has(y)) map.set(y, [])
      map.get(y).push({ x: it.transform[4], str: it.str })
    }
    const ys = [...map.keys()].sort((a,b)=>b-a)
    for (const y of ys) {
      const items = map.get(y).sort((a,b)=>a.x-b.x)
      const linea = items.map(i=>i.str).join(' ').replace(/\s+/g,' ').trim()
      if (linea) texto += linea + '\n'
    }
  }
  return texto
}

/* PARSER PRINCIPAL — recibe array de File, devuelve array de boletas parseadas */
export async function parsearBoletas(files) {
  const out = []
  for (const file of files) {
    try {
      const texto = await leerPDFTexto(file)
      const boleta = parsearTexto(texto, file.name)
      out.push(boleta)
    } catch (err) {
      out.push({ pdf_filename: file.name, error: err.message, cuadra: false })
    }
  }
  return {
    boletas: out,
    total_archivos: files.length,
    cuadran: out.filter(b=>b.cuadra).length
  }
}
