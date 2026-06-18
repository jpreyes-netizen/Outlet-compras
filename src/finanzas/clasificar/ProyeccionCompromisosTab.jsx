import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Save, Sparkles, Info, CalendarDays, Settings2, CalendarClock, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Area, AreaChart } from 'recharts'
import { supabase } from '../../supabase'
import { cargarDatosProyeccion, construirProyeccion, diasHabilesMes, rangoSemana, VENTA_CODIGOS, fmtCLP, fmtCLPplano, fmtMM } from './proyeccionEngine'

const PRIMARY = '#1F4E79'
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const ANIOS = [2024, 2025, 2026, 2027]

const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#374151', background: '#F1F5F9', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 }
const TD = { padding: '7px 8px', fontSize: 12, color: '#374151', borderBottom: '1px solid #F1F5F9' }

export function ProyeccionCompromisosTab({ anio, setAnio }) {
  const [sub, setSub]           = useState('semanal')   // 'parametros' | 'semanal'
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [sugiriendo, setSugiriendo] = useState(false)
  const [feriados, setFeriados] = useState(new Set())
  const [venta, setVenta]       = useState({})
  const [umbral, setUmbral]     = useState(60000000)
  const [global66, setGlobal66] = useState(0)

  const [raw, setRaw]           = useState(null)        // datos crudos del motor de egresos
  const [engineLoading, setEngineLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  // impuestos manual
  const [imps, setImps]         = useState([])
  const [nuevoImp, setNuevoImp] = useState({ fecha: '', concepto: '', monto: '' })

  // ── Cargar config + feriados ──
  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setLoading(true)
      try {
        const desde = `${anio}-01-01`, hasta = `${anio}-12-31`
        const [cfgR, ferR] = await Promise.all([
          supabase.from('flujo_proyeccion_config').select('*').eq('anio', anio).maybeSingle(),
          supabase.from('feriados').select('fecha').eq('irrenunciable', true).gte('fecha', desde).lte('fecha', hasta),
        ])
        if (cancelado) return
        setFeriados(new Set((ferR.data ?? []).map(f => f.fecha)))
        const cfg = cfgR.data
        const vd = {}; const rawv = cfg?.venta_diaria ?? {}
        for (let m = 1; m <= 12; m++) vd[m] = Number(rawv[m] ?? rawv[String(m)] ?? 0) || 0
        setVenta(vd)
        setUmbral(Number(cfg?.umbral_minimo ?? 60000000) || 60000000)
        setGlobal66(Number(cfg?.global66_saldo_clp ?? 0) || 0)
      } catch (e) {
        toast.error('Error cargando config: ' + (e?.message ?? '?'))
      } finally { if (!cancelado) setLoading(false) }
    })()
    return () => { cancelado = true }
  }, [anio])

  // ── Cargar datos crudos del motor (pesado, refresca por reloadKey) ──
  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setEngineLoading(true)
      try {
        const data = await cargarDatosProyeccion(anio)
        if (cancelado) return
        setImps(data.impuestos)
        setRaw(data)
      } catch (e) {
        toast.error('Error motor: ' + (e?.message ?? '?'))
        setRaw(null)
      } finally { if (!cancelado) setEngineLoading(false) }
    })()
    return () => { cancelado = true }
  }, [anio, reloadKey])

  // ── Días hábiles e ingresos (E1) ──
  const habiles = useMemo(() => { const h = {}; for (let m = 1; m <= 12; m++) h[m] = diasHabilesMes(anio, m, feriados); return h }, [anio, feriados])
  const totalHabiles = useMemo(() => Object.values(habiles).reduce((s, n) => s + n, 0), [habiles])
  const ingresoMes = useMemo(() => { const i = {}; for (let m = 1; m <= 12; m++) i[m] = (habiles[m] || 0) * (venta[m] || 0); return i }, [habiles, venta])
  const ingresoAnio = useMemo(() => Object.values(ingresoMes).reduce((s, n) => s + n, 0), [ingresoMes])

  // ── Proyección semanal — vía motor compartido, recalcula al editar venta/umbral ──
  const proy = useMemo(
    () => (raw ? construirProyeccion(raw, venta, feriados, umbral, anio) : null),
    [raw, venta, feriados, umbral, anio]
  )

  // ── Guardar config ──
  async function guardar() {
    setSaving(true)
    try {
      const vd = {}; for (let m = 1; m <= 12; m++) vd[m] = Number(venta[m] || 0)
      const { error } = await supabase.from('flujo_proyeccion_config')
        .upsert({ anio, umbral_minimo: Number(umbral || 0), venta_diaria: vd, global66_saldo_clp: Number(global66 || 0), updated_at: new Date().toISOString() }, { onConflict: 'anio' })
      if (error) throw error
      toast.success('Parámetros guardados')
      setReloadKey(k => k + 1)   // refresca el motor: saldo consolidado recalcula la proyección
    } catch (e) { toast.error('Error guardando: ' + (e?.message ?? '?')) } finally { setSaving(false) }
  }

  // ── Sugerir venta diaria desde ventas reales del banco ──
  async function sugerirDesdeHistorico() {
    setSugiriendo(true)
    try {
      const desde = `${anio}-01-01`, hasta = `${anio}-12-31`
      const [cmR, scR] = await Promise.all([
        supabase.from('cuentas_madre').select('id, codigo').eq('activa', true).in('codigo', VENTA_CODIGOS),
        supabase.from('subcuentas').select('id, cuenta_madre_id').eq('activa', true),
      ])
      const cmIds = new Set((cmR.data ?? []).map(c => c.id))
      const subVenta = new Set((scR.data ?? []).filter(s => cmIds.has(s.cuenta_madre_id)).map(s => s.id))
      if (subVenta.size === 0) { toast.error('No encontré subcuentas de venta'); return }
      const { data: movs, error } = await supabase.from('movimientos_bancarios')
        .select('monto, fecha, mes_nominal, subcuenta_id').eq('tipo', 'ABONO')
        .gte('fecha', desde).lte('fecha', hasta).not('subcuenta_id', 'is', null).limit(50000)
      if (error) throw error
      const ventaRealMes = new Array(13).fill(0)
      for (const mv of movs ?? []) {
        if (!subVenta.has(mv.subcuenta_id)) continue
        const m = mv.mes_nominal ?? parseInt(String(mv.fecha).split('-')[1], 10)
        if (m >= 1 && m <= 12) ventaRealMes[m] += Math.abs(Number(mv.monto) || 0)
      }
      const porDia = {}; const tasas = []
      for (let m = 1; m <= 12; m++) if (ventaRealMes[m] > 0 && habiles[m] > 0) { const t = ventaRealMes[m] / habiles[m]; porDia[m] = Math.round(t); tasas.push(t) }
      if (tasas.length === 0) { toast.error('Sin ventas clasificadas este año para sugerir'); return }
      const promDia = Math.round(tasas.reduce((s, n) => s + n, 0) / tasas.length)
      const nueva = {}; for (let m = 1; m <= 12; m++) nueva[m] = porDia[m] ?? promDia
      setVenta(nueva)
      toast.success(`Sugerido desde ${tasas.length} mes(es) reales — ajusta y guarda`)
    } catch (e) { toast.error('Error sugiriendo: ' + (e?.message ?? '?')) } finally { setSugiriendo(false) }
  }

  // ── Impuestos manual: agregar / borrar ──
  async function agregarImp() {
    const monto = parseInt(String(nuevoImp.monto).replace(/\D/g, ''), 10)
    if (!nuevoImp.fecha || !nuevoImp.concepto || !monto) { toast.error('Completa fecha, concepto y monto'); return }
    const { error } = await supabase.from('flujo_compromisos_manuales')
      .insert({ anio, fecha: nuevoImp.fecha, concepto: nuevoImp.concepto, monto, categoria: 'impuestos' })
    if (error) { toast.error('Error: ' + error.message); return }
    setNuevoImp({ fecha: '', concepto: '', monto: '' })
    setReloadKey(k => k + 1)
    toast.success('Compromiso agregado')
  }
  async function borrarImp(id) {
    const { error } = await supabase.from('flujo_compromisos_manuales').delete().eq('id', id)
    if (error) { toast.error('Error: ' + error.message); return }
    setReloadKey(k => k + 1)
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}><Loader2 size={28} className="spin" /><div style={{ marginTop: 10, fontSize: 13 }}>Cargando…</div></div>

  const btn = (extra) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, ...extra })
  const chart = (proy?.weeks ?? []).map(w => ({ name: rangoSemana(w.ini, w.fin), saldo: Math.round(w.saldo) }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#fff', padding: 12, borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', gap: 4, background: '#F3F4F6', padding: 4, borderRadius: 9 }}>
          {[{ k: 'semanal', l: 'Flujo semanal proyectado', i: <CalendarClock size={13} /> }, { k: 'parametros', l: 'Parámetros', i: <Settings2 size={13} /> }].map(t => (
            <button key={t.k} onClick={() => setSub(t.k)} style={{ ...btn(), background: sub === t.k ? '#fff' : 'transparent', color: sub === t.k ? PRIMARY : '#6B7280', boxShadow: sub === t.k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>{t.i} {t.l}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: PRIMARY }}>Año</span>
        <select value={anio} onChange={e => setAnio(Number(e.target.value))} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13, fontWeight: 600, color: '#374151' }}>
          {ANIOS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        {sub === 'parametros' && <>
          <button onClick={sugerirDesdeHistorico} disabled={sugiriendo} style={btn({ background: '#EEF2FF', color: '#4338CA' })}>{sugiriendo ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Sugerir</button>
          <button onClick={guardar} disabled={saving} style={btn({ background: PRIMARY, color: '#fff' })}>{saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Guardar</button>
        </>}
      </div>

      {/* ═══════════ FLUJO SEMANAL PROYECTADO ═══════════ */}
      {sub === 'semanal' && (
        engineLoading ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}><Loader2 size={26} className="spin" /><div style={{ marginTop: 10, fontSize: 13 }}>Calculando proyección…</div></div>
        ) : !proy || proy.weeks.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 10, padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
            {proy?.vacio === 'pasado' ? 'Año pasado — la proyección es hacia adelante desde hoy.' : 'Sin semanas en el horizonte.'}
          </div>
        ) : (
          <>
            {Object.values(venta).every(v => !v) && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#92400E' }}>
                <Info size={15} style={{ color: '#D97706', flexShrink: 0 }} />
                <span>Aún no defines la <b>venta diaria</b> — los ingresos proyectados van en $0. Ve a <b>Parámetros → Sugerir → Guardar</b> para proyectar ingresos reales.</span>
              </div>
            )}
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
              <Kpi label="Saldo hoy" value={proy.saldoHoy} color={PRIMARY} />
              <Kpi label="Saldo proy. fin de año" value={proy.saldoFin} color={proy.saldoFin < umbral ? '#DC2626' : '#15803D'} highlight />
              <Kpi label="Saldo mínimo proyectado" value={proy.minSaldo} sub={proy.minWeek ? 'sem. ' + rangoSemana(proy.minWeek.ini, proy.minWeek.fin) : ''} color={proy.minSaldo < 0 ? '#DC2626' : proy.minSaldo < umbral ? '#D97706' : '#15803D'} />
              <Kpi label="Compromisos en horizonte" value={proy.totEgr} color="#991B1B" />
            </div>

            {/* Alertas tempranas (preview E3) */}
            {(proy.quiebre || proy.cruzaUmbral) && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: proy.quiebre ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${proy.quiebre ? '#FCA5A5' : '#FCD34D'}`, borderRadius: 10, padding: '12px 14px' }}>
                <AlertTriangle size={16} style={{ color: proy.quiebre ? '#DC2626' : '#D97706', flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12.5, color: proy.quiebre ? '#991B1B' : '#92400E', lineHeight: 1.5 }}>
                  {proy.quiebre
                    ? <><b>Riesgo de quiebre de caja:</b> el saldo proyectado cae bajo $0 (mínimo {fmtCLPplano(proy.minSaldo)} en sem. {proy.minWeek && rangoSemana(proy.minWeek.ini, proy.minWeek.fin)}).</>
                    : <><b>Saldo bajo el umbral mínimo</b> ({fmtCLPplano(umbral)}): toca {fmtCLPplano(proy.minSaldo)} en sem. {proy.minWeek && rangoSemana(proy.minWeek.ini, proy.minWeek.fin)}.</>}
                  {' '}Análisis y escenarios completos en la siguiente etapa.
                </div>
              </div>
            )}

            {/* Curva de saldo proyectado */}
            <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: '16px 14px 6px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8, paddingLeft: 6 }}>Saldo proyectado semana a semana</div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chart} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gSaldo" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94A3B8' }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={fmtMM} tick={{ fontSize: 9, fill: '#94A3B8' }} width={48} />
                  <Tooltip formatter={(v) => fmtCLPplano(v)} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <ReferenceLine y={umbral} stroke="#DC2626" strokeDasharray="4 4" label={{ value: 'Umbral', fontSize: 9, fill: '#DC2626', position: 'insideTopLeft' }} />
                  <ReferenceLine y={0} stroke="#94A3B8" />
                  <Area type="monotone" dataKey="saldo" stroke={PRIMARY} strokeWidth={2} fill="url(#gSaldo)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Tabla semanal */}
            <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto', maxHeight: '60vh' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 920 }}>
                  <thead>
                    <tr>
                      <th style={{ ...TH, position: 'sticky', left: 0, zIndex: 3, minWidth: 110 }}>Semana</th>
                      <th style={{ ...TH, textAlign: 'right', color: '#15803D' }}>Ingresos</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Compras 🟢</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Remun. 🟡</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Overhead 🔵</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Créditos</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Impuestos</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Neto</th>
                      <th style={{ ...TH, textAlign: 'right', background: '#E0F2FE', color: '#0369A1' }}>Saldo proy.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proy.weeks.map((w, i) => {
                      const bajo = w.saldo < umbral, neg = w.saldo < 0
                      return (
                        <tr key={w.key} style={{ background: i === 0 ? '#EFF6FF' : 'transparent' }}>
                          <td style={{ ...TD, position: 'sticky', left: 0, background: i === 0 ? '#EFF6FF' : '#fff', fontWeight: 600 }}>{rangoSemana(w.ini, w.fin)}{i === 0 && <span style={{ fontSize: 9, color: '#1D4ED8', marginLeft: 4 }}>hoy</span>}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: w.ingreso ? '#15803D' : '#D1D5DB' }}>{fmtCLP(w.ingreso)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: w.compras ? '#991B1B' : '#D1D5DB' }}>{fmtCLP(w.compras)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: w.rem ? '#991B1B' : '#D1D5DB' }}>{fmtCLP(w.rem)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: w.overhead ? '#991B1B' : '#D1D5DB' }}>{fmtCLP(w.overhead)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: w.cred ? '#7C3AED' : '#D1D5DB' }}>{fmtCLP(w.cred)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: w.imp ? '#B45309' : '#D1D5DB' }}>{fmtCLP(w.imp)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: w.neto < 0 ? '#DC2626' : '#15803D' }}>{fmtCLP(w.neto)}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, background: neg ? '#FEE2E2' : bajo ? '#FEF3C7' : '#F0F9FF', color: neg ? '#991B1B' : bajo ? '#92400E' : '#0369A1' }}>{fmtCLPplano(w.saldo)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '8px 14px', borderTop: '1px solid #F3F4F6', fontSize: 10.5, color: '#6B7280', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>🟢 cierto (compras/créditos con fecha)</span><span>🟡 recurrente (sueldos del banco)</span><span>🔵 estimado (overhead presupuesto · ingresos)</span>
                <span style={{ color: '#92400E' }}>● bajo umbral</span><span style={{ color: '#991B1B' }}>● saldo negativo</span>
              </div>
            </div>
          </>
        )
      )}

      {/* ═══════════ PARÁMETROS ═══════════ */}
      {sub === 'parametros' && <>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '12px 14px' }}>
          <Info size={16} style={{ color: '#1D4ED8', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: '#1E3A5F', lineHeight: 1.5 }}>
            <b>Ingresos</b> = días hábiles × venta diaria (Lun–Sáb, sin domingos ni los <b>{feriados.size}</b> irrenunciables de {anio}). Las <b>remuneraciones</b> salen del patrón del banco (sueldos + Previred), <b>compras</b> de pagos pendientes, <b>créditos</b> de la amortización, <b>overhead</b> del presupuesto, e <b>impuestos</b> los cargas acá abajo.
          </div>
        </div>

        {/* Tabla editable ingresos */}
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead>
                <tr><th style={{ ...TH, position: 'sticky', left: 0, zIndex: 2, minWidth: 180 }}>Concepto</th>{MESES.map(m => <th key={m} style={{ ...TH, textAlign: 'right', minWidth: 88 }}>{m}</th>)}<th style={{ ...TH, textAlign: 'right', background: '#E0F2FE', color: '#0369A1', minWidth: 110 }}>Año</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ ...TD, position: 'sticky', left: 0, background: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><CalendarDays size={13} style={{ color: PRIMARY }} /> Venta diaria</td>
                  {MESES.map((_, i) => { const m = i + 1; return (
                    <td key={m} style={{ ...TD, padding: '4px 4px', textAlign: 'right' }}>
                      <input value={venta[m] ? String(venta[m]) : ''} onChange={e => { const v = parseInt(e.target.value.replace(/\D/g, ''), 10); setVenta(prev => ({ ...prev, [m]: isNaN(v) ? 0 : v })) }} placeholder="0" style={{ width: '100%', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, padding: '5px 6px', border: '1px solid #E5E7EB', borderRadius: 6, color: '#1E40AF', fontWeight: 600 }} />
                    </td>) })}
                  <td style={{ ...TD, textAlign: 'right', color: '#9CA3AF', background: '#F8FAFC' }}>—</td>
                </tr>
                <tr style={{ background: '#FAFAFA' }}>
                  <td style={{ ...TD, position: 'sticky', left: 0, background: '#FAFAFA', fontWeight: 600, color: '#6B7280' }}>Días hábiles</td>
                  {MESES.map((_, i) => <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#6B7280' }}>{habiles[i + 1]}</td>)}
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#374151', background: '#EFF6FF' }}>{totalHabiles}</td>
                </tr>
                <tr style={{ background: '#F0FDF4', fontWeight: 700 }}>
                  <td style={{ ...TD, position: 'sticky', left: 0, background: '#F0FDF4', color: '#166534' }}>Ingreso proyectado</td>
                  {MESES.map((_, i) => <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: ingresoMes[i + 1] ? '#15803D' : '#D1D5DB' }}>{fmtCLP(ingresoMes[i + 1])}</td>)}
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: '#15803D', background: '#DCFCE7' }}>{fmtCLP(ingresoAnio)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Saldo de partida consolidado */}
        <div style={{ background: '#fff', padding: 14, borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: PRIMARY, marginBottom: 4 }}>Saldo de partida (consolidado, real)</div>
          <div style={{ fontSize: 11.5, color: '#6B7280', marginBottom: 12 }}>Desde aquí proyecta el flujo. Santander se lee en vivo del banco; Global66 (cuenta USD) se ingresa al costo en CLP.</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' }}>Santander (en vivo)</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#15803D', fontFamily: 'monospace' }}>{fmtCLPplano(raw?.santanderReal || 0)}</div>
            </div>
            <div style={{ fontSize: 18, color: '#9CA3AF', paddingBottom: 2 }}>+</div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase' }}>Global66 (CLP al costo)</div>
              <input value={global66 ? String(global66) : ''} onChange={e => { const v = parseInt(e.target.value.replace(/\D/g, ''), 10); setGlobal66(isNaN(v) ? 0 : v) }} placeholder="0" style={{ width: 160, textAlign: 'right', fontFamily: 'monospace', fontSize: 16, fontWeight: 700, padding: '4px 8px', border: '1px solid #DDD6FE', borderRadius: 8, color: '#6D28D9' }} />
            </div>
            <div style={{ fontSize: 18, color: '#9CA3AF', paddingBottom: 2 }}>=</div>
            <div style={{ borderLeft: '2px solid #E0F2FE', paddingLeft: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#0369A1', textTransform: 'uppercase' }}>Saldo hoy consolidado</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#0369A1', fontFamily: 'monospace' }}>{fmtCLPplano((raw?.santanderReal || 0) + Number(global66 || 0))}</div>
            </div>
          </div>
          <div style={{ fontSize: 10.5, color: '#92400E', marginTop: 10 }}>Recuerda <b>Guardar</b> si cambias el saldo de Global66 — recalcula toda la proyección.</div>
        </div>

        {/* Umbral */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', padding: 14, borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B' }}>Umbral mínimo de caja</div>
          <input value={umbral ? String(umbral) : ''} onChange={e => { const v = parseInt(e.target.value.replace(/\D/g, ''), 10); setUmbral(isNaN(v) ? 0 : v) }} style={{ width: 180, textAlign: 'right', fontFamily: 'monospace', fontSize: 13, padding: '7px 10px', border: '1px solid #FCA5A5', borderRadius: 8, color: '#991B1B', fontWeight: 600 }} />
          <div style={{ fontSize: 12, color: '#6B7280' }}>{fmtCLPplano(umbral)} — saldo que dispara las alertas rojas.</div>
        </div>

        {/* Impuestos manual */}
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#B45309', marginBottom: 10 }}>Impuestos y compromisos manuales</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <input type="date" value={nuevoImp.fecha} onChange={e => setNuevoImp(p => ({ ...p, fecha: e.target.value }))} style={{ padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13 }} />
            <input placeholder="Concepto (ej. IVA junio)" value={nuevoImp.concepto} onChange={e => setNuevoImp(p => ({ ...p, concepto: e.target.value }))} style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13 }} />
            <input placeholder="Monto" value={nuevoImp.monto} onChange={e => setNuevoImp(p => ({ ...p, monto: e.target.value.replace(/\D/g, '') }))} style={{ width: 140, textAlign: 'right', fontFamily: 'monospace', padding: '7px 10px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13 }} />
            <button onClick={agregarImp} style={btn({ background: '#B45309', color: '#fff' })}><Plus size={14} /> Agregar</button>
          </div>
          {imps.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9CA3AF', padding: '8px 0' }}>Sin compromisos manuales cargados.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={{ ...TH }}>Fecha</th><th style={{ ...TH }}>Concepto</th><th style={{ ...TH, textAlign: 'right' }}>Monto</th><th style={{ ...TH }} /></tr></thead>
              <tbody>
                {imps.map(it => (
                  <tr key={it.id}>
                    <td style={{ ...TD, fontFamily: 'monospace' }}>{it.fecha}</td>
                    <td style={{ ...TD }}>{it.concepto}</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: '#991B1B' }}>{fmtCLPplano(it.monto)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}><button onClick={() => borrarImp(it.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626' }}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </>}

      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function Kpi({ label, value, color, sub, highlight }) {
  return (
    <div style={{ background: highlight ? `linear-gradient(135deg, ${color}12, ${color}22)` : '#fff', borderRadius: 10, padding: '12px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: highlight ? `1px solid ${color}33` : '1px solid transparent' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 2 }}>{fmtCLPplano(value)}</div>
      {sub && <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}
