import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabase'
import { exportarExcel } from '../exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   EXPLORADOR DE RECAUDACIÓN
   Misma pregunta por cualquier eje: sucursal · día · cajero · medio ·
   documento · cliente. Los filtros se combinan y cada fila abre el detalle
   pago a pago hasta la boleta.
   Fuente: v_tes_pago_detalle (pago + medio + sucursal + cajero + documento
   + estado de conciliación). RPC: fn_tes_explorar / fn_tes_detalle.
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const fmt = n => '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fS = n => new Intl.NumberFormat('es-CL').format(Number(n || 0))
const TH = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE, padding: '7px 10px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }
const TD = { fontSize: 12.5, padding: '6px 10px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff' }
const btn = a => ({ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${a ? NAVY : BORDE}`, background: a ? NAVY : '#fff', color: a ? '#fff' : INK })

const DIMS = [
  ['sucursal', 'Sucursal'], ['dia', 'Día'], ['cajero', 'Cajero'],
  ['medio', 'Medio de pago'], ['documento', 'Boleta / factura'], ['cliente', 'Cliente'],
]
const hoyISO = () => new Date().toISOString().slice(0, 10)
const primeroMes = () => hoyISO().slice(0, 8) + '01'

export function ExploradorTab() {
  const [desde, setDesde] = useState(primeroMes())
  const [hasta, setHasta] = useState(hoyISO())
  const [dim, setDim] = useState('sucursal')
  const [fSuc, setFSuc] = useState('')
  const [fCaj, setFCaj] = useState('')
  const [fMed, setFMed] = useState('')
  const [soloProblemas, setSoloProblemas] = useState(false)
  const [filas, setFilas] = useState([])
  const [filtros, setFiltros] = useState({ sucursales: [], cajeros: [], medios: [] })
  const [detalle, setDetalle] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    const args = {
      p_desde: desde, p_hasta: hasta, p_dimension: dim,
      p_sucursal: fSuc || null, p_cajero: fCaj ? Number(fCaj) : null,
      p_medio: fMed ? Number(fMed) : null, p_solo_problemas: soloProblemas,
    }
    const [r, f] = await Promise.all([
      supabase.rpc('fn_tes_explorar', args),
      supabase.rpc('fn_tes_filtros', { p_desde: desde, p_hasta: hasta }),
    ])
    setCargando(false)
    if (r.error) { setError(r.error.message); return }
    setFilas(r.data ?? [])
    if (!f.error && f.data) setFiltros(f.data)
  }, [desde, hasta, dim, fSuc, fCaj, fMed, soloProblemas])

  useEffect(() => { cargar() }, [cargar])

  // abre el detalle pago a pago del elemento pinchado
  const abrir = async (fila, situacion) => {
    setDetalle({ cargando: true, titulo: fila ? fila.etiqueta : 'Detalle', sub: '', filas: [] })
    const args = {
      p_desde: desde, p_hasta: hasta,
      p_sucursal: dim === 'sucursal' && fila ? fila.clave : (fSuc || null),
      p_cajero: dim === 'cajero' && fila ? Number(fila.clave) : (fCaj ? Number(fCaj) : null),
      p_medio: dim === 'medio' && fila ? Number(fila.clave) : (fMed ? Number(fMed) : null),
      p_dia: dim === 'dia' && fila ? fila.clave : null,
      p_documento: dim === 'documento' && fila && fila.clave !== '—' ? Number(fila.clave) : null,
      p_situacion: situacion ?? null, p_limit: 300,
    }
    const { data, error: e } = await supabase.rpc('fn_tes_detalle', args)
    if (e) { setDetalle({ titulo: 'Error', sub: e.message, filas: [] }); return }
    setDetalle({
      titulo: fila ? fila.etiqueta : 'Todos los pagos',
      sub: `${situacion === 'problema' ? 'Solo lo que no tiene respaldo' : situacion === 'probado' ? 'Solo lo probado' : 'Todos los pagos'} · ${desde} a ${hasta}`,
      filas: data ?? [],
    })
  }

  const tot = filas.reduce((a, f) => ({
    n: a.n + Number(f.n_pagos || 0), rec: a.rec + Number(f.recaudacion || 0),
    pro: a.pro + Number(f.probado || 0), sin: a.sin + Number(f.sin_respaldo || 0),
    no: a.no + Number(f.no_recauda || 0),
  }), { n: 0, rec: 0, pro: 0, sin: 0, no: 0 })
  const maxRec = Math.max(...filas.map(f => Number(f.recaudacion || 0)), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* filtros */}
      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={INPUT} />
        <span style={{ color: SLATE, fontSize: 12 }}>a</span>
        <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={INPUT} />
        <select value={fSuc} onChange={e => setFSuc(e.target.value)} style={INPUT}>
          <option value="">Todas las sucursales</option>
          {(filtros.sucursales ?? []).map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={fCaj} onChange={e => setFCaj(e.target.value)} style={INPUT}>
          <option value="">Todos los cajeros</option>
          {(filtros.cajeros ?? []).map(c => <option key={c.id} value={c.id}>{c.nombre}{c.suc ? ` · ${c.suc}` : ''}</option>)}
        </select>
        <select value={fMed} onChange={e => setFMed(e.target.value)} style={INPUT}>
          <option value="">Todos los medios</option>
          {(filtros.medios ?? []).map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: soloProblemas ? ROJO : INK, fontWeight: soloProblemas ? 700 : 400 }}>
          <input type="checkbox" checked={soloProblemas} onChange={e => setSoloProblemas(e.target.checked)} />
          Solo lo que no cuadra
        </label>
        {(fSuc || fCaj || fMed || soloProblemas) && (
          <button onClick={() => { setFSuc(''); setFCaj(''); setFMed(''); setSoloProblemas(false) }}
            style={{ ...INPUT, cursor: 'pointer', color: SLATE }}>Limpiar</button>
        )}
      </div>

      {/* eje de análisis */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: SLATE, fontWeight: 600 }}>Agrupar por:</span>
        {DIMS.map(([k, l]) => <button key={k} onClick={() => setDim(k)} style={btn(dim === k)}>{l}</button>)}
        <button onClick={() => exportarExcel(filas, `explorador_${dim}_${desde}`, 'Explorador')}
          style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY, marginLeft: 'auto' }}>Excel</button>
      </div>

      {error && <div style={{ background: '#FEF3F2', border: '1px solid #FECDCA', borderRadius: 8, padding: 12, color: ROJO, fontSize: 12.5 }}>{error}</div>}

      {/* resumen del filtro activo — cada número abre su detalle */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {[
          { l: 'Pagos', v: fS(tot.n), s: 'en el filtro actual', click: null },
          { l: 'Recaudación', v: fmt(tot.rec), s: 'medios que sí cobran', click: 'probado' },
          { l: 'Probado', v: tot.rec ? (100 * tot.pro / tot.rec).toFixed(1) + '%' : '—', s: fmt(tot.pro), c: VERDE, click: 'probado' },
          { l: 'Sin respaldo', v: fmt(tot.sin), s: 'pinchar para ver cuáles', c: tot.sin > 0 ? ROJO : VERDE, click: 'problema' },
          { l: 'No es recaudación', v: fmt(tot.no), s: 'abono, NC y crédito', c: SLATE, click: 'no_recauda' },
        ].map((k, i) => (
          <div key={i} onClick={() => k.click && abrir(null, k.click)}
            style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 14px', cursor: k.click ? 'pointer' : 'default' }}>
            <div style={{ fontSize: 10, letterSpacing: 0.5, color: SLATE, fontWeight: 600 }}>{k.l}</div>
            <div style={{ fontSize: 19, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: k.c || NAVY }}>{k.v}</div>
            <div style={{ fontSize: 10.5, color: SLATE }}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* tabla del eje elegido */}
      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ maxHeight: '58vh', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>{DIMS.find(x => x[0] === dim)?.[1]}</th>
              <th style={{ ...TH, textAlign: 'right' }}>Pagos</th>
              <th style={{ ...TH, textAlign: 'right' }}>Recaudación</th>
              <th style={TH}></th>
              <th style={{ ...TH, textAlign: 'right' }}>Probado</th>
              <th style={{ ...TH, textAlign: 'right' }}>Sin respaldo</th>
              <th style={TH}>Causa más grande</th>
            </tr></thead>
            <tbody>
              {cargando && <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: SLATE, padding: 20 }}>Calculando…</td></tr>}
              {!cargando && !filas.length && <tr><td colSpan={7} style={{ ...TD, textAlign: 'center', color: SLATE, padding: 20 }}>Sin datos para este filtro.</td></tr>}
              {filas.map((f, i) => (
                <tr key={i} style={{ background: Number(f.sin_respaldo) > 0 ? '#FFFBF5' : undefined }}>
                  <td style={{ ...TD, fontWeight: 600, cursor: 'pointer' }} onClick={() => abrir(f, null)}>
                    <span style={{ textDecoration: 'underline dotted #C7D2FE' }}>{f.etiqueta}</span>
                    {f.sub ? <div style={{ fontSize: 10, color: SLATE, fontWeight: 400 }}>{f.sub}</div> : null}
                  </td>
                  <td style={NUM}>{fS(f.n_pagos)}</td>
                  <td style={NUM}>{fmt(f.recaudacion)}</td>
                  <td style={{ ...TD, width: 90 }}>
                    <div style={{ background: '#F3F4F6', borderRadius: 3, height: 7, width: 80, overflow: 'hidden' }}>
                      <div style={{ width: `${100 * Number(f.recaudacion) / maxRec}%`, height: '100%', background: NAVY }} />
                    </div>
                  </td>
                  <td style={{ ...NUM, fontWeight: 700, color: Number(f.pct_probado) >= 95 ? VERDE : Number(f.pct_probado) >= 80 ? AMBAR : ROJO }}>
                    {f.pct_probado ?? '—'}%
                  </td>
                  <td style={{ ...NUM, fontWeight: 700, color: Number(f.sin_respaldo) > 0 ? ROJO : SLATE, cursor: Number(f.sin_respaldo) > 0 ? 'pointer' : 'default' }}
                    onClick={() => Number(f.sin_respaldo) > 0 && abrir(f, 'problema')}>
                    {Number(f.sin_respaldo) > 0 ? <span style={{ textDecoration: 'underline dotted' }}>{fmt(f.sin_respaldo)}</span> : '—'}
                  </td>
                  <td style={{ ...TD, fontSize: 11, color: SLATE, whiteSpace: 'normal', maxWidth: 260 }}>{f.peor_causa || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '8px 12px', borderTop: `1px solid ${BORDE}`, fontSize: 11, color: SLATE }}>
          Clic en cualquier nombre abre los pagos que lo componen; clic en el monto rojo abre solo lo que no tiene respaldo.
        </div>
      </div>

      {/* drawer de detalle */}
      {detalle && (
        <div onClick={() => setDetalle(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(1000px, 94vw)', background: '#fff', height: '100%', overflow: 'auto', boxShadow: '-8px 0 28px rgba(0,0,0,.18)' }}>
            <div style={{ position: 'sticky', top: 0, background: '#fff', borderBottom: `1px solid ${BORDE}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: NAVY }}>{detalle.titulo}</div>
                <div style={{ fontSize: 11.5, color: SLATE }}>{detalle.sub} · {fS((detalle.filas ?? []).length)} pagos</div>
              </div>
              <button onClick={() => exportarExcel(detalle.filas ?? [], 'detalle_tesoreria', 'Detalle')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
              <button onClick={() => setDetalle(null)} style={{ ...INPUT, cursor: 'pointer', fontWeight: 700 }}>Cerrar</button>
            </div>
            <div style={{ padding: 14 }}>
              {detalle.cargando ? <div style={{ color: SLATE, fontSize: 13 }}>Cargando…</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={TH}>Fecha</th><th style={TH}>Sucursal</th><th style={TH}>Cajero</th><th style={TH}>Medio</th>
                    <th style={TH}>Documento</th><th style={TH}>Cliente</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Monto</th><th style={TH}>Situación</th><th style={TH}>Qué dice la fuente</th>
                  </tr></thead>
                  <tbody>
                    {(detalle.filas ?? []).map((x, i) => (
                      <tr key={i}>
                        <td style={TD}>{x.fecha}</td>
                        <td style={TD}>{x.sucursal}</td>
                        <td style={TD}>{x.cajero}</td>
                        <td style={TD}>{x.medio}</td>
                        <td style={{ ...TD, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{x.documento}</td>
                        <td style={{ ...TD, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.cliente}</td>
                        <td style={{ ...NUM, fontWeight: 700 }}>{fmt(x.monto)}</td>
                        <td style={{ ...TD, fontSize: 11, fontWeight: 700, color: x.situacion?.startsWith('Probado') ? VERDE : x.situacion === 'No es recaudación' ? SLATE : ROJO }}>{x.situacion}</td>
                        <td style={{ ...TD, fontSize: 11, color: SLATE, whiteSpace: 'normal', maxWidth: 260 }}>{x.nota}</td>
                      </tr>
                    ))}
                    {!(detalle.filas ?? []).length && <tr><td colSpan={9} style={{ ...TD, textAlign: 'center', color: SLATE, padding: 20 }}>Sin pagos en esta selección.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ExploradorTab
