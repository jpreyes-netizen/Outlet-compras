import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabase'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

/* ══════════════════════════════════════════════════════════════════════
   CONTABILIDAD — OPERACIÓN: Comprobantes · Por clasificar · Tributario ·
   Glosario · Cuadratura de motores. Estética SAP, sin emojis.
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73'
const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', FONDO = '#F9FAFB'
const fmt = n => (n == null || n === '' ? '' : new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n))))
const TH = { padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase',
  letterSpacing: 0.4, borderBottom: `1px solid ${BORDE}`, background: FONDO, position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap' }
const TD = { padding: '5px 8px', fontSize: 12, color: INK, borderBottom: '1px solid #F3F4F6' }
const TDNUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }
const INPUT = { fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: INK }
const BTN = (c = NAVY, solid = false) => ({ ...INPUT, cursor: 'pointer', fontWeight: 600, color: solid ? '#fff' : c,
  background: solid ? c : '#fff', border: `1px solid ${c}` })

function Panel({ titulo, sub, children, acciones }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${BORDE}`, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 12, background: FONDO, flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{titulo}</div>
          {sub && <div style={{ fontSize: 11, color: SLATE, marginTop: 1 }}>{sub}</div>}</div>
        {acciones}
      </div>
      {children}
    </div>
  )
}
const Vacio = ({ texto }) => <div style={{ padding: 28, textAlign: 'center', color: SLATE, fontSize: 12 }}>{texto}</div>
const Leyenda = ({ children }) => (
  <div style={{ background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '8px 12px', fontSize: 11.5, color: '#1E3A8A', lineHeight: 1.5 }}>{children}</div>
)
function exportar(filas, nombre, hoja) {
  if (!filas?.length) { toast.info('Sin datos para exportar'); return }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), hoja.slice(0, 31))
  XLSX.writeFile(wb, `${nombre}.xlsx`); toast.success(`${filas.length} filas exportadas`)
}

/* Selector de cuenta imputable con búsqueda */
function useCuentas() {
  const [cuentas, setCuentas] = useState([])
  useEffect(() => {
    supabase.from('plan_cuentas').select('codigo, nombre, tipo_eeff, descripcion_uso').eq('acepta_movimientos', true).eq('activa', true)
      .order('codigo').limit(500).then(({ data }) => setCuentas(data ?? []))
  }, [])
  return cuentas
}
function SelCuenta({ value, onChange, cuentas, style }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)} style={{ ...INPUT, ...style }}>
      <option value="">— cuenta —</option>
      {cuentas.map(c => <option key={c.codigo} value={c.codigo} title={c.descripcion_uso || ''}>{c.codigo} · {c.nombre}</option>)}
    </select>
  )
}

/* ──────────────── 1 · COMPROBANTES: manual + anulación ─────────────────── */
export function Comprobantes({ cu }) {
  const cuentas = useCuentas()
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [glosa, setGlosa] = useState('')
  const [lineas, setLineas] = useState([{ cuenta: '', debe: '', haber: '', glosa: '' }, { cuenta: '', debe: '', haber: '', glosa: '' }])
  const [guardando, setGuardando] = useState(false)
  const [recientes, setRecientes] = useState([])

  const cargarRecientes = useCallback(async () => {
    const { data } = await supabase.from('cont_asientos')
      .select('id, numero, fecha, glosa, origen, estado, total_debe, anulado_por_asiento_id, anula_asiento_id, created_by')
      .in('origen', ['manual', 'ajuste']).order('numero', { ascending: false }).limit(60)
    setRecientes(data ?? [])
  }, [])
  useEffect(() => { cargarRecientes() }, [cargarRecientes])

  const totD = lineas.reduce((s, l) => s + (Number(l.debe) || 0), 0)
  const totH = lineas.reduce((s, l) => s + (Number(l.haber) || 0), 0)
  const cuadra = Math.abs(totD - totH) < 0.5 && totD > 0
  const lineasOk = lineas.every(l => l.cuenta && ((Number(l.debe) || 0) > 0) !== ((Number(l.haber) || 0) > 0))

  const setL = (i, k, v) => setLineas(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l))

  async function guardar() {
    if (!glosa.trim()) { toast.warning('La glosa es obligatoria'); return }
    if (!lineasOk) { toast.warning('Cada línea necesita cuenta y un solo monto (debe o haber)'); return }
    if (!cuadra) { toast.warning(`No cuadra: debe ${fmt(totD)} ≠ haber ${fmt(totH)}`); return }
    setGuardando(true)
    try {
      const { data, error } = await supabase.rpc('fn_crear_comprobante', {
        p_fecha: fecha, p_glosa: glosa.trim(), p_usuario: cu?.id ?? 'ui',
        p_lineas: lineas.map(l => ({ cuenta: l.cuenta, debe: Number(l.debe) || 0, haber: Number(l.haber) || 0, glosa: l.glosa || null })),
      })
      if (error) throw error
      toast.success(`Comprobante #${data?.numero} contabilizado`)
      setGlosa(''); setLineas([{ cuenta: '', debe: '', haber: '', glosa: '' }, { cuenta: '', debe: '', haber: '', glosa: '' }])
      cargarRecientes()
    } catch (e) { toast.error(e.message) } finally { setGuardando(false) }
  }

  async function anular(a) {
    const motivo = window.prompt(`Motivo de anulación del comprobante #${a.numero} (obligatorio):`)
    if (!motivo) return
    try {
      const { data, error } = await supabase.rpc('fn_anular_asiento', { p_asiento_id: a.id, p_usuario: cu?.id ?? 'ui', p_motivo: motivo })
      if (error) throw error
      toast.success(`#${data.anulado} anulado con contra-asiento #${data.contra_asiento}`)
      cargarRecientes()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Leyenda>
        <b>Comprobante manual.</b> Para ajustes, provisiones, reclasificaciones o correcciones que los motores automáticos no cubren.
        Regla de oro: <b>debe = haber</b>. Un comprobante contabilizado no se edita ni se borra: se <b>anula</b> con un contra-asiento que deja rastro.
      </Leyenda>

      <Panel titulo="Nuevo comprobante" sub="Se contabiliza al guardar. Si el período está cerrado, el sistema lo rechaza.">
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={INPUT} />
            <input value={glosa} onChange={e => setGlosa(e.target.value)} placeholder="Glosa del comprobante (qué y por qué)" style={{ ...INPUT, flex: 1, minWidth: 260 }} />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Cuenta</th><th style={{ ...TH, textAlign: 'right', width: 130 }}>Debe</th>
              <th style={{ ...TH, textAlign: 'right', width: 130 }}>Haber</th><th style={TH}>Detalle</th><th style={{ ...TH, width: 30 }}></th>
            </tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td style={TD}><SelCuenta value={l.cuenta} onChange={v => setL(i, 'cuenta', v)} cuentas={cuentas} style={{ width: '100%' }} /></td>
                  <td style={TD}><input type="number" value={l.debe} onChange={e => setL(i, 'debe', e.target.value)} style={{ ...INPUT, width: '100%', textAlign: 'right' }} /></td>
                  <td style={TD}><input type="number" value={l.haber} onChange={e => setL(i, 'haber', e.target.value)} style={{ ...INPUT, width: '100%', textAlign: 'right' }} /></td>
                  <td style={TD}><input value={l.glosa} onChange={e => setL(i, 'glosa', e.target.value)} placeholder="opcional" style={{ ...INPUT, width: '100%' }} /></td>
                  <td style={TD}>{lineas.length > 2 && <button onClick={() => setLineas(ls => ls.filter((_, j) => j !== i))} style={{ ...INPUT, cursor: 'pointer', color: ROJO, padding: '3px 7px' }}>×</button>}</td>
                </tr>
              ))}
              <tr style={{ background: FONDO }}>
                <td style={{ ...TD, fontWeight: 700 }}>Totales</td>
                <td style={{ ...TDNUM, fontWeight: 700 }}>{fmt(totD)}</td>
                <td style={{ ...TDNUM, fontWeight: 700 }}>{fmt(totH)}</td>
                <td colSpan={2} style={{ ...TD, fontWeight: 700, color: cuadra ? VERDE : ROJO }}>
                  {cuadra ? 'Cuadrado' : totD || totH ? `Diferencia ${fmt(totD - totH)}` : ''}
                </td>
              </tr>
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <button onClick={() => setLineas(ls => [...ls, { cuenta: '', debe: '', haber: '', glosa: '' }])} style={BTN()}>+ Línea</button>
            <button onClick={guardar} disabled={guardando || !cuadra || !lineasOk} style={{ ...BTN(VERDE, true), opacity: cuadra && lineasOk ? 1 : 0.5 }}>
              {guardando ? 'Contabilizando…' : 'Contabilizar comprobante'}
            </button>
          </div>
        </div>
      </Panel>

      <Panel titulo="Comprobantes manuales y de ajuste recientes" sub="Anular genera un contra-asiento; el original queda marcado y visible">
        {!recientes.length ? <Vacio texto="Sin comprobantes manuales aún" /> : (
          <div style={{ maxHeight: '40vh', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={TH}>Nº</th><th style={TH}>Fecha</th><th style={TH}>Glosa</th><th style={TH}>Origen</th>
                <th style={{ ...TH, textAlign: 'right' }}>Monto</th><th style={TH}>Estado</th><th style={TH}></th></tr></thead>
              <tbody>
                {recientes.map(a => (
                  <tr key={a.id} style={{ opacity: a.anulado_por_asiento_id ? 0.55 : 1 }}>
                    <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', color: NAVY, fontWeight: 600 }}>{a.numero}</td>
                    <td style={TD}>{a.fecha}</td>
                    <td style={{ ...TD, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.glosa}>{a.glosa}</td>
                    <td style={{ ...TD, fontSize: 11, color: SLATE }}>{a.origen}</td>
                    <td style={TDNUM}>{fmt(a.total_debe)}</td>
                    <td style={{ ...TD, fontSize: 11, fontWeight: 600, color: a.anulado_por_asiento_id ? ROJO : a.anula_asiento_id ? AMBAR : VERDE }}>
                      {a.anulado_por_asiento_id ? 'anulado' : a.anula_asiento_id ? 'contra-asiento' : a.estado}</td>
                    <td style={TD}>{a.estado === 'contabilizado' && !a.anulado_por_asiento_id && !a.anula_asiento_id &&
                      <button onClick={() => anular(a)} style={{ ...INPUT, cursor: 'pointer', color: ROJO, fontSize: 11 }}>Anular</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

/* ──────────────── 2 · POR CLASIFICAR: reclasificación con aprendizaje ───── */
export function PorClasificar({ cu }) {
  const cuentas = useCuentas()
  const [filas, setFilas] = useState([])
  const [sel, setSel] = useState({})       // linea_id → cuenta
  const [tipo, setTipo] = useState('todos')
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase.from('v_por_clasificar').select('*').limit(1000)
    if (error) toast.error(error.message)
    setFilas(data ?? []); setCargando(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const visibles = useMemo(() => filas.filter(f => tipo === 'todos' || (tipo === 'compra' ? f.origen === 'compra' : f.origen === 'banco')), [filas, tipo])
  const tot = visibles.reduce((s, f) => s + Number(f.monto), 0)

  async function reclasificar(f) {
    const cuenta = sel[f.linea_id]
    if (!cuenta) { toast.warning('Elija la cuenta destino'); return }
    setProcesando(f.linea_id)
    try {
      const { data, error } = await supabase.rpc('fn_reclasificar_linea', {
        p_linea_id: f.linea_id, p_cuenta_nueva: cuenta, p_usuario: cu?.id ?? 'ui',
        p_motivo: 'Clasificación desde tablero', p_crear_regla: f.origen === 'compra',
      })
      if (error) throw error
      toast.success(`Reclasificado (asiento #${data.asiento_reclasif})${data.regla ? ' · ' + data.regla : ''}`)
      cargar()
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Leyenda>
        <b>Cuenta 1810101 Pendientes</b> es transitoria: lo que el sistema no supo clasificar. Aquí se resuelve línea a línea.
        Al clasificar una <b>factura</b>, el proveedor queda aprendido y sus próximas facturas van solas a esa cuenta.
        Cada reclasificación genera un asiento trazable (nunca se edita el original).
      </Leyenda>
      <Panel titulo="Por clasificar" sub={`${visibles.length} líneas · ${fmt(tot)} · saldo neto de la cuenta en Balance`}
        acciones={
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={INPUT}>
              <option value="todos">Todo</option><option value="compra">Facturas sin regla</option><option value="banco">Movimientos banco</option>
            </select>
            <button onClick={() => exportar(visibles.map(f => ({ Asiento: f.asiento, Fecha: f.fecha, Tipo: f.tipo, Glosa: f.glosa, RUT: f.tercero_rut, Tercero: f.tercero_nombre, Monto: f.monto, Lado: f.lado })), 'por_clasificar', 'Pendientes')} style={BTN()}>Exportar</button>
          </div>
        }>
        {cargando ? <Vacio texto="Cargando…" /> : !visibles.length ? <Vacio texto="Nada pendiente de clasificar" /> : (
          <div style={{ maxHeight: '62vh', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={TH}>Fecha</th><th style={TH}>Tipo</th><th style={TH}>Glosa / tercero</th>
                <th style={{ ...TH, textAlign: 'right' }}>Monto</th><th style={TH}>Cuenta destino</th><th style={TH}></th></tr></thead>
              <tbody>
                {visibles.map(f => (
                  <tr key={f.linea_id}>
                    <td style={{ ...TD, whiteSpace: 'nowrap' }}>{f.fecha}</td>
                    <td style={{ ...TD, fontSize: 11, color: f.origen === 'compra' ? AMBAR : SLATE }}>{f.tipo}</td>
                    <td style={{ ...TD, maxWidth: 340 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.glosa}>{f.glosa}</div>
                      {f.tercero_rut && <div style={{ fontSize: 10, color: SLATE }}>{f.tercero_nombre || ''} · {f.tercero_rut}</div>}
                    </td>
                    <td style={{ ...TDNUM, fontWeight: 600 }}>{fmt(f.monto)} <span style={{ color: SLATE, fontSize: 10 }}>{f.lado}</span></td>
                    <td style={TD}><SelCuenta value={sel[f.linea_id]} onChange={v => setSel(s => ({ ...s, [f.linea_id]: v }))} cuentas={cuentas} style={{ width: 280 }} /></td>
                    <td style={TD}><button onClick={() => reclasificar(f)} disabled={procesando === f.linea_id || !sel[f.linea_id]}
                      style={{ ...BTN(VERDE, true), opacity: sel[f.linea_id] ? 1 : 0.4 }}>Clasificar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

/* ──────────────── 3 · TRIBUTARIO: F29 borrador, RCV, export contador ────── */
export function Tributario() {
  const [f29, setF29] = useState([])
  const [cargando, setCargando] = useState(true)
  const [exportando, setExportando] = useState(null)

  useEffect(() => {
    supabase.from('v_f29_borrador').select('*').limit(24).then(({ data, error }) => {
      if (error) toast.error(error.message); setF29(data ?? []); setCargando(false)
    })
  }, [])

  async function exportarVista(vista, nombre, filtroPeriodo) {
    setExportando(nombre)
    try {
      let q = supabase.from(vista).select('*').limit(50000)
      if (filtroPeriodo) q = q.eq('periodo', filtroPeriodo)
      const { data, error } = await q
      if (error) throw error
      exportar(data, nombre + (filtroPeriodo ? '_' + filtroPeriodo : ''), nombre)
    } catch (e) { toast.error(e.message) } finally { setExportando(null) }
  }

  const [perExp, setPerExp] = useState('')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Leyenda>
        <b>Borrador F29</b>: lo que el ERP determina desde los libros, para cruzar mes a mes con lo que declara el contador.
        Diferencias = documentos que uno de los dos no tiene. <b>PPM</b> estimado al 0,25% (ajustar a la tasa vigente).
        Los <b>libros RCV</b> siguen el formato del Registro de Compras y Ventas del SII. El <b>export al contador</b> entrega los
        asientos con el código de 7 dígitos que él usa; las cuentas marcadas "solo ERP" requieren mapeo en su plan.
      </Leyenda>

      <Panel titulo="Borrador F29 mensual" sub="IVA determinado = débito − crédito · retenciones y PPM informativos"
        acciones={<button onClick={() => exportar(f29, 'f29_borrador', 'F29')} style={BTN()}>Exportar</button>}>
        {cargando ? <Vacio texto="Cargando…" /> : (
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Período</th><th style={{ ...TH, textAlign: 'right' }}>Ventas netas</th><th style={{ ...TH, textAlign: 'right' }}>IVA débito</th>
                <th style={{ ...TH, textAlign: 'right' }}>Compras netas</th><th style={{ ...TH, textAlign: 'right' }}>IVA crédito</th>
                <th style={{ ...TH, textAlign: 'right' }}>IVA determinado</th><th style={{ ...TH, textAlign: 'right' }}>Ret. honorarios</th>
                <th style={{ ...TH, textAlign: 'right' }}>Imp. único</th><th style={{ ...TH, textAlign: 'right' }}>PPM est.</th>
                <th style={{ ...TH, textAlign: 'right' }}>Docs</th>
              </tr></thead>
              <tbody>
                {f29.map(r => (
                  <tr key={r.periodo}>
                    <td style={{ ...TD, fontWeight: 700 }}>{r.periodo}</td>
                    <td style={TDNUM}>{fmt(r.ventas_netas)}</td><td style={TDNUM}>{fmt(r.iva_debito)}</td>
                    <td style={TDNUM}>{fmt(r.compras_netas)}</td><td style={TDNUM}>{fmt(r.iva_credito)}</td>
                    <td style={{ ...TDNUM, fontWeight: 700, color: r.iva_determinado > 0 ? ROJO : VERDE }}>{fmt(r.iva_determinado)}</td>
                    <td style={TDNUM}>{fmt(r.retencion_2da_categoria)}</td><td style={TDNUM}>{fmt(r.impuesto_unico_trabajadores)}</td>
                    <td style={TDNUM}>{fmt(r.ppm_estimado_025pct)}</td>
                    <td style={{ ...TDNUM, color: SLATE, fontSize: 11 }}>{r.n_docs_venta}v · {r.n_docs_compra}c</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel titulo="Libros y exportaciones" sub="Formato SII y formato contador">
        <div style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={perExp} onChange={e => setPerExp(e.target.value)} style={INPUT}>
            <option value="">Todo 2026</option>
            {f29.map(r => <option key={r.periodo} value={r.periodo}>{r.periodo}</option>)}
          </select>
          <button onClick={() => exportarVista('v_libro_ventas_sii', 'libro_ventas_RCV', perExp)} disabled={!!exportando} style={BTN()}>Libro de ventas (RCV)</button>
          <button onClick={() => exportarVista('v_libro_compras_sii', 'libro_compras_RCV', perExp)} disabled={!!exportando} style={BTN()}>Libro de compras (RCV)</button>
          <button onClick={() => exportarVista('v_export_contador', 'asientos_para_contador', perExp)} disabled={!!exportando} style={BTN(NAVY, true)}>Asientos para el contador</button>
          {exportando && <span style={{ fontSize: 11, color: SLATE }}>Generando {exportando}…</span>}
        </div>
      </Panel>
    </div>
  )
}

/* ──────────────── 4 · GLOSARIO ─────────────────────────────────────────── */
export function Glosario() {
  const [items, setItems] = useState([])
  const [busca, setBusca] = useState('')
  useEffect(() => { supabase.from('cont_glosario').select('*').order('categoria').order('termino').limit(200).then(({ data }) => setItems(data ?? [])) }, [])
  const CAT = { concepto: 'Conceptos', libro: 'Libros', estado: 'Estados financieros', cuenta: 'Cuentas', tributario: 'Tributario', operación: 'Operación' }
  const vis = items.filter(i => !busca || (i.termino + i.definicion).toLowerCase().includes(busca.toLowerCase()))
  const cats = [...new Set(vis.map(i => i.categoria))]
  return (
    <Panel titulo="Glosario contable y tributario" sub="Qué significa cada término y dónde verlo en el sistema"
      acciones={<input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar término…" style={{ ...INPUT, width: 200 }} />}>
      <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
        {cats.map(c => (
          <div key={c} style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, margin: '6px 0' }}>{CAT[c] || c}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 8 }}>
              {vis.filter(i => i.categoria === c).map(i => (
                <div key={i.termino} style={{ border: `1px solid ${BORDE}`, borderRadius: 8, padding: '9px 11px', background: '#fff' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{i.termino}</div>
                  <div style={{ fontSize: 11.5, color: '#374151', marginTop: 3, lineHeight: 1.45 }}>{i.definicion}</div>
                  {i.ejemplo && <div style={{ fontSize: 10.5, color: SLATE, marginTop: 4, fontStyle: 'italic' }}>{i.ejemplo}</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ──────────────── 5 · CUADRATURA DE MOTORES (para Control) ─────────────── */
export function CuadraturaMotores() {
  const [filas, setFilas] = useState([])
  const [salud, setSalud] = useState([])
  const [incoh, setIncoh] = useState(null)
  useEffect(() => {
    supabase.from('v_ctrl_motores').select('*').then(({ data }) => setFilas(data ?? []))
    supabase.from('v_ctrl_motor_salud').select('*').order('motor').then(({ data }) => setSalud(data ?? []))
    supabase.from('v_ctrl_incoherencias_caja_devengo').select('monto').limit(5000).then(({ data }) => setIncoh({ n: data?.length ?? 0, monto: (data ?? []).reduce((s, r) => s + Number(r.monto), 0) }))
  }, [])
  const ultima = salud.reduce((m, s) => s.corrida_at > m ? s.corrida_at : m, '')
  const conError = salud.filter(s => !s.ok)
  return (<>
    <Panel titulo={`Motores automáticos · ${salud.length} activos`} sub={`Última corrida ${ultima ? String(ultima).slice(0, 16).replace('T', ' ') : '—'} · cron diario 14:00 UTC`}>
      <div style={{ padding: '8px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {salud.map(s => (
          <span key={s.motor} title={s.error || JSON.stringify(s.resultado)} style={{ fontSize: 10.5, padding: '3px 9px', borderRadius: 999, fontWeight: 600,
            background: s.ok ? '#DCFCE7' : '#FEE2E2', color: s.ok ? '#166534' : ROJO }}>{s.motor} · {s.duracion_ms}ms</span>
        ))}
        {conError.length > 0 && <span style={{ fontSize: 11, color: ROJO, fontWeight: 700 }}>{conError.length} con error — revisar cont_motor_log</span>}
        {incoh && <span style={{ fontSize: 10.5, padding: '3px 9px', borderRadius: 999, fontWeight: 600, marginLeft: 'auto',
          background: incoh.n ? '#FEF3C7' : '#DCFCE7', color: incoh.n ? AMBAR : '#166534' }}>
          Incoherencias caja↔devengo: {incoh.n} · {fmt(incoh.monto)}</span>}
      </div>
    </Panel>
    <Panel titulo="Cuadratura de motores contables" sub="Lo que dice el diario vs lo que dice la fuente — deben ser iguales al peso">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={TH}>Control</th><th style={{ ...TH, textAlign: 'right' }}>En diario</th>
          <th style={{ ...TH, textAlign: 'right' }}>En fuente</th><th style={{ ...TH, textAlign: 'right' }}>Diferencia</th><th style={TH}>Fuente</th></tr></thead>
        <tbody>
          {filas.map(f => {
            const d = Number(f.en_diario || 0) - Number(f.en_fuente || 0)
            return (
              <tr key={f.control}>
                <td style={{ ...TD, fontWeight: 600 }}>{f.control}</td>
                <td style={TDNUM}>{fmt(f.en_diario)}</td><td style={TDNUM}>{fmt(f.en_fuente)}</td>
                <td style={{ ...TDNUM, fontWeight: 700, color: Math.abs(d) < 100 ? VERDE : ROJO }}>{Math.abs(d) < 100 ? 'Cuadra' : fmt(d)}</td>
                <td style={{ ...TD, fontSize: 11, color: SLATE }}>{f.fuente}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Panel>
  </>)
}
