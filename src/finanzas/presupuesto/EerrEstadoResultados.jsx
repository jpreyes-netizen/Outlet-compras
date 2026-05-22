import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Download, RefreshCw, Pencil } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const ANIOS = [2024, 2025, 2026]
const ROLES_EDIT = ['admin', 'admin_sistema', 'contabilidad', 'jefe_admin_finanzas', 'gerente_admin_finanzas']

const ORDEN_CODIGOS = [
  'VENTA_BRUTA','VENTA_NETA','COSTO_NETO','MARGEN_CONTRIB',
  'REM_OPERACION','TOTAL_GASTO_OPER','TOTAL_MARGEN_BRUTO',
  'REM_VENTA','MARKETING','COMISION_GETNET','TOTAL_GASTO_VENTA',
  'GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS',
  'COMBUSTIBLE','REM_ADMIN','REM_SOCIOS','FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN',
  'TRANSPORTE_VIATICOS','REM_PREVIRED',
  'TOTAL_GASTO_OPERATIVO','RESULTADO_OPERACIONAL',
  'INTERES_CREDITOS','IMPUESTOS','MP_IMPORTACION','MP_REPOSICION','MP_INVERSION',
  'MP_TRANSPORTES','TOTAL_MP','RESULTADO_FINAL',
]

const SUBTOTAL_CODES = new Set([
  'VENTA_NETA','MARGEN_CONTRIB','TOTAL_GASTO_OPER','TOTAL_MARGEN_BRUTO',
  'TOTAL_GASTO_VENTA','TOTAL_GASTO_OPERATIVO','RESULTADO_OPERACIONAL',
  'TOTAL_MP','RESULTADO_FINAL',
])
const BLOQUE_AZUL = new Set(['VENTA_BRUTA','VENTA_NETA','COSTO_NETO','MARGEN_CONTRIB'])
const BLOQUE_GRIS = new Set(['INTERES_CREDITOS','IMPUESTOS','MP_IMPORTACION','MP_REPOSICION','MP_INVERSION','MP_TRANSPORTES','TOTAL_MP','RESULTADO_FINAL'])
const RESULTADOS_GRANDES = new Set(['RESULTADO_OPERACIONAL','RESULTADO_FINAL'])

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
    supabase.from('subcuentas').select('id, cuenta_madre_id'),
    supabase.auth.getUser(),
  ])

  if (lineasR.error) throw new Error('eerr_lineas: ' + lineasR.error.message)
  if (mapeoR.error) throw new Error('eerr_mapeo: ' + mapeoR.error.message)
  if (ventasR.error) throw new Error('ventas_bsale_dia: ' + ventasR.error.message)
  if (movsR.error) throw new Error('movimientos_bancarios: ' + movsR.error.message)
  if (ajustesR.error) throw new Error('eerr_ajustes_manuales: ' + ajustesR.error.message)

  const subcuentaToMadre = new Map()
  ;(subcuentasR.data ?? []).forEach(s => { if (s?.id && s?.cuenta_madre_id) subcuentaToMadre.set(s.id, s.cuenta_madre_id) })

  const userId = userR.data.user?.id ?? null
  let rol = null
  if (userId) {
    const { data: u } = await supabase.from('usuarios').select('rol').eq('id', userId).maybeSingle()
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
  const ajustesGetnet = new Array(12).fill(0)
  ;(ajustesR.data ?? []).forEach(a => { if (a.eerr_linea_id === getnetId && a.mes >= 1 && a.mes <= 12) ajustesGetnet[a.mes - 1] = Number(a.monto ?? 0) })

  return { lineas, mapeo: mapeoR.data ?? [], ventasPorMes, gastosPorCuentaMes, comprasPorCuentaMes, ajustesGetnet, rol, userId }
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
    get('TOTAL_MP')[i] = sumCodes(['MP_IMPORTACION','MP_REPOSICION','MP_INVERSION','MP_TRANSPORTES'], i)
    get('RESULTADO_FINAL')[i] = get('RESULTADO_OPERACIONAL')[i] - get('INTERES_CREDITOS')[i] - get('IMPUESTOS')[i] - get('TOTAL_MP')[i]
  }

  return vals
}

function GetnetCell({ value, onSave }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(String(Math.round(value || 0)))
  useEffect(() => { setV(String(Math.round(value || 0))) }, [value])
  if (!edit) return (
    <button onClick={() => setEdit(true)} title="Editar Comisión Getnet"
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

export function EerrEstadoResultados() {
  const [anio, setAnio] = useState(new Date().getFullYear())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setLoading(true); setError(null)
    fetchEerr(anio).then(d => { setData(d); setLoading(false) }).catch(e => { setError(e.message); setLoading(false) })
  }, [anio, reloadKey])

  const valores = useMemo(() => data ? calcularValores(data) : null, [data])
  const lineaPorCodigo = useMemo(() => { const m = new Map(); data?.lineas.forEach(l => m.set(l.codigo, l)); return m }, [data])
  const puedeEditar = !!data?.rol && ROLES_EDIT.includes(data.rol)
  const getnetLineaId = lineaPorCodigo.get('COMISION_GETNET')?.id

  async function guardarGetnet(mes, valor) {
    if (!getnetLineaId || !data?.userId) { toast.error('No se puede guardar'); return }
    const { error } = await supabase.from('eerr_ajustes_manuales').upsert({ eerr_linea_id: getnetLineaId, sucursal_id: null, anio, mes, monto: valor, usuario_id: data.userId }, { onConflict: 'eerr_linea_id,sucursal_id,anio,mes' })
    if (error) { toast.error('Error al guardar: ' + error.message); return }
    toast.success(`Comisión Getnet ${MESES[mes - 1]} guardada`)
    setReloadKey(k => k + 1)
  }

  function exportarExcel() {
    if (!valores) return
    const headers = ['Línea', 'Tipo', ...MESES.flatMap(m => [m, `% ${m}`]), 'TOTAL AÑO', '% TOTAL']
    const ventaNeta = valores.get('VENTA_NETA') ?? new Array(12).fill(0)
    const totalVN = ventaNeta.reduce((a, b) => a + b, 0)
    const rows = [headers]
    ORDEN_CODIGOS.forEach(codigo => {
      const linea = lineaPorCodigo.get(codigo)
      const arr = valores.get(codigo) ?? new Array(12).fill(0)
      const total = arr.reduce((a, b) => a + b, 0)
      const aplicaPct = !BLOQUE_AZUL.has(codigo)
      const cells = []
      arr.forEach((v, i) => {
        cells.push(Math.round(v).toString())
        cells.push(aplicaPct && ventaNeta[i] > 0 ? ((v / ventaNeta[i]) * 100).toFixed(1) + '%' : '—')
      })
      rows.push([linea?.nombre ?? codigo, linea?.tipo_costo ?? '', ...cells, Math.round(total).toString(), aplicaPct && totalVN > 0 ? ((total / totalVN) * 100).toFixed(1) + '%' : '—'])
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `EERR ${anio}`)
    XLSX.writeFile(wb, `EERR_${anio}.xlsx`)
    toast.success('Excel exportado')
  }

  const TH = { padding: '8px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6B7280', background: '#F9FAFB', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
  const selectSt = { padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff' }
  const btnSt = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151' }

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

      {!loading && valores && (
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                  <th style={{ ...TH, position: 'sticky', left: 0, zIndex: 2, minWidth: 200 }}>Línea</th>
                  <th style={{ ...TH, minWidth: 70 }}>Tipo</th>
                  {MESES.flatMap(m => [
                    <th key={m} style={{ ...TH, textAlign: 'right', minWidth: 90 }}>{m}</th>,
                    <th key={`${m}pct`} style={{ ...TH, textAlign: 'right', minWidth: 44, fontSize: 10, color: '#9CA3AF' }}>%</th>
                  ])}
                  <th style={{ ...TH, textAlign: 'right', minWidth: 100 }}>TOTAL AÑO</th>
                  <th style={{ ...TH, textAlign: 'right', minWidth: 44, fontSize: 10, color: '#9CA3AF' }}>%</th>
                </tr>
              </thead>
              <tbody>
                {ORDEN_CODIGOS.map(codigo => {
                  const linea = lineaPorCodigo.get(codigo)
                  const arr = valores.get(codigo) ?? new Array(12).fill(0)
                  const total = arr.reduce((a, b) => a + b, 0)
                  const ventaNeta = valores.get('VENTA_NETA') ?? new Array(12).fill(0)
                  const totalVN = ventaNeta.reduce((a, b) => a + b, 0)
                  const isSubtotal = SUBTOTAL_CODES.has(codigo)
                  const isGrande = RESULTADOS_GRANDES.has(codigo)
                  const isAzul = BLOQUE_AZUL.has(codigo)
                  const isGris = BLOQUE_GRIS.has(codigo)
                  const isGetnet = codigo === 'COMISION_GETNET'
                  const aplicaPct = !isAzul
                  const rowBg = isAzul ? '#EFF6FF' : isGris ? '#F9FAFB' : isGrande ? '#F0FDF4' : isSubtotal ? '#FAFAFA' : 'transparent'

                  return (
                    <tr key={codigo} style={{ borderBottom: '1px solid #F3F4F6', background: rowBg }}>
                      <td style={{ padding: '7px 10px', fontWeight: isSubtotal || isGrande ? 700 : 400, fontSize: isGrande ? 13 : 12, color: '#111827', position: 'sticky', left: 0, background: rowBg, zIndex: 1, whiteSpace: 'nowrap', minWidth: 200 }}>
                        {linea?.nombre ?? codigo}
                      </td>
                      <td style={{ padding: '7px 6px', fontSize: 10, color: '#6B7280', whiteSpace: 'nowrap' }}>
                        {linea?.tipo_costo && linea.tipo_costo !== '—' && (
                          <span style={{ background: '#F3F4F6', borderRadius: 4, padding: '1px 5px', fontSize: 10 }}>{linea.tipo_costo}</span>
                        )}
                      </td>
                      {arr.map((v, i) => {
                        const pct = aplicaPct && ventaNeta[i] > 0 ? (v / ventaNeta[i]) * 100 : null
                        const negativo = v < 0
                        return [
                          <td key={`v${i}`} style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: isGrande ? 13 : 12, fontWeight: isSubtotal || isGrande ? 700 : 400, color: negativo ? '#DC2626' : '#111827', whiteSpace: 'nowrap' }}>
                            {isGetnet && puedeEditar
                              ? <GetnetCell value={v} onSave={nv => guardarGetnet(i + 1, nv)} />
                              : isGetnet
                              ? <span style={{ opacity: 0.7 }}>{fmt(v)}</span>
                              : fmt(v)
                            }
                          </td>,
                          <td key={`p${i}`} style={{ padding: '7px 4px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                            {pct !== null ? `${pct.toFixed(1)}%` : '—'}
                          </td>
                        ]
                      })}
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: isGrande ? 13 : 12, fontWeight: isSubtotal || isGrande ? 700 : 400, color: total < 0 ? '#DC2626' : '#111827', whiteSpace: 'nowrap' }}>
                        {fmt(total)}
                      </td>
                      <td style={{ padding: '7px 4px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                        {aplicaPct && totalVN > 0 ? `${((total / totalVN) * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {ORDEN_CODIGOS.every(c => (valores.get(c) ?? []).every(v => !v)) && (
              <div style={{ padding: '24px 0', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Sin datos para {anio}. Configura el mapeo de cuentas en la pestaña Configuración.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
