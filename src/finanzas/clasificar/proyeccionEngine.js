import { supabase } from '../../supabase'

/* ═══ MOTOR DE PROYECCIÓN DE CAJA ═══
   Lógica única compartida por ProyeccionCompromisosTab (operacional) y
   AnalisisRiesgoTab (escenarios + riesgo). NO duplicar este cálculo en
   componentes — siempre importar desde acá. */

export const VENTA_CODIGOS = ['950', '960', '970', '980']            // GETNET, EFECTIVO, TRANSFERENCIA, TRANSBANK
export const REM_CODIGOS   = ['600', '610', '760', '761', '800']     // sueldos + socios + previred
export const OVERHEAD_ITEMS = new Set([
  'MARKETING', 'GASTOS BANCARIOS', 'MOBILIARIO E INFRAESTRUCTURA', 'SERVICIOS EXTERNOS', 'ARRIENDO',
  'CUENTAS BÁSICAS', 'COMBUSTIBLE', 'GASTOS TI', 'OTROS GASTOS ADMIN', 'TRANSPORTE Y VIÁTICOS', 'ARTÍCULOS DE OFICINA',
])

export function fmtCLP(n) {
  if (n == null || n === 0) return '—'
  const abs = Math.abs(Math.round(n))
  return (n < 0 ? '−$' : '$') + abs.toLocaleString('es-CL')
}
export function fmtCLPplano(n) { return '$' + Math.round(n || 0).toLocaleString('es-CL') }
export function fmtMM(n) {
  const v = (n || 0) / 1e6
  return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('es-CL', { maximumFractionDigits: 0 }) + 'M'
}

// ── Calendario TZ-safe (Chile UTC-4): NUNCA parsear ISO con new Date(str) ──
export function diaSemana(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }   // 0=Dom .. 6=Sáb
export function diasDelMes(y, m)   { return new Date(Date.UTC(y, m, 0)).getUTCDate() }
export function isoDe(y, m, d)     { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
export function diasHabilesMes(y, m, irrenunciables) {
  let n = 0
  const total = diasDelMes(y, m)
  for (let d = 1; d <= total; d++) {
    if (diaSemana(y, m, d) === 0) continue
    if (irrenunciables.has(isoDe(y, m, d))) continue
    n++
  }
  return n
}
export function isoWeek(ts) {
  const d = new Date(ts)
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-${String(week).padStart(2, '0')}`
}
export function rangoSemana(iniTs, finTs) {
  const a = new Date(iniTs), b = new Date(finTs)
  const f = dt => `${dt.getUTCDate()}/${dt.getUTCMonth() + 1}`
  return `${f(a)} – ${f(b)}`
}

const CAT_LABEL = { compras: 'Compras', rem: 'Remuneraciones', overhead: 'Overhead', cred: 'Créditos', imp: 'Impuestos' }

// ── Carga de datos crudos (pesado). Devuelve raw para construirProyeccion. ──
export async function cargarDatosProyeccion(anio) {
  const hoy = new Date()
  const hoyY = hoy.getFullYear(), hoyM = hoy.getMonth() + 1, hoyD = hoy.getDate()
  const desde = `${anio}-01-01`
  const hoyISO = (anio === hoyY) ? isoDe(hoyY, hoyM, hoyD) : `${anio}-12-31`
  const mesCorte = (anio === hoyY) ? hoyM : 13   // meses < mesCorte = cerrados (patrón rem)

  const [cmR, scR, pagosR, credR, presR, impR] = await Promise.all([
    supabase.from('cuentas_madre').select('id, codigo, tipo').eq('activa', true),
    supabase.from('subcuentas').select('id, cuenta_madre_id').eq('activa', true),
    supabase.from('pagos').select('monto_clp, monto_pagado_acum, fecha_programada, fecha_proyectada, estado, concepto, oc_id').eq('estado', 'Pendiente').limit(5000),
    supabase.from('v_creditos_amortizacion').select('fecha_cuota, cuota_mensual, ya_pagada, institucion').eq('ya_pagada', false).limit(2000),
    supabase.from('eerr_presupuestado').select('item, es_subtotal, enero, febrero, marzo, abril, mayo, junio, julio, agosto, septiembre, octubre, noviembre, diciembre').eq('anio', anio).eq('es_subtotal', false),
    supabase.from('flujo_compromisos_manuales').select('*').eq('anio', anio).order('fecha'),
  ])

  const subToMadre = new Map((scR.data ?? []).map(s => [s.id, s.cuenta_madre_id]))
  const cmCodigo = new Map((cmR.data ?? []).map(c => [c.id, c.codigo]))
  const cmTipo   = new Map((cmR.data ?? []).map(c => [c.id, c.tipo]))

  const { data: movs } = await supabase
    .from('movimientos_bancarios')
    .select('monto, tipo, fecha, mes_nominal, subcuenta_id')
    .not('origen', 'in', '(global66_sync,credito_sync)')
    .gte('fecha', desde).lte('fecha', hoyISO)
    .limit(50000)

  // ── SALDO REAL CONSOLIDADO (ya NO reconstruido con NIC-7) ──
  // Santander: saldo_final de la cartola más reciente que cargaste (cierre oficial del banco).
  //   Robusto: 'fecha' de los movimientos es solo día (sin hora) y los saldos brincan dentro del
  //   mismo día, así que NO se puede tomar el "último movimiento". El cierre del banco sí es exacto.
  // Global66: saldo real en CLP al costo, manual (cuenta USD; no se reconstruye acá).
  let santanderReal = 0
  const { data: ultCartola } = await supabase
    .from('cartolas').select('saldo_final, fecha_fin, created_at')
    .not('saldo_final', 'is', null).order('created_at', { ascending: false }).limit(1)
  if (ultCartola?.[0]?.saldo_final != null) santanderReal = Number(ultCartola[0].saldo_final) || 0

  let global66Real = 0
  const { data: cfgSaldo } = await supabase
    .from('flujo_proyeccion_config').select('global66_saldo_clp').eq('anio', anio).maybeSingle()
  if (cfgSaldo?.global66_saldo_clp != null) global66Real = Number(cfgSaldo.global66_saldo_clp) || 0

  let saldoHoy = santanderReal + global66Real
  let remTotal = 0
  const remByDay = {}
  const mesesConRem = new Set()
  const realMensual = {}; for (let m = 1; m <= 12; m++) realMensual[m] = { ingreso: 0, egreso: 0 }
  for (const mv of movs ?? []) {
    const monto = Math.abs(Number(mv.monto) || 0)
    const esAbono = mv.tipo === 'ABONO'
    const cmId = mv.subcuenta_id ? subToMadre.get(mv.subcuenta_id) : null
    const tipo = cmId ? cmTipo.get(cmId) : null
    const cod  = cmId ? cmCodigo.get(cmId) : null
    if (tipo === 'traspaso') continue
    const mesMv = mv.mes_nominal ?? parseInt(String(mv.fecha).split('-')[1], 10)
    if (mesMv >= 1 && mesMv <= 12) {
      if (esAbono) realMensual[mesMv].ingreso += monto
      else realMensual[mesMv].egreso += monto
    }
    if (!esAbono && REM_CODIGOS.includes(cod)) {
      const mes = mesMv
      const dia = parseInt(String(mv.fecha).split('-')[2], 10)
      if (mes < mesCorte) { remTotal += monto; remByDay[dia] = (remByDay[dia] || 0) + monto; mesesConRem.add(mes) }
    }
  }
  const remMensual = mesesConRem.size > 0 ? remTotal / mesesConRem.size : 0
  const remShareByDay = {}
  if (remTotal > 0) for (const d in remByDay) remShareByDay[d] = remByDay[d] / remTotal

  const pagos = []
  for (const p of pagosR.data ?? []) {
    const monto = (Number(p.monto_clp) || 0) - (Number(p.monto_pagado_acum) || 0)
    if (monto <= 0) continue
    pagos.push({ fecha: p.fecha_programada || p.fecha_proyectada || null, monto, concepto: p.concepto || 'Pago compras', oc: p.oc_id })
  }

  const creditos = (credR.data ?? [])
    .map(c => ({ fecha: c.fecha_cuota, monto: Number(c.cuota_mensual) || 0, concepto: 'Cuota ' + (c.institucion || 'crédito') }))
    .filter(c => c.fecha && c.monto > 0)

  const COLS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const overheadMes = {}; for (let m = 1; m <= 12; m++) overheadMes[m] = 0
  for (const row of presR.data ?? []) {
    const nombre = String(row.item || '').trim().toUpperCase()
    if (!OVERHEAD_ITEMS.has(nombre)) continue
    for (let m = 1; m <= 12; m++) overheadMes[m] += Number(row[COLS[m - 1]] || 0)
  }

  const impuestos = (impR.data ?? []).map(r => ({ id: r.id, fecha: r.fecha, monto: Number(r.monto) || 0, concepto: r.concepto, categoria: r.categoria }))

  return { saldoHoy, santanderReal, global66Real, remMensual, remShareByDay, pagos, creditos, overheadMes, impuestos, realMensual, mesCorte, hoyY, hoyM, hoyD }
}

// ── Proyección MENSUAL del año completo (para comparar Real vs Proyectado) ──
// Agrega los mismos componentes del motor por mes calendario (sin corte "hoy").
export function proyectarMensual(raw, venta, feriados, anio) {
  if (!raw) return {}
  const { remMensual, overheadMes, pagos, creditos, impuestos, hoyM } = raw
  const out = {}
  for (let m = 1; m <= 12; m++) {
    out[m] = {
      ingreso: diasHabilesMes(anio, m, feriados) * (venta[m] || 0),
      rem: remMensual,
      overhead: overheadMes[m] || 0,
      compras: 0, cred: 0, imp: 0,
    }
  }
  const mesDe = (fechaISO) => {
    if (!fechaISO) return hoyM
    const mm = parseInt(String(fechaISO).split('-')[1], 10)
    return (mm >= 1 && mm <= 12) ? mm : hoyM
  }
  pagos.forEach(p => { out[mesDe(p.fecha)].compras += p.monto })
  creditos.forEach(c => { const mm = mesDe(c.fecha); if (out[mm]) out[mm].cred += c.monto })
  impuestos.forEach(i => { const mm = mesDe(i.fecha); if (out[mm]) out[mm].imp += i.monto })
  for (let m = 1; m <= 12; m++) out[m].egreso = out[m].rem + out[m].overhead + out[m].compras + out[m].cred + out[m].imp
  return out
}

// ── Construye proyección semanal. opts.ventaMult escala los ingresos (escenarios). ──
export function construirProyeccion(raw, venta, feriados, umbral, anio, opts = {}) {
  const ventaMult = opts.ventaMult ?? 1
  if (!raw) return null
  const { saldoHoy, remMensual, remShareByDay, pagos, creditos, overheadMes, impuestos, hoyY, hoyM, hoyD } = raw
  const startUTC = (anio === hoyY) ? Date.UTC(hoyY, hoyM - 1, hoyD)
                 : (anio > hoyY ? Date.UTC(anio, 0, 1) : null)
  if (startUTC == null) return { weeks: [], eventos: [], saldoHoy, vacio: 'pasado' }
  const endUTC = Date.UTC(anio, 11, 31)
  if (startUTC > endUTC) return { weeks: [], eventos: [], saldoHoy, vacio: 'fin' }

  const weeks = new Map()
  const ensure = (key, ts) => {
    if (!weeks.has(key)) weeks.set(key, { key, ini: ts, fin: ts, ingreso: 0, compras: 0, rem: 0, overhead: 0, cred: 0, imp: 0 })
    const w = weeks.get(key); if (ts < w.ini) w.ini = ts; if (ts > w.fin) w.fin = ts
    return w
  }
  const firstKey = isoWeek(startUTC)

  for (let ts = startUTC; ts <= endUTC; ts += 86400000) {
    const dt = new Date(ts)
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate()
    const w = ensure(isoWeek(ts), ts)
    const esDom = dt.getUTCDay() === 0
    const esFer = feriados.has(isoDe(y, m, d))
    if (!esDom && !esFer) w.ingreso += (venta[m] || 0) * ventaMult
    w.overhead += (overheadMes[m] || 0) / diasDelMes(y, m)
    w.rem += remMensual * (remShareByDay[d] || 0)
  }

  const eventos = []
  const addEvento = (fechaISO, monto, campo, concepto) => {
    if (!monto) return
    let key = firstKey, vencido = false
    if (fechaISO) {
      const [yy, mm, dd] = String(fechaISO).split('-').map(Number)
      const ts = Date.UTC(yy, mm - 1, dd)
      if (ts > endUTC) return
      vencido = ts < startUTC
      key = vencido ? firstKey : isoWeek(ts)
    }
    const w = weeks.get(key) || ensure(key, startUTC)
    w[campo] += monto
    eventos.push({ fecha: fechaISO, monto, tipo: campo, label: CAT_LABEL[campo], concepto, vencido })
  }
  pagos.forEach(p => addEvento(p.fecha, p.monto, 'compras', p.concepto))
  creditos.forEach(c => addEvento(c.fecha, c.monto, 'cred', c.concepto))
  impuestos.forEach(i => addEvento(i.fecha, i.monto, 'imp', i.concepto))

  const arr = Array.from(weeks.values()).sort((a, b) => a.ini - b.ini)
  let saldo = saldoHoy
  let minSaldo = Infinity, minWeek = null
  let totEgr = 0, totIng = 0, cruzaUmbral = false, quiebre = false
  let semQuiebre = null, semUmbral = null, picoSemana = null
  const totCat = { compras: 0, rem: 0, overhead: 0, cred: 0, imp: 0, ingreso: 0 }
  arr.forEach((w, i) => {
    w.egresos = w.compras + w.rem + w.overhead + w.cred + w.imp
    w.neto = w.ingreso - w.egresos
    saldo += w.neto
    w.saldo = saldo
    totEgr += w.egresos; totIng += w.ingreso
    totCat.compras += w.compras; totCat.rem += w.rem; totCat.overhead += w.overhead
    totCat.cred += w.cred; totCat.imp += w.imp; totCat.ingreso += w.ingreso
    if (saldo < minSaldo) { minSaldo = saldo; minWeek = w }
    if (saldo < umbral && semUmbral == null) semUmbral = i + 1
    if (saldo < 0 && semQuiebre == null) semQuiebre = i + 1
    if (saldo < umbral) cruzaUmbral = true
    if (saldo < 0) quiebre = true
    if (!picoSemana || w.egresos > picoSemana.egresos) picoSemana = w
  })
  const cobertura = totEgr > 0 ? totIng / totEgr : null

  return {
    weeks: arr, eventos, saldoHoy, saldoFin: saldo, minSaldo, minWeek,
    totEgr, totIng, totCat, cobertura, cruzaUmbral, quiebre, semQuiebre, semUmbral, picoSemana,
  }
}

// ── Análisis de riesgo sobre una proyección ──
export function analizarRiesgos(proy, umbral) {
  if (!proy || proy.weeks.length === 0) return []
  const a = []
  const semTxt = w => w ? rangoSemana(w.ini, w.fin) : '—'
  if (proy.quiebre) {
    a.push({ nivel: 'alto', titulo: 'Riesgo de quiebre de caja', texto: `El saldo proyectado cae bajo $0 — mínimo ${fmtCLPplano(proy.minSaldo)} en sem. ${semTxt(proy.minWeek)}.` })
    a.push({ nivel: 'alto', titulo: 'Runway corto', texto: `${proy.semQuiebre} semana(s) de autonomía antes de quedar en negativo.` })
  } else if (proy.cruzaUmbral) {
    a.push({ nivel: 'medio', titulo: 'Saldo bajo el umbral mínimo', texto: `Toca ${fmtCLPplano(proy.minSaldo)} (umbral ${fmtCLPplano(umbral)}) en sem. ${semTxt(proy.minWeek)}.` })
  } else {
    a.push({ nivel: 'ok', titulo: 'Caja saludable en el horizonte', texto: `El saldo mínimo (${fmtCLPplano(proy.minSaldo)}) se mantiene sobre el umbral.` })
  }
  if (proy.cobertura != null && proy.cobertura < 1) {
    a.push({ nivel: 'alto', titulo: 'Ingresos no cubren egresos', texto: `Cobertura ${Math.round(proy.cobertura * 100)}% en el horizonte — entran ${fmtCLPplano(proy.totIng)} vs ${fmtCLPplano(proy.totEgr)} de salidas.` })
  }
  const promEgr = proy.weeks.length ? proy.totEgr / proy.weeks.length : 0
  if (proy.picoSemana && promEgr > 0 && proy.picoSemana.egresos > promEgr * 1.8) {
    a.push({ nivel: 'medio', titulo: 'Pico de pagos concentrado', texto: `${fmtCLPplano(proy.picoSemana.egresos)} en una sola semana (${semTxt(proy.picoSemana)}), ~${(proy.picoSemana.egresos / promEgr).toFixed(1)}× el promedio.` })
  }
  return a
}
