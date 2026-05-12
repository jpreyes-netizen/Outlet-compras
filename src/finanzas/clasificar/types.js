export const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export function nombreMes(n) {
  if (!n || n < 1 || n > 12) return '—'
  return MESES_CORTOS[n - 1]
}

export const RESPALDO_TIPOS = [
  'factura_compra','liquidacion_sueldo','boleta_honorario','credito',
  'arriendo','caja_chica','venta_transferencia','gasto_bancario',
  'otro','sin_respaldo',
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

const STOP_WORDS = new Set(['DE','DEL','LA','EL','LOS','LAS','Y','A','AL','EN','POR','PARA','CON','SIN','TRANSFERENCIA','PAGO','ABONO','CARGO'])

export function palabrasSignificativas(desc, n = 4) {
  return desc.toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ\s]/g,' ').split(/\s+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w)).slice(0, n)
}
