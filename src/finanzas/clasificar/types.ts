export type Movimiento = {
  id: string
  cartola_id: string
  fecha: string
  monto: number
  saldo: number | null
  tipo: 'ABONO' | 'CARGO'
  descripcion: string
  referencia: string | null
  estado: 'pendiente' | 'clasificado' | 'conciliado' | string
  subcuenta_id: string | null
  ceco_id: string | null
  tipo_respaldo: string | null
  observaciones: string | null
  mes_cartola: number | null
  mes_nominal: number | null
}

export const MESES_CORTOS = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
] as const

export function nombreMes(n: number | null | undefined): string {
  if (!n || n < 1 || n > 12) return '—'
  return MESES_CORTOS[n - 1]
}

export type CuentaMadre = {
  id: string
  nombre: string
  orden_eerr: number | null
}

export type Subcuenta = {
  id: string
  nombre: string
  cuenta_madre_id: string
}

export type CentroCosto = {
  id: string
  nombre: string
}

export type ReglaClasificacion = {
  id: string
  tipo_regla:
    | 'descripcion_exacta'
    | 'descripcion_contiene'
    | 'palabra_clave'
    | 'rut'
    | string
  patron: string
  subcuenta_id: string | null
  ceco_id: string | null
  tipo_respaldo: string | null
  aciertos: number | null
}

export type LibroCompraRow = {
  rut_proveedor: string | null
  subcuenta_id: string | null
  ceco_id: string | null
}

export type CartolaLite = {
  id: string
  banco: string
  cuenta: string
}

export type Sugerencia = {
  subcuenta_id: string
  subcuenta_nombre: string
  ceco_id: string | null
  tipo_respaldo: string | null
  fuente: 'libro_compras' | 'regla'
  regla_id: string | null
  rut_extraido: string | null
}

export const RESPALDO_TIPOS = [
  'factura_compra',
  'liquidacion_sueldo',
  'boleta_honorario',
  'credito',
  'arriendo',
  'caja_chica',
  'venta_transferencia',
  'gasto_bancario',
  'otro',
  'sin_respaldo',
] as const

export type RespaldoTipo = (typeof RESPALDO_TIPOS)[number]

// Cache simple en módulo para los dropdowns "estáticos".
let _catalogPromise: Promise<{
  cuentas: CuentaMadre[]
  subcuentas: Subcuenta[]
  cecos: CentroCosto[]
  reglas: ReglaClasificacion[]
}> | null = null

export function invalidateCatalog() {
  _catalogPromise = null
}

export function getCatalogPromise<T>(load: () => Promise<T>): Promise<T> {
  if (!_catalogPromise) {
    _catalogPromise = load() as unknown as Promise<{
      cuentas: CuentaMadre[]
      subcuentas: Subcuenta[]
      cecos: CentroCosto[]
      reglas: ReglaClasificacion[]
    }>
  }
  return _catalogPromise as unknown as Promise<T>
}

// RUT chileno: 7-8 dígitos + dígito verificador.
const RUT_REGEX_DOTTED = /(\d{1,2}\.\d{3}\.\d{3}-[\dkK])/
const RUT_REGEX_PLAIN = /(?<![\d])(\d{7,8}-[\dkK])(?![\d])/
const RUT_REGEX_NODASH = /(?<![\d])(0?\d{8})(?![\d])/

export function extraerRut(desc: string): string | null {
  if (!desc) return null
  const m1 = desc.match(RUT_REGEX_DOTTED)
  if (m1) return normalizarRut(m1[1])
  const m2 = desc.match(RUT_REGEX_PLAIN)
  if (m2) return normalizarRut(m2[1])
  const m3 = desc.match(RUT_REGEX_NODASH)
  if (m3) {
    const raw = m3[1].replace(/^0+/, '')
    if (raw.length >= 7) {
      const cuerpo = raw.slice(0, -1)
      const dv = raw.slice(-1).toUpperCase()
      return `${cuerpo}-${dv}`
    }
  }
  return null
}

function normalizarRut(s: string): string {
  return s.replace(/\./g, '').toUpperCase()
}

const STOP_WORDS = new Set([
  'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'A', 'AL',
  'EN', 'POR', 'PARA', 'CON', 'SIN', 'TRANSFERENCIA',
  'PAGO', 'ABONO', 'CARGO',
])

export function palabrasSignificativas(desc: string, n = 4): string[] {
  return desc
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
    .slice(0, n)
}
