import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Save, Sparkles, Info, CalendarDays, Settings2, CalendarClock, Plus, Trash2, TrendingDown, AlertTriangle } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Area, AreaChart } from 'recharts'
import { supabase } from '../../supabase'

const PRIMARY = '#1F4E79'
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const ANIOS = [2024, 2025, 2026, 2027]
const VENTA_CODIGOS = ['950','960','970','980']                 // GETNET, EFECTIVO, TRANSFERENCIA, TRANSBANK
const REM_CODIGOS   = ['600','610','760','761','800']           // sueldos + socios + previred
const OVERHEAD_ITEMS = new Set([                                // opex recurrente (sin MP, sin REM, sin créditos, sin impuestos)
  'MARKETING','GASTOS BANCARIOS','MOBILIARIO E INFRAESTRUCTURA','SERVICIOS EXTERNOS','ARRIENDO',
  'CUENTAS BÁSICAS','COMBUSTIBLE','GASTOS TI','OTROS GASTOS ADMIN','TRANSPORTE Y VIÁTICOS','ARTÍCULOS DE OFICINA',
])

function fmtCLP(n) {
  if (n == null || n === 0) return '—'
  const abs = Math.abs(Math.round(n))
  return (n < 0 ? '−$' : '$') + abs.toLocaleString('es-CL')
}
function fmtCLPplano(n) { return '$' + Math.round(n || 0).toLocaleString('es-CL') }
function fmtMM(n) {
  const v = (n || 0) / 1e6
  return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('es-CL', { maximumFractionDigits: 0 }) + 'M'
}

// ── Calendario TZ-safe (Chile UTC-4): NUNCA parsear ISO con new Date(str) ──
function diaSemana(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }   // 0=Dom .. 6=Sáb
function diasDelMes(y, m)   { return new Date(Date.UTC(y, m, 0)).getUTCDate() }
function isoDe(y, m, d)     { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
function diasHabilesMes(y, m, irrenunciables) {
  let n = 0
  const total = diasDelMes(y, m)
  for (let d = 1; d <= total; d++) {
    if (diaSemana(y, m, d) === 0) continue
    if (irrenunciables.has(isoDe(y, m, d))) continue
    n++
  }
  return n
}
// Semana ISO (year, week) de un timestamp UTC
function isoWeek(ts) {
  const d = new Date(ts)
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-${String(week).padStart(2, '0')}`
}
function rangoSemana(iniTs, finTs) {
  const a = new Date(iniTs), b = new Date(finTs)
  const f = dt => `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`
  return `${f(a)} – ${f(b)}`
}

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
      } catch (e) {
        toast.error('Error cargando config: ' + (e?.message ?? '?'))
      } finally { if (!cancelado) setLoading(false) }
    })()
    return () => { cancelado = true }
  }, [anio])

  // ── Cargar datos crudos del motor de egresos (pesado, refresca por reloadKey) ──
  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setEngineLoading(true)
      try {
        const hoy = new Date()
        const hoyY = hoy.getFullYear(), hoyM = hoy.getMonth() + 1, hoyD = hoy.getDate()
        const desde = `${anio}-01-01`
        const hoyISO = (anio === hoyY) ? isoDe(hoyY, hoyM, hoyD) : `${anio}-12-31`
        const mesCorte = (anio === hoyY) ? hoyM : 13   // meses < mesCorte = cerrados (para patrón rem)

        const [cmR, scR, pagosR, credR, presR, impR] = await Promise.all([
          supabase.from('cuentas_madre').select('id, codigo, tipo').eq('activa', true),
          supabase.from('subcuentas').select('id, cuenta_madre_id').eq('activa', true),
          supabase.from('pagos').select('monto_clp, monto_pagado_acum, fecha_programada, fecha_proyectada, estado, concepto, oc_id').eq('estado', 'Pendiente').limit(5000),
          supabase.from('v_creditos_amortizacion').select('fecha_cuota, cuota_mensual, ya_pagada, institucion').eq('ya_pagada', false).limit(2000),
          supabase.from('eerr_presupuestado').select('item, es_subtotal, enero, febrero, marzo, abril, mayo, junio, julio, agosto, septiembre, octubre, noviembre, diciembre').eq('anio', anio).eq('es_subtotal', false),
          supabase.from('flujo_compromisos_manuales').select('*').eq('anio', anio).order('fecha'),
        ])
        if (cancelado) return

        const codigoBySub = new Map()
        const subToMadre = new Map((scR.data ?? []).map(s => [s.id, s.cuenta_madre_id]))
        const cmCodigo = new Map((cmR.data ?? []).map(c => [c.id, c.codigo]))
        const cmTipo   = new Map((cmR.data ?? []).map(c => [c.id, c.tipo]))
        for (const [sid, cmId] of subToMadre) codigoBySub.set(sid, cmCodigo.get(cmId))

        // Movimientos YTD: saldo actual (NIC 7) + patrón de remuneraciones
        const { data: movs } = await supabase
          .from('movimientos_bancarios')
          .select('monto, tipo, fecha, mes_nominal, subcuenta_id')
          .not('origen', 'in', '(global66_sync,credito_sync)')
          .gte('fecha', desde).lte('fecha', hoyISO)
          .limit(50000)

        // Saldo inicial del año
        let saldoIni = 0
        const { data: cartolaPrev } = await supabase
          .from('cartolas').select('saldo_final, fecha_fin').lt('fecha_fin', desde)
          .order('fecha_fin', { ascending: false }).limit(1)
        if (cartolaPrev?.[0]?.saldo_final != null) saldoIni = Number(cartolaPrev[0].saldo_final) || 0

        let saldoHoy = saldoIni
        let remTotal = 0
        const remByDay = {}              // dayOfMonth -> monto (meses cerrados)
        const mesesConRem = new Set()
        for (const mv of movs ?? []) {
          const monto = Math.abs(Number(mv.monto) || 0)
          const esAbono = mv.tipo === 'ABONO'
          const cmId = mv.subcuenta_id ? subToMadre.get(mv.subcuenta_id) : null
          const tipo = cmId ? cmTipo.get(cmId) : null
          const cod  = cmId ? cmCodigo.get(cmId) : null
          if (tipo === 'traspaso') continue                         // neutro
          saldoHoy += esAbono ? monto : -monto                       // operacional + financiamiento
          // patrón remuneraciones (meses cerrados, CARGO bajo REM)
          if (!esAbono && REM_CODIGOS.includes(cod)) {
            const mes = mv.mes_nominal ?? parseInt(String(mv.fecha).split('-')[1], 10)
            const dia = parseInt(String(mv.fecha).split('-')[2], 10)
            if (mes < mesCorte) {
              remTotal += monto
              remByDay[dia] = (remByDay[dia] || 0) + monto
              mesesConRem.add(mes)
            }
          }
        }
        const remMensual = mesesConRem.size > 0 ? remTotal / mesesConRem.size : 0
        const remShareByDay = {}
        if (remTotal > 0) for (const d in remByDay) remShareByDay[d] = remByDay[d] / remTotal

        // Pagos pendientes (compromisos compras)
        const pagos = []
        for (const p of pagosR.data ?? []) {
          const monto = (Number(p.monto_clp) || 0) - (Number(p.monto_pagado_acum) || 0)
          if (monto <= 0) continue
          pagos.push({ fecha: p.fecha_programada || p.fecha_proyectada || null, monto, concepto: p.concepto, oc: p.oc_id })
        }

        // Créditos: cuotas futuras (cuota completa = capital + interés)
        const creditos = (credR.data ?? [])
          .map(c => ({ fecha: c.fecha_cuota, monto: Number(c.cuota_mensual) || 0, institucion: c.institucion }))
          .filter(c => c.fecha && c.monto > 0)

        // Overhead presupuestado por mes (suma de partidas opex)
        const COLS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
        const overheadMes = {}; for (let m = 1; m <= 12; m++) overheadMes[m] = 0
        for (const row of presR.data ?? []) {
          const nombre = String(row.item || '').trim().toUpperCase()
          if (!OVERHEAD_ITEMS.has(nombre)) continue
          for (let m = 1; m <= 12; m++) overheadMes[m] += Number(row[COLS[m - 1]] || 0)
        }

        const impuestos = (impR.data ?? []).map(r => ({ id: r.id, fecha: r.fecha, monto: Number(r.monto) || 0, concepto: r.concepto, categoria: r.categoria }))

        setImps(impuestos)
        setRaw({ saldoHoy, remMensual, remShareByDay, pagos, creditos, overheadMes, impuestos, hoyY, hoyM, hoyD })
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

  // ── Proyección semanal (E2) — recalcula al editar venta/umbral sin refetch ──
  const proy = useMemo(() => {
    if (!raw) return null
    const { saldoHoy, remMensual, remShareByDay, pagos, creditos, overheadMes, impuestos, hoyY, hoyM, hoyD } = raw
    const startUTC = (anio === hoyY) ? Date.UTC(hoyY, hoyM - 1, hoyD)
                   : (anio > hoyY ? Date.UTC(anio, 0, 1) : null)
    if (startUTC == null) return { weeks: [], saldoHoy, vacio: 'pasado' }
    const endUTC = Date.UTC(anio, 11, 31)
    if (startUTC > endUTC) return { weeks: [], saldoHoy, vacio: 'fin' }

    const weeks = new Map()
    const ensure = (key, ts) => {
      if (!weeks.has(key)) weeks.set(key, { key, ini: ts, fin: ts, ingreso: 0, compras: 0, rem: 0, overhead: 0, cred: 0, imp: 0 })
      const w = weeks.get(key); if (ts < w.ini) w.ini = ts; if (ts > w.fin) w.fin = ts
      return w
    }
    const firstKey = isoWeek(startUTC)

    // Day-loop: ingresos + overhead + remuneraciones
    for (let ts = startUTC; ts <= endUTC; ts += 86400000) {
      const dt = new Date(ts)
      const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate()
      const w = ensure(isoWeek(ts), ts)
      const esDom = dt.getUTCDay() === 0
      const esFer = feriados.has(isoDe(y, m, d))
      if (!esDom && !esFer) w.ingreso += (venta[m] || 0)
      w.overhead += (overheadMes[m] || 0) / diasDelMes(y, m)
      w.rem += remMensual * (remShareByDay[d] || 0)
    }

    // Eventos discretos (vencidos → primera semana)
    const addEvento = (fechaISO, monto, campo) => {
      if (!monto) return
      let key = firstKey
      if (fechaISO) {
        const [yy, mm, dd] = String(fechaISO).split('-').map(Number)
        const ts = Date.UTC(yy, mm - 1, dd)
        if (ts > endUTC) return                 // fuera de horizonte (próximo año)
        key = (ts < startUTC) ? firstKey : isoWeek(ts)
      }
      const w = weeks.get(key) || ensure(key, startUTC)
      w[campo] += monto
    }
    pagos.forEach(p => addEvento(p.fecha, p.monto, 'compras'))
    creditos.forEach(c => addEvento(c.fecha, c.monto, 'cred'))
    impuestos.forEach(i => addEvento(i.fecha, i.monto, 'imp'))

    // Ordenar + saldo rodante
    const arr = Array.from(weeks.values()).sort((a, b) => a.ini - b.ini)
    let saldo = saldoHoy
    let minSaldo = Infinity, minWeek = null
    let totEgr = 0, totIng = 0, cruzaUmbral = false, quiebre = false
    for (const w of arr) {
      w.egresos = w.compras + w.rem + w.overhead + w.cred + w.imp
      w.neto = w.ingreso - w.egresos
      saldo += w.neto
      w.saldo = saldo
      totEgr += w.egresos; totIng += w.ingreso
      if (saldo < minSaldo) { minSaldo = saldo; minWeek = w }
      if (saldo < umbral) cruzaUmbral = true
      if (saldo < 0) quiebre = true
    }
    return { weeks: arr, saldoHoy, saldoFin: saldo, minSaldo, minWeek, totEgr, totIng, cruzaUmbral, quiebre }
  }, [raw, venta, feriados, umbral, anio])

  // ── Guardar config ──
  async function guardar() {
    setSaving(true)
    try {
      const vd = {}; for (let m = 1; m <= 12; m++) vd[m] = Number(venta[m] || 0)
      const { error } = await supabase.from('flujo_proyeccion_config')
        .upsert({ anio, umbral_minimo: Number(umbral || 0), venta_diaria: vd, updated_at: new Date().toISOString() }, { onConflict: 'anio' })
      if (error) throw error
      toast.success('Parámetros guardados')
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
