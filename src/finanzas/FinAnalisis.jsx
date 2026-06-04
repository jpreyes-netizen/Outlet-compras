import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { RefreshCw, Sparkles, Loader2, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { calcularKPIs, calcularMetricasGestion, generarAlertas, formato, construirResumenParaLLM, LINEAS_FIJAS } from './analisis/motor'
import { PanelKPIs } from './analisis/PanelKPIs'
import { AlertasInteligentes } from './analisis/AlertasInteligentes'
import { DetalleKPI } from './analisis/DetalleKPI'
import { GraficoMargenes, GraficoGastoVsVenta, GraficoComposicionGastos, GraficoPuntoEquilibrio, GraficoTopGastos } from './analisis/GraficosTendencia'
import { fetchRrhhValores, mergeRrhhSobreEerr } from './analisis/rrhh_source'

/* ═══ FIN ANÁLISIS v2 ═══
   Dashboard ejecutivo financiero con 3 sub-vistas:
   - Salud Financiera: KPIs clickeables + gráfico de márgenes + composición + PE
   - Estructura de Costos: top gastos, composición visual, gasto vs venta
   - Diagnóstico: alertas drilleables + análisis del Gerente AI
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
  'TOTAL GASTO OPERATIVO': 'TOTAL_GASTO_OPERATIVO',
  'MATERIA PRIMA IMPORTACIÓN': 'MP_IMPORTACION', 'MATERIA PRIMA REPOSICIÓN': 'MP_REPOSICION',
  'MATERIA PRIMA INVERSIÓN': 'MP_INVERSION', 'MATERIA PRIMA TRANSPORTES': 'MP_TRANSPORTES',
  'TOTAL GASTO MATERIA PRIMA': 'TOTAL_MP', 'CRÉDITOS': 'INTERES_CREDITOS',
  'RESULTADO OPERACIONAL': 'RESULTADO_OPERACIONAL',
  'IMPUESTOS': 'IMPUESTOS', 'FLUJO FINANCIERO': 'RESULTADO_FINAL',
}

/* ─── Motor EERR (mismo de antes, sin cambios) ─── */
async function fetchValoresEerr(anio) {
  const yStart = anio + '-01-01', yEnd = anio + '-12-31'
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
  const ORDEN_CODIGOS = ['VENTA_BRUTA','VENTA_NETA','COSTO_NETO','MARGEN_CONTRIB','REM_OPERACION','TOTAL_GASTO_OPER','TOTAL_MARGEN_BRUTO','REM_VENTA','MARKETING','COMISION_GETNET','TOTAL_GASTO_VENTA','GASTOS_BANCARIOS','MOBILIARIO','SERVICIOS_EXTERNOS','ARRIENDO','CUENTAS_BASICAS','COMBUSTIBLE','REM_ADMIN','REM_SOCIOS','FINIQUITOS','GASTOS_TI','OTROS_GASTOS_ADMIN','TRANSPORTE_VIATICOS','TOTAL_GASTO_OPERATIVO','RESULTADO_OPERACIONAL','INTERES_CREDITOS','IMPUESTOS','MP_IMPORTACION','MP_REPOSICION','MP_INVERSION','MP_TRANSPORTES','TOTAL_MP','RESULTADO_FINAL']
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
  const costoNeto = vals.get('COSTO_NETO')
  for (let i = 0; i < 12; i++) {
    if (ajustesCostoNetoCargado[i]) costoNeto[i] = ajustesCostoNeto[i]
  }

  const get = c => vals.get(c)
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

  return { valores: vals, lineasPorCodigo: new Map(lineas.map(l => [l.codigo, l])) }
}

async function fetchDotacion(anio) {
  const { data, error } = await supabase
    .from('v_rrhh_dotacion')
    .select('periodo, n_trabajadores, n_asignados, n_prestadores')
    .like('periodo', anio + '-%')
    .order('periodo')
  if (error) return []
  return (data ?? []).map(d => ({ mes: Number(d.periodo.split('-')[1]), n: Number(d.n_trabajadores ?? 0), asignados: Number(d.n_asignados ?? 0) }))
}

async function fetchPresupuestoMap(anio) {
  const { data, error } = await supabase.from('eerr_presupuestado').select('*').eq('anio', anio).order('orden')
  if (error) return new Map()
  const m = new Map()
  ;(data ?? []).forEach(p => {
    const codigo = MAP_ITEM_TO_CODIGO[p.item]
    if (!codigo) return
    m.set(codigo, MESES_COL_PRES.map(c => Number(p[c] ?? 0)))
  })
  return m
}

/* ═══ Componente principal ═══ */
export function FinAnalisis({ cu, isMobile }) {
  const [anio, setAnio] = useState(2026)
  const [mesHasta, setMesHasta] = useState(new Date().getMonth() + 1)
  const [vista, setVista] = useState('salud')
  const [data, setData] = useState(null)
  const [dotacion, setDotacion] = useState([])
  const [presupuestoMap, setPresupuestoMap] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [kpiSeleccionado, setKpiSeleccionado] = useState(null)
  // LLM
  const [llmLoading, setLlmLoading] = useState(false)
  const [llmRespuesta, setLlmRespuesta] = useState(null)
  const [llmError, setLlmError] = useState(null)

  useEffect(() => {
    setLoading(true); setError(null)
    Promise.all([fetchValoresEerr(anio), fetchDotacion(anio), fetchPresupuestoMap(anio), fetchRrhhValores(anio)])
      .then(([d, dot, pres, rrhh]) => {
        mergeRrhhSobreEerr(d.valores, rrhh.valoresRrhh)
        setData(d); setDotacion(dot); setPresupuestoMap(pres)
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [anio, reloadKey])

  const dotacionMes = useMemo(() => {
    if (!dotacion.length) return null
    const t = dotacion.find(d => d.mes === mesHasta) || dotacion[dotacion.length - 1]
    return t?.n ?? null
  }, [dotacion, mesHasta])

  const kpis = useMemo(() => {
    if (!data) return []
    return calcularKPIs({ valores: data.valores, mesHasta, dotacionMes, lineasPorCodigo: data.lineasPorCodigo })
  }, [data, mesHasta, dotacionMes])

  const metricas = useMemo(() => {
    if (!data) return {}
    return calcularMetricasGestion({ valores: data.valores, mesHasta, lineasPorCodigo: data.lineasPorCodigo })
  }, [data, mesHasta])

  const alertas = useMemo(() => {
    if (!data) return []
    return generarAlertas({
      valores: data.valores, presupuestoMap, mesHasta,
      lineasPorCodigo: data.lineasPorCodigo,
    })
  }, [data, presupuestoMap, mesHasta])

  /* Drill-down: cuando se clickea una alerta, generar pseudo-KPI desde la línea EERR afectada */
  const onClickAlerta = (alerta) => {
    if (!alerta.codigo || !data) return
    const arr = data.valores.get(alerta.codigo) ?? new Array(12).fill(0)
    const linea = data.lineasPorCodigo.get(alerta.codigo)
    let acumulado = 0
    for (let i = 0; i < mesHasta; i++) acumulado += arr[i] || 0
    setKpiSeleccionado({
      id: 'alerta-' + alerta.codigo,
      titulo: linea?.nombre ?? alerta.codigo,
      valor: acumulado,
      formato: 'clp',
      semaforo: alerta.severidad === 'critica' ? 'rojo' : alerta.severidad === 'atencion' ? 'amarillo' : 'verde',
      sub: alerta.titulo,
      benchmark: 'Investigación de alerta',
      explicacion: alerta.detalle,
      formula: null,
      composicion: [{ codigo: alerta.codigo, nombre: linea?.nombre ?? alerta.codigo, monto: acumulado, peso: 1 }],
      evolucionPct: Array.from({ length: 12 }, (_, i) => i < mesHasta ? (arr[i] || 0) : null),
      cambio: null,
    })
  }

  async function pedirAnalisisIA() {
    setLlmLoading(true); setLlmError(null); setLlmRespuesta(null)
    try {
      const resumen = construirResumenParaLLM({ kpis, alertas, metricas, anio, mesHasta })
      const prompt = `Eres un CFO senior de un retail chileno de venta de puertas (Outlet de Puertas SpA, 3 sucursales, ~1.000 SKUs, ticket promedio ~$150K).

Analiza estos datos del EERR acumulado y entrega un análisis ejecutivo en 4 párrafos:

1. **Diagnóstico** — qué dice realmente la salud financiera del negocio. Sé directo.
2. **3 prioridades** — qué tomarías esta semana, en orden.
3. **Acción concreta para la prioridad 1** — no genérico, específico al contexto.
4. **Pregunta crítica** — la que el dueño debería estarse haciendo.

No endulces. Si los datos están raros, dilo.

${resumen}`

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
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
      {/* Controles */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Año</label>
          <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
            {ANIOS.map(a => <option key={a} value={String(a)}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }}>Acumulado hasta</label>
          <select style={selectSt} value={String(mesHasta)} onChange={e => setMesHasta(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => setReloadKey(k => k + 1)} disabled={loading} style={btnSt}>
            <RefreshCw size={13} /> Recalcular
          </button>
        </div>
      </div>

      {error && <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>Error: {error}</div>}

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        {[
          { k: 'salud',       l: 'Salud Financiera',    icon: <CheckCircle2 size={13} /> },
          { k: 'estructura',  l: 'Estructura de Costos', icon: <TrendingUp size={13} /> },
          { k: 'diagnostico', l: 'Diagnóstico',          icon: <AlertTriangle size={13} /> },
        ].map(t => (
          <button key={t.k} onClick={() => setVista(t.k)} style={{
            padding: '10px 16px', fontSize: 13, fontWeight: 600,
            background: 'none', border: 'none', cursor: 'pointer',
            color: vista === t.k ? '#1F4E79' : '#8E8E93',
            borderBottom: vista === t.k ? '2px solid #1F4E79' : '2px solid transparent',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>{t.icon} {t.l}</button>
        ))}
      </div>

      {loading && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ height: 80, background: '#F3F4F6', borderRadius: 8 }} />)}</div>}

      {!loading && data && vista === 'salud' && (
        <SaludFinanciera kpis={kpis} metricas={metricas} valores={data.valores} mesHasta={mesHasta} lineasPorCodigo={data.lineasPorCodigo} onClickKpi={setKpiSeleccionado} />
      )}

      {!loading && data && vista === 'estructura' && (
        <EstructuraCostos valores={data.valores} mesHasta={mesHasta} lineasPorCodigo={data.lineasPorCodigo} metricas={metricas} />
      )}

      {!loading && data && vista === 'diagnostico' && (
        <Diagnostico
          alertas={alertas}
          onClickAlerta={onClickAlerta}
          onPedirIA={pedirAnalisisIA}
          llmLoading={llmLoading}
          llmRespuesta={llmRespuesta}
          llmError={llmError}
        />
      )}

      {/* Drill-down modal */}
      {kpiSeleccionado && (
        <DetalleKPI
          kpi={kpiSeleccionado}
          anio={anio}
          mesHasta={mesHasta}
          lineasPorCodigo={data?.lineasPorCodigo}
          onClose={() => setKpiSeleccionado(null)}
        />
      )}

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

/* ─── Sub-vista 1: Salud Financiera ─── */
function SaludFinanciera({ kpis, metricas, valores, mesHasta, lineasPorCodigo, onClickKpi }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PanelKPIs kpis={kpis} titulo="KPIs DE SALUD FINANCIERA (haz click en cualquiera)" onClickKpi={onClickKpi} />
      <GraficoMargenes valores={valores} mesHasta={mesHasta} />
      <PanelPuntoEquilibrio metricas={metricas} valores={valores} mesHasta={mesHasta} />
    </div>
  )
}

/* ─── Sub-vista 2: Estructura de Costos ─── */
function EstructuraCostos({ valores, mesHasta, lineasPorCodigo, metricas }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <GraficoGastoVsVenta valores={valores} mesHasta={mesHasta} />
      <GraficoComposicionGastos valores={valores} mesHasta={mesHasta} lineasPorCodigo={lineasPorCodigo} />
      <GraficoTopGastos valores={valores} mesHasta={mesHasta} lineasPorCodigo={lineasPorCodigo} />
      <PanelMetricasGestion metricas={metricas} />
    </div>
  )
}

/* ─── Sub-vista 3: Diagnóstico ─── */
function Diagnostico({ alertas, onClickAlerta, onPedirIA, llmLoading, llmRespuesta, llmError }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Análisis del Gerente AI */}
      <div style={{ background: 'linear-gradient(135deg, #FAF5FF 0%, #F5F3FF 100%)', border: '1px solid #DDD6FE', borderRadius: 12, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Sparkles size={18} color="#7C3AED" />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#6D28D9', letterSpacing: '0.04em' }}>ANÁLISIS DEL GERENTE AI</span>
          <button
            onClick={onPedirIA}
            disabled={llmLoading}
            style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 7, background: '#7C3AED', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: llmLoading ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            {llmLoading ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            {llmLoading ? 'Analizando...' : (llmRespuesta ? 'Volver a generar' : 'Generar análisis')}
          </button>
        </div>
        {llmRespuesta ? (
          <div style={{ fontSize: 13, lineHeight: 1.6, color: '#1F2937', whiteSpace: 'pre-wrap' }}>{llmRespuesta}</div>
        ) : (
          <div style={{ fontSize: 12, color: '#6B7280' }}>
            Click en "Generar análisis" para que el AI revise los KPIs, alertas y métricas y te entregue un análisis ejecutivo (4 párrafos).
          </div>
        )}
        {llmError && <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: '#FEF2F2', color: '#DC2626', fontSize: 12 }}>Error: {llmError}</div>}
      </div>

      <AlertasInteligentes alertas={alertas} titulo="Hallazgos del motor (click para investigar)" onClickAlerta={onClickAlerta} />
    </div>
  )
}

/* ─── Panel de Punto de Equilibrio ─── */
function PanelPuntoEquilibrio({ metricas, valores, mesHasta }) {
  if (!metricas.peMensual) {
    return (
      <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>PUNTO DE EQUILIBRIO</div>
        <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 6 }}>No calculable (sin margen bruto positivo o sin gastos fijos cargados).</div>
      </div>
    )
  }
  const sobre = metricas.ventaPromMes >= metricas.peMensual
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 10 }}>PUNTO DE EQUILIBRIO MENSUAL</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <MetricaBox titulo="PE Mensual" valor={formato.clp(metricas.peMensual)} detalle="Mínimo a vender en un mes para no perder." color={sobre ? '#047857' : '#DC2626'} />
          <MetricaBox titulo="Venta promedio actual" valor={formato.clp(metricas.ventaPromMes)} detalle={(sobre ? 'Sobre' : 'Bajo') + ' PE por ' + formato.clp(Math.abs(metricas.ventaPromMes - metricas.peMensual))} color={sobre ? '#047857' : '#DC2626'} />
          <MetricaBox titulo="Margen de seguridad" valor={metricas.margenSeguridadPct !== null ? metricas.margenSeguridadPct.toFixed(1) + '%' : 'n/d'} detalle="(Venta - PE) / Venta. Cuánto puede caer la venta antes de perder." color={metricas.margenSeguridadPct > 20 ? '#047857' : metricas.margenSeguridadPct > 0 ? '#B45309' : '#DC2626'} />
          <MetricaBox titulo="Gastos fijos / mes" valor={formato.clp(metricas.gastosFijosMes)} detalle={metricas.composicionFijos.length + ' líneas fijas en el EERR'} color="#6B7280" />
        </div>
      </div>
      <GraficoPuntoEquilibrio valores={valores} mesHasta={mesHasta} peMensual={metricas.peMensual} />
      <DesgloseFijos composicionFijos={metricas.composicionFijos} mesesPeriodo={mesHasta} />
    </div>
  )
}

function DesgloseFijos({ composicionFijos, mesesPeriodo }) {
  if (!composicionFijos || composicionFijos.length === 0) return null
  const total = composicionFijos.reduce((s, it) => s + it.monto, 0)
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 10 }}>
        COMPOSICIÓN DE GASTOS FIJOS (base del PE)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {composicionFijos.map(it => {
          const peso = total > 0 ? it.monto / total : 0
          const promedioMes = it.monto / mesesPeriodo
          return (
            <div key={it.codigo} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 10, alignItems: 'center', fontSize: 12 }}>
              <span style={{ color: '#111827', fontWeight: 500 }}>{it.nombre}</span>
              <span style={{ fontSize: 10, color: '#6B7280' }}>{(peso * 100).toFixed(1)}%</span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#6B7280' }}>{formato.clp(promedioMes)}/mes</span>
              <span style={{ fontFamily: 'monospace', color: '#111827', fontWeight: 600, minWidth: 110, textAlign: 'right' }}>{formato.clp(it.monto)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Panel de métricas de gestión (no son KPIs, son herramientas) ─── */
function PanelMetricasGestion({ metricas }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 10, letterSpacing: '0.02em' }}>MÉTRICAS DE GESTIÓN</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <MetricaBox titulo="Eficiencia Marketing"
          valor={metricas.eficienciaMkt ? '$' + metricas.eficienciaMkt.toFixed(1) + ' VN / $1 Mkt' : 'n/d'}
          detalle={'Venta neta generada por cada $1 de marketing en los últimos ' + (metricas.ultimosMesesAnalizados || 0) + ' meses. NO es ROI (no implica causalidad).'}
          color={metricas.eficienciaMkt > 30 ? '#047857' : metricas.eficienciaMkt > 15 ? '#B45309' : '#DC2626'} />
        <MetricaBox titulo="Productividad Remuneraciones"
          valor={formato.ratio(metricas.productividadRem) + 'x'}
          detalle={'Cada $1 de planilla genera $' + (metricas.productividadRem || 0).toFixed(2) + ' de venta neta.'}
          color={metricas.productividadRem >= 5 ? '#047857' : metricas.productividadRem >= 3 ? '#B45309' : '#DC2626'} />
        <MetricaBox titulo="Burn Rate Diario"
          valor={formato.clp(metricas.burnDiario)}
          detalle="Quema diaria de gastos operativos."
          color="#6B7280" />
        <MetricaBox titulo="Eficiencia Operativa"
          valor={((metricas.eficienciaOp || 0) * 100).toFixed(1) + '%'}
          detalle="Resultado Operacional / Gastos Operativos. Mayor = más eficiente."
          color={metricas.eficienciaOp > 0.15 ? '#047857' : metricas.eficienciaOp > 0 ? '#B45309' : '#DC2626'} />
      </div>
    </div>
  )
}

function MetricaBox({ titulo, valor, detalle, color }) {
  return (
    <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px', border: '1px solid #F3F4F6' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{titulo}</div>
      <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'monospace', color: color || '#111827', marginBottom: 4 }}>{valor}</div>
      <div style={{ fontSize: 10, color: '#9CA3AF', lineHeight: 1.4 }}>{detalle}</div>
    </div>
  )
}
