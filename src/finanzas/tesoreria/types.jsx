export const MEDIOS_PRINCIPALES = [
  { key: 'efectivo', label: 'Efectivo' },
  { key: 't_credito', label: 'Crédito (Getnet)' },
  { key: 't_debito', label: 'Débito (Webpay débito)' },
  { key: 'transferencia', label: 'Transferencias' },
]

export const MEDIOS_OTROS = [
  { key: 'webpay', label: 'Webpay (crédito/pasarela)' },
  { key: 'm_pago', label: 'Mercado Pago' },
  { key: 'abono_cliente', label: 'Abono cliente' },
  { key: 'canje', label: 'Canje' },
  { key: 'p_clay', label: 'Puntos Clay' },
  { key: 'cheque', label: 'Cheque' },
]

export const MEDIOS = [...MEDIOS_PRINCIPALES, ...MEDIOS_OTROS]

export const UMBRALES_DEFAULT = { cuadra: 2000, tolerable: 20000 }

export function clasificarPorDiferencia(diferencia, u = UMBRALES_DEFAULT) {
  const abs = Math.abs(diferencia)
  if (abs <= u.cuadra) return 'cuadra'
  if (abs <= u.tolerable) return 'tolerable'
  return 'descuadre'
}

export function formatCLP(n) {
  if (n == null) return '—'
  return '$' + Math.round(Number(n)).toLocaleString('es-CL')
}

export function parseCLP(s) {
  if (!s) return 0
  return Number(String(s).replace(/[^0-9-]/g, '')) || 0
}

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isoDelta(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function rangoMes(anio, mes) {
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
  const last = new Date(anio, mes, 0).getDate()
  const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  return { desde, hasta }
}

// Estilos reutilizables
export const inputSt = {
  padding: '7px 10px', borderRadius: 7, border: '1px solid #D1D5DB',
  fontSize: 13, background: '#fff', color: '#374151', outline: 'none', width: '100%', boxSizing: 'border-box',
}

export const selectSt = {
  padding: '7px 10px', borderRadius: 7, border: '1px solid #D1D5DB',
  fontSize: 13, background: '#fff', color: '#374151', width: '100%',
}

export const labelSt = {
  fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4,
}

export const cardSt = {
  background: '#fff', borderRadius: 10, padding: '16px 20px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 16,
}

export const btnSt = (color = '#1F4E79') => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 16px', borderRadius: 7, border: 'none',
  background: color, fontSize: 13, fontWeight: 500, color: '#fff', cursor: 'pointer',
})

export const btnOutlineSt = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 16px', borderRadius: 7, border: '1px solid #D1D5DB',
  background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer',
}

export const TH = {
  padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase',
  background: '#F9FAFB', whiteSpace: 'nowrap',
}

export const TD = {
  padding: '10px 12px', fontSize: 13, color: '#374151',
  whiteSpace: 'nowrap', verticalAlign: 'middle',
}

export function estadoBadge(estado) {
  const cfg = {
    declarado: { bg: '#FEF9C3', color: '#854D0E', label: 'Declarado' },
    cuadra: { bg: '#DCFCE7', color: '#166534', label: 'Cuadra' },
    tolerable: { bg: '#FEF3C7', color: '#92400E', label: 'Tolerable' },
    descuadre: { bg: '#FEE2E2', color: '#991B1B', label: 'Descuadre' },
    anulado: { bg: '#F3F4F6', color: '#6B7280', label: 'Anulado' },
  }
  const c = cfg[estado] ?? cfg.declarado
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: c.bg, color: c.color }}>
      {c.label}
    </span>
  )
}
