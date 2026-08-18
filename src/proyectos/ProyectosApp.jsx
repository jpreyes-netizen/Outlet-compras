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
  { k: "semana",      l: "Mi semana",   ic: "🎯" },
  { k: "objetivos",   l: "Objetivos",   ic: "🧭" },
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
  aprobada:    { l: "Aprobada",          c: "#185FA5", dot: "#185FA5" },
  permanente:  { l: "Permanente",        c: "#0C447C", dot: "#5A8FD0" }
}
const TEMA_CERRADOS = ["cumplido", "aprobada", "permanente"]   // no vencen, no envejecen, no castigan la tasa
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

const OBJ_ESTADOS = {
  activo:     { l: "Activo",      c: "#0C447C", bg: "#E6F1FB" },
  logrado:    { l: "Logrado",     c: "#27500A", bg: "#E1F5EE" },
  no_logrado: { l: "No logrado",  c: "#A32D2D", bg: "#FDEAEA" },
  pausado:    { l: "Pausado",     c: "#5F5E5A", bg: "#F2F2F7" }
}
const OBJ_UNIDADES = ["%", "CLP", "un", "d", "pts"]
const OBJ_FORM_VACIO = {
  nombre: "", descripcion: "", indicador: "", unidad: "%",
  valor_inicial: "", valor_meta: "", fecha_inicio: "", fecha_meta: "",
  responsable_id: "", area: "operacion", estado: "activo",
  frecuencia_dias: "15", fuente_dato: "", alcance: "empresa"
}
const OBJ_FREQ = [{ v: "7", l: "Semanal" }, { v: "15", l: "Quincenal" }, { v: "30", l: "Mensual" }, { v: "90", l: "Trimestral" }]
const OBJ_ALCANCE = { empresa: "Toda la empresa", area: "Un área", sucursal: "Una sucursal" }
/* ═══ MANUAL OPERATIVO — el método detrás de la app ═══ */
const AYUDA_FLUJO = [
  { n: "1", t: "La reunión produce compromisos", d: "Cada punto del acta queda con responsable y fecha. Regla de oro: si tiene responsable y fecha, no es del Directorio — se gestiona en un comité." },
  { n: "2", t: "El compromiso se abre en un plan de acción", d: "Tareas concretas con dueño y plazo. El % de avance del compromiso se calcula solo desde su plan: no se declara, se demuestra." },
  { n: "3", t: "La gestión se registra", d: "Avances, entregables y checklist quedan en la bitácora. Lo que no está registrado no existe: el sistema mide lo escrito, no lo conversado." },
  { n: "4", t: "El sistema persigue solo", d: "Todos los días a las 08:00 cada persona recibe UN correo con lo que vence hoy, lo vencido y lo sin movimiento. Nadie tiene que acordarse de cobrar." },
  { n: "5", t: "Lo estancado escala", d: "A las 08:15: un compromiso reprogramado 2 veces y vencido, con 21 días quieto, o 15 días vencido sin gestión, sube automáticamente a la jefatura. No es castigo: significa que faltan decisiones o recursos de otro nivel." },
  { n: "6", t: "La sesión se conduce con Modo Reunión", d: "El acta se ordena sola por urgencia (vencidos → sin movimiento → vence esta semana) y abre con la rendición nominal: prometido vs cumplido, persona por persona." },
  { n: "7", t: "Las metas se miden", d: "Cada meta es \"de X a Y para cuándo\", con dueño, cadencia y fuente del dato. El marcador dice en 5 segundos si vamos ganando o perdiendo, y la alineación muestra cuánto del trabajo empuja las metas." }
]
const AYUDA_CONCEPTOS = [
  ["Compromiso", "Un acuerdo de reunión con responsable y fecha. Vive en el acta de su serie y se arrastra de sesión en sesión hasta cumplirse."],
  ["Tarea", "La unidad de trabajo. Puede ser de un proyecto, del plan de acción de un compromiso, o directa. Tiene dueño, plazo y avance."],
  ["Plan de acción", "Las tareas que demuestran el avance de un compromiso. El % del compromiso se calcula desde aquí automáticamente."],
  ["Serie y sesión", "Cada comité o mesa es una serie; cada encuentro es una sesión. Los compromisos abiertos pasan solos a la sesión siguiente (arrastre)."],
  ["Vencido", "Pasó su fecha comprometida y sigue abierto. Aparece en rojo y encabeza el Modo Reunión."],
  ["Sin movimiento 🔕", "Lleva 14+ días sin ningún registro de avance. Compromiso quieto es compromiso en riesgo."],
  ["Reprogramación ⟳", "Mover un plazo es legítimo, pero exige motivo y queda contado: \"reprogramado 2×\" es información pública en la mesa."],
  ["Escalamiento ⬆", "La única vía formal entre niveles: lo que un nivel no resuelve sube al siguiente con motivo y correo. Lo cierra el jefe que lo recibió."],
  ["Permanente", "Un estándar de trabajo continuo (ej: supervisión de conducta). No vence, no envejece y no castiga la tasa de cumplimiento."],
  ["Cumplido vs Aprobada", "Cumplido: se hizo lo comprometido. Aprobada: el punto era una decisión y quedó tomada; no requería ejecución."],
  ["Meta (de X a Y)", "Objetivo trimestral medible con dueño: \"exactitud de inventario de 50% a 70% al 16-09\". Pocas: si hay más de 5, ninguna es crucial."],
  ["Medición y cadencia", "Cada meta declara cada cuánto se mide y de dónde sale el número. Solo su responsable (o gerencia) registra mediciones. Meta sin medir = meta sin gestionar."],
  ["Alineación / Torbellino", "% de iniciativas activas que empujan una meta. El resto es torbellino: trabajo real que no mueve las metas del trimestre."],
  ["Rendición nominal", "El tablero del Modo Reunión: cumplidos/total, vencidos y reprogramaciones por persona, de peor a mejor. El compromiso tiene peso público."],
  ["Regla de oro", "Si un punto tiene responsable y fecha, va a un comité. El Directorio decide y asigna; no hace seguimiento de tareas."],
  ["Niveles de reunión", "Directorio (mensual · gobierno) → Comité de Gestión (semanal · coordina entre áreas) → Comités de área (operan) → Huddles diarios (10 min, sin acta)."],
  ["Eliminación con huella 🗑", "Borrar archiva, no destruye: queda quién, cuándo y por qué en la bitácora de eliminaciones. Gerencia puede restaurar (↩)."],
  ["Avisar y agendar 📧", "Desde una tarea: correo al responsable con link directo, copia a ti y evento en su calendario. El aviso queda como gestión en la bitácora."]
]
const AYUDA_TABS = [
  ["🎯 Mi semana", "Tu día en una pantalla: agenda de Google, tareas vencidas, de esta semana y tus compromisos. Aquí se trabaja a diario — completa, registra avances o reprograma."],
  ["🧭 Objetivos", "El marcador de la empresa: las metas \"de X a Y\", su semáforo y la alineación. El responsable de cada meta registra su medición aquí."],
  ["📊 Panel", "La foto ejecutiva del portafolio: proyectos por estado, avance y responsables."],
  ["📋 Proyectos", "Los proyectos con sus tareas, subtareas, entregables y bitácora. Desde la ficha de una tarea puedes avisar y agendar por correo."],
  ["🗓 Reuniones", "Las series de cada comité y sus actas. Aquí vive el método: compromisos con plan de acción, arrastre entre sesiones y el ▶ Modo Reunión para conducir."],
  ["📈 Informes", "Cumplimiento por responsable y por proyecto, exportable a Excel. Gerencia además audita las eliminaciones."],
  ["🏢 Organigrama", "Quién reporta a quién. Define la ruta del escalamiento automático: lo estancado sube por esta estructura."]
]
const GUIA_TABS = {
  semana:     "Esto es tuyo y solo tuyo: lo que vence, lo que prometiste y tu agenda. Trabaja de arriba hacia abajo.",
  objetivos:  "¿Vamos ganando o perdiendo? La marca negra en la barra dice dónde deberíamos ir hoy.",
  panel:      "La foto del portafolio. El avance de cada proyecto se calcula solo desde sus tareas.",
  proyectos:  "Abre un proyecto para ver tareas y entregables. En la ficha de una tarea: 📧 avisar y agendar.",
  reuniones:  "Cada comité es una serie. Abre el acta y conduce la sesión con ▶ Modo Reunión: vencidos primero.",
  informes:   "Prometido vs cumplido, por persona y por proyecto. Lo que se mide, mejora.",
  organigrama:"Esta estructura define hacia dónde escala lo estancado: cada quien responde a su jefatura."
}
const FORM_VACIO = {
  nombre: "", objetivo: "", objetivo_id: "", descripcion: "", area: "operacion",
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
      return TABS.some(x => x.k === t) ? t : "semana"  // guard: tabs antiguas guardadas no rompen la vista
    } catch (e) { return "semana" }
  })
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  )
  const [verificando, setVerificando] = useState(true)
  const [tieneAcceso, setTieneAcceso] = useState(false)
  const [capsReady, setCapsReady] = useState(false)

  const [proyectos, setProyectos] = useState([])
  const [objetivos, setObjetivos] = useState([])
  const [objMed, setObjMed] = useState([])
  const [showObj, setShowObj] = useState(false)
  const [objForm, setObjForm] = useState(OBJ_FORM_VACIO)
  const [objEdit, setObjEdit] = useState(null)
  const [objBusy, setObjBusy] = useState(false)
  const [showMedir, setShowMedir] = useState(null)
  const [medForm, setMedForm] = useState({ valor: "", fecha: "", nota: "", evidencia: "" })
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
  const [nuevoPadreId, setNuevoPadreId] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importText, setImportText] = useState("")
  const [importSerie, setImportSerie] = useState("")
  const [importBusy, setImportBusy] = useState(false)
  const [importErr, setImportErr] = useState("")
  const [reuVista, setReuVista] = useState("actas")
  const [temaAvances, setTemaAvances] = useState([])
  const [temaOpen, setTemaOpen] = useState(null)
  const [avanceTxt, setAvanceTxt] = useState("")
  const [avBusy, setAvBusy] = useState(false)
  const [segTema, setSegTema] = useState(null)
  const [cumplidosOpen, setCumplidosOpen] = useState(false)
  const [editHead, setEditHead] = useState(true)
  const [modoReunion, setModoReunion] = useState(false)
  const [verSenales, setVerSenales] = useState(false)
  const [showAyuda, setShowAyuda] = useState(false)
  const [showOnboard, setShowOnboard] = useState(() => { try { return !localStorage.getItem("pmo_onboard_v1") } catch (e) { return false } })
  const cerrarOnboard = irManual => {
    try { localStorage.setItem("pmo_onboard_v1", "1") } catch (e) { }
    setShowOnboard(false)
    if (irManual) { setAyudaSec("flujo"); setShowAyuda(true) }
  }
  const [ayudaSec, setAyudaSec] = useState("flujo")
  const [guiaOculta, setGuiaOculta] = useState(() => { try { return JSON.parse(localStorage.getItem("pmo_guia_oculta") || "{}") } catch (e) { return {} } })
  const ocultarGuia = k => setGuiaOculta(g => { const n = { ...g, [k]: true }; try { localStorage.setItem("pmo_guia_oculta", JSON.stringify(n)) } catch (e) { }; return n })
  const [reprog, setReprog] = useState(null)
  const [elimTema, setElimTema] = useState(null)
  const [elimMotivo, setElimMotivo] = useState("")
  const [elimBusy, setElimBusy] = useState(false)
  const [verElim, setVerElim] = useState(false)
  const [elimLog, setElimLog] = useState([])
  const [menuTema, setMenuTema] = useState(null)
  const [elimTarea, setElimTarea] = useState(null)
  const [elimTareaMotivo, setElimTareaMotivo] = useState("")
  const [restBusy, setRestBusy] = useState("")
  const [envioBusy, setEnvioBusy] = useState(false)
  const [reprogForm, setReprogForm] = useState({ fecha: "", motivo: "" })
  const [reprogBusy, setReprogBusy] = useState(false)
  const [planOpen, setPlanOpen] = useState(null)
  const [planAdd, setPlanAdd] = useState({ padreId: null, titulo: "", resp: "", fecha: "" })
  const [planBusy, setPlanBusy] = useState(false)
  const [cfgSys, setCfgSys] = useState({})
  const [agenda, setAgenda] = useState(null)
  const [agendaMsg, setAgendaMsg] = useState("")
  const [agendaTareas, setAgendaTareas] = useState([])
  const [showCampana, setShowCampana] = useState(false)
  const [showRapidaMia, setShowRapidaMia] = useState(false)
  const [rmForm, setRmForm] = useState({ titulo: "", resp: "", fecha: "" })
  const [rmBusy, setRmBusy] = useState(false)

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

  /* ── Agenda real del usuario desde su Google Calendar ── */
  useEffect(() => {
    if (tab !== "semana" || cfgSys.gcal_activo !== "true") return
    let cancel = false
    const correo = (usuarios.find(u => u.id === cu.id) || {}).correo || cu.correo
    if (!correo) return
    ;(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('google-calendar', { body: { accion: "listar", correo, fecha: hoy() } })
        if (error) throw error
        if (!cancel) {
          setAgenda((data && data.eventos) || [])
          setAgendaTareas((data && data.tareas) || [])
          setAgendaMsg(data && data.tareasError ? "tasks_no_autorizado" : "")
        }
      } catch (e) { if (!cancel) { setAgenda([]); setAgendaTareas([]); setAgendaMsg("No se pudo leer tu agenda de Google.") } }
    })()
    return () => { cancel = true }
  }, [tab, cfgSys.gcal_activo, cu.id, usuarios])

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
      const [rp, ru, rt, re, rc, rr, rm, ra, ro, rom] = await Promise.all([
        supabase.from('pmo_proyectos').select('*').order('created_at', { ascending: false }).limit(2000),
        supabase.from('usuarios').select('id,nombre,correo,reporta_a').order('nombre'),
        supabase.from('pmo_tareas').select('*').order('orden').order('created_at', { ascending: true }).limit(5000),
        supabase.from('pmo_entregables').select('*').order('created_at', { ascending: false }).limit(3000),
        supabase.from('pmo_checklist').select('*').order('orden').limit(20000),
        supabase.from('pmo_reuniones').select('*').order('fecha', { ascending: false }).limit(1000),
        supabase.from('pmo_reunion_temas').select('*').order('orden').limit(5000),
        supabase.from('pmo_tema_avances').select('*').order('created_at', { ascending: false }).limit(20000),
        supabase.from('pmo_objetivos').select('*').order('orden').limit(200),
        supabase.from('pmo_objetivo_mediciones').select('*').order('fecha', { ascending: false }).limit(5000)
      ])
      if (rp.error) throw rp.error
      setProyectos(rp.data || [])
      setUsuarios(ru.data || [])
      setTareas((rt.data || []).filter(t => !t.eliminado_en))
      setEntregables(re.data || [])
      setChecklist(rc.data || [])
      setReuniones(rr.data || [])
      setReunionTemas((rm.data || []).filter(t => !t.eliminado_en))
      setTemaAvances(ra.data || [])
      setObjetivos(ro.error ? [] : (ro.data || []))     // si la Fase 9 no está corrida, el módulo queda vacío sin romper
      setObjMed(rom.error ? [] : (rom.data || []))
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

  /* ── Link directo desde el correo: ?tarea=TSK-xxx abre esa tarea ── */
  const [deepLinkHecho, setDeepLinkHecho] = useState(false)
  useEffect(() => {
    if (deepLinkHecho || loading || !tareas.length) return
    let id = ""
    try { id = new URLSearchParams(window.location.search).get("tarea") || "" } catch (e) { return }
    if (!id) return
    const t = tareas.find(x => x.id === id)
    setDeepLinkHecho(true)
    if (!t) { setMsg({ t: "error", x: "No se encontró esa tarea (puede haber sido eliminada)" }); return }
    setTab(t.proyecto_id ? "proyectos" : "semana")
    abrirEditarTarea(t)
    try { window.history.replaceState({}, "", window.location.pathname) } catch (e) { }
  }, [loading, tareas, deepLinkHecho])

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
  // Estricta: en los listados agregados cada persona ve solo SUS compromisos.
  // (dentro de un acta en la que participó sigue viendo el documento completo)
  const temasVis = useMemo(() => esGlobal ? reunionTemas : reunionTemas.filter(t =>
    t.responsable_id === cu.id || (Array.isArray(t.corresponsables) && t.corresponsables.includes(cu.id)) || t.escalado_a === cu.id
  ), [reunionTemas, esGlobal, cu.id])
  const temaVisIds = useMemo(() => new Set(temasVis.map(t => t.id)), [temasVis])
  // Estricta: solo las tareas propias o las que yo asigné (para poder seguirlas)
  const tareasVis = useMemo(() => esGlobal ? tareas : tareas.filter(t => t.responsable_id === cu.id || t.asignado_por_id === cu.id), [tareas, esGlobal, cu.id])

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
  const vencidoTema = t => t.fecha_compromiso && t.fecha_compromiso < hoy() && !TEMA_CERRADOS.includes(estadoTema(t))
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
  /* ── Mi semana: lo mío, ordenado por urgencia ── */
  const misCompromisos = useMemo(() => temasVis.filter(t => {
    if (!(t.responsable_id === cu.id || (Array.isArray(t.corresponsables) && t.corresponsables.includes(cu.id)))) return false
    return !TEMA_CERRADOS.includes(estadoTema(t))
  }), [temasVis, cu.id, tareas])
  const misEntregables = useMemo(() => puedeAprobarEnt ? entregables.filter(e => e.estado === "entregado") : [], [entregables, puedeAprobarEnt])
  const finSemana = useMemo(() => { const d = new Date(hoy() + "T00:00:00"); d.setDate(d.getDate() + (7 - (d.getDay() || 7))); return d.toISOString().slice(0, 10) }, [])
  const misGrupos = useMemo(() => {
    const h = hoy(), g = { vencido: [], hoy: [], semana: [], despues: [], sinfecha: [] }
    misTareas.forEach(t => {
      const f = t.fecha_vencimiento
      if (!f) g.sinfecha.push(t)
      else if (f < h) g.vencido.push(t)
      else if (f === h) g.hoy.push(t)
      else if (f <= finSemana) g.semana.push(t)
      else g.despues.push(t)
    })
    const ord = (a, b) => String(a.fecha_vencimiento || "9999").localeCompare(String(b.fecha_vencimiento || "9999"))
    Object.keys(g).forEach(k => g[k].sort(ord))
    return g
  }, [misTareas, finSemana])
  const misQuietos = useMemo(() => misCompromisos.filter(t => {
    const a = avMap[t.id]
    const org = reuniones.find(x => x.id === t.reunion_id)
    const d = a?.ult ? diasDesde(a.ult) : diasAbiertoTema(t, org?.fecha)
    return d !== null && d >= 14
  }), [misCompromisos, avMap, reuniones])
  const escaladosAmi = useMemo(() => temasVis.filter(t => t.escalado_a === cu.id && !TEMA_CERRADOS.includes(estadoTema(t))), [temasVis, cu.id, tareas])
  /* ── Objetivos: el marcador de 5 segundos ── */
  const objStats = o => {
    const ini = Number(o.valor_inicial) || 0
    const meta = Number(o.valor_meta) || 0
    const sinMedir = o.valor_actual === null || o.valor_actual === undefined || o.valor_actual === ""
    const act = sinMedir ? ini : Number(o.valor_actual)
    const rango = meta - ini
    let pct = rango === 0 ? (act >= meta ? 100 : 0) : ((act - ini) / rango) * 100
    pct = Math.max(0, Math.min(100, Math.round(pct)))
    const d0 = new Date((o.fecha_inicio || hoy()) + "T00:00:00")
    const d1 = new Date((o.fecha_meta || hoy()) + "T00:00:00")
    const dh = new Date(hoy() + "T00:00:00")
    const tot = Math.max(1, (d1 - d0) / 86400000)
    const tr = Math.max(0, Math.min(tot, (dh - d0) / 86400000))
    const esperado = Math.round((tr / tot) * 100)
    const brecha = pct - esperado
    const diasRest = Math.round((d1 - dh) / 86400000)
    const meds = objMed.filter(m => m.objetivo_id === o.id && !m.anulada_en)
    const ultMed = meds.length ? meds.map(m => m.fecha).sort().slice(-1)[0] : null
    const diasSinMedir = Math.round((dh - new Date((ultMed || o.fecha_inicio || hoy()) + "T00:00:00")) / 86400000)
    const cadencia = Number(o.frecuencia_dias) || 30
    const medAtrasada = diasSinMedir > cadencia
    const est = sinMedir ? "sin_medicion"
      : (o.estado === "logrado" || pct >= 100) ? "logrado"
      : o.estado === "pausado" ? "pausado"
      : diasRest < 0 ? "vencido"
      : brecha >= 0 ? "ganando" : brecha >= -10 ? "riesgo" : "perdiendo"
    return { ini, meta, act, pct, esperado, brecha, diasRest, est, sinMedir, ultMed, diasSinMedir, cadencia, medAtrasada, nMed: meds.length }
  }
  const alertas = useMemo(() => {
    const out = []
    misGrupos.vencido.forEach(t => out.push({ id: "v" + t.id, ic: "⚠", c: "#A32D2D", txt: "Tarea vencida: " + t.titulo, sub: "venció " + fFecha(t.fecha_vencimiento), go: "semana" }))
    misGrupos.hoy.forEach(t => out.push({ id: "h" + t.id, ic: "📅", c: "#854F0B", txt: "Vence hoy: " + t.titulo, sub: "hoy", go: "semana" }))
    misCompromisos.filter(vencidoTema).forEach(t => out.push({ id: "c" + t.id, ic: "🎯", c: "#A32D2D", txt: "Compromiso vencido: " + (t.tema || t.acuerdo || ""), sub: "plazo " + fFecha(t.fecha_compromiso), go: "reuniones" }))
    misQuietos.forEach(t => out.push({ id: "q" + t.id, ic: "🔕", c: "#854F0B", txt: "Sin movimiento: " + (t.tema || t.acuerdo || ""), sub: "+14 días sin registro", go: "reuniones" }))
    misEntregables.forEach(e => out.push({ id: "e" + e.id, ic: "📎", c: "#0C447C", txt: "Por revisar: " + e.nombre, sub: "esperando tu aprobación", go: "proyectos" }))
    objetivos.filter(o => o.estado === "activo" && o.responsable_id === cu.id).forEach(o => {
      const st = objStats(o)
      if (st.medAtrasada) out.push({ id: "m" + o.id, ic: "🧭", c: "#854F0B", txt: "Meta sin medir: " + o.nombre, sub: st.sinMedir ? "nunca se ha medido" : "última hace " + st.diasSinMedir + " d (cadencia " + st.cadencia + " d)", go: "objetivos" })
    })
    escaladosAmi.forEach(t => out.push({ id: "esc" + t.id, ic: "⬆", c: "#7A1FA2", txt: "Escalado hacia ti: " + (t.tema || t.acuerdo || ""), sub: (t.escalado_motivo || "requiere tu intervención") + " · " + nombreDe(t.responsable_id), go: "reuniones" }))
    return out
  }, [misGrupos, misCompromisos, misQuietos, misEntregables, escaladosAmi, objetivos, objMed])

  /* ── Tarea rápida desde cualquier pantalla ── */
  const guardarRapidaMia = async () => {
    if (!rmForm.titulo.trim()) return
    setRmBusy(true)
    try {
      const idT = "TSK-" + uid()
      const resp = rmForm.resp || cu.id
      const { error } = await supabase.from('pmo_tareas').insert({
        id: idT, proyecto_id: null, tarea_padre_id: null, tema_id: null,
        titulo: rmForm.titulo.trim(), descripcion: 'Tarea rápida',
        responsable_id: resp, asignado_por_id: cu.id, created_by: cu.id,
        fecha_vencimiento: rmForm.fecha || null, estado: 'pendiente', prioridad: 'media', avance_pct: 0, orden: 0
      })
      if (error) throw error
      if (resp !== cu.id) {
        const u = usuarios.find(x => x.id === resp)
        await notificarAsignacion({ responsableId: resp, asunto: "Nueva tarea asignada: " + rmForm.titulo.trim().slice(0, 90),
          mensaje: "Se te asigno una tarea.\n\nTarea: " + rmForm.titulo.trim() + (rmForm.fecha ? "\nVence: " + rmForm.fecha : "") + "\nAsignada por: " + (cu.nombre || cu.id) + "\n\n- ERP Proyectos - Outlet de Puertas SpA" })
        await crearEventoCalendar({ correo: u?.correo, titulo: "Tarea: " + rmForm.titulo.trim(), descripcion: "Asignada por " + (cu.nombre || cu.id), fecha: rmForm.fecha })
      } else if (rmForm.fecha) {
        await crearEventoCalendar({ correo: (usuarios.find(u => u.id === cu.id) || {}).correo || cu.correo, titulo: "Tarea: " + rmForm.titulo.trim(), descripcion: "Tarea propia", fecha: rmForm.fecha })
      }
      setMsg({ t: "ok", x: "Tarea creada" })
      setShowRapidaMia(false); setRmForm({ titulo: "", resp: "", fecha: "" })
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setRmBusy(false) }
  }

  const objVinculos = useMemo(() => {
    const m = {}
    const tocar = oid => (m[oid] = m[oid] || { proy: 0, comp: 0, compCumpl: 0 })
    proyectos.forEach(p => { if (p.objetivo_id && !["completado", "cancelado"].includes(p.estado)) tocar(p.objetivo_id).proy++ })
    reunionTemas.forEach(t => {
      if (!t.objetivo_id) return
      const e = estadoTema(t)
      if (e === "cumplido") tocar(t.objetivo_id).compCumpl++
      else if (!TEMA_CERRADOS.includes(e)) tocar(t.objetivo_id).comp++
    })
    return m
  }, [proyectos, reunionTemas, tareas])
  const alineacion = useMemo(() => {
    const pv = proyVis.filter(p => !["completado", "cancelado"].includes(p.estado))
    const cv = temasVis.filter(t => !TEMA_CERRADOS.includes(estadoTema(t)))
    const tot = pv.length + cv.length
    const proySin = pv.filter(p => !p.objetivo_id).length
    const compSin = cv.filter(t => !t.objetivo_id).length
    const ali = tot - proySin - compSin
    const gp = proyectos.filter(p => !["completado", "cancelado"].includes(p.estado))
    const gc = reunionTemas.filter(t => !TEMA_CERRADOS.includes(estadoTema(t)))
    const gTot = gp.length + gc.length
    const gAli = gp.filter(p => p.objetivo_id).length + gc.filter(t => t.objetivo_id).length
    if (esGlobal) return { tot: gTot, ali: gAli, pct: gTot ? Math.round((gAli / gTot) * 100) : 0, proySin: gp.filter(p => !p.objetivo_id).length, compSin: gc.filter(t => !t.objetivo_id).length, propio: false }
    return { tot, ali, pct: tot ? Math.round((ali / tot) * 100) : 0, proySin, compSin, propio: true }
  }, [proyVis, temasVis, tareas, proyectos, reunionTemas, esGlobal])

  const guardarObjetivo = async () => {
    if (!objForm.nombre.trim() || objForm.valor_meta === "" || !objForm.fecha_meta) { setMsg({ t: "error", x: "Nombre, valor meta y fecha meta son obligatorios" }); return }
    if (!objForm.responsable_id) { setMsg({ t: "error", x: "La meta necesita un responsable: sin dueño no hay quien la mida" }); return }
    if (Number(objForm.valor_meta) === Number(objForm.valor_inicial || 0)) { setMsg({ t: "error", x: "El valor meta debe ser distinto del valor inicial" }); return }
    setObjBusy(true)
    try {
      const row = {
        nombre: objForm.nombre.trim(), descripcion: objForm.descripcion || null,
        indicador: objForm.indicador || null, unidad: objForm.unidad || "%",
        valor_inicial: Number(objForm.valor_inicial) || 0, valor_meta: Number(objForm.valor_meta),
        fecha_inicio: objForm.fecha_inicio || hoy(), fecha_meta: objForm.fecha_meta,
        responsable_id: objForm.responsable_id || null, area: objForm.area, estado: objForm.estado,
        frecuencia_dias: Number(objForm.frecuencia_dias) || 30,
        fuente_dato: objForm.fuente_dato || null, alcance: objForm.alcance || "empresa",
        updated_at: new Date().toISOString()
      }
      let error
      if (objEdit) { ;({ error } = await supabase.from('pmo_objetivos').update(row).eq('id', objEdit.id)) }
      else {
        row.id = "OBJ-" + uid(); row.created_by = cu.id; row.orden = objetivos.length + 1
        ;({ error } = await supabase.from('pmo_objetivos').insert(row))
      }
      if (error) throw error
      setMsg({ t: "ok", x: objEdit ? "Meta actualizada" : "Meta creada" })
      setShowObj(false); setObjEdit(null); setObjForm(OBJ_FORM_VACIO)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setObjBusy(false) }
  }
  const puedeMedirObj = o => esGlobal || (o && o.responsable_id === cu.id)
  const anularMedicion = async (m, motivo) => {
    if (!motivo || !motivo.trim()) { setMsg({ t: "error", x: "Indica por qué se anula la medición" }); return }
    try {
      const { error } = await supabase.from('pmo_objetivo_mediciones').update({
        anulada_en: new Date().toISOString(), anulada_por: cu.id, anulada_motivo: motivo.trim()
      }).eq('id', m.id)
      if (error) throw error
      setMsg({ t: "ok", x: "Medición anulada — queda en el historial" })
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) }
  }
  const guardarMedicion = async () => {
    if (medForm.valor === "" || !showMedir) return
    setObjBusy(true)
    try {
      if (!puedeMedirObj(showMedir)) throw new Error("Solo el responsable de la meta o gerencia pueden registrar mediciones")
      const { error } = await supabase.from('pmo_objetivo_mediciones').insert({
        id: "MED-" + uid(), objetivo_id: showMedir.id, fecha: medForm.fecha || hoy(),
        valor: Number(medForm.valor), nota: medForm.nota || null, evidencia: medForm.evidencia || null, autor_id: cu.id
      })
      if (error) throw error
      if (!showMedir.baseline_validado) await supabase.from('pmo_objetivos').update({ baseline_validado: true }).eq('id', showMedir.id)
      setMsg({ t: "ok", x: "Medición registrada" + (!showMedir.baseline_validado ? " — línea base validada" : "") })
      setShowMedir(null); setMedForm({ valor: "", fecha: "", nota: "", evidencia: "" })
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setObjBusy(false) }
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
  const rankTema = t => {
    const e = estadoTema(t)
    if (TEMA_CERRADOS.includes(e)) return 5
    if (vencidoTema(t)) return 0
    const a = avMap[t.id]; const org = reuniones.find(x => x.id === t.reunion_id)
    const d = a?.ult ? diasDesde(a.ult) : diasAbiertoTema(t, org?.fecha)
    if (d !== null && d >= 14) return 1
    if (t.fecha_compromiso && t.fecha_compromiso <= finSemana) return 2
    return 3
  }
  const temasVista = modoReunion
    ? [...temasAbiertos].sort((a, b) => rankTema(a) - rankTema(b) || String(a.fecha_compromiso || "9999").localeCompare(String(b.fecha_compromiso || "9999")))
    : temasAbiertos
  const conteoModo = modoReunion ? {
    ven: temasAbiertos.filter(t => rankTema(t) === 0).length,
    qui: temasAbiertos.filter(t => rankTema(t) === 1).length,
    sem: temasAbiertos.filter(t => rankTema(t) === 2).length
  } : null
  // Rendición nominal: qué prometió y qué cumplió cada persona en esta serie
  const rendicion = useMemo(() => {
    if (!modoReunion) return []
    const m = {}
    temasSerie.forEach(t => {
      const ids = [t.responsable_id, ...(Array.isArray(t.corresponsables) ? t.corresponsables : [])].filter(Boolean)
      if (!ids.length) return
      const id = ids[0]
      const x = m[id] = m[id] || { id, tot: 0, cum: 0, ven: 0, rep: 0, qui: 0 }
      const e = estadoTema(t)
      x.tot++
      if (e === "cumplido") x.cum++
      if (vencidoTema(t)) x.ven++
      x.rep += (t.reprogramaciones || 0)
      if (rankTema(t) === 1) x.qui++
    })
    return Object.values(m).sort((a, b) => (b.ven - a.ven) || (a.cum / Math.max(1, a.tot) - b.cum / Math.max(1, b.tot)))
  }, [modoReunion, temasSerie, tareas, avMap])
  const cumplidosSerie = temasSerie.filter(t => estadoTema(t) === "cumplido")
  const serieStats = (() => {
    const cs = temasSerie.filter(t => t.responsable_id)
    const cum = cs.filter(t => estadoTema(t) === "cumplido").length
    const seg = cs.filter(t => !["aprobada", "permanente"].includes(estadoTema(t))).length
    const ven = cs.filter(vencidoTema).length
    const qui = cs.filter(t => {
      const e = estadoTema(t)
      if (TEMA_CERRADOS.includes(e)) return false
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
      let gcalWarn2 = ""
      if (row.hora) {
        const correoConv = (usuarios.find(x => x.id === cu.id) || {}).correo || cu.correo
        const invitados = row.asistentes.map(idd => (usuarios.find(x => x.id === idd) || {}).correo).filter(c => c && c.includes("@") && c !== correoConv)
        const ev = await crearEventoCalendar({ correo: correoConv, titulo: "Reunión: " + row.titulo, descripcion: "Sesión de seguimiento · ERP Proyectos - Outlet de Puertas SpA", fecha: row.fecha, hora: row.hora, invitados })
        if (ev && ev.ok === false && !ev.skip) gcalWarn2 = " · ⚠ la cita de calendario falló: " + (ev.error || "ver consola")
      }
      setMsg({ t: "ok", x: "Nueva sesión creada — los compromisos abiertos se arrastran automáticamente" + gcalWarn2 })
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
      if (cfgSys.gcal_activo !== "true" || !correo || !fecha) return { ok: false, skip: true }
      const { data, error } = await supabase.functions.invoke('google-calendar', {
        body: { correo, titulo, descripcion: descripcion || "", fecha, hora: horaEv || null, duracion_min: duracionMin || 60, invitados: invitados || [] }
      })
      if (error) throw error
      if (data && data.ok === false) throw new Error(data.error || "rechazado por la función")
      return { ok: true }
    } catch (e) {
      console.warn("[google-calendar]", e)   // visible en consola para diagnóstico
      return { ok: false, error: (e && e.message) || String(e) }
    }
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
  /* ── Reprogramar un compromiso: exige motivo y queda contado ── */
  const guardarReprog = async () => {
    if (!reprog || !reprogForm.fecha || !reprogForm.motivo.trim()) { setMsg({ t: "error", x: "La nueva fecha y el motivo son obligatorios" }); return }
    setReprogBusy(true)
    try {
      const { error } = await supabase.from('pmo_reunion_temas').update({ fecha_compromiso: reprogForm.fecha }).eq('id', reprog.id)
      if (error) throw error
      // el trigger cuenta la reprogramación; aquí queda el motivo declarado
      await supabase.from('pmo_tema_avances').insert({ id: "AVA-" + uid(), tema_id: reprog.id, contenido: "Motivo de la reprogramación: " + reprogForm.motivo.trim(), autor_id: cu.id })
      setMsg({ t: "ok", x: "Plazo reprogramado — queda registrado en la traza" })
      setReprog(null); setReprogForm({ fecha: "", motivo: "" })
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setReprogBusy(false) }
  }
  const resolverEscalamiento = async t => {
    try {
      const { error } = await supabase.from('pmo_reunion_temas').update({ escalado_a: null, escalado_en: null, escalado_motivo: null }).eq('id', t.id)
      if (error) throw error
      await supabase.from('pmo_tema_avances').insert({ id: "AVA-" + uid(), tema_id: t.id, contenido: "⬇ Escalamiento resuelto por " + (cu.nombre || cu.id) + " — vuelve a gestión normal", autor_id: cu.id })
      setMsg({ t: "ok", x: "Escalamiento cerrado" })
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) }
  }

  /* ── Eliminar un punto: solo quien diseñó la reunión/proyecto, con motivo ── */
  const puedeEliminarTema = t => {
    if (esGlobal) return true
    const r = reuniones.find(x => x.id === t.reunion_id)
    if (r && (r.convocante_id === cu.id || r.created_by === cu.id)) return true      // dueño del acta
    if (t.proyecto_id) {
      const p = proyectos.find(x => x.id === t.proyecto_id)
      if (p && (p.responsable_id === cu.id || p.created_by === cu.id)) return true   // dueño del proyecto
    }
    return false
  }
  const eliminarTema = async () => {
    if (!elimTema || !elimMotivo.trim()) { setMsg({ t: "error", x: "El motivo es obligatorio: la eliminación queda registrada" }); return }
    setElimBusy(true)
    try {
      const { error } = await supabase.from('pmo_reunion_temas').update({
        eliminado_en: new Date().toISOString(), eliminado_por: cu.id, eliminado_motivo: elimMotivo.trim()
      }).eq('id', elimTema.id)
      if (error) throw error
      // las tareas del plan de ese punto se eliminan con él (misma huella)
      const hijas = tareas.filter(x => x.tema_id === elimTema.id)
      for (const h of hijas) {
        await supabase.from('pmo_tareas').update({
          eliminado_en: new Date().toISOString(), eliminado_por: cu.id,
          eliminado_motivo: 'Punto eliminado: ' + elimMotivo.trim()
        }).eq('id', h.id)
      }
      if (hijas.length && hijas[0].proyecto_id) await syncAvanceProyecto(hijas[0].proyecto_id)
      setMsg({ t: "ok", x: "Punto eliminado" + (hijas.length ? " con sus " + hijas.length + " tarea(s)" : "") + " — queda registrado en la bitácora" })
      setElimTema(null); setElimMotivo("")
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setElimBusy(false) }
  }
  /* ── Eliminar una tarea suelta, con el mismo estándar de huella ── */
  const puedeEliminarTarea = t => {
    if (esGlobal) return true
    if (t.created_by === cu.id || t.asignado_por_id === cu.id) return true
    if (t.proyecto_id) {
      const p = proyectos.find(x => x.id === t.proyecto_id)
      if (p && (p.responsable_id === cu.id || p.created_by === cu.id)) return true
    }
    if (t.tema_id) {
      const tm = reunionTemas.find(x => x.id === t.tema_id)
      if (tm) { const r = reuniones.find(x => x.id === tm.reunion_id); if (r && (r.convocante_id === cu.id || r.created_by === cu.id)) return true }
    }
    return false
  }
  const eliminarTarea = async () => {
    if (!elimTarea || !elimTareaMotivo.trim()) { setMsg({ t: "error", x: "El motivo es obligatorio" }); return }
    setElimBusy(true)
    try {
      const hijas = tareas.filter(x => x.tarea_padre_id === elimTarea.id)
      const stamp = new Date().toISOString()
      for (const h of hijas) {
        await supabase.from('pmo_tareas').update({ eliminado_en: stamp, eliminado_por: cu.id, eliminado_motivo: 'Tarea padre eliminada: ' + elimTareaMotivo.trim() }).eq('id', h.id)
      }
      const { error } = await supabase.from('pmo_tareas').update({ eliminado_en: stamp, eliminado_por: cu.id, eliminado_motivo: elimTareaMotivo.trim() }).eq('id', elimTarea.id)
      if (error) throw error
      if (elimTarea.tema_id) await logAvanceTemaAuto(elimTarea.tema_id, '🗑 Tarea del plan eliminada: ' + elimTarea.titulo + ' — motivo: ' + elimTareaMotivo.trim())
      await syncAvanceProyecto(elimTarea.proyecto_id)
      setMsg({ t: "ok", x: "Tarea eliminada" + (hijas.length ? " con sus " + hijas.length + " subtarea(s)" : "") + " — queda en la bitácora" })
      setElimTarea(null); setElimTareaMotivo(""); setShowTarea(false)
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setElimBusy(false) }
  }

  /* ── Restaurar: el error humano tiene salida, y también deja huella ── */
  const restaurar = async reg => {
    if (!esGlobal) { setMsg({ t: "error", x: "Solo gerencia puede restaurar" }); return }
    setRestBusy(reg.id)
    try {
      const tabla = reg.entidad === 'tarea' ? 'pmo_tareas' : 'pmo_reunion_temas'
      const { error } = await supabase.from(tabla).update({ eliminado_en: null, eliminado_por: null, eliminado_motivo: null }).eq('id', reg.entidad_id)
      if (error) throw error
      await supabase.from('pmo_eliminaciones').insert({
        id: "ELR-" + uid(), entidad: reg.entidad, entidad_id: reg.entidad_id,
        titulo: "↩ RESTAURADO: " + (reg.titulo || ""), contexto: reg.contexto, responsable: reg.responsable,
        motivo: "Restaurado por " + (cu.nombre || cu.id) + " (se había eliminado por: " + reg.motivo + ")",
        eliminado_por: cu.id
      })
      if (reg.entidad === 'tema') {
        await supabase.from('pmo_tema_avances').insert({ id: "AVA-" + uid(), tema_id: reg.entidad_id, contenido: "↩ Punto restaurado por " + (cu.nombre || cu.id), autor_id: cu.id })
      }
      setMsg({ t: "ok", x: "Restaurado — vuelve a estar visible" })
      await cargarElimLog()
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setRestBusy("") }
  }

  const cargarElimLog = async () => {
    try {
      const { data } = await supabase.from('pmo_eliminaciones').select('*').order('created_at', { ascending: false }).limit(300)
      const regs = data || []
      // marcar cuáles siguen eliminados (restaurables) consultando el estado real
      const ids = { tema: [], tarea: [] }
      regs.forEach(r => { if (ids[r.entidad]) ids[r.entidad].push(r.entidad_id) })
      const vivos = new Set()
      if (ids.tema.length) {
        const { data: dt } = await supabase.from('pmo_reunion_temas').select('id,eliminado_en').in('id', ids.tema)
        ;(dt || []).forEach(x => { if (!x.eliminado_en) vivos.add(x.id) })
      }
      if (ids.tarea.length) {
        const { data: dk } = await supabase.from('pmo_tareas').select('id,eliminado_en').in('id', ids.tarea)
        ;(dk || []).forEach(x => { if (!x.eliminado_en) vivos.add(x.id) })
      }
      setElimLog(regs.map(r => ({ ...r, activo: vivos.has(r.entidad_id) })))
      setVerElim(true)
    } catch (e) { setMsg({ t: "error", x: "No se pudo leer la bitácora de eliminaciones" }) }
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
  /* ── Aviso manual: correo al responsable + copia a quien envía + agenda ── */
  const linkTarea = id => "https://outletdepuertas-erp.netlify.app/?app=proyectos&tarea=" + id
  const correoDe = id => (usuarios.find(x => x.id === id) || {}).correo || ""
  const enviarAsignacion = async t => {
    if (!t || !t.responsable_id) { setMsg({ t: "error", x: "La tarea necesita un responsable para poder avisarle" }); return }
    setEnvioBusy(true)
    try {
      const u = usuarios.find(x => x.id === t.responsable_id)
      if (!u || !u.correo || !u.correo.includes("@")) throw new Error("El responsable no tiene correo registrado")
      const miCorreo = correoDe(cu.id) || cu.correo
      const ctx = t.proyecto_id ? nombreProy(t.proyecto_id) : (t.tema_id ? "Compromiso de acta" : "Tarea directa")
      const link = linkTarea(t.id)
      const asunto = "Tarea asignada: " + t.titulo.slice(0, 90)
      const cuerpo =
        "Hola " + ((u.nombre || "").split(" ")[0] || "") + "," + "\n\n" +
        "Se te asignó esta tarea o actividad. Es importante que la revises." + "\n\n" +
        "Tarea: " + t.titulo + "\n" +
        (t.descripcion ? "Detalle: " + t.descripcion + "\n" : "") +
        "Proyecto: " + ctx + "\n" +
        (t.fecha_vencimiento ? "Fecha comprometida: " + fFecha(t.fecha_vencimiento) + "\n" : "") +
        "Asignada por: " + (cu.nombre || cu.id) + "\n\n" +
        (t.fecha_vencimiento ? "Se te programó en tu calendario." + "\n\n" : "") +
        "Ingresa al siguiente link, márcala como resuelta cuando esté lista y/o sube la respuesta o entregable en este mismo link:" + "\n" +
        link + "\n\n" +
        "- ERP Proyectos · Outlet de Puertas SpA"

      // 1) correo al responsable
      await supabase.from('notificaciones').insert({
        id: uid(), tipo: "Email", destino_correo: u.correo, destino_nombre: u.nombre || u.correo,
        asunto, mensaje: cuerpo, estado: "Pendiente", usuario: cu.nombre || cu.id, rol: cu.rol || null,
        fecha: hoy(), hora: hora()
      })
      // 2) copia al remitente
      if (miCorreo && miCorreo.includes("@") && miCorreo !== u.correo) {
        await supabase.from('notificaciones').insert({
          id: uid(), tipo: "Email", destino_correo: miCorreo, destino_nombre: cu.nombre || cu.id,
          asunto: "[Copia] " + asunto,
          mensaje: "Copia del aviso enviado a " + (u.nombre || u.correo) + ".\n\n" + cuerpo,
          estado: "Pendiente", usuario: cu.nombre || cu.id, rol: cu.rol || null, fecha: hoy(), hora: hora()
        })
      }
      // 3) evento en el calendario del responsable (con copia al remitente como invitado)
      let avisoCal = ""
      if (t.fecha_vencimiento) {
        const ev = await crearEventoCalendar({
          correo: u.correo, titulo: "Tarea: " + t.titulo.slice(0, 100),
          descripcion: ctx + "\nAsignada por " + (cu.nombre || cu.id) + "\n\n" + link,
          fecha: t.fecha_vencimiento, invitados: miCorreo && miCorreo !== u.correo ? [miCorreo] : []
        })
        if (ev && ev.ok === false && !ev.skip) avisoCal = " · ⚠ el calendario falló: " + (ev.error || "ver consola")
        if (ev && ev.skip) avisoCal = " · (calendario desactivado)"
      } else {
        avisoCal = " · sin fecha, no se agendó"
      }
      await logTarea(t.proyecto_id, t.id, 'sistema', 'Aviso enviado a ' + (u.nombre || u.correo) + ' con copia a ' + (cu.nombre || cu.id))
      if (t.tema_id) await logAvanceTemaAuto(t.tema_id, '📧 Aviso de tarea enviado a ' + (u.nombre || u.correo) + ': ' + t.titulo)
      setMsg({ t: "ok", x: "Aviso enviado a " + (u.nombre || u.correo) + " con copia a ti" + avisoCal })
      await cargar()
    } catch (e) { setMsg({ t: "error", x: e.message }) } finally { setEnvioBusy(false) }
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
    setEditHead(true); setCumplidosOpen(false); setTemaOpen(null); setNuevoPadreId(null)
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
    setEditHead(false); setCumplidosOpen(false); setTemaOpen(null); setModoReunion(false)
    setShowReunion(true)
  }
  const toggleAsistente = id => setReunionForm(f => ({
    ...f, asistentes: f.asistentes.includes(id) ? f.asistentes.filter(x => x !== id) : [...f.asistentes, id]
  }))
  const updTema = (i, campo, valor) => setTemasNuevos(ts => ts.map((t, j) => j === i ? { ...t, [campo]: valor } : t))
  /* ── Importar acta de Gemini (.docx) ── */
  const cargarMammoth = () => new Promise((res, rej) => {
    if (window.mammoth) return res(window.mammoth)
    const sc = document.createElement("script")
    sc.src = "https://unpkg.com/mammoth@1.6.0/mammoth.browser.min.js"
    sc.onload = () => window.mammoth ? res(window.mammoth) : rej(new Error("No se pudo inicializar el lector de Word."))
    sc.onerror = () => rej(new Error("No se pudo cargar el lector de Word (revisa tu conexión a internet)."))
    document.body.appendChild(sc)
  })
  const matchUsuario = (nombre, arr) => {
    const n = normTxt(nombre); if (!n) return null
    let best = null
    arr.forEach(u => {
      const un = normTxt(u.nombre || ""), corr = normTxt((u.correo || "").split("@")[0])
      if (un && un.length > 2 && (n === un || n.startsWith(un) || un.startsWith(n) || n.includes(un))) { if (!best || un.length > normTxt(best.nombre || "").length) best = u }
      else if (corr && corr.length > 2 && n.includes(corr) && !best) best = u
    })
    return best
  }
  const separarResp = (raw, arr) => {
    let r = (raw || "").replace(/^\[|\]$/g, "").trim()
    const low = normTxt(r)
    if (/^(el grupo|el equipo|todos|grupo|equipo)\b/.test(low)) return { u: null, titulo: r.replace(/^(el grupo|el equipo|todos|grupo|equipo)\s*/i, "").trim() || r }
    let best = null
    arr.forEach(u => { const un = normTxt(u.nombre || ""); if (un && un.length > 2 && low.startsWith(un) && (!best || (u.nombre || "").length > (best.nombre || "").length)) best = u })
    if (best) return { u: best, titulo: r.slice((best.nombre || "").length).trim() || r }
    return { u: null, titulo: r }
  }
  const parsearImport = async () => {
    setImportBusy(true); setImportErr("")
    try {
      let texto = importText.trim()
      if (!texto) {
        if (!importFile) throw new Error("Sube el archivo .docx del acta o pega el texto.")
        const mammoth = await cargarMammoth()
        const buf = await importFile.arrayBuffer()
        const out = await mammoth.extractRawText({ arrayBuffer: buf })
        texto = (out && out.value) || ""
      }
      if (!texto.trim()) throw new Error("El archivo no tiene texto legible.")
      const p = parseActaGemini(texto)
      if (!p.titulo && !p.pasos.length) throw new Error("No reconocí el formato de Gemini (no encontré 'Próximos pasos'). Revisa el archivo o pega el texto.")
      const asis = []
      if (p.invitadosRaw) usuarios.forEach(u => { if ((u.nombre || "").length > 2 && normTxt(p.invitadosRaw).includes(normTxt(u.nombre))) asis.push(u.id) })
      if (!asis.includes(cu.id)) asis.push(cu.id)
      setReunionForm({ titulo: p.titulo || "Reunión importada", fecha: p.fecha || hoy(), hora: "", lugar: "Google Meet", proyecto_id: "", asistentes: asis, resumen: p.resumen || "", tipo: "operativa" })
      setTemasNuevos((p.pasos.length ? p.pasos : [{ responsableBracket: "", raw: "", desc: "" }]).map(ps => {
        let u = ps.responsableBracket ? matchUsuario(ps.responsableBracket, usuarios) : null
        let titulo = ps.raw
        if (!u) { const sep = separarResp(ps.raw, usuarios); u = sep.u; titulo = sep.titulo }
        return { tema: titulo || "", acuerdo: ps.desc || "", responsable_id: u ? u.id : "", corresponsables: [], fecha_compromiso: "", proyecto_id: "", estado: "no_iniciado", crear: !!u }
      }))
      setNuevoPadreId(importSerie || null)
      setReunionSel(null); setEditHead(true); setCumplidosOpen(false); setTemaOpen(null)
      setShowImport(false); setShowReunion(true)
      setMsg({ t: "ok", x: "Acta interpretada — revisa responsables y fechas antes de guardar" })
    } catch (e) { setImportErr(e.message) } finally { setImportBusy(false) }
  }

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
        ;({ error } = await supabase.from('pmo_reuniones').insert({ ...head, id: reuId, convocante_id: cu.id, created_by: cu.id, reunion_padre_id: nuevoPadreId || null }))
      }
      if (error) throw error
      // Cita en el Calendar de los asistentes (solo al crear, si tiene hora y la integración está activa)
      let gcalWarn = ""
      if (!reunionSel && reunionForm.hora) {
        const correoConv = (usuarios.find(x => x.id === cu.id) || {}).correo || cu.correo
        const invitados = reunionForm.asistentes.map(id => (usuarios.find(x => x.id === id) || {}).correo).filter(c => c && c.includes("@") && c !== correoConv)
        const ev = await crearEventoCalendar({ correo: correoConv, titulo: "Reunión: " + reunionForm.titulo.trim(), descripcion: (reunionForm.lugar ? "Lugar: " + reunionForm.lugar + "\n" : "") + "Convocada desde ERP Proyectos - Outlet de Puertas SpA", fecha: reunionForm.fecha, hora: reunionForm.hora, invitados })
        if (ev && ev.ok === false && !ev.skip) gcalWarn = " · ⚠ la cita de calendario falló: " + (ev.error || "ver consola")
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
          id: temaId, reunion_id: reuId, orden: base + i, objetivo_id: t.objetivo_id || null,
          tema: t.tema.trim() || null, acuerdo: t.acuerdo.trim() || null,
          responsable_id: t.responsable_id || null, corresponsables: corr,
          proyecto_id: t.proyecto_id || null, estado: t.estado || "no_iniciado",
          fecha_compromiso: t.fecha_compromiso || null, tarea_id: tareaId
        })
        if (eM) throw eM
      }
      for (const pd of proysAfectados) await syncAvanceProyecto(pd)
      setMsg({ t: "ok", x: (reunionSel ? "Acta actualizada" + (generadas ? " · " + generadas + " tarea(s) generada(s)" : "") : "Reunión registrada" + (generadas ? " · " + generadas + " tarea(s) generada(s)" : "")) + gcalWarn })
      setShowReunion(false)
      setNuevoPadreId(null)
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
      nombre: p.nombre || "", objetivo: p.objetivo || "", objetivo_id: p.objetivo_id || "", descripcion: p.descripcion || "",
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
        objetivo_id: form.objetivo_id || null,
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
          <button onClick={() => { setAyudaSec("flujo"); setShowAyuda(true) }} title="Manual y flujo de trabajo" style={{ width: 34, height: 34, borderRadius: 9, background: "#26305a", border: "none", cursor: "pointer", fontSize: 15, color: "#c7cee6", fontWeight: 800 }}>?</button>
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowCampana(v => !v)} title="Alertas" style={{ width: 34, height: 34, borderRadius: 9, background: "#26305a", border: "none", cursor: "pointer", fontSize: 15, color: "#c7cee6", position: "relative" }}>
              🔔
              {alertas.length > 0 && <span style={{ position: "absolute", top: -3, right: -3, minWidth: 17, height: 17, borderRadius: 999, background: "#E24B4A", color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{alertas.length > 99 ? "99+" : alertas.length}</span>}
            </button>
            {showCampana && (
              <>
                <div onClick={() => setShowCampana(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                <div style={{ position: "absolute", top: 42, right: 0, width: isMobile ? 290 : 340, maxHeight: 400, overflowY: "auto", background: "#fff", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.25)", zIndex: 61, padding: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#8E8E93", textTransform: "uppercase", padding: "8px 10px 6px" }}>Requieren tu atención ({alertas.length})</div>
                  {!alertas.length && <div style={{ fontSize: 12.5, color: "#AEAEB2", padding: "10px 10px 14px" }}>Todo al día. Sin alertas pendientes.</div>}
                  {alertas.map(a => (
                    <button key={a.id} onClick={() => { setTab(a.go); setProyOpen(null); setShowCampana(false) }} style={{ display: "flex", gap: 9, alignItems: "flex-start", width: "100%", textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: "8px 10px", borderRadius: 9 }} className="pmo-tr">
                      <span style={{ fontSize: 14, lineHeight: "18px" }}>{a.ic}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: a.c, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.txt}</span>
                        <span style={{ display: "block", fontSize: 10.5, color: "#AEAEB2" }}>{a.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
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

      {/* ═══ BIENVENIDA · primera vez ═══ */}
      {showOnboard && (
        <>
          <div onClick={() => cerrarOnboard(false)} style={{ position: "fixed", inset: 0, background: "rgba(16,20,40,0.55)", zIndex: 200 }} />
          <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: isMobile ? "92%" : 640, background: "#fff", borderRadius: 18, zIndex: 201, padding: isMobile ? 20 : 28, boxShadow: "0 24px 80px rgba(0,0,0,0.35)" }}>
            <div style={{ fontSize: isMobile ? 19 : 22, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.01em" }}>Bienvenido a Proyectos 👋</div>
            <div style={{ fontSize: 13, color: "#8E8E93", marginTop: 4, marginBottom: 16 }}>La app donde viven las mesas, los compromisos y las metas de Outlet. Tres cosas para partir:</div>
            {[
              ["🎯", "Mi semana es tu página", "Lo que vence, lo que prometiste y tu agenda. Si trabajas desde ahí, no se te escapa nada."],
              ["🗓", "Las reuniones son series", "Cada comité tiene su acta. Los compromisos quedan con responsable y fecha, y se arrastran solos hasta cumplirse."],
              ["🤖", "El sistema persigue solo", "Correo diario a las 08:00 con lo tuyo; lo estancado escala a la jefatura a las 08:15. Lo que no está registrado no existe."]
            ].map(([ic, t, d]) => (
              <div key={t} style={{ display: "flex", gap: 13, padding: "10px 0", borderTop: "1px solid #f0f1f5" }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, background: "#eef1f8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, flexShrink: 0 }}>{ic}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#1C1C1E" }}>{t}</div>
                  <div style={{ fontSize: 12.5, color: "#5F5E5A", lineHeight: 1.5, marginTop: 2 }}>{d}</div>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => cerrarOnboard(true)} style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: "1px solid #d8dcea", background: "#fff", color: NAVY, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Ver el manual completo</button>
              <button onClick={() => cerrarOnboard(false)} style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: "none", background: NAVY, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Empezar →</button>
            </div>
            <div style={{ fontSize: 11, color: "#AEAEB2", marginTop: 10, textAlign: "center" }}>El botón "?" arriba abre esta guía cuando quieras.</div>
          </div>
        </>
      )}

      {/* GUÍA CONTEXTUAL */}
      {!proyOpen && GUIA_TABS[tab] && !guiaOculta[tab] && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#E6F1FB", border: "1px solid #cfe3f7", borderRadius: 10, padding: "8px 13px", marginBottom: 10 }}>
          <span style={{ fontSize: 14 }}>💡</span>
          <span style={{ flex: 1, fontSize: 12.5, color: "#0C447C", lineHeight: 1.4 }}>{GUIA_TABS[tab]}</span>
          <button onClick={() => { setAyudaSec("flujo"); setShowAyuda(true) }} style={{ border: "none", background: "#0C447C", color: "#fff", borderRadius: 7, padding: "4px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Ver manual</button>
          <button onClick={() => ocultarGuia(tab)} title="No mostrar más en esta pestaña" style={{ border: "none", background: "transparent", color: "#7ba7d4", fontSize: 14, cursor: "pointer", fontWeight: 700 }}>✕</button>
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
      {/* ═══ OBJETIVOS ═══ */}
      {!proyOpen && tab === "objetivos" && (
        <ObjetivosPanel objetivos={objetivos} objStats={objStats} vinculos={objVinculos} alineacion={alineacion}
          mediciones={objMed} nombreDe={nombreDe} isMobile={isMobile} loading={loading} puedeEditar={esGlobal}
          puedeMedir={puedeMedirObj} onAnular={anularMedicion} cuId={cu.id}
          onNueva={() => { setObjEdit(null); setObjForm({ ...OBJ_FORM_VACIO, fecha_inicio: hoy() }); setShowObj(true) }}
          onEditar={o => { setObjEdit(o); setObjForm({ nombre: o.nombre || "", descripcion: o.descripcion || "", indicador: o.indicador || "", unidad: o.unidad || "%", valor_inicial: o.valor_inicial ?? "", valor_meta: o.valor_meta ?? "", fecha_inicio: o.fecha_inicio || "", fecha_meta: o.fecha_meta || "", responsable_id: o.responsable_id || "", area: o.area || "operacion", estado: o.estado || "activo", frecuencia_dias: String(o.frecuencia_dias || 15), fuente_dato: o.fuente_dato || "", alcance: o.alcance || "empresa" }); setShowObj(true) }}
          onMedir={o => { setShowMedir(o); setMedForm({ valor: "", fecha: hoy(), nota: "", evidencia: "" }) }} />
      )}

      {/* ═══ MI SEMANA ═══ */}
      {!proyOpen && tab === "semana" && (
        <MiSemanaPanel
          cu={cu} isMobile={isMobile} loading={loading} grupos={misGrupos} compromisos={misCompromisos}
          entregablesRev={misEntregables} agenda={agenda} agendaTareas={agendaTareas} agendaMsg={agendaMsg} gcalOn={cfgSys.gcal_activo === "true"}
          nombreDe={nombreDe} nombreProy={nombreProy} reuniones={reuniones} avMap={avMap} diasDesde={diasDesde}
          estadoTema={estadoTema} vencidoTema={vencidoTema} diasAbiertoTema={diasAbiertoTema} chkMap={chkMap}
          onCompletar={t => avanceRapido(t, "completada")} onAbrirTarea={abrirEditarTarea}
          onAvanceComp={t => { setSegTema(t); setAvanceTxt("") }} onRevisarEnt={abrirRevision}
          onNueva={() => { setRmForm({ titulo: "", resp: "", fecha: "" }); setShowRapidaMia(true) }} />
      )}

      {/* Botón flotante: registrar sin buscar dónde */}
      {!showRapidaMia && (
        <button onClick={() => { setRmForm({ titulo: "", resp: "", fecha: "" }); setShowRapidaMia(true) }} title="Nueva tarea rápida"
          style={{ position: "fixed", right: 18, bottom: 18, width: 52, height: 52, borderRadius: 999, background: NAVY, color: "#fff", border: "none", cursor: "pointer", fontSize: 25, lineHeight: "52px", boxShadow: "0 6px 20px rgba(22,33,62,0.4)", zIndex: 90 }}>+</button>
      )}

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
              onNueva={abrirNuevaReunion} onAbrir={abrirReunionVer}
              onImportar={() => { setImportFile(null); setImportText(""); setImportSerie(""); setImportErr(""); setShowImport(true) }} />
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
        <>
          <InformesPanel tareas={tareasVis} proyectos={proyVis} nombreDe={nombreDe} isMobile={isMobile} />
          {esGlobal && (
            <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid #eceef3" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#1C1C1E" }}>🗑 Auditoría de eliminaciones</div>
                  <div style={{ fontSize: 12, color: "#8E8E93" }}>Todo lo que se borró del sistema: qué era, de quién, quién lo borró y por qué.</div>
                </div>
                <Bt v="gry" sm onClick={cargarElimLog}>Abrir bitácora</Bt>
              </div>
            </div>
          )}
        </>
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
        <Fl l="Meta de empresa a la que aporta">
          <select value={form.objetivo_id} onChange={e => setForm(f => ({ ...f, objetivo_id: e.target.value }))} style={css.select}>
            <option value="">— Sin meta asociada (torbellino) —</option>
            {objetivos.filter(o => o.estado === "activo").map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
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
        {editandoTarea && editandoTarea.responsable_id && editandoTarea.responsable_id !== cu.id && (
          <button onClick={() => enviarAsignacion(editandoTarea)} disabled={envioBusy}
            style={{ width: "100%", marginTop: 10, padding: "11px 14px", borderRadius: 10, border: "none", background: envioBusy ? "#9fb4d4" : NAVY, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: envioBusy ? "wait" : "pointer" }}>
            {envioBusy ? "Enviando..." : "📧 Avisar y agendar a " + (nombreDe(editandoTarea.responsable_id) || "").split(" ")[0]}
          </button>
        )}
        {editandoTarea && editandoTarea.responsable_id && editandoTarea.responsable_id !== cu.id && (
          <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 6, lineHeight: 1.45 }}>
            Envía el correo con el enlace directo a esta tarea, deja copia en tu bandeja y la agenda en el calendario del responsable{editandoTarea.fecha_vencimiento ? "" : " (define una fecha para que se agende)"}.
          </div>
        )}
        {editandoTarea && puedeEliminarTarea(editandoTarea) && (
          <button onClick={() => { setElimTarea(editandoTarea); setElimTareaMotivo("") }}
            style={{ width: "100%", marginTop: 10, padding: "9px 14px", borderRadius: 10, border: "1px solid #f3d0d0", background: "#FDEAEA", color: "#A32D2D", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            🗑 Eliminar esta tarea{tareas.filter(x => x.tarea_padre_id === editandoTarea.id).length > 0 ? " y sus subtareas" : ""}
          </button>
        )}
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
              <button onClick={cargarElimLog} title="Ver puntos eliminados de la serie" style={{ border: "none", cursor: "pointer", borderRadius: 8, padding: "5px 11px", fontSize: 11.5, fontWeight: 700, background: "#26305a", color: "#c7cee6" }}>🗑 Eliminados</button>
              <button onClick={() => setModoReunion(v => !v)} style={{ border: "none", cursor: "pointer", borderRadius: 8, padding: "5px 11px", fontSize: 11.5, fontWeight: 700, background: modoReunion ? "#7ed957" : "#26305a", color: modoReunion ? "#16213e" : "#c7cee6" }}>{modoReunion ? "■ Salir del modo reunión" : "▶ Modo reunión"}</button>
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
              <span style={{ fontSize: 14.5, fontWeight: 800, color: "#1C1C1E" }}>Seguimiento de compromisos <span style={{ color: "#8E8E93", fontWeight: 600 }}>· {temasAbiertos.length} abiertos en la serie</span>
                <button onClick={() => setVerSenales(v => !v)} style={{ marginLeft: 10, border: "none", background: verSenales ? NAVY : "#eef0f7", color: verSenales ? "#fff" : "#5F5E5A", borderRadius: 999, padding: "2px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>ℹ ¿Qué significan las señales?</button>
              </span>
              <span style={{ fontSize: 11, color: "#AEAEB2" }}>Los compromisos abiertos se arrastran automáticamente entre sesiones</span>
            </div>
            {!temasSerie.length && <div style={{ fontSize: 12.5, color: "#AEAEB2", padding: "14px 0" }}>Esta serie aún no tiene compromisos registrados.</div>}
            {verSenales && (
              <div style={{ background: "#fff", border: "1px solid #eceef3", borderRadius: 12, padding: "11px 14px", marginBottom: 12, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "6px 20px", fontSize: 12, color: "#3A3A3C", lineHeight: 1.45 }}>
                <span><span style={{ background: "#FDEAEA", color: "#A32D2D", fontWeight: 800, borderRadius: 999, padding: "1px 8px", fontSize: 10.5 }}>vencido hace N d</span> pasó su fecha y sigue abierto — encabeza la reunión.</span>
                <span><span style={{ background: "#A32D2D", color: "#fff", fontWeight: 800, borderRadius: 999, padding: "1px 8px", fontSize: 10.5 }}>🔕 SIN MOVIMIENTO</span> 14+ días sin ningún avance registrado.</span>
                <span><span style={{ background: "#fdf3e6", color: "#854F0B", fontWeight: 800, borderRadius: 999, padding: "1px 8px", fontSize: 10.5 }}>⟳ reprogramado N×</span> el plazo se movió N veces; con 2× vencido, escala solo.</span>
                <span><span style={{ background: "#7A1FA2", color: "#fff", fontWeight: 800, borderRadius: 999, padding: "1px 8px", fontSize: 10.5 }}>⬆ ESCALADO</span> subió a la jefatura por falta de avance; lo cierra quien lo recibió.</span>
                <span><span style={{ color: "#5F5E5A", fontWeight: 700 }}>⏱ N d abierto</span> días desde que el compromiso nació en su reunión de origen.</span>
                <span><span style={{ color: "#0C447C", fontWeight: 800 }}>Permanente</span> estándar de trabajo continuo: no vence ni castiga la tasa.</span>
                <span style={{ gridColumn: "1 / -1", color: "#8E8E93" }}>Acción principal: <strong>💬 Registrar avance</strong>. El estado se cambia en el selector de la derecha. Reprogramar y eliminar viven en el menú ⋯.</span>
              </div>
            )}
            {modoReunion && (
              <div style={{ position: "sticky", top: 0, zIndex: 5, background: "#16213e", color: "#eef1f8", borderRadius: 10, padding: "8px 14px", marginBottom: 10, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", fontSize: 12, fontWeight: 700 }}>
                <span>▶ MODO REUNIÓN · orden por urgencia</span>
                <span style={{ color: "#f2707a" }}>⚠ {conteoModo.ven} vencidos</span>
                <span style={{ color: "#f0b25a" }}>🔕 {conteoModo.qui} sin movimiento</span>
                <span style={{ color: "#7ec8f2" }}>📅 {conteoModo.sem} vencen esta semana</span>
                <span style={{ color: "#9aa3bd", fontWeight: 500 }}>Recorre de arriba hacia abajo: avance, nueva fecha o escalamiento por punto.</span>
              </div>
            )}
            {modoReunion && rendicion.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #eceef3", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: "#3A3A3C", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 9 }}>Rendición de cuentas · uno por uno</div>
                {rendicion.map(r => {
                  const tasa = Math.round((r.cum / Math.max(1, r.tot)) * 100)
                  const col = tasa >= 70 ? "#27500A" : tasa >= 40 ? "#854F0B" : "#A32D2D"
                  return (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid #f4f5f9", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E", minWidth: 140 }}>{nombreDe(r.id)}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: col, minWidth: 92 }}>{r.cum}/{r.tot} cumplidos</span>
                      {r.ven > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#A32D2D", background: "#FDEAEA", borderRadius: 999, padding: "1px 9px" }}>⚠ {r.ven} vencido(s)</span>}
                      {r.rep > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#854F0B", background: "#fdf3e6", borderRadius: 999, padding: "1px 9px" }}>⟳ {r.rep} reprogramación(es)</span>}
                      {r.qui > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#854F0B", background: "#fdf3e6", borderRadius: 999, padding: "1px 9px" }}>🔕 {r.qui} sin movimiento</span>}
                      {r.ven === 0 && r.rep === 0 && r.qui === 0 && <span style={{ fontSize: 11, color: "#27500A", fontWeight: 700 }}>✔ al día</span>}
                    </div>
                  )
                })}
              </div>
            )}
            {!temasAbiertos.length && !cumplidosSerie.length && (
              <div style={{ textAlign: "center", padding: "30px 20px", background: "#fff", borderRadius: 14, border: "1px dashed #d8dcea" }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>🗒</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#3A3A3C" }}>Esta mesa aún no tiene compromisos</div>
                <div style={{ fontSize: 12.5, color: "#8E8E93", marginTop: 5, maxWidth: 460, margin: "5px auto 0", lineHeight: 1.55 }}>
                  Agrégalos abajo en <strong>"+ Agregar tema"</strong> con responsable y fecha. En la próxima sesión llegarán arrastrados automáticamente, y la reunión se conduce con <strong>▶ Modo Reunión</strong>.
                </div>
              </div>
            )}
            {temasVista.map((t, idx) => {
              const est = estadoTema(t)
              const ec = TEMA_ESTADOS[est] || TEMA_ESTADOS.no_iniciado
              const corr = Array.isArray(t.corresponsables) ? t.corresponsables : []
              const origen = reuniones.find(x => x.id === t.reunion_id) || reunionSel
              const cerrado = TEMA_CERRADOS.includes(est)
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
                    {(t.reprogramaciones || 0) > 0 && (
                      <span title={"Plazo original: " + fFecha(t.fecha_original)} style={{ background: (t.reprogramaciones || 0) >= 2 ? "#FDEAEA" : "#fdf3e6", color: (t.reprogramaciones || 0) >= 2 ? "#A32D2D" : "#854F0B", fontWeight: 800, borderRadius: 999, padding: "2px 10px" }}>⟳ reprogramado {t.reprogramaciones}× · original {fFecha(t.fecha_original)}</span>
                    )}
                    {t.escalado_a && (
                      <span title={t.escalado_motivo || ""} style={{ background: "#7A1FA2", color: "#fff", fontWeight: 800, borderRadius: 999, padding: "2px 10px", fontSize: 10.5, letterSpacing: "0.03em" }}>⬆ ESCALADO A {(nombreDe(t.escalado_a) || "").split(" ")[0].toUpperCase()}</span>
                    )}
                    {t.escalado_a === cu.id && <button onClick={() => resolverEscalamiento(t)} style={{ border: "none", background: "#7A1FA2", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: "#fff", cursor: "pointer", fontWeight: 700 }}>⬇ Resolver escalamiento</button>}
                    {!cerrado && (t.fecha_compromiso || puedeEliminarTema(t)) && (
                      <span style={{ position: "relative", display: "inline-block" }}>
                        <button onClick={() => setMenuTema(menuTema === t.id ? null : t.id)} title="Más acciones" style={{ border: "1px solid #e3e6f0", background: "#fff", borderRadius: 6, padding: "3px 10px", fontSize: 12, color: "#5F5E5A", cursor: "pointer", fontWeight: 800 }}>⋯</button>
                        {menuTema === t.id && (
                          <>
                            <span onClick={() => setMenuTema(null)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                            <span style={{ position: "absolute", top: 26, right: 0, zIndex: 41, background: "#fff", borderRadius: 10, boxShadow: "0 10px 32px rgba(0,0,0,0.18)", border: "1px solid #eceef3", minWidth: 210, overflow: "hidden", display: "block" }}>
                              {t.fecha_compromiso && (
                                <button onClick={() => { setMenuTema(null); setReprog(t); setReprogForm({ fecha: "", motivo: "" }) }} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "9px 13px", fontSize: 12.5, color: "#854F0B", cursor: "pointer", fontWeight: 700 }}>⟳ Reprogramar plazo…</button>
                              )}
                              {puedeEliminarTema(t) && (
                                <button onClick={() => { setMenuTema(null); setElimTema(t); setElimMotivo("") }} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "9px 13px", fontSize: 12.5, color: "#A32D2D", cursor: "pointer", fontWeight: 700, borderTop: "1px solid #f4f5f9" }}>🗑 Eliminar punto…</button>
                              )}
                            </span>
                          </>
                        )}
                      </span>
                    )}
                    <span style={{ background: cerrado ? "#F2F2F7" : abierto >= 30 ? "#FDEAEA" : abierto >= 15 ? "#fdf3e6" : "#F2F2F7", color: agingC, fontWeight: 800, borderRadius: 999, padding: "2px 10px" }}>⏱ {abierto} d abierto</span>
                    <span>💬 {av?.n || 0} avance(s){av?.ult ? " · últ. " + (ultD === 0 ? "hoy" : "hace " + ultD + " d") : ""}</span>
                    {quieto && <span style={{ background: "#A32D2D", color: "#fff", fontWeight: 800, borderRadius: 999, padding: "2px 10px", fontSize: 10.5, letterSpacing: "0.04em" }}>🔕 SIN MOVIMIENTO</span>}
                    {planMap[t.id] && <span style={{ background: planMap[t.id].done === planMap[t.id].tot ? "#E1F5EE" : "#eef1f8", color: planMap[t.id].done === planMap[t.id].tot ? "#27500A" : NAVY, fontWeight: 800, borderRadius: 999, padding: "2px 10px" }}>📋 {planMap[t.id].done}/{planMap[t.id].tot} tareas</span>}
                    <button onClick={() => { setTemaOpen(abiertoSeg ? null : t.id); setAvanceTxt("") }} style={{ border: "none", background: abiertoSeg ? NAVY : "#f4f5f9", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: abiertoSeg ? "#fff" : NAVY, cursor: "pointer", fontWeight: 700 }}>{abiertoSeg ? "Ocultar ▴" : "💬 Registrar avance ▾"}</button>
                    <button onClick={() => { setPlanOpen(planOpen === t.id ? null : t.id); setPlanAdd({ padreId: null, titulo: "", resp: "", fecha: "" }) }} style={{ border: "none", background: planOpen === t.id ? "#1F6E54" : "#e9f4ef", borderRadius: 6, padding: "3px 10px", fontSize: 11, color: planOpen === t.id ? "#fff" : "#1F6E54", cursor: "pointer", fontWeight: 700 }}>{planOpen === t.id ? "Ocultar plan ▴" : "📋 Plan de acción ▾"}</button>
                  </div>
                  {abiertoSeg && <SeguimientoTema avances={avancesDe(t.id)} nombreDe={nombreDe} valor={avanceTxt} setValor={setAvanceTxt} onAgregar={() => agregarAvance(t)} busy={avBusy} />}
                  {planOpen === t.id && (
                    <PlanAccionTema tema={t} lista={tareasDeTema(t.id)} nombreDe={nombreDe} usuariosDerivables={usuariosDerivables} cuId={cu.id}
                      planAdd={planAdd} setPlanAdd={setPlanAdd} busy={planBusy} chkMap={chkMap}
                      onCrear={() => crearTareaCompromiso(t)}
                      onCompletar={tt => avanceRapido(tt, "completada")} onAvisar={enviarAsignacion}
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
              {objetivos.filter(o => o.estado === "activo").length > 0 && (
                <select value={t.objetivo_id || ""} onChange={e => updTema(i, "objetivo_id", e.target.value)} style={{ ...css.select, padding: "8px 12px", fontSize: 13, gridColumn: isMobile ? "auto" : "1 / -1" }}>
                  <option value="">— Sin meta de empresa asociada —</option>
                  {objetivos.filter(o => o.estado === "activo").map(o => <option key={o.id} value={o.id}>🧭 {o.nombre}</option>)}
                </select>
              )}
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

      {/* ═══ ELIMINAR TAREA ═══ */}
      <Sheet show={!!elimTarea} onClose={() => setElimTarea(null)} title="Eliminar tarea">
        {elimTarea && (
          <>
            <div style={{ background: "#FDEAEA", borderRadius: 10, padding: "11px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#A32D2D" }}>{elimTarea.titulo}</div>
              <div style={{ fontSize: 11.5, color: "#A32D2D", opacity: 0.85, marginTop: 3 }}>
                {elimTarea.responsable_id ? "Responsable: " + nombreDe(elimTarea.responsable_id) : "Sin responsable"}
                {tareas.filter(x => x.tarea_padre_id === elimTarea.id).length > 0 ? " · arrastra " + tareas.filter(x => x.tarea_padre_id === elimTarea.id).length + " subtarea(s)" : ""}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 12, lineHeight: 1.5 }}>
              Queda archivada con tu nombre, la fecha y el motivo. El avance del proyecto se recalcula sin ella.
            </div>
            <Fl l="Motivo de la eliminación" req>
              <textarea value={elimTareaMotivo} onChange={e => setElimTareaMotivo(e.target.value)} rows={3} placeholder="Ej: duplicada · ya no aplica tras el cambio de alcance" style={{ ...css.input, resize: "vertical" }} autoFocus />
            </Fl>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <Bt v="gry" full onClick={() => setElimTarea(null)}>Cancelar</Bt>
              <button onClick={eliminarTarea} disabled={!elimTareaMotivo.trim() || elimBusy}
                style={{ flex: 1, padding: "11px 16px", borderRadius: 10, border: "none", background: (!elimTareaMotivo.trim() || elimBusy) ? "#e8b4b4" : "#A32D2D", color: "#fff", fontSize: 14, fontWeight: 700, cursor: (!elimTareaMotivo.trim() || elimBusy) ? "not-allowed" : "pointer" }}>
                {elimBusy ? "..." : "Eliminar tarea"}
              </button>
            </div>
          </>
        )}
      </Sheet>

      {/* ═══ ELIMINAR PUNTO ═══ */}
      <Sheet show={!!elimTema} onClose={() => setElimTema(null)} title="Eliminar punto del acta">
        {elimTema && (
          <>
            <div style={{ background: "#FDEAEA", borderRadius: 10, padding: "11px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#A32D2D" }}>{elimTema.tema || elimTema.acuerdo}</div>
              <div style={{ fontSize: 11.5, color: "#A32D2D", opacity: 0.85, marginTop: 3 }}>
                {elimTema.responsable_id ? "Responsable: " + nombreDe(elimTema.responsable_id) : "Sin responsable"}
                {tareas.filter(x => x.tema_id === elimTema.id).length > 0 ? " · se eliminarán también sus " + tareas.filter(x => x.tema_id === elimTema.id).length + " tarea(s) del plan" : ""}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 12, lineHeight: 1.5 }}>
              El punto sale de la vista, pero <strong>no se destruye</strong>: queda archivado con tu nombre, la fecha y el motivo, visible en la bitácora de eliminaciones. Los compromisos de directorio son trazables.
            </div>
            <Fl l="Motivo de la eliminación" req>
              <textarea value={elimMotivo} onChange={e => setElimMotivo(e.target.value)} rows={3} placeholder="Ej: duplicado del punto 4 · quedó sin sentido tras la decisión del 05/08" style={{ ...css.input, resize: "vertical" }} autoFocus />
            </Fl>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <Bt v="gry" full onClick={() => setElimTema(null)}>Cancelar</Bt>
              <button onClick={eliminarTema} disabled={!elimMotivo.trim() || elimBusy} style={{ flex: 1, padding: "11px 16px", borderRadius: 10, border: "none", background: (!elimMotivo.trim() || elimBusy) ? "#e8b4b4" : "#A32D2D", color: "#fff", fontSize: 14, fontWeight: 700, cursor: (!elimMotivo.trim() || elimBusy) ? "not-allowed" : "pointer" }}>{elimBusy ? "..." : "Eliminar punto"}</button>
            </div>
          </>
        )}
      </Sheet>

      {/* ═══ BITÁCORA DE ELIMINACIONES ═══ */}
      <Sheet show={verElim} onClose={() => setVerElim(false)} title="Bitácora de eliminaciones">
        <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 12 }}>Todo lo eliminado queda aquí: qué era, de quién, quién lo borró y por qué.</div>
        {!elimLog.length && <div style={{ fontSize: 13, color: "#AEAEB2", padding: "16px 0" }}>No hay eliminaciones registradas.</div>}
        {elimLog.map(e => (
          <div key={e.id} style={{ borderTop: "1px solid #f0f1f5", padding: "10px 0" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1C1C1E" }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: "#A32D2D", background: "#FDEAEA", borderRadius: 5, padding: "1px 6px", marginRight: 7, textTransform: "uppercase" }}>{e.entidad}</span>
              {e.titulo || "(sin título)"}
            </div>
            <div style={{ fontSize: 11.5, color: "#8E8E93", marginTop: 3 }}>
              {e.contexto ? e.contexto + " · " : ""}{e.responsable ? "era de " + e.responsable + " · " : ""}borrado por {nombreDe(e.eliminado_por)} el {fFecha(String(e.created_at).slice(0, 10))}
            </div>
            <div style={{ fontSize: 12, color: "#3A3A3C", marginTop: 4, fontStyle: "italic" }}>“{e.motivo}”</div>
            {esGlobal && !String(e.titulo || "").startsWith("↩") && (
              e.activo
                ? <span style={{ display: "inline-block", marginTop: 6, fontSize: 11, fontWeight: 700, color: "#27500A", background: "#E1F5EE", borderRadius: 999, padding: "2px 10px" }}>✓ ya restaurado / activo</span>
                : <button onClick={() => restaurar(e)} disabled={restBusy === e.id} style={{ marginTop: 6, border: "1px solid #cfd6e6", background: "#fff", borderRadius: 8, padding: "4px 11px", fontSize: 11.5, color: NAVY, cursor: "pointer", fontWeight: 700 }}>{restBusy === e.id ? "Restaurando..." : "↩ Restaurar"}</button>
            )}
          </div>
        ))}
      </Sheet>

      {/* ═══ REPROGRAMAR COMPROMISO ═══ */}
      <Sheet show={!!reprog} onClose={() => setReprog(null)} title="Reprogramar plazo">
        {reprog && (
          <>
            <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "10px 13px", marginBottom: 14 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1C1C1E" }}>{reprog.tema || reprog.acuerdo}</div>
              <div style={{ fontSize: 11.5, color: "#8E8E93", marginTop: 3 }}>
                Plazo actual: {fFecha(reprog.fecha_compromiso)}
                {reprog.fecha_original && reprog.fecha_original !== reprog.fecha_compromiso ? " · original: " + fFecha(reprog.fecha_original) : ""}
                {(reprog.reprogramaciones || 0) > 0 ? " · ya reprogramado " + reprog.reprogramaciones + " vez(ces)" : ""}
              </div>
            </div>
            {(reprog.reprogramaciones || 0) >= 1 && (
              <div style={{ background: "#FDEAEA", color: "#A32D2D", borderRadius: 10, padding: "9px 13px", marginBottom: 12, fontSize: 12, fontWeight: 600, lineHeight: 1.45 }}>
                ⚠ Este compromiso ya se movió {reprog.reprogramaciones} vez(ces). Con 2 reprogramaciones vencidas, el sistema lo escala automáticamente a la jefatura.
              </div>
            )}
            <Fl l="Nueva fecha" req>
              <input type="date" value={reprogForm.fecha} onChange={e => setReprogForm(f => ({ ...f, fecha: e.target.value }))} style={css.input} />
            </Fl>
            <Fl l="¿Por qué se mueve? (queda en la traza)" req>
              <textarea value={reprogForm.motivo} onChange={e => setReprogForm(f => ({ ...f, motivo: e.target.value }))} rows={3} placeholder="Ej: el proveedor confirmó entrega para la semana siguiente" style={{ ...css.input, resize: "vertical" }} />
            </Fl>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <Bt v="gry" full onClick={() => setReprog(null)}>Cancelar</Bt>
              <Bt v="pri" full dis={!reprogForm.fecha || !reprogForm.motivo.trim() || reprogBusy} onClick={guardarReprog}>{reprogBusy ? "..." : "Reprogramar"}</Bt>
            </div>
          </>
        )}
      </Sheet>

      {/* ═══ MANUAL OPERATIVO ═══ */}
      <FullSheet show={showAyuda} onClose={() => setShowAyuda(false)} title="Manual operativo — cómo trabajamos">
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {[["flujo", "▶ El flujo de trabajo"], ["conceptos", "📖 Conceptos"], ["pestanas", "🧩 Qué hace cada pestaña"]].map(([k, l]) => (
            <button key={k} onClick={() => setAyudaSec(k)} style={{ border: "none", cursor: "pointer", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 700, background: ayudaSec === k ? NAVY : "#eef0f7", color: ayudaSec === k ? "#fff" : "#5F5E5A" }}>{l}</button>
          ))}
        </div>

        {ayudaSec === "flujo" && (
          <>
            <div style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.55, marginBottom: 16, maxWidth: 760 }}>
              La app implementa el modelo de gestión que aprobamos: <strong>el Directorio gobierna, los comités operan, y todo compromiso tiene dueño, fecha y seguimiento automático</strong>. Este es el ciclo completo:
            </div>
            {AYUDA_FLUJO.map((f, i) => (
              <div key={f.n} style={{ display: "flex", gap: 14, marginBottom: 4 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: 34, height: 34, borderRadius: 999, background: NAVY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, flexShrink: 0 }}>{f.n}</div>
                  {i < AYUDA_FLUJO.length - 1 && <div style={{ width: 2, flex: 1, background: "#dfe3ef", minHeight: 22 }} />}
                </div>
                <div style={{ paddingBottom: 16, maxWidth: 720 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#1C1C1E" }}>{f.t}</div>
                  <div style={{ fontSize: 13, color: "#5F5E5A", lineHeight: 1.55, marginTop: 3 }}>{f.d}</div>
                </div>
              </div>
            ))}
            <div style={{ background: "#16213e", borderRadius: 12, padding: "14px 18px", marginTop: 8, maxWidth: 770 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#f0b25a", letterSpacing: "0.06em", marginBottom: 5 }}>LAS 5 REGLAS DEL JUEGO</div>
              <div style={{ fontSize: 12.5, color: "#eef1f8", lineHeight: 1.7 }}>
                1 · Los plazos se comprometen, no se estiman. &nbsp; 2 · La cadencia es innegociable. &nbsp; 3 · El escalamiento es procedimiento, no delación. &nbsp; 4 · Lo que no está en el acta no existe. &nbsp; 5 · Si tiene responsable y fecha, va a un comité.
              </div>
            </div>
          </>
        )}

        {ayudaSec === "conceptos" && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, maxWidth: 980 }}>
            {AYUDA_CONCEPTOS.map(([t, d]) => (
              <div key={t} style={{ background: "#f8f9fc", borderRadius: 10, padding: "11px 14px", border: "1px solid #eceef3" }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: NAVY }}>{t}</div>
                <div style={{ fontSize: 12.5, color: "#5F5E5A", lineHeight: 1.5, marginTop: 3 }}>{d}</div>
              </div>
            ))}
          </div>
        )}

        {ayudaSec === "pestanas" && (
          <div style={{ maxWidth: 780 }}>
            {AYUDA_TABS.map(([t, d]) => (
              <div key={t} style={{ display: "flex", gap: 12, padding: "11px 0", borderBottom: "1px solid #f0f1f5" }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: "#1C1C1E", minWidth: 150 }}>{t}</div>
                <div style={{ fontSize: 12.5, color: "#5F5E5A", lineHeight: 1.5, flex: 1 }}>{d}</div>
              </div>
            ))}
            <div style={{ fontSize: 12, color: "#8E8E93", marginTop: 14, fontStyle: "italic" }}>
              Los avisos 💡 de cada pestaña se pueden ocultar con ✕ y este manual queda siempre disponible en el botón "?" de la cabecera.
            </div>
          </div>
        )}
      </FullSheet>

      {/* ═══ NUEVA / EDITAR META ═══ */}
      <Sheet show={showObj} onClose={() => setShowObj(false)} title={objEdit ? "Editar meta" : "Nueva meta de empresa"}>
        <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 12, lineHeight: 1.5 }}>
          Formúlala como <strong>"de X a Y para cuándo"</strong>. Pocas, medibles y con dueño: si tienes más de 5 activas, ninguna es crucial.
        </div>
        <Fl l="Nombre de la meta" req>
          <input value={objForm.nombre} onChange={e => setObjForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Exactitud de inventario a 70%" style={css.input} />
        </Fl>
        <Fl l="Indicador que se mide">
          <input value={objForm.indicador} onChange={e => setObjForm(f => ({ ...f, indicador: e.target.value }))} placeholder="Ej: Exactitud de Registro de Inventario (ERI)" style={css.input} />
        </Fl>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap: 12 }}>
          <Fl l="Desde (X)"><input type="number" value={objForm.valor_inicial} onChange={e => setObjForm(f => ({ ...f, valor_inicial: e.target.value }))} style={css.input} /></Fl>
          <Fl l="Hasta (Y)" req><input type="number" value={objForm.valor_meta} onChange={e => setObjForm(f => ({ ...f, valor_meta: e.target.value }))} style={css.input} /></Fl>
          <Fl l="Unidad">
            <select value={objForm.unidad} onChange={e => setObjForm(f => ({ ...f, unidad: e.target.value }))} style={css.select}>
              {OBJ_UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </Fl>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Fl l="Desde fecha"><input type="date" value={objForm.fecha_inicio} onChange={e => setObjForm(f => ({ ...f, fecha_inicio: e.target.value }))} style={css.input} /></Fl>
          <Fl l="Fecha meta" req><input type="date" value={objForm.fecha_meta} onChange={e => setObjForm(f => ({ ...f, fecha_meta: e.target.value }))} style={css.input} /></Fl>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Fl l="Responsable de la meta">
            <select value={objForm.responsable_id} onChange={e => setObjForm(f => ({ ...f, responsable_id: e.target.value }))} style={css.select}>
              <option value="">— Selecciona —</option>
              {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre || u.correo}</option>)}
            </select>
          </Fl>
          <Fl l="Área">
            <select value={objForm.area} onChange={e => setObjForm(f => ({ ...f, area: e.target.value }))} style={css.select}>
              {Object.keys(AREAS).map(k => <option key={k} value={k}>{AREAS[k].l}</option>)}
            </select>
          </Fl>
        </div>
        {objEdit && (
          <Fl l="Estado de la meta">
            <select value={objForm.estado} onChange={e => setObjForm(f => ({ ...f, estado: e.target.value }))} style={css.select}>
              {Object.keys(OBJ_ESTADOS).map(k => <option key={k} value={k}>{OBJ_ESTADOS[k].l}</option>)}
            </select>
          </Fl>
        )}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Fl l="Cadencia de medición">
            <select value={objForm.frecuencia_dias} onChange={e => setObjForm(f => ({ ...f, frecuencia_dias: e.target.value }))} style={css.select}>
              {OBJ_FREQ.map(x => <option key={x.v} value={x.v}>{x.l} (cada {x.v} d)</option>)}
            </select>
          </Fl>
          <Fl l="Alcance">
            <select value={objForm.alcance} onChange={e => setObjForm(f => ({ ...f, alcance: e.target.value }))} style={css.select}>
              {Object.entries(OBJ_ALCANCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Fl>
        </div>
        <Fl l="Fuente del dato (¿de dónde sale el número?)">
          <input value={objForm.fuente_dato} onChange={e => setObjForm(f => ({ ...f, fuente_dato: e.target.value }))} placeholder="Ej: inventario cíclico · módulo SW" style={css.input} />
        </Fl>
        <Fl l="Contexto (opcional)">
          <textarea value={objForm.descripcion} onChange={e => setObjForm(f => ({ ...f, descripcion: e.target.value }))} rows={2} placeholder="¿De dónde viene esta meta? ¿Por qué es crucial?" style={{ ...css.input, resize: "vertical" }} />
        </Fl>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Bt v="gry" full onClick={() => setShowObj(false)}>Cancelar</Bt>
          <Bt v="pri" full dis={objBusy} onClick={guardarObjetivo}>{objBusy ? "Guardando..." : (objEdit ? "Guardar cambios" : "Crear meta")}</Bt>
        </div>
      </Sheet>

      {/* ═══ REGISTRAR MEDICIÓN ═══ */}
      <Sheet show={!!showMedir} onClose={() => setShowMedir(null)} title="Registrar medición">
        {showMedir && (
          <>
            <div style={{ background: "#f8f9fc", borderRadius: 10, padding: "10px 13px", marginBottom: 14 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1C1C1E" }}>{showMedir.nombre}</div>
              <div style={{ fontSize: 11.5, color: "#8E8E93", marginTop: 2 }}>{showMedir.indicador || "Indicador"} · meta {showMedir.valor_meta}{showMedir.unidad === "%" ? "%" : " " + (showMedir.unidad || "")} al {fFecha(showMedir.fecha_meta)}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Fl l={"Valor actual (" + (showMedir.unidad || "%") + ")"} req>
                <input type="number" value={medForm.valor} onChange={e => setMedForm(f => ({ ...f, valor: e.target.value }))} style={css.input} autoFocus />
              </Fl>
              <Fl l="Fecha"><input type="date" value={medForm.fecha} onChange={e => setMedForm(f => ({ ...f, fecha: e.target.value }))} style={css.input} /></Fl>
            </div>
            <Fl l="Nota (opcional)">
              <input value={medForm.nota} onChange={e => setMedForm(f => ({ ...f, nota: e.target.value }))} placeholder="Ej: conteo cíclico de cerraduras" style={css.input} />
            </Fl>
            <Fl l="Respaldo del dato (planilla, informe, N° de conteo)">
              <input value={medForm.evidencia} onChange={e => setMedForm(f => ({ ...f, evidencia: e.target.value }))} placeholder="Ej: informe SW 12-08 · conteo #34" style={css.input} />
            </Fl>
            {!showMedir.baseline_validado && (
              <div style={{ fontSize: 11.5, color: "#0C447C", background: "#E6F1FB", borderRadius: 9, padding: "8px 12px", marginBottom: 12, lineHeight: 1.45 }}>
                ℹ Esta meta aún no tiene línea base validada. Este primer registro la establece: usa el valor real medido, no una estimación.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <Bt v="gry" full onClick={() => setShowMedir(null)}>Cancelar</Bt>
              <Bt v="pri" full dis={medForm.valor === "" || objBusy} onClick={guardarMedicion}>{objBusy ? "..." : "Registrar medición"}</Bt>
            </div>
          </>
        )}
      </Sheet>

      {/* ═══ TAREA RÁPIDA ═══ */}
      <Sheet show={showRapidaMia} onClose={() => setShowRapidaMia(false)} title="Nueva tarea rápida">
        <Fl l="¿Qué hay que hacer?" req>
          <input value={rmForm.titulo} onChange={e => setRmForm(f => ({ ...f, titulo: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") guardarRapidaMia() }} placeholder="Ej: Enviar correo con fecha de inventario" style={css.input} autoFocus />
        </Fl>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          <Fl l="Responsable">
            <select value={rmForm.resp} onChange={e => setRmForm(f => ({ ...f, resp: e.target.value }))} style={css.select}>
              <option value="">Yo ({cu.nombre || cu.id})</option>
              {usuariosDerivables.filter(u => u.id !== cu.id).map(u => <option key={u.id} value={u.id}>{u.nombre || u.correo}</option>)}
            </select>
          </Fl>
          <Fl l="Vence">
            <input type="date" value={rmForm.fecha} onChange={e => setRmForm(f => ({ ...f, fecha: e.target.value }))} style={css.input} />
          </Fl>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Bt v="gry" full onClick={() => setShowRapidaMia(false)}>Cancelar</Bt>
          <Bt v="pri" full dis={!rmForm.titulo.trim() || rmBusy} onClick={guardarRapidaMia}>{rmBusy ? "Creando..." : "Crear tarea"}</Bt>
        </div>
      </Sheet>

      {/* ═══ IMPORTAR ACTA GEMINI ═══ */}
      <Sheet show={showImport} onClose={() => setShowImport(false)} title="Importar acta de Gemini">
        <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 12, lineHeight: 1.5 }}>
          Sube el <strong>.docx</strong> que genera Gemini en Meet. La app detecta título, fecha, asistentes, resumen y convierte los <strong>"Próximos pasos"</strong> en compromisos. <strong>Revisarás y ajustarás todo antes de guardar.</strong>
        </div>
        <Fl l="Archivo del acta (.docx)">
          <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e => setImportFile(e.target.files?.[0] || null)} style={{ ...css.input, padding: "9px 12px" }} />
          {importFile && <div style={{ fontSize: 11, color: "#3B6D11", marginTop: 5 }}>✓ {importFile.name} ({Math.round(importFile.size / 1024)} KB)</div>}
        </Fl>
        <details style={{ marginBottom: 12 }}>
          <summary style={{ fontSize: 12, color: "#185FA5", cursor: "pointer" }}>…o pega el texto si el archivo falla</summary>
          <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={5} placeholder="Pega aquí el contenido del acta de Gemini..." style={{ ...css.input, resize: "vertical", marginTop: 6 }} />
        </details>
        <Fl l="¿Encadenar a una serie existente? (opcional)">
          <select value={importSerie} onChange={e => setImportSerie(e.target.value)} style={css.select}>
            <option value="">— Acta suelta (reunión nueva) —</option>
            {reuVis.map(r => <option key={r.id} value={r.id}>Nueva sesión tras: {r.titulo} · {fFecha(r.fecha)}</option>)}
          </select>
        </Fl>
        {importErr && <div style={{ fontSize: 12, color: "#A32D2D", background: "#FDEAEA", borderRadius: 9, padding: "8px 12px", marginBottom: 10 }}>⚠ {importErr}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <Bt v="gry" full onClick={() => setShowImport(false)}>Cancelar</Bt>
          <Bt v="pri" full dis={(!importFile && !importText.trim()) || importBusy} onClick={parsearImport}>{importBusy ? "Interpretando..." : "Interpretar acta"}</Bt>
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
function ReunionesPanel({ reuniones, temas, tareas, nombreDe, nombreProy, isMobile, loading, puedeCrear, estadoTema, onNueva, onAbrir, onImportar }) {
  const compromisos = temas.filter(t => t.responsable_id)
  const cumplidos = compromisos.filter(t => estadoTema(t) === "cumplido")
  const seguibles = compromisos.filter(t => !["aprobada", "permanente"].includes(estadoTema(t)))
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
        <div style={{ display: "flex", gap: 6 }}>
          {puedeCrear && <Bt v="gry" sm ic="⬆" onClick={onImportar}>Importar (Gemini)</Bt>}
          {puedeCrear && <Bt v="pri" sm ic="➕" onClick={onNueva}>Nueva reunión</Bt>}
        </div>
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
    if (TEMA_CERRADOS.includes(est)) return false
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
  const seguibles = todos.filter(t => !["aprobada", "permanente"].includes(estadoTema(t))).length
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
                  const cerrado = TEMA_CERRADOS.includes(est)
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
function PlanAccionTema({ tema, lista, nombreDe, usuariosDerivables, cuId, planAdd, setPlanAdd, busy, chkMap, onCrear, onCompletar, onAbrir, planListo, onCumplir, onAvisar }) {
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
          {t.responsable_id && t.responsable_id !== cuId && onAvisar && (
            <button onClick={() => onAvisar(t)} title="Avisar por correo y agendar" style={{ width: 24, height: 24, borderRadius: 6, background: "#eef1f8", border: "none", cursor: "pointer", fontSize: 11, color: NAVY, flexShrink: 0 }}>📧</button>
          )}
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


/* ═══ PARSER DETERMINISTA DE ACTAS DE GEMINI ═══ */
const MESES_ES = { ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,set:9,oct:10,nov:11,dic:12,
  enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12 }
function normTxt(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() }
function parseFechaActa(t) {
  let m = t.match(/(\d{1,2})\s+de\s+([a-zA-Zá\u00e9í\u00f3ú]+)\s+de\s+(\d{4})/i)
  if (m) { const mes = MESES_ES[normTxt(m[2])]; if (mes) return m[3] + "-" + String(mes).padStart(2, "0") + "-" + String(+m[1]).padStart(2, "0") }
  m = t.match(/([a-zA-Zá\u00e9í\u00f3ú]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/i)
  if (m) { const mes = MESES_ES[normTxt(m[1])]; if (mes) return m[3] + "-" + String(mes).padStart(2, "0") + "-" + String(+m[2]).padStart(2, "0") }
  return ""
}
function parseActaGemini(texto) {
  const lines = texto.split(/\r?\n/).map(l => l.replace(/^\s*[-*\u2022]\s*/, "").trim()).filter(Boolean)
  const idxDe = re => lines.findIndex(l => re.test(normTxt(l)))
  const iRes = idxDe(/^resumen$/)
  const iPas = idxDe(/^proximos pasos$/)
  const iDet = idxDe(/^detalles$/)
  let fecha = ""
  for (const l of lines.slice(0, 6)) { const f = parseFechaActa(l); if (f) { fecha = f; break } }
  let titulo = ""
  for (const l of lines) {
    const n = normTxt(l)
    if (parseFechaActa(l)) continue
    if (/^(invitad|archivos adjuntos|registros de la reunion|resumen|proximos pasos|detalles|transcripcion)/.test(n)) continue
    if (l.length < 6) continue
    titulo = l.replace(/\s+/g, " ").trim(); break
  }
  let invitadosRaw = ""
  const li = lines.find(l => /^invitad/i.test(normTxt(l)))
  if (li) invitadosRaw = li.replace(/^invitad[oa]s?/i, "").trim()
  let resumen = ""
  if (iRes >= 0) { const fin = iPas >= 0 ? iPas : (iDet >= 0 ? iDet : lines.length); resumen = lines.slice(iRes + 1, fin).join("\n").slice(0, 1400) }
  const pasos = []
  if (iPas >= 0) {
    const fin = iDet >= 0 ? iDet : lines.length
    for (const l of lines.slice(iPas + 1, fin)) {
      const s = l.trim(); if (!s) continue
      const mb = s.match(/^\[([^\]]+)\]\s*(.+)$/)
      let responsableBracket = "", cuerpo = s
      if (mb) { responsableBracket = mb[1].trim(); cuerpo = mb[2].trim() }
      const ci = cuerpo.indexOf(":")
      let raw = cuerpo, desc = ""
      if (ci > 0 && ci < 90) { raw = cuerpo.slice(0, ci).trim(); desc = cuerpo.slice(ci + 1).trim() }
      pasos.push({ responsableBracket, raw, desc })
    }
  }
  return { titulo, fecha, invitadosRaw, resumen, pasos }
}


/* ═══ MI SEMANA — la pantalla diaria de cada persona (móvil primero) ═══ */
function MiSemanaPanel({ cu, isMobile, loading, grupos, compromisos, entregablesRev, agenda, agendaTareas, agendaMsg, gcalOn, nombreDe, nombreProy, reuniones, avMap, diasDesde, estadoTema, vencidoTema, diasAbiertoTema, chkMap, onCompletar, onAbrirTarea, onAvanceComp, onRevisarEnt, onNueva }) {
  const h = hoy()
  const hora0 = new Date().getHours()
  const saludo = hora0 < 12 ? "Buenos días" : hora0 < 20 ? "Buenas tardes" : "Buenas noches"
  const fechaLarga = new Date(h + "T00:00:00").toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })
  const totalHoy = grupos.vencido.length + grupos.hoy.length
  const quietos = compromisos.filter(t => {
    if (TEMA_CERRADOS.includes(estadoTema(t))) return false
    const a = avMap[t.id], org = reuniones.find(x => x.id === t.reunion_id)
    const d = a?.ult ? diasDesde(a.ult) : diasAbiertoTema(t, org?.fecha)
    return d !== null && d >= 14
  }).length

  const irA = id => { try { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }) } catch (e) { } }
  const Chip = ({ n, l, c, bg, go }) => (
    <div onClick={go ? () => irA(go) : undefined} title={go ? "Ver la lista" : undefined}
      style={{ flex: "1 1 90px", background: bg, borderRadius: 12, padding: "10px 12px", minWidth: 84, cursor: go ? "pointer" : "default", transition: "transform .12s", border: "1px solid transparent" }}
      onMouseEnter={e => { if (go) e.currentTarget.style.transform = "translateY(-2px)" }}
      onMouseLeave={e => { e.currentTarget.style.transform = "none" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: c, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 10.5, color: c, opacity: 0.85, fontWeight: 600, marginTop: 3 }}>{l}{go ? " ↓" : ""}</div>
    </div>
  )

  const TareaRow = ({ t, tono }) => {
    const chk = chkMap && chkMap[t.id]
    const ctx = t.proyecto_id ? nombreProy(t.proyecto_id) : (t.tema_id ? "🗓 Compromiso de acta" : "Tarea propia")
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderTop: "1px solid #f0f1f5" }}>
        <button onClick={() => onCompletar(t)} title="Completar" style={{ width: 30, height: 30, borderRadius: 9, border: "2px solid #c3c9d9", background: "#fff", cursor: "pointer", fontSize: 13, color: "#34C759", flexShrink: 0, fontWeight: 800 }}>✓</button>
        <div style={{ flex: 1, minWidth: 0 }} onClick={() => onAbrirTarea(t)}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1C1C1E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {(t.es_hito ? "◆ " : "") + t.titulo}
            {chk && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: chk.done === chk.tot ? "#3B6D11" : "#854F0B" }}>✔ {chk.done}/{chk.tot}</span>}
          </div>
          <div style={{ fontSize: 11, color: tono || "#AEAEB2", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ctx}{t.fecha_vencimiento ? " · " + fFecha(t.fecha_vencimiento) : ""}
          </div>
        </div>
        <button onClick={() => onAbrirTarea(t)} title="Abrir" style={{ width: 30, height: 30, borderRadius: 9, background: "#f4f5f9", border: "none", cursor: "pointer", fontSize: 13, color: NAVY, flexShrink: 0 }}>✎</button>
      </div>
    )
  }

  const Bloque = ({ titulo, items, color, bg, vacio }) => {
    if (!items.length) return vacio ? <div style={{ fontSize: 12.5, color: "#AEAEB2", padding: "10px 2px" }}>{vacio}</div> : null
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: "0.03em" }}>{titulo}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color, background: bg, borderRadius: 999, padding: "1px 8px" }}>{items.length}</span>
        </div>
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
          {items.map(t => <TareaRow key={t.id} t={t} tono={color === "#A32D2D" ? "#A32D2D" : undefined} />)}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Cabecera personal */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: isMobile ? 19 : 23, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.02em" }}>{saludo}, {(cu.nombre || "").split(" ")[0] || "equipo"}</div>
        <div style={{ fontSize: 12.5, color: "#8E8E93", textTransform: "capitalize" }}>{fechaLarga}</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <Chip n={grupos.vencido.length} l="Vencidas" c="#A32D2D" bg="#FDEAEA" go="sec-vencidas" />
        <Chip n={grupos.hoy.length} l="Vencen hoy" c="#854F0B" bg="#fdf3e6" go="sec-hoy" />
        <Chip n={grupos.semana.length} l="Esta semana" c="#0C447C" bg="#E6F1FB" go="sec-semana" />
        <Chip n={compromisos.length} l="Compromisos" c="#3C3489" bg="#EEEDFE" go="sec-compromisos" />
        {quietos > 0 && <Chip n={quietos} l="Sin movimiento" c="#854F0B" bg="#fdf3e6" go="sec-compromisos" />}
      </div>

      {/* Agenda real de Google */}
      {gcalOn && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#3A3A3C", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 6 }}>📆 Tu agenda de hoy</div>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
            {agenda === null && <div style={{ padding: "12px 14px", fontSize: 12.5, color: "#8E8E93" }}>Cargando tu agenda...</div>}
            {agenda !== null && !agenda.length && !(agendaTareas || []).length && <div style={{ padding: "12px 14px", fontSize: 12.5, color: "#AEAEB2" }}>{agendaMsg === "tasks_no_autorizado" ? "Sin eventos hoy en tu calendario." : (agendaMsg || "Sin eventos hoy en tu calendario.")}</div>}
            {(agenda || []).map((ev, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "10px 14px", borderTop: i ? "1px solid #f0f1f5" : "none", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: NAVY, minWidth: 46 }}>{ev.hora || "Día"}</span>
                <span style={{ flex: 1, fontSize: 13, color: "#1C1C1E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.titulo}</span>
                {ev.link && <a href={ev.link} target="_blank" rel="noreferrer" style={{ fontSize: 13, textDecoration: "none" }}>↗</a>}
              </div>
            ))}
            {(agendaTareas || []).map((tk, i) => (
              <div key={"gt" + i} style={{ display: "flex", gap: 12, padding: "10px 14px", borderTop: "1px solid #f0f1f5", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: tk.vencida ? "#A32D2D" : "#8E8E93", minWidth: 46, fontWeight: 700 }}>○ Tarea</span>
                <span style={{ flex: 1, fontSize: 13, color: "#1C1C1E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tk.titulo}
                  <span style={{ fontSize: 11, color: tk.vencida ? "#A32D2D" : "#AEAEB2", marginLeft: 7 }}>
                    {tk.lista ? tk.lista : ""}{tk.vence ? (tk.vencida ? " · venció " + fFecha(tk.vence) : " · vence hoy") : " · sin fecha"}
                  </span>
                </span>
                {tk.link && <a href={tk.link} target="_blank" rel="noreferrer" style={{ fontSize: 13, textDecoration: "none" }}>↗</a>}
              </div>
            ))}
            {agendaMsg === "tasks_no_autorizado" && (
              <div style={{ padding: "8px 14px", borderTop: "1px solid #f0f1f5", fontSize: 11, color: "#AEAEB2" }}>
                Las tareas de Google no están autorizadas todavía (falta el permiso de Tasks en la delegación de dominio).
              </div>
            )}
          </div>
        </div>
      )}

      {loading && <div style={{ textAlign: "center", padding: 30, color: "#8E8E93", fontSize: 13 }}>Cargando...</div>}

      <div id="sec-vencidas" /><Bloque titulo="⚠ Vencidas" items={grupos.vencido} color="#A32D2D" bg="#FDEAEA" />
      <div id="sec-hoy" /><Bloque titulo="Hoy" items={grupos.hoy} color="#854F0B" bg="#fdf3e6" />
      <div id="sec-semana" /><Bloque titulo="Esta semana" items={grupos.semana} color="#0C447C" bg="#E6F1FB" />
      <Bloque titulo="Más adelante" items={grupos.despues} color="#5F5E5A" bg="#F2F2F7" />
      <Bloque titulo="Sin fecha" items={grupos.sinfecha} color="#5F5E5A" bg="#F2F2F7" />

      {!loading && !grupos.vencido.length && !grupos.hoy.length && !grupos.semana.length && !grupos.despues.length && !grupos.sinfecha.length && (
        <div style={{ textAlign: "center", padding: "34px 20px", background: "#fff", borderRadius: 14, border: "1px solid #eceef3", marginBottom: 14 }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#3A3A3C" }}>No tienes tareas pendientes</div>
          <div style={{ fontSize: 12.5, color: "#8E8E93", marginTop: 4 }}>Usa el botón + para agregar una.</div>
        </div>
      )}

      <div id="sec-compromisos" />
      {/* Mis compromisos de acta */}
      {compromisos.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#3C3489", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 6 }}>🎯 Mis compromisos de acta</div>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
            {compromisos.map(t => {
              const org = reuniones.find(x => x.id === t.reunion_id)
              const a = avMap[t.id]
              const ultD = a?.ult ? diasDesde(a.ult) : null
              const abierto = diasAbiertoTema(t, org?.fecha)
              const quieto = (ultD === null ? abierto : ultD) >= 14
              const vc = vencidoTema(t)
              const ec = TEMA_ESTADOS[estadoTema(t)] || TEMA_ESTADOS.no_iniciado
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderTop: "1px solid #f0f1f5" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: ec.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1C1C1E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.tema || t.acuerdo}</div>
                    <div style={{ fontSize: 11, color: quieto || vc ? "#A32D2D" : "#AEAEB2", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ec.l}{vc ? " · vencido hace " + diasDesde(t.fecha_compromiso) + " d" : (t.fecha_compromiso ? " · plazo " + fFecha(t.fecha_compromiso) : "")}{quieto ? " · 🔕 sin movimiento" : (ultD !== null ? " · últ. avance hace " + ultD + " d" : "")}
                    </div>
                  </div>
                  <button onClick={() => onAvanceComp(t)} title="Registrar avance" style={{ padding: "7px 12px", borderRadius: 9, background: quieto ? "#A32D2D" : "#f4f5f9", border: "none", cursor: "pointer", fontSize: 12, color: quieto ? "#fff" : NAVY, flexShrink: 0, fontWeight: 700 }}>💬 Avance</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Entregables esperando mi aprobación */}
      {entregablesRev.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0C447C", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 6 }}>📎 Esperan tu revisión</div>
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", overflow: "hidden" }}>
            {entregablesRev.map(e => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderTop: "1px solid #f0f1f5" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1C1C1E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.nombre}</div>
                  <div style={{ fontSize: 11, color: "#AEAEB2" }}>{nombreProy(e.proyecto_id)} · entregó {nombreDe(e.entregado_por)}</div>
                </div>
                <Bt v="amb" sm onClick={() => onRevisarEnt(e)}>Revisar</Bt>
              </div>
            ))}
          </div>
        </div>
      )}

      {!gcalOn && (
        <div style={{ fontSize: 11.5, color: "#8E8E93", background: "#F2F2F7", borderRadius: 10, padding: "9px 12px", marginBottom: 60 }}>
          📆 La sincronización automática con Google Calendar está desactivada. Al activarla, tus tareas se agendan solas y verás aquí tu agenda del día.
        </div>
      )}
    </>
  )
}


/* ═══ OBJETIVOS — el marcador: ¿vamos ganando o perdiendo? ═══ */
const OBJ_SEM = {
  sin_medicion: { l: "Sin medición", c: "#5F5E5A", bg: "#F2F2F7", bar: "#C7C7CC", ic: "○" },
  ganando:   { l: "Vamos ganando",   c: "#27500A", bg: "#E1F5EE", bar: "#34C759", ic: "▲" },
  riesgo:    { l: "En riesgo",       c: "#854F0B", bg: "#fdf3e6", bar: "#FF9F0A", ic: "≈" },
  perdiendo: { l: "Vamos perdiendo", c: "#A32D2D", bg: "#FDEAEA", bar: "#E24B4A", ic: "▼" },
  vencido:   { l: "Plazo vencido",   c: "#A32D2D", bg: "#FDEAEA", bar: "#A32D2D", ic: "⚠" },
  logrado:   { l: "Meta lograda",    c: "#27500A", bg: "#E1F5EE", bar: "#34C759", ic: "✔" },
  pausado:   { l: "Pausada",         c: "#5F5E5A", bg: "#F2F2F7", bar: "#AEAEB2", ic: "❙❙" }
}
function ObjetivosPanel({ objetivos, objStats, vinculos, alineacion, mediciones, nombreDe, isMobile, loading, puedeEditar, puedeMedir, onAnular, cuId, onNueva, onEditar, onMedir }) {
  const activos = objetivos.filter(o => o.estado === "activo")
  const cerrados = objetivos.filter(o => o.estado !== "activo")
  const fmtVal = (v, u) => (u === "CLP" ? fmt(v) : (u === "%" ? v + "%" : v + " " + (u || "")))

  const Card = ({ o }) => {
    const st = objStats(o)
    const sem = OBJ_SEM[st.est] || OBJ_SEM.riesgo
    const v = vinculos[o.id] || { proy: 0, comp: 0, compCumpl: 0 }
    const meds = mediciones.filter(m => m.objetivo_id === o.id).slice(0, 6)
    return (
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #eceef3", padding: isMobile ? 14 : 18, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 190 }}>
            <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.01em" }}>{o.nombre}</div>
            <div style={{ fontSize: 11.5, color: "#8E8E93", marginTop: 3 }}>
              {o.indicador ? o.indicador + " · " : ""}de {fmtVal(st.ini, o.unidad)} a {fmtVal(st.meta, o.unidad)} · al {fFecha(o.fecha_meta)}
              {o.responsable_id ? " · 👤 " + nombreDe(o.responsable_id) : ""}
            </div>
          </div>
          <span style={{ background: sem.bg, color: sem.c, fontSize: 11.5, fontWeight: 800, borderRadius: 999, padding: "5px 12px", height: "fit-content", whiteSpace: "nowrap" }}>{sem.ic} {sem.l}</span>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: isMobile ? 29 : 37, fontWeight: 800, color: sem.c, lineHeight: 1, letterSpacing: "-0.03em" }}>{st.sinMedir ? "—" : fmtVal(st.act, o.unidad)}</div>
            <div style={{ fontSize: 10, color: "#AEAEB2", fontWeight: 700, marginTop: 3, letterSpacing: "0.04em" }}>
              {st.sinMedir ? "SIN MEDIR AÚN" : ((o.indicador || "VALOR").toUpperCase().slice(0, 22) + " HOY")}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 170 }}>
            <div style={{ position: "relative", height: 14, background: "#f0f1f5", borderRadius: 999 }}>
              <div style={{ width: st.pct + "%", height: "100%", background: sem.bar, borderRadius: 999, transition: "width .3s" }} />
              {st.est !== "logrado" && st.esperado > 0 && st.esperado < 100 && (
                <div title={"Deberíamos ir en " + st.esperado + "%"} style={{ position: "absolute", left: st.esperado + "%", top: -4, width: 2, height: 22, background: "#1C1C1E", opacity: 0.5 }} />
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10.5, color: "#8E8E93", marginTop: 5, flexWrap: "wrap" }}>
              <span><strong style={{ color: sem.c }}>{st.pct}%</strong> del camino</span>
              <span>esperado {st.esperado}%{st.est !== "logrado" && st.brecha !== 0 ? (st.brecha > 0 ? " (+" + st.brecha + ")" : " (" + st.brecha + ")") : ""}</span>
              <span>{st.diasRest >= 0 ? st.diasRest + " d restantes" : Math.abs(st.diasRest) + " d de atraso"}</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 11, marginTop: 6, borderTop: "1px dashed #eceef3" }}>
          <span style={{ fontSize: 11, color: "#5F5E5A", background: "#F2F2F7", borderRadius: 999, padding: "3px 10px", fontWeight: 600 }}>📋 {v.proy} proyecto(s)</span>
          <span style={{ fontSize: 11, color: "#5F5E5A", background: "#F2F2F7", borderRadius: 999, padding: "3px 10px", fontWeight: 600 }}>🎯 {v.comp} compromiso(s) abierto(s)</span>
          {v.compCumpl > 0 && <span style={{ fontSize: 11, color: "#27500A", background: "#E1F5EE", borderRadius: 999, padding: "3px 10px", fontWeight: 700 }}>✔ {v.compCumpl} cumplido(s)</span>}
          {v.proy + v.comp + v.compCumpl === 0 && <span style={{ fontSize: 11.5, color: "#A32D2D", fontWeight: 600 }}>⚠ Nada enganchado: nadie está empujando esta meta</span>}
          <span style={{ flex: 1 }} />
          {puedeMedir && puedeMedir(o)
            ? <Bt v="pri" sm onClick={() => onMedir(o)}>＋ Medición</Bt>
            : <span title="Solo el responsable de la meta puede medirla" style={{ fontSize: 11, color: "#AEAEB2", fontWeight: 600 }}>🔒 mide {(nombreDe(o.responsable_id) || "el responsable").split(" ")[0]}</span>}
          {puedeEditar && <Bt v="gry" sm onClick={() => onEditar(o)}>✎</Bt>}
        </div>

        {/* Gobierno del dato: cadencia, fuente y estado de la línea base */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 9, fontSize: 11, color: "#8E8E93" }}>
          <span>⏱ cadencia {st.cadencia} d</span>
          {st.medAtrasada && <span style={{ color: "#854F0B", fontWeight: 700 }}>⚠ medición atrasada ({st.sinMedir ? "nunca medida" : "hace " + st.diasSinMedir + " d"})</span>}
          {!st.medAtrasada && st.ultMed && <span>última medición {fFecha(st.ultMed)}</span>}
          {!o.baseline_validado && <span style={{ color: "#0C447C", fontWeight: 700 }}>ℹ línea base sin validar</span>}
          {o.fuente_dato && <span>📄 {o.fuente_dato}</span>}
          <span>🏷 {o.alcance === "sucursal" ? "sucursal" : o.alcance === "area" ? "área" : "empresa"}</span>
        </div>

        {meds.length > 0 && (
          <div style={{ marginTop: 10, borderTop: "1px dashed #f0f1f5", paddingTop: 8 }}>
            {meds.map(m => (
              <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 11, color: "#8E8E93", padding: "2px 0", textDecoration: m.anulada_en ? "line-through" : "none", opacity: m.anulada_en ? 0.6 : 1 }}>
                <strong style={{ color: "#3A3A3C", fontSize: 12 }}>{fmtVal(Number(m.valor), o.unidad)}</strong>
                <span>{fFecha(m.fecha)}</span>
                <span>· midió {nombreDe(m.autor_id)}</span>
                {m.evidencia && <span>· 📄 {m.evidencia}</span>}
                {m.nota && <span>· {m.nota}</span>}
                {m.anulada_en && <span style={{ color: "#A32D2D", fontWeight: 700 }}>· ANULADA: {m.anulada_motivo}</span>}
                {!m.anulada_en && puedeMedir && puedeMedir(o) && (
                  <button onClick={() => { const mo = window.prompt("¿Por qué se anula esta medición?"); if (mo) onAnular(m, mo) }} title="Anular medición errónea" style={{ border: "none", background: "transparent", color: "#A32D2D", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>anular</button>
                )}
              </div>
            ))}
          </div>
        )}
        {o.descripcion && <div style={{ fontSize: 11.5, color: "#8E8E93", marginTop: 9, lineHeight: 1.5 }}>{o.descripcion}</div>}
      </div>
    )
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 800, color: "#1C1C1E", letterSpacing: "-0.02em" }}>Metas de la empresa</div>
          <div style={{ fontSize: 12, color: "#8E8E93" }}>Pocas, medibles y con dueño. Todo lo que hacemos debería empujar una de estas.</div>
        </div>
        {puedeEditar && <Bt v="pri" sm ic="➕" onClick={onNueva}>Nueva meta</Bt>}
      </div>

      <div style={{ background: NAVY, borderRadius: 14, padding: isMobile ? 14 : 18, marginBottom: 16, color: "#eef1f8" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: alineacion.pct >= 60 ? "#7ed957" : alineacion.pct >= 30 ? "#f0b25a" : "#f2707a" }}>{alineacion.pct}%</div>
            <div style={{ fontSize: 10, color: "#9aa3bd", fontWeight: 700, marginTop: 4, letterSpacing: "0.04em" }}>{alineacion.propio ? "TU ALINEACIÓN" : "ALINEACIÓN"}</div>
          </div>
          <div style={{ flex: 1, minWidth: 210 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>
              {alineacion.propio
                ? "De tus " + alineacion.tot + " iniciativas activas, " + alineacion.ali + " empujan una meta"
                : alineacion.ali + " de " + alineacion.tot + " iniciativas de la empresa empujan una meta"}
            </div>
            <div style={{ fontSize: 11.5, color: "#9aa3bd", lineHeight: 1.5 }}>
              Sin meta asociada: {alineacion.proySin} proyecto(s) y {alineacion.compSin} compromiso(s).
              {alineacion.propio ? " Etiqueta tus compromisos a una meta para que tu trabajo cuente en el marcador." : " Eso es el torbellino: trabajo real que no mueve las metas del trimestre."}
            </div>
          </div>
        </div>
      </div>

      {loading && <div style={{ textAlign: "center", padding: 30, color: "#8E8E93", fontSize: 13 }}>Cargando...</div>}

      {!loading && !objetivos.length && (
        <div style={{ textAlign: "center", padding: "40px 24px", background: "#fff", borderRadius: 14, border: "1px solid #eceef3" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🧭</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#3A3A3C" }}>Aún no hay metas definidas</div>
          <div style={{ fontSize: 12.5, color: "#8E8E93", marginTop: 6, maxWidth: 430, margin: "6px auto 0", lineHeight: 1.55 }}>
            Define 3 a 5 metas para el trimestre en formato "de X a Y para cuándo". Ejemplo real salido de tus actas: <strong>exactitud de inventario de 50% a 70% al 16 de septiembre</strong>.
          </div>
          {puedeEditar && <div style={{ marginTop: 14 }}><Bt v="pri" onClick={onNueva}>Crear la primera meta</Bt></div>}
        </div>
      )}

      {activos.map(o => <Card key={o.id} o={o} />)}

      {cerrados.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#8E8E93", textTransform: "uppercase", letterSpacing: "0.03em", margin: "18px 0 8px" }}>Cerradas ({cerrados.length})</div>
          {cerrados.map(o => <Card key={o.id} o={o} />)}
        </>
      )}
    </>
  )
}
