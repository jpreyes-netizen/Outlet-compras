import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabase'
import { exportarExcel } from '../exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   DIAGNÓSTICO — por qué no cuadra, no solo cuánto
   1. Causa raíz: cada pago sin respaldo clasificado por la evidencia que
      explica el descuadre, separando problema de DATO (falta cargar algo)
      de problema de PLATA (el dinero no está donde debería).
   2. Triángulo BSALE ↔ Cierre de caja ↔ Banco: comparar los pares dice
      DÓNDE está el problema. El efectivo se mira primero: es lo único físico.
   RPC: fn_tes_diagnostico · fn_tes_causa_detalle
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const fmt = n => '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fS = n => new Intl.NumberFormat('es-CL').format(Number(n || 0))
const TH = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE, padding: '7px 10px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap' }
const TD = { fontSize: 12.5, padding: '6px 10px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff' }
const TIPO = {
  plata:    { c: ROJO,  l: 'PROBLEMA DE PLATA',  d: 'El dinero no está donde debería' },
  revision: { c: AMBAR, l: 'REVISAR',            d: 'Hay una explicación probable, falta confirmarla' },
  dato:     { c: SLATE, l: 'FALTA CARGAR DATO',  d: 'No es un faltante: falta la fuente para probarlo' },
}
const hoyISO = () => new Date().toISOString().slice(0, 10)
const primeroMes = () => hoyISO().slice(0, 8) + '01'

function Bloque({ titulo, sub, children, acciones }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '11px 15px', borderBottom: `1px solid ${BORDE}`, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{titulo}</div>
          {sub && <div style={{ fontSize: 11.5, color: SLATE, marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
        </div>
        {acciones}
      </div>
      <div style={{ padding: 13 }}>{children}</div>
    </div>
  )
}

export function DiagnosticoTab() {
  const [desde, setDesde] = useState(primeroMes())
  const [hasta, setHasta] = useState(hoyISO())
  const [suc, setSuc] = useState('')
  const [sucursales, setSucursales] = useState([])
  const [d, setD] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [detalle, setDetalle] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    const [r, f] = await Promise.all([
      supabase.rpc('fn_tes_diagnostico', { p_desde: desde, p_hasta: hasta, p_sucursal: suc || null }),
      supabase.rpc('fn_tes_filtros', { p_desde: desde, p_hasta: hasta }),
    ])
    setCargando(false)
    if (r.error) { setError(r.error.message); return }
    setD(r.data)
    if (!f.error && f.data?.sucursales) setSucursales(f.data.sucursales)
  }, [desde, hasta, suc])
  useEffect(() => { cargar() }, [cargar])

  const abrirCausa = async (c) => {
    setDetalle({ titulo: c.descripcion, sub: 'Cargando…', filas: [] })
    const { data, error: e } = await supabase.rpc('fn_tes_causa_detalle',
      { p_desde: desde, p_hasta: hasta, p_causa: c.causa, p_sucursal: suc || null, p_limit: 200 })
    setDetalle({ titulo: c.descripcion, sub: e ? e.message : `${fS(c.n)} pagos · ${fmt(c.monto)} · ${c.accion}`, filas: data ?? [] })
  }

  if (error) return <div style={{ background: '#FEF3F2', border: '1px solid #FECDCA', borderRadius: 8, padding: 14, color: ROJO, fontSize: 12.5 }}>{error}</div>
  if (!d) return <div style={{ padding: 22, color: SLATE, fontSize: 13 }}>{cargando ? 'Analizando causas…' : 'Sin datos'}</div>

  const causas = d.causas ?? []
  const plata = causas.filter(c => c.tipo === 'plata').reduce((s, c) => s + Number(c.monto), 0)
  const revision = causas.filter(c => c.tipo === 'revision').reduce((s, c) => s + Number(c.monto), 0)
  const dato = causas.filter(c => c.tipo === 'dato').reduce((s, c) => s + Number(c.monto), 0)
  const se = d.salud_efectivo ?? {}
  const sc = d.sin_cierre ?? {}
  const maxTri = Math.max(...(d.triangulo ?? []).map(t => Number(t.dif || 0)), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={INPUT} />
        <span style={{ color: SLATE, fontSize: 12 }}>a</span>
        <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={INPUT} />
        <select value={suc} onChange={e => setSuc(e.target.value)} style={INPUT}>
          <option value="">Todas las sucursales</option>
          {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <span style={{ fontSize: 11, color: SLATE, marginLeft: 'auto' }}>{cargando ? 'analizando…' : ''}</span>
      </div>

      {/* la pregunta que importa: ¿falta plata o faltan datos? */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
        {[
          { l: 'PROBLEMA DE PLATA', v: fmt(plata), s: 'el dinero no está donde debería', c: plata > 0 ? ROJO : VERDE },
          { l: 'POR REVISAR', v: fmt(revision), s: 'hay explicación probable', c: AMBAR },
          { l: 'SOLO FALTA CARGAR DATOS', v: fmt(dato), s: 'no es un faltante de dinero', c: SLATE },
          { l: 'SALUD DEL EFECTIVO', v: se.dias_total ? `${se.dias_total - (se.dias_descuadre || 0)}/${se.dias_total}` : '—',
            s: se.dias_descuadre ? `${se.dias_descuadre} días descuadran · ${fmt(se.monto_descuadre)}` : 'todos los días calzan',
            c: (se.dias_descuadre || 0) === 0 ? VERDE : (se.dias_descuadre || 0) < 5 ? AMBAR : ROJO },
        ].map((k, i) => (
          <div key={i} style={{ background: '#fff', border: `1px solid ${BORDE}`, borderLeft: `4px solid ${k.c}`, borderRadius: 8, padding: '11px 14px' }}>
            <div style={{ fontSize: 10, letterSpacing: 0.5, color: SLATE, fontWeight: 700 }}>{k.l}</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: k.c }}>{k.v}</div>
            <div style={{ fontSize: 10.5, color: SLATE }}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* causas */}
      <Bloque titulo="Por qué no cuadra" sub="Cada pago sin respaldo clasificado según la evidencia. Clic en una causa abre los pagos que la componen."
        acciones={<button onClick={() => exportarExcel(causas, `causas_${desde}`, 'Causas')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>}>
        {!causas.length ? <div style={{ color: VERDE, fontSize: 13, padding: 12, textAlign: 'center' }}>Todo el período está respaldado. No hay causas que analizar.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {causas.map((c, i) => {
              const t = TIPO[c.tipo] ?? TIPO.dato
              return (
                <div key={i} onClick={() => abrirCausa(c)}
                  style={{ display: 'grid', gridTemplateColumns: '5px 1fr 150px', gap: 12, alignItems: 'center', cursor: 'pointer',
                    border: `1px solid ${BORDE}`, borderRadius: 6, padding: '10px 12px', background: c.tipo === 'plata' ? '#FEF3F2' : c.tipo === 'revision' ? '#FFFBEB' : '#FAFAFB' }}>
                  <div style={{ background: t.c, height: '100%', minHeight: 34, borderRadius: 3 }} />
                  <div>
                    <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, color: t.c }}>{t.l}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>
                      {c.descripcion} <span style={{ fontWeight: 400, color: SLATE }}>· {fS(c.n)} pagos · {c.sucursales} sucursal(es)</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: SLATE, lineHeight: 1.45 }}>{c.accion}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: t.c }}>{fmt(c.monto)}</div>
                    <div style={{ fontSize: 10, color: SLATE }}>{c.desde} → {c.hasta}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Bloque>

      {/* triángulo */}
      <Bloque titulo="Dónde está la diferencia: BSALE contra el cierre de caja"
        sub="El POS registra lo que se cobró; el cajero declara lo que cuenta. Cuando difieren, el medio que más aporta señala la causa. El efectivo va primero: es lo único físico.">
        {!(d.triangulo ?? []).length ? <div style={{ color: VERDE, fontSize: 13, padding: 12, textAlign: 'center' }}>Todos los días con cierre calzan contra BSALE.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Medio donde está la diferencia</th>
              <th style={{ ...TH, textAlign: 'right' }}>Días</th>
              <th style={{ ...TH, textAlign: 'right' }}>Diferencia acumulada</th>
              <th style={TH}></th>
              <th style={{ ...TH, textAlign: 'right' }}>Con efectivo sano</th>
            </tr></thead>
            <tbody>
              {(d.triangulo ?? []).map((t, i) => (
                <tr key={i} style={{ background: t.medio === 'Efectivo' ? '#FEF3F2' : undefined }}>
                  <td style={{ ...TD, fontWeight: 600, color: t.medio === 'Efectivo' ? ROJO : INK }}>{t.medio}</td>
                  <td style={NUM}>{fS(t.dias)}</td>
                  <td style={{ ...NUM, fontWeight: 700 }}>{fmt(t.dif)}</td>
                  <td style={{ ...TD, width: 110 }}>
                    <div style={{ background: '#F3F4F6', borderRadius: 3, height: 7, width: 100, overflow: 'hidden' }}>
                      <div style={{ width: `${100 * Number(t.dif) / maxTri}%`, height: '100%', background: t.medio === 'Efectivo' ? ROJO : NAVY }} />
                    </div>
                  </td>
                  <td style={{ ...NUM, color: SLATE }}>{fS(t.efectivo_ok)} de {fS(t.dias)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ fontSize: 11, color: SLATE, marginTop: 8, lineHeight: 1.5 }}>
          Una diferencia grande en <b>Webpay</b> suele ser estructural: las ventas del canal web no pasan por una caja física, así que nadie las declara en el cierre. Una diferencia en <b>efectivo</b> siempre se revisa primero.
          {Number(sc.dias) > 0 && <> Además hay <b style={{ color: AMBAR }}>{fS(sc.dias)} días con venta en BSALE y sin cierre de caja</b> ({fmt(sc.monto)}).</>}
        </div>
      </Bloque>

      {/* días críticos */}
      <Bloque titulo="Los días que más descuadran" sub="Ordenados por diferencia. Cada fila dice en qué medio está y si el efectivo calza."
        acciones={<button onClick={() => exportarExcel(d.dias_criticos ?? [], `dias_criticos_${desde}`, 'Dias')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>}>
        <div style={{ maxHeight: '44vh', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Fecha</th><th style={TH}>Sucursal</th>
              <th style={{ ...TH, textAlign: 'right' }}>BSALE</th><th style={{ ...TH, textAlign: 'right' }}>Caja declaró</th>
              <th style={{ ...TH, textAlign: 'right' }}>Diferencia</th><th style={TH}>Medio</th><th style={TH}>Lectura</th>
            </tr></thead>
            <tbody>
              {(d.dias_criticos ?? []).map((x, i) => (
                <tr key={i} style={{ background: x.efectivo_ok === false ? '#FEF3F2' : undefined }}>
                  <td style={{ ...TD, fontWeight: 600 }}>{x.fecha}</td>
                  <td style={TD}>{x.sucursal ?? x.sucursal_id}</td>
                  <td style={NUM}>{fmt(x.bsale)}</td>
                  <td style={NUM}>{fmt(x.caja)}</td>
                  <td style={{ ...NUM, fontWeight: 700, color: Number(x.dif) === 0 ? SLATE : Math.abs(Number(x.dif)) > 1000000 ? ROJO : AMBAR }}>{fmt(x.dif)}</td>
                  <td style={{ ...TD, fontSize: 11.5, fontWeight: 600, color: x.medio === 'Efectivo' ? ROJO : INK }}>{x.medio}</td>
                  <td style={{ ...TD, fontSize: 11, color: SLATE, whiteSpace: 'normal', maxWidth: 300 }}>{x.lectura}</td>
                </tr>
              ))}
              {!(d.dias_criticos ?? []).length && <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: VERDE, padding: 18 }}>Ningún día descuadra en el período.</td></tr>}
            </tbody>
          </table>
        </div>
      </Bloque>

      {/* drawer */}
      {detalle && (
        <div onClick={() => setDetalle(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(980px, 94vw)', background: '#fff', height: '100%', overflow: 'auto', boxShadow: '-8px 0 28px rgba(0,0,0,.18)' }}>
            <div style={{ position: 'sticky', top: 0, background: '#fff', borderBottom: `1px solid ${BORDE}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: NAVY }}>{detalle.titulo}</div>
                <div style={{ fontSize: 11.5, color: SLATE }}>{detalle.sub}</div>
              </div>
              <button onClick={() => exportarExcel(detalle.filas ?? [], 'detalle_causa', 'Detalle')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
              <button onClick={() => setDetalle(null)} style={{ ...INPUT, cursor: 'pointer', fontWeight: 700 }}>Cerrar</button>
            </div>
            <div style={{ padding: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={TH}>Fecha</th><th style={TH}>Sucursal</th><th style={TH}>Cajero</th><th style={TH}>Medio</th>
                  <th style={TH}>Documento</th><th style={TH}>Cliente</th><th style={{ ...TH, textAlign: 'right' }}>Monto</th>
                </tr></thead>
                <tbody>
                  {(detalle.filas ?? []).map((x, i) => (
                    <tr key={i}>
                      <td style={TD}>{x.fecha}</td><td style={TD}>{x.sucursal}</td><td style={TD}>{x.cajero}</td>
                      <td style={TD}>{x.medio}</td>
                      <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{x.documento}</td>
                      <td style={{ ...TD, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.cliente}</td>
                      <td style={{ ...NUM, fontWeight: 700 }}>{fmt(x.monto)}</td>
                    </tr>
                  ))}
                  {!(detalle.filas ?? []).length && <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: SLATE, padding: 18 }}>Sin registros.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DiagnosticoTab
