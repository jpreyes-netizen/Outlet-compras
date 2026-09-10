import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabase'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { Comprobantes, PorClasificar, Tributario, Glosario, CuadraturaMotores, LibroBanco, Auditoria } from './FinContabilidadOps'
import { imprimirComprobante } from './voucher'
import { FinKpisCargo } from './FinKpisCargo'
import { EerrFormal } from './EerrFormal'

/* ══════════════════════════════════════════════════════════════════════
   MÓDULO CONTABILIDAD — Plan de cuentas · Diario · Mayor · Balance · Control
   Estética ejecutiva tipo SAP: máxima densidad, mínimo cromo, sin emojis.
   ══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73'
const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09'
const BORDE = '#E5E7EB', FONDO = '#F9FAFB'

const fmt = n => (n == null || n === '' ? '' :
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n))))
const fmtSigno = n => {
  const v = Number(n) || 0
  return <span style={{ color: v < 0 ? ROJO : INK }}>{fmt(v)}</span>
}

const TH = { padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: SLATE,
  textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${BORDE}`, background: FONDO,
  position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap' }
const TD = { padding: '5px 8px', fontSize: 12, color: INK, borderBottom: '1px solid #F3F4F6' }
const TDNUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }
const INPUT = { fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: INK }

function Panel({ titulo, sub, children, acciones }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${BORDE}`, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between', gap: 12, background: FONDO }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{titulo}</div>
          {sub && <div style={{ fontSize: 11, color: SLATE, marginTop: 1 }}>{sub}</div>}
        </div>
        {acciones}
      </div>
      {children}
    </div>
  )
}

function Kpi({ label, valor, detalle, color }) {
  return (
    <div style={{ flex: '1 1 160px', minWidth: 150, background: '#fff', border: `1px solid ${BORDE}`,
      borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color || INK, fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>{valor}</div>
      {detalle && <div style={{ fontSize: 10, color: SLATE, marginTop: 2 }}>{detalle}</div>}
    </div>
  )
}

function Vacio({ texto }) {
  return <div style={{ padding: 28, textAlign: 'center', color: SLATE, fontSize: 12 }}>{texto}</div>
}

function exportar(filas, nombre, hoja) {
  if (!filas?.length) { toast.info('Sin datos para exportar'); return }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), hoja.slice(0, 31))
  XLSX.writeFile(wb, `${nombre}.xlsx`)
  toast.success(`${filas.length} filas exportadas`)
}

const BtnExport = ({ onClick }) => (
  <button onClick={onClick} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Exportar</button>
)

/* ─────────────────────────── 1 · PLAN DE CUENTAS ─────────────────────── */
function PlanCuentas() {
  const [cuentas, setCuentas] = useState([])
  const [saldos, setSaldos] = useState({})
  const [busca, setBusca] = useState('')
  const [soloConSaldo, setSoloConSaldo] = useState(false)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const [{ data: pc }, { data: bal }] = await Promise.all([
          supabase.from('plan_cuentas').select('codigo, nombre, nombre_contador, nivel, tipo_eeff, naturaleza, acepta_movimientos, origen, activa, descripcion_uso, eerr_mapeo_plan(eerr_linea_codigo)').order('codigo').limit(1000),
          supabase.from('v_balance_saldos').select('codigo, saldo, debe, haber').limit(1000),
        ])
        setCuentas(pc ?? [])
        const m = {}; (bal ?? []).forEach(b => { m[b.codigo] = b })
        setSaldos(m)
      } catch (e) { toast.error('Error cargando plan: ' + e.message) }
      finally { setCargando(false) }
    })()
  }, [])

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return cuentas.filter(c => {
      if (t && !(c.codigo.includes(t) || (c.nombre || '').toLowerCase().includes(t))) return false
      if (soloConSaldo && !(saldos[c.codigo]?.saldo)) return false
      return true
    })
  }, [cuentas, busca, soloConSaldo, saldos])

  const imputables = cuentas.filter(c => c.acepta_movimientos).length

  return (
    <Panel titulo="Plan de cuentas" sub={`${cuentas.length} cuentas · ${imputables} imputables · codificación alineada al balance del contador`}
      acciones={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Código o nombre…" style={{ ...INPUT, width: 180 }} />
          <label style={{ ...INPUT, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: soloConSaldo ? NAVY : SLATE }}>
            <input type="checkbox" checked={soloConSaldo} onChange={e => setSoloConSaldo(e.target.checked)} style={{ width: 12, height: 12 }} />
            Con saldo
          </label>
          <BtnExport onClick={() => exportar(filtradas.map(c => ({
            Código: c.codigo, Cuenta: c.nombre, 'Nombre contador': c.nombre_contador ?? '', Nivel: c.nivel,
            Tipo: c.tipo_eeff, Naturaleza: c.naturaleza, Imputable: c.acepta_movimientos ? 'Sí' : 'No',
            Origen: c.origen, Saldo: saldos[c.codigo]?.saldo ?? 0,
          })), 'plan_de_cuentas', 'Plan')} />
        </div>
      }>
      {cargando ? <Vacio texto="Cargando…" /> : (
        <div style={{ maxHeight: '65vh', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Código</th><th style={TH}>Cuenta</th><th style={TH}>Tipo</th>
              <th style={{ ...TH, textAlign: 'right' }}>Debe</th>
              <th style={{ ...TH, textAlign: 'right' }}>Haber</th>
              <th style={{ ...TH, textAlign: 'right' }}>Saldo</th>
              <th style={TH}>Origen</th>
            </tr></thead>
            <tbody>
              {filtradas.map(c => {
                const s = saldos[c.codigo]
                const esGrupo = c.nivel < 5
                return (
                  <tr key={c.codigo} style={{ background: esGrupo ? FONDO : '#fff' }}>
                    <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', fontWeight: esGrupo ? 700 : 400,
                      paddingLeft: 8 + (c.nivel - 1) * 12, color: esGrupo ? NAVY : INK }}>{c.codigo}</td>
                    <td style={{ ...TD, fontWeight: esGrupo ? 700 : 400, color: esGrupo ? NAVY : INK }}>
                      {c.nombre}
                      {c.nombre_contador && c.nombre_contador !== c.nombre &&
                        <span style={{ color: SLATE, fontSize: 10 }}> · contador: {c.nombre_contador}</span>}
                      {!c.activa && <span style={{ color: AMBAR, fontSize: 10 }}> · inactiva</span>}
                      {c.eerr_mapeo_plan?.[0]?.eerr_linea_codigo && <span style={{ fontSize: 9.5, marginLeft: 8, padding: '1px 6px', borderRadius: 999, background: '#EEF2FF', color: NAVY, fontWeight: 600 }}>EERR · {c.eerr_mapeo_plan[0].eerr_linea_codigo}</span>}
                      {c.descripcion_uso && <div style={{ fontSize: 10.5, color: SLATE, marginTop: 1, fontStyle: 'italic' }}>{c.descripcion_uso}</div>}
                    </td>
                    <td style={{ ...TD, fontSize: 11, color: SLATE }}>{c.tipo_eeff}</td>
                    <td style={TDNUM}>{s?.debe ? fmt(s.debe) : ''}</td>
                    <td style={TDNUM}>{s?.haber ? fmt(s.haber) : ''}</td>
                    <td style={{ ...TDNUM, fontWeight: 600 }}>{s?.saldo ? fmtSigno(s.saldo) : ''}</td>
                    <td style={{ ...TD, fontSize: 10, color: c.origen === 'contador_2025' ? VERDE : SLATE }}>
                      {c.origen === 'contador_2025' ? 'contador' : 'ERP'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/* ───────────────────────────── 2 · LIBRO DIARIO ───────────────────────── */
function LibroDiario() {
  const [asientos, setAsientos] = useState([])
  const [expandido, setExpandido] = useState(null)
  const [lineas, setLineas] = useState({})
  const [filtros, setFiltros] = useState({ origen: 'todos', desde: '', hasta: '', texto: '' })
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      let q = supabase.from('cont_asientos')
        .select('id, numero, fecha, periodo, glosa, origen, origen_tabla, origen_id, estado, total_debe, total_haber, created_by, contabilizado_at, anulado_por_asiento_id')
        .order('fecha', { ascending: false }).order('numero', { ascending: false }).limit(500)
      if (filtros.origen !== 'todos') q = q.eq('origen', filtros.origen)
      if (filtros.desde) q = q.gte('fecha', filtros.desde)
      if (filtros.hasta) q = q.lte('fecha', filtros.hasta)
      if (filtros.texto.trim()) q = q.ilike('glosa', `%${filtros.texto.trim()}%`)
      const { data, error } = await q
      if (error) throw error
      setAsientos(data ?? [])
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setCargando(false) }
  }, [filtros])

  useEffect(() => { cargar() }, [cargar])

  async function abrir(id) {
    if (expandido === id) { setExpandido(null); return }
    setExpandido(id)
    if (lineas[id]) return
    const { data } = await supabase.from('cont_asiento_lineas')
      .select('id, orden, plan_cuenta_codigo, debe, haber, glosa, tercero_nombre')
      .eq('asiento_id', id).order('orden')
    const { data: pc } = await supabase.from('plan_cuentas').select('codigo, nombre').limit(1000)
    const nom = {}; (pc ?? []).forEach(p => { nom[p.codigo] = p.nombre })
    setLineas(prev => ({ ...prev, [id]: (data ?? []).map(l => ({ ...l, cuenta: nom[l.plan_cuenta_codigo] })) }))
  }

  const ORIGENES = ['todos', 'apertura', 'compra', 'banco', 'venta', 'remuneracion', 'ajuste', 'manual']

  return (
    <Panel titulo="Libro diario" sub={`${asientos.length} asientos (máx. 500 por consulta) · doble partida validada en base`}
      acciones={
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select value={filtros.origen} onChange={e => setFiltros({ ...filtros, origen: e.target.value })} style={INPUT}>
            {ORIGENES.map(o => <option key={o} value={o}>{o === 'todos' ? 'Todos los orígenes' : o}</option>)}
          </select>
          <input type="date" value={filtros.desde} onChange={e => setFiltros({ ...filtros, desde: e.target.value })} style={INPUT} />
          <input type="date" value={filtros.hasta} onChange={e => setFiltros({ ...filtros, hasta: e.target.value })} style={INPUT} />
          <input value={filtros.texto} onChange={e => setFiltros({ ...filtros, texto: e.target.value })} placeholder="Glosa…" style={{ ...INPUT, width: 150 }} />
          <BtnExport onClick={() => exportar(asientos.map(a => ({
            Nº: a.numero, Fecha: a.fecha, Glosa: a.glosa, Origen: a.origen, Estado: a.estado,
            Debe: a.total_debe, Haber: a.total_haber,
          })), 'libro_diario', 'Diario')} />
        </div>
      }>
      {cargando ? <Vacio texto="Cargando…" /> : !asientos.length ? <Vacio texto="Sin asientos para el filtro aplicado" /> : (
        <div style={{ maxHeight: '65vh', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...TH, width: 60 }}>Nº</th><th style={{ ...TH, width: 90 }}>Fecha</th>
              <th style={TH}>Glosa</th><th style={{ ...TH, width: 90 }}>Origen</th>
              <th style={{ ...TH, textAlign: 'right', width: 110 }}>Debe</th>
              <th style={{ ...TH, textAlign: 'right', width: 110 }}>Haber</th>
            </tr></thead>
            <tbody>
              {asientos.map(a => (
                <>
                  <tr key={a.id} onClick={() => abrir(a.id)} style={{ cursor: 'pointer',
                    background: expandido === a.id ? '#EEF2FF' : '#fff' }}>
                    <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', color: NAVY, fontWeight: 600 }}>{a.numero}</td>
                    <td style={{ ...TD, whiteSpace: 'nowrap' }}>{a.fecha}</td>
                    <td style={{ ...TD, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.glosa}>{a.glosa}</td>
                    <td style={{ ...TD, fontSize: 11, color: SLATE }}>{a.origen}</td>
                    <td style={TDNUM}>{fmt(a.total_debe)}</td>
                    <td style={TDNUM}>{fmt(a.total_haber)}</td>
                  </tr>
                  {expandido === a.id && (
                    <tr key={a.id + '-d'}>
                      <td colSpan={6} style={{ padding: 0, background: '#FAFBFF' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <tbody>
                            {(lineas[a.id] ?? []).map(l => (
                              <tr key={l.id}>
                                <td style={{ ...TD, paddingLeft: 40, width: 100, fontFamily: 'ui-monospace, monospace', color: SLATE }}>{l.plan_cuenta_codigo}</td>
                                <td style={{ ...TD, fontWeight: 500 }}>{l.cuenta}</td>
                                <td style={{ ...TD, color: SLATE, fontSize: 11 }}>{l.glosa ?? ''}</td>
                                <td style={{ ...TDNUM, width: 110 }}>{l.debe > 0 ? fmt(l.debe) : ''}</td>
                                <td style={{ ...TDNUM, width: 110 }}>{l.haber > 0 ? fmt(l.haber) : ''}</td>
                              </tr>
                            ))}
                            {!lineas[a.id] && <tr><td colSpan={5} style={{ ...TD, paddingLeft: 40, color: SLATE }}>Cargando líneas…</td></tr>}
                          </tbody>
                        </table>
                        {lineas[a.id] && (
                          <div style={{ padding: '6px 12px 10px 40px' }}>
                            <button onClick={e => { e.stopPropagation(); imprimirComprobante(a, lineas[a.id]) }}
                              style={{ fontSize: 11.5, fontWeight: 600, color: NAVY, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}>
                              Imprimir comprobante N° {a.numero}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/* ───────────────────────────── 3 · LIBRO MAYOR ────────────────────────── */
function LibroMayor() {
  const [cuentas, setCuentas] = useState([])
  const [sel, setSel] = useState('')
  const [movs, setMovs] = useState([])
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    supabase.from('v_balance_saldos').select('codigo, nombre, saldo, debe, haber')
      .order('codigo').limit(1000)
      .then(({ data }) => {
        const conMov = (data ?? []).filter(c => c.debe || c.haber)
        setCuentas(conMov)
        if (conMov.length && !sel) setSel(conMov[0].codigo)
      })
  }, [])

  useEffect(() => {
    if (!sel) return
    setCargando(true)
    supabase.from('v_libro_mayor')
      .select('asiento, fecha, origen, glosa_asiento, glosa_linea, debe, haber, saldo_acumulado')
      .eq('plan_cuenta_codigo', sel).order('fecha').order('asiento').limit(5000)
      .then(({ data, error }) => {
        if (error) toast.error('Error: ' + error.message)
        setMovs(data ?? [])
      })
      .finally(() => setCargando(false))
  }, [sel])

  const cuenta = cuentas.find(c => c.codigo === sel)

  return (
    <Panel titulo="Libro mayor" sub={cuenta ? `${cuenta.codigo} · ${cuenta.nombre} · saldo ${fmt(cuenta.saldo)}` : 'Seleccione una cuenta'}
      acciones={
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={sel} onChange={e => setSel(e.target.value)} style={{ ...INPUT, maxWidth: 380 }}>
            {cuentas.map(c => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre} ({fmt(c.saldo)})</option>)}
          </select>
          <BtnExport onClick={() => exportar(movs.map(m => ({
            Asiento: m.asiento, Fecha: m.fecha, Origen: m.origen, Glosa: m.glosa_linea || m.glosa_asiento,
            Debe: m.debe, Haber: m.haber, 'Saldo acumulado': m.saldo_acumulado,
          })), `mayor_${sel}`, 'Mayor')} />
        </div>
      }>
      {cargando ? <Vacio texto="Cargando…" /> : !movs.length ? <Vacio texto="Cuenta sin movimientos" /> : (
        <div style={{ maxHeight: '65vh', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...TH, width: 60 }}>Nº</th><th style={{ ...TH, width: 90 }}>Fecha</th>
              <th style={{ ...TH, width: 90 }}>Origen</th><th style={TH}>Glosa</th>
              <th style={{ ...TH, textAlign: 'right', width: 110 }}>Debe</th>
              <th style={{ ...TH, textAlign: 'right', width: 110 }}>Haber</th>
              <th style={{ ...TH, textAlign: 'right', width: 120 }}>Saldo</th>
            </tr></thead>
            <tbody>
              {movs.map((m, i) => (
                <tr key={i}>
                  <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', color: NAVY }}>{m.asiento}</td>
                  <td style={{ ...TD, whiteSpace: 'nowrap' }}>{m.fecha}</td>
                  <td style={{ ...TD, fontSize: 11, color: SLATE }}>{m.origen}</td>
                  <td style={{ ...TD, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={m.glosa_linea || m.glosa_asiento}>{m.glosa_linea || m.glosa_asiento}</td>
                  <td style={TDNUM}>{m.debe > 0 ? fmt(m.debe) : ''}</td>
                  <td style={TDNUM}>{m.haber > 0 ? fmt(m.haber) : ''}</td>
                  <td style={{ ...TDNUM, fontWeight: 600 }}>{fmtSigno(m.saldo_acumulado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/* ──────────────────── 4 · BALANCE DE COMPROBACIÓN ─────────────────────── */
function BalanceComprobacion() {
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    supabase.from('v_balance_saldos').select('*').order('codigo').limit(1000)
      .then(({ data, error }) => {
        if (error) toast.error('Error: ' + error.message)
        setFilas((data ?? []).filter(f => f.debe || f.haber))
      })
      .finally(() => setCargando(false))
  }, [])

  const tot = useMemo(() => {
    const t = { debe: 0, haber: 0, activo: 0, pasivo: 0, patrimonio: 0, ingreso: 0, costo: 0, gasto: 0, financiero: 0 }
    filas.forEach(f => {
      t.debe += Number(f.debe) || 0; t.haber += Number(f.haber) || 0
      t[f.tipo_eeff] = (t[f.tipo_eeff] || 0) + (Number(f.saldo) || 0)
    })
    return t
  }, [filas])

  const resultado = tot.ingreso - tot.costo - tot.gasto - tot.financiero
  const activo = tot.activo
  const pasivoPatrimonio = tot.pasivo + tot.patrimonio + resultado
  const descuadre = activo - pasivoPatrimonio

  const GRUPOS = [
    { k: 'activo', l: 'ACTIVO' }, { k: 'pasivo', l: 'PASIVO' }, { k: 'patrimonio', l: 'PATRIMONIO' },
    { k: 'ingreso', l: 'INGRESOS' }, { k: 'costo', l: 'COSTOS' }, { k: 'gasto', l: 'GASTOS' },
    { k: 'financiero', l: 'RESULTADO FINANCIERO' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Kpi label="Activo" valor={fmt(activo)} />
        <Kpi label="Pasivo + Patrimonio" valor={fmt(pasivoPatrimonio)} detalle="incluye resultado del ejercicio" />
        <Kpi label="Descuadre" valor={fmt(descuadre)} color={Math.abs(descuadre) < 1 ? VERDE : ROJO}
          detalle={Math.abs(descuadre) < 1 ? 'Balance cuadrado' : 'Revisar'} />
        <Kpi label="Resultado del ejercicio" valor={fmt(resultado)} color={resultado >= 0 ? VERDE : ROJO}
          detalle="ingresos − costos − gastos" />
      </div>

      <Panel titulo="Balance de comprobación y saldos" sub={`${filas.length} cuentas con movimiento`}
        acciones={<BtnExport onClick={() => exportar(filas.map(f => ({
          Código: f.codigo, Cuenta: f.nombre, Tipo: f.tipo_eeff, Debe: f.debe, Haber: f.haber, Saldo: f.saldo,
        })), 'balance_comprobacion', 'Balance')} />}>
        {cargando ? <Vacio texto="Cargando…" /> : (
          <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Código</th><th style={TH}>Cuenta</th>
                <th style={{ ...TH, textAlign: 'right' }}>Debe</th>
                <th style={{ ...TH, textAlign: 'right' }}>Haber</th>
                <th style={{ ...TH, textAlign: 'right' }}>Saldo</th>
              </tr></thead>
              <tbody>
                {GRUPOS.map(g => {
                  const dg = filas.filter(f => f.tipo_eeff === g.k)
                  if (!dg.length) return null
                  const sub = dg.reduce((a, f) => a + (Number(f.saldo) || 0), 0)
                  return (
                    <>
                      <tr key={g.k}><td colSpan={5} style={{ ...TD, background: NAVY, color: '#fff',
                        fontWeight: 700, fontSize: 11, letterSpacing: 0.5 }}>{g.l}</td></tr>
                      {dg.map(f => (
                        <tr key={f.codigo}>
                          <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', color: SLATE }}>{f.codigo}</td>
                          <td style={TD}>{f.nombre}</td>
                          <td style={TDNUM}>{fmt(f.debe)}</td>
                          <td style={TDNUM}>{fmt(f.haber)}</td>
                          <td style={{ ...TDNUM, fontWeight: 600 }}>{fmtSigno(f.saldo)}</td>
                        </tr>
                      ))}
                      <tr key={g.k + '-t'} style={{ background: FONDO }}>
                        <td colSpan={4} style={{ ...TD, textAlign: 'right', fontWeight: 700, color: NAVY }}>Subtotal {g.l}</td>
                        <td style={{ ...TDNUM, fontWeight: 700, color: NAVY }}>{fmt(sub)}</td>
                      </tr>
                    </>
                  )
                })}
                <tr style={{ background: '#EEF2FF' }}>
                  <td colSpan={2} style={{ ...TD, fontWeight: 700, color: NAVY }}>TOTALES</td>
                  <td style={{ ...TDNUM, fontWeight: 700 }}>{fmt(tot.debe)}</td>
                  <td style={{ ...TDNUM, fontWeight: 700 }}>{fmt(tot.haber)}</td>
                  <td style={{ ...TDNUM, fontWeight: 700, color: Math.abs(tot.debe - tot.haber) < 1 ? VERDE : ROJO }}>
                    {Math.abs(tot.debe - tot.haber) < 1 ? 'Cuadrado' : fmt(tot.debe - tot.haber)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

/* ───────────────── 5 · CONTROL: completitud e integridad ───────────────── */
function ControlContable() {
  const [cartolas, setCartolas] = useState([])
  const [mensual, setMensual] = useState([])
  const [pendientes, setPendientes] = useState({ pend: 0, sinRegla: 0 })
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const [{ data: ct }, { data: mn }, { data: bal }] = await Promise.all([
          supabase.from('v_ctrl_cartolas').select('*').order('desde').limit(200),
          supabase.from('v_ctrl_banco_mensual').select('*').limit(50),
          supabase.from('v_balance_saldos').select('codigo, saldo').in('codigo', ['1810101']),
        ])
        setCartolas(ct ?? [])
        setMensual(mn ?? [])
        setPendientes({ pend: Number(bal?.[0]?.saldo || 0), sinRegla: 0 })
      } catch (e) { toast.error('Error: ' + e.message) }
      finally { setCargando(false) }
    })()
  }, [])

  const incompletas = cartolas.filter(c => c.estado_cartola === 'incompleta')
  const sinSaldos = cartolas.filter(c => c.estado_cartola === 'sin_saldos_declarados')
  const ultimoMes = mensual[mensual.length - 1]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Kpi label="Cartolas incompletas" valor={incompletas.length} color={incompletas.length ? ROJO : VERDE}
          detalle={incompletas.length ? `descuadre ${fmt(incompletas.reduce((a, c) => a + Number(c.descuadre || 0), 0))}` : 'todas cuadran'} />
        <Kpi label="Cartolas sin saldos" valor={sinSaldos.length} color={sinSaldos.length ? AMBAR : VERDE}
          detalle="importadas sin saldo corrido" />
        <Kpi label="Movimientos faltantes" valor={fmt(ultimoMes?.movimientos_faltantes || 0)} color={ROJO}
          detalle="saldo banco − saldo contable" />
        <Kpi label="Por aclarar (1810101)" valor={fmt(pendientes.pend)} color={pendientes.pend ? AMBAR : VERDE}
          detalle="cargos sin clasificación contable" />
      </div>

      <Panel titulo="Control de completitud por cartola"
        sub="Regla: saldo final − saldo inicial debe ser igual a la suma de movimientos importados">
        {cargando ? <Vacio texto="Cargando…" /> : (
          <div style={{ maxHeight: '38vh', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Archivo</th><th style={TH}>Desde</th><th style={TH}>Hasta</th>
                <th style={{ ...TH, textAlign: 'right' }}>Movs</th>
                <th style={{ ...TH, textAlign: 'right' }}>Variación banco</th>
                <th style={{ ...TH, textAlign: 'right' }}>Suma movs</th>
                <th style={{ ...TH, textAlign: 'right' }}>Descuadre</th>
                <th style={TH}>Estado</th>
              </tr></thead>
              <tbody>
                {cartolas.map(c => (
                  <tr key={c.cartola_id}>
                    <td style={{ ...TD, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={c.archivo_origen}>{c.archivo_origen ?? '(migración SQL)'}</td>
                    <td style={{ ...TD, whiteSpace: 'nowrap' }}>{c.desde ?? ''}</td>
                    <td style={{ ...TD, whiteSpace: 'nowrap' }}>{c.hasta ?? ''}</td>
                    <td style={TDNUM}>{c.n_movimientos}</td>
                    <td style={TDNUM}>{c.variacion_declarada != null ? fmt(c.variacion_declarada) : ''}</td>
                    <td style={TDNUM}>{fmt(c.suma_movimientos)}</td>
                    <td style={{ ...TDNUM, fontWeight: 700, color: c.descuadre ? ROJO : VERDE }}>
                      {c.descuadre != null ? fmt(c.descuadre) : ''}</td>
                    <td style={{ ...TD, fontSize: 11, fontWeight: 600,
                      color: c.estado_cartola === 'cuadrada' ? VERDE : c.estado_cartola === 'incompleta' ? ROJO : AMBAR }}>
                      {c.estado_cartola.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel titulo="Saldo contable vs saldo del banco por mes"
        sub="La diferencia indica movimientos no importados en el período">
        <div style={{ maxHeight: '32vh', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Período</th>
              <th style={{ ...TH, textAlign: 'right' }}>Flujo del mes</th>
              <th style={{ ...TH, textAlign: 'right' }}>Saldo contable</th>
              <th style={{ ...TH, textAlign: 'right' }}>Saldo banco</th>
              <th style={{ ...TH, textAlign: 'right' }}>Faltante</th>
            </tr></thead>
            <tbody>
              {mensual.map(m => (
                <tr key={m.periodo}>
                  <td style={{ ...TD, fontWeight: 600 }}>{m.periodo}</td>
                  <td style={TDNUM}>{fmtSigno(m.flujo_mes)}</td>
                  <td style={TDNUM}>{fmtSigno(m.saldo_contable)}</td>
                  <td style={TDNUM}>{m.saldo_banco != null ? fmt(m.saldo_banco) : '—'}</td>
                  <td style={{ ...TDNUM, fontWeight: 700, color: m.movimientos_faltantes ? ROJO : VERDE }}>
                    {m.movimientos_faltantes != null ? fmt(m.movimientos_faltantes) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

/* ─────────────────── 6 · EERR DEVENGO (paralelo) ──────────────────────── */
function EerrDevengo({ cu }) {
  const [mensual, setMensual] = useState([])
  const [detalle, setDetalle] = useState([])
  const [porSucursal, setPorSucursal] = useState([])
  const [formal, setFormal] = useState([])
  const [flujo, setFlujo] = useState([])
  const [vista, setVista] = useState('formal')
  const [mesSel, setMesSel] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const [{ data: m }, { data: d }, { data: s }, { data: f }, { data: fc }] = await Promise.all([
          supabase.from('v_eerr_devengo_mensual').select('*').limit(24),
          supabase.from('v_eerr_devengo').select('*').limit(2000),
          supabase.from('v_eerr_sucursal').select('*').limit(500),
          supabase.from('v_eerr_formal').select('*').limit(500),
          supabase.from('v_flujo_caja_nic7').select('*').limit(24),
        ])
        setMensual(m ?? []); setDetalle(d ?? []); setPorSucursal(s ?? []); setFormal(f ?? []); setFlujo(fc ?? [])
      } catch (e) { toast.error('Error: ' + e.message) }
      finally { setCargando(false) }
    })()
  }, [])

  const detMes = useMemo(() => (detalle ?? []).filter(d => d.periodo === mesSel), [detalle, mesSel])
  const periodosSuc = useMemo(() => [...new Set(porSucursal.map(p => p.periodo))].sort().reverse(), [porSucursal])
  const [perSuc, setPerSuc] = useState(null)
  const filasSuc = useMemo(() => porSucursal.filter(p => p.periodo === (perSuc || periodosSuc[0]))
    .sort((a, b) => Number(b.contribucion) - Number(a.contribucion)), [porSucursal, perSuc, periodosSuc])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px',
        fontSize: 11, color: '#92400E' }}>
        Mismo maestro de líneas que Gestión → EERR Gestión (caja). Devengo desde el libro mayor; caja replicada desde las mismas fuentes.
        Limitaciones vigentes: costo de ventas a costo estándar actual; cartolas y liquidaciones incompletas afectan ambos mundos.
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[{ k: 'formal', l: 'EERR · Devengo / Caja / Paralelo' }, { k: 'consolidado', l: 'Resumen mensual' }, { k: 'sucursal', l: 'Por sucursal' }, { k: 'flujo', l: 'Flujo de caja (NIC 7)' }].map(v => (
          <button key={v.k} onClick={() => setVista(v.k)} style={{
            padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: vista === v.k ? NAVY : '#fff', color: vista === v.k ? '#fff' : SLATE,
            border: `1px solid ${vista === v.k ? NAVY : BORDE}`,
          }}>{v.l}</button>
        ))}
        {vista === 'sucursal' && (
          <select value={perSuc || periodosSuc[0] || ''} onChange={e => setPerSuc(e.target.value)} style={{ ...INPUT, marginLeft: 'auto' }}>
            {periodosSuc.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>

      {vista === 'formal' ? (
        <EerrFormal cu={cu} />
      ) : vista === 'flujo' ? (
        <Panel titulo="Flujo de caja — método indirecto (NIC 7)" sub="Del resultado a la caja: partidas no monetarias y variaciones de capital de trabajo · conciliado al peso contra la caja del mayor"
          acciones={<BtnExport onClick={() => exportar(flujo, 'flujo_caja_nic7', 'NIC7')} />}>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Período</th>
                <th style={{ ...TH, textAlign: 'right' }}>Resultado</th>
                <th style={{ ...TH, textAlign: 'right' }}>Δ Inventario</th>
                <th style={{ ...TH, textAlign: 'right' }}>Δ CxC</th>
                <th style={{ ...TH, textAlign: 'right' }}>Δ CxP</th>
                <th style={{ ...TH, textAlign: 'right' }}>Flujo operacional</th>
                <th style={{ ...TH, textAlign: 'right' }}>Inversión</th>
                <th style={{ ...TH, textAlign: 'right' }}>Financiamiento</th>
                <th style={{ ...TH, textAlign: 'right' }}>Δ Caja</th>
                <th style={{ ...TH, textAlign: 'right' }}>Conciliación</th>
              </tr></thead>
              <tbody>
                {flujo.map(f => (
                  <tr key={f.periodo}>
                    <td style={{ ...TD, fontWeight: 700 }}>{f.periodo}</td>
                    <td style={TDNUM}>{fmtSigno(f.resultado)}</td>
                    <td style={TDNUM}>{fmtSigno(f.var_inventario)}</td>
                    <td style={TDNUM}>{fmtSigno(f.var_cxc)}</td>
                    <td style={TDNUM}>{fmtSigno(f.var_cxp)}</td>
                    <td style={{ ...TDNUM, fontWeight: 700, color: f.flujo_operacional >= 0 ? VERDE : ROJO }}>{fmtSigno(f.flujo_operacional)}</td>
                    <td style={TDNUM}>{fmtSigno(f.flujo_inversion)}</td>
                    <td style={TDNUM}>{fmtSigno(f.flujo_financiamiento)}</td>
                    <td style={{ ...TDNUM, fontWeight: 600 }}>{fmtSigno(f.variacion_caja_real)}</td>
                    <td style={{ ...TDNUM, fontWeight: 700, color: Math.abs(f.descuadre) < 100 ? VERDE : ROJO }}>
                      {Math.abs(f.descuadre) < 100 ? 'Cuadra' : fmtSigno(f.descuadre)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '8px 12px', fontSize: 10.5, color: SLATE, borderTop: `1px solid ${BORDE}` }}>
            Signos: Δ inventario y CxC negativos consumen caja; Δ CxP positivo la libera. "Cuadra" = el flujo explica exactamente la variación de caja del mayor. Los meses con cartola incompleta heredan esa distorsión en Δ Caja.
          </div>
        </Panel>
      ) : vista === 'sucursal' ? (
        <Panel titulo="Contribución por sucursal" sub="Ingresos, costo, dotación, mermas y gastos directos (facturas con centro de costo) por tienda — asigná el CeCo de arriendos y servicios en Conciliación → Imputar"
          acciones={<BtnExport onClick={() => exportar(filasSuc.map(f => ({
            Período: f.periodo, Sucursal: f.ceco_nombre, Ingresos: f.ingresos, 'Costo ventas': f.costo_ventas,
            'Margen bruto': f.margen_bruto, '% MB': f.margen_bruto_pct, Remuneraciones: f.remuneraciones,
            Mermas: f.mermas, 'Gastos directos': f.gastos_directos, Contribución: f.contribucion, '% Contribución': f.contribucion_pct,
          })), 'eerr_sucursal', 'Sucursales')} />}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Centro</th>
              <th style={{ ...TH, textAlign: 'right' }}>Ingresos</th>
              <th style={{ ...TH, textAlign: 'right' }}>Costo</th>
              <th style={{ ...TH, textAlign: 'right' }}>% MB</th>
              <th style={{ ...TH, textAlign: 'right' }}>Dotación</th>
              <th style={{ ...TH, textAlign: 'right' }}>Mermas</th>
              <th style={{ ...TH, textAlign: 'right' }}>Gastos directos</th>
              <th style={{ ...TH, textAlign: 'right' }}>Contribución</th>
              <th style={{ ...TH, textAlign: 'right' }}>% Contr.</th>
            </tr></thead>
            <tbody>
              {filasSuc.map(f => (
                <tr key={f.ceco} style={{ opacity: f.tipo === 'central' ? 0.75 : 1 }}>
                  <td style={{ ...TD, fontWeight: 600 }}>{f.ceco_nombre}</td>
                  <td style={TDNUM}>{fmt(f.ingresos)}</td>
                  <td style={TDNUM}>{fmt(f.costo_ventas)}</td>
                  <td style={{ ...TDNUM, color: SLATE }}>{f.margen_bruto_pct ?? ''}{f.margen_bruto_pct != null ? '%' : ''}</td>
                  <td style={TDNUM}>{fmt(f.remuneraciones)}</td>
                  <td style={TDNUM}>{fmt(f.mermas)}</td>
                  <td style={TDNUM}>{fmt(f.gastos_directos)}</td>
                  <td style={{ ...TDNUM, fontWeight: 700, color: f.contribucion >= 0 ? VERDE : ROJO }}>{fmt(f.contribucion)}</td>
                  <td style={{ ...TDNUM, color: SLATE }}>{f.contribucion_pct ?? ''}{f.contribucion_pct != null ? '%' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '8px 12px', fontSize: 10.5, color: SLATE, borderTop: `1px solid ${BORDE}` }}>
            Nota: canal web muestra 100% MB porque sus unidades se despachan desde tiendas (el costo queda atribuido a la sucursal de origen).
            La reconciliación completa contra el EERR devengo está en v_eerr_sucursal_reconciliacion.
          </div>
        </Panel>
      ) : (<>
      <Panel titulo="EERR por devengo — mensual" sub="Ingresos y costos desde libros (ventas, compras, RRHH), no desde caja"
        acciones={<BtnExport onClick={() => exportar(mensual.map(m => ({
          Período: m.periodo, Ingresos: m.ingresos, Costos: m.costos, 'Margen bruto': (m.ingresos||0)-(m.costos||0),
          Gastos: m.gastos, Financiero: m.financiero, Resultado: m.resultado,
        })), 'eerr_devengo', 'EERR')} />}>
        {cargando ? <Vacio texto="Cargando…" /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Período</th>
              <th style={{ ...TH, textAlign: 'right' }}>Ingresos</th>
              <th style={{ ...TH, textAlign: 'right' }}>Costo ventas</th>
              <th style={{ ...TH, textAlign: 'right' }}>Margen bruto</th>
              <th style={{ ...TH, textAlign: 'right' }}>% MB</th>
              <th style={{ ...TH, textAlign: 'right' }}>Gastos</th>
              <th style={{ ...TH, textAlign: 'right' }}>Financiero</th>
              <th style={{ ...TH, textAlign: 'right' }}>Resultado</th>
              <th style={{ ...TH, textAlign: 'right' }}>% RN</th>
            </tr></thead>
            <tbody>
              {mensual.map(m => {
                const mb = (Number(m.ingresos) || 0) - (Number(m.costos) || 0)
                const pctMb = m.ingresos ? (mb / m.ingresos * 100) : 0
                const pctRn = m.ingresos ? (m.resultado / m.ingresos * 100) : 0
                return (
                  <tr key={m.periodo} onClick={() => setMesSel(mesSel === m.periodo ? null : m.periodo)}
                    style={{ cursor: 'pointer', background: mesSel === m.periodo ? '#EEF2FF' : '#fff' }}>
                    <td style={{ ...TD, fontWeight: 600 }}>{m.periodo}</td>
                    <td style={TDNUM}>{fmt(m.ingresos)}</td>
                    <td style={TDNUM}>{fmt(m.costos)}</td>
                    <td style={{ ...TDNUM, fontWeight: 600 }}>{fmt(mb)}</td>
                    <td style={{ ...TDNUM, color: SLATE }}>{pctMb.toFixed(1)}%</td>
                    <td style={TDNUM}>{fmt(m.gastos)}</td>
                    <td style={TDNUM}>{fmt(m.financiero)}</td>
                    <td style={{ ...TDNUM, fontWeight: 700, color: m.resultado >= 0 ? VERDE : ROJO }}>{fmt(m.resultado)}</td>
                    <td style={{ ...TDNUM, color: SLATE }}>{pctRn.toFixed(1)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>
      {mesSel && (
        <Panel titulo={`Detalle por cuenta — ${mesSel}`} sub="Clic en un mes para cerrar"
          acciones={<BtnExport onClick={() => exportar(detMes.map(d => ({
            Código: d.codigo, Cuenta: d.nombre, Tipo: d.tipo_eeff, Monto: d.monto,
          })), `eerr_devengo_${mesSel}`, 'Detalle')} />}>
          <div style={{ maxHeight: '40vh', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Código</th><th style={TH}>Cuenta</th><th style={TH}>Tipo</th>
                <th style={{ ...TH, textAlign: 'right' }}>Monto</th>
              </tr></thead>
              <tbody>
                {detMes.map(d => (
                  <tr key={d.codigo}>
                    <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', color: SLATE }}>{d.codigo}</td>
                    <td style={TD}>{d.nombre}</td>
                    <td style={{ ...TD, fontSize: 11, color: SLATE }}>{d.tipo_eeff}</td>
                    <td style={{ ...TDNUM, fontWeight: 600 }}>{fmtSigno(d.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      </>)}
    </div>
  )
}

/* ──────────────── 7 · CUENTAS POR PAGAR (auxiliar + aging) ────────────── */
function CuentasPorPagar() {
  const [aux, setAux] = useState([])
  const [aging, setAging] = useState({})
  const [detalle, setDetalle] = useState([])
  const [sel, setSel] = useState(null)
  const [filtro, setFiltro] = useState('deuda')
  const [busca, setBusca] = useState('')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const [{ data: a }, { data: g }] = await Promise.all([
          supabase.from('v_auxiliar_cxp').select('*').order('saldo', { ascending: false }).limit(2000),
          supabase.from('v_aging_cxp').select('*').limit(2000),
        ])
        setAux(a ?? [])
        const m = {}; (g ?? []).forEach(x => { m[x.rut] = x }); setAging(m)
      } catch (e) { toast.error('Error: ' + e.message) }
      finally { setCargando(false) }
    })()
  }, [])

  async function abrir(rut) {
    if (sel === rut) { setSel(null); return }
    setSel(rut)
    const { data } = await supabase.from('v_aging_cxp_detalle').select('*').eq('rut', rut).order('fecha_emision').limit(500)
    setDetalle(data ?? [])
  }

  const filas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return aux.filter(a => (filtro === 'todos' || a.situacion === filtro) &&
      (!t || (a.nombre || '').toLowerCase().includes(t) || (a.rut || '').includes(t)))
  }, [aux, filtro, busca])

  const tot = useMemo(() => ({
    deuda: aux.filter(a => a.situacion === 'deuda').reduce((s, a) => s + Number(a.saldo), 0),
    sobrepago: aux.filter(a => a.situacion === 'pagado_sin_factura').reduce((s, a) => s + Number(a.saldo), 0),
    nDeuda: aux.filter(a => a.situacion === 'deuda').length,
    nSobre: aux.filter(a => a.situacion === 'pagado_sin_factura').length,
    nSaldado: aux.filter(a => a.situacion === 'saldado').length,
    mas90: Object.values(aging).reduce((s, g) => s + Number(g.t_mas_90 || 0), 0),
  }), [aux, aging])

  const SIT = { deuda: { l: 'Deuda', c: ROJO }, pagado_sin_factura: { l: 'Pagado sin factura', c: AMBAR }, saldado: { l: 'Saldado', c: VERDE } }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Kpi label="Deuda con proveedores" valor={fmt(tot.deuda)} color={ROJO} detalle={`${tot.nDeuda} proveedores`} />
        <Kpi label="Vencido > 90 días" valor={fmt(tot.mas90)} color={tot.mas90 > 0 ? ROJO : VERDE} detalle="facturas abiertas antiguas" />
        <Kpi label="Pagado sin factura" valor={fmt(Math.abs(tot.sobrepago))} color={AMBAR}
          detalle={`${tot.nSobre} proveedores · facturas faltantes o de 2025`} />
        <Kpi label="Saldados al peso" valor={tot.nSaldado} color={VERDE} detalle="conciliación completa" />
      </div>

      <Panel titulo="Libro auxiliar de proveedores" sub="Devengado (facturas − NC) menos pagado (conciliado + directo), por RUT"
        acciones={
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={filtro} onChange={e => setFiltro(e.target.value)} style={INPUT}>
              <option value="deuda">Con deuda</option>
              <option value="pagado_sin_factura">Pagado sin factura</option>
              <option value="saldado">Saldados</option>
              <option value="todos">Todos</option>
            </select>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Proveedor o RUT…" style={{ ...INPUT, width: 170 }} />
            <BtnExport onClick={() => exportar(filas.map(a => ({
              RUT: a.rut, Proveedor: a.nombre, Devengado: a.devengado, 'Pagado conciliado': a.pagado_conciliado,
              'Pagado directo': a.pagado_directo, Saldo: a.saldo, Facturas: a.n_facturas, Pagos: a.n_pagos,
              'Última factura': a.ultima_factura, 'Último pago': a.ultimo_pago, Situación: SIT[a.situacion]?.l,
              '0-30': aging[a.rut]?.t_0_30 ?? '', '31-60': aging[a.rut]?.t_31_60 ?? '',
              '61-90': aging[a.rut]?.t_61_90 ?? '', '>90': aging[a.rut]?.t_mas_90 ?? '',
            })), 'auxiliar_proveedores', 'CxP')} />
          </div>
        }>
        {cargando ? <Vacio texto="Cargando…" /> : !filas.length ? <Vacio texto="Sin proveedores para el filtro" /> : (
          <div style={{ maxHeight: '62vh', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Proveedor</th>
                <th style={{ ...TH, textAlign: 'right' }}>Devengado</th>
                <th style={{ ...TH, textAlign: 'right' }}>Pagado</th>
                <th style={{ ...TH, textAlign: 'right' }}>Saldo</th>
                <th style={{ ...TH, textAlign: 'right' }}>0-30</th>
                <th style={{ ...TH, textAlign: 'right' }}>31-60</th>
                <th style={{ ...TH, textAlign: 'right' }}>61-90</th>
                <th style={{ ...TH, textAlign: 'right' }}>&gt;90</th>
                <th style={TH}>Situación</th>
              </tr></thead>
              <tbody>
                {filas.map(a => {
                  const g = aging[a.rut]
                  return (
                    <>
                      <tr key={a.rut} onClick={() => abrir(a.rut)} style={{ cursor: 'pointer', background: sel === a.rut ? '#EEF2FF' : '#fff' }}>
                        <td style={{ ...TD, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.nombre}>
                          <span style={{ fontWeight: 600 }}>{a.nombre}</span>
                          <span style={{ color: SLATE, fontSize: 10, marginLeft: 6 }}>{a.rut}</span>
                        </td>
                        <td style={TDNUM}>{fmt(a.devengado)}</td>
                        <td style={TDNUM}>{fmt(Number(a.pagado_conciliado) + Number(a.pagado_directo))}</td>
                        <td style={{ ...TDNUM, fontWeight: 700 }}>{fmtSigno(a.saldo)}</td>
                        <td style={TDNUM}>{g?.t_0_30 ? fmt(g.t_0_30) : ''}</td>
                        <td style={TDNUM}>{g?.t_31_60 ? fmt(g.t_31_60) : ''}</td>
                        <td style={{ ...TDNUM, color: g?.t_61_90 ? AMBAR : INK }}>{g?.t_61_90 ? fmt(g.t_61_90) : ''}</td>
                        <td style={{ ...TDNUM, color: g?.t_mas_90 ? ROJO : INK, fontWeight: g?.t_mas_90 ? 700 : 400 }}>{g?.t_mas_90 ? fmt(g.t_mas_90) : ''}</td>
                        <td style={{ ...TD, fontSize: 11, fontWeight: 600, color: SIT[a.situacion]?.c }}>{SIT[a.situacion]?.l}</td>
                      </tr>
                      {sel === a.rut && (
                        <tr key={a.rut + '-d'}><td colSpan={9} style={{ padding: 0, background: '#FAFBFF' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <tbody>
                              {detalle.map(f => (
                                <tr key={f.factura_id}>
                                  <td style={{ ...TD, paddingLeft: 40, color: SLATE, width: 110 }}>{f.fecha_emision}</td>
                                  <td style={{ ...TD, width: 110 }}>Doc {f.codigo_sii} · {f.folio}</td>
                                  <td style={{ ...TDNUM }}>{fmt(f.monto_total)}</td>
                                  <td style={{ ...TDNUM, color: SLATE }}>pagado {fmt(f.pagado)}</td>
                                  <td style={{ ...TDNUM, fontWeight: 700 }}>saldo {fmt(f.saldo)}</td>
                                  <td style={{ ...TD, color: f.dias > 90 ? ROJO : f.dias > 60 ? AMBAR : SLATE, fontSize: 11, textAlign: 'right' }}>{f.dias} días</td>
                                </tr>
                              ))}
                              {!detalle.length && <tr><td style={{ ...TD, paddingLeft: 40, color: SLATE }}>Sin facturas abiertas (saldo por pagos directos o apertura)</td></tr>}
                            </tbody>
                          </table>
                        </td></tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

/* ────────────── 8 · INDICADORES + BALANCE GENERAL CLASIFICADO ─────────── */
function Indicadores() {
  const [ind, setInd] = useState(null)
  const [bg, setBg] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const [{ data: i }, { data: b }] = await Promise.all([
          supabase.from('v_indicadores_financieros').select('*').limit(1),
          supabase.from('v_balance_general').select('*').limit(500),
        ])
        setInd(i?.[0] ?? null); setBg(b ?? [])
      } catch (e) { toast.error('Error: ' + e.message) }
      finally { setCargando(false) }
    })()
  }, [])

  if (cargando) return <Vacio texto="Cargando…" />
  if (!ind) return <Vacio texto="Sin datos" />

  const grupos = [...new Set(bg.map(b => b.grupo))]
  const totBloque = bl => bg.filter(b => b.bloque === bl).reduce((s, b) => s + Number(b.saldo), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#92400E' }}>
        Calidad de datos: caja y cuentas por cobrar heredan los movimientos bancarios faltantes (ver Control).
        Los ratios de liquidez se normalizarán al completar las cartolas. Rentabilidad e inventario ya son representativos.
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Kpi label="EBITDA YTD" valor={fmt(ind.ebitda)} color={ind.ebitda > 0 ? VERDE : ROJO} detalle={`margen EBITDA ${ind.margen_ebitda_pct}% · deuda/EBITDA ${ind.deuda_sobre_ebitda_anualizado}x`} />
        <Kpi label="Margen bruto" valor={`${ind.margen_bruto_pct}%`} color={VERDE} detalle="ingresos − costo ventas, YTD devengo" />
        <Kpi label="Margen neto" valor={`${ind.margen_neto_pct}%`} color={ind.margen_neto_pct > 0 ? VERDE : ROJO} detalle="resultado / ingresos" />
        <Kpi label="ROE" valor={`${ind.roe_pct}%`} detalle="resultado / patrimonio" />
        <Kpi label="ROA" valor={`${ind.roa_pct}%`} detalle="resultado / activo" />
        <Kpi label="Días de inventario" valor={ind.dias_inventario} color={ind.dias_inventario > 120 ? AMBAR : INK} detalle={`${ind.meses_inventario} meses de stock a costo`} />
        <Kpi label="Endeudamiento" valor={ind.endeudamiento} detalle={`pasivo / patrimonio · ${ind.pct_deuda_sobre_activo}% del activo`} />
        <Kpi label="Liquidez corriente" valor={ind.liquidez_corriente} color={SLATE} detalle="distorsionada por cartolas incompletas" />
        <Kpi label="Capital de trabajo" valor={fmt(ind.capital_trabajo)} color={SLATE} detalle="activo corr. − pasivo corr." />
      </div>

      <Panel titulo="Balance general clasificado" sub="Formato de presentación · saldos a la fecha desde el libro mayor"
        acciones={<BtnExport onClick={() => exportar(bg.map(b => ({
          Bloque: b.bloque, Grupo: b.grupo, Código: b.codigo, Cuenta: b.nombre, Saldo: b.saldo,
        })), 'balance_general', 'Balance')} />}>
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {grupos.map(g => {
                const filas = bg.filter(b => b.grupo === g)
                const sub = filas.reduce((s, b) => s + Number(b.saldo), 0)
                const bloque = filas[0]?.bloque
                const primeroDelBloque = bg.find(b => b.bloque === bloque)?.grupo === g
                return (
                  <>
                    {primeroDelBloque && (
                      <tr key={bloque}><td colSpan={3} style={{ ...TD, background: NAVY, color: '#fff', fontWeight: 700, fontSize: 11, letterSpacing: 0.5 }}>
                        {bloque} — {fmt(totBloque(bloque))}</td></tr>
                    )}
                    <tr key={g}><td colSpan={3} style={{ ...TD, background: FONDO, fontWeight: 700, color: NAVY, fontSize: 11 }}>{g}</td></tr>
                    {filas.map(b => (
                      <tr key={b.codigo}>
                        <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', color: SLATE, width: 90 }}>{b.codigo}</td>
                        <td style={TD}>{b.nombre}</td>
                        <td style={{ ...TDNUM, width: 140 }}>{fmtSigno(b.saldo)}</td>
                      </tr>
                    ))}
                    <tr key={g + '-t'}><td colSpan={2} style={{ ...TD, textAlign: 'right', fontWeight: 600, color: SLATE, fontSize: 11 }}>Total {g}</td>
                      <td style={{ ...TDNUM, fontWeight: 700 }}>{fmt(sub)}</td></tr>
                  </>
                )
              })}
              <tr style={{ background: '#EEF2FF' }}>
                <td colSpan={2} style={{ ...TD, fontWeight: 700, color: NAVY }}>ACTIVO = PASIVO + PATRIMONIO</td>
                <td style={{ ...TDNUM, fontWeight: 700, color: Math.abs(totBloque('ACTIVO') - totBloque('PASIVO') - totBloque('PATRIMONIO')) < 1 ? VERDE : ROJO }}>
                  {Math.abs(totBloque('ACTIVO') - totBloque('PASIVO') - totBloque('PATRIMONIO')) < 1 ? 'Cuadrado' : fmt(totBloque('ACTIVO') - totBloque('PASIVO') - totBloque('PATRIMONIO'))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

/* ──────────────────── 9 · CIERRE DE PERÍODO (gobernanza) ──────────────── */
function CierrePeriodos({ cu }) {
  const [periodos, setPeriodos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('v_ctrl_cierre_periodos').select('*').limit(36)
    if (error) toast.error('Error: ' + error.message)
    setPeriodos(data ?? []); setCargando(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function cerrar(p, forzar = false) {
    if (!window.confirm(`${forzar ? 'FORZAR cierre' : 'Cerrar'} el período ${p.periodo}? No se podrán registrar asientos nuevos en ese mes.`)) return
    setProcesando(p.periodo)
    try {
      const { data, error } = await supabase.rpc('fn_cerrar_periodo', { p_periodo: p.periodo, p_usuario: cu?.id ?? 'ui', p_forzar: forzar, p_nota: forzar ? 'Cierre forzado desde UI' : null })
      if (error) throw error
      if (data?.cerrado) toast.success(`Período ${p.periodo} cerrado${data.forzado ? ' (forzado)' : ''}`)
      else toast.warning(`No se cerró: ${data?.motivo}. Revise el checklist.`)
      cargar()
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  async function reabrir(p) {
    const nota = window.prompt(`Motivo para reabrir ${p.periodo}:`)
    if (!nota) return
    setProcesando(p.periodo)
    try {
      const { error } = await supabase.rpc('fn_reabrir_periodo', { p_periodo: p.periodo, p_usuario: cu?.id ?? 'ui', p_nota: nota })
      if (error) throw error
      toast.success(`Período ${p.periodo} reabierto`); cargar()
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  const Chk = ({ ok, label }) => (
    <span title={label} style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, marginRight: 4,
      background: ok ? VERDE : ROJO }} />
  )

  return (
    <Panel titulo="Cierre de período" sub="Un período cerrado no acepta asientos nuevos; los documentos retroactivos quedan registrados para revisión">
      {cargando ? <Vacio texto="Cargando…" /> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={TH}>Período</th><th style={TH}>Estado</th><th style={TH}>Checklist</th>
            <th style={{ ...TH, textAlign: 'right' }}>Banco faltante</th>
            <th style={{ ...TH, textAlign: 'right' }}>Rechazos</th>
            <th style={TH}>Acción</th>
          </tr></thead>
          <tbody>
            {periodos.map(p => (
              <tr key={p.periodo}>
                <td style={{ ...TD, fontWeight: 700 }}>{p.periodo}</td>
                <td style={{ ...TD, fontWeight: 600, color: p.estado === 'cerrado' ? VERDE : AMBAR }}>
                  {p.estado}{p.cerrado_at ? <span style={{ color: SLATE, fontSize: 10, fontWeight: 400 }}> · {String(p.cerrado_at).slice(0, 10)}</span> : ''}
                </td>
                <td style={TD}>
                  <Chk ok={p.borradores === 0} label="Sin borradores" />
                  <Chk ok={p.costo_ventas_generado} label="Costo de ventas" />
                  <Chk ok={p.remuneraciones_generadas} label="Remuneraciones" />
                  <Chk ok={p.f29_generado} label="F29" />
                  <Chk ok={!p.banco_con_saldo_declarado || Math.abs(Number(p.banco_faltante || 0)) < 1000} label="Banco cuadrado" />
                  <span style={{ fontSize: 10, color: SLATE, marginLeft: 6 }}>
                    {p.listo_para_cerrar ? 'listo' : 'incompleto'}
                  </span>
                </td>
                <td style={{ ...TDNUM, color: Math.abs(Number(p.banco_faltante || 0)) > 1000 ? ROJO : VERDE }}>
                  {p.banco_faltante != null ? fmt(p.banco_faltante) : '—'}</td>
                <td style={{ ...TDNUM, color: p.rechazos_pendientes > 0 ? AMBAR : SLATE }}>{p.rechazos_pendientes}</td>
                <td style={TD}>
                  {p.estado === 'cerrado' ? (
                    <button onClick={() => reabrir(p)} disabled={procesando === p.periodo} style={{ ...INPUT, cursor: 'pointer', color: AMBAR, fontWeight: 600 }}>Reabrir</button>
                  ) : (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => cerrar(p, false)} disabled={procesando === p.periodo || !p.listo_para_cerrar}
                        style={{ ...INPUT, cursor: p.listo_para_cerrar ? 'pointer' : 'not-allowed', color: p.listo_para_cerrar ? VERDE : SLATE, fontWeight: 600, opacity: p.listo_para_cerrar ? 1 : 0.5 }}>Cerrar</button>
                      {!p.listo_para_cerrar && (
                        <button onClick={() => cerrar(p, true)} disabled={procesando === p.periodo}
                          style={{ ...INPUT, cursor: 'pointer', color: ROJO, fontSize: 11 }} title="Cerrar aunque el checklist esté incompleto">Forzar</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}

/* ─────────────────────────────── SHELL ────────────────────────────────── */
export function FinContabilidad({ cu }) {
  const [tab, setTab] = useState(() => {
    try { const g = localStorage.getItem('fin_cont_goto'); if (g) { localStorage.removeItem('fin_cont_goto'); return g } } catch (e) { }
    return 'indicadores'
  })
  const GRUPOS = [
    { g: 'Estados', tabs: [
      { k: 'indicadores', l: 'Indicadores' },
      { k: 'balance', l: 'Balance de comprobación' },
      { k: 'eerrdev', l: 'EERR y EBITDA' },
    ]},
    { g: 'Libros', tabs: [
      { k: 'diario', l: 'Diario' },
      { k: 'mayor', l: 'Mayor' },
      { k: 'banco', l: 'Libro banco' },
      { k: 'cxp', l: 'Cuentas por pagar' },
      { k: 'plan', l: 'Plan de cuentas' },
    ]},
    { g: 'Operación', tabs: [
      { k: 'comprobantes', l: 'Comprobantes' },
      { k: 'porclasificar', l: 'Por clasificar' },
      { k: 'tributario', l: 'Tributario' },
    ]},
    { g: 'Gobierno', tabs: [
      { k: 'control', l: 'Control y cierre' },
      { k: 'kpis', l: 'KPIs del cargo' },
      { k: 'auditoria', l: 'Auditoría' },
      { k: 'glosario', l: 'Glosario' },
    ]},
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${BORDE}`, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {GRUPOS.map((gr, gi) => (
          <div key={gr.g} style={{ display: 'flex', flexDirection: 'column', marginRight: gi < GRUPOS.length - 1 ? 18 : 0 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, paddingLeft: 14, marginBottom: 2 }}>{gr.g}</span>
            <div style={{ display: 'flex', gap: 2 }}>
              {gr.tabs.map(t => (
                <button key={t.k} onClick={() => setTab(t.k)} style={{
                  padding: '7px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
                  fontSize: 12, fontWeight: tab === t.k ? 700 : 500, color: tab === t.k ? NAVY : SLATE,
                  borderBottom: `2px solid ${tab === t.k ? NAVY : 'transparent'}`, marginBottom: -1, whiteSpace: 'nowrap',
                }}>{t.l}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {tab === 'indicadores' && <Indicadores />}
      {tab === 'balance' && <BalanceComprobacion />}
      {tab === 'eerrdev' && <EerrDevengo cu={cu} />}
      {tab === 'cxp' && <CuentasPorPagar />}
      {tab === 'diario' && <LibroDiario />}
      {tab === 'mayor' && <LibroMayor />}
      {tab === 'banco' && <LibroBanco />}
      {tab === 'plan' && <PlanCuentas />}
      {tab === 'comprobantes' && <Comprobantes cu={cu} />}
      {tab === 'porclasificar' && <PorClasificar cu={cu} />}
      {tab === 'tributario' && <Tributario />}
      {tab === 'control' && <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}><CuadraturaMotores /><CierrePeriodos cu={cu} /><ControlContable /></div>}
      {tab === 'glosario' && <Glosario />}
      {tab === 'kpis' && <FinKpisCargo cu={cu} />}
      {tab === 'auditoria' && <Auditoria />}
    </div>
  )
}

export default FinContabilidad
