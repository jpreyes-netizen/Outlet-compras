import { useCallback, useEffect, useMemo, useState, Fragment } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../supabase'
import { DataGrid } from './DataGrid'
import { armarPlan, BuscadorSubcuenta } from './BuscadorCuenta'

/* ═══════════════════════════════════════════════════════════════════════
   ESTADO Y VÍNCULOS — Bancos › Libro y conciliación
   Tres vistas sobre los datos reales del ERP (nada vive aparte):
     · Libro banco por mes: clasificado / sin clasificar por cuenta madre ›
       subcuenta, con Santander, Global66, intereses de créditos y tarjetas.
       Cada celda abre sus movimientos y se pueden reclasificar ahí mismo.
     · Compras por proveedor: libro de compras 2026 por saldo, con lo pagado
       por banco, por transferencia masiva y por tarjeta. El libro espejo de
       cada proveedor (facturas | pagos) vincula facturas con pagos reales.
     · Revisar imputación: lo que está mal o incompleto, con su corrección.
   Backend: v_banco_estado_mes, v_cxp_proveedor, v_ap_facturas,
   v_pagos_disponibles, v_banco_revision, v_tef_detalle, fn_ev_vincular,
   fn_ev_desvincular. Vincular escribe en conciliaciones (banco directo y
   transferencias dentro de un cargo masivo, con tef_n_transaccion) y en
   conciliaciones_tc (tarjetas). El saldo de cada factura sale de
   v_estado_factura: banco + tarjeta, con tolerancia de redondeo de $10.
   ═══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', AZUL = '#1D4ED8', SUAVE = '#F7F8FA', SEL = '#E0E7FF'
const TOL = 10
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fF = f => (f ? String(f).slice(0, 10) : '')
const fRut = r => { const s = String(r || ''); return s.length > 1 ? `${s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${s.slice(-1)}` : s }
const rutGuion = r => { const s = String(r || ''); return s.length > 1 ? `${s.slice(0, -1)}-${s.slice(-1)}` : s }
const MES_L = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const mesLabel = m => { const [a, mm] = String(m).split('-'); return `${MES_L[Number(mm) - 1] ?? mm}-${String(a).slice(2)}` }
const mesSig = m => { const [a, mm] = String(m).split('-').map(Number); return mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, '0')}` }
const addDias = (f, d) => { const t = new Date(`${String(f).slice(0, 10)}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10) }
// La API entrega un máximo de filas por consulta (1.000 por defecto en Supabase). traerTodo pide
// páginas hasta que no quedan filas, avanzando por lo efectivamente recibido: sirve con cualquier
// tope y ninguna grilla queda cortada sin aviso. "armar" devuelve una consulta nueva, ordenada por
// una clave única.
async function traerTodo(armar, tope = 200000) {
  const out = []
  while (out.length < tope) {
    const { data, error } = await armar().range(out.length, out.length + 999)
    if (error) throw error
    if (!data?.length) break
    out.push(...data)
  }
  return out
}
const TIPO_DOC = c => (c === '61' ? 'NC' : c === '914' ? 'DIN' : c === '56' ? 'ND' : 'F')
const NUMS = { fontVariantNumeric: 'tabular-nums' }
const BTN = (activo, color = NAVY) => ({ fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${activo ? color : BORDE}`, background: activo ? color : '#fff', color: activo ? '#fff' : INK, whiteSpace: 'nowrap' })
const MINI = { fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 5, cursor: 'pointer', border: `1px solid ${BORDE}`, background: '#fff', color: INK, whiteSpace: 'nowrap' }
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff', color: INK }
const TH = { textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: SLATE, padding: '6px 8px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }
const TD = { fontSize: 12, padding: '5px 8px', borderBottom: '1px solid #F1F2F4', whiteSpace: 'nowrap', color: INK }
const NUM = { ...TD, textAlign: 'right', ...NUMS }
const CAJA = { background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8 }
const FUENTE_L = { banco: 'Banco', tef: 'Transf. masiva', tarjeta: 'Tarjeta' }
const ESTADO_F = { pagada: ['Pagada', VERDE], parcial: ['Parcial', AMBAR], sin_pagar: ['Por pagar', ROJO], compensada_nc: ['Compensada con NC', SLATE] }

function Kpi({ l, v, d, c, onClick, activo }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} style={{ textAlign: 'left', flex: '1 1 140px', minWidth: 130, ...CAJA, padding: '8px 10px', cursor: onClick ? 'pointer' : 'default', borderColor: activo ? NAVY : BORDE, font: 'inherit' }}>
      <div style={{ fontSize: 10.5, color: SLATE, fontWeight: 600 }}>{l}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: c ?? INK, ...NUMS, marginTop: 2 }}>{v}</div>
      {d && <div style={{ fontSize: 10.5, color: SLATE, marginTop: 1 }}>{d}</div>}
    </Tag>
  )
}

function gruposDelPlan(plan) {
  const porMadre = new Map()
  for (const s of plan.subs) {
    if (!s.activa) continue
    if (!porMadre.has(s.cuenta_madre_id)) porMadre.set(s.cuenta_madre_id, [])
    porMadre.get(s.cuenta_madre_id).push(s)
  }
  return plan.madres.filter(m => porMadre.has(m.id)).map(m => ({ m, subs: porMadre.get(m.id) }))
}

function SelectorSubcuenta({ grupos, value, onChange, disabled }) {
  return (
    <select value={value ?? ''} disabled={disabled} onChange={e => e.target.value && onChange(e.target.value)}
      style={{ ...INPUT, width: '100%', padding: '3px 6px', fontSize: 11.5 }}>
      <option value="">Elegir subcuenta…</option>
      {grupos.map(({ m, subs }) => (
        <optgroup key={m.id} label={`${m.codigo} · ${m.nombre}`}>
          {subs.map(s => <option key={s.id} value={s.id}>{s.codigo ?? 's/c'} · {s.nombre}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

async function clasificarMovimiento(movId, subId) {
  const { data: sess } = await supabase.auth.getSession()
  const { data, error } = await supabase.from('movimientos_bancarios')
    .update({ subcuenta_id: subId, estado: 'clasificado', clasificado_por: sess?.session?.user?.id ?? null, clasificado_at: new Date().toISOString(), clasif_origen: 'manual', clasif_ia: false })
    .eq('id', movId).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('No se guardó: sin permiso para modificar este movimiento')
}

const VISTAS = [['banco', 'Libro banco por mes'], ['compras', 'Compras por proveedor'], ['revision', 'Revisar imputación']]

export function EstadoVinculosTab({ cu }) {
  const [vista, setVista] = useState('banco')
  const [plan, setPlan] = useState({ subs: [], madres: [] })
  const [version, setVersion] = useState(0)                 // sube cuando una vista cambia datos que otra muestra
  const cambio = useCallback(() => setVersion(v => v + 1), [])

  useEffect(() => {
    let vivo = true
    Promise.all([
      supabase.from('subcuentas').select('id, codigo, nombre, activa, cuenta_madre_id').order('codigo'),
      supabase.from('cuentas_madre').select('id, codigo, nombre, tipo, activa, requiere_ceco').order('codigo'),
    ]).then(([s, m]) => {
      if (!vivo) return
      if (s.error || m.error) { toast.error((s.error || m.error).message); return }
      setPlan({ subs: s.data ?? [], madres: m.data ?? [] })
    })
    return () => { vivo = false }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: '#F3F4F6', borderRadius: 8, width: 'fit-content' }}>
        {VISTAS.map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)} style={{
            padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 6,
            background: vista === k ? '#fff' : 'transparent', color: vista === k ? NAVY : SLATE,
            boxShadow: vista === k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
          }}>{l}</button>
        ))}
      </div>
      {vista === 'banco' && <BancoPorMes plan={plan} version={version} onCambio={cambio} />}
      {vista === 'compras' && <ComprasPorProveedor version={version} onCambio={cambio} />}
      {vista === 'revision' && <RevisarImputacion plan={plan} cu={cu} version={version} onCambio={cambio} />}
    </div>
  )
}

/* ─────────────────────────── 1 · LIBRO BANCO POR MES ─────────────────────────── */
const FUENTES = [['santander', 'Santander'], ['global66', 'Global66'], ['creditos', 'Intereses de créditos'], ['tarjeta', 'Tarjetas de crédito']]

function BancoPorMes({ plan, version, onCambio }) {
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [fuentes, setFuentes] = useState(() => new Set(['santander', 'global66', 'creditos']))
  const [tipo, setTipo] = useState('CARGO')
  const [abiertas, setAbiertas] = useState(() => new Set(['SIN']))
  const [celda, setCelda] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      setFilas(await traerTodo(() => supabase.from('v_banco_estado_mes').select('*')
        .order('mes').order('fuente').order('tipo').order('subcuenta_id', { nullsFirst: true }).order('plan_cuenta', { nullsFirst: true })))
    } catch (e) { toast.error(e?.message ?? String(e)); setFilas([]) } finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar, version])

  const subMap = useMemo(() => new Map(plan.subs.map(s => [s.id, s])), [plan.subs])
  const madreMap = useMemo(() => new Map(plan.madres.map(m => [m.id, m])), [plan.madres])
  const grupos = useMemo(() => armarPlan(plan.subs, plan.madres, [], []), [plan])
  const meses = useMemo(() => [...new Set(filas.map(f => f.mes))].sort(), [filas])

  const { bloques, res } = useMemo(() => {
    const claveDe = f => f.subcuenta_id ? f.subcuenta_id : (f.fuente === 'tarjeta' && f.plan_cuenta && f.plan_cuenta !== '1810101' ? 'tc:' + f.plan_cuenta : 'SIN')
    const grupoDe = k => (k === 'SIN' ? 'SIN' : k.startsWith('tc:') ? 'TC' : (subMap.get(k)?.cuenta_madre_id ?? 'SIN'))
    const suma = (o, k, v) => { o[k] = (o[k] ?? 0) + v }
    const G = new Map()
    const R = { total: {}, clasif: {}, sin: {}, nSin: {}, porConc: {}, nPorConc: {}, nSinResp: {}, n: {} }
    for (const f of filas) {
      if (!fuentes.has(f.fuente) || f.tipo !== tipo) continue
      const k = claveDe(f), g = grupoDe(k), monto = Number(f.monto) || 0, n = Number(f.n) || 0
      if (!G.has(g)) G.set(g, { id: g, filas: new Map(), porMes: {}, total: 0, n: 0 })
      const grp = G.get(g)
      if (!grp.filas.has(k)) grp.filas.set(k, { id: k, porMes: {}, total: 0, n: 0, cuentasTc: new Set() })
      const fila = grp.filas.get(k)
      suma(fila.porMes, f.mes, monto); fila.total += monto; fila.n += n
      if (f.plan_cuenta) fila.cuentasTc.add(f.plan_cuenta)
      suma(grp.porMes, f.mes, monto); grp.total += monto; grp.n += n
      for (const mk of [f.mes, 'TOTAL']) {
        suma(R.total, mk, monto); suma(R.n, mk, n)
        if (k === 'SIN') { suma(R.sin, mk, monto); suma(R.nSin, mk, n) } else suma(R.clasif, mk, monto)
        suma(R.porConc, mk, Number(f.monto_por_conciliar) || 0); suma(R.nPorConc, mk, Number(f.n_por_conciliar) || 0)
        suma(R.nSinResp, mk, Number(f.n_sin_respaldo) || 0)
      }
    }
    const orden = g => (g === 'SIN' ? '000' : g === 'TC' ? 'zzz' : (madreMap.get(g)?.codigo ?? 'zz'))
    const cod = k => (k.startsWith('tc:') ? k : (subMap.get(k)?.codigo ?? '~' + (subMap.get(k)?.nombre ?? k)))
    const bloques = [...G.values()].sort((a, b) => orden(a.id).localeCompare(orden(b.id)))
    for (const b of bloques) b.lista = [...b.filas.values()].sort((x, y) => cod(x.id).localeCompare(cod(y.id)))
    return { bloques, res: R }
  }, [filas, fuentes, tipo, subMap, madreMap])

  const nombreGrupo = g => {
    if (g === 'SIN') return 'Sin clasificar'
    if (g === 'TC') return 'Tarjeta · cuenta contable sin subcuenta equivalente'
    const m = madreMap.get(g); return m ? `${m.codigo} · ${m.nombre}` : 'Cuenta madre desconocida'
  }
  const nombreFila = k => {
    if (k === 'SIN') return 'Sin subcuenta'
    if (k.startsWith('tc:')) return `Cuenta contable ${k.slice(3)}`
    const s = subMap.get(k); return s ? `${s.codigo ?? 's/c'} · ${s.nombre}` : 'Subcuenta desconocida'
  }
  const togFuente = k => { setFuentes(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n }); setCelda(null) }
  const togGrupo = g => setAbiertas(s => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n })
  const abrirFila = (f, mes) => setCelda({
    key: f.id, mes, etiqueta: `${nombreFila(f.id)} · ${mes ? mesLabel(mes) : 'todo el año'}`,
    sinSubcuenta: f.id === 'SIN', subIds: f.id !== 'SIN' && !f.id.startsWith('tc:') ? [f.id] : [],
    cuentasTc: [...f.cuentasTc], soloTarjeta: f.id.startsWith('tc:'),
  })
  const abrirGrupo = (g, mes) => setCelda({
    key: 'G:' + g.id, mes, etiqueta: `${nombreGrupo(g.id)} · ${mes ? mesLabel(mes) : 'todo el año'}`,
    sinSubcuenta: g.id === 'SIN', subIds: g.lista.filter(f => f.id !== 'SIN' && !f.id.startsWith('tc:')).map(f => f.id),
    cuentasTc: [...new Set(g.lista.flatMap(f => [...f.cuentasTc]))], soloTarjeta: g.id === 'TC',
  })

  const pct = m => (res.total[m] ? Math.round((1000 * (res.clasif[m] ?? 0)) / res.total[m]) / 10 : null)
  const FILAS_RES = [
    ['Total', m => fmt(res.total[m])],
    ['Clasificado', m => fmt(res.clasif[m])],
    ['Sin clasificar', m => (res.sin[m] ? `${fmt(res.sin[m])} · ${res.nSin[m]}` : '—'), m => (res.sin[m] ? AMBAR : SLATE)],
    ['% clasificado', m => (pct(m) == null ? '' : `${pct(m).toLocaleString('es-CL')}%`), m => (pct(m) === 100 ? VERDE : INK)],
    ['Pago de factura sin factura vinculada', m => (res.porConc[m] ? `${fmt(res.porConc[m])} · ${res.nPorConc[m]}` : '—'), m => (res.porConc[m] ? ROJO : SLATE)],
    ['Clasificados sin tipo de respaldo', m => (res.nSinResp[m] ? String(res.nSinResp[m]) : '—')],
    ['Movimientos', m => fmt(res.n[m])],
  ]
  const cols = [...meses, 'TOTAL']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ ...CAJA, padding: '8px 12px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: SLATE }}>Fuentes</span>
        {FUENTES.map(([k, l]) => (
          <label key={k} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={fuentes.has(k)} onChange={() => togFuente(k)} />{l}
          </label>
        ))}
        <span style={{ width: 1, height: 18, background: BORDE }} />
        {[['CARGO', 'Salidas (cargos)'], ['ABONO', 'Entradas (abonos)']].map(([k, l]) => (
          <button key={k} onClick={() => { setTipo(k); setCelda(null) }} style={{ ...BTN(tipo === k), borderRadius: 999 }}>{l}</button>
        ))}
        <span style={{ flex: 1 }} />
        {cargando && <span style={{ fontSize: 11.5, color: SLATE }}>Cargando…</span>}
        <button onClick={cargar} style={BTN(false)}>Actualizar</button>
      </div>
      {fuentes.has('tarjeta') && fuentes.has('santander') && tipo === 'CARGO' && (
        <div style={{ fontSize: 11.5, color: AMBAR }}>
          Con Santander y tarjetas juntos, el pago de la tarjeta desde el banco (825.01) y el detalle de la tarjeta son la misma plata: no los sumes como dos gastos.
        </div>
      )}

      <div style={{ ...CAJA, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>
            <th style={{ ...TH, minWidth: 240 }}>Resumen</th>
            {cols.map(m => <th key={m} style={{ ...TH, textAlign: 'right' }}>{m === 'TOTAL' ? 'Total' : mesLabel(m)}</th>)}
          </tr></thead>
          <tbody>
            {FILAS_RES.map(([l, f, color]) => (
              <tr key={l}>
                <td style={{ ...TD, fontWeight: 600 }}>{l}</td>
                {cols.map(m => <td key={m} style={{ ...NUM, color: color?.(m) ?? INK, fontWeight: m === 'TOTAL' ? 700 : 400 }}>{f(m)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...CAJA, overflow: 'auto', maxHeight: '62vh' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>
            <th style={{ ...TH, minWidth: 320 }}>Cuenta madre › subcuenta</th>
            {cols.map(m => <th key={m} style={{ ...TH, textAlign: 'right' }}>{m === 'TOTAL' ? 'Total' : mesLabel(m)}</th>)}
            <th style={{ ...TH, textAlign: 'right' }}>Mov.</th>
          </tr></thead>
          <tbody>
            {bloques.length === 0 && !cargando && <tr><td colSpan={cols.length + 2} style={{ ...TD, color: SLATE }}>Sin movimientos con estos filtros.</td></tr>}
            {bloques.map(g => {
              const abierto = abiertas.has(g.id), esSin = g.id === 'SIN'
              const valor = m => (m === 'TOTAL' ? g.total : g.porMes[m])
              return (
                <Fragment key={g.id}>
                  <tr style={{ background: esSin ? '#FFFBEB' : SUAVE }}>
                    <td style={{ ...TD, fontWeight: 700, cursor: 'pointer', color: esSin ? AMBAR : NAVY }} onClick={() => togGrupo(g.id)}>{abierto ? '▾' : '▸'} {nombreGrupo(g.id)}</td>
                    {cols.map(m => (
                      <td key={m} style={{ ...NUM, fontWeight: 700, cursor: valor(m) ? 'pointer' : 'default', outline: celda?.key === 'G:' + g.id && (celda?.mes ?? 'TOTAL') === m ? `2px solid ${NAVY}` : 'none' }}
                        onClick={() => valor(m) && abrirGrupo(g, m === 'TOTAL' ? null : m)}>{valor(m) ? fmt(valor(m)) : ''}</td>
                    ))}
                    <td style={{ ...NUM, color: SLATE }}>{fmt(g.n)}</td>
                  </tr>
                  {abierto && g.lista.map(f => {
                    const v = m => (m === 'TOTAL' ? f.total : f.porMes[m])
                    return (
                      <tr key={f.id}>
                        <td style={{ ...TD, paddingLeft: 26 }}>{nombreFila(f.id)}</td>
                        {cols.map(m => (
                          <td key={m} style={{ ...NUM, cursor: v(m) ? 'pointer' : 'default', fontWeight: m === 'TOTAL' ? 700 : 400, outline: celda?.key === f.id && (celda?.mes ?? 'TOTAL') === m ? `2px solid ${NAVY}` : 'none' }}
                            onClick={() => v(m) && abrirFila(f, m === 'TOTAL' ? null : m)}>{v(m) ? fmt(v(m)) : ''}</td>
                        ))}
                        <td style={{ ...NUM, color: SLATE }}>{fmt(f.n)}</td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10.5, color: SLATE }}>
        Clic en una cuenta madre para abrir sus subcuentas; clic en un monto para ver sus movimientos. Las tarjetas se clasifican con su cuenta contable y se muestran en la subcuenta equivalente. Solo pesos chilenos (las líneas de tarjeta en dólares no se suman).
      </div>

      {celda && <DetalleCelda key={`${celda.key}|${celda.mes}|${tipo}|${[...fuentes].join(',')}`} celda={celda} fuentes={fuentes} tipo={tipo}
        subMap={subMap} grupos={grupos} onCerrar={() => setCelda(null)} onCambio={() => { cargar(); onCambio?.() }} />}
    </div>
  )
}

function DetalleCelda({ celda, fuentes, tipo, subMap, grupos, onCerrar, onCambio }) {
  const [rows, setRows] = useState([])
  const [cargando, setCargando] = useState(true)
  const [editId, setEditId] = useState(null)
  const [guardando, setGuardando] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const out = []
      const desde = celda.mes ? `${celda.mes}-01` : '2026-01-01'
      const hasta = celda.mes ? `${mesSig(celda.mes)}-01` : '2100-01-01'
      const ors = []
      if (fuentes.has('santander')) ors.push('origen.is.null', 'origen.in.(banco,cartola_pdf)')
      if (fuentes.has('global66')) ors.push('origen.eq.global66_sync')
      if (fuentes.has('creditos')) ors.push('origen.eq.credito_sync')
      const conFiltro = celda.sinSubcuenta || celda.subIds?.length > 0
      if (ors.length && !celda.soloTarjeta && conFiltro) {
        const data = await traerTodo(() => {
          const q = supabase.from('movimientos_bancarios')
            .select('id, fecha, tipo, monto, descripcion, subcuenta_id, tipo_respaldo, origen, conciliaciones(monto_aplicado)')
            .gte('fecha', desde).lt('fecha', hasta).eq('tipo', tipo).or(ors.join(',')).order('fecha', { ascending: false }).order('id')
          return celda.sinSubcuenta ? q.is('subcuenta_id', null) : q.in('subcuenta_id', celda.subIds)
        })
        for (const r of data) out.push({
          ...r, _k: 'b' + r.id,
          fuente: r.origen === 'global66_sync' ? 'Global66' : r.origen === 'credito_sync' ? 'Créditos' : 'Santander',
          aplicado: (r.conciliaciones ?? []).reduce((s, c) => s + (Number(c.monto_aplicado) || 0), 0),
        })
      }
      if (fuentes.has('tarjeta') && celda.cuentasTc?.length) {
        const data = await traerTodo(() => {
          let q = supabase.from('v_tc_clasificado').select('id, tarjeta, fecha_op, descripcion, monto, cuenta, origen, factura, periodo, moneda')
            .eq('moneda', 'CLP').in('cuenta', celda.cuentasTc).order('fecha_op', { ascending: false }).order('id')
          if (celda.mes) q = q.eq('periodo', celda.mes)
          return tipo === 'CARGO' ? q.gte('monto', 0) : q.lt('monto', 0)
        })
        for (const r of data) out.push({
          id: r.id, _k: 't' + r.id, fecha: r.fecha_op, descripcion: `${r.tarjeta} · ${r.descripcion}`, monto: r.monto,
          fuente: 'Tarjeta', cuenta: r.cuenta, origenTc: r.origen, factura: r.factura, esTarjeta: true,
        })
      }
      out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
      setRows(out)
    } catch (e) { toast.error(e?.message ?? String(e)); setRows([]) } finally { setCargando(false) }
  }, [celda, fuentes, tipo])
  useEffect(() => { cargar() }, [cargar])

  async function reclasificar(r, subId) {
    setGuardando(r.id)
    try { await clasificarMovimiento(r.id, subId); toast.success('Movimiento reclasificado'); setEditId(null); await cargar(); onCambio?.() }
    catch (e) { toast.error(e?.message ?? String(e)) } finally { setGuardando(null) }
  }
  const etiquetaSub = r => { const s = subMap.get(r.subcuenta_id); return s ? `${s.codigo ?? 's/c'} · ${s.nombre}` : 'Sin subcuenta' }
  const total = rows.reduce((s, r) => s + Math.abs(Number(r.monto) || 0), 0)

  const cols = [
    { key: 'fecha', label: 'Fecha', width: 86, value: r => fF(r.fecha) },
    { key: 'fuente', label: 'Fuente', width: 84 },
    { key: 'descripcion', label: 'Descripción', width: 330 },
    { key: 'monto', label: 'Monto', align: 'right', width: 110, value: r => Math.abs(Number(r.monto) || 0), render: r => <b style={NUMS}>{fmt(Math.abs(r.monto))}</b> },
    { key: 'aplicado', label: 'Con factura', align: 'right', width: 100, value: r => r.aplicado ?? 0, render: r => (r.aplicado ? <span style={NUMS}>{fmt(r.aplicado)}</span> : '') },
    { key: 'respaldo', label: 'Respaldo', width: 120, value: r => (r.esTarjeta ? (r.origenTc ?? '') : (r.tipo_respaldo ?? '')) },
    {
      key: 'subcuenta', label: 'Subcuenta', width: 360, value: r => (r.esTarjeta ? `Cuenta ${r.cuenta}` : etiquetaSub(r)),
      render: r => (r.esTarjeta
        ? <span style={{ color: SLATE }}>Cuenta {r.cuenta}{r.factura ? ` · ${r.factura}` : ''} · se cambia en Tarjetas de crédito</span>
        : editId === r.id
          ? <BuscadorSubcuenta plan={grupos} value={r.subcuenta_id} disabled={guardando === r.id} autoFocus tipoMov={r.tipo} onChange={v => v && reclasificar(r, v)} />
          : <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: r.subcuenta_id ? INK : AMBAR, overflow: 'hidden', textOverflow: 'ellipsis' }}>{etiquetaSub(r)}</span>
              <button onClick={() => setEditId(r.id)} style={MINI}>Cambiar</button>
            </span>),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <b style={{ fontSize: 13, color: NAVY }}>{celda.etiqueta}</b>
        <span style={{ fontSize: 12, color: SLATE }}>{rows.length} movimientos · <b style={{ color: INK, ...NUMS }}>{fmt(total)}</b></span>
        <span style={{ flex: 1 }} />
        <button onClick={onCerrar} style={BTN(false)}>Cerrar detalle</button>
      </div>
      <DataGrid title={celda.etiqueta} exportName={`libro_banco_${celda.mes ?? '2026'}`} columns={cols} rows={rows} getRowId={r => r._k}
        loading={cargando} emptyText="Sin movimientos en esta celda" />
    </div>
  )
}

/* ─────────────────────────── 2 · COMPRAS POR PROVEEDOR ─────────────────────────── */
const CHIPS_P = [['saldo', 'Con saldo'], ['calce', 'Con calce posible'], ['sin_factura', 'Pagos sin factura'], ['todos', 'Todos']]

function ComprasPorProveedor({ version, onCambio }) {
  const [provs, setProvs] = useState([])
  const [cargando, setCargando] = useState(true)
  const [chip, setChip] = useState('saldo')
  const [texto, setTexto] = useState('')
  const [sel, setSel] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try { setProvs(await traerTodo(() => supabase.from('v_cxp_proveedor').select('*').order('saldo', { ascending: false }).order('rut'))) }
    catch (e) { toast.error(e?.message ?? String(e)); setProvs([]) } finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar, version])

  const k = useMemo(() => {
    const s = { facturado: 0, nc: 0, banco: 0, tef: 0, tc: 0, saldo: 0, calce: 0, nSaldo: 0, nCalce: 0, sinFac: 0, nSinFac: 0 }
    for (const p of provs) {
      if (p.tiene_facturas) {
        s.facturado += +p.facturado; s.nc += +p.nc; s.banco += +p.pagado_banco; s.tef += +p.pagado_tef; s.tc += +p.pagado_tc
        s.saldo += +p.saldo; s.calce += +p.calce_posible
        if (+p.saldo > TOL) s.nSaldo++
        if (+p.calce_posible > TOL) s.nCalce++
      } else { s.sinFac += +p.disponible; s.nSinFac++ }
    }
    return s
  }, [provs])

  const visibles = useMemo(() => {
    let out = provs
    if (chip === 'saldo') out = out.filter(p => p.tiene_facturas && +p.saldo > TOL)
    else if (chip === 'calce') out = out.filter(p => +p.calce_posible > TOL).sort((a, b) => b.calce_posible - a.calce_posible)
    else if (chip === 'sin_factura') out = out.filter(p => !p.tiene_facturas).sort((a, b) => b.disponible - a.disponible)
    const t = texto.trim().toLowerCase()
    if (t) {
      const tr = t.replace(/[.\-\s]/g, '')
      out = out.filter(p => (p.razon_social ?? '').toLowerCase().includes(t) || (tr && String(p.rut ?? '').toLowerCase().includes(tr)))
    }
    return out
  }, [provs, chip, texto])

  const cols = useMemo(() => [
    { key: 'rut', label: 'RUT', width: 104, value: r => fRut(r.rut) },
    { key: 'razon_social', label: 'Proveedor', width: 260 },
    { key: 'n_fact', label: 'Docs', align: 'right', width: 56 },
    { key: 'facturado', label: 'Facturado', align: 'right', width: 112, value: r => +r.facturado, render: r => <span style={NUMS}>{fmt(r.facturado)}</span> },
    { key: 'nc', label: 'NC', align: 'right', width: 96, value: r => +r.nc, render: r => (+r.nc ? <span style={NUMS}>{fmt(r.nc)}</span> : '') },
    { key: 'pagado_banco', label: 'Pagado banco', align: 'right', width: 112, value: r => +r.pagado_banco, render: r => (+r.pagado_banco ? <span style={NUMS}>{fmt(r.pagado_banco)}</span> : '') },
    { key: 'pagado_tef', label: 'Pagado en masivo', align: 'right', width: 112, value: r => +r.pagado_tef, render: r => (+r.pagado_tef ? <span style={NUMS}>{fmt(r.pagado_tef)}</span> : '') },
    { key: 'pagado_tc', label: 'Pagado tarjeta', align: 'right', width: 104, value: r => +r.pagado_tc, render: r => (+r.pagado_tc ? <span style={NUMS}>{fmt(r.pagado_tc)}</span> : '') },
    { key: 'saldo', label: 'Saldo', align: 'right', width: 112, value: r => +r.saldo, render: r => (+r.saldo > TOL ? <b style={{ color: ROJO, ...NUMS }}>{fmt(r.saldo)}</b> : r.tiene_facturas ? <span style={{ color: VERDE }}>0</span> : '') },
    { key: 'n_abiertas', label: 'Abiertas', align: 'right', width: 66 },
    { key: 'abierta_desde', label: 'Abierta desde', width: 94, value: r => fF(r.abierta_desde) },
    { key: 'disponible', label: 'Pagos sin factura', align: 'right', width: 118, value: r => +r.disponible, render: r => (+r.disponible > TOL ? <span style={{ color: AMBAR, ...NUMS }}>{fmt(r.disponible)}</span> : '') },
    { key: 'calce_posible', label: 'Calce posible', align: 'right', width: 108, value: r => +r.calce_posible, render: r => (+r.calce_posible > TOL ? <b style={{ color: AZUL, ...NUMS }}>{fmt(r.calce_posible)}</b> : '') },
    { key: 'ult_pago', label: 'Último pago libre', width: 104, value: r => fF(r.ult_pago) },
  ], [])

  if (sel) {
    const i = visibles.findIndex(p => p.rut === sel.rut)
    const siguiente = i >= 0 ? visibles.slice(i + 1).find(p => +p.saldo > TOL || +p.disponible > TOL) : null
    return <ProveedorDetalle key={sel.rut} prov={sel} onVolver={() => setSel(null)} onSiguiente={siguiente ? () => setSel(siguiente) : null}
      onCambio={() => { cargar(); onCambio?.() }} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Kpi l="Facturado 2026" v={fmt(k.facturado)} d={`NC ${fmt(k.nc)}`} />
        <Kpi l="Pagado por banco" v={fmt(k.banco)} />
        <Kpi l="Pagado en transferencias masivas" v={fmt(k.tef)} />
        <Kpi l="Pagado con tarjeta" v={fmt(k.tc)} />
        <Kpi l="Saldo por pagar" v={fmt(k.saldo)} c={ROJO} d={`${k.nSaldo} proveedores`} onClick={() => setChip('saldo')} activo={chip === 'saldo'} />
        <Kpi l="Calce posible" v={fmt(k.calce)} c={AZUL} d={`${k.nCalce} proveedores con pagos sin factura`} onClick={() => setChip('calce')} activo={chip === 'calce'} />
        <Kpi l="Pagos a RUT sin facturas" v={fmt(k.sinFac)} c={AMBAR} d={`${k.nSinFac} RUT`} onClick={() => setChip('sin_factura')} activo={chip === 'sin_factura'} />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {CHIPS_P.map(([c, l]) => <button key={c} onClick={() => setChip(c)} style={{ ...BTN(chip === c), borderRadius: 999 }}>{l}</button>)}
        <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar proveedor o RUT…" style={{ ...INPUT, minWidth: 260, flex: '0 1 340px' }} />
      </div>
      <DataGrid title={`Libro de compras 2026 por proveedor · ${visibles.length}`} exportName="compras_por_proveedor_2026" columns={cols} rows={visibles}
        getRowId={r => r.rut} loading={cargando} onRowClick={r => setSel(r)} emptyText="Nada que mostrar con estos filtros" />
      <div style={{ fontSize: 10.5, color: SLATE }}>
        Saldo = facturado − notas de crédito − pagado (banco, transferencias masivas y tarjeta), con tolerancia de redondeo de $10. "Pagos sin factura" son pagos al mismo RUT que aún no tienen factura vinculada; el calce posible es el menor entre eso y el saldo. Clic en un proveedor para vincular.
      </div>
    </div>
  )
}

const STOP = new Set(['SPA', 'SA', 'LTDA', 'LIMITADA', 'EIRL', 'EMPRESA', 'INDIVIDUAL', 'RESPONSABILIDAD', 'COMERCIAL', 'COMERCIALIZADORA', 'IMPORTADORA', 'SOCIEDAD',
  'INVERSIONES', 'SERVICIOS', 'DISTRIBUIDORA', 'CONSTRUCTORA', 'TRANSPORTES', 'CHILE', 'GRUPO', 'COMPANIA', 'RETAIL', 'INDUSTRIAL', 'INGENIERIA'])
const tokenNombre = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ')
  .split(/\s+/).find(w => w.length >= 4 && !STOP.has(w)) ?? ''

export function ProveedorDetalle({ prov, onVolver, onSiguiente, onCambio }) {
  const [docs, setDocs] = useState([])
  const [pagos, setPagos] = useState([])
  const [extra, setExtra] = useState([])
  const [cargando, setCargando] = useState(true)
  const [selF, setSelF] = useState(() => new Set())
  const [selP, setSelP] = useState(() => new Map())
  const [verAplicados, setVerAplicados] = useState(false)
  const [abiertos, setAbiertos] = useState(() => new Set())
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const token = useMemo(() => tokenNombre(prov.razon_social), [prov.razon_social])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [dData, pData, t] = await Promise.all([
        traerTodo(() => supabase.from('v_ap_facturas').select('*').eq('rut', prov.rut).order('fecha_emision', { ascending: false }).order('id')),
        traerTodo(() => supabase.from('v_pagos_disponibles').select('*').eq('rut_proveedor', prov.rut).eq('es_pago_final', true).order('fecha', { ascending: false }).order('pago_id')),
        token
          ? supabase.from('v_pagos_disponibles').select('*').eq('fuente', 'tarjeta').gt('disponible', TOL).ilike('glosa', `%${token}%`).order('fecha', { ascending: false }).limit(60)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (t.error) throw t.error
      setDocs(dData)
      const propios = pData.map(x => ({ ...x, lista: 'Mismo RUT' }))
      const ids = new Set(propios.map(x => x.pago_id))
      setPagos([...propios, ...(t.data ?? []).filter(x => !ids.has(x.pago_id)).map(x => ({ ...x, lista: `Tarjeta: "${token}" en la glosa` }))])
    } catch (e) { toast.error(e?.message ?? String(e)) } finally { setCargando(false) }
  }, [prov.rut, token])
  useEffect(() => { cargar() }, [cargar])

  async function buscar() {
    const t = busca.trim()
    if (!t) { setExtra([]); return }
    let q = supabase.from('v_pagos_disponibles').select('*').eq('es_pago_final', true).gt('disponible', TOL).order('fecha', { ascending: false }).limit(80)
    const num = Number(t.replace(/\./g, '').replace(',', '.'))
    if (/^[\d.,\s]+$/.test(t) && num > 0) q = q.gte('monto', num - TOL).lte('monto', num + TOL)
    else { const s = t.replace(/["%,()]/g, ' ').trim(); q = q.or(`glosa.ilike."%${s}%",nombre.ilike."%${s}%",motivo.ilike."%${s}%"`) }
    const { data, error } = await q
    if (error) { toast.error(error.message); return }
    const ids = new Set(pagos.map(x => x.pago_id))
    const res = (data ?? []).filter(x => !ids.has(x.pago_id)).map(x => ({ ...x, lista: 'Búsqueda' }))
    setExtra(res)
    if (!res.length) toast('Sin pagos disponibles que coincidan')
  }

  const facturas = useMemo(() => docs.filter(d => d.codigo_sii !== '61'), [docs])
  const listaPagos = useMemo(() => [...pagos, ...extra].filter(p => verAplicados || Number(p.disponible) > TOL), [pagos, extra, verAplicados])
  const propiosLibres = useMemo(() => pagos.filter(p => p.lista === 'Mismo RUT' && Number(p.disponible) > TOL), [pagos])

  // Calces exactos: de la factura más reciente con el pago más reciente hacia lo más antiguo
  const sugerencias = useMemo(() => {
    const abiertas = facturas.filter(d => Number(d.saldo) > TOL).sort((a, b) => String(b.fecha_emision).localeCompare(String(a.fecha_emision)))
    const libres = [...propiosLibres].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    const usados = new Set(), conSug = new Set(), out = []
    for (const d of abiertas) {
      const p = libres.find(x => !usados.has(x.pago_id) && x.folio_motivo && String(x.folio_motivo) === String(d.folio) && Number(x.disponible) <= Number(d.saldo) + TOL)
      if (p) { usados.add(p.pago_id); conSug.add(d.id); out.push({ d, p, monto: Math.min(+p.disponible, +d.saldo), razon: `La transferencia dice "${p.motivo}"` }) }
    }
    for (const d of abiertas) {
      if (conSug.has(d.id)) continue
      const p = libres.find(x => !usados.has(x.pago_id) && Math.abs(Number(x.disponible) - Number(d.saldo)) <= TOL && String(x.fecha) >= addDias(d.fecha_emision, -3))
      if (p) { usados.add(p.pago_id); conSug.add(d.id); out.push({ d, p, monto: Math.min(+p.disponible, +d.saldo), razon: 'Mismo RUT y monto exacto' }) }
    }
    return out
  }, [facturas, propiosLibres])

  const tot = useMemo(() => ({
    facturado: facturas.reduce((s, d) => s + Number(d.monto_total || 0), 0),
    nc: docs.filter(d => d.codigo_sii === '61').reduce((s, d) => s + Number(d.monto_total || 0), 0),
    pagado: facturas.reduce((s, d) => s + Number(d.total_pagado || 0), 0),
    saldo: facturas.reduce((s, d) => s + Number(d.saldo || 0), 0),
    libre: propiosLibres.reduce((s, p) => s + Number(p.disponible || 0), 0),
  }), [docs, facturas, propiosLibres])

  const totF = facturas.filter(d => selF.has(d.id)).reduce((s, d) => s + Number(d.saldo || 0), 0)
  const totP = [...selP.values()].reduce((s, p) => s + Number(p.disponible || 0), 0)
  const dif = totP - totF

  const togF = id => setSelF(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const togP = p => setSelP(s => { const n = new Map(s); n.has(p.pago_id) ? n.delete(p.pago_id) : n.set(p.pago_id, p); return n })
  const togAbierto = id => setAbiertos(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const itemDe = (p, f, monto, nota) => ({ fuente: p.fuente, mov_id: p.mov_id ?? null, tef_n: p.tef_n ?? null, tc_id: p.tc_id ?? null, factura_id: f.id, monto: Math.round(monto), nota: nota ?? null })

  async function guardar(items, titulo) {
    if (!items.length) return
    setOcupado(true)
    try {
      const { data, error } = await supabase.rpc('fn_ev_vincular', { p_items: items })
      if (error) throw error
      const n = data?.vinculos ?? items.length, c = data?.clasificados ?? 0
      toast.success(`${titulo}: ${n} vínculo${n === 1 ? '' : 's'}${c ? ` · ${c} movimiento${c === 1 ? '' : 's'} quedó con la subcuenta habitual del proveedor` : ''}`)
      setSelF(new Set()); setSelP(new Map()); setExtra([])
      await cargar(); onCambio?.()
    } catch (e) { toast.error(e?.message ?? String(e)) } finally { setOcupado(false) }
  }
  function vincularSeleccion() {
    const F = facturas.filter(d => selF.has(d.id)).sort((a, b) => String(b.fecha_emision).localeCompare(String(a.fecha_emision))).map(f => ({ f, resto: Number(f.saldo) }))
    const P = [...selP.values()].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map(p => ({ p, resto: Number(p.disponible) }))
    const items = []
    let i = 0, j = 0
    while (i < F.length && j < P.length) {
      const m = Math.min(F[i].resto, P[j].resto)
      if (m >= 1) items.push(itemDe(P[j].p, F[i].f, m))
      F[i].resto -= m; P[j].resto -= m
      if (F[i].resto <= TOL) i++
      if (P[j].resto <= TOL) j++
    }
    if (!items.length) { toast.error('Marca al menos una factura con saldo y un pago con disponible'); return }
    guardar(items, 'Vinculado')
  }
  async function quitar(pg) {
    if (!pg.id) { toast.error('Es un calce automático de tarjeta sin registro propio: se corrige en Bancos › Tarjetas de crédito'); return }
    setOcupado(true)
    try {
      const { error } = await supabase.rpc('fn_ev_desvincular', { p_fuente: pg.fuente, p_id: pg.id })
      if (error) throw error
      toast.success('Vínculo quitado'); await cargar(); onCambio?.()
    } catch (e) { toast.error(e?.message ?? String(e)) } finally { setOcupado(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ ...CAJA, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={onVolver} style={BTN(false)}>← Proveedores</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: NAVY }}>{prov.razon_social}</div>
          <div style={{ fontSize: 11, color: SLATE }}>RUT {fRut(prov.rut)}{prov.n_din ? ` · ${prov.n_din} DIN` : ''}</div>
        </div>
        <span style={{ flex: 1 }} />
        {cargando && <span style={{ fontSize: 11.5, color: SLATE }}>Cargando…</span>}
        {onSiguiente && <button onClick={onSiguiente} style={BTN(false)}>Siguiente →</button>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Kpi l="Facturado 2026" v={fmt(tot.facturado)} d={tot.nc ? `NC ${fmt(tot.nc)}` : null} />
        <Kpi l="Pagado" v={fmt(tot.pagado)} />
        <Kpi l="Saldo" v={fmt(tot.saldo)} c={tot.saldo > TOL ? ROJO : VERDE} />
        <Kpi l="Pagos del RUT sin factura" v={fmt(tot.libre)} c={tot.libre > TOL ? AMBAR : INK} />
      </div>

      {sugerencias.length > 0 && (
        <div style={{ ...CAJA, padding: 10, borderLeft: `3px solid ${AZUL}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <b style={{ fontSize: 12.5, color: NAVY, flex: 1 }}>{sugerencias.length === 1 ? '1 calce exacto sugerido' : `${sugerencias.length} calces exactos sugeridos`}</b>
            <button disabled={ocupado} onClick={() => guardar(sugerencias.map(s => itemDe(s.p, s.d, s.monto, s.razon)), 'Calces exactos')} style={BTN(true, VERDE)}>
              Vincular {sugerencias.length === 1 ? 'el calce' : `los ${sugerencias.length}`}
            </button>
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {sugerencias.map(s => (
                <tr key={s.d.id + s.p.pago_id}>
                  <td style={TD}><b>{TIPO_DOC(s.d.codigo_sii)} {s.d.folio}</b> · {fF(s.d.fecha_emision)}</td>
                  <td style={NUM}>{fmt(s.d.saldo)}</td>
                  <td style={{ ...TD, color: SLATE }}>←</td>
                  <td style={TD}>{fF(s.p.fecha)} · {FUENTE_L[s.p.fuente]}</td>
                  <td style={{ ...TD, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.p.glosa}>{s.p.nombre}</td>
                  <td style={NUM}>{fmt(s.p.disponible)}</td>
                  <td style={{ ...TD, color: SLATE }}>{s.razon}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)', gap: 10, alignItems: 'start' }}>
        <div style={{ ...CAJA, overflow: 'auto', maxHeight: '60vh' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>
              <th style={TH} /><th style={TH}>Documento</th><th style={TH}>Emisión</th><th style={{ ...TH, textAlign: 'right' }}>Total</th>
              <th style={{ ...TH, textAlign: 'right' }}>NC aplicada</th><th style={{ ...TH, textAlign: 'right' }}>Pagado</th>
              <th style={{ ...TH, textAlign: 'right' }}>Saldo</th><th style={TH}>Estado</th><th style={TH}>Pagos</th>
            </tr></thead>
            <tbody>
              {docs.length === 0 && !cargando && <tr><td colSpan={9} style={{ ...TD, color: SLATE }}>Este RUT no tiene documentos en el libro de compras 2026.</td></tr>}
              {docs.map(d => {
                const esNC = d.codigo_sii === '61', puede = !esNC && Number(d.saldo) > TOL, n = d.pagos?.length ?? 0
                const [el, ec] = esNC ? ['Nota de crédito', SLATE] : (ESTADO_F[d.estado_factura] ?? [d.estado_factura ?? '', SLATE])
                return (
                  <Fragment key={d.id}>
                    <tr style={{ background: selF.has(d.id) ? SEL : esNC ? SUAVE : null }}>
                      <td style={TD}>{puede && <input type="checkbox" aria-label={`Marcar ${TIPO_DOC(d.codigo_sii)} ${d.folio}`} checked={selF.has(d.id)} onChange={() => togF(d.id)} />}</td>
                      <td style={TD}><b>{TIPO_DOC(d.codigo_sii)} {d.folio}</b></td>
                      <td style={TD}>{fF(d.fecha_emision)}</td>
                      <td style={NUM}>{esNC ? '−' : ''}{fmt(d.monto_total)}</td>
                      <td style={NUM}>{+d.nc_aplicada ? fmt(d.nc_aplicada) : ''}</td>
                      <td style={NUM}>{+d.total_pagado ? fmt(d.total_pagado) : ''}</td>
                      <td style={{ ...NUM, fontWeight: 700, color: esNC ? SLATE : +d.saldo > TOL ? ROJO : VERDE }}>{esNC ? '' : fmt(d.saldo)}</td>
                      <td style={{ ...TD, color: ec, fontWeight: 600, fontSize: 11 }}>{el}</td>
                      <td style={TD}>{n > 0 && <button onClick={() => togAbierto(d.id)} style={MINI}>{abiertos.has(d.id) ? '▾' : '▸'} {n}</button>}</td>
                    </tr>
                    {abiertos.has(d.id) && (d.pagos ?? []).map((pg, ix) => (
                      <tr key={`${d.id}-${pg.id ?? ix}`} style={{ background: SUAVE }}>
                        <td style={TD} />
                        <td colSpan={7} style={{ ...TD, color: SLATE, whiteSpace: 'normal' }}>
                          {FUENTE_L[pg.fuente] ?? pg.fuente} · {fF(pg.fecha)} · {pg.glosa} · <b style={{ color: INK, ...NUMS }}>{fmt(pg.monto)}</b>{pg.origen ? ` · ${pg.origen}` : ''}
                        </td>
                        <td style={TD}><button disabled={ocupado} onClick={() => quitar(pg)} style={{ ...MINI, color: ROJO }}>Quitar</button></td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscar()}
              placeholder="Buscar pago en todo el banco y tarjetas: monto, glosa o nombre" style={{ ...INPUT, flex: 1, minWidth: 220 }} />
            <button onClick={buscar} style={BTN(false)}>Buscar pago</button>
            <label style={{ fontSize: 11.5, color: SLATE, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={verAplicados} onChange={e => setVerAplicados(e.target.checked)} /> ver ya aplicados
            </label>
          </div>
          <div style={{ ...CAJA, overflow: 'auto', maxHeight: '56vh' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                <th style={TH} /><th style={TH}>Fecha</th><th style={TH}>Fuente</th><th style={TH}>Pago</th>
                <th style={{ ...TH, textAlign: 'right' }}>Monto</th><th style={{ ...TH, textAlign: 'right' }}>Aplicado</th>
                <th style={{ ...TH, textAlign: 'right' }}>Disponible</th><th style={TH}>De dónde</th>
              </tr></thead>
              <tbody>
                {listaPagos.length === 0 && !cargando && <tr><td colSpan={8} style={{ ...TD, color: SLATE, whiteSpace: 'normal' }}>No hay pagos disponibles de este RUT. Usa "Buscar pago" para traer uno de otro RUT, sin RUT o con tarjeta.</td></tr>}
                {listaPagos.map(p => {
                  const libre = Number(p.disponible) > TOL
                  return (
                    <tr key={p.pago_id} style={{ background: selP.has(p.pago_id) ? SEL : null, opacity: libre ? 1 : 0.55 }}>
                      <td style={TD}>{libre && <input type="checkbox" aria-label={`Marcar pago ${fF(p.fecha)} ${fmt(p.disponible)}`} checked={selP.has(p.pago_id)} onChange={() => togP(p)} />}</td>
                      <td style={TD}>{fF(p.fecha)}</td>
                      <td style={{ ...TD, fontSize: 11, fontWeight: 600, color: p.fuente === 'tarjeta' ? AZUL : p.fuente === 'tef' ? NAVY : INK }}>{FUENTE_L[p.fuente] ?? p.fuente}</td>
                      <td style={{ ...TD, whiteSpace: 'normal', minWidth: 220 }}>
                        <div>{p.nombre}{p.rut_proveedor && p.rut_proveedor !== prov.rut ? <span style={{ color: AMBAR }}> · RUT {fRut(p.rut_proveedor)}</span> : null}</div>
                        <div style={{ fontSize: 10.5, color: SLATE }}>{p.fuente === 'tef' ? `dentro de "${p.glosa}"` : p.glosa}{p.motivo ? ` · ${p.motivo}` : ''}</div>
                      </td>
                      <td style={NUM}>{fmt(p.monto)}</td>
                      <td style={NUM}>{+p.aplicado ? fmt(p.aplicado) : ''}</td>
                      <td style={{ ...NUM, fontWeight: 700, color: libre ? AMBAR : SLATE }}>{fmt(p.disponible)}</td>
                      <td style={{ ...TD, fontSize: 10.5, color: SLATE }}>{p.lista}{p.en_alcance === false ? ' · clasificado fuera de compras' : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, ...CAJA, padding: '8px 12px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}>
        <span style={{ fontSize: 12 }}>Facturas marcadas <b>{selF.size}</b> · saldo <b style={NUMS}>{fmt(totF)}</b></span>
        <span style={{ fontSize: 12 }}>Pagos marcados <b>{selP.size}</b> · disponible <b style={NUMS}>{fmt(totP)}</b></span>
        {selF.size > 0 && selP.size > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: Math.abs(dif) <= TOL ? VERDE : AMBAR }}>
            {Math.abs(dif) <= TOL ? 'Calza al peso' : dif > 0 ? `Sobran ${fmt(dif)} del pago` : `Faltan ${fmt(-dif)} para saldar`}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={() => { setSelF(new Set()); setSelP(new Map()) }} style={BTN(false)}>Limpiar</button>
        <button disabled={ocupado || !selF.size || !selP.size} onClick={vincularSeleccion} style={BTN(true)}>Vincular selección</button>
      </div>
      <div style={{ fontSize: 10.5, color: SLATE }}>
        Vincular reparte los pagos marcados entre las facturas marcadas, de la más reciente a la más antigua. Si el pago es del banco y no tiene subcuenta, toma la habitual del proveedor. Una transferencia que viene dentro de un cargo masivo queda vinculada a ese cargo con su número de transacción.
      </div>
    </div>
  )
}

/* ─────────────────────────── 3 · REVISAR IMPUTACIÓN ─────────────────────────── */
const PROBLEMAS = {
  vinculo_sin_subcuenta: { l: 'Con factura y sin subcuenta', c: ROJO },
  sobreaplicado: { l: 'Vinculado de más', c: ROJO },
  respaldo_incoherente: { l: 'Respaldo que no corresponde', c: AMBAR },
  rut_distinto: { l: 'Factura de otro RUT', c: AMBAR },
  masivo_sin_vincular: { l: 'Masivo sin facturas', c: AMBAR },
  subcuenta_no_habitual: { l: 'Subcuenta no habitual', c: AZUL },
  signo: { l: 'Entrada o salida en cuenta contraria', c: SLATE },
  tef_sin_linea: { l: 'Transferencia sin línea en la cartola', c: SLATE },
  plan: { l: 'Plan de cuentas', c: SLATE },
}
const ROTULO_RESP = { credito: 'Crédito bancario', otro: 'Otro', liquidacion_sueldo: 'Liquidación de sueldo' }

function RevisarImputacion({ plan, cu, version, onCambio }) {
  const [rows, setRows] = useState([])
  const [tef, setTef] = useState([])
  const [cargando, setCargando] = useState(true)
  const [chip, setChip] = useState('todos')
  const [editId, setEditId] = useState(null)
  const [ocupado, setOcupado] = useState(null)
  const grupos = useMemo(() => armarPlan(plan.subs, plan.madres, [], []), [plan])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [r, t] = await Promise.all([
        traerTodo(() => supabase.from('v_banco_revision').select('*').order('prioridad').order('fecha', { ascending: false }).order('mov_id').order('clave')),
        traerTodo(() => supabase.from('v_tef_detalle').select('n_transaccion, fecha_contable, rut, nombre_destino, monto, motivo').is('movimiento_id', null).order('fecha_contable', { ascending: false }).order('n_transaccion')),
      ])
      setRows(r); setTef(t)
    } catch (e) { toast.error(e?.message ?? String(e)) } finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar, version])

  const planIssues = useMemo(() => {
    const madres = new Map(plan.madres.map(m => [m.id, m]))
    const out = []
    for (const s of plan.subs) {
      if (!s.activa) continue
      const m = madres.get(s.cuenta_madre_id)
      let det = null
      if (!s.codigo) det = 'La subcuenta no tiene código'
      else if (!/^\d{3}\.\d{2}$/.test(s.codigo)) det = `Código con formato irregular (${s.codigo})`
      else if (m && s.codigo.slice(0, 3) !== m.codigo) det = `El código ${s.codigo} no corresponde a su cuenta madre ${m.codigo} ${m.nombre}`
      if (det) out.push({ _k: 'p' + s.id, clave: 'plan', fecha: null, descripcion: `${s.codigo ?? 's/c'} · ${s.nombre}`, monto: null, detalle: det, sub_codigo: m?.codigo ?? '', sub_nombre: m?.nombre ?? '' })
    }
    return out
  }, [plan])

  const todos = useMemo(() => [
    ...rows.map((r, i) => ({ ...r, _k: `${r.clave}-${r.mov_id}-${i}` })),
    ...tef.map(t => ({ _k: 't' + t.n_transaccion, clave: 'tef_sin_linea', fecha: t.fecha_contable, descripcion: `${t.nombre_destino ?? ''} (RUT ${fRut(t.rut)})`, monto: t.monto,
      detalle: `Está en el informe de transferencias pero no encontré su línea en la cartola${t.motivo ? ` · motivo: ${t.motivo}` : ''}` })),
    ...planIssues,
  ], [rows, tef, planIssues])
  const cuenta = useMemo(() => { const c = {}; for (const r of todos) c[r.clave] = (c[r.clave] ?? 0) + 1; return c }, [todos])
  const visibles = useMemo(() => (chip === 'todos' ? todos : todos.filter(r => r.clave === chip)), [todos, chip])

  async function hacer(r, fn, ok) {
    setOcupado(r._k)
    try { await fn(); toast.success(ok); setEditId(null); await cargar(); onCambio?.() }
    catch (e) { toast.error(e?.message ?? String(e)) } finally { setOcupado(null) }
  }
  const aplicarSub = (r, subId) => hacer(r, () => clasificarMovimiento(r.mov_id, subId), 'Subcuenta corregida')
  const aplicarRespaldo = r => hacer(r, async () => {
    const { data, error } = await supabase.from('movimientos_bancarios').update({ tipo_respaldo: r.sug_respaldo }).eq('id', r.mov_id).select('id')
    if (error) throw error
    if (!data?.length) throw new Error('No se guardó: sin permiso para modificar este movimiento')
  }, 'Tipo de respaldo corregido')
  const registrarAlias = r => hacer(r, async () => {
    const nombre = String(r.descripcion ?? '').replace(/^[0-9]{9}[0-9Kk]\s+Transf a\s+/i, '').trim()
    const { error } = await supabase.from('proveedor_rut_alias').insert({
      rut_pago: rutGuion(r.rut_glosa), rut_proveedor: rutGuion(r.rut_fac), nombre_alias: nombre || null,
      nota: `Registrado desde Estado y vínculos: paga facturas de ${r.prov_fac ?? ''}`.trim(), confirmado_por: cu?.id ?? null,
    })
    if (error) throw error
  }, 'Alias registrado: ese RUT queda como pagador de este proveedor')

  const cols = [
    { key: 'clave', label: 'Problema', width: 190, value: r => PROBLEMAS[r.clave]?.l ?? r.clave,
      render: r => <span style={{ fontWeight: 700, fontSize: 11, color: PROBLEMAS[r.clave]?.c ?? SLATE }}>{PROBLEMAS[r.clave]?.l ?? r.clave}</span> },
    { key: 'fecha', label: 'Fecha', width: 86, value: r => fF(r.fecha) },
    { key: 'descripcion', label: 'Movimiento', width: 290 },
    { key: 'monto', label: 'Monto', align: 'right', width: 110, value: r => Number(r.monto ?? 0),
      render: r => (r.monto != null ? <span style={NUMS}>{r.mov_tipo === 'ABONO' ? '+' : ''}{fmt(r.monto)}</span> : '') },
    { key: 'actual', label: 'Subcuenta actual', width: 230, value: r => (r.sub_codigo || r.sub_nombre ? `${r.sub_codigo ?? ''} ${r.sub_nombre ?? ''}`.trim() : '') },
    { key: 'tipo_respaldo', label: 'Respaldo', width: 110 },
    { key: 'detalle', label: 'Qué pasa', width: 360 },
    {
      key: 'accion', label: 'Corrección', width: 330, value: r => r.sug_codigo ?? r.sug_respaldo ?? '',
      render: r => {
        if (!r.mov_id) return <span style={{ color: SLATE }}>—</span>
        const ocup = ocupado === r._k
        if (editId === r._k) return <BuscadorSubcuenta plan={grupos} value={r.subcuenta_id} disabled={ocup} autoFocus tipoMov={r.mov_tipo} onChange={v => v && aplicarSub(r, v)} />
        return (
          <span style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
            {r.sug_subcuenta_id && <button disabled={ocup} onClick={() => aplicarSub(r, r.sug_subcuenta_id)} style={{ ...MINI, borderColor: VERDE, color: VERDE }}>Usar {r.sug_codigo} {r.sug_nombre}</button>}
            {r.sug_respaldo && <button disabled={ocup} onClick={() => aplicarRespaldo(r)} style={{ ...MINI, borderColor: VERDE, color: VERDE }}>Respaldo: {ROTULO_RESP[r.sug_respaldo] ?? r.sug_respaldo}</button>}
            {r.clave === 'rut_distinto' && <button disabled={ocup} onClick={() => registrarAlias(r)} style={MINI}>Es correcto: registrar alias</button>}
            <button disabled={ocup} onClick={() => setEditId(r._k)} style={MINI}>Otra subcuenta</button>
          </span>
        )
      },
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setChip('todos')} style={{ ...BTN(chip === 'todos'), borderRadius: 999 }}>Todos · {todos.length}</button>
        {Object.entries(PROBLEMAS).filter(([k]) => cuenta[k]).map(([k, p]) => (
          <button key={k} onClick={() => setChip(k)} style={{ ...BTN(chip === k, p.c), borderRadius: 999 }}>{p.l} · {cuenta[k]}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={cargar} style={BTN(false)}>Actualizar</button>
      </div>
      <DataGrid title={`Imputaciones por revisar · ${visibles.length}`} exportName="revision_imputacion_banco" columns={cols} rows={visibles}
        getRowId={r => r._k} loading={cargando} emptyText="No hay nada por revisar con este filtro" />
      <div style={{ fontSize: 10.5, color: SLATE }}>
        "Subcuenta no habitual": el proveedor tiene una subcuenta que concentra al menos el 70% de sus pagos vinculados y este pago está en otra; revisa si es una compra distinta o un error. "Masivo sin facturas": cargo de pago masivo marcado como pago de facturas sin desglose vinculado; sus transferencias se vinculan desde Compras por proveedor.
      </div>
    </div>
  )
}
