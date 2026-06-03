import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase } from '../supabase'
import { Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

/* ═══ FIN PRESUPUESTO ═══
   Presupuesto vs Real. Cruza tabla eerr_presupuestado (metas fijadas) con
   el cálculo real del EERR (motor duplicado abajo — intencionalmente
   independiente del de EerrEstadoResultados.jsx para no acoplar módulos).
   Items "huérfanos" se muestran con badge para transparencia total. */

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MESES_COL_PRES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const ANIOS = [2024, 2025, 2026]

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const fmt = v => { if (!v || Math.round(v) === 0) return '—'; return fmtCLP(v) }
const fmtPct = (real, pres) => {
  if (!pres || pres === 0) return '—'
  const v = ((real - pres) / Math.abs(pres)) * 100
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
}

/* ─── Mapeo item presupuesto → código EERR ───
   Construido a partir del cruce manual validado con Juan Pablo.
   Valor null = item presupuestado sin contraparte real (huérfano). */
const MAP_ITEM_TO_CODIGO = {
  'VENTA BRUTA': 'VENTA_BRUTA',
  'VENTA NETA': 'VENTA_NETA',
  'COSTO NETO': 'COSTO_NETO',
  'MARGEN DE CONTRIBUCIÓN': 'MARGEN_CONTRIB',
  'REMUNERACIÓN OPERACIÓN': 'REM_OPERACION',
  'REMUNERACIÓN VENTA': 'REM_VENTA',
  'MARKETING': 'MARKETING',
  'COMISIONES POR VENTA (GETNET)': 'COMISION_GETNET',
  'GASTOS BANCARIOS': 'GASTOS_BANCARIOS',
  'MOBILIARIO E INFRAESTRUCTURA': 'MOBILIARIO',
  'SERVICIOS EXTERNOS': 'SERVICIOS_EXTERNOS',
  'ARRIENDO': 'ARRIENDO',
  'CUENTAS BÁSICAS': 'CUENTAS_BASICAS',
  'COMBUSTIBLE': 'COMBUSTIBLE',
  'REMUNERACIÓN ADMINISTRATIVOS': 'REM_ADMIN',
  'REMUNERACIÓN SOCIOS': 'REM_SOCIOS',
  'FINIQUITOS': 'FINIQUITOS',
  'GASTOS TI': 'GASTOS_TI',
  'OTROS GASTOS ADMIN': 'OTROS_GASTOS_ADMIN',
  'TRANSPORTE Y VIÁTICOS': 'TRANSPORTE_VIATICOS',
  'ARTÍCULOS DE OFICINA': null,
  'TOTAL GASTO OPERATIVO': 'TOTAL_GASTO_OPERATIVO',
  'MATERIA PRIMA IMPORTACIÓN': 'MP_IMPORTACION',
  'MATERIA PRIMA REPOSICIÓN': 'MP_REPOSICION',
  'MATERIA PRIMA INVERSIÓN': 'MP_INVERSION',
  'MATERIA PRIMA TRANSPORTES': 'MP_TRANSPORTES',
  'TOTAL GASTO MATERIA PRIMA': 'TOTAL_MP',
  'CRÉDITOS': 'INTERES_CREDITOS',
  'RESULTADO OPERACIONAL': 'RESULTADO_OPERACIONAL',
  'TOTAL EGRESOS': null,
  'FLUJO ECONÓMICO': null,
  'IMPUESTOS': 'IMPUESTOS',
  'FLUJO FINANCIERO': 'RESULTADO_FINAL',
}

/* Códigos EERR que NO tienen línea en presupuesto pero sí están en el cálculo real.
   Se anexan al final con badge "sin presupuesto" para transparencia. */
const CODIGOS_SIN_PRESUPUESTO = ['TOTAL_GASTO_OPER', 'TOTAL_MARGEN_BRUTO', 'TOTAL_GASTO_VENTA', 'REM_PREVIRED']

/* ─── Motor de cálculo del EERR REAL ───
   Replica la lógica de presupuesto/EerrEstadoResultados.jsx de forma autónoma.
   Si en el futuro se modifica el motor original, este sigue funcionando.
   Ambos leen las mismas tablas (eerr_lineas, eerr_mapeo, etc.) por lo que
   matemáticamente convergen. */
async function fetchReal(anio) {
  const yStart = `${anio}-01-01`, yEnd = `${anio}-12-31`

  const [lineasR, mapeoR, ventasR, movsR, comprasR, ajustesR, subcuentasR] = await Promise.all([
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
  ])

  if (lineasR.error) throw new Error('eerr_lineas: ' + lineasR.error.message)
  if (mapeoR.error) throw new Error('eerr_mapeo: ' + mapeoR.error.message)
  if (ventasR.error) throw new Error('ventas_bsale_dia: ' + ventasR.error.message)
  if (movsR.error) throw new Error('movimientos_bancarios: ' + movsR.error.message)
  if (ajustesR.error) throw new Error('eerr_ajustes_manuales: ' + ajustesR.error.message)

  const subToMadre = new Map()
  ;(subcuentasR.data ?? []).forEach(s => { if (s?.id && s?.cuenta_madre_id) subToMadre.set(s.id, s.cuenta_madre_id) })

  const ventasPorMes = new Array(12).fill(0)
  ;(ventasR.data ?? []).forEach(v => { const m = new Date(v.fecha).getUTCMonth(); ventasPorMes[m] += Number(v.total_venta ?? 0) })

  const gastosPorCuentaMes = new Map()
  ;(movsR.data ?? []).forEach(r => {
    const cm = r.subcuenta_id ? subToMadre.get(r.subcuenta_id) : null
    if (!cm) return
    const m = new Date(r.fecha).getUTCMonth()
    if (!gastosPorCuentaMes.has(cm)) gastosPorCuentaMes.set(cm, new Array(12).fill(0))
    gastosPorCuentaMes.get(cm)[m] += Math.abs(Number(r.monto ?? 0))
  })

  const comprasPorCuentaMes = new Map()
  ;(comprasR.data ?? []).forEach(r => {
    const cm = r.subcuenta_id ? subToMadre.get(r.subcuenta_id) : null
    if (!cm) return
    const m = new Date(r.fecha_emision).getUTCMonth()
    if (!comprasPorCuentaMes.has(cm)) comprasPorCuentaMes.set(cm, new Array(12).fill(0))
    comprasPorCuentaMes.get(cm)[m] += Number(r.monto_neto ?? 0)
  })

  const lineas = lineasR.data ?? []
  const getnetId = lineas.find(l => l.codigo === 'COMISION_GETNET')?.id
  const ajustesGetnet = new Array(12).fill(0)
  ;(ajustesR.data ?? []).forEach(a => { if (a.eerr_linea_id === getnetId && a.mes >= 1 && a.mes <= 12) ajustesGetnet[a.mes - 1] = Number(a.monto ?? 0) })

  // Calcular valores reales por código
  const vals = new Map()
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
  ORDEN_CODIGOS.forEach(c => vals.set(c, new Array(12).fill(0)))

  const lineasPorId = new Map()
  lineas.forEach(l => lineasPorId.set(l.id, l))

  ;(mapeoR.data ?? []).forEach(mp => {
    const linea = lineasPorId.get(mp.eerr_linea_id)
    if (!linea) return
    const arr = vals.get(linea.codigo)
    if (!arr) return
    const signo = Number(mp.signo ?? 1)
    const fuente = (mp.fuente ?? '').toLowerCase()
    if (fuente === 'compras' || fuente === 'libro_compras') {
      const v = comprasPorCuentaMes.get(mp.cuenta_madre_id)
      if (v) for (let i = 0; i < 12; i++) arr[i] += v[i] * signo
    } else {
      const v = gastosPorCuentaMes.get(mp.cuenta_madre_id)
      if (v) for (let i = 0; i < 12; i++) arr[i] += v[i] * signo
    }
  })

  const vb = vals.get('VENTA_BRUTA')
  for (let i = 0; i < 12; i++) vb[i] = ventasPorMes[i]
  const getnet = vals.get('COMISION_GETNET')
  for (let i = 0; i < 12; i++) getnet[i] = ajustesGetnet[i]

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

  return { valores: vals, lineas, lineasPorCodigo: new Map(lineas.map(l => [l.codigo, l])) }
}

async function fetchPresupuesto(anio) {
  const { data, error } = await supabase
    .from('eerr_presupuestado')
    .select('*')
    .eq('anio', anio)
    .order('orden')
  if (error) throw new Error('eerr_presupuestado: ' + error.message)
  return data ?? []
}

export function FinPresupuesto({ cu, isMobile }) {
  const [anio, setAnio] = useState(2026)
  const [presupuesto, setPresupuesto] = useState([])
  const [realData, setRealData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [mesHasta, setMesHasta] = useState(new Date().getMonth() + 1) // 1..12

  useEffect(() => {
    setLoading(true); setError(null)
    Promise.all([fetchPresupuesto(anio), fetchReal(anio)])
      .then(([p, r]) => { setPresupuesto(p); setRealData(r); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [anio, reloadKey])

  /* Construir filas combinadas: 33 del presupuesto + 4 huérfanos del EERR */
  const filas = useMemo(() => {
    if (!realData) return []
    const presPorItem = new Map(presupuesto.map(p => [p.item, p]))
    const out = []

    presupuesto.forEach(p => {
      const codigo = MAP_ITEM_TO_CODIGO[p.item]
      const pres = MESES_COL_PRES.map(c => Number(p[c] ?? 0))
      const real = codigo ? (realData.valores.get(codigo) ?? new Array(12).fill(0)) : new Array(12).fill(0)
      out.push({
        item: p.item,
        codigo,
        tipo: p.tipo,
        esSubtotal: !!p.es_subtotal,
        sinReal: codigo === null,
        sinPresupuesto: false,
        pres, real,
      })
    })

    // Anexar códigos EERR que no tienen presupuesto
    CODIGOS_SIN_PRESUPUESTO.forEach(codigo => {
      const linea = realData.lineasPorCodigo.get(codigo)
      if (!linea) return
      const real = realData.valores.get(codigo) ?? new Array(12).fill(0)
      out.push({
        item: linea.nombre,
        codigo,
        tipo: 'EGRESOS',
        esSubtotal: codigo.startsWith('TOTAL_'),
        sinReal: false,
        sinPresupuesto: true,
        pres: new Array(12).fill(0),
        real,
      })
    })
    return out
  }, [presupuesto, realData])

  function exportarExcel() {
    if (!filas.length) return
    const headers = ['Línea', 'Tipo']
    MESES.forEach(m => { headers.push(`${m} Pres`, `${m} Real`, `${m} Var`, `${m} %`) })
    headers.push('Total Pres', 'Total Real', 'Total Var', 'Total %')
    const rows = [headers]
    filas.forEach(f => {
      const r = [f.item, f.tipo]
      let tp = 0, tr = 0
      for (let i = 0; i < 12; i++) {
        const dentro = (i + 1) <= mesHasta
        const realV = dentro ? f.real[i] : 0
        const presV = f.pres[i]
        tp += presV; tr += realV
        r.push(Math.round(presV), Math.round(realV), Math.round(realV - presV), presV ? (((realV - presV) / Math.abs(presV)) * 100).toFixed(1) + '%' : '—')
      }
      r.push(Math.round(tp), Math.round(tr), Math.round(tr - tp), tp ? (((tr - tp) / Math.abs(tp)) * 100).toFixed(1) + '%' : '—')
      rows.push(r)
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `Pres vs Real ${anio}`)
    XLSX.writeFile(wb, `Presupuesto_vs_Real_${anio}.xlsx`)
    toast.success('Excel exportado')
  }

  const TH = { padding: '8px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6B7280', background: '#F9FAFB', whiteSpace: 'nowrap' }
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
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Real hasta mes</label>
          <select style={selectSt} value={String(mesHasta)} onChange={e => setMesHasta(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 11, color: '#6B7280', maxWidth: 320, lineHeight: 1.4, paddingBottom: 4 }}>
          Solo los meses ≤ <b>{MESES[mesHasta - 1]}</b> incluyen real. Meses futuros muestran solo presupuesto.
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={exportarExcel} disabled={!filas.length} style={{ ...btnSt, opacity: !filas.length ? 0.5 : 1 }}>
            <Download size={13} /> Exportar Excel
          </button>
          <button onClick={() => setReloadKey(k => k + 1)} disabled={loading} style={btnSt}>
            <RefreshCw size={13} /> Recalcular
          </button>
        </div>
      </div>

      {error && <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>Error: {error}</div>}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from({ length: 12 }).map((_, i) => <div key={i} style={{ height: 32, background: '#F3F4F6', borderRadius: 6 }} />)}
        </div>
      )}

      {!loading && !error && filas.length === 0 && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
          Sin datos para {anio}. Carga presupuesto en eerr_presupuestado para ver comparación.
        </div>
      )}

      {!loading && filas.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                  <th rowSpan={2} style={{ ...TH, position: 'sticky', left: 0, zIndex: 2, minWidth: 220, background: '#F9FAFB' }}>Línea</th>
                  {MESES.map((m, i) => {
                    const futuro = (i + 1) > mesHasta
                    return (
                      <th key={m} colSpan={4} style={{ ...TH, textAlign: 'center', minWidth: 360, background: futuro ? '#FAFAFA' : '#F0F9FF', borderLeft: '1px solid #E5E7EB', color: futuro ? '#9CA3AF' : '#1F4E79' }}>
                        {m}{futuro && ' (futuro)'}
                      </th>
                    )
                  })}
                  <th colSpan={4} style={{ ...TH, textAlign: 'center', background: '#FEF3C7', borderLeft: '1px solid #E5E7EB', color: '#92400E' }}>TOTAL AÑO</th>
                </tr>
                <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                  {MESES.map((m, i) => (
                    <Fragment key={m}>
                      <th style={{ ...TH, textAlign: 'right', minWidth: 80, fontSize: 10, borderLeft: '1px solid #E5E7EB' }}>Pres</th>
                      <th style={{ ...TH, textAlign: 'right', minWidth: 80, fontSize: 10 }}>Real</th>
                      <th style={{ ...TH, textAlign: 'right', minWidth: 80, fontSize: 10 }}>Var</th>
                      <th style={{ ...TH, textAlign: 'right', minWidth: 60, fontSize: 10 }}>%</th>
                    </Fragment>
                  ))}
                  <th style={{ ...TH, textAlign: 'right', minWidth: 90, fontSize: 10, borderLeft: '1px solid #E5E7EB' }}>Pres</th>
                  <th style={{ ...TH, textAlign: 'right', minWidth: 90, fontSize: 10 }}>Real</th>
                  <th style={{ ...TH, textAlign: 'right', minWidth: 90, fontSize: 10 }}>Var</th>
                  <th style={{ ...TH, textAlign: 'right', minWidth: 60, fontSize: 10 }}>%</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, idx) => {
                  let totalPres = 0, totalReal = 0
                  for (let i = 0; i < 12; i++) {
                    totalPres += f.pres[i]
                    if ((i + 1) <= mesHasta) totalReal += f.real[i]
                  }
                  const rowBg = f.esSubtotal ? '#FAFAFA' : 'transparent'
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid #F3F4F6', background: rowBg }}>
                      <td style={{ padding: '7px 10px', fontWeight: f.esSubtotal ? 700 : 400, color: '#111827', position: 'sticky', left: 0, background: rowBg, zIndex: 1, minWidth: 220 }}>
                        {f.item}
                        {f.sinReal && <span style={{ marginLeft: 6, fontSize: 9, background: '#FEF3C7', color: '#92400E', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>SIN REAL</span>}
                        {f.sinPresupuesto && <span style={{ marginLeft: 6, fontSize: 9, background: '#DBEAFE', color: '#1E40AF', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>SIN PRESUP.</span>}
                      </td>
                      {f.pres.map((p, i) => {
                        const dentro = (i + 1) <= mesHasta
                        const realV = dentro ? f.real[i] : 0
                        const varV = realV - p
                        const negVar = varV < 0 && !p && !realV ? false : varV < 0
                        return (
                          <Fragment key={i}>
                            <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#6B7280', borderLeft: '1px solid #F3F4F6' }}>{fmt(p)}</td>
                            <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: dentro ? '#111827' : '#D1D5DB', fontWeight: dentro ? 500 : 400 }}>{dentro ? fmt(realV) : '—'}</td>
                            <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: dentro ? (negVar ? '#DC2626' : varV > 0 ? '#15803D' : '#9CA3AF') : '#D1D5DB' }}>{dentro && (p || realV) ? fmt(varV) : '—'}</td>
                            <td style={{ padding: '6px 4px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: dentro ? '#6B7280' : '#D1D5DB' }}>{dentro ? fmtPct(realV, p) : '—'}</td>
                          </Fragment>
                        )
                      })}
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#6B7280', background: '#FEF3C7', borderLeft: '1px solid #E5E7EB' }}>{fmt(totalPres)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#111827', background: '#FEF3C7' }}>{fmt(totalReal)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: (totalReal - totalPres) < 0 ? '#DC2626' : (totalReal - totalPres) > 0 ? '#15803D' : '#9CA3AF', background: '#FEF3C7' }}>{fmt(totalReal - totalPres)}</td>
                      <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#6B7280', background: '#FEF3C7' }}>{fmtPct(totalReal, totalPres)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 16px', borderTop: '1px solid #F3F4F6', fontSize: 11, color: '#6B7280', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span><span style={{ background: '#FEF3C7', color: '#92400E', padding: '1px 5px', borderRadius: 3, fontWeight: 600, fontSize: 9 }}>SIN REAL</span> Línea presupuestada sin contraparte en EERR real.</span>
            <span><span style={{ background: '#DBEAFE', color: '#1E40AF', padding: '1px 5px', borderRadius: 3, fontWeight: 600, fontSize: 9 }}>SIN PRESUP.</span> Línea EERR real sin meta presupuestada.</span>
            <span style={{ color: '#DC2626' }}>● Sobre presupuesto</span>
            <span style={{ color: '#15803D' }}>● Bajo presupuesto</span>
          </div>
        </div>
      )}
    </div>
  )
}
