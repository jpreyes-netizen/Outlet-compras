import { useEffect, useMemo, useState, Fragment } from 'react'
import { toast } from 'sonner'
import { Download, RefreshCw, Pencil, X, ExternalLink } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import { fetchRrhhValores, mergeRrhhSobreEerr } from '../analisis/rrhh_source'

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const ANIOS = [2024, 2025, 2026]
const ROLES_EDIT = ['admin', 'admin_sistema', 'contabilidad', 'jefe_admin_finanzas', 'gerente_admin_finanzas']
/* Confidencialidad REM_SOCIOS: solo el directorio ve la línea separada.
   Para el resto de roles se fusiona con REM_ADMIN como
   "Remuneraciones Administración y Dirección" (totales idénticos, detalle indeducible). */
const ROLES_VE_SOCIOS = ['admin', 'admin_sistema', 'dir_general', 'dir_negocios']

const ORDEN_CODIGOS = [
  'VENTA_BRUTA','VENTA_NETA','COSTO_NETO','MARGEN_CONTRIB',
  'REM_OPERACION','TOTAL_GASTO_OPER','TOTAL_MARGEN_BRUTO',
  'REM_VENTA','MARKETING','COMISION_GETNET','TOTAL_GASTO_VENTA',
  'GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS',
  'COMBUSTIBLE','REM_ADMIN','REM_SOCIOS','FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN',
  'TRANSPORTE_VIATICOS',
  'TOTAL_GASTO_OPERATIVO','RESULTADO_OPERACIONAL',
  'INTERES_CREDITOS','RESULTADO_NETO',
  'IVA_SII',
]

const SUBTOTAL_CODES = new Set([
  'VENTA_NETA','MARGEN_CONTRIB','TOTAL_GASTO_OPER','TOTAL_MARGEN_BRUTO',
  'TOTAL_GASTO_VENTA','TOTAL_GASTO_OPERATIVO','RESULTADO_OPERACIONAL',
  'RESULTADO_NETO',
])
const BLOQUE_AZUL = new Set(['VENTA_BRUTA','VENTA_NETA','COSTO_NETO','MARGEN_CONTRIB'])
const BLOQUE_GRIS = new Set(['INTERES_CREDITOS','IVA_SII'])
const RESULTADOS_GRANDES = new Set(['RESULTADO_OPERACIONAL','RESULTADO_NETO'])

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const fmt = v => { if (!v || Math.round(v) === 0) return '—'; return fmtCLP(v) }

async function fetchEerr(anio) {
  const yStart = `${anio}-01-01`, yEnd = `${anio}-12-31`

  const [lineasR, mapeoR, ventasR, movsR, comprasR, ajustesR, subcuentasR, userR] = await Promise.all([
    supabase.from('eerr_lineas').select('*').eq('activo', true).order('orden'),
    supabase.from('eerr_mapeo').select('eerr_linea_id, cuenta_madre_id, fuente, signo'),
    supabase.from('ventas_bsale_dia').select('fecha, total_venta').gte('fecha', yStart).lte('fecha', yEnd),
    supabase.from('movimientos_bancarios').select('fecha, monto, subcuenta_id').gte('fecha', yStart).lte('fecha', yEnd).lt('monto', 0).not('subcuenta_id', 'is', null),
    (async () => {
      let r = await supabase.from('libro_compras').select('fecha_emision, monto_neto, subcuenta_id, estado').gte('fecha_emision', yStart).lte('fecha_emision', yEnd).not('subcuenta_id', 'is', null).neq('estado', 'anulado')
      if (r.error && /column .* does not exist/i.test(r.error.message)) {
        r = await supabase.from('libro_compras').select('fecha_emision, monto_neto, subcuenta_id').gte('fecha_emision', yStart).lte('fecha_emision', yEnd).not('subcuenta_id', 'is', null)
      }
      if (r.error) return { data: [], error: null }
      return r
    })(),
    supabase.from('eerr_ajustes_manuales').select('eerr_linea_id, mes, monto').eq('anio', anio).is('sucursal_id', null),
    supabase.from('subcuentas').select('id, cuenta_madre_id, nombre'),
    supabase.auth.getUser(),
  ])

  if (lineasR.error) throw new Error('eerr_lineas: ' + lineasR.error.message)
  if (mapeoR.error) throw new Error('eerr_mapeo: ' + mapeoR.error.message)
  if (ventasR.error) throw new Error('ventas_bsale_dia: ' + ventasR.error.message)
  if (movsR.error) throw new Error('movimientos_bancarios: ' + movsR.error.message)
  if (ajustesR.error) throw new Error('eerr_ajustes_manuales: ' + ajustesR.error.message)

  const subcuentaToMadre = new Map()
  const subcuentaNombre = new Map()
  ;(subcuentasR.data ?? []).forEach(s => {
    if (s?.id && s?.cuenta_madre_id) subcuentaToMadre.set(s.id, s.cuenta_madre_id)
    if (s?.id) subcuentaNombre.set(s.id, s.nombre ?? '')
  })

  const userId = userR.data.user?.id ?? null
  let rol = null
  if (userId) {
    const { data: u } = await supabase.from('usuarios').select('rol').eq('auth_uid', userId).maybeSingle()
    rol = u?.rol ?? null
  }

  const ventasPorMes = new Array(12).fill(0)
  ;(ventasR.data ?? []).forEach(v => { const m = new Date(v.fecha).getUTCMonth(); ventasPorMes[m] += Number(v.total_venta ?? 0) })

  const gastosPorCuentaMes = new Map()
  ;(movsR.data ?? []).forEach(r => {
    const cm = r.subcuenta_id ? subcuentaToMadre.get(r.subcuenta_id) : null
    if (!cm) return
    const m = new Date(r.fecha).getUTCMonth()
    if (!gastosPorCuentaMes.has(cm)) gastosPorCuentaMes.set(cm, new Array(12).fill(0))
    gastosPorCuentaMes.get(cm)[m] += Math.abs(Number(r.monto ?? 0))
  })

  const comprasPorCuentaMes = new Map()
  ;(comprasR.data ?? []).forEach(r => {
    const cm = r.subcuenta_id ? subcuentaToMadre.get(r.subcuenta_id) : null
    if (!cm) return
    const m = new Date(r.fecha_emision).getUTCMonth()
    if (!comprasPorCuentaMes.has(cm)) comprasPorCuentaMes.set(cm, new Array(12).fill(0))
    comprasPorCuentaMes.get(cm)[m] += Number(r.monto_neto ?? 0)
  })

  const lineas = lineasR.data ?? []
  const getnetId = lineas.find(l => l.codigo === 'COMISION_GETNET')?.id
  const costoNetoId = lineas.find(l => l.codigo === 'COSTO_NETO')?.id
  const ajustesGetnet = new Array(12).fill(0)
  const ajustesCostoNeto = new Array(12).fill(0)
  const ajustesCostoNetoCargado = new Array(12).fill(false)  // true si hay valor manual (aunque sea 0)
  ;(ajustesR.data ?? []).forEach(a => {
    if (a.eerr_linea_id === getnetId && a.mes >= 1 && a.mes <= 12) {
      ajustesGetnet[a.mes - 1] = Number(a.monto ?? 0)
    }
    if (a.eerr_linea_id === costoNetoId && a.mes >= 1 && a.mes <= 12) {
      ajustesCostoNeto[a.mes - 1] = Number(a.monto ?? 0)
      ajustesCostoNetoCargado[a.mes - 1] = true
    }
  })

  return { lineas, mapeo: mapeoR.data ?? [], ventasPorMes, gastosPorCuentaMes, comprasPorCuentaMes, ajustesGetnet, ajustesCostoNeto, ajustesCostoNetoCargado, rol, userId, subcuentaToMadre, subcuentaNombre }
}

function calcularValores(data) {
  const vals = new Map()
  const lineasPorId = new Map()
  data.lineas.forEach(l => lineasPorId.set(l.id, l))
  ORDEN_CODIGOS.forEach(c => vals.set(c, new Array(12).fill(0)))

  data.mapeo.forEach(mp => {
    const linea = lineasPorId.get(mp.eerr_linea_id)
    if (!linea) return
    const arr = vals.get(linea.codigo)
    if (!arr) return
    const signo = Number(mp.signo ?? 1)
    const fuente = (mp.fuente ?? '').toLowerCase()
    if (fuente === 'compras' || fuente === 'libro_compras') {
      const v = data.comprasPorCuentaMes.get(mp.cuenta_madre_id)
      if (v) for (let i = 0; i < 12; i++) arr[i] += v[i] * signo
    } else {
      const v = data.gastosPorCuentaMes.get(mp.cuenta_madre_id)
      if (v) for (let i = 0; i < 12; i++) arr[i] += v[i] * signo
    }
  })

  const vb = vals.get('VENTA_BRUTA')
  for (let i = 0; i < 12; i++) vb[i] = data.ventasPorMes[i]

  const getnet = vals.get('COMISION_GETNET')
  for (let i = 0; i < 12; i++) getnet[i] = data.ajustesGetnet[i]

  // COSTO_NETO: ajuste manual sobreescribe cualquier cálculo desde banco/compras.
  // Si el mes tiene ajuste cargado, usa ese valor (incluso si es 0). Si no, queda en 0
  // (porque libro_compras no tiene subcuenta_id, no se puede calcular automáticamente).
  const costoNeto = vals.get('COSTO_NETO')
  for (let i = 0; i < 12; i++) {
    if (data.ajustesCostoNetoCargado?.[i]) {
      costoNeto[i] = data.ajustesCostoNeto[i]
    }
  }

  const get = c => vals.get(c)
  const sumCodes = (codes, i) => codes.reduce((acc, c) => acc + (get(c)?.[i] ?? 0), 0)

  for (let i = 0; i < 12; i++) {
    get('VENTA_NETA')[i] = get('VENTA_BRUTA')[i] / 1.19
    get('MARGEN_CONTRIB')[i] = get('VENTA_NETA')[i] - get('COSTO_NETO')[i]
    get('TOTAL_GASTO_OPER')[i] = get('REM_OPERACION')[i]
    get('TOTAL_MARGEN_BRUTO')[i] = get('MARGEN_CONTRIB')[i] - get('TOTAL_GASTO_OPER')[i]
    get('TOTAL_GASTO_VENTA')[i] = get('REM_VENTA')[i] + get('MARKETING')[i] + get('COMISION_GETNET')[i]
    get('TOTAL_GASTO_OPERATIVO')[i] = sumCodes(['GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS','COMBUSTIBLE','REM_ADMIN','REM_SOCIOS','FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS','REM_PREVIRED'], i)
    get('RESULTADO_OPERACIONAL')[i] = get('TOTAL_MARGEN_BRUTO')[i] - get('TOTAL_GASTO_VENTA')[i] - get('TOTAL_GASTO_OPERATIVO')[i]
    get('RESULTADO_NETO')[i] = get('RESULTADO_OPERACIONAL')[i] - get('INTERES_CREDITOS')[i]
  }

  return vals
}

function GetnetCell({ value, onSave }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(String(Math.round(value || 0)))
  useEffect(() => { setV(String(Math.round(value || 0))) }, [value])
  if (!edit) return (
    <button onClick={e => { e.stopPropagation(); setEdit(true) }} title="Editar (clic en el resto de la celda para ver el detalle)"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, borderRadius: 4, padding: '1px 4px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'inherit' }}>
      <span>{fmt(value)}</span>
      <Pencil size={10} style={{ opacity: 0.5 }} />
    </button>
  )
  return (
    <input autoFocus type="number" value={v} onChange={e => setV(e.target.value)}
      onBlur={() => { setEdit(false); onSave(Number(v) || 0) }}
      onKeyDown={e => { if (e.key === 'Enter') { setEdit(false); onSave(Number(v) || 0) } if (e.key === 'Escape') { setEdit(false); setV(String(Math.round(value || 0))) } }}
      style={{ width: 90, borderRadius: 5, border: '1px solid #3B82F6', background: '#fff', padding: '1px 4px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}
    />
  )
}

/* ═══ Constantes de secciones visuales (rediseño v2) ═══ */
const SECCIONES = {
  VENTA_BRUTA: 'VENTAS Y MARGEN',
  REM_OPERACION: 'GASTOS DE OPERACIÓN',
  REM_VENTA: 'GASTOS DE VENTA',
  GASTOS_BANCARIOS: 'GASTOS OPERATIVOS Y ADMINISTRACIÓN',
  RESULTADO_OPERACIONAL: 'RESULTADO',
}
const LINEAS_HIJA = new Set([
  'REM_OPERACION','REM_VENTA','MARKETING','COMISION_GETNET',
  'GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS',
  'COMBUSTIBLE','REM_ADMIN','REM_SOCIOS','FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN',
  'TRANSPORTE_VIATICOS','INTERES_CREDITOS',
])

const fmtM = n => {
  const abs = Math.abs(n || 0)
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'MM'
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'
  return fmtCLP(n)
}

/* Mini sparkline SVG inline (sin dependencias) */
function Sparkline({ datos, color = '#1F4E79' }) {
  const vals = datos.filter(v => v !== null && v !== undefined)
  if (vals.length < 2) return <span style={{ color: '#D1D5DB', fontSize: 10 }}>—</span>
  const min = Math.min(...vals), max = Math.max(...vals)
  const range = max - min || 1
  const W = 64, H = 20, PAD = 2
  const pts = datos.map((v, i) => {
    if (v === null || v === undefined) return null
    const x = PAD + (i / (datos.length - 1)) * (W - PAD * 2)
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).filter(Boolean).join(' ')
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/* KPI card de cabecera */
function KpiCard({ label, valor, sub, color, pctBadge }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
      <div style={{ height: 4, background: color ?? '#6B7280' }} />
      <div style={{ padding: '11px 14px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 19, fontWeight: 700, fontFamily: 'monospace', color: color ?? '#111827' }}>{valor}</span>
          {pctBadge != null && (
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', padding: '1px 6px', borderRadius: 5, background: (color ?? '#6B7280') + '18', color: color ?? '#6B7280' }}>
              {pctBadge}
            </span>
          )}
        </div>
        {sub && <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  )
}

/* ═══════════ DRILL-DOWN: de dónde viene cada número ═══════════
   Al hacer clic en el monto de un mes se abre este informe, que muestra
   la composición del valor y su fuente de datos exacta. */

const MAP_RRHH_CODIGO = { REM_OPERACION: '600', REM_VENTA: '610', REM_ADMIN: '760', REM_SOCIOS: '761' }

const FORMULAS = {
  VENTA_NETA:            { texto: 'Venta Bruta ÷ 1,19', comps: [['VENTA_BRUTA', 1]], divisor: 1.19 },
  MARGEN_CONTRIB:        { texto: 'Venta Neta − Costo Neto', comps: [['VENTA_NETA', 1], ['COSTO_NETO', -1]] },
  TOTAL_GASTO_OPER:      { texto: 'Remuneraciones Operación', comps: [['REM_OPERACION', 1]] },
  TOTAL_MARGEN_BRUTO:    { texto: 'Margen Contribución − Total Gasto Operación', comps: [['MARGEN_CONTRIB', 1], ['TOTAL_GASTO_OPER', -1]] },
  TOTAL_GASTO_VENTA:     { texto: 'Rem. Venta + Marketing + Comisión Getnet', comps: [['REM_VENTA', 1], ['MARKETING', 1], ['COMISION_GETNET', 1]] },
  TOTAL_GASTO_OPERATIVO: { texto: 'Suma de los gastos operativos y de administración', comps: [['GASTOS_BANCARIOS',1],['MOBILIARIO',1],['SERVICIOS_EXTERNOS',1],['ARRIENDO',1],['CUENTAS_BASICAS',1],['COMBUSTIBLE',1],['REM_ADMIN',1],['REM_SOCIOS',1],['FINIQUITOS',1],['GASTOS_TI',1],['OTROS_GASTOS_ADMIN',1],['TRANSPORTE_VIATICOS',1]] },
  RESULTADO_OPERACIONAL: { texto: 'Total Margen Bruto − Gasto Venta − Gasto Operativo', comps: [['TOTAL_MARGEN_BRUTO',1],['TOTAL_GASTO_VENTA',-1],['TOTAL_GASTO_OPERATIVO',-1]] },
  RESULTADO_NETO:        { texto: 'Resultado Operacional − Interés Créditos', comps: [['RESULTADO_OPERACIONAL',1],['INTERES_CREDITOS',-1]] },
}

function tipoOrigen(codigo) {
  if (FORMULAS[codigo]) return 'formula'
  if (MAP_RRHH_CODIGO[codigo]) return 'rrhh'
  if (codigo === 'VENTA_BRUTA') return 'bsale'
  if (codigo === 'COSTO_NETO' || codigo === 'COMISION_GETNET') return 'manual'
  return 'banco'
}

const ORIGEN_TEXTO = {
  bsale:   { fuente: 'ventas_bsale_dia', desc: 'Documentos emitidos en BSALE (boletas, facturas y tickets, menos notas de crédito), sincronizados a diario por el proceso automático de ventas.' },
  banco:   { fuente: 'movimientos_bancarios', desc: 'Cargos de la cartola clasificados en las subcuentas que el mapeo del EERR asocia a esta línea. Se agrupan por la fecha real del movimiento.' },
  compras: { fuente: 'libro_compras', desc: 'Facturas de proveedores del libro de compras, por monto neto y fecha de emisión.' },
  manual:  { fuente: 'eerr_ajustes_manuales', desc: 'Valor ingresado a mano en el EERR. No se calcula automáticamente: lo carga un usuario autorizado mes a mes.' },
  rrhh:    { fuente: 'v_rrhh_master + v_rrhh_costo_empresa', desc: 'Costo empresa devengado del módulo de Gestión de Personas: haberes de las liquidaciones más los aportes patronales prorrateados. No usa lo pagado por banco.' },
  formula: { fuente: 'cálculo del EERR', desc: 'Línea calculada a partir de otras líneas del estado de resultados.' },
}

function DetalleModal({ ctx, anio, data, valores, veSocios, lineaPorCodigo, nombreLinea, onClose }) {
  const { codigo, mesIdx } = ctx
  const [rows, setRows] = useState(null)
  const [extra, setExtra] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const tipo = tipoOrigen(codigo)
  const valor = (valores.get(codigo) ?? [])[mesIdx] ?? 0
  const mm = String(mesIdx + 1).padStart(2, '0')
  const desde = `${anio}-${mm}-01`
  const hasta = new Date(Date.UTC(anio, mesIdx + 1, 0)).toISOString().split('T')[0]
  const linea = lineaPorCodigo.get(codigo)

  useEffect(() => {
    const onEsc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setLoading(true); setErr(null); setRows(null); setExtra(null)
      try {
        if (tipo === 'formula') {
          const f = FORMULAS[codigo]
          let comps = f.comps.map(([c, sg]) => ({
            codigo: c, nombre: nombreLinea(c), signo: sg,
            monto: ((valores.get(c) ?? [])[mesIdx] ?? 0) * sg,
          }))
          if (!veSocios) comps = comps.filter(c => c.codigo !== 'REM_SOCIOS')
          comps = comps.filter(c => Math.round(c.monto) !== 0)
          if (!cancelado) setRows(comps)
        }

        else if (tipo === 'bsale') {
          const { data: v, error } = await supabase.from('ventas_bsale_dia')
            .select('fecha, sucursal_id, total_venta, total_nc, docs_venta, docs_nc')
            .gte('fecha', desde).lte('fecha', hasta).order('fecha')
          if (error) throw error
          const porSuc = new Map()
          const porDia = new Map()
          ;(v ?? []).forEach(r => {
            const s = porSuc.get(r.sucursal_id) ?? { sucursal: r.sucursal_id, monto: 0, docs: 0, nc: 0, dias: 0 }
            s.monto += Number(r.total_venta ?? 0); s.docs += Number(r.docs_venta ?? 0)
            s.nc += Number(r.total_nc ?? 0); if (Number(r.total_venta ?? 0) !== 0) s.dias += 1
            porSuc.set(r.sucursal_id, s)
            porDia.set(r.fecha, (porDia.get(r.fecha) ?? 0) + Number(r.total_venta ?? 0))
          })
          if (!cancelado) {
            setRows([...porSuc.values()].sort((a, b) => b.monto - a.monto))
            setExtra([...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])))
          }
        }

        else if (tipo === 'manual') {
          const { data: aj, error } = await supabase.from('eerr_ajustes_manuales')
            .select('*').eq('eerr_linea_id', linea?.id).eq('anio', anio).eq('mes', mesIdx + 1).is('sucursal_id', null)
          if (error) throw error
          const reg = (aj ?? [])[0] ?? null
          let quien = null
          if (reg?.usuario_id) {
            const { data: u } = await supabase.from('usuarios').select('nombre, correo').eq('auth_uid', reg.usuario_id).maybeSingle()
            quien = u ?? null
          }
          if (!cancelado) { setRows(reg ? [reg] : []); setExtra(quien) }
        }

        else if (tipo === 'rrhh') {
          const per = `${anio}-${mm}`
          const codigos = (!veSocios && codigo === 'REM_ADMIN') ? ['760', '761'] : [MAP_RRHH_CODIGO[codigo]]
          const { data: mst, error } = await supabase.from('v_rrhh_master')
            .select('periodo, cuenta_madre_codigo, naturaleza, monto').eq('periodo', per)
          if (error) throw error
          const porNat = new Map()
          let haberes = 0
          ;(mst ?? []).forEach(r => {
            if (!codigos.includes(String(r.cuenta_madre_codigo))) return
            const nat = r.naturaleza ?? 'sin naturaleza'
            if (!['haber_imponible', 'haber_no_imponible', 'honorario'].includes(nat)) return
            const m = Number(r.monto ?? 0)
            porNat.set(nat, (porNat.get(nat) ?? 0) + m)
            haberes += m
          })
          const lista = [...porNat.entries()].map(([nat, monto]) => ({ concepto: nat, monto }))
          lista.push({ concepto: 'aportes patronales prorrateados', monto: valor - haberes, esCalculado: true })
          if (!cancelado) setRows(lista)
        }

        else { // banco / compras
          const mapeos = (data.mapeo ?? []).filter(m => m.eerr_linea_id === linea?.id)
          const esCompras = f => ['compras', 'libro_compras'].includes((f ?? '').toLowerCase())
          const cmBanco = new Set(mapeos.filter(m => !esCompras(m.fuente)).map(m => m.cuenta_madre_id))
          const cmCompras = new Set(mapeos.filter(m => esCompras(m.fuente)).map(m => m.cuenta_madre_id))
          const out = []
          if (cmBanco.size) {
            const { data: mv, error } = await supabase.from('movimientos_bancarios')
              .select('fecha, monto, descripcion, n_documento, subcuenta_id, origen')
              .gte('fecha', desde).lte('fecha', hasta).lt('monto', 0).not('subcuenta_id', 'is', null)
              .order('fecha')
            if (error) throw error
            ;(mv ?? []).forEach(r => {
              const cm = data.subcuentaToMadre?.get(r.subcuenta_id)
              if (!cm || !cmBanco.has(cm)) return
              out.push({
                fecha: r.fecha, monto: Math.abs(Number(r.monto ?? 0)),
                descripcion: r.descripcion ?? '', doc: r.n_documento ?? '',
                subcuenta: data.subcuentaNombre?.get(r.subcuenta_id) ?? '',
                origen: r.origen ?? 'banco', tabla: 'movimientos_bancarios',
              })
            })
          }
          if (cmCompras.size) {
            const { data: lc } = await supabase.from('libro_compras')
              .select('fecha_emision, monto_neto, subcuenta_id, proveedor_nombre, folio')
              .gte('fecha_emision', desde).lte('fecha_emision', hasta).not('subcuenta_id', 'is', null)
            ;(lc ?? []).forEach(r => {
              const cm = data.subcuentaToMadre?.get(r.subcuenta_id)
              if (!cm || !cmCompras.has(cm)) return
              out.push({
                fecha: r.fecha_emision, monto: Number(r.monto_neto ?? 0),
                descripcion: r.proveedor_nombre ?? '', doc: r.folio ?? '',
                subcuenta: data.subcuentaNombre?.get(r.subcuenta_id) ?? '',
                origen: 'libro_compras', tabla: 'libro_compras',
              })
            })
          }
          out.sort((a, b) => b.monto - a.monto)
          if (!cancelado) setRows(out)
        }
      } catch (e) {
        if (!cancelado) setErr(e.message ?? String(e))
      } finally {
        if (!cancelado) setLoading(false)
      }
    })()
    return () => { cancelado = true }
  }, [codigo, mesIdx, anio])

  const sumaDetalle = (rows ?? []).reduce((a, r) => a + Number(r.monto ?? 0), 0)
  const cuadra = tipo === 'manual' ? true : Math.abs(sumaDetalle - valor) < 2
  const org = ORIGEN_TEXTO[tipo]

  const TH2 = { padding: '7px 9px', fontSize: 10, fontWeight: 700, color: '#6B7280', background: '#F9FAFB', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', position: 'sticky', top: 0 }
  const TD2 = { padding: '6px 9px', fontSize: 12, borderBottom: '1px solid #F3F4F6' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 'min(940px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>

        {/* Cabecera */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Detalle · {MESES[mesIdx]} {anio}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#111827', marginTop: 2 }}>{nombreLinea(codigo)}</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: valor < 0 ? '#DC2626' : '#1F4E79', marginTop: 4 }}>{fmtCLP(valor)}</div>
          </div>
          <button onClick={onClose} style={{ background: '#F3F4F6', border: 'none', borderRadius: 8, padding: 7, cursor: 'pointer', lineHeight: 0 }}><X size={16} /></button>
        </div>

        {/* Origen */}
        <div style={{ padding: '11px 20px', background: '#EFF6FF', borderBottom: '1px solid #DBEAFE', fontSize: 12, color: '#1E40AF', lineHeight: 1.5 }}>
          <b>Origen:</b> <code style={{ background: '#DBEAFE', padding: '1px 5px', borderRadius: 4 }}>{org.fuente}</code> · {org.desc}
          {tipo === 'formula' && <div style={{ marginTop: 4 }}><b>Fórmula:</b> {FORMULAS[codigo].texto}</div>}
          {tipo === 'rrhh' && !veSocios && codigo === 'REM_ADMIN' && (
            <div style={{ marginTop: 4, fontStyle: 'italic' }}>Vista agregada de administración y dirección.</div>
          )}
        </div>

        {/* Cuerpo */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading && <div style={{ padding: 30, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Cargando detalle…</div>}
          {err && <div style={{ margin: 16, padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626', fontSize: 12 }}>Error: {err}</div>}

          {!loading && !err && rows && rows.length === 0 && (
            <div style={{ padding: 30, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              Sin registros para este mes.
              {tipo === 'manual' && ' Esta línea se carga a mano y aún no tiene valor ingresado.'}
            </div>
          )}

          {!loading && !err && rows && rows.length > 0 && tipo === 'formula' && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ ...TH2, textAlign: 'left' }}>Componente</th><th style={{ ...TH2, textAlign: 'right' }}>Monto</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.codigo}>
                    <td style={TD2}>{r.signo < 0 ? '(−) ' : '(+) '}{r.nombre}</td>
                    <td style={{ ...TD2, textAlign: 'right', fontFamily: 'monospace', color: r.monto < 0 ? '#DC2626' : '#111827' }}>{fmtCLP(r.monto)}</td>
                  </tr>
                ))}
                {FORMULAS[codigo].divisor && (
                  <tr><td style={{ ...TD2, color: '#6B7280' }}>÷ {String(FORMULAS[codigo].divisor).replace('.', ',')} (IVA)</td><td style={{ ...TD2, textAlign: 'right', fontFamily: 'monospace', color: '#6B7280' }}>—</td></tr>
                )}
              </tbody>
            </table>
          )}

          {!loading && !err && rows && rows.length > 0 && tipo === 'bsale' && (
            <>
              <div style={{ padding: '10px 20px 4px', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' }}>Por sucursal</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...TH2, textAlign: 'left' }}>Sucursal</th>
                  <th style={{ ...TH2, textAlign: 'right' }}>Días con venta</th>
                  <th style={{ ...TH2, textAlign: 'right' }}>Docs</th>
                  <th style={{ ...TH2, textAlign: 'right' }}>Notas de crédito</th>
                  <th style={{ ...TH2, textAlign: 'right' }}>Venta neta de NC</th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.sucursal}>
                      <td style={TD2}>{r.sucursal}</td>
                      <td style={{ ...TD2, textAlign: 'right', color: '#6B7280' }}>{r.dias}</td>
                      <td style={{ ...TD2, textAlign: 'right', color: '#6B7280' }}>{r.docs}</td>
                      <td style={{ ...TD2, textAlign: 'right', fontFamily: 'monospace', color: '#B45309' }}>{r.nc ? fmtCLP(r.nc) : '—'}</td>
                      <td style={{ ...TD2, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtCLP(r.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {extra && extra.length > 0 && (
                <>
                  <div style={{ padding: '14px 20px 4px', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' }}>Día por día (consolidado)</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {extra.map(([f, v]) => (
                        <tr key={f}>
                          <td style={{ ...TD2, width: 140 }}>{f}</td>
                          <td style={{ ...TD2, textAlign: 'right', fontFamily: 'monospace' }}>{v ? fmtCLP(v) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}

          {!loading && !err && rows && rows.length > 0 && tipo === 'rrhh' && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ ...TH2, textAlign: 'left' }}>Concepto</th><th style={{ ...TH2, textAlign: 'right' }}>Monto</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...TD2, textTransform: 'capitalize', color: r.esCalculado ? '#6B7280' : '#111827' }}>{String(r.concepto).replace(/_/g, ' ')}</td>
                    <td style={{ ...TD2, textAlign: 'right', fontFamily: 'monospace', fontWeight: r.esCalculado ? 400 : 600 }}>{fmtCLP(r.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!loading && !err && rows && rows.length > 0 && tipo === 'manual' && (
            <div style={{ padding: '16px 20px', fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
              <div><b>Monto cargado:</b> <span style={{ fontFamily: 'monospace' }}>{fmtCLP(Number(rows[0].monto ?? 0))}</span></div>
              {extra?.nombre && <div><b>Cargado por:</b> {extra.nombre}{extra.correo ? ` (${extra.correo})` : ''}</div>}
              {rows[0].created_at && <div><b>Fecha de carga:</b> {new Date(rows[0].created_at).toLocaleString('es-CL')}</div>}
              {rows[0].updated_at && <div><b>Última edición:</b> {new Date(rows[0].updated_at).toLocaleString('es-CL')}</div>}
              <div style={{ marginTop: 10, padding: '9px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 12, color: '#92400E' }}>
                Este valor no proviene de ninguna integración: se edita con el lápiz en la celda del EERR.
              </div>
            </div>
          )}

          {!loading && !err && rows && rows.length > 0 && tipo === 'banco' && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...TH2, textAlign: 'left' }}>Fecha</th>
                <th style={{ ...TH2, textAlign: 'left' }}>Descripción</th>
                <th style={{ ...TH2, textAlign: 'left' }}>Subcuenta</th>
                <th style={{ ...TH2, textAlign: 'left' }}>Origen</th>
                <th style={{ ...TH2, textAlign: 'right' }}>Monto</th>
              </tr></thead>
              <tbody>
                {rows.slice(0, 300).map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...TD2, whiteSpace: 'nowrap', color: '#6B7280' }}>{r.fecha}</td>
                    <td style={{ ...TD2, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.descripcion}>{r.descripcion || '—'}</td>
                    <td style={{ ...TD2, fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }}>{r.subcuenta || '—'}</td>
                    <td style={{ ...TD2, fontSize: 10 }}>
                      <span style={{ background: r.origen === 'banco' ? '#F3F4F6' : '#EDE9FE', color: r.origen === 'banco' ? '#6B7280' : '#5B21B6', padding: '1px 5px', borderRadius: 4 }}>{r.origen}</span>
                    </td>
                    <td style={{ ...TD2, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtCLP(r.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && !err && tipo === 'banco' && rows && rows.length > 300 && (
            <div style={{ padding: '8px 20px', fontSize: 11, color: '#9CA3AF' }}>Mostrando los 300 movimientos mayores de {rows.length} en total.</div>
          )}
        </div>

        {/* Pie: cuadratura */}
        {!loading && !err && rows && (
          <div style={{ padding: '11px 20px', borderTop: '1px solid #E5E7EB', background: cuadra ? '#F0FDF4' : '#FFFBEB', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: cuadra ? '#15803D' : '#B45309', fontWeight: 600 }}>
              {tipo === 'manual'
                ? 'Valor ingresado manualmente'
                : cuadra
                ? `El detalle suma exactamente el valor de la línea (${rows.length} ${rows.length === 1 ? 'registro' : 'registros'})`
                : `Diferencia entre el detalle y la línea: ${fmtCLP(sumaDetalle - valor)}`}
            </span>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#6B7280' }}>
              {tipo !== 'manual' && `Suma detalle: ${fmtCLP(sumaDetalle)}`}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export function EerrEstadoResultados() {
  const [anio, setAnio] = useState(new Date().getFullYear())
  const [data, setData] = useState(null)
  const [rrhhData, setRrhhData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [vistaModo, setVistaModo] = useState('pesos')  // 'pesos' | 'pct' | 'ambos'
  const [detalle, setDetalle] = useState(null)  // { codigo, mesIdx } — drill-down

  useEffect(() => {
    setLoading(true); setError(null)
    Promise.all([fetchEerr(anio), fetchRrhhValores(anio)])
      .then(([d, rrhh]) => { setData(d); setRrhhData(rrhh); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [anio, reloadKey])

  const valores = useMemo(() => {
    if (!data) return null
    const vals = calcularValores(data)
    if (rrhhData?.valoresRrhh) {
      mergeRrhhSobreEerr(vals, rrhhData.valoresRrhh)
    }
    // Confidencialidad: roles fuera del directorio ven REM_SOCIOS fusionada en REM_ADMIN
    const veSocios = !!data.rol && ROLES_VE_SOCIOS.includes(data.rol)
    if (!veSocios) {
      const admin = vals.get('REM_ADMIN') ?? new Array(12).fill(0)
      const socios = vals.get('REM_SOCIOS') ?? new Array(12).fill(0)
      vals.set('REM_ADMIN', admin.map((v, i) => v + (socios[i] || 0)))
      vals.set('REM_SOCIOS', new Array(12).fill(0))
    }
    return vals
  }, [data, rrhhData])
  const veSocios = !!data?.rol && ROLES_VE_SOCIOS.includes(data.rol)
  const ordenVisible = useMemo(() => veSocios ? ORDEN_CODIGOS : ORDEN_CODIGOS.filter(c => c !== 'REM_SOCIOS'), [veSocios])
  const nombreLinea = codigo => {
    if (!veSocios && codigo === 'REM_ADMIN') return 'Remuneraciones Administración y Dirección'
    return lineaPorCodigo.get(codigo)?.nombre ?? codigo
  }
  const lineaPorCodigo = useMemo(() => { const m = new Map(); data?.lineas.forEach(l => m.set(l.codigo, l)); return m }, [data])
  const puedeEditar = !!data?.rol && ROLES_EDIT.includes(data.rol)
  const getnetLineaId = lineaPorCodigo.get('COMISION_GETNET')?.id
  const costoNetoLineaId = lineaPorCodigo.get('COSTO_NETO')?.id

  /* Meses con datos = meses donde hubo venta bruta */
  const mesesConDatos = useMemo(() => {
    if (!valores) return 0
    const vb = valores.get('VENTA_BRUTA') ?? []
    let ultimo = 0
    vb.forEach((v, i) => { if (v > 0) ultimo = i + 1 })
    return ultimo
  }, [valores])

  const mesActualIdx = anio === new Date().getFullYear() ? new Date().getMonth() : -1

  /* KPIs de cabecera (acumulado a meses con datos) */
  const kpis = useMemo(() => {
    if (!valores || mesesConDatos === 0) return null
    const sumH = c => { const a = valores.get(c) ?? []; let s = 0; for (let i = 0; i < mesesConDatos; i++) s += a[i] || 0; return s }
    const vn = sumH('VENTA_NETA')
    const mb = sumH('TOTAL_MARGEN_BRUTO')
    const ro = sumH('RESULTADO_OPERACIONAL')
    const rn = sumH('RESULTADO_NETO')
    return {
      vn, mb, ro, rn,
      mbPct: vn > 0 ? (mb / vn) * 100 : 0,
      roPct: vn > 0 ? (ro / vn) * 100 : 0,
      rnPct: vn > 0 ? (rn / vn) * 100 : 0,
    }
  }, [valores, mesesConDatos])

  async function guardarGetnet(mes, valor) {
    if (!getnetLineaId || !data?.userId) { toast.error('No se puede guardar'); return }
    const { error } = await supabase.from('eerr_ajustes_manuales').upsert({ eerr_linea_id: getnetLineaId, sucursal_id: null, anio, mes, monto: valor, usuario_id: data.userId }, { onConflict: 'eerr_linea_id,sucursal_id,anio,mes' })
    if (error) { toast.error('Error al guardar: ' + error.message); return }
    toast.success(`Comisión Getnet ${MESES[mes - 1]} guardada`)
    setReloadKey(k => k + 1)
  }

  async function guardarCostoNeto(mes, valor) {
    if (!costoNetoLineaId || !data?.userId) { toast.error('No se puede guardar'); return }
    const { error } = await supabase.from('eerr_ajustes_manuales').upsert({ eerr_linea_id: costoNetoLineaId, sucursal_id: null, anio, mes, monto: valor, usuario_id: data.userId }, { onConflict: 'eerr_linea_id,sucursal_id,anio,mes' })
    if (error) { toast.error('Error al guardar: ' + error.message); return }
    toast.success(`Costo Neto ${MESES[mes - 1]} guardado`)
    setReloadKey(k => k + 1)
  }

  function exportarExcel() {
    if (!valores) return
    const headers = ['Línea', 'Tipo', ...MESES.flatMap(m => [m, `% ${m}`]), 'TOTAL AÑO', '% TOTAL']
    const ventaNeta = valores.get('VENTA_NETA') ?? new Array(12).fill(0)
    const totalVN = ventaNeta.reduce((a, b) => a + b, 0)
    const rows = [headers]
    ordenVisible.forEach(codigo => {
      const linea = lineaPorCodigo.get(codigo)
      const arr = valores.get(codigo) ?? new Array(12).fill(0)
      const total = arr.reduce((a, b) => a + b, 0)
      const aplicaPct = !BLOQUE_AZUL.has(codigo)
      const cells = []
      arr.forEach((v, i) => {
        cells.push(Math.round(v).toString())
        cells.push(aplicaPct && ventaNeta[i] > 0 ? ((v / ventaNeta[i]) * 100).toFixed(1) + '%' : '—')
      })
      rows.push([nombreLinea(codigo), linea?.tipo_costo ?? '', ...cells, Math.round(total).toString(), aplicaPct && totalVN > 0 ? ((total / totalVN) * 100).toFixed(1) + '%' : '—'])
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `EERR ${anio}`)
    XLSX.writeFile(wb, `EERR_${anio}.xlsx`)
    toast.success('Excel exportado')
  }

  const TH = { padding: '8px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6B7280', background: '#F9FAFB', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
  const selectSt = { padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff' }
  const btnSt = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151' }

  const mostrarPesos = vistaModo === 'pesos' || vistaModo === 'ambos'
  const mostrarPct = vistaModo === 'pct' || vistaModo === 'ambos'
  const colsPorMes = (mostrarPesos ? 1 : 0) + (mostrarPct ? 1 : 0)
  const colSpanTotal = 2 + 12 * colsPorMes + 4  // línea + tipo + meses + (YTD, prom, %, tend)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Controles */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Año</label>
          <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
            {ANIOS.map(a => <option key={a} value={String(a)}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Vista</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {['CONSOLIDADO', 'La Granja', 'Maipú', 'Los Ángeles'].map(v => (
              <button key={v} style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, border: '1px solid #D1D5DB', background: v === 'CONSOLIDADO' ? '#EFF6FF' : '#F9FAFB', color: v === 'CONSOLIDADO' ? '#1F4E79' : '#9CA3AF', cursor: v === 'CONSOLIDADO' ? 'pointer' : 'not-allowed' }}>
                {v}{v !== 'CONSOLIDADO' && <span style={{ marginLeft: 4, fontSize: 9, background: '#E5E7EB', color: '#6B7280', padding: '1px 4px', borderRadius: 3 }}>Próx.</span>}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Mostrar</label>
          <div style={{ display: 'flex', gap: 0, border: '1px solid #D1D5DB', borderRadius: 7, overflow: 'hidden' }}>
            {[['pesos', '$'], ['pct', '%'], ['ambos', '$ y %']].map(([k, l]) => (
              <button key={k} onClick={() => setVistaModo(k)}
                style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: vistaModo === k ? '#1F4E79' : '#fff', color: vistaModo === k ? '#fff' : '#6B7280' }}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={exportarExcel} disabled={!valores} style={{ ...btnSt, opacity: !valores ? 0.5 : 1 }}>
            <Download size={13} /> Exportar Excel
          </button>
          <button onClick={() => { setFetching(true); setReloadKey(k => k + 1); setTimeout(() => setFetching(false), 1000) }} disabled={fetching} style={{ ...btnSt }}>
            <RefreshCw size={13} style={{ animation: fetching ? 'spin 1s linear infinite' : 'none' }} /> Recalcular
          </button>
        </div>
      </div>

      {error && <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>Error: {error}</div>}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from({ length: 12 }).map((_, i) => <div key={i} style={{ height: 32, background: '#F3F4F6', borderRadius: 6 }} />)}
        </div>
      )}

      {/* KPI cards de cabecera */}
      {!loading && kpis && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <KpiCard label={`Venta Neta YTD (a ${MESES[mesesConDatos - 1]})`} valor={fmtM(kpis.vn)} color="#1F4E79"
            sub={`Promedio mensual ${fmtM(kpis.vn / mesesConDatos)}`} />
          <KpiCard label="Margen Bruto YTD" valor={fmtM(kpis.mb)} color="#0891B2"
            pctBadge={kpis.mbPct.toFixed(1) + '%'} sub="sobre venta neta" />
          <KpiCard label="Resultado Operacional YTD" valor={fmtM(kpis.ro)}
            color={kpis.ro >= 0 ? '#15803D' : '#DC2626'}
            pctBadge={kpis.roPct.toFixed(1) + '%'} sub="margen operacional" />
          <KpiCard label="Resultado Neto YTD" valor={fmtM(kpis.rn)}
            color={kpis.rn >= 0 ? '#047857' : '#B91C1C'}
            pctBadge={kpis.rnPct.toFixed(1) + '%'} sub="tras intereses de créditos" />
        </div>
      )}

      {detalle && valores && (
        <DetalleModal
          ctx={detalle}
          anio={anio}
          data={data}
          valores={valores}
          veSocios={veSocios}
          lineaPorCodigo={lineaPorCodigo}
          nombreLinea={nombreLinea}
          onClose={() => setDetalle(null)}
        />
      )}

      {!loading && valores && (
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                  <th style={{ ...TH, position: 'sticky', left: 0, zIndex: 2, minWidth: 210 }}>Línea</th>
                  <th style={{ ...TH, minWidth: 62 }}>Tipo</th>
                  {MESES.flatMap((m, mi) => {
                    const esActual = mi === mesActualIdx
                    const bgMes = esActual ? '#EFF6FF' : '#F9FAFB'
                    const out = []
                    if (mostrarPesos) out.push(
                      <th key={m} style={{ ...TH, textAlign: 'right', minWidth: 88, background: bgMes, color: esActual ? '#1D4ED8' : '#6B7280' }}>
                        {m}{esActual ? ' •' : ''}
                      </th>
                    )
                    if (mostrarPct) out.push(
                      <th key={`${m}pct`} style={{ ...TH, textAlign: 'right', minWidth: 44, fontSize: 10, color: '#9CA3AF', background: bgMes }}>
                        {mostrarPesos ? '%' : m + ' %'}
                      </th>
                    )
                    return out
                  })}
                  <th style={{ ...TH, textAlign: 'right', minWidth: 100, borderLeft: '2px solid #E5E7EB' }}>TOTAL AÑO</th>
                  <th style={{ ...TH, textAlign: 'right', minWidth: 86 }}>PROM/MES</th>
                  <th style={{ ...TH, textAlign: 'right', minWidth: 44, fontSize: 10, color: '#9CA3AF' }}>%</th>
                  <th style={{ ...TH, textAlign: 'center', minWidth: 72 }}>TEND.</th>
                </tr>
              </thead>
              <tbody>
                {ordenVisible.map(codigo => {
                  const linea = lineaPorCodigo.get(codigo)
                  const arr = valores.get(codigo) ?? new Array(12).fill(0)
                  const total = arr.reduce((a, b) => a + b, 0)
                  const ventaNeta = valores.get('VENTA_NETA') ?? new Array(12).fill(0)
                  const totalVN = ventaNeta.reduce((a, b) => a + b, 0)
                  const isSubtotal = SUBTOTAL_CODES.has(codigo)
                  const isGrande = RESULTADOS_GRANDES.has(codigo)
                  const isAzul = BLOQUE_AZUL.has(codigo)
                  const isGris = BLOQUE_GRIS.has(codigo)
                  const isHija = LINEAS_HIJA.has(codigo)
                  const isGetnet = codigo === 'COMISION_GETNET'
                  const isCostoNeto = codigo === 'COSTO_NETO'
                  const aplicaPct = !isAzul || codigo === 'COSTO_NETO'
                  const rowBg = isGrande ? '#F0FDF4' : isAzul ? '#F8FAFF' : isGris ? '#FAFAFA' : isSubtotal ? '#FAFAFA' : 'transparent'
                  const prom = mesesConDatos > 0 ? total / mesesConDatos : 0
                  const sparkData = arr.slice(0, mesesConDatos).map(v => v || 0)
                  const sparkColor = isGrande ? (total >= 0 ? '#15803D' : '#DC2626') : '#94A3B8'

                  return (
                    <Fragment key={codigo}>
                    {SECCIONES[codigo] && (
                      <tr>
                        <td colSpan={colSpanTotal} style={{ padding: '11px 10px 4px', fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.07em', borderTop: '2px solid #E2E8F0', background: '#F8FAFC', position: 'sticky', left: 0 }}>
                          {SECCIONES[codigo]}
                        </td>
                      </tr>
                    )}
                    {codigo === 'IVA_SII' && (
                      <tr>
                        <td colSpan={colSpanTotal} style={{ padding: '11px 10px 4px', fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', borderTop: '2px solid #E2E8F0', background: '#F8FAFC', position: 'sticky', left: 0 }}>
                          Pagos al SII (informativo — no afecta el resultado)
                        </td>
                      </tr>
                    )}
                    <tr style={{ borderBottom: '1px solid #F3F4F6', background: rowBg }}>
                      <td style={{ padding: isHija ? '6px 10px 6px 24px' : '7px 10px', fontWeight: isSubtotal || isGrande ? 700 : 400, fontSize: isGrande ? 13 : 12, color: isHija ? '#374151' : '#111827', position: 'sticky', left: 0, background: rowBg === 'transparent' ? '#fff' : rowBg, zIndex: 1, whiteSpace: 'nowrap', minWidth: 210 }}>
                        {nombreLinea(codigo)}
                      </td>
                      <td style={{ padding: '7px 6px', fontSize: 10, color: '#6B7280', whiteSpace: 'nowrap' }}>
                        {linea?.tipo_costo && linea.tipo_costo !== '—' && (
                          <span style={{ background: '#F3F4F6', borderRadius: 4, padding: '1px 5px', fontSize: 10 }}>{linea.tipo_costo}</span>
                        )}
                      </td>
                      {arr.flatMap((v, i) => {
                        const pct = aplicaPct && ventaNeta[i] > 0 ? (v / ventaNeta[i]) * 100 : null
                        const esActual = i === mesActualIdx
                        const bgCol = esActual ? (rowBg === 'transparent' ? '#F5F9FF' : rowBg) : undefined
                        // Color condicional para resultados
                        let colorV = v < 0 ? '#DC2626' : '#111827'
                        if (isGrande) colorV = v > 0 ? '#15803D' : v < 0 ? '#DC2626' : '#9CA3AF'
                        const out = []
                        const puedeVerDetalle = Math.round(v) !== 0
                        if (mostrarPesos) out.push(
                          <td key={`v${i}`}
                            onClick={puedeVerDetalle ? () => setDetalle({ codigo, mesIdx: i }) : undefined}
                            title={puedeVerDetalle ? 'Ver de dónde viene este monto' : undefined}
                            style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: isGrande ? 13 : 12, fontWeight: isSubtotal || isGrande ? 700 : 400, color: colorV, whiteSpace: 'nowrap', background: bgCol, cursor: puedeVerDetalle ? 'pointer' : 'default' }}
                            onMouseEnter={e => { if (puedeVerDetalle) e.currentTarget.style.background = '#EEF2FF' }}
                            onMouseLeave={e => { e.currentTarget.style.background = bgCol ?? 'transparent' }}>
                            {isGetnet && puedeEditar
                              ? <GetnetCell value={v} onSave={nv => guardarGetnet(i + 1, nv)} />
                              : isGetnet
                              ? <span style={{ opacity: 0.7 }}>{fmt(v)}</span>
                              : isCostoNeto && puedeEditar
                              ? <GetnetCell value={v} onSave={nv => guardarCostoNeto(i + 1, nv)} />
                              : isCostoNeto
                              ? <span style={{ opacity: 0.7 }}>{fmt(v)}</span>
                              : fmt(v)
                            }
                          </td>
                        )
                        if (mostrarPct) out.push(
                          <td key={`p${i}`} style={{ padding: '7px 4px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: isGrande ? (pct !== null && pct > 0 ? '#15803D' : '#DC2626') : '#9CA3AF', whiteSpace: 'nowrap', background: bgCol }}>
                            {pct !== null ? `${pct.toFixed(1)}%` : '—'}
                          </td>
                        )
                        return out
                      })}
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: isGrande ? 13 : 12, fontWeight: isSubtotal || isGrande ? 700 : 400, color: isGrande ? (total > 0 ? '#15803D' : '#DC2626') : total < 0 ? '#DC2626' : '#111827', whiteSpace: 'nowrap', borderLeft: '2px solid #F3F4F6' }}>
                        {fmt(total)}
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }}>
                        {mesesConDatos > 0 ? fmt(prom) : '—'}
                      </td>
                      <td style={{ padding: '7px 4px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                        {aplicaPct && totalVN > 0 ? `${((total / totalVN) * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-block' }}>
                          <Sparkline datos={sparkData} color={sparkColor} />
                        </div>
                      </td>
                    </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            {ordenVisible.every(c => (valores.get(c) ?? []).every(v => !v)) && (
              <div style={{ padding: '24px 0', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Sin datos para {anio}. Configura el mapeo de cuentas en la pestaña Configuración.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
