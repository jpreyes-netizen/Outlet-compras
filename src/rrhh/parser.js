/* ═══════════════════════════════════════════════════════════════════
   src/rrhh/parser.js — Parser PDF Libro de Remuneraciones Contaline
   Validado contra 4 PDFs reales (Ene/Feb/Mar/Abr 2026), 159 empleados
   ═══════════════════════════════════════════════════════════════════ */

import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

// "1.310.000" → 1310000 | "" → 0
const n = s => {
  if (!s) return 0
  const clean = String(s).trim().replace(/\./g, '').replace(/,/g, '')
  const v = parseInt(clean, 10)
  return isNaN(v) ? 0 : v
}

// Detecta tokens con números pegados ("2.213.3543.609.467") y los separa
function splitPegados(tokens) {
  const out = []
  for (const t of tokens) {
    const puntos = (t.match(/\./g) || []).length
    if (puntos <= 2) { out.push(t); continue }
    // Caso típico: N.NNN.NNN + N.NNN.NNN
    let m = t.match(/^(\d{1,3}\.\d{3}\.\d{3})(\d{1,3}\.\d{3}\.\d{3})$/)
    if (m) { out.push(m[1], m[2]); continue }
    m = t.match(/^(\d{1,3}\.\d{3})(\d{1,3}\.\d{3}\.\d{3})$/)
    if (m) { out.push(m[1], m[2]); continue }
    m = t.match(/^(\d{1,3}\.\d{3}\.\d{3})(\d{1,3}\.\d{3})$/)
    if (m) { out.push(m[1], m[2]); continue }
    m = t.match(/^(\d{1,3}\.\d{3})(\d{1,3}\.\d{3})$/)
    if (m) { out.push(m[1], m[2]); continue }
    out.push(t)
  }
  return out
}

const makeEmp = (cod, nombre, nums) => ({
  cod_contaline: cod,
  nombre: nombre.trim(),
  sueldo_base:    nums[0],
  tratos_bonos:   nums[1],
  otros_ingresos: nums[2],
  asignac_fam:    nums[3],
  total_haberes:  nums[4],
  prevision:      nums[5],
  salud:          nums[6],
  prestamos:      nums[7],
  impuesto_unico: nums[8],
  otros_desc:     nums[9],
  total_desc:     nums[10],
  liquido:        nums[11]
})

const findNum = (texto, label) => {
  const re = new RegExp(label + '\\s+([\\d.]+)')
  const m = texto.match(re)
  return m ? n(m[1]) : 0
}

// Parsea el texto completo del PDF → array de empleados
function parseEmpleados(texto) {
  const empleados = []
  const procesadas = new Set()
  const lineas = texto.split('\n')

  // PASADA 1: regex principal — cod + nombre + 12 números separados por espacio
  const patFull = /^\s*(\d{1,3})\s*(.+?)\s+((?:[\d.]+\s+){11}[\d.]+)\s*$/
  // Patrones a saltar (no son empleados)
  const skipPats = ['TOTAL REMUNERACIONES', 'Total Costo', 'Aporte ',
                    'Cuadro Resumen', 'Período', 'Cód. Nombre',
                    'OUTLET DE PUERTAS', 'LIBRO DE', 'Página Nº']
  const isSkip = ln => skipPats.some(p => ln.includes(p))

  lineas.forEach((ln, idx) => {
    if (isSkip(ln)) return
    const m = ln.match(patFull)
    if (!m) return
    const cod = parseInt(m[1], 10)
    const nombre = m[2].trim()
    const tokens = m[3].split(/\s+/)
    if (tokens.length !== 12) return
    if (nombre.length < 3 || /^[\d\.\s]+$/.test(nombre)) return
    const nums = tokens.map(n)
    empleados.push(makeEmp(cod, nombre, nums))
    procesadas.add(idx)
  })

  // PASADA 2: líneas con números pegados (ej: "14LEON MENESES... 2.213.3543.609.467")
  const patPegado = /^\s*(\d{1,3})\s*([A-Za-zÁÉÍÓÚÑáéíóúñ?\.\s']+?)\s+(\d[\d.]*(?:\s+\d[\d.]*)+)\s*$/
  lineas.forEach((ln, idx) => {
    if (procesadas.has(idx) || isSkip(ln)) return
    const m = ln.match(patPegado)
    if (!m) return
    const cod = parseInt(m[1], 10)
    const nombre = m[2].trim()
    const tokens = m[3].split(/\s+/)
    const clean = splitPegados(tokens)
    if (clean.length !== 12) return
    if (nombre.length < 3) return
    if (empleados.some(e => e.cod_contaline === cod)) return
    const nums = clean.map(n)
    empleados.push(makeEmp(cod, nombre, nums))
    procesadas.add(idx)
  })

  // PASADA 3: línea con sólo código + 12 números (nombre quedó en línea anterior)
  const patSolo = /^\s*(\d{1,3})\s+((?:[\d.]+\s+){11}[\d.]+)\s*$/
  lineas.forEach((ln, idx) => {
    if (procesadas.has(idx)) return
    const m = ln.match(patSolo)
    if (!m) return
    const cod = parseInt(m[1], 10)
    const tokens = m[2].split(/\s+/)
    if (tokens.length !== 12) return
    if (empleados.some(e => e.cod_contaline === cod)) return
    // Buscar nombre en líneas anteriores
    let nombre = ''
    for (let j = idx - 1; j >= Math.max(idx - 3, 0); j--) {
      const cand = lineas[j].trim()
      if (/^[A-Za-zÁÉÍÓÚÑáéíóúñ?\.\s'']{3,40}$/.test(cand)) {
        nombre = cand + ' ' + nombre
        if (cand.length > 10) break
      }
    }
    nombre = nombre.trim() || `COD_${cod}`
    const nums = tokens.map(n)
    empleados.push(makeEmp(cod, nombre, nums))
  })

  return empleados.sort((a, b) => a.cod_contaline - b.cod_contaline)
}

// Extrae período del texto: "Período : 03/2026" → "2026-03"
function extraerPeriodo(texto) {
  const m = texto.match(/Período\s*:\s*(\d{2})\/(\d{4})/)
  if (m) return `${m[2]}-${m[1]}`
  // Fallback: "Mes seleccionado Marzo de 2026"
  const meses = { Enero:'01', Febrero:'02', Marzo:'03', Abril:'04', Mayo:'05',
                  Junio:'06', Julio:'07', Agosto:'08', Septiembre:'09',
                  Octubre:'10', Noviembre:'11', Diciembre:'12' }
  const m2 = texto.match(/Mes seleccionado (\w+) de (\d{4})/)
  if (m2 && meses[m2[1]]) return `${m2[2]}-${meses[m2[1]]}`
  return null
}

/* PARSER PRINCIPAL — recibe File del input y devuelve estructura completa */
export async function parsearPDFLibro(file) {
  // Leer PDF a ArrayBuffer
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  // Concatenar texto de todas las páginas
  let texto = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    // Reconstruir líneas usando posición Y (los items vienen sueltos)
    const items = tc.items
    // Agrupar por Y aproximado
    const lineMap = new Map()
    for (const it of items) {
      const y = Math.round(it.transform[5])
      if (!lineMap.has(y)) lineMap.set(y, [])
      lineMap.get(y).push({ x: it.transform[4], str: it.str })
    }
    // Ordenar líneas top-down, items izq-der
    const ys = [...lineMap.keys()].sort((a, b) => b - a)
    for (const y of ys) {
      const items = lineMap.get(y).sort((a, b) => a.x - b.x)
      const linea = items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim()
      if (linea) texto += linea + '\n'
    }
  }

  const periodo = extraerPeriodo(texto)
  const empleados = parseEmpleados(texto)

  // Totales del resumen
  const aporteMutual    = findNum(texto, 'Aporte Mutual')
  const aporteCesantia  = findNum(texto, 'Aporte Seguro Cesantía')
  const aporteInvalidez = findNum(texto, 'Aporte Seguro Invalidez')
  const aporteCapital   = findNum(texto, 'Aporte Capitalización Individual')
  const aporteSsVida    = findNum(texto, 'Aporte SS/Expectativa de Vida')
  const totalCostoEmp   = findNum(texto, 'Total Costo Empresa')
  const totalCostoRem   = findNum(texto, 'Total Costo Remuneraciones')
  const nEmpDecl        = findNum(texto, 'Total de Empleados')

  // Calcular sumas para validación
  const sumaHaberes    = empleados.reduce((s, e) => s + e.total_haberes, 0)
  const sumaDescuentos = empleados.reduce((s, e) => s + e.total_desc, 0)
  const sumaLiquido    = empleados.reduce((s, e) => s + e.liquido, 0)

  // Validaciones
  const validaciones = {
    periodo_detectado:     !!periodo,
    n_empleados_ok:        empleados.length === nEmpDecl,
    n_empleados_parseados: empleados.length,
    n_empleados_declarados: nEmpDecl,
    haberes_ok:            sumaHaberes === totalCostoRem,
    haberes_diff:          sumaHaberes - totalCostoRem,
    suma_haberes:          sumaHaberes,
    suma_descuentos:       sumaDescuentos,
    suma_liquido:          sumaLiquido
  }

  return {
    periodo,
    empleados,
    aportes_patronales: {
      aporte_mutual:    aporteMutual,
      aporte_cesantia:  aporteCesantia,
      aporte_invalidez: aporteInvalidez,
      aporte_capital:   aporteCapital,
      aporte_ss_vida:   aporteSsVida
    },
    totales: {
      total_haberes:       sumaHaberes,
      total_descuentos:    sumaDescuentos,
      liquido_pagar:       sumaLiquido,
      total_aportes_pat:   aporteMutual + aporteCesantia + aporteInvalidez + aporteCapital + aporteSsVida,
      total_costo_empresa: totalCostoEmp,
      n_empleados:         empleados.length
    },
    validaciones,
    pdf_filename: file.name
  }
}
