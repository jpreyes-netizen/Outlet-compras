import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase, signOut } from '../supabase'
import { preloadCaps, canSync } from '../core/permisos'
import { deepLink } from '../core/deeplink'
import { DataGrid } from '../finanzas/conciliacion/DataGrid'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { PmoGestion } from '../proyectos/ProyectosApp'
import { Toaster, toast } from 'sonner'
import { LayoutDashboard, ClipboardList, CheckSquare, ShoppingCart, BarChart3, FolderKanban, Settings, LayoutGrid, LogOut, Plus, ArrowLeft } from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════════════
   COMPRAS OPERACIÓN — compras indirectas (insumos, aseo, herramientas, servicios)
   Flujo: Borrador → Pend. aprobación (N1 valida / N2 autoriza) → Aprobada → OC emitida
          → Recibida / Recibida con obs. → Cerrada (match con factura del libro)
   Todo cambio de estado va por RPC fn_cop_* (SECURITY DEFINER): el cliente solo
   edita borradores. Triggers en BD bloquean saltos de flujo y la bitácora es
   inmutable. Tablas propias cop_*; maestros compartidos: proveedores,
   sucursales, centros_costo, plan_cuentas, libro_compras.
   Estética: la misma de Finanzas — navy institucional, sidebar por dominios,
   densidad profesional, sin emojis.
   ═══════════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', NAVY_HOVER = '#1E2B50', NAVY_ACTIVE = '#25355F'
const INK = '#1C1C1E', SLATE = '#6E6E73', FONDO = '#F4F5F7', BORDE = '#E5E7EB'
const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', AZUL = '#175CD3'
const C1 = NAVY, C2 = NAVY_ACTIVE
const APP = 'compras_op'
const SIDEBAR_W = 232

const fmt = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL')
const fN = n => Math.round(Number(n) || 0).toLocaleString('es-CL')
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
const fFecha = s => { if (!s) return '—'; const d = String(s).slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}-${d[1]}-${d[0]}` : s }
const fFechaHora = s => s ? new Date(s).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const diasEntre = (a, b) => (a && b) ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000)) : null
const errMsg = e => String(e?.message || e || 'Error').replace(/^COP:\s*/, '')

const ESTADOS = {
  'Borrador':          { c: '#475467', bg: '#F2F4F7' },
  'Pend. aprobación':  { c: AMBAR, bg: '#FEF3C7' },
  'Aprobada':          { c: AZUL, bg: '#EFF8FF' },
  'OC emitida':        { c: NAVY, bg: '#E8EBF3' },
  'Recibida':          { c: VERDE, bg: '#ECFDF3' },
  'Recibida con obs.': { c: '#B54708', bg: '#FFF4E5' },
  'Cerrada':           { c: '#344054', bg: '#EAECF0' },
  'Rechazada':         { c: ROJO, bg: '#FEF3F2' },
  'Anulada':           { c: '#98A2B3', bg: '#F9FAFB' },
}
const ABIERTAS = ['Borrador', 'Pend. aprobación', 'Aprobada', 'OC emitida', 'Recibida', 'Recibida con obs.']
const URG = { normal: { l: 'Normal', c: SLATE }, alta: { l: 'Alta', c: AMBAR }, critica: { l: 'Crítica', c: ROJO } }
const ACCION_TXT = { enviar: 'Envió a aprobación', aprobar: 'Aprobó', rechazar: 'Rechazó', emitir_oc: 'Emitió OC', recibir: 'Registró recepción', cerrar: 'Cerró con factura', anular: 'Anuló', reabrir: 'Reabrió', reaprobacion: 'Volvió a aprobación' }
// Sucursal → sufijo del centro de costo (tabla centros_costo: 10X01 CD, 02 Maipú, 03 LA, 04 LG)
const SUF_CECO = { 'suc-mp': '01', 'suc-maipu': '02', 'suc-la': '03', 'suc-lg': '04' }

// Pago de la factura asociada: conciliada en banco = pagada
function estadoPago(s, pagos) {
  if (!s.factura_folio) return { t: '—', c: '#98A2B3' }
  const f = s.libro_compras_id ? pagos[s.libro_compras_id] : null
  if (!f) return { t: 'Sin libro', c: SLATE }
  if (f.movimiento_id || f.conciliado_at) return { t: 'Pagada', c: VERDE, b: true }
  if (f.fecha_vencimiento && f.fecha_vencimiento < hoy()) return { t: 'Vencida', c: ROJO, b: true }
  return { t: 'Por pagar', c: AMBAR }
}

/* ── UI mínima (mismo lenguaje visual que Finanzas) ─────────────────────── */
const st = {
  input: { width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: '1px solid #D0D5DD', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: INK },
  lbl: { fontSize: 11, color: SLATE, fontWeight: 600, marginBottom: 4, display: 'block' },
  card: { background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: 16 },
  seccion: { fontSize: 10.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
}
function Btn({ children, onClick, kind = 'pri', disabled, small, title }) {
  const k = {
    pri: { background: NAVY, color: '#fff', border: `1px solid ${NAVY}` },
    sec: { background: '#fff', color: INK, border: '1px solid #D0D5DD' },
    ok: { background: VERDE, color: '#fff', border: `1px solid ${VERDE}` },
    bad: { background: '#fff', color: ROJO, border: '1px solid #FDA29B' },
  }[kind]
  return <button title={title} disabled={disabled} onClick={onClick}
    style={{ ...k, padding: small ? '4px 10px' : '7px 14px', borderRadius: 6, fontSize: small ? 12 : 12.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>{children}</button>
}
function Estado({ e }) {
  const s = ESTADOS[e] || ESTADOS.Borrador
  return <span style={{ fontSize: 11, fontWeight: 700, color: s.c, background: s.bg, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>{e}</span>
}
function Campo({ label, children, span = 1 }) {
  return <div style={{ gridColumn: `span ${span}` }}><label style={st.lbl}>{label}</label>{children}</div>
}
// Tarjeta KPI tipo Finanzas: borde izquierdo semántico + cifra monoespaciada
function Kpi({ v, l, d, c = NAVY, warn, onClick }) {
  const col = warn ? AMBAR : c
  const Tag = onClick ? 'button' : 'div'
  return <Tag onClick={onClick} style={{ textAlign: 'left', background: '#fff', border: `1px solid ${BORDE}`, borderLeft: `4px solid ${col}`, borderRadius: 8, padding: '12px 14px', cursor: onClick ? 'pointer' : 'default', fontFamily: 'inherit' }}>
    <div style={{ fontSize: 11, color: SLATE, fontWeight: 600 }}>{l}</div>
    <div style={{ fontSize: 22, fontWeight: 700, color: col, fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>{v}</div>
    {d && <div style={{ fontSize: 10.5, color: SLATE }}>{d}</div>}
  </Tag>
}

/* ═══ APP ═════════════════════════════════════════════════════════════════ */
export function ComprasOpApp({ cu, setAppActual }) {
  const [capsOk, setCapsOk] = useState(false)
  const [tab, setTab] = useState(() => {
    if (deepLink?.app === APP && deepLink.modulo) return deepLink.modulo
    try { return localStorage.getItem('cop_tab') || 'inicio' } catch (e) { return 'inicio' }
  })
  const [sols, setSols] = useState([])
  const [cat, setCat] = useState({ categorias: [], reglas: [], sucursales: [], cecos: [], proveedores: [], cuentas: [] })
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState(null)
  const [selId, setSelId] = useState(() => (deepLink?.app === APP && deepLink.params?.sol) || null)
  const [editando, setEditando] = useState(null)   // null | 'nueva' | id
  const [pagos, setPagos] = useState({})           // libro_compras_id → factura (pago/conciliación)
  const [umbral, setUmbral] = useState(0)          // config_sistema.cop_umbral_caja_chica
  const [miDefault, setMiDefault] = useState(null) // cop_usuario_defaults: sucursal y centro de costo del usuario
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false)

  useEffect(() => { if (cu?.id) preloadCaps(cu, APP).then(() => setCapsOk(true)) }, [cu?.id])
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => { try { localStorage.setItem('cop_tab', tab) } catch (e) { } }, [tab])
  const can = useCallback(cap => capsOk && (canSync(cu, APP, cap) !== false || canSync(cu, APP, 'cop.admin') !== false), [capsOk, cu])

  const cargar = useCallback(async () => {
    setErr(null)
    try {
      const [s, c, r, su, cc, pr, pc] = await Promise.all([
        supabase.from('cop_solicitudes').select('*').is('deleted_at', null).order('created_at', { ascending: false }).limit(3000),
        supabase.from('cop_categorias').select('*').order('orden'),
        supabase.from('cop_reglas_aprobacion').select('*').order('nivel'),
        supabase.from('sucursales').select('id,nombre,activo,orden').order('orden'),
        supabase.from('centros_costo').select('codigo,nombre,activo').eq('activo', true).order('codigo'),
        supabase.from('proveedores').select('id,nombre,rut,correo,telefono,condicion_pago,activo').order('nombre'),
        supabase.from('plan_cuentas').select('codigo,nombre').eq('tipo_eeff', 'gasto').eq('acepta_movimientos', true).eq('activa', true).order('codigo'),
      ])
      for (const x of [s, c, r, su, cc, pr, pc]) if (x.error) throw x.error
      // Estado de pago de las facturas asociadas (libro de compras: movimiento_id / conciliado_at)
      const ids = [...new Set((s.data || []).map(x => x.libro_compras_id).filter(Boolean))]
      const pg = {}
      for (let i = 0; i < ids.length; i += 150) {
        const q = await supabase.from('libro_compras').select('id,folio,monto_total,fecha_vencimiento,movimiento_id,conciliado_at').in('id', ids.slice(i, i + 150))
        if (!q.error) (q.data || []).forEach(f => { pg[f.id] = f })
      }
      setPagos(pg)
      const u = await supabase.from('config_sistema').select('valor').eq('clave', 'cop_umbral_caja_chica').maybeSingle()
      setUmbral(Number(u.data?.valor) || 0)
      const d = await supabase.from('cop_usuario_defaults').select('sucursal_id,centro_costo_codigo').eq('usuario_id', cu.id).maybeSingle()
      setMiDefault(d.data || null)
      setSols(s.data || [])
      setCat({ categorias: c.data || [], reglas: r.data || [], sucursales: (su.data || []).filter(x => x.activo !== false), cecos: cc.data || [], proveedores: pr.data || [], cuentas: pc.data || [] })
    } catch (e) { setErr(errMsg(e)) } finally { setCargando(false) }
  }, [cu.id])
  useEffect(() => { cargar() }, [cargar])

  const provNom = useMemo(() => Object.fromEntries(cat.proveedores.map(p => [p.id, p.nombre])), [cat.proveedores])
  const sucNom = useMemo(() => Object.fromEntries(cat.sucursales.map(p => [p.id, p.nombre])), [cat.sucursales])
  const catNom = useMemo(() => Object.fromEntries(cat.categorias.map(p => [p.id, p.nombre])), [cat.categorias])
  const cecoNom = useMemo(() => Object.fromEntries(cat.cecos.map(p => [p.codigo, p.nombre])), [cat.cecos])
  const regla = n => cat.reglas.find(r => r.nivel === n)

  // ¿Puede este usuario firmar el siguiente nivel de s?
  const puedeFirmar = s => {
    if (s.estado !== 'Pend. aprobación') return false
    const r = regla(s.nivel_aprobado + 1)
    if (!r || !can(r.capability_id)) return false
    return s.solicitante_id !== cu.id || cu.rol === 'admin'
  }

  const mias = sols.filter(s => s.solicitante_id === cu.id)
  const misAbiertas = mias.filter(s => ABIERTAS.includes(s.estado))
  const porFirmar = sols.filter(puedeFirmar)
  const porComprar = sols.filter(s => s.estado === 'Aprobada')
  const ocCurso = sols.filter(s => s.estado === 'OC emitida')
  const porRecibir = sols.filter(s => s.estado === 'OC emitida' && (s.solicitante_id === cu.id || can('cop.recibir') || can('cop.gestionar')))
  const porCerrar = sols.filter(s => ['Recibida', 'Recibida con obs.'].includes(s.estado))

  /* ── Navegación por dominios (misma arquitectura que Finanzas) ── */
  const DOMINIOS = [
    { k: 'vision', l: 'Inicio', Icono: LayoutDashboard, hojas: [{ k: 'inicio', l: 'Inicio — qué hacer hoy', show: true }] },
    { k: 'dom_sol', l: 'Solicitudes', Icono: ClipboardList, hojas: [
      { k: 'solicitudes', l: 'Mis solicitudes', n: misAbiertas.length, show: true },
      { k: 'todas', l: 'Todas las solicitudes', show: can('cop.ver_todo') },
    ]},
    { k: 'dom_apr', l: 'Aprobaciones', Icono: CheckSquare, hojas: [
      { k: 'aprobar', l: 'Por aprobar', n: porFirmar.length, warn: true, show: can('cop.aprobar_n1') || can('cop.aprobar_n2') },
    ]},
    { k: 'dom_com', l: 'Compras', Icono: ShoppingCart, hojas: [
      { k: 'gestion', l: 'Gestión de compras', n: porComprar.length + porCerrar.length, warn: true, show: can('cop.gestionar') },
      { k: 'recepcion', l: 'Recepción', n: porRecibir.length, show: porRecibir.length > 0 || can('cop.recibir') },
    ]},
    { k: 'dom_ctrl', l: 'Control de gasto', Icono: BarChart3, hojas: [{ k: 'panel', l: 'Panel de gasto', show: can('cop.ver_todo') }] },
    { k: 'dom_gest', l: 'Gestión', Icono: FolderKanban, hojas: [{ k: 'pmo', l: 'Tareas y reuniones', show: can('cop.ver_todo') || can('cop.gestionar') }] },
    { k: 'dom_conf', l: 'Configuración', Icono: Settings, hojas: [{ k: 'config', l: 'Tramos y categorías', show: can('cop.config') }] },
  ].map(d => ({ ...d, hojas: d.hojas.filter(h => h.show) })).filter(d => d.hojas.length)
  const hojas = DOMINIOS.flatMap(d => d.hojas)
  const tabValido = hojas.some(h => h.k === tab) ? tab : (capsOk ? 'inicio' : tab)
  const dominioActivo = DOMINIOS.find(d => d.hojas.some(h => h.k === tabValido)) || DOMINIOS[0]
  const hojaActiva = hojas.find(h => h.k === tabValido)
  const irA = k => { setTab(k); setSelId(null); setEditando(null) }

  const sel = sols.find(s => s.id === selId) || null
  const cambiarApp = () => { try { localStorage.removeItem('outlet_app_actual') } catch (e) { } setAppActual && setAppActual(null) }
  const cerrarSesion = async () => {
    try { await signOut() } catch (e) { }
    try { localStorage.removeItem('erp_cu_id'); localStorage.removeItem('outlet_app_actual') } catch (e) { }
    window.location.reload()
  }
  const nueva = () => { setEditando('nueva'); setSelId(null); if (['inicio', 'pmo', 'config', 'panel'].includes(tabValido)) setTab('solicitudes') }
  const rolNombre = cu.rol === 'admin' ? 'Administrador' : can('cop.aprobar_n1') ? 'Valida y gestiona' : can('cop.aprobar_n2') ? 'Autoriza' : can('cop.gestionar') ? 'Gestor de compras' : 'Solicitante'

  const colsBase = [
    { key: 'id', label: 'Solicitud', width: 100, render: r => <b style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, color: INK }}>{r.id}</b> },
    { key: 'oc_numero', label: 'OC', width: 110, render: r => r.oc_numero ? <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, color: NAVY, fontWeight: 700 }}>{r.oc_numero}</span> : '—' },
    { key: 'estado', label: 'Estado', width: 130, render: r => <Estado e={r.estado} />, value: r => r.estado },
    { key: 'titulo', label: 'Título', width: 240 },
    { key: 'tipo', label: 'Tipo', width: 70, value: r => r.tipo === 'servicio' ? 'Servicio' : 'Bien' },
    { key: 'categoria_id', label: 'Categoría', width: 160, value: r => catNom[r.categoria_id] || r.categoria_id || '' },
    { key: 'sucursal_id', label: 'Sucursal', width: 120, value: r => sucNom[r.sucursal_id] || r.sucursal_id || '' },
    { key: 'centro_costo_codigo', label: 'C. costo', width: 150, value: r => r.centro_costo_codigo ? `${r.centro_costo_codigo} ${cecoNom[r.centro_costo_codigo] || ''}` : '' },
    { key: 'solicitante_nombre', label: 'Solicitante', width: 140 },
    { key: 'proveedor_id', label: 'Proveedor', width: 170, value: r => provNom[r.proveedor_id] || (r.proveedor_sugerido ? `(sug.) ${r.proveedor_sugerido}` : '') },
    { key: 'total_neto', label: 'Neto', align: 'right', width: 100, value: r => Number(r.total_neto) || 0, render: r => <span style={{ fontFamily: 'ui-monospace,monospace' }}>{fmt(r.total_neto)}</span> },
    { key: 'pago', label: 'Pago', width: 90, value: r => estadoPago(r, pagos).t, render: r => { const e = estadoPago(r, pagos); return <span style={{ color: e.c, fontWeight: e.b ? 700 : 400 }}>{e.t}</span> } },
    { key: 'nivel', label: 'Firmas', width: 70, value: r => r.nivel_requerido ? `${r.nivel_aprobado}/${r.nivel_requerido}` : '—' },
    { key: 'urgencia', label: 'Urgencia', width: 80, value: r => URG[r.urgencia]?.l || r.urgencia, render: r => <span style={{ color: URG[r.urgencia]?.c, fontWeight: r.urgencia !== 'normal' ? 700 : 400 }}>{URG[r.urgencia]?.l}</span> },
    { key: 'fecha_requerida', label: 'Requerida', width: 90, value: r => r.fecha_requerida || '', render: r => fFecha(r.fecha_requerida) },
    { key: 'created_at', label: 'Creada', width: 90, value: r => r.created_at, render: r => fFecha(r.created_at) },
  ]
  const grid = (rows, title, name) => <DataGrid columns={colsBase} rows={rows} getRowId={r => r.id} selectedId={selId}
    onRowClick={r => { setSelId(r.id); setEditando(null) }} title={title} exportName={name} loading={cargando} emptyText="Sin solicitudes" />

  const panelLateral = tabValido !== 'pmo' && tabValido !== 'inicio' && (editando || sel)
  const lateral = <>
    {editando && <Editor key={editando} id={editando === 'nueva' ? null : editando} cu={cu} cat={cat} umbral={umbral} def={miDefault}
      onClose={() => setEditando(null)} onSaved={async (id) => { await cargar(); setEditando(null); setSelId(id); toast.success(`Solicitud ${id} guardada`) }} />}
    {!editando && sel && <Detalle key={sel.id} s={sel} cu={cu} cat={cat} can={can} pago={sel.libro_compras_id ? pagos[sel.libro_compras_id] : null} puedeFirmar={puedeFirmar(sel)} regla={regla}
      provNom={provNom} sucNom={sucNom} catNom={catNom} cecoNom={cecoNom}
      onClose={() => setSelId(null)} onEditar={() => setEditando(sel.id)} onChanged={cargar} />}
  </>

  const vista = <>
    {err && <div style={{ ...st.card, borderColor: '#FDA29B', borderLeft: `4px solid ${ROJO}`, color: ROJO, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>No se pudo cargar: {err} <Btn small kind="sec" onClick={cargar}>Reintentar</Btn></div>}
    {capsOk && !can('cop.solicitar') && !can('cop.ver_todo') && !can('cop.gestionar') && !can('cop.recibir') && !can('cop.aprobar_n1') && !can('cop.aprobar_n2') &&
      <div style={{ ...st.card, borderLeft: `4px solid ${AMBAR}`, marginBottom: 12 }}>No tienes atribuciones en Compras Operación. Pide a Administración que te asigne un rol.</div>}
    {tabValido === 'inicio' && <Inicio cu={cu} can={can} irA={irA} nueva={nueva} mias={mias} misAbiertas={misAbiertas} porFirmar={porFirmar} porComprar={porComprar}
      ocCurso={ocCurso} porRecibir={porRecibir} porCerrar={porCerrar} reglas={cat.reglas} umbral={umbral} abrir={id => { const s0 = sols.find(x => x.id === id); setTab(s0?.solicitante_id === cu.id ? 'solicitudes' : (can('cop.ver_todo') ? 'todas' : 'solicitudes')); setSelId(id); setEditando(null) }} />}
    {tabValido === 'solicitudes' && grid(mias, 'Mis solicitudes', 'mis_solicitudes')}
    {tabValido === 'aprobar' && grid(porFirmar, 'Esperando tu firma', 'por_aprobar')}
    {tabValido === 'gestion' && <div style={{ display: 'grid', gap: 14 }}>
      {grid(porComprar, `Aprobadas por comprar (${porComprar.length})`, 'por_comprar')}
      {grid(ocCurso, `OC emitidas en curso (${ocCurso.length})`, 'oc_en_curso')}
      {grid(porCerrar, `Recibidas por cerrar con factura (${porCerrar.length})`, 'por_cerrar')}
    </div>}
    {tabValido === 'recepcion' && grid(can('cop.recibir') || can('cop.gestionar') ? ocCurso : porRecibir, 'Por recepcionar', 'por_recepcionar')}
    {tabValido === 'todas' && grid(sols, 'Todas las solicitudes', 'solicitudes_compras_op')}
    {tabValido === 'panel' && <Panel sols={sols} pagos={pagos} catNom={catNom} cecoNom={cecoNom} sucNom={sucNom} provNom={provNom} />}
    {tabValido === 'config' && <Config cat={cat} onSaved={cargar} />}
    {tabValido === 'pmo' && <PmoGestion cu={cu} area="finanzas" />}
  </>

  const estilosGlobales = <style>{`
    input:focus,select:focus,textarea:focus{outline:none;border-color:${NAVY}!important;box-shadow:0 0 0 3px rgba(22,33,62,0.08)}
    ::selection{background:${NAVY};color:#fff}
    ::-webkit-scrollbar{width:10px;height:10px}
    ::-webkit-scrollbar-track{background:${FONDO};border-radius:5px}
    ::-webkit-scrollbar-thumb{background:#C7C7CC;border-radius:5px;border:2px solid ${FONDO}}
    ::-webkit-scrollbar-thumb:hover{background:#8E8E93}
  `}</style>
  const raiz = { fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif", background: FONDO, minHeight: '100vh', fontSize: 13, color: INK }

  /* ── MÓVIL: header navy + chips de hojas + bottom bar de dominios ── */
  if (isMobile) return <div style={{ ...raiz, padding: '0 10px calc(90px + env(safe-area-inset-bottom))' }}>
    {estilosGlobales}
    <div style={{ position: 'sticky', top: 0, zIndex: 50, background: NAVY, margin: '0 -10px 10px', padding: '10px 14px 8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>Compras Op. <span style={{ fontWeight: 400, opacity: 0.55 }}>· {hojaActiva?.l}</span></div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>{rolNombre} · {cu.nombre}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {can('cop.solicitar') && <button onClick={nueva} title="Nueva solicitud" style={{ width: 32, height: 32, borderRadius: 8, background: '#fff', border: 'none', cursor: 'pointer', color: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={16} /></button>}
          <button onClick={cambiarApp} title="Apps" style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.12)', border: 'none', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LayoutGrid size={15} /></button>
          <button onClick={cerrarSesion} title="Cerrar sesión" style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.12)', border: 'none', cursor: 'pointer', color: '#FDA29B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LogOut size={15} /></button>
        </div>
      </div>
    </div>
    {dominioActivo && dominioActivo.hojas.length > 1 && !panelLateral && <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', paddingBottom: 2 }}>
      {dominioActivo.hojas.map(h => <button key={h.k} onClick={() => irA(h.k)} style={{ padding: '6px 12px', borderRadius: 999, whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: tabValido === h.k ? NAVY : '#fff', color: tabValido === h.k ? '#fff' : SLATE, border: `1px solid ${tabValido === h.k ? NAVY : BORDE}` }}>{h.l}{h.n > 0 ? ` · ${h.n}` : ''}</button>)}
    </div>}
    {panelLateral
      ? <><button onClick={() => { setSelId(null); setEditando(null) }} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', color: NAVY, fontWeight: 700, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}><ArrowLeft size={15} /> Volver a la lista</button>{lateral}</>
      : vista}
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: `1px solid ${BORDE}`, display: 'flex', justifyContent: 'center', padding: '6px 0 env(safe-area-inset-bottom,6px)', zIndex: 50, boxShadow: '0 -2px 10px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', maxWidth: 700, width: '100%' }}>
        {DOMINIOS.map(d => { const activo = dominioActivo?.k === d.k; const Ic = d.Icono; const n = d.hojas.reduce((t, h) => t + (h.n || 0), 0)
          return <button key={d.k} onClick={() => irA(d.hojas[0].k)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '5px 2px', background: 'none', border: 'none', cursor: 'pointer', position: 'relative' }}>
            <Ic size={19} color={activo ? NAVY : '#98A2B3'} strokeWidth={activo ? 2.4 : 2} />
            {n > 0 && <span style={{ position: 'absolute', top: 0, right: '22%', fontSize: 9, fontWeight: 800, color: '#fff', background: AMBAR, borderRadius: 999, padding: '0 5px' }}>{n}</span>}
            <span style={{ fontSize: 9, fontWeight: activo ? 800 : 600, color: activo ? NAVY : '#98A2B3' }}>{d.l.split(' ')[0]}</span>
          </button> })}
      </div>
    </div>
    <Toaster richColors position="top-center" />
  </div>

  /* ── DESKTOP: sidebar navy tipo ERP + área de trabajo ── */
  return <div style={raiz}>
    {estilosGlobales}
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* SIDEBAR */}
      <div style={{ width: SIDEBAR_W, flexShrink: 0, background: NAVY, position: 'sticky', top: 0, height: '100vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>OUTLET DE PUERTAS</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.14em', marginTop: 2 }}>ERP · COMPRAS OPERACIÓN</div>
        </div>
        {can('cop.solicitar') && <div style={{ padding: '12px 12px 4px' }}>
          <button onClick={nueva} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0', borderRadius: 8, background: '#fff', color: NAVY, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}><Plus size={14} /> Nueva solicitud</button>
        </div>}
        <div style={{ flex: 1, padding: '10px 8px' }}>
          {DOMINIOS.map(d => {
            const domActivo = dominioActivo?.k === d.k
            const Ic = d.Icono
            const unaHoja = d.hojas.length === 1
            const nDom = unaHoja ? (d.hojas[0].n || 0) : 0
            return <div key={d.k} style={{ marginBottom: 2 }}>
              <button onClick={() => irA(d.hojas[0].k)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', borderRadius: 8, cursor: 'pointer', background: domActivo && unaHoja ? NAVY_ACTIVE : 'transparent', border: 'none', textAlign: 'left', borderLeft: domActivo && unaHoja ? '3px solid #fff' : '3px solid transparent' }}
                onMouseEnter={e => { if (!(domActivo && unaHoja)) e.currentTarget.style.background = NAVY_HOVER }}
                onMouseLeave={e => { if (!(domActivo && unaHoja)) e.currentTarget.style.background = 'transparent' }}>
                <Ic size={16} color={domActivo ? '#fff' : 'rgba(255,255,255,0.55)'} strokeWidth={domActivo ? 2.4 : 2} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: domActivo ? 700 : 500, color: domActivo ? '#fff' : 'rgba(255,255,255,0.75)', letterSpacing: '-0.01em' }}>{d.l}</span>
                {nDom > 0 && <Contador n={nDom} warn={d.hojas[0].warn} />}
              </button>
              {!unaHoja && d.hojas.map(h => {
                const activa = tabValido === h.k
                return <button key={h.k} onClick={() => irA(h.k)}
                  style={{ display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left', padding: '7px 10px 7px 36px', borderRadius: 8, cursor: 'pointer', background: activa ? NAVY_ACTIVE : 'transparent', border: 'none', borderLeft: activa ? '3px solid #fff' : '3px solid transparent', fontSize: 12.5, fontWeight: activa ? 700 : 400, color: activa ? '#fff' : 'rgba(255,255,255,0.6)' }}
                  onMouseEnter={e => { if (!activa) e.currentTarget.style.background = NAVY_HOVER }}
                  onMouseLeave={e => { if (!activa) e.currentTarget.style.background = 'transparent' }}>
                  <span style={{ flex: 1 }}>{h.l}</span>{h.n > 0 && <Contador n={h.n} warn={h.warn} />}
                </button>
              })}
            </div>
          })}
        </div>
        <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cu.nombre}</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', fontWeight: 600, marginBottom: 10 }}>{rolNombre}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={cambiarApp} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 8, background: 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', color: '#fff', fontSize: 11.5, fontWeight: 600 }}><LayoutGrid size={13} /> Apps</button>
            <button onClick={cerrarSesion} title="Cerrar sesión" style={{ width: 34, borderRadius: 8, background: 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', color: '#FDA29B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LogOut size={13} /></button>
          </div>
        </div>
      </div>

      {/* ÁREA DE TRABAJO */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 40, background: '#fff', borderBottom: `1px solid ${BORDE}`, padding: '12px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: INK, letterSpacing: '-0.02em' }}>{dominioActivo?.l}</span>
            {dominioActivo && dominioActivo.hojas.length > 1 && <span style={{ fontSize: 12.5, color: SLATE, fontWeight: 500 }}>/ {hojaActiva?.l}</span>}
            {editando && <span style={{ fontSize: 12.5, color: SLATE, fontWeight: 500 }}>/ {editando === 'nueva' ? 'Nueva solicitud' : `Editar ${editando}`}</span>}
            {!editando && sel && panelLateral && <span style={{ fontSize: 12.5, color: SLATE, fontWeight: 500, fontFamily: 'ui-monospace,monospace' }}>/ {sel.id}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            <span style={{ fontSize: 11.5, color: NAVY, fontWeight: 700 }}>{rolNombre} · {cu.nombre}</span>
          </div>
        </div>
        <div style={{ padding: '18px 22px 40px', display: 'grid', gridTemplateColumns: panelLateral ? 'minmax(0,1fr) minmax(430px, 560px)' : '1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ minWidth: 0 }}>{vista}</div>
          {panelLateral && lateral}
        </div>
      </div>
    </div>
    <Toaster richColors position="top-right" />
  </div>
}

function Contador({ n, warn }) {
  return <span style={{ fontSize: 10.5, fontWeight: 800, minWidth: 20, textAlign: 'center', padding: '1px 6px', borderRadius: 999, background: warn ? '#FEF3C7' : 'rgba(255,255,255,0.16)', color: warn ? '#92400E' : '#fff' }}>{n}</span>
}

/* ═══ INICIO — qué hacer hoy (mismo patrón que Finanzas) ═══════════════════ */
function Inicio({ cu, can, irA, nueva, mias, misAbiertas, porFirmar, porComprar, ocCurso, porRecibir, porCerrar, reglas, umbral, abrir }) {
  const nombre = (cu?.nombre || '').split(' ')[0]
  const tot = arr => fmt(arr.reduce((t, s) => t + Number(s.total_neto || 0), 0))
  const pend = [
    { l: 'Mis solicitudes abiertas', v: misAbiertas.length, d: misAbiertas.filter(s => s.estado === 'Borrador').length + ' en borrador', c: NAVY, go: 'solicitudes', show: true },
    { l: 'Esperando tu firma', v: porFirmar.length, d: porFirmar.length ? tot(porFirmar) + ' neto' : 'al día', c: porFirmar.length ? AMBAR : VERDE, go: 'aprobar', show: can('cop.aprobar_n1') || can('cop.aprobar_n2') },
    { l: 'Aprobadas por comprar', v: porComprar.length, d: porComprar.length ? tot(porComprar) + ' neto' : 'al día', c: porComprar.length ? AMBAR : VERDE, go: 'gestion', show: can('cop.gestionar') },
    { l: 'Por recibir', v: porRecibir.length, d: porRecibir.filter(s => s.fecha_entrega_comprometida && s.fecha_entrega_comprometida < hoy()).length + ' atrasadas', c: porRecibir.some(s => s.fecha_entrega_comprometida && s.fecha_entrega_comprometida < hoy()) ? ROJO : porRecibir.length ? AMBAR : VERDE, go: 'recepcion', show: porRecibir.length > 0 || can('cop.recibir') },
    { l: 'Recibidas sin factura', v: porCerrar.length, d: 'por cerrar', c: porCerrar.length ? AMBAR : VERDE, go: 'gestion', show: can('cop.gestionar') },
    { l: 'OC en curso', v: ocCurso.length, d: tot(ocCurso) + ' comprometido', c: NAVY, go: can('cop.gestionar') ? 'gestion' : 'recepcion', show: can('cop.ver_todo') || can('cop.gestionar') },
  ].filter(p => p.show)
  const firmas = reglas.filter(r => r.activo).map(r => r.nombre)
  const PASOS = [
    { t: 'Solicitas', d: 'Qué necesitas, para qué sucursal y centro de costo, con precio estimado y justificación.' },
    ...firmas.map((f, i) => ({ t: i === 0 ? 'Se valida' : 'Se autoriza', d: f })),
    { t: 'Se emite la OC', d: 'Compras asigna proveedor, confirma el precio y envía la OC-GEN (bienes) u OC-SRV (servicios).' },
    { t: 'Recibes', d: 'Registras la recepción conforme o con observaciones. Adjunta guía o acta.' },
    { t: 'Se cierra', d: 'Compras asocia la factura del libro y Finanzas la paga.' },
  ]
  const recientes = mias.slice(0, 6)

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 1180 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: NAVY }}>{nombre ? `Hola, ${nombre}.` : 'Compras Operación'} ¿Qué necesitas comprar?</div>
        <div style={{ fontSize: 12.5, color: SLATE, marginTop: 4, maxWidth: 760 }}>
          Insumos, herramientas, aseo y servicios para operar. {umbral > 0 && <>Compras de mostrador hasta <b>{fmt(umbral)}</b> van por caja chica; sobre eso, con solicitud y OC.</>}
        </div>
      </div>
      {can('cop.solicitar') && <Btn onClick={nueva}><Plus size={14} /> Nueva solicitud</Btn>}
    </div>

    <div>
      <div style={st.seccion}>Pendiente hoy</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        {pend.map(p => <Kpi key={p.l} l={p.l} v={p.v} d={p.d} c={p.c} onClick={() => irA(p.go)} />)}
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14, alignItems: 'start' }}>
      <div>
        <div style={st.seccion}>Mis últimas solicitudes</div>
        <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8 }}>
          {recientes.length === 0 && <div style={{ padding: '14px 16px', fontSize: 12.5, color: SLATE }}>Aún no tienes solicitudes. {can('cop.solicitar') && <button onClick={nueva} style={{ border: 'none', background: 'none', color: NAVY, fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 12.5 }}>Crear la primera →</button>}</div>}
          {recientes.map((s, i) => <button key={s.id} onClick={() => abrir(s.id)} style={{ display: 'grid', gridTemplateColumns: '92px 1fr auto auto', gap: 10, alignItems: 'center', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', borderBottom: i < recientes.length - 1 ? `1px solid ${BORDE}` : 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, fontWeight: 700, color: INK }}>{s.id}</span>
            <span style={{ fontSize: 12.5, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.titulo}</span>
            <span style={{ fontSize: 12, fontFamily: 'ui-monospace,monospace', color: SLATE }}>{fmt(s.total_neto)}</span>
            <Estado e={s.estado} />
          </button>)}
        </div>
      </div>
      <div>
        <div style={st.seccion}>Cómo funciona</div>
        <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8 }}>
          {PASOS.map((p, i) => <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 14px', borderBottom: i < PASOS.length - 1 ? `1px solid ${BORDE}` : 'none' }}>
            <div style={{ width: 22, height: 22, borderRadius: 999, background: '#E8EBF3', color: NAVY, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
            <div><div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>{p.t}</div><div style={{ fontSize: 12, color: INK, lineHeight: 1.5 }}>{p.d}</div></div>
          </div>)}
        </div>
      </div>
    </div>
  </div>
}

/* ═══ EDITOR DE BORRADOR ══════════════════════════════════════════════════ */
function Editor({ id, cu, cat, umbral, def, onClose, onSaved }) {
  // Default del usuario (área + sucursal) desde cop_usuario_defaults; si no hay, se deduce de su sucursal
  const sucDef = def?.sucursal_id || (cu.sucursal_id && SUF_CECO[cu.sucursal_id] ? cu.sucursal_id : '')
  const cecoDef = def?.centro_costo_codigo || (sucDef && SUF_CECO[sucDef] ? `102${SUF_CECO[sucDef]}` : '')
  const [f, setF] = useState({ titulo: '', categoria_id: '', sucursal_id: sucDef, centro_costo_codigo: cecoDef, urgencia: 'normal', fecha_requerida: '', proveedor_sugerido: '', justificacion: '', aplica_iva: true })
  const [items, setItems] = useState([{ descripcion: '', cantidad: 1, unidad: 'un', precio_unit: 0 }])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      const [s, it] = await Promise.all([
        supabase.from('cop_solicitudes').select('*').eq('id', id).single(),
        supabase.from('cop_items').select('*').eq('solicitud_id', id).order('linea'),
      ])
      if (s.data) setF({ titulo: s.data.titulo || '', categoria_id: s.data.categoria_id || '', sucursal_id: s.data.sucursal_id || '', centro_costo_codigo: s.data.centro_costo_codigo || '', urgencia: s.data.urgencia || 'normal', fecha_requerida: s.data.fecha_requerida || '', proveedor_sugerido: s.data.proveedor_sugerido || '', justificacion: s.data.justificacion || '', aplica_iva: s.data.aplica_iva !== false })
      if (it.data?.length) setItems(it.data.map(x => ({ descripcion: x.descripcion, cantidad: Number(x.cantidad), unidad: x.unidad, precio_unit: Number(x.precio_unit) })))
    })()
  }, [id])

  const set = (k, v) => setF(p => {
    const n = { ...p, [k]: v }
    // Al cambiar sucursal, sugerir centro de costo del mismo área
    if (k === 'sucursal_id') {
      const area = (p.centro_costo_codigo || cecoDef || '102').slice(0, 3)
      const suf = SUF_CECO[v] || (v === 'suc-admin' ? '01' : null)
      const cand = suf && (v === 'suc-admin' ? cat.cecos.find(c => c.codigo.startsWith(area) && /matriz/i.test(c.nombre))?.codigo : `${area}${suf}`)
      if (cand && cat.cecos.some(c => c.codigo === cand)) n.centro_costo_codigo = cand
    }
    return n
  })
  const setIt = (i, k, v) => setItems(p => p.map((x, j) => j === i ? { ...x, [k]: v } : x))
  const neto = items.reduce((s, x) => s + Math.round((Number(x.cantidad) || 0) * (Number(x.precio_unit) || 0)), 0)
  const iva = f.aplica_iva ? Math.round(neto * 0.19) : 0
  const nivel = Math.max(0, ...cat.reglas.filter(r => r.activo && neto > Number(r.monto_desde)).map(r => r.nivel))
  const catSel = cat.categorias.find(c => c.id === f.categoria_id)

  const guardar = async (enviar) => {
    setMsg(null)
    const faltan = []
    if (!f.titulo.trim()) faltan.push('título')
    if (!f.categoria_id) faltan.push('categoría')
    if (!f.sucursal_id) faltan.push('sucursal')
    if (!f.centro_costo_codigo) faltan.push('centro de costo')
    const its = items.filter(x => x.descripcion.trim())
    if (enviar) {
      if (!f.justificacion.trim()) faltan.push('justificación')
      if (!its.length || neto <= 0) faltan.push('ítems con precio estimado')
    }
    if (faltan.length) { setMsg({ bad: true, t: 'Falta: ' + faltan.join(', ') }); return }
    setBusy(true)
    try {
      const row = { ...f, titulo: f.titulo.trim(), fecha_requerida: f.fecha_requerida || null, proveedor_sugerido: f.proveedor_sugerido.trim() || null, justificacion: f.justificacion.trim() || null, tipo: catSel?.tipo || 'bien', cuenta_codigo: catSel?.cuenta_codigo || null, total_neto: neto, iva_monto: iva, total: neto + iva }
      let sid = id
      if (!sid) {
        const r = await supabase.from('cop_solicitudes').insert(row).select('id').single()
        if (r.error) throw r.error
        sid = r.data.id
      } else {
        const r = await supabase.from('cop_solicitudes').update(row).eq('id', sid)
        if (r.error) throw r.error
        const d = await supabase.from('cop_items').delete().eq('solicitud_id', sid)
        if (d.error) throw d.error
      }
      if (its.length) {
        const r = await supabase.from('cop_items').insert(its.map((x, i) => ({ solicitud_id: sid, linea: i + 1, descripcion: x.descripcion.trim(), cantidad: Number(x.cantidad) || 1, unidad: x.unidad || 'un', precio_unit: Number(x.precio_unit) || 0, subtotal: Math.round((Number(x.cantidad) || 0) * (Number(x.precio_unit) || 0)) })))
        if (r.error) throw r.error
      }
      if (enviar) {
        const r = await supabase.rpc('fn_cop_enviar', { p_id: sid })
        if (r.error) throw r.error
      }
      await onSaved(sid)
    } catch (e) { setMsg({ bad: true, t: errMsg(e) }) } finally { setBusy(false) }
  }

  const bienes = cat.categorias.filter(c => c.activo && c.tipo === 'bien')
  const servicios = cat.categorias.filter(c => c.activo && c.tipo === 'servicio')

  return <div style={{ ...st.card, position: 'sticky', top: 66, maxHeight: 'calc(100vh - 86px)', overflowY: 'auto' }}>
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ flex: 1, fontSize: 15, fontWeight: 800 }}>{id ? `Editar ${id}` : 'Nueva solicitud de compra'}</div>
      <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#6E6E73' }}>×</button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <Campo label="Qué necesitas" span={2}><input style={st.input} value={f.titulo} onChange={e => set('titulo', e.target.value)} placeholder="Ej: Artículos de aseo mensual tienda La Granja" /></Campo>
      <Campo label="Categoría" span={2}>
        <select style={st.input} value={f.categoria_id} onChange={e => set('categoria_id', e.target.value)}>
          <option value="">— Elegir —</option>
          <optgroup label="Bienes">{bienes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</optgroup>
          <optgroup label="Servicios">{servicios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</optgroup>
        </select>
        {catSel && <div style={{ fontSize: 11, color: '#6E6E73', marginTop: 3 }}>{catSel.tipo === 'servicio' ? 'Servicio → OC-SRV' : 'Bien → OC-GEN'} · cuenta {catSel.cuenta_codigo} {cat.cuentas.find(x => x.codigo === catSel.cuenta_codigo)?.nombre || ''}</div>}
      </Campo>
      <Campo label="Sucursal destino">
        <select style={st.input} value={f.sucursal_id} onChange={e => set('sucursal_id', e.target.value)}>
          <option value="">— Elegir —</option>{cat.sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </Campo>
      <Campo label="Centro de costo">
        <select style={st.input} value={f.centro_costo_codigo} onChange={e => set('centro_costo_codigo', e.target.value)}>
          <option value="">— Elegir —</option>{cat.cecos.map(c => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
        </select>
      </Campo>
      <Campo label="Urgencia">
        <select style={st.input} value={f.urgencia} onChange={e => set('urgencia', e.target.value)}>
          {Object.entries(URG).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </select>
      </Campo>
      <Campo label="Fecha requerida"><input type="date" style={st.input} value={f.fecha_requerida} min={hoy()} onChange={e => set('fecha_requerida', e.target.value)} /></Campo>
      <Campo label="Proveedor sugerido (opcional)" span={2}><input style={st.input} value={f.proveedor_sugerido} onChange={e => set('proveedor_sugerido', e.target.value)} placeholder="Si conoces uno o tienes cotización" /></Campo>
      <Campo label="Justificación (para qué y por qué ahora)" span={2}><textarea style={{ ...st.input, minHeight: 56, resize: 'vertical' }} value={f.justificacion} onChange={e => set('justificacion', e.target.value)} /></Campo>
    </div>

    <div style={{ marginTop: 14, fontSize: 12, fontWeight: 700, color: '#344054' }}>Ítems</div>
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 12 }}>
      <thead><tr style={{ color: '#6E6E73', textAlign: 'left' }}>
        <th style={{ padding: 4, fontWeight: 600 }}>Descripción</th><th style={{ padding: 4, width: 60, fontWeight: 600 }}>Cant.</th>
        <th style={{ padding: 4, width: 60, fontWeight: 600 }}>Unidad</th><th style={{ padding: 4, width: 95, fontWeight: 600 }}>$ unit. neto</th>
        <th style={{ padding: 4, width: 85, textAlign: 'right', fontWeight: 600 }}>Subtotal</th><th style={{ width: 22 }} />
      </tr></thead>
      <tbody>{items.map((x, i) => <tr key={i}>
        <td style={{ padding: 2 }}><input style={st.input} value={x.descripcion} onChange={e => setIt(i, 'descripcion', e.target.value)} /></td>
        <td style={{ padding: 2 }}><input type="number" min="0" step="any" style={st.input} value={x.cantidad} onChange={e => setIt(i, 'cantidad', e.target.value)} /></td>
        <td style={{ padding: 2 }}><input style={st.input} value={x.unidad} onChange={e => setIt(i, 'unidad', e.target.value)} /></td>
        <td style={{ padding: 2 }}><input type="number" min="0" style={st.input} value={x.precio_unit} onChange={e => setIt(i, 'precio_unit', e.target.value)} /></td>
        <td style={{ padding: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt((Number(x.cantidad) || 0) * (Number(x.precio_unit) || 0))}</td>
        <td><button onClick={() => setItems(p => p.length > 1 ? p.filter((_, j) => j !== i) : p)} style={{ border: 'none', background: 'none', color: '#98A2B3', cursor: 'pointer' }}>×</button></td>
      </tr>)}</tbody>
    </table>
    <div style={{ marginTop: 6 }}><Btn small kind="sec" onClick={() => setItems(p => [...p, { descripcion: '', cantidad: 1, unidad: 'un', precio_unit: 0 }])}>+ Ítem</Btn></div>

    <div style={{ marginTop: 12, padding: 10, background: '#F9FAFB', borderRadius: 6, display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 12 }}>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.aplica_iva} onChange={e => set('aplica_iva', e.target.checked)} /> Afecto a IVA (desmarca para boleta de honorarios / exento)</label><span />
      <span>Neto estimado</span><b style={{ textAlign: 'right' }}>{fmt(neto)}</b>
      <span>IVA</span><span style={{ textAlign: 'right' }}>{fmt(iva)}</span>
      <span>Total</span><b style={{ textAlign: 'right' }}>{fmt(neto + iva)}</b>
      <span style={{ gridColumn: 'span 2', color: '#6E6E73', marginTop: 4 }}>
        {umbral > 0 && neto > 0 && neto <= umbral && <span style={{ display: 'block', color: '#92400e', background: '#fef3c7', padding: '4px 6px', borderRadius: 4, marginBottom: 4 }}>Hasta {fmt(umbral)}: si es una compra de mostrador pagada al momento, va por caja chica (Gastos Menores). Usa OC si necesitas factura a crédito, cotización formal o un servicio.</span>}
        {nivel === 0 ? 'Bajo el umbral: queda aprobada al enviar.' : `Requiere ${nivel} firma${nivel > 1 ? 's' : ''}: ${cat.reglas.filter(r => r.nivel <= nivel).map(r => r.nombre).join(' → ')}.`}
      </span>
    </div>

    {msg && <div style={{ marginTop: 10, fontSize: 12, color: msg.bad ? '#B42318' : '#1E7A44' }}>{msg.t}</div>}
    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
      <Btn kind="sec" disabled={busy} onClick={() => guardar(false)}>Guardar borrador</Btn>
      <Btn disabled={busy} onClick={() => guardar(true)}>{busy ? 'Enviando…' : 'Enviar a aprobación'}</Btn>
    </div>
  </div>
}

/* ═══ DETALLE + ACCIONES DE FLUJO ═════════════════════════════════════════ */
function Detalle({ s, cu, cat, can, pago, puedeFirmar, regla, provNom, sucNom, catNom, cecoNom, onClose, onEditar, onChanged }) {
  const [items, setItems] = useState([])
  const [evs, setEvs] = useState([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [accion, setAccion] = useState(null)       // 'rechazar' | 'emitir' | 'recibir' | 'cerrar' | 'anular'
  const [txt, setTxt] = useState('')
  const [oc, setOc] = useState({ proveedor_id: s.proveedor_id || '', condicion: '', fecha: '', notas: '', q: '' })
  const [precios, setPrecios] = useState({})
  const [recib, setRecib] = useState({})
  const [facts, setFacts] = useState(null)
  const [factSel, setFactSel] = useState(null)
  const [folio, setFolio] = useState('')
  const [provNuevo, setProvNuevo] = useState(false)

  const cargarDet = useCallback(async () => {
    const [it, ev] = await Promise.all([
      supabase.from('cop_items').select('*').eq('solicitud_id', s.id).order('linea'),
      supabase.from('cop_eventos').select('*').eq('solicitud_id', s.id).order('created_at'),
    ])
    setItems(it.data || []); setEvs(ev.data || [])
  }, [s.id])
  useEffect(() => { cargarDet() }, [cargarDet])

  const rpc = async (fn, args, okTxt) => {
    setBusy(true); setMsg(null)
    try {
      const r = await supabase.rpc(fn, args)
      if (r.error) throw r.error
      const extra = r.data?.motivo === 'precio_final_supera_tramo' ? ' · El precio final superó el tramo aprobado: volvió a aprobación.' : ''
      setMsg({ t: okTxt + extra }); setAccion(null); setTxt(''); toast.success(okTxt + extra)
      await onChanged(); await cargarDet()
    } catch (e) { setMsg({ bad: true, t: errMsg(e) }); toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  const esMia = s.solicitante_id === cu.id
  const prov = cat.proveedores.find(p => p.id === (s.proveedor_id || oc.proveedor_id))
  const provFil = cat.proveedores.filter(p => p.id === oc.proveedor_id || (p.activo !== false && (!oc.q || `${p.nombre} ${p.rut || ''}`.toLowerCase().includes(oc.q.toLowerCase())))).slice(0, 80)
  const netoFinal = items.reduce((t, x) => t + Math.round(Number(x.cantidad) * Number(precios[x.id] ?? x.precio_unit)), 0)

  const buscarFacturas = async () => {
    setFacts('cargando')
    const p = cat.proveedores.find(x => x.id === s.proveedor_id)
    const rut = (p?.rut || '').replace(/[^0-9kK]/g, '')
    let q = supabase.from('libro_compras').select('id,folio,tipo_doc,fecha_emision,rut_proveedor,razon_social,monto_neto,monto_total,anulado')
      .gte('fecha_emision', new Date(Date.now() - 150 * 86400000).toISOString().slice(0, 10)).order('fecha_emision', { ascending: false }).limit(50)
    if (rut) q = q.ilike('rut_proveedor', `%${rut.slice(0, -1)}%`)
    const r = await q
    setFacts(r.error ? [] : (r.data || []).filter(x => !x.anulado))
  }

  const pdfOC = () => {
    const d = new jsPDF({ unit: 'mm', format: 'a4' })
    const W = 210, M = 14
    d.setFillColor(26, 26, 46); d.rect(0, 0, W, 30, 'F')
    d.setTextColor(255, 255, 255); d.setFontSize(9); d.text('OUTLET DE PUERTAS SpA', M, 11)
    d.setFontSize(16); d.setFont('helvetica', 'bold'); d.text(`Orden de Compra ${s.oc_numero}`, M, 21)
    d.setFontSize(9); d.setFont('helvetica', 'normal'); d.text(`Emitida ${fFecha(s.oc_emitida_at)} · ${s.tipo === 'servicio' ? 'Servicio' : 'Bienes'}`, W - M, 21, { align: 'right' })
    d.setTextColor(30, 30, 30); d.setFontSize(10)
    let y = 40
    const par = (a, b, x) => { d.setFont('helvetica', 'bold'); d.text(a, x, y); d.setFont('helvetica', 'normal'); d.text(String(b || '—'), x + 32, y) }
    par('Proveedor', prov?.nombre, M); par('RUT', prov?.rut, 110); y += 6
    par('Contacto', prov?.correo || prov?.telefono, M); par('Cond. pago', s.condicion_pago, 110); y += 6
    par('Entregar en', sucNom[s.sucursal_id], M); par('Fecha entrega', fFecha(s.fecha_entrega_comprometida), 110); y += 6
    par('Solicitud', `${s.id} · ${s.solicitante_nombre || ''}`, M); par('C. costo', s.centro_costo_codigo, 110); y += 8
    autoTable(d, {
      startY: y, head: [['#', 'Descripción', 'Cant.', 'Unidad', 'P. unit. neto', 'Subtotal']],
      body: items.map((x, i) => [i + 1, x.descripcion, fN(x.cantidad), x.unidad, fmt(x.precio_unit), fmt(x.subtotal)]),
      styles: { fontSize: 9 }, headStyles: { fillColor: [22, 33, 62] }, columnStyles: { 2: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }, margin: { left: M, right: M },
    })
    y = d.lastAutoTable.finalY + 6
    d.setFont('helvetica', 'normal'); d.text('Neto', 150, y); d.text(fmt(s.total_neto), W - M, y, { align: 'right' }); y += 5
    d.text('IVA', 150, y); d.text(fmt(s.iva_monto), W - M, y, { align: 'right' }); y += 5
    d.setFont('helvetica', 'bold'); d.text('Total', 150, y); d.text(fmt(s.total), W - M, y, { align: 'right' }); y += 10
    d.setFont('helvetica', 'normal'); d.setFontSize(9)
    if (s.notas_oc) { d.text(d.splitTextToSize('Notas: ' + s.notas_oc, W - 2 * M), M, y); y += 10 }
    d.text(d.splitTextToSize(`La factura debe indicar el número ${s.oc_numero}. Documentos sin OC referenciada no serán procesados para pago. Emitida por ${s.oc_emitida_por || ''} · aprobada según política de atribuciones de Outlet de Puertas SpA.`, W - 2 * M), M, y)
    d.save(`${s.oc_numero}.pdf`)
  }

  const ev = evs.find(e => e.accion === 'rechazar' && s.estado === 'Rechazada')
  const edadDias = diasEntre(s.created_at, new Date().toISOString())

  return <div style={{ ...st.card, position: 'sticky', top: 66, maxHeight: 'calc(100vh - 86px)', overflowY: 'auto' }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b style={{ fontFamily: 'ui-monospace,monospace' }}>{s.id}</b><Estado e={s.estado} />
          {s.oc_numero && <b style={{ fontFamily: 'ui-monospace,monospace', color: C2 }}>{s.oc_numero}</b>}
          {s.urgencia !== 'normal' && <span style={{ fontSize: 11, fontWeight: 700, color: URG[s.urgencia]?.c }}>● {URG[s.urgencia]?.l}</span>}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>{s.titulo}</div>
      </div>
      <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#6E6E73' }}>×</button>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '4px 10px', fontSize: 12, marginTop: 10 }}>
      <span style={{ color: '#6E6E73' }}>Solicitante</span><span>{s.solicitante_nombre}</span>
      <span style={{ color: '#6E6E73' }}>Creada</span><span>{fFecha(s.created_at)} ({edadDias} d)</span>
      <span style={{ color: '#6E6E73' }}>Categoría</span><span>{catNom[s.categoria_id]}</span>
      <span style={{ color: '#6E6E73' }}>Cuenta</span><span>{s.cuenta_codigo || '—'}</span>
      <span style={{ color: '#6E6E73' }}>Sucursal</span><span>{sucNom[s.sucursal_id]}</span>
      <span style={{ color: '#6E6E73' }}>C. costo</span><span>{s.centro_costo_codigo} {cecoNom[s.centro_costo_codigo] || ''}</span>
      <span style={{ color: '#6E6E73' }}>Requerida</span><span>{fFecha(s.fecha_requerida)}</span>
      <span style={{ color: '#6E6E73' }}>Firmas</span><span>{s.nivel_requerido ? `${s.nivel_aprobado} de ${s.nivel_requerido}` : '—'}</span>
      <span style={{ color: '#6E6E73' }}>Proveedor</span><span style={{ gridColumn: 'span 3' }}>{provNom[s.proveedor_id] || (s.proveedor_sugerido ? `Sugerido: ${s.proveedor_sugerido}` : '—')}</span>
      {s.justificacion && <><span style={{ color: '#6E6E73' }}>Justificación</span><span style={{ gridColumn: 'span 3' }}>{s.justificacion}</span></>}
      {s.recepcion_fecha && <><span style={{ color: '#6E6E73' }}>Recepción</span><span style={{ gridColumn: 'span 3' }}>{fFecha(s.recepcion_fecha)} · {s.recepcion_por} · {s.recepcion_conforme ? 'Conforme' : `Con obs.: ${s.recepcion_obs}`}</span></>}
      {s.factura_folio && <><span style={{ color: '#6E6E73' }}>Factura</span><span style={{ gridColumn: 'span 3' }}>{s.factura_folio}{s.libro_compras_id ? ' (libro de compras)' : ' (folio manual)'}
        {pago && <> · total {fmt(pago.monto_total)} · {pago.movimiento_id || pago.conciliado_at ? <b style={{ color: '#1E7A44' }}>Pagada{pago.conciliado_at ? ` (conciliada ${fFecha(pago.conciliado_at)})` : ''}</b> : <b style={{ color: pago.fecha_vencimiento && pago.fecha_vencimiento < hoy() ? '#B42318' : '#B25E09' }}>Por pagar{pago.fecha_vencimiento ? ` · vence ${fFecha(pago.fecha_vencimiento)}` : ''}</b>}</>}
      </span></>}
    </div>

    {ev && <div style={{ marginTop: 10, padding: 8, background: '#FEF3F2', borderRadius: 6, fontSize: 12, color: '#912018' }}>Rechazada por {ev.usuario_nombre}: {ev.comentario}</div>}

    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12, fontSize: 12 }}>
      <thead><tr style={{ color: '#6E6E73', borderBottom: '1px solid #E5E7EB', textAlign: 'left' }}>
        <th style={{ padding: '4px 2px', fontWeight: 600 }}>Ítem</th><th style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 600 }}>Cant.</th>
        <th style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 600 }}>$ unit.</th><th style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 600 }}>Subtotal</th>
        {s.recepcion_fecha && <th style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 600 }}>Recib.</th>}
      </tr></thead>
      <tbody>{items.map(x => <tr key={x.id} style={{ borderBottom: '1px solid #F2F4F7' }}>
        <td style={{ padding: '4px 2px' }}>{x.descripcion}</td>
        <td style={{ padding: '4px 2px', textAlign: 'right' }}>{fN(x.cantidad)} {x.unidad}</td>
        <td style={{ padding: '4px 2px', textAlign: 'right' }}>{fmt(x.precio_unit)}</td>
        <td style={{ padding: '4px 2px', textAlign: 'right' }}>{fmt(x.subtotal || x.cantidad * x.precio_unit)}</td>
        {s.recepcion_fecha && <td style={{ padding: '4px 2px', textAlign: 'right', color: Number(x.cantidad_recibida) < Number(x.cantidad) ? '#B54708' : undefined }}>{x.cantidad_recibida == null ? '—' : fN(x.cantidad_recibida)}</td>}
      </tr>)}</tbody>
      <tfoot><tr><td colSpan={3} style={{ padding: '6px 2px', textAlign: 'right', color: '#6E6E73' }}>Neto · IVA · Total</td>
        <td colSpan={s.recepcion_fecha ? 2 : 1} style={{ padding: '6px 2px', textAlign: 'right', fontWeight: 700 }}>{fmt(s.total_neto)} · {fmt(s.iva_monto)} · {fmt(s.total)}</td></tr></tfoot>
    </table>

    {/* ── Acciones según estado y atribuciones ── */}
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
      {s.estado === 'Borrador' && (esMia || can('cop.gestionar')) && <>
        <Btn kind="sec" onClick={onEditar}>Editar</Btn>
        <Btn disabled={busy} onClick={() => rpc('fn_cop_enviar', { p_id: s.id }, 'Enviada a aprobación')}>Enviar a aprobación</Btn>
      </>}
      {puedeFirmar && <>
        <Btn kind="ok" disabled={busy} onClick={() => rpc('fn_cop_aprobar', { p_id: s.id, p_aprobar: true, p_comentario: txt || null }, 'Aprobada')}>Aprobar · {regla(s.nivel_aprobado + 1)?.nombre}</Btn>
        <Btn kind="bad" disabled={busy} onClick={() => setAccion('rechazar')}>Rechazar</Btn>
      </>}
      {s.estado === 'Rechazada' && (esMia || can('cop.gestionar')) && <Btn kind="sec" disabled={busy} onClick={() => rpc('fn_cop_reabrir', { p_id: s.id }, 'Reabierta como borrador')}>Corregir y reenviar</Btn>}
      {s.estado === 'Aprobada' && can('cop.gestionar') && <Btn onClick={() => setAccion('emitir')}>Emitir OC</Btn>}
      {s.oc_numero && <Btn kind="sec" onClick={pdfOC}>PDF de la OC</Btn>}
      {s.estado === 'OC emitida' && (esMia || can('cop.recibir') || can('cop.gestionar')) && <Btn kind="ok" onClick={() => setAccion('recibir')}>Registrar recepción</Btn>}
      {['Recibida', 'Recibida con obs.'].includes(s.estado) && can('cop.gestionar') && <Btn onClick={() => { setAccion('cerrar'); buscarFacturas() }}>Cerrar con factura</Btn>}
      {!['Cerrada', 'Anulada'].includes(s.estado) && (can('cop.gestionar') || (esMia && ['Borrador', 'Pend. aprobación', 'Rechazada', 'Aprobada'].includes(s.estado))) &&
        <Btn kind="bad" onClick={() => setAccion('anular')}>Anular</Btn>}
    </div>
    {puedeFirmar && !accion && <input style={{ ...st.input, marginTop: 6 }} placeholder="Comentario de aprobación (opcional)" value={txt} onChange={e => setTxt(e.target.value)} />}

    {accion === 'rechazar' && <Caja titulo="Motivo del rechazo" onCancel={() => setAccion(null)}>
      <textarea style={{ ...st.input, minHeight: 50 }} value={txt} onChange={e => setTxt(e.target.value)} placeholder="El solicitante lo verá y podrá corregir" />
      <Btn kind="bad" disabled={busy || !txt.trim()} onClick={() => rpc('fn_cop_aprobar', { p_id: s.id, p_aprobar: false, p_comentario: txt }, 'Rechazada')}>Confirmar rechazo</Btn>
    </Caja>}

    {accion === 'anular' && <Caja titulo="Motivo de anulación" onCancel={() => setAccion(null)}>
      <textarea style={{ ...st.input, minHeight: 50 }} value={txt} onChange={e => setTxt(e.target.value)} />
      {s.oc_numero && <div style={{ fontSize: 11, color: '#B25E09' }}>La OC {s.oc_numero} ya fue emitida: avisa al proveedor.</div>}
      <Btn kind="bad" disabled={busy || !txt.trim()} onClick={() => rpc('fn_cop_anular', { p_id: s.id, p_motivo: txt }, 'Anulada')}>Confirmar anulación</Btn>
    </Caja>}

    {accion === 'emitir' && <Caja titulo="Emitir orden de compra" onCancel={() => setAccion(null)}>
      <input style={st.input} placeholder="Buscar proveedor por nombre o RUT" value={oc.q} onChange={e => setOc(p => ({ ...p, q: e.target.value }))} />
      <select style={st.input} size={6} value={oc.proveedor_id} onChange={e => setOc(p => ({ ...p, proveedor_id: e.target.value }))}>
        {provFil.map(p => <option key={p.id} value={p.id}>{p.nombre}{p.rut ? ` · ${p.rut}` : ''}</option>)}
      </select>
      {s.proveedor_sugerido && <div style={{ fontSize: 11, color: '#6E6E73' }}>Sugerido por el solicitante: {s.proveedor_sugerido}</div>}
      {!provNuevo ? <div><Btn small kind="sec" onClick={() => setProvNuevo(true)}>+ Proveedor que no está en la lista</Btn></div>
        : <NuevoProveedor cat={cat} sugerido={oc.q || s.proveedor_sugerido || ''} onCancel={() => setProvNuevo(false)}
            onCreated={async (id, existente) => { setProvNuevo(false); await onChanged(); setOc(p => ({ ...p, proveedor_id: id, q: '' })); setMsg({ t: existente ? 'Ese RUT ya existía: quedó seleccionado.' : 'Proveedor creado y seleccionado.' }) }} />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Campo label="Condición de pago"><input style={st.input} value={oc.condicion} placeholder={cat.proveedores.find(p => p.id === oc.proveedor_id)?.condicion_pago || 'Ej: 30 días'} onChange={e => setOc(p => ({ ...p, condicion: e.target.value }))} /></Campo>
        <Campo label="Fecha de entrega"><input type="date" style={st.input} value={oc.fecha} onChange={e => setOc(p => ({ ...p, fecha: e.target.value }))} /></Campo>
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>Precio cotizado final (neto)</div>
      {items.map(x => <div key={x.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 6, alignItems: 'center', fontSize: 12 }}>
        <span>{x.descripcion} · {fN(x.cantidad)} {x.unidad}</span>
        <input type="number" min="0" style={st.input} value={precios[x.id] ?? x.precio_unit} onChange={e => setPrecios(p => ({ ...p, [x.id]: e.target.value }))} />
      </div>)}
      <div style={{ fontSize: 12 }}>Neto final: <b>{fmt(netoFinal)}</b>{netoFinal > Number(s.total_neto) && <span style={{ color: '#B25E09' }}> (+{fmt(netoFinal - s.total_neto)} vs aprobado; si cruza de tramo vuelve a aprobación)</span>}</div>
      <textarea style={{ ...st.input, minHeight: 40 }} placeholder="Notas para el proveedor (opcional)" value={oc.notas} onChange={e => setOc(p => ({ ...p, notas: e.target.value }))} />
      <Btn disabled={busy || !oc.proveedor_id} onClick={() => rpc('fn_cop_emitir_oc', {
        p_id: s.id, p_proveedor_id: oc.proveedor_id, p_condicion: oc.condicion || cat.proveedores.find(p => p.id === oc.proveedor_id)?.condicion_pago || null,
        p_fecha_entrega: oc.fecha || null, p_notas: oc.notas || null,
        p_items: Object.keys(precios).length ? items.map(x => ({ id: x.id, precio_unit: Number(precios[x.id] ?? x.precio_unit) || 0 })) : null,
      }, 'OC emitida')}>Emitir OC</Btn>
    </Caja>}

    {accion === 'recibir' && <Caja titulo={s.tipo === 'servicio' ? 'Recepción conforme del servicio' : 'Recepción de bienes'} onCancel={() => setAccion(null)}>
      {items.map(x => <div key={x.id} style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 6, alignItems: 'center', fontSize: 12 }}>
        <span>{x.descripcion} · pedido {fN(x.cantidad)} {x.unidad}</span>
        <input type="number" min="0" style={st.input} value={recib[x.id] ?? x.cantidad} onChange={e => setRecib(p => ({ ...p, [x.id]: e.target.value }))} />
      </div>)}
      <textarea style={{ ...st.input, minHeight: 44 }} placeholder="Observaciones (obligatorio si no está conforme)" value={txt} onChange={e => setTxt(e.target.value)} />
      <div style={{ display: 'flex', gap: 6 }}>
        <Btn kind="ok" disabled={busy} onClick={() => rpc('fn_cop_recibir', { p_id: s.id, p_conforme: true, p_obs: txt || null, p_items: items.map(x => ({ id: x.id, cantidad_recibida: Number(recib[x.id] ?? x.cantidad) })) }, 'Recepción conforme registrada')}>Conforme</Btn>
        <Btn kind="bad" disabled={busy || !txt.trim()} onClick={() => rpc('fn_cop_recibir', { p_id: s.id, p_conforme: false, p_obs: txt, p_items: items.map(x => ({ id: x.id, cantidad_recibida: Number(recib[x.id] ?? x.cantidad) })) }, 'Recepción con observaciones registrada')}>Con observaciones</Btn>
      </div>
    </Caja>}

    {accion === 'cerrar' && <Caja titulo="Asociar factura y cerrar" onCancel={() => setAccion(null)}>
      <div style={{ fontSize: 11, color: '#6E6E73' }}>Facturas de los últimos 150 días de {prov?.nombre || 'este proveedor'} en el libro de compras (BSALE/SII). Neto OC: <b>{fmt(s.total_neto)}</b></div>
      {facts === 'cargando' ? <div style={{ fontSize: 12 }}>Buscando…</div> :
        <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 6 }}>
          {(facts || []).length === 0 && <div style={{ padding: 8, fontSize: 12, color: '#6E6E73' }}>Sin facturas del proveedor en el libro. Usa el folio manual.</div>}
          {(facts || []).map(fc => {
            const dif = Number(fc.monto_neto) - Number(s.total_neto)
            return <label key={fc.id} style={{ display: 'grid', gridTemplateColumns: '18px 1fr auto', gap: 6, padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #F2F4F7', cursor: 'pointer', background: factSel === fc.id ? '#E8EBF3' : undefined }}>
              <input type="radio" checked={factSel === fc.id} onChange={() => setFactSel(fc.id)} />
              <span>Folio {fc.folio} · {fFecha(fc.fecha_emision)} · {fc.razon_social}</span>
              <span style={{ textAlign: 'right' }}>{fmt(fc.monto_neto)} {dif !== 0 && <span style={{ color: Math.abs(dif) > 1000 ? '#B25E09' : '#6E6E73' }}>({dif > 0 ? '+' : ''}{fmt(dif)})</span>}</span>
            </label>
          })}
        </div>}
      <input style={st.input} placeholder="…o folio manual (si aún no está en el libro)" value={folio} onChange={e => { setFolio(e.target.value); if (e.target.value) setFactSel(null) }} />
      <Btn disabled={busy || (!factSel && !folio.trim())} onClick={() => rpc('fn_cop_cerrar', { p_id: s.id, p_libro_compras_id: factSel, p_factura_folio: factSel ? null : folio.trim(), p_comentario: null }, 'Cerrada')}>Cerrar OC</Btn>
    </Caja>}

    {msg && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: msg.bad ? '#B42318' : '#1E7A44' }}>{msg.t}</div>}

    <Adjuntos s={s} cu={cu} sugerido={accion === 'recibir' ? (s.tipo === 'servicio' ? 'acta' : 'guia') : accion === 'cerrar' ? 'factura' : s.estado === 'Borrador' ? 'cotizacion' : 'otro'} />

    <div style={{ marginTop: 16, fontSize: 12, fontWeight: 700, color: '#344054' }}>Bitácora</div>
    <div style={{ marginTop: 6, borderLeft: `2px solid ${C1}33`, paddingLeft: 10 }}>
      <div style={{ fontSize: 12, marginBottom: 6 }}><span style={{ color: '#6E6E73' }}>{fFechaHora(s.created_at)}</span> · {s.solicitante_nombre} creó la solicitud</div>
      {evs.map(e => <div key={e.id} style={{ fontSize: 12, marginBottom: 6 }}>
        <span style={{ color: '#6E6E73' }}>{fFechaHora(e.created_at)}</span> · <b>{e.usuario_nombre}</b> {ACCION_TXT[e.accion] || e.accion}{e.nivel ? ` (nivel ${e.nivel})` : ''} → <Estado e={e.estado_hasta} />
        {e.comentario && <div style={{ color: '#475467', marginTop: 2 }}>{e.comentario}</div>}
      </div>)}
    </div>
  </div>
}

function Caja({ titulo, children, onCancel }) {
  return <div style={{ marginTop: 10, padding: 10, border: `1px solid ${BORDE}`, borderLeft: `4px solid ${NAVY}`, background: '#F8F9FB', borderRadius: 8, display: 'grid', gap: 8 }}>
    <div style={{ display: 'flex', alignItems: 'center' }}><b style={{ flex: 1, fontSize: 13 }}>{titulo}</b><button onClick={onCancel} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6E6E73' }}>Cancelar</button></div>
    {children}
  </div>
}

/* ═══ PANEL DE GASTO ══════════════════════════════════════════════════════ */
function Panel({ sols, pagos, catNom, cecoNom, sucNom, provNom }) {
  const [desde, setDesde] = useState(() => hoy().slice(0, 8) + '01')
  const [hasta, setHasta] = useState(hoy())
  const comprometidas = sols.filter(s => s.oc_numero && !['Anulada'].includes(s.estado) && String(s.oc_emitida_at || '').slice(0, 10) >= desde && String(s.oc_emitida_at || '').slice(0, 10) <= hasta)
  const tot = comprometidas.reduce((t, s) => t + Number(s.total_neto || 0), 0)
  const ciclos = sols.filter(s => s.oc_emitida_at).map(s => diasEntre(s.created_at, s.oc_emitida_at))
  const ciclo = ciclos.length ? (ciclos.reduce((a, b) => a + b, 0) / ciclos.length).toFixed(1) : '—'
  const pend = sols.filter(s => s.estado === 'Pend. aprobación')
  const pendViejas = pend.filter(s => diasEntre(s.updated_at || s.created_at, new Date().toISOString()) >= 2).length
  const sinCerrar = sols.filter(s => ['Recibida', 'Recibida con obs.'].includes(s.estado))
  const oc = sols.filter(s => s.estado === 'OC emitida')
  const atrasadas = oc.filter(s => s.fecha_entrega_comprometida && s.fecha_entrega_comprometida < hoy()).length

  const agrupar = keyFn => {
    const m = {}
    comprometidas.forEach(s => { const k = keyFn(s); m[k] = m[k] || { k, n: 0, neto: 0 }; m[k].n++; m[k].neto += Number(s.total_neto || 0) })
    return Object.values(m).sort((a, b) => b.neto - a.neto).map(r => ({ ...r, pct: tot ? Math.round(r.neto / tot * 1000) / 10 : 0 }))
  }
  const colsAg = label => [
    { key: 'k', label, width: 260 },
    { key: 'n', label: 'OC', align: 'right', width: 60 },
    { key: 'neto', label: 'Neto comprometido', align: 'right', width: 140, render: r => fmt(r.neto) },
    { key: 'pct', label: '% del total', align: 'right', width: 90, render: r => r.pct + '%' },
  ]
  return <div style={{ display: 'grid', gap: 12 }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
      <Campo label="OC emitidas desde"><input type="date" style={st.input} value={desde} onChange={e => setDesde(e.target.value)} /></Campo>
      <Campo label="hasta"><input type="date" style={st.input} value={hasta} onChange={e => setHasta(e.target.value)} /></Campo>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
      <Kpi v={fmt(tot)} l={`Gasto comprometido (${comprometidas.length} OC)`} />
      <Kpi v={pend.length} l={`Pend. aprobación (${pendViejas} con +2 días)`} warn={pendViejas > 0} />
      <Kpi v={oc.length} l={`OC en curso (${atrasadas} atrasadas)`} warn={atrasadas > 0} />
      <Kpi v={sinCerrar.length} l="Recibidas sin factura" warn={sinCerrar.length > 0} />
      <Kpi v={ciclo + ' d'} l="Ciclo solicitud → OC (prom.)" />
      {(() => { const pp = sols.filter(s => s.estado === 'Cerrada' && ['Por pagar', 'Vencida'].includes(estadoPago(s, pagos).t)); const v = pp.filter(s => estadoPago(s, pagos).t === 'Vencida').length
        return <Kpi v={fmt(pp.reduce((t, s) => t + Number(pagos[s.libro_compras_id]?.monto_total || 0), 0))} l={`Facturas por pagar (${pp.length}, ${v} vencidas)`} warn={v > 0} /> })()}
    </div>
    <DataGrid columns={colsAg('Centro de costo')} rows={agrupar(s => `${s.centro_costo_codigo} ${cecoNom[s.centro_costo_codigo] || ''}`)} getRowId={r => r.k} title="Por centro de costo" exportName="cop_gasto_ceco" />
    <DataGrid columns={colsAg('Categoría')} rows={agrupar(s => catNom[s.categoria_id] || s.categoria_id)} getRowId={r => r.k} title="Por categoría" exportName="cop_gasto_categoria" />
    <DataGrid columns={colsAg('Proveedor')} rows={agrupar(s => provNom[s.proveedor_id] || '—')} getRowId={r => r.k} title="Por proveedor" exportName="cop_gasto_proveedor" />
    <DataGrid columns={colsAg('Sucursal')} rows={agrupar(s => sucNom[s.sucursal_id] || s.sucursal_id)} getRowId={r => r.k} title="Por sucursal" exportName="cop_gasto_sucursal" />
  </div>
}

/* ═══ CONFIGURACIÓN ═══════════════════════════════════════════════════════ */
function Config({ cat, onSaved }) {
  const [reglas, setReglas] = useState(cat.reglas)
  const [cats, setCats] = useState(cat.categorias)
  const [msg, setMsg] = useState(null)
  useEffect(() => { setReglas(cat.reglas); setCats(cat.categorias) }, [cat])
  const guardar = async () => {
    setMsg(null)
    try {
      for (const r of reglas) {
        const o = cat.reglas.find(x => x.nivel === r.nivel)
        if (o && (o.monto_desde !== r.monto_desde || o.nombre !== r.nombre || o.activo !== r.activo)) {
          const x = await supabase.from('cop_reglas_aprobacion').update({ monto_desde: Number(r.monto_desde) || 0, nombre: r.nombre, activo: r.activo }).eq('nivel', r.nivel)
          if (x.error) throw x.error
        }
      }
      for (const c of cats) {
        const o = cat.categorias.find(x => x.id === c.id)
        if (o && (o.cuenta_codigo !== c.cuenta_codigo || o.activo !== c.activo || o.nombre !== c.nombre)) {
          const x = await supabase.from('cop_categorias').update({ cuenta_codigo: c.cuenta_codigo, activo: c.activo, nombre: c.nombre }).eq('id', c.id)
          if (x.error) throw x.error
        }
      }
      setMsg({ t: 'Guardado' }); await onSaved()
    } catch (e) { setMsg({ bad: true, t: errMsg(e) }) }
  }
  return <div style={{ display: 'grid', gap: 12 }}>
    <div style={st.card}>
      <b>Tramos de aprobación</b>
      <div style={{ fontSize: 12, color: '#6E6E73', margin: '4px 0 8px' }}>Un nivel aplica cuando el neto supera su "desde". Las firmas son en orden y cada nivel lo firma una persona distinta; nadie aprueba su propia solicitud. Cambios afectan solo solicitudes que se envíen después.</div>
      {reglas.map((r, i) => <div key={r.nivel} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 150px 180px 70px', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 12 }}>
        <b>Nivel {r.nivel}</b>
        <input style={st.input} value={r.nombre} onChange={e => setReglas(p => p.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} />
        <input type="number" style={st.input} value={r.monto_desde} onChange={e => setReglas(p => p.map((x, j) => j === i ? { ...x, monto_desde: e.target.value } : x))} />
        <span style={{ color: '#6E6E73' }}>neto &gt; {fmt(r.monto_desde)} · {r.capability_id}</span>
        <label><input type="checkbox" checked={r.activo} onChange={e => setReglas(p => p.map((x, j) => j === i ? { ...x, activo: e.target.checked } : x))} /> activo</label>
      </div>)}
    </div>
    <div style={st.card}>
      <b>Categorías y cuenta contable</b>
      <div style={{ fontSize: 12, color: '#6E6E73', margin: '4px 0 8px' }}>La cuenta define dónde cae el gasto en el EERR. Valídalo con contabilidad.</div>
      {cats.map((c, i) => <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 80px 300px 70px', gap: 8, alignItems: 'center', marginBottom: 4, fontSize: 12 }}>
        <span style={{ fontFamily: 'ui-monospace,monospace' }}>{c.id}</span>
        <input style={st.input} value={c.nombre} onChange={e => setCats(p => p.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} />
        <span>{c.tipo}</span>
        <select style={st.input} value={c.cuenta_codigo || ''} onChange={e => setCats(p => p.map((x, j) => j === i ? { ...x, cuenta_codigo: e.target.value || null } : x))}>
          <option value="">—</option>{cat.cuentas.map(x => <option key={x.codigo} value={x.codigo}>{x.codigo} · {x.nombre}</option>)}
        </select>
        <label><input type="checkbox" checked={c.activo} onChange={e => setCats(p => p.map((x, j) => j === i ? { ...x, activo: e.target.checked } : x))} /> activa</label>
      </div>)}
    </div>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Btn onClick={guardar}>Guardar configuración</Btn>{msg && <span style={{ fontSize: 12, color: msg.bad ? '#B42318' : '#1E7A44' }}>{msg.t}</span>}</div>
    <div style={{ ...st.card, fontSize: 12, color: '#475467' }}>Los roles y usuarios de esta app se asignan en <b>Administración → Matriz de accesos</b> (app "Compras Operación").</div>
  </div>
}

/* ═══ ADJUNTOS (bucket privado cop-adjuntos, carpeta = id de la solicitud) ═══ */
const TIPOS_ADJ = { cotizacion: 'Cotización', foto: 'Foto', guia: 'Guía de despacho', acta: 'Acta / recepción servicio', factura: 'Factura', otro: 'Otro' }
function Adjuntos({ s, cu, sugerido }) {
  const [lista, setLista] = useState([])
  const [tipo, setTipo] = useState(sugerido)
  const [subiendo, setSubiendo] = useState(false)
  const [err, setErr] = useState(null)
  const cerrada = ['Cerrada', 'Anulada'].includes(s.estado)
  useEffect(() => { setTipo(sugerido) }, [sugerido])
  const cargar = useCallback(async () => {
    const r = await supabase.from('cop_adjuntos').select('id,tipo,path,nombre,mime,bytes,subido_por,subido_por_nombre,created_at').eq('solicitud_id', s.id).order('created_at')
    setLista(r.data || [])
  }, [s.id])
  useEffect(() => { cargar() }, [cargar])

  const subir = async (files) => {
    setErr(null); setSubiendo(true)
    try {
      for (const f of files) {
        if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name} supera 10 MB`)
        const limpio = f.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)
        const path = `${s.id}/${Date.now()}_${limpio}`
        const up = await supabase.storage.from('cop-adjuntos').upload(path, f, { contentType: f.type || undefined, upsert: false })
        if (up.error) throw up.error
        const ins = await supabase.from('cop_adjuntos').insert({ solicitud_id: s.id, tipo, path, nombre: f.name, mime: f.type || null, bytes: f.size })
        if (ins.error) { await supabase.storage.from('cop-adjuntos').remove([path]); throw ins.error }
      }
      await cargar()
    } catch (e) { setErr(errMsg(e)) } finally { setSubiendo(false) }
  }
  const abrir = async (a) => {
    const r = await supabase.storage.from('cop-adjuntos').createSignedUrl(a.path, 300)
    if (r.error) { setErr(errMsg(r.error)); return }
    window.open(r.data.signedUrl, '_blank', 'noopener')
  }
  const borrar = async (a) => {
    if (!window.confirm(`¿Eliminar ${a.nombre}?`)) return
    const d = await supabase.from('cop_adjuntos').delete().eq('id', a.id).select('id')
    if (d.error || !d.data?.length) { setErr(d.error ? errMsg(d.error) : 'Solo quien lo subió puede eliminarlo, y no en solicitudes cerradas'); return }
    await supabase.storage.from('cop-adjuntos').remove([a.path])
    await cargar()
  }
  const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round((n || 0) / 1024) + ' KB'

  return <div style={{ marginTop: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <b style={{ fontSize: 12, color: '#344054', flex: 1 }}>Adjuntos ({lista.length})</b>
      {!cerrada && <>
        <select style={{ ...st.input, width: 170, padding: '4px 6px', fontSize: 12 }} value={tipo} onChange={e => setTipo(e.target.value)}>
          {Object.entries(TIPOS_ADJ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label style={{ fontSize: 12, fontWeight: 600, color: C1, cursor: subiendo ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
          {subiendo ? 'Subiendo…' : '+ Adjuntar'}
          <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.docx,image/*" style={{ display: 'none' }} disabled={subiendo}
            onChange={e => { const fs = [...(e.target.files || [])]; e.target.value = ''; if (fs.length) subir(fs) }} />
        </label>
      </>}
    </div>
    {err && <div style={{ fontSize: 12, color: '#B42318', marginTop: 4 }}>{err}</div>}
    {lista.length > 0 && <div style={{ marginTop: 6, border: '1px solid #E5E7EB', borderRadius: 6 }}>
      {lista.map(a => <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto auto', gap: 8, alignItems: 'center', padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #F2F4F7' }}>
        <span style={{ color: '#6E6E73' }}>{TIPOS_ADJ[a.tipo] || a.tipo}</span>
        <button onClick={() => abrir(a)} style={{ textAlign: 'left', border: 'none', background: 'none', color: C2, cursor: 'pointer', padding: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${a.subido_por_nombre} · ${fFechaHora(a.created_at)}`}>{a.nombre}</button>
        <span style={{ color: '#98A2B3' }}>{kb(a.bytes)}</span>
        {!cerrada && a.subido_por === cu.id ? <button onClick={() => borrar(a)} title="Eliminar" style={{ border: 'none', background: 'none', color: '#98A2B3', cursor: 'pointer' }}>×</button> : <span />}
      </div>)}
    </div>}
  </div>
}

/* ═══ NUEVO PROVEEDOR (busca primero en el libro de compras: RUT y razón social del SII) ═══ */
function NuevoProveedor({ cat, sugerido, onCancel, onCreated }) {
  const [q, setQ] = useState(sugerido || '')
  const [res, setRes] = useState([])
  const [f, setF] = useState({ rut: '', nombre: '', correo: '', telefono: '', condicion: '', encargado: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const norm = r => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase()
  const existentes = useMemo(() => new Set(cat.proveedores.map(p => norm(p.rut)).filter(Boolean)), [cat.proveedores])

  useEffect(() => {
    const t = setTimeout(async () => {
      const txt = q.trim()
      if (txt.length < 3) { setRes([]); return }
      const soloRut = norm(txt)
      let qq = supabase.from('libro_compras').select('rut_proveedor,razon_social,fecha_emision').order('fecha_emision', { ascending: false }).limit(300)
      qq = /^[0-9kK.\-\s]+$/.test(txt) && soloRut.length >= 5 ? qq.ilike('rut_proveedor', `%${soloRut.slice(0, 6)}%`) : qq.ilike('razon_social', `%${txt}%`)
      const r = await qq
      const m = new Map()
      ;(r.data || []).forEach(x => { const k = norm(x.rut_proveedor); if (k && !m.has(k)) m.set(k, { rut: x.rut_proveedor, nombre: x.razon_social, ult: x.fecha_emision, n: 0 }); if (k) m.get(k).n++ })
      setRes([...m.values()].slice(0, 12))
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const crear = async () => {
    setErr(null)
    if (!f.rut.trim() || !f.nombre.trim()) { setErr('RUT y razón social son obligatorios'); return }
    setBusy(true)
    try {
      const r = await supabase.rpc('fn_cop_crear_proveedor', { p_rut: f.rut, p_nombre: f.nombre, p_correo: f.correo || null, p_telefono: f.telefono || null, p_condicion: f.condicion || null, p_encargado: f.encargado || null })
      if (r.error) throw r.error
      await onCreated(r.data.id, r.data.existente)
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  return <div style={{ padding: 10, border: `1px dashed #D0D5DD`, borderRadius: 8, background: '#fff', display: 'grid', gap: 8 }}>
    <div style={{ display: 'flex' }}><b style={{ flex: 1, fontSize: 12 }}>Nuevo proveedor</b><button onClick={onCancel} style={{ border: 'none', background: 'none', color: '#6E6E73', cursor: 'pointer', fontSize: 12 }}>Cancelar</button></div>
    <input style={st.input} placeholder="Busca en el libro de compras por razón social o RUT" value={q} onChange={e => setQ(e.target.value)} />
    {res.length > 0 && <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 6 }}>
      {res.map(x => { const ya = existentes.has(norm(x.rut))
        return <div key={x.rut} onClick={() => !ya && setF(p => ({ ...p, rut: x.rut, nombre: x.nombre }))}
          style={{ padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #F2F4F7', cursor: ya ? 'default' : 'pointer', color: ya ? '#98A2B3' : undefined, background: norm(f.rut) === norm(x.rut) ? '#E8EBF3' : undefined }}>
          <b>{x.nombre}</b> · {x.rut} · {x.n} factura{x.n > 1 ? 's' : ''}, última {fFecha(x.ult)}{ya && ' · ya está en proveedores'}
        </div> })}
    </div>}
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 6 }}>
      <input style={st.input} placeholder="RUT" value={f.rut} onChange={e => setF(p => ({ ...p, rut: e.target.value }))} />
      <input style={st.input} placeholder="Razón social" value={f.nombre} onChange={e => setF(p => ({ ...p, nombre: e.target.value }))} />
      <input style={st.input} placeholder="Contacto" value={f.encargado} onChange={e => setF(p => ({ ...p, encargado: e.target.value }))} />
      <input style={st.input} placeholder="Correo" value={f.correo} onChange={e => setF(p => ({ ...p, correo: e.target.value }))} />
      <input style={st.input} placeholder="Teléfono" value={f.telefono} onChange={e => setF(p => ({ ...p, telefono: e.target.value }))} />
      <input style={st.input} placeholder="Condición de pago (ej: 30 días)" value={f.condicion} onChange={e => setF(p => ({ ...p, condicion: e.target.value }))} />
    </div>
    {err && <div style={{ fontSize: 12, color: '#B42318' }}>{err}</div>}
    <div><Btn small disabled={busy} onClick={crear}>{busy ? 'Creando…' : 'Crear y seleccionar'}</Btn></div>
  </div>
}
