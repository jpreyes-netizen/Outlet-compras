import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { exportarExcel, exportarPDF } from '../exportUtils'
import { ExploradorTab } from './ExploradorTab'

/* ══════════════════════════════════════════════════════════════════════
   CUADRATURA DE RECAUDACIÓN — replica el informe de tesorería
   Respaldo de la recaudación documento por documento contra Getnet,
   la cartola Santander y los depósitos. Todo sale de BSALE pago a pago
   (bsale_pagos) conciliado por fn_tes_conciliar.
   Cabecera: debió entrar · probado contra la fuente · pendiente.
   Paso 1 venta→caja · Paso 2 por medio · Paso 3 diario · Paso 4 pendientes.
   Fuente única: RPC fn_tesoreria_panel(desde, hasta) — un solo request.
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const fmt = n => '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fS = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const TH = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE, padding: '7px 10px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap' }
const TD = { fontSize: 12.5, padding: '6px 10px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff' }
const SEV = { alta: ROJO, media: AMBAR, informativa: SLATE }

const hoyISO = () => new Date().toISOString().slice(0, 10)
const primeroMes = () => hoyISO().slice(0, 8) + '01'

function Seccion({ paso, titulo, sub, children, acciones }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${BORDE}`, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          {paso && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: SLATE }}>PASO {paso}</div>}
          <div style={{ fontSize: 14.5, fontWeight: 700, color: NAVY }}>{titulo}</div>
          {sub && <div style={{ fontSize: 11.5, color: SLATE, marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
        </div>
        {acciones}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  )
}
const Linea = ({ l, v, neg, bold, sub }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: bold ? undefined : '1px solid #F3F4F6', alignItems: 'baseline' }}>
    <div><div style={{ fontSize: 12.5, fontWeight: bold ? 700 : 500, color: bold ? NAVY : INK }}>{l}</div>
      {sub && <div style={{ fontSize: 10.5, color: SLATE }}>{sub}</div>}</div>
    <div style={{ fontSize: bold ? 16 : 13, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: neg ? ROJO : bold ? NAVY : INK }}>{neg ? '−' : ''}{fmt(Math.abs(v))}</div>
  </div>
)

export function CuadraturaTab({ usuario }) {
  const [vista, setVista] = useState('cuadratura')
  const [desde, setDesde] = useState(primeroMes())
  const [hasta, setHasta] = useState(hoyISO())
  const [d, setD] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [verDetalle, setVerDetalle] = useState(false)

  const cargar = async () => {
    setCargando(true); setError(null)
    const { data, error: e } = await supabase.rpc('fn_tesoreria_panel', { p_desde: desde, p_hasta: hasta })
    setCargando(false)
    if (e) { setError(e.message); return }
    setD(data)
  }
  useEffect(() => { cargar() }, [])

  const conciliar = async () => {
    setCargando(true); setError(null)
    const r1 = await supabase.rpc('fn_tes_conciliar', { p_desde: desde, p_hasta: hasta })
    if (r1.error) { setError(r1.error.message); setCargando(false); return }
    const r2 = await supabase.rpc('fn_tes_conciliar_dia_total', { p_desde: desde, p_hasta: hasta })
    if (r2.error) { setError(r2.error.message); setCargando(false); return }
    await cargar()
  }

  if (error) return <div style={{ background: '#FEF3F2', border: '1px solid #FECDCA', borderRadius: 8, padding: 14, color: ROJO, fontSize: 12.5 }}>Error: {error}</div>
  if (!d) return <div style={{ padding: 24, color: SLATE, fontSize: 13 }}>{cargando ? 'Calculando cuadratura…' : 'Sin datos'}</div>

  const p1 = d.paso1 ?? {}
  const probado = (d.paso2 ?? []).reduce((s, m) => s + Number(m.probado || 0), 0)
  const llego = (d.paso2 ?? []).reduce((s, m) => s + Number(m.llego || 0), 0)
  const pendiente = (d.paso2 ?? []).reduce((s, m) => s + Number(m.sin_respaldo || 0) + Number(m.sin_fuente || 0), 0)
  const pctProbado = llego > 0 ? (100 * probado / llego) : null
  const maxDia = Math.max(...(d.paso3 ?? []).map(x => Number(x.con_respaldo || 0) + Number(x.sin_respaldo || 0) + Number(x.no_recauda || 0)), 1)

  const BarraVista = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button onClick={() => setVista('cuadratura')} style={{ fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${vista === 'cuadratura' ? NAVY : BORDE}`, background: vista === 'cuadratura' ? NAVY : '#fff', color: vista === 'cuadratura' ? '#fff' : INK }}>Cuadratura del período</button>
      <button onClick={() => setVista('explorador')} style={{ fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${vista === 'explorador' ? NAVY : BORDE}`, background: vista === 'explorador' ? NAVY : '#fff', color: vista === 'explorador' ? '#fff' : INK }}>Explorador y análisis</button>
    </div>
  )

  if (vista === 'explorador') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {BarraVista}
      <ExploradorTab />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {BarraVista}
      {/* controles */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={INPUT} />
        <span style={{ color: SLATE, fontSize: 12 }}>a</span>
        <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={INPUT} />
        <button onClick={cargar} disabled={cargando} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>{cargando ? 'Calculando…' : 'Consultar'}</button>
        <button onClick={conciliar} disabled={cargando} title="Vuelve a cruzar los pagos del rango contra Getnet, cartola y depósitos"
          style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Reconciliar rango</button>
        <span style={{ fontSize: 11, color: SLATE, marginLeft: 'auto' }}>
          {d.calculado_at ? 'calculado ' + new Date(d.calculado_at).toLocaleString('es-CL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''}
        </span>
      </div>

      {/* cabecera */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        {[
          { l: 'VENTA NETA DEL PERÍODO', v: fmt(p1.venta_neta), s: `${fS(p1.docs)} documentos emitidos` },
          { l: 'DEBIÓ ENTRAR A LA CAJA', v: fmt(p1.debio_entrar), s: 'pagos en medios que recaudan' },
          { l: 'PROBADO CONTRA LA FUENTE', v: pctProbado != null ? pctProbado.toFixed(1) + '%' : '—', s: `${fmt(probado)} verificados`, c: pctProbado >= 90 ? VERDE : pctProbado >= 70 ? AMBAR : ROJO },
          { l: 'PENDIENTE DE RESOLVER', v: fmt(pendiente), s: 'sin respaldo de fuente externa', c: pendiente > 0 ? ROJO : VERDE },
        ].map((k, i) => (
          <div key={i} style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, letterSpacing: 0.6, color: SLATE, fontWeight: 600 }}>{k.l}</div>
            <div style={{ fontSize: 21, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: k.c || NAVY }}>{k.v}</div>
            <div style={{ fontSize: 11, color: SLATE }}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* paso 1 */}
      <Seccion paso="1" titulo="Qué se vendió y cuánto tenía que llegar a la caja"
        sub="Parte de la venta se pagó con saldo que el cliente ya tenía, y el crédito se cobra después: no todo lo vendido debía entrar hoy.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <Linea l="Venta bruta emitida" sub={`${fS(p1.docs)} boletas y facturas`} v={p1.venta_bruta} />
            <Linea l="Notas de crédito que rebajan esa venta" sub="devoluciones sobre documentos del período" v={p1.notas_credito} neg />
            <div style={{ marginTop: 8 }}><Linea l="Venta neta del período" v={p1.venta_neta} bold /></div>
          </div>
          <div>
            <Linea l="Pagado con saldo a favor o nota de crédito" sub="el dinero entró antes del período (o nunca)" v={p1.pagado_con_saldo} neg />
            <Linea l="Venta a crédito (se cobra después)" v={p1.venta_a_credito} neg />
            <div style={{ marginTop: 8 }}><Linea l="Debió entrar a la caja" v={p1.debio_entrar} bold /></div>
          </div>
        </div>
      </Seccion>

      {/* paso 2 */}
      <Seccion paso="2" titulo="En qué medios llegó y cuánto se pudo probar"
        sub="Cada peso se buscó en la fuente que corresponde: Getnet voucher a voucher, la cartola Santander, y los depósitos de efectivo."
        acciones={<button onClick={() => exportarExcel(d.paso2 ?? [], `cuadratura_medios_${desde}`, 'Medios')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={TH}>Medio de pago</th><th style={{ ...TH, textAlign: 'right' }}>Llegó</th><th style={{ ...TH, textAlign: 'right' }}>Probado</th><th style={{ ...TH, textAlign: 'right' }}>Sin respaldo</th><th style={TH}>Qué lo prueba</th></tr></thead>
          <tbody>
            {(d.paso2 ?? []).map((m, i) => {
              const sinR = Number(m.sin_respaldo || 0) + Number(m.sin_fuente || 0)
              return (
                <tr key={i}>
                  <td style={{ ...TD, fontWeight: 600 }}>{m.medio}</td>
                  <td style={NUM}>{fmt(m.llego)}</td>
                  <td style={{ ...NUM, color: VERDE }}>{fmt(m.probado)}<span style={{ fontSize: 10, color: SLATE }}> {m.pct_probado ?? 0}%</span></td>
                  <td style={{ ...NUM, fontWeight: 700, color: sinR > 0 ? ROJO : SLATE }}>{sinR > 0 ? fmt(sinR) : '—'}</td>
                  <td style={{ ...TD, whiteSpace: 'normal', fontSize: 11, color: SLATE, maxWidth: 320 }}>{m.que_prueba}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: SLATE, marginTop: 8, lineHeight: 1.5 }}>
          "Sin respaldo" no significa dinero perdido: el abono de tarjeta llega 1–3 días hábiles después y la cartola puede no estar cargada hasta esa fecha. Significa que <b>todavía no se puede probar</b>.
          El abono del recaudador llega <b>neto de comisión</b>, así que nunca calza al peso contra la venta bruta: se acepta como cuadrado cuando la diferencia está dentro de la comisión esperada.
        </div>
      </Seccion>

      {/* paso 3 */}
      <Seccion paso="3" titulo="Recaudación diaria"
        sub="Cada barra es lo cobrado del día: verde con respaldo verificado, rojo sin respaldo aún, gris pagado con saldo o nota de crédito (no hay cobro que buscar).">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150, padding: '0 4px' }}>
          {(d.paso3 ?? []).map((x, i) => {
            const cr = Number(x.con_respaldo || 0), sr = Number(x.sin_respaldo || 0), nr = Number(x.no_recauda || 0)
            const tot = cr + sr + nr
            return (
              <div key={i} title={`${x.fecha}\nCon respaldo: ${fmt(cr)}\nSin respaldo: ${fmt(sr)}\nNo recauda: ${fmt(nr)}`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', cursor: 'default' }}>
                <div style={{ height: `${100 * nr / maxDia}%`, background: '#D1D5DB' }} />
                <div style={{ height: `${100 * sr / maxDia}%`, background: ROJO }} />
                <div style={{ height: `${100 * cr / maxDia}%`, background: VERDE, borderRadius: '2px 2px 0 0' }} />
                <div style={{ fontSize: 8.5, color: SLATE, textAlign: 'center', marginTop: 3 }}>{x.fecha?.slice(8)}</div>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: SLATE }}>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, background: VERDE, borderRadius: 2, marginRight: 4 }} />Con respaldo</span>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, background: ROJO, borderRadius: 2, marginRight: 4 }} />Sin respaldo</span>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, background: '#D1D5DB', borderRadius: 2, marginRight: 4 }} />Sin cobro que buscar</span>
        </div>
      </Seccion>

      {/* paso 4 */}
      <Seccion paso="4" titulo="Qué falta resolver" sub="Ordenado por urgencia. El efectivo primero: es lo único sin rastro externo automático.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(d.paso4 ?? []).filter(x => Number(x.monto) !== 0 || x.urgencia === 'alta').map((x, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '5px 1fr 140px', gap: 12, alignItems: 'center', border: `1px solid ${BORDE}`, borderRadius: 6, padding: '10px 12px' }}>
              <div style={{ background: SEV[x.urgencia] || SLATE, height: '100%', minHeight: 30, borderRadius: 3 }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>{x.titulo} <span style={{ fontWeight: 400, color: SLATE }}>· {fS(x.n)} registros</span></div>
                <div style={{ fontSize: 11.5, color: SLATE, lineHeight: 1.45 }}>{x.accion}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 15, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: SEV[x.urgencia] || INK }}>{fmt(x.monto)}</div>
            </div>
          ))}
        </div>
      </Seccion>

      {/* por sucursal */}
      <Seccion titulo="Quién está limpio" sub="Probado y pendiente por sucursal — misma vara para todas">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={TH}>Sucursal</th><th style={{ ...TH, textAlign: 'right' }}>Pagos</th><th style={{ ...TH, textAlign: 'right' }}>Registrado</th><th style={{ ...TH, textAlign: 'right' }}>Probado</th><th style={{ ...TH, textAlign: 'right' }}>Sin respaldo</th></tr></thead>
          <tbody>
            {(d.sucursal ?? []).map((s, i) => (
              <tr key={i}>
                <td style={{ ...TD, fontWeight: 600 }}>{s.sucursal}</td>
                <td style={NUM}>{fS(s.pagos)}</td>
                <td style={NUM}>{fmt(s.registrado)}</td>
                <td style={{ ...NUM, fontWeight: 700, color: Number(s.probado_pct) >= 90 ? VERDE : Number(s.probado_pct) >= 70 ? AMBAR : ROJO }}>{s.probado_pct ?? '—'}%</td>
                <td style={{ ...NUM, color: Number(s.sin_respaldo) > 0 ? ROJO : SLATE }}>{Number(s.sin_respaldo) > 0 ? fmt(s.sin_respaldo) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>

      {/* detalle */}
      <Seccion titulo="El detalle, documento por documento"
        sub="Los pagos más grandes que aún no tienen respaldo en ninguna fuente"
        acciones={<>
          <button onClick={() => setVerDetalle(v => !v)} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>{verDetalle ? 'Ocultar' : 'Ver'}</button>
          <button onClick={() => exportarExcel(d.detalle_sin_respaldo ?? [], `sin_respaldo_${desde}`, 'SinRespaldo')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
        </>}>
        {verDetalle ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={TH}>Fecha</th><th style={TH}>Sucursal</th><th style={TH}>Medio</th><th style={{ ...TH, textAlign: 'right' }}>Monto</th><th style={TH}>Doc BSALE</th><th style={TH}>Situación</th></tr></thead>
            <tbody>
              {(d.detalle_sin_respaldo ?? []).map((x, i) => (
                <tr key={i}>
                  <td style={TD}>{x.fecha}</td><td style={TD}>{x.sucursal}</td><td style={TD}>{x.medio}</td>
                  <td style={{ ...NUM, fontWeight: 700 }}>{fmt(x.monto)}</td>
                  <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{x.doc}</td>
                  <td style={{ ...TD, fontSize: 11, color: SLATE }}>{x.nota}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div style={{ fontSize: 12, color: SLATE }}>{(d.detalle_sin_respaldo ?? []).length} pagos sin respaldo en el rango (mostrando hasta 60, ordenados por monto).</div>}
      </Seccion>
    </div>
  )
}

export default CuadraturaTab
