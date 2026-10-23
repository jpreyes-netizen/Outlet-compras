import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../supabase'
import { normalizar } from './BuscadorCuenta'
import { ProveedorDetalle } from './EstadoVinculosTab'

/* ═══════════════════════════════════════════════════════════════════════
   CALZAR FACTURAS CON PAGOS (22-oct-2026) — Compras y pagos
   Motor estricto en la base (fn_calces_estrictos): mismo RUT, monto exacto al
   peso, ventana de fechas por plazo del proveedor (30 días antes de la
   emisión hasta plazo + 90 días después), de la factura más reciente a la más
   antigua y, ante montos iguales, la factura más reciente con el pago más
   reciente. Reglas en orden: folio citado en la transferencia, tope de $7M,
   monto exacto (único o por recencia), un pago para varias facturas, una
   factura en varios pagos y bolsa exacta (k facturas = m pagos). Si una
   combinación no es única, no se propone: queda para resolverla a mano.
   Por defecto revisa de septiembre a enero y deja fuera octubre.
   Aplicar escribe con fn_ev_vincular (valida saldo y disponible), un calce
   por llamada para que uno que falle no frene a los demás.
   El buscador abre el libro espejo del proveedor (Estado y vínculos) para
   conciliar a mano lo que el motor no puede asegurar.
   ═══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', AZUL = '#1D4ED8'
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fF = f => { if (!f) return ''; const [a, m, d] = String(f).slice(0, 10).split('-'); return `${d}-${m}-${a.slice(2)}` }
const MES_L = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const mesLabel = m => { const [a, mm] = String(m).split('-'); return `${MES_L[Number(mm) - 1] ?? mm}-${String(a).slice(2)}` }
const finDeMes = m => { const [a, mm] = String(m).split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10) }
const fRut = r => { const s = String(r || ''); return s.length > 1 ? `${s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${s.slice(-1)}` : s }
const MES_ACTUAL = new Date().toISOString().slice(0, 7)
const MESES = (() => { const out = []; let m = '2026-01'; while (m <= MES_ACTUAL && out.length < 24) { out.push(m); const [a, mm] = m.split('-').map(Number); m = mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, '0')}` } return out })()
const FUENTE_L = { banco: 'Banco', tef: 'Transf. masiva', tarjeta: 'Tarjeta' }
const REGLAS = {
  folio: { l: 'Folio citado', c: VERDE, d: 'La transferencia cita el folio de la factura' },
  tope_7m: { l: 'Tope $7M', c: VERDE, d: 'Transferencias del mismo día cortadas por el tope del banco' },
  exacto: { l: 'Monto exacto', c: VERDE, d: 'Único pago y única factura del RUT con ese monto' },
  exacto_por_orden: { l: 'Exacto por recencia', c: AMBAR, d: 'Montos repetidos: factura más reciente con pago más reciente' },
  suma_facturas: { l: 'Un pago, varias facturas', c: AZUL, d: 'Un pago cubre exacto facturas seguidas' },
  suma_pagos: { l: 'Una factura, varios pagos', c: AZUL, d: 'La factura se pagó exacto en pagos seguidos' },
  bolsa: { l: 'Bolsa exacta', c: AZUL, d: 'Facturas y pagos seguidos que suman lo mismo al peso' },
}
const BTN = (activo, color = NAVY) => ({ fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${activo ? color : BORDE}`, background: activo ? color : '#fff', color: activo ? '#fff' : INK, whiteSpace: 'nowrap' })
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff', color: INK }
const TD = { fontSize: 12, padding: '6px 8px', borderBottom: '1px solid #F1F2F4', verticalAlign: 'top', color: INK }
const NUMS = { fontVariantNumeric: 'tabular-nums' }

async function traerTodo(armar, tope = 50000) {
  const out = []
  while (out.length < tope) {
    const { data, error } = await armar().range(out.length, out.length + 999)
    if (error) throw error
    if (!data?.length) break
    out.push(...data)
  }
  return out
}

// Filas del motor (una por factura × pago) → calces agrupados
export function agruparCalces(filas) {
  const G = new Map()
  for (const f of filas ?? []) {
    if (!G.has(f.grupo)) G.set(f.grupo, { grupo: f.grupo, regla: f.regla, mes: f.mes, rut: f.rut, proveedor: f.proveedor, detalle: f.detalle, facturas: new Map(), pagos: new Map(), items: [], monto: 0 })
    const g = G.get(f.grupo)
    if (!g.facturas.has(f.factura_id)) g.facturas.set(f.factura_id, { id: f.factura_id, folio: f.folio, fecha: f.fecha_factura, saldo: Number(f.saldo_factura) })
    if (!g.pagos.has(f.pago_id)) g.pagos.set(f.pago_id, { k: f.pago_id, fuente: f.fuente, mov_id: f.mov_id, tef_n: f.tef_n, fecha: f.fecha_pago, monto: Number(f.monto_pago) })
    g.items.push({ factura_id: f.factura_id, pago_id: f.pago_id, fuente: f.fuente, mov_id: f.mov_id, tef_n: f.tef_n, aplicar: Number(f.aplicar) })
    g.monto += Number(f.aplicar) || 0
    if (f.mes > g.mes) g.mes = f.mes   // el calce cuenta en el mes de su factura más reciente
  }
  return [...G.values()].map(g => ({ ...g, facturas: [...g.facturas.values()].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))), pagos: [...g.pagos.values()].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))) }))
}
// Ítems para fn_ev_vincular
export const itemsDeCalce = g => g.items.map(it => ({
  fuente: it.fuente, mov_id: it.mov_id ?? null, tef_n: it.tef_n ?? null, tc_id: null, factura_id: it.factura_id,
  monto: Math.round(it.aplicar), nota: `Calce estricto: ${REGLAS[g.regla]?.l ?? g.regla}`,
}))
// Buscador de facturas: todas las palabras deben calzar (folio, RUT, proveedor o monto)
export function filtrarFacturas(lista, texto) {
  const toks = normalizar(texto).trim().split(/\s+/).filter(Boolean)
  if (!toks.length) return []
  return lista.filter(f => {
    const hay = normalizar(`${f.folio} ${f.rut} ${fRut(f.rut)} ${f.razon_social} ${f.fecha_emision}`)
    return toks.every(t => {
      const dig = t.replace(/[.,\-]/g, '')
      if (/^\d+$/.test(dig) && dig.length >= 4 && Math.abs(Number(f.saldo) - Number(dig)) <= 1) return true
      if (/^\d+$/.test(dig) && Math.abs(Number(f.monto_total) - Number(dig)) <= 1) return true
      return hay.includes(t) || (/^\d+[\dk]?$/.test(dig) && hay.includes(dig))
    })
  })
}

export function ConciliarFacturasTab({ cu }) {
  const [desde, setDesde] = useState('2026-01')
  const [hasta, setHasta] = useState(MESES.includes('2026-09') ? '2026-09' : MESES[MESES.length - 1])
  const [excluirOct, setExcluirOct] = useState(true)
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(false)
  const [marcados, setMarcados] = useState(() => new Set())
  const [regla, setRegla] = useState('todas')
  const [aplicando, setAplicando] = useState(null)
  const [busca, setBusca] = useState('')
  const [abiertas, setAbiertas] = useState(null)        // facturas abiertas para el buscador (se cargan al buscar)
  const [prov, setProv] = useState(null)                // proveedor abierto en el libro espejo

  const calcular = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase.rpc('fn_calces_estrictos', { p_desde: `${desde}-01`, p_hasta: finDeMes(hasta), p_excluir: excluirOct ? ['2026-10'] : [] })
    setCargando(false)
    if (error) { toast.error(error.message); return }
    setFilas(data ?? [])
    setMarcados(new Set((data ?? []).map(r => r.grupo)))
  }, [desde, hasta, excluirOct])
  useEffect(() => { calcular() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const grupos = useMemo(() => agruparCalces(filas), [filas])
  const visibles = useMemo(() => grupos.filter(g => regla === 'todas' || g.regla === regla), [grupos, regla])
  const porMes = useMemo(() => {
    const M = new Map()
    for (const g of visibles) { if (!M.has(g.mes)) M.set(g.mes, []); M.get(g.mes).push(g) }
    return [...M.entries()].sort((a, b) => b[0].localeCompare(a[0]))      // septiembre primero
  }, [visibles])
  const k = useMemo(() => {
    const s = { calces: grupos.length, facturas: 0, monto: 0, porRegla: {} }
    for (const g of grupos) {
      s.facturas += g.facturas.length; s.monto += g.monto
      const r = (s.porRegla[g.regla] = s.porRegla[g.regla] ?? { n: 0, monto: 0 }); r.n++; r.monto += g.monto
    }
    return s
  }, [grupos])
  const marcadosVis = visibles.filter(g => marcados.has(g.grupo))

  async function aplicar(lista, titulo) {
    if (!lista.length) return
    if (!window.confirm(`${titulo}: ${lista.length} calce${lista.length === 1 ? '' : 's'} por $${fmt(lista.reduce((s, g) => s + g.monto, 0))}.\nCada calce vincula sus facturas con sus pagos en la conciliación. ¿Seguir?`)) return
    setAplicando(titulo)
    let ok = 0, err = 0, ultimo = ''
    for (const g of lista) {
      const { error } = await supabase.rpc('fn_ev_vincular', { p_items: itemsDeCalce(g) })
      if (error) { err++; ultimo = error.message } else ok++
    }
    setAplicando(null)
    if (err) toast.error(`${ok} calces aplicados, ${err} con error (${ultimo}). Vuelve a calcular: el motor ya no los propone si se aplicaron.`)
    else toast.success(`${ok} calce${ok === 1 ? '' : 's'} aplicado${ok === 1 ? '' : 's'}`)
    setAbiertas(null)
    await calcular()
  }

  async function buscar(t) {
    setBusca(t)
    if (abiertas || !t.trim()) return
    try {
      setAbiertas(await traerTodo(() => supabase.from('v_ap_facturas').select('id, rut, razon_social, folio, codigo_sii, fecha_emision, monto_total, saldo, estado_factura')
        .gte('fecha_emision', '2026-01-01').gt('saldo', 10).neq('codigo_sii', '61').order('fecha_emision', { ascending: false }).order('id')))
    } catch (e) { toast.error(e?.message ?? String(e)) }
  }
  const resultados = useMemo(() => (abiertas ? filtrarFacturas(abiertas, busca).slice(0, 30) : []), [abiertas, busca])
  const togGrupo = id => setMarcados(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const togMes = lista => setMarcados(s => { const n = new Set(s); const todos = lista.every(g => n.has(g.grupo)); lista.forEach(g => (todos ? n.delete(g.grupo) : n.add(g.grupo))); return n })

  if (prov) return <ProveedorDetalle key={prov.rut} prov={prov} onVolver={() => setProv(null)} onSiguiente={null} onCambio={() => { setAbiertas(null); calcular() }} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── período y buscador ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '8px 12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: SLATE }}>Facturas de</span>
        <select value={desde} onChange={e => setDesde(e.target.value)} style={INPUT} aria-label="Desde">{MESES.map(m => <option key={m} value={m}>{mesLabel(m)}</option>)}</select>
        <span style={{ fontSize: 11.5, color: SLATE }}>a</span>
        <select value={hasta} onChange={e => setHasta(e.target.value)} style={INPUT} aria-label="Hasta">{MESES.map(m => <option key={m} value={m}>{mesLabel(m)}</option>)}</select>
        <label style={{ fontSize: 11.5, color: SLATE, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={excluirOct} onChange={e => setExcluirOct(e.target.checked)} /> dejar fuera octubre
        </label>
        <button onClick={calcular} disabled={cargando || !!aplicando} style={BTN(true)}>{cargando ? 'Buscando calces…' : 'Buscar calces'}</button>
        <span style={{ width: 1, height: 18, background: BORDE }} />
        <input value={busca} onChange={e => buscar(e.target.value)} placeholder="Buscar factura: folio, RUT, proveedor o monto…" aria-label="Buscar factura"
          style={{ ...INPUT, flex: 1, minWidth: 260 }} />
      </div>

      {busca.trim() && (
        <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'auto', maxHeight: 320 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {!abiertas && <tr><td style={{ ...TD, color: SLATE }}>Cargando facturas abiertas…</td></tr>}
              {abiertas && resultados.length === 0 && <tr><td style={{ ...TD, color: SLATE }}>Ninguna factura abierta de 2026 calza con «{busca.trim()}».</td></tr>}
              {resultados.map(f => (
                <tr key={f.id}>
                  <td style={TD}><b>{f.codigo_sii === '914' ? 'DIN' : 'F'} {f.folio}</b> · {fF(f.fecha_emision)}</td>
                  <td style={TD}>{f.razon_social}<div style={{ fontSize: 10.5, color: SLATE }}>RUT {fRut(f.rut)}</div></td>
                  <td style={{ ...TD, textAlign: 'right', ...NUMS }}>total {fmt(f.monto_total)}<div style={{ fontWeight: 700, color: ROJO }}>saldo {fmt(f.saldo)}</div></td>
                  <td style={{ ...TD, textAlign: 'right' }}><button onClick={() => setProv({ rut: f.rut, razon_social: f.razon_social })} style={BTN(false)}>Conciliar con el proveedor</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── resumen por regla ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setRegla('todas')} style={{ ...BTN(regla === 'todas'), borderRadius: 999 }}>Todos · {k.calces} calces · ${fmt(k.monto)}</button>
        {Object.entries(REGLAS).filter(([r]) => k.porRegla[r]).map(([r, d]) => (
          <button key={r} onClick={() => setRegla(r)} title={d.d} style={{ ...BTN(regla === r, d.c), borderRadius: 999 }}>{d.l} · {k.porRegla[r].n} · ${fmt(k.porRegla[r].monto)}</button>
        ))}
        <span style={{ flex: 1 }} />
        {aplicando && <span style={{ fontSize: 11.5, color: SLATE }}>{aplicando}…</span>}
        <button onClick={() => aplicar(marcadosVis, 'Aplicar marcados')} disabled={!!aplicando || !marcadosVis.length} style={BTN(marcadosVis.length > 0, VERDE)}>
          Aplicar {marcadosVis.length} marcado{marcadosVis.length === 1 ? '' : 's'}
        </button>
      </div>

      {!cargando && grupos.length === 0 && (
        <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: 14, fontSize: 12.5, color: SLATE }}>
          Con estas reglas no hay calces seguros en el período. Lo que queda se concilia a mano: busca la factura arriba y ábrela con su proveedor.
        </div>
      )}

      {porMes.map(([mes, lista]) => {
        const total = lista.reduce((s, g) => s + g.monto, 0)
        const marcadosMes = lista.filter(g => marcados.has(g.grupo))
        return (
          <div key={mes} style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#F8FAFC', borderBottom: `1px solid ${BORDE}` }}>
              <input type="checkbox" aria-label={`Marcar ${mesLabel(mes)}`} checked={lista.every(g => marcados.has(g.grupo))} onChange={() => togMes(lista)} />
              <b style={{ fontSize: 13, color: NAVY }}>Facturas de {mesLabel(mes)}</b>
              <span style={{ fontSize: 12, color: SLATE }}>{lista.length} calce{lista.length === 1 ? '' : 's'} · <b style={{ color: INK, ...NUMS }}>${fmt(total)}</b></span>
              <span style={{ flex: 1 }} />
              <button onClick={() => aplicar(marcadosMes, `Aplicar ${mesLabel(mes)}`)} disabled={!!aplicando || !marcadosMes.length} style={BTN(false, VERDE)}>
                Aplicar {marcadosMes.length} de {mesLabel(mes)}
              </button>
            </div>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <tbody>
                {lista.map(g => {
                  const d = REGLAS[g.regla] ?? { l: g.regla, c: SLATE }
                  return (
                    <tr key={g.grupo} style={{ background: marcados.has(g.grupo) ? null : '#FAFAFA', opacity: marcados.has(g.grupo) ? 1 : 0.6 }}>
                      <td style={{ ...TD, width: 26 }}><input type="checkbox" aria-label={`Marcar calce ${g.grupo}`} checked={marcados.has(g.grupo)} onChange={() => togGrupo(g.grupo)} /></td>
                      <td style={{ ...TD, width: 150 }}><span style={{ fontSize: 10.5, fontWeight: 700, color: d.c }}>{d.l}</span><div style={{ fontSize: 10.5, color: SLATE }}>{g.detalle}</div></td>
                      <td style={{ ...TD, width: 230 }}>
                        <button onClick={() => setProv({ rut: g.rut, razon_social: g.proveedor })} title="Abrir el libro espejo del proveedor"
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: NAVY, fontWeight: 700, textAlign: 'left', fontSize: 12 }}>{g.proveedor}</button>
                        <div style={{ fontSize: 10.5, color: SLATE }}>RUT {fRut(g.rut)}</div>
                      </td>
                      <td style={TD}>{g.facturas.map(f => <div key={f.id} style={NUMS}><b>F {f.folio}</b> · {fF(f.fecha)} · saldo {fmt(f.saldo)}</div>)}</td>
                      <td style={TD}>{g.pagos.map(p => <div key={p.k} style={NUMS}>{fF(p.fecha)} · {FUENTE_L[p.fuente] ?? p.fuente} · {fmt(p.monto)}</div>)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 700, ...NUMS }}>{fmt(g.monto)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
      <div style={{ fontSize: 10.5, color: SLATE }}>
        Reglas estrictas: mismo RUT (o alias registrado), monto exacto al peso y pago entre 30 días antes de la emisión y el plazo del proveedor más 90 días. Si una combinación no es única, el motor no la propone. Clic en el proveedor para conciliar a mano en su libro espejo.
      </div>
    </div>
  )
}
