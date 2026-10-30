// src/rrhh/asistencia/tabs/AsisHHEE.jsx  (v2 — sistema de validación)
// Horas Extraordinarias — validación explícita de jefatura + reporte
// · Cada jornada con minutos extra requiere decisión de jefatura
//   (autorizar / rechazar) con justificación obligatoria.
// · Reporte clasifica: Autorizada ≤ tope 2h · Autorizada con exceso ·
//   Rechazada · Pendiente (no autorizada).
// · RBAC: capability rrhh.asistencia.validar_hhee
//   (jefes de sucursal validan solo su sucursal vía scopeSuc).
// · Llegada anticipada (v3, 30-10-2026): autorización parcial —todo, rango
//   horario o cantidad de minutos— con el día completo a la vista. Lo aprobado
//   va a min_extra_snapshot (tope que paga la pre-nómina); el tramo queda en
//   aut_desde/aut_hasta y lo detectado en min_detectados.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../../supabase'
import { aplicarAlcance, enAlcance } from '../alcance'
import { can } from '../../../core/permisos'
import { useResponsive } from '../../../core/responsive'
import { AsisFicha } from './AsisFicha'
import { AsisAcuse } from './AsisAcuse'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import 'jspdf-autotable'

const TOPE_MIN = 120   // tope 2 horas extraordinarias por día

const hoyISO = () => new Date().toISOString().slice(0,10)
const iniMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` }
// VISTAS DE PERÍODO · las horas extra se pueden mirar de dos formas:
//   · Período de pago: del 26 de un mes al 25 del siguiente (así se liquidan).
//     Se identifica por el mes en que termina: '2026-09' = 26-08 al 25-09.
//     Misma regla que fn_periodo_pago() en la base de datos.
//   · Mes calendario: del 1 al último día.
// Ninguna de las dos bloquea decisiones: las horas extra no tienen cierre de
// validación. Las AUSENCIAS se calculan siempre por mes calendario y
// conservan su regla: solo el mes en curso admite gestión.
const abierto = fecha => String(fecha).slice(0,10) >= iniMes()     // usado solo por ausencias
const periodoPago = fecha => {
  const [y, m, d] = String(fecha).slice(0,10).split('-').map(Number)
  let yy = y, mm = m
  if (d >= 26) { mm += 1; if (mm > 12) { mm = 1; yy += 1 } }
  return `${yy}-${String(mm).padStart(2,'0')}`
}
const mesMas = (p, n) => { const t = new Date(Date.UTC(Number(p.slice(0,4)), Number(p.slice(5,7)) - 1 + n, 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,'0')}` }
const ultimoDia = p => new Date(Date.UTC(Number(p.slice(0,4)), Number(p.slice(5,7)), 0)).getUTCDate()
const MESES_L = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const MESES_C = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
// Rango de un período según el modo. p = 'YYYY-MM'
const rangoDe = (modo, p) => modo === 'pago'
  ? { desde: `${mesMas(p,-1)}-26`, hasta: `${p}-25` }
  : { desde: `${p}-01`, hasta: `${p}-${String(ultimoDia(p)).padStart(2,'0')}` }
const etiquetaDe = (modo, p) => {
  if (modo === 'mes') return MESES_L[Number(p.slice(5,7)) - 1]
  const a = mesMas(p,-1)
  return `26 ${MESES_C[Number(a.slice(5,7))-1]} – 25 ${MESES_C[Number(p.slice(5,7))-1]}`
}
// Período por defecto: el que contiene "hace una semana". Así, a fines de mes
// se muestra el período que se está terminando de validar, no uno recién
// empezado y casi vacío.
const periodoPorDefecto = modo => {
  const d = new Date(Date.now() - 7*86400000).toISOString().slice(0,10)
  return modo === 'pago' ? periodoPago(d) : d.slice(0,7)
}
const rangoPorDefecto = modo => {
  const r = rangoDe(modo, periodoPorDefecto(modo)), h = hoyISO()
  return { desde: r.desde, hasta: r.hasta < h ? r.hasta : h }
}
// Ausencias: siempre el mes en curso (es el único que admite gestión)
const rangoAusencias = () => ({ desde: iniMes(), hasta: hoyISO() })
const fFecha = d => { if(!d) return '—'; const [y,m,dd]=String(d).slice(0,10).split('-'); return `${dd}-${m}-${y}` }
const fMin = m => { if(!m) return '0m'; const h=Math.floor(m/60), r=m%60; return h>0 ? (r>0?`${h}h ${r}m`:`${h}h`) : `${r}m` }

const CATS = {
  aut_tope:   { l:'Autorizada ≤ tope 2h',    c:'#34C759', ic:'' },
  aut_exceso: { l:'Autorizada con exceso',   c:'#FF9500', ic:'' },
  rechazada:  { l:'Rechazada',               c:'#FF3B30', ic:'' },
  pendiente:  { l:'Pendiente (no autorizada)', c:'#8E8E93', ic:'' },
}
const clasificar = (j, val) =>
  val?.decision === 'autorizada' ? (j.min_extra_dia <= TOPE_MIN ? 'aut_tope' : 'aut_exceso')
  : val?.decision === 'rechazada' ? 'rechazada'
  : 'pendiente'

// ── Ausencias ──
const AUS_CATS = {
  falta_injustificada: { l:'Falta injustificada', c:'#FF3B30', ic:'', justificada:false },
  licencia_medica:     { l:'Licencia médica',     c:'#0A84FF', ic:'', justificada:true  },
  permiso_con_goce:    { l:'Permiso con goce',     c:'#34C759', ic:'', justificada:true  },
  permiso_sin_goce:    { l:'Permiso sin goce',     c:'#FF9500', ic:'', justificada:true  },
  vacaciones:          { l:'Vacaciones',           c:'#AF52DE', ic:'', justificada:true  },
  otro:                { l:'Otro (novedad)',       c:'#8E8E93', ic:'', justificada:true  },
}
// Estado en la cola: 'pendiente' (sin gestionar → cuenta como falta por defecto) o la clasificación
const clasificarAus = (a, ges) => ges?.clasificacion || a.novedad_tipo || 'pendiente'
const AUS_PEND = { l:'Pendiente (falta por defecto)', c:'#8E8E93', ic:'' }

// onCambio: avisa al contenedor tras validar/anular para que el contador de
// pendientes de la pestaña se actualice sin recargar la página.
export function AsisHHEE({ cu, scopeSuc, scopeCods, areaScope, initDominio, initCat, onCambio }) {
  const [dominio, setDominio] = useState(initDominio || 'hhee')  // 'hhee' | 'entrada' | 'ausencias'
  const [vista, setVista] = useState(initCat ? 'reporte' : 'validacion')
  const [modoPer, setModoPer] = useState('pago')   // 'pago' (26 al 25) | 'mes' (calendario)
  const [fil, setFil] = useState(() => ({ ...(dominio === 'ausencias' ? rangoAusencias() : rangoPorDefecto('pago')), sucursal: 'todas' }))
  // Ausencias se calculan por mes calendario: al entrar a esa bandeja se usa el
  // mes en curso; al volver a horas extra se restaura el modo elegido.
  const modoEfectivo = dominio === 'ausencias' ? 'mes' : modoPer
  const aplicarRango = r => setFil(f => ({ ...f, desde: r.desde, hasta: r.hasta }))
  const [jornadas, setJornadas] = useState([])
  const [vals, setVals] = useState([])
  const [ausencias, setAusencias] = useState([])
  const [gestiones, setGestiones] = useState([])
  const [nomValidadores, setNomValidadores] = useState({})
  // Horas de una jefatura las valida su superior directo (usuarios.reporta_a).
  // La base de datos lo hace cumplir (tg_asis_hhee_validador_check); acá solo
  // se evita ofrecer botones que fallarían.
  const [jefaturas, setJefaturas] = useState({})   // cod_contaline -> { userId, supId, supNombre }
  const [sucursales, setSucursales] = useState([])
  const [cargando, setCargando] = useState(true)
  const [puedeValidar, setPuedeValidar] = useState(false)
  const [puedeAusencia, setPuedeAusencia] = useState(false)
  const [msg, setMsg] = useState(null)
  const [dia, setDia]   = useState(null)   // filtro común: un día puntual (YYYY-MM-DD) o todos
  const [busq, setBusq] = useState('')     // filtro común: nombre de persona
  const [sel, setSel] = useState(new Set())          // jornadas seleccionadas (key cod|fecha)
  const [modal, setModal] = useState(null)           // { tipo, decision, items }
  const [jorEntrada, setJorEntrada] = useState([])   // llegadas anticipadas
  const [cargos, setCargos] = useState({})          // cod_contaline → cargo
  const [filtroCat, setFiltroCat] = useState(null)  // categoría activa al clickear un KPI
  const [ficha, setFicha] = useState(null)          // { cod, nombre } — panel de trabajador
  const [acuse, setAcuse] = useState(null)          // { cod, nombre, fecha, tipoAlerta }

  useEffect(() => {
    supabase.from('usuarios').select('id,nombre,cod_contaline,reporta_a,activo').then(({ data }) => {
      const us = data || []
      const nom = Object.fromEntries(us.map(u => [u.id, u.nombre]))
      const m = {}
      for (const u of us) if (u.activo && u.cod_contaline != null && u.reporta_a)
        m[u.cod_contaline] = { userId: u.id, supId: u.reporta_a, supNombre: nom[u.reporta_a] || u.reporta_a }
      setJefaturas(m)
    })
  }, [])
  // Devuelve el nombre de quien debe validar, si NO es el usuario actual.
  const reservaDe = cod => {
    const j = jefaturas[cod]
    if (!j || cu?.rol === 'admin' || j.supId === cu?.id) return null
    return j.supNombre
  }

  useEffect(() => {
    supabase.from('sucursales').select('id,nombre').order('nombre').then(({data})=>setSucursales(data||[]))
    can(cu, 'rrhh', 'rrhh.asistencia.validar_hhee')
      .then(s => setPuedeValidar(s !== false && s != null))
      .catch(() => setPuedeValidar(['admin','dir_general','dir_finanzas'].includes(cu?.rol)))
    can(cu, 'rrhh', 'rrhh.asistencia.gestionar_ausencia')
      .then(s => setPuedeAusencia(s !== false && s != null))
      .catch(() => setPuedeAusencia(['admin','dir_general','dir_finanzas'].includes(cu?.rol)))
  }, [cu?.id])

  useEffect(() => {
    if (initDominio) setDominio(initDominio)
    if (initCat) { setVista('reporte'); setFiltroCat(initCat) }
  }, [initDominio, initCat])

  useEffect(() => { cargar() }, [fil, scopeSuc, scopeCods])
  async function cargar() {
    setCargando(true)
    try {
      // Llegada anticipada: minutos ANTES del turno. Se decide aparte porque
      // no son horas extraordinarias por sí solas; lo son solo si la jefatura
      // las requirió. Por eso el sistema sugiere no autorizarlas.
      let qE = supabase.from('v_asis_jornadas')
        .select('cod_contaline,empleado,fecha,sucursal_id,sucursal_nombre,departamento,min_antes_turno_contable,' +
          'workshift_name,schedule_name,entrada_real,entrada_esperada,salida_real,salida_esperada,' +
          'inicio_colacion_real,fin_colacion_real,min_colacion_real,min_colacion_esperada,min_presencia,' +
          'min_trabajados_efectivos,min_turno_neto,min_extra_dia,min_salida_anticipada_contable,' +
          'estado_dia,es_feriado,feriado_nombre,turno_corregido,n_marcas_dia')
        .gt('min_antes_turno_contable', 0)
        .gte('fecha', fil.desde).lte('fecha', fil.hasta).limit(20000)
      if (scopeSuc) qE = aplicarAlcance(qE, scopeSuc, scopeCods)
      else if (fil.sucursal !== 'todas') qE = qE.eq('sucursal_id', fil.sucursal)
      qE.then(r => setJorEntrada(r.data || []), () => setJorEntrada([]))

      let qJ = supabase.from('v_asis_jornadas')
        .select('cod_contaline,empleado,fecha,sucursal_id,sucursal_nombre,departamento,estado_dia,min_extra_dia,workshift_name,entrada_real,salida_real,extra_reparo')
        .gt('min_extra_dia', 0)
        .gte('fecha', fil.desde).lte('fecha', fil.hasta)
        .order('fecha', { ascending:false })
        .limit(20000)
      // Filtro por ID de sucursal: scopeSuc viene de userScope() como 'suc-lg' y
      // el selector emite value={s.id}. La vista expone ambos campos; filtrar por
      // nombre nunca calzaba y devolvía cero filas (bandeja vacía).
      if (scopeSuc) qJ = aplicarAlcance(qJ, scopeSuc, scopeCods)
      else if (fil.sucursal !== 'todas') qJ = qJ.eq('sucursal_id', fil.sucursal)

      // El área se decide por departamento + cargo: Workera no tiene el
      // departamento cargado en todas las sucursales, y el cargo lo suple.
      supabase.from('rrhh_empleados').select('cod_contaline,cargo').limit(20000)
        .then(r => { const m = {}; for (const e of (r.data||[])) m[e.cod_contaline] = e.cargo || ''
                     setCargos(m) }, () => setCargos({}))

      const qV = supabase.from('asis_hhee_validaciones')
        .select('*').eq('activo', true)
        .gte('fecha', fil.desde).lte('fecha', fil.hasta).limit(20000)

      // Ausencias: sin_marcas con fecha < hoy (solo días cerrados)
      const ayer = new Date(); ayer.setDate(ayer.getDate()-1)
      const topeAus = ayer.toISOString().slice(0,10)
      let qA = supabase.from('v_asis_jornadas')
        .select('cod_contaline,empleado,fecha,sucursal_nombre,departamento,workshift_name,novedad_tipo')
        .eq('estado_dia','sin_marcas')
        .gte('fecha', fil.desde).lte('fecha', fil.hasta < topeAus ? fil.hasta : topeAus)
        .order('fecha',{ascending:false}).limit(20000)
      if (scopeSuc) qA = aplicarAlcance(qA, scopeSuc, scopeCods)
      else if (fil.sucursal !== 'todas') qA = qA.eq('sucursal_id', fil.sucursal)

      const qG = supabase.from('asis_ausencias')
        .select('*').eq('activo', true)
        .gte('fecha', fil.desde).lte('fecha', fil.hasta).limit(20000)

      const [{ data: j, error: e1 }, { data: v, error: e2 },
             { data: a, error: e3 }, { data: g, error: e4 }] =
        await Promise.all([qJ, qV, qA, qG])
      if (e1) throw e1
      if (e2) throw e2
      if (e3) throw e3
      if (e4) throw e4
      setJornadas(j||[]); setVals(v||[]); setAusencias(a||[]); setGestiones(g||[]); setSel(new Set())

      const ids = [...new Set([...(v||[]).map(x=>x.validado_por), ...(g||[]).map(x=>x.gestionado_por)])]
      if (ids.length) {
        const { data: us } = await supabase.from('usuarios').select('id,nombre').in('id', ids)
        setNomValidadores(Object.fromEntries((us||[]).map(u=>[u.id,u.nombre])))
      }
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
    finally { setCargando(false) }
  }

  // Clave con tipo: entrada y salida se deciden por separado y no deben
  // pisarse entre sí. Las filas antiguas sin tipo se asumen 'salida'.
  const valPor = useMemo(() => {
    const m = {}
    for (const v of vals) m[`${v.cod_contaline}|${v.fecha}|${v.tipo || 'salida'}`] = v
    return m
  }, [vals])

  // Alcance por área: una jefatura solo ve y decide sobre su propio equipo.
  // Si no hay área definida (jefaturas de sucursal única, o dirección), pasa todo.
  // Desde la fase 5 el equipo lo resuelve la BD (fn_asis_mi_alcance): organigrama
  // + trabajadores sin cargo de la propia sucursal/área. Ya no se usa la regex.
  const enArea = useMemo(() => enAlcance(scopeCods), [scopeCods])

  const filas = useMemo(() => jornadas.filter(enArea).map(j => {
    const val = valPor[`${j.cod_contaline}|${j.fecha}|salida`] || null
    // Horas extra: sin cierre de validación, cualquier fecha es decidible.
    const reservadoA = reservaDe(j.cod_contaline), mesCerrado = false
    return { ...j, nombre: j.empleado, sucursal_id: j.sucursal_nombre,
      val, cat: clasificar(j, val), mesCerrado, reservadoA, cerrado: mesCerrado || !!reservadoA,
      key: `${j.cod_contaline}|${j.fecha}` }
  }), [jornadas, valPor, enArea, jefaturas])

  // Pendiente = sin decisión Y dentro del mes en curso. Lo de meses cerrados
  // queda visible como historial, pero no engrosa la cola de trabajo.
  const pendientes = useMemo(() => filas.filter(f=>f.cat==='pendiente' && !f.cerrado), [filas])

  // Entrada: mismo esquema de decisión, con su propia validación (tipo='entrada')
  const filasEnt = useMemo(() => jorEntrada.filter(enArea).map(j => {
    const val = valPor[`${j.cod_contaline}|${j.fecha}|entrada`] || null
    const minAut = minAutorizados(val, j.min_antes_turno_contable)
    return { ...j, nombre: j.empleado, sucursal_id: j.sucursal_nombre,
      minutos: j.min_antes_turno_contable, val, minAut,
      parcial: val?.decision === 'autorizada' && minAut < j.min_antes_turno_contable,
      // Decisión de la salida del mismo día: contexto para el total de HE
      valSal: valPor[`${j.cod_contaline}|${j.fecha}|salida`] || null,
      cat: val ? val.decision : 'pendiente', reservadoA: reservaDe(j.cod_contaline),
      mesCerrado: false,
      cerrado: !!reservaDe(j.cod_contaline),
      key: `E|${j.cod_contaline}|${j.fecha}` }
  }), [jorEntrada, valPor, enArea, jefaturas])
  const entPendientes = useMemo(() => filasEnt.filter(f=>f.cat==='pendiente' && !f.cerrado), [filasEnt])

  const gesPor = useMemo(() => {
    const m = {}; for (const g of gestiones) m[`${g.cod_contaline}|${g.fecha}`] = g; return m
  }, [gestiones])
  const filasAus = useMemo(() => ausencias.filter(enArea).map(a => {
    const ges = gesPor[`${a.cod_contaline}|${a.fecha}`] || null
    return { ...a, nombre: a.empleado, sucursal_id: a.sucursal_nombre,
      ges, porNovedad: !ges && !!a.novedad_tipo,
      cat: clasificarAus(a, ges), cerrado: !abierto(a.fecha),
      key:`${a.cod_contaline}|${a.fecha}` }
  }), [ausencias, gesPor, enArea])
  const ausPendientes = useMemo(() => filasAus.filter(f=>f.cat==='pendiente' && !f.cerrado), [filasAus])

  // ── Filtro común a las tres bandejas ──
  // Se aplica a lo que se muestra para decidir. Los KPIs y reportes siguen
  // mostrando el período completo, para no confundir totales.
  const normTxt = t => String(t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  const pasa = useCallback(f =>
    (!dia || String(f.fecha).slice(0,10) === dia) &&
    (!busq.trim() || normTxt(f.nombre).includes(normTxt(busq.trim()))), [dia, busq])
  const filasV        = useMemo(() => filas.filter(pasa),         [filas, pasa])
  const pendientesV   = useMemo(() => pendientes.filter(pasa),    [pendientes, pasa])
  const filasEntV     = useMemo(() => filasEnt.filter(pasa),      [filasEnt, pasa])
  const entPendV      = useMemo(() => entPendientes.filter(pasa), [entPendientes, pasa])
  const filasAusV     = useMemo(() => filasAus.filter(pasa),      [filasAus, pasa])
  const ausPendV      = useMemo(() => ausPendientes.filter(pasa), [ausPendientes, pasa])
  const selEnt        = useMemo(() => entPendientes.filter(p => sel.has(p.key)), [entPendientes, sel])

  // Pendientes del dominio activo (para contadores y para el filtro por día)
  const pendDominio  = dominio==='hhee' ? pendientes : dominio==='entrada' ? entPendientes : ausPendientes
  const pendVisibles = dominio==='hhee' ? pendientesV : dominio==='entrada' ? entPendV : ausPendV
  // Llegada anticipada: al recargar tras cada decisión la bandeja sigue montada
  // (no vuelve a "Cargando…"), así no se pierden el scroll ni los filtros.
  const entVivo = dominio === 'entrada' && jorEntrada.length > 0

  // Cambiar de bandeja o de filtro limpia la selección: nunca se decide sobre
  // algo que el usuario ya no está viendo.
  useEffect(() => { setDia(null); setBusq('') }, [dominio])
  // Al cambiar de bandeja o de modo, se muestra el período por defecto de ese modo
  const primeraCarga = useRef(true)
  useEffect(() => {
    if (primeraCarga.current) { primeraCarga.current = false; return }
    aplicarRango(dominio === 'ausencias' ? rangoAusencias() : rangoPorDefecto(modoEfectivo))
  }, [modoEfectivo, dominio === 'ausencias'])
  useEffect(() => { setSel(new Set()) }, [dominio, dia, busq])
  const kpisAus = useMemo(() => {
    const k = { pendiente:{n:filasAus.filter(f=>f.cat==='pendiente').length} }
    for (const c of Object.keys(AUS_CATS)) k[c] = { n: filasAus.filter(f=>f.cat===c).length }
    return k
  }, [filasAus])
  const kpis = useMemo(() => {
    const k = {}
    for (const c of Object.keys(CATS)) {
      const fs = filas.filter(f=>f.cat===c)
      k[c] = { n: fs.length, min: fs.reduce((s,f)=>s+f.min_extra_dia,0) }
    }
    return k
  }, [filas])

  // Inserción idempotente. Si la vista quedó desactualizada (otra pestaña
  // abierta, el enlace del correo, otra jefatura decidiendo el mismo día),
  // lo ya decidido se omite en vez de chocar con el índice único. Si aun así
  // hay una carrera, el 23505 se trata como "ya estaba decidido".
  async function insertarNuevas(tabla, payload, conTipo, opcionales = []) {
    if (!payload.length) return { guardadas: 0, omitidas: 0 }
    const clave = r => `${r.cod_contaline}|${r.fecha}${conTipo ? '|' + (r.tipo || 'salida') : ''}`
    const { data: ya, error: eY } = await supabase.from(tabla)
      .select(conTipo ? 'cod_contaline,fecha,tipo' : 'cod_contaline,fecha')
      .eq('activo', true)
      .in('cod_contaline', [...new Set(payload.map(r => r.cod_contaline))])
      .in('fecha', [...new Set(payload.map(r => r.fecha))])
      .limit(20000)
    if (eY) throw eY
    const existentes = new Set((ya || []).map(clave))
    const nuevas = payload.filter(r => !existentes.has(clave(r)))
    let omitidas = payload.length - nuevas.length
    if (nuevas.length) {
      let { error } = await supabase.from(tabla).insert(nuevas)
      // Columnas opcionales que la base aún no tiene (SQL pendiente): se guarda
      // sin ellas antes que perder la decisión; la traza queda en la justificación.
      if (error && opcionales.length && (error.code === 'PGRST204' ||
          opcionales.some(c => String(error.message || '').includes(c)))) {
        const r2 = await supabase.from(tabla).insert(nuevas.map(r =>
          Object.fromEntries(Object.entries(r).filter(([k]) => !opcionales.includes(k)))))
        error = r2.error
      }
      if (error) {
        if (error.code !== '23505') throw error
        omitidas = payload.length   // carrera: otro usuario decidió en el mismo instante
        return { guardadas: 0, omitidas }
      }
    }
    return { guardadas: nuevas.length, omitidas }
  }
  const avisoOmitidas = n => n > 0
    ? ` · ${n} ya estaba${n===1?'':'n'} decidida${n===1?'':'s'} (vista desactualizada, se refrescó)` : ''

  // Decisión sobre llegada anticipada. Cada plan trae lo que se autoriza ese
  // día (todo, un tramo o nada). Lo aprobado va a min_extra_snapshot: es el
  // tope que paga la pre-nómina (least(min_antes, snapshot)); min_detectados y
  // aut_desde/aut_hasta dejan la traza de qué se detectó y qué tramo se aprobó.
  async function decidirEntrada(planes, justificacion) {
    try {
      const payload = planes.map(p => {
        const aut = p.decision === 'autorizada'
        return {
          cod_contaline: p.item.cod_contaline, fecha: p.item.fecha, tipo: 'entrada',
          min_extra_snapshot: aut ? p.min : p.item.minutos,
          min_detectados: p.item.minutos,
          aut_desde: aut ? p.desde : null, aut_hasta: aut ? p.hasta : null,
          decision: p.decision,
          justificacion: p.nota ? `${justificacion} (${p.nota})` : justificacion,
          validado_por: cu.id,
        }
      })
      const { guardadas, omitidas } = await insertarNuevas('asis_hhee_validaciones', payload, true,
        ['min_detectados', 'aut_desde', 'aut_hasta'])
      const minAut = planes.reduce((s, p) => s + (p.decision === 'autorizada' ? p.min : 0), 0)
      setModal(null); setSel(new Set())
      setMsg({tipo:'ok', txt:`${guardadas} día(s) registrado(s) · ${fMin(minAut)} autorizados${avisoOmitidas(omitidas)}`})
      await cargar(); onCambio?.()
    } catch (e) {
      // No dejar el modal colgado en "Guardando...": cerrar y refrescar.
      setModal(null); setMsg({tipo:'error', txt:e.message}); await cargar()
    }
  }

  async function decidir(items, decision, justificacion) {
    try {
      // tipo explícito: la tabla admite 'entrada' y 'salida' por separado.
      // Esta bandeja decide la salida (minutos posteriores al turno).
      const payload = items.map(j => ({
        cod_contaline: j.cod_contaline, fecha: j.fecha, tipo: 'salida',
        min_extra_snapshot: j.min_extra_dia,
        decision, justificacion, validado_por: cu.id,
      }))
      const { guardadas, omitidas } = await insertarNuevas('asis_hhee_validaciones', payload, true)
      setModal(null); setSel(new Set())
      setMsg({tipo:'ok', txt:`${guardadas} jornada(s) ${decision === 'autorizada' ? 'autorizada(s)' : 'rechazada(s)'}${avisoOmitidas(omitidas)}`})
      await cargar(); onCambio?.()
    } catch(e) {
      setModal(null); setMsg({tipo:'error', txt:e.message}); await cargar()
    }
  }

  async function anular(f) {
    if (!window.confirm(`¿Anular la validación de ${f.nombre} del ${fFecha(f.fecha)}? Volverá a estado pendiente.`)) return
    try {
      const { error } = await supabase.from('asis_hhee_validaciones')
        .update({ activo:false, anulado_por: cu.id, anulado_at: new Date().toISOString() })
        .eq('id', f.val.id)
      if (error) throw error
      await cargar(); onCambio?.()
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }

  const toggleSel = key => setSel(prev => { const n = new Set(prev); n.has(key)?n.delete(key):n.add(key); return n })
  const selItems = useMemo(() => pendientes.filter(p=>sel.has(p.key)), [pendientes, sel])
  const selAus   = useMemo(() => ausPendientes.filter(p=>sel.has(p.key)), [ausPendientes, sel])

  async function gestionarAus(items, clasificacion, justificacion) {
    try {
      const payload = items.map(a => ({
        cod_contaline: a.cod_contaline, fecha: a.fecha, workshift_name: a.workshift_name || null,
        clasificacion, justificacion, gestionado_por: cu.id,
      }))
      const { guardadas, omitidas } = await insertarNuevas('asis_ausencias', payload, false)
      setModal(null); setSel(new Set())
      setMsg({tipo:'ok', txt:`${guardadas} ausencia(s) clasificada(s) como ${AUS_CATS[clasificacion].l}${avisoOmitidas(omitidas)}`})
      await cargar(); onCambio?.()
    } catch(e) {
      setModal(null); setMsg({tipo:'error', txt:e.message}); await cargar()
    }
  }
  async function anularAus(f) {
    if (!window.confirm(`¿Anular la gestión de ${f.nombre} del ${fFecha(f.fecha)}? Volverá a falta pendiente.`)) return
    try {
      const { error } = await supabase.from('asis_ausencias')
        .update({ activo:false, anulado_por:cu.id, anulado_at:new Date().toISOString() }).eq('id', f.ges.id)
      if (error) throw error
      await cargar(); onCambio?.()
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }

  // ─── Exports del reporte ───
  function exportXLSX() {
    const resumen = resumenTrabajador(filas)
    const ws1 = XLSX.utils.json_to_sheet(resumen.map(r => ({
      Trabajador: r.nombre, Sucursal: r.sucursal_id,
      'Jornadas c/extra': r.n,
      'Aut. ≤2h (n)': r.aut_tope.n, 'Aut. ≤2h (min)': r.aut_tope.min,
      'Aut. exceso (n)': r.aut_exceso.n, 'Aut. exceso (min)': r.aut_exceso.min,
      'Rechazadas (n)': r.rechazada.n, 'Rechazadas (min)': r.rechazada.min,
      'Pendientes (n)': r.pendiente.n, 'Pendientes (min)': r.pendiente.min,
      'Total min autorizados': r.aut_tope.min + r.aut_exceso.min,
    })))
    const ws2 = XLSX.utils.json_to_sheet(filas.map(f => ({
      Fecha: f.fecha, Trabajador: f.nombre, Sucursal: f.sucursal_id, Turno: f.workshift_name || '',
      'Min extra': f.min_extra_dia, 'Categoría': CATS[f.cat].l,
      'Justificación': f.val?.justificacion || '', 'Validado por': f.val ? (nomValidadores[f.val.validado_por] || f.val.validado_por) : '',
      'Fecha validación': f.val?.validado_at?.slice(0,10) || '',
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumen por trabajador')
    XLSX.utils.book_append_sheet(wb, ws2, 'Detalle jornadas')
    XLSX.writeFile(wb, `HHEE_validacion_${fil.desde}_${fil.hasta}.xlsx`)
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' })
    const azul = [26,26,46]
    doc.setFillColor(...azul); doc.rect(0,0,297,22,'F')
    doc.setTextColor(255,255,255); doc.setFontSize(12); doc.setFont(undefined,'bold')
    doc.text('REPORTE DE HORAS EXTRAORDINARIAS — VALIDACIÓN DE JEFATURA', 14, 10)
    doc.setFontSize(8); doc.setFont(undefined,'normal')
    doc.text(`Outlet de Puertas SpA · Período ${fFecha(fil.desde)} a ${fFecha(fil.hasta)}${scopeSuc && scopeSuc !== '__equipo__' ?` · Sucursal ${scopeSuc}`:''} · Tope diario: 2h`, 14, 16)
    doc.setTextColor(0,0,0)

    doc.autoTable({ startY: 27, theme:'grid', headStyles:{fillColor:azul,fontSize:8.5}, styles:{fontSize:8.5},
      head: [['Categoría','Jornadas','Horas']],
      body: Object.entries(CATS).map(([k,c]) => [c.l, kpis[k].n, fMin(kpis[k].min)]) })

    doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, theme:'grid',
      headStyles:{fillColor:azul,fontSize:8}, styles:{fontSize:7.5},
      head: [['Trabajador','Suc.','Jornadas','Aut ≤2h','Aut exceso','Rechazadas','Pendientes','Hrs autorizadas']],
      body: resumenTrabajador(filas).map(r => [
        r.nombre, r.sucursal_id, r.n,
        `${r.aut_tope.n} (${fMin(r.aut_tope.min)})`,
        `${r.aut_exceso.n} (${fMin(r.aut_exceso.min)})`,
        `${r.rechazada.n} (${fMin(r.rechazada.min)})`,
        `${r.pendiente.n} (${fMin(r.pendiente.min)})`,
        fMin(r.aut_tope.min + r.aut_exceso.min),
      ])})

    doc.autoTable({ startY: doc.lastAutoTable.finalY + 4, theme:'grid',
      headStyles:{fillColor:azul,fontSize:8}, styles:{fontSize:7},
      head: [['Fecha','Trabajador','Turno','Min extra','Categoría','Justificación','Validó']],
      body: filas.map(f => [
        fFecha(f.fecha), f.nombre, f.workshift_name||'', fMin(f.min_extra_dia),
        CATS[f.cat].l, f.val?.justificacion||'—',
        f.val ? (nomValidadores[f.val.validado_por]||f.val.validado_por) : '—',
      ])})

    doc.setFontSize(6.5); doc.setTextColor(120)
    doc.text('Generado por el ERP Outlet de Puertas · Las validaciones registran jefatura responsable, justificación y fecha. Tope de referencia: 2 horas extraordinarias por día.', 14, 205)
    doc.save(`HHEE_reporte_${fil.desde}_${fil.hasta}.pdf`)
  }

  function exportAusXLSX() {
    const ws = XLSX.utils.json_to_sheet(filasAus.map(f => ({
      Fecha:f.fecha, Trabajador:f.nombre, Sucursal:f.sucursal_id, Turno:f.workshift_name||'',
      Clasificación: f.cat==='pendiente' ? 'Pendiente (falta por defecto)' : AUS_CATS[f.cat].l,
      Justificada: f.cat==='pendiente' ? 'No' : (AUS_CATS[f.cat].justificada ? 'Sí' : 'No'),
      Justificación: f.ges?.justificacion || (f.porNovedad ? 'Novedad registrada en Dotación' : ''), 'Gestionado por': f.ges?(nomValidadores[f.ges.gestionado_por]||f.ges.gestionado_por):(f.porNovedad?'Automático (Dotación)':''),
    })))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Ausencias')
    XLSX.writeFile(wb, `ausencias_${fil.desde}_${fil.hasta}.xlsx`)
  }
  function exportAusPDF() {
    const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' })
    const azul=[26,26,46]
    doc.setFillColor(...azul); doc.rect(0,0,297,22,'F')
    doc.setTextColor(255,255,255); doc.setFontSize(12); doc.setFont(undefined,'bold')
    doc.text('REPORTE DE AUSENCIAS', 14, 10)
    doc.setFontSize(8); doc.setFont(undefined,'normal')
    doc.text(`Outlet de Puertas SpA · Período ${fFecha(fil.desde)} a ${fFecha(fil.hasta)}${scopeSuc && scopeSuc !== '__equipo__' ?` · Sucursal ${scopeSuc}`:''} · Ausencia = día con turno sin marcas`, 14, 16)
    doc.setTextColor(0,0,0)
    const cats = ['pendiente',...Object.keys(AUS_CATS)]
    const lbl = k => k==='pendiente'?AUS_PEND.l:AUS_CATS[k].l
    doc.autoTable({ startY:27, theme:'grid', headStyles:{fillColor:azul,fontSize:8.5}, styles:{fontSize:8.5},
      head:[['Clasificación','Días']], body: cats.map(k=>[lbl(k), (kpisAus[k]?.n||0)]) })
    doc.autoTable({ startY:doc.lastAutoTable.finalY+4, theme:'grid', headStyles:{fillColor:azul,fontSize:8}, styles:{fontSize:7.5},
      head:[['Trabajador','Suc.','Faltas injust.','Licencias','Perm. c/goce','Perm. s/goce','Pendientes','Total']],
      body: resumenAus(filasAus).map(r=>[r.nombre, r.sucursal_id, r.falta_injustificada, r.licencia_medica, r.permiso_con_goce, r.permiso_sin_goce, r.pendiente, r.n]) })
    doc.autoTable({ startY:doc.lastAutoTable.finalY+4, theme:'grid', headStyles:{fillColor:azul,fontSize:8}, styles:{fontSize:7},
      head:[['Fecha','Trabajador','Turno','Clasificación','Justificación','Gestionó']],
      body: filasAus.map(f=>[fFecha(f.fecha), f.nombre, f.workshift_name||'', f.cat==='pendiente'?AUS_PEND.l:AUS_CATS[f.cat].l, f.ges?.justificacion||'—', f.ges?(nomValidadores[f.ges.gestionado_por]||f.ges.gestionado_por):'—']) })
    doc.setFontSize(6.5); doc.setTextColor(120)
    doc.text('Generado por el ERP Outlet de Puertas · Las ausencias no gestionadas se contabilizan como falta injustificada por defecto.', 14, 205)
    doc.save(`ausencias_${fil.desde}_${fil.hasta}.pdf`)
  }

  return (
    <div>
      {/* Selector de dominio */}
      <div style={{display:'flex',gap:2,background:'var(--bg-app)',border:'1px solid var(--border)',borderRadius:10,padding:3,width:'fit-content',marginBottom:14}}>
        <button onClick={()=>{setDominio('hhee');setVista('validacion');setSel(new Set())}} style={{...tabB,padding:'8px 16px', ...(dominio==='hhee'?tabBOn:{})}}>
          Horas extra {pendientes.length>0 && <B n={pendientes.length}/>}
        </button>
        <button onClick={()=>{setDominio('entrada');setVista('validacion');setSel(new Set())}} style={{...tabB,padding:'8px 16px', ...(dominio==='entrada'?tabBOn:{})}}>
          Llegada anticipada {entPendientes.length>0 && <B n={entPendientes.length} c='#B25E09'/>}
        </button>
        <button onClick={()=>{setDominio('ausencias');setVista('validacion');setSel(new Set())}} style={{...tabB,padding:'8px 16px', ...(dominio==='ausencias'?tabBOn:{})}}>
          Ausencias {ausPendientes.length>0 && <B n={ausPendientes.length} c='#FF3B30'/>}
        </button>
      </div>

      {/* Sub-tabs + filtros */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:14}}>
        <div style={{display:'flex',gap:2,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,padding:3}}>
          <button onClick={()=>{setVista('validacion');setFiltroCat(null)}} style={{...tabB, ...(vista==='validacion'?tabBOn:{})}}>
            Por decidir {pendDominio.length>0 && <span style={{marginLeft:6,fontSize:10,fontWeight:800,padding:'1px 7px',borderRadius:100,background:'#FF950020',color:'#FF9500'}}>{pendDominio.length}</span>}
          </button>
          {dominio !== 'entrada' && (
            <button onClick={()=>{setVista('reporte');setFiltroCat(null)}} style={{...tabB, ...(vista==='reporte'?tabBOn:{})}}>Reporte</button>
          )}
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <SelectorPeriodo modo={modoEfectivo} fijo={dominio === 'ausencias'}
            onModo={setModoPer} fil={fil} onRango={aplicarRango}/>
          <input type='date' value={fil.desde} onChange={e=>setFil(f=>({...f,desde:e.target.value}))} style={inp}/>
          <span style={{color:'var(--text-muted)',fontSize:12}}>→</span>
          <input type='date' value={fil.hasta} onChange={e=>setFil(f=>({...f,hasta:e.target.value}))} style={inp}/>
          {!scopeSuc && (
            <select value={fil.sucursal} onChange={e=>setFil(f=>({...f,sucursal:e.target.value}))} style={inp}>
              <option value='todas'>Todas las sucursales</option>
              {sucursales.map(s=><option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          )}
        </div>
      </div>

      {(() => {
        const propias = [...filas, ...filasEnt].filter(f => f.cat === 'pendiente' && !f.mesCerrado
          && jefaturas[f.cod_contaline]?.userId === cu?.id && f.reservadoA)
        if (!propias.length) return null
        return (
          <div style={{marginBottom:12,padding:'9px 14px',borderRadius:8,fontSize:12.5,
            background:'var(--bg-surface)',border:'1px solid var(--border)',color:'var(--text-muted)'}}>
            Tus propias horas ({propias.length} día{propias.length===1?'':'s'}) no aparecen para decidir:
            las valida <b style={{color:'var(--text)'}}>{propias[0].reservadoA}</b>.
          </div>
        )
      })()}

      {msg && (
        <div style={{marginBottom:12,padding:'9px 14px',borderRadius:8,fontSize:13,
          background: msg.tipo==='error'?'#FF3B3012':'#34C75912',
          border:`1px solid ${msg.tipo==='error'?'#FF3B3040':'#34C75940'}`,
          display:'flex',justifyContent:'space-between'}}>
          <span>{msg.txt}</span>
          <button onClick={()=>setMsg(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
        </div>
      )}

      {/* KPIs — dependen del dominio */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10,marginBottom:16}}>
        {dominio==='hhee' ? Object.entries(CATS).map(([k,c])=>(
          <button key={k} onClick={()=>{ setVista('reporte'); setFiltroCat(k) }}
            title="Ver estas jornadas en el reporte"
            style={{textAlign:'left',cursor:'pointer',background:'var(--bg-surface)',
              border:`1px solid ${filtroCat===k?c.c:`${c.c}35`}`,borderLeft:`4px solid ${c.c}`,borderRadius:10,padding:'10px 14px',
              boxShadow: filtroCat===k?`0 0 0 2px ${c.c}30`:'none',transition:'box-shadow .15s'}}>
            <div style={{fontSize:10.5,fontWeight:800,color:c.c,textTransform:'uppercase',letterSpacing:'0.04em'}}>{c.ic} {c.l}</div>
            <div style={{fontSize:22,fontWeight:800,marginTop:3}}>{kpis[k]?.n ?? 0}
              <span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)',marginLeft:8}}>{fMin(kpis[k]?.min||0)}</span>
            </div>
            <div style={{fontSize:10,color:'var(--accent)',marginTop:3,fontWeight:600}}>Ver en reporte →</div>
          </button>
        )) : dominio==='entrada' ? (
          [['pendiente','Por decidir','#8E8E93'],['autorizada','Autorizadas por la jefatura','#1E7A44'],['rechazada','No requeridas','#B25E09']]
          .map(([k,l,c]) => {
            const fs = filasEnt.filter(f => f.cat === k && (k !== 'pendiente' || !f.cerrado))
            const parc = k === 'autorizada' ? fs.filter(f => f.parcial).length : 0
            return (
              <div key={k} style={{background:'var(--bg-surface)',border:`1px solid ${c}35`,borderLeft:`4px solid ${c}`,
                borderRadius:10,padding:'10px 14px'}}>
                <div style={{fontSize:10.5,fontWeight:800,color:c,textTransform:'uppercase',letterSpacing:'0.04em'}}>{l}</div>
                <div style={{fontSize:22,fontWeight:800,marginTop:3}}>{fs.length}
                  <span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)',marginLeft:8}}>{fMin(fs.reduce((a,f)=>a+(k==='autorizada' ? (f.minAut||0) : (f.minutos||0)),0))}</span>
                </div>
                {parc > 0 && <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>{parc} parcial{parc===1?'':'es'} · {fMin(fs.reduce((a,f)=>a+(f.minutos||0),0))} detectados</div>}
              </div>
            )
          })
        ) : (
          [['pendiente',AUS_PEND],...Object.entries(AUS_CATS)].map(([k,c])=>(
            <button key={k} onClick={()=>{ setVista('reporte'); setFiltroCat(k) }}
              title="Ver estos días en el reporte"
              style={{textAlign:'left',cursor:'pointer',background:'var(--bg-surface)',
                border:`1px solid ${filtroCat===k?c.c:`${c.c}35`}`,borderLeft:`4px solid ${c.c}`,borderRadius:10,padding:'10px 14px',
                boxShadow: filtroCat===k?`0 0 0 2px ${c.c}30`:'none',transition:'box-shadow .15s'}}>
              <div style={{fontSize:10.5,fontWeight:800,color:c.c,textTransform:'uppercase',letterSpacing:'0.04em'}}>{c.ic} {c.l}</div>
              <div style={{fontSize:22,fontWeight:800,marginTop:3}}>{kpisAus[k]?.n ?? 0}<span style={{fontSize:12,fontWeight:600,color:'var(--text-muted)',marginLeft:6}}>días</span></div>
              <div style={{fontSize:10,color:'var(--accent)',marginTop:3,fontWeight:600}}>Ver en reporte →</div>
            </button>
          ))
        )}
      </div>

      {(!cargando || entVivo) && (vista === 'validacion' || dominio === 'entrada') && (
        <BarraFiltro dia={dia} setDia={setDia} busq={busq} setBusq={setBusq}
          pendientes={pendDominio} visibles={pendVisibles}
          puede={dominio==='ausencias' ? puedeAusencia : puedeValidar}
          onSeleccionarVisibles={() => setSel(new Set(pendVisibles.map(p => p.key)))}/>
      )}

      {cargando && !entVivo ? <div style={{padding:50,textAlign:'center',color:'var(--text-muted)'}}>Cargando…</div> :
       dominio === 'entrada' ? (
         <VistaEntrada filas={filasEntV} pendientes={entPendV} puede={puedeValidar}
           sel={sel} toggleSel={toggleSel} selItems={selEnt} setSel={setSel}
           onDecidir={(items,modo)=>setModal({ tipo:'entrada', modo, items })}
           onAnular={anular} cargos={cargos}
           onFicha={(cod,nom)=>setFicha({cod,nombre:nom})} noms={nomValidadores}/>
       ) : dominio === 'hhee' ? (
         vista === 'validacion'
          ? <VistaValidacion filas={filasV} pendientes={pendientesV} puedeValidar={puedeValidar}
              sel={sel} toggleSel={toggleSel} selItems={selItems} setSel={setSel}
              onDecidir={(items,dec)=>setModal({ tipo:'hhee', decision:dec, items })}
              onAnular={anular} nomValidadores={nomValidadores}
              onFicha={(cod,nom)=>setFicha({cod,nombre:nom})}/>
          : <VistaReporte filas={filas} nomValidadores={nomValidadores} onXLSX={exportXLSX} onPDF={exportPDF} catInicial={filtroCat}/>
       ) : (
         vista === 'validacion'
          ? <VistaAusencias filas={filasAusV} pendientes={ausPendV} puede={puedeAusencia}
              sel={sel} toggleSel={toggleSel} selItems={selAus} setSel={setSel}
              onGestionar={(items)=>setModal({ tipo:'aus', items })}
              onAnular={anularAus} noms={nomValidadores}
              onFicha={(cod,nom)=>setFicha({cod,nombre:nom})}
              onAcuse={(f)=>setAcuse({cod:f.cod_contaline, nombre:f.nombre, fecha:f.fecha, tipoAlerta:'sin_marcas'})}/>
          : <VistaReporteAus filas={filasAus} noms={nomValidadores} onXLSX={exportAusXLSX} onPDF={exportAusPDF} catInicial={filtroCat}/>
       )}

      {ficha && <AsisFicha cod={ficha.cod} nombre={ficha.nombre} onCerrar={()=>setFicha(null)}/>}
      {acuse && <AsisAcuse cu={cu} cod={acuse.cod} nombre={acuse.nombre} fecha={acuse.fecha}
                  tipoAlerta={acuse.tipoAlerta} onCerrar={()=>setAcuse(null)} onListo={cargar}/>}

      {modal?.tipo==='hhee' && (
        <ModalJustificacion decision={modal.decision} items={modal.items}
          onCerrar={()=>setModal(null)}
          onConfirmar={just=>decidir(modal.items, modal.decision, just)}/>
      )}
      {modal?.tipo==='entrada' && (
        <ModalEntrada items={modal.items} modoInicial={modal.modo}
          onCerrar={()=>setModal(null)}
          onConfirmar={(planes, just)=>decidirEntrada(planes, just)}/>
      )}
      {modal?.tipo==='aus' && (
        <ModalAusencia items={modal.items}
          onCerrar={()=>setModal(null)}
          onConfirmar={(clasif,just)=>gestionarAus(modal.items, clasif, just)}/>
      )}
    </div>
  )
}


// ─── Vista: llegada anticipada ────────────────────────────────────────────────
// Criterio: llegar antes del turno no genera horas extraordinarias por sí solo.
// Solo las genera si la jefatura las requirió (Art. 32 CT: pacto previo). La
// jefatura decide cuánto: todo, un rango horario, una cantidad de minutos o
// nada; el resto queda como no requerido. Cada día se muestra con su contexto
// completo (turno, presencia, colación, salida) para decidir sabiendo qué pasó.
// Lo aprobado se guarda en min_extra_snapshot: es el tope que paga la
// pre-nómina (fn_asis_prenomina_calc: least(min_antes, snapshot)).

const LT = { turno:'#16213E', presencia:'#A9AFB9', antes:'#B25E09', aut:'#1E7A44', despues:'#6941C6', salida:'#B42318' }
const RAYADO = c => `repeating-linear-gradient(135deg, ${c} 0 2px, transparent 2px 5px)`
const DEF_NADA = 'No requerida por la jefatura.'
const DIAS_LARGO = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s
const fDiaLargo = iso => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return `${DIAS_LARGO[new Date(y, m - 1, d).getDay()]} ${d} de ${MESES_L[m - 1]}`
}
// Workera trae nombres en MAYÚSCULAS, minúsculas o mezcla: se muestran parejos
const nombreProp = s => String(s || '').toLowerCase()
  .replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
  .replace(/ (De|Del|La|Las|Los|Y) /g, w => w.toLowerCase())

// Minuto del día (desde las 00:00 de `fecha`) de un timestamp sin zona
// 'YYYY-MM-DDTHH:MM:SS'. Se lee del texto para no depender de la zona horaria
// del navegador; si cruza medianoche pasa de 1440.
const minDia = (ts, fecha) => {
  if (!ts || !fecha) return null
  const [d, t = '00:00:00'] = String(ts).replace(' ', 'T').split('T')
  const [y, m, dd] = d.split('-').map(Number)
  const [hh = 0, mi = 0, ss = 0] = t.slice(0, 8).split(':').map(Number)
  const [fy, fm, fd] = String(fecha).slice(0, 10).split('-').map(Number)
  if ([y, m, dd, fy, fm, fd, hh, mi].some(Number.isNaN)) return null
  return Math.round((Date.UTC(y, m - 1, dd) - Date.UTC(fy, fm - 1, fd)) / 86400000) * 1440 + hh * 60 + mi + (ss || 0) / 60
}
// 'HH:MM' de un minuto del día (trunca los segundos, como el reloj control)
const hhmm = m => {
  if (m == null || Number.isNaN(m)) return '—'
  const t = Math.floor(m + 1e-6)
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const deHHMM = s => {
  const r = /^(\d{1,2}):(\d{2})/.exec(String(s || ''))
  return r ? Number(r[1]) * 60 + Number(r[2]) : null
}

// Minutos de entrada que paga la pre-nómina: lo aprobado (snapshot) con tope
// en lo detectado. Mismo criterio que fn_asis_prenomina_calc.
const minAutorizados = (val, detectados) =>
  val?.decision === 'autorizada' ? Math.min(detectados || 0, val.min_extra_snapshot ?? detectados ?? 0) : 0

// Qué se autoriza un día según la regla. El tramo autorizable es
// [llegada, inicio del turno]: lo que la regla pida fuera de ese tramo no cuenta.
// regla = { modo:'todo'|'rango'|'minutos'|'nada', desde, hasta (null = inicio
// del turno), minutos } con horas en minutos del día.
function planDia(f, regla) {
  const det = f.minutos || 0
  if (!regla?.modo || regla.modo === 'nada') return { decision:'rechazada', min:0 }
  const lleg = minDia(f.entrada_real, f.fecha), ini = minDia(f.entrada_esperada, f.fecha)
  if (lleg == null || ini == null || lleg >= ini)
    return regla.modo === 'todo' ? { decision:'autorizada', min:det }
      : { decision:'rechazada', min:0, nota:'sin horas de marcaje para calcular el tramo' }
  let a = lleg, b = ini
  if (regla.modo === 'rango') { a = Math.max(lleg, regla.desde ?? lleg); b = Math.min(ini, regla.hasta ?? ini) }
  else if (regla.modo === 'minutos') a = Math.max(lleg, ini - Math.max(0, regla.minutos || 0))
  // Tramo completo: se usan los minutos del motor (la vista redondea los segundos)
  const completo = a <= lleg + 1e-6 && b >= ini - 1e-6
  const min = completo ? det : Math.max(0, Math.min(det, Math.round(b - a)))
  if (min <= 0) return { decision:'rechazada', min:0, nota:'sin minutos dentro del tramo autorizado' }
  return { decision:'autorizada', min, desde:a, hasta:b,
    nota: min < det ? `autorizado ${hhmm(a)}–${hhmm(b)}: ${fMin(min)} de ${fMin(det)}` : null }
}

// Horas extra que quedarían ese día para la pre-nómina: la entrada aprobada más
// la salida ya autorizada (menos lo compensado). En feriado no hay HE: el día
// trabajado se paga aparte. Tramo diario: 120 min al 1,5 y el exceso al 1,8.
function heDia(f, minEnt) {
  if (f.es_feriado) return { feriado:true, tot:0, t15:0, t18:0, sal:0, salPend:0 }
  const vs = f.valSal, extra = f.min_extra_dia || 0
  const sal = vs?.decision === 'autorizada'
    ? Math.max(Math.min(extra, vs.min_extra_snapshot ?? extra) - (vs.min_compensados || 0), 0) : 0
  const salPend = !vs && extra > 0 ? extra : 0
  const tot = minEnt + sal
  return { feriado:false, tot, sal, salPend, t15:Math.min(tot, TOPE_MIN), t18:Math.max(tot - TOPE_MIN, 0) }
}

// Eje horario común a un conjunto de días (horas completas)
function ejeDe(filas, pad = 15) {
  let ini = Infinity, fin = -Infinity
  for (const f of filas) {
    for (const ts of [f.entrada_real, f.entrada_esperada, f.inicio_colacion_real]) { const m = minDia(ts, f.fecha); if (m != null) ini = Math.min(ini, m) }
    for (const ts of [f.salida_real, f.salida_esperada, f.fin_colacion_real]) { const m = minDia(ts, f.fecha); if (m != null) fin = Math.max(fin, m) }
  }
  if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin <= ini) return { ini:7 * 60, fin:21 * 60 }
  return { ini:Math.max(0, Math.floor((ini - pad) / 60) * 60), fin:Math.ceil((fin + pad) / 60) * 60 }
}

// Línea de tiempo de un día. Todas las filas comparten el eje para compararse
// a simple vista. Capas: turno (marco), presencia real (gris, con el hueco de
// la colación), tiempo antes del turno (lo que se decide), lo autorizado,
// extra después del turno y salida anticipada.
function LineaDia({ f, ax, alto = 20, tramo, marcas, detalle = false }) {
  const F = f.fecha, span = Math.max(ax.fin - ax.ini, 60)
  const cl = m => Math.min(Math.max(m, ax.ini), ax.fin)
  const L = m => `${(cl(m) - ax.ini) / span * 100}%`
  const W = (a, b) => `${Math.max(cl(b) - cl(a), 0) / span * 100}%`
  const seg = (a, b, top, h, extra) => ({ position:'absolute', left:L(a), width:W(a, b), top:`${top}%`, height:`${h}%`,
    boxSizing:'border-box', borderRadius:2, ...extra })
  const eEsp = minDia(f.entrada_esperada, F), sEsp = minDia(f.salida_esperada, F)
  const eReal = minDia(f.entrada_real, F), sReal = minDia(f.salida_real, F)
  const cIni = minDia(f.inicio_colacion_real, F), cFin = minDia(f.fin_colacion_real, F)
  const resuelto = !!f.cat && f.cat !== 'pendiente'
  const rech = f.cat === 'rechazada'
  let tr = tramo
  if (tr === undefined) {
    tr = null
    if (f.cat === 'autorizada' && eReal != null && eEsp != null) {
      const d = deHHMM(f.val?.aut_desde), h = deHHMM(f.val?.aut_hasta)
      tr = d != null && h != null ? { desde:d, hasta:h } : { desde:Math.max(eReal, eEsp - (f.minAut || 0)), hasta:eEsp }
    }
  }
  const horas = []
  for (let h = Math.ceil(ax.ini / 60); h <= Math.floor(ax.fin / 60); h++) horas.push(h)
  const presencia = eReal != null && sReal != null && sReal > eReal
    ? (cIni != null && cFin != null && cIni > eReal && cFin < sReal && cFin > cIni ? [[eReal, cIni], [cFin, sReal]] : [[eReal, sReal]])
    : []
  const titulo = [
    eEsp != null && sEsp != null ? `Turno ${hhmm(eEsp)}–${hhmm(sEsp)}` : null,
    eReal != null ? `llegó ${hhmm(eReal)}` : 'sin marca de entrada',
    sReal != null ? `salió ${hhmm(sReal)}` : 'sin marca de salida',
    cIni != null && cFin != null ? `colación ${hhmm(cIni)}–${hhmm(cFin)}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <div title={detalle ? undefined : titulo} style={{ position:'relative', height:alto }}>
      {horas.map(h => (
        <span key={h} style={{ position:'absolute', top:0, bottom:0, left:L(h * 60), width:1,
          background: detalle || h % 2 === 0 ? 'var(--border)' : 'transparent' }}/>
      ))}
      {eEsp != null && sEsp != null && (
        <span style={seg(eEsp, sEsp, 0, 100, { background:'rgba(22,33,62,.05)', border:'1px solid rgba(22,33,62,.22)', borderRadius:3 })}/>
      )}
      {presencia.map(([a, b], i) => <span key={i} style={seg(a, b, 37, 26, { background:LT.presencia })}/>)}
      {presencia.length > 1 && (
        <span style={{ position:'absolute', left:L(cIni), width:W(cIni, cFin), top:'50%', borderTop:`1px dotted ${LT.presencia}` }}/>
      )}
      {eReal != null && eEsp != null && eReal < eEsp && (
        <span style={seg(eReal, eEsp, 18, 64, (tr || resuelto)
          ? { background:RAYADO(rech && !tr ? 'rgba(110,110,115,.38)' : 'rgba(178,94,9,.38)'),
              border:`1px solid ${rech && !tr ? 'rgba(110,110,115,.45)' : 'rgba(178,94,9,.5)'}` }
          : { background:LT.antes })}/>
      )}
      {tr && tr.hasta > tr.desde && <span style={seg(tr.desde, tr.hasta, 18, 64, { background:LT.aut })}/>}
      {sEsp != null && sReal != null && sReal > sEsp && (f.min_extra_dia || 0) > 0 && (
        <span style={seg(sEsp, sReal, 18, 64, { background:LT.despues, opacity:.85 })}/>
      )}
      {sEsp != null && sReal != null && sReal < sEsp && (f.min_salida_anticipada_contable || 0) > 0 && (
        <span style={seg(sReal, sEsp, 18, 64, { border:`1px dashed ${LT.salida}`, background:'rgba(180,35,24,.06)' })}/>
      )}
      {eEsp != null && (
        <span style={{ position:'absolute', top:-2, bottom:-2, left:L(eEsp), width:2, marginLeft:-1, background:LT.turno, borderRadius:1 }}/>
      )}
      {detalle && (marcas || []).map((mk, i) => {
        const m = minDia(mk.hora, F)
        return m == null ? null : (
          <span key={i} title={`${hhmm(m)} · ${mk.tipo === 0 ? 'entrada' : 'salida'}`}
            style={{ position:'absolute', top:-5, bottom:-5, left:L(m), width:1, background:'var(--text)', opacity:.5 }}/>
        )
      })}
    </div>
  )
}

function EjeHoras({ ax, cada = 1 }) {
  const span = Math.max(ax.fin - ax.ini, 60), hs = []
  for (let h = Math.ceil(ax.ini / 60); h <= Math.floor(ax.fin / 60); h++) if (h % cada === 0) hs.push(h)
  return (
    <div style={{ position:'relative', height:13 }}>
      {hs.map(h => (
        <span key={h} style={{ position:'absolute', top:0, left:`${(h * 60 - ax.ini) / span * 100}%`, transform:'translateX(-50%)',
          fontSize:10, lineHeight:'13px', color:'var(--text-muted)', fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
          {String(h % 24).padStart(2, '0')}
        </span>
      ))}
    </div>
  )
}

function Leyenda() {
  const it = (st, l) => (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}>
      <span style={{ display:'inline-block', width:18, height:9, borderRadius:2, boxSizing:'border-box', ...st }}/>{l}
    </span>
  )
  return (
    <span style={{ display:'flex', gap:'6px 14px', flexWrap:'wrap', fontSize:11.5, color:'var(--text-muted)' }}>
      {it({ background:'rgba(22,33,62,.05)', border:'1px solid rgba(22,33,62,.22)' }, 'Turno')}
      {it({ background:LT.presencia, height:5 }, 'Presencia')}
      {it({ background:LT.antes }, 'Antes del turno')}
      {it({ background:LT.aut }, 'Autorizado')}
      {it({ background:LT.despues }, 'Después del turno')}
      {it({ border:`1px dashed ${LT.salida}`, background:'rgba(180,35,24,.06)' }, 'Salida anticipada')}
    </span>
  )
}

// Una fila por día: fecha y turno · llegó / debía · anticipación · línea del
// día · resto del día · estado o acción.
function FilaEntrada({ f, ax, cols, angosto, puede, marcado, onToggle, onDecidir, onAnular, noms }) {
  const F = f.fecha
  const eEsp = minDia(f.entrada_esperada, F), eReal = minDia(f.entrada_real, F), sReal = minDia(f.salida_real, F)
  const resuelto = f.cat !== 'pendiente'
  const elegible = puede && !resuelto && !f.cerrado
  const salAnt = f.min_salida_anticipada_contable || 0, extra = f.min_extra_dia || 0
  const estSal = f.valSal ? (f.valSal.decision === 'autorizada' ? 'autorizada' : 'rechazada') : 'por decidir'

  const cFecha = (
    <div style={{ minWidth:0 }}>
      <div style={{ fontSize:13, fontWeight:650, whiteSpace:'nowrap' }}>{fDiaFecha(F)}</div>
      <div style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
        {f.es_feriado ? <span style={{ color:LT.turno, fontWeight:700 }}>Feriado</span> : `Turno ${f.workshift_name || '—'}`}
        {f.turno_corregido ? ' · corregido' : ''}
      </div>
    </div>
  )
  const cLlegada = (
    <div style={{ fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
      <div style={{ fontSize:13 }}>Llegó <b style={{ fontWeight:700 }}>{hhmm(eReal)}</b></div>
      <div style={{ fontSize:11.5, color:'var(--text-muted)' }}>debía {hhmm(eEsp)}</div>
    </div>
  )
  const cAntes = (
    <div style={{ fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
      <div style={{ fontSize:15, fontWeight:700, lineHeight:1.25,
        color: resuelto ? 'var(--text-muted)' : f.minutos > 30 ? LT.antes : 'var(--text)',
        textDecoration: f.cat === 'rechazada' ? 'line-through' : 'none' }}>{fMin(f.minutos)}</div>
      <div style={{ fontSize:11, color:'var(--text-muted)' }}>antes del turno</div>
    </div>
  )
  const cResto = (
    <div style={{ minWidth:0, fontVariantNumeric:'tabular-nums' }}>
      <div style={{ fontSize:12.5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
        {sReal != null ? <>Salió <b style={{ fontWeight:650 }}>{hhmm(sReal)}</b></> : <span style={{ color:'var(--text-muted)' }}>Sin marca de salida</span>}
        {salAnt > 0 && <span style={{ color:LT.salida, fontWeight:600 }}> · {fMin(salAnt)} antes</span>}
        {extra > 0 && <span style={{ color:LT.despues, fontWeight:600 }}> · +{fMin(extra)} después</span>}
      </div>
      <div style={{ fontSize:11.5, color:'var(--text-muted)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
        Trabajó {fMin(f.min_trabajados_efectivos)}
        {extra > 0 ? ` · salida ${estSal}` : f.min_turno_neto ? ` · turno ${fMin(f.min_turno_neto)}` : ''}
      </div>
    </div>
  )
  const cEstado = resuelto ? (
    <div style={{ textAlign:'right', minWidth:0 }}>
      <div style={{ fontSize:12.5, fontWeight:650, whiteSpace:'nowrap', color: f.cat === 'autorizada' ? LT.aut : 'var(--text-muted)' }}>
        {f.cat === 'autorizada'
          ? (f.parcial ? `Autorizada ${fMin(f.minAut)} de ${fMin(f.minutos)}` : `Autorizada ${fMin(f.minAut)}`)
          : 'No requerida'}
      </div>
      <div style={{ fontSize:11, color:'var(--text-muted)', display:'flex', gap:8, justifyContent:'flex-end', alignItems:'baseline', whiteSpace:'nowrap' }}>
        <span title={f.val?.justificacion || ''} style={{ overflow:'hidden', textOverflow:'ellipsis', maxWidth:150 }}>
          {f.parcial && f.val?.aut_desde && f.val?.aut_hasta ? `${String(f.val.aut_desde).slice(0, 5)}–${String(f.val.aut_hasta).slice(0, 5)} · ` : ''}
          {noms?.[f.val?.validado_por] || f.val?.validado_por || ''}
        </span>
        {puede && f.val && !f.cerrado && (
          <button onClick={() => onAnular?.(f)} title='Volver a dejarla pendiente' style={stLink}>Deshacer</button>
        )}
      </div>
    </div>
  ) : f.reservadoA ? (
    <span title='Horas de una jefatura: las valida su superior directo'
      style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', border:'1px solid var(--border)', borderRadius:4, padding:'3px 8px', whiteSpace:'nowrap' }}>
      la valida {f.reservadoA}
    </span>
  ) : elegible ? (
    <button onClick={onDecidir} style={{ ...btnSec, fontWeight:650, padding:'6px 16px' }}>Decidir</button>
  ) : null

  const cCheck = (
    <div>{elegible && (
      <input type='checkbox' checked={marcado} onChange={onToggle} aria-label={`Seleccionar ${fDiaFecha(F)}`} style={{ cursor:'pointer' }}/>
    )}</div>
  )
  const fondo = marcado ? 'rgba(22,33,62,.05)' : 'transparent'
  if (angosto) return (
    <div data-fila={f.key} style={{ display:'grid', gridTemplateColumns:cols, columnGap:10, rowGap:7, alignItems:'center',
      padding:'10px 14px', borderTop:'1px solid var(--border)', background:fondo }}>
      {cCheck}{cFecha}{cLlegada}{cAntes}
      <div style={{ justifySelf:'end' }}>{cEstado}</div>
      <div style={{ gridColumn:'2 / -1' }}><LineaDia f={f} ax={ax} alto={18}/></div>
      <div style={{ gridColumn:'2 / -1' }}>{cResto}</div>
    </div>
  )
  return (
    <div data-fila={f.key} style={{ display:'grid', gridTemplateColumns:cols, columnGap:14, alignItems:'center',
      padding:'9px 14px', borderTop:'1px solid var(--border)', background:fondo }}>
      {cCheck}{cFecha}{cLlegada}{cAntes}
      <LineaDia f={f} ax={ax} alto={20}/>
      {cResto}
      <div style={{ justifySelf:'end', minWidth:0, maxWidth:'100%' }}>{cEstado}</div>
    </div>
  )
}

function VistaEntrada({ filas, pendientes, puede, sel, toggleSel, selItems = [], setSel, onDecidir, onAnular, onFicha, noms, cargos = {} }) {
  const [verTodas, setVerTodas] = useState(false)
  const [soloLargas, setSoloLargas] = useState(false)
  const [contraidos, setContraidos] = useState(() => new Set())
  const { w } = useResponsive()
  const angosto = w < 1180
  const COLS = angosto ? '24px minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) auto'
                       : '24px 96px 92px 100px minmax(260px,1fr) 230px 196px'

  const base = verTodas ? filas : pendientes
  const lista = useMemo(() => soloLargas ? base.filter(f => f.minutos > 30) : base, [base, soloLargas])
  const nLargas = base.filter(f => f.minutos > 30).length
  const totMin = pendientes.reduce((s, f) => s + (f.minutos || 0), 0)
  const ax = useMemo(() => ejeDe(lista), [lista])
  const cada = (ax.fin - ax.ini) / 60 > 12 ? 2 : 1

  // Por persona: primero quien tiene más tiempo esperando decisión; sus días
  // en orden cronológico para leer la semana de corrido.
  const grupos = useMemo(() => {
    const m = new Map()
    for (const f of lista) {
      let g = m.get(f.cod_contaline)
      if (!g) { g = { cod:f.cod_contaline, nombre:f.nombre, suc:f.sucursal_id, items:[], min:0, minPend:0, nPend:0, reservadoA:null }
                m.set(f.cod_contaline, g) }
      g.items.push(f); g.min += f.minutos || 0
      if (f.cat === 'pendiente' && !f.cerrado) { g.nPend++; g.minPend += f.minutos || 0 }
      if (f.reservadoA) g.reservadoA = f.reservadoA
    }
    const gs = [...m.values()]
    for (const g of gs) g.items.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
    return gs.sort((a, b) => b.minPend - a.minPend || b.min - a.min || String(a.nombre).localeCompare(String(b.nombre)))
  }, [lista])

  // Patrón sobre todo el período (no sobre el filtro): muchos días llegando más
  // de una hora antes suele ser un turno mal cargado en Workera.
  const patron = useMemo(() => {
    const m = {}
    for (const f of filas) {
      if ((f.minutos || 0) < 60) continue
      const p = (m[f.cod_contaline] ??= { n:0, min:0 })
      p.n++; p.min += f.minutos
    }
    return m
  }, [filas])

  const selGrupo = (g, on) => setSel(prev => {
    const n = new Set(prev)
    for (const it of g.items) if (it.cat === 'pendiente' && !it.cerrado) on ? n.add(it.key) : n.delete(it.key)
    return n
  })
  const todasDe = g => g.nPend > 0 && g.items.every(i => i.cat !== 'pendiente' || i.cerrado || sel?.has(i.key))
  const alternar = cod => setContraidos(p => { const n = new Set(p); n.has(cod) ? n.delete(cod) : n.add(cod); return n })

  return (
    <div>
      <div style={{ marginBottom:12, padding:'10px 14px', borderRadius:9, background:'var(--bg-surface)', border:'1px solid var(--border)',
        display:'flex', gap:'8px 24px', alignItems:'center', flexWrap:'wrap' }}>
        <span style={{ flex:'1 1 460px', fontSize:12.5, lineHeight:1.5 }}>
          Llegar antes del turno <b>no genera horas extra por sí solo</b>: cuenta solo lo que la jefatura pidió (Art. 32, pacto previo).
          Puedes autorizar todo, un rango horario o una cantidad de minutos; el resto queda como no requerido.
        </span>
        <Leyenda/>
      </div>

      {!puede && (
        <div style={{ marginBottom:10, padding:'9px 13px', borderRadius:7, fontSize:12, background:'var(--bg-surface)',
          border:'1px solid var(--border)', color:'var(--text-muted)' }}>
          Modo consulta: puedes revisar cada día, pero no decidir.
        </div>
      )}

      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:12 }}>
        <span style={{ fontSize:13, fontWeight:650, fontVariantNumeric:'tabular-nums' }}>
          {pendientes.length ? `${pendientes.length} por decidir · ${fMin(totMin)}` : 'Nada por decidir en el período'}
        </span>
        {puede && pendientes.length > 0 && (
          <button onClick={() => onDecidir(pendientes, 'nada')} style={{ ...btnPri, background:LT.antes, padding:'7px 15px' }}>
            {pendientes.length === 1 ? 'Marcar como no requerida' : `Marcar las ${pendientes.length} como no requeridas`}
          </button>
        )}
        {nLargas > 0 && (
          <button onClick={() => setSoloLargas(v => !v)} style={stChipNum(soloLargas)}>Solo sobre 30 min ({nLargas})</button>
        )}
        <label style={{ fontSize:12, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
          <input type='checkbox' checked={verTodas} onChange={e => setVerTodas(e.target.checked)}/>
          Ver también las ya resueltas
        </label>
        {grupos.length > 1 && (
          <button onClick={() => setContraidos(contraidos.size ? new Set() : new Set(grupos.map(g => g.cod)))}
            style={{ ...stLink, marginLeft:'auto' }}>
            {contraidos.size ? 'Expandir todo' : 'Contraer todo'}
          </button>
        )}
      </div>

      {lista.length === 0 ? (
        <div style={{ padding:'44px 20px', textAlign:'center', border:'1px solid var(--border)', borderRadius:10, background:'var(--bg-surface)' }}>
          <div style={{ fontWeight:650, fontSize:15, marginBottom:4 }}>Nada que decidir acá</div>
          <div style={{ fontSize:12.5, color:'var(--text-muted)' }}>No hay llegadas anticipadas esperando tu decisión en este período.</div>
        </div>
      ) : (
        <div style={{ border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', background:'var(--bg-surface)' }}>
          {grupos.map((g, gi) => {
            const abierto = !contraidos.has(g.cod)
            const p = patron[g.cod]
            return (
              <div key={g.cod} style={{ borderTop: gi ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display:'grid', gridTemplateColumns:COLS, columnGap: angosto ? 10 : 14, alignItems:'center',
                  padding:'10px 14px', background:'var(--bg-card)' }}>
                  <div>{puede && g.nPend > 0 && !g.reservadoA && (
                    <input type='checkbox' checked={todasDe(g)} onChange={e => selGrupo(g, e.target.checked)}
                      title={`Seleccionar los ${g.nPend} días pendientes`} style={{ cursor:'pointer' }}/>
                  )}</div>
                  <div style={{ gridColumn: angosto ? '2 / 4' : '2 / 5', minWidth:0, display:'flex', alignItems:'center', gap:8 }}>
                    <button onClick={() => alternar(g.cod)} aria-label={abierto ? 'Contraer' : 'Expandir'}
                      style={{ background:'none', border:'none', cursor:'pointer', padding:0, width:14, color:'var(--text-muted)', fontSize:11 }}>
                      {abierto ? '▾' : '▸'}
                    </button>
                    <div style={{ minWidth:0 }}>
                      <span onClick={() => onFicha?.(g.cod, g.nombre)} title='Ver la ficha del mes'
                        style={{ fontWeight:650, fontSize:13.5, cursor:'pointer', textDecoration:'underline', textDecorationStyle:'dotted',
                          textUnderlineOffset:3, display:'block', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {nombreProp(g.nombre)}
                      </span>
                      <span style={{ fontSize:11.5, color:'var(--text-muted)', display:'block', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {[cargos[g.cod], g.suc].filter(Boolean).join(' · ')}
                        {g.reservadoA && <b style={{ fontWeight:600 }}> · la valida {g.reservadoA}</b>}
                      </span>
                    </div>
                  </div>
                  {!angosto && <div style={{ alignSelf:'end' }}><EjeHoras ax={ax} cada={cada}/></div>}
                  <div style={{ fontVariantNumeric:'tabular-nums', textAlign: angosto ? 'right' : 'left' }}>
                    <div style={{ fontSize:13.5, fontWeight:700 }}>{fMin(g.nPend ? g.minPend : g.min)}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                      {g.nPend ? `${g.nPend} ${g.nPend === 1 ? 'día' : 'días'} por decidir`
                               : `${g.items.length} ${g.items.length === 1 ? 'día' : 'días'} · resuelto`}
                    </div>
                  </div>
                  <div style={{ justifySelf:'end' }}>
                    {puede && g.nPend > 0 && !g.reservadoA && (
                      <button onClick={() => onDecidir(g.items.filter(i => i.cat === 'pendiente' && !i.cerrado), null)}
                        style={{ ...btnSec, fontWeight:650, padding:'6px 12px', whiteSpace:'nowrap' }}>
                        {g.nPend === 1 ? 'Decidir el día' : `Decidir los ${g.nPend} días`}
                      </button>
                    )}
                  </div>
                </div>
                {p && p.n >= 3 && (
                  <div style={{ padding:`0 14px 9px ${angosto ? 70 : 74}px`, fontSize:12, color:LT.antes, background:'var(--bg-card)', lineHeight:1.45 }}>
                    Llegó más de 1 h antes en {p.n} días del período (promedio {fMin(Math.round(p.min / p.n))}).
                    Revisa si el turno cargado en Workera es el que realmente hace.
                  </div>
                )}
                {abierto && g.items.map(f => (
                  <FilaEntrada key={f.key} f={f} ax={ax} cols={COLS} angosto={angosto} puede={puede}
                    marcado={!!sel?.has(f.key)} onToggle={() => toggleSel?.(f.key)}
                    onDecidir={() => onDecidir([f], null)} onAnular={onAnular} noms={noms}/>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {puede && selItems.length > 0 && (
        <div style={{ position:'sticky', bottom:16, marginTop:14, display:'flex', alignItems:'center', justifyContent:'space-between',
          gap:12, flexWrap:'wrap', padding:'11px 16px', borderRadius:9, background:'var(--text)', color:'var(--bg-surface)',
          boxShadow:'0 6px 22px rgba(0,0,0,.18)', zIndex:20 }}>
          <span style={{ fontSize:13, fontWeight:600, fontVariantNumeric:'tabular-nums' }}>
            {selItems.length} {selItems.length === 1 ? 'día seleccionado' : 'días seleccionados'} · {fMin(selItems.reduce((a, i) => a + (i.minutos || 0), 0))} antes del turno
          </span>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button onClick={() => setSel(new Set())} style={{ background:'none', border:'none', color:'var(--bg-surface)',
              opacity:.7, cursor:'pointer', fontSize:12.5 }}>Quitar selección</button>
            <button onClick={() => onDecidir(selItems, null)} style={{ ...btnPri, background:LT.aut, padding:'7px 16px' }}>
              {selItems.length === 1 ? 'Decidir el día' : `Decidir los ${selItems.length}`}
            </button>
            <button onClick={() => onDecidir(selItems, 'nada')} style={{ ...btnPri, background:LT.antes, padding:'7px 16px' }}>No requeridas</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Modal de decisión de llegada anticipada ──────────────────────────────────
// Sirve para uno o varios días: la regla (todo, rango, minutos o nada) se aplica
// a cada día con sus propias horas, y la vista previa muestra el resultado y
// cómo queda el día en los tramos de pago (1,5 / 1,8).
function Opcion({ k, modo, onElegir, titulo, desc, children }) {
  const on = modo === k, gris = k === 'nada'
  return (
    <div onClick={() => { if (!on) onElegir(k) }}
      style={{ padding:'10px 12px', borderRadius:10, cursor: on ? 'default' : 'pointer',
        border:`1.5px solid ${on ? (gris ? '#8E8E93' : LT.aut) : 'var(--border)'}`,
        background: on ? (gris ? 'rgba(142,142,147,.07)' : 'rgba(30,122,68,.05)') : 'var(--bg-surface)' }}>
      <label style={{ display:'flex', alignItems:'center', gap:9, cursor:'pointer' }}>
        <input type='radio' name='modo-entrada' checked={on} onChange={() => onElegir(k)}/>
        <span style={{ fontWeight:650, fontSize:13.5 }}>{titulo}</span>
        {desc && <span style={{ marginLeft:'auto', fontSize:12, color:'var(--text-muted)', fontVariantNumeric:'tabular-nums', textAlign:'right' }}>{desc}</span>}
      </label>
      {on && children && <div style={{ marginTop:10, paddingLeft:25 }}>{children}</div>}
    </div>
  )
}

function ContextoDia({ f, ax, tramo, marcas }) {
  const F = f.fecha
  const eEsp = minDia(f.entrada_esperada, F), sEsp = minDia(f.salida_esperada, F)
  const eReal = minDia(f.entrada_real, F), sReal = minDia(f.salida_real, F)
  const cIni = minDia(f.inicio_colacion_real, F), cFin = minDia(f.fin_colacion_real, F)
  const span = Math.max(ax.fin - ax.ini, 60)
  const px = m => `${(Math.min(Math.max(m, ax.ini), ax.fin) - ax.ini) / span * 100}%`
  // Etiquetas sobre la barra: las vecinas se abren hacia lados opuestos
  const etq = []
  if (eReal != null) etq.push({ m:eReal, t:`llegó ${hhmm(eReal)}`, izq: eEsp == null || eReal <= eEsp, fuerte:true })
  if (eEsp != null) etq.push({ m:eEsp, t:`inicio turno ${hhmm(eEsp)}`, izq: eReal != null && eReal > eEsp })
  const salidaJunta = sReal != null && sEsp != null && Math.abs(sReal - sEsp) < 3
  if (sEsp != null && !salidaJunta) etq.push({ m:sEsp, t:`término ${hhmm(sEsp)}`, izq: sReal != null && sReal > sEsp })
  if (sReal != null) etq.push({ m:sReal, t:`salió ${hhmm(sReal)}`, izq: !salidaJunta && sEsp != null && sReal < sEsp, fuerte:true })
  const salAnt = f.min_salida_anticipada_contable || 0, extra = f.min_extra_dia || 0
  const estSal = f.valSal ? (f.valSal.decision === 'autorizada' ? 'autorizada' : 'rechazada') : 'por decidir'
  return (
    <div>
      <div style={{ position:'relative', height:18, marginBottom:4 }}>
        {etq.map((e, i) => (
          <span key={i} style={{ position:'absolute', left:px(e.m), bottom:0, whiteSpace:'nowrap', fontSize:11.5,
            transform: e.izq ? 'translateX(calc(-100% - 5px))' : 'translateX(5px)', fontVariantNumeric:'tabular-nums',
            fontWeight: e.fuerte ? 700 : 500, color: e.fuerte ? 'var(--text)' : 'var(--text-muted)' }}>{e.t}</span>
        ))}
      </div>
      <LineaDia f={f} ax={ax} alto={30} tramo={tramo} marcas={marcas} detalle/>
      <div style={{ marginTop:5 }}><EjeHoras ax={ax}/></div>

      <table style={{ marginTop:12, borderCollapse:'collapse', fontSize:12.5, fontVariantNumeric:'tabular-nums' }}>
        <thead>
          <tr>{['', 'Debía', 'Marcó', ''].map((h, i) => <th key={i} style={stTh}>{h}</th>)}</tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...stTd, color:'var(--text-muted)' }}>Entrada</td>
            <td style={stTd}>{hhmm(eEsp)}</td>
            <td style={stTd}><b>{hhmm(eReal)}</b></td>
            <td style={{ ...stTd, color:LT.antes, fontWeight:700 }}>{fMin(f.minutos)} antes del turno</td>
          </tr>
          <tr>
            <td style={{ ...stTd, color:'var(--text-muted)' }}>Salida</td>
            <td style={stTd}>{hhmm(sEsp)}</td>
            <td style={stTd}><b>{sReal != null ? hhmm(sReal) : 'sin marca'}</b></td>
            <td style={stTd}>
              {sReal == null ? '—'
                : salAnt > 0 ? <span style={{ color:LT.salida, fontWeight:650 }}>{fMin(salAnt)} antes del término</span>
                : extra > 0 ? <span style={{ color:LT.despues, fontWeight:650 }}>+{fMin(extra)} después del turno · {estSal}</span>
                : <span style={{ color:'var(--text-muted)' }}>a la hora</span>}
            </td>
          </tr>
          <tr>
            <td style={{ ...stTd, color:'var(--text-muted)' }}>Colación</td>
            <td style={stTd}>{f.min_colacion_esperada ? fMin(f.min_colacion_esperada) : '—'}</td>
            <td style={stTd}>{cIni != null && cFin != null ? <b>{hhmm(cIni)}–{hhmm(cFin)}</b> : 'no marcada'}</td>
            <td style={{ ...stTd, color:'var(--text-muted)' }}>{f.min_colacion_real > 0 ? fMin(f.min_colacion_real) : ''}</td>
          </tr>
          <tr>
            <td style={{ ...stTd, color:'var(--text-muted)' }}>Jornada</td>
            <td style={stTd}>{fMin(f.min_turno_neto)}</td>
            <td style={stTd}><b>{fMin(f.min_trabajados_efectivos)}</b></td>
            <td style={{ ...stTd, color:'var(--text-muted)' }}>trabajados · {fMin(f.min_presencia)} de presencia</td>
          </tr>
        </tbody>
      </table>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center', marginTop:10, fontSize:11.5 }}>
        <span style={{ color:'var(--text-muted)', marginRight:2 }}>Marcas del reloj</span>
        {marcas == null ? <span style={{ color:'var(--text-muted)' }}>cargando…</span>
          : marcas.length === 0 ? <span style={{ color:'var(--text-muted)' }}>sin detalle</span>
          : marcas.map((mk, i) => (
            <span key={i} style={{ padding:'2px 9px', borderRadius:100, border:'1px solid var(--border)', background:'var(--bg-card)',
              fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>
              <b style={{ fontWeight:650 }}>{hhmm(minDia(mk.hora, F))}</b> {mk.tipo === 0 ? 'entrada' : 'salida'}
              {mk.origen && String(mk.origen).toUpperCase() !== 'RELOJ' ? ` · ${String(mk.origen).toLowerCase()}` : ''}
            </span>
          ))}
      </div>
    </div>
  )
}

function TablaDias({ planes, modo, ax }) {
  const varias = new Set(planes.map(p => p.item.cod_contaline)).size > 1
  const cab = [varias ? 'Persona' : null, 'Día', 'Llegó', 'Debía', 'Antes', modo ? 'Se autoriza' : null, 'Día completo'].filter(Boolean)
  return (
    <div style={{ maxHeight:300, overflowY:'auto', border:'1px solid var(--border)', borderRadius:10 }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5, fontVariantNumeric:'tabular-nums' }}>
        <thead>
          <tr>{cab.map(h => (
            <th key={h} style={{ ...stTh, padding:'8px 10px', position:'sticky', top:0, background:'var(--bg-card)', zIndex:1 }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {planes.map(p => {
            const f = p.item, aut = p.decision === 'autorizada'
            const fv = modo ? { ...f, cat: aut ? 'autorizada' : 'rechazada' } : f
            const td = { ...stTd, padding:'6px 10px' }
            return (
              <tr key={f.key}>
                {varias && <td style={{ ...td, maxWidth:170, overflow:'hidden', textOverflow:'ellipsis' }}>{nombreProp(f.nombre).split(' ').slice(0, 2).join(' ')}</td>}
                <td style={td}>{fDiaFecha(f.fecha)}{f.es_feriado && <span style={{ color:LT.turno, fontWeight:650 }}> · feriado</span>}</td>
                <td style={td}>{hhmm(minDia(f.entrada_real, f.fecha))}</td>
                <td style={td}>{hhmm(minDia(f.entrada_esperada, f.fecha))}</td>
                <td style={td}>{fMin(f.minutos)}</td>
                {modo && (
                  <td style={{ ...td, fontWeight:650, color: aut ? LT.aut : 'var(--text-muted)' }}>
                    {aut ? fMin(p.min) : 'no requerida'}
                    {aut && p.desde != null && p.min < (f.minutos || 0) && (
                      <span style={{ fontWeight:400, color:'var(--text-muted)' }}> · {hhmm(p.desde)}–{hhmm(p.hasta)}</span>
                    )}
                  </td>
                )}
                <td style={{ ...td, width:'42%', minWidth:220, whiteSpace:'normal' }}>
                  <LineaDia f={fv} ax={ax} alto={14} tramo={modo ? (aut && p.desde != null ? { desde:p.desde, hasta:p.hasta } : null) : undefined}/>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AvisosEntrada({ items }) {
  const av = []
  if (items.length === 1) {
    const f = items[0]
    if (f.es_feriado) av.push([LT.turno, `Feriado${f.feriado_nombre ? ` (${f.feriado_nombre})` : ''}: en feriado no se generan horas extra; el día trabajado se paga aparte (6 h al 2,0). Lo que decidas queda registrado, pero no cambia el pago.`])
    if ((f.min_salida_anticipada_contable || 0) > 0) av.push([LT.salida, `Ese día salió ${fMin(f.min_salida_anticipada_contable)} antes del término de su turno.`])
    if ((f.min_presencia || 0) > 600) av.push([LT.antes, `Estuvo ${fMin(f.min_presencia)} en la empresa ese día.`])
    if (f.turno_corregido) av.push(['#6E6E73', 'El turno de este día fue corregido manualmente.'])
  } else {
    const nFer = items.filter(i => i.es_feriado).length
    const nSal = items.filter(i => (i.min_salida_anticipada_contable || 0) > 0).length
    const nLar = items.filter(i => (i.min_presencia || 0) > 600).length
    if (nFer) av.push([LT.turno, `${nFer} ${nFer === 1 ? 'día es feriado' : 'días son feriado'}: no generan horas extra (el día trabajado se paga aparte).`])
    if (nSal) av.push([LT.salida, `${nSal} ${nSal === 1 ? 'día tiene' : 'días tienen'} salida anticipada: revísalos en la columna "Día completo".`])
    if (nLar) av.push([LT.antes, `${nLar} ${nLar === 1 ? 'día' : 'días'} con más de 10 h de presencia.`])
  }
  if (!av.length) return null
  return (
    <div style={{ display:'grid', gap:6 }}>
      {av.map(([c, t], i) => (
        <div key={i} style={{ fontSize:12.5, lineHeight:1.45, padding:'7px 11px', borderRadius:8, borderLeft:`3px solid ${c}`, background:'var(--bg-card)' }}>{t}</div>
      ))}
    </div>
  )
}

function ModalEntrada({ items, modoInicial = null, onCerrar, onConfirmar }) {
  const uno = items.length === 1 ? items[0] : null
  const lleg1 = uno ? minDia(uno.entrada_real, uno.fecha) : null
  const ini1 = uno ? minDia(uno.entrada_esperada, uno.fecha) : null
  const [modo, setModo] = useState(modoInicial)
  const [desde, setDesde] = useState(() => lleg1 != null && ini1 != null ? hhmm(Math.max(lleg1, ini1 - 60)) : '')
  const [hasta, setHasta] = useState(() => ini1 != null ? hhmm(ini1) : '')
  const [hastaInicio, setHastaInicio] = useState(true)
  const [minutos, setMinutos] = useState(() => uno ? String(Math.min(uno.minutos || 0, 60)) : '')
  const [just, setJust] = useState(modoInicial === 'nada' ? DEF_NADA : '')
  const [enviando, setEnviando] = useState(false)
  const [marcas, setMarcas] = useState(null)

  // Las marcas del reloj se traen solo al abrir un día (no en la carga masiva)
  useEffect(() => {
    if (!uno) return
    let vivo = true
    supabase.from('v_asis_jornadas').select('marcajes_detalle')
      .eq('cod_contaline', uno.cod_contaline).eq('fecha', uno.fecha).maybeSingle()
      .then(({ data }) => { if (vivo) setMarcas(Array.isArray(data?.marcajes_detalle) ? data.marcajes_detalle : []) },
            () => { if (vivo) setMarcas([]) })
    return () => { vivo = false }
  }, [uno])
  useEffect(() => {
    const k = e => { if (e.key === 'Escape' && !enviando) onCerrar() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [enviando, onCerrar])

  const desdeM = deHHMM(desde), hastaM = hastaInicio ? null : deHHMM(hasta)
  const minN = Math.floor(Number(minutos) || 0)
  const regla = useMemo(() => ({ modo, desde:desdeM, hasta:hastaM, minutos:minN }), [modo, desdeM, hastaM, minN])
  const planes = useMemo(() => items.map(item => ({ item, ...planDia(item, regla) })), [items, regla])
  const he = useMemo(() => planes.map(p => heDia(p.item, p.decision === 'autorizada' ? p.min : 0)), [planes])
  const axUno = useMemo(() => uno ? ejeDe([uno], 45) : null, [uno])
  const axVarios = useMemo(() => ejeDe(items), [items])

  const totDet = items.reduce((s, i) => s + (i.minutos || 0), 0)
  const totAut = planes.reduce((s, p) => s + (p.decision === 'autorizada' ? p.min : 0), 0)
  const nAut = planes.filter(p => p.decision === 'autorizada').length
  const t15 = he.reduce((s, h) => s + h.t15, 0), t18 = he.reduce((s, h) => s + h.t18, 0)
  const sobreTope = he.filter(h => h.tot > TOPE_MIN).length
  const personas = new Set(items.map(i => i.cod_contaline)).size
  const rangoMal = modo === 'rango' && !hastaInicio && desdeM != null && hastaM != null && hastaM <= desdeM
  const reglaOk = modo === 'todo' || modo === 'nada'
    || (modo === 'rango' && desdeM != null && (hastaInicio || (hastaM != null && !rangoMal)))
    || (modo === 'minutos' && minN > 0)
  const p1 = planes[0]
  const sinEfecto = !!uno && (modo === 'rango' || modo === 'minutos') && reglaOk && p1.decision !== 'autorizada'
  const ok = !!modo && reglaOk && !sinEfecto && just.trim().length >= 15 && !enviando
  const fVista = uno && modo ? { ...uno, cat: p1.decision === 'autorizada' ? 'autorizada' : 'rechazada' } : uno
  const tramo1 = uno && modo ? (p1.decision === 'autorizada' && p1.desde != null ? { desde:p1.desde, hasta:p1.hasta } : null) : undefined

  const elegir = k => {
    setModo(k)
    setJust(j => k === 'nada' ? (j.trim() ? j : DEF_NADA) : (j === DEF_NADA ? '' : j))
  }
  async function confirmar() {
    if (!ok) return
    setEnviando(true)
    await onConfirmar(planes.map(p => ({ item:p.item, decision:p.decision, min:p.min || 0,
      desde: p.desde != null ? hhmm(p.desde) : null, hasta: p.hasta != null ? hhmm(p.hasta) : null,
      nota: p.nota || null })), just.trim())
  }
  const etiqueta = enviando ? 'Guardando…' : !modo ? 'Elige qué autorizar'
    : uno ? (p1.decision === 'autorizada' ? `Autorizar ${fMin(p1.min)}` : 'Marcar como no requerida')
    : `Registrar ${items.length} días`

  return (
    <div onClick={() => { if (!enviando) onCerrar() }} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:1000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()} role='dialog' aria-modal='true' aria-label='Decidir llegada anticipada'
        style={{ background:'var(--bg-surface)', borderRadius:14, width:'100%', maxWidth:880, maxHeight:'92vh', overflowY:'auto',
          border:'1px solid var(--border)', boxShadow:'0 18px 50px rgba(0,0,0,.22)' }}>
        <div style={{ padding:'18px 22px 12px', borderBottom:'1px solid var(--border)', display:'flex', gap:12, alignItems:'flex-start' }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:2 }}>Llegada anticipada</div>
            {uno ? (
              <>
                <div style={{ fontSize:17, fontWeight:700 }}>{nombreProp(uno.nombre)}</div>
                <div style={{ fontSize:12.5, color:'var(--text-muted)', marginTop:2 }}>
                  {cap(fDiaLargo(uno.fecha))} · {uno.sucursal_id} · turno {uno.workshift_name || '—'} ({uno.schedule_name || `${hhmm(ini1)} - ${hhmm(minDia(uno.salida_esperada, uno.fecha))}`})
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize:17, fontWeight:700 }}>
                  {items.length} días · {personas > 1 ? `${personas} personas` : nombreProp(items[0].nombre)}
                </div>
                <div style={{ fontSize:12.5, color:'var(--text-muted)', marginTop:2 }}>{fMin(totDet)} detectados antes del turno</div>
              </>
            )}
          </div>
          <button onClick={onCerrar} disabled={enviando} aria-label='Cerrar'
            style={{ background:'none', border:'none', fontSize:18, cursor:'pointer', color:'var(--text-muted)', lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:'16px 22px', display:'grid', gap:16 }}>
          {uno ? <ContextoDia f={fVista} ax={axUno} tramo={tramo1} marcas={marcas}/> : <TablaDias planes={planes} modo={modo} ax={axVarios}/>}
          <AvisosEntrada items={items}/>

          <div>
            <div style={{ fontSize:13.5, fontWeight:700, marginBottom:8 }}>
              ¿Cuánto de este tiempo pediste?
              {!uno && <span style={{ fontWeight:400, fontSize:12, color:'var(--text-muted)' }}> Se aplica a cada día con sus propias horas.</span>}
            </div>
            <div style={{ display:'grid', gap:8 }}>
              <Opcion k='todo' modo={modo} onElegir={elegir} titulo='Todo lo que llegó antes'
                desc={uno ? `${fMin(uno.minutos)} · ${hhmm(lleg1)} → ${hhmm(ini1)}` : `${fMin(totDet)} en ${items.length} días`}/>
              <Opcion k='rango' modo={modo} onElegir={elegir} titulo='Un rango horario'
                desc={uno ? `entre ${hhmm(lleg1)} y ${hhmm(ini1)}` : 'mismo horario para cada día'}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', fontSize:12.5 }}>
                  <span>Desde</span>
                  <input type='time' value={desde} onChange={e => setDesde(e.target.value)} aria-label='Desde' style={inp}/>
                  <span>hasta</span>
                  <input type='time' value={hastaInicio ? (uno ? hhmm(ini1) : '') : hasta} disabled={hastaInicio}
                    onChange={e => setHasta(e.target.value)} aria-label='Hasta' style={{ ...inp, opacity: hastaInicio ? .55 : 1 }}/>
                  <label style={{ display:'inline-flex', alignItems:'center', gap:5, color:'var(--text-muted)', cursor:'pointer' }}>
                    <input type='checkbox' checked={hastaInicio} onChange={e => {
                      setHastaInicio(e.target.checked)
                      if (!e.target.checked && !hasta && ini1 != null) setHasta(hhmm(ini1))
                    }}/>
                    el inicio del turno
                  </label>
                </div>
                <div style={stHint}>
                  {!uno && hastaInicio ? '"Hasta" usa el inicio del turno de cada día. ' : ''}
                  Nunca se autoriza antes de que llegara ni después de que empezara su turno.
                </div>
                {rangoMal && <div style={{ ...stHint, color:LT.salida }}>La hora de término debe ser posterior a la de inicio.</div>}
              </Opcion>
              <Opcion k='minutos' modo={modo} onElegir={elegir} titulo='Una cantidad de minutos'
                desc={uno ? `hasta ${fMin(uno.minutos)}` : 'contados desde el inicio del turno'}>
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', fontSize:12.5 }}>
                  <input type='number' min={1} max={600} step={5} value={minutos} onChange={e => setMinutos(e.target.value)}
                    aria-label='Minutos' style={{ ...inp, width:84 }}/>
                  <span>min</span>
                  {[15, 30, 45, 60, 90, 120].map(n => (
                    <button key={n} type='button' onClick={() => setMinutos(String(n))} style={stChipNum(minN === n)}>{n}</button>
                  ))}
                </div>
                <div style={stHint}>Se cuentan hacia atrás desde el inicio del turno, con tope en lo que llegó antes.</div>
              </Opcion>
              <Opcion k='nada' modo={modo} onElegir={elegir} titulo='Nada: no la pedí' desc='queda como no requerida'/>
            </div>
          </div>

          {modo && (
            <div style={{ padding:'11px 14px', borderRadius:10, background:'var(--bg-card)', border:'1px solid var(--border)',
              fontSize:13, lineHeight:1.55, fontVariantNumeric:'tabular-nums' }}>
              {uno ? (
                sinEfecto ? (
                  <div style={{ color:LT.salida }}>El tramo elegido no cubre tiempo antes del turno (llegó {hhmm(lleg1)} y su turno empezaba a las {hhmm(ini1)}).</div>
                ) : p1.decision === 'autorizada' ? (
                  <div>
                    Se autoriza <b style={{ color:LT.aut }}>{fMin(p1.min)}</b>{p1.min < (uno.minutos || 0) ? ` de ${fMin(uno.minutos)}` : ''}
                    {p1.desde != null && <span style={{ color:'var(--text-muted)' }}> · de {hhmm(p1.desde)} a {hhmm(p1.hasta)}</span>}
                    {p1.min < (uno.minutos || 0) && <span style={{ color:'var(--text-muted)' }}>; el resto ({fMin((uno.minutos || 0) - p1.min)}) queda como no requerido</span>}.
                  </div>
                ) : (
                  <div>Queda como <b>no requerida</b>: no se paga como hora extra.</div>
                )
              ) : (
                <div>
                  {nAut > 0
                    ? <>Se autoriza{nAut === 1 ? '' : 'n'} <b style={{ color:LT.aut }}>{fMin(totAut)}</b> de {fMin(totDet)} en {nAut} {nAut === 1 ? 'día' : 'días'}</>
                    : <>Ningún día queda autorizado</>}
                  {items.length - nAut > 0 && (
                    <span style={{ color:'var(--text-muted)' }}> · {items.length - nAut} {items.length - nAut === 1 ? 'queda' : 'quedan'} como no requerida{items.length - nAut === 1 ? '' : 's'}{modo !== 'nada' ? ' (sin tiempo dentro del tramo)' : ''}</span>
                  )}.
                </div>
              )}
              {totAut > 0 && !sinEfecto && (
                <div style={{ fontSize:12.5, color:'var(--text-muted)', marginTop:4 }}>
                  {uno ? (he[0].feriado
                    ? 'Es feriado: no genera horas extra; el día trabajado se paga aparte.'
                    : <>
                        Horas extra del día con esta decisión: <b style={{ color:'var(--text)' }}>{fMin(he[0].tot)}</b>
                        {he[0].sal > 0 && ` (incluye ${fMin(he[0].sal)} de salida ya autorizada)`}
                        {' → '}{fMin(he[0].t15)} al 1,5{he[0].t18 > 0 && ` · ${fMin(he[0].t18)} al 1,8`}.
                        {he[0].tot > TOPE_MIN && <b style={{ color:LT.salida }}> Supera el tope legal de 2 h diarias (Art. 31).</b>}
                        {he[0].salPend > 0 && ` La salida de ese día (+${fMin(he[0].salPend)}) está por decidir: si se autoriza, se suma.`}
                      </>)
                  : <>
                      Horas extra de esos días: <b style={{ color:'var(--text)' }}>{fMin(t15)}</b> al 1,5
                      {t18 > 0 && <> · <b style={{ color:'var(--text)' }}>{fMin(t18)}</b> al 1,8</>}
                      {sobreTope > 0 && <b style={{ color:LT.salida }}> · {sobreTope} {sobreTope === 1 ? 'día supera' : 'días superan'} el tope legal de 2 h (Art. 31)</b>}.
                    </>}
                </div>
              )}
            </div>
          )}

          <div>
            <label style={{ display:'block', fontSize:12.5, fontWeight:650, marginBottom:5 }}>
              Justificación <span style={{ fontWeight:400, color:'var(--text-muted)' }}>· obligatoria, queda en el registro de la decisión</span>
            </label>
            <textarea value={just} onChange={e => setJust(e.target.value)} rows={2}
              placeholder={modo === 'nada' ? 'Ej: No hubo requerimiento; llegó antes por decisión propia.' : 'Ej: Le pedí llegar a las 10:30 para recibir el camión de cerraduras.'}
              style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, fontSize:13,
                background:'var(--bg-app)', color:'var(--text)', fontFamily:'inherit', resize:'vertical' }}/>
            <div style={{ fontSize:11, marginTop:3, color: just.trim().length >= 15 ? LT.aut : 'var(--text-muted)' }}>
              {just.trim().length}/15 caracteres mínimos
            </div>
          </div>
        </div>

        <div style={{ padding:'12px 22px 18px', display:'flex', justifyContent:'flex-end', gap:8, borderTop:'1px solid var(--border)' }}>
          <button onClick={onCerrar} disabled={enviando} style={btnSec}>Cancelar</button>
          <button disabled={!ok} onClick={confirmar}
            style={{ ...btnPri, background: !modo || modo === 'nada' ? LT.antes : LT.aut, opacity: ok ? 1 : .5, cursor: ok ? 'pointer' : 'not-allowed' }}>
            {etiqueta}
          </button>
        </div>
      </div>
    </div>
  )
}

const stLink = { background:'none', border:'none', padding:0, color:'var(--accent)', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit' }
const stChipNum = on => ({ padding:'4px 11px', borderRadius:100, fontSize:12, cursor:'pointer', fontFamily:'inherit', fontVariantNumeric:'tabular-nums',
  border:`1px solid ${on ? 'transparent' : 'var(--border)'}`, background: on ? 'var(--text)' : 'var(--bg-surface)',
  color: on ? 'var(--bg-surface)' : 'var(--text)', fontWeight: on ? 650 : 500 })
const stTh = { textAlign:'left', fontSize:11, fontWeight:600, color:'var(--text-muted)', padding:'0 16px 5px 0', whiteSpace:'nowrap' }
const stTd = { padding:'5px 16px 5px 0', borderTop:'1px solid var(--border)', whiteSpace:'nowrap' }
const stHint = { fontSize:11.5, color:'var(--text-muted)', marginTop:6, lineHeight:1.45 }

// ─── Selector de período ──────────────────────────────────────────────────────
// Dos formas de mirar las horas extra: período de pago (26 al 25) o mes
// calendario. Accesos directos a los tres últimos períodos del modo elegido;
// las fechas manuales siguen disponibles para cualquier otro rango.
function SelectorPeriodo({ modo, fijo, onModo, fil, onRango }) {
  const base = modo === 'pago' ? periodoPago(hoyISO()) : hoyISO().slice(0,7)
  const periodos = [mesMas(base,-2), mesMas(base,-1), base]
  const h = hoyISO()
  const seg = on => ({padding:'5px 11px',border:'none',borderRadius:7,cursor:'pointer',fontSize:12,
    fontFamily:'inherit',fontWeight: on ? 650 : 500,
    background: on ? 'var(--text)' : 'transparent', color: on ? 'var(--bg-surface)' : 'var(--text-muted)'})
  return (
    <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
      {fijo ? (
        <span style={{fontSize:11.5,color:'var(--text-muted)'}} title='Las ausencias se calculan por mes calendario'>
          Mes calendario
        </span>
      ) : (
        <div style={{display:'flex',gap:2,padding:2,border:'1px solid var(--border)',borderRadius:9,background:'var(--bg-surface)'}}>
          <button onClick={()=>onModo('pago')} style={seg(modo==='pago')} title='Del 26 de un mes al 25 del siguiente: así se pagan las horas extra'>
            Período de pago
          </button>
          <button onClick={()=>onModo('mes')} style={seg(modo==='mes')} title='Del 1 al último día del mes'>
            Mes calendario
          </button>
        </div>
      )}
      {periodos.map(p => {
        const r = rangoDe(modo, p)
        const hasta = r.hasta < h ? r.hasta : h
        const on = fil.desde === r.desde && fil.hasta === hasta
        return (
          <button key={p} onClick={() => onRango({ desde: r.desde, hasta })}
            title={`${fFecha(r.desde)} al ${fFecha(r.hasta)}`}
            style={{padding:'5px 10px',borderRadius:100,fontSize:12,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap',
              border:`1px solid ${on ? 'transparent' : 'var(--border)'}`,
              background: on ? 'var(--accent)' : 'var(--bg-surface)', color: on ? 'white' : 'var(--text)',
              fontWeight: on ? 650 : 500}}>
            {etiquetaDe(modo, p)}{p === base && <span style={{opacity:.7}}> · en curso</span>}
          </button>
        )
      })}
    </div>
  )
}

// ─── Filtro común a las tres bandejas ─────────────────────────────────────────
// Un mismo lenguaje en todas: buscar persona, acotar a un día, seleccionar lo
// visible. Resuelve los casos reales: "el 15 fue la convivencia" (un día, todos)
// y "a Bairon solo le pedí 2 sábados" (una persona, algunos días).
function BarraFiltro({ dia, setDia, busq, setBusq, pendientes, visibles, puede, onSeleccionarVisibles }) {
  const dias = useMemo(() => {
    const m = new Map()
    for (const p of pendientes) { const d = String(p.fecha).slice(0,10); m.set(d, (m.get(d)||0) + 1) }
    return [...m.entries()].sort((a,b) => a[0].localeCompare(b[0]))
  }, [pendientes])
  const DS = ['dom','lun','mar','mié','jue','vie','sáb']
  const chipSt = on => ({padding:'4px 10px',borderRadius:100,fontSize:11.5,cursor:'pointer',whiteSpace:'nowrap',
    fontFamily:'inherit',fontVariantNumeric:'tabular-nums',
    border:`1px solid ${on ? 'transparent' : 'var(--border)'}`,
    background: on ? 'var(--text)' : 'var(--bg-surface)', color: on ? 'var(--bg-surface)' : 'var(--text)',
    fontWeight: on ? 650 : 500})
  if (!pendientes.length && !dia && !busq) return null
  return (
    <div style={{marginBottom:14,padding:'10px 12px',border:'1px solid var(--border)',borderRadius:10,
      background:'var(--bg-surface)',display:'grid',gap:9}}>
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder='Buscar persona…'
          style={{...inp,width:210}}/>
        {(dia || busq) && (
          <button onClick={()=>{setDia(null);setBusq('')}}
            style={{background:'none',border:'none',color:'var(--accent)',cursor:'pointer',fontSize:12,fontWeight:600}}>
            Limpiar filtros
          </button>
        )}
        <span style={{marginLeft:'auto',fontSize:12,color:'var(--text-muted)'}}>
          {visibles.length} por decidir{(dia||busq) ? ' con este filtro' : ''}
        </span>
        {puede && visibles.length > 1 && (
          <button onClick={onSeleccionarVisibles}
            style={{...btnMini,padding:'5px 11px',fontSize:12,fontWeight:600}}>
            Seleccionar los {visibles.length}
          </button>
        )}
      </div>
      {dias.length > 1 && (
        <div style={{display:'flex',gap:5,alignItems:'center',overflowX:'auto',paddingBottom:2}}>
          <span style={{fontSize:11,color:'var(--text-muted)',fontWeight:600,marginRight:3,whiteSpace:'nowrap'}}>Día:</span>
          <button onClick={()=>setDia(null)} style={chipSt(!dia)}>Todos</button>
          {dias.map(([d,n]) => {
            const dt = new Date(d + 'T12:00:00')
            return (
              <button key={d} onClick={()=>setDia(dia===d ? null : d)} style={chipSt(dia===d)}
                title={`${n} pendiente${n===1?'':'s'} el ${fFecha(d)}`}>
                {DS[dt.getDay()]} {d.slice(8,10)}<span style={{opacity:.6,marginLeft:4}}>{n}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Vista: bandeja de validación ─────────────────────────────────────────────
// Agrupada por trabajador. Una jefatura con 100+ días pendientes no puede
// resolverlos fila por fila: lo que decide es "a esta persona le autorizo su
// semana", no "autorizo el martes 5". Cada bloque se resuelve de una vez y el
// detalle queda a un clic para cuando haya que mirar un día puntual.
// Huella del cálculo: por qué esta hora extra requiere una mirada extra.
// Nace de la corrección al motor — antes estos días simplemente no aparecían.
const REPARO = {
  dia_con_atraso:    { l:'ese día llegó tarde',        c:'#B25E09' },
  sin_marca_entrada: { l:'sin marca de entrada',       c:'#8E8E93' },
}
const DIAS_SEM = ['dom','lun','mar','mié','jue','vie','sáb']
const fDiaFecha = iso => {
  const [y,m,d] = String(iso).slice(0,10).split('-')
  const dd = new Date(+y, +m-1, +d)
  return `${DIAS_SEM[dd.getDay()]} ${d}-${m}`
}

function VistaValidacion({ filas, pendientes, puedeValidar, sel, toggleSel, selItems, setSel, onDecidir, onAnular, nomValidadores, onFicha }) {
  const [verTodas, setVerTodas] = useState(false)
  const [chip, setChip]         = useState('todas')
  const [abiertos, setAbiertos] = useState(() => new Set())

  const base = verTodas ? filas : pendientes

  // Recurrencia: más de 10 días con horas extra es habitualidad y el Art. 31
  // no la permite. Se marca sobre el total del período, no sobre el filtro.
  const diasPorPersona = {}
  for (const f of filas) diasPorPersona[f.cod_contaline] = (diasPorPersona[f.cod_contaline]||0) + 1

  const haceSieteDias = (() => { const d = new Date(); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10) })()
  const CHIPS = [
    { k:'todas',       l:'Todas',        test: () => true },
    { k:'excede',      l:'Sobre 2 horas', test: f => f.min_extra_dia > TOPE_MIN },
    { k:'menor30',     l:'Menos de 30 min', test: f => f.min_extra_dia < 30 },
    { k:'semana',      l:'Últimos 7 días', test: f => f.fecha >= haceSieteDias },
    { k:'recurrentes', l:'Recurrentes',  test: f => (diasPorPersona[f.cod_contaline]||0) > 10 },
  ].map(c => ({ ...c, n: base.filter(c.test).length }))

  const lista = base.filter((CHIPS.find(c=>c.k===chip) || CHIPS[0]).test)

  // Agrupar por persona y ordenar por volumen pendiente: primero quien más
  // tiempo tiene esperando decisión.
  const grupos = []
  const idx = new Map()
  for (const f of lista) {
    let g = idx.get(f.cod_contaline)
    if (!g) {
      g = { cod:f.cod_contaline, nombre:f.nombre, sucursal:f.sucursal_id,
            items:[], min:0, minPend:0, nPend:0, excede:0, reparos:0, cerrados:0,
            recurrente:(diasPorPersona[f.cod_contaline]||0) > 10 }
      idx.set(f.cod_contaline, g); grupos.push(g)
    }
    g.items.push(f)
    g.min += f.min_extra_dia
    if (f.cat === 'pendiente') { g.nPend++; g.minPend += f.min_extra_dia }
    if (f.min_extra_dia > TOPE_MIN) g.excede++
    if (f.extra_reparo) g.reparos++
    if (f.mesCerrado) g.cerrados++
    if (f.reservadoA) g.reservadoA = f.reservadoA
  }
  grupos.sort((a,b) => b.minPend - a.minPend || b.min - a.min || a.nombre.localeCompare(b.nombre))
  for (const g of grupos) g.items.sort((a,b) => a.fecha.localeCompare(b.fecha))

  const resueltas = filas.length - pendientes.length
  const avance    = filas.length ? Math.round(resueltas / filas.length * 100) : 0
  const minPend   = pendientes.reduce((s,f) => s + f.min_extra_dia, 0)

  const abrir = cod => setAbiertos(p => {
    const n = new Set(p); n.has(cod) ? n.delete(cod) : n.add(cod); return n
  })
  const selGrupo = (g, on) => {
    const n = new Set(sel)
    for (const it of g.items) if (it.cat === 'pendiente' && !it.cerrado) on ? n.add(it.key) : n.delete(it.key)
    setSel(n)
  }
  const todasDe = g => g.nPend > 0 && g.items.every(i => i.cat !== 'pendiente' || sel.has(i.key))

  return (
    <div style={{position:'relative'}}>
      {/* Avance del período: da sensación de progreso y cierra el ciclo */}
      {filas.length > 0 && (
        <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:12,flexWrap:'wrap'}}>
          <div style={{flex:'1 1 260px',minWidth:220}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:5}}>
              <span style={{fontWeight:600}}>
                {pendientes.length > 0
                  ? `${pendientes.length} por resolver · ${fMin(minPend)}`
                  : 'Todo resuelto en el período'}
              </span>
              <span style={{color:'var(--text-muted)',fontVariantNumeric:'tabular-nums'}}>
                {resueltas} de {filas.length} · {avance}%
              </span>
            </div>
            <div style={{height:5,background:'var(--border)',borderRadius:3,overflow:'hidden'}}>
              <div style={{width:`${avance}%`,height:'100%',background:avance===100?'#1E7A44':'#0A6EBD',
                transition:'width .3s ease'}}/>
            </div>
          </div>
          <label style={{fontSize:12,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
            <input type='checkbox' checked={verTodas} onChange={e=>{setVerTodas(e.target.checked);setSel(new Set())}}/>
            Ver también las ya resueltas
          </label>
        </div>
      )}

      {/* Regla del período: se dice una vez, arriba, y no se repite por fila */}
      {filas.some(f=>f.mesCerrado && f.cat==='pendiente') && (
        <div style={{marginBottom:12,padding:'9px 13px',borderRadius:7,fontSize:12.5,
          background:'var(--bg-surface)',border:'1px solid var(--border)',color:'var(--text-muted)'}}>
          Solo se pueden decidir las horas del mes en curso. Las de meses anteriores
          ya pasaron por remuneraciones: quedan visibles como historial, marcadas como
          <b style={{color:'var(--text)'}}> período cerrado</b>.
        </div>
      )}

      {/* Filtros rápidos: los tres cortes que una jefatura pide de verdad */}
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
        {CHIPS.map(c => (
          <button key={c.k} onClick={()=>setChip(c.k)} disabled={c.n===0 && c.k!=='todas'}
            style={{padding:'5px 12px',borderRadius:100,fontSize:12,cursor:c.n===0&&c.k!=='todas'?'default':'pointer',
              border:`1px solid ${chip===c.k?'transparent':'var(--border)'}`,
              background: chip===c.k ? 'var(--text)' : 'transparent',
              color: chip===c.k ? 'var(--bg-surface)' : c.n===0&&c.k!=='todas' ? 'var(--text-muted)' : 'var(--text)',
              fontWeight: chip===c.k?650:500,opacity:c.n===0&&c.k!=='todas'?.45:1}}>
            {c.l}{c.n>0 && <span style={{marginLeft:6,fontVariantNumeric:'tabular-nums',opacity:.75}}>{c.n}</span>}
          </button>
        ))}
      </div>

      {!puedeValidar && (
        <div style={{marginBottom:10,padding:'9px 13px',borderRadius:7,fontSize:12,
          background:'var(--bg-surface)',border:'1px solid var(--border)',color:'var(--text-muted)'}}>
          Modo consulta: puedes revisar el estado y el reporte, pero no decidir sobre las horas.
        </div>
      )}

      {lista.length === 0 ? (
        <div style={{padding:'48px 20px',textAlign:'center',border:'1px solid var(--border)',
          borderRadius:10,background:'var(--bg-surface)'}}>
          <div style={{fontWeight:650,fontSize:15,marginBottom:4}}>
            {chip === 'todas' ? 'No hay horas extra esperando decisión' : 'Ningún caso con este filtro'}
          </div>
          <div style={{fontSize:12.5,color:'var(--text-muted)'}}>
            {chip === 'todas'
              ? 'Cuando alguien salga después de su turno, aparecerá acá para que decidas.'
              : 'Prueba con otro filtro o vuelve a “Todas”.'}
          </div>
        </div>
      ) : (
        <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',background:'var(--bg-surface)'}}>
          {grupos.map((g,gi) => {
            const abierto = abiertos.has(g.cod)
            return (
              <div key={g.cod} style={{borderTop: gi ? '1px solid var(--border)' : 'none'}}>
                {/* Cabecera de persona */}
                <div style={{display:'flex',alignItems:'center',gap:10,padding:'11px 14px',
                  background: abierto ? 'var(--bg-app)' : 'transparent'}}>
                  {puedeValidar && g.nPend > 0 && (
                    <input type='checkbox' checked={todasDe(g)} onChange={e=>selGrupo(g, e.target.checked)}
                      title={`Seleccionar los ${g.nPend} días pendientes`} style={{cursor:'pointer'}}/>
                  )}
                  <button onClick={()=>abrir(g.cod)} style={{flex:1,minWidth:0,display:'flex',alignItems:'center',
                    gap:10,background:'none',border:'none',cursor:'pointer',padding:0,textAlign:'left'}}>
                    <span style={{fontSize:10,color:'var(--text-muted)',width:10,flexShrink:0}}>{abierto?'▾':'▸'}</span>
                    <span style={{minWidth:0}}>
                      <span onClick={e=>{e.stopPropagation();onFicha?.(g.cod,g.nombre)}}
                        title="Ver la ficha del mes de esta persona"
                        style={{fontWeight:650,fontSize:13.5,display:'block',whiteSpace:'nowrap',
                        overflow:'hidden',textOverflow:'ellipsis',textDecoration:'underline',
                        textDecorationStyle:'dotted',textUnderlineOffset:3}}>{g.nombre}</span>
                      <span style={{fontSize:11.5,color:'var(--text-muted)'}}>
                        {g.sucursal}
                        {g.excede > 0 && <span style={{color:'#B42318',fontWeight:600}}> · {g.excede} sobre 2 h</span>}
                        {g.reparos > 0 && <span style={{color:'#B25E09',fontWeight:600}}> · {g.reparos} con reparo de marcaje</span>}
                        {g.cerrados > 0 && <span> · {g.cerrados} de meses cerrados</span>}
                        {g.reservadoA && <span style={{fontWeight:600}}> · las valida {g.reservadoA}</span>}
                        {g.recurrente && <span style={{color:'#B25E09',fontWeight:600}}> · recurrente</span>}
                        {g.items.length > 1 && (
                          <span style={{color:'var(--accent)',fontWeight:600}}>
                            {' · '}{abierto ? 'ocultar días' : 'ver y decidir día por día'}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  <div style={{textAlign:'right',whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>
                    <div style={{fontSize:13.5,fontWeight:700}}>{fMin(g.minPend || g.min)}</div>
                    <div style={{fontSize:11,color:'var(--text-muted)'}}>
                      {g.nPend > 0 ? `${g.nPend} ${g.nPend===1?'día':'días'} por decidir` : 'resuelto'}
                    </div>
                  </div>
                  {puedeValidar && g.nPend > 0 && (
                    <div style={{display:'flex',gap:6}}>
                      <button onClick={()=>onDecidir(g.items.filter(i=>i.cat==='pendiente' && !i.cerrado),'autorizada')}
                        style={{...btnPri,background:'#1E7A44',padding:'6px 12px',fontSize:12}}>
                        {g.nPend === 1 ? 'Autorizar' : `Autorizar los ${g.nPend}`}
                      </button>
                      <button onClick={()=>onDecidir(g.items.filter(i=>i.cat==='pendiente' && !i.cerrado),'rechazada')}
                        style={{...btnMini,color:'#B42318',borderColor:'#B4231840',padding:'6px 10px',fontSize:12}}>
                        {g.nPend === 1 ? 'Rechazar' : `Rechazar los ${g.nPend}`}
                      </button>
                    </div>
                  )}
                </div>

                {/* Detalle día a día */}
                {abierto && (
                  <div style={{padding:'0 14px 10px 40px'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
                      <tbody>
                        {g.items.map(f => {
                          const cat = CATS[f.cat], excede = f.min_extra_dia > TOPE_MIN
                          return (
                            <tr key={f.key} style={{borderTop:'1px solid var(--border)',
                              background: sel.has(f.key) ? 'var(--bg-app)' : 'transparent'}}>
                              <td style={{padding:'7px 8px 7px 0',width:26}}>
                                {puedeValidar && f.cat==='pendiente' && !f.cerrado &&
                                  <input type='checkbox' checked={sel.has(f.key)} onChange={()=>toggleSel(f.key)} style={{cursor:'pointer'}}/>}
                              </td>
                              <td style={{padding:'7px 10px 7px 0',whiteSpace:'nowrap'}}>{fDiaFecha(f.fecha)}</td>
                              <td style={{padding:'7px 10px 7px 0',color:'var(--text-muted)',fontSize:11.5}}>
                                {f.workshift_name || '—'}
                              </td>
                              <td style={{padding:'7px 10px 7px 0',color:'var(--text-muted)',fontSize:11.5,whiteSpace:'nowrap'}}>
                                {f.salida_real ? `salió ${String(f.salida_real).slice(11,16)}` : '—'}
                              </td>
                              <td style={{padding:'7px 10px 7px 0',textAlign:'right',whiteSpace:'nowrap',
                                fontVariantNumeric:'tabular-nums'}}>
                                <span style={{fontWeight:700,color:excede?'#B42318':'var(--text)'}}>{fMin(f.min_extra_dia)}</span>
                                {excede && <span style={{marginLeft:6,fontSize:9.5,fontWeight:800,padding:'1px 6px',
                                  borderRadius:3,background:'#B4231812',color:'#B42318'}}>SOBRE 2 H</span>}
                                {REPARO[f.extra_reparo] && (
                                  <span title="Revisa el marcaje de ese día antes de decidir"
                                    style={{marginLeft:6,fontSize:9.5,fontWeight:700,padding:'1px 6px',borderRadius:3,
                                    background:`${REPARO[f.extra_reparo].c}14`,color:REPARO[f.extra_reparo].c}}>
                                    {REPARO[f.extra_reparo].l}</span>
                                )}
                              </td>
                              <td style={{padding:'7px 0 7px 10px',textAlign:'right',whiteSpace:'nowrap',minWidth:150}}>
                                {f.reservadoA && f.cat === 'pendiente' ? (
                                  <span title='Horas de una jefatura: las valida su superior directo'
                                    style={{fontSize:10.5,fontWeight:700,color:'var(--text-muted)',
                                    border:'1px solid var(--border)',borderRadius:3,padding:'2px 7px'}}>
                                    valida {f.reservadoA}</span>
                                ) : f.cerrado && f.cat === 'pendiente' ? (
                                  <span title='Mes ya procesado en remuneraciones; no se regulariza'
                                    style={{fontSize:10.5,fontWeight:700,color:'var(--text-muted)',
                                    border:'1px solid var(--border)',borderRadius:3,padding:'2px 7px'}}>
                                    período cerrado</span>
                                ) : f.cat === 'pendiente' ? (
                                  puedeValidar && (
                                    <>
                                      <button onClick={()=>onDecidir([f],'autorizada')} title='Autorizar este día'
                                        style={{...btnMini,color:'#1E7A44',borderColor:'#1E7A4440'}}>Autorizar</button>
                                      <button onClick={()=>onDecidir([f],'rechazada')} title='Rechazar este día'
                                        style={{...btnMini,color:'#B42318',borderColor:'#B4231840'}}>Rechazar</button>
                                    </>
                                  )
                                ) : (
                                  <span style={{display:'inline-flex',alignItems:'center',gap:8}}>
                                    <span style={{fontSize:11,fontWeight:700,color:cat.c}}>{cat.l}</span>
                                    {puedeValidar && f.val &&
                                      <button onClick={()=>onAnular(f)} title='Volver a dejarlo pendiente'
                                        style={btnMini}>Deshacer</button>}
                                  </span>
                                )}
                                {f.val && (
                                  <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2,textAlign:'right'}}>
                                    {nomValidadores[f.val.validado_por]||f.val.validado_por} · {fFecha(f.val.validado_at)}
                                    {f.val.justificacion && <div style={{fontStyle:'italic'}}>“{f.val.justificacion}”</div>}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Barra de acción fija: aparece solo con selección activa */}
      {puedeValidar && selItems.length > 0 && (
        <div style={{position:'sticky',bottom:16,marginTop:14,display:'flex',alignItems:'center',
          justifyContent:'space-between',gap:12,flexWrap:'wrap',padding:'11px 16px',borderRadius:9,
          background:'var(--text)',color:'var(--bg-surface)',boxShadow:'0 6px 22px rgba(0,0,0,.18)',zIndex:20}}>
          <span style={{fontSize:13,fontWeight:600,fontVariantNumeric:'tabular-nums'}}>
            {selItems.length} {selItems.length===1?'día seleccionado':'días seleccionados'} · {fMin(selItems.reduce((s,i)=>s+i.min_extra_dia,0))}
          </span>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button onClick={()=>setSel(new Set())} style={{background:'none',border:'none',
              color:'var(--bg-surface)',opacity:.7,cursor:'pointer',fontSize:12.5}}>Quitar selección</button>
            <button onClick={()=>onDecidir(selItems,'autorizada')}
              style={{...btnPri,background:'#1E7A44',padding:'7px 16px'}}>Autorizar</button>
            <button onClick={()=>onDecidir(selItems,'rechazada')}
              style={{...btnPri,background:'#B42318',padding:'7px 16px'}}>Rechazar</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Vista: reporte clasificado ───────────────────────────────────────────────
function resumenTrabajador(filas) {
  const m = {}
  for (const f of filas) {
    const r = (m[f.cod_contaline] ??= { nombre:f.nombre, sucursal_id:f.sucursal_id, n:0,
      aut_tope:{n:0,min:0}, aut_exceso:{n:0,min:0}, rechazada:{n:0,min:0}, pendiente:{n:0,min:0} })
    r.n++
    r[f.cat].n++; r[f.cat].min += f.min_extra_dia
  }
  return Object.values(m).sort((a,b)=> (b.aut_tope.min+b.aut_exceso.min) - (a.aut_tope.min+a.aut_exceso.min))
}

function VistaReporte({ filas, nomValidadores, onXLSX, onPDF, catInicial }) {
  const [fCat, setFCat] = useState(catInicial || 'todas')
  useEffect(()=>{ if(catInicial) setFCat(catInicial) }, [catInicial])
  const resumen = useMemo(()=>resumenTrabajador(filas),[filas])
  const detalle = useMemo(()=> fCat==='todas' ? filas : filas.filter(f=>f.cat===fCat), [filas,fCat])
  const totalMin = filas.reduce((s,f)=>s+f.min_extra_dia,0)

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:12}}>
        {/* Distribución */}
        <div style={{flex:1,minWidth:260,maxWidth:520}}>
          <div style={{display:'flex',height:12,borderRadius:100,overflow:'hidden'}}>
            {Object.entries(CATS).map(([k,c])=>{
              const min = filas.filter(f=>f.cat===k).reduce((s,f)=>s+f.min_extra_dia,0)
              return min>0 ? <span key={k} title={`${c.l}: ${fMin(min)}`} style={{width:`${min/Math.max(totalMin,1)*100}%`,background:c.c}}/> : null
            })}
          </div>
          <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:4}}>Distribución de {fMin(totalMin)} extra del período por categoría</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={onXLSX} style={btnSec}>Excel</button>
          <button onClick={onPDF} style={btnSec}>PDF</button>
        </div>
      </div>

      {/* Resumen por trabajador */}
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto',marginBottom:16}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,minWidth:860}}>
          <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
            {['Trabajador','Sucursal','Jornadas c/extra','Aut. ≤ 2h','Aut. con exceso','Rechazadas','Pendientes','Hrs autorizadas'].map(h=><th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {resumen.map(r=>(
              <tr key={r.nombre} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{...td,fontWeight:600}}>{r.nombre}</td>
                <td style={td}>{r.sucursal_id}</td>
                <td style={{...td,textAlign:'center'}}>{r.n}</td>
                <td style={{...td,color:'#34C759',fontWeight:600}}>{r.aut_tope.n>0?`${r.aut_tope.n} · ${fMin(r.aut_tope.min)}`:'—'}</td>
                <td style={{...td,color:'#FF9500',fontWeight:600}}>{r.aut_exceso.n>0?`${r.aut_exceso.n} · ${fMin(r.aut_exceso.min)}`:'—'}</td>
                <td style={{...td,color:'#FF3B30'}}>{r.rechazada.n>0?`${r.rechazada.n} · ${fMin(r.rechazada.min)}`:'—'}</td>
                <td style={{...td,color:'var(--text-muted)'}}>{r.pendiente.n>0?`${r.pendiente.n} · ${fMin(r.pendiente.min)}`:'—'}</td>
                <td style={{...td,fontWeight:800}}>{fMin(r.aut_tope.min + r.aut_exceso.min)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detalle */}
      <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
        <button onClick={()=>setFCat('todas')} style={{...chip, ...(fCat==='todas'?chipOn:{})}}>Todas ({filas.length})</button>
        {Object.entries(CATS).map(([k,c])=>(
          <button key={k} onClick={()=>setFCat(k)}
            style={{...chip, ...(fCat===k?{background:`${c.c}18`,color:c.c,borderColor:c.c}:{})}}>
            {c.ic} {c.l} ({filas.filter(f=>f.cat===k).length})
          </button>
        ))}
      </div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:860}}>
          <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
            {['Fecha','Trabajador','Sucursal','Min extra','Categoría','Justificación','Validó'].map(h=><th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {detalle.map(f=>(
              <tr key={f.key} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{...td,whiteSpace:'nowrap'}}>{fFecha(f.fecha)}</td>
                <td style={{...td,fontWeight:600}}>{f.nombre}</td>
                <td style={td}>{f.sucursal_id}</td>
                <td style={{...td,fontWeight:700,color:f.min_extra_dia>TOPE_MIN?'#FF3B30':'var(--text)'}}>{fMin(f.min_extra_dia)}</td>
                <td style={td}><span style={{fontSize:10.5,fontWeight:800,color:CATS[f.cat].c}}>{CATS[f.cat].ic} {CATS[f.cat].l}</span></td>
                <td style={{...td,fontSize:11,fontStyle:f.val?'italic':'normal',color:f.val?'var(--text)':'var(--text-muted)'}}>{f.val?.justificacion||'—'}</td>
                <td style={{...td,fontSize:11,color:'var(--text-muted)'}}>{f.val?(nomValidadores[f.val.validado_por]||f.val.validado_por):'—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Modal de justificación ───────────────────────────────────────────────────
// textoDefecto: sugerencia pre-cargada que la jefatura puede editar o borrar.
// Sugerir no es imponer: el campo queda editable.
function ModalJustificacion({ decision, items, onCerrar, onConfirmar, textoDefecto = '' }) {
  const [just, setJust] = useState(textoDefecto)
  const [enviando, setEnviando] = useState(false)
  const aut = decision === 'autorizada'
  // Horas extra usan min_extra_dia; llegada anticipada usa minutos.
  const totalMin = items.reduce((s,i)=>s+(i.min_extra_dia ?? i.minutos ?? 0),0)
  const conExceso = items.filter(i=>i.min_extra_dia>TOPE_MIN).length
  const ok = just.trim().length >= 15

  return (
    <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-surface)',borderRadius:14,padding:22,width:'100%',maxWidth:480,border:'1px solid var(--border)'}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>
          {aut ? 'Autorizar horas extra' : 'Rechazar horas extra'}
        </div>
        <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12}}>
          {items.length === 1
            ? <>{items[0].nombre} · {fFecha(items[0].fecha)} · <strong>{fMin(items[0].min_extra_dia)}</strong></>
            : <>{items.length} jornadas · {fMin(totalMin)} en total</>}
          {conExceso > 0 && <span style={{color:'#FF3B30',fontWeight:700}}> · {conExceso} supera(n) el tope de 2h diarias</span>}
        </div>
        {items.length > 1 && (
          <div style={{maxHeight:120,overflowY:'auto',fontSize:11.5,background:'var(--bg-app)',borderRadius:8,padding:'8px 11px',marginBottom:10}}>
            {items.map(i=>(
              <div key={i.key} style={{display:'flex',justifyContent:'space-between',padding:'2px 0'}}>
                <span>{i.nombre} · {fFecha(i.fecha)}</span>
                <strong style={{color:i.min_extra_dia>TOPE_MIN?'#FF3B30':'var(--text)'}}>{fMin(i.min_extra_dia)}</strong>
              </div>
            ))}
          </div>
        )}
        <label style={{display:'block',fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>
          Justificación obligatoria {aut ? '(motivo operacional de las horas extra)' : '(motivo del rechazo)'}
        </label>
        <textarea autoFocus value={just} onChange={e=>setJust(e.target.value)} rows={3}
          placeholder={aut ? 'Ej: Recepción de contenedor programada; se requirió apoyo en descarga hasta las 20:30...' : 'Ej: No hubo requerimiento operacional; permanencia no solicitada por jefatura...'}
          style={{width:'100%',boxSizing:'border-box',padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit',resize:'vertical'}}/>
        <div style={{fontSize:10.5,marginTop:3,color: ok ? '#34C759' : 'var(--text-muted)'}}>{just.trim().length}/15 caracteres mínimos</div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:14}}>
          <button onClick={onCerrar} disabled={enviando} style={btnSec}>Cancelar</button>
          <button disabled={!ok || enviando}
            onClick={async()=>{ setEnviando(true); await onConfirmar(just.trim()) }}
            style={{...btnPri,background:aut?'#34C759':'#FF3B30',opacity:(!ok||enviando)?0.5:1}}>
            {enviando ? 'Guardando...' : aut ? `Autorizar ${items.length>1?`(${items.length})`:''}` : `Rechazar ${items.length>1?`(${items.length})`:''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Badge de conteo ──────────────────────────────────────────────────────────
function B({ n, c='#FF9500' }) {
  return <span style={{marginLeft:6,fontSize:10,fontWeight:800,padding:'1px 7px',borderRadius:100,background:`${c}20`,color:c}}>{n}</span>
}

// ─── Vista: cola de ausencias ─────────────────────────────────────────────────
function VistaAusencias({ filas, pendientes, puede, sel, toggleSel, selItems, setSel, onGestionar, onAnular, noms, onFicha, onAcuse }) {
  const [verTodas, setVerTodas] = useState(false)
  const lista = verTodas ? filas : pendientes
  return (
    <div>
      <div style={{marginBottom:10,padding:'8px 12px',borderRadius:8,fontSize:12,background:'#FF3B3008',border:'1px solid #FF3B3030',color:'var(--text)'}}>
        Una ausencia es un día con turno asignado y <strong>cero marcas</strong> (solo días ya cerrados). Mientras no se gestione, <strong>se contabiliza como falta injustificada</strong>.
      </div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:10}}>
        <label style={{fontSize:12.5,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
          <input type='checkbox' checked={verTodas} onChange={e=>setVerTodas(e.target.checked)}/>
          Ver también las ya gestionadas
        </label>
        {puede && selItems.length>0 && (
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:12.5,fontWeight:600}}>{selItems.length} seleccionada(s)</span>
            <button onClick={()=>onGestionar(selItems)} style={btnPri}>Clasificar seleccionadas</button>
          </div>
        )}
      </div>
      {!puede && (
        <div style={{marginBottom:10,padding:'8px 12px',borderRadius:8,fontSize:12,background:'var(--bg-surface)',border:'1px solid var(--border)',color:'var(--text-muted)'}}>
          Modo consulta: puedes revisar el estado, pero no clasificar ausencias.
        </div>
      )}
      {lista.length===0 ? (
        <div style={{padding:'44px 20px',textAlign:'center',border:'1px solid var(--border)',
          borderRadius:10,background:'var(--bg-surface)'}}>
          <div style={{fontWeight:650,fontSize:15,marginBottom:4}}>Sin ausencias por gestionar</div>
          <div style={{fontSize:12.5,color:'var(--text-muted)'}}>
            Cuando alguien tenga turno asignado y no marque, aparecerá acá para que clasifiques el motivo.
          </div>
        </div>
      ) : (
        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,minWidth:820}}>
            <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
              {puede && <th style={{...th,width:34}}>
                <input type='checkbox' checked={pendientes.length>0 && selItems.length===pendientes.length}
                  onChange={e=>setSel(e.target.checked ? new Set(pendientes.map(p=>p.key)) : new Set())}/>
              </th>}
              {['Fecha','Trabajador','Sucursal','Turno esperado','Estado',''].map(h=><th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {lista.map(f=>{
                const cat = f.cat==='pendiente' ? AUS_PEND : AUS_CATS[f.cat]
                return (
                  <tr key={f.key} style={{borderBottom:'1px solid var(--border)',background:sel.has(f.key)?'var(--bg-app)':'transparent'}}>
                    {puede && <td style={td}>{f.cat==='pendiente' && <input type='checkbox' checked={sel.has(f.key)} onChange={()=>toggleSel(f.key)}/>}</td>}
                    <td style={{...td,whiteSpace:'nowrap'}}>{fFecha(f.fecha)}</td>
                    <td style={{...td,fontWeight:600}}>
                      <span onClick={()=>onFicha?.(f.cod_contaline, f.nombre)}
                        title="Ver la ficha del mes de esta persona"
                        style={{cursor:'pointer',textDecoration:'underline',
                          textDecorationStyle:'dotted',textUnderlineOffset:3}}>{f.nombre}</span>
                    </td>
                    <td style={td}>{f.sucursal_id}</td>
                    <td style={{...td,fontSize:11.5,color:'var(--text-muted)'}}>{f.workshift_name||'—'}</td>
                    <td style={td}>
                      <span style={{fontSize:10.5,fontWeight:800,color:cat.c}}>{cat.ic} {cat.l}</span>
                      {f.ges && (
                        <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>
                          {noms[f.ges.gestionado_por]||f.ges.gestionado_por} · {fFecha(f.ges.gestionado_at)}
                          <div style={{fontStyle:'italic'}}>"{f.ges.justificacion}"</div>
                        </div>
                      )}
                      {f.porNovedad && (
                        <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>Justificada automáticamente · novedad registrada en Dotación</div>
                      )}
                    </td>
                    <td style={{...td,textAlign:'right',whiteSpace:'nowrap'}}>
                      {puede && f.cat==='pendiente' && <button onClick={()=>onGestionar([f])} style={btnMini}>Clasificar</button>}
                      {puede && <button onClick={()=>onAcuse?.(f)} style={btnMini}
                        title='Registrar qué acción tomaste y ver cuántas veces se repite'>Acuse</button>}
                      {puede && f.ges && <button onClick={()=>onAnular(f)} title='Volver a dejarla pendiente' style={btnMini}>Deshacer</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Reporte de ausencias ─────────────────────────────────────────────────────
function resumenAus(filas) {
  const m = {}
  for (const f of filas) {
    const r = (m[f.cod_contaline] ??= { nombre:f.nombre, sucursal_id:f.sucursal_id, n:0,
      pendiente:0, falta_injustificada:0, licencia_medica:0, permiso_con_goce:0, permiso_sin_goce:0, vacaciones:0, otro:0 })
    r.n++; r[f.cat] = (r[f.cat]||0) + 1
  }
  // faltas efectivas = pendientes (falta por defecto) + faltas injustificadas
  return Object.values(m).sort((a,b)=> (b.pendiente+b.falta_injustificada)-(a.pendiente+a.falta_injustificada))
}
function VistaReporteAus({ filas, noms, onXLSX, onPDF, catInicial }) {
  const [fCat, setFCat] = useState(catInicial || 'todas')
  useEffect(()=>{ if(catInicial) setFCat(catInicial) }, [catInicial])
  const resumen = useMemo(()=>resumenAus(filas),[filas])
  const detalle = useMemo(()=> fCat==='todas'?filas:filas.filter(f=>f.cat===fCat),[filas,fCat])
  const totalDias = filas.length
  const chip = {padding:'5px 12px',borderRadius:100,border:'1px solid var(--border)',background:'transparent',color:'var(--text-muted)',fontSize:11.5,fontWeight:600,cursor:'pointer'}
  const chipOn = {background:'var(--bg-app)',color:'var(--text)',borderColor:'var(--text-muted)'}
  const catLabel = k => k==='pendiente'?AUS_PEND:AUS_CATS[k]
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10,marginBottom:12}}>
        <div style={{flex:1,minWidth:260,maxWidth:520}}>
          <div style={{display:'flex',height:12,borderRadius:100,overflow:'hidden'}}>
            {[['pendiente',AUS_PEND],...Object.entries(AUS_CATS)].map(([k,c])=>{
              const n = filas.filter(f=>f.cat===k).length
              return n>0 ? <span key={k} title={`${c.l}: ${n}`} style={{width:`${n/Math.max(totalDias,1)*100}%`,background:c.c}}/> : null
            })}
          </div>
          <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:4}}>Distribución de {totalDias} día(s) de ausencia del período</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={onXLSX} style={btnSec}>Excel</button>
          <button onClick={onPDF} style={btnSec}>PDF</button>
        </div>
      </div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto',marginBottom:16}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,minWidth:820}}>
          <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
            {['Trabajador','Sucursal','Pendientes','Faltas injust.','Licencias','Perm. c/goce','Perm. s/goce','Total días'].map(h=><th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {resumen.map(r=>(
              <tr key={r.nombre} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{...td,fontWeight:600}}>{r.nombre}</td>
                <td style={td}>{r.sucursal_id}</td>
                <td style={{...td,color:'#8E8E93',fontWeight:600}}>{r.pendiente||'—'}</td>
                <td style={{...td,color:'#FF3B30',fontWeight:700}}>{r.falta_injustificada||'—'}</td>
                <td style={{...td,color:'#0A84FF'}}>{r.licencia_medica||'—'}</td>
                <td style={{...td,color:'#34C759'}}>{r.permiso_con_goce||'—'}</td>
                <td style={{...td,color:'#FF9500'}}>{r.permiso_sin_goce||'—'}</td>
                <td style={{...td,fontWeight:800}}>{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
        <button onClick={()=>setFCat('todas')} style={{...chip, ...(fCat==='todas'?chipOn:{})}}>Todas ({filas.length})</button>
        {[['pendiente',AUS_PEND],...Object.entries(AUS_CATS)].map(([k,c])=>(
          <button key={k} onClick={()=>setFCat(k)} style={{...chip, ...(fCat===k?{background:`${c.c}18`,color:c.c,borderColor:c.c}:{})}}>{c.ic} {c.l} ({filas.filter(f=>f.cat===k).length})</button>
        ))}
      </div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:820}}>
          <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
            {['Fecha','Trabajador','Sucursal','Turno','Clasificación','Justificación','Gestionó'].map(h=><th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {detalle.map(f=>{
              const c = catLabel(f.cat)
              return (
                <tr key={f.key} style={{borderBottom:'1px solid var(--border)'}}>
                  <td style={{...td,whiteSpace:'nowrap'}}>{fFecha(f.fecha)}</td>
                  <td style={{...td,fontWeight:600}}>{f.nombre}</td>
                  <td style={td}>{f.sucursal_id}</td>
                  <td style={{...td,fontSize:11.5,color:'var(--text-muted)'}}>{f.workshift_name||'—'}</td>
                  <td style={td}><span style={{fontSize:10.5,fontWeight:800,color:c.c}}>{c.ic} {c.l}</span></td>
                  <td style={{...td,fontSize:11,fontStyle:f.ges?'italic':'normal',color:f.ges?'var(--text)':'var(--text-muted)'}}>{f.ges?.justificacion||'—'}</td>
                  <td style={{...td,fontSize:11,color:'var(--text-muted)'}}>{f.ges?(noms[f.ges.gestionado_por]||f.ges.gestionado_por):'—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Modal de clasificación de ausencia ───────────────────────────────────────
function ModalAusencia({ items, onCerrar, onConfirmar }) {
  const [clasif, setClasif] = useState(null)
  const [just, setJust] = useState('')
  const [enviando, setEnviando] = useState(false)
  const ok = clasif && just.trim().length >= 10
  return (
    <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-surface)',borderRadius:14,padding:22,width:'100%',maxWidth:480,border:'1px solid var(--border)',maxHeight:'88vh',overflowY:'auto'}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>Clasificar ausencia</div>
        <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12}}>
          {items.length===1 ? <>{items[0].nombre} · {fFecha(items[0].fecha)}</> : <>{items.length} ausencias seleccionadas</>}
        </div>
        {items.length>1 && (
          <div style={{maxHeight:110,overflowY:'auto',fontSize:11.5,background:'var(--bg-app)',borderRadius:8,padding:'8px 11px',marginBottom:10}}>
            {items.map(i=><div key={i.key} style={{padding:'2px 0'}}>{i.nombre} · {fFecha(i.fecha)}</div>)}
          </div>
        )}
        <div style={{display:'grid',gap:7,marginBottom:12}}>
          {Object.entries(AUS_CATS).map(([k,c])=>(
            <button key={k} onClick={()=>setClasif(k)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',borderRadius:10,cursor:'pointer',textAlign:'left',
              background: clasif===k?`${c.c}14`:'var(--bg-app)', border:`1.5px solid ${clasif===k?c.c:'var(--border)'}`}}>
              <span style={{fontSize:16}}>{c.ic}</span>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:clasif===k?c.c:'var(--text)'}}>{c.l}</div>
                <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{c.justificada?'Ausencia justificada':'Cuenta como falta'}</div>
              </div>
            </button>
          ))}
        </div>
        <label style={{display:'block',fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:4}}>Justificación / respaldo obligatorio</label>
        <textarea autoFocus value={just} onChange={e=>setJust(e.target.value)} rows={3}
          placeholder='Ej: Presentó licencia médica folio 12345 por 3 días / Permiso avisado con 48h / No avisó ni justificó...'
          style={{width:'100%',boxSizing:'border-box',padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit',resize:'vertical'}}/>
        <div style={{fontSize:10.5,marginTop:3,color:ok?'#34C759':'var(--text-muted)'}}>{just.trim().length}/10 caracteres mínimos</div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:14}}>
          <button onClick={onCerrar} disabled={enviando} style={btnSec}>Cancelar</button>
          <button disabled={!ok||enviando} onClick={async()=>{setEnviando(true); await onConfirmar(clasif, just.trim())}}
            style={{...btnPri,opacity:(!ok||enviando)?0.5:1}}>{enviando?'Guardando...':`Clasificar ${items.length>1?`(${items.length})`:''}`}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const th = {padding:'9px 12px',textAlign:'left',fontSize:10.5,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}
const td = {padding:'8px 12px',verticalAlign:'top'}
const inp = {padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:12.5,background:'var(--bg-surface)',color:'var(--text)',fontFamily:'inherit'}
const btnPri = {padding:'7px 14px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:12.5,fontWeight:700}
const btnSec = {padding:'7px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:12.5,fontWeight:500}
const btnMini = {padding:'4px 8px',background:'transparent',border:'1px solid var(--border)',borderRadius:7,cursor:'pointer',fontSize:12,marginLeft:4}
const tabB = {padding:'7px 14px',borderRadius:8,border:'none',background:'transparent',color:'var(--text-muted)',fontSize:12.5,fontWeight:600,cursor:'pointer'}
const tabBOn = {background:'var(--bg-app)',color:'var(--text)',boxShadow:'inset 0 0 0 1px var(--border)'}
const chip = {padding:'5px 12px',borderRadius:100,border:'1px solid var(--border)',background:'transparent',color:'var(--text-muted)',fontSize:11.5,fontWeight:600,cursor:'pointer'}
const chipOn = {background:'var(--bg-app)',color:'var(--text)',borderColor:'var(--text-muted)'}
