import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'
import { preloadCaps, canSync } from '../core/permisos'
import { deepLink } from '../core/deeplink'
import { DataGrid } from '../finanzas/conciliacion/DataGrid'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

/* ═══════════════════════════════════════════════════════════════════════════
   COMPRAS OPERACIÓN — compras indirectas (insumos, aseo, herramientas, servicios)
   Flujo: Borrador → Pend. aprobación (N1/N2 por monto) → Aprobada → OC emitida
          → Recibida / Recibida con obs. → Cerrada (match con factura)
   Todo cambio de estado va por RPC fn_cop_* (SECURITY DEFINER): el cliente solo
   edita borradores. Triggers en BD bloquean saltos de flujo y la bitácora es
   inmutable. Tablas propias cop_*; maestros compartidos: proveedores,
   sucursales, centros_costo, plan_cuentas, libro_compras.
   ═══════════════════════════════════════════════════════════════════════════ */

const C1 = '#0f766e'
const C2 = '#115e59'
const APP = 'compras_op'

const fmt = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL')
const fN = n => Math.round(Number(n) || 0).toLocaleString('es-CL')
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })
const fFecha = s => { if (!s) return '—'; const d = String(s).slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}-${d[1]}-${d[0]}` : s }
const fFechaHora = s => s ? new Date(s).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const diasEntre = (a, b) => (a && b) ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000)) : null
const errMsg = e => String(e?.message || e || 'Error').replace(/^COP:\s*/, '')

const ESTADOS = {
  'Borrador':          { c: '#6b7280', bg: '#f3f4f6' },
  'Pend. aprobación':  { c: '#b45309', bg: '#fef3c7' },
  'Aprobada':          { c: '#1d4ed8', bg: '#dbeafe' },
  'OC emitida':        { c: '#0f766e', bg: '#ccfbf1' },
  'Recibida':          { c: '#15803d', bg: '#dcfce7' },
  'Recibida con obs.': { c: '#c2410c', bg: '#ffedd5' },
  'Cerrada':           { c: '#374151', bg: '#e5e7eb' },
  'Rechazada':         { c: '#b91c1c', bg: '#fee2e2' },
  'Anulada':           { c: '#9ca3af', bg: '#f3f4f6' },
}
const ABIERTAS = ['Borrador', 'Pend. aprobación', 'Aprobada', 'OC emitida', 'Recibida', 'Recibida con obs.']
const URG = { normal: { l: 'Normal', c: '#6b7280' }, alta: { l: 'Alta', c: '#b45309' }, critica: { l: 'Crítica', c: '#b91c1c' } }
const ACCION_TXT = { enviar: 'Envió a aprobación', aprobar: 'Aprobó', rechazar: 'Rechazó', emitir_oc: 'Emitió OC', recibir: 'Registró recepción', cerrar: 'Cerró con factura', anular: 'Anuló', reabrir: 'Reabrió', reaprobacion: 'Volvió a aprobación' }
// Sucursal → sufijo del centro de costo (tabla centros_costo: 10X01 CD, 02 Maipú, 03 LA, 04 LG)
const SUF_CECO = { 'suc-mp': '01', 'suc-maipu': '02', 'suc-la': '03', 'suc-lg': '04' }

/* ── UI mínima ─────────────────────────────────────────────────────────── */
const st = {
  input: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', background: '#fff' },
  lbl: { fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 3, display: 'block' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14 },
}
function Btn({ children, onClick, kind = 'pri', disabled, small, title }) {
  const k = {
    pri: { background: C1, color: '#fff', border: `1px solid ${C1}` },
    sec: { background: '#fff', color: '#1f2937', border: '1px solid #d1d5db' },
    ok: { background: '#15803d', color: '#fff', border: '1px solid #15803d' },
    bad: { background: '#fff', color: '#b91c1c', border: '1px solid #fca5a5' },
  }[kind]
  return <button title={title} disabled={disabled} onClick={onClick}
    style={{ ...k, padding: small ? '4px 10px' : '7px 14px', borderRadius: 6, fontSize: small ? 12 : 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{children}</button>
}
function Estado({ e }) {
  const s = ESTADOS[e] || ESTADOS.Borrador
  return <span style={{ fontSize: 11, fontWeight: 700, color: s.c, background: s.bg, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>{e}</span>
}
function Campo({ label, children, span = 1 }) {
  return <div style={{ gridColumn: `span ${span}` }}><label style={st.lbl}>{label}</label>{children}</div>
}
function Kpi({ v, l, warn, onClick }) {
  return <div onClick={onClick} style={{ ...st.card, padding: '10px 14px', cursor: onClick ? 'pointer' : 'default', borderLeft: `3px solid ${warn ? '#b45309' : C1}` }}>
    <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{l}</div>
  </div>
}

/* ═══ APP ═════════════════════════════════════════════════════════════════ */
export function ComprasOpApp({ cu, setAppActual }) {
  const [capsOk, setCapsOk] = useState(false)
  const [tab, setTab] = useState(() => (deepLink?.app === APP && deepLink.modulo) || 'solicitudes')
  const [sols, setSols] = useState([])
  const [cat, setCat] = useState({ categorias: [], reglas: [], sucursales: [], cecos: [], proveedores: [], cuentas: [] })
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState(null)
  const [selId, setSelId] = useState(() => (deepLink?.app === APP && deepLink.params?.sol) || null)
  const [editando, setEditando] = useState(null)   // null | 'nueva' | id

  useEffect(() => { if (cu?.id) preloadCaps(cu, APP).then(() => setCapsOk(true)) }, [cu?.id])
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
      setSols(s.data || [])
      setCat({ categorias: c.data || [], reglas: r.data || [], sucursales: (su.data || []).filter(x => x.activo !== false), cecos: cc.data || [], proveedores: pr.data || [], cuentas: pc.data || [] })
    } catch (e) { setErr(errMsg(e)) } finally { setCargando(false) }
  }, [])
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
  const porFirmar = sols.filter(puedeFirmar)
  const porComprar = sols.filter(s => s.estado === 'Aprobada')
  const porRecibir = sols.filter(s => s.estado === 'OC emitida' && (s.solicitante_id === cu.id || can('cop.recibir') || can('cop.gestionar')))
  const porCerrar = sols.filter(s => ['Recibida', 'Recibida con obs.'].includes(s.estado))

  const TABS = [
    { k: 'solicitudes', l: 'Mis solicitudes', n: mias.filter(s => ABIERTAS.includes(s.estado)).length, show: true },
    { k: 'aprobar', l: 'Por aprobar', n: porFirmar.length, warn: true, show: can('cop.aprobar_n1') || can('cop.aprobar_n2') },
    { k: 'gestion', l: 'Gestión de compras', n: porComprar.length + porCerrar.length, warn: true, show: can('cop.gestionar') },
    { k: 'recepcion', l: 'Recepción', n: porRecibir.length, show: porRecibir.length > 0 || can('cop.recibir') },
    { k: 'todas', l: 'Todas', show: can('cop.ver_todo') },
    { k: 'panel', l: 'Panel de gasto', show: can('cop.ver_todo') },
    { k: 'config', l: 'Configuración', show: can('cop.config') },
  ].filter(t => t.show)
  useEffect(() => { if (capsOk && !TABS.some(t => t.k === tab)) setTab('solicitudes') }, [capsOk]) // eslint-disable-line

  const sel = sols.find(s => s.id === selId) || null
  const volver = () => setAppActual && setAppActual(null)

  const colsBase = [
    { key: 'id', label: 'Solicitud', width: 100, render: r => <b style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12 }}>{r.id}</b> },
    { key: 'oc_numero', label: 'OC', width: 110, render: r => r.oc_numero ? <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, color: C2, fontWeight: 700 }}>{r.oc_numero}</span> : '—' },
    { key: 'estado', label: 'Estado', width: 130, render: r => <Estado e={r.estado} />, value: r => r.estado },
    { key: 'titulo', label: 'Título', width: 240 },
    { key: 'tipo', label: 'Tipo', width: 70, value: r => r.tipo === 'servicio' ? 'Servicio' : 'Bien' },
    { key: 'categoria_id', label: 'Categoría', width: 160, value: r => catNom[r.categoria_id] || r.categoria_id || '' },
    { key: 'sucursal_id', label: 'Sucursal', width: 120, value: r => sucNom[r.sucursal_id] || r.sucursal_id || '' },
    { key: 'centro_costo_codigo', label: 'C. costo', width: 150, value: r => r.centro_costo_codigo ? `${r.centro_costo_codigo} ${cecoNom[r.centro_costo_codigo] || ''}` : '' },
    { key: 'solicitante_nombre', label: 'Solicitante', width: 140 },
    { key: 'proveedor_id', label: 'Proveedor', width: 170, value: r => provNom[r.proveedor_id] || (r.proveedor_sugerido ? `(sug.) ${r.proveedor_sugerido}` : '') },
    { key: 'total_neto', label: 'Neto', align: 'right', width: 100, value: r => Number(r.total_neto) || 0, render: r => fmt(r.total_neto) },
    { key: 'nivel', label: 'Firmas', width: 70, value: r => r.nivel_requerido ? `${r.nivel_aprobado}/${r.nivel_requerido}` : '—' },
    { key: 'urgencia', label: 'Urgencia', width: 80, value: r => URG[r.urgencia]?.l || r.urgencia, render: r => <span style={{ color: URG[r.urgencia]?.c, fontWeight: r.urgencia !== 'normal' ? 700 : 400 }}>{URG[r.urgencia]?.l}</span> },
    { key: 'fecha_requerida', label: 'Requerida', width: 90, value: r => r.fecha_requerida || '', render: r => fFecha(r.fecha_requerida) },
    { key: 'created_at', label: 'Creada', width: 90, value: r => r.created_at, render: r => fFecha(r.created_at) },
  ]
  const grid = (rows, title, name) => <DataGrid columns={colsBase} rows={rows} getRowId={r => r.id} selectedId={selId}
    onRowClick={r => { setSelId(r.id); setEditando(null) }} title={title} exportName={name} loading={cargando} emptyText="Sin solicitudes" />

  return <div style={{ minHeight: '100vh', background: '#f6f7f9', fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',system-ui,sans-serif", color: '#111827', fontSize: 13 }}>
    {/* Header */}
    <div style={{ position: 'sticky', top: 0, zIndex: 30, background: `linear-gradient(135deg, ${C2}, ${C1})`, color: '#fff', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <button onClick={volver} title="Volver al inicio" style={{ background: 'rgba(255,255,255,.15)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontWeight: 700 }}>← Inicio</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>Compras Operación</div>
        <div style={{ fontSize: 11, opacity: .75 }}>Insumos, herramientas, aseo y servicios · {cu.nombre}</div>
      </div>
      {can('cop.solicitar') && <Btn kind="sec" onClick={() => { setEditando('nueva'); setSelId(null) }}>+ Nueva solicitud</Btn>}
    </div>
    {/* Tabs */}
    <div style={{ display: 'flex', gap: 2, padding: '0 18px', background: '#fff', borderBottom: '1px solid #e5e7eb', overflowX: 'auto' }}>
      {TABS.map(t => <button key={t.k} onClick={() => setTab(t.k)} style={{ padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.k ? 700 : 500, color: tab === t.k ? C1 : '#4b5563', borderBottom: `2px solid ${tab === t.k ? C1 : 'transparent'}`, whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
        {t.l}{t.n > 0 && <span style={{ marginLeft: 6, fontSize: 11, background: t.warn ? '#fef3c7' : '#e5e7eb', color: t.warn ? '#92400e' : '#374151', padding: '1px 7px', borderRadius: 10, fontWeight: 700 }}>{t.n}</span>}
      </button>)}
    </div>

    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: (sel || editando) ? 'minmax(0,1fr) minmax(420px, 560px)' : '1fr', gap: 14, alignItems: 'start' }}>
      <div style={{ minWidth: 0 }}>
        {err && <div style={{ ...st.card, borderColor: '#fca5a5', color: '#b91c1c', marginBottom: 10 }}>No se pudo cargar: {err} <Btn small kind="sec" onClick={cargar}>Reintentar</Btn></div>}
        {capsOk && !can('cop.solicitar') && !can('cop.ver_todo') && !can('cop.gestionar') && !can('cop.recibir') && !can('cop.aprobar_n1') && !can('cop.aprobar_n2') &&
          <div style={{ ...st.card, marginBottom: 10 }}>No tienes atribuciones en Compras Operación. Pide a Administración que te asigne un rol.</div>}
        {tab === 'solicitudes' && grid(mias, 'Mis solicitudes', 'mis_solicitudes')}
        {tab === 'aprobar' && grid(porFirmar, 'Esperando tu firma', 'por_aprobar')}
        {tab === 'gestion' && <>
          {grid(porComprar, `Aprobadas por comprar (${porComprar.length})`, 'por_comprar')}
          <div style={{ height: 12 }} />
          {grid(sols.filter(s => s.estado === 'OC emitida'), 'OC emitidas en curso', 'oc_en_curso')}
          <div style={{ height: 12 }} />
          {grid(porCerrar, `Recibidas por cerrar con factura (${porCerrar.length})`, 'por_cerrar')}
        </>}
        {tab === 'recepcion' && grid(can('cop.recibir') || can('cop.gestionar') ? sols.filter(s => s.estado === 'OC emitida') : porRecibir, 'Por recepcionar', 'por_recepcionar')}
        {tab === 'todas' && grid(sols, 'Todas las solicitudes', 'solicitudes_compras_op')}
        {tab === 'panel' && <Panel sols={sols} catNom={catNom} cecoNom={cecoNom} sucNom={sucNom} provNom={provNom} />}
        {tab === 'config' && <Config cat={cat} onSaved={cargar} />}
      </div>

      {editando && <Editor key={editando} id={editando === 'nueva' ? null : editando} cu={cu} cat={cat}
        onClose={() => setEditando(null)} onSaved={async (id) => { await cargar(); setEditando(null); setSelId(id) }} />}
      {!editando && sel && <Detalle key={sel.id} s={sel} cu={cu} cat={cat} can={can} puedeFirmar={puedeFirmar(sel)} regla={regla}
        provNom={provNom} sucNom={sucNom} catNom={catNom} cecoNom={cecoNom}
        onClose={() => setSelId(null)} onEditar={() => setEditando(sel.id)} onChanged={cargar} />}
    </div>
  </div>
}

/* ═══ EDITOR DE BORRADOR ══════════════════════════════════════════════════ */
function Editor({ id, cu, cat, onClose, onSaved }) {
  const sucDef = cu.sucursal_id && SUF_CECO[cu.sucursal_id] ? cu.sucursal_id : ''
  const [f, setF] = useState({ titulo: '', categoria_id: '', sucursal_id: sucDef, centro_costo_codigo: sucDef ? `102${SUF_CECO[sucDef]}` : '', urgencia: 'normal', fecha_requerida: '', proveedor_sugerido: '', justificacion: '', aplica_iva: true })
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
    if (k === 'sucursal_id' && SUF_CECO[v]) {
      const area = (p.centro_costo_codigo || '102').slice(0, 3)
      n.centro_costo_codigo = `${area}${SUF_CECO[v]}`
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

  return <div style={{ ...st.card, position: 'sticky', top: 110, maxHeight: 'calc(100vh - 130px)', overflowY: 'auto' }}>
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ flex: 1, fontSize: 15, fontWeight: 800 }}>{id ? `Editar ${id}` : 'Nueva solicitud de compra'}</div>
      <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#6b7280' }}>×</button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <Campo label="Qué necesitas" span={2}><input style={st.input} value={f.titulo} onChange={e => set('titulo', e.target.value)} placeholder="Ej: Artículos de aseo mensual tienda La Granja" /></Campo>
      <Campo label="Categoría" span={2}>
        <select style={st.input} value={f.categoria_id} onChange={e => set('categoria_id', e.target.value)}>
          <option value="">— Elegir —</option>
          <optgroup label="Bienes">{bienes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</optgroup>
          <optgroup label="Servicios">{servicios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</optgroup>
        </select>
        {catSel && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{catSel.tipo === 'servicio' ? 'Servicio → OC-SRV' : 'Bien → OC-GEN'} · cuenta {catSel.cuenta_codigo} {cat.cuentas.find(x => x.codigo === catSel.cuenta_codigo)?.nombre || ''}</div>}
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

    <div style={{ marginTop: 14, fontSize: 12, fontWeight: 700, color: '#374151' }}>Ítems</div>
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 12 }}>
      <thead><tr style={{ color: '#6b7280', textAlign: 'left' }}>
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
        <td><button onClick={() => setItems(p => p.length > 1 ? p.filter((_, j) => j !== i) : p)} style={{ border: 'none', background: 'none', color: '#9ca3af', cursor: 'pointer' }}>×</button></td>
      </tr>)}</tbody>
    </table>
    <div style={{ marginTop: 6 }}><Btn small kind="sec" onClick={() => setItems(p => [...p, { descripcion: '', cantidad: 1, unidad: 'un', precio_unit: 0 }])}>+ Ítem</Btn></div>

    <div style={{ marginTop: 12, padding: 10, background: '#f9fafb', borderRadius: 6, display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 12 }}>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.aplica_iva} onChange={e => set('aplica_iva', e.target.checked)} /> Afecto a IVA (desmarca para boleta de honorarios / exento)</label><span />
      <span>Neto estimado</span><b style={{ textAlign: 'right' }}>{fmt(neto)}</b>
      <span>IVA</span><span style={{ textAlign: 'right' }}>{fmt(iva)}</span>
      <span>Total</span><b style={{ textAlign: 'right' }}>{fmt(neto + iva)}</b>
      <span style={{ gridColumn: 'span 2', color: '#6b7280', marginTop: 4 }}>
        {nivel === 0 ? 'Bajo el umbral: queda aprobada al enviar.' : `Requiere ${nivel} firma${nivel > 1 ? 's' : ''}: ${cat.reglas.filter(r => r.nivel <= nivel).map(r => r.nombre).join(' → ')}.`}
      </span>
    </div>

    {msg && <div style={{ marginTop: 10, fontSize: 12, color: msg.bad ? '#b91c1c' : '#15803d' }}>{msg.t}</div>}
    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
      <Btn kind="sec" disabled={busy} onClick={() => guardar(false)}>Guardar borrador</Btn>
      <Btn disabled={busy} onClick={() => guardar(true)}>{busy ? 'Enviando…' : 'Enviar a aprobación'}</Btn>
    </div>
  </div>
}

/* ═══ DETALLE + ACCIONES DE FLUJO ═════════════════════════════════════════ */
function Detalle({ s, cu, cat, can, puedeFirmar, regla, provNom, sucNom, catNom, cecoNom, onClose, onEditar, onChanged }) {
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
      setMsg({ t: okTxt + extra }); setAccion(null); setTxt('')
      await onChanged(); await cargarDet()
    } catch (e) { setMsg({ bad: true, t: errMsg(e) }) } finally { setBusy(false) }
  }

  const esMia = s.solicitante_id === cu.id
  const prov = cat.proveedores.find(p => p.id === (s.proveedor_id || oc.proveedor_id))
  const provFil = cat.proveedores.filter(p => p.activo !== false && (!oc.q || `${p.nombre} ${p.rut || ''}`.toLowerCase().includes(oc.q.toLowerCase()))).slice(0, 60)
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

  return <div style={{ ...st.card, position: 'sticky', top: 110, maxHeight: 'calc(100vh - 130px)', overflowY: 'auto' }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b style={{ fontFamily: 'ui-monospace,monospace' }}>{s.id}</b><Estado e={s.estado} />
          {s.oc_numero && <b style={{ fontFamily: 'ui-monospace,monospace', color: C2 }}>{s.oc_numero}</b>}
          {s.urgencia !== 'normal' && <span style={{ fontSize: 11, fontWeight: 700, color: URG[s.urgencia]?.c }}>● {URG[s.urgencia]?.l}</span>}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>{s.titulo}</div>
      </div>
      <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#6b7280' }}>×</button>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '4px 10px', fontSize: 12, marginTop: 10 }}>
      <span style={{ color: '#6b7280' }}>Solicitante</span><span>{s.solicitante_nombre}</span>
      <span style={{ color: '#6b7280' }}>Creada</span><span>{fFecha(s.created_at)} ({edadDias} d)</span>
      <span style={{ color: '#6b7280' }}>Categoría</span><span>{catNom[s.categoria_id]}</span>
      <span style={{ color: '#6b7280' }}>Cuenta</span><span>{s.cuenta_codigo || '—'}</span>
      <span style={{ color: '#6b7280' }}>Sucursal</span><span>{sucNom[s.sucursal_id]}</span>
      <span style={{ color: '#6b7280' }}>C. costo</span><span>{s.centro_costo_codigo} {cecoNom[s.centro_costo_codigo] || ''}</span>
      <span style={{ color: '#6b7280' }}>Requerida</span><span>{fFecha(s.fecha_requerida)}</span>
      <span style={{ color: '#6b7280' }}>Firmas</span><span>{s.nivel_requerido ? `${s.nivel_aprobado} de ${s.nivel_requerido}` : '—'}</span>
      <span style={{ color: '#6b7280' }}>Proveedor</span><span style={{ gridColumn: 'span 3' }}>{provNom[s.proveedor_id] || (s.proveedor_sugerido ? `Sugerido: ${s.proveedor_sugerido}` : '—')}</span>
      {s.justificacion && <><span style={{ color: '#6b7280' }}>Justificación</span><span style={{ gridColumn: 'span 3' }}>{s.justificacion}</span></>}
      {s.recepcion_fecha && <><span style={{ color: '#6b7280' }}>Recepción</span><span style={{ gridColumn: 'span 3' }}>{fFecha(s.recepcion_fecha)} · {s.recepcion_por} · {s.recepcion_conforme ? 'Conforme' : `Con obs.: ${s.recepcion_obs}`}</span></>}
      {s.factura_folio && <><span style={{ color: '#6b7280' }}>Factura</span><span style={{ gridColumn: 'span 3' }}>{s.factura_folio}{s.libro_compras_id ? ' (libro de compras)' : ' (folio manual)'}</span></>}
    </div>

    {ev && <div style={{ marginTop: 10, padding: 8, background: '#fee2e2', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>Rechazada por {ev.usuario_nombre}: {ev.comentario}</div>}

    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12, fontSize: 12 }}>
      <thead><tr style={{ color: '#6b7280', borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
        <th style={{ padding: '4px 2px', fontWeight: 600 }}>Ítem</th><th style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 600 }}>Cant.</th>
        <th style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 600 }}>$ unit.</th><th style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 600 }}>Subtotal</th>
        {s.recepcion_fecha && <th style={{ padding: '4px 2px', textAlign: 'right', fontWeight: 600 }}>Recib.</th>}
      </tr></thead>
      <tbody>{items.map(x => <tr key={x.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
        <td style={{ padding: '4px 2px' }}>{x.descripcion}</td>
        <td style={{ padding: '4px 2px', textAlign: 'right' }}>{fN(x.cantidad)} {x.unidad}</td>
        <td style={{ padding: '4px 2px', textAlign: 'right' }}>{fmt(x.precio_unit)}</td>
        <td style={{ padding: '4px 2px', textAlign: 'right' }}>{fmt(x.subtotal || x.cantidad * x.precio_unit)}</td>
        {s.recepcion_fecha && <td style={{ padding: '4px 2px', textAlign: 'right', color: Number(x.cantidad_recibida) < Number(x.cantidad) ? '#c2410c' : undefined }}>{x.cantidad_recibida == null ? '—' : fN(x.cantidad_recibida)}</td>}
      </tr>)}</tbody>
      <tfoot><tr><td colSpan={3} style={{ padding: '6px 2px', textAlign: 'right', color: '#6b7280' }}>Neto · IVA · Total</td>
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
      {s.oc_numero && <div style={{ fontSize: 11, color: '#b45309' }}>La OC {s.oc_numero} ya fue emitida: avisa al proveedor.</div>}
      <Btn kind="bad" disabled={busy || !txt.trim()} onClick={() => rpc('fn_cop_anular', { p_id: s.id, p_motivo: txt }, 'Anulada')}>Confirmar anulación</Btn>
    </Caja>}

    {accion === 'emitir' && <Caja titulo="Emitir orden de compra" onCancel={() => setAccion(null)}>
      <input style={st.input} placeholder="Buscar proveedor por nombre o RUT" value={oc.q} onChange={e => setOc(p => ({ ...p, q: e.target.value }))} />
      <select style={st.input} size={6} value={oc.proveedor_id} onChange={e => setOc(p => ({ ...p, proveedor_id: e.target.value }))}>
        {provFil.map(p => <option key={p.id} value={p.id}>{p.nombre}{p.rut ? ` · ${p.rut}` : ''}</option>)}
      </select>
      {s.proveedor_sugerido && <div style={{ fontSize: 11, color: '#6b7280' }}>Sugerido por el solicitante: {s.proveedor_sugerido}. Si no existe, créalo primero en Abastecimiento → Config → Proveedores.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Campo label="Condición de pago"><input style={st.input} value={oc.condicion} placeholder={cat.proveedores.find(p => p.id === oc.proveedor_id)?.condicion_pago || 'Ej: 30 días'} onChange={e => setOc(p => ({ ...p, condicion: e.target.value }))} /></Campo>
        <Campo label="Fecha de entrega"><input type="date" style={st.input} value={oc.fecha} onChange={e => setOc(p => ({ ...p, fecha: e.target.value }))} /></Campo>
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>Precio cotizado final (neto)</div>
      {items.map(x => <div key={x.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 6, alignItems: 'center', fontSize: 12 }}>
        <span>{x.descripcion} · {fN(x.cantidad)} {x.unidad}</span>
        <input type="number" min="0" style={st.input} value={precios[x.id] ?? x.precio_unit} onChange={e => setPrecios(p => ({ ...p, [x.id]: e.target.value }))} />
      </div>)}
      <div style={{ fontSize: 12 }}>Neto final: <b>{fmt(netoFinal)}</b>{netoFinal > Number(s.total_neto) && <span style={{ color: '#b45309' }}> (+{fmt(netoFinal - s.total_neto)} vs aprobado; si cruza de tramo vuelve a aprobación)</span>}</div>
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
      <div style={{ fontSize: 11, color: '#6b7280' }}>Facturas de los últimos 150 días de {prov?.nombre || 'este proveedor'} en el libro de compras (BSALE/SII). Neto OC: <b>{fmt(s.total_neto)}</b></div>
      {facts === 'cargando' ? <div style={{ fontSize: 12 }}>Buscando…</div> :
        <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
          {(facts || []).length === 0 && <div style={{ padding: 8, fontSize: 12, color: '#6b7280' }}>Sin facturas del proveedor en el libro. Usa el folio manual.</div>}
          {(facts || []).map(fc => {
            const dif = Number(fc.monto_neto) - Number(s.total_neto)
            return <label key={fc.id} style={{ display: 'grid', gridTemplateColumns: '18px 1fr auto', gap: 6, padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #f3f4f6', cursor: 'pointer', background: factSel === fc.id ? '#ecfdf5' : undefined }}>
              <input type="radio" checked={factSel === fc.id} onChange={() => setFactSel(fc.id)} />
              <span>Folio {fc.folio} · {fFecha(fc.fecha_emision)} · {fc.razon_social}</span>
              <span style={{ textAlign: 'right' }}>{fmt(fc.monto_neto)} {dif !== 0 && <span style={{ color: Math.abs(dif) > 1000 ? '#b45309' : '#6b7280' }}>({dif > 0 ? '+' : ''}{fmt(dif)})</span>}</span>
            </label>
          })}
        </div>}
      <input style={st.input} placeholder="…o folio manual (si aún no está en el libro)" value={folio} onChange={e => { setFolio(e.target.value); if (e.target.value) setFactSel(null) }} />
      <Btn disabled={busy || (!factSel && !folio.trim())} onClick={() => rpc('fn_cop_cerrar', { p_id: s.id, p_libro_compras_id: factSel, p_factura_folio: factSel ? null : folio.trim(), p_comentario: null }, 'Cerrada')}>Cerrar OC</Btn>
    </Caja>}

    {msg && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: msg.bad ? '#b91c1c' : '#15803d' }}>{msg.t}</div>}

    <div style={{ marginTop: 16, fontSize: 12, fontWeight: 700, color: '#374151' }}>Bitácora</div>
    <div style={{ marginTop: 6, borderLeft: `2px solid ${C1}33`, paddingLeft: 10 }}>
      <div style={{ fontSize: 12, marginBottom: 6 }}><span style={{ color: '#6b7280' }}>{fFechaHora(s.created_at)}</span> · {s.solicitante_nombre} creó la solicitud</div>
      {evs.map(e => <div key={e.id} style={{ fontSize: 12, marginBottom: 6 }}>
        <span style={{ color: '#6b7280' }}>{fFechaHora(e.created_at)}</span> · <b>{e.usuario_nombre}</b> {ACCION_TXT[e.accion] || e.accion}{e.nivel ? ` (nivel ${e.nivel})` : ''} → <Estado e={e.estado_hasta} />
        {e.comentario && <div style={{ color: '#4b5563', marginTop: 2 }}>{e.comentario}</div>}
      </div>)}
    </div>
  </div>
}

function Caja({ titulo, children, onCancel }) {
  return <div style={{ marginTop: 10, padding: 10, border: `1px solid ${C1}55`, background: '#f0fdfa', borderRadius: 8, display: 'grid', gap: 8 }}>
    <div style={{ display: 'flex', alignItems: 'center' }}><b style={{ flex: 1, fontSize: 13 }}>{titulo}</b><button onClick={onCancel} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280' }}>Cancelar</button></div>
    {children}
  </div>
}

/* ═══ PANEL DE GASTO ══════════════════════════════════════════════════════ */
function Panel({ sols, catNom, cecoNom, sucNom, provNom }) {
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
      <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 8px' }}>Un nivel aplica cuando el neto supera su "desde". Las firmas son en orden y cada nivel lo firma una persona distinta; nadie aprueba su propia solicitud. Cambios afectan solo solicitudes que se envíen después.</div>
      {reglas.map((r, i) => <div key={r.nivel} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 150px 180px 70px', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 12 }}>
        <b>Nivel {r.nivel}</b>
        <input style={st.input} value={r.nombre} onChange={e => setReglas(p => p.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} />
        <input type="number" style={st.input} value={r.monto_desde} onChange={e => setReglas(p => p.map((x, j) => j === i ? { ...x, monto_desde: e.target.value } : x))} />
        <span style={{ color: '#6b7280' }}>neto &gt; {fmt(r.monto_desde)} · {r.capability_id}</span>
        <label><input type="checkbox" checked={r.activo} onChange={e => setReglas(p => p.map((x, j) => j === i ? { ...x, activo: e.target.checked } : x))} /> activo</label>
      </div>)}
    </div>
    <div style={st.card}>
      <b>Categorías y cuenta contable</b>
      <div style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 8px' }}>La cuenta define dónde cae el gasto en el EERR. Valídalo con contabilidad.</div>
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
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Btn onClick={guardar}>Guardar configuración</Btn>{msg && <span style={{ fontSize: 12, color: msg.bad ? '#b91c1c' : '#15803d' }}>{msg.t}</span>}</div>
    <div style={{ ...st.card, fontSize: 12, color: '#4b5563' }}>Los roles y usuarios de esta app se asignan en <b>Administración → Matriz de accesos</b> (app "Compras Operación").</div>
  </div>
}
