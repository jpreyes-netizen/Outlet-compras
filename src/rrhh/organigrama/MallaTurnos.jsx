// src/rrhh/organigrama/MallaTurnos.jsx  (v1 — 20-oct-2026)
// Malla de turnos y cobertura por rol — Personas › Estructura
//
// Responde: ¿cuántas personas de cada rol hay en cada franja, dónde queda débil la
// malla y quién está sobrecargado?
//   · Turnos: fn_org_malla → turno publicado en Workera (con corrección aprobada). Si la
//     semana de una persona no está publicada se proyecta con su semana de hace 2
//     semanas (respeta la rotación T2/T3) y se dibuja rayado.
//   · Rol: el cargo principal de cada persona en el organigrama (org_roles).
//   · Colación: 60 min en turnos de más de 6 h, a la hora habitual de cada persona
//     (mediana de sus marcas). Se puede ver con o sin descontarla.
//   · Novedades (licencia, vacaciones, permiso) descuentan cobertura con "Solo disponibles".
//   · Plantilla requerida: org_cobertura_minima (mínimo por rol, tipo de día y franja).
//   · Carga real: fn_org_carga sobre las marcas de las últimas 4 semanas.
// Las debilidades se calculan siempre sobre la cobertura real (con colación y sin
// ausentes); los interruptores solo cambian lo que se dibuja.

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { supabase } from '../../supabase'
import { DataGrid } from '../../finanzas/conciliacion/DataGrid'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
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

const FAM = { comercial:'Comercial', operaciones:'Operaciones', administracion:'Administración', marketing:'Marketing', direccion:'Dirección', externo:'Externos' }
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
const SEV = { alta:{ l:'Crítica', c:'#B42318', bg:'#FEF3F2' }, media:{ l:'Atención', c:'#B25E09', bg:'#FFFAEB' }, info:{ l:'Info', c:'#475467', bg:'#F2F4F7' } }

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

export function MallaTurnos({ cu }) {
  const [sucs, setSucs]           = useState([])
  const [roles, setRoles]         = useState([])
  const [suc, setSuc]             = useState(() => { try { return localStorage.getItem('malla_suc') || 'suc-lg' } catch { return 'suc-lg' } })
  const [lunes, setLunes]         = useState(() => lunesDe(hoyISO()))
  const [familia, setFamilia]     = useState('todas')
  const [rolFiltro, setRolFiltro] = useState(null)
  const [diaSel, setDiaSel]       = useState(() => (new Date().getDay() + 6) % 7)
  const [conColacion, setConCol]  = useState(true)
  const [soloDisp, setSoloDisp]   = useState(true)
  const [filas, setFilas]         = useState([])
  const [carga, setCarga]         = useState({})
  const [minimos, setMinimos]     = useState([])
  const [jornadaLegal, setJornada] = useState(42)
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [cargando, setCargando]   = useState(true)
  const [err, setErr]             = useState(null)
  const [verMinimos, setVerMinimos] = useState(false)

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

  // Eje horario: de la primera entrada a la última salida de la semana (08:00–21:00 si no hay datos)
  const { t0, t1, slots } = useMemo(() => {
    let a = Infinity, b = -Infinity
    for (const f of turnos) { a = Math.min(a, f._e); b = Math.max(b, f._s) }
    if (!Number.isFinite(a)) { a = 8 * 60; b = 21 * 60 }
    a = Math.floor(a / 60) * 60; b = Math.ceil(b / 60) * 60
    const s = []; for (let t = a; t < b; t += SLOT) s.push(t)
    return { t0: a, t1: b, slots: s }
  }, [turnos])

  const covReal   = useMemo(() => calcCobertura(turnos, fechas, slots, { colacion: true,  disponibles: true }),  [turnos, fechas, slots])
  const covSinCol = useMemo(() => calcCobertura(turnos, fechas, slots, { colacion: false, disponibles: true }),  [turnos, fechas, slots])
  const covPlan   = useMemo(() => calcCobertura(turnos, fechas, slots, { colacion: false, disponibles: false }), [turnos, fechas, slots])
  const covVista  = useMemo(() => (conColacion && soloDisp) ? covReal : (!conColacion && soloDisp) ? covSinCol
    : calcCobertura(turnos, fechas, slots, { colacion: conColacion, disponibles: soloDisp }), [conColacion, soloDisp, covReal, covSinCol, turnos, fechas, slots])

  const rolesSuc = useMemo(() => [...new Set(turnos.map(f => f.rol_codigo || '_sincargo'))].sort((a, b) => ordenRol(a) - ordenRol(b)), [turnos, ordenRol])

  // Ventana de operación por día y familia: de la primera entrada a la última salida
  const ventanaDia = useMemo(() => fechas.map(fe => {
    const w = {}
    for (const f of turnos) if (f.fecha === fe && f.familia) {
      const x = w[f.familia] || (w[f.familia] = [Infinity, -Infinity])
      x[0] = Math.min(x[0], f._e); x[1] = Math.max(x[1], f._s)
    }
    return w
  }), [fechas, turnos])

  const minsSuc = useMemo(() => minimos.filter(m => m.sucursal_id === suc && (familia === 'todas' || rolPorCod[m.rol_codigo]?.familia === familia)), [minimos, suc, familia, rolPorCod])
  const requerido = useCallback((d, s, rol) => {
    let v = 0
    for (const mn of minsSuc) if (mn.rol_codigo === rol && mn.dia_tipo === diaTipo(d) && s >= aMin(mn.hora_desde) && s < aMin(mn.hora_hasta)) v = Math.max(v, mn.minimo)
    return v
  }, [minsSuc])

  // ── Debilidades ──
  const debilidades = useMemo(() => {
    const crudo = []
    const personasRolDia = (d, rol) => new Set(turnos.filter(f => f.fecha === fechas[d] && (f.rol_codigo || '_sincargo') === rol).map(f => f.cod_contaline)).size
    for (let d = 0; d < 7; d++) {
      const dt = diaTipo(d), cov = covReal[d], sin = covSinCol[d]
      if (!cov || !turnos.some(f => f.fecha === fechas[d])) continue
      // 1) Bajo el mínimo definido
      for (const mn of minsSuc.filter(x => x.dia_tipo === dt)) {
        const a = aMin(mn.hora_desde), b = aMin(mn.hora_hasta)
        for (const [x, y] of tramos(slots, (s, i) => s >= a && s < b && (cov[i].porRol[mn.rol_codigo] || 0) < mn.minimo)) {
          let peor = Infinity; slots.forEach((s, i) => { if (s >= x && s < y) peor = Math.min(peor, cov[i].porRol[mn.rol_codigo] || 0) })
          crudo.push({ sev:'alta', k:`min|${mn.rol_codigo}`, rol: mn.rol_codigo, titulo:`${rolNombre(mn.rol_codigo)}: bajo el mínimo`, detalle:`mínimo ${mn.minimo}, llega a ${peor}`, d, x, y })
        }
      }
      // 2) Sin responsable a cargo (ni jefatura ni coordinación de la familia presente)
      for (const [fam, [w0, w1]] of Object.entries(ventanaDia[d])) {
        if (fam !== 'comercial' && fam !== 'operaciones') continue
        // la sucursal tiene jefatura de esta área en la semana (si no la tiene, es un tema de estructura, no de malla)
        if (!turnos.some(f => f.familia === fam && f.es_jefatura)) continue
        for (const [x, y] of tramos(slots, (s, i) => s >= w0 && s < w1 && !(cov[i].jefFam[fam] > 0)))
          crudo.push({ sev:'alta', k:`resp|${fam}`, titulo:`Sin responsable ${fam === 'comercial' ? 'comercial' : 'de bodega'} a cargo`, detalle:'ninguna jefatura ni coordinación presente (incluye colaciones)', d, x, y })
      }
      // 3-5) Por rol operativo (no jefaturas)
      for (const rol of rolesSuc) {
        const r = rolPorCod[rol]
        if (rol === '_sincargo' || !r || r.es_jefatura || !r.opera_en_turno) continue
        const fam = r.familia, w = ventanaDia[d][fam]
        const n = personasRolDia(d, rol)
        if (!n || !w) continue
        const conMin = s => minsSuc.some(mn => mn.rol_codigo === rol && mn.dia_tipo === dt && s >= aMin(mn.hora_desde) && s < aMin(mn.hora_hasta))
        // hueco por colación: con la gente del turno hay alguien, pero la colación deja a cero
        const huecos = tramos(slots, (s, i) => s >= w[0] && s < w[1] && (sin[i].porRol[rol] || 0) > 0 && !(cov[i].porRol[rol] > 0) && !conMin(s))
        for (const [x, y] of huecos)
          crudo.push({ sev:'media', k:`col|${rol}`, rol, titulo:`${r.nombre}: hueco por colación`, detalle: n === 1 ? 'una sola persona en el rol: nadie la cubre en su colación' : 'las colaciones coinciden: escalonarlas', d, x, y })
        if (n >= 2) {
          for (const [x, y] of tramos(slots, (s, i) => s >= w[0] && s < w[1] && !(sin[i].porRol[rol] > 0) && !conMin(s)))
            if (y - x >= 30) crudo.push({ sev:'media', k:`sin|${rol}`, rol, titulo:`Sin ${r.nombre.toLowerCase()}`, detalle:`${n} personas del rol ese día y ninguna en la franja`, d, x, y })
          for (const [x, y] of tramos(slots, (s, i) => s >= w[0] && s < w[1] && cov[i].porRol[rol] === 1))
            if (y - x >= 60) crudo.push({ sev:'media', k:`una|${rol}`, rol, titulo:`${r.nombre}: una sola persona`, detalle:'si se ausenta, la franja queda sin cobertura', d, x, y })
        }
      }
    }
    // Agrupar la misma debilidad en el mismo horario a través de los días
    const g = {}
    for (const c of crudo) {
      const key = `${c.k}|${c.x}|${c.y}|${c.detalle}`
      ;(g[key] = g[key] || { ...c, dias: [] }).dias.push(c.d)
    }
    const peso = { alta: 0, media: 1, info: 2 }
    return Object.values(g).sort((a, b) => peso[a.sev] - peso[b.sev] || b.dias.length - a.dias.length || a.x - b.x)
  }, [covReal, covSinCol, turnos, fechas, slots, minsSuc, ventanaDia, rolesSuc, rolPorCod, rolNombre])

  const marcasCriticas = useMemo(() => {
    const m = new Set()
    for (const w of debilidades) if (w.sev === 'alta') for (const d of w.dias) slots.forEach((s, i) => { if (s >= w.x && s < w.y) m.add(`${d}|${i}`) })
    return m
  }, [debilidades, slots])

  // ── Carga por persona ──
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
      return { ...p, horas: Math.round(p.horas * 10) / 10, turnosTxt: Object.entries(p.turnos).map(([t, n]) => `${t}×${n}`).join(' · '),
        novTxt: [...p.novedades].join(', '), c, extraMin: c?.min_extra || 0, sobreJornada: p.horas > jornadaLegal + 0.01 }
    }).sort((a, b) => b.extraMin - a.extraMin || b.horas - a.horas)
  }, [delSuc, covReal, carga, jornadaLegal, rolPorCod])

  // ── Plantilla turno × rol (personas promedio por día en que se usa ese turno) ──
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

  const kpi = useMemo(() => {
    const conTurno = personas.filter(p => p.dias > 0)
    const filasTurno = turnos.length, proy = turnos.filter(f => f.fuente === 'proyectado').length
    return {
      personas: conTurno.length, sinTurno: personas.filter(p => p.sinTurno).length,
      horas: Math.round(conTurno.reduce((s, p) => s + p.horas, 0)),
      proyPct: filasTurno ? Math.round(100 * proy / filasTurno) : 0,
      criticas: debilidades.filter(w => w.sev === 'alta').length,
      atencion: debilidades.filter(w => w.sev === 'media').length,
      sobreJornada: personas.filter(p => p.sobreJornada).length,
      extraMin: personas.reduce((s, p) => s + p.extraMin, 0),
      top: personas[0]?.extraMin ? personas[0] : null,
    }
  }, [personas, turnos, debilidades])

  const hoy = hoyISO()
  const ahoraMin = fechas[diaSel] === hoy ? (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })() : null

  // ── Mínimos: propuesta base desde la ventana de operación de la semana ──
  async function proponerMinimos() {
    const ventana = {}   // dt|fam → [min, max]
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

  const diaSemanaLabel = d => `${DIAS[d]} ${fDia(fechas[d])}`
  const sinDatos = !cargando && !err && turnos.length === 0

  return (
    <div style={{display:'grid',gap:12}}>
      <style>{MT_CSS}</style>

      {/* Controles */}
      <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
        <select value={suc} onChange={e=>{ setSuc(e.target.value); setRolFiltro(null) }} aria-label="Sucursal" style={inp}>
          {sucsConGente.map(id => <option key={id} value={id}>{sucNombre(id)}</option>)}
        </select>
        <div style={{display:'flex',alignItems:'center',gap:2,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:8,padding:2}}>
          <button onClick={()=>setLunes(l => sumarDias(l, -7))} aria-label="Semana anterior" style={btnIcono}>◀</button>
          <span style={{fontSize:12.5,fontWeight:700,padding:'0 8px',whiteSpace:'nowrap'}}>Semana del {fRango(fechas[0], fechas[6])}</span>
          <button onClick={()=>setLunes(l => sumarDias(l, 7))} aria-label="Semana siguiente" style={btnIcono}>▶</button>
        </div>
        {lunes !== lunesDe(hoy) && <button onClick={()=>{ setLunes(lunesDe(hoy)); setDiaSel((new Date().getDay() + 6) % 7) }} style={chip}>Esta semana</button>}
        <div role="radiogroup" aria-label="Área" style={{display:'flex',gap:2,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:8,padding:2}}>
          {['todas', ...['comercial','operaciones','administracion'].filter(f => familiasSuc.includes(f))].map(f => (
            <button key={f} role="radio" aria-checked={familia===f} onClick={()=>{ setFamilia(f); setRolFiltro(null) }}
              style={{...seg, ...(familia===f ? segOn : {})}}>{f === 'todas' ? 'Todas las áreas' : FAM[f]}</button>
          ))}
        </div>
        <label style={chk}><input type="checkbox" checked={conColacion} onChange={e=>setConCol(e.target.checked)}/> Descontar colación</label>
        <label style={chk}><input type="checkbox" checked={soloDisp} onChange={e=>setSoloDisp(e.target.checked)}/> Solo disponibles</label>
        <span style={{marginLeft:'auto',fontSize:11,color:'var(--text-muted)'}}>Turnos de Workera · rayado = proyectado</span>
      </div>

      {err && <div style={{...aviso,background:'#FEF3F2',borderColor:'#FDA29B',color:'#912018'}}>⚠️ {err}</div>}
      {cargando && <div style={{padding:50,textAlign:'center',color:'var(--text-muted)'}}>Cargando malla…</div>}
      {sinDatos && <div style={{...card,padding:'30px 24px',textAlign:'center',color:'var(--text-muted)'}}>No hay turnos de {sucNombre(suc)}{familia !== 'todas' ? ` (${FAM[familia]})` : ''} en la semana del {fRango(fechas[0], fechas[6])}.</div>}

      {!cargando && !sinDatos && !err && (<>
        {/* KPIs */}
        <div className="mt-kpis">
          <Kpi l="Personas en la malla" v={kpi.personas} sub={kpi.sinTurno ? `${kpi.sinTurno} sin turno ni patrón` : 'todas con turno'} c={kpi.sinTurno ? '#B25E09' : undefined}/>
          <Kpi l="Horas planificadas" v={kpi.horas} sub="netas de colación, semana"/>
          <Kpi l="Turnos proyectados" v={`${kpi.proyPct}%`} sub="sin publicar en Workera" c={kpi.proyPct ? '#B25E09' : undefined}/>
          <Kpi l="Debilidades críticas" v={kpi.criticas} sub={`${kpi.atencion} de atención`} c={kpi.criticas ? '#B42318' : undefined}/>
          <Kpi l={`Sobre ${jornadaLegal} h semanales`} v={kpi.sobreJornada} sub="horas planificadas" c={kpi.sobreJornada ? '#B42318' : undefined}/>
          <Kpi l="Horas extra 4 semanas" v={horasDe(kpi.extraMin)} sub={kpi.top ? `más alta: ${kpi.top.nombre.split(' ').slice(0, 2).join(' ')} (${horasDe(kpi.top.extraMin)} h)` : 'según marcas'} c={kpi.extraMin >= 960 ? '#B25E09' : undefined}/>
        </div>

        {/* Mapa de calor de la semana */}
        <div style={{...card,padding:0,overflow:'hidden'}}>
          <div style={cardHead}>
            <span style={{fontSize:13,fontWeight:700}}>Cobertura de la semana</span>
            <span style={{fontSize:11,color:'var(--text-muted)'}}>personas presentes cada media hora · borde rojo = debilidad crítica · clic en un día para verlo abajo</span>
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,padding:'8px 12px 0'}}>
            <button onClick={()=>setRolFiltro(null)} aria-pressed={!rolFiltro} style={{...chip, ...(!rolFiltro ? chipOn : {})}}>Todos los roles</button>
            {rolesSuc.map(r => (
              <button key={r} onClick={()=>setRolFiltro(f => f === r ? null : r)} aria-pressed={rolFiltro === r}
                style={{...chip, ...(rolFiltro === r ? chipOn : {}), display:'inline-flex', alignItems:'center', gap:6}}>
                <span style={{width:9,height:9,borderRadius:3,background:colorRol(r)}}/>{rolNombre(r)}
              </button>
            ))}
          </div>
          <Mapa fechas={fechas} slots={slots} cov={covVista} rolFiltro={rolFiltro} marcas={marcasCriticas} diaSel={diaSel}
            onDia={setDiaSel} etiquetaDia={diaSemanaLabel} rolNombre={rolNombre} turnos={turnos}/>
        </div>

        {/* Día seleccionado: curva por rol + debilidades */}
        <div className="mt-grid">
          <div style={{...card,padding:0,overflow:'hidden'}}>
            <div style={cardHead}>
              <span style={{fontSize:13,fontWeight:700,textTransform:'capitalize'}}>{['lunes','martes','miércoles','jueves','viernes','sábado','domingo'][diaSel]} {fDia(fechas[diaSel])}</span>
              <Resumen cov={covVista[diaSel]} slots={slots} rolFiltro={rolFiltro}/>
            </div>
            <Curva slots={slots} cov={covVista[diaSel]} plan={covPlan[diaSel]} roles={rolesSuc} rolFiltro={rolFiltro}
              req={rolFiltro && minsSuc.some(m => m.rol_codigo === rolFiltro) ? slots.map(s => requerido(diaSel, s, rolFiltro)) : null}
              rolNombre={rolNombre} ahora={ahoraMin}/>
            <div style={{display:'flex',flexWrap:'wrap',gap:'4px 12px',padding:'0 12px 10px',fontSize:11,color:'var(--text-muted)'}}>
              {(rolFiltro ? [rolFiltro] : rolesSuc).map(r => <span key={r} style={{display:'inline-flex',alignItems:'center',gap:5}}><span style={{width:10,height:10,borderRadius:2,background:colorRol(r)}}/>{rolNombre(r)}</span>)}
              <span style={{display:'inline-flex',alignItems:'center',gap:5}}><span style={{width:14,borderTop:'2px dashed #16213E'}}/>planificado sin colación ni ausencias</span>
              {rolFiltro && minsSuc.some(m => m.rol_codigo === rolFiltro) && <span style={{display:'inline-flex',alignItems:'center',gap:5}}><span style={{width:14,borderTop:'2px dashed #B42318'}}/>mínimo requerido</span>}
            </div>
          </div>
          <Debilidades lista={debilidades} onDia={setDiaSel}/>
        </div>

        {/* Malla del día */}
        <div style={{...card,padding:0,overflow:'hidden'}}>
          <div style={cardHead}>
            <span style={{fontSize:13,fontWeight:700}}>Malla del {DIAS[diaSel].toLowerCase()} {fDia(fechas[diaSel])}</span>
            <span style={{fontSize:11,color:'var(--text-muted)'}}>una barra por persona · tramo claro = colación habitual · rayado = turno proyectado · gris = con novedad</span>
          </div>
          <MallaDia filas={delSuc.filter(f => f.fecha === fechas[diaSel])} t0={t0} t1={t1} rolNombre={rolNombre} ordenRol={ordenRol} ahora={ahoraMin}/>
        </div>

        {/* Plantilla turno × rol */}
        <div style={{...card,padding:0,overflow:'hidden'}}>
          <div style={cardHead}>
            <span style={{fontSize:13,fontWeight:700}}>Plantilla por turno y rol</span>
            <span style={{fontSize:11,color:'var(--text-muted)'}}>personas por día en que se usa cada turno · semana del {fRango(fechas[0], fechas[6])}</span>
          </div>
          <Plantilla filas={plantilla} roles={rolesSuc} rolNombre={rolNombre}/>
        </div>

        {/* Mínimos de cobertura */}
        <div style={{...card,padding:0,overflow:'hidden'}}>
          <button onClick={()=>setVerMinimos(v=>!v)} aria-expanded={verMinimos}
            style={{...cardHead,width:'100%',background:'none',borderTop:'none',borderLeft:'none',borderRight:'none',borderBottom:verMinimos?'1px solid var(--border)':'none',cursor:'pointer',textAlign:'left',color:'var(--text)'}}>
            <span style={{fontSize:13,fontWeight:700}}>Plantilla requerida: mínimos de cobertura ({minsSuc.length})</span>
            <span style={{fontSize:11,color:'var(--text-muted)'}}>{minsSuc.length ? 'se comparan contra la cobertura real en las debilidades' : 'sin mínimos definidos: las debilidades usan solo reglas generales'}</span>
            <span style={{marginLeft:'auto',fontSize:12,color:'var(--text-muted)'}}>{verMinimos ? '▴' : '▾'}</span>
          </button>
          {verMinimos && <Minimos suc={suc} lista={minsSuc} roles={roles} rolesSuc={rolesSuc} puedeEditar={puedeEditar} cu={cu}
            onCambio={cargarSemana} onProponer={proponerMinimos}/>}
        </div>

        {/* Carga por persona */}
        <div style={{height:'min(560px, 75vh)'}}>
          <DataGrid title="Carga y sobrecarga por persona" exportName={`malla_carga_${suc}_${lunes}`}
            rows={personas} getRowId={p => p.cod} emptyText="Sin personas"
            columns={[
              { key:'nombre', label:'Trabajador', width:220, render: p => <span><strong>{p.nombre}</strong>{p.proyectado && <span style={tag('#B25E09')}>proyectado</span>}{p.sinTurno && <span style={tag('#B42318')}>sin turno</span>}</span> },
              { key:'rol', label:'Rol', width:150, value: p => rolNombre(p.rol) },
              { key:'turnosTxt', label:'Turnos de la semana', width:160 },
              { key:'horas', label:'Horas plan.', width:85, align:'right', render: p => <span style={{fontWeight:700,color:p.sobreJornada?'#B42318':'inherit'}}>{n1(p.horas)}</span> },
              { key:'dias', label:'Días', width:55, align:'right' },
              { key:'extraMin', label:'H. extra 4 sem', width:100, align:'right', value: p => Math.round(p.extraMin / 6) / 10,
                render: p => <span style={{fontWeight:700,color:p.extraMin >= 960 ? '#B42318' : p.extraMin >= 480 ? '#B25E09' : 'inherit'}}>{horasDe(p.extraMin)}</span> },
              { key:'dce', label:'Días con extra', width:95, align:'right', value: p => p.c?.dias_con_extra ?? 0 },
              { key:'maxx', label:'Máx. extra/día', width:100, align:'right', value: p => Math.round((p.c?.max_extra_dia || 0) / 6) / 10,
                render: p => <span style={{color:(p.c?.max_extra_dia || 0) > 120 ? '#B42318' : 'inherit',fontWeight:(p.c?.max_extra_dia || 0) > 120 ? 700 : 400}}>{horasDe(p.c?.max_extra_dia || 0)}</span> },
              { key:'d10', label:'Días > 10 h', width:85, align:'right', value: p => p.c?.dias_sobre_10h ?? 0,
                render: p => <span style={{color:(p.c?.dias_sobre_10h || 0) >= 4 ? '#B25E09' : 'inherit',fontWeight:(p.c?.dias_sobre_10h || 0) >= 4 ? 700 : 400}}>{p.c?.dias_sobre_10h ?? 0}</span> },
              { key:'unica', label:'Única de su rol', width:105, align:'right', value: p => Math.round(p.unicaMin / 6) / 10, render: p => p.unicaMin ? `${horasDe(p.unicaMin)} h` : '—' },
              { key:'acumula', label:'Acumula cargos', width:180 },
              { key:'novTxt', label:'Novedad', width:120 },
            ]}/>
        </div>
        <div style={{fontSize:11,color:'var(--text-muted)',lineHeight:1.5}}>
          Horas planificadas: suma de los turnos de la semana menos 60 min de colación en turnos de más de 6 h, comparada con la jornada legal de {jornadaLegal} h.
          Horas extra, días con extra y días de más de 10 h de presencia: marcas reales de las últimas 4 semanas. Máx. extra/día en rojo: superó las 2 horas diarias.
          Única de su rol: horas de la semana en que es la única persona de su rol presente.
        </div>
      </>)}
    </div>
  )
}

// ─── Mapa de calor día × media hora ───────────────────────────────────────────
function Mapa({ fechas, slots, cov, rolFiltro, marcas, diaSel, onDia, etiquetaDia, rolNombre, turnos }) {
  const conTurno = new Set(turnos.map(f => f.fecha))
  const dias = fechas.map((fe, d) => ({ fe, d })).filter(x => x.d < 6 || conTurno.has(x.fe))
  const valor = c => rolFiltro ? (c.porRol[rolFiltro] || 0) : c.total
  let max = 1
  for (const { d } of dias) for (const c of cov[d]) max = Math.max(max, valor(c))
  return (
    <div style={{overflowX:'auto',padding:'8px 12px 12px'}}>
      <table className="mt-mapa">
        <thead>
          <tr>
            <th/>
            {slots.map(s => <th key={s} className={s % 60 === 0 ? 'hora' : ''}>{s % 60 === 0 ? hhmm(s).slice(0, 2) : ''}</th>)}
          </tr>
        </thead>
        <tbody>
          {dias.map(({ fe, d }) => (
            <tr key={fe} className={d === diaSel ? 'sel' : ''} onClick={()=>onDia(d)}>
              <th scope="row">{etiquetaDia(d)}</th>
              {cov[d].map((c, i) => {
                const v = valor(c), a = v ? 0.14 + 0.86 * Math.min(1, v / max) : 0
                const det = Object.entries(c.porRol).sort((x, y) => y[1] - x[1]).map(([r, n]) => `${rolNombre(r)} ${n}`).join(' · ')
                return (
                  <td key={i} title={`${etiquetaDia(d)} ${hhmm(slots[i])}–${hhmm(slots[i] + SLOT)} · ${v} persona(s)${det && !rolFiltro ? `: ${det}` : ''}`}
                    style={{background: v ? `rgba(22,33,62,${a.toFixed(2)})` : 'transparent', color: a > 0.55 ? '#fff' : 'var(--text)',
                      boxShadow: marcas.has(`${d}|${i}`) ? 'inset 0 0 0 2px #D92D20' : undefined}}>
                    {v || ''}
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

// ─── Curva del día: personas por rol apiladas ─────────────────────────────────
function Curva({ slots, cov, plan, roles, rolFiltro, req, rolNombre, ahora }) {
  const W = 960, H = 230, ml = 30, mr = 10, mt = 12, mb = 24
  const n = slots.length
  const x = i => ml + (i / n) * (W - ml - mr)
  const capasRol = rolFiltro ? [rolFiltro] : roles
  const tot = cov.map(c => capasRol.reduce((s, r) => s + (c.porRol[r] || 0), 0))
  const totPlan = plan.map(c => capasRol.reduce((s, r) => s + (c.porRol[r] || 0), 0))
  const max = Math.max(3, ...tot, ...totPlan, ...(req || [0]))
  const y = v => mt + (H - mt - mb) * (1 - v / max)
  const escalon = vals => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)} L${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const capas = []
  let base = new Array(n).fill(0)
  for (const r of capasRol) {
    const vals = cov.map(c => c.porRol[r] || 0)
    if (!vals.some(Boolean)) continue
    const top = base.map((b, i) => b + vals[i])
    let d = escalon(top)
    for (let i = n - 1; i >= 0; i--) d += ` L${x(i + 1).toFixed(1)},${y(base[i]).toFixed(1)} L${x(i).toFixed(1)},${y(base[i]).toFixed(1)}`
    capas.push({ r, d: `${d} Z` }); base = top
  }
  const ticks = [...new Set([0, Math.round(max / 2), max])]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Personas presentes por rol a lo largo del día" style={{width:'100%',height:'auto',display:'block'}}>
      {ticks.map(t => (
        <g key={t}>
          <line x1={ml} x2={W - mr} y1={y(t)} y2={y(t)} stroke="#E5E7EB" strokeWidth="1"/>
          <text x={ml - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#6E6E73">{t}</text>
        </g>
      ))}
      {slots.map((s, i) => s % 60 === 0 && (
        <g key={s}>
          <line x1={x(i)} x2={x(i)} y1={mt} y2={H - mb} stroke="#F1F2F4" strokeWidth="1"/>
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6E6E73">{hhmm(s).slice(0, 2)}</text>
        </g>
      ))}
      {capas.map(c => <path key={c.r} d={c.d} fill={colorRol(c.r)} fillOpacity="0.88" stroke="#fff" strokeWidth="0.6"/>)}
      <path d={escalon(totPlan)} fill="none" stroke="#16213E" strokeWidth="1.6" strokeDasharray="5 4"/>
      {req && <path d={escalon(req)} fill="none" stroke="#B42318" strokeWidth="2" strokeDasharray="6 4"/>}
      {ahora != null && ahora >= slots[0] && ahora < slots[n - 1] + SLOT && (
        <g>
          <line x1={x((ahora - slots[0]) / SLOT)} x2={x((ahora - slots[0]) / SLOT)} y1={mt} y2={H - mb} stroke="#D92D20" strokeWidth="1.5"/>
          <text x={x((ahora - slots[0]) / SLOT) + 4} y={mt + 10} fontSize="10" fill="#D92D20">ahora</text>
        </g>
      )}
      {slots.map((s, i) => (
        <rect key={s} x={x(i)} y={mt} width={x(i + 1) - x(i)} height={H - mt - mb} fill="transparent">
          <title>{`${hhmm(s)}–${hhmm(s + SLOT)} · ${tot[i]} presente(s) de ${totPlan[i]} planificado(s)${capasRol.map(r => cov[i].porRol[r] ? ` · ${rolNombre(r)} ${cov[i].porRol[r]}` : '').join('')}${req ? ` · mínimo ${req[i]}` : ''}`}</title>
        </rect>
      ))}
    </svg>
  )
}

function Resumen({ cov, slots, rolFiltro }) {
  const val = c => rolFiltro ? (c.porRol[rolFiltro] || 0) : c.total
  const activos = cov.map((c, i) => ({ v: val(c), i })).filter(o => o.v > 0)
  if (!activos.length) return <span style={{fontSize:11,color:'var(--text-muted)'}}>sin personas este día</span>
  const max = Math.max(...activos.map(o => o.v)), min = Math.min(...activos.map(o => o.v))
  const tramo = v => { const t = tramos(slots, (s, i) => val(cov[i]) === v)[0]; return t ? `${hhmm(t[0])}–${hhmm(t[1])}` : '' }
  return (
    <span style={{fontSize:11,color:'var(--text-muted)'}}>
      máximo <strong style={{color:'var(--text)'}}>{max}</strong> ({tramo(max)}) · mínimo <strong style={{color: min <= 1 ? '#B42318' : 'var(--text)'}}>{min}</strong> ({tramo(min)})
    </span>
  )
}

// ─── Lista de debilidades ─────────────────────────────────────────────────────
function Debilidades({ lista, onDia }) {
  const [todas, setTodas] = useState(false)
  const vis = todas ? lista : lista.slice(0, 12)
  return (
    <div style={{...card,padding:0,overflow:'hidden'}}>
      <div style={cardHead}><span style={{fontSize:13,fontWeight:700}}>Debilidades de la malla</span>
        <span style={{fontSize:11,color:'var(--text-muted)'}}>cobertura real: con colación y sin ausentes</span></div>
      {!lista.length && <div style={{padding:'14px 12px',fontSize:12.5,color:'var(--text-muted)'}}>Sin debilidades con las reglas actuales. Define mínimos para exigir más.</div>}
      <div style={{maxHeight:420,overflowY:'auto'}}>
        {vis.map((w, i) => (
          <button key={i} onClick={()=>onDia(w.dias[0])} title="Ver el día"
            style={{display:'flex',gap:10,width:'100%',textAlign:'left',padding:'8px 12px',border:'none',borderTop:'1px solid var(--border)',background:'none',cursor:'pointer',color:'var(--text)'}}>
            <span style={{width:4,borderRadius:4,background:SEV[w.sev].c,flexShrink:0}}/>
            <span style={{flex:1,minWidth:0}}>
              <span style={{display:'block',fontSize:12.5,fontWeight:700}}>{w.titulo}</span>
              <span style={{display:'block',fontSize:11.5,color:'var(--text-muted)'}}><strong style={{color:'var(--text)'}}>{diasTexto(w.dias)} {hhmm(w.x)}–{hhmm(w.y)}</strong> · {w.detalle}</span>
            </span>
            <span style={{fontSize:10,fontWeight:800,color:SEV[w.sev].c,whiteSpace:'nowrap'}}>{SEV[w.sev].l}</span>
          </button>
        ))}
      </div>
      {lista.length > 12 && <button onClick={()=>setTodas(t=>!t)} style={{width:'100%',padding:'7px',border:'none',borderTop:'1px solid var(--border)',background:'var(--bg-app)',cursor:'pointer',fontSize:12,fontWeight:600,color:'var(--accent)'}}>
        {todas ? 'Ver menos' : `Ver las ${lista.length}`}</button>}
    </div>
  )
}

// ─── Malla del día: barras por persona ────────────────────────────────────────
function MallaDia({ filas, t0, t1, rolNombre, ordenRol, ahora }) {
  const span = t1 - t0, horas = span / 60
  const pct = m => `${((m - t0) / span) * 100}%`
  const conTurno = filas.filter(f => f.entrada && f.salida)
  const grupos = {}
  for (const f of conTurno) (grupos[f.rol_codigo || '_sincargo'] = grupos[f.rol_codigo || '_sincargo'] || []).push(f)
  const orden = Object.keys(grupos).sort((a, b) => ordenRol(a) - ordenRol(b))
  const descanso = filas.filter(f => f.fuente === 'descanso' || f.fuente === 'feriado')
  const sinTurno = filas.filter(f => f.fuente === 'sin_turno')
  const fondo = { backgroundImage:'linear-gradient(to right, var(--border) 1px, transparent 1px)', backgroundSize:`calc(100% / ${horas}) 100%` }
  return (
    <div style={{padding:'8px 12px 12px',overflowX:'auto'}}>
      <div style={{minWidth:760}}>
        <div className="mt-fila" style={{height:18}}>
          <div/>
          <div style={{position:'relative',fontSize:10,color:'var(--text-muted)'}}>
            {Array.from({ length: horas + 1 }, (_, i) => t0 + i * 60).map(m => (
              <span key={m} style={{position:'absolute',left:pct(m),transform:'translateX(-50%)'}}>{hhmm(m).slice(0, 2)}</span>
            ))}
          </div>
        </div>
        {!conTurno.length && <div style={{fontSize:12.5,color:'var(--text-muted)',padding:'8px 0'}}>Nadie con turno este día.</div>}
        {orden.map(r => (
          <Fragment key={r}>
            <div style={{fontSize:10.5,fontWeight:800,color:colorRol(r),margin:'8px 0 2px'}}>{rolNombre(r)} · {grupos[r].length}</div>
            {grupos[r].sort((a, b) => aMin(a.entrada) - aMin(b.entrada) || a.nombre.localeCompare(b.nombre)).map(f => {
              const e = aMin(f.entrada), s = aMin(f.salida), ci = f.colacion_min > 0 && f.colacion_inicio ? aMin(f.colacion_inicio) : null
              const col = colorRol(r), nov = !!f.novedad, proy = f.fuente === 'proyectado'
              const fondoBarra = nov ? '#D0D5DD' : proy ? `repeating-linear-gradient(135deg, ${col} 0 6px, ${col}99 6px 12px)` : col
              const titulo = `${f.nombre} · ${f.turno || ''} ${hhmm(e)}–${hhmm(s)}${ci != null ? ` · colación ${hhmm(ci)}–${hhmm(ci + f.colacion_min)}` : ''}${proy ? ` · proyectado desde el ${fDia(f.fecha_origen)}` : ''}${nov ? ` · ${NOVEDAD[f.novedad] || f.novedad}` : ''}`
              return (
                <div key={`${f.cod_contaline}`} className="mt-fila">
                  <div style={{fontSize:11.5,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={f.nombre}>
                    {f.nombre}{f.acumula ? <span style={{color:'#B25E09'}}> · acumula</span> : null}
                  </div>
                  <div style={{position:'relative',height:20,...fondo}}>
                    <div title={titulo} className={proy ? 'mt-barra proy' : 'mt-barra'}
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
          <div style={{marginTop:10,fontSize:11.5,color:'var(--text-muted)',lineHeight:1.6}}>
            {descanso.length > 0 && <div><strong style={{color:'var(--text)'}}>Libres este día ({descanso.length}):</strong> {descanso.map(f => f.nombre.split(' ').slice(0, 2).join(' ')).join(' · ')}</div>}
            {sinTurno.length > 0 && <div style={{color:'#B42318'}}><strong>Sin turno publicado ni patrón ({sinTurno.length}):</strong> {sinTurno.map(f => f.nombre).join(' · ')}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Plantilla turno × rol ───────────────────────────────────────────────────
function Plantilla({ filas, roles, rolNombre }) {
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
                  {roles.map(r => <td key={r} style={{color: f.porRol[r] ? 'var(--text)' : 'var(--border)'}}>{f.porRol[r] ? n1(Math.round(f.porRol[r] * 10) / 10) : '·'}</td>)}
                  <td style={{fontWeight:800}}>{n1(Math.round(f.total * 10) / 10)}</td>
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

function Kpi({ l, v, sub, c }) {
  return (
    <div style={{...card,padding:'9px 12px'}}>
      <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)'}}>{l}</div>
      <div style={{fontSize:21,fontWeight:800,lineHeight:1.2,color:c || 'var(--text)',fontVariantNumeric:'tabular-nums'}}>{v}</div>
      {sub && <div style={{fontSize:10.5,color:'var(--text-muted)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div>}
    </div>
  )
}

const MT_CSS = `
.mt-kpis { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:8px; }
.mt-grid { display:grid; grid-template-columns:minmax(0,1fr) 380px; gap:12px; align-items:start; }
.mt-mapa { border-collapse:separate; border-spacing:2px; font-size:10px; font-variant-numeric:tabular-nums; }
.mt-mapa th { font-weight:600; color:var(--text-muted); text-align:left; padding:0 2px; white-space:nowrap; }
.mt-mapa thead th { font-size:10px; height:14px; }
.mt-mapa tbody th { font-size:11px; padding-right:8px; }
.mt-mapa td { width:24px; min-width:24px; height:24px; text-align:center; border-radius:4px; cursor:pointer; background-clip:padding-box; }
.mt-mapa tbody tr:hover th { color:var(--text); }
.mt-mapa tr.sel th { color:var(--accent); font-weight:800; }
.mt-mapa tr.sel td { outline:1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
.mt-fila { display:grid; grid-template-columns:230px minmax(0,1fr); gap:8px; align-items:center; margin:1px 0; }
.mt-barra { display:flex; align-items:center; overflow:hidden; }
.mt-tabla { width:100%; border-collapse:collapse; font-size:12px; font-variant-numeric:tabular-nums; }
.mt-tabla th { padding:7px 8px; font-size:10.5px; font-weight:700; color:var(--text-muted); text-align:center; border-bottom:1px solid var(--border); white-space:nowrap; }
.mt-tabla td { padding:5px 8px; text-align:center; border-bottom:1px solid var(--border); }
.mt-tabla td.grupo { text-align:left; font-size:10.5px; font-weight:800; color:var(--text-muted); background:var(--bg-app); padding:4px 8px; }
.mt-tabla tr.total td { font-weight:800; border-top:2px solid var(--border); }
@media (max-width:1180px) { .mt-grid { grid-template-columns:1fr; } .mt-kpis { grid-template-columns:repeat(3, minmax(0,1fr)); } }
`

const card     = {background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12}
const cardHead = {display:'flex',alignItems:'baseline',gap:10,flexWrap:'wrap',padding:'10px 12px',borderBottom:'1px solid var(--border)'}
const inp      = {padding:'7px 9px',border:'1px solid var(--border)',borderRadius:8,fontSize:12.5,background:'var(--bg-surface)',color:'var(--text)',fontFamily:'inherit'}
const btnIcono = {width:28,height:26,border:'none',background:'none',cursor:'pointer',color:'var(--text)',fontSize:11,borderRadius:6}
const seg      = {padding:'5px 10px',borderRadius:6,border:'none',background:'transparent',color:'var(--text-muted)',fontSize:12,fontWeight:600,cursor:'pointer'}
const segOn    = {background:'var(--bg-app)',color:'var(--text)',boxShadow:'inset 0 0 0 1px var(--border)'}
const chip     = {padding:'5px 10px',borderRadius:100,border:'1px solid var(--border)',background:'var(--bg-surface)',color:'var(--text-muted)',fontSize:11.5,fontWeight:600,cursor:'pointer'}
const chipOn   = {background:'#16213E',color:'#fff',border:'1px solid #16213E'}
const chk      = {display:'inline-flex',alignItems:'center',gap:5,fontSize:12,color:'var(--text)',cursor:'pointer'}
const aviso    = {padding:'9px 14px',borderRadius:8,fontSize:12.5,border:'1px solid'}
const btnPri   = {padding:'7px 13px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:12.5,fontWeight:600}
const btnSec   = {padding:'7px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:12.5,fontWeight:500}
const lnk      = {background:'none',border:'none',padding:0,cursor:'pointer',fontSize:12,fontWeight:700}
const tag      = c => ({marginLeft:6,fontSize:9,fontWeight:800,padding:'1px 6px',borderRadius:100,background:`${c}18`,color:c,whiteSpace:'nowrap'})
