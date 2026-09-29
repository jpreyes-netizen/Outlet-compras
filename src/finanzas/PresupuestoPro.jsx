import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../supabase'
import { toast } from 'sonner'
import { exportarExcel } from './exportUtils'
import { bloquesEerr, totalesEerr } from './eerrEstructura'

/* ══════════════════════════════════════════════════════════════════════
   PRESUPUESTO PROFESIONAL (29-sep-2026)
   · Modelo: versión × mes × línea EERR (ppto_detalle) + presupuesto de caja aparte (ppto_caja_detalle)
   · Subtotales SIEMPRE calculados con eerrEstructura.js (misma estructura que EERR y Libros)
   · Real = libro mayor (v_eerr_devengo_lineas); reproyección = real de meses cerrados + presupuesto del resto
   · Flujo: borrador (editable) → aprobado/vigente (bloqueado) → congelado (histórico). Prepara finanzas, aprueba dirección.
   ══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73'
const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', FONDO = '#F9FAFB'
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const ROLES_EDITA = ['admin', 'admin_sistema', 'dir_general', 'dir_finanzas', 'jefe_admin_finanzas']
const ROLES_APRUEBA = ['admin', 'dir_general', 'dir_negocios']
const ROLES_VE_SOCIOS = ['admin', 'admin_sistema', 'dir_general', 'dir_negocios']
const CAJA = [
  { k: 'MP_IMPORTACION', l: 'Mercadería importación' }, { k: 'MP_REPOSICION', l: 'Mercadería reposición' },
  { k: 'MP_INVERSION', l: 'Mercadería inversión' }, { k: 'MP_TRANSPORTES', l: 'Transporte de mercadería' },
  { k: 'CREDITOS', l: 'Créditos (cuotas)' }, { k: 'IMPUESTOS', l: 'Impuestos (IVA / SII)' },
]
const ESTADO = { borrador: { l: 'Borrador · editable', c: AMBAR }, vigente: { l: 'Vigente · aprobado', c: VERDE }, congelado: { l: 'Histórico · congelado', c: SLATE } }

const nf = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 })
const num = n => (n == null || isNaN(n) ? '–' : nf.format(Math.round(n)))
const mill = n => (n == null || isNaN(n) ? '–' : (n / 1e6).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const parseNum = s => { const t = String(s ?? '').replace(/\$/g, '').replace(/\./g, '').replace(',', '.').trim(); const v = Number(t); return t === '' ? 0 : (isNaN(v) ? null : v) }

const TH = { padding: '6px 8px', fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${BORDE}`, background: FONDO, position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap' }
const TD = { padding: '4px 8px', fontSize: 12, color: INK, borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const TDN = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }
const BTN = { fontSize: 12, padding: '5px 10px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: INK, cursor: 'pointer' }
const INPUT = { fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: INK }

/* Estructura del estado (idéntica al EERR): filas de detalle y subtotales */
function estructura(lineas) {
  const b = bloquesEerr(lineas)
  const nom = c => lineas.find(l => l.codigo === c)?.nombre ?? c
  const det = (cods, signo = -1) => cods.map(c => ({ tipo: 'det', codigo: c, nombre: nom(c), signo }))
  return {
    b,
    filas: [
      { tipo: 'det', codigo: 'VENTA_NETA', nombre: 'Venta neta (sin IVA)', signo: 1 },
      { tipo: 'det', codigo: 'VENTA_SIN_DOC', nombre: 'Ventas sin documento', signo: 1 },
      { tipo: 'det', codigo: 'COSTO_NETO', nombre: 'Costo de ventas', signo: -1 },
      { tipo: 'sub', codigo: 'MARGEN_CONTRIB', nombre: 'MARGEN BRUTO' },
      ...det(b.oper), { tipo: 'sub', codigo: 'TOTAL_MARGEN_BRUTO', nombre: 'MARGEN DESPUÉS DE OPERACIÓN' },
      ...det(b.venta), ...det(b.admin), { tipo: 'sub', codigo: 'EBITDA', nombre: 'EBITDA' },
      { tipo: 'det', codigo: 'DEPRECIACION', nombre: 'Depreciación', signo: -1 },
      { tipo: 'sub', codigo: 'RESULTADO_OPERACIONAL', nombre: 'RESULTADO OPERACIONAL (EBIT)' },
      { tipo: 'det', codigo: 'OTROS_INGRESOS', nombre: 'Otros ingresos no operacionales', signo: 1 },
      ...det(b.fin), { tipo: 'sub', codigo: 'RAI', nombre: 'RESULTADO ANTES DE IMPUESTO' },
      { tipo: 'det', codigo: 'IMPUESTO_RENTA', nombre: 'Impuesto a la renta (provisión)', signo: -1 },
      { tipo: 'sub', codigo: 'RESULTADO_NETO', nombre: 'RESULTADO NETO', total: true },
    ],
  }
}

/* Valor de una fila en un mes (i) para un mapa codigo → [12] */
const valorFila = (f, b, mapa, i) => f.tipo === 'det'
  ? Number(mapa[f.codigo]?.[i] ?? 0)
  : totalesEerr(b, (c, k) => Number(mapa[c]?.[k] ?? 0), i)[f.codigo]
const sumaMeses = (f, b, mapa, idx) => idx.reduce((s, i) => s + valorFila(f, b, mapa, i), 0)

/* Semáforo: desfavorable > 10 % y > $5M = rojo; > 5 % = ámbar */
function semaforo(f, real, ppto) {
  const desv = real - ppto
  const favorable = (f.tipo === 'sub' || f.signo > 0) ? desv >= 0 : desv <= 0
  const pct = ppto ? desv / Math.abs(ppto) : null
  if (favorable || pct == null) return { c: VERDE, t: favorable ? 'Favorable' : 'Sin presupuesto' }
  if (Math.abs(pct) > 0.10 && Math.abs(desv) > 5e6) return { c: ROJO, t: 'Desvío desfavorable relevante' }
  if (Math.abs(pct) > 0.05) return { c: AMBAR, t: 'Desvío desfavorable' }
  return { c: VERDE, t: 'Dentro de rango' }
}

function Panel({ titulo, sub, acciones, children }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{titulo}</div>{sub && <div style={{ fontSize: 11, color: SLATE, marginTop: 2 }}>{sub}</div>}</div>
        {acciones}
      </div>
      {children}
    </div>
  )
}

const VISTAS_PPTO = ['control', 'edicion', 'caja', 'versiones']

export function PresupuestoPro({ cu, sub, onSub, embebido }) {
  const puedeEditar = ROLES_EDITA.includes(cu?.rol)
  const puedeAprobar = ROLES_APRUEBA.includes(cu?.rol)
  const veSocios = ROLES_VE_SOCIOS.includes(cu?.rol)

  const [anio, setAnio] = useState(2026)
  const [vista, setVista] = useState(() => VISTAS_PPTO.includes(sub) ? sub : 'control')
  // Menú superior: el shell indica la vista (sub) y recibe los cambios internos
  const primeraSub = useRef(true)
  useEffect(() => { if (primeraSub.current) { primeraSub.current = false; return } if (sub && sub !== vista && VISTAS_PPTO.includes(sub)) setVista(sub) }, [sub]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onSub?.(vista) }, [vista]) // eslint-disable-line react-hooks/exhaustive-deps
  const [versiones, setVersiones] = useState([])
  const [verId, setVerId] = useState(null)
  const [lineas, setLineas] = useState([])
  const [ppto, setPpto] = useState({})
  const [caja, setCaja] = useState({})
  const [real, setReal] = useState({})
  const [cerrados, setCerrados] = useState(new Set())
  const [cargando, setCargando] = useState(true)
  const [modo, setModo] = useState('acum')
  const [mesSel, setMesSel] = useState(() => Math.max(0, new Date().getMonth() - 1))

  const version = versiones.find(v => v.id === verId)
  const editable = puedeEditar && version?.estado === 'borrador'

  const cargarVersiones = useCallback(async (preferir) => {
    const { data, error } = await supabase.from('eerr_presupuesto_versiones').select('*').eq('anio', anio).order('creado_at')
    if (error) { toast.error(error.message); return }
    setVersiones(data ?? [])
    const vig = (data ?? []).find(v => v.estado === 'vigente')
    setVerId(prev => preferir ?? ((data ?? []).some(v => v.id === prev) ? prev : (vig?.id ?? data?.[0]?.id ?? null)))
  }, [anio])

  useEffect(() => { cargarVersiones() }, [cargarVersiones])

  useEffect(() => {
    let cancel = false
    ;(async () => {
      setCargando(true)
      const [l, r, c] = await Promise.all([
        supabase.from('eerr_lineas').select('codigo, nombre, seccion, es_subtotal, activo_devengo, orden').eq('activo_devengo', true).order('orden'),
        supabase.from('v_eerr_devengo_lineas').select('periodo, codigo, monto').gte('periodo', `${anio}-01`).lte('periodo', `${anio}-12`).limit(5000),
        supabase.from('cont_periodos').select('periodo').eq('estado', 'cerrado'),
      ])
      if (cancel) return
      if (l.error || r.error) toast.error((l.error ?? r.error).message)
      setLineas((l.data ?? []).filter(x => veSocios || x.codigo !== 'REM_SOCIOS'))
      const m = {}
      ;(r.data ?? []).forEach(x => { const i = Number(x.periodo.slice(5, 7)) - 1; (m[x.codigo] ??= Array(12).fill(0))[i] += Number(x.monto ?? 0) })
      setReal(fusion(m))
      setCerrados(new Set((c.data ?? []).map(x => x.periodo)))
      setCargando(false)
    })()
    return () => { cancel = true }
  }, [anio, veSocios]) // eslint-disable-line react-hooks/exhaustive-deps

  const cargarVersion = useCallback(async () => {
    if (!verId) { setPpto({}); setCaja({}); return }
    const [p, c] = await Promise.all([
      supabase.from('ppto_detalle').select('periodo, linea_codigo, monto').eq('version_id', verId).limit(5000),
      supabase.from('ppto_caja_detalle').select('periodo, concepto, monto').eq('version_id', verId).limit(2000),
    ])
    if (p.error || c.error) { toast.error((p.error ?? c.error).message); return }
    const m = {}; (p.data ?? []).forEach(x => { const i = Number(x.periodo.slice(5, 7)) - 1; (m[x.linea_codigo] ??= Array(12).fill(0))[i] += Number(x.monto) })
    const k = {}; (c.data ?? []).forEach(x => { const i = Number(x.periodo.slice(5, 7)) - 1; (k[x.concepto] ??= Array(12).fill(0))[i] += Number(x.monto) })
    setPpto(fusion(m)); setCaja(k)
  }, [verId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargarVersion() }, [cargarVersion])

  // Confidencialidad: sin rol de socio, Remuneraciones socios se muestra dentro de Administración
  function fusion(m) {
    if (veSocios || !m.REM_SOCIOS) return m
    const out = { ...m }; const adm = [...(out.REM_ADMIN ?? Array(12).fill(0))]
    out.REM_SOCIOS.forEach((v, i) => { adm[i] += v }); out.REM_ADMIN = adm; delete out.REM_SOCIOS
    return out
  }

  const est = useMemo(() => estructura(lineas), [lineas])
  const esCerrado = i => cerrados.has(`${anio}-${String(i + 1).padStart(2, '0')}`)

  if (cargando) return <Panel titulo="Presupuesto"><div style={{ fontSize: 12, color: SLATE }}>Cargando…</div></Panel>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Cabecera: año, versión, estado */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 10, padding: '10px 14px' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginRight: 6 }}>Presupuesto</span>
        <select value={anio} onChange={e => setAnio(Number(e.target.value))} style={INPUT}>
          {[2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={verId ?? ''} onChange={e => setVerId(e.target.value)} style={{ ...INPUT, minWidth: 210 }}>
          {versiones.map(v => <option key={v.id} value={v.id}>{v.version} · {ESTADO[v.estado]?.l ?? v.estado}{v.tipo === 'reforecast' ? ' · reproyección' : ''}</option>)}
        </select>
        {version && <span style={{ fontSize: 11, fontWeight: 700, color: ESTADO[version.estado]?.c ?? SLATE, border: `1px solid ${ESTADO[version.estado]?.c ?? SLATE}`, borderRadius: 999, padding: '2px 8px' }}>{ESTADO[version.estado]?.l}</span>}
        {version?.aprobado_por && <span style={{ fontSize: 11, color: SLATE }}>Aprobado por {version.aprobado_por} · {String(version.aprobado_at ?? '').slice(0, 10)}</span>}
        <div style={{ flex: 1 }} />
        {!embebido && [['control', 'Control presupuestario'], ['edicion', 'Edición'], ['caja', 'Caja'], ['versiones', 'Versiones']].map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)} style={{ ...BTN, fontWeight: vista === k ? 700 : 500, color: vista === k ? '#fff' : INK, background: vista === k ? NAVY : '#fff', borderColor: vista === k ? NAVY : BORDE }}>{l}</button>
        ))}
      </div>

      {vista === 'control' && <Control est={est} real={real} ppto={ppto} anio={anio} modo={modo} setModo={setModo} mesSel={mesSel} setMesSel={setMesSel} esCerrado={esCerrado} version={version} />}
      {vista === 'edicion' && <Edicion est={est} ppto={ppto} setPpto={setPpto} version={version} editable={editable} anio={anio} esCerrado={esCerrado} veSocios={veSocios} />}
      {vista === 'caja' && <Caja caja={caja} setCaja={setCaja} version={version} editable={editable} anio={anio} />}
      {vista === 'versiones' && <Versiones versiones={versiones} anio={anio} puedeEditar={puedeEditar} puedeAprobar={puedeAprobar} recargar={cargarVersiones} setVerId={setVerId} />}
    </div>
  )
}

/* ───────────── CONTROL PRESUPUESTARIO: real vs presupuesto vs reproyección ───────────── */
function Control({ est, real, ppto, anio, modo, setModo, mesSel, setMesSel, esCerrado, version }) {
  const idx = modo === 'mes' ? [mesSel] : modo === 'acum' ? Array.from({ length: mesSel + 1 }, (_, i) => i) : Array.from({ length: 12 }, (_, i) => i)
  const ultimoCerrado = [...Array(12).keys()].filter(esCerrado).pop()
  // Reproyección del año: real en meses cerrados + presupuesto en el resto
  const proy = useMemo(() => {
    const out = {}
    const cods = new Set([...Object.keys(real), ...Object.keys(ppto)])
    cods.forEach(c => { out[c] = Array.from({ length: 12 }, (_, i) => esCerrado(i) ? Number(real[c]?.[i] ?? 0) : Number(ppto[c]?.[i] ?? 0)) })
    return out
  }, [real, ppto, esCerrado])

  const filas = est.filas.map(f => {
    const r = modo === 'anio' ? sumaMeses(f, est.b, proy, idx) : sumaMeses(f, est.b, real, idx)
    const p = sumaMeses(f, est.b, ppto, idx)
    return { f, r, p, d: r - p, pct: p ? (r - p) / Math.abs(p) : null, s: semaforo(f, r, p) }
  }).filter(x => x.f.tipo === 'sub' || x.r !== 0 || x.p !== 0)

  const titulo = modo === 'mes' ? `${MESES[mesSel]} ${anio}` : modo === 'acum' ? `Acumulado ene–${MESES[mesSel].toLowerCase()} ${anio}` : `Año ${anio} · reproyección (real a ${ultimoCerrado != null ? MESES[ultimoCerrado].toLowerCase() : '—'} + presupuesto)`
  const colReal = modo === 'anio' ? 'Reproyección' : 'Real (libro)'
  const exportar = () => exportarExcel(filas.map(x => ({ Línea: x.f.nombre, [colReal]: Math.round(x.r), Presupuesto: Math.round(x.p), 'Desvío $': Math.round(x.d), 'Desvío %': x.pct == null ? '' : Math.round(x.pct * 1000) / 10, Estado: x.s.t })), `control_presupuestario_${anio}_${modo}`, 'Control')

  const rojos = filas.filter(x => x.s.c === ROJO && x.f.tipo === 'det')
  return (
    <Panel titulo={`Control presupuestario · ${titulo}`}
      sub={`Real = libro mayor (misma cifra que Libros y estados y el Análisis ejecutivo) · Presupuesto = versión ${version?.version ?? '—'} · cifras en millones de pesos`}
      acciones={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {[['mes', 'Mes'], ['acum', 'Acumulado'], ['anio', 'Año + reproyección']].map(([k, l]) => (
            <button key={k} onClick={() => setModo(k)} style={{ ...BTN, fontWeight: modo === k ? 700 : 500, borderColor: modo === k ? NAVY : BORDE, color: modo === k ? NAVY : INK }}>{l}</button>
          ))}
          {modo !== 'anio' && <select value={mesSel} onChange={e => setMesSel(Number(e.target.value))} style={INPUT}>
            {MESES.map((m, i) => <option key={m} value={i}>{m}{esCerrado(i) ? ' · cerrado' : ''}</option>)}
          </select>}
          <button onClick={exportar} style={BTN}>Excel ⬇</button>
        </div>
      }>
      {rojos.length > 0 && (
        <div style={{ fontSize: 12, color: ROJO, background: '#FEF3F2', border: '1px solid #FECDCA', borderRadius: 8, padding: '6px 10px', marginBottom: 10 }}>
          <b>{rojos.length} desvío{rojos.length > 1 ? 's' : ''} desfavorable{rojos.length > 1 ? 's' : ''} relevante{rojos.length > 1 ? 's' : ''}</b> (&gt;10 % y &gt;$5M): {rojos.slice(0, 6).map(x => `${x.f.nombre} ${mill(x.d)}M`).join(' · ')}
        </div>
      )}
      <div style={{ overflowX: 'auto', maxHeight: '68vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...TH, textAlign: 'left' }}>Línea</th><th style={{ ...TH, textAlign: 'right' }}>{colReal}</th>
            <th style={{ ...TH, textAlign: 'right' }}>Presupuesto</th><th style={{ ...TH, textAlign: 'right' }}>Desvío $</th>
            <th style={{ ...TH, textAlign: 'right' }}>Desvío %</th><th style={TH}></th>
          </tr></thead>
          <tbody>
            {filas.map(x => {
              const sub = x.f.tipo === 'sub'
              return (
                <tr key={x.f.codigo} style={{ background: x.f.total ? '#EEF2FF' : sub ? FONDO : '#fff' }}>
                  <td style={{ ...TD, fontWeight: sub ? 700 : 400, color: sub ? NAVY : INK, paddingLeft: sub ? 8 : 18 }}>{x.f.nombre}</td>
                  <td style={{ ...TDN, fontWeight: sub ? 700 : 400 }}>{mill(x.r)}</td>
                  <td style={{ ...TDN, color: SLATE }}>{mill(x.p)}</td>
                  <td style={{ ...TDN, color: x.s.c === VERDE ? INK : x.s.c }}>{mill(x.d)}</td>
                  <td style={{ ...TDN, color: x.s.c === VERDE ? SLATE : x.s.c }}>{x.pct == null ? '–' : `${(x.pct * 100).toFixed(1)} %`}</td>
                  <td style={{ ...TD, width: 18 }} title={x.s.t}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: x.s.c }} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ───────────── EDICIÓN: grilla línea × mes (solo borradores) ───────────── */
function Edicion({ est, ppto, setPpto, version, editable, anio, esCerrado, veSocios }) {
  const [guardando, setGuardando] = useState(null)
  const detalles = est.filas.filter(f => f.tipo === 'det')

  async function guardar(codigo, i, texto) {
    const v = parseNum(texto)
    if (v == null) { toast.error('Monto inválido'); return }
    if (Math.round(v) === Math.round(ppto[codigo]?.[i] ?? 0)) return
    setGuardando(`${codigo}-${i}`)
    const { error } = await supabase.rpc('fn_ppto_set', { p_version_id: version.id, p_linea: codigo, p_periodo: `${anio}-${String(i + 1).padStart(2, '0')}`, p_monto: v })
    setGuardando(null)
    if (error) { toast.error(error.message); return }
    setPpto(p => ({ ...p, [codigo]: Object.assign([...(p[codigo] ?? Array(12).fill(0))], { [i]: v }) }))
  }

  // Total anual editado: se reparte proporcional a lo que ya tiene cada mes (o en partes iguales si está vacío)
  async function repartir(codigo, texto) {
    const total = parseNum(texto)
    if (total == null) { toast.error('Monto inválido'); return }
    const act = ppto[codigo] ?? Array(12).fill(0)
    const base = act.reduce((a, b) => a + b, 0)
    const nuevo = act.map(v => Math.round(base ? total * v / base : total / 12))
    nuevo[11] += Math.round(total) - nuevo.reduce((a, b) => a + b, 0)
    setGuardando(`${codigo}-T`)
    for (let i = 0; i < 12; i++) {
      const { error } = await supabase.rpc('fn_ppto_set', { p_version_id: version.id, p_linea: codigo, p_periodo: `${anio}-${String(i + 1).padStart(2, '0')}`, p_monto: nuevo[i] })
      if (error) { toast.error(error.message); setGuardando(null); return }
    }
    setGuardando(null)
    setPpto(p => ({ ...p, [codigo]: nuevo }))
    toast.success('Total repartido en los 12 meses')
  }

  const exportar = () => exportarExcel(est.filas.map(f => {
    const o = { Línea: f.nombre }
    MESES.forEach((m, i) => { o[m] = Math.round(valorFila(f, est.b, ppto, i)) })
    o.Total = Math.round(sumaMeses(f, est.b, ppto, [...Array(12).keys()]))
    return o
  }), `presupuesto_${anio}_${version?.version}`, 'Presupuesto')

  return (
    <Panel titulo={`Edición · versión ${version?.version ?? '—'}`}
      sub={editable
        ? 'Borrador: edita una celda y sale al perder el foco · editar el total anual lo reparte proporcional a los meses · subtotales se calculan solos' + (veSocios ? '' : ' · Remuneraciones socios se muestra dentro de Administración')
        : 'Solo lectura: las versiones aprobadas no se modifican. Para cambiar cifras crea una versión nueva (copia o reproyección) en "Versiones".'}
      acciones={<button onClick={exportar} style={BTN}>Excel ⬇</button>}>
      <div style={{ overflowX: 'auto', maxHeight: '68vh' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <thead><tr>
            <th style={{ ...TH, textAlign: 'left', minWidth: 220, left: 0, zIndex: 2 }}>Línea</th>
            {MESES.map((m, i) => <th key={m} style={{ ...TH, textAlign: 'right', color: esCerrado(i) && version?.tipo === 'reforecast' ? VERDE : SLATE }}>{m}{esCerrado(i) && version?.tipo === 'reforecast' ? ' ✓' : ''}</th>)}
            <th style={{ ...TH, textAlign: 'right' }}>Total</th>
          </tr></thead>
          <tbody>
            {est.filas.map(f => {
              const sub = f.tipo === 'sub'
              const total = sumaMeses(f, est.b, ppto, [...Array(12).keys()])
              if (!sub && !editable && !total) return null
              return (
                <tr key={f.codigo} style={{ background: f.total ? '#EEF2FF' : sub ? FONDO : '#fff' }}>
                  <td style={{ ...TD, fontWeight: sub ? 700 : 400, color: sub ? NAVY : INK, paddingLeft: sub ? 8 : 18, position: 'sticky', left: 0, background: f.total ? '#EEF2FF' : sub ? FONDO : '#fff' }}>{f.nombre}</td>
                  {MESES.map((m, i) => {
                    const v = valorFila(f, est.b, ppto, i)
                    const real = esCerrado(i) && version?.tipo === 'reforecast'
                    if (sub || !editable) return <td key={m} style={{ ...TDN, fontWeight: sub ? 700 : 400, background: real && !sub ? '#F0FDF4' : undefined }}>{num(v)}</td>
                    return (
                      <td key={m} style={{ ...TDN, padding: 0, background: real ? '#F0FDF4' : undefined }}>
                        <input key={`${f.codigo}-${i}-${v}`} defaultValue={num(v) === '–' ? '0' : num(v)} disabled={guardando === `${f.codigo}-${i}`}
                          onBlur={e => guardar(f.codigo, i, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                          title={real ? 'Mes cerrado: cifra real del libro (puedes ajustarla en el borrador)' : undefined}
                          style={{ width: 96, border: 'none', background: 'transparent', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: '4px 8px' }} />
                      </td>
                    )
                  })}
                  <td style={{ ...TDN, fontWeight: 700, padding: editable && !sub ? 0 : TDN.padding }}>
                    {editable && !sub
                      ? <input key={`${f.codigo}-T-${total}`} defaultValue={num(total)} disabled={guardando === `${f.codigo}-T`}
                          onBlur={e => { if (Math.round(parseNum(e.target.value) ?? total) !== Math.round(total)) repartir(f.codigo, e.target.value) }}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                          style={{ width: 110, border: 'none', background: 'transparent', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 700, padding: '4px 8px' }} />
                      : num(total)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ───────────── CAJA: compras de mercadería, créditos e impuestos (no son resultado) ───────────── */
function Caja({ caja, setCaja, version, editable, anio }) {
  async function guardar(concepto, i, texto) {
    const v = parseNum(texto)
    if (v == null) { toast.error('Monto inválido'); return }
    if (Math.round(v) === Math.round(caja[concepto]?.[i] ?? 0)) return
    const { error } = await supabase.rpc('fn_ppto_caja_set', { p_version_id: version.id, p_concepto: concepto, p_periodo: `${anio}-${String(i + 1).padStart(2, '0')}`, p_monto: v })
    if (error) { toast.error(error.message); return }
    setCaja(c => ({ ...c, [concepto]: Object.assign([...(c[concepto] ?? Array(12).fill(0))], { [i]: v }) }))
  }
  const total = i => CAJA.reduce((s, c) => s + Number(caja[c.k]?.[i] ?? 0), 0)
  return (
    <Panel titulo={`Presupuesto de caja · versión ${version?.version ?? '—'}`}
      sub="Salidas de dinero que no son gasto del período: compras de mercadería (van a inventario), cuotas de créditos e impuestos. Separadas del estado de resultados.">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <thead><tr><th style={{ ...TH, textAlign: 'left', minWidth: 200 }}>Concepto</th>{MESES.map(m => <th key={m} style={{ ...TH, textAlign: 'right' }}>{m}</th>)}<th style={{ ...TH, textAlign: 'right' }}>Total</th></tr></thead>
          <tbody>
            {CAJA.map(c => (
              <tr key={c.k}>
                <td style={TD}>{c.l}</td>
                {MESES.map((m, i) => (
                  <td key={m} style={{ ...TDN, padding: editable ? 0 : TDN.padding }}>
                    {editable
                      ? <input key={`${c.k}-${i}-${caja[c.k]?.[i] ?? 0}`} defaultValue={num(caja[c.k]?.[i] ?? 0)} onBlur={e => guardar(c.k, i, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                          style={{ width: 96, border: 'none', background: 'transparent', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: '4px 8px' }} />
                      : num(caja[c.k]?.[i] ?? 0)}
                  </td>
                ))}
                <td style={{ ...TDN, fontWeight: 700 }}>{num((caja[c.k] ?? []).reduce((a, b) => a + b, 0))}</td>
              </tr>
            ))}
            <tr style={{ background: FONDO }}>
              <td style={{ ...TD, fontWeight: 700, color: NAVY }}>TOTAL SALIDAS DE CAJA</td>
              {MESES.map((m, i) => <td key={m} style={{ ...TDN, fontWeight: 700 }}>{num(total(i))}</td>)}
              <td style={{ ...TDN, fontWeight: 700 }}>{num([...Array(12).keys()].reduce((s, i) => s + total(i), 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ───────────── VERSIONES: crear (copia / reproyección / vacía), aprobar, eliminar borrador ───────────── */
function Versiones({ versiones, anio, puedeEditar, puedeAprobar, recargar, setVerId }) {
  const vig = versiones.find(v => v.estado === 'vigente')
  const [form, setForm] = useState({ version: '', descripcion: '', base: '', modo: 'reforecast' })
  const [trabajando, setTrabajando] = useState(false)
  useEffect(() => { setForm(f => ({ ...f, base: f.base || vig?.id || versiones[0]?.id || '' })) }, [versiones]) // eslint-disable-line react-hooks/exhaustive-deps

  async function crear() {
    if (!form.version.trim()) { toast.error('Indica un código, por ejemplo R2 o F1'); return }
    setTrabajando(true)
    const { data, error } = await supabase.rpc('fn_ppto_nueva_version', { p_anio: anio, p_version: form.version.trim(), p_descripcion: form.descripcion || null, p_base_id: form.modo === 'vacia' ? null : form.base, p_modo: form.modo })
    setTrabajando(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Versión ${form.version} creada en borrador`)
    setForm(f => ({ ...f, version: '', descripcion: '' }))
    await recargar(data?.version_id)
  }
  async function aprobar(v) {
    const nota = window.prompt(`Aprobar ${v.version} como presupuesto VIGENTE ${anio}.${vig ? ` ${vig.version} pasará a histórico.` : ''}\nComentario de aprobación (opcional):`, '')
    if (nota === null) return
    const { error } = await supabase.rpc('fn_ppto_aprobar', { p_version_id: v.id, p_nota: nota || null })
    if (error) { toast.error(error.message); return }
    toast.success(`${v.version} aprobado y vigente`)
    await recargar(v.id)
  }
  async function eliminar(v) {
    if (!window.confirm(`Eliminar el borrador ${v.version}? No se puede deshacer.`)) return
    const { error } = await supabase.rpc('fn_ppto_eliminar_borrador', { p_version_id: v.id })
    if (error) { toast.error(error.message); return }
    toast.success(`Borrador ${v.version} eliminado`)
    await recargar()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Panel titulo={`Versiones ${anio}`} sub="Vigente = aprobada por dirección (bloqueada) · Borrador = en preparación · Histórico = versiones reemplazadas (se conservan para comparar)">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Versión', 'Tipo', 'Estado', 'Creada', 'Aprobada', 'Descripción', ''].map(h => <th key={h} style={{ ...TH, textAlign: 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {versiones.map(v => (
              <tr key={v.id}>
                <td style={{ ...TD, fontWeight: 700, color: NAVY, cursor: 'pointer' }} onClick={() => setVerId(v.id)} title="Ver esta versión">{v.version}</td>
                <td style={TD}>{v.tipo === 'reforecast' ? 'Reproyección' : 'Presupuesto'}</td>
                <td style={{ ...TD, color: ESTADO[v.estado]?.c, fontWeight: 600 }}>{ESTADO[v.estado]?.l ?? v.estado}</td>
                <td style={{ ...TD, fontSize: 11, color: SLATE }}>{String(v.creado_at).slice(0, 10)} · {v.creado_por}</td>
                <td style={{ ...TD, fontSize: 11, color: SLATE }}>{v.aprobado_at ? `${String(v.aprobado_at).slice(0, 10)} · ${v.aprobado_por}` : '—'}</td>
                <td style={{ ...TD, fontSize: 11, color: SLATE, whiteSpace: 'normal', maxWidth: 360 }}>{v.descripcion ?? ''}</td>
                <td style={TD}>
                  {v.estado === 'borrador' && puedeAprobar && <button onClick={() => aprobar(v)} style={{ ...BTN, color: VERDE, fontWeight: 600 }}>Aprobar</button>}
                  {v.estado === 'borrador' && puedeEditar && <button onClick={() => eliminar(v)} style={{ ...BTN, color: ROJO, marginLeft: 4 }}>Eliminar</button>}
                  {v.estado === 'borrador' && !puedeAprobar && <span style={{ fontSize: 11, color: SLATE }}>Pendiente de aprobación por dirección</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {puedeEditar && (
        <Panel titulo="Nueva versión" sub="Reproyección: toma el REAL del libro en los meses cerrados y el presupuesto base en el resto del año. Copia: duplica la versión base para ajustarla.">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={form.version} onChange={e => setForm({ ...form, version: e.target.value.toUpperCase() })} placeholder="Código (R2, F1…)" style={{ ...INPUT, width: 120 }} />
            <select value={form.modo} onChange={e => setForm({ ...form, modo: e.target.value })} style={INPUT}>
              <option value="reforecast">Reproyección (real + presupuesto)</option>
              <option value="copia">Copia de otra versión</option>
              <option value="vacia">Vacía</option>
            </select>
            {form.modo !== 'vacia' && (
              <select value={form.base} onChange={e => setForm({ ...form, base: e.target.value })} style={INPUT}>
                {versiones.map(v => <option key={v.id} value={v.id}>Base: {v.version}</option>)}
              </select>
            )}
            <input value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Descripción / motivo" style={{ ...INPUT, flex: 1, minWidth: 220 }} />
            <button onClick={crear} disabled={trabajando} style={{ ...BTN, background: NAVY, color: '#fff', borderColor: NAVY, fontWeight: 600 }}>{trabajando ? 'Creando…' : 'Crear borrador'}</button>
          </div>
        </Panel>
      )}
    </div>
  )
}
