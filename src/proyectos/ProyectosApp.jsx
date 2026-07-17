import { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase, signOut } from '../supabase'
import { canSync, preloadCaps } from '../core/permisos'
import { css, Bd, Bt, Fl, Sheet } from '../components/UI'
import { uid, hoy, hora } from '../lib/constants'

/* ═══ CATÁLOGOS DEL MÓDULO ═══ */
const AREAS = {
  finanzas:  { l: "Finanzas",  c: "#0C447C", bg: "#E6F1FB" },
  comercial: { l: "Comercial", c: "#085041", bg: "#E1F5EE" },
  negocios:  { l: "Negocios",  c: "#3C3489", bg: "#EEEDFE" },
  operacion: { l: "Operación", c: "#712B13", bg: "#FAECE7" },
  personas:  { l: "Personas",  c: "#72243E", bg: "#FBEAF0" }
}
const ESTADOS = {
  propuesto:  { l: "Propuesto",  c: "#5F5E5A", dot: "#8E8E93" },
  aprobado:   { l: "Aprobado",   c: "#185FA5", dot: "#185FA5" },
  en_curso:   { l: "En curso",   c: "#3B6D11", dot: "#639922" },
  en_riesgo:  { l: "En riesgo",  c: "#854F0B", dot: "#BA7517" },
  completado: { l: "Completado", c: "#27500A", dot: "#34C759" },
  cancelado:  { l: "Cancelado",  c: "#A32D2D", dot: "#E24B4A" }
}
const PRIORIDADES = { baja: "Baja", media: "Media", alta: "Alta", critica: "Crítica" }
const SUCURSALES = [
  { id: "", l: "Transversal (todas)" },
  { id: "suc-la", l: "Los Ángeles" },
  { id: "suc-mp", l: "Maipú" },
  { id: "suc-lg", l: "La Granja" },
  { id: "suc-web", l: "Web" }
]
const TABS = [
  { k: "panel",       l: "Panel",       ic: "📊" },
  { k: "proyectos",   l: "Proyectos",   ic: "📋" },
  { k: "reuniones",   l: "Reuniones",   ic: "🗓" },
  { k: "informes",    l: "Informes",    ic: "📈" },
  { k: "organigrama", l: "Organigrama", ic: "🏛", admin: true }
]
const SUBTABS = [
  { k: "resumen",     l: "Resumen",     ic: "📌" },
  { k: "tareas",      l: "Tareas",      ic: "✅" },
  { k: "gantt",       l: "Gantt",       ic: "📅" },
  { k: "entregables", l: "Entregables", ic: "📎" },
  { k: "informe",     l: "Informe",     ic: "📈" }
]
const BIT_IC = { comentario: "💬", cambio_estado: "🔄", derivacion: "↘", sistema: "⚙", entrega: "📎", aprobacion: "✅", rechazo: "⛔" }
const ETIPOS = { documento: "Documento", enlace: "Enlace", foto: "Foto", aprobacion: "Aprobación" }
const EESTADOS = {
  pendiente: { l: "Pendiente",   c: "#5F5E5A", bg: "#F2F2F7" },
  entregado: { l: "Por revisar", c: "#0C447C", bg: "#E6F1FB" },
  aprobado:  { l: "Aprobado",    c: "#27500A", bg: "#E1F5EE" },
  rechazado: { l: "Rechazado",   c: "#A32D2D", bg: "#FDEAEA" }
}
const ENT_FORM_VACIO = { nombre: "", descripcion: "", tipo: "documento", proyecto_id: "", tarea_id: "", fecha_limite: "" }
const REU_FORM_VACIO = { titulo: "", fecha: "", hora: "", lugar: "", proyecto_id: "", asistentes: [], resumen: "", tipo: "operativa" }
const TEMA_VACIO = { tema: "", acuerdo: "", responsable_id: "", corresponsables: [], fecha_compromiso: "", proyecto_id: "", estado: "no_iniciado", crear: true }
const RTIPOS = { operativa: "Operativa", directorio: "Directorio" }
const TEMA_ESTADOS = {
  no_iniciado: { l: "No se ha iniciado", c: "#5F5E5A", dot: "#8E8E93" },
  en_curso:    { l: "En curso",          c: "#3B6D11", dot: "#639922" },
  cumplido:    { l: "Cumplido",          c: "#27500A", dot: "#34C759" },
  aprobada:    { l: "Aprobada",          c: "#185FA5", dot: "#185FA5" }
}
const TESTADOS = {
  pendiente:   { l: "Pendiente",   c: "#5F5E5A", dot: "#8E8E93" },
  en_curso:    { l: "En curso",    c: "#3B6D11", dot: "#639922" },
  en_revision: { l: "En revisión", c: "#185FA5", dot: "#185FA5" },
  bloqueada:   { l: "Bloqueada",   c: "#A32D2D", dot: "#E24B4A" },
  completada:  { l: "Completada",  c: "#27500A", dot: "#34C759" }
}
const TAREA_FORM_VACIO = {
  titulo: "", descripcion: "", responsable_id: "",
  fecha_inicio: "", fecha_vencimiento: "", prioridad: "media",
  estado: "pendiente", avance_pct: 0, requiere_entregable: false, es_hito: false
}

const NAVY = "#16213e"
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif"

const FORM_VACIO = {
  nombre: "", objetivo: "", descripcion: "", area: "operacion",
  patrocinador_id: "", responsable_id: "", sucursal_id: "",
  prioridad: "media", estado: "propuesto", avance_pct: 0,
  fecha_inicio: "", fecha_fin_obj: ""
}

const fFecha = d => {
  if (!d) return "—"
  const [a, m, dd] = String(d).slice(0, 10).split("-")
  return `${dd}/${m}/${a.slice(2)}`
}
const fFechaHora = ts => {
  if (!ts) return ""
  const [f, h] = String(ts).split("T")
  return fFecha(f) + " " + (h || "").slice(0, 5)
}
const atrasado = p =>
  p.fecha_fin_obj && p.fecha_fin_obj < hoy() &&
  !["completado", "cancelado"].includes(p.estado)

// Enlace de evento prellenado de Google Calendar (mismo mecanismo que usa Compras)
function linkCalendar({ titulo, fecha, detalles, correo }) {
  if (!fecha) return null
  const f = String(fecha).slice(0, 10)
  const d1 = f.replace(/-/g, "")
  const dd = new Date(f + "T00:00:00"); dd.setDate(dd.getDate() + 1)
  const d2 = dd.toISOString().slice(0, 10).replace(/-/g, "")
  const inv = correo && correo.includes("@") ? "&add=" + encodeURIComponent(correo) : ""
  return "https://calendar.google.com/calendar/r/eventedit?text=" + encodeURIComponent(titulo || "Tarea") +
    "&dates=" + d1 + "/" + d2 + "&details=" + encodeURIComponent(detalles || "") + inv + "&trp=false"
}

/* ═══ COMPONENTE RAÍZ ═══ */
export function ProyectosApp({ cu, setAppActual }) {
  const [tab, setTab] = useState(() => {
    try {
      const t = localStorage.getItem("pmo_tab")
      return TABS.some(x => x.k === t) ? t : "panel"   // guard: tabs antiguas guardadas no rompen la vista
    } catch (e) { return "panel" }
  })
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  )
  const [verificando, setVerificando] = useState(true)
  const [tieneAcceso, setTieneAcceso] = useState(false)
  const [capsReady, setCapsReady] = useState(false)

  const [proyectos, setProyectos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)

  const [fArea, setFArea] = useState("")
  const [fEstado, setFEstado] = useState("")
  const [fTexto, setFTexto] = useState("")
  const [sortKey, setSortKey] = useState("created_at")
  const [sortDir, setSortDir] = useState(-1)

  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState(null)     // objeto proyecto en edición (o null)
  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [bitacora, setBitacora] = useState([])
  const [bitLoading, setBitLoading] = useState(false)
  // Tareas
  const [tareas, setTareas] = useState([])
  const [tareaVista, setTareaVista] = useState("proyecto")
  const [tareaProyId, setTareaProyId] = useState("")
  const [showTarea, setShowTarea] = useState(false)
  const [editandoTarea, setEditandoTarea] = useState(null)
  const [tareaCtx, setTareaCtx] = useState({ proyecto_id: "", tarea_padre_id: null, tema_id: null })
  const [tareaForm, setTareaForm] = useState(TAREA_FORM_VACIO)
  const [guardandoTarea, setGuardandoTarea] = useState(false)
  // Organigrama
  const [orgEdit, setOrgEdit] = useState({})
  const [orgBase, setOrgBase] = useState({})
  const [orgFiltro, setOrgFiltro] = useState("")
  const [orgSaving, setOrgSaving] = useState(false)
  // Historial y comentarios de tarea
  const [tareaBitacora, setTareaBitacora] = useState([])
  const [tareaBitLoading, setTareaBitLoading] = useState(false)
  const [comentario, setComentario] = useState("")
  const [comentando, setComentando] = useState(false)
  // Carga rápida
  const [showRapida, setShowRapida] = useState(false)
  const [rapidaText, setRapidaText] = useState("")
  const [rapidaResp, setRapidaResp] = useState("")
  const [rapidaVence, setRapidaVence] = useState("")
  const [rapidaSaving, setRapidaSaving] = useState(false)
  // Gantt
  const [ganttProyId, setGanttProyId] = useState("")
  // Entregables
  const [entregables, setEntregables] = useState([])
  const [entProyFiltro, setEntProyFiltro] = useState("")
  const [entEstadoFiltro, setEntEstadoFiltro] = useState("")
  const [showEnt, setShowEnt] = useState(false)
  const [entForm, setEntForm] = useState(ENT_FORM_VACIO)
  const [entSaving, setEntSaving] = useState(false)
  const [showEntrega, setShowEntrega] = useState(false)
  const [entSel, setEntSel] = useState(null)
  const [entFile, setEntFile] = useState(null)
  const [entUrl, setEntUrl] = useState("")
  const [entregando, setEntregando] = useState(false)
  const [showRevision, setShowRevision] = useState(false)
  const [entComent, setEntComent] = useState("")
  const [revisando, setRevisando] = useState(false)
  // Workspace de proyecto
  const [proyOpen, setProyOpen] = useState(null)
  const [subTab, setSubTab] = useState("resumen")
  // Checklist de cumplimiento
  const [checklist, setChecklist] = useState([])
  const [chkNuevo, setChkNuevo] = useState("")
  const [chkBusy, setChkBusy] = useState(false)
  // Reuniones
  const [reuniones, setReuniones] = useState([])
  const [reunionTemas, setReunionTemas] = useState([])
  const [showReunion, setShowReunion] = useState(false)
  const [reunionSel, setReunionSel] = useState(null)
  const [reunionForm, setReunionForm] = useState(REU_FORM_VACIO)
  const [temasNuevos, setTemasNuevos] = useState([])
  const [reuSaving, setReuSaving] = useState(false)
  const [reuVista, setReuVista] = useState("actas")
  const [temaAvances, setTemaAvances] = useState([])
  const [temaOpen, setTemaOpen] = useState(null)
  const [avanceTxt, setAvanceTxt] = useState("")
  const [avBusy, setAvBusy] = useState(false)
  const [segTema, setSegTema] = useState(null)
  const [cumplidosOpen, setCumplidosOpen] = useState(false)
  const [editHead, setEditHead] = useState(true)
  const [planOpen, setPlanOpen] = useState(null)
  const [planAdd, setPlanAdd] = useState({ padreId: null, titulo: "", resp: "", fecha: "" })
  const [planBusy, setPlanBusy] = useState(false)
  const [cfgSys, setCfgSys] = useState({})

  /* ── Verificación de acceso + precarga de capabilities ── */
  useEffect(() => {
    let cancel = false
    const init = async () => {
      try {
        await preloadCaps(cu, 'proyectos')
        if (!cancel) setCapsReady(true)
        const { data, error } = await supabase
          .from('usuario_acceso')
          .select('app_codigo')
          .eq('usuario_id', cu.id)
          .eq('app_codigo', 'proyectos')
          .eq('activo', true)
          .maybeSingle()
        if (cancel) return
        if (error || !data) setTieneAcceso(cu.rol === 'admin' || cu.rol === 'dir_general')
        else setTieneAcceso(true)
      } catch (e) {
        if (!cancel) setTieneAcceso(cu.rol === 'admin' || cu.rol === 'dir_general')
      } finally {
        if (!cancel) setVerificando(false)
      }
    }
    init()
    return () => { cancel = true }
  }, [cu.id, cu.rol])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => { try { localStorage.setItem("pmo_tab", tab) } catch (e) { } }, [tab])

  /* ── Mensajes: se cierran solos a los 4s ── */
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 4000)
    return () => clearTimeout(t)
  }, [msg])

  /* ── El acta abierta se refresca con cada recarga ── */
  useEffect(() => {
    if (!reunionSel) return
    const f = reuniones.find(x => x.id === reunionSel.id)
    if (f && f !== reunionSel) setReunionSel(f)
  }, [reuniones])

  /* ── El compromiso en seguimiento se refresca con cada recarga ── */
  useEffect(() => {
    if (!segTema) return
    const f = reunionTemas.find(x => x.id === segTema.id)
    if (f && f !== segTema) setSegTema(f)
  }, [reunionTemas])

  /* ── El proyecto abierto se refresca con cada recarga de datos ── */
  useEffect(() => {
    if (!proyOpen) return
    const f = proyectos.find(x => x.id === proyOpen.id)
    if (!f || (!esGlobal && !participaProy(f))) setProyOpen(null)
    else if (f !== proyOpen) setProyOpen(f)
  }, [proyectos])

  /* ── Carga de datos ── */
  const cargar = async () => {
    setLoading(true)
    try {
      const [rp, ru, rt, re, rc, rr, rm, ra] = await Promise.all([
        supabase.from('pmo_proyectos').select('*').order('created_at', { ascending: false }).limit(2000),
        supabase.from('usuarios').select('id,nombre,correo,reporta_a').order('nombre'),
        supabase.from('pmo_tareas').select('*').order('orden').order('created_at', { ascending: true }).limit(5000),
        supabase.from('pmo_entregables').select('*').order('created_at', { ascending: false }).limit(3000),
        supabase.from('pmo_checklist').select('*').order('orden').limit(20000),
        supabase.from('pmo_reuniones').select('*').order('fecha', { ascending: false }).limit(1000),
        supabase.from('pmo_reunion_temas').select('*').order('orden').limit(5000),
        supabase.from('pmo_tema_avances').select('*').order('created_at', { ascending: false }).limit(20000)
      ])
      if (rp.error) throw rp.error
      setProyectos(rp.data || [])
      setUsuarios(ru.data || [])
      setTareas(rt.data || [])
      setEntregables(re.data || [])
      setChecklist(rc.data || [])
      setReuniones(rr.data || [])
      setReunionTemas(rm.data || [])
      setTemaAvances(ra.data || [])
      try {
        const { data: cfg } = await supabase.from('config_sistema').select('clave,valor')
        const m = {}; (cfg || []).forEach(c => { m[c.clave] = c.valor })
        setCfgSys(m)
      } catch (e) { /* config no disponible: integraciones opcionales quedan apagadas */ }
      const ob = {}; (ru.data || []).forEach(u => { ob[u.id] = u.reporta_a || "" })
      setOrgBase(ob); setOrgEdit(ob)
    } catch (e) {
      setMsg({ t: "error", x: e.message })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { if (tieneAcceso) cargar() }, [tieneAcceso])

  /* ── Derivados ── */
  const nombreDe = useMemo(() => {
    const m = {}
    usuarios.forEach(u => { m[u.id] = u.nombre || u.correo || "—" })
    return id => (id ? (m[id] || "—") : "—")
  }, [usuarios])

  /* ── Visibilidad por participación: quien no participa, no ve (gerencia/admin ve todo) ── */
  const esGlobal = capsReady && (cu.rol === 'admin' || canSync(cu, 'proyectos', 'proyectos.admin') === 'all')
  const participaProy = useMemo(() => {
    const conTarea = new Set(tareas.filter(t => t.responsable_id === cu.id || t.asignado_por_id === cu.id).map(t => t.proyecto_id).filter(Boolean))
    const conTema = new Set(reunionTemas.filter(t => t.responsable_id === cu.id || (Array.isArray(t.corresponsables) && t.corresponsables.includes(cu.id))).map(t => t.proyecto_id).filter(Boolean))
    return p => p.responsable_id === cu.id || p.patrocinador_id === cu.id || p.created_by === cu.id || conTarea.has(p.id) || conTema.has(p.id)
  }, [tareas, reunionTemas, cu.id])
  const participaReu = useMemo(() => {
    const temasMios = new Set(reunionTemas.filter(t => t.responsable_id === cu.id || (Array.isArray(t.corresponsables) && t.corresponsables.includes(cu.id))).map(t => t.reunion_id))
    const tareaMiaEnReu = new Set()
    reunionTemas.forEach(t => { if (t.tarea_id) { const tk = tareas.find(x => x.id === t.tarea_id); if (tk && tk.responsable_id === cu.id) tareaMiaEnReu.add(t.reunion_id) } })
    return r => r.convocante_id === cu.id || r.created_by === cu.id || (Array.isArray(r.asistentes) && r.asistentes.includes(cu.id)) || temasMios.has(r.id) || tareaMiaEnReu.has(r.id)
  }, [reunionTemas, tareas, cu.id])
  const proyVis = useMemo(() => esGlobal ? proyectos : proyectos.filter(participaProy), [proyectos, esGlobal, participaProy])
  const reuVis = useMemo(() => esGlobal ? reuniones : reuniones.filter(participaReu), [reuniones, esGlobal, participaReu])
  const proyVisIds = useMemo(() => new Set(proyVis.map(p => p.id)), [proyVis])
  const reuVisIds = useMemo(() => new Set(reuVis.map(r => r.id)), [reuVis])
  const temasVis = useMemo(() => esGlobal ? reunionTemas : reunionTemas.filter(t => reuVisIds.has(t.reunion_id)), [reunionTemas, reuVisIds, esGlobal])
  const temaVisIds = useMemo(() => new Set(temasVis.map(t => t.id)), [temasVis])
  const tareasVis = useMemo(() => esGlobal ? tareas : tareas.filter(t => (t.proyecto_id && proyVisIds.has(t.proyecto_id)) || t.responsable_id === cu.id || t.asignado_por_id === cu.id || (t.tema_id && temaVisIds.has(t.tema_id))), [tareas, proyVisIds, temaVisIds, esGlobal, cu.id])

  const kpis = useMemo(() => ({
    activos: proyVis.filter(p => ["aprobado", "en_curso"].includes(p.estado)).length,
    riesgo: proyVis.filter(p => p.estado === "en_riesgo").length,
    atrasados: proyVis.filter(atrasado).length,
    completados: proyVis.filter(p => p.estado === "completado").length
  }), [proyVis])

  const porArea = useMemo(() => {
    const vivos = proyVis.filter(p => !["completado", "cancelado"].includes(p.estado))
    return Object.keys(AREAS).map(k => ({ k, n: vivos.filter(p => p.area === k).length })).filter(a => a.n > 0)
  }, [proyVis])

  const filtrados = useMemo(() => {
    const t = fTexto.trim().toLowerCase()
    const base = proyVis.filter(p =>
      (!fArea || p.area === fArea) &&
      (!fEstado || p.estado === fEstado) &&
      (!t || (p.nombre || "").toLowerCase().includes(t) || (p.objetivo || "").toLowerCase().includes(t) || (p.codigo || "").toLowerCase().includes(t))
    )
    const val = p => {
      if (sortKey === "responsable") return (nombreDe(p.responsable_id) || "").toLowerCase()
      if (sortKey === "avance_pct") return Number(p.avance_pct) || 0
      return (p[sortKey] ?? "") === null ? "" : String(p[sortKey] ?? "").toLowerCase()
    }
    return [...base].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va < vb) return -sortDir
      if (va > vb) return sortDir
      return 0
    })
  }, [proyVis, fArea, fEstado, fTexto, sortKey, sortDir, nombreDe])

  const puedeCrear = capsReady && !!canSync(cu, 'proyectos', 'proyectos.proyecto.crear')
  const puedeEditar = capsReady && !!canSync(cu, 'proyectos', 'proyectos.proyecto.editar')
  const esAdmin = capsReady && (cu.rol === 'admin' || canSync(cu, 'proyectos', 'proyectos.admin') === 'all')
  const scopeDerivar = capsReady ? canSync(cu, 'proyectos', 'proyectos.tarea.derivar') : false
  const puedeTareas = capsReady && (!!scopeDerivar || !!canSync(cu, 'proyectos', 'proyectos.tarea.crear'))
  const puedeSubirEnt = capsReady && !!canSync(cu, 'proyectos', 'proyectos.entregable.subir')
  const puedeAprobarEnt = capsReady && (!!canSync(cu, 'proyectos', 'proyectos.entregable.aprobar') || esAdmin)

  const subordinadosDe = useMemo(() => {
    const hijos = {}
    usuarios.forEach(u => { if (u.reporta_a) (hijos[u.reporta_a] = hijos[u.reporta_a] || []).push(u.id) })
    return jefeId => {
      const out = new Set(), pila = [...(hijos[jefeId] || [])]
      while (pila.length) { const x = pila.pop(); if (out.has(x)) continue; out.add(x); (hijos[x] || []).forEach(h => pila.push(h)) }
      return out
    }
  }, [usuarios])

  const usuariosDerivables = useMemo(() => {
    if (scopeDerivar === 'all') return usuarios
    const subs = subordinadosDe(cu.id)
    return usuarios.filter(u => u.id === cu.id || subs.has(u.id))
  }, [usuarios, scopeDerivar, subordinadosDe, cu.id])

  const tareasProyecto = useMemo(() => tareas.filter(t => t.proyecto_id === tareaProyId), [tareas, tareaProyId])
  const misTareas = useMemo(() => tareas.filter(t => t.responsable_id === cu.id && t.estado !== "completada"), [tareas, cu.id])
  const nombreProy = useMemo(() => { const m = {}; proyectos.forEach(p => { m[p.id] = p.nombre }); return id => m[id] || "—" }, [proyectos])
  const chkMap = useMemo(() => {
    const m = {}
    checklist.forEach(c => { const x = m[c.tarea_id] = m[c.tarea_id] || { tot: 0, done: 0 }; x.tot++; if (c.hecho) x.done++ })
    return m
  }, [checklist])
  const chkDe = tareaId => checklist.filter(c => c.tarea_id === tareaId)
  /* Estado unificado de un compromiso de acta: si tiene tarea, manda la tarea */
  const estadoTema = t => {
    if (t.tarea_id) {
      const tk = tareas.find(x => x.id === t.tarea_id)
      if (!tk) return t.estado || "no_iniciado"
      if (tk.estado === "completada") return "cumplido"
      if (tk.estado === "pendiente") return "no_iniciado"
      return "en_curso"
    }
    return t.estado || "no_iniciado"
  }
  const vencidoTema = t => t.fecha_compromiso && t.fecha_compromiso < hoy() && !["cumplido", "aprobada"].includes(estadoTema(t))
  const diasDesde = f => { if (!f) return null; const a = new Date(hoy() + "T00:00:00"), b = new Date(String(f).slice(0, 10) + "T00:00:00"); return Math.max(0, Math.round((a - b) / 86400000)) }
  const avancesDe = temaId => temaAvances.filter(a => a.tema_id === temaId)
  const avMap = useMemo(() => {
    const m = {}
    temaAvances.forEach(a => { const x = m[a.tema_id] = m[a.tema_id] || { n: 0, ult: null }; x.n++; if (!x.ult || a.created_at > x.ult) x.ult = a.created_at })
    return m
  }, [temaAvances])
  const diasAbiertoTema = (t, fechaReunion) => {
    const creado = String(t.created_at || "").slice(0, 10) || fechaReunion
    const base = fechaReunion && fechaReunion < creado ? fechaReunion : creado
    return diasDesde(base) ?? 0
  }
  const agregarAvance = async t => {
    if (!avanceTxt.trim()) return
    setAvBusy(true)
    try {
      const { error } = await supabase.from('pmo_tema_avances').insert({ id: "AVA-" + uid(), tema_id: t.id, contenido: avanceTxt.trim(), autor_id: cu.id })
      if (error) throw error
      // El primer registro de gestión activa el compromiso: no_iniciado → en_curso
      if (!t.tarea_id && (t.estado || "no_iniciado") === "no_iniciado") {
        await supabase.from('pmo_reunion_temas').update({ estado: "en_curso" }).eq('id', t.id)
      }
      setAvanceTxt("")
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setAvBusy(false) }
  }

  /* ── Serie de sesiones: cada acta puede encadenarse a la anterior ── */
  const serieDe = r => {
    if (!r) return []
    const byId = {}; reuniones.forEach(x => { byId[x.id] = x })
    let root = byId[r.id] || r, guard = 0
    while (root.reunion_padre_id && byId[root.reunion_padre_id] && guard++ < 100) root = byId[root.reunion_padre_id]
    const out = [root]; let cur = root; guard = 0
    while (guard++ < 100) { const c = reuniones.find(x => x.reunion_padre_id === cur.id); if (!c) break; out.push(c); cur = c }
    return out
  }
  const serieSel = reunionSel ? serieDe(reunionSel) : []
  const serieIds = serieSel.map(x => x.id)
  const temasSerie = reunionTemas.filter(t => serieIds.includes(t.reunion_id))
  const temasAbiertos = temasSerie.filter(t => estadoTema(t) !== "cumplido")
  const cumplidosSerie = temasSerie.filter(t => estadoTema(t) === "cumplido")
  const serieStats = (() => {
    const cs = temasSerie.filter(t => t.responsable_id)
    const cum = cs.filter(t => estadoTema(t) === "cumplido").length
    const seg = cs.filter(t => estadoTema(t) !== "aprobada").length
    const ven = cs.filter(vencidoTema).length
    const qui = cs.filter(t => {
      const e = estadoTema(t)
      if (e === "cumplido" || e === "aprobada") return false
      const a = avMap[t.id]
      const org = reuniones.find(x => x.id === t.reunion_id)
      const d = a?.ult ? diasDesde(a.ult) : diasAbiertoTema(t, org?.fecha)
      return d !== null && d >= 14
    }).length
    return { tot: cs.length, cum, ven, qui, tasa: seg ? Math.round(100 * cum / seg) : null }
  })()
  /* ── Plan de acción por compromiso: tareas/subtareas colgando del acta ── */
  const planMap = useMemo(() => {
    const m = {}
    tareas.forEach(t => { if (!t.tema_id) return; const x = m[t.tema_id] = m[t.tema_id] || { tot: 0, done: 0 }; x.tot++; if (t.estado === "completada") x.done++ })
    return m
  }, [tareas])
  const tareasDeTema = temaId => tareas.filter(t => t.tema_id === temaId)
  const logAvanceTemaAuto = async (temaId, contenido) => {
    try { await supabase.from('pmo_tema_avances').insert({ id: "AVA-" + uid(), tema_id: temaId, contenido, autor_id: cu.id }) } catch (e) { }
  }
  const crearTareaCompromiso = async tema => {
    if (!planAdd.titulo.trim()) return
    setPlanBusy(true)
    try {
      const proyDest = tema.proyecto_id || reunionSel?.proyecto_id || null
      const idT = "TSK-" + uid()
      const { error } = await supabase.from('pmo_tareas').insert({
        id: idT, proyecto_id: proyDest, tarea_padre_id: planAdd.padreId || null, tema_id: tema.id,
        titulo: planAdd.titulo.trim(),
        descripcion: 'Plan de acción del compromiso: ' + (tema.tema || tema.acuerdo || ''),
        responsable_id: planAdd.resp || null, asignado_por_id: cu.id, created_by: cu.id,
        fecha_vencimiento: planAdd.fecha || null,
        estado: 'pendiente', prioridad: 'media', avance_pct: 0, orden: tareasDeTema(tema.id).length
      })
      if (error) throw error
      await logAvanceTemaAuto(tema.id, (planAdd.padreId ? 'Subtarea' : 'Tarea') + ' del plan creada: ' + planAdd.titulo.trim() + (planAdd.resp && planAdd.resp !== cu.id ? ' → ' + nombreDe(planAdd.resp) : ''))
      if (proyDest) { await logTarea(proyDest, idT, 'derivacion', 'Tarea de compromiso de acta: ' + planAdd.titulo.trim()); await syncAvanceProyecto(proyDest) }
      if (planAdd.resp && planAdd.resp !== cu.id) {
        const u = usuarios.find(x => x.id === planAdd.resp)
        const link = linkCalendar({ titulo: "Tarea: " + planAdd.titulo.trim(), fecha: planAdd.fecha, detalles: "Compromiso de acta: " + (tema.tema || tema.acuerdo || "") + "\nGenerado desde ERP Proyectos - Outlet de Puertas SpA", correo: u?.correo })
        await notificarAsignacion({
          responsableId: planAdd.resp,
          asunto: "Nueva tarea de compromiso: " + planAdd.titulo.trim().slice(0, 90),
          mensaje: "Se te asigno una tarea del plan de accion de un compromiso de acta.\n\nTarea: " + planAdd.titulo.trim() + "\nCompromiso: " + (tema.tema || tema.acuerdo || "-") + (planAdd.fecha ? "\nVence: " + planAdd.fecha : "") + "\nAsignada por: " + (cu.nombre || cu.id) + (link ? "\n\nAgregala a tu Google Calendar:\n" + link : "") + "\n\n- ERP Proyectos - Outlet de Puertas SpA"
        })
        await crearEventoCalendar({ correo: u?.correo, titulo: "Tarea: " + planAdd.titulo.trim(), descripcion: "Compromiso: " + (tema.tema || tema.acuerdo || ""), fecha: planAdd.fecha })
      }
      setPlanAdd({ padreId: null, titulo: "", resp: "", fecha: "" })
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setPlanBusy(false) }
  }

  const nuevaSesion = async rBase => {
    setReuSaving(true)
    try {
      const serie = serieDe(rBase)
      const ult = serie[serie.length - 1] || rBase
      const id = "REU-" + uid()
      const row = {
        id, titulo: ult.titulo, fecha: hoy(), hora: ult.hora || null, lugar: ult.lugar || null,
        tipo: ult.tipo || "operativa", proyecto_id: ult.proyecto_id || null,
        asistentes: Array.isArray(ult.asistentes) ? ult.asistentes : [], resumen: null,
        convocante_id: cu.id, created_by: cu.id, reunion_padre_id: ult.id
      }
      const { error } = await supabase.from('pmo_reuniones').insert(row)
      if (error) throw error
      if (row.hora) {
        const correoConv = (usuarios.find(x => x.id === cu.id) || {}).correo || cu.correo
        const invitados = row.asistentes.map(idd => (usuarios.find(x => x.id === idd) || {}).correo).filter(c => c && c.includes("@") && c !== correoConv)
        await crearEventoCalendar({ correo: correoConv, titulo: "Reunión: " + row.titulo, descripcion: "Sesión de seguimiento · ERP Proyectos - Outlet de Puertas SpA", fecha: row.fecha, hora: row.hora, invitados })
      }
      setMsg({ t: "ok", x: "Nueva sesión creada — los compromisos abiertos se arrastran automáticamente" })
      await cargar()
      const { data: nv } = await supabase.from('pmo_reuniones').select('*').eq('id', id).maybeSingle()
      abrirReunionVer(nv || row)
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setReuSaving(false) }
  }

  const logTarea = async (proyId, tareaId, tipo, contenido) => {
    try { await supabase.from('pmo_bitacora').insert({ proyecto_id: proyId, tarea_id: tareaId, tipo, contenido, autor_id: cu.id }) } catch (e) { }
  }
  // Correo de asignación: inserta en 'notificaciones' → el trigger + edge function envían (igual que Compras)
  const notificarAsignacion = async ({ responsableId, asunto, mensaje }) => {
    try {
      if (!responsableId || responsableId === cu.id) return
      const u = usuarios.find(x => x.id === responsableId)
      if (!u || !u.correo || !u.correo.includes("@")) return
      await supabase.from('notificaciones').insert({
        id: uid(), tipo: "Email", destino_correo: u.correo, destino_nombre: u.nombre || u.correo,
        asunto, mensaje, estado: "Pendiente", usuario: cu.nombre || cu.id, rol: cu.rol || null,
        fecha: hoy(), hora: hora()
      })
    } catch (e) { /* la notificación nunca bloquea la operación */ }
  }
  // Evento real en el Google Calendar del usuario (requiere edge function 'google-calendar' + flag gcal_activo)
  const crearEventoCalendar = async ({ correo, titulo, descripcion, fecha, hora: horaEv, duracionMin, invitados }) => {
    try {
      if (cfgSys.gcal_activo !== "true" || !correo || !fecha) return
      await supabase.functions.invoke('google-calendar', {
        body: { correo, titulo, descripcion: descripcion || "", fecha, hora: horaEv || null, duracion_min: duracionMin || 60, invitados: invitados || [] }
      })
    } catch (e) { /* la agenda nunca bloquea la operación */ }
  }
  // Cambiar estado de un compromiso de acta (los sin tarea vinculada)
  const marcarTema = async (t, nuevoEstado) => {
    try {
      const upd = { estado: nuevoEstado }
      if (nuevoEstado === "cumplido") { upd.cumplido_por = cu.id; upd.fecha_cumplido = hoy() }
      else { upd.cumplido_por = null; upd.fecha_cumplido = null }
      const { error } = await supabase.from('pmo_reunion_temas').update(upd).eq('id', t.id)
      if (error) throw error
      try { await supabase.from('pmo_tema_avances').insert({ id: "AVA-" + uid(), tema_id: t.id, contenido: "Estado cambiado a: " + ((TEMA_ESTADOS[nuevoEstado] || {}).l || nuevoEstado), autor_id: cu.id }) } catch (e2) { }
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) }
  }
  const avanceRapido = async (t, nuevoEstado) => {
    try {
      const completada = nuevoEstado === "completada"
      const { error } = await supabase.from('pmo_tareas').update({
        estado: nuevoEstado, avance_pct: completada ? 100 : t.avance_pct,
        fecha_completada: completada ? hoy() : null, updated_at: new Date().toISOString()
      }).eq('id', t.id)
      if (error) throw error
      await logTarea(t.proyecto_id, t.id, 'cambio_estado', 'Tarea "' + t.titulo + '": ' + (TESTADOS[t.estado]?.l || t.estado) + ' → ' + (TESTADOS[nuevoEstado]?.l || nuevoEstado))
      if (t.tema_id && nuevoEstado === "completada") await logAvanceTemaAuto(t.tema_id, 'Tarea del plan completada: ' + t.titulo)
      await syncAvanceProyecto(t.proyecto_id)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) }
  }
  const abrirNuevaTarea = (proyId, padreId = null) => {
    setEditandoTarea(null)
    setTareaCtx({ proyecto_id: proyId, tarea_padre_id: padreId, tema_id: null })
    setTareaForm({ ...TAREA_FORM_VACIO, responsable_id: cu.id })
    setTareaBitacora([]); setComentario("")
    setShowTarea(true)
  }
  const abrirEditarTarea = t => {
    setEditandoTarea(t)
    setTareaCtx({ proyecto_id: t.proyecto_id, tarea_padre_id: t.tarea_padre_id, tema_id: t.tema_id || null })
    setTareaForm({
      titulo: t.titulo || "", descripcion: t.descripcion || "", responsable_id: t.responsable_id || "",
      fecha_inicio: t.fecha_inicio || "", fecha_vencimiento: t.fecha_vencimiento || "",
      prioridad: t.prioridad || "media", estado: t.estado || "pendiente",
      avance_pct: t.avance_pct ?? 0, requiere_entregable: !!t.requiere_entregable, es_hito: !!t.es_hito
    })
    setComentario("")
    setShowTarea(true)
    cargarBitacoraTarea(t.id)
  }
  const guardarTarea = async () => {
    if (!tareaForm.titulo.trim()) return
    setGuardandoTarea(true)
    try {
      const completada = tareaForm.estado === "completada"
      const row = {
        titulo: tareaForm.titulo.trim(),
        descripcion: tareaForm.descripcion.trim() || null,
        responsable_id: tareaForm.responsable_id || null,
        fecha_inicio: tareaForm.fecha_inicio || null,
        fecha_vencimiento: tareaForm.fecha_vencimiento || null,
        prioridad: tareaForm.prioridad || "media",
        estado: tareaForm.estado || "pendiente",
        avance_pct: completada ? 100 : (Number(tareaForm.avance_pct) || 0),
        requiere_entregable: !!tareaForm.requiere_entregable,
        es_hito: !!tareaForm.es_hito,
        fecha_completada: completada ? (editandoTarea?.fecha_completada || hoy()) : null,
        updated_at: new Date().toISOString()
      }
      let error, idTarea, proyId = tareaCtx.proyecto_id
      const cambioResp = !editandoTarea || editandoTarea.responsable_id !== row.responsable_id
      if (editandoTarea) {
        idTarea = editandoTarea.id
        if (cambioResp) row.asignado_por_id = cu.id
        ;({ error } = await supabase.from('pmo_tareas').update(row).eq('id', idTarea))
      } else {
        idTarea = "TSK-" + uid()
        row.id = idTarea; row.proyecto_id = proyId || null; row.tarea_padre_id = tareaCtx.tarea_padre_id; row.tema_id = tareaCtx.tema_id || null
        row.asignado_por_id = cu.id; row.created_by = cu.id
        ;({ error } = await supabase.from('pmo_tareas').insert(row))
      }
      if (error) throw error
      if (!editandoTarea) {
        const deriv = row.responsable_id && row.responsable_id !== cu.id
        await logTarea(proyId, idTarea, deriv ? 'derivacion' : 'sistema', 'Tarea creada: ' + row.titulo + (deriv ? ' · derivada a ' + nombreDe(row.responsable_id) : ''))
      } else {
        if (editandoTarea.estado !== row.estado)
          await logTarea(proyId, idTarea, 'cambio_estado', 'Tarea "' + row.titulo + '": ' + (TESTADOS[editandoTarea.estado]?.l || editandoTarea.estado) + ' → ' + (TESTADOS[row.estado]?.l || row.estado))
        if (cambioResp && row.responsable_id)
          await logTarea(proyId, idTarea, 'derivacion', 'Tarea "' + row.titulo + '" derivada a ' + nombreDe(row.responsable_id))
      }
      if (cambioResp && row.responsable_id && row.responsable_id !== cu.id) {
        const u = usuarios.find(x => x.id === row.responsable_id)
        const pn = proyId ? nombreProy(proyId) : "Compromiso de acta"
        const link = linkCalendar({ titulo: "Tarea: " + row.titulo, fecha: row.fecha_vencimiento, detalles: "Proyecto: " + pn + "\nResponsable: " + (u?.nombre || "") + "\nGenerado desde ERP Proyectos - Outlet de Puertas SpA", correo: u?.correo })
        await notificarAsignacion({
          responsableId: row.responsable_id,
          asunto: "Nueva tarea asignada: " + row.titulo,
          mensaje: "Se te asigno una tarea en Proyectos.\n\nTarea: " + row.titulo + "\nProyecto: " + pn + (row.fecha_vencimiento ? "\nVence: " + row.fecha_vencimiento : "") + "\nAsignada por: " + (cu.nombre || cu.id) + (link ? "\n\nAgregala a tu Google Calendar:\n" + link : "") + "\n\nAbrela en el ERP: " + (typeof window !== "undefined" ? window.location.origin : "") + "\n\n- ERP Proyectos - Outlet de Puertas SpA"
        })
        await crearEventoCalendar({ correo: u?.correo, titulo: "Tarea: " + row.titulo, descripcion: "Proyecto: " + pn + " · Asignada por " + (cu.nombre || cu.id), fecha: row.fecha_vencimiento })
      }
      setMsg({ t: "ok", x: editandoTarea ? "Tarea actualizada" : "Tarea creada" })
      setShowTarea(false)
      await syncAvanceProyecto(proyId)
      await cargar()
    } catch (e) {
      setMsg({ t: "error", x: e.message })
    } finally {
      setGuardandoTarea(false)
    }
  }

  /* ── Roll-up: el avance del proyecto se calcula desde sus tareas hoja ── */
  const syncAvanceProyecto = async proyId => {
    try {
      if (!proyId) return
      const { data } = await supabase.from('pmo_tareas').select('id,tarea_padre_id,avance_pct').eq('proyecto_id', proyId)
      if (!data || !data.length) return
      const conHijos = new Set(data.filter(t => t.tarea_padre_id).map(t => t.tarea_padre_id))
      const hojas = data.filter(t => !conHijos.has(t.id))
      if (!hojas.length) return
      const prom = Math.round(hojas.reduce((sm, t) => sm + (Number(t.avance_pct) || 0), 0) / hojas.length)
      await supabase.from('pmo_proyectos').update({ avance_pct: prom, updated_at: new Date().toISOString() }).eq('id', proyId)
    } catch (e) { /* el roll-up nunca bloquea */ }
  }

  /* ── Historial + comentarios por tarea ── */
  const cargarBitacoraTarea = async tareaId => {
    setTareaBitLoading(true)
    try {
      const { data } = await supabase.from('pmo_bitacora').select('*').eq('tarea_id', tareaId).order('created_at', { ascending: false }).limit(30)
      setTareaBitacora(data || [])
    } catch (e) { setTareaBitacora([]) } finally { setTareaBitLoading(false) }
  }
  const agregarComentario = async () => {
    if (!comentario.trim() || !editandoTarea) return
    setComentando(true)
    try {
      const { error } = await supabase.from('pmo_bitacora').insert({
        proyecto_id: editandoTarea.proyecto_id, tarea_id: editandoTarea.id,
        tipo: 'comentario', contenido: comentario.trim(), autor_id: cu.id
      })
      if (error) throw error
      setComentario("")
      await cargarBitacoraTarea(editandoTarea.id)
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setComentando(false) }
  }

  /* ── Carga rápida: un plan completo en un paso ── */
  const guardarRapida = async () => {
    const lineas = rapidaText.split("\n").map(l => l.trim()).filter(Boolean)
    if (!lineas.length || !tareaProyId) return
    setRapidaSaving(true)
    try {
      const rows = lineas.map((titulo, i) => ({
        id: "TSK-" + uid() + i,
        proyecto_id: tareaProyId, tarea_padre_id: null, titulo,
        responsable_id: rapidaResp || null, fecha_vencimiento: rapidaVence || null,
        estado: 'pendiente', prioridad: 'media', avance_pct: 0,
        asignado_por_id: cu.id, created_by: cu.id, orden: i
      }))
      const { error } = await supabase.from('pmo_tareas').insert(rows)
      if (error) throw error
      await logTarea(tareaProyId, null, 'sistema', rows.length + ' tareas creadas (carga rápida)' + (rapidaResp ? ' · derivadas a ' + nombreDe(rapidaResp) : ''))
      if (rapidaResp && rapidaResp !== cu.id) {
        const pn = nombreProy(tareaProyId)
        await notificarAsignacion({
          responsableId: rapidaResp,
          asunto: rows.length + " tareas nuevas asignadas - " + pn,
          mensaje: "Se te asignaron " + rows.length + " tareas en el proyecto " + pn + ".\n\n" + rows.map(r => "- " + r.titulo).join("\n") + (rapidaVence ? "\n\nVencimiento: " + rapidaVence : "") + "\nAsignadas por: " + (cu.nombre || cu.id) + "\n\n- ERP Proyectos - Outlet de Puertas SpA"
        })
      }
      setMsg({ t: "ok", x: rows.length + " tareas creadas" })
      setShowRapida(false); setRapidaText("")
      await syncAvanceProyecto(tareaProyId)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setRapidaSaving(false) }
  }

  /* ── Checklist de cumplimiento: el avance de la tarea sale de aquí ── */
  const recalcChecklist = async tarea => {
    try {
      const { data } = await supabase.from('pmo_checklist').select('hecho').eq('tarea_id', tarea.id)
      if (!data || !data.length) return
      const av = Math.round(100 * data.filter(x => x.hecho).length / data.length)
      await supabase.from('pmo_tareas').update({ avance_pct: av, updated_at: new Date().toISOString() }).eq('id', tarea.id)
      await syncAvanceProyecto(tarea.proyecto_id)
    } catch (e) { /* nunca bloquea */ }
  }
  const agregarChkItem = async () => {
    if (!chkNuevo.trim() || !editandoTarea) return
    setChkBusy(true)
    try {
      const { error } = await supabase.from('pmo_checklist').insert({
        id: "CHK-" + uid(), tarea_id: editandoTarea.id, texto: chkNuevo.trim(), orden: chkDe(editandoTarea.id).length
      })
      if (error) throw error
      setChkNuevo("")
      await recalcChecklist(editandoTarea)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setChkBusy(false) }
  }
  const toggleChkItem = async item => {
    setChkBusy(true)
    try {
      const nuevo = !item.hecho
      const { error } = await supabase.from('pmo_checklist').update({
        hecho: nuevo, hecho_por: nuevo ? cu.id : null, fecha_hecho: nuevo ? hoy() : null
      }).eq('id', item.id)
      if (error) throw error
      await recalcChecklist(editandoTarea)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setChkBusy(false) }
  }
  const evidenciaChkItem = async (item, file) => {
    if (!file || !editandoTarea) return
    setChkBusy(true)
    try {
      const limpio = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
      const path = editandoTarea.proyecto_id + "/" + item.tarea_id + "/chk_" + Date.now() + "_" + limpio
      const { error: eUp } = await supabase.storage.from('pmo').upload(path, file)
      if (eUp) throw eUp
      const url = supabase.storage.from('pmo').getPublicUrl(path).data.publicUrl
      const { error } = await supabase.from('pmo_checklist').update({ evidencia_url: url }).eq('id', item.id)
      if (error) throw error
      setMsg({ t: "ok", x: "Evidencia adjuntada" })
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setChkBusy(false) }
  }
  const eliminarChkItem = async item => {
    setChkBusy(true)
    try {
      const { error } = await supabase.from('pmo_checklist').delete().eq('id', item.id)
      if (error) throw error
      await recalcChecklist(editandoTarea)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setChkBusy(false) }
  }

  /* ── Reuniones: acta + acuerdos que se convierten en tareas derivadas ── */
  const abrirNuevaReunion = () => {
    setReunionSel(null)
    setReunionForm({ ...REU_FORM_VACIO, fecha: hoy(), asistentes: [cu.id] })
    setTemasNuevos([{ ...TEMA_VACIO }])
    setEditHead(true); setCumplidosOpen(false); setTemaOpen(null)
    setShowReunion(true)
  }
  const abrirReunionVer = r => {
    if (!esGlobal && !participaReu(r)) { setMsg({ t: "error", x: "No participas en esta reunión, no puedes abrirla." }); return }
    setReunionSel(r)
    setReunionForm({
      titulo: r.titulo || "", fecha: r.fecha || "", hora: r.hora || "", lugar: r.lugar || "",
      proyecto_id: r.proyecto_id || "", asistentes: Array.isArray(r.asistentes) ? r.asistentes : [], resumen: r.resumen || ""
    })
    setTemasNuevos([])
    setEditHead(false); setCumplidosOpen(false); setTemaOpen(null)
    setShowReunion(true)
  }
  const toggleAsistente = id => setReunionForm(f => ({
    ...f, asistentes: f.asistentes.includes(id) ? f.asistentes.filter(x => x !== id) : [...f.asistentes, id]
  }))
  const updTema = (i, campo, valor) => setTemasNuevos(ts => ts.map((t, j) => j === i ? { ...t, [campo]: valor } : t))
  const guardarReunion = async () => {
    if (!reunionForm.titulo.trim() || !reunionForm.fecha) return
    setReuSaving(true)
    try {
      const head = {
        titulo: reunionForm.titulo.trim(), fecha: reunionForm.fecha,
        hora: reunionForm.hora || null, lugar: reunionForm.lugar.trim() || null,
        proyecto_id: reunionForm.proyecto_id || null, tipo: reunionForm.tipo || "operativa",
        asistentes: reunionForm.asistentes, resumen: reunionForm.resumen.trim() || null,
        updated_at: new Date().toISOString()
      }
      let reuId = reunionSel?.id, error
      if (reuId) {
        ;({ error } = await supabase.from('pmo_reuniones').update(head).eq('id', reuId))
      } else {
        reuId = "REU-" + uid()
        ;({ error } = await supabase.from('pmo_reuniones').insert({ ...head, id: reuId, convocante_id: cu.id, created_by: cu.id }))
      }
      if (error) throw error
      // Cita en el Calendar de los asistentes (solo al crear, si tiene hora y la integración está activa)
      if (!reunionSel && reunionForm.hora) {
        const correoConv = (usuarios.find(x => x.id === cu.id) || {}).correo || cu.correo
        const invitados = reunionForm.asistentes.map(id => (usuarios.find(x => x.id === id) || {}).correo).filter(c => c && c.includes("@") && c !== correoConv)
        await crearEventoCalendar({ correo: correoConv, titulo: "Reunión: " + reunionForm.titulo.trim(), descripcion: (reunionForm.lugar ? "Lugar: " + reunionForm.lugar + "\n" : "") + "Convocada desde ERP Proyectos - Outlet de Puertas SpA", fecha: reunionForm.fecha, hora: reunionForm.hora, invitados })
      }

      const validos = temasNuevos.filter(t => t.tema.trim() || t.acuerdo.trim())

      let generadas = 0
      const proysAfectados = new Set()
      const base = reunionTemas.filter(t => t.reunion_id === reuId).length
      for (let i = 0; i < validos.length; i++) {
        const t = validos[i]
        const proyDest = t.proyecto_id || reunionForm.proyecto_id || null
        const corr = (t.corresponsables || []).filter(x => x && x !== t.responsable_id)
        const temaId = "TEM-" + uid()
        let tareaId = null
        if (t.crear && t.responsable_id && proyDest) {
          tareaId = "TSK-" + uid()
          const { error: eT } = await supabase.from('pmo_tareas').insert({
            id: tareaId, proyecto_id: proyDest, tarea_padre_id: null, tema_id: temaId,
            titulo: (t.acuerdo.trim() || t.tema.trim()).slice(0, 200),
            descripcion: 'Acuerdo de reunión: ' + reunionForm.titulo.trim() + ' (' + reunionForm.fecha + ')' + (t.tema.trim() && t.acuerdo.trim() ? '\nTema: ' + t.tema.trim() : '') + (corr.length ? '\nCorresponsables: ' + corr.map(nombreDe).join(', ') : ''),
            responsable_id: t.responsable_id, asignado_por_id: cu.id, created_by: cu.id,
            fecha_vencimiento: t.fecha_compromiso || null,
            estado: 'pendiente', prioridad: 'media', avance_pct: 0, orden: base + i
          })
          if (eT) throw eT
          proysAfectados.add(proyDest)
          await logTarea(proyDest, tareaId, 'derivacion', 'Acuerdo de reunión "' + reunionForm.titulo.trim() + '": ' + (t.acuerdo.trim() || t.tema.trim()) + ' → ' + nombreDe(t.responsable_id))
          generadas++
        }
        // Notificar el compromiso (con o sin tarea) a propietario y corresponsables
        const dests = [t.responsable_id, ...corr].filter((x, ix, arr) => x && arr.indexOf(x) === ix)
        for (const rid of dests) {
          if (rid === cu.id) continue
          const u = usuarios.find(x => x.id === rid)
          const acu = (t.acuerdo.trim() || t.tema.trim())
          const link = linkCalendar({ titulo: "Compromiso: " + acu, fecha: t.fecha_compromiso, detalles: "Reunión: " + reunionForm.titulo.trim() + (proyDest ? "\nProyecto: " + nombreProy(proyDest) : "") + "\nGenerado desde ERP Proyectos - Outlet de Puertas SpA", correo: u?.correo })
          await notificarAsignacion({
            responsableId: rid,
            asunto: "Compromiso de reunion asignado: " + acu.slice(0, 90),
            mensaje: "En la reunion '" + reunionForm.titulo.trim() + "' (" + reunionForm.fecha + ") se te asigno un compromiso.\n\nTema: " + (t.tema.trim() || "-") + "\nDecision/acuerdo: " + acu + (proyDest ? "\nProyecto: " + nombreProy(proyDest) : "") + (t.fecha_compromiso ? "\nPlazo: " + t.fecha_compromiso : "") + "\nAsignado por: " + (cu.nombre || cu.id) + (link ? "\n\nAgregalo a tu Google Calendar:\n" + link : "") + "\n\n- ERP Proyectos - Outlet de Puertas SpA"
          })
          await crearEventoCalendar({ correo: u?.correo, titulo: "Compromiso: " + acu.slice(0, 100), descripcion: "Reunión: " + reunionForm.titulo.trim() + (proyDest ? " · Proyecto: " + nombreProy(proyDest) : ""), fecha: t.fecha_compromiso })
        }
        const { error: eM } = await supabase.from('pmo_reunion_temas').insert({
          id: temaId, reunion_id: reuId, orden: base + i,
          tema: t.tema.trim() || null, acuerdo: t.acuerdo.trim() || null,
          responsable_id: t.responsable_id || null, corresponsables: corr,
          proyecto_id: t.proyecto_id || null, estado: t.estado || "no_iniciado",
          fecha_compromiso: t.fecha_compromiso || null, tarea_id: tareaId
        })
        if (eM) throw eM
      }
      for (const pd of proysAfectados) await syncAvanceProyecto(pd)
      setMsg({ t: "ok", x: reunionSel ? "Acta actualizada" + (generadas ? " · " + generadas + " tarea(s) generada(s)" : "") : "Reunión registrada" + (generadas ? " · " + generadas + " tarea(s) generada(s)" : "") })
      setShowReunion(false)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setReuSaving(false) }
  }

  /* ── Entregables: definir, entregar, revisar ── */
  const abrirNuevoEnt = () => { setEntForm({ ...ENT_FORM_VACIO, proyecto_id: entProyFiltro || "" }); setShowEnt(true) }
  const guardarEnt = async () => {
    if (!entForm.nombre.trim() || !entForm.proyecto_id) return
    setEntSaving(true)
    try {
      const row = {
        id: "ENT-" + uid(),
        nombre: entForm.nombre.trim(),
        descripcion: entForm.descripcion.trim() || null,
        tipo: entForm.tipo || "documento",
        proyecto_id: entForm.proyecto_id,
        tarea_id: entForm.tarea_id || null,
        fecha_limite: entForm.fecha_limite || null,
        estado: "pendiente"
      }
      const { error } = await supabase.from('pmo_entregables').insert(row)
      if (error) throw error
      await logTarea(row.proyecto_id, row.tarea_id, 'sistema', 'Entregable definido: ' + row.nombre)
      setMsg({ t: "ok", x: "Entregable definido" })
      setShowEnt(false)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setEntSaving(false) }
  }
  const abrirEntrega = e => { setEntSel(e); setEntUrl(""); setEntFile(null); setShowEntrega(true) }
  const confirmarEntrega = async () => {
    if (!entSel) return
    setEntregando(true)
    try {
      let url = entUrl.trim() || null
      if (entSel.tipo !== "enlace") {
        if (!entFile) throw new Error("Adjunta un archivo antes de entregar.")
        const limpio = entFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")
        const path = entSel.proyecto_id + "/" + entSel.id + "/" + Date.now() + "_" + limpio
        const { error: eUp } = await supabase.storage.from('pmo').upload(path, entFile)
        if (eUp) throw eUp
        url = supabase.storage.from('pmo').getPublicUrl(path).data.publicUrl
      } else if (!url) {
        throw new Error("Pega el enlace del entregable.")
      }
      const { error } = await supabase.from('pmo_entregables').update({
        archivo_url: url, estado: "entregado",
        entregado_por: cu.id, fecha_entrega: new Date().toISOString()
      }).eq('id', entSel.id)
      if (error) throw error
      await logTarea(entSel.proyecto_id, entSel.tarea_id, 'entrega', 'Entregable "' + entSel.nombre + '" entregado por ' + (cu.nombre || cu.id))
      setMsg({ t: "ok", x: "Entregable enviado a revisión" })
      setShowEntrega(false)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setEntregando(false) }
  }
  const abrirRevision = e => { setEntSel(e); setEntComent(""); setShowRevision(true) }
  const resolverRevision = async aprobado => {
    if (!entSel) return
    setRevisando(true)
    try {
      const { error } = await supabase.from('pmo_entregables').update({
        estado: aprobado ? "aprobado" : "rechazado",
        verificado_por: cu.id, fecha_verificacion: new Date().toISOString(),
        comentario_verificacion: entComent.trim() || null
      }).eq('id', entSel.id)
      if (error) throw error
      await logTarea(entSel.proyecto_id, entSel.tarea_id, aprobado ? 'aprobacion' : 'rechazo',
        'Entregable "' + entSel.nombre + '" ' + (aprobado ? 'APROBADO' : 'RECHAZADO') + ' por ' + (cu.nombre || cu.id) + (entComent.trim() ? ' · ' + entComent.trim() : ''))
      setMsg({ t: "ok", x: aprobado ? "Entregable aprobado" : "Entregable rechazado" })
      setShowRevision(false)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setRevisando(false) }
  }

  const orgDirty = useMemo(() => Object.keys(orgEdit).some(k => (orgEdit[k] || "") !== (orgBase[k] || "")), [orgEdit, orgBase])
  const creaCiclo = (userId, jefeId) => {
    let cur = jefeId, guard = 0
    while (cur && guard++ < 200) { if (cur === userId) return true; cur = orgEdit[cur] || "" }
    return false
  }
  const guardarOrganigrama = async () => {
    setOrgSaving(true)
    try {
      const cambios = Object.keys(orgEdit).filter(k => (orgEdit[k] || "") !== (orgBase[k] || ""))
      for (const k of cambios) { const v = orgEdit[k] || null; if (v && creaCiclo(k, v)) throw new Error("Ciclo en la jerarquía (" + nombreDe(k) + "). Revisa las líneas de reporte.") }
      for (const k of cambios) { const { error } = await supabase.from('usuarios').update({ reporta_a: orgEdit[k] || null }).eq('id', k); if (error) throw error }
      setMsg({ t: "ok", x: cambios.length + " línea(s) de reporte actualizada(s)" })
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setOrgSaving(false) }
  }

  /* ── Correlativo legible PRY-000001 ── */
  const sigCodigo = () => {
    let mx = 0
    proyectos.forEach(p => {
      const m = /^PRY-(\d+)$/.exec(p.codigo || "")
      if (m) mx = Math.max(mx, parseInt(m[1], 10))
    })
    return "PRY-" + String(mx + 1).padStart(6, "0")
  }

  /* ── Bitácora ── */
  const cargarBitacora = async proyectoId => {
    setBitLoading(true)
    try {
      const { data } = await supabase.from('pmo_bitacora')
        .select('*').eq('proyecto_id', proyectoId)
        .order('created_at', { ascending: false }).limit(30)
      setBitacora(data || [])
    } catch (e) { setBitacora([]) } finally { setBitLoading(false) }
  }
  const logBitacora = async (proyectoId, tipo, contenido) => {
    try {
      await supabase.from('pmo_bitacora').insert({ proyecto_id: proyectoId, tipo, contenido, autor_id: cu.id })
    } catch (e) { /* la bitácora nunca bloquea el guardado */ }
  }

  /* ── Acciones ── */
  const abrirNuevo = () => { setEditando(null); setForm(FORM_VACIO); setBitacora([]); setShowForm(true) }
  const abrirEditar = p => {
    setEditando(p)
    setForm({
      nombre: p.nombre || "", objetivo: p.objetivo || "", descripcion: p.descripcion || "",
      area: p.area || "operacion", patrocinador_id: p.patrocinador_id || "",
      responsable_id: p.responsable_id || "", sucursal_id: p.sucursal_id || "",
      prioridad: p.prioridad || "media", estado: p.estado || "propuesto",
      avance_pct: p.avance_pct ?? 0, fecha_inicio: p.fecha_inicio || "", fecha_fin_obj: p.fecha_fin_obj || ""
    })
    setShowForm(true)
    cargarBitacora(p.id)
  }

  const guardar = async () => {
    if (!form.nombre.trim()) return
    setGuardando(true)
    try {
      const completado = form.estado === "completado"
      const row = {
        nombre: form.nombre.trim(),
        objetivo: form.objetivo.trim() || null,
        descripcion: form.descripcion.trim() || null,
        area: form.area || null,
        patrocinador_id: form.patrocinador_id || null,
        responsable_id: form.responsable_id || null,
        sucursal_id: form.sucursal_id || null,
        prioridad: form.prioridad || "media",
        estado: form.estado || "propuesto",
        avance_pct: completado ? 100 : (Number(form.avance_pct) || 0),
        fecha_inicio: form.fecha_inicio || null,
        fecha_fin_obj: form.fecha_fin_obj || null,
        fecha_cierre: completado ? (editando?.fecha_cierre || hoy()) : null,
        updated_at: new Date().toISOString()
      }
      let error, idProyecto
      if (editando) {
        idProyecto = editando.id
        ;({ error } = await supabase.from('pmo_proyectos').update(row).eq('id', idProyecto))
      } else {
        idProyecto = "PRY-" + uid()
        row.id = idProyecto
        row.codigo = sigCodigo()
        row.created_by = cu.id
        ;({ error } = await supabase.from('pmo_proyectos').insert(row))
      }
      if (error) throw error
      // Bitácora automática (nunca bloquea)
      if (!editando) {
        await logBitacora(idProyecto, 'sistema', 'Proyecto creado (' + row.codigo + ')')
      } else if (editando.estado !== row.estado) {
        const de = ESTADOS[editando.estado]?.l || editando.estado
        const a = ESTADOS[row.estado]?.l || row.estado
        await logBitacora(idProyecto, 'cambio_estado', 'Estado: ' + de + ' → ' + a)
      }
      setMsg({ t: "ok", x: editando ? "Proyecto actualizado" : "Proyecto creado" })
      setShowForm(false)
      await cargar()
    } catch (e) {
      setMsg({ t: "error", x: e.message })
    } finally {
      setGuardando(false)
    }
  }

  /* ── Export XLSX (estándar del ecosistema) ── */
  const exportar = () => {
    const filas = filtrados.map(p => ({
      "Código": p.codigo || p.id,
      "Proyecto": p.nombre,
      "Objetivo": p.objetivo || "",
      "Área": AREAS[p.area]?.l || p.area || "",
      "Sucursal": SUCURSALES.find(s => s.id === (p.sucursal_id || ""))?.l || p.sucursal_id || "",
      "Patrocinador": nombreDe(p.patrocinador_id),
      "Responsable": nombreDe(p.responsable_id),
      "Prioridad": PRIORIDADES[p.prioridad] || p.prioridad || "",
      "Estado": ESTADOS[p.estado]?.l || p.estado || "",
      "Avance %": Math.round(p.avance_pct || 0),
      "Inicio": p.fecha_inicio || "",
      "Vence": p.fecha_fin_obj || "",
      "Cierre": p.fecha_cierre || "",
      "Atrasado": atrasado(p) ? "SÍ" : ""
    }))
    const ws = XLSX.utils.json_to_sheet(filas)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Proyectos")
    XLSX.writeFile(wb, "proyectos_" + hoy() + ".xlsx")
  }

  const toggleSort = k => {
    if (sortKey === k) setSortDir(d => -d)
    else { setSortKey(k); setSortDir(k === "created_at" ? -1 : 1) }
  }

  const cambiarApp = () => {
    try { localStorage.removeItem("outlet_app_actual") } catch (e) { }
    setAppActual(null)
  }
  const cerrarSesion = async () => {
    try { await signOut() } catch (e) { }
    try { localStorage.removeItem("erp_cu_id") } catch (e) { }
    try { localStorage.removeItem("outlet_app_actual") } catch (e) { }
    window.location.reload()
  }

  /* ── Pantallas de guardia ── */
  if (verificando) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f5f9", fontFamily: FONT }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 14, color: "#8E8E93" }}>Verificando acceso...</div>
        </div>
      </div>
    )
  }
  if (!tieneAcceso) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f5f9", fontFamily: FONT, padding: 20 }}>
        <div style={{ textAlign: "center", maxWidth: 420, background: "#fff", padding: 40, borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1C1C1E", marginBottom: 8 }}>Acceso denegado</div>
          <div style={{ fontSize: 14, color: "#8E8E93", marginBottom: 24, lineHeight: 1.5 }}>
            No tienes permiso para acceder al módulo de Proyectos.
          </div>
          <button onClick={cambiarApp} style={{ padding: "10px 20px", borderRadius: 12, background: NAVY, color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            ← Volver al inicio
          </button>
        </div>
      </div>
    )
  }

  const selStyle = { ...css.select, padding: "8px 12px", fontSize: 13 }

  return (
    <div style={{ fontFamily: FONT, margin: 0, padding: isMobile ? "0 10px 60px" : "0 20px 80px", background: "#f4f5f9", minHeight: "100vh", fontSize: 14 }}>
      <style>{`
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        *{box-sizing:border-box}
        input:focus,select:focus,textarea:focus{border-color:${NAVY}!important;box-shadow:0 0 0 3px rgba(22,33,62,0.1)}
        .pmo-th{font-size:11px;font-weight:700;color:#8E8E93;text-transform:uppercase;letter-spacing:0.03em;text-align:left;padding:8px 10px;white-space:nowrap;cursor:pointer;user-select:none}
        .pmo-th:hover{color:${NAVY}}
        .pmo-td{padding:9px 10px;border-top:1px solid #eceef3;vertical-align:middle}
        .pmo-tr:hover{background:#f8f9fc}
      `}</style>

      {/* HEADER */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: NAVY, padding: "12px 16px", margin: isMobile ? "0 -10px 10px" : "0 -20px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "#26305a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📋</div>
          <div>
            <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, color: "#eef1f8", letterSpacing: "-0.01em", lineHeight: 1.1 }}>Proyectos</div>
            <div style={{ fontSize: 11, color: "#9aa3bd" }}>Control de gestión</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!isMobile && (
            <div style={{ textAlign: "right", marginRight: 4 }}>
              <div style={{ fontSize: 13, color: "#eef1f8", lineHeight: 1.1 }}>{cu?.nombre}</div>
              <div style={{ fontSize: 11, color: "#9aa3bd" }}>Gestión de proyectos</div>
            </div>
          )}
          <button onClick={cambiarApp} title="Cambiar de aplicación" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: "6px 10px", borderRadius: 9, background: "#26305a", border: "none", cursor: "pointer", color: "#c7cee6" }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>⊞</span>
            <span style={{ fontSize: 9, fontWeight: 700 }}>Apps</span>
          </button>
          <button onClick={cerrarSesion} title="Cerrar sesión" style={{ width: 34, height: 34, borderRadius: 9, background: "#3a2036", border: "none", cursor: "pointer", fontSize: 13, color: "#f0a5b5" }}>⏻</button>
        </div>
      </div>

      {/* MENSAJE */}
      {msg && (
        <div onClick={() => setMsg(null)} style={{ padding: "9px 13px", borderRadius: 9, marginBottom: 10, fontSize: 13, fontWeight: 500, cursor: "pointer", background: msg.t === "error" ? "#fdeaea" : "#e6f6ec", color: msg.t === "error" ? "#A32D2D" : "#1f6e54" }}>
          {msg.t === "error" ? "⚠ " : "✓ "}{msg.x}
        </div>
      )}

      {/* TABS */}
      {!proyOpen && <div style={{ display: "flex", gap: 3, marginBottom: 14, background: "#e6e8f2", borderRadius: 10, padding: 3, overflowX: "auto" }}>
        {TABS.filter(t => !t.admin || esAdmin).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            flex: isMobile ? "0 0 auto" : 1, padding: "9px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            border: "none", cursor: "pointer", whiteSpace: "nowrap",
            background: tab === t.k ? "#fff" : "transparent",
            color: tab === t.k ? NAVY : "#7c839a",
            boxShadow: tab === t.k ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6
          }}>
            <span>{t.ic}</span><span>{t.l}</span>
            {t.soon && <span style={{ fontSize: 8, fontWeight: 700, color: "#b0b6c8", border: "1px solid #d3d7e3", borderRadius: 6, padding: "1px 4px" }}>PRONTO</span>}
          </button>
        ))}
      </div>}

      {/* ═══ PANEL ═══ */}
      {!proyOpen && tab === "panel" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
            <KpiCard l="Proyectos activos" v={kpis.activos} sub="aprobados + en curso" c={NAVY} />
            <KpiCard l="En riesgo" v={kpis.riesgo} sub="requieren seguimiento" c="#BA7517" />
            <KpiCard l="Atrasados" v={kpis.atrasados} sub="vencidos sin cerrar" c="#E24B4A" />
            <KpiCard l="Completados" v={kpis.completados} sub="cerrados con éxito" c="#3B6D11" />
          </div>
          {porArea.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#8E8E93", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}>Vivos por área:</span>
              {porArea.map(a => (
                <Bd key={a.k} c={AREAS[a.k].c} bg={AREAS[a.k].bg}>{AREAS[a.k].l} · {a.n}</Bd>
              ))}
            </div>
          )}
          {misTareas.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#3A3A3C", marginBottom: 8 }}>Mis pendientes ({misTareas.length})</div>
              <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden", marginBottom: 16 }}>
                {misTareas.slice(0, 6).map(t => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: "1px solid #eceef3" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: (TESTADOS[t.estado] || {}).dot || "#8E8E93", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(t.es_hito ? "◆ " : "") + t.titulo}</div>
                      <div style={{ fontSize: 11, color: "#AEAEB2" }}>{(t.proyecto_id ? nombreProy(t.proyecto_id) : (t.tema_id ? "🗓 Compromiso de acta" : "—")) + " · vence " + fFecha(t.fecha_vencimiento)}</div>
                    </div>
                    {t.fecha_vencimiento && <a href={linkCalendar({ titulo: "Tarea: " + t.titulo, fecha: t.fecha_vencimiento, detalles: "Proyecto: " + nombreProy(t.proyecto_id) + "\nGenerado desde ERP Proyectos - Outlet de Puertas SpA" })} target="_blank" rel="noreferrer" title="Agregar a Google Calendar" style={{ fontSize: 14, textDecoration: "none", flexShrink: 0 }}>📆</a>}
                    <Bt v="suc" sm onClick={() => avanceRapido(t, "completada")}>✓</Bt>
                    <button onClick={() => abrirEditarTarea(t)} title="Abrir" style={{ width: 28, height: 28, borderRadius: 7, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 13, color: NAVY, flexShrink: 0 }}>✎</button>
                  </div>
                ))}
              </div>
            </>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#3A3A3C" }}>Últimos proyectos</span>
            <span style={{ fontSize: 12, color: "#8E8E93" }}>{proyectos.length} en total · clic para abrir el expediente</span>
          </div>
          <TablaProyectos rows={proyVis.slice(0, 8)} loading={loading} nombreDe={nombreDe} onEditar={puedeEditar ? abrirEditar : null} onAbrir={p => { setProyOpen(p); setSubTab("resumen"); setTareaProyId(p.id) }} isMobile={isMobile} />
        </>
      )}

      {/* ═══ PROYECTOS ═══ */}
      {!proyOpen && tab === "proyectos" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            <input value={fTexto} onChange={e => setFTexto(e.target.value)} placeholder="Buscar por nombre, objetivo o código..." style={{ ...css.input, flex: "1 1 200px", padding: "8px 12px", fontSize: 13 }} />
            <select value={fArea} onChange={e => setFArea(e.target.value)} style={{ ...selStyle, width: "auto" }}>
              <option value="">Todas las áreas</option>
              {Object.entries(AREAS).map(([k, a]) => <option key={k} value={k}>{a.l}</option>)}
            </select>
            <select value={fEstado} onChange={e => setFEstado(e.target.value)} style={{ ...selStyle, width: "auto" }}>
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([k, s]) => <option key={k} value={k}>{s.l}</option>)}
            </select>
            <Bt v="gry" sm ic="📥" onClick={exportar} dis={!filtrados.length}>Excel</Bt>
            {puedeCrear && <Bt v="pri" sm ic="➕" onClick={abrirNuevo}>Nuevo proyecto</Bt>}
          </div>
          <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 6 }}>{filtrados.length} proyecto(s) · click en encabezado para ordenar</div>
          <TablaProyectos rows={filtrados} loading={loading} nombreDe={nombreDe} onEditar={puedeEditar ? abrirEditar : null} onAbrir={p => { setProyOpen(p); setSubTab("resumen"); setTareaProyId(p.id) }} isMobile={isMobile} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
        </>
      )}

      {/* ═══ REUNIONES ═══ */}
      {!proyOpen && tab === "reuniones" && (
        <>
          <div style={{ display: "flex", gap: 3, background: "#e6e8f2", borderRadius: 9, padding: 3, marginBottom: 12, width: "fit-content" }}>
            {[["actas", "🗓 Actas"], ["compromisos", "🎯 Compromisos"]].map(([k, l]) => (
              <button key={k} onClick={() => setReuVista(k)} style={{ padding: "7px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: reuVista === k ? "#fff" : "transparent", color: reuVista === k ? NAVY : "#7c839a" }}>{l}</button>
            ))}
          </div>
          {reuVista === "actas" && (
            <ReunionesPanel reuniones={reuVis} temas={temasVis} tareas={tareasVis} nombreDe={nombreDe} nombreProy={nombreProy}
              isMobile={isMobile} loading={loading} puedeCrear={puedeTareas} estadoTema={estadoTema}
              onNueva={abrirNuevaReunion} onAbrir={abrirReunionVer} />
          )}
          {reuVista === "compromisos" && (
            <CompromisosPanel temas={temasVis} reuniones={reuVis} tareas={tareasVis} usuarios={usuarios}
              nombreDe={nombreDe} nombreProy={nombreProy} isMobile={isMobile}
              estadoTema={estadoTema} vencidoTema={vencidoTema} onMarcar={marcarTema}
              avMap={avMap} diasDesde={diasDesde} onSeguimiento={t => { setSegTema(t); setAvanceTxt("") }}
              onAbrirTarea={t => abrirEditarTarea(t)} onAbrirActa={abrirReunionVer} />
          )}
        </>
      )}

      {/* ═══ ORGANIGRAMA ═══ */}
      {!proyOpen && tab === "organigrama" && esAdmin && (
        <OrganigramaEditor
          usuarios={usuarios} orgEdit={orgEdit} setOrgEdit={setOrgEdit} orgBase={orgBase}
          orgFiltro={orgFiltro} setOrgFiltro={setOrgFiltro} orgDirty={orgDirty} orgSaving={orgSaving}
          onGuardar={guardarOrganigrama} nombreDe={nombreDe} isMobile={isMobile}
        />
      )}

      {/* ═══ INFORMES (globales) ═══ */}
      {!proyOpen && tab === "informes" && (
        <InformesPanel tareas={tareasVis} proyectos={proyVis} nombreDe={nombreDe} isMobile={isMobile} />
      )}

      {/* ═══ WORKSPACE DE PROYECTO ═══ */}
      {proyOpen && (
        <ProyectoDetalle
          p={proyOpen} subTab={subTab} setSubTab={setSubTab} onBack={() => setProyOpen(null)}
          tareas={tareas} entregables={entregables} chkMap={chkMap} misTareas={misTareas}
          nombreDe={nombreDe} nombreProy={nombreProy} isMobile={isMobile} loading={loading}
          puedeTareas={puedeTareas} puedeSubirEnt={puedeSubirEnt} puedeAprobarEnt={puedeAprobarEnt}
          onEditarProyecto={puedeEditar ? abrirEditar : null}
          onNuevaTarea={abrirNuevaTarea} onEditarTarea={abrirEditarTarea} onAvance={avanceRapido}
          onRapida={() => setShowRapida(true)}
          onNuevoEnt={() => { setEntForm({ ...ENT_FORM_VACIO, proyecto_id: proyOpen.id }); setShowEnt(true) }}
          onEntregar={abrirEntrega} onRevisar={abrirRevision}
          fEstadoEnt={entEstadoFiltro} setFEstadoEnt={setEntEstadoFiltro}
        />
      )}

      {/* ═══ FORMULARIO ═══ */}
      <Sheet show={showForm} onClose={() => setShowForm(false)} title={editando ? ((editando.codigo || "") + " · Editar proyecto") : "Nuevo proyecto"}>
        <Fl l="Nombre del proyecto" req>
          <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Apertura sucursal Maipú" style={css.input} autoFocus />
        </Fl>
        <Fl l="Objetivo">
          <textarea value={form.objetivo} onChange={e => setForm(f => ({ ...f, objetivo: e.target.value }))} placeholder="¿Qué se busca lograr?" rows={2} style={{ ...css.input, resize: "vertical" }} />
        </Fl>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Fl l="Área">
            <select value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))} style={css.select}>
              {Object.entries(AREAS).map(([k, a]) => <option key={k} value={k}>{a.l}</option>)}
            </select>
          </Fl>
          <Fl l="Sucursal">
            <select value={form.sucursal_id} onChange={e => setForm(f => ({ ...f, sucursal_id: e.target.value }))} style={css.select}>
              {SUCURSALES.map(s => <option key={s.id} value={s.id}>{s.l}</option>)}
            </select>
          </Fl>
          <Fl l="Patrocinador">
            <select value={form.patrocinador_id} onChange={e => setForm(f => ({ ...f, patrocinador_id: e.target.value }))} style={css.select}>
              <option value="">— Sin asignar —</option>
              {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre || u.correo}</option>)}
            </select>
          </Fl>
          <Fl l="Responsable">
            <select value={form.responsable_id} onChange={e => setForm(f => ({ ...f, responsable_id: e.target.value }))} style={css.select}>
              <option value="">— Sin asignar —</option>
              {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre || u.correo}</option>)}
            </select>
          </Fl>
          <Fl l="Prioridad">
            <select value={form.prioridad} onChange={e => setForm(f => ({ ...f, prioridad: e.target.value }))} style={css.select}>
              {Object.entries(PRIORIDADES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Fl>
          <Fl l="Estado">
            <select value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} style={css.select}>
              {Object.entries(ESTADOS).map(([k, s]) => <option key={k} value={k}>{s.l}</option>)}
            </select>
          </Fl>
          <Fl l="Fecha inicio">
            <input type="date" value={form.fecha_inicio} onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))} style={css.input} />
          </Fl>
          <Fl l="Fecha objetivo término">
            <input type="date" value={form.fecha_fin_obj} onChange={e => setForm(f => ({ ...f, fecha_fin_obj: e.target.value }))} style={css.input} />
          </Fl>
        </div>
        {form.estado === "completado"
          ? <div style={{ fontSize: 12, color: "#3B6D11", background: "#eef7e6", borderRadius: 8, padding: "8px 12px", marginBottom: 14 }}>✓ Al guardar como Completado, el avance queda en 100% y se registra la fecha de cierre.</div>
          : <Fl l={"Avance: " + form.avance_pct + "%"}>
              <input type="range" min="0" max="100" step="5" value={form.avance_pct} onChange={e => setForm(f => ({ ...f, avance_pct: e.target.value }))} style={{ width: "100%" }} />
            </Fl>
        }
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Bt v="gry" full onClick={() => setShowForm(false)}>Cancelar</Bt>
          <Bt v="pri" full dis={!form.nombre.trim() || guardando} onClick={guardar}>
            {guardando ? "Guardando..." : (editando ? "Guardar cambios" : "Crear proyecto")}
          </Bt>
        </div>

        {/* Historial (solo en edición) */}
        {editando && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#3A3A3C", marginBottom: 8 }}>Historial</div>
            {bitLoading && <div style={{ fontSize: 12, color: "#8E8E93" }}>Cargando historial...</div>}
            {!bitLoading && !bitacora.length && <div style={{ fontSize: 12, color: "#AEAEB2" }}>Sin registros aún.</div>}
            {!bitLoading && bitacora.map(b => (
              <div key={b.id} style={{ display: "flex", gap: 8, padding: "7px 0", borderTop: "1px solid #f0f1f5", alignItems: "flex-start" }}>
                <span style={{ fontSize: 13, lineHeight: "18px" }}>{BIT_IC[b.tipo] || "•"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#3A3A3C" }}>{b.contenido}</div>
                  <div style={{ fontSize: 10, color: "#AEAEB2", marginTop: 1 }}>{fFechaHora(b.created_at)} · {nombreDe(b.autor_id)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Sheet>

      {/* ═══ FORMULARIO TAREA ═══ */}
      <Sheet show={showTarea} onClose={() => setShowTarea(false)} title={editandoTarea ? "Editar tarea" : (tareaCtx.tarea_padre_id ? "Nueva subtarea" : "Nueva tarea")}>
        <Fl l="Título de la tarea" req>
          <input value={tareaForm.titulo} onChange={e => setTareaForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej: Definir layout de la tienda" style={css.input} autoFocus />
        </Fl>
        <Fl l="Descripción">
          <textarea value={tareaForm.descripcion} onChange={e => setTareaForm(f => ({ ...f, descripcion: e.target.value }))} rows={2} style={{ ...css.input, resize: "vertical" }} />
        </Fl>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Fl l="Derivar a (responsable)">
            <select value={tareaForm.responsable_id} onChange={e => setTareaForm(f => ({ ...f, responsable_id: e.target.value }))} style={css.select}>
              <option value="">— Sin asignar —</option>
              {usuariosDerivables.map(u => <option key={u.id} value={u.id}>{(u.nombre || u.correo) + (u.id === cu.id ? " (yo)" : "")}</option>)}
            </select>
          </Fl>
          <Fl l="Prioridad">
            <select value={tareaForm.prioridad} onChange={e => setTareaForm(f => ({ ...f, prioridad: e.target.value }))} style={css.select}>
              {Object.entries(PRIORIDADES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Fl>
          <Fl l="Fecha inicio">
            <input type="date" value={tareaForm.fecha_inicio} onChange={e => setTareaForm(f => ({ ...f, fecha_inicio: e.target.value }))} style={css.input} />
          </Fl>
          <Fl l="Fecha vencimiento">
            <input type="date" value={tareaForm.fecha_vencimiento} onChange={e => setTareaForm(f => ({ ...f, fecha_vencimiento: e.target.value }))} style={css.input} />
          </Fl>
          <Fl l="Estado">
            <select value={tareaForm.estado} onChange={e => setTareaForm(f => ({ ...f, estado: e.target.value }))} style={css.select}>
              {Object.entries(TESTADOS).map(([k, es]) => <option key={k} value={k}>{es.l}</option>)}
            </select>
          </Fl>
          {(editandoTarea && chkDe(editandoTarea.id).length > 0) ? (
            <Fl l={"Avance (automático por checklist): " + (chkMap[editandoTarea.id] ? Math.round(100 * chkMap[editandoTarea.id].done / chkMap[editandoTarea.id].tot) : 0) + "%"}>
              <div style={{ height: 8, borderRadius: 999, background: "#eceef3", overflow: "hidden", marginTop: 6 }}>
                <div style={{ width: (chkMap[editandoTarea.id] ? Math.round(100 * chkMap[editandoTarea.id].done / chkMap[editandoTarea.id].tot) : 0) + "%", height: "100%", background: NAVY }} />
              </div>
            </Fl>
          ) : (
            <Fl l={"Avance: " + tareaForm.avance_pct + "%"}>
              <input type="range" min="0" max="100" step="5" value={tareaForm.avance_pct} disabled={tareaForm.estado === "completada"} onChange={e => setTareaForm(f => ({ ...f, avance_pct: e.target.value }))} style={{ width: "100%" }} />
            </Fl>
          )}
        </div>
        <div style={{ display: "flex", gap: 16, margin: "2px 0 14px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#3A3A3C", cursor: "pointer" }}>
            <input type="checkbox" checked={tareaForm.requiere_entregable} onChange={e => setTareaForm(f => ({ ...f, requiere_entregable: e.target.checked }))} /> Requiere entregable
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#3A3A3C", cursor: "pointer" }}>
            <input type="checkbox" checked={tareaForm.es_hito} onChange={e => setTareaForm(f => ({ ...f, es_hito: e.target.checked }))} /> Es hito
          </label>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Bt v="gry" full onClick={() => setShowTarea(false)}>Cancelar</Bt>
          <Bt v="pri" full dis={!tareaForm.titulo.trim() || guardandoTarea} onClick={guardarTarea}>{guardandoTarea ? "Guardando..." : (editandoTarea ? "Guardar" : "Crear tarea")}</Bt>
        </div>
        {editandoTarea && (editandoTarea.fecha_vencimiento || editandoTarea.fecha_inicio) && (
          <a href={linkCalendar({ titulo: "Tarea: " + editandoTarea.titulo, fecha: editandoTarea.fecha_vencimiento || editandoTarea.fecha_inicio, detalles: "Proyecto: " + nombreProy(editandoTarea.proyecto_id) + "\nGenerado desde ERP Proyectos - Outlet de Puertas SpA", correo: (usuarios.find(x => x.id === editandoTarea.responsable_id) || {}).correo })}
            target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 13, color: "#185FA5", fontWeight: 600, textDecoration: "none" }}>📆 Agregar a Google Calendar</a>
        )}

        {/* Checklist de cumplimiento (solo en edición) */}
        {editandoTarea && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#3A3A3C", marginBottom: 4 }}>
              Checklist de cumplimiento
              {chkMap[editandoTarea.id] && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: chkMap[editandoTarea.id].done === chkMap[editandoTarea.id].tot ? "#3B6D11" : "#854F0B" }}>✔ {chkMap[editandoTarea.id].done}/{chkMap[editandoTarea.id].tot}</span>}
            </div>
            <div style={{ fontSize: 11, color: "#AEAEB2", marginBottom: 8 }}>Cada ítem admite evidencia adjunta. Con checklist, el avance de la tarea se calcula solo.</div>
            {chkDe(editandoTarea.id).map(item => (
              <div key={item.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 0", borderTop: "1px solid #f0f1f5" }}>
                <input type="checkbox" checked={!!item.hecho} disabled={chkBusy} onChange={() => toggleChkItem(item)} style={{ marginTop: 2, cursor: "pointer" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: item.hecho ? "#AEAEB2" : "#1C1C1E", textDecoration: item.hecho ? "line-through" : "none" }}>{item.texto}</div>
                  {item.hecho && <div style={{ fontSize: 10, color: "#AEAEB2" }}>✓ {nombreDe(item.hecho_por)} · {fFecha(item.fecha_hecho)}</div>}
                </div>
                {item.evidencia_url && <a href={item.evidencia_url} target="_blank" rel="noreferrer" title="Ver evidencia" style={{ fontSize: 14, textDecoration: "none", flexShrink: 0 }}>🔗</a>}
                <label title="Adjuntar evidencia" style={{ fontSize: 14, cursor: "pointer", flexShrink: 0 }}>
                  📎<input type="file" style={{ display: "none" }} disabled={chkBusy} onChange={e => { const f = e.target.files?.[0]; if (f) evidenciaChkItem(item, f); e.target.value = "" }} />
                </label>
                <button onClick={() => eliminarChkItem(item)} disabled={chkBusy} title="Eliminar ítem" style={{ width: 22, height: 22, borderRadius: 6, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 11, color: "#A32D2D", flexShrink: 0 }}>✕</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input value={chkNuevo} onChange={e => setChkNuevo(e.target.value)} onKeyDown={e => { if (e.key === "Enter") agregarChkItem() }} placeholder="Nuevo ítem de cumplimiento..." style={{ ...css.input, padding: "8px 12px", fontSize: 13 }} />
              <Bt v="pri" sm dis={!chkNuevo.trim() || chkBusy} onClick={agregarChkItem}>{chkBusy ? "..." : "Agregar"}</Bt>
            </div>
          </div>
        )}

        {/* Historial y comentarios (solo en edición) */}
        {editandoTarea && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#3A3A3C", marginBottom: 8 }}>Historial y comentarios</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input value={comentario} onChange={e => setComentario(e.target.value)} onKeyDown={e => { if (e.key === "Enter") agregarComentario() }} placeholder="Escribe un comentario..." style={{ ...css.input, padding: "8px 12px", fontSize: 13 }} />
              <Bt v="pri" sm dis={!comentario.trim() || comentando} onClick={agregarComentario}>{comentando ? "..." : "Comentar"}</Bt>
            </div>
            {tareaBitLoading && <div style={{ fontSize: 12, color: "#8E8E93" }}>Cargando historial...</div>}
            {!tareaBitLoading && !tareaBitacora.length && <div style={{ fontSize: 12, color: "#AEAEB2" }}>Sin registros aún.</div>}
            {!tareaBitLoading && tareaBitacora.map(b => (
              <div key={b.id} style={{ display: "flex", gap: 8, padding: "7px 0", borderTop: "1px solid #f0f1f5", alignItems: "flex-start" }}>
                <span style={{ fontSize: 13, lineHeight: "18px" }}>{BIT_IC[b.tipo] || "•"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#3A3A3C" }}>{b.contenido}</div>
                  <div style={{ fontSize: 10, color: "#AEAEB2", marginTop: 1 }}>{fFechaHora(b.created_at)} · {nombreDe(b.autor_id)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Sheet>

      {/* ═══ CARGA RÁPIDA ═══ */}
      <Sheet show={showRapida} onClose={() => setShowRapida(false)} title="Carga rápida de tareas">
        <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 10, lineHeight: 1.5 }}>
          Escribe un plan completo: <strong>una tarea por línea</strong>. Todas se crean en el proyecto seleccionado, derivadas al responsable que elijas.
        </div>
        <Fl l="Tareas (una por línea)" req>
          <textarea value={rapidaText} onChange={e => setRapidaText(e.target.value)} rows={7} placeholder={"Definir layout de tienda\nCotizar racks y mobiliario\nContratar personal de sala\nHabilitar sistemas TI"} style={{ ...css.input, resize: "vertical", fontFamily: "inherit" }} />
        </Fl>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Fl l="Derivar todas a">
            <select value={rapidaResp} onChange={e => setRapidaResp(e.target.value)} style={css.select}>
              <option value="">— Sin asignar —</option>
              {usuariosDerivables.map(u => <option key={u.id} value={u.id}>{(u.nombre || u.correo) + (u.id === cu.id ? " (yo)" : "")}</option>)}
            </select>
          </Fl>
          <Fl l="Vencimiento común (opcional)">
            <input type="date" value={rapidaVence} onChange={e => setRapidaVence(e.target.value)} style={css.input} />
          </Fl>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Bt v="gry" full onClick={() => setShowRapida(false)}>Cancelar</Bt>
          <Bt v="pri" full dis={!rapidaText.trim() || rapidaSaving} onClick={guardarRapida}>{rapidaSaving ? "Creando..." : "Crear tareas"}</Bt>
        </div>
      </Sheet>

      {/* ═══ REUNIÓN / ACTA ═══ */}
      <FullSheet show={showReunion} onClose={() => setShowReunion(false)} title={reunionSel ? "Acta: " + (reunionSel.titulo || "") : (reunionForm.tipo === "directorio" ? "Nueva acta de directorio" : "Nueva reunión")}>
        {reunionSel && (
          <div style={{ background: "linear-gradient(135deg,#1a1a2e,#16213e)", borderRadius: 14, padding: "16px 20px", marginBottom: 14, color: "#eef1f8" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", background: reunionSel.tipo === "directorio" ? "#3C3489" : "#26305a", borderRadius: 6, padding: "3px 8px" }}>{(RTIPOS[reunionSel.tipo] || "Operativa").toUpperCase()}</span>
                  <span style={{ fontSize: 11, color: "#9aa3bd" }}>Sesión {serieSel.findIndex(x => x.id === reunionSel.id) + 1} de {serieSel.length}</span>
                </div>
                <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.01em", margin: "6px 0 3px" }}>{reunionSel.titulo}</div>
                <div style={{ fontSize: 12, color: "#9aa3bd" }}>📅 {fFecha(reunionSel.fecha)}{reunionSel.hora ? " · " + reunionSel.hora : ""}{reunionSel.lugar ? " · " + reunionSel.lugar : ""} · {Array.isArray(reunionSel.asistentes) ? reunionSel.asistentes.length : 0} asistentes · convoca {nombreDe(reunionSel.convocante_id)}</div>
                {!editHead && reunionForm.resumen && <div style={{ fontSize: 12, color: "#c7cee6", marginTop: 6, lineHeight: 1.5, maxWidth: 760 }}>{reunionForm.resumen}</div>}
              </div>
              <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, color: serieStats.tasa === null ? "#9aa3bd" : serieStats.tasa >= 80 ? "#7ed957" : serieStats.tasa >= 50 ? "#f0b25a" : "#f2707a" }}>{serieStats.tasa === null ? "—" : serieStats.tasa + "%"}</div>
                  <div style={{ fontSize: 10, color: "#9aa3bd", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Cumplimiento serie</div>
                </div>
                <div style={{ fontSize: 12, color: "#c7cee6", lineHeight: 1.8 }}>
                  <div>🎯 {serieStats.tot} compromisos · ✔ {serieStats.cum} cumplidos</div>
                  <div>{serieStats.ven ? "⚠ " + serieStats.ven + " vencidos" : "sin vencidos"} · {serieStats.qui ? "🔕 " + serieStats.qui + " sin movimiento" : "sin puntos estancados"}</div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              {serieSel.map((sx, i) => (esGlobal || reuVisIds.has(sx.id)) ? (
                <button key={sx.id} onClick={() => abrirReunionVer(sx)} style={{ border: "none", cursor: "pointer", borderRadius: 8, padding: "5px 11px", fontSize: 11.5, fontWeight: 700, background: sx.id === reunionSel.id ? "#fff" : "#26305a", color: sx.id === reunionSel.id ? "#16213e" : "#c7cee6" }}>Sesión {i + 1} · {fFecha(sx.fecha)}</button>
              ) : null)}
              {serieSel.length > 0 && serieSel[serieSel.length - 1].id === reunionSel.id && (
                <button onClick={() => nuevaSesion(reunionSel)} disabled={reuSaving} style={{ border: "1px dashed #4a5680", cursor: "pointer", borderRadius: 8, padding: "5px 11px", fontSize: 11.5, fontWeight: 700, background: "transparent", color: "#7ed957" }}>▶ Nueva sesión de seguimiento</button>
              )}
              <button onClick={() => setEditHead(v => !v)} style={{ border: "none", cursor: "pointer", borderRadius: 8, padding: "5px 11px", fontSize: 11.5, fontWeight: 700, background: "#26305a", color: "#c7cee6", marginLeft: "auto" }}>{editHead ? "Cerrar edición ▴" : "✎ Editar datos de la sesión"}</button>
            </div>
          </div>
        )}
        {(!reunionSel || editHead) && (<>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr 1fr 1fr", gap: 12 }}>
          <Fl l="Título de la reunión" req>
            <input value={reunionForm.titulo} onChange={e => setReunionForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej: Comité de apertura Maipú" style={css.input} autoFocus={!reunionSel} />
          </Fl>
          <Fl l="Fecha" req>
            <input type="date" value={reunionForm.fecha} onChange={e => setReunionForm(f => ({ ...f, fecha: e.target.value }))} style={css.input} />
          </Fl>
          <Fl l="Hora">
            <input type="time" value={reunionForm.hora} onChange={e => setReunionForm(f => ({ ...f, hora: e.target.value }))} style={css.input} />
          </Fl>
          <Fl l="Tipo de reunión">
            <select value={reunionForm.tipo} onChange={e => setReunionForm(f => ({ ...f, tipo: e.target.value }))} style={css.select}>
              {Object.entries(RTIPOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Fl>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Fl l="Lugar / medio">
            <input value={reunionForm.lugar} onChange={e => setReunionForm(f => ({ ...f, lugar: e.target.value }))} placeholder="Sala, Meet, etc." style={css.input} />
          </Fl>
          <Fl l="Proyecto por defecto de acuerdos (opcional)">
            <select value={reunionForm.proyecto_id} onChange={e => setReunionForm(f => ({ ...f, proyecto_id: e.target.value }))} style={css.select}>
              <option value="">— Sin proyecto —</option>
              {proyVis.map(p => <option key={p.id} value={p.id}>{(p.codigo ? p.codigo + " · " : "") + p.nombre}</option>)}
            </select>
          </Fl>
        </div>
        <Fl l={"Asistentes (" + reunionForm.asistentes.length + ")"}>
          <div style={{ maxHeight: 170, overflowY: "auto", border: "1px solid #e5e5ea", borderRadius: 12, padding: "8px 12px", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr 1fr", gap: 4 }}>
            {usuarios.map(u => (
              <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#3A3A3C", cursor: "pointer" }}>
                <input type="checkbox" checked={reunionForm.asistentes.includes(u.id)} onChange={() => toggleAsistente(u.id)} /> {u.nombre || u.correo}
              </label>
            ))}
          </div>
        </Fl>
        <Fl l="Resumen del acta">
          <textarea value={reunionForm.resumen} onChange={e => setReunionForm(f => ({ ...f, resumen: e.target.value }))} rows={3} placeholder="Síntesis de lo tratado..." style={{ ...css.input, resize: "vertical" }} />
        </Fl>
        </>)}

        {/* Compromisos de la serie: los abiertos se arrastran entre sesiones */}
        {reunionSel && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 14.5, fontWeight: 800, color: "#1C1C1E" }}>Seguimiento de compromisos <span style={{ color: "#8E8E93", fontWeight: 600 }}>· {temasAbiertos.length} abiertos en la serie</span></span>
              <span style={{ fontSize: 11, color: "#AEAEB2" }}>Los compromisos abiertos se arrastran automáticamente entre sesiones</span>
            </div>
            {!temasSerie.length && <div style={{ fontSize: 12.5, color: "#AEAEB2", padding: "14px 0" }}>Esta serie aún no tiene compromisos registrados.</div>}
            {temasAbiertos.map((t, idx) => {
              const est = estadoTema(t)
              const ec = TEMA_ESTADOS[est] || TEMA_ESTADOS.no_iniciado
              const corr = Array.isArray(t.corresponsables) ? t.corresponsables : []
              const origen = reuniones.find(x => x.id === t.reunion_id) || reunionSel
              const cerrado = est === "cumplido" || est === "aprobada"
              const abierto = diasAbiertoTema(t, origen.fecha)
              const av = avMap[t.id]
              const ultD = av?.ult ? diasDesde(av.ult) : null
              const quieto = !cerrado && (ultD === null ? abierto : ultD) >= 14
              const agingC = cerrado ? "#AEAEB2" : abierto >= 30 ? "#A32D2D" : abierto >= 15 ? "#854F0B" : "#8E8E93"
              const abiertoSeg = temaOpen === t.id
              return (
                <div key={t.id} style={{ border: "1px solid #eceef3", borderLeft: "3px solid " + ec.dot, borderRadius: 12, padding: "10px 14px", marginBottom: 8, background: quieto ? "#fffbf2" : "#fff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ fontSize: 13.5, color: "#1C1C1E", fontWeight: 700 }}>{(idx + 1) + ". " + (t.tema || "(sin tema)")}{t.reunion_id !== reunionSel.id && <span style={{ marginLeft: 8, fontSize: 9.5, fontWeight: 800, color: "#3C3489", background: "#EEEDFE", borderRadius: 6, padding: "2px 7px", verticalAlign: "middle" }}>↩ SESIÓN {fFecha(origen.fecha)}</span>}</div>
                      {t.acuerdo && <div style={{ fontSize: 12.5, color: "#3A3A3C", whiteSpace: "pre-wrap", marginTop: 2, lineHeight: 1.45 }}>{t.acuerdo}</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      {t.tarea_id
                        ? <><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: ec.dot }} /><span style={{ fontSize: 12, color: ec.c, fontWeight: 600 }}>{ec.l}</span></span>
                          <button onClick={() => { const tk = tareas.find(x => x.id === t.tarea_id); if (tk) { setShowReunion(false); abrirEditarTarea(tk) } }} style={{ border: "none", background: "#f4f5f9", borderRadius: 6, padding: "3px 9px", fontSize: 11, color: NAVY, cursor: "pointer", fontWeight: 600 }}>Abrir tarea ↗</button></>
                        : <select value={t.estado || "no_iniciado"} onChange={e => marcarTema(t, e.target.value)} style={{ ...css.select, padding: "4px 10px", fontSize: 12, width: "auto", fontWeight: 600, color: ec.c }}>
                            {Object.entries(TEMA_ESTADOS).map(([k, x]) => <option key={k} value={k}>{x.l}</option>)}
                          </select>}
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#8E8E93", marginTop: 7, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                    {t.responsable_id && <span>👤 {nombreDe(t.responsable_id)}{corr.length ? " + " + corr.map(nombreDe).join(", ") : ""}</span>}
                    {t.fecha_compromiso && (vencidoTema(t)
                      ? <span style={{ background: "#FDEAEA", color: "#A32D2D", fontWeight: 800, borderRadius: 999, padding: "2px 10px" }}>📅 vencido hace {diasDesde(t.fecha_compromiso)} d</span>
                      : <span>📅 plazo {fFecha(t.fecha_compromiso)}</span>)}
                    <span style={{ background: cerrado ? "#F2F2F7" : abierto >= 30 ? "#FDEAEA" : abierto >= 15 ? "#fdf3e6" : "#F2F2F7", color: agingC, fontWeight: 800, borderRadius: 999, padding: "2px 10px" }}>⏱ {abierto} d abierto</span>
                    <span>💬 {av?.n || 0} avance(s){av?.ult ? " · últ. " + (ultD === 0 ? "hoy" : "hace " + ultD + " d") : ""}</span>
                    {quieto && <span style={{ background: "#A32D2D", color: "#fff", fontWeight: 800, borderRadius: 999, padding: "2px 10px", fontSize: 10.5, letterSpacing: "0.04em" }}>🔕 SIN MOVIMIENTO</span>}
                    {planMap[t.id] && <span style={{ background: planMap[t.id].done === planMap[t.id].tot ? "#E1F5EE" : "#eef1f8", color: planMap[t.id].done === planMap[t.id].tot ? "#27500A" : NAVY, fontWeight: 800, borderRadius: 999, padding: "2px 10px" }}>📋 {planMap[t.id].done}/{planMap[t.id].tot} tareas</span>}
                    <button onClick={() => { setTemaOpen(abiertoSeg ? null : t.id); setAvanceTxt("") }} style={{ border: "none", background: abiertoSeg ? NAVY : "#f4f5f9", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: abiertoSeg ? "#fff" : NAVY, cursor: "pointer", fontWeight: 700 }}>{abiertoSeg ? "Ocultar seguimiento ▴" : "Seguimiento ▾"}</button>
                    <button onClick={() => { setPlanOpen(planOpen === t.id ? null : t.id); setPlanAdd({ padreId: null, titulo: "", resp: "", fecha: "" }) }} style={{ border: "none", background: planOpen === t.id ? "#1F6E54" : "#e9f4ef", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: planOpen === t.id ? "#fff" : "#1F6E54", cursor: "pointer", fontWeight: 700 }}>{planOpen === t.id ? "Ocultar plan ▴" : "📋 Plan de acción ▾"}</button>
                  </div>
                  {abiertoSeg && <SeguimientoTema avances={avancesDe(t.id)} nombreDe={nombreDe} valor={avanceTxt} setValor={setAvanceTxt} onAgregar={() => agregarAvance(t)} busy={avBusy} />}
                  {planOpen === t.id && (
                    <PlanAccionTema tema={t} lista={tareasDeTema(t.id)} nombreDe={nombreDe} usuariosDerivables={usuariosDerivables} cuId={cu.id}
                      planAdd={planAdd} setPlanAdd={setPlanAdd} busy={planBusy} chkMap={chkMap}
                      onCrear={() => crearTareaCompromiso(t)}
                      onCompletar={tt => avanceRapido(tt, "completada")}
                      onAbrir={tt => { setShowReunion(false); abrirEditarTarea(tt) }}
                      planListo={planMap[t.id] && planMap[t.id].tot > 0 && planMap[t.id].done === planMap[t.id].tot && estadoTema(t) !== "cumplido"}
                      onCumplir={() => marcarTema(t, "cumplido")} />
                  )}
                </div>
              )
            })}
            {cumplidosSerie.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => setCumplidosOpen(v => !v)} style={{ border: "none", background: "#eef7ea", color: "#27500A", borderRadius: 8, padding: "6px 13px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>✔ Cumplidos de la serie ({cumplidosSerie.length}) {cumplidosOpen ? "▴" : "▾"}</button>
                {cumplidosOpen && cumplidosSerie.map(t => {
                  const org = reuniones.find(x => x.id === t.reunion_id)
                  const abiertoSeg = temaOpen === t.id
                  return (
                    <div key={t.id} style={{ borderLeft: "3px solid #34C759", background: "#fbfefb", border: "1px solid #e3efe3", borderRadius: 10, padding: "8px 12px", marginTop: 6 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
                        <span style={{ fontWeight: 700, color: "#1C1C1E" }}>✔ {t.tema || t.acuerdo}</span>
                        <span style={{ fontSize: 11, color: "#8E8E93" }}>cumplido el {fFecha(t.fecha_cumplido)}{t.cumplido_por ? " por " + nombreDe(t.cumplido_por) : ""} · nació sesión {fFecha(org?.fecha)} · 💬 {(avMap[t.id] || {}).n || 0} registro(s)</span>
                        <button onClick={() => { setTemaOpen(abiertoSeg ? null : t.id); setAvanceTxt("") }} style={{ border: "none", background: "#f4f5f9", borderRadius: 6, padding: "2px 9px", fontSize: 11, color: NAVY, cursor: "pointer", fontWeight: 700, marginLeft: "auto" }}>{abiertoSeg ? "Historial ▴" : "Historial ▾"}</button>
                      </div>
                      {abiertoSeg && <SeguimientoTema avances={avancesDe(t.id)} nombreDe={nombreDe} valor={avanceTxt} setValor={setAvanceTxt} onAgregar={() => agregarAvance(t)} busy={avBusy} />}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Temas nuevos */}
        <div style={{ fontSize: 13, fontWeight: 700, color: "#3A3A3C", marginBottom: 6 }}>{reunionSel ? "Agregar temas / acuerdos" : "Temas y acuerdos"}</div>
        {temasNuevos.map((t, i) => {
          const proyEfect = t.proyecto_id || reunionForm.proyecto_id
          return (
          <div key={i} style={{ border: "1px solid #eceef3", borderRadius: 12, padding: "10px 12px", marginBottom: 8, background: "#fafbfd" }}>
            <input value={t.tema} onChange={e => updTema(i, "tema", e.target.value)} placeholder="Tema tratado" style={{ ...css.input, padding: "8px 12px", fontSize: 13, marginBottom: 8 }} />
            <textarea value={t.acuerdo} onChange={e => updTema(i, "acuerdo", e.target.value)} placeholder="Decisión / acuerdo / compromiso" rows={2} style={{ ...css.input, padding: "8px 12px", fontSize: 13, resize: "vertical", marginBottom: 8 }} />
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
              <select value={t.responsable_id} onChange={e => updTema(i, "responsable_id", e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13 }}>
                <option value="">— Propietario —</option>
                {usuariosDerivables.map(u => <option key={u.id} value={u.id}>{(u.nombre || u.correo) + (u.id === cu.id ? " (yo)" : "")}</option>)}
              </select>
              <select value="" onChange={e => { const v = e.target.value; if (v && !(t.corresponsables || []).includes(v) && v !== t.responsable_id) updTema(i, "corresponsables", [...(t.corresponsables || []), v]) }} style={{ ...css.select, padding: "8px 12px", fontSize: 13 }}>
                <option value="">＋ Corresponsable...</option>
                {usuariosDerivables.map(u => <option key={u.id} value={u.id}>{u.nombre || u.correo}</option>)}
              </select>
              <input type="date" value={t.fecha_compromiso} onChange={e => updTema(i, "fecha_compromiso", e.target.value)} style={{ ...css.input, padding: "8px 12px", fontSize: 13 }} />
              <select value={t.estado} onChange={e => updTema(i, "estado", e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13 }}>
                {Object.entries(TEMA_ESTADOS).map(([k, x]) => <option key={k} value={k}>{x.l}</option>)}
              </select>
              <select value={t.proyecto_id} onChange={e => updTema(i, "proyecto_id", e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, gridColumn: isMobile ? "auto" : "1 / -1" }}>
                <option value="">{reunionForm.proyecto_id ? "Proyecto: el de la reunión" : "— Sin proyecto (compromiso de acta) —"}</option>
                {proyVis.map(p => <option key={p.id} value={p.id}>{(p.codigo ? p.codigo + " · " : "") + p.nombre}</option>)}
              </select>
            </div>
            {(t.corresponsables || []).length > 0 && (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                {t.corresponsables.map(cid => (
                  <span key={cid} style={{ fontSize: 11, background: "#e6e8f2", color: "#3A3A3C", borderRadius: 999, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {nombreDe(cid)}<button onClick={() => updTema(i, "corresponsables", t.corresponsables.filter(x => x !== cid))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 10, color: "#A32D2D", padding: 0 }}>✕</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: proyEfect ? "#3A3A3C" : "#854F0B", cursor: "pointer" }}>
                <input type="checkbox" checked={t.crear} onChange={e => updTema(i, "crear", e.target.checked)} /> Generar tarea derivada{proyEfect ? "" : " (sin proyecto: quedará como compromiso de acta)"}
              </label>
              <button onClick={() => setTemasNuevos(ts => ts.filter((_, j) => j !== i))} style={{ width: 24, height: 24, borderRadius: 7, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 11, color: "#A32D2D" }}>✕</button>
            </div>
          </div>
        )})}
        <Bt v="gry" sm ic="➕" onClick={() => setTemasNuevos(ts => [...ts, { ...TEMA_VACIO }])}>Agregar tema</Bt>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <Bt v="gry" full onClick={() => setShowReunion(false)}>Cancelar</Bt>
          <Bt v="pri" full dis={!reunionForm.titulo.trim() || !reunionForm.fecha || reuSaving} onClick={guardarReunion}>{reuSaving ? "Guardando..." : (reunionSel ? "Guardar acta" : "Registrar reunión")}</Bt>
        </div>
      </FullSheet>

      {/* ═══ SEGUIMIENTO DE COMPROMISO (desde la matriz) ═══ */}
      <Sheet show={!!segTema} onClose={() => setSegTema(null)} title={"Seguimiento: " + (segTema?.tema || segTema?.acuerdo || "")}>
        {segTema && (
          <>
            {segTema.acuerdo && <div style={{ fontSize: 13, color: "#3A3A3C", whiteSpace: "pre-wrap", marginBottom: 6, lineHeight: 1.45 }}>{segTema.acuerdo}</div>}
            <div style={{ fontSize: 11.5, color: "#8E8E93", marginBottom: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
              {segTema.responsable_id && <span>👤 {nombreDe(segTema.responsable_id)}</span>}
              {segTema.fecha_compromiso && <span>📅 plazo {fFecha(segTema.fecha_compromiso)}</span>}
              {!segTema.tarea_id && (
                <select value={segTema.estado || "no_iniciado"} onChange={e => marcarTema(segTema, e.target.value)} style={{ ...css.select, padding: "2px 8px", fontSize: 11, width: "auto" }}>
                  {Object.entries(TEMA_ESTADOS).map(([k, x]) => <option key={k} value={k}>{x.l}</option>)}
                </select>
              )}
            </div>
            <SeguimientoTema avances={avancesDe(segTema.id)} nombreDe={nombreDe} valor={avanceTxt} setValor={setAvanceTxt} onAgregar={() => agregarAvance(segTema)} busy={avBusy} />
          </>
        )}
      </Sheet>

      {/* ═══ NUEVO ENTREGABLE ═══ */}
      <Sheet show={showEnt} onClose={() => setShowEnt(false)} title="Definir entregable">
        <Fl l="Nombre del entregable" req>
          <input value={entForm.nombre} onChange={e => setEntForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Contrato de arriendo firmado" style={css.input} autoFocus />
        </Fl>
        <Fl l="Descripción / medio de verificación">
          <textarea value={entForm.descripcion} onChange={e => setEntForm(f => ({ ...f, descripcion: e.target.value }))} rows={2} placeholder="¿Qué evidencia se espera?" style={{ ...css.input, resize: "vertical" }} />
        </Fl>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Fl l="Proyecto" req>
            <select value={entForm.proyecto_id} onChange={e => setEntForm(f => ({ ...f, proyecto_id: e.target.value, tarea_id: "" }))} style={css.select}>
              <option value="">— Selecciona —</option>
              {proyVis.map(p => <option key={p.id} value={p.id}>{(p.codigo ? p.codigo + " · " : "") + p.nombre}</option>)}
            </select>
          </Fl>
          <Fl l="Tarea asociada (opcional)">
            <select value={entForm.tarea_id} onChange={e => setEntForm(f => ({ ...f, tarea_id: e.target.value }))} style={css.select} disabled={!entForm.proyecto_id}>
              <option value="">— Sin tarea —</option>
              {tareas.filter(t => t.proyecto_id === entForm.proyecto_id).map(t => <option key={t.id} value={t.id}>{t.titulo}</option>)}
            </select>
          </Fl>
          <Fl l="Tipo">
            <select value={entForm.tipo} onChange={e => setEntForm(f => ({ ...f, tipo: e.target.value }))} style={css.select}>
              {Object.entries(ETIPOS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Fl>
          <Fl l="Fecha límite">
            <input type="date" value={entForm.fecha_limite} onChange={e => setEntForm(f => ({ ...f, fecha_limite: e.target.value }))} style={css.input} />
          </Fl>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Bt v="gry" full onClick={() => setShowEnt(false)}>Cancelar</Bt>
          <Bt v="pri" full dis={!entForm.nombre.trim() || !entForm.proyecto_id || entSaving} onClick={guardarEnt}>{entSaving ? "Guardando..." : "Definir entregable"}</Bt>
        </div>
      </Sheet>

      {/* ═══ ENTREGAR ═══ */}
      <Sheet show={showEntrega} onClose={() => setShowEntrega(false)} title={"Entregar: " + (entSel?.nombre || "")}>
        {entSel?.descripcion && <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 12, lineHeight: 1.5 }}>{entSel.descripcion}</div>}
        {entSel?.tipo === "enlace" ? (
          <Fl l="Enlace del entregable" req>
            <input value={entUrl} onChange={e => setEntUrl(e.target.value)} placeholder="https://..." style={css.input} autoFocus />
          </Fl>
        ) : (
          <Fl l={"Archivo (" + (ETIPOS[entSel?.tipo] || "Documento") + ")"} req>
            <input type="file" accept={entSel?.tipo === "foto" ? "image/*" : undefined} onChange={e => setEntFile(e.target.files?.[0] || null)} style={{ ...css.input, padding: "9px 12px" }} />
            {entFile && <div style={{ fontSize: 11, color: "#3B6D11", marginTop: 5 }}>✓ {entFile.name} ({Math.round(entFile.size / 1024)} KB)</div>}
          </Fl>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Bt v="gry" full onClick={() => setShowEntrega(false)}>Cancelar</Bt>
          <Bt v="pri" full dis={entregando || (entSel?.tipo === "enlace" ? !entUrl.trim() : !entFile)} onClick={confirmarEntrega}>{entregando ? "Subiendo..." : "Entregar a revisión"}</Bt>
        </div>
      </Sheet>

      {/* ═══ REVISAR ═══ */}
      <Sheet show={showRevision} onClose={() => setShowRevision(false)} title={"Revisar: " + (entSel?.nombre || "")}>
        {entSel?.archivo_url && (
          <div style={{ marginBottom: 12 }}>
            <a href={entSel.archivo_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#185FA5", fontWeight: 600 }}>🔗 Ver entregable adjunto</a>
          </div>
        )}
        <Fl l="Comentario de verificación (obligatorio si rechazas)">
          <textarea value={entComent} onChange={e => setEntComent(e.target.value)} rows={3} placeholder="Observaciones de la revisión..." style={{ ...css.input, resize: "vertical" }} />
        </Fl>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Bt v="dan" full dis={revisando || !entComent.trim()} onClick={() => resolverRevision(false)}>✕ Rechazar</Bt>
          <Bt v="suc" full dis={revisando} onClick={() => resolverRevision(true)}>✓ Aprobar</Bt>
        </div>
      </Sheet>
    </div>
  )
}

/* ═══ COMPONENTES INTERNOS ═══ */
function KpiCard({ l, v, sub, c }) {
  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: "12px 14px", border: "1px solid #eceef3" }}>
      <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 6 }}>{l}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: c, lineHeight: 1, letterSpacing: "-0.02em" }}>{v}</div>
      <div style={{ fontSize: 11, color: "#AEAEB2", marginTop: 5 }}>{sub}</div>
    </div>
  )
}

function TablaProyectos({ rows, loading, nombreDe, onEditar, onAbrir, isMobile, sortKey, sortDir, onSort }) {
  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#8E8E93", fontSize: 13 }}>Cargando proyectos...</div>
  if (!rows.length) return (
    <div style={{ textAlign: "center", padding: 40, background: "#fff", borderRadius: 14, border: "1px solid #eceef3", color: "#8E8E93", fontSize: 13 }}>
      No hay proyectos que mostrar. Crea el primero con “Nuevo proyecto”.
    </div>
  )
  const Th = ({ k, children, w }) => (
    <th className="pmo-th" style={{ width: w }} onClick={onSort ? () => onSort(k) : undefined}>
      {children}{onSort && sortKey === k && <span style={{ marginLeft: 3 }}>{sortDir === 1 ? "▲" : "▼"}</span>}
    </th>
  )
  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 700 : 0 }}>
          <thead>
            <tr style={{ background: "#f8f9fc" }}>
              <Th k="codigo" w={92}>Código</Th>
              <Th k="nombre">Proyecto</Th>
              <Th k="area">Área</Th>
              <Th k="responsable">Responsable</Th>
              <Th k="avance_pct" w={130}>Avance</Th>
              <Th k="fecha_fin_obj">Vence</Th>
              <Th k="estado">Estado</Th>
              {onEditar && <th className="pmo-th" style={{ width: 40, cursor: "default" }}></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const ar = AREAS[p.area] || { l: p.area || "—", c: "#5F5E5A", bg: "#F2F2F7" }
              const es = ESTADOS[p.estado] || { l: p.estado || "—", c: "#5F5E5A", dot: "#8E8E93" }
              const av = Math.round(p.avance_pct || 0)
              const atr = atrasado(p)
              return (
                <tr key={p.id} className="pmo-tr" onClick={() => onAbrir && onAbrir(p)} style={{ cursor: onAbrir ? "pointer" : "default" }}>
                  <td className="pmo-td" style={{ fontSize: 11, color: "#8E8E93", fontFamily: "ui-monospace,Menlo,monospace", whiteSpace: "nowrap" }}>{p.codigo || "—"}</td>
                  <td className="pmo-td">
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>{p.nombre}</div>
                    {p.objetivo && <div style={{ fontSize: 11, color: "#AEAEB2", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.objetivo}</div>}
                  </td>
                  <td className="pmo-td"><Bd c={ar.c} bg={ar.bg}>{ar.l}</Bd></td>
                  <td className="pmo-td" style={{ fontSize: 12, color: "#3A3A3C", whiteSpace: "nowrap" }}>{nombreDe(p.responsable_id)}</td>
                  <td className="pmo-td">
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 999, background: "#eceef3", overflow: "hidden" }}>
                        <div style={{ width: av + "%", height: "100%", background: NAVY }} />
                      </div>
                      <span style={{ fontSize: 11, color: "#8E8E93", minWidth: 28, textAlign: "right" }}>{av}%</span>
                    </div>
                  </td>
                  <td className="pmo-td" style={{ fontSize: 12, color: atr ? "#E24B4A" : "#8E8E93", fontWeight: atr ? 600 : 400, whiteSpace: "nowrap" }}>{fFecha(p.fecha_fin_obj)}{atr && " ⚠"}</td>
                  <td className="pmo-td">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: es.dot }} />
                      <span style={{ fontSize: 12, color: es.c, fontWeight: 500 }}>{es.l}</span>
                    </span>
                  </td>
                  {onEditar && (
                    <td className="pmo-td">
                      <button onClick={ev => { ev.stopPropagation(); onEditar(p) }} title="Editar" style={{ width: 28, height: 28, borderRadius: 7, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 13, color: NAVY }}>✎</button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}


/* ═══ PANEL DE TAREAS (árbol de derivación) ═══ */
function TareasPanel({ isMobile, proyectos, tareasProyecto, misTareas, tareaVista, setTareaVista, tareaProyId, setTareaProyId, nombreDe, nombreProy, puedeTareas, loading, onNueva, onEditar, onAvance, onRapida, fijo, chkMap }) {
  const vista = fijo ? "proyecto" : tareaVista
  const roots = tareasProyecto.filter(t => !t.tarea_padre_id)
  const hijosDe = pid => tareasProyecto.filter(t => t.tarea_padre_id === pid)
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {!fijo && <div style={{ display: "flex", gap: 3, background: "#e6e8f2", borderRadius: 9, padding: 3 }}>
          {[["proyecto", "Por proyecto"], ["mias", "Mis tareas"]].map(([k, l]) => (
            <button key={k} onClick={() => setTareaVista(k)} style={{ padding: "7px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: tareaVista === k ? "#fff" : "transparent", color: tareaVista === k ? NAVY : "#7c839a" }}>{l}</button>
          ))}
        </div>}
        {vista === "proyecto" && (
          <>
            {!fijo && <select value={tareaProyId} onChange={e => setTareaProyId(e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, flex: "1 1 240px" }}>
              <option value="">— Selecciona un proyecto —</option>
              {proyectos.map(p => <option key={p.id} value={p.id}>{(p.codigo ? p.codigo + " · " : "") + p.nombre}</option>)}
            </select>}
            {puedeTareas && tareaProyId && <Bt v="pri" sm ic="➕" onClick={() => onNueva(tareaProyId, null)}>Nueva tarea</Bt>}
            {puedeTareas && tareaProyId && <Bt v="gry" sm ic="⚡" onClick={onRapida}>Carga rápida</Bt>}
          </>
        )}
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#8E8E93", fontSize: 13 }}>Cargando...</div>}
      {!loading && vista === "proyecto" && !tareaProyId && (
        <div style={{ textAlign: "center", padding: 40, background: "#fff", borderRadius: 14, border: "1px solid #eceef3", color: "#8E8E93", fontSize: 13 }}>Selecciona un proyecto para ver y derivar sus tareas.</div>
      )}
      {!loading && vista === "proyecto" && tareaProyId && !roots.length && (
        <div style={{ textAlign: "center", padding: 40, background: "#fff", borderRadius: 14, border: "1px solid #eceef3", color: "#8E8E93", fontSize: 13 }}>Este proyecto aún no tiene tareas. Crea la primera con “Nueva tarea”.</div>
      )}
      {!loading && vista === "proyecto" && tareaProyId && roots.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
          {roots.map(t => <TareaNodo key={t.id} t={t} nivel={0} hijosDe={hijosDe} nombreDe={nombreDe} puedeTareas={puedeTareas} onNueva={onNueva} onEditar={onEditar} onAvance={onAvance} isMobile={isMobile} chkMap={chkMap} />)}
        </div>
      )}

      {!loading && vista === "mias" && (misTareas.length ? (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
          {misTareas.map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderTop: "1px solid #eceef3" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: (TESTADOS[t.estado] || {}).dot || "#8E8E93", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>{(t.es_hito ? "◆ " : "") + t.titulo}</div>
                <div style={{ fontSize: 11, color: "#AEAEB2" }}>{(t.proyecto_id ? nombreProy(t.proyecto_id) : (t.tema_id ? "🗓 Compromiso de acta" : "—")) + " · vence " + fFecha(t.fecha_vencimiento)}</div>
              </div>
              {t.fecha_vencimiento && <a href={linkCalendar({ titulo: "Tarea: " + t.titulo, fecha: t.fecha_vencimiento, detalles: "Proyecto: " + nombreProy(t.proyecto_id) + "\nGenerado desde ERP Proyectos - Outlet de Puertas SpA" })} target="_blank" rel="noreferrer" title="Agregar a Google Calendar" style={{ fontSize: 14, textDecoration: "none", flexShrink: 0 }}>📆</a>}
              {t.estado !== "completada" && <Bt v="suc" sm onClick={() => onAvance(t, "completada")}>✓ Completar</Bt>}
              <button onClick={() => onEditar(t)} title="Editar" style={{ width: 28, height: 28, borderRadius: 7, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 13, color: NAVY, flexShrink: 0 }}>✎</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: 40, background: "#fff", borderRadius: 14, border: "1px solid #eceef3", color: "#8E8E93", fontSize: 13 }}>No tienes tareas pendientes asignadas.</div>
      ))}
    </>
  )
}

/* ═══ NODO DE TAREA (recursivo) ═══ */
function TareaNodo({ t, nivel, hijosDe, nombreDe, puedeTareas, onNueva, onEditar, onAvance, isMobile, chkMap }) {
  const hijos = hijosDe(t.id)
  const es = TESTADOS[t.estado] || { l: t.estado, c: "#5F5E5A", dot: "#8E8E93" }
  const av = Math.round(t.avance_pct || 0)
  const atr = t.fecha_vencimiento && t.fecha_vencimiento < hoy() && t.estado !== "completada"
  return (
    <>
      <div className="pmo-tr" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", paddingLeft: 14 + nivel * 22, borderTop: "1px solid #eceef3" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: es.dot, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {(t.es_hito ? "◆ " : "") + t.titulo}{t.requiere_entregable ? " 📎" : ""}{chkMap && chkMap[t.id] ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: chkMap[t.id].done === chkMap[t.id].tot ? "#3B6D11" : "#854F0B", background: chkMap[t.id].done === chkMap[t.id].tot ? "#E1F5EE" : "#fdf3e6", borderRadius: 6, padding: "1px 6px" }}>✔ {chkMap[t.id].done}/{chkMap[t.id].tot}</span> : null}
          </div>
          <div style={{ fontSize: 11, color: "#AEAEB2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {nombreDe(t.responsable_id) + (t.asignado_por_id && t.asignado_por_id !== t.responsable_id ? " · por " + nombreDe(t.asignado_por_id) : "") + " · vence " + fFecha(t.fecha_vencimiento) + (atr ? " ⚠" : "")}
          </div>
        </div>
        {!isMobile && (
          <div style={{ width: 80, flexShrink: 0 }}>
            <div style={{ height: 5, borderRadius: 999, background: "#eceef3", overflow: "hidden" }}><div style={{ width: av + "%", height: "100%", background: NAVY }} /></div>
          </div>
        )}
        <span style={{ fontSize: 12, color: es.c, fontWeight: 500, minWidth: 76, textAlign: "right", flexShrink: 0 }}>{es.l}</span>
        {t.estado !== "completada" && <Bt v="suc" sm onClick={() => onAvance(t, "completada")}>✓</Bt>}
        {puedeTareas && <button onClick={() => onNueva(t.proyecto_id, t.id)} title="Agregar subtarea" style={{ width: 28, height: 28, borderRadius: 7, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 15, color: NAVY, flexShrink: 0 }}>+</button>}
        <button onClick={() => onEditar(t)} title="Editar" style={{ width: 28, height: 28, borderRadius: 7, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 13, color: NAVY, flexShrink: 0 }}>✎</button>
      </div>
      {hijos.map(h => <TareaNodo key={h.id} t={h} nivel={nivel + 1} hijosDe={hijosDe} nombreDe={nombreDe} puedeTareas={puedeTareas} onNueva={onNueva} onEditar={onEditar} onAvance={onAvance} isMobile={isMobile} chkMap={chkMap} />)}
    </>
  )
}

/* ═══ EDITOR DE ORGANIGRAMA ═══ */
function OrganigramaEditor({ usuarios, orgEdit, setOrgEdit, orgBase, orgFiltro, setOrgFiltro, orgDirty, orgSaving, onGuardar, nombreDe, isMobile }) {
  const f = orgFiltro.trim().toLowerCase()
  const lista = usuarios.filter(u => !f || (u.nombre || "").toLowerCase().includes(f) || (u.correo || "").toLowerCase().includes(f))
  return (
    <>
      <div style={{ background: "#eef1f8", border: "1px solid #dfe3ef", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#3A3A3C", lineHeight: 1.5 }}>
        <strong>Líneas de reporte.</strong> Define de quién depende cada persona. Esto controla la cascada: cada jefe solo puede derivar tareas a quienes están debajo suyo. La cúspide (Gerente General) queda en “— Nadie —”.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input value={orgFiltro} onChange={e => setOrgFiltro(e.target.value)} placeholder="Buscar persona..." style={{ ...css.input, flex: "1 1 200px", padding: "8px 12px", fontSize: 13 }} />
        <Bt v="pri" sm dis={!orgDirty || orgSaving} onClick={onGuardar}>{orgSaving ? "Guardando..." : "Guardar organigrama"}</Bt>
      </div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: isMobile ? 520 : 0 }}>
            <thead><tr style={{ background: "#f8f9fc" }}>
              <th className="pmo-th" style={{ cursor: "default" }}>Persona</th>
              <th className="pmo-th" style={{ cursor: "default" }}>Reporta a</th>
            </tr></thead>
            <tbody>
              {lista.map(u => {
                const cambiado = (orgEdit[u.id] || "") !== (orgBase[u.id] || "")
                return (
                  <tr key={u.id} className="pmo-tr">
                    <td className="pmo-td" style={{ fontSize: 13 }}>
                      {cambiado && <span style={{ color: "#BA7517", marginRight: 5 }}>●</span>}
                      <span style={{ fontWeight: 600, color: "#1C1C1E" }}>{u.nombre || u.correo}</span>
                    </td>
                    <td className="pmo-td">
                      <select value={orgEdit[u.id] || ""} onChange={e => setOrgEdit(o => ({ ...o, [u.id]: e.target.value }))} style={{ ...css.select, padding: "7px 10px", fontSize: 13, maxWidth: 320 }}>
                        <option value="">— Nadie (cúspide) —</option>
                        {usuarios.filter(x => x.id !== u.id).map(x => <option key={x.id} value={x.id}>{x.nombre || x.correo}</option>)}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}


/* ═══ PANEL DE INFORMES — medición de cumplimiento ═══ */
function InformesPanel({ tareas, proyectos, nombreDe, isMobile, fijoProy }) {
  const [fProy, setFProy] = useState("")
  const h = hoy()
  const efProy = fijoProy || fProy
  const base = efProy ? tareas.filter(t => t.proyecto_id === efProy) : tareas

  const clasif = t => {
    if (t.estado === "completada") {
      if (!t.fecha_vencimiento || (t.fecha_completada || h) <= t.fecha_vencimiento) return "atiempo"
      return "tarde"
    }
    if (t.fecha_vencimiento && t.fecha_vencimiento < h) return "vencida"
    return "abierta"
  }
  const stats = arr => {
    const st = { tot: arr.length, atiempo: 0, tarde: 0, vencida: 0, abierta: 0 }
    arr.forEach(t => st[clasif(t)]++)
    const den = st.atiempo + st.tarde + st.vencida
    st.tasa = den ? Math.round(100 * st.atiempo / den) : null
    return st
  }
  const g = stats(base)

  const porResp = {}
  base.forEach(t => { const k = t.responsable_id || "_sin"; (porResp[k] = porResp[k] || []).push(t) })
  const filasResp = Object.entries(porResp)
    .map(([k, arr]) => ({ k, n: k === "_sin" ? "— Sin asignar —" : nombreDe(k), ...stats(arr) }))
    .sort((a, b) => b.tot - a.tot)

  const porProy = {}
  base.forEach(t => { (porProy[t.proyecto_id] = porProy[t.proyecto_id] || []).push(t) })
  const filasProy = Object.entries(porProy)
    .map(([k, arr]) => {
      const p = proyectos.find(x => x.id === k) || {}
      const nn = p.nombre ? (p.codigo ? p.codigo + " · " : "") + p.nombre : "🗓 Compromisos de acta"
      return { k, n: nn, avance: p.nombre ? Math.round(p.avance_pct || 0) : 0, ...stats(arr) }
    })
    .sort((a, b) => b.tot - a.tot)

  const exportarInforme = () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasResp.map(r => ({
      "Responsable": r.n, "Tareas": r.tot, "A tiempo": r.atiempo, "Tarde": r.tarde,
      "Vencidas abiertas": r.vencida, "En plazo (abiertas)": r.abierta,
      "Tasa cumplimiento %": r.tasa === null ? "" : r.tasa
    }))), "Por responsable")
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasProy.map(r => ({
      "Proyecto": r.n, "Avance %": r.avance, "Tareas": r.tot, "A tiempo": r.atiempo,
      "Tarde": r.tarde, "Vencidas abiertas": r.vencida, "En plazo (abiertas)": r.abierta,
      "Tasa cumplimiento %": r.tasa === null ? "" : r.tasa
    }))), "Por proyecto")
    XLSX.writeFile(wb, "cumplimiento_" + h + ".xlsx")
  }

  const Tasa = ({ v }) => v === null
    ? <span style={{ fontSize: 12, color: "#AEAEB2" }}>—</span>
    : <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 999, background: "#eceef3", overflow: "hidden", minWidth: 50 }}>
          <div style={{ width: v + "%", height: "100%", background: v >= 80 ? "#639922" : v >= 50 ? "#BA7517" : "#E24B4A" }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: v >= 80 ? "#3B6D11" : v >= 50 ? "#854F0B" : "#A32D2D", minWidth: 34, textAlign: "right" }}>{v}%</span>
      </div>

  const TablaCump = ({ titulo, filas, extra }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#3A3A3C", marginBottom: 8 }}>{titulo}</div>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead><tr style={{ background: "#f8f9fc" }}>
              <th className="pmo-th" style={{ cursor: "default" }}>{extra ? "Proyecto" : "Responsable"}</th>
              {extra && <th className="pmo-th" style={{ cursor: "default" }}>Avance</th>}
              <th className="pmo-th" style={{ cursor: "default" }}>Tareas</th>
              <th className="pmo-th" style={{ cursor: "default" }}>A tiempo</th>
              <th className="pmo-th" style={{ cursor: "default" }}>Tarde</th>
              <th className="pmo-th" style={{ cursor: "default" }}>Vencidas</th>
              <th className="pmo-th" style={{ cursor: "default" }}>En plazo</th>
              <th className="pmo-th" style={{ cursor: "default", width: 140 }}>Tasa cumplimiento</th>
            </tr></thead>
            <tbody>
              {filas.map(r => (
                <tr key={r.k} className="pmo-tr">
                  <td className="pmo-td" style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>{r.n}</td>
                  {extra && <td className="pmo-td" style={{ fontSize: 12, color: "#3A3A3C" }}>{r.avance}%</td>}
                  <td className="pmo-td" style={{ fontSize: 12 }}>{r.tot}</td>
                  <td className="pmo-td" style={{ fontSize: 12, color: "#3B6D11", fontWeight: 600 }}>{r.atiempo}</td>
                  <td className="pmo-td" style={{ fontSize: 12, color: "#854F0B" }}>{r.tarde}</td>
                  <td className="pmo-td" style={{ fontSize: 12, color: r.vencida ? "#A32D2D" : "#AEAEB2", fontWeight: r.vencida ? 700 : 400 }}>{r.vencida}</td>
                  <td className="pmo-td" style={{ fontSize: 12, color: "#8E8E93" }}>{r.abierta}</td>
                  <td className="pmo-td"><Tasa v={r.tasa} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {!fijoProy && <select value={fProy} onChange={e => setFProy(e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, flex: "1 1 240px", maxWidth: 420 }}>
          <option value="">Todos los proyectos</option>
          {proyectos.map(p => <option key={p.id} value={p.id}>{(p.codigo ? p.codigo + " · " : "") + p.nombre}</option>)}
        </select>}
        <Bt v="gry" sm ic="📥" onClick={exportarInforme} dis={!base.length}>Excel</Bt>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(5,1fr)", gap: 10, marginBottom: 8 }}>
        <KpiCard l="Tareas totales" v={g.tot} sub="en el alcance filtrado" c={NAVY} />
        <KpiCard l="A tiempo" v={g.atiempo} sub="completadas en plazo" c="#3B6D11" />
        <KpiCard l="Tarde" v={g.tarde} sub="completadas fuera de plazo" c="#854F0B" />
        <KpiCard l="Vencidas abiertas" v={g.vencida} sub="requieren acción" c="#A32D2D" />
        <KpiCard l="Tasa cumplimiento" v={g.tasa === null ? "—" : g.tasa + "%"} sub="a tiempo / ya exigible" c={g.tasa === null ? "#8E8E93" : g.tasa >= 80 ? "#3B6D11" : g.tasa >= 50 ? "#854F0B" : "#A32D2D"} />
      </div>
      <div style={{ fontSize: 11, color: "#AEAEB2", marginBottom: 16 }}>
        Tasa de cumplimiento = tareas completadas a tiempo ÷ todo lo que ya debía estar resuelto (a tiempo + tarde + vencidas abiertas). Las tareas en plazo aún no exigibles no castigan la tasa.
      </div>

      <TablaCump titulo="Cumplimiento por responsable" filas={filasResp} />
      {!fijoProy && <TablaCump titulo="Cumplimiento por proyecto" filas={filasProy} extra />}
    </>
  )
}


/* ═══ CARTA GANTT ═══ */
function GanttPanel({ proyectos, tareas, ganttProyId, setGanttProyId, isMobile, onEditarTarea, onEditarProyecto, nombreDe, fijo }) {
  const dISO = x => new Date(String(x).slice(0, 10) + "T00:00:00")
  const dif = (a, b) => Math.round((dISO(b) - dISO(a)) / 86400000)

  // Filas: portafolio (proyectos) o detalle (tareas del proyecto, en orden de árbol)
  let filas = []
  if (!ganttProyId) {
    filas = proyectos.filter(p => p.estado !== "cancelado").map(p => ({
      id: p.id, nivel: 0, label: (p.codigo ? p.codigo + " · " : "") + p.nombre,
      resp: nombreDe ? nombreDe(p.responsable_id) : "", por: null,
      ini: p.fecha_inicio || p.fecha_fin_obj, fin: p.fecha_fin_obj || p.fecha_inicio,
      av: Math.round(p.avance_pct || 0), hito: false,
      done: p.estado === "completado", atr: atrasado(p), obj: p, esProy: true
    }))
  } else {
    const tp = tareas.filter(t => t.proyecto_id === ganttProyId)
    const hijosDe = pid => tp.filter(t => t.tarea_padre_id === pid)
    const walk = (lista, nivel) => lista.forEach(t => {
      filas.push({
        id: t.id, nivel, label: (t.es_hito ? "◆ " : "") + t.titulo,
        resp: nombreDe ? nombreDe(t.responsable_id) : "",
        por: t.asignado_por_id && t.asignado_por_id !== t.responsable_id && nombreDe ? nombreDe(t.asignado_por_id) : null,
        ini: t.fecha_inicio || t.fecha_vencimiento, fin: t.fecha_vencimiento || t.fecha_inicio,
        av: Math.round(t.avance_pct || 0), hito: !!t.es_hito,
        done: t.estado === "completada",
        atr: t.fecha_vencimiento && t.fecha_vencimiento < hoy() && t.estado !== "completada",
        obj: t, esProy: false
      })
      walk(hijosDe(t.id), nivel + 1)
    })
    walk(tp.filter(t => !t.tarea_padre_id), 0)
  }

  const conFecha = filas.filter(f => f.ini && f.fin)
  const sinFecha = filas.filter(f => !f.ini && !f.fin)

  let cuerpo = null
  if (!conFecha.length) {
    cuerpo = <div style={{ textAlign: "center", padding: 40, background: "#fff", borderRadius: 14, border: "1px solid #eceef3", color: "#8E8E93", fontSize: 13 }}>
      {ganttProyId ? "Este proyecto no tiene tareas con fechas. Asigna fechas de inicio y vencimiento para verlas en la Gantt." : "No hay proyectos con fechas definidas."}
    </div>
  } else {
    let minS = conFecha[0].ini, maxS = conFecha[0].fin
    conFecha.forEach(f => { if (f.ini < minS) minS = f.ini; if (f.fin > maxS) maxS = f.fin })
    const min = dISO(minS); min.setDate(min.getDate() - 3)
    const max = dISO(maxS); max.setDate(max.getDate() + 3)
    const total = Math.max(dif(min.toISOString(), max.toISOString()), 1)
    const pos = d => Math.min(Math.max(dif(min.toISOString(), d) / total * 100, 0), 100)

    const meses = []
    let c = new Date(min.getFullYear(), min.getMonth(), 1)
    while (c <= max) {
      const finMes = new Date(c.getFullYear(), c.getMonth() + 1, 0)
      const a = c < min ? min : c, b = finMes > max ? max : finMes
      meses.push({ l: c.toLocaleDateString("es-CL", { month: "short" }) + " " + String(c.getFullYear()).slice(2), w: (dif(a.toISOString(), b.toISOString()) + 1) / total * 100 })
      c = new Date(c.getFullYear(), c.getMonth() + 1, 1)
    }
    const h = hoy()
    const hoyPct = (h >= min.toISOString().slice(0, 10) && h <= max.toISOString().slice(0, 10)) ? pos(h) : null
    const wLbl = isMobile ? 130 : 210

    cuerpo = (
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: isMobile ? 680 : 0 }}>
            {/* Header de meses */}
            <div style={{ display: "flex", borderBottom: "1px solid #eceef3", background: "#f8f9fc" }}>
              <div style={{ width: wLbl, flexShrink: 0, padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#8E8E93", textTransform: "uppercase" }}>{ganttProyId ? "Tarea" : "Proyecto"}</div>
              <div style={{ flex: 1, display: "flex" }}>
                {meses.map((m, i) => <div key={i} style={{ width: m.w + "%", padding: "8px 6px", fontSize: 10, fontWeight: 700, color: "#8E8E93", textTransform: "uppercase", borderLeft: "1px solid #eceef3", whiteSpace: "nowrap", overflow: "hidden" }}>{m.l}</div>)}
              </div>
            </div>
            {/* Filas */}
            {conFecha.map(f => {
              const izq = pos(f.ini)
              const ancho = Math.max((dif(f.ini, f.fin) + 1) / total * 100, 1.2)
              const bg = f.done ? "#cde8cf" : f.atr ? "#F5C4B3" : "#c2d1ec"
              const fill = f.done ? "#34C759" : f.atr ? "#D85A30" : NAVY
              return (
                <div key={f.id} style={{ display: "flex", alignItems: "center", borderTop: "1px solid #f0f1f5", cursor: (f.esProy ? onEditarProyecto : onEditarTarea) ? "pointer" : "default" }}
                  onClick={() => { if (f.esProy && onEditarProyecto) onEditarProyecto(f.obj); else if (!f.esProy && onEditarTarea) onEditarTarea(f.obj) }}
                  className="pmo-tr">
                  <div style={{ width: wLbl, flexShrink: 0, padding: "5px 12px", paddingLeft: 12 + f.nivel * 16, overflow: "hidden" }} title={f.label + (f.resp && f.resp !== "—" ? " · " + f.resp : "")}>
                    <div style={{ fontSize: 12, color: "#1C1C1E", fontWeight: f.nivel === 0 ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.label}</div>
                    {f.resp && f.resp !== "—" && <div style={{ fontSize: 10, color: "#8E8E93", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>👤 {f.resp}{f.por ? " · por " + f.por : ""}</div>}
                  </div>
                  <div style={{ flex: 1, position: "relative", height: 36 }}>
                    {hoyPct !== null && <div style={{ position: "absolute", left: hoyPct + "%", top: 0, bottom: 0, width: 2, background: "#E24B4A", opacity: 0.55, zIndex: 2 }} />}
                    {f.hito ? (
                      <span title={fFecha(f.fin)} style={{ position: "absolute", left: "calc(" + pos(f.fin) + "% - 6px)", top: 12, width: 12, height: 12, background: f.done ? "#34C759" : "#BA7517", transform: "rotate(45deg)", zIndex: 1 }} />
                    ) : (
                      <div title={fFecha(f.ini) + " → " + fFecha(f.fin) + " · " + f.av + "%"} style={{ position: "absolute", left: izq + "%", width: ancho + "%", top: 11, height: 14, borderRadius: 4, background: bg, overflow: "hidden", zIndex: 1 }}>
                        <div style={{ width: f.av + "%", height: "100%", background: fill }} />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {!fijo && <select value={ganttProyId} onChange={e => setGanttProyId(e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, flex: "1 1 260px", maxWidth: 460 }}>
          <option value="">— Portafolio (todos los proyectos) —</option>
          {proyectos.filter(p => p.estado !== "cancelado").map(p => <option key={p.id} value={p.id}>{(p.codigo ? p.codigo + " · " : "") + p.nombre}</option>)}
        </select>}
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#8E8E93", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: NAVY }} /> En curso</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "#D85A30" }} /> Atrasado</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "#34C759" }} /> Completado</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, background: "#BA7517", transform: "rotate(45deg)", display: "inline-block" }} /> Hito</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 2, height: 11, background: "#E24B4A", display: "inline-block" }} /> Hoy</span>
        </div>
      </div>
      {cuerpo}
      {sinFecha.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#854F0B", background: "#fdf3e6", border: "1px solid #f3dfc0", borderRadius: 9, padding: "8px 12px" }}>
          ⚠ {sinFecha.length} {ganttProyId ? "tarea(s)" : "proyecto(s)"} sin fechas no aparecen en la carta: {sinFecha.slice(0, 4).map(f => f.label).join(", ")}{sinFecha.length > 4 ? "…" : ""}
        </div>
      )}
    </>
  )
}

/* ═══ PANEL DE ENTREGABLES ═══ */
function EntregablesPanel({ entregables, proyectos, tareas, nombreDe, nombreProy, isMobile, loading, fProy, setFProy, fEstado, setFEstado, puedeCrear, puedeSubir, puedeAprobar, onNuevo, onEntregar, onRevisar, fijoProy }) {
  const tituloTarea = id => (tareas.find(t => t.id === id) || {}).titulo || ""
  const h = hoy()
  const vencido = e => e.fecha_limite && e.fecha_limite < h && (e.estado === "pendiente" || e.estado === "rechazado")
  const scopeEnt = fijoProy ? entregables.filter(x => x.proyecto_id === fijoProy) : entregables
  const lista = scopeEnt.filter(e =>
    (fijoProy || !fProy || e.proyecto_id === fProy) &&
    (!fEstado || (fEstado === "vencido" ? vencido(e) : e.estado === fEstado))
  )
  const k = {
    pend: scopeEnt.filter(e => e.estado === "pendiente").length,
    rev: scopeEnt.filter(e => e.estado === "entregado").length,
    apr: scopeEnt.filter(e => e.estado === "aprobado").length,
    venc: scopeEnt.filter(vencido).length
  }
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        <KpiCard l="Pendientes" v={k.pend} sub="por entregar" c="#5F5E5A" />
        <KpiCard l="Por revisar" v={k.rev} sub="esperando aprobación" c="#0C447C" />
        <KpiCard l="Aprobados" v={k.apr} sub="verificados" c="#3B6D11" />
        <KpiCard l="Vencidos" v={k.venc} sub="fuera de plazo sin entregar" c="#A32D2D" />
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {!fijoProy && <select value={fProy} onChange={e => setFProy(e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, flex: "1 1 220px", maxWidth: 380 }}>
          <option value="">Todos los proyectos</option>
          {proyectos.map(p => <option key={p.id} value={p.id}>{(p.codigo ? p.codigo + " · " : "") + p.nombre}</option>)}
        </select>}
        <select value={fEstado} onChange={e => setFEstado(e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, width: "auto" }}>
          <option value="">Todos los estados</option>
          {Object.entries(EESTADOS).map(([kk, es]) => <option key={kk} value={kk}>{es.l}</option>)}
          <option value="vencido">⚠ Vencidos</option>
        </select>
        {puedeCrear && <Bt v="pri" sm ic="➕" onClick={onNuevo}>Definir entregable</Bt>}
      </div>
      {loading && <div style={{ textAlign: "center", padding: 40, color: "#8E8E93", fontSize: 13 }}>Cargando...</div>}
      {!loading && !lista.length && (
        <div style={{ textAlign: "center", padding: 40, background: "#fff", borderRadius: 14, border: "1px solid #eceef3", color: "#8E8E93", fontSize: 13 }}>
          No hay entregables en este filtro. Define el primero: qué evidencia se espera, de qué proyecto y para cuándo.
        </div>
      )}
      {!loading && lista.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead><tr style={{ background: "#f8f9fc" }}>
                <th className="pmo-th" style={{ cursor: "default" }}>Entregable</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Proyecto / Tarea</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Tipo</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Límite</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Entregado</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Estado</th>
                <th className="pmo-th" style={{ cursor: "default", width: 170 }}>Acciones</th>
              </tr></thead>
              <tbody>
                {lista.map(e => {
                  const es = EESTADOS[e.estado] || EESTADOS.pendiente
                  const vc = vencido(e)
                  return (
                    <tr key={e.id} className="pmo-tr">
                      <td className="pmo-td">
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>{e.nombre}</div>
                        {e.comentario_verificacion && <div style={{ fontSize: 11, color: e.estado === "rechazado" ? "#A32D2D" : "#AEAEB2", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.comentario_verificacion}>💬 {e.comentario_verificacion}</div>}
                      </td>
                      <td className="pmo-td" style={{ fontSize: 12, color: "#3A3A3C" }}>
                        <div style={{ whiteSpace: "nowrap", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{nombreProy(e.proyecto_id)}</div>
                        {e.tarea_id && <div style={{ fontSize: 11, color: "#AEAEB2", whiteSpace: "nowrap", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>↳ {tituloTarea(e.tarea_id)}</div>}
                      </td>
                      <td className="pmo-td" style={{ fontSize: 12, color: "#3A3A3C", whiteSpace: "nowrap" }}>{ETIPOS[e.tipo] || e.tipo}</td>
                      <td className="pmo-td" style={{ fontSize: 12, color: vc ? "#A32D2D" : "#8E8E93", fontWeight: vc ? 700 : 400, whiteSpace: "nowrap" }}>{fFecha(e.fecha_limite)}{vc && " ⚠"}</td>
                      <td className="pmo-td" style={{ fontSize: 11, color: "#8E8E93", whiteSpace: "nowrap" }}>{e.entregado_por ? nombreDe(e.entregado_por) + " · " + fFecha(e.fecha_entrega) : "—"}</td>
                      <td className="pmo-td"><Bd c={es.c} bg={es.bg}>{es.l}</Bd></td>
                      <td className="pmo-td">
                        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                          {e.archivo_url && <a href={e.archivo_url} target="_blank" rel="noreferrer" title="Ver adjunto" style={{ fontSize: 14, textDecoration: "none" }}>🔗</a>}
                          {puedeSubir && (e.estado === "pendiente" || e.estado === "rechazado") && e.tipo !== "aprobacion" && <Bt v="pri" sm onClick={() => onEntregar(e)}>Entregar</Bt>}
                          {puedeAprobar && (e.estado === "entregado" || (e.tipo === "aprobacion" && e.estado === "pendiente")) && <Bt v="amb" sm onClick={() => onRevisar(e)}>Revisar</Bt>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}


/* ═══ WORKSPACE DE PROYECTO — expediente con bitácora, tareas, gantt, entregables e informe ═══ */
function ProyectoDetalle({ p, subTab, setSubTab, onBack, tareas, entregables, chkMap, misTareas, nombreDe, nombreProy, isMobile, loading, puedeTareas, puedeSubirEnt, puedeAprobarEnt, onEditarProyecto, onNuevaTarea, onEditarTarea, onAvance, onRapida, onNuevoEnt, onEntregar, onRevisar, fEstadoEnt, setFEstadoEnt }) {
  const [bit, setBit] = useState([])
  const [bitLoad, setBitLoad] = useState(false)
  useEffect(() => {
    let cancel = false
    const load = async () => {
      setBitLoad(true)
      try {
        const { data } = await supabase.from('pmo_bitacora').select('*').eq('proyecto_id', p.id).order('created_at', { ascending: false }).limit(80)
        if (!cancel) setBit(data || [])
      } catch (e) { if (!cancel) setBit([]) } finally { if (!cancel) setBitLoad(false) }
    }
    load()
    return () => { cancel = true }
  }, [p.id, tareas, entregables])

  const tp = tareas.filter(t => t.proyecto_id === p.id)
  const ep = entregables.filter(e => e.proyecto_id === p.id)
  const ar = AREAS[p.area] || { l: p.area || "—", c: "#5F5E5A", bg: "#F2F2F7" }
  const es = ESTADOS[p.estado] || { l: p.estado || "—", c: "#5F5E5A", dot: "#8E8E93" }
  const av = Math.round(p.avance_pct || 0)
  const atr = atrasado(p)
  const h = hoy()
  const st = {
    tot: tp.length,
    comp: tp.filter(t => t.estado === "completada").length,
    venc: tp.filter(t => t.fecha_vencimiento && t.fecha_vencimiento < h && t.estado !== "completada").length,
    entPend: ep.filter(e => e.estado === "pendiente" || e.estado === "rechazado").length,
    entRev: ep.filter(e => e.estado === "entregado").length,
    entApr: ep.filter(e => e.estado === "aprobado").length
  }

  return (
    <>
      {/* Cabecera del expediente */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <button onClick={onBack} title="Volver" style={{ width: 34, height: 34, borderRadius: 9, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 15, color: NAVY, flexShrink: 0 }}>←</button>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "#8E8E93", fontFamily: "ui-monospace,Menlo,monospace" }}>{p.codigo || p.id}</span>
              <Bd c={ar.c} bg={ar.bg}>{ar.l}</Bd>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: es.dot }} />
                <span style={{ fontSize: 12, color: es.c, fontWeight: 600 }}>{es.l}</span>
              </span>
              {atr && <span style={{ fontSize: 11, color: "#A32D2D", fontWeight: 700 }}>⚠ Atrasado</span>}
            </div>
            <div style={{ fontSize: isMobile ? 16 : 19, fontWeight: 700, color: "#1C1C1E", letterSpacing: "-0.01em", margin: "3px 0 4px" }}>{p.nombre}</div>
            <div style={{ fontSize: 12, color: "#8E8E93", display: "flex", gap: 14, flexWrap: "wrap" }}>
              <span>👤 {nombreDe(p.responsable_id)}</span>
              {p.patrocinador_id && <span>🏛 Patrocina: {nombreDe(p.patrocinador_id)}</span>}
              <span>📅 {fFecha(p.fecha_inicio)} → {fFecha(p.fecha_fin_obj)}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ width: 120 }}>
              <div style={{ fontSize: 10, color: "#8E8E93", marginBottom: 3, textAlign: "right" }}>Avance {av}%</div>
              <div style={{ height: 7, borderRadius: 999, background: "#eceef3", overflow: "hidden" }}>
                <div style={{ width: av + "%", height: "100%", background: NAVY }} />
              </div>
            </div>
            {onEditarProyecto && <button onClick={() => onEditarProyecto(p)} title="Editar proyecto" style={{ width: 32, height: 32, borderRadius: 8, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 14, color: NAVY }}>✎</button>}
          </div>
        </div>
      </div>

      {/* Sub-navegación del expediente */}
      <div style={{ display: "flex", gap: 3, marginBottom: 14, background: "#e6e8f2", borderRadius: 10, padding: 3, overflowX: "auto" }}>
        {SUBTABS.map(t => (
          <button key={t.k} onClick={() => setSubTab(t.k)} style={{
            flex: isMobile ? "0 0 auto" : 1, padding: "8px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            border: "none", cursor: "pointer", whiteSpace: "nowrap",
            background: subTab === t.k ? "#fff" : "transparent",
            color: subTab === t.k ? NAVY : "#7c839a",
            boxShadow: subTab === t.k ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6
          }}><span>{t.ic}</span><span>{t.l}</span></button>
        ))}
      </div>

      {/* RESUMEN: ficha + bitácora del expediente */}
      {subTab === "resumen" && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <div>
            {(p.objetivo || p.descripcion) && (
              <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", padding: "13px 15px", marginBottom: 12 }}>
                {p.objetivo && <><div style={{ fontSize: 11, fontWeight: 700, color: "#8E8E93", textTransform: "uppercase", marginBottom: 4 }}>Objetivo</div>
                <div style={{ fontSize: 13, color: "#1C1C1E", lineHeight: 1.5, marginBottom: p.descripcion ? 12 : 0 }}>{p.objetivo}</div></>}
                {p.descripcion && <><div style={{ fontSize: 11, fontWeight: 700, color: "#8E8E93", textTransform: "uppercase", marginBottom: 4 }}>Descripción</div>
                <div style={{ fontSize: 13, color: "#3A3A3C", lineHeight: 1.5 }}>{p.descripcion}</div></>}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 12 }}>
              <KpiCard l="Tareas" v={st.comp + "/" + st.tot} sub="completadas" c={NAVY} />
              <KpiCard l="Vencidas" v={st.venc} sub="requieren acción" c={st.venc ? "#A32D2D" : "#8E8E93"} />
              <KpiCard l="Entregables" v={st.entApr + "/" + ep.length} sub={st.entRev + " por revisar"} c={st.entRev ? "#0C447C" : "#3B6D11"} />
            </div>
          </div>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", padding: "13px 15px", maxHeight: 480, overflowY: "auto" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8E8E93", textTransform: "uppercase", marginBottom: 8 }}>Bitácora del proyecto</div>
            {bitLoad && <div style={{ fontSize: 12, color: "#8E8E93" }}>Cargando...</div>}
            {!bitLoad && !bit.length && <div style={{ fontSize: 12, color: "#AEAEB2" }}>Sin movimientos registrados aún.</div>}
            {!bitLoad && bit.map(b => (
              <div key={b.id} style={{ display: "flex", gap: 8, padding: "7px 0", borderTop: "1px solid #f0f1f5", alignItems: "flex-start" }}>
                <span style={{ fontSize: 13, lineHeight: "18px" }}>{BIT_IC[b.tipo] || "•"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#3A3A3C" }}>{b.contenido}</div>
                  <div style={{ fontSize: 10, color: "#AEAEB2", marginTop: 1 }}>{fFechaHora(b.created_at)} · {nombreDe(b.autor_id)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAREAS del proyecto */}
      {subTab === "tareas" && (
        <TareasPanel fijo isMobile={isMobile} proyectos={[]} tareasProyecto={tp} misTareas={misTareas}
          tareaVista="proyecto" setTareaVista={() => { }} tareaProyId={p.id} setTareaProyId={() => { }}
          nombreDe={nombreDe} nombreProy={nombreProy} puedeTareas={puedeTareas} loading={loading}
          onNueva={onNuevaTarea} onEditar={onEditarTarea} onAvance={onAvance} onRapida={onRapida} chkMap={chkMap} />
      )}

      {/* GANTT del proyecto (con responsables visibles) */}
      {subTab === "gantt" && (
        <GanttPanel fijo proyectos={[]} tareas={tareas} ganttProyId={p.id} setGanttProyId={() => { }}
          isMobile={isMobile} onEditarTarea={onEditarTarea} onEditarProyecto={null} nombreDe={nombreDe} />
      )}

      {/* ENTREGABLES del proyecto */}
      {subTab === "entregables" && (
        <EntregablesPanel fijoProy={p.id} entregables={entregables} proyectos={[]} tareas={tareas} nombreDe={nombreDe} nombreProy={nombreProy}
          isMobile={isMobile} loading={loading} fProy="" setFProy={() => { }} fEstado={fEstadoEnt} setFEstado={setFEstadoEnt}
          puedeCrear={puedeTareas} puedeSubir={puedeSubirEnt} puedeAprobar={puedeAprobarEnt}
          onNuevo={onNuevoEnt} onEntregar={onEntregar} onRevisar={onRevisar} />
      )}

      {/* INFORME del proyecto */}
      {subTab === "informe" && (
        <InformesPanel fijoProy={p.id} tareas={tareas} proyectos={[]} nombreDe={nombreDe} isMobile={isMobile} />
      )}
    </>
  )
}

/* ═══ PANEL DE REUNIONES — actas y seguimiento de acuerdos ═══ */
function ReunionesPanel({ reuniones, temas, tareas, nombreDe, nombreProy, isMobile, loading, puedeCrear, estadoTema, onNueva, onAbrir }) {
  const compromisos = temas.filter(t => t.responsable_id)
  const cumplidos = compromisos.filter(t => estadoTema(t) === "cumplido")
  const seguibles = compromisos.filter(t => estadoTema(t) !== "aprobada")
  const tasa = seguibles.length ? Math.round(100 * cumplidos.length / seguibles.length) : null
  const statsDe = r => {
    const ts = temas.filter(t => t.reunion_id === r.id)
    const acs = ts.filter(t => t.responsable_id)
    const cmp = acs.filter(t => estadoTema(t) === "cumplido")
    return { temas: ts.length, acuerdos: acs.length, cumplidos: cmp.length }
  }
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        <KpiCard l="Reuniones" v={reuniones.length} sub="registradas" c={NAVY} />
        <KpiCard l="Compromisos" v={compromisos.length} sub="con propietario asignado" c="#185FA5" />
        <KpiCard l="Cumplidos" v={cumplidos.length} sub="verificados" c="#3B6D11" />
        <KpiCard l="Cumplimiento" v={tasa === null ? "—" : tasa + "%"} sub="cumplidos / exigibles" c={tasa === null ? "#8E8E93" : tasa >= 80 ? "#3B6D11" : tasa >= 50 ? "#854F0B" : "#A32D2D"} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#3A3A3C" }}>Actas de reunión</span>
        {puedeCrear && <Bt v="pri" sm ic="➕" onClick={onNueva}>Nueva reunión</Bt>}
      </div>
      {loading && <div style={{ textAlign: "center", padding: 40, color: "#8E8E93", fontSize: 13 }}>Cargando...</div>}
      {!loading && !reuniones.length && (
        <div style={{ textAlign: "center", padding: 40, background: "#fff", borderRadius: 14, border: "1px solid #eceef3", color: "#8E8E93", fontSize: 13 }}>
          Aún no hay reuniones registradas. Registra la primera: acta, acuerdos y tareas derivadas en un solo paso.
        </div>
      )}
      {!loading && reuniones.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead><tr style={{ background: "#f8f9fc" }}>
                <th className="pmo-th" style={{ cursor: "default" }}>Fecha</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Reunión</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Proyecto</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Convoca</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Asist.</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Temas</th>
                <th className="pmo-th" style={{ cursor: "default", width: 150 }}>Acuerdos cumplidos</th>
              </tr></thead>
              <tbody>
                {reuniones.map(r => {
                  const st = statsDe(r)
                  const pct = st.acuerdos ? Math.round(100 * st.cumplidos / st.acuerdos) : null
                  return (
                    <tr key={r.id} className="pmo-tr" onClick={() => onAbrir(r)} style={{ cursor: "pointer" }}>
                      <td className="pmo-td" style={{ fontSize: 12, color: "#3A3A3C", whiteSpace: "nowrap" }}>{fFecha(r.fecha)}{r.hora ? " " + r.hora : ""}</td>
                      <td className="pmo-td"><div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{r.titulo}{r.tipo === "directorio" && <span style={{ fontSize: 9, fontWeight: 700, color: "#3C3489", background: "#EEEDFE", borderRadius: 6, padding: "1px 6px" }}>DIRECTORIO</span>}{r.reunion_padre_id && <span style={{ fontSize: 9, fontWeight: 700, color: "#5F5E5A", background: "#F2F2F7", borderRadius: 6, padding: "1px 6px" }}>↩ SEGUIMIENTO</span>}</div>{r.lugar && <div style={{ fontSize: 11, color: "#AEAEB2" }}>{r.lugar}</div>}</td>
                      <td className="pmo-td" style={{ fontSize: 12, color: "#3A3A3C", whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{r.proyecto_id ? nombreProy(r.proyecto_id) : "—"}</td>
                      <td className="pmo-td" style={{ fontSize: 12, color: "#3A3A3C", whiteSpace: "nowrap" }}>{nombreDe(r.convocante_id)}</td>
                      <td className="pmo-td" style={{ fontSize: 12 }}>{Array.isArray(r.asistentes) ? r.asistentes.length : 0}</td>
                      <td className="pmo-td" style={{ fontSize: 12 }}>{st.temas}</td>
                      <td className="pmo-td">
                        {pct === null ? <span style={{ fontSize: 12, color: "#AEAEB2" }}>sin acuerdos</span> : (
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <div style={{ flex: 1, height: 6, borderRadius: 999, background: "#eceef3", overflow: "hidden", minWidth: 50 }}>
                              <div style={{ width: pct + "%", height: "100%", background: pct >= 80 ? "#639922" : pct >= 50 ? "#BA7517" : "#E24B4A" }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 600, color: "#3A3A3C", whiteSpace: "nowrap" }}>{st.cumplidos}/{st.acuerdos}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}


/* ═══ PANEL DE COMPROMISOS — seguimiento transversal del acta (Tema/Decisión/Propietario/Estado) ═══ */
function CompromisosPanel({ temas, reuniones, tareas, usuarios, nombreDe, nombreProy, isMobile, estadoTema, vencidoTema, onMarcar, onAbrirTarea, onAbrirActa, avMap, diasDesde, onSeguimiento }) {
  const [fResp, setFResp] = useState("")
  const [fEst, setFEst] = useState("")
  const [fTipo, setFTipo] = useState("")
  const reuDe = id => reuniones.find(r => r.id === id) || {}
  const todos = temas.filter(t => t.responsable_id)
  const lista = todos.filter(t => {
    const r = reuDe(t.reunion_id)
    const est = estadoTema(t)
    return (!fResp || t.responsable_id === fResp || (Array.isArray(t.corresponsables) && t.corresponsables.includes(fResp))) &&
      (!fTipo || (r.tipo || "operativa") === fTipo) &&
      (!fEst || (fEst === "vencido" ? vencidoTema(t) : est === fEst))
  }).sort((a, b) => String(a.fecha_compromiso || "9999").localeCompare(String(b.fecha_compromiso || "9999")))
  const abiertoDe = t => {
    const r = reuDe(t.reunion_id)
    const creado = String(t.created_at || "").slice(0, 10) || r.fecha
    const base = r.fecha && r.fecha < creado ? r.fecha : creado
    return diasDesde(base) ?? 0
  }
  const quietoDe = t => {
    const est = estadoTema(t)
    if (est === "cumplido" || est === "aprobada") return false
    const a = avMap[t.id]
    const d = a?.ult ? diasDesde(a.ult) : abiertoDe(t)
    return d !== null && d >= 14
  }
  const k = {
    tot: todos.length,
    cum: todos.filter(t => estadoTema(t) === "cumplido").length,
    cur: todos.filter(t => estadoTema(t) === "en_curso").length,
    ven: todos.filter(vencidoTema).length,
    qui: todos.filter(quietoDe).length
  }
  const seguibles = todos.filter(t => estadoTema(t) !== "aprobada").length
  const tasa = seguibles ? Math.round(100 * k.cum / seguibles) : null

  const exportar = () => {
    const filas = lista.map(t => {
      const r = reuDe(t.reunion_id)
      return {
        "Reunión": r.titulo || "", "Fecha reunión": r.fecha || "", "Tipo": RTIPOS[r.tipo] || "Operativa",
        "Tema": t.tema || "", "Decisión/Acuerdo": t.acuerdo || "",
        "Propietario": nombreDe(t.responsable_id),
        "Corresponsables": (Array.isArray(t.corresponsables) ? t.corresponsables : []).map(nombreDe).join(", "),
        "Proyecto": t.proyecto_id ? nombreProy(t.proyecto_id) : "",
        "Plazo": t.fecha_compromiso || "", "Estado": (TEMA_ESTADOS[estadoTema(t)] || {}).l || "",
        "Vencido": vencidoTema(t) ? "SÍ" : ""
      }
    })
    const ws = XLSX.utils.json_to_sheet(filas)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Compromisos")
    XLSX.writeFile(wb, "compromisos_" + hoy() + ".xlsx")
  }

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(6,1fr)", gap: 10, marginBottom: 14 }}>
        <KpiCard l="Compromisos" v={k.tot} sub="con propietario" c={NAVY} />
        <KpiCard l="Cumplidos" v={k.cum} sub="verificados" c="#3B6D11" />
        <KpiCard l="En curso" v={k.cur} sub="en ejecución" c="#639922" />
        <KpiCard l="Vencidos" v={k.ven} sub="fuera de plazo" c="#A32D2D" />
        <KpiCard l="Sin movimiento" v={k.qui} sub="+14 d sin registro" c={k.qui ? "#854F0B" : "#8E8E93"} />
        <KpiCard l="Cumplimiento" v={tasa === null ? "—" : tasa + "%"} sub="cumplidos / exigibles" c={tasa === null ? "#8E8E93" : tasa >= 80 ? "#3B6D11" : tasa >= 50 ? "#854F0B" : "#A32D2D"} />
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select value={fResp} onChange={e => setFResp(e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, width: "auto" }}>
          <option value="">Todos los propietarios</option>
          {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre || u.correo}</option>)}
        </select>
        <select value={fEst} onChange={e => setFEst(e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, width: "auto" }}>
          <option value="">Todos los estados</option>
          {Object.entries(TEMA_ESTADOS).map(([kk, x]) => <option key={kk} value={kk}>{x.l}</option>)}
          <option value="vencido">⚠ Vencidos</option>
        </select>
        <select value={fTipo} onChange={e => setFTipo(e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, width: "auto" }}>
          <option value="">Todas las reuniones</option>
          {Object.entries(RTIPOS).map(([kk, l]) => <option key={kk} value={kk}>{l}</option>)}
        </select>
        <Bt v="gry" sm ic="📥" onClick={exportar} dis={!lista.length}>Excel</Bt>
        <span style={{ fontSize: 12, color: "#8E8E93" }}>{lista.length} compromiso(s)</span>
      </div>
      {!lista.length ? (
        <div style={{ textAlign: "center", padding: 40, background: "#fff", borderRadius: 14, border: "1px solid #eceef3", color: "#8E8E93", fontSize: 13 }}>
          No hay compromisos en este filtro.
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1020 }}>
              <thead><tr style={{ background: "#f8f9fc" }}>
                <th className="pmo-th" style={{ cursor: "default" }}>Tema</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Decisión / acuerdo</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Propietario(s)</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Reunión</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Plazo</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Abierto</th>
                <th className="pmo-th" style={{ cursor: "default" }}>Últ. avance</th>
                <th className="pmo-th" style={{ cursor: "default", width: 200 }}>Estado / gestión</th>
              </tr></thead>
              <tbody>
                {lista.map(t => {
                  const r = reuDe(t.reunion_id)
                  const est = estadoTema(t)
                  const ec = TEMA_ESTADOS[est] || TEMA_ESTADOS.no_iniciado
                  const corr = Array.isArray(t.corresponsables) ? t.corresponsables : []
                  const vc = vencidoTema(t)
                  const tk = t.tarea_id ? tareas.find(x => x.id === t.tarea_id) : null
                  const cerrado = est === "cumplido" || est === "aprobada"
                  const abierto = abiertoDe(t)
                  const av = avMap[t.id]
                  const ultD = av?.ult ? diasDesde(av.ult) : null
                  const quieto = quietoDe(t)
                  const agingC = cerrado ? "#AEAEB2" : abierto >= 30 ? "#A32D2D" : abierto >= 15 ? "#854F0B" : "#8E8E93"
                  return (
                    <tr key={t.id} className="pmo-tr">
                      <td className="pmo-td" style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E", maxWidth: 200 }}>{t.tema || "—"}{t.proyecto_id && <div style={{ fontSize: 10, color: "#AEAEB2", fontWeight: 400 }}>📋 {nombreProy(t.proyecto_id)}</div>}</td>
                      <td className="pmo-td" style={{ fontSize: 12, color: "#3A3A3C", maxWidth: 280 }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }} title={t.acuerdo || ""}>{t.acuerdo || "—"}</div></td>
                      <td className="pmo-td" style={{ fontSize: 12, color: "#3A3A3C" }}>{nombreDe(t.responsable_id)}{corr.length > 0 && <div style={{ fontSize: 10, color: "#AEAEB2" }}>+ {corr.map(nombreDe).join(", ")}</div>}</td>
                      <td className="pmo-td" style={{ fontSize: 11, color: "#8E8E93" }}>
                        <button onClick={() => onAbrirActa(r)} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, fontSize: 11, color: "#185FA5", textAlign: "left", fontWeight: 600 }}>{r.titulo || "—"}</button>
                        <div>{fFecha(r.fecha)}{r.tipo === "directorio" ? " · Directorio" : ""}</div>
                      </td>
                      <td className="pmo-td" style={{ fontSize: 12, color: vc ? "#A32D2D" : "#8E8E93", fontWeight: vc ? 700 : 400, whiteSpace: "nowrap" }}>{fFecha(t.fecha_compromiso)}{vc && " ⚠"}</td>
                      <td className="pmo-td" style={{ fontSize: 12, color: agingC, fontWeight: !cerrado && abierto >= 15 ? 700 : 400, whiteSpace: "nowrap" }}>⏱ {abierto} d</td>
                      <td className="pmo-td" style={{ fontSize: 11.5, color: quieto ? "#854F0B" : "#8E8E93", fontWeight: quieto ? 700 : 400, whiteSpace: "nowrap" }}>{av?.n ? ((ultD === 0 ? "hoy" : "hace " + ultD + " d") + " · " + av.n + " reg.") : "—"}{quieto ? " 🔕" : ""}</td>
                      <td className="pmo-td">
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {tk
                            ? <><span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: ec.dot }} /><span style={{ fontSize: 12, color: ec.c, fontWeight: 600, whiteSpace: "nowrap" }}>{ec.l}</span></span>
                              <button onClick={() => onAbrirTarea(tk)} title="Abrir tarea" style={{ border: "none", background: "#f4f5f9", borderRadius: 6, padding: "2px 7px", fontSize: 11, color: NAVY, cursor: "pointer", fontWeight: 600 }}>↗</button></>
                            : <select value={t.estado || "no_iniciado"} onChange={e => onMarcar(t, e.target.value)} style={{ ...css.select, padding: "3px 8px", fontSize: 11, width: "auto" }}>
                                {Object.entries(TEMA_ESTADOS).map(([kk, x]) => <option key={kk} value={kk}>{x.l}</option>)}
                              </select>}
                          <button onClick={() => onSeguimiento(t)} title="Registrar avance" style={{ border: "none", background: "#f4f5f9", borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: "pointer" }}>💬</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}


/* ═══ SHEET A PANTALLA COMPLETA (para el acta) ═══ */
function FullSheet({ show, onClose, title, children }) {
  if (!show) return null
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,20,40,0.45)", zIndex: 200, display: "flex", alignItems: "stretch", justifyContent: "center", padding: 14 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 1500, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.28)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 22px", borderBottom: "1px solid #eceef3", background: "#f8f9fc", flexShrink: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#1C1C1E" }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 9, border: "none", background: "#eceef3", cursor: "pointer", fontSize: 14, color: "#3A3A3C" }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: "18px 22px" }}>
          <div style={{ maxWidth: 1400, margin: "0 auto" }}>{children}</div>
        </div>
      </div>
    </div>
  )
}

/* ═══ BITÁCORA DE GESTIÓN DE UN COMPROMISO ═══ */
function SeguimientoTema({ avances, nombreDe, valor, setValor, onAgregar, busy }) {
  return (
    <div style={{ marginTop: 10, borderTop: "1px dashed #dfe3ef", paddingTop: 10 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input value={valor} onChange={e => setValor(e.target.value)} onKeyDown={e => { if (e.key === "Enter") onAgregar() }} placeholder="Registrar avance, gestión o novedad de este compromiso..." style={{ ...css.input, padding: "8px 12px", fontSize: 13 }} autoFocus />
        <Bt v="pri" sm dis={!valor.trim() || busy} onClick={onAgregar}>{busy ? "..." : "Registrar"}</Bt>
      </div>
      {!avances.length && <div style={{ fontSize: 12, color: "#AEAEB2" }}>Sin avances registrados. El primer registro pasa el compromiso a "En curso" automáticamente.</div>}
      {avances.map(a => (
        <div key={a.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderTop: "1px solid #f0f1f5" }}>
          <span style={{ fontSize: 12, lineHeight: "18px" }}>📝</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, color: "#3A3A3C" }}>{a.contenido}</div>
            <div style={{ fontSize: 10, color: "#AEAEB2", marginTop: 1 }}>{fFechaHora(a.created_at)} · {nombreDe(a.autor_id)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}


/* ═══ PLAN DE ACCIÓN DE UN COMPROMISO — tareas y subtareas con check ═══ */
function PlanAccionTema({ tema, lista, nombreDe, usuariosDerivables, cuId, planAdd, setPlanAdd, busy, chkMap, onCrear, onCompletar, onAbrir, planListo, onCumplir }) {
  const roots = lista.filter(t => !t.tarea_padre_id || !lista.some(x => x.id === t.tarea_padre_id))
  const hijosDe = pid => lista.filter(t => t.tarea_padre_id === pid)
  const padreSel = planAdd.padreId ? lista.find(x => x.id === planAdd.padreId) : null
  const h = hoy()
  const Fila = ({ t, nivel }) => {
    const done = t.estado === "completada"
    const atr = t.fecha_vencimiento && t.fecha_vencimiento < h && !done
    const chk = chkMap && chkMap[t.id]
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", paddingLeft: nivel * 22, borderTop: "1px solid #eef1f5" }}>
          <button onClick={() => !done && onCompletar(t)} disabled={done || busy} title={done ? "Completada" : "Marcar completada"}
            style={{ width: 20, height: 20, borderRadius: 6, border: done ? "none" : "2px solid #c3c9d9", background: done ? "#34C759" : "#fff", color: "#fff", cursor: done ? "default" : "pointer", fontSize: 12, lineHeight: "16px", flexShrink: 0, fontWeight: 800 }}>{done ? "✓" : ""}</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, color: done ? "#AEAEB2" : "#1C1C1E", fontWeight: 600, textDecoration: done ? "line-through" : "none" }}>{t.titulo}</span>
            {chk && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: chk.done === chk.tot ? "#3B6D11" : "#854F0B" }}>✔ {chk.done}/{chk.tot}</span>}
            <div style={{ fontSize: 10.5, color: atr ? "#A32D2D" : "#AEAEB2", fontWeight: atr ? 700 : 400 }}>
              👤 {nombreDe(t.responsable_id)}{t.fecha_vencimiento ? " · 📅 " + fFecha(t.fecha_vencimiento) + (atr ? " ⚠ vencida" : "") : ""}{done && t.fecha_completada ? " · ✓ " + fFecha(t.fecha_completada) : ""}
            </div>
          </div>
          <button onClick={() => setPlanAdd({ padreId: t.id, titulo: "", resp: "", fecha: "" })} title="Agregar subtarea" style={{ width: 24, height: 24, borderRadius: 6, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 13, color: "#1F6E54", flexShrink: 0, fontWeight: 800 }}>+</button>
          <button onClick={() => onAbrir(t)} title="Abrir detalle (checklist, evidencia, historial)" style={{ width: 24, height: 24, borderRadius: 6, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 11, color: NAVY, flexShrink: 0 }}>✎</button>
        </div>
        {hijosDe(t.id).map(hh => <Fila key={hh.id} t={hh} nivel={nivel + 1} />)}
      </>
    )
  }
  return (
    <div style={{ marginTop: 10, borderTop: "1px dashed #dfe3ef", paddingTop: 10 }}>
      {planListo && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#E1F5EE", border: "1px solid #bfe3d2", borderRadius: 10, padding: "8px 12px", marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "#085041", fontWeight: 700 }}>✔ Plan de acción completado — todas las tareas están cerradas.</span>
          <Bt v="suc" sm onClick={onCumplir}>Marcar compromiso como Cumplido</Bt>
        </div>
      )}
      {!lista.length && <div style={{ fontSize: 12, color: "#AEAEB2", marginBottom: 6 }}>Sin tareas aún. Baja el compromiso a acciones concretas: cada tarea admite responsable, fecha, subtareas y checklist con evidencia (ábrela con ✎).</div>}
      {roots.map(t => <Fila key={t.id} t={t} nivel={0} />)}
      <div style={{ marginTop: 8, background: "#f8f9fc", border: "1px solid #eceef3", borderRadius: 10, padding: "8px 10px" }}>
        {padreSel && (
          <div style={{ fontSize: 11, color: "#1F6E54", fontWeight: 700, marginBottom: 6 }}>
            ↳ Subtarea de: {padreSel.titulo}
            <button onClick={() => setPlanAdd(p => ({ ...p, padreId: null }))} style={{ marginLeft: 8, border: "none", background: "none", color: "#A32D2D", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>✕ quitar</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input value={planAdd.titulo} onChange={e => setPlanAdd(p => ({ ...p, titulo: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") onCrear() }} placeholder={padreSel ? "Nueva subtarea..." : "Nueva tarea del compromiso..."} style={{ ...css.input, padding: "8px 12px", fontSize: 13, flex: "2 1 220px" }} />
          <select value={planAdd.resp} onChange={e => setPlanAdd(p => ({ ...p, resp: e.target.value }))} style={{ ...css.select, padding: "8px 10px", fontSize: 12.5, flex: "1 1 150px" }}>
            <option value="">— Responsable —</option>
            {usuariosDerivables.map(u => <option key={u.id} value={u.id}>{(u.nombre || u.correo) + (u.id === cuId ? " (yo)" : "")}</option>)}
          </select>
          <input type="date" value={planAdd.fecha} onChange={e => setPlanAdd(p => ({ ...p, fecha: e.target.value }))} style={{ ...css.input, padding: "8px 10px", fontSize: 12.5, flex: "0 1 150px" }} />
          <Bt v="pri" sm dis={!planAdd.titulo.trim() || busy} onClick={onCrear}>{busy ? "..." : "＋ Agregar"}</Bt>
        </div>
      </div>
    </div>
  )
}
