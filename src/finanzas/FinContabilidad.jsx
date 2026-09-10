import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabase'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

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
          supabase.from('plan_cuentas').select('codigo, nombre, nombre_contador, nivel, tipo_eeff, naturaleza, acepta_movimientos, origen, activa').order('codigo').limit(1000),
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
        .select('id, numero, fecha, periodo, glosa, origen, estado, total_debe, total_haber')
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
      .select('id, orden, plan_cuenta_codigo, debe, haber, glosa')
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
function EerrDevengo() {
  const [mensual, setMensual] = useState([])
  const [detalle, setDetalle] = useState([])
  const [mesSel, setMesSel] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const [{ data: m }, { data: d }] = await Promise.all([
          supabase.from('v_eerr_devengo_mensual').select('*').limit(24),
          supabase.from('v_eerr_devengo').select('*').limit(2000),
        ])
        setMensual(m ?? []); setDetalle(d ?? [])
      } catch (e) { toast.error('Error: ' + e.message) }
      finally { setCargando(false) }
    })()
  }, [])

  const detMes = useMemo(() => (detalle ?? []).filter(d => d.periodo === mesSel), [detalle, mesSel])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px',
        fontSize: 11, color: '#92400E' }}>
        EERR por devengo desde el libro mayor — corre EN PARALELO al EERR de gestión y no lo reemplaza.
        Limitaciones vigentes: costo de ventas a costo estándar actual, sin aportes patronales,
        cartolas bancarias incompletas afectan gastos pagados por caja.
      </div>
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
    </div>
  )
}

/* ─────────────────────────────── SHELL ────────────────────────────────── */
export function FinContabilidad() {
  const [tab, setTab] = useState('balance')
  const TABS = [
    { k: 'balance', l: 'Balance' },
    { k: 'eerrdev', l: 'EERR Devengo' },
    { k: 'diario', l: 'Libro diario' },
    { k: 'mayor', l: 'Libro mayor' },
    { k: 'plan', l: 'Plan de cuentas' },
    { k: 'control', l: 'Control' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${BORDE}`, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: '7px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 12, fontWeight: tab === t.k ? 700 : 500, color: tab === t.k ? NAVY : SLATE,
            borderBottom: `2px solid ${tab === t.k ? NAVY : 'transparent'}`, marginBottom: -1,
          }}>{t.l}</button>
        ))}
      </div>
      {tab === 'balance' && <BalanceComprobacion />}
      {tab === 'eerrdev' && <EerrDevengo />}
      {tab === 'diario' && <LibroDiario />}
      {tab === 'mayor' && <LibroMayor />}
      {tab === 'plan' && <PlanCuentas />}
      {tab === 'control' && <ControlContable />}
    </div>
  )
}

export default FinContabilidad
