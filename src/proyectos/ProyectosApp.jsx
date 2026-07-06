import { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase, signOut } from '../supabase'
import { canSync, preloadCaps } from '../core/permisos'
import { css, Bd, Bt, Fl, Sheet } from '../components/UI'
import { uid, hoy } from '../lib/constants'

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
  { k: "tareas",      l: "Tareas",      ic: "✅" },
  { k: "gantt",       l: "Carta Gantt", ic: "📅" },
  { k: "entregables", l: "Entregables", ic: "📎" },
  { k: "informes",    l: "Informes",    ic: "📈" },
  { k: "organigrama", l: "Organigrama", ic: "🏛", admin: true }
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

/* ═══ COMPONENTE RAÍZ ═══ */
export function ProyectosApp({ cu, setAppActual }) {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem("pmo_tab") || "panel" } catch (e) { return "panel" }
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
  const [tareaCtx, setTareaCtx] = useState({ proyecto_id: "", tarea_padre_id: null })
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

  /* ── Carga de datos ── */
  const cargar = async () => {
    setLoading(true)
    try {
      const [rp, ru, rt, re] = await Promise.all([
        supabase.from('pmo_proyectos').select('*').order('created_at', { ascending: false }).limit(2000),
        supabase.from('usuarios').select('id,nombre,correo,reporta_a').order('nombre'),
        supabase.from('pmo_tareas').select('*').order('orden').order('created_at', { ascending: true }).limit(5000),
        supabase.from('pmo_entregables').select('*').order('created_at', { ascending: false }).limit(3000)
      ])
      if (rp.error) throw rp.error
      setProyectos(rp.data || [])
      setUsuarios(ru.data || [])
      setTareas(rt.data || [])
      setEntregables(re.data || [])
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

  const kpis = useMemo(() => ({
    activos: proyectos.filter(p => ["aprobado", "en_curso"].includes(p.estado)).length,
    riesgo: proyectos.filter(p => p.estado === "en_riesgo").length,
    atrasados: proyectos.filter(atrasado).length,
    completados: proyectos.filter(p => p.estado === "completado").length
  }), [proyectos])

  const porArea = useMemo(() => {
    const vivos = proyectos.filter(p => !["completado", "cancelado"].includes(p.estado))
    return Object.keys(AREAS).map(k => ({ k, n: vivos.filter(p => p.area === k).length })).filter(a => a.n > 0)
  }, [proyectos])

  const filtrados = useMemo(() => {
    const t = fTexto.trim().toLowerCase()
    const base = proyectos.filter(p =>
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
  }, [proyectos, fArea, fEstado, fTexto, sortKey, sortDir, nombreDe])

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

  const logTarea = async (proyId, tareaId, tipo, contenido) => {
    try { await supabase.from('pmo_bitacora').insert({ proyecto_id: proyId, tarea_id: tareaId, tipo, contenido, autor_id: cu.id }) } catch (e) { }
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
      await syncAvanceProyecto(t.proyecto_id)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) }
  }
  const abrirNuevaTarea = (proyId, padreId = null) => {
    setEditandoTarea(null)
    setTareaCtx({ proyecto_id: proyId, tarea_padre_id: padreId })
    setTareaForm({ ...TAREA_FORM_VACIO, responsable_id: cu.id })
    setTareaBitacora([]); setComentario("")
    setShowTarea(true)
  }
  const abrirEditarTarea = t => {
    setEditandoTarea(t)
    setTareaCtx({ proyecto_id: t.proyecto_id, tarea_padre_id: t.tarea_padre_id })
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
        row.id = idTarea; row.proyecto_id = proyId; row.tarea_padre_id = tareaCtx.tarea_padre_id
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
      setMsg({ t: "ok", x: rows.length + " tareas creadas" })
      setShowRapida(false); setRapidaText("")
      await syncAvanceProyecto(tareaProyId)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setRapidaSaving(false) }
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
      <div style={{ display: "flex", gap: 3, marginBottom: 14, background: "#e6e8f2", borderRadius: 10, padding: 3, overflowX: "auto" }}>
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
      </div>

      {/* ═══ PANEL ═══ */}
      {tab === "panel" && (
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#3A3A3C" }}>Últimos proyectos</span>
            <span style={{ fontSize: 12, color: "#8E8E93" }}>{proyectos.length} en total</span>
          </div>
          <TablaProyectos rows={proyectos.slice(0, 8)} loading={loading} nombreDe={nombreDe} onEditar={puedeEditar ? abrirEditar : null} isMobile={isMobile} />
        </>
      )}

      {/* ═══ PROYECTOS ═══ */}
      {tab === "proyectos" && (
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
          <TablaProyectos rows={filtrados} loading={loading} nombreDe={nombreDe} onEditar={puedeEditar ? abrirEditar : null} isMobile={isMobile} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
        </>
      )}

      {/* ═══ TAREAS ═══ */}
      {tab === "tareas" && (
        <TareasPanel
          isMobile={isMobile} proyectos={proyectos} tareasProyecto={tareasProyecto} misTareas={misTareas}
          tareaVista={tareaVista} setTareaVista={setTareaVista} tareaProyId={tareaProyId} setTareaProyId={setTareaProyId}
          nombreDe={nombreDe} nombreProy={nombreProy} puedeTareas={puedeTareas} loading={loading}
          onNueva={abrirNuevaTarea} onEditar={abrirEditarTarea} onAvance={avanceRapido} onRapida={() => setShowRapida(true)}
        />
      )}

      {/* ═══ ORGANIGRAMA ═══ */}
      {tab === "organigrama" && esAdmin && (
        <OrganigramaEditor
          usuarios={usuarios} orgEdit={orgEdit} setOrgEdit={setOrgEdit} orgBase={orgBase}
          orgFiltro={orgFiltro} setOrgFiltro={setOrgFiltro} orgDirty={orgDirty} orgSaving={orgSaving}
          onGuardar={guardarOrganigrama} nombreDe={nombreDe} isMobile={isMobile}
        />
      )}

      {/* ═══ INFORMES ═══ */}
      {tab === "informes" && (
        <InformesPanel tareas={tareas} proyectos={proyectos} nombreDe={nombreDe} isMobile={isMobile} />
      )}

      {/* ═══ CARTA GANTT ═══ */}
      {tab === "gantt" && (
        <GanttPanel proyectos={proyectos} tareas={tareas} ganttProyId={ganttProyId} setGanttProyId={setGanttProyId}
          isMobile={isMobile} onEditarTarea={abrirEditarTarea} onEditarProyecto={puedeEditar ? abrirEditar : null} />
      )}

      {/* ═══ ENTREGABLES ═══ */}
      {tab === "entregables" && (
        <EntregablesPanel entregables={entregables} proyectos={proyectos} tareas={tareas} nombreDe={nombreDe} nombreProy={nombreProy}
          isMobile={isMobile} loading={loading} fProy={entProyFiltro} setFProy={setEntProyFiltro} fEstado={entEstadoFiltro} setFEstado={setEntEstadoFiltro}
          puedeCrear={puedeTareas} puedeSubir={puedeSubirEnt} puedeAprobar={puedeAprobarEnt}
          onNuevo={abrirNuevoEnt} onEntregar={abrirEntrega} onRevisar={abrirRevision} />
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
          <Fl l={"Avance: " + tareaForm.avance_pct + "%"}>
            <input type="range" min="0" max="100" step="5" value={tareaForm.avance_pct} disabled={tareaForm.estado === "completada"} onChange={e => setTareaForm(f => ({ ...f, avance_pct: e.target.value }))} style={{ width: "100%" }} />
          </Fl>
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
              {proyectos.map(p => <option key={p.id} value={p.id}>{(p.codigo ? p.codigo + " · " : "") + p.nombre}</option>)}
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

function TablaProyectos({ rows, loading, nombreDe, onEditar, isMobile, sortKey, sortDir, onSort }) {
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
                <tr key={p.id} className="pmo-tr">
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
                      <button onClick={() => onEditar(p)} title="Editar" style={{ width: 28, height: 28, borderRadius: 7, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 13, color: NAVY }}>✎</button>
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
function TareasPanel({ isMobile, proyectos, tareasProyecto, misTareas, tareaVista, setTareaVista, tareaProyId, setTareaProyId, nombreDe, nombreProy, puedeTareas, loading, onNueva, onEditar, onAvance, onRapida }) {
  const roots = tareasProyecto.filter(t => !t.tarea_padre_id)
  const hijosDe = pid => tareasProyecto.filter(t => t.tarea_padre_id === pid)
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 3, background: "#e6e8f2", borderRadius: 9, padding: 3 }}>
          {[["proyecto", "Por proyecto"], ["mias", "Mis tareas"]].map(([k, l]) => (
            <button key={k} onClick={() => setTareaVista(k)} style={{ padding: "7px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: tareaVista === k ? "#fff" : "transparent", color: tareaVista === k ? NAVY : "#7c839a" }}>{l}</button>
          ))}
        </div>
        {tareaVista === "proyecto" && (
          <>
            <select value={tareaProyId} onChange={e => setTareaProyId(e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, flex: "1 1 240px" }}>
              <option value="">— Selecciona un proyecto —</option>
              {proyectos.map(p => <option key={p.id} value={p.id}>{(p.codigo ? p.codigo + " · " : "") + p.nombre}</option>)}
            </select>
            {puedeTareas && tareaProyId && <Bt v="pri" sm ic="➕" onClick={() => onNueva(tareaProyId, null)}>Nueva tarea</Bt>}
            {puedeTareas && tareaProyId && <Bt v="gry" sm ic="⚡" onClick={onRapida}>Carga rápida</Bt>}
          </>
        )}
      </div>

      {loading && <div style={{ textAlign: "center", padding: 40, color: "#8E8E93", fontSize: 13 }}>Cargando...</div>}
      {!loading && tareaVista === "proyecto" && !tareaProyId && (
        <div style={{ textAlign: "center", padding: 40, background: "#fff", borderRadius: 14, border: "1px solid #eceef3", color: "#8E8E93", fontSize: 13 }}>Selecciona un proyecto para ver y derivar sus tareas.</div>
      )}
      {!loading && tareaVista === "proyecto" && tareaProyId && !roots.length && (
        <div style={{ textAlign: "center", padding: 40, background: "#fff", borderRadius: 14, border: "1px solid #eceef3", color: "#8E8E93", fontSize: 13 }}>Este proyecto aún no tiene tareas. Crea la primera con “Nueva tarea”.</div>
      )}
      {!loading && tareaVista === "proyecto" && tareaProyId && roots.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
          {roots.map(t => <TareaNodo key={t.id} t={t} nivel={0} hijosDe={hijosDe} nombreDe={nombreDe} puedeTareas={puedeTareas} onNueva={onNueva} onEditar={onEditar} onAvance={onAvance} isMobile={isMobile} />)}
        </div>
      )}

      {!loading && tareaVista === "mias" && (misTareas.length ? (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
          {misTareas.map(t => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderTop: "1px solid #eceef3" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: (TESTADOS[t.estado] || {}).dot || "#8E8E93", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>{(t.es_hito ? "◆ " : "") + t.titulo}</div>
                <div style={{ fontSize: 11, color: "#AEAEB2" }}>{nombreProy(t.proyecto_id) + " · vence " + fFecha(t.fecha_vencimiento)}</div>
              </div>
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
function TareaNodo({ t, nivel, hijosDe, nombreDe, puedeTareas, onNueva, onEditar, onAvance, isMobile }) {
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
            {(t.es_hito ? "◆ " : "") + t.titulo}{t.requiere_entregable ? " 📎" : ""}
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
      {hijos.map(h => <TareaNodo key={h.id} t={h} nivel={nivel + 1} hijosDe={hijosDe} nombreDe={nombreDe} puedeTareas={puedeTareas} onNueva={onNueva} onEditar={onEditar} onAvance={onAvance} isMobile={isMobile} />)}
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
function InformesPanel({ tareas, proyectos, nombreDe, isMobile }) {
  const [fProy, setFProy] = useState("")
  const h = hoy()
  const base = fProy ? tareas.filter(t => t.proyecto_id === fProy) : tareas

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
      return { k, n: (p.codigo ? p.codigo + " · " : "") + (p.nombre || k), avance: Math.round(p.avance_pct || 0), ...stats(arr) }
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
        <select value={fProy} onChange={e => setFProy(e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, flex: "1 1 240px", maxWidth: 420 }}>
          <option value="">Todos los proyectos</option>
          {proyectos.map(p => <option key={p.id} value={p.id}>{(p.codigo ? p.codigo + " · " : "") + p.nombre}</option>)}
        </select>
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
      <TablaCump titulo="Cumplimiento por proyecto" filas={filasProy} extra />
    </>
  )
}


/* ═══ CARTA GANTT ═══ */
function GanttPanel({ proyectos, tareas, ganttProyId, setGanttProyId, isMobile, onEditarTarea, onEditarProyecto }) {
  const dISO = x => new Date(String(x).slice(0, 10) + "T00:00:00")
  const dif = (a, b) => Math.round((dISO(b) - dISO(a)) / 86400000)

  // Filas: portafolio (proyectos) o detalle (tareas del proyecto, en orden de árbol)
  let filas = []
  if (!ganttProyId) {
    filas = proyectos.filter(p => p.estado !== "cancelado").map(p => ({
      id: p.id, nivel: 0, label: (p.codigo ? p.codigo + " · " : "") + p.nombre,
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
                  <div style={{ width: wLbl, flexShrink: 0, padding: "8px 12px", paddingLeft: 12 + f.nivel * 16, fontSize: 12, color: "#1C1C1E", fontWeight: f.nivel === 0 ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={f.label}>{f.label}</div>
                  <div style={{ flex: 1, position: "relative", height: 30 }}>
                    {hoyPct !== null && <div style={{ position: "absolute", left: hoyPct + "%", top: 0, bottom: 0, width: 2, background: "#E24B4A", opacity: 0.55, zIndex: 2 }} />}
                    {f.hito ? (
                      <span title={fFecha(f.fin)} style={{ position: "absolute", left: "calc(" + pos(f.fin) + "% - 6px)", top: 9, width: 12, height: 12, background: f.done ? "#34C759" : "#BA7517", transform: "rotate(45deg)", zIndex: 1 }} />
                    ) : (
                      <div title={fFecha(f.ini) + " → " + fFecha(f.fin) + " · " + f.av + "%"} style={{ position: "absolute", left: izq + "%", width: ancho + "%", top: 8, height: 14, borderRadius: 4, background: bg, overflow: "hidden", zIndex: 1 }}>
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
        <select value={ganttProyId} onChange={e => setGanttProyId(e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, flex: "1 1 260px", maxWidth: 460 }}>
          <option value="">— Portafolio (todos los proyectos) —</option>
          {proyectos.filter(p => p.estado !== "cancelado").map(p => <option key={p.id} value={p.id}>{(p.codigo ? p.codigo + " · " : "") + p.nombre}</option>)}
        </select>
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
function EntregablesPanel({ entregables, proyectos, tareas, nombreDe, nombreProy, isMobile, loading, fProy, setFProy, fEstado, setFEstado, puedeCrear, puedeSubir, puedeAprobar, onNuevo, onEntregar, onRevisar }) {
  const tituloTarea = id => (tareas.find(t => t.id === id) || {}).titulo || ""
  const h = hoy()
  const vencido = e => e.fecha_limite && e.fecha_limite < h && (e.estado === "pendiente" || e.estado === "rechazado")
  const lista = entregables.filter(e =>
    (!fProy || e.proyecto_id === fProy) &&
    (!fEstado || (fEstado === "vencido" ? vencido(e) : e.estado === fEstado))
  )
  const k = {
    pend: entregables.filter(e => e.estado === "pendiente").length,
    rev: entregables.filter(e => e.estado === "entregado").length,
    apr: entregables.filter(e => e.estado === "aprobado").length,
    venc: entregables.filter(vencido).length
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
        <select value={fProy} onChange={e => setFProy(e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, flex: "1 1 220px", maxWidth: 380 }}>
          <option value="">Todos los proyectos</option>
          {proyectos.map(p => <option key={p.id} value={p.id}>{(p.codigo ? p.codigo + " · " : "") + p.nombre}</option>)}
        </select>
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
