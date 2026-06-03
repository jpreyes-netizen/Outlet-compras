import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Sparkles, Loader2 } from 'lucide-react'
import { calcularKPIs, calcularAnalisisAdicionales, generarAlertas, formato, construirResumenParaLLM } from './analisis/motor'
import { PanelKPIs } from './analisis/PanelKPIs'
import { AlertasInteligentes } from './analisis/AlertasInteligentes'
import { fetchRrhhValores, mergeRrhhSobreEerr, compararRrhhVsBanco, CODIGOS_REM_RRHH } from './analisis/rrhh_source'

/* ═══ FIN ANÁLISIS ═══
   Tab dedicado con análisis financiero profundo:
   - KPIs completos con semáforos
   - Alertas inteligentes (todas, no las top N)
   - ROI Marketing, Productividad, Punto de equilibrio, Burn rate, Eficiencia
   - Botón opcional "Análisis del Gerente AI" (LLM, usa Claude API)
*/

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MESES_COL_PRES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const ANIOS = [2024, 2025, 2026]

const MAP_ITEM_TO_CODIGO = {
  'VENTA BRUTA': 'VENTA_BRUTA', 'VENTA NETA': 'VENTA_NETA', 'COSTO NETO': 'COSTO_NETO',
  'MARGEN DE CONTRIBUCIÓN': 'MARGEN_CONTRIB', 'REMUNERACIÓN OPERACIÓN': 'REM_OPERACION',
  'REMUNERACIÓN VENTA': 'REM_VENTA', 'MARKETING': 'MARKETING',
  'COMISIONES POR VENTA (GETNET)': 'COMISION_GETNET', 'GASTOS BANCARIOS': 'GASTOS_BANCARIOS',
  'MOBILIARIO E INFRAESTRUCTURA': 'MOBILIARIO', 'SERVICIOS EXTERNOS': 'SERVICIOS_EXTERNOS',
  'ARRIENDO': 'ARRIENDO', 'CUENTAS BÁSICAS': 'CUENTAS_BASICAS', 'COMBUSTIBLE': 'COMBUSTIBLE',
  'REMUNERACIÓN ADMINISTRATIVOS': 'REM_ADMIN', 'REMUNERACIÓN SOCIOS': 'REM_SOCIOS',
  'FINIQUITOS': 'FINIQUITOS', 'GASTOS TI': 'GASTOS_TI',
  'OTROS GASTOS ADMIN': 'OTROS_GASTOS_ADMIN', 'TRANSPORTE Y VIÁTICOS': 'TRANSPORTE_VIATICOS',
  'ARTÍCULOS DE OFICINA': null, 'TOTAL GASTO OPERATIVO': 'TOTAL_GASTO_OPERATIVO',
  'MATERIA PRIMA IMPORTACIÓN': 'MP_IMPORTACION', 'MATERIA PRIMA REPOSICIÓN': 'MP_REPOSICION',
  'MATERIA PRIMA INVERSIÓN': 'MP_INVERSION', 'MATERIA PRIMA TRANSPORTES': 'MP_TRANSPORTES',
  'TOTAL GASTO MATERIA PRIMA': 'TOTAL_MP', 'CRÉDITOS': 'INTERES_CREDITOS',
  'RESULTADO OPERACIONAL': 'RESULTADO_OPERACIONAL', 'TOTAL EGRESOS': null,
  'FLUJO ECONÓMICO': null, 'IMPUESTOS': 'IMPUESTOS', 'FLUJO FINANCIERO': 'RESULTADO_FINAL',
}

/* ─── Motor EERR (duplicado del que usa FinPresupuesto) ─── */
async function fetchValoresEerr(anio) {
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

  const vals = new Map()
  const ORDEN_CODIGOS = ['VENTA_BRUTA','VENTA_NETA','COSTO_NETO','MARGEN_CONTRIB','REM_OPERACION','TOTAL_GASTO_OPER','TOTAL_MARGEN_BRUTO','REM_VENTA','MARKETING','COMISION_GETNET','TOTAL_GASTO_VENTA','GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS','COMBUSTIBLE','REM_ADMIN','REM_SOCIOS','FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS','REM_PREVIRED','TOTAL_GASTO_OPERATIVO','RESULTADO_OPERACIONAL','INTERES_CREDITOS','IMPUESTOS','MP_IMPORTACION','MP_REPOSICION','MP_INVERSION','MP_TRANSPORTES','TOTAL_MP','RESULTADO_FINAL']
  ORDEN_CODIGOS.forEach(c => vals.set(c, new Array(12).fill(0)))

  const lineasPorId = new Map()
  lineas.forEach(l => lineasPorId.set(l.id, l))

  ;(mapeoR.data ?? []).forEach(mp => {
    const linea = lineasPorId.get(mp.eerr_linea_id)
    if (!linea) return
    const arr = vals.get(linea.codigo); if (!arr) return
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

  return { valores: vals, lineasPorCodigo: new Map(lineas.map(l => [l.codigo, l])) }
}

/* ─── Dotación desde v_rrhh_dotacion ─── */
async function fetchDotacion(anio) {
  const { data, error } = await supabase
    .from('v_rrhh_dotacion')
    .select('periodo, n_trabajadores, n_asignados, n_prestadores')
    .like('periodo', `${anio}-%`)
    .order('periodo')
  if (error) return []
  return (data ?? []).map(d => ({
    mes: Number(d.periodo.split('-')[1]),
    n: Number(d.n_trabajadores ?? 0),
    asignados: Number(d.n_asignados ?? 0),
  }))
}

async function fetchPresupuesto(anio) {
  const { data, error } = await supabase
    .from('eerr_presupuestado').select('*').eq('anio', anio).order('orden')
  if (error) return []
  return (data ?? []).map(p => ({
    item: p.item,
    codigo: MAP_ITEM_TO_CODIGO[p.item],
    pres: MESES_COL_PRES.map(c => Number(p[c] ?? 0)),
  }))
}

/* ─── Componente principal ─── */
export function FinAnalisis({ cu, isMobile }) {
  const [anio, setAnio] = useState(2026)
  const [mesHasta, setMesHasta] = useState(new Date().getMonth() + 1)
  const [data, setData] = useState(null)
  const [dotacion, setDotacion] = useState([])
  const [presupuesto, setPresupuesto] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  // RRHH comparador
  const [rrhhData, setRrhhData] = useState(null)
  const [comparador, setComparador] = useState([])
  // LLM
  const [llmLoading, setLlmLoading] = useState(false)
  const [llmRespuesta, setLlmRespuesta] = useState(null)
  const [llmError, setLlmError] = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    Promise.all([fetchValoresEerr(anio), fetchDotacion(anio), fetchPresupuesto(anio), fetchRrhhValores(anio)])
      .then(([d, dot, pres, rrhh]) => {
        // Guardar copia de valores ORIGINALES de banco (solo las 4 líneas REM) antes de mergear
        const bancoOriginales = new Map()
        CODIGOS_REM_RRHH.forEach(c => {
          const arr = d.valores.get(c) ?? new Array(12).fill(0)
          bancoOriginales.set(c, arr.slice())
        })
        // Mergear RRHH sobre EERR
        mergeRrhhSobreEerr(d.valores, rrhh.valoresRrhh)
        // Generar tabla comparadora
        const cmp = compararRrhhVsBanco(rrhh.valoresRrhh, bancoOriginales)

        setData(d); setDotacion(dot); setPresupuesto(pres)
        setRrhhData(rrhh); setComparador(cmp)
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [anio, reloadKey])

  // Dotación del mes actual
  const dotacionMes = useMemo(() => {
    if (!dotacion.length) return null
    const target = dotacion.find(d => d.mes === mesHasta) || dotacion[dotacion.length - 1]
    return target?.n ?? null
  }, [dotacion, mesHasta])

  // Valores del período anterior — para mes-vs-mes y crecimientos
  const valoresPrev = useMemo(() => {
    if (!data) return null
    // Truco: crear un Map clon donde los valores se truncan al mes anterior
    if (mesHasta <= 1) return null
    const clon = new Map()
    data.valores.forEach((arr, k) => {
      const copia = new Array(12).fill(0)
      for (let i = 0; i < mesHasta - 1; i++) copia[i] = arr[i] || 0
      clon.set(k, copia)
    })
    return clon
  }, [data, mesHasta])

  const kpis = useMemo(() => {
    if (!data) return []
    return calcularKPIs({ valores: data.valores, mesHasta, dotacionMes })
  }, [data, mesHasta, dotacionMes])

  const analisis = useMemo(() => {
    if (!data) return {}
    return calcularAnalisisAdicionales({ valores: data.valores, valoresPrev, mesHasta, dotacionMes })
  }, [data, valoresPrev, mesHasta, dotacionMes])

  const alertas = useMemo(() => {
    if (!data) return []
    return generarAlertas({
      valores: data.valores,
      valoresPrev,
      presupuesto,
      mesHasta,
      lineasPorCodigo: data.lineasPorCodigo,
      dotacionPorMes: dotacion.slice(0, mesHasta),
    })
  }, [data, valoresPrev, presupuesto, mesHasta, dotacion])

  /* ─── Botón LLM: pide análisis a Claude API ─── */
  async function pedirAnalisisIA() {
    setLlmLoading(true); setLlmError(null); setLlmRespuesta(null)
    try {
      const resumen = construirResumenParaLLM({ kpis, alertas, analisis, anio, mesHasta })
      const prompt = `Eres un gerente de finanzas senior de un retail chileno de venta de puertas (Outlet de Puertas SpA, 3 sucursales, ~1.000 SKUs, ticket promedio ~$150K).

Te paso el resumen ejecutivo del EERR acumulado y los hallazgos del motor de alertas. Tu tarea es escribir un análisis breve (máximo 4 párrafos) que:

1. Diagnostica la salud financiera real del negocio en este período.
2. Identifica las 2-3 prioridades inmediatas que tomarías esta semana.
3. Da una recomendación accionable concreta (no genérica) para la prioridad #1.
4. Termina con una pregunta crítica que el dueño debería hacerse.

Tono: directo, profesional, sin adornos. Si los datos están mal o subreportados, dilo. Si todo está sano, dilo sin endulzar.

DATOS:
${resumen}`

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const out = await resp.json()
      if (out.content?.[0]?.text) setLlmRespuesta(out.content[0].text)
      else throw new Error(out.error?.message || 'Respuesta vacía del modelo')
    } catch (e) {
      setLlmError(e.message)
    } finally {
      setLlmLoading(false)
    }
  }

  const selectSt = { padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff' }
  const btnSt = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header controles */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Año</label>
          <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
            {ANIOS.map(a => <option key={a} value={String(a)}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Análisis acumulado hasta</label>
          <select style={selectSt} value={String(mesHasta)} onChange={e => setMesHasta(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => setReloadKey(k => k + 1)} disabled={loading} style={btnSt}>
            <RefreshCw size={13} /> Recalcular
          </button>
          <button
            onClick={pedirAnalisisIA}
            disabled={llmLoading || loading || !data}
            style={{ ...btnSt, background: '#7C3AED', color: '#fff', border: 'none', opacity: (llmLoading || !data) ? 0.6 : 1 }}
            title="Análisis narrativo generado por Claude AI"
          >
            {llmLoading ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            {llmLoading ? 'Analizando...' : 'Análisis del Gerente AI'}
          </button>
        </div>
      </div>

      {error && <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>Error: {error}</div>}

      {/* Aviso descuadre BSALE — mismo banner que en Presupuesto */}
      <div style={{ borderRadius: 8, border: '1px solid #FCD34D', background: '#FEF3C7', padding: '10px 14px', fontSize: 12, color: '#92400E', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>⚠️</span>
        <div style={{ flex: 1, lineHeight: 1.5 }}>
          <b>Avisos:</b> <br/>
          <b>1.</b> Ventas dependen de <code style={{ background: '#FDE68A', padding: '0 4px', borderRadius: 3 }}>ventas_bsale_dia</code> que actualmente subreporta vs BSALE. Conclusiones cualitativas válidas; valores absolutos sujetos a ajuste cuando se reconcilie el pipeline.<br/>
          <b>2.</b> Remuneraciones (REM_*) ahora provienen de <code style={{ background: '#FDE68A', padding: '0 4px', borderRadius: 3 }}>v_rrhh_master</code> (devengado, costo empresa total incluyendo aportes patronales prorrateados). REM_PREVIRED eliminado del cálculo. Ver tabla comparadora abajo.
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Array.from({ length: 8 }).map((_, i) => <div key={i} style={{ height: 60, background: '#F3F4F6', borderRadius: 8 }} />)}
        </div>
      )}

      {!loading && data && (
        <>
          {/* Respuesta LLM (si la hay) */}
          {llmRespuesta && (
            <div style={{ background: 'linear-gradient(135deg, #FAF5FF 0%, #F5F3FF 100%)', border: '1px solid #DDD6FE', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Sparkles size={14} color="#7C3AED" />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#6D28D9', letterSpacing: '0.04em' }}>ANÁLISIS DEL GERENTE AI</span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: '#1F2937', whiteSpace: 'pre-wrap' }}>{llmRespuesta}</div>
            </div>
          )}
          {llmError && (
            <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 12, color: '#DC2626' }}>
              Error al consultar IA: {llmError}
            </div>
          )}

          {/* KPIs principales */}
          <PanelKPIs kpis={kpis} titulo="KPIs DE SALUD FINANCIERA" />

          {/* Análisis adicionales: ROI, PE, Burn, etc. */}
          <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 10, letterSpacing: '0.02em' }}>
              MÉTRICAS DE GESTIÓN
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              <MetricaBox titulo="ROI Marketing"
                valor={analisis.roiMarketing !== null ? formato.ratio(analisis.roiMarketing) + 'x' : 'Sin datos suficientes'}
                detalle="Δ Venta Neta vs Δ Marketing (período actual vs anterior). Valor >0 = el gasto en marketing está moviendo ventas."
                color={analisis.roiMarketing > 5 ? '#047857' : analisis.roiMarketing > 0 ? '#B45309' : '#B91C1C'} />
              <MetricaBox titulo="Productividad Remuneraciones"
                valor={formato.ratio(analisis.productividadRem) + 'x'}
                detalle={`Cada $1 de planilla genera ${formato.ratio(analisis.productividadRem)} de venta neta.`}
                color={analisis.productividadRem >= 5 ? '#047857' : analisis.productividadRem >= 3 ? '#B45309' : '#B91C1C'} />
              <MetricaBox titulo="Punto de Equilibrio (mes)"
                valor={formato.clp(analisis.puntoEquilibrioMes)}
                detalle={`Mínimo a vender en un mes para no perder. Venta promedio actual: ${formato.clp(analisis.ventaPromMes)}.`}
                color={analisis.ventaPromMes >= analisis.puntoEquilibrioMes ? '#047857' : '#B91C1C'} />
              <MetricaBox titulo="Burn Rate Diario"
                valor={formato.clp(analisis.burnDiario)}
                detalle="Quema diaria de gastos operativos (oper + venta + admin)."
                color="#6B7280" />
              <MetricaBox titulo="Eficiencia Operativa"
                valor={formato.pct((analisis.eficienciaOp || 0) * 100)}
                detalle="Resultado Operacional / Total Gastos Operativos. Mayor = más eficiente."
                color={analisis.eficienciaOp > 0.15 ? '#047857' : analisis.eficienciaOp > 0 ? '#B45309' : '#B91C1C'} />
              <MetricaBox titulo="Gastos Fijos / mes"
                valor={formato.clp(analisis.gastosFijosMes)}
                detalle="Estimación (arriendo + remuneraciones). Costo de mantener el negocio abierto sin vender."
                color="#6B7280" />
            </div>
          </div>

          {/* Alertas completas */}
          <AlertasInteligentes alertas={alertas} titulo="Hallazgos del motor de análisis" />

          {/* Comparador RRHH devengado vs Banco pagado */}
          <ComparadorRrhhVsBanco comparador={comparador} validacion={rrhhData?.validacion} mesHasta={mesHasta} />
        </>
      )}

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function MetricaBox({ titulo, valor, detalle, color }) {
  return (
    <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px', border: '1px solid #F3F4F6' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{titulo}</div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: color || '#111827', marginBottom: 4 }}>{valor}</div>
      <div style={{ fontSize: 10, color: '#9CA3AF', lineHeight: 1.4 }}>{detalle}</div>
    </div>
  )
}

/* ═══ COMPARADOR RRHH DEVENGADO vs BANCO PAGADO ═══
   Muestra la diferencia entre lo que dice RRHH (devengado, ahora fuente del EERR)
   vs lo que decían los movimientos bancarios (pagado, antes era la fuente).
   También muestra la validación matemática: suma 4 líneas RRHH ≈ total_costo_empresa.
*/
function ComparadorRrhhVsBanco({ comparador, validacion, mesHasta }) {
  if (!comparador || comparador.length === 0) return null

  const NOMBRES = {
    REM_OPERACION: 'Rem. Operación',
    REM_VENTA: 'Rem. Venta',
    REM_ADMIN: 'Rem. Administrativos',
    REM_SOCIOS: 'Rem. Socios',
  }

  const fmt = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)

  // Sumas hasta mesHasta para resumen
  const resumen = comparador.map(row => {
    let totRrhh = 0, totBanco = 0
    for (let i = 0; i < mesHasta; i++) {
      totRrhh += row.rrhh[i] || 0
      totBanco += row.banco[i] || 0
    }
    return { codigo: row.codigo, totRrhh, totBanco, diferencia: totRrhh - totBanco }
  })

  const totalRrhh = resumen.reduce((s, r) => s + r.totRrhh, 0)
  const totalBanco = resumen.reduce((s, r) => s + r.totBanco, 0)
  const totalDif = totalRrhh - totalBanco

  // Validación: ¿la suma de las 4 líneas RRHH cuadra con total_costo_empresa?
  const validacionAcumulada = (validacion ?? []).slice(0, mesHasta)
  const sumaCalcAcum = validacionAcumulada.reduce((s, v) => s + (v.sumaCalculada || 0), 0)
  const totalCostoEmpAcum = validacionAcumulada.reduce((s, v) => s + (v.totalCostoEmpresa || 0), 0)
  const difValidacion = sumaCalcAcum - totalCostoEmpAcum
  const validacionOk = totalCostoEmpAcum > 0 ? Math.abs(difValidacion / totalCostoEmpAcum) < 0.01 : true

  const TH = { padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: '#6B7280', background: '#F9FAFB', textTransform: 'uppercase', letterSpacing: '0.04em' }
  const TD = { padding: '8px 10px', fontSize: 12 }

  return (
    <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 3 }}>
          🔍 Comparador: RRHH (devengado) vs Banco (pagado)
        </div>
        <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.4 }}>
          Las líneas REM_* ahora se calculan desde RRHH (haberes + aportes patronales prorrateados). Esta tabla muestra cuánto difieren respecto a lo que mostraban antes desde movimientos bancarios.
        </div>
      </div>

      {/* Validación matemática */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid #F3F4F6',
        background: validacionOk ? '#ECFDF5' : '#FEF3C7',
        fontSize: 11, color: validacionOk ? '#047857' : '#92400E',
      }}>
        <b>{validacionOk ? '✓ Validación OK:' : '⚠ Validación con desvío:'}</b> Suma de las 4 líneas RRHH ({fmt(sumaCalcAcum)}) {validacionOk ? '≈' : 'vs'} total costo empresa según v_rrhh_costo_empresa ({fmt(totalCostoEmpAcum)}). Diferencia: {fmt(difValidacion)} ({totalCostoEmpAcum > 0 ? (difValidacion / totalCostoEmpAcum * 100).toFixed(2) : 0}%).
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
              <th style={{ ...TH }}>Línea EERR</th>
              <th style={{ ...TH, textAlign: 'right' }}>RRHH (devengado)</th>
              <th style={{ ...TH, textAlign: 'right' }}>Banco (pagado)</th>
              <th style={{ ...TH, textAlign: 'right' }}>Diferencia</th>
              <th style={{ ...TH, textAlign: 'right' }}>%</th>
            </tr>
          </thead>
          <tbody>
            {resumen.map(r => {
              const pct = r.totBanco > 0 ? (r.diferencia / r.totBanco) * 100 : null
              return (
                <tr key={r.codigo} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ ...TD, fontWeight: 500, color: '#111827' }}>{NOMBRES[r.codigo] || r.codigo}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#111827' }}>{fmt(r.totRrhh)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#6B7280' }}>{fmt(r.totBanco)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: r.diferencia > 0 ? '#15803D' : r.diferencia < 0 ? '#DC2626' : '#6B7280' }}>{fmt(r.diferencia)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#6B7280' }}>{pct !== null ? (pct > 0 ? '+' : '') + pct.toFixed(1) + '%' : '—'}</td>
                </tr>
              )
            })}
            <tr style={{ borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }}>
              <td style={{ ...TD, fontWeight: 700 }}>TOTAL</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(totalRrhh)}</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#6B7280' }}>{fmt(totalBanco)}</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: totalDif > 0 ? '#15803D' : totalDif < 0 ? '#DC2626' : '#6B7280' }}>{fmt(totalDif)}</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#6B7280' }}>
                {totalBanco > 0 ? ((totalDif > 0 ? '+' : '') + (totalDif / totalBanco * 100).toFixed(1) + '%') : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ padding: '10px 16px', borderTop: '1px solid #F3F4F6', fontSize: 11, color: '#6B7280', lineHeight: 1.5 }}>
        <b>Interpretación:</b> diferencia positiva = lo devengado supera lo pagado (atraso de pago o anticipos pendientes). Diferencia negativa = se pagó más de lo devengado (pago anticipado o concepto mal categorizado). Una diferencia consistentemente grande sugiere revisar la conciliación entre RRHH y banco.
      </div>
    </div>
  )
}
