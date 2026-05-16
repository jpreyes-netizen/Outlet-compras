import { useEffect, useMemo, useState, Fragment } from 'react'
import { toast } from 'sonner'
import { Loader2, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, AlertCircle, Clock, TrendingDown, Users, Calendar } from 'lucide-react'
import { formatCLP, cardSt, selectSt, labelSt, btnOutlineSt, TH, TD } from './types'
import { fetchSucursales, fetchConciliacion3Fases, fetchParamsConciliacion, agregarFase3PorMedio } from './api'

const PUEDE_TODO = ['admin', 'contabilidad', 'jefe_admin_finanzas', 'gerente_admin_finanzas', 'gerencia', 'admin_sistema']

const MEDIOS_CONFIG = [
  { key: 'efectivo',      label: 'Efectivo',         color: '#16A34A', icon: '💵' },
  { key: 't_credito',     label: 'Crédito (Getnet)',  color: '#1D4ED8', icon: '💳' },
  { key: 't_debito',      label: 'Débito (Getnet)',   color: '#0891B2', icon: '💳' },
  { key: 'webpay',        label: 'Webpay (link pago)',color: '#7C3AED', icon: '🔗' },
  { key: 'transferencia', label: 'Transferencia',     color: '#D97706', icon: '🏦' },
]

// ─── Helpers ──────────────────────────────────────────────────────────
function clasificar(brecha, params) {
  const abs = Math.abs(brecha)
  if (abs <= params.umbral_cuadra)    return 'cuadra'
  if (abs <= params.umbral_tolerable) return 'tolerable'
  return 'descuadre'
}

function colorBrecha(estado) {
  if (estado === 'cuadra')    return { bg: '#DCFCE7', color: '#166534' }
  if (estado === 'tolerable') return { bg: '#FEF9C3', color: '#854D0E' }
  if (estado === 'descuadre') return { bg: '#FEE2E2', color: '#991B1B' }
  if (estado === 'pendiente') return { bg: '#F3F4F6', color: '#6B7280' }
  return { bg: '#F3F4F6', color: '#6B7280' }
}

function iconBrecha(estado) {
  if (estado === 'cuadra')    return <CheckCircle2 size={14} />
  if (estado === 'tolerable') return <AlertCircle size={14} />
  if (estado === 'descuadre') return <AlertTriangle size={14} />
  return <Clock size={14} />
}

// Suma medios declarados y corroborados por medio en todos los cierres del período
function sumarPorMedio(cierres) {
  const tot = {}
  for (const m of MEDIOS_CONFIG) {
    tot[m.key] = { declarado: 0, corroborado: 0, bsale: 0 }
  }
  let bsaleTotal = 0
  const fechasSucBsale = new Set()
  for (const c of cierres) {
    for (const m of MEDIOS_CONFIG) {
      tot[m.key].declarado    += Number(c[m.key] ?? 0)
      tot[m.key].corroborado  += Number(c[`${m.key}_corrob`] ?? c[m.key] ?? 0)
    }
    // BSALE total: deduplicar por fecha+sucursal
    if (c.venta_bsale_api != null) {
      const key = `${c.fecha}|${c.sucursal_id}`
      if (!fechasSucBsale.has(key)) {
        fechasSucBsale.add(key)
        bsaleTotal += Number(c.venta_bsale_api ?? 0)
      }
    }
  }
  return { porMedio: tot, bsaleTotal }
}

// ─── Píldora resumen por medio ───────────────────────────────────────
function PildoraMedio({ medio, cfg, vendido, corroborado, depositado, params, onClick }) {
  const brechaCorrob = corroborado - vendido
  const brechaDep    = depositado - corroborado
  const sinDep = depositado === 0 && cfg.key !== 'transferencia'
  // Estado peor de las dos brechas
  const estCorr = clasificar(brechaCorrob, params)
  const estDep  = sinDep ? 'pendiente' : clasificar(brechaDep, params)
  const peor = (estDep === 'descuadre' || estCorr === 'descuadre') ? 'descuadre'
    : (estDep === 'tolerable' || estCorr === 'tolerable') ? 'tolerable'
    : (sinDep ? 'pendiente' : 'cuadra')
  const c = colorBrecha(peor)
  return (
    <div onClick={onClick}
      style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: `2px solid ${c.bg}`, cursor: 'pointer', transition: 'transform 0.1s' }}
      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
      onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: cfg.color, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
          <span style={{ marginRight: 4 }}>{cfg.icon}</span>{cfg.label}
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4, background: c.bg, color: c.color, fontSize: 10, fontWeight: 700 }}>
          {iconBrecha(peor)}
          {peor === 'cuadra' ? 'OK' : peor === 'tolerable' ? 'TOL' : peor === 'descuadre' ? 'DESC' : 'PEND'}
        </span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 4 }}>{formatCLP(vendido)}</div>
      <div style={{ fontSize: 11, color: '#6B7280', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>Corrob: <strong style={{ color: brechaCorrob === 0 ? '#16A34A' : Math.abs(brechaCorrob) > params.umbral_tolerable ? '#DC2626' : '#D97706' }}>{brechaCorrob >= 0 ? '+' : ''}{formatCLP(brechaCorrob)}</strong></span>
        <span>Depós: {sinDep ? <em style={{ color: '#9CA3AF' }}>pendiente</em>
          : <strong style={{ color: brechaDep === 0 ? '#16A34A' : Math.abs(brechaDep) > params.umbral_tolerable ? '#DC2626' : '#D97706' }}>{brechaDep >= 0 ? '+' : ''}{formatCLP(brechaDep)}</strong>}</span>
      </div>
    </div>
  )
}

// ─── Tabla matriz expandible ─────────────────────────────────────────
function MatrizMedios({ datos, params, expandido, setExpandido }) {
  return (
    <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', fontSize: 13, fontWeight: 600, color: '#111827' }}>
        Matriz de conciliación · clic en una fila para detalle
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...TH, width: 32 }}></th>
            <th style={TH}>Medio</th>
            <th style={{ ...TH, textAlign: 'right' }}>Vendido</th>
            <th style={{ ...TH, textAlign: 'right' }}>Corroborado</th>
            <th style={{ ...TH, textAlign: 'right' }}>Δ Corrob</th>
            <th style={{ ...TH, textAlign: 'right' }}>Depositado</th>
            <th style={{ ...TH, textAlign: 'right' }}>Δ Depós</th>
            <th style={{ ...TH, textAlign: 'center' }}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {MEDIOS_CONFIG.map(m => {
            const v = datos.porMedio[m.key] ?? { declarado: 0, corroborado: 0 }
            const dep = datos.depositado[m.key] ?? 0
            const brechaCorr = v.corroborado - v.declarado
            const brechaDep  = dep - v.corroborado
            const sinDep = dep === 0 && m.key !== 'transferencia'
            const estCorr = clasificar(brechaCorr, params)
            const estDep  = sinDep ? 'pendiente' : clasificar(brechaDep, params)
            const peor = (estDep === 'descuadre' || estCorr === 'descuadre') ? 'descuadre'
              : (estDep === 'tolerable' || estCorr === 'tolerable') ? 'tolerable'
              : (sinDep ? 'pendiente' : 'cuadra')
            const c = colorBrecha(peor)
            const exp = expandido === m.key
            return (
              <Fragment key={m.key}>
                <tr
                  style={{ borderTop: '1px solid #F3F4F6', cursor: 'pointer', background: exp ? '#FAFAFA' : 'transparent' }}
                  onClick={() => setExpandido(exp ? null : m.key)}>
                  <td style={{ ...TD, color: '#9CA3AF' }}>
                    {exp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </td>
                  <td style={{ ...TD, fontWeight: 600, color: m.color }}>
                    <span style={{ marginRight: 6 }}>{m.icon}</span>{m.label}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{formatCLP(v.declarado)}</td>
                  <td style={{ ...TD, textAlign: 'right' }}>{formatCLP(v.corroborado)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 600, color: brechaCorr === 0 ? '#16A34A' : Math.abs(brechaCorr) > params.umbral_tolerable ? '#DC2626' : '#D97706' }}>
                    {brechaCorr >= 0 ? '+' : ''}{formatCLP(brechaCorr)}
                  </td>
                  <td style={{ ...TD, textAlign: 'right' }}>{sinDep ? <em style={{ color: '#9CA3AF' }}>pendiente</em> : formatCLP(dep)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 600, color: sinDep ? '#9CA3AF' : (brechaDep === 0 ? '#16A34A' : Math.abs(brechaDep) > params.umbral_tolerable ? '#DC2626' : '#D97706') }}>
                    {sinDep ? '—' : (brechaDep >= 0 ? '+' : '') + formatCLP(brechaDep)}
                  </td>
                  <td style={{ ...TD, textAlign: 'center' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 4, background: c.bg, color: c.color, fontSize: 11, fontWeight: 600 }}>
                      {iconBrecha(peor)}
                      {peor === 'cuadra' ? 'Cuadra' : peor === 'tolerable' ? 'Tolerable' : peor === 'descuadre' ? 'Descuadre' : 'Pendiente'}
                    </span>
                  </td>
                </tr>
                {exp && <ExpandedMedio medio={m} datos={datos} params={params} />}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Detalle expandido: drill-down día x día por medio ───────────────
function ExpandedMedio({ medio, datos, params }) {
  // Agregar por día: declarado, corroborado, depositado del medio
  const porDia = {}
  for (const c of datos.cierres) {
    if (!porDia[c.fecha]) porDia[c.fecha] = { fecha: c.fecha, decl: 0, corrob: 0, dep: 0, n_vendedores: 0 }
    porDia[c.fecha].decl   += Number(c[medio.key] ?? 0)
    porDia[c.fecha].corrob += Number(c[`${medio.key}_corrob`] ?? c[medio.key] ?? 0)
    porDia[c.fecha].n_vendedores++
  }
  // Cruzar fase 3 por fecha (efectivo y webpay por fecha del depósito, getnet por fecha_venta)
  const sumarDeposito = (rows, fechaKey, montoKey, filtro = null) => {
    for (const r of rows) {
      const f = r[fechaKey]
      if (!f || (filtro && !filtro(r))) continue
      if (!porDia[f]) porDia[f] = { fecha: f, decl: 0, corrob: 0, dep: 0, n_vendedores: 0 }
      porDia[f].dep += Number(r[montoKey] ?? 0)
    }
  }
  if (medio.key === 'efectivo')      sumarDeposito(datos.raw.depEfectivo, 'fecha', 'monto_depositado')
  else if (medio.key === 'webpay')   sumarDeposito(datos.raw.webpay, 'fecha', 'deposito_transbank')
  else if (medio.key === 't_credito') sumarDeposito(datos.raw.getnetTx, 'fecha_venta', 'monto_abono', r => /CRED/i.test(r.tipo_pago ?? ''))
  else if (medio.key === 't_debito')  sumarDeposito(datos.raw.getnetTx, 'fecha_venta', 'monto_abono', r => /DEB/i.test(r.tipo_pago ?? ''))

  const filas = Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha))
  const sinDatos = filas.every(f => f.decl === 0 && f.corrob === 0 && f.dep === 0)

  return (
    <tr>
      <td colSpan={8} style={{ padding: 0, background: '#FAFAFA' }}>
        <div style={{ padding: '12px 20px 16px 48px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 8, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
            Detalle diario · {medio.label} · tolerancia depósito: {params.tol_dias[medio.key]} día{params.tol_dias[medio.key] !== 1 ? 's' : ''}
          </div>
          {sinDatos ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>Sin movimientos para este medio en el período</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, fontSize: 10 }}>Fecha</th>
                  <th style={{ ...TH, textAlign: 'right', fontSize: 10 }}>Vendedores</th>
                  <th style={{ ...TH, textAlign: 'right', fontSize: 10 }}>Declarado</th>
                  <th style={{ ...TH, textAlign: 'right', fontSize: 10 }}>Corroborado</th>
                  <th style={{ ...TH, textAlign: 'right', fontSize: 10 }}>Δ Corrob</th>
                  <th style={{ ...TH, textAlign: 'right', fontSize: 10 }}>Depositado</th>
                  <th style={{ ...TH, textAlign: 'right', fontSize: 10 }}>Δ Depós</th>
                </tr>
              </thead>
              <tbody>
                {filas.filter(f => f.decl > 0 || f.corrob > 0 || f.dep > 0).map(f => {
                  const dC = f.corrob - f.decl
                  const dD = f.dep - f.corrob
                  const sinDep = f.dep === 0 && medio.key !== 'transferencia'
                  return (
                    <tr key={f.fecha} style={{ borderTop: '1px solid #F3F4F6' }}>
                      <td style={{ ...TD, fontSize: 12 }}>{f.fecha}</td>
                      <td style={{ ...TD, fontSize: 12, textAlign: 'right', color: '#6B7280' }}>{f.n_vendedores || '—'}</td>
                      <td style={{ ...TD, fontSize: 12, textAlign: 'right' }}>{formatCLP(f.decl)}</td>
                      <td style={{ ...TD, fontSize: 12, textAlign: 'right' }}>{formatCLP(f.corrob)}</td>
                      <td style={{ ...TD, fontSize: 12, textAlign: 'right', fontWeight: 600, color: Math.abs(dC) <= params.umbral_cuadra ? '#16A34A' : Math.abs(dC) > params.umbral_tolerable ? '#DC2626' : '#D97706' }}>
                        {dC >= 0 ? '+' : ''}{formatCLP(dC)}
                      </td>
                      <td style={{ ...TD, fontSize: 12, textAlign: 'right' }}>{sinDep ? <em style={{ color: '#9CA3AF' }}>—</em> : formatCLP(f.dep)}</td>
                      <td style={{ ...TD, fontSize: 12, textAlign: 'right', fontWeight: 600, color: sinDep ? '#9CA3AF' : Math.abs(dD) <= params.umbral_cuadra ? '#16A34A' : Math.abs(dD) > params.umbral_tolerable ? '#DC2626' : '#D97706' }}>
                        {sinDep ? '—' : (dD >= 0 ? '+' : '') + formatCLP(dD)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── Generador de alertas inteligentes ───────────────────────────────
function generarAlertas(datos, params) {
  const alertas = []

  // 1. Descuadres consecutivos por vendedor × medio
  const porVendMedio = {} // { 'vendId|medio': [{fecha, brecha}, ...] }
  for (const c of datos.cierres) {
    if (!c.vendedor_id && !c.vendedor_nombre) continue
    const vid = c.vendedor_id ?? c.vendedor_nombre
    for (const m of MEDIOS_CONFIG) {
      const decl = Number(c[m.key] ?? 0)
      const corr = Number(c[`${m.key}_corrob`] ?? c[m.key] ?? 0)
      if (decl === 0 && corr === 0) continue
      const brecha = corr - decl
      if (Math.abs(brecha) <= params.umbral_cuadra) continue // cuadra: no contar
      const key = `${vid}|${m.key}`
      if (!porVendMedio[key]) porVendMedio[key] = []
      porVendMedio[key].push({ fecha: c.fecha, brecha, nombre: c.vendedor_nombre ?? `Vendedor ${vid}`, medio: m })
    }
  }
  for (const [key, items] of Object.entries(porVendMedio)) {
    if (items.length >= params.alerta_recurrentes) {
      const orden = items.sort((a, b) => a.fecha.localeCompare(b.fecha))
      const total = orden.reduce((s, x) => s + Math.abs(x.brecha), 0)
      alertas.push({
        tipo: 'patron_vendedor',
        severidad: items.length >= params.alerta_recurrentes + 2 ? 'alta' : 'media',
        titulo: `${orden[0].nombre}: ${items.length} descuadres en ${orden[0].medio.label}`,
        detalle: `Acumulado: ${formatCLP(total)} · primer descuadre ${orden[0].fecha}, último ${orden[orden.length - 1].fecha}`,
        icon: <Users size={14} />,
      })
    }
  }

  // 2. Días con brecha BSALE > umbral_tolerable
  const porDiaBsale = {}
  for (const c of datos.cierres) {
    if (c.venta_bsale_api == null) continue
    const key = `${c.fecha}|${c.sucursal_id}`
    if (!porDiaBsale[key]) porDiaBsale[key] = { fecha: c.fecha, sucursal: c.sucursal_nombre, bsale: Number(c.venta_bsale_api), decl: 0 }
    porDiaBsale[key].decl += Number(c.total_declarado ?? 0)
  }
  for (const v of Object.values(porDiaBsale)) {
    const brecha = v.decl - v.bsale
    if (Math.abs(brecha) > params.umbral_tolerable) {
      alertas.push({
        tipo: 'brecha_bsale_dia',
        severidad: Math.abs(brecha) > params.umbral_tolerable * 3 ? 'alta' : 'media',
        titulo: `${v.sucursal ?? 'Sucursal'} · ${v.fecha}: brecha BSALE ${formatCLP(brecha)}`,
        detalle: `BSALE registró ${formatCLP(v.bsale)}, vendedores declararon ${formatCLP(v.decl)}`,
        icon: <TrendingDown size={14} />,
      })
    }
  }

  // 3. Medios sin depósito en período (excluyendo transferencia)
  for (const m of MEDIOS_CONFIG) {
    if (m.key === 'transferencia') continue
    const corrob = datos.porMedio[m.key]?.corroborado ?? 0
    const dep = datos.depositado[m.key] ?? 0
    if (corrob > params.umbral_tolerable && dep === 0) {
      alertas.push({
        tipo: 'sin_deposito',
        severidad: 'alta',
        titulo: `${m.label}: ${formatCLP(corrob)} corroborado sin depósito asociado`,
        detalle: `Verifica conciliación del medio en el período seleccionado`,
        icon: <Clock size={14} />,
      })
    }
  }

  // 4. Cierres pendientes de corroborar
  const pendientes = datos.cierres.filter(c => c.estado === 'declarado')
  if (pendientes.length > 0) {
    alertas.push({
      tipo: 'pendientes',
      severidad: pendientes.length > 10 ? 'alta' : 'baja',
      titulo: `${pendientes.length} cierres pendientes de corroborar`,
      detalle: `Sin corroboración no hay validación contra depósito`,
      icon: <Calendar size={14} />,
    })
  }

  // Ordenar: alta → media → baja
  const rank = { alta: 0, media: 1, baja: 2 }
  alertas.sort((a, b) => rank[a.severidad] - rank[b.severidad])
  return alertas
}

function AlertasPanel({ alertas }) {
  if (alertas.length === 0) {
    return (
      <div style={{ ...cardSt, padding: '20px 24px', textAlign: 'center', background: '#F0FDF4', borderLeft: '4px solid #16A34A' }}>
        <CheckCircle2 size={20} style={{ color: '#16A34A', marginBottom: 6 }} />
        <div style={{ fontSize: 13, fontWeight: 600, color: '#166534' }}>Sin alertas en este período</div>
        <div style={{ fontSize: 11, color: '#15803D', marginTop: 4 }}>Todos los medios están conciliados dentro de los umbrales configurados</div>
      </div>
    )
  }
  return (
    <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Alertas detectadas ({alertas.length})</span>
        <span style={{ fontSize: 10, color: '#6B7280' }}>
          🔴 {alertas.filter(a => a.severidad === 'alta').length} alta ·
          🟡 {alertas.filter(a => a.severidad === 'media').length} media ·
          🔵 {alertas.filter(a => a.severidad === 'baja').length} baja
        </span>
      </div>
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {alertas.map((a, i) => {
          const sevColor = a.severidad === 'alta' ? '#DC2626' : a.severidad === 'media' ? '#D97706' : '#1D4ED8'
          const sevBg    = a.severidad === 'alta' ? '#FEE2E2' : a.severidad === 'media' ? '#FEF9C3' : '#DBEAFE'
          return (
            <div key={i} style={{ padding: '10px 16px', borderTop: i === 0 ? 'none' : '1px solid #F3F4F6', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ background: sevBg, color: sevColor, padding: 6, borderRadius: 6, flexShrink: 0 }}>{a.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{a.titulo}</div>
                <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{a.detalle}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Componente principal ────────────────────────────────────────────
export function ConciliacionFasesTab({ usuario }) {
  const now = new Date()
  const [anio, setAnio] = useState(now.getFullYear())
  const [mes, setMes] = useState(now.getMonth() + 1)
  const puedeElegirSuc = PUEDE_TODO.includes(usuario.rol)
  const [sucursales, setSucursales] = useState([])
  const [sucursal, setSucursal] = useState(puedeElegirSuc ? 'all' : (usuario.sucursal_id ?? ''))
  const [datos, setDatos] = useState(null)
  const [params, setParams] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandido, setExpandido] = useState(null)

  const sucursalEf = sucursal === 'all' ? null : sucursal || null
  const anios = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

  useEffect(() => {
    fetchSucursales().then(setSucursales).catch(() => {})
    fetchParamsConciliacion().then(setParams).catch(() => {})
  }, [])

  useEffect(() => {
    if (!params) return
    setLoading(true)
    fetchConciliacion3Fases({ anio, mes, sucursal_id: sucursalEf })
      .then(raw => {
        const sumas = sumarPorMedio(raw.cierres)
        const fase3 = agregarFase3PorMedio(raw)
        const depositado = {
          efectivo:      fase3.efectivo.total,
          t_credito:     fase3.t_credito.total,
          t_debito:      fase3.t_debito.total,
          webpay:        fase3.webpay.total,
          transferencia: fase3.transferencia.total,
        }
        setDatos({ ...sumas, depositado, cierres: raw.cierres, raw })
      })
      .catch(e => toast.error('Error: ' + e.message))
      .finally(() => setLoading(false))
  }, [anio, mes, sucursalEf, params])

  const alertas = useMemo(() => {
    if (!datos || !params) return []
    return generarAlertas(datos, params)
  }, [datos, params])

  const totalVendido = useMemo(() => {
    if (!datos) return 0
    return MEDIOS_CONFIG.reduce((s, m) => s + (datos.porMedio[m.key]?.declarado ?? 0), 0)
  }, [datos])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Filtros */}
      <div style={cardSt}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={labelSt}>Año</label>
            <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
              {anios.map(a => <option key={a} value={String(a)}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={labelSt}>Mes</label>
            <select style={selectSt} value={String(mes)} onChange={e => setMes(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={String(m)}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelSt}>Sucursal</label>
            <select style={selectSt} value={sucursal} disabled={!puedeElegirSuc} onChange={e => setSucursal(e.target.value)}>
              {puedeElegirSuc && <option value="all">Todas</option>}
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          {datos && (
            <div style={{ alignSelf: 'flex-end', textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total declarado</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{formatCLP(totalVendido)}</div>
              {datos.bsaleTotal > 0 && (
                <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                  BSALE: {formatCLP(datos.bsaleTotal)} · Brecha: <strong style={{ color: Math.abs(totalVendido - datos.bsaleTotal) > (params?.umbral_tolerable ?? 0) ? '#DC2626' : '#16A34A' }}>
                    {(totalVendido - datos.bsaleTotal) >= 0 ? '+' : ''}{formatCLP(totalVendido - datos.bsaleTotal)}
                  </strong>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ ...cardSt, padding: 60, textAlign: 'center' }}>
          <Loader2 size={24} style={{ color: '#9CA3AF', animation: 'spin 1s linear infinite' }} />
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 10 }}>Cargando conciliación de 3 fases…</div>
        </div>
      )}

      {!loading && datos && params && (
        <>
          {/* Píldoras por medio */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            {MEDIOS_CONFIG.map(m => (
              <PildoraMedio key={m.key} medio={m.key} cfg={m}
                vendido={datos.porMedio[m.key]?.declarado ?? 0}
                corroborado={datos.porMedio[m.key]?.corroborado ?? 0}
                depositado={datos.depositado[m.key] ?? 0}
                params={params}
                onClick={() => setExpandido(expandido === m.key ? null : m.key)} />
            ))}
          </div>

          {/* Matriz con drill-down */}
          <MatrizMedios datos={datos} params={params} expandido={expandido} setExpandido={setExpandido} />

          {/* Alertas inteligentes */}
          <AlertasPanel alertas={alertas} />
        </>
      )}
    </div>
  )
}
