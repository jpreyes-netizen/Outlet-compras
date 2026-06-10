/* ═══ eerr_fetch — fetch compartido de valores EERR ═══
   Devuelve Map<codigo, number[12]> con el EERR completo del año,
   incluyendo ajustes manuales (Getnet, COSTO_NETO) y merge RRHH.
   Usado por EerrGraficos y otros consumidores que necesitan el EERR calculado.
*/
import { supabase } from '../../supabase'
import { fetchRrhhValores, mergeRrhhSobreEerr } from './rrhh_source'

const ORDEN_CODIGOS = ['VENTA_BRUTA','VENTA_NETA','COSTO_NETO','MARGEN_CONTRIB','REM_OPERACION','TOTAL_GASTO_OPER','TOTAL_MARGEN_BRUTO','REM_VENTA','MARKETING','COMISION_GETNET','TOTAL_GASTO_VENTA','GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS','COMBUSTIBLE','REM_ADMIN','REM_SOCIOS','FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS','TOTAL_GASTO_OPERATIVO','RESULTADO_OPERACIONAL','INTERES_CREDITOS','IMPUESTOS','MP_IMPORTACION','MP_REPOSICION','MP_INVERSION','MP_TRANSPORTES','TOTAL_MP','RESULTADO_FINAL']

export async function fetchEerrCompleto(anio) {
  const yStart = anio + '-01-01', yEnd = anio + '-12-31'
  const [lineasR, mapeoR, ventasR, movsR, ajustesR, subcuentasR, rrhh] = await Promise.all([
    supabase.from('eerr_lineas').select('*').eq('activo', true).order('orden'),
    supabase.from('eerr_mapeo').select('eerr_linea_id, cuenta_madre_id, fuente, signo'),
    supabase.from('ventas_bsale_dia').select('fecha, total_venta').gte('fecha', yStart).lte('fecha', yEnd),
    supabase.from('movimientos_bancarios').select('fecha, monto, subcuenta_id').gte('fecha', yStart).lte('fecha', yEnd).lt('monto', 0).not('subcuenta_id', 'is', null),
    supabase.from('eerr_ajustes_manuales').select('eerr_linea_id, mes, monto').eq('anio', anio).is('sucursal_id', null),
    supabase.from('subcuentas').select('id, cuenta_madre_id'),
    fetchRrhhValores(anio),
  ])
  if (lineasR.error) throw new Error('eerr_lineas: ' + lineasR.error.message)

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

  const lineas = lineasR.data ?? []
  const getnetId = lineas.find(l => l.codigo === 'COMISION_GETNET')?.id
  const costoNetoId = lineas.find(l => l.codigo === 'COSTO_NETO')?.id
  const ajustesGetnet = new Array(12).fill(0)
  const ajustesCostoNeto = new Array(12).fill(0)
  const ajustesCostoNetoCargado = new Array(12).fill(false)
  ;(ajustesR.data ?? []).forEach(a => {
    if (a.eerr_linea_id === getnetId && a.mes >= 1 && a.mes <= 12) ajustesGetnet[a.mes - 1] = Number(a.monto ?? 0)
    if (a.eerr_linea_id === costoNetoId && a.mes >= 1 && a.mes <= 12) {
      ajustesCostoNeto[a.mes - 1] = Number(a.monto ?? 0)
      ajustesCostoNetoCargado[a.mes - 1] = true
    }
  })

  const vals = new Map()
  ORDEN_CODIGOS.forEach(c => vals.set(c, new Array(12).fill(0)))
  const lineasPorId = new Map(lineas.map(l => [l.id, l]))

  ;(mapeoR.data ?? []).forEach(mp => {
    const linea = lineasPorId.get(mp.eerr_linea_id)
    if (!linea) return
    const arr = vals.get(linea.codigo); if (!arr) return
    const signo = Number(mp.signo ?? 1)
    const v = gastosPorCuentaMes.get(mp.cuenta_madre_id)
    if (v) for (let i = 0; i < 12; i++) arr[i] += v[i] * signo
  })

  const get = c => vals.get(c)
  for (let i = 0; i < 12; i++) get('VENTA_BRUTA')[i] = ventasPorMes[i]
  for (let i = 0; i < 12; i++) get('COMISION_GETNET')[i] = ajustesGetnet[i]
  for (let i = 0; i < 12; i++) { if (ajustesCostoNetoCargado[i]) get('COSTO_NETO')[i] = ajustesCostoNeto[i] }

  const sumCodes = (codes, i) => codes.reduce((acc, c) => acc + (get(c)?.[i] ?? 0), 0)
  for (let i = 0; i < 12; i++) {
    get('VENTA_NETA')[i] = get('VENTA_BRUTA')[i] / 1.19
    get('MARGEN_CONTRIB')[i] = get('VENTA_NETA')[i] - get('COSTO_NETO')[i]
    get('TOTAL_GASTO_OPER')[i] = get('REM_OPERACION')[i]
    get('TOTAL_MARGEN_BRUTO')[i] = get('MARGEN_CONTRIB')[i] - get('TOTAL_GASTO_OPER')[i]
    get('TOTAL_GASTO_VENTA')[i] = get('REM_VENTA')[i] + get('MARKETING')[i] + get('COMISION_GETNET')[i]
    get('TOTAL_GASTO_OPERATIVO')[i] = sumCodes(['GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS','COMBUSTIBLE','REM_ADMIN','REM_SOCIOS','FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS'], i)
    get('RESULTADO_OPERACIONAL')[i] = get('TOTAL_MARGEN_BRUTO')[i] - get('TOTAL_GASTO_VENTA')[i] - get('TOTAL_GASTO_OPERATIVO')[i]
    get('TOTAL_MP')[i] = sumCodes(['MP_IMPORTACION','MP_REPOSICION','MP_INVERSION','MP_TRANSPORTES'], i)
    get('RESULTADO_FINAL')[i] = get('RESULTADO_OPERACIONAL')[i] - get('INTERES_CREDITOS')[i] - get('IMPUESTOS')[i] - get('TOTAL_MP')[i]
  }

  // Merge RRHH (remuneraciones devengadas)
  mergeRrhhSobreEerr(vals, rrhh.valoresRrhh)

  return { valores: vals, lineasPorCodigo: new Map(lineas.map(l => [l.codigo, l])) }
}
