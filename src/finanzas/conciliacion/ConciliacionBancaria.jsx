import { useEffect, useMemo, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../supabase'
import { DataGrid } from './DataGrid'
import { fetchVinculados, fetchFacturasCandidatas, vincularRespaldo, desvincular, extraerRut } from './api_conciliar'

/* ═══════════════════════════════════════════════════════════════════════
   CONCILIACIÓN BANCARIA — banco de trabajo
   Patrón "una línea del banco, todas las acciones" (Xero / SAP FI-BL):
     · izquierda: la cartola del mes en grilla, con estado por línea
     · derecha:   la línea seleccionada y lo que se puede hacer con ella
   Reemplaza: Bandeja de sugerencias + Conciliar con respaldos +
   Clasificar movimientos, que eran tres pestañas para el mismo objeto.
   Backend: el existente (api_conciliar.js, fn_aceptar_combo,
   fn_aceptar_pago_fraccionado, fn_rechazar_sugerencia). Cero lógica nueva.
   ═══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', AZUL = '#1D4ED8'
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fF = f => f ? String(f).slice(0, 10) : ''
const MES_ACTUAL = new Date().toISOString().slice(0, 7)
// 'YYYY-MM' -> mes siguiente. Se usa para acotar rangos con [inicio, inicioMesSiguiente)
// y así no depender de cuántos días tiene el mes (abr/jun/sep/nov = 30, feb = 28/29).
const mesSiguiente = m => { const [a, mm] = String(m).split('-').map(Number); return mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, '0')}` }
const MESES = (() => { const out = []; let m = '2026-01'; while (m <= MES_ACTUAL) { out.push(m); m = mesSiguiente(m) } return out })()

/* Qué necesita cada línea. Deriva del estado + tipo de respaldo + lo aplicado. */
const SITUACION = {
  sin_clasificar: { l: 'Sin clasificar', c: AMBAR,  bg: '#FFFBEB', d: 'Falta la subcuenta: no sabemos qué es' },
  por_conciliar:  { l: 'Por conciliar',  c: ROJO,   bg: '#FEF2F2', d: 'Es pago de factura y aún no tiene la factura vinculada' },
  parcial:        { l: 'Parcial',        c: AMBAR,  bg: '#FFFBEB', d: 'Tiene facturas vinculadas pero no cubren el monto' },
  conciliado:     { l: 'Conciliado',     c: VERDE,  bg: null,      d: 'Facturas vinculadas cubren el monto' },
  explicado:      { l: 'Explicado',      c: SLATE,  bg: null,      d: 'Clasificado con un respaldo que no es factura' },
  sin_tipo:       { l: 'Sin tipo',       c: AZUL,   bg: '#EFF6FF', d: 'Tiene subcuenta pero no se declaró tipo de respaldo' },
}
function situacionDe(r) {
  const monto = Math.abs(Number(r.monto) || 0)
  const aplicado = (r.conciliaciones ?? []).reduce((s, c) => s + (Number(c.monto_aplicado) || 0), 0)
  if (!r.subcuenta_id) return { k: 'sin_clasificar', aplicado, pendiente: monto }
  if (r.tipo_respaldo === 'factura_compra') {
    if (aplicado <= 0) return { k: 'por_conciliar', aplicado, pendiente: monto }
    if (aplicado >= monto - 0.5) return { k: 'conciliado', aplicado, pendiente: 0 }
    return { k: 'parcial', aplicado, pendiente: monto - aplicado }
  }
  if (!r.tipo_respaldo) return { k: 'sin_tipo', aplicado, pendiente: 0 }
  return { k: 'explicado', aplicado, pendiente: 0 }
}

const TIPOS_RESPALDO = [
  ['factura_compra', 'Factura de compra (se concilia)'], ['liquidacion_sueldo', 'Liquidación de sueldo'], ['boleta_honorario', 'Boleta de honorarios'],
  ['credito', 'Crédito bancario'], ['arriendo', 'Arriendo'], ['gasto_bancario', 'Gasto bancario'], ['caja_chica', 'Caja chica'],
  ['caso_postventa', 'Caso postventa'], ['venta_transferencia', 'Venta por transferencia'], ['otro', 'Otro'], ['sin_respaldo', 'Sin respaldo'],
]

const CHIPS = [
  ['trabajo', 'Por trabajar'], ['sin_clasificar', 'Sin clasificar'], ['por_conciliar', 'Por conciliar'],
  ['sugerencia', 'Con sugerencia'], ['conciliado', 'Conciliados'], ['todos', 'Todos'],
]

const Sec = ({ t, children, right }) => (
  <div style={{ borderTop: `1px solid ${BORDE}`, paddingTop: 10, marginTop: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.6, flex: 1 }}>{t}</div>
      {right}
    </div>
    {children}
  </div>
)
const BTN = (a, color = NAVY) => ({ fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${a ? color : BORDE}`, background: a ? color : '#fff', color: a ? '#fff' : INK })
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff', width: '100%' }

export function ConciliacionBancaria({ cu }) {
  const [cuenta, setCuenta] = useState('santander')
  const [mes, setMes] = useState(MESES[MESES.length - 1])
  const [anioCompleto, setAnioCompleto] = useState(false)
  const [chip, setChip] = useState('trabajo')
  const [texto, setTexto] = useState('')
  const [filas, setFilas] = useState([])
  const [sugMap, setSugMap] = useState(new Map())   // movimiento_id -> [sugerencias]
  const [subcuentas, setSubcuentas] = useState([])
  const [cargando, setCargando] = useState(false)
  const [selId, setSelId] = useState(null)

  /* ── carga de la cartola ── */
  const cargar = useCallback(async () => {
    setCargando(true)
    let q = supabase.from('movimientos_bancarios')
      .select('id, fecha, tipo, monto, descripcion, referencia, n_documento, estado, subcuenta_id, ceco_id, tipo_respaldo, origen, saldo, subcuenta:subcuentas(codigo, nombre), conciliaciones(monto_aplicado)')
      .order('fecha', { ascending: false }).order('id', { ascending: false }).limit(6000)
    if (!anioCompleto) q = q.gte('fecha', mes + '-01').lt('fecha', mesSiguiente(mes) + '-01')
    else q = q.gte('fecha', '2026-01-01')
    q = cuenta === 'global66' ? q.eq('origen', 'global66_sync') : q.or('origen.is.null,origen.neq.global66_sync')
    const [{ data, error }, { data: sugs }] = await Promise.all([q, supabase.from('v_bandeja_conciliacion').select('*')])
    if (error) { toast.error(error.message); setFilas([]); setSugMap(new Map()); setCargando(false); return }
    const m = new Map()
    for (const s of sugs ?? []) {
      const ids = [s.movimiento_id, ...(s.movimiento_ids ?? [])].filter(Boolean)
      for (const id of ids) { if (!m.has(id)) m.set(id, []); m.get(id).push(s) }
    }
    setSugMap(m); setFilas(data ?? []); setCargando(false)
  }, [mes, cuenta, anioCompleto])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { supabase.from('subcuentas').select('id, codigo, nombre').eq('activa', true).order('codigo').then(({ data }) => setSubcuentas(data ?? [])) }, [])

  /* ── derivar situación + filtrar ── */
  const enriquecidas = useMemo(() => filas.map(r => ({ ...r, sit: situacionDe(r), nSug: (sugMap.get(r.id) ?? []).length })), [filas, sugMap])
  const visibles = useMemo(() => {
    let out = enriquecidas
    if (chip === 'trabajo') out = out.filter(r => ['sin_clasificar', 'por_conciliar', 'parcial'].includes(r.sit.k))
    else if (chip === 'sugerencia') out = out.filter(r => r.nSug > 0)
    else if (chip !== 'todos') out = out.filter(r => r.sit.k === chip)
    const t = texto.trim()
    if (t) {
      const num = Number(t.replace(/\./g, '').replace(',', '.'))
      const esNum = t.replace(/[.,\s]/g, '') !== '' && !isNaN(num)
      const tl = t.toLowerCase()
      out = out.filter(r => {
        if (esNum && Math.abs(Math.abs(Number(r.monto)) - Math.abs(num)) <= 1) return true
        if (esNum && String(Math.round(Math.abs(Number(r.monto)))).includes(String(Math.round(Math.abs(num))))) return true
        return `${r.descripcion ?? ''} ${r.referencia ?? ''} ${r.n_documento ?? ''} ${r.subcuenta?.nombre ?? ''}`.toLowerCase().includes(tl)
      })
    }
    return out
  }, [enriquecidas, chip, texto])

  const kpi = useMemo(() => {
    const k = { total: enriquecidas.length, sin_clasificar: 0, por_conciliar: 0, parcial: 0, conciliado: 0, explicado: 0, sin_tipo: 0, sug: 0, pend_monto: 0 }
    for (const r of enriquecidas) { k[r.sit.k]++; k.pend_monto += r.sit.pendiente; if (r.nSug) k.sug++ }
    return k
  }, [enriquecidas])

  const sel = useMemo(() => enriquecidas.find(r => r.id === selId) ?? null, [enriquecidas, selId])

  const cols = useMemo(() => [
    { key: 'fecha', label: 'Fecha', width: 86, value: r => fF(r.fecha) },
    { key: 'sit', label: 'Estado', width: 112, value: r => SITUACION[r.sit.k].l, render: r => <span style={{ fontSize: 10.5, fontWeight: 700, color: SITUACION[r.sit.k].c }}>{SITUACION[r.sit.k].l}{r.nSug ? <span title={`${r.nSug} sugerencia(s)`} style={{ marginLeft: 5, color: AZUL }}>✦</span> : null}</span> },
    { key: 'descripcion', label: 'Descripción', width: 330 },
    { key: 'referencia', label: 'Referencia', width: 100 },
    { key: 'monto', label: 'Monto', align: 'right', width: 115, value: r => Math.abs(Number(r.monto)), render: r => <b style={{ fontVariantNumeric: 'tabular-nums', color: r.tipo === 'CARGO' ? ROJO : VERDE }}>{r.tipo === 'CARGO' ? '−' : ''}{fmt(Math.abs(r.monto))}</b> },
    { key: 'aplicado', label: 'Aplicado', align: 'right', width: 105, value: r => r.sit.aplicado, render: r => r.sit.aplicado ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(r.sit.aplicado)}</span> : '' },
    { key: 'pendiente', label: 'Pendiente', align: 'right', width: 105, value: r => r.sit.pendiente, render: r => r.sit.pendiente ? <span style={{ fontVariantNumeric: 'tabular-nums', color: ROJO, fontWeight: 600 }}>{fmt(r.sit.pendiente)}</span> : '' },
    { key: 'subcuenta', label: 'Subcuenta', width: 200, value: r => r.subcuenta?.nombre ?? '', render: r => r.subcuenta ? <span>{r.subcuenta.nombre}</span> : <span style={{ color: AMBAR }}>—</span> },
    { key: 'tipo_respaldo', label: 'Respaldo', width: 120, value: r => r.tipo_respaldo ?? '' },
  ], [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── barra superior: cuenta · mes · búsqueda · progreso ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '8px 12px', flexWrap: 'wrap' }}>
        <select value={cuenta} onChange={e => setCuenta(e.target.value)} style={{ ...INPUT, width: 'auto', fontWeight: 700, color: NAVY }}>
          <option value="santander">Santander CLP</option><option value="global66">Global66 USD</option>
        </select>
        <select value={mes} onChange={e => setMes(e.target.value)} disabled={anioCompleto} style={{ ...INPUT, width: 'auto', fontWeight: 600 }}>
          {[...MESES].reverse().map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <label style={{ fontSize: 11.5, color: SLATE, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={anioCompleto} onChange={e => setAnioCompleto(e.target.checked)} /> todo el año
        </label>
        <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar: monto exacto, texto de la glosa, referencia, N° doc…"
          style={{ ...INPUT, flex: 1, minWidth: 260, fontSize: 12.5 }} />
        <div style={{ display: 'flex', gap: 14, fontSize: 11.5, whiteSpace: 'nowrap' }}>
          <span><b style={{ color: AMBAR }}>{kpi.sin_clasificar}</b> sin clasificar</span>
          <span><b style={{ color: ROJO }}>{kpi.por_conciliar + kpi.parcial}</b> por conciliar · <b style={{ color: ROJO }}>{fmt(kpi.pend_monto)}</b></span>
          <span><b style={{ color: AZUL }}>{kpi.sug}</b> con sugerencia</span>
          <span><b style={{ color: VERDE }}>{kpi.conciliado + kpi.explicado}</b> listos de {kpi.total}</span>
        </div>
      </div>

      {/* ── chips ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {CHIPS.map(([k, l]) => (
          <button key={k} onClick={() => setChip(k)} style={{ ...BTN(chip === k), borderRadius: 999 }}>
            {l}{k === 'trabajo' ? ` · ${kpi.sin_clasificar + kpi.por_conciliar + kpi.parcial}` : k === 'sugerencia' ? ` · ${kpi.sug}` : k === 'todos' ? ` · ${kpi.total}` : k in kpi ? ` · ${kpi[k]}` : ''}
          </button>
        ))}
      </div>

      {/* ── grilla + panel ── */}
      <div style={{ display: 'grid', gridTemplateColumns: sel ? 'minmax(0, 1fr) 440px' : '1fr', gap: 10, alignItems: 'start' }}>
        <DataGrid title={`Cartola ${cuenta === 'santander' ? 'Santander' : 'Global66'} · ${anioCompleto ? '2026' : mes} · ${visibles.length} líneas`}
          exportName={`conciliacion_${cuenta}_${anioCompleto ? '2026' : mes}`}
          columns={cols} rows={visibles} getRowId={r => r.id} loading={cargando}
          selectedId={selId} onRowClick={r => setSelId(r.id === selId ? null : r.id)}
          rowStyle={r => r.id === selId ? { background: '#E0E7FF' } : SITUACION[r.sit.k].bg ? { background: SITUACION[r.sit.k].bg } : null}
          emptyText="Nada que mostrar con estos filtros" />
        {sel && <PanelLinea mov={sel} cu={cu} subcuentas={subcuentas} sugerencias={sugMap.get(sel.id) ?? []}
          onCambio={() => cargar()} onCerrar={() => setSelId(null)} />}
      </div>
      <div style={{ fontSize: 10.5, color: SLATE }}>
        Fuente: <code>movimientos_bancarios</code> · respaldos en <code>conciliaciones</code> · sugerencias del agente en <code>v_bandeja_conciliacion</code>.
        Estado por línea: sin subcuenta → <b>sin clasificar</b>; pago de factura sin respaldo → <b>por conciliar</b>; otro respaldo → <b>explicado</b>.
      </div>
    </div>
  )
}

/* ─────────────────────── PANEL DE LA LÍNEA SELECCIONADA ─────────────────── */
function PanelLinea({ mov, cu, subcuentas, sugerencias, onCambio, onCerrar }) {
  const [vinc, setVinc] = useState([])
  const [cand, setCand] = useState([])
  const [buscaF, setBuscaF] = useState('')
  const [sub, setSub] = useState(mov.subcuenta_id ?? '')
  const [tipoR, setTipoR] = useState(mov.tipo_respaldo ?? '')
  const [aprend, setAprend] = useState(null)
  const [montos, setMontos] = useState({})     // facturaId -> monto a aplicar
  const [ocupado, setOcupado] = useState(null)
  const S = SITUACION[mov.sit.k]
  const esCargo = mov.tipo === 'CARGO'
  const ctx = { ...mov, saldo_pendiente: mov.sit.pendiente > 0 ? mov.sit.pendiente : Math.abs(mov.monto) }

  useEffect(() => { setSub(mov.subcuenta_id ?? ''); setTipoR(mov.tipo_respaldo ?? ''); setBuscaF(''); setMontos({}) }, [mov.id])
  useEffect(() => { fetchVinculados(mov.id).then(setVinc).catch(() => setVinc([])) }, [mov.id, mov.conciliaciones?.length])
  useEffect(() => {
    if (mov.subcuenta_id) { setAprend(null); return }
    // Misma fuente que la pantalla Clasificar: reglas por RUT o por patrón de glosa.
    const rut = extraerRut(mov.descripcion ?? '')
    supabase.from('reglas_clasificacion').select('id, tipo_regla, patron, subcuenta_id, ceco_id, tipo_respaldo, aciertos, subcuenta:subcuentas(nombre)')
      .order('aciertos', { ascending: false }).limit(400)
      .then(({ data }) => {
        const desc = (mov.descripcion ?? '').toLowerCase()
        const r = (data ?? []).find(x => (rut && x.tipo_regla === 'rut' && x.patron === rut) || (x.tipo_regla !== 'rut' && x.patron && desc.includes(String(x.patron).toLowerCase())))
        setAprend(r ? { subcuenta_id: r.subcuenta_id, subcuenta_nombre: r.subcuenta?.nombre, tipo_respaldo: r.tipo_respaldo, veces: r.aciertos } : null)
      }, () => setAprend(null))
  }, [mov.id, mov.subcuenta_id])
  useEffect(() => {
    if (!esCargo) { setCand([]); return }
    const t = setTimeout(() => {
      fetchFacturasCandidatas({ texto: buscaF, saldoObjetivo: ctx.saldo_pendiente, rutHint: null, movimiento: ctx })
        .then(rows => setCand(rows.slice(0, 12))).catch(() => setCand([]))
    }, 250)
    return () => clearTimeout(t)
  }, [mov.id, buscaF, mov.sit.pendiente])

  async function guardarClasificacion() {
    if (!sub) { toast.error('Elige una subcuenta'); return }
    setOcupado('clasif')
    const { error } = await supabase.from('movimientos_bancarios').update({
      subcuenta_id: sub, tipo_respaldo: tipoR || null, estado: 'clasificado', clasificado_por: cu?.id ?? null, clasificado_at: new Date().toISOString(),
    }).eq('id', mov.id)
    setOcupado(null)
    if (error) return toast.error(error.message)
    toast.success('Clasificado'); onCambio()
  }
  async function aceptarSug(s) {
    setOcupado('sug' + s.id)
    const fn = s.tipo === 'fraccionado' ? 'fn_aceptar_pago_fraccionado' : 'fn_aceptar_combo'
    const { data, error } = await supabase.rpc(fn, { p_id: s.id, p_usuario: cu?.id ?? 'ui' })
    setOcupado(null)
    if (error) return toast.error(error.message)
    toast.success(`Conciliado: ${data?.conciliaciones_creadas ?? data?.conciliadas ?? ''} vínculo(s)`); onCambio()
  }
  async function rechazarSug(s) {
    setOcupado('sug' + s.id)
    const { error } = await supabase.rpc('fn_rechazar_sugerencia', { p_tipo: s.tipo, p_id: s.id, p_usuario: cu?.id ?? 'ui', p_motivo: null })
    setOcupado(null)
    if (error) return toast.error(error.message)
    toast.success('Sugerencia descartada'); onCambio()
  }
  async function conciliarCon(f) {
    const monto = Number(montos[f.id] ?? Math.min(f.saldo, ctx.saldo_pendiente))
    if (!monto || monto <= 0) return toast.error('Monto inválido')
    setOcupado('f' + f.id)
    try {
      await vincularRespaldo({ movimientoId: mov.id, tipoRespaldo: 'factura_compra', facturaId: f.id, monto, movimiento: ctx, proveedorNombre: f.razon_social })
      if (!mov.tipo_respaldo || mov.tipo_respaldo !== 'factura_compra' || !mov.subcuenta_id) {
        await supabase.from('movimientos_bancarios').update({ tipo_respaldo: 'factura_compra', estado: 'clasificado' }).eq('id', mov.id)
      }
      toast.success(`Vinculada factura ${f.folio} por ${fmt(monto)}`); onCambio()
    } catch (e) { toast.error(e.message) } finally { setOcupado(null) }
  }
  async function quitar(v) {
    setOcupado('q' + v.id)
    try { await desvincular(v.id, mov.id); toast.success('Respaldo quitado'); onCambio() } catch (e) { toast.error(e.message) } finally { setOcupado(null) }
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: 12, position: 'sticky', top: 8, maxHeight: 'calc(100vh - 120px)', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: S.c, textTransform: 'uppercase', letterSpacing: 0.6 }}>{S.l} · {S.d}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: esCargo ? ROJO : VERDE, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{esCargo ? '−' : '+'}{fmt(Math.abs(mov.monto))}</div>
          <div style={{ fontSize: 12.5, color: INK, marginTop: 4, lineHeight: 1.4 }}>{mov.descripcion}</div>
          <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>{fF(mov.fecha)} · {mov.tipo}{mov.referencia ? ` · ref ${mov.referencia}` : ''}{mov.n_documento ? ` · doc ${mov.n_documento}` : ''}{mov.origen ? ` · ${mov.origen}` : ''}</div>
          {mov.sit.aplicado > 0 && <div style={{ fontSize: 11.5, marginTop: 4 }}>Aplicado <b>{fmt(mov.sit.aplicado)}</b>{mov.sit.pendiente > 0 && <> · pendiente <b style={{ color: ROJO }}>{fmt(mov.sit.pendiente)}</b></>}</div>}
        </div>
        <button onClick={onCerrar} title="Cerrar" style={{ ...BTN(false), padding: '2px 8px' }}>✕</button>
      </div>

      {/* 1 · Clasificación */}
      <Sec t="1 · Qué es (subcuenta y tipo de respaldo)">
        {aprend && !mov.subcuenta_id && (
          <div style={{ fontSize: 11.5, background: '#EFF6FF', border: `1px solid #BFDBFE`, borderRadius: 6, padding: '6px 8px', marginBottom: 6 }}>
            Otras veces esta glosa se clasificó como <b>{aprend.subcuenta_nombre ?? aprend.subcuenta_id}</b>{aprend.veces ? ` (${aprend.veces}×)` : ''}.
            <button onClick={() => { if (aprend.subcuenta_id) setSub(aprend.subcuenta_id); if (aprend.tipo_respaldo) setTipoR(aprend.tipo_respaldo) }} style={{ ...BTN(false, AZUL), marginLeft: 8, padding: '2px 8px' }}>Usar</button>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
          <select value={sub} onChange={e => setSub(e.target.value)} style={INPUT}>
            <option value="">Subcuenta…</option>
            {subcuentas.map(s => <option key={s.id} value={s.id}>{s.codigo} · {s.nombre}</option>)}
          </select>
          <select value={tipoR} onChange={e => setTipoR(e.target.value)} style={INPUT}>
            <option value="">Tipo de respaldo…</option>
            {TIPOS_RESPALDO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button onClick={guardarClasificacion} disabled={ocupado === 'clasif'} style={BTN(true)}>Guardar</button>
        </div>
      </Sec>

      {/* 2 · Sugerencias del agente */}
      {sugerencias.length > 0 && (
        <Sec t={`2 · Sugerencias del agente (${sugerencias.length})`}>
          {sugerencias.map(s => (
            <div key={s.id} style={{ border: `1px solid #BFDBFE`, background: '#EFF6FF', borderRadius: 6, padding: '8px 10px', marginBottom: 6, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <b style={{ color: NAVY }}>{s.descripcion_tipo ?? s.tipo}</b>
                <span style={{ color: SLATE, fontSize: 11 }}>confianza {s.confianza ?? '—'}</span>
              </div>
              <div style={{ marginTop: 3 }}>{s.proveedor} · {s.n_facturas} factura(s) · {fmt(s.monto_documentos)}{Number(s.diferencia) ? <span style={{ color: AMBAR }}> · dif {fmt(s.diferencia)}</span> : null}</div>
              {s.evidencia && <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>{s.evidencia}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={() => aceptarSug(s)} disabled={!!ocupado} style={BTN(true, VERDE)}>Aceptar</button>
                <button onClick={() => rechazarSug(s)} disabled={!!ocupado} style={BTN(false)}>Descartar</button>
              </div>
            </div>
          ))}
        </Sec>
      )}

      {/* 3 · Vincular factura */}
      {esCargo && (
        <Sec t="3 · Vincular con factura" right={<input value={buscaF} onChange={e => setBuscaF(e.target.value)} placeholder="folio · RUT · proveedor" style={{ ...INPUT, width: 180, fontSize: 11.5 }} />}>
          {cand.length === 0 && <div style={{ fontSize: 11.5, color: SLATE }}>Sin facturas candidatas. Prueba buscando por folio, RUT o nombre del proveedor.</div>}
          {cand.map(f => {
            const sug = Math.min(Number(f.saldo) || 0, ctx.saldo_pendiente)
            const lvlColor = f.match_level === 'alto' ? VERDE : f.match_level === 'medio' ? AMBAR : SLATE
            return (
              <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px auto', gap: 6, alignItems: 'center', padding: '6px 0', borderBottom: `1px dashed ${BORDE}`, fontSize: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <b>F {f.folio}</b><span style={{ color: SLATE, fontSize: 11 }}>{fF(f.fecha_emision)}</span>
                    {f.match_score != null && <span style={{ fontSize: 10.5, fontWeight: 700, color: lvlColor }}>{f.match_score} pts</span>}
                    {f.estado_factura === 'pagada' && <span style={{ fontSize: 10, color: SLATE }}>pagada</span>}
                  </div>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.razon_social}>{f.razon_social}</div>
                  <div style={{ fontSize: 11, color: SLATE }}>total {fmt(f.monto_total)} · saldo <b style={{ color: INK }}>{fmt(f.saldo)}</b></div>
                </div>
                <input type="number" value={montos[f.id] ?? sug} onChange={e => setMontos(m => ({ ...m, [f.id]: e.target.value }))} style={{ ...INPUT, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
                <button onClick={() => conciliarCon(f)} disabled={!!ocupado || sug <= 0} style={BTN(true)}>Vincular</button>
              </div>
            )
          })}
        </Sec>
      )}

      {/* 4 · Respaldos ya vinculados */}
      {vinc.length > 0 && (
        <Sec t={`4 · Respaldos vinculados (${vinc.length})`}>
          {vinc.map(v => (
            <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px dashed ${BORDE}`, fontSize: 12 }}>
              <div style={{ minWidth: 0 }}>
                <b>{v.tipo_respaldo}</b>{v.folio ? <> · {v.tipo_respaldo === 'factura_compra' ? 'F ' : ''}{v.folio}</> : null}{v.proveedor ? <> · {v.proveedor}</> : null}
                {v.observaciones && <div style={{ fontSize: 11, color: SLATE }}>{v.observaciones}</div>}
              </div>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(v.monto_aplicado)}</span>
              <button onClick={() => quitar(v)} disabled={!!ocupado} style={{ ...BTN(false, ROJO), color: ROJO, padding: '2px 8px' }}>Quitar</button>
            </div>
          ))}
        </Sec>
      )}
    </div>
  )
}
