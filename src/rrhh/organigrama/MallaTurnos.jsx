// src/rrhh/organigrama/MallaTurnos.jsx  (v2 — 21-oct-2026)
// Malla de turnos y cobertura por rol — Personas › Estructura
//
// Se lee de arriba hacia abajo: conclusión → dónde → qué día → quién → plantilla.
//   1. Lectura de la semana: estado general y hallazgos en lenguaje simple, cada uno
//      con qué hacer, más 4 indicadores de salud de la malla.
//   2. Semana de un vistazo: semáforo día × media hora (rojo crítico, ámbar frágil,
//      verde cubierto) con la cantidad de personas presentes.
//   3. Día elegido: carriles por rol (cuántos hay de cada rol cada media hora y si
//      alcanza), los problemas del día agrupados con su acción sugerida y la malla de
//      turnos con las franjas débiles marcadas.
//   4. Carga de las personas: horas extra reales (4 semanas) con nivel y motivo.
//   5. Plantilla turno × rol, mínimos de cobertura y detalle por persona.
// Datos: fn_org_malla (turno publicado en Workera o proyectado desde hace 2 semanas),
// fn_org_carga (marcas reales), org_cobertura_minima, org_roles. La cobertura que se
// evalúa es la real: descuenta colaciones (hora habitual de cada persona) y ausencias.
// v2: reemplaza la curva apilada (ilegible con muchos roles) por carriles por rol,
// el mapa de cantidad por un semáforo y la lista de debilidades por problemas
// agrupados con acción sugerida; quita los interruptores de colación y disponibles.

import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react'
import { supabase } from '../../supabase'
import { DataGrid } from '../../finanzas/conciliacion/DataGrid'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const DIAS_L = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const SLOT = 30
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const hoyISO = () => isoLocal(new Date())
const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoLocal(d) }
const lunesDe = iso => { const d = new Date(`${iso}T12:00:00`); return sumarDias(iso, -((d.getDay() + 6) % 7)) }
const aMin = t => { if (!t) return null; const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m) }
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`
const fDia = iso => { const [, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}` }
const fRango = (a, b) => {
  const [, ma, da] = a.split('-'), [, mb, db] = b.split('-')
  return ma === mb ? `${Number(da)} al ${Number(db)} de ${MESES[Number(mb)-1]}` : `${Number(da)} de ${MESES[Number(ma)-1]} al ${Number(db)} de ${MESES[Number(mb)-1]}`
}
const diaTipo = idx => idx < 5 ? 'lv' : idx === 5 ? 'sab' : 'dom'
const DIA_TIPO_L = { lv:'Lunes a viernes', sab:'Sábado', dom:'Domingo' }
const n1 = v => Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',')
const horasDe = min => n1(Math.round((min || 0) / 6) / 10)
const diasTexto = idxs => {
  const s = [...new Set(idxs)].sort((a, b) => a - b), k = s.join(',')
  if (k === '0,1,2,3,4') return 'L-V'
  if (k === '0,1,2,3,4,5') return 'L-S'
  if (k === '0,1,2,3') return 'L-J'
  return s.map(i => DIAS[i]).join(', ')
}
const diasLargo = idxs => {
  const s = [...new Set(idxs)].sort((a, b) => a - b), k = s.join(',')
  if (k === '0,1,2,3,4') return 'De lunes a viernes'
  if (k === '0,1,2,3,4,5') return 'De lunes a sábado'
  if (k === '0,1,2,3') return 'De lunes a jueves'
  const n = s.map(i => DIAS_L[i])
  const t = n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const momento = x => x < 11 * 60 ? 'apertura' : x < 15 * 60 ? 'mediodía' : x < 18 * 60 ? 'tarde' : 'cierre'
const momentos = rs => rs.some(([x, y]) => y - x >= 300) ? 'casi toda la jornada' : [...new Set(rs.map(r => momento(r[0])))].join(' y ')
const rangosTxt = rs => rs.map(([x, y]) => `${hhmm(x)}–${hhmm(y)}`).join(', ')
const listaNat = arr => arr.length <= 1 ? (arr[0] || '') : `${arr.slice(0, -1).join(', ')} y ${arr[arr.length - 1]}`
const capital = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t

const FAM = { comercial:'Comercial', operaciones:'Bodega', administracion:'Administración', marketing:'Marketing', direccion:'Dirección', externo:'Externos' }
const ROL_COLOR = {
  jefe_tienda:'#0B3D91', coord_ventas:'#1F5FBF', vendedor:'#4C8DF0', caja:'#0E9FB5', postventa:'#7A5AF8', ejecutivo_comercial:'#9BB5EE',
  jefe_bodega:'#7A2E0E', coord_bodega:'#B54708', coord_picking:'#DC6803', gruero:'#F79009', bodeguero:'#E8B03A', picker:'#C4834A',
  transporte:'#93633D', mantencion:'#98A2B3', asist_admin:'#12B76A', compras:'#4BB58A', marketing:'#C11574', gerencia:'#6941C6',
  jefatura_area:'#9E77ED', directorio:'#667085', externo:'#98A2B3', _sincargo:'#98A2B3',
}
const colorRol = k => ROL_COLOR[k] || '#98A2B3'
const NOVEDAD = { licencia_medica:'Licencia médica', vacaciones:'Vacaciones', permiso_con_goce:'Permiso', permiso_sin_goce:'Permiso sin goce', otro:'Novedad' }
const ORDEN_SUC = ['suc-lg', 'suc-maipu', 'suc-la', 'suc-mp', 'suc-admin']
const ROLES_BASE = ['vendedor', 'caja', 'bodeguero', 'gruero']   // propuesta de mínimos (se ajusta en pantalla)
// Semáforo: rojo crítico · ámbar frágil · verde cubierto · gris sin operación
const EST = {
  alta:  { l:'Crítico',  bg:'#F04438', fg:'#FFFFFF', suave:'#FEE4E2', c:'#B42318' },
  media: { l:'Frágil',   bg:'#FDB022', fg:'#4A2A00', suave:'#FEF0C7', c:'#B54708' },
  baja:  { l:'Sin respaldo', bg:'#FDF3A7', fg:'#713B12', suave:'#FEFBE8', c:'#A15C07' },
  ok:    { l:'Cubierto', bg:'#A6EFC2', fg:'#05603A', suave:'#ECFDF3', c:'#067647' },
}
const RANGO_SEV = { alta: 3, media: 2, baja: 1 }

// Tramos consecutivos de slots que cumplen la condición → [[desde, hasta]] en minutos
function tramos(slots, cumple) {
  const out = []; let ini = null
  slots.forEach((s, i) => {
    if (cumple(s, i)) { if (ini === null) ini = s }
    else if (ini !== null) { out.push([ini, s]); ini = null }
  })
  if (ini !== null) out.push([ini, slots[slots.length - 1] + SLOT])
  return out
}

// Cobertura por día y franja: total, por rol, quién está y jefaturas por familia
function calcCobertura(turnos, fechas, slots, { colacion, disponibles }) {
  const porFecha = {}
  for (const f of turnos) (porFecha[f.fecha] = porFecha[f.fecha] || []).push(f)
  return fechas.map(fe => slots.map(t => {
    const m = t + SLOT / 2
    const c = { total: 0, porRol: {}, quien: {}, jefFam: {} }
    for (const f of porFecha[fe] || []) {
      if (!(f._e <= m && m < f._s)) continue
      if (disponibles && f.novedad) continue
      if (colacion && f._ci != null && m >= f._ci && m < f._ci + f.colacion_min) continue
      const r = f.rol_codigo || '_sincargo'
      c.total++; c.porRol[r] = (c.porRol[r] || 0) + 1
      ;(c.quien[r] = c.quien[r] || []).push(f.cod_contaline)
      if (f.es_jefatura && f.familia) c.jefFam[f.familia] = (c.jefFam[f.familia] || 0) + 1
    }
    return c
  }))
}

// Junta los problemas crudos (día × tramo) en ítems legibles: mismo problema y mismos
// días → una sola línea con todos sus horarios; horas = tiempo afectado en la semana.
function consolidar(crudo) {
  const a = {}
  for (const c of crudo) {
    const key = `${c.k}|${c.x}|${c.y}`
    const o = a[key] || (a[key] = { ...c, dias: new Set() })
    o.dias.add(c.d); if (c.tipo === 'min') o.hay = Math.min(o.hay, c.hay)
  }
  const b = {}
  for (const o of Object.values(a)) {
    const dias = [...o.dias].sort((p, q) => p - q), key = `${o.k}|${dias.join(',')}`
    const it = b[key] || (b[key] = { sev: o.sev, tipo: o.tipo, k: o.k, rol: o.rol, fam: o.fam, n: o.n, req: o.req, hay: o.hay, dias, rangos: [] })
    it.rangos.push([o.x, o.y]); if (o.tipo === 'min') it.hay = Math.min(it.hay, o.hay)
  }
  const peso = { alta: 0, media: 1, baja: 2 }
  return Object.values(b)
    .map(it => ({ ...it, rangos: it.rangos.sort((p, q) => p[0] - q[0]), horas: it.rangos.reduce((s, [x, y]) => s + (y - x), 0) * it.dias.length / 60 }))
    .sort((p, q) => peso[p.sev] - peso[q.sev] || q.horas - p.horas)
}

export function MallaTurnos({ cu }) {
  const [sucs, setSucs]           = useState([])
  const [roles, setRoles]         = useState([])
  const [suc, setSuc]             = useState(() => { try { return localStorage.getItem('malla_suc') || 'suc-lg' } catch { return 'suc-lg' } })
  const [lunes, setLunes]         = useState(() => lunesDe(hoyISO()))
  const [familia, setFamilia]     = useState('todas')
  const [diaSel, setDiaSel]       = useState(() => Math.min(5, (new Date().getDay() + 6) % 7))
  const [filas, setFilas]         = useState([])
  const [carga, setCarga]         = useState({})
  const [minimos, setMinimos]     = useState([])
  const [jornadaLegal, setJornada] = useState(42)
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [cargando, setCargando]   = useState(true)
  const [err, setErr]             = useState(null)
  const [abierto, setAbierto]     = useState({ plantilla: true, minimos: false, detalle: false })
  const alternar = k => setAbierto(a => ({ ...a, [k]: !a[k] }))
  const [pop, setPop]             = useState(null)   // ventana emergente: quiénes están detrás de un número
  useEffect(() => { setPop(null) }, [suc, lunes, familia])

  useEffect(() => { try { localStorage.setItem('malla_suc', suc) } catch { /* sin storage */ } }, [suc])

  // Datos que no dependen de la semana
  useEffect(() => {
    let cancel = false
    const hoy = hoyISO()
    Promise.all([
      supabase.from('sucursales').select('id,nombre,orden').order('orden'),
      supabase.from('org_roles').select('*').eq('activo', true).order('orden'),
      supabase.from('rrhh_jornada_legal').select('vigente_desde,horas_semanales').lte('vigente_desde', hoy).order('vigente_desde', { ascending: false }).limit(1),
      supabase.rpc('fn_rrhh_es_gestor'),
      supabase.rpc('fn_org_carga', { p_desde: sumarDias(hoy, -28), p_hasta: sumarDias(hoy, -1) }),
    ]).then(([s, r, j, g, c]) => {
      if (cancel) return
      setSucs(s.data || []); setRoles(r.data || [])
      if (j.data?.[0]?.horas_semanales) setJornada(Number(j.data[0].horas_semanales))
      setPuedeEditar(g?.data === true)
      if (!c.error) setCarga(Object.fromEntries((c.data || []).map(x => [x.cod_contaline, x])))
    }, () => {})
    return () => { cancel = true }
  }, [])

  const cargarSemana = useCallback(async () => {
    setCargando(true); setErr(null)
    try {
      const [m, mn] = await Promise.all([
        supabase.rpc('fn_org_malla', { p_desde: lunes, p_hasta: sumarDias(lunes, 6) }),
        supabase.from('org_cobertura_minima').select('*').eq('activo', true),
      ])
      if (m.error) throw m.error
      setFilas(m.data || []); setMinimos(mn.error ? [] : (mn.data || []))
    } catch (e) { setErr(e.message) }
    finally { setCargando(false) }
  }, [lunes])
  useEffect(() => { cargarSemana() }, [cargarSemana])

  // ── Derivados ──
  const fechas    = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)), [lunes])
  const rolPorCod = useMemo(() => Object.fromEntries(roles.map(r => [r.codigo, r])), [roles])
  const sucNombre = useCallback(id => sucs.find(s => s.id === id)?.nombre || id, [sucs])
  const nombreSucPop = sucNombre(suc)
  const rolNombre = useCallback(k => k === '_sincargo' ? 'Sin cargo' : (rolPorCod[k]?.nombre || k), [rolPorCod])
  const ordenRol  = useCallback(k => k === '_sincargo' ? 999 : (rolPorCod[k]?.orden ?? 500), [rolPorCod])

  const sucsConGente = useMemo(() => {
    const ids = new Set(filas.filter(f => f.entrada).map(f => f.sucursal_id))
    ids.add(suc)
    const ord = id => { const i = ORDEN_SUC.indexOf(id); return i < 0 ? 50 : i }
    return [...ids].filter(Boolean).sort((a, b) => ord(a) - ord(b) || String(a).localeCompare(String(b)))
  }, [filas, suc])

  const delSuc = useMemo(() => filas.filter(f => f.sucursal_id === suc && (familia === 'todas' || f.familia === familia)), [filas, suc, familia])
  const turnos = useMemo(() => delSuc.filter(f => f.entrada && f.salida).map(f => ({
    ...f, _e: aMin(f.entrada), _s: aMin(f.salida),
    _ci: f.colacion_min > 0 && f.colacion_inicio ? aMin(f.colacion_inicio) : null,
  })), [delSuc])
  const familiasSuc = useMemo(() => [...new Set(filas.filter(f => f.sucursal_id === suc && f.familia).map(f => f.familia))], [filas, suc])

  const { t0, t1, slots } = useMemo(() => {
    let a = Infinity, b = -Infinity
    for (const f of turnos) { a = Math.min(a, f._e); b = Math.max(b, f._s) }
    if (!Number.isFinite(a)) { a = 8 * 60; b = 21 * 60 }
    a = Math.floor(a / SLOT) * SLOT; b = Math.ceil(b / SLOT) * SLOT
    const s = []; for (let t = a; t < b; t += SLOT) s.push(t)
    // la malla del día usa horas completas para sus líneas guía
    return { t0: Math.floor(a / 60) * 60, t1: Math.ceil(b / 60) * 60, slots: s }
  }, [turnos])

  const covReal   = useMemo(() => calcCobertura(turnos, fechas, slots, { colacion: true,  disponibles: true }),  [turnos, fechas, slots])
  const covSinCol = useMemo(() => calcCobertura(turnos, fechas, slots, { colacion: false, disponibles: true }),  [turnos, fechas, slots])
  const covPlan   = useMemo(() => calcCobertura(turnos, fechas, slots, { colacion: false, disponibles: false }), [turnos, fechas, slots])

  const rolesSuc = useMemo(() => [...new Set(turnos.map(f => f.rol_codigo || '_sincargo'))].sort((a, b) => ordenRol(a) - ordenRol(b)), [turnos, ordenRol])
  const diasConTurno = useMemo(() => fechas.map(fe => turnos.some(f => f.fecha === fe)), [fechas, turnos])

  const ventanaDia = useMemo(() => fechas.map(fe => {
    const w = {}
    for (const f of turnos) if (f.fecha === fe && f.familia) {
      const x = w[f.familia] || (w[f.familia] = [Infinity, -Infinity])
      x[0] = Math.min(x[0], f._e); x[1] = Math.max(x[1], f._s)
    }
    return w
  }), [fechas, turnos])
  const ventanaTotal = useMemo(() => fechas.map(fe => {
    let a = Infinity, b = -Infinity
    for (const f of turnos) if (f.fecha === fe) { a = Math.min(a, f._e); b = Math.max(b, f._s) }
    return Number.isFinite(a) ? [a, b] : null
  }), [fechas, turnos])

  const minsSuc = useMemo(() => minimos.filter(m => m.sucursal_id === suc && (familia === 'todas' || rolPorCod[m.rol_codigo]?.familia === familia)), [minimos, suc, familia, rolPorCod])
  const requerido = useCallback((d, s, rol) => {
    let v = 0
    for (const mn of minsSuc) if (mn.rol_codigo === rol && mn.dia_tipo === diaTipo(d) && s >= aMin(mn.hora_desde) && s < aMin(mn.hora_hasta)) v = Math.max(v, mn.minimo)
    return v
  }, [minsSuc])

  // ── Problemas crudos: un registro por día, tramo y regla (siempre sobre la cobertura real) ──
  const crudo = useMemo(() => {
    const out = []
    const personasRolDia = (d, rol) => new Set(turnos.filter(f => f.fecha === fechas[d] && (f.rol_codigo || '_sincargo') === rol).map(f => f.cod_contaline)).size
    for (let d = 0; d < 7; d++) {
      if (!diasConTurno[d]) continue
      const dt = diaTipo(d), cov = covReal[d], sin = covSinCol[d]
      for (const mn of minsSuc.filter(x => x.dia_tipo === dt)) {
        const a = aMin(mn.hora_desde), b = aMin(mn.hora_hasta)
        for (const [x, y] of tramos(slots, (s, i) => s >= a && s < b && (cov[i].porRol[mn.rol_codigo] || 0) < mn.minimo)) {
          let peor = Infinity; slots.forEach((s, i) => { if (s >= x && s < y) peor = Math.min(peor, cov[i].porRol[mn.rol_codigo] || 0) })
          out.push({ sev:'alta', tipo:'min', k:`min|${mn.rol_codigo}|${mn.minimo}`, rol: mn.rol_codigo, req: mn.minimo, hay: peor, d, x, y })
        }
      }
      for (const [fam, [w0, w1]] of Object.entries(ventanaDia[d])) {
        if (fam !== 'comercial' && fam !== 'operaciones') continue
        if (!turnos.some(f => f.familia === fam && f.es_jefatura)) continue
        for (const [x, y] of tramos(slots, (s, i) => s >= w0 && s < w1 && !(cov[i].jefFam[fam] > 0)))
          out.push({ sev:'alta', tipo:'resp', k:`resp|${fam}`, fam, d, x, y })
      }
      for (const rol of rolesSuc) {
        const r = rolPorCod[rol]
        if (rol === '_sincargo' || !r || r.es_jefatura || !r.opera_en_turno) continue
        const w = ventanaDia[d][r.familia], n = personasRolDia(d, rol)
        if (!n || !w) continue
        const conMin = s => minsSuc.some(mn => mn.rol_codigo === rol && mn.dia_tipo === dt && s >= aMin(mn.hora_desde) && s < aMin(mn.hora_hasta))
        for (const [x, y] of tramos(slots, (s, i) => s >= w[0] && s < w[1] && (sin[i].porRol[rol] || 0) > 0 && !(cov[i].porRol[rol] > 0) && !conMin(s)))
          out.push({ sev:'media', tipo:'col', k:`col|${rol}`, rol, fam: r.familia, n, d, x, y })
        if (n >= 2) {
          for (const [x, y] of tramos(slots, (s, i) => s >= w[0] && s < w[1] && !(sin[i].porRol[rol] > 0) && !conMin(s)))
            if (y - x >= 30) out.push({ sev:'media', tipo:'sin', k:`sin|${rol}`, rol, fam: r.familia, n, d, x, y })
          for (const [x, y] of tramos(slots, (s, i) => s >= w[0] && s < w[1] && cov[i].porRol[rol] === 1 && !conMin(s)))
            if (y - x >= 60) out.push({ sev:'baja', tipo:'una', k:`una|${rol}`, rol, fam: r.familia, n, d, x, y })
        }
      }
    }
    return out
  }, [covReal, covSinCol, turnos, fechas, slots, minsSuc, ventanaDia, rolesSuc, rolPorCod, diasConTurno])

  const semanaItems = useMemo(() => consolidar(crudo), [crudo])
  const diaItems    = useMemo(() => consolidar(crudo.filter(c => c.d === diaSel)), [crudo, diaSel])

  // Semáforo por franja (día × slot) y por rol (día × slot × rol)
  const { estSlot, estRol } = useMemo(() => {
    const es = new Map(), er = new Map()
    const marca = (m, key, sev) => { if ((RANGO_SEV[m.get(key)] || 0) < RANGO_SEV[sev]) m.set(key, sev) }
    const jefasFam = fam => rolesSuc.filter(r => rolPorCod[r]?.es_jefatura && rolPorCod[r]?.familia === fam)
    for (const c of crudo) slots.forEach((s, i) => {
      if (s < c.x || s >= c.y) return
      if (c.sev !== 'baja') marca(es, `${c.d}|${i}`, c.sev)
      if (c.rol) marca(er, `${c.d}|${i}|${c.rol}`, c.sev)
      if (c.tipo === 'resp') for (const r of jefasFam(c.fam)) marca(er, `${c.d}|${i}|${r}`, c.sev)
    })
    return { estSlot: es, estRol: er }
  }, [crudo, slots, rolesSuc, rolPorCod])

  const estadoDia = useMemo(() => fechas.map((_, d) => {
    const del = crudo.filter(c => c.d === d)
    return { alta: new Set(del.filter(c => c.sev === 'alta').map(c => c.k)).size, media: new Set(del.filter(c => c.sev === 'media').map(c => c.k)).size }
  }), [crudo, fechas])

  // Turnos de la semana (para sugerir cuál cubre una franja débil)
  const turnosTipo = useMemo(() => {
    const m = {}
    for (const f of turnos) { const d = fechas.indexOf(f.fecha); const key = `${diaTipo(d)}|${f.turno}|${f._e}|${f._s}`; const t = m[key] || (m[key] = { dt: diaTipo(d), turno: f.turno, e: f._e, s: f._s, fams: new Set() }); if (f.familia) t.fams.add(f.familia) }
    return Object.values(m)
  }, [turnos, fechas])
  const sugerirTurno = useCallback(it => {
    const [x, y] = it.rangos[0], dt = diaTipo(it.dias[0]), fam = it.fam
    let mejor = null, puntaje = 0
    for (const t of turnosTipo) {
      if (t.dt !== dt) continue
      const o = Math.max(0, Math.min(t.s, y) - Math.max(t.e, x))
      if (o < 0.6 * (y - x)) continue
      const pts = o + (fam && t.fams.has(fam) ? 10000 : 0) - (t.s - t.e) / 1000
      if (pts > puntaje) { mejor = t; puntaje = pts }
    }
    return mejor ? `${mejor.turno} (${hhmm(mejor.e)}–${hhmm(mejor.s)})` : null
  }, [turnosTipo])

  const describir = useCallback(it => {
    const r = it.rol ? rolNombre(it.rol) : '', rl = r.toLowerCase(), sug = sugerirTurno(it)
    const cuando = `${diasTexto(it.dias)} ${rangosTxt(it.rangos)}`
    if (it.tipo === 'resp') return { cuando, titulo: it.fam === 'comercial' ? 'Sin jefatura comercial en tienda' : 'Sin jefatura en bodega',
      porque: 'Nadie con cargo de jefatura o coordinación está presente (contando colaciones).',
      hacer: `Que una jefatura o coordinación tome un turno que cubra esa franja${sug ? `, por ejemplo ${sug}` : ''}, o dejar designado un responsable.` }
    if (it.tipo === 'min') return { cuando, titulo: `${r}: bajo el mínimo`, porque: `Se piden ${it.req} y llega a haber ${it.hay}.`,
      hacer: `Sumar ${it.req - it.hay} ${rl} en esa franja${sug ? `, por ejemplo en ${sug}` : ''}.` }
    if (it.tipo === 'col') return { cuando, titulo: `${r}: nadie durante la colación`,
      porque: it.n === 1 ? 'Es una sola persona y nadie la cubre cuando sale a colación.' : 'Las colaciones del rol coinciden.',
      hacer: it.n === 1 ? `Definir quién cubre ${rl} mientras sale a colación.` : `Escalonar las colaciones de ${rl}.` }
    if (it.tipo === 'una') return { cuando, titulo: `${r}: una sola persona`, porque: 'Es normal con turnos escalonados, pero si esa persona falta no hay quién la reemplace.',
      hacer: 'Dejar definido quién la reemplaza; si el rol es clave en esa franja, evaluar sumar a alguien.' }
    return { cuando, titulo: `${r}: sin nadie`, porque: 'Hay personas del rol ese día, pero ninguna en esa franja.',
      hacer: `Redistribuir los turnos de ${rl}${sug ? `; ${sug} cubre esa franja` : ''}.` }
  }, [rolNombre, sugerirTurno])

  // ── Carga por persona con nivel y motivos ──
  const personas = useMemo(() => {
    const m = {}
    for (const f of delSuc) {
      const p = m[f.cod_contaline] || (m[f.cod_contaline] = {
        cod: f.cod_contaline, nombre: f.nombre, rol: f.rol_codigo || '_sincargo', cargo: f.cargo || '', acumula: f.acumula || '',
        horas: 0, dias: 0, turnos: {}, proyectado: false, sinTurno: false, novedades: new Set(), unicaMin: 0 })
      if (f.entrada) {
        p.horas += Number(f.horas_netas) || 0; p.dias++
        const k = f.turno || '—'; p.turnos[k] = (p.turnos[k] || 0) + 1
        if (f.fuente === 'proyectado') p.proyectado = true
      }
      if (f.fuente === 'sin_turno') p.sinTurno = true
      if (f.novedad) p.novedades.add(NOVEDAD[f.novedad] || f.novedad)
    }
    covReal.forEach(dia => dia.forEach(c => {
      for (const [r, cods] of Object.entries(c.quien)) if (cods.length === 1 && r !== '_sincargo' && !rolPorCod[r]?.es_jefatura && m[cods[0]]) m[cods[0]].unicaMin += SLOT
    }))
    return Object.values(m).map(p => {
      const c = carga[p.cod] || null
      const horas = Math.round(p.horas * 10) / 10, extraMin = c?.min_extra || 0, maxDia = c?.max_extra_dia || 0, d10 = c?.dias_sobre_10h || 0
      const sobreJornada = horas > jornadaLegal + 0.01
      const motivos = []
      if (extraMin >= 480) motivos.push(`${horasDe(extraMin)} h extra en 4 semanas`)
      if (d10 >= 4) motivos.push(`${d10} días de más de 10 h`)
      if (maxDia > 120) motivos.push(`hasta ${horasDe(maxDia)} h extra en un día (tope legal 2 h)`)
      if (sobreJornada) motivos.push(`su semana suma ${n1(horas)} h (jornada legal ${jornadaLegal} h)`)
      if (p.acumula) motivos.push(`acumula ${p.acumula}`)
      const nivel = (extraMin >= 960 || maxDia > 120 || d10 >= 8 || sobreJornada) ? 'alta' : (extraMin >= 480 || d10 >= 4 || p.acumula) ? 'media' : 'normal'
      return { ...p, horas, c, extraMin, sobreJornada, nivel, motivos, turnosTxt: Object.entries(p.turnos).map(([t, n]) => `${t}×${n}`).join(' · '), novTxt: [...p.novedades].join(', ') }
    }).sort((a, b) => ({ alta: 0, media: 1, normal: 2 })[a.nivel] - ({ alta: 0, media: 1, normal: 2 })[b.nivel] || b.extraMin - a.extraMin || b.horas - a.horas)
  }, [delSuc, covReal, carga, jornadaLegal, rolPorCod])

  // ── Plantilla turno × rol ──
  const plantilla = useMemo(() => {
    const g = {}
    for (const f of turnos) {
      const d = fechas.indexOf(f.fecha); if (d < 0) continue
      const key = `${diaTipo(d)}|${f.turno || '—'}|${f._e}|${f._s}`
      const x = g[key] || (g[key] = { dt: diaTipo(d), turno: f.turno || '—', e: f._e, s: f._s, dias: new Set(), porRol: {}, total: 0 })
      x.dias.add(d); const r = f.rol_codigo || '_sincargo'; x.porRol[r] = (x.porRol[r] || 0) + 1; x.total++
    }
    return Object.values(g).map(x => {
      const nd = x.dias.size || 1
      return { ...x, diasIdx: [...x.dias], porRol: Object.fromEntries(Object.entries(x.porRol).map(([k, v]) => [k, v / nd])), total: x.total / nd }
    }).sort((a, b) => ['lv','sab','dom'].indexOf(a.dt) - ['lv','sab','dom'].indexOf(b.dt) || a.e - b.e || a.s - b.s)
  }, [turnos, fechas])

  // ── Lectura de la semana en lenguaje simple ──
  const lectura = useMemo(() => {
    const alt = semanaItems.filter(i => i.sev === 'alta'), med = semanaItems.filter(i => i.sev === 'media'), baj = semanaItems.filter(i => i.sev === 'baja')
    const lineas = []
    for (const it of alt.slice(0, 3)) {
      const d = describir(it)
      lineas.push({ sev:'alta', cuando: `${diasLargo(it.dias)}, ${rangosTxt(it.rangos)} (${momentos(it.rangos)})`, que: d.titulo.charAt(0).toLowerCase() + d.titulo.slice(1), hacer: d.hacer })
    }
    if (alt.length > 3) lineas.push({ sev:'alta', cuando: `Y ${alt.length - 3} problema(s) crítico(s) más`, que: 'en el detalle por día', hacer: null })
    const porTipo = (tipo, verbo1, verboN, hacer, conHoras = true) => {
      const items = [...med, ...baj].filter(i => i.tipo === tipo); if (!items.length) return
      const sev = items[0].sev
      const rolesT = [...new Set(items.map(i => rolNombre(i.rol)))]
      const horas = items.reduce((s, i) => s + i.horas, 0)
      lineas.push({ sev, cuando: capital(listaNat(rolesT.map((r, i) => i ? r.toLowerCase() : r))), que: `${rolesT.length > 1 ? verboN : verbo1}${conHoras ? ` (${n1(Math.round(horas * 10) / 10)} h a la semana)` : ''}`, hacer })
    }
    porTipo('col', 'queda sin nadie durante colaciones', 'quedan sin nadie durante colaciones', 'Escalonar colaciones o definir quién cubre en ese rato.')
    porTipo('sin', 'queda sin nadie en algunas franjas', 'quedan sin nadie en algunas franjas', 'Redistribuir los turnos del rol para cubrir la jornada completa.')
    const cargados = personas.filter(p => p.nivel === 'alta')
    if (cargados.length) {
      const p = cargados[0]
      lineas.push({ sev: 'alta', cuando: `${p.nombre.split(' ').slice(0, 3).join(' ')} (${rolNombre(p.rol).toLowerCase()})`, que: `${p.motivos.slice(0, 3).join(', ')}${cargados.length > 1 ? `. Hay ${cargados.length - 1} persona(s) más con carga alta` : ''}`,
        hacer: 'Revisar si el rol necesita otra persona o redistribuir tareas antes de que la hora extra sea permanente.' })
    }
    porTipo('una', 'queda sin respaldo en algunas franjas: hay una sola persona', 'quedan sin respaldo en algunas franjas: hay una sola persona', 'Normal con turnos escalonados; dejar definido quién reemplaza a cada uno si falta.', false)
    const proy = personas.filter(p => p.proyectado).length, sinT = personas.filter(p => p.sinTurno)
    if (proy || sinT.length) lineas.push({ sev:'info', cuando: 'Datos de Workera',
      que: `${proy ? `${proy} persona(s) sin turno publicado esta semana: se usa su semana de hace 2 semanas` : ''}${proy && sinT.length ? '; ' : ''}${sinT.length ? `${listaNat(sinT.map(p => p.nombre.split(' ').slice(0, 3).join(' ')))} sin turno ni historial` : ''}`,
      hacer: 'Publicar los turnos en Workera para que la malla sea exacta.' })
    if (!minsSuc.length) lineas.push({ sev:'info', cuando: 'Sin mínimos definidos', que: 'las alertas usan reglas generales (jefatura presente, una sola persona, colaciones)', hacer: 'Definir mínimos por rol en "Mínimos de cobertura" para exigir la dotación que ustedes quieren.' })
    const hAlta = alt.reduce((s, i) => s + i.horas, 0), hMedia = med.reduce((s, i) => s + i.horas, 0)
    const estado = alt.length ? 'alta' : med.length ? 'media' : 'ok'
    return { lineas, estado, hAlta, hMedia, cargados: cargados.length, observar: personas.filter(p => p.nivel === 'media').length, sinPublicar: proy + sinT.length }
  }, [semanaItems, personas, describir, rolNombre, minsSuc])

  // ── Ventana emergente: las personas detrás de cada número ──
  const abrirFranja = useCallback((d, i, rol = null) => { setDiaSel(d); setPop({ tipo:'franja', d, i, rol }) }, [])
  const abrirPersona = useCallback(cod => setPop(p => ({ tipo:'persona', cod, prev: p && p.tipo !== 'persona' ? p : (p?.prev || null) })), [])
  const popSpec = useMemo(() => {
    if (!pop) return null
    const ordenP = (a, b) => ordenRol(a.rol_codigo || '_sincargo') - ordenRol(b.rol_codigo || '_sincargo') || a.nombre.localeCompare(b.nombre)
    const fila = (f, detalle) => ({ cod: f.cod_contaline, color: colorRol(f.rol_codigo || '_sincargo'), nombre: f.nombre, rol: rolNombre(f.rol_codigo || '_sincargo'), detalle,
      tags: [f.fuente === 'proyectado' ? 'proyectado' : null, f.acumula ? 'acumula cargos' : null].filter(Boolean) })
    const hor = f => `${f.turno || ''} ${hhmm(f._e)}–${hhmm(f._s)}`.trim()
    const sufFam = familia !== 'todas' ? ` · ${FAM[familia]}` : ''
    const probDe = it => { const t = describir(it); return { sev: it.sev, cuando: `${diasTexto(it.dias)} ${rangosTxt(it.rangos)}`, titulo: t.titulo, porque: t.porque, hacer: t.hacer } }
    if (pop.tipo === 'franja') {
      const { d, i, rol } = pop, fe = fechas[d], s0 = slots[i], m = s0 + SLOT / 2
      const delRol = f => !rol || (f.rol_codigo || '_sincargo') === rol
      const delDia = turnos.filter(f => f.fecha === fe && delRol(f)).sort(ordenP)
      const enCol = f => f._ci != null && m >= f._ci && m < f._ci + f.colacion_min
      const enTurno = f => f._e <= m && m < f._s
      const pres = delDia.filter(f => enTurno(f) && !f.novedad && !enCol(f))
      const col = delDia.filter(f => enTurno(f) && !f.novedad && enCol(f))
      const aus = delDia.filter(f => enTurno(f) && f.novedad)
      const despues = delDia.filter(f => f._e > m), antes = delDia.filter(f => f._s <= m)
      const otros = delSuc.filter(f => f.fecha === fe && delRol(f) && !f.entrada).sort(ordenP)
      const esJefa = rol && rolPorCod[rol]?.es_jefatura
      const probs = consolidar(crudo.filter(c => c.d === d && s0 >= c.x && s0 < c.y &&
        (!rol || c.rol === rol || (c.tipo === 'resp' && esJefa && rolPorCod[rol]?.familia === c.fam))))
      const req = rol && rol !== '_sincargo' ? requerido(d, s0, rol) : 0
      const estado = probs[0]?.sev === 'alta' || probs[0]?.sev === 'media' ? probs[0].sev : probs[0]?.sev === 'baja' ? 'baja' : (pres.length ? 'ok' : null)
      return {
        titulo: `${rol ? rolNombre(rol) : 'Todos los roles'} · ${hhmm(s0)}–${hhmm(s0 + SLOT)}`,
        subtitulo: `${nombreSucPop} · ${DIAS_L[d]} ${fDia(fe)}${sufFam}`, estado,
        resumen: [
          { l:'Presentes', v: pres.length, c: estado && estado !== 'ok' ? EST[estado].c : EST.ok.c },
          { l:'En colación', v: col.length }, { l:'Con licencia o permiso', v: aus.length },
          req ? { l:'Mínimo pedido', v: req, c: pres.length < req ? EST.alta.c : undefined } : { l:'Con turno ese día', v: delDia.length },
        ],
        problemas: probs.map(probDe).map(x => ({ ...x, cuando: x.cuando.replace(/^\S+ /, '') })),
        nota: pres.length + col.length + aus.length > 0 ? null : 'Nadie de este grupo tiene turno en esta media hora.',
        secciones: [
          { titulo:'Presentes', filas: pres.map(f => fila(f, hor(f))), siempre: true },
          { titulo:'En colación', filas: col.map(f => fila(f, `colación ${hhmm(f._ci)}–${hhmm(f._ci + f.colacion_min)} · ${hor(f)}`)) },
          { titulo:'Con licencia, vacaciones o permiso', filas: aus.map(f => fila(f, `${NOVEDAD[f.novedad] || f.novedad} · tenía ${hor(f)}`)) },
          { titulo:'Entran más tarde', filas: despues.map(f => fila(f, `entra ${hhmm(f._e)} · ${hor(f)}`)) },
          { titulo:'Ya salieron', filas: antes.map(f => fila(f, `salió ${hhmm(f._s)} · ${hor(f)}`)) },
          { titulo:'Libres ese día', filas: otros.filter(f => f.fuente !== 'sin_turno').map(f => fila(f, f.fuente === 'feriado' ? `feriado${f.feriado ? `: ${f.feriado}` : ''}` : 'día libre')) },
          { titulo:'Sin turno publicado ni historial', filas: otros.filter(f => f.fuente === 'sin_turno').map(f => fila(f, 'no aparece en Workera')) },
        ],
      }
    }
    if (pop.tipo === 'plantilla') {
      const { f: pf, rol } = pop
      const del = turnos.filter(f => { const d = fechas.indexOf(f.fecha); return diaTipo(d) === pf.dt && (f.turno || '—') === pf.turno && f._e === pf.e && f._s === pf.s && (!rol || (f.rol_codigo || '_sincargo') === rol) })
      const porP = {}
      for (const f of del) (porP[f.cod_contaline] = porP[f.cod_contaline] || { f, dias: [] }).dias.push(fechas.indexOf(f.fecha))
      const lista = Object.values(porP).sort((a, b) => ordenP(a.f, b.f))
      const prom = pf.diasIdx.length ? del.length / pf.diasIdx.length : 0
      return {
        titulo: `${pf.turno} ${hhmm(pf.e)}–${hhmm(pf.s)}${rol ? ` · ${rolNombre(rol)}` : ''}`,
        subtitulo: `${nombreSucPop} · ${DIA_TIPO_L[pf.dt]} · semana del ${fRango(fechas[0], fechas[6])}${sufFam}`, estado: null,
        resumen: [{ l:'Personas distintas', v: lista.length }, { l:'Promedio por día', v: n1(Math.round(prom * 10) / 10) }, { l:'Días con este turno', v: diasTexto(pf.diasIdx) }],
        nota: 'El número de la plantilla es el promedio de personas por día en que se usa este turno.',
        problemas: [],
        secciones: [{ titulo:'Personas con este turno', filas: lista.map(({ f, dias }) => fila(f, `${diasTexto(dias)}${f._ci != null ? ` · colación habitual ${hhmm(f._ci)}` : ''}`)), siempre: true }],
      }
    }
    if (pop.tipo === 'persona') {
      const p = personas.find(x => x.cod === pop.cod)
      if (!p) return null
      const filasP = delSuc.filter(f => f.cod_contaline === pop.cod).sort((a, b) => a.fecha.localeCompare(b.fecha))
      const cargo = filasP.find(f => f.cargo)?.cargo
      return {
        titulo: p.nombre, subtitulo: `${rolNombre(p.rol)}${cargo && cargo !== p.rol ? ` · ${cargo}` : ''} · ${nombreSucPop}`,
        estado: p.nivel === 'alta' ? 'alta' : p.nivel === 'media' ? 'media' : null, estadoTxt: p.nivel === 'alta' ? 'Carga alta' : p.nivel === 'media' ? 'Observar' : null,
        resumen: [
          { l:'Horas planificadas', v: n1(p.horas), c: p.sobreJornada ? EST.alta.c : undefined },
          { l:'Horas extra 4 semanas', v: horasDe(p.extraMin), c: p.extraMin >= 960 ? EST.alta.c : p.extraMin >= 480 ? EST.media.c : undefined },
          { l:'Días de más de 10 h', v: p.c?.dias_sobre_10h ?? 0 },
          { l:'Máx. extra en un día', v: `${horasDe(p.c?.max_extra_dia || 0)} h`, c: (p.c?.max_extra_dia || 0) > 120 ? EST.alta.c : undefined },
        ],
        nota: p.motivos.length ? `Motivos: ${p.motivos.join(' · ')}.` : null, problemas: [],
        secciones: [{ titulo:'Turnos de la semana', siempre: true, filas: filasP.map(f => {
          const d = fechas.indexOf(f.fecha), e = aMin(f.entrada), s2 = aMin(f.salida), ci = f.colacion_min > 0 && f.colacion_inicio ? aMin(f.colacion_inicio) : null
          const det = f.entrada ? `${f.turno || ''} ${hhmm(e)}–${hhmm(s2)}${ci != null ? ` · colación ${hhmm(ci)}–${hhmm(ci + f.colacion_min)}` : ''}${f.novedad ? ` · ${NOVEDAD[f.novedad] || f.novedad}` : ''}${f.fuente === 'proyectado' ? ` · proyectado desde el ${fDia(f.fecha_origen)}` : ''}`
            : f.fuente === 'feriado' ? `Feriado${f.feriado ? `: ${f.feriado}` : ''}` : f.fuente === 'sin_turno' ? 'Sin turno publicado ni historial' : 'Libre'
          return { cod: `${f.cod_contaline}-${f.fecha}`, color: f.entrada ? colorRol(f.rol_codigo || '_sincargo') : '#D0D5DD', nombre: `${DIAS[d]} ${fDia(f.fecha)}`, rol: null, detalle: det, tags: [], sinEnlace: true }
        }) }],
      }
    }
    if (pop.tipo === 'kpi') {
      if (pop.k === 'alta' || pop.k === 'media') {
        const items = semanaItems.filter(i => i.sev === pop.k)
        return { titulo: pop.k === 'alta' ? 'Franjas críticas de la semana' : 'Roles que quedan en cero', subtitulo: `${nombreSucPop} · semana del ${fRango(fechas[0], fechas[6])}${sufFam}`,
          estado: items.length ? pop.k : 'ok', resumen: [{ l:'Problemas', v: items.length }, { l:'Horas en la semana', v: n1(Math.round(items.reduce((s2, i) => s2 + i.horas, 0) * 10) / 10) }],
          problemas: items.map(probDe), nota: items.length ? 'Clic en una casilla del semáforo para ver quiénes están en cada franja.' : 'Sin problemas de este tipo esta semana.', secciones: [] }
      }
      if (pop.k === 'carga') {
        const fp = p => ({ cod: p.cod, color: colorRol(p.rol), nombre: p.nombre, rol: rolNombre(p.rol), detalle: p.motivos.join(' · ') || 'sin motivos', tags: [] })
        return { titulo: 'Carga de las personas', subtitulo: `${nombreSucPop} · horas extra de las últimas 4 semanas${sufFam}`, estado: null,
          resumen: [{ l:'Carga alta', v: personas.filter(p => p.nivel === 'alta').length, c: EST.alta.c }, { l:'Para observar', v: personas.filter(p => p.nivel === 'media').length, c: EST.media.c }],
          problemas: [], nota: 'Carga alta: 16 h extra o más en 4 semanas, más de 2 h extra en un día, 8 o más días de más de 10 h, o turnos sobre la jornada legal.',
          secciones: [{ titulo:'Carga alta', filas: personas.filter(p => p.nivel === 'alta').map(fp) }, { titulo:'Para observar', filas: personas.filter(p => p.nivel === 'media').map(fp) }] }
      }
      const orig = cod => delSuc.find(f => f.cod_contaline === cod && f.fuente === 'proyectado')?.fecha_origen
      const fp = (p, det) => ({ cod: p.cod, color: colorRol(p.rol), nombre: p.nombre, rol: rolNombre(p.rol), detalle: det, tags: [] })
      return { titulo: 'Turnos sin publicar en Workera', subtitulo: `${nombreSucPop} · semana del ${fRango(fechas[0], fechas[6])}${sufFam}`, estado: null,
        resumen: [{ l:'Proyectados', v: personas.filter(p => p.proyectado).length, c: EST.media.c }, { l:'Sin turno ni historial', v: personas.filter(p => p.sinTurno).length, c: EST.alta.c }],
        problemas: [], nota: 'Mientras no se publiquen, la malla repite la semana de hace 2 semanas de cada persona. Publicarlos en Workera deja la malla exacta.',
        secciones: [{ titulo:'Proyectados', filas: personas.filter(p => p.proyectado).map(p => fp(p, orig(p.cod) ? `se repite su semana del ${fDia(sumarDias(orig(p.cod), -((new Date(`${orig(p.cod)}T12:00:00`).getDay() + 6) % 7)))}` : 'turno proyectado')) },
                    { titulo:'Sin turno ni historial', filas: personas.filter(p => p.sinTurno).map(p => fp(p, 'no tiene turnos en Workera en las últimas 4 semanas')) }] }
    }
    return null
  }, [pop, fechas, slots, turnos, delSuc, crudo, rolPorCod, rolNombre, ordenRol, requerido, describir, personas, semanaItems, familia, nombreSucPop])

  const hoy = hoyISO()
  const ahoraMin = fechas[diaSel] === hoy ? (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })() : null

  async function proponerMinimos() {
    const ventana = {}
    for (const f of turnos) {
      const d = fechas.indexOf(f.fecha); if (d < 0 || !f.familia) continue
      const k = `${diaTipo(d)}|${f.familia}`
      const w = ventana[k] || (ventana[k] = [Infinity, -Infinity]); w[0] = Math.min(w[0], f._e); w[1] = Math.max(w[1], f._s)
    }
    const nuevos = []
    for (const rol of ROLES_BASE) {
      if (!rolesSuc.includes(rol) || !rolPorCod[rol]) continue
      for (const dt of ['lv', 'sab']) {
        const w = ventana[`${dt}|${rolPorCod[rol].familia}`]
        if (!w || minsSuc.some(m => m.rol_codigo === rol && m.dia_tipo === dt)) continue
        nuevos.push({ sucursal_id: suc, rol_codigo: rol, dia_tipo: dt, hora_desde: hhmm(w[0]), hora_hasta: hhmm(w[1]), minimo: 1,
          notas: 'Propuesta base: ajustar', actualizado_por: cu?.nombre || cu?.id || null })
      }
    }
    if (!nuevos.length) { setErr('No hay mínimos base que proponer: ya existen o la sucursal no tiene esos roles esta semana.'); return }
    if (!window.confirm(`Se crearán ${nuevos.length} mínimos de 1 persona (vendedor, caja, bodeguero y operador de grúa, según existan) en el horario de operación de ${sucNombre(suc)}. Después puedes ajustarlos.`)) return
    const { error } = await supabase.from('org_cobertura_minima').insert(nuevos)
    if (error) { setErr(error.message); return }
    await cargarSemana()
  }

  const sinDatos = !cargando && !err && turnos.length === 0
  const nombreSuc = nombreSucPop

  return (
    <div style={{display:'grid',gap:12}}>
      <style>{MT_CSS}</style>

      {/* Controles */}
      <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
        <select value={suc} onChange={e=>setSuc(e.target.value)} aria-label="Sucursal" style={{...inp,fontWeight:700}}>
          {sucsConGente.map(id => <option key={id} value={id}>{sucNombre(id)}</option>)}
        </select>
        <div style={{display:'flex',alignItems:'center',gap:2,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:8,padding:2}}>
          <button onClick={()=>setLunes(l => sumarDias(l, -7))} aria-label="Semana anterior" style={btnIcono}>◀</button>
          <span style={{fontSize:12.5,fontWeight:700,padding:'0 8px',whiteSpace:'nowrap'}}>Semana del {fRango(fechas[0], fechas[6])}</span>
          <button onClick={()=>setLunes(l => sumarDias(l, 7))} aria-label="Semana siguiente" style={btnIcono}>▶</button>
        </div>
        {lunes !== lunesDe(hoy) && <button onClick={()=>{ setLunes(lunesDe(hoy)); setDiaSel(Math.min(5, (new Date().getDay() + 6) % 7)) }} style={chip}>Esta semana</button>}
        <div role="radiogroup" aria-label="Área" style={{display:'flex',gap:2,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:8,padding:2}}>
          {['todas', ...['comercial','operaciones','administracion'].filter(f => familiasSuc.includes(f))].map(f => (
            <button key={f} role="radio" aria-checked={familia===f} onClick={()=>setFamilia(f)}
              style={{...seg, ...(familia===f ? segOn : {})}}>{f === 'todas' ? 'Todas las áreas' : FAM[f]}</button>
          ))}
        </div>
      </div>

      {err && <div style={{...aviso,background:'#FEF3F2',border:'1px solid #FDA29B',color:'#912018'}}>⚠️ {err}</div>}
      {cargando && <div style={{padding:50,textAlign:'center',color:'var(--text-muted)'}}>Cargando malla…</div>}
      {sinDatos && <div style={{...card,padding:'30px 24px',textAlign:'center',color:'var(--text-muted)'}}>No hay turnos de {nombreSuc}{familia !== 'todas' ? ` (${FAM[familia]})` : ''} en la semana del {fRango(fechas[0], fechas[6])}.</div>}

      {!cargando && !sinDatos && !err && (<>
        {/* 1 · Lectura de la semana */}
        <Lectura lectura={lectura} sucursal={nombreSuc} familia={familia} onKpi={k => setPop({ tipo:'kpi', k })}/>

        {/* 2 · Semana de un vistazo */}
        <section style={{...card,padding:0,overflow:'hidden'}} aria-label="Semana de un vistazo">
          <Cabecera titulo="La semana de un vistazo" nota="cada casilla es media hora; el número es cuántas personas hay presentes. Clic en una casilla para ver quiénes son."/>
          <Semaforo fechas={fechas} slots={slots} cov={covReal} estSlot={estSlot} ventanaTotal={ventanaTotal} diasConTurno={diasConTurno}
            diaSel={diaSel} onDia={setDiaSel} onCelda={abrirFranja}/>
          <Leyenda/>
        </section>

        {/* 3 · Día elegido */}
        <section style={{...card,padding:0,overflow:'hidden'}} aria-label="Detalle del día">
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',padding:'10px 12px',borderBottom:'1px solid var(--border)'}}>
            <span style={{fontSize:14,fontWeight:800}}>Detalle del día</span>
            <div role="tablist" aria-label="Día" style={{display:'flex',gap:4,flexWrap:'wrap'}}>
              {fechas.map((fe, d) => diasConTurno[d] || d < 6 ? (
                <button key={fe} role="tab" aria-selected={diaSel===d} disabled={!diasConTurno[d]} onClick={()=>setDiaSel(d)}
                  style={{...diaTab, ...(diaSel===d ? diaTabOn : {}), opacity: diasConTurno[d] ? 1 : 0.4}}>
                  <span style={{width:8,height:8,borderRadius:8,background: !diasConTurno[d] ? 'var(--border)' : EST[estadoDia[d].alta ? 'alta' : estadoDia[d].media ? 'media' : 'ok'].bg}}/>
                  {DIAS[d]} {fDia(fe)}
                </button>
              ) : null)}
            </div>
          </div>
          <div className="mt-dia">
            <div style={{minWidth:0}}>
              <div style={{padding:'10px 12px 0',fontSize:12.5,fontWeight:700}}>Cuántos hay de cada rol</div>
              <div style={{padding:'0 12px',fontSize:11,color:'var(--text-muted)'}}>número = personas presentes, ya descontando colaciones y ausencias · clic en un número para ver quiénes son</div>
              <Carriles d={diaSel} slots={slots} cov={covReal[diaSel]} plan={covPlan[diaSel]} roles={rolesSuc} rolPorCod={rolPorCod} rolNombre={rolNombre}
                estRol={estRol} ventana={ventanaDia[diaSel]} requerido={requerido} turnos={turnos.filter(f => f.fecha === fechas[diaSel])} onCelda={abrirFranja}/>
            </div>
            <Problemas items={diaItems} describir={describir} dia={`${DIAS_L[diaSel]} ${fDia(fechas[diaSel])}`}/>
          </div>
          <div style={{borderTop:'1px solid var(--border)'}}>
            <div style={{padding:'10px 12px 0',fontSize:12.5,fontWeight:700}}>Turnos del día</div>
            <div style={{padding:'0 12px',fontSize:11,color:'var(--text-muted)'}}>una barra por persona · tramo claro = colación habitual · rayado = turno proyectado · gris = con licencia, vacaciones o permiso · fondo rojo o ámbar = franja débil</div>
            <MallaDia filas={delSuc.filter(f => f.fecha === fechas[diaSel])} t0={t0} t1={t1} rolNombre={rolNombre} ordenRol={ordenRol} ahora={ahoraMin}
              bandas={crudo.filter(c => c.d === diaSel)} onPersona={abrirPersona}/>
          </div>
        </section>

        {/* 4 · Carga */}
        <Sobrecarga personas={personas} rolNombre={rolNombre} jornadaLegal={jornadaLegal} onPersona={abrirPersona}/>

        {/* 5 · Plantilla, mínimos y detalle */}
        <Plegable titulo="Plantilla por turno y rol" nota={`personas por día en que se usa cada turno · semana del ${fRango(fechas[0], fechas[6])}`}
          abierto={abierto.plantilla} onAlternar={()=>alternar('plantilla')}>
          <Plantilla filas={plantilla} roles={rolesSuc} rolNombre={rolNombre} onCelda={(f, rol) => setPop({ tipo:'plantilla', f, rol })}/>
        </Plegable>
        <Plegable titulo={`Mínimos de cobertura (${minsSuc.length})`} nota={minsSuc.length ? 'se comparan contra la cobertura real en los problemas' : 'sin mínimos definidos: los problemas usan reglas generales'}
          abierto={abierto.minimos} onAlternar={()=>alternar('minimos')}>
          <Minimos suc={suc} lista={minsSuc} roles={roles} rolesSuc={rolesSuc} puedeEditar={puedeEditar} cu={cu}
            onCambio={cargarSemana} onProponer={proponerMinimos}/>
        </Plegable>
        <Plegable titulo="Detalle por persona" nota="horas planificadas, horas extra, días largos y acumulación de cargos · exportable a Excel"
          abierto={abierto.detalle} onAlternar={()=>alternar('detalle')}>
          <div style={{height:'min(560px, 75vh)'}}>
            <DataGrid title="Carga por persona" exportName={`malla_carga_${suc}_${lunes}`} rows={personas} getRowId={p => p.cod} emptyText="Sin personas"
              columns={[
                { key:'nombre', label:'Trabajador', width:220, render: p => <span><strong>{p.nombre}</strong>{p.proyectado && <span style={tag('#B25E09')}>proyectado</span>}{p.sinTurno && <span style={tag('#B42318')}>sin turno</span>}</span> },
                { key:'nivel', label:'Carga', width:80, value: p => p.nivel === 'alta' ? 'Alta' : p.nivel === 'media' ? 'Observar' : 'Normal',
                  render: p => <span style={{fontWeight:800,color:p.nivel === 'alta' ? EST.alta.c : p.nivel === 'media' ? EST.media.c : 'var(--text-muted)'}}>{p.nivel === 'alta' ? 'Alta' : p.nivel === 'media' ? 'Observar' : 'Normal'}</span> },
                { key:'rol', label:'Rol', width:150, value: p => rolNombre(p.rol) },
                { key:'turnosTxt', label:'Turnos de la semana', width:150 },
                { key:'horas', label:'Horas plan.', width:85, align:'right', render: p => <span style={{fontWeight:700,color:p.sobreJornada?EST.alta.c:'inherit'}}>{n1(p.horas)}</span> },
                { key:'extraMin', label:'H. extra 4 sem', width:100, align:'right', value: p => Math.round(p.extraMin / 6) / 10 },
                { key:'d10', label:'Días > 10 h', width:85, align:'right', value: p => p.c?.dias_sobre_10h ?? 0 },
                { key:'maxx', label:'Máx. extra/día', width:100, align:'right', value: p => Math.round((p.c?.max_extra_dia || 0) / 6) / 10 },
                { key:'unica', label:'Única de su rol', width:105, align:'right', value: p => Math.round(p.unicaMin / 6) / 10, render: p => p.unicaMin ? `${horasDe(p.unicaMin)} h` : '—' },
                { key:'motivos', label:'Motivos', width:320, value: p => p.motivos.join(' · ') },
                { key:'novTxt', label:'Novedad', width:120 },
              ]}/>
          </div>
        </Plegable>
        <details style={{fontSize:11.5,color:'var(--text-muted)',lineHeight:1.55}}>
          <summary style={{cursor:'pointer',fontWeight:600}}>Cómo se calcula</summary>
          <div style={{marginTop:6}}>
            Turnos publicados en Workera (con correcciones aprobadas); si la semana de alguien no está publicada se usa su semana de hace 2 semanas, que respeta la rotación de turnos.
            Las personas se cuentan por el rol de su cargo principal en el organigrama. La colación (60 min en turnos de más de 6 h) se ubica a la hora en que cada persona suele marcarla,
            y quien tiene licencia, vacaciones o permiso no cuenta. Crítico: sin jefatura de su área en la franja o bajo el mínimo definido. Frágil: un rol queda sin nadie en su horario,
            también durante una colación. Sin respaldo (solo en el detalle del día): queda una sola persona de un rol que ese día tiene dos o más. Carga alta: 16 h extra o más en 4 semanas, más de 2 h extra en un día,
            8 o más días de más de 10 h, o turnos planificados sobre la jornada legal de {jornadaLegal} h.
          </div>
        </details>
      </>)}
      {popSpec && <Popup spec={popSpec} onCerrar={()=>setPop(null)} onPersona={abrirPersona}
        onVolver={pop?.prev ? () => setPop(pop.prev) : null}/>}
    </div>
  )
}

function Cabecera({ titulo, nota, children }) {
  return (
    <div style={cardHead}>
      <span style={{fontSize:14,fontWeight:800}}>{titulo}</span>
      {nota && <span style={{fontSize:11.5,color:'var(--text-muted)'}}>{nota}</span>}
      {children}
    </div>
  )
}

function Plegable({ titulo, nota, abierto, onAlternar, children }) {
  return (
    <section style={{...card,padding:0,overflow:'hidden'}}>
      <button onClick={onAlternar} aria-expanded={abierto}
        style={{...cardHead,width:'100%',background:'none',borderTop:'none',borderLeft:'none',borderRight:'none',borderBottom:abierto?'1px solid var(--border)':'none',cursor:'pointer',textAlign:'left',color:'var(--text)'}}>
        <span style={{fontSize:14,fontWeight:800}}>{titulo}</span>
        <span style={{fontSize:11.5,color:'var(--text-muted)'}}>{nota}</span>
        <span style={{marginLeft:'auto',fontSize:12,color:'var(--text-muted)'}}>{abierto ? 'Ocultar ▴' : 'Ver ▾'}</span>
      </button>
      {abierto && children}
    </section>
  )
}

// ─── 1 · Lectura de la semana ──────────────────────────────────────────────────
function Lectura({ lectura, sucursal, familia, onKpi }) {
  const e = lectura.estado
  const titulo = e === 'alta' ? 'Hay franjas críticas' : e === 'media' ? 'Cubierta, con puntos frágiles' : 'Semana cubierta'
  const color = e === 'ok' ? EST.ok : e === 'media' ? EST.media : EST.alta
  return (
    <section style={{...card,padding:0,overflow:'hidden'}} aria-label="Lectura de la semana">
      <div className="mt-lectura">
        <div style={{padding:'14px 16px',minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:10}}>
            <span style={{fontSize:16,fontWeight:800}}>{sucursal}{familia !== 'todas' ? ` · ${FAM[familia]}` : ''}</span>
            <span style={{fontSize:12,fontWeight:800,padding:'3px 10px',borderRadius:100,background:color.suave,color:color.c,border:`1px solid ${color.bg}`}}>{titulo}</span>
          </div>
          <ol style={{margin:0,padding:0,listStyle:'none',display:'grid',gap:8}}>
            {lectura.lineas.map((l, i) => (
              <li key={i} style={{display:'grid',gridTemplateColumns:'10px minmax(0,1fr)',gap:10,alignItems:'start'}}>
                <span style={{width:10,height:10,borderRadius:10,marginTop:4,background: l.sev === 'info' ? '#98A2B3' : EST[l.sev].bg, border: l.sev === 'baja' ? '1px solid #EAAA08' : 'none'}}/>
                <span style={{fontSize:13,lineHeight:1.45}}>
                  <strong>{l.cuando}</strong>{l.que ? <>: {l.que}</> : null}
                  {l.hacer && <span style={{display:'block',fontSize:12,color:'var(--text-muted)'}}>→ {l.hacer}</span>}
                </span>
              </li>
            ))}
            {!lectura.lineas.length && <li style={{fontSize:13,color:'var(--text-muted)'}}>Sin problemas con las reglas actuales.</li>}
          </ol>
        </div>
        <div className="mt-kpis">
          <Kpi onClick={()=>onKpi('alta')} l="Horas críticas" v={n1(Math.round(lectura.hAlta * 10) / 10)} sub="sin jefatura o bajo el mínimo" c={lectura.hAlta ? EST.alta.c : EST.ok.c}/>
          <Kpi onClick={()=>onKpi('media')} l="Horas con un rol en cero" v={n1(Math.round(lectura.hMedia * 10) / 10)} sub="nadie del rol, también en colaciones" c={lectura.hMedia ? EST.media.c : EST.ok.c}/>
          <Kpi onClick={()=>onKpi('carga')} l="Personas con carga alta" v={lectura.cargados} sub={`${lectura.observar} más para observar`} c={lectura.cargados ? EST.alta.c : 'var(--text)'}/>
          <Kpi onClick={()=>onKpi('sinPublicar')} l="Turnos sin publicar" v={lectura.sinPublicar} sub="personas, en Workera" c={lectura.sinPublicar ? EST.media.c : 'var(--text)'}/>
        </div>
      </div>
    </section>
  )
}

// ─── 2 · Semáforo de la semana ─────────────────────────────────────────────────
// Encabezado de horas: cada hora abarca sus 2 medias horas; la primera columna fija
// el ancho de las etiquetas y el resto se reparte el ancho disponible (table-layout fixed).
function Encabezado({ slots, ancho }) {
  const celdas = []
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    if (s % 60 === 0 && i + 1 < slots.length) { celdas.push(<th key={s} colSpan={2} className="h">{hhmm(s).slice(0, 2)}h</th>); i++ }
    else celdas.push(<th key={s} className="h">{s % 60 === 0 ? `${hhmm(s).slice(0, 2)}h` : ''}</th>)
  }
  return <thead><tr><th style={{width:ancho}}/>{celdas}</tr></thead>
}

function Semaforo({ fechas, slots, cov, estSlot, ventanaTotal, diasConTurno, diaSel, onDia, onCelda }) {
  const dias = fechas.map((fe, d) => ({ fe, d })).filter(x => diasConTurno[x.d])
  return (
    <div style={{overflowX:'auto',padding:'10px 12px 4px'}}>
      <table className="mt-sem">
        <Encabezado slots={slots} ancho={84}/>
        <tbody>
          {dias.map(({ fe, d }) => (
            <tr key={fe} className={d === diaSel ? 'sel' : ''} onClick={()=>onDia(d)}>
              <th scope="row">{DIAS[d]} {fDia(fe)}</th>
              {cov[d].map((c, i) => {
                const w = ventanaTotal[d], dentro = w && slots[i] >= w[0] && slots[i] < w[1]
                const e = dentro ? (estSlot.get(`${d}|${i}`) || 'ok') : null
                const st = e ? EST[e] : null
                return (
                  <td key={i} className={dentro ? 'in' : ''} onClick={dentro ? ev => { ev.stopPropagation(); onCelda(d, i) } : undefined} title={dentro ? `${DIAS[d]} ${hhmm(slots[i])}–${hhmm(slots[i] + SLOT)} · ${c.total} persona(s) · ${st.l}` : 'fuera del horario de ese día'}
                    style={{background: st ? st.bg : 'transparent', color: st ? st.fg : 'transparent'}}>
                    {dentro ? c.total : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Leyenda() {
  return (
    <div style={{display:'flex',flexWrap:'wrap',gap:'4px 16px',padding:'4px 12px 10px',fontSize:11.5,color:'var(--text-muted)'}}>
      {[['alta','Crítico: sin jefatura o bajo el mínimo'], ['media','Frágil: un rol queda sin nadie (también en colaciones)'], ['ok','Cubierto']].map(([k, t]) => (
        <span key={k} style={{display:'inline-flex',alignItems:'center',gap:6}}><span style={{width:14,height:14,borderRadius:3,background:EST[k].bg}}/>{t}</span>
      ))}
    </div>
  )
}

// ─── 3a · Carriles por rol del día ─────────────────────────────────────────────
function Carriles({ d, slots, cov, plan, roles, rolPorCod, rolNombre, estRol, ventana, requerido, turnos, onCelda }) {
  const nombres = Object.fromEntries(turnos.map(f => [f.cod_contaline, f.nombre.split(' ').slice(0, 2).join(' ')]))
  const grupos = []
  for (const fam of ['comercial', 'operaciones', 'administracion', 'marketing', 'direccion', null]) {
    const rs = roles.filter(r => (r === '_sincargo' ? null : (rolPorCod[r]?.familia ?? null)) === fam && (fam !== null || r === '_sincargo' || !rolPorCod[r]))
    if (rs.length) grupos.push({ fam, rs })
  }
  const total = cov.map(c => c.total)
  const maxT = Math.max(1, ...total)
  return (
    <div style={{overflowX:'auto',padding:'8px 12px 12px'}}>
      <table className="mt-car">
        <Encabezado slots={slots} ancho={220}/>
        <tbody>
          {grupos.map(g => (
            <Fragment key={g.fam || 'otros'}>
              <tr><th colSpan={slots.length + 1} className="fam">{g.fam ? FAM[g.fam] : 'Sin cargo en el organigrama'}</th></tr>
              {g.rs.map(r => {
                const w = r === '_sincargo' ? null : ventana[rolPorCod[r]?.familia]
                const nRol = new Set(turnos.filter(f => (f.rol_codigo || '_sincargo') === r).map(f => f.cod_contaline)).size
                return (
                  <tr key={r}>
                    <th scope="row" title={`${rolNombre(r)} · ${nRol} persona(s) ese día`}><span style={{display:'inline-block',width:8,height:8,borderRadius:2,background:colorRol(r),marginRight:6}}/>{rolNombre(r)} <span style={{color:'var(--text-muted)',fontWeight:500}}>· {nRol}</span></th>
                    {slots.map((s, i) => {
                      const v = cov[i].porRol[r] || 0, p = plan[i].porRol[r] || 0
                      const dentro = w ? (s >= w[0] && s < w[1]) : v > 0
                      const e = estRol.get(`${d}|${i}|${r}`)
                      const req = r === '_sincargo' ? 0 : requerido(d, s, r)
                      const st = e ? EST[e] : (v > 0 ? EST.ok : null)  // baja = amarillo suave
                      const quien = (cov[i].quien[r] || []).map(c => nombres[c]).join(', ')
                      const tit = `${rolNombre(r)} ${hhmm(s)}–${hhmm(s + SLOT)}: ${v} presente(s)${p > v ? ` de ${p} con turno (el resto en colación o ausente)` : ''}${req ? ` · mínimo ${req}` : ''}${quien ? ` · ${quien}` : ''}`
                      return <td key={s} title={tit} className={dentro || v ? 'clic' : ''} onClick={dentro || v ? () => onCelda(d, i, r) : undefined} style={{background: st ? (e ? st.bg : st.suave) : (dentro ? '#F2F4F7' : 'transparent'), color: st ? (e ? st.fg : st.c) : '#98A2B3'}}>{dentro || v ? v : ''}</td>
                    })}
                  </tr>
                )
              })}
            </Fragment>
          ))}
          <tr className="tot">
            <th scope="row">Total presentes</th>
            {total.map((v, i) => <td key={i} className="clic" onClick={() => onCelda(d, i, null)} title={`${v} presentes de ${plan[i].total} con turno`} style={{background: v ? `rgba(22,33,62,${(0.1 + 0.6 * v / maxT).toFixed(2)})` : 'transparent', color: v / maxT > 0.6 ? '#fff' : 'var(--text)'}}>{v || ''}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ─── 3b · Problemas del día con qué hacer ──────────────────────────────────────
function Problemas({ items, describir, dia }) {
  const alt = items.filter(i => i.sev === 'alta'), med = items.filter(i => i.sev === 'media'), baj = items.filter(i => i.sev === 'baja')
  return (
    <div className="mt-problemas"><div className="scroll">
      <div style={{padding:'10px 12px 6px',fontSize:12.5,fontWeight:700}}>Qué pasa el {dia}
        <span style={{fontWeight:500,color:'var(--text-muted)'}}> · {alt.length} crítico(s), {med.length} frágil(es), {baj.length} sin respaldo</span></div>
      {!alt.length && !med.length && <div style={{padding:'4px 12px 10px',fontSize:12.5,color:EST.ok.c}}>Sin franjas críticas ni roles en cero.</div>}
      <div style={{display:'grid',gap:8,padding:'0 12px 12px'}}>
        {[...alt, ...med].map((it, i) => {
          const d = describir(it), st = EST[it.sev]
          return (
            <div key={i} style={{borderLeft:`4px solid ${st.bg}`,background:st.suave,borderRadius:'0 8px 8px 0',padding:'8px 10px'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'baseline'}}>
                <span style={{fontSize:12.5,fontWeight:800,color:'#101828'}}>{d.titulo}</span>
                <span style={{fontSize:10.5,fontWeight:800,color:st.c,whiteSpace:'nowrap'}}>{st.l}</span>
              </div>
              <div style={{fontSize:12,fontWeight:700,color:'#344054',marginTop:2}}>{rangosTxt(it.rangos)} <span style={{fontWeight:500,color:'#667085'}}>({momentos(it.rangos)})</span></div>
              <div style={{fontSize:11.5,color:'#475467',marginTop:3}}>{d.porque}</div>
              <div style={{fontSize:11.5,color:'#101828',marginTop:3}}><strong>Qué hacer:</strong> {d.hacer}</div>
            </div>
          )
        })}
        {baj.length > 0 && (
          <div style={{border:`1px solid ${EST.baja.bg}`,background:EST.baja.suave,borderRadius:8,padding:'8px 10px'}}>
            <div style={{fontSize:12,fontWeight:800,color:'#101828'}}>Sin respaldo: una sola persona del rol</div>
            <div style={{fontSize:11.5,color:'#475467',margin:'2px 0 4px'}}>Normal con turnos escalonados; si esa persona falta, el rol queda sin nadie.</div>
            {baj.map((it, i) => <div key={i} style={{fontSize:11.5,color:'#344054'}}><strong>{describir(it).titulo.replace(': una sola persona', '')}</strong>: {rangosTxt(it.rangos)}</div>)}
          </div>
        )}
      </div>
    </div></div>
  )
}

// ─── 3c · Malla del día (barras por persona) con franjas débiles de fondo ──────
function MallaDia({ filas, t0, t1, rolNombre, ordenRol, ahora, bandas, onPersona }) {
  const span = t1 - t0, horas = span / 60
  const pct = m => `${((m - t0) / span) * 100}%`
  const conTurno = filas.filter(f => f.entrada && f.salida)
  const grupos = {}
  for (const f of conTurno) (grupos[f.rol_codigo || '_sincargo'] = grupos[f.rol_codigo || '_sincargo'] || []).push(f)
  const orden = Object.keys(grupos).sort((a, b) => ordenRol(a) - ordenRol(b))
  const descanso = filas.filter(f => f.fuente === 'descanso' || f.fuente === 'feriado')
  const sinTurno = filas.filter(f => f.fuente === 'sin_turno')
  const fondo = { backgroundImage:'linear-gradient(to right, var(--border) 1px, transparent 1px)', backgroundSize:`calc(100% / ${horas}) 100%` }
  // Franjas débiles del día, fusionadas por severidad
  const franjas = []
  for (const sev of ['media', 'alta']) {
    const rs = bandas.filter(b => b.sev === sev).map(b => [b.x, b.y]).sort((a, b) => a[0] - b[0])
    for (const r of rs) { const u = franjas.length && franjas[franjas.length - 1]; if (u && u.sev === sev && r[0] <= u.y) u.y = Math.max(u.y, r[1]); else franjas.push({ sev, x: r[0], y: r[1] }) }
  }
  return (
    <div style={{padding:'8px 12px 12px',overflowX:'auto'}}>
      <div style={{minWidth:760,position:'relative'}}>
        <div className="mt-fila" style={{height:18}}>
          <div/>
          <div style={{position:'relative',fontSize:10,color:'var(--text-muted)'}}>
            {Array.from({ length: horas + 1 }, (_, i) => t0 + i * 60).map(m => (
              <span key={m} style={{position:'absolute',left:pct(m),transform:'translateX(-50%)'}}>{hhmm(m).slice(0, 2)}</span>
            ))}
          </div>
        </div>
        <div style={{position:'absolute',top:18,bottom:0,left:238,right:0,pointerEvents:'none'}}>
          {franjas.map((b, i) => <span key={i} style={{position:'absolute',top:0,bottom:0,left:pct(b.x),width:`${((b.y - b.x) / span) * 100}%`,background: b.sev === 'alta' ? 'rgba(240,68,56,0.10)' : 'rgba(253,176,34,0.13)'}}/>)}
        </div>
        {!conTurno.length && <div style={{fontSize:12.5,color:'var(--text-muted)',padding:'8px 0'}}>Nadie con turno este día.</div>}
        {orden.map(r => (
          <Fragment key={r}>
            <div style={{fontSize:10.5,fontWeight:800,color:colorRol(r),margin:'8px 0 2px',position:'relative'}}>{rolNombre(r)} · {grupos[r].length}</div>
            {grupos[r].sort((a, b) => aMin(a.entrada) - aMin(b.entrada) || a.nombre.localeCompare(b.nombre)).map(f => {
              const e = aMin(f.entrada), s = aMin(f.salida), ci = f.colacion_min > 0 && f.colacion_inicio ? aMin(f.colacion_inicio) : null
              const col = colorRol(r), nov = !!f.novedad, proy = f.fuente === 'proyectado'
              const fondoBarra = nov ? '#D0D5DD' : proy ? `repeating-linear-gradient(135deg, ${col} 0 6px, ${col}99 6px 12px)` : col
              const titulo = `${f.nombre} · ${f.turno || ''} ${hhmm(e)}–${hhmm(s)}${ci != null ? ` · colación ${hhmm(ci)}–${hhmm(ci + f.colacion_min)}` : ''}${proy ? ` · proyectado desde el ${fDia(f.fecha_origen)}` : ''}${nov ? ` · ${NOVEDAD[f.novedad] || f.novedad}` : ''}`
              return (
                <div key={`${f.cod_contaline}`} className="mt-fila" style={{position:'relative'}}>
                  <div style={{fontSize:11.5,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',cursor:'pointer'}} title={`${f.nombre}: ver su semana`} onClick={() => onPersona(f.cod_contaline)}>
                    {f.nombre}{f.acumula ? <span style={{color:'#B25E09'}}> · acumula</span> : null}
                  </div>
                  <div style={{position:'relative',height:20,...fondo}}>
                    <div title={titulo} onClick={() => onPersona(f.cod_contaline)} className={proy ? 'mt-barra proy' : 'mt-barra'}
                      style={{position:'absolute',top:2,bottom:2,left:pct(e),width:`${((s - e) / span) * 100}%`,background:fondoBarra,borderRadius:5,
                        border: proy ? `1px dashed ${col}` : 'none', color: nov ? '#344054' : '#fff'}}>
                      {ci != null && !nov && <span style={{position:'absolute',top:0,bottom:0,left:`${((ci - e) / (s - e)) * 100}%`,width:`${(f.colacion_min / (s - e)) * 100}%`,background:'rgba(255,255,255,0.62)'}}/>}
                      <span style={{position:'relative',fontSize:10,fontWeight:700,padding:'0 6px',lineHeight:'16px',whiteSpace:'nowrap'}}>
                        {f.turno} {hhmm(e)}–{hhmm(s)}{nov ? ` · ${NOVEDAD[f.novedad] || f.novedad}` : ''}
                      </span>
                    </div>
                    {ahora != null && ahora >= t0 && ahora <= t1 && <span style={{position:'absolute',top:0,bottom:0,left:pct(ahora),width:1.5,background:'#D92D20'}}/>}
                  </div>
                </div>
              )
            })}
          </Fragment>
        ))}
        {(descanso.length > 0 || sinTurno.length > 0) && (
          <div style={{marginTop:10,fontSize:11.5,color:'var(--text-muted)',lineHeight:1.6,position:'relative'}}>
            {descanso.length > 0 && <div><strong style={{color:'var(--text)'}}>Libres este día ({descanso.length}):</strong> {descanso.map(f => f.nombre.split(' ').slice(0, 2).join(' ')).join(' · ')}</div>}
            {sinTurno.length > 0 && <div style={{color:'#B42318'}}><strong>Sin turno publicado ni historial ({sinTurno.length}):</strong> {sinTurno.map(f => f.nombre).join(' · ')}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 4 · Carga de las personas ─────────────────────────────────────────────────
function Sobrecarga({ personas, rolNombre, jornadaLegal, onPersona }) {
  const lista = personas.filter(p => p.nivel !== 'normal').slice(0, 10)
  const max = Math.max(60, ...lista.map(p => p.extraMin))
  return (
    <section style={{...card,padding:0,overflow:'hidden'}} aria-label="Carga de las personas">
      <Cabecera titulo="Quién está sobrecargado" nota={`horas extra según marcas de las últimas 4 semanas · referencia: 8 h en 4 semanas es 2 h por semana · jornada legal ${jornadaLegal} h`}/>
      {!lista.length && <div style={{padding:'14px 12px',fontSize:12.5,color:EST.ok.c}}>Nadie con carga alta ni para observar en esta sucursal.</div>}
      <div style={{display:'grid',gap:6,padding:'10px 12px 12px'}}>
        {lista.map(p => {
          const st = p.nivel === 'alta' ? EST.alta : EST.media
          return (
            <div key={p.cod} className="mt-carga clic" role="button" tabIndex={0} title="Ver su semana y su carga" onClick={() => onPersona(p.cod)} onKeyDown={ev => { if (ev.key === 'Enter') onPersona(p.cod) }}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:12.5,fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.nombre}</div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>{rolNombre(p.rol)}</div>
              </div>
              <div>
                <div style={{position:'relative',height:16,background:'#F2F4F7',borderRadius:4}}>
                  <div style={{position:'absolute',top:0,bottom:0,left:0,width:`${Math.max(2, (p.extraMin / max) * 100)}%`,background:st.bg,borderRadius:4}}/>
                  <span style={{position:'absolute',left:`calc(${(480 / max) * 100}% - 1px)`,top:-3,bottom:-3,width:2,background:'#667085',opacity: 480 < max ? 0.5 : 0}} title="8 h en 4 semanas"/>
                </div>
                <div style={{fontSize:11.5,color:'#475467',marginTop:3}}>{p.motivos.length ? p.motivos.join(' · ') : 'sin motivos'}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:16,fontWeight:800,color:st.c,fontVariantNumeric:'tabular-nums'}}>{horasDe(p.extraMin)} h</div>
                <div style={{fontSize:10.5,fontWeight:800,color:st.c}}>{p.nivel === 'alta' ? 'Carga alta' : 'Observar'}</div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Plantilla turno × rol ───────────────────────────────────────────────────
function Plantilla({ filas, roles, rolNombre, onCelda }) {
  if (!filas.length) return <div style={{padding:'14px 12px',fontSize:12.5,color:'var(--text-muted)'}}>Sin turnos esta semana.</div>
  const totalRol = r => { const lv = filas.filter(f => f.dt === 'lv'); return lv.reduce((s, f) => s + (f.porRol[r] || 0), 0) }
  return (
    <div style={{overflowX:'auto'}}>
      <table className="mt-tabla">
        <thead>
          <tr>
            <th style={{textAlign:'left'}}>Turno</th><th style={{textAlign:'left'}}>Horario</th><th style={{textAlign:'left'}}>Días</th>
            {roles.map(r => <th key={r}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{width:8,height:8,borderRadius:2,background:colorRol(r)}}/>{rolNombre(r)}</span></th>)}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => {
            const nuevoGrupo = i === 0 || filas[i - 1].dt !== f.dt
            const largo = (f.s - f.e) / 60
            return (
              <Fragment key={`${f.dt}|${f.turno}|${f.e}|${f.s}`}>
                {nuevoGrupo && <tr><td colSpan={roles.length + 4} className="grupo">{DIA_TIPO_L[f.dt]}</td></tr>}
                <tr>
                  <td style={{textAlign:'left',fontWeight:700}}>{f.turno}</td>
                  <td style={{textAlign:'left',whiteSpace:'nowrap'}}>{hhmm(f.e)}–{hhmm(f.s)} <span style={{color:'var(--text-muted)'}}>({n1(largo)} h)</span></td>
                  <td style={{textAlign:'left',whiteSpace:'nowrap',color:'var(--text-muted)'}}>{diasTexto(f.diasIdx)}</td>
                  {roles.map(r => <td key={r} className={f.porRol[r] ? 'clic' : ''} onClick={f.porRol[r] ? () => onCelda(f, r) : undefined} style={{color: f.porRol[r] ? 'var(--text)' : 'var(--border)'}}>{f.porRol[r] ? n1(Math.round(f.porRol[r] * 10) / 10) : '·'}</td>)}
                  <td className="clic" onClick={() => onCelda(f, null)} style={{fontWeight:800}}>{n1(Math.round(f.total * 10) / 10)}</td>
                </tr>
              </Fragment>
            )
          })}
          <tr className="total">
            <td colSpan={3} style={{textAlign:'left'}}>Dotación típica de lunes a viernes</td>
            {roles.map(r => <td key={r}>{n1(Math.round(totalRol(r) * 10) / 10)}</td>)}
            <td>{n1(Math.round(filas.filter(f => f.dt === 'lv').reduce((s, f) => s + f.total, 0) * 10) / 10)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ─── Mínimos de cobertura (plantilla requerida) ───────────────────────────────
function Minimos({ suc, lista, roles, rolesSuc, puedeEditar, cu, onCambio, onProponer }) {
  const [nuevo, setNuevo] = useState({ rol_codigo: rolesSuc.find(r => r !== '_sincargo') || '', dia_tipo:'lv', hora_desde:'09:00', hora_hasta:'19:00', minimo:1 })
  const [trab, setTrab] = useState(false)
  const [err, setErr] = useState(null)
  const nombre = k => roles.find(r => r.codigo === k)?.nombre || k
  const ordenados = [...lista].sort((a, b) => ['lv','sab','dom'].indexOf(a.dia_tipo) - ['lv','sab','dom'].indexOf(b.dia_tipo) || nombre(a.rol_codigo).localeCompare(nombre(b.rol_codigo)) || String(a.hora_desde).localeCompare(String(b.hora_desde)))
  async function agregar() {
    if (!nuevo.rol_codigo) { setErr('Elige un rol'); return }
    if (aMin(nuevo.hora_hasta) <= aMin(nuevo.hora_desde)) { setErr('La hora de término debe ser posterior al inicio'); return }
    setTrab(true); setErr(null)
    const { error } = await supabase.from('org_cobertura_minima').insert({ ...nuevo, minimo: Math.max(0, Math.round(Number(nuevo.minimo) || 0)), sucursal_id: suc, actualizado_por: cu?.nombre || cu?.id || null })
    setTrab(false)
    if (error) { setErr(error.message); return }
    await onCambio()
  }
  async function quitar(m) {
    setTrab(true); setErr(null)
    const { error } = await supabase.from('org_cobertura_minima').update({ activo:false, updated_at:new Date().toISOString(), actualizado_por: cu?.nombre || cu?.id || null }).eq('id', m.id)
    setTrab(false)
    if (error) { setErr(error.message); return }
    await onCambio()
  }
  return (
    <div style={{padding:'10px 12px 12px'}}>
      {ordenados.length === 0 && <div style={{fontSize:12.5,color:'var(--text-muted)',marginBottom:10,lineHeight:1.5}}>
        Sin mínimos para esta sucursal. Definen cuántas personas de cada rol deben estar presentes en cada franja; con ellos las debilidades pasan de reglas generales a la plantilla que ustedes exigen.
      </div>}
      {ordenados.length > 0 && (
        <table className="mt-tabla" style={{marginBottom:10}}>
          <thead><tr><th style={{textAlign:'left'}}>Rol</th><th style={{textAlign:'left'}}>Días</th><th>Desde</th><th>Hasta</th><th>Mínimo</th><th style={{textAlign:'left'}}>Notas</th><th/></tr></thead>
          <tbody>
            {ordenados.map(m => (
              <tr key={m.id}>
                <td style={{textAlign:'left'}}><span style={{display:'inline-flex',alignItems:'center',gap:5}}><span style={{width:8,height:8,borderRadius:2,background:colorRol(m.rol_codigo)}}/>{nombre(m.rol_codigo)}</span></td>
                <td style={{textAlign:'left'}}>{DIA_TIPO_L[m.dia_tipo]}</td>
                <td>{String(m.hora_desde).slice(0, 5)}</td><td>{String(m.hora_hasta).slice(0, 5)}</td>
                <td style={{fontWeight:800}}>{m.minimo}</td>
                <td style={{textAlign:'left',color:'var(--text-muted)'}}>{m.notas || ''}</td>
                <td>{puedeEditar && <button onClick={()=>quitar(m)} disabled={trab} style={{...lnk,color:'#B42318'}}>Quitar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {puedeEditar ? (
        <div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center'}}>
          <select aria-label="Rol del mínimo" value={nuevo.rol_codigo} onChange={e=>setNuevo(n=>({...n,rol_codigo:e.target.value}))} style={inp}>
            <option value="">Rol…</option>
            {roles.filter(r => r.opera_en_turno).map(r => <option key={r.codigo} value={r.codigo}>{r.nombre}</option>)}
          </select>
          <select aria-label="Días" value={nuevo.dia_tipo} onChange={e=>setNuevo(n=>({...n,dia_tipo:e.target.value}))} style={inp}>
            {Object.entries(DIA_TIPO_L).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input aria-label="Desde" type="time" step="1800" value={nuevo.hora_desde} onChange={e=>setNuevo(n=>({...n,hora_desde:e.target.value}))} style={inp}/>
          <input aria-label="Hasta" type="time" step="1800" value={nuevo.hora_hasta} onChange={e=>setNuevo(n=>({...n,hora_hasta:e.target.value}))} style={inp}/>
          <input aria-label="Mínimo de personas" type="number" min={0} value={nuevo.minimo} onChange={e=>setNuevo(n=>({...n,minimo:e.target.value}))} style={{...inp,width:70}}/>
          <button onClick={agregar} disabled={trab} style={btnPri}>Agregar mínimo</button>
          <span style={{width:1,height:20,background:'var(--border)'}}/>
          <button onClick={onProponer} disabled={trab} style={btnSec}>Proponer mínimos base</button>
          <span style={{fontSize:11,color:'var(--text-muted)'}}>1 persona de vendedor, caja, bodeguero y operador de grúa en el horario de operación de esta semana</span>
        </div>
      ) : <div style={{fontSize:11.5,color:'var(--text-muted)'}}>Los mínimos los define Gestión de Personas.</div>}
      {err && <div style={{fontSize:12,color:'#B42318',marginTop:8}}>⚠️ {err}</div>}
    </div>
  )
}

function Kpi({ l, v, sub, c, onClick }) {
  const base = {background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,padding:'9px 12px',textAlign:'left',font:'inherit',color:'inherit',width:'100%'}
  const cont = (<>
    <div style={{fontSize:11.5,fontWeight:600,color:'var(--text-muted)'}}>{l}{onClick && <span aria-hidden="true" style={{float:'right',color:'#98A2B3'}}>›</span>}</div>
    <div style={{fontSize:22,fontWeight:800,lineHeight:1.2,color:c || 'var(--text)',fontVariantNumeric:'tabular-nums'}}>{v}</div>
    {sub && <div style={{fontSize:11,color:'var(--text-muted)'}}>{sub}</div>}
  </>)
  return onClick ? <button className="mt-kpi" onClick={onClick} style={{...base,cursor:'pointer'}}>{cont}</button> : <div style={base}>{cont}</div>
}

// ─── Ventana emergente con las personas detrás de un número ────────────────────
function reporteTexto(spec) {
  const L = [spec.titulo, spec.subtitulo]
  const est = spec.estadoTxt || (spec.estado && EST[spec.estado] ? EST[spec.estado].l : null)
  if (est) L.push(`Estado: ${est}`)
  if (spec.resumen?.length) L.push(spec.resumen.map(r => `${r.l}: ${r.v}`).join(' · '))
  for (const p of spec.problemas || []) L.push(`• ${p.titulo} (${p.cuando}). ${p.porque || ''} Qué hacer: ${p.hacer}`.replace(/\s+/g, ' ').trim())
  if (spec.nota) L.push(spec.nota)
  for (const s of spec.secciones || []) {
    if (!s.filas.length && !s.siempre) continue
    L.push('', `${s.titulo} (${s.filas.length})`)
    if (!s.filas.length) L.push('- nadie')
    for (const f of s.filas) L.push(`- ${f.nombre}${f.rol ? ` (${f.rol})` : ''}${f.detalle ? `: ${f.detalle}` : ''}${f.tags?.length ? ` [${f.tags.join(', ')}]` : ''}`)
  }
  return L.join('\n')
}

function Popup({ spec, onCerrar, onPersona, onVolver }) {
  const cerrarRef = useRef(null)
  const [copiado, setCopiado] = useState(false)
  useEffect(() => {
    const tecla = e => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', tecla); cerrarRef.current?.focus()
    return () => window.removeEventListener('keydown', tecla)
  }, [onCerrar])
  async function copiar() {
    const txt = reporteTexto(spec)
    try { await navigator.clipboard.writeText(txt) }
    catch {
      try { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove() } catch { /* sin portapapeles */ }
    }
    setCopiado(true); setTimeout(() => setCopiado(false), 1800)
  }
  const est = spec.estado && EST[spec.estado]
  const secciones = (spec.secciones || []).filter(s => s.filas.length || s.siempre)
  return (
    <div className="mt-pop-fondo" onMouseDown={e => { if (e.target === e.currentTarget) onCerrar() }}>
      <div className="mt-pop" role="dialog" aria-modal="true" aria-label={spec.titulo}>
        <div style={{display:'flex',gap:10,alignItems:'flex-start',padding:'14px 16px 12px',borderBottom:'1px solid var(--border)',background: est ? est.suave : 'var(--bg-surface)'}}>
          <div style={{flex:1,minWidth:0}}>
            {onVolver && <button onClick={onVolver} style={{...lnk,color:'var(--accent)',fontSize:11.5,marginBottom:4}}>← Volver</button>}
            <div style={{fontSize:16,fontWeight:800,lineHeight:1.3}}>{spec.titulo}</div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>{spec.subtitulo}</div>
          </div>
          {est && <span style={{fontSize:11,fontWeight:800,padding:'3px 10px',borderRadius:100,background:est.bg,color:est.fg,whiteSpace:'nowrap'}}>{spec.estadoTxt || est.l}</span>}
          <button ref={cerrarRef} onClick={onCerrar} aria-label="Cerrar" style={{border:'none',background:'none',fontSize:18,lineHeight:1,cursor:'pointer',color:'var(--text-muted)',padding:2}}>✕</button>
        </div>
        <div className="mt-pop-cuerpo">
          {spec.resumen?.length > 0 && (
            <div style={{display:'grid',gridTemplateColumns:`repeat(${spec.resumen.length}, minmax(0,1fr))`,gap:8,marginBottom:12}}>
              {spec.resumen.map((r, i) => (
                <div key={i} style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:8,padding:'7px 10px'}}>
                  <div style={{fontSize:11,color:'var(--text-muted)',fontWeight:600}}>{r.l}</div>
                  <div style={{fontSize:19,fontWeight:800,color:r.c || 'var(--text)',fontVariantNumeric:'tabular-nums'}}>{r.v}</div>
                </div>
              ))}
            </div>
          )}
          {(spec.problemas || []).map((p, i) => {
            const st = EST[p.sev] || EST.media
            return (
              <div key={i} style={{borderLeft:`4px solid ${st.bg}`,background:st.suave,borderRadius:'0 8px 8px 0',padding:'8px 10px',marginBottom:8}}>
                <div style={{fontSize:12.5,fontWeight:800,color:'#101828'}}>{p.titulo} <span style={{fontWeight:600,color:'#475467'}}>· {p.cuando}</span></div>
                {p.porque && <div style={{fontSize:11.5,color:'#475467',marginTop:2}}>{p.porque}</div>}
                <div style={{fontSize:11.5,color:'#101828',marginTop:2}}><strong>Qué hacer:</strong> {p.hacer}</div>
              </div>
            )
          })}
          {spec.nota && <div style={{fontSize:12,color:'var(--text-muted)',margin:'2px 0 10px'}}>{spec.nota}</div>}
          {secciones.map((s, i) => (
            <div key={i} style={{marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:800,color:'var(--text)',margin:'4px 0 6px'}}>{s.titulo} <span style={{color:'var(--text-muted)',fontWeight:600}}>({s.filas.length})</span></div>
              {!s.filas.length && <div style={{fontSize:12,color:'var(--text-muted)',padding:'2px 0'}}>Nadie.</div>}
              <div style={{display:'grid',gap:4}}>
                {s.filas.map(f => {
                  const enlace = !f.sinEnlace && typeof f.cod === 'number'
                  return (
                    <div key={f.cod} className={enlace ? 'mt-pop-fila enl' : 'mt-pop-fila'} onClick={enlace ? () => onPersona(f.cod) : undefined}
                      title={enlace ? 'Ver su semana y su carga' : undefined}>
                      <span style={{width:9,height:9,borderRadius:3,background:f.color,marginTop:4,flexShrink:0}}/>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:12.5,fontWeight:700}}>{f.nombre}{f.rol && <span style={{fontWeight:500,color:'var(--text-muted)'}}> · {f.rol}</span>}
                          {(f.tags || []).map(t => <span key={t} style={tag('#B25E09')}>{t}</span>)}</div>
                        {f.detalle && <div style={{fontSize:11.5,color:'#475467'}}>{f.detalle}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',padding:'10px 16px',borderTop:'1px solid var(--border)'}}>
          <button onClick={copiar} style={btnSec}>{copiado ? 'Reporte copiado ✓' : 'Copiar reporte'}</button>
          <button onClick={onCerrar} style={btnPri}>Cerrar</button>
        </div>
      </div>
    </div>
  )
}

const MT_CSS = `
.mt-lectura { display:grid; grid-template-columns:minmax(0,1fr) 380px; }
.mt-lectura .mt-kpis { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:12px; border-left:1px solid var(--border); background:var(--bg-card); align-content:start; }
.mt-sem, .mt-car { width:100%; min-width:720px; table-layout:fixed; border-collapse:separate; border-spacing:2px; font-variant-numeric:tabular-nums; }
.mt-sem th, .mt-car th { font-weight:600; color:var(--text-muted); text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding:0 2px; }
.mt-sem thead th, .mt-car thead th { font-size:10.5px; height:16px; }
.mt-sem thead th.h, .mt-car thead th.h { border-left:1px solid var(--border); padding-left:4px; overflow:visible; text-overflow:clip; }
.mt-sem tbody th { font-size:12px; padding-right:8px; color:var(--text); }
.mt-sem td { height:30px; text-align:center; border-radius:4px; cursor:pointer; font-size:12px; font-weight:700; }
.mt-sem tbody tr:hover th { color:var(--accent); }
.mt-sem tr.sel th { color:var(--accent); font-weight:800; }
.mt-sem tr.sel td.in { box-shadow: inset 0 0 0 2px rgba(22,33,62,.55); }
.mt-dia { display:grid; grid-template-columns:minmax(0,1fr) 360px; min-height:360px; }
.mt-problemas { position:relative; border-left:1px solid var(--border); }
.mt-problemas > .scroll { position:absolute; inset:0; overflow-y:auto; }
.mt-car td { height:26px; text-align:center; border-radius:3px; font-size:11.5px; font-weight:700; }
.mt-car tbody th { font-size:12px; color:var(--text); padding-right:8px; }
.mt-car th.fam { font-size:11px; font-weight:800; color:var(--text-muted); padding-top:8px; }
.mt-car tr.tot th { font-weight:800; }
.mt-car td.clic, .mt-sem td.in, .mt-tabla td.clic { cursor:pointer; }
.mt-car td.clic:hover, .mt-sem td.in:hover { box-shadow: inset 0 0 0 2px #16213E; }
.mt-tabla td.clic:hover { background:var(--bg-app); text-decoration:underline; }
.mt-carga.clic { cursor:pointer; border-radius:8px; }
.mt-carga.clic:hover { background:var(--bg-app); }
.mt-barra { cursor:pointer; }
.mt-kpi:hover { border-color:#98A2B3 !important; }
.mt-pop-fondo { position:fixed; inset:0; background:rgba(16,24,40,.45); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px; }
.mt-pop { background:var(--bg-surface); border-radius:14px; width:min(640px, 100%); max-height:86vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 20px 50px rgba(16,24,40,.25); }
.mt-pop-cuerpo { padding:14px 16px; overflow-y:auto; }
.mt-pop-fila { display:flex; gap:8px; padding:6px 8px; border-radius:8px; border:1px solid var(--border); }
.mt-pop-fila.enl { cursor:pointer; }
.mt-pop-fila.enl:hover { background:var(--bg-app); }
.mt-fila { display:grid; grid-template-columns:230px minmax(0,1fr); gap:8px; align-items:center; margin:1px 0; }
.mt-barra { display:flex; align-items:center; overflow:hidden; }
.mt-carga { display:grid; grid-template-columns:240px minmax(0,1fr) 110px; gap:14px; align-items:center; padding:6px 0; border-bottom:1px solid var(--border); }
.mt-carga:last-child { border-bottom:none; }
.mt-tabla { width:100%; border-collapse:collapse; font-size:12px; font-variant-numeric:tabular-nums; }
.mt-tabla th { padding:7px 8px; font-size:10.5px; font-weight:700; color:var(--text-muted); text-align:center; border-bottom:1px solid var(--border); white-space:nowrap; }
.mt-tabla td { padding:5px 8px; text-align:center; border-bottom:1px solid var(--border); }
.mt-tabla td.grupo { text-align:left; font-size:10.5px; font-weight:800; color:var(--text-muted); background:var(--bg-app); padding:4px 8px; }
.mt-tabla tr.total td { font-weight:800; border-top:2px solid var(--border); }
@media (max-width:1000px) {
  .mt-dia, .mt-lectura { grid-template-columns:1fr; }
  .mt-problemas, .mt-lectura .mt-kpis { border-left:none; border-top:1px solid var(--border); }
  .mt-problemas > .scroll { position:static; max-height:520px; }
}
`

const card     = {background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12}
const cardHead = {display:'flex',alignItems:'baseline',gap:10,flexWrap:'wrap',padding:'10px 12px',borderBottom:'1px solid var(--border)'}
const inp      = {padding:'7px 9px',border:'1px solid var(--border)',borderRadius:8,fontSize:12.5,background:'var(--bg-surface)',color:'var(--text)',fontFamily:'inherit'}
const btnIcono = {width:28,height:26,border:'none',background:'none',cursor:'pointer',color:'var(--text)',fontSize:11,borderRadius:6}
const seg      = {padding:'5px 10px',borderRadius:6,border:'none',background:'transparent',color:'var(--text-muted)',fontSize:12,fontWeight:600,cursor:'pointer'}
const segOn    = {background:'var(--bg-app)',color:'var(--text)',boxShadow:'inset 0 0 0 1px var(--border)'}
const chip     = {padding:'5px 10px',borderRadius:100,border:'1px solid var(--border)',background:'var(--bg-surface)',color:'var(--text-muted)',fontSize:11.5,fontWeight:600,cursor:'pointer'}
const diaTab   = {display:'inline-flex',alignItems:'center',gap:6,padding:'5px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--bg-surface)',color:'var(--text)',fontSize:12,fontWeight:600,cursor:'pointer'}
const diaTabOn = {background:'#16213E',color:'#fff',border:'1px solid #16213E'}
const aviso    = {padding:'9px 14px',borderRadius:8,fontSize:12.5}
const btnPri   = {padding:'7px 13px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:12.5,fontWeight:600}
const btnSec   = {padding:'7px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:12.5,fontWeight:500}
const lnk      = {background:'none',border:'none',padding:0,cursor:'pointer',fontSize:12,fontWeight:700}
const tag      = c => ({marginLeft:6,fontSize:9,fontWeight:800,padding:'1px 6px',borderRadius:100,background:`${c}18`,color:c,whiteSpace:'nowrap'})
