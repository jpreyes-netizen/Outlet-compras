/* ════════════════════════════════════════════════════════════════════
   InvTorre.jsx — Torre de control de inventario
   Outlet de Puertas SpA

   Tres decisiones separadas, porque en retail multi-tienda con CD son
   problemas distintos y mezclarlos produce órdenes de compra erradas:
     RED       ¿cuánto comprar en total?  (agrega tiendas + CD + tránsito)
     TIENDA    ¿qué le falta a cada sala? (decisión de reposición local)
     ASIGNAR   ¿qué empujar del CD?       (fair share por déficit relativo)

   Toda la matemática vive en SQL. Este componente sólo filtra y muestra.
   ════════════════════════════════════════════════════════════════════ */

import { useState, useEffect, useMemo, Fragment } from 'react'
import {
  fetchKpiSku, fetchRed, fetchAsignacion, fetchSalud, calcularKpis,
  matrizAbcXyz, LEYENDA_ABC_XYZ, SUCURSALES, SUC_VENTA, nombreSuc,
  ESTADOS, CL_ESTADO, CL_ABC, CL_PATRON, AYUDA_PATRON,
} from './invData'

const fmt  = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const fN   = n => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))
const fMM  = n => {
  const v = Math.abs(n || 0)
  if (v >= 1e9) return (n / 1e9).toFixed(2) + ' MMM'
  if (v >= 1e6) return (n / 1e6).toFixed(1) + ' MM'
  if (v >= 1e3) return Math.round(n / 1e3) + ' k'
  return String(Math.round(n || 0))
}

const INK = '#1C1C1E', SLATE = '#6E6E73', LINE = '#E3E3E6'
const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', NAVY = '#16213E'

const VISTAS = [
  { k: 'red',     l: 'Red · Comprar' },
  { k: 'tienda',  l: 'Tienda · Reponer' },
  { k: 'asignar', l: 'CD · Asignar' },
]

/* ── Celda KPI compacta ─────────────────────────────────────────── */
function Kpi({ label, valor, sub, color, alerta }) {
  return (
    <div style={{
      background: '#fff', border: `1px solid ${alerta ? ROJO + '40' : LINE}`,
      borderLeft: `3px solid ${color || SLATE}`, borderRadius: 4,
      padding: '8px 11px', flex: '1 1 128px', minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: SLATE, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color || INK, letterSpacing: '-.02em', lineHeight: 1.2 }}>{valor}</div>
      {sub && <div style={{ fontSize: 10.5, color: SLATE, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

function Tag({ texto, color }) {
  return <span style={{
    display: 'inline-block', padding: '1px 6px', borderRadius: 3,
    fontSize: 10, fontWeight: 700, color, background: color + '18',
    border: `1px solid ${color}30`, whiteSpace: 'nowrap',
  }}>{texto}</span>
}

/* ── Matriz ABC × XYZ ───────────────────────────────────────────── */
function MatrizAbcXyz({ red, sel, onSel }) {
  const m = useMemo(() => matrizAbcXyz(red), [red])
  const maxV = Math.max(...Object.values(m).map(c => c.valor), 1)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '34px repeat(3, 1fr)', gap: 3 }}>
        <div />
        {['X', 'Y', 'Z'].map(x => (
          <div key={x} style={{ fontSize: 10, fontWeight: 700, color: SLATE, textAlign: 'center', paddingBottom: 2 }}>
            {x}{x === 'X' ? ' · estable' : x === 'Y' ? ' · variable' : ' · errático'}
          </div>
        ))}
        {['A', 'B', 'C', 'D'].map(a => (
          <Fragment key={a}>
            <div style={{ fontSize: 12, fontWeight: 800, color: CL_ABC[a], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{a}</div>
            {['X', 'Y', 'Z'].map(x => {
              const c = m[a + x], k = a + x, activo = sel === k
              const int = c.valor / maxV
              return (
                <button key={k} onClick={() => onSel(activo ? null : k)} title={LEYENDA_ABC_XYZ[k]}
                  style={{
                    border: `1px solid ${activo ? NAVY : LINE}`, borderRadius: 3, cursor: 'pointer',
                    background: activo ? NAVY : `rgba(22,33,62,${0.04 + int * 0.16})`,
                    color: activo ? '#fff' : INK, padding: '7px 6px', textAlign: 'left', font: 'inherit',
                  }}>
                  <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.1 }}>{c.skus}</div>
                  <div style={{ fontSize: 10, opacity: .75 }}>{fMM(c.valor)}</div>
                </button>
              )
            })}
          </Fragment>
        ))}
      </div>
      <div style={{ fontSize: 11, color: SLATE, marginTop: 7, lineHeight: 1.45 }}>
        {sel
          ? <><b style={{ color: INK }}>{sel}</b> — {LEYENDA_ABC_XYZ[sel]}</>
          : 'ABC por margen anual acumulado (Pareto). XYZ por variabilidad de la demanda. Clic para filtrar.'}
      </div>
    </div>
  )
}

/* ── Tabla ──────────────────────────────────────────────────────── */
function Tabla({ cols, filas, orden, setOrden }) {
  const ordenadas = useMemo(() => {
    if (!orden?.col) return filas
    const { col, dir } = orden
    return [...filas].sort((a, b) => {
      const va = a[col], vb = b[col]
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb : String(va).localeCompare(String(vb), 'es')
      return dir === 'asc' ? cmp : -cmp
    })
  }, [filas, orden])

  const toggle = c => setOrden(o =>
    o?.col === c ? { col: c, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { col: c, dir: 'desc' })

  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${LINE}`, borderRadius: 4, background: '#fff' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#FAFAFB' }}>
            {cols.map(c => (
              <th key={c.k} onClick={() => toggle(c.k)} title="Ordenar"
                style={{
                  padding: '7px 9px', textAlign: c.num ? 'right' : 'left', cursor: 'pointer',
                  fontSize: 10.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase',
                  letterSpacing: '.03em', borderBottom: `1px solid ${LINE}`,
                  position: 'sticky', top: 0, background: '#FAFAFB', whiteSpace: 'nowrap',
                }}>
                {c.l}{orden?.col === c.k ? (orden.dir === 'asc' ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordenadas.slice(0, 400).map((f, i) => (
            <tr key={(f.sku || i) + '|' + (f.sucursal_id || '')}
              style={{ borderBottom: `1px solid ${LINE}`, background: i % 2 ? '#FCFCFD' : '#fff' }}>
              {cols.map(c => (
                <td key={c.k} style={{
                  padding: '6px 9px', textAlign: c.num ? 'right' : 'left',
                  color: INK, whiteSpace: c.wrap ? 'normal' : 'nowrap',
                  maxWidth: c.wrap ? 260 : undefined,
                  fontVariantNumeric: c.num ? 'tabular-nums' : undefined,
                }}>
                  {c.render ? c.render(f) : (c.num ? fN(f[c.k]) : (f[c.k] ?? '—'))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {ordenadas.length > 400 && (
        <div style={{ padding: '7px 10px', fontSize: 11, color: SLATE, borderTop: `1px solid ${LINE}` }}>
          Mostrando 400 de {fN(ordenadas.length)} filas. Afina los filtros para ver el resto.
        </div>
      )}
      {!ordenadas.length && (
        <div style={{ padding: 24, textAlign: 'center', color: SLATE, fontSize: 12.5 }}>
          Sin resultados con los filtros actuales.
        </div>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════ */
export function InvTorre({ scopeUsuario, isMobile }) {
  const [vista, setVista]   = useState('red')
  const [kpiSku, setKpiSku] = useState([])
  const [red, setRed]       = useState([])
  const [asig, setAsig]     = useState([])
  const [salud, setSalud]   = useState({})
  const [cargando, setCargando] = useState(true)
  const [err, setErr]       = useState('')
  const [orden, setOrden]   = useState({ col: 'venta_perdida_84d', dir: 'desc' })

  const [fSuc, setFSuc]       = useState(scopeUsuario || 'TODAS')
  const [fEstado, setFEstado] = useState('TODOS')
  const [fCelda, setFCelda]   = useState(null)
  const [fTexto, setFTexto]   = useState('')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCargando(true); setErr('')
      try {
        const [k, r, a, s] = await Promise.all([
          fetchKpiSku({ soloVende: true }), fetchRed(), fetchAsignacion(), fetchSalud(),
        ])
        if (!vivo) return
        setKpiSku(k); setRed(r); setAsig(a); setSalud(s)
      } catch (e) { if (vivo) setErr(e.message) }
      if (vivo) setCargando(false)
    })()
    return () => { vivo = false }
  }, [])

  const kpiFiltrado = useMemo(
    () => fSuc === 'TODAS' ? kpiSku : kpiSku.filter(f => f.sucursal_id === fSuc),
    [kpiSku, fSuc])

  const k = useMemo(() => calcularKpis(kpiFiltrado), [kpiFiltrado])

  const filas = useMemo(() => {
    let base = vista === 'red' ? red : vista === 'asignar' ? asig : kpiFiltrado
    if (fCelda && vista === 'red')
      base = base.filter(f => (f.abc || 'D') + (f.xyz || 'Z') === fCelda)
    if (fEstado !== 'TODOS' && vista !== 'red')
      base = base.filter(f => f.estado === fEstado)
    if (fSuc !== 'TODAS' && vista === 'asignar')
      base = base.filter(f => f.sucursal_id === fSuc)
    if (fTexto.trim()) {
      const t = fTexto.trim().toLowerCase()
      base = base.filter(f =>
        String(f.sku || '').toLowerCase().includes(t) ||
        String(f.producto || '').toLowerCase().includes(t))
    }
    return base
  }, [vista, red, asig, kpiFiltrado, fCelda, fEstado, fSuc, fTexto])

  /* ── Columnas por vista ── */
  const COLS = {
    red: [
      { k: 'sku', l: 'SKU' },
      { k: 'producto', l: 'Producto', wrap: true },
      { k: 'abc', l: 'ABC', render: f => <Tag texto={(f.abc || 'D') + (f.xyz || 'Z')} color={CL_ABC[f.abc] || SLATE} /> },
      { k: 'disponible_tiendas', l: 'En tiendas', num: true },
      { k: 'disponible_cd', l: 'En CD', num: true },
      { k: 'transito', l: 'Tránsito', num: true },
      { k: 'demanda_dia_red', l: 'Demanda/día', num: true, render: f => (+f.demanda_dia_red || 0).toFixed(2) },
      { k: 'dias_cobertura_red', l: 'Cobertura', num: true, render: f => f.dias_cobertura_red == null ? '—' : fN(f.dias_cobertura_red) + ' d' },
      { k: 'pct_quiebre_tiendas', l: '% quiebre', num: true,
        render: f => <span style={{ color: +f.pct_quiebre_tiendas > 30 ? ROJO : INK }}>{f.pct_quiebre_tiendas == null ? '—' : fN(f.pct_quiebre_tiendas) + '%'}</span> },
      { k: 'venta_perdida_84d', l: 'Venta perdida 84d', num: true,
        render: f => <span style={{ color: +f.venta_perdida_84d > 0 ? ROJO : SLATE }}>{fmt(f.venta_perdida_84d)}</span> },
      { k: 'comprar_sugerido', l: 'Comprar', num: true,
        render: f => <b style={{ color: +f.comprar_sugerido > 0 ? NAVY : SLATE }}>{fN(f.comprar_sugerido)}</b> },
      { k: 'valor_red', l: 'Valor stock', num: true, render: f => fmt(f.valor_red) },
    ],
    tienda: [
      { k: 'sku', l: 'SKU' },
      { k: 'producto', l: 'Producto', wrap: true },
      { k: 'sucursal_id', l: 'Sucursal', render: f => nombreSuc(f.sucursal_id) },
      { k: 'estado', l: 'Estado', render: f => <Tag texto={f.estado} color={CL_ESTADO[f.estado] || SLATE} /> },
      { k: 'patron', l: 'Patrón', render: f => <Tag texto={(f.patron || '').slice(0, 4)} color={CL_PATRON[f.patron] || SLATE} /> },
      { k: 'disponible', l: 'Disp.', num: true },
      { k: 'demanda_dia', l: 'Demanda/día', num: true, render: f => (+f.demanda_dia || 0).toFixed(2) },
      { k: 'safety_stock', l: 'Seguridad', num: true },
      { k: 'punto_reorden', l: 'Punto reorden', num: true },
      { k: 'dias_cobertura', l: 'Cobertura', num: true, render: f => f.dias_cobertura == null ? '—' : fN(f.dias_cobertura) + ' d' },
      { k: 'pct_quiebre', l: '% quiebre 84d', num: true,
        render: f => <span style={{ color: +f.pct_quiebre > 30 ? ROJO : INK }}>{fN(f.pct_quiebre)}%</span> },
      { k: 'venta_perdida_84d', l: 'Venta perdida', num: true, render: f => fmt(f.venta_perdida_84d) },
      { k: 'sugerido', l: 'Reponer', num: true, render: f => <b>{fN(f.sugerido)}</b> },
    ],
    asignar: [
      { k: 'sku', l: 'SKU' },
      { k: 'producto', l: 'Producto', wrap: true },
      { k: 'sucursal_id', l: 'Destino', render: f => nombreSuc(f.sucursal_id) },
      { k: 'estado', l: 'Estado', render: f => <Tag texto={f.estado} color={CL_ESTADO[f.estado] || SLATE} /> },
      { k: 'disponible', l: 'Tiene', num: true },
      { k: 'necesidad', l: 'Necesita', num: true },
      { k: 'stock_cd', l: 'Hay en CD', num: true },
      { k: 'enviar_sugerido', l: 'Enviar', num: true, render: f => <b style={{ color: NAVY }}>{fN(f.enviar_sugerido)}</b> },
      { k: 'criterio', l: 'Criterio', render: f => <Tag texto={f.criterio} color={f.criterio === 'CD sin stock' ? ROJO : f.criterio === 'prorrateo' ? AMBAR : VERDE} /> },
      { k: 'valor_envio', l: 'Valor', num: true, render: f => fmt(f.valor_envio) },
    ],
  }

  const rebuildPend = +salud.rebuild_lotes_pendientes || 0
  const sel = { padding: '5px 8px', border: `1px solid ${LINE}`, borderRadius: 4, fontSize: 12, background: '#fff', color: INK }

  if (cargando) return <div style={{ padding: 40, textAlign: 'center', color: SLATE, fontSize: 13 }}>Cargando análisis…</div>
  if (err) return (
    <div style={{ padding: 16, background: ROJO + '10', border: `1px solid ${ROJO}40`, borderRadius: 4, color: ROJO, fontSize: 13 }}>
      No se pudo cargar el análisis: {err}
    </div>
  )

  return (
    <div className="inv-fade">
      {rebuildPend > 0 && (
        <div style={{
          background: AMBAR + '12', border: `1px solid ${AMBAR}40`, borderRadius: 4,
          padding: '7px 11px', marginBottom: 10, fontSize: 12, color: INK,
        }}>
          Reconstrucción del histórico en curso: quedan <b>{rebuildPend}</b> lotes.
          Las cifras de demanda y cobertura son provisionales hasta que termine.
        </div>
      )}

      {/* ── KPIs ── */}
      {k && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
          <Kpi label="Inventario en sala" valor={fmt(k.valorInventario)} sub={`${fN(k.skus)} SKU · ${fN(k.coberturaMedia)} d cobertura`} color={NAVY} />
          <Kpi label="Quiebre" valor={fN(k.pctQuiebre) + '%'} sub={`${k.quiebre} SKU sin stock hoy`} color={ROJO} alerta={k.pctQuiebre > 25} />
          <Kpi label="Venta perdida 84d" valor={fmt(k.ventaPerdida)} sub="estimada por días sin stock" color={ROJO} alerta={k.ventaPerdida > 0} />
          <Kpi label="Por reponer" valor={fN(k.critico + k.reponer)} sub={`${k.critico} críticos · ${fmt(k.inversionRequerida)}`} color={AMBAR} />
          <Kpi label="Exceso" valor={fmt(k.valorExceso)} sub={`${k.exceso} SKU sobre cobertura`} color="#1D4E89" />
          <Kpi label="Sin rotación" valor={fmt(k.valorMuerto)} sub={`${k.muerto} SKU inmovilizados`} color="#5B2C6F" />
          <Kpi label="Rotación anual" valor={(k.rotacion || 0).toFixed(2) + 'x'} sub="COGS 12m / inventario" color={VERDE} />
          <Kpi label="GMROI" valor={(k.gmroi || 0).toFixed(2)} sub="margen por peso invertido" color={k.gmroi >= 1 ? VERDE : ROJO} />
        </div>
      )}

      {/* ── Controles ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', border: `1px solid ${LINE}`, borderRadius: 4, overflow: 'hidden' }}>
          {VISTAS.map(v => (
            <button key={v.k} onClick={() => { setVista(v.k); setFCelda(null) }}
              style={{
                padding: '6px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 0,
                background: vista === v.k ? NAVY : '#fff', color: vista === v.k ? '#fff' : SLATE, font: 'inherit',
              }}>{v.l}</button>
          ))}
        </div>

        <select value={fSuc} onChange={e => setFSuc(e.target.value)} style={sel} disabled={!!scopeUsuario}>
          <option value="TODAS">Todas las salas</option>
          {SUCURSALES.filter(s => s.vende).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>

        {vista !== 'red' && (
          <select value={fEstado} onChange={e => setFEstado(e.target.value)} style={sel}>
            <option value="TODOS">Todos los estados</option>
            {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        )}

        <input value={fTexto} onChange={e => setFTexto(e.target.value)} placeholder="Buscar SKU o producto"
          style={{ ...sel, minWidth: 190, flex: '1 1 190px' }} />

        <span style={{ fontSize: 11.5, color: SLATE, marginLeft: 'auto' }}>
          {fN(filas.length)} filas · stock al {salud.stock_ultimo_snapshot || '—'}
        </span>
      </div>

      {vista === 'red' && (
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 4, padding: '11px 13px', marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 8 }}>
            Matriz ABC × XYZ — dónde está el margen y qué tan predecible es
          </div>
          <MatrizAbcXyz red={red} sel={fCelda} onSel={setFCelda} />
        </div>
      )}

      <Tabla cols={COLS[vista]} filas={filas} orden={orden} setOrden={setOrden} />

      <div style={{ fontSize: 11, color: SLATE, marginTop: 9, lineHeight: 1.5 }}>
        {vista === 'red' && 'Decisión de compra a nivel red: suma tiendas, CD y tránsito. Es la cifra que va a la orden de compra, no la de una sala aislada.'}
        {vista === 'tienda' && 'Decisión de reposición por sala. La demanda se mide sobre los días con stock disponible, para no castigar a los SKU que estuvieron quebrados.'}
        {vista === 'asignar' && 'Reparto del CD por déficit relativo de cobertura. Cuando el CD no alcanza para todas, se prorratea en vez de dejar a una sala completa y a otra en cero.'}
      </div>
    </div>
  )
}
