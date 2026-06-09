export const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export function nombreMes(n) {
  if (!n || n < 1 || n > 12) return '—'
  return MESES_CORTOS[n - 1]
}

export const RESPALDO_TIPOS = [
  'factura_compra','liquidacion_sueldo','boleta_honorario','credito',
  'arriendo','caja_chica','venta_transferencia','gasto_bancario',
  'caso_postventa','otro','sin_respaldo',
]

let _catalogPromise = null

export function invalidateCatalog() {
  _catalogPromise = null
}

export function getCatalogPromise(load) {
  if (!_catalogPromise) _catalogPromise = load()
  return _catalogPromise
}

const RUT_REGEX_DOTTED = /(\d{1,2}\.\d{3}\.\d{3}-[\dkK])/
const RUT_REGEX_PLAIN = /(?<![\d])(\d{7,8}-[\dkK])(?![\d])/
const RUT_REGEX_NODASH = /(?<![\d])(0?\d{8})(?![\d])/

export function extraerRut(desc) {
  if (!desc) return null
  const m1 = desc.match(RUT_REGEX_DOTTED)
  if (m1) return normalizarRut(m1[1])
  const m2 = desc.match(RUT_REGEX_PLAIN)
  if (m2) return normalizarRut(m2[1])
  const m3 = desc.match(RUT_REGEX_NODASH)
  if (m3) {
    const raw = m3[1].replace(/^0+/, '')
    if (raw.length >= 7) return `${raw.slice(0,-1)}-${raw.slice(-1).toUpperCase()}`
  }
  return null
}

function normalizarRut(s) {
  return s.replace(/\./g, '').toUpperCase()
}

const STOP_WORDS = new Set(['DE','DEL','LA','EL','LOS','LAS','Y','A','AL','EN','POR','PARA','CON','SIN','TRANSFERENCIA','TRANSF','PAGO','ABONO','CARGO','COMPRA','CHEQUE','CANJE','RECIBIDO','OTRO','BANCO','LTDA','SPA','S.A','SOCIEDAD'])

export function palabrasSignificativas(desc, n = 4) {
  return desc.toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ\s]/g,' ').split(/\s+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w)).slice(0, n)
}

// ── Scoring de sugerencias (estilo Chipax) ──────────────────────────────────
// Calcula score 0-100 según la fuente de la sugerencia
export function calcularScoreSugerencia({ fuente, tipo_regla, aciertos = 0, consistencia }) {
  // Caso postventa: match perfecto RUT + monto exacto + fecha cercana → la más confiable
  if (fuente === 'caso_postventa') return { score: 99, nivel: 'alto', razon: 'Devolución de caso postventa (match RUT + monto exacto)' }

  // RUT en libro_compras: la fuente más confiable
  if (fuente === 'libro_compras') return { score: 98, nivel: 'alto', razon: 'Mismo proveedor ya clasificado en libro de compras' }

  // Patrón histórico aprendido (cruce con movimientos ya clasificados)
  if (fuente === 'patron_historico') {
    // Score combina veces y consistencia (% de veces que el patrón fue clasificado a esa subcuenta)
    const cons = consistencia ?? 1
    if (aciertos >= 10 && cons >= 0.9) return { score: 96, nivel: 'alto',  razon: `Patrón histórico fuerte · ${aciertos} clasificaciones previas (${Math.round(cons*100)}% consistente)` }
    if (aciertos >= 5  && cons >= 0.85) return { score: 90, nivel: 'alto',  razon: `Patrón histórico · ${aciertos} clasificaciones previas (${Math.round(cons*100)}% consistente)` }
    if (aciertos >= 3  && cons >= 0.7)  return { score: 78, nivel: 'medio', razon: `Patrón histórico · ${aciertos} clasificaciones previas (${Math.round(cons*100)}% consistente)` }
    if (aciertos >= 2  && cons >= 0.6)  return { score: 65, nivel: 'medio', razon: `Patrón débil · ${aciertos} clasificaciones (${Math.round(cons*100)}% consistente — verificar)` }
    return { score: 50, nivel: 'bajo', razon: `Patrón ambiguo · ${aciertos} clasificaciones (${Math.round(cons*100)}% consistente)` }
  }

  // Regla por RUT activa
  if (fuente === 'regla' && tipo_regla === 'rut') {
    if (aciertos >= 5) return { score: 95, nivel: 'alto', razon: `Regla RUT validada · ${aciertos} aciertos` }
    if (aciertos >= 1) return { score: 90, nivel: 'alto', razon: `Regla RUT · ${aciertos} acierto${aciertos > 1 ? 's' : ''}` }
    return { score: 85, nivel: 'medio', razon: 'Regla RUT sin historial' }
  }

  // Reglas por descripción
  if (fuente === 'regla') {
    if (tipo_regla === 'descripcion_exacta') {
      if (aciertos >= 5) return { score: 92, nivel: 'alto', razon: `Coincidencia exacta · ${aciertos} aciertos` }
      return { score: 88, nivel: 'alto', razon: 'Descripción coincide exactamente' }
    }
    if (tipo_regla === 'descripcion_contiene') {
      if (aciertos >= 5) return { score: 85, nivel: 'alto', razon: `Patrón aprendido · ${aciertos} aciertos` }
      if (aciertos >= 3) return { score: 75, nivel: 'medio', razon: `Patrón aprendido · ${aciertos} aciertos` }
      if (aciertos >= 1) return { score: 65, nivel: 'medio', razon: `Patrón aprendido · ${aciertos} acierto${aciertos > 1 ? 's' : ''}` }
      return { score: 55, nivel: 'bajo', razon: 'Regla creada manualmente, aún sin validar' }
    }
    if (tipo_regla === 'palabra_clave') {
      if (aciertos >= 5) return { score: 75, nivel: 'medio', razon: `Palabra clave · ${aciertos} aciertos` }
      if (aciertos >= 1) return { score: 60, nivel: 'medio', razon: `Palabra clave · ${aciertos} acierto${aciertos > 1 ? 's' : ''}` }
      return { score: 50, nivel: 'bajo', razon: 'Palabra clave sin validar' }
    }
  }

  return { score: 50, nivel: 'bajo', razon: 'Sugerencia por defecto' }
}

// Normaliza descripción para crear patrón aprendido reutilizable
// Quita: RUTs, montos, fechas, números largos, caracteres especiales
// Conserva: palabras significativas en mayúscula
export function normalizarPatron(descripcion) {
  if (!descripcion) return ''
  return descripcion
    .replace(/\d{1,2}\.\d{3}\.\d{3}-[\dkK]/gi, '')   // RUT con puntos
    .replace(/\d{7,8}-[\dkK]/gi, '')                   // RUT sin puntos
    .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, '') // fechas
    .replace(/\b\d{4,}\b/g, '')                        // números largos (montos, refs)
    .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, ' ')        // solo letras
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w))
    .slice(0, 5)
    .join(' ')
}
