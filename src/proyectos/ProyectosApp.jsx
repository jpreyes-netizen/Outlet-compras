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
  { k: "gantt",       l: "Carta Gantt", ic: "📅", soon: true },
  { k: "entregables", l: "Entregables", ic: "📎", soon: true },
  { k: "informes",    l: "Informes",    ic: "📈", soon: true },
  { k: "organigrama", l: "Organigrama", ic: "🏛", admin: true }
]
const BIT_IC = { comentario: "💬", cambio_estado: "🔄", derivacion: "↘", sistema: "⚙" }
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
      const [rp, ru, rt] = await Promise.all([
        supabase.from('pmo_proyectos').select('*').order('created_at', { ascending: false }).limit(2000),
        supabase.from('usuarios').select('id,nombre,correo,reporta_a').order('nombre'),
        supabase.from('pmo_tareas').select('*').order('orden').order('created_at', { ascending: true }).limit(5000)
      ])
      if (rp.error) throw rp.error
      setProyectos(rp.data || [])
      setUsuarios(ru.data || [])
      setTareas(rt.data || [])
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
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) }
  }
  const abrirNuevaTarea = (proyId, padreId = null) => {
    setEditandoTarea(null)
    setTareaCtx({ proyecto_id: proyId, tarea_padre_id: padreId })
    setTareaForm({ ...TAREA_FORM_VACIO, responsable_id: cu.id })
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
    setShowTarea(true)
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
      await cargar()
    } catch (e) {
      setMsg({ t: "error", x: e.message })
    } finally {
      setGuardandoTarea(false)
    }
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
          onNueva={abrirNuevaTarea} onEditar={abrirEditarTarea} onAvance={avanceRapido}
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

      {/* ═══ TABS FUTURAS ═══ */}
      {["gantt", "entregables", "informes"].includes(tab) && (
        <div style={{ textAlign: "center", padding: "60px 20px", background: "#fff", borderRadius: 14, border: "1px solid #eceef3" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>{TABS.find(t => t.k === tab)?.ic}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#3A3A3C", marginBottom: 6 }}>{TABS.find(t => t.k === tab)?.l}</div>
          <div style={{ fontSize: 13, color: "#8E8E93" }}>En construcción — próxima iteración del módulo.</div>
        </div>
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
function TareasPanel({ isMobile, proyectos, tareasProyecto, misTareas, tareaVista, setTareaVista, tareaProyId, setTareaProyId, nombreDe, nombreProy, puedeTareas, loading, onNueva, onEditar, onAvance }) {
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
